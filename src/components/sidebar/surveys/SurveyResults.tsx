"use client";

// SurveyResults — renders a survey's response distribution as charts/tables by question type.

import { useMemo, useState } from "react";
import type { NarrativeState, Survey, SurveyResponse } from "@/types/narrative";

/**
 * Survey infographic + per-respondent drilldown. The aggregate visual
 * adapts to question type — donut for binary, stacked bar for likert,
 * histogram for estimate, ranked bars for choice, raw list for open.
 */
export function SurveyResultsView({ survey, narrative }: { survey: Survey; narrative: NarrativeState }) {
  const responses = useMemo(() => Object.values(survey.responses), [survey.responses]);

  return (
    <div className="space-y-3">
      <Aggregate survey={survey} responses={responses} />
      <RespondentList survey={survey} responses={responses} narrative={narrative} />
    </div>
  );
}

function Aggregate({ survey, responses }: { survey: Survey; responses: SurveyResponse[] }) {
  const successful = responses.filter((r) => !r.error);
  if (successful.length === 0) {
    return <div className="text-[10px] text-text-dim/70">No successful responses yet.</div>;
  }

  switch (survey.questionType) {
    case "binary":
      return <BinaryAggregate responses={successful} />;
    case "likert":
      return <LikertAggregate responses={successful} scale={survey.config?.scale ?? 5} />;
    case "estimate":
      return <EstimateAggregate responses={successful} unit={survey.config?.unit} />;
    case "choice":
      return <ChoiceAggregate responses={successful} options={survey.config?.options ?? []} />;
    case "open":
      return null;
  }
}

// ── Binary: yes/no donut + count ───────────────────────────────────────────

function BinaryAggregate({ responses }: { responses: SurveyResponse[] }) {
  const yes = responses.filter((r) => r.answer.type === "binary" && r.answer.value).length;
  const total = responses.length;
  const no = total - yes;
  const yesPct = total > 0 ? (yes / total) * 100 : 0;

  // Donut via two arcs on a circle.
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const yesLen = (yesPct / 100) * circumference;

  return (
    <div className="flex items-center gap-4 p-3 bg-white/3 rounded">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="rgb(239 68 68 / 0.5)" strokeWidth="14" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="rgb(52 211 153 / 0.85)"
          strokeWidth="14"
          strokeDasharray={`${yesLen} ${circumference - yesLen}`}
          transform="rotate(-90 40 40)"
        />
        <text x="40" y="44" textAnchor="middle" fontSize="13" fontWeight="600" fill="#E5E7EB">
          {Math.round(yesPct)}%
        </text>
      </svg>
      <div className="flex-1 space-y-1.5 text-[11px]">
        <Row color="bg-emerald-400/85" label="Yes" count={yes} total={total} />
        <Row color="bg-red-500/50" label="No" count={no} total={total} />
      </div>
    </div>
  );
}

// ── Likert: stacked bar + per-bucket counts ────────────────────────────────

