/** useConviction — the Conviction game orchestration hook (CONCEPT.md §The game
 *  loop, Rounds + computer mode). Wraps the shipping stream / merge / generate
 *  substrate into the round machine: it owns `advance()` (the GM one-click
 *  progression), seat actions (play / fold / act-as-seat), the table (chat,
 *  goals), and the lifecycle (start / pause / end / clear / inter-round dials).
 *  The pure engine/economy/scoring/settlement modules do the maths; this threads
 *  them through the store and the async generation. The game's OWN continuation
 *  generation runs here (generateScenes + BULK_ADD_SCENES), bypassing the §5b
 *  entry-point guard that disables MANUAL generation on a live game's branch. */
"use client";
import { useCallback, useMemo, useRef } from "react";

import { generateScenes } from "@/lib/ai/scenes";
import { resolveReasoningBudget } from "@/lib/ai/api";
import { outlineContext } from "@/lib/ai/context";
import { generateArcPerspective, perspectiveLabel } from "@/lib/ai/perspectives";
import { detectConflicts } from "@/lib/ai/game-conflicts";
import { missingRoomPerspectiveKeys } from "@/lib/ai/game-narration";
import { decideAgentPlays } from "@/lib/ai/game-agent";
import { scoreThreadsWithAI, type ThreadScoringInput, type ThreadScoringRead } from "@/lib/ai/game-scoring";
import { resolveConflictRealism, type RealismResolution } from "@/lib/ai/game-realism";
import { generateSeatStream } from "@/lib/ai/game-streams";
import { instantiateStream, scoreStreamPrior } from "@/lib/ai/streams";
import { chooseAgentPlays, playEvidence, streamProbsResolver, type AgentPlay } from "@/lib/game/agent";
import { ownerSeatByStream, snapshotThreadLogits } from "@/lib/game/attribution";
import { STANCE_EVIDENCE_MAX } from "@/lib/constants";
import { cardCost, defaultEconomy, effectiveCost, playLogitNudge, settle } from "@/lib/game/economy";
import { createSeat, dealHand, isAiControlled, nextActiveSeat, seatPresence, startRound, unreadyHumanSeats, unplayedDealtStreamIds } from "@/lib/game/engine";
import { scoreRound, type ThreadAttribution } from "@/lib/game/scoring";
import { settleContest, settlementSeed } from "@/lib/game/settlement";
import { applyStreamPrior, openStream, rebuildStream, streamProbs } from "@/lib/forces/stream-stance";
import { computeCumulativePositions } from "@/lib/forces/positions";
import { streamsForBranch } from "@/lib/merges";
import { resolveAgentById, resolveAgentPersona } from "@/lib/agents/personas";
import { activeGameForBranch } from "@/lib/game/guards";
import { perspectiveName, uid } from "@/components/stage/RoomUI";
import { useStore } from "@/lib/state/store";
import { useToast } from "@/lib/state/toast-context";
import type {
  Arc,
  ConvictionEconomy,
  GameChatMessage,
  GameEvent,
  GameRoom,
  Goal,
  Hand,
  MergeResolution,
  NarrativeState,
  PlayedCard,
  ProposedMerge,
  RoundPhase,
  RoundScoreRecord,
  Seat,
  Stream,
  ThreadSettlement,
} from "@/types/narrative";

export interface StartGameConfig {
  branchId: string;
  locations: string[];
  /** Seat blueprints — one per perspective in play. */
  seats: Array<{
    perspectiveId: string;
    driver: Seat["driver"];
    memberId?: string;
    agentId?: string;
    locationId: string;
  }>;
  economy?: Partial<ConvictionEconomy>;
  /** Per-phase time budgets in seconds; absent/0 = untimed. */
  phaseSeconds?: Partial<Record<RoundPhase, number>>;
  /** Carry over conviction balances from the most recent game on this branch
   *  (returning perspectives keep their balance; new seats get the fresh start).
   *  The setup UI defaults this ON (carry-over); omitted at the engine level =
   *  off → every seat starts at `economy.start` (a clean economy). */
  persistEconomy?: boolean;
  /** Auto-generate the continuation arc at RESOLVE (skip the GM review panel). */
  autoResolve?: boolean;
}

/** Default candidate actions for a freshly-seeded seat stream (so a hand is never
 *  empty in a world without prepared streams; the GM can expand). */
const SEED_ACTIONS = ["press the advantage", "hold and observe", "change the terms"];

/** Human-readable "who we're waiting on" for the presence-gate toasts — each
 *  blocking seat annotated with WHY (offline vs not ready) so the GM knows whether
 *  to wait, nudge, or share the game. */
function waitingLabel(seats: Seat[], narrative: NarrativeState): string {
  return seats
    .map((s) => {
      const name = perspectiveName(narrative.perspectives?.[s.perspectiveId], narrative);
      return `${name} (${seatPresence(s) === "offline" ? "offline" : "not ready"})`;
    })
    .join(", ");
}

/** The set of entity ids actually SEATED in a room — each seat's perspective
 *  resolved to its backing entity. Used to flag, in an agent's continuity, which
 *  of its standing relationships are with players ACROSS THE TABLE right now. */
function seatedEntityIds(narrative: NarrativeState, room: GameRoom | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const seat of Object.values(room?.seats ?? {})) {
    const ref = narrative.perspectives?.[seat.perspectiveId]?.entityRef;
    if (ref) ids.add(ref);
  }
  return ids;
}

/** Render a seat entity's continuity for an in-character agent decision: its own
 *  inner-world facts, PLUS its standing RELATIONSHIPS toward other entities
 *  (trust / allegiance / rivalry, signed by valence). At a strategy table the
 *  relationship layer is the load-bearing read — it tells the agent how its
 *  character actually stands toward the others, and counterparts seated AT THIS
 *  TABLE are flagged so the social dynamics of the board drive the play. */
function renderEntityContext(
  narrative: NarrativeState,
  perspectiveId: string,
  tableEntityIds?: Set<string>,
): string {
  const p = narrative.perspectives?.[perspectiveId];
  if (!p || p.kind === "narrator" || !p.entityRef) return "";
  const self = p.entityRef;
  const src =
    p.kind === "character" ? narrative.characters : p.kind === "location" ? narrative.locations : narrative.artifacts;
  const ent = src?.[self];
  if (!ent) return "";

  const nameOf = (id: string): string | undefined =>
    narrative.characters?.[id]?.name ?? narrative.locations?.[id]?.name ?? narrative.artifacts?.[id]?.name;

  const lines: string[] = [`${ent.name}:`];
  for (const nd of Object.values(ent.world?.nodes ?? {})) lines.push(`- ${nd.content}`);

  // Inter-entity relationships involving this seat. Positive valence = warmth /
  // alliance / trust; negative = friction / rivalry / hostility. Counterparts
  // seated this game are the agent's LIVE reads — surface them first and marked.
  const rels = (narrative.relationships ?? [])
    .map((r) => {
      const otherId = r.from === self ? r.to : r.to === self ? r.from : null;
      return otherId ? { otherId, type: r.type, valence: r.valence } : null;
    })
    .filter((r): r is { otherId: string; type: string; valence: number } => r !== null);
  if (rels.length) {
    const atTable = tableEntityIds ?? new Set<string>();
    // Players across the table first, then the rest — bias the agent toward the
    // social dynamics actually in play this round.
    rels.sort((a, b) => Number(atTable.has(b.otherId)) - Number(atTable.has(a.otherId)));
    const relLines = rels
      .map((r) => {
        const other = nameOf(r.otherId);
        if (!other) return null;
        const sign = r.valence > 0 ? `+${r.valence}` : `${r.valence}`;
        const seated = atTable.has(r.otherId) ? " · AT THIS TABLE" : "";
        return `- ${r.type} (${sign}) → ${other}${seated}`;
      })
      .filter(Boolean) as string[];
    if (relLines.length) {
      lines.push("YOUR RELATIONSHIPS (how you stand toward others — sign = warmth/hostility, magnitude = strength):");
      lines.push(...relLines);
    }
  }
  return lines.join("\n");
}

