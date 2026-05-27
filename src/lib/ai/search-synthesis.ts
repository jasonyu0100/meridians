/**
 * AI Search Synthesis — proposition-primary RAG with scene-aggregate context.
 *
 * RAG is driven by the top-K propositions. For high-level context the
 * synthesis also receives (a) the summaries of scenes that the top
 * propositions come from (aggregate scene membership — "where do these
 * propositions live?") and (b) the top-K scene summaries ranked by direct
 * similarity to the query (supplementary thematic context).
 */

import { callGenerateStream, resolveReasoningBudget, resolveWebsearch } from './api';
import { DEFAULT_MODEL } from '../constants';
import { logInfo, logError } from '../system-logger';
import { buildSearchSynthesisPrompt } from '@/lib/prompts/search';
import { buildSearchSynthesisSystem, workIdentityFor } from '@/lib/prompts/paradigm-analyst';
import type { NarrativeState, SearchResult, SearchSynthesis } from '@/types/narrative';

type AggregateScene = {
  sceneId: string;
  summary: string;
  propositionCount: number;
  maxPropSimilarity: number;
};

/** Aggregate scenes from proposition results. Sorted by proposition density,
 *  then max similarity — scenes with the most relevant propositions come first. */
function aggregateScenesFromPropositions(
  propositionResults: SearchResult[],
  narrative: NarrativeState,
): AggregateScene[] {
  const bySceneId = new Map<string, { count: number; maxSim: number }>();
  for (const p of propositionResults) {
    const current = bySceneId.get(p.sceneId) ?? { count: 0, maxSim: 0 };
    bySceneId.set(p.sceneId, {
      count: current.count + 1,
      maxSim: Math.max(current.maxSim, p.similarity),
    });
  }
  const out: AggregateScene[] = [];
  for (const [sceneId, { count, maxSim }] of bySceneId) {
    const scene = narrative.scenes[sceneId];
    if (!scene) continue;
    out.push({
      sceneId,
      summary: scene.summary,
      propositionCount: count,
      maxPropSimilarity: maxSim,
    });
  }
  return out.sort((a, b) => {
    if (b.propositionCount !== a.propositionCount) return b.propositionCount - a.propositionCount;
    return b.maxPropSimilarity - a.maxPropSimilarity;
  });
}

function buildSearchContext(
  query: string,
  propositionResults: SearchResult[],
  aggregateScenes: AggregateScene[],
  directSceneResults: SearchResult[],
  topArc: { arcId: string; avgSimilarity: number } | null,
  timeline: Array<{ sceneIndex: number; maxSimilarity: number }>,
  narrative: NarrativeState,
): { context: string; citationIndex: SearchResult[] } {
  let context = `═══ SEARCH QUERY ═══\n"${query}"\n\n`;

  // Citation index is the flat list the synthesis cites against. Propositions
  // come first (primary signal), then direct scene matches. Aggregate scenes
  // are rendered as context but don't get their own citation numbers — they
  // annotate where the propositions live.
  const citationIndex: SearchResult[] = [...propositionResults, ...directSceneResults];

  // ── Primary: top propositions ─────────────────────────────────────────
  context += `═══ TOP ${propositionResults.length} PROPOSITIONS (primary RAG signal) ═══\n`;
  propositionResults.forEach((p, i) => {
    context += `[${i + 1}] PROPOSITION — ${(p.similarity * 100).toFixed(1)}% match\n`;
    context += `    Content: ${p.content}\n`;
    context += `    Context: ${p.context}\n`;
    context += `    Scene: ${p.sceneId}\n`;
    if (p.beatIndex !== undefined) context += `    Beat: ${p.beatIndex + 1}\n`;
    context += `\n`;
  });

  // ── Aggregate scene membership — where the top propositions live ──────
  if (aggregateScenes.length > 0) {
    context += `═══ AGGREGATE SCENE MEMBERSHIP (scenes containing the top propositions above) ═══\n`;
    aggregateScenes.forEach((s) => {
      context += `  • ${s.sceneId} — ${s.propositionCount} relevant proposition${s.propositionCount !== 1 ? 's' : ''}, top match ${(s.maxPropSimilarity * 100).toFixed(1)}%\n`;
      context += `    Summary: ${s.summary}\n\n`;
    });
  }

  // ── Supplementary: direct scene-summary matches ───────────────────────
  if (directSceneResults.length > 0) {
    const offset = propositionResults.length;
    context += `═══ TOP ${directSceneResults.length} SCENE SUMMARIES (direct match on summary embeddings, supplementary thematic context) ═══\n`;
    directSceneResults.forEach((s, i) => {
      context += `[${offset + i + 1}] SCENE SUMMARY — ${(s.similarity * 100).toFixed(1)}% match\n`;
      context += `    Summary: ${s.content}\n`;
      context += `    Scene: ${s.sceneId}\n\n`;
    });
  }

  if (topArc) {
    const arc = narrative.arcs[topArc.arcId];
    if (arc) {
      context += `═══ TOP ARC ═══\n`;
      context += `Arc: "${arc.name}" (${(topArc.avgSimilarity * 100).toFixed(1)}% avg relevance, ${arc.sceneIds.length} scenes)\n\n`;
    }
  }

  if (timeline.length > 0) {
    const peaks = timeline
      .filter((p) => p.maxSimilarity > 0.7)
      .sort((a, b) => b.maxSimilarity - a.maxSimilarity)
      .slice(0, 5);
    if (peaks.length > 0) {
      context += `═══ TIMELINE PATTERN ═══\n`;
      context += `Peak matches at scenes: ${peaks.map((p) => `${p.sceneIndex + 1} (${(p.maxSimilarity * 100).toFixed(0)}%)`).join(', ')}\n`;
      const highRelevanceCount = timeline.filter((p) => p.maxSimilarity > 0.6).length;
      context += `High-relevance scenes: ${highRelevanceCount} out of ${timeline.length}\n`;
    }
  }

  return { context, citationIndex };
}

