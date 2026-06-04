"use client";

// InterviewComposerModal — modal for composing a single-subject interview (subject, category, questions).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, ModalHeader, ModalBody } from "@/components/Modal";
import { useStore } from "@/lib/state/store";
import { generateInterviewBatch, resolveSubject } from "@/lib/ai/interviews";
import { logError } from "@/lib/core/system-logger";
import type {
  Interview,
  InterviewQuestion,
  InterviewSubjectKind,
  SurveyConfig,
  SurveyQuestionType,
} from "@/types/narrative";
import { CategoryPicker } from "./CategoryPicker";

/**
 * Interview setup modal — full breathing room for assembling a question
 * batch. The previous bottom-pinned composer was cramped because
 * interviews are sequences (subject + N questions); this modal gives
 * the question stack proper space, plus a clear left-to-right rhythm:
 * pick a subject → pick a lens → suggest or add questions → send.
 *
 * Answering remains parallel (see runInterview); the composer just sets
 * everything up first.
 */

const TYPE_OPTIONS: { value: SurveyQuestionType; label: string }[] = [
  { value: "binary", label: "Yes / No" },
  { value: "likert", label: "Scale" },
  { value: "estimate", label: "Estimate" },
  { value: "choice", label: "Choice" },
  { value: "open", label: "Open" },
];

