// Force formulas + graph/cube/stance algorithms — the deterministic math deriving Fate/World/System from deltas.

import type { Branch, NarrativeState, Scene, Thread, Stance, OutcomeEvidence, ThreadDelta, ForceSnapshot, CubeCornerKey, CubeCorner, SystemGraph, SystemNode, SystemEdge, SystemDelta, WorldBuild, Character, Location, Artifact } from '@/types/narrative';
import { getSceneSystemAttributions } from '@/lib/graph/system-graph';
import { NARRATOR_ID } from '@/types/narrative';
import {
  STANCE_EVIDENCE_SENSITIVITY,
  STANCE_EVIDENCE_MIN,
  STANCE_EVIDENCE_MAX,
  STANCE_TAU_CLOSE,
  STANCE_NEAR_CLOSED_MIN,
  STANCE_VOLUME_DECAY,
  STANCE_ABANDON_VOLUME,
  STANCE_VOLATILITY_BETA,
  STANCE_RECENCY_DECAY,
  STANCE_FOCUS_K,
} from '@/lib/constants';
import { NARRATIVE_CUBE } from '@/types/narrative';
import {
  FORCE_WINDOW_SIZE,
  PEAK_WINDOW_SCENES_DIVISOR,
  SHAPE_TROUGH_BAND_LO,
  SHAPE_TROUGH_BAND_HI,
  BEAT_DENSITY_MIN,
  BEAT_DENSITY_MAX,
  FORCE_DOMINANCE_WEIGHTS,
  DELIVERY_SMOOTH_SIGMA,
} from '@/lib/constants';

// ── Canon branch ────────────────────────────────────────────────────────────

/**
 * Return the world view's CANON branch id — the branch treated as the
 * official record. Falls back to the oldest branch (the original / root
 * trunk) when `canonBranchId` is unset, so every narrative resolves to
 * exactly one canon branch even if the field was never explicitly set.
 *
 * Returns null only when the narrative has no branches at all (which
 * shouldn't happen after creation, but the API stays total).
 */
export function resolveCanonBranchId(narrative: NarrativeState): string | null {
  const explicit = narrative.canonBranchId;
  if (explicit && narrative.branches[explicit]) return explicit;
  const branches = Object.values(narrative.branches);
  if (branches.length === 0) return null;
  let oldest = branches[0];
  for (const b of branches) {
    if (b.createdAt < oldest.createdAt) oldest = b;
  }
  return oldest.id;
}

/** Convenience over `resolveCanonBranchId` — returns the Branch object
 *  (or null when the narrative has none). */
export function resolveCanonBranch(narrative: NarrativeState): Branch | null {
  const id = resolveCanonBranchId(narrative);
  return id ? narrative.branches[id] ?? null : null;
}

/** True iff the given branch id is the canon for this narrative. Cheap
 *  to call from JSX (UI surfaces use it to render canon distinction). */
export function isCanonBranch(narrative: NarrativeState, branchId: string): boolean {
  return resolveCanonBranchId(narrative) === branchId;
}

// ── Scene & entity helpers ──────────────────────────────────────────────────

/** The POV character a scene effectively renders through — the declared povId
 *  if valid, otherwise the first participant. Returns undefined only if the
 *  scene has no participants either. */
export function getEffectivePovId(scene: Scene): string | undefined {
  return scene.povId || scene.participantIds[0];
}

/** Resolve a character/location/artifact id to its display name. Returns the
 *  id itself only as a last-resort fallback — callers should treat that as a
 *  data-integrity signal rather than expected behaviour. Null/undefined ids
 *  resolve to "nowhere" (used by ownership deltas with no prior/next owner). */
export function resolveEntityName(narrative: NarrativeState, id: string | null | undefined): string {
  if (!id) return 'nowhere';
  return (
    narrative.characters[id]?.name ??
    narrative.locations[id]?.name ??
    narrative.artifacts[id]?.name ??
    id
  );
}

// ── Sequential ID generation ─────────────────────────────────────────────────

/**
 * Canonical entity ID format: `<PREFIX>-<N>` (or `<PREFIX>-<WORK>-<N>` for analyzed
 * works). No leading zeros — `SYS-7` is canonical, `SYS-07` / `SYS-007` would alias
 * to the same counter value and are not produced. Allocators reject leading-zero
 * forms on emit; parsers read them tolerantly so historical data still loads.
 */

/**
 * Extract the numeric suffix from an entity ID (e.g., "C-1" → 1, "S-12" → 12).
 * Permissive read: tolerates historical zero-padded forms ("C-01" → 1, "S-007" → 7)
 * so the allocator's seed scan still finds the correct max counter across old data.
 * Returns 0 if no trailing number is present.
 */
function extractIdNumber(id: string): number {
  const match = id.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Compute the next sequential ID for a given prefix by scanning existing IDs in
 * the narrative. Emits canonical unpadded form: `${prefix}-${n}`.
 */
export function nextId(prefix: string, existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const n = extractIdNumber(id);
    if (n > max) max = n;
  }
  return `${prefix}-${max + 1}`;
}

/**
 * Generate a batch of sequential IDs starting from the next available number.
 */
export function nextIds(prefix: string, existingIds: string[], count: number): string[] {
  let max = 0;
  for (const id of existingIds) {
    const n = extractIdNumber(id);
    if (n > max) max = n;
  }
  return Array.from({ length: count }, (_, i) => `${prefix}-${max + 1 + i}`);
}

/**
 * Resolve the full entry sequence for a branch by walking up to root.
 * Root branch returns its own entryIds.
 * Child branch returns parent's resolved sequence up to forkEntryId (inclusive) + own entryIds.
 */
export function resolveEntrySequence(
  branches: Record<string, Branch>,
  branchId: string,
): string[] {
  const branch = branches[branchId];
  if (!branch) return [];

  // Root branch — just its own entries
  if (!branch.parentBranchId) return branch.entryIds;

  // Recursively resolve parent
  const parentSequence = resolveEntrySequence(branches, branch.parentBranchId);

  // Find the fork point in the parent sequence
  if (branch.forkEntryId) {
    const forkIdx = parentSequence.indexOf(branch.forkEntryId);
    if (forkIdx >= 0) {
      return [...parentSequence.slice(0, forkIdx + 1), ...branch.entryIds];
    }
  }

  // Fallback: append after full parent sequence
  return [...parentSequence, ...branch.entryIds];
}

// ── Prose/Plan Version Resolution ────────────────────────────────────────────
// These functions resolve which prose/plan version a branch should see,
// based on branch lineage and fork timestamps.

import type { BeatPlan, BeatProseMap, ProseScore } from '@/types/narrative';

export type ResolvedProse = {
  prose?: string;
  beatProseMap?: BeatProseMap;
  proseScore?: ProseScore;
};

/**
 * Resolve prose for a scene as viewed by a specific branch.
 * Uses branch lineage and fork timestamps to find the appropriate version.
 *
 * Resolution order:
 * 0. If this branch has an explicit version pointer, use that version
 * 1. If this branch has its own version, use the latest one
 * 2. Otherwise, check parent branch (filtered by fork time)
 * 3. Return empty (no prose yet)
 */
export function resolveProseForBranch(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
): ResolvedProse {
  const branch = branches[branchId];
  if (!branch) {
    return { prose: undefined, beatProseMap: undefined, proseScore: undefined };
  }

  // 0. Check for explicit version pointer
  const pointer = branch.versionPointers?.[scene.id]?.proseVersion;
  if (pointer) {
    const pinned = (scene.proseVersions ?? []).find(v => v.version === pointer);
    if (pinned) {
      return { prose: pinned.prose, beatProseMap: pinned.beatProseMap, proseScore: pinned.proseScore };
    }
  }

  // 1. Check if this branch has its own version
  const ownVersions = (scene.proseVersions ?? [])
    .filter(v => v.branchId === branchId)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (ownVersions.length > 0) {
    const v = ownVersions[0];
    return { prose: v.prose, beatProseMap: v.beatProseMap, proseScore: v.proseScore };
  }

  // 2. Check parent, filtered by fork time
  if (branch.parentBranchId) {
    const resolved = resolveProseAtTime(scene, branch.parentBranchId, branches, branch.createdAt);
    if (resolved.prose !== undefined) return resolved;
  }

  // 3. Defensive fallback: analysis-runner-assembled narratives may carry prose
  // versions with a placeholder branchId ("main") that does not match any real
  // branch. If we still have versions on the scene and every prior path failed
  // to find one, fall back to the latest version by timestamp. Prevents a
  // scene with real prose from rendering as "V0".
  const allVersions = (scene.proseVersions ?? [])
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);
  if (allVersions.length > 0) {
    const v = allVersions[0];
    return { prose: v.prose, beatProseMap: v.beatProseMap, proseScore: v.proseScore };
  }

  // 4. No prose yet
  return { prose: undefined, beatProseMap: undefined, proseScore: undefined };
}

/**
 * Internal helper: resolve prose for a branch, only considering versions created before maxTime.
 */
function resolveProseAtTime(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
  maxTime: number,
): ResolvedProse {
  const branch = branches[branchId];
  if (!branch) {
    return { prose: undefined, beatProseMap: undefined, proseScore: undefined };
  }

  // Versions from this branch, created before maxTime
  const versions = (scene.proseVersions ?? [])
    .filter(v => v.branchId === branchId && v.timestamp <= maxTime)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (versions.length > 0) {
    const v = versions[0];
    return { prose: v.prose, beatProseMap: v.beatProseMap, proseScore: v.proseScore };
  }

  // Recurse to parent
  if (branch.parentBranchId) {
    const parentForkTime = Math.min(maxTime, branch.createdAt);
    return resolveProseAtTime(scene, branch.parentBranchId, branches, parentForkTime);
  }

  return { prose: undefined, beatProseMap: undefined, proseScore: undefined };
}

/**
 * Resolve plan for a scene as viewed by a specific branch.
 * Uses branch lineage and fork timestamps to find the appropriate version.
 *
 * Resolution order:
 * 0. If this branch has an explicit version pointer, use that version
 * 1. If this branch has its own version, use the latest one
 * 2. Otherwise, check parent branch (filtered by fork time)
 * 3. Return undefined (no plan yet)
 */
export function resolvePlanForBranch(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
): BeatPlan | undefined {
  const branch = branches[branchId];
  if (!branch) return undefined;

  // 0. Check for explicit version pointer
  const pointer = branch.versionPointers?.[scene.id]?.planVersion;
  if (pointer) {
    const pinned = (scene.planVersions ?? []).find(v => v.version === pointer);
    if (pinned) {
      return pinned.plan;
    }
  }

  // 1. Check if this branch has its own version
  const ownVersions = (scene.planVersions ?? [])
    .filter(v => v.branchId === branchId)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (ownVersions.length > 0) {
    return ownVersions[0].plan;
  }

  // 2. Check parent, filtered by fork time
  if (branch.parentBranchId) {
    const resolved = resolvePlanAtTime(scene, branch.parentBranchId, branches, branch.createdAt);
    if (resolved !== undefined) return resolved;
  }

  // 3. Defensive fallback: same rationale as resolveProseForBranch — handle
  // assembled narratives whose version objects carry a placeholder branchId.
  const allVersions = (scene.planVersions ?? [])
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);
  if (allVersions.length > 0) {
    return allVersions[0].plan;
  }

  // 4. No plan yet
  return undefined;
}

/**
 * Internal helper: resolve plan for a branch, only considering versions created before maxTime.
 */