function LikertAggregate({ responses, scale }: { responses: SurveyResponse[]; scale: number }) {
  const counts = new Array(scale).fill(0) as number[];
  let sum = 0;
  for (const r of responses) {
    if (r.answer.type === "likert") {
      const idx = Math.max(1, Math.min(scale, r.answer.value)) - 1;
      counts[idx] += 1;
      sum += r.answer.value;
    }
  }
  const total = responses.length;
  const mean = total > 0 ? sum / total : 0;

  // Cool→warm gradient across the scale (blue → green → amber → red).
  const stops = [
    [59, 130, 246],
    [52, 211, 153],
    [251, 191, 36],
    [239, 68, 68],
  ];
  const colorAt = (i: number) => {
    const t = scale > 1 ? i / (scale - 1) : 0;
    const idx = t * (stops.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, stops.length - 1);
    const f = idx - lo;
    const r = Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f);
    const g = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f);
    const b = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f);
    return `rgb(${r}, ${g}, ${b})`;
  };

  return (
    <div className="p-3 bg-white/3 rounded space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-text-secondary">Mean</span>
        <span className="text-[15px] font-mono text-text-primary tabular-nums">{mean.toFixed(2)}</span>
      </div>
      <div className="flex h-3 rounded overflow-hidden bg-white/5">
        {counts.map((c, i) => {
          const pct = total > 0 ? (c / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={i}
              style={{ width: `${pct}%`, backgroundColor: colorAt(i), opacity: 0.85 }}
              title={`${i + 1}: ${c} (${Math.round(pct)}%)`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(36px,1fr))] gap-1 text-[9px] text-text-dim text-center">
        {counts.map((c, i) => (
          <div key={i}>
            <div className="text-text-secondary tabular-nums">{c}</div>
            <div className="opacity-60">{i + 1}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Estimate: histogram + min / median / max ───────────────────────────────

function EstimateAggregate({ responses, unit }: { responses: SurveyResponse[]; unit?: string }) {
  const values = responses
    .filter((r): r is SurveyResponse & { answer: { type: "estimate"; value: number } } => r.answer.type === "estimate")
    .map((r) => r.answer.value);
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length / 2)];

  // 8-bucket histogram.
  const buckets = 8;
  const range = max - min || 1;
  const counts = new Array(buckets).fill(0) as number[];
  for (const v of values) {
    const idx = Math.min(buckets - 1, Math.floor(((v - min) / range) * buckets));
    counts[idx] += 1;
  }
  const peak = Math.max(...counts);
  const fmt = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;

  return (
    <div className="p-3 bg-white/3 rounded space-y-2">
      <div className="flex items-end justify-between text-[11px] text-text-secondary">
        <span>min <span className="font-mono text-text-primary">{fmt(min)}</span></span>
        <span>median <span className="font-mono text-text-primary">{fmt(median)}</span></span>
        <span>max <span className="font-mono text-text-primary">{fmt(max)}</span></span>
      </div>
      <div className="flex items-end h-12 gap-0.5">
        {counts.map((c, i) => (
          <div
            key={i}
            className="flex-1 bg-cyan-400/60 hover:bg-cyan-400/90 transition-colors rounded-t"
            style={{ height: `${peak > 0 ? (c / peak) * 100 : 0}%` }}
            title={`${c} response(s)`}
          />
        ))}
      </div>
    </div>
  );
}

// ── Choice: ranked horizontal bars ─────────────────────────────────────────

function ChoiceAggregate({ responses, options }: { responses: SurveyResponse[]; options: string[] }) {
  const counts = new Map<string, number>();
  for (const o of options) counts.set(o, 0);
  for (const r of responses) {
    if (r.answer.type === "choice") {
      counts.set(r.answer.value, (counts.get(r.answer.value) ?? 0) + 1);
    }
  }
  const total = responses.length;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-3 bg-white/3 rounded space-y-1.5 text-[11px]">
      {ranked.map(([opt, c]) => (
        <Row key={opt} color="bg-cyan-400/70" label={opt} count={c} total={total} />
      ))}
    </div>
  );
}

function Row({ color, label, count, total }: { color: string; label: string; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-text-secondary truncate">{label}</span>
        <span className="font-mono text-text-dim tabular-nums shrink-0 ml-2">
          {count} <span className="opacity-60">({Math.round(pct)}%)</span>
        </span>
      </div>
      <div className="h-1 mt-0.5 bg-white/5 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Per-respondent list ────────────────────────────────────────────────────

function RespondentList({
  survey,
  responses,
  narrative,
}: {
  survey: Survey;
  responses: SurveyResponse[];
  narrative: NarrativeState;
}) {
  const [expanded, setExpanded] = useState(false);

  const named = useMemo(
    () =>
      responses.map((r) => ({
        ...r,
        name:
          r.respondentKind === "character" ? narrative.characters[r.respondentId]?.name :
          r.respondentKind === "location" ? narrative.locations[r.respondentId]?.name :
          narrative.artifacts?.[r.respondentId]?.name,
      })),
    [responses, narrative],
  );

  const visible = expanded ? named : named.slice(0, 5);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-text-dim/70 uppercase tracking-wider">
        <span>Respondents · {responses.length}</span>
        {named.length > 5 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="hover:text-text-secondary transition-colors normal-case tracking-normal"
          >
            {expanded ? "Show less" : `Show all ${named.length}`}
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {visible.map((r) => (
          <li key={r.respondentId} className="bg-white/3 rounded px-2 py-1.5 text-[11px]">
            <div className="flex items-baseline gap-2">
              <span className="text-text-primary font-medium truncate">{r.name ?? r.respondentId}</span>
              <span className="text-[9px] uppercase tracking-wider text-text-dim/60 shrink-0">{r.respondentKind}</span>
              <span className="ml-auto font-mono text-text-secondary tabular-nums shrink-0">
                {formatAnswer(survey, r)}
              </span>
            </div>
            {r.error ? (
              <p className="text-[10px] text-red-400/80 mt-0.5 truncate">{r.error}</p>
            ) : r.reasoning ? (
              <p className="text-[10px] text-text-dim mt-0.5 leading-snug">{r.reasoning}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatAnswer(survey: Survey, r: SurveyResponse): string {
  if (r.error) return "—";
  switch (r.answer.type) {
    case "binary": return r.answer.value ? "Yes" : "No";
    case "likert": return `${r.answer.value} / ${survey.config?.scale ?? 5}`;
    case "estimate": return `${r.answer.value.toLocaleString()}${survey.config?.unit ? ` ${survey.config.unit}` : ""}`;
    case "choice": return r.answer.value;
    case "open": return r.answer.value.length > 24 ? `${r.answer.value.slice(0, 24)}…` : r.answer.value;
  }
}
