'use client';

import { useState, useEffect } from 'react';
import { IconPause, IconPlay, IconStop, IconExpand, IconDocument, IconSettings, IconWarning, IconRefresh } from '@/components/icons';
import type { ExperimentationRunState } from '@/types/experimentation';
import type { AutoRunLog } from '@/types/narrative';

// ── Shared Types ─────────────────────────────────────────────────────────────

type ModeType = 'auto' | 'experimentation' | 'bulk-plan' | 'bulk-prose' | 'bulk-audio' | 'bulk-game';

// Pause/resume apply to auto + bulk modes (which manage queues we can
// genuinely pause between iterations). Experimentation runs are pure
// in-flight LLM calls — Stop cancels, but mid-call pause is impossible.
type PausableProps = {
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
};

type StopOnlyProps = {
  onStop: () => void;
};

type AutoModeProps = PausableProps & {
  mode: 'auto';
  isRunning: boolean;
  isPaused: boolean;
  currentCycle: number;
  totalScenes: number;
  statusMessage: string;
  log: AutoRunLog[];
  onOpenSettings: () => void;
  onOpenLog: () => void;
  /** Whether a coordination plan is active */
  hasCoordinationPlan?: boolean;
};

type ExperimentationModeProps = StopOnlyProps & {
  mode: 'experimentation';
  runState: ExperimentationRunState;
  onOpenPanel: () => void;
};

type BulkPlanProps = PausableProps & {
  mode: 'bulk-plan';
  isRunning: boolean;
  isPaused: boolean;
  progress: { completed: number; total: number };
  statusMessage: string;
};

type BulkProseProps = PausableProps & {
  mode: 'bulk-prose';
  isRunning: boolean;
  isPaused: boolean;
  progress: { completed: number; total: number };
  statusMessage: string;
};

type BulkAudioProps = PausableProps & {
  mode: 'bulk-audio';
  isRunning: boolean;
  isPaused: boolean;
  progress: { completed: number; total: number };
  statusMessage: string;
};

type BulkGameProps = PausableProps & {
  mode: 'bulk-game';
  isRunning: boolean;
  isPaused: boolean;
  progress: { completed: number; total: number };
  statusMessage: string;
};

type Props = AutoModeProps | ExperimentationModeProps | BulkPlanProps | BulkProseProps | BulkAudioProps | BulkGameProps;

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColorClass(v: number): string {
  if (v >= 90) return 'text-green-400';
  if (v >= 80) return 'text-lime-400';
  if (v >= 70) return 'text-yellow-400';
  if (v >= 60) return 'text-orange-400';
  return 'text-red-400';
}

const MODE_CONFIG: Record<ModeType, { label: string; color: string; bgColor: string }> = {
  'auto': { label: 'Auto', color: 'text-amber-400', bgColor: 'bg-amber-400' },
  'experimentation': { label: 'Experimentation', color: 'text-blue-400', bgColor: 'bg-blue-400' },
  'bulk-plan': { label: 'Plans', color: 'text-sky-400', bgColor: 'bg-sky-400' },
  'bulk-prose': { label: 'Prose', color: 'text-emerald-400', bgColor: 'bg-emerald-400' },
  'bulk-audio': { label: 'Audio', color: 'text-violet-400', bgColor: 'bg-violet-400' },
  'bulk-game': { label: 'Games', color: 'text-amber-400', bgColor: 'bg-amber-400' },
};

const ACTION_LABELS: Record<string, string> = {
  HHH: 'Convergence',
  HHL: 'Climax',
  HLH: 'Twist',
  HLL: 'Closure',
  LHH: 'Discovery',
  LHL: 'Growth',
  LLH: 'Wandering',
  LLL: 'Rest',
};

// ── Main Component ───────────────────────────────────────────────────────────

