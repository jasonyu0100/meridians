/**
 * Paradigm-aware system-prompt composers for the COMPASS surfaces.
 *
 * The Compass is the engine's forward-looking direction-finder — a
 * probability distribution over feasible next moves grounded in a factor
 * model (variables) of the work's reality. Three system prompts share this
 * machinery:
 *
 *   • Present extraction — the arc's current factor-model snapshot.
 *   • Compass cohort generation — a softmax-weighted set of next directions.
 *   • Cohort rescore — re-evaluate one scenario after the operator edits it.
 *
 * Per-paradigm lenses live in `./shapes.ts`; this file composes them with
 * the surface-specific bodies + universal calibration / principles into
 * the final system prompts.
 */

import {
  INFERENCE_SHAPE_PROMPT,
  INFERENCE_SHAPE_SCHEMA_FRAGMENT,
  INTENSITY_REMINDER,
  PRIOR_LOGIT_PROMPT,
  PRIOR_LOGIT_SCHEMA_FRAGMENT,
} from '../calibration';
import {
  PRINCIPLE_PARADIGM_FIDELITY,
  PRINCIPLE_POWER_LAW_SHAPE,
  PRINCIPLES_UNIVERSAL_DISCIPLINES,
} from '../principles';
import { compassFramingFor } from './framing';
import { composeAnalystIdentity, type WorkIdentity } from './identity';
import { COMPASS_LENS_BY_PARADIGM } from './shapes';

// ─── Shared disciplines (surface-independent) ───────────────────────────────

const COMPASS_SHARED_DISCIPLINES = `DISCIPLINES (universal).
${PRINCIPLES_UNIVERSAL_DISCIPLINES}

${PRINCIPLE_POWER_LAW_SHAPE}

${PRINCIPLE_PARADIGM_FIDELITY}`;

const COMPASS_PROBABILITY_DISCIPLINE = PRIOR_LOGIT_PROMPT;

/** Multipurpose fallback when paradigm is unset — names every register so the
 *  model can adapt to the source. */
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