function resolvePlanAtTime(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
  maxTime: number,
): BeatPlan | undefined {
  const branch = branches[branchId];
  if (!branch) return undefined;

  // Versions from this branch, created before maxTime
  const versions = (scene.planVersions ?? [])
    .filter(v => v.branchId === branchId && v.timestamp <= maxTime)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (versions.length > 0) {
    return versions[0].plan;
  }

  // Recurse to parent
  if (branch.parentBranchId) {
    const parentForkTime = Math.min(maxTime, branch.createdAt);
    return resolvePlanAtTime(scene, branch.parentBranchId, branches, parentForkTime);
  }

  return undefined;
}

/**
 * Get the version string of the resolved prose for a scene and branch.
 * Returns undefined if using legacy (unversioned) prose.
 */
export function getResolvedProseVersion(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
): string | undefined {
  const branch = branches[branchId];
  if (!branch) return undefined;

  // Check for explicit version pointer
  const pointer = branch.versionPointers?.[scene.id]?.proseVersion;
  if (pointer) {
    const pinned = (scene.proseVersions ?? []).find(v => v.version === pointer);
    if (pinned) return pinned.version;
  }

  // Check this branch's versions
  const ownVersions = (scene.proseVersions ?? [])
    .filter(v => v.branchId === branchId)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (ownVersions.length > 0) {
    return ownVersions[0].version;
  }

  // Check parent
  if (branch.parentBranchId) {
    return getResolvedProseVersionAtTime(scene, branch.parentBranchId, branches, branch.createdAt);
  }

  return undefined;
}

function getResolvedProseVersionAtTime(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
  maxTime: number,
): string | undefined {
  const branch = branches[branchId];
  if (!branch) return undefined;

  const versions = (scene.proseVersions ?? [])
    .filter(v => v.branchId === branchId && v.timestamp <= maxTime)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (versions.length > 0) {
    return versions[0].version;
  }

  if (branch.parentBranchId) {
    const parentForkTime = Math.min(maxTime, branch.createdAt);
    return getResolvedProseVersionAtTime(scene, branch.parentBranchId, branches, parentForkTime);
  }

  return undefined;
}

/**
 * Get the version string of the resolved plan for a scene and branch.
 * Returns undefined if using legacy (unversioned) plan.
 */
export function getResolvedPlanVersion(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
): string | undefined {
  const branch = branches[branchId];
  if (!branch) return undefined;

  // Check for explicit version pointer
  const pointer = branch.versionPointers?.[scene.id]?.planVersion;
  if (pointer) {
    const pinned = (scene.planVersions ?? []).find(v => v.version === pointer);
    if (pinned) return pinned.version;
  }

  // Check this branch's versions
  const ownVersions = (scene.planVersions ?? [])
    .filter(v => v.branchId === branchId)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (ownVersions.length > 0) {
    return ownVersions[0].version;
  }

  // Check parent
  if (branch.parentBranchId) {
    return getResolvedPlanVersionAtTime(scene, branch.parentBranchId, branches, branch.createdAt);
  }

  return undefined;
}

function getResolvedPlanVersionAtTime(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
  maxTime: number,
): string | undefined {
  const branch = branches[branchId];
  if (!branch) return undefined;

  const versions = (scene.planVersions ?? [])
    .filter(v => v.branchId === branchId && v.timestamp <= maxTime)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (versions.length > 0) {
    return versions[0].version;
  }

  if (branch.parentBranchId) {
    const parentForkTime = Math.min(maxTime, branch.createdAt);
    return getResolvedPlanVersionAtTime(scene, branch.parentBranchId, branches, parentForkTime);
  }

  return undefined;
}

// ── Prediction-Market Primitives ───────────────────────────────────────────

/** Numerically stable softmax over logits. */
export function softmax(logits: number[]): number[] {
  if (logits.length === 0) return [];
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Shannon entropy (natural log) of a probability distribution. */
export function entropy(probs: number[]): number {
  let H = 0;
  for (const p of probs) {
    if (p > 0) H -= p * Math.log(p);
  }
  return H;
}

/** Uncertainty normalized to [0, 1]. Peaks at uniform distribution (1), zero
 *  at saturation (one outcome has all mass). N=2 case equals 4·p·(1−p). */
export function normalizedEntropy(probs: number[]): number {
  if (probs.length < 2) return 0;
  const maxH = Math.log(probs.length);
  if (maxH === 0) return 0;
  return entropy(probs) / maxH;
}

/** Clamp evidence to the allowed range. Evidence is a real number — decimal
 *  values are legitimate and let the LLM express calibrated partial nudges
 *  (e.g. +1.5 = meaningful shift, short of full setup; +2.8 = nearly an
 *  escalation). We round to one decimal to keep the log compact and the
 *  on-disk value predictable without losing calibration headroom. */
export function clampEvidence(e: number): number {
  if (!Number.isFinite(e)) return 0;
  const clamped = Math.max(STANCE_EVIDENCE_MIN, Math.min(STANCE_EVIDENCE_MAX, e));
  return Math.round(clamped * 10) / 10;
}

/** Apply evidence updates to a logit vector. Returns a new array. */
export function updateLogits(
  logits: number[],
  outcomes: string[],
  updates: OutcomeEvidence[],
  sensitivity: number = STANCE_EVIDENCE_SENSITIVITY,
): number[] {
  const out = logits.slice();
  for (const u of updates) {
    const idx = outcomes.indexOf(u.outcome);
    if (idx < 0) continue;
    out[idx] += clampEvidence(u.evidence) / sensitivity;
  }
  return out;
}

/** The narrator's stance on a thread. Phase 1 uses this as the canonical
 *  bearing the world view's belief aggregates from. */
export function getThreadStance(thread: Thread): Stance | undefined {
  return thread.stances?.[NARRATOR_ID];
}

/** Probability distribution over a thread's outcomes (narrator stance). */
export function getStanceProbs(thread: Thread): number[] {
  const stance = getThreadStance(thread);
  if (!stance) return new Array(thread.outcomes.length).fill(1 / thread.outcomes.length);
  return softmax(stance.logits);
}

/** Top-outcome probability and its runner-up margin in log-odds units.
 *  Margin above STANCE_TAU_CLOSE triggers closure. */
export function getStanceMargin(thread: Thread): { topIdx: number; topLogit: number; secondLogit: number; margin: number } {
  const stance = getThreadStance(thread);
  const logits = stance?.logits ?? new Array(thread.outcomes.length).fill(0);
  let topIdx = 0, topLogit = -Infinity, secondLogit = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (logits[i] > topLogit) {
      secondLogit = topLogit;
      topLogit = logits[i];
      topIdx = i;
    } else if (logits[i] > secondLogit) {
      secondLogit = logits[i];
    }
  }
  return { topIdx, topLogit, secondLogit, margin: topLogit - secondLogit };
}

/** Thread has committed to a winning outcome (closedAt set). */
export function isThreadClosed(thread: Thread): boolean {
  return thread.closedAt !== undefined && thread.closeOutcome !== undefined;
}

/** Thread is saturating — top-outcome margin in the near-closed band but not
 *  yet committed by an explicit payoff/twist event. */
export function isNearClosed(thread: Thread): boolean {
  if (isThreadClosed(thread)) return false;
  const { margin } = getStanceMargin(thread);
  return margin >= STANCE_NEAR_CLOSED_MIN && margin < STANCE_TAU_CLOSE;
}

/** Thread's volume has decayed below the abandonment floor. Not the same as
 *  closed — abandoned means the stance lost attention at any price. */
export function isThreadAbandoned(thread: Thread): boolean {
  if (isThreadClosed(thread)) return false;
  const stance = getThreadStance(thread);
  return (stance?.volume ?? 0) < STANCE_ABANDON_VOLUME;
}

/** The number of scenes since this thread's stance was last updated.
 *  Returns Infinity if the stance has never been touched. */
export function scenesSinceTouched(
  thread: Thread,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): number {
  const stance = getThreadStance(thread);
  if (!stance?.lastTouchedScene) return Infinity;
  const idx = resolvedEntryKeys.indexOf(stance.lastTouchedScene);
  if (idx < 0) return Infinity;
  return currentSceneIndex - idx;
}

/** Focus score — how much this thread should influence generation right now.
 *
 *   focus = volume × uncertainty × (1 + volatility) × recency_decay
 *
 * High when volume is strong, belief is contested, recent movement is high,
 * and the thread was touched recently. Closed / abandoned threads score 0. */
export function focusScore(
  thread: Thread,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): number {
  if (isThreadClosed(thread) || isThreadAbandoned(thread)) return 0;
  const belief = getThreadStance(thread);
  if (!belief) return 0;
  const probs = softmax(belief.logits);
  const uncertainty = normalizedEntropy(probs);
  const gap = scenesSinceTouched(thread, resolvedEntryKeys, currentSceneIndex);
  const recency = Number.isFinite(gap) ? Math.pow(STANCE_RECENCY_DECAY, gap) : 0;
  return belief.volume * uncertainty * (1 + belief.volatility) * recency;
}

/** Select the top-K threads by focus score. These are the threads the
 *  generation pipeline sees as "in play" on a given scene. */
