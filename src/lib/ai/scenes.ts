import type { NarrativeState, Scene, Arc, WorldBuild, StorySettings, Beat, BeatPlan, BeatProse, BeatProseMap, Proposition, ThreadLogNodeType, SystemNode, Thread, Artifact, Character, Location as LocationEntity, LocationProminence } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS, BEAT_FN_LIST, BEAT_MECHANISM_LIST, NARRATOR_AGENT_ID } from '@/types/narrative';
import { isThreadAbandoned, isThreadClosed, clampEvidence } from '@/lib/narrative-utils';
import { nextId, nextIds } from '@/lib/narrative-utils';
import { newNarratorBelief } from '@/lib/thread-log';
import { normalizeTimeDelta } from '@/lib/time-deltas';
import { callGenerate, callGenerateStream, resolveReasoningBudget } from './api';
import { GENERATE_SCENES_SYSTEM } from '@/lib/prompts/scenes/generate';
import { WRITING_MODEL, GENERATE_MODEL, GENERATE_MODEL_GRAPH_GUIDED, PLANNING_MODEL, ANALYSIS_MODEL, MAX_TOKENS_LARGE, MAX_TOKENS_DEFAULT, MAX_TOKENS_SMALL, WORDS_PER_BEAT, ANALYSIS_TEMPERATURE } from '@/lib/constants';
import { parseJson } from './json';
import { narrativeContext, sceneContext, buildProseProfile } from './context';
import { PROMPT_STRUCTURAL_RULES, PROMPT_DELTAS, PROMPT_ARTIFACTS, PROMPT_LOCATIONS, PROMPT_POV, PROMPT_WORLD, PROMPT_SUMMARY_REQUIREMENT, promptThreadLifecycle, buildThreadHealthPrompt, buildCompletedBeatsPrompt, PROMPT_FORCE_STANDARDS, PROMPT_ARC_STATE_GUIDANCE, buildScenePlanSystemPrompt, buildBeatAnalystSystemPrompt, buildScenePlanEditSystemPrompt, buildSceneProseSystemPrompt } from './prompts';
import { EXTRACT_PROPOSITIONS_SYSTEM, buildExtractPropositionsUserPrompt } from '@/lib/prompts/scenes/extract-propositions';
import { buildGenerateScenesPrompt } from '@/lib/prompts/scenes/generate';
import { buildArcSettingsBlock } from '@/lib/prompts/scenes/arc-settings';
import { buildPlanFormatBlock } from '@/lib/prompts/scenes/plan-format';
import {
  buildScenePlanUserPrompt,
  buildScenePlanEditUserPrompt,
  buildBeatAnalystUserPrompt,
  buildCompulsoryPropositionsBlock,
} from '@/lib/prompts/scenes/plan-user';
import {
  buildProseInstructionsWithPlan,
  buildProseInstructionsFreeform,
  buildSceneProseUserPrompt,
} from '@/lib/prompts/scenes/prose-instructions';
import { samplePacingSequence, buildSequencePrompt, detectCurrentMode, MATRIX_PRESETS, DEFAULT_TRANSITION_MATRIX, type PacingSequence } from '@/lib/pacing-profile';
import { resolveProfile, resolveSampler, sampleBeatSequence } from '@/lib/beat-profiles';
import { FORMAT_INSTRUCTIONS } from '@/lib/prompts';
import { logWarning, logError, logInfo } from '@/lib/system-logger';
import type { ReasoningGraph, ArcSettings } from './reasoning-graph';
import { buildSequentialPath, extractPatternWarningDirectives } from './reasoning-graph';
import { buildActivePhaseGraphSection } from './phase-graph';
import { retryWithValidation, validateBeatPlan, validateBeatProseMap } from './validation';
import { sanitizeSystemDelta, systemEdgeKey, makeSystemIdAllocator, resolveSystemConceptIds } from '@/lib/system-graph';

/**
 * Split text into sentences, handling edge cases like abbreviations, decimals, and ellipsis.
 * More reliable than simple regex splitting.
 */
function splitIntoSentences(text: string): string[] {
  // Common abbreviations that shouldn't trigger sentence breaks
  const abbreviations = new Set([
    'Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'Sr', 'Jr',
    'Fig', 'Eq', 'Vol', 'No', 'Ch', 'Sec', 'vs',
    'etc', 'i.e', 'e.g', 'al', 'et'
  ]);

  const sentences: string[] = [];
  let currentSentence = '';
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    currentSentence += char;

    // Check for sentence-ending punctuation
    if (char === '.' || char === '!' || char === '?') {
      // Look ahead for additional punctuation or ellipsis
      let j = i + 1;
      while (j < text.length && (text[j] === '.' || text[j] === '!' || text[j] === '?')) {
        currentSentence += text[j];
        j++;
      }

      // Skip closing quotes/parentheses
      while (j < text.length && (text[j] === '"' || text[j] === "'" || text[j] === ')' || text[j] === ']')) {
        currentSentence += text[j];
        j++;
      }

      // Check if this is a sentence boundary
      let isSentenceBoundary = false;

      // If followed by whitespace + capital letter or end of text, likely a boundary
      if (j >= text.length) {
        isSentenceBoundary = true;
      } else if (j < text.length && /\s/.test(text[j])) {
        // Skip whitespace
        let k = j;
        while (k < text.length && /\s/.test(text[k])) {
          k++;
        }
        // Check if next non-whitespace is capital letter or quote + capital
        if (k < text.length) {
          const nextChar = text[k];
          const isCapital = /[A-Z]/.test(nextChar);
          const isQuoteBeforeCapital = (nextChar === '"' || nextChar === "'") && k + 1 < text.length && /[A-Z]/.test(text[k + 1]);

          if (isCapital || isQuoteBeforeCapital) {
            // Check for abbreviations and decimals
            const words = currentSentence.trim().split(/\s+/);
            const lastWord = words[words.length - 1];
            const wordWithoutPunct = lastWord.replace(/[.!?]+$/, '');

            // Check if it's a decimal number like "1.2"
            const isDecimal = /^\d+\.\d*$/.test(lastWord);
            if (isDecimal) {
              // Don't split on decimal numbers
            } else if (abbreviations.has(wordWithoutPunct)) {
              // It's an abbreviation, but check if it's truly the end of a sentence
              // by looking at the next word
              let nextWordStart = k;
              if (nextChar === '"' || nextChar === "'") {
                nextWordStart = k + 1;
              }
              // Extract the next word
              let nextWordEnd = nextWordStart;
              while (nextWordEnd < text.length && /[A-Za-z]/.test(text[nextWordEnd])) {
                nextWordEnd++;
              }
              const nextWord = text.substring(nextWordStart, nextWordEnd);

              // Common sentence starters that indicate a new sentence despite abbreviation
              const sentenceStarters = new Set([
                'The', 'A', 'An', 'He', 'She', 'It', 'They', 'We', 'I', 'You',
                'This', 'That', 'These', 'Those', 'His', 'Her', 'Their', 'My', 'Our',
                'But', 'And', 'Or', 'So', 'Yet', 'For', 'Nor', 'As', 'If', 'When',
                'Where', 'Why', 'How', 'What', 'Who', 'Which'
              ]);

              if (sentenceStarters.has(nextWord)) {
                isSentenceBoundary = true;
              }
            } else {
              // Not an abbreviation or decimal, so it's a sentence boundary
              isSentenceBoundary = true;
            }
          }
        }
      }

      if (isSentenceBoundary) {
        // Add whitespace that follows
        while (j < text.length && /\s/.test(text[j])) {
          currentSentence += text[j];
          j++;
        }
        sentences.push(currentSentence.trim());
        currentSentence = '';
        i = j - 1; // Will be incremented at end of loop
      } else {
        i = j - 1;
      }
    }

    i++;
  }

  // Add any remaining text
  if (currentSentence.trim()) {
    sentences.push(currentSentence.trim());
  }

  return sentences;
}

/** Parse raw proposition data into Proposition objects with free-form type labels */
function parsePropositions(rawProps: unknown[]): Proposition[] {
  return rawProps
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => {
      const prop: Proposition = { content: String(p.content ?? '') };
      const rawType = typeof p.type === 'string' && p.type.trim() ? p.type.trim() : undefined;
      if (rawType) prop.type = rawType;
      return prop;
    })
    .filter((p) => p.content.length > 0);
}

/** Context from an active coordination plan, injected directly into generation. */
export type CoordinationPlanContext = {
  /** Current arc index (1-based) */
  arcIndex: number;
  /** Total arc count in the plan */
  arcCount: number;
  /** Arc label from the plan */
  arcLabel: string;
  /** Scene count for this arc */
  sceneCount: number;
  /** Force mode for this arc (e.g., 'fate', 'world', 'system') */
  forceMode?: string;
  /** Full directive built from the plan's reasoning graph */
  directive: string;
};

export type GenerateScenesOptions = {
  existingArc?: Arc;
  /** Pre-sampled pacing sequence. When omitted, one is auto-sampled from the story's transition matrix. */
  pacingSequence?: PacingSequence;
  worldBuildFocus?: WorldBuild;
  /** Reasoning graph that guides scene generation. When provided, replaces direction with structured reasoning path. */
  reasoningGraph?: ReasoningGraph;
  /** Coordination plan context. When provided, injects plan guidance into generation. */
  coordinationPlanContext?: CoordinationPlanContext;
  /** Engine settings the arc was reasoned under. When omitted, inherited
   *  from `reasoningGraph.arcSettings` so CRG → scene execution stays
   *  synced. Explicit values override the inherited ones. */
  arcSettings?: ArcSettings;
  onToken?: (token: string) => void;
  /** Callback for streaming reasoning/thinking tokens */
  onReasoning?: (token: string) => void;
  /** When true, skip extended reasoning even if story settings enable it */
  disableReasoning?: boolean;
};

