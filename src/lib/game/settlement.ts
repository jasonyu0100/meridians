/** Conviction settlement — how a contested thread picks a winner when committed
 *  claims conflict (CONCEPT.md §Contested settlement). PURE + DETERMINISTIC: the
 *  AI's only job upstream is detect-and-map (which committed bearings can't both
 *  hold → competing outcomes of the shared thread); once mapped, conviction
 *  becomes logit nudges, p° = softmax(ℓ⁻ + nudges), and this module settles per
 *  `RESOLVE_BIAS`. The `random` draw is SEEDED so a reload reproduces it and the
 *  SHOWDOWN phase can "show the roll" — never Math.random(). */
import { softmax } from "@/lib/forces/narrative-utils";
import type { ResolveBias } from "@/types/narrative";

/** mulberry32 — a tiny, fast, fully-deterministic PRNG. Same seed → same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The contested distribution p° = softmax(ℓ⁻ + per-outcome nudges). */
export function contestOdds(baseLogits: number[], nudges: number[]): number[] {
  return softmax(baseLogits.map((l, k) => l + (nudges[k] ?? 0)));
}

/** Sample an outcome index from a distribution given a uniform u ∈ [0,1). */
export function sampleFromDistribution(p: number[], u: number): number {
  let acc = 0;
  for (let k = 0; k < p.length; k++) {
    acc += p[k];
    if (u < acc) return k;
  }
  return p.length - 1; // float-error fallback
}

function argmin(p: number[]): number {
  let best = 0;
  for (let k = 1; k < p.length; k++) if (p[k] < p[best]) best = k;
  return best;
}

export interface SettlementResult {
  /** p° the rule read. */
  pStar: number[];
  /** The selected outcome index, or null under `gm` (the GM decides by hand). */
  drawnOutcome: number | null;
  /** The seed actually used for the draw (echoed for audit; null when unused). */
  seed: number | null;
}

/** Settle a contested thread per the GM's RESOLVE_BIAS:
 *  - random      → Fate draws ~ p° (seeded). Buy better odds, not the outcome.
 *  - highest-cost→ the rarest contested outcome is forced through.
 *  - realism     → no deterministic pick; the AI realism call decides upstream
 *                  (drawnOutcome = null). */
export function settleContest(
  bias: ResolveBias,
  baseLogits: number[],
  nudges: number[],
  seed: number,
): SettlementResult {
  const pStar = contestOdds(baseLogits, nudges);
  switch (bias) {
    case "random": {
      const u = mulberry32(seed)();
      return { pStar, drawnOutcome: sampleFromDistribution(pStar, u), seed };
    }
    case "highest-cost":
      return { pStar, drawnOutcome: argmin(pStar), seed: null };
    case "realism":
      return { pStar, drawnOutcome: null, seed: null };
  }
}

/** A stable per-(round, thread) seed so a reload reproduces the same draw.
 *  Combines a room-level seed base with round index + a thread hash. */
export function settlementSeed(base: number, roundIndex: number, threadId: string): number {
  let h = base ^ (roundIndex * 0x9e3779b1);
  for (let i = 0; i < threadId.length; i++) {
    h = Math.imul(h ^ threadId.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}
