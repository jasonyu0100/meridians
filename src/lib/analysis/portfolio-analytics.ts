/**
 * Thread-portfolio analytics.
 *
 * Derives aggregate market-state statistics from a narrative's threads:
 *   - Market capitalisation (summed volume — narrative attention mass)
 *   - Focus-window selection & coverage
 *   - Resolution-quality distribution
 *   - Average entropy / uncertainty (how contested the portfolio is)
 *   - Trajectory point per resolved scene (entropy-over-time)
 *
 * These powersur the sidebar portfolio view and the thread dashboard modal.
 * Pure derivation — no IO, no rendering.
 */

import type { NarrativeState, Thread, Scene, WorldBuild } from '@/types/narrative';
import { NARRATOR_AGENT_ID } from '@/types/narrative';
import { STANCE_OPENING_VOLUME } from '@/lib/constants';
import { STANCE_FOCUS_K } from '@/lib/constants';
import {
  isThreadClosed,
  isThreadAbandoned,
  isNearClosed,
  getThreadStance,
  getStanceProbs,
  getStanceMargin,
  normalizedEntropy,
  focusScore,
  selectFocusWindow,
} from '@/lib/forces/narrative-utils';
import {
  classifyThreadCategory,
  type ThreadCategory,
} from '@/lib/forces/thread-category';
import { applyThreadDelta, decayUntouchedStancesForScene, newNarratorStance } from '@/lib/forces/thread-log';

// ── Replay seed ────────────────────────────────────────────────────────────

/** Copy a thread into the "just introduced, no evidence applied" state used as
 *  the replay seed. Always rebuilds the belief from the thread's priorProbs
 *  (or uniform if absent) — never from the existing belief logits.
 *
 *  Why: callers feed in threads from any source — a world commit's intro-time
 *  snapshot (belief == prior, safe to copy) OR `narrative.threads[id]` as a
 *  fallback (belief == post-replay state, with all evidence already baked in).
 *  Copying the latter and then re-applying deltas double-counts evidence,
 *  producing radically different distributions from a single source of truth.
 *  Resetting to prior eliminates the source dependency. The WB-snapshot case
 *  is unchanged because its priorProbs reflect the same initial state its
 *  beliefs encoded. */
function seedThreadCopy(t: Thread): Thread {
  const rawPriorProbs = Array.isArray((t as { priorProbs?: unknown }).priorProbs)
    ? ((t as { priorProbs?: unknown }).priorProbs as unknown[]).map((v) =>
        typeof v === 'number' ? v : NaN,
      )
    : undefined;
  const belief = newNarratorStance(t.outcomes.length, STANCE_OPENING_VOLUME, rawPriorProbs);
  return {
    ...t,
    stances: { [NARRATOR_AGENT_ID]: belief },
    threadLog: { nodes: {}, edges: [] },
    closedAt: undefined,
    closeOutcome: undefined,
    resolutionQuality: undefined,
  };
}

/** Pull the unmutated introduction-time copy of a thread from its source event
 *  (world commit's expansionManifest.newThreads or a scene's newThreads). The
 *  live narrative.threads[id] is post-replay and would carry already-applied
 *  deltas; the source event preserves the prior. Falls back to narrative.threads
 *  for malformed data with no clear introduction. */
function findOriginalThread(
  narrative: NarrativeState,
  threadId: string,
): Thread | undefined {
  for (const wb of Object.values(narrative.worldBuilds ?? {})) {
    for (const t of wb.expansionManifest.newThreads ?? []) {
      if (t.id === threadId) return t;
    }
  }
  for (const scene of Object.values(narrative.scenes ?? {})) {
    if ((scene as Scene).kind !== 'scene') continue;
    for (const t of (scene as Scene).newThreads ?? []) {
      if (t.id === threadId) return t;
    }
  }
  return narrative.threads[threadId];
}

// ── Snapshot-level aggregates ──────────────────────────────────────────────

