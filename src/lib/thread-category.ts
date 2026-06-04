/**
 * Thread category classification — a single vocabulary derived from a thread's
 * current MARKET STATE (probabilities, volume, volatility, margin, closure)
 * plus recent ACTIVITY signals (log energy, scenes-since-touch). Replaces the
 * old lifecycle vocabulary (latent/seeded/active/escalating/critical/resolved/
 * subverted/abandoned) which conflated many orthogonal signals.
 *
 * Eight mutually-exclusive categories, resolved in priority order:
 *
 *   resolved    — market closed, outcome committed
 *   abandoned   — volume decayed below the floor (not closed, just out)
 *   saturating  — margin within the near-closed band; one committal away from closure
 *   volatile    — recent large logit swings (ewma high) OR gradual-but-substantial
 *                 drift the EWMA under-reports; twist territory either way
 *   contested   — genuinely split (high entropy + real volume); outcome up for grabs
 *   committed   — one outcome clearly leads (p ≥ 0.65) without saturating
 *   developing  — recently touched with directional drift; not yet committed,
 *                 contested, or volatile, but actively evolving
 *   dormant     — quiet — no recent touches and no distinctive shape
 *
 * Why the split between `developing` and `dormant`: the old scheme dumped any
 * thread that didn't match a specific bucket into `dormant`, which mislabelled
 * actively-moving markets as quiet. `developing` captures in-flight motion that
 * hasn't crossed a decisive threshold yet; `dormant` is now reserved for
 * genuinely stale threads (no scene touch within the recency window).
 *
 * Used everywhere threads are coloured / summarised / interpreted: sidebar
 * portfolio, dashboard modal, canvas thread graph, report export, slides.
 * If a new site needs a colour for a thread, import from here — never spin
 * up a local STATUS_COLORS map.
 */

import type { Thread } from '@/types/narrative';
import {
  STANCE_EVIDENCE_SENSITIVITY,
  STANCE_NEAR_CLOSED_MIN,
  STANCE_TAU_CLOSE,
} from '@/lib/constants';
import {
  getThreadStance,
  getStanceMargin,
  getStanceProbs,
  isThreadAbandoned,
  isThreadClosed,
  normalizedEntropy,
} from '@/lib/narrative-utils';

export type ThreadCategory =
  | 'resolved'
  | 'abandoned'
  | 'saturating'
  | 'contested'
  | 'volatile'
  | 'committed'
  | 'developing'
  | 'dormant';

export const THREAD_CATEGORY_ORDER: ThreadCategory[] = [
  'saturating',
  'volatile',
  'contested',
  'committed',
  'developing',
  'dormant',
  'abandoned',
  'resolved',
];

/** Human-readable labels for UI. Keep lowercase — matches the signal
 *  vocabulary used across prompts and inline attributes. */
export const THREAD_CATEGORY_LABEL: Record<ThreadCategory, string> = {
  resolved: 'resolved',
  abandoned: 'abandoned',
  saturating: 'saturating',
  contested: 'contested',
  volatile: 'volatile',
  committed: 'committed',
  developing: 'developing',
  dormant: 'dormant',
};

/** One-line descriptions for tooltips / legend body text. */
export const THREAD_CATEGORY_DESCRIPTION: Record<ThreadCategory, string> = {
  resolved: 'Market closed — an outcome has committed.',
  abandoned: 'Volume fell below the attrition floor; out of the market.',
  saturating: 'Top outcome nearing closure threshold — one committal delta away.',
  contested: 'Genuinely split — high entropy with real volume behind it.',
  volatile: 'Belief moved sharply in recent scenes — twists land here.',
  committed: 'One outcome clearly leads; market has settled on a lean.',
  developing: 'Actively moving — recent touches with directional drift, no decisive shape yet.',
  dormant: 'Quiet — no recent scene touches and no distinctive signal.',
};

/** Hex colours for SVG / canvas render paths. Calibrated against the existing
 *  sidebar palette so the sidebar and the canvas look unified. */
