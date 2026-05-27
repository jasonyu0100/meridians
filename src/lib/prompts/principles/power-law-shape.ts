/**
 * POWER-LAW SHAPE — the "cohort matches reality's distribution" discipline.
 *
 * Real continuations distribute power-law: many cluster near modal
 * continuation (substrate barely moves, a few intensities shift), a few
 * rupture (a low-prior mechanism fires, an attractor catches, a paradigm
 * break lands). A cohort forced toward gradualism erases the tail; a cohort
 * forced toward diversity inflates noise. The shape of the cohort must
 * match the shape of the distribution it's drawn from.
 *
 * Used by: Compass cohort generation, scenario rescoring, briefing moves.
 */

export const PRINCIPLE_POWER_LAW_SHAPE = `POWER-LAW SHAPE — not gradualism, not forced diversity.
Real continuations distribute power-law: many cluster near modal continuation (the substrate barely moves, a few intensities shift), a few rupture (a low-prior mechanism fires, an attractor catches, a load-bearing actor reverses, a paradigm break lands). Match the SHAPE of the distribution the situation actually presents:
  • Tight possibility space → tight cohort.
  • Bimodal → most reads near one mode, a few near the other.
  • Fat-tailed → a few extreme tails sit alongside the cluster.
Probabilities (priorLogits) carry the rarity; intensity carries the magnitude. Don't pad to look thorough, don't trim to look clean. The world is mostly still, then changes overnight — honour that unevenness.`;
