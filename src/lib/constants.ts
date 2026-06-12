/**
 * Centralized constants for easy tuning across the narrative engine.
 * Grouped by domain — import what you need from '@/lib/constants'.
 */

// ── Analysis & Extraction ────────────────────────────────────────────────────

/** Max concurrent LLM calls during chunk analysis */
export const ANALYSIS_CONCURRENCY = 20;

/** Delay (ms) between launching each call in the initial analysis batch */
export const ANALYSIS_STAGGER_DELAY_MS = 200;

/** Max corpus size (words) accepted for analysis */
export const ANALYSIS_MAX_CORPUS_WORDS = 500_000;

// ── AI Models ───────────────────────────────────────────────────────────────

/** Default LLM model — fallback for everything not explicitly routed: evaluation,
 *  reviews, briefings, game theory, search synthesis, report generation,
 *  prose-rewrite changelog, ingest. */
export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

/** Model for scene generation — generateScenes, generateNarrative (intro arc),
 *  reconstruction edits/inserts/merges. */
export const GENERATE_MODEL = "deepseek/deepseek-v4-flash";

/** Model for present, future and rescoring variable model */
export const PREDICTIVE_MODEL = "google/gemini-2.5-flash";

/** Model for scene generation when a reasoning graph (CRG) is the brief.
 *  The graph carries the causal/structural burden, so the scene pass becomes
 *  graph execution rather than open-ended construction — a fast graph-capable
 *  model is the right cost/quality trade-off there. */
/** Model for prose (creative writing tasks). */
export const WRITING_MODEL = "google/gemini-2.5-flash";

/** Model for planning calls — beat plans, reasoning graphs (CRG), phase graphs (PRG). */
export const PLANNING_MODEL = "google/gemini-2.5-flash";

/** Model for the analysis pipeline (extraction, reconciliation, fate re-extract,
 *  beat-plan reverse-engineering). */
export const ANALYSIS_MODEL = "google/gemini-2.5-flash";

/** Model for the per-scene game-theory decomposition pass (2x2 payoff
 *  matrices, axis classification, realised-action tagging). Run on its
 *  own constant so it can be tuned independently of the structural
 *  analysis pipeline. */
export const GAME_THEORY_MODEL = "deepseek/deepseek-v4-flash";

/** Model for interactive / conversational calls — chat, surveys, interviews. */
export const INTERACTION_MODEL = "deepseek/deepseek-v4-flash";

/** Model for Learning question extraction (per-scene multiple-choice banks).
 *  Gemini — the extraction is analytical and structured, like the planning
 *  and analysis passes, and benefits from the same model's reasoning. */
export const QUESTION_MODEL = "google/gemini-2.5-flash";

// ── AI Pricing (per million tokens) ──────────────────────────────────────────

