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
import { logInfo, logError } from '@/lib/core/system-logger';
import {
  buildSearchSynthesisPrompt,
  buildNarrativeContextSearchPrompt,
  buildExpertSearchPrompt,
} from '@/lib/prompts/search';
import {
  buildSearchSynthesisSystem,
  buildExpertSearchSystem,
  workIdentityFor,
} from '@/lib/prompts/paradigm';
import { resolveEntityRef } from '@/lib/forces/entity-ref';
import { topicPath } from '@/lib/learning/curriculum';
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

/**
 * Render the retrieved evidence as internal grounding. No citation markers —
 * attribution is to database entities (see entity roster), not to numbered
 * propositions. The evidence locates WHAT is relevant to the query; the model
 * cites the entities involved, not these rows.
 */
function buildSearchContext(
  propositionResults: SearchResult[],
  aggregateScenes: AggregateScene[],
  directSceneResults: SearchResult[],
  topArc: { arcId: string; avgSimilarity: number } | null,
  narrative: NarrativeState,
): string {
  let context = '';

  // ── Primary: top propositions ─────────────────────────────────────────
  if (propositionResults.length > 0) {
    context += `TOP PROPOSITIONS (primary signal — atomic facts most relevant to the query):\n`;
    propositionResults.forEach((p) => {
      context += `  • [${(p.similarity * 100).toFixed(0)}%] ${p.content}`;
      context += ` (scene ${p.sceneId}${p.beatIndex !== undefined ? `, beat ${p.beatIndex + 1}` : ''})\n`;
    });
    context += `\n`;
  }

  // ── Aggregate scene membership — where the top propositions live ──────
  if (aggregateScenes.length > 0) {
    context += `SCENES THE TOP PROPOSITIONS LIVE IN:\n`;
    aggregateScenes.forEach((s) => {
      context += `  • [${s.sceneId}] ${s.summary} (${s.propositionCount} relevant proposition${s.propositionCount !== 1 ? 's' : ''}, top ${(s.maxPropSimilarity * 100).toFixed(0)}%)\n`;
    });
    context += `\n`;
  }

  // ── Supplementary: direct scene-summary matches ───────────────────────
  if (directSceneResults.length > 0) {
    context += `SCENE SUMMARIES (direct thematic match, supplementary):\n`;
    directSceneResults.forEach((s) => {
      context += `  • [${(s.similarity * 100).toFixed(0)}%] [${s.sceneId}] ${s.content}\n`;
    });
    context += `\n`;
  }

  if (topArc) {
    const arc = narrative.arcs[topArc.arcId];
    if (arc) {
      context += `MOST RELEVANT ARC: "${arc.name}" (${(topArc.avgSimilarity * 100).toFixed(0)}% avg relevance, ${arc.sceneIds.length} scenes)\n`;
    }
  }

  return context.trim();
}

/**
 * Render the citable database entities involved in the matched scenes, each
 * with its exact id, so the model can attribute claims chat-style. Reuses
 * `resolveEntityRef` for labels so roster entries match the rendered chips.
 */
