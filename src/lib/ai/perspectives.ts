// Scene perspectives — retell a canonical scene through a single lens (the
// public narrator, or a participant entity). Each is a summary in the
// scene-summary register, derived from canon but free to add non-canon,
// lens-specific detail. Generated in parallel from the Content → Perspectives tab.

import type { NarrativeState, Scene } from '@/types/narrative';
import { resolveEntry } from '@/types/narrative';
import { callGenerateStream, resolveReasoningBudget } from './api';
import { buildPerspectiveSystemPrompt, buildPerspectiveUserPrompt } from '@/lib/prompts/scenes/perspective';
import { GENERATE_MODEL } from '@/lib/constants';
import { logInfo } from '@/lib/core/system-logger';

const PUBLIC_KEY = 'public';
const CONTINUITY_SCENES = 6; // recent scenes fed in as the lens's prior history

/** Entity display name for a perspective key (or "Public" for the narrator). */
export function perspectiveLabel(narrative: NarrativeState, key: string): string {
  if (key === PUBLIC_KEY) return 'Public';
  return (
    narrative.characters[key]?.name ??
    narrative.locations[key]?.name ??
    narrative.artifacts?.[key]?.name ??
    key
  );
}

/** The perspectives available for a scene: the public narrator + each distinct
 *  participant (POV + participants) that resolves to a real entity. */
export function availablePerspectiveKeys(narrative: NarrativeState, scene: Scene): string[] {
  const keys = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (!id) return;
    if (narrative.characters[id] || narrative.locations[id] || narrative.artifacts?.[id]) keys.add(id);
  };
  add(scene.povId);
  for (const id of scene.participantIds ?? []) add(id);
  return [PUBLIC_KEY, ...keys];
}

/** Recent scene summaries before `scene`, optionally only those a given entity
 *  participated in — the lens's continuity going in. */
function buildContinuity(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  currentIndex: number,
  entityKey: string | null,
): string {
  const lines: string[] = [];

  // For an entity lens, lead with its stable known facts (its world graph).
  if (entityKey) {
    const entity =
      narrative.characters[entityKey] ?? narrative.locations[entityKey] ?? narrative.artifacts?.[entityKey];
    const facts = Object.values(entity?.world?.nodes ?? {})
      .map((n) => n.content)
      .filter(Boolean);
    if (facts.length) lines.push(`Known to ${perspectiveLabel(narrative, entityKey)}:\n` + facts.map((f) => `· ${f}`).join('\n'));
  }

  const summaries: string[] = [];
  for (let i = currentIndex - 1; i >= 0 && summaries.length < CONTINUITY_SCENES; i--) {
    const e = resolveEntry(narrative, resolvedKeys[i]);
    if (!e || e.kind !== 'scene' || !e.summary) continue;
    if (entityKey && e.povId !== entityKey && !(e.participantIds ?? []).includes(entityKey)) continue;
    summaries.unshift(e.summary);
  }
  if (summaries.length) lines.push('Recent events:\n' + summaries.map((s) => `— ${s}`).join('\n\n'));

  return lines.join('\n\n');
}

/**
 * Generate one scene perspective. `key` is `public` (public narrator) or a
 * participant entity id. Returns the perspective summary text. Caller saves it
 * via SET_SCENE_PERSPECTIVE; the Perspectives view fans these out in parallel.
 */
export async function generateScenePerspective(
  narrative: NarrativeState,
  scene: Scene,
  key: string,
  resolvedKeys: string[],
  currentIndex: number,
  opts: { onReasoning?: (token: string, accumulated: string) => void } = {},
): Promise<string> {
  const isPublic = key === PUBLIC_KEY;
  const label = perspectiveLabel(narrative, key);
  logInfo('Generating scene perspective', {
    source: 'analysis',
    operation: 'generate-perspective',
    details: { narrativeId: narrative.id, sceneId: scene.id, key },
  });

  const arc = scene.arcId ? narrative.arcs[scene.arcId] : undefined;
  const outline = arc ? `${arc.name}${arc.directionVector ? ` — ${arc.directionVector}` : ''}` : '';
  const continuity = buildContinuity(narrative, scene, resolvedKeys, currentIndex, isPublic ? null : key);

  const userPrompt = buildPerspectiveUserPrompt({ label, isPublic, canonSummary: scene.summary, continuity, outline });
  const reasoningBudget = resolveReasoningBudget(narrative);

  let reasoning = '';
  const raw = await callGenerateStream(
    userPrompt,
    buildPerspectiveSystemPrompt(),
    () => {},
    undefined,
    `generateScenePerspective:${key}`,
    GENERATE_MODEL,
    reasoningBudget,
    (token) => {
      reasoning += token;
      opts.onReasoning?.(token, reasoning);
    },
  );
  return raw.trim();
}
