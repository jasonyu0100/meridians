/**
 * Stream stance engine — a Stream is a thread.
 *
 * Streams reuse the Fate-Thread belief mechanics (a `Stance` of logits +
 * volume + volatility, evolved by integer evidence as log-odds shifts and
 * renormalised via softmax) but over a SINGLE member-owned stance, whose log
 * nodes are the stream's `priors`. This module is the stream-flavoured cousin
 * of `lib/forces/thread-log.ts`:
 *
 *   - `openStream`        — seed a new stream's stance from the AI's priorProbs
 *                           (deriveInitialLogits) + the member's first intuition.
 *   - `applyStreamPrior`  — apply one prior's evidence to the stance (mirrors
 *                           applyThreadDelta) and append it to the log.
 *   - `streamProbs`       — current softmax distribution over outcomes.
 *   - `streamTrajectory`  — per-prior probability snapshots for the belief
 *                           timeline + scrubbing (replays from openingLogits).
 *   - `streamMargin`      — leader vs runner-up log-odds gap.
 */

import type { OutcomeEvidence, Stance, Stream, StreamPrior, ThreadLogNodeType } from '@/types/narrative';
import {
  STANCE_ABANDON_VOLUME,
  STANCE_EVIDENCE_SENSITIVITY,
  STANCE_NEAR_CLOSED_MIN,
  STANCE_OPENING_VOLUME,
  STANCE_TAU_CLOSE,
  STANCE_VOLATILITY_BETA,
} from '@/lib/constants';
import { clampEvidence, normalizedEntropy, softmax } from '@/lib/forces/narrative-utils';
import { deriveInitialLogits } from '@/lib/forces/thread-log';
import { CATEGORY_THRESHOLDS, type ThreadCategory } from '@/lib/forces/thread-category';

/** Resolution quality ∈ [0,1] — how earned a closure is. Geometric mean of
 *  peak-evidence, margin-over-τ, attention volume, and concentration. Mirrors
 *  the thread-log computation so streams and threads grade closures alike. */
function resolutionQuality(args: { peakEvidence: number; margin: number; tauEffective: number; volume: number; logits: number[] }): number {
  const evidenceScore = Math.min(1, args.peakEvidence / 4);
  const marginScore = Math.min(1, Math.max(0, args.margin - args.tauEffective) / args.tauEffective + 0.5);
  const volumeScore = Math.min(1, args.volume / (STANCE_OPENING_VOLUME * 5));
  const concentrationScore = 1 - normalizedEntropy(softmax(args.logits));
  const product = evidenceScore * marginScore * volumeScore * concentrationScore;
  return Math.round(Math.pow(Math.max(1e-6, product), 0.25) * 100) / 100;
}

const mkId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const normOutcome = (s: string) => s.trim().toLowerCase();

function outcomeIndexMap(outcomes: string[]): Map<string, number> {
  const m = new Map<string, number>();
  outcomes.forEach((o, i) => { const k = normOutcome(o); if (!m.has(k)) m.set(k, i); });
  return m;
}

/** KL divergence prior→posterior in nats (the info-gain a shift produced). */
function klDivergence(pre: number[], post: number[]): number {
  let kl = 0;
  for (let k = 0; k < post.length; k++) {
    const q = post[k];
    const p = pre[k] ?? 1 / post.length;
    if (q > 1e-12 && p > 1e-12) kl += q * Math.log(q / p);
  }
  return Math.max(0, kl);
}

/** Apply a prior's evidence to a base logit vector, returning new logits +
 *  the max single-outcome shift (for volatility). Shared by apply + replay. */
