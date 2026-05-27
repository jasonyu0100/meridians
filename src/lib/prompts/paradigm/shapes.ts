/**
 * Paradigm shapes — every case-based per-paradigm framing the engine uses.
 *
 * SINGLE SOURCE OF TRUTH. To add a paradigm to the engine, you add a case to
 * each map in this file (plus the NarrativeParadigm union in types/narrative).
 * No other file should declare a `Record<NarrativeParadigm, …>` map; every
 * paradigm-aware surface imports its dispatch map from here.
 *
 * Grouped by surface family for navigation. Each map is paired with a short
 * comment naming the surface that consumes it.
 */

import type { NarrativeParadigm } from '@/types/narrative';

// ─── Prose / writer-side shapes ─────────────────────────────────────────────

/** Prose-shape directive — injected as priority 1 of the prose user prompt.
 *  Each block follows the same three-part pattern:
 *   (a) what this "scene" actually IS in the paradigm;
 *   (b) what to render — the concrete components;
 *   (c) explicit DO NOTs preempting the fiction default. */
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

  'game': `<paradigm-shape paradigm="game" critical="true" hint="A TURN in a multi-actor contest. Rules are enforceable; stakes are contested.">
  This scene is a TURN — one actor's action in a multi-actor contest under explicit, enforceable rules. The game state is canonical; rules constrain what moves are legal; partial-information rules govern what each actor knows.
  Render: which actor moved (attribution), what action they chose from their legal action set under the current state, what the rules permitted or forced as a result, what resources / position / leverage / information shifted, what the other actors observe (full or partial information per the rules).
  DO NOT narrate from an omniscient narrator's emotional throughline — a game has no single protagonist; each actor is its own perspective with its own stakes, information, and constraints. DO NOT smooth illegal or extra-rule moves into the action — if an actor cannot do X under the rules, they cannot do X; rule violation is the game ending, not a beat. DO NOT collapse the cast into one monolithic voice; actors are distinct under the rules.
  Rules are load-bearing and surface diegetically — when a rule fires (resource depleted, win condition met, action blocked, turn forfeit), deliver it as the game would. Stakes (open thread-questions the contest is deciding) close only when the rules resolve them, not when the narrative would prefer.
</paradigm-shape>`,
};

/** Prose-shape directive lookup — empty when paradigm unset. */
export function proseShapeDirective(paradigm: NarrativeParadigm | undefined): string {
  return paradigm ? PROSE_SHAPE_DIRECTIVE_BY_PARADIGM[paradigm] : '';
}

// ─── World architect (wizard-time world generation) ─────────────────────────

/** Per-paradigm world-architect framing for the wizard's
 *  `generateNarrative` system prompt. */
export const WORLD_ARCHITECT_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'You are a world-view architect generating a POPULATED NARRATIVE — invented characters, places, events. Fate (thread resolution) + World (character transformation) carry the weight; System provides the working rules of the imagined world. Do not default to fictional storytelling tropes; match the genre + subgenre the wizard declared.',
  'non-fiction': 'You are a world-view architect generating a POPULATED NARRATIVE anchored to the documented record — every named person, place, event, and date traceable to actual fact. Same form as fiction; the discipline is sourcing. Where the record has gaps, name the gap rather than fabricate.',
  'simulation':  'You are a world-view architect generating a RULE-GOVERNED NARRATIVE — in-world figures the rules ACT ON; the rule set is load-bearing. Threads close on rule-driven consequences, not authorial choice. Recoveries must be earned by initial-condition shifts, rule changes, or new positions inside the existing rules.',
  'essay':       'You are a world-view architect generating a SINGULAR-THINKER work — one named author plus 1–3 cited interlocutors. The author\'s mind IS the world; the system-graph IS the argument substrate (propositions, mechanisms, evidence relations). Internal friction substitutes for inter-agent disagreement.',
  'panel':       'You are a world-view architect generating a MULTI-THINKER work — a named cast of 2+ thinkers (AI agents OR human experts; pick ONE mode) cooperating with disagreement. The work IS the contest of minds reaching synthesis. ≥1 devil\'s-advocate role required; scenes are cognitive events over EXISTING evidence.',
  'atlas':       'You are a world-view architect generating a REFERENCE TYPOLOGY — entries / taxa / categories. No scene flow; the system-graph IS the work. The curator\'s voice orchestrates; entries describe stable structure by attributes and cross-references, not by events.',
  'debate':      'You are a world-view architect generating an ADVERSARIAL CONTEST — two or more named parties locked in zero-sum stakes under explicit rules. Scenes are MOVES (attribution + intent + effect). Threads are AXES OF CONTESTATION whose outcomes favour one party or the other under the contest\'s own logic.',
  'record':      'You are a world-view architect generating a CHRONOLOGICAL RECORD — time-ordered log of events, real or imagined. Pick a time velocity (daily / monthly / yearly / dynamic). Entries replace scenes; the chronicler\'s documentary voice records what happened in each time-step. Threads are long-running trajectories tracked across entries.',
  'game':        'You are a world-view architect generating a MULTI-ACTOR CONTEST — a game world where 2+ actors take turns pursuing contested stakes under enforceable rules. The system-graph IS the rule set (legal action sets, victory conditions, turn order, resource accounting, partial-information rules); world entities are the ACTORS (characters / factions / sides) and the RESOURCES, POSITIONS, and ARTIFACTS they command; threads are the OPEN STAKES the contest is deciding (objectives, contested territories, win conditions). Declare turn structure (turn / round / phase) and information rules (open / hidden / asymmetric) up front; they bind every downstream pass.',
};

