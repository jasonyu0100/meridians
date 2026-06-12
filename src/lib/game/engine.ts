/** Conviction engine — the PURE round-machine helpers for the rehearsal card
 *  game (CONCEPT.md §The game loop, Rounds variant). No React, no store, no IO:
 *  room/seat construction, the Rounds phase order, poker turn order + button
 *  rotation, dealing a hand off a seat's OWN streams, and folding committed
 *  cards into a ProposedMerge. The orchestration hook (useConviction) calls these
 *  and threads the async side-effects (scoreStreamPrior, generate, narration). */
import { cardCost } from "@/lib/game/economy";
import { streamProbs } from "@/lib/forces/stream-stance";
import type {
  Card,
  ConvictionEconomy,
  GameChatMessage,
  GameRoom,
  Hand,
  PlayedCard,
  ProposedMerge,
  RoundPhase,
  RoundState,
  Seat,
  Stream,
} from "@/types/narrative";

/** Stable seat palette — distinct hues for authored-stance ribbons + readout. */
export const SEAT_COLORS = [
  "#e0607e", // rose
  "#5fb3d4", // cyan
  "#e0a740", // amber
  "#7ec97e", // green
  "#a87ed4", // violet
  "#d4805f", // terracotta
  "#5f8fd4", // blue
  "#c9c95f", // citron
];

export function seatColor(index: number): string {
  return SEAT_COLORS[index % SEAT_COLORS.length];
}

// ── Rounds phase order ────────────────────────────────────────────────────────
// SETTLE/SCORING loop back to READ (handled by the caller starting a new round).
// SHOWDOWN sits BEFORE RESOLVE — the reveal of all committed cards + contested
// settlement happens before arc generation; the caller skips it when no card was
// concealed and nothing was contested (nothing to reveal).
const ROUNDS_PHASE_ORDER: RoundPhase[] = [
  "read",
  "write",
  "play",
  "showdown",
  "resolve",
  "settle",
  "scoring",
];

/** The next phase in the Rounds loop, given whether a SHOWDOWN reveal should
 *  run. Returns null at the end of SCORING (caller starts the next round). */
export function nextRoundsPhase(
  phase: RoundPhase,
  opts: { showShowdown: boolean } = { showShowdown: true },
): RoundPhase | null {
  const i = ROUNDS_PHASE_ORDER.indexOf(phase);
  if (i < 0 || i >= ROUNDS_PHASE_ORDER.length - 1) return null;
  let next = ROUNDS_PHASE_ORDER[i + 1];
  if (next === "showdown" && !opts.showShowdown) next = "resolve";
  return next;
}

// ── Construction ──────────────────────────────────────────────────────────────

export interface CreateSeatArgs {
  id: string;
  perspectiveId: string;
  driver: Seat["driver"];
  memberId?: string;
  agentId?: string;
  locationId: string;
  economy: ConvictionEconomy;
  colorIndex: number;
}

export function createSeat(args: CreateSeatArgs): Seat {
  return {
    id: args.id,
    perspectiveId: args.perspectiveId,
    driver: args.driver,
    memberId: args.memberId,
    agentId: args.agentId,
    status: "playing",
    conviction: args.economy.start,
    locationId: args.locationId,
    movedThisRound: false,
    goals: [],
    fateImpact: 0,
    color: seatColor(args.colorIndex),
  };
}

// ── Turn order & button ─────────────────────────────────────────────────────

/** Rotate the dealer button one seat clockwise around the (stable) seating
 *  order. Returns the new button seatId. */
export function rotateButton(seatOrder: string[], prevButton: string | undefined): string {
  if (seatOrder.length === 0) return "";
  if (!prevButton) return seatOrder[0];
  const i = seatOrder.indexOf(prevButton);
  return seatOrder[(i + 1) % seatOrder.length];
}

