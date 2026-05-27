/**
 * Paradigm-aware writer identities and prose-shape directives.
 *
 * Two key levers fight the LLM's default-to-fiction prior:
 *
 * 1. The WRITER ROLE in the system prompt — a single, paradigm-native
 *    identity claim. "You write chronicle entries" reads as a specific
 *    craft; "you are a prose writer crafting a scene" cues fiction.
 *
 * 2. The PROSE-SHAPE DIRECTIVE in the user prompt — names what the scene
 *    IS in this paradigm, what to render, and explicit DO NOTs that
 *    preempt the strongest fictional defaults (omniscient narrator,
 *    interiority, manufactured events, smoothing to emotional throughline).
 *
 * The "scene" noun is canonical (CORE_LANGUAGE.md) — kept universal. The
 * directives re-anchor what THIS scene is in the paradigm's form.
 */

import type { NarrativeParadigm } from '@/types/narrative';

/** Per-paradigm WRITER identity. Single-line claim in the system prompt.
 *  Use paradigm-native craft nouns (moves, entries, sections) rather than
 *  abstract role labels. The format-rules block carries output-form details
 *  separately; this is identity only. */
export const WRITER_ROLE_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'You write fiction prose for an invented populated world.',
  'non-fiction': 'You write non-fiction prose against a documented record — every named person, place, event, and date must anchor to actual fact.',
  'simulation':  'You write rule-driven event prose — the modelled rules force what happens; agents act under them, not above them.',
  'essay':       'You write essay sections — one named author works through an argument; cited interlocutors are positions engaged, not characters who act.',
  'panel':       'You write panel sessions — a named cast cognizes over existing evidence; no fabricated forward-time events.',
  'atlas':       'You write typology entries — specimens, taxa, doctrines, or concepts described by structural attributes and position in the system, not by events.',
  'debate':      'You write moves in an adversarial contest — each move has attribution, intent, and effect under explicit rules; not a fiction scene with throughline.',
  'record':      'You write dated chronicle entries — what happened and what changed at the declared time velocity, in the chronicler\'s documentary voice; not omniscient narrator.',
};

/** Per-paradigm PROSE-SHAPE directive. Injected as priority 1 of the prose
 *  user prompt. Each block follows the same three-part pattern:
 *  (a) what this "scene" actually IS in the paradigm;
 *  (b) what to render — the concrete components;
 *  (c) explicit DO NOTs preempting the fiction default. */
export const PROSE_SHAPE_DIRECTIVE_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction': `<paradigm-shape paradigm="fiction" hint="Invented populated world. Standard fiction prose.">
  This scene is an event in an invented populated world. Render in the source's register, voice, and POV; the prose profile is law.
</paradigm-shape>`,

  'non-fiction': `<paradigm-shape paradigm="non-fiction" critical="true" hint="Documented event. Every fact anchors to record.">
  This scene is an event in the documented record. Same form as fiction; the discipline is sourcing.
  Render: what happened, who was present, what they said or did — drawn from the record.
  DO NOT fabricate facts, dates, dialogue, or attributed quotes the record does not contain. Where the record has gaps, name the gap explicitly ("the minutes do not record what was said next") rather than invent.
</paradigm-shape>`,

  'simulation': `<paradigm-shape paradigm="simulation" critical="true" hint="Rule-driven event. Rules force outcomes; agents act under them.">
  This scene is a rule-driven event in a modelled world where the rule set is LOAD-BEARING.
  Render: what the modelled rules force as conditions evolve, from the POV of an agent the rules act on (a candidate under electoral rules, a general under wargame constraints, a cultivator under sect doctrine, a minister under treaty law).
  DO NOT smooth rule-driven outcomes into authorial agency — when the rules force a state, deliver it even when "the protagonist" would conventionally prevail. Recoveries must be earned through initial-condition shifts, rule changes, or new positions inside existing rules.
  DO NOT shift POV to an external modeller, observer, or "simulation core" running the model from outside. The rules act on the modelled world's inhabitants; modellers do not appear unless the premise puts them there.
  When rules surface diegetically (HUD, log, status sheet, tier gate), they are real to the agents in this world.
