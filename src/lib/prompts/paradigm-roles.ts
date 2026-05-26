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
  // Genre + subgenre as a concretisation tail: "<subgenre> (<genre>)" when both
  // present; "<subgenre>" or "<genre>" alone when only one is. The subgenre
  // carries the strongest trained association, so it leads.
  const g = args.genre?.trim();
  const sg = args.subgenre?.trim();
  let tail = '';
  if (sg && g && sg.toLowerCase() !== g.toLowerCase()) tail = ` — ${sg} (${g})`;
  else if (sg) tail = ` — ${sg}`;
  else if (g) tail = ` — ${g}`;
  return `${role} The work is "${args.title}"${tail}.`;
}
