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

export type { ImagePromptEntityKind };

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