export const THREAD_CATEGORY_HEX: Record<ThreadCategory, string> = {
  resolved: '#10B981',    // emerald
  abandoned: '#64748B',   // slate (muted gray)
  saturating: '#FB923C',  // orange
  contested: '#A78BFA',   // violet
  volatile: '#FBBF24',    // amber
  committed: '#38BDF8',   // sky
  developing: '#60A5FA',  // blue — alive, evolving, not yet committed
  dormant: '#475569',     // slate-dim
};

// ── Outcome palette ────────────────────────────────────────────────────────
// Single source of truth for per-outcome colour across every belief surface —
// portfolio rows, stance chart, thread inspector. Outcomes are colour-indexed
// by their position in `thread.outcomes` (or trajectory snapshot), so a view
// using a different palette would paint the same outcome a different hue.
// Three views consume this: ThreadsPanel (left sidebar), BeliefView
// (centre chart), ThreadDetail (right inspector).
//
// Sizing: the analysis-time stance schema caps at ~6 outcomes ("2 to ~6 named
// possibilities" — see scene-structure.ts), but mid-narrative `addOutcomes`
// can grow a stance further. The palette holds 12 distinct hues so any stance
// up to that size renders cleanly; beyond 12 the helpers below wrap (two
// outcomes share a hue) — which is rare and acceptable, but `outcomeColour*`
// gives callers a single chokepoint should we ever need to switch to a
// generative HSL scheme.
const OUTCOME_PALETTE_HEX_RAW: readonly string[] = [
  '#38BDF8', // sky
  '#FBBF24', // amber
  '#2DD4BF', // teal
  '#A78BFA', // violet
  '#FB7185', // rose
  '#34D399', // emerald
  '#818CF8', // indigo
  '#FB923C', // orange
  '#A3E635', // lime
  '#E879F9', // fuchsia
  '#22D3EE', // cyan
  '#FACC15', // yellow
];

const OUTCOME_PALETTE_BG_RAW: readonly string[] = [
  'bg-sky-400',
  'bg-amber-400',
  'bg-teal-400',
  'bg-violet-400',
  'bg-rose-400',
  'bg-emerald-400',
  'bg-indigo-400',
  'bg-orange-400',
  'bg-lime-400',
  'bg-fuchsia-400',
  'bg-cyan-400',
  'bg-yellow-400',
];

export const OUTCOME_PALETTE_HEX = OUTCOME_PALETTE_HEX_RAW;
export const OUTCOME_PALETTE_BG = OUTCOME_PALETTE_BG_RAW;

/** Hex colour for outcome at `idx`. Wraps at palette length so unbounded
 *  outcome growth never throws — the wrap is the documented overflow
 *  behaviour (two outcomes share a hue past 12). Always prefer these helpers
 *  over direct palette access so the wrap policy stays in one place. */
export function outcomeColourHex(idx: number): string {
  return OUTCOME_PALETTE_HEX_RAW[((idx % OUTCOME_PALETTE_HEX_RAW.length) + OUTCOME_PALETTE_HEX_RAW.length) % OUTCOME_PALETTE_HEX_RAW.length];
}

/** Tailwind bg class for outcome at `idx`. Same wrap policy as
 *  `outcomeColourHex`. */
export function outcomeColourBg(idx: number): string {
  return OUTCOME_PALETTE_BG_RAW[((idx % OUTCOME_PALETTE_BG_RAW.length) + OUTCOME_PALETTE_BG_RAW.length) % OUTCOME_PALETTE_BG_RAW.length];
}

/** Tailwind token classes (background). For React components that compose
 *  with rounded-full / etc. The `/N` suffix is intentionally absent so the
 *  caller picks an opacity if they need one. */
export const THREAD_CATEGORY_BG: Record<ThreadCategory, string> = {
  resolved: 'bg-emerald-400',
  abandoned: 'bg-slate-500',
  saturating: 'bg-orange-400',
  contested: 'bg-violet-400',
  volatile: 'bg-amber-400',
  committed: 'bg-sky-400',
  developing: 'bg-blue-400',
  dormant: 'bg-slate-600',
};