export function useConviction() {
  const { state, dispatch } = useStore();
  const showToast = useToast();
  const narrative = state.activeNarrative;
  const roomId = state.viewState.activeGameRoomId ?? null;
  // Resolve the candidate room: prefer the pinned activeGameRoomId, fall back to
  // activeGameForBranch when it's null (viewState is session-only; gameRooms
  // persist across refreshes). Ended rooms are kept in gameRooms solely for
  // economy carryover — they don't drive UI state, so filter them out here.
  const room: GameRoom | null = (() => {
    const candidate = roomId
      ? (narrative?.gameRooms?.[roomId] ?? null)
      : (narrative ? (activeGameForBranch(narrative, state.viewState.activeBranchId) ?? null) : null);
    return candidate?.phase === 'ended' ? null : (candidate ?? null);
  })();
  // The just-ended game still pinned this session — drives the end-of-game
  // report. Where `room` nulls out an ended game (so the branch unlocks and the
  // shell tears down), this surfaces the ended room so the modal can show the
  // debrief until the GM closes it (clearing the pin) or clears the game.
  const endedRoom: GameRoom | null = (() => {
    if (!roomId) return null;
    const c = narrative?.gameRooms?.[roomId] ?? null;
    return c?.phase === 'ended' ? c : null;
  })();
  const actAsSeatId = state.viewState.actAsSeatId ?? null;

  // The freshest committed room — the single source of truth for background async
  // work (agents deciding during PLAY, perspective/seed generation) that runs
  // outside React's render cycle and must read the latest state, not a snapshot.
  //
  // CRITICAL: this is kept current in TWO places — at render (for room changes that
  // come from elsewhere: switching rooms, external dispatches) AND synchronously
  // inside `saveRoom` below (line: roomRef.current = r). The synchronous update is
  // what makes the ref reliable: a `saveRoom` and the background work it kicks off
  // run in the SAME tick, before React commits, so a render-only ref would still
  // hold the pre-save snapshot and the background work would clobber the save.
  const roomRef = useRef<GameRoom | null>(room);
  roomRef.current = room;

  // Generation epoch — bumped by cancelGeneration() to invalidate any in-flight
  // AI work. Each generation site captures the epoch on entry and re-checks it
  // after every await; a mismatch means the GM cancelled, so the site bails
  // without applying results or transitioning the phase (the orphaned request
  // dies on the API timeout; its result is discarded).
  const genEpochRef = useRef(0);

  const saveRoom = useCallback(
    (r: GameRoom) => {
      // Mirror into the ref synchronously so same-tick background work reads this
      // save, not the pre-commit snapshot React still holds (see roomRef above).
      roomRef.current = r;
      dispatch({ type: "UPSERT_GAME_ROOM", room: r });
    },
    [dispatch],
  );

  /** Append a timestamped event to the room's GM-only log (pure — returns a new
   *  room). Everything that happens passes through here. */
  const logRoom = useCallback(
    (r: GameRoom, kind: GameEvent["kind"], text: string, seatId?: string): GameRoom => ({
      ...r,
      log: [...(r.log ?? []), { id: uid("ev"), at: Date.now(), kind, text, seatId }],
    }),
    [],
  );

  // ── Seat-owned streams ──────────────────────────────────────────────────
  const ownedStreams = useCallback(
    (n: NarrativeState, r: GameRoom, seat: Seat): Stream[] =>
      streamsForBranch(n, r.branchId).filter(
        (s) => s.perspectiveId === seat.perspectiveId && s.state === "open",
      ),
    [],
  );

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  const startGame = useCallback(
    (cfg: StartGameConfig) => {
      if (!narrative) return;
      const economy: ConvictionEconomy = { ...defaultEconomy(), ...cfg.economy };
      const id = uid("game");

      // Economy persistence: by default a new game RESETS (everyone at
      // economy.start). When persisting, carry the prior game's final balance for
      // each returning perspective; new seats still get the fresh start.
      const carry: Record<string, number> = {};
      if (cfg.persistEconomy) {
        const prior = Object.values(narrative.gameRooms ?? {})
          .filter((r) => r.branchId === cfg.branchId)
          .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt))[0];
        if (prior) for (const s of Object.values(prior.seats)) carry[s.perspectiveId] = s.conviction;
      }

      const seats: Record<string, Seat> = {};
      cfg.seats.forEach((s, i) => {
        const seatId = uid("seat");
        const seat = createSeat({
          id: seatId,
          perspectiveId: s.perspectiveId,
          driver: s.driver,
          memberId: s.memberId,
          agentId: s.agentId,
          locationId: s.locationId,
          economy,
          colorIndex: i,
        });
        // Returning player keeps their balance; a new player gets economy.start.
        if (cfg.persistEconomy && carry[s.perspectiveId] != null) seat.conviction = carry[s.perspectiveId];
        seats[seatId] = seat;
      });
      // Real streams are AI-seeded per seat at the first READ-WRITE deal
      // (grounded in each perspective's continuity), not stubbed here.
      const game: GameRoom = {
        id,
        branchId: cfg.branchId,
        variant: "rounds",
        mode: "computer",
        phase: "round",
        paused: false,
        locations: cfg.locations,
        seats,
        economy,
        ...(cfg.phaseSeconds ? { phaseSeconds: cfg.phaseSeconds } : {}),
        ...(cfg.autoResolve ? { autoResolve: true } : {}),
        round: null,
        chat: [],
        createdAt: Date.now(),
      };
      game.round = startRound(game, 0);
      saveRoom(game);
      dispatch({ type: "SET_ACTIVE_GAME_ROOM", id });
    },
    [narrative, dispatch, saveRoom],
  );

  const pause = useCallback(
    (paused: boolean) => {
      if (room) saveRoom({ ...room, paused });
    },
    [room, saveRoom],
  );

  // ── Minimise / resume — freeze the clocks while the window is away ───────────
  // Minimising closes the window but the game lives on; without this the phase
  // anchors keep counting in wall-clock time, so on resume a budget that "ran out"
  // off-screen drains the timer (or fast-forwards the auto-pilot). We stamp the
  // minimise time and, on resume, push every live anchor forward by the elapsed
  // gap — so the clocks continue from exactly where they were left.
  const minimise = useCallback(() => {
    if (room && room.phase !== "ended" && room.minimisedAt == null) saveRoom({ ...room, minimisedAt: Date.now() });
  }, [room, saveRoom]);

  const resumeFromMinimise = useCallback(() => {
    if (!room || room.minimisedAt == null) return;
    const delta = Date.now() - room.minimisedAt;
    const r = room.round;
    const shift = (v?: number) => (v != null ? v + delta : v);
    const round = r
      ? {
          ...r,
          readStartedAt: shift(r.readStartedAt),
          writeStartedAt: shift(r.writeStartedAt),
          playStartedAt: shift(r.playStartedAt),
          turnStartedAt: shift(r.turnStartedAt),
          scoringStartedAt: shift(r.scoringStartedAt),
        }
      : r;
    saveRoom({ ...room, minimisedAt: undefined, round });
  }, [room, saveRoom]);

  // ── Live hosting — share seats with remote players over the tunnel ───────────
  // Turning hosting ON mints a guest pass per seat (a token → seat binding); the
  // GM shares the QR/link for whichever seats players take. The host BRIDGE
  // (useConvictionLiveHost) does the actual publish/apply; this just flips the
  // flag + passes on the room so they persist and the bridge activates.
  const setHosting = useCallback(
    (on: boolean) => {
      if (!room) return;
      if (!on) {
        // Stopping hosting drops every guest — clear presence so nobody reads as
        // online once the tunnel's closed (the host won't get the offline edges,
        // its stream is gone). Readiness persists; online is what just changed.
        const seats = Object.fromEntries(
          Object.entries(room.seats).map(([id, s]) => [id, s.online ? { ...s, online: false } : s]),
        );
        saveRoom({ ...room, live: false, seats });
        return;
      }
      const existing = new Map((room.guestPasses ?? []).map((p) => [p.seatId, p]));
      // Mint a claim link for every PLAYER-FILLABLE seat — Member seats AND agent
      // seats (a player can take an AI over). gm-proxy is the GM's own; no link.
      const passes = Object.values(room.seats)
        .filter((s) => s.driver !== "gm-proxy")
        .map((s) => {
          const prior = existing.get(s.id);
          const token =
            prior?.token ??
            (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : uid("pass"));
          return { token, gameId: room.id, seatId: s.id, expiresAt: 0 };
        });
      saveRoom({ ...room, live: true, guestPasses: passes });
    },
    [room, saveRoom],
  );

  // A seated player marks themselves PRESENT (or steps away). Drives the presence
  // gate (engine.humansReady): the GM can't start a round / generate perspectives
  // until every human member is online AND ready. Reads roomRef so a remote ready
  // landing concurrently with other intents folds onto the latest committed room.
  const setReady = useCallback(
    (seatId: string, ready: boolean) => {
      const r = roomRef.current;
      const seat = r?.seats[seatId];
      if (!r || !seat || seat.ready === ready) return;
      saveRoom({ ...r, seats: { ...r.seats, [seatId]: { ...seat, ready } } });
    },
    [saveRoom],
  );

  // The broker reports a guest connecting (online) or dropping (offline) for a
  // seat — the master flags it so the gate + status dots reflect who has actually
  // opened the game. A player who disconnects goes offline (red) and re-gates the
  // round even if they'd readied; readiness itself is left intact for their return.
  const setSeatOnline = useCallback(
    (seatId: string, online: boolean) => {
      const r = roomRef.current;
      const seat = r?.seats[seatId];
      if (!r || !seat || !!seat.online === online) return;
      saveRoom({ ...r, seats: { ...r.seats, [seatId]: { ...seat, online } } });
    },
    [saveRoom],
  );

  /** GM cancels the in-flight generation (e.g. a stalled perspective delivery,
   *  agent decision, or conflict read). Invalidates any running generation via
   *  the epoch so its result is discarded when it eventually lands, and clears
   *  the round's `generating` + `thinkingSeats` flags so the board unblocks
   *  immediately. The phase stays put — the GM re-clicks Advance to retry the
   *  same step. No-op when nothing is generating. */
  const cancelGeneration = useCallback(() => {
    const r = roomRef.current;
    if (!r?.round) return;
    const thinking = (r.round.thinkingSeats?.length ?? 0) > 0;
    if (!r.round.generating && !thinking) return;
    genEpochRef.current += 1; // any in-flight generation now reads as cancelled
    saveRoom(
      logRoom(
        { ...r, round: { ...r.round, generating: false, generatingLabel: undefined, thinkingSeats: [] } },
        "phase",
        "GM cancelled generation — Advance to retry",
      ),
    );
  }, [saveRoom, logRoom]);

  /** GM grants more time on the active phase clock — bumps the round's PLAY
   *  budget by `seconds`, pushing the deadline out (re-opens it if it lapsed) so
   *  players get longer to commit cards or write. */
  const extendClock = useCallback(
    (seconds: number) => {
      if (!room?.round) return;
      // Extend whichever player window is live — read, write, or play — so "+30s"
      // grants time on the clock the players see.
      const phase = room.round.phase;
      const key: RoundPhase | null = phase === "read" || phase === "write" || phase === "play" ? phase : null;
      if (!key) return;
      const next = (room.round.timers?.[key] ?? 0) + seconds * 1000;
      saveRoom({ ...room, round: { ...room.round, timers: { ...room.round.timers, [key]: next } } });
    },
    [room, saveRoom],
  );

  const endGame = useCallback(() => {
    if (!room) return;
    // Pin the room so the end-of-game report resolves even when the live game
    // was found via the branch fallback (e.g. after a refresh — viewState is
    // session-only, so activeGameRoomId can be null while a game is live).
    if (roomId !== room.id) dispatch({ type: "SET_ACTIVE_GAME_ROOM", id: room.id });
    // End FIRST — this clears the branch's game-lock so the cleanup
    // REMOVE_STREAM dispatches below aren't no-oped by the guard.
    saveRoom({ ...room, phase: "ended", endedAt: Date.now() });

    // Clean up the unfinished turn: streams the GAME seeded to seats this round
    // that no seat ever played (the seat's own + committed streams are kept).
    if (!room.round) return;
    for (const id of unplayedDealtStreamIds(room.round)) {
      // Only remove still-open streams — never one that got committed/closed.
      if (narrative?.streams?.[id]?.state === "open") dispatch({ type: "REMOVE_STREAM", id });
    }
  }, [narrative, room, roomId, saveRoom, dispatch]);

  const clearGame = useCallback(() => {
    // Works mid-game (room) and from the end-of-game report (endedRoom) —
    // REMOVE_GAME_ROOM clears the session pin when it matches.
    const target = room ?? endedRoom;
    if (target) dispatch({ type: "REMOVE_GAME_ROOM", id: target.id });
  }, [room, endedRoom, dispatch]);

  /** Dismiss the end-of-game report — clears the session pin so the modal lands
   *  on setup next open. The ended room stays in gameRooms for economy carryover. */
  const dismissReport = useCallback(() => {
    dispatch({ type: "SET_ACTIVE_GAME_ROOM", id: null });
  }, [dispatch]);

  const actAsSeat = useCallback(
    (seatId: string | null) => dispatch({ type: "SET_ACT_AS_SEAT", seatId }),
    [dispatch],
  );

  // ── Seat play (manual / human + gm-proxy) ─────────────────────────────────
  /** Apply a single play: nudge the stream's stance (a prior authored by the
   *  seat), record the PlayedCard, deduct conviction. Returns the updated room. */
  const applyPlay = useCallback(
    (n: NarrativeState, r: GameRoom, seatId: string, cardId: string, conviction: number, faceUp: boolean): GameRoom => {
      const round = r.round;
      if (!round) return r;
      // Play-phase protection: cards are committed ONLY during PLAY (write actions
      // belong to the write window). The GM can override the timer, never the phase.
      if (round.phase !== "play") return r;
      const hand = round.hands[seatId];
      const card = hand?.cards.find((c) => c.id === cardId);
      const seat = r.seats[seatId];
      if (!hand || !card || !seat) return r;
      const stream = n.streams?.[card.streamId];
      if (!stream?.outcomes) return r;

      // Face-down pays the concealment premium: the minimum commit is the
      // effective (premium-scaled) cost, charged as a higher floor. Below it →
      // reject (defense in depth; the hand UI already gates the slider).
      const minCommit = effectiveCost(card.cost, faceUp, r.economy);
      if (conviction < minCommit || conviction > seat.conviction) return r;

      const e = playEvidence(conviction, card.cost, r.economy);
      const updatedStream = applyStreamPrior(stream, {
        text: `Commits ${conviction} on "${stream.outcomes[card.outcome]}"`,
        authorId: seat.memberId ?? seat.agentId ?? seatId,
        updates: [{ outcome: stream.outcomes[card.outcome], evidence: e }],
      });
      dispatch({ type: "UPSERT_STREAM", stream: updatedStream });
      const priorId = updatedStream.priors[updatedStream.priors.length - 1]?.id;

      const played = [
        ...hand.played,
        { card, faceUp, conviction, playedAt: hand.played.length + 1, priorId },
      ];
      const name = perspectiveName(n.perspectives?.[seat.perspectiveId], n);
      return logRoom(
        {
          ...r,
          seats: { ...r.seats, [seatId]: { ...seat, conviction: seat.conviction - conviction } },
          round: {
            ...round,
            pot: round.pot + conviction,
            hands: { ...round.hands, [seatId]: { ...hand, played } },
          },
        },
        "play",
        `${name} committed ${conviction} on "${stream.outcomes[card.outcome]}"`,
        seatId,
      );
    },
    [dispatch, logRoom],
  );

  const playCard = useCallback(
    (seatId: string, cardId: string, conviction: number, faceUp = true) => {
      // Fold onto the LATEST committed room (roomRef tracks it synchronously) so
      // two near-simultaneous commits — e.g. remote players in simultaneous play —
      // each land instead of clobbering one another.
      const r = roomRef.current;
      if (!narrative || !r) return;
      saveRoom(applyPlay(narrative, r, seatId, cardId, conviction, faceUp));
    },
    [narrative, saveRoom, applyPlay],
  );

  /** GM veto — strip a committed play from a seat's hand: refund the conviction,
   *  drop it from the pot, and cleanly replay the stream without the play's prior
   *  (rebuildStream → the stance reverts as if it never landed). The GM may then
   *  play a different card on the seat's behalf. */
  const vetoPlay = useCallback(
    (seatId: string, playIndex: number) => {
      if (!narrative || !room?.round) return;
      const round = room.round;
      const hand = round.hands[seatId];
      const seat = room.seats[seatId];
      const played = hand?.played[playIndex];
      if (!hand || !seat || !played) return;

      // Revert the stance: rebuild the stream from its priors minus this play's.
      if (played.priorId) {
        const stream = narrative.streams?.[played.card.streamId];
        if (stream) {
          const kept = stream.priors.filter((p) => p.id !== played.priorId);
          dispatch({ type: "UPSERT_STREAM", stream: rebuildStream(stream, kept) });
        }
      }
      const name = perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative);
      saveRoom(
        logRoom(
          {
            ...room,
            seats: { ...room.seats, [seatId]: { ...seat, conviction: seat.conviction + played.conviction } },
            round: {
              ...round,
              pot: Math.max(0, round.pot - played.conviction),
              hands: { ...round.hands, [seatId]: { ...hand, played: hand.played.filter((_, i) => i !== playIndex) } },
            },
          },
          "veto",
          `GM vetoed ${name}'s ${played.conviction} commit`,
          seatId,
        ),
      );
    },
    [narrative, room, dispatch, saveRoom, logRoom],
  );

  /** GM dictates / vetoes a contested outcome at SHOWDOWN — overrides the draw or
   *  the realism verdict for one contested group (all its streams resolve to the
   *  chosen action). The merge the continuation generates from updates live. */
  const setContestedOutcome = useCallback(
    (groupKey: string, outcome: string) => {
      const pending = room?.round?.pendingMerge;
      if (!narrative || !room?.round || !pending) return;
      const round = room.round;
      const sids = groupKey.split("|");
      // The action each stream's seat actually committed (max-conviction outcome)
      // — so `overridden` is honest when the GM picks against a stream's bearing.
      const backedOutcome = (sid: string): string | undefined => {
        const outcomes = narrative.streams?.[sid]?.outcomes;
        if (!outcomes) return undefined;
        const byOutcome = new Map<number, number>();
        for (const hand of Object.values(round.hands)) {
          for (const p of hand.played) {
            if (p.card.streamId !== sid) continue;
            byOutcome.set(p.card.outcome, (byOutcome.get(p.card.outcome) ?? 0) + p.conviction);
          }
        }
        const top = [...byOutcome.entries()].sort((a, b) => b[1] - a[1])[0];
        return top ? outcomes[top[0]] : undefined;
      };
      const resolutions = { ...pending.resolutions };
      for (const sid of sids) {
        if (!resolutions[sid]) continue;
        const committed = backedOutcome(sid);
        // Keep any realism telling on the resolution; the GM only re-points the
        // headline outcome (a deliberate override of the verdict).
        resolutions[sid] = { ...resolutions[sid], outcome, overridden: committed != null && committed !== outcome };
      }
      saveRoom(
        logRoom(
          { ...room, round: { ...round, pendingMerge: { ...pending, resolutions } } },
          "resolve",
          `GM set contested outcome → "${outcome}"`,
        ),
      );
    },
    [narrative, room, saveRoom, logRoom],
  );

  /** GM edits the realism determination (telling / reasoning / closure) for a
   *  contested group at the showdown review — the same edit the narrative merge
   *  UI offers. Applies to every stream in the group. */
  const editGroupRealism = useCallback(
    (groupKey: string, patch: { telling?: string; reasoning?: string; closes?: boolean }) => {
      const pending = room?.round?.pendingMerge;
      if (!room?.round || !pending) return;
      const round = room.round;
      const resolutions = { ...pending.resolutions };
      for (const sid of groupKey.split("|")) {
        if (!resolutions[sid]) continue;
        resolutions[sid] = { ...resolutions[sid], ...patch };
      }
      saveRoom({ ...room, round: { ...round, pendingMerge: { ...pending, resolutions } } });
    },
    [room, saveRoom],
  );

  /** GM re-runs the realism judge over all contested groups with a steer (the
   *  prompt-driven editing workflow) — same call the narrative merge uses. The
   *  decided winners are kept fixed; only telling / reasoning / closure refresh. */
  const rerunShowdownRealism = useCallback(
    async (guidance: string, onProgress?: (text: string) => void) => {
      const pending = room?.round?.pendingMerge;
      if (!narrative || !room?.round || !pending) return;
      const round = room.round;
      const streamsById = narrative.streams ?? {};
      const contested = (round.settlements ?? []).filter((s) => s.contested);
      const conflicts = contested
        .map((s) => {
          const sids = s.threadId.split("|");
          const claims: { claimant: string; action: string; conviction: number }[] = [];
          for (const hand of Object.values(round.hands)) {
            for (const p of hand.played) {
              if (!sids.includes(p.card.streamId)) continue;
              const action = streamsById[p.card.streamId]?.outcomes?.[p.card.outcome];
              if (action) claims.push({ claimant: perspectiveName(narrative.perspectives?.[room.seats[hand.seatId]?.perspectiveId], narrative), action, conviction: p.conviction });
            }
          }
          return { id: s.threadId, question: streamsById[sids[0]]?.title ?? "", claims, decidedOutcome: pending.resolutions?.[sids[0]]?.outcome };
        })
        .filter((c) => c.claims.length > 0);
      if (conflicts.length === 0) return;
      const epoch = genEpochRef.current;
      saveRoom({ ...room, round: { ...round, generating: true, generatingLabel: "Re-judging realism" } });
      try {
        const headCtx = outlineContext(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
        const resos = await resolveConflictRealism({ conflicts, narrativeOutline: headCtx, guidance: guidance.trim() || undefined, onProgress, reasoningBudget: resolveReasoningBudget(narrative) });
        if (genEpochRef.current !== epoch) return; // GM cancelled — discard
        const byId: Record<string, RealismResolution> = Object.fromEntries(resos.map((x) => [x.id, x]));
        const resolutions = { ...pending.resolutions };
        for (const s of contested) {
          const real = byId[s.threadId];
          if (!real) continue;
          for (const sid of s.threadId.split("|")) {
            if (!resolutions[sid]) continue;
            resolutions[sid] = { ...resolutions[sid], telling: real.telling, reasoning: real.reasoning, closes: real.closes };
          }
        }
        saveRoom(logRoom({ ...room, round: { ...round, generating: false, pendingMerge: { ...pending, resolutions } } }, "resolve", "GM re-ran the realism pass"));
      } catch {
        saveRoom({ ...room, round: { ...round, generating: false } });
      }
    },
    [narrative, room, state.resolvedEntryKeys, state.viewState.currentSceneIndex, saveRoom, logRoom],
  );

  const foldSeat = useCallback(
    (seatId: string) => {
      const r = roomRef.current;
      if (!r?.round) return;
      // Folding = no commit; advance the turn if it's this seat's.
      if (r.round.activeSeat === seatId) {
        const next = nextActiveSeat(r.round);
        saveRoom({ ...r, round: { ...r.round, activeSeat: next } });
      }
    },
    [saveRoom],
  );

  // ── Table ──────────────────────────────────────────────────────────────────
  const sendChat = useCallback(
    (seatId: string, text: string, scope: GameChatMessage["scope"] = "global", locationId?: string) => {
      // Latest room — concurrent messages from different players must all survive.
      const r = roomRef.current;
      if (!r) return;
      const msg: GameChatMessage = { id: uid("msg"), scope, locationId, seatId, text, at: Date.now(), roundIndex: r.round?.index };
      saveRoom({ ...r, chat: [...r.chat, msg] });
    },
    [saveRoom],
  );

  const setGoal = useCallback(
    (seatId: string, goal: Goal) => {
      if (!room) return;
      const seat = room.seats[seatId];
      if (!seat) return;
      const goals = [...seat.goals.filter((g) => g.threadId !== goal.threadId), goal];
      saveRoom({ ...room, seats: { ...room.seats, [seatId]: { ...seat, goals } } });
    },
    [room, saveRoom],
  );

  // ── Write (work the model) — must happen before PLAY locks ──────────────────
  /** Add a prior to one of the seat's streams: scored by the AI (admissibility +
   *  evidence), applied to the stance, and the seat's dealt cards on that stream
   *  RE-PRICED (priors adjust cost via prompting). */
  const addPrior = useCallback(
    async (seatId: string, streamId: string, text: string) => {
      const r0 = roomRef.current;
      if (!narrative || !r0 || !text.trim()) return;
      // Write-phase protection: priors are authored ONLY during the write window.
      if (r0.round?.phase !== "write") return;
      const seat = r0.seats[seatId];
      const stream = narrative.streams?.[streamId];
      if (!seat || !stream?.outcomes) return;
      // Ownership invariant: a seat may only prior its OWN question.
      if (stream.perspectiveId !== seat.perspectiveId) return;
      const author = seat.memberId ?? seat.agentId ?? seatId;
      let updated: Stream;
      try {
        const scored = await scoreStreamPrior({
          question: stream.title,
          outcomes: stream.outcomes,
          currentProbs: streamProbs(stream),
          priorText: text.trim(),
          perspectiveLabel: perspectiveName(narrative.perspectives?.[stream.perspectiveId], narrative),
        });
        updated = applyStreamPrior(stream, {
          text: text.trim(),
          authorId: author,
          updates: scored.updates,
          logType: scored.logType,
          volumeDelta: scored.volumeDelta,
          addOutcomes: scored.addOutcomes,
        });
      } catch {
        updated = applyStreamPrior(stream, { text: text.trim(), authorId: author });
      }
      dispatch({ type: "UPSERT_STREAM", stream: updated });
      // Re-price the seat's dealt cards on this stream from the new stance — fold
      // onto the LATEST room (post-await), so concurrent priors don't clobber.
      const r = roomRef.current;
      if (!r) return;
      const round = r.round;
      const hand = round?.hands[seatId];
      const name = perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative);
      const base = round && hand
        ? {
            ...r,
            round: {
              ...round,
              hands: {
                ...round.hands,
                [seatId]: {
                  ...hand,
                  cards: hand.cards.map((c) =>
                    c.streamId === streamId
                      ? { ...c, cost: cardCost(streamProbs(updated)[c.outcome] ?? 0, r.economy) }
                      : c,
                  ),
                },
              },
            },
          }
        : r;
      saveRoom(logRoom(base, "prior", `${name} added a prior on "${stream.title}"`, seatId));
    },
    [narrative, dispatch, saveRoom, logRoom],
  );

  /** Open a NEW stream for the seat from a posed open question — the AI
   *  instantiates the candidate actions + stance, and fresh cards are dealt into
   *  the seat's hand. */
  const openNewStream = useCallback(
    async (seatId: string, question: string, intuition?: string) => {
      const r0 = roomRef.current;
      if (!narrative || !r0 || !question.trim()) return;
      // Write-phase protection: new streams open ONLY during the write window.
      if (r0.round?.phase !== "write") return;
      const seat = r0.seats[seatId];
      if (!seat) return;
      const persp = narrative.perspectives?.[seat.perspectiveId];
      const q = question.trim();
      const intu = intuition?.trim() || q;
      let stream: Stream;
      try {
        const inst = await instantiateStream({
          question: q,
          intuition: intu,
          perspectiveLabel: perspectiveName(persp, narrative),
          narrativeOutline: outlineContext(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex),
        });
        stream = openStream({
          perspectiveId: seat.perspectiveId,
          agentId: seat.agentId,
          memberId: seat.memberId,
          question: q,
          outcomes: inst.outcomes,
          priorProbs: inst.priorProbs,
          intuition: intu,
          branchId: r0.branchId,
        });
      } catch {
        stream = openStream({
          perspectiveId: seat.perspectiveId,
          agentId: seat.agentId,
          memberId: seat.memberId,
          question: q,
          outcomes: [...SEED_ACTIONS],
          intuition: intu,
          branchId: r0.branchId,
        });
      }
      dispatch({ type: "UPSERT_STREAM", stream });
      // Deal cards for the new stream into the seat's hand — fold onto the LATEST
      // room (post-await) so concurrent opens don't clobber.
      const r = roomRef.current;
      const round = r?.round;
      const hand = round?.hands[seatId];
      if (r && round && hand) {
        const dealtCards = dealHand(seatId, [stream], r.economy, () => uid("card"), new Set([stream.id])).cards;
        saveRoom({
          ...r,
          round: { ...round, hands: { ...round.hands, [seatId]: { ...hand, cards: [...hand.cards, ...dealtCards] } } },
        });
      }
    },
    [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex, dispatch, saveRoom],
  );

  // ── Inter-round GM controls (plan §5c) ──────────────────────────────────────
  const updateEconomy = useCallback(
    (patch: Partial<ConvictionEconomy>) => {
      if (room) saveRoom({ ...room, economy: { ...room.economy, ...patch } });
    },
    [room, saveRoom],
  );

  type SeatConfig = { perspectiveId: string; driver: Seat["driver"]; memberId?: string; agentId?: string; locationId: string };

  /** Seat new players mid-game (one or many in a single commit, so a multi-add
   *  doesn't clobber on a stale room snapshot). Each seat is added as `pending` —
   *  it shows on the rail/board straight away but doesn't get a hand or a turn
   *  until the NEXT round opens (the scoring→next-round advance promotes pending →
   *  playing, rebuilds the turn order around it, and that round's READ generates its
   *  perspective). New players bank the fresh economy.start; no carry-over. */
  const addSeats = useCallback(
    (cfgs: SeatConfig[]) => {
      if (!room || !narrative || cfgs.length === 0) return;
      const seats = { ...room.seats };
      const names: string[] = [];
      const newSeatIds: string[] = [];
      // A live round never gains a seat mid-flight (its turn order + hands are
      // already dealt); without a round we're between games → seat as playing.
      const status: Seat["status"] = room.round ? "pending" : "playing";
      cfgs.forEach((cfg, i) => {
        const seatId = uid("seat");
        seats[seatId] = {
          ...createSeat({ id: seatId, ...cfg, economy: room.economy, colorIndex: Object.keys(room.seats).length + i }),
          status,
        };
        newSeatIds.push(seatId);
        names.push(perspectiveName(narrative.perspectives?.[cfg.perspectiveId], narrative));
      });
      // If the table is already LIVE, mint a guest pass for each new seat so a
      // remote player can join it immediately (the Share modal lists it) — without
      // this, a mid-game human seat would have no token to connect through and
      // would gate the next round forever.
      const guestPasses = room.live
        ? [
            ...(room.guestPasses ?? []),
            ...newSeatIds.map((seatId) => ({
              token: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : uid("pass"),
              gameId: room.id,
              seatId,
              expiresAt: 0,
            })),
          ]
        : room.guestPasses;
      saveRoom(
        logRoom(
          { ...room, seats, ...(guestPasses ? { guestPasses } : {}) },
          "phase",
          status === "pending"
            ? `${names.join(", ")} seated — join next round`
            : `${names.join(", ")} seated`,
        ),
      );
    },
    [room, narrative, saveRoom, logRoom],
  );

  // Move — a CHARACTER seat updates its position. Movement is unrestricted: it's
  // a SIGNAL of where the character wants to be, which (a) re-scopes its location
  // chat (whisper) and (b) rides into the resolve merge so the Generate Panel
  // knows the intended move. Only character perspectives can move.
  const move = useCallback(
    (seatId: string, locationId: string) => {
      const r = roomRef.current;
      if (!r || !narrative) return;
      const seat = r.seats[seatId];
      if (!seat) return;
      if (narrative.perspectives?.[seat.perspectiveId]?.kind !== "character") return;
      const moved = { ...r, seats: { ...r.seats, [seatId]: { ...seat, locationId, movedThisRound: true } } };
      saveRoom(
        logRoom(
          moved,
          "move",
          `${perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative)} intends to move to ${narrative.locations[locationId]?.name ?? "elsewhere"}`,
          seatId,
        ),
      );
    },
    [narrative, saveRoom, logRoom],
  );

  // ── The GM one-click progression ────────────────────────────────────────────
  const advance = useCallback(async () => {
    if (!narrative || !room?.round || room.phase !== "round" || room.paused) return;
    const round = room.round;
    // Snapshot the generation epoch for this advance run. cancelGeneration()
    // bumps it; every await below re-checks via cancelled() and bails if the GM
    // pulled the plug, leaving the phase put so a re-click of Advance retries.
    const epoch = genEpochRef.current;
    const cancelled = () => genEpochRef.current !== epoch;

    const headCtx = outlineContext(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
    const tableEntityIds = seatedEntityIds(narrative, room);
    const entityContextOf = (perspectiveId: string): string =>
      renderEntityContext(narrative, perspectiveId, tableEntityIds);

    // The agent's HARD time budget for one decision, read off the play clock:
    // the per-move budget in sequential (the clock resets each turn), the time
    // left in the shared window in simultaneous. 0 = untimed → no bound (the
    // agent deliberates fully, the original behaviour).
    const agentDeadlineMs = (r: GameRoom): number => {
      const econ = r.economy;
      if (econ.playOrder === "simultaneous") {
        const budget = (econ.windowSeconds ?? 0) * 1000;
        if (budget <= 0 || r.round?.playStartedAt == null) return 0;
        return Math.max(0, r.round.playStartedAt + budget - Date.now());
      }
      const budget = (econ.turnSeconds ?? 0) * 1000; // per-move clock, fresh this turn
      return budget > 0 ? budget : 0;
    };

    // DECIDE (the slow part) — ask one agent seat, IN CHARACTER, which cards (if
    // any) to commit; it may pass and bank its conviction. Pure: returns the plays,
    // applies nothing. On any failure — or when the play clock runs out — it falls
    // back to the deterministic heuristic so an all-agent room always progresses
    // and no agent thinks past the timer. Safe to run concurrently (no shared state).
    const decideSeatPlays = async (r: GameRoom, seatId: string): Promise<AgentPlay[]> => {
      const seat = r.seats[seatId];
      if (!seat || !isAiControlled(seat) || !r.round) return []; // a CLAIMED agent is human-driven now
      const agent = resolveAgentById(narrative, seat.agentId);
      // Sequential play only: hand this seat the plays already committed this round
      // by OTHERS so it can read the table and respond (in simultaneous play every
      // seat acts off the same blank snapshot, in parallel — no table to read). A
      // face-down rival play exposes only its conviction + question, never the action.
      const streamsById = narrative.streams ?? {};
      const priorPlays =
        r.economy.playOrder === "sequential"
          ? Object.values(r.round.hands)
              .filter((h) => h.seatId !== seatId)
              .flatMap((h) =>
                h.played.map((p) => {
                  const stream = streamsById[p.card.streamId];
                  // Concealed (face-down, not yet revealed) hides the action from
                  // seats acting later — they see only that conviction was spent.
                  const concealed = !p.faceUp && !p.revealed;
                  return {
                    seat: perspectiveName(narrative.perspectives?.[r.seats[h.seatId]?.perspectiveId], narrative),
                    question: stream?.title ?? "a question",
                    action: concealed ? null : stream?.outcomes?.[p.card.outcome] ?? null,
                    conviction: p.conviction,
                    faceDown: concealed,
                  };
                }),
              )
          : [];
      // The deterministic snap-move — an instant, within-budget play from the
      // seat's own stance lean. Used on API failure AND when the play clock cuts
      // the agent off (below): the agent still acts, it just can't deliberate.
      const fallback = (): AgentPlay[] =>
        chooseAgentPlays(seat, r.round!.hands[seatId], r.economy, agent?.persona, streamProbsResolver(narrative.streams ?? {}));

      // The LLM decision, hardened so it never rejects (errors snap to the
      // deterministic move) — lets us race it cleanly against the clock.
      const decisionP: Promise<AgentPlay[]> = decideAgentPlays({
        seat,
        hand: r.round.hands[seatId],
        economy: r.economy,
        streamsById,
        perspectiveLabel: perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative),
        entityContext: entityContextOf(seat.perspectiveId),
        narrativeOutline: headCtx,
        persona: resolveAgentPersona(agent) || undefined,
        priorPlays,
        reasoningBudget: resolveReasoningBudget(narrative),
      })
        .then((d) => d.plays)
        .catch(() => fallback());

      // The play clock is a HARD bound on the agent, not just a display: when the
      // per-move budget (sequential) or the shared window (simultaneous) elapses,
      // the agent is CUT to its snap-move so it can never keep thinking past the
      // timer. An untimed room (budget 0) keeps the deliberate-fully behaviour.
      const deadline = agentDeadlineMs(r);
      if (deadline <= 0) return decisionP;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutP = new Promise<AgentPlay[]>((resolve) => {
        timer = setTimeout(() => resolve(fallback()), deadline);
      });
      const plays = await Promise.race([decisionP, timeoutP]);
      if (timer) clearTimeout(timer);
      return plays;
    };

    // Run agent decisions OFF the critical path during PLAY (simultaneous): every
    // agent decides in PARALLEL, and each one's play lands on the felt the MOMENT
    // its own decision resolves — not batched at the end — so cards (face-up or
    // face-down) appear one by one and the pod stops "thinking" as soon as it
    // commits. In computer mode the play clock paces the table (auto-advance) but
    // does NOT cut an agent off mid-think: a decision always completes, so no agent
    // silently holds. Each fold reads the LATEST room so a human commit survives.
    const runAgentsInBackground = (openedRoom: GameRoom, seatIds: string[]) => {
      const agents = seatIds.filter((id) => { const s = openedRoom.seats[id]; return s && isAiControlled(s); });
      if (!agents.length) return;
      // Flag the deciding agents so the board pulses a "thinking" tell over each pod.
      {
        const w0 = roomRef.current;
        if (w0?.round && w0.round.phase === "play")
          saveRoom({ ...w0, round: { ...w0.round, thinkingSeats: agents } });
      }
      for (const seatId of agents) {
        void decideSeatPlays(openedRoom, seatId).then((plays) => {
          let w = roomRef.current;
          if (!w?.round || w.round.phase !== "play" || cancelled()) return; // window closed/cancelled
          for (const p of plays) w = applyPlay(narrative, w, seatId, p.cardId, p.conviction, !p.faceDown);
          if (!w.round) return;
          const stillThinking = (w.round.thinkingSeats ?? []).filter((s) => s !== seatId);
          saveRoom({ ...w, round: { ...w.round, thinkingSeats: stillThinking } });
        });
      }
    };

    // Walk the turn order from `fromActive`, auto-playing agent seats, stopping
    // at the first MANUAL seat (human / gm-proxy) the GM must play, or null at end.
    const runAgentTurns = async (r: GameRoom, fromActive: string | null): Promise<{ room: GameRoom; active: string | null }> => {
      const roundIndex = r.round!.index;
      let active = fromActive;
      while (active) {
        // Work from the latest committed room (roomRef tracks it synchronously, so
        // a human commit made meanwhile survives); stop if the window closed or the
        // round rolled over.
        const base = roomRef.current ?? r;
        if (!base.round || base.round.phase !== "play" || base.round.index !== roundIndex) break;
        const seat = base.seats[active];
        if (!seat || !isAiControlled(seat)) break; // manual seat (human OR a claimed agent): their turn
        if (cancelled()) break; // GM cancelled mid-drain — stop deciding more agents
        const deciding = active;
        // Sequential play: the turn marker AND the thinking indicator both land on
        // the acting agent, so the table reads "it's this AI's turn, it's moving"
        // — one agent at a time, the counter on whoever is up. The per-move clock
        // resets to this turn (turnStartedAt) so each player gets their full budget.
        saveRoom({ ...base, round: { ...base.round, activeSeat: deciding, thinkingSeats: [deciding], turnStartedAt: Date.now() } });
        // The agent decides FULLY — the per-move clock paces the table (and bounds
        // human turns), it never cuts an agent off mid-think (computer mode).
        const decision = await decideSeatPlays(base, deciding);
        if (cancelled()) break;
        const live = roomRef.current ?? base;
        if (!live.round || live.round.phase !== "play") break;
        const next = nextActiveSeat({ ...live.round, activeSeat: deciding });
        let played = live;
        for (const p of decision) played = applyPlay(narrative, played, deciding, p.cardId, p.conviction, !p.faceDown);
        // Commit the agent's move, pass the turn on, and start the next seat's clock.
        saveRoom({ ...played, round: { ...played.round!, activeSeat: next, thinkingSeats: [], turnStartedAt: Date.now() } });
        active = next;
      }
      const room = roomRef.current ?? r;
      return { room, active };
    };

    // Head scene to deliver perspectives off this round — the latest scene on
    // the branch (round 1 narrates the current head; later rounds narrate the
    // prior round's continuation, now the head).
    const headSceneId = (() => {
      for (let i = state.resolvedEntryKeys.length - 1; i >= 0; i--) {
        const k = state.resolvedEntryKeys[i];
        if (narrative.scenes[k]) return k;
      }
      return undefined;
    })();
    // Perspectives are arc-scoped — the round's brief is over the head scene's
    // whole ARC (the continuation generated last resolve), not a single scene.
    const headArc = headSceneId ? narrative.arcs[narrative.scenes[headSceneId]?.arcId ?? ""] : undefined;

    // READ (phase id `read`) — on ENTRY, the (Perspective Gen): generate the
    // arc's public account + each SEATED player's private view (off-clock). The
    // game's participants are the SEATS, not just the arc's participants — every
    // seated entity gets a lens (an entity absent from the whole arc gets an
    // offstage "elsewhere" account). Each key is generated only if ABSENT —
    // re-entry or a seat added mid-game just fills the gaps — and all fire in
    // parallel. Once delivered, READ is the brief; ADVANCING snapshots ℓ⁻
    // (pre-write) and opens WRITE.
    if (round.phase === "read") {
      // PRESENCE GATE — the table can't start the round / generate perspectives
      // until every human MEMBER is present (online AND readied). Agents are present
      // by default. A mid-game joiner re-arms this gate for the next round. The GM
      // stays in READ; once everyone's in, Advance proceeds. (A table with no Member
      // seats — all agent / gm-proxy — never gates.)
      const waiting = unreadyHumanSeats(room);
      if (waiting.length > 0) {
        showToast(`Waiting on ${waitingLabel(waiting, narrative)}`, "warning");
        return;
      }
      // Stamp the head arc with the prior round's scoring feedback (per entity),
      // once, so BOTH the game perspectives panel and the narrative Perspectives
      // tab can show each seat its Impact + reason alongside the perspective — the
      // "score reveal" carried into the read. Built from seats' lastImpact (set at
      // the prior SCORING). Skipped on round 1 (no prior scoring).
      if (headArc && !headArc.scoreFeedback) {
        const fb: Record<string, { impact: number; reason: string }> = {};
        for (const seat of Object.values(room.seats)) {
          const e = narrative.perspectives?.[seat.perspectiveId]?.entityRef;
          if (e && seat.lastImpact != null) fb[e] = { impact: seat.lastImpact, reason: seat.lastImpactReason ?? "" };
        }
        if (Object.keys(fb).length > 0) dispatch({ type: "SET_ARC_SCORE_FEEDBACK", arcId: headArc.id, feedback: fb });
      }
      // Generate only the lenses the arc is still MISSING — re-entry or a mid-game
      // seat fills gaps, never rewrites a perspective that already exists.
      const missingKeys = headArc ? missingRoomPerspectiveKeys(room, narrative, headArc) : [];
      if (headArc && missingKeys.length > 0) {
        saveRoom({ ...room, round: { ...round, generating: true, generatingLabel: "Delivering perspectives" } });
        const arcId = headArc.id;
        // Stream each (long) perspective call into the Perspectives UI — the panel
        // listens for `game:perspective-stream` to show the reasoning + text build
        // live, per key, then reads the persisted view once `status: "done"`.
        const emit = (key: string, detail: { text?: string; reasoning?: string; status: "start" | "stream" | "done" }) =>
          window.dispatchEvent(new CustomEvent("game:perspective-stream", { detail: { arcId, key, ...detail } }));
        await Promise.all(
          missingKeys.map(async (key) => {
            emit(key, { text: "", reasoning: "", status: "start" });
            let text = "";
            let reasoning = "";
            try {
              const finalText = await generateArcPerspective(narrative, headArc, key, state.resolvedEntryKeys, {
                onToken: (_t, acc) => { if (cancelled()) return; text = acc; emit(key, { text, reasoning, status: "stream" }); },
                onReasoning: (_t, acc) => { if (cancelled()) return; reasoning = acc; emit(key, { text, reasoning, status: "stream" }); },
              });
              if (!cancelled()) dispatch({ type: "SET_ARC_PERSPECTIVE", arcId, view: { key, label: perspectiveLabel(narrative, key), text: finalText, generatedAt: Date.now() } });
            } catch {
              /* best-effort per key */
            } finally {
              emit(key, { status: "done" });
            }
          }),
        );
        if (cancelled()) return; // GM cancelled — stay in READ; Advance retries
        saveRoom(
          logRoom(
            { ...room, round: { ...round, generating: false, readStartedAt: Date.now(), continuationSceneId: headSceneId ?? round.continuationSceneId } },
            "phase",
            `Round ${round.index + 1} — perspectives delivered`,
          ),
        );
        return;
      }
      // Perspectives read → (Stream & Intuition Gen): seed each seat's candidate
      // streams + opening intuitions and PRICE + DEAL the cards (off-clock), so
      // the WRITE phase opens with the distributions + playable cards ALREADY in
      // hand — players then refine them (add priors, open streams), re-pricing
      // their cards. ℓ⁻ is snapshotted over the post-seed stance so write-time
      // moves (and PLAY) are the attributed shift.
      saveRoom({ ...room, round: { ...round, generating: true, generatingLabel: "Seeding streams & dealing" } });
      const headCtx = outlineContext(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
      const tableEntityIds = seatedEntityIds(narrative, room);
      const entityContextOf = (perspectiveId: string): string =>
        renderEntityContext(narrative, perspectiveId, tableEntityIds);

      const ownedBySeat: Record<string, Stream[]> = {};
      for (const seat of Object.values(room.seats)) ownedBySeat[seat.id] = ownedStreams(narrative, room, seat);

      // Seed each seat that has NO open stream with ONE perspective-generated
      // stream — the existing stream interface (generateSeatStream): a question +
      // gut intuition + candidate actions + stance distribution, which prices the
      // dealt cards. One stream keeps the hand focused and the round manageable.
      // Generated in parallel across seats; NO hard-coded fallback — streams are
      // always perspective-authored, so a seat whose gen fails simply gets no
      // candidate this round (it can still open its own in WRITE).
      const generated: Stream[] = [];
      await Promise.all(
        Object.values(room.seats).map(async (seat) => {
          if (ownedBySeat[seat.id].length > 0) return; // already has a stream to work
          const persp = narrative.perspectives?.[seat.perspectiveId];
          const label = perspectiveName(persp, narrative);
          const entityCtx = entityContextOf(seat.perspectiveId);
          const persona =
            seat.driver === "agent"
              ? resolveAgentPersona(resolveAgentById(narrative, seat.agentId)) || undefined
              : undefined;
          try {
            const seed = await generateSeatStream({
              perspectiveLabel: label,
              entityContext: entityCtx,
              narrativeOutline: headCtx,
              personaContext: persona,
              // Reasoning-FREE, matching the narrative UI's new-stream calls
              // (instantiateStream / suggestQuestion / suggestIntuition all run at
              // budget 0 on the default model). The thinking budget was the cost —
              // seeding fires once per seat per round, so it must stay cheap.
              reasoningBudget: 0,
            });
            const stream = openStream({
              perspectiveId: seat.perspectiveId,
              agentId: seat.agentId,
              memberId: seat.memberId,
              question: seed.question,
              outcomes: seed.outcomes,
              priorProbs: seed.priorProbs,
              intuition: seed.intuition,
              intuitionLogType: seed.logType,
              branchId: room.branchId,
            });
            generated.push(stream);
            ownedBySeat[seat.id].push(stream);
          } catch {
            /* gen failed → no seeded candidate this round (perspective-authored only) */
          }
        }),
      );
      if (cancelled()) return; // GM cancelled — no streams seeded; Advance retries
      for (const s of generated) dispatch({ type: "UPSERT_STREAM", stream: s });
      const dealtIds = new Set(generated.map((s) => s.id));

      const hands: Record<string, Hand> = {};
      const allOwned: Stream[] = [];
      for (const seat of Object.values(room.seats)) {
        allOwned.push(...ownedBySeat[seat.id]);
        hands[seat.id] = dealHand(seat.id, ownedBySeat[seat.id], room.economy, () => uid("card"), dealtIds);
      }
      // Cards dealt → open the WRITE window (its clock starts). ℓ⁻ snapshots the
      // post-seed stance so write-time moves + PLAY are the attributed shift.
      saveRoom(
        logRoom(
          {
            ...room,
            round: {
              ...round,
              generating: false,
              phase: "write",
              writeStartedAt: Date.now(),
              hands,
              threadLogitsAtStart: snapshotThreadLogits(allOwned),
              continuationSceneId: headSceneId ?? round.continuationSceneId,
            },
          },
          "phase",
          `Round ${round.index + 1} — streams seeded, cards dealt; write window open`,
        ),
      );
      return;
    }

    // WRITE (phase id `write`) — players refine the seeded streams (add priors,
    // open new streams, re-pricing their dealt cards). ADVANCING opens PLAY.
    //
    // Unlike READ / WRITE / RESOLVE — where generation is a blocking gate — PLAY
    // opens IMMEDIATELY: the clock starts, hands go live, and agents are NOT a
    // blocker. They decide in the BACKGROUND while humans act; their plays land
    // when ready, folded onto the latest room so a human commit made meanwhile is
    // never clobbered. So the GM's "deal & open play" click never waits on agents.
    //
    // "simultaneous" — all seats act at once; activeSeat stays null so every hand
    // is live. "sequential" — deal-order turn rotation (first seat up; a seat can
    // commit/end its turn early).
    if (round.phase === "write") {
      const simultaneous = room.economy.playOrder === "simultaneous";
      const first = simultaneous ? null : round.turnOrder[0] ?? null;
      const opened: GameRoom = {
        ...room,
        round: { ...round, phase: "play", generating: false, activeSeat: first, playStartedAt: Date.now(), turnStartedAt: Date.now() },
      };
      saveRoom(
        logRoom(opened, "phase", `Round ${round.index + 1} — play opens${simultaneous ? " (simultaneous)" : ""}`),
      );
      // Fan the agents out off-clock.
      if (simultaneous) {
        // Every agent seat decides at once; plays fold onto the latest room.
        runAgentsInBackground(opened, round.turnOrder);
      } else if (first && opened.seats[first] && isAiControlled(opened.seats[first])) {
        // Ordered: drain the leading run of agents in the background, advancing the
        // turn pointer to the first manual seat (no human acts during agent turns,
        // so this bases on the opened snapshot; dropped if play has since closed).
        void (async () => {
          const { room: drained, active } = await runAgentTurns(opened, first);
          const latest = roomRef.current;
          if (!latest?.round || latest.round.phase !== "play" || latest.round.index !== round.index) return;
          if (cancelled()) return; // GM cancelled — discard the drained agent plays
          saveRoom({ ...drained, round: { ...drained.round!, activeSeat: active } });
        })();
      }
      return;
    }

    // PLAY → the active seat is a MANUAL seat the GM has just finished (it played
    // via the hand UI); advancing moves past it and auto-drains the next agents,
    // stopping at the next manual seat or → RESOLVE when the order is exhausted.
    if (round.phase === "play") {
      let working = room;
      let active = round.activeSeat;
      if (active) {
        const next = nextActiveSeat(round);
        // Agents decide via LLM (off-clock) — flag generating while they think.
        if (next) saveRoom({ ...room, round: { ...round, generating: true, generatingLabel: "Agents deciding" } });
        const drained = await runAgentTurns(working, next);
        if (cancelled()) return; // GM cancelled the agent drain — discard, stay in PLAY
        working = { ...drained.room, round: { ...drained.room.round!, generating: false } };
        active = drained.active;
      }
      if (!active) {
        // PLAY done → DETERMINE FINAL OUTCOMES. Group committed streams by their
        // open question; where two seats back the SAME question with DIFFERENT
        // actions it's a conflict → settle by seeded draw (per RESOLVE_BIAS) and
        // the raise (conviction above cost) is consumed as draw insurance. An
        // UNCONTESTED claim just stands and its raise is REFUNDED (no draw → no
        // insurance claim). The resolved merge is built automatically and handed
        // to the GM's Generate Panel.
        const streamsById = narrative.streams ?? {};
        const r = working.round!;
        type Committed = {
          streamId: string;
          seatId: string;
          outcomeStr: string;
          conviction: number;
          baseCost: number;
        };
        const committed: Committed[] = [];
        for (const hand of Object.values(r.hands)) {
          const byStream = new Map<string, PlayedCard[]>();
          for (const p of hand.played) {
            const arr = byStream.get(p.card.streamId) ?? [];
            arr.push(p);
            byStream.set(p.card.streamId, arr);
          }
          for (const [sid, plays] of byStream) {
            const stream = streamsById[sid];
            if (!stream?.outcomes) continue;
            const byOutcome = new Map<number, number>();
            let conviction = 0;
            let baseCost = 0;
            for (const p of plays) {
              byOutcome.set(p.card.outcome, (byOutcome.get(p.card.outcome) ?? 0) + p.conviction);
              conviction += p.conviction;
              baseCost += p.card.cost;
            }
            const backed = [...byOutcome.entries()].sort((a, b) => b[1] - a[1])[0][0];
            committed.push({ streamId: sid, seatId: hand.seatId, outcomeStr: stream.outcomes[backed], conviction, baseCost });
          }
        }
        // Conflict detection is an AI call (the resolver's one semantic step):
        // which committed actions can't both hold in the canon. It's generation,
        // so flag the off-clock blocker while it runs.
        const byId: Record<string, Committed> = Object.fromEntries(committed.map((c) => [c.streamId, c]));
        let conflictGroups: string[][] = [];
        if (committed.length >= 2) {
          saveRoom({ ...working, round: { ...r, generating: true, generatingLabel: "Reading the table" } });
          try {
            conflictGroups = await detectConflicts({
              claims: committed.map((c) => ({
                id: c.streamId,
                perspective: perspectiveName(narrative.perspectives?.[room.seats[c.seatId]?.perspectiveId], narrative),
                question: streamsById[c.streamId]?.title ?? "",
                action: c.outcomeStr,
              })),
              reasoningBudget: resolveReasoningBudget(narrative),
            });
          } catch {
            conflictGroups = []; // best-effort → nothing contested, claims stand
          }
          if (cancelled()) return; // GM cancelled the conflict read — stay in PLAY
        }
        const conflictedIds = new Set(conflictGroups.flat());

        const resolutions: Record<string, MergeResolution> = {};
        const refunds: Record<string, number> = {};
        const settlements: ThreadSettlement[] = [];

        // Pre-pass — compute each contested group's odds + the WINNER chosen by
        // the room's rule: a seeded draw (random) or the rarest (highest-cost)
        // pick the winner NOW; `realism` defers it to the judge (decidedOutcome
        // stays undefined). Degenerate same-action "conflicts" drop to uncontested.
        type GroupCalc = {
          key: string;
          members: Committed[];
          outcomes: string[];
          pStar: number[];
          seed: number | null;
          fallbackIdx: number;
          decidedOutcome?: string;
        };
        const calcs: GroupCalc[] = [];
        for (const group of conflictGroups) {
          const members = group.map((id) => byId[id]).filter(Boolean);
          const outcomes = [...new Set(members.map((m) => m.outcomeStr))];
          if (members.length < 2 || outcomes.length < 2) {
            for (const id of group) conflictedIds.delete(id);
            continue;
          }
          const nudges = outcomes.map((o) =>
            members
              .filter((m) => m.outcomeStr === o)
              .reduce((s, m) => s + playLogitNudge(m.conviction, m.baseCost || 1, room.economy), 0),
          );
          const seed = settlementSeed(r.index + 1, r.index, group.join("|"));
          const res = settleContest(room.economy.resolveBias, outcomes.map(() => 0), nudges, seed);
          const fallbackIdx = res.pStar.reduce((bi, p, i, arr) => (p > arr[bi] ? i : bi), 0);
          // res.drawnOutcome is set for random/highest-cost, null for realism.
          const decidedOutcome = res.drawnOutcome != null ? outcomes[res.drawnOutcome] : undefined;
          calcs.push({ key: group.join("|"), members, outcomes, pStar: res.pStar, seed: res.seed ?? null, fallbackIdx, decidedOutcome });
        }

        // UNIVERSAL realism interpretation — runs for EVERY contested group, in
        // ONE high-context call, regardless of how the winner was chosen. Dice /
        // rule modes pass the decided winner (the judge interprets reality around
        // it); realism mode leaves it open (the judge picks too). Telling +
        // reasoning + closure enrich the merge and are GM-vetoable. Best-effort.
        const realismById: Record<string, RealismResolution> = {};
        if (calcs.length > 0) {
          try {
            const resos = await resolveConflictRealism({
              conflicts: calcs.map((c) => ({
                id: c.key,
                question: streamsById[c.members[0].streamId]?.title ?? "",
                claims: c.members.map((m) => ({
                  claimant: perspectiveName(narrative.perspectives?.[room.seats[m.seatId]?.perspectiveId], narrative),
                  action: m.outcomeStr,
                  conviction: m.conviction,
                })),
                ...(c.decidedOutcome ? { decidedOutcome: c.decidedOutcome } : {}),
              })),
              narrativeOutline: headCtx,
              reasoningBudget: resolveReasoningBudget(narrative),
            });
            for (const x of resos) realismById[x.id] = x;
          } catch {
            // Best-effort — the merge still resolves on the chosen winner.
          }
          if (cancelled()) return; // GM cancelled the realism pass — stay in PLAY
        }

        // Apply — the winner is the rule's pick (dice / rarest) or, in realism
        // mode, the judge's; the realism telling/reasoning/closure rides onto the
        // merge so generation gets a clear, reasoned call.
        for (const c of calcs) {
          const realism = realismById[c.key];
          const realismIdx = realism ? c.outcomes.indexOf(realism.outcome) : -1;
          const winIdx =
            c.decidedOutcome != null ? c.outcomes.indexOf(c.decidedOutcome) : realismIdx >= 0 ? realismIdx : c.fallbackIdx;
          const winOutcome = c.outcomes[winIdx] ?? c.outcomes[0];
          for (const m of c.members)
            resolutions[m.streamId] = {
              outcome: winOutcome,
              overridden: m.outcomeStr !== winOutcome,
              ...(realism?.telling ? { telling: realism.telling } : {}),
              ...(realism?.reasoning ? { reasoning: realism.reasoning } : {}),
              ...(realism?.closes ? { closes: true } : {}),
            };
          settlements.push({ threadId: c.key, contested: true, outcomes: c.outcomes, pStar: c.pStar, seed: c.seed ?? undefined, drawnOutcome: winIdx });
        }

        // Everything not in a conflict stands; refund its raise (no draw → the
        // insurance is returned).
        for (const c of committed) {
          if (conflictedIds.has(c.streamId)) continue;
          resolutions[c.streamId] = { outcome: c.outcomeStr };
          const raise = Math.max(0, c.conviction - c.baseCost);
          if (raise > 0) refunds[c.seatId] = (refunds[c.seatId] ?? 0) + raise;
        }
        const seats = { ...working.seats };
        for (const [sid, amt] of Object.entries(refunds)) {
          if (seats[sid]) seats[sid] = { ...seats[sid], conviction: seats[sid].conviction + amt };
        }
        // Movement signals — characters who updated their position this round.
        // playerMovements (characterId → target locationId) rides on the merge so
        // the continuation places them there via participation; the summary keeps
        // a human-readable echo.
        const playerMovements: Record<string, string> = {};
        const moveEchoes: string[] = [];
        for (const s of Object.values(working.seats)) {
          const persp = narrative.perspectives?.[s.perspectiveId];
          if (!s.movedThisRound || persp?.kind !== "character" || !persp.entityRef) continue;
          playerMovements[persp.entityRef] = s.locationId;
          moveEchoes.push(`${perspectiveName(persp, narrative)} → ${narrative.locations[s.locationId]?.name ?? "elsewhere"}`);
        }
        const pendingMergeForRound: ProposedMerge = {
          // Deterministic id keyed by room + round so this round commits to
          // EXACTLY ONE merge — if the resolve panel mounts or regenerates more
          // than once for the same round, every commit overwrites this same
          // entry instead of minting a fresh duplicate ("3 merges for round 1").
          id: `merge-${room.id}-r${r.index}`,
          streamIds: committed.map((c) => c.streamId),
          resolutions,
          branchId: room.branchId,
          summary: `Conviction round ${r.index + 1} merge${moveEchoes.length ? ` · Moves: ${moveEchoes.join("; ")}` : ""}`,
          ...(Object.keys(playerMovements).length > 0 ? { playerMovements } : {}),
        };
        // SHOWDOWN reveal flags: every committed card flips face-up; a concealed
        // card whose stream a contest forced open is marked forcedReveal (its
        // premium is consumed — the uncontested refund above already returned the
        // premium for concealed claims that stood). The board animates the flip.
        const revealedHands: Record<string, Hand> = {};
        for (const [sid, hand] of Object.entries(r.hands)) {
          revealedHands[sid] = {
            ...hand,
            played: hand.played.map((p) => ({
              ...p,
              revealed: true,
              forcedReveal: !p.faceUp && conflictedIds.has(p.card.streamId),
            })),
          };
        }
        const contested = settlements.filter((s) => s.contested).length;
        // Commits → SHOWDOWN (reveal + resolve conflicts together, watched on the
        // board) BEFORE arc generation. No commits → nothing to reveal; resolve.
        const hasCommitted = committed.length > 0;
        working = logRoom(
          {
            ...working,
            seats,
            round: {
              ...r,
              hands: revealedHands,
              phase: hasCommitted ? "showdown" : "resolve",
              activeSeat: null,
              generating: false,
              pendingMerge: pendingMergeForRound,
              settlements,
            },
          },
          hasCommitted ? "phase" : "resolve",
          hasCommitted
            ? `Round ${r.index + 1} — showdown: ${committed.length} stream${committed.length === 1 ? "" : "s"} committed${contested ? `, ${contested} contested (settled by ${room.economy.resolveBias})` : ""}`
            : `Round ${r.index + 1} — no commits; resolving`,
        );
      }
      saveRoom(working);
      return;
    }

    // SHOWDOWN → the reveal has been watched on the board; advance into RESOLVE.
    if (round.phase === "showdown") {
      saveRoom(logRoom({ ...room, round: { ...round, phase: "resolve" } }, "phase", `Round ${round.index + 1} — showdown complete; resolving`));
      return;
    }

    // SCORING → the Impact reveal has been watched on the board; advancing opens
    // the NEXT round. The feedback also persists into the next perspective.
    if (round.phase === "scoring") {
      // PRESENCE GATE at the round boundary — a round can't roll to the next until
      // every human member is ready. Un-readying mid-round never stopped THIS round
      // (the gate only sits at boundaries), but the NEXT one waits here, on the
      // scoreboard, until everyone (incl. a mid-game joiner) is back in.
      const waiting = unreadyHumanSeats(room);
      if (waiting.length > 0) {
        showToast(`Waiting on ${waitingLabel(waiting, narrative)} before the next round`, "warning");
        return;
      }
      // Promote anyone who joined mid-game (pending) to a full player now — the new
      // round rebuilds the turn order (rotating the button) and READ→WRITE deals
      // them a hand + seeds their stream + generates their perspective. Without this
      // a mid-game arrival would stay "pending" forever, never properly integrated.
      const seats = Object.fromEntries(
        Object.entries(room.seats).map(([id, s]) => [id, s.status === "pending" ? { ...s, status: "playing" as const } : s]),
      );
      const next = { ...room, seats };
      saveRoom({ ...next, round: startRound(next, round.index + 1, round.openThreadIds) });
      return;
    }

    // RESOLVE is GM-driven via the Generate Panel (it commits the merge built
    // from players' card-resolutions + generates the continuation). The UI
    // surfaces the panel; `completeResolve()` runs SETTLE + SCORE, stamps each
    // seat's Impact feedback, and opens the NEXT round immediately on generate
    // (the feedback rides in the next perspective). So advancing does nothing here.
  }, [narrative, room, state.resolvedEntryKeys, state.viewState.currentSceneIndex, dispatch, saveRoom, logRoom, ownedStreams, applyPlay, showToast]);

  /** The merge the GM resolves through the Generate Panel — determined at
   *  PLAY→RESOLVE (contested threads settled, uncontested claims standing).
   *  Null until RESOLVE or when no cards were committed. */
  const pendingMerge = useMemo(() => {
    if (!room?.round || room.round.phase !== "resolve") return null;
    const m = room.round.pendingMerge;
    return m && m.streamIds.length > 0 ? m : null;
  }, [room]);

  /** Mirror the GM's RESOLVE Generate-Panel loading onto the round so the board
   *  shows the spinner to players while the continuation is being generated (the
   *  panel itself is a GM-only popup). No-op outside RESOLVE. */
  const setResolveGenerating = useCallback(
    (on: boolean) => {
      if (!room?.round || room.round.phase !== "resolve") return;
      if (!!room.round.generating === on) return;
      saveRoom({ ...room, round: { ...room.round, generating: on, generatingLabel: on ? "Writing the continuation" : undefined } });
    },
    [room, saveRoom],
  );

  /** Close RESOLVE after the Generate Panel has run: SETTLE the economy (decay/tax
   *  + income), SCORE the round off the REALIZED outcome (the generated arc's
   *  bearing, not merely what was bet), bank Impact, stamp each seat's per-round
   *  feedback (surfaced with the next perspective), and open the next round
   *  IMMEDIATELY — the feedback rides in the perspective, so there's no separate
   *  scoring screen to wait on. */
  const completeResolve = useCallback(async () => {
    if (!narrative || !room?.round || room.round.phase !== "resolve") return;
    const round = room.round;
    // Participation is the source of truth for position: after the continuation
    // generated, recompute where each character actually is (the locationId of
    // the most recent scene they participate in) and re-sync the seat. Movement
    // intent that the LLM realised becomes the new tracked position; intent it
    // didn't realise quietly lapses (movement was a signal, not a teleport).
    const positions = computeCumulativePositions(
      narrative,
      state.resolvedEntryKeys,
      state.resolvedEntryKeys.length - 1,
    );

    // SCORING — attribute REALIZED Fate off the GENERATED continuation. An AI
    // judge reads how each thread actually moved (the realism telling is the
    // resolved log) and emits, per thread, the realized stance + each seat's
    // DRIVE (∈ [0,1]) on that movement + a per-seat reasoning clause. Because the
    // AI's share is `drive · Δℓ_realized` (a non-negative multiple of the realized
    // direction), each seat's credit `v·∫⟨share,g⟩ = drive·v·KL ≥ 0` — so Impact
    // reads as a positive contribution to Fate. The unexplained remainder is the
    // Fate house band. Falls back to the deterministic attribution if the call
    // fails (that one is SIGNED — a bet against the realized shift can go negative,
    // which is the honest math, just less intuitive).
    const resolutions = round.pendingMerge?.resolutions ?? {};
    const owner = ownerSeatByStream(round);
    // Every live question this round, mapped to its seat — INCLUDING the ones a
    // seat held (was dealt but committed no card). Non-action is a stance we still
    // score: a player's mere presence at a question is a decision to hold, judged
    // against how the continuation actually landed. (`owner` above stays played-
    // only for the deterministic fallback; the AI path scores the fuller set.)
    const ownerAll = new Map<string, string>();
    for (const hand of Object.values(round.hands)) {
      for (const card of hand.cards) if (!ownerAll.has(card.streamId)) ownerAll.set(card.streamId, hand.seatId);
    }
    const seatName = (seatId: string) => perspectiveName(narrative.perspectives?.[room.seats[seatId]?.perspectiveId], narrative);
    // Conviction a seat committed on a stream this round (sum of its played cards).
    const convictionOn = (seatId: string, streamId: string) =>
      (round.hands[seatId]?.played ?? []).filter((p) => p.card.streamId === streamId).reduce((s, p) => s + p.conviction, 0);
    // A digest of what the round's continuation did — shared context so a HELD
    // question (no resolution of its own) can still be placed: did the world move
    // it while its owner stood pat?
    const continuationSummary = Object.entries(resolutions)
      .map(([sid, r]) => `• ${narrative.streams?.[sid]?.title ?? sid} → ${r.telling?.trim() || r.outcome || "(resolved)"}`)
      .join("\n");

    // Deterministic fallback: realized ≈ the committed outcome, share = the seat's
    // own play push. Used only if the AI scoring call fails, so a round always scores.
    const deterministicAttributions = (): ThreadAttribution[] => {
      const out: ThreadAttribution[] = [];
      for (const [streamId, seatId] of owner) {
        const stream = narrative.streams?.[streamId];
        if (!stream?.stance) continue;
        const playLogits = stream.stance.logits;
        const before = round.threadLogitsAtStart?.[streamId] ?? stream.openingLogits ?? new Array(playLogits.length).fill(0);
        const outcome = resolutions[streamId]?.outcome;
        const realized = outcome
          ? applyStreamPrior(stream, { text: `Realized: ${outcome}`, authorId: "__fate__", updates: [{ outcome, evidence: STANCE_EVIDENCE_MAX }] }).stance?.logits ?? playLogits
          : playLogits;
        const n = Math.max(before.length, playLogits.length, realized.length);
        const pad = (v: number[]) => (v.length === n ? v : [...v, ...Array(n - v.length).fill(-12)]);
        const lm = pad(before);
        const lpPlay = pad(playLogits);
        out.push({ threadId: streamId, logitsBefore: lm, logitsAfter: pad(realized), volume: stream.stance.volume, shares: { [seatId]: lpPlay.map((x, k) => x - lm[k]) } });
      }
      return out;
    };

    // The AI scoring read (one thread per owned stream, grounded in the realized log).
    let reads: ThreadScoringRead[] = [];
    try {
      const inputs: ThreadScoringInput[] = [];
      for (const [streamId, seatId] of ownerAll) {
        const stream = narrative.streams?.[streamId];
        if (!stream?.outcomes) continue;
        const res = resolutions[streamId];
        const cv = convictionOn(seatId, streamId);
        const acted = cv > 0;
        inputs.push({
          threadId: streamId,
          question: stream.title,
          outcomes: stream.outcomes,
          logitsBefore: round.threadLogitsAtStart?.[streamId] ?? stream.openingLogits ?? stream.outcomes.map(() => 0),
          resolvedLog: acted
            ? res?.telling ?? (res?.outcome ? `Committed outcome: ${res.outcome}` : "(no resolution recorded)")
            : "(owner HELD — committed no card; judge from the continuation whether this question held to its prior or moved on its own)",
          resolutions: [{ seatId, name: seatName(seatId), backed: acted ? res?.outcome ?? "(none)" : "(held — no action)", conviction: cv, acted }],
        });
      }
      if (inputs.length > 0) reads = await scoreThreadsWithAI(inputs, 0, continuationSummary);
    } catch {
      reads = [];
    }

    const attributions: ThreadAttribution[] = reads.length
      ? reads.map((r) => {
          const stream = narrative.streams?.[r.threadId];
          const before = round.threadLogitsAtStart?.[r.threadId] ?? stream?.openingLogits ?? r.logitsAfter.map(() => 0);
          return { threadId: r.threadId, logitsBefore: before, logitsAfter: r.logitsAfter, volume: stream?.stance?.volume ?? 1, shares: r.shares };
        })
      : deterministicAttributions();
    const score = scoreRound(attributions);

    // Per-seat feedback — Impact + a reason. Prefer the AI's per-seat clause on the
    // seat's biggest-credit thread; fall back to a deterministic line. Stamped on
    // the seat so the NEXT round's perspective reads "what it earned" with the arc.
    const aiReasonFor = (seatId: string): string | undefined => {
      let best: { reason: string; credit: number } | undefined;
      for (const r of reads) {
        const clause = r.perSeat.find((p) => p.seatId === seatId)?.reasoning?.trim();
        if (!clause) continue;
        const credit = Math.abs(score.threads.find((t) => t.threadId === r.threadId)?.fateCredits[seatId] ?? 0);
        if (!best || credit > best.credit) best = { reason: clause, credit };
      }
      return best?.reason;
    };
    const feedbackFor = (seatId: string): { impact: number; reason: string } => {
      const impact = score.perSeat[seatId] ?? 0;
      const ai = aiReasonFor(seatId);
      if (ai) return { impact, reason: ai };
      const top = score.threads
        .filter((t) => Math.abs(t.fateCredits[seatId] ?? 0) > 1e-6)
        .sort((a, b) => Math.abs(b.fateCredits[seatId]!) - Math.abs(a.fateCredits[seatId]!))[0];
      if (!top) return { impact, reason: "your streams held — no Fate moved" };
      const q = narrative.streams?.[top.threadId]?.title ?? "your move";
      const won = (top.fateCredits[seatId] ?? 0) >= 0;
      return { impact, reason: won ? `your read on “${q}” paid off` : `the table turned against your call on “${q}”` };
    };

    // SETTLE — decay/tax then income per seat; re-sync position; reset move flag;
    // bank Impact; stamp feedback.
    const seats: Record<string, Seat> = {};
    for (const [id, s] of Object.entries(room.seats)) {
      const entityRef = narrative.perspectives?.[s.perspectiveId]?.entityRef;
      const realized = entityRef ? positions[entityRef] : undefined;
      // A seat added mid-round joins NOW (this is the round boundary it was
      // waiting for): promote pending → playing and let it keep its fresh
      // economy.start — it didn't play, so there's no settle or Impact feedback.
      if (s.status === "pending") {
        seats[id] = { ...s, status: "playing", movedThisRound: false, locationId: realized ?? s.locationId };
        continue;
      }
      const fb = feedbackFor(id);
      seats[id] = {
        ...s,
        conviction: settle(s.conviction, room.economy),
        movedThisRound: false,
        locationId: realized ?? s.locationId,
        fateImpact: s.fateImpact + fb.impact,
        lastImpact: fb.impact,
        lastImpactReason: fb.reason,
      };
    }

    // Close any still-open seat-owned streams the player DIDN'T commit this round
    // — each round opens a fresh selection (played streams committed via the
    // panel; everything left on the table is closed, not carried over).
    const perspectiveIds = new Set(Object.values(room.seats).map((s) => s.perspectiveId));
    for (const st of streamsForBranch(narrative, room.branchId)) {
      if (st.state === "open" && perspectiveIds.has(st.perspectiveId)) {
        dispatch({ type: "CLOSE_STREAM", streamId: st.id });
      }
    }

    // Land in the SCORING reveal phase — the board reveals each seat's Impact +
    // the Fate moved (a feedback/reward beat, the way SHOWDOWN reveals cards). The
    // next round opens on the following advance (auto-timed in autoResolve rooms).
    // The same feedback also rides into the next perspective (stamped on the arc
    // at READ), so a player reads "what it earned them" with the new situation.
    const houseThisRound = Math.max(0, score.houseBand);
    const houseCumulative = (room.fateHouseBand ?? 0) + houseThisRound;
    // Snapshot this round's scoring for the Rankings data-viz — per-seat credit,
    // the running cumulative line, and the world's house band (play vs outside force).
    const scoreRecord: RoundScoreRecord = {
      roundIndex: round.index,
      perSeat: score.perSeat,
      cumulative: Object.fromEntries(Object.values(seats).map((s) => [s.id, s.fateImpact])),
      houseBand: houseThisRound,
      houseCumulative,
      total: score.total,
    };
    const scored: GameRoom = {
      ...room,
      seats,
      // Accumulate the world's uncontrolled share across rounds (shown beside seat
      // scores so the table sees how much Fate moved outside anyone's play).
      fateHouseBand: houseCumulative,
      scoreHistory: [...(room.scoreHistory ?? []), scoreRecord],
      round: {
        ...round,
        phase: "scoring",
        generating: false,
        scoringStartedAt: Date.now(),
        fateCredits: score.perSeat,
        houseBand: score.houseBand,
      },
    };
    saveRoom(logRoom(scored, "score", `Round ${round.index + 1} scored · Fate moved ${score.total.toFixed(2)}`));
  }, [narrative, room, state.resolvedEntryKeys, dispatch, saveRoom, logRoom]);

  /** Full-auto RESOLVE — generate the continuation from the players'-resolution
   *  merge WITHOUT the GM panel (used when `room.autoResolve`), then settle +
   *  score + open the next round. Mirrors what the panel + completeResolve do. */
  const autoGenerateResolve = useCallback(async () => {
    if (!narrative || !room?.round || room.round.phase !== "resolve") return;
    const merge = room.round.pendingMerge;
    if (merge && merge.streamIds.length > 0) {
      const mergeId = uid("merge");
      try {
        const { scenes, arc } = await generateScenes(
          narrative,
          state.resolvedEntryKeys,
          state.viewState.currentSceneIndex,
          1,
          `Conviction round ${room.round.index + 1}: realise the table's committed moves.`,
          { basisMerges: [{ id: mergeId, at: Date.now(), ...merge }] },
        );
        if (scenes.length > 0) dispatch({ type: "BULK_ADD_SCENES", scenes, arc: arc as Arc, branchId: room.branchId });
      } catch {
        /* best-effort — still settle + score off the committed plays */
      }
      dispatch({ type: "CREATE_MERGE", merge: { id: mergeId, at: Date.now(), ...merge } });
      // Commit each stream — but a realism verdict that CLOSES the question seals
      // it (closed), keeping committed-vs-closed faithful to the determination.
      for (const sid of merge.streamIds)
        dispatch(merge.resolutions?.[sid]?.closes ? { type: "CLOSE_STREAM", streamId: sid } : { type: "COMMIT_STREAM", streamId: sid });
    }
    await completeResolve();
  }, [narrative, room, state.resolvedEntryKeys, state.viewState.currentSceneIndex, dispatch, completeResolve]);

  return {
    room,
    endedRoom,
    actAsSeatId,
    startGame,
    advance,
    cancelGeneration,
    pendingMerge,
    completeResolve,
    setResolveGenerating,
    autoGenerateResolve,
    playCard,
    vetoPlay,
    setContestedOutcome,
    editGroupRealism,
    rerunShowdownRealism,
    foldSeat,
    actAsSeat,
    move,
    addPrior,
    openNewStream,
    pause,
    setHosting,
    setReady,
    setSeatOnline,
    minimise,
    resumeFromMinimise,
    extendClock,
    endGame,
    clearGame,
    dismissReport,
    sendChat,
    setGoal,
    updateEconomy,
    addSeats,
  };
}
