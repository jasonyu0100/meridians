/**
 * Semantic Search Engine — two-pool architecture.
 *
 * Ranks scene summary embeddings and proposition embeddings independently,
 * takes the top-K of each pool, and surfaces availability metadata so the
 * UI can guide the user when a pool is unpopulated.
 */

import { generateEmbeddings, cosineSimilarity, resolveEmbedding } from './embeddings';
import type { NarrativeState, SearchQuery, SearchResult, EmbeddingRef, SearchAvailability } from '@/types/narrative';
import { SEARCH_TOP_K_SCENES, SEARCH_TOP_K_PROPOSITIONS } from '@/lib/constants';
import { resolveEntry, isScene } from '@/types/narrative';
import { logInfo } from '@/lib/core/system-logger';

type PoolItem = {
  type: 'proposition' | 'scene';
  sceneId: string;
  sceneIndex: number;
  arcId?: string;
  beatIndex?: number;
  propIndex?: number;
  content: string;
  embeddingRef: EmbeddingRef;
  context: string;
};

/**
 * Search narrative content semantically using embeddings.
 *
 * Uses two pools: scene summaries (thematic context) and beat propositions
 * (atomic facts). Beat centroids are intentionally omitted — summary and
 * proposition levels already cover the useful granularity.
 *
 * When a pool has no embeddings the result includes availability metadata
 * so the UI can point the user at the generate-embeddings / generate-plans
 * affordance rather than returning an opaque empty set.
 */
