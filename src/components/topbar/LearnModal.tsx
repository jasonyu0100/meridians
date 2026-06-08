"use client";

/**
 * LearnModal — fullscreen quiz runner for reinforcing the concepts and ideas
 * captured across a world view's scenes.
 *
 * Three phases: SETUP (choose scope + filters → assemble a question pool),
 * RUNNING (one question at a time, immediate feedback), DONE (score +
 * review). Scope can be the whole narrative, one arc, one scene, or a single
 * concept tag. Bloom level and difficulty band act as additional filters.
 *
 * Pure consumer of scene.questions — assembles its pool through the shared
 * quiz helpers and never mutates state.
 */

import { useEffect, useMemo, useState } from "react";
import { Modal, ModalHeader, ModalBody } from "@/components/Modal";
import { Segmented } from "@/components/ui/Segmented";
import { IconCheck, IconClose, IconQuestion } from "@/components/icons";
import { useStore } from "@/lib/state/store";
import { useActiveMember, memberName } from "@/hooks/useActiveMember";
import {
  collectQuestions,
  quizArcs,
  quizScenes,
  selectScope,
  shuffleQuestions,
  type QuestionWithMeta,
  type ScopeSelection,
} from "@/lib/learning/quiz";
import {
  buildPresetPool,
  buildFocusedPool,
  memberQuestions,
  type PresetId,
} from "@/lib/learning/coverage";
import { buildTopicTree, topicPath, type TopicNode } from "@/lib/learning/curriculum";
import { Avatar } from "@/components/stage/RoomUI";
import {
  BLOOM_LEVELS,
  DIFFICULTY_BANDS,
  SOLO_LEARNER_ID,
} from "@/types/narrative";
import type {
  BloomLevel,
  DifficultyBand,
  Member,
  NarrativeState,
  QuizScope,
  Topic,
} from "@/types/narrative";