/** Poker turn order for a round: action starts left of the button and wraps. */
export function turnOrderFrom(seatOrder: string[], buttonSeat: string): string[] {
  if (seatOrder.length === 0) return [];
  const b = Math.max(0, seatOrder.indexOf(buttonSeat));
  const order: string[] = [];
  for (let k = 1; k <= seatOrder.length; k++) order.push(seatOrder[(b + k) % seatOrder.length]);
  return order;
}

/** The next seat to act in PLAY, or null when the turn order is exhausted. */
export function nextActiveSeat(round: RoundState): string | null {
  if (round.activeSeat == null) return round.turnOrder[0] ?? null;
  const i = round.turnOrder.indexOf(round.activeSeat);
  if (i < 0 || i >= round.turnOrder.length - 1) return null;
  return round.turnOrder[i + 1];
}

/** Begin a fresh round: rotate the button, set turn order, reset hands + per-seat
 *  movement, open the round at PUBLIC_NARRATION. (Hands are dealt at READ-WRITE.) */
export function startRound(
  room: GameRoom,
  index: number,
  openThreadIds: string[] = [],
): RoundState {
  const seatOrder = Object.keys(room.seats);
  const prevButton = room.round?.buttonSeat;
  const buttonSeat = rotateButton(seatOrder, index === 0 ? undefined : prevButton);
  const turnOrder = turnOrderFrom(seatOrder, buttonSeat);
  return {
    index,
    phase: "read",
    turnOrder,
    buttonSeat,
    activeSeat: null,
    lockedIn: [],
    openThreadIds,
    hands: Object.fromEntries(
      Object.keys(room.seats).map((id) => [id, { seatId: id, cards: [], played: [] } as Hand]),
    ),
    pot: 0,
    timers: room.phaseSeconds
      ? Object.fromEntries(
          Object.entries(room.phaseSeconds)
            .filter(([, s]) => (s ?? 0) > 0)
            .map(([phase, s]) => [phase, (s as number) * 1000]),
        )
      : {},
  };
}

/** Stream ids the GAME seeded to seats this round (card `origin: "dealt"`, and
 *  dealt ids are minted per-round, so these were opened by this round's DELIVER)
 *  that no seat ever played. The unfinished turn's litter — cleared when a game
 *  ends so abandoned candidate streams don't persist on the branch. A seat's own
 *  ("chosen") streams and anything committed are never included. */
export function unplayedDealtStreamIds(round: RoundState): string[] {
  const out = new Set<string>();
  for (const hand of Object.values(round.hands)) {
    const played = new Set(hand.played.map((p) => p.card.streamId));
    for (const card of hand.cards) {
      if (card.origin === "dealt" && !played.has(card.streamId)) out.add(card.streamId);
    }
  }
  return [...out];
}

// ── Dealing ───────────────────────────────────────────────────────────────────

/** Deal a hand for a seat off the streams it OWNS — one card per candidate
 *  action of each open stream, priced live from the stance. `dealt`-origin
 *  streams (engine-sampled candidates seeded to this seat) are passed in
 *  separately so the card carries the right provenance. */
export function dealHand(
  seatId: string,
  ownedStreams: Stream[],
  economy: ConvictionEconomy,
  idFor: (streamId: string, outcome: number) => string,
  dealtStreamIds: ReadonlySet<string> = new Set(),
): Hand {
  const cards: Card[] = [];
  for (const stream of ownedStreams) {
    if (stream.state !== "open") continue;
    const probs = streamProbs(stream);
    const n = stream.outcomes?.length ?? probs.length;
    for (let outcome = 0; outcome < n; outcome++) {
      cards.push({
        id: idFor(stream.id, outcome),
        streamId: stream.id,
        outcome,
        cost: cardCost(probs[outcome] ?? 0, economy),
        origin: dealtStreamIds.has(stream.id) ? "dealt" : "chosen",
      });
    }
  }
  return { seatId, cards, played: [] };
}

// ── Proposed merge (RESOLVE) ──────────────────────────────────────────────────

/** Per stream, the outcome the seat backed hardest (max committed conviction).
 *  When a seat backed several outcomes on one stream, the others ride along as a
 *  multi-resolution set. */
