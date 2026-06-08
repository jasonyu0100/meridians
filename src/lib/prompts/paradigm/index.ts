/**
 * Paradigm — single source of truth for all paradigm-aware prompting.
 *
 * Adding a paradigm to the engine? Edit:
 *   1. `NarrativeParadigm` union in `src/types/narrative.ts`
 *   2. `./shapes.ts` — add a case to every map (one file)
 *   3. `./identity.ts` — `WRITER_ROLE_BY_PARADIGM` + `ANALYST_ROLE_BY_PARADIGM`
 *   4. `./framing.ts` — `COMPASS_FRAMING_BY_PARADIGM`
 *   5. `./vocabulary.ts` — `PARADIGM_VOCABULARY`
 *
 * Every surface builder picks up automatically — no other file needs editing.
 *
 * File map:
 *   identity.ts   — WorkIdentity, writer/analyst roles, composeWorkIdentity,
 *                   composeAnalystIdentity, workIdentityFor
 *   framing.ts    — compass mode (prediction vs recommendation)
 *   vocabulary.ts — engine-primitive vocabulary per paradigm
 *   shapes.ts     — every other per-paradigm map (16 of them)
 *   analyst.ts    — surface builders for analytical surfaces (branch chat,
 *                   search synthesis, surveys, interviews, direction,
 *                   world expansion)
 *   compass.ts    — surface builders for forward-looking surfaces (Compass
 *                   cohort, Present, rescore)
 *   review.ts     — surface builders for review surfaces (prose, branch,
 *                   plan)
 */

// ─── Foundation ─────────────────────────────────────────────────────────────

export {
  ANALYST_ROLE_BY_PARADIGM,
  WRITER_ROLE_BY_PARADIGM,
  analystRoleFor,
  composeAnalystIdentity,
  composeWorkIdentity,
  workIdentityFor,
  writerRoleFor,
  type WorkIdentity,
} from './identity';

export {
  COMPASS_FRAMING_BY_PARADIGM,
  compassFramingFor,
} from './framing';

export {
  PARADIGM_VOCABULARY,
  paradigmVocabularyLine,
  type ParadigmVocabulary,
} from './vocabulary';

// ─── Per-paradigm shape maps (single source of truth) ───────────────────────

export {
  ANALYST_DISCIPLINE_BY_PARADIGM,
  BRANCH_REVIEW_CRITERIA_BY_PARADIGM,
  COMPASS_LENS_BY_PARADIGM,
  DIRECTION_SHAPE_BY_PARADIGM,
  EDIT_SHAPE_BY_PARADIGM,
  EXPANSION_SHAPE_BY_PARADIGM,
  INTERVIEW_PROBE_HINT_BY_PARADIGM,
  PLAN_REVIEW_CRITERIA_BY_PARADIGM,
  PLAN_SHAPE_BY_PARADIGM,
  PROSE_REVIEW_CRITERIA_BY_PARADIGM,
  PROSE_SHAPE_DIRECTIVE_BY_PARADIGM,
  SCENE_GENERATOR_FRAMING_BY_PARADIGM,
  SURVEY_PROBE_HINT_BY_PARADIGM,
  WORLD_ARCHITECT_BY_PARADIGM,
  WORLD_SHAPE_LABEL_BY_PARADIGM,
  proseShapeDirective,
} from './shapes';

// ─── Surface builders ───────────────────────────────────────────────────────

export {
  buildArcDirectionSystem,
  buildBranchChatSystem,
  buildExpandWorldSystem,
  buildExpansionSuggestSystem,
  buildExpertSearchSystem,
  buildInterviewGenSystem,
  buildNarrativeDirectionSystem,
  buildSearchSynthesisSystem,
  buildSurveyGenSystem,
  buildThreadingSystem,
} from './analyst';

export {
  buildCompassGenerationSystem,
  buildCompassRescoreSystem,
  buildPresentExtractionSystem,
} from './compass';

export {
  buildBranchReviewSystem,
  buildPlanReviewSystem,
  buildProseReviewSystem,
} from './review';
