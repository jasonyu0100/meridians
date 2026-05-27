/**
 * Paradigm-aware system-prompt composers for the COMPASS surfaces.
 *
 * The Compass is the engine's forward-looking direction-finder — a probability
 * distribution over feasible next moves grounded in a factor model (variables)
 * of the work's reality. Three system prompts share this machinery:
 *
 *   • Present extraction — the arc's current factor-model snapshot.
 *   • Compass cohort generation — a softmax-weighted set of next directions.
 *   • Cohort rescore — re-evaluate one scenario after the operator edits it.
 *
 * Pattern (mirror of paradigm-analyst.ts):
 *   identity (composeAnalystIdentity)
 *     + compass framing (compassFramingFor)
 *     + per-paradigm LENS (what the compass looks like in this paradigm)
 *     + per-surface body (Present / Cohort / Rescore)
 *     + shared discipline + output schema
 *
 * Why case-based: the legacy prompts each carried a ~1500-word register-and-
 * paradigm switch teaching the model to detect the paradigm at runtime.
 * Now that the operator declares paradigm + genre + subgenre upfront, we
 * dispatch at build time — each paradigm gets a focused ~150-word lens that
 * speaks its native vocabulary, instead of a sprawling cover-everything block.
 */

import type { NarrativeParadigm } from '@/types/narrative';
import {
  INFERENCE_SHAPE_PROMPT,
  INFERENCE_SHAPE_SCHEMA_FRAGMENT,
  INTENSITY_REMINDER,
  PRIOR_LOGIT_PROMPT,
  PRIOR_LOGIT_SCHEMA_FRAGMENT,
} from './calibration';
import {
  PRINCIPLE_PARADIGM_FIDELITY,
  PRINCIPLE_POWER_LAW_SHAPE,
  PRINCIPLES_UNIVERSAL_DISCIPLINES,
} from './principles';
import {
  compassFramingFor,
  composeAnalystIdentity,
  type WorkIdentity,
} from './paradigm-roles';
import { workIdentityFor } from './paradigm-analyst';

export { workIdentityFor };
export type { WorkIdentity };

// ─── Per-paradigm Compass lens ──────────────────────────────────────────────
//
// Each lens is the tight paradigm-specific framing all three Compass surfaces
// share — what "continuation" / "factor" / "load-bearing" looks like HERE.
// Keep to ~150 words; the surface-specific body adds whatever discipline the
// surface needs on top.

const COMPASS_LENS_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction': `COMPASS LENS — fiction.
Continuations are next-arc moves: thread pivots, character commitments, scene-level inflections, world reveals.
Forward-motion shape depends on subgenre — rising stakes, alliance shifts, revelation cascades, mentor exits, the protagonist's commitment hardening.
Native attractors: thematic resolution, unresolved threads' gravity, character trajectories already set.
Natural cadence: subgenre-driven — slow burn with rare ruptures (literary realism), stacked inflections (thriller), monotonic escalation (action), oscillating (mystery), tier-paced (cultivation / progression).
Tail vocabulary: subgenre-specific rupture (the detective IS the killer, the mentor was the villain, the war was never going to be won, the breakthrough fails).
Pool variables name DRAMATIC FORCES — character commitments, thread pressures, alliance dynamics, world reveals, latent rules. Not "antagonist pressure" or "rising tension" — name the specific dynamic.`,

  'non-fiction': `COMPASS LENS — non-fiction.
Continuations are next-arc moves anchored to the documented record: investigations that open, evidence that surfaces, figures whose state shifts, contested attributions that get resolved.
Forward-motion shape: investigative deepening, evidence accumulation, contested-claim resolution, figure-trajectory shifts.
Native attractors: the question the work is pursuing, the gaps in the record the work names, the institutions or sources the work is interrogating.
Natural cadence: paced by what the record actually supports — periods of dense evidence followed by gaps the work has to name honestly.
Tail vocabulary: subgenre-specific rupture (a new primary source surfacing, a figure recanting, an institutional record opening, a counter-attribution landing). Never fabrication.
Pool variables name DOCUMENTED DRIVERS — evidentiary pressures, contested attributions, under-explored figures, institutional dynamics. Tied to the record, not invented.`,

  'simulation': `COMPASS LENS — simulation. THIS IS PRECISION PREDICTION.