/** Compact world-shape label used in chat context and outline rendering.
 *  One-line concretisation of the world's reality posture. */
export const WORLD_SHAPE_LABEL_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'populated-narrative — invented people in an invented world (REALITY POSTURE: invented)',
  'non-fiction': 'populated-narrative — real people, documented events; the world IS the record (REALITY POSTURE: observed)',
  'simulation':  'rule-governed-narrative — in-world figures the rules ACT ON; rules are load-bearing, threads close on rule-driven consequences (REALITY POSTURE: hybrid — real rules over real or invented agents)',
  'essay':       'singular-thinker — one named author + 1-3 cited interlocutors; internal friction substitutes for multi-voice disagreement (REALITY POSTURE: observed evidence + named author)',
  'panel':       'multi-thinker — a named cast of 2+ thinkers (AI agents OR human experts) pursuing a shared question over existing evidence; cooperative-with-disagreement, includes devil\'s-advocate role + ≥1 adversarial pair (REALITY POSTURE: observed evidence + named cast)',
  'atlas':       'reference-typology — entries / taxa / doctrines; system-graph IS the work; no fate threads, no character transformation (REALITY POSTURE: real-world typology OR invented-world codex — pick one and stay consistent)',
  'debate':      'adversarial-contest — 2+ named parties locked in zero-sum stakes under explicit rules; each scene a MOVE; threads track axes of contestation (REALITY POSTURE: documented contest OR hypothetical, with sourceable rules)',
  'record':      'chronological-record — time-ordered log of events, real or imagined; entries replace scenes; pick a time velocity (daily / monthly / yearly / dynamic) (REALITY POSTURE: documented chronicle OR invented annals)',
  'game':        'multi-actor-contest — 2+ actors take turns pursuing contested stakes under enforceable rules; system-graph IS the rule set, world tracks actors + resources + positions + artifacts, threads are open stakes the contest is deciding (REALITY POSTURE: rule-governed contest, real-world game OR hypothetical / designed game)',
};

// ─── Scene generation / plan / edit ─────────────────────────────────────────

/** Per-paradigm framing for the scene-generator system prompt. */
export const SCENE_GENERATOR_FRAMING_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'You generate dramatic scenes that move characters, settle thread questions, and reshape the world through events. Forward-time event narration is the substrate.',
  'non-fiction': 'You generate documented scenes anchored to the record — every named figure, place, event, and date traceable to actual fact. Same form as fiction; the discipline is sourcing, and gaps are named honestly rather than fabricated.',
  'simulation':  'You generate rule-driven scenes — the modelled rules force what happens; agents act under the rule set, not above it. Authorial rescue is paradigm error; recoveries are earned by initial-condition shifts, rule changes, or new positions inside existing rules.',
  'essay':       'You generate essay SECTIONS — one named author works through reasoning. Each section weighs a claim, engages a counter-position, arrives at a qualified conclusion. NOT dramatic events; cited interlocutors appear as positions engaged, not characters who act.',
  'panel':       'You generate cognitive SESSIONS over EXISTING evidence — the named cast deliberates, dissents, and synthesises. NO invented forward-time events; time progresses through cognitive moves (next meeting, next model run, next re-reading).',
  'atlas':       'You generate ENTRIES in a typology — specimens, taxa, doctrines, concepts described by structural attributes and position in the system. NO arc, NO interiority, NO forward-time narration. Cross-references between entries are the substance.',
  'debate':      'You generate MOVES in an adversarial contest under explicit rules — each move attributed, intent-targeted (which axis it contests), and rule-scored (how the arbiter responded). NOT a fiction scene with throughline; the contest\'s rules are load-bearing.',
  'record':      'You generate dated CHRONICLE ENTRIES at the declared time velocity (daily / monthly / yearly / dynamic) — what happened and what changed in this time-step, in the chronicler\'s documentary voice. NOT omniscient narrator; entries log, they do not arc.',
  'game':        'You generate TURNS in a multi-actor game — each turn names the active actor, the legal move they chose from their action set under the current state, the rule-checked effect on resources / position / information / stakes, and what other actors observe. Rules are enforceable; illegal moves do not happen; partial-information constraints are respected. NOT a fiction scene with a single protagonist; each actor plays their own game from their own information set.',
};

