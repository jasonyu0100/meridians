'use client';
// useBulkGenerate — manages parallel plan/prose/game generation across a scene range with progress.

import { useRef, useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/state/store';
import { generateScenePlan, generateSceneProse, reverseEngineerScenePlan } from '@/lib/ai/scenes';
import { generateSceneGameAnalysis } from '@/lib/ai/game-analysis';
import { generateSceneQuestions } from '@/lib/ai/learning';
import { generateScenePerspective, availablePerspectiveKeys, perspectiveLabel } from '@/lib/ai/perspectives';
import { embedQuestions } from '@/lib/search/embeddings';
import { FatalApiError } from '@/lib/ai/errors';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { PLAN_CONCURRENCY, PROSE_CONCURRENCY, GAME_CONCURRENCY } from '@/lib/constants';
import { resolveProseForBranch, resolvePlanForBranch } from '@/lib/forces/narrative-utils';
import { filterKeysBySceneRange, type SceneRange } from '@/components/timeline/SceneRangeSelector';
import { logError } from '@/lib/core/system-logger';

type BulkMode = 'plan' | 'prose' | 'game' | 'questions' | 'perspectives';

type BulkProgress = {
  completed: number;
  total: number;
  currentSceneId: string | null;
};

type BulkRunState = {
  mode: BulkMode;
  isRunning: boolean;
  isPaused: boolean;
  progress: BulkProgress;
  statusMessage: string;
  startedAt: number;
};

export function useBulkGenerate() {
  const { state, dispatch } = useStore();
  const cancelledRef = useRef(false);
  const pausedRef = useRef(false);
  const runStateRef = useRef<BulkRunState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [runState, setRunState] = useState<BulkRunState | null>(null);

  const updateRunState = useCallback((updates: Partial<BulkRunState>) => {
    setRunState(prev => {
      if (!prev) return null;
      const next = { ...prev, ...updates };
      runStateRef.current = next;
      return next;
    });
  }, []);

  // Run bulk generation with sliding window concurrency
  const runBulk = useCallback(async (mode: BulkMode, sceneIds: string[], targetAll = false) => {
    const { activeNarrative, resolvedEntryKeys } = stateRef.current;
    if (!activeNarrative || sceneIds.length === 0) return;

    const concurrency =
      mode === 'plan' ? PLAN_CONCURRENCY :
      mode === 'prose' ? PROSE_CONCURRENCY :
      GAME_CONCURRENCY;
    // (questions share the game/analysis concurrency tier)
    const total = sceneIds.length;
    let completed = 0;
    let nextIndex = 0;

    // Plan extraction source applies to both bulk queues. 'structure' =
    // current forward flow (structure → plan → prose). 'prose' = reverse
    // flow (structure → prose → plan reverse-engineered from prose).
    const planSource = activeNarrative.storySettings?.planExtractionSource ?? 'structure';

    const processScene = async (sceneId: string): Promise<void> => {
      // Wait while paused
      while (pausedRef.current && !cancelledRef.current) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (cancelledRef.current) return;

      const scene = activeNarrative.scenes[sceneId];
      if (!scene) return;

      // Bulk mode ALWAYS generates a new version — existing plan/prose is
      // not a skip condition. The versioning system records each run as a
      // new version so prior results remain recoverable.
      const branches = activeNarrative.branches;
      const activeBranchId = stateRef.current.viewState.activeBranchId!;
      const resolvedPlan = resolvePlanForBranch(scene, activeBranchId, branches);
      const { prose: resolvedProse } = resolveProseForBranch(scene, activeBranchId, branches);

      // Dependency gates — structural, ALWAYS enforced regardless of focus.
      //   'plan' + 'prose' source: reverse-engineering requires prose to exist.
      //   'prose' + 'structure' source: forward prose generation requires a plan.
      if (mode === 'plan' && planSource === 'prose' && !resolvedProse) return;
      if (mode === 'prose' && planSource === 'structure' && !resolvedPlan) return;
      // Existence gates — the FOCUS. By default the run fills gaps (skips
      // scenes that already carry the artifact); `targetAll` regenerates them.
      // (Plan/prose write a new version; game/questions overwrite in place.)
      if (!targetAll) {
        if (mode === 'plan' && resolvedPlan?.beats?.length) return;
        if (mode === 'prose' && resolvedProse) return;
        if (mode === 'game' && scene.gameAnalysis) return;
        if (mode === 'questions' && scene.questions?.length) return;
        if (mode === 'perspectives' && scene.perspectives && Object.keys(scene.perspectives).length) return;
      }

      const statusVerb =
        mode === 'plan' ? (planSource === 'prose' ? 'Reverse-engineering plan for' : 'Planning') :
        mode === 'prose' ? 'Writing' :
        mode === 'questions' ? 'Extracting questions from' :
        mode === 'perspectives' ? 'Writing perspectives for' :
        'Analysing games in';
      updateRunState({
        statusMessage: `${statusVerb} "${scene.summary.slice(0, 40)}..."`,
        progress: { completed, total, currentSceneId: sceneId },
      });

      try {
        if (mode === 'game') {
          window.dispatchEvent(new CustomEvent('bulk:game-start', { detail: { sceneId } }));
          // Stream contract: emit the ACCUMULATED string at every step so a
          // listener can render it with a plain replace (setState(token)) —
          // no per-listener accumulation, no double-fire mistakes across
          // parallel scenes. Same contract for plan + prose below.
          let gameTokenAcc = '';
          const analysis = await generateSceneGameAnalysis(
            activeNarrative,
            scene,
            (token) => {
              gameTokenAcc += token;
              window.dispatchEvent(new CustomEvent('bulk:game-token', { detail: { sceneId, token: gameTokenAcc } }));
            },
            (_token, accumulated) => window.dispatchEvent(new CustomEvent('bulk:game-reasoning', { detail: { sceneId, token: accumulated } })),
          );
          window.dispatchEvent(new CustomEvent('bulk:game-complete', { detail: { sceneId } }));
          dispatch({ type: 'SET_GAME_ANALYSIS', sceneId, analysis });
        } else if (mode === 'plan') {
          window.dispatchEvent(new CustomEvent('bulk:plan-start', { detail: { sceneId } }));
          let planReasoningAcc = '';
          const plan = planSource === 'prose'
            ? (await reverseEngineerScenePlan(
                activeNarrative,
                resolvedProse!,
                scene.summary ?? '',
                (_token, accumulated) => window.dispatchEvent(new CustomEvent('bulk:plan-reasoning', { detail: { sceneId, token: accumulated } })),
              )).plan
            : await generateScenePlan(
                activeNarrative, scene, resolvedEntryKeys,
                (token) => {
                  planReasoningAcc += token;
                  window.dispatchEvent(new CustomEvent('bulk:plan-reasoning', { detail: { sceneId, token: planReasoningAcc } }));
                },
              );
          window.dispatchEvent(new CustomEvent('bulk:plan-complete', { detail: { sceneId } }));
          dispatch({ type: 'REVISE_SCENE', sceneId, updates: { plan }, versionType: 'generate' });
        } else if (mode === 'questions') {
          window.dispatchEvent(new CustomEvent('bulk:questions-start', { detail: { sceneId } }));
          const { questions, newTopics } = await generateSceneQuestions(
            activeNarrative, scene,
            {
              prose: resolvedProse ?? undefined,
              onReasoning: (_token, accumulated) => window.dispatchEvent(new CustomEvent('bulk:questions-reasoning', { detail: { sceneId, token: accumulated } })),
            },
          );
          window.dispatchEvent(new CustomEvent('bulk:questions-complete', { detail: { sceneId } }));
          // Embed stems up front so Expert search is usable without a separate
          // pass; refs survive COMMIT_SCENE_QUESTIONS's id reassignment.
          let embeddedQuestions = questions;
          try {
            embeddedQuestions = await embedQuestions(questions, activeNarrative.id);
          } catch {
            /* leave unembedded — the embeddings dashboard can backfill */
          }
          dispatch({ type: 'COMMIT_SCENE_QUESTIONS', sceneId, questions: embeddedQuestions, newTopics });
        } else if (mode === 'perspectives') {
          window.dispatchEvent(new CustomEvent('bulk:perspectives-start', { detail: { sceneId } }));
          const sceneIdx = resolvedEntryKeys.indexOf(sceneId);
          // Every lens for this scene, in parallel.
          await Promise.all(
            availablePerspectiveKeys(activeNarrative, scene).map(async (key) => {
              const text = await generateScenePerspective(activeNarrative, scene, key, resolvedEntryKeys, sceneIdx);
              dispatch({
                type: 'SET_SCENE_PERSPECTIVE',
                sceneId,
                view: { key, label: perspectiveLabel(activeNarrative, key), text, generatedAt: Date.now() },
              });
            }),
          );
          window.dispatchEvent(new CustomEvent('bulk:perspectives-complete', { detail: { sceneId } }));
        } else {
          window.dispatchEvent(new CustomEvent('bulk:prose-start', { detail: { sceneId } }));
          // Prose mode + 'prose' source: generate prose without a plan so it flows free,
          // then reverse-engineer the plan from the resulting prose.
          const planForProse = planSource === 'prose' ? undefined : resolvedPlan;
          let proseAcc = '';
          const { prose, beatProseMap } = await generateSceneProse(
            activeNarrative, scene, resolvedEntryKeys,
            (token) => {
              proseAcc += token;
              window.dispatchEvent(new CustomEvent('bulk:prose-token', { detail: { sceneId, token: proseAcc } }));
            },
            undefined, planForProse,
          );
          window.dispatchEvent(new CustomEvent('bulk:prose-complete', { detail: { sceneId } }));
          dispatch({ type: 'REVISE_SCENE', sceneId, updates: { prose, beatProseMap }, versionType: 'generate' });

          if (planSource === 'prose') {
            try {
              const { plan, beatProseMap: reBeatMap } = await reverseEngineerScenePlan(activeNarrative, prose, scene.summary ?? '');
              dispatch({
                type: 'REVISE_SCENE',
                sceneId,
                updates: { plan, beatProseMap: reBeatMap ?? beatProseMap },
                versionType: 'generate',
              });
            } catch (err) {
              // Best-effort: prose succeeded, plan extraction didn't. Log but don't fail the scene.
              logError(`Failed to reverse-engineer plan for scene`, err, {
                source: 'plan-generation',
                operation: 'bulk-generate-reverse',
                details: { sceneId, sceneNumber: completed + 1, totalScenes: total }
              });
            }
          }
        }
      } catch (err) {
        logError(`Failed to generate ${mode} for scene`, err, {
          source:
            mode === 'plan' ? 'plan-generation' :
            mode === 'prose' ? 'prose-generation' :
            'analysis',
          operation: 'bulk-generate',
          details: { sceneId, mode, sceneNumber: completed + 1, totalScenes: total }
        });
        // Credit/auth failures won't recover on retry — cancel the whole run
        // so sibling workers stop spawning calls. The `cancelled` flag is
        // checked by `runWorker` between scenes.
        if (err instanceof FatalApiError) {
          cancelledRef.current = true;
          updateRunState({ statusMessage: `Stopped — ${err.message}` });
        }
      }

      // Update progress after each scene completes
      completed++;
      updateRunState({
        progress: { completed, total, currentSceneId: null },
        statusMessage: `Completed ${completed}/${total}`,
      });
    };

    // Sliding window: always keep `concurrency` tasks running
    const runWorker = async (): Promise<void> => {
      while (nextIndex < sceneIds.length && !cancelledRef.current) {
        const idx = nextIndex++;
        await processScene(sceneIds[idx]);
      }
    };

    // Start `concurrency` workers in parallel
    const workers = Array.from({ length: Math.min(concurrency, sceneIds.length) }, () => runWorker());
    await Promise.all(workers);

    // Complete — show message briefly then auto-dismiss
    const wasCancelled = cancelledRef.current;
    updateRunState({
      isRunning: false,
      isPaused: false,
      statusMessage: wasCancelled ? 'Stopped' : 'Complete',
    });

    // Auto-dismiss after 1.5s
    setTimeout(() => {
      setRunState(null);
      runStateRef.current = null;
    }, 1500);
  }, [dispatch, updateRunState]);

  const start = useCallback((mode: BulkMode, range: SceneRange = null, targetAll = false) => {
    const { activeNarrative, resolvedEntryKeys } = stateRef.current;
    if (!activeNarrative) return;

    const planSource = activeNarrative.storySettings?.planExtractionSource ?? 'structure';
    const keysInRange = filterKeysBySceneRange(resolvedEntryKeys, activeNarrative, range);

    // Queue membership: dependency gates ALWAYS apply (a reverse plan needs
    // prose, forward prose needs a plan). The "already exists" gate is the
    // FOCUS: by default the run fills gaps (skips scenes that already have the
    // artifact); `targetAll` overrides it to regenerate every eligible scene.
    const scenesToProcess: string[] = [];
    for (const key of keysInRange) {
      const entry = resolveEntry(activeNarrative, key);
      if (!entry || !isScene(entry)) continue;
      const scene = entry as Scene;

      const branches = activeNarrative.branches;
      const activeBranchId = stateRef.current.viewState.activeBranchId!;
      const resolvedPlan = resolvePlanForBranch(scene, activeBranchId, branches);
      const { prose: resolvedProse } = resolveProseForBranch(scene, activeBranchId, branches);

      if (mode === 'plan') {
        // Dependency: prose source needs prose to reverse-engineer from.
        const depOk = planSource === 'structure' || !!resolvedProse;
        const exists = !!resolvedPlan?.beats?.length;
        if (depOk && (targetAll || !exists)) scenesToProcess.push(scene.id);
      } else if (mode === 'prose') {
        // Dependency: structure source needs a plan to write from.
        const depOk = planSource === 'prose' || !!resolvedPlan;
        const exists = !!resolvedProse;
        if (depOk && (targetAll || !exists)) scenesToProcess.push(scene.id);
      } else if (mode === 'game') {
        // Game analysis reads prose → plan → structure, so every scene is
        // eligible. Gap-fill skips scenes that already carry one.
        if (targetAll || !scene.gameAnalysis) scenesToProcess.push(scene.id);
      } else if (mode === 'questions') {
        // Questions read prose → structure, so every scene is eligible.
        // Gap-fill skips scenes that already carry a bank.
        if (targetAll || !scene.questions?.length) scenesToProcess.push(scene.id);
      }
    }

    if (scenesToProcess.length === 0) {
      return;
    }

    cancelledRef.current = false;
    pausedRef.current = false;

    const initialState: BulkRunState = {
      mode,
      isRunning: true,
      isPaused: false,
      progress: { completed: 0, total: scenesToProcess.length, currentSceneId: null },
      statusMessage: `Starting ${mode} generation...`,
      startedAt: Date.now(),
    };
    setRunState(initialState);
    runStateRef.current = initialState;

    runBulk(mode, scenesToProcess, targetAll);
  }, [runBulk]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    updateRunState({ isPaused: true, statusMessage: 'Paused' });
  }, [updateRunState]);

  const resume = useCallback(() => {
    pausedRef.current = false;
    updateRunState({ isPaused: false, statusMessage: 'Resuming...' });
  }, [updateRunState]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    pausedRef.current = false;
    setRunState(null);
    runStateRef.current = null;
  }, []);

  // Count how many scenes bulk mode would process — mirrors the queue
  // filters in start(). Bulk always writes a new version, so the count
  // reflects scenes that satisfy the dependency gates, not scenes missing
  // content.
  const counts = useCallback(() => {
    const { activeNarrative, resolvedEntryKeys, viewState } = stateRef.current;
    const { activeBranchId } = viewState;
    if (!activeNarrative || !activeBranchId) return { needsPlan: 0, needsProse: 0, needsGame: 0 };

    const planSource = activeNarrative.storySettings?.planExtractionSource ?? 'structure';
    const branches = activeNarrative.branches;
    let needsPlan = 0;
    let needsProse = 0;
    let needsGame = 0;

    for (const key of resolvedEntryKeys) {
      const entry = resolveEntry(activeNarrative, key);
      if (!entry || !isScene(entry)) continue;
      const scene = entry as Scene;

      const resolvedPlan = resolvePlanForBranch(scene, activeBranchId, branches);
      const { prose: resolvedProse } = resolveProseForBranch(scene, activeBranchId, branches);

      if (planSource === 'structure' || resolvedProse) needsPlan++;
      if (planSource === 'prose' || resolvedPlan) needsProse++;
      if (!scene.gameAnalysis) needsGame++;
    }

    return { needsPlan, needsProse, needsGame };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      pausedRef.current = false;
    };
  }, []);

  return {
    runState,
    start,
    pause,
    resume,
    stop,
    counts,
  };
}
