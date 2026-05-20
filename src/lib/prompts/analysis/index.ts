/**
 * Analysis Prompts — corpus → narrative-state extraction pipeline.
 */

export {
  SCENE_STRUCTURE_SYSTEM,
  buildSceneStructurePrompt,
} from './scene-structure';

export {
  ARC_GROUPING_SYSTEM,
  buildArcGroupingPrompt,
  type ArcGroup,
} from './arcs';

export {
  RECONCILE_ENTITIES_SYSTEM,
  buildReconcileEntitiesPrompt,
} from './reconcile-entities';

export {
  RECONCILE_SEMANTIC_SYSTEM,
  buildReconcileSemanticPrompt,
} from './reconcile-semantic';

export {
  COALESCE_OUTCOMES_SYSTEM,
  buildCoalesceOutcomesPrompt,
} from './coalesce-outcomes';

export {
  FATE_REEXTRACT_SYSTEM,
  buildFateReextractPrompt,
  type FateReextractThread,
  type FateReextractPriorDelta,
} from './fate-reextract';

export {
  THREADING_SYSTEM,
  buildThreadingPrompt,
} from './threading';

export {
  META_EXTRACTION_SYSTEM,
  buildMetaExtractionPrompt,
} from './meta';

export {
  DRIVER_SYNTHESIS_SYSTEM,
  buildDriverSynthesisPrompt,
} from './driver-synthesis';

export {
  THREAD_INTEGRATION_SYSTEM,
  buildThreadIntegrationPrompt,
} from './thread-integration';