/** Per-paradigm framing for the scene-plan system prompt. */
export const PLAN_SHAPE_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'You are planning a DRAMATIC EVENT — beats sequence physical action, dialogue with subtext, interiority, world reveal. Forward-time event narration is the substrate.',
  'non-fiction': 'You are planning a DOCUMENTED EVENT — every beat traceable to the record. Same form as fiction; sourcing discipline gates fabrication. Gaps are named honestly, not invented around.',
  'simulation':  'You are planning a RULE-DRIVEN EVENT — beats sequence rule applications, threshold crossings, agent decisions under the rule set. Every system delta the scene claims must have a beat where the rule is actually applied.',
  'essay':       'You are planning an ESSAY SECTION — beats sequence argument moves (claim → evidence → counter → qualification → conclusion). NO action beats; argument-shape beats only. The named author works through reasoning.',
  'panel':       'You are planning a PANEL SESSION — beats sequence cognitive moves over EXISTING evidence (assertion, dissent, re-reading, model run, synthesis). NO invented forward-time events; the cast deliberates, dissents, synthesises.',
  'atlas':       'You are planning a TYPOLOGY ENTRY — beats sequence the entry\'s structural facets (definition → characteristics → mechanism → scope → cross-references). NO chronology, NO arc, NO interiority.',
  'debate':      'You are planning a CONTEST MOVE — beats sequence the move\'s attribution, intent, deployment, and effect under the rules. Each beat anchors to a contestant + axis + rule.',
  'record':      'You are planning a CHRONICLE ENTRY — beats sequence the entry\'s time-stamped observations and changes at the declared velocity. Documentary voice; gaps named, not papered.',
  'game':        'You are planning a TURN — beats sequence the active actor\'s deliberation (under their information set), the chosen move (from their legal action set), the rule-check (which rule fires, which constraint binds), the state change (resources / position / stakes shift), and the information disclosed to other actors. Each beat anchors to the active actor + a legal action + a rule-checked outcome. Illegal moves are not beats.',
};

/** Per-paradigm scene-shape label used by the plan-edit system prompt's
 *  shape-preservation clause. */
export const EDIT_SHAPE_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'dramatic event (forward-time, characters acting, world changing through events)',
  'non-fiction': 'documented event (anchored to the record, sourcing discipline gates fabrication)',
  'simulation':  'rule-driven event (the modelled rules force what happens; authorial rescue is paradigm error)',
  'essay':       'essay section (one named author working an argument — claim, evidence, counter, qualification, conclusion)',
  'panel':       'panel session (cognitive event over EXISTING evidence; no invented forward-time events)',
  'atlas':       'typology entry (structural attributes + position in the system; no arc, no interiority)',
  'debate':      'contest move (attribution + intent + effect under the contest\'s rules)',
  'record':      'chronicle entry (dated, documentary voice, at the declared time velocity)',
  'game':        'game turn (active actor + legal move from their action set + rule-checked outcome + state change + information disclosure to other actors)',
};

// ─── Analyst surfaces ───────────────────────────────────────────────────────

/** Per-paradigm analytical discipline — what an analyst looks at differently
 *  in this paradigm. Used inside surface-specific builders (branch chat,
 *  search synthesis, etc.). */
