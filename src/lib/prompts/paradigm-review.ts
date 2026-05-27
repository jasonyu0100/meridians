/**
 * Paradigm-aware system-prompt composers for REVIEW surfaces.
 *
 * Three review passes the engine runs against a branch:
 *   • Prose review — evaluates rendered prose.
 *   • Branch review — structural critique from scene summaries.
 *   • Plan review — continuity check of beat plans.
 *
 * Each pass needs different review CRITERIA per paradigm. Fiction earns
 * dramatic-arc judgement; simulation earns rule-fidelity judgement; essay
 * earns argument-tightness judgement; debate earns move-attribution
 * judgement, etc. The legacy prompts taught the model these per-paradigm
 * criteria by enumerating every paradigm inline; this module dispatches at
 * build time so the model receives ONLY the paradigm's own criteria, sharply.
 */

import type { NarrativeParadigm } from '@/types/narrative';
import {
  composeAnalystIdentity,
  type WorkIdentity,
} from './paradigm-roles';
import { PRINCIPLE_PARADIGM_FIDELITY } from './principles';

// ─── Prose review ───────────────────────────────────────────────────────────

const PROSE_REVIEW_CRITERIA_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'PROSE CRITERIA — fiction. Voice consistency, dialogue naturalism, sensory grounding, interiority depth, dramatic logic. Pacing within scenes — beats breathing or rushing. Continuity of established facts, entity positions, knowledge asymmetries. Repetition of phrases, images, sentence structures, verbal tics. Profile compliance.',
  'non-fiction': 'PROSE CRITERIA — non-fiction. Voice consistency, evidentiary precision, claim-evidence cadence, attribution accuracy, anchored detail (every named figure / place / date traceable). Pacing of evidentiary build. Continuity with the documented record — invented facts are regressions, not authorial latitude. Repetition. Profile compliance.',
  'simulation':  'PROSE CRITERIA — simulation. Rule fidelity (outcomes follow from the stated rule set under the given conditions, not authorial preference), scenario tightness, consequence consistency. POV stays inside the modelled world (no external modeller voice unless the premise puts them there). Pacing reflects the model\'s own dynamics. Continuity of modelled state. Diegetic-overlay coherence (HUD / log / status entries real to the agents). Repetition. Profile compliance.',
  'essay':       'PROSE CRITERIA — essay. Voice consistency of the named author. Argument tightness — claims supported, counter-positions engaged, qualifications added, conclusions earned. NO manufactured dialogue between interlocutors who never met; NO fictional scene-events. Internal friction substitutes for invented disagreement. Repetition (rhetorical, conceptual, evidentiary). Profile compliance.',
  'panel':       'PROSE CRITERIA — panel. Each thinker\'s contribution attributed. Dissent surfaced explicitly. No fabricated forward-time events — scenes are cognitive events over EXISTING evidence. Pacing reflects deliberation cycles. Synthesis movement — does the session move through productive disagreement toward synthesis or honest stall? Repetition. Profile compliance.',
  'atlas':       'PROSE CRITERIA — atlas. Typological rigour. Curator\'s voice consistent and authoritative. Entries describe stable structure, not events. Cross-references explicit. No interiority, no arc resolution, no dramatic action within entries. Repetition across entries (legitimate when typologically motivated; flag when filler). Profile compliance.',
  'debate':      'PROSE CRITERIA — debate. Every move carries attribution (which party), intent (which axis it targets), effect (how rules + arbiter scored it). NO smoothing of events into a character\'s emotional throughline. NO omniscient narrator voice summarising strategy from outside the contest. Rules of engagement surfaced when triggered. Repetition. Profile compliance.',
  'record':      'PROSE CRITERIA — record / chronicle. Time-velocity coherence (declared velocity respected; shifts marked as editorial signal). Documentary voice — no omniscient interiority. Time-stamps lead entries. Gap-marking discipline (gaps named honestly, not papered over). Quotes quoted, not invented. Repetition. Profile compliance.',
};