export const MODEL_PRICING: Record<string, { input: number; output: number }> =
  {
    "deepseek/deepseek-v4-flash": { input: 0.14, output: 0.28 },
    "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  };

/** Fallback pricing when model is unknown */
export const DEFAULT_PRICING = { input: 0.14, output: 0.28 };

// ── AI Temperature ───────────────────────────────────────────────────────────

/** Temperature for creative generation — scenes, prose, wizard */
export const DEFAULT_TEMPERATURE = 0.8;

/** Temperature for structured extraction — analysis, scoring, reconciliation */
export const ANALYSIS_TEMPERATURE = 0.1;

// ── AI Token Limits ─────────────────────────────────────────────────────────

/** Max output tokens for massive structured output (full branch evaluation, multi-scene generation) */
export const MAX_TOKENS_XLARGE = 128000;

/** Max output tokens for large structured generation (scenes, narratives, analysis) */
export const MAX_TOKENS_LARGE = 64000;

/** Max output tokens for the /api/generate route when no explicit limit is passed */
export const MAX_TOKENS_DEFAULT = 32000;

/** Max output tokens for small focused output (single scene plan, rewrite, profile extraction) */
export const MAX_TOKENS_SMALL = 16000;

// ── AI Timeouts ─────────────────────────────────────────────────────────────

/** Timeout for non-streaming API calls (ms) — 8 minutes */
export const API_TIMEOUT_MS = 8 * 60 * 1000;

/** Timeout for streaming API calls (ms) — 15 minutes (longer for prose generation) */
export const API_STREAM_TIMEOUT_MS = 15 * 60 * 1000;

/** Age threshold (ms) for marking stale pending API logs as timed out — 20 minutes */
export const API_LOG_STALE_THRESHOLD_MS = 20 * 60 * 1000;

// ── AI Context ───────────────────────────────────────────────────────────────

/** Rolling window size for force computation & normalization */
export const FORCE_WINDOW_SIZE = 10;

/** Dominance-weighted delivery aggregation weights. The three forces are
 *  independent dimensions; the weights reflect which axis carries the
 *  structural signal for a given work archetype. A Classic like Harry Potter
 *  is fate-dominant, a Show is world-dominant, a Paper system-dominant, an
 *  Opus balanced. When `computeDominanceWeights` isn't called explicitly,
 *  `FORCE_DOMINANCE_WEIGHTS.opus` is the default (equal-weighted).
 *
 *  Weights must sum to 1. Values were chosen to preserve each archetype's
 *  signature while still acknowledging the secondary forces' contribution.
 */
export const FORCE_DOMINANCE_WEIGHTS = {
  classic: { fate: 0.55, world: 0.225, system: 0.225 },
  show: { fate: 0.225, world: 0.55, system: 0.225 },
  paper: { fate: 0.225, world: 0.225, system: 0.55 },
  opus: { fate: 1 / 3, world: 1 / 3, system: 1 / 3 },
} as const;

/** Activity smoothing σ, in scenes. 1.5 is the canonical σ used by the
 *  activity curve (`computeActivityCurve`) — wide enough to damp single-scene
 *  noise, narrow enough to preserve real peaks/valleys. */
export const DELIVERY_SMOOTH_SIGMA = 1.5;

// ── Generation ───────────────────────────────────────────────────────────────

/** Concurrent scene plan generation slots (Story modal bulk plan) */
export const PLAN_CONCURRENCY = 10;

/** Concurrent prose generation slots (Story modal bulk write) */
export const PROSE_CONCURRENCY = 10;

/** Concurrent audio generation slots (Story modal bulk audio) */
export const AUDIO_CONCURRENCY = 10;

/** Concurrent scene game-theory analysis slots (bulk game analyse) */
export const GAME_CONCURRENCY = 10;

/** Concurrent prose rewrite slots */
export const REWRITE_CONCURRENCY = 10;

/** Max children per Scenarios node */
export const EXPERIMENT_MAX_NODE_CHILDREN = 8;

/** Arcs per season before auto-engine manual stop */
export const AUTO_STOP_CYCLE_LENGTH = 25;

// ── Narrative Shape Analysis ─────────────────────────────────────────────────

/** Scenes-per-window divisor for adaptive peak detection radius: max(2, floor(n / N)) */
export const PEAK_WINDOW_SCENES_DIVISOR = 25;

/** Middle band bounds for V-shape trough detection (excludes edge 20% on each side) */
export const SHAPE_TROUGH_BAND_LO = 0.2;
export const SHAPE_TROUGH_BAND_HI = 0.8;

// ── UI: Pagination & Limits ──────────────────────────────────────────────────

/** Items per page in inspector detail panels */
export const INSPECTOR_PAGE_SIZE = 20;

/** Knowledge nodes shown in the Stage per entity */
export const GRAPH_WORLD_LIMIT = 20;

/** Arc count above which ForceAnalytics switches to dense mode */
export const DENSE_ARC_THRESHOLD = 20;

/** Default sliding window size for ForceTimeline */
export const FORCE_TIMELINE_WINDOW_DEFAULT = 100;

/** Scene window for delivery sparklines on key moment cards (slides + report) */
export const MOMENT_SPARKLINE_WINDOW = 50;

// ── Scale Standards ─────────────────────────────────────────────────────────
// Beat → Scene → Arc hierarchy. Analysis is strict; generation is flexible.

/** Words per beat — the atomic unit of prose */
export const WORDS_PER_BEAT = 100;
/** Beats per scene — standard scene size */
export const BEATS_PER_SCENE = 12;
/** Scenes per arc — standard arc length */
export const SCENES_PER_ARC = 4;

/** Derived: words per scene (~1,000) */
export const WORDS_PER_SCENE = WORDS_PER_BEAT * BEATS_PER_SCENE;
/** Derived: beats per 1000 words (10) — for prose profile compatibility */
export const BEATS_PER_KWORD = Math.round(
  BEATS_PER_SCENE / (WORDS_PER_SCENE / 1000),
);

// Legacy aliases — used by beat profiles and prose density validation
export const BEAT_DENSITY_MIN = 8;
export const BEAT_DENSITY_MAX = 14;
export const BEAT_DENSITY_DEFAULT = BEATS_PER_KWORD;
export const WORDS_PER_BEAT_MIN = Math.round(1000 / BEAT_DENSITY_MAX);
export const WORDS_PER_BEAT_MAX = Math.round(1000 / BEAT_DENSITY_MIN);
export const WORDS_PER_BEAT_DEFAULT = WORDS_PER_BEAT;

// ── Embeddings & Semantic Search ─────────────────────────────────────────────

/** OpenAI embedding model for semantic search */
export const EMBEDDING_MODEL = "text-embedding-3-small";

/** Embedding vector dimensions (OpenAI text-embedding-3-small) */
export const EMBEDDING_DIMENSIONS = 1536;

/** Batch size for embedding API calls (texts per request) */
export const EMBEDDING_BATCH_SIZE = 50;

/** Concurrent embedding generation batches */
export const EMBEDDING_CONCURRENCY = 10;

/** Direct scene-summary matches (thematic widener). Small on purpose —
 *  aggregate scene summaries derived from proposition membership already
 *  supply the per-proposition scene context; this pool only catches
 *  thematic queries where propositions genuinely miss. */
export const SEARCH_TOP_K_SCENES = 3;

/** Proposition-level results — the primary RAG signal. Top 10 of the
 *  proposition embedding pool feed the synthesis. */
export const SEARCH_TOP_K_PROPOSITIONS = 10;

/** Minimum cosine similarity threshold for search results (0-1) */
export const SEARCH_SIMILARITY_THRESHOLD = 0.3;

/** Number of candidate plans to generate in plan candidates */
export const PLAN_CANDIDATES_COUNT = 5;

/** Limit for continuity nodes and thread logs per entity in LLM context */
export const ENTITY_LOG_CONTEXT_LIMIT = 25;

// ── Tiered recency zones for narrative context ──────────────────────────────
// Scene history is rendered at progressively lower resolution based on
// distance from the current scene:
//   Near  (0 .. NEAR_RECENCY_ZONE)                 → full delta detail
//   Mid   (NEAR .. NEAR + MID)                     → summary + thread transitions + movements
//   Far   (beyond NEAR + MID)                      → summary + POV/location only

/** Most recent scenes rendered with full delta detail. */
export const NEAR_RECENCY_ZONE = 5;

/** Scenes after NEAR rendered with thread transitions and movements only. */
export const MID_RECENCY_ZONE = 15;

// ── Thread Stance Math ──────────────────────────────────────────────────────
//
// The world view's belief is built from individual thread stances. The
// constants below tune how a stance updates from evidence (sensitivity,
// range), when it closes (τ_close, near-closed band), how attention decays
// (volume), how movement is smoothed (volatility EWMA), and which stances
// dominate generation focus.

/** Log-odds sensitivity for evidence → logit updates on a stance.
 *  `logit[k] += evidence / STANCE_EVIDENCE_SENSITIVITY`.
 *  With s=2: evidence=+4 at p=0.5 → p≈0.88; at p=0.9 → p≈0.988 (natural saturation).
 *  Decisive events (|evidence|=3–4 with logType payoff/twist) need to be able
 *  to close stances — the fix for overpricing is smart in-world priors at
 *  thread creation, not a blanket dampening of evidence response. */
export const STANCE_EVIDENCE_SENSITIVITY = 2;

/** Evidence range — integer on both sides. Matches game-theory stake deltas. */
export const STANCE_EVIDENCE_MIN = -4;
export const STANCE_EVIDENCE_MAX = 4;

/** Close condition: `max_logit − second_max_logit` exceeds this threshold.
 *  At τ=3, the winning outcome has p ≥ 0.953 relative to the runner-up. */
export const STANCE_TAU_CLOSE = 3;

/** Near-closed band: |logit(p)| ∈ [NEAR_CLOSED_MIN, τ_close) — saturating
 *  but not committed. UI marks as "ready to settle". */
export const STANCE_NEAR_CLOSED_MIN = 2;

/** Volume decay per scene untouched — geometric. α=0.9 → half-life ≈ 6.6 scenes. */
export const STANCE_VOLUME_DECAY = 0.9;

/** Volume floor — below this, thread is marked abandoned (removed from focus). */
export const STANCE_ABANDON_VOLUME = 0.5;

/** Volatility EWMA decay. β=0.6 blends new |Δlogit| at 40% weight. */
export const STANCE_VOLATILITY_BETA = 0.6;

/** Focus-score recency decay — per scene untouched, score scales by this factor. */
export const STANCE_RECENCY_DECAY = 0.95;

/** Initial volume for newly opened stances. */
export const STANCE_OPENING_VOLUME = 2;

/** Opening-price guardrails — don't seed stances near saturation. */
export const STANCE_OPENING_MIN_LOGIT = -1.2; // p ≈ 0.23
export const STANCE_OPENING_MAX_LOGIT = 1.2; // p ≈ 0.77

/** Focus window size — top-K stances by focus score feed generation. */
export const STANCE_FOCUS_K = 6;

/** Merge → scene-count compression exponent. When a merge folds N executive
 *  (driving) streams into a continuation, the scenes needed to realise them
 *  scale SUBLINEARLY: one stream resolves in ~1 scene, but each additional
 *  stream costs less than a full scene because a single coherent scene can
 *  carry several resolutions at once. scenes ≈ round(N^MERGE_SCENE_COMPRESSION).
 *  At 0.6: 1→1, 2→2, 3→2, 4→2, 5→3, 8→3, 12→4, 16→5. */
export const MERGE_SCENE_COMPRESSION = 0.6;

// ── Conviction — the rehearsal card game (CONCEPT.md) ─────────────────────────
// Out-of-box defaults — hypotheses to pilot, exposed as GM dials per room (see
// ConvictionEconomy / GameRoom). Economy is scaled to the COST_MIN–COST_MAX
// card-cost range (both GM dials; the ceiling is also removable per room).

/** Opening conviction per seat — 2× income; climb toward the ceiling by saving. */
export const CONVICTION_START = 50;

/** Conviction granted each SETTLE — ≈ one typical multi-action call (a 4-action
 *  stream ≈ 28); ~one real move a round, anything bigger needs saving. */
export const CONVICTION_INCOME = 25;

/** Decay on the BANKED balance each SETTLE, before income. Fixed point
 *  INCOME/(1−DECAY) = 150 is the hoard ceiling = the dearest possible play
 *  (max card 100 × FACEDOWN_PREMIUM 1.5). Decoupled from STANCE_VOLUME_DECAY. */
export const CONVICTION_DECAY = 5 / 6; // ≈ 0.833

/** Card-cost floor — a play is never free. Load-bearing: makes agenda-setting
 *  cost something (admissibility gates implausibility, not strategic triviality). */
export const COST_MIN = 1;

/** Rarity→cost scale: cost = clamp(COST_MIN,COST_MAX, round(RARITY_SCALE·−ln p)).
 *  p=0.5 ≈ 14, p=0.33 ≈ 22, p=0.25 ≈ 28, p=0.1 ≈ 46, p=0.05 ≈ 60. Improbability
 *  IS the price — tuned so a 50-conviction opening affords ≥1.5 typical
 *  (3–5 action) cards while long-shots still demand saving. */
export const RARITY_SCALE = 20;

/** Card-cost ceiling — the dearest a single play can price, regardless of rarity
 *  (GM dial `economy.costMax`). At 200 the rarity curve has room before it clamps;
 *  note this decouples from the hoard ceiling `INCOME/(1−DECAY)=150`, so the very
 *  rarest concealed call can now outrun a fully-banked stack. */
export const COST_MAX = 200;

/** Conviction→evidence gain (concave, per play): e = clamp(±4, GAIN·ln(1+c/cost)).
 *  Bare cost → e≈2; ~3× cost → the ±4 cap. The dial that decides what raising
 *  buys — tune first. (Capping makes all-in TILT a contested draw, never pin it.) */
export const EVIDENCE_GAIN = 3;

/** Max cards a seat may commit per round — anti-flood backstop. Cards on one
 *  outcome SUM in logit space (≈±6/round at 3), so near-certainty is reachable
 *  but costs a full hand; mainly bites high-income rooms. */
export const CARDS_PER_ROUND = 3;

/** Card-requests (pose-question → open stream → deal) allowed per READ/LIVE
 *  phase — bounds the emergent-play branching loop. */
export const READ_MAX_REQUESTS = 3;

/** Face-down cost multiplier — concealment is a paid service. Defined for
 *  forward-compat; UNUSED while forced reveal is on (the shipped default). */
export const FACEDOWN_PREMIUM = 1.5;

/** Hoard ceiling — the dearest single play (max card × facedown premium). A
 *  perpetual saver can afford any single concealed long-shot, never a war chest. */
export const CONVICTION_CEILING = CONVICTION_INCOME / (1 - CONVICTION_DECAY); // = 150

// Emergent dynamic (intended — do NOT cap directly): going all-in on a
// CONTESTED outcome is powerful — up to ±6 logits buys near-certainty on the
// draw, and the snap is Fate's house band so there's no Impact downside, only a
// conviction cost. It is self-limiting via (1) spent-not-won (≈6 rounds to
// reload at income/ceiling), (2) the ±4/card cap (tilts, never pins), (3) all-in
// wars exhaust both sides and open other threads, (4) CARDS_PER_ROUND. The one
// thing to avoid in tuning is fast refill (high income / low decay) — keep the
// scarcity, tune via these GM dials, don't nerf all-in.

// Round/turn timers (ms) — presentation phases short, deliberation gets room.
// COSMETIC in computer mode (the GM advances by hand); the difficulty lever for
// the human-vs-AI tempo dynamic in remote/Showdown (deferred).
export const TIMER_PUBLIC = 30_000;
export const TIMER_PRIVATE = 20_000;
export const TIMER_READ = 120_000;
export const TIMER_TURN = 30_000;
export const TIMER_LIVE = 120_000; // Showdown (unused this build)
export const TIMER_SHOWDOWN = 25_000;
export const TIMER_SCORING = 20_000;

/** Default contested-thread settlement rule (GM-overridable per room). */
export const RESOLVE_BIAS_DEFAULT = "random" as const;