export const ANALYST_DISCIPLINE_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':
    'Read for dramatic shape: thread commitments, character transformation, escalation/payoff rhythm, thematic resolution. The engine\'s vocabulary (branch, arc, scene, thread, delta) describes invented dramatic structure.',

  'non-fiction':
    'Read for sourcing and evidentiary discipline: which named figures, places, dates, and quotes anchor to the documented record vs. which are inferred from gaps. Threads track historical / biographical questions the work pursues. Treat invented detail as a regression, not authorial latitude.',

  'simulation':
    'Read for rule-driven trajectory: which agent acted under which constraint, which thread closed because the rules forced it (vs. authorial pull), which scenarios remain live under the modelled rule set. Recoveries must be earned through initial-condition shifts, rule changes, or new positions inside existing rules — not authorial rescue.',

  'essay':
    'Read for argument structure: the central claim, the evidence weighed, counter-positions engaged, qualifications added, the conclusion reached (or honestly deferred). "Scenes" here are sections of cognition — interlocutors are positions engaged, not characters with arcs. Threads are argument-questions whose stances harden or invert; they do not dramatically pay off.',

  'panel':
    'Read for cognitive event quality: each thinker\'s contribution attributed, dissent surfaced, the session moving through productive disagreement toward synthesis (or honest stall). "Scenes" are deliberations over existing evidence — not invented forward-time events. Threads track the panel\'s shared question + per-member sub-investigations.',

  'atlas':
    'Read for typological coherence: classification consistency, cross-reference density, position of each entry in the system. There are no arcs and no resolutions — entries describe stable structure, not history. Threads (when present) are classification questions whose stances refine over time; they do not dramatically pay off.',

  'debate':
    'Read for contest mechanics: each move\'s attribution, intent (which axis of contestation it targets), and effect under the rules. Threads are axes of contestation; outcomes favour one party or the other under the contest\'s own logic. Do not smooth events into a single character\'s throughline.',

  'record':
    'Read for trajectory accumulation across dated entries at the declared time velocity. Threads are long-running trajectories that ACCUMULATE evidence across many entries — they do not "close" with dramatic payoff. The chronicler observes and logs; do not impose omniscient interiority on entries that record what was observed.',

  'game':
    'Read for game mechanics: which actor moved, which action they chose from their legal set, which rule fired and what state changed, which stakes shifted, what each actor knew vs. didn\'t know going in. Threads are open STAKES the contest is deciding — they close when the rules resolve them, not when the analyst would prefer. Each actor is its own perspective with its own goals, information, and constraints; do not impose a single-protagonist throughline on a multi-actor game.',
};

/** Per-paradigm Compass lens — what the Compass cohort looks like in this
 *  paradigm. Used by Present extraction, Compass cohort generation, rescore. */
export const COMPASS_LENS_BY_PARADIGM: Record<NarrativeParadigm, string> = {
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

  'game': `COMPASS LENS — game.
"Continuations" are next moves available to the actors under the rules: legal actions in the current state, response patterns to others' last moves, alliance shifts, resource gambits, stake plays, rule-trigger setups.
Forward-motion shape: turn-and-counter-turn — each actor's move constrains the others' legal options; the cohort surfaces the strategic postures each actor might adopt and the rule-driven consequences that follow.
Native attractors: the rules' own attractors (win conditions, resource sinks, dominant strategies, terminal states), each actor's stated objectives, the contested stakes the game is deciding.
Natural cadence: turn-paced by the rules — moves resolve when the rules permit, state updates on triggers. Subgenre adjusts pace (chess turns faster than treaty negotiation faster than a campaign season faster than a litigation phase).
Tail vocabulary: rule-driven rupture — a win condition met, a new actor entering or exiting, a rule activating that voids prior leverage, an alliance collapsing, a resource sink draining, partial information becoming common knowledge.
Pool variables name STRATEGIC FORCES under the rules — actors' current positions, resource stocks, information asymmetries, alliance vectors, rule-trigger proximities, stake-pressure on open threads. Score strategic state under the game's own rules; do not invent forces the rules cannot express.`,
};

// ─── Probe hints (survey / interview) ───────────────────────────────────────

/** Per-paradigm survey-probe hint — what kinds of probes pay off in this
 *  paradigm. Used by the survey question generator. */
