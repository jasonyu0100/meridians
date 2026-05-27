'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { calculateApiCost, calculateTotalCost } from '@/lib/api-logger';
import type { ApiLogEntry } from '@/types/narrative';

/** Re-renders once per second while any entry is still pending, so the
 *  "running for Xs" indicator ticks live without spinning a timer when
 *  every call has already settled. */
function useLiveClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function entryDurationMs(entry: ApiLogEntry, now: number): number | null {
  if (entry.durationMs != null) return entry.durationMs;
  if (entry.status === 'pending') return Math.max(0, now - entry.timestamp);
  return null;
}

/**
 * Unified API Logs viewer. The series (topbar) and analysis-page modals
 * both render this component — previously each reimplemented its own
 * slightly-different version, so the series view was missing per-call
 * cost and the analysis view was missing system-prompt / prompt /
 * response / reasoning tabs. Consolidating here means both sides share
 * every future improvement.
 */

type Props = {
  onClose: () => void;
  logs: ApiLogEntry[];
  title: ReactNode;
  /** Custom header chrome — filter selectors, status counts, etc. */
  headerActions?: ReactNode;
  /** Shown when no logs match the current filter. */
  emptyMessage?: string;
  onClear?: () => void;
};

export function ApiLogsViewer({ onClose, logs, title, headerActions, emptyMessage, onClear }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? logs.find((l) => l.id === selectedId) ?? null : null;
  const totalCost = calculateTotalCost(logs);
  const hasPending = logs.some((l) => l.status === 'pending');
  const now = useLiveClock(hasPending);

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="80vh">
      {selected ? (
        <LogDetail entry={selected} onBack={() => setSelectedId(null)} now={now} />
      ) : (
        <>
          <ModalHeader onClose={onClose}>
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <h2 className="text-[13px] font-medium text-text-primary truncate">{title}</h2>
              {headerActions}
            </div>
            <div className="flex items-center gap-4 text-[10px] shrink-0">
              <span className="text-text-dim tabular-nums">
                {logs.length} {logs.length === 1 ? 'call' : 'calls'}
              </span>
              <span className="font-mono text-emerald-400 tabular-nums">{formatCost(totalCost, 'header')}</span>
              {onClear && logs.length > 0 && (
                <button
                  onClick={onClear}
                  className="text-text-dim hover:text-text-secondary transition-colors px-2 py-0.5 rounded hover:bg-white/5"
                >
                  Clear
                </button>
              )}
            </div>
          </ModalHeader>
          <ModalBody className="p-0">
            {logs.length === 0 ? <EmptyState message={emptyMessage} /> : <LogList logs={logs} onSelect={setSelectedId} now={now} />}
          </ModalBody>
        </>
      )}
    </Modal>
  );
}

function EmptyState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-8 gap-3">
      <svg className="w-8 h-8 text-text-dim/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h10M7 16h6" />
        <rect x="3" y="4" width="18" height="16" rx="2" />
      </svg>
      <p className="text-[12px] text-text-dim text-center max-w-xs">
        {message ?? 'No API calls yet.'}
      </p>
    </div>
  );
}

