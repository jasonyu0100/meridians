/**
 * PRIOR-LOGIT — the [-4, +4] log-odds scale.
 *
 * The same numeric scale underwrites every probability-shaped surface:
 * thread-market evidence, Compass scenario priors, Present coordination
 * self-estimates, scenario rescoring. Calibrated identically so the operator
 * reads "+3" the same way regardless of where it surfaces.
 *
 * The operator READ of a priorLogit depends on the work's COMPASS MODE:
 *   • SIMULATION — precision prediction. PriorLogit is the model's
 *     probability assignment under the rules.
 *   • EVERY OTHER PARADIGM — recommendation. PriorLogit is the strength
 *     with which the paradigm's compass PULLS toward this direction.
 *
 * Same machinery, different operator read. See `paradigm-roles.ts`'s
 * `compassFramingFor` for the per-paradigm framing line.
 */

import { MARKET_EVIDENCE_MAX, MARKET_EVIDENCE_MIN } from '@/lib/constants';

/** Numeric range, anchored to the prediction-market evidence scale so all
 *  probability-shaped surfaces speak the same units. */
export const PRIOR_LOGIT_MIN = MARKET_EVIDENCE_MIN; // -4
export const PRIOR_LOGIT_MAX = MARKET_EVIDENCE_MAX; // +4

/** Clamp a value into the prior-logit range. */
export function clampPriorLogit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(PRIOR_LOGIT_MIN, Math.min(PRIOR_LOGIT_MAX, value));
}

/** Natural-language band for a logit value — used in chat, briefings, and
 *  reasoning rendering so the qualitative read is consistent. */
export function priorLogitRarityLabel(logit: number): string {
  if (logit >= 3) return 'expected';
  if (logit >= 1) return 'likely';
  if (logit >= -1) return 'even';
  if (logit >= -3) return 'rare';
  return 'tail-event';
}

/** Prompt block — the canonical priorLogit scale with the compass-mode
 *  read. Include in any system prompt that asks the model to emit, score,
 *  or interpret a priorLogit. */
export const PRIOR_LOGIT_PROMPT = `PRIOR-LOGIT — the [-4, +4] log-odds scale shared across every probability-shaped surface (thread evidence, Compass directions, Present self-estimates, rescoring). Same numeric anchors everywhere:
   +4  decisive evidence in favour / strongly-recommended direction
   +2  strongly supported / clearly pulled-toward
    0  baseline plausibility
   -2  needs a specific catalyst / substrate weakly resists
   -4  decisive evidence against / actively-resisted direction / rare tail conditions

How to READ priorLogit depends on the work's COMPASS MODE (declared in the work-identity block at the top of the system prompt):
  • SIMULATION — PRECISION PREDICTION. PriorLogit is the model's probability assignment under the rules. A +3 is a likely modelled outcome; a -3 is a tail event the rules make rare. Authorial rescue is paradigm error.
  • EVERY OTHER PARADIGM — RECOMMENDATION. PriorLogit is the strength with which the paradigm's compass PULLS toward this read. A +3 isn't "likely to happen" — it's "strongly recommended given the substrate". A -3 isn't "unlikely" — it's "the substrate actively resists this unless a specific catalyst fires."

When a cohort of priorLogits is rendered for the operator, displayed PROBABILITY is softmax across that cohort — relative, not absolute. Two consequences:
  1. The cohort is a REPRESENTATIVE SAMPLE — not exhaustive. More items fragments probability mass.
  2. Score relative to siblings; USE THE FULL [-4, +4] RANGE. Compressed scores collapse the softmax to uniform and erase information.

PriorLogit is INDEPENDENT of intensity. A high-intensity rupture can be high-prior if evidence supports it; a low-intensity continuation can be low-prior if it conflicts with the trajectory. Score the read's plausibility (or recommendation strength), not its amplitude.`;

/** Compact reminder for prompts that reference the scale without restating
 *  it. */
export const PRIOR_LOGIT_REMINDER =
  'priorLogit ∈ [-4, +4]; same scale as thread evidence and across every probability-shaped surface. Read as PREDICTION in simulation, RECOMMENDATION strength in every other paradigm. Use the full range.';

/** Schema fragment for the priorLogit field. */
export const PRIOR_LOGIT_SCHEMA_FRAGMENT = `"priorLogit": <number in [-4, +4]>`;

/** The natural-language rarity bands as a legend — useful for renderers
 *  that want to expose the scale to operators. */
export const PRIOR_LOGIT_BANDS: ReadonlyArray<{
  range: readonly [number, number];
  label: string;
}> = [
  { range: [3, 4], label: 'expected' },
  { range: [1, 3], label: 'likely' },
  { range: [-1, 1], label: 'even' },
  { range: [-3, -1], label: 'rare' },
  { range: [-4, -3], label: 'tail-event' },
];
