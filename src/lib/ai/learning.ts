/**
 * Learning (Quiz) generation — a purely additive, post-hoc layer.
 *
 * Given a scene (its structure, summary, and optionally its prose) plus
 * full context on the surrounding world view, extract an exhaustive bank of
 * multiple-choice questions testing the general concepts and ideas a reader
 * should take from the scene. Writes only to scene.questions; never mutates
 * deltas, threadLogs, or forces.
 *
 * The context is deliberately whole-narrative aware: the world summary, the
 * cast/place roster, and the full timeline of scene summaries ride in so the
 * extractor can build plausible distractors from the world's own material and
 * frame questions correctly relative to everything that came before.
 */

import { nanoid } from "nanoid";
import { callGenerateStream, resolveReasoningBudget } from "./api";
import { parseJson } from "./json";
import {
  buildLearningSystemPrompt,
  buildLearningUserPrompt,
} from "@/lib/prompts/learning";
import { QUESTION_MODEL } from "@/lib/constants";
import { logError, logInfo } from "@/lib/core/system-logger";
import { resolveEntry, isScene, BLOOM_LEVELS, DIFFICULTY_BANDS } from "@/types/narrative";
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

function entityName(narrative: NarrativeState, id: string): string {
  return (
    narrative.characters[id]?.name ??
    narrative.locations[id]?.name ??
    narrative.artifacts[id]?.name ??
    id
  );
}

/**
 * Build the context block the extractor reads: world framing + cast/place
 * roster + the full timeline of scene summaries (target marked) + the
 * target scene's structural surface and prose when available.
 */
function buildLearningContext(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  prose?: string,
): string {
  const parts: string[] = [];

  // ── World framing ──
  parts.push("WORLD VIEW");
  parts.push(`Title: ${narrative.title}`);
  const genre = [narrative.genre, narrative.subgenre].filter(Boolean).join(" / ");
  if (genre) parts.push(`Genre: ${genre}`);
  if (narrative.worldSummary) {
    parts.push(`Summary: ${narrative.worldSummary}`);
  }
  parts.push("");

  // ── Roster — names only, so distractors can be built from real entities ──
  const chars = Object.values(narrative.characters);
  const locs = Object.values(narrative.locations);
  const arts = Object.values(narrative.artifacts);
  if (chars.length) {
    parts.push(
      `CHARACTERS: ${chars.map((c) => c.name).slice(0, 60).join(", ")}`,
    );
  }
  if (locs.length) {
    parts.push(
      `LOCATIONS: ${locs.map((l) => l.name).slice(0, 60).join(", ")}`,
    );
  }
  if (arts.length) {
    parts.push(
      `ARTIFACTS: ${arts.map((a) => a.name).slice(0, 60).join(", ")}`,
    );
  }
  parts.push("");

  // ── Full timeline of scene summaries (whole-narrative awareness) ──
  parts.push(
    "NARRATIVE TIMELINE — every scene's summary, in order. The target scene is marked >>> . Use surrounding scenes for context and as a source of plausible distractors; extract questions ONLY from the target scene.",
  );
  let idx = 0;
  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (!entry || !isScene(entry)) continue;
    idx += 1;
    const s = entry as Scene;
    const summary = (s.summary ?? "").slice(0, 200);
    const marker = s.id === scene.id ? ">>> " : "    ";
    parts.push(`${marker}S${idx}: ${summary}`);
  }
  parts.push("");

  // ── Target scene structural surface ──
  parts.push("TARGET SCENE — extract questions from this scene's content.");
  parts.push(`Summary: ${scene.summary}`);
  if (scene.povId) {
    parts.push(`POV: ${entityName(narrative, scene.povId)}`);
  }
  if (scene.locationId) {
    parts.push(`Setting: ${entityName(narrative, scene.locationId)}`);
  }
  if (scene.participantIds?.length) {
    parts.push(
      `Participants: ${scene.participantIds.map((p) => entityName(narrative, p)).join(", ")}`,
    );
  }
  if (scene.events?.length) {
    parts.push(`Events: ${scene.events.join("; ")}`);
  }
  if (scene.threadDeltas?.length) {
    parts.push("Thread movements (questions of consequence the scene advances):");
    for (const td of scene.threadDeltas) {
      const desc = narrative.threads[td.threadId]?.description ?? td.threadId;
      parts.push(`  - ${desc}`);
    }
  }
  if (scene.worldDeltas?.length) {
    parts.push("Revealed about entities (their inner state / history / properties):");
    for (const wd of scene.worldDeltas) {
      const name = entityName(narrative, wd.entityId);
      for (const node of wd.addedNodes ?? []) {
        parts.push(`  - ${name}: ${node.content}`);
      }
    }
  }
  if (scene.systemDeltas?.addedNodes?.length) {
    parts.push("Revealed about how the world works (rules, systems, concepts):");
    for (const node of scene.systemDeltas.addedNodes) {
      parts.push(`  - ${node.concept}`);
    }
  }
  if (scene.relationshipDeltas?.length) {
    parts.push("Relationship shifts:");
    for (const rd of scene.relationshipDeltas) {
      const fromName = entityName(narrative, rd.from);
      const toName = entityName(narrative, rd.to);
      parts.push(`  - ${fromName} → ${toName}: ${rd.type}`);
    }
  }

  // ── Prose — the richest extraction surface when it exists ──
  if (prose?.trim()) {
    parts.push("");
    parts.push("TARGET SCENE PROSE — the authoritative text. Read it closely; the questions test what a reader of this prose should understand.");
    parts.push(prose.trim());
  }

  return parts.join("\n");
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
  resolvedKeys: string[],
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
    buildLearningContext(narrative, scene, resolvedKeys, opts.prose),
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