export async function generateScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  count: number,
  direction: string,
  options: GenerateScenesOptions = {},
): Promise<{ scenes: Scene[]; arc: Arc }> {
  const { existingArc, pacingSequence, worldBuildFocus, reasoningGraph, coordinationPlanContext, onToken, onReasoning } = options;
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);
  const arcId = existingArc?.id ?? nextId('ARC', Object.keys(narrative.arcs));

  // CRG → scene sync: inherit arc settings from the reasoning graph the
  // CRG was built under, override with anything the caller explicitly passed.
  // Keeps force preference / reasoning mode / network bias aligned across
  // CRG and scene execution without callers needing to re-thread every value.
  const resolvedArcSettings: ArcSettings | undefined = options.arcSettings ?? reasoningGraph?.arcSettings;

  logInfo('Starting scene generation', {
    source: 'manual-generation',
    operation: 'generate-scenes',
    details: {
      narrativeId: narrative.id,
      arcId,
      sceneCount: count,
      existingArc: !!existingArc,
      hasPacingSequence: !!pacingSequence,
      hasWorldBuildFocus: !!worldBuildFocus,
    },
  });
  const storySettings: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
  const targetLen = storySettings.targetArcLength;
  const sceneCountInstruction = count > 0
    ? `exactly ${count} scenes`
    : `${Math.max(2, targetLen - 1)}-${targetLen + 1} scenes (choose the count that best fits the arc's natural length)`;
  const arcInstruction = existingArc
    ? `CONTINUE the existing arc "${existingArc.name}" (${arcId}) which already has ${existingArc.sceneIds.length} scenes. Add ${sceneCountInstruction} that naturally extend this arc.`
    : `Generate a NEW ARC with ${sceneCountInstruction}. Give the arc a short, evocative name (2-4 words) that reads like a chapter title — specific to the story, not generic.`;
  // Unique seed to ensure divergent narrative directions across parallel generations
  const seed = Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);

  // ── Pacing sequence: sample from Markov chain when enabled ──
  const sceneCount = count > 0 ? Math.max(4, count) : targetLen;
  let sequencePrompt = '';
  let sequence: PacingSequence | null = null;
  if (storySettings.usePacingChain !== false) {
    if (pacingSequence) {
      sequence = pacingSequence;
    } else {
      const currentMode = detectCurrentMode(narrative, resolvedKeys);
      const matrix = MATRIX_PRESETS.find((p) => p.key === storySettings.rhythmPreset)?.matrix
        ?? DEFAULT_TRANSITION_MATRIX;
      sequence = samplePacingSequence(currentMode, sceneCount, matrix);
    }
    sequencePrompt = buildSequencePrompt(sequence);
  }

  const briefBlock = (() => {
    if (reasoningGraph) {
      const directives = extractPatternWarningDirectives(reasoningGraph);
      // Carry forward the prose seeds the CRG was generated from — the graph
      // compiles direction + coord-plan directive into a causal spine, but
      // tonal / scope / register intent in the original phrasing isn't fully
      // recoverable from nodes and edges. Layer them under the graph so the
      // graph still drives structure while the source phrasing fills gaps.
      const sourceDirection = direction.trim();
      const planDirective = coordinationPlanContext?.directive?.trim();
      const layered: string[] = [];
      if (planDirective) {
        layered.push(`<plan-directive hint="The coordination-plan directive that seeded this CRG. The graph encodes it structurally; this preserves the original phrasing for nuance the nodes don't carry.">${planDirective}</plan-directive>`);
      }
      if (sourceDirection) {
        layered.push(`<source-direction hint="The prose direction that seeded this CRG (and any user constraints in story-settings still apply). Honour it alongside the graph — the graph dictates structure, the direction shapes what the structure leaves open.">${sourceDirection}</source-direction>`);
      }
      return `<brief type="reasoning-graph" hint="PRIMARY BRIEF — execute this path exactly; don't skip nodes or invent reasoning not shown. REASONING nodes are core logic; CHARACTER/LOCATION/ARTIFACT/SYSTEM nodes provide grounding; OUTCOME nodes are thread effects to deliver. Edge labels carry meaning (enables, requires, causes, etc.).">
  <arc-summary>${reasoningGraph.summary}</arc-summary>
  <reasoning-path>
${buildSequentialPath(reasoningGraph)}
  </reasoning-path>${directives ? `\n  <course-correction-directives>\n${directives}\n  </course-correction-directives>` : ''}${layered.length > 0 ? '\n  ' + layered.join('\n  ') : ''}
</brief>`;
    }
    if (coordinationPlanContext) {
      return `<brief type="coordination-plan" arc-index="${coordinationPlanContext.arcIndex}" arc-count="${coordinationPlanContext.arcCount}" arc-label="${coordinationPlanContext.arcLabel}"${coordinationPlanContext.forceMode ? ` force-mode="${coordinationPlanContext.forceMode}"` : ''} hint="PRIMARY BRIEF — directive derived from backward-induction across the full plan.">
  <directive>${coordinationPlanContext.directive}</directive>${direction.trim() ? `\n  <additional-direction hint="Layer on top of the directive.">${direction}</additional-direction>` : ''}
</brief>`;
    }
    if (direction.trim()) {
      return `<brief type="direction" hint="PRIMARY BRIEF — every scene executes these beats. Prose-level guidance (tone, POV style, pacing, register) must flow into the scene summaries; the summary is the prose writer's only brief.">
${direction}
</brief>`;
    }
    return `<brief type="freeform">Use your judgment — pick the most compelling next development based on unresolved threads, tensions, and momentum.</brief>`;
  })();

  const worldBuildFocusBlock = worldBuildFocus ? (() => {
    const wb = worldBuildFocus;
    const chars = wb.expansionManifest.newCharacters.map((c) => `    <character name="${c.name}" role="${c.role}" />`).join('\n');
    const locs = wb.expansionManifest.newLocations.map((l) => `    <location name="${l.name}" />`).join('\n');
    const threads = wb.expansionManifest.newThreads.map((t) => {
      const live = narrative.threads[t.id];
      const status = live
        ? (isThreadClosed(live) ? 'closed' : isThreadAbandoned(live) ? 'abandoned' : 'open')
        : 'open';
      const outcomes = (live?.outcomes ?? t.outcomes ?? []).join(' | ');
      return `    <thread status="${status}" outcomes="${outcomes}">${t.description}</thread>`;
    }).join('\n');
    return `<world-build-focus id="${wb.id}" hint="The entities below were recently introduced and have not yet had a presence in the story. This arc should bring them in — use these characters in scenes, set at least one scene in these locations, and begin seeding these latent threads.">
  <summary>${wb.summary}</summary>
${chars ? `  <characters>\n${chars}\n  </characters>` : ''}
${locs ? `  <locations>\n${locs}\n  </locations>` : ''}
${threads ? `  <threads-to-activate>\n${threads}\n  </threads-to-activate>` : ''}
</world-build-focus>`;
  })() : '';

  const inputBlocks: string[] = [];
  inputBlocks.push(`  <narrative-context>\n${ctx}\n  </narrative-context>`);
  inputBlocks.push(`  <narrative-seed>${seed}</narrative-seed>`);
  if (arcInstruction) inputBlocks.push(`  <arc-instruction>${arcInstruction}</arc-instruction>`);
  inputBlocks.push(`  ${briefBlock.replace(/\n/g, '\n  ')}`);
  const arcSettingsBlock = buildArcSettingsBlock(resolvedArcSettings);
  if (arcSettingsBlock) inputBlocks.push(`  ${arcSettingsBlock.replace(/\n/g, '\n  ')}`);
  if (worldBuildFocusBlock) inputBlocks.push(`  ${worldBuildFocusBlock.replace(/\n/g, '\n  ')}`);
  inputBlocks.push(`  <continuation-point hint="Scenes continue from this point in the story.">after scene index ${currentIndex + 1}</continuation-point>`);
  if (sequencePrompt) inputBlocks.push(`  <pacing-sequence>\n${sequencePrompt}\n  </pacing-sequence>`);
  const phaseGraphSection = buildActivePhaseGraphSection(narrative, 'scene-structure');
  if (phaseGraphSection) inputBlocks.push(`  ${phaseGraphSection.replace(/\n/g, '\n  ')}`);

  const povRestrictedHint = storySettings.povMode !== 'free' && storySettings.povCharacterIds.length > 0
    ? ` — RESTRICTED: ${storySettings.povCharacterIds.join(', ')}`
    : storySettings.povMode === 'free' && storySettings.povCharacterIds.length > 0
    ? ` — PREFER: ${storySettings.povCharacterIds.join(', ')}`
    : '';

  const sharedRulesBlock = [
    PROMPT_STRUCTURAL_RULES,
    PROMPT_SUMMARY_REQUIREMENT,
    PROMPT_FORCE_STANDARDS,
    PROMPT_DELTAS,
    PROMPT_LOCATIONS,
    Object.keys(narrative.artifacts ?? {}).length > 0 ? PROMPT_ARTIFACTS : '',
    PROMPT_POV,
    PROMPT_WORLD,
    PROMPT_ARC_STATE_GUIDANCE,
    promptThreadLifecycle(),
    buildThreadHealthPrompt(narrative, resolvedKeys, currentIndex),
    buildCompletedBeatsPrompt(narrative, resolvedKeys, currentIndex),
  ].join('\n');

  const prompt = buildGenerateScenesPrompt({
    inputBlocks: inputBlocks.join('\n'),
    arcId,
    povRestrictedHint,
    hasPacingSequence: !!sequencePrompt,
    sharedRulesBlock,
  });

  // Retry on JSON parse failures (truncation, malformed output)
  const MAX_RETRIES = 2;
  let parsed: { arcName?: string; directionVector?: string; worldState?: string; scenes: Scene[] };
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const reasoningBudget = resolveReasoningBudget(narrative);
      const useStream = !!(onToken || onReasoning);
      // CRG present = graph executes the structural reasoning, so the scene
      // pass becomes guided execution. Switch to a fast graph-capable model.
      const sceneModel = reasoningGraph ? GENERATE_MODEL_GRAPH_GUIDED : GENERATE_MODEL;
      const raw = useStream
        ? await callGenerateStream(prompt, GENERATE_SCENES_SYSTEM, onToken ?? (() => {}), MAX_TOKENS_LARGE, 'generateScenes', sceneModel, reasoningBudget, onReasoning)
        : await callGenerate(prompt, GENERATE_SCENES_SYSTEM, MAX_TOKENS_LARGE, 'generateScenes', sceneModel, reasoningBudget);
      parsed = parseJson(raw, 'generateScenes') as { arcName?: string; directionVector?: string; worldState?: string; scenes: Scene[] };
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        logWarning(`Scene generation attempt ${attempt + 1} failed, retrying`, err, {
          source: 'manual-generation',
          operation: 'generate-scenes',
          details: { attempt: attempt + 1, maxRetries: MAX_RETRIES }
        });
      }
    }
  }
  if (!parsed!) throw lastErr;
  const arcName = existingArc?.name ?? parsed.arcName ?? 'Untitled Arc';
  const directionVector = parsed.directionVector;
  const worldState = parsed.worldState;

  const sceneIds = nextIds('S', Object.keys(narrative.scenes), parsed.scenes.length, 3);
  const scenes: Scene[] = parsed.scenes.map((s, i) => ({
    ...s,
    kind: 'scene' as const,
    id: sceneIds[i],
    arcId,
    summary: s.summary || `Scene ${i + 1} of arc "${arcName}"`,
    timeDelta: normalizeTimeDelta(s.timeDelta),
  }));

  sanitizeScenes(scenes, narrative, 'generateScenes');

  // Allocate real IDs for introduced entities (C-GEN-* → C-XX, etc.)
  // Collect all introduced entities across scenes and assign sequential IDs
  const allNewChars = scenes.flatMap((s) => s.newCharacters ?? []);
  const allNewLocs = scenes.flatMap((s) => s.newLocations ?? []);
  const allNewArts = scenes.flatMap((s) => s.newArtifacts ?? []);
  const allNewThreads = scenes.flatMap((s) => s.newThreads ?? []);

  const charIdMap: Record<string, string> = {};
  const locIdMap: Record<string, string> = {};
  const artIdMap: Record<string, string> = {};
  const threadIdMap: Record<string, string> = {};

  if (allNewChars.length > 0) {
    const realCharIds = nextIds('C', Object.keys(narrative.characters), allNewChars.length);
    allNewChars.forEach((c, i) => {
      charIdMap[c.id] = realCharIds[i];
      c.id = realCharIds[i];
    });
  }
  if (allNewLocs.length > 0) {
    const realLocIds = nextIds('L', Object.keys(narrative.locations), allNewLocs.length);
    allNewLocs.forEach((l, i) => {
      locIdMap[l.id] = realLocIds[i];
      l.id = realLocIds[i];
      // Remap parentId if it references another new location
      if (l.parentId && locIdMap[l.parentId]) {
        l.parentId = locIdMap[l.parentId];
      }
    });
  }
  if (allNewArts.length > 0) {
    const realArtIds = nextIds('A', Object.keys(narrative.artifacts ?? {}), allNewArts.length);
    allNewArts.forEach((a, i) => {
      artIdMap[a.id] = realArtIds[i];
      a.id = realArtIds[i];
    });
  }
  if (allNewThreads.length > 0) {
    const realThreadIds = nextIds('T', Object.keys(narrative.threads), allNewThreads.length);
    allNewThreads.forEach((t, i) => {
      threadIdMap[t.id] = realThreadIds[i];
      t.id = realThreadIds[i];
    });
  }

  // Remap references in scenes to use real IDs
  for (const scene of scenes) {
    // Remap participant IDs, POV, location
    scene.participantIds = scene.participantIds.map((id) => charIdMap[id] ?? id);
    if (scene.povId) scene.povId = charIdMap[scene.povId] ?? scene.povId;
    scene.locationId = locIdMap[scene.locationId] ?? scene.locationId;
    // Remap worldDeltas entity IDs
    for (const km of scene.worldDeltas ?? []) {
      km.entityId = charIdMap[km.entityId] ?? locIdMap[km.entityId] ?? artIdMap[km.entityId] ?? km.entityId;
    }
    // Remap threadDeltas thread IDs
    for (const tm of scene.threadDeltas ?? []) {
      tm.threadId = threadIdMap[tm.threadId] ?? tm.threadId;
    }
    // Remap relationshipDeltas character IDs
    for (const rm of scene.relationshipDeltas ?? []) {
      rm.from = charIdMap[rm.from] ?? rm.from;
      rm.to = charIdMap[rm.to] ?? rm.to;
    }
    // Remap artifact usages
    for (const au of scene.artifactUsages ?? []) {
      au.artifactId = artIdMap[au.artifactId] ?? au.artifactId;
      if (au.characterId) au.characterId = charIdMap[au.characterId] ?? au.characterId;
    }
    // Remap ownership deltas
    for (const om of scene.ownershipDeltas ?? []) {
      om.artifactId = artIdMap[om.artifactId] ?? om.artifactId;
      om.fromId = charIdMap[om.fromId] ?? locIdMap[om.fromId] ?? om.fromId;
      om.toId = charIdMap[om.toId] ?? locIdMap[om.toId] ?? om.toId;
    }
    // Remap tie deltas
    for (const td of scene.tieDeltas ?? []) {
      td.locationId = locIdMap[td.locationId] ?? td.locationId;
      td.characterId = charIdMap[td.characterId] ?? td.characterId;
    }
    // Remap character movements
    if (scene.characterMovements) {
      const remapped: typeof scene.characterMovements = {};
      for (const [charId, mv] of Object.entries(scene.characterMovements)) {
        const newCharId = charIdMap[charId] ?? charId;
        remapped[newCharId] = {
          ...mv,
          locationId: locIdMap[mv.locationId] ?? mv.locationId,
        };
      }
      scene.characterMovements = remapped;
    }
    // Remap tiedCharacterIds in new locations
    for (const l of scene.newLocations ?? []) {
      l.tiedCharacterIds = l.tiedCharacterIds.map((id) => charIdMap[id] ?? id);
    }
    // Remap thread participants
    for (const t of scene.newThreads ?? []) {
      t.participants = t.participants.map((p) => ({
        ...p,
        id: charIdMap[p.id] ?? locIdMap[p.id] ?? artIdMap[p.id] ?? p.id,
      }));
    }
  }

  // Fix world node IDs to be unique and sequential
  // Include both existing entities and newly introduced entities' world nodes
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => Object.keys(c.world.nodes)),
    ...Object.values(narrative.locations).flatMap((l) => Object.keys(l.world.nodes)),
    ...Object.values(narrative.artifacts ?? {}).flatMap((a) => Object.keys(a.world.nodes)),
  ];
  // Count world nodes: worldDeltas + new entities' initial world nodes
  const totalNodeDeltas = scenes.reduce((sum, s) => {
    const worldDeltaNodes = s.worldDeltas.reduce((ns, km) => ns + (km.addedNodes?.length ?? 0), 0);
    const newEntityNodes = (s.newCharacters ?? []).reduce((ns, c) => ns + Object.keys(c.world?.nodes ?? {}).length, 0)
      + (s.newLocations ?? []).reduce((ns, l) => ns + Object.keys(l.world?.nodes ?? {}).length, 0)
      + (s.newArtifacts ?? []).reduce((ns, a) => ns + Object.keys(a.world?.nodes ?? {}).length, 0);
    return sum + worldDeltaNodes + newEntityNodes;
  }, 0);
  const kIds = nextIds('K', existingKIds, totalNodeDeltas);
  let kIdx = 0;
  // Remap worldDelta node IDs
  for (const scene of scenes) {
    for (const km of scene.worldDeltas) {
      for (const node of km.addedNodes ?? []) {
        node.id = kIds[kIdx++];
      }
    }
  }
  // Remap new entity world node IDs
  for (const scene of scenes) {
    for (const c of scene.newCharacters ?? []) {
      if (c.world?.nodes) {
        const remappedNodes: typeof c.world.nodes = {};
        for (const [, node] of Object.entries(c.world.nodes)) {
          const newId = kIds[kIdx++];
          remappedNodes[newId] = { ...node, id: newId };
        }
        c.world.nodes = remappedNodes;
      }
    }
    for (const l of scene.newLocations ?? []) {
      if (l.world?.nodes) {
        const remappedNodes: typeof l.world.nodes = {};
        for (const [, node] of Object.entries(l.world.nodes)) {
          const newId = kIds[kIdx++];
          remappedNodes[newId] = { ...node, id: newId };
        }
        l.world.nodes = remappedNodes;
      }
    }
    for (const a of scene.newArtifacts ?? []) {
      if (a.world?.nodes) {
        const remappedNodes: typeof a.world.nodes = {};
        for (const [, node] of Object.entries(a.world.nodes)) {
          const newId = kIds[kIdx++];
          remappedNodes[newId] = { ...node, id: newId };
        }
        a.world.nodes = remappedNodes;
      }
    }
  }

  // Thread log node IDs are now deterministic (`${threadId}:${sceneId}`)
  // derived by applyThreadDelta — no allocation needed. The reducer owns
  // log-node creation; sanitizer only validates the evidence payload.

  // Sanitize and re-ID system knowledge deltas. Concept-based resolution
  // collapses re-mentioned concepts (existing-graph or earlier-in-batch) to
  // their canonical id so that re-asserting "mana-binding" across scenes
  // does not repeatedly count as a new node and inflate System scores.
  const existingSysNodes = narrative.systemGraph?.nodes ?? {};
  // Cumulative node map: starts as the existing graph and grows with each
  // scene's genuinely-new nodes, so the next scene's resolve sees earlier
  // scenes' contributions as already-known.
  const cumulativeSysNodes: Record<string, SystemNode> = { ...existingSysNodes };
  const allocateFreshSysId = makeSystemIdAllocator(Object.keys(cumulativeSysNodes));
  // Cumulative id remap across all scenes — one entry per LLM-emitted placeholder id.
  const wkIdMap: Record<string, string> = {};
  const validSysIds = new Set<string>(Object.keys(cumulativeSysNodes));
  // Seed seen-edges from the narrative's existing graph so we don't re-add
  // edges that already exist upstream.
  const seenSysEdgeKeys = new Set<string>();
  for (const e of narrative.systemGraph?.edges ?? []) seenSysEdgeKeys.add(systemEdgeKey(e));

  for (const scene of scenes) {
    if (!scene.systemDeltas) {
      scene.systemDeltas = { addedNodes: [], addedEdges: [] };
    }
    scene.systemDeltas.addedNodes = scene.systemDeltas.addedNodes ?? [];
    scene.systemDeltas.addedEdges = scene.systemDeltas.addedEdges ?? [];
    // Resolve concepts: existing wins, then within-scene dupes collapse,
    // then genuinely new concepts get fresh SYS-XX ids.
    const resolved = resolveSystemConceptIds(
      scene.systemDeltas.addedNodes,
      cumulativeSysNodes,
      allocateFreshSysId,
    );
    Object.assign(wkIdMap, resolved.idMap);
    scene.systemDeltas.addedNodes = resolved.newNodes;
    for (const n of resolved.newNodes) {
      cumulativeSysNodes[n.id] = n;
      validSysIds.add(n.id);
    }
    // Merge re-mention attributions: nodes that the model emitted as new but
    // collapsed into existing concepts earn an attribution on the existing
    // node. Plus remap any explicit systemAttributions through wkIdMap so
    // GEN-* placeholder ids resolve to the real ids.
    const mappedExplicit = (scene.systemAttributions ?? [])
      .map((id) => wkIdMap[id] ?? id)
      .filter((id) => validSysIds.has(id));
    const attrSet = new Set<string>([
      ...mappedExplicit,
      ...resolved.attributedExistingIds,
    ]);
    scene.systemAttributions = Array.from(attrSet);
    // Remap edge references using the cumulative map (LLM GEN ids, prior-
    // scene real ids, and existing graph ids all pass through correctly).
    scene.systemDeltas.addedEdges = scene.systemDeltas.addedEdges.map((edge) => ({
      from: wkIdMap[edge.from] ?? edge.from,
      to: wkIdMap[edge.to] ?? edge.to,
      relation: edge.relation,
    }));
    // Centralised sanitization: self-loops, orphans, cross-scene dupes, bad fields
    sanitizeSystemDelta(scene.systemDeltas, validSysIds, seenSysEdgeKeys);
  }

  const newSceneIds = scenes.map((s) => s.id);
  const newDevelops = [...new Set(scenes.flatMap((s) => s.threadDeltas.map((tm) => tm.threadId)))];
  const newLocationIds = [...new Set(scenes.map((s) => s.locationId))];
  const newCharacterIds = [...new Set(scenes.flatMap((s) => s.participantIds))];

  const arc: Arc = existingArc
    ? {
        ...existingArc,
        sceneIds: [...existingArc.sceneIds, ...newSceneIds],
        develops: [...new Set([...existingArc.develops, ...newDevelops])],
        locationIds: [...new Set([...existingArc.locationIds, ...newLocationIds])],
        activeCharacterIds: [...new Set([...existingArc.activeCharacterIds, ...newCharacterIds])],
        worldState: worldState ?? existingArc.worldState,
      }
    : {
        id: arcId,
        name: arcName,
        sceneIds: newSceneIds,
        develops: newDevelops,
        locationIds: newLocationIds,
        activeCharacterIds: newCharacterIds,
        initialCharacterLocations: {},
        directionVector,
        worldState,
        // Stamp the active Phase Reasoning Graph (PRG) at arc-creation time
        // so the working-model-of-reality the arc was built under is preserved
        // even after the user later switches or clears the active PRG.
        phaseGraphId: narrative.currentPhaseGraphId,
      };

  if (!existingArc && scenes.length > 0) {
    for (const cid of arc.activeCharacterIds) {
      const firstScene = scenes.find((s) => s.participantIds.includes(cid));
      if (firstScene) {
        arc.initialCharacterLocations[cid] = firstScene.locationId;
      }
    }
  }

  logInfo('Completed scene generation', {
    source: 'manual-generation',
    operation: 'generate-scenes-complete',
    details: {
      narrativeId: narrative.id,
      arcId,
      arcName,
      scenesGenerated: scenes.length,
      threadsAdvanced: newDevelops.length,
      locationsUsed: newLocationIds.length,
      charactersUsed: newCharacterIds.length,
    },
  });

  // ── Generate embeddings for scene summaries ──────────────────────────────
  const { generateEmbeddingsBatch, computeCentroid, resolveEmbedding } = await import('@/lib/embeddings');
  const { assetManager } = await import('@/lib/asset-manager');

  if (scenes.length > 0) {
    // Batch 1: Embed scene summaries
    const sceneSummaries = scenes.map(s => s.summary);
    const summaryEmbeddings = await generateEmbeddingsBatch(sceneSummaries, narrative.id);

    // Store embeddings in AssetManager and use references
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const embeddingId = await assetManager.storeEmbedding(summaryEmbeddings[i], 'text-embedding-3-small');
      scene.summaryEmbedding = embeddingId;

      // If scene has plan (in version array), compute plan centroid from beat centroids
      const latestPlan = scene.planVersions?.[scene.planVersions.length - 1]?.plan;
      if (latestPlan) {
        const resolvedCentroids = (await Promise.all(
          latestPlan.beats.map(b => resolveEmbedding(b.embeddingCentroid))
        )).filter((e): e is number[] => e !== null);
        if (resolvedCentroids.length > 0) {
          scene.planEmbeddingCentroid = await assetManager.storeEmbedding(computeCentroid(resolvedCentroids), 'text-embedding-3-small');
        }
      }
    }
  }

  return { scenes, arc };
}

