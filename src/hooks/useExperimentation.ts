'use client';

/**
 * useExperimentation — parallel scenario-driven branch generation.
 *
 * Given the current arc's Future scenarios, kick off N parallel arc
 * continuations (one per scenario), each guided by that scenario's
 * variable coordination. Results are accumulated as candidate branches
 * the user can commit. Cancellable (Stop aborts all in-flight workers)
 * and stays out of the store until the commit step. No pause — each task
 * is one in-flight LLM call and can't be suspended mid-stream.
 */

import { useRef, useCallback, useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { generateScenes } from '@/lib/ai';
import { FatalApiError } from '@/lib/ai/errors';
import { logError } from '@/lib/system-logger';
import {
  buildDirectionFromScenario,
  buildVirtualState,
  runWithPool,
  stampScenarioVariables,
} from '@/lib/experimentation-engine';
import {
  buildTakenFromNarrative,
  remapScenarioCommit,
} from '@/lib/experimentation-remap';
import { scenarioProbabilities } from '@/lib/ai/variables';
import {
  DEFAULT_EXPERIMENTATION_CONFIG,
  initScenarioRun,
  makeEmptyRunState,
  type ExperimentationConfig,
  type ExperimentationRunState,
  type ScenarioRun,
} from '@/types/experimentation';
import type { Arc, NarrativeState, PlanningScenario, Scene } from '@/types/narrative';

/**
 * Resolve the "head arc" of the active branch — the arc containing the
 * last scene in the branch's entry order. Returns null if no arcs exist
 * yet (e.g., the narrative only has world commits). Experimentation always
 * anchors on the head arc, not whatever the cursor is currently viewing.
 */
export function findHeadArc(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
): Arc | null {
  for (let i = resolvedEntryKeys.length - 1; i >= 0; i--) {
    const key = resolvedEntryKeys[i];
    const scene = narrative.scenes[key];
    if (scene) {
      return narrative.arcs[scene.arcId] ?? null;
    }
  }
  return null;
}

export type ExperimentationHook = ReturnType<typeof useExperimentation>;

export function useExperimentation() {
  const { state, dispatch } = useStore();
  const cancelledRef = useRef(false);
  const runningRef = useRef(false);
  // Per-scenario cancel flags. Both the original batch's `runWithPool`
  // workers and any retry workers check this map alongside the global
  // `cancelledRef`, so a single stalled branch can be killed without
  // affecting its siblings.
  const scenarioCancelledRef = useRef<Map<string, boolean>>(new Map());
  // Mirror of runState so worker tasks can read fresh state without
  // re-rendering closures every time setRunState updates.
  const runStateRef = useRef<ExperimentationRunState>(makeEmptyRunState());

  const [runState, setRunStateInternal] = useState<ExperimentationRunState>(makeEmptyRunState());

  const setRunState = useCallback(
    (updater: (prev: ExperimentationRunState) => ExperimentationRunState) => {
      setRunStateInternal((prev) => {
        const next = updater(prev);
        runStateRef.current = next;
        return next;
      });
    },
    [],
  );

  /** Patch the per-scenario run for `scenarioId`. */
  const patchRun = useCallback(
    (scenarioId: string, patch: Partial<ScenarioRun>) => {
      setRunState((prev) => {
        const existing = prev.runs[scenarioId];
        if (!existing) return prev;
        return {
          ...prev,
          runs: { ...prev.runs, [scenarioId]: { ...existing, ...patch } },
        };
      });
    },
    [setRunState],
  );

  // ── Start ───────────────────────────────────────────────────────────────

  /**
   * Kick off the batch. Reads the focused arc's Future scenarios and
   * launches one generation per scenario with bounded parallelism. Returns
   * immediately; the run progresses in the background.
   */
  const start = useCallback(
    async (configOverride: Partial<ExperimentationConfig> = {}) => {
      if (runningRef.current) return;
      const { activeNarrative, resolvedEntryKeys, viewState } = state;
      const { activeBranchId } = viewState;
      if (!activeNarrative || !activeBranchId) return;

      // Anchor the batch at the HEAD of the current branch — Experimentation
      // always continues from the latest arc's tip, regardless of where the
      // user's cursor currently sits. The head arc's Future scenarios drive
      // the cohort.
      const headIndex = resolvedEntryKeys.length - 1;
      const headArc = findHeadArc(activeNarrative, resolvedEntryKeys);
      if (!headArc) return;

      const scenarios = (headArc.planningScenarios ?? []).filter(
        (s) => Array.isArray(s.variables) && s.variables.length > 0,
      );
      if (scenarios.length === 0) return;

      const config: ExperimentationConfig = {
        ...DEFAULT_EXPERIMENTATION_CONFIG,
        ...configOverride,
      };
      const selected = config.selectedScenarioIds
        ? scenarios.filter((s) => config.selectedScenarioIds!.includes(s.id))
        : scenarios;
      if (selected.length === 0) return;

      const probs = scenarioProbabilities(selected);
      const order = selected.map((s) => s.id);
      const runs: Record<string, ScenarioRun> = {};
      for (const s of selected) {
        runs[s.id] = initScenarioRun(s, probs[s.id] ?? 0);
      }

      cancelledRef.current = false;
      scenarioCancelledRef.current = new Map();
      runningRef.current = true;

      setRunState(() => ({
        status: 'running',
        arcId: headArc.id,
        runs,
        scenarioOrder: order,
        config,
        startedAt: Date.now(),
        finishedAt: null,
      }));

      try {
        await runWithPool(
          order,
          async (scenarioId) => {
            const scenario = selected.find((s) => s.id === scenarioId);
            if (!scenario) return;
            await generateOneScenario({
              scenario,
              rootNarrative: activeNarrative,
              rootResolvedKeys: resolvedEntryKeys,
              rootHeadIndex: headIndex,
              activeBranchId,
              config,
              patchRun,
              isCancelled: () =>
                cancelledRef.current || !!scenarioCancelledRef.current.get(scenarioId),
            });
          },
          {
            // Run every scenario in parallel — the cohort is small (a
            // handful of futures) and the user always wants to see all
            // outcomes side-by-side rather than waiting in batches.
            parallel: selected.length,
            isCancelled: () => cancelledRef.current,
          },
        );
      } finally {
        const final = runStateRef.current;
        const cancelled = cancelledRef.current;
        setRunState((prev) => ({
          ...prev,
          status: cancelled ? 'cancelled' : 'complete',
          finishedAt: Date.now(),
        }));
        runningRef.current = false;
        void final;
      }
    },
    [state, patchRun, setRunState],
  );

  // ── Per-scenario stop / retry ──────────────────────────────────────────

  /**
   * Cancel one in-flight scenario without affecting siblings. Flips its
   * scenario-scoped cancel flag, which any worker (original batch or
   * retry) checks on its next async boundary. The current LLM stream
   * continues to its natural end (we can't interrupt fetch mid-stream)
   * but its result is discarded — the worker exits before writing back.
   */
  const stopScenario = useCallback(
    (scenarioId: string) => {
      scenarioCancelledRef.current.set(scenarioId, true);
      setRunState((prev) => {
        const existing = prev.runs[scenarioId];
        if (!existing) return prev;
        if (existing.status !== 'running' && existing.status !== 'pending') return prev;
        return {
          ...prev,
          runs: {
            ...prev.runs,
            [scenarioId]: {
              ...existing,
              status: 'cancelled',
              finishedAt: Date.now(),
              phase: 'cancelled',
            },
          },
        };
      });
    },
    [setRunState],
  );

  /**
   * Re-run a single scenario. If the scenario is currently running or
   * pending, it's stopped first (per-scenario cancel) so the stale worker
   * exits cleanly before the new one starts. The fresh worker runs against
   * the CURRENT narrative head — useful when a previous attempt stalled or
   * produced an unsatisfactory result. Fire-and-forget.
   */
  const retry = useCallback(
    (scenarioId: string) => {
      const run = runStateRef.current.runs[scenarioId];
      if (!run) return;
      const { activeNarrative, resolvedEntryKeys, viewState } = state;
      const { activeBranchId } = viewState;
      if (!activeNarrative || !activeBranchId) return;
      const headIndex = resolvedEntryKeys.length - 1;
      const config = runStateRef.current.config;

      // Kill any in-flight worker for this scenario before resetting. The
      // old worker will see the cancel flag on its next check and abort
      // before writing back, so its patchRun calls won't trample the
      // fresh state we're about to set up.
      scenarioCancelledRef.current.set(scenarioId, true);

      // Reset the scenario to pending so the rail visibly resets, then
      // clear the cancel flag so the FRESH worker isn't aborted before
      // it starts.
      setRunState((prev) => {
        const existing = prev.runs[scenarioId];
        if (!existing) return prev;
        return {
          ...prev,
          // Re-open the batch if it had moved to 'complete'/'cancelled' so
          // commit doesn't fire mid-retry. We move back to running until
          // the retry finishes; the natural status will resolve via the
          // worker's patchRun calls.
          status: prev.status === 'idle' ? prev.status : 'running',
          runs: {
            ...prev.runs,
            [scenarioId]: {
              ...existing,
              status: 'pending',
              streamText: '',
              error: undefined,
              result: undefined,
              progress: undefined,
              phase: 'retrying',
              startedAt: undefined,
              finishedAt: undefined,
            },
          },
          finishedAt: null,
        };
      });
      // Defer clearing the flag to next microtask so any callbacks the
      // old worker had in flight resolve first. Then the new worker
      // starts with a clean slate.
      scenarioCancelledRef.current.delete(scenarioId);

      const scenario: PlanningScenario = {
        id: run.scenarioId,
        name: run.name,
        color: run.color,
        variables: run.variables,
      };

      void (async () => {
        try {
          await generateOneScenario({
            scenario,
            rootNarrative: activeNarrative,
            rootResolvedKeys: resolvedEntryKeys,
            rootHeadIndex: headIndex,
            activeBranchId,
            config,
            patchRun,
            isCancelled: () =>
              cancelledRef.current || !!scenarioCancelledRef.current.get(scenarioId),
          });
        } finally {
          // If after this retry every scenario is non-running, mark the
          // batch complete so the commit button re-enables.
          setRunState((prev) => {
            const anyRunning = prev.scenarioOrder.some(
              (id) => prev.runs[id]?.status === 'running',
            );
            if (anyRunning) return prev;
            return {
              ...prev,
              status: prev.status === 'cancelled' ? 'cancelled' : 'complete',
              finishedAt: Date.now(),
            };
          });
        }
      })();
    },
    [state, patchRun, setRunState],
  );

  // ── Stop / reset ───────────────────────────────────────────────────────

  /** Cancel every in-flight worker and end the batch. In-flight LLM calls
   *  run to completion (we can't interrupt the stream) but their results
   *  are discarded — the cancel signal prevents writeback to runState. */
  const stop = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  /** Discard the current run state entirely — used by the panel's close
   *  flow when the user dismisses without committing. */
  const reset = useCallback(() => {
    cancelledRef.current = true;
    runningRef.current = false;
    setRunState(() => makeEmptyRunState());
  }, [setRunState]);

  // ── Commit ─────────────────────────────────────────────────────────────

  /**
   * Take every completed scenario run and turn it into a Branch. The
   * highest-probability completed run becomes the active branch; the rest
   * sit as parallel divergences off the same fork point. Each branch's
   * first arc carries the scenario's variables as `presentVariables`.
   *
   * Commits opportunistically — whatever's `done` right now gets attached.
   * If any scenarios are still running, they're cancelled (the cancel
   * signal stops them from writing back, and `runWithPool`'s next loop
   * iteration drains the queue without picking up new work). The user
   * gets to ship what's ready instead of waiting on stragglers.
   */
  const commit = useCallback(() => {
    const current = runStateRef.current;
    const activeBranchId = state.viewState.activeBranchId;
    const narrative = state.activeNarrative;

    // Clicking Commit is an explicit "I'm done with this run" signal.
    // Whatever happens below — successful attach, nothing-to-commit, or
    // missing-state bail — the run state goes back to idle so the control
    // bar disappears and the next run starts clean. Anything in flight is
    // cancelled so workers don't burn further LLM tokens after the user has
    // decided to move on.
    cancelledRef.current = true;
    const finishCommit = () => {
      setRunState(() => makeEmptyRunState());
      runningRef.current = false;
    };

    if (!current.arcId || !activeBranchId || !narrative) {
      finishCommit();
      return;
    }

    const completed = current.scenarioOrder
      .map((id) => current.runs[id])
      .filter((r): r is ScenarioRun => !!r && r.status === 'done' && !!r.result);
    if (completed.length === 0) {
      finishCommit();
      return;
    }

    // Rank by softmax probability; highest = active branch.
    const ranked = [...completed].sort((a, b) => b.probabilityAtStart - a.probabilityAtStart);
    // Fork off the LAST resolved entry of the parent branch — that's what
    // resolveEntrySequence will splice on when walking the new branch.
    const forkEntryId =
      state.resolvedEntryKeys[state.resolvedEntryKeys.length - 1] ?? null;

    // Comprehensive cumulative remap. Every parallel worker minted
    // every kind of id (scene, arc, character, location, artifact,
    // thread, world-graph node, system-graph node) from the SAME root
    // narrative, so brand-new entities collide across scenarios.
    // `remapScenarioCommit` walks every reference field per scenario and
    // mints collision-free ids drawn from a cumulative taken-set.
    const taken = buildTakenFromNarrative(narrative);

    let firstNewBranchId: string | null = null;
    for (const run of ranked) {
      if (!run.result) continue;
      const { arc, scenes } = remapScenarioCommit(
        run.result.arc,
        run.result.scenes,
        taken,
      );

      const branchId = `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const branchName = run.name;

      // Branch.entryIds holds ONLY the entries that diverge from the parent
      // past the fork point. resolveEntrySequence walks parent → fork →
      // branch.entryIds at read time. Inlining the parent's entries here
      // would duplicate every scene id and corrupt the resolved timeline.
      const newEntries = scenes.map((s) => s.id);

      dispatch({
        type: 'CREATE_BRANCH',
        branch: {
          id: branchId,
          name: branchName,
          parentBranchId: activeBranchId,
          forkEntryId,
          entryIds: newEntries,
          createdAt: Date.now(),
        },
      });
      dispatch({
        type: 'BULK_ADD_SCENES',
        scenes,
        arc,
        branchId,
      });
      if (!firstNewBranchId) firstNewBranchId = branchId;
    }

    // CREATE_BRANCH switches active to the last-created branch. Switch
    // back to the highest-probability one (first in `ranked`).
    if (firstNewBranchId) {
      dispatch({ type: 'SWITCH_BRANCH', branchId: firstNewBranchId });
    }

    finishCommit();
  }, [state, dispatch, setRunState]);

  // ── ID minting ────────────────────────────────────────────────────────
  // Local mirror of `nextId` — we can't import the helper because we'd
  // need to thread the cumulative `taken` set through. Walks N up until
  // it lands outside the set.

  // Derived: convenience flags + counts the UI watches.
  const summary = useMemo(() => {
    const ids = runState.scenarioOrder;
    let done = 0;
    let failed = 0;
    let running = 0;
    let pending = 0;
    for (const id of ids) {
      const r = runState.runs[id];
      if (!r) continue;
      if (r.status === 'done') done++;
      else if (r.status === 'failed') failed++;
      else if (r.status === 'running') running++;
      else if (r.status === 'pending') pending++;
    }
    return { total: ids.length, done, failed, running, pending };
  }, [runState]);

  return {
    runState,
    summary,
    start,
    stop,
    reset,
    commit,
    retry,
    stopScenario,
  };
}

// ── Per-scenario generation ─────────────────────────────────────────────

async function generateOneScenario(input: {
  scenario: PlanningScenario;
  rootNarrative: ReturnType<typeof useStore>['state']['activeNarrative'];
  rootResolvedKeys: string[];
  rootHeadIndex: number;
  activeBranchId: string;
  config: ExperimentationConfig;
  patchRun: (id: string, patch: Partial<ScenarioRun>) => void;
  isCancelled: () => boolean;
}): Promise<void> {
  const {
    scenario,
    rootNarrative,
    rootResolvedKeys,
    rootHeadIndex,
    activeBranchId,
    config,
    patchRun,
    isCancelled,
  } = input;

  if (!rootNarrative) return;

  patchRun(scenario.id, { status: 'running', startedAt: Date.now(), phase: 'generating scenes' });

  const direction = buildDirectionFromScenario(scenario, {
    overallDirection: config.direction,
    constraintsPrompt: config.constraintsPrompt,
  });

  const worldBuildFocus: undefined | { id: string; summary?: string } = undefined;
  // Local accumulator so the streamed reasoning tokens can be flushed into
  // the panel's `streamText` field without race conditions across workers.
  // We stream REASONING, not output JSON — the user wants to see the
  // model's thinking as it explores the scenario, not a wall of fragments
  // like `"events":["arrival"]`. The actual output is parsed and surfaced
  // structurally (scenes, arc, deltas) once the call resolves.
  let stream = '';

  try {
    const result = await generateScenes(
      rootNarrative,
      rootResolvedKeys,
      rootHeadIndex,
      0, // 0 = use targetArcLength from story settings
      direction,
      {
        worldBuildFocus,
        onReasoning: (token: string) => {
          stream += token;
          patchRun(scenario.id, { streamText: stream });
        },
      },
    );

    if (isCancelled()) return;

    const { scenes, arc: rawArc } = result;
    // Stamp the scenario's variable coordination onto the arc so the
    // committed branch carries the variables that produced it — plus the
    // scenario's description + reasoning so the new arc's Present
    // annotation continues the lineage. Shared helper with
    // buildVirtualState below so both paths agree on what gets stamped.
    const arc = stampScenarioVariables(rawArc, scenario);
    const virtual = buildVirtualState(
      rootNarrative,
      rootResolvedKeys,
      arc,
      scenes,
      activeBranchId,
      scenario,
    );

    patchRun(scenario.id, {
      status: 'done',
      finishedAt: Date.now(),
      phase: 'done',
      progress: { current: scenes.length, total: scenes.length },
      result: {
        arc,
        scenes,
        virtualNarrative: virtual.narrative,
        virtualResolvedKeys: virtual.resolvedKeys,
        virtualCurrentIndex: virtual.currentIndex,
      },
    });
  } catch (err) {
    logError('Scenario experimentation failed', err, {
      source: 'experimentation',
      operation: 'scenario-run',
      details: { scenarioId: scenario.id, name: scenario.name },
    });
    patchRun(scenario.id, {
      status: 'failed',
      finishedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof FatalApiError) throw err;
  }
}

// Re-exports for callers that previously imported these from the hook
// module. Kept here to avoid a churn of import paths in unrelated files.
export type {
  ExperimentationConfig,
  ExperimentationRunState,
  ScenarioRun,
} from '@/types/experimentation';
// We previously exported a placeholder Scene-typed result; downstream
// callers (panel, control bar) reference fields off ScenarioRun.result.
export type ExperimentationResultScene = Scene;
export type ExperimentationResultArc = Arc;
