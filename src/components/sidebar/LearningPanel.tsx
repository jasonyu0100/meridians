"use client";

// LearningPanel — sidebar surface for browsing a world view's question banks
// and launching scoped quizzes in the Learn modal.

import { useMemo, useState } from "react";
import { useStore } from "@/lib/state/store";
import {
  collectQuestions,
  quizTags,
  quizArcs,
  quizScenes,
  countByBloom,
} from "@/lib/learning/quiz";
import { BLOOM_LEVELS } from "@/types/narrative";
import type { BloomLevel, QuizScope } from "@/types/narrative";
import { IconLightbulb } from "@/components/icons";

const BLOOM_SHORT: Record<BloomLevel, string> = {
  remember: "Rem",
  understand: "Und",
  apply: "App",
  analyse: "Ana",
  evaluate: "Eva",
  create: "Cre",
};

type GroupMode = "tag" | "scene" | "arc";

export default function LearningPanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;
  const [groupMode, setGroupMode] = useState<GroupMode>("tag");

  const items = useMemo(
    () => (narrative ? collectQuestions(narrative, resolvedKeys) : []),
    [narrative, resolvedKeys],
  );
  const tags = useMemo(() => quizTags(items), [items]);
  const arcs = useMemo(() => quizArcs(items), [items]);
  const scenes = useMemo(() => quizScenes(items), [items]);
  const bloomCounts = useMemo(() => countByBloom(items), [items]);

  if (!narrative) {
    return (
      <div className="p-4 text-[11px] text-text-dim">
        Open a world view to browse its learning questions.
      </div>
    );
  }

  const openLearn = (detail: {
    scope: QuizScope;
    tag?: string;
    arcId?: string;
    sceneId?: string;
  }) => {
    window.dispatchEvent(new CustomEvent("open-learn-modal", { detail }));
  };

  const gotoScene = (sceneId: string) => {
    const idx = resolvedKeys.indexOf(sceneId);
    if (idx >= 0) {
      dispatch({ type: "SET_SCENE_INDEX", index: idx });
      dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "learning" });
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 h-9 px-3 border-b border-white/8 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-text-dim/70">
          {items.length} {items.length === 1 ? "question" : "questions"}
        </span>
        {items.length > 0 && (
          <button
            onClick={() => openLearn({ scope: "narrative" })}
            className="ml-auto flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors"
          >
            <IconLightbulb size={12} />
            Practice all
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-sm text-text-secondary">No questions yet.</p>
          <p className="mt-1 text-[11px] text-text-dim">
            Open a scene&apos;s <span className="text-text-secondary">Learn</span> tab and Generate, or
            run a range from the palette&apos;s Auto control.
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {/* Bloom distribution */}
          <div className="px-3 py-2.5 border-b border-white/5 flex flex-wrap gap-1.5">
            {BLOOM_LEVELS.filter((b) => bloomCounts[b]).map((b) => (
              <span
                key={b}
                className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/6 text-text-dim"
                title={b}
              >
                {BLOOM_SHORT[b]} {bloomCounts[b]}
              </span>
            ))}
          </div>

          {/* Group mode switch */}
          <div className="px-3 py-2 flex gap-1">
            {(["tag", "scene", "arc"] as GroupMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setGroupMode(m)}
                className={`text-[10px] px-2 py-1 rounded-md capitalize transition-colors ${
                  groupMode === m
                    ? "bg-white/10 text-text-primary"
                    : "text-text-dim hover:text-text-secondary hover:bg-white/5"
                }`}
              >
                By {m}
              </button>
            ))}
          </div>

          {/* Groups */}
          <div className="px-2 pb-4 space-y-1">
            {groupMode === "tag" &&
              tags.map(({ tag, count }) => (
                <GroupRow
                  key={tag}
                  label={tag}
                  count={count}
                  onClick={() => openLearn({ scope: "tag", tag })}
                />
              ))}
            {groupMode === "arc" &&
              arcs.map(({ arcId, arcName, count }) => (
                <GroupRow
                  key={arcId}
                  label={arcName}
                  count={count}
                  onClick={() => openLearn({ scope: "arc", arcId })}
                />
              ))}
            {groupMode === "scene" &&
              scenes.map(({ sceneId, sceneIndex, sceneLabel, count }) => (
                <GroupRow
                  key={sceneId}
                  label={`${sceneIndex}. ${sceneLabel || "Untitled scene"}`}
                  count={count}
                  onClick={() => openLearn({ scope: "scene", sceneId })}
                  onView={() => gotoScene(sceneId)}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupRow({
  label,
  count,
  onClick,
  onView,
}: {
  label: string;
  count: number;
  onClick: () => void;
  onView?: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md hover:bg-white/4 transition-colors">
      <button
        onClick={onClick}
        className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left"
        title="Practice these questions"
      >
        <span className="flex-1 min-w-0 truncate text-[12px] text-text-secondary group-hover:text-text-primary">
          {label}
        </span>
        <span className="shrink-0 text-[10px] font-mono text-text-dim/60">{count}</span>
      </button>
      {onView && (
        <button
          onClick={onView}
          className="shrink-0 mr-1.5 text-[10px] px-2 py-1 rounded bg-white/5 text-text-dim opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-text-secondary transition-all"
          title="View this scene's question bank"
        >
          View
        </button>
      )}
    </div>
  );
}
