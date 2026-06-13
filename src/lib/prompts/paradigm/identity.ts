/**
 * Paradigm identity — work identity, role identities, and composers that
 * fuse them with title + genre + subgenre into an identity line for system
 * prompts.
 *
 * Two role flavours:
 *  - WRITER — what the engine GENERATES in each paradigm (prose, sections,
 *    entries, moves, etc.). Used by generation surfaces.
 *  - ANALYST — what the engine READS / interrogates / compares in each
 *    paradigm. Used by analytical surfaces.
 */

import type { NarrativeParadigm, NarrativeState } from '@/types/narrative';

// ─── Work identity ──────────────────────────────────────────────────────────

/** Identity for a NarrativeState — convenience extractor used at callsites. */
export type WorkIdentity = {
  title?: string;
  paradigm?: NarrativeParadigm;
  genre?: string;
  subgenre?: string;
};

/** Pull a WorkIdentity off a NarrativeState. */
export function workIdentityFor(
  narrative: Pick<NarrativeState, 'title' | 'paradigm' | 'genre' | 'subgenre'>,
): WorkIdentity {
  return {
    title: narrative.title,
    paradigm: narrative.paradigm,
    genre: narrative.genre,
    subgenre: narrative.subgenre,
  };
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

// ─── Writer roles ───────────────────────────────────────────────────────────

/** Per-paradigm WRITER identity. Single-line claim in the system prompt.
 *  Use paradigm-native craft nouns (moves, entries, sections) rather than
 *  abstract role labels. */
export const WRITER_ROLE_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'You write fiction prose for an invented populated world.',
  'non-fiction': 'You write non-fiction prose against a documented record — every named person, place, event, and date must anchor to actual fact.',
  'simulation':  'You write rule-driven event prose — the modelled rules force what happens; agents act under them, not above them.',
  'essay':       'You write essay sections — one named author works through an argument; cited interlocutors are positions engaged, not characters who act.',
  'panel':       'You write panel sessions — a named cast cognizes over existing evidence; no fabricated forward-time events.',
  'atlas':       'You write typology entries — specimens, taxa, doctrines, or concepts described by structural attributes and position in the system, not by events.',
  'debate':      'You write moves in an adversarial contest — each move has attribution, intent, and effect under explicit rules; not a fiction scene with throughline.',
  'record':      'You write dated chronicle entries — what happened and what changed at the declared time velocity, in the chronicler\'s documentary voice; not omniscient narrator.',
  'scenario':    'You write moves in a modelled strategic moment — each scene is one actor\'s decision or action from its own vantage, the operative dynamics bearing on it, with effects on position, leverage, information, and the live stakes; no single-protagonist throughline, each actor reads the moment from its own information.',
};

/** Writer-role identity line. When paradigm is unset, fall back to a
 *  deliberately neutral identity that does not lean fiction. */
export function writerRoleFor(paradigm: NarrativeParadigm | undefined): string {
  return paradigm
    ? WRITER_ROLE_BY_PARADIGM[paradigm]
    : 'You write prose adapted to the source\'s form — fiction, documented record, argument, chronicle, typology, contest, panel session, rule-driven simulation, or multi-actor game.';
}

/** Compose the work's META identity — single sentence fusing paradigm
 *  craft + work title + genre / subgenre concretisation. The trio of
 *  paradigm, genre, and subgenre defines what the LLM is writing — the
 *  paradigm names the form, the genre names the tradition, the subgenre
 *  names the specific voice. Trained associations on the subgenre are the
 *  strongest cue we can give the model. */
export function composeWorkIdentity(args: {
  title: string;
  paradigm?: NarrativeParadigm;
  genre?: string;
  subgenre?: string;
}): string {
  const role = writerRoleFor(args.paradigm);
  return `${role}${workTail(args)}`;
}

// ─── Analyst roles ──────────────────────────────────────────────────────────

/** Per-paradigm ANALYST identity. Frames what the analyst is reading and
 *  what the engine primitives MEAN in this paradigm. */
export const ANALYST_ROLE_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'You analyse a long-form fiction work — invented characters, places, events; threads as the dramatic questions the work is pursuing.',
  'non-fiction': 'You analyse a long-form non-fiction work — documented people, places, and events anchored to a real record; threads as the historical/biographical questions the work is pursuing.',
  'simulation':  'You analyse a rule-driven simulation — agents acting under a stated rule set; threads as questions about what the rules force as conditions evolve; outcomes are rule-driven, not authorial.',
  'essay':       'You analyse an essay — one named author working an argument across sections; threads as the argument-questions being pursued; cited interlocutors are positions engaged, not characters with arcs.',
  'panel':       'You analyse a panel session — a named cast cognising over existing evidence; threads as the panel\'s shared questions and per-member sub-investigations; events are interpretive, not invented forward-time.',
  'atlas':       'You analyse a reference typology — entries (specimens, taxa, doctrines, concepts) classified by structural attributes and position; threads, when present, track classification questions, not arcs.',
  'debate':      'You analyse an adversarial contest — two or more named parties locked in zero-sum stakes under explicit rules; threads as axes of contestation whose outcomes favour one party or the other.',
  'record':      'You analyse a chronological record — dated entries in a chronicler\'s voice at a declared time velocity; threads as long-running trajectories tracked across entries, not arcs that dramatically resolve.',
  'scenario':    'You analyse a modelled strategic moment — multiple actors pursuing their aims from their own vantage under the moment\'s operative dynamics; threads are the live strategic questions it hangs on; events are moves shaped by the dynamics and each actor\'s information, not authorial choices; stakes resolve as the dynamics force.',
};

/** Analyst-role identity line. When paradigm is unset, fall back to a
 *  deliberately neutral identity that names every form. */
export function analystRoleFor(paradigm: NarrativeParadigm | undefined): string {
  return paradigm
    ? ANALYST_ROLE_BY_PARADIGM[paradigm]
    : 'You analyse a long-form work — fiction, non-fiction, simulation, essay, panel, atlas, debate, chronicle, or multi-actor game. Read the source\'s form and adapt vocabulary accordingly; engine primitives (branch, entry, arc, scene, thread, delta, divergence, commitment) stay constant.';
}

/** Compose the ANALYST identity sentence — analyst role fused with title +
 *  genre + subgenre. Mirror of composeWorkIdentity for analytical surfaces. */
export function composeAnalystIdentity(args: {
  title?: string;
  paradigm?: NarrativeParadigm;
  genre?: string;
  subgenre?: string;
}): string {
  return `${analystRoleFor(args.paradigm)}${workTail(args)}`;
}
