import type { NarrativeState, Scene, Character, Location, Thread, ThreadDelta, ThreadHorizon, RelationshipEdge, SystemNode, SystemDelta, SystemNodeType, Artifact, OwnershipDelta, TieDelta, WorldDelta, RelationshipDelta, WorldBuild, NarrativeParadigm, WebsearchConfig } from '@/types/narrative';
import { resolveEntry, isScene, REASONING_BUDGETS, DEFAULT_STORY_SETTINGS, NARRATOR_AGENT_ID } from '@/types/narrative';
import { resolveReasoningBudget, resolveWebsearch } from './api';
import { clampEvidence, isThreadAbandoned, isThreadClosed, FORCE_REFERENCE_MEANS, FORCE_BANDS, fmtBand } from '@/lib/narrative-utils';
import { nextId, nextIds } from '@/lib/narrative-utils';
import { normalizeTimeDelta } from '@/lib/time-deltas';
import type { ThreadLogNodeType } from '@/types/narrative';
import { applyThreadDelta, newNarratorBelief } from '@/lib/thread-log';
import { applyWorldDelta } from '@/lib/world-graph';
import { sanitizeSystemDelta, systemEdgeKey, makeSystemIdAllocator, resolveSystemConceptIds } from '@/lib/system-graph';
import { ensureSceneAttributions, ensureExpansionAttributions } from '@/lib/attribution';
import { callGenerate, callGenerateStream } from './api';
import {
  ARC_DIRECTION_SYSTEM,
  NARRATIVE_DIRECTION_SYSTEM,
  EXPANSION_SUGGEST_SYSTEM,
  EXPAND_WORLD_SYSTEM,
  GENERATE_NARRATIVE_SYSTEM,
  DETECT_PATTERNS_SYSTEM,
} from '@/lib/prompts/world';
import { buildActiveModeSection } from './mode-graph';
import { MAX_TOKENS_LARGE, GENERATE_MODEL } from '@/lib/constants';
import { parseJson } from './json';
import { narrativeContext } from './context';
import { logInfo } from '@/lib/system-logger';
import {
  buildSuggestArcDirectionPrompt,
  buildSuggestAutoDirectionPrompt,
  buildSuggestWorldExpansionPrompt,
  buildExpandWorldPrompt,
  buildGenerateNarrativePrompt,
  buildDetectPatternsPrompt,
  EXPANSION_SIZE_CONFIG,
  EXPANSION_STRATEGY_PROMPTS,
  type WorldExpansionSize,
  type WorldExpansionStrategy,
} from '@/lib/prompts/world';
// World expansion no longer uses a causal reasoning graph — creative
// planning happens upstream in the directive (hand-written or AI health
// report). The CRG generation path has been removed.

/**
 * Coerce a horizon string from the LLM (or undefined) into a valid
 * `ThreadHorizon`. Defaults to `'medium'` — the right neutral for any
 * thread the model didn't classify, since Principle 9 (scope-distance
 * attenuation) treats medium as the unbiased baseline.
 */
const VALID_HORIZONS: ReadonlySet<string> = new Set(['short', 'medium', 'long', 'epic']);
function normaliseHorizon(raw: unknown): ThreadHorizon {
  if (typeof raw === 'string' && VALID_HORIZONS.has(raw)) return raw as ThreadHorizon;
  return 'medium';
}

/**
 * Normalize LLM-emitted entity world into the World graph shape
 * (nodes keyed by id, edges chained via co_occurs). The schema requests a
 * Record but the LLM reliably returns an array with no edges. Route the
 * initial nodes through applyWorldDelta so nodes become a Record
 * keyed by id and get chained sequentially — matching how scene
 * worldDeltas build up entity graphs across the rest of the pipeline.
 */
function normalizeInitialWorld(
  entityId: string,
  raw: unknown,
): { nodes: Record<string, { id: string; type: WorldDelta['addedNodes'][number]['type']; content: string }>; edges: { from: string; to: string; relation: string }[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawObj = raw as any;
  const rawNodes: unknown[] = Array.isArray(rawObj?.nodes)
    ? rawObj.nodes
    : (rawObj?.nodes && typeof rawObj.nodes === 'object' ? Object.values(rawObj.nodes) : []);
  const addedNodes = rawNodes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((n: any) => n && typeof n.content === 'string' && n.content.trim())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((n: any, i: number) => ({
      id: n.id || `K-${entityId}-${i + 1}`,
      content: n.content,
      type: (n.type || 'trait') as WorldDelta['addedNodes'][number]['type'],
    }));
  return applyWorldDelta(
    { nodes: {}, edges: [] },
    { entityId, addedNodes },
  );
}

/** 1:1 with WorldExpansion fields — each toggle controls one field. */
export type ExpansionEntityFilter = {
  characters: boolean;
  locations: boolean;
  artifacts: boolean;
  threads: boolean;
  threadDeltas: boolean;
  worldDeltas: boolean;
  systemDeltas: boolean;
  relationshipDeltas: boolean;
  ownershipDeltas: boolean;
  tieDeltas: boolean;
};

export const DEFAULT_EXPANSION_FILTER: ExpansionEntityFilter = {
  characters: true, locations: true, artifacts: true,
  threads: true, threadDeltas: true, worldDeltas: true,
  systemDeltas: true, relationshipDeltas: true,
  ownershipDeltas: true, tieDeltas: true,
};

/**
 * WorldExpansionResponse — mirrors WorldExpansion 1:1 plus reasoning graph.
 * Field names match WorldExpansion so the store can spread directly.
 */
export type WorldExpansionResponse = {
  /** 1-2 sentence intent of the expansion — what creative space it opens.
   *  Used by downstream arc generation as steering context. Empty when the
   *  LLM omits it; the store reducer falls back to a derived count string. */
  summary?: string;
  characters: Character[];
  locations: Location[];
  artifacts: Artifact[];
  threads: Thread[];
  threadDeltas?: ThreadDelta[];
  worldDeltas?: WorldDelta[];
  systemDeltas?: SystemDelta;
  relationshipDeltas?: RelationshipDelta[];
  ownershipDeltas?: OwnershipDelta[];
  tieDeltas?: TieDelta[];
  attributions?: string[];
  attributionEdges?: import('@/types/narrative').AttributionEdge[];
};

export type DirectionSuggestion = {
  text: string;
  arcName: string;
  suggestedSceneCount: number;
};

export async function suggestArcDirection(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): Promise<DirectionSuggestion> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  const prompt = buildSuggestArcDirectionPrompt({ narrativeContext: ctx });

  const reasoningBudget = resolveReasoningBudget(narrative);
  const websearch = resolveWebsearch(narrative);
  const raw = await callGenerate(prompt, ARC_DIRECTION_SYSTEM, undefined, 'suggestDirection', undefined, reasoningBudget, true, undefined, websearch);
  const parsed = parseJson(raw, 'suggestDirection') as {
    arcName?: string; direction?: string; sceneSuggestion?: string; suggestedSceneCount?: number;
  };
  const sceneCount = Math.max(1, Math.min(8, parsed.suggestedSceneCount ?? 4));
  return {
    text: `${parsed.arcName}: ${parsed.direction}${parsed.sceneSuggestion ? '\n\n' + parsed.sceneSuggestion : ''}`,
    arcName: parsed.arcName ?? '',
    suggestedSceneCount: sceneCount,
  };
}