export const SURVEY_PROBE_HINT_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'Probes that pay: hidden knowledge, divergent beliefs, trust asymmetries, predictions, perceptions of threat or allegiance. Forced-rank questions surface priorities; estimate questions surface knowledge asymmetries.',
  'non-fiction': 'Probes that pay: what each documented figure actually witnessed vs. what they were later told, where their stated motives diverged from observed behaviour, where the record has gaps the cast silently fills. Estimate questions reveal documented-knowledge asymmetries.',
  'simulation':  'Probes that pay: agents\' decision RULES (the threshold at which they commit, the parameter that dominates their decision), locations\' scenario roles (terrain, jurisdiction, modelled region), artifacts\' parameter values and modelled effects. Forcing the rule itself to surface is the highest-illumination move.',
  'essay':       'Probes that pay: the author\'s commitments behind the argued claim, the interlocutors\' positions actually engaged vs. cited-and-skipped, the qualifications the author would add under pressure, the priors the argument silently depends on.',
  'panel':       'Probes that pay: each thinker\'s methodological priors, the evidence each one weighs heaviest, the dissenter\'s deepest objection, what each one would change their mind on, the gaps in the panel\'s shared evidence base.',
  'atlas':       'Probes that pay: classification edge-cases (where does entry X actually belong?), what makes each specimen MARGINAL within its category, what would force a re-classification, which cross-references the typology underweights.',
  'debate':      'Probes that pay: each contestant\'s read of the contest\'s rules, the axis each one believes is decisive, the vulnerability each one would exploit if they could, the move each one fears most. Arbiters reveal which axes they weight when forced to rank.',
  'record':      'Probes that pay: what each chronicled figure observed in this period vs. what was reported to them, where the chronicler\'s gaps are, which trajectories the figures see continuing vs. ending, what they expect the next entry to record.',
  'game':        'Probes that pay: each actor\'s win condition (what they\'re actually playing for), their read of their own legal action set vs. opponents\', the move they most fear, the resource they\'d trade everything for, the rule they\'d exploit if they could, what they don\'t know that others do. Forced-rank questions surface priorities; estimate questions surface information asymmetries between actors.',
};

/** Per-paradigm interview-probe hint. */
export const INTERVIEW_PROBE_HINT_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'A depth interview reveals what the subject silently carries — secrets, fears, predictions, the version of events they tell themselves. Mix types: binary checks, likert stances, estimates of knowledge they shouldn\'t have, forced choices that pin priorities.',
  'non-fiction': 'A depth interview surfaces what the documented figure / institution would say if asked directly — anchored to recorded behaviour and stated motivations, with gaps named honestly. Where the record is silent, the subject answers from continuity, not invention.',
  'simulation':  'The subject answers under its decision rules — questions can probe the rule itself ("under what condition would you commit your reserve?", "which parameter dominates when supply drops below threshold?"). Answers will be rule-constrained; that constraint IS the data.',
  'essay':       'The subject is typically the author (anchor) or a cited interlocutor — interview surfaces the priors behind their stated position, the qualifications they would add, the objection they take most seriously, what they would change in light of new evidence.',
  'panel':       'The subject is a panel member — interview surfaces their methodological priors, the evidence they weigh heaviest, what would change their mind, the gap they see in the panel\'s shared evidence base.',
  'atlas':       'The subject is an entry / specimen / doctrine — interview surfaces its position in the system: what it extends, what it conflicts with, what makes it marginal vs. central, what would force a re-classification. The curator\'s voice answers, not a character\'s.',
  'debate':      'The subject is a contestant — interview surfaces their strategy, the axes they believe decisive, the move they fear most, their read of the arbiter\'s priors. Answers are positioned in the contest, not detached.',
  'record':      'The subject is a chronicled figure or institution — interview surfaces what they observed in their period, the trajectory they see, what they expect to be recorded next. The chronicler\'s documentary tone shapes the voice.',
  'game':        'The subject is one actor in the contest — interview surfaces their strategy, their read of the rules and the current state, the leverage they hold, the moves they fear, the alliances they\'re calibrating, what they know vs. don\'t know. Answers are positioned in the game state; the actor responds from their own information set, never from a global view.',
};

// ─── Direction / expansion ──────────────────────────────────────────────────