export type PortfolioSnapshot = {
  /** Total threads in the narrative, regardless of state. */
  totalThreads: number;
  /** Open + not abandoned. */
  activeThreads: number;
  /** Closed (resolved to an outcome). */
  closedThreads: number;
  /** Open but near the closure threshold — saturating markets. */
  nearClosedThreads: number;
  /** Open but volume below abandonment floor. */
  abandonedThreads: number;
  /** Summed volume across all open threads — the "belief weight". */
  beliefCap: number;
  /** Average normalized entropy across open threads. 0 = all decided, 1 = uniform. */
  averageEntropy: number;
  /** Average resolutionQuality across closed threads; null if none closed yet. */
  averageResolutionQuality: number | null;
  /** Count of each resolutionQuality band (earned / adequate / thin). */
  resolutionQualityBands: { earned: number; adequate: number; thin: number };
};

export function computePortfolioSnapshot(narrative: NarrativeState): PortfolioSnapshot {
  const threads = Object.values(narrative.threads);
  let active = 0;
  let closed = 0;
  let near = 0;
  let abandoned = 0;
  let beliefCap = 0;
  let entropySum = 0;
  let entropyCount = 0;
  let qualitySum = 0;
  let qualityCount = 0;
  const bands = { earned: 0, adequate: 0, thin: 0 };
  for (const t of threads) {
    if (isThreadClosed(t)) {
      closed++;
      if (typeof t.resolutionQuality === 'number') {
        qualitySum += t.resolutionQuality;
        qualityCount++;
        if (t.resolutionQuality >= 0.7) bands.earned++;
        else if (t.resolutionQuality >= 0.4) bands.adequate++;
        else bands.thin++;
      }
      continue;
    }
    if (isThreadAbandoned(t)) {
      abandoned++;
      continue;
    }
    active++;
    if (isNearClosed(t)) near++;
    const belief = getThreadStance(t);
    if (belief) beliefCap += belief.volume;
    entropySum += normalizedEntropy(getStanceProbs(t));
    entropyCount++;
  }
  return {
    totalThreads: threads.length,
    activeThreads: active,
    closedThreads: closed,
    nearClosedThreads: near,
    abandonedThreads: abandoned,
    beliefCap,
    averageEntropy: entropyCount > 0 ? entropySum / entropyCount : 0,
    averageResolutionQuality: qualityCount > 0 ? qualitySum / qualityCount : null,
    resolutionQualityBands: bands,
  };
}

// ── Per-thread ranked rows ─────────────────────────────────────────────────

export type PortfolioRow = {
  thread: Thread;
  /** Narrator's current probability distribution. */
  probs: number[];
  /** Index of the currently-leading outcome. */
  topIdx: number;
  /** Log-odds margin between top and runner-up. */
  margin: number;
  /** Normalized entropy [0, 1] — 0 = decided, 1 = maximal uncertainty. */
  entropy: number;
  /** Market volume — accumulated narrative attention. */
  volume: number;
  /** EWMA volatility — how much belief moved recently. */
  volatility: number;
  /** Scenes since last touched (Infinity if never). */
  gap: number;
  /** Focus score — used to rank the portfolio. */
  focus: number;
  /** Market-state category (saturating / contested / volatile / committed /
   *  dormant / abandoned / resolved). Single source of truth for colouring. */
  category: ThreadCategory;
};

/** Terminal tier for sorting. Open markets rank by focus score (volume ×
 *  entropy × (1 + volatility) × recency); terminal states sink to the bottom
 *  with abandoned above resolved, since abandoned still carries signal about
 *  dropped commitments. */
const TERMINAL_TIER: Record<ThreadCategory, number> = {
  saturating: 0,
  volatile: 0,
  contested: 0,
  committed: 0,
  developing: 0,
  dormant: 0,
  abandoned: 1,
  resolved: 2,
};

