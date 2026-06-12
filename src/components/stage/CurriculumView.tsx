"use client";

/**
 * CurriculumView — the world view's Topic curriculum, rendered one of two ways
 * per the `view` prop (the Tree / List sub-tabs live in the StageBar, each
 * driving its own graphViewMode):
 *  • tree — a horizontal, collapsible mind-map. A synthetic root holds the
 *    top-level topics; each topic branches into its subtopics and its own
 *    questions (leaves). Connectors are pure-CSS rounded-corner rails (parent
 *    pills stretch to their subtree height, the connector meets the children
 *    rail at centre) — no layout measurement.
 *  • list — a vertically-stacked, indented, collapsible outline of the same
 *    forest: each topic is a row, depth maps to left indent, chevrons
 *    expand/collapse, questions nest as leaf rows.
 * Both views share the same coverage forest + questions and the same inspector
 * wiring. Count badges are tinted by the active learner's mastery. Clicking a
 * topic or question opens it in the inspector. Branch-scoped: only topics this
 * branch's questions touch appear.
 */

import { useStore } from "@/lib/state/store";
import { useActiveMember } from "@/hooks/useActiveMember";
import { collectQuestions } from "@/lib/learning/quiz";
import { curriculumCoverage, pruneEmptyCoverage } from "@/lib/learning/curriculum";
import type { TopicCoverage } from "@/lib/learning/curriculum";
import { memberQuestions } from "@/lib/learning/coverage";
import { SOLO_LEARNER_ID } from "@/types/narrative";
import { IconChevronRight, IconLightbulb } from "@/components/icons";
import { CurriculumRestructureModal } from "./CurriculumRestructureModal";
import { useMemo, useState } from "react";

type QLeaf = { id: string; prompt: string; sceneId: string };
type Variant = "only" | "first" | "last" | "mid";

function badgeClasses(c: TopicCoverage): string {
  if (c.covered === 0) return "bg-white/8 text-text-dim/70";
  if (c.mastery >= 0.66) return "bg-emerald-500/20 text-emerald-300";
  if (c.mastery >= 0.33) return "bg-amber-500/20 text-amber-300";
  return "bg-rose-500/20 text-rose-300";
}

const LINE = "bg-white/12";
const CORNER = "border-white/12";

/** A child's connector cell — a rounded rail segment whose shape depends on the
 *  child's position among its siblings. Width matches the parent's stub. */
function Connector({ variant }: { variant: Variant }) {
  return (
    <div className="shrink-0 w-8 flex flex-col" aria-hidden="true">
      {variant === "only" ? (
        <div className="flex-1 flex items-center">
          <div className={`w-full h-px ${LINE}`} />
        </div>
      ) : variant === "first" ? (
        <>
          <div className="flex-1" />
          <div className={`w-full h-3 border-l border-t ${CORNER} rounded-tl-lg`} />
          <div className={`flex-1 w-px ${LINE}`} />
        </>
      ) : variant === "last" ? (
        <>
          <div className={`flex-1 w-px ${LINE}`} />
          <div className={`w-full h-3 border-l border-b ${CORNER} rounded-bl-lg`} />
          <div className="flex-1" />
        </>
      ) : (
        <>
          <div className={`flex-1 w-px ${LINE}`} />
          <div className={`w-full h-px ${LINE}`} />
          <div className={`flex-1 w-px ${LINE}`} />
        </>
      )}
    </div>
  );
}

/** Wraps a node's children in the rail layout: parent stub + per-child connectors. */
function Children({ items }: { items: { key: string; el: React.ReactNode }[] }) {
  return (
    <div className="flex flex-col">
      {items.map((c, i) => {
        const variant: Variant =
          items.length === 1 ? "only" : i === 0 ? "first" : i === items.length - 1 ? "last" : "mid";
        return (
          <div key={c.key} className="flex items-stretch">
            <Connector variant={variant} />
            <div className="py-0.5">{c.el}</div>
          </div>
        );
      })}
    </div>
  );
}

function QuestionLeaf({ q, onOpen }: { q: QLeaf; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/2 px-3 py-2 text-left transition-colors hover:bg-white/6 hover:border-white/15 min-w-50 max-w-75"
      title={q.prompt}
    >
      <IconLightbulb size={13} className="shrink-0 text-amber-400" />
      <span className="text-[12px] text-text-secondary line-clamp-2 leading-snug">{q.prompt}</span>
    </button>
  );
}