export async function suggestAutoDirection(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): Promise<string> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  const prompt = buildSuggestAutoDirectionPrompt({ narrativeContext: ctx });

  const reasoningBudget = resolveReasoningBudget(narrative);
  const websearch = resolveWebsearch(narrative);
  const raw = await callGenerate(prompt, NARRATIVE_DIRECTION_SYSTEM, undefined, 'suggestStoryDirection', undefined, reasoningBudget, true, undefined, websearch);
  const parsed = parseJson(raw, 'suggestStoryDirection') as { direction?: string };
  return parsed.direction ?? '';
}


// ── World Metrics ────────────────────────────────────────────────────────────

export type WorldMetrics = {
  totalScenes: number;
  /** Characters */
  totalCharacters: number;
  usedCharacters: number;
  avgScenesPerCharacter: number;
  /** Characters not seen in >30% of recent scenes */
  staleCharacters: number;
  /** % of scenes the most-used character appears in */
  castConcentration: number;
  /** Average knowledge nodes per character */
  avgKnowledgePerCharacter: number;
  /** Locations */
  totalLocations: number;
  usedLocations: number;
  /** % of scenes in the most-used location */
  locationConcentration: number;
  staleLocations: number;
  /** Max depth of location nesting */
  locationDepth: number;
  /** Avg sub-locations per used location */
  avgChildrenPerLocation: number;
  /** Relationships */
  relationshipsPerCharacter: number;
  orphanedCharacters: number;
  /** Recommendation */
  recommendation: 'depth' | 'breadth' | 'balanced';
  reasoning: string;
};

/**
 * Compute measurable world metrics from the narrative state to inform expansion strategy.
 * Returns concrete numbers + a recommendation (depth/breadth/balanced) with reasoning.
 */
export function computeWorldMetrics(
  narrative: NarrativeState,
  resolvedKeys: string[],
): WorldMetrics {
  const allScenes: Scene[] = resolvedKeys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => e !== null && isScene(e));

  const totalScenes = allScenes.length;
  const totalCharacters = Object.keys(narrative.characters).length;
  const totalLocations = Object.keys(narrative.locations).length;

  // ── Cast metrics ──────────────────────────────────────────────────
  const charScenes = new Map<string, { count: number; last: number }>();
  const locScenes = new Map<string, { count: number; last: number }>();

  for (const [i, scene] of allScenes.entries()) {
    for (const pid of scene.participantIds) {
      const ex = charScenes.get(pid);
      if (ex) { ex.count++; ex.last = i; }
      else charScenes.set(pid, { count: 1, last: i });
    }
    const ex = locScenes.get(scene.locationId);
    if (ex) { ex.count++; ex.last = i; }
    else locScenes.set(scene.locationId, { count: 1, last: i });
  }

  const usedCharacters = charScenes.size;
  const usedLocations = locScenes.size;

  const charCounts = Array.from(charScenes.values()).map((c) => c.count);
  const avgScenesPerCharacter = charCounts.length > 0 ? charCounts.reduce((a, b) => a + b, 0) / charCounts.length : 0;
  const maxCharScenes = charCounts.length > 0 ? Math.max(...charCounts) : 0;
  const castConcentration = totalScenes > 0 ? maxCharScenes / totalScenes : 0;

  const staleThreshold = Math.max(5, totalScenes * 0.3);
  const staleCharacters = Array.from(charScenes.values()).filter((c) => (totalScenes - 1 - c.last) > staleThreshold).length;

  const avgKnowledgePerCharacter = totalCharacters > 0
    ? Object.values(narrative.characters).reduce((sum, c) => sum + Object.keys(c.world?.nodes ?? {}).length, 0) / totalCharacters
    : 0;

  // ── Location metrics ──────────────────────────────────────────────
  const locCounts = Array.from(locScenes.values()).map((l) => l.count);
  const maxLocScenes = locCounts.length > 0 ? Math.max(...locCounts) : 0;
  const locationConcentration = totalScenes > 0 ? maxLocScenes / totalScenes : 0;
  const staleLocations = Array.from(locScenes.values()).filter((l) => (totalScenes - 1 - l.last) > staleThreshold).length;

  // Location depth: max nesting level
  function locDepth(locId: string, visited = new Set<string>()): number {
    if (visited.has(locId)) return 0;
    visited.add(locId);
    const children = Object.values(narrative.locations).filter((l) => l.parentId === locId);
    if (children.length === 0) return 1;
    return 1 + Math.max(...children.map((c) => locDepth(c.id, visited)));
  }
  const rootLocs = Object.values(narrative.locations).filter((l) => !l.parentId);
  const locationDepth = rootLocs.length > 0 ? Math.max(...rootLocs.map((l) => locDepth(l.id))) : 0;

  const childCounts = Object.values(narrative.locations).map((l) =>
    Object.values(narrative.locations).filter((c) => c.parentId === l.id).length
  );
  const avgChildrenPerLocation = childCounts.length > 0 ? childCounts.reduce((a, b) => a + b, 0) / childCounts.length : 0;

  // ── Relationship metrics ──────────────────────────────────────────
  const relCount = narrative.relationships.length;
  const relationshipsPerCharacter = totalCharacters > 0 ? (relCount * 2) / totalCharacters : 0;
  const connectedChars = new Set(narrative.relationships.flatMap((r) => [r.from, r.to]));
  const orphanedCharacters = Object.keys(narrative.characters).filter((id) => !connectedChars.has(id)).length;

  // ── Recommendation ────────────────────────────────────────────────
  const depthSignals: string[] = [];
  const breadthSignals: string[] = [];

  // Low knowledge density = depth needed
  if (avgKnowledgePerCharacter < 3) depthSignals.push(`low knowledge density (${avgKnowledgePerCharacter.toFixed(1)} nodes/char)`);
  // Shallow location hierarchy = depth needed
  if (locationDepth <= 2 && totalLocations > 3) depthSignals.push(`shallow location hierarchy (max depth ${locationDepth})`);
  // High cast concentration = depth needed (same few characters overused)
  if (castConcentration > 0.6) depthSignals.push(`cast concentration high (top char in ${(castConcentration * 100).toFixed(0)}% of scenes)`);
  // Low relationships = depth needed
  if (relationshipsPerCharacter < 2) depthSignals.push(`sparse relationships (${relationshipsPerCharacter.toFixed(1)}/char)`);
  // Orphaned characters = depth needed
  if (orphanedCharacters > 2) depthSignals.push(`${orphanedCharacters} orphaned characters`);

  // High location concentration = breadth needed (stuck in one place)
  if (locationConcentration > 0.5) breadthSignals.push(`scene concentration high (top location: ${(locationConcentration * 100).toFixed(0)}%)`);
  // Many stale characters = breadth needed (cast exhausted)
  if (staleCharacters > totalCharacters * 0.4) breadthSignals.push(`${staleCharacters}/${totalCharacters} characters are stale`);
  // Many stale locations = breadth needed
  if (staleLocations > totalLocations * 0.4) breadthSignals.push(`${staleLocations}/${totalLocations} locations are stale`);
  // Few locations relative to cast = breadth needed
  if (totalLocations < totalCharacters * 0.3) breadthSignals.push(`location count low relative to cast (${totalLocations} locs / ${totalCharacters} chars)`);

  let recommendation: 'depth' | 'breadth' | 'balanced';
  let reasoning: string;
  // Simple majority — any imbalance triggers a recommendation
  if (depthSignals.length > breadthSignals.length) {
    recommendation = 'depth';
    reasoning = `Depth recommended: ${depthSignals.join('; ')}`;
  } else if (breadthSignals.length > depthSignals.length) {
    recommendation = 'breadth';
    reasoning = `Breadth recommended: ${breadthSignals.join('; ')}`;
  } else {
    recommendation = 'balanced';
    reasoning = depthSignals.length + breadthSignals.length > 0
      ? `Balanced: depth signals (${depthSignals.join('; ') || 'none'}), breadth signals (${breadthSignals.join('; ') || 'none'})`
      : 'World is balanced — no strong signals in either direction';
  }

  return {
    totalScenes, totalCharacters, usedCharacters, avgScenesPerCharacter,
    staleCharacters, castConcentration, avgKnowledgePerCharacter,
    totalLocations, usedLocations, locationConcentration, staleLocations,
    locationDepth, avgChildrenPerLocation,
    relationshipsPerCharacter, orphanedCharacters,
    recommendation, reasoning,
  };
}