/**
 * Phase 1 — fact extraction. Reads the scene's own structural data (summary,
 * deltas, new entities, events) and returns the minimum set of compulsory
 * propositions the scene must land. Scene-only context; no narrative history.
 */
async function extractCompulsoryPropositions(
  narrative: NarrativeState,
  scene: Scene,
  onReasoning: ((token: string) => void) | undefined,
  reasoningBudget: number | undefined,
): Promise<Proposition[]> {
  const systemPrompt = EXTRACT_PROPOSITIONS_SYSTEM;
  const userPrompt = buildExtractPropositionsUserPrompt({
    sceneXml: sceneContext(narrative, scene),
  });

  const raw = onReasoning
    ? await callGenerateStream(userPrompt, systemPrompt, () => {}, MAX_TOKENS_SMALL, 'generateScenePlan.extractPropositions', PLANNING_MODEL, reasoningBudget, onReasoning)
    : await callGenerate(userPrompt, systemPrompt, MAX_TOKENS_SMALL, 'generateScenePlan.extractPropositions', PLANNING_MODEL, reasoningBudget);

  const parsed = parseJson(raw, 'generateScenePlan.extractPropositions') as { propositions?: unknown[] };
  return parsePropositions(Array.isArray(parsed.propositions) ? parsed.propositions : []);
}

/**
 * Build a focused grounding block for the planner: each scene participant
 * (POV, other characters, location, artifacts in play) with their visual
 * identity + most-recent continuity nodes grouped by type. The planner
 * uses this as an OPTIONAL glue pool — facts to reach for when they would
 * naturally surface in a beat, on top of the compulsory propositions which
 * remain non-negotiable.
 */
function buildParticipantGroundingBlock(narrative: NarrativeState, scene: Scene): string {
  const NODE_CAP_PER_ENTITY = 10;
  // Stable display order — mirror the character-sheet logic readers carry around:
  // who they are → what they want → what they hide → what's true now → what they
  // can do → what they remember → who they're tied to → where they're vulnerable.
  const TYPE_ORDER = ['trait', 'belief', 'goal', 'secret', 'state', 'capability', 'history', 'relation', 'weakness'];

  type WorldNode = { id: string; type: string; content: string };
  type WorldOwner = { world?: { nodes: Record<string, WorldNode> } };

  const recentNodes = (entity: WorldOwner): WorldNode[] =>
    Object.values(entity.world?.nodes ?? {}).slice(-NODE_CAP_PER_ENTITY);

  const renderContinuity = (entity: WorldOwner, indent: string): string => {
    const nodes = recentNodes(entity);
    if (nodes.length === 0) return '';
    const grouped = new Map<string, string[]>();
    for (const n of nodes) {
      if (!grouped.has(n.type)) grouped.set(n.type, []);
      grouped.get(n.type)!.push(n.content);
    }
    const orderedTypes = [
      ...TYPE_ORDER.filter(t => grouped.has(t)),
      ...[...grouped.keys()].filter(t => !TYPE_ORDER.includes(t)).sort(),
    ];
    const lines = orderedTypes.map(type => {
      const items = grouped.get(type)!.map(c => `${indent}  <fact>${c}</fact>`).join('\n');
      return `${indent}<${type}>\n${items}\n${indent}</${type}>`;
    });
    return `${indent.replace(/  $/, '')}<continuity>\n${lines.join('\n')}\n${indent.replace(/  $/, '')}</continuity>`;
  };

  const renderVisual = (imagePrompt: string | undefined, indent: string): string =>
    imagePrompt ? `${indent}<visual hint="appearance / look — surface when mechanism is environment, action, or first-presence">${imagePrompt.trim()}</visual>` : '';

  const renderEntity = (
    tag: string,
    attrs: string,
    visual: string | undefined,
    entity: WorldOwner,
  ): string => {
    const v = renderVisual(visual, '    ');
    const c = renderContinuity(entity, '    ');
    const inner = [v, c].filter(Boolean).join('\n');
    return `  <${tag} ${attrs}>${inner ? `\n${inner}\n  ` : ''}</${tag}>`;
  };

  const povChar = scene.povId ? narrative.characters[scene.povId] : undefined;
  const otherParticipants = scene.participantIds
    .filter(id => id !== scene.povId)
    .map(id => narrative.characters[id])
    .filter((c): c is Character => !!c);
  const location = narrative.locations[scene.locationId];

  // Artifacts in play: usages this scene + ownership transfers + artifacts owned by the location
  const artifactIds = new Set<string>();
  for (const u of scene.artifactUsages ?? []) artifactIds.add(u.artifactId);
  for (const o of scene.ownershipDeltas ?? []) artifactIds.add(o.artifactId);
  for (const a of Object.values(narrative.artifacts)) {
    if (a.parentId === scene.locationId) artifactIds.add(a.id);
  }
  const artifacts = [...artifactIds]
    .map(id => narrative.artifacts[id])
    .filter((a): a is Artifact => !!a);

  const sections: string[] = [];

  if (povChar) {
    sections.push(renderEntity('pov', `id="${povChar.id}" name="${povChar.name}" role="${povChar.role}"`, povChar.imagePrompt, povChar));
  }
  for (const c of otherParticipants) {
    sections.push(renderEntity('participant', `id="${c.id}" name="${c.name}" role="${c.role}"`, c.imagePrompt, c));
  }
  if (location) {
    sections.push(renderEntity('location', `id="${location.id}" name="${location.name}" prominence="${location.prominence}"`, location.imagePrompt, location));
  }
  for (const a of artifacts) {
    sections.push(renderEntity('artifact', `id="${a.id}" name="${a.name}" significance="${a.significance}"`, a.imagePrompt, a));
  }

  if (sections.length === 0) return '';

  return `
GROUNDING POOL — optional glue facts for THIS scene's cast. Each entity carries:
  • <visual> — appearance / look. Pull when the mechanism is environment, action, or first-presence so the prose stays embodied (a tall figure / a scarred hand / a moss-eaten doorframe — never generic).
  • <continuity> — last ${NODE_CAP_PER_ENTITY} accumulated knowledge nodes, grouped by type (trait, belief, goal, secret, state, capability, history, relation, weakness). These are what the participant already KNOWS / WANTS / HIDES / IS coming into the scene.

USAGE — these are OPTIONAL glue, NOT compulsory. The compulsory-propositions block below is non-negotiable; grounding is what you reach for to enrich beats:
  • Mechanism = thought / dialogue → reach for beliefs, goals, secrets, history.
  • Mechanism = environment / action → reach for visual, location traits, current state.
  • Mechanism = memory / callback → reach for history, relation.
  • Pulling a grounding fact into a beat = adding one bridge proposition (clearly recognisable as a callback, not a fresh commitment).
  • Do NOT dump every grounding fact. Pick the few that this beat would naturally surface; the rest stay implicit. Quality of selection > breadth.
<scene-grounding>
${sections.join('\n')}
</scene-grounding>
`;
}

