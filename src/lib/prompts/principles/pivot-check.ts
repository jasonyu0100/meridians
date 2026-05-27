/**
 * PIVOT CHECK — the "model post-shift, not the comfortable continuation"
 * discipline.
 *
 * Whenever a previous unit (arc, period, phase) ends at a discontinuity, the
 * next read must branch FROM the post-shift situation. A reading that
 * implicitly denies the pivot is mis-specified — it's modelling the world
 * the operator no longer lives in.
 *
 * Used by: Compass cohort generation, Present extraction, scenario rescoring,
 * direction proposal, CRG generation.
 */

export const PRINCIPLE_PIVOT_CHECK = `PIVOT CHECK. If the previous unit ends at a discontinuity — regime collapse, temporal pivot, irreversible commitment, paradigm break, structural rupture, exit of a load-bearing actor, methodological reframe that supersedes prior claims, one-way institutional/technological change — the next read branches FROM the post-shift situation. Pre-shift variables are history. A read in which the pivot didn't happen is mis-specified; score it sharply low and say so.`;
