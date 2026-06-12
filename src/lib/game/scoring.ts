/** Conviction scoring — the Fate Metric (CONCEPT.md §The scoring math).
 *
 *  Impact = each seat's attributed share of Fate moved (the north star). Scoring
 *  is RETROSPECTIVE: the merge generates an arc, the arc's thread deltas give the
 *  cumulative realized fate logits per canonical thread (ℓ⁻ → ℓ⁺), and we
 *  attribute that realized shift back to the streams that drove it. The
 *  cause→effect mapping (which stream's bearing moved which thread) is the
 *  attribution step's job (game-attribution.ts, AI-assisted); THIS module is the
 *  pure maths: given each contributor's share of the realized Δℓ, decompose the
 *  realized KL fate across them Aumann–Shapley-style, with the unattributable
 *  residual owned by a Fate "house band".
 *
 *  Key identity (verified): for p(s) = softmax(ℓ⁻ + s·Δℓ),
 *      g_k(s) = p_k(s)·[ ln(p_k(s)/p⁻_k) − KL(p(s)‖p⁻) ]   ⇒   ⟨Δℓ, g(s)⟩ = d/ds KL(p(s)‖p⁻).
 *  So ∫₀¹⟨share_i,g⟩ds sums to KL(p⁺‖p⁻) when Σ_i share_i = Δℓ — conservation is
 *  exact (up to integration error): Σ FateCredit_i + houseBand = totalFate. No
 *  seat mints Impact; the draw's variance never signs a seat (it's the band). */
import { softmax } from "@/lib/forces/narrative-utils";

/** Aumann–Shapley path-integral resolution — Simpson's composite rule (even N).
 *  The integrand is smooth, so 48 intervals gives ~machine-precision conservation
 *  for a few K·N dot products per thread; CONCEPT.md's "~8 steps" is the cheap
 *  floor, but the score is the north star so we pay for an exact-looking ledger. */
const AS_STEPS = 48;

/** The Fate house band's reserved key in a credits map. */
export const FATE_BAND_KEY = "__fate__";

/** One thread's realized shift + how it's apportioned across contributors. */
export interface ThreadAttribution {
  threadId: string;
  /** ℓ⁻ — round-start thread stance logits. */
  logitsBefore: number[];
  /** ℓ⁺ — logits after the generated arc landed (realized). */
  logitsAfter: number[];
  /** Stance volume / attention weight (v). */
  volume: number;
  /** Contributor share vectors in logit space, keyed by seatId. Need NOT sum to
   *  Δℓ — whatever they don't explain becomes the Fate house band. */
  shares: Record<string, number[]>;
}

export interface ThreadScore {
  threadId: string;
  /** v·φ_i per seat — signed (push the odds against the realized shift → negative). */
  fateCredits: Record<string, number>;
  /** v·φ_fate — the residual the world owns (the snap / emergent part). */
  houseBand: number;
  /** v·KL(p⁺‖p⁻) — the total realized fate this thread moved. */
  totalFate: number;
}

export interface RoundScore {
  /** Σ over threads of v·φ_i, per seat. */
  perSeat: Record<string, number>;
  /** Σ over threads of the Fate house band. */
  houseBand: number;
  /** Σ over threads of totalFate. */
  total: number;
  /** Per-thread breakdown (for the readout streamgraph). */
  threads: ThreadScore[];
}

/** KL(p‖q) in nats, guarding zeros. */
function kl(p: number[], q: number[]): number {
  let acc = 0;
  for (let k = 0; k < p.length; k++) {
    const pk = p[k];
    if (pk > 0 && q[k] > 0) acc += pk * Math.log(pk / q[k]);
  }
  return acc;
}

/** Pad two logit vectors to equal length (a claim may have added an outcome);
 *  missing entries read as a very low logit (≈ probability 0). */
function alignLengths(a: number[], b: number[]): [number[], number[]] {
  const n = Math.max(a.length, b.length);
  const pad = (v: number[]) => (v.length === n ? v : [...v, ...Array(n - v.length).fill(-12)]);
  return [pad(a), pad(b)];
}