export function selectFocusWindow(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
  k: number = STANCE_FOCUS_K,
): Thread[] {
  const scored = Object.values(narrative.threads)
    .map((t) => ({ t, s: focusScore(t, resolvedEntryKeys, currentSceneIndex) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map((x) => x.t);
}

/** Count distinct arcs where a thread received bandwidth (derived from scenes).
 *  Walks every scene in the narrative regardless of branch — use
 *  `computeBranchArcCoverage` when you need branch-scoped numbers (the
 *  inspector's "N/M arcs" pill, for instance, must match the canvas's
 *  ARC counter which is always branch-scoped). */
export function computeActiveArcs(threadId: string, scenes: Record<string, Scene>): number {
  const arcIds = new Set<string>();
  for (const scene of Object.values(scenes)) {
    if (scene.threadDeltas.some((tm) => tm.threadId === threadId)) {
      arcIds.add(scene.arcId);
    }
  }
  return arcIds.size;
}

/** Branch-scoped version of `computeActiveArcs`.
 *
 *  Returns `{ touched, total }` for the resolved branch:
 *    - `touched` = arcs on this branch that the thread actually fired in
 *    - `total`   = arcs on this branch (zero coerced to 1 for safe display)
 *
 *  Both numbers stay aligned with the canvas's ARC N/M counter, so a thread
 *  that read "6/6 arcs" against the unscoped narrative will read "4/4 arcs"
 *  here when the active branch only owns 4 arcs. */
export function computeBranchArcCoverage(
  threadId: string,
  scenes: Record<string, Scene>,
  resolvedKeys: string[],
): { touched: number; total: number } {
  const branchArcIds = new Set<string>();
  const touchedArcIds = new Set<string>();
  for (const key of resolvedKeys) {
    const scene = scenes[key];
    if (!scene) continue;
    if (scene.arcId) branchArcIds.add(scene.arcId);
    if (scene.threadDeltas.some((tm) => tm.threadId === threadId)) {
      if (scene.arcId) touchedArcIds.add(scene.arcId);
    }
  }
  return { touched: touchedArcIds.size, total: branchArcIds.size || 1 };
}

// ── Abandonment detection ──────────────────────────────────────────────────

export type AbandonedThread = {
  threadId: string;
  volume: number;
  scenesSinceTouched: number;
};

/** Threads whose volume has decayed below the abandonment floor and are not
 *  yet closed. These are candidates for cleanup or explicit revival. */
export function detectAbandonedThreads(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): AbandonedThread[] {
  const out: AbandonedThread[] = [];
  for (const t of Object.values(narrative.threads)) {
    if (!isThreadAbandoned(t)) continue;
    const belief = getThreadStance(t);
    out.push({
      threadId: t.id,
      volume: belief?.volume ?? 0,
      scenesSinceTouched: scenesSinceTouched(t, resolvedEntryKeys, currentSceneIndex),
    });
  }
  out.sort((a, b) => b.scenesSinceTouched - a.scenesSinceTouched);
  return out;
}

/** Classify a thread as storyline or incident based on log span and arc reach.
 *  Storyline: spans multiple arcs or accumulates many events. Incident: closed
 *  quickly or never accumulated events. */
export function classifyThreadKind(thread: Thread, scenes: Record<string, Scene>): 'storyline' | 'incident' {
  const activeArcs = computeActiveArcs(thread.id, scenes);
  const logSize = Object.keys(thread.threadLog?.nodes ?? {}).length;
  if (activeArcs > 2) return 'storyline';
  if (logSize >= 4) return 'storyline';
  if (isThreadClosed(thread) && activeArcs <= 2) return 'incident';
  return 'incident';
}

// ── Narrative Cube detection ───────────────────────────────────────────────

/** Euclidean distance between two force snapshots */
export function forceDistance(a: ForceSnapshot, b: ForceSnapshot): number {
  return Math.sqrt(
    (a.fate - b.fate) ** 2 +
    (a.world - b.world) ** 2 +
    (a.system - b.system) ** 2,
  );
}

/** Detect the nearest cube corner for a given force snapshot */
export function detectCubeCorner(forces: ForceSnapshot): CubeCorner {
  let best: CubeCorner = NARRATIVE_CUBE.LLL;
  let bestDist = Infinity;
  for (const corner of Object.values(NARRATIVE_CUBE)) {
    const d = forceDistance(forces, corner.forces);
    if (d < bestDist) {
      bestDist = d;
      best = corner;
    }
  }
  return best;
}

/** Returns the proximity (0-1) of forces to a specific cube corner. 1 = at the corner, 0+ = far away.
 *  Uses exponential decay so z-score values beyond ±1 still produce meaningful proximity. */
export function cubeCornerProximity(forces: ForceSnapshot, cornerKey: CubeCornerKey): number {
  const d = forceDistance(forces, NARRATIVE_CUBE[cornerKey].forces);
  return Math.exp(-d / 2);
}

/** Compute swing as Euclidean distance in force space between consecutive scenes.
 *  When reference means are provided, forces are normalized first so each
 *  dimension contributes equally regardless of natural scale.
 *  Returns an array of the same length; the first element is always 0. */
export function computeSwingMagnitudes(
  forceSnapshots: ForceSnapshot[],
  refMeans?: { fate: number; world: number; system: number },
): number[] {
  const rf = refMeans?.fate ?? 1;
  const rw = refMeans?.world ?? 1;
  const rs = refMeans?.system ?? 1;
  const swings: number[] = [0];
  for (let i = 1; i < forceSnapshots.length; i++) {
    const df = (forceSnapshots[i].fate - forceSnapshots[i - 1].fate) / rf;
    const dw = (forceSnapshots[i].world - forceSnapshots[i - 1].world) / rw;
    const ds = (forceSnapshots[i].system - forceSnapshots[i - 1].system) / rs;
    swings.push(Math.sqrt(df * df + dw * dw + ds * ds));
  }
  return swings;
}

/** Compute the average swing over a trailing window of force snapshots */
export function averageSwing(forceSnapshots: ForceSnapshot[], windowSize = FORCE_WINDOW_SIZE): number {
  if (forceSnapshots.length < 2) return 0;
  const swings = computeSwingMagnitudes(forceSnapshots);
  const window = swings.slice(-windowSize);
  return window.reduce((s, v) => s + v, 0) / window.length;
}

/** Default rolling window size for force computation (recency, windowed normalization) */
export { FORCE_WINDOW_SIZE } from '@/lib/constants';

// ── Beat Density Metrics ─────────────────────────────────────────────────────

/**
 * Compute beat density metrics for comparing analysis vs generation.
 * Returns beatsPerKWord, wordsPerBeat, and whether values fall within standard range (8-14).
 */
export function computeBeatMetrics(wordCount: number, beatCount: number) {
  const beatsPerKWord = beatCount > 0 && wordCount > 0
    ? (beatCount / wordCount) * 1000
    : 0;
  const wordsPerBeat = beatCount > 0 ? wordCount / beatCount : 0;

  return {
    beatsPerKWord: Math.round(beatsPerKWord * 10) / 10,
    wordsPerBeat: Math.round(wordsPerBeat),
    withinStandard: beatsPerKWord >= BEAT_DENSITY_MIN && beatsPerKWord <= BEAT_DENSITY_MAX,
  };
}

// ── Force Computation ────────────────────────────────────────────────────────

/**
 * Z-score normalize an array of numbers so the mean maps to 0.
 * Values are in units of standard deviation — positive = above average, negative = below.
 * If all values are equal (zero variance), returns all zeros.
 */
export function zScoreNormalize(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  if (variance === 0) return values.map(() => 0);
  const std = Math.sqrt(variance);
  return values.map((v) => +((v - mean) / std).toFixed(2));
}

/**
 * Beasley-Springer-Moro approximation to the inverse standard-normal CDF
 * Φ⁻¹(p). Accurate to ~1e-7 across (0, 1). Used by rank→Gaussian normalisation.
 * Returns ±6 at the extremes to avoid ±Infinity on degenerate inputs.
 */
function invNormalCDF(p: number): number {
  if (p <= 0) return -6;
  if (p >= 1) return 6;
  const pl = 0.02425;
  const ph = 1 - pl;
  const a = [-3.969683028665376e+1, 2.209460984245205e+2, -2.759285104469687e+2,
             1.383577518672690e+2, -3.066479806614716e+1, 2.506628277459239e+0];
  const b = [-5.447609879822406e+1, 1.615858368580409e+2, -1.556989798598866e+2,
             6.680131188771972e+1, -1.328068155288572e+1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e+0,
             -2.549732539343734e+0, 4.374664141464968e+0, 2.938163982698783e+0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e+0,
             3.754408661907416e+0];
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= ph) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
          ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Rank→Gaussian quantile normalisation. Maps values to the standard normal
 * via their empirical rank: `z_i = Φ⁻¹(rank_i / (N + 1))`. Preserves ordering
 * exactly, is distribution-free, and is strictly more robust to outliers than
 * z-score (the max |z| is bounded by ~Φ⁻¹(N/(N+1)) regardless of input scale).
 *
 * Prefer this over `zScoreNormalize` for any series that might contain
 * extreme per-scene spikes — e.g. a climactic scene that closes a dozen
 * markets won't compress the rest of the curve against zero.
 *
 * Ties are broken in input order (stable rank). N=0 returns []; N=1 returns [0].
 */
export function rankGaussianNormalize(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const out = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    const rank = k + 1;
    out[indexed[k].i] = +invNormalCDF(rank / (n + 1)).toFixed(3);
  }
  return out;
}

// ── Narrative Forces ─────────────────────────────────────────────────────────
//
// Three forces measure distinct dimensions of narrative movement per scene.
// Raw values are z-score normalized: z = (x - μ) / σ.
//
// F ≈ Σ_threads log(1 + peak_|evidence|) × (1 + log(1 + volumeDelta))
//                                            (information-gain proxy per market:
//                                             |ΔH(probs)| × volume_weight)
// W = ΔN_c + √ΔE_c                           (entity continuity — mirrors S for inner worlds)
// S = ΔN + √ΔE                               (new world-knowledge nodes + sqrt edges)
//
// Swing = ‖f_i - f_{i-1}‖₂                   (Euclidean distance in FWS space)
// D = (F + W + S) / 3                                  (delivery, equal-weighted mean of z-scored forces)
// g(x̃) = 25 - 17·e^{-kx̃}, k = ln(17/4)     (grade, μ = {1.5, 12, 3})
//

/** Context for entity-related calculations (used by external consumers) */
export type EntityContext = {
  characters: Record<string, Character>;
  locations: Record<string, Location>;
  artifacts: Record<string, Artifact>;
  threads: Record<string, Thread>;
};

/**
 * Compute raw fate score for a scene — information-gain formulation.
 *
 *   F = Σ_threads volume_weight × |H(p_old) − H(p_new)|
 *
 * where p is the softmax over that thread's logits (narrator belief) and
 * volume_weight is a log-compressed narrative-attention scalar. A proxy
 * approximation used here — the raw evidence magnitude per scene — is
 * accurate to leading order and avoids requiring per-scene trajectory replay:
 *
 *   F ≈ Σ_threads log(1 + peak_|evidence|) × (1 + log(1 + volumeDelta))
 *
 * - peak_|evidence|: maximum |evidence| across the scene's updates for the thread
 * - volumeDelta: attention change from this delta (≥0 typically)
 *
 * Payoffs with evidence +4 saturate to ~log(5)=1.6; twists score similarly;
 * setups at +1 score log(2)=0.69; stalls (evidence 0) score 0.
 */
function computeRawFate(scene: Scene): number {
  let score = 0;
  for (const tm of scene.threadDeltas) {
    const peakEvidence = Math.max(
      0,
      ...((tm.updates ?? []).map((u) => Math.abs(u.evidence))),
    );
    if (peakEvidence === 0 && (tm.volumeDelta ?? 0) === 0) continue;
    const evidenceTerm = Math.log(1 + peakEvidence);
    const volumeTerm = 1 + Math.log(1 + Math.max(0, tm.volumeDelta ?? 0));
    score += evidenceTerm * volumeTerm;
  }
  return score;
}

/** Refined fate. The canonical information-theoretic form:
 *
 *    F_i = Σ_{t ∈ Δ_i} v_t · D_KL(p_t⁺ ‖ p_t⁻)
 *
 *  For each thread touched by scene i, we weight the Kullback–Leibler
 *  divergence from prior-belief to posterior-belief by the market's
 *  pre-scene volume (its accumulated narrative attention). Fate is the
 *  total attention-weighted information gain.
 *
 *  Every empirical behaviour we care about falls out of this single
 *  expression:
 *
 *    • Pulses (no evidence)      →  p⁺ = p⁻, so D_KL = 0, so F = 0.
 *    • Confirmation of a leader  →  small KL, proportional to how far
 *                                    certainty actually advanced.
 *    • Twists (leader flip)      →  large KL, since the posterior
 *                                    concentrates mass where the prior
 *                                    was small.
 *    • Closures                  →  KL grows unboundedly as the
 *                                    posterior approaches a delta
 *                                    distribution — resolution naturally
 *                                    outweighs mid-stream movement.
 *    • Attention                 →  long-cooking markets carry high v,
 *                                    so the same KL earns more fate
 *                                    than on a side-thread nobody was
 *                                    watching.
 *
 *  There are no tuning constants, no log-type multipliers, no closure
 *  bonuses, no scene-level denominators. The per-delta KL is stamped on
 *  the thread log node during `applyThreadDelta`; this function reads
 *  them back. Falls back to the legacy peak-evidence proxy only when the
 *  log lacks enriched stats (pre-F-rework narratives).
 */
export function computeRawFateRefined(
  scene: Scene,
  narrative: NarrativeState | null | undefined,
): number {
  if (!narrative) return computeRawFate(scene);
  const deltas = scene.threadDeltas ?? [];
  if (deltas.length === 0) return 0;

  let F = 0;
  for (const tm of deltas) {
    const thread = narrative.threads[tm.threadId];
    if (!thread) continue;
    const node = thread.threadLog?.nodes?.[`${thread.id}:${scene.id}`];

    if (!node || node.infoGain === undefined) {
      // Legacy fallback for narratives whose log was built before
      // applyThreadDelta started stamping KL. Preserves the coarse shape
      // of the curve until the narrative is re-replayed through the store.
      const peak = Math.max(
        0,
        ...((tm.updates ?? []).map((u) => Math.abs(u.evidence))),
      );
      const vd = Math.max(0, tm.volumeDelta ?? 0);
      if (peak === 0 && vd === 0) continue;
      F += Math.log(1 + peak) * (1 + Math.log(1 + vd));
      continue;
    }

    F += (node.preVolume ?? 0) * node.infoGain;
  }
  return F;
}

/** Raw world information: W = ΔN + √ΔE
 *
 *  World counts information added to entity continuity graphs this scene —
 *  new facts about characters, locations, and artifacts. Nodes are
 *  independent observations and sum linearly; edges exhibit diminishing
 *  returns (the first connection between two facts matters more than the
 *  tenth), so we aggregate them as √edges. Same form as System: both are
 *  knowledge graphs, and consistency across graph-based forces is part of
 *  the design. */
function rawWorld(scene: Scene): number {
  let n = 0, e = 0;
  for (const wd of scene.worldDeltas) {
    n += wd.addedNodes?.length ?? 0;
    e += Math.max(0, (wd.addedNodes?.length ?? 0) - 1);
  }
  return n + Math.sqrt(e);
}

/** Raw system information: S = ΔN + √ΔE
 *
 *  System counts information added to the abstract rule graph this scene —
 *  new concepts and new relations between concepts. Same structure as
 *  World: nodes sum linearly, edges diminish as √e. The first edge between
 *  two concepts is a real integration; the tenth is bookkeeping. */
function rawSystem(scene: Scene): number {
  const wkm = scene.systemDeltas;
  if (!wkm) return 0;
  const n = wkm.addedNodes?.length ?? 0;
  const e = wkm.addedEdges?.length ?? 0;
  return n + Math.sqrt(e);
}

// ── System Graph Utilities ─────────────────────────────────────────

/** Compute degree centrality for each node in the system graph.
 *  More edges = more significant concept. Returns sorted by relevance descending. */
export function rankSystemNodes(graph: SystemGraph): { node: SystemNode; degree: number }[] {
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  return Object.values(graph.nodes)
    .map((node) => ({ node, degree: degree.get(node.id) ?? 0 }))
    .sort((a, b) => b.degree - a.degree);
}

/**
 * Per-node impact score for the system graph.
 *
 * Combines three orthogonal signals so the score reflects KNOWLEDGE THAT
 * GENUINELY DRIVES THE SYSTEM, not raw count of any one dimension:
 *   - degree       : edges in the system graph touching this node
 *                    (how the concept supports / depends on other concepts)
 *   - attributions : scenes that reference this node — via either
 *                    `scene.attributions` or as a system-delta introduction
 *                    (how often the world actually USES it)
 *   - reach        : distinct arcs those scenes span
 *                    (cross-arc concept > 10-times-in-one-arc concept)
 *
 * score = degree + attributions + reach
 *
 * Additive, comparable scales, low ceremony. A node that fails any axis
 * scores low naturally — a heavily-attributed concept with no graph
 * connections is isolated trivia; a richly-connected concept never
 * referenced by a scene is dead lore. The three components are returned
 * alongside the score so the UI can show the auditable breakdown.
 *
 * The optional `upToIndex` parameter scopes attribution/reach to scenes
 * up to and including a cursor position — matches how the rest of the
 * pipeline treats "as of the currently-viewed scene".
 */
export function scoreSystemNodes(
  narrative: NarrativeState,
  resolvedKeys: string[],
  upToIndex?: number,
): Array<{
  node: SystemNode;
  degree: number;
  attributions: number;
  reach: number;
  score: number;
}> {
  // Build the cumulative graph AS OF the cursor so nodes / edges that
  // haven't been introduced yet don't leak into the ranking. Without
  // this gating, a node first added in a later scene still appeared in
  // the panel with zero attributions — matching the canvas but not the
  // narrative state up to where the operator is reading.
  const graph =
    upToIndex == null
      ? narrative.systemGraph
      : buildCumulativeSystemGraph(
          narrative.scenes,
          resolvedKeys,
          upToIndex,
          narrative.worldBuilds,
        );
  if (!graph) return [];

  // 1) Degree — edges touching each node, in either direction.
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  // 2) Attributions + reach — walk scenes up to the cursor (or all if
  // unbounded). Every scene that attributes a SYS-id counts once toward
  // attributions; each unique arcId it lives in counts toward reach.
  const attributions = new Map<string, number>();
  const arcsByNode = new Map<string, Set<string>>();
  const cutoff = upToIndex == null ? resolvedKeys.length : Math.min(upToIndex + 1, resolvedKeys.length);
  for (let i = 0; i < cutoff; i++) {
    const key = resolvedKeys[i];
    const scene = narrative.scenes[key];
    if (!scene) continue;
    const ids = getSceneSystemAttributions(scene);
    for (const id of ids) {
      attributions.set(id, (attributions.get(id) ?? 0) + 1);
      if (scene.arcId) {
        let set = arcsByNode.get(id);
        if (!set) { set = new Set(); arcsByNode.set(id, set); }
        set.add(scene.arcId);
      }
    }
  }

  return Object.values(graph.nodes)
    .map((node) => {
      const d = degree.get(node.id) ?? 0;
      const a = attributions.get(node.id) ?? 0;
      const r = arcsByNode.get(node.id)?.size ?? 0;
      return { node, degree: d, attributions: a, reach: r, score: d + a + r };
    })
    .sort((x, y) => y.score - x.score);
}

/** Build the cumulative system graph up to a given scene index
 *  by replaying systemDeltas from both scenes and world build commits. */
export function buildCumulativeSystemGraph(
  scenes: Record<string, Scene>,
  resolvedKeys: string[],
  upToIndex: number,
  worldBuilds?: Record<string, WorldBuild>,
): SystemGraph {
  const nodes: Record<string, SystemNode> = {};
  const edges: SystemEdge[] = [];

  const applyDelta = (wkm: SystemDelta) => {
    for (const n of wkm.addedNodes ?? []) {
      if (!nodes[n.id]) nodes[n.id] = { id: n.id, concept: n.concept, type: n.type };
    }
    for (const e of wkm.addedEdges ?? []) {
      if (!edges.some((x) => x.from === e.from && x.to === e.to && x.relation === e.relation)) {
        edges.push({ from: e.from, to: e.to, relation: e.relation });
      }
    }
  };

  for (let i = 0; i <= upToIndex && i < resolvedKeys.length; i++) {
    const key = resolvedKeys[i];
    const scene = scenes[key];
    if (scene?.systemDeltas) {
      applyDelta(scene.systemDeltas);
    }
    const wb = worldBuilds?.[key];
    if (wb?.expansionManifest.systemDeltas) {
      applyDelta(wb.expansionManifest.systemDeltas);
    }
  }
  return { nodes, edges };
}

/**
 * Compute ForceSnapshots for a batch of scenes using z-score normalization.
 * 0 = average moment; positive = above average; negative = below average (units of std deviation).
 *
 * - **Fate**: phase transitions — thread status changes (weighted by jump magnitude and entity investment)
 * - **World**: entity continuity graph complexity delta (ΔN_c + √ΔE_c per scene)
 * - **System**: system graph complexity delta (new nodes + sqrt edges per scene)
 *
 * @param scenes - Ordered list of scenes to compute forces for
 * @param priorScenes - Scenes before this batch (for usage tracking). Empty for initial generation.
 * @param entityCtx - Optional entity context for investment-weighted fate calculation
 */
export function computeForceSnapshots(
  scenes: Scene[],
  _priorScenes: Scene[] = [],
  narrative?: NarrativeState | null,
): Record<string, ForceSnapshot> {
  const result: Record<string, ForceSnapshot> = {};
  if (scenes.length === 0) return result;

  // Compute raw values per scene. When a narrative is provided we use the
  // refined fate formula (F7) — reads the per-delta info-gain stamped on
  // thread log nodes — otherwise falls back to the legacy peak-evidence
  // proxy. Worlds and systems retain their current formulas; they're
  // orthogonal to fate and refining them requires a separate design pass.
  const rawFates: number[] = [];
  const rawWorlds: number[] = [];
  const rawSystems: number[] = [];

  for (const scene of scenes) {
    rawFates.push(narrative ? computeRawFateRefined(scene, narrative) : computeRawFate(scene));
    rawWorlds.push(rawWorld(scene));
    rawSystems.push(rawSystem(scene));
  }

  // Rank→Gaussian quantile normalisation — distribution-free and bounded,
  // so a single climactic scene can't stretch the y-axis and flatten the
  // rest of the curve. Strictly more robust than z-score for this use.
  const normFates = rankGaussianNormalize(rawFates);
  const normWorlds = rankGaussianNormalize(rawWorlds);
  const normSystems = rankGaussianNormalize(rawSystems);

  for (let i = 0; i < scenes.length; i++) {
    result[scenes[i].id] = {
      fate: normFates[i],
      world: normWorlds[i],
      system: normSystems[i],
    };
  }
  return result;
}

/**
 * Compute raw (non-normalized) force totals for a set of scenes.
 * Returns absolute values suitable for cross-series comparison.
 *
 * @param scenes - Ordered list of scenes
 */
export function computeRawForceTotals(
  scenes: Scene[],
  narrative?: NarrativeState | null,
): { fate: number[]; world: number[]; system: number[] } {
  if (scenes.length === 0) return { fate: [], world: [], system: [] };

  const fate: number[] = [];
  const world: number[] = [];
  const system: number[] = [];

  for (const scene of scenes) {
    fate.push(narrative ? computeRawFateRefined(scene, narrative) : computeRawFate(scene));
    world.push(rawWorld(scene));
    system.push(rawSystem(scene));
  }

  return { fate, world, system };
}

/** Compute a simple moving average over a data series.
 *  Returns an array of the same length; values before the window is full use a smaller window. */
export function movingAverage(data: number[], windowSize: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = data.slice(start, i + 1);
    result.push(window.reduce((s, v) => s + v, 0) / window.length);
  }
  return result;
}

// ── Delivery / Dopamine Curve ──────────────────────────────────────────────

/** Gaussian kernel smooth with mirror-padding at boundaries. */
function gaussianSmooth(values: number[], sigma: number): number[] {
  if (values.length === 0) return [];
  const radius = Math.ceil(sigma * 3);
  const weights: number[] = [];
  let wSum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    weights.push(w);
    wSum += w;
  }
  return values.map((_, i) => {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.max(0, Math.min(values.length - 1, i + k));
      sum += weights[k + radius] * values[j];
    }
    return sum / wSum;
  });
}