/**
 * Synthesize search results into an AI overview with inline citations.
 *
 * Proposition-primary: the top-K propositions drive the answer. Scene
 * context enters two ways — aggregate scene summaries (for scenes the top
 * propositions live in) and direct scene-summary matches (for thematic
 * context the propositions may not cover).
 */
export async function synthesizeSearchResults(
  narrative: NarrativeState,
  query: string,
  sceneResults: SearchResult[],
  detailResults: SearchResult[],
  topArc: { arcId: string; avgSimilarity: number } | null,
  _topScene: { sceneId: string; similarity: number } | null,
  timeline: Array<{ sceneIndex: number; maxSimilarity: number }>,
  onToken?: (token: string) => void,
): Promise<SearchSynthesis> {
  const propositionResults = detailResults.filter((r) => r.type === 'proposition');
  const aggregateScenes = aggregateScenesFromPropositions(propositionResults, narrative);

  const { context, citationIndex } = buildSearchContext(
    query,
    propositionResults,
    aggregateScenes,
    sceneResults,
    topArc,
    timeline,
    narrative,
  );

  logInfo('Starting search synthesis', {
    source: 'search',
    operation: 'synthesize-search',
    details: {
      query: query.substring(0, 100),
      propCount: propositionResults.length,
      aggregateSceneCount: aggregateScenes.length,
      directSceneCount: sceneResults.length,
    },
  });

  const prompt = buildSearchSynthesisPrompt({
    context,
    query,
    propositionCount: propositionResults.length,
    aggregateSceneCount: aggregateScenes.length,
    directSceneCount: sceneResults.length,
  });

  let accumulatedText = '';

  try {
    await callGenerateStream(
      prompt,
      buildSearchSynthesisSystem(workIdentityFor(narrative)),
      (token) => {
        accumulatedText += token;
        if (onToken) onToken(token);
      },
      2048,
      'synthesizeSearchResults',
      DEFAULT_MODEL,
      resolveReasoningBudget(narrative),
      undefined,
      0.3,
      resolveWebsearch(narrative),
    );

    const citationMatches = accumulatedText.match(/\[(\d+)\]/g) || [];
    const citationIds = Array.from(
      new Set(citationMatches.map((match) => parseInt(match.replace(/\[|\]/g, ''), 10))),
    ).sort((a, b) => a - b);

    const citations = citationIds
      .filter((id) => id >= 1 && id <= citationIndex.length)
      .map((id) => {
        const result = citationIndex[id - 1];
        return {
          id,
          sceneId: result.sceneId,
          type: result.type,
          title: result.content.length > 60 ? result.content.substring(0, 57) + '...' : result.content,
          similarity: result.similarity,
        };
      });

    const overview = accumulatedText.trim();

    logInfo('Search synthesis completed', {
      source: 'search',
      operation: 'synthesize-search-complete',
      details: {
        query: query.substring(0, 100),
        overviewLength: overview.length,
        citationCount: citations.length,
      },
    });

    return { overview, citations };
  } catch (error) {
    logError('Search synthesis failed', error, {
      source: 'search',
      operation: 'synthesize-search-error',
      details: { query: query.substring(0, 100) },
    });

    const fallback = citationIndex[0];
    return {
      overview: `Found ${propositionResults.length} proposition${propositionResults.length === 1 ? '' : 's'} and ${sceneResults.length} scene summar${sceneResults.length === 1 ? 'y' : 'ies'} matching "${query}". ${
        topArc ? `Arc "${narrative.arcs[topArc.arcId]?.name}" is most relevant. ` : ''
      }${fallback ? `Top match: ${fallback.content.substring(0, 100)}...` : 'Try refining your search query.'}`,
      citations: citationIndex.slice(0, 3).map((result, idx) => ({
        id: idx + 1,
        sceneId: result.sceneId,
        type: result.type,
        title: result.content.substring(0, 60),
        similarity: result.similarity,
      })),
    };
  }
}