/** Per-paradigm direction shape for arc / narrative-direction proposals. */
export const DIRECTION_SHAPE_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'The next arc names a central dramatic pressure, the shape of consequence, and the anchoring character / location / artifact. Vector, not script — the arc-generation pass discovers the path.',
  'non-fiction': 'The next arc names a documented question still open, the figures and sources it engages, and the trajectory of inquiry. Vector, not script — anchored to record, no fabrication of events.',
  'simulation':  'The next arc names what the rules force next as conditions evolve — the threshold approaching, the agent whose modelled state is at a decision point, the rule activation that drives consequence. Do not "rescue" a thread the model condemns through authorial pull; recoveries are earned via initial-condition shifts, rule changes, or new positions inside existing rules.',
  'essay':       'The next "arc" is the next MOVEMENT — the next claim the author argues, the next counter-position to engage, the next qualification or evidence to weigh. Vector at the argument level, not a scene plan.',
  'panel':       'The next "arc" is the next INQUIRY — the next claim the panel evaluates, the next dissent to surface, the next scenario or evidence packet to deliberate over. Vector, not script.',
  'atlas':       'The next "arc" is the next SECTION of the typology — entries to add, a sub-classification to articulate, a cross-reference layer to formalise. Vector at the classification level; no events, no character arcs.',
  'debate':      'The next "arc" is the next PHASE of the contest — the next axis to contest, the next witness / argument / move to deploy, the next rule-triggered juncture. Vector, not script. Resolution belongs to the arbiter, not the analyst.',
  'record':      'The next "arc" is the next PERIOD at the declared time velocity — what entries should cover, which trajectories need updates, which figures\' states have shifted enough to record. Vector, not script.',
  'game':        'The next "arc" is the next ROUND or PHASE of the contest — which actor moves next, which stakes are pressing, which rules are about to fire, which resource / position / alliance shift opens new legal moves. Vector, not script — resolution belongs to the rules, not the analyst. Do not script which actor "should" win.',
};

/** Per-paradigm extension shape for world-expansion proposals + execution. */
export const EXPANSION_SHAPE_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'Extend by adding characters, locations, artifacts, threads, and system rules that fit the work\'s register and existing fabric. Anchor new entities via relationships, location hierarchies, and shared threads.',
  'non-fiction': 'Extend the documented world by adding figures, places, sources, and institutions anchored to the record. New entities must trace to verifiable real-world referents; gaps are named, not fabricated.',
  'simulation':  'Extend by adding rule-bearing entities and subsystems — agents whose decision rules matter, locations as modelled regions or theatres, artifacts as rule-bearing instruments (treaty, charter, ledger, doctrine), system nodes as new rules / mechanisms / propagation laws. The expansion deepens the rule substrate that drives consequence.',
  'essay':       'Extend the argument substrate — add cited interlocutors as transient anchors, primary sources / archives as artifacts, propositions / mechanisms / evidence relations as system nodes. The system-graph is the argument; deepen it, do not invent dramatic characters.',
  'panel':       'Extend the panel\'s inquiry — add specialists / sources / external interlocutors, evidence packets as artifacts, sub-investigation threads, methodological propositions as system nodes. New thinkers must integrate via methodological agreement / disagreement, not invented forward-time events.',
  'atlas':       'Extend by adding ENTRIES (specimens / taxa / doctrines / concepts) — never characters with arcs. Cross-references and classification edges are the connective tissue; add them densely. System-graph carries the weight.',
  'debate':      'Extend the contest — add moves, axes of contestation, witnesses / surrogates as transient characters, rule-bearing artifacts. At scope shifts, new contestants may enter; otherwise the existing parties stay locked in. Do not add side-characters with their own dramatic interiority.',
  'record':      'Extend the chronicle — add chronicled figures, institutions, locations, and tracked subjects that the record needs to log. Threads accumulate trajectories across entries; do not invent forward-time events the chronicler couldn\'t have witnessed at the declared velocity.',
  'game':        'Extend the contest — add ACTORS (characters / factions / sides), RESOURCES (artifacts the actors command, with quantity or capacity where it matters), POSITIONS (locations / territories under contest), and rule-bearing system nodes (new legal actions, new victory conditions, new constraints). New actors must enter with declared objectives, information sets, and constraints; new rules must say which moves they enable, forbid, or score. Do not add bystanders who don\'t play; everyone in the game state has stakes.',
};

// ─── Review criteria ────────────────────────────────────────────────────────