The rule set is load-bearing. Continuations are what the modelled system DOES next under the rules — state transitions, threshold crossings, rule-driven outcomes, agent reactions, regime changes.
Forward-motion shape: rule-driven — what the rules force as conditions evolve. The compass is forecasting, not authorial pull.
Native attractors: the rule set's own attractors — equilibria the model reaches, thresholds it crosses, regimes it propagates into.
Natural cadence: governed by the model's own dynamics (Re slope, force concentration build-up, tier-pressure accumulation, monsoon window, propagation regime).
Tail vocabulary: the model's own tail events — paradigm-specific (immune escape, doctrine inversion, supply-chain cascade failure, succession-charter rupture, climate threshold breach).
Pool variables name RULE-DRIVEN DRIVERS — decision rules, threshold proximities, agent stances under the rule set, propagation regimes, mechanism activations. Score what the rules force; authorial rescue is paradigm error.`,

  'essay': `COMPASS LENS — essay.
"Continuations" are next argumentative moves: claims to advance, counter-positions to engage, qualifications to add, methodological pivots, scope shifts, sister-questions, evidence to incorporate, objections to anticipate.
Forward-motion shape: argument deepening, counter-position engagement, qualification, scope refinement. NOT events.
Native attractors: the thesis the author is building toward, the cited interlocutors whose positions remain unengaged, the methodological commitments not yet articulated.
Natural cadence: claim → evidence → objection → qualification → conclusion (or honest deferral). Subgenre adjusts the shape — empirical findings cycle faster than systematic reviews.
Tail vocabulary: argumentative rupture — Kuhnian paradigm shift, methodological reversal, counter-claim ascendance, scope collapse.
Pool variables name ARGUMENTATIVE FORCES — live claims, methodological commitments, evidentiary pressures, counterposition reach, scope tension, sources contested, theoretical assumptions binding. NOT character pressures or thread tensions.`,

  'panel': `COMPASS LENS — panel.
"Continuations" are next cognitive moves over EXISTING evidence: dissent the panel surfaces, scenarios it models explicitly, evidence packets it re-reads, sub-investigations a member advances.
Forward-motion shape: cognitive — synthesis tightening, dissent deepening, scenario refinement. NOT invented forward-time events.
Native attractors: the panel's shared question, each member's methodological priors, the gap in the panel's evidence base.
Natural cadence: deliberation cycles — claim → dissent → re-reading → synthesis (or honest stall). Subgenre adjusts depth.
Tail vocabulary: panel rupture — the dissenter convinces the synthesiser, a methodological commitment breaks, the panel's shared question reveals itself as mis-framed, evidence forces a re-scoping.
Pool variables name DELIBERATIVE FORCES — panel members' active commitments, dissent vectors, evidence gaps, sub-investigation pressures, methodological priors loaded into the cohort. NOT external invented events.`,

  'atlas': `COMPASS LENS — atlas.
"Continuations" are next typological moves: entries to add, sub-classifications to articulate, cross-references to formalise, classification edge-cases to resolve.
Forward-motion shape: classification deepening, cross-reference densification, sub-typology articulation. NO arcs, NO events.
Native attractors: gaps in the typology, edge-cases the curator has flagged, asymmetric cross-references, dependencies under-articulated.
Natural cadence: structural — additions follow classification logic, not narrative or temporal order.
Tail vocabulary: typological rupture — re-classification of a load-bearing entry, dissolution of a category, discovery of a missing axis the typology hadn't covered.
Pool variables name TYPOLOGICAL FORCES — classification asymmetries, edge-cases, cross-reference gaps, sub-classification pressures, structural dependencies. NOT character arcs, NOT events.`,

  'debate': `COMPASS LENS — debate.
"Continuations" are next moves in the contest under its rules: motions, witnesses, evidentiary plays, rule invocations, surrogate deployments, the next axis to contest.
Forward-motion shape: move-by-move strategic — each move attributed to a contestant, targeting a specific axis, scored under the contest's rules.
Native attractors: the contest's own axes of contestation, the arbiter's stated priors, the rules' triggering conditions.
Natural cadence: move-and-response — each contestant's move opens space for the other's. Subgenre adjusts pace (a trial paces differently than an election or M&A negotiation).
Tail vocabulary: contest rupture — a rule firing that voids the contest, an arbiter recusal, a contestant withdrawing, a witness reversing.
Pool variables name STRATEGIC FORCES — axes of contestation, rule activations, leverage shifts, contestant postures, arbiter signals. Score strategic leverage AS the contest plays out — not external forecast.`,

  'record': `COMPASS LENS — record / chronicle.
"Continuations" are the next period's chronicle entries at the declared time velocity (daily / monthly / yearly / dynamic): trajectories that continue, regime changes that crystallise, figures whose state shifts enough to log.
Forward-motion shape: trajectory accumulation across dated entries. Threads are long-running pulls, not arcs that dramatically resolve.
Native attractors: the chronicled trends, the institutional rhythms, the figures whose trajectories are under-recorded.
Natural cadence: paced by the declared velocity. Dynamic velocity allows zoom in/out — granular at important moments, coarser elsewhere.
Tail vocabulary: chronicle rupture — a regime change recorded mid-period, a figure's death, an institution's dissolution, a trend reversal the chronicler must explicitly mark.
Pool variables name TRAJECTORY FORCES — long-running trends, regime-shift pressures, figures whose state is shifting, institutional rhythms, chronicled patterns. Do not invent events the chronicler couldn't have witnessed at the declared velocity.`,
};

