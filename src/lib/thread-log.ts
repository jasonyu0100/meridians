/**
 * Thread stance application.
 *
 * `applyThreadDelta` takes a ThreadDelta (evidence + logType + volumeDelta +
 * rationale) and produces:
 *   1. An updated narrator Stance — new logits via log-odds update, decayed
 *      + incremented volume, EWMA-updated volatility.
 *   2. A new ThreadLog node appended (the prose-grade event record).
 *   3. Optional closure side-effect if the updated stance satisfies both the
 *      margin condition and a committal logType.
 *
 * `decayUntouchedStancesForScene` applies per-scene volume decay to threads
 * the current scene did NOT touch — runs before delta application so
 * "touched this scene" means "survived this scene's decay pass with a delta."
 */

import type { Stance, Thread, ThreadDelta, ThreadLog, ThreadLogNode } from '@/types/narrative';
import { NARRATOR_AGENT_ID } from '@/types/narrative';
import {
  STANCE_EVIDENCE_SENSITIVITY,
  STANCE_OPENING_MAX_LOGIT,
  STANCE_OPENING_MIN_LOGIT,
  STANCE_VOLATILITY_BETA,
  STANCE_VOLUME_DECAY,
  STANCE_TAU_CLOSE,
  STANCE_OPENING_VOLUME,
} from '@/lib/constants';
import {
  clampEvidence,
  getStanceMargin,
  normalizedEntropy,
  softmax,
} from '@/lib/narrative-utils';

/** Empty thread log — the canonical zero value for thread initialization. */
export const EMPTY_THREAD_LOG: ThreadLog = { nodes: {}, edges: [] };

/** Translate an in-world prior distribution into opening logits.
 *
 *  Input: `priorProbs` is a probability-like vector over outcomes — the LLM's
 *  best estimate of base rates before any story evidence, from the perspective
 *  of a neutral in-world observer. Output: centered log-odds clamped to the
 *  `STANCE_OPENING_MIN_LOGIT..MAX_LOGIT` guardrail so no outcome opens near
 *  saturation.
 *
 *  Falls back to uniform (zeros) whenever priors are absent, the wrong length,
 *  or degenerate (non-finite, non-positive). The clamp is asymmetric-safe — we
 *  re-center after clamping so the vector still means "relative prior" rather
 *  than "absolute log-odds." */
export function deriveInitialLogits(
  numOutcomes: number,
  priorProbs?: readonly number[] | null,
): number[] {
  if (!priorProbs || priorProbs.length !== numOutcomes) {
    return new Array(numOutcomes).fill(0);
  }
  // Small floor to avoid log(0); anything lower than 1% is rounded up.
  const EPS = 0.01;
  const clean = priorProbs.map((p) =>
    Number.isFinite(p) && p > 0 ? Math.max(p, EPS) : EPS,
  );
  // Renormalize in case the LLM didn't sum to 1.
  const sum = clean.reduce((s, p) => s + p, 0);
  const norm = clean.map((p) => p / sum);
  // Log-transform, center, then clamp to opening guardrails.
  const raw = norm.map((p) => Math.log(p));
  const mean = raw.reduce((s, v) => s + v, 0) / raw.length;
  const centered = raw.map((v) => v - mean);
  return centered.map((v) =>
    Math.max(STANCE_OPENING_MIN_LOGIT, Math.min(STANCE_OPENING_MAX_LOGIT, v)),
  );
}

/** Create a fresh narrator stance. Defaults to uniform logits (max entropy)
 *  when no priors supplied — pass `priorProbs` for in-world base-rate seeding. */
export function newNarratorStance(
  numOutcomes: number,
  initialVolume = 2,
  priorProbs?: readonly number[] | null,
): Stance {
  return {
    logits: deriveInitialLogits(numOutcomes, priorProbs),
    volume: initialVolume,
    volatility: 0,
  };
}

/** Apply one scene's evidence to a thread, returning a new Thread object.
 *
 *  - Clamps each evidence to the allowed range
 *  - Updates narrator logits via log-odds arithmetic
 *  - Refreshes volume (existing + volumeDelta, floor at 0)
 *  - EWMA-updates volatility from the max single-outcome shift
 *  - Appends a ThreadLog node carrying the prose rationale + updates snapshot
 *  - Sets closedAt/closeOutcome if (margin ≥ τ) AND logType is committal
 *  - Idempotent on node id collisions (re-applying the same delta is a no-op)
 */
