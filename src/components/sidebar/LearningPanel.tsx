"use client";

// LearningPanel — sidebar surface for a member's coverage of the world view's
// curriculum. Shows overall coverage + mastery for the active learner, the
// branch-scoped knowledge tree (each topic's coverage/mastery rolled up), and
// launches focused or topic-scoped quizzes in the Learn modal. The tree IS the
// curriculum — questions are its building blocks, topics organise them.

import { useMemo, useState } from "react";
import { useStore } from "@/lib/state/store";
import { useActiveMember, memberName } from "@/hooks/useActiveMember";
import { collectQuestions } from "@/lib/learning/quiz";
import {
  memberQuestions,
  overallCoverage,
  type PresetId,
} from "@/lib/learning/coverage";
import {
  curriculumCoverage,
  pruneEmptyCoverage,
  type TopicCoverage,
} from "@/lib/learning/curriculum";
import { SOLO_LEARNER_ID } from "@/types/narrative";
import { IconLightbulb, IconChevronRight } from "@/components/icons";

/** Open the Learn modal — either a preset or a scoped selection. */
function openLearn(detail: { preset: PresetId } | { scope: string; topicId?: string }) {
  window.dispatchEvent(new CustomEvent("open-learn-modal", { detail }));
}

function masteryHex(c: TopicCoverage): string {
  if (c.covered === 0) return "#64748b";
  if (c.mastery >= 0.66) return "#34d399";
  if (c.mastery >= 0.33) return "#fbbf24";
  return "#f87171";
}