export function InterviewComposerModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (interview: Interview) => void;
}) {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const [subjectId, setSubjectId] = useState<string>("");
  const [category, setCategory] = useState("");
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [draftQuestion, setDraftQuestion] = useState("");
  const [draftType, setDraftType] = useState<SurveyQuestionType>("open");
  const [draftConfig, setDraftConfig] = useState<SurveyConfig>({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const subjects = useMemo(() => {
    if (!narrative) return { characters: [], locations: [], artifacts: [] };
    return {
      characters: Object.values(narrative.characters).map((c) => ({
        id: c.id,
        kind: "character" as InterviewSubjectKind,
        label: `${c.name} — ${c.role}`,
      })),
      locations: Object.values(narrative.locations).map((l) => ({
        id: l.id,
        kind: "location" as InterviewSubjectKind,
        label: `${l.name} — ${l.prominence}`,
      })),
      artifacts: Object.values(narrative.artifacts ?? {}).map((a) => ({
        id: a.id,
        kind: "artifact" as InterviewSubjectKind,
        label: `${a.name} — ${a.significance}`,
      })),
    };
  }, [narrative]);

  const decode = (encoded: string) => {
    const [kind, ...rest] = encoded.split(":");
    return { kind: kind as InterviewSubjectKind, id: rest.join(":") };
  };

  useEffect(() => {
    if (!subjectId && subjects.characters.length > 0) {
      setSubjectId(`character:${subjects.characters[0].id}`);
    }
  }, [subjects, subjectId]);

  const addDraft = () => {
    const q = draftQuestion.trim();
    if (!q) return;
    if (draftType === "choice" && (draftConfig.options?.length ?? 0) < 2) return;
    setQuestions((prev) => [
      ...prev,
      {
        id: `q-${Date.now()}-${prev.length}`,
        question: q,
        questionType: draftType,
        config: pruneConfig(draftType, draftConfig),
      },
    ]);
    setDraftQuestion("");
    setDraftConfig({});
  };

  const removeQuestion = (id: string) =>
    setQuestions((prev) => prev.filter((q) => q.id !== id));

  const moveQuestion = (id: string, delta: -1 | 1) => {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.id === id);
      if (idx < 0) return prev;
      const target = idx + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const suggest = useCallback(async () => {
    if (!narrative || !subjectId) return;
    const { kind, id } = decode(subjectId);
    const subject = resolveSubject(narrative, id, kind);
    if (!subject) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const batch = await generateInterviewBatch(
        narrative,
        subject,
        state.resolvedEntryKeys,
        state.viewState.currentSceneIndex,
        category || undefined,
      );
      if (!batch) {
        setSuggestError("No questions returned.");
        return;
      }
      if (!category && batch.category) setCategory(batch.category);
      setQuestions((prev) => [
        ...prev,
        ...batch.questions.map((q, i) => ({
          id: `q-${Date.now()}-${prev.length + i}`,
          question: q.question,
          questionType: q.questionType,
          config: q.config,
        })),
      ]);
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : String(err));
      logError("Interview suggest failed", err, { source: "other", operation: "interview-suggest" });
    } finally {
      setSuggesting(false);
    }
  }, [narrative, subjectId, state.resolvedEntryKeys, state.viewState.currentSceneIndex, category]);

  const submit = () => {
    if (!narrative || !subjectId || questions.length === 0) return;
    const { kind, id } = decode(subjectId);
    const interview: Interview = {
      id: `interview-${Date.now()}`,
      subjectId: id,
      subjectKind: kind,
      category: category.trim() || undefined,
      questions,
      answers: {},
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    onCreate(interview);
  };

  const subjectLabel = (() => {
    if (!subjectId) return "—";
    const { kind, id } = decode(subjectId);
    if (kind === "character") return narrative?.characters[id]?.name ?? id;
    if (kind === "location") return narrative?.locations[id]?.name ?? id;
    return narrative?.artifacts?.[id]?.name ?? id;
  })();

  return (
    <Modal onClose={onClose} size="4xl" maxHeight="88vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-[14px] font-medium text-text-primary">New interview</h2>
          <p className="text-[10px] text-text-dim/70">
            Sit one entity down with a batch of questions; answers run in parallel.
          </p>
        </div>
      </ModalHeader>
      <ModalBody className="p-0 overflow-hidden flex flex-col">
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] flex-1 min-h-0">
          {/* Left rail — setup */}
          <div className="border-r border-white/8 p-4 space-y-4 overflow-y-auto">
            <Section label="Subject" hint="Pick the entity to interview.">
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded text-[12px] text-text-primary px-2 py-1.5 focus:outline-none focus:border-white/20"
              >
                {subjects.characters.length === 0 && subjects.locations.length === 0 && subjects.artifacts.length === 0 && (
                  <option value="">— no entities yet —</option>
                )}
                {subjects.characters.length > 0 && (
                  <optgroup label="Characters">
                    {subjects.characters.map((s) => (
                      <option key={`c:${s.id}`} value={`character:${s.id}`}>{s.label}</option>
                    ))}
                  </optgroup>
                )}
                {subjects.locations.length > 0 && (
                  <optgroup label="Locations">
                    {subjects.locations.map((s) => (
                      <option key={`l:${s.id}`} value={`location:${s.id}`}>{s.label}</option>
                    ))}
                  </optgroup>
                )}
                {subjects.artifacts.length > 0 && (
                  <optgroup label="Artifacts">
                    {subjects.artifacts.map((s) => (
                      <option key={`a:${s.id}`} value={`artifact:${s.id}`}>{s.label}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Section>

            <Section label="Lens" hint="Frame for the question batch. Suggest will tilt toward this lens.">
              <CategoryPicker value={category} onChange={setCategory} />
            </Section>

            <Section label="Suggest a batch" hint="Engine drafts 5–7 questions tailored to this subject + lens.">
              <button
                onClick={suggest}
                disabled={suggesting || !subjectId}
                title={category ? `Generate a ${category} batch for ${subjectLabel}` : `Generate a tailored batch for ${subjectLabel}`}
                className="w-full text-[11px] py-2 rounded bg-amber-400/15 hover:bg-amber-400/25 text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {suggesting ? "Thinking…" : `Generate batch${category ? ` · ${category}` : ""}`}
              </button>
              {suggestError && <p className="text-[10px] text-red-400 mt-1">{suggestError}</p>}
            </Section>
          </div>

          {/* Right rail — question stack + draft input */}
          <div className="flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {questions.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-[11px] text-text-dim/60 italic text-center max-w-xs">
                    Add questions one at a time, or hit <span className="text-text-secondary not-italic">Generate batch</span> to seed the stack.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {questions.map((q, i) => (
                    <li
                      key={q.id}
                      className="flex items-start gap-2 p-2 bg-white/3 border border-white/5 rounded"
                    >
                      <span className="text-[10px] text-text-dim/50 tabular-nums shrink-0 w-5 mt-0.5">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-text-primary leading-snug">{q.question}</p>
                        <p className="text-[9px] uppercase tracking-wider text-text-dim/60 mt-0.5">
                          {q.questionType}
                          {q.questionType === "likert" && ` · ${q.config?.scale ?? 5}-pt`}
                          {q.questionType === "estimate" && q.config?.unit ? ` · ${q.config.unit}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => moveQuestion(q.id, -1)}
                          disabled={i === 0}
                          className="text-text-dim/60 hover:text-text-primary transition-colors disabled:opacity-20 disabled:cursor-not-allowed text-[10px] px-1"
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveQuestion(q.id, 1)}
                          disabled={i === questions.length - 1}
                          className="text-text-dim/60 hover:text-text-primary transition-colors disabled:opacity-20 disabled:cursor-not-allowed text-[10px] px-1"
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => removeQuestion(q.id)}
                          className="text-text-dim/60 hover:text-red-400 transition-colors text-[12px] px-1"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Draft input pinned at the bottom of the right rail */}
            <div className="border-t border-white/8 p-3 space-y-2 bg-bg-base/50">
              <textarea
                value={draftQuestion}
                onChange={(e) => setDraftQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    addDraft();
                  }
                }}
                rows={2}
                placeholder="Add a question manually…"
                className="w-full bg-white/5 border border-white/10 rounded text-[12px] text-text-primary px-3 py-2 placeholder:text-text-dim/40 focus:outline-none focus:border-white/20 resize-none"
              />
              <div className="flex items-center gap-1 text-[10px]">
                {TYPE_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setDraftType(t.value)}
                    className={`px-1.5 py-0.5 rounded transition-colors ${
                      draftType === t.value ? "bg-white/15 text-text-primary" : "text-text-dim hover:text-text-secondary"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
                <div className="ml-auto">
                  {draftType === "likert" && (
                    <select
                      value={draftConfig.scale ?? 5}
                      onChange={(e) => setDraftConfig({ scale: Number(e.target.value) as 3 | 5 | 7 })}
                      className="bg-white/5 border border-white/10 rounded text-text-dim px-1.5 py-0.5 focus:outline-none focus:border-white/20"
                    >
                      <option value={3}>3-pt</option>
                      <option value={5}>5-pt</option>
                      <option value={7}>7-pt</option>
                    </select>
                  )}
                  {draftType === "estimate" && (
                    <input
                      value={draftConfig.unit ?? ""}
                      onChange={(e) => setDraftConfig({ unit: e.target.value })}
                      placeholder="unit"
                      className="bg-white/5 border border-white/10 rounded text-text-primary px-1.5 py-0.5 placeholder:text-text-dim/40 focus:outline-none focus:border-white/20 w-20"
                    />
                  )}
                  {draftType === "choice" && (
                    <input
                      value={(draftConfig.options ?? []).join(", ")}
                      onChange={(e) => setDraftConfig({ options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                      placeholder="opt A, opt B"
                      className="bg-white/5 border border-white/10 rounded text-text-primary px-1.5 py-0.5 placeholder:text-text-dim/40 focus:outline-none focus:border-white/20 w-40"
                    />
                  )}
                </div>
                <button
                  onClick={addDraft}
                  disabled={!draftQuestion.trim() || (draftType === "choice" && (draftConfig.options?.length ?? 0) < 2)}
                  className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  + Add
                </button>
              </div>
            </div>
          </div>
        </div>
      </ModalBody>

      <div className="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-white/8 bg-bg-base/50">
        <span className="text-[10px] text-text-dim tabular-nums">
          {questions.length} {questions.length === 1 ? "question" : "questions"} ready · {subjectLabel}
        </span>
        <div className="flex-1" />
        <button
          onClick={submit}
          disabled={!subjectId || questions.length === 0}
          className="text-[11px] px-4 py-1.5 rounded bg-white/10 hover:bg-white/15 text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
    </Modal>
  );
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-text-dim/70 font-mono">{label}</h3>
        {hint && <p className="text-[10px] text-text-dim/50 leading-snug mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function pruneConfig(type: SurveyQuestionType, c: SurveyConfig): SurveyConfig | undefined {
  if (type === "likert") return c.scale ? { scale: c.scale } : { scale: 5 };
  if (type === "estimate") return c.unit ? { unit: c.unit } : undefined;
  if (type === "choice") return c.options && c.options.length >= 2 ? { options: c.options } : undefined;
  return undefined;
}
