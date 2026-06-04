/**
 * Text Analysis Pipeline — converts a large corpus (book, screenplay, etc.)
 * into a full NarrativeState by splitting into chunks, analyzing each with LLM,
 * and assembling the results.
 *
 * Adapted from scripts/analyze-chapter.ts and scripts/assemble-narrative.ts
 * for in-browser use with the app's existing callGenerate infrastructure.
 */

import {
  ANALYSIS_CONCURRENCY,
  ANALYSIS_MODEL,
  ANALYSIS_TEMPERATURE,
  MAX_TOKENS_DEFAULT,
  SCENES_PER_ARC,
  WORDS_PER_SCENE,
} from "@/lib/constants";
import { logWarning } from "@/lib/core/system-logger";
import type {
  AnalysisChunkResult,
  Arc,
  Artifact,
  BeatPlan,
  Branch,
  Character,
  WorldNodeType,
  Location,
  NarrativeState,
  OwnershipDelta,
  ProseProfile,
  RelationshipDelta,
  RelationshipEdge,
  Scene,
  SceneVersionPointers,
  SystemDelta,
  SystemNodeType,
  Thread,
  ThreadDelta,
  ThreadHorizon,
  NarrativeParadigm,
  ThreadLogNodeType,
  TieDelta,
  TimeDelta,
  WorldBuild,
  WorldDelta,
} from "@/types/narrative";

const VALID_PARADIGMS: ReadonlySet<NarrativeParadigm> = new Set<NarrativeParadigm>([
  "fiction", "non-fiction", "simulation", "essay", "panel", "atlas", "debate", "record", "game",
]);
import {
  DEFAULT_STORY_SETTINGS,
  NARRATOR_AGENT_ID,
  THREAD_LOG_NODE_TYPES,
} from "@/types/narrative";
import { clampEvidence, isThreadAbandoned, isThreadClosed } from "@/lib/forces/narrative-utils";
import { newNarratorStance } from "@/lib/forces/thread-log";
import {
  SCENE_STRUCTURE_SYSTEM,
  buildSceneStructurePrompt,
  ARC_GROUPING_SYSTEM,
  buildArcGroupingPrompt,
  RECONCILE_ENTITIES_SYSTEM,
  buildReconcileEntitiesPrompt,
  RECONCILE_SEMANTIC_SYSTEM,
  buildReconcileSemanticPrompt,
  COALESCE_OUTCOMES_SYSTEM,
  buildCoalesceOutcomesPrompt,
  FATE_REEXTRACT_SYSTEM,
  buildFateReextractPrompt,
  type FateReextractThread,
  type FateReextractPriorDelta,
  THREADING_SYSTEM,
  buildThreadingPrompt,
  META_EXTRACTION_SYSTEM,
  buildMetaExtractionPrompt,
} from "@/lib/prompts/analysis";
import { normalizeTimeDelta } from "@/lib/forces/time-deltas";
import { ensureSceneAttributions, ensureExpansionAttributions } from "@/lib/forces/attribution";

// ── Scene-level Splitting ────────────────────────────────────────────────────

/**
 * Split corpus into scene-sized prose chunks (~1200 words each).
 * Returns ordered array of { index, prose, wordCount }.
 */
export function splitCorpusIntoScenes(
  text: string,
): { index: number; prose: string; wordCount: number }[] {
  const TARGET = WORDS_PER_SCENE;
  const scenes: { index: number; prose: string; wordCount: number }[] = [];

  // Split on paragraph breaks first, then sentence breaks for long paragraphs
  let paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Break any paragraph longer than TARGET into sentence-level chunks
  const expanded: string[] = [];
  for (const para of paragraphs) {
    const wc = para.split(/\s+/).length;
    if (wc > TARGET) {
      // Split on sentence boundaries
      const sentences = para.match(/[^.!?]+[.!?]+["']?\s*/g) ?? [para];
      let sentBuf = "";
      for (const sent of sentences) {
        if (
          sentBuf &&
          sentBuf.split(/\s+/).length + sent.split(/\s+/).length > TARGET
        ) {
          expanded.push(sentBuf.trim());
          sentBuf = sent;
        } else {
          sentBuf += sent;
        }
      }
      if (sentBuf.trim()) expanded.push(sentBuf.trim());
    } else {
      expanded.push(para);
    }
  }
  paragraphs = expanded;

  // Group paragraphs into ~1200-word scenes
  let buffer: string[] = [];
  let bufferWords = 0;

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/).length;
    if (bufferWords >= TARGET) {
      // Buffer already at target — flush immediately
      scenes.push({
        index: scenes.length,
        prose: buffer.join("\n\n"),
        wordCount: bufferWords,
      });
      buffer = [para];
      bufferWords = paraWords;
    } else if (bufferWords > 0 && bufferWords + paraWords > TARGET * 1.15) {
      // Adding this paragraph would overshoot — flush and start new
      scenes.push({
        index: scenes.length,
        prose: buffer.join("\n\n"),
        wordCount: bufferWords,
      });
      buffer = [para];
      bufferWords = paraWords;
    } else {
      buffer.push(para);
      bufferWords += paraWords;
    }
  }
  if (buffer.length > 0) {
    scenes.push({
      index: scenes.length,
      prose: buffer.join("\n\n"),
      wordCount: bufferWords,
    });
  }

  // Merge any tiny trailing scene into the previous one
  if (scenes.length > 1 && scenes[scenes.length - 1].wordCount < TARGET * 0.3) {
    const last = scenes.pop()!;
    const prev = scenes[scenes.length - 1];
    scenes[scenes.length - 1] = {
      ...prev,
      prose: prev.prose + "\n\n" + last.prose,
      wordCount: prev.wordCount + last.wordCount,
    };
  }

  return scenes;
}

// ── Per-Scene Structure Extraction ──────────────────────────────────────────

/**
 * Scene structure result — entities and deltas extracted from one scene's prose.
 */
export type SceneStructureResult = {
  povName: string;
  locationName: string;
  participantNames: string[];
  events: string[];
  summary: string;
  characters: AnalysisChunkResult["characters"];
  locations: AnalysisChunkResult["locations"];
  artifacts: NonNullable<AnalysisChunkResult["artifacts"]>;
  threads: AnalysisChunkResult["threads"];
  relationships: AnalysisChunkResult["relationships"];
  threadDeltas: AnalysisChunkResult["scenes"][0]["threadDeltas"];
  worldDeltas: AnalysisChunkResult["scenes"][0]["worldDeltas"];
  relationshipDeltas: AnalysisChunkResult["scenes"][0]["relationshipDeltas"];
  artifactUsages: NonNullable<
    AnalysisChunkResult["scenes"][0]["artifactUsages"]
  >;
  ownershipDeltas: NonNullable<
    AnalysisChunkResult["scenes"][0]["ownershipDeltas"]
  >;
  tieDeltas: NonNullable<AnalysisChunkResult["scenes"][0]["tieDeltas"]>;
  systemDeltas?: AnalysisChunkResult["scenes"][0]["systemDeltas"];
  timeDelta?: TimeDelta | null;
};

/**
 * Extract structure from a single scene's prose, informed by its beat plan.
 * The plan tells the LLM where beat boundaries are; the prose is the source of truth for deltas.
 */
export async function extractSceneStructure(
  prose: string,
  plan: BeatPlan | null,
  onToken?: (token: string, accumulated: string) => void,
): Promise<SceneStructureResult> {
  const fullPrompt = buildSceneStructurePrompt(prose, plan);
  const raw = await callAnalysis(fullPrompt, SCENE_STRUCTURE_SYSTEM, onToken, "extractSceneStructure");
  const json = extractJSON(raw);
  const parsed = JSON.parse(json) as SceneStructureResult;

  return {
    povName: parsed.povName ?? "",
    locationName: parsed.locationName ?? "",
    participantNames: parsed.participantNames ?? [],
    events: parsed.events ?? [],
    summary: parsed.summary ?? "",
    characters: parsed.characters ?? [],
    locations: parsed.locations ?? [],
    artifacts: parsed.artifacts ?? [],
    threads: parsed.threads ?? [],
    relationships: parsed.relationships ?? [],
    threadDeltas: parsed.threadDeltas ?? [],
    worldDeltas: parsed.worldDeltas ?? [],
    relationshipDeltas: parsed.relationshipDeltas ?? [],
    artifactUsages: parsed.artifactUsages ?? [],
    ownershipDeltas: parsed.ownershipDeltas ?? [],
    tieDeltas: parsed.tieDeltas ?? [],
    systemDeltas: parsed.systemDeltas,
    timeDelta: normalizeTimeDelta(parsed.timeDelta),
  };
}

// ── Arc Grouping ────────────────────────────────────────────────────────────

/**
 * Group scenes into arcs of ~4 scenes each. The LLM emits per-arc metadata:
 * name, directionVector (forward intent), and worldState (compact backward
 * snapshot in the work's native form — narrative, chess, poker, paper, log).
 */
export async function groupScenesIntoArcs(
  sceneSummaries: { index: number; summary: string }[],
  onToken?: (token: string, accumulated: string) => void,
): Promise<{ name: string; directionVector?: string; worldState?: string; sceneIndices: number[] }[]> {
  // Pre-group into chunks of SCENES_PER_ARC
  const groups: { sceneIndices: number[]; summaries: string[] }[] = [];
  for (let i = 0; i < sceneSummaries.length; i += SCENES_PER_ARC) {
    const slice = sceneSummaries.slice(i, i + SCENES_PER_ARC);
    groups.push({
      sceneIndices: slice.map((s) => s.index),
      summaries: slice.map((s) => s.summary),
    });
  }

  const prompt = buildArcGroupingPrompt(groups);
  const raw = await callAnalysis(prompt, ARC_GROUPING_SYSTEM, onToken, "groupScenesIntoArcs");
  const json = extractJSON(raw);
  const parsed = JSON.parse(json) as Array<{ name?: string; directionVector?: string; worldState?: string }>;

  return groups.map((g, i) => {
    const item = parsed[i] ?? {};
    return {
      name: item.name ?? `Arc ${i + 1}`,
      directionVector: item.directionVector,
      worldState: item.worldState,
      sceneIndices: g.sceneIndices,
    };
  });
}

// ── LLM Call ─────────────────────────────────────────────────────────────────

async function callAnalysis(
  prompt: string,
  systemPrompt: string,
  onToken?: (token: string, accumulated: string) => void,
  // Per-call name surfaced in api-logger so the dashboard can distinguish
  // structure / arcs / reconcile / reextract / WB-summary / meta calls
  // instead of bucketing every analysis hit under one anonymous label.
  caller: string = "analyzeChunk",
): Promise<string> {
  const { logApiCall, updateApiLog } = await import("@/lib/core/api-logger");
  const { apiHeaders } = await import("@/lib/core/api-headers");
  const logId = logApiCall(
    caller,
    prompt.length + systemPrompt.length,
    prompt,
    ANALYSIS_MODEL,
    systemPrompt,
  );
  const start = performance.now();

  try {
    const useStream = !!onToken;
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        prompt,
        systemPrompt,
        maxTokens: MAX_TOKENS_DEFAULT,
        stream: useStream,
        model: ANALYSIS_MODEL,
        temperature: ANALYSIS_TEMPERATURE,
        reasoningBudget: 0,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      const message = err.error || "Analysis failed";
      updateApiLog(logId, {
        status: "error",
        error: message,
        durationMs: Math.round(performance.now() - start),
      });
      throw new Error(message);
    }

    let content: string;

    if (useStream && res.body) {
      // Stream SSE tokens
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let reasoningAccumulated = "";
      let buffer = "";
      let lastLogFlush = 0;
      const LOG_FLUSH_MS = 200;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (trimmed.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              if (parsed.token) {
                accumulated += parsed.token;
                onToken(parsed.token, accumulated);
              }
              if (parsed.reasoning) {
                reasoningAccumulated += parsed.reasoning;
              }
            } catch {
              // skip malformed
            }
          }
        }

        const now = performance.now();
        if (now - lastLogFlush >= LOG_FLUSH_MS) {
          lastLogFlush = now;
          updateApiLog(logId, {
            responsePreview: accumulated,
            ...(reasoningAccumulated ? { reasoningContent: reasoningAccumulated } : {}),
          });
        }
      }
      content = accumulated;
    } else {
      const data = await res.json();
      content = data.content;
    }

    updateApiLog(logId, {
      status: "success",
      durationMs: Math.round(performance.now() - start),
      responseLength: content.length,
      responsePreview: content,
    });
    return content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateApiLog(logId, {
      status: "error",
      error: message,
      durationMs: Math.round(performance.now() - start),
    });
    throw err;
  }
}

// ── World-build intent summariser ────────────────────────────────────────────
//
// Each WorldBuild is summarised by a small LLM call so downstream arc
// generation can read the *intent* of the expansion (what creative space it
// opens, what tension it primes), not just a count of additions. Used by the
// text-analysis pipeline; the live world-expansion path generates the same
// kind of summary inline through expand-world.ts.

type WorldBuildSummaryInput = {
  worldBuildId: string;
  isInitial: boolean;
  newCharNames: string[];
  newLocNames: string[];
  newThreadDescs: string[];
  newArtifactNames: string[];
  leadChapter: string;
};

const WORLD_BUILD_SUMMARY_SYSTEM = `You are summarising the INTENT of a world expansion that just landed in an analysed text. The summary will be read by another LLM that plans the next narrative arc — so name the load-bearing additions, the creative space the expansion opens, and the tension it primes. Do not enumerate counts. Output 1-2 sentences (≤ 40 words). Plain prose. No markdown, no preamble.`;