export function applyThreadDelta(
  thread: Thread,
  delta: ThreadDelta,
  sceneId: string,
  opts?: { logNodeId?: string },
): Thread {
  // ── Outcome expansion — append any new outcomes to the thread's market.
  // Closed threads reject expansion (the market is settled). Duplicates and
  // empties are filtered. New outcomes join at logit=0, which is "equal to
  // the current strongest outcome" under softmax — a neutral prior the
  // same-scene evidence updates can then shift.
  const expandedOutcomes: string[] = thread.outcomes.slice();
  const addedOutcomes: string[] = [];
  if (!thread.closedAt && Array.isArray(delta.addOutcomes)) {
    const seen = new Set(thread.outcomes.map((o) => o.toLowerCase()));
    for (const raw of delta.addOutcomes) {
      const name = typeof raw === 'string' ? raw.trim() : '';
      if (!name) continue;
      if (seen.has(name.toLowerCase())) continue;
      expandedOutcomes.push(name);
      addedOutcomes.push(name);
      seen.add(name.toLowerCase());
    }
  }

  // Narrator stance — extend logits to match the (possibly-expanded) outcomes.
  const existingStance: Stance = thread.stances?.[NARRATOR_AGENT_ID]
    ?? newNarratorStance(expandedOutcomes.length);
  const stance: Stance = existingStance.logits.length < expandedOutcomes.length
    ? {
        ...existingStance,
        logits: [
          ...existingStance.logits,
          ...new Array(expandedOutcomes.length - existingStance.logits.length).fill(0),
        ],
      }
    : existingStance;
  const prevLogits = stance.logits.slice();

  // Clamp + apply evidence to logits (against the expanded outcome list).
  // Match outcome names tolerantly (trim + case-fold): the LLM frequently emits
  // an update whose outcome label differs from the thread's canonical outcome
  // only in casing or whitespace ("Yes" vs "yes", " nobody " vs "nobody"). An
  // exact-match lookup silently dropped that evidence, leaving the stance stuck
  // at its uniform prior despite many logs.
  const normOutcome = (s: string) => s.trim().toLowerCase();
  const outcomeIndex = new Map<string, number>();
  expandedOutcomes.forEach((o, i) => {
    const k = normOutcome(o);
    if (!outcomeIndex.has(k)) outcomeIndex.set(k, i);
  });
  const newLogits = prevLogits.slice();
  let maxAbsShift = 0;
  for (const u of delta.updates ?? []) {
    let idx = outcomeIndex.get(normOutcome(u.outcome));
    if (idx === undefined) {
      // Evidence references an outcome the thread doesn't list. On an OPEN
      // thread, fold it into the market (an implicit addOutcome) rather than
      // silently dropping the evidence — otherwise the stance is stuck at its
      // uniform prior forever even as scene after scene reports on it. (Closed
      // markets stay settled and still drop unknown outcomes.)
      const name = typeof u.outcome === 'string' ? u.outcome.trim() : '';
      if (thread.closedAt || !name) continue;
      idx = expandedOutcomes.length;
      expandedOutcomes.push(name);
      addedOutcomes.push(name);
      outcomeIndex.set(normOutcome(name), idx);
      newLogits.push(0);
    }
    const e = clampEvidence(u.evidence);
    const shift = e / STANCE_EVIDENCE_SENSITIVITY;
    newLogits[idx] += shift;
    if (Math.abs(shift) > maxAbsShift) maxAbsShift = Math.abs(shift);
  }

  // Volume — incoming delta adds, floor at 0.
  const volumeDelta = typeof delta.volumeDelta === 'number' ? delta.volumeDelta : 0;
  const newVolume = Math.max(0, stance.volume + volumeDelta);

  // Volatility — EWMA on max-logit-shift this scene.
  const newVolatility = STANCE_VOLATILITY_BETA * stance.volatility
    + (1 - STANCE_VOLATILITY_BETA) * maxAbsShift;

  const updatedStance: Stance = {
    logits: newLogits,
    volume: newVolume,
    volatility: newVolatility,
    lastTouchedScene: sceneId,
  };

  // ── Derived per-delta statistics ───────────────────────────────────────
  // The canonical information-theoretic gain from evidence is the
  // Kullback–Leibler divergence from prior to posterior,
  //   D_KL(p⁺ ‖ p⁻) = Σ_k p⁺(k) · log(p⁺(k) / p⁻(k))
  // which measures how many nats the narrator's stance moved. It reduces
  // to entropy change for small shifts and grows unboundedly as the
  // posterior approaches certainty — capturing closure, twists, and quiet
  // confirmations in a single quantity, with no tuning constants.
  const prePobs = softmax(prevLogits);
  const postProbs = softmax(newLogits);
  let kl = 0;
  for (let k = 0; k < postProbs.length; k++) {
    const q = postProbs[k];
    const p = prePobs[k] ?? 1 / postProbs.length;
    if (q > 1e-12 && p > 1e-12) kl += q * Math.log(q / p);
  }
  const infoGain = Math.max(0, kl);
  const preVolume = stance.volume;
  // Buildup proxy: how many log entries preceded this one on the same
  // thread. No longer used by the elegant fate formula (closure is handled
  // by KL's natural unboundedness), but retained on the log node for
  // analytical / UI purposes.
  const buildup = Object.keys(thread.threadLog.nodes).length;

  // Closure decision hoisted up so we can stamp `closed` on the log node
  // we're about to create. Same rule as the original: margin ≥ τ_effective
  // with a committal logType and decisive evidence, and no outcome
  // expansion on the same delta.
  const committalEarly = delta.logType === 'payoff' || delta.logType === 'twist';
  const peakEvidenceEarly = Math.max(
    0,
    ...(delta.updates ?? []).map((u) => Math.abs(clampEvidence(u.evidence))),
  );
  const sortedL = newLogits.slice().sort((a, b) => b - a);
  const marginEarly = sortedL.length >= 2 ? sortedL[0] - sortedL[1] : 0;
  const volumeRatioEarly = Math.max(1, newVolume / STANCE_OPENING_VOLUME);
  const tauEffectiveEarly = STANCE_TAU_CLOSE * (1 + Math.log(volumeRatioEarly) / 3);
  const willClose =
    !thread.closedAt &&
    committalEarly &&
    peakEvidenceEarly >= 3 &&
    addedOutcomes.length === 0 &&
    marginEarly >= tauEffectiveEarly;

  // ThreadLog node — prose-grade event record with update snapshot. The
  // derived stats (infoGain, preVolume, buildup, closed) enable the refined
  // fate formula to score scenes without a trajectory replay.
  const nodeId = opts?.logNodeId ?? `${thread.id}:${sceneId}`;
  const logNode: ThreadLogNode = {
    id: nodeId,
    type: delta.logType ?? 'pulse',
    content: delta.rationale ?? '',
    sceneId,
    updates: (delta.updates ?? []).map((u) => ({
      outcome: u.outcome,
      evidence: clampEvidence(u.evidence),
    })),
    volumeDelta,
    infoGain,
    preVolume,
    buildup,
    closed: willClose,
    ...(addedOutcomes.length > 0 ? { addedOutcomes } : {}),
  };

  const nextLog: ThreadLog = {
    nodes: { ...thread.threadLog.nodes, [nodeId]: logNode },
    edges: thread.threadLog.edges.slice(),
  };

  // Chain this node to the previous log entry if one exists — preserves the
  // "co-occurs" linkage used by the thread-graph renderer.
  const priorIds = Object.keys(thread.threadLog.nodes);
  if (priorIds.length > 0 && !thread.threadLog.nodes[nodeId]) {
    const prevId = priorIds[priorIds.length - 1];
    nextLog.edges.push({ from: prevId, to: nodeId, relation: 'co_occurs' });
  }

  // If outcomes expanded, also extend any *other* agents' stances so all
  // stance vectors keep matching the canonical outcome list length. Phase 1
  // only has narrator; Phase 5 per-character stances will already fit here.
  const nextStances: Thread['stances'] = { ...thread.stances, [NARRATOR_AGENT_ID]: updatedStance };
  if (addedOutcomes.length > 0) {
    for (const [agentId, agentStance] of Object.entries(nextStances)) {
      if (agentId === NARRATOR_AGENT_ID) continue;
      if (agentStance.logits.length < expandedOutcomes.length) {
        nextStances[agentId] = {
          ...agentStance,
          logits: [
            ...agentStance.logits,
            ...new Array(expandedOutcomes.length - agentStance.logits.length).fill(0),
          ],
        };
      }
    }
  }

  const next: Thread = {
    ...thread,
    outcomes: expandedOutcomes,
    stances: nextStances,
    threadLog: nextLog,
  };

  // Closure — decided above as `willClose`. Applies margin condition AND
  // committal logType (payoff or twist with strong evidence); an outcome-
  // expansion on the same delta cannot close the thread. τ scales sublinearly
  // with accumulated volume so high-attention threads need proportionally
  // more decisive finishes.
  if (willClose) {
    const { topIdx } = getStanceMargin(next);
    next.closedAt = sceneId;
    next.closeOutcome = topIdx;
    next.resolutionQuality = computeResolutionQuality({
      peakEvidence: peakEvidenceEarly,
      margin: marginEarly,
      tauEffective: tauEffectiveEarly,
      volume: updatedStance.volume,
      logits: updatedStance.logits,
    });
  }

  return next;
}