export function buildPortfolioRows(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): PortfolioRow[] {
  const rows: PortfolioRow[] = [];
  for (const t of Object.values(narrative.threads)) {
    const belief = getThreadStance(t);
    const probs = getStanceProbs(t);
    const { topIdx, margin } = getStanceMargin(t);
    const entropy = normalizedEntropy(probs);
    const volume = belief?.volume ?? 0;
    const volatility = belief?.volatility ?? 0;
    const f = focusScore(t, resolvedEntryKeys, currentSceneIndex);
    const lastTouched = belief?.lastTouchedScene;
    const idx = lastTouched ? resolvedEntryKeys.indexOf(lastTouched) : -1;
    const gap = idx < 0 ? Infinity : currentSceneIndex - idx;
    const category = classifyThreadCategory(t, { scenesSinceTouch: gap });
    rows.push({ thread: t, probs, topIdx, margin, entropy, volume, volatility, gap, focus: f, category });
  }
  rows.sort((a, b) => {
    if (TERMINAL_TIER[a.category] !== TERMINAL_TIER[b.category]) {
      return TERMINAL_TIER[a.category] - TERMINAL_TIER[b.category];
    }
    return b.focus - a.focus;
  });
  return rows;
}

/** Replay every thread's narrator belief up through `targetIndex`, returning
 *  a fresh threads map with evolved state. Drives the sidebar scrubber so
 *  probabilities / volume / volatility visibly change as the user iterates
 *  through scenes.
 *
 *  Introduction is inferred from observable presence on the branch:
 *  a thread enters the map either when its `openedAt` scene/world-build
 *  is walked, or when its first `newThreads` mention or `threadDelta`
 *  touch fires — whichever comes first. The touch fallback covers
 *  threads with stale or off-branch `openedAt` (e.g. data produced
 *  before file-conversion remapped `openedAt`); they still surface
 *  when actual evidence appears in this branch's scenes. Threads
 *  with no observable presence on this branch never enter the map.
 *
 *  Not for generation paths — those read live state. Use this for timeline
 *  visualisations and portfolio scrubbing only. */
export function replayThreadsAtIndex(
  narrative: NarrativeState,
  resolvedKeys: string[],
  targetIndex: number,
): Record<string, Thread> {
  const threads: Record<string, Thread> = {};
  const limit = Math.min(targetIndex, resolvedKeys.length - 1);

  for (let i = 0; i <= limit; i++) {
    const key = resolvedKeys[i];
    const wb = narrative.worldBuilds?.[key] as WorldBuild | undefined;
    if (wb) {
      // Seed threads introduced by this world commit from their unmutated
      // prior — the LLM's in-world base rate, not uniform.
      for (const t of wb.expansionManifest.newThreads ?? []) {
        if (!threads[t.id]) threads[t.id] = seedThreadCopy(t);
      }
      // Apply the commit's market evidence. If the delta touches a
      // thread we haven't seeded yet (stale openedAt / no newThreads
      // entry), seed from the live record so the evidence drives a
      // trajectory rather than being silently dropped.
      for (const tm of wb.expansionManifest.threadDeltas ?? []) {
        if (!threads[tm.threadId]) {
          const live = narrative.threads[tm.threadId];
          if (!live) continue;
          threads[tm.threadId] = seedThreadCopy(live);
        }
        threads[tm.threadId] = applyThreadDelta(threads[tm.threadId], tm, wb.id);
      }
      continue;
    }
    const scene = narrative.scenes[key] as Scene | undefined;
    if (!scene || scene.kind !== 'scene') continue;
    for (const t of scene.newThreads ?? []) {
      if (!threads[t.id]) threads[t.id] = seedThreadCopy(t);
    }
    const touched = new Set<string>();
    for (const tm of scene.threadDeltas ?? []) {
      if (!threads[tm.threadId]) {
        // Touch-as-introduction fallback. See the wb branch above for
        // rationale — keep both branches in lockstep.
        const live = narrative.threads[tm.threadId];
        if (!live) continue;
        threads[tm.threadId] = seedThreadCopy(live);
      }
      touched.add(tm.threadId);
      threads[tm.threadId] = applyThreadDelta(threads[tm.threadId], tm, scene.id);
    }
    const decayed = decayUntouchedStancesForScene(threads, touched);
    for (const [id, t] of Object.entries(decayed)) {
      threads[id] = t;
    }
  }

  return threads;
}

