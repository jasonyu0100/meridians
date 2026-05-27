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
import { composeWorkIdentity, PLAN_SHAPE_BY_PARADIGM } from "../paradigm";

export type ScenePlanSystemPromptArgs = {
  narrativeTitle?: string;
  paradigm?: NarrativeParadigm;
  genre?: string;
  subgenre?: string;
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