/** Resolution quality ∈ [0, 1] — how earned the closure feels.
 *
 *  Four factors, each in [0, 1], combined as a geometric mean so a weak
 *  showing on any axis drags the whole score down:
 *
 *    - evidenceScore: peak |evidence| at close / max evidence (4)
 *    - marginScore: how far past the scaled τ the margin sits
 *    - volumeScore: how much attention the thread earned (saturates ~5×opening)
 *    - concentrationScore: 1 - normalized entropy (how decisively one outcome
 *                          dominates at close)
 */
function computeResolutionQuality(args: {
  peakEvidence: number;
  margin: number;
  tauEffective: number;
  volume: number;
  logits: number[];
}): number {
  const evidenceScore = Math.min(1, args.peakEvidence / 4);
  const marginExcess = Math.max(0, args.margin - args.tauEffective);
  const marginScore = Math.min(1, marginExcess / args.tauEffective + 0.5); // 0.5 at exact threshold, 1.0 at 1.5× threshold
  const volumeScore = Math.min(1, args.volume / (STANCE_OPENING_VOLUME * 5));
  const probs = softmax(args.logits);
  const concentrationScore = 1 - normalizedEntropy(probs);
  const product = evidenceScore * marginScore * volumeScore * concentrationScore;
  const quality = Math.pow(Math.max(1e-6, product), 0.25); // geometric mean
  return Math.round(quality * 100) / 100;
}

/** Apply volume decay to a stance for a scene it did NOT receive evidence in.
 *  Volatility also decays toward 0 naturally via the EWMA (incoming shift=0). */
export function decayUntouchedStance(stance: Stance): Stance {
  return {
    ...stance,
    volume: stance.volume * STANCE_VOLUME_DECAY,
    volatility: STANCE_VOLATILITY_BETA * stance.volatility,
  };
}

/** Decay the narrator stance on every thread the scene didn't touch. Returns
 *  a modified threads map. Threads touched this scene are passed through
 *  unchanged — applyThreadDelta handles their bookkeeping. */
export function decayUntouchedStancesForScene(
  threads: Record<string, Thread>,
  touchedThreadIds: Set<string>,
): Record<string, Thread> {
  const out: Record<string, Thread> = {};
  for (const [id, t] of Object.entries(threads)) {
    if (touchedThreadIds.has(id)) {
      out[id] = t;
      continue;
    }
    const stance = t.stances?.[NARRATOR_AGENT_ID];
    if (!stance) {
      out[id] = t;
      continue;
    }
    out[id] = {
      ...t,
      stances: { ...t.stances, [NARRATOR_AGENT_ID]: decayUntouchedStance(stance) },
    };
  }
  return out;
}
