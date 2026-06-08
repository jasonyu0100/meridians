/**
 * Learning (Quiz) generation — a purely additive, post-hoc layer.
 *
 * Given a scene (its structure, summary, and optionally its prose), extract an
 * exhaustive bank of multiple-choice questions testing the concepts a reader
 * should take from the scene, and assign each to a curriculum Topic. The
 * generator is fed the world view's EXISTING topic tree so it reuses existing
 * topics where they fit and only proposes new ones when the scene covers fresh
 * ground — the tree grows coherently instead of forking. Writes only to
 * scene.questions + narrative.topics; never mutates deltas, threadLogs, forces.
 */

import { nanoid } from "nanoid";
import { callGenerateStream, resolveReasoningBudget } from "./api";
import { learningContext } from "./context";
import { parseJson } from "./json";
import {
  buildLearningSystemPrompt,
  buildLearningUserPrompt,
} from "@/lib/prompts/learning";
import { renderTopicOutline } from "@/lib/learning/curriculum";
import { QUESTION_MODEL } from "@/lib/constants";
import { logError, logInfo } from "@/lib/core/system-logger";
import { BLOOM_LEVELS, DIFFICULTY_BANDS } from "@/types/narrative";
import type {
  BloomLevel,
  DifficultyBand,
  LearningQuestion,
  NarrativeState,
  Scene,
  Topic,
} from "@/types/narrative";

const VALID_BLOOM: ReadonlySet<BloomLevel> = new Set(BLOOM_LEVELS);
const VALID_DIFFICULTY: ReadonlySet<DifficultyBand> = new Set(DIFFICULTY_BANDS);

export type SceneQuestionResult = {
  questions: LearningQuestion[];
  /** Topics the generator proposed that don't yet exist — caller persists them
   *  (ADD_TOPICS) alongside the questions. */
  newTopics: Topic[];
};

function coerceBloom(v: unknown): BloomLevel {
  if (typeof v !== "string") return "understand";
  const s = v.trim().toLowerCase().replace("analyze", "analyse") as BloomLevel;
  return VALID_BLOOM.has(s) ? s : "understand";
}

function coerceDifficulty(v: unknown): DifficultyBand {
  if (typeof v !== "string") return "medium";
  const s = v.trim().toLowerCase().replace(/\s+/g, "-") as DifficultyBand;
  return VALID_DIFFICULTY.has(s) ? s : "medium";
}

/**
 * Fisher–Yates shuffle of answer options, tracking where the correct one
 * lands. Defends against the model's bias toward emitting the right answer
 * first.
 */
function shuffleOptions(
  options: string[],
  correctIndex: number,
): { options: string[]; correctIndex: number } {
  const tagged = options.map((opt, i) => ({ opt, correct: i === correctIndex }));
  for (let i = tagged.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
  }
  return {
    options: tagged.map((t) => t.opt),
    correctIndex: Math.max(0, tagged.findIndex((t) => t.correct)),
  };
}

/**
 * Reconcile the generator's proposed new topics into real Topic entities.
 * Returns the created topics plus a resolver mapping any topic ref the model
 * used (an existing id OR a freshly-minted tempId) to a real topic id.
 */
function reconcileTopics(
  rawNewTopics: unknown,
  existingTopics: Record<string, Topic>,
  createdAt: number,
): { newTopics: Topic[]; resolve: (ref: unknown) => string | undefined } {
  const list = Array.isArray(rawNewTopics) ? rawNewTopics : [];
  // Pass 1: allocate a real id for each proposed topic, keyed by its tempId.
  const tempToReal = new Map<string, string>();
  const specs: { tempId: string; name: string; parentRef: string | null; realId: string }[] = [];
  for (const raw of list) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name.trim() : "";
    if (!name) continue;
    const tempId =
      typeof c.tempId === "string" && c.tempId.trim()
        ? c.tempId.trim()
        : typeof c.id === "string" && c.id.trim()
          ? c.id.trim()
          : `tmp_${nanoid(6)}`;
    const parentRef =
      typeof c.parentId === "string" && c.parentId.trim()
        ? c.parentId.trim()
        : null;
    const realId = `topic_${nanoid(8)}`;
    tempToReal.set(tempId, realId);
    specs.push({ tempId, name, parentRef, realId });
  }

  const resolve = (ref: unknown): string | undefined => {
    if (typeof ref !== "string") return undefined;
    const r = ref.trim();
    if (!r) return undefined;
    if (existingTopics[r]) return r; // existing topic id
    if (tempToReal.has(r)) return tempToReal.get(r); // newly proposed
    return undefined;
  };

  // Pass 2: build Topic objects, resolving parent refs (existing id, tempId, or null).
  const newTopics: Topic[] = specs.map((s) => ({
    id: s.realId,
    name: s.name,
    parentId: s.parentRef ? (resolve(s.parentRef) ?? null) : null,
    createdAt,
  }));

  return { newTopics, resolve };
}