const BLOOM_LABEL: Record<BloomLevel, string> = {
  remember: "Remember",
  understand: "Understand",
  apply: "Apply",
  analyse: "Analyse",
  evaluate: "Evaluate",
  create: "Create",
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

type Phase = "setup" | "running" | "done";

export function LearnModal({
  narrative,
  resolvedKeys,
  initial,
  preset,
  onClose,
}: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  initial?: ScopeSelection;
  /** When set, skip setup and auto-start this preset (once a learner is chosen). */
  preset?: PresetId | null;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const items = useMemo(
    () => collectQuestions(narrative, resolvedKeys),
    [narrative, resolvedKeys],
  );
  const topics = useMemo(() => narrative.topics ?? {}, [narrative.topics]);
  const topicTree = useMemo(() => buildTopicTree(topics), [topics]);
  const arcs = useMemo(() => quizArcs(items), [items]);
  const scenes = useMemo(() => quizScenes(items), [items]);

  // ── Learner — whoever sits down states which member they are ──────────────
  const memberList = useMemo(
    () => Object.values(narrative.members ?? {}),
    [narrative.members],
  );
  const hasRoster = memberList.length > 0;
  const { memberId, setMemberId } = useActiveMember();
  // No roster → a single anonymous "Solo" learner so the feature still works.
  const learner = memberId ?? (hasRoster ? null : SOLO_LEARNER_ID);
  const learnerName = learner
    ? memberList.find((m) => m.id === learner)
      ? memberName(memberList.find((m) => m.id === learner)!)
      : "Solo"
    : null;
  const myQuestions = useMemo(
    () => memberQuestions(narrative.learningProgress, learner ?? ""),
    [narrative.learningProgress, learner],
  );

  const [selection, setSelection] = useState<ScopeSelection>(
    initial ?? { scope: "narrative" },
  );
  const [bloomFilter, setBloomFilter] = useState<Set<BloomLevel>>(new Set());
  const [difficultyFilter, setDifficultyFilter] = useState<Set<DifficultyBand>>(new Set());
  const [limit, setLimit] = useState<number | "all">(10);

  const [phase, setPhase] = useState<Phase>("setup");
  const [pool, setPool] = useState<QuestionWithMeta[]>([]);
  const [cursor, setCursor] = useState(0);
  // questionId -> chosen option index
  const [answers, setAnswers] = useState<Record<string, number>>({});

  // The pool the current setup would produce — drives the "Start" count.
  const candidatePool = useMemo(() => {
    let p = selectScope(items, selection, topics);
    if (bloomFilter.size) p = p.filter((it) => bloomFilter.has(it.q.bloom));
    if (difficultyFilter.size) p = p.filter((it) => difficultyFilter.has(it.q.difficulty));
    return p;
  }, [items, selection, bloomFilter, difficultyFilter, topics]);

  // Auto-start a preset once a learner is known. Runs once per open (guarded by
  // phase + empty pool) — legitimate prop→state init, not a derived-state loop.
  useEffect(() => {
    if (!preset || !learner || phase !== "setup" || pool.length > 0) return;
    const seed = (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0;
    const built = buildPresetPool(preset, items, myQuestions, Date.now(), seed);
    if (built.length === 0) return;
    setPool(built);
    setCursor(0);
    setAnswers({});
    setPhase("running");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, learner]);

  // Record the first answer to each question under the active learner so even
  // a partial session counts toward coverage.
  const handleAnswer = (item: QuestionWithMeta, idx: number) => {
    const qid = item.q.id;
    if (answers[qid] !== undefined) return;
    if (learner) {
      dispatch({
        type: "RECORD_QUIZ_ANSWER",
        memberId: learner,
        questionId: qid,
        correct: idx === item.q.correctIndex,
      });
    }
    setAnswers((prev) =>
      prev[qid] !== undefined ? prev : { ...prev, [qid]: idx },
    );
  };

  const startQuiz = () => {
    if (!learner) return; // must state who's learning first
    // Fresh random seed each run so the order differs every time the quiz
    // is started — not a fixed deterministic sequence.
    const seed = (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0;
    const shuffled = shuffleQuestions(candidatePool, seed);
    const capped = limit === "all" ? shuffled : shuffled.slice(0, limit);
    if (capped.length === 0) return;
    setPool(capped);
    setCursor(0);
    setAnswers({});
    setPhase("running");
  };

  // From the results screen — keep the loop going by running a fresh focused
  // pool built from the learner's just-updated coverage.
  const focusedReview = () => {
    if (!learner) return;
    const built = buildFocusedPool(items, myQuestions, Date.now());
    if (built.length === 0) return;
    setPool(built);
    setCursor(0);
    setAnswers({});
    setPhase("running");
  };

  // Flashcard rep loop — reshuffle the SAME deck and run it again, no trip
  // back to setup. Keeps the user cycling through reps in a fresh order.
  const practiceAgain = () => {
    const seed = (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0;
    setPool((prev) => shuffleQuestions(prev, seed));
    setCursor(0);
    setAnswers({});
    setPhase("running");
  };

  const restart = () => {
    setPhase("setup");
    setPool([]);
    setCursor(0);
    setAnswers({});
  };

  const toggleBloom = (b: BloomLevel) =>
    setBloomFilter((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  const toggleDifficulty = (d: DifficultyBand) =>
    setDifficultyFilter((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  const correctCount = pool.reduce(
    (n, it) => n + (answers[it.q.id] === it.q.correctIndex ? 1 : 0),
    0,
  );

  return (
    <Modal onClose={onClose} fullScreen>
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-4 flex-wrap">
          <h2 className="flex items-center gap-2 text-[18px] font-semibold text-text-primary tracking-tight">
            <IconQuestion size={17} className="text-violet-400" />
            Quiz
          </h2>
          <span className="text-[11px] text-text-dim/70 hidden sm:inline">
            Calibrate your understanding of this world view
          </span>
          <div className="ml-auto flex items-center gap-3">
            {phase !== "setup" && learnerName && (
              <span className="text-[11px] text-text-dim/70">
                as <span className="text-text-secondary">{learnerName}</span>
              </span>
            )}
            {phase === "running" && (
              <span className="text-[11px] font-mono text-text-dim">
                {cursor + 1} / {pool.length} · {correctCount} correct
              </span>
            )}
          </div>
        </div>
      </ModalHeader>
      <ModalBody className="p-0">
        {phase === "setup" && (
          <SetupView
            items={items}
            topics={topics}
            topicTree={topicTree}
            members={memberList}
            hasRoster={hasRoster}
            learner={learner}
            setLearner={setMemberId}
            arcs={arcs}
            scenes={scenes}
            selection={selection}
            setSelection={setSelection}
            bloomFilter={bloomFilter}
            toggleBloom={toggleBloom}
            difficultyFilter={difficultyFilter}
            toggleDifficulty={toggleDifficulty}
            limit={limit}
            setLimit={setLimit}
            poolSize={candidatePool.length}
            needsLearner={!learner}
            onStart={startQuiz}
          />
        )}
        {phase === "running" && pool[cursor] && (
          <RunnerView
            key={pool[cursor].q.id}
            item={pool[cursor]}
            topicLabel={
              pool[cursor].q.topicId
                ? topicPath(topics, pool[cursor].q.topicId!)
                : undefined
            }
            chosen={answers[pool[cursor].q.id]}
            onAnswer={(idx) => handleAnswer(pool[cursor], idx)}
            isLast={cursor === pool.length - 1}
            onNext={() => {
              if (cursor === pool.length - 1) setPhase("done");
              else setCursor((c) => c + 1);
            }}
          />
        )}
        {phase === "done" && (
          <DoneView
            pool={pool}
            answers={answers}
            correctCount={correctCount}
            onPracticeAgain={practiceAgain}
            onFocusedReview={focusedReview}
            onRestart={restart}
            onClose={onClose}
          />
        )}
      </ModalBody>
    </Modal>
  );
}

// ── Learner picker ────────────────────────────────────────────────────────
// Whoever sits down to quiz states which member they are; results record under
// that member. Prefilled with the active member; mirrors the create-stream
// member picker (avatar row). No roster → a single "Solo" learner, no choice.

function LearnerPicker({
  members,
  value,
  onChange,
}: {
  members: Member[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wider text-text-dim mb-3">
        I am{" "}
        <span className="text-text-dim/50 normal-case">
          — coverage records under this member
        </span>
      </h3>
      <div className="flex flex-wrap items-center gap-3">
        {members.map((m) => {
          const selected = value === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onChange(m.id)}
              className="flex flex-col items-center gap-1.5 w-16 group"
              title={memberName(m)}
            >
              <Avatar label={memberName(m)} size={44} selected={selected} dim={!selected} />
              <span
                className={`text-[10px] truncate max-w-full ${selected ? "text-text-primary" : "text-text-dim group-hover:text-text-secondary"}`}
              >
                {memberName(m).split(" ")[0]}
                {m.role === "gm" ? " ·GM" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Setup ───────────────────────────────────────────────────────────────────

function SetupView({
  items,
  topics,
  topicTree,
  members,
  hasRoster,
  learner,
  setLearner,
  arcs,
  scenes,
  selection,
  setSelection,
  bloomFilter,
  toggleBloom,
  difficultyFilter,
  toggleDifficulty,
  limit,
  setLimit,
  poolSize,
  needsLearner,
  onStart,
}: {
  items: QuestionWithMeta[];
  topics: Record<string, Topic>;
  topicTree: TopicNode[];
  members: Member[];
  hasRoster: boolean;
  learner: string | null;
  setLearner: (id: string) => void;
  arcs: { arcId: string; arcName: string; count: number }[];
  scenes: { sceneId: string; sceneIndex: number; sceneLabel: string; count: number }[];
  selection: ScopeSelection;
  setSelection: (s: ScopeSelection) => void;
  bloomFilter: Set<BloomLevel>;
  toggleBloom: (b: BloomLevel) => void;
  difficultyFilter: Set<DifficultyBand>;
  toggleDifficulty: (d: DifficultyBand) => void;
  limit: number | "all";
  setLimit: (l: number | "all") => void;
  poolSize: number;
  needsLearner: boolean;
  onStart: () => void;
}) {
  // Flatten the topic tree to indented options (subtree counts) for the picker.
  const topicOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { q } of items) {
      if (!q.topicId) continue;
      // count toward the topic and all its ancestors
      let id: string | undefined = q.topicId;
      const guard = new Set<string>();
      while (id && topics[id] && !guard.has(id)) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        guard.add(id);
        id = topics[id].parentId ?? undefined;
      }
    }
    const out: { value: string; label: string }[] = [];
    const walk = (nodes: TopicNode[]) => {
      for (const n of nodes) {
        const c = counts.get(n.topic.id) ?? 0;
        if (c > 0) {
          out.push({
            value: n.topic.id,
            label: `${"  ".repeat(n.depth)}${n.topic.name} (${c})`,
          });
        }
        walk(n.children);
      }
    };
    walk(topicTree);
    return out;
  }, [items, topics, topicTree]);

  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-8">
        <p className="text-sm text-text-secondary">No questions to practise yet.</p>
        <p className="mt-1 text-[12px] text-text-dim max-w-md">
          Open a scene&apos;s Learn tab and Generate a question bank, or run a range from the
          palette&apos;s Auto control. Questions you generate will pool here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-8 py-10 space-y-8">
      {/* I am — member picker (prefilled with the active member) */}
      {hasRoster && (
        <LearnerPicker members={members} value={learner} onChange={setLearner} />
      )}

      {/* Scope */}
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-text-dim mb-3">Scope</h3>
        <Segmented<QuizScope>
          options={[
            { label: "Whole narrative", value: "narrative" },
            { label: "By topic", value: "topic" },
            { label: "By arc", value: "arc" },
            { label: "By scene", value: "scene" },
          ]}
          value={selection.scope}
          onChange={(scope) => setSelection({ scope })}
        />

        {selection.scope === "topic" && (
          <>
            <Picker
              placeholder="Choose a topic…"
              value={selection.topicId}
              onChange={(topicId) => setSelection({ scope: "topic", topicId })}
              options={topicOptions}
            />
            <p className="mt-2 text-[10px] text-text-dim/60">
              Picks the topic and everything beneath it in the curriculum tree.
            </p>
          </>
        )}
        {selection.scope === "arc" && (
          <Picker
            placeholder="Choose an arc…"
            value={selection.arcId}
            onChange={(arcId) => setSelection({ scope: "arc", arcId })}
            options={arcs.map((a) => ({ value: a.arcId, label: `${a.arcName} (${a.count})` }))}
          />
        )}
        {selection.scope === "scene" && (
          <Picker
            placeholder="Choose a scene…"
            value={selection.sceneId}
            onChange={(sceneId) => setSelection({ scope: "scene", sceneId })}
            options={scenes.map((s) => ({
              value: s.sceneId,
              label: `${s.sceneIndex}. ${s.sceneLabel || "Untitled"} (${s.count})`,
            }))}
          />
        )}
      </section>

      {/* Bloom filter */}
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-text-dim mb-3">
          Cognitive level <span className="text-text-dim/50 normal-case">— all if none selected</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {BLOOM_LEVELS.map((b) => (
            <FilterChip
              key={b}
              label={BLOOM_LABEL[b]}
              active={bloomFilter.has(b)}
              onClick={() => toggleBloom(b)}
            />
          ))}
        </div>
      </section>

      {/* Difficulty filter */}
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-text-dim mb-3">
          Difficulty <span className="text-text-dim/50 normal-case">— all if none selected</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {DIFFICULTY_BANDS.map((d) => (
            <FilterChip
              key={d}
              label={DIFFICULTY_LABEL[d]}
              active={difficultyFilter.has(d)}
              onClick={() => toggleDifficulty(d)}
            />
          ))}
        </div>
      </section>

      {/* Length */}
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-text-dim mb-3">Length</h3>
        <div className="flex flex-wrap gap-2">
          {([5, 10, 20, "all"] as const).map((l) => (
            <FilterChip
              key={l}
              label={l === "all" ? "All" : String(l)}
              active={limit === l}
              onClick={() => setLimit(l)}
            />
          ))}
        </div>
      </section>

      {/* Start */}
      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={onStart}
          disabled={poolSize === 0 || needsLearner}
          className="px-5 py-2.5 rounded-lg bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-[13px] font-medium transition-colors"
        >
          Start quiz
        </button>
        <span className="text-[12px] text-text-dim">
          {needsLearner
            ? "Choose who's learning (top right) to begin."
            : poolSize === 0
              ? "No questions match these filters."
              : `${limit === "all" ? poolSize : Math.min(poolSize, limit)} question${
                  (limit === "all" ? poolSize : Math.min(poolSize, limit)) === 1 ? "" : "s"
                } ready`}
        </span>
      </div>
    </div>
  );
}

function Picker({
  placeholder,
  value,
  onChange,
  options,
}: {
  placeholder: string;
  value?: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="mt-3 w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-[12px] text-text-secondary focus:outline-none focus:border-violet-400/30"
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-bg-overlay text-text-primary">
          {o.label}
        </option>
      ))}
    </select>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? "border-violet-400/40 bg-violet-500/15 text-violet-200"
          : "border-white/10 text-text-dim hover:text-text-secondary hover:border-white/20"
      }`}
    >
      {label}
    </button>
  );
}

// ── Runner ────────────────────────────────────────────────────────────────

function RunnerView({
  item,
  topicLabel,
  chosen,
  onAnswer,
  isLast,
  onNext,
}: {
  item: QuestionWithMeta;
  topicLabel?: string;
  chosen: number | undefined;
  onAnswer: (idx: number) => void;
  isLast: boolean;
  onNext: () => void;
}) {
  const { q } = item;
  const answered = chosen !== undefined;

  // Display order of options, shuffled once per question view (RunnerView is
  // keyed by q.id, so it remounts — and reshuffles — for each card). Entries
  // are ORIGINAL option indices; chosen/correct comparisons and scoring all
  // stay in original-index space. Covers older banks stored before
  // generation-time shuffling, and varies the layout across reps.
  const displayOrder = useMemo(() => {
    const order = q.options.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id]);

  return (
    <div className="max-w-2xl mx-auto px-8 py-10">
      <div className="flex items-center gap-2 mb-5 text-[10px] uppercase tracking-wider text-text-dim/60">
        <span>Scene {item.sceneIndex}</span>
        <span>·</span>
        <span>{item.arcName}</span>
      </div>

      <p className="text-[16px] text-text-primary leading-relaxed mb-6">{q.prompt}</p>

      <div className="space-y-2.5">
        {displayOrder.map((originalIdx, displayPos) => {
          const opt = q.options[originalIdx];
          const isCorrect = originalIdx === q.correctIndex;
          const isChosen = originalIdx === chosen;
          let cls = "border-white/10 text-text-secondary hover:border-white/25 hover:bg-white/4";
          if (answered) {
            if (isCorrect) cls = "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";
            else if (isChosen) cls = "border-red-400/40 bg-red-500/10 text-red-200";
            else cls = "border-white/8 text-text-dim/70";
          }
          return (
            <button
              key={originalIdx}
              disabled={answered}
              onClick={() => onAnswer(originalIdx)}
              className={`w-full flex items-center gap-3 text-left px-4 py-3 rounded-lg border transition-colors ${cls} disabled:cursor-default`}
            >
              <span className="shrink-0 w-5 text-center text-[11px] font-mono text-text-dim/50">
                {answered && isCorrect ? (
                  <IconCheck size={13} />
                ) : answered && isChosen ? (
                  <IconClose size={13} />
                ) : (
                  String.fromCharCode(65 + displayPos)
                )}
              </span>
              <span className="text-[13px]">{opt}</span>
            </button>
          );
        })}
      </div>

      {answered && (
        <div className="mt-6 rounded-lg bg-white/4 border border-white/8 p-4">
          <p className="text-[12px] text-text-secondary leading-relaxed">
            {chosen === q.correctIndex ? (
              <span className="text-emerald-300 font-medium">Correct. </span>
            ) : (
              <span className="text-red-300 font-medium">Not quite. </span>
            )}
            {q.explanation ?? `The answer is "${q.options[q.correctIndex]}".`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {topicLabel && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300">
                {topicLabel}
              </span>
            )}
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/6 text-text-dim ml-auto">
              {BLOOM_LABEL[q.bloom]} · {DIFFICULTY_LABEL[q.difficulty]}
            </span>
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          onClick={onNext}
          disabled={!answered}
          className="px-5 py-2.5 rounded-lg bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-[13px] font-medium transition-colors"
        >
          {isLast ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}

// ── Done ────────────────────────────────────────────────────────────────────

function DoneView({
  pool,
  answers,
  correctCount,
  onPracticeAgain,
  onFocusedReview,
  onRestart,
  onClose,
}: {
  pool: QuestionWithMeta[];
  answers: Record<string, number>;
  correctCount: number;
  onPracticeAgain: () => void;
  onFocusedReview: () => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const pct = pool.length ? Math.round((correctCount / pool.length) * 100) : 0;
  const missed = pool.filter((it) => answers[it.q.id] !== it.q.correctIndex);

  return (
    <div className="max-w-2xl mx-auto px-8 py-10">
      <div className="text-center mb-8">
        <div
          className={`text-5xl font-semibold tracking-tight ${
            pct >= 80 ? "text-emerald-300" : pct >= 50 ? "text-amber-300" : "text-red-300"
          }`}
        >
          {pct}%
        </div>
        <p className="mt-2 text-[13px] text-text-secondary">
          {correctCount} of {pool.length} correct
        </p>
      </div>

      {missed.length > 0 && (
        <div className="mb-8">
          <h3 className="text-[11px] uppercase tracking-wider text-text-dim mb-3">
            Review — {missed.length} to revisit
          </h3>
          <div className="space-y-3">
            {missed.map((it) => (
              <div key={it.q.id} className="rounded-lg border border-white/8 bg-white/3 p-4">
                <p className="text-[13px] text-text-primary leading-relaxed">{it.q.prompt}</p>
                <p className="mt-2 text-[12px] text-emerald-300">
                  {it.q.options[it.q.correctIndex]}
                </p>
                {it.q.explanation && (
                  <p className="mt-1.5 text-[11px] text-text-dim/80 italic leading-relaxed">
                    {it.q.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={onFocusedReview}
          className="px-5 py-2.5 rounded-lg bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 text-[13px] font-medium transition-colors"
          title="Run a fresh focused-review set from your updated coverage"
        >
          Focused review
        </button>
        <button
          onClick={onPracticeAgain}
          className="px-5 py-2.5 rounded-lg bg-white/5 text-text-secondary hover:bg-white/10 text-[13px] font-medium transition-colors"
        >
          Practice again
        </button>
        <button
          onClick={onRestart}
          className="px-5 py-2.5 rounded-lg bg-white/5 text-text-secondary hover:bg-white/10 text-[13px] font-medium transition-colors"
        >
          Change setup
        </button>
        <button
          onClick={onClose}
          className="ml-auto px-5 py-2.5 rounded-lg bg-white/5 text-text-secondary hover:bg-white/10 text-[13px] font-medium transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
