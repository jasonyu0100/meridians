// Slides data — assembles the analysis walkthrough deck (force/cube/entity stats) from a narrative.

import type {
  NarrativeState, Scene, ForceSnapshot, CubeCornerKey,
  Character, Location, Artifact,
  BeatSampler,
  PropositionBaseCategory,
  NarrativeParadigm,
  SystemNodeType,
  Arc,
  Region,
} from '@/types/narrative';
import { NARRATIVE_CUBE, isScene, resolveEntry } from '@/types/narrative';
import { computeSamplerFromPlans } from '@/lib/pacing/beat-profiles';
import {
  computeForceSnapshots,
  computeRawForceTotals,
  computeActivityCurve,
  computeForceSignature,
  computeSwingMagnitudes,
  classifyNarrativeShape,
  classifyArchetype,
  classifyScale,
  classifyWorldDensity,
  detectCubeCorner,
  gradeForces,
  FORCE_REFERENCE_MEANS,
  getStanceMargin,
  getStanceProbs,
  getThreadStance,
  isThreadAbandoned,
  isThreadClosed,
  scoreSystemNodes,
  type ActivityPoint,
  type ForceSignature,
  type NarrativeShape,
  type ForceGrades,
  type NarrativeArchetype,
  type NarrativeScale,
  type WorldDensity,
} from '@/lib/forces/narrative-utils';
import { classifyThreadCategory, type ThreadCategory } from '@/lib/forces/thread-category';
import { buildThreadTrajectory, replayThreadsAtIndex, introducedThreadIdsAtIndex } from '@/lib/analysis/portfolio-analytics';

// ── Types ──────────────────────────────────────────────────────────────────────

export type Segment = {
  /** Segment index (0-based) */
  index: number;
  /** Start scene index (inclusive) */
  startIdx: number;
  /** End scene index (inclusive) */
  endIdx: number;
  /** Activity points for this segment */
  activity: ActivityPoint[];
  /** Dominant force in this segment */
  dominantForce: 'fate' | 'world' | 'system';
  /** Key thread deltas in this segment */
  threadChanges: { threadId: string; logType: string; updates: { outcome: string; evidence: number }[]; sceneIdx: number }[];
  /** Peaks within this segment */
  peakIndices: number[];
  /** Average activity level in this segment */
  avgActivity: number;
  /** Scene summaries for key moments */
  keyScenes: { idx: number; summary: string; activity: number }[];
};

export type PeakInfo = {
  /** Scene index in the full scene array */
  sceneIdx: number;
  scene: Scene;
  activity: ActivityPoint;
  forces: ForceSnapshot;
  cubeCorner: { key: CubeCornerKey; name: string; description: string };
  /** Thread deltas at this scene */
  threadChanges: { threadId: string; logType: string; updates: { outcome: string; evidence: number }[] }[];
  /** Relationship deltas at this scene */
  relationshipChanges: { from: string; to: string; type: string; delta: number }[];
  /** Force decomposition: which force contributed most */
  dominantForce: 'fate' | 'world' | 'system';
};

export type TroughInfo = {
  sceneIdx: number;
  scene: Scene;
  activity: ActivityPoint;
  forces: ForceSnapshot;
  cubeCorner: { key: CubeCornerKey; name: string; description: string };
  /** How many scenes until next peak */
  scenesToNextPeak: number;
  /** Which force recovers first in the scenes after this trough */
  recoveryForce: 'fate' | 'world' | 'system' | null;
};

export type ThreadLifecycle = {
  threadId: string;
  description: string;
  /** Status at each scene index */
  statuses: { sceneIdx: number; status: string }[];
};

export type ArcGrade = {
  arcId: string;
  arcName: string;
  sceneCount: number;
  grades: ForceGrades;
};

/** A single open question's current stance — the unit of the work's belief
 *  system. Lives on the Fate force. Surfaces enough state for a slide to
 *  render lean and doubt in prose without recomputing softmax / margin. */
export type BeliefSnapshot = {
  threadId: string;
  description: string;
  participantNames: string[];
  category: ThreadCategory;
  /** Leading outcome by softmax probability. */
  lean: string;
  /** Softmax probability of the leading outcome. */
  pLean: number;
  /** Logit margin to the runner-up — how decisive the lean is. */
  margin: number;
  volume: number;
  volatility: number;
  /** Full distribution over outcomes — name + softmax probability. */
  outcomes: { name: string; p: number }[];
  /** Per-scene probability trajectory over the resolved timeline. One sample
   *  per scene the thread is alive on; `probs[k]` aligns 1:1 with that point's
   *  own `outcomes` (NOT the live snapshot's — mid-narrative addOutcomes can
   *  reorder/grow the set, so each point carries the outcomes its probs match).
   *  Populated for the top-N beliefs only (heavy to compute for all). */
  trajectory: { sceneOrdinal: number; probs: number[]; outcomes: string[] }[];
};