/** Render the lens for a paradigm — empty string when paradigm is unset
 *  (the surface body falls back to multipurpose framing in that case). */
function compassLensFor(paradigm: NarrativeParadigm | undefined): string {
  return paradigm ? COMPASS_LENS_BY_PARADIGM[paradigm] : '';
}

// ─── Shared disciplines (surface-independent) ───────────────────────────────

const COMPASS_SHARED_DISCIPLINES = `DISCIPLINES (universal).
${PRINCIPLES_UNIVERSAL_DISCIPLINES}

${PRINCIPLE_POWER_LAW_SHAPE}

${PRINCIPLE_PARADIGM_FIDELITY}`;

const COMPASS_PROBABILITY_DISCIPLINE = PRIOR_LOGIT_PROMPT;

// ─── Surface 1: Compass cohort generation ───────────────────────────────────

const COMPASS_COHORT_BODY = `You are the COMPASS for this work — an AI direction-finder surfacing a probability-weighted set of feasible next moves. All scenarios share ONE common POOL of variables (the factor model). Each scenario is a different COORDINATION over that pool — its specific pattern of intensities — read as: "if THIS coordination of forces fires, this is where the work moves next, at this relative plausibility (simulation) or pull strength (every other paradigm)."

A cohort that ignores the paradigm's compass MIS-SPECIFIES. A cultivation cohort without a breakthrough-class scenario, a thriller cohort without a misdirection-payoff scenario, a paper cohort without a counterclaim scenario, a simulation cohort that authorially rescues the favoured actor — each leaves the paradigm's load-bearing continuation off the table.`;

const COMPASS_COHORT_PIPELINE = `PIPELINE.
  1. PIVOT CHECK on the arc's ending state.
  2. Read mechanisms in the roster's artifacts and key-actor world-graphs.
  3. Design the SHARED POOL — load-bearing forces only, substrate-level, orthogonal, dynamic. Forces in the paradigm's native vocabulary.
  4. Draft scenarios over the pool, COMPASS-LENS-FIRST. Each is SELF-COHERENT, MEANINGFULLY DISTINCT, earns its place. The cohort should COVER the paradigm's load-bearing continuations — including a right-shape tail. Let the situation govern spread and size; frame however the substrate suggests (axes, branches, regimes, families, ad hoc).
  5. Score priorLogits relative to the cohort, full range.

COHORT SIZE — FLEXIBLE. Governed by the SITUATION, not a target. A tight, locked-in possibility space supports two or three meaningful continuations; a fan-out moment may support a dozen. Don't pad to look thorough, don't trim to look clean. Stop when adding another scenario would re-cover ground already covered. Same for the SHARED POOL — emit as many variables as the load-bearing forces actually require.`;