/**
 * Phase 2 — plan construction. Enrich and order the compulsory propositions
 * into a beat plan using the full narrative context. Emits varied mechanisms
 * so the scene breathes — follows a Markov-sampled beat sequence when the
 * narrative has one, otherwise composes freely.
 */
async function constructBeatPlan(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  compulsoryPropositions: Proposition[],
  guidance: string | undefined,
  onReasoning: ((token: string) => void) | undefined,
  reasoningBudget: number | undefined,
): Promise<BeatPlan> {
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const storySettings: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };

  // Previous scene continuity — final few beats + ending beat type
  const prevSceneKey = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const prevScene = prevSceneKey ? narrative.scenes[prevSceneKey] : null;
  const prevPlan = prevScene?.planVersions?.[prevScene.planVersions.length - 1]?.plan;
  const adjacentBlock = prevPlan
    ? `PREVIOUS SCENE ends with: ${prevPlan.beats.slice(-3).map((b) => `[${b.fn}:${b.mechanism}] ${b.what}`).join(', ')}`
    : '';

  // FIXED BEAT SLOTS — the sampler deterministically assigns the (fn, mechanism)
  // pair for every beat in the plan. The LLM only fills `what` and
  // `propositions` per slot; it does NOT pick fn or mechanism. This is how the
  // story's voice (the mechanism mix) becomes enforceable rather than
  // aspirational — the sampler owns rhythm, the LLM owns content. The fallback
  // path (`useBeatChain=false`) returns no slots and keeps the LLM free.
  //
  // We over-sample a generous number of slots so the LLM has room to pack as
  // many propositions as needed. Slots beyond what the LLM uses are silently
  // dropped; if the LLM needs more than we sampled, we'll extend server-side
  // during post-generation normalization.
  const sampledSlots = (() => {
    if (storySettings.useBeatChain === false) return null;
    const sampler = resolveSampler(narrative);
    if (!sampler) return null;
    const propCount = compulsoryPropositions.length;
    const suggested = Math.max(6, Math.min(Math.ceil(propCount * 1.5), 18));
    return sampleBeatSequence(sampler, suggested, prevPlan?.beats?.at(-1)?.fn);
  })();

  const beatSlotsBlock = (() => {
    if (!sampledSlots || sampledSlots.length === 0) return '';
    const slotXml = sampledSlots
      .map((b, i) => `  <slot index="${i + 1}" fn="${b.fn}" mechanism="${b.mechanism}" />`)
      .join('\n');
    return `<beat-slots hint="The sampler has pre-assigned each beat's fn and mechanism. These are the story's voice and are NOT negotiable. Fill in only \`what\` and \`propositions\` per slot; copy fn/mechanism verbatim. Use slots in order (slot 1 = beat 1, ...). Stop early if content fits fewer beats; trailing slots are discarded. If a mechanism seems to clash with the scene (e.g. dialogue in a solitary POV), render it creatively within that mechanism (interior monologue spoken aloud, muttered side-remark, conversation with an absent party) rather than substituting — the mix is the voice, and every substitution drifts it. Structural exceptions are a last resort.">
${slotXml}
</beat-slots>`;
  })();

  const compulsoryBlock = buildCompulsoryPropositionsBlock({ propositions: compulsoryPropositions });

  const planGuidanceBlock = (() => {
    const parts = [narrative.storySettings?.planGuidance?.trim(), guidance?.trim()].filter(Boolean);
    return parts.length > 0 ? `\n\n<plan-guidance>\n${parts.map(p => `  <directive>${p}</directive>`).join('\n')}\n</plan-guidance>` : '';
  })();
  const systemPrompt = buildScenePlanSystemPrompt() + planGuidanceBlock;

  const groundingBlock = buildParticipantGroundingBlock(narrative, scene);
  const completedBeatsBlock = buildCompletedBeatsPrompt(narrative, resolvedKeys, contextIndex);
  const proseProfileBlock = buildProseProfile(resolveProfile(narrative));

  const inputBlocks: string[] = [];
  inputBlocks.push(`  <prose-profile hint="The story's authorial voice — mechanism mix, register, devices. Beats inherit voice from this profile, not from prompt instructions.">
${proseProfileBlock}
  </prose-profile>`);
  const planFormat = narrative.storySettings?.proseFormat ?? 'prose';
  const planFormatBlock = buildPlanFormatBlock(planFormat);
  if (planFormatBlock) inputBlocks.push(`  ${planFormatBlock.replace(/\n/g, '\n  ')}`);
  if (beatSlotsBlock) inputBlocks.push(`  ${beatSlotsBlock.replace(/\n/g, '\n  ')}`);
  const planPhaseGraphSection = buildActivePhaseGraphSection(narrative, 'scene-plan');
  if (planPhaseGraphSection) inputBlocks.push(`  ${planPhaseGraphSection.replace(/\n/g, '\n  ')}`);
  if (completedBeatsBlock) inputBlocks.push(`  <completed-beats>\n${completedBeatsBlock}\n  </completed-beats>`);
  if (adjacentBlock) inputBlocks.push(`  <previous-scene-tail>${adjacentBlock}</previous-scene-tail>`);
  inputBlocks.push(`  <scene-summary>${scene.summary}</scene-summary>`);
  if (groundingBlock) inputBlocks.push(`  ${groundingBlock.replace(/\n/g, '\n  ')}`);
  if (compulsoryBlock) inputBlocks.push(`  ${compulsoryBlock.replace(/\n/g, '\n  ')}`);

  const prompt = buildScenePlanUserPrompt({ inputBlocks: inputBlocks.join('\n') });

  const raw = onReasoning
    ? await callGenerateStream(prompt, systemPrompt, () => {}, MAX_TOKENS_SMALL, 'generateScenePlan', PLANNING_MODEL, reasoningBudget, onReasoning)
    : await callGenerate(prompt, systemPrompt, MAX_TOKENS_SMALL, 'generateScenePlan', PLANNING_MODEL, reasoningBudget);

  const parsed = parseJson(raw, 'generateScenePlan') as { beats?: unknown[] };
  const rawBeats = parsed.beats ?? [];

  // If deterministic slots are active, the sampler OWNS fn + mechanism. Extend
  // the sample if the LLM returned more beats than we pre-sampled so every
  // emitted beat still has a sampler-assigned slot. The LLM is only allowed to
  // author `what` + `propositions`; anything it wrote for `fn` / `mechanism`
  // is discarded in favour of the slot. This is the enforcement step that
  // makes the story's voice (mechanism distribution) actually deterministic.
  let slots = sampledSlots;
  if (slots && rawBeats.length > slots.length) {
    const sampler = resolveSampler(narrative);
    const extra = sampleBeatSequence(
      sampler,
      rawBeats.length - slots.length,
      slots[slots.length - 1]?.fn ?? prevPlan?.beats?.at(-1)?.fn,
    );
    slots = [...slots, ...extra];
  }

  const beats = rawBeats.map((b: unknown, i: number) => {
    const beat = b as Record<string, unknown>;
    const rawProps = Array.isArray(beat.propositions) ? beat.propositions : [];
    const slot = slots?.[i];
    const fn = slot
      ? slot.fn
      : ((BEAT_FN_LIST as readonly string[]).includes(String(beat.fn)) ? beat.fn : 'advance') as BeatPlan['beats'][0]['fn'];
    const mechanism = slot
      ? slot.mechanism
      : ((BEAT_MECHANISM_LIST as readonly string[]).includes(String(beat.mechanism)) ? beat.mechanism : 'action') as BeatPlan['beats'][0]['mechanism'];
    return {
      fn: fn as BeatPlan['beats'][0]['fn'],
      mechanism: mechanism as BeatPlan['beats'][0]['mechanism'],
      what: String(beat.what ?? ''),
      propositions: parsePropositions(rawProps),
      embeddingCentroid: undefined as string | undefined,
    };
  });
  return { beats };
}

export async function generateScenePlan(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  onReasoning?: (token: string) => void,
  onMeta?: (meta: { compulsoryCount: number }) => void,
  /** Per-scene direction that supplements storySettings.planGuidance */
  guidance?: string,
  /** Skip embedding generation — used by plan candidates where only the winner gets embedded */
  skipEmbeddings?: boolean,
): Promise<BeatPlan> {
  logInfo('Starting beat plan generation', {
    source: 'plan-generation',
    operation: 'generate-plan',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      sceneSummary: scene.summary.substring(0, 60),
      hasGuidance: !!guidance,
    },
  });

  const reasoningBudget = resolveReasoningBudget(narrative);

  // ── Phase 1 — extract compulsory propositions from scene structure ──
  const compulsoryPropositions = await extractCompulsoryPropositions(narrative, scene, onReasoning, reasoningBudget);
  onMeta?.({ compulsoryCount: compulsoryPropositions.length });
  logInfo('Compulsory propositions extracted', {
    source: 'plan-generation',
    operation: 'extract-propositions',
    details: { sceneId: scene.id, count: compulsoryPropositions.length },
  });

  // ── Phase 2 — enrich and order into a full beat plan ────────────────
  const result = await constructBeatPlan(
    narrative, scene, resolvedKeys, compulsoryPropositions, guidance, onReasoning, reasoningBudget,
  );

  // ── Generate embeddings for all propositions (skipped for candidates) ────
  if (skipEmbeddings) return result;

  const { embedPropositions, computeCentroid, resolveEmbedding } = await import('@/lib/embeddings');
  const { assetManager } = await import('@/lib/asset-manager');

  // Collect all propositions from beats
  const allPropositions: Array<{ content: string; type?: string }> = [];
  result.beats.forEach(beat => {
    allPropositions.push(...beat.propositions);
  });

  // Embed all propositions in batch
  if (allPropositions.length > 0) {
    const embeddedProps = await embedPropositions(allPropositions, narrative.id);

    // Map embeddings back to plan
    let embeddedIndex = 0;
    for (const beat of result.beats) {
      for (let i = 0; i < beat.propositions.length; i++) {
        beat.propositions[i] = embeddedProps[embeddedIndex++];
      }

      // Compute beat centroid from proposition embeddings and store as asset
      const beatEmbeddings = (await Promise.all(
        beat.propositions.map(p => resolveEmbedding(p.embedding))
      )).filter((e): e is number[] => e !== null);
      if (beatEmbeddings.length > 0) {
        const centroid = computeCentroid(beatEmbeddings);
        beat.embeddingCentroid = await assetManager.storeEmbedding(centroid, 'text-embedding-3-small');
      }
    }
  }

  logInfo('Completed beat plan generation', {
    source: 'plan-generation',
    operation: 'generate-plan-complete',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      beatsGenerated: result.beats.length,
      totalPropositions: result.beats.reduce((sum, b) => sum + b.propositions.length, 0),
    },
  });

  return result;
}

/**
 * Edit an existing beat plan to address specific issues from plan evaluation.
 * Unlike generateScenePlan, this receives the current plan + issues and returns
 * a surgically modified plan — only the beats with problems are changed.
 *
 * Lightweight: no full narrative context, no logic context — focused on fixing specific issues.
 */
