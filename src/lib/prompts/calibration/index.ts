/**
 * Calibration primitives — single source of truth for the numeric scales
 * and reasoning shapes the engine treats as calibrated instruments.
 *
 * Each primitive provides:
 *   • the data (constants, types, helpers)
 *   • a PROMPT block (canonical definition for inclusion in system prompts)
 *   • a REMINDER (compact reference for prompts that don't restate the full def)
 *   • a SCHEMA fragment (JSON snippet for output-format blocks)
 *
 * Prompts COMPOSE these primitives by reference instead of restating them.
 * One edit to a primitive propagates everywhere. The goal is calibration
 * fidelity — every surface that mentions "+3" means the same thing by it.
 */

export {
  INFERENCE_SHAPE_FIELDS,
  INFERENCE_SHAPE_PROMPT,
  INFERENCE_SHAPE_REMINDER,
  INFERENCE_SHAPE_SCHEMA_FRAGMENT,
  type InferenceShape,
  type InferenceShapeField,
} from './inference-shape';

export {
  PRIOR_LOGIT_BANDS,
  PRIOR_LOGIT_MAX,
  PRIOR_LOGIT_MIN,
  PRIOR_LOGIT_PROMPT,
  PRIOR_LOGIT_REMINDER,
  PRIOR_LOGIT_SCHEMA_FRAGMENT,
  clampPriorLogit,
  priorLogitRarityLabel,
} from './prior-logit';

export {
  INTENSITY_LEVELS,
  INTENSITY_PROMPT,
  INTENSITY_REMINDER,
  INTENSITY_SCHEMA_FRAGMENT,
  clampIntensity,
  intensityLabel,
  type IntensityLevel,
} from './intensity';

// Paradigm vocabulary moved to `../paradigm/vocabulary.ts` as part of the
// paradigm-centralisation refactor. Re-exported here for back-compat with
// `import { PARADIGM_VOCABULARY } from '@/lib/prompts/calibration'` callers.
export {
  PARADIGM_VOCABULARY,
  paradigmVocabularyLine,
  type ParadigmVocabulary,
} from '../paradigm/vocabulary';
