/**
 * Reasoning-graph prompt building blocks.
 *
 * Per-mode (abduction / divergent / deduction / induction) and per-force-
 * preference (fate / world / system / chaos / freeform) text blocks composed
 * into the reasoning-graph, expansion-graph, and coordination-plan prompts
 * in src/lib/ai/reasoning-graph.ts. Pure strings + selectors — no LLM calls.
 */

export { reasoningModeBlock } from "./mode-blocks";
export {
  forcePreferenceBlock,
  networkBiasBlock,
  getPlanNodeGuidance,
} from "./preference-blocks";
export {
  buildSequentialPath,
  extractPatternWarningDirectives,
} from "./sequential-path";
export {
  buildArcReasoningGraphPrompt,
  buildArcReasoningGraphSystem,
  buildCoordinationPlanSystem,
} from "./arc-graph";
export type {
  ArcReasoningGraphArgs,
  CoordinationPlanContextForPrompt,
} from "./arc-graph";
export { buildCoordinationPlanPrompt } from "./coordination-plan";
export type { CoordinationPlanArgs, CoordPlanNodeGuidance } from "./coordination-plan";