/** Per-thread recent-movement signal. Compares the top-outcome probability
 *  at `targetIndex` against the top-outcome probability `lookback` scenes
 *  earlier. Positive magnitude = market moved; sign indicates direction.
 *  Used by the Market dashboard to surface "breaking news" rows. */
export type ThreadMovement = {
  threadId: string;
  topIdx: number;
  topOutcome: string;
  nowProb: number;
  priorProb: number;
  deltaProb: number;
};

export function computeRecentMovements(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  targetIndex: number,
  lookback: number = 5,
): ThreadMovement[] {
  const now = replayThreadsAtIndex(narrative, resolvedEntryKeys, targetIndex);
  const prior = replayThreadsAtIndex(
    narrative,
    resolvedEntryKeys,
    Math.max(0, targetIndex - lookback),
  );
  const introduced = introducedThreadIdsAtIndex(narrative, resolvedEntryKeys, targetIndex);
  const movements: ThreadMovement[] = [];
  for (const id of introduced) {
    const nowThread = now[id];
    const priorThread = prior[id];
    if (!nowThread || !priorThread) continue;
    if (isThreadAbandoned(nowThread)) continue;
    const nowProbs = getStanceProbs(nowThread);
    const priorProbs = getStanceProbs(priorThread);
    // Compare on the currently-leading outcome — the "headline" of the market.
    let topIdx = 0;
    for (let i = 1; i < nowProbs.length; i++) {
      if ((nowProbs[i] ?? 0) > (nowProbs[topIdx] ?? 0)) topIdx = i;
    }
    const nowProb = nowProbs[topIdx] ?? 0;
    const priorProb = priorProbs[topIdx] ?? 0;
    movements.push({
      threadId: id,
      topIdx,
      topOutcome: nowThread.outcomes[topIdx] ?? '?',
      nowProb,
      priorProb,
      deltaProb: nowProb - priorProb,
    });
  }
  // Rank by absolute movement magnitude.
  movements.sort((a, b) => Math.abs(b.deltaProb) - Math.abs(a.deltaProb));
  return movements;
}

/** Set of thread ids that have actually been introduced by `targetIndex`.
 *  A thread counts as introduced when ANY of these hold for a scene /
 *  world-build at-or-before the cutoff: its `openedAt` resolves there,
 *  it appears in `newThreads`, or a `threadDelta` touches it. The
 *  touch-as-introduction fallback covers threads with stale or
 *  off-branch `openedAt` (matches `replayThreadsAtIndex`). */
export function introducedThreadIdsAtIndex(
  narrative: NarrativeState,
  resolvedKeys: string[],
  targetIndex: number,
): Set<string> {
  const visible = new Set<string>();
  const limit = Math.min(targetIndex, resolvedKeys.length - 1);
  const visibleKeys = new Set(resolvedKeys.slice(0, limit + 1));
  // Pass 1 — openedAt direct hits.
  for (const [id, t] of Object.entries(narrative.threads)) {
    if (t.openedAt && visibleKeys.has(t.openedAt)) visible.add(id);
  }
  // Pass 2 — newThreads + threadDelta touches in visible scenes / world
  // commits. Iterates keys once, not (threads × keys).
  for (const key of visibleKeys) {
    const scene = narrative.scenes[key] as Scene | undefined;
    if (scene && scene.kind === 'scene') {
      for (const nt of scene.newThreads ?? []) visible.add(nt.id);
      for (const tm of scene.threadDeltas ?? []) visible.add(tm.threadId);
      continue;
    }
    const wb = narrative.worldBuilds?.[key] as WorldBuild | undefined;
    if (wb) {
      for (const nt of wb.expansionManifest.newThreads ?? []) visible.add(nt.id);
      for (const tm of wb.expansionManifest.threadDeltas ?? []) visible.add(tm.threadId);
    }
  }
  // Drop ids that aren't actual narrative threads (defensive — a
  // threadDelta could in principle reference an unknown id).
  for (const id of [...visible]) {
    if (!narrative.threads[id]) visible.delete(id);
  }
  return visible;
}