function buildEntityRosterForScenes(
  narrative: NarrativeState,
  sceneIds: string[],
): string {
  const ids = new Set<string>();
  for (const sid of sceneIds) {
    const scene = narrative.scenes[sid];
    if (!scene) continue;
    ids.add(scene.id);
    if (scene.povId) ids.add(scene.povId);
    for (const p of scene.participantIds ?? []) ids.add(p);
    if (scene.locationId) ids.add(scene.locationId);
    for (const td of scene.threadDeltas ?? []) ids.add(td.threadId);
    for (const wd of scene.worldDeltas ?? []) if (wd.entityId) ids.add(wd.entityId);
  }
  // Group by kind for a clean roster, scenes last (they have long labels).
  const order: Record<string, number> = { Character: 0, Location: 1, Artifact: 2, Thread: 3, Arc: 4, Scene: 5 };
  const lines = [...ids]
    .map((id) => resolveEntityRef(narrative, id))
    .filter((info): info is NonNullable<typeof info> => !!info)
    .sort((a, b) => (order[a.typeLabel] ?? 9) - (order[b.typeLabel] ?? 9))
    .map((info) => {
      const detail = info.detail ? ` — ${info.detail}` : '';
      return `  [${info.id}] ${info.typeLabel}: ${info.label}${detail}`;
    });
  return lines.join('\n');
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
  _timeline: Array<{ sceneIndex: number; maxSimilarity: number }>,
  onToken?: (token: string) => void,
): Promise<SearchSynthesis> {
  const propositionResults = detailResults.filter((r) => r.type === 'proposition');
  const aggregateScenes = aggregateScenesFromPropositions(propositionResults, narrative);

  const context = buildSearchContext(
    propositionResults,
    aggregateScenes,
    sceneResults,
    topArc,
    narrative,
  );

  // Citable entities are drawn from the union of matched scenes — propositions
  // and direct scene hits — so the model can attribute claims to the database
  // entities that actually appear there.
  const matchedSceneIds = Array.from(
    new Set([...sceneResults, ...detailResults].map((r) => r.sceneId)),
  );
  const entityRoster = buildEntityRosterForScenes(narrative, matchedSceneIds);

  logInfo('Starting search synthesis', {
    source: 'search',
    operation: 'synthesize-search',
    details: {
      query: query.substring(0, 100),
      propCount: propositionResults.length,
      aggregateSceneCount: aggregateScenes.length,
      directSceneCount: sceneResults.length,
      rosterScenes: matchedSceneIds.length,
    },
  });

  const prompt = buildSearchSynthesisPrompt({ context, entityRoster, query });

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

    const overview = accumulatedText.trim();

    logInfo('Search synthesis completed', {
      source: 'search',
      operation: 'synthesize-search-complete',
      details: { query: query.substring(0, 100), overviewLength: overview.length },
    });

    // Attribution is rendered from the entity-ref citations in `overview` at
    // display time; no structured citation index is returned.
    return { overview, citations: [] };
  } catch (error) {
    logError('Search synthesis failed', error, {
      source: 'search',
      operation: 'synthesize-search-error',
      details: { query: query.substring(0, 100) },
    });

    const topProp = propositionResults[0];
    return {
      overview: `Found ${propositionResults.length} proposition${propositionResults.length === 1 ? '' : 's'} and ${sceneResults.length} scene summar${sceneResults.length === 1 ? 'y' : 'ies'} matching "${query}". ${
        topArc ? `Arc "${narrative.arcs[topArc.arcId]?.name}" is most relevant. ` : ''
      }${topProp ? `Top match: ${topProp.content.substring(0, 100)}...` : 'Try refining your search query.'}`,
      citations: [],
    };
  }
}

/**
 * Build the verified-curriculum grounding + citable-entities roster for expert
 * synthesis. The grounding renders each matched question as a Q→A pair carrying
 * its question id and topic id; the roster lists the distinct topics and
 * questions (with ids + labels) the model may cite, so its inline citations
 * resolve 1:1 against the reference list at display time.
 */
function buildExpertGrounding(
  questionResults: SearchResult[],
  narrative: NarrativeState,
): { context: string; citableEntities: string } {
  const topics = narrative.topics ?? {};
  const rows: string[] = [];
  const topicSim = new Map<string, { sum: number; count: number; name: string }>();
  const questionRoster: string[] = [];
  const seenQuestions = new Set<string>();

  for (const r of questionResults) {
    const scene = narrative.scenes[r.sceneId];
    const q = scene?.questions?.find((x) => x.id === r.questionId);
    if (!q) continue;
    const answer = q.options[q.correctIndex] ?? '';
    const topicLabel = q.topicId ? topicPath(topics, q.topicId) : 'Untopiced';
    const topicTag = q.topicId ? ` [${q.topicId}]` : '';
    rows.push(
      `  • [${(r.similarity * 100).toFixed(0)}%] [${q.id}] (Topic: ${topicLabel}${topicTag}) Q: ${q.prompt} → A: ${answer}` +
        (q.explanation ? `\n       Why: ${q.explanation}` : ''),
    );
    if (!seenQuestions.has(q.id)) {
      seenQuestions.add(q.id);
      questionRoster.push(`  [${q.id}] Question: ${q.prompt}`);
    }
    if (q.topicId) {
      const cur = topicSim.get(q.topicId) ?? { sum: 0, count: 0, name: topicLabel };
      topicSim.set(q.topicId, { sum: cur.sum + r.similarity, count: cur.count + 1, name: topicLabel });
    }
  }

  let context = '';
  if (rows.length > 0) {
    context += `VERIFIED CURRICULUM Q&A (primary signal — teachable units most relevant to the query, each with its curated answer):\n`;
    context += rows.join('\n');
    context += `\n`;
  }

  // Most-covered topic area (highest average similarity across matched questions)
  let topTopic: { id: string; name: string; avg: number } | null = null;
  for (const [id, { sum, count, name }] of topicSim) {
    const avg = sum / count;
    if (!topTopic || avg > topTopic.avg) topTopic = { id, name, avg };
  }
  if (topTopic) {
    context += `\nMOST RELEVANT TOPIC AREA: "${topTopic.name}" [${topTopic.id}] (${(topTopic.avg * 100).toFixed(0)}% avg relevance)\n`;
  }

  // Roster: topics first (the areas of expertise), then the matched questions.
  const topicRoster = [...topicSim].map(
    ([id, { name }]) => `  [${id}] Topic: ${name}`,
  );
  const citableEntities = [...topicRoster, ...questionRoster].join('\n');

  return { context: context.trim(), citableEntities };
}

