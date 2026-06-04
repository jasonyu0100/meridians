/**
 * Plan Candidates - Generate multiple candidate plans and rank by semantic similarity
 * Embeddings are only persisted for the winning candidate.
 */

import { generateScenePlan } from './scenes';
import { cosineSimilarity, computeCentroid, generateEmbeddings, embedPropositions, resolveEmbedding } from '@/lib/search/embeddings';
import { assetManager } from '@/lib/storage/asset-manager';
import type { NarrativeState, Scene, PlanCandidates, PlanCandidate } from '@/types/narrative';
import { PLAN_CANDIDATES_COUNT } from '@/lib/constants';
import { logInfo } from '@/lib/core/system-logger';

/**
 * Run plan candidates: generate k candidate plans and rank by similarity to scene summary.
 * Plans are generated without embeddings. All proposition texts are embedded in a single
 * batch for scoring, but only the winning candidate's embeddings are persisted to IndexedDB.
 */
export async function runPlanCandidates(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  candidateCount = PLAN_CANDIDATES_COUNT,
  onProgress?: (completed: number, total: number) => void,
): Promise<PlanCandidates> {
  logInfo('Starting plan candidates', {
    source: 'plan-generation',
    operation: 'candidates',
    details: { sceneId: scene.id, candidateCount },
  });

  // Generate scene summary embedding if not present
  if (!scene.summaryEmbedding) {
    const embeddings = await generateEmbeddings([scene.summary], narrative.id);
    scene.summaryEmbedding = await assetManager.storeEmbedding(embeddings[0], 'text-embedding-3-small');
  }

  const sceneSummaryEmbedding = await resolveEmbedding(scene.summaryEmbedding);
  if (!sceneSummaryEmbedding) {
    throw new Error('Failed to resolve scene summary embedding');
  }

  // Generate k candidate plans in parallel — skip embeddings, they're generated later
  const promises = Array.from({ length: candidateCount }, (_, i) =>
    generateScenePlan(
      narrative,
      scene,
      resolvedKeys,
      undefined,
      undefined,
      `Candidate ${i + 1}: Vary beat ordering, density, and proposition distribution for diversity.`,
      true, // skipEmbeddings
    )
  );

  const candidatePlans = await Promise.all(promises);
  onProgress?.(candidateCount, candidateCount);

  // Collect ALL proposition texts across all candidates for a single batch embed
  const allTexts: string[] = [];
  const candidateOffsets: { start: number; count: number }[] = [];
  for (const plan of candidatePlans) {
    const start = allTexts.length;
    for (const beat of plan.beats) {
      for (const prop of beat.propositions) {
        allTexts.push(prop.content);
      }
    }
    candidateOffsets.push({ start, count: allTexts.length - start });
  }

  // Single batch embed — vectors held in memory, not stored
  const allVectors = allTexts.length > 0
    ? await generateEmbeddings(allTexts, narrative.id)
    : [];

  // Score each candidate by centroid similarity to scene summary
  const candidates: PlanCandidate[] = candidatePlans.map((plan, index) => {
    const { start, count } = candidateOffsets[index];
    const vectors = allVectors.slice(start, start + count);

    // Compute per-beat centroids and overall plan centroid
    let vecIdx = 0;
    const beatCentroids: number[][] = [];
    const beatScores: { beatIndex: number; score: number }[] = [];

    for (let bi = 0; bi < plan.beats.length; bi++) {
      const beatVecs: number[][] = [];
      for (let pi = 0; pi < plan.beats[bi].propositions.length; pi++) {
        beatVecs.push(vectors[vecIdx++]);
      }
      if (beatVecs.length > 0) {
        const bc = computeCentroid(beatVecs);
        beatCentroids.push(bc);
        beatScores.push({ beatIndex: bi, score: cosineSimilarity(bc, sceneSummaryEmbedding) });
      } else {
        beatScores.push({ beatIndex: bi, score: 0 });
      }
    }

    const centroid = beatCentroids.length > 0 ? computeCentroid(beatCentroids) : [];
    const similarityScore = centroid.length > 0
      ? cosineSimilarity(centroid, sceneSummaryEmbedding)
      : 0;

    return {
      id: `candidate-${index}`,
      plan,
      centroid,
      similarityScore,
      beatScores,
      timestamp: Date.now(),
    };
  });

  // Sort by similarity score descending
  candidates.sort((a, b) => b.similarityScore - a.similarityScore);
  const winner = candidates[0]?.id ?? '';

  // Persist embeddings only for the winning candidate
  const winnerCandidate = candidates.find(c => c.id === winner);
  if (winnerCandidate) {
    const winnerIndex = candidatePlans.indexOf(winnerCandidate.plan);
    const { start } = candidateOffsets[winnerIndex];
    let vecIdx = 0;
    for (const beat of winnerCandidate.plan.beats) {
      const beatEmbeddings: number[][] = [];
      for (let pi = 0; pi < beat.propositions.length; pi++) {
        const vector = allVectors[start + vecIdx++];
        const embId = await assetManager.storeEmbedding(vector, 'text-embedding-3-small');
        beat.propositions[pi] = {
          ...beat.propositions[pi],
          embedding: embId,
          embeddedAt: Date.now(),
          embeddingModel: 'text-embedding-3-small',
        };
        beatEmbeddings.push(vector);
      }
      if (beatEmbeddings.length > 0) {
        const centroid = computeCentroid(beatEmbeddings);
        beat.embeddingCentroid = await assetManager.storeEmbedding(centroid, 'text-embedding-3-small');
      }
    }
  }

  logInfo('Completed plan candidates', {
    source: 'plan-generation',
    operation: 'candidates-complete',
    details: {
      sceneId: scene.id,
      candidateCount: candidates.length,
      winnerScore: candidates[0]?.similarityScore ?? 0,
      averageScore: candidates.reduce((sum, c) => sum + c.similarityScore, 0) / candidates.length,
    },
  });

  return {
    sceneId: scene.id,
    candidates,
    winner,
    createdAt: Date.now(),
  };
}