function applyEvidence(
  baseLogits: number[],
  outcomes: string[],
  updates: OutcomeEvidence[] | undefined,
): { logits: number[]; maxAbsShift: number } {
  const logits = baseLogits.slice();
  const idxOf = outcomeIndexMap(outcomes);
  let maxAbsShift = 0;
  for (const u of updates ?? []) {
    const idx = idxOf.get(normOutcome(u.outcome));
    if (idx === undefined) continue;
    const shift = clampEvidence(u.evidence) / STANCE_EVIDENCE_SENSITIVITY;
    logits[idx] += shift;
    if (Math.abs(shift) > maxAbsShift) maxAbsShift = Math.abs(shift);
  }
  return { logits, maxAbsShift };
}

// ── Open ─────────────────────────────────────────────────────────────────────
export type OpenStreamArgs = {
  perspectiveId: string;
  memberId?: string;
  /** The AI player driving the stream (set instead of `memberId`). */
  agentId?: string;
  /** The open question. */
  question: string;
  /** Named outcomes (≥ 2). */
  outcomes: string[];
  /** AI's in-world base-rate probability vector → opening logits. */
  priorProbs?: readonly number[] | null;
  /** The member's seeding intuition (becomes prior #1). */
  intuition: string;
  /** Perceptual primitive for the opening prior. */
  intuitionLogType?: ThreadLogNodeType;
  horizon?: Stream['horizon'];
  inferred?: boolean;
  /** Origin branch — stamps the stream for branch-scoped visibility. */
  branchId?: string;
};

/** Open a stream with an AI-seeded stance. The opening logits come from
 *  `priorProbs` exactly like a Fate Thread's narrator stance; the intuition is
 *  stored as prior #1 (the seed — its directional weight lives in the logits,
 *  so it carries no further evidence shift). */
