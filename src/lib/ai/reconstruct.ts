// Branch reconstruction — applies per-scene verdicts (edit/merge/insert/cut) into a new versioned branch.

import type { NarrativeState, StructureReview, SceneEval, SceneVerdict, Scene, Arc, Branch } from '@/types/narrative';
import { resolveEntry, isScene, isWorldBuild } from '@/types/narrative';
import { nextId } from '@/lib/forces/narrative-utils';
import { normalizeTimeDelta } from '@/lib/forces/time-deltas';
import { callGenerate, resolveReasoningBudget, resolveWebsearch } from './api';
import { parseJson } from './json';
import { sanitizeScenes } from './scenes';
import { GENERATE_MODEL, PROSE_CONCURRENCY, MAX_TOKENS_SMALL } from '@/lib/constants';
import { narrativeContext } from './context';
import { logError, logWarning, logInfo } from '@/lib/core/system-logger';
import {
  buildEditScenePrompt,
  buildMergeScenesPrompt,
  buildInsertScenePrompt,
  buildReconstructEditSystem,
  buildReconstructMergeSystem,
  buildReconstructInsertSystem,
} from '@/lib/prompts/reconstruct';
import { workIdentityFor } from '@/lib/prompts/paradigm';

// ── Types ────────────────────────────────────────────────────────────────────

export type ReconstructionStep = {
  sceneId: string;
  verdict: SceneVerdict;
  status: 'pending' | 'running' | 'done' | 'skipped';
};

export type ReconstructionProgress = {
  phase: 'preparing' | 'restructuring' | 'processing' | 'done';
  steps: ReconstructionStep[];
  completed: number;
  total: number;
  branchId: string | null;
};