export async function editScenePlan(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  issues: string[],
  /** Resolved plan for versioned scenes (required - pass from resolvePlanForBranch) */
  currentPlan?: BeatPlan,
): Promise<BeatPlan> {
  const plan = currentPlan;
  if (!plan) throw new Error('Scene has no plan to edit - pass resolved plan from resolvePlanForBranch');

  logInfo('Starting scene plan edit', {
    source: 'plan-generation',
    operation: 'edit-plan',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      issuesCount: issues.length,
      currentBeats: plan.beats.length,
    },
  });

  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const fullContext = narrativeContext(narrative, resolvedKeys, contextIndex);

  const currentPlanJson = JSON.stringify({
    beats: plan.beats.map((b, i) => ({ idx: i + 1, fn: b.fn, mechanism: b.mechanism, what: b.what, propositions: b.propositions })),
  }, null, 2);

  const issueXml = issues.map((iss, i) => `    <issue index="${i + 1}">${iss}</issue>`).join('\n');

  const prompt = buildScenePlanEditUserPrompt({
    fullContext,
    sceneSummary: scene.summary,
    currentPlanJson,
    issueXml,
    beatFnList: BEAT_FN_LIST.join('|'),
    beatMechanismList: BEAT_MECHANISM_LIST.join('|'),
  });

  const reasoningBudget = resolveReasoningBudget(narrative);
  const raw = await callGenerate(prompt, buildScenePlanEditSystemPrompt(narrative.title), MAX_TOKENS_SMALL, 'editScenePlan', PLANNING_MODEL, reasoningBudget);

  const parsed = parseJson(raw, 'editScenePlan') as { beats?: unknown[]; propositions?: unknown[] };
  const beats = (parsed.beats ?? []).map((b: unknown) => {
    const beat = b as Record<string, unknown>;
    const rawProps = Array.isArray(beat.propositions) ? beat.propositions : [];
    return {
      fn: ((BEAT_FN_LIST as readonly string[]).includes(String(beat.fn)) ? beat.fn : 'advance') as BeatPlan['beats'][0]['fn'],
      mechanism: ((BEAT_MECHANISM_LIST as readonly string[]).includes(String(beat.mechanism)) ? beat.mechanism : 'action') as BeatPlan['beats'][0]['mechanism'],
      what: String(beat.what ?? ''),
      propositions: parsePropositions(rawProps),
    };
  });

  logInfo('Completed scene plan edit', {
    source: 'plan-generation',
    operation: 'edit-plan-complete',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      beatsReturned: beats.length,
    },
  });

  return { beats };
}

/**
 * Reverse-engineer a beat plan from existing prose.
 * Used for analysis — extracts structural beats with propositions.
 * Focused on exhaustive proposition extraction; paragraph mapping is done separately.
 *
 * Returns the plan with beats and propositions.
 */
/**
 * Split prose into evenly-sized chunks by sentence/paragraph boundaries.
 * Ensures consistent granularity for beat extraction.
 */
/**
 * Split prose into ~100-word chunks on sentence boundaries.
 * Chunks are allowed to exceed 100 words to avoid breaking mid-sentence.
 */
export function splitIntoWordChunks(prose: string, targetWords: number = WORDS_PER_BEAT): string[] {
  const sentences = splitIntoSentences(prose).filter(s => s.trim());
  if (sentences.length === 0) return [prose];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).length;
    current.push(sentence);
    currentWords += sentenceWords;

    // Break after reaching target — allows the sentence that crosses the boundary to finish
    if (currentWords >= targetWords) {
      chunks.push(current.join(' ').trim());
      current = [];
      currentWords = 0;
    }
  }

  // Flush remaining sentences
  if (current.length > 0) {
    const remainder = current.join(' ').trim();
    // If remainder is very short, merge into the last chunk
    if (chunks.length > 0 && currentWords < targetWords * 0.3) {
      chunks[chunks.length - 1] += ' ' + remainder;
    } else {
      chunks.push(remainder);
    }
  }

  return chunks.length > 0 ? chunks : [prose];
}

export async function reverseEngineerScenePlan(
  narrative: NarrativeState | null,
  prose: string,
  summary: string,
  onToken?: (token: string, accumulated: string) => void,
): Promise<{ plan: BeatPlan; beatProseMap: BeatProseMap | null }> {
  // Wrap with retry logic and validation
  return retryWithValidation(
    async () => {
      const result = await reverseEngineerScenePlanOnce(narrative, prose, summary, onToken);

      // Validate beat plan structure
      const planValidation = validateBeatPlan({ beats: result.plan.beats });
      if (!planValidation.valid) {
        throw new Error(`Beat plan validation failed:\n${planValidation.errors.join('\n')}`);
      }

      // Validate prose map — required for side-by-side view
      if (result.beatProseMap) {
        const mapValidation = validateBeatProseMap(result.beatProseMap, result.plan, prose);
        if (!mapValidation.valid) {
          throw new Error(`Beat prose map validation failed:\n${mapValidation.errors.join('\n')}`);
        }
      } else {
        throw new Error('No beat prose map generated - side-by-side view requires valid mapping');
      }

      return result;
    },
    () => ({ valid: true, errors: [] }), // Validation already done inside
    'reverseEngineerScenePlan',
    3,
    'analysis' // source context for logging
  );
}

/**
 * Single attempt at extracting a beat plan from prose (internal, for retry logic)
 */
async function reverseEngineerScenePlanOnce(
  narrative: NarrativeState | null,
  prose: string,
  summary: string,
  onToken?: (token: string, accumulated: string) => void,
): Promise<{ plan: BeatPlan; beatProseMap: BeatProseMap | null }> {
  // Strip decorative content before splitting
  const cleanedProse = prose
    .split(/\n\s*\n/)
    .filter((p: string) => p.replace(/[\s*·•–—\-=_#~.]/g, '').trim().length > 0)
    .join('\n\n');

  // Deterministic ~100-word chunks — one chunk = one beat
  const chunks = splitIntoWordChunks(cleanedProse);
  const chunksJson = JSON.stringify(chunks.map((c: string, i: number) => ({ index: i, text: c })));

  const systemPrompt = buildBeatAnalystSystemPrompt(chunks.length);

  const prompt = buildBeatAnalystUserPrompt({
    summary,
    chunkCount: chunks.length,
    chunksJson,
  });

  let accumulated = '';
  const reasoningBudget = resolveReasoningBudget(narrative);
  const raw = onToken
    ? await callGenerateStream(prompt, systemPrompt, (token) => { accumulated += token; onToken(token, accumulated); }, MAX_TOKENS_SMALL, 'reverseEngineerScenePlan', ANALYSIS_MODEL, reasoningBudget, undefined, ANALYSIS_TEMPERATURE)
    : await callGenerate(prompt, systemPrompt, MAX_TOKENS_SMALL, 'reverseEngineerScenePlan', ANALYSIS_MODEL, reasoningBudget, true, ANALYSIS_TEMPERATURE);

  type BeatData = { fn: string; mechanism: string; what: string; propositions: unknown[] };
  const parsed = parseJson(raw, 'reverseEngineerScenePlan') as { beats?: unknown[] };

  const beats: Beat[] = (parsed.beats ?? []).map((b: unknown) => {
    const beatData = b as BeatData;
    const rawProps = Array.isArray(beatData.propositions) ? beatData.propositions : [];
    return {
      fn: ((BEAT_FN_LIST as readonly string[]).includes(String(beatData.fn)) ? beatData.fn : 'advance') as Beat['fn'],
      mechanism: ((BEAT_MECHANISM_LIST as readonly string[]).includes(String(beatData.mechanism)) ? beatData.mechanism : 'action') as Beat['mechanism'],
      what: String(beatData.what ?? ''),
      propositions: parsePropositions(rawProps),
    };
  });

  // LLM must return exactly one beat per chunk — mismatch is a retry-worthy failure
  if (beats.length !== chunks.length) {
    throw new Error(`Beat count mismatch: got ${beats.length} beats for ${chunks.length} chunks`);
  }

  const plan: BeatPlan = { beats };

  // Prose map is deterministic — chunk i = beat i
  const beatProseMap: BeatProseMap = {
    chunks: chunks.map((prose, i) => ({ beatIndex: i, prose })),
    createdAt: Date.now(),
  };

  return { plan, beatProseMap };
}

/**
 * Build BeatProseMap from chunk counts. Deterministic — no gaps or overlaps possible.
 * The only validation: counts must sum to total paragraphs and each count must be >= 1.
 */
export function buildBeatProseMapFromCounts(
  paragraphs: string[],
  beats: Beat[],
  chunkCounts: number[],
  startIndices?: (number | undefined)[],
): BeatProseMap | null {
  if (paragraphs.length === 0 || beats.length === 0 || chunkCounts.length !== beats.length) return null;

  // Fix simple off-by-one/two errors by adjusting the last beat; anything else regenerates
  const total = chunkCounts.reduce((a, b) => a + b, 0);
  if (total !== paragraphs.length) {
    const diff = paragraphs.length - total;
    const lastIdx = chunkCounts.length - 1;
    if (Math.abs(diff) <= 2 && chunkCounts[lastIdx] + diff >= 1) {
      chunkCounts[lastIdx] += diff;
    } else {
      logWarning('Beat chunk counts do not sum to paragraph count',
        `Sum ${total} ≠ ${paragraphs.length} paragraphs`,
        { source: 'analysis', operation: 'beat-prose-mapping', details: { total, expected: paragraphs.length, counts: chunkCounts.join(',') } }
      );
      return null;
    }
  }

  const chunks: BeatProse[] = [];
  let cursor = 0;

  for (let i = 0; i < chunkCounts.length; i++) {
    const count = chunkCounts[i];
    if (count < 1) {
      logWarning('Beat has zero or negative chunk count',
        `Beat ${i} has chunks=${count}`,
        { source: 'analysis', operation: 'beat-prose-mapping', details: { beatIndex: i, count } }
      );
      return null;
    }

    // startIndex is the source of truth — must match computed cursor exactly
    const expectedStart = startIndices?.[i];
    if (typeof expectedStart === 'number' && expectedStart !== cursor) {
      logWarning('Beat startIndex does not match expected position',
        `Beat ${i}: startIndex=${expectedStart} but expected ${cursor}`,
        { source: 'analysis', operation: 'beat-prose-mapping', details: { beatIndex: i, startIndex: expectedStart, cursor, count } }
      );
      return null;
    }

    const prose = paragraphs.slice(cursor, cursor + count).join('\n\n').trim();
    if (!prose) {
      logWarning('Beat prose is empty', `Beat ${i} spans paragraphs ${cursor}–${cursor + count - 1} but produced empty text`,
        { source: 'analysis', operation: 'beat-prose-mapping', details: { beatIndex: i, cursor, count } }
      );
      return null;
    }

    chunks.push({ beatIndex: i, prose });
    cursor += count;
  }

  return { chunks, createdAt: Date.now() };
}

/**
 * Rewrite a scene plan guided by user-provided analysis/critique.
 * Preserves the plan structure but revises content based on the feedback.
 *
 * Lightweight: no full narrative context, no logic context — focused on feedback.
 */
export async function rewriteScenePlan(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  currentPlan: BeatPlan,
  analysis: string,
  onReasoning?: (token: string) => void,
): Promise<BeatPlan> {
  logInfo('Starting scene plan rewrite', {
    source: 'plan-generation',
    operation: 'rewrite-plan',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      currentBeats: currentPlan.beats.length,
      analysisLength: analysis.length,
    },
  });

  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const fullContext = narrativeContext(narrative, resolvedKeys, contextIndex);

  const currentPlanText = currentPlan.beats.map((b, i) =>
    `${i + 1}. [${b.fn}:${b.mechanism}] ${b.what}\n   Propositions: ${b.propositions.map(p => `"${p.content}"`).join('; ')}`
  ).join('\n');


  const systemPrompt = buildScenePlanEditSystemPrompt(narrative.title);

  const sceneDesc = `Scene at branch head: ${scene.summary}`;

  const prompt = `NARRATIVE CONTEXT:\n${fullContext}

SCENE AT BRANCH HEAD:
${sceneDesc}

CURRENT PLAN:
${currentPlanText}

TARGETED FEEDBACK:
${analysis}

Make TARGETED REVISIONS based on the feedback above. This is a surgical edit, not a regeneration.

CRITICAL — PRESERVE STRUCTURE:
1. Return ALL ${currentPlan.beats.length} beats — do not add or remove unless feedback explicitly requests it
2. For beats NOT mentioned in feedback: copy them EXACTLY (same fn, mechanism, what, propositions)
3. For beats mentioned in feedback: apply the specific changes requested
4. Maintain the scene's narrative arc and flow

WHEN MODIFYING A BEAT:
- The 'what' field must be a STRUCTURAL SUMMARY, not prose (no quotes, no literary language)
- Update propositions to match the new content (2-4 per beat, with types: state, event, rule, discovery, etc.)
- Keep fn and mechanism unless the feedback specifically asks for a change

Scene-level "propositions" should capture the overall takeaways from the scene.`;

  const reasoningBudget = resolveReasoningBudget(narrative);
  const raw = onReasoning
    ? await callGenerateStream(prompt, systemPrompt, () => {}, MAX_TOKENS_SMALL, 'rewriteScenePlan', PLANNING_MODEL, reasoningBudget, onReasoning)
    : await callGenerate(prompt, systemPrompt, MAX_TOKENS_SMALL, 'rewriteScenePlan', PLANNING_MODEL, reasoningBudget);
  const parsed = parseJson(raw, 'rewriteScenePlan') as { beats?: unknown[]; propositions?: unknown[] };

  const beats = (parsed.beats ?? []).map((b: unknown) => {
    const beat = b as Record<string, unknown>;
    const rawProps = Array.isArray(beat.propositions) ? beat.propositions : [];
    return {
      fn: ((BEAT_FN_LIST as readonly string[]).includes(String(beat.fn)) ? beat.fn : 'advance') as BeatPlan['beats'][0]['fn'],
      mechanism: ((BEAT_MECHANISM_LIST as readonly string[]).includes(String(beat.mechanism)) ? beat.mechanism : 'action') as BeatPlan['beats'][0]['mechanism'],
      what: String(beat.what ?? ''),
      propositions: parsePropositions(rawProps),
    };
  });

  logInfo('Completed scene plan rewrite', {
    source: 'plan-generation',
    operation: 'rewrite-plan-complete',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      beatsReturned: beats.length > 0 ? beats.length : currentPlan.beats.length,
      usedFallback: beats.length === 0,
    },
  });

  return {
    beats: beats.length > 0 ? beats : currentPlan.beats,
  };
}

/**
 * Parse beat-aligned prose from LLM output with [BEAT_END:N] markers.
 * Returns clean prose + beatProseMap (prose strings) if markers are valid, otherwise prose only.
 *
 * @returns { prose, beatProseMap?, markersFailed } - markersFailed indicates if beat markers were missing/invalid
 */
function parseBeatProseMap(
  rawProse: string,
  beatCount: number,
): { prose: string; beatProseMap?: BeatProseMap; markersFailed?: boolean } {
  // If no markers, return prose as-is with failure flag
  if (!rawProse.includes('[BEAT_END:')) {
    logWarning('Beat markers not found in generated prose', 'LLM did not include BEAT_END markers', {
      source: 'prose-generation',
      operation: 'parse-beat-markers'
    });
    return { prose: rawProse, markersFailed: true };
  }

  // First pass: extract raw prose text per beat
  const beatTexts: { beatIndex: number; text: string }[] = [];
  const lines = rawProse.split('\n');
  let currentBeatIndex = 0;
  let currentProse: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*\[BEAT_END:(\d+)\]\s*$/);
    if (match) {
      const beatIndex = parseInt(match[1], 10);
      if (!isNaN(beatIndex) && beatIndex === currentBeatIndex) {
        const proseText = currentProse.join('\n').trim();
        // Always add beat, even if empty (to maintain beat count)
        beatTexts.push({ beatIndex, text: proseText });
        currentProse = [];
        currentBeatIndex++;
      } else {
        logWarning('Beat markers out of order', `Expected beat ${currentBeatIndex}, got ${beatIndex}`, {
          source: 'prose-generation',
          operation: 'parse-beat-markers',
          details: { expected: currentBeatIndex, got: beatIndex }
        });
        return { prose: rawProse.replace(/\[BEAT_END:\d+\]\n?/g, '').trim(), markersFailed: true };
      }
    } else {
      currentProse.push(line);
    }
  }

  // Handle final beat: only add if there's prose after the last marker OR we're missing beats
  const finalProse = currentProse.join('\n').trim();
  const needsFinalBeat = finalProse.length > 0 || currentBeatIndex < beatCount;

  if (needsFinalBeat) {
    beatTexts.push({ beatIndex: currentBeatIndex, text: finalProse });
  }

  // Reconstruct clean prose (no markers)
  const prose = beatTexts.map((b) => b.text).join('\n\n');

  // Validate we got expected number of beats with sequential indices
  if (beatTexts.length !== beatCount || !beatTexts.every((b, i) => b.beatIndex === i)) {
    logWarning('Beat count mismatch in generated prose', `Expected ${beatCount} beats, got ${beatTexts.length}`, {
      source: 'prose-generation',
      operation: 'parse-beat-markers',
      details: {
        expected: beatCount,
        actual: beatTexts.length,
        finalProseLength: finalProse.length,
        lastBeatIndex: currentBeatIndex - 1,
      }
    });
    return { prose: rawProse.replace(/\[BEAT_END:\d+\]\n?/g, '').trim(), markersFailed: true };
  }

  // Success: create beat-to-prose mapping with prose strings
  const chunks: BeatProse[] = beatTexts.map((bt) => ({
    beatIndex: bt.beatIndex,
    prose: bt.text,
  }));

  logInfo(`Successfully parsed ${chunks.length} beat chunks from prose`, {
    source: 'prose-generation',
    operation: 'parse-beat-markers',
    details: { beatCount: chunks.length }
  });

  return {
    prose,
    beatProseMap: {
      chunks,
      createdAt: Date.now(),
    },
    markersFailed: false,
  };
}