function TopicNode({
  node,
  questionsByTopic,
  depth,
  selectedTopicId,
  defaultOpen,
  onTopic,
  onQuestion,
}: {
  node: TopicCoverage;
  questionsByTopic: Map<string, QLeaf[]>;
  depth: number;
  selectedTopicId: string | null;
  defaultOpen: boolean;
  onTopic: (id: string) => void;
  onQuestion: (q: QLeaf) => void;
}) {
  const directQs = questionsByTopic.get(node.topic.id) ?? [];
  const childCount = node.children.length + directQs.length;
  const [open, setOpen] = useState(defaultOpen);
  const expanded = open && childCount > 0;
  const selected = node.topic.id === selectedTopicId;

  // Whole node toggles expand (when it has children) and opens it in the
  // inspector — one click to drill the tree open.
  const box = (
    <button
      onClick={() => {
        if (childCount > 0) setOpen((o) => !o);
        onTopic(node.topic.id);
      }}
      title={node.topic.name}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors min-w-50 max-w-70 ${
        expanded ? "self-stretch" : ""
      } ${selected ? "border-accent/60 bg-accent/10" : "border-white/10 bg-white/3 hover:bg-white/6"}`}
    >
      {childCount > 0 ? (
        <IconChevronRight
          size={12}
          className={`shrink-0 -ml-0.5 text-text-dim transition-transform ${open ? "rotate-90" : ""}`}
        />
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <span className="flex-1 min-w-0 text-[13px] text-text-primary leading-snug truncate">
        {node.topic.name}
      </span>
      <span className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${badgeClasses(node)}`}>
        {node.total}
      </span>
    </button>
  );

  if (!expanded) return <div className="flex items-center">{box}</div>;

  const items = [
    ...node.children.map((c) => ({
      key: c.topic.id,
      el: (
        <TopicNode
          node={c}
          questionsByTopic={questionsByTopic}
          depth={depth + 1}
          selectedTopicId={selectedTopicId}
          defaultOpen={defaultOpen}
          onTopic={onTopic}
          onQuestion={onQuestion}
        />
      ),
    })),
    ...directQs.map((q) => ({ key: q.id, el: <QuestionLeaf q={q} onOpen={() => onQuestion(q)} /> })),
  ];

  return (
    <div className="flex items-stretch">
      <div className="flex items-stretch shrink-0">
        {box}
        <div className="flex items-center">
          <div className={`w-8 h-px shrink-0 ${LINE}`} aria-hidden="true" />
        </div>
      </div>
      <Children items={items} />
    </div>
  );
}

/** A single topic row in the indented List view, recursing into its subtopics
 *  and direct questions. Depth drives the left indent; the whole row toggles
 *  open and opens the topic in the inspector. */