export type ReconstructionCallbacks = {
  onProgress: (progress: ReconstructionProgress) => void;
  onSceneReady: (scene: Scene, action: 'keep' | 'edited') => void;
  onBranchCreated: (branch: Branch, scenes: Scene[], arcs: Record<string, Arc>) => void;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize systemDeltas with safe defaults for addedNodes/addedEdges */
function normalizeSystemDeltas(
  parsed: Scene['systemDeltas'] | undefined,
  fallback: Scene['systemDeltas'] | undefined,
): NonNullable<Scene['systemDeltas']> {
  const source = parsed ?? fallback;
  return {
    addedNodes: source?.addedNodes ?? [],
    addedEdges: source?.addedEdges ?? [],
  };
}

// ── Parallel batch helper ────────────────────────────────────────────────────

async function parallelBatch<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  cancelledRef: { current: boolean },
): Promise<void> {
  let idx = 0;
  const run = async () => {
    while (idx < items.length) {
      if (cancelledRef.current) return;
      const i = idx++;
      await fn(items[i]);
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(workers);
}

// ── Reconstruction engine ────────────────────────────────────────────────────

/**
 * Reconstruct a branch based on evaluation verdicts.
 *
 * - Preserves world commits in their original timeline positions
 * - Copies "ok" scenes instantly
 * - Edits "edit" scenes in parallel — keeps structure, rewrites prose
 * - Rewrites "rewrite" scenes in parallel — regenerates structure from scratch
 * - Drops "cut" scenes
 * - Scenes stay after the world commit that introduced their entities
 */
export async function reconstructBranch(
  narrative: NarrativeState,
  resolvedKeys: string[],
  evaluation: StructureReview,
  callbacks: ReconstructionCallbacks,
  cancelledRef: { current: boolean },
): Promise<{ branchId: string; branch: Branch; scenes: Scene[]; arcs: Record<string, Arc> }> {
  logInfo('Starting branch reconstruction', {
    source: 'analysis',
    operation: 'reconstruct-branch',
    details: {
      narrativeId: narrative.id,
      evaluationId: evaluation.id,
      sourceBranchId: evaluation.branchId,
      scenesToProcess: evaluation.sceneEvals.length,
    },
  });

  // Build verdict lookup
  const verdictMap = new Map<string, SceneEval>();
  const insertEvals: SceneEval[] = [];
  for (const ev of evaluation.sceneEvals) {
    if (ev.verdict === 'insert') {
      insertEvals.push(ev);
    } else {
      verdictMap.set(ev.sceneId, ev);
    }
  }

  // Build insert-after lookup: sceneId → list of inserts that follow it
  const insertAfterMap = new Map<string, SceneEval[]>();
  for (const ins of insertEvals) {
    const afterId = ins.insertAfter;
    if (afterId) {
      const list = insertAfterMap.get(afterId) ?? [];
      list.push(ins);
      insertAfterMap.set(afterId, list);
    }
  }

  // Build move-after lookup: moveAfter target ID → list of scenes to place there
  // Moved scenes are removed from their original position and injected after moveAfter.
  const moveAfterMap = new Map<string, SceneEval[]>();
  for (const ev of evaluation.sceneEvals) {
    if (ev.verdict === 'move' && ev.moveAfter) {
      const list = moveAfterMap.get(ev.moveAfter) ?? [];
      list.push(ev);
      moveAfterMap.set(ev.moveAfter, list);
    }
  }

  // Walk the full resolved timeline preserving world commits in order.
  // The reconstructed branch is a root (no parent), so ALL entries —
  // including world builds inherited from parents — must be in entryIds.
  type TimelineItem =
    | { type: 'world_build'; id: string }
    | { type: 'scene'; index: number; scene: Scene; verdict: SceneVerdict; reason: string; newId: string };

  const items: TimelineItem[] = [];
  const allExistingSceneIds = new Set(Object.keys(narrative.scenes));
  const usedNewIds = new Set<string>();
  const sceneEntries: Extract<TimelineItem, { type: 'scene' }>[] = [];
  const cutSceneIds: string[] = [];

  // Collect merge sources: sceneId → mergeInto target ID
  const mergeSourceMap = new Map<string, string>(); // source scene ID → target scene ID
  const mergeTargetSources = new Map<string, Scene[]>(); // target scene ID → source scenes to absorb
  for (const ev of evaluation.sceneEvals) {
    if (ev.verdict === 'merge' && ev.mergeInto) {
      mergeSourceMap.set(ev.sceneId, ev.mergeInto);
      const sources = mergeTargetSources.get(ev.mergeInto) ?? [];
      const sourceScene = narrative.scenes[ev.sceneId];
      if (sourceScene) sources.push(sourceScene);
      mergeTargetSources.set(ev.mergeInto, sources);
    }
  }

  const sourceBranch = narrative.branches[evaluation.branchId];

  // Helper to inject moved scenes after a given original scene ID, recursively.
  // Handles swap/chain scenarios where a moved scene is itself a moveAfter target.
  const injectMovesAfter = (afterId: string) => {
    const movedHere = moveAfterMap.get(afterId);
    if (!movedHere) return;
    for (const moveEv of movedHere) {
      const movedScene = narrative.scenes[moveEv.sceneId];
      if (!movedScene) continue;
      // Moves don't change content — reuse original ID
      const movedId = movedScene.id;
      const movedItem: Extract<TimelineItem, { type: 'scene' }> = {
        type: 'scene',
        index: sceneEntries.length,
        scene: movedScene,
        verdict: 'move',
        reason: moveEv.reason,
        newId: movedId,
      };
      items.push(movedItem);
      sceneEntries.push(movedItem);
      injectInsertsAfter(moveEv.sceneId);
      // Recursively inject any scenes that want to move after this moved scene
      injectMovesAfter(moveEv.sceneId);
    }
  };

  // Helper to inject inserts after a given ID, following chains recursively.
  // Uses lastArcScene to inherit arcId/locationId/povId for placeholders.
  let lastSceneEntry: Scene | null = null;
  const injectInsertsAfter = (afterId: string) => {
    const inserts = insertAfterMap.get(afterId);
    if (!inserts) return;
    const ref = lastSceneEntry;
    for (const ins of inserts) {
      const insertId = nextId('S', [...allExistingSceneIds, ...usedNewIds]);
      usedNewIds.add(insertId);
      const placeholder: Scene = {
        kind: 'scene',
        id: insertId,
        createdAt: new Date().toISOString(),
        arcId: ref?.arcId ?? '',
        locationId: ref?.locationId ?? '',
        povId: ref?.povId ?? '',
        participantIds: [],
        events: [],
        threadDeltas: [],
        worldDeltas: [],
        relationshipDeltas: [],
        summary: ins.reason,
      };
      const insertItem: Extract<TimelineItem, { type: 'scene' }> = {
        type: 'scene',
        index: sceneEntries.length,
        scene: placeholder,
        verdict: 'insert',
        reason: ins.reason,
        newId: insertId,
      };
      items.push(insertItem);
      sceneEntries.push(insertItem);
      // Follow the chain: INSERT-2 → insertAfter: "INSERT-1", etc.
      injectInsertsAfter(ins.sceneId);
    }
  };

  let startInserted = false;

  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (!entry) continue;

    if (isWorldBuild(entry)) {
      items.push({ type: 'world_build', id: entry.id });
    } else if (isScene(entry)) {
      // Inject START inserts just before the first scene (after world builds)
      if (!startInserted) {
        startInserted = true;
        lastSceneEntry = entry; // use first scene as reference for arcId/povId/locationId
        injectInsertsAfter('START');
      }
      lastSceneEntry = entry;
      const ev = verdictMap.get(entry.id);
      const verdict = ev?.verdict ?? 'ok';
      if (verdict === 'cut' || verdict === 'merge') {
        // Cut and merge-source scenes are removed from the timeline,
        // but still check for inserts placed after them
        cutSceneIds.push(entry.id);
        injectInsertsAfter(entry.id);
        continue;
      }

      if (verdict === 'move') {
        // Moved scenes are held out and injected at their moveAfter target below.
        // Do NOT inject inserts here — they will be injected at the new position
        // after the scene is placed, preventing double injection.
        continue;
      }

      // Reuse original ID for unchanged scenes; only mint new IDs for scenes that will be modified
      const needsNewId = verdict === 'edit';
      const newId = needsNewId
        ? nextId('S', [...allExistingSceneIds, ...usedNewIds])
        : entry.id;
      if (needsNewId) usedNewIds.add(newId);

      const item: Extract<TimelineItem, { type: 'scene' }> = {
        type: 'scene',
        index: sceneEntries.length,
        scene: entry,
        verdict,
        reason: ev?.reason ?? '',
        newId,
      };
      items.push(item);
      sceneEntries.push(item);

      // Inject any moved scenes that should land after this scene (recursive for chained moves)
      injectMovesAfter(entry.id);

      injectInsertsAfter(entry.id);
    }
  }

  // Edge case: if all scenes were cut, START inserts never fired.
  // Inject them now so they aren't silently dropped.
  if (!startInserted) {
    injectInsertsAfter('START');
  }

  // Edge case: inserts with invalid/hallucinated insertAfter IDs that didn't match
  // any scene or "START". Collect orphaned inserts and append them at the end.
  for (const ins of insertEvals) {
    const wasPlaced = sceneEntries.some((s) => s.verdict === 'insert' && s.reason === ins.reason && s.scene.summary === ins.reason);
    if (!wasPlaced) {
      const ref = lastSceneEntry;
      const insertId = nextId('S', [...allExistingSceneIds, ...usedNewIds]);
      usedNewIds.add(insertId);
      const placeholder: Scene = {
        kind: 'scene',
        id: insertId,
        createdAt: new Date().toISOString(),
        arcId: ref?.arcId ?? '',
        locationId: ref?.locationId ?? '',
        povId: ref?.povId ?? '',
        participantIds: [],
        events: [],
        threadDeltas: [],
        worldDeltas: [],
        relationshipDeltas: [],
        summary: ins.reason,
      };
      items.push({ type: 'scene', index: sceneEntries.length, scene: placeholder, verdict: 'insert', reason: ins.reason, newId: insertId });
      sceneEntries.push({ type: 'scene', index: sceneEntries.length, scene: placeholder, verdict: 'insert', reason: ins.reason, newId: insertId } as Extract<TimelineItem, { type: 'scene' }>);
    }
  }

  // Build progress steps — include cuts as instantly done
  const steps: ReconstructionStep[] = [
    ...sceneEntries.map((s) => ({
      sceneId: s.scene.id,
      verdict: s.verdict,
      status: (s.verdict === 'ok' || s.verdict === 'move') ? 'done' as const : 'pending' as const,
    })),
    ...cutSceneIds.map((id) => ({
      sceneId: id,
      verdict: 'cut' as SceneVerdict,
      status: 'done' as const,
    })),
  ];
  let completed = 0;

  // Create new branch
  const newBranchId = nextId('BR', Object.keys(narrative.branches));
  const newBranch: Branch = {
    id: newBranchId,
    name: (() => {
      const base = sourceBranch?.name ?? 'main';
      // Strip existing version suffix to avoid stacking
      const stripped = base.replace(/\s+v\d+$/, '');
      // Find highest existing version for this base name
      const existing = Object.values(narrative.branches)
        .map((b) => b.name)
        .filter((n) => n === stripped || n.startsWith(`${stripped} v`));
      const maxVersion = existing.reduce((max, n) => {
        const m = n.match(/\sv(\d+)$/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, existing.length > 0 ? 1 : 0);
      return `${stripped} v${maxVersion + 1}`;
    })(),
    // Reconstruction builds a complete standalone timeline (all resolved scenes
    // get new IDs in entryIds), so the new branch must be a root — otherwise
    // resolveEntrySequence would prepend the parent chain entries, duplicating
    // every inherited scene.
    parentBranchId: null,
    forkEntryId: null,
    entryIds: [], // set below
    createdAt: Date.now(),
  };

  const progress: ReconstructionProgress = {
    phase: 'preparing',
    steps,
    completed: 0,
    total: 0, // updated below once work arrays are computed
    branchId: newBranchId,
  };
  callbacks.onProgress({ ...progress });

  // ── Phase 1: Build scene array with new IDs, preserve order ────────────
  progress.phase = 'restructuring';
  callbacks.onProgress({ ...progress });

  // Build arc → scene mappings, always reusing original arc IDs
  const arcSceneMap = new Map<string, string[]>(); // arc ID → scene IDs in new branch
  for (const s of sceneEntries) {
    const list = arcSceneMap.get(s.scene.arcId) ?? [];
    list.push(s.newId);
    arcSceneMap.set(s.scene.arcId, list);
  }

  // Scenes keep their original arcId — only their own ID changes when edited
  const newScenes: Scene[] = sceneEntries.map((s) => ({
    ...s.scene,
    id: s.newId,
  }));

  // Arcs reuse their original IDs with updated sceneIds
  const newArcs: Record<string, Arc> = {};
  for (const [arcId, sceneIds] of arcSceneMap) {
    const original = narrative.arcs[arcId];
    if (original && sceneIds.length > 0) {
      newArcs[arcId] = { ...original, sceneIds };
    }
  }

  // Branch entryIds: world builds + scenes interleaved in original order
  newBranch.entryIds = items.map((item) =>
    item.type === 'world_build' ? item.id : item.newId,
  );

  // Notify — ok and move scenes are already ready (no LLM work needed)
  for (const s of sceneEntries) {
    if (s.verdict === 'ok' || s.verdict === 'move') callbacks.onSceneReady(newScenes[s.index], 'keep');
  }
  callbacks.onBranchCreated(newBranch, newScenes, newArcs);

  // ── Phase 2a: Process merges first (they must complete before edits on merged scenes) ──
  progress.phase = 'processing';
  callbacks.onProgress({ ...progress });

  const mergeItems = sceneEntries.filter((s) => mergeTargetSources.has(s.scene.id));
  const editItems = sceneEntries.filter((s) => s.verdict === 'edit' && !mergeTargetSources.has(s.scene.id));
  const insertItems = sceneEntries.filter((s) => s.verdict === 'insert');
  progress.total = mergeItems.length + editItems.length + insertItems.length;

  // Process merges first
  await parallelBatch(mergeItems, PROSE_CONCURRENCY, async (item) => {
    if (cancelledRef.current) return;
    const step = steps.find((s) => s.sceneId === item.scene.id);
    if (step) step.status = 'running';
    callbacks.onProgress({ ...progress, completed, steps: [...steps] });

    try {
      const mergeSources = mergeTargetSources.get(item.scene.id) ?? [];
      const merged = await mergeScenes(
        narrative, resolvedKeys, item.scene, mergeSources, item.reason, evaluation,
        item.index, sceneEntries,
      );
      newScenes[item.index] = { ...merged, id: item.newId, arcId: newScenes[item.index].arcId };
      callbacks.onSceneReady(newScenes[item.index], 'edited');
    } catch (err) {
      logWarning(
        `Scene merge failed during reconstruction`,
        err,
        {
          source: 'manual-generation',
          operation: 'reconstruct-merge',
          details: {
            sceneId: item.scene.id,
            index: item.index,
            reason: item.reason?.substring(0, 100),
          },
        }
      );
    }

    if (step) step.status = 'done';
    completed++;
    callbacks.onProgress({ ...progress, completed, steps: [...steps] });
  }, cancelledRef);

  // ── Phase 2b: Process edits in parallel ──
  await parallelBatch(editItems, PROSE_CONCURRENCY, async (item) => {
    if (cancelledRef.current) return;
    const step = steps.find((s) => s.sceneId === item.scene.id);
    if (step) step.status = 'running';
    callbacks.onProgress({ ...progress, completed, steps: [...steps] });

    try {
      const edited = await editScene(
        narrative, resolvedKeys, item.scene, item.reason, evaluation,
        item.index, sceneEntries,
      );
      newScenes[item.index] = { ...edited, id: item.newId, arcId: newScenes[item.index].arcId };
      callbacks.onSceneReady(newScenes[item.index], 'edited');
    } catch (err) {
      logError(
        `Scene edit failed during reconstruction`,
        err,
        {
          source: 'manual-generation',
          operation: 'reconstruct-edit',
          details: {
            sceneId: item.scene.id,
            index: item.index,
            reason: item.reason?.substring(0, 100),
          },
        }
      );
    }

    if (step) step.status = 'done';
    completed++;
    callbacks.onProgress({ ...progress, completed, steps: [...steps] });
  }, cancelledRef);

  // ── Phase 2c: Process inserts in parallel ──
  await parallelBatch(insertItems, PROSE_CONCURRENCY, async (item) => {
    if (cancelledRef.current) return;
    const step = steps.find((s) => s.sceneId === item.scene.id);
    if (step) step.status = 'running';
    callbacks.onProgress({ ...progress, completed, steps: [...steps] });

    try {
      const inserted = await insertScene(
        narrative, resolvedKeys, item.reason, evaluation,
        item.index,
      );
      newScenes[item.index] = { ...inserted, id: item.newId, arcId: newScenes[item.index].arcId };
      callbacks.onSceneReady(newScenes[item.index], 'edited');
    } catch (err) {
      logError(
        `Scene insert failed during reconstruction`,
        err,
        {
          source: 'manual-generation',
          operation: 'reconstruct-insert',
          details: {
            sceneId: item.scene.id,
            index: item.index,
            reason: item.reason?.substring(0, 100),
          },
        }
      );
    }

    if (step) step.status = 'done';
    completed++;
    callbacks.onProgress({ ...progress, completed, steps: [...steps] });
  }, cancelledRef);

  progress.phase = 'done';
  callbacks.onProgress({ ...progress, completed });

  logInfo('Completed branch reconstruction', {
    source: 'analysis',
    operation: 'reconstruct-branch-complete',
    details: {
      narrativeId: narrative.id,
      evaluationId: evaluation.id,
      newBranchId,
      scenesReconstructed: newScenes.length,
      arcsCreated: Object.keys(newArcs).length,
      verdictOk: evaluation.sceneEvals.filter(e => e.verdict === 'ok').length,
      verdictEdit: evaluation.sceneEvals.filter(e => e.verdict === 'edit').length,
      verdictMerge: evaluation.sceneEvals.filter(e => e.verdict === 'merge').length,
      verdictCut: evaluation.sceneEvals.filter(e => e.verdict === 'cut').length,
      verdictInsert: evaluation.sceneEvals.filter(e => e.verdict === 'insert').length,
    },
  });

  return { branchId: newBranchId, branch: newBranch, scenes: newScenes, arcs: newArcs };
}

// ── Scene summary edit (lightweight) ─────────────────────────────────────────

/**
 * Edit a scene — may change anything: POV, location, participants, summary, events, deltas.
 * The scene keeps its position in the timeline but its content is revised to address the evaluation.
 */
async function editScene(
  narrative: NarrativeState,
  resolvedKeys: string[],
  scene: Scene,
  reason: string,
  evaluation: StructureReview,
  timelineIndex: number,
  timeline: { scene: Scene; verdict: SceneVerdict; reason: string }[],
): Promise<Scene> {
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const ctx = narrativeContext(narrative, resolvedKeys, contextIndex);

  const prevScene = timelineIndex > 0 ? timeline[timelineIndex - 1].scene : null;
  const nextScene = timelineIndex < timeline.length - 1 ? timeline[timelineIndex + 1].scene : null;

  const surroundingContext = [
    prevScene ? `PREVIOUS SCENE (${prevScene.id}): ${prevScene.summary}` : '',
    `CURRENT SCENE TO EDIT (${scene.id}): ${scene.summary}`,
    nextScene ? `NEXT SCENE (${nextScene.id}): ${nextScene.summary}` : '',
  ].filter(Boolean).join('\n');

  const prompt = buildEditScenePrompt({
    context: ctx,
    reason,
    evaluation,
    surroundingContext,
    currentSceneJson: JSON.stringify({
      locationId: scene.locationId,
      povId: scene.povId,
      participantIds: scene.participantIds,
      artifactUsages: scene.artifactUsages ?? [],
      events: scene.events,
      threadDeltas: scene.threadDeltas,
      worldDeltas: scene.worldDeltas,
      relationshipDeltas: scene.relationshipDeltas,
      systemDeltas: scene.systemDeltas,
      summary: scene.summary,
    }, null, 2),
  });

  const reasoningBudget = resolveReasoningBudget(narrative);
  const websearch = resolveWebsearch(narrative);
  const raw = await callGenerate(prompt, buildReconstructEditSystem(workIdentityFor(narrative)), MAX_TOKENS_SMALL, 'editScene', GENERATE_MODEL, reasoningBudget, true, undefined, websearch);
  const parsed = parseJson(raw, 'editScene') as Partial<Scene>;

  const edited: Scene = {
    ...scene,
    locationId: parsed.locationId ?? scene.locationId,
    povId: parsed.povId ?? scene.povId,
    participantIds: parsed.participantIds ?? scene.participantIds,
    artifactUsages: parsed.artifactUsages ?? scene.artifactUsages,
    events: parsed.events ?? scene.events,
    threadDeltas: parsed.threadDeltas ?? scene.threadDeltas,
    worldDeltas: parsed.worldDeltas ?? scene.worldDeltas,
    relationshipDeltas: parsed.relationshipDeltas ?? scene.relationshipDeltas,
    systemDeltas: normalizeSystemDeltas(parsed.systemDeltas, scene.systemDeltas),
    tieDeltas: parsed.tieDeltas ?? scene.tieDeltas,
    summary: parsed.summary ?? scene.summary,
    audioUrl: undefined,
  };
  sanitizeScenes([edited], narrative, 'editScene');
  return edited;
}

// ── Scene merge (combine multiple scenes into one) ──────────────────────────

/**
 * Merge a target scene with one or more source scenes that were marked for absorption.
 * Produces a single, denser scene that combines the best elements of all inputs.
 * The target scene's position in the timeline is preserved.
 */
async function mergeScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
  targetScene: Scene,
  sourcesToAbsorb: Scene[],
  reason: string,
  evaluation: StructureReview,
  timelineIndex: number,
  timeline: { scene: Scene; verdict: SceneVerdict; reason: string }[],
): Promise<Scene> {
  const sceneIdx = resolvedKeys.indexOf(targetScene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const ctx = narrativeContext(narrative, resolvedKeys, contextIndex);

  const prevScene = timelineIndex > 0 ? timeline[timelineIndex - 1].scene : null;
  const nextScene = timelineIndex < timeline.length - 1 ? timeline[timelineIndex + 1].scene : null;

  const surroundingContext = [
    prevScene ? `PREVIOUS SCENE (${prevScene.id}): ${prevScene.summary}` : '',
    nextScene ? `NEXT SCENE (${nextScene.id}): ${nextScene.summary}` : '',
  ].filter(Boolean).join('\n');

  const sourceBlock = sourcesToAbsorb
    .map((s, i) => {
      const threads = s.threadDeltas
        .map((tm) => {
          const moves = (tm.updates ?? [])
            .map((u) => `${u.outcome}${u.evidence >= 0 ? '+' : ''}${u.evidence}`)
            .join(' ');
          return `${tm.threadId} [${tm.logType}]${moves ? ' ' + moves : ''}`;
        })
        .join(', ');
      return `SOURCE ${i + 1} (${s.id}):\n  Summary: ${s.summary}\n  Events: ${s.events.join(', ')}\n  Threads: ${threads}`;
    })
    .join('\n\n');

  const prompt = buildMergeScenesPrompt({
    context: ctx,
    reason,
    evaluation,
    surroundingContext,
    targetSceneJson: JSON.stringify({
      locationId: targetScene.locationId,
      povId: targetScene.povId,
      participantIds: targetScene.participantIds,
      events: targetScene.events,
      threadDeltas: targetScene.threadDeltas,
      worldDeltas: targetScene.worldDeltas,
      relationshipDeltas: targetScene.relationshipDeltas,
      summary: targetScene.summary,
    }, null, 2),
    sourceBlock,
  });

  const reasoningBudget = resolveReasoningBudget(narrative);
  const websearch = resolveWebsearch(narrative);
  const raw = await callGenerate(prompt, buildReconstructMergeSystem(workIdentityFor(narrative)), MAX_TOKENS_SMALL, 'mergeScenes', GENERATE_MODEL, reasoningBudget, true, undefined, websearch);
  const parsed = parseJson(raw, 'mergeScenes') as Partial<Scene>;

  const merged: Scene = {
    ...targetScene,
    locationId: parsed.locationId ?? targetScene.locationId,
    povId: parsed.povId ?? targetScene.povId,
    participantIds: parsed.participantIds ?? targetScene.participantIds,
    events: parsed.events ?? targetScene.events,
    threadDeltas: parsed.threadDeltas ?? targetScene.threadDeltas,
    worldDeltas: parsed.worldDeltas ?? targetScene.worldDeltas,
    relationshipDeltas: parsed.relationshipDeltas ?? targetScene.relationshipDeltas,
    systemDeltas: normalizeSystemDeltas(parsed.systemDeltas, targetScene.systemDeltas),
    summary: parsed.summary ?? targetScene.summary,
    audioUrl: undefined,
  };
  sanitizeScenes([merged], narrative, 'mergeScenes');
  return merged;
}

// ── Scene insert (generate new scene from scratch) ──────────────────────────

/**
 * Generate a new scene from a brief. Used for "insert" verdicts where the
 * evaluator identified a missing beat, transition, or thread setup.
 */
async function insertScene(
  narrative: NarrativeState,
  resolvedKeys: string[],
  brief: string,
  evaluation: StructureReview,
  timelineIndex: number,
): Promise<Scene> {
  const contextIndex = Math.min(timelineIndex, resolvedKeys.length - 1);
  const ctx = narrativeContext(narrative, resolvedKeys, contextIndex);

  const prompt = buildInsertScenePrompt({
    context: ctx,
    brief,
    evaluation,
  });

  const reasoningBudget = resolveReasoningBudget(narrative);
  const websearch = resolveWebsearch(narrative);
  const raw = await callGenerate(prompt, buildReconstructInsertSystem(workIdentityFor(narrative)), MAX_TOKENS_SMALL, 'insertScene', GENERATE_MODEL, reasoningBudget, true, undefined, websearch);
  const parsed = parseJson(raw, 'insertScene') as Partial<Scene>;

  const inserted: Scene = {
    kind: 'scene',
    id: '', // caller sets this
    createdAt: new Date().toISOString(),
    arcId: '', // caller sets this
    locationId: parsed.locationId ?? '',
    povId: parsed.povId ?? '',
    participantIds: parsed.participantIds ?? [],
    events: parsed.events ?? [],
    threadDeltas: parsed.threadDeltas ?? [],
    worldDeltas: parsed.worldDeltas ?? [],
    relationshipDeltas: parsed.relationshipDeltas ?? [],
    systemDeltas: normalizeSystemDeltas(parsed.systemDeltas, undefined),
    timeDelta: normalizeTimeDelta(parsed.timeDelta),
    summary: parsed.summary ?? brief,
  };
  sanitizeScenes([inserted], narrative, 'insertScene');
  return inserted;
}
