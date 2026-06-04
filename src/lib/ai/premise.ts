/**
 * Premise suggestion for the creation wizard.
 * Generates random story ideas to help users get started.
 * The prompt body lives in src/lib/prompts/premise/ — see PREMISE_SUGGEST_PROMPT.
 */

import { callGenerate, resolveWebsearch } from './api';
import { parseJson } from './json';
import { PREMISE_SUGGEST_PROMPT, PREMISE_SUGGEST_SYSTEM } from '@/lib/prompts';
import {
  REFINE_NARRATIVE_META_SYSTEM,
  buildRefineNarrativeMetaPrompt,
  type RefineKind,
} from '@/lib/prompts/premise/refine';
import { logError, logInfo } from '@/lib/core/system-logger';
import type { NarrativeState } from '@/types/narrative';

/**
 * Suggest a random narrative premise with title.
 * Used by the creation wizard to inspire story ideas.
 */
export async function suggestPremise(): Promise<{ title?: string; premise?: string }> {
  logInfo('Suggesting premise', { source: 'ingest', operation: 'suggest-premise' });

  let raw: string;
  try {
    raw = await callGenerate(PREMISE_SUGGEST_PROMPT, PREMISE_SUGGEST_SYSTEM, 500, 'suggestPremise');
  } catch (err) {
    logError('suggestPremise call failed', err, {
      source: 'ingest',
      operation: 'suggest-premise',
    });
    throw err;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'suggestPremise') as any;

  return {
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    premise: typeof parsed.premise === 'string' ? parsed.premise : undefined,
  };
}

/**
 * Refine the title and / or description of an established world view using
 * its accumulated narrative context (outline of arcs + scenes up to the
 * cursor, paradigm metadata, patterns).
 *
 * The caller pre-renders the outline with `outlineContext(...)` so the
 * refinement reads the same ground-truth artefact the rest of the pipeline
 * uses — arc-grouped scene summaries with world commits and an explicit
 * present marker — rather than a hand-rolled subset.
 */
export async function refineNarrativeMeta(args: {
  kind: RefineKind;
  narrative: Pick<
    NarrativeState,
    | 'title' | 'description' | 'paradigm' | 'genre' | 'subgenre'
    | 'worldSummary' | 'patterns' | 'antiPatterns' | 'storySettings'
  > & { id?: string };
  /** Pre-rendered outline up to the cursor — produced by `outlineContext` in
   *  the caller. Authoritative accumulated context. */
  outline?: string;
  guidance?: string;
}): Promise<{ title?: string; description?: string }> {
  const n = args.narrative;
  logInfo('Refining narrative meta', {
    source: 'ingest',
    operation: 'refine-narrative-meta',
    details: { kind: args.kind, narrativeId: n.id },
  });

  const prompt = buildRefineNarrativeMetaPrompt({
    kind: args.kind,
    title: n.title ?? '',
    description: n.description ?? '',
    paradigm: n.paradigm,
    genre: n.genre,
    subgenre: n.subgenre,
    worldSummary: n.worldSummary,
    patterns: n.patterns,
    antiPatterns: n.antiPatterns,
    outline: args.outline,
    guidance: args.guidance,
  });

  const websearch = resolveWebsearch(n as NarrativeState);
  let raw: string;
  try {
    raw = await callGenerate(prompt, REFINE_NARRATIVE_META_SYSTEM, 600, 'refineNarrativeMeta', undefined, undefined, true, undefined, websearch);
  } catch (err) {
    logError('refineNarrativeMeta call failed', err, {
      source: 'ingest',
      operation: 'refine-narrative-meta',
    });
    throw err;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'refineNarrativeMeta') as any;
  return {
    title: typeof parsed?.title === 'string' ? parsed.title.trim() : undefined,
    description: typeof parsed?.description === 'string' ? parsed.description.trim() : undefined,
  };
}