/** Sanitise one raw question. Returns null when unusable. */
function sanitiseQuestion(
  raw: unknown,
  sceneId: string,
  createdAt: number,
  resolveTopic: (ref: unknown) => string | undefined,
): LearningQuestion | null {
  const c = (raw ?? {}) as Record<string, unknown>;

  const prompt = typeof c.prompt === "string" ? c.prompt.trim() : "";
  if (!prompt) return null;

  const options = Array.isArray(c.options)
    ? c.options
        .map((o) => (typeof o === "string" ? o.trim() : ""))
        .filter((o) => o.length > 0)
    : [];
  if (options.length < 2) return null;
  const capped = options.slice(0, 6);

  let rawCorrect =
    typeof c.correctIndex === "number" ? Math.round(c.correctIndex) : 0;
  if (rawCorrect < 0 || rawCorrect >= capped.length) rawCorrect = 0;

  const { options: trimmedOptions, correctIndex } = shuffleOptions(
    capped,
    rawCorrect,
  );

  const explanation =
    typeof c.explanation === "string" && c.explanation.trim()
      ? c.explanation.trim()
      : undefined;

  // Accept `topicId`, `topic`, or `topicRef` from the model.
  const topicRef = c.topicId ?? c.topic ?? c.topicRef;

  return {
    id: `q_${nanoid(8)}`,
    sceneId,
    prompt,
    options: trimmedOptions,
    correctIndex,
    explanation,
    topicId: resolveTopic(topicRef),
    bloom: coerceBloom(c.bloom),
    difficulty: coerceDifficulty(c.difficulty),
    createdAt,
  };
}

/**
 * Generate an exhaustive bank of multiple-choice questions for one scene,
 * assigning each to a curriculum topic (existing or newly proposed).
 *
 * Streams reasoning tokens. Pass `prose` when available — the richest surface.
 */
export async function generateSceneQuestions(
  narrative: NarrativeState,
  scene: Scene,
  opts: {
    prose?: string;
    guidance?: string;
    onReasoning?: (token: string, accumulated: string) => void;
  } = {},
): Promise<SceneQuestionResult> {
  logInfo("Starting learning question extraction", {
    source: "analysis",
    operation: "generate-questions",
    details: { narrativeId: narrative.id, sceneId: scene.id },
  });

  // Existing topic tree → outline so the model extends rather than forks it.
  const existingTopics = narrative.topics ?? {};
  const topicCounts = new Map<string, number>();
  for (const s of Object.values(narrative.scenes)) {
    for (const q of s.questions ?? []) {
      if (q.topicId) topicCounts.set(q.topicId, (topicCounts.get(q.topicId) ?? 0) + 1);
    }
  }
  const topicOutline = renderTopicOutline(existingTopics, topicCounts);

  const systemPrompt = buildLearningSystemPrompt();
  const userPrompt = buildLearningUserPrompt(
    learningContext(narrative, scene, { prose: opts.prose }),
    { guidance: opts.guidance, topicOutline },
  );

  const reasoningBudget = resolveReasoningBudget(narrative);

  let fullReasoning = "";
  const raw = await callGenerateStream(
    userPrompt,
    systemPrompt,
    () => {},
    undefined,
    "generateSceneQuestions",
    QUESTION_MODEL,
    reasoningBudget,
    (token) => {
      fullReasoning += token;
      opts.onReasoning?.(token, fullReasoning);
    },
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = parseJson(raw, `generateSceneQuestions:${scene.id}`) as Record<
      string,
      unknown
    >;
  } catch (err) {
    logError("Failed to parse learning-questions response", err, {
      source: "analysis",
      operation: "parse",
      details: { sceneId: scene.id },
    });
    throw err;
  }

  const createdAt = Date.now();
  const { newTopics, resolve } = reconcileTopics(
    parsed.newTopics,
    existingTopics,
    createdAt,
  );

  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
  const questions = rawQuestions
    .map((q) => sanitiseQuestion(q, scene.id, createdAt, resolve))
    .filter((q): q is LearningQuestion => q !== null);

  // Keep new topics referenced by a surviving question, PLUS their new-topic
  // ancestors (so a proposed parent isn't dropped and dangled). Drops only
  // empty proposals the model invented but never used.
  const byId = new Map(newTopics.map((t) => [t.id, t]));
  const keep = new Set<string>();
  for (const q of questions) {
    let id = q.topicId;
    // walk up the chain of NEW topics (existing topics already persist)
    const guard = new Set<string>();
    while (id && byId.has(id) && !guard.has(id)) {
      keep.add(id);
      guard.add(id);
      id = byId.get(id)!.parentId ?? undefined;
    }
  }
  const keptTopics = newTopics.filter((t) => keep.has(t.id));

  return { questions, newTopics: keptTopics };
}