/** Ids of threads currently in the focus window (priority for generation). */
export function currentFocusIds(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
  k: number = STANCE_FOCUS_K,
): Set<string> {
  return new Set(selectFocusWindow(narrative, resolvedEntryKeys, currentSceneIndex, k).map((t) => t.id));
}

// ── Per-thread time series ─────────────────────────────────────────────────

export type ThreadTrajectoryPoint = {
  /** Resolved-entry index where the point is anchored (mixed scenes + world
   *  commits). Useful for cross-referencing the raw timeline. */
  sceneIndex: number;
  /** 1-based scene ordinal excluding world commits — this is the "scene N"
   *  number the UI should display on axes and tooltips. */
  sceneOrdinal: number;
  /** Scene id (for hover / click-through). */
  sceneId: string;
  /** Outcome labels at this scene — the running cursor's outcomes (post
   *  any mid-narrative addOutcomes). ALWAYS aligned 1:1 with `probs` so the
   *  UI can render label/value pairs without an external lookup whose
   *  length may have drifted from the cursor's softmax distribution. */
  outcomes: string[];
  /** Probability distribution at this scene. */
  probs: number[];
  /** Normalized entropy at this scene. */
  entropy: number;
  /** Volume at this scene. */
  volume: number;
  /** Log-odds margin at this scene. */
  margin: number;
};

/** Replay a single thread's trajectory across the resolved timeline.
 *
 *  Rebuilds the narrator belief scene-by-scene so callers can render the
 *  probability stack / entropy curve without having stored per-scene beliefs.
 *  O(scenes × outcomes) — cheap for portfolio analytics, not intended for hot
 *  generation paths. */
