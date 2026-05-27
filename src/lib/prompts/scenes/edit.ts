/**
 * Scene Plan Edit System Prompt — targeted plan revisions.
 *
 * High-level identity only. The beat-fn/mechanism vocabulary, rewrite rules,
 * proposition guidance, and output schema live in the user prompt
 * (buildScenePlanEditUserPrompt).
 *
 * "Dramaturg" is fiction-coded; the work may be a typology, a contest, a
 * chronicle, an essay, etc. The role is paradigm-neutral here — a plan
 * editor making targeted revisions to the scaffold the writer will render.
 */

import type { NarrativeParadigm } from "@/types/narrative";
import { composeWorkIdentity } from "../paradigm-roles";

// Per-paradigm scene-shape name to preserve across the edit. Replaces the
// multipurpose enumeration that listed all paradigms inline.
const EDIT_SHAPE_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'dramatic event (forward-time, characters acting, world changing through events)',
  'non-fiction': 'documented event (anchored to the record, sourcing discipline gates fabrication)',
  'simulation':  'rule-driven event (the modelled rules force what happens; authorial rescue is paradigm error)',
  'essay':       'essay section (one named author working an argument — claim, evidence, counter, qualification, conclusion)',
  'panel':       'panel session (cognitive event over EXISTING evidence; no invented forward-time events)',
  'atlas':       'typology entry (structural attributes + position in the system; no arc, no interiority)',
  'debate':      'contest move (attribution + intent + effect under the contest\'s rules)',
  'record':      'chronicle entry (dated, documentary voice, at the declared time velocity)',
};

export type ScenePlanEditSystemPromptArgs = {
  narrativeTitle: string;
  paradigm?: NarrativeParadigm;
  genre?: string;
  subgenre?: string;
};

/** Build the plan-edit system prompt. Optional paradigm/genre/subgenre fuse
 *  into the work META so the editor inherits the same identity the planner
 *  and writer read. */
export function buildScenePlanEditSystemPrompt(
  args: ScenePlanEditSystemPromptArgs | string,
): string {
  // Back-compat: accept a bare title string for call-sites that haven't been
  // migrated. New call-sites pass the full args object.
  const a: ScenePlanEditSystemPromptArgs = typeof args === 'string' ? { narrativeTitle: args } : args;
  const identity = composeWorkIdentity({
    title: a.narrativeTitle,
    paradigm: a.paradigm,
    genre: a.genre,
    subgenre: a.subgenre,
  });
  const shape = a.paradigm
    ? `The scene's shape — a ${EDIT_SHAPE_BY_PARADIGM[a.paradigm]} — MUST be preserved across the edit.`
    : "The scene's paradigm shape (typology entry / contest move / chronicle entry / essay section / panel session / rule-driven event / fiction or non-fiction event) MUST be preserved across the edit.";
  return `${identity} You are now making TARGETED REVISIONS to a scene plan — not a regeneration. Preserve the existing structure and only modify what the user prompt's issues specifically address. ${shape} Return ONLY valid JSON.`;
}