/** The work's knowledge structure — the System force made visible. Snapshots
 *  the system graph so the slide can render rule density and interconnection
 *  without holding the graph itself. Plus the ranked node list mirroring the
 *  sidebar's KnowledgePanel (score = degree + attributions + reach). */
export type KnowledgeStructure = {
  nodeCount: number;
  edgeCount: number;
  /** Counts per node type — principle, system, concept, tension, event, ... */
  nodesByType: Partial<Record<SystemNodeType, number>>;
  /** Top-ranked nodes by impact (degree + attributions + reach). Mirrors the
   *  sidebar's KnowledgePanel ranking — the load-bearing pieces the rest of
   *  the world view leans on. */
  rankedNodes: {
    id: string;
    concept: string;
    type: SystemNodeType;
    degree: number;
    attributions: number;
    reach: number;
    score: number;
  }[];
};

export type SlidesData = {
  title: string;
  description: string;
  sceneCount: number;
  arcCount: number;
  characterCount: number;
  locationCount: number;
  threadCount: number;
  coverImageUrl?: string;

  scenes: Scene[];
  forceSnapshots: ForceSnapshot[];
  rawForces: { fate: number[]; world: number[]; system: number[] };
  activityCurve: ActivityPoint[];
  shape: NarrativeShape;
  swings: number[];

  segments: Segment[];
  peaks: PeakInfo[];
  troughs: TroughInfo[];

  cubeDistribution: Record<CubeCornerKey, number>;
  cubeTransitions: { from: CubeCornerKey; to: CubeCornerKey; count: number }[];

  threadLifecycles: ThreadLifecycle[];
  /** Thread convergence edges for braiding diagram */
  threadConvergences: { fromId: string; toId: string }[];
  topCharacters: { character: Character; sceneCount: number }[];
  topLocations: { location: Location; sceneCount: number }[];
  topArtifacts: { artifact: Artifact; usageCount: number }[];

  overallGrades: ForceGrades;
  archetype: NarrativeArchetype;
  scale: NarrativeScale;
  density: WorldDensity;
  arcGrades: ArcGrade[];

  /** Beat profile sampler computed from scene plans (null if no plans) */
  beatSampler: BeatSampler | null;
  /** Ordered sequence of beat functions from all scene plans */
  beatSequence: string[];

  /** Proposition classification data */
  propositionTotals: Record<PropositionBaseCategory, number>;
  propositionCount: number;
  /** Per-arc proposition distribution (arc name → base category counts) */
  propositionByArc: { arcName: string; totals: Record<PropositionBaseCategory, number>; total: number }[];
  /** Per-scene base category counts for timeline visualization */
  propositionTimeline: { sceneIdx: number; totals: Record<PropositionBaseCategory, number>; total: number }[];

  /** ID → name lookup maps for resolving scene references */
  characterNames: Record<string, string>;
  locationNames: Record<string, string>;
  threadDescriptions: Record<string, string>;

  // ── World-view-specific fields (paradigm-aware report + slides) ──────────

  /** The work's paradigm classification (fiction / non-fiction / simulation /
   *  essay / panel / atlas / debate / record / game). Null when the narrative
   *  predates paradigm tagging. */
  paradigm: NarrativeParadigm | null;

  /** Full force signature — weights on the 3-simplex, primary/secondary
   *  channel, profile string, nearest archetype. Distinct from `archetype`
   *  (the snapped label) — exposes the raw weights for ternary-plot rendering
   *  and the duality bands the SignatureSlide reads. */
  signature: ForceSignature;

  /** Belief system snapshot — every LIVE (non-closed, non-abandoned) thread
   *  with its current stance. Sorted by volume desc so the load-bearing
   *  questions come first. Feeds the BeliefSystemSlide and the
   *  belief_system report section. */
  beliefs: BeliefSnapshot[];

  /** Knowledge-structure snapshot — System graph node-type counts, edge
   *  count, top-degree principles. Feeds the KnowledgeStructureSlide and
   *  the knowledge_structure report section. */
  knowledgeStructure: KnowledgeStructure;
};

// ── Computation ────────────────────────────────────────────────────────────────

function dominantForce(f: number, w: number, s: number): 'fate' | 'world' | 'system' {
  if (f >= w && f >= s) return 'fate';
  if (w >= f && w >= s) return 'world';
  return 'system';
}