export function buildProseReviewSystem(work: WorkIdentity): string {
  const fallback = 'You are a prose editor evaluating actual rendered prose. The work may be a narrative, a simulation, an essay, a panel session, a typology, an adversarial contest, or a chronicled record — read the paradigm from the prose itself and apply criteria the work\'s own voice earns. Score on voice consistency, craft, pacing, continuity, repetition, and prose-profile compliance. Quote specific lines and assign verdict ok|edit per scene with concrete actionable issues — never vague. Return ONLY valid JSON matching the schema in the user prompt.';
  if (!work.paradigm) return fallback;
  const identity = composeAnalystIdentity(work);
  const criteria = PROSE_REVIEW_CRITERIA_BY_PARADIGM[work.paradigm];
  return `${identity}

${criteria}

${PRINCIPLE_PARADIGM_FIDELITY}

You are evaluating actual rendered prose. Score on voice consistency, craft (judged by the paradigm criteria above), pacing, continuity, repetition, and prose-profile compliance. Quote specific lines and assign verdict ok|edit per scene with concrete actionable issues — never vague. Return ONLY valid JSON matching the schema in the user prompt.`;
}

// ─── Branch review ──────────────────────────────────────────────────────────

const BRANCH_REVIEW_CRITERIA_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'BRANCH CRITERIA — fiction. Structural shape: dramatic escalation, thread arcs that build and pay off. Pacing — breathing room between high-intensity moments. Repetition of beats, locations, entity reactions. Entity development — anchors changing, recurring characters moving. Threads advancing vs stagnating. Thematic question the work is interrogating.',
  'non-fiction': 'BRANCH CRITERIA — non-fiction. Structural shape: evidentiary through-line, claims built case-by-case. Pacing — evidence accumulation rhythm. Repetition of attribution patterns or evidence types. Entity development — documented figures whose state shifts in the record. Threads (investigation questions) advancing vs stagnating. Thematic question the work pursues against the record.',
  'simulation':  'BRANCH CRITERIA — simulation. Rule-driven trajectory — do scenes follow as the established rule set forces under the given conditions? Authorial rescue is a verdict-edit flag. Pacing — model dynamics, threshold crossings, regime shifts. Repetition (rule-applications producing the same outcome without advancing modelled state count as repetition). Entity development — modelled agents whose state changes under the rules. Threads — rule-driven questions ("will the system reach state X?"). Thematic question — what the rule set under stress reveals.',
  'essay':       'BRANCH CRITERIA — essay. Argument structure — claim chain, evidence weight, counter-position engagement, qualifications, conclusion. Do NOT demand dramatic arc. Pacing — argumentative cadence. Repetition (rhetorical or conceptual). Entity development — the author\'s commitments shifting, cited interlocutors engaged. Threads (argument questions) advancing. Thematic question — the central claim being defended.',
  'panel':       'BRANCH CRITERIA — panel. Does the cast actually disagree over EXISTING evidence? Flag manufactured forward-time events. Pacing — deliberation cycles. Repetition of methodological appeals. Entity development — panel members\' priors shifting. Threads — the shared question + per-member sub-investigations. Thematic question — what the panel is pursuing.',
  'atlas':       'BRANCH CRITERIA — atlas. Typological coverage, cross-references, classification rigour. Do NOT demand resolution. Pacing — structural density. Repetition (legitimate when typologically motivated). Entity development — entries described stably (not arcing). Threads (when present) — classification questions. Thematic question — what the typology illuminates about its domain.',
  'debate':      'BRANCH CRITERIA — debate. Are moves attributed, intent-targeted, and rule-scored? Flag emotional-throughline narration. Pacing — move-and-response rhythm. Repetition of contestant tactics. Entity development — each contestant\'s posture / capacity shifting. Threads — axes of contestation. Thematic question — the contest\'s underlying stakes.',
  'record':      'BRANCH CRITERIA — record / chronicle. Time-velocity coherence, documentary voice, gap-marking discipline. Do NOT demand arc resolution within a single entry. Pacing — velocity shifts as editorial signal. Repetition of chronicled patterns. Entity development — figures evolving across entries. Threads — long-running trajectories. Thematic question — what the chronicle illuminates about its period.',
};