/**
 * Detect local peaks and valleys using minimum drop filtering.
 *
 * A point is a peak if it is the local maximum within `windowR` AND the curve
 * drops by at least `minDrop` on both sides before rising again. This catches
 * every visually obvious bump — even small ones near large peaks — while still
 * filtering flat plateaus. Valley detection is symmetric.
 *
 * Calibrated against subjective peak/valley identification across 4 published
 * works (HP, 1984, Gatsby, Lord of the Rings) with 89/101 alignment.
 */
function detectPeaksAndValleys(
  values: number[],
  minDrop = 0.15,
  windowR = 2,
): { peaks: Set<number>; valleys: Set<number> } {
  const peaks = new Set<number>();
  const valleys = new Set<number>();
  const n = values.length;

  for (let i = 1; i < n - 1; i++) {
    const center = values[i];

    // Check local maximum/minimum within window
    let isMax = true;
    let isMin = true;
    const lo = Math.max(0, i - windowR);
    const hi = Math.min(n - 1, i + windowR);
    for (let k = lo; k <= hi; k++) {
      if (k === i) continue;
      if (values[k] > center) isMax = false;
      if (values[k] < center) isMin = false;
    }

    if (isMax) {
      // How far does the curve drop on each side before rising above this peak?
      let leftMin = center;
      for (let j = i - 1; j >= 0; j--) {
        leftMin = Math.min(leftMin, values[j]);
        if (values[j] > center) break;
      }
      let rightMin = center;
      for (let j = i + 1; j < n; j++) {
        rightMin = Math.min(rightMin, values[j]);
        if (values[j] > center) break;
      }
      // Use the smaller drop (shallower side) — both sides must drop
      if (Math.min(center - leftMin, center - rightMin) >= minDrop) peaks.add(i);
    }

    if (isMin) {
      let leftMax = center;
      for (let j = i - 1; j >= 0; j--) {
        leftMax = Math.max(leftMax, values[j]);
        if (values[j] < center) break;
      }
      let rightMax = center;
      for (let j = i + 1; j < n; j++) {
        rightMax = Math.max(rightMax, values[j]);
        if (values[j] < center) break;
      }
      if (Math.min(leftMax - center, rightMax - center) >= minDrop) valleys.add(i);
    }
  }

  return { peaks, valleys };
}