export function computeSlidesData(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  /** Narrative-start → end-of-window keys, for analyses that must accumulate
   *  prior context (the belief system). Defaults to `resolvedEntryKeys` (the
   *  whole-narrative deck). A region deck passes start → region-end here while
   *  `resolvedEntryKeys` stays the region's own scenes for period analyses. */
  cumulativeEntryKeys: string[] = resolvedEntryKeys,
): SlidesData {
  // Resolve ordered scenes
  const scenes: Scene[] = resolvedEntryKeys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => !!e && isScene(e));

  const n = scenes.length;

  // Force snapshots (rank→Gaussian normalised, refined fate via narrative).
  // Pass the narrative through so slides uses the same force pipeline as the
  // series card and score card — otherwise the grades diverge.
  const forceMap = computeForceSnapshots(scenes, [], narrative);
  const forceSnapshots = scenes.map((s) => forceMap[s.id] ?? { fate: 0, world: 0, system: 0 });

  // Raw forces — also through the narrative, matching the store.
  const rawForces = computeRawForceTotals(scenes, narrative);

  // Information curve — dominance-weighted via PCA on the raw force shares.
  const sig = computeForceSignature(rawForces.fate, rawForces.world, rawForces.system);
  const activityCurve = computeActivityCurve(forceSnapshots, sig.weights);

  // Narrative shape (based on delivery curve)
  const shape = classifyNarrativeShape(activityCurve.map((d) => d.activity));

  // Swings from mean-normalised raw forces (preserves cross-series differences)
  const rawForceSnapshots = rawForces.fate.map((_, i) => ({
    fate: rawForces.fate[i],
    world: rawForces.world[i],
    system: rawForces.system[i],
  }));
  const swings = computeSwingMagnitudes(rawForceSnapshots, FORCE_REFERENCE_MEANS);

  // Peaks and valleys
  const peakIndices = activityCurve.filter((e) => e.isPeak).map((e) => e.index);
  const valleyIndices = activityCurve.filter((e) => e.isValley).map((e) => e.index);

  // Segments: split at valleys (use z-score normalized forces for classification)
  const segments = buildSegments(scenes, activityCurve, forceSnapshots, valleyIndices);

  // Peak info — fall back to absolute max delivery if no prominent peaks detected
  let peaks = buildPeakInfos(scenes, activityCurve, forceSnapshots, narrative);
  if (peaks.length === 0 && activityCurve.length > 0) {
    const maxPoint = activityCurve.reduce((best, e) => (e.activity > best.activity ? e : best), activityCurve[0]);
    const scene = scenes[maxPoint.index];
    const f = forceSnapshots[maxPoint.index];
    const corner = detectCubeCorner(f);
    peaks = [{
      sceneIdx: maxPoint.index,
      scene,
      activity: maxPoint,
      forces: f,
      cubeCorner: { key: corner.key, name: corner.name, description: corner.description },
      threadChanges: scene.threadDeltas.map((tm) => ({ threadId: tm.threadId, logType: tm.logType, updates: tm.updates ?? [] })),
      relationshipChanges: scene.relationshipDeltas.map((rm) => ({
        from: rm.from, to: rm.to, type: rm.type, delta: rm.valenceDelta,
      })),
      dominantForce: dominantForce(f.fate, f.world, f.system),
    }];
  }

  // Trough info — fall back to absolute min delivery if no valleys detected
  let troughs = buildTroughInfos(scenes, activityCurve, forceSnapshots, peakIndices, narrative);
  if (troughs.length === 0 && activityCurve.length > 1) {
    const minPoint = activityCurve.reduce((best, e) => (e.activity < best.activity ? e : best), activityCurve[0]);
    const scene = scenes[minPoint.index];
    const f = forceSnapshots[minPoint.index];
    const corner = detectCubeCorner(f);
    const nextPeak = peakIndices.find((pi) => pi > minPoint.index);
    const scenesToNextPeak = nextPeak !== undefined ? nextPeak - minPoint.index : scenes.length - minPoint.index;
    let recoveryForce: TroughInfo['recoveryForce'] = null;
    if (minPoint.index + 3 < forceSnapshots.length) {
      const df = forceSnapshots[minPoint.index + 3].fate - f.fate;
      const dw = forceSnapshots[minPoint.index + 3].world - f.world;
      const ds = forceSnapshots[minPoint.index + 3].system - f.system;
      const maxDelta = Math.max(df, dw, ds);
      if (maxDelta > 0) {
        recoveryForce = df === maxDelta ? 'fate' : dw === maxDelta ? 'world' : 'system';
      }
    }
    troughs = [{
      sceneIdx: minPoint.index,
      scene,
      activity: minPoint,
      forces: f,
      cubeCorner: { key: corner.key, name: corner.name, description: corner.description },
      scenesToNextPeak,
      recoveryForce,
    }];
  }

  // Cube distribution & transitions
  const corners = forceSnapshots.map((f) => detectCubeCorner(f));
  const cubeDistribution = {} as Record<CubeCornerKey, number>;
  for (const key of Object.keys(NARRATIVE_CUBE) as CubeCornerKey[]) cubeDistribution[key] = 0;
  for (const c of corners) cubeDistribution[c.key]++;

  const transitionMap = new Map<string, number>();
  for (let i = 1; i < corners.length; i++) {
    const key = `${corners[i - 1].key}->${corners[i].key}`;
    transitionMap.set(key, (transitionMap.get(key) ?? 0) + 1);
  }
  const cubeTransitions = Array.from(transitionMap.entries())
    .map(([key, count]) => {
      const [from, to] = key.split('->') as [CubeCornerKey, CubeCornerKey];
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // Thread lifecycles
  const threadLifecycles = buildThreadLifecycles(narrative, scenes, resolvedEntryKeys);

  // Thread convergences
  const threadConvergences: SlidesData['threadConvergences'] = [];
  const convSet = new Set<string>();
  for (const t of Object.values(narrative.threads)) {
    for (const depId of t.dependents ?? []) {
      if (!narrative.threads[depId]) continue;
      const key = [t.id, depId].sort().join('|');
      if (!convSet.has(key)) {
        convSet.add(key);
        threadConvergences.push({ fromId: t.id, toId: depId });
      }
    }
  }

  // Top characters by participation
  const charCounts = new Map<string, number>();
  for (const s of scenes) {
    for (const pid of s.participantIds) {
      charCounts.set(pid, (charCounts.get(pid) ?? 0) + 1);
    }
  }
  const topCharacters = Array.from(charCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({ character: narrative.characters[id], sceneCount: count }))
    .filter((c) => c.character);

  // Top locations
  const locCounts = new Map<string, number>();
  for (const s of scenes) {
    locCounts.set(s.locationId, (locCounts.get(s.locationId) ?? 0) + 1);
  }
  const topLocations = Array.from(locCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({ location: narrative.locations[id], sceneCount: count }))
    .filter((l) => l.location);

  // Top artifacts by usage count
  const artUsageCounts = new Map<string, number>();
  for (const s of scenes) {
    for (const au of s.artifactUsages ?? []) {
      artUsageCounts.set(au.artifactId, (artUsageCounts.get(au.artifactId) ?? 0) + 1);
    }
  }
  // Include zero-usage artifacts so they appear
  for (const art of Object.values(narrative.artifacts ?? {})) {
    if (!artUsageCounts.has(art.id)) artUsageCounts.set(art.id, 0);
  }
  const topArtifacts = Array.from(artUsageCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({ artifact: narrative.artifacts[id], usageCount: count }))
    .filter((a) => a.artifact);

  // Grades
  const arcIds = Object.keys(narrative.arcs);
  const sceneIdToIdx = new Map(scenes.map((s, i) => [s.id, i]));
  const arcGrades: ArcGrade[] = [];
  for (const arcId of arcIds) {
    const arc = narrative.arcs[arcId];
    const indices = arc.sceneIds.map((sid) => sceneIdToIdx.get(sid)).filter((i): i is number => i !== undefined);
    if (indices.length === 0) continue;
    const af = indices.map((i) => rawForces.fate[i]);
    const aw = indices.map((i) => rawForces.world[i]);
    const as = indices.map((i) => rawForces.system[i]);
    const as_ = indices.map((i) => swings[i]);
    arcGrades.push({
      arcId,
      arcName: arc.name,
      sceneCount: indices.length,
      grades: gradeForces(af, aw, as, as_),
    });
  }

  const overallGrades = gradeForces(rawForces.fate, rawForces.world, rawForces.system, swings);

  // Beat profile data from scene plans
  const beatSampler = computeSamplerFromPlans(scenes);
  const beatSequence: string[] = [];
  for (const s of scenes) {
    const latestPlan = s.planVersions?.[s.planVersions.length - 1]?.plan;
    if (latestPlan?.beats) {
      for (const b of latestPlan.beats) beatSequence.push(b.fn);
    }
  }

  // Proposition classification data — lightweight counts from plans (no embeddings needed)
  // The actual classification with embeddings happens in proposition-classify.ts
  // Here we just count propositions per scene/arc for the slides
  const propositionTotals: Record<PropositionBaseCategory, number> = { Anchor: 0, Seed: 0, Close: 0, Texture: 0 };
  let propositionCount = 0;
  const propositionTimeline: SlidesData['propositionTimeline'] = [];
  const arcPropMap = new Map<string, { arcName: string; totals: Record<PropositionBaseCategory, number>; total: number }>();

  // These are populated later by the classification hook if available
  // For now, count raw propositions per scene for the timeline shape
  for (let si = 0; si < scenes.length; si++) {
    const s = scenes[si];
    const plan = s.planVersions?.[s.planVersions.length - 1]?.plan;
    if (!plan?.beats) {
      propositionTimeline.push({ sceneIdx: si, totals: { Anchor: 0, Seed: 0, Close: 0, Texture: 0 }, total: 0 });
      continue;
    }
    let sceneTotal = 0;
    for (const b of plan.beats) {
      sceneTotal += b.propositions?.length ?? 0;
    }
    propositionCount += sceneTotal;
    // Default: all uncategorized until classification runs
    propositionTimeline.push({ sceneIdx: si, totals: { Anchor: 0, Seed: 0, Close: 0, Texture: 0 }, total: sceneTotal });
  }

  return {
    title: narrative.title,
    description: narrative.description,
    sceneCount: n,
    arcCount: arcIds.length,
    characterCount: Object.keys(narrative.characters).length,
    locationCount: Object.keys(narrative.locations).length,
    threadCount: Object.keys(narrative.threads).length,
    coverImageUrl: narrative.coverImageUrl,
    scenes,
    forceSnapshots,
    rawForces,
    activityCurve,
    shape,
    swings,
    segments,
    peaks,
    troughs,
    cubeDistribution,
    cubeTransitions,
    threadLifecycles,
    threadConvergences,
    topCharacters,
    topLocations,
    topArtifacts,
    overallGrades: overallGrades,
    archetype: classifyArchetype(overallGrades),
    scale: classifyScale(scenes.length),
    density: classifyWorldDensity(
      scenes.length,
      Object.keys(narrative.characters).length,
      Object.keys(narrative.locations).length,
      Object.keys(narrative.threads).length,
      Object.keys(narrative.systemGraph?.nodes ?? {}).length,
    ),
    arcGrades,
    beatSampler,
    beatSequence,
    propositionTotals,
    propositionCount,
    propositionByArc: Array.from(arcPropMap.values()),
    propositionTimeline,
    characterNames: Object.fromEntries(Object.entries(narrative.characters).map(([id, c]) => [id, c.name])),
    locationNames: Object.fromEntries(Object.entries(narrative.locations).map(([id, l]) => [id, l.name])),
    threadDescriptions: Object.fromEntries(Object.entries(narrative.threads).map(([id, t]) => [id, t.description])),

    // ── World-view-specific fields ──────────────────────────────────────────
    paradigm: narrative.paradigm ?? null,
    signature: sig,
    beliefs: buildBeliefSnapshots(narrative, cumulativeEntryKeys, resolvedEntryKeys),
    knowledgeStructure: buildKnowledgeStructure(narrative, resolvedEntryKeys),
  };
}

// ── Slide regions ──────────────────────────────────────────────────────────────
//
// A Region is composed of whole arcs; its scene slice is resolved from the
// arcs' sceneIds against the current branch's resolved timeline. computeSlidesData
// then runs unchanged over that slice — a region deck IS the summative deck,
// just over fewer scenes.

/** Resolve a region to the slice of `resolvedEntryKeys` it covers — the scenes
 *  belonging to any of the region's arcs, in timeline order. Robust to branch
 *  gaps (arcs whose scenes aren't in this branch simply contribute nothing). */
export function resolveRegionKeys(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  region: Region,
): string[] {
  const sceneIds = new Set<string>();
  for (const arcId of region.arcIds) {
    for (const sid of narrative.arcs[arcId]?.sceneIds ?? []) sceneIds.add(sid);
  }
  return resolvedEntryKeys.filter((k) => sceneIds.has(k));
}

/** Scene-number span of a region within the resolved timeline, for labels:
 *  `{ count, firstNum, lastNum }` where numbers are 1-based positions among the
 *  scenes in `resolvedEntryKeys` (world commits and gaps don't count). */
export function regionSceneSpan(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  region: Region,
): { count: number; firstNum: number; lastNum: number } {
  // Position of each scene key among scenes-only, 1-based.
  const sceneNum = new Map<string, number>();
  let n = 0;
  for (const k of resolvedEntryKeys) {
    if (narrative.scenes[k]) sceneNum.set(k, ++n);
  }
  const keys = resolveRegionKeys(narrative, resolvedEntryKeys, region);
  const nums = keys.map((k) => sceneNum.get(k)).filter((x): x is number => x !== undefined);
  if (nums.length === 0) return { count: 0, firstNum: 0, lastNum: 0 };
  return { count: nums.length, firstNum: Math.min(...nums), lastNum: Math.max(...nums) };
}

/** Arcs in timeline order — ordered by the first resolved scene that belongs to
 *  each arc. Arcs with no scene in the current branch are dropped. Used by the
 *  region-config modal's arc checklist. */
export function arcsInTimelineOrder(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
): Arc[] {
  const arcs = Object.values(narrative.arcs);
  const firstPos = new Map<string, number>();
  for (let i = 0; i < resolvedEntryKeys.length; i++) {
    const key = resolvedEntryKeys[i];
    if (!narrative.scenes[key]) continue;
    for (const arc of arcs) {
      if (!firstPos.has(arc.id) && arc.sceneIds.includes(key)) firstPos.set(arc.id, i);
    }
  }
  return arcs
    .filter((a) => firstPos.has(a.id))
    .sort((a, b) => firstPos.get(a.id)! - firstPos.get(b.id)!);
}

// ── World-view helpers ────────────────────────────────────────────────────────

/** How many live beliefs get a full per-scene trajectory replay attached.
 *  Trajectory replay is O(scenes × outcomes) per thread; capping the top-N
 *  keeps the slide computation cheap on long narratives while still letting
 *  the slide render meaningful prediction graphs for the load-bearing
 *  questions. The rest get an empty trajectory and render as stance-only. */
const BELIEF_TRAJECTORY_CAP = 8;

/** How much a belief's distribution MOVED across its (period-scoped) trajectory
 *  — summed total-variation distance between consecutive scenes. This is the
 *  "volatility in this period": a question whose lean swung hard scores high; a
 *  flat one scores ~0. Outcome arrays can grow mid-trajectory (addOutcomes), so
 *  compare over the longer length with missing entries treated as 0. */
function trajectoryMovement(points: { probs: number[] }[]): number {
  let tv = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].probs;
    const b = points[i].probs;
    const len = Math.max(a.length, b.length);
    let d = 0;
    for (let k = 0; k < len; k++) d += Math.abs((b[k] ?? 0) - (a[k] ?? 0));
    tv += d / 2; // total-variation distance ∈ [0,1] per step
  }
  return tv;
}