</paradigm-shape>`,

  'essay': `<paradigm-shape paradigm="essay" critical="true" hint="Section of cognition. NOT a fiction scene.">
  This scene is a SECTION of essay — the named author works through reasoning.
  Render: a claim considered, evidence weighed, a counter-position engaged, a conclusion reached. The author's voice carries it; cited interlocutors appear as positions engaged or rebutted.
  DO NOT manufacture dialogue between interlocutors who never met. DO NOT invent fictional scene-events, narrator interiority of "characters", or dramatic action. Internal friction — rejected readings, qualified commitments, considered objections — substitutes for multi-voice disagreement.
</paradigm-shape>`,

  'panel': `<paradigm-shape paradigm="panel" critical="true" hint="Cognitive event over EXISTING evidence. NOT invented forward-time events.">
  This scene is a COGNITIVE EVENT — a meeting, deliberation, or model run in which the named cast (AI agents OR human experts; commit to one mode) works EXISTING evidence.
  Render: each thinker's contribution attributed, the dissenter pushing back, the session moving through productive disagreement toward synthesis or stall.
  DO NOT manufacture new external events for the panel to react to. DO NOT have anyone receive fresh intelligence, intercepts, or covert sources the panel did not already have. DO NOT invent specific numbers presented as freshly observed — re-interpret existing evidence, model explicit hypotheticals, and name evidence gaps honestly.
</paradigm-shape>`,

  'atlas': `<paradigm-shape paradigm="atlas" critical="true" hint="Typology entry. NO events, NO arc, NO interiority.">
  This scene is an ENTRY in a typology — a specimen, taxon, doctrine, or concept described by its structural attributes (definition, characteristics, mechanism, scope) and its position in the system (what it extends, contrasts with, depends on, or supersedes).
  Render: the curator's authoritative description, organised by structure not chronology. Cross-reference other entries explicitly.
  DO NOT include events, character interiority, dramatic action, or arc-shaped resolution. DO NOT narrate change over time within the entry — entries describe stable structure, not history (history is for Record).
</paradigm-shape>`,

  'debate': `<paradigm-shape paradigm="debate" critical="true" hint="A MOVE in a contest. NOT a fiction scene with throughline.">
  This scene is a MOVE in an adversarial contest under explicit rules.
  Render each move as three things: ATTRIBUTION (which named party made it), INTENT (which axis of contestation it targets — e.g. "to defeat the carve-out defense", "to swing the pension funds", "to close the antitrust review"), and EFFECT (how the rules + arbiter scored, admitted, or responded to it).
  DO NOT smooth events into a character's emotional throughline ("Chen leaves the meeting frustrated"; "Holt holds"). DO NOT use omniscient narrator voice that summarises strategy from outside the contest. The contest's rules of engagement are load-bearing — surface them when moves trigger them.
</paradigm-shape>`,

  'record': `<paradigm-shape paradigm="record" critical="true" hint="Dated chronicle entry. Documentary voice, NOT omniscient narrator.">
  This scene is an ENTRY in a chronological log at the world view's declared time velocity (daily / monthly / yearly / dynamic).
  Render: lead with the TIME-STAMP (a date for daily, month/year for monthly, year for yearly, explicit per-entry for dynamic). The chronicler's documentary voice records what happened in this time-step, what changed, what was observed.
  DO NOT use omniscient narrator voice with character interiority — the chronicler observes and logs; they do not enter minds. DO NOT fabricate dialogue, attributed quotes, or specific events the record does not contain; quote what is quoted, name what is named, mark gaps as gaps. Threads are long-running trajectories tracked across entries, not arcs that resolve dramatically within one entry.