/** A work's activity-flow signature — continuous and nuanced.
 *
 *  Every narrative moves through three force channels (fate / world /
 *  system). The signature captures which channels carry the load.
 *  Works aren't always single-axis dominant: character studies run on
 *  fate + world together, academic papers on system + fate, and so on.
 *  We never snap to an archetype — instead we expose the full weighting
 *  and let callers read whatever nuance they need.
 *
 *  Fields:
 *    weights       — activity-aggregation weights (non-negative, sum to 1).
 *                    Passing these to `computeActivityCurve` yields an
 *                    activity curve weighted by how the work actually
 *                    moves.
 *    signature     — same simplex point, exposed separately for UIs.
 *    concentration — 0 if perfectly balanced, 1 if one-axis pure.
 *    primary       — the channel with the largest weight.
 *    secondary     — the channel within `dualityBand` of the primary (null
 *                    if the primary is clearly alone).
 *    profile       — human-readable blend: "fate" if single-axis, "fate +
 *                    world" if dual-dominant, "balanced" if low
 *                    concentration.
 *    nearestArchetype — convenience label for archetype-expecting callers;
 *                    does NOT snap the weights themselves.
 */
export type ForceChannel = 'fate' | 'world' | 'system';

export interface ForceSignature {
  weights: ForceWeights;
  signature: ForceWeights;
  concentration: number;
  primary: ForceChannel;
  secondary: ForceChannel | null;
  profile: string;
  nearestArchetype: 'classic' | 'show' | 'paper' | 'opus';
}

/** Compute a story's force signature via PCA on the three rank→Gaussian
 *  normalised force curves.
 *
 *  PC1 — the direction of maximum variance in (F, W, S) space — captures the
 *  story's dominant structural axis. Its absolute loadings, normalised to
 *  sum to 1, are the delivery aggregation weights. This replaces the old
 *  "snap to one of four archetypes" heuristic with a continuous signature
 *  unique to each work.
 *
 *  Why PCA: the three forces are independent dimensions, and we want the 1D
 *  projection that captures the most structural signal. PC1 is exactly that
 *  — the best rank-1 approximation of the force trajectory in Frobenius
 *  norm. Mathematically beautiful (eigenvalue decomposition of the covariance
 *  matrix), scale-free (operates on rank→Gaussian normalised forces so all
 *  three are ≈N(0,1)), and data-driven (no hand-picked archetype weights).
 *
 *  3×3 symmetric eigendecomposition via power iteration — converges to
 *  machine precision in ~20 iterations at this dimension, and the closed-
 *  form solution is uglier than two dozen multiplies.
 */
export function computeForceSignature(
  rawFates: number[],
  rawWorlds: number[],
  rawSystems: number[],
): ForceSignature {
  const n = rawFates.length;
  if (n < 3) {
    return {
      weights: FORCE_DOMINANCE_WEIGHTS.opus,
      signature: FORCE_DOMINANCE_WEIGHTS.opus,
      concentration: 0,
      primary: 'fate',
      secondary: null,
      profile: 'balanced',
      nearestArchetype: 'opus',
    };
  }
  // Operate on rank→Gaussian-normalised forces so PC1 reflects *shape* of
  // variation, not raw magnitude. Each column is ≈N(0,1) by construction.
  const F = rankGaussianNormalize(rawFates);
  const W = rankGaussianNormalize(rawWorlds);
  const S = rankGaussianNormalize(rawSystems);
  // 3×3 covariance (= correlation, since std ≈ 1). Mean-centering is
  // implicit: rank→Gaussian output has mean ≈ 0 by construction.
  let cFF = 0, cWW = 0, cSS = 0, cFW = 0, cFS = 0, cWS = 0;
  for (let i = 0; i < n; i++) {
    cFF += F[i] * F[i];
    cWW += W[i] * W[i];
    cSS += S[i] * S[i];
    cFW += F[i] * W[i];
    cFS += F[i] * S[i];
    cWS += W[i] * S[i];
  }
  cFF /= n; cWW /= n; cSS /= n; cFW /= n; cFS /= n; cWS /= n;
  // Power iteration for the dominant eigenvector. Seed with (1,1,1)/√3.
  let vF = 1 / Math.sqrt(3), vW = 1 / Math.sqrt(3), vS = 1 / Math.sqrt(3);
  for (let iter = 0; iter < 32; iter++) {
    const nF = cFF * vF + cFW * vW + cFS * vS;
    const nW = cFW * vF + cWW * vW + cWS * vS;
    const nS = cFS * vF + cWS * vW + cSS * vS;
    const norm = Math.sqrt(nF * nF + nW * nW + nS * nS) || 1;
    vF = nF / norm; vW = nW / norm; vS = nS / norm;
  }
  // Sign convention: orient so the sum is positive (eigenvectors are only
  // defined up to sign; this gives us a consistent "positive delivery = more
  // structure" interpretation). If all three loadings turn out negative,
  // flip — means PC1 picked the anti-structural direction.
  if (vF + vW + vS < 0) { vF = -vF; vW = -vW; vS = -vS; }
  // Dominance weights = |PC1 loadings|, L1-normalised to the simplex.
  // Using |.| because a force contributes to delivery whether its loading
  // is +ve or −ve; what matters is *magnitude* of involvement.
  const aF = Math.abs(vF), aW = Math.abs(vW), aS = Math.abs(vS);
  const sum = Math.max(1e-9, aF + aW + aS);
  const weights: ForceWeights = { fate: aF / sum, world: aW / sum, system: aS / sum };
  // Signature is the same simplex point — exposed as a distinct field for
  // UIs that want to display "this is a 55/25/20 fate-dominant story"
  // without confusing it with the weights used for delivery.
  const signature = weights;
  // Concentration: L₂ distance from the balanced point (1/3,1/3,1/3),
  // rescaled so the pure vertices (1,0,0) etc. give 1. Max L₂ distance
  // from centroid to vertex is √(2/3) ≈ 0.816.
  const dF = weights.fate - 1 / 3;
  const dW = weights.world - 1 / 3;
  const dS = weights.system - 1 / 3;
  const dist = Math.sqrt(dF * dF + dW * dW + dS * dS);
  const concentration = Math.min(1, dist / Math.sqrt(2 / 3));
  // Rank the channels by weight so we can name a primary, and optionally a
  // secondary when two channels carry comparable load. The duality band
  // (0.7) means: if the second-largest weight is within 70% of the
  // largest, call it a co-dominant channel. A 55/40/5 work reads as
  // "fate + world" not just "fate"; a 60/25/15 reads as "fate" alone.
  const ranked: Array<{ channel: ForceChannel; w: number }> = (
    [
      { channel: 'fate',   w: weights.fate },
      { channel: 'world',  w: weights.world },
      { channel: 'system', w: weights.system },
    ] satisfies Array<{ channel: ForceChannel; w: number }>
  ).sort((a, b) => b.w - a.w);
  const primary = ranked[0].channel;
  const DUALITY_BAND = 0.7;
  const BALANCED_CONCENTRATION = 0.2;
  const secondary: ForceChannel | null =
    ranked[1].w >= DUALITY_BAND * ranked[0].w && concentration > BALANCED_CONCENTRATION
      ? ranked[1].channel
      : null;
  const profile = concentration <= BALANCED_CONCENTRATION
    ? 'balanced'
    : secondary
      ? `${primary} + ${secondary}`
      : primary;
  // Nearest archetype (for UI labels only — the weights are already the
  // nuanced reality). L₁ distance from each archetype's canonical weight.
  const archetypes = ['classic', 'show', 'paper', 'opus'] as const;
  let best: typeof archetypes[number] = 'opus';
  let bestDist = Infinity;
  for (const key of archetypes) {
    const a = FORCE_DOMINANCE_WEIGHTS[key];
    const d = Math.abs(weights.fate - a.fate)
            + Math.abs(weights.world - a.world)
            + Math.abs(weights.system - a.system);
    if (d < bestDist) { bestDist = d; best = key; }
  }
  return { weights, signature, concentration, primary, secondary, profile, nearestArchetype: best };
}

/** @deprecated Prefer `computeForceSignature` — returns only the `weights`
 *  field for backward compatibility with callers that expect raw weights. */
export function inferDominanceWeights(
  rawFates: number[],
  rawWorlds: number[],
  rawSystems: number[],
): ForceWeights {
  return computeForceSignature(rawFates, rawWorlds, rawSystems).weights;
}

/** A single scene's force activity — the signature-weighted aggregate
 *  of the three force channels, with peak/valley flags and smoothed
 *  trend curves.
 *
 *  We're measuring the objective rate at which the three forces (fate /
 *  world / system) are moving in this scene. High activity = the
 *  channels the work uses are firing together. Low activity = the
 *  reader is between moments of movement. */
export interface ActivityPoint {
  /** Scene index (0-based) */
  index: number;
  /** Force activity: signature-weighted sum of normalised forces,
   *  `A_i = w_F F_i + w_W W_i + w_S S_i`. Positive = above the work's
   *  average activity level; negative = below. Units are z-score
   *  (rank→Gaussian normalised). */
  activity: number;
  /** Tension buildup: world + system − fate. High when entity and rule
   *  activity accumulates without fate resolving any of it. */
  tension: number;
  /** Gaussian-smoothed activity curve (σ = DELIVERY_SMOOTH_SIGMA) —
   *  the curve meant for display. */
  smoothed: number;
  /** Heavily smoothed macro trend (σ=4) — overall arc of the narrative. */
  macroTrend: number;
  /** True if this scene is a significant local activity peak — a moment
   *  where the forces fire together. */
  isPeak: boolean;
  /** True if this scene is a significant local activity valley — a
   *  quiet stretch between peaks, often a turning point setting up the
   *  next rise. */
  isValley: boolean;
}