export function buildBranchReviewSystem(work: WorkIdentity): string {
  const fallback = 'You are an editor reviewing a complete branch of a work from scene summaries only — no prose. The work may be a narrative (fiction or non-fiction), a rule-driven simulation, an essay, a panel session, a typology, an adversarial contest, or a chronicled record — evaluate against the paradigm\'s own criteria, not against fiction defaults. Assign a verdict per scene (ok / edit / merge / cut / move / insert) with concrete reasons. Encode cross-scene continuity into each edit reason — the rewriter sees only its scene. Return ONLY valid JSON matching the schema in the user prompt.';
  if (!work.paradigm) return fallback;
  const identity = composeAnalystIdentity(work);
  const criteria = BRANCH_REVIEW_CRITERIA_BY_PARADIGM[work.paradigm];
  return `${identity}

${criteria}

${PRINCIPLE_PARADIGM_FIDELITY}

You are reviewing a complete branch from scene/entry summaries only — no prose. Evaluate structure, pacing, repetition, entity development, threads, and theme through this paradigm's own criteria above. Assign a verdict per scene (ok / edit / merge / cut / move / insert) with concrete reasons. Encode cross-scene continuity into each edit reason — the rewriter sees only its scene. Return ONLY valid JSON matching the schema in the user prompt.`;
}

// ─── Plan review ────────────────────────────────────────────────────────────

const PLAN_REVIEW_CRITERIA_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'PLAN SHAPE — fiction. Beats sequence dramatic action, dialogue, interiority, world reveal. Beat-to-delta alignment: thread escalations need a beat showing them; world deltas need a beat where the entity learns / changes.',
  'non-fiction': 'PLAN SHAPE — non-fiction. Beats sequence documented events, attributed witness, evidentiary moves. Beat-to-delta alignment: every claim a delta encodes needs a beat sourcing it from the record.',
  'simulation':  'PLAN SHAPE — simulation. Beats sequence rule applications, threshold crossings, agent decisions under the rules. Beat-to-delta alignment is CRITICAL: a system delta declaring a rule fires must have a beat where the rule is actually applied. A modelled agent cannot hold a state the rule set has not established for them at this point.',
  'essay':       'PLAN SHAPE — essay. Beats sequence argument moves (claim → evidence → counter → qualification → conclusion). NO action beats; argument-shape beats only. Beat-to-delta alignment: thread escalations are argument-question advances, not dramatic moves.',
  'panel':       'PLAN SHAPE — panel. Beats sequence cognitive moves — assertion, dissent, re-reading, model run, synthesis. No invented forward-time events. Beat-to-delta alignment: world deltas record member-state shifts (priors, commitments), not external happenings.',
  'atlas':       'PLAN SHAPE — atlas. Beats sequence the entry\'s structural facets (definition → characteristics → mechanism → scope → cross-references). NO chronology, NO arc beats. Beat-to-delta alignment: system deltas record classification additions, not events.',
  'debate':      'PLAN SHAPE — debate. Beats sequence the move\'s attribution, intent, deployment, effect. Each move has a target axis. Beat-to-delta alignment: thread escalations are axis-of-contestation shifts; arbiter responses (rule activations, scoring) need beats.',
  'record':      'PLAN SHAPE — record. Beats sequence the entry\'s time-stamped observations and changes. Entries respect the declared time velocity. Beat-to-delta alignment: world deltas record state-shifts at the entry\'s time-stamp; gaps are named, not papered.',
};

export function buildPlanReviewSystem(work: WorkIdentity): string {
  const fallback = 'You are a continuity editor reviewing scene beat plans. For each scene check beat-to-delta alignment, cross-plan continuity, internal beat logic, entity knowledge, and spatial/temporal consistency. Plans may serve narrative, simulation, essay, panel, atlas, debate, or record paradigms — verify that each plan\'s shape matches its paradigm. Assign verdict ok|edit per scene with precise issue references (cite beat numbers). Return ONLY valid JSON matching the schema in the user prompt.';
  if (!work.paradigm) return fallback;
  const identity = composeAnalystIdentity(work);
  const criteria = PLAN_REVIEW_CRITERIA_BY_PARADIGM[work.paradigm];
  return `${identity}

${criteria}

${PRINCIPLE_PARADIGM_FIDELITY}

You are a continuity editor reviewing scene beat plans. For each scene check beat-to-delta alignment, cross-plan continuity, internal beat logic, entity knowledge, and spatial/temporal consistency — judged by the paradigm criteria above. Assign verdict ok|edit per scene with precise issue references (cite beat numbers). Return ONLY valid JSON matching the schema in the user prompt.`;
}
