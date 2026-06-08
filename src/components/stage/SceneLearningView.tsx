"use client";

/**
 * SceneLearningView — scene-level learning question bank.
 *
 * Renders the multiple-choice questions extracted from a scene: stem,
 * options (correct one marked), explanation, concept tags, and difficulty.
 * Purely additive — reads scene.questions, never mutates deltas.
 *
 * Generation is controlled from the StagePalette (Generate / Clear / Auto),
 * matching the plan / prose / decision pattern. This view listens for the
 * palette events. A "Practice" action hands off to the fullscreen Learn
 * modal scoped to this scene.
 */

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/state/store";
import { generateSceneQuestions } from "@/lib/ai";
import { embedQuestions } from "@/lib/search/embeddings";
import { useResolvedProse } from "@/hooks/useResolvedScene";
import { topicPath } from "@/lib/learning/curriculum";
import { useSceneBulkStream } from "@/lib/storage/bulk-stream-store";
import { IconCheck, IconTrash, IconQuestion } from "@/components/icons";
import type {
  BloomLevel,
  DifficultyBand,
  LearningQuestion,
  NarrativeState,
  Scene,
} from "@/types/narrative";

const BLOOM_STYLE: Record<BloomLevel, { label: string; cls: string }> = {
  remember: { label: "Remember", cls: "text-sky-400 bg-sky-500/10" },
  understand: { label: "Understand", cls: "text-emerald-400 bg-emerald-500/10" },
  apply: { label: "Apply", cls: "text-teal-400 bg-teal-500/10" },
  analyse: { label: "Analyse", cls: "text-amber-400 bg-amber-500/10" },
  evaluate: { label: "Evaluate", cls: "text-orange-400 bg-orange-500/10" },
  create: { label: "Create", cls: "text-rose-400 bg-rose-500/10" },
};

const DIFFICULTY_LABEL: Record<DifficultyBand, string> = {
  "very-easy": "Very easy",
  easy: "Easy",
  "easy-medium": "Easy–medium",
  medium: "Medium",
  "medium-hard": "Medium–hard",
  hard: "Hard",
  "very-hard": "Very hard",
};

