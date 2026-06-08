/**
 * Stream-portfolio analytics — the HEAD-based cousin of `portfolio-analytics`.
 *
 * The Belief dashboard's Thread surface replays per-scene deltas to scrub the
 * portfolio over the timeline. Streams have no scene index: they're driven by
 * member-contributed priors stamped in wall-clock time. This module computes
 * the same aggregate readouts (rows, snapshot, KPI trajectory, movers, focus)
 * directly from streams, so the Stream surface mirrors the Thread surface
 * without borrowing the scene-replay machinery.
 *
 * The per-prior replay here re-derives the SAME stance evolution as
 * `applyStreamPrior` (logit shifts ÷ sensitivity, EWMA volatility, volume) so
 * the trajectory KPIs agree with the live stance.
 */

import type { Stream } from '@/types/narrative';
import { softmax, normalizedEntropy, clampEvidence } from '@/lib/forces/narrative-utils';
import { streamProbs, streamMargin, classifyStreamCategory } from '@/lib/forces/stream-stance';
import {
  STANCE_OPENING_VOLUME,
  STANCE_EVIDENCE_SENSITIVITY,
  STANCE_VOLATILITY_BETA,
  STANCE_NEAR_CLOSED_MIN,
  STANCE_TAU_CLOSE,
} from '@/lib/constants';
import { CATEGORY_THRESHOLDS, type ThreadCategory } from '@/lib/forces/thread-category';

const zeros = (n: number) => new Array(Math.max(0, n)).fill(0);
const pad = (arr: number[], len: number) => (arr.length >= len ? arr.slice() : [...arr, ...zeros(len - arr.length)]);
const normOutcome = (s: string) => s.trim().toLowerCase();

// ── Rows ─────────────────────────────────────────────────────────────────────

export type StreamRow = {
  stream: Stream;
  probs: number[];
  topIdx: number;
  margin: number;
  volume: number;
  volatility: number;
  entropy: number;
  /** Attention × contestedness × turbulence — what's worth looking at now. */
  focus: number;
  category: ThreadCategory;
  /** Outcome → palette index (identity for streams: ordering never shifts). */
  colourIdx: number[];
};

export function buildStreamRows(streams: Stream[]): StreamRow[] {
  return streams.map((stream) => {
    const probs = streamProbs(stream);
    const { topIdx, margin } = streamMargin(stream);
    const volume = stream.stance?.volume ?? 0;
    const volatility = stream.stance?.volatility ?? 0;
    const entropy = normalizedEntropy(probs);
    const category = classifyStreamCategory(stream);
    // Focus mirrors the thread heuristic minus the scene-recency term (streams
    // carry no scene gap): attention weighted by how contested + turbulent the
    // stance is. A small entropy floor keeps committed-but-loud streams visible.
    const focus = volume * (0.15 + entropy) * (1 + volatility);
    const colourIdx = (stream.outcomes ?? []).map((_, i) => i);
    return { stream, probs, topIdx, margin, volume, volatility, entropy, focus, category, colourIdx };
  });
}

/** Top-K streams by focus among the live (non-terminal) set. */
export function currentStreamFocusIds(rows: StreamRow[], k = 6): Set<string> {
  const live = rows.filter((r) => r.category !== 'resolved' && r.category !== 'abandoned');
  const top = live.slice().sort((a, b) => b.focus - a.focus).slice(0, k);
  return new Set(top.map((r) => r.stream.id));
}

// ── Snapshot ───────────────────────────────────────────────────────────────

export type StreamSnapshot = {
  totalStreams: number;
  activeStreams: number;
  closedStreams: number;
  beliefCap: number;
  averageEntropy: number;
  averageResolutionQuality: number | null;
  resolutionQualityBands: { earned: number; adequate: number; thin: number };
};

export function computeStreamSnapshot(rows: StreamRow[]): StreamSnapshot {
  let beliefCap = 0;
  let entropySum = 0;
  let entropyCount = 0;
  let active = 0;
  let closed = 0;
  let qualitySum = 0;
  let qualityCount = 0;
  const bands = { earned: 0, adequate: 0, thin: 0 };
  for (const r of rows) {
    const open = r.stream.state === 'open';
    if (open) {
      active++;
      beliefCap += r.volume;
      entropySum += r.entropy;
      entropyCount++;
    } else {
      closed++;
    }
    const q = r.stream.resolutionQuality;
    if (q !== undefined) {
      qualitySum += q;
      qualityCount++;
      if (q >= 0.7) bands.earned++;
      else if (q >= 0.4) bands.adequate++;
      else bands.thin++;
    }
  }
  return {
    totalStreams: rows.length,
    activeStreams: active,
    closedStreams: closed,
    beliefCap,
    averageEntropy: entropyCount > 0 ? entropySum / entropyCount : 0,
    averageResolutionQuality: qualityCount > 0 ? qualitySum / qualityCount : null,
    resolutionQualityBands: bands,
  };
}

// ── Per-prior replay (volatility-aware) ──────────────────────────────────────

type StreamStatePoint = { at: number; probs: number[]; volume: number; volatility: number; margin: number };

/** Replay a stream's priors from its opening logits, recording the full stance
 *  state (probs, volume, EWMA volatility, log-odds margin) at each prior. The
 *  math matches `applyStreamPrior` so aggregate KPIs track the live stance. */
