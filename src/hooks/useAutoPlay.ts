'use client';
// useAutoPlay — drives the auto-engine generation loop: evaluate state, build directives, generate arcs.

import { useRef, useCallback, useEffect } from 'react';
import { useStore } from '@/lib/state/store';
import {
  evaluateNarrativeState,
  checkEndConditions,
  pickArcLength,
  buildPlanDirective,
  getArcSceneCount,
  getArcNode,
  getVisibleNodesForArc,
  isPlanComplete,
} from '@/lib/auto-engine';
import { generateScenes, type CoordinationPlanContext } from '@/lib/ai';
import { FatalApiError } from '@/lib/ai/errors';
import { logError, logInfo } from '@/lib/core/system-logger';
import type {
  ReasoningMap,
  CoordinationPlan,
  ReasoningGraphSnapshot,
  ReasoningNodeSnapshot,
} from '@/types/narrative';
import { DEFAULT_AUTO_CONFIG } from '@/types/narrative';

/**
 * Package the coordination plan's visible-for-arc subgraph into a
 * reasoning-graph snapshot so it can be persisted as an arc-anchored
 * investigation. No additional LLM call — the plan's per-arc reasoning is
 * the artifact, just re-shaped to match the reasoning-graph contract.
 *
 * Plan-spine types (peak / valley / moment) carry through directly — the
 * reasoning-graph type union accepts them, and the visualisation + inspector
 * detail both render them via the shared plan palette. The structural
 * anchors stay distinct from generic fate / reasoning nodes.
 */
function buildCoordPlanMapGraph(
  plan: CoordinationPlan,
  arcIndex: number,
  arcLabel: string,
  sceneCount: number,
): ReasoningGraphSnapshot {
  const visible = getVisibleNodesForArc(plan, arcIndex);
  const visibleIds = new Set(visible.map((n) => n.id));

  const nodes: ReasoningNodeSnapshot[] = visible.map((n) => ({
    id: n.id,
    index: n.index,
    order: n.order,
    type: n.type,
    label: n.label,
    detail: n.detail,
    entityId: n.entityId,
    threadId: n.threadId,
    systemNodeId: n.systemNodeId,
  }));

  const edges = plan.edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));

  const arcNode = getArcNode(plan, arcIndex);
  return {
    nodes,
    edges,
    arcName: arcLabel,
    sceneCount,
    summary: arcNode?.detail ?? plan.summary,
  };
}

