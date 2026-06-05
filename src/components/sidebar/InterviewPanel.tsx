"use client";

// InterviewPanel — sidebar panel for running and browsing one-subject-many-questions interviews.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/state/store";
import type { Interview } from "@/types/narrative";
import { InterviewDetailModal } from "./surveys/InterviewDetailModal";
import { InterviewComposerModal } from "./surveys/InterviewComposerModal";

/**
 * Sidebar pane: depth interviews. One subject (a character, location, or
 * artifact) answers many questions in their own voice. Same persona
 * engine as surveys, inverted axis — surveys go wide, interviews go deep.
 *
 * UX shape mirrors Surveys: top "+ New" button opens a composer modal
 * with full breathing room (subject picker, lens chips, question stack
 * with reorder); the stream below shows past interviews as cards.
 * Click a card → opens the transcript modal where the run actually fires.
 */

export default function InterviewPanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [composerOpen, setComposerOpen] = useState(false);
  const [modalId, setModalId] = useState<string | null>(null);

  const interviews = useMemo(
    () => Object.values(narrative?.interviews ?? {}).sort((a, b) => a.createdAt - b.createdAt),
    [narrative?.interviews],
  );
  const modalInterview = modalId ? narrative?.interviews?.[modalId] ?? null : null;

  if (!narrative) {
    return (
      <div className="p-4 text-[11px] text-text-dim">
        Open a world view to interview its characters, locations, or artifacts.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 h-9 px-3 border-b border-white/8 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-text-dim/70">
          {interviews.length} {interviews.length === 1 ? "interview" : "interviews"}
        </span>
        <button
          onClick={() => setComposerOpen(true)}
          className="ml-auto text-[11px] px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-text-primary transition-colors"
        >
          + New
        </button>
      </div>

      <InterviewStream interviews={interviews} onOpen={setModalId} />

      {composerOpen && (
        <InterviewComposerModal
          onClose={() => setComposerOpen(false)}
          onCreate={(interview) => {
            dispatch({ type: "CREATE_INTERVIEW", interview });
            setComposerOpen(false);
            setModalId(interview.id);
          }}
        />
      )}
      {modalInterview && (
        <InterviewDetailModal
          interview={modalInterview}
          narrative={narrative}
          onClose={() => setModalId(null)}
          onDelete={() => {
            dispatch({ type: "DELETE_INTERVIEW", interviewId: modalInterview.id });
            setModalId(null);
          }}
        />
      )}
    </div>
  );
}

function InterviewStream({
  interviews,
  onOpen,
}: {
  interviews: Interview[];
  onOpen: (id: string) => void;
}) {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [interviews.length]);

  if (!narrative) return null;

  if (interviews.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col items-center justify-center p-8 text-center gap-2">
        <svg className="w-8 h-8 text-text-dim/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <p className="text-[11px] text-text-dim/80">Sit one entity down for a depth interview.</p>
        <p className="text-[10px] text-text-dim/50 max-w-xs leading-relaxed">
          Tap <span className="text-text-secondary">+ New</span> to pick a subject and a research lens. The engine can suggest a tailored question batch.
        </p>
      </div>
    );
  }

  const subjectName = (i: Interview): string => {
    if (i.subjectKind === "character") return narrative.characters[i.subjectId]?.name ?? i.subjectId;
    if (i.subjectKind === "location") return narrative.locations[i.subjectId]?.name ?? i.subjectId;
    return narrative.artifacts?.[i.subjectId]?.name ?? i.subjectId;
  };

  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-3">
      {interviews.map((iv) => (
        <button
          key={iv.id}
          onClick={() => onOpen(iv.id)}
          className="panel-card w-full text-left p-3"
        >
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[12px] text-text-primary font-medium truncate">{subjectName(iv)}</span>
            <span className="text-[9px] uppercase tracking-wider text-text-dim/70 font-mono">{iv.subjectKind}</span>
            {iv.category && (
              <span className="text-[9px] uppercase tracking-wider text-amber-400/80 font-mono">· {iv.category}</span>
            )}
            <span className={`text-[9px] uppercase tracking-wider font-mono ml-auto ${statusColor(iv)}`}>{iv.status}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-text-dim/80">
            <span className="tabular-nums">
              {Object.keys(iv.answers).length} / {iv.questions.length} answered
            </span>
            {iv.status === "running" && iv.progress && (
              <div className="flex-1 h-1 bg-white/5 rounded overflow-hidden">
                <div className="h-full bg-amber-400/60 transition-all" style={{ width: `${(iv.progress.completed / Math.max(1, iv.progress.total)) * 100}%` }} />
              </div>
            )}
          </div>
          {iv.error && <p className="text-[10px] text-red-400/80 mt-1">{iv.error}</p>}
        </button>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function statusColor(i: Interview): string {
  if (i.status === "complete") return "text-emerald-400/80";
  if (i.status === "running") return "text-amber-400";
  if (i.status === "error") return "text-red-400";
  return "text-text-dim/70";
}
