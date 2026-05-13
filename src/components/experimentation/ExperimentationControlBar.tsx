'use client';

import { useState, useEffect } from 'react';
import { IconSpinner, IconStop, IconExpand } from '@/components/icons';
import type { ExperimentationRunState } from '@/types/experimentation';
import { runDoneCount, runFailedCount, runRunningCount } from '@/types/experimentation';

type Props = {
  runState: ExperimentationRunState;
  onStop: () => void;
  onOpenPanel: () => void;
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export function ExperimentationControlBar({ runState, onStop, onOpenPanel }: Props) {
  const { status, startedAt, scenarioOrder } = runState;
  const isRunning = status === 'running';
  const isComplete = status === 'complete';

  const done = runDoneCount(runState);
  const running = runRunningCount(runState);
  const failed = runFailedCount(runState);
  const total = scenarioOrder.length;

  // Ticking elapsed timer. Same pattern as ModeControlBar — the
  // setState-in-effect lint warning is unavoidable for a clock display
  // since Date.now() can't be referenced in render.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning || !startedAt) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt, isRunning]);

  // Find leading scenario by probability for the chip label.
  let topName: string | null = null;
  let topProb = -Infinity;
  for (const id of scenarioOrder) {
    const r = runState.runs[id];
    if (!r) continue;
    if (r.probabilityAtStart > topProb) {
      topProb = r.probabilityAtStart;
      topName = r.name;
    }
  }

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20">
      <div className="glass-pill px-3 py-1.5 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          {isRunning ? (
            <IconSpinner size={14} className="text-blue-400 animate-spin" />
          ) : (
            <div className={`w-2 h-2 rounded-full ${
              isComplete ? 'bg-green-400' : 'bg-text-dim'
            }`} />
          )}
          <span className="text-[10px] text-text-dim uppercase tracking-wider">Experimentation</span>
        </div>

        <div className="w-px h-4 bg-white/12" />

        <span className="text-[10px] text-text-secondary font-mono tabular-nums">
          {done}<span className="text-text-dim/50">/{total}</span>
        </span>
        <span className="text-[10px] text-text-dim">scenarios</span>

        {running > 0 && (
          <>
            <div className="w-px h-4 bg-white/12" />
            <span className="text-[10px] font-mono text-blue-300/80">{running}↻</span>
          </>
        )}
        {failed > 0 && (
          <>
            <div className="w-px h-4 bg-white/12" />
            <span className="text-[10px] font-mono text-rose-300/80">{failed}✕</span>
          </>
        )}

        {isRunning && (
          <>
            <div className="w-px h-4 bg-white/12" />
            <span className="text-[10px] text-text-dim font-mono whitespace-nowrap">
              {formatTime(elapsed)}
            </span>
          </>
        )}

        {topName && (
          <>
            <div className="w-px h-4 bg-white/12" />
            <span className="text-[10px] text-text-secondary truncate max-w-32" title={topName}>
              {topName}
            </span>
          </>
        )}

        <div className="w-px h-4 bg-white/12" />

        {isRunning && (
          <button onClick={onStop} className="w-6 h-6 flex items-center justify-center text-text-dim hover:text-fate hover:bg-white/6 rounded transition-colors" title="Stop — cancel all in-flight branches">
            <IconStop size={10} />
          </button>
        )}

        <button onClick={onOpenPanel} className="w-6 h-6 flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-white/6 rounded transition-colors" title="Open Experimentation panel">
          <IconExpand size={12} />
        </button>
      </div>
    </div>
  );
}
