// Prose generation/rewrite — renders a scene's beat plan into formatted prose; critique-guided rewrites.

import type { NarrativeState, Scene, ProseFormat } from '@/types/narrative';
import { callGenerate, callGenerateStream, resolveReasoningBudget, resolveWebsearch } from './api';
import { WRITING_MODEL, DEFAULT_MODEL, MAX_TOKENS_DEFAULT } from '@/lib/constants';
import { parseJson } from './json';
import { sceneContext, buildProseProfile } from './context';
import { resolveProfile } from '@/lib/pacing/beat-profiles';
import { logInfo } from '@/lib/core/system-logger';
import { FORMAT_INSTRUCTIONS } from '@/lib/prompts';
import {
  buildRewriteSystemPrompt,
  buildRewriteUserPrompt,
  buildRewriteChangelogPrompt,
  REWRITE_CHANGELOG_SYSTEM,
} from '@/lib/prompts/prose/rewrite';

// Re-export from centralised prompt repository so existing importers keep working.
export { FORMAT_INSTRUCTIONS };



/**
 * Rewrite scene prose guided by analysis/critique.
 *
 * Lightweight: no logic context — focused on addressing the analysis feedback.
 * Neighboring prose provides continuity without full narrative context.
 */
export async function rewriteSceneProse(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  currentProse: string,
  analysis: string,
  /** How many past scenes' full prose to include (0 = last paragraph only) */
  contextPast = 0,
  /** How many future scenes' full prose to include (0 = first paragraph only) */
  contextFuture = 0,
  /** Specific scene IDs to include as reference context (for distant chapters) */
  referenceSceneIds?: string[],
  /** Stream prose tokens as they arrive */
  onToken?: (token: string) => void,
): Promise<{ prose: string; changelog: string; proseEmbedding?: number[] }> {
  logInfo('Starting prose rewrite', {
    source: 'prose-generation',
    operation: 'rewrite-prose',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      currentProseLength: currentProse.length,
      analysisLength: analysis.length,
      contextPast,
      contextFuture,
      hasReferenceScenes: !!referenceSceneIds && referenceSceneIds.length > 0,
    },
  });

  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const sceneBlock = sceneContext(narrative, scene, resolvedKeys, contextIndex);

  // Get neighboring prose for continuity
  let prevEnding: string | null = null;
  let nextOpening: string | null = null;
  let neighborContext = '';

  const hasExpandedContext = contextPast > 0 || contextFuture > 0;

  // Past scenes
  if (contextPast > 0) {
    const prevScenes: string[] = [];
    for (let i = 1; i <= contextPast; i++) {
      const pIdx = sceneIdx - i;
      if (pIdx < 0) break;
      const pId = resolvedKeys[pIdx];
      const pScene = pId ? narrative.scenes[pId] : null;
      const latestProse = pScene?.proseVersions?.[pScene.proseVersions.length - 1]?.prose;
      if (latestProse) {
        const pov = pScene.povId ? (narrative.characters[pScene.povId]?.name ?? pScene.povId) : 'narrator';
        const loc = narrative.locations[pScene.locationId]?.name ?? pScene.locationId;
        prevScenes.unshift(`--- SCENE ${pIdx + 1} (POV: ${pov}, @${loc}) ---\n${pScene.summary}\n\n${latestProse}`);
      }
    }
    if (prevScenes.length > 0) {
      neighborContext += `\nPRECEDING SCENES (${prevScenes.length} scene${prevScenes.length > 1 ? 's' : ''} before — read these to understand what has already happened):\n${prevScenes.join('\n\n')}\n`;
    }
  }

  // Future scenes
  if (contextFuture > 0) {
    const nextScenes: string[] = [];
    for (let i = 1; i <= contextFuture; i++) {
      const nIdx = sceneIdx + i;
      if (nIdx >= resolvedKeys.length) break;
      const nId = resolvedKeys[nIdx];
      const nScene = nId ? narrative.scenes[nId] : null;
      const latestProse = nScene?.proseVersions?.[nScene.proseVersions.length - 1]?.prose;
      if (latestProse) {
        const pov = nScene.povId ? (narrative.characters[nScene.povId]?.name ?? nScene.povId) : 'narrator';
        const loc = narrative.locations[nScene.locationId]?.name ?? nScene.locationId;
        nextScenes.push(`--- SCENE ${nIdx + 1} (POV: ${pov}, @${loc}) ---\n${nScene.summary}\n\n${latestProse}`);
      }
    }
    if (nextScenes.length > 0) {
      neighborContext += `\nFOLLOWING SCENES (${nextScenes.length} scene${nextScenes.length > 1 ? 's' : ''} after — read these to understand what must be set up):\n${nextScenes.join('\n\n')}\n`;
    }
  }

  // Default: ±1 paragraph (300 chars) when no expanded context
  if (!hasExpandedContext) {
    const prevId = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
    const nextId = sceneIdx < resolvedKeys.length - 1 ? resolvedKeys[sceneIdx + 1] : null;
    const prevScene = prevId ? narrative.scenes[prevId] : null;
    const nextScene = nextId ? narrative.scenes[nextId] : null;
    const prevProse = prevScene?.proseVersions?.[prevScene.proseVersions.length - 1]?.prose;
    const nextProse = nextScene?.proseVersions?.[nextScene.proseVersions.length - 1]?.prose;
    prevEnding = prevProse ? prevProse.split(/\n\n+/).slice(-1)[0]?.slice(-300) : null;
    nextOpening = nextProse ? nextProse.split(/\n\n+/)[0]?.slice(0, 300) : null;
  }

  // Pinned reference scenes (distant chapters selected by the author)
  if (referenceSceneIds && referenceSceneIds.length > 0) {
    const refBlocks = referenceSceneIds
      .filter((id) => id !== scene.id)
      .map((id) => {
        const refScene = narrative.scenes[id];
        const refProse = refScene?.proseVersions?.[refScene.proseVersions.length - 1]?.prose;
        if (!refProse) return null;
        const idx = resolvedKeys.indexOf(id);
        const pov = refScene.povId ? (narrative.characters[refScene.povId]?.name ?? refScene.povId) : 'narrator';
        const loc = narrative.locations[refScene.locationId]?.name ?? refScene.locationId;
        return `--- SCENE ${idx + 1} [pinned reference] (POV: ${pov}, @${loc}) ---\n${refScene.summary}\n\n${refProse}`;
      })
      .filter(Boolean);
    if (refBlocks.length > 0) {
      neighborContext += `\nPINNED REFERENCE SCENES (selected by the author — these are not adjacent but contain relevant context for this rewrite):\n${refBlocks.join('\n\n')}\n`;
    }
  }

  const hasVoiceOverride = !!narrative.storySettings?.proseVoice?.trim();
  const proseFormat = narrative.storySettings?.proseFormat ?? 'prose';
  const formatInstructions = FORMAT_INSTRUCTIONS[proseFormat];

  // Build prose profile block
  const proseProfile = resolveProfile(narrative);
  const profileSection = proseProfile
    ? `\n\n${buildProseProfile(proseProfile)}`
    : '';

  const systemPrompt = buildRewriteSystemPrompt({
    formatSystemRole: formatInstructions.systemRole,
    formatRules: formatInstructions.formatRules,
    hasVoiceOverride,
    voiceOverride: hasVoiceOverride ? narrative.storySettings!.proseVoice!.trim() : undefined,
    profileSection,
    worldSummary: narrative.worldSummary,
    streaming: !!onToken,
    work: {
      title: narrative.title,
      paradigm: narrative.paradigm,
      genre: narrative.genre,
      subgenre: narrative.subgenre,
    },
  });

  const neighborBlock = neighborContext
    || `${prevEnding ? `<previous-scene-ending>"...${prevEnding}"</previous-scene-ending>\n` : ''}${nextOpening ? `<next-scene-opening>"${nextOpening}..."</next-scene-opening>\n` : ''}`;

  const prompt = buildRewriteUserPrompt({
    sceneBlock,
    neighborBlock,
    currentProse,
    analysis,
    hasExpandedContext,
    streaming: !!onToken,
    formatRules: formatInstructions.formatRules,
    voiceOverride: hasVoiceOverride ? narrative.storySettings!.proseVoice!.trim() : undefined,
    profileSection,
    toneCue: narrative.worldSummary,
  });

  const reasoningBudget = resolveReasoningBudget(narrative);
  const websearch = resolveWebsearch(narrative);
  let prose: string;
  if (onToken) {
    const rawStream = await callGenerateStream(prompt, systemPrompt, onToken, MAX_TOKENS_DEFAULT, 'rewriteSceneProse', WRITING_MODEL, reasoningBudget, undefined, undefined, websearch);
    // LLM may ignore "no JSON" instruction — extract prose if it returned JSON
    prose = rawStream;
  } else {
    const raw = await callGenerate(prompt, systemPrompt, MAX_TOKENS_DEFAULT, 'rewriteSceneProse', WRITING_MODEL, reasoningBudget, true, undefined, websearch);
    const parsed = parseJson(raw, 'rewriteSceneProse') as { prose: string };
    prose = parsed.prose;
  }

  // Generate changelog in a separate cheap call — diffing old vs new
  let changelog = '';
  const changelogRaw = await callGenerate(
    buildRewriteChangelogPrompt({ analysis }),
    REWRITE_CHANGELOG_SYSTEM,
    800,
    'rewriteChangelog',
    DEFAULT_MODEL,
    reasoningBudget,
    true,
    undefined,
    websearch,
  );
  const changelogParsed = parseJson(changelogRaw, 'rewriteChangelog') as { changelog: unknown };
  const rawChangelog = changelogParsed.changelog;
  if (typeof rawChangelog === 'string') {
    changelog = rawChangelog;
  } else if (Array.isArray(rawChangelog)) {
    changelog = rawChangelog.map((item: unknown) => typeof item === 'string' ? `• ${item}` : '').filter(Boolean).join('\n');
  } else {
    changelog = String(rawChangelog ?? '');
  }

  logInfo('Completed prose rewrite', {
    source: 'prose-generation',
    operation: 'rewrite-prose-complete',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      newProseLength: prose.length,
      hasChangelog: changelog.length > 0,
    },
  });

  // ── Generate prose embedding ─────────────────────────────────────────────
  const { generateEmbeddings } = await import('@/lib/search/embeddings');

  let proseEmbedding: number[] | undefined;
  if (prose && prose.length > 0) {
    const embeddings = await generateEmbeddings([prose], narrative.id);
    proseEmbedding = embeddings[0];
  }

  return { prose, changelog, proseEmbedding };
}