export async function generateSceneProse(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  onToken?: (token: string) => void,
  /** Per-scene prose direction appended to the system prompt */
  guidance?: string,
  /** Resolved plan to use (overrides scene.plan for versioned scenes) */
  plan?: BeatPlan,
): Promise<{ prose: string; beatProseMap?: BeatProseMap; proseEmbedding?: number[] }> {
  // Use provided plan (required for prose generation)
  const activePlan = plan ?? scene.planVersions?.[scene.planVersions.length - 1]?.plan;

  logInfo('Starting prose generation', {
    source: 'prose-generation',
    operation: 'generate-prose',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      sceneSummary: scene.summary.substring(0, 60),
      hasPlan: !!activePlan,
      hasGuidance: !!guidance,
    },
  });

  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;

  // Previous scene prose ending for transition continuity
  const prevSceneKey = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const prevScene = prevSceneKey ? narrative.scenes[prevSceneKey] : null;
  const prevProse = prevScene?.proseVersions?.[prevScene.proseVersions.length - 1]?.prose;
  const prevProseEnding = prevProse
    ? prevProse.split('\n').filter((l) => l.trim()).slice(-3).join('\n')
    : '';

  // Use resolveProfile to respect beatProfilePreset selection (same as generateScenePlan)
  const proseProfile = resolveProfile(narrative);

  // Build prose profile block
  const profileSection = proseProfile
    ? `\n\n${buildProseProfile(proseProfile)}`
    : '';

  const hasVoiceOverride = !!narrative.storySettings?.proseVoice?.trim();
  const proseFormat = narrative.storySettings?.proseFormat ?? 'prose';
  const formatInstructions = FORMAT_INSTRUCTIONS[proseFormat];

  // System prompt is minimal — style constraints moved to user prompt for stronger compliance
  const systemPrompt = buildSceneProseSystemPrompt({
    formatInstructions,
    narrativeTitle: narrative.title,
    worldSummary: narrative.worldSummary,
    proseVoiceOverride: hasVoiceOverride ? narrative.storySettings!.proseVoice! : undefined,
    direction: guidance,
  });

  const sceneBlock = sceneContext(narrative, scene, resolvedKeys, contextIndex);

  // Scene plan — when available, this is the primary creative direction
  const planBlock = activePlan
    ? `<beat-plan hint="Follow this sequence — each beat maps to a passage of prose. The mechanism defines delivery MODE; the propositions are STORY WORLD FACTS to transmit through craft, never copied verbatim or stated flatly.">
${activePlan.beats.map((b, i) =>
  `  <beat index="${i + 1}" fn="${b.fn}" mechanism="${b.mechanism}">
    <what>${b.what}</what>
    <propositions>
${b.propositions.map(p => `      <proposition>${p.content}</proposition>`).join('\n')}
    </propositions>
  </beat>`,
).join('\n')}
</beat-plan>

<proposition-craft hint="Propositions are facts the reader must come to believe. Transmit through demonstration, implication, sensory detail, action, atmosphere — never verbatim, never flat declarations.">
  <example proposition="Mist covers the village at dawn">
    <method type="direct-sensory">He couldn't see past ten paces. Dampness clung to his skin.</method>
    <method type="through-action">Houses materialized from whiteness as he walked.</method>
    <method type="environmental">The mountain disappeared into grey nothing above the rooftops.</method>
  </example>
  <example proposition="Snape views other people as tools">
    <method type="thought">His gaze swept over the crowd. Resources. Obstacles. Nothing between.</method>
    <method type="action">He stepped around the old woman without breaking stride.</method>
    <method type="dialogue">"They'll serve. Or they won't." He didn't look back.</method>
  </example>
  <rule name="profile-aware-figures">If a proposition contains figurative language and the prose profile forbids figures of speech, REWRITE the proposition as literal fact then transmit that. "Smoke dances like spirits" becomes "Smoke rises in twisted columns" if metaphor is forbidden.</rule>
</proposition-craft>`
    : '';

  // Previous prose edge for transition continuity
  const adjacentProseBlock = prevProseEnding
    ? `<previous-scene-ending hint="Match tone; avoid repeating imagery or phrasing.">\n"""${prevProseEnding}"""\n</previous-scene-ending>`
    : '';

  const instruction = activePlan
    ? buildProseInstructionsWithPlan({ wordsPerBeat: WORDS_PER_BEAT })
    : buildProseInstructionsFreeform({ wordsPerBeat: WORDS_PER_BEAT });

  const inputBlocks: string[] = [];
  if (profileSection.trim()) inputBlocks.push(`  <prose-profile hint="The story's authorial voice. Always law — rules in <instructions> apply only when this is silent on a given dimension.">${profileSection}\n  </prose-profile>`);
  const proseProsePhaseGraphSection = buildActivePhaseGraphSection(narrative, 'scene-prose');
  if (proseProsePhaseGraphSection) inputBlocks.push(`  ${proseProsePhaseGraphSection.replace(/\n/g, '\n  ')}`);
  if (adjacentProseBlock) inputBlocks.push(`  ${adjacentProseBlock.replace(/\n/g, '\n  ')}`);
  if (planBlock) inputBlocks.push(`  ${planBlock.replace(/\n/g, '\n  ')}`);
  inputBlocks.push(`  <scene>${sceneBlock}\n  </scene>`);

  const prompt = buildSceneProseUserPrompt({
    inputBlocks: inputBlocks.join('\n'),
    instruction,
    formatRules: formatInstructions.formatRules,
    toneCue: narrative.worldSummary,
    proseVoiceOverride: hasVoiceOverride ? narrative.storySettings!.proseVoice! : undefined,
    direction: guidance,
  });

  const reasoningBudget = resolveReasoningBudget(narrative);

  // Helper: Generate raw prose from LLM
  const generateRaw = async (): Promise<string> => {
    if (onToken) {
      return callGenerateStream(prompt, systemPrompt, onToken, MAX_TOKENS_DEFAULT, 'generateSceneProse', WRITING_MODEL, reasoningBudget);
    }
    return callGenerate(prompt, systemPrompt, MAX_TOKENS_DEFAULT, 'generateSceneProse', WRITING_MODEL, reasoningBudget, false);
  };

  // Generation with retry on marker failure (max 2 attempts)
  const MAX_ATTEMPTS = 2;
  let result: { prose: string; beatProseMap?: BeatProseMap; markersFailed?: boolean } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const rawProse = await generateRaw();

    // Parse beat boundaries if scene has a plan
    result = activePlan
      ? parseBeatProseMap(rawProse, activePlan.beats.length)
      : { prose: rawProse };

    // Success: markers valid or no plan to check
    if (!result.markersFailed || !activePlan) {
      break;
    }

    // Failure: markers invalid
    if (attempt < MAX_ATTEMPTS) {
      logWarning(`Beat markers failed on attempt ${attempt}/${MAX_ATTEMPTS}, retrying`, 'Prose generation returned invalid beat markers', {
        source: 'prose-generation',
        operation: 'generate-prose-with-beats',
        details: { attempt, maxAttempts: MAX_ATTEMPTS }
      });
    } else {
      logError(`Beat markers failed after ${MAX_ATTEMPTS} attempts`, 'Returning prose without beat mapping', {
        source: 'prose-generation',
        operation: 'generate-prose-with-beats',
        details: { maxAttempts: MAX_ATTEMPTS }
      });
    }
  }

  // Invariant: result must exist after loop
  if (!result) {
    throw new Error('[generateSceneProse] Internal error: no result after generation loop');
  }

  logInfo('Completed prose generation', {
    source: 'prose-generation',
    operation: 'generate-prose-complete',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      proseLength: result.prose.length,
      hasBeatMap: !!result.beatProseMap,
      beatChunks: result.beatProseMap?.chunks.length ?? 0,
      markersFailed: result.markersFailed ?? false,
    },
  });

  // ── Generate prose embedding ─────────────────────────────────────────────
  const { generateEmbeddings } = await import('@/lib/embeddings');

  let proseEmbedding: number[] | undefined;
  if (result.prose && result.prose.length > 0) {
    const embeddings = await generateEmbeddings([result.prose], narrative.id);
    proseEmbedding = embeddings[0];
  }

  return { ...result, proseEmbedding };
}

// ── Shared Helpers ───────────────────────────────────────────────────────────