const COMPASS_COHORT_SCHEMA = `${INFERENCE_SHAPE_PROMPT}

COHORT-SPECIFIC FIELDS each scenario carries on TOP of the inference-shape:
  • name: short phrase naming this scenario distinctly within the cohort.
  • activations: variableId + intensity over the shared pool. ${INTENSITY_REMINDER}
  • priorLogit: relative log-prior plausibility within the cohort.

Output strict JSON. The top-level \`paradigm\` field is REQUIRED — a dense concretisation (≤ 30 words) of the compass the cohort was drafted against: name + operative cues (e.g. "xianxia / sect-political cultivation — tier breakthrough + sect-feud cycles; cosmic-tier intervention as tail"). Honour the work-identity declaration; your articulation refines it, never contradicts it.

{
  "paradigm": "...",
  "pool": [ { "id": "var-...", "name": "...", "description": "...", "category": "..." } ],
  "scenarios": [
    {
      "name": "...",
      ${INFERENCE_SHAPE_SCHEMA_FRAGMENT},
      ${PRIOR_LOGIT_SCHEMA_FRAGMENT},
      "activations": [ { "variableId": "var-...", "intensity": 3 } ]
    }
  ]
}`;

/** Multipurpose fallback when paradigm is unset — names every register so the
 *  model can adapt to the source. Same shape as the legacy prompt. */
const COMPASS_COHORT_FALLBACK_LENS = `COMPASS LENS — paradigm-adaptive.
The work's paradigm is not declared; detect it from the context (outline, mode, roster, threads, prose profile). The cohort frames in the detected register's native vocabulary:
  • NARRATIVE / FICTION — dramatic continuations (thread pivots, character commitments, scene-level inflections).
  • NON-FICTION — documented next moves (investigations opening, evidence surfacing, contested-claim resolution).
  • SIMULATION — PRECISION PREDICTION. Rule-driven outcomes; authorial rescue is paradigm error.
  • ESSAY / PAPER / ARGUMENT — argumentative motion (claims advanced, counter-positions engaged, qualifications added).
  • PANEL — cognitive moves over existing evidence.
  • ATLAS — typological additions, classification edge-cases, cross-references.
  • DEBATE — moves under the contest's rules.
  • RECORD — next period's chronicle at the declared velocity.`;

/** Compose the Compass cohort generation system prompt. */
export function buildCompassGenerationSystem(work: WorkIdentity): string {
  const identity = composeAnalystIdentity(work);
  const framing = compassFramingFor(work.paradigm);
  const lens = work.paradigm
    ? COMPASS_LENS_BY_PARADIGM[work.paradigm]
    : COMPASS_COHORT_FALLBACK_LENS;
  return [
    identity,
    framing,
    COMPASS_COHORT_BODY,
    lens,
    COMPASS_SHARED_DISCIPLINES,
    COMPASS_PROBABILITY_DISCIPLINE,
    COMPASS_COHORT_PIPELINE,
    COMPASS_COHORT_SCHEMA,
  ].join('\n\n');
}

// ─── Surface 2: Present extraction ──────────────────────────────────────────

