/**
 * Scene Plan System Prompt — combined "fact-extractor + scene architect" role.
 *
 * High-level identity only. The detailed beat taxonomy, proposition rules,
 * extraction discipline, output schema, and mechanism guidance live in the
 * user prompt (buildScenePlanUserPrompt).
 *
 * Accepts the work's META (paradigm + genre + subgenre + title) so the plan
 * inherits the same identity the prose stage will read.
 */

import type { NarrativeParadigm } from "@/types/narrative";
import { composeWorkIdentity } from "../paradigm-roles";

export type ScenePlanSystemPromptArgs = {
  narrativeTitle?: string;
  paradigm?: NarrativeParadigm;
  genre?: string;
  subgenre?: string;
};

// Per-paradigm plan-shape framing. Replaces the multipurpose "the scene may
// be X, Y, or Z" enumeration with a focused, paradigm-specific framing.
const PLAN_SHAPE_BY_PARADIGM: Record<NarrativeParadigm, string> = {
  'fiction':     'You are planning a DRAMATIC EVENT — beats sequence physical action, dialogue with subtext, interiority, world reveal. Forward-time event narration is the substrate.',
  'non-fiction': 'You are planning a DOCUMENTED EVENT — every beat traceable to the record. Same form as fiction; sourcing discipline gates fabrication. Gaps are named honestly, not invented around.',
  'simulation':  'You are planning a RULE-DRIVEN EVENT — beats sequence rule applications, threshold crossings, agent decisions under the rule set. Every system delta the scene claims must have a beat where the rule is actually applied.',
  'essay':       'You are planning an ESSAY SECTION — beats sequence argument moves (claim → evidence → counter → qualification → conclusion). NO action beats; argument-shape beats only. The named author works through reasoning.',
  'panel':       'You are planning a PANEL SESSION — beats sequence cognitive moves over EXISTING evidence (assertion, dissent, re-reading, model run, synthesis). NO invented forward-time events; the cast deliberates, dissents, synthesises.',
  'atlas':       'You are planning a TYPOLOGY ENTRY — beats sequence the entry\'s structural facets (definition → characteristics → mechanism → scope → cross-references). NO chronology, NO arc, NO interiority.',
  'debate':      'You are planning a CONTEST MOVE — beats sequence the move\'s attribution, intent, deployment, and effect under the rules. Each beat anchors to a contestant + axis + rule.',
  'record':      'You are planning a CHRONICLE ENTRY — beats sequence the entry\'s time-stamped observations and changes at the declared velocity. Documentary voice; gaps named, not papered.',
};

export function buildScenePlanSystemPrompt(
  args: ScenePlanSystemPromptArgs = {},
): string {
  const identity = args.narrativeTitle
    ? composeWorkIdentity({
        title: args.narrativeTitle,
        paradigm: args.paradigm,
        genre: args.genre,
        subgenre: args.subgenre,
      })
    : '';
  const intro = identity ? `${identity} You are now in the planning stage — ` : '';
  const planShape = args.paradigm
    ? PLAN_SHAPE_BY_PARADIGM[args.paradigm]
    : 'The scene may be a fiction or non-fiction event, a rule-driven simulation event, an essay section, a panel cognitive event, a typology entry, a contest move, or a chronicle entry — read the paradigm-shape block to know which, and SHAPE THE PLAN TO THAT FORM (a typology entry is not a sequence of dialogue beats; a contest move is not a character\'s interior journey; a chronicle entry is not a forward-time narrative beat).';
  return `${intro}you extract scene facts and architect a beat plan for the writer. ${planShape} Given the scene's structural data (summary, deltas, events), do two things in one pass: (1) extract the COMPLETE set of compulsory propositions the scene must land — natural language ready for the writer, never identifier-echoes or template scaffolding; (2) glue them into a beat plan as JSON — the blueprint the writer renders. Every compulsory proposition must appear in some beat. Follow the taxonomy, density bands, extraction discipline, and output schema in the user prompt. Return ONLY valid JSON.`;
}
