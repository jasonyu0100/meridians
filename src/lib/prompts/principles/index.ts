/**
 * Principles — named composable discipline blocks shared across prompts.
 *
 * Each principle is the canonical statement of a discipline the engine
 * applies in multiple places. Prompts COMPOSE them by reference instead of
 * restating them. One edit propagates; no drift between surfaces.
 *
 * Pair with `calibration/` (numeric scales, inference-shape) — together
 * they form the foundation layer prompts build on.
 */

export { PRINCIPLE_SURFACE_VS_SUBSTRATE } from './surface-vs-substrate';
export { PRINCIPLE_PIVOT_CHECK } from './pivot-check';
export { PRINCIPLE_READ_MECHANISMS } from './read-mechanisms';
export { PRINCIPLE_POWER_LAW_SHAPE } from './power-law-shape';
export { PRINCIPLE_PARADIGM_FIDELITY } from './paradigm-fidelity';

/** Convenience: the three "universal disciplines" most reasoning surfaces
 *  share. Composes substrate + mechanisms + pivot as a single block. Most
 *  prompts that need "discipline" want exactly this trio. */
export const PRINCIPLES_UNIVERSAL_DISCIPLINES = [
  '  • SURFACE vs SUBSTRATE. Name FORCES, not symptoms. Symptoms are visible (prices fall, a study gets cited, a character argues); forces are what cascade to produce them. Reach one layer below the visible.',
  '  • PIVOT CHECK. If the arc ends at a discontinuity — regime collapse, temporal pivot, irreversible commitment, paradigm break, structural rupture, exit of a load-bearing actor, methodological reframe that supersedes prior claims, one-way institutional/technological change — the cohort branches FROM the post-shift situation. A read in which the pivot didn\'t happen is mis-specified.',
  '  • READ THE MECHANISMS. Artifacts and key actors carry the operative rules and capabilities loaded into the world. Their world-graph nodes define what\'s POSSIBLE. An unactivated mechanism / unused method / unaddressed source is a strong candidate.',
].join('\n');