/**
 * Expert search synthesis — answers from the curriculum question bank.
 *
 * The top-K matched questions (each with its verified answer + explanation)
 * are handed to the model as settled knowledge; it teaches the query from
 * them, attributing to topic areas by name. Distinct from vector synthesis:
 * the grounding is curated Q→A, not atomic propositions, and attribution is to
 * topics/questions (surfaced as a clickable reference list at display time),
 * not database entity-refs.
 */
export async function synthesizeExpertSearch(
  narrative: NarrativeState,
  query: string,
  questionResults: SearchResult[],
  onToken?: (token: string) => void,
): Promise<SearchSynthesis> {
  const { context, citableEntities } = buildExpertGrounding(questionResults, narrative);

  logInfo('Starting expert search synthesis', {
    source: 'search',
    operation: 'synthesize-expert',
    details: { query: query.substring(0, 100), questionCount: questionResults.length },
  });

  const prompt = buildExpertSearchPrompt({ context, citableEntities, query });
  let accumulatedText = '';

  try {
    await callGenerateStream(
      prompt,
      buildExpertSearchSystem(workIdentityFor(narrative)),
      (token) => {
        accumulatedText += token;
        if (onToken) onToken(token);
      },
      2048,
      'synthesizeExpertSearch',
      DEFAULT_MODEL,
      resolveReasoningBudget(narrative),
      undefined,
      0.3,
      resolveWebsearch(narrative),
    );

    logInfo('Expert search synthesis completed', {
      source: 'search',
      operation: 'synthesize-expert-complete',
      details: { query: query.substring(0, 100), overviewLength: accumulatedText.trim().length },
    });

    return { overview: accumulatedText.trim(), citations: [] };
  } catch (error) {
    logError('Expert search synthesis failed', error, {
      source: 'search',
      operation: 'synthesize-expert-error',
      details: { query: query.substring(0, 100) },
    });
    return {
      overview: `Unable to answer "${query}" from the curriculum. Please try again.`,
      citations: [],
    };
  }
}

/**
 * Fallback search synthesis — narrative-context search.
 *
 * Used when vector search is unavailable because not every scene on the
 * branch has a generated plan (no proposition bank to rank against). Rather
 * than embedding retrieval, the full branch continuity (`narrativeContext`)
 * is fed straight to the model, which answers the query from it. Slower and
 * more token-expensive than vector search, but works on any branch with no
 * embeddings. Returns no structured citations (there is no citation index);
 * the model references scenes / entities by name in prose.
 */
export async function synthesizeNarrativeContextSearch(
  narrative: NarrativeState,
  narrativeContextBlock: string,
  query: string,
  onToken?: (token: string) => void,
): Promise<SearchSynthesis> {
  const prompt = buildNarrativeContextSearchPrompt({ context: narrativeContextBlock, query });

  logInfo('Starting narrative-context search (vector fallback)', {
    source: 'search',
    operation: 'synthesize-context-search',
    details: { query: query.substring(0, 100), contextLength: narrativeContextBlock.length },
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
      'synthesizeNarrativeContextSearch',
      DEFAULT_MODEL,
      resolveReasoningBudget(narrative),
      undefined,
      0.3,
      resolveWebsearch(narrative),
    );

    logInfo('Narrative-context search completed', {
      source: 'search',
      operation: 'synthesize-context-search-complete',
      details: { query: query.substring(0, 100), overviewLength: accumulatedText.trim().length },
    });

    return { overview: accumulatedText.trim(), citations: [] };
  } catch (error) {
    logError('Narrative-context search failed', error, {
      source: 'search',
      operation: 'synthesize-context-search-error',
      details: { query: query.substring(0, 100) },
    });
    return {
      overview: `Unable to search the narrative context for "${query}". Please try again.`,
      citations: [],
    };
  }
}