/** Snapshot the belief system as of the END of the deck's window, built
 *  CUMULATIVELY from the narrative's start — every prior arc's evidence shapes
 *  each stance, so a region deck shows the same outcomes the reader would hold
 *  arriving at the region's end (not a stance re-seeded from the region alone).
 *
 *  `cumulativeKeys` runs narrative-start → end-of-window (full timeline for the
 *  whole-narrative deck; start → region-end for a region deck). `periodKeys` is
 *  the deck's own window (the region's scenes; === cumulativeKeys for the full
 *  deck) — used only to rank by VOLATILITY IN THIS PERIOD (how much each lean
 *  moved within the window) so the slide features the questions that churned
 *  most here. Threads not yet introduced by window-end, or closed/abandoned by
 *  then, are dropped. Trajectories (cumulative) attach to the top-N. */
function buildBeliefSnapshots(
  narrative: NarrativeState,
  cumulativeKeys: string[],
  periodKeys: string[],
): BeliefSnapshot[] {
  if (cumulativeKeys.length === 0) return [];
  // Replay every thread to its state at window-end, and the set actually in
  // play by then — so outcomes reflect all prior arcs, and not-yet-introduced
  // threads (backfilled at prior by the replay) are excluded.
  const lastIdx = cumulativeKeys.length - 1;
  const asOf = replayThreadsAtIndex(narrative, cumulativeKeys, lastIdx);
  const introduced = introducedThreadIdsAtIndex(narrative, cumulativeKeys, lastIdx);
  const periodSet = new Set(periodKeys);

  const snapshots: BeliefSnapshot[] = [];
  for (const thread of Object.values(asOf)) {
    if (!introduced.has(thread.id)) continue; // not in play yet at window-end
    if (isThreadClosed(thread) || isThreadAbandoned(thread)) continue;
    const stance = getThreadStance(thread);
    if (!stance) continue;
    const probs = getStanceProbs(thread);
    const { topIdx, margin } = getStanceMargin(thread);
    const lean = thread.outcomes[topIdx] ?? '';
    const participantNames = thread.participants.map((p) => {
      if (p.type === 'character') return narrative.characters[p.id]?.name ?? p.id;
      if (p.type === 'location') return narrative.locations[p.id]?.name ?? p.id;
      if (p.type === 'artifact') return narrative.artifacts?.[p.id]?.name ?? p.id;
      return p.id;
    });
    snapshots.push({
      threadId: thread.id,
      description: thread.description,
      participantNames,
      category: classifyThreadCategory(thread),
      lean,
      pLean: probs[topIdx] ?? 0,
      margin,
      volume: stance.volume,
      volatility: stance.volatility,
      outcomes: thread.outcomes.map((name, i) => ({ name, p: probs[i] ?? 0 })),
      trajectory: [],
    });
  }

  // Cumulative trajectory per belief; rank by how much it moved WITHIN this
  // period (total variation over the window's points), tiebreak by volume.
  const withTraj = snapshots.map((snap) => {
    const points = buildThreadTrajectory(narrative, snap.threadId, cumulativeKeys);
    const periodPoints = points.filter((p) => periodSet.has(p.sceneId));
    return { snap, points, movement: trajectoryMovement(periodPoints) };
  });
  withTraj.sort((a, b) => (b.movement - a.movement) || (b.snap.volume - a.snap.volume));

  return withTraj.map(({ snap, points }, i) => {
    snap.trajectory = i < BELIEF_TRAJECTORY_CAP
      ? points.map((p) => ({ sceneOrdinal: p.sceneOrdinal, probs: p.probs, outcomes: p.outcomes }))
      : [];
    return snap;
  });
}