export function SceneLearningView({
  narrative,
  scene,
}: {
  narrative: NarrativeState;
  scene: Scene;
}) {
  const { dispatch } = useStore();
  const questions = scene.questions ?? [];
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { prose: resolvedProse } = useResolvedProse(scene);

  const bulk = useSceneBulkStream(scene.id, "questions");
  const reasoning = bulk.text;
  const isStreaming = isGenerating || bulk.active;

  // Clear local error when the scene changes.
  useEffect(() => {
    setError(null);
  }, [scene.id]);

  // ── Palette events — generate / clear from StagePalette ──
  useEffect(() => {
    async function handleGenerate(e: Event) {
      if (isGenerating) return;
      const guidance = (e as CustomEvent).detail?.guidance as string | undefined;
      setIsGenerating(true);
      setError(null);
      window.dispatchEvent(new CustomEvent("bulk:questions-start", { detail: { sceneId: scene.id } }));
      try {
        const result = await generateSceneQuestions(narrative, scene, {
          prose: resolvedProse ?? undefined,
          guidance: guidance || undefined,
          onReasoning: (_token, accumulated) => {
            window.dispatchEvent(
              new CustomEvent("bulk:questions-reasoning", { detail: { sceneId: scene.id, token: accumulated } }),
            );
          },
        });
        // Embed the question stems up front so Expert search is usable without
        // a separate embed pass. Refs survive the id reassignment in
        // COMMIT_SCENE_QUESTIONS (it spreads `...q`). Best-effort: a failed
        // embed shouldn't block committing the questions themselves.
        let questions = result.questions;
        try {
          questions = await embedQuestions(questions, narrative.id);
        } catch {
          /* leave unembedded — the embeddings dashboard can backfill */
        }
        dispatch({
          type: "COMMIT_SCENE_QUESTIONS",
          sceneId: scene.id,
          questions,
          newTopics: result.newTopics,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        window.dispatchEvent(new CustomEvent("bulk:questions-complete", { detail: { sceneId: scene.id } }));
        setIsGenerating(false);
      }
    }

    function handleClear() {
      dispatch({ type: "CLEAR_SCENE_QUESTIONS", sceneId: scene.id });
      setError(null);
    }

    window.addEventListener("canvas:generate-questions", handleGenerate);
    window.addEventListener("canvas:clear-questions", handleClear);
    return () => {
      window.removeEventListener("canvas:generate-questions", handleGenerate);
      window.removeEventListener("canvas:clear-questions", handleClear);
    };
  }, [narrative, scene, resolvedProse, dispatch, isGenerating]);

  const deleteQuestion = useCallback(
    (id: string) => {
      dispatch({
        type: "SET_SCENE_QUESTIONS",
        sceneId: scene.id,
        questions: (scene.questions ?? []).filter((q) => q.id !== id),
      });
    },
    [scene.id, scene.questions, dispatch],
  );

  const practice = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("open-learn-modal", { detail: { scope: "scene", sceneId: scene.id } }),
    );
  }, [scene.id]);

  return (
    <div className="h-full w-full overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      <div className="max-w-3xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-[11px] uppercase tracking-wider text-text-dim/70">
            {questions.length} {questions.length === 1 ? "question" : "questions"}
          </span>
          {questions.length > 0 && (
            <button
              onClick={practice}
              className="ml-auto flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors"
            >
              <IconQuestion size={13} />
              Quiz this scene
            </button>
          )}
        </div>

        {/* Streaming state */}
        {isStreaming && questions.length === 0 && (
          <div className="pb-10">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 border-2 border-violet-400/30 border-t-violet-400/80 rounded-full animate-spin" />
              <span className="text-[10px] text-text-dim">
                {bulk.active && !isGenerating ? "Auto-extracting questions..." : "Extracting questions..."}
              </span>
            </div>
            {reasoning && (
              <p className="text-[11px] text-text-dim/60 leading-relaxed whitespace-pre-wrap">
                {reasoning}
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-[11px] text-red-300">
            {error}
          </div>
        )}

        {/* Empty state — mirrors the Prose / Audio minimal style */}
        {!isStreaming && questions.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center gap-1 py-32 text-center">
            <p className="text-[11px] text-text-dim">No questions for this scene yet.</p>
            <p className="text-[10px] text-text-dim/40">Use the palette below to generate questions.</p>
          </div>
        )}

        {/* Question list */}
        <div className="space-y-4">
          {questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              question={q}
              index={i}
              topicLabel={q.topicId ? topicPath(narrative.topics ?? {}, q.topicId) : undefined}
              onOpenTopic={
                q.topicId
                  ? () => dispatch({ type: "SET_INSPECTOR", context: { type: "topic", topicId: q.topicId! } })
                  : undefined
              }
              onOpenQuestion={() =>
                dispatch({
                  type: "SET_INSPECTOR",
                  context: { type: "question", sceneId: scene.id, questionId: q.id },
                })
              }
              onDelete={() => deleteQuestion(q.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  index,
  topicLabel,
  onOpenTopic,
  onOpenQuestion,
  onDelete,
}: {
  question: LearningQuestion;
  index: number;
  topicLabel?: string;
  onOpenTopic?: () => void;
  onOpenQuestion: () => void;
  onDelete: () => void;
}) {
  const bloom = BLOOM_STYLE[question.bloom] ?? BLOOM_STYLE.understand;
  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-4">
      <div className="flex items-start gap-3">
        <span className="text-[11px] font-mono text-text-dim/50 mt-0.5">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-text-primary leading-relaxed">{question.prompt}</p>
        </div>
        <span className={`shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${bloom.cls}`}>
          {bloom.label}
        </span>
        <span className="shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded text-text-dim bg-white/6">
          {DIFFICULTY_LABEL[question.difficulty] ?? "Medium"}
        </span>
        <button
          onClick={onDelete}
          className="shrink-0 p-1 rounded text-text-dim/50 hover:text-red-300 hover:bg-red-500/10 transition-colors"
          title="Delete question"
        >
          <IconTrash size={13} />
        </button>
      </div>

      <ul className="mt-3 space-y-1.5 pl-7">
        {question.options.map((opt, idx) => {
          const correct = idx === question.correctIndex;
          return (
            <li
              key={idx}
              className={`flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-md ${
                correct
                  ? "bg-emerald-500/10 text-emerald-200"
                  : "text-text-secondary"
              }`}
            >
              <span className="shrink-0 w-4 text-center">
                {correct ? (
                  <IconCheck size={12} />
                ) : (
                  <span className="text-text-dim/40 text-[10px] font-mono">
                    {String.fromCharCode(65 + idx)}
                  </span>
                )}
              </span>
              {opt}
            </li>
          );
        })}
      </ul>

      {question.explanation && (
        <p className="mt-3 pl-7 text-[11px] text-text-dim/80 leading-relaxed italic">
          {question.explanation}
        </p>
      )}

      <div className="mt-3 pl-7 flex flex-wrap items-center gap-1.5">
        {topicLabel ? (
          <button
            onClick={onOpenTopic}
            className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors"
            title="Open this topic in the inspector"
          >
            {topicLabel}
          </button>
        ) : (
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/6 text-text-dim/70">
            Untopiced
          </span>
        )}
        <button
          onClick={onOpenQuestion}
          className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded text-text-dim hover:text-text-secondary hover:bg-white/6 transition-colors ml-auto"
          title="Inspect / reassign this question"
        >
          Details
        </button>
      </div>
    </div>
  );
}