export function openStream(args: OpenStreamArgs): Stream {
  const now = Date.now();
  const outcomes = args.outcomes.slice();
  const openingLogits = deriveInitialLogits(outcomes.length, args.priorProbs);
  const stance: Stance = {
    logits: openingLogits.slice(),
    volume: STANCE_OPENING_VOLUME,
    volatility: 0,
  };
  const firstPrior: StreamPrior = {
    id: mkId('p'),
    authorId: args.memberId,
    text: args.intuition,
    at: now,
    logType: args.intuitionLogType ?? 'setup',
    infoGain: 0,
    preVolume: STANCE_OPENING_VOLUME,
  };
  return {
    id: mkId('stream'),
    perspectiveId: args.perspectiveId,
    memberId: args.memberId,
    agentId: args.agentId,
    title: args.question,
    outcomes,
    stance,
    openingLogits: openingLogits.slice(),
    horizon: args.horizon,
    state: 'open',
    priors: [firstPrior],
    inferred: args.inferred,
    branchId: args.branchId,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Apply a prior ──────────────────────────────────────────────────────────
export type StreamPriorInput = {
  text: string;
  authorId?: string;
  updates?: OutcomeEvidence[];
  logType?: ThreadLogNodeType;
  volumeDelta?: number;
  /** New outcomes this prior introduces (mid-stream), like a ThreadDelta. */
  addOutcomes?: string[];
};

const pad = (arr: number[], len: number) => arr.length >= len ? arr.slice() : [...arr, ...new Array(len - arr.length).fill(0)];

/** Apply one prior's evidence to the stream's stance and append it to the log.
 *  Mirrors applyThreadDelta: optional outcome expansion (new outcomes join at
 *  logit 0), log-odds shift ÷ sensitivity, EWMA volatility, volume, KL
 *  info-gain. Closure is SOFT — it records a leading resolution but never
 *  blocks further priors (the GM sets the final outcome at commit). */
export function applyStreamPrior(stream: Stream, input: StreamPriorInput): Stream {
  // A stream's stance is only mutable while open. Once committed (folded into a
  // merge) or closed (resolved), its priors are sealed — no further evidence.
  if (stream.state !== 'open') return stream;

  const now = Date.now();

  // ── Outcome expansion — append any genuinely-new outcomes. Evidence that
  // references an unknown outcome also folds it in (matches applyThreadDelta).
  const outcomes = (stream.outcomes ?? []).slice();
  const addedOutcomes: string[] = [];
  const seen = new Set(outcomes.map((o) => normOutcome(o)));
  const considerAdd = (raw: unknown) => {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name || seen.has(normOutcome(name))) return;
    outcomes.push(name); addedOutcomes.push(name); seen.add(normOutcome(name));
  };
  for (const a of input.addOutcomes ?? []) considerAdd(a);
  for (const u of input.updates ?? []) if (!seen.has(normOutcome(u.outcome))) considerAdd(u.outcome);

  const base: Stance = stream.stance ?? { logits: [], volume: STANCE_OPENING_VOLUME, volatility: 0 };
  const prevLogits = pad(base.logits, outcomes.length);
  const { logits: newLogits, maxAbsShift } = applyEvidence(prevLogits, outcomes, input.updates);

  const volumeDelta = typeof input.volumeDelta === 'number' ? input.volumeDelta : 0;
  const newVolume = Math.max(0, base.volume + volumeDelta);
  const newVolatility = STANCE_VOLATILITY_BETA * base.volatility + (1 - STANCE_VOLATILITY_BETA) * maxAbsShift;
  const infoGain = klDivergence(softmax(prevLogits), softmax(newLogits));

  const prior: StreamPrior = {
    id: mkId('p'),
    authorId: input.authorId,
    text: input.text,
    at: now,
    updates: (input.updates ?? []).map((u) => ({ outcome: u.outcome, evidence: clampEvidence(u.evidence) })),
    logType: input.logType ?? 'pulse',
    volumeDelta,
    infoGain,
    preVolume: base.volume,
    ...(addedOutcomes.length > 0 ? { addedOutcomes } : {}),
  };

  const nextStance: Stance = { logits: newLogits, volume: newVolume, volatility: newVolatility };

  // Soft resolution — committal primitive + decisive evidence + margin past a
  // volume-scaled τ (identical rule to applyThreadDelta). Records the leading
  // outcome + resolutionQuality but keeps the stream open to further priors.
  const committal = prior.logType === 'payoff' || prior.logType === 'twist';
  const peak = Math.max(0, ...(prior.updates ?? []).map((u) => Math.abs(u.evidence)));
  const sorted = newLogits.slice().sort((a, b) => b - a);
  const margin = sorted.length >= 2 ? sorted[0] - sorted[1] : 0;
  const tauEffective = STANCE_TAU_CLOSE * (1 + Math.log(Math.max(1, newVolume / STANCE_OPENING_VOLUME)) / 3);
  const resolves = committal && peak >= 3 && addedOutcomes.length === 0 && margin >= tauEffective;

  const next: Stream = {
    ...stream,
    outcomes,
    stance: nextStance,
    // Keep the replay base aligned to the (possibly grown) outcome list.
    openingLogits: pad(stream.openingLogits ?? [], outcomes.length),
    priors: [...stream.priors, prior],
    updatedAt: now,
  };
  if (resolves) {
    next.closedAt = now;
    next.closeOutcome = newLogits.indexOf(Math.max(...newLogits));
    next.resolutionQuality = resolutionQuality({ peakEvidence: peak, margin, tauEffective, volume: newVolume, logits: newLogits });
  }
  return next;
}

// ── Rebuild ──────────────────────────────────────────────────────────────────
/** Recompute a stream's full state cumulatively from a prior list — the source
 *  of truth is the priors, so editing/deleting one must replay from scratch.
 *  Used by prior deletion: an outcome introduced ONLY by a removed prior is
 *  dropped (so the sparkline reverts), stance/volume/volatility are re-derived,
 *  each kept prior's infoGain/preVolume/addedOutcomes are restamped, and soft
 *  resolution is re-evaluated. `keepPriors` is the surviving subset, in order;
 *  `stream` must still carry its FULL prior list so base (opening) outcomes can
 *  be told apart from prior-introduced ones. */
export function rebuildStream(stream: Stream, keepPriors: StreamPrior[]): Stream {
  // Base outcomes = present at open, never introduced by any prior. Derived from
  // the FULL (pre-removal) prior list so an outcome added only by a removed
  // prior isn't mistaken for a base outcome and wrongly retained.
  const everAdded = new Set<string>();
  for (const p of stream.priors) for (const o of p.addedOutcomes ?? []) everAdded.add(normOutcome(o));
  const baseOutcomes = (stream.outcomes ?? []).filter((o) => !everAdded.has(normOutcome(o)));
  const baseOpening = pad((stream.openingLogits ?? []).slice(0, baseOutcomes.length), baseOutcomes.length);

  const outcomes = baseOutcomes.slice();
  const seen = new Set(outcomes.map(normOutcome));
  let logits = baseOpening.slice();
  let volume = STANCE_OPENING_VOLUME;
  let volatility = 0;
  let closedAt: number | undefined;
  let closeOutcome: number | undefined;
  let resQuality: number | undefined;

  const rebuiltPriors: StreamPrior[] = keepPriors.map((p) => {
    // Re-introduce the outcomes this surviving prior brought (orphans from a
    // removed prior never re-enter, since no kept prior reintroduces them).
    const addedOutcomes: string[] = [];
    const consider = (raw: unknown) => {
      const name = typeof raw === 'string' ? raw.trim() : '';
      if (!name || seen.has(normOutcome(name))) return;
      outcomes.push(name); addedOutcomes.push(name); seen.add(normOutcome(name));
    };
    for (const o of p.addedOutcomes ?? []) consider(o);
    for (const u of p.updates ?? []) if (!seen.has(normOutcome(u.outcome))) consider(u.outcome);

    const prevLogits = pad(logits, outcomes.length);
    const { logits: newLogits, maxAbsShift } = applyEvidence(prevLogits, outcomes, p.updates);
    const preVolume = volume;
    volume = Math.max(0, volume + (p.volumeDelta ?? 0));
    volatility = STANCE_VOLATILITY_BETA * volatility + (1 - STANCE_VOLATILITY_BETA) * maxAbsShift;
    const infoGain = klDivergence(softmax(prevLogits), softmax(newLogits));
    logits = newLogits;

    // Soft resolution — same rule as applyStreamPrior, re-evaluated in replay.
    if (closedAt === undefined) {
      const committal = p.logType === 'payoff' || p.logType === 'twist';
      const peak = Math.max(0, ...(p.updates ?? []).map((u) => Math.abs(u.evidence)));
      const sorted = newLogits.slice().sort((a, b) => b - a);
      const margin = sorted.length >= 2 ? sorted[0] - sorted[1] : 0;
      const tauEffective = STANCE_TAU_CLOSE * (1 + Math.log(Math.max(1, volume / STANCE_OPENING_VOLUME)) / 3);
      if (committal && peak >= 3 && addedOutcomes.length === 0 && margin >= tauEffective) {
        closedAt = p.at;
        closeOutcome = newLogits.indexOf(Math.max(...newLogits));
        resQuality = resolutionQuality({ peakEvidence: peak, margin, tauEffective, volume, logits: newLogits });
      }
    }

    return {
      ...p,
      infoGain,
      preVolume,
      ...(addedOutcomes.length > 0 ? { addedOutcomes } : {}),
    };
  });

  const next: Stream = {
    ...stream,
    outcomes,
    openingLogits: baseOpening,
    stance: { logits, volume, volatility },
    priors: rebuiltPriors,
    updatedAt: Date.now(),
  };
  if (closedAt !== undefined) {
    next.closedAt = closedAt;
    next.closeOutcome = closeOutcome;
    next.resolutionQuality = resQuality;
  } else {
    delete next.closedAt;
    delete next.closeOutcome;
    delete next.resolutionQuality;
  }
  return next;
}

// ── Derived readouts ─────────────────────────────────────────────────────────
const zeros = (n: number) => new Array(Math.max(0, n)).fill(0);

/** Current probability distribution over the stream's outcomes. */
export function streamProbs(stream: Stream): number[] {
  const n = stream.outcomes?.length ?? 0;
  if (n === 0) return [];
  return softmax(stream.stance?.logits ?? stream.openingLogits ?? zeros(n));
}

/** Leader-vs-runner-up log-odds gap and the leading outcome index. */
export function streamMargin(stream: Stream): { topIdx: number; margin: number } {
  const logits = stream.stance?.logits ?? stream.openingLogits ?? zeros(stream.outcomes?.length ?? 0);
  if (logits.length === 0) return { topIdx: -1, margin: 0 };
  let topIdx = 0;
  for (let i = 1; i < logits.length; i++) if (logits[i] > logits[topIdx]) topIdx = i;
  const sorted = logits.slice().sort((a, b) => b - a);
  return { topIdx, margin: sorted.length >= 2 ? sorted[0] - sorted[1] : 0 };
}

export type StreamTrajectoryPoint = {
  priorId: string;
  at: number;
  probs: number[];
  volume: number;
  infoGain: number;
};

/** Per-prior probability snapshots — replays evidence from the opening logits
 *  so the belief timeline can scrub the stance over the stream's life. */
export function streamTrajectory(stream: Stream): StreamTrajectoryPoint[] {
  const outcomes = stream.outcomes ?? [];
  let logits = pad(stream.openingLogits ?? zeros(outcomes.length), outcomes.length);
  let volume = STANCE_OPENING_VOLUME;
  const pts: StreamTrajectoryPoint[] = [];
  for (const p of stream.priors) {
    const res = applyEvidence(logits, outcomes, p.updates);
    logits = res.logits;
    volume = Math.max(0, volume + (p.volumeDelta ?? 0));
    pts.push({ priorId: p.id, at: p.at, probs: softmax(logits), volume, infoGain: p.infoGain ?? 0 });
  }
  return pts;
}

/** Classify a stream into the same category vocabulary as the belief system
 *  (resolved/abandoned/saturating/volatile/contested/committed/developing/
 *  dormant) — mirrors classifyThreadCategory so the portfolio reads consistent. */
export function classifyStreamCategory(stream: Stream): ThreadCategory {
  if (stream.closedAt) return 'resolved';
  const stance = stream.stance;
  const volume = stance?.volume ?? 0;
  if (volume < STANCE_ABANDON_VOLUME && stream.priors.length > 1) return 'abandoned';

  const probs = streamProbs(stream);
  const { margin } = streamMargin(stream);
  const volatility = stance?.volatility ?? 0;
  const entropy = normalizedEntropy(probs);
  const topProb = probs.length ? Math.max(...probs) : 0;

  // Recent logit energy over the last N priors (gradual-drift signal).
  let recentEnergy = 0;
  for (const p of stream.priors.slice(-CATEGORY_THRESHOLDS.recentEnergyWindow)) {
    for (const u of p.updates ?? []) recentEnergy += Math.abs(u.evidence) / STANCE_EVIDENCE_SENSITIVITY;
  }

  if (margin >= STANCE_NEAR_CLOSED_MIN && margin < STANCE_TAU_CLOSE) return 'saturating';
  if (volatility >= CATEGORY_THRESHOLDS.volatileMin || recentEnergy >= CATEGORY_THRESHOLDS.volatileRecentEnergy) return 'volatile';
  if (entropy >= CATEGORY_THRESHOLDS.contestedEntropy && volume >= CATEGORY_THRESHOLDS.contestedMinVolume) return 'contested';
  if (topProb >= CATEGORY_THRESHOLDS.committedMinProb) return 'committed';
  if (recentEnergy >= CATEGORY_THRESHOLDS.developingMinEnergy) return 'developing';
  return 'dormant';
}