/** Per-paradigm criteria for the prose-review system prompt. */
export const PROSE_REVIEW_CRITERIA_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'PROSE CRITERIA — fiction. Voice consistency, dialogue naturalism, sensory grounding, interiority depth, dramatic logic. Pacing within scenes — beats breathing or rushing. Continuity of established facts, entity positions, knowledge asymmetries. Repetition of phrases, images, sentence structures, verbal tics. Profile compliance.',
  'non-fiction': 'PROSE CRITERIA — non-fiction. Voice consistency, evidentiary precision, claim-evidence cadence, attribution accuracy, anchored detail (every named figure / place / date traceable). Pacing of evidentiary build. Continuity with the documented record — invented facts are regressions, not authorial latitude. Repetition. Profile compliance.',
  'simulation':  'PROSE CRITERIA — simulation. Rule fidelity (outcomes follow from the stated rule set under the given conditions, not authorial preference), scenario tightness, consequence consistency. POV stays inside the modelled world (no external modeller voice unless the premise puts them there). Pacing reflects the model\'s own dynamics. Continuity of modelled state. Diegetic-overlay coherence (HUD / log / status entries real to the agents). Repetition. Profile compliance.',
  'essay':       'PROSE CRITERIA — essay. Voice consistency of the named author. Argument tightness — claims supported, counter-positions engaged, qualifications added, conclusions earned. NO manufactured dialogue between interlocutors who never met; NO fictional scene-events. Internal friction substitutes for invented disagreement. Repetition (rhetorical, conceptual, evidentiary). Profile compliance.',
  'panel':       'PROSE CRITERIA — panel. Each thinker\'s contribution attributed. Dissent surfaced explicitly. No fabricated forward-time events — scenes are cognitive events over EXISTING evidence. Pacing reflects deliberation cycles. Synthesis movement — does the session move through productive disagreement toward synthesis or honest stall? Repetition. Profile compliance.',
  'atlas':       'PROSE CRITERIA — atlas. Typological rigour. Curator\'s voice consistent and authoritative. Entries describe stable structure, not events. Cross-references explicit. No interiority, no arc resolution, no dramatic action within entries. Repetition across entries (legitimate when typologically motivated; flag when filler). Profile compliance.',
  'debate':      'PROSE CRITERIA — debate. Every move carries attribution (which party), intent (which axis it targets), effect (how rules + arbiter scored it). NO smoothing of events into a character\'s emotional throughline. NO omniscient narrator voice summarising strategy from outside the contest. Rules of engagement surfaced when triggered. Repetition. Profile compliance.',
  'record':      'PROSE CRITERIA — record / chronicle. Time-velocity coherence (declared velocity respected; shifts marked as editorial signal). Documentary voice — no omniscient interiority. Time-stamps lead entries. Gap-marking discipline (gaps named honestly, not papered over). Quotes quoted, not invented. Repetition. Profile compliance.',
  'game':        'PROSE CRITERIA — game. Rule fidelity — every move legal under the stated rules in the current state; illegal moves not smoothed into the action. Actor attribution — which actor moved, on which turn, under which constraint, with which information. State-change traceability — resources / positions / information / stakes shift only as the rules allow. Multi-actor distinctness — actors retain distinct goals, information, and voices; no monolithic cast register. Partial-information discipline — what each actor knows or guesses stays consistent with what the rules disclosed. Repetition. Profile compliance.',
};

