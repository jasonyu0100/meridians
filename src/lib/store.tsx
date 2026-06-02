"use client";

import { assetManager } from "@/lib/asset-manager";
import { initBeatProfilePresets } from "@/lib/beat-profiles";
import { applyWorldDelta } from "@/lib/world-graph";
import { initMechanismProfilePresets } from "@/lib/mechanism-profiles";
import {
  classifyArchetype,
  classifyNarrativeShape,
  classifyScale,
  classifyWorldDensity,
  computeActivityCurve,
  computeForceSnapshots,
  computeRawForceTotals,
  computeSwingMagnitudes,
  FORCE_REFERENCE_MEANS,
  gradeForces,
  inferDominanceWeights,
  nextId,
  resolveCanonBranchId,
  resolveEntrySequence,
  resolvePlanForBranch,
  resolveProseForBranch,
} from "@/lib/narrative-utils";
import { initMatrixPresets } from "@/lib/pacing-profile";
import {
  deleteAnalysisApiLogs,
  deleteApiLogs,
  deleteNarrative as deletePersisted,
  loadActiveBranchId,
  loadAnalysisJobs,
  loadNarrative,
  loadNarratives,
  loadSearchState,
  migrateFromLocalStorage,
  saveNarrative as persistNarrative,
  saveActiveBranchId,
  saveActiveNarrativeId,
  saveAnalysisJobs,
  saveSearchState,
} from "@/lib/persistence";
import { sanitizeScenes } from "@/lib/ai/scenes";
import {
  applySystemDelta,
  sanitizeSystemDelta,
} from "@/lib/system-graph";
import { logError, logWarning } from "@/lib/system-logger";
import { applyThreadDelta, decayUntouchedStancesForScene, newNarratorStance } from "@/lib/thread-log";
import type {
  AnalysisJob,
  AppState,
  Arc,
  Artifact,
  AutoConfig,
  BeatPlan,
  BeatProseMap,
  Branch,
  BranchPlan,
  Character,
  BranchChatThread,
  BranchChatMessage,
  ChatMessage,
  ChatThread,
  ScopeState,
  WorldDelta,
  GraphViewMode,
  InspectorContext,
  Location,
  Mode,
  NarrativeEntry,
  NarrativeState,
  NarrativeViewState,
  DriverEntry,
  LocationMap,
  OwnershipDelta,
  PlanEvaluation,
  PlanningScenario,
  ProseEvaluation,
  ProseProfile,
  ProseScore,
  SavedProseProfile,
  ReasoningGraphSnapshot,
  RelationshipEdge,
  RelationshipDelta,
  Scene,
  SceneGameAnalysis,
  ArcInvestigation,
  SearchQuery,
  SourceFile,
  StorySettings,
  Survey,
  SurveyResponse,
  Interview,
  InterviewAnswer,
  StructureReview,
  SystemEdge,
  SystemGraph,
  NarrativeParadigm,
  SystemDelta,
  SystemNode,
  Thread,
  ThreadDelta,
  TieDelta,
  Variable,
  WorldBuild,
} from "@/types/narrative";
import { isScene, resolveEntry } from "@/types/narrative";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

// Bundled narratives loaded at runtime from /public manifests
const bundledNarratives = new Map<string, NarrativeState>();

function computeDerivedEntities(
  worldBuilds: Record<string, WorldBuild>,
  scenes: Record<string, Scene>,
  resolvedKeys: string[],
): {
  characters: Record<string, Character>;
  locations: Record<string, Location>;
  threads: Record<string, Thread>;
  artifacts: Record<string, Artifact>;
  relationships: RelationshipEdge[];
  systemGraph: SystemGraph;
} {
  const characters: Record<string, Character> = {};
  const locations: Record<string, Location> = {};
  const threads: Record<string, Thread> = {};
  const artifacts: Record<string, Artifact> = {};
  let relationships: RelationshipEdge[] = [];
  const wkNodes: Record<string, SystemNode> = {};
  const wkEdges: SystemEdge[] = [];

  // Graph derivation uses the shared sanitize→apply pipeline so that
  // self-loops, orphans, bad fields, and cross-delta duplicates are all
  // filtered consistently with the generation and analysis pipelines.
  const seenWkEdgeKeys = new Set<string>();
  const applySystemDeltaEntry = (wkm: SystemDelta) => {
    if (!wkm) return;
    // Clone so we don't mutate the entry's stored delta in place during derivation.
    const clone: SystemDelta = {
      addedNodes: [...(wkm.addedNodes ?? [])],
      addedEdges: [...(wkm.addedEdges ?? [])],
    };
    // Valid ids at this moment: everything already in the accumulating graph
    // plus anything this delta is about to contribute.
    const validIds = new Set<string>(Object.keys(wkNodes));
    for (const n of clone.addedNodes) if (n?.id) validIds.add(n.id);
    sanitizeSystemDelta(clone, validIds, seenWkEdgeKeys);
    applySystemDelta({ nodes: wkNodes, edges: wkEdges }, clone);
  };

  for (const key of resolvedKeys) {
    const wb = worldBuilds[key];
    if (wb) {
      for (const c of wb.expansionManifest.newCharacters) {
        characters[c.id] = {
          ...c,
          world: {
            nodes: c.world?.nodes ?? {},
            edges: c.world?.edges ?? [],
          },
        };
      }
      for (const l of wb.expansionManifest.newLocations) {
        locations[l.id] = {
          ...l,
          tiedCharacterIds: l.tiedCharacterIds ?? [],
          world: {
            nodes: l.world?.nodes ?? {},
            edges: l.world?.edges ?? [],
          },
        };
      }
      for (const t of wb.expansionManifest.newThreads) {
        threads[t.id] = { ...t };
      }
      // Collect artifacts — merge world if artifact already exists
      for (const a of wb.expansionManifest.newArtifacts ?? []) {
        const existing = artifacts[a.id];
        const aCont = {
          nodes: a.world?.nodes ?? {},
          edges: a.world?.edges ?? [],
        };
        if (existing) {
          artifacts[a.id] = {
            ...existing,
            ...a,
            world: {
              nodes: { ...existing.world.nodes, ...aCont.nodes },
              edges: [...existing.world.edges, ...aCont.edges],
            },
          };
        } else {
          artifacts[a.id] = {
            ...a,
            threadIds: a.threadIds ?? [],
            world: aCont,
          };
        }
      }
      // Collect system knowledge deltas
      applySystemDeltaEntry(
        wb.expansionManifest.systemDeltas ?? {
          addedNodes: [],
          addedEdges: [],
        },
      );
      // Apply thread market updates during a world build. Treat the
      // worldBuild id as the "scene" for log bookkeeping.
      const wbId = wb.id;
      for (const tm of wb.expansionManifest.threadDeltas ?? []) {
        const thread = threads[tm.threadId];
        if (!thread) continue;
        threads[tm.threadId] = applyThreadDelta(thread, tm, wbId);
      }
      // Apply expansion deltas on existing entities
      for (const km of wb.expansionManifest.worldDeltas ?? []) {
        const char = characters[km.entityId];
        const loc = locations[km.entityId];
        const art = artifacts[km.entityId];
        if (char)
          characters[km.entityId] = {
            ...char,
            world: applyWorldDelta(char.world, km),
          };
        else if (loc)
          locations[km.entityId] = {
            ...loc,
            world: applyWorldDelta(loc.world, km),
          };
        else if (art)
          artifacts[km.entityId] = {
            ...art,
            world: applyWorldDelta(art.world, km),
          };
      }
      for (const rm of wb.expansionManifest.relationshipDeltas ?? []) {
        const idx = relationships.findIndex(
          (r) => r.from === rm.from && r.to === rm.to,
        );
        if (idx >= 0) {
          const existing = relationships[idx];
          relationships = [
            ...relationships.slice(0, idx),
            {
              ...existing,
              type: rm.type,
              valence: Math.max(
                -1,
                Math.min(1, existing.valence + rm.valenceDelta),
              ),
            },
            ...relationships.slice(idx + 1),
          ];
        } else {
          relationships.push({
            from: rm.from,
            to: rm.to,
            type: rm.type,
            valence: Math.max(-1, Math.min(1, rm.valenceDelta)),
          });
        }
      }
      for (const om of wb.expansionManifest.ownershipDeltas ?? []) {
        const art = artifacts[om.artifactId];
        if (art) artifacts[om.artifactId] = { ...art, parentId: om.toId };
      }
      for (const mm of wb.expansionManifest.tieDeltas ?? []) {
        const loc = locations[mm.locationId];
        if (loc) {
          if (
            mm.action === "add" &&
            !loc.tiedCharacterIds.includes(mm.characterId)
          ) {
            locations[mm.locationId] = {
              ...loc,
              tiedCharacterIds: [...loc.tiedCharacterIds, mm.characterId],
            };
          } else if (mm.action === "remove") {
            locations[mm.locationId] = {
              ...loc,
              tiedCharacterIds: loc.tiedCharacterIds.filter(
                (id) => id !== mm.characterId,
              ),
            };
          }
        }
      }
    } else {
      const scene = scenes[key];
      if (!scene) continue;

      // Process introduced entities BEFORE deltas (so deltas can reference them)
      for (const c of scene.newCharacters ?? []) {
        if (!characters[c.id]) {
          characters[c.id] = {
            ...c,
            world: c.world ?? { nodes: {}, edges: [] },
          };
        }
      }
      for (const l of scene.newLocations ?? []) {
        if (!locations[l.id]) {
          locations[l.id] = {
            ...l,
            tiedCharacterIds: l.tiedCharacterIds ?? [],
            world: l.world ?? { nodes: {}, edges: [] },
          };
        }
      }
      for (const a of scene.newArtifacts ?? []) {
        if (!artifacts[a.id]) {
          artifacts[a.id] = {
            ...a,
            threadIds: a.threadIds ?? [],
            world: a.world ?? { nodes: {}, edges: [] },
          };
        }
      }
      for (const t of scene.newThreads ?? []) {
        if (!threads[t.id]) {
          // Ensure a canonical narrator stance exists for the thread. Thread
          // objects arriving here should already carry priored stances from
          // the ai/scenes.ts pipeline; fall back to uniform only if the
          // upstream step skipped them.
          const outcomes = (t.outcomes && t.outcomes.length >= 2) ? t.outcomes : ["yes", "no"];
          const rawPriorProbs = Array.isArray(
            (t as unknown as { priorProbs?: unknown }).priorProbs,
          )
            ? ((t as unknown as { priorProbs?: unknown }).priorProbs as unknown[]).map((v) =>
                typeof v === 'number' ? v : NaN,
              )
            : undefined;
          const stances = t.stances && Object.keys(t.stances).length > 0
            ? t.stances
            : { narrator: newNarratorStance(outcomes.length, 2, rawPriorProbs) };
          threads[t.id] = {
            ...t,
            outcomes,
            stances,
            threadLog: t.threadLog ?? { nodes: {}, edges: [] },
          };
        }
      }

      for (const km of scene.worldDeltas ?? []) {
        // World deltas can target characters, locations, or artifacts
        const char = characters[km.entityId];
        const loc = locations[km.entityId];
        const art = artifacts[km.entityId];
        if (char) {
          characters[km.entityId] = {
            ...char,
            world: applyWorldDelta(char.world, km),
          };
        } else if (loc) {
          locations[km.entityId] = {
            ...loc,
            world: applyWorldDelta(loc.world, km),
          };
        } else if (art) {
          artifacts[km.entityId] = {
            ...art,
            world: applyWorldDelta(art.world, km),
          };
        }
      }
      // First, decay volume for threads this scene did NOT touch.
      const touchedIds = new Set((scene.threadDeltas ?? []).map((tm) => tm.threadId));
      const decayed = decayUntouchedStancesForScene(threads as Record<string, Thread>, touchedIds);
      for (const id of Object.keys(decayed)) threads[id] = decayed[id];

      // Then apply market updates for touched threads.
      for (const tm of scene.threadDeltas ?? []) {
        const thread = threads[tm.threadId];
        if (!thread) continue;
        threads[tm.threadId] = applyThreadDelta(thread, tm, scene.id);
      }
      // Apply relationship deltas from scene
      for (const rm of scene.relationshipDeltas ?? []) {
        const idx = relationships.findIndex(
          (r) => r.from === rm.from && r.to === rm.to,
        );
        if (idx >= 0) {
          const existing = relationships[idx];
          relationships = [
            ...relationships.slice(0, idx),
            {
              ...existing,
              type: rm.type,
              valence: Math.max(
                -1,
                Math.min(1, existing.valence + rm.valenceDelta),
              ),
            },
            ...relationships.slice(idx + 1),
          ];
        } else {
          relationships.push({
            from: rm.from,
            to: rm.to,
            type: rm.type,
            valence: Math.max(-1, Math.min(1, rm.valenceDelta)),
          });
        }
      }
      // Apply system knowledge deltas from scene delta
      if (scene.systemDeltas) {
        applySystemDeltaEntry(scene.systemDeltas);
      }
      // Apply ownership deltas from scene
      for (const om of scene.ownershipDeltas ?? []) {
        const art = artifacts[om.artifactId];
        if (art) {
          artifacts[om.artifactId] = { ...art, parentId: om.toId };
        }
      }
      // Apply tie deltas from scene
      for (const mm of scene.tieDeltas ?? []) {
        const loc = locations[mm.locationId];
        if (loc) {
          if (
            mm.action === "add" &&
            !loc.tiedCharacterIds.includes(mm.characterId)
          ) {
            locations[mm.locationId] = {
              ...loc,
              tiedCharacterIds: [...loc.tiedCharacterIds, mm.characterId],
            };
          } else if (mm.action === "remove") {
            locations[mm.locationId] = {
              ...loc,
              tiedCharacterIds: loc.tiedCharacterIds.filter(
                (id) => id !== mm.characterId,
              ),
            };
          }
        }
      }
    }
  }

  // Compute threadIds on all entities from thread participants
  for (const thread of Object.values(threads)) {
    for (const anchor of thread.participants) {
      if (anchor.type === "character" && characters[anchor.id]) {
        const char = characters[anchor.id];
        const charThreadIds = char.threadIds ?? [];
        if (!charThreadIds.includes(thread.id)) {
          characters[anchor.id] = {
            ...char,
            threadIds: [...charThreadIds, thread.id],
          };
        }
      } else if (anchor.type === "location" && locations[anchor.id]) {
        const loc = locations[anchor.id];
        const locThreadIds = loc.threadIds ?? [];
        if (!locThreadIds.includes(thread.id)) {
          locations[anchor.id] = {
            ...loc,
            threadIds: [...locThreadIds, thread.id],
          };
        }
      } else if (anchor.type === "artifact" && artifacts[anchor.id]) {
        const art = artifacts[anchor.id];
        const artThreadIds = art.threadIds ?? [];
        if (!artThreadIds.includes(thread.id)) {
          artifacts[anchor.id] = {
            ...art,
            threadIds: [...artThreadIds, thread.id],
          };
        }
      }
    }
  }

  // Strip orphan edges — edges referencing node IDs that were never defined as actual nodes
  const validWkEdges = wkEdges.filter((e) => wkNodes[e.from] && wkNodes[e.to]);

  return {
    characters,
    locations,
    threads,
    artifacts,
    relationships,
    systemGraph: { nodes: wkNodes, edges: validWkEdges },
  };
}

/** Heal scenes whose required array fields are missing or non-array.
 *
 *  The Scene type marks `participantIds`, `events`, `threadDeltas`,
 *  `worldDeltas`, `relationshipDeltas` as required arrays — but
 *  malformed LLM output (especially from argument-driven paradigms
 *  where many scenes legitimately have empty deltas) can produce
 *  scenes missing one or more of these fields. This normaliser runs
 *  on every narrative passing through `withDerivedEntities`, so any
 *  pre-existing bad narrative in IndexedDB gets fixed at read time
 *  without needing a separate migration. */
function normaliseScenes(scenes: NarrativeState['scenes']): NarrativeState['scenes'] {
  let dirty = false;
  const out: NarrativeState['scenes'] = {};
  for (const [id, s] of Object.entries(scenes)) {
    const needs =
      !Array.isArray(s.participantIds) ||
      !Array.isArray(s.events) ||
      !Array.isArray(s.threadDeltas) ||
      !Array.isArray(s.worldDeltas) ||
      !Array.isArray(s.relationshipDeltas);
    if (needs) {
      dirty = true;
      out[id] = {
        ...s,
        participantIds: Array.isArray(s.participantIds) ? s.participantIds : [],
        events: Array.isArray(s.events) ? s.events : [],
        threadDeltas: Array.isArray(s.threadDeltas) ? s.threadDeltas : [],
        worldDeltas: Array.isArray(s.worldDeltas) ? s.worldDeltas : [],
        relationshipDeltas: Array.isArray(s.relationshipDeltas) ? s.relationshipDeltas : [],
      };
    } else {
      out[id] = s;
    }
  }
  return dirty ? out : scenes;
}

export function withDerivedEntities(
  n: NarrativeState,
  resolvedKeys: string[],
): NarrativeState {
  const scenes = normaliseScenes(n.scenes);
  const derived = computeDerivedEntities(n.worldBuilds, scenes, resolvedKeys);
  return {
    ...n,
    scenes,
    characters: derived.characters,
    locations: derived.locations,
    threads: derived.threads,
    artifacts: derived.artifacts,
    relationships: derived.relationships,
    systemGraph: derived.systemGraph,
  };
}

