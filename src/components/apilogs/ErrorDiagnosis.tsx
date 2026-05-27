'use client';

import { diagnoseError, type ErrorDiagnosis as Diagnosis } from '@/lib/ai/diagnose';
import { useMemo, useState } from 'react';

const SEVERITY_STYLE: Record<Diagnosis['severity'], { dot: string; label: string }> = {
  low:    { dot: 'bg-amber-400',  label: 'Recoverable' },
  medium: { dot: 'bg-orange-400', label: 'Needs attention' },
  high:   { dot: 'bg-red-400',    label: 'Hard failure' },
};

/** Inline button that copies a diagnostic trace (caller, severity, summary,
 *  raw error) to the clipboard. Sits next to the diagnosis so users can
 *  paste a clean report into a bug tracker without hunting through tabs. */
export function CopyErrorButton({ trace, label = 'Copy error' }: { trace: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(trace);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard write can fail in non-secure contexts; swallow silently */
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title="Copy diagnostic trace to clipboard"
      className={`text-[10px] font-medium px-2.5 py-1 rounded-md border transition-colors ${
        copied
          ? 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10'
          : 'text-text-dim hover:text-text-secondary border-white/10 hover:border-white/20'
      }`}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/** Build a multi-line trace bundling caller, severity, summary, suggestion,
 *  repair hint (if any), and the raw error message. Pastes cleanly into
 *  a bug report. */
export function buildErrorTrace(args: {
  caller?: string;
  error: string;
  diagnosis: Diagnosis;
}): string {
  const { caller, error, diagnosis } = args;
  const lines = [
    caller ? `caller:    ${caller}` : null,
    `severity:  ${diagnosis.severity}`,
    `summary:   ${diagnosis.summary}`,
    `next-step: ${diagnosis.suggestion}`,
    diagnosis.repairHint ? `repair-hint: ${diagnosis.repairHint}` : null,
    '',
    '──── RAW ERROR ────',
    error,
  ].filter(Boolean);
  return lines.join('\n');
}

/**
 * Render a structured diagnosis of a generation failure: severity dot,
 * one-line summary of the root cause, recommended next step. Shared by the
 * wizard, GeneratePanel, and ScenariosPanel error surfaces so the user gets
 * the same diagnostic shape everywhere a generation can fail.
 *
 * Pure presentational — caller already holds the raw error message and the
 * action buttons (Retry / Repair). This component only describes the
 * failure; the parent decides what to do about it.
 */
export function ErrorDiagnosis({
  error,
  rawError,
  caller,
  compact = false,
}: {
  /** The human-readable message string (typically `String(err)`). */
  error: string;
  /** Optional original Error object so the diagnoser can read .name / .raw. */
  rawError?: unknown;
  /** Caller id — drives the per-caller noun in the diagnosis summary
   *  ("the arc payload" vs "the narrative payload"). */
  caller?: string;
  /** When true, render a single-row pill instead of the full block. */
  compact?: boolean;
}) {
  const diagnosis = useMemo<Diagnosis>(
    () => diagnoseError(rawError ?? error, caller),
    [rawError, error, caller],
  );
  const style = SEVERITY_STYLE[diagnosis.severity];

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-[10px]">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot}`} aria-label={style.label} />
        <span className="text-text-secondary">{diagnosis.summary}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[10px]">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot}`} aria-label={style.label} />
        <span className="uppercase tracking-wider text-text-dim/70">{style.label}</span>
      </div>
      <p className="text-xs text-text-primary">{diagnosis.summary}</p>
      <p className="text-[11px] text-text-dim leading-relaxed">{diagnosis.suggestion}</p>
    </div>
  );
}

/** Helper for parents that want to know what's clickable from the same
 *  diagnosis — keeps the boolean truth in one place. */
export function useDiagnosis(error: string, rawError: unknown, caller?: string): Diagnosis {
  return useMemo(() => diagnoseError(rawError ?? error, caller), [error, rawError, caller]);
}