export function useAutoPlay() {
  const { state, dispatch } = useStore();
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const runCycle = useCallback(async () => {
    const { activeNarrative, resolvedEntryKeys, viewState } = stateRef.current;
    const { activeBranchId, autoRunState } = viewState;
    if (!activeNarrative || !activeBranchId || !autoRunState) return;
    const autoConfig = activeNarrative.storySettings?.autoConfig ?? DEFAULT_AUTO_CONFIG;

    const headIndex = resolvedEntryKeys.length - 1;
    const branch = activeNarrative.branches[activeBranchId];

    logInfo(`Auto-play cycle ${autoRunState.currentCycle + 1} starting`, {
      source: 'auto-play',
      operation: 'cycle-start',
      details: {
        cycle: autoRunState.currentCycle + 1,
        resolvedEntries: resolvedEntryKeys.length,
        hasCoordinationPlan: !!branch?.coordinationPlan,
        branchId: activeBranchId,
      },
    });

    // ── Coordination Plan Mode ────────────────────────────────────────────────
    // When a coordination plan exists, use plan-based generation
    const coordPlan = branch?.coordinationPlan;
    if (coordPlan) {
      const { plan } = coordPlan;

      // Check if plan is complete
      if (isPlanComplete(coordPlan)) {
        dispatch({ type: 'STOP_AUTO_RUN' });
        return;
      }

      // Arc indices are 1-based, but currentArc starts at 0 when plan is created
      // Treat 0 as 1 (we're about to execute arc 1)
      const executingArc = plan.currentArc === 0 ? 1 : plan.currentArc;
      const arcNode = getArcNode(plan, executingArc);
      const arcLabel = arcNode?.label ?? `Arc ${executingArc}`;
      const directive = buildPlanDirective(activeNarrative, plan, executingArc);
      const sceneCount = getArcSceneCount(plan, executingArc, 4);

      logInfo(`Coordination plan: executing arc ${executingArc}/${plan.arcCount}`, {
        source: 'auto-play',
        operation: 'plan-execution',
        details: { arcIndex: executingArc, sceneCount, arcLabel },
      });

      dispatch({ type: 'SET_AUTO_STATUS', message: `Arc ${executingArc}/${plan.arcCount}: reasoning…` });

      try {
        // Resolve world focus
        const worldFocusMode = activeNarrative.storySettings?.worldFocus ?? 'none';
        let worldBuildFocus = undefined;
        if (worldFocusMode === 'latest') {
          const lastWbKey = [...resolvedEntryKeys].reverse().find((k) => activeNarrative.worldBuilds[k]);
          if (lastWbKey) worldBuildFocus = activeNarrative.worldBuilds[lastWbKey];
        } else if (worldFocusMode === 'custom' && activeNarrative.storySettings?.worldFocusId) {
          worldBuildFocus = activeNarrative.worldBuilds[activeNarrative.storySettings.worldFocusId];
        }

        // Build coordination plan context for structured prompt injection
        const coordinationPlanContext: CoordinationPlanContext = {
          arcIndex: executingArc,
          arcCount: plan.arcCount,
          arcLabel,
          sceneCount,
          forceMode: arcNode?.forceMode,
          directive,
        };

        dispatch({ type: 'SET_AUTO_STATUS', message: `Arc ${executingArc}/${plan.arcCount}: writing ${sceneCount} scenes…` });
        dispatch({ type: 'RESET_AUTO_STREAM' });

        // The coordination plan's per-arc reasoning (directive + forceMode)
        // flows directly into scene generation via coordinationPlanContext —
        // no separate CRG step. Maps are a user-driven surface and
        // are not produced by the auto pipeline.
        const { scenes, arc } = await generateScenes(
          activeNarrative, resolvedEntryKeys, headIndex, sceneCount, '', // Empty direction — context flows via coordinationPlanContext
          {
            worldBuildFocus,
            coordinationPlanContext,
            onReasoning: (token) => dispatch({ type: 'APPEND_AUTO_STREAM', chunk: token }),
          },
        );

        if (cancelledRef.current) return;

        dispatch({ type: 'BULK_ADD_SCENES', scenes, arc, branchId: activeBranchId });
        dispatch({
          type: 'TICK_AUTO_RUN',
          scenesGenerated: scenes.length,
          worldExpanded: false,
          hasError: false,
        });

        // Persist the plan's per-arc reasoning as an arc-anchored investigation
        // so the operator can browse / copy it from the sidebar. Anchored to
        // the PRECEDING arc — the position the reasoning was "looking from".
        // Mirrors the manual investigation flow. For the very first plan arc
        // there is no preceding arc, so the artifact is skipped (the reasoning
        // still guided scene generation in-flight).
        const precedingArcId = (() => {
          for (let i = resolvedEntryKeys.length - 1; i >= 0; i--) {
            const scene = activeNarrative.scenes[resolvedEntryKeys[i]];
            if (scene?.arcId && scene.arcId !== arc.id) return scene.arcId;
          }
          return null;
        })();

        if (precedingArcId) {
          const investigation: ReasoningMap = {
            id: `investigation-${Date.now()}-${precedingArcId}`,
            arcId: precedingArcId,
            graph: buildCoordPlanMapGraph(plan, executingArc, arcLabel, sceneCount),
            direction: directive,
            source: 'coordination-plan',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          dispatch({ type: 'CREATE_MAP', investigation });
        }

        // Advance to next arc
        dispatch({ type: 'ADVANCE_COORDINATION_PLAN', branchId: activeBranchId });

        // Show next arc status or completion
        const nextArc = executingArc + 1;
        if (nextArc > plan.arcCount) {
          dispatch({ type: 'SET_AUTO_STATUS', message: 'Plan complete' });
        } else {
          const nextArcNode = getArcNode(plan, nextArc);
          const nextLabel = nextArcNode?.label ?? `Arc ${nextArc}`;
          dispatch({ type: 'SET_AUTO_STATUS', message: `Next: ${nextLabel}` });
        }
      } catch (err) {
        logError(`Coordination plan arc ${executingArc} failed`, err, {
          source: 'auto-play',
          operation: 'plan-execution',
          details: { arcIndex: executingArc },
        });

        dispatch({
          type: 'TICK_AUTO_RUN',
          scenesGenerated: 0,
          worldExpanded: false,
          hasError: true,
        });

        // Credit/auth failures won't recover on retry — let the tick loop halt.
        if (err instanceof FatalApiError) throw err;
      }

      return;
    }

    // ── Pressure-Based Auto Mode ────────────────────────────────────────────────
    // No coordination plan — use narrative pressure analysis for guidance

    // Check end conditions
    const endMet = checkEndConditions(activeNarrative, resolvedEntryKeys, autoConfig, autoRunState.startingSceneCount, autoRunState.startingArcCount, activeBranchId);
    if (endMet) {
      dispatch({ type: 'STOP_AUTO_RUN' });
      return;
    }

    // Evaluate narrative state and get directive
    dispatch({ type: 'SET_AUTO_STATUS', message: 'Evaluating narrative state...' });
    const { phase, pressure, directive } = evaluateNarrativeState(
      activeNarrative,
      resolvedEntryKeys,
      headIndex,
      autoConfig,
      autoRunState.startingSceneCount,
      autoRunState.startingArcCount,
    );

    let scenesGenerated = 0;
    let cycleError = '';

    try {
      // Resolve world focus from story settings
      const worldFocusMode = activeNarrative.storySettings?.worldFocus ?? 'none';
      let worldBuildFocus = undefined;
      if (worldFocusMode === 'latest') {
        const lastWbKey = [...resolvedEntryKeys].reverse().find((k) => activeNarrative.worldBuilds[k]);
        if (lastWbKey) worldBuildFocus = activeNarrative.worldBuilds[lastWbKey];
      } else if (worldFocusMode === 'custom' && activeNarrative.storySettings?.worldFocusId) {
        worldBuildFocus = activeNarrative.worldBuilds[activeNarrative.storySettings.worldFocusId];
      }

      const sceneCount = pickArcLength(autoConfig, pressure);

      dispatch({ type: 'SET_AUTO_STATUS', message: `Writing ${sceneCount} scenes…` });
      dispatch({ type: 'RESET_AUTO_STREAM' });
      const { scenes, arc } = await generateScenes(
        activeNarrative, resolvedEntryKeys, headIndex, sceneCount, directive, {
          worldBuildFocus,
          onReasoning: (token) => dispatch({ type: 'APPEND_AUTO_STREAM', chunk: token }),
        },
      );

      if (cancelledRef.current) return;

      dispatch({ type: 'BULK_ADD_SCENES', scenes, arc, branchId: activeBranchId });

      scenesGenerated = scenes.length;

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logError(`Generation cycle ${autoRunState.currentCycle + 1} failed`, err, {
        source: 'auto-play',
        operation: 'scene-generation',
        details: { storyPhase: phase },
      });
      cycleError = errorMsg;
      // Credit/auth failures won't recover on retry — let the tick loop halt.
      if (err instanceof FatalApiError) throw err;
    }

    if (cancelledRef.current) return;

    dispatch({
      type: 'TICK_AUTO_RUN',
      scenesGenerated,
      worldExpanded: false,
      hasError: !!cycleError,
    });

    // Update status with result
    const failures = (autoRunState.consecutiveFailures ?? 0) + (cycleError ? 1 : 0);
    if (cycleError && failures >= 3) {
      dispatch({ type: 'SET_AUTO_STATUS', message: `Stopped after 3 failures — ${cycleError}` });
      dispatch({ type: 'STOP_AUTO_RUN' });
      return;
    } else if (cycleError) {
      dispatch({ type: 'SET_AUTO_STATUS', message: `Retrying (${failures}/3)...` });
    } else if (scenesGenerated > 0) {
      dispatch({ type: 'SET_AUTO_STATUS', message: 'Preparing next arc...' });
    }
  }, [dispatch]);

  // The loop: run a cycle, then immediately continue
  const consecutiveTickErrors = useRef(0);
  const tick = useCallback(async () => {
    if (cancelledRef.current || !runningRef.current) return;

    try {
      await runCycle();
      consecutiveTickErrors.current = 0;
    } catch (err) {
      // Fatal API errors (missing key, credits exhausted, forbidden) can't
      // recover this session — halt immediately instead of burning through
      // 3 strikes and another 100ms tick.
      if (err instanceof FatalApiError) {
        logError('Auto mode stopped — fatal API error', err, {
          source: 'auto-play',
          operation: 'auto-stop',
          details: { status: err.status, cycle: (stateRef.current.viewState.autoRunState?.currentCycle ?? 0) + 1 },
        });
        dispatch({ type: 'SET_AUTO_STATUS', message: `Stopped — ${err.message}` });
        dispatch({ type: 'STOP_AUTO_RUN' });
        return;
      }

      logError('Unhandled error in auto-play runCycle', err, {
        source: 'auto-play',
        operation: 'run-cycle',
        details: {
          consecutiveErrors: consecutiveTickErrors.current + 1,
          cycle: (stateRef.current.viewState.autoRunState?.currentCycle ?? 0) + 1,
        },
      });
      consecutiveTickErrors.current += 1;
      if (consecutiveTickErrors.current >= 3) {
        logError('Auto mode stopped after 3 consecutive unhandled errors', 'Error limit reached', {
          source: 'auto-play',
          operation: 'auto-stop',
          details: {
            consecutiveErrors: consecutiveTickErrors.current,
            cycle: (stateRef.current.viewState.autoRunState?.currentCycle ?? 0) + 1,
          },
        });
        dispatch({ type: 'STOP_AUTO_RUN' });
        return;
      }
    }

    if (cancelledRef.current || !runningRef.current) return;

    // Continue immediately — no pause between cycles
    timeoutRef.current = setTimeout(() => tick(), 100);
  }, [runCycle, dispatch]);

  const start = useCallback(() => {
    cancelledRef.current = false;
    runningRef.current = true;
    dispatch({ type: 'START_AUTO_RUN' });
    timeoutRef.current = setTimeout(() => tick(), 500);
  }, [dispatch, tick]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    runningRef.current = false;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    dispatch({ type: 'STOP_AUTO_RUN' });
  }, [dispatch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      runningRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Stop if autoRunState goes away or is stopped externally
  useEffect(() => {
    if (!state.viewState.autoRunState?.isRunning && runningRef.current) {
      runningRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [state.viewState.autoRunState?.isRunning]);

  return {
    start,
    stop,
    isRunning: state.viewState.autoRunState?.isRunning ?? false,
    currentCycle: state.viewState.autoRunState?.currentCycle ?? 0,
  };
}