export function narrativeToEntry(n: NarrativeState): NarrativeEntry {
  const threadValues = Object.values(n.threads);

  // Compute shape, archetype, and score from the CANON branch's scenes.
  // Canon is the world view's official record; cards on the landing page
  // and dashboard show its stats specifically (not the currently-active
  // branch's, which can be a what-if fork or scratch exploration).
  // Falls back to the oldest branch when no canon is explicitly set —
  // see resolveCanonBranchId for the fallback rules.
  const branchId = resolveCanonBranchId(n);
  const keys = branchId
    ? resolveEntrySequence(n.branches, branchId)
    : [...Object.keys(n.scenes), ...Object.keys(n.worldBuilds)];
  const allScenes = keys
    .map((k) => resolveEntry(n, k))
    .filter((e): e is Scene => !!e && isScene(e));

  let shapeKey: string | undefined;
  let shapeName: string | undefined;
  let shapeCurve: [number, number][] | undefined;
  let archetypeKey: string | undefined;
  let archetypeName: string | undefined;
  let overallScore: number | undefined;

  // Scale and density can be computed with any scene count
  const scale = classifyScale(allScenes.length);
  const scaleKey = scale.key;
  const scaleName = scale.name;
  // Entity continuity graph density — total nodes and edges across all entities
  const allEntities = [
    ...Object.values(n.characters),
    ...Object.values(n.locations),
    ...Object.values(n.artifacts ?? {}),
  ];
  const entityContinuityNodes = allEntities.reduce(
    (sum, e) => sum + Object.keys(e.world?.nodes ?? {}).length,
    0,
  );
  const entityContinuityEdges = allEntities.reduce(
    (sum, e) => sum + (e.world?.edges?.length ?? 0),
    0,
  );
  const density = classifyWorldDensity(
    allScenes.length,
    Object.keys(n.characters).length,
    Object.keys(n.locations).length,
    Object.keys(n.threads).length,
    Object.keys(n.systemGraph?.nodes ?? {}).length,
    entityContinuityNodes,
    entityContinuityEdges,
  );
  const densityKey = density.key;
  const densityName = density.name;

  if (allScenes.length >= 3) {
    // Pass the narrative through so fate uses the refined (F7) formula
    // reading per-delta info-gain from thread log nodes. Delivery uses
    // dominance-weighted aggregation inferred from the raw force shares.
    const raw = computeRawForceTotals(allScenes, n);
    const rawForces = raw.fate.map((_, i) => ({
      fate: raw.fate[i],
      world: raw.world[i],
      system: raw.system[i],
    }));
    const swings = computeSwingMagnitudes(rawForces, FORCE_REFERENCE_MEANS);
    const forceMap = computeForceSnapshots(allScenes, [], n);
    const ordered = allScenes.map(
      (s) => forceMap[s.id] ?? { fate: 0, world: 0, system: 0 },
    );
    const weights = inferDominanceWeights(raw.fate, raw.world, raw.system);
    const activityPoints = computeActivityCurve(ordered, weights);
    const grades = gradeForces(raw.fate, raw.world, raw.system, swings);

    const shape = classifyNarrativeShape(activityPoints.map((d) => d.activity));
    const archetype = classifyArchetype(grades);
    shapeKey = shape.key;
    shapeName = shape.name;
    shapeCurve = shape.curve;
    archetypeKey = archetype.key;
    archetypeName = archetype.name;
    overallScore = grades.overall;
  }

  return {
    id: n.id,
    title: n.title,
    description: n.description,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    sceneCount: allScenes.length,
    coverThread: threadValues[0]?.description ?? "",
    coverImageUrl: n.coverImageUrl,
    shapeKey,
    shapeName,
    shapeCurve,
    archetypeKey,
    archetypeName,
    overallScore,
    scaleKey,
    scaleName,
    densityKey,
    densityName,
  };
}

function getRootBranchId(n: NarrativeState): string | null {
  const root = Object.values(n.branches).find((b) => b.parentBranchId === null);
  return root?.id ?? null;
}

function getResolvedKeys(n: NarrativeState, branchId: string | null): string[] {
  if (!branchId)
    return [...Object.keys(n.scenes), ...Object.keys(n.worldBuilds)];
  return resolveEntrySequence(n.branches, branchId);
}

const SEED_IDS = new Set<string>();
const PLAYGROUND_IDS = new Set<string>();
const ANALYSIS_IDS = new Set<string>();

function updateNarrative(
  state: AppState,
  updater: (n: NarrativeState) => NarrativeState,
): AppState {
  if (!state.activeNarrative) return state;
  const updated = updater(state.activeNarrative);
  updated.updatedAt = Date.now();
  return {
    ...state,
    activeNarrative: updated,
    narratives: state.narratives.map((e) =>
      e.id === updated.id
        ? narrativeToEntry(
            withDerivedEntities(updated, state.resolvedEntryKeys),
          )
        : e,
    ),
  };
}

/** Apply an updater only if the given narrativeId matches the currently
 *  active narrative. World-scoped flows (file conversion / extension
 *  jobs) carry the target narrativeId so updates land on the right
 *  world if the operator stayed put; if they navigated away the update
 *  is dropped silently. Keep extension runs short or stay on the world
 *  to avoid losing progress mid-flight. */
function updateActiveNarrativeIfMatch(
  state: AppState,
  narrativeId: string,
  updater: (n: NarrativeState) => NarrativeState,
): AppState {
  if (state.activeNarrative?.id !== narrativeId) return state;
  return updateNarrative(state, updater);
}

export const SEED_NARRATIVE_IDS = SEED_IDS;
export const PLAYGROUND_NARRATIVE_IDS = PLAYGROUND_IDS;
export const ANALYSIS_NARRATIVE_IDS = ANALYSIS_IDS;

const defaultViewState: NarrativeViewState = {
  activeBranchId: null,
  currentSceneIndex: 0,
  inspectorContext: null,
  inspectorHistory: [],
  selectedKnowledgeEntity: null,
  selectedThreadLog: null,
  selectedInvestigationId: null,
  currentSearchQuery: null,
  currentResultIndex: 0,
  searchFocusMode: false,
  activeChatThreadId: null,
  activeBranchChatThreadId: null,
  autoRunState: null,
  isPlaying: false,
};

const initialState: AppState = {
  narratives: [],
  activeNarrativeId: null,
  activeNarrative: null,
  hydrationComplete: false,
  analysisJobs: [],
  graphViewMode: "search",
  autoConfig: {
    endConditions: [{ type: "scene_count", target: 50 }],
    minArcLength: 2,
    maxArcLength: 5,
    maxActiveThreads: 6,
    threadStagnationThreshold: 5,
    direction: "",
    toneGuidance: "",
    narrativeConstraints: "",
    characterRotationEnabled: true,
    minScenesBetweenCharacterFocus: 3,
  },
  viewState: defaultViewState,
  resolvedEntryKeys: [],
};

// ── Actions ──────────────────────────────────────────────────────────────────
export type Action =
  | { type: "HYDRATE_NARRATIVES"; entries: NarrativeEntry[] }
  | { type: "HYDRATION_COMPLETE" }
  | { type: "ADD_NARRATIVE_ENTRY"; entry: NarrativeEntry }
  | { type: "SET_ACTIVE_NARRATIVE"; id: string }
  | {
      type: "LOADED_NARRATIVE";
      narrative: NarrativeState;
      savedBranchId?: string | null;
    }
  | { type: "TOGGLE_PLAY" }
  | { type: "NEXT_SCENE" }
  | { type: "PREV_SCENE" }
  | { type: "SET_SCENE_INDEX"; index: number }
  | { type: "SET_INSPECTOR"; context: InspectorContext | null }
  | { type: "INSPECTOR_BACK" }
  | { type: "ADD_NARRATIVE"; narrative: NarrativeState }
  | { type: "DELETE_NARRATIVE"; id: string }
  | {
      // Per-arc Present variables — each arc owns its own full set with
      // intensities baked into each Variable. Pass [] to clear.
      // Optional description + reasoning annotate the coordination's
      // gestalt and load-bearing logic; logit records "how likely was this
      // when it was chosen" in STANCE_EVIDENCE_MIN/MAX range. All three are
      // transferred onto new arcs by the scenarios commit path so
      // the path's rarity is a permanent record.
      type: "SET_ARC_PRESENT_VARIABLES";
      arcId: string;
      variables: Variable[];
      paradigm?: string;
      description?: string;
      reasoning?: string;
      considered?: string;
      breaks?: string;
      opens?: string;
      logit?: number;
    }
  | {
      // Replace the cohort of planning scenarios on a specific arc. Each
      // scenario owns its own custom variable set. Pass [] to clear.
      type: "SET_ARC_PLANNING_SCENARIOS";
      arcId: string;
      scenarios: PlanningScenario[];
      paradigm?: string;
    }
  | {
      // Store the last user-supplied direction string that shaped the cohort.
      type: "SET_ARC_SCENARIO_DIRECTION";
      arcId: string;
      direction: string | undefined;
    }
  | {
      // Wipe a single arc's variables (Present + scenarios + plausibility +
      // direction). No narrative-wide wipe — each arc owns its own state.
      type: "WIPE_ARC_VARIABLES";
      arcId: string;
    }
  | { type: "SELECT_KNOWLEDGE_ENTITY"; entityId: string | null }
  | { type: "SELECT_THREAD_LOG"; threadId: string | null }
  | { type: "SET_GRAPH_VIEW_MODE"; mode: GraphViewMode }
  // Search
  | { type: "SET_SEARCH_QUERY"; query: SearchQuery }
  | { type: "SET_SEARCH_RESULT_INDEX"; index: number }
  | { type: "CLEAR_SEARCH" }
  | { type: "TOGGLE_SEARCH_FOCUS" }
  | { type: "SWITCH_BRANCH"; branchId: string }
  // Scene deltas
  | {
      type: "UPDATE_SCENE";
      sceneId: string;
      updates: Partial<
        Pick<
          Scene,
          | "summary"
          | "events"
          | "locationId"
          | "participantIds"
          | "povId"
          | "threadDeltas"
          | "worldDeltas"
          | "relationshipDeltas"
          | "systemDeltas"
          | "arcId"
          | "proseEmbedding"
          | "summaryEmbedding"
          | "planEmbeddingCentroid"
        >
      > & {
        prose?: string;
        plan?: BeatPlan;
        beatProseMap?: BeatProseMap;
        proseScore?: ProseScore;
      };
      versionType?: "generate" | "rewrite" | "edit";
      sourcePlanVersion?: string;
    }
  | { type: "CLEAR_SCENE_PROSE_VERSION"; sceneId: string; branchId: string }
  | { type: "CLEAR_SCENE_PLAN_VERSION"; sceneId: string; branchId: string }
  | { type: "DELETE_SCENE"; sceneId: string; branchId: string }
  // Branch management
  | { type: "CREATE_BRANCH"; branch: Branch }
  | { type: "DELETE_BRANCH"; branchId: string }
  | { type: "RENAME_BRANCH"; branchId: string; name: string }
  | { type: "SET_CANON_BRANCH"; branchId: string }
  | {
      type: "SET_VERSION_POINTER";
      branchId: string;
      sceneId: string;
      pointerType: "prose" | "plan";
      version: string | undefined;
    }
  | { type: "REMOVE_BRANCH_ENTRY"; entryId: string; branchId: string }
  | {
      type: "SET_STRUCTURE_REVIEW";
      branchId: string;
      evaluation: StructureReview;
    }
  | {
      type: "SET_PROSE_EVALUATION";
      branchId: string;
      evaluation: ProseEvaluation;
    }
  | {
      type: "SET_PLAN_EVALUATION";
      branchId: string;
      evaluation: PlanEvaluation;
    }
  | {
      type: "SET_GAME_ANALYSIS";
      sceneId: string;
      analysis: SceneGameAnalysis;
    }
  | {
      type: "CLEAR_GAME_ANALYSIS";
      sceneId: string;
    }
  // Bulk AI-generated content
  | { type: "BULK_ADD_SCENES"; scenes: Scene[]; arc: Arc; branchId: string }
  | {
      type: "RECONSTRUCT_BRANCH";
      branchId: string;
      scenes: Scene[];
      arcs: Record<string, Arc>;
    }
  | {
      type: "EXPAND_WORLD";
      worldBuildId: string;
      branchId: string;
      /** AI-generated 1-2 sentence intent of this expansion. When omitted,
       *  the reducer falls back to a derived count string. */
      summary?: string;
      characters: Character[];
      locations: Location[];
      artifacts: Artifact[];
      threads: Thread[];
      threadDeltas?: ThreadDelta[];
      worldDeltas?: WorldDelta[];
      systemDeltas?: SystemDelta;
      relationshipDeltas?: RelationshipDelta[];
      ownershipDeltas?: OwnershipDelta[];
      tieDeltas?: TieDelta[];
      attributions?: string[];
      attributionEdges?: import("@/types/narrative").AttributionEdge[];
      reasoningGraph?: ReasoningGraphSnapshot;
    }
  // Auto mode
  | { type: "SET_AUTO_CONFIG"; config: AutoConfig }
  | { type: "START_AUTO_RUN" }
  | { type: "STOP_AUTO_RUN" }
  | { type: "SET_AUTO_STATUS"; message: string }
  | { type: "RESET_AUTO_STREAM" }
  | { type: "APPEND_AUTO_STREAM"; chunk: string }
  | {
      type: "TICK_AUTO_RUN";
      scenesGenerated: number;
      worldExpanded: boolean;
      hasError: boolean;
    }
  | { type: "SET_COVER_IMAGE"; narrativeId: string; imageUrl: string }
  | {
      type: "UPDATE_NARRATIVE_META";
      narrativeId: string;
      title?: string;
      description?: string;
    }
  | { type: "SET_SCENE_AUDIO"; sceneId: string; audioUrl: string }
  | { type: "CLEAR_SCENE_AUDIO"; sceneId: string }
  | { type: "SET_CHARACTER_IMAGE"; characterId: string; imageUrl: string }
  | { type: "SET_LOCATION_IMAGE"; locationId: string; imageUrl: string }
  | { type: "SET_ARTIFACT_IMAGE"; artifactId: string; imageUrl: string }
  | { type: "SET_CHARACTER_IMAGE_PROMPT"; characterId: string; imagePrompt: string }
  | { type: "SET_LOCATION_IMAGE_PROMPT"; locationId: string; imagePrompt: string }
  | { type: "REBUILD_LOCATION_HIERARCHY"; parents: Record<string, string | null> }
  | { type: "SET_ARTIFACT_IMAGE_PROMPT"; artifactId: string; imagePrompt: string }
  | { type: "SET_IMAGE_STYLE"; style: string }
  | { type: "SET_STORY_SETTINGS"; settings: StorySettings }
  | { type: "SET_PROSE_PROFILE"; profile: ProseProfile | undefined }
  | { type: "ADD_SAVED_PROSE_PROFILE"; saved: SavedProseProfile }
  | { type: "RENAME_SAVED_PROSE_PROFILE"; id: string; name: string }
  | { type: "UPDATE_SAVED_PROSE_PROFILE"; id: string; profile: ProseProfile }
  | { type: "DELETE_SAVED_PROSE_PROFILE"; id: string }
  | { type: "SET_PATTERNS"; patterns: string[] }
  | { type: "SET_ANTI_PATTERNS"; antiPatterns: string[] }
  | { type: "ADD_PHASE_GRAPH"; graph: Mode }
  | { type: "SET_CURRENT_PHASE_GRAPH"; modeId: string | null }
  | { type: "RENAME_PHASE_GRAPH"; modeId: string; name: string }
  | { type: "DELETE_PHASE_GRAPH"; modeId: string }
  | { type: "SET_GENRE"; genre: string }
  | { type: "SET_SUBGENRE"; subgenre: string }
  | { type: "SET_DETECTED_PATTERNS"; paradigm?: NarrativeParadigm; genre: string; subgenre: string; patterns: string[]; antiPatterns: string[] }
  // Analysis
  | { type: "ADD_ANALYSIS_JOB"; job: AnalysisJob }
  | { type: "UPDATE_ANALYSIS_JOB"; id: string; updates: Partial<AnalysisJob> }
  | { type: "DELETE_ANALYSIS_JOB"; id: string }
  | { type: "HYDRATE_ANALYSIS_JOBS"; jobs: AnalysisJob[] }
  // Source files — world-scoped corpus records (creation + extension)
  | { type: "ADD_SOURCE_FILE"; narrativeId: string; file: SourceFile }
  | { type: "UPDATE_SOURCE_FILE"; narrativeId: string; fileId: string; updates: Partial<SourceFile> }
  | { type: "DELETE_SOURCE_FILE"; narrativeId: string; fileId: string }
  | {
      // Atomic merge of an extracted slice into the narrative. The slice's
      // entities are pre-remapped against the target's namespace — the
      // reducer just merges them and tails the new entries onto the chosen
      // branch's entryIds.
      type: "APPLY_EXTENSION";
      narrativeId: string;
      branchId: string;
      fileId: string;
      characters: Character[];
      locations: Location[];
      artifacts: Artifact[];
      threads: Thread[];
      scenes: Scene[];
      worldBuilds: WorldBuild[];
      arcs: Arc[];
      appendEntryIds: string[];
      /** Phase III.b — expansion records for existing threads that
       *  absorbed slice contributions. Each entry appends outcomes
       *  and participants to the named existing thread (deduped
       *  case-insensitively for outcomes, by id for participants). */
      threadExpansions?: Array<{
        existingThreadId: string;
        addOutcomes: string[];
        addParticipants: { id: string; type: 'character' | 'location' | 'artifact' }[];
      }>;
    }
  // Chat threads
  | { type: "CREATE_CHAT_THREAD"; thread: ChatThread }
  | { type: "DELETE_CHAT_THREAD"; threadId: string }
  | { type: "RENAME_CHAT_THREAD"; threadId: string; name: string }
  | { type: "SET_ACTIVE_CHAT_THREAD"; threadId: string | null }
  | {
      type: "UPSERT_CHAT_THREAD";
      threadId: string;
      messages: ChatMessage[];
      name?: string;
    }
  // Branch Chat threads — persisted multi-branch analytical sessions.
  | { type: "CREATE_BRANCH_CHAT_THREAD"; thread: BranchChatThread }
  | { type: "DELETE_BRANCH_CHAT_THREAD"; threadId: string }
  | { type: "RENAME_BRANCH_CHAT_THREAD"; threadId: string; name: string }
  | { type: "SET_ACTIVE_BRANCH_CHAT_THREAD"; threadId: string | null }
  | {
      type: "UPSERT_BRANCH_CHAT_THREAD";
      threadId: string;
      messages?: BranchChatMessage[];
      name?: string;
      compareBranchIds?: string[];
      scopeState?: ScopeState;
    }
  // Driver workspace — entries in the daily-driver queue
  | { type: "CREATE_DRIVER_ENTRY"; entry: DriverEntry }
  | { type: "DELETE_DRIVER_ENTRY"; entryId: string }
  | { type: "UPDATE_DRIVER_ENTRY"; entryId: string; title?: string; text?: string; tags?: string[] }
  // Stamp a set of entries with the SourceFile they were folded into.
  // Marks them locked — UPDATE_DRIVER_ENTRY and DELETE_DRIVER_ENTRY
  // become no-ops on these entries thereafter.
  | { type: "MARK_DRIVER_ENTRIES_USED"; entryIds: string[]; fileId: string }
  // Location maps — Replicate-rendered images of location clusters.
  | { type: "SAVE_MAP"; map: LocationMap }
  | { type: "DELETE_MAP"; mapId: string }
  // Surveys
  | { type: "CREATE_SURVEY"; survey: Survey }
  | { type: "DELETE_SURVEY"; surveyId: string }
  | { type: "UPDATE_SURVEY"; surveyId: string; updates: Partial<Survey> }
  | { type: "SET_SURVEY_RESPONSE"; surveyId: string; response: SurveyResponse }
  // Interviews
  | { type: "CREATE_INTERVIEW"; interview: Interview }
  | { type: "DELETE_INTERVIEW"; interviewId: string }
  | { type: "UPDATE_INTERVIEW"; interviewId: string; updates: Partial<Interview> }
  | { type: "SET_INTERVIEW_ANSWER"; interviewId: string; answer: InterviewAnswer }
  // Investigations — arc-anchored CRGs
  | { type: "CREATE_INVESTIGATION"; investigation: ArcInvestigation }
  | { type: "UPDATE_INVESTIGATION"; investigationId: string; updates: Partial<ArcInvestigation> }
  | { type: "DELETE_INVESTIGATION"; investigationId: string }
  | { type: "SET_SELECTED_INVESTIGATION"; investigationId: string | null }
  // Coordination plan
  | { type: "SET_COORDINATION_PLAN"; branchId: string; plan: BranchPlan | undefined }
  | { type: "CLEAR_COORDINATION_PLAN"; branchId: string }
  | { type: "ADVANCE_COORDINATION_PLAN"; branchId: string }
  | { type: "RESET_COORDINATION_PLAN"; branchId: string }
  | { type: "SET_COORDINATION_PLAN_ARC"; branchId: string; arcIndex: number }
  // Reasoning graph
  | { type: "SET_ARC_REASONING_GRAPH"; arcId: string; reasoningGraph: Arc["reasoningGraph"] }
  // System graph manual mutations — used by the inspector's "Connect" button
  // when two co-attributed nodes lack an edge. The edge is stored on the
  // specified scene's systemDeltas so it joins the cumulative graph in
  // chronological position rather than floating outside the timeline.
  | { type: "ADD_SYSTEM_EDGE"; sceneId: string; edge: SystemEdge };