export function buildThreadTrajectory(
  narrative: NarrativeState,
  threadId: string,
  resolvedEntryKeys: string[],
): ThreadTrajectoryPoint[] {
  const thread0 = findOriginalThread(narrative, threadId);
  if (!thread0) return [];
  // Seed from the thread's introduction-time prior — preserves the LLM's
  // in-world base rate (e.g. 39/30/30 for a contested 3-outcome market)
  // instead of forcing uniform.
  let cursor: Thread = seedThreadCopy(thread0);
  // A thread that opens mid-story has no market state to plot before
  // openedAt — plotting a flat line from scene 0 misrepresents the
  // market as priced-before-it-existed. Resolve the introduction key
  // in two passes: (1) honour `openedAt` when it points at a key on
  // this branch; (2) otherwise fall back to the earliest key where
  // the thread shows observable presence (newThreads or threadDelta).
  // The fallback covers stale / off-branch openedAt — a thread with
  // applied evidence on the branch still gets a real trajectory.
  // Returns [] only when no presence is observable anywhere on the
  // branch; the chart renders a dashed prior in that case.
  let startIdx = thread0.openedAt
    ? resolvedEntryKeys.indexOf(thread0.openedAt)
    : -1;
  if (startIdx < 0) {
    for (let i = 0; i < resolvedEntryKeys.length; i++) {
      const key = resolvedEntryKeys[i];
      const scene = narrative.scenes[key] as Scene | undefined;
      if (scene && scene.kind === 'scene') {
        const inNew = (scene.newThreads ?? []).some((nt) => nt.id === threadId);
        const inDelta = (scene.threadDeltas ?? []).some((tm) => tm.threadId === threadId);
        if (inNew || inDelta) { startIdx = i; break; }
        continue;
      }
      const wb = narrative.worldBuilds?.[key] as WorldBuild | undefined;
      if (wb) {
        const inNew = (wb.expansionManifest.newThreads ?? []).some((nt) => nt.id === threadId);
        const inDelta = (wb.expansionManifest.threadDeltas ?? []).some((tm) => tm.threadId === threadId);
        if (inNew || inDelta) { startIdx = i; break; }
      }
    }
  }
  if (startIdx < 0) return [];
  // Seed the scene ordinal from the count of scenes that precede startIdx so
  // the ordinal we emit on each trajectory point is scene-only (world commits
  // excluded). The UI uses this directly for axis labels.
  let sceneOrdinal = 0;
  for (let j = 0; j < startIdx; j++) {
    if (narrative.scenes[resolvedEntryKeys[j]]) sceneOrdinal++;
  }
  const points: ThreadTrajectoryPoint[] = [];
  for (let i = startIdx; i < resolvedEntryKeys.length; i++) {
    const key = resolvedEntryKeys[i];
    const wb = narrative.worldBuilds?.[key] as WorldBuild | undefined;
    if (wb) {
      // World commits can carry threadDeltas — apply them silently (no
      // trajectory point emitted, since the x-axis is scene-only) so the
      // running cursor matches the canonical state.
      for (const tm of wb.expansionManifest.threadDeltas ?? []) {
        if (tm.threadId !== threadId) continue;
        cursor = applyThreadDelta(cursor, tm, wb.id);
      }
      if (cursor.closedAt) break;
      continue;
    }
    const scene = narrative.scenes[key] as Scene | undefined;
    if (!scene || scene.kind !== 'scene') continue;
    sceneOrdinal++;
    const touched = new Set<string>();
    const threadsMap: Record<string, Thread> = { [threadId]: cursor };
    for (const tm of scene.threadDeltas ?? []) {
      if (tm.threadId === threadId) {
        touched.add(threadId);
        threadsMap[threadId] = applyThreadDelta(threadsMap[threadId], tm, key);
      }
    }
    if (!touched.has(threadId)) {
      // Decay volume for scenes that skipped the thread — mirrors store replay.
      const decayed = decayUntouchedStancesForScene(threadsMap, touched);
      cursor = decayed[threadId];
    } else {
      cursor = threadsMap[threadId];
    }
    const probs = getStanceProbs(cursor);
    const { margin } = getStanceMargin(cursor);
    const belief = getThreadStance(cursor);
    points.push({
      sceneIndex: i,
      sceneOrdinal,
      sceneId: key,
      // Snapshot the cursor's outcomes at the same moment we snapshot its
      // probs. Mid-narrative addOutcomes can grow this beyond the live
      // narrative.threads[id].outcomes — keeping the pair together
      // guarantees the UI renders matching labels/values.
      outcomes: cursor.outcomes.slice(),
      probs,
      entropy: normalizedEntropy(probs),
      volume: belief?.volume ?? 0,
      margin,
    });
    if (cursor.closedAt) break;
  }
  return points;
}

// ── Portfolio-wide time series ─────────────────────────────────────────────

export type PortfolioTrajectoryPoint = {
  /** Resolved-entry index where the point is anchored. */
  sceneIndex: number;
  /** 1-based scene ordinal excluding world commits — axis-ready value. */
  sceneOrdinal: number;
  /** Scene id, for click-through and hover labels. */
  sceneId: string;
  /** Total volume across open markets — "belief weight" of narrative attention. */
  attention: number;
  /** Average normalized entropy across open markets, 0–1. */
  uncertainty: number;
  /** Average EWMA volatility across open markets. */
  volatility: number;
  /** Share of live markets within the near-closure band, 0–1. */
  saturationRate: number;
  /** Share of live markets at high entropy (≥0.7) — genuinely contested. */
  contestedRate: number;
  /** Number of open markets (neither closed nor abandoned). */
  activeCount: number;
  /** Number of markets that have closed to an outcome by this scene. */
  closedCount: number;
};