/** Per-force weights for the activity-curve aggregation. Must sum to 1.
 *  Defaults to equal-weighted opus; callers with a declared signature
 *  (typically from `computeForceSignature`) should pass their PCA-derived
 *  weights so the curve reflects the work's own force vocabulary. */
export type ForceWeights = { fate: number; world: number; system: number };

/**
 * Compute the activity curve of a work — the rate at which the three
 * forces are moving in each scene.
 *
 *   A_i = w_F·F_i + w_W·W_i + w_S·S_i
 *
 * Weighted sum of rank→Gaussian-normalised forces. Weights should come
 * from `computeForceSignature(...)` — PCA on the three force curves
 * reveals the channels through which the work actually transmits, so the
 * curve respects the work's own force vocabulary. An academic paper
 * weights system heavily, a character novel world-heavy, a plot-driven
 * thriller fate-heavy. Mixed signatures are the default.
 *
 * Peaks (high `isPeak`) mark moments of force activity — the work's
 * chosen channels firing together. Valleys mark the quiet stretches
 * between peaks — structurally meaningful because they set up the next
 * rise.
 */
export function computeActivityCurve(
  snapshots: ForceSnapshot[],
  weights: ForceWeights = FORCE_DOMINANCE_WEIGHTS.opus,
): ActivityPoint[] {
  if (snapshots.length === 0) return [];
  const n = snapshots.length;
  const wSum = weights.fate + weights.world + weights.system;
  // Renormalise silently if weights don't sum to 1 — caller ergonomics
  // over strictness; the curve is invariant under scalar multiplication.
  const wF = weights.fate / wSum;
  const wW = weights.world / wSum;
  const wS = weights.system / wSum;

  const values = snapshots.map(({ fate, world, system }) =>
    wF * fate + wW * world + wS * system,
  );

  const smoothed = gaussianSmooth(values, DELIVERY_SMOOTH_SIGMA);
  const macroTrend = gaussianSmooth(values, 4);

  // Peak/valley detection threshold tuned to catch structurally meaningful
  // moments without being noise-sensitive. Low minDrop (8% of the
  // smoothed std) picks up subtle peaks that are visually obvious, which
  // matters for works with narrow activity dynamic range.
  const smMean = smoothed.reduce((s, v) => s + v, 0) / n;
  const smStd = Math.sqrt(smoothed.reduce((s, v) => s + (v - smMean) ** 2, 0) / n);
  const minDrop = Math.max(0.03, 0.08 * smStd);

  // Wider window for longer books — prevents peak saturation
  const windowR = Math.max(2, Math.floor(n / PEAK_WINDOW_SCENES_DIVISOR));

  const { peaks, valleys } = detectPeaksAndValleys(smoothed, minDrop, windowR);

  return snapshots.map(({ fate, world, system }, i) => ({
    index: i,
    activity: values[i],
    tension: world + system - fate,
    smoothed: smoothed[i],
    macroTrend: macroTrend[i],
    isPeak: peaks.has(i),
    isValley: valleys.has(i),
  }));
}


// ── Narrative Shape Classification ────────────────────────────────────────────

export interface NarrativeShape {
  key: string;
  name: string;
  description: string;
  /** Characteristic curve as [x, y] pairs, both normalised 0–1 */
  curve: [number, number][];
}

export const SHAPES = {
  climactic: {
    key: 'climactic',
    name: 'Climactic',
    description: 'Build, climax, release — one dominant peak defines the arc',
    curve: [[0,0.2],[0.25,0.5],[0.45,0.8],[0.5,1],[0.55,0.8],[0.75,0.5],[1,0.25]] as [number,number][],
  },
  episodic: {
    key: 'episodic',
    name: 'Episodic',
    description: 'Multiple peaks of similar weight — no single climax dominates',
    curve: [[0,0.3],[0.1,0.7],[0.2,0.3],[0.35,0.75],[0.5,0.25],[0.65,0.8],[0.8,0.3],[0.9,0.7],[1,0.35]] as [number,number][],
  },
  rebounding: {
    key: 'rebounding',
    name: 'Rebounding',
    description: 'A meaningful dip followed by strong recovery',
    curve: [[0,0.6],[0.2,0.35],[0.4,0.1],[0.6,0.3],[0.8,0.65],[1,0.9]] as [number,number][],
  },
  peaking: {
    key: 'peaking',
    name: 'Peaking',
    description: 'Dominant peak early or mid-arc, followed by decline',
    curve: [[0,0.4],[0.2,0.85],[0.35,1],[0.55,0.65],[0.75,0.35],[1,0.15]] as [number,number][],
  },
  escalating: {
    key: 'escalating',
    name: 'Escalating',
    description: 'Momentum rises overall — intensity concentrated toward the end',
    curve: [[0,0.1],[0.2,0.2],[0.4,0.35],[0.6,0.55],[0.8,0.8],[1,1]] as [number,number][],
  },
  flat: {
    key: 'flat',
    name: 'Flat',
    description: 'Too little structural variation — no meaningful peaks or valleys',
    curve: [[0,0.5],[0.25,0.52],[0.5,0.48],[0.75,0.51],[1,0.5]] as [number,number][],
  },
} satisfies Record<string, NarrativeShape>;

/** All shape keys for external use. */
export type NarrativeShapeKey = keyof typeof SHAPES;

/** Shape metrics computed from the delivery curve. */
export interface ShapeMetrics {
  overallSlope: number;
  peakCount: number;
  peakDominance: number;
  peakPosition: number;
  troughDepth: number;
  recoveryStrength: number;
  flatness: number;
}

/**
 * Classify the overall shape of a narrative based on its delivery curve.
 *
 * Accepts delivery values (one per scene), applies Gaussian smoothing,
 * computes six core metrics, derives boolean conditions, and classifies
 * into one of five shapes: Climactic, Episodic, Rebounding, Peaking, Escalating.
 *
 * curve → metrics → booleans → shape
 */
export function classifyNarrativeShape(deliveries: number[]): NarrativeShape {
  if (deliveries.length < 6) return SHAPES.flat;
  const n = deliveries.length;
  const smoothed = gaussianSmooth(deliveries, 1.5);
  const macro = gaussianSmooth(deliveries, 4);

  // ── Metrics ────────────────────────────────────────────────────────────

  // Flatness: std dev of smoothed curve
  const smMean = smoothed.reduce((s, v) => s + v, 0) / n;
  const flatness = Math.sqrt(smoothed.reduce((s, v) => s + (v - smMean) ** 2, 0) / n);

  // Overall slope: macro end minus start
  const overallSlope = macro[n - 1] - macro[0];

  // Peak detection — same minDrop approach as computeActivityCurve
  const smStd = flatness;
  const minDrop = Math.max(0.03, 0.08 * smStd);
  const windowR = Math.max(2, Math.floor(n / PEAK_WINDOW_SCENES_DIVISOR));
  const { peaks, valleys } = detectPeaksAndValleys(smoothed, minDrop, windowR);
  const peakCount = peaks.size;

  // Peak prominences
  const peakIndices = Array.from(peaks).sort((a, b) => a - b);
  const prominences = peakIndices.map((pi) => {
    // Prominence: peak value minus the higher of the two nearest bases
    let leftBase = smoothed[0];
    for (let j = pi - 1; j >= 0; j--) {
      if (smoothed[j] > smoothed[pi]) break;
      leftBase = Math.min(leftBase, smoothed[j]);
    }
    let rightBase = smoothed[n - 1];
    for (let j = pi + 1; j < n; j++) {
      if (smoothed[j] > smoothed[pi]) break;
      rightBase = Math.min(rightBase, smoothed[j]);
    }
    return smoothed[pi] - Math.max(leftBase, rightBase);
  });
  const totalProminence = prominences.reduce((s, v) => s + v, 0);
  const maxPromIdx = prominences.length > 0 ? prominences.indexOf(Math.max(...prominences)) : 0;
  const dominantPeakIdx = peakIndices[maxPromIdx] ?? Math.floor(n / 2);

  // Peak dominance: largest prominence / total prominence
  const peakDominance = totalProminence > 0 ? Math.max(...prominences) / totalProminence : 0;

  // Peak position: 0..1
  const peakPosition = dominantPeakIdx / (n - 1);

  // Trough depth and recovery — only counts as a rebound if the trough
  // is in the middle portion of the curve (not at edges) and significantly
  // below the mean. A true V-shape has a concentrated central collapse.
  const valleyIndices = Array.from(valleys).sort((a, b) => a - b);
  let troughDepth = 0;
  let recoveryStrength = 0;
  let troughPosition = 0.5;
  if (valleyIndices.length > 0) {
    // Find deepest trough in the middle 60% of the curve (not edges)
    const midStart = Math.floor(n * SHAPE_TROUGH_BAND_LO);
    const midEnd = Math.floor(n * SHAPE_TROUGH_BAND_HI);
    const midValleys = valleyIndices.filter((vi) => vi >= midStart && vi <= midEnd);
    const searchValleys = midValleys.length > 0 ? midValleys : valleyIndices;

    let deepestIdx = searchValleys[0];
    let deepestVal = smoothed[deepestIdx];
    for (const vi of searchValleys) {
      if (smoothed[vi] < deepestVal) {
        deepestVal = smoothed[vi];
        deepestIdx = vi;
      }
    }
    troughPosition = deepestIdx / (n - 1);

    // Only count if below the mean and in the middle portion
    if (deepestVal < smMean && troughPosition > 0.15 && troughPosition < 0.85) {
      const leftHigh = Math.max(...smoothed.slice(0, deepestIdx + 1));
      const rightHigh = Math.max(...smoothed.slice(deepestIdx));
      troughDepth = Math.min(leftHigh, rightHigh) - deepestVal;
      recoveryStrength = rightHigh - deepestVal;
    }
  }

  // ── Boolean conditions ─────────────────────────────────────────────────

  const isFlat = flatness < 0.15;
  const hasManyPeaks = peakCount >= 4;
  const hasDominantPeak = peakDominance > 0.40;
  const hasEarlyPeak = peakPosition < 0.4;
  const hasMidLatePeak = peakPosition >= 0.4;
  // Rebounding requires a V-shaped macro curve: the middle third must be
  // lower than both outer thirds, AND a deep central trough.
  const t1 = Math.floor(n / 3);
  const t2 = Math.floor(2 * n / 3);
  const segAvg = (a: number, b: number) => macro.slice(a, b).reduce((s, v) => s + v, 0) / (b - a);
  const avgQ1 = segAvg(0, t1);
  const avgQ2 = segAvg(t1, t2);
  const avgQ3 = segAvg(t2, n);
  const hasMacroVShape = avgQ2 < avgQ1 - 0.1 && avgQ2 < avgQ3 - 0.1;
  const hasDeepTrough = troughDepth > 1.5 * smStd && hasMacroVShape;
  const hasStrongRecovery = recoveryStrength > 1.5 * smStd;
  const isRisingOverall = overallSlope > 0.3;
  const isFallingOverall = overallSlope < -0.3;

  // ── Classification (priority order) ────────────────────────────────────

  // ── Classification (priority order) ────────────────────────────────────

  // Guard: too flat to classify meaningfully
  if (isFlat) return SHAPES.flat;

  // Peaking: dominant early peak with decline — front-loaded intensity
  if (hasDominantPeak && hasEarlyPeak && !isRisingOverall) return SHAPES.peaking;

  // Escalating: clear rising trend wins over peak patterns
  if (isRisingOverall && !isFallingOverall) return SHAPES.escalating;

  // Rebounding: exceptional collapse followed by strong recovery.
  // Trough must be below the mean AND exceed 2x the curve's own std dev.
  if (hasDeepTrough && hasStrongRecovery) return SHAPES.rebounding;

  // Episodic: many peaks, none dominant, after directional shapes ruled out.
  // Long-form narratives with repeated fate cycles and no clear slope.
  if (hasManyPeaks && !hasDominantPeak) return SHAPES.episodic;

  // Climactic: dominant mid/late peak, or fallback
  if (hasDominantPeak && hasMidLatePeak) return SHAPES.climactic;

  return SHAPES.climactic;
}