// Scene navigation should drag a scene-typed inspector context along with the
// cursor, otherwise the panel stays pinned to whichever entry was clicked
// first. Other context types (character, thread, knowledge node, etc.) stay
// pinned by design so the operator can scrub the timeline under a stable lens.
// World-build entries are valid targets too — SceneDetail renders both kinds
// off the same entry id.
function applySceneNavigation(state: AppState, nextIndex: number): AppState {
  const viewState = { ...state.viewState, currentSceneIndex: nextIndex };
  const ctx = state.viewState.inspectorContext;
  const narrative = state.activeNarrative;
  if (ctx?.type === "scene" && narrative) {
    const nextKey = state.resolvedEntryKeys[nextIndex];
    if (nextKey && (narrative.scenes[nextKey] || narrative.worldBuilds?.[nextKey])) {
      viewState.inspectorContext = { type: "scene", sceneId: nextKey };
    }
  }
  return { ...state, viewState };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "HYDRATE_NARRATIVES": {
      return { ...state, narratives: action.entries };
    }
    case "HYDRATION_COMPLETE": {
      return { ...state, hydrationComplete: true };
    }
    case "ADD_NARRATIVE_ENTRY": {
      // Upsert entry. We replace even if present because bundled-load dispatches
      // this after mutating SEED_IDS/PLAYGROUND_IDS/ANALYSIS_IDS — the reference
      // change forces a re-render so the UI filters (which read those Sets) pick
      // up the new classification.
      const existing = state.narratives.findIndex((n) => n.id === action.entry.id);
      if (existing >= 0) {
        const next = [...state.narratives];
        next[existing] = action.entry;
        return { ...state, narratives: next };
      }
      return { ...state, narratives: [...state.narratives, action.entry] };
    }
    case "SET_ACTIVE_NARRATIVE": {
      // Just set the ID — the async loading effect will populate the narrative
      if (state.activeNarrativeId === action.id && state.activeNarrative)
        return state;
      return {
        ...state,
        activeNarrativeId: action.id,
        activeNarrative: null, // cleared until async load completes
        resolvedEntryKeys: [],
        viewState: defaultViewState, // Reset all narrative-scoped state
      };
    }
    case "LOADED_NARRATIVE": {
      // Async load completed — populate state
      if (state.activeNarrativeId !== action.narrative.id) return state; // stale
      const savedBranch =
        action.savedBranchId && action.narrative.branches[action.savedBranchId]
          ? action.savedBranchId
          : null;
      const branchId = savedBranch ?? getRootBranchId(action.narrative);
      const resolved = getResolvedKeys(action.narrative, branchId);
      const derivedNarrative = withDerivedEntities(action.narrative, resolved);
      return {
        ...state,
        activeNarrative: derivedNarrative,
        resolvedEntryKeys: resolved,
        viewState: {
          ...state.viewState,
          activeBranchId: branchId,
          currentSceneIndex: resolved.length - 1,
        },
      };
    }
    case "TOGGLE_PLAY":
      return { ...state, viewState: { ...state.viewState, isPlaying: !state.viewState.isPlaying } };
    case "NEXT_SCENE": {
      const max = state.resolvedEntryKeys.length - 1;
      const nextIdx = Math.min(state.viewState.currentSceneIndex + 1, Math.max(0, max));
      return applySceneNavigation(state, nextIdx);
    }
    case "PREV_SCENE": {
      const prevIdx = Math.max(state.viewState.currentSceneIndex - 1, 0);
      return applySceneNavigation(state, prevIdx);
    }
    case "SET_SCENE_INDEX":
      return applySceneNavigation(state, action.index);
    case "SET_INSPECTOR": {
      // Push current context to history stack before navigating (max 20 entries)
      const history = state.viewState.inspectorContext
        ? [...state.viewState.inspectorHistory.slice(-19), state.viewState.inspectorContext]
        : state.viewState.inspectorHistory;
      return {
        ...state,
        viewState: {
          ...state.viewState,
          inspectorContext: action.context,
          inspectorHistory: action.context ? history : [],
        },
      };
    }
    case "INSPECTOR_BACK": {
      const prev =
        state.viewState.inspectorHistory[state.viewState.inspectorHistory.length - 1] ?? null;
      return {
        ...state,
        viewState: {
          ...state.viewState,
          inspectorContext: prev,
          inspectorHistory: state.viewState.inspectorHistory.slice(0, -1),
        },
      };
    }
    case "ADD_NARRATIVE": {
      // Inject an initial world-building commit as the first timeline entry
      const n = {
        ...action.narrative,
        worldBuilds: { ...action.narrative.worldBuilds },
        branches: { ...action.narrative.branches },
      };
      const rootBranch = Object.values(n.branches).find(
        (b) => b.parentBranchId === null,
      );
      const allChars = Object.values(n.characters);
      const allLocs = Object.values(n.locations);
      const allThreads = Object.values(n.threads);

      // Only inject a world-build commit if the narrative doesn't already have one
      const hasExistingWorldBuild = Object.keys(n.worldBuilds).length > 0;
      const worldBuildId = nextId("WB", Object.keys(n.worldBuilds));
      if (
        rootBranch &&
        !hasExistingWorldBuild &&
        (allChars.length > 0 || allLocs.length > 0 || allThreads.length > 0)
      ) {
        const parts: string[] = [];
        if (allChars.length > 0)
          parts.push(
            `${allChars.length} character${allChars.length > 1 ? "s" : ""} (${allChars.map((c) => c.name).join(", ")})`,
          );
        if (allLocs.length > 0)
          parts.push(
            `${allLocs.length} location${allLocs.length > 1 ? "s" : ""} (${allLocs.map((l) => l.name).join(", ")})`,
          );
        if (allThreads.length > 0)
          parts.push(
            `${allThreads.length} thread${allThreads.length > 1 ? "s" : ""}`,
          );
        if (n.relationships.length > 0)
          parts.push(
            `${n.relationships.length} relationship${n.relationships.length > 1 ? "s" : ""}`,
          );

        const allArtifacts = Object.values(n.artifacts ?? {});
        const wkNodeCount = Object.keys(n.systemGraph?.nodes ?? {}).length;
        if (allArtifacts.length > 0)
          parts.push(
            `${allArtifacts.length} artifact${allArtifacts.length > 1 ? "s" : ""}`,
          );
        if (wkNodeCount > 0)
          parts.push(
            `${wkNodeCount} knowledge node${wkNodeCount > 1 ? "s" : ""}`,
          );
        const worldBuild: WorldBuild = {
          kind: "world_build",
          id: worldBuildId,
          createdAt: new Date().toISOString(),
          summary: `World created: ${parts.join(", ")}`,
          expansionManifest: {
            newCharacters: allChars,
            newLocations: allLocs,
            newThreads: allThreads,
            newArtifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
            systemDeltas: {
              addedNodes: Object.values(n.systemGraph?.nodes ?? {}).map(
                (node) => ({
                  id: node.id,
                  concept: node.concept,
                  type: node.type,
                }),
              ),
              addedEdges: (n.systemGraph?.edges ?? []).map((edge) => ({
                from: edge.from,
                to: edge.to,
                relation: edge.relation,
              })),
            },
            relationshipDeltas: n.relationships.map((r) => ({
              from: r.from,
              to: r.to,
              type: r.type,
              valenceDelta: r.valence,
            })),
          },
        };

        // Prepend the world-build commit before existing entries in the branch
        n.worldBuilds[worldBuildId] = worldBuild;
        n.branches[rootBranch.id] = {
          ...rootBranch,
          entryIds: [worldBuildId, ...rootBranch.entryIds],
        };
      }

      const newBranchId = getRootBranchId(n);
      const newResolved = getResolvedKeys(n, newBranchId);
      const derived = withDerivedEntities(n, newResolved ?? []);

      const entry = narrativeToEntry(derived);
      // Persistence handled by effects watching activeNarrative
      return {
        ...state,
        narratives: [...state.narratives, entry],
        activeNarrativeId: derived.id,
        activeNarrative: derived,
        resolvedEntryKeys: newResolved,
        viewState: {
          ...defaultViewState,
          activeBranchId: newBranchId,
          currentSceneIndex: Math.max(0, newResolved.length - 1),
        },
      };
    }
    case "SET_ARC_PRESENT_VARIABLES": {
      return updateNarrative(state, (n) => {
        const arc = n.arcs[action.arcId];
        if (!arc) return n;
        // Description / reasoning / logit are optional. Omitting them in
        // the action clears any prior values (e.g. when the user wipes the
        // arc); a partial regenerate that only supplies variables also
        // clears them, since stale annotations would misdescribe the new
        // set.
        return {
          ...n,
          arcs: {
            ...n.arcs,
            [action.arcId]: {
              ...arc,
              presentVariables: action.variables.length > 0 ? action.variables : undefined,
              // Paradigm is COMPASS-LEVEL, not per-coordination — survives
              // partial updates (single-variable intensity tweaks etc.)
              // unless the caller explicitly passes a new one or wipes the
              // arc by clearing variables. Other annotations (description /
              // reasoning / considered / breaks / opens / logit) describe
              // the specific coordination and DO clear on partial update
              // because they'd misdescribe the new state.
              presentParadigm:
                action.variables.length === 0
                  ? undefined
                  : (action.paradigm ?? arc.presentParadigm),
              presentDescription: action.description,
              presentReasoning: action.reasoning,
              presentConsidered: action.considered,
              presentBreaks: action.breaks,
              presentOpens: action.opens,
              presentLogit: action.logit,
            },
          },
        };
      });
    }
    case "SET_ARC_PLANNING_SCENARIOS": {
      return updateNarrative(state, (n) => {
        const arc = n.arcs[action.arcId];
        if (!arc) return n;
        return {
          ...n,
          arcs: {
            ...n.arcs,
            [action.arcId]: {
              ...arc,
              planningScenarios: action.scenarios.length > 0 ? action.scenarios : undefined,
              // Paradigm is COMPASS-LEVEL — preserve across partial updates
              // (edit / remove / commit-pending) unless the caller passes a
              // new one or wipes the cohort.
              planningParadigm:
                action.scenarios.length === 0
                  ? undefined
                  : (action.paradigm ?? arc.planningParadigm),
            },
          },
        };
      });
    }
    case "SET_ARC_SCENARIO_DIRECTION": {
      return updateNarrative(state, (n) => {
        const arc = n.arcs[action.arcId];
        if (!arc) return n;
        return {
          ...n,
          arcs: {
            ...n.arcs,
            [action.arcId]: {
              ...arc,
              scenarioDirection: action.direction && action.direction.trim() ? action.direction.trim() : undefined,
            },
          },
        };
      });
    }
    case "WIPE_ARC_VARIABLES": {
      return updateNarrative(state, (n) => {
        const arc = n.arcs[action.arcId];
        if (!arc) return n;
        return {
          ...n,
          arcs: {
            ...n.arcs,
            [action.arcId]: {
              ...arc,
              presentVariables: undefined,
              presentParadigm: undefined,
              planningScenarios: undefined,
              planningParadigm: undefined,
              scenarioDirection: undefined,
            },
          },
        };
      });
    }
    case "DELETE_NARRATIVE": {
      const isSeed = SEED_IDS.has(action.id);
      const isActive = state.activeNarrativeId === action.id;

      // Fire-and-forget async delete
      deletePersisted(action.id).catch((err) => {
        logError("Failed to delete narrative from storage", err, {
          source: "other",
          operation: "delete-narrative",
          details: { narrativeId: action.id },
        });
      });
      deleteApiLogs(action.id).catch((err) => {
        logError("Failed to delete API logs from storage", err, {
          source: "other",
          operation: "delete-api-logs",
          details: { narrativeId: action.id },
        });
      });
      // Delete associated assets (audio, embeddings, images)
      assetManager
        .init()
        .then(() => assetManager.deleteNarrativeAssets(action.id))
        .catch((err) => {
          logError("Failed to delete narrative assets", err, {
            source: "other",
            operation: "delete-narrative-assets",
            details: { narrativeId: action.id },
          });
        });

      if (isSeed) {
        // Reset seed to original bundled data instead of removing it
        const originalSeed = bundledNarratives.get(action.id);
        if (!originalSeed) return state;
        const resetEntry = narrativeToEntry(originalSeed);
        return {
          ...state,
          narratives: state.narratives.map((n) =>
            n.id === action.id ? resetEntry : n,
          ),
          activeNarrativeId: isActive ? null : state.activeNarrativeId,
          activeNarrative: isActive ? null : state.activeNarrative,
        };
      }

      return {
        ...state,
        narratives: state.narratives.filter((n) => n.id !== action.id),
        activeNarrativeId: isActive ? null : state.activeNarrativeId,
        activeNarrative: isActive ? null : state.activeNarrative,
      };
    }
    case "SELECT_KNOWLEDGE_ENTITY":
      return {
        ...state,
        viewState: {
          ...state.viewState,
          selectedKnowledgeEntity: action.entityId,
          selectedThreadLog: null,
        },
      };
    case "SELECT_THREAD_LOG":
      return {
        ...state,
        viewState: {
          ...state.viewState,
          selectedThreadLog: action.threadId,
          selectedKnowledgeEntity: null,
        },
      };
    case "SET_GRAPH_VIEW_MODE":
      return {
        ...state,
        graphViewMode: action.mode,
        viewState: {
          ...state.viewState,
          selectedThreadLog: null,
          selectedKnowledgeEntity: null,
        },
      };

    case "SET_SEARCH_QUERY":
      return {
        ...state,
        viewState: {
          ...state.viewState,
          currentSearchQuery: action.query,
          currentResultIndex: 0,
          searchFocusMode: true,
        },
      };

    case "SET_SEARCH_RESULT_INDEX":
      return {
        ...state,
        viewState: { ...state.viewState, currentResultIndex: action.index },
      };

    case "CLEAR_SEARCH":
      return {
        ...state,
        viewState: {
          ...state.viewState,
          currentSearchQuery: null,
          currentResultIndex: 0,
          searchFocusMode: false,
        },
      };

    case "TOGGLE_SEARCH_FOCUS":
      return {
        ...state,
        viewState: { ...state.viewState, searchFocusMode: !state.viewState.searchFocusMode },
      };

    case "SWITCH_BRANCH": {
      if (!state.activeNarrative) return state;
      const resolved = getResolvedKeys(state.activeNarrative, action.branchId);
      const derived = withDerivedEntities(state.activeNarrative, resolved);
      return {
        ...state,
        activeNarrative: derived,
        resolvedEntryKeys: resolved,
        viewState: {
          ...state.viewState,
          activeBranchId: action.branchId,
          currentSceneIndex: resolved.length - 1,
          inspectorContext:
            resolved.length > 0
              ? { type: "scene" as const, sceneId: resolved[resolved.length - 1] }
              : null,
          selectedKnowledgeEntity: null,
          selectedThreadLog: null,
        },
      };
    }

    // ── CRUD: Scenes ──────────────────────────────────────────────────────
    case "UPDATE_SCENE":
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;

        const updates = { ...action.updates };
        let updatedScene = { ...scene };
        const versionType = action.versionType ?? "generate";

        // Get current resolved version (from pointer or latest for this branch)
        const branch = state.viewState.activeBranchId
          ? n.branches[state.viewState.activeBranchId]
          : undefined;
        const currentProsePointer =
          branch?.versionPointers?.[scene.id]?.proseVersion;
        const currentPlanPointer =
          branch?.versionPointers?.[scene.id]?.planVersion;

        // Helper to compute next version number
        // Version hierarchy: generate (major) → rewrite (minor) → edit (sub-minor)
        // E.g., 1 → 1.1 → 1.1.1, 1.1.2 → 1.2 → 2 → 2.1 → 2.1.1
        // IMPORTANT: Version numbers are GLOBALLY unique across all branches.
        // Even if user is on V1.2 and V1.3 exists elsewhere, new rewrite creates V1.4
        const computeNextVersion = (
          allVersions: {
            version: string;
            branchId: string;
            versionType: string;
          }[],
          _branchId: string,
          type: "generate" | "rewrite" | "edit",
          currentVersion?: string, // The version currently being viewed/edited
        ): { version: string; parentVersion?: string } => {
          // Sort versions: highest first by major, then minor, then edit
          const sortVersions = (vList: typeof allVersions) => {
            return [...vList].sort((a, b) => {
              const aParts = a.version.split(".").map(Number);
              const bParts = b.version.split(".").map(Number);
              for (let i = 0; i < 3; i++) {
                const av = aParts[i] ?? 0;
                const bv = bParts[i] ?? 0;
                if (av !== bv) return bv - av;
              }
              return 0;
            });
          };

          // Parse version string into parts
          const parseVersion = (v: string) => {
            const parts = v.split(".").map(Number);
            return {
              major: parts[0] ?? 0,
              minor: parts[1] ?? 0,
              edit: parts[2] ?? 0,
            };
          };

          // Get the current version's parts (if specified)
          const current = currentVersion ? parseVersion(currentVersion) : null;

          if (type === "generate") {
            // Fresh generation: find highest major version GLOBALLY, increment
            let maxMajor = 0;
            for (const v of allVersions) {
              const major = parseInt(v.version.split(".")[0], 10);
              if (!isNaN(major) && major > maxMajor) maxMajor = major;
            }
            return {
              version: String(maxMajor + 1),
              parentVersion: currentVersion,
            };
          } else if (type === "rewrite") {
            // Rewrite: increment minor at the CURRENT major level, but check for existing higher minors
            if (allVersions.length === 0) {
              return { version: "1.1", parentVersion: undefined };
            }

            // Use current version's major, or latest if none specified
            const sorted = sortVersions(allVersions);
            const targetMajor =
              current?.major ?? parseVersion(sorted[0].version).major;

            // Find highest minor at this major level (across all branches)
            let maxMinor = 0;
            for (const v of allVersions) {
              const parts = parseVersion(v.version);
              if (parts.major === targetMajor && parts.minor > maxMinor) {
                maxMinor = parts.minor;
              }
            }

            return {
              version: `${targetMajor}.${maxMinor + 1}`,
              parentVersion: currentVersion,
            };
          } else {
            // Edit: increment sub-minor at the CURRENT major.minor level, check for existing higher edits
            if (allVersions.length === 0) {
              return { version: "1.0.1", parentVersion: undefined };
            }

            // Use current version's major.minor, or latest if none specified
            const sorted = sortVersions(allVersions);
            const latest = parseVersion(sorted[0].version);
            const targetMajor = current?.major ?? latest.major;
            const targetMinor = current?.minor ?? latest.minor;

            // Find highest edit at this major.minor level (across all branches)
            let maxEdit = 0;
            for (const v of allVersions) {
              const parts = parseVersion(v.version);
              if (
                parts.major === targetMajor &&
                parts.minor === targetMinor &&
                parts.edit > maxEdit
              ) {
                maxEdit = parts.edit;
              }
            }

            return {
              version: `${targetMajor}.${targetMinor}.${maxEdit + 1}`,
              parentVersion: currentVersion,
            };
          }
        };

        // Handle prose versioning — append to version array instead of overwriting
        let newProseVersion: string | undefined;
        if (updates.prose !== undefined && state.viewState.activeBranchId) {
          const { version, parentVersion } = computeNextVersion(
            scene.proseVersions ?? [],
            state.viewState.activeBranchId,
            versionType,
            currentProsePointer, // Use pointer if user pinned a specific version
          );
          const newVersion = {
            prose: updates.prose,
            beatProseMap: updates.beatProseMap,
            proseScore: updates.proseScore,
            branchId: state.viewState.activeBranchId,
            timestamp: Date.now(),
            version,
            versionType,
            parentVersion,
            sourcePlanVersion: action.sourcePlanVersion,
          };
          updatedScene.proseVersions = [
            ...(scene.proseVersions ?? []),
            newVersion,
          ];
          // Auto-update version pointer to point to the new version
          newProseVersion = version;
          // Remove from direct updates — no longer writing to legacy fields
          delete updates.prose;
          delete updates.beatProseMap;
          delete updates.proseScore;
        }

        // Handle beatProseMap attachment without prose change. Reverse-engineering
        // a plan from existing prose produces a new beat-prose alignment for the
        // ALREADY-WRITTEN prose. We should not fabricate a new prose version
        // (the text hasn't changed); instead, update the beatProseMap on the
        // currently-pointed prose version in place.
        if (
          updates.beatProseMap !== undefined &&
          updates.prose === undefined &&
          (updatedScene.proseVersions ?? scene.proseVersions ?? []).length > 0
        ) {
          const versions = updatedScene.proseVersions ?? scene.proseVersions ?? [];
          // Pick the target prose version: pointer first, then latest by timestamp.
          const pointer = state.viewState.activeBranchId
            ? n.branches[state.viewState.activeBranchId]?.versionPointers?.[scene.id]?.proseVersion
            : undefined;
          let targetIdx = pointer
            ? versions.findIndex(v => v.version === pointer)
            : -1;
          if (targetIdx < 0) {
            // Fallback: latest by timestamp.
            let latestIdx = 0;
            for (let i = 1; i < versions.length; i++) {
              if (versions[i].timestamp > versions[latestIdx].timestamp) latestIdx = i;
            }
            targetIdx = latestIdx;
          }
          updatedScene.proseVersions = versions.map((v, i) =>
            i === targetIdx ? { ...v, beatProseMap: updates.beatProseMap } : v,
          );
          delete updates.beatProseMap;
        }

        // Handle plan versioning — append to version array instead of overwriting
        let newPlanVersion: string | undefined;
        if (updates.plan !== undefined && state.viewState.activeBranchId) {
          const { version, parentVersion } = computeNextVersion(
            scene.planVersions ?? [],
            state.viewState.activeBranchId,
            versionType,
            currentPlanPointer, // Use pointer if user pinned a specific version
          );
          const newVersion = {
            plan: updates.plan,
            branchId: state.viewState.activeBranchId,
            timestamp: Date.now(),
            version,
            versionType,
            parentVersion,
          };
          updatedScene.planVersions = [
            ...(scene.planVersions ?? []),
            newVersion,
          ];
          // Auto-update version pointer to point to the new version
          newPlanVersion = version;
          delete updates.plan;
        }

        // Apply remaining updates (non-versioned fields like summary, events, deltas, etc.)
        updatedScene = { ...updatedScene, ...updates };

        // Sanitize if any delta/reference field was touched — UPDATE_SCENE can
        // update threadDeltas / worldDeltas / etc. directly (e.g. via review
        // pipelines), and those carry the same hallucination risk as freshly
        // generated scenes. Prose/plan/embedding-only updates skip sanitization.
        const touchesDeltas = Object.keys(action.updates).some((k) =>
          [
            "threadDeltas",
            "worldDeltas",
            "relationshipDeltas",
            "systemDeltas",
            "locationId",
            "povId",
            "participantIds",
          ].includes(k),
        );
        if (touchesDeltas) {
          sanitizeScenes([updatedScene], n, "UPDATE_SCENE");
        }

        // Update version pointers to point to newly created versions
        let updatedBranches = n.branches;
        if (state.viewState.activeBranchId && (newProseVersion || newPlanVersion)) {
          const currentBranch = n.branches[state.viewState.activeBranchId];
          if (currentBranch) {
            const currentPointers =
              currentBranch.versionPointers?.[action.sceneId] ?? {};
            const updatedPointers = {
              ...currentPointers,
              ...(newProseVersion ? { proseVersion: newProseVersion } : {}),
              ...(newPlanVersion ? { planVersion: newPlanVersion } : {}),
            };
            updatedBranches = {
              ...n.branches,
              [state.viewState.activeBranchId]: {
                ...currentBranch,
                versionPointers: {
                  ...currentBranch.versionPointers,
                  [action.sceneId]: updatedPointers,
                },
              },
            };
          }
        }

        return {
          ...n,
          scenes: { ...n.scenes, [action.sceneId]: updatedScene },
          branches: updatedBranches,
        };
      });

    case "DELETE_SCENE": {
      const newState = updateNarrative(state, (n) => {
        const { [action.sceneId]: _, ...restScenes } = n.scenes;
        const { [action.sceneId]: __, ...restWorldBuilds } = n.worldBuilds;
        const branch = n.branches[action.branchId];
        const updatedBranches = branch
          ? {
              ...n.branches,
              [action.branchId]: {
                ...branch,
                entryIds: branch.entryIds.filter((s) => s !== action.sceneId),
              },
            }
          : n.branches;
        const updatedArcs = Object.fromEntries(
          Object.entries(n.arcs).map(([id, arc]) => [
            id,
            {
              ...arc,
              sceneIds: arc.sceneIds.filter((s) => s !== action.sceneId),
            },
          ]),
        );
        return {
          ...n,
          scenes: restScenes,
          worldBuilds: restWorldBuilds,
          branches: updatedBranches,
          arcs: updatedArcs,
        };
      });
      if (newState.activeNarrative && newState.viewState.activeBranchId) {
        const resolved = getResolvedKeys(
          newState.activeNarrative,
          newState.viewState.activeBranchId,
        );
        return {
          ...newState,
          resolvedEntryKeys: resolved,
          viewState: {
            ...newState.viewState,
            currentSceneIndex: Math.min(
              newState.viewState.currentSceneIndex,
              resolved.length - 1,
            ),
          },
        };
      }
      return newState;
    }

    // ── CRUD: Branches ────────────────────────────────────────────────────
    case "CREATE_BRANCH": {
      const newState = updateNarrative(state, (n) => ({
        ...n,
        branches: { ...n.branches, [action.branch.id]: action.branch },
      }));
      if (newState.activeNarrative) {
        const resolved = getResolvedKeys(
          newState.activeNarrative,
          action.branch.id,
        );
        return {
          ...newState,
          resolvedEntryKeys: resolved,
          viewState: {
            ...newState.viewState,
            activeBranchId: action.branch.id,
            currentSceneIndex: resolved.length - 1,
          },
        };
      }
      return newState;
    }

    case "DELETE_BRANCH": {
      if (action.branchId === state.viewState.activeBranchId) return state;
      // Build full cascade set (branch + all child branches)
      const toDelete = new Set<string>();
      if (state.activeNarrative) {
        const queue = [action.branchId];
        while (queue.length > 0) {
          const id = queue.pop()!;
          toDelete.add(id);
          Object.values(state.activeNarrative.branches).forEach((b) => {
            if (b.parentBranchId === id) queue.push(b.id);
          });
        }
      }
      if (state.viewState.activeBranchId && toDelete.has(state.viewState.activeBranchId))
        return state;

      const result = updateNarrative(state, (n) => {
        const remaining = Object.fromEntries(
          Object.entries(n.branches).filter(([id]) => !toDelete.has(id)),
        );

        // Entries owned exclusively by deleted branches (not shared with survivors)
        const deletedEntries = new Set<string>();
        toDelete.forEach((bid) =>
          n.branches[bid]?.entryIds.forEach((eid) => deletedEntries.add(eid)),
        );
        const survivingEntries = new Set<string>();
        Object.values(remaining).forEach((b) =>
          b.entryIds.forEach((eid) => survivingEntries.add(eid)),
        );
        const entriesToRemove = new Set(
          [...deletedEntries].filter((eid) => !survivingEntries.has(eid)),
        );

        const scenes = Object.fromEntries(
          Object.entries(n.scenes).filter(([id]) => !entriesToRemove.has(id)),
        );
        const worldBuilds = Object.fromEntries(
          Object.entries(n.worldBuilds).filter(
            ([id]) => !entriesToRemove.has(id),
          ),
        );

        // Clean up arcs: remove deleted scene IDs, drop arcs that become empty
        const arcs = Object.fromEntries(
          Object.entries(n.arcs).flatMap(([id, arc]) => {
            const sceneIds = arc.sceneIds.filter(
              (sid) => !entriesToRemove.has(sid),
            );
            return sceneIds.length === 0 ? [] : [[id, { ...arc, sceneIds }]];
          }),
        );

        // Canon-branch upkeep — if the canon branch was deleted, clear
        // the explicit pointer so resolveCanonBranchId falls back to the
        // oldest surviving branch. Leaving a dangling id would mean the
        // resolver also falls back (it checks `branches[id]`), but
        // clearing it keeps the persisted state honest.
        const canonBranchId =
          n.canonBranchId && toDelete.has(n.canonBranchId) ? undefined : n.canonBranchId;

        return { ...n, branches: remaining, scenes, worldBuilds, arcs, canonBranchId };
      });

      if (result.activeNarrative && result.viewState.activeBranchId) {
        const resolved = getResolvedKeys(
          result.activeNarrative,
          result.viewState.activeBranchId,
        );
        const derived = withDerivedEntities(result.activeNarrative, resolved);
        return {
          ...result,
          activeNarrative: derived,
          resolvedEntryKeys: resolved,
        };
      }
      return result;
    }

    case "RENAME_BRANCH":
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: { ...branch, name: action.name },
          },
        };
      });

    case "SET_CANON_BRANCH":
      return updateNarrative(state, (n) => {
        if (!n.branches[action.branchId]) return n;
        return { ...n, canonBranchId: action.branchId };
      });

    case "CLEAR_SCENE_PROSE_VERSION":
    case "CLEAR_SCENE_PLAN_VERSION": {
      const isProse = action.type === "CLEAR_SCENE_PROSE_VERSION";
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        const branch = n.branches[action.branchId];
        if (!branch) return n;

        // Find the version currently resolved for this branch — either the
        // pinned pointer or the natural resolution. That is the version the
        // user sees and wants to clear.
        const versions = isProse ? scene.proseVersions ?? [] : scene.planVersions ?? [];
        const pointerVersion = isProse
          ? branch.versionPointers?.[scene.id]?.proseVersion
          : branch.versionPointers?.[scene.id]?.planVersion;
        const resolvedVersion = (() => {
          if (pointerVersion && versions.some(v => v.version === pointerVersion)) {
            return pointerVersion;
          }
          if (isProse) {
            const prose = resolveProseForBranch(scene, action.branchId, n.branches);
            const match = prose.prose !== undefined
              ? (scene.proseVersions ?? []).slice().sort((a, b) => b.timestamp - a.timestamp)
                  .find(v => v.prose === prose.prose)
              : undefined;
            return match?.version;
          } else {
            const plan = resolvePlanForBranch(scene, action.branchId, n.branches);
            const match = plan
              ? (scene.planVersions ?? []).slice().sort((a, b) => b.timestamp - a.timestamp)
                  .find(v => v.plan === plan)
              : undefined;
            return match?.version;
          }
        })();
        if (!resolvedVersion) return n;

        // Remove the resolved version from the scene's version array.
        const updatedVersions = versions.filter(v => v.version !== resolvedVersion);
        const updatedScene = isProse
          ? { ...scene, proseVersions: updatedVersions as typeof scene.proseVersions }
          : { ...scene, planVersions: updatedVersions as typeof scene.planVersions };

        // Clear the pointer if it was pinned to the removed version.
        const scenePointers = branch.versionPointers?.[scene.id];
        let updatedBranches = n.branches;
        if (scenePointers) {
          const pointerKey = isProse ? "proseVersion" : "planVersion";
          if (scenePointers[pointerKey] === resolvedVersion) {
            const { [pointerKey]: _removed, ...restScenePointers } = scenePointers;
            const restHasPointers = Object.keys(restScenePointers).length > 0;
            const { [scene.id]: _removedScene, ...otherScenePointers } = branch.versionPointers ?? {};
            const nextScenePointers = restHasPointers
              ? { ...otherScenePointers, [scene.id]: restScenePointers }
              : otherScenePointers;
            const nextPointers = Object.keys(nextScenePointers).length > 0 ? nextScenePointers : undefined;
            updatedBranches = {
              ...n.branches,
              [action.branchId]: { ...branch, versionPointers: nextPointers },
            };
          }
        }

        return {
          ...n,
          scenes: { ...n.scenes, [action.sceneId]: updatedScene },
          branches: updatedBranches,
        };
      });
    }

    case "SET_VERSION_POINTER":
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;

        const existingPointers = branch.versionPointers ?? {};
        const scenePointers = existingPointers[action.sceneId] ?? {};

        // Update or clear the pointer
        const updatedScenePointers =
          action.pointerType === "prose"
            ? { ...scenePointers, proseVersion: action.version }
            : { ...scenePointers, planVersion: action.version };

        // Clean up undefined values
        if (updatedScenePointers.proseVersion === undefined)
          delete updatedScenePointers.proseVersion;
        if (updatedScenePointers.planVersion === undefined)
          delete updatedScenePointers.planVersion;

        // Clean up empty scene pointers
        const updatedPointers = { ...existingPointers };
        if (Object.keys(updatedScenePointers).length === 0) {
          delete updatedPointers[action.sceneId];
        } else {
          updatedPointers[action.sceneId] = updatedScenePointers;
        }

        // Clean up empty versionPointers
        const updatedBranch = {
          ...branch,
          versionPointers:
            Object.keys(updatedPointers).length > 0
              ? updatedPointers
              : undefined,
        };

        return {
          ...n,
          branches: { ...n.branches, [action.branchId]: updatedBranch },
        };
      });

    case "REMOVE_BRANCH_ENTRY": {
      // Remove an entry from a branch's entryIds without deleting the scene itself.
      // Used when the scene is referenced by other branches.
      const newState = updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: {
              ...branch,
              entryIds: branch.entryIds.filter((id) => id !== action.entryId),
            },
          },
        };
      });
      if (newState.activeNarrative && newState.viewState.activeBranchId) {
        const resolved = getResolvedKeys(
          newState.activeNarrative,
          newState.viewState.activeBranchId,
        );
        const derived = withDerivedEntities(newState.activeNarrative, resolved);
        return {
          ...newState,
          activeNarrative: derived,
          resolvedEntryKeys: resolved,
        };
      }
      return newState;
    }

    case "SET_STRUCTURE_REVIEW":
      return updateNarrative(state, (n) => ({
        ...n,
        structureReviews: {
          ...n.structureReviews,
          [action.branchId]: action.evaluation,
        },
      }));

    case "SET_PROSE_EVALUATION":
      return updateNarrative(state, (n) => ({
        ...n,
        proseEvaluations: {
          ...n.proseEvaluations,
          [action.branchId]: action.evaluation,
        },
      }));

    case "SET_PLAN_EVALUATION":
      return updateNarrative(state, (n) => ({
        ...n,
        planEvaluations: {
          ...n.planEvaluations,
          [action.branchId]: action.evaluation,
        },
      }));

    case "SET_GAME_ANALYSIS":
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        return {
          ...n,
          scenes: {
            ...n.scenes,
            [action.sceneId]: { ...scene, gameAnalysis: action.analysis },
          },
        };
      });

    case "CLEAR_GAME_ANALYSIS":
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        const { gameAnalysis: _removed, ...rest } = scene;
        return {
          ...n,
          scenes: { ...n.scenes, [action.sceneId]: rest },
        };
      });

    case "RECONSTRUCT_BRANCH": {
      return updateNarrative(state, (n) => {
        sanitizeScenes(action.scenes, n, 'RECONSTRUCT_BRANCH');
        const newScenes = { ...n.scenes };
        for (const scene of action.scenes) newScenes[scene.id] = scene;
        // Merge arcs: for existing arcs, append new sceneIds without removing originals.
        // This prevents reconstruction from mutating arcs shared by the parent branch.
        const newArcs = { ...n.arcs };
        for (const [arcId, arc] of Object.entries(action.arcs)) {
          const existing = newArcs[arcId];
          if (!existing) {
            newArcs[arcId] = arc;
          } else {
            // Merge: keep original sceneIds and add any new ones from reconstruction
            const merged = new Set([...existing.sceneIds, ...arc.sceneIds]);
            newArcs[arcId] = { ...existing, sceneIds: [...merged] };
          }
        }
        return { ...n, scenes: newScenes, arcs: newArcs };
      });
    }

    // ── Bulk: AI-generated scenes ─────────────────────────────────────────
    case "BULK_ADD_SCENES": {
      const newState = updateNarrative(state, (n) => {
        // Defense-in-depth — any scene reaching the reducer gets its IDs
        // validated against the current narrative. generateScenes already
        // sanitizes, but reconstruct / imports / future ingestion paths
        // don't always. Mutates action.scenes in place; the action is
        // single-use so this is safe.
        sanitizeScenes(action.scenes, n, 'BULK_ADD_SCENES');
        const newScenes = { ...n.scenes };
        for (const scene of action.scenes) {
          newScenes[scene.id] = scene;
        }

        const newSceneIds = action.scenes.map((s) => s.id);
        const updatedArcs = { ...n.arcs };
        if (!updatedArcs[action.arc.id]) {
          updatedArcs[action.arc.id] = action.arc;
        } else {
          const existing = updatedArcs[action.arc.id];
          const existingSet = new Set(existing.sceneIds);
          const deduped = newSceneIds.filter((id) => !existingSet.has(id));
          updatedArcs[action.arc.id] = {
            ...existing,
            sceneIds: [...existing.sceneIds, ...deduped],
          };
        }
        const branch = n.branches[action.branchId];
        const existingEntrySet = branch
          ? new Set(branch.entryIds)
          : new Set<string>();
        const dedupedEntries = newSceneIds.filter(
          (id) => !existingEntrySet.has(id),
        );

        const updatedBranch = branch
          ? { ...branch, entryIds: [...branch.entryIds, ...dedupedEntries] }
          : null;

        const updatedBranches = updatedBranch
          ? { ...n.branches, [action.branchId]: updatedBranch }
          : n.branches;
        return {
          ...n,
          scenes: newScenes,
          arcs: updatedArcs,
          branches: updatedBranches,
        };
      });
      if (newState.activeNarrative && newState.viewState.activeBranchId) {
        const resolved = getResolvedKeys(
          newState.activeNarrative,
          newState.viewState.activeBranchId,
        );
        const derived = withDerivedEntities(newState.activeNarrative, resolved);
        return {
          ...newState,
          activeNarrative: derived,
          resolvedEntryKeys: resolved,
        };
      }
      return newState;
    }

    // ── Expand World: merge new elements + create world build ─────
    case "EXPAND_WORLD": {
      const worldBuildId = action.worldBuildId;

      // Build summary from expansion contents — terse counts only
      const charCount = action.characters.length;
      const locCount = action.locations.length;
      const threadCount = action.threads.length;
      const artifactCount = action.artifacts.length;
      const relCount = action.relationshipDeltas?.length ?? 0;
      const wkNodeCount = action.systemDeltas?.addedNodes?.length ?? 0;
      const wkEdgeCount = action.systemDeltas?.addedEdges?.length ?? 0;
      const parts: string[] = [];
      if (charCount > 0) parts.push(`${charCount} character${charCount > 1 ? "s" : ""}`);
      if (locCount > 0) parts.push(`${locCount} location${locCount > 1 ? "s" : ""}`);
      if (threadCount > 0) parts.push(`${threadCount} thread${threadCount > 1 ? "s" : ""}`);
      if (artifactCount > 0) parts.push(`${artifactCount} artifact${artifactCount > 1 ? "s" : ""}`);
      if (relCount > 0) parts.push(`${relCount} relationship${relCount > 1 ? "s" : ""}`);
      if (wkNodeCount > 0) parts.push(`${wkNodeCount} knowledge node${wkNodeCount > 1 ? "s" : ""}`);
      if (wkEdgeCount > 0) parts.push(`${wkEdgeCount} knowledge edge${wkEdgeCount > 1 ? "s" : ""}`);
      // Prefer the AI-generated intent summary — it tells downstream arc
      // generation what creative space this expansion opens. Fall back to a
      // derived count string when the model didn't supply one.
      const derivedSummary =
        parts.length > 0
          ? `World expanded: ${parts.join(", ")}`
          : "World expansion (no new elements)";
      const worldBuildSummary = action.summary?.trim() || derivedSummary;

      // Build manifest systemGraph: explicit deltas + auto-generated nodes for threads/locations
      const autoNodes: SystemDelta["addedNodes"] = [];
      let autoCounter = 0;
      for (const t of action.threads) {
        const covered = (action.systemDeltas?.addedNodes ?? []).some(
          (nd) => nd.concept === t.description,
        );
        if (!covered)
          autoNodes.push({
            id: `${worldBuildId}-T${++autoCounter}`,
            concept: t.description,
            type: "concept" as const,
          });
      }
      for (const l of action.locations) {
        const covered = (action.systemDeltas?.addedNodes ?? []).some(
          (nd) => nd.concept === l.name,
        );
        if (!covered)
          autoNodes.push({
            id: `${worldBuildId}-L${++autoCounter}`,
            concept: l.name,
            type: "concept" as const,
          });
      }
      const manifestSystem: SystemDelta = {
        addedNodes: [
          ...(action.systemDeltas?.addedNodes ?? []),
          ...autoNodes,
        ],
        addedEdges: action.systemDeltas?.addedEdges ?? [],
      };

      const worldBuild: WorldBuild = {
        kind: "world_build",
        id: worldBuildId,
        createdAt: new Date().toISOString(),
        summary: worldBuildSummary,
        expansionManifest: {
          newCharacters: action.characters,
          newLocations: action.locations,
          newArtifacts: action.artifacts,
          newThreads: action.threads.map((t) => ({
            ...t,
            openedAt: worldBuildId,
          })),
          threadDeltas: action.threadDeltas,
          worldDeltas: action.worldDeltas,
          systemDeltas: manifestSystem,
          relationshipDeltas: action.relationshipDeltas,
          ownershipDeltas: action.ownershipDeltas,
          tieDeltas: action.tieDeltas,
          attributions: action.attributions,
          attributionEdges: action.attributionEdges,
        },
        reasoningGraph: action.reasoningGraph,
      };

      const newState = updateNarrative(state, (n) => {
        // Idempotent: skip if this world build was already applied
        if (n.worldBuilds[worldBuildId]) return n;

        const branch = n.branches[action.branchId];
        const updatedBranches = branch
          ? {
              ...n.branches,
              [action.branchId]: {
                ...branch,
                entryIds: [...branch.entryIds, worldBuildId],
              },
            }
          : n.branches;

        return {
          ...n,
          worldBuilds: { ...n.worldBuilds, [worldBuildId]: worldBuild },
          branches: updatedBranches,
        };
      });

      if (newState.activeNarrative && newState.viewState.activeBranchId) {
        const resolved = getResolvedKeys(
          newState.activeNarrative,
          newState.viewState.activeBranchId,
        );
        const derived = withDerivedEntities(newState.activeNarrative, resolved);
        return {
          ...newState,
          activeNarrative: derived,
          resolvedEntryKeys: resolved,
        };
      }
      return newState;
    }

    // ── Auto mode ──────────────────────────────────────────────────────────
    case "SET_AUTO_CONFIG":
      return { ...state, autoConfig: action.config };

    case "START_AUTO_RUN":
      return {
        ...state,
        viewState: {
          ...state.viewState,
          autoRunState: {
            isRunning: true,
            currentCycle: 0,
            consecutiveFailures: 0,
            statusMessage: "Starting...",
            totalScenesGenerated: 0,
            totalWorldExpansions: 0,
            startingSceneCount: state.resolvedEntryKeys.length,
            startingArcCount: state.activeNarrative
              ? Object.keys(state.activeNarrative.arcs).length
              : 0,
            streamText: "",
          },
        },
      };

    case "RESET_AUTO_STREAM":
      return state.viewState.autoRunState
        ? {
            ...state,
            viewState: {
              ...state.viewState,
              autoRunState: { ...state.viewState.autoRunState, streamText: "" },
            },
          }
        : state;

    case "APPEND_AUTO_STREAM":
      return state.viewState.autoRunState
        ? {
            ...state,
            viewState: {
              ...state.viewState,
              autoRunState: {
                ...state.viewState.autoRunState,
                streamText: state.viewState.autoRunState.streamText + action.chunk,
              },
            },
          }
        : state;

    case "STOP_AUTO_RUN":
      return { ...state, viewState: { ...state.viewState, autoRunState: null } };

    case "SET_AUTO_STATUS":
      return state.viewState.autoRunState
        ? {
            ...state,
            viewState: {
              ...state.viewState,
              autoRunState: {
                ...state.viewState.autoRunState,
                statusMessage: action.message,
              },
            },
          }
        : state;

    case "TICK_AUTO_RUN":
      return state.viewState.autoRunState
        ? {
            ...state,
            viewState: {
              ...state.viewState,
              autoRunState: {
                ...state.viewState.autoRunState,
                currentCycle: state.viewState.autoRunState.currentCycle + 1,
                consecutiveFailures: action.hasError
                  ? state.viewState.autoRunState.consecutiveFailures + 1
                  : 0,
                totalScenesGenerated:
                  state.viewState.autoRunState.totalScenesGenerated +
                  action.scenesGenerated,
                totalWorldExpansions:
                  state.viewState.autoRunState.totalWorldExpansions +
                  (action.worldExpanded ? 1 : 0),
              },
            },
          }
        : state;

    case "SET_COVER_IMAGE": {
      // Update the narrative entry in the list
      const updatedNarratives = state.narratives.map((e) =>
        e.id === action.narrativeId
          ? { ...e, coverImageUrl: action.imageUrl }
          : e,
      );
      // If this is the active narrative, update it too
      if (
        state.activeNarrative &&
        state.activeNarrative.id === action.narrativeId
      ) {
        const updatedActive = {
          ...state.activeNarrative,
          coverImageUrl: action.imageUrl,
        };
        return {
          ...state,
          narratives: updatedNarratives,
          activeNarrative: updatedActive,
        };
      }
      // For non-active narratives, persist directly
      loadNarrative(action.narrativeId)
        .then((stored) => {
          if (stored)
            persistNarrative({ ...stored, coverImageUrl: action.imageUrl });
        })
        .catch((err) => {
          logError("Failed to update cover image in storage", err, {
            source: "other",
            operation: "update-cover-image",
            details: { narrativeId: action.narrativeId },
          });
        });
      return { ...state, narratives: updatedNarratives };
    }

    case "UPDATE_NARRATIVE_META": {
      const metaUpdates: Partial<{ title: string; description: string }> = {};
      if (action.title !== undefined) metaUpdates.title = action.title;
      if (action.description !== undefined)
        metaUpdates.description = action.description;
      const updatedNarratives = state.narratives.map((e) =>
        e.id === action.narrativeId ? { ...e, ...metaUpdates } : e,
      );
      if (
        state.activeNarrative &&
        state.activeNarrative.id === action.narrativeId
      ) {
        const updatedActive = { ...state.activeNarrative, ...metaUpdates };
        return {
          ...state,
          narratives: updatedNarratives,
          activeNarrative: updatedActive,
        };
      }
      loadNarrative(action.narrativeId)
        .then((stored) => {
          if (stored) persistNarrative({ ...stored, ...metaUpdates });
        })
        .catch((err) => {
          logError("Failed to update narrative metadata in storage", err, {
            source: "other",
            operation: "update-narrative-meta",
            details: { narrativeId: action.narrativeId },
          });
        });
      return { ...state, narratives: updatedNarratives };
    }

    case "SET_SCENE_AUDIO":
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        return {
          ...n,
          scenes: {
            ...n.scenes,
            [action.sceneId]: { ...scene, audioUrl: action.audioUrl },
          },
        };
      });

    case "CLEAR_SCENE_AUDIO":
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        const { audioUrl: _, ...rest } = scene;
        return { ...n, scenes: { ...n.scenes, [action.sceneId]: rest } };
      });

    case "SET_CHARACTER_IMAGE": {
      const afterUpdate = updateNarrative(state, (n) => {
        // Update EVERY manifest that introduces this character — worldBuild
        // expansion manifests AND scene newCharacters arrays. The derive step
        // uses "first entry wins" (`if (!characters[id])`) when iterating
        // resolvedKeys, so if we updated only one manifest and the derive
        // picks a different one, the imageUrl would be silently dropped.
        // Updating all is idempotent and makes the update robust against
        // entry-order differences between scenes and worldBuilds.
        let anyMatched = false;
        const worldBuilds: typeof n.worldBuilds = {};
        for (const [wbId, wb] of Object.entries(n.worldBuilds)) {
          if (wb.expansionManifest.newCharacters.some((c) => c.id === action.characterId)) {
            anyMatched = true;
            worldBuilds[wbId] = {
              ...wb,
              expansionManifest: {
                ...wb.expansionManifest,
                newCharacters: wb.expansionManifest.newCharacters.map((c) =>
                  c.id === action.characterId ? { ...c, imageUrl: action.imageUrl } : c,
                ),
              },
            };
          } else {
            worldBuilds[wbId] = wb;
          }
        }
        const scenes: typeof n.scenes = {};
        for (const [sId, s] of Object.entries(n.scenes)) {
          if ((s.newCharacters ?? []).some((c) => c.id === action.characterId)) {
            anyMatched = true;
            scenes[sId] = {
              ...s,
              newCharacters: (s.newCharacters ?? []).map((c) =>
                c.id === action.characterId ? { ...c, imageUrl: action.imageUrl } : c,
              ),
            };
          } else {
            scenes[sId] = s;
          }
        }
        if (!anyMatched) {
          console.warn(
            `[SET_CHARACTER_IMAGE] Character ${action.characterId} not found in any worldBuild or scene manifest — image update dropped`,
          );
          return n;
        }
        return { ...n, worldBuilds, scenes };
      });
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const derived = withDerivedEntities(
        afterUpdate.activeNarrative,
        afterUpdate.resolvedEntryKeys,
      );
      return { ...afterUpdate, activeNarrative: derived };
    }

    case "SET_LOCATION_IMAGE": {
      const afterUpdate = updateNarrative(state, (n) => {
        // Update EVERY manifest that introduces this location (see
        // SET_CHARACTER_IMAGE for rationale).
        let anyMatched = false;
        const worldBuilds: typeof n.worldBuilds = {};
        for (const [wbId, wb] of Object.entries(n.worldBuilds)) {
          if (wb.expansionManifest.newLocations.some((l) => l.id === action.locationId)) {
            anyMatched = true;
            worldBuilds[wbId] = {
              ...wb,
              expansionManifest: {
                ...wb.expansionManifest,
                newLocations: wb.expansionManifest.newLocations.map((l) =>
                  l.id === action.locationId ? { ...l, imageUrl: action.imageUrl } : l,
                ),
              },
            };
          } else {
            worldBuilds[wbId] = wb;
          }
        }
        const scenes: typeof n.scenes = {};
        for (const [sId, s] of Object.entries(n.scenes)) {
          if ((s.newLocations ?? []).some((l) => l.id === action.locationId)) {
            anyMatched = true;
            scenes[sId] = {
              ...s,
              newLocations: (s.newLocations ?? []).map((l) =>
                l.id === action.locationId ? { ...l, imageUrl: action.imageUrl } : l,
              ),
            };
          } else {
            scenes[sId] = s;
          }
        }
        if (!anyMatched) {
          console.warn(
            `[SET_LOCATION_IMAGE] Location ${action.locationId} not found in any worldBuild or scene manifest — image update dropped`,
          );
          return n;
        }
        return { ...n, worldBuilds, scenes };
      });
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const derived = withDerivedEntities(
        afterUpdate.activeNarrative,
        afterUpdate.resolvedEntryKeys,
      );
      return { ...afterUpdate, activeNarrative: derived };
    }

    case "SET_ARTIFACT_IMAGE": {
      const afterUpdate = updateNarrative(state, (n) => {
        // Update EVERY manifest that introduces this artifact (see
        // SET_CHARACTER_IMAGE for rationale).
        let anyMatched = false;
        const worldBuilds: typeof n.worldBuilds = {};
        for (const [wbId, wb] of Object.entries(n.worldBuilds)) {
          if ((wb.expansionManifest.newArtifacts ?? []).some((a) => a.id === action.artifactId)) {
            anyMatched = true;
            worldBuilds[wbId] = {
              ...wb,
              expansionManifest: {
                ...wb.expansionManifest,
                newArtifacts: (wb.expansionManifest.newArtifacts ?? []).map((a) =>
                  a.id === action.artifactId ? { ...a, imageUrl: action.imageUrl } : a,
                ),
              },
            };
          } else {
            worldBuilds[wbId] = wb;
          }
        }
        const scenes: typeof n.scenes = {};
        for (const [sId, s] of Object.entries(n.scenes)) {
          if ((s.newArtifacts ?? []).some((a) => a.id === action.artifactId)) {
            anyMatched = true;
            scenes[sId] = {
              ...s,
              newArtifacts: (s.newArtifacts ?? []).map((a) =>
                a.id === action.artifactId ? { ...a, imageUrl: action.imageUrl } : a,
              ),
            };
          } else {
            scenes[sId] = s;
          }
        }
        if (!anyMatched) {
          console.warn(
            `[SET_ARTIFACT_IMAGE] Artifact ${action.artifactId} not found in any worldBuild or scene manifest — image update dropped`,
          );
          return n;
        }
        return { ...n, worldBuilds, scenes };
      });
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const derived = withDerivedEntities(
        afterUpdate.activeNarrative,
        afterUpdate.resolvedEntryKeys,
      );
      return { ...afterUpdate, activeNarrative: derived };
    }

    case "SET_CHARACTER_IMAGE_PROMPT": {
      const afterUpdate = updateNarrative(state, (n) => {
        const worldBuildEntry = Object.values(n.worldBuilds).find((wb) =>
          wb.expansionManifest.newCharacters.some(
            (c) => c.id === action.characterId,
          ),
        );
        if (worldBuildEntry) {
          return {
            ...n,
            worldBuilds: {
              ...n.worldBuilds,
              [worldBuildEntry.id]: {
                ...worldBuildEntry,
                expansionManifest: {
                  ...worldBuildEntry.expansionManifest,
                  newCharacters: worldBuildEntry.expansionManifest.newCharacters.map(
                    (c) =>
                      c.id === action.characterId
                        ? { ...c, imagePrompt: action.imagePrompt }
                        : c,
                  ),
                },
              },
            },
          };
        }
        const sceneEntry = Object.values(n.scenes).find((s) =>
          (s.newCharacters ?? []).some((c) => c.id === action.characterId),
        );
        if (sceneEntry) {
          return {
            ...n,
            scenes: {
              ...n.scenes,
              [sceneEntry.id]: {
                ...sceneEntry,
                newCharacters: (sceneEntry.newCharacters ?? []).map((c) =>
                  c.id === action.characterId
                    ? { ...c, imagePrompt: action.imagePrompt }
                    : c,
                ),
              },
            },
          };
        }
        console.warn(
          `[SET_CHARACTER_IMAGE_PROMPT] Character ${action.characterId} not found in any worldBuild or scene manifest — prompt update dropped`,
        );
        return n;
      });
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const derived = withDerivedEntities(
        afterUpdate.activeNarrative,
        afterUpdate.resolvedEntryKeys,
      );
      return { ...afterUpdate, activeNarrative: derived };
    }

    case "SET_LOCATION_IMAGE_PROMPT": {
      const afterUpdate = updateNarrative(state, (n) => {
        const worldBuildEntry = Object.values(n.worldBuilds).find((wb) =>
          wb.expansionManifest.newLocations.some(
            (l) => l.id === action.locationId,
          ),
        );
        if (worldBuildEntry) {
          return {
            ...n,
            worldBuilds: {
              ...n.worldBuilds,
              [worldBuildEntry.id]: {
                ...worldBuildEntry,
                expansionManifest: {
                  ...worldBuildEntry.expansionManifest,
                  newLocations: worldBuildEntry.expansionManifest.newLocations.map(
                    (l) =>
                      l.id === action.locationId
                        ? { ...l, imagePrompt: action.imagePrompt }
                        : l,
                  ),
                },
              },
            },
          };
        }
        const sceneEntry = Object.values(n.scenes).find((s) =>
          (s.newLocations ?? []).some((l) => l.id === action.locationId),
        );
        if (sceneEntry) {
          return {
            ...n,
            scenes: {
              ...n.scenes,
              [sceneEntry.id]: {
                ...sceneEntry,
                newLocations: (sceneEntry.newLocations ?? []).map((l) =>
                  l.id === action.locationId
                    ? { ...l, imagePrompt: action.imagePrompt }
                    : l,
                ),
              },
            },
          };
        }
        console.warn(
          `[SET_LOCATION_IMAGE_PROMPT] Location ${action.locationId} not found in any worldBuild or scene manifest — prompt update dropped`,
        );
        return n;
      });
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const derived = withDerivedEntities(
        afterUpdate.activeNarrative,
        afterUpdate.resolvedEntryKeys,
      );
      return { ...afterUpdate, activeNarrative: derived };
    }

    case "REBUILD_LOCATION_HIERARCHY": {
      // Re-parent locations to reshape the map tree. Locations are DERIVED from
      // the source manifests (worldBuilds / scene newLocations), so patch
      // parentId at the source then re-derive. `parents` maps locationId →
      // parentId|null; ids absent from the map keep their current parent.
      const { parents } = action;
      const patch = (l: Location): Location =>
        Object.prototype.hasOwnProperty.call(parents, l.id)
          ? { ...l, parentId: parents[l.id] }
          : l;
      const afterUpdate = updateNarrative(state, (n) => ({
        ...n,
        worldBuilds: Object.fromEntries(
          Object.entries(n.worldBuilds).map(([k, wb]) => [
            k,
            {
              ...wb,
              expansionManifest: {
                ...wb.expansionManifest,
                newLocations: wb.expansionManifest.newLocations.map(patch),
              },
            },
          ]),
        ),
        scenes: Object.fromEntries(
          Object.entries(n.scenes).map(([k, s]) => [
            k,
            { ...s, newLocations: (s.newLocations ?? []).map(patch) },
          ]),
        ),
      }));
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const rederived = withDerivedEntities(
        afterUpdate.activeNarrative,
        afterUpdate.resolvedEntryKeys,
      );
      return { ...afterUpdate, activeNarrative: rederived };
    }

    case "SET_ARTIFACT_IMAGE_PROMPT": {
      const afterUpdate = updateNarrative(state, (n) => {
        const worldBuildEntry = Object.values(n.worldBuilds).find((wb) =>
          (wb.expansionManifest.newArtifacts ?? []).some(
            (a) => a.id === action.artifactId,
          ),
        );
        if (worldBuildEntry) {
          return {
            ...n,
            worldBuilds: {
              ...n.worldBuilds,
              [worldBuildEntry.id]: {
                ...worldBuildEntry,
                expansionManifest: {
                  ...worldBuildEntry.expansionManifest,
                  newArtifacts: (
                    worldBuildEntry.expansionManifest.newArtifacts ?? []
                  ).map((a) =>
                    a.id === action.artifactId
                      ? { ...a, imagePrompt: action.imagePrompt }
                      : a,
                  ),
                },
              },
            },
          };
        }
        const sceneEntry = Object.values(n.scenes).find((s) =>
          (s.newArtifacts ?? []).some((a) => a.id === action.artifactId),
        );
        if (sceneEntry) {
          return {
            ...n,
            scenes: {
              ...n.scenes,
              [sceneEntry.id]: {
                ...sceneEntry,
                newArtifacts: (sceneEntry.newArtifacts ?? []).map((a) =>
                  a.id === action.artifactId
                    ? { ...a, imagePrompt: action.imagePrompt }
                    : a,
                ),
              },
            },
          };
        }
        console.warn(
          `[SET_ARTIFACT_IMAGE_PROMPT] Artifact ${action.artifactId} not found in any worldBuild or scene manifest — prompt update dropped`,
        );
        return n;
      });
      if (!afterUpdate.activeNarrative) return afterUpdate;
      const derived = withDerivedEntities(
        afterUpdate.activeNarrative,
        afterUpdate.resolvedEntryKeys,
      );
      return { ...afterUpdate, activeNarrative: derived };
    }

    case "SET_IMAGE_STYLE":
      return updateNarrative(state, (n) => ({
        ...n,
        imageStyle: action.style,
      }));

    case "SET_STORY_SETTINGS":
      return updateNarrative(state, (n) => ({
        ...n,
        storySettings: action.settings,
      }));

    case "SET_PROSE_PROFILE":
      return updateNarrative(state, (n) => ({
        ...n,
        proseProfile: action.profile,
      }));

    case "ADD_SAVED_PROSE_PROFILE":
      return updateNarrative(state, (n) => ({
        ...n,
        savedProseProfiles: [...(n.savedProseProfiles ?? []), action.saved],
      }));

    case "RENAME_SAVED_PROSE_PROFILE":
      return updateNarrative(state, (n) => ({
        ...n,
        savedProseProfiles: (n.savedProseProfiles ?? []).map((s) =>
          s.id === action.id ? { ...s, name: action.name } : s
        ),
      }));

    case "UPDATE_SAVED_PROSE_PROFILE":
      return updateNarrative(state, (n) => ({
        ...n,
        savedProseProfiles: (n.savedProseProfiles ?? []).map((s) =>
          s.id === action.id ? { ...s, profile: action.profile } : s
        ),
      }));

    case "DELETE_SAVED_PROSE_PROFILE":
      return updateNarrative(state, (n) => ({
        ...n,
        savedProseProfiles: (n.savedProseProfiles ?? []).filter((s) => s.id !== action.id),
      }));

    case "SET_PATTERNS":
      return updateNarrative(state, (n) => ({
        ...n,
        patterns: action.patterns,
      }));

    case "SET_ANTI_PATTERNS":
      return updateNarrative(state, (n) => ({
        ...n,
        antiPatterns: action.antiPatterns,
      }));

    case "ADD_PHASE_GRAPH":
      return updateNarrative(state, (n) => ({
        ...n,
        modes: { ...(n.modes ?? {}), [action.graph.id]: action.graph },
        currentModeId: action.graph.id,
      }));

    case "SET_CURRENT_PHASE_GRAPH":
      return updateNarrative(state, (n) => ({
        ...n,
        currentModeId: action.modeId ?? undefined,
      }));

    case "RENAME_PHASE_GRAPH":
      return updateNarrative(state, (n) => {
        const graph = n.modes?.[action.modeId];
        if (!graph) return n;
        return {
          ...n,
          modes: {
            ...n.modes,
            [action.modeId]: { ...graph, name: action.name },
          },
        };
      });

    case "DELETE_PHASE_GRAPH":
      return updateNarrative(state, (n) => {
        const next = { ...(n.modes ?? {}) };
        delete next[action.modeId];
        return {
          ...n,
          modes: next,
          currentModeId:
            n.currentModeId === action.modeId ? undefined : n.currentModeId,
        };
      });

    case "SET_GENRE":
      return updateNarrative(state, (n) => ({
        ...n,
        genre: action.genre,
      }));

    case "SET_SUBGENRE":
      return updateNarrative(state, (n) => ({
        ...n,
        subgenre: action.subgenre,
      }));

    case "SET_DETECTED_PATTERNS":
      return updateNarrative(state, (n) => ({
        ...n,
        ...(action.paradigm !== undefined ? { paradigm: action.paradigm } : {}),
        genre: action.genre,
        subgenre: action.subgenre,
        patterns: action.patterns,
        antiPatterns: action.antiPatterns,
      }));

    // ── Analysis ──────────────────────────────────────────────────────────
    case "ADD_ANALYSIS_JOB":
      return { ...state, analysisJobs: [...state.analysisJobs, action.job] };

    case "UPDATE_ANALYSIS_JOB":
      return {
        ...state,
        analysisJobs: state.analysisJobs.map((j) =>
          j.id === action.id
            ? { ...j, ...action.updates, updatedAt: Date.now() }
            : j,
        ),
      };

    case "DELETE_ANALYSIS_JOB":
      return {
        ...state,
        analysisJobs: state.analysisJobs.filter((j) => j.id !== action.id),
      };

    case "HYDRATE_ANALYSIS_JOBS": {
      // Merge: keep any in-memory jobs created before hydration completed (race condition guard)
      const hydratedIds = new Set(action.jobs.map((j) => j.id));
      const inMemoryOnly = state.analysisJobs.filter(
        (j) => !hydratedIds.has(j.id),
      );
      return { ...state, analysisJobs: [...action.jobs, ...inMemoryOnly] };
    }

    // ── Source files ─────────────────────────────────────────────────────
    // World-scoped corpus records. ADD stages a new file; UPDATE walks
    // the file through its lifecycle (status / extractedRef / commit /
    // error). DELETE removes both the SourceFile and its asset bodies —
    // callers are expected to assetManager.deleteText first.

    case "ADD_SOURCE_FILE":
      return updateActiveNarrativeIfMatch(state, action.narrativeId, (n) => ({
        ...n,
        files: { ...(n.files ?? {}), [action.file.id]: action.file },
      }));

    case "UPDATE_SOURCE_FILE":
      return updateActiveNarrativeIfMatch(state, action.narrativeId, (n) => {
        const existing = n.files?.[action.fileId];
        if (!existing) return n;
        return {
          ...n,
          files: { ...n.files, [action.fileId]: { ...existing, ...action.updates } },
        };
      });

    case "DELETE_SOURCE_FILE":
      return updateActiveNarrativeIfMatch(state, action.narrativeId, (n) => {
        if (!n.files?.[action.fileId]) return n;
        const next = { ...n.files };
        delete next[action.fileId];
        return { ...n, files: next };
      });

    case "APPLY_EXTENSION": {
      const merged = updateActiveNarrativeIfMatch(state, action.narrativeId, (n) => {
        // Merge entity dicts. The slice's ids are pre-remapped so a
        // plain spread does the right thing — name-deduped entities were
        // dropped upstream, so no entry here will clobber an existing one.
        const characters = { ...n.characters };
        for (const c of action.characters) characters[c.id] = c;
        const locations = { ...n.locations };
        for (const l of action.locations) locations[l.id] = l;
        const artifacts = { ...(n.artifacts ?? {}) };
        for (const a of action.artifacts) artifacts[a.id] = a;
        const threads = { ...n.threads };
        for (const t of action.threads) threads[t.id] = t;
        // Phase III.b — expand existing threads with outcome and
        // participant contributions from merged slice threads. The
        // expansion records were computed in claimSliceIds; here we
        // just append, deduped against current state (a no-op
        // expansion is fine — the merged thread had nothing new to
        // contribute).
        for (const expansion of action.threadExpansions ?? []) {
          const target = threads[expansion.existingThreadId];
          if (!target) continue;
          const seenOutcomes = new Set(target.outcomes.map((o) => o.toLowerCase()));
          const nextOutcomes = [...target.outcomes];
          for (const o of expansion.addOutcomes) {
            const key = o.trim().toLowerCase();
            if (!key || seenOutcomes.has(key)) continue;
            seenOutcomes.add(key);
            nextOutcomes.push(o.trim());
          }
          const seenParticipantIds = new Set(target.participants.map((p) => p.id));
          const nextParticipants = [...target.participants];
          for (const p of expansion.addParticipants) {
            if (seenParticipantIds.has(p.id)) continue;
            seenParticipantIds.add(p.id);
            nextParticipants.push(p);
          }
          if (
            nextOutcomes.length === target.outcomes.length &&
            nextParticipants.length === target.participants.length
          ) {
            continue;
          }
          threads[expansion.existingThreadId] = {
            ...target,
            outcomes: nextOutcomes,
            participants: nextParticipants,
          };
        }
        const scenes = { ...n.scenes };
        for (const s of action.scenes) scenes[s.id] = s;
        const worldBuilds = { ...(n.worldBuilds ?? {}) };
        for (const wb of action.worldBuilds) worldBuilds[wb.id] = wb;
        const arcs = { ...n.arcs };
        for (const a of action.arcs) arcs[a.id] = a;

        // Append the slice's entry ids at the tail of the chosen branch.
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        const branches = {
          ...n.branches,
          [action.branchId]: {
            ...branch,
            entryIds: [...branch.entryIds, ...action.appendEntryIds],
          },
        };

        return {
          ...n,
          characters,
          locations,
          artifacts,
          threads,
          scenes,
          worldBuilds,
          arcs,
          branches,
        };
      });

      // Refresh the derived resolvedEntryKeys cache when the appended-to
      // branch is the active one — otherwise the canvas keeps reading the
      // pre-append entry sequence until the operator switches branches
      // and back, which forces a recompute via SET_ACTIVE_BRANCH.
      if (
        merged.activeNarrative?.id === action.narrativeId &&
        merged.viewState.activeBranchId === action.branchId
      ) {
        const resolved = getResolvedKeys(merged.activeNarrative, merged.viewState.activeBranchId);
        return { ...merged, resolvedEntryKeys: resolved };
      }
      return merged;
    }

    // ── Chat threads ──────────────────────────────────────────────────────
    case "CREATE_CHAT_THREAD": {
      const withThread = updateNarrative(state, (n) => ({
        ...n,
        chatThreads: {
          ...(n.chatThreads ?? {}),
          [action.thread.id]: action.thread,
        },
      }));
      return { ...withThread, viewState: { ...withThread.viewState, activeChatThreadId: action.thread.id } };
    }

    case "DELETE_CHAT_THREAD": {
      const withoutThread = updateNarrative(state, (n) => {
        const { [action.threadId]: _, ...rest } = n.chatThreads ?? {};
        return { ...n, chatThreads: rest };
      });
      let nextActive = state.viewState.activeChatThreadId;
      if (state.viewState.activeChatThreadId === action.threadId) {
        const remaining = Object.values(
          withoutThread.activeNarrative?.chatThreads ?? {},
        );
        remaining.sort((a, b) => b.updatedAt - a.updatedAt);
        nextActive = remaining[0]?.id ?? null;
      }
      return { ...withoutThread, viewState: { ...withoutThread.viewState, activeChatThreadId: nextActive } };
    }

    case "RENAME_CHAT_THREAD":
      return updateNarrative(state, (n) => {
        const thread = n.chatThreads?.[action.threadId];
        if (!thread) return n;
        return {
          ...n,
          chatThreads: {
            ...(n.chatThreads ?? {}),
            [action.threadId]: { ...thread, name: action.name },
          },
        };
      });

    case "SET_ACTIVE_CHAT_THREAD":
      return { ...state, viewState: { ...state.viewState, activeChatThreadId: action.threadId } };

    case "UPSERT_CHAT_THREAD":
      return updateNarrative(state, (n) => {
        const thread = (n.chatThreads ?? {})[action.threadId];
        if (!thread) return n;
        return {
          ...n,
          chatThreads: {
            ...(n.chatThreads ?? {}),
            [action.threadId]: {
              ...thread,
              messages: action.messages,
              ...(action.name ? { name: action.name } : {}),
              updatedAt: Date.now(),
            },
          },
        };
      });

    // ── Branch Chat threads ───────────────────────────────────────────────
    case "CREATE_BRANCH_CHAT_THREAD": {
      const withThread = updateNarrative(state, (n) => ({
        ...n,
        branchChatThreads: {
          ...(n.branchChatThreads ?? {}),
          [action.thread.id]: action.thread,
        },
      }));
      return {
        ...withThread,
        viewState: { ...withThread.viewState, activeBranchChatThreadId: action.thread.id },
      };
    }

    case "DELETE_BRANCH_CHAT_THREAD": {
      const withoutThread = updateNarrative(state, (n) => {
        const { [action.threadId]: _, ...rest } = n.branchChatThreads ?? {};
        return { ...n, branchChatThreads: rest };
      });
      let nextActive = state.viewState.activeBranchChatThreadId;
      if (state.viewState.activeBranchChatThreadId === action.threadId) {
        const remaining = Object.values(
          withoutThread.activeNarrative?.branchChatThreads ?? {},
        );
        remaining.sort((a, b) => b.updatedAt - a.updatedAt);
        nextActive = remaining[0]?.id ?? null;
      }
      return {
        ...withoutThread,
        viewState: { ...withoutThread.viewState, activeBranchChatThreadId: nextActive },
      };
    }

    case "RENAME_BRANCH_CHAT_THREAD":
      return updateNarrative(state, (n) => {
        const thread = n.branchChatThreads?.[action.threadId];
        if (!thread) return n;
        return {
          ...n,
          branchChatThreads: {
            ...(n.branchChatThreads ?? {}),
            [action.threadId]: { ...thread, name: action.name },
          },
        };
      });

    case "SET_ACTIVE_BRANCH_CHAT_THREAD":
      return {
        ...state,
        viewState: { ...state.viewState, activeBranchChatThreadId: action.threadId },
      };

    case "UPSERT_BRANCH_CHAT_THREAD":
      return updateNarrative(state, (n) => {
        const thread = (n.branchChatThreads ?? {})[action.threadId];
        if (!thread) return n;
        return {
          ...n,
          branchChatThreads: {
            ...(n.branchChatThreads ?? {}),
            [action.threadId]: {
              ...thread,
              ...(action.messages ? { messages: action.messages } : {}),
              ...(action.name ? { name: action.name } : {}),
              ...(action.compareBranchIds ? { compareBranchIds: action.compareBranchIds } : {}),
              ...(action.scopeState ? { scopeState: action.scopeState } : {}),
              updatedAt: Date.now(),
            },
          },
        };
      });

    // ── Driver entries (daily-driver queue) ───────────────────────────────
    case "CREATE_DRIVER_ENTRY":
      return updateNarrative(state, (n) => ({
        ...n,
        driverEntries: { ...(n.driverEntries ?? {}), [action.entry.id]: action.entry },
      }));

    case "DELETE_DRIVER_ENTRY":
      return updateNarrative(state, (n) => {
        const entry = n.driverEntries?.[action.entryId];
        // Locked entries (already folded into a SourceFile) are immutable.
        // Silently no-op rather than throwing — the UI surface should
        // never offer the action, but the guard keeps state coherent if
        // a stale callsite tries.
        if (!entry || (entry.usedInFileIds && entry.usedInFileIds.length > 0)) return n;
        const { [action.entryId]: _, ...rest } = n.driverEntries ?? {};
        return { ...n, driverEntries: rest };
      });

    case "UPDATE_DRIVER_ENTRY":
      return updateNarrative(state, (n) => {
        const entry = n.driverEntries?.[action.entryId];
        if (!entry) return n;
        // Locked entries are read-only — see DELETE comment above.
        if (entry.usedInFileIds && entry.usedInFileIds.length > 0) return n;
        return {
          ...n,
          driverEntries: {
            ...(n.driverEntries ?? {}),
            [action.entryId]: {
              ...entry,
              ...(action.title !== undefined ? { title: action.title } : {}),
              ...(action.text !== undefined ? { text: action.text } : {}),
              ...(action.tags !== undefined ? { tags: action.tags } : {}),
            },
          },
        };
      });

    case "MARK_DRIVER_ENTRIES_USED":
      return updateNarrative(state, (n) => {
        const entries = n.driverEntries ?? {};
        const ids = new Set(action.entryIds);
        const next: Record<string, DriverEntry> = { ...entries };
        for (const id of ids) {
          const entry = entries[id];
          if (!entry) continue;
          const usedInFileIds = entry.usedInFileIds ?? [];
          if (usedInFileIds.includes(action.fileId)) continue;
          next[id] = { ...entry, usedInFileIds: [...usedInFileIds, action.fileId] };
        }
        return { ...n, driverEntries: next };
      });

    // ── Location maps ─────────────────────────────────────────────────────
    case "SAVE_MAP":
      // Upsert by id — generation and regeneration both flow through here.
      return updateNarrative(state, (n) => ({
        ...n,
        maps: { ...(n.maps ?? {}), [action.map.id]: action.map },
      }));

    case "DELETE_MAP":
      return updateNarrative(state, (n) => {
        const { [action.mapId]: _removed, ...rest } = n.maps ?? {};
        return { ...n, maps: rest };
      });

    // ── Surveys ───────────────────────────────────────────────────────────
    case "CREATE_SURVEY":
      return updateNarrative(state, (n) => ({
        ...n,
        surveys: { ...(n.surveys ?? {}), [action.survey.id]: action.survey },
      }));

    case "DELETE_SURVEY":
      return updateNarrative(state, (n) => {
        if (!n.surveys?.[action.surveyId]) return n;
        const { [action.surveyId]: _removed, ...rest } = n.surveys;
        return { ...n, surveys: rest };
      });

    case "UPDATE_SURVEY":
      return updateNarrative(state, (n) => {
        const prev = n.surveys?.[action.surveyId];
        if (!prev) return n;
        return {
          ...n,
          surveys: {
            ...(n.surveys ?? {}),
            [action.surveyId]: { ...prev, ...action.updates, updatedAt: Date.now() },
          },
        };
      });

    case "SET_SURVEY_RESPONSE":
      return updateNarrative(state, (n) => {
        const prev = n.surveys?.[action.surveyId];
        if (!prev) return n;
        return {
          ...n,
          surveys: {
            ...(n.surveys ?? {}),
            [action.surveyId]: {
              ...prev,
              responses: { ...prev.responses, [action.response.respondentId]: action.response },
              updatedAt: Date.now(),
            },
          },
        };
      });

    // ── Interviews ────────────────────────────────────────────────────────
    case "CREATE_INTERVIEW":
      return updateNarrative(state, (n) => ({
        ...n,
        interviews: { ...(n.interviews ?? {}), [action.interview.id]: action.interview },
      }));

    case "DELETE_INTERVIEW":
      return updateNarrative(state, (n) => {
        if (!n.interviews?.[action.interviewId]) return n;
        const { [action.interviewId]: _removed, ...rest } = n.interviews;
        return { ...n, interviews: rest };
      });

    case "UPDATE_INTERVIEW":
      return updateNarrative(state, (n) => {
        const prev = n.interviews?.[action.interviewId];
        if (!prev) return n;
        return {
          ...n,
          interviews: {
            ...(n.interviews ?? {}),
            [action.interviewId]: { ...prev, ...action.updates, updatedAt: Date.now() },
          },
        };
      });

    case "SET_INTERVIEW_ANSWER":
      return updateNarrative(state, (n) => {
        const prev = n.interviews?.[action.interviewId];
        if (!prev) return n;
        return {
          ...n,
          interviews: {
            ...(n.interviews ?? {}),
            [action.interviewId]: {
              ...prev,
              answers: { ...prev.answers, [action.answer.questionId]: action.answer },
              updatedAt: Date.now(),
            },
          },
        };
      });

    // ── Investigations ────────────────────────────────────────────────────
    case "CREATE_INVESTIGATION":
      return updateNarrative(state, (n) => ({
        ...n,
        investigations: { ...(n.investigations ?? {}), [action.investigation.id]: action.investigation },
      }));

    case "UPDATE_INVESTIGATION":
      return updateNarrative(state, (n) => {
        const prev = n.investigations?.[action.investigationId];
        if (!prev) return n;
        return {
          ...n,
          investigations: {
            ...(n.investigations ?? {}),
            [action.investigationId]: { ...prev, ...action.updates, updatedAt: Date.now() },
          },
        };
      });

    case "DELETE_INVESTIGATION":
      return updateNarrative(state, (n) => {
        if (!n.investigations?.[action.investigationId]) return n;
        const { [action.investigationId]: _removed, ...rest } = n.investigations;
        return { ...n, investigations: rest };
      });

    case "SET_SELECTED_INVESTIGATION":
      return {
        ...state,
        viewState: { ...state.viewState, selectedInvestigationId: action.investigationId },
      };

    // ── Coordination Plan ─────────────────────────────────────────────────
    case "SET_COORDINATION_PLAN":
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: { ...branch, coordinationPlan: action.plan },
          },
        };
      });

    case "CLEAR_COORDINATION_PLAN":
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch) return n;
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: { ...branch, coordinationPlan: undefined },
          },
        };
      });

    case "ADVANCE_COORDINATION_PLAN":
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch?.coordinationPlan) return n;
        const { plan } = branch.coordinationPlan;
        // Arc indices are 1-based, but currentArc starts at 0 when plan is created
        // Treat 0 as 1 (we just completed arc 1)
        const executedArc = plan.currentArc === 0 ? 1 : plan.currentArc;
        const nextArc = executedArc + 1;

        // Mark executed arc as completed
        const completedArcs = [...plan.completedArcs];
        if (!completedArcs.includes(executedArc)) {
          completedArcs.push(executedArc);
        }

        // Advance to next arc or mark plan as complete
        const isComplete = nextArc > plan.arcCount;

        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: {
              ...branch,
              coordinationPlan: {
                ...branch.coordinationPlan,
                plan: {
                  ...plan,
                  currentArc: isComplete ? plan.arcCount : nextArc,
                  completedArcs,
                },
              },
            },
          },
        };
      });

    case "RESET_COORDINATION_PLAN":
      // Rewind the plan pointer to arc 1 (fresh), clearing completed arcs.
      // Keeps the plan structure intact — only progress is reset.
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch?.coordinationPlan) return n;
        const { plan } = branch.coordinationPlan;
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: {
              ...branch,
              coordinationPlan: {
                ...branch.coordinationPlan,
                plan: {
                  ...plan,
                  currentArc: 0,
                  completedArcs: [],
                },
              },
            },
          },
        };
      });

    case "SET_COORDINATION_PLAN_ARC":
      // Manually set the plan pointer to any arc. Treats arcs before the
      // pointer as completed and arcs at/after as pending. `arcIndex` is
      // 1-based; pass 0 to rewind to "not started" (equivalent to reset).
      return updateNarrative(state, (n) => {
        const branch = n.branches[action.branchId];
        if (!branch?.coordinationPlan) return n;
        const { plan } = branch.coordinationPlan;
        const clampedArc = Math.max(0, Math.min(plan.arcCount, action.arcIndex));
        // Every arc strictly before the pointer is considered completed.
        const completedArcs: number[] = [];
        for (let i = 1; i < clampedArc; i++) completedArcs.push(i);
        return {
          ...n,
          branches: {
            ...n.branches,
            [action.branchId]: {
              ...branch,
              coordinationPlan: {
                ...branch.coordinationPlan,
                plan: {
                  ...plan,
                  currentArc: clampedArc,
                  completedArcs,
                },
              },
            },
          },
        };
      });

    case "SET_ARC_REASONING_GRAPH":
      return updateNarrative(state, (n) => {
        const arc = n.arcs[action.arcId];
        if (!arc) return n;
        return {
          ...n,
          arcs: {
            ...n.arcs,
            [action.arcId]: {
              ...arc,
              reasoningGraph: action.reasoningGraph,
            },
          },
        };
      });

    case "ADD_SYSTEM_EDGE":
      return updateNarrative(state, (n) => {
        const scene = n.scenes[action.sceneId];
        if (!scene) return n;
        const existing = scene.systemDeltas ?? { addedNodes: [], addedEdges: [] };
        // Idempotent: don't duplicate the same edge if it's already present.
        const dup = existing.addedEdges?.some(
          (e) =>
            e.from === action.edge.from &&
            e.to === action.edge.to &&
            e.relation === action.edge.relation,
        );
        if (dup) return n;
        return {
          ...n,
          scenes: {
            ...n.scenes,
            [action.sceneId]: {
              ...scene,
              systemDeltas: {
                addedNodes: existing.addedNodes ?? [],
                addedEdges: [...(existing.addedEdges ?? []), action.edge],
              },
            },
          },
        };
      });

    default:
      return state;
  }
}

