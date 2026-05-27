/**
 * Centralized Prompts
 *
 * Single source of truth for all LLM prompts, schemas, and prompt builders.
 * Organized by domain for maintainability.
 */

// ── Core Prompts ────────────────────────────────────────────────────────────
export { SYSTEM_PROMPT } from './core/system';
export { PROMPT_FORCE_STANDARDS, buildForceStandardsPrompt } from './core/forces';
export { PROMPT_STRUCTURAL_RULES } from './core/structural-rules';
export { PROMPT_DELTAS } from './core/deltas';
export { PROMPT_BEAT_TAXONOMY } from './core/beat-taxonomy';
export { PROMPT_ARC_STATE_GUIDANCE } from './core/game-state';

// ── Entity Prompts ──────────────────────────────────────────────────────────
export { PROMPT_ARTIFACTS } from './entities/artifacts';
export { PROMPT_LOCATIONS } from './entities/locations';
export { PROMPT_ENTITY_INTEGRATION } from './entities/integration';
export { PROMPT_WORLD } from './entities/continuity';

// ── Scene Prompts ───────────────────────────────────────────────────────────
export { PROMPT_POV } from './scenes/pov';
export { PROMPT_SUMMARY_REQUIREMENT } from './scenes/summary';
export {
  promptThreadLifecycle,
  buildThreadHealthPrompt,
  buildCompletedBeatsPrompt,
} from './scenes/thread-lifecycle';
export { buildScenePlanSystemPrompt } from './scenes/plan';
export { buildBeatAnalystSystemPrompt } from './scenes/analyze';
export { buildScenePlanEditSystemPrompt } from './scenes/edit';
export { buildSceneProseSystemPrompt } from './scenes/prose';
export type { SceneProseSystemPromptArgs } from './scenes/prose';
export { buildGenerateScenesPrompt } from './scenes/generate';
export type { GenerateScenesPromptArgs } from './scenes/generate';
export {
  buildScenePlanUserPrompt,
  buildScenePlanEditUserPrompt,
  buildBeatAnalystUserPrompt,
} from './scenes/plan-user';
export {
  buildProseInstructionsWithPlan,
  buildProseInstructionsFreeform,
} from './scenes/prose-instructions';

// (Legacy schemas/ directory removed — the lifecycle-based fragments were
// unused dead code that confused LLM output shape. Prompts now embed their
// own schema snippets with the current market-based contract.)

// ── Ingest Prompts ──────────────────────────────────────────────────────────
export {
  buildIngestProseProfilePrompt,
  buildRefineProseProfilePrompt,
  buildProseSamplePrompt,
  INGEST_PROSE_PROFILE_SYSTEM,
  REFINE_PROSE_PROFILE_SYSTEM,
  PROSE_SAMPLE_SYSTEM,
} from './ingest';

// ── Premise Prompts ─────────────────────────────────────────────────────────
export {
  PREMISE_SUGGEST_PROMPT,
  PREMISE_SUGGEST_SYSTEM,
} from './premise';

// ── Prose Prompts ───────────────────────────────────────────────────────────
export { FORMAT_INSTRUCTIONS } from './prose/format-instructions';
export {
  buildRewriteSystemPrompt,
  buildRewriteUserPrompt,
  buildRewriteChangelogPrompt,
  REWRITE_CHANGELOG_SYSTEM,
} from './prose/rewrite';
export type { RewriteSystemPromptArgs } from './prose/rewrite';

// ── Review Prompts ──────────────────────────────────────────────────────────
export {
  buildBranchReviewPrompt,
  buildProseReviewPrompt,
  buildPlanReviewPrompt,
} from './review';

// ── Reconstruct Prompts ─────────────────────────────────────────────────────
export {
  buildEditScenePrompt,
  buildMergeScenesPrompt,
  buildInsertScenePrompt,
} from './reconstruct';
export type { EditSceneEvaluation } from './reconstruct';

// ── World Prompts ───────────────────────────────────────────────────────────
export {
  buildSuggestArcDirectionPrompt,
  buildSuggestAutoDirectionPrompt,
  buildSuggestWorldExpansionPrompt,
  buildExpandWorldPrompt,
  buildGenerateNarrativePrompt,
  buildDetectPatternsPrompt,
  EXPANSION_SIZE_CONFIG,
} from './world';
export type {
  ExpansionSizeConfig,
  SuggestWorldExpansionArgs,
  WorldExpansionSize,
  ExpandWorldArgs,
  GenerateNarrativeArgs,
  DetectPatternsArgs,
} from './world';

// ── Report Prompts ──────────────────────────────────────────────────────────
export { REPORT_SYSTEM, REPORT_ANALYSIS_PROMPT, REPORT_SECTIONS } from './report';
export type { ReportSectionKey } from './report';

// ── Analysis Prompts ────────────────────────────────────────────────────────
export {
  SCENE_STRUCTURE_SYSTEM,
  buildSceneStructurePrompt,
  ARC_GROUPING_SYSTEM,
  buildArcGroupingPrompt,
  RECONCILE_ENTITIES_SYSTEM,
  buildReconcileEntitiesPrompt,
  RECONCILE_SEMANTIC_SYSTEM,
  buildReconcileSemanticPrompt,
  COALESCE_OUTCOMES_SYSTEM,
  buildCoalesceOutcomesPrompt,
  THREADING_SYSTEM,
  buildThreadingPrompt,
  META_EXTRACTION_SYSTEM,
  buildMetaExtractionPrompt,
  DRIVER_SYNTHESIS_SYSTEM,
  buildDriverSynthesisPrompt,
  THREAD_INTEGRATION_SYSTEM,
  buildThreadIntegrationPrompt,
} from './analysis';

// ── Reasoning-Graph Prompts ─────────────────────────────────────────────────
export {
  reasoningModeBlock,
  forcePreferenceBlock,
  networkBiasBlock,
  getPlanNodeGuidance,
  buildSequentialPath,
  extractPatternWarningDirectives,
  buildArcReasoningGraphPrompt,
  buildCoordinationPlanPrompt,
} from './reasoning';
export type {
  ArcReasoningGraphArgs,
  CoordinationPlanContextForPrompt,
  CoordinationPlanArgs,
  CoordPlanNodeGuidance,
} from './reasoning';

// ── Interview Prompts ───────────────────────────────────────────────────────
export {
  INTERVIEW_FRAME_FALLBACK,
  buildInterviewUserPrompt,
} from './interviews';

// ── Search Synthesis Prompts ────────────────────────────────────────────────
export {
  buildSearchSynthesisPrompt,
} from './search';

// ── Image Prompt Builder ────────────────────────────────────────────────────
export {
  COMPOSITION_BY_KIND,
  buildImagePromptUserPrompt,
} from './image';
export type { ImagePromptEntityKind, ImagePromptArgs } from './image';

// ── Survey Prompts ──────────────────────────────────────────────────────────
export {
  buildCharacterPersona,
  buildLocationPersona,
  buildArtifactPersona,
  buildSurveyUserPrompt,
  buildSurveyProposalUserPrompt,
} from './surveys';

// ── Paradigm-aware analyst system prompts ───────────────────────────────────
export {
  buildBranchChatSystem,
  buildSearchSynthesisSystem,
  buildSurveyGenSystem,
  buildInterviewGenSystem,
  buildMarketBriefingSystem,
  buildArcDirectionSystem,
  buildNarrativeDirectionSystem,
  buildExpandWorldSystem,
  buildExpansionSuggestSystem,
  workIdentityFor,
  type WorkIdentity,
} from './paradigm';
