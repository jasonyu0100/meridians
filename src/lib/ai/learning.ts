/**
 * Learning (Quiz) generation — a purely additive, post-hoc layer.
 *
 * Given a scene (its structure, summary, and optionally its prose), extract
 * an exhaustive bank of multiple-choice questions testing the general
 * concepts and ideas a reader should take from the scene. Writes only to
 * scene.questions; never mutates deltas, threadLogs, or forces.
 *
 * Extraction is scene-specific: the context comes from `learningContext`,
 * which wraps the canonical `sceneContext` XML (the same structural surface
 * plan / prose / game read) plus the scene's prose and a light world-view
 * framing line — so questions stay anchored to THIS scene rather than the
 * whole narrative.
 */

import { nanoid } from "nanoid";
import { callGenerateStream, resolveReasoningBudget } from "./api";
import { learningContext } from "./context";
import { parseJson } from "./json";
import {
  buildLearningSystemPrompt,
  buildLearningUserPrompt,
} from "@/lib/prompts/learning";
import { QUESTION_MODEL } from "@/lib/constants";
import { logError, logInfo } from "@/lib/core/system-logger";
import { BLOOM_LEVELS, DIFFICULTY_BANDS } from "@/types/narrative";
import type {
  BloomLevel,
  DifficultyBand,
  LearningQuestion,
  NarrativeState,
  Scene,
} from "@/types/narrative";

const VALID_BLOOM: ReadonlySet<BloomLevel> = new Set(BLOOM_LEVELS);
const VALID_DIFFICULTY: ReadonlySet<DifficultyBand> = new Set(DIFFICULTY_BANDS);

function coerceBloom(v: unknown): BloomLevel {
  if (typeof v !== "string") return "understand";
  // Tolerate the American "analyze" spelling.
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
 * lands. Returns the reordered options and the new correct index. Defends
 * against the model's bias toward emitting the right answer first.
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
 * Sanitise one raw question object from the LLM. Returns null when the
 * question is unusable (no stem, fewer than two options, no resolvable
 * correct answer).
 */
function sanitiseQuestion(
  raw: unknown,
  sceneId: string,
  createdAt: number,
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
  // Cap at 6 options to keep the UI sane.
  const capped = options.slice(0, 6);

  let rawCorrect =
    typeof c.correctIndex === "number" ? Math.round(c.correctIndex) : 0;
  if (rawCorrect < 0 || rawCorrect >= capped.length) rawCorrect = 0;

  // Randomise option order. LLMs lean toward placing the correct answer
  // first; shuffling here means the stored bank carries no positional bias,
  // and the same order shows in both the annotated bank view and practice.
  const { options: trimmedOptions, correctIndex } = shuffleOptions(
    capped,
    rawCorrect,
  );

  const rawTags = Array.isArray(c.tags)
    ? c.tags
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter((t) => t.length > 0)
    : [];
  // Always carry at least one tag so cross-scene grouping never drops a question.
  const tags = rawTags.length ? Array.from(new Set(rawTags)).slice(0, 4) : ["General"];

  const explanation =
    typeof c.explanation === "string" && c.explanation.trim()
      ? c.explanation.trim()
      : undefined;

  return {
    id: `q_${nanoid(8)}`,
    sceneId,
    prompt,
    options: trimmedOptions,
    correctIndex,
    explanation,
    tags,
    bloom: coerceBloom(c.bloom),
    difficulty: coerceDifficulty(c.difficulty),
    createdAt,
  };
}

/**
 * Generate an exhaustive bank of multiple-choice questions for one scene.
 *
 * Streams reasoning tokens so the UI can show the extractor thinking. Pass
 * `prose` when the scene's resolved prose is available — it is the richest
 * extraction surface; without it the structural deltas + summary carry the
 * load.
 */
export async function generateSceneQuestions(
  narrative: NarrativeState,
  scene: Scene,
  opts: {
    prose?: string;
    guidance?: string;
    onReasoning?: (token: string, accumulated: string) => void;
  } = {},
): Promise<LearningQuestion[]> {
  logInfo("Starting learning question extraction", {
    source: "analysis",
    operation: "generate-questions",
    details: { narrativeId: narrative.id, sceneId: scene.id },
  });

  const systemPrompt = buildLearningSystemPrompt();
  const userPrompt = buildLearningUserPrompt(
    learningContext(narrative, scene, { prose: opts.prose }),
    opts.guidance,
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
  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
  return rawQuestions
    .map((q) => sanitiseQuestion(q, scene.id, createdAt))
    .filter((q): q is LearningQuestion => q !== null);
}