/** Summarise the system graph — counts per node type, edge count, and the
 *  ranked nodes by impact (degree + attributions + reach). Mirrors the
 *  sidebar's KnowledgePanel scoring so the slide's ranking matches what an
 *  operator sees in the inspector. */
function buildKnowledgeStructure(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
): KnowledgeStructure {
  const graph = narrative.systemGraph;
  const nodes = Object.values(graph?.nodes ?? {});
  const edges = graph?.edges ?? [];
  const nodesByType: Partial<Record<SystemNodeType, number>> = {};
  for (const node of nodes) {
    nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;
  }
  // Score the cumulative graph as of the full timeline — slides always
  // present the complete world view, not a mid-arc snapshot.
  const ranked = scoreSystemNodes(narrative, resolvedEntryKeys).map((r) => ({
    id: r.node.id,
    concept: r.node.concept,
    type: r.node.type,
    degree: r.degree,
    attributions: r.attributions,
    reach: r.reach,
    score: r.score,
  }));
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodesByType,
    rankedNodes: ranked,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function buildSegments(
  scenes: Scene[],
  dlvPts: ActivityPoint[],
  forces: ForceSnapshot[],
  valleyIndices: number[],
): Segment[] {
  const n = scenes.length;
  if (n === 0) return [];

  // Build split points from valleys
  const splits = [0, ...valleyIndices.filter((v) => v > 0 && v < n - 1), n - 1];
  // Deduplicate and sort
  const uniqueSplits = Array.from(new Set(splits)).sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < uniqueSplits.length - 1; i++) {
    const startIdx = i === 0 ? uniqueSplits[i] : uniqueSplits[i] + 1;
    const endIdx = uniqueSplits[i + 1];
    if (startIdx > endIdx) continue;

    const segDelivery = dlvPts.slice(startIdx, endIdx + 1);
    const segPeaks = segDelivery.filter((e) => e.isPeak).map((e) => e.index);

    // Average z-score normalized forces in segment
    const segForces = forces.slice(startIdx, endIdx + 1);
    const segFate = avg(segForces.map((f) => f.fate));
    const segWorld = avg(segForces.map((f) => f.world));
    const segSystem = avg(segForces.map((f) => f.system));

    // Thread changes in this segment
    const threadChanges: Segment['threadChanges'] = [];
    for (let si = startIdx; si <= endIdx; si++) {
      for (const tm of scenes[si].threadDeltas) {
        threadChanges.push({ threadId: tm.threadId, logType: tm.logType, updates: tm.updates ?? [], sceneIdx: si });
      }
    }

    // Key scenes: peaks + highest information scenes
    const segMaxInfo = Math.max(...segDelivery.map((se) => se.activity));
    const keyScenes = segDelivery
      .filter((e) => e.isPeak || e.activity === segMaxInfo)
      .slice(0, 3)
      .map((e) => ({
        idx: e.index,
        summary: scenes[e.index]?.summary ?? '',
        activity: e.activity,
      }));

    segments.push({
      index: i,
      startIdx,
      endIdx,
      activity: segDelivery,
      dominantForce: dominantForce(segFate, segWorld, segSystem),
      threadChanges,
      peakIndices: segPeaks,
      avgActivity: avg(segDelivery.map((e) => e.activity)),
      keyScenes,
    });
  }

  return segments;
}