// ── Narrative Archetype Classification ────────────────────────────────────────

export interface NarrativeArchetype {
  key: string;
  name: string;
  description: string;
  /** Which force(s) define this archetype */
  dominant: ('fate' | 'world' | 'system')[];
}

export const ARCHETYPES = {
  opus:        { key: 'opus',        name: 'Opus',        description: 'All three forces in concert — fates land, characters transform, and the world deepens together', dominant: ['fate', 'world', 'system'] as const },
  series:      { key: 'series',      name: 'Series',      description: 'Consequential events that permanently reshape characters — fates land and lives change', dominant: ['fate', 'world'] as const },
  atlas:       { key: 'atlas',       name: 'Atlas',       description: 'Resolutions that map the world — each fate reveals how things work', dominant: ['fate', 'system'] as const },
  chronicle:   { key: 'chronicle',   name: 'Chronicle',   description: 'Characters transform within a deepening world — lives and systems evolve together', dominant: ['world', 'system'] as const },
  classic:     { key: 'classic',     name: 'Classic',     description: 'Fate-driven — threads pay off and relationships shift decisively', dominant: ['fate'] as const },
  stage:       { key: 'stage',       name: 'Stage',       description: 'Rich inner worlds — characters, places, and artifacts with deep continuity that grows and transforms', dominant: ['world'] as const },
  paper:       { key: 'paper',       name: 'Paper',       description: 'Dense with ideas and systems — the depth of the world itself is the draw', dominant: ['system'] as const },
  emerging:    { key: 'emerging',    name: 'Emerging',    description: 'No single force has reached its potential yet — the story is still finding its voice', dominant: [] as const },
} satisfies Record<string, NarrativeArchetype>;

/**
 * Classify a narrative's archetype based on its force grade profile.
 *
 * - OPUS: all three forces must be genuinely strong (≥ 22/25). Set one
 *   above the dominance floor (21) rather than at the absolute ceiling;
 *   the strict-23 version rejected clearly-balanced profiles like
 *   22/23/24 which every intuition reads as Opus.
 * - Below the Opus bar, a force must score ≥ 21 AND be within 5 of the max to
 *   be "dominant". The combination of dominant forces picks the archetype.
 * - If three forces nominally co-dominate but don't clear the Opus bar, we
 *   demote to the strongest pair by dropping the weakest force.
 */
export function classifyArchetype(grades: ForceGrades): NarrativeArchetype {
  const f = grades.fate;
  const w = grades.world;
  const s = grades.system;
  const max = Math.max(f, w, s);
  const gap = 5;
  const floor = 21;
  const opusFloor = 22;

  // Opus — rare, requires all three forces at exceptional level
  if (f >= opusFloor && w >= opusFloor && s >= opusFloor) {
    return ARCHETYPES.opus;
  }

  const fDom = f >= floor && f >= max - gap;
  const wDom = w >= floor && w >= max - gap;
  const sDom = s >= floor && s >= max - gap;

  // Three-way nominal dominance without clearing the Opus bar — pick the
  // strongest pair by dropping the weakest force (first in ties: s > w > f,
  // so a tied three-way falls to series as the most common prestige shape).
  if (fDom && wDom && sDom) {
    if (s <= f && s <= w)      return ARCHETYPES.series;    // drop system
    if (w <= f && w <= s)      return ARCHETYPES.atlas;     // drop world
    return ARCHETYPES.chronicle;                             // drop fate
  }

  if (fDom && wDom)         return ARCHETYPES.series;
  if (fDom && sDom)         return ARCHETYPES.atlas;
  if (wDom && sDom)         return ARCHETYPES.chronicle;
  if (fDom)                 return ARCHETYPES.classic;
  if (wDom)                 return ARCHETYPES.stage;
  if (sDom)                 return ARCHETYPES.paper;
  return ARCHETYPES.emerging;
}

// ── Narrative Scale Classification ────────────────────────────────────────────
// Calibrated from analysed works:
//   Sketch:    < 20 scenes  (short story, one-act)
//   Novella:   20–50 scenes (Romeo & Juliet 24, Great Gatsby 44)
//   Novel:     50–120 scenes (1984 75, HP books 89–110, Tale of Two Cities 100)
//   Epic:      120–300 scenes (Lord of the Rings ~150, A Game of Thrones ~145)
//   Serial:    300+ scenes (full web serials, multi-volume sagas)

export interface NarrativeScale {
  key: string;
  name: string;
  description: string;
}

const SCALES: Record<string, NarrativeScale> = {
  short:  { key: 'short',  name: 'Short',  description: 'A contained vignette — one conflict, one resolution' },
  story:  { key: 'story',  name: 'Story',  description: 'A focused narrative with room for subplot and development' },
  novel:  { key: 'novel',  name: 'Novel',  description: 'Full-length narrative with multiple arcs and cast depth' },
  epic:   { key: 'epic',   name: 'Epic',   description: 'Extended narrative with sprawling cast and world scope' },
  serial: { key: 'serial', name: 'Serial', description: 'Long-running multi-volume narrative with evolving world' },
};

export function classifyScale(sceneCount: number): NarrativeScale {
  if (sceneCount < 20)  return SCALES.short;
  if (sceneCount < 50)  return SCALES.story;
  if (sceneCount < 120) return SCALES.novel;
  if (sceneCount < 300) return SCALES.epic;
  return SCALES.serial;
}

// ── Scene-ordinal helpers ─────────────────────────────────────────────────────
// resolvedEntryKeys is a mixed list of scene keys and world-commit keys. UI that
// displays "scene N of M" (market view, exports, trajectory chart) must count
// only actual scenes — world commits shouldn't inflate M or bump the current
// ordinal. These helpers keep that translation in one place.

/** Count actual scenes in a resolved-key list, ignoring world-commit entries. */
export function countScenes(
  narrative: Pick<NarrativeState, 'scenes'>,
  resolvedKeys: string[],
): number {
  let n = 0;
  for (const k of resolvedKeys) if (narrative.scenes[k]) n++;
  return n;
}

/** 1-based scene ordinal for a resolved-key index. If the key at `index` is a
 *  world commit, returns the ordinal of the most recent prior scene (or 0 if
 *  none has happened yet). */
export function sceneOrdinalAt(
  narrative: Pick<NarrativeState, 'scenes'>,
  resolvedKeys: string[],
  index: number,
): number {
  let n = 0;
  const limit = Math.min(index, resolvedKeys.length - 1);
  for (let i = 0; i <= limit; i++) {
    if (narrative.scenes[resolvedKeys[i]]) n++;
  }
  return n;
}

// ── World Density Classification ─────────────────────────────────────────────
// Measures richness of the world relative to story length.
// Density = (characters + locations + threads + systemNodes) / scenes
// Calibrated from analysed works:
//   Two Cities:     (73+48+32+20)/100  = 1.7
//   HP Azkaban:     (86+74+34+39)/110  = 2.1
//   HP Chamber:     (75+56+50+62)/89   = 2.7
//   Romeo & Juliet: (27+10+14+26)/24   = 3.2
//   AI-generated (early): 15-30 entities / 5-10 scenes = 3-6+

export interface WorldDensity {
  key: string;
  name: string;
  description: string;
  density: number;
}

const DENSITIES: Record<string, Omit<WorldDensity, 'density'>> = {
  sparse:    { key: 'sparse',    name: 'Sparse',    description: 'Minimal world scaffolding — story over setting' },
  focused:   { key: 'focused',   name: 'Focused',   description: 'Lean world built to serve specific narrative needs' },
  developed: { key: 'developed', name: 'Developed', description: 'Substantial world with layered characters and tensions' },
  rich:      { key: 'rich',      name: 'Rich',      description: 'Dense world where every scene touches multiple systems' },
  sprawling: { key: 'sprawling', name: 'Sprawling', description: 'Deeply interconnected world — every corner holds detail' },
};

export function classifyWorldDensity(
  sceneCount: number,
  characterCount: number,
  locationCount: number,
  threadCount: number,
  systemNodeCount: number,
  /** Total continuity nodes across all entities (characters + locations + artifacts) */
  entityContinuityNodeCount?: number,
  /** Total continuity edges across all entities */
  entityContinuityEdgeCount?: number,
): WorldDensity {
  if (sceneCount === 0) return { ...DENSITIES.sparse, density: 0 };
  // Entity continuity contributes to density via the same ΔN + √ΔE pattern
  const continuityContribution = (entityContinuityNodeCount ?? 0) + Math.sqrt(entityContinuityEdgeCount ?? 0);
  const density = (characterCount + locationCount + threadCount + systemNodeCount + continuityContribution) / sceneCount;
  const base = density < 0.5 ? DENSITIES.sparse
    : density < 1.5 ? DENSITIES.focused
    : density < 2.5 ? DENSITIES.developed
    : density < 4.0 ? DENSITIES.rich
    : DENSITIES.sprawling;
  return { ...base, density: Math.round(density * 100) / 100 };
}

// ── Local Position Classification ─────────────────────────────────────────────

export interface NarrativePosition {
  key: 'peak' | 'trough' | 'rising' | 'falling' | 'stable';
  name: string;
  description: string;
}

const POSITIONS: Record<NarrativePosition['key'], NarrativePosition> = {
  peak:    { key: 'peak',    name: 'Peak',    description: 'Deliveries are at a local high — intensity is cresting' },
  trough:  { key: 'trough',  name: 'Trough',  description: 'Deliveries are at a local low — energy has bottomed out' },
  rising:  { key: 'rising',  name: 'Rising',  description: 'Deliveries are climbing — building toward a high point' },
  falling: { key: 'falling', name: 'Falling', description: 'Deliveries are declining — unwinding from a high' },
  stable:  { key: 'stable',  name: 'Stable',  description: 'Deliveries are holding steady — no strong directional movement' },
};

/**
 * Classify the local activity position at the current (last) point of an activity window.
 * Checks proximity to detected peaks/valleys first, then falls back to slope direction.
 */
export function classifyCurrentPosition(points: ActivityPoint[]): NarrativePosition {
  if (points.length === 0) return POSITIONS.stable;
  const n = points.length;

  // Look within the last few points for a detected peak or valley
  const nearWindow = Math.min(4, n);
  const recent = points.slice(-nearWindow);
  let lastPeakOff = -1;
  let lastValleyOff = -1;
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].isPeak)   lastPeakOff   = i;
    if (recent[i].isValley) lastValleyOff = i;
  }

  if (lastPeakOff >= 0 || lastValleyOff >= 0) {
    if (lastPeakOff > lastValleyOff) return POSITIONS.peak;
    return POSITIONS.trough;
  }

  // Fall back to recent slope of smoothed values
  const slopeN = Math.min(6, n);
  const slopePoints = points.slice(-slopeN);
  const smValues = slopePoints.map((p) => p.smoothed);
  const delta = smValues[smValues.length - 1] - smValues[0];
  const smMin = Math.min(...smValues);
  const smMax = Math.max(...smValues);
  const range = smMax - smMin;

  if (range < 0.05) return POSITIONS.stable;
  const norm = delta / range;
  if (norm > 0.2)  return POSITIONS.rising;
  if (norm < -0.2) return POSITIONS.falling;
  return POSITIONS.stable;
}