/** Sanitize hallucinated IDs in generated scenes — filter out invalid references instead of crashing. */
export function sanitizeScenes(scenes: Scene[], narrative: NarrativeState, label: string): void {
  const validCharIds = new Set(Object.keys(narrative.characters));
  const validLocIds = new Set(Object.keys(narrative.locations));
  const validThreadIds = new Set(Object.keys(narrative.threads));
  // Pre-compute the union of SYS node ids across the whole batch so that a
  // scene-2 edge referencing a scene-1 SYS-GEN-* id is not treated as orphaned.
  // The later concept-resolution pass in generateScenes remaps those GEN ids
  // to real SYS-XX ids using a cumulative map.
  const batchSysNodeIds = new Set<string>(Object.keys(narrative.systemGraph?.nodes ?? {}));
  for (const s of scenes) {
    for (const n of s.systemDeltas?.addedNodes ?? []) {
      if (n?.id) batchSysNodeIds.add(n.id);
    }
  }
  const validArtifactIds = new Set(Object.keys(narrative.artifacts ?? {}));
  const allEntityIds = new Set([...validCharIds, ...validLocIds, ...validArtifactIds]);
  const stripped: string[] = [];

  // ── First pass: register introduced entities across every scene ──
  // Must happen BEFORE reference validation so that participantIds /
  // povId / worldDeltas / etc. referencing a freshly-introduced entity
  // don't get stripped as "invalid".
  for (const scene of scenes) {
    if (Array.isArray(scene.newCharacters)) {
      const seenInScene = new Set<string>();
      scene.newCharacters = scene.newCharacters.filter((c) => {
        if (!c.id || !c.name || !c.role) {
          stripped.push(`newCharacter missing required fields in scene ${scene.id}`);
          return false;
        }
        if (validCharIds.has(c.id)) {
          stripped.push(`newCharacter "${c.id}" collides with existing character in scene ${scene.id}`);
          return false;
        }
        if (seenInScene.has(c.id)) {
          stripped.push(`newCharacter "${c.id}" duplicated within scene ${scene.id} — second occurrence dropped`);
          return false;
        }
        seenInScene.add(c.id);
        return true;
      }).map((c) => {
        const validRoles: Character['role'][] = ['anchor', 'recurring', 'transient'];
        const role: Character['role'] = validRoles.includes(c.role)
          ? c.role
          : 'transient';
        if (role !== c.role) {
          stripped.push(`newCharacter "${c.id}" role coerced to "transient" in scene ${scene.id}`);
        }
        const world = c.world ?? { nodes: {}, edges: [] };
        if (Object.keys(world.nodes).length === 0) {
          stripped.push(`newCharacter "${c.id}" introduced with empty world in scene ${scene.id}`);
        }
        const cleaned: Character = {
          id: c.id,
          name: c.name,
          role,
          threadIds: c.threadIds ?? [],
          world,
          ...(c.imagePrompt ? { imagePrompt: c.imagePrompt } : {}),
          ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
        };
        return cleaned;
      });
      for (const c of scene.newCharacters) {
        validCharIds.add(c.id);
        allEntityIds.add(c.id);
      }
      if (scene.newCharacters.length === 0) delete scene.newCharacters;
    }
    if (Array.isArray(scene.newLocations)) {
      const seenInScene = new Set<string>();
      scene.newLocations = scene.newLocations.filter((l) => {
        if (!l.id || !l.name) {
          stripped.push(`newLocation missing required fields in scene ${scene.id}`);
          return false;
        }
        if (validLocIds.has(l.id)) {
          stripped.push(`newLocation "${l.id}" collides with existing location in scene ${scene.id}`);
          return false;
        }
        if (seenInScene.has(l.id)) {
          stripped.push(`newLocation "${l.id}" duplicated within scene ${scene.id} — second occurrence dropped`);
          return false;
        }
        seenInScene.add(l.id);
        if (l.parentId && !validLocIds.has(l.parentId)) {
          stripped.push(`newLocation "${l.id}" has invalid parentId "${l.parentId}" in scene ${scene.id}`);
          l.parentId = null;
        }
        return true;
      }).map((l) => {
        const legacy = l as LocationEntity & { prominence?: string };
        const validProminences: LocationProminence[] = ['domain', 'place', 'margin'];
        const prominence: LocationProminence = validProminences.includes(legacy.prominence as LocationProminence)
          ? (legacy.prominence as LocationProminence)
          : 'place';
        if (prominence !== legacy.prominence) {
          stripped.push(`newLocation "${l.id}" prominence coerced to "place" in scene ${scene.id}`);
        }
        const world = l.world ?? { nodes: {}, edges: [] };
        if (Object.keys(world.nodes).length === 0) {
          stripped.push(`newLocation "${l.id}" introduced with empty world in scene ${scene.id}`);
        }
        const cleaned: LocationEntity = {
          id: l.id,
          name: l.name,
          prominence,
          parentId: l.parentId ?? null,
          tiedCharacterIds: l.tiedCharacterIds ?? [],
          threadIds: l.threadIds ?? [],
          world,
          ...(l.imagePrompt ? { imagePrompt: l.imagePrompt } : {}),
          ...(l.imageUrl ? { imageUrl: l.imageUrl } : {}),
        };
        return cleaned;
      });
      for (const l of scene.newLocations!) {
        validLocIds.add(l.id);
        allEntityIds.add(l.id);
      }
      if (scene.newLocations!.length === 0) delete scene.newLocations;
    }
    if (Array.isArray(scene.newArtifacts)) {
      const seenInScene = new Set<string>();
      scene.newArtifacts = scene.newArtifacts.filter((a) => {
        if (!a.id || !a.name) {
          stripped.push(`newArtifact missing required fields in scene ${scene.id}`);
          return false;
        }
        if (validArtifactIds.has(a.id)) {
          stripped.push(`newArtifact "${a.id}" collides with existing artifact in scene ${scene.id}`);
          return false;
        }
        if (seenInScene.has(a.id)) {
          stripped.push(`newArtifact "${a.id}" duplicated within scene ${scene.id} — second occurrence dropped`);
          return false;
        }
        seenInScene.add(a.id);
        return true;
      }).map((a) => {
        const validSignificances: Artifact['significance'][] = ['key', 'notable', 'minor'];
        const significance: Artifact['significance'] = validSignificances.includes(a.significance)
          ? a.significance
          : 'minor';
        if (significance !== a.significance) {
          stripped.push(`newArtifact "${a.id}" significance coerced to "minor" in scene ${scene.id}`);
        }
        const world = a.world ?? { nodes: {}, edges: [] };
        if (Object.keys(world.nodes).length === 0) {
          stripped.push(`newArtifact "${a.id}" introduced with empty world in scene ${scene.id}`);
        }
        const cleaned: Artifact = {
          id: a.id,
          name: a.name,
          significance,
          parentId: a.parentId ?? null,
          threadIds: a.threadIds ?? [],
          world,
          ...(a.imagePrompt ? { imagePrompt: a.imagePrompt } : {}),
          ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}),
        };
        return cleaned;
      });
      for (const a of scene.newArtifacts) {
        validArtifactIds.add(a.id);
        allEntityIds.add(a.id);
      }
      if (scene.newArtifacts.length === 0) delete scene.newArtifacts;
    }
    if (Array.isArray(scene.newThreads)) {
      const seenInScene = new Set<string>();
      scene.newThreads = scene.newThreads.filter((t) => {
        if (!t.id || !t.description) {
          stripped.push(`newThread missing required fields in scene ${scene.id}`);
          return false;
        }
        if (validThreadIds.has(t.id)) {
          stripped.push(`newThread "${t.id}" collides with existing thread in scene ${scene.id}`);
          return false;
        }
        if (seenInScene.has(t.id)) {
          stripped.push(`newThread "${t.id}" duplicated within scene ${scene.id} — second occurrence dropped`);
          return false;
        }
        seenInScene.add(t.id);
        return true;
      }).map((t) => {
        // ThreadParticipant only has {id, type}. Canonicalise to drop any
        // extra fields the LLM emits (e.g. a phantom `role` left over from
        // prior schema drafts) and filter against the right entity set per
        // anchor type so dangling ids never reach the narrative.
        const validParticipants = (t.participants ?? []).flatMap((p) => {
          const ok =
            (p.type === 'character' && validCharIds.has(p.id)) ||
            (p.type === 'location' && validLocIds.has(p.id)) ||
            (p.type === 'artifact' && validArtifactIds.has(p.id));
          if (!ok) {
            stripped.push(`newThread "${t.id}" participant ${p.type} "${p.id}" in scene ${scene.id}`);
            return [];
          }
          return [{ id: p.id, type: p.type }];
        });
        // ThreadLog normalisation — the LLM sometimes returns the wrong
        // shape (edges as object, nodes as array). Replace the malformed
        // side with canonical empty; log so the drop isn't silent.
        const rawNodes = t.threadLog?.nodes;
        const nodesValid = rawNodes && typeof rawNodes === 'object' && !Array.isArray(rawNodes);
        const rawEdges = t.threadLog?.edges;
        const edgesValid = Array.isArray(rawEdges);
        if (rawNodes !== undefined && !nodesValid) {
          stripped.push(`newThread "${t.id}" threadLog.nodes malformed in scene ${scene.id} — replaced with {}`);
        }
        if (rawEdges !== undefined && !edgesValid) {
          stripped.push(`newThread "${t.id}" threadLog.edges malformed in scene ${scene.id} — replaced with []`);
        }
        // Outcomes default to binary yes/no if missing — the absolute
        // minimum valid market. LLM-supplied multi-outcome arrays pass
        // through after dedup + trim.
        const rawOutcomes = Array.isArray(t.outcomes)
          ? Array.from(new Set(t.outcomes.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean)))
          : [];
        const outcomes = rawOutcomes.length >= 2 ? rawOutcomes : ['yes', 'no'];
        if (rawOutcomes.length < 2) {
          stripped.push(`newThread "${t.id}" outcomes invalid in scene ${scene.id} — defaulted to ["yes", "no"]`);
        }
        const rawPriorProbs = Array.isArray(
          (t as { priorProbs?: unknown }).priorProbs,
        )
          ? ((t as { priorProbs?: unknown }).priorProbs as unknown[]).map((v) =>
              typeof v === 'number' ? v : NaN,
            )
          : undefined;
        const seedBelief = newNarratorBelief(outcomes.length, 2, rawPriorProbs);
        return {
          id: t.id,
          description: t.description,
          outcomes,
          beliefs: {
            [NARRATOR_AGENT_ID]: { ...seedBelief, lastTouchedScene: scene.id },
          },
          participants: validParticipants,
          openedAt: t.openedAt ?? scene.id,
          dependents: t.dependents ?? [],
          threadLog: {
            nodes: nodesValid ? (rawNodes as Thread['threadLog']['nodes']) : {},
            edges: edgesValid ? (rawEdges as Thread['threadLog']['edges']) : [],
          },
        } satisfies Thread;
      });
      for (const t of scene.newThreads) {
        validThreadIds.add(t.id);
      }
      if (scene.newThreads.length === 0) delete scene.newThreads;
    }
  }

  // ── Between passes: validate cross-entity refs on newly-introduced
  // entities. All entity + thread IDs are registered in the valid sets by
  // now, so threadIds / tiedCharacterIds / parentId / internal world.edges
  // can be checked against the combined (existing + batch-introduced) set.
  const pruneWorldEdges = (
    world: { nodes: Record<string, unknown>; edges: { from: string; to: string }[] },
    label: string,
    sceneId: string,
  ) => {
    const before = world.edges.length;
    const nodeIds = new Set(Object.keys(world.nodes));
    world.edges = world.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
    if (world.edges.length < before) {
      stripped.push(`${label} world edges (${before - world.edges.length}) reference missing nodes in scene ${sceneId}`);
    }
  };
  for (const scene of scenes) {
    for (const c of scene.newCharacters ?? []) {
      c.threadIds = c.threadIds.filter((tid) => {
        if (validThreadIds.has(tid)) return true;
        stripped.push(`newCharacter "${c.id}" threadId "${tid}" in scene ${scene.id}`);
        return false;
      });
      pruneWorldEdges(c.world, `newCharacter "${c.id}"`, scene.id);
    }
    for (const l of scene.newLocations ?? []) {
      l.threadIds = l.threadIds.filter((tid) => {
        if (validThreadIds.has(tid)) return true;
        stripped.push(`newLocation "${l.id}" threadId "${tid}" in scene ${scene.id}`);
        return false;
      });
      l.tiedCharacterIds = l.tiedCharacterIds.filter((cid) => {
        if (validCharIds.has(cid)) return true;
        stripped.push(`newLocation "${l.id}" tiedCharacterId "${cid}" in scene ${scene.id}`);
        return false;
      });
      pruneWorldEdges(l.world, `newLocation "${l.id}"`, scene.id);
    }
    for (const a of scene.newArtifacts ?? []) {
      a.threadIds = a.threadIds.filter((tid) => {
        if (validThreadIds.has(tid)) return true;
        stripped.push(`newArtifact "${a.id}" threadId "${tid}" in scene ${scene.id}`);
        return false;
      });
      // Artifact parent is a character, a location, or null (world-owned).
      // Anything else is a hallucination — clear to null rather than keeping
      // a dangling reference that breaks ownership chains downstream.
      if (a.parentId != null && !validCharIds.has(a.parentId) && !validLocIds.has(a.parentId)) {
        stripped.push(`newArtifact "${a.id}" parentId "${a.parentId}" in scene ${scene.id}`);
        a.parentId = null;
      }
      pruneWorldEdges(a.world, `newArtifact "${a.id}"`, scene.id);
    }
    for (const t of scene.newThreads ?? []) {
      // Dependents reference OTHER threads. Validated here (not in first
      // pass) because cross-scene newThreads need to be registered first.
      t.dependents = t.dependents.filter((tid) => {
        if (tid === t.id) {
          stripped.push(`newThread "${t.id}" dependent self-loop in scene ${scene.id}`);
          return false;
        }
        if (validThreadIds.has(tid)) return true;
        stripped.push(`newThread "${t.id}" dependent "${tid}" in scene ${scene.id}`);
        return false;
      });
      // threadLog nodes — drop entries missing required fields.
      const nodeIds = new Set(Object.keys(t.threadLog.nodes));
      for (const [nodeId, node] of Object.entries(t.threadLog.nodes)) {
        if (!node || typeof node.content !== 'string' || !node.content.trim() || typeof node.type !== 'string') {
          stripped.push(`newThread "${t.id}" threadLog node "${nodeId}" missing fields in scene ${scene.id}`);
          delete t.threadLog.nodes[nodeId];
          nodeIds.delete(nodeId);
        }
      }
      // threadLog edges must reference threadLog nodes on the same thread.
      const beforeEdges = t.threadLog.edges.length;
      t.threadLog.edges = t.threadLog.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
      if (t.threadLog.edges.length < beforeEdges) {
        stripped.push(`newThread "${t.id}" threadLog edges (${beforeEdges - t.threadLog.edges.length}) reference missing log nodes in scene ${scene.id}`);
      }
    }
  }

  for (const scene of scenes) {
    if (!scene.locationId || !validLocIds.has(scene.locationId)) {
      stripped.push(`locationId "${scene.locationId}" in scene ${scene.id}`);
      scene.locationId = Object.keys(narrative.locations)[0];
    }
    if (!Array.isArray(scene.participantIds)) scene.participantIds = [];
    if (!Array.isArray(scene.events)) scene.events = [];
    // povId is OPTIONAL — null means no viewpoint entity (omniscient
    // simulation, impersonal analytical writing, polyphonic source). Strip
    // an invalid id but never fabricate one.
    if (scene.povId != null && !validCharIds.has(scene.povId)) {
      stripped.push(`povId "${scene.povId}" in scene ${scene.id} (invalid, cleared)`);
      scene.povId = null;
    }
    const validParticipants = scene.participantIds.filter((pid) => {
      if (validCharIds.has(pid)) return true;
      stripped.push(`participantId "${pid}" in scene ${scene.id}`);
      return false;
    });
    // A character introduced in this scene is, by definition, participating
    // in it — otherwise the LLM wouldn't have grounds to introduce them. If
    // the LLM omitted them from participantIds, splice them in rather than
    // leaving the scene with a dangling newCharacter that never appears.
    for (const c of scene.newCharacters ?? []) {
      if (!validParticipants.includes(c.id)) {
        validParticipants.push(c.id);
        stripped.push(`newCharacter "${c.id}" auto-added to participantIds in scene ${scene.id}`);
      }
    }
    scene.participantIds = validParticipants;
    if (scene.povId != null && !scene.participantIds.includes(scene.povId)) {
      scene.povId = scene.participantIds[0] ?? null;
    }
    if (!Array.isArray(scene.threadDeltas)) scene.threadDeltas = [];
    if (!Array.isArray(scene.worldDeltas)) scene.worldDeltas = [];
    if (!Array.isArray(scene.relationshipDeltas)) scene.relationshipDeltas = [];
    // Market-delta validation: threadId must exist in the narrative (or be a
    // newThread introduced earlier in this batch), outcomes in each update
    // must match the thread's outcome list, and evidence must be integer in
    // [MIN, MAX]. Invalid outcomes / updates get stripped; empty deltas drop.
    scene.threadDeltas = scene.threadDeltas.filter((tm) => {
      if (validThreadIds.has(tm.threadId)) return true;
      stripped.push(`threadId "${tm.threadId}" in scene ${scene.id}`);
      return false;
    });
    const validLogTypes = new Set<ThreadLogNodeType>([
      'pulse', 'transition', 'setup', 'escalation', 'payoff', 'twist', 'callback', 'resistance', 'stall',
    ]);
    scene.threadDeltas = scene.threadDeltas.filter((tm) => {
      // Resolve thread shape — either pre-existing or freshly introduced in this batch.
      const existing = narrative.threads[tm.threadId];
      const introduced = scenes
        .flatMap((s) => s.newThreads ?? [])
        .find((nt) => nt.id === tm.threadId);
      const threadOutcomes: string[] = existing?.outcomes ?? introduced?.outcomes ?? ['yes', 'no'];
      const allowed = new Set(threadOutcomes);

      // logType default + validation.
      if (!tm.logType || !validLogTypes.has(tm.logType as ThreadLogNodeType)) {
        stripped.push(`threadDelta "${tm.threadId}" invalid logType="${tm.logType}" in scene ${scene.id} — defaulted to "pulse"`);
        tm.logType = 'pulse';
      }

      // Outcome expansion — validate addOutcomes BEFORE update sanitization so
      // updates referencing newly-added outcomes pass the 'allowed' check.
      // Closed threads reject expansion; duplicates filtered.
      const isClosed = !!existing?.closedAt;
      const rawAdd = Array.isArray(tm.addOutcomes) ? tm.addOutcomes : [];
      const extended: string[] = [];
      if (rawAdd.length > 0) {
        if (isClosed) {
          stripped.push(`threadDelta "${tm.threadId}" addOutcomes rejected — thread is closed, in scene ${scene.id}`);
        } else {
          const seen = new Set(threadOutcomes.map((o) => o.toLowerCase()));
          for (const raw of rawAdd) {
            const name = typeof raw === 'string' ? raw.trim() : '';
            if (!name) {
              stripped.push(`threadDelta "${tm.threadId}" addOutcomes contained empty entry in scene ${scene.id}`);
              continue;
            }
            if (seen.has(name.toLowerCase())) {
              stripped.push(`threadDelta "${tm.threadId}" addOutcome "${name}" duplicates existing outcome in scene ${scene.id}`);
              continue;
            }
            seen.add(name.toLowerCase());
            extended.push(name);
            allowed.add(name);
          }
        }
        tm.addOutcomes = extended.length > 0 ? extended : undefined;
      } else {
        delete tm.addOutcomes;
      }

      // Normalize updates: filter invalid outcomes, clamp evidence.
      const rawUpdates = Array.isArray(tm.updates) ? tm.updates : [];
      tm.updates = rawUpdates.flatMap((u) => {
        if (!u || typeof u.outcome !== 'string' || !allowed.has(u.outcome)) {
          stripped.push(`threadDelta "${tm.threadId}" update outcome "${u?.outcome}" not in ${[...allowed].join('|')} in scene ${scene.id}`);
          return [];
        }
        const ev = typeof u.evidence === 'number' ? clampEvidence(u.evidence) : 0;
        return [{ outcome: u.outcome, evidence: ev }];
      });

      // volumeDelta defaults to 0 if missing.
      tm.volumeDelta = typeof tm.volumeDelta === 'number' ? tm.volumeDelta : 0;

      // rationale — require non-empty string; synthesise fallback if empty.
      if (typeof tm.rationale !== 'string' || !tm.rationale.trim()) {
        const desc = existing?.description ?? tm.threadId;
        tm.rationale = `Thread "${desc}" [${tm.logType}] — no rationale provided.`;
        stripped.push(`threadDelta "${tm.threadId}" missing rationale in scene ${scene.id} — synthesized fallback`);
      }

      // Drop entirely empty deltas (no updates, no volume, no new outcomes).
      const addCount = tm.addOutcomes?.length ?? 0;
      if (tm.updates.length === 0 && tm.volumeDelta === 0 && addCount === 0 && tm.logType === 'pulse') {
        stripped.push(`threadDelta "${tm.threadId}" empty (no updates, no volume, no expansion, pulse) in scene ${scene.id} — dropped`);
        return false;
      }
      return true;
    });
    scene.worldDeltas = scene.worldDeltas.filter((km) => {
      if (!km.entityId) {
        stripped.push(`worldDelta missing entityId in scene ${scene.id}`);
        return false;
      }
      if (allEntityIds.has(km.entityId)) return true;
      stripped.push(`worldDelta entityId "${km.entityId}" in scene ${scene.id}`);
      return false;
    });
    scene.relationshipDeltas = scene.relationshipDeltas.filter((rm) => {
      if (rm.from === rm.to) {
        stripped.push(`relationshipDelta self-loop "${rm.from}" in scene ${scene.id}`);
        return false;
      }
      if (validCharIds.has(rm.from) && validCharIds.has(rm.to)) return true;
      stripped.push(`relationshipDelta "${rm.from}" -> "${rm.to}" in scene ${scene.id}`);
      return false;
    });
    scene.ownershipDeltas = (scene.ownershipDeltas ?? []).filter((om) => {
      // fromId/toId can be null per schema (artifact introduced from nowhere
      // or discarded to nowhere). Only validate non-null ids against the
      // known entity set.
      const fromOk = om.fromId === null || allEntityIds.has(om.fromId);
      const toOk = om.toId === null || allEntityIds.has(om.toId);
      const ok = validArtifactIds.has(om.artifactId) && fromOk && toOk;
      if (!ok) stripped.push(`ownershipDelta "${om.artifactId}" in scene ${scene.id}`);
      return ok;
    });
    if (scene.ownershipDeltas.length === 0) delete scene.ownershipDeltas;
    // Validate artifact usages — artifact must exist, character must be a participant,
    // character-owned artifacts can only be used by their owner, location-owned are communal
    scene.artifactUsages = (scene.artifactUsages ?? []).filter((au) => {
      if (!validArtifactIds.has(au.artifactId)) { stripped.push(`artifactUsage artifact "${au.artifactId}" in scene ${scene.id}`); return false; }
      if (au.characterId && !validCharIds.has(au.characterId)) { stripped.push(`artifactUsage character "${au.characterId}" in scene ${scene.id}`); return false; }
      const artifact = narrative.artifacts[au.artifactId];
      // Character-owned artifacts can only be used by their owner; location-owned and world-owned (null) are communal
      if (artifact && artifact.parentId && au.characterId && narrative.characters[artifact.parentId] && artifact.parentId !== au.characterId) {
        stripped.push(`artifactUsage "${au.characterId}" cannot use character-owned artifact "${au.artifactId}" (owned by ${artifact.parentId}) in scene ${scene.id}`);
        return false;
      }
      return true;
    });
    if (scene.artifactUsages.length === 0) delete scene.artifactUsages;
    scene.tieDeltas = (scene.tieDeltas ?? []).filter((mm) => {
      const ok = validLocIds.has(mm.locationId) && validCharIds.has(mm.characterId) &&
                 (mm.action === 'add' || mm.action === 'remove');
      if (!ok) stripped.push(`tieDelta "${mm.characterId}" at "${mm.locationId}" in scene ${scene.id}`);
      return ok;
    });
    if (scene.tieDeltas.length === 0) delete scene.tieDeltas;
    if (scene.characterMovements) {
      const sanitized: Record<string, { locationId: string; transition: string }> = {};
      for (const [charId, mv] of Object.entries(scene.characterMovements)) {
        const movement = typeof mv === 'string' ? { locationId: mv, transition: '' } : mv;
        if (!validCharIds.has(charId)) { stripped.push(`characterMovement charId "${charId}" in scene ${scene.id}`); continue; }
        if (!validLocIds.has(movement.locationId)) { stripped.push(`characterMovement locationId "${movement.locationId}" in scene ${scene.id}`); continue; }
        sanitized[charId] = movement;
      }
      scene.characterMovements = Object.keys(sanitized).length > 0 ? sanitized : undefined;
    }

    // (Introduced entities — newCharacters / newLocations / newArtifacts /
    // newThreads — were registered in the first pass above so reference
    // validation earlier in this loop could see them.)

    // Sanitize systemDeltas — ensure arrays exist, nodes have concept+type,
    // edges have valid refs, no self-loops, no intra-scene duplicates.
    if (scene.systemDeltas) {
      const sysDelta = scene.systemDeltas;
      const beforeNodes = (sysDelta.addedNodes ?? []).length;
      const beforeEdges = (sysDelta.addedEdges ?? []).length;
      // Ensure each node carries an id (LLM may omit when emitting arrays) so
      // sanitize's field check doesn't spuriously drop them. IDs here are
      // still GEN-* placeholders — downstream remapping assigns real ones.
      sysDelta.addedNodes = (sysDelta.addedNodes ?? []).map((n, idx) => ({
        ...n,
        id: n.id || `SYS-GEN-${idx}`,
      }));
      for (const n of sysDelta.addedNodes) {
        if (n?.id) batchSysNodeIds.add(n.id);
      }
      // Valid targets for edges: any SYS-GEN id anywhere in the batch plus
      // existing graph ids — edges can legitimately cross scene boundaries.
      sanitizeSystemDelta(sysDelta, batchSysNodeIds, new Set<string>());
      if (sysDelta.addedNodes.length < beforeNodes) {
        stripped.push(`system nodes (${beforeNodes - sysDelta.addedNodes.length}) missing concept/type in scene ${scene.id}`);
      }
      if (sysDelta.addedEdges.length < beforeEdges) {
        stripped.push(`system edges (${beforeEdges - sysDelta.addedEdges.length}) invalid/self-loop/dup in scene ${scene.id}`);
      }
    } else {
      scene.systemDeltas = { addedNodes: [], addedEdges: [] };
    }
    // Ensure worldDeltas have required fields. Node ORDER defines
    // the chain — no explicit edges are stored. Type sanitization in applyWorldDelta.
    scene.worldDeltas = scene.worldDeltas.filter((km) => {
      if (!km.entityId) { stripped.push(`worldDelta missing entityId in scene ${scene.id}`); return false; }
      km.addedNodes = (km.addedNodes ?? []).filter((n, idx) => {
        const ok = !!n?.content;
        if (!ok) {
          stripped.push(`worldDelta "${km.entityId}" addedNode[${idx}] empty/malformed in scene ${scene.id}`);
        }
        return ok;
      });
      if (km.addedNodes.length === 0) {
        stripped.push(`worldDelta empty (no nodes) in scene ${scene.id}`);
        return false;
      }
      return true;
    });
  }
  if (stripped.length > 0) {
    logWarning(`Stripped ${stripped.length} hallucinated ID(s) from ${label}`, stripped.join(', '), {
      source: 'manual-generation',
      operation: 'clean-scene-data',
      details: { count: stripped.length, type: label }
    });
  }
}