function buildPeakInfos(
  scenes: Scene[],
  points: ActivityPoint[],
  forces: ForceSnapshot[],
  _narrative: NarrativeState,
): PeakInfo[] {
  return points
    .filter((e) => e.isPeak)
    .map<PeakInfo>((e) => {
      const scene = scenes[e.index];
      const f = forces[e.index];
      const corner = detectCubeCorner(f);
      return {
        sceneIdx: e.index,
        scene,
        activity: e,
        forces: f,
        cubeCorner: { key: corner.key, name: corner.name, description: corner.description },
        threadChanges: scene.threadDeltas.map((tm) => ({ threadId: tm.threadId, logType: tm.logType, updates: tm.updates ?? [] })),
        relationshipChanges: scene.relationshipDeltas.map((rm) => ({
          from: rm.from, to: rm.to, type: rm.type, delta: rm.valenceDelta,
        })),
        dominantForce: dominantForce(f.fate, f.world, f.system),
      };
    })
    .sort((a, b) => b.activity.activity - a.activity.activity);
}

function buildTroughInfos(
  scenes: Scene[],
  delivery: ActivityPoint[],
  forces: ForceSnapshot[],
  peakIndices: number[],
  _narrative: NarrativeState,
): TroughInfo[] {
  return delivery
    .filter((e) => e.isValley)
    .map((e) => {
      const scene = scenes[e.index];
      const f = forces[e.index];
      const corner = detectCubeCorner(f);

      // Find next peak
      const nextPeak = peakIndices.find((pi) => pi > e.index);
      const scenesToNextPeak = nextPeak !== undefined ? nextPeak - e.index : scenes.length - e.index;

      // Recovery force: check the next 3 scenes to see which force rises most
      let recoveryForce: TroughInfo['recoveryForce'] = null;
      if (e.index + 3 < forces.length) {
        const df = forces[e.index + 3].fate - f.fate;
        const dw = forces[e.index + 3].world - f.world;
        const ds = forces[e.index + 3].system - f.system;
        const maxDelta = Math.max(df, dw, ds);
        if (maxDelta > 0) {
          recoveryForce = df === maxDelta ? 'fate' : dw === maxDelta ? 'world' : 'system';
        }
      }

      const info: TroughInfo = {
        sceneIdx: e.index,
        scene,
        activity: e,
        forces: f,
        cubeCorner: { key: corner.key, name: corner.name, description: corner.description },
        scenesToNextPeak,
        recoveryForce,
      };
      return info;
    })
    .sort((a, b) => a.activity.activity - b.activity.activity);
}

