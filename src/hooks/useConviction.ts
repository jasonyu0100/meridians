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
import { narrativeContext } from "@/lib/ai/context";
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
import { createSeat, dealHand, nextActiveSeat, startRound, unplayedDealtStreamIds } from "@/lib/game/engine";
import { scoreRound, type ThreadAttribution } from "@/lib/game/scoring";
import { settleContest, settlementSeed } from "@/lib/game/settlement";
import { applyStreamPrior, openStream, rebuildStream, streamProbs } from "@/lib/forces/stream-stance";
import { computeCumulativePositions } from "@/lib/forces/positions";
import { streamsForBranch } from "@/lib/merges";
import { resolveAgentById, resolveAgentPersona } from "@/lib/agents/personas";
import { activeGameForBranch } from "@/lib/game/guards";
import { perspectiveName, uid } from "@/components/stage/RoomUI";
import { useStore } from "@/lib/state/store";
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

export function useConviction() {
  const { state, dispatch } = useStore();
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

  // Always points at the freshest committed room. Background work (agents deciding
  // during the PLAY window) reads this so its plays land on top of whatever humans
  // have committed in the meantime — never on a stale snapshot.
  const roomRef = useRef<GameRoom | null>(room);
  roomRef.current = room;

  const saveRoom = useCallback(
    (r: GameRoom) => dispatch({ type: "UPSERT_GAME_ROOM", room: r }),
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
      if (!narrative || !room) return;
      saveRoom(applyPlay(narrative, room, seatId, cardId, conviction, faceUp));
    },
    [narrative, room, saveRoom, applyPlay],
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
      saveRoom({ ...room, round: { ...round, generating: true, generatingLabel: "Re-judging realism" } });
      try {
        const headCtx = narrativeContext(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
        const resos = await resolveConflictRealism({ conflicts, narrativeContext: headCtx, guidance: guidance.trim() || undefined, onProgress, reasoningBudget: resolveReasoningBudget(narrative) });
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
      if (!room?.round) return;
      // Folding = no commit; advance the turn if it's this seat's.
      if (room.round.activeSeat === seatId) {
        const next = nextActiveSeat(room.round);
        saveRoom({ ...room, round: { ...room.round, activeSeat: next } });
      }
    },
    [room, saveRoom],
  );

  // ── Table ──────────────────────────────────────────────────────────────────
  const sendChat = useCallback(
    (seatId: string, text: string, scope: GameChatMessage["scope"] = "global", locationId?: string) => {
      if (!room) return;
      const msg: GameChatMessage = { id: uid("msg"), scope, locationId, seatId, text, at: Date.now(), roundIndex: room.round?.index };
      saveRoom({ ...room, chat: [...room.chat, msg] });
    },
    [room, saveRoom],
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
      if (!narrative || !room || !text.trim()) return;
      // Write-phase protection: priors are authored ONLY during the write window.
      if (room.round?.phase !== "write") return;
      const seat = room.seats[seatId];
      const stream = narrative.streams?.[streamId];
      if (!seat || !stream?.outcomes) return;
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
      // Re-price the seat's dealt cards on this stream from the new stance.
      const round = room.round;
      const hand = round?.hands[seatId];
      const name = perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative);
      const base = round && hand
        ? {
            ...room,
            round: {
              ...round,
              hands: {
                ...round.hands,
                [seatId]: {
                  ...hand,
                  cards: hand.cards.map((c) =>
                    c.streamId === streamId
                      ? { ...c, cost: cardCost(streamProbs(updated)[c.outcome] ?? 0, room.economy) }
                      : c,
                  ),
                },
              },
            },
          }
        : room;
      saveRoom(logRoom(base, "prior", `${name} added a prior on "${stream.title}"`, seatId));
    },
    [narrative, room, dispatch, saveRoom, logRoom],
  );

  /** Open a NEW stream for the seat from a posed open question — the AI
   *  instantiates the candidate actions + stance, and fresh cards are dealt into
   *  the seat's hand. */
  const openNewStream = useCallback(
    async (seatId: string, question: string, intuition?: string) => {
      if (!narrative || !room || !question.trim()) return;
      // Write-phase protection: new streams open ONLY during the write window.
      if (room.round?.phase !== "write") return;
      const seat = room.seats[seatId];
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
          narrativeContext: narrativeContext(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex),
        });
        stream = openStream({
          perspectiveId: seat.perspectiveId,
          agentId: seat.agentId,
          memberId: seat.memberId,
          question: q,
          outcomes: inst.outcomes,
          priorProbs: inst.priorProbs,
          intuition: intu,
          branchId: room.branchId,
        });
      } catch {
        stream = openStream({
          perspectiveId: seat.perspectiveId,
          agentId: seat.agentId,
          memberId: seat.memberId,
          question: q,
          outcomes: [...SEED_ACTIONS],
          intuition: intu,
          branchId: room.branchId,
        });
      }
      dispatch({ type: "UPSERT_STREAM", stream });
      // Deal cards for the new stream into the seat's hand.
      const round = room.round;
      const hand = round?.hands[seatId];
      if (round && hand) {
        const dealtCards = dealHand(seatId, [stream], room.economy, () => uid("card"), new Set([stream.id])).cards;
        saveRoom({
          ...room,
          round: { ...round, hands: { ...round.hands, [seatId]: { ...hand, cards: [...hand.cards, ...dealtCards] } } },
        });
      }
    },
    [narrative, room, state.resolvedEntryKeys, state.viewState.currentSceneIndex, dispatch, saveRoom],
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
   *  until the NEXT round opens (completeResolve promotes pending → playing at
   *  startRound, and that round's READ generates its perspective). New players
   *  bank the fresh economy.start; no carry-over. */
  const addSeats = useCallback(
    (cfgs: SeatConfig[]) => {
      if (!room || !narrative || cfgs.length === 0) return;
      const seats = { ...room.seats };
      const names: string[] = [];
      // A live round never gains a seat mid-flight (its turn order + hands are
      // already dealt); without a round we're between games → seat as playing.
      const status: Seat["status"] = room.round ? "pending" : "playing";
      cfgs.forEach((cfg, i) => {
        const seatId = uid("seat");
        seats[seatId] = {
          ...createSeat({ id: seatId, ...cfg, economy: room.economy, colorIndex: Object.keys(room.seats).length + i }),
          status,
        };
        names.push(perspectiveName(narrative.perspectives?.[cfg.perspectiveId], narrative));
      });
      saveRoom(
        logRoom(
          { ...room, seats },
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
      if (!room || !narrative) return;
      const seat = room.seats[seatId];
      if (!seat) return;
      if (narrative.perspectives?.[seat.perspectiveId]?.kind !== "character") return;
      const moved = { ...room, seats: { ...room.seats, [seatId]: { ...seat, locationId, movedThisRound: true } } };
      saveRoom(
        logRoom(
          moved,
          "move",
          `${perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative)} intends to move to ${narrative.locations[locationId]?.name ?? "elsewhere"}`,
          seatId,
        ),
      );
    },
    [room, narrative, saveRoom, logRoom],
  );

  // ── The GM one-click progression ────────────────────────────────────────────
  const advance = useCallback(async () => {
    if (!narrative || !room?.round || room.phase !== "round" || room.paused) return;
    const round = room.round;

    const headCtx = narrativeContext(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
    const entityContextOf = (perspectiveId: string): string => {
      const p = narrative.perspectives?.[perspectiveId];
      if (!p || p.kind === "narrator" || !p.entityRef) return "";
      const src =
        p.kind === "character" ? narrative.characters : p.kind === "location" ? narrative.locations : narrative.artifacts;
      const ent = src?.[p.entityRef];
      if (!ent) return "";
      const nodes = Object.values(ent.world?.nodes ?? {}).map((nd) => `- ${nd.content}`);
      return [`${ent.name}:`, ...nodes].join("\n");
    };

    // DECIDE (the slow part) — ask one agent seat, IN CHARACTER, which cards (if
    // any) to commit; it may pass and bank its conviction. Pure: returns the plays,
    // applies nothing. On any failure, falls back to the deterministic heuristic so
    // an all-agent room still progresses offline / without an API key. Safe to run
    // concurrently for many seats (no shared state touched).
    const decideSeatPlays = async (r: GameRoom, seatId: string): Promise<AgentPlay[]> => {
      const seat = r.seats[seatId];
      if (!seat || seat.driver !== "agent" || !r.round) return [];
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
      try {
        const decision = await decideAgentPlays({
          seat,
          hand: r.round.hands[seatId],
          economy: r.economy,
          streamsById,
          perspectiveLabel: perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative),
          entityContext: entityContextOf(seat.perspectiveId),
          narrativeContext: headCtx,
          persona: resolveAgentPersona(agent) || undefined,
          priorPlays,
          reasoningBudget: resolveReasoningBudget(narrative),
        });
        return decision.plays;
      } catch {
        return chooseAgentPlays(seat, r.round.hands[seatId], r.economy, agent?.persona, streamProbsResolver(narrative.streams ?? {}));
      }
    };

    // Auto-play a single agent seat — decide then apply (no-op for human/gm-proxy).
    const autoPlaySeat = async (r: GameRoom, seatId: string): Promise<GameRoom> => {
      const plays = await decideSeatPlays(r, seatId);
      let w = r;
      for (const p of plays) w = applyPlay(narrative, w, seatId, p.cardId, p.conviction, !p.faceDown);
      return w;
    };

    // Run agent decisions OFF the critical path during PLAY: decide concurrently
    // for the given seats, then fold every agent's plays onto the LATEST room (so a
    // human commit made while the agents were thinking survives). Applies nothing
    // if the play window has since closed. Never awaited by `advance` — the GM's
    // click returns immediately and play is interactive while agents think.
    const runAgentsInBackground = (openedRoom: GameRoom, seatIds: string[]) => {
      const agents = seatIds.filter((id) => openedRoom.seats[id]?.driver === "agent");
      if (!agents.length) return;
      // Flag the deciding agents so the board pulses a "thinking" tell over each
      // pod while they deliberate (off-clock). Cleared once their plays land.
      {
        const w0 = roomRef.current;
        if (w0?.round && w0.round.phase === "play")
          saveRoom({ ...w0, round: { ...w0.round, thinkingSeats: agents } });
      }
      void (async () => {
        const results = await Promise.all(
          agents.map(async (seatId) => ({ seatId, plays: await decideSeatPlays(openedRoom, seatId) })),
        );
        let w = roomRef.current;
        if (!w?.round || w.round.phase !== "play") return; // window closed/changed → drop
        for (const { seatId, plays } of results)
          for (const p of plays) w = applyPlay(narrative, w, seatId, p.cardId, p.conviction, !p.faceDown);
        saveRoom({ ...w, round: { ...w.round!, thinkingSeats: [] } });
      })();
    };

    // Walk the turn order from `fromActive`, auto-playing agent seats, stopping
    // at the first MANUAL seat (human / gm-proxy) the GM must play, or null at end.
    const drainAgents = async (r: GameRoom, fromActive: string | null): Promise<{ room: GameRoom; active: string | null }> => {
      let w: GameRoom = { ...r, round: { ...r.round!, activeSeat: fromActive } };
      let active = fromActive;
      while (active) {
        const seat = w.seats[active];
        if (!seat || seat.driver !== "agent") break; // manual seat: wait for the GM
        // Surface the seat the engine is deciding right now as "thinking" so the
        // board pulses its pod through the sequential drain (one agent at a time).
        const deciding = active;
        const live = roomRef.current;
        if (live?.round && live.round.phase === "play")
          saveRoom({ ...live, round: { ...live.round, thinkingSeats: [deciding] } });
        w = await autoPlaySeat(w, active);
        active = nextActiveSeat({ ...w.round!, activeSeat: active });
        w = { ...w, round: { ...w.round!, activeSeat: active } };
      }
      return { room: { ...w, round: { ...w.round!, thinkingSeats: [] } }, active };
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
                onToken: (_t, acc) => { text = acc; emit(key, { text, reasoning, status: "stream" }); },
                onReasoning: (_t, acc) => { reasoning = acc; emit(key, { text, reasoning, status: "stream" }); },
              });
              dispatch({ type: "SET_ARC_PERSPECTIVE", arcId, view: { key, label: perspectiveLabel(narrative, key), text: finalText, generatedAt: Date.now() } });
            } catch {
              /* best-effort per key */
            } finally {
              emit(key, { status: "done" });
            }
          }),
        );
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
      const headCtx = narrativeContext(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
      const entityContextOf = (perspectiveId: string): string => {
        const p = narrative.perspectives?.[perspectiveId];
        if (!p || p.kind === "narrator" || !p.entityRef) return "";
        const src =
          p.kind === "character" ? narrative.characters : p.kind === "location" ? narrative.locations : narrative.artifacts;
        const ent = src?.[p.entityRef];
        if (!ent) return "";
        const nodes = Object.values(ent.world?.nodes ?? {}).map((nd) => `- ${nd.content}`);
        return [`${ent.name}:`, ...nodes].join("\n");
      };

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
              narrativeContext: headCtx,
              personaContext: persona,
              reasoningBudget: resolveReasoningBudget(narrative),
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
        round: { ...round, phase: "play", generating: false, activeSeat: first, playStartedAt: Date.now() },
      };
      saveRoom(
        logRoom(opened, "phase", `Round ${round.index + 1} — play opens${simultaneous ? " (simultaneous)" : ""}`),
      );
      // Fan the agents out off-clock.
      if (simultaneous) {
        // Every agent seat decides at once; plays fold onto the latest room.
        runAgentsInBackground(opened, round.turnOrder);
      } else if (first && opened.seats[first]?.driver === "agent") {
        // Ordered: drain the leading run of agents in the background, advancing the
        // turn pointer to the first manual seat (no human acts during agent turns,
        // so this bases on the opened snapshot; dropped if play has since closed).
        void (async () => {
          const { room: drained, active } = await drainAgents(opened, first);
          const latest = roomRef.current;
          if (!latest?.round || latest.round.phase !== "play" || latest.round.index !== round.index) return;
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
        const drained = await drainAgents(working, next);
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
              narrativeContext: headCtx,
              reasoningBudget: resolveReasoningBudget(narrative),
            });
            for (const x of resos) realismById[x.id] = x;
          } catch {
            // Best-effort — the merge still resolves on the chosen winner.
          }
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
      saveRoom({ ...room, round: startRound(room, round.index + 1, round.openThreadIds) });
      return;
    }

    // RESOLVE is GM-driven via the Generate Panel (it commits the merge built
    // from players' card-resolutions + generates the continuation). The UI
    // surfaces the panel; `completeResolve()` runs SETTLE + SCORE, stamps each
    // seat's Impact feedback, and opens the NEXT round immediately on generate
    // (the feedback rides in the next perspective). So advancing does nothing here.
  }, [narrative, room, state.resolvedEntryKeys, state.viewState.currentSceneIndex, dispatch, saveRoom, logRoom, ownedStreams, applyPlay]);

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
      if (inputs.length > 0) reads = await scoreThreadsWithAI(inputs, resolveReasoningBudget(narrative), continuationSummary);
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
    const scored: GameRoom = {
      ...room,
      seats,
      // Accumulate the world's uncontrolled share across rounds (shown beside seat
      // scores so the table sees how much Fate moved outside anyone's play).
      fateHouseBand: (room.fateHouseBand ?? 0) + Math.max(0, score.houseBand),
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
