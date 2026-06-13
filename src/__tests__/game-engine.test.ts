import { describe, expect, it } from "vitest";

import { cardCost, defaultEconomy } from "@/lib/game/economy";
import {
  SEAT_COLORS,
  appendChat,
  buildProposedMerge,
  committedThisRound,
  createSeat,
  dealHand,
  forkGameRooms,
  humansReady,
  isAiControlled,
  isHumanControlled,
  nextActiveSeat,
  nextRoundsPhase,
  rotateButton,
  seatColor,
  seatPresence,
  startRound,
  turnOrderFrom,
  unreadyHumanSeats,
  unplayedDealtStreamIds,
} from "@/lib/game/engine";
import {
  contestOdds,
  mulberry32,
  sampleFromDistribution,
  settleContest,
  settlementSeed,
} from "@/lib/game/settlement";
import type { Card, GameChatMessage, GameRoom, Hand, PlayedCard, RoundState, Stream } from "@/types/narrative";

const econ = defaultEconomy();

function stream(id: string, logits: number[]): Stream {
  return {
    id,
    perspectiveId: "P1",
    title: id,
    outcomes: logits.map((_, i) => `action ${i}`),
    stance: { logits, volume: 2, volatility: 0 },
    state: "open",
    priors: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("engine — turn order & button", () => {
  const seats = ["s1", "s2", "s3", "s4"];

  it("rotates the button clockwise", () => {
    expect(rotateButton(seats, undefined)).toBe("s1");
    expect(rotateButton(seats, "s1")).toBe("s2");
    expect(rotateButton(seats, "s4")).toBe("s1"); // wraps
  });

  it("orders action left-of-button and wraps", () => {
    expect(turnOrderFrom(seats, "s2")).toEqual(["s3", "s4", "s1", "s2"]);
  });

  it("advances the active seat then exhausts", () => {
    const round = { turnOrder: ["s3", "s4", "s1"], activeSeat: "s3" } as RoundState;
    expect(nextActiveSeat(round)).toBe("s4");
    expect(nextActiveSeat({ ...round, activeSeat: "s1" })).toBeNull();
  });
});

describe("engine — phase order", () => {
  it("walks the Rounds loop", () => {
    expect(nextRoundsPhase("read")).toBe("write");
    expect(nextRoundsPhase("write")).toBe("play");
    expect(nextRoundsPhase("play")).toBe("showdown"); // reveal before arc generation
    expect(nextRoundsPhase("showdown")).toBe("resolve");
    expect(nextRoundsPhase("scoring")).toBeNull(); // end → caller starts next round
  });

  it("skips showdown when disabled", () => {
    expect(nextRoundsPhase("play", { showShowdown: false })).toBe("resolve");
  });
});

describe("engine — startRound seeds phase timers", () => {
  const room = (phaseSeconds?: Record<string, number>) =>
    ({ seats: { s1: {}, s2: {} }, round: null, phaseSeconds } as unknown as GameRoom);

  it("seeds round.timers from phaseSeconds in ms, dropping 0/untimed", () => {
    const r = startRound(room({ read: 30, play: 0, write: 120 }), 0);
    expect(r.timers).toEqual({ read: 30_000, write: 120_000 });
  });

  it("no phaseSeconds → no timers", () => {
    expect(startRound(room(), 0).timers).toEqual({});
  });
});

describe("engine — unplayed dealt streams (end-of-game cleanup)", () => {
  const card = (streamId: string, origin: "chosen" | "dealt", outcome = 0): Card => ({
    id: `${streamId}:${outcome}`,
    streamId,
    outcome,
    cost: 10,
    origin,
  });
  const played = (streamId: string): PlayedCard => ({
    card: card(streamId, "dealt"),
    faceUp: true,
    conviction: 10,
    playedAt: 1,
  });

  it("collects dealt + unplayed across seats, keeping chosen + played", () => {
    const round = {
      hands: {
        s1: { seatId: "s1", cards: [card("a", "dealt"), card("b", "dealt"), card("c", "chosen")], played: [played("b")] },
        s2: { seatId: "s2", cards: [card("d", "dealt")], played: [] },
      },
    } as unknown as RoundState;
    expect(unplayedDealtStreamIds(round).sort()).toEqual(["a", "d"]);
  });

  it("dedupes the multi-outcome cards of one dealt stream", () => {
    const round = {
      hands: { s1: { seatId: "s1", cards: [card("a", "dealt", 0), card("a", "dealt", 1)], played: [] } },
    } as unknown as RoundState;
    expect(unplayedDealtStreamIds(round)).toEqual(["a"]);
  });

  it("empty when nothing dealt, or every dealt stream was played", () => {
    const allPlayed = {
      hands: { s1: { seatId: "s1", cards: [card("a", "dealt")], played: [played("a")] } },
    } as unknown as RoundState;
    const onlyChosen = {
      hands: { s1: { seatId: "s1", cards: [card("c", "chosen")], played: [] } },
    } as unknown as RoundState;
    expect(unplayedDealtStreamIds(allPlayed)).toEqual([]);
    expect(unplayedDealtStreamIds(onlyChosen)).toEqual([]);
  });
});

describe("engine — dealing", () => {
  it("deals one priced card per candidate action of each owned open stream", () => {
    const streams = [stream("st1", [0, 0]), stream("st2", [2, -2, 0])];
    const hand = dealHand("s1", streams, econ, (sid, o) => `${sid}:${o}`);
    expect(hand.cards).toHaveLength(2 + 3);
    // even stance → ~coin-flip cost (≈23) on the 2-outcome stream
    const st1Costs = hand.cards.filter((c) => c.streamId === "st1").map((c) => c.cost);
    expect(st1Costs.every((c) => c >= econ.costMin && c <= 100)).toBe(true);
    expect(st1Costs[0]).toBe(cardCost(0.5, econ)); // coin-flip cost from the live economy
  });

  it("skips non-open streams", () => {
    const closed: Stream = { ...stream("st3", [0, 0]), state: "closed" };
    expect(dealHand("s1", [closed], econ, (s, o) => `${s}:${o}`).cards).toHaveLength(0);
  });
});

describe("engine — proposed merge", () => {
  it("picks the hardest-backed outcome per stream and folds into resolutions", () => {
    const streamsById = { st1: stream("st1", [0, 0, 0]) };
    const room = { branchId: "b1", seats: { s1: {} } } as unknown as GameRoom;
    const round = {
      index: 0,
      hands: {
        s1: {
          seatId: "s1",
          cards: [],
          played: [
            { card: { id: "c0", streamId: "st1", outcome: 0, cost: 23, origin: "chosen" }, faceUp: true, conviction: 10, playedAt: 1 },
            { card: { id: "c1", streamId: "st1", outcome: 1, cost: 23, origin: "chosen" }, faceUp: true, conviction: 40, playedAt: 2 },
          ],
        },
      },
    } as unknown as RoundState;
    const merge = buildProposedMerge(room, round, streamsById);
    expect(merge.streamIds).toEqual(["st1"]);
    // outcome 1 had more conviction (40 > 10) → it's the headline
    expect(merge.resolutions!.st1.outcome).toBe("action 1");
    expect(merge.resolutions!.st1.outcomes).toEqual(["action 1", "action 0"]);
    expect(merge.branchId).toBe("b1");
  });
});

describe("settlement — seeded draw (auditability)", () => {
  it("is deterministic given a seed", () => {
    const a = settleContest("random", [0, 0], [1.5, 0], 12345);
    const b = settleContest("random", [0, 0], [1.5, 0], 12345);
    expect(a.drawnOutcome).toBe(b.drawnOutcome);
    expect(a.seed).toBe(12345);
  });

  it("draws proportional to p° over many seeds", () => {
    // base even, nudge outcome 0 by ~+0.85 logits → p° ≈ [0.7, 0.3]
    const odds = contestOdds([0, 0], [0.847, 0]);
    expect(odds[0]).toBeCloseTo(0.7, 1);
    let wins0 = 0;
    const N = 4000;
    for (let s = 1; s <= N; s++) {
      if (settleContest("random", [0, 0], [0.847, 0], s).drawnOutcome === 0) wins0++;
    }
    expect(wins0 / N).toBeGreaterThan(0.66);
    expect(wins0 / N).toBeLessThan(0.74);
  });

  it("highest-cost forces the rarest; realism defers to the AI judge (no draw)", () => {
    expect(settleContest("highest-cost", [0, 0, 0], [2, 0, -1], 1).drawnOutcome).toBe(2);
    expect(settleContest("realism", [0, 0], [1, 0], 1).drawnOutcome).toBeNull();
  });

  it("settlementSeed is stable + varies by round/thread", () => {
    expect(settlementSeed(7, 0, "T1")).toBe(settlementSeed(7, 0, "T1"));
    expect(settlementSeed(7, 0, "T1")).not.toBe(settlementSeed(7, 1, "T1"));
    expect(settlementSeed(7, 0, "T1")).not.toBe(settlementSeed(7, 0, "T2"));
  });

  it("mulberry32 + sampleFromDistribution behave", () => {
    const r = mulberry32(42);
    const u = r();
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
    expect(sampleFromDistribution([0.0, 1.0], 0.5)).toBe(1);
    expect(sampleFromDistribution([1.0, 0.0], 0.5)).toBe(0);
  });
});

describe("engine — seat construction & colours", () => {
  it("seatColor wraps the palette by index", () => {
    expect(seatColor(0)).toBe(SEAT_COLORS[0]);
    expect(seatColor(SEAT_COLORS.length)).toBe(SEAT_COLORS[0]); // wraps
    expect(seatColor(SEAT_COLORS.length + 1)).toBe(SEAT_COLORS[1]);
  });

  it("createSeat opens at the economy's start balance, playing, zero Impact", () => {
    const s = createSeat({
      id: "seat1",
      perspectiveId: "P1",
      driver: "agent",
      agentId: "A1",
      locationId: "L1",
      economy: econ,
      colorIndex: 2,
    });
    expect(s.conviction).toBe(econ.start);
    expect(s.status).toBe("playing");
    expect(s.fateImpact).toBe(0);
    expect(s.goals).toEqual([]);
    expect(s.movedThisRound).toBe(false);
    expect(s.color).toBe(seatColor(2));
  });
});

describe("engine — round bookkeeping", () => {
  it("committedThisRound counts a hand's plays (0 when undefined)", () => {
    expect(committedThisRound(undefined)).toBe(0);
    expect(committedThisRound({ seatId: "s", cards: [], played: [] } as Hand)).toBe(0);
    const hand = {
      seatId: "s",
      cards: [],
      played: [
        { card: {}, faceUp: true, conviction: 5, playedAt: 1 },
        { card: {}, faceUp: true, conviction: 5, playedAt: 2 },
      ],
    } as unknown as Hand;
    expect(committedThisRound(hand)).toBe(2);
  });

  it("appendChat returns a new array with the message appended (immutable)", () => {
    const a = { id: "m1" } as GameChatMessage;
    const b = { id: "m2" } as GameChatMessage;
    const room = { chat: [a] } as unknown as GameRoom;
    const next = appendChat(room, b);
    expect(next).toEqual([a, b]);
    expect(room.chat).toEqual([a]); // original untouched
  });
});

describe("engine — forkGameRooms (branch isolation)", () => {
  it("re-ids the room, rebinds the branch, and remaps stream references", () => {
    const room = {
      id: "g0",
      branchId: "parent",
      seats: { s1: { goals: [{ threadId: "old", id: "goal1" }] } },
      round: {
        mergeId: "m-mid",
        hands: {
          s1: {
            seatId: "s1",
            cards: [{ id: "c1", streamId: "old", outcome: 0, cost: 5, origin: "dealt" }],
            played: [{ card: { id: "c1", streamId: "old", outcome: 0, cost: 5, origin: "dealt" }, faceUp: true, conviction: 5, playedAt: 1 }],
          },
        },
      },
      chat: [{ id: "msg" }],
    } as unknown as GameRoom;

    const map = new Map([["old", "new"]]);
    const [forked] = forkGameRooms([room], "child", map, (p) => `${p}-X`);

    expect(forked.id).toBe("GAME-X"); // fresh id from genId
    expect(forked.branchId).toBe("child");
    expect(forked.seats.s1.goals[0].threadId).toBe("new"); // goal remapped
    expect(forked.round!.mergeId).toBeUndefined(); // mid-fork merge dropped
    expect(forked.round!.hands.s1.cards[0].streamId).toBe("new");
    expect(forked.round!.hands.s1.played[0].card.streamId).toBe("new");
    expect(room.branchId).toBe("parent"); // parent untouched
  });

  it("leaves ids without a mapping unchanged", () => {
    const room = {
      id: "g0",
      branchId: "parent",
      seats: { s1: { goals: [{ threadId: "keep" }] } },
      round: null,
      chat: [],
    } as unknown as GameRoom;
    const [forked] = forkGameRooms([room], "child", new Map(), (p) => `${p}-X`);
    expect(forked.seats.s1.goals[0].threadId).toBe("keep");
    expect(forked.round).toBeNull();
  });
});

describe("presence gate — seatPresence / humansReady / unreadyHumanSeats", () => {
  const seat = (over: Partial<ReturnType<typeof createSeat>>) =>
    ({ ...createSeat({ id: "x", perspectiveId: "p", driver: "human", locationId: "L", economy: econ, colorIndex: 0 }), ...over });
  const mk = (seats: Record<string, ReturnType<typeof createSeat>>): GameRoom =>
    ({ id: "g", branchId: "b", seats, economy: econ } as unknown as GameRoom);

  it("seatPresence: Member offline→waiting→ready; unclaimed agent / gm-proxy = ai", () => {
    expect(seatPresence(seat({ driver: "human", online: false, ready: false }))).toBe("offline");
    expect(seatPresence(seat({ driver: "human", online: false, ready: true }))).toBe("offline"); // disconnected even if readied
    expect(seatPresence(seat({ driver: "human", online: true, ready: false }))).toBe("waiting");
    expect(seatPresence(seat({ driver: "human", online: true, ready: true }))).toBe("ready");
    expect(seatPresence(seat({ driver: "agent", online: false, ready: false }))).toBe("ai"); // unclaimed → AI plays it
    expect(seatPresence(seat({ driver: "gm-proxy", online: false }))).toBe("ai");
  });

  it("agent TAKEOVER: a claimed agent becomes human-controlled; the AI stands down", () => {
    const unclaimed = seat({ driver: "agent", online: false });
    const claimed = seat({ driver: "agent", online: true, ready: false });
    // Unclaimed: AI drives, not human-controlled, doesn't gate.
    expect(isAiControlled(unclaimed)).toBe(true);
    expect(isHumanControlled(unclaimed)).toBe(false);
    // Claimed (a player connected): human-controlled, AI stands down, gates until ready.
    expect(isAiControlled(claimed)).toBe(false);
    expect(isHumanControlled(claimed)).toBe(true);
    expect(seatPresence(claimed)).toBe("waiting");
    // Leaving (offline again) hands it straight back to the AI.
    expect(isAiControlled({ ...claimed, online: false })).toBe(true);
  });

  it("a CLAIMED-but-unready agent gates the round; an UNCLAIMED agent doesn't", () => {
    expect(humansReady(mk({ ai: seat({ id: "ai", driver: "agent", online: true, ready: false }) }))).toBe(false);
    expect(humansReady(mk({ ai: seat({ id: "ai", driver: "agent", online: false }) }))).toBe(true);
    // A claimed agent that readies up clears the gate.
    expect(humansReady(mk({ ai: seat({ id: "ai", driver: "agent", online: true, ready: true }) }))).toBe(true);
  });

  it("gm-proxy is never human-controlled and never AI-auto-played", () => {
    const gm = seat({ driver: "gm-proxy", online: true, ready: false });
    expect(isHumanControlled(gm)).toBe(false);
    expect(isAiControlled(gm)).toBe(false);
  });

  it("a Member seat gates when OFFLINE — the GM is blocked until they open the game", () => {
    // The reported bug: a game with a player seat that never opened must block.
    const room = mk({ a: seat({ id: "a", driver: "human", online: false, ready: false }) });
    expect(humansReady(room)).toBe(false);
    expect(unreadyHumanSeats(room).map((s) => s.id)).toEqual(["a"]);
  });

  it("a Member seat gates when ONLINE but not ready", () => {
    const room = mk({ a: seat({ id: "a", driver: "human", online: true, ready: false }) });
    expect(humansReady(room)).toBe(false);
  });

  it("clears only when every Member is online AND ready; agents / gm-proxy never gate", () => {
    const room = mk({
      a: seat({ id: "a", driver: "human", online: true, ready: true }),
      b: seat({ id: "b", driver: "human", online: true, ready: true }),
      ai: seat({ id: "ai", driver: "agent", online: false, ready: false }),
      gm: seat({ id: "gm", driver: "gm-proxy", online: false, ready: false }),
    });
    expect(humansReady(room)).toBe(true);
  });

  it("a table with NO Member seats never gates (all agent / gm-proxy)", () => {
    const room = mk({ ai: seat({ id: "ai", driver: "agent" }), gm: seat({ id: "gm", driver: "gm-proxy" }) });
    expect(humansReady(room)).toBe(true);
  });

  it("spectators don't gate; a mid-game joiner (pending, offline) re-arms the gate", () => {
    const room = mk({
      a: seat({ id: "a", driver: "human", online: true, ready: true }),
      s: seat({ id: "s", driver: "human", online: false, ready: false, status: "spectating" }),
      j: seat({ id: "j", driver: "human", online: false, ready: false, status: "pending" }),
    });
    expect(unreadyHumanSeats(room).map((s) => s.id)).toEqual(["j"]);
    expect(humansReady(room)).toBe(false);
  });
});
