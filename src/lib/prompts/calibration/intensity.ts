/**
 * INTENSITY — the 0–4 variable-magnitude scale.
 *
 * Every variable (Present, Compass, scenario activations) carries an
 * intensity 0–4 with the same anchors everywhere. 0 means "off / not
 * activated" — typically omitted in cohort activations rather than emitted.
 *
 * Calibrated identically across surfaces so a +3 in a Compass direction's
 * activation means the same thing as a +3 in a Present coordination.
 */

/** Level definitions — single source of truth for labels, descriptions, and
 *  numeric ordering. */
export const INTENSITY_LEVELS = [
  { idx: 0, label: '—',       desc: 'off — variable not activated' },
  { idx: 1, label: 'weak',    desc: 'a hint, easily missed' },
  { idx: 2, label: 'mild',    desc: 'present but contained' },
  { idx: 3, label: 'strong',  desc: 'a clear inflection' },
  { idx: 4, label: 'extreme', desc: 'tail-event amplitude' },
] as const;

export type IntensityLevel = (typeof INTENSITY_LEVELS)[number];

/** Coerce any value into a valid intensity (0–4 integer). Used by parsers
 *  to defend against malformed LLM output. */
export function clampIntensity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(4, Math.round(value)));
}

/** Label for an intensity value; falls back to '?' for out-of-range. */
export function intensityLabel(value: number): string {
  const level = INTENSITY_LEVELS[clampIntensity(value)];
  return level?.label ?? '?';
}

/** Prompt block — the canonical scale. Include in any system prompt that
 *  asks the model to emit or interpret an intensity. */
export const INTENSITY_PROMPT = `INTENSITY — every variable carries a magnitude on the 0–4 scale, calibrated identically across surfaces (Present, Compass directions, scenario activations):
  0  off — not activated (omit from activations rather than emit a 0)
  1  weak — a hint, easily missed
  2  mild — present but contained
  3  strong — a clear inflection
  4  extreme — tail-event amplitude

Intensity carries MAGNITUDE. PriorLogit (separate calibrated field) carries PLAUSIBILITY / RECOMMENDATION STRENGTH. They are INDEPENDENT — a high-intensity rupture can be high-prior if evidence supports it; a low-intensity continuation can be low-prior if it conflicts with the trajectory. Score amplitude and plausibility separately.`;

/** Compact reminder for prompts that reference intensity without restating
 *  the full scale. */
export const INTENSITY_REMINDER =
  'intensity 1–4 (1 weak, 2 mild, 3 strong, 4 extreme; omit 0 / not activated). Independent of priorLogit — intensity is magnitude, logit is plausibility / recommendation strength.';

/** Schema fragment for an intensity field. */
export const INTENSITY_SCHEMA_FRAGMENT = `"intensity": <integer 1..4>`;