/** Walk every scene from 0 to `currentSceneIndex`, snapshotting the portfolio
 *  at each step. One pass — maintains thread state incrementally rather than
 *  re-replaying from scratch per scene. Drives the Trends view in the market
 *  dashboard. Skips world commits so the x-axis is scene-only. */
export function buildPortfolioTrajectory(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): PortfolioTrajectoryPoint[] {
  const limit = Math.min(currentSceneIndex, resolvedEntryKeys.length - 1);
  if (limit < 0) return [];

  // Strict introduction semantics: threads only enter the map at their
  // openedAt scene/world-build during the walk below. Off-branch or
  // malformed openedAt → never visible on this timeline. Matches
  // replayThreadsAtIndex + introducedThreadIdsAtIndex.
  const threads: Record<string, Thread> = {};

  const points: PortfolioTrajectoryPoint[] = [];
  let sceneOrdinal = 0;
  const CONTESTED_ENTROPY_FLOOR = 0.7;

  for (let i = 0; i <= limit; i++) {
    const key = resolvedEntryKeys[i];

    const wb = narrative.worldBuilds?.[key] as WorldBuild | undefined;
    if (wb) {
      // Seed and apply commit-level evidence — no point emitted, axis is
      // scene-only. Cursor still moves so the next scene point reflects any
      // world-commit attention spend.
      for (const t of wb.expansionManifest.newThreads ?? []) {
        if (!threads[t.id]) threads[t.id] = seedThreadCopy(t);
      }
      for (const tm of wb.expansionManifest.threadDeltas ?? []) {
        const thread = threads[tm.threadId];
        if (!thread) continue;
        threads[tm.threadId] = applyThreadDelta(thread, tm, wb.id);
      }
      continue;
    }

    const scene = narrative.scenes[key] as Scene | undefined;
    if (!scene || scene.kind !== 'scene') continue;
    for (const t of scene.newThreads ?? []) {
      if (!threads[t.id]) threads[t.id] = seedThreadCopy(t);
    }
    sceneOrdinal++;

    const touched = new Set<string>();
    for (const tm of scene.threadDeltas ?? []) {
      if (!threads[tm.threadId]) continue;
      touched.add(tm.threadId);
      threads[tm.threadId] = applyThreadDelta(threads[tm.threadId], tm, scene.id);
    }
    const decayed = decayUntouchedStancesForScene(threads, touched);
    for (const [id, t] of Object.entries(decayed)) threads[id] = t;

    // Aggregate across the current thread state.
    let attention = 0;
    let entropySum = 0;
    let entropyCount = 0;
    let volatilitySum = 0;
    let volatilityCount = 0;
    let active = 0;
    let closed = 0;
    let saturating = 0;
    let contested = 0;
    for (const t of Object.values(threads)) {
      if (isThreadClosed(t)) {
        closed++;
        continue;
      }
      if (isThreadAbandoned(t)) continue;
      active++;
      const belief = getThreadStance(t);
      if (belief) {
        attention += belief.volume;
        volatilitySum += belief.volatility;
        volatilityCount++;
      }
      const h = normalizedEntropy(getStanceProbs(t));
      entropySum += h;
      entropyCount++;
      if (isNearClosed(t)) saturating++;
      if (h >= CONTESTED_ENTROPY_FLOOR) contested++;
    }

    points.push({
      sceneIndex: i,
      sceneOrdinal,
      sceneId: scene.id,
      attention,
      uncertainty: entropyCount > 0 ? entropySum / entropyCount : 0,
      volatility: volatilityCount > 0 ? volatilitySum / volatilityCount : 0,
      saturationRate: active > 0 ? saturating / active : 0,
      contestedRate: active > 0 ? contested / active : 0,
      activeCount: active,
      closedCount: closed,
    });
  }

  return points;
}