const PRESENT_EXTRACTION_BODY = `You name the load-bearing dynamic variables driving THIS arc — the levers whose movement most reshapes the trajectory. The arc's own basis vector set; no catalogue carries across arcs.

The Present is the factor-model snapshot the Compass downstream is anchored on — what is actually firing right now, in the substrate. Get this right and the Compass cohort drawn off it inherits the right basis; get it wrong and every downstream recommendation / prediction is off-axis.

What earns a place:
  • CONTINUATION — forces already firing, actively driving the present moment.
  • CREATIVE — latent drivers not firing yet: external shock building, dormant alliance, hidden contradiction surfacing, unactivated mechanism, attractor pulling toward an unspoken outcome.
Mix both at the highest-leverage instances only.

Quality bar: SPECIFIC, CASCADING, ORTHOGONAL, DYNAMIC, SUBSTRATE-LEVEL. Pattern: \`[named subject] + [dynamic attribute]\`. Avoid buckets ("antagonist pressure", "market sentiment", "public mood"). Tighter is better; stop when adding another wouldn't change predictions.`;

const PRESENT_VARIABLE_SCHEMA = `Each variable emits { id, name, description, category, intensity }:
  • id: "var-<short-slug>"
  • name: short phrase
  • description: one sentence — what it is AND what cascades when it turns up
  • category: stance / capability / pressure / knowledge / constraint / allegiance / external / contradiction / trend / threshold / resource / reputation / institutional / cultural / physical / temporal / mechanism — or invent
  • intensity: ${INTENSITY_REMINDER}

The Present extraction ALSO carries the universal inference-shape at the top level (one read of the whole coordination), plus a self-estimated priorLogit:

${INFERENCE_SHAPE_PROMPT}

Variable count is flexible. Emit as many or as few as the situation supports — a quiet arc may carry two; a dense one may carry a dozen.

Output strict JSON. The top-level \`paradigm\` field is REQUIRED (≤ 30 words; refines the operator-declared identity, not contradicts it).

{
  "paradigm": "...",
  ${INFERENCE_SHAPE_SCHEMA_FRAGMENT},
  ${PRIOR_LOGIT_SCHEMA_FRAGMENT},
  "variables": [ { "id": "var-...", "name": "...", "description": "...", "category": "...", "intensity": 3 } ]
}`;

/** Compose the Present extraction system prompt. */
export function buildPresentExtractionSystem(work: WorkIdentity): string {
  const identity = composeAnalystIdentity(work);
  const framing = compassFramingFor(work.paradigm);
  const lens = work.paradigm
    ? COMPASS_LENS_BY_PARADIGM[work.paradigm]
    : COMPASS_COHORT_FALLBACK_LENS;
  return [
    identity,
    framing,
    PRESENT_EXTRACTION_BODY,
    lens,
    COMPASS_SHARED_DISCIPLINES,
    PRESENT_VARIABLE_SCHEMA,
  ].join('\n\n');
}

// ─── Surface 3: Compass rescore ─────────────────────────────────────────────

const COMPASS_RESCORE_BODY = `You re-evaluate ONE scenario in the Compass cohort whose variables have been edited. Score its priorLogit on the calibrated [-4, +4] scale defined below.

Ground in:
  • Work context (outline, mode substrate, scenes, threads, roster, prior arcs)
  • Mechanisms loaded in the roster's artifacts and key-actor world-graphs
  • The scenario's revised coordination — which variables, what intensities, in combination
  • The sibling scenarios — relative anchoring`;

const COMPASS_RESCORE_SCHEMA = `${INFERENCE_SHAPE_PROMPT}

Output strict JSON:
{
  ${PRIOR_LOGIT_SCHEMA_FRAGMENT},
  ${INFERENCE_SHAPE_SCHEMA_FRAGMENT}
}`;

/** Compose the Compass rescore system prompt. */
export function buildCompassRescoreSystem(work: WorkIdentity): string {
  const identity = composeAnalystIdentity(work);
  const framing = compassFramingFor(work.paradigm);
  const lens = work.paradigm
    ? COMPASS_LENS_BY_PARADIGM[work.paradigm]
    : COMPASS_COHORT_FALLBACK_LENS;
  return [
    identity,
    framing,
    COMPASS_RESCORE_BODY,
    lens,
    COMPASS_SHARED_DISCIPLINES,
    COMPASS_PROBABILITY_DISCIPLINE,
    COMPASS_RESCORE_SCHEMA,
  ].join('\n\n');
}
