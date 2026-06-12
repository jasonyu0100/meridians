import { describe, expect, it } from "vitest";

import { chooseAgentPlays, personaAggression, playEvidence, streamProbsResolver } from "@/lib/game/agent";
import { defaultEconomy, evidenceFromConviction } from "@/lib/game/economy";
import type { Card, Hand, Seat, Stream } from "@/types/narrative";

const econ = defaultEconomy();

const card = (id: string, streamId: string, outcome: number, cost: number): Card => ({
  id,
  streamId,
  outcome,
  cost,
  origin: "dealt",
});

const seat = (conviction: number): Seat => ({ conviction } as unknown as Seat);

describe("agent — persona aggression", () => {
  it("maps known personas and defaults the rest to 0.5", () => {
    expect(personaAggression("aggressor")).toBe(0.95);
    expect(personaAggression("strategist")).toBe(0.55);
    expect(personaAggression("survivor")).toBe(0.2);
    expect(personaAggression(undefined)).toBe(0.5); // → custom
  });
});

describe("agent — chooseAgentPlays", () => {
  // Two streams; the resolver makes A's leading action the most-decided.
  const hand: Hand = {
    seatId: "s1",
    cards: [card("cA0", "A", 0, 10), card("cA1", "A", 1, 30), card("cB0", "B", 0, 10), card("cB1", "B", 1, 40)],
    played: [],
  };
  const probs = (id: string) => (id === "A" ? [0.7, 0.3] : [0.4, 0.6]);

  it("backs the most-decided stream first, sized between cost and ~3× by aggression", () => {
    const plays = chooseAgentPlays(seat(100), hand, econ, "strategist", probs);
    // strategist aggression 0.55 → maxCards = round(1 + 0.55·2) = 2
    expect(plays).toHaveLength(2);
    // A's leading action (prob 0.7) is committed before B's (0.6)
    expect(plays[0].cardId).toBe("cA0");
    expect(plays[1].cardId).toBe("cB1");
    // each commit covers at least the card's cost
    expect(plays[0].conviction).toBeGreaterThanOrEqual(10);
    expect(plays[1].conviction).toBeGreaterThanOrEqual(40);
    // never overspends the balance
    expect(plays[0].conviction + plays[1].conviction).toBeLessThanOrEqual(100);
  });

  it("an aggressor commits up to the per-round card cap", () => {
    // One candidate is taken per stream, so the cap only bites with ≥3 streams.
    const threeStreamHand: Hand = {
      seatId: "s1",
      cards: [card("cA", "A", 0, 10), card("cB", "B", 0, 10), card("cC", "C", 0, 10), card("cD", "D", 0, 10)],
      played: [],
    };
    const probs3 = (id: string) => (id === "A" ? [0.7, 0.3] : id === "B" ? [0.6, 0.4] : id === "C" ? [0.55, 0.45] : [0.5, 0.5]);
    const plays = chooseAgentPlays(seat(1000), threeStreamHand, econ, "aggressor", probs3);
    // aggressor 0.95 → maxCards = round(1 + 0.95·2) = 3 = CARDS_PER_ROUND
    expect(plays).toHaveLength(econ.cardsPerRound);
  });

  it("sizes a commit down to the remaining balance, and skips what it can't afford", () => {
    const plays = chooseAgentPlays(seat(15), hand, econ, "strategist", probs);
    // 15 covers A0 (cost 10, sized down to 15) but not B1 (cost 40) afterward
    expect(plays).toHaveLength(1);
    expect(plays[0].cardId).toBe("cA0");
    expect(plays[0].conviction).toBe(15);
  });

  it("a broke seat plays nothing", () => {
    expect(chooseAgentPlays(seat(5), hand, econ, "aggressor", probs)).toEqual([]);
  });
});

describe("agent — helpers", () => {
  it("playEvidence delegates to the economy exchange rate", () => {
    expect(playEvidence(23, 23, econ)).toBe(evidenceFromConviction(23, 23, econ));
  });

  it("streamProbsResolver resolves known streams and [] for unknown ids", () => {
    const s: Stream = {
      id: "S",
      perspectiveId: "P",
      title: "S",
      outcomes: ["a", "b"],
      stance: { logits: [1, 0], volume: 2, volatility: 0 },
      state: "open",
      priors: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const resolve = streamProbsResolver({ S: s });
    const p = resolve("S");
    expect(p).toHaveLength(2);
    expect(p[0]).toBeGreaterThan(p[1]); // logit 1 > 0
    expect(p[0] + p[1]).toBeCloseTo(1, 6);
    expect(resolve("missing")).toEqual([]);
  });
});
