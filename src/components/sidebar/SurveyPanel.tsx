"use client";

// SurveyPanel — sidebar panel for running and browsing one-question-many-respondents surveys.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/state/store";
import type { Survey, SurveyResponse } from "@/types/narrative";
import { SurveyDetailModal } from "./surveys/SurveyDetailModal";
import { SurveyComposerModal } from "./surveys/SurveyComposerModal";

/**
 * Sidebar pane: research questions posed to the whole world. Surveys are
 * global by design — every applicable entity (characters, locations,
 * artifacts) answers from their own world-graph continuity, and the
 * aggregate becomes a signal about the world.
 *
 * UX shape: the sidebar is a browse surface — a "+ New" button at the top
 * opens a composer modal, and the stream below shows past surveys as
 * sparkline cards. Click a card → opens the full detail modal where the
 * survey actually runs.
 */

export default function SurveyPanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [composerOpen, setComposerOpen] = useState(false);
  const [modalId, setModalId] = useState<string | null>(null);

  const surveys = useMemo(
    () => Object.values(narrative?.surveys ?? {}).sort((a, b) => a.createdAt - b.createdAt),
    [narrative?.surveys],
  );
  const modalSurvey = modalId ? narrative?.surveys?.[modalId] ?? null : null;

  if (!narrative) {
    return (
      <div className="p-4 text-[11px] text-text-dim">
        Open a world view to run surveys against its world.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 h-9 px-3 border-b border-white/8 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-text-dim/70">
          {surveys.length} {surveys.length === 1 ? "survey" : "surveys"}
        </span>
        <button
          onClick={() => setComposerOpen(true)}
          className="ml-auto text-[11px] px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-text-primary transition-colors"
        >
          + New
        </button>
      </div>

      <SurveyStream surveys={surveys} onOpen={setModalId} />

      {composerOpen && (
        <SurveyComposerModal
          onClose={() => setComposerOpen(false)}
          onCreate={(survey) => {
            dispatch({ type: "CREATE_SURVEY", survey });
            setComposerOpen(false);
            setModalId(survey.id);
          }}
        />
      )}
      {modalSurvey && (
        <SurveyDetailModal
          survey={modalSurvey}
          narrative={narrative}
          onClose={() => setModalId(null)}
          onDelete={() => {
            dispatch({ type: "DELETE_SURVEY", surveyId: modalSurvey.id });
            setModalId(null);
          }}
        />
      )}
    </div>
  );
}

// ── Stream ────────────────────────────────────────────────────────────────