function streamResolution(plays: PlayedCard[]): { outcome: number; outcomes: number[] } {
  const byOutcome = new Map<number, number>();
  for (const p of plays) {
    byOutcome.set(p.card.outcome, (byOutcome.get(p.card.outcome) ?? 0) + p.conviction);
  }
  const ranked = [...byOutcome.entries()].sort((a, b) => b[1] - a[1]);
  return { outcome: ranked[0][0], outcomes: ranked.map(([o]) => o) };
}

/** Fold the round's committed cards into a ProposedMerge. Each stream with plays
 *  contributes an executive resolution (the backed action); the GM can override
 *  before generating. Outcome indices resolve to outcome strings via the stream. */
export function buildProposedMerge(
  room: GameRoom,
  round: RoundState,
  streamsById: Record<string, Stream>,
): ProposedMerge {
  const streamIds: string[] = [];
  const resolutions: NonNullable<ProposedMerge["resolutions"]> = {};
  for (const hand of Object.values(round.hands)) {
    const byStream = new Map<string, PlayedCard[]>();
    for (const p of hand.played) {
      const arr = byStream.get(p.card.streamId) ?? [];
      arr.push(p);
      byStream.set(p.card.streamId, arr);
    }
    for (const [streamId, plays] of byStream) {
      const stream = streamsById[streamId];
      if (!stream?.outcomes) continue;
      const { outcome, outcomes } = streamResolution(plays);
      streamIds.push(streamId);
      const outcomeStrings = outcomes.map((o) => stream.outcomes![o]).filter(Boolean);
      resolutions[streamId] = {
        outcome: stream.outcomes[outcome],
        ...(outcomeStrings.length > 1 ? { outcomes: outcomeStrings } : {}),
      };
    }
  }
  return {
    streamIds,
    resolutions,
    branchId: room.branchId,
    summary: `Conviction round ${round.index + 1} merge`,
  };
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

/** Total conviction a seat has committed this round (across all played cards). */
export function committedThisRound(hand: Hand | undefined): number {
  if (!hand) return 0;
  return hand.played.length;
}

/** Append a chat message to the room (pure — returns a new chat array). */
export function appendChat(room: GameRoom, msg: GameChatMessage): GameChatMessage[] {
  return [...room.chat, msg];
}

// ── Fork copies the game (plan §5b) ──────────────────────────────────────────

/** Deep-copy the game rooms on `fromBranchId` onto a forked child branch:
 *  fresh room id + branchId, with card/goal stream references remapped onto the
 *  child's copied streams. The parent game stays an untouched backup — mid-game
 *  forking is a first-class "try a different line" replay. `streamIdMap` maps a
 *  parent streamId → its child copy id (built from forkLedger's output). */
export function forkGameRooms(
  rooms: GameRoom[],
  toBranchId: string,
  streamIdMap: ReadonlyMap<string, string>,
  genId: (prefix: string) => string,
): GameRoom[] {
  const remap = (sid: string) => streamIdMap.get(sid) ?? sid;
  return rooms.map((room) => {
    const seats = Object.fromEntries(
      Object.entries(room.seats).map(([id, seat]) => [
        id,
        { ...seat, goals: seat.goals.map((g) => ({ ...g, threadId: remap(g.threadId) })) },
      ]),
    );
    const round: RoundState | null = room.round
      ? {
          ...room.round,
          mergeId: undefined, // a mid-fork merge isn't carried; the child re-resolves
          hands: Object.fromEntries(
            Object.entries(room.round.hands).map(([sid, hand]) => [
              sid,
              {
                ...hand,
                cards: hand.cards.map((c) => ({ ...c, streamId: remap(c.streamId) })),
                played: hand.played.map((p) => ({
                  ...p,
                  card: { ...p.card, streamId: remap(p.card.streamId) },
                })),
              },
            ]),
          ),
        }
      : null;
    return {
      ...room,
      id: genId("GAME"),
      branchId: toBranchId,
      seats,
      round,
      chat: [...room.chat],
    };
  });
}