function buildWorldBuildSummaryPrompt(input: WorldBuildSummaryInput): string {
  const intro = input.isInitial
    ? "This is the INITIAL world commit — set the stage."
    : "This is a follow-up world expansion — name what it newly brings into play.";
  const blocks: string[] = [];
  if (input.newCharNames.length > 0)
    blocks.push(`<new-characters>${input.newCharNames.slice(0, 8).join(", ")}</new-characters>`);
  if (input.newLocNames.length > 0)
    blocks.push(`<new-locations>${input.newLocNames.slice(0, 6).join(", ")}</new-locations>`);
  if (input.newArtifactNames.length > 0)
    blocks.push(`<new-artifacts>${input.newArtifactNames.slice(0, 4).join(", ")}</new-artifacts>`);
  if (input.newThreadDescs.length > 0)
    blocks.push(
      `<new-threads>\n${input.newThreadDescs.slice(0, 4).map((d) => `  - ${d}`).join("\n")}\n</new-threads>`,
    );
  if (input.leadChapter)
    blocks.push(`<lead-chapter-summary>${input.leadChapter}</lead-chapter-summary>`);
  return `<context>${intro}</context>\n${blocks.join("\n")}\n\nReturn the summary as a single line of plain prose.`;
}

async function summariseWorldBuildBatch(input: WorldBuildSummaryInput): Promise<string> {
  const prompt = buildWorldBuildSummaryPrompt(input);
  const raw = await callAnalysis(prompt, WORLD_BUILD_SUMMARY_SYSTEM, undefined, "summariseWorldBuildBatch");
  // Trim wrapping quotes / code fences if the model adds them.
  return raw
    .trim()
    .replace(/^```(?:\w+)?\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
}

function fallbackBatchSummary(input: WorldBuildSummaryInput): string {
  const introBits: string[] = [];
  if (input.newCharNames.length > 0)
    introBits.push(
      input.newCharNames.slice(0, 4).join(", ") +
        (input.newCharNames.length > 4 ? " and others" : ""),
    );
  if (input.newLocNames.length > 0) introBits.push(input.newLocNames.slice(0, 3).join(", "));
  const introClause = introBits.length > 0 ? `Introduces ${introBits.join(" / ")}.` : "";
  const threadClause =
    input.newThreadDescs.length > 0
      ? `Opens questions: ${input.newThreadDescs.slice(0, 2).join(" · ")}`
      : "";
  return [
    input.isInitial ? "Sets up the world." : "",
    introClause,
    input.leadChapter,
    threadClause,
  ]
    .filter((s) => s.length > 0)
    .join(" ")
    .slice(0, 320)
    .trim();
}

// ── JSON Extraction ──────────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");

  // Honor whichever container type opens first — object `{...}` or array `[...]`.
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  let start = -1;
  let end = -1;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace;
    end = text.lastIndexOf("}");
  } else if (firstBracket !== -1) {
    start = firstBracket;
    end = text.lastIndexOf("]");
  }
  if (start !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }

  text = text.replace(/,\s*([}\]])/g, "$1");

  // Fix missing opening quote on string values: "key": value" → "key": "value"
  text = text.replace(/:\s*([a-zA-Z_][a-zA-Z0-9_]*)"(,|\s*[}\]])/g, ': "$1"$2');
  // Fix missing closing quote: "key": "value → "key": "value"
  text = text.replace(/:\s*"([^"]*?)(\n)/g, ': "$1"$2');
  // Escape raw newlines/tabs inside string values (not already escaped)
  text = text.replace(/"([^"]*?)"/g, (_match, inner: string) => {
    const escaped = inner
      .replace(/(?<!\\)\n/g, "\\n")
      .replace(/(?<!\\)\r/g, "\\r")
      .replace(/(?<!\\)\t/g, "\\t");
    return `"${escaped}"`;
  });

  let opens = 0,
    closes = 0,
    sqOpens = 0,
    sqCloses = 0;
  for (const ch of text) {
    if (ch === "{") opens++;
    else if (ch === "}") closes++;
    else if (ch === "[") sqOpens++;
    else if (ch === "]") sqCloses++;
  }
  while (sqCloses < sqOpens) {
    text += "]";
    sqCloses++;
  }
  while (closes < opens) {
    text += "}";
    closes++;
  }

  return text;
}

// ── Reconciliation (Phase 3) ─────────────────────────────────────────────────
// Phase 2 (beat plan extraction) is handled by analysis-runner.ts directly

type CharacterNameMap = Record<string, string>; // variant → canonical

export type EntityMerges = {
  characterMerges: CharacterNameMap;
  locationMerges: Record<string, string>;
  artifactMerges: Record<string, string>;
};

export type SemanticMerges = {
  threadMerges: Record<string, string>;
  systemMerges: Record<string, string>;
};

function parseMergeJSON<T extends object>(raw: string): T {
  const json = extractJSON(raw);
  try {
    return JSON.parse(json) as T;
  } catch {
    const repaired = json
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\x00-\x1F\x7F]/g, (ch) =>
        ch === "\n" || ch === "\t" ? ch : "",
      );
    return JSON.parse(repaired) as T;
  }
}

/**
 * Phase 3a — Entity reconciliation (characters, locations, artifacts).
 * Entities are proper-named and referentially unique: the same person, place,
 * or object appears under multiple surface forms. Resolve aggressively to the
 * fullest canonical name.
 */
export async function reconcileEntities(
  allCharNames: Set<string>,
  allLocNames: Set<string>,
  allArtifactNames: Set<string>,
  onToken?: (token: string, accumulated: string) => void,
): Promise<EntityMerges> {
  if (
    allCharNames.size === 0 &&
    allLocNames.size === 0 &&
    allArtifactNames.size === 0
  ) {
    return { characterMerges: {}, locationMerges: {}, artifactMerges: {} };
  }

  const prompt = buildReconcileEntitiesPrompt(allCharNames, allLocNames, allArtifactNames);
  const raw = await callAnalysis(prompt, RECONCILE_ENTITIES_SYSTEM, onToken, "reconcileEntities");
  const parsed = parseMergeJSON<{
    characterMerges?: Record<string, number | string>;
    locationMerges?: Record<string, number | string>;
    artifactMerges?: Record<string, number | string>;
  }>(raw);

  // Lists are 1-indexed in the prompt to match the numbered rendering.
  const chars = [...allCharNames];
  const locs = [...allLocNames];
  const arts = [...allArtifactNames];
  return {
    characterMerges: resolveIdMergeMap(parsed.characterMerges, chars),
    locationMerges: resolveIdMergeMap(parsed.locationMerges, locs),
    artifactMerges: resolveIdMergeMap(parsed.artifactMerges, arts),
  };
}

/** Convert an id→id merge map (as emitted by the LLM) to the variant→canonical
 *  string map the reducer consumes. Silently drops entries whose ids fall
 *  outside the provided list — matches how we treat unparseable string merges
 *  today: the variant falls through to identity mapping, which is safe. */
function resolveIdMergeMap(
  rawMap: Record<string, number | string> | undefined,
  list: string[],
): Record<string, string> {
  if (!rawMap) return {};
  const out: Record<string, string> = {};
  for (const [variantKey, canonicalRaw] of Object.entries(rawMap)) {
    const variantIdx = parseIndex(variantKey, list.length);
    const canonicalIdx = parseIndex(canonicalRaw, list.length);
    if (variantIdx === null || canonicalIdx === null) continue;
    if (variantIdx === canonicalIdx) continue;
    const variant = list[variantIdx];
    const canonical = list[canonicalIdx];
    if (!variant || !canonical || variant === canonical) continue;
    out[variant] = canonical;
  }
  return out;
}

/** Parse a 1-indexed id from string or number. Returns the zero-indexed offset
 *  into the list, or null if invalid / out of range. */
function parseIndex(raw: unknown, listLength: number): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > listLength) return null;
  return n - 1;
}

/**
 * Phase 3b — Semantic reconciliation (threads, system knowledge).
 * Threads and knowledge nodes are full propositions, not proper names. Two
 * items that look similar often capture distinct nuances. Default stance is
 * to PRESERVE. Only collapse when meaning, scope, and stakes are effectively
 * identical and one phrasing is just a restatement of the other.
 */
export async function reconcileSemantic(
  allThreadDescs: Set<string>,
  allSysConcepts: Set<string>,
  onToken?: (token: string, accumulated: string) => void,
): Promise<SemanticMerges> {
  if (allThreadDescs.size === 0 && allSysConcepts.size === 0) {
    return { threadMerges: {}, systemMerges: {} };
  }

  const prompt = buildReconcileSemanticPrompt(allThreadDescs, allSysConcepts);
  const raw = await callAnalysis(prompt, RECONCILE_SEMANTIC_SYSTEM, onToken, "reconcileSemantic");
  const parsed = parseMergeJSON<Partial<SemanticMerges>>(raw);
  return {
    threadMerges: parsed.threadMerges ?? {},
    systemMerges: parsed.systemMerges ?? {},
  };
}

/**
 * Thread alignment (priors-compact only) — corrective pass that runs after
 * standard reconciliation on slices produced from the Driver compact
 * path. Inputs are slice threads that survived reconcileSemantic as
 * net-new; output is a {slice-description → existing-description} map
 * augmenting the merge plan for daily-log files specifically.
 *
 * The default stance is continuation-first: daily ingest is dominated
 * by continuations, not novel threads, so the LLM is biased to find a
 * matching existing thread for each candidate and only mark NOVEL when
 * no continuity exists. Counter-balances reconcileSemantic's
 * preserve-default for this file class only — fresh analysis runs are
 * untouched.
 */
export type ThreadIntegrationInput = {
  description: string;
  participantSummary?: string;
  outcomes?: ReadonlyArray<string>;
};

export async function integrateSliceThreadsIntoExisting(
  sliceCandidates: ReadonlyArray<ThreadIntegrationInput>,
  existingOpenThreads: ReadonlyArray<ThreadIntegrationInput>,
  onToken?: (token: string, accumulated: string) => void,
): Promise<Record<string, string>> {
  if (sliceCandidates.length === 0 || existingOpenThreads.length === 0) return {};

  const { THREAD_INTEGRATION_SYSTEM, buildThreadIntegrationPrompt } = await import(
    '@/lib/prompts'
  );
  const prompt = buildThreadIntegrationPrompt(sliceCandidates, existingOpenThreads);
  const raw = await callAnalysis(
    prompt,
    THREAD_INTEGRATION_SYSTEM,
    onToken,
    'integrateSliceThreads',
  );

  let parsed: { alignments?: unknown };
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch {
    const repaired = extractJSON(raw)
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[\x00-\x1F\x7F]/g, (ch) => (ch === '\n' || ch === '\t' ? ch : ''));
    parsed = JSON.parse(repaired);
  }

  const out: Record<string, string> = {};
  if (!Array.isArray(parsed.alignments)) return out;
  for (const item of parsed.alignments) {
    if (!item || typeof item !== 'object') continue;
    const sliceIdRaw = (item as Record<string, unknown>).slice;
    const continuesRaw = (item as Record<string, unknown>).continues;
    const sliceIdx = parseIndex(sliceIdRaw, sliceCandidates.length);
    const existingIdx = parseIndex(continuesRaw, existingOpenThreads.length);
    if (sliceIdx === null || existingIdx === null) continue;
    const sliceDesc = sliceCandidates[sliceIdx]?.description;
    const existingDesc = existingOpenThreads[existingIdx]?.description;
    if (!sliceDesc || !existingDesc || sliceDesc === existingDesc) continue;
    out[sliceDesc] = existingDesc;
  }
  return out;
}

/**
 * Reconcile independently-extracted chunk results:
 * - Phase 3a (entities): aggressive merging of character/location/artifact name variants
 * - Phase 3b (semantic): nuanced merging of threads and system knowledge, default-preserve
 * - Stitch thread continuity across chunks (connect same threads, fix status chains)
 */
export async function reconcileResults(
  results: AnalysisChunkResult[],
  onToken?: (token: string, accumulated: string) => void,
): Promise<AnalysisChunkResult[]> {
  // Collect all unique names and thread descriptions across chunks
  const allCharNames = new Set<string>();
  const allThreadDescs = new Set<string>();
  const allLocNames = new Set<string>();
  const allArtifactNames = new Set<string>();
  const allSysConcepts = new Set<string>();

  for (const r of results) {
    for (const c of r.characters ?? []) allCharNames.add(c.name);
    for (const t of r.threads ?? []) allThreadDescs.add(t.description);
    for (const l of r.locations ?? []) allLocNames.add(l.name);
    for (const a of r.artifacts ?? []) allArtifactNames.add(a.name);
    for (const s of r.scenes ?? []) {
      for (const n of s.systemDeltas?.addedNodes ?? [])
        allSysConcepts.add(n.concept);
    }
  }

  // Two sequential streaming calls — entities first, then threads + knowledge.
  // Sequential keeps the stream viewer readable (one phase at a time) and lets
  // the entities phase finish before the semantic phase begins.
  let phaseLog = "";
  const phaseStream = (tag: string) =>
    onToken
      ? (token: string, accumulated: string) =>
          onToken(token, `${phaseLog}[${tag}]\n${accumulated}`)
      : undefined;

  const entityMerges = await reconcileEntities(
    allCharNames,
    allLocNames,
    allArtifactNames,
    phaseStream("entities"),
  );
  phaseLog = `[entities] done\n\n`;

  const semanticMerges = await reconcileSemantic(
    allThreadDescs,
    allSysConcepts,
    phaseStream("threads+knowledge"),
  );
  phaseLog = `${phaseLog}[threads+knowledge] done\n\n`;

  const charMap = entityMerges.characterMerges;
  const locMap = entityMerges.locationMerges;
  const artMap = entityMerges.artifactMerges;
  const threadMap = semanticMerges.threadMerges;
  const sysMap = semanticMerges.systemMerges;

  const resolveChar = (name: string) => charMap[name] ?? name;
  const resolveThread = (desc: string) => threadMap[desc] ?? desc;
  const resolveLoc = (name: string) => locMap[name] ?? name;
  const resolveArt = (name: string) => artMap[name] ?? name;
  const resolveSys = (concept: string) => sysMap[concept] ?? concept;

  // ── Phase 3c: outcome coalescing ────────────────────────────────────────
  // Parallel extraction fragments outcomes — "succeeds", "succeeds in
  // rewriting his future", "successfully manipulates his past" are the
  // same future restated. Collect all outcomes per canonical thread
  // (after thread-description merges), ask the LLM to coalesce each
  // thread's set to a small canonical list, and build a per-thread
  // {variant → canonical} map. Applied below when threadDeltas and
  // thread.outcomes are remapped.
  const outcomesByThread = new Map<string, Set<string>>();
  for (const r of results) {
    for (const t of r.threads ?? []) {
      const canonical = resolveThread(t.description);
      const bucket = outcomesByThread.get(canonical) ?? new Set<string>();
      for (const o of t.outcomes ?? []) {
        if (typeof o === 'string' && o.trim()) bucket.add(o.trim());
      }
      outcomesByThread.set(canonical, bucket);
    }
    // Also harvest outcome names referenced in threadDeltas (addOutcomes and
    // updates) — the scene extractor can introduce outcomes the thread's own
    // outcomes[] field didn't list.
    for (const s of r.scenes ?? []) {
      for (const tm of s.threadDeltas ?? []) {
        const canonical = resolveThread(tm.threadDescription);
        const bucket = outcomesByThread.get(canonical) ?? new Set<string>();
        for (const u of tm.updates ?? []) {
          if (u?.outcome && typeof u.outcome === 'string') bucket.add(u.outcome.trim());
        }
        for (const o of tm.addOutcomes ?? []) {
          if (typeof o === 'string' && o.trim()) bucket.add(o.trim());
        }
        outcomesByThread.set(canonical, bucket);
      }
    }
  }

  // outcomeMerges[threadDesc][variant] = canonical. Threads whose coalesce
  // call succeeds get populated; others fall through to identity mapping.
  const outcomeMerges: Record<string, Record<string, string>> = {};
  const canonicalOutcomes: Record<string, string[]> = {};

  // Only invoke the LLM when there's actual fragmentation — a thread with
  // 2 or fewer outcomes is already canonical.
  const threadsNeedingCoalesce = [...outcomesByThread.entries()]
    .filter(([, outcomes]) => outcomes.size > 2)
    .map(([description, outcomes]) => ({ description, outcomes: [...outcomes] }));

  if (threadsNeedingCoalesce.length > 0) {
    try {
      const coalescePrompt = buildCoalesceOutcomesPrompt(threadsNeedingCoalesce);
      const coalesceRaw = await callAnalysis(
        coalescePrompt,
        COALESCE_OUTCOMES_SYSTEM,
        phaseStream("coalesce-outcomes"),
        "coalesceOutcomes",
      );
      const parsed = parseMergeJSON<{ threads?: Record<string, { canonical?: string[]; merges?: Record<string, string> }> }>(
        coalesceRaw,
      );
      for (const [desc, entry] of Object.entries(parsed.threads ?? {})) {
        const canon = Array.isArray(entry?.canonical)
          ? entry.canonical.filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
          : [];
        const merges = entry?.merges ?? {};
        const cleanMerges: Record<string, string> = {};
        for (const [variant, canonicalVal] of Object.entries(merges)) {
          if (typeof variant === 'string' && typeof canonicalVal === 'string') {
            cleanMerges[variant.trim()] = canonicalVal.trim();
          }
        }
        if (canon.length >= 2) {
          canonicalOutcomes[desc] = canon;
          outcomeMerges[desc] = cleanMerges;
        }
      }
    } catch {
      // Coalesce failure is non-fatal — without the map, outcomes remain
      // unioned as-is. We'd rather not block assembly on this step.
    }
  }

  /** Resolve a single (thread, outcome) pair through the outcome merge map.
   *  Falls through to the raw outcome when no mapping exists. */
  const resolveOutcome = (threadDesc: string, outcome: string): string => {
    const map = outcomeMerges[threadDesc];
    if (!map) return outcome;
    return map[outcome] ?? map[outcome.trim()] ?? outcome;
  };

  // Unified entity resolver — tries all maps so the same entity always resolves
  // to the same canonical name regardless of which field references it.
  const resolveEntity = (name: string): string =>
    charMap[name] ?? locMap[name] ?? artMap[name] ?? name;

  // Apply merges to all results
  const reconciled: AnalysisChunkResult[] = results.map((r) => ({
    ...r,
    characters: deduplicateBy(
      (r.characters ?? []).map((c) => ({ ...c, name: resolveChar(c.name) })),
      (c) => c.name,
      (a, b) => ({
        ...a,
        role: higherRole(a.role, b.role),
        imagePrompt: a.imagePrompt || b.imagePrompt,
      }),
    ),
    locations: deduplicateBy(
      (r.locations ?? []).map((l) => ({
        ...l,
        name: resolveLoc(l.name),
        parentName: l.parentName ? resolveEntity(l.parentName) : null,
        tiedCharacterNames: (l.tiedCharacterNames ?? []).map(resolveEntity),
      })),
      (l) => l.name,
      (a, b) => ({
        ...a,
        tiedCharacterNames: [
          ...new Set([
            ...(a.tiedCharacterNames ?? []),
            ...(b.tiedCharacterNames ?? []),
          ]),
        ],
        prominence:
          a.prominence && b.prominence
            ? (({ margin: 0, place: 1, domain: 2 } as Record<string, number>)[
                b.prominence
              ] ?? 0) >
              (({ margin: 0, place: 1, domain: 2 } as Record<string, number>)[
                a.prominence
              ] ?? 0)
              ? b.prominence
              : a.prominence
            : a.prominence || b.prominence,
        imagePrompt: a.imagePrompt || b.imagePrompt,
      }),
    ),
    artifacts: deduplicateBy(
      (r.artifacts ?? []).map((a) => ({
        ...a,
        name: resolveArt(a.name),
        ownerName: a.ownerName ? resolveEntity(a.ownerName) : null,
      })),
      (a) => a.name,
      (a, b) => ({
        ...a,
        significance: higherSignificance(a.significance, b.significance),
        imagePrompt: a.imagePrompt || b.imagePrompt,
      }),
    ),
    threads: deduplicateBy(
      (r.threads ?? []).map((t) => ({
        ...t,
        description: resolveThread(t.description),
        participantNames: t.participantNames.map(resolveEntity),
        // Prefer the coalesced canonical set when the LLM returned one;
        // otherwise fall back to the thread's own outcomes remapped through
        // the merge map and de-duped.
        outcomes: (() => {
          const canon = canonicalOutcomes[resolveThread(t.description)];
          if (canon && canon.length >= 2) return canon;
          const raw = Array.isArray(t.outcomes) && t.outcomes.length >= 2 ? t.outcomes : ["yes", "no"];
          return [...new Set(raw.map((o) => resolveOutcome(resolveThread(t.description), o)))];
        })(),
      })),
      (t) => t.description,
      (a, b) => ({
        ...a,
        // Union across duplicate thread entries (same canonical description
        // from two chunks). Coalesce was already applied above, so both
        // sides are canonical sets — union them.
        outcomes: [...new Set([...a.outcomes, ...b.outcomes])],
        // First non-empty horizon wins. A later chunk re-mentioning the
        // thread without a classification doesn't downgrade the original.
        horizon: a.horizon ?? b.horizon,
        development: `${a.development}; ${b.development}`,
      }),
    ),
    scenes: (r.scenes ?? []).map((s) => ({
      ...s,
      povName: resolveEntity(s.povName),
      locationName: resolveEntity(s.locationName),
      participantNames: [...new Set(s.participantNames.map(resolveEntity))],
      threadDeltas: deduplicateBy(
        (s.threadDeltas ?? []).map((tm) => {
          const canonicalDesc = resolveThread(tm.threadDescription);
          // Remap each update's outcome through the coalesce map. When
          // multiple variant-updates collapse onto the same canonical
          // outcome within this one delta, take the SIGNED MAX-MAGNITUDE —
          // never sum, never average. This prevents overlapping ways of
          // saying the same thing from inflating the evidence. (E.g. a
          // scene that emits {"succeeds":+2, "succeeds in rewriting":+1}
          // collapses to {"succeeds":+2}, not +3.)
          const remappedUpdates = new Map<string, { outcome: string; evidence: number }>();
          for (const u of tm.updates ?? []) {
            if (!u || typeof u.outcome !== 'string') continue;
            const canonOutcome = resolveOutcome(canonicalDesc, u.outcome);
            const prior = remappedUpdates.get(canonOutcome);
            const incoming = typeof u.evidence === 'number' ? u.evidence : 0;
            if (!prior) {
              remappedUpdates.set(canonOutcome, { outcome: canonOutcome, evidence: incoming });
            } else {
              // Max-abs with sign preservation. If both are positive/negative
              // we keep the stronger one; if they disagree in sign, the
              // stronger magnitude wins (the author's dominant signal).
              remappedUpdates.set(canonOutcome, {
                outcome: canonOutcome,
                evidence:
                  Math.abs(incoming) > Math.abs(prior.evidence) ? incoming : prior.evidence,
              });
            }
          }
          // addOutcomes: remap, then drop any that now match an existing
          // canonical outcome (already part of the market).
          const canonOutcomeSet = new Set(canonicalOutcomes[canonicalDesc] ?? []);
          const remappedAddOutcomes: string[] = [];
          const seenAdded = new Set<string>();
          for (const o of tm.addOutcomes ?? []) {
            if (typeof o !== 'string') continue;
            const canon = resolveOutcome(canonicalDesc, o);
            if (canonOutcomeSet.size > 0 && canonOutcomeSet.has(canon)) continue;
            if (seenAdded.has(canon)) continue;
            seenAdded.add(canon);
            remappedAddOutcomes.push(canon);
          }
          return {
            ...tm,
            threadDescription: canonicalDesc,
            updates: [...remappedUpdates.values()],
            addOutcomes: remappedAddOutcomes,
          };
        }),
        (tm) => tm.threadDescription,
        // When two deltas target the same thread in one scene, take the
        // later logType and max-abs-merge updates per canonical outcome.
        // Again: we never sum across the same outcome — that would inflate
        // the probability shift.
        (a, b) => {
          const updates = new Map<string, { outcome: string; evidence: number }>();
          for (const u of [...(a.updates ?? []), ...(b.updates ?? [])]) {
            const prior = updates.get(u.outcome);
            if (!prior || Math.abs(u.evidence) > Math.abs(prior.evidence)) {
              updates.set(u.outcome, u);
            }
          }
          return {
            ...a,
            logType: b.logType,
            updates: [...updates.values()],
            volumeDelta: (a.volumeDelta ?? 0) + (b.volumeDelta ?? 0),
            addOutcomes: [...new Set([...(a.addOutcomes ?? []), ...(b.addOutcomes ?? [])])],
            rationale: a.rationale,
          };
        },
      ),
      worldDeltas: deduplicateBy(
        (s.worldDeltas ?? []).map((km) => ({
          ...km,
          entityName: resolveEntity(km.entityName),
        })),
        (km) => km.entityName,
        (a, b) => ({
          ...a,
          addedNodes: mergeContinuity(a.addedNodes, b.addedNodes),
        }),
      ),
      relationshipDeltas: (s.relationshipDeltas ?? []).map((rm) => ({
        ...rm,
        from: resolveEntity(rm.from),
        to: resolveEntity(rm.to),
      })),
      artifactUsages: (s.artifactUsages ?? []).map((au) => ({
        ...au,
        artifactName: resolveArt(au.artifactName),
        characterName: au.characterName
          ? resolveEntity(au.characterName)
          : null,
      })),
      ownershipDeltas: (s.ownershipDeltas ?? []).map((om) => ({
        ...om,
        artifactName: resolveArt(om.artifactName),
        fromName: resolveEntity(om.fromName),
        toName: resolveEntity(om.toName),
      })),
      tieDeltas: (s.tieDeltas ?? []).map((tm) => ({
        ...tm,
        locationName: resolveEntity(tm.locationName),
        characterName: resolveEntity(tm.characterName),
      })),
      systemDeltas: s.systemDeltas
        ? {
            addedNodes: (s.systemDeltas.addedNodes ?? []).map((n) => ({
              ...n,
              concept: resolveSys(n.concept),
            })),
            addedEdges: (s.systemDeltas.addedEdges ?? []).map((e) => ({
              ...e,
              fromConcept: resolveSys(e.fromConcept),
              toConcept: resolveSys(e.toConcept),
            })),
          }
        : undefined,
    })),
    relationships: deduplicateBy(
      (r.relationships ?? []).map((rel) => ({
        ...rel,
        from: resolveEntity(rel.from),
        to: resolveEntity(rel.to),
      })),
      (rel) => `${rel.from}→${rel.to}`,
      (a, b) => ({ ...a, valence: b.valence }), // keep later valence
    ),
  }));

  // Market threads don't need per-chunk status stitching — evidence is
  // cumulative and each scene's delta is self-describing (logType + updates +
  // rationale). Outcome expansion is handled at thread-creation time by
  // unioning the outcome list across chunks.

  return reconciled;
}

/**
 * Phase 4a: Analyze thread dependencies on canonical (post-merge) thread list.
 * Runs after reconciliation to identify causal relationships between distinct threads.
 */
export async function analyzeThreading(
  canonicalThreads: string[],
  onToken?: (token: string, accumulated: string) => void,
): Promise<Record<string, string[]>> {
  if (canonicalThreads.length < 2) return {};

  const prompt = buildThreadingPrompt(canonicalThreads);
  const raw = await callAnalysis(prompt, THREADING_SYSTEM, onToken, "analyzeThreading");
  const json = extractJSON(raw);

  let parsed: { threadDependencies?: Record<string, unknown> };
  try {
    parsed = JSON.parse(json);
  } catch {
    const repaired = json
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\x00-\x1F\x7F]/g, (ch) =>
        ch === "\n" || ch === "\t" ? ch : "",
      );
    parsed = JSON.parse(repaired);
  }

  return resolveThreadDependencyIds(parsed.threadDependencies, canonicalThreads);
}

/** Convert the id→id[] dependency map emitted by the LLM into a
 *  description→description[] map. Out-of-range ids are silently dropped; a
 *  self-dependency (thread depends on itself) is also dropped. */
function resolveThreadDependencyIds(
  rawMap: Record<string, unknown> | undefined,
  threads: string[],
): Record<string, string[]> {
  if (!rawMap) return {};
  const out: Record<string, string[]> = {};
  for (const [keyRaw, valRaw] of Object.entries(rawMap)) {
    const keyIdx = parseIndex(keyRaw, threads.length);
    if (keyIdx === null) continue;
    const keyDesc = threads[keyIdx];
    if (!keyDesc) continue;
    if (!Array.isArray(valRaw)) continue;
    const deps: string[] = [];
    const seen = new Set<string>();
    for (const item of valRaw) {
      const depIdx = parseIndex(item, threads.length);
      if (depIdx === null || depIdx === keyIdx) continue;
      const depDesc = threads[depIdx];
      if (!depDesc || seen.has(depDesc)) continue;
      seen.add(depDesc);
      deps.push(depDesc);
    }
    if (deps.length > 0) out[keyDesc] = deps;
  }
  return out;
}

/**
 * Phase 5 — Fate re-extraction (lifecycle-aware, summary-based).
 *
 * First-pass structure extraction runs per-scene in parallel on raw prose, so
 * each chunk has no knowledge of what eventually wins a thread. Observation:
 * once the market diverges late-arc, probabilities never reverse — monotonic
 * local accumulation has no way to know a twist is landing.
 *
 * This phase re-scores per-scene threadDeltas using:
 *   1. Scene summaries (cheap, fast — no full prose re-read)
 *   2. Canonical thread list + coalesced outcomes (post-reconcile)
 *   3. Observed winner per thread — the outcome with the largest net evidence
 *      across all scenes, treated as the story's actual resolution
 *   4. Approximate resolution scene — where the winner's biggest committal
 *      evidence fired (used for pre/post-resolution framing)
 *
 * Runs in parallel with the existing analysis concurrency. On error for any
 * one scene, keeps the first-pass deltas (non-fatal).
 */
export async function reextractFateWithLifecycle(
  results: AnalysisChunkResult[],
  opts?: {
    onToken?: (token: string, accumulated: string) => void;
    onProgress?: (done: number, total: number) => void;
    onSceneStream?: (sceneIndex: number, accumulated: string) => void;
    onSceneStart?: (sceneIndex: number) => void;
    onSceneEnd?: (sceneIndex: number) => void;
    concurrency?: number;
    cancelled?: () => boolean;
  },
): Promise<AnalysisChunkResult[]> {
  const canonicalByDesc = new Map<string, { outcomes: string[]; participants: string[]; horizon?: ThreadHorizon }>();
  for (const r of results) {
    for (const t of r.threads ?? []) {
      const existing = canonicalByDesc.get(t.description);
      if (!existing) {
        canonicalByDesc.set(t.description, {
          outcomes: [...(t.outcomes ?? [])],
          participants: [...(t.participantNames ?? [])],
          horizon: t.horizon,
        });
      } else {
        const merged = new Set(existing.outcomes);
        for (const o of t.outcomes ?? []) merged.add(o);
        existing.outcomes = [...merged];
        // First non-empty horizon wins — chunks that re-mention the same
        // thread without a horizon classification are treated as silence,
        // not a downgrade.
        if (!existing.horizon && t.horizon) existing.horizon = t.horizon;
      }
    }
  }

  if (canonicalByDesc.size === 0) return results;

  // Summed net evidence per (thread, outcome) across the full corpus.
  // Peak-magnitude committal evidence per (thread, outcome) with scene index —
  // used to approximate where the resolution fires.
  const evidenceByThread = new Map<string, Map<string, number>>();
  const peakByThread = new Map<string, Map<string, { magnitude: number; sceneIndex: number }>>();
  const volumeByThread = new Map<string, number>();

  results.forEach((r, sceneIndex) => {
    for (const scene of r.scenes ?? []) {
      for (const td of scene.threadDeltas ?? []) {
        if (!canonicalByDesc.has(td.threadDescription)) continue;
        const bucket = evidenceByThread.get(td.threadDescription) ?? new Map<string, number>();
        const peakBucket = peakByThread.get(td.threadDescription) ?? new Map<string, { magnitude: number; sceneIndex: number }>();
        for (const u of td.updates ?? []) {
          if (!u || typeof u.outcome !== 'string' || typeof u.evidence !== 'number') continue;
          bucket.set(u.outcome, (bucket.get(u.outcome) ?? 0) + u.evidence);
          const isCommittal = td.logType === 'payoff' || td.logType === 'twist';
          if (isCommittal && Math.abs(u.evidence) >= 2) {
            const priorPeak = peakBucket.get(u.outcome);
            const mag = Math.abs(u.evidence);
            if (!priorPeak || mag > priorPeak.magnitude) {
              peakBucket.set(u.outcome, { magnitude: mag, sceneIndex });
            }
          }
        }
        evidenceByThread.set(td.threadDescription, bucket);
        peakByThread.set(td.threadDescription, peakBucket);
        volumeByThread.set(
          td.threadDescription,
          (volumeByThread.get(td.threadDescription) ?? 0) + (td.volumeDelta ?? 0),
        );
      }
    }
  });

  // Assemble the per-thread lifecycle summary the LLM will see.
  const canonicalThreads: FateReextractThread[] = [];
  for (const [description, { outcomes, horizon }] of canonicalByDesc.entries()) {
    if (outcomes.length < 2) continue;
    const evidenceMap = evidenceByThread.get(description) ?? new Map<string, number>();
    let winner = outcomes[0];
    let winnerScore = -Infinity;
    for (const o of outcomes) {
      const score = evidenceMap.get(o) ?? 0;
      if (score > winnerScore) {
        winnerScore = score;
        winner = o;
      }
    }
    const peakBucket = peakByThread.get(description);
    const resolutionSceneIndex = peakBucket?.get(winner)?.sceneIndex;
    canonicalThreads.push({
      description,
      outcomes,
      horizon,
      observedWinner: winner,
      resolutionSceneIndex,
      totalVolume: volumeByThread.get(description),
    });
  }

  if (canonicalThreads.length === 0) return results;

  const canonicalSet = new Set(canonicalThreads.map((t) => t.description));
  const canonicalOutcomeSets = new Map<string, Set<string>>();
  for (const t of canonicalThreads) {
    canonicalOutcomeSets.set(t.description, new Set(t.outcomes));
  }

  const concurrency = opts?.concurrency ?? ANALYSIS_CONCURRENCY;
  const totalScenes = results.length;
  const out: AnalysisChunkResult[] = results.slice();

  const indices = results
    .map((r, i) => (r && (r.scenes?.length ?? 0) > 0 ? i : -1))
    .filter((i) => i >= 0);
  let done = 0;

  const runOne = async (idx: number) => {
    if (opts?.cancelled?.()) return;
    const r = results[idx];
    const scene = r.scenes?.[0];
    if (!scene) {
      done++;
      opts?.onProgress?.(done, indices.length);
      return;
    }

    opts?.onSceneStart?.(idx);

    const summary = scene.summary && scene.summary.trim().length > 0
      ? scene.summary
      : (scene.prose ?? '').slice(0, 600);

    const priorDeltas: FateReextractPriorDelta[] = (scene.threadDeltas ?? [])
      .filter((td) => canonicalSet.has(td.threadDescription))
      .map((td) => ({
        threadDescription: td.threadDescription,
        logType: td.logType,
        updates: (td.updates ?? []).map((u) => ({ outcome: u.outcome, evidence: u.evidence })),
        volumeDelta: td.volumeDelta,
        addOutcomes: td.addOutcomes,
        rationale: td.rationale,
      }));

    const prompt = buildFateReextractPrompt({
      sceneIndex: idx,
      totalScenes,
      sceneSummary: summary,
      povName: scene.povName || undefined,
      locationName: scene.locationName || undefined,
      canonicalThreads,
      priorDeltas,
    });

    try {
      const raw = await callAnalysis(
        prompt,
        FATE_REEXTRACT_SYSTEM,
        opts?.onSceneStream
          ? (_t, acc) => opts.onSceneStream!(idx, acc)
          : undefined,
        "reextractFateWithLifecycle",
      );
      const parsed = parseMergeJSON<{ threadDeltas?: unknown[] }>(raw);
      const nextDeltas = sanitizeReextractedDeltas(parsed.threadDeltas, canonicalOutcomeSets);
      if (nextDeltas.length > 0 || (scene.threadDeltas?.length ?? 0) === 0) {
        const nextScene = { ...scene, threadDeltas: nextDeltas };
        out[idx] = { ...r, scenes: [nextScene, ...(r.scenes?.slice(1) ?? [])] };
      }
    } catch (err) {
      logWarning('Fate re-extract failed for scene (non-fatal)', err, {
        source: 'analysis',
        operation: 'fate-reextract',
        details: { sceneIdx: idx },
      });
    } finally {
      done++;
      opts?.onSceneEnd?.(idx);
      opts?.onProgress?.(done, indices.length);
    }
  };

  // Parallel worker loop.
  const queue = [...indices];
  const workers: Promise<void>[] = [];
  const workerCount = Math.min(concurrency, queue.length);
  for (let w = 0; w < workerCount; w++) {
    workers.push((async () => {
      while (queue.length > 0 && !opts?.cancelled?.()) {
        const next = queue.shift();
        if (next === undefined) return;
        await runOne(next);
      }
    })());
  }
  await Promise.all(workers);

  return out;
}

/** Validate and coerce re-extracted threadDeltas — drops entries referencing
 *  unknown threads, clamps evidence, strips unknown outcomes. Canonical
 *  outcome sets come from the reconciled thread list; anything outside the
 *  set is silently dropped rather than mapped (the coalesce phase is where
 *  variant→canonical mapping lives). */
function sanitizeReextractedDeltas(
  raw: unknown,
  canonicalOutcomeSets: Map<string, Set<string>>,
): AnalysisChunkResult['scenes'][0]['threadDeltas'] {
  if (!Array.isArray(raw)) return [];
  const out: AnalysisChunkResult['scenes'][0]['threadDeltas'] = [];
  const VALID_LOGTYPES = new Set([
    'pulse', 'setup', 'escalation', 'payoff', 'twist',
    'resistance', 'stall', 'callback', 'transition',
  ]);
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const desc = typeof e.threadDescription === 'string' ? e.threadDescription : '';
    if (!desc || !canonicalOutcomeSets.has(desc)) continue;
    const outcomeSet = canonicalOutcomeSets.get(desc)!;
    const logType = typeof e.logType === 'string' && VALID_LOGTYPES.has(e.logType)
      ? e.logType
      : 'pulse';
    const rawUpdates = Array.isArray(e.updates) ? e.updates : [];
    const updates: { outcome: string; evidence: number }[] = [];
    for (const u of rawUpdates) {
      if (!u || typeof u !== 'object') continue;
      const uo = u as Record<string, unknown>;
      const outcome = typeof uo.outcome === 'string' ? uo.outcome : '';
      if (!outcome || !outcomeSet.has(outcome)) continue;
      const rawEvidence = typeof uo.evidence === 'number' ? uo.evidence : 0;
      updates.push({ outcome, evidence: clampEvidence(rawEvidence) });
    }
    if (updates.length === 0 && logType !== 'pulse' && logType !== 'stall') continue;
    const volumeDelta = typeof e.volumeDelta === 'number'
      ? Math.max(0, Math.min(3, e.volumeDelta))
      : 0;
    const rationale = typeof e.rationale === 'string' ? e.rationale : '';
    const addOutcomes = Array.isArray(e.addOutcomes)
      ? e.addOutcomes.filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
      : undefined;
    out.push({
      threadDescription: desc,
      logType,
      updates,
      volumeDelta,
      rationale,
      ...(addOutcomes && addOutcomes.length > 0 ? { addOutcomes } : {}),
    });
  }
  return out;
}

// Lifecycle-era status normalisation has been removed — the market path emits
// evidence + outcomes directly, no status translation needed.

/** Check if a content string is subsumed by any entry in a set (exact or substring) */
function isContentSubsumed(norm: string, existing: Set<string>): boolean {
  if (existing.has(norm)) return true;
  for (const e of existing) {
    if (e.includes(norm) || norm.includes(e)) return true;
  }
  return false;
}

/** Merge two continuity arrays, dropping entries whose content is identical or near-identical (substring match) */
function mergeContinuity(
  a: { type: string; content: string }[],
  b: { type: string; content: string }[],
): { type: string; content: string }[] {
  const result = [...a];
  const existing = new Set(a.map((n) => n.content.toLowerCase().trim()));
  for (const node of b) {
    const norm = node.content.toLowerCase().trim();
    if (isContentSubsumed(norm, existing)) continue;
    result.push(node);
    existing.add(norm);
  }
  return result;
}

function higherSignificance(a: string, b: string): string {
  const rank: Record<string, number> = { minor: 0, notable: 1, key: 2 };
  return (rank[b] ?? 0) > (rank[a] ?? 0) ? b : a;
}

function higherRole(a: string, b: string): string {
  const rank: Record<string, number> = {
    transient: 0,
    recurring: 1,
    anchor: 2,
  };
  return (rank[b] ?? 0) > (rank[a] ?? 0) ? b : a;
}

function deduplicateBy<T>(
  items: T[],
  key: (item: T) => string,
  merge: (existing: T, incoming: T) => T,
): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (map.has(k)) {
      map.set(k, merge(map.get(k)!, item));
    } else {
      map.set(k, item);
    }
  }
  return [...map.values()];
}

// ── Meta-context sampling ────────────────────────────────────────────────────
// Builds a representative snapshot of the corpus for rules/systems/profile
// extraction. Samples evenly across chunks within a ~4000 char budget so it
// scales from 5 chunks to 500 without blowing up prompt size.

function buildMetaContext(
  results: AnalysisChunkResult[],
  characters: Record<string, Character>,
  threads: Record<string, Thread>,
  locations: Record<string, Location>,
  scenes: Record<string, Scene>,
  worldSummary: string,
): string {
  const lines: string[] = [];

  // ── World summary (cap at 2000 chars) ──
  lines.push(`WORLD SUMMARY: ${worldSummary.slice(0, 2000)}`);

  // ── Characters ──
  lines.push(
    `\nCHARACTERS: ${Object.values(characters)
      .map((c) => `${c.name} (${c.role})`)
      .join(", ")}`,
  );

  // ── Threads ──
  lines.push(
    `\nTHREADS: ${Object.values(threads)
      .map((t) => {
        const state = isThreadClosed(t) ? 'closed' : isThreadAbandoned(t) ? 'abandoned' : 'open';
        return `"${t.description}" [${state}]`;
      })
      .join(", ")}`,
  );

  // ── Locations ──
  lines.push(
    `\nLOCATIONS: ${Object.values(locations)
      .map((l) => l.name)
      .join(", ")}`,
  );

  // ── Scene summaries — evenly sampled across the full corpus ──
  const allScenes = Object.values(scenes);
  const SUMMARY_BUDGET = 8; // target sample count
  const summaryStep = Math.max(
    1,
    Math.floor(allScenes.length / SUMMARY_BUDGET),
  );
  const sampledSummaries: string[] = [];
  for (
    let i = 0;
    i < allScenes.length && sampledSummaries.length < SUMMARY_BUDGET;
    i += summaryStep
  ) {
    const s = allScenes[i];
    const pov =
      Object.values(characters).find((c) => c.id === s.povId)?.name ?? s.povId;
    sampledSummaries.push(`- [${pov}] ${s.summary.slice(0, 150)}`);
  }
  if (sampledSummaries.length > 0) {
    lines.push(
      `\nSCENE SUMMARIES (${sampledSummaries.length} evenly sampled from ${allScenes.length}):\n${sampledSummaries.join("\n")}`,
    );
  }

  // ── System knowledge concepts — deduplicated, capped ──
  const concepts = new Set<string>();
  for (const r of results) {
    for (const sc of r.scenes) {
      for (const n of sc.systemDeltas?.addedNodes ?? []) {
        if (n.concept) concepts.add(`${n.concept} (${n.type})`);
      }
    }
  }
  if (concepts.size > 0) {
    const sampled = [...concepts].slice(0, 25);
    lines.push(
      `\nWORLD KNOWLEDGE CONCEPTS (${sampled.length} of ${concepts.size}):\n${sampled.join(", ")}`,
    );
  }

  // ── Prose excerpts — sampled from early, middle, late for voice range ──
  const chunksWithProse: { chunkIdx: number; prose: string }[] = [];
  for (let ci = 0; ci < results.length; ci++) {
    for (const sc of results[ci].scenes) {
      if (sc.prose) {
        chunksWithProse.push({ chunkIdx: ci, prose: sc.prose });
        break; // one per chunk is enough
      }
    }
  }

  if (chunksWithProse.length > 0) {
    // Pick up to 4 excerpts: first, ~33%, ~66%, last
    const indices =
      chunksWithProse.length <= 4
        ? chunksWithProse.map((_, i) => i)
        : [
            0,
            Math.floor(chunksWithProse.length * 0.33),
            Math.floor(chunksWithProse.length * 0.66),
            chunksWithProse.length - 1,
          ];
    const unique = [...new Set(indices)];
    const excerpts = unique.map((i) => chunksWithProse[i].prose.slice(0, 2500));
    lines.push(
      `\nPROSE EXCERPTS (${excerpts.length} sampled from early/mid/late for voice range):\n${excerpts.map((e) => `---\n${e}\n---`).join("\n")}`,
    );
  } else {
    lines.push(
      "\n(no prose available — infer voice from summaries and world tone)",
    );
  }

  return lines.join("\n");
}

// ── Assemble Narrative ───────────────────────────────────────────────────────

/**
 * Phases of the `assembleNarrative` pass. Every phase below fires at least
 * once via `onStage`; iterable phases (currently `world-summaries`) also tick
 * with `current/total` progress until completion. Sync phases pass quickly
 * but still emit so the analysis sidebar advances cleanly through the whole
 * pipeline rather than freezing on a single label.
 *
 * Order is causal:
 *   ingest          → walk every chunk result and build entities + scenes
 *   arcs            → bind scenes into Arc records (uses upstream arcGroups)
 *   world-builds    → batch entities into WorldBuild commits (no LLM)
 *   world-summaries → LLM intent summary per WorldBuild (parallel pool)
 *   meta-extraction → LLM call for image style + prose profile + genre
 *   finalize        → wire branch/version pointers and emit the narrative
 *
 * Note: arc summarisation (directionVector / worldState) happens UPSTREAM
 * of this function, in `groupScenesIntoArcs`. It's already a discrete
 * pipeline phase before assemble runs.
 */
export const ASSEMBLE_STAGES = [
  'ingest',
  'arcs',
  'builds',
  'summaries',
  'meta',
  'finalize',
] as const;
export type AssembleStage = (typeof ASSEMBLE_STAGES)[number];

export type AssembleNarrativeOptions = {
  onToken?: (token: string, accumulated: string) => void;
  arcGroups?: { name: string; directionVector?: string; worldState?: string; sceneIndices: number[] }[];
  /** Stage-level progress for the analysis sidebar. `current`/`total` are
   *  populated for iterable stages (currently `world-summaries`). */
  onStage?: (stage: AssembleStage, current?: number, total?: number) => void;
  /** Cancellation hook. Currently honoured by the world-summary worker pool. */
  cancelled?: () => boolean;
  /** What to emit:
   *  - 'full' (default): scenes + arcs + per-batch world commits.
   *  - 'world': per-batch world commits only — scenes drop, arcs drop, and
   *    the system deltas the LLM emitted on those scenes are aggregated onto
   *    the WB they belong to (otherwise the knowledge would be lost). */
  extractionMode?: 'world' | 'full';
  // ── Precomputed phase outputs ─────────────────────────────────────────────
  // When supplied, assembly consumes them directly — no LLM round-trips. The
  // runner produces these in discrete phases before assembly, persists them
  // onto the analysis job, and passes them here. Regeneration (after the
  // narrative is deleted) reads them off the job, so assembly stays purely
  // deterministic.
  /** Per-WorldBuild intent summary, keyed by the deterministic WB id. */
  worldBuildSummaries?: Record<string, string>;
  /** Whole-work meta (image style, prose profile, genre, patterns). */
  meta?: import('@/types/narrative').AnalysisMeta;
  // ── First-run capture callbacks ───────────────────────────────────────────
  // Invoked AS the LLM outputs are produced, so the runner can persist them
  // onto the job for future regeneration.
  onWorldBuildSummariesResolved?: (summaries: Record<string, string>) => void;
  onMetaResolved?: (meta: import('@/types/narrative').AnalysisMeta) => void;
};

export async function assembleNarrative(
  title: string,
  results: AnalysisChunkResult[],
  threadDependencies: Record<string, string[]>,
  onTokenOrOptions?: ((token: string, accumulated: string) => void) | AssembleNarrativeOptions,
  arcGroupsLegacy?: { name: string; directionVector?: string; worldState?: string; sceneIndices: number[] }[],
): Promise<NarrativeState> {
  // Support legacy positional args while exposing the new options object.
  const options: AssembleNarrativeOptions =
    typeof onTokenOrOptions === 'function'
      ? { onToken: onTokenOrOptions, arcGroups: arcGroupsLegacy }
      : (onTokenOrOptions ?? { arcGroups: arcGroupsLegacy });
  const { onToken, arcGroups, onStage, cancelled } = options;
  const extractionMode: 'world' | 'full' = options.extractionMode ?? 'full';
  const providedSummaries = options.worldBuildSummaries;
  const providedMeta = options.meta;
  const PREFIX =
    title
      .replace(/[^a-zA-Z]/g, "")
      .slice(0, 3)
      .toUpperCase() || "TXT";
  let charCounter = 0,
    locCounter = 0,
    threadCounter = 0,
    sceneCounter = 0,
    arcCounter = 0,
    kCounter = 0,
    tkCounter = 0,
    sysCounter = 0,
    artifactCounter = 0;

  // Canonical analyzed-work id form: `<CLASS>-<WORK>-<N>`. No zero padding — see
  // narrative-utils.nextId for the same convention on generation-side ids.
  const nextId = (pre: string, counter: () => number) =>
    `${pre}-${PREFIX}-${counter()}`;
  const nextCharId = () => nextId("C", () => ++charCounter);
  const nextLocId = () => nextId("L", () => ++locCounter);
  const nextThreadId = () => nextId("T", () => ++threadCounter);
  const nextSceneId = () => nextId("S", () => ++sceneCounter);
  const nextArcId = () => nextId("ARC", () => ++arcCounter);
  const nextKId = () => nextId("K", () => ++kCounter);
  const nextTkId = () => nextId("TK", () => ++tkCounter);
  const nextSysId = () => nextId("SYS", () => ++sysCounter);
  const nextArtifactIdFn = () => nextId("A", () => ++artifactCounter);

  const charNameToId: Record<string, string> = {};
  const locNameToId: Record<string, string> = {};
  const threadDescToId: Record<string, string> = {};
  const artifactNameToId: Record<string, string> = {};
  const sysConceptToId: Record<string, string> = {}; // lowercase concept → SYS ID

  const getSysId = (concept: string) => {
    const key = concept.toLowerCase();
    if (!sysConceptToId[key]) sysConceptToId[key] = nextSysId();
    return sysConceptToId[key];
  };

  const getCharId = (name: string) => {
    if (!charNameToId[name]) charNameToId[name] = nextCharId();
    return charNameToId[name];
  };
  const getLocId = (name: string) => {
    if (!locNameToId[name]) locNameToId[name] = nextLocId();
    return locNameToId[name];
  };
  const getThreadId = (desc: string) => {
    if (!threadDescToId[desc]) threadDescToId[desc] = nextThreadId();
    return threadDescToId[desc];
  };
  const getArtifactId = (name: string) => {
    if (!artifactNameToId[name]) artifactNameToId[name] = nextArtifactIdFn();
    return artifactNameToId[name];
  };
  /** Resolve an entity name to its ID — checks characters first, then locations, then artifacts. Falls back to character ID. */
  const getEntityId = (name: string) =>
    charNameToId[name] ??
    locNameToId[name] ??
    artifactNameToId[name] ??
    getCharId(name);

  const characters: Record<string, Character> = {};
  const locations: Record<string, Location> = {};
  const artifactEntities: Record<string, Artifact> = {};
  const threads: Record<string, Thread> = {};
  const scenes: Record<string, Scene> = {};
  const arcs: Record<string, Arc> = {};
  const relationshipMap: Record<string, RelationshipEdge> = {};

  // Deferred knowledge: character/location knowledge extracted per-chunk will be
  // attributed to the first scene of that chunk so all knowledge flows through
  // scene deltas (enabling temporal filtering).
  // No deferred knowledge — continuity is built directly on entities during creation
  // Track which chunk each entity was first introduced in (for per-batch world commits)
  const charFirstChunk = new Map<string, number>();
  const locFirstChunk = new Map<string, number>();
  const threadFirstChunk = new Map<string, number>();
  const artifactFirstChunk = new Map<string, number>();
  const chunkFirstSceneId = new Map<number, string>(); // chunkIdx → first scene id
  const chunkSceneIds = new Map<number, string[]>(); // chunkIdx → all scene ids in chunk
  const allOrderedSceneIds: string[] = []; // flat ordered list for arc group assignment
  const seenSysNodeIds = new Set<string>(); // track knowledge nodes already added by prior scenes
  const seenSysEdgeKeys = new Set<string>(); // track knowledge edges already added (from→to→relation)

  onStage?.('ingest');

  for (let chunkIdx = 0; chunkIdx < results.length; chunkIdx++) {
    const ch = results[chunkIdx];
    // Characters — create entities with continuity built directly
    for (const c of ch.characters ?? []) {
      const id = getCharId(c.name);
      if (!characters[id]) {
        characters[id] = {
          id,
          name: c.name,
          role: c.role as Character["role"],
          threadIds: [],
          world: { nodes: {}, edges: [] },
          ...(c.imagePrompt ? { imagePrompt: c.imagePrompt } : {}),
        };
        charFirstChunk.set(id, chunkIdx);
      } else if (c.imagePrompt) {
        characters[id].imagePrompt = c.imagePrompt;
      }
      const rank: Record<string, number> = {
        transient: 0,
        recurring: 1,
        anchor: 2,
      };
      if ((rank[c.role] ?? 0) > (rank[characters[id].role] ?? 0)) {
        characters[id].role = c.role as Character["role"];
      }
    }

    // Locations — identity only; all lore flows through scene.worldDeltas
    for (const loc of ch.locations ?? []) {
      const id = getLocId(loc.name);
      if (!locations[id]) {
        const parentId = loc.parentName ? getLocId(loc.parentName) : null;
        const tiedCharacterIds = (loc.tiedCharacterNames ?? [])
          .map((n: string) => getCharId(n))
          .filter(Boolean);
        locations[id] = {
          id,
          name: loc.name,
          prominence: (loc.prominence &&
          ["domain", "place", "margin"].includes(loc.prominence)
            ? loc.prominence
            : "place") as Location["prominence"],
          parentId,
          tiedCharacterIds,
          threadIds: [],
          world: { nodes: {}, edges: [] },
          ...(loc.imagePrompt ? { imagePrompt: loc.imagePrompt } : {}),
        };
        locFirstChunk.set(id, chunkIdx);
      } else {
        if (loc.imagePrompt) locations[id].imagePrompt = loc.imagePrompt;
        const promRank: Record<string, number> = {
          margin: 0,
          place: 1,
          domain: 2,
        };
        if (
          (promRank[loc.prominence ?? ""] ?? 0) >
          (promRank[locations[id].prominence] ?? 0)
        ) {
          locations[id].prominence = loc.prominence as Location["prominence"];
        }
        // Accumulate tied characters across scenes (not just first creation)
        const newTied = (loc.tiedCharacterNames ?? [])
          .map((n: string) => getCharId(n))
          .filter(Boolean);
        for (const cid of newTied) {
          if (!locations[id].tiedCharacterIds.includes(cid)) {
            locations[id].tiedCharacterIds = [
              ...locations[id].tiedCharacterIds,
              cid,
            ];
          }
        }
      }
    }

    // Artifacts
    for (const a of ch.artifacts ?? []) {
      const id = getArtifactId(a.name);
      const ownerName = a.ownerName;
      const parentId = ownerName
        ? (charNameToId[ownerName] ??
          locNameToId[ownerName] ??
          getLocId(ownerName))
        : null;
      if (!artifactEntities[id]) {
        artifactEntities[id] = {
          id,
          name: a.name,
          significance: (["key", "notable", "minor"].includes(a.significance)
            ? a.significance
            : "notable") as Artifact["significance"],
          world: { nodes: {}, edges: [] },
          threadIds: [],
          parentId,
          ...(a.imagePrompt ? { imagePrompt: a.imagePrompt } : {}),
        };
        artifactFirstChunk.set(id, chunkIdx);
      } else {
        if (a.imagePrompt) artifactEntities[id].imagePrompt = a.imagePrompt;
        if (parentId) artifactEntities[id].parentId = parentId;
      }
    }

    // Threads — prediction markets with named outcomes. LLM analysis declares
    // outcomes per thread; binary is the default when the question is yes/no.
    // Later chunks may encounter the same thread and reference a superset of
    // outcomes — we union them in (outcome expansion mid-story is valid).
    for (const t of ch.threads ?? []) {
      const id = getThreadId(t.description);
      const newAnchors = (t.participantNames ?? []).map((name) => {
        if (charNameToId[name])
          return { id: charNameToId[name], type: "character" as const };
        if (locNameToId[name])
          return { id: locNameToId[name], type: "location" as const };
        return { id: getCharId(name), type: "character" as const };
      });
      // Normalize outcomes — dedupe, trim, default to binary if missing/invalid.
      const rawOutcomes = Array.isArray(t.outcomes)
        ? Array.from(new Set(t.outcomes.map((o: unknown) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean)))
        : [];
      const outcomes = rawOutcomes.length >= 2 ? rawOutcomes : ["yes", "no"];
      // Optional in-world base-rate prior from the LLM. Shape must match
      // outcomes; anything else falls back to uniform inside the helper.
      const rawPriorProbs = Array.isArray((t as { priorProbs?: unknown }).priorProbs)
        ? ((t as { priorProbs?: unknown }).priorProbs as unknown[]).map((v) =>
            typeof v === 'number' ? v : NaN,
          )
        : undefined;
      if (!threads[id]) {
        const rawHorizon = (t as { horizon?: unknown }).horizon;
        const horizon: ThreadHorizon = (typeof rawHorizon === 'string' &&
          (rawHorizon === 'short' || rawHorizon === 'medium' ||
            rawHorizon === 'long' || rawHorizon === 'epic'))
          ? rawHorizon
          : 'medium';
        threads[id] = {
          id,
          participants: newAnchors,
          description: t.description,
          outcomes,
          horizon,
          stances: {
            [NARRATOR_AGENT_ID]: newNarratorStance(
              outcomes.length,
              2,
              rawPriorProbs,
            ),
          },
          openedAt: "",
          dependents: [],
          threadLog: { nodes: {}, edges: [] },
        };
        threadFirstChunk.set(id, chunkIdx);
      } else {
        // Union outcomes — a later chunk may surface possibilities the earlier
        // one didn't. Extend logits with neutral priors to match.
        const existingOutcomeSet = new Set(threads[id].outcomes.map((o) => o.toLowerCase()));
        const addedOutcomes: string[] = [];
        for (const o of outcomes) {
          if (!existingOutcomeSet.has(o.toLowerCase())) {
            threads[id].outcomes.push(o);
            addedOutcomes.push(o);
            existingOutcomeSet.add(o.toLowerCase());
          }
        }
        if (addedOutcomes.length > 0) {
          const b = threads[id].stances[NARRATOR_AGENT_ID];
          if (b) {
            b.logits = [
              ...b.logits,
              ...new Array(addedOutcomes.length).fill(0),
            ];
          }
        }
        // Accumulate anchors.
        const existingAnchorIds = new Set(
          threads[id].participants.map((a) => a.id),
        );
        for (const anchor of newAnchors) {
          if (!existingAnchorIds.has(anchor.id)) {
            threads[id].participants.push(anchor);
            existingAnchorIds.add(anchor.id);
          }
        }
      }
    }

    // Scenes — collect into flat list; arcs created from arcGroups after loop
    const chScenes: Scene[] = [];
    const arcId = "__pending__"; // Will be assigned from arcGroups below

    for (const s of ch.scenes ?? []) {
      const sceneId = nextSceneId();
      const locationId = getLocId(s.locationName ?? "Unknown");
      const participantIds = (s.participantNames ?? []).map((n) =>
        getCharId(n),
      );
      const povId = s.povName
        ? getCharId(s.povName)
        : (participantIds[0] ?? "");

      const scene: Scene = {
        kind: "scene",
        id: sceneId,
        createdAt: new Date().toISOString(),
        arcId,
        locationId,
        povId,
        participantIds,
        events: s.events ?? [],
        threadDeltas: (s.threadDeltas ?? []).flatMap((tm) => {
          // Market extraction — LLM emits evidence per outcome directly.
          const threadId = getThreadId(tm.threadDescription);
          const thread = threads[threadId];
          // Compute allowed outcome set: thread's current outcomes plus any
          // outcomes this delta proposes to add. If the thread isn't known
          // yet (shouldn't happen — threads are populated first), default
          // to binary.
          const threadOutcomes = thread?.outcomes ?? ["yes", "no"];
          const rawAdd = Array.isArray(tm.addOutcomes) ? tm.addOutcomes : [];
          const allowed = new Set(threadOutcomes.map((o) => o.toLowerCase()));
          const addOutcomes: string[] = [];
          for (const raw of rawAdd) {
            const name = typeof raw === "string" ? raw.trim() : "";
            if (!name) continue;
            if (allowed.has(name.toLowerCase())) continue;
            allowed.add(name.toLowerCase());
            addOutcomes.push(name);
          }
          // Normalize updates against allowed outcomes (clamped evidence).
          const rawUpdates = Array.isArray(tm.updates) ? tm.updates : [];
          const updates = rawUpdates.flatMap((u) => {
            if (!u || typeof u.outcome !== "string") return [];
            if (!allowed.has(u.outcome.toLowerCase())) return [];
            const ev = typeof u.evidence === "number"
              ? clampEvidence(u.evidence)
              : 0;
            return [{ outcome: u.outcome, evidence: ev }];
          });
          const rawLogType = (typeof tm.logType === "string" ? tm.logType : "pulse").toLowerCase();
          const validLogTypes: ThreadLogNodeType[] = [
            "pulse", "transition", "setup", "escalation",
            "payoff", "twist", "callback", "resistance", "stall",
          ];
          const logType: ThreadLogNodeType = (validLogTypes as string[]).includes(rawLogType)
            ? (rawLogType as ThreadLogNodeType)
            : "pulse";
          const volumeDelta = typeof tm.volumeDelta === "number" ? tm.volumeDelta : 1;
          const rationale = typeof tm.rationale === "string" && tm.rationale.trim()
            ? tm.rationale.trim()
            : `Thread [${logType}]`;
          // Drop entirely empty deltas (no evidence, no volume, no expansion).
          if (updates.length === 0 && volumeDelta === 0 && addOutcomes.length === 0 && logType === "pulse") {
            return [];
          }
          // Keep the TK allocator + log-types import referenced even though
          // market logs now use deterministic scene-linked ids.
          void nextTkId;
          void THREAD_LOG_NODE_TYPES;
          return [{
            threadId,
            logType,
            volumeDelta,
            updates,
            rationale,
            ...(addOutcomes.length > 0 ? { addOutcomes } : {}),
          }];
        }),
        worldDeltas: (s.worldDeltas ?? []).map((km) => {
          const entityId = getEntityId(km.entityName);
          // Assign IDs in the order the LLM listed world nodes — applyWorldDelta
          // chains them sequentially via co_occurs during store replay.
          const nodes = (km.addedNodes ?? []).map((n) => ({
            id: nextKId(),
            content: n.content,
            type: (n.type || "trait") as WorldNodeType,
          }));
          return { entityId, addedNodes: nodes };
        }),
        relationshipDeltas: (s.relationshipDeltas ?? []).map((rm) => ({
          from: getCharId(rm.from),
          to: getCharId(rm.to),
          type: rm.type,
          valenceDelta: rm.valenceDelta ?? 0,
        })),
        artifactUsages:
          (() => {
            const aus = s.artifactUsages ?? [];
            if (aus.length === 0) return undefined;
            return aus
              .map((au) => ({
                artifactId: getArtifactId(au.artifactName),
                characterId: au.characterName
                  ? getCharId(au.characterName)
                  : null,
                usage: au.usage || "",
              }))
              .filter((au) => artifactEntities[au.artifactId]);
          })() || undefined,
        ownershipDeltas:
          (() => {
            const oms = s.ownershipDeltas ?? [];
            if (oms.length === 0) return undefined;
            return oms
              .map((om) => ({
                artifactId: getArtifactId(om.artifactName),
                fromId:
                  charNameToId[om.fromName] ??
                  locNameToId[om.fromName] ??
                  getLocId(om.fromName),
                toId:
                  charNameToId[om.toName] ??
                  locNameToId[om.toName] ??
                  getLocId(om.toName),
              }))
              .filter((om) => artifactEntities[om.artifactId]);
          })() || undefined,
        tieDeltas:
          (() => {
            const mms = s.tieDeltas ?? [];
            if (mms.length === 0) return undefined;
            return mms
              .map(
                (mm: {
                  locationName: string;
                  characterName: string;
                  action: string;
                }) => ({
                  locationId: getLocId(mm.locationName),
                  characterId: getCharId(mm.characterName),
                  action: mm.action as "add" | "remove",
                }),
              )
              .filter(
                (mm) =>
                  mm.characterId &&
                  (mm.action === "add" || mm.action === "remove"),
              );
          })() || undefined,
        // Unified attribution list — derived from the scene's own typed
        // fields by ensureSceneAttributions below (after the scene object is
        // assembled). Plus any re-mentioned system rules captured here, since
        // seenSysNodeIds is mutated by the systemDeltas IIFE that follows and
        // we need the pre-mutation view to distinguish re-mention (existing →
        // attribute) from genuine new ones (added → introduction).
        attributions: (() => {
          const attrs = new Set<string>();
          const wkm = s.systemDeltas;
          if (wkm?.addedNodes?.length) {
            for (const n of wkm.addedNodes) {
              const id = getSysId(n.concept);
              if (seenSysNodeIds.has(id)) attrs.add(id);
            }
          }
          return attrs.size > 0 ? Array.from(attrs) : undefined;
        })(),
        systemDeltas: (() => {
          const wkm = s.systemDeltas;
          if (!wkm) return undefined;
          // Only add nodes not already seen in prior scenes
          const addedNodes = (wkm.addedNodes ?? [])
            .filter((n) => !seenSysNodeIds.has(getSysId(n.concept)))
            .map((n) => {
              const id = getSysId(n.concept);
              seenSysNodeIds.add(id);
              return {
                id,
                concept: n.concept,
                type: ([
                  "principle",
                  "system",
                  "concept",
                  "tension",
                  "event",
                  "structure",
                  "environment",
                  "convention",
                  "constraint",
                ].includes(n.type)
                  ? n.type
                  : "concept") as SystemNodeType,
              };
            });
          const addedEdges = (wkm.addedEdges ?? [])
            .filter((e) => {
              // Only accept edges where both endpoints are declared nodes (known concepts)
              // sysConceptToId tracks all concepts with IDs assigned via getSysId
              const fromKey = e.fromConcept?.toLowerCase();
              const toKey = e.toConcept?.toLowerCase();
              if (!fromKey || !toKey) return false;
              const fromId = sysConceptToId[fromKey];
              const toId = sysConceptToId[toKey];
              // Both concepts must already exist as actual nodes (seen in some scene)
              return (
                !!fromId &&
                !!toId &&
                seenSysNodeIds.has(fromId) &&
                seenSysNodeIds.has(toId)
              );
            })
            .map((e) => ({
              from: getSysId(e.fromConcept),
              to: getSysId(e.toConcept),
              relation: e.relation,
            }))
            // Filter self-loops and cross-scene duplicates
            .filter((e) => {
              if (e.from === e.to) return false;
              const key = `${e.from}→${e.to}→${e.relation}`;
              if (seenSysEdgeKeys.has(key)) return false;
              seenSysEdgeKeys.add(key);
              return true;
            });
          if (addedNodes.length === 0 && addedEdges.length === 0)
            return undefined;
          return { addedNodes, addedEdges };
        })(),
        timeDelta: s.timeDelta ?? null,
        summary: s.summary ?? "",
        // Create version arrays for analyzed scenes
        proseVersions:
          s.prose || s.beatProseMap
            ? [
                {
                  prose: s.prose ?? "",
                  beatProseMap: s.beatProseMap,
                  branchId: "main",
                  timestamp: Date.now(),
                  version: "1",
                  versionType: "generate" as const,
                  ...(s.plan ? { sourcePlanVersion: "1" } : {}),
                },
              ]
            : undefined,
        planVersions: s.plan
          ? [
              {
                plan: s.plan,
                branchId: "main",
                timestamp: Date.now(),
                version: "1",
                versionType: "generate" as const,
              },
            ]
          : undefined,
        // Preserve embeddings from analysis pipeline
        summaryEmbedding: (s as any).summaryEmbedding,
        proseEmbedding: (s as any).proseEmbedding,
        planEmbeddingCentroid: (s as any).planEmbeddingCentroid,
      };

      // Fold derived attributions from typed delta fields (participants,
      // location, threads moved, world entities, artifact usages,
      // relationships, ownership, ties, movements) onto the SYS-only seed
      // captured during construction.
      ensureSceneAttributions(scene);

      scenes[sceneId] = scene;
      chScenes.push(scene);
      if (!chunkFirstSceneId.has(chunkIdx))
        chunkFirstSceneId.set(chunkIdx, sceneId);
    }

    // Distribute deferred knowledge across the chunk's scenes.
    // Each knowledge node goes to the first scene where that character participates,
    // spreading deltas naturally instead of spiking the first scene.
    if (chScenes.length > 0) {
      // Continuity is built directly on entities — no deferred flush needed
    }

    // Track scene order for arc group assignment below
    const chSceneIds = chScenes.map((s) => s.id);
    chunkSceneIds.set(chunkIdx, chSceneIds);
    allOrderedSceneIds.push(...chSceneIds);

    for (const tm of chScenes.flatMap((s) => s.threadDeltas)) {
      if (threads[tm.threadId] && !threads[tm.threadId].openedAt) {
        threads[tm.threadId].openedAt = chScenes[0]?.id;
      }
    }

    // Relationships — later chunks update type and valence (chronological last-write-wins)
    for (const r of ch.relationships ?? []) {
      const fromId = getCharId(r.from);
      const toId = getCharId(r.to);
      const key = `${fromId}→${toId}`;
      const existing = relationshipMap[key];
      if (existing) {
        // Keep latest type, but blend valence toward the newer value to show progression
        existing.type = r.type;
        existing.valence = r.valence;
      } else {
        relationshipMap[key] = {
          from: fromId,
          to: toId,
          type: r.type,
          valence: r.valence,
        };
      }
    }
  }

  // Ensure parent locations are at least as prominent as their children
  const promRankFinal: Record<string, number> = {
    margin: 0,
    place: 1,
    domain: 2,
  };
  for (const loc of Object.values(locations)) {
    if (loc.parentId && locations[loc.parentId]) {
      const parent = locations[loc.parentId];
      if (
        (promRankFinal[parent.prominence] ?? 0) <
        (promRankFinal[loc.prominence] ?? 0)
      ) {
        parent.prominence = loc.prominence;
      }
    }
  }

  // ── Create arcs from arcGroups ──────────────────────────────────────────────
  onStage?.('arcs');
  if (arcGroups && arcGroups.length > 0) {
    for (const group of arcGroups) {
      const arcId = nextArcId();
      const sceneIds = group.sceneIndices
        .filter((i) => i < allOrderedSceneIds.length)
        .map((i) => allOrderedSceneIds[i]);
      if (sceneIds.length === 0) continue;

      const arcScenes = sceneIds.map((id) => scenes[id]).filter(Boolean);
      const develops = [
        ...new Set(
          arcScenes.flatMap((s) => s.threadDeltas.map((tm) => tm.threadId)),
        ),
      ];
      const locationIds = [...new Set(arcScenes.map((s) => s.locationId))];
      const activeCharacterIds = [
        ...new Set(arcScenes.flatMap((s) => s.participantIds)),
      ];

      arcs[arcId] = {
        id: arcId,
        name: group.name,
        sceneIds,
        develops,
        locationIds,
        activeCharacterIds,
        directionVector: group.directionVector,
        worldState: group.worldState,
      };
      // Assign arcId to scenes
      for (const scene of arcScenes) scene.arcId = arcId;
    }
  } else {
    // Fallback: group every 4 scenes into an arc
    for (let i = 0; i < allOrderedSceneIds.length; i += 4) {
      const arcId = nextArcId();
      const sceneIds = allOrderedSceneIds.slice(i, i + 4);
      const arcScenes = sceneIds.map((id) => scenes[id]).filter(Boolean);
      const develops = [
        ...new Set(
          arcScenes.flatMap((s) => s.threadDeltas.map((tm) => tm.threadId)),
        ),
      ];
      const locationIds = [...new Set(arcScenes.map((s) => s.locationId))];
      const activeCharacterIds = [
        ...new Set(arcScenes.flatMap((s) => s.participantIds)),
      ];
      arcs[arcId] = {
        id: arcId,
        name: `Arc ${Math.floor(i / 4) + 1}`,
        sceneIds,
        develops,
        locationIds,
        activeCharacterIds,
      };
      for (const scene of arcScenes) scene.arcId = arcId;
    }
  }

  // Apply thread dependencies from reconciliation (description → array of dependent descriptions)
  const threadDescToIdMap = new Map(
    Object.values(threads).map((t) => [t.description, t.id]),
  );
  for (const [desc, depDescs] of Object.entries(threadDependencies)) {
    const threadId = threadDescToIdMap.get(desc);
    if (!threadId || !threads[threadId]) continue;
    for (const depDesc of depDescs) {
      const depId = threadDescToIdMap.get(depDesc);
      if (
        depId &&
        depId !== threadId &&
        !threads[threadId].dependents.includes(depId)
      ) {
        threads[threadId].dependents.push(depId);
      }
    }
  }

  // Wire thread IDs on characters/locations
  for (const thread of Object.values(threads)) {
    for (const anchor of thread.participants) {
      if (anchor.type === "character" && characters[anchor.id]) {
        if (!characters[anchor.id].threadIds.includes(thread.id))
          characters[anchor.id].threadIds.push(thread.id);
      }
      if (anchor.type === "location" && locations[anchor.id]) {
        if (!locations[anchor.id].threadIds.includes(thread.id))
          locations[anchor.id].threadIds.push(thread.id);
      }
    }
  }

  // Thread logs and world graphs are now derived from scene deltas by
  // store.tsx/computeDerivedEntities via applyWorldDelta on load. Entities start
  // with empty world graphs; the store builds them on replay with proper
  // within-scene chain edges and no cross-scene links.

  const relationships = Object.values(relationshipMap);

  // World builds — one per ~3 arcs (12 scenes), only when new entities are introduced.
  // The first batch always gets a commit; later batches are skipped if nothing new appeared.
  onStage?.('builds');
  const WORLD_COMMIT_INTERVAL = SCENES_PER_ARC * 3; // ~12 scenes = 3 arcs
  const worldBuilds: Record<string, WorldBuild> = {};
  // Map from the first scene id of a batch → the world build commit to insert before it
  const worldBuildBeforeScene = new Map<string, string>(); // sceneId → worldBuildId
  // Collected per-batch context for the LLM intent summariser. Populated in
  // the loop, then resolved in parallel after to give every WorldBuild a
  // real intent string downstream arc generation can steer from.
  const worldBuildSummaryInputs: {
    worldBuildId: string;
    isInitial: boolean;
    newCharNames: string[];
    newLocNames: string[];
    newThreadDescs: string[];
    newArtifactNames: string[];
    leadChapter: string;
  }[] = [];

  for (
    let batchStart = 0;
    batchStart < results.length;
    batchStart += WORLD_COMMIT_INTERVAL
  ) {
    const batchEnd = Math.min(
      batchStart + WORLD_COMMIT_INTERVAL,
      results.length,
    );
    const batchChunkIndices = new Set(
      Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i),
    );
    const isInitial = batchStart === 0;

    const newCharIds = Object.keys(characters).filter((id) =>
      batchChunkIndices.has(charFirstChunk.get(id) ?? 0),
    );
    const newLocIds = Object.keys(locations).filter((id) =>
      batchChunkIndices.has(locFirstChunk.get(id) ?? 0),
    );
    const newThreadIds = Object.keys(threads).filter((id) =>
      batchChunkIndices.has(threadFirstChunk.get(id) ?? 0),
    );
    const newArtifactIds = Object.keys(artifactEntities).filter((id) =>
      batchChunkIndices.has(artifactFirstChunk.get(id) ?? 0),
    );

    if (
      !isInitial &&
      newCharIds.length === 0 &&
      newLocIds.length === 0 &&
      newThreadIds.length === 0 &&
      newArtifactIds.length === 0
    )
      continue;

    const batchNum = Math.floor(batchStart / WORLD_COMMIT_INTERVAL) + 1;
    const worldBuildId = `WB-${PREFIX}-${batchNum}`;

    // Collect input data for the LLM intent summariser — applied after the
    // loop so all batches summarise in parallel. The placeholder here is
    // fine; downstream consumers see the real intent string once the
    // promises resolve below.
    const newCharNames = newCharIds
      .map((id) => characters[id]?.name)
      .filter((n): n is string => !!n);
    const newLocNames = newLocIds
      .map((id) => locations[id]?.name)
      .filter((n): n is string => !!n);
    const newThreadDescs = newThreadIds
      .map((id) => threads[id]?.description)
      .filter((d): d is string => !!d);
    const newArtifactNames = newArtifactIds
      .map((id) => artifactEntities[id]?.name)
      .filter((n): n is string => !!n);
    const leadChapter = results[batchStart]?.chapterSummary?.trim() ?? '';
    worldBuildSummaryInputs.push({
      worldBuildId,
      isInitial,
      newCharNames,
      newLocNames,
      newThreadDescs,
      newArtifactNames,
      leadChapter,
    });

    // World-only mode: the scenes that carried these deltas get dropped
    // from the final NarrativeState, so we migrate EVERYTHING they extracted
    // onto the WB they belong to — system, world (entity continuity),
    // thread (fate), relationships, ownership, location ties. The store's
    // existing replay machinery applies WB-level deltas the same way it
    // applies scene-level deltas, so nothing downstream needs to know which
    // mode produced the WB. In full mode the scenes survive and these stay
    // empty (the system / entity / thread state is replayed from scene
    // deltas at load time).
    const aggregatedSystemDeltas: SystemDelta = { addedNodes: [], addedEdges: [] };
    const aggregatedWorldDeltas: WorldDelta[] = [];
    const aggregatedThreadDeltas: ThreadDelta[] = [];
    const aggregatedRelationshipDeltas: RelationshipDelta[] = [];
    const aggregatedOwnershipDeltas: OwnershipDelta[] = [];
    const aggregatedTieDeltas: TieDelta[] = [];
    if (extractionMode === 'world') {
      const seenNodeIds = new Set<string>();
      const seenEdgeKeys = new Set<string>();
      for (const ci of batchChunkIndices) {
        const sceneIdsInChunk = chunkSceneIds.get(ci) ?? [];
        for (const sceneId of sceneIdsInChunk) {
          const scene = scenes[sceneId];
          if (!scene) continue;

          // System graph — dedupe by node id and edge key so the WB carries
          // a clean union of what the chunk's scenes discovered.
          const sd = scene.systemDeltas;
          if (sd) {
            for (const node of sd.addedNodes ?? []) {
              if (seenNodeIds.has(node.id)) continue;
              seenNodeIds.add(node.id);
              aggregatedSystemDeltas.addedNodes.push(node);
            }
            for (const edge of sd.addedEdges ?? []) {
              const key = `${edge.from}→${edge.to}→${edge.relation}`;
              if (seenEdgeKeys.has(key)) continue;
              seenEdgeKeys.add(key);
              aggregatedSystemDeltas.addedEdges.push(edge);
            }
          }

          // Entity continuity, thread evidence, relationship valence,
          // artifact ownership, character ↔ location ties — pass through
          // verbatim. Replay code dedupes downstream.
          for (const wd of scene.worldDeltas ?? []) aggregatedWorldDeltas.push(wd);
          for (const td of scene.threadDeltas ?? []) aggregatedThreadDeltas.push(td);
          for (const rd of scene.relationshipDeltas ?? []) aggregatedRelationshipDeltas.push(rd);
          for (const od of scene.ownershipDeltas ?? []) aggregatedOwnershipDeltas.push(od);
          for (const td of scene.tieDeltas ?? []) aggregatedTieDeltas.push(td);
        }
      }
    }

    // World-only mode: rewire each thread's `openedAt` to the WB that
    // introduces it. The chunk loop set `openedAt` to the scene that first
    // touched the thread, but those scenes get dropped from the final state
    // — leaving the sidebar with dangling references and rendering "No
    // threads yet". In full mode the scenes survive, so the original scene
    // anchor is correct and we leave it alone.
    if (extractionMode === 'world') {
      for (const tid of newThreadIds) {
        const t = threads[tid];
        if (t) t.openedAt = worldBuildId;
      }
    }

    worldBuilds[worldBuildId] = {
      kind: "world_build",
      id: worldBuildId,
      createdAt: new Date().toISOString(),
      summary: "",
      expansionManifest: {
        newCharacters: newCharIds.map((id) => characters[id]).filter(Boolean),
        newLocations: newLocIds.map((id) => locations[id]).filter(Boolean),
        newThreads: newThreadIds.map((id) => threads[id]).filter(Boolean),
        newArtifacts: newArtifactIds
          .map((id) => artifactEntities[id])
          .filter(Boolean),
        systemDeltas: aggregatedSystemDeltas,
        worldDeltas: aggregatedWorldDeltas,
        threadDeltas: aggregatedThreadDeltas,
        relationshipDeltas: aggregatedRelationshipDeltas,
        ownershipDeltas: aggregatedOwnershipDeltas,
        tieDeltas: aggregatedTieDeltas,
      },
    };
    // Fold derived attributions from the batch's typed deltas onto the
    // worldBuild so analysed narratives feed the network at expansion steps
    // the same way scene steps do.
    ensureExpansionAttributions(worldBuilds[worldBuildId].expansionManifest);

    // Find the first scene of the first chunk in this batch
    for (let ci = batchStart; ci < batchEnd; ci++) {
      const firstScene = chunkFirstSceneId.get(ci);
      if (firstScene) {
        worldBuildBeforeScene.set(firstScene, worldBuildId);
        break;
      }
    }
  }

  // Per-WorldBuild intent summaries. When the runner supplied them via
  // options.worldBuildSummaries (i.e. they were produced by the upstream
  // world-summaries phase and persisted on the job), apply them directly and
  // skip the LLM pool. Otherwise call the LLM in a sliding-window worker
  // pool capped at ANALYSIS_CONCURRENCY; on per-summary failure we drop in
  // a deterministic fallback so a flaky LLM doesn't sink assembly.
  onStage?.('summaries', 0, worldBuildSummaryInputs.length);
  const resolvedSummaries: Record<string, string> = {};
  if (providedSummaries && worldBuildSummaryInputs.length > 0) {
    // Pure path — no LLM round-trips.
    for (const input of worldBuildSummaryInputs) {
      const summary = providedSummaries[input.worldBuildId] ?? fallbackBatchSummary(input);
      resolvedSummaries[input.worldBuildId] = summary;
      const wb = worldBuilds[input.worldBuildId];
      if (wb) wb.summary = summary;
    }
    onStage?.('summaries', worldBuildSummaryInputs.length, worldBuildSummaryInputs.length);
  } else if (worldBuildSummaryInputs.length > 0) {
    let summaryDone = 0;
    const queue = [...worldBuildSummaryInputs];
    const workerCount = Math.min(ANALYSIS_CONCURRENCY, queue.length);
    const workers: Promise<void>[] = [];
    for (let w = 0; w < workerCount; w++) {
      workers.push(
        (async () => {
          while (queue.length > 0 && !cancelled?.()) {
            const input = queue.shift();
            if (!input) return;
            try {
              const summary = await summariseWorldBuildBatch(input);
              resolvedSummaries[input.worldBuildId] = summary;
              const wb = worldBuilds[input.worldBuildId];
              if (wb) wb.summary = summary;
            } catch (err) {
              logWarning(
                `World-build summary failed for ${input.worldBuildId}`,
                err,
                { source: 'analysis', operation: 'summariseWorldBuildBatch' },
              );
              const fallback = fallbackBatchSummary(input);
              resolvedSummaries[input.worldBuildId] = fallback;
              const wb = worldBuilds[input.worldBuildId];
              if (wb) wb.summary = fallback;
            } finally {
              summaryDone++;
              onStage?.('summaries', summaryDone, worldBuildSummaryInputs.length);
            }
          }
        })(),
      );
    }
    await Promise.all(workers);
  }
  options.onWorldBuildSummariesResolved?.(resolvedSummaries);

  // Variables are now per-arc and generated on-demand from the UI. The
  // analysis pipeline no longer extracts them — arcs come out with no
  // presentVariables and the Variables view shows the fresh-page seed
  // state until the user explicitly generates a set for that arc.

  // Build entryIds.
  //
  // Full mode:  world commits interleaved before their batch's first scene,
  //             then every scene in order — the canonical chronological view.
  // World mode: world commits only, in batch order. Scenes are dropped (the
  //             deltas they carried have been migrated onto the WBs above)
  //             so the operator can build their own continuity from the seed.
  const entryIds: string[] = [];
  if (extractionMode === 'world') {
    // Walk batches in their original ordering by reusing the lookup map.
    const orderedWbIds: string[] = [];
    const seenWb = new Set<string>();
    for (const sceneId of Object.keys(scenes)) {
      const wbId = worldBuildBeforeScene.get(sceneId);
      if (wbId && !seenWb.has(wbId)) {
        seenWb.add(wbId);
        orderedWbIds.push(wbId);
      }
    }
    // Append any WBs that didn't get attached to a scene (shouldn't happen,
    // but cheap safety net).
    for (const wbId of Object.keys(worldBuilds)) {
      if (!seenWb.has(wbId)) orderedWbIds.push(wbId);
    }
    entryIds.push(...orderedWbIds);
  } else {
    for (const sceneId of Object.keys(scenes)) {
      const worldBuildId = worldBuildBeforeScene.get(sceneId);
      if (worldBuildId) entryIds.push(worldBuildId);
      entryIds.push(sceneId);
    }
  }

  // Branch — build version pointers for analyzed scenes
  const branchId = `B-${PREFIX}-MAIN`;
  const versionPointers: Record<string, SceneVersionPointers> = {};

  // Set explicit version pointers for all scenes with version arrays
  for (const sceneId of Object.keys(scenes)) {
    const scene = scenes[sceneId];
    const pointers: SceneVersionPointers = {};

    if (scene.proseVersions && scene.proseVersions.length > 0) {
      pointers.proseVersion = scene.proseVersions[0].version;
    }

    if (scene.planVersions && scene.planVersions.length > 0) {
      pointers.planVersion = scene.planVersions[0].version;
    }

    if (pointers.proseVersion || pointers.planVersion) {
      versionPointers[sceneId] = pointers;
    }
  }

  const branches: Record<string, Branch> = {
    [branchId]: {
      id: branchId,
      name: "Canon Timeline",
      parentBranchId: null,
      forkEntryId: null,
      entryIds,
      versionPointers,
      createdAt: Date.now() - 86400000,
    },
  };

  const worldSummary = results.map((ch) => ch.chapterSummary).join(" ");

  // Meta extraction — image style + prose profile + genre + patterns. When
  // the runner supplied options.meta from the upstream meta-synthesis phase,
  // apply it directly; the LLM call is the costly step we skip on regenerate.
  onStage?.('meta');
  let imageStyle: string | undefined;
  let proseProfile: ProseProfile | undefined;
  let planGuidance = "";
  let paradigm: NarrativeParadigm | undefined;
  let genre: string | undefined;
  let subgenre: string | undefined;
  let patterns: string[] = [];
  let antiPatterns: string[] = [];

  if (providedMeta) {
    imageStyle = providedMeta.imageStyle;
    proseProfile = providedMeta.proseProfile;
    planGuidance = providedMeta.planGuidance ?? "";
    paradigm = providedMeta.paradigm;
    genre = providedMeta.genre;
    subgenre = providedMeta.subgenre;
    patterns = providedMeta.patterns ?? [];
    antiPatterns = providedMeta.antiPatterns ?? [];
  } else {
    try {
      const metaResult = await callAnalysis(
        buildMetaExtractionPrompt({
          metaContext: buildMetaContext(results, characters, threads, locations, scenes, worldSummary),
        }),
        META_EXTRACTION_SYSTEM,
        onToken,
        "metaExtraction",
      );
      const metaParsed = JSON.parse(extractJSON(metaResult));
      imageStyle = metaParsed.imageStyle;
      if (
        metaParsed.proseProfile &&
        typeof metaParsed.proseProfile === "object"
      ) {
        const pp = metaParsed.proseProfile;
        const str = (v: unknown) =>
          typeof v === "string" && v.trim() ? v.trim() : undefined;
        proseProfile = {
          register: str(pp.register) ?? "",
          stance: str(pp.stance) ?? "",
          tense: str(pp.tense),
          sentenceRhythm: str(pp.sentenceRhythm),
          interiority: str(pp.interiority),
          dialogueWeight: str(pp.dialogueWeight),
          devices: Array.isArray(pp.devices)
            ? pp.devices.filter((d: unknown) => typeof d === "string")
            : [],
          rules: Array.isArray(pp.rules)
            ? pp.rules.filter((r: unknown) => typeof r === "string")
            : [],
          antiPatterns: Array.isArray(pp.antiPatterns)
            ? pp.antiPatterns.filter((a: unknown) => typeof a === "string")
            : [],
        };
      }
      if (
        typeof metaParsed.planGuidance === "string" &&
        metaParsed.planGuidance.trim()
      ) {
        planGuidance = metaParsed.planGuidance.trim();
      }
      if (typeof metaParsed.paradigm === "string") {
        const raw = metaParsed.paradigm.trim().toLowerCase();
        if (VALID_PARADIGMS.has(raw as NarrativeParadigm)) {
          paradigm = raw as NarrativeParadigm;
        }
      }
      if (typeof metaParsed.genre === "string" && metaParsed.genre.trim()) {
        genre = metaParsed.genre.trim();
      }
      if (typeof metaParsed.subgenre === "string" && metaParsed.subgenre.trim()) {
        subgenre = metaParsed.subgenre.trim();
      }
      if (Array.isArray(metaParsed.patterns)) {
        patterns = metaParsed.patterns.filter((p: unknown) => typeof p === "string");
      }
      if (Array.isArray(metaParsed.antiPatterns)) {
        antiPatterns = metaParsed.antiPatterns.filter((p: unknown) => typeof p === "string");
      }
    } catch (err) {
      logWarning(
        "Style/profile extraction failed - using defaults",
        err instanceof Error ? err : String(err),
        {
          source: "analysis",
          operation: "meta-extraction",
          details: { title, chunkCount: results.length },
        },
      );
    }
  }
  options.onMetaResolved?.({
    imageStyle,
    proseProfile,
    planGuidance,
    paradigm,
    genre,
    subgenre,
    patterns,
    antiPatterns,
  });

  // World-only mode emits a seed: entities + per-batch world commits, no
  // chronology. The deltas every dropped scene carried have already been
  // migrated onto the WB they belong to (see the WB construction block
  // above), so the operator's first scene generation off this seed will
  // see a fully-populated world graph + system graph + thread state.
  const emitScenes = extractionMode === 'world' ? {} : scenes;
  const emitArcs = extractionMode === 'world' ? {} : arcs;

  const narrative: NarrativeState = {
    id: `N-${PREFIX}-${Date.now().toString(36)}`,
    title,
    description: results[0]?.chapterSummary || title,
    characters,
    locations,
    threads,
    artifacts: artifactEntities,
    arcs: emitArcs,
    scenes: emitScenes,
    worldBuilds,
    branches,
    relationships,
    systemGraph: { nodes: {}, edges: [] }, // derived — recomputed by withDerivedEntities on load
    worldSummary,
    imageStyle,
    proseProfile,
    storySettings: planGuidance
      ? { ...DEFAULT_STORY_SETTINGS, planGuidance }
      : undefined,
    paradigm,
    genre,
    subgenre,
    patterns: patterns.length > 0 ? patterns : undefined,
    antiPatterns: antiPatterns.length > 0 ? antiPatterns : undefined,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now(),
  };

  onStage?.('finalize');
  return narrative;
}