/** Decompose one thread's realized fate across its contributors + the Fate band. */
export function scoreThread(input: ThreadAttribution): ThreadScore {
  const [lm, lp] = alignLengths(input.logitsBefore, input.logitsAfter);
  const K = lm.length;
  const v = input.volume;
  const dl = lp.map((x, k) => x - lm[k]); // Δℓ (realized)
  const pMinus = softmax(lm);

  const seatIds = Object.keys(input.shares);
  // Fate's share = Δℓ − Σ seat shares (the unexplained residual).
  const sumShares = new Array(K).fill(0);
  for (const id of seatIds) {
    const sh = input.shares[id];
    for (let k = 0; k < K; k++) sumShares[k] += sh[k] ?? 0;
  }
  const fateShare = dl.map((x, k) => x - sumShares[k]);

  // g(s) vector along the realized path.
  const gAt = (s: number): number[] => {
    const ps = softmax(lm.map((x, k) => x + s * dl[k]));
    const klS = kl(ps, pMinus);
    return ps.map((pk, k) => (pk > 0 ? pk * (Math.log(pk / pMinus[k]) - klS) : 0));
  };

  const dot = (share: number[], g: number[]): number => {
    let acc = 0;
    for (let k = 0; k < K; k++) acc += (share[k] ?? 0) * g[k];
    return acc;
  };

  const phi: Record<string, number> = {};
  for (const id of seatIds) phi[id] = 0;
  let phiFate = 0;

  // Simpson's composite rule over [0,1] with AS_STEPS (even) intervals:
  //   ∫ ≈ (h/3)·[ f₀ + 4·Σ_odd fᵢ + 2·Σ_even fᵢ + f_N ].
  const h = 1 / AS_STEPS;
  for (let step = 0; step <= AS_STEPS; step++) {
    const g = gAt(step * h);
    const w = step === 0 || step === AS_STEPS ? 1 : step % 2 === 1 ? 4 : 2;
    for (const id of seatIds) phi[id] += (w * dot(input.shares[id], g) * h) / 3;
    phiFate += (w * dot(fateShare, g) * h) / 3;
  }

  const fateCredits: Record<string, number> = {};
  for (const id of seatIds) fateCredits[id] = v * phi[id];
  return {
    threadId: input.threadId,
    fateCredits,
    houseBand: v * phiFate,
    totalFate: v * kl(softmax(lp), pMinus),
  };
}

/** Score a whole round — sum FateCredit across every moved thread. */
export function scoreRound(threads: ThreadAttribution[]): RoundScore {
  const perSeat: Record<string, number> = {};
  let houseBand = 0;
  let total = 0;
  const scored: ThreadScore[] = [];
  for (const t of threads) {
    const ts = scoreThread(t);
    scored.push(ts);
    for (const [id, c] of Object.entries(ts.fateCredits)) perSeat[id] = (perSeat[id] ?? 0) + c;
    houseBand += ts.houseBand;
    total += ts.totalFate;
  }
  return { perSeat, houseBand, total, threads: scored };
}

/** Conservation residual for a thread score — |Σ credits + band − totalFate|.
 *  Should be ~0; exposed for tests + an in-app audit assertion. */
export function conservationError(score: ThreadScore): number {
  const seatSum = Object.values(score.fateCredits).reduce((a, b) => a + b, 0);
  return Math.abs(seatSum + score.houseBand - score.totalFate);
}

/** Cumulative Fate (a raw KL-weighted sum) read as a 0–100 SCORE — a saturating
 *  curve so it rises monotonically with contribution and stays legible. Raw Fate
 *  has no natural ceiling; this maps [0, ∞) → [0, 100) (≈63 at one scale-unit of
 *  Fate moved, ≈95 at three). Negative (a deterministic-fallback wrong-way bet)
 *  floors at 0 for display. The raw `fateImpact` stays the source of truth. */
export const FATE_SCORE_SCALE = 5;
export function fateScore(fateImpact: number): number {
  if (fateImpact <= 0) return 0;
  return Math.round(100 * (1 - Math.exp(-fateImpact / FATE_SCORE_SCALE)));
}