export function ModeControlBar(props: Props) {
  const config = MODE_CONFIG[props.mode];

  // Determine state
  const isRunning = props.mode === 'experimentation'
    ? props.runState.status === 'running'
    : props.isRunning;
  // Experimentation has no paused state — its runs are mid-flight LLM calls.
  const isPaused = props.mode === 'experimentation' ? false : props.isPaused;
  const isComplete = props.mode === 'experimentation' && props.runState.status === 'complete';

  // Auto mode specific
  const lastEntry = props.mode === 'auto' ? props.log[props.log.length - 1] : null;
  const lastError = lastEntry?.error;
  const stoppedByError = props.mode === 'auto' && !isRunning && !isPaused && lastError;
  const hasError = props.mode === 'auto' && !!lastError;

  // Experimentation timer
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (props.mode !== 'experimentation') return;
    const { startedAt } = props.runState;
    if (!isRunning || !startedAt) { setElapsed(0); return; }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [props.mode === 'experimentation' ? props.runState.startedAt : null, isRunning, props.mode]);

  // Experimentation metrics — scenario-batched flow: count done / total
  // across the cohort, surface the leading scenario's name.
  const experimentationMetrics = props.mode === 'experimentation' ? (() => {
    const { runs, scenarioOrder } = props.runState;
    let done = 0;
    let failed = 0;
    let running = 0;
    let topProb = -Infinity;
    let topName: string | null = null;
    for (const id of scenarioOrder) {
      const r = runs[id];
      if (!r) continue;
      if (r.status === 'done') done++;
      else if (r.status === 'failed') failed++;
      else if (r.status === 'running') running++;
      if (r.probabilityAtStart > topProb) {
        topProb = r.probabilityAtStart;
        topName = r.name;
      }
    }
    return { total: scenarioOrder.length, done, failed, running, topName };
  })() : null;

  return (
    <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
      {/* Main pill */}
      <div className={`
        flex items-center gap-2 px-2 py-1 rounded-full
        bg-bg-base/80 backdrop-blur-md border border-white/8
        shadow-lg shadow-black/20
        ${stoppedByError ? 'ring-1 ring-red-400/40' : ''}
      `}>
        {/* Mode indicator dot */}
        <div className="flex items-center gap-1.5 pl-1">
          {isRunning && hasError ? (
            <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
          ) : isRunning ? (
            <div className={`w-2 h-2 rounded-full ${config.bgColor} animate-pulse`} />
          ) : isComplete ? (
            <div className="w-2 h-2 rounded-full bg-green-400" />
          ) : stoppedByError ? (
            <div className="w-2 h-2 rounded-full bg-red-400" />
          ) : (
            <div className={`w-2 h-2 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-text-dim/50'}`} />
          )}
          <span className={`text-[9px] font-medium uppercase tracking-wider ${config.color}`}>
            {config.label}
          </span>
        </div>

        <div className="w-px h-3 bg-white/10" />

        {/* Mode-specific metrics */}
        {props.mode === 'auto' && (
          <>
            {/* Plan indicator */}
            {props.hasCoordinationPlan && (
              <>
                <span className="text-[9px] text-sky-400/80 font-medium">Plan</span>
                <div className="w-px h-3 bg-white/10" />
              </>
            )}
            {/* Show cycle number - add 1 when running first cycle to show "Arc 1" */}
            <span className="text-[9px] text-text-dim">Arc</span>
            <span className="text-[10px] text-text-secondary font-mono tabular-nums">
              {isRunning && props.currentCycle === 0 ? 1 : props.currentCycle}
            </span>
            {props.totalScenes > 0 && (
              <>
                <div className="w-px h-3 bg-white/10" />
                <span className="text-[10px] text-text-dim font-mono tabular-nums">
                  {props.totalScenes}
                </span>
                <span className="text-[9px] text-text-dim/50">scenes</span>
              </>
            )}
            {lastEntry && (
              <>
                <div className="w-px h-3 bg-white/10" />
                <span className="text-[9px] text-text-dim truncate max-w-24">
                  {ACTION_LABELS[lastEntry.action] ?? lastEntry.action}
                </span>
              </>
            )}
          </>
        )}

        {props.mode === 'experimentation' && experimentationMetrics && (
          <>
            <span className="text-[10px] text-text-secondary font-mono tabular-nums">
              {experimentationMetrics.done}
            </span>
            <span className="text-[9px] text-text-dim/50">/</span>
            <span className="text-[10px] text-text-dim font-mono tabular-nums">
              {experimentationMetrics.total}
            </span>
            <span className="text-[9px] text-text-dim/60">scenarios</span>
            {experimentationMetrics.running > 0 && (
              <>
                <div className="w-px h-3 bg-white/10" />
                <span className="text-[9px] text-blue-300/80 font-mono">
                  {experimentationMetrics.running}↻
                </span>
              </>
            )}
            {experimentationMetrics.failed > 0 && (
              <>
                <div className="w-px h-3 bg-white/10" />
                <span className="text-[9px] text-rose-300/80 font-mono">
                  {experimentationMetrics.failed}✕
                </span>
              </>
            )}
            {experimentationMetrics.topName && (
              <>
                <div className="w-px h-3 bg-white/10" />
                <span className="text-[10px] text-text-secondary truncate max-w-32" title={experimentationMetrics.topName}>
                  {experimentationMetrics.topName}
                </span>
              </>
            )}
          </>
        )}

        {(props.mode === 'bulk-plan' || props.mode === 'bulk-prose' || props.mode === 'bulk-audio' || props.mode === 'bulk-game') && (
          <>
            <span className="text-[10px] text-text-secondary font-mono tabular-nums">
              {props.progress.completed}
            </span>
            <span className="text-[9px] text-text-dim/50">/</span>
            <span className="text-[10px] text-text-dim font-mono tabular-nums">
              {props.progress.total}
            </span>
            {/* Progress bar */}
            <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  props.mode === 'bulk-plan' ? 'bg-sky-400' :
                  props.mode === 'bulk-prose' ? 'bg-emerald-400' :
                  props.mode === 'bulk-audio' ? 'bg-violet-400' : 'bg-amber-400'
                }`}
                style={{ width: `${(props.progress.completed / Math.max(props.progress.total, 1)) * 100}%` }}
              />
            </div>
          </>
        )}

        <div className="w-px h-3 bg-white/10" />

        {/* Controls */}
        <div className="flex items-center gap-0.5">
          {props.mode !== 'experimentation' && isRunning && (
            <button
              onClick={props.onPause}
              className="w-5 h-5 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/8 rounded-full transition-colors"
              title="Pause"
            >
              <IconPause size={8} />
            </button>
          )}
          {props.mode !== 'experimentation' && isPaused && (
            <button
              onClick={props.onResume}
              className={`w-5 h-5 flex items-center justify-center ${config.color} hover:bg-white/8 rounded-full transition-colors`}
              title="Resume"
            >
              <IconPlay size={8} />
            </button>
          )}
          <button
            onClick={props.onStop}
            className="w-5 h-5 flex items-center justify-center text-text-dim hover:text-red-400 hover:bg-white/8 rounded-full transition-colors"
            title="Stop"
          >
            <IconStop size={8} />
          </button>

          {/* Mode-specific actions */}
          {props.mode === 'auto' && (
            <>
              <button
                onClick={props.onOpenLog}
                className="w-5 h-5 flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-white/8 rounded-full transition-colors"
                title="View Log"
              >
                <IconDocument size={10} />
              </button>
              <button
                onClick={props.onOpenSettings}
                className="w-5 h-5 flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-white/8 rounded-full transition-colors"
                title="Settings"
              >
                <IconSettings size={10} />
              </button>
            </>
          )}
          {props.mode === 'experimentation' && (
            <button
              onClick={props.onOpenPanel}
              className="w-5 h-5 flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-white/8 rounded-full transition-colors"
              title="Open Experimentation panel"
            >
              <IconExpand size={10} />
            </button>
          )}
        </div>
      </div>

      {/* Status message below — contextual */}
      {props.mode === 'auto' && (isRunning || isPaused || stoppedByError) && props.statusMessage && (
        <div className={`mt-1 text-[9px] text-center max-w-72 px-2 ${
          stoppedByError
            ? 'text-red-400'
            : props.statusMessage.startsWith('Retry')
            ? 'text-amber-400'
            : props.statusMessage.startsWith('Error')
            ? 'text-red-400/80'
            : 'text-text-dim/70'
        }`}>
          {stoppedByError ? (
            <span className="flex items-center justify-center gap-1">
              <IconWarning size={10} className="shrink-0" />
              <span className="truncate">{props.statusMessage}</span>
              <button onClick={props.onOpenLog} className="underline hover:text-red-300 transition-colors shrink-0">logs</button>
            </span>
          ) : props.statusMessage.startsWith('Retry') ? (
            <span className="flex items-center justify-center gap-1">
              <IconRefresh size={10} className="shrink-0 animate-pulse" />
              <span className="truncate">{props.statusMessage}</span>
            </span>
          ) : (
            <span className="truncate block">{props.statusMessage}</span>
          )}
        </div>
      )}

      {/* Experimentation summary line — show the most recently started
          run's name + phase as the status text. */}
      {props.mode === 'experimentation' && isRunning && (() => {
        const latest = props.runState.scenarioOrder
          .map((id) => props.runState.runs[id])
          .filter((r) => r?.status === 'running')
          .sort((a, b) => (b?.startedAt ?? 0) - (a?.startedAt ?? 0))[0];
        if (!latest) return null;
        return (
          <div className="mt-1 text-[9px] text-blue-400/70 truncate">
            {latest.name}{latest.phase ? ` · ${latest.phase}` : ''}
          </div>
        );
      })()}

      {/* Bulk mode status */}
      {(props.mode === 'bulk-plan' || props.mode === 'bulk-prose' || props.mode === 'bulk-audio' || props.mode === 'bulk-game') && props.statusMessage && (
        <div className="mt-1 text-[9px] text-text-dim/70 text-center max-w-72 truncate">
          {props.statusMessage}
        </div>
      )}
    </div>
  );
}
