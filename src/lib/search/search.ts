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
  type: 'proposition' | 'scene' | 'question';
  sceneId: string;
  sceneIndex: number;
  arcId?: string;
  beatIndex?: number;
  propIndex?: number;
  /** LearningQuestion id — only set for question pool items. */
  questionId?: string;
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
/**
 * Audit search coverage for a branch and collect the rankable pools, in one
 * synchronous pass (no embeddings, no network). `searchNarrative` uses this to
 * decide whether to run; the UI uses `auditSearchAvailability` (the lightweight
 * wrapper below) to drive the vector-search toggle's enabled/disabled state
 * without paying for a query embedding.
 */
function collectSearchPools(
  narrative: NarrativeState,
  resolvedKeys: string[],
): {
  availability: SearchAvailability;
  sceneItems: PoolItem[];
  propositionItems: PoolItem[];
  questionItems: PoolItem[];
} {
  let totalScenes = 0;
  let scenesWithSummaryEmbedding = 0;
  let scenesWithPlans = 0;
  let totalPropositions = 0;
  let propositionsWithEmbedding = 0;
  let totalQuestions = 0;
  let questionsWithEmbedding = 0;
  let scenesWithQuestions = 0;

  const sceneItems: PoolItem[] = [];
  const propositionItems: PoolItem[] = [];
  const questionItems: PoolItem[] = [];

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

    // ── Question pool (Expert search) ──────────────────────────────────────
    const questions = scene.questions ?? [];
    if (questions.length > 0) scenesWithQuestions += 1;
    for (const q of questions) {
      totalQuestions += 1;
      if (!q.embedding) continue;
      questionsWithEmbedding += 1;
      const answer = q.options[q.correctIndex] ?? '';
      questionItems.push({
        type: 'question',
        sceneId: scene.id,
        sceneIndex: entryIndex,
        arcId: scene.arcId,
        questionId: q.id,
        content: q.prompt,
        embeddingRef: q.embedding,
        context: `Q: ${q.prompt} · A: ${answer}${q.explanation ? ` · ${q.explanation}` : ''}`,
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
    allScenesPlanned: totalScenes > 0 && scenesWithPlans === totalScenes,
    totalQuestions,
    questionsWithEmbedding,
    scenesWithQuestions,
    questionsReady: questionsWithEmbedding > 0,
    allScenesHaveQuestions: totalScenes > 0 && scenesWithQuestions === totalScenes,
    allQuestionsEmbedded: totalQuestions > 0 && questionsWithEmbedding === totalQuestions,
  };

  return { availability, sceneItems, propositionItems, questionItems };
}

/**
 * Synchronous coverage audit for the vector-search toggle. Returns the same
 * availability payload `searchNarrative` computes — `allScenesPlanned &&
 * propositionsReady` is the gate for vector search being usable on this branch.
 */
export function auditSearchAvailability(
  narrative: NarrativeState,
  resolvedKeys: string[],
): SearchAvailability {
  return collectSearchPools(narrative, resolvedKeys).availability;
}

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

  // ── Availability audit + pool collection (one synchronous pass) ───────
  const { availability, sceneItems, propositionItems } = collectSearchPools(
    narrative,
    resolvedKeys,
  );

  // Vector search is proposition-first: the top-K propositions are the
  // primary RAG signal, scene summaries are supplementary. Two conditions
  // must hold for it to produce an unbiased result:
  //   1. every scene on the branch has a plan (allScenesPlanned) — otherwise
  //      retrieval can only ever surface the planned subset, silently hiding
  //      the rest of the branch;
  //   2. that plan's propositions are embedded (propositionsReady).
  // When either fails we short-circuit and hand the availability payload back
  // so the UI can warn the user and fall back to a narrative-context search.
  if (!availability.allScenesPlanned || !availability.propositionsReady) {
    logInfo('Vector search unavailable: not all scenes planned/embedded', {
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

/**
 * Expert search — embedding RAG over the curriculum question bank.
 *
 * Ranks the branch's learning questions by similarity to the query, takes the
 * top-K, and hands their verified answers + explanations to the synthesis as
 * grounding. Unlike vector search (which retrieves atomic propositions), this
 * retrieves *teachable units* — each matched question carries a curated answer.
 *
 * Gated on `allScenesHaveQuestions && allQuestionsEmbedded`: the expert's
 * "area of expertise" must cover the whole branch and be fully embedded, or
 * retrieval silently hides the un-questioned / un-embedded scenes. When the
 * gate fails we hand the availability payload back so the UI can guide the user.
 */
export async function searchExpert(
  narrative: NarrativeState,
  resolvedKeys: string[],
  query: string,
): Promise<SearchQuery> {
  logInfo('Starting expert search', {
    source: 'search',
    operation: 'search-expert',
    details: { narrativeId: narrative.id, query: query.substring(0, 100), entryCount: resolvedKeys.length },
  });

  const { availability, questionItems } = collectSearchPools(narrative, resolvedKeys);

  if (!availability.allScenesHaveQuestions || !availability.allQuestionsEmbedded) {
    logInfo('Expert search unavailable: incomplete question coverage/embedding', {
      source: 'search',
      operation: 'search-expert-unavailable',
      details: { narrativeId: narrative.id, ...availability },
    });
    return emptyResult(query, [], resolvedKeys.length, availability, 'expert');
  }

  const embeddings = await generateEmbeddings([query], narrative.id);
  const queryEmbedding = embeddings[0];

  const resolvedEmbeddings = await Promise.all(
    questionItems.map((item) => resolveEmbedding(item.embeddingRef)),
  );

  const scored: Array<PoolItem & { similarity: number }> = [];
  for (let i = 0; i < questionItems.length; i++) {
    const embedding = resolvedEmbeddings[i];
    if (!embedding) continue;
    scored.push({ ...questionItems[i], similarity: cosineSimilarity(queryEmbedding, embedding) });
  }

  const toResult = (item: PoolItem & { similarity: number }): SearchResult => ({
    type: 'question',
    id: item.questionId ?? `${item.sceneId}-q`,
    sceneId: item.sceneId,
    questionId: item.questionId,
    content: item.content,
    similarity: item.similarity,
    context: item.context,
  });

  const detailResults = scored
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, SEARCH_TOP_K_PROPOSITIONS)
    .map(toResult);
  const results = [...detailResults];

  // ── Timeline — one heat value per resolved entry, from question origins ──
  const maxByScene = new Map<number, number>();
  for (const item of scored) {
    const current = maxByScene.get(item.sceneIndex) ?? 0;
    if (item.similarity > current) maxByScene.set(item.sceneIndex, item.similarity);
  }
  const sceneTimeline = Array.from({ length: resolvedKeys.length }, (_, i) => ({
    sceneIndex: i,
    similarity: maxByScene.get(i) ?? 0,
  }));
  const detailTimeline = Array.from({ length: resolvedKeys.length }, (_, i) => ({
    sceneIndex: i,
    maxSimilarity: maxByScene.get(i) ?? 0,
  }));

  // ── Top arc (highest average question similarity) ────────────────────────
  const arcSimilarities = new Map<string, { sum: number; count: number }>();
  for (const item of scored) {
    if (!item.arcId) continue;
    const current = arcSimilarities.get(item.arcId) ?? { sum: 0, count: 0 };
    arcSimilarities.set(item.arcId, { sum: current.sum + item.similarity, count: current.count + 1 });
  }
  let topArc: { arcId: string; avgSimilarity: number } | null = null;
  for (const [arcId, { sum, count }] of arcSimilarities) {
    const avgSimilarity = sum / count;
    if (!topArc || avgSimilarity > topArc.avgSimilarity) topArc = { arcId, avgSimilarity };
  }

  const topScene = detailResults.length > 0
    ? { sceneId: detailResults[0].sceneId, similarity: detailResults[0].similarity }
    : null;

  logInfo('Completed expert search', {
    source: 'search',
    operation: 'search-expert-complete',
    details: {
      narrativeId: narrative.id,
      query: query.substring(0, 100),
      questionResults: detailResults.length,
      topScore: detailResults[0]?.similarity ?? 0,
    },
  });

  return {
    query,
    mode: 'expert',
    embedding: queryEmbedding,
    results,
    sceneResults: [],
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
  mode?: SearchQuery['mode'],
): SearchQuery {
  return {
    query,
    mode,
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
