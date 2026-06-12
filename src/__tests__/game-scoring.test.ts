import { describe, expect, it } from "vitest";

import {
  conservationError,
  scoreRound,
  scoreThread,
  type ThreadAttribution,
} from "@/lib/game/scoring";

/** A 3-outcome thread that moved, with two seats' shares + a Fate residual. */
function fixture(): ThreadAttribution {
  return {
    threadId: "T1",
    logitsBefore: [0, 0, 0],
    logitsAfter: [1.4, -0.3, 0.1], // realized Δℓ
    volume: 3,
    shares: {
      A: [0.9, -0.1, 0], // A pushed outcome 0
      B: [0.3, 0, 0.1], // B nudged outcome 0 a little + outcome 2
      // residual to Fate: Δℓ − (A+B) = [0.2, -0.2, 0]
    },
  };
}

describe("conviction scoring — conservation (the load-bearing axiom)", () => {
  it("Σ FateCredit + houseBand ≈ totalFate, exactly", () => {
    const s = scoreThread(fixture());
    expect(conservationError(s)).toBeLessThan(1e-6);
  });

  it("holds across randomized threads", () => {
    for (let trial = 0; trial < 50; trial++) {
      const K = 2 + (trial % 3); // 2–4 outcomes
      const before = Array.from({ length: K }, (_, k) => Math.sin(trial * 1.7 + k) * 2);
      const after = before.map((x, k) => x + Math.cos(trial * 0.9 + k * 1.3) * 1.5);
      const shareA = before.map((_, k) => Math.sin(trial + k) * 0.4);
      const shareB = before.map((_, k) => Math.cos(trial * 1.1 + k) * 0.3);
      const s = scoreThread({
        threadId: `T${trial}`,
        logitsBefore: before,
        logitsAfter: after,
        volume: 1 + (trial % 5),
        shares: { A: shareA, B: shareB },
      });
      expect(conservationError(s)).toBeLessThan(1e-7);
    }
  });
});

describe("conviction scoring — Shapley axioms", () => {
  it("symmetry: equal shares earn equal credit", () => {
    const s = scoreThread({
      threadId: "T",
      logitsBefore: [0, 0, 0],
      logitsAfter: [1.2, -0.6, 0],
      volume: 2,
      shares: { A: [0.6, -0.3, 0], B: [0.6, -0.3, 0] },
    });
    expect(s.fateCredits.A).toBeCloseTo(s.fateCredits.B, 9);
  });

  it("dummy: a zero share earns nothing", () => {
    const s = scoreThread({
      threadId: "T",
      logitsBefore: [0, 0],
      logitsAfter: [1, -1],
      volume: 2,
      shares: { A: [1, -1], Z: [0, 0] },
    });
    expect(s.fateCredits.Z).toBeCloseTo(0, 9);
  });

  it("signed: pushing the odds against the realized shift scores negative", () => {
    const s = scoreThread({
      threadId: "T",
      logitsBefore: [0, 0],
      logitsAfter: [1.5, -1.5], // realized moved toward outcome 0
      volume: 2,
      shares: {
        Aligned: [1.2, -1.2], // with the shift
        Against: [-0.4, 0.4], // against the shift
      },
    });
    expect(s.fateCredits.Aligned).toBeGreaterThan(0);
    expect(s.fateCredits.Against).toBeLessThan(0);
  });

  it("more conviction in the realized direction earns strictly more credit", () => {
    const mk = (mag: number) =>
      scoreThread({
        threadId: "T",
        logitsBefore: [0, 0],
        logitsAfter: [1.5, -1.5],
        volume: 1,
        shares: { A: [mag, -mag], B: [0.2, -0.2] },
      }).fateCredits.A;
    expect(mk(1.0)).toBeGreaterThan(mk(0.5));
  });
});

describe("scoreRound", () => {
  it("sums credits and conserves across threads", () => {
    const r = scoreRound([fixture(), { ...fixture(), threadId: "T2" }]);
    const seatSum = Object.values(r.perSeat).reduce((a, b) => a + b, 0);
    expect(seatSum + r.houseBand).toBeCloseTo(r.total, 7);
    expect(r.threads).toHaveLength(2);
  });
});
