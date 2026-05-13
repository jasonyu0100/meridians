'use client';

import { useCallback, useMemo, useState } from 'react';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { useStore } from '@/lib/store';
import { findHeadArc, type ExperimentationHook } from '@/hooks/useExperimentation';
import {
  type ExperimentationConfig,
  type ScenarioRun,
} from '@/types/experimentation';
import { VARIABLE_INTENSITY_LEVELS, categoryColor, scenarioProbabilities } from '@/lib/ai/variables';
import type { PlanningScenario } from '@/types/narrative';
import {
  ActivityChart,
  CubeSequence,
  CubeStrip,
  DevelopsList,
  GradeStrip,
  POSITION_COLORS,
  SceneDetail,
  SceneList,
  Sparkline,
  scoreColorClass,
  useScenarioMetrics,
} from './ScenarioAnalytics';
import { IconRefresh, IconStop } from '@/components/icons';

/**
 * Experimentation panel — parallel scenario-driven branch generation.
 *
 * Three states the panel cycles through:
 *
 *   1. NO SCENARIOS — the focused arc has no Future scenarios yet. The
 *      panel shows a CTA pointing to the Future view so the user can
 *      generate predictive scenarios first.
 *
 *   2. CONFIG (idle) — scenarios exist; the panel lists them with
 *      checkboxes, a parallel-workers selector, and an optional
 *      direction / constraints box. "Start Generation" kicks off the
 *      batch.
 *
 *   3. RUN / RESULTS — full-screen view: left rail lists each scenario
 *      run with status + progress; right pane shows the selected run's
 *      stream + generated arc summary. "Commit all" attaches every done
 *      run as a new branch (highest-probability one becomes active).
 */
export function ExperimentationPanel({
  isOpen,
  onClose,
  experimentation,
}: {
  isOpen: boolean;
  onClose: () => void;
  experimentation: ExperimentationHook;
}) {
  const { state, dispatch } = useStore();
  const { runState, start, stop, reset, commit, retry, stopScenario } = experimentation;

  const narrative = state.activeNarrative;
  // Experimentation always anchors on the HEAD arc — the latest arc in
  // the active branch — regardless of where the user is currently
  // viewing. The cohort that drives the batch is the head arc's Future
  // scenarios.
  const headArc = useMemo(
    () => (narrative ? findHeadArc(narrative, state.resolvedEntryKeys) : null),
    [narrative, state.resolvedEntryKeys],
  );
  const hasAnyArcs = !!narrative && Object.keys(narrative.arcs).length > 0;
  const availableScenarios = useMemo<PlanningScenario[]>(
    () => (headArc?.planningScenarios ?? []).filter((s) => Array.isArray(s.variables) && s.variables.length > 0),
    [headArc],
  );
  const probs = useMemo(() => scenarioProbabilities(availableScenarios), [availableScenarios]);

  const isIdle = runState.status === 'idle';
  const isRunning = runState.status === 'running';
  const isComplete = runState.status === 'complete';
  const isCancelled = runState.status === 'cancelled';

  if (!isOpen) return null;

  // ── Prerequisite-aware empty state ──────────────────────────────────
  // Experimentation needs:
  //   1. At least one arc in the narrative (not just world commits)
  //   2. Future scenarios generated on the HEAD arc (the latest one)
  // The CTA explains the missing piece and routes the user there.
  if (isIdle && availableScenarios.length === 0) {
    const noArcs = !hasAnyArcs;
    const noHeadArc = hasAnyArcs && !headArc;
    return (
      <Modal onClose={onClose} size="md">
        <ModalHeader onClose={onClose}>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Experimentation</h2>
            <p className="text-[10px] text-text-dim uppercase tracking-wider">Parallel scenario branches</p>
          </div>
        </ModalHeader>
        <ModalBody className="p-6 space-y-4">
          <p className="text-[12px] text-text-secondary leading-relaxed">
            Experimentation always anchors on the <span className="text-text-primary font-medium">head arc</span> — the latest arc in the current branch. Each batch generates one continuation per Future scenario on that arc in parallel.
          </p>
          <div className="space-y-2 text-[11px] text-text-dim leading-relaxed">
            <div className="text-[10px] uppercase tracking-widest text-text-dim/80">Prerequisites</div>
            <Prereq satisfied={hasAnyArcs} label="At least one arc">
              {noArcs ? "Your narrative only has world commits so far. Generate (or analyse) at least one arc before Experimentation has somewhere to continue from." : 'Found.'}
            </Prereq>
            <Prereq satisfied={!!headArc && !noHeadArc} label="A head arc to continue from">
              {noArcs
                ? 'Will resolve once an arc exists.'
                : noHeadArc
                  ? "Couldn't resolve the latest arc on this branch — try moving the cursor onto an arc scene."
                  : `Head arc: ${headArc!.name}.`}
            </Prereq>
            <Prereq satisfied={availableScenarios.length > 0} label="Future scenarios on the head arc">
              {availableScenarios.length > 0
                ? `${availableScenarios.length} scenarios ready.`
                : headArc
                  ? `${headArc.name} has no Future scenarios yet. Open the Future view to generate a cohort of predictive coordinations.`
                  : 'Will resolve once a head arc exists.'}
            </Prereq>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="h-9 px-4 rounded-lg text-text-dim hover:text-text-primary text-[12px] transition-colors"
            >
              Cancel
            </button>
            {!!headArc && (
              <button
                onClick={() => {
                  dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'future' });
                  onClose();
                }}
                className="h-9 px-5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold text-[12px] transition"
              >
                Open Future view →
              </button>
            )}
          </div>
        </ModalBody>
      </Modal>
    );
  }

  // ── Config (idle, scenarios available) ──────────────────────────────
  if (isIdle) {
    return (
      <ConfigModal
        scenarios={availableScenarios}
        probs={probs}
        arcName={headArc?.name ?? '(unknown arc)'}
        onClose={onClose}
        onStart={(config) => {
          void start(config);
        }}
      />
    );
  }

  // ── Run / results ───────────────────────────────────────────────────
  return (
    <RunView
      runState={runState}
      isRunning={isRunning}
      isComplete={isComplete}
      isCancelled={isCancelled}
      onStop={() => {
        stop();
      }}
      onRetry={retry}
      onStopScenario={stopScenario}
      onCommit={() => {
        commit();
        onClose();
      }}
      onClose={() => {
        if (isRunning) {
          // Don't fully reset while a batch is mid-flight — let it
          // continue in the background, just hide the panel.
          onClose();
        } else {
          reset();
          onClose();
        }
      }}
    />
  );
}

