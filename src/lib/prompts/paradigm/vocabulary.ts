/**
 * Paradigm vocabulary — what to call the basic engine units in each paradigm.
 *
 * The engine's structural vocabulary (scene, arc, resolution) is paradigm-
 * neutral at the type level — every paradigm builds on the same Scene / Arc
 * / Thread structure. But the NATIVE word for that structure differs:
 *
 *   • fiction       — scene / arc / thread payoff
 *   • essay         — section / movement / argument conclusion
 *   • debate        — move / phase / axis decided
 *   • record        — entry / period / trajectory landmark
 *   • …
 *
 * Single source of truth for the native vocabulary, so the model speaks in
 * the paradigm's own register without the prompt having to teach it the
 * mapping inline.
 */

import type { NarrativeParadigm } from '@/types/narrative';

export type ParadigmVocabulary = {
  /** What the basic per-step unit is called. Maps to `Scene` in the data model. */
  unit: string;
  /** What the grouping above the unit is called. Maps to `Arc` in the data model. */
  collection: string;
  /** What "resolution" means in this paradigm — the event that closes a thread. */
  resolution: string;
};

export const PARADIGM_VOCABULARY: Record<NarrativeParadigm, ParadigmVocabulary> = {
  'fiction':     { unit: 'scene',   collection: 'arc',      resolution: 'thread payoff' },
  'non-fiction': { unit: 'scene',   collection: 'arc',      resolution: 'documented outcome' },
  'simulation':  { unit: 'scene',   collection: 'arc',      resolution: 'rule-driven outcome' },
  'essay':       { unit: 'section', collection: 'movement', resolution: 'argument conclusion' },
  'panel':       { unit: 'session', collection: 'inquiry',  resolution: 'synthesis or stall' },
  'atlas':       { unit: 'entry',   collection: 'section',  resolution: 'classification settled' },
  'debate':      { unit: 'move',    collection: 'phase',    resolution: 'axis decided' },
  'record':      { unit: 'entry',   collection: 'period',   resolution: 'trajectory landmark' },
  'scenario':    { unit: 'move',    collection: 'phase',    resolution: 'stake tipped' },
};

/** Render the vocabulary as a one-line cheatsheet for inclusion in prompts.
 *  Returns empty when paradigm is unset (no specialisation to add). */
export function paradigmVocabularyLine(paradigm: NarrativeParadigm | undefined): string {
  if (!paradigm) return '';
  const v = PARADIGM_VOCABULARY[paradigm];
  return `In this paradigm the engine's "scene" is a ${v.unit}, the "arc" is a ${v.collection}, and resolution means ${v.resolution}.`;
}