export async function searchNarrative(
  narrative: NarrativeState,
  resolvedKeys: string[],
  query: string,
): Promise<SearchQuery> {
  logInfo('Starting semantic search', {
    source: 'search',
    operation: 'search',
    details: { narrativeId: narrative.id, query: query.substring(0, 100), entryCount: resolvedKeys.length },
  });

  // ── Availability audit — measure coverage before searching ────────────
  let totalScenes = 0;
  let scenesWithSummaryEmbedding = 0;
  let scenesWithPlans = 0;
  let totalPropositions = 0;
  let propositionsWithEmbedding = 0;

  const sceneItems: PoolItem[] = [];
  const propositionItems: PoolItem[] = [];

  for (let entryIndex = 0; entryIndex < resolvedKeys.length; entryIndex++) {
    const key = resolvedKeys[entryIndex];
    const entry = resolveEntry(narrative, key);
    if (!entry || !isScene(entry)) continue;
    const scene = entry;
    totalScenes += 1;

    if (scene.summaryEmbedding) {
      scenesWithSummaryEmbedding += 1;
      sceneItems.push({
        type: 'scene',
        sceneId: scene.id,
        sceneIndex: entryIndex,
        arcId: scene.arcId,
        content: scene.summary,
        embeddingRef: scene.summaryEmbedding,
        context: scene.summary,
      });
    }

    const latestPlan = scene.planVersions?.[scene.planVersions.length - 1]?.plan;
    if (!latestPlan) continue;
    scenesWithPlans += 1;

    for (let beatIndex = 0; beatIndex < latestPlan.beats.length; beatIndex++) {
      const beat = latestPlan.beats[beatIndex];
      for (let propIndex = 0; propIndex < beat.propositions.length; propIndex++) {
        const prop = beat.propositions[propIndex];
        totalPropositions += 1;
        if (!prop.embedding) continue;
        propositionsWithEmbedding += 1;
        propositionItems.push({
          type: 'proposition',
          sceneId: scene.id,
          sceneIndex: entryIndex,
          arcId: scene.arcId,
          beatIndex,
          propIndex,
          content: prop.content,
          embeddingRef: prop.embedding,
          context: `${beat.what} → ${prop.content}`,
        });
      }
    }
  }

  const availability: SearchAvailability = {
    totalScenes,
    scenesWithSummaryEmbedding,
    scenesWithPlans,
    totalPropositions,
    propositionsWithEmbedding,
    summaryEmbeddingsReady: scenesWithSummaryEmbedding > 0,
    propositionsReady: propositionsWithEmbedding > 0,
  };

  // Propositions are the primary RAG signal — search is proposition-first,
  // scene summaries are supplementary context. Without a proposition bank
  // (i.e. plans generated and embedded) vector search cannot function,
  // even if every scene has a summary embedding. Short-circuit here and
  // let the UI surface the availability payload to prompt plan generation.
  if (!availability.propositionsReady) {
    logInfo('Search unavailable: no proposition embeddings (plans not generated)', {
      source: 'search',
      operation: 'search-unavailable',
      details: { narrativeId: narrative.id, ...availability },
    });
    return emptyResult(query, [], resolvedKeys.length, availability);
  }

  // Generate query embedding only when there is at least one pool to search.
  const embeddings = await generateEmbeddings([query], narrative.id);
  const queryEmbedding = embeddings[0];

  // ── Resolve embeddings for both pools in one batch ───────────────────
  const allItems = [...sceneItems, ...propositionItems];
  const resolvedEmbeddings = await Promise.all(
    allItems.map((item) => resolveEmbedding(item.embeddingRef)),
  );

  const scoredScenes: Array<PoolItem & { similarity: number }> = [];
  const scoredPropositions: Array<PoolItem & { similarity: number }> = [];
  for (let i = 0; i < allItems.length; i++) {
    const embedding = resolvedEmbeddings[i];
    if (!embedding) continue;
    const item = allItems[i];
    const scored = { ...item, similarity: cosineSimilarity(queryEmbedding, embedding) };
    if (item.type === 'scene') scoredScenes.push(scored);
    else scoredPropositions.push(scored);
  }

  // ── Take top-K of each pool independently ────────────────────────────
  const toResult = (item: PoolItem & { similarity: number }): SearchResult => ({
    type: item.type,
    id: `${item.sceneId}-${item.beatIndex ?? 'scene'}-${item.propIndex ?? ''}`,
    sceneId: item.sceneId,
    beatIndex: item.beatIndex,
    propIndex: item.propIndex,
    content: item.content,
    similarity: item.similarity,
    context: item.context,
  });

  const sceneResults = scoredScenes
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, SEARCH_TOP_K_SCENES)
    .map(toResult);
  const detailResults = scoredPropositions
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, SEARCH_TOP_K_PROPOSITIONS)
    .map(toResult);
  const results = [...sceneResults, ...detailResults].sort((a, b) => b.similarity - a.similarity);

  // ── Timelines — one heat value per resolved entry ────────────────────
  const sceneSimilarityMap = new Map<number, number>();
  for (const item of scoredScenes) sceneSimilarityMap.set(item.sceneIndex, item.similarity);
  const sceneTimeline = Array.from({ length: resolvedKeys.length }, (_, i) => ({
    sceneIndex: i,
    similarity: sceneSimilarityMap.get(i) ?? 0,
  }));

  const detailMaxSimilarity = new Map<number, number>();
  for (const item of scoredPropositions) {
    const current = detailMaxSimilarity.get(item.sceneIndex) ?? 0;
    if (item.similarity > current) detailMaxSimilarity.set(item.sceneIndex, item.similarity);
  }
  const detailTimeline = Array.from({ length: resolvedKeys.length }, (_, i) => ({
    sceneIndex: i,
    maxSimilarity: detailMaxSimilarity.get(i) ?? 0,
  }));

  // ── Top arc (highest average similarity across both pools) ───────────
  const arcSimilarities = new Map<string, { sum: number; count: number }>();
  for (const item of [...scoredScenes, ...scoredPropositions]) {
    if (!item.arcId) continue;
    const current = arcSimilarities.get(item.arcId) ?? { sum: 0, count: 0 };
    arcSimilarities.set(item.arcId, {
      sum: current.sum + item.similarity,
      count: current.count + 1,
    });
  }
  let topArc: { arcId: string; avgSimilarity: number } | null = null;
  for (const [arcId, { sum, count }] of arcSimilarities) {
    const avgSimilarity = sum / count;
    if (!topArc || avgSimilarity > topArc.avgSimilarity) {
      topArc = { arcId, avgSimilarity };
    }
  }

  const topScene = scoredScenes.length > 0
    ? { sceneId: scoredScenes[0].sceneId, similarity: scoredScenes[0].similarity }
    : null;

  logInfo('Completed semantic search', {
    source: 'search',
    operation: 'search-complete',
    details: {
      narrativeId: narrative.id,
      query: query.substring(0, 100),
      sceneResults: sceneResults.length,
      detailResults: detailResults.length,
      topScore: results[0]?.similarity ?? 0,
    },
  });

  return {
    query,
    embedding: queryEmbedding,
    results,
    sceneResults,
    detailResults,
    sceneTimeline,
    detailTimeline,
    topArc,
    topScene,
    availability,
  };
}

function emptyResult(
  query: string,
  embedding: number[],
  resolvedLength: number,
  availability: SearchAvailability,
): SearchQuery {
  return {
    query,
    embedding,
    results: [],
    sceneResults: [],
    detailResults: [],
    sceneTimeline: Array.from({ length: resolvedLength }, (_, i) => ({
      sceneIndex: i,
      similarity: 0,
    })),
    detailTimeline: Array.from({ length: resolvedLength }, (_, i) => ({
      sceneIndex: i,
      maxSimilarity: 0,
    })),
    topArc: null,
    topScene: null,
    availability,
  };
}
