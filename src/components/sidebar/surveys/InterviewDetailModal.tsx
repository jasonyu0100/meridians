"use client";

// InterviewDetailModal — modal displaying a completed interview's question-by-question responses.

import { useCallback, useMemo, useRef } from "react";
import { Modal, ModalHeader, ModalBody } from "@/components/Modal";
import { useStore } from "@/lib/state/store";
import { runInterview } from "@/lib/ai/interviews";
import { logError } from "@/lib/core/system-logger";
import { interviewToMarkdown } from "@/lib/io/research-export";
import type { Interview, InterviewQuestion, NarrativeState, SurveyResponse } from "@/types/narrative";
import { CopyButton } from "./CopyButton";

/**
 * Full-screen interview detail. The panel shows a stream of past
 * interviews; this modal is the run + read surface — subject card at
 * the top, then a Q&A transcript with the subject's voice for each
 * question. Run / Stop / Re-run / Delete / Copy in the header.
 */
export function InterviewDetailModal({
  interview,
  narrative,
  onClose,
  onDelete,
}: {
  interview: Interview;
  narrative: NarrativeState;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const { dispatch } = useStore();
  const cancelledRef = useRef(false);
  const isRunning = interview.status === "running";

  const subject = useMemo(() => subjectInfo(narrative, interview), [narrative, interview]);
  const answeredCount = Object.keys(interview.answers).length;

  const start = useCallback(async () => {
    cancelledRef.current = false;
    dispatch({
      type: "UPDATE_INTERVIEW",
      interviewId: interview.id,
      updates: {
        status: "running",
        progress: { completed: 0, total: interview.questions.length },
        error: undefined,
        answers: {},
      },
    });
    try {
      await runInterview(
        narrative,
        interview,
        {
          onAnswer: (answer) => dispatch({ type: "SET_INTERVIEW_ANSWER", interviewId: interview.id, answer }),
          onProgress: (completed, total) =>
            dispatch({ type: "UPDATE_INTERVIEW", interviewId: interview.id, updates: { progress: { completed, total } } }),
        },
        () => cancelledRef.current,
      );
      if (!cancelledRef.current) {
        dispatch({ type: "UPDATE_INTERVIEW", interviewId: interview.id, updates: { status: "complete", progress: undefined } });
      }
    } catch (err) {
      logError("Interview halted", err, { source: "other", operation: "interview-run", details: { interviewId: interview.id } });
      dispatch({
        type: "UPDATE_INTERVIEW",
        interviewId: interview.id,
        updates: { status: "error", error: err instanceof Error ? err.message : String(err), progress: undefined },
      });
    }
  }, [dispatch, narrative, interview]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    dispatch({ type: "UPDATE_INTERVIEW", interviewId: interview.id, updates: { status: "draft", progress: undefined } });
  }, [dispatch, interview.id]);

  return (
    <Modal onClose={onClose} size="6xl" maxHeight="92vh">
      <ModalHeader onClose={onClose}>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-text-dim/70">
            {interview.subjectKind}
            {interview.category ? ` · ${interview.category}` : ""}
          </p>
          <h2 className="text-[14px] font-medium text-text-primary truncate">
            {interview.title ?? subject.name}
          </h2>
          {subject.subtitle && (
            <p className="text-[10px] text-text-dim/70 truncate">{subject.subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] shrink-0">
          <span className="text-text-dim tabular-nums mr-2">
            {answeredCount} / {interview.questions.length}
          </span>
          {!isRunning ? (
            <button
              onClick={start}
              disabled={interview.questions.length === 0}
              className="px-2 py-1 rounded bg-emerald-400/15 text-emerald-400 hover:bg-emerald-400/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {answeredCount > 0 ? "Re-run" : "Run"}
            </button>
          ) : (
            <button
              onClick={stop}
              className="px-2 py-1 rounded bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 transition-colors"
            >
              Stop
            </button>
          )}
          <CopyButton getText={() => interviewToMarkdown(interview, narrative)} />
          {onDelete && !isRunning && (
            <button
              onClick={onDelete}
              className="px-2 py-1 rounded text-text-dim hover:text-red-400 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </ModalHeader>

      {isRunning && interview.progress && (
        <div className="px-5 py-1.5 border-b border-amber-400/15 bg-amber-400/5 text-[10px] text-amber-400">
          Asking {interview.progress.completed} / {interview.progress.total}…
          <div className="mt-1 h-1 bg-white/5 rounded overflow-hidden">
            <div
              className="h-full bg-amber-400/50 transition-all"
              style={{ width: `${interview.progress.total > 0 ? (interview.progress.completed / interview.progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {interview.error && (
        <div className="px-5 py-2 text-[11px] text-red-400 bg-red-400/5 border-b border-white/5 shrink-0">
          {interview.error}
        </div>
      )}

      <ModalBody className="p-0">
        <div className="px-5 py-4 space-y-3">
          {interview.questions.length === 0 ? (
            <p className="text-[11px] text-text-dim italic">This interview has no questions yet.</p>
          ) : (
            interview.questions.map((q, i) => (
              <QABlock
                key={q.id}
                index={i + 1}
                question={q}
                answer={interview.answers[q.id]}
                subjectName={subject.name}
              />
            ))
          )}
        </div>
      </ModalBody>
    </Modal>
  );
}

function QABlock({
  index,
  question,
  answer,
  subjectName,
}: {
  index: number;
  question: InterviewQuestion;
  answer?: Interview["answers"][string];
  subjectName: string;
}) {
  return (
    <div className="border-l-2 border-white/10 pl-4 pr-2 py-2">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[10px] font-mono text-text-dim/60 tabular-nums">Q{index}.</span>
        <span className="text-[9px] uppercase tracking-wider text-text-dim/60">
          {question.questionType}
          {question.questionType === "likert" && ` · ${question.config?.scale ?? 5}-pt`}
        </span>
      </div>
      <p className="text-[12px] text-text-secondary leading-relaxed">{question.question}</p>
      {answer ? (
        <div className="mt-2 ml-4 pl-3 border-l-2 border-emerald-400/30">
          {answer.error ? (
            <p className="text-[11px] text-red-400/80">{answer.error}</p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-[9px] uppercase tracking-wider text-emerald-400/70 font-mono">{subjectName}</span>
                <span className="text-[12px] font-mono text-text-primary tabular-nums">{answerDisplay(question, answer.answer)}</span>
              </div>
              {answer.reasoning && (
                <p className="text-[11px] text-text-secondary leading-relaxed mt-1">{answer.reasoning}</p>
              )}
              {answer.answer.type === "open" && (
                <p className="text-[12px] text-text-primary leading-relaxed mt-1 italic">
                  {answer.answer.value || <span className="text-text-dim/50 not-italic">(empty)</span>}
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="mt-2 ml-4 pl-3 border-l-2 border-white/10 text-[10px] text-text-dim/60 italic">
          Unanswered
        </p>
      )}
    </div>
  );
}

function subjectInfo(narrative: NarrativeState, interview: Interview): { name: string; subtitle?: string } {
  if (interview.subjectKind === "character") {
    const c = narrative.characters[interview.subjectId];
    return { name: c?.name ?? interview.subjectId, subtitle: c ? `Character · ${c.role}` : undefined };
  }
  if (interview.subjectKind === "location") {
    const l = narrative.locations[interview.subjectId];
    return { name: l?.name ?? interview.subjectId, subtitle: l ? `Location · ${l.prominence}` : undefined };
  }
  const a = narrative.artifacts?.[interview.subjectId];
  return { name: a?.name ?? interview.subjectId, subtitle: a ? `Artifact · ${a.significance}` : undefined };
}

function answerDisplay(q: InterviewQuestion, a: SurveyResponse["answer"]): string {
  if (a.type === "binary") return a.value ? "Yes" : "No";
  if (a.type === "likert") return `${a.value} / ${q.config?.scale ?? 5}`;
  if (a.type === "estimate") return `${a.value.toLocaleString()}${q.config?.unit ? ` ${q.config.unit}` : ""}`;
  if (a.type === "choice") return a.value;
  return "·";
}