function LogList({ logs, onSelect, now }: { logs: ApiLogEntry[]; onSelect: (id: string) => void; now: number }) {
  return (
    <div className="divide-y divide-white/5">
      {[...logs].reverse().map((entry) => (
        <LogListRow key={entry.id} entry={entry} onSelect={() => onSelect(entry.id)} now={now} />
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: ApiLogEntry['status'] }) {
  const color =
    status === 'success' ? 'bg-emerald-400' : status === 'error' ? 'bg-red-400' : 'bg-amber-400';
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${color} ${
        status === 'pending' ? 'animate-pulse' : ''
      }`}
      aria-label={status}
    />
  );
}

function LogListRow({ entry, onSelect, now }: { entry: ApiLogEntry; onSelect: () => void; now: number }) {
  const cost = calculateApiCost(entry);
  const modelLabel = entry.model?.split('/').pop() ?? '—';
  const isReplicate = entry.model?.startsWith('replicate/');
  const duration = entryDurationMs(entry, now);
  const isRunning = entry.status === 'pending';

  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors text-left group"
    >
      <StatusDot status={entry.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] text-text-primary font-medium truncate">{entry.caller}</span>
          <span className={`text-[9px] font-mono shrink-0 ${isReplicate ? 'text-pink-400/80' : 'text-text-dim/70'}`}>
            {modelLabel}
          </span>
        </div>
        {entry.error ? (
          <p className="text-[10px] text-red-400/80 truncate mt-0.5">{entry.error}</p>
        ) : (
          <div className="flex items-center gap-2 text-[10px] text-text-dim mt-0.5">
            <span className="tabular-nums">{formatTokens(entry.promptTokens)} in</span>
            <span className="text-text-dim/30">·</span>
            <span className="tabular-nums">{formatTokens(entry.responseTokens)} out</span>
          </div>
        )}
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-[10px] font-mono tabular-nums ${
              isRunning ? 'text-amber-400/90' : duration != null ? 'text-text-secondary' : 'text-text-dim/40'
            }`}
            title={isRunning ? 'Elapsed (still running)' : 'API call duration'}
          >
            {duration != null ? formatDuration(duration) : '—'}
          </span>
          <span className={`text-[11px] font-mono tabular-nums ${cost > 0 ? 'text-emerald-400/90' : 'text-text-dim/40'}`}>
            {formatCost(cost, 'row')}
          </span>
        </div>
        <span className="text-[9px] text-text-dim/60 tabular-nums">{formatTime(entry.timestamp)}</span>
      </div>
    </button>
  );
}

type Tab = 'error' | 'system' | 'prompt' | 'response' | 'reasoning';

function LogDetail({ entry, onBack, now }: { entry: ApiLogEntry; onBack: () => void; now: number }) {
  const hasSystem = !!entry.systemPromptPreview;
  const hasReasoning = !!entry.reasoningContent;
  const hasError = !!entry.error;
  // Failed calls open straight on the Error tab — diagnosis is the point.
  const [tab, setTab] = useState<Tab>(hasError ? 'error' : hasSystem ? 'system' : 'prompt');
  const cost = calculateApiCost(entry);
  const duration = entryDurationMs(entry, now);
  const durationLabel = entry.status === 'pending' ? 'running' : 'duration';

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={onBack}
            className="text-text-dim hover:text-text-primary transition-colors text-[11px] shrink-0"
          >
            &larr; Back
          </button>
          <div className="w-px h-3.5 bg-white/10 shrink-0" />
          <StatusDot status={entry.status} />
          <span className="text-[13px] text-text-primary font-medium truncate">{entry.caller}</span>
          {entry.model && (
            <span
              className={`text-[9px] font-mono shrink-0 ${
                entry.model.startsWith('replicate/') ? 'text-pink-400/80' : 'text-text-dim/70'
              }`}
            >
              {entry.model.split('/').pop()}
            </span>
          )}
        </div>
        <CopyButton
          text={buildDiagnostic(entry, duration)}
          label="Copy full diagnostic"
          variant="header"
        >
          Copy diagnostic
        </CopyButton>
      </div>

      {/* Meta strip */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 text-[10px] text-text-dim shrink-0">
        <MetaPill label="in" value={formatTokens(entry.promptTokens)} />
        <MetaPill label="out" value={formatTokens(entry.responseTokens)} />
        {entry.reasoningTokens != null && <MetaPill label="reasoning" value={formatTokens(entry.reasoningTokens)} />}
        <MetaPill label="cost" value={formatCost(cost, 'detail')} highlight={cost > 0} />
        <MetaPill
          label={durationLabel}
          value={duration != null ? formatDuration(duration) : '—'}
          highlight={entry.status === 'pending'}
          tone="pending"
        />
        <span className="ml-auto tabular-nums">{formatTime(entry.timestamp)}</span>
      </div>

      {/* Tabs */}
      <div className="flex items-stretch border-b border-white/8 shrink-0">
        {hasError && <TabButton active={tab === 'error'} onClick={() => setTab('error')} color="red">Error</TabButton>}
        {hasSystem && <TabButton active={tab === 'system'} onClick={() => setTab('system')} color="cyan">System</TabButton>}
        <TabButton active={tab === 'prompt'} onClick={() => setTab('prompt')}>Prompt</TabButton>
        <TabButton active={tab === 'response'} onClick={() => setTab('response')}>Response</TabButton>
        {hasReasoning && (
          <TabButton active={tab === 'reasoning'} onClick={() => setTab('reasoning')} color="purple">
            Reasoning
          </TabButton>
        )}
        <CopyButton text={tabContent(entry, tab)} label={`Copy ${tab}`} />
      </div>

      <div className="overflow-y-auto p-4" style={{ maxHeight: 'calc(80vh - 13rem)' }}>
        <pre className={`text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word font-mono ${
          tab === 'error' ? 'text-red-300' : 'text-text-secondary'
        }`}>
          {tabContent(entry, tab)}
        </pre>
      </div>
    </div>
  );
}

/** Multi-line trace bundling everything you'd paste into a bug report:
 *  caller, model, timing, status, error, then the four content panes. */
function buildDiagnostic(entry: ApiLogEntry, duration: number | null): string {
  const ts = new Date(entry.timestamp).toISOString();
  const lines: string[] = [
    `caller:    ${entry.caller}`,
    `model:     ${entry.model ?? '—'}`,
    `status:    ${entry.status}`,
    `timestamp: ${ts}`,
    `duration:  ${duration != null ? formatDuration(duration) : '—'}`,
    `tokens:    in ${formatTokens(entry.promptTokens)} · out ${formatTokens(entry.responseTokens)}${
      entry.reasoningTokens != null ? ` · reasoning ${formatTokens(entry.reasoningTokens)}` : ''
    }`,
  ];
  if (entry.narrativeId) lines.push(`narrative: ${entry.narrativeId}`);
  if (entry.analysisId) lines.push(`analysis:  ${entry.analysisId}`);

  const section = (label: string, content: string | null | undefined) =>
    content ? `\n──── ${label} ────\n${content}` : '';

  return [
    lines.join('\n'),
    section('ERROR', entry.error),
    section('SYSTEM', entry.systemPromptPreview),
    section('PROMPT', entry.promptPreview),
    section('RESPONSE', entry.responsePreview),
    section('REASONING', entry.reasoningContent),
  ]
    .filter(Boolean)
    .join('\n');
}

function CopyButton({
  text,
  label,
  variant = 'tab',
  children,
}: {
  text: string;
  label: string;
  variant?: 'tab' | 'header';
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write can fail in non-secure contexts; swallow silently.
    }
  };
  const className = variant === 'header'
    ? `shrink-0 px-2.5 py-1 text-[10px] font-mono rounded transition-colors flex items-center gap-1.5 border ${
        copied ? 'text-emerald-400 border-emerald-400/30' : 'text-text-dim border-white/10 hover:text-text-secondary hover:border-white/20'
      }`
    : `ml-auto px-3 py-2 text-[10px] font-mono transition-colors flex items-center gap-1.5 border-b border-transparent ${
        copied ? 'text-emerald-400' : 'text-text-dim hover:text-text-secondary'
      }`;
  const defaultLabel = variant === 'header' ? null : 'Copy';
  return (
    <button type="button" onClick={onCopy} title={label} aria-label={label} className={className}>
      {copied ? (
        <>
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
          {children ?? defaultLabel}
        </>
      )}
    </button>
  );
}