/** Tailwind text classes keyed by category. */
export const THREAD_CATEGORY_TEXT: Record<ThreadCategory, string> = {
  resolved: 'text-emerald-300',
  abandoned: 'text-text-dim',
  saturating: 'text-orange-300',
  contested: 'text-violet-300',
  volatile: 'text-amber-300',
  committed: 'text-sky-300',
  developing: 'text-blue-300',
  dormant: 'text-slate-400',
};

/** Tunable thresholds — centralised so a single knob adjusts every render. */
export const CATEGORY_THRESHOLDS = {
  /** Normalised entropy at which a multi-outcome market is "genuinely contested". */
  contestedEntropy: 0.85,
  /** Minimum volume for contested to register (avoids tagging empty markets). */
  contestedMinVolume: 1,
  /** EWMA volatility above which recent movement dominates the read. */
  volatileMin: 0.5,
  /** Sum of |logit shifts| over the recent log window above which a thread
   *  reads as volatile even when the EWMA has smoothed out gradual drift.
   *  Units: logit magnitude (evidence / STANCE_EVIDENCE_SENSITIVITY). */
  volatileRecentEnergy: 0.9,
  /** Number of most-recent log entries considered for recentLogitEnergy. */
  recentEnergyWindow: 3,
  /** Top-outcome probability above which the market reads as committed. */
  committedMinProb: 0.65,
  /** Scenes-since-last-touch at or below which a thread is "recently active".
   *  Used to separate `developing` (recent drift) from `dormant` (stale). */
  recentTouchWindow: 4,
  /** Minimum recent-logit energy for the log-based fallback to treat a thread
   *  as `developing` when no scene-order context is provided. */
  developingMinEnergy: 0.2,
  /** Volume below which we flag as fading — but kept separate from abandoned
   *  (which is the hard floor). Currently folds into `dormant` for simplicity. */
  dormantMaxVolume: 1,
};

/** Sum of absolute logit shifts contributed by the last N log entries.
 *  Complements the EWMA volatility: EWMA is smoothed by β and can undercount
 *  steady directional drift (e.g. a thread climbing +0.5 logit every scene
 *  for 3 scenes never crosses the EWMA threshold but is visibly moving). */
export function computeRecentLogitEnergy(
  thread: Thread,
  windowSize: number = CATEGORY_THRESHOLDS.recentEnergyWindow,
): number {
  const nodes = thread.threadLog?.nodes;
  if (!nodes) return 0;
  const nodeIds = Object.keys(nodes);
  if (nodeIds.length === 0) return 0;
  const recentIds = nodeIds.slice(-windowSize);
  let energy = 0;
  for (const nodeId of recentIds) {
    const node = nodes[nodeId];
    for (const u of node?.updates ?? []) {
      const ev = typeof u.evidence === 'number' ? u.evidence : 0;
      energy += Math.abs(ev) / STANCE_EVIDENCE_SENSITIVITY;
    }
  }
  return energy;
}

/** Classify a thread into its current category. Single function, used
 *  everywhere — keeps the sidebar, canvas, and report in lockstep.
 *
 *  `ctx.scenesSinceTouch` (optional): number of scenes since the thread was
 *  last touched, against the current playback/generation head. When provided,
 *  it drives the developing/dormant split precisely. When omitted, the
 *  classifier falls back to a log-based heuristic (any recent logit energy
 *  → developing; otherwise dormant). */