function buildThreadLifecycles(
  narrative: NarrativeState,
  scenes: Scene[],
  resolvedEntryKeys: string[],
): ThreadLifecycle[] {
  const threads = Object.values(narrative.threads);

  // Build scene key → index map for looking up openedAt.
  const sceneKeyToIdx = new Map<string, number>();
  for (let i = 0; i < resolvedEntryKeys.length; i++) {
    sceneKeyToIdx.set(resolvedEntryKeys[i], i);
  }

  return threads.map((thread) => {
    // Find all scenes that emit evidence for this thread.
    const deltas: { sceneIdx: number; logType: string; peakEvidence: number }[] = [];
    for (let i = 0; i < scenes.length; i++) {
      for (const tm of scenes[i].threadDeltas) {
        if (tm.threadId === thread.id) {
          const peak = Math.max(0, ...((tm.updates ?? []).map((u) => Math.abs(u.evidence))));
          deltas.push({ sceneIdx: i, logType: tm.logType, peakEvidence: peak });
        }
      }
    }

    if (deltas.length === 0) return null;

    const openedAtIdx = sceneKeyToIdx.get(thread.openedAt) ?? deltas[0].sceneIdx;
    const firstDeltaIdx = deltas[0].sceneIdx;
    const startIdx = Math.min(openedAtIdx, firstDeltaIdx);

    // Market trajectory — render per-scene state as a tuple of (logType, peak evidence).
    const statuses: { sceneIdx: number; status: string }[] = [];
    let mutIdx = 0;
    let currentLabel = 'open';

    for (let i = startIdx; i < scenes.length; i++) {
      while (mutIdx < deltas.length && deltas[mutIdx].sceneIdx === i) {
        currentLabel = deltas[mutIdx].logType;
        mutIdx++;
      }
      statuses.push({ sceneIdx: i, status: currentLabel });
      if (currentLabel === 'payoff' || currentLabel === 'twist') break;
      if (mutIdx >= deltas.length && i > deltas[deltas.length - 1].sceneIdx) break;
    }

    return {
      threadId: thread.id,
      description: thread.description,
      statuses,
    };
  }).filter((tl): tl is ThreadLifecycle => tl !== null && tl.statuses.length > 0);
}