// ── Config modal ──────────────────────────────────────────────────────────

function ConfigModal({
  scenarios, probs, arcName, onClose, onStart,
}: {
  scenarios: PlanningScenario[];
  probs: Record<string, number>;
  arcName: string;
  onClose: () => void;
  onStart: (config: Partial<ExperimentationConfig>) => void;
}) {
  // The scenario's coordination IS the direction; no separate user-supplied
  // direction or constraints box. Each scenario's variables drive its own
  // generation, and the cohort as a whole already represents the user's
  // intent (refined via the Future view).
  const [selected, setSelected] = useState<Set<string>>(() => new Set(scenarios.map((s) => s.id)));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIds = Array.from(selected);
  const canStart = selectedIds.length > 0;

  const handleStart = useCallback(() => {
    onStart({
      selectedScenarioIds: selectedIds,
    });
  }, [selectedIds, onStart]);

  return (
    <Modal onClose={onClose} size="lg" maxHeight="90vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Experimentation</h2>
          <p className="text-[10px] text-text-dim uppercase tracking-wider">
            {arcName} · {scenarios.length} scenarios
          </p>
        </div>
      </ModalHeader>
      <ModalBody className="p-6 space-y-5">
        <p className="text-[11px] text-text-dim leading-relaxed">
          One arc continuation is generated per selected scenario in parallel.
          Each continuation uses the scenario&apos;s variable coordination as
          primary guidance. When the batch completes, commit to attach every
          run as a branch — the highest-probability one becomes active.
        </p>

        <div>
          <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">
            Scenarios <span className="text-text-dim/60">({selectedIds.length}/{scenarios.length} selected)</span>
          </label>
          <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
            {scenarios
              .slice()
              .sort((a, b) => (probs[b.id] ?? 0) - (probs[a.id] ?? 0))
              .map((s) => {
                const isSelected = selected.has(s.id);
                const p = probs[s.id] ?? 0;
                return (
                  <label
                    key={s.id}
                    className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                      isSelected ? 'bg-white/8' : 'hover:bg-white/4'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(s.id)}
                      className="mt-1 accent-blue-500"
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full mt-2 shrink-0"
                      style={{ background: s.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-[12px] text-text-primary font-medium">{s.name}</span>
                        <span className="text-[10px] text-text-dim/70 font-mono tabular-nums shrink-0">
                          {Math.round(p * 100)}%
                        </span>
                      </div>
                      {s.tagline && (
                        <div className="text-[10px] text-text-dim leading-snug mt-0.5">{s.tagline}</div>
                      )}
                      <VariablesStrip variables={s.variables} />
                    </div>
                  </label>
                );
              })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg text-text-dim hover:text-text-primary text-[12px] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="h-9 px-5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold text-[12px] transition disabled:opacity-30"
          >
            Start generation →
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ── Run view (fullscreen overlay) ────────────────────────────────────────

function RunView({
  runState, isRunning, isComplete, isCancelled,
  onStop, onRetry, onStopScenario, onCommit, onClose,
}: {
  runState: ExperimentationHook['runState'];
  isRunning: boolean;
  isComplete: boolean;
  isCancelled: boolean;
  onStop: () => void;
  onRetry: (scenarioId: string) => void;
  onStopScenario: (scenarioId: string) => void;
  onCommit: () => void;
  onClose: () => void;
}) {
  const ordered = runState.scenarioOrder
    .map((id) => runState.runs[id])
    .filter((r): r is ScenarioRun => !!r);

  // Sort mode (ported from legacy MCTSPanel): "order" = the cohort's
  // original sequence (how the user configured it), "prob" = highest
  // softmax probability at launch, "score" = highest computed force grade
  // once the run completes.
  type SortMode = 'order' | 'prob' | 'score';
  const [sortMode, setSortMode] = useState<SortMode>('order');
  const railRuns = useMemo(() => {
    if (sortMode === 'order') return ordered;
    if (sortMode === 'prob') {
      return [...ordered].sort((a, b) => b.probabilityAtStart - a.probabilityAtStart);
    }
    // score: only really meaningful once runs are done. Sort done first
    // (descending by grade.overall when we can compute it cheaply), then
    // running/pending/failed/cancelled in original order.
    return [...ordered].sort((a, b) => {
      const ad = a.status === 'done' ? 1 : 0;
      const bd = b.status === 'done' ? 1 : 0;
      if (ad !== bd) return bd - ad;
      // Equal status — keep launch order for stability.
      return runState.scenarioOrder.indexOf(a.scenarioId) - runState.scenarioOrder.indexOf(b.scenarioId);
    });
  }, [ordered, sortMode, runState.scenarioOrder]);

  // User-selected scenario, with a derived fallback to the first run. No
  // useEffect — the derivation handles "new batch starts, no selection
  // yet" cleanly and avoids cascading-render lint warnings.
  const [userSelectedId, setUserSelectedId] = useState<string | null>(null);
  const activeId = userSelectedId && runState.runs[userSelectedId]
    ? userSelectedId
    : railRuns[0]?.scenarioId ?? null;
  const active = activeId ? runState.runs[activeId] : null;
  const doneCount = ordered.filter((r) => r.status === 'done').length;
  const failedCount = ordered.filter((r) => r.status === 'failed').length;
  const runningCount = ordered.filter((r) => r.status === 'running').length;
  // Commit is allowed as soon as ANY branch is done — the user can ship
  // what's ready and stop waiting on stragglers. Committing mid-flight
  // cancels in-flight workers (their results are discarded; only the
  // branches already 'done' get attached).
  const canCommit = doneCount > 0;

  return (
    <div className="fixed inset-0 z-50 bg-bg-base/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="h-12 shrink-0 flex items-center px-4 gap-3 border-b border-white/8 glass-panel">
        <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" style={{ boxShadow: '0 0 4px rgba(96,165,250,0.8)' }} />
        <h2 className="text-sm font-semibold text-text-primary">Experimentation</h2>
        <span className="text-[10px] uppercase tracking-wider text-text-dim font-mono">
          {isRunning ? 'Running' : isComplete ? 'Complete' : isCancelled ? 'Cancelled' : 'Idle'}
        </span>
        <div className="w-px h-4 bg-white/12" />
        <span className="text-[10px] text-text-secondary font-mono tabular-nums">
          {doneCount}/{ordered.length} done
        </span>
        {runningCount > 0 && (
          <span className="text-[10px] text-blue-300/80 font-mono">{runningCount}↻</span>
        )}
        {failedCount > 0 && (
          <span className="text-[10px] text-rose-300/80 font-mono">{failedCount}✕</span>
        )}

        <div className="flex-1" />

        {isRunning && (
          <button onClick={onStop} className="h-8 px-3 rounded-md text-[11px] text-rose-300/80 hover:text-rose-200 hover:bg-white/6 transition-colors">
            Stop
          </button>
        )}
        <button
          onClick={onCommit}
          disabled={!canCommit}
          className="h-8 px-4 rounded-md bg-white/10 hover:bg-white/16 text-text-primary font-semibold text-[11px] transition disabled:opacity-30"
          title={
            isRunning && runningCount > 0
              ? `Commit ${doneCount} done branch${doneCount === 1 ? '' : 'es'} now and cancel the ${runningCount} still generating`
              : undefined
          }
        >
          Commit {doneCount > 0 ? `${doneCount} ` : ''}branch{doneCount === 1 ? '' : 'es'}
          {isRunning && runningCount > 0 && (
            <span className="ml-1 text-text-dim/70 font-normal">· cancels {runningCount}</span>
          )}
        </button>
        <button onClick={onClose} className="h-8 px-3 rounded-md text-[11px] text-text-dim hover:text-text-primary hover:bg-white/6 transition-colors">
          Close
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Left rail */}
        <div className="w-80 shrink-0 border-r border-white/8 overflow-y-auto flex flex-col">
          {/* Sort toggle — mirrors legacy MCTSPanel sidebar */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-white/6 sticky top-0 bg-bg-base/95 backdrop-blur z-10">
            <span className="text-[9px] uppercase tracking-widest text-text-dim mr-1">Sort</span>
            {([
              { value: 'order' as SortMode, label: 'Order' },
              { value: 'prob' as SortMode, label: 'Prob' },
              { value: 'score' as SortMode, label: 'Score' },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSortMode(opt.value)}
                className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors ${
                  sortMode === opt.value ? 'text-text-primary bg-white/8' : 'text-text-dim hover:text-text-secondary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex-1">
            {railRuns.map((r) => (
              <ScenarioRow
                key={r.scenarioId}
                run={r}
                isActive={r.scenarioId === activeId}
                onSelect={() => setUserSelectedId(r.scenarioId)}
                onRetry={() => onRetry(r.scenarioId)}
                onStopScenario={() => onStopScenario(r.scenarioId)}
              />
            ))}
          </div>
        </div>

        {/* Right pane */}
        <div className="flex-1 overflow-y-auto">
          {active ? <ScenarioInspector run={active} /> : (
            <div className="h-full flex items-center justify-center text-[11px] text-text-dim italic">
              Select a scenario to inspect.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Scenario row (left rail) ─────────────────────────────────────────────

function ScenarioRow({
  run,
  isActive,
  onSelect,
  onRetry,
  onStopScenario,
}: {
  run: ScenarioRun;
  isActive: boolean;
  onSelect: () => void;
  onRetry: () => void;
  onStopScenario: () => void;
}) {
  const statusLabel: Record<ScenarioRun['status'], string> = {
    pending: 'queued',
    running: 'generating…',
    done: 'done',
    failed: 'failed',
    cancelled: 'cancelled',
  };
  const statusColor: Record<ScenarioRun['status'], string> = {
    pending: 'text-text-dim/60',
    running: 'text-blue-300',
    done: 'text-emerald-300',
    failed: 'text-rose-300',
    cancelled: 'text-amber-200',
  };
  // Live tail: show the trailing characters of the reasoning stream so
  // the user sees the model thinking even without expanding the row to
  // the inspector pane.
  const tail = run.streamText
    ? run.streamText.slice(-180).replace(/\s+/g, ' ').trim()
    : '';
  // Force-based analytics — only meaningful once the run has finished and
  // we have a real scene set to grade against.
  const metrics = useScenarioMetrics(run);
  // Retry: always offered. If the run is currently in flight, the retry
  // helper kills the old worker first via the per-scenario cancel flag,
  // then fires a fresh one — handles the "stalled, force a restart" case
  // the user explicitly called out.
  // Stop: only meaningful while a worker is actually in flight.
  const canStop = run.status === 'running' || run.status === 'pending';
  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={`group relative w-full text-left px-3 py-2 border-b border-white/6 transition-colors cursor-pointer ${
        isActive ? 'bg-white/6' : 'hover:bg-white/3'
      }`}
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: run.color, opacity: isActive ? 1 : 0.6 }}
      />
      {/* Row 1: probability + score (when available) + name + retry. The
          probability stays visible regardless of run status so the user
          can compare what the cohort priced this scenario at vs. what
          it actually scored when generated. */}
      <div className="flex items-baseline gap-2 pl-1.5">
        <span
          className="font-mono text-[10px] text-text-dim/70 tabular-nums w-8 text-right shrink-0"
          title={`Cohort probability at launch: ${Math.round(run.probabilityAtStart * 100)}%`}
        >
          {Math.round(run.probabilityAtStart * 100)}%
        </span>
        {metrics && (
          <span
            className={`font-mono text-[12px] font-bold w-7 text-right shrink-0 ${scoreColorClass(metrics.grade.overall)}`}
            title="Predicted post-commit narrative score"
          >
            {metrics.grade.overall}
          </span>
        )}
        <span className="text-[11px] text-text-primary font-medium leading-snug flex-1" style={isActive ? { color: run.color } : undefined}>
          {run.name}
        </span>
        {/* Sparkline — only when scenes exist */}
        {metrics && <Sparkline series={metrics.arcSparkline} width={44} height={14} />}
        {/* Per-row actions: hidden by default, fade in on row hover or
            when the row is active. Icon-only — keeps the rail's typographic
            density intact instead of competing with the score/name. */}
        <div className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}>
          {canStop && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStopScenario(); }}
              className="w-5 h-5 flex items-center justify-center text-text-dim/60 hover:text-rose-300 hover:bg-white/6 rounded transition-colors"
              title="Stop — cancel just this branch"
            >
              <IconStop size={9} />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRetry(); }}
            className="w-5 h-5 flex items-center justify-center text-text-dim/60 hover:text-text-primary hover:bg-white/6 rounded transition-colors"
            title="Retry — re-run this branch"
          >
            <IconRefresh size={10} />
          </button>
        </div>
      </div>
      {/* Row 2: status + cube strip + scene count + position */}
      <div className="flex items-center gap-1.5 pl-1.5 mt-1">
        <StatusDot status={run.status} />
        <span className={`text-[9px] font-mono uppercase tracking-[0.12em] ${statusColor[run.status]}`}>
          {statusLabel[run.status]}
        </span>
        {run.status === 'running' && run.phase && (
          <span className="text-[9px] text-text-dim/70">{run.phase}</span>
        )}
        {metrics && (
          <>
            <span className="mx-0.5">
              <CubeStrip scenes={metrics.scenes} forceMap={metrics.forceMap} max={8} />
            </span>
            <span className="text-[9px] text-text-dim/70 font-mono tabular-nums">
              {metrics.scenes.length}s
            </span>
          </>
        )}
        {metrics?.position && (
          <span
            className="text-[9px] font-medium ml-auto uppercase tracking-wider"
            style={{ color: POSITION_COLORS[metrics.position.key] ?? 'rgba(255,255,255,0.4)' }}
          >
            {metrics.position.name}
          </span>
        )}
        {!metrics && run.progress && (
          <span className="text-[9px] text-text-dim/70 font-mono tabular-nums ml-auto">
            {run.progress.current}/{run.progress.total}
          </span>
        )}
      </div>
      {/* Row 3: arc direction (when complete) OR live stream tail (when running) */}
      {metrics && run.result?.arc.directionVector && (
        <div className="pl-1.5 mt-1 text-[10px] text-text-dim leading-snug">
          {run.result.arc.directionVector}
        </div>
      )}
      {run.status === 'running' && tail && (
        <div className="pl-1.5 mt-1 text-[9px] text-text-dim/70 font-mono line-clamp-2 leading-snug">
          {tail}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: ScenarioRun['status'] }) {
  const cls: Record<ScenarioRun['status'], string> = {
    pending: 'bg-text-dim/40',
    running: 'bg-blue-400 animate-pulse',
    done: 'bg-emerald-400',
    failed: 'bg-rose-400',
    cancelled: 'bg-amber-400',
  };
  return <span className={`w-1.5 h-1.5 rounded-full ${cls[status]}`} />;
}

// ── Scenario inspector (right pane) ──────────────────────────────────────

function ScenarioInspector({ run }: { run: ScenarioRun }) {
  const metrics = useScenarioMetrics(run);
  // Selected scene index for the drill-down. Reset to null when the
  // active scenario changes — no useEffect needed; the derivation just
  // checks the run identity against the stored "previous run id".
  const [selectedScene, setSelectedScene] = useState<number | null>(null);
  const [prevRunId, setPrevRunId] = useState(run.scenarioId);
  if (run.scenarioId !== prevRunId) {
    setPrevRunId(run.scenarioId);
    setSelectedScene(null);
  }

  const scene = metrics && selectedScene != null ? metrics.scenes[selectedScene] : null;
  const sceneForces = scene && metrics ? metrics.forceMap[scene.id] ?? null : null;

  // Scene-detail view (drill-down)
  if (scene && metrics && run.result) {
    return (
      <div className="p-6 max-w-4xl">
        <SceneDetail
          scene={scene}
          index={selectedScene!}
          forces={sceneForces}
          narrative={run.result.virtualNarrative}
          onBack={() => setSelectedScene(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-baseline gap-2 mb-2">
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: run.color, boxShadow: `0 0 4px ${run.color}aa` }}
        />
        <h3 className="text-[14px] font-semibold text-text-primary">{run.name}</h3>
        {metrics?.position && (
          <span
            className="text-[10px] font-medium uppercase tracking-wider"
            style={{ color: POSITION_COLORS[metrics.position.key] ?? 'rgba(255,255,255,0.4)' }}
          >
            {metrics.position.name}
          </span>
        )}
        <span className="text-[11px] text-text-dim/70 font-mono ml-auto">
          {Math.round(run.probabilityAtStart * 100)}% likely at launch
        </span>
      </div>

      {/* Arc name + stats + direction + worldState + grade strip — mirrors
          the canvas Arc inspector so the user sees the same panel of facts
          regardless of which surface they're looking at. */}
      {run.result && (
        <div className="mb-4 flex flex-col gap-3">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-widest text-text-dim">Arc</span>
              <span className="font-mono text-[10px] text-text-dim">{run.result.arc.id}</span>
            </div>
            <p className="text-sm text-text-primary font-medium mt-0.5">{run.result.arc.name}</p>
          </div>

          <div className="flex gap-4 text-[10px] text-text-dim uppercase tracking-wider">
            <span>{metrics?.scenes.length ?? run.result.scenes.length} scenes</span>
            <span>{run.result.arc.activeCharacterIds.length} characters</span>
            <span>{run.result.arc.locationIds.length} locations</span>
          </div>

          {run.result.arc.directionVector && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Direction</h3>
              <p className="text-xs text-text-secondary leading-relaxed italic">
                {run.result.arc.directionVector}
              </p>
            </div>
          )}

          {run.result.arc.worldState && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">World State</h3>
              <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap rounded bg-white/3 p-2 font-mono">
                {run.result.arc.worldState}
              </p>
            </div>
          )}

          {metrics && (
            <div>
              <GradeStrip grade={metrics.grade} />
            </div>
          )}
        </div>
      )}

      {/* Cube sequence — visual at-a-glance of force trajectory */}
      {metrics && metrics.scenes.length > 0 && (
        <section className="mb-5">
          <div className="text-[10px] uppercase tracking-widest text-text-dim mb-1.5">Sequence</div>
          <CubeSequence
            scenes={metrics.scenes}
            forceMap={metrics.forceMap}
            onSelectScene={(i) => setSelectedScene(i)}
          />
        </section>
      )}

      {/* Activity chart with peaks/valleys */}
      {metrics && metrics.fullActivityPoints.length > 1 && (
        <section className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-widest text-text-dim">Activity</div>
            <div className="text-[9px] text-text-dim/70 font-mono">
              full timeline · arc highlighted
            </div>
          </div>
          <ActivityChart
            points={metrics.fullActivityPoints}
            arcStartIndex={metrics.arcStartIndex}
          />
        </section>
      )}

      {/* Threads this branch progresses */}
      {run.status === 'done' && <DevelopsList run={run} />}

      {/* Coordination variables (the scenario's variable setup) */}
      <section className="mt-5 mb-5">
        <div className="text-[10px] uppercase tracking-widest text-text-dim mb-2">Coordination</div>
        <VariablesList variables={run.variables} />
      </section>

      {/* Live reasoning while running — streams the model's thinking, not
          the output JSON. Visible cue that the worker is actually doing
          work even before the structured scenes resolve. */}
      {run.status === 'running' && (
        <section className="mb-5">
          <div className="text-[10px] uppercase tracking-widest text-text-dim mb-2">
            Live reasoning {run.phase && <span className="text-text-dim/60">· {run.phase}</span>}
          </div>
          <pre className="text-[11px] text-text-secondary font-mono whitespace-pre-wrap bg-bg-elevated border border-border rounded-lg p-3 max-h-80 overflow-y-auto">
            {run.streamText || 'thinking…'}
          </pre>
        </section>
      )}

      {/* Failure */}
      {run.status === 'failed' && (
        <section className="mb-5">
          <div className="text-[10px] uppercase tracking-widest text-rose-300/80 mb-2">Failed</div>
          <pre className="text-[11px] text-rose-200 font-mono whitespace-pre-wrap bg-rose-500/5 border border-rose-400/15 rounded-lg p-3">
            {run.error ?? 'Unknown error'}
          </pre>
        </section>
      )}

      {/* Scene list — clickable to drill into the per-scene detail view */}
      {metrics && metrics.scenes.length > 0 && run.result && (
        <section className="mb-5">
          <div className="text-[10px] uppercase tracking-widest text-text-dim mb-2">
            Scenes <span className="text-text-dim/60 normal-case tracking-normal">({metrics.scenes.length})</span>
          </div>
          <SceneList
            scenes={metrics.scenes}
            forceMap={metrics.forceMap}
            narrative={run.result.virtualNarrative}
            onSelectScene={setSelectedScene}
          />
        </section>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function Prereq({ satisfied, label, children }: { satisfied: boolean; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-0.5 text-[11px] shrink-0 ${satisfied ? 'text-emerald-300' : 'text-rose-300/80'}`}>
        {satisfied ? '✓' : '✕'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-text-secondary font-medium">{label}</div>
        <div className="text-[10px] text-text-dim leading-snug">{children}</div>
      </div>
    </div>
  );
}

function VariablesStrip({ variables }: { variables: { id: string; intensity: number; category?: string }[] }) {
  if (variables.length === 0) return null;
  return (
    <div className="flex items-center gap-0.5 mt-1.5">
      {variables.map((v) => {
        const cColor = categoryColor(v.category || 'general');
        const opacity = 0.4 + (v.intensity / 4) * 0.6;
        return (
          <span
            key={v.id}
            className="block flex-1 h-1.5 rounded-sm"
            style={{ background: cColor, opacity }}
          />
        );
      })}
    </div>
  );
}

function VariablesList({ variables }: { variables: ScenarioRun['variables'] }) {
  return (
    <ul className="space-y-2">
      {variables.map((v) => {
        const cColor = categoryColor(v.category || 'general');
        const intensity = VARIABLE_INTENSITY_LEVELS[v.intensity];
        return (
          <li key={v.id} className="flex items-baseline gap-2 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full shrink-0 translate-y-px" style={{ background: cColor }} />
            <span className="text-text-primary font-medium">{v.name}</span>
            <span className="text-text-dim/70 font-mono uppercase tracking-[0.12em] text-[9px]">
              {intensity?.label ?? '?'}
            </span>
            {v.description && (
              <span className="text-text-dim/70 italic flex-1 leading-snug">— {v.description}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