function replayStream(stream: Stream): StreamStatePoint[] {
  const outcomes = stream.outcomes ?? [];
  const n = outcomes.length;
  const idxOf = new Map<string, number>();
  outcomes.forEach((o, i) => { const k = normOutcome(o); if (!idxOf.has(k)) idxOf.set(k, i); });
  const logits = pad(stream.openingLogits ?? zeros(n), n);
  let volume = STANCE_OPENING_VOLUME;
  let volatility = 0;
  const states: StreamStatePoint[] = [];
  for (const p of stream.priors) {
    let maxAbsShift = 0;
    for (const u of p.updates ?? []) {
      const idx = idxOf.get(normOutcome(u.outcome));
      if (idx === undefined) continue;
      const shift = clampEvidence(u.evidence) / STANCE_EVIDENCE_SENSITIVITY;
      logits[idx] += shift;
      if (Math.abs(shift) > maxAbsShift) maxAbsShift = Math.abs(shift);
    }
    volume = Math.max(0, volume + (p.volumeDelta ?? 0));
    volatility = STANCE_VOLATILITY_BETA * volatility + (1 - STANCE_VOLATILITY_BETA) * maxAbsShift;
    const sorted = logits.slice().sort((a, b) => b - a);
    const margin = sorted.length >= 2 ? sorted[0] - sorted[1] : 0;
    states.push({ at: p.at, probs: softmax(logits), volume, volatility, margin });
  }
  return states;
}

/** The stance state as of time `t` — the last prior at or before `t`, or null
 *  if the stream hadn't opened yet. */
function stateAsOf(states: StreamStatePoint[], t: number): StreamStatePoint | null {
  let found: StreamStatePoint | null = null;
  for (const s of states) {
    if (s.at <= t) found = s; else break;
  }
  return found;
}

// ── KPI trajectory ─────────────────────────────────────────────────────────

export type StreamTrajectoryAggPoint = {
  at: number;
  /** 1-based ordinal of this event in the merged prior timeline. */
  ordinal: number;
  attention: number;
  uncertainty: number;
  volatility: number;
  saturationRate: number;
  contestedRate: number;
  closedCount: number;
};

/** Aggregate KPI evolution across the merged prior timeline — one point per
 *  distinct prior timestamp. Each point replays every stream up to that moment
 *  and rolls the live (open) stances into portfolio-level readouts. */
export function buildStreamPortfolioTrajectory(streams: Stream[]): StreamTrajectoryAggPoint[] {
  const replays = streams.map((s) => ({ stream: s, states: replayStream(s) }));
  // Distinct, ordered event timestamps across all priors.
  const times = Array.from(new Set(streams.flatMap((s) => s.priors.map((p) => p.at)))).sort((a, b) => a - b);
  const points: StreamTrajectoryAggPoint[] = [];
  times.forEach((t, i) => {
    let attention = 0;
    let entropySum = 0;
    let volatilitySum = 0;
    let liveCount = 0;
    let saturating = 0;
    let contested = 0;
    let closedCount = 0;
    for (const { stream, states } of replays) {
      if (stream.createdAt > t) continue; // not opened yet
      const st = stateAsOf(states, t);
      if (!st) continue;
      const closedByNow = stream.closedAt !== undefined && stream.closedAt <= t;
      if (closedByNow) { closedCount++; continue; }
      attention += st.volume;
      const entropy = normalizedEntropy(st.probs);
      entropySum += entropy;
      volatilitySum += st.volatility;
      liveCount++;
      if (st.margin >= STANCE_NEAR_CLOSED_MIN && st.margin < STANCE_TAU_CLOSE) saturating++;
      if (entropy >= CATEGORY_THRESHOLDS.contestedEntropy) contested++;
    }
    points.push({
      at: t,
      ordinal: i + 1,
      attention,
      uncertainty: liveCount > 0 ? entropySum / liveCount : 0,
      volatility: liveCount > 0 ? volatilitySum / liveCount : 0,
      saturationRate: liveCount > 0 ? saturating / liveCount : 0,
      contestedRate: liveCount > 0 ? contested / liveCount : 0,
      closedCount,
    });
  });
  return points;
}

// ── Movers ───────────────────────────────────────────────────────────────

export type StreamMovement = {
  streamId: string;
  topOutcome: string;
  topIdx: number;
  priorProb: number;
  nowProb: number;
  deltaProb: number;
};

/** Probability shift of each stream's leading outcome vs. `lookback` priors
 *  ago — the stream equivalent of the Thread surface's "vs −N scenes" movers.
 *  Sorted by absolute shift, descending. */
export function computeStreamMovers(streams: Stream[], lookback = 3): StreamMovement[] {
  const moves: StreamMovement[] = [];
  for (const stream of streams) {
    const outcomes = stream.outcomes ?? [];
    if (outcomes.length === 0) continue;
    const states = replayStream(stream);
    if (states.length === 0) continue;
    const { topIdx } = streamMargin(stream);
    if (topIdx < 0) continue;
    const now = states[states.length - 1];
    const past = states[Math.max(0, states.length - 1 - lookback)];
    const nowProb = now.probs[topIdx] ?? 0;
    const priorProb = past.probs[topIdx] ?? 0;
    moves.push({
      streamId: stream.id,
      topOutcome: outcomes[topIdx],
      topIdx,
      priorProb,
      nowProb,
      deltaProb: nowProb - priorProb,
    });
  }
  return moves.sort((a, b) => Math.abs(b.deltaProb) - Math.abs(a.deltaProb));
}