// Re-export from prompts directory so existing call sites keep working.
export type { WorldExpansionSize, WorldExpansionStrategy };

export async function suggestWorldExpansion(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  size: WorldExpansionSize = 'medium',
  strategy: WorldExpansionStrategy = 'dynamic',
): Promise<string> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  // Build structural summary for analysis
  const charCount = Object.keys(narrative.characters).length;
  const locCount = Object.keys(narrative.locations).length;
  const threadCount = Object.keys(narrative.threads).length;
  const relCount = narrative.relationships.length;
  const orphanChars = Object.values(narrative.characters).filter(c =>
    !narrative.relationships.some(r => r.from === c.id || r.to === c.id)
  ).map(c => c.name);
  const rootLocs = Object.values(narrative.locations).filter(l => !l.parentId).map(l => l.name);
  const leafLocs = Object.values(narrative.locations).filter(l =>
    !Object.values(narrative.locations).some(other => other.parentId === l.id)
  ).map(l => l.name);

  const prompt = buildSuggestWorldExpansionPrompt({
    narrativeContext: ctx,
    charCount,
    locCount,
    threadCount,
    relCount,
    orphanChars,
    rootLocs,
    leafLocs,
    size,
    sizeConfig: EXPANSION_SIZE_CONFIG[size],
  });

  const reasoningBudget = resolveReasoningBudget(narrative);
  const websearch = resolveWebsearch(narrative);
  const raw = await callGenerate(prompt, EXPANSION_SUGGEST_SYSTEM, undefined, 'suggestWorldExpansion', undefined, reasoningBudget, true, undefined, websearch);
  const parsed = parseJson(raw, 'suggestWorldExpansion') as { suggestion: string };
  return parsed.suggestion;
}

export type ExpandWorldOptions = {
  /** Verbatim plan document section — guides entity creation with specific character/location/system details */
  sourceText?: string;
  /** Callback for streaming reasoning/thinking tokens */
  onReasoning?: (token: string) => void;
  /** Filter which entity types to create — disabled types are excluded from prompt and stripped from output */
  entityFilter?: ExpansionEntityFilter;
};

