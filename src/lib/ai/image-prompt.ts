/**
 * Suggest a refined imagePrompt for an entity (character, location, artifact)
 * by reading the entity's full world-graph continuity and distilling it into
 * a concise, literal visual description suitable for an image generator.
 */

import type { NarrativeState } from '@/types/narrative';
import { callGenerate, resolveReasoningBudget } from './api';
import { parseJson } from './json';
import { MAX_TOKENS_SMALL } from '@/lib/constants';
import { logError, logInfo } from '@/lib/core/system-logger';
import { buildImagePromptUserPrompt, IMAGE_PROMPT_SYSTEM, type ImagePromptEntityKind } from '@/lib/prompts/image';
import {
  buildMapImagePrompts,
  buildMapScaleClassifierPrompt,
  mapScaleFromRoot,
  MAP_SCALES,
  type MapRegion,
  type MapScale,
} from '@/lib/prompts/image/map';

export type { ImagePromptEntityKind };
export type { MapScale };

/** Pick the id that appears EARLIEST in the classifier reply (the model may add
 *  stray words despite instructions); null if none of the scale ids appear. */
function parseMapScale(raw: string): MapScale | null {
  const lower = raw.toLowerCase();
  let best: { id: MapScale; idx: number } | null = null;
  for (const id of MAP_SCALES) {
    const idx = lower.indexOf(id);
    if (idx >= 0 && (!best || idx < best.idx)) best = { id, idx };
  }
  return best?.id ?? null;
}

/** Intelligently detect which flat map scale best represents a place and its
 *  sub-regions (world / region / settlement / site). A cheap, trackable LLM
 *  pass (temp 0, tiny output, logged in the API trace) reads the structure and
 *  picks the scale; `mapScaleFromRoot` (the root's prominence) is the heuristic
 *  fallback, so a flaky model never blocks generation. Global is the whole
 *  world by definition, so it skips the call. */
export async function classifyMapScale(
  args: { name: string; regions: MapRegion[]; isGlobal: boolean; prominence?: string },
): Promise<MapScale> {
  const heuristic = mapScaleFromRoot({ isGlobal: args.isGlobal, prominence: args.prominence });
  if (args.isGlobal) return heuristic;

  const { system, user } = buildMapScaleClassifierPrompt(args);
  try {
    const raw = await callGenerate(user, system, 16, 'classifyMapScale', undefined, 0, false, 0);
    const picked = parseMapScale(raw);
    logInfo('Classified map scale', {
      source: 'image-generation',
      operation: 'classify-map-scale',
      details: { name: args.name, picked: picked ?? heuristic, fellBack: !picked },
    });
    return picked ?? heuristic;
  } catch (err) {
    logError('classifyMapScale call failed — using heuristic', err, {
      source: 'image-generation',
      operation: 'classify-map-scale',
    });
    return heuristic;
  }
}

/** Craft the image-gen prompt for a flat top-down map through the trackable LLM
 *  path (callGenerate → logged in the API trace), instead of the untracked
 *  in-route fetch that used to run server-side. The `scale` (from
 *  `classifyMapScale`) picks the cartographic style. Returns the prompt the
 *  caller passes to /api/generate-image as `imagePrompt`, so the route skips
 *  its own prompt-crafting and only generates the image. Plain text out
 *  (jsonMode off), no reasoning, warm temperature for varied phrasing. */
export async function craftMapImagePrompt(
  args: { name: string; regions: MapRegion[]; imageStyle?: string; scale: MapScale },
): Promise<string> {
  const { system, user } = buildMapImagePrompts(args);
  logInfo('Crafting map image prompt', {
    source: 'image-generation',
    operation: 'craft-map-prompt',
    details: { name: args.name, scale: args.scale, regionCount: args.regions.length, hasCustomStyle: !!args.imageStyle },
  });
  let raw: string;
  try {
    raw = await callGenerate(user, system, 300, 'craftMapImagePrompt', undefined, 0, false, 0.8);
  } catch (err) {
    logError('craftMapImagePrompt call failed', err, {
      source: 'image-generation',
      operation: 'craft-map-prompt',
    });
    throw err;
  }
  return raw.trim();
}

export async function suggestImagePrompt(
  kind: ImagePromptEntityKind,
  narrative: NarrativeState,
  entityId: string,
): Promise<string> {
  let name: string;
  let descriptor: string;
  let worldNodes: { type: string; content: string }[];
  let existingPrompt: string | undefined;

  if (kind === 'character') {
    const c = narrative.characters[entityId];
    if (!c) throw new Error(`Character not found: ${entityId}`);
    name = c.name;
    descriptor = `role: ${c.role}`;
    worldNodes = Object.values(c.world?.nodes ?? {});
    existingPrompt = c.imagePrompt;
  } else if (kind === 'location') {
    const l = narrative.locations[entityId];
    if (!l) throw new Error(`Location not found: ${entityId}`);
    name = l.name;
    const parent = l.parentId ? narrative.locations[l.parentId]?.name : null;
    descriptor = `prominence: ${l.prominence}${parent ? `, nested inside ${parent}` : ''}`;
    worldNodes = Object.values(l.world?.nodes ?? {});
    existingPrompt = l.imagePrompt;
  } else {
    const a = narrative.artifacts[entityId];
    if (!a) throw new Error(`Artifact not found: ${entityId}`);
    name = a.name;
    descriptor = `significance: ${a.significance}`;
    worldNodes = Object.values(a.world?.nodes ?? {});
    existingPrompt = a.imagePrompt;
  }

  const continuityBlock = worldNodes.length > 0
    ? worldNodes.map((n, i) => `${i + 1}. [${n.type}] ${n.content}`).join('\n')
    : '(no world nodes — work from the name and descriptor alone)';

  const prompt = buildImagePromptUserPrompt({
    kind,
    name,
    descriptor,
    worldSummary: narrative.worldSummary ?? '(no summary)',
    imageStyle: narrative.imageStyle,
    existingPrompt,
    continuityBlock,
  });

  logInfo('Suggesting image prompt', {
    source: 'other',
    operation: 'suggest-image-prompt',
    details: { kind, entityId, name, nodeCount: worldNodes.length },
  });

  let raw: string;
  try {
    raw = await callGenerate(prompt, IMAGE_PROMPT_SYSTEM, MAX_TOKENS_SMALL, 'suggestImagePrompt', undefined, resolveReasoningBudget(narrative));
  } catch (err) {
    logError('suggestImagePrompt call failed', err, {
      source: 'other',
      operation: 'suggest-image-prompt',
    });
    throw err;
  }

  const parsed = parseJson(raw, 'suggestImagePrompt') as { imagePrompt?: unknown };
  const out = typeof parsed.imagePrompt === 'string' ? parsed.imagePrompt.trim() : '';
  if (!out) throw new Error('Model returned an empty imagePrompt');
  return out;
}