function SurveyStream({
  surveys,
  onOpen,
}: {
  surveys: Survey[];
  onOpen: (id: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [surveys.length]);

  if (surveys.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col items-center justify-center p-8 text-center gap-2">
        <svg className="w-8 h-8 text-text-dim/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M9 11a3 3 0 1 1 4.5 2.6c-.8.5-1.5 1-1.5 2M12 17h.01" />
        </svg>
        <p className="text-[11px] text-text-dim/80">Ask a question of the whole world.</p>
        <p className="text-[10px] text-text-dim/50 max-w-xs leading-relaxed">
          Tap <span className="text-text-secondary">+ New</span> to compose a survey, or have the engine suggest one tailored to your world view.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-3">
      {surveys.map((s) => (
        <SurveyCard key={s.id} survey={s} onOpen={() => onOpen(s.id)} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function SurveyCard({ survey, onOpen }: { survey: Survey; onOpen: () => void }) {
  const responses = Object.values(survey.responses);
  const stat = summarise(survey, responses);

  return (
    <button
      onClick={onOpen}
      className="panel-card w-full text-left p-3"
    >
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[9px] uppercase tracking-wider text-text-dim/70 font-mono">{survey.questionType}</span>
        {survey.category && (
          <span className="text-[9px] uppercase tracking-wider text-amber-400/80 font-mono">· {survey.category}</span>
        )}
        <span className={`text-[9px] uppercase tracking-wider font-mono ml-auto ${statusColor(survey)}`}>{survey.status}</span>
      </div>
      <p className="text-[12px] text-text-primary leading-snug">{survey.question}</p>
      {stat && (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-text-dim/80">
          {stat.sparkline}
          <span className="text-text-secondary tabular-nums">{stat.summary}</span>
        </div>
      )}
      {survey.error && (
        <p className="text-[10px] text-red-400/80 mt-1">{survey.error}</p>
      )}
    </button>
  );
}

function statusColor(s: Survey): string {
  if (s.status === "complete") return "text-emerald-400/80";
  if (s.status === "running") return "text-amber-400";
  if (s.status === "error") return "text-red-400";
  return "text-text-dim/70";
}

function summarise(
  survey: Survey,
  responses: SurveyResponse[],
): { sparkline: React.ReactNode; summary: string } | null {
  const ok = responses.filter((r) => !r.error);
  if (ok.length === 0) {
    if (survey.status === "running" && survey.progress) {
      return {
        sparkline: <MiniProgress completed={survey.progress.completed} total={survey.progress.total} />,
        summary: `${survey.progress.completed} / ${survey.progress.total}`,
      };
    }
    return null;
  }

  if (survey.questionType === "binary") {
    const yes = ok.filter((r) => r.answer.type === "binary" && r.answer.value).length;
    const pct = ok.length > 0 ? Math.round((yes / ok.length) * 100) : 0;
    return { sparkline: <MiniBinary yesPct={pct} />, summary: `${pct}% yes · ${ok.length} asked` };
  }

  if (survey.questionType === "likert") {
    const scale = survey.config?.scale ?? 5;
    const vals = ok
      .map((r) => (r.answer.type === "likert" ? r.answer.value : 0))
      .filter((v) => v > 0);
    const mean = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return { sparkline: <MiniLikert values={vals} scale={scale} />, summary: `mean ${mean.toFixed(2)} / ${scale}` };
  }

  if (survey.questionType === "estimate") {
    const vals = ok.map((r) => (r.answer.type === "estimate" ? r.answer.value : 0));
    if (vals.length === 0) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return {
      sparkline: <MiniHistogram values={vals} />,
      summary: `median ${median.toLocaleString()}${survey.config?.unit ? ` ${survey.config.unit}` : ""}`,
    };
  }

  if (survey.questionType === "choice") {
    const counts = new Map<string, number>();
    for (const r of ok) if (r.answer.type === "choice") counts.set(r.answer.value, (counts.get(r.answer.value) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      sparkline: <MiniBinary yesPct={top ? (top[1] / ok.length) * 100 : 0} />,
      summary: top ? `${top[0]} (${Math.round((top[1] / ok.length) * 100)}%)` : `${ok.length} answered`,
    };
  }

  return { sparkline: null, summary: `${ok.length} responses` };
}

function MiniProgress({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? (completed / total) * 100 : 0;
  return (
    <div className="flex-1 h-1 bg-white/5 rounded overflow-hidden">
      <div className="h-full bg-amber-400/60 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function MiniBinary({ yesPct }: { yesPct: number }) {
  return (
    <div className="flex-1 h-1 bg-red-500/30 rounded overflow-hidden">
      <div className="h-full bg-emerald-400/70" style={{ width: `${yesPct}%` }} />
    </div>
  );
}

function MiniLikert({ values, scale }: { values: number[]; scale: number }) {
  const counts = new Array(scale).fill(0) as number[];
  for (const v of values) counts[Math.max(0, Math.min(scale - 1, v - 1))] += 1;
  const peak = Math.max(1, ...counts);
  return (
    <div className="flex items-end gap-0.5 flex-1 h-3">
      {counts.map((c, i) => (
        <div
          key={i}
          className="flex-1 bg-cyan-400/60 rounded-sm"
          style={{ height: `${(c / peak) * 100}%` }}
        />
      ))}
    </div>
  );
}

function MiniHistogram({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const buckets = 8;
  const counts = new Array(buckets).fill(0) as number[];
  for (const v of values) counts[Math.min(buckets - 1, Math.floor(((v - min) / range) * buckets))] += 1;
  const peak = Math.max(1, ...counts);
  return (
    <div className="flex items-end gap-0.5 flex-1 h-3">
      {counts.map((c, i) => (
        <div key={i} className="flex-1 bg-cyan-400/60 rounded-sm" style={{ height: `${(c / peak) * 100}%` }} />
      ))}
    </div>
  );
}