export function classifyThreadCategory(
  thread: Thread,
  ctx?: { scenesSinceTouch?: number },
): ThreadCategory {
  if (isThreadClosed(thread)) return 'resolved';
  if (isThreadAbandoned(thread)) return 'abandoned';

  const belief = getThreadStance(thread);
  const probs = getStanceProbs(thread);
  const { margin } = getStanceMargin(thread);
  const volume = belief?.volume ?? 0;
  const volatility = belief?.volatility ?? 0;
  const entropy = normalizedEntropy(probs);
  const topProb = Math.max(...probs);
  const recentEnergy = computeRecentLogitEnergy(thread);

  // Saturating wins over other signals — about to close is the most action-
  // relevant state for writers and readers.
  if (margin >= STANCE_NEAR_CLOSED_MIN && margin < STANCE_TAU_CLOSE) {
    return 'saturating';
  }

  // Volatile fires on EITHER the EWMA spike signal (big single-scene shift)
  // OR the windowed energy signal (gradual drift summed across recent logs).
  // Ordered ahead of contested/committed: a moving market is more informative
  // to surface than its current shape, since the shape is in flux.
  if (
    volatility >= CATEGORY_THRESHOLDS.volatileMin ||
    recentEnergy >= CATEGORY_THRESHOLDS.volatileRecentEnergy
  ) {
    return 'volatile';
  }

  if (entropy >= CATEGORY_THRESHOLDS.contestedEntropy && volume >= CATEGORY_THRESHOLDS.contestedMinVolume) {
    return 'contested';
  }

  if (topProb >= CATEGORY_THRESHOLDS.committedMinProb) {
    return 'committed';
  }

  // Developing vs dormant — last discriminator is recency. A thread touched
  // within the recent window with any directional motion is developing; a
  // thread that hasn't been touched (or has been quiet) is dormant.
  const scenesSinceTouch = ctx?.scenesSinceTouch;
  if (scenesSinceTouch !== undefined && Number.isFinite(scenesSinceTouch)) {
    if (scenesSinceTouch <= CATEGORY_THRESHOLDS.recentTouchWindow) return 'developing';
    return 'dormant';
  }
  // No scene-order context — fall back to threadLog-based heuristic.
  if (recentEnergy >= CATEGORY_THRESHOLDS.developingMinEnergy) return 'developing';
  return 'dormant';
}

/** Convenience: every active (non-terminal) category in UI ordering. */
export const THREAD_CATEGORY_LIVE: ThreadCategory[] = [
  'saturating',
  'volatile',
  'contested',
  'committed',
  'developing',
  'dormant',
];

/** Per-category LLM guidance. One canonical source of prose for every prompt
 *  site that describes thread market state — scene generation context, arc
 *  reasoning graphs, and per-thread lifecycle hints all read from here so the
 *  model sees a single vocabulary across layers.
 *
 *  Callers template the leading outcome into the string as needed; the form
 *  keeps `{lean}` and `{p}` placeholders so downstream code can interpolate
 *  without mutating the guidance map. */
export const THREAD_CATEGORY_GUIDANCE: Record<ThreadCategory, string> = {
  resolved: 'CLOSED — market committed; do not reopen without twist-grade evidence.',
  abandoned: 'ABANDONED — volume fell below the floor; let it stay out unless deliberately resurrecting.',
  saturating: 'SATURATING → "{lean}" — ready for payoff or twist; escalation alone is weak here.',
  volatile: 'VOLATILE — recent swings have earned weight; twists against prior trend land well.',
  contested: 'CONTESTED — genuinely open; either side is fair game this scene.',
  committed: 'COMMITTED → "{lean}" (p={p}). Market expects this unless you deliberately twist it.',
  developing: 'DEVELOPING → "{lean}" — actively moving, no decisive shape yet; pace it and let it settle.',
  dormant: 'DORMANT — quiet for several scenes; let it decay unless this scene re-engages it.',
};

/** Fill {lean} / {p} placeholders in a guidance template. */
export function formatThreadGuidance(
  template: string,
  lean: string,
  topProb: number,
): string {
  return template
    .replaceAll('{lean}', lean)
    .replaceAll('{p}', topProb.toFixed(2));
}

/** Convenience: terminal categories. */
export const THREAD_CATEGORY_TERMINAL: ThreadCategory[] = ['resolved', 'abandoned'];