function MetaPill({
  label,
  value,
  highlight,
  tone = 'success',
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: 'success' | 'pending';
}) {
  const highlightColor = tone === 'pending' ? 'text-amber-400/90' : 'text-emerald-400/90';
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-text-dim/50 uppercase tracking-wider text-[9px]">{label}</span>
      <span className={`tabular-nums font-mono ${highlight ? highlightColor : 'text-text-secondary'}`}>{value}</span>
    </span>
  );
}

function tabContent(entry: ApiLogEntry, tab: Tab): string {
  switch (tab) {
    case 'error':
      return entry.error || '(no error captured)';
    case 'system':
      return entry.systemPromptPreview || '(no system prompt)';
    case 'prompt':
      return entry.promptPreview || '(empty)';
    case 'reasoning':
      return entry.reasoningContent || '(no reasoning content)';
    case 'response':
      return entry.responsePreview || (entry.status === 'pending' ? 'Waiting for response...' : '(empty)');
  }
}

function TabButton({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: 'cyan' | 'purple' | 'red';
  children: ReactNode;
}) {
  const accent =
    color === 'cyan'
      ? active ? 'text-cyan-400 border-cyan-400/50' : 'text-text-dim hover:text-cyan-300'
      : color === 'purple'
      ? active ? 'text-purple-400 border-purple-400/50' : 'text-text-dim hover:text-purple-300'
      : color === 'red'
      ? active ? 'text-red-400 border-red-400/50' : 'text-red-400/70 hover:text-red-300'
      : active ? 'text-text-primary border-white/30' : 'text-text-dim hover:text-text-secondary';
  return (
    <button
      className={`px-4 py-2 text-[11px] transition-colors border-b ${active ? accent : 'border-transparent ' + accent}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ── Formatters ──────────────────────────────────────────────────────────── */

/** Token counts with k suffix for readability: 12,345 → 12.3k, 523 → 523. */
function formatTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1_000) return n.toLocaleString();
  return n.toString();
}

/**
 * Cost with context-appropriate precision:
 *   header → `Total: $0.1234` (4 dp, always shown)
 *   row    → `$0.0068` or `—` when zero (sub-cent uses 4 dp)
 *   detail → same as row, shows `$0.00` when zero
 */
function formatCost(cost: number, context: 'header' | 'row' | 'detail'): string {
  if (context === 'header') return `$${cost.toFixed(cost < 1 ? 4 : 2)}`;
  if (cost <= 0) return context === 'detail' ? '$0.00' : '—';
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/** Duration with unit that fits: <1s → ms, <60s → Xs, ≥60s → Xm Xs. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
