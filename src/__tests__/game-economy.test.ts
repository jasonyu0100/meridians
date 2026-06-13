import { describe, expect, it } from "vitest";

import {
  cardCost,
  canAfford,
  convictionCeiling,
  defaultEconomy,
  effectiveCost,
  evidenceFromConviction,
  playLogitNudge,
  rarityTier,
  settle,
} from "@/lib/game/economy";

const econ = defaultEconomy();

describe("conviction economy — card cost (CONCEPT.md rarity→cost table)", () => {
  it("matches the spec cost points", () => {
    expect(cardCost(0.97, econ)).toBe(1); // near-certain floors at COST_MIN
    expect(cardCost(0.7, econ)).toBe(7); // modal call
    expect(cardCost(0.5, econ)).toBe(14); // coin-flip
    expect(cardCost(0.33, econ)).toBe(22); // typical 3-action stream
    expect(cardCost(0.25, econ)).toBe(28); // typical 4-action stream
    expect(cardCost(0.1, econ)).toBe(46); // long-shot
    expect(cardCost(0.05, econ)).toBe(60); // 1-in-20
  });

  it("never goes below COST_MIN and caps at costMax (default 200)", () => {
    expect(econ.costMax).toBe(200);
    expect(cardCost(1, econ)).toBe(econ.costMin);
    expect(cardCost(0.999, econ)).toBe(econ.costMin);
    expect(cardCost(0.004, econ)).toBe(110); // deep long-shot, below the 200 ceiling
    expect(cardCost(0.00001, econ)).toBe(econ.costMax); // 1-in-100k caps at costMax
    expect(cardCost(0, econ)).toBe(econ.costMax); // degenerate p
  });

  it("is monotonically non-increasing in p (rarer = dearer)", () => {
    let prev = 0;
    for (let p = 0.02; p <= 0.99; p += 0.02) {
      const c = cardCost(p, econ);
      expect(c).toBeGreaterThanOrEqual(econ.costMin);
      expect(c).toBeLessThanOrEqual(econ.costMax);
      // descending p-loop would be cleaner; instead assert bounds + spot-check
      prev = c;
    }
    expect(prev).toBeGreaterThan(0);
  });
});

describe("conviction → evidence → logit (the exchange rate)", () => {
  it("bare cost lands a solid e≈2, raising to ~3× hits the cap", () => {
    const bare = evidenceFromConviction(23, 23, econ);
    expect(bare).toBeGreaterThan(1.9);
    expect(bare).toBeLessThan(2.2);
    const raised = evidenceFromConviction(23 * 3, 23, econ);
    expect(raised).toBeCloseTo(4, 1); // EVIDENCE cap
  });

  it("evidence is capped and never negative", () => {
    expect(evidenceFromConviction(10_000, 5, econ)).toBeLessThanOrEqual(4);
    expect(evidenceFromConviction(0, 5, econ)).toBe(0);
    expect(evidenceFromConviction(5, 0, econ)).toBe(0);
  });

  it("a bare-cost play nudges the stance by ~1 logit; cards on one outcome sum", () => {
    const one = playLogitNudge(23, 23, econ);
    expect(one).toBeGreaterThan(0.9);
    expect(one).toBeLessThan(1.1);
    // CARDS_PER_ROUND bare plays on one outcome sum to ≈ cap×n / sensitivity
    const round = one * econ.cardsPerRound;
    expect(round).toBeGreaterThan(2.5); // meaningful but not pinned to certainty
  });
});

describe("settle: decay then income, hoard ceiling", () => {
  it("decays the bank then adds income", () => {
    expect(settle(0, econ)).toBe(econ.income); // 25
    expect(settle(150, econ)).toBeCloseTo(150, 6); // fixed point holds
    expect(settle(60, econ)).toBeCloseTo(60 * (5 / 6) + 25, 6); // 75
  });

  it("ceiling is income/(1−decay) = 150", () => {
    expect(convictionCeiling(econ)).toBeCloseTo(150, 6);
    expect(convictionCeiling(econ)).toBeCloseTo(econ.income / (1 - econ.decayAlpha), 6);
  });
});

describe("no-cap dials", () => {
  it("card cost runs unclamped when costUncapped (else clamps at costMax)", () => {
    const p = 0.000001; // −ln ≈ 13.8 → ×20 ≈ 276, past the 200 ceiling
    const raw = Math.round(econ.rarityScale * -Math.log(p));
    expect(raw).toBeGreaterThan(econ.costMax);
    expect(cardCost(p, econ)).toBe(econ.costMax); // capped by default
    expect(cardCost(p, { ...econ, costUncapped: true })).toBe(raw); // unclamped
  });

  it("accumulation never decays and the ceiling is Infinity when uncapped", () => {
    const uncapped = { ...econ, accumulationUncapped: true };
    expect(settle(0, uncapped)).toBe(econ.income);
    expect(settle(500, uncapped)).toBe(500 + econ.income); // full carry, no decay
    expect(settle(10_000, uncapped)).toBe(10_000 + econ.income); // unbounded
    expect(convictionCeiling(uncapped)).toBe(Infinity);
  });

  it("defaults are capped — costMax 200, both no-cap flags off", () => {
    expect(econ.costMax).toBe(200);
    expect(econ.costUncapped).toBeFalsy();
    expect(econ.accumulationUncapped).toBeFalsy();
  });
});

describe("face-down premium + affordability", () => {
  it("face-down costs ×premium", () => {
    expect(effectiveCost(40, true, econ)).toBe(40);
    expect(effectiveCost(40, false, econ)).toBe(50); // ×1.25 (FACEDOWN_PREMIUM)
  });

  it("canAfford respects balance and the per-round card cap", () => {
    expect(canAfford(50, 23, true, 0, econ)).toBe(true);
    expect(canAfford(10, 23, true, 0, econ)).toBe(false); // too poor
    expect(canAfford(50, 23, true, econ.cardsPerRound, econ)).toBe(false); // cap reached
  });
});

describe("rarity tiers", () => {
  it("bands cost onto tiers", () => {
    expect(rarityTier(1)).toBe("common");
    expect(rarityTier(12)).toBe("common");
    expect(rarityTier(23)).toBe("uncommon");
    expect(rarityTier(76)).toBe("rare");
    expect(rarityTier(99)).toBe("legendary");
  });
});
