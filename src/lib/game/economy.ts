/** Conviction economy — the pure money/evidence math for the rehearsal card
 *  game (CONCEPT.md §Constants & tunables). No state, no IO: card pricing from
 *  rarity, the conviction→evidence→logit exchange rate, and the SETTLE
 *  decay→income step. Everything reads from a `ConvictionEconomy` (the GM's
 *  per-room dials) so a room can be re-tuned between rounds; `defaultEconomy()`
 *  seeds one from the shipped constants. */
import {
  CARDS_PER_ROUND,
  CONVICTION_DECAY,
  CONVICTION_INCOME,
  CONVICTION_START,
  COST_MAX,
  COST_MIN,
  EVIDENCE_GAIN,
  FACEDOWN_PREMIUM,
  RARITY_SCALE,
  RESOLVE_BIAS_DEFAULT,
  STANCE_EVIDENCE_MAX,
  STANCE_EVIDENCE_SENSITIVITY,
} from "@/lib/constants";
import type { ConvictionEconomy } from "@/types/narrative";

/** A fresh economy from the shipped defaults. */
export function defaultEconomy(): ConvictionEconomy {
  return {
    start: CONVICTION_START,
    income: CONVICTION_INCOME,
    decayAlpha: CONVICTION_DECAY,
    costMin: COST_MIN,
    costMax: COST_MAX,
    rarityScale: RARITY_SCALE,
    evidenceGain: EVIDENCE_GAIN,
    cardsPerRound: CARDS_PER_ROUND,
    facedownPremium: FACEDOWN_PREMIUM,
    resolveBias: RESOLVE_BIAS_DEFAULT,
    showdownPhase: true,
    playOrder: "sequential",
  };
}

/** Price of committing a card on an outcome with live probability `p`, on the
 *  intuitive COST_MIN–costMax scale. Improbability IS the price: a near-certain
 *  move floors at COST_MIN (cheap, never free); a long-shot approaches costMax.
 *  cost = clamp(costMin, costMax, round(rarityScale · −ln p)). */
export function cardCost(p: number, economy: ConvictionEconomy): number {
  const costMin = economy.costMin;
  const cap = economy.costUncapped ? Number.MAX_SAFE_INTEGER : economy.costMax;
  // Guard the domain: p≤0 is a 1-in-∞ long-shot (cap costMax); p≥1 is certain (floor).
  if (!(p > 0)) return cap;
  if (p >= 1) return costMin;
  const raw = Math.round(economy.rarityScale * -Math.log(p));
  return Math.max(costMin, Math.min(cap, raw));
}

/** Effective cost actually charged for a play — face-down pays the concealment
 *  premium. (Forced-reveal rooms always play face-up, so faceUp defaults true.) */
export function effectiveCost(cost: number, faceUp: boolean, economy: ConvictionEconomy): number {
  return faceUp ? cost : Math.round(cost * economy.facedownPremium);
}

/** Conviction → evidence, with diminishing returns, capped at the engine band.
 *  Paying the bare `cost` lands a solid e≈2; raising (c > cost) buys more,
 *  concavely, to the +cap (~3× cost). A played card is positive evidence toward
 *  its chosen action, so the result is in [0, STANCE_EVIDENCE_MAX].
 *  e = min(cap, evidenceGain · ln(1 + c/cost)). */
export function evidenceFromConviction(
  conviction: number,
  cost: number,
  economy: ConvictionEconomy,
): number {
  if (!(cost > 0) || !(conviction > 0)) return 0;
  const e = economy.evidenceGain * Math.log(1 + conviction / cost);
  return Math.max(0, Math.min(STANCE_EVIDENCE_MAX, e));
}

/** Evidence → logit nudge, in the stance's own units (matches applyStreamPrior /
 *  applyThreadDelta): Δℓ = e / STANCE_EVIDENCE_SENSITIVITY, so |Δℓ| ≤ 2 per play. */
export function logitNudge(evidence: number): number {
  return evidence / STANCE_EVIDENCE_SENSITIVITY;
}

/** Convenience: the logit nudge a single committed play produces on its outcome. */
export function playLogitNudge(
  conviction: number,
  cost: number,
  economy: ConvictionEconomy,
): number {
  return logitNudge(evidenceFromConviction(conviction, cost, economy));
}

/** SETTLE step: decay the carried balance FIRST, then grant fresh income (so the
 *  new allowance isn't taxed the round it arrives). Clamped at 0 below. With
 *  no-cap accumulation the decay is skipped — the balance carries in full. */
export function settle(balance: number, economy: ConvictionEconomy): number {
  if (economy.accumulationUncapped) return balance + economy.income;
  return Math.max(0, balance * economy.decayAlpha) + economy.income;
}

/** The hoard ceiling — the fixed point income/(1−decay): the dearest possible
 *  play (max card × facedown premium). A perpetual saver converges here, never
 *  a runaway war chest. Infinity when accumulation is uncapped. */
export function convictionCeiling(economy: ConvictionEconomy): number {
  if (economy.accumulationUncapped || economy.decayAlpha >= 1) return Infinity;
  return economy.income / (1 - economy.decayAlpha);
}

/** Whether a seat can afford to play `cost` at face-up/face-down given its
 *  current balance and how many cards it's already committed this round. */
export function canAfford(
  balance: number,
  cost: number,
  faceUp: boolean,
  committedThisRound: number,
  economy: ConvictionEconomy,
): boolean {
  if (committedThisRound >= economy.cardsPerRound) return false;
  return balance >= effectiveCost(cost, faceUp, economy);
}

export type RarityTier = "common" | "uncommon" | "rare" | "legendary";

/** Cost band → rarity tier, for the card's visual treatment (the rarer the bet,
 *  the more it glows). Bands on the COST_MIN–100 scale. */
export function rarityTier(cost: number): RarityTier {
  if (cost >= 90) return "legendary";
  if (cost >= 50) return "rare";
  if (cost >= 15) return "uncommon";
  return "common";
}