export default function LearningPanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;
  const { memberId } = useActiveMember();

  const memberList = useMemo(
    () => Object.values(narrative?.members ?? {}),
    [narrative?.members],
  );
  const hasRoster = memberList.length > 0;
  const learner = memberId ?? (hasRoster ? null : SOLO_LEARNER_ID);
  const learnerName = learner
    ? memberList.find((m) => m.id === learner)
      ? memberName(memberList.find((m) => m.id === learner)!)
      : "Solo"
    : null;

  const items = useMemo(
    () => (narrative ? collectQuestions(narrative, resolvedKeys) : []),
    [narrative, resolvedKeys],
  );
  const myQuestions = useMemo(
    () => memberQuestions(narrative?.learningProgress, learner ?? ""),
    [narrative?.learningProgress, learner],
  );
  const overall = useMemo(
    () => overallCoverage(items, myQuestions, Date.now()),
    [items, myQuestions],
  );
  const tree = useMemo(
    () =>
      narrative
        ? pruneEmptyCoverage(
            curriculumCoverage(narrative.topics ?? {}, items, myQuestions, Date.now()),
          )
        : [],
    [narrative, items, myQuestions],
  );

  if (!narrative) {
    return (
      <div className="p-4 text-[11px] text-text-dim">
        Open a world view to browse its learning coverage.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header — learner + focused review */}
      <div className="shrink-0 px-3 py-2 border-b border-white/8 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-text-dim/70">
          {items.length} {items.length === 1 ? "question" : "questions"}
          {learnerName && <span className="text-text-dim/50"> · {learnerName}</span>}
        </span>
        {items.length > 0 && learner && (
          <button
            onClick={() => openLearn({ preset: "focused" })}
            className="ml-auto flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors"
          >
            <IconLightbulb size={12} />
            Focused review{overall.due > 0 ? ` · ${overall.due}` : ""}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-sm text-text-secondary">No questions on this branch yet.</p>
          <p className="mt-1 text-[11px] text-text-dim">
            Open a scene&apos;s <span className="text-text-secondary">Questions</span> tab and
            Generate. Questions build the curriculum tree.
          </p>
        </div>
      ) : !learner ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-sm text-text-secondary">No active member.</p>
          <p className="mt-1 text-[11px] text-text-dim">
            Set the active member in <span className="text-text-secondary">Members</span> to track
            coverage, or pick one when you start a quiz.
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {/* Coverage + mastery summary */}
          <div className="px-3 py-3 border-b border-white/5 space-y-2.5">
            <SummaryBar
              label="Coverage"
              value={overall.coverage}
              hint={`${overall.covered}/${overall.total} seen`}
              color="#38bdf8"
            />
            <SummaryBar
              label="Mastery"
              value={overall.mastery}
              hint={overall.due > 0 ? `${overall.due} due` : "up to date"}
              color="#34d399"
            />
          </div>

          {/* Curriculum tree */}
          <div className="px-2 py-2">
            <div className="px-1 pb-1.5 text-[9px] uppercase tracking-widest text-text-dim/50">
              Curriculum · weakest first
            </div>
            {tree.map((node) => (
              <TopicRow
                key={node.topic.id}
                node={node}
                depth={0}
                onQuiz={(id) => openLearn({ scope: "topic", topicId: id })}
                onOpen={(id) => dispatch({ type: "SET_INSPECTOR", context: { type: "topic", topicId: id } })}
              />
            ))}
          </div>

          {/* Reset */}
          <div className="px-3 py-2 border-t border-white/5">
            <ResetProgress
              onReset={() =>
                dispatch({ type: "RESET_LEARNING_PROGRESS", memberId: learner })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryBar({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: number;
  hint: string;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-text-dim">{label}</span>
        <span className="text-[10px] font-mono text-text-dim/70 tabular-nums">
          {Math.round(value * 100)}% · {hint}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.round(value * 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

function TopicRow({
  node,
  depth,
  onQuiz,
  onOpen,
}: {
  node: TopicCoverage;
  depth: number;
  onQuiz: (topicId: string) => void;
  onOpen: (topicId: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className="group flex items-center gap-1.5 rounded-md hover:bg-white/4 transition-colors"
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          onClick={() => hasChildren && setOpen((o) => !o)}
          className={`shrink-0 w-4 h-4 flex items-center justify-center ${hasChildren ? "" : "invisible"}`}
        >
          <IconChevronRight
            size={9}
            className={`text-text-dim transition-transform ${open ? "rotate-90" : ""}`}
          />
        </button>
        <button
          onClick={() => onQuiz(node.topic.id)}
          className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left"
          title="Quiz this topic (and everything beneath it)"
        >
          <span className="flex-1 min-w-0 truncate text-[12px] text-text-secondary group-hover:text-text-primary">
            {node.topic.name}
          </span>
          {node.due > 0 && (
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400" title={`${node.due} due`} />
          )}
          <span className="shrink-0 text-[10px] font-mono text-text-dim/60 tabular-nums">
            {node.covered === 0 ? `${node.total}` : `${Math.round(node.mastery * 100)}%`}
          </span>
          <span
            className="shrink-0 w-8 h-1 rounded-full bg-white/8 overflow-hidden"
            title={`${node.covered}/${node.total} seen`}
          >
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.round(node.mastery * 100)}%`, background: masteryHex(node) }}
            />
          </span>
        </button>
        <button
          onClick={() => onOpen(node.topic.id)}
          className="shrink-0 mr-1.5 text-[10px] px-1.5 py-1 rounded text-text-dim/50 opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-text-secondary transition-all"
          title="Open topic in inspector"
        >
          ⋯
        </button>
      </div>
      {open &&
        node.children.map((c) => (
          <TopicRow key={c.topic.id} node={c} depth={depth + 1} onQuiz={onQuiz} onOpen={onOpen} />
        ))}
    </div>
  );
}

function ResetProgress({ onReset }: { onReset: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <button
        onClick={() => setConfirm(true)}
        className="text-[10px] text-text-dim/60 hover:text-text-secondary transition-colors"
      >
        Reset this member&apos;s progress
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-text-dim flex-1">Reset coverage?</span>
      <button
        onClick={() => {
          onReset();
          setConfirm(false);
        }}
        className="text-[10px] px-2 py-1 rounded bg-fate/20 text-fate hover:bg-fate/30 transition-colors"
      >
        Reset
      </button>
      <button
        onClick={() => setConfirm(false)}
        className="text-[10px] px-2 py-1 rounded text-text-dim hover:text-text-secondary transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