export async function expandWorld(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  directive: string,
  size: WorldExpansionSize = 'medium',
  strategy: WorldExpansionStrategy = 'dynamic',
  /** @deprecated Use options object instead */
  sourceTextOrOptions?: string | ExpandWorldOptions,
  /** @deprecated Use options object instead */
  onReasoningLegacy?: (token: string) => void,
  /** @deprecated Use options object instead */
  entityFilterLegacy?: ExpansionEntityFilter,
): Promise<WorldExpansionResponse> {
  // Support both legacy positional args and new options object
  const options: ExpandWorldOptions = typeof sourceTextOrOptions === 'object' && sourceTextOrOptions !== null
    ? sourceTextOrOptions
    : {
        sourceText: sourceTextOrOptions,
        onReasoning: onReasoningLegacy,
        entityFilter: entityFilterLegacy,
      };
  const { sourceText, onReasoning, entityFilter } = options;

  logInfo('Starting world expansion', {
    source: 'world-expansion',
    operation: 'expand-world',
    details: {
      narrativeId: narrative.id,
      size,
      strategy,
      hasDirective: !!directive,
      hasSourceText: !!sourceText,
    },
  });

  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  // Compute next sequential IDs for the AI to use
  const nextCharId = nextId('C', Object.keys(narrative.characters));
  const nextLocId = nextId('L', Object.keys(narrative.locations));
  const nextThreadId = nextId('T', Object.keys(narrative.threads));
  const nextArtifactId = nextId('A', Object.keys(narrative.artifacts ?? {}));
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => Object.keys(c.world?.nodes ?? {})),
    ...Object.values(narrative.locations).flatMap((l) => Object.keys(l.world?.nodes ?? {})),
  ];
  const nextKId = nextId('K', existingKIds);

  // Build existing entity summary for integration context
  const existingCharList = Object.values(narrative.characters).map(c => `${c.name} [${c.id}, ${c.role}]`).join(', ');
  const existingLocList = Object.values(narrative.locations).map(l => `${l.name} [${l.id}]${l.parentId ? ` (inside ${narrative.locations[l.parentId]?.name ?? l.parentId})` : ''}`).join(', ');
  const existingRelList = narrative.relationships.map(r => {
    const fromName = narrative.characters[r.from]?.name ?? r.from;
    const toName = narrative.characters[r.to]?.name ?? r.to;
    return `${fromName}→${toName}: ${r.type}`;
  }).join(', ');

  // Build strategy prompt — for dynamic, compute metrics and inject data-driven guidance
  let strategyBlock: string;
  if (strategy === 'dynamic') {
    const m = computeWorldMetrics(narrative, resolvedKeys.slice(0, currentIndex + 1));
    strategyBlock = `STRATEGY: DYNAMIC (data-driven)
WORLD METRICS:
- Cast: ${m.usedCharacters}/${m.totalCharacters} characters used, ${m.avgScenesPerCharacter.toFixed(1)} avg scenes/char, ${m.staleCharacters} stale, concentration ${(m.castConcentration * 100).toFixed(0)}%
- Knowledge: ${m.avgKnowledgePerCharacter.toFixed(1)} avg nodes/char
- Locations: ${m.usedLocations}/${m.totalLocations} used, concentration ${(m.locationConcentration * 100).toFixed(0)}%, depth ${m.locationDepth}, ${m.staleLocations} stale
- Relationships: ${m.relationshipsPerCharacter.toFixed(1)}/char, ${m.orphanedCharacters} orphaned

ANALYSIS: ${m.reasoning}
RECOMMENDATION: ${m.recommendation.toUpperCase()}

${m.recommendation === 'depth' ? EXPANSION_STRATEGY_PROMPTS.depth : m.recommendation === 'breadth' ? EXPANSION_STRATEGY_PROMPTS.breadth : `Follow the balanced approach: deepen the active sandbox (more sub-locations, embedded characters, knowledge density) while introducing 1-2 new external elements to prevent stagnation.`}`;
  } else {
    strategyBlock = EXPANSION_STRATEGY_PROMPTS[strategy];
  }

  const entityFilterBlock = (() => {
    const f = entityFilter ?? DEFAULT_EXPANSION_FILTER;
    const disabled = Object.entries(f).filter(([, v]) => !v).map(([k]) => k);
    if (disabled.length === 0) return '';
    const labels: Record<string, string> = { characters: 'characters', locations: 'locations', artifacts: 'artifacts', threads: 'threads', threadDeltas: 'thread deltas (market evidence on existing threads)', worldDeltas: 'world deltas (changes to existing entities)', systemDeltas: 'system deltas', relationshipDeltas: 'relationship deltas (new and shifted relationships)', ownershipDeltas: 'ownership deltas (artifact transfers)', tieDeltas: 'tie deltas (character-location bonds)' };
    return `ENTITY FILTER — DO NOT create the following types (return empty arrays for them):\n${disabled.map(k => `- NO ${labels[k]}`).join('\n')}\n`;
  })();

  const prompt = buildExpandWorldPrompt({
    context: ctx,
    directive,
    sourceText,
    size,
    strategyBlock,
    entityFilterBlock,
    modeSection: buildActiveModeSection(narrative, "expand"),
    existingCharList,
    existingLocList,
    existingRelList,
    nextCharId,
    nextLocId,
    nextThreadId,
    nextArtifactId,
    nextKId,
  });

  const reasoningBudget = resolveReasoningBudget(narrative);
  const websearch = resolveWebsearch(narrative);
  const raw = onReasoning
    ? await callGenerateStream(prompt, EXPAND_WORLD_SYSTEM, () => {}, MAX_TOKENS_LARGE, 'expandWorld', GENERATE_MODEL, reasoningBudget, onReasoning, undefined, websearch)
    : await callGenerate(prompt, EXPAND_WORLD_SYSTEM, MAX_TOKENS_LARGE, 'expandWorld', GENERATE_MODEL, reasoningBudget, true, undefined, websearch);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'expandWorld') as any;

  // Normalize threads. The LLM schema asks only for id, participants,
  // description, outcomes, and dependents. openedAt is stamped by the store
  // reducer to the worldBuildId at apply time. beliefs and threadLog are
  // canonical scaffolding — always initialised here so the rest of the
  // pipeline sees a well-formed market.
  const newThreadIds = new Set((parsed.threads ?? []).map((t: { id: string }) => t.id));
  const existingThreadIds = new Set(Object.keys(narrative.threads));
  const validThreadIds = new Set([...newThreadIds, ...existingThreadIds]);

  const threads = (parsed.threads ?? []).map((t: Thread) => {
    const outcomes = Array.isArray(t.outcomes) && t.outcomes.length >= 2
      ? t.outcomes
      : ['yes', 'no'];
    const dependents = (t.dependents ?? []).filter((id: string) => validThreadIds.has(id) && id !== t.id);
    return {
      id: t.id,
      participants: t.participants ?? [],
      description: t.description,
      outcomes,
      horizon: normaliseHorizon(t.horizon),
      dependents,
      openedAt: '', // Store reducer stamps worldBuildId at apply time
      beliefs: { [NARRATOR_AGENT_ID]: newNarratorBelief(outcomes.length, 2) },
      threadLog: { nodes: {}, edges: [] },
    } satisfies Thread;
  });

  // Process systemDeltas: concept-based resolution collapses
  // re-mentioned concepts to their existing id, then sanitize filters self-
  // loops, orphans, and edges that duplicate ones already in the graph.
  let systemDeltas: SystemDelta | undefined;
  const rawSystem = parsed.systemDeltas;
  if (rawSystem && Array.isArray(rawSystem.addedNodes) && rawSystem.addedNodes.length > 0) {
    const existingSysNodes = narrative.systemGraph?.nodes ?? {};

    // Normalize raw nodes so they satisfy the resolver's input shape —
    // every node must have an id placeholder, a concept, and a type.
    const rawNormalized = rawSystem.addedNodes.map(
      (node: { id: string; concept: string; type: string }, i: number) => ({
        id: node.id || `SYS-GEN-${i}`,
        concept: node.concept,
        type: (node.type || 'concept') as SystemNodeType,
      }),
    );
    const allocateFreshSysId = makeSystemIdAllocator(Object.keys(existingSysNodes));
    const resolved = resolveSystemConceptIds(rawNormalized, existingSysNodes, allocateFreshSysId);

    const validSysIds = new Set<string>([
      ...Object.keys(existingSysNodes),
      ...resolved.newNodes.map((n) => n.id),
    ]);
    const remappedEdges = (rawSystem.addedEdges ?? []).map(
      (edge: { from: string; to: string; relation: string }) => ({
        from: resolved.idMap[edge.from] ?? edge.from,
        to: resolved.idMap[edge.to] ?? edge.to,
        relation: edge.relation,
      }),
    );

    const seenEdgeKeys = new Set<string>();
    for (const e of narrative.systemGraph?.edges ?? []) seenEdgeKeys.add(systemEdgeKey(e));

    systemDeltas = { addedNodes: resolved.newNodes, addedEdges: remappedEdges };
    sanitizeSystemDelta(systemDeltas, validSysIds, seenEdgeKeys);
  }

  // Apply entity filter — strip types the user disabled. Freshly-created
  // entities have their LLM-emitted world normalized (array → Record)
  // and chained via co_occurs through applyWorldDelta.
  // Fallback: accept legacy "continuity" field name if "world" is absent.
  const f = entityFilter ?? DEFAULT_EXPANSION_FILTER;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalizedCharacters = (parsed.characters ?? []).map((c: any) => ({
    ...c,
    threadIds: c.threadIds ?? [],
    world: normalizeInitialWorld(c.id, c.world ?? c.continuity),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalizedLocations = (parsed.locations ?? []).map((l: any) => ({
    ...l,
    threadIds: l.threadIds ?? [],
    tiedCharacterIds: l.tiedCharacterIds ?? [],
    world: normalizeInitialWorld(l.id, l.world ?? l.continuity),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalizedArtifacts = (parsed.artifacts ?? []).map((a: any) => ({
    ...a,
    threadIds: a.threadIds ?? [],
    world: normalizeInitialWorld(a.id, a.world ?? a.continuity),
  }));
  // Merge legacy "relationships" array (valence → valenceDelta) into relationshipDeltas
  const mergedRelDeltas: RelationshipDelta[] = [
    ...(parsed.relationships ?? []).map((r: RelationshipEdge) => ({
      from: r.from, to: r.to, type: r.type, valenceDelta: r.valence,
    })),
    ...(parsed.relationshipDeltas ?? []),
  ];

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';

  const result: WorldExpansionResponse = {
    summary: summary || undefined,
    characters: f.characters ? normalizedCharacters : [],
    locations: f.locations ? normalizedLocations : [],
    artifacts: f.artifacts ? normalizedArtifacts : [],
    threads: f.threads ? threads : [],
    threadDeltas: f.threadDeltas ? (parsed.threadDeltas ?? []) : [],
    worldDeltas: f.worldDeltas ? (parsed.worldDeltas ?? []) : [],
    systemDeltas: f.systemDeltas ? systemDeltas : undefined,
    relationshipDeltas: f.relationshipDeltas ? mergedRelDeltas : [],
    ownershipDeltas: f.ownershipDeltas ? (parsed.ownershipDeltas ?? []) : [],
    tieDeltas: f.tieDeltas ? (parsed.tieDeltas ?? []) : [],
    attributions: Array.isArray(parsed.attributions)
      ? parsed.attributions.filter((id: unknown): id is string => typeof id === 'string')
      : undefined,
    attributionEdges: Array.isArray(parsed.attributionEdges)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? parsed.attributionEdges.filter((e: any) =>
          e && typeof e.from === 'string' && typeof e.to === 'string' && typeof e.relation === 'string',
        )
      : undefined,
  };

  logInfo('Completed world expansion', {
    source: 'world-expansion',
    operation: 'expand-world-complete',
    details: {
      narrativeId: narrative.id,
      charactersAdded: result.characters.length,
      locationsAdded: result.locations.length,
      threadsAdded: result.threads.length,
      artifactsAdded: result.artifacts.length,
      relationshipDeltaCount: result.relationshipDeltas?.length ?? 0,
      systemNodeCount: result.systemDeltas?.addedNodes.length ?? 0,
    },
  });

  return result;
}

export async function generateNarrative(
  title: string,
  premise: string,
  onReasoning?: (token: string) => void,
  /** When true: generate world entities only — no introduction arc or scenes.
   *  The premise is treated as a full story plan / world bible to seed from. */
  worldOnly = false,
  /** Selected paradigm — steers generation into one of the engine's canonical
   *  world-shapes (populated-narrative / agentic-ai-team / singular-thinker).
   *  Defaults to 'fiction'. */
  paradigm: NarrativeParadigm = 'fiction',
  /** Optional seeding context — extra source material to draw from. */
  sourceText?: string,
  /** Websearch config for the wizard-time world-gen call. null disables
   *  the OpenRouter web plugin entirely. */
  websearch: WebsearchConfig | null = null,
): Promise<NarrativeState> {
  logInfo('Starting narrative generation', {
    source: 'manual-generation',
    operation: 'generate-narrative',
    details: {
      title,
      worldOnly,
      paradigm,
      sourceTextLength: sourceText?.length,
    },
  });

  const prompt = buildGenerateNarrativePrompt({
    title,
    premise,
    sourceText,
    worldOnly,
    paradigm,
    forceReferenceMeansWorld: FORCE_REFERENCE_MEANS.world,
    forceReferenceMeansSystem: FORCE_REFERENCE_MEANS.system,
    worldTypicalBand: fmtBand(FORCE_BANDS.world.typical),
    worldClimaxBand: fmtBand(FORCE_BANDS.world.climax, true),
    systemTypicalBand: fmtBand(FORCE_BANDS.system.typical),
    systemClimaxBand: fmtBand(FORCE_BANDS.system.climax),
  });

  // Low reasoning is sufficient for world generation — the prompt fully
  // specifies the structure (schema, minimums, paradigm blocks), so the
  // model is doing a structural fill-in rather than open-ended reasoning.
  // Higher budgets paid 6k+ extra thinking tokens that just stretched the
  // wall-clock time without improving the output. Initial world generation
  // is the slowest pass in the engine (huge JSON output); cutting reasoning
  // tokens here is the most user-visible perf win.
  const reasoningBudget = REASONING_BUDGETS['low'];
  const raw = onReasoning
    ? await callGenerateStream(prompt, GENERATE_NARRATIVE_SYSTEM, () => {}, MAX_TOKENS_LARGE, 'generateNarrative', GENERATE_MODEL, reasoningBudget, onReasoning, undefined, websearch)
    : await callGenerate(prompt, GENERATE_NARRATIVE_SYSTEM, MAX_TOKENS_LARGE, 'generateNarrative', GENERATE_MODEL, reasoningBudget, true, undefined, websearch);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'generateNarrative') as any;

  const now = Date.now();
  const id = `N-${now}`;

  // Normalize entities — accept legacy "continuity" field name if "world" is absent.
  const characters: NarrativeState['characters'] = {};
  for (const c of parsed.characters) {
    characters[c.id] = { ...c, threadIds: c.threadIds ?? [], world: normalizeInitialWorld(c.id, c.world ?? c.continuity) };
  }

  const locations: NarrativeState['locations'] = {};
  for (const l of parsed.locations) {
    locations[l.id] = { ...l, threadIds: l.threadIds ?? [], tiedCharacterIds: l.tiedCharacterIds ?? [], world: normalizeInitialWorld(l.id, l.world ?? l.continuity) };
  }

  const threads: NarrativeState['threads'] = {};
  // Normalize: LLM may still output "anchors" (legacy field name) — remap to "participants".
  // Seed outcomes + narrator belief at uniform logits if the LLM didn't
  // pre-populate them. Binary is the default shape.
  for (const t of parsed.threads) {
    const { anchors, ...rest } = t as Thread & { anchors?: Thread['participants'] };
    const outcomes = Array.isArray(rest.outcomes) && rest.outcomes.length >= 2
      ? rest.outcomes
      : ['yes', 'no'];
    const rawPriorProbs = Array.isArray(
      (rest as { priorProbs?: unknown }).priorProbs,
    )
      ? ((rest as { priorProbs?: unknown }).priorProbs as unknown[]).map((v) =>
          typeof v === 'number' ? v : NaN,
        )
      : undefined;
    const beliefs = rest.beliefs && typeof rest.beliefs === 'object' && Object.keys(rest.beliefs).length > 0
      ? rest.beliefs
      : { [NARRATOR_AGENT_ID]: newNarratorBelief(outcomes.length, 2, rawPriorProbs) };
    threads[t.id] = {
      ...rest,
      participants: rest.participants ?? anchors ?? [],
      outcomes,
      horizon: normaliseHorizon(rest.horizon),
      beliefs,
      threadLog: { nodes: {}, edges: [] },
    };
  }

  const scenes: NarrativeState['scenes'] = {};
  const sceneCreatedAt = new Date().toISOString();
  if (!worldOnly) {
    for (const s of (parsed.scenes ?? [])) {
      // Defensive normalization — the LLM may omit required array fields
      // (especially in argument-driven paradigms like analysis / paper /
      // essay where many scenes have no participants, no movements, no
      // relationships). Default every required array to [] so downstream
      // iteration (scene-filter, force formulas, inspector) never chokes.
      scenes[s.id] = {
        ...s,
        kind: 'scene',
        summary: s.summary || `Scene ${s.id}`,
        timeDelta: normalizeTimeDelta(s.timeDelta),
        createdAt: sceneCreatedAt,
        participantIds: Array.isArray(s.participantIds) ? s.participantIds : [],
        events: Array.isArray(s.events) ? s.events : [],
        threadDeltas: Array.isArray(s.threadDeltas) ? s.threadDeltas : [],
        worldDeltas: Array.isArray(s.worldDeltas) ? s.worldDeltas : [],
        relationshipDeltas: Array.isArray(s.relationshipDeltas) ? s.relationshipDeltas : [],
      };
    }
  }

  const arcs: NarrativeState['arcs'] = {};
  if (!worldOnly) {
    for (const a of (parsed.arcs ?? [])) arcs[a.id] = a;
  }

  // Normalize artifacts — accept legacy "continuity" field name if "world" is absent.
  const artifacts: NarrativeState['artifacts'] = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (parsed.artifacts ?? []).map((a: any) => [
      a.id,
      { ...a, threadIds: a.threadIds ?? [], world: normalizeInitialWorld(a.id, a.world ?? a.continuity) },
    ]),
  );

  // Create initial WorldBuild with entities and empty systemDeltas
  // This mirrors the analysis pattern: entities are structural (in WorldBuild),
  // all knowledge (system + world deltas) flows through scenes.
  // The WB summary is INTENT-style — what the commit opens up for arc generation
  // — to match the live expand-world path and the text-analysis
  // summariseWorldBuildBatch pass. Fall back through worldSummary (broader
  // world description) and finally a derived count string.
  const worldBuildId = `WB-${now}-INIT`;
  const aiWorldBuildSummary = typeof parsed.worldBuildSummary === 'string' ? parsed.worldBuildSummary.trim() : '';
  const aiWorldSummary = typeof parsed.worldSummary === 'string' ? parsed.worldSummary.trim() : '';
  const initialWorldBuild: WorldBuild = {
    kind: 'world_build',
    id: worldBuildId,
    createdAt: sceneCreatedAt,
    summary:
      aiWorldBuildSummary ||
      aiWorldSummary ||
      `Initial world: ${Object.keys(characters).length} characters, ${Object.keys(locations).length} locations, ${Object.keys(threads).length} threads`,
    expansionManifest: {
      newCharacters: Object.values(characters),
      newLocations: Object.values(locations),
      newThreads: Object.values(threads),
      newArtifacts: Object.values(artifacts),
      systemDeltas: { addedNodes: [], addedEdges: [] },
      // Accept both legacy "relationships" (valence) and new "relationshipDeltas" (valenceDelta)
      relationshipDeltas: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(parsed.relationships ?? []).map((r: any) => ({
          from: r.from, to: r.to, type: r.type, valenceDelta: r.valence ?? r.valenceDelta ?? 0,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(parsed.relationshipDeltas ?? []).map((r: any) => ({
          from: r.from, to: r.to, type: r.type, valenceDelta: r.valenceDelta ?? r.valence ?? 0,
        })),
      ],
      // Attribution skeleton — initial commit's contribution to the cumulative
      // network graph. Sanitisation is deferred to the consumer; here we just
      // pass the LLM's payload through.
      attributions: Array.isArray(parsed.attributions)
        ? parsed.attributions.filter((id: unknown): id is string => typeof id === 'string')
        : undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attributionEdges: Array.isArray(parsed.attributionEdges)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? parsed.attributionEdges.filter((e: any) =>
            e && typeof e.from === 'string' && typeof e.to === 'string' && typeof e.relation === 'string',
          )
        : undefined,
    },
  };

  const branchId = `B-${now}`;
  const branches: NarrativeState['branches'] = {
    [branchId]: {
      id: branchId,
      name: 'Main',
      parentBranchId: null,
      forkEntryId: null,
      entryIds: [worldBuildId, ...Object.keys(scenes)],
      createdAt: now,
    },
  };

  // Sanitize and re-ID system knowledge deltas on scenes. The system graph
  // is derived on load by computeDerivedEntities replaying the timeline.
  const sceneList = Object.values(scenes);

  // For worldOnly mode, system deltas go in the WorldBuild (seeded knowledge)
  if (worldOnly && parsed.systemDeltas) {
    const seededDelta: SystemDelta = {
      addedNodes: parsed.systemDeltas.addedNodes ?? [],
      addedEdges: parsed.systemDeltas.addedEdges ?? [],
    };
    // Resolve IDs and sanitize
    const allocator = makeSystemIdAllocator([]);
    const resolved = resolveSystemConceptIds(seededDelta.addedNodes, {}, allocator);
    seededDelta.addedNodes = resolved.newNodes;
    const validIds = new Set(resolved.newNodes.map(n => n.id));
    seededDelta.addedEdges = seededDelta.addedEdges.map(edge => ({
      from: resolved.idMap[edge.from] ?? edge.from,
      to: resolved.idMap[edge.to] ?? edge.to,
      relation: edge.relation,
    }));
    sanitizeSystemDelta(seededDelta, validIds, new Set());
    initialWorldBuild.expansionManifest.systemDeltas = seededDelta;
  }

  // Normalize and resolve IDs for scene system deltas
  const allocateFreshSysId = makeSystemIdAllocator([]);
  const accumulatedNodes: Record<string, SystemNode> = {};
  const validSysIds = new Set<string>();
  const seenSysEdgeKeys = new Set<string>();

  for (const scene of sceneList) {
    if (!scene.systemDeltas) {
      scene.systemDeltas = { addedNodes: [], addedEdges: [] };
      continue;
    }
    scene.systemDeltas.addedNodes = scene.systemDeltas.addedNodes ?? [];
    scene.systemDeltas.addedEdges = scene.systemDeltas.addedEdges ?? [];

    // Concept-based resolution: re-mentioned concepts collapse to the same id
    const resolved = resolveSystemConceptIds(
      scene.systemDeltas.addedNodes,
      accumulatedNodes,
      allocateFreshSysId,
    );
    scene.systemDeltas.addedNodes = resolved.newNodes;
    for (const n of resolved.newNodes) {
      validSysIds.add(n.id);
      accumulatedNodes[n.id] = n;
    }

    // Remap edge references and sanitize
    scene.systemDeltas.addedEdges = scene.systemDeltas.addedEdges.map((edge) => ({
      from: resolved.idMap[edge.from] ?? edge.from,
      to: resolved.idMap[edge.to] ?? edge.to,
      relation: edge.relation,
    }));
    sanitizeSystemDelta(scene.systemDeltas, validSysIds, seenSysEdgeKeys);

    // Walk the unified attribution list. SYS ids route through the resolver
    // idMap (SYS-GEN-* → real); non-SYS ids pass through. Re-mention
    // attributions from concept-resolution merge in.
    const rawAttrs = scene.attributions ?? [];
    const seenAttrs = new Set<string>();
    const mergedAttrs: string[] = [];
    const pushAttr = (id: string) => {
      if (!id || seenAttrs.has(id)) return;
      seenAttrs.add(id);
      mergedAttrs.push(id);
    };
    for (const id of rawAttrs) {
      if (id.startsWith('SYS-')) {
        const mapped = resolved.idMap[id] ?? id;
        if (validSysIds.has(mapped)) pushAttr(mapped);
      } else {
        pushAttr(id);
      }
    }
    for (const id of resolved.attributedExistingIds) pushAttr(id);
    if (mergedAttrs.length > 0) scene.attributions = mergedAttrs;
    if (scene.attributionEdges) {
      scene.attributionEdges = scene.attributionEdges.map((e) => ({
        from: e.from.startsWith('SYS-') ? (resolved.idMap[e.from] ?? e.from) : e.from,
        to: e.to.startsWith('SYS-') ? (resolved.idMap[e.to] ?? e.to) : e.to,
        relation: e.relation,
      }));
    }
    // Fold in derived baseline attributions from typed delta fields.
    ensureSceneAttributions(scene);
  }

  // Same fallback on the initial world build: every existing id its typed
  // deltas touch counts as attribution, even if the LLM didn't list it.
  ensureExpansionAttributions(initialWorldBuild.expansionManifest);

  // Generate embeddings for scene summaries
  if (sceneList.length > 0) {
    const { generateEmbeddingsBatch } = await import('@/lib/embeddings');
    const { assetManager } = await import('@/lib/asset-manager');
    const summaries = sceneList.map(s => s.summary);
    const embeddings = await generateEmbeddingsBatch(summaries, id);
    for (let i = 0; i < sceneList.length; i++) {
      const embeddingId = await assetManager.storeEmbedding(embeddings[i], 'text-embedding-3-small');
      sceneList[i].summaryEmbedding = embeddingId;
    }
  }

  // Sanitize thread log entries and assign globally-unique TK-* IDs. The LLM
  // emits TK-GEN-* placeholders (or nothing) — we normalize each node (fill
  // type from pulse/transition fallback, drop empty content), synthesize a
  // fallback log entry when the delta has none so every threadDelta
  // produces at least one log node, then remap to sequential TK-NNN IDs so
  // cross-scene collisions can't silently drop nodes in applyThreadDelta.
  // Also coerces invalid from/to statuses (e.g. the LLM emitting "pulse"
  // as a status when pulse is actually a log node type).
  // Normalize scene threadDeltas into the market shape. The LLM's initial
  // emission may be partial (missing logType, stray updates, no rationale);
  // this pass fills defaults and drops invalid entries so applyThreadDelta
  // can consume them uniformly.
  for (const scene of sceneList) {
    for (const tm of scene.threadDeltas ?? []) {
      const thread = threads[tm.threadId];
      if (!thread) continue;
      const allowed = new Set(thread.outcomes);
      tm.logType = tm.logType ?? 'pulse';
      tm.volumeDelta = typeof tm.volumeDelta === 'number' ? tm.volumeDelta : 0;
      tm.updates = (Array.isArray(tm.updates) ? tm.updates : []).flatMap((u) => {
        if (!u || typeof u.outcome !== 'string' || !allowed.has(u.outcome)) return [];
        const ev = typeof u.evidence === 'number' ? clampEvidence(u.evidence) : 0;
        return [{ outcome: u.outcome, evidence: ev }];
      });
      if (typeof tm.rationale !== 'string' || !tm.rationale.trim()) {
        // Prose fallback — reference the thread's question, not its logType or
        // outcome ids. Keeps log entries human-readable when the LLM forgot
        // the rationale slot.
        tm.rationale = `The scene brings fresh weight to "${thread.description}"`;
      }
    }
  }

  // Apply initial scene deltas through the market engine. Each scene's
  // threadDeltas update the narrator's belief and append a log node.
  for (const scene of sceneList) {
    for (const tm of scene.threadDeltas ?? []) {
      const thread = threads[tm.threadId];
      if (!thread) continue;
      threads[tm.threadId] = applyThreadDelta(thread, tm, scene.id);
    }
  }
  // Suppress unused: nextIds is still imported for other allocation paths.
  void nextIds;

  logInfo('Completed narrative generation', {
    source: 'manual-generation',
    operation: 'generate-narrative-complete',
    details: {
      narrativeId: id,
      title,
      worldOnly,
      charactersCreated: Object.keys(characters).length,
      locationsCreated: Object.keys(locations).length,
      threadsCreated: Object.keys(threads).length,
      scenesCreated: Object.keys(scenes).length,
      arcsCreated: Object.keys(arcs).length,
      artifactsCreated: Object.keys(artifacts).length,
    },
  });

  return {
    id,
    title,
    description: premise,
    characters,
    locations,
    threads,
    artifacts,
    arcs,
    scenes,
    worldBuilds: { [worldBuildId]: initialWorldBuild },
    branches,
    relationships: [], // Derived from WorldBuild.expansionManifest.relationshipDeltas by computeDerivedEntities
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: parsed.worldSummary ?? premise,
    imageStyle: typeof parsed.imageStyle === 'string' ? parsed.imageStyle : undefined,
    proseProfile: (() => {
      const pp = parsed.proseProfile;
      if (!pp || typeof pp !== 'object') return undefined;
      return {
        register:       typeof pp.register       === 'string' ? pp.register       : 'conversational',
        stance:         typeof pp.stance         === 'string' ? pp.stance         : 'close_third',
        tense:          typeof pp.tense          === 'string' ? pp.tense          : undefined,
        sentenceRhythm: typeof pp.sentenceRhythm === 'string' ? pp.sentenceRhythm : undefined,
        interiority:    typeof pp.interiority    === 'string' ? pp.interiority    : undefined,
        dialogueWeight: typeof pp.dialogueWeight === 'string' ? pp.dialogueWeight : undefined,
        devices:        Array.isArray(pp.devices) ? pp.devices.filter((d: unknown) => typeof d === 'string') : [],
        rules:          Array.isArray(pp.rules)   ? pp.rules.filter((r: unknown) => typeof r === 'string')   : [],
        antiPatterns:   Array.isArray(pp.antiPatterns) ? pp.antiPatterns.filter((a: unknown) => typeof a === 'string') : [],
      };
    })(),
    storySettings: {
      ...DEFAULT_STORY_SETTINGS,
      ...(typeof parsed.planGuidance === 'string' && parsed.planGuidance.trim() ? { planGuidance: parsed.planGuidance.trim() } : {}),
    },
    paradigm,
    genre: typeof parsed.genre === 'string' && parsed.genre.trim() ? parsed.genre.trim() : undefined,
    subgenre: typeof parsed.subgenre === 'string' && parsed.subgenre.trim() ? parsed.subgenre.trim() : undefined,
    patterns: Array.isArray(parsed.patterns) ? parsed.patterns.filter((p: unknown) => typeof p === 'string') : [],
    antiPatterns: Array.isArray(parsed.antiPatterns) ? parsed.antiPatterns.filter((p: unknown) => typeof p === 'string') : [],
    createdAt: now,
    updatedAt: now,
  };
}

// ── Auto-Detect Patterns ─────────────────────────────────────────────────────

export type DetectedPatterns = {
  patterns: string[];
  antiPatterns: string[];
  detectedParadigm?: NarrativeParadigm;
  detectedGenre: string;
  detectedSubgenre: string;
};

const VALID_PARADIGMS: ReadonlySet<NarrativeParadigm> = new Set<NarrativeParadigm>([
  'fiction', 'non-fiction', 'simulation', 'analysis', 'paper', 'essay',
]);

/**
 * Analyze an existing narrative and auto-detect patterns and anti-patterns
 * based on genre conventions, existing content, prose samples, and structural analysis.
 */
export async function detectPatterns(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  onToken?: (token: string) => void,
): Promise<DetectedPatterns> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  // Gather existing content signals
  const threads = Object.values(narrative.threads).slice(0, 10);
  const characters = Object.values(narrative.characters).slice(0, 10);
  const systemNodes = Object.values(narrative.systemGraph?.nodes ?? {}).slice(0, 15);

  const threadSummary = threads
    .map((t) => {
      const status = isThreadClosed(t)
        ? 'closed'
        : isThreadAbandoned(t)
          ? 'abandoned'
          : 'open';
      return `- ${t.description} (${status}, outcomes: ${t.outcomes.join(' | ')})`;
    })
    .join('\n');
  const characterSummary = characters.map(c => `- ${c.name}: ${c.role}`).join('\n');
  const systemSummary = systemNodes.map(n => `- ${n.concept} (${n.type})`).join('\n');

  // Gather prose samples from scenes (like prose profile detection)
  // Get the latest prose version from each scene
  const getLatestProse = (scene: Scene): string => {
    if (!scene.proseVersions || scene.proseVersions.length === 0) return '';
    // Sort by version descending and get latest
    const sorted = [...scene.proseVersions].sort((a, b) => {
      const aParts = a.version.split('.').map(Number);
      const bParts = b.version.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if ((bParts[i] || 0) !== (aParts[i] || 0)) return (bParts[i] || 0) - (aParts[i] || 0);
      }
      return 0;
    });
    return sorted[0]?.prose || '';
  };

  const scenesWithProse = Object.values(narrative.scenes)
    .map(s => ({ scene: s, prose: getLatestProse(s) }))
    .filter(({ prose }) => prose.length > 100)
    .slice(0, 10);

  const proseSamples = scenesWithProse.map(({ scene, prose }, i) => {
    const summary = scene.summary || 'No summary';
    // Take first ~800 chars of prose to keep prompt manageable
    const proseSnippet = prose.slice(0, 800);
    return `--- SCENE ${i + 1}: ${summary} ---\n${proseSnippet}${proseSnippet.length >= 800 ? '...' : ''}`;
  }).join('\n\n');

  // Get scene summaries for structure analysis
  const sceneSummaries = Object.values(narrative.scenes)
    .slice(0, 15)
    .map((s, i) => `${i + 1}. ${s.summary || 'Untitled scene'}`)
    .join('\n');

  const existingPatterns = narrative.patterns?.join('\n- ') || 'None';
  const existingAntiPatterns = narrative.antiPatterns?.join('\n- ') || 'None';

  const prompt = buildDetectPatternsPrompt({
    narrativeContext: ctx,
    threadSummary,
    characterSummary,
    systemSummary,
    sceneSummaries,
    proseSamples,
    existingPatterns,
    existingAntiPatterns,
  });

  const reasoningBudget = resolveReasoningBudget(narrative);
  const websearch = resolveWebsearch(narrative);

  const raw = onToken
    ? await callGenerateStream(
        prompt,
        DETECT_PATTERNS_SYSTEM,
        () => {},
        undefined,
        'detectPatterns',
        undefined,
        reasoningBudget,
        onToken,
        undefined,
        websearch,
      )
    : await callGenerate(
        prompt,
        DETECT_PATTERNS_SYSTEM,
        undefined,
        'detectPatterns',
        undefined,
        reasoningBudget,
        true,
        undefined,
        websearch,
      );

  const parsed = parseJson(raw, 'detectPatterns') as {
    detectedParadigm?: unknown;
    detectedGenre?: unknown;
    detectedSubgenre?: unknown;
    patterns?: unknown;
    antiPatterns?: unknown;
  };

  let detectedGenre = typeof parsed.detectedGenre === 'string' ? parsed.detectedGenre.trim() : '';
  let detectedSubgenre = typeof parsed.detectedSubgenre === 'string' ? parsed.detectedSubgenre.trim() : '';
  const rawParadigm = typeof parsed.detectedParadigm === 'string' ? parsed.detectedParadigm.trim().toLowerCase() : '';
  const detectedParadigm: NarrativeParadigm | undefined =
    VALID_PARADIGMS.has(rawParadigm as NarrativeParadigm) ? (rawParadigm as NarrativeParadigm) : undefined;

  const stripGenreLeak = (items: string[]): string[] => {
    const cleaned: string[] = [];
    for (const item of items) {
      const genreMatch = item.match(/Genre:\s*([^.\n]+?)(?:\.|$)/i);
      const subgenreMatch = item.match(/Subgenre:\s*([^.\n]+?)(?:\.|$)/i);
      if (genreMatch || subgenreMatch) {
        if (!detectedGenre && genreMatch) detectedGenre = genreMatch[1].trim();
        if (!detectedSubgenre && subgenreMatch) detectedSubgenre = subgenreMatch[1].trim();
        const stripped = item
          .replace(/Genre:\s*[^.\n]+?(?:\.|$)/i, '')
          .replace(/Subgenre:\s*[^.\n]+?(?:\.|$)/i, '')
          .trim();
        if (stripped.length > 10) cleaned.push(stripped);
        continue;
      }
      cleaned.push(item);
    }
    return cleaned;
  };

  const rawPatterns = Array.isArray(parsed.patterns)
    ? parsed.patterns.filter((p: unknown): p is string => typeof p === 'string')
    : [];
  const rawAntiPatterns = Array.isArray(parsed.antiPatterns)
    ? parsed.antiPatterns.filter((p: unknown): p is string => typeof p === 'string')
    : [];

  return {
    detectedParadigm,
    detectedGenre: detectedGenre || 'Unknown',
    detectedSubgenre: detectedSubgenre || 'Unknown',
    patterns: stripGenreLeak(rawPatterns),
    antiPatterns: stripGenreLeak(rawAntiPatterns),
  };
}
