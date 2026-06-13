/**
 * Compass framing — per-paradigm interpretation of the Compass surface.
 *
 * The Compass is the engine's forward-looking surface — a probability
 * distribution over feasible next directions, grounded in a factor model
 * (variables) of the work's reality. The interpretation of those
 * probabilities is paradigm-dependent:
 *
 *   • SIMULATION — PRECISION PREDICTION. The rule set is load-bearing;
 *     the cohort approximates the modelled distribution of outcomes.
 *     PriorLogits are the model's probability assignments. Tail scenarios
 *     are tail events.
 *
 *   • EVERY OTHER PARADIGM — RECOMMENDATION. The factor model is
 *     editorial / argumentative / typological / chronicled; the cohort is
 *     a curated set of high-leverage next moves. PriorLogits express how
 *     strongly the paradigm's compass pulls toward each. The cohort is
 *     what the engine thinks the operator SHOULD consider going next, not
 *     a forecast of what will objectively happen.
 *
 * Both interpretations use the same machinery (variables, priorLogits,
 * softmax) — what changes is what the operator should READ from the cohort.
 */

import type { NarrativeParadigm } from '@/types/narrative';

/** Per-paradigm framing of the compass surface. Single sentence; used to
 *  prefix forward-looking prompts (Compass cohort generation, Present
 *  extraction, scenario rescore, arc-direction proposal). */
export const COMPASS_FRAMING_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'COMPASS MODE: editorial recommendation. The factor model surfaces narrative drivers; the cohort recommends high-leverage next directions — which dramatic continuations the work\'s register and accumulated commitments most support. PriorLogits express editorial pull, not external probability.',
  'non-fiction': 'COMPASS MODE: editorial recommendation anchored to the record. The factor model surfaces documented drivers (open questions, contested evidence, under-explored figures); the cohort recommends investigative directions the record actually supports. PriorLogits express how strongly the existing evidence pulls toward each.',
  'simulation':  'COMPASS MODE: precision prediction. The rule set is load-bearing; the factor model names the rule-driven drivers; the cohort approximates what the modelled system will DO under different conditions. PriorLogits are probability assignments under the model — this is forecasting, not authorial recommendation. Authorial "rescue" is paradigm error.',
  'essay':       'COMPASS MODE: argumentative recommendation. The factor model surfaces argument drivers (live claims, methodological commitments, counterposition reach); the cohort recommends next argumentative moves — which claim to defend, which counter-position to engage. PriorLogits express argumentative leverage, not external probability.',
  'panel':       'COMPASS MODE: deliberative recommendation. The factor model surfaces the panel\'s active commitments and dissent vectors; the cohort recommends next cognitive moves — which scenario to model, which dissent to surface, which evidence to weigh. PriorLogits express deliberative leverage, not external probability.',
  'atlas':       'COMPASS MODE: typological recommendation. The factor model surfaces classification drivers (gaps, edge-cases, cross-reference asymmetries); the cohort recommends next sections of the typology — which entries to add, which sub-classification to articulate. PriorLogits express structural leverage, not external probability.',
  'debate':      'COMPASS MODE: strategic recommendation. The factor model surfaces contest drivers (axes of contestation, rule activations, leverage shifts); the cohort recommends next moves under the contest\'s rules — which move to make, which axis to target. PriorLogits express strategic leverage AS the contest plays out, not an external forecast.',
  'record':      'COMPASS MODE: chronicle recommendation. The factor model surfaces trajectory drivers (long-running trends, regime changes, figures whose state is shifting); the cohort recommends what the next entry should record at the declared time velocity. PriorLogits express trajectory pull, not external probability.',
  'scenario':    'COMPASS MODE: strategic recommendation within the modelled moment. The factor model surfaces scenario drivers (actors\' positions, capabilities and resources, information asymmetries, alliance vectors, the operative dynamics and their pressure points, the live stakes); the cohort recommends next moves available to the actors from the current state, scored by strategic leverage under the moment\'s own dynamics. PriorLogits express how the dynamics + current state pull toward each move — a rehearsal of how the moment could go, not an external probability forecast.',
};

/** Compass framing line for a paradigm. When unset, falls back to a framing
 *  that names both interpretations and lets the model adapt to the source. */
export function compassFramingFor(paradigm: NarrativeParadigm | undefined): string {
  return paradigm
    ? COMPASS_FRAMING_BY_PARADIGM[paradigm]
    : 'COMPASS MODE: paradigm-adaptive. In a simulation register the cohort is precision prediction under the modelled rules; in every other register the cohort is recommendation — high-leverage next directions the work\'s substrate and accumulated commitments pull toward. Match the read to what the work actually is.';
}