</paradigm-shape>`,
};

/** Convenience: writer-role identity line. When paradigm is unset, fall back
 *  to a deliberately neutral identity that does not lean fiction. */
export function writerRoleFor(paradigm: NarrativeParadigm | undefined): string {
  return paradigm
    ? WRITER_ROLE_BY_PARADIGM[paradigm]
    : 'You write prose adapted to the source\'s form — fiction, documented record, argument, chronicle, typology, contest, panel session, or rule-driven simulation.';
}

/** Convenience: prose-shape directive for the user prompt. Empty string when
 *  paradigm is unset; the existing prose machinery handles fiction defaults
 *  fine, and an unset paradigm means the source's own form should drive. */
export function proseShapeDirective(paradigm: NarrativeParadigm | undefined): string {
  return paradigm ? PROSE_SHAPE_DIRECTIVE_BY_PARADIGM[paradigm] : '';
}

/** Compose the work's META identity — the single sentence that fuses paradigm
 *  craft + work title + genre / subgenre concretisation. The trio of paradigm,
 *  genre, and subgenre defines what the LLM is writing — the paradigm names
 *  the form, the genre names the tradition, the subgenre names the specific
 *  voice (Pepys-style daily diary, progression fantasy, Mughal-succession
 *  counterfactual, hostile acquisition, Davos-style advisory panel). Trained
 *  associations on the subgenre are the strongest cue we can give the model.
 *
 *  Returns a single sentence suitable for system-prompt identity-line use:
 *    "You write moves in an adversarial contest. The work is 'Holt v. Meridian' — hostile acquisition (M&A)."
 *    "You write fiction prose for an invented populated world. The work is 'Storm of Iron' — progression fantasy."
 *    "You write dated chronicle entries. The work is 'The London Year' — Pepys-style daily diary." */
export function composeWorkIdentity(args: {
  title: string;
  paradigm?: NarrativeParadigm;
  genre?: string;
  subgenre?: string;
}): string {
  const role = writerRoleFor(args.paradigm);
  return `${role}${workTail(args)}`;
}

/** Compose the genre/subgenre/title tail used by identity-line builders.
 *  Empty string when no title is known (early-wizard surfaces). */
function workTail(args: { title?: string; genre?: string; subgenre?: string }): string {
  const title = args.title?.trim();
  if (!title) return '';
  const g = args.genre?.trim();
  const sg = args.subgenre?.trim();
  let tail = '';
  if (sg && g && sg.toLowerCase() !== g.toLowerCase()) tail = ` — ${sg} (${g})`;
  else if (sg) tail = ` — ${sg}`;
  else if (g) tail = ` — ${g}`;
  return ` The work is "${title}"${tail}.`;
}

// ─── Analyst-side machinery ─────────────────────────────────────────────────
//
// Mirrors the writer-side helpers above. Where writer roles describe what the
// engine GENERATES in each paradigm, analyst roles describe what the engine
// READS / interrogates / compares. Used by analytical surfaces (branch chat,
// search synthesis, threading, surveys, interviews, direction proposals, world
// expansion, market briefing) so the model receives a paradigm-native analyst
// identity rather than a multipurpose "could be anything" preamble.

/** Per-paradigm ANALYST identity. Single-line claim — frames what the analyst
 *  is reading and what the engine primitives MEAN in this paradigm. */
export const ANALYST_ROLE_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'You analyse a long-form fiction work — invented characters, places, events; threads as the dramatic questions the work is pursuing.',
  'non-fiction': 'You analyse a long-form non-fiction work — documented people, places, and events anchored to a real record; threads as the historical/biographical questions the work is pursuing.',
  'simulation':  'You analyse a rule-driven simulation — agents acting under a stated rule set; threads as questions about what the rules force as conditions evolve; outcomes are rule-driven, not authorial.',
  'essay':       'You analyse an essay — one named author working an argument across sections; threads as the argument-questions being pursued; cited interlocutors are positions engaged, not characters with arcs.',
  'panel':       'You analyse a panel session — a named cast cognising over existing evidence; threads as the panel\'s shared questions and per-member sub-investigations; events are interpretive, not invented forward-time.',
  'atlas':       'You analyse a reference typology — entries (specimens, taxa, doctrines, concepts) classified by structural attributes and position; threads, when present, track classification questions, not arcs.',
  'debate':      'You analyse an adversarial contest — two or more named parties locked in zero-sum stakes under explicit rules; threads as axes of contestation whose outcomes favour one party or the other.',
  'record':      'You analyse a chronological record — dated entries in a chronicler\'s voice at a declared time velocity; threads as long-running trajectories tracked across entries, not arcs that dramatically resolve.',
};

/** Convenience: analyst-role identity line. When paradigm is unset, fall back
 *  to a deliberately neutral identity that names every form. */
export function analystRoleFor(paradigm: NarrativeParadigm | undefined): string {
  return paradigm
    ? ANALYST_ROLE_BY_PARADIGM[paradigm]
    : 'You analyse a long-form work — fiction, non-fiction, simulation, essay, panel, atlas, debate, or chronicle. Read the source\'s form and adapt vocabulary accordingly; engine primitives (branch, entry, arc, scene, thread, delta, divergence, commitment) stay constant.';
}

/** Compose the ANALYST identity sentence — analyst role fused with title +
 *  genre + subgenre. Mirror of composeWorkIdentity for analytical surfaces.
 *  Title may be omitted (early-wizard analytical calls); the tail simply
 *  collapses to empty in that case. */
export function composeAnalystIdentity(args: {
  title?: string;
  paradigm?: NarrativeParadigm;
  genre?: string;
  subgenre?: string;
}): string {
  return `${analystRoleFor(args.paradigm)}${workTail(args)}`;
}

/** Per-paradigm engine-primitive vocabulary. Re-exported from the
 *  calibration layer — single source of truth lives in
 *  `calibration/paradigm-vocab.ts`. */
export { PARADIGM_VOCABULARY } from './calibration/paradigm-vocab';

/** Identity for a NarrativeState — convenience extractor used at callsites. */
export type WorkIdentity = {
  title?: string;
  paradigm?: NarrativeParadigm;
  genre?: string;
  subgenre?: string;
};

// ─── Compass framing ────────────────────────────────────────────────────────
//
// The Compass is the engine's forward-looking surface — a probability
// distribution over feasible next directions, grounded in a factor model
// (variables) of the work's reality. The interpretation of those probabilities
// is paradigm-dependent:
//
//   • SIMULATION — PRECISION PREDICTION. The rule set is load-bearing; the
//     cohort approximates the modelled distribution of outcomes. PriorLogits
//     are the model's probability assignments. Tail scenarios are tail events.
//
//   • EVERY OTHER PARADIGM — RECOMMENDATION. The factor model is editorial /
//     argumentative / typological / chronicled; the cohort is a curated set
//     of high-leverage next moves. PriorLogits express how strongly the
//     paradigm's compass pulls toward each. The cohort is what the engine
//     thinks the operator SHOULD consider going next, not a forecast of what
//     will objectively happen.
//
// Both interpretations use the same machinery (variables, priorLogits,
// softmax) — what changes is what the operator should READ from the cohort.

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
};

/** Convenience: compass framing line. When paradigm is unset, fall back to a
 *  framing that names both interpretations and lets the model adapt to the
 *  source — the same pre-rebrand behaviour. */
export function compassFramingFor(paradigm: NarrativeParadigm | undefined): string {
  return paradigm
    ? COMPASS_FRAMING_BY_PARADIGM[paradigm]
    : 'COMPASS MODE: paradigm-adaptive. In a simulation register the cohort is precision prediction under the modelled rules; in every other register the cohort is recommendation — high-leverage next directions the work\'s substrate and accumulated commitments pull toward. Match the read to what the work actually is.';
}
