/**
 * Mode prompt module — generates the working-model-of-reality graph
 * the narrative is currently operating under. Distinct from CRG (which
 * delivers per-arc causal reasoning); the Mode captures the work's
 * structural machinery and is consumed downstream by CRG / scene / plan /
 * prose generation as a working-state input.
 */

export {
  buildPhaseGraphSystem,
  buildModePrompt,
} from "./generate";
export type { ModePromptArgs } from "./generate";

export {
  buildModeDataBlock,
  buildModeApplicationBlock,
  buildModeSection,
  buildPriorModeSection,
  modePriorityEntry,
} from "./application";
export type { ModeScope } from "./application";