function ListNode({
  node,
  questionsByTopic,
  depth,
  selectedTopicId,
  defaultOpen,
  onTopic,
  onQuestion,
}: {
  node: TopicCoverage;
  questionsByTopic: Map<string, QLeaf[]>;
  depth: number;
  selectedTopicId: string | null;
  defaultOpen: boolean;
  onTopic: (id: string) => void;
  onQuestion: (q: QLeaf) => void;
}) {
  const directQs = questionsByTopic.get(node.topic.id) ?? [];
  const childCount = node.children.length + directQs.length;
  const [open, setOpen] = useState(defaultOpen);
  const expanded = open && childCount > 0;
  const selected = node.topic.id === selectedTopicId;

  return (
    <div className="flex flex-col">
      <button
        onClick={() => {
          if (childCount > 0) setOpen((o) => !o);
          onTopic(node.topic.id);
        }}
        title={node.topic.name}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
          selected ? "border-accent/60 bg-accent/10" : "border-transparent hover:bg-white/5"
        }`}
        style={{ paddingLeft: 12 + depth * 20 }}
      >
        {childCount > 0 ? (
          <IconChevronRight
            size={12}
            className={`shrink-0 -ml-0.5 text-text-dim transition-transform ${open ? "rotate-90" : ""}`}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="flex-1 min-w-0 text-[13px] text-text-primary leading-snug truncate">
          {node.topic.name}
        </span>
        <span className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${badgeClasses(node)}`}>
          {node.total}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col">
          {node.children.map((c) => (
            <ListNode
              key={c.topic.id}
              node={c}
              questionsByTopic={questionsByTopic}
              depth={depth + 1}
              selectedTopicId={selectedTopicId}
              defaultOpen={defaultOpen}
              onTopic={onTopic}
              onQuestion={onQuestion}
            />
          ))}
          {directQs.map((q) => (
            <button
              key={q.id}
              onClick={() => onQuestion(q)}
              title={q.prompt}
              className="flex items-center gap-2 rounded-lg border border-transparent px-3 py-1.5 text-left transition-colors hover:bg-white/5"
              style={{ paddingLeft: 12 + (depth + 1) * 20 }}
            >
              <span className="w-3 shrink-0" />
              <IconLightbulb size={13} className="shrink-0 text-amber-400" />
              <span className="text-[12px] text-text-secondary line-clamp-1 leading-snug">{q.prompt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CurriculumView({ view }: { view: "tree" | "list" }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const topics = useMemo(() => narrative?.topics ?? {}, [narrative?.topics]);
  const [restructureOpen, setRestructureOpen] = useState(false);
  // Expand/collapse-all: nodes own their open state, so toggling flips the
  // default and bumps the epoch to remount the forest with that default.
  const [allExpanded, setAllExpanded] = useState(false);
  const [expandEpoch, setExpandEpoch] = useState(0);
  const { memberId } = useActiveMember();
  const members = useMemo(() => Object.values(narrative?.members ?? {}), [narrative?.members]);
  const learner = memberId ?? (members.length ? null : SOLO_LEARNER_ID);

  const items = useMemo(
    () => (narrative ? collectQuestions(narrative, state.resolvedEntryKeys) : []),
    [narrative, state.resolvedEntryKeys],
  );

  // Read the clock once via a lazy initializer (allowed — runs a single time,
  // not on every render) so coverage staleness/due calculations stay pure.
  // Coverage tolerates a stable "now" for the component's lifetime.
  const [now] = useState(() => Date.now());

  const forest = useMemo(() => {
    const q = learner ? memberQuestions(narrative?.learningProgress, learner) : {};
    return pruneEmptyCoverage(curriculumCoverage(topics, items, q, now));
  }, [topics, items, narrative?.learningProgress, learner, now]);

  const questionsByTopic = useMemo(() => {
    const m = new Map<string, QLeaf[]>();
    for (const it of items) {
      if (!it.q.topicId) continue;
      const arr = m.get(it.q.topicId) ?? [];
      arr.push({ id: it.q.id, prompt: it.q.prompt, sceneId: it.sceneId });
      m.set(it.q.topicId, arr);
    }
    return m;
  }, [items]);

  const totalQuestions = items.filter((it) => it.q.topicId).length;
  const selectedTopicId =
    state.viewState.inspectorContext?.type === "topic"
      ? state.viewState.inspectorContext.topicId
      : null;

  if (!narrative) return null;

  const onTopic = (id: string) => dispatch({ type: "SET_INSPECTOR", context: { type: "topic", topicId: id } });
  const onQuestion = (q: QLeaf) =>
    dispatch({ type: "SET_INSPECTOR", context: { type: "question", sceneId: q.sceneId, questionId: q.id } });

  const rootItems = forest.map((node) => ({
    key: node.topic.id,
    el: (
      <TopicNode
        node={node}
        questionsByTopic={questionsByTopic}
        depth={1}
        selectedTopicId={selectedTopicId}
        defaultOpen={allExpanded}
        onTopic={onTopic}
        onQuestion={onQuestion}
      />
    ),
  }));

  if (forest.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3 text-center px-8">
        <p className="text-[11px] text-text-dim">No curriculum on this branch yet.</p>
        <p className="text-[10px] text-text-dim/40 max-w-md">
          Generate a scene&apos;s questions (Questions tab) to seed topics. Each branch builds
          its own knowledge tree from the questions on its timeline.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 w-full h-full overflow-auto">
      {/* Top-right toolbar — Expand/Collapse all stacked above Restructure. */}
      <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
        <button
          onClick={() => {
            setAllExpanded((e) => !e);
            setExpandEpoch((n) => n + 1);
          }}
          title={allExpanded ? "Collapse all topics" : "Expand all topics"}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md bg-white/8 text-text-secondary hover:bg-white/12 hover:text-text-primary transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {allExpanded ? (
              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
            ) : (
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            )}
          </svg>
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
        {/* Restructure — reorganise the global topic tree with AI. */}
        <button
          onClick={() => setRestructureOpen(true)}
          title="Reorganise the topic tree with AI — merge duplicates, rebalance, re-nest"
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
          Restructure
        </button>
      </div>
      {restructureOpen && <CurriculumRestructureModal onClose={() => setRestructureOpen(false)} />}

      {view === "tree" ? (
        <div key={expandEpoch} className="inline-flex items-stretch min-w-max p-10">
          {/* Synthetic root */}
          <div className="flex items-stretch shrink-0">
            <div className="flex items-center self-stretch gap-2 rounded-xl border border-white/12 bg-white/5 px-3.5 py-3 min-w-45">
              <span className="flex-1 text-[13px] font-semibold text-text-primary truncate" title={narrative.title}>
                {narrative.title}
              </span>
              <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-white/8 text-text-dim/70">
                {totalQuestions}
              </span>
            </div>
            <div className="flex items-center">
              <div className={`w-8 h-px shrink-0 ${LINE}`} aria-hidden="true" />
            </div>
          </div>
          <Children items={rootItems} />
        </div>
      ) : (
        <div key={expandEpoch} className="p-4">
          <div className="flex flex-col max-w-2xl mx-auto">
            {forest.map((node) => (
              <ListNode
                key={node.topic.id}
                node={node}
                questionsByTopic={questionsByTopic}
                depth={0}
                selectedTopicId={selectedTopicId}
                defaultOpen={allExpanded}
                onTopic={onTopic}
                onQuestion={onQuestion}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