/** Per-paradigm criteria for the branch-review system prompt. */
export const BRANCH_REVIEW_CRITERIA_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'BRANCH CRITERIA — fiction. Structural shape: dramatic escalation, thread arcs that build and pay off. Pacing — breathing room between high-intensity moments. Repetition of beats, locations, entity reactions. Entity development — anchors changing, recurring characters moving. Threads advancing vs stagnating. Thematic question the work is interrogating.',
  'non-fiction': 'BRANCH CRITERIA — non-fiction. Structural shape: evidentiary through-line, claims built case-by-case. Pacing — evidence accumulation rhythm. Repetition of attribution patterns or evidence types. Entity development — documented figures whose state shifts in the record. Threads (investigation questions) advancing vs stagnating. Thematic question the work pursues against the record.',
  'simulation':  'BRANCH CRITERIA — simulation. Rule-driven trajectory — do scenes follow as the established rule set forces under the given conditions? Authorial rescue is a verdict-edit flag. Pacing — model dynamics, threshold crossings, regime shifts. Repetition (rule-applications producing the same outcome without advancing modelled state count as repetition). Entity development — modelled agents whose state changes under the rules. Threads — rule-driven questions ("will the system reach state X?"). Thematic question — what the rule set under stress reveals.',
  'essay':       'BRANCH CRITERIA — essay. Argument structure — claim chain, evidence weight, counter-position engagement, qualifications, conclusion. Do NOT demand dramatic arc. Pacing — argumentative cadence. Repetition (rhetorical or conceptual). Entity development — the author\'s commitments shifting, cited interlocutors engaged. Threads (argument questions) advancing. Thematic question — the central claim being defended.',
  'panel':       'BRANCH CRITERIA — panel. Does the cast actually disagree over EXISTING evidence? Flag manufactured forward-time events. Pacing — deliberation cycles. Repetition of methodological appeals. Entity development — panel members\' priors shifting. Threads — the shared question + per-member sub-investigations. Thematic question — what the panel is pursuing.',
  'atlas':       'BRANCH CRITERIA — atlas. Typological coverage, cross-references, classification rigour. Do NOT demand resolution. Pacing — structural density. Repetition (legitimate when typologically motivated). Entity development — entries described stably (not arcing). Threads (when present) — classification questions. Thematic question — what the typology illuminates about its domain.',
  'debate':      'BRANCH CRITERIA — debate. Are moves attributed, intent-targeted, and rule-scored? Flag emotional-throughline narration. Pacing — move-and-response rhythm. Repetition of contestant tactics. Entity development — each contestant\'s posture / capacity shifting. Threads — axes of contestation. Thematic question — the contest\'s underlying stakes.',
  'record':      'BRANCH CRITERIA — record / chronicle. Time-velocity coherence, documentary voice, gap-marking discipline. Do NOT demand arc resolution within a single entry. Pacing — velocity shifts as editorial signal. Repetition of chronicled patterns. Entity development — figures evolving across entries. Threads — long-running trajectories. Thematic question — what the chronicle illuminates about its period.',
  'game':        'BRANCH CRITERIA — game. Rule-driven trajectory — do turns follow as the rules + actors\' legal options force? Authorial rescue is a verdict-edit flag. Pacing — turn cadence + phase shifts. Repetition (same actor making the same kind of move without state advancing, or rules firing the same way without stake movement). Actor development — each actor\'s position / resources / information evolving distinctly under the rules. Threads — open stakes the contest is deciding, closing only on rule-driven resolution. Thematic question — what the game under stress reveals about its actors or rules.',
};

/** Per-paradigm criteria for the plan-review system prompt. */
export const PLAN_REVIEW_CRITERIA_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'PLAN SHAPE — fiction. Beats sequence dramatic action, dialogue, interiority, world reveal. Beat-to-delta alignment: thread escalations need a beat showing them; world deltas need a beat where the entity learns / changes.',
  'non-fiction': 'PLAN SHAPE — non-fiction. Beats sequence documented events, attributed witness, evidentiary moves. Beat-to-delta alignment: every claim a delta encodes needs a beat sourcing it from the record.',
  'simulation':  'PLAN SHAPE — simulation. Beats sequence rule applications, threshold crossings, agent decisions under the rules. Beat-to-delta alignment is CRITICAL: a system delta declaring a rule fires must have a beat where the rule is actually applied. A modelled agent cannot hold a state the rule set has not established for them at this point.',
  'essay':       'PLAN SHAPE — essay. Beats sequence argument moves (claim → evidence → counter → qualification → conclusion). NO action beats; argument-shape beats only. Beat-to-delta alignment: thread escalations are argument-question advances, not dramatic moves.',
  'panel':       'PLAN SHAPE — panel. Beats sequence cognitive moves — assertion, dissent, re-reading, model run, synthesis. No invented forward-time events. Beat-to-delta alignment: world deltas record member-state shifts (priors, commitments), not external happenings.',
  'atlas':       'PLAN SHAPE — atlas. Beats sequence the entry\'s structural facets (definition → characteristics → mechanism → scope → cross-references). NO chronology, NO arc beats. Beat-to-delta alignment: system deltas record classification additions, not events.',
  'debate':      'PLAN SHAPE — debate. Beats sequence the move\'s attribution, intent, deployment, effect. Each move has a target axis. Beat-to-delta alignment: thread escalations are axis-of-contestation shifts; arbiter responses (rule activations, scoring) need beats.',
  'record':      'PLAN SHAPE — record. Beats sequence the entry\'s time-stamped observations and changes. Entries respect the declared time velocity. Beat-to-delta alignment: world deltas record state-shifts at the entry\'s time-stamp; gaps are named, not papered.',
  'game':        'PLAN SHAPE — game. Beats sequence the active actor\'s deliberation (under their information set), the chosen move (from their legal action set), the rule-check, the state change, and the information disclosed. Beat-to-delta alignment is CRITICAL: a system delta declaring a rule fires must have a beat where the rule is actually applied; a thread (stake) delta declaring a stake shifts must have a beat where the game state changes the stake under the rules. Illegal moves are not beats.',
};