// ── Context ──────────────────────────────────────────────────────────────────
type StoreContextType = {
  state: AppState;
  dispatch: React.Dispatch<Action>;
};

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const prevNarrativeRef = useRef<NarrativeState | null>(null);
  const prevActiveIdRef = useRef<string | null>(null);

  // Hydrate persisted narratives from IndexedDB on mount
  useEffect(() => {
    async function hydrate() {
      // Migrate from localStorage if needed (one-time)
      await migrateFromLocalStorage();

      let persisted: NarrativeState[] = [];
      try {
        persisted = await loadNarratives();
      } catch (err) {
        logError("Failed to load narratives during hydration", err, {
          source: "other",
          operation: "hydrate-narratives",
        });
      }
      const persistedById = new Map(persisted.map((n) => [n.id, n]));

      // User entries (from IndexedDB) load immediately
      const userEntries = persisted
        .filter(
          (n) =>
            !SEED_IDS.has(n.id) &&
            !PLAYGROUND_IDS.has(n.id) &&
            !ANALYSIS_IDS.has(n.id),
        )
        .map(narrativeToEntry);

      // Initialize with user entries immediately so UI is responsive
      dispatch({ type: "HYDRATE_NARRATIVES", entries: userEntries });

      // Helper to import assets from a ZIP in the background (non-blocking, parallel)
      async function importAssetsInBackground(
        zip: import("jszip"),
        file: string,
      ) {
        const tasks: Promise<void>[] = [];

        // Import embeddings (in parallel)
        const embeddingsFolder = zip.folder("embeddings");
        if (embeddingsFolder) {
          const embFiles = Object.values(embeddingsFolder.files).filter(
            (f) => !f.dir && f.name.endsWith(".bin"),
          );
          console.log(
            `[loadManifest] Importing ${embFiles.length} embeddings from ${file} in background`,
          );
          tasks.push(
            Promise.all(
              embFiles.map(async (embFile) => {
                const fileName = embFile.name.split("/").pop()!;
                const embId = fileName.replace(".bin", "");
                try {
                  const buffer = await embFile.async("arraybuffer");
                  const float32Array = new Float32Array(buffer);
                  const vector = Array.from(float32Array);
                  await assetManager.storeEmbedding(
                    vector,
                    "text-embedding-3-small",
                    embId,
                  );
                } catch (err) {
                  console.warn(`Failed to import embedding ${embId}:`, err);
                }
              }),
            ).then(() => {
              console.log(`[loadManifest] Embeddings imported from ${file}`);
            }),
          );
        }

        // Import audio (in parallel)
        const audioFolder = zip.folder("audio");
        if (audioFolder) {
          const audioFiles = Object.values(audioFolder.files).filter(
            (f) => !f.dir && f.name.startsWith("audio/"),
          );
          console.log(
            `[loadManifest] Importing ${audioFiles.length} audio files from ${file} in background`,
          );
          tasks.push(
            Promise.all(
              audioFiles.map(async (audioFile) => {
                const fileName = audioFile.name.split("/").pop()!;
                const [audioId] = fileName.split(".");
                try {
                  const blob = await audioFile.async("blob");
                  await assetManager.storeAudio(blob, blob.type, audioId);
                } catch (err) {
                  console.warn(`Failed to import audio ${audioId}:`, err);
                }
              }),
            ).then(() => {
              console.log(`[loadManifest] Audio imported from ${file}`);
            }),
          );
        }

        // Import images (in parallel)
        const imagesFolder = zip.folder("images");
        if (imagesFolder) {
          const imageFiles = Object.values(imagesFolder.files).filter(
            (f) => !f.dir && f.name.startsWith("images/"),
          );
          console.log(
            `[loadManifest] Importing ${imageFiles.length} images from ${file} in background`,
          );
          tasks.push(
            Promise.all(
              imageFiles.map(async (imageFile) => {
                const fileName = imageFile.name.split("/").pop()!;
                const [imgId] = fileName.split(".");
                try {
                  const blob = await imageFile.async("blob");
                  await assetManager.storeImage(blob, blob.type, imgId);
                } catch (err) {
                  console.warn(`Failed to import image ${imgId}:`, err);
                }
              }),
            ).then(() => {
              console.log(`[loadManifest] Images imported from ${file}`);
            }),
          );
        }

        // Run all asset types in parallel
        await Promise.all(tasks);
        console.log(
          `[loadManifest] Finished importing all assets from ${file}`,
        );
      }

      // Import assets from an extracted directory in the background
      async function importDirAssetsInBackground(
        basePath: string,
        entry: string,
      ) {
        // Load embeddings manifest
        try {
          const embManifestRes = await fetch(
            `/${basePath}/${entry}embeddings/manifest.json`,
          );
          if (embManifestRes.ok) {
            const embFiles: string[] = await embManifestRes.json();
            console.log(
              `[loadManifest] Importing ${embFiles.length} embeddings from ${entry} in background`,
            );
            // Import in batches of 50 to avoid flooding the network
            for (let i = 0; i < embFiles.length; i += 50) {
              const batch = embFiles.slice(i, i + 50);
              await Promise.all(
                batch.map(async (fileName) => {
                  const embId = fileName.replace(".bin", "");
                  try {
                    const res = await fetch(
                      `/${basePath}/${entry}embeddings/${fileName}`,
                    );
                    if (!res.ok) return;
                    const buffer = await res.arrayBuffer();
                    const float32Array = new Float32Array(buffer);
                    const vector = Array.from(float32Array);
                    await assetManager.storeEmbedding(
                      vector,
                      "text-embedding-3-small",
                      embId,
                    );
                  } catch (err) {
                    console.warn(`Failed to import embedding ${embId}:`, err);
                  }
                }),
              );
            }
            console.log(`[loadManifest] Embeddings imported from ${entry}`);
          }
        } catch (err) {
          console.warn(
            `[loadManifest] Failed to import dir embeddings for ${entry}:`,
            err,
          );
        }
      }

      // Load a single bundled file and dispatch entry immediately when ready
      // Returns the narrative for preset initialization, asset import runs in background
      async function loadBundledFile(
        dir: string,
        file: string,
        idSet: Set<string>,
      ): Promise<NarrativeState | null> {
        try {
          // Directory entry — trailing slash means fetch narrative.json from within
          const isDir = file.endsWith("/");

          console.log(
            `[loadManifest] Loading ${dir}/${file} (${isDir ? "directory" : "file"})`,
          );

          const fetchUrl = isDir
            ? `/${dir}/${file}narrative.json`
            : `/${dir}/${file}`;
          const r = await fetch(fetchUrl);
          if (!r.ok) {
            logError(
              `Failed to fetch bundled narrative ${fetchUrl}`,
              `HTTP ${r.status} ${r.statusText}`,
              {
                source: "other",
                operation: "load-manifest",
                details: { directory: dir, file, status: r.status, url: fetchUrl },
              },
            );
            return null;
          }

          const arrayBuffer = await r.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          const isZip =
            !isDir &&
            bytes.length >= 2 &&
            bytes[0] === 0x50 &&
            bytes[1] === 0x4b;
          console.log(
            `[loadManifest] ${file} is ${isDir ? "DIR" : isZip ? "ZIP" : "JSON"} format (size: ${bytes.length} bytes)`,
          );

          let narrative: NarrativeState;

          if (isZip) {
            const JSZip = (await import("jszip")).default;
            const zip = await JSZip.loadAsync(arrayBuffer);

            const narrativeFile = zip.file("narrative.json");
            if (!narrativeFile) {
              console.error(
                `[loadManifest] Invalid .meridians ZIP in ${dir}/${file}: missing narrative.json`,
              );
              logWarning(
                `Invalid .meridians ZIP in ${dir}/${file}`,
                "missing narrative.json",
                {
                  source: "other",
                  operation: "load-manifest",
                },
              );
              return null;
            }

            const narrativeText = await narrativeFile.async("text");
            narrative = JSON.parse(narrativeText) as NarrativeState;

            // Check if already in IndexedDB
            const saved = persistedById.get(narrative.id);
            if (saved) {
              console.log(
                `[loadManifest] Using saved version of ${narrative.title} from IndexedDB`,
              );
              SEED_IDS.add(narrative.id);
              idSet.add(narrative.id);
              dispatch({
                type: "ADD_NARRATIVE_ENTRY",
                entry: narrativeToEntry(saved),
              });
              return narrative;
            }

            // Dispatch entry immediately (before asset import)
            console.log(
              `[loadManifest] Adding bundled narrative: ${narrative.title}`,
            );
            bundledNarratives.set(narrative.id, narrative);
            SEED_IDS.add(narrative.id);
            idSet.add(narrative.id);
            dispatch({
              type: "ADD_NARRATIVE_ENTRY",
              entry: narrativeToEntry(narrative),
            });

            // Import assets in background (non-blocking)
            importAssetsInBackground(zip, file).catch((err) => {
              logWarning(
                `Background asset import failed for ${file}`,
                err,
                {
                  source: "asset",
                  operation: "import-assets",
                  details: { directory: dir, file },
                },
              );
            });
          } else {
            // Plain JSON format (both file and directory entries reach here)
            const text = new TextDecoder().decode(arrayBuffer);
            narrative = JSON.parse(text) as NarrativeState;

            const saved = persistedById.get(narrative.id);
            if (saved) {
              console.log(
                `[loadManifest] Using saved version of ${narrative.title} from IndexedDB`,
              );
              SEED_IDS.add(narrative.id);
              idSet.add(narrative.id);
              dispatch({
                type: "ADD_NARRATIVE_ENTRY",
                entry: narrativeToEntry(saved),
              });
              return narrative;
            }

            console.log(
              `[loadManifest] Adding bundled narrative: ${narrative.title}`,
            );
            bundledNarratives.set(narrative.id, narrative);
            SEED_IDS.add(narrative.id);
            idSet.add(narrative.id);
            dispatch({
              type: "ADD_NARRATIVE_ENTRY",
              entry: narrativeToEntry(narrative),
            });

            // Import directory assets in background
            if (isDir) {
              importDirAssetsInBackground(dir, file).catch((err) => {
                logWarning(
                  `Background dir asset import failed for ${file}`,
                  err,
                  {
                    source: "asset",
                    operation: "import-assets",
                    details: { directory: dir, file },
                  },
                );
              });
            }
          }

          console.log(
            `[loadManifest] Successfully loaded narrative: ${narrative.title} (${narrative.id})`,
          );
          return narrative;
        } catch (err) {
          logError(
            `Failed to load bundled narrative ${dir}/${file}`,
            err,
            {
              source: "other",
              operation: "load-manifest",
              details: { directory: dir, file },
            },
          );
          return null;
        }
      }

      // Load manifest and process files progressively
      async function loadManifestProgressive(
        dir: string,
        idSet: Set<string>,
      ): Promise<NarrativeState[]> {
        try {
          console.log(
            `[loadManifest] Fetching manifest from /${dir}/manifest.json`,
          );
          const res = await fetch(`/${dir}/manifest.json`);
          if (!res.ok) {
            console.error(
              `[loadManifest] Failed to fetch manifest for ${dir}:`,
              res.status,
            );
            logWarning(
              `Failed to fetch manifest for ${dir}`,
              `HTTP ${res.status}`,
              {
                source: "other",
                operation: "load-manifest",
                details: { directory: dir, status: res.status },
              },
            );
            return [];
          }
          const files: string[] = await res.json();
          console.log(
            `[loadManifest] Found ${files.length} files in ${dir}:`,
            files,
          );

          // Load all files in parallel, each dispatches its entry as soon as ready
          const results = await Promise.all(
            files.map((file) => loadBundledFile(dir, file, idSet)),
          );

          const loaded = results.filter((n): n is NarrativeState => n !== null);
          const missing = files.filter((_, i) => results[i] === null);
          console.log(
            `[loadManifest] Loaded ${loaded.length}/${files.length} narratives from ${dir}`,
          );
          if (missing.length > 0) {
            logError(
              `${missing.length}/${files.length} bundled narratives in "${dir}" failed to load`,
              `Missing: ${missing.join(", ")}`,
              {
                source: "other",
                operation: "load-manifest",
                details: {
                  directory: dir,
                  missingCount: missing.length,
                  totalCount: files.length,
                  missing: missing.join(", "),
                },
              },
            );
          }
          return loaded;
        } catch (err) {
          logError(`Failed to load manifest for ${dir}`, err, {
            source: "other",
            operation: "load-manifest",
            details: { directory: dir },
          });
          return [];
        }
      }

      // Load playgrounds first (complete before works)
      await loadManifestProgressive("playgrounds", PLAYGROUND_IDS);

      // Then load works progressively
      const worksNarratives = await loadManifestProgressive(
        "works",
        ANALYSIS_IDS,
      );

      // Initialize Markov chain presets from analysed works
      const worksForPresets: {
        key: string;
        name: string;
        narrative: NarrativeState;
      }[] = [];
      for (const narrative of worksNarratives) {
        if (ANALYSIS_IDS.has(narrative.id)) {
          const key = narrative.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/(^_|_$)/g, "");
          worksForPresets.push({ key, name: narrative.title, narrative });
        }
      }
      if (worksForPresets.length > 0) {
        initMatrixPresets(worksForPresets);
        initBeatProfilePresets(worksForPresets);
        initMechanismProfilePresets(worksForPresets);
      }

      // The URL owns activeNarrativeId — the /narrative/[id] route syncs it
      // from params, and loadActiveNarrativeId is persisted for callers that
      // explicitly want the last-visited ID. Dispatching here would race
      // with URL-sync and sometimes overwrite the narrative the user just
      // navigated to.
      dispatch({ type: "HYDRATION_COMPLETE" });
    }
    hydrate().catch((err) => {
      logError("Hydration failed — narratives may not appear", err, {
        source: "other",
        operation: "hydrate-narratives",
      });
      // Still mark hydration complete so downstream consumers (e.g. the
      // route's not-found redirect) aren't blocked waiting on a failed load.
      dispatch({ type: "HYDRATION_COMPLETE" });
    });
  }, []);

  // Load narrative from IndexedDB when activeNarrativeId changes
  useEffect(() => {
    const id = state.activeNarrativeId;
    if (!id) {
      prevActiveIdRef.current = null;
      return;
    }
    if (id === prevActiveIdRef.current && state.activeNarrative) return;
    prevActiveIdRef.current = id;

    // If activeNarrative is already populated (e.g. from ADD_NARRATIVE), skip async load
    if (state.activeNarrative?.id === id) return;

    let cancelled = false;
    async function load() {
      // Try IndexedDB first, then fall back to bundled narrative
      let narrative = await loadNarrative(id!);
      if (!narrative) {
        const bundled = bundledNarratives.get(id!);
        if (bundled) narrative = bundled;
      }
      const savedBranchId = await loadActiveBranchId(id!);
      if (narrative && !cancelled) {
        dispatch({ type: "LOADED_NARRATIVE", narrative, savedBranchId });
      }
    }
    load().catch((err) => {
      logError("Failed to load narrative from storage", err, {
        source: "other",
        operation: "load-narrative",
        details: { narrativeId: id },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [state.activeNarrativeId]);

  // Persist active narrative to IndexedDB whenever it changes
  useEffect(() => {
    const narrative = state.activeNarrative;
    if (!narrative) return;
    // Skip if reference hasn't changed (avoids redundant writes)
    if (narrative === prevNarrativeRef.current) return;
    prevNarrativeRef.current = narrative;

    persistNarrative(narrative).catch((err) => {
      logError("Failed to persist narrative to storage", err, {
        source: "other",
        operation: "persist-narrative",
        details: { narrativeId: narrative.id },
      });
    });
  }, [state.activeNarrative]);

  // Persist active narrative ID whenever it changes
  useEffect(() => {
    saveActiveNarrativeId(state.activeNarrativeId).catch((err) => {
      logError("Failed to persist active narrative ID to storage", err, {
        source: "other",
        operation: "persist-active-narrative-id",
        details: { narrativeId: state.activeNarrativeId },
      });
    });
  }, [state.activeNarrativeId]);

  // Persist active branch ID per-narrative whenever it changes (skip null to
  // avoid race with SET_ACTIVE_NARRATIVE, which resets both the narrative ID
  // and the view state in the same reducer call).
  useEffect(() => {
    if (state.viewState.activeBranchId === null) return;
    if (state.activeNarrativeId === null) return;
    saveActiveBranchId(
      state.activeNarrativeId,
      state.viewState.activeBranchId,
    ).catch((err) => {
      logError("Failed to persist active branch ID to storage", err, {
        source: "other",
        operation: "persist-active-branch-id",
        details: {
          narrativeId: state.activeNarrativeId,
          branchId: state.viewState.activeBranchId,
        },
      });
    });
  }, [state.viewState.activeBranchId, state.activeNarrativeId]);

  // Hydrate analysis jobs from IndexedDB on mount
  useEffect(() => {
    loadAnalysisJobs().then((jobs) => {
      if (jobs.length > 0) {
        // Mark any previously-running jobs as paused (they were interrupted)
        const restored = jobs.map((j) =>
          j.status === "running"
            ? { ...j, status: "paused" as const, updatedAt: Date.now() }
            : j,
        );
        dispatch({ type: "HYDRATE_ANALYSIS_JOBS", jobs: restored });
      }
    });
  }, []);

  // Persist analysis jobs whenever they change + clean up deleted job API logs
  const prevAnalysisJobsRef = useRef(state.analysisJobs);
  useEffect(() => {
    if (state.analysisJobs === prevAnalysisJobsRef.current) return;
    const prevJobs = prevAnalysisJobsRef.current;
    prevAnalysisJobsRef.current = state.analysisJobs;

    // Detect deleted jobs and clean up their API logs
    const currentIds = new Set(state.analysisJobs.map((j) => j.id));
    const deletedJobs = prevJobs.filter((j) => !currentIds.has(j.id));
    for (const job of deletedJobs) {
      deleteAnalysisApiLogs(job.id).catch((err) => {
        logError("Failed to delete analysis API logs", err, {
          source: "analysis",
          operation: "delete-analysis-api-logs",
          details: { analysisId: job.id },
        });
      });
    }

    saveAnalysisJobs(state.analysisJobs).catch((err) => {
      logError("Failed to persist analysis jobs to storage", err, {
        source: "analysis",
        operation: "persist-analysis-jobs",
        details: { jobCount: state.analysisJobs.length },
      });
    });
  }, [state.analysisJobs]);

  // Load search state from IndexedDB when active narrative changes
  useEffect(() => {
    const narrativeId = state.activeNarrativeId;
    if (!narrativeId) return;

    loadSearchState(narrativeId)
      .then((query) => {
        if (query) {
          dispatch({ type: "SET_SEARCH_QUERY", query });
        }
      })
      .catch(() => {
        // Silently fail for search state loading
      });
  }, [state.activeNarrativeId]);

  // Persist search state whenever it changes
  const prevSearchQueryRef = useRef(state.viewState.currentSearchQuery);
  useEffect(() => {
    const narrativeId = state.activeNarrativeId;
    if (!narrativeId) return;
    if (state.viewState.currentSearchQuery === prevSearchQueryRef.current) return;
    prevSearchQueryRef.current = state.viewState.currentSearchQuery;
    saveSearchState(narrativeId, state.viewState.currentSearchQuery).catch(() => {
      // Silently fail for search state persistence
    });
  }, [state.viewState.currentSearchQuery, state.activeNarrativeId]);

  // Generate prose embeddings for manual prose edits
  const proseEmbeddingQueueRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const narrative = state.activeNarrative;
    const branchId = state.viewState.activeBranchId;
    if (!narrative || !branchId) return;

    // Check all scenes for prose that needs embedding
    const scenesToEmbed: Array<{
      sceneId: string;
      prose: string;
      version: string;
    }> = [];

    for (const [sceneId, scene] of Object.entries(narrative.scenes)) {
      if (!scene.proseVersions || scene.proseVersions.length === 0) continue;

      // Get the latest prose version for this branch
      const latestVersion = scene.proseVersions[scene.proseVersions.length - 1];
      if (!latestVersion || !latestVersion.prose) continue;

      // Skip if already queued or already has embedding
      const queueKey = `${sceneId}-${latestVersion.version}`;
      if (proseEmbeddingQueueRef.current.has(queueKey)) continue;
      if (scene.proseEmbedding) continue; // Scene already has embedding

      scenesToEmbed.push({
        sceneId,
        prose: latestVersion.prose,
        version: latestVersion.version,
      });
    }

    // Generate embeddings for all pending prose
    if (scenesToEmbed.length > 0) {
      for (const { sceneId, prose, version } of scenesToEmbed) {
        const queueKey = `${sceneId}-${version}`;
        proseEmbeddingQueueRef.current.add(queueKey);

        (async () => {
          try {
            const { generateEmbeddings } = await import("@/lib/embeddings");
            const { assetManager } = await import("@/lib/asset-manager");
            const embeddings = await generateEmbeddings([prose], narrative.id);
            const proseEmbedding = await assetManager.storeEmbedding(
              embeddings[0],
              "text-embedding-3-small",
            );

            // Update scene with embedding (non-versioned update)
            dispatch({
              type: "UPDATE_SCENE",
              sceneId,
              updates: { proseEmbedding },
            });

            // Remove from queue
            proseEmbeddingQueueRef.current.delete(queueKey);
          } catch (err) {
            // Log error but don't fail - embedding is non-critical
            logError("Failed to generate prose embedding", err, {
              source: "prose-generation",
              operation: "embed-prose-manual",
              details: { sceneId, narrativeId: narrative.id },
            });
            proseEmbeddingQueueRef.current.delete(queueKey);
          }
        })();
      }
    }
  }, [state.activeNarrative, state.viewState.activeBranchId]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          dispatch({ type: "PREV_SCENE" });
          break;
        case "ArrowRight":
          e.preventDefault();
          dispatch({ type: "NEXT_SCENE" });
          break;
        case " ":
          e.preventDefault();
          dispatch({ type: "TOGGLE_PLAY" });
          break;
        case "Escape":
          dispatch({ type: "SET_INSPECTOR", context: null });
          dispatch({ type: "SELECT_KNOWLEDGE_ENTITY", entityId: null });
          dispatch({ type: "SELECT_THREAD_LOG", threadId: null });
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const contextValue = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return (
    <StoreContext.Provider value={contextValue}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