// ── Windowed Forces ──────────────────────────────────────────────────────────

export type WindowedForceResult = {
  forceMap: Record<string, ForceSnapshot>;
  /** Inclusive scene-array index where the window starts */
  windowStart: number;
  /** Inclusive scene-array index where the window ends */
  windowEnd: number;
};

/**
 * Compute forces normalized within a rolling window around the current scene.
 * The window is the last `windowSize` scenes ending at `currentIndex`.
 * System usage is seeded from scenes before the window so novelty is still relative.
 */
export function computeWindowedForces(
  scenes: Scene[],
  currentIndex: number,
  windowSize: number = FORCE_WINDOW_SIZE,
): WindowedForceResult {
  const empty: WindowedForceResult = { forceMap: {}, windowStart: 0, windowEnd: 0 };
  if (scenes.length === 0) return empty;

  const end = Math.min(currentIndex, scenes.length - 1);
  const start = Math.max(0, end - windowSize + 1);
  const windowScenes = scenes.slice(start, end + 1);
  const priorScenes = scenes.slice(0, start);

  return {
    forceMap: computeForceSnapshots(windowScenes, priorScenes),
    windowStart: start,
    windowEnd: end,
  };
}

// ── Scorecard Grading ────────────────────────────────────────────────────────

export type ForceGrades = {
  fate: number;
  world: number;
  system: number;
  swing: number;
  overall: number;
};

const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

/** Reference means per force — the expected mean for a well-structured narrative.
 *  Raw force values are divided by these to produce a unit-free normalized value
 *  (x̃ = x̄ / μ_ref). At x̃ = 1 the grade reaches ~21/25 (dominance threshold).
 *  Calibrated against analyzed narratives: fate-dominant novels (HP, Alice) land
 *  23–24, system-dominant papers saturate to 25, and low forces across
 *  archetype mismatches sit in the mid-teens.
 *
 *  Fate 5.3: the information-gain proxy (log(1+peak|e|)·(1+log(1+vol)))
 *  saturates quickly on any scene with committal evidence; a reference of
 *  5.3 prevents routine thread activity from saturating the grade and
 *  makes the top band reflect sustained high-information pricing across
 *  the work. HP (avg 9.42) → 24, Alice (avg 8.53) → 23.
 *
 *  World 14: entity-graph density scales fast in character-forward works;
 *  14/scene spreads well-structured novels across 22–26 so that genuinely
 *  world-dominant works (e.g. Alice at 29/scene) separate from solid ones
 *  (HP at 22/scene).
 *
 *  System 3.5: most fiction has low system density; at 3.5 a typical
 *  scene introducing a modest mechanism grades into the low 20s, while
 *  idea-dense works (papers, hard SF) saturate to 25. */
/** Reference means for the grading curve `g(x̃) = 25 − 17·exp(−k·x̃)`, where
 *  `x̃ = avg(raw_force) / μ_ref`. At x̃ = 1 the grade is 21 (baseline solid
 *  narrative); higher means carry exponentially diminishing returns up to the
 *  cap at 25.
 *
 *  All three forces measure *information added this scene*, in their own
 *  natural units — fate in nats (KL divergence), world in entity-graph
 *  additions (n + √e), system in rule-graph additions (n + √e). Grading
 *  runs each against its own μ_ref, so the curve is unit-invariant.
 *
 *  Calibrated by triangulating across three meridians works of distinct
 *  information signatures:
 *                             avg F    avg W    avg S    graded (F, W, S)
 *    - Harry Potter            1.64    22.20     3.36       22 / 23 / 17
 *    - Alice in Wonderland     1.92    29.23     3.92       23 / 24 / 18
 *    - Quantifying Narrative   0.26     4.45    44.71       12 / 14 / 25
 *
 *  The fiction works (HP fate-dominant, Alice world-dominant) both grade in
 *  the 17–24 band across F/W, with system sitting mid-teens — honest about
 *  how lightly they develop explicit rules. The paper (system-dominant)
 *  grades 25 on system and appropriately low on fate/world, because a
 *  treatise delivers information through principles rather than plot
 *  momentum or character transformation.
 */
export const FORCE_REFERENCE_MEANS = { fate: 1.4, world: 14, system: 6 } as const;

/** Per-scene density and cube-corner bands derived from FORCE_REFERENCE_MEANS.
 *  Prompts, pacing profiles, and UI displays import from here so updating the
 *  reference mean propagates to every downstream target automatically.
 *
 *  Bands are fractions of the reference mean:
 *  - typical: 0.85×–1.15× (routine scenes cluster around the mean)
 *  - climax:  1.3×–2×      (peaks push above)
 *  - quiet:   0.4×–0.6×    (breathers sit well below)
 *  - low:     [0, 0.5×]    (cube-corner LOW range — dominance floor)
 *  - high:    [1×, 2×]     (cube-corner HIGH range — dominance territory)
 */
const _R = FORCE_REFERENCE_MEANS;
const _intBand = (ref: number, lo: number, hi: number, min = 1): [number, number] =>
  [Math.max(min, Math.round(ref * lo)), Math.round(ref * hi)];

export const FORCE_BANDS = {
  world: {
    typical: _intBand(_R.world, 0.85, 1.15),
    climax:  _intBand(_R.world, 1.3, 1.75),
    quiet:   _intBand(_R.world, 0.4, 0.6),
    low:     [0, Math.round(_R.world * 0.5)] as [number, number],
    high:    [_R.world, Math.round(_R.world * 1.8)] as [number, number],
  },
  system: {
    typical: _intBand(_R.system, 0.85, 1.15),
    climax:  _intBand(_R.system, 1.4, 2.3),
    quiet:   [1, 2] as [number, number],
    low:     [0, Math.round(_R.system * 0.6)] as [number, number],
    high:    [_R.system, Math.round(_R.system * 2.3)] as [number, number],
  },
  fate: {
    low:  [0, Math.round(_R.fate * 0.66 * 10) / 10] as [number, number],
    high: [_R.fate, Math.round(_R.fate * 1.9)] as [number, number],
  },
} as const;

/** Inline band formatter — "12-16" or "18-24+". */
export const fmtBand = ([lo, hi]: readonly [number, number], plus = false): string =>
  plus ? `${lo}-${hi}+` : `${lo}-${hi}`;

/** One-line human-readable summary of reference means — for UI and prompts. */
export const FORCE_REFERENCE_SUMMARY = `fate: ${_R.fate}, world: ${_R.world}, system: ${_R.system}`;

/** Per-scene density targets by archetype — what the LLM should aim for during generation.
 *  "High" forces use the opus-level reference; "low" forces use relaxed targets.
 *  These are generation hints, not grading references (grading remains universal).
 *
 *  Archetype force profiles:
 *  - opus: all high (balanced masterwork)
 *  - series: fate+world high (consequential character drama)
 *  - atlas: fate+system high (resolutions through world-building)
 *  - chronicle: world+system high (transformative exploration)
 *  - classic: fate high (plot-driven payoffs)
 *  - show: world high (character-driven transformation)
 *  - paper: system high (idea-dense world-building)
 */
import type { ArchetypeKey } from "@/types/narrative";

const HIGH_FATE = 1.5;
const LOW_FATE = 0.5;
const HIGH_WORLD = 12;
const LOW_WORLD = 6;
const HIGH_SYSTEM = 3;
const LOW_SYSTEM = 1;

export type ArchetypeForceProfile = {
  fate: number;
  world: number;
  system: number;
  description: string;
  /** If true, force targets are strictly enforced. If false, they're guidance only. */
  enforced: boolean;
};

export const ARCHETYPE_FORCE_TARGETS: Record<ArchetypeKey, ArchetypeForceProfile> = {
  opus:      { fate: HIGH_FATE, world: HIGH_WORLD, system: HIGH_SYSTEM, enforced: true,  description: "All three forces in concert — fate lands, characters transform, world deepens" },
  series:    { fate: HIGH_FATE, world: HIGH_WORLD, system: LOW_SYSTEM,  enforced: false, description: "Consequential events that reshape characters — plot meets character drama" },
  atlas:     { fate: HIGH_FATE, world: LOW_WORLD,  system: HIGH_SYSTEM, enforced: false, description: "Resolutions through world-building — each fate reveals how things work" },
  chronicle: { fate: LOW_FATE,  world: HIGH_WORLD, system: HIGH_SYSTEM, enforced: false, description: "Transformative exploration — characters grow within a deepening world" },
  classic:   { fate: HIGH_FATE, world: LOW_WORLD,  system: LOW_SYSTEM,  enforced: false, description: "Plot-driven — threads pay off decisively, less focus on transformation or lore" },
  stage:     { fate: LOW_FATE,  world: HIGH_WORLD, system: LOW_SYSTEM,  enforced: false, description: "Rich inner worlds — characters, places, and artifacts with deep continuity" },
  paper:     { fate: LOW_FATE,  world: LOW_WORLD,  system: HIGH_SYSTEM, enforced: false, description: "Idea-dense — the depth and structure of the world itself is the draw" },
};

/** Get per-scene force profile for a given archetype (or opus if empty/invalid) */
export function getArchetypeForceTargets(archetype: ArchetypeKey | "" | undefined): ArchetypeForceProfile {
  if (!archetype || !(archetype in ARCHETYPE_FORCE_TARGETS)) {
    return ARCHETYPE_FORCE_TARGETS.opus;
  }
  return ARCHETYPE_FORCE_TARGETS[archetype];
}


/** Grade a mean-normalized force value 8→25: g(x̃) = 25 − 17·e^{−kx̃}, k = ln(17/4).
 *  Single exponential — floor 8, reference 21 (dominance threshold), cap 25.
 *  k is fully determined by these three constraints. */
const GRADE_K = Math.log(17 / 4);
export function gradeForce(normalizedMean: number): number {
  return 25 - 17 * Math.exp(-GRADE_K * Math.max(0, normalizedMean));
}

/**
 * Grade narrative forces (0–25 each, 0–100 overall).
 * Fate/world/system are raw values, normalised here by FORCE_REFERENCE_MEANS.
 * Swing values are mean-normalised Euclidean distances — graded directly (single normalisation).
 */
export function gradeForces(
  fate: number[],
  world: number[],
  system: number[],
  swing: number[],
): ForceGrades {
  const R = FORCE_REFERENCE_MEANS;
  const fateGrade = gradeForce(avg(fate) / R.fate);
  const worldGrade = gradeForce(avg(world) / R.world);
  const systemGrade = gradeForce(avg(system) / R.system);
  const swingGrade = gradeForce(avg(swing));

  const overall = fateGrade + worldGrade + systemGrade + swingGrade;

  return {
    fate: Math.round(fateGrade),
    world: Math.round(worldGrade),
    system: Math.round(systemGrade),
    swing: Math.round(swingGrade),
    overall: Math.round(overall),
  };
}
