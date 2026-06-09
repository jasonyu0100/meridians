// ── Thread (Belief System Model) ────────────────────────────────────────────
//
// A world view's BELIEF SYSTEM is the structure of stances it holds across
// every open question. Each thread is one such question; the stance is the
// world view's current bearing on it — a distribution over named outcomes,
// driven by accumulated evidence from the scenes that touched it.
//
// Each scene emits evidence that updates per-outcome logits; softmax(logits)
// yields the stance's probability distribution. Fate is information-gain
// (entropy change in the stance) weighted by volume.
//
// Binary threads use outcomes: ["yes", "no"]; multi-outcome threads enumerate
// their possibilities ("Harry wins" / "Voldemort wins" / "Destroyed" / ...).
// Binary is just the N=2 case — the math parameterizes by |outcomes|.

/** Canonical agent whose stance is the "narrator price" before per-character
 *  stances are populated. Phase 1: only the narrator holds a stance. */
export const NARRATOR_ID = "narrator" as const;

/** A stance held by a single agent (narrator or character) over a thread's
 *  outcomes — that agent's current bearing on the question the thread poses.
 *  Logits live in R; softmax gives a probability distribution. */
export type Stance = {
  /** Per-outcome logits (same length as thread.outcomes). */
  logits: number[];
  /** Cumulative narrative attention. Decays per untouched scene. */
  volume: number;
  /** EWMA of recent |Δlogit| magnitudes — how much the stance is moving. */
  volatility: number;
  /** Last scene id that touched this stance. Used for decay and recency. */
  lastTouchedScene?: string;
};

export type ThreadParticipant = {
  id: string;
  type: "character" | "location" | "artifact";
};

// ── Thread Log ──────────────────────────────────────────────────────────────

/** Thread log node — a statement of something that occurred in a specific scene.
 *  Written in simple past tense. One fact, one sentence, no interpretation.
 *  Nine perceptual primitives — the thread's model of how its stance moved.
 *  Whatever doesn't register as one of these doesn't exist for the thread.
 *
 *  Examples:
 *  - "Harry caused the glass of the boa enclosure to vanish at the zoo." (payoff)
 *  - "Harry observed that Draco's wand was misfiring during the duel." (setup)
 *  - "Uncle Vernon confiscated Harry's Hogwarts letter before Harry could read it." (resistance)
 *  - "Dumbledore arrived at the Ministry with evidence of Voldemort's return." (transition)
 *  - "The prophecy was mentioned again in Snape's memory." (callback)
 */
export type ThreadLogNodeType =
  | "pulse" // "I was acknowledged but nothing changed." Continuity maintenance.
  | "transition" // "My fundamental state has changed." Lifecycle position updated.
  | "setup" // "Something is being prepared on my behalf." Forward-looking — promises being made.
  | "escalation" // "The stakes around me are rising." Increasing pressure without advancing.
  | "payoff" // "A promise made to me has been fulfilled." Experiencing own resolution.
  | "twist" // "My understanding of my own direction has changed." Revising own fate vector.
  | "callback" // "Something from my past has been referenced." History being honored.
  | "resistance" // "Something is working against me." Experiencing opposition directly.
  | "stall"; // "I am not moving and I don't know why." Self-diagnosis of dysfunction.

export const THREAD_LOG_NODE_TYPES: ThreadLogNodeType[] = [
  "pulse",
  "transition",
  "setup",
  "escalation",
  "payoff",
  "twist",
  "callback",
  "resistance",
  "stall",
];

/** One evidence update for a single outcome. Evidence is integer in
 *  [-4, +4] applied as a log-odds shift on the stance's logit for that
 *  outcome: logit[k] += evidence / sensitivity. The LLM emits these;
 *  softmax renormalizes probabilities automatically. */
export type OutcomeEvidence = {
  /** Outcome name — must match one of thread.outcomes. */
  outcome: string;
  /** Log-odds shift magnitude, real number in [-4, +4]. Decimals (e.g. +1.5)
   *  are legitimate — they let the LLM express calibrated partial nudges. */
  evidence: number;
};

export type ThreadLogNode = {
  id: string;
  type: ThreadLogNodeType;
  /** Prose-grade description of what happened to the thread in this scene.
   *  Doubles as the rationale that grounds the stance update. */
  content: string;
  /** The scene where this event occurred. */
  sceneId?: string;
  /** Per-outcome evidence emitted in this scene. Empty array = pulse
   *  (attention maintenance without directional movement). */
  updates?: OutcomeEvidence[];
  /** Change to volume (narrative attention) contributed by this event. */
  volumeDelta?: number;
  /** Outcomes added to the thread at this scene (if any). Present only on
   *  scenes that structurally expanded the question's option set. */
  addedOutcomes?: string[];
  /** Normalized Shannon info-gain at this delta: |H(pre) − H(post)| / ln(N).
   *  Range [0, 1]. Populated by applyThreadDelta; read by the refined fate
   *  formula so we don't need a trajectory replay to score the scene. */
  infoGain?: number;
  /** Stance volume immediately before this delta was applied. Lets the fate
   *  formula weight information gain by how much attention the stance was
   *  carrying at the moment of movement. */
  preVolume?: number;
  /** Scenes elapsed since the thread opened, at the time of this delta.
   *  Only meaningful on closing deltas — drives the buildup bonus. */
  buildup?: number;
  /** True if this delta triggered closure of the stance (margin ≥ τ,
   *  committal logType, decisive evidence). Used by the fate closure bonus. */
  closed?: boolean;
};

export type ThreadLogEdge = {
  from: string;
  to: string;
  relation: string;
};

export type ThreadLog = {
  nodes: Record<string, ThreadLogNode>;
  edges: ThreadLogEdge[];
};

/** Storyline: long-running thread spanning multiple arcs. Incident: short-lived, resolves within 1-2 arcs. */
export type ThreadKind = "storyline" | "incident";

/**
 * How far the thread's resolution sits from any given step.
 *
 *   - short  ~ 2-3 scenes (immediate trust, fight outcome, single reveal)
 *   - medium ~ within one arc, 4-8 scenes (house rivalry, stolen artifact)
 *   - long   ~ multi-arc, segment-spanning (faction war, succession)
 *   - epic   ~ series-spanning or open-ended (defeating the Dark Lord,
 *              dynastic succession, the chosen-one's coming-of-age).
 *              May never close cleanly; carries fractional evidence even
 *              at the upper end of the magnitude scale.
 *
 * Used by the belief-calibration prompts (Principle 8: scope-distance
 * attenuation) to scale evidence magnitude. A local win that resolves a
 * `short` thread at +3 contributes only +0.2..+0.5 to a coupled `epic`
 * thread on the same scene.
 */
export type ThreadHorizon = 'short' | 'medium' | 'long' | 'epic';

export type Thread = {
  id: string;
  participants: ThreadParticipant[];
  /** The question the thread poses. "Will Harry claim the Stone?" */
  description: string;
  /** Named outcomes the stance distributes probability over. Length ≥ 2.
   *  Binary: ["yes", "no"]. Multi-outcome enumerates possibilities. The
   *  softmax over per-outcome logits gives the probability distribution. */
  outcomes: string[];
  /** Structural distance from any given scene to the thread's resolution.
   *  Set when the thread opens; static for the thread's lifetime. Drives
   *  evidence-magnitude attenuation via Principle 8 in the calibration
   *  prompts. Undefined treated as 'medium' for backwards compatibility. */
  horizon?: ThreadHorizon;
  /** Per-agent stances over the outcomes — each agent's current bearing on
   *  the question. Phase 1: stances[NARRATOR_ID] is the only entry
   *  and serves as the canonical narrator price. Phase 5 adds per-character
   *  stances; the canonical price becomes an aggregate over them. */
  stances: Record<string, Stance>;
  openedAt: string;
  dependents: string[];
  /** Terminal: set when the stance commits to a winning outcome. */
  closedAt?: string;
  /** Index into `outcomes` of the committed winner; undefined until close. */
  closeOutcome?: number;
  /** Scalar in [0, 1] — how decisive the resolution was when the thread closed.
   *  Combines peak evidence at close, margin over the closure threshold, volume
   *  (narrative attention earned), and distribution concentration. Higher =
   *  more earned, more cathartic resolution. */
  resolutionQuality?: number;
  /** Accumulated event graph — one node per scene that touches the thread.
   *  Each node carries the scene's evidence updates and a prose description. */
  threadLog: ThreadLog;
};

// ── Character ────────────────────────────────────────────────────────────────
export type CharacterRole = "anchor" | "recurring" | "transient";

/** World node — a statement of stable fact about an entity's nature, identity, or permanent condition.
 *  Written in simple present tense. No events, no causation. Works across characters, locations, and artifacts.
 *  Distinct from a thread stance: world nodes record what an entity carries; stances record the world view's
 *  bearing on open questions.
 *
 *  Examples:
 *  - "Harry Potter has a lightning-bolt scar on his forehead." (trait)
 *  - "Snape is secretly working as a double agent for the Order." (secret)
 *  - "The Dursley household is hostile to anything associated with magic." (trait)
 *  - "Gandalf carries the elven ring Narya, the Ring of Fire." (relation)
 *  - "The Iron Throne is forged from a thousand surrendered swords." (history)
 *  - "Stannis holds that he is the rightful king of the Seven Kingdoms." (opinion)
 */
export type WorldNodeType =
  | "trait" // Inherent characteristic — personality, atmosphere, physical property
  | "state" // Current condition — wounded, ruined, activated, contested
  | "history" // Past experience — memory, founding event, provenance
  | "capability" // What it can do — skill, strategic value, function
  | "opinion" // Subjective truth held by the entity — legend, lore, contested claim, doctrinal position
  | "relation" // Connection to another entity — bond, sacred-to, bound-to
  | "secret" // Hidden information — hidden knowledge, concealed origin
  | "goal" // Orientation — ambition, purpose, intended use
  | "weakness"; // Vulnerability — fear, structural flaw, limitation

export const WORLD_NODE_TYPES: WorldNodeType[] = [
  "trait",
  "state",
  "history",
  "capability",
  "opinion",
  "relation",
  "secret",
  "goal",
  "weakness",
];

/**
 * Two-category split over the nine WorldNodeTypes — used by the entity
 * world graph (coarse colouring / grouping) and by narrative-context
 * pruning (Core-only continuity).
 *
 * - "core"    — what the entity IS at its core: slow-changing, intrinsic
 *               facts that define identity and define what stays true
 *               regardless of which scene we're in.
 * - "context" — what surrounds or evolves around the entity: faster-
 *               moving circumstantial facts that track engagement with
 *               the world (state changes, past events, opinions held,
 *               ties to others). These exist on the entity but read as
 *               "currently happening" rather than "is".
 */
export type WorldNodeCategory = "core" | "context";

export const WORLD_NODE_CATEGORY: Record<WorldNodeType, WorldNodeCategory> = {
  trait: "core",
  capability: "core",
  goal: "core",
  secret: "core",
  weakness: "core",
  state: "context",
  history: "context",
  opinion: "context",
  relation: "context",
};

/** Core types — what the entity IS. Pulled out as a const-tuple so
 *  context-builders and UI legends can iterate the canonical list
 *  without re-deriving it from WORLD_NODE_CATEGORY each time. */
export const CORE_WORLD_NODE_TYPES: WorldNodeType[] = WORLD_NODE_TYPES.filter(
  (t) => WORLD_NODE_CATEGORY[t] === "core",
);

/** Context types — what surrounds the entity. */
export const CONTEXT_WORLD_NODE_TYPES: WorldNodeType[] = WORLD_NODE_TYPES.filter(
  (t) => WORLD_NODE_CATEGORY[t] === "context",
);

export type WorldNode = {
  id: string;
  type: WorldNodeType;
  content: string;
};

export type WorldEdge = {
  from: string; // WorldNode id
  to: string; // WorldNode id
  relation: string;
};

export type World = {
  nodes: Record<string, WorldNode>;
  edges: WorldEdge[];
};

export type Character = {
  id: string;
  name: string;
  role: CharacterRole;
  world: World;
  threadIds: string[];
  /** AI-generated visual description used as image prompt seed */
  imagePrompt?: string;
  imageUrl?: ImageRef;
};

// ── Location ─────────────────────────────────────────────────────────────────
/** Location narrative prominence — how much weight this place carries in the story.
 *  - domain: center of gravity, where power and identity concentrate — a throne room, an empire, a kitchen
 *  - area: known ground, recurring presence — a familiar tavern, a district, a battlefield
 *  - margin: peripheral, minimal continuity — an alley, a border crossing, set dressing */
export type LocationProminence = "domain" | "place" | "margin";

export type Location = {
  id: string;
  name: string;
  prominence: LocationProminence;
  parentId: string | null;
  /** Characters with a significant tie to this location — residents, faction members, students. Not casual visitors. */
  tiedCharacterIds: string[];
  threadIds: string[];
  world: World;
  /** AI-generated visual description used as image prompt seed */
  imagePrompt?: string;
  imageUrl?: ImageRef;
};

export type RelationshipEdge = {
  from: string;
  to: string;
  type: string;
  valence: number;
};

// ── Artifact ────────────────────────────────────────────────────────────────
export type ArtifactSignificance = "key" | "notable" | "minor";

export type Artifact = {
  id: string;
  name: string;
  /** Narrative weight: key artifacts alter plots, notable ones recur, minor ones are set dressing */
  significance: ArtifactSignificance;
  /** World graph — what is known about this artifact (lore, history, properties, state changes) */
  world: World;
  threadIds: string[];
  /** Current owner — a character or location ID, or null for world-owned (communally available to all) */
  parentId: string | null;
  imagePrompt?: string;
  imageUrl?: ImageRef;
};

export type OwnershipDelta = {
  artifactId: string;
  fromId: string;
  toId: string;
};

export type ArtifactUsage = {
  artifactId: string;
  /** Character who used the artifact. Every usage must have a character. */
  characterId: string | null; // null preserved for backwards compatibility with legacy data
  /** What the artifact did — how it delivered utility (e.g. "cut through the ward", "predicted the market crash") */
  usage: string;
};

export type TieDelta = {
  locationId: string;
  characterId: string;
  action: "add" | "remove";
};

// ── Scene & Arc ─────────────────────────────────────────────────────────────
/** A scene's effect on a thread's stance. The LLM emits one ThreadDelta per
 *  affected thread per scene. Math applies integer `evidence` values as
 *  log-odds shifts on the stance's logits (logit[k] += evidence / sensitivity),
 *  renormalizes via softmax, and appends a ThreadLogNode to the thread's
 *  event log. */
export type ThreadDelta = {
  threadId: string;
  /** Per-outcome evidence. Omit outcomes this scene didn't move. */
  updates: OutcomeEvidence[];
  /** The narrative shape of this movement — matches the 9 primitives.
   *  setup/escalation/payoff at high |evidence|; pulse/stall near zero;
   *  twist when evidence reverses prior direction. */
  logType: ThreadLogNodeType;
  /** Change to narrative attention on this thread. ≥0 in typical usage;
   *  explicit negative only when a thread is deliberately quieted. */
  volumeDelta: number;
  /** New outcomes to add to the thread, mid-story. Rare — reserved for
   *  scenes that genuinely open new possibilities (a reveal introduces a
   *  third contender, a character realises an option they hadn't considered).
   *  Appended with logit=0 in every stance, which gives them the prior of
   *  "equally likely as the current best outcome" before any evidence is
   *  applied in this same delta via `updates`. Duplicates of existing
   *  outcomes are ignored. */
  addOutcomes?: string[];
  /** Prose-grade sentence grounding the update in the scene summary.
   *  Required — every evidence emission must trace to a specific sentence. */
  rationale: string;
};

/** Additive world delta. `addedNodes` lists the entity's new
 *  world entries in causal/temporal order — applyWorldDelta
 *  chains them sequentially via 'co_occurs'. Node order defines the linkage;
 *  no explicit edges are stored. */
export type WorldDelta = {
  entityId: string;
  addedNodes: { id: string; content: string; type: WorldNodeType }[];
};

export type RelationshipDelta = {
  from: string;
  to: string;
  type: string;
  valenceDelta: number;
};

// ── Prose Profile & Beat Plans ───────────────────────────────────────────────

/** Beat function — what the beat DOES in the scene's structure */
export type BeatFn =
  | "breathe" // Pacing, atmosphere, sensory grounding, scene establishment
  | "inform" // Knowledge delivery — character or reader learns something now
  | "advance" // Forward momentum — plot moves, goals pursued, tension rises
  | "bond" // Relationship shifts between characters
  | "turn" // Scene pivots — revelation, reversal, interruption
  | "reveal" // Character nature exposed through action or choice
  | "shift" // Power dynamic inverts
  | "expand" // World-building — new rules, systems, geography
  | "foreshadow" // Plants information that pays off later
  | "resolve"; // Tension releases — question answered, conflict settles

/** Mechanism — HOW the beat is delivered as prose */
export type BeatMechanism =
  | "dialogue" // Characters speaking
  | "thought" // Internal monologue
  | "action" // Physical movement, gesture, body in space
  | "environment" // Setting, weather, arrivals, sensory details
  | "narration" // Narrator addresses reader, authorial commentary, rhetoric
  | "memory" // Flashback triggered by association
  | "document" // Embedded text: letter, newspaper, cited poetry
  | "comic"; // Humor — physical comedy, ironic observation, absurdity

// ── Asset References (Decoupled Storage) ────────────────────────────────────

/**
 * Embedding reference — asset ID stored in IndexedDB (e.g. "emb_abc123")
 */
export type EmbeddingRef = string;

/**
 * Image reference - decoupled storage
 * - "img_abc123": Asset reference (stored in IndexedDB as Blob)
 * - "https://...": External URL (e.g., Replicate-generated images, not stored locally)
 * - undefined: No image
 *
 * Usage: Character images, location images, artifact images, scene images, cover images
 */
export type ImageRef = string | undefined;

/**
 * Audio reference - decoupled storage
 * - "audio_xyz789": Asset reference (stored in IndexedDB as Blob)
 * - undefined: No audio
 *
 * Note: Audio is always generated locally (ElevenLabs, etc.), so always uses asset references.
 * External audio URLs are not supported.
 */
export type AudioRef = string | undefined;

// ── Proposition Classification ───────────────────────────────────────────────

/**
 * Structural category from backward/forward activation strength.
 *   Anchor:   HI backward, HI forward  — load-bearing both directions
 *   Seed:     LO backward, HI forward  — plants forward, harvested later
 *   Close:    HI backward, LO forward  — resolves prior chains, terminal
 *   Texture:  LO backward, LO forward  — atmosphere, world-color
 */
export type PropositionBaseCategory = "Anchor" | "Seed" | "Close" | "Texture";

/**
 * Temporal reach — whether strongest connections are local (within-arc) or global (cross-arc).
 */
export type PropositionReach = "Local" | "Global";

/** Classification scores for a single proposition */
export type PropositionClassification = {
  base: PropositionBaseCategory;
  reach: PropositionReach;
  /** Activation strength: 0.5 * max + 0.5 * mean_topk backward similarity */
  backward: number;
  /** Activation strength: 0.5 * max + 0.5 * mean_topk forward similarity */
  forward: number;
  /** Median scene distance of top-k backward connections */
  backReach: number;
  /** Median scene distance of top-k forward connections */
  fwdReach: number;
};

/**
 * A proposition — an atomic claim the reader must come to believe is true.
 * Works for both fiction (story world facts) and non-fiction (domain facts).
 *
 * The number of propositions is determined by information density —
 * extract as many as needed to faithfully reconstruct the semantic content.
 */
export type Proposition = {
  /** The atomic claim */
  content: string;
  /**
   * Semantic type label — free-form string for embedding compatibility.
   * Common types: state, claim, definition, formula, evidence, rule, comparison, example
   * But any descriptive label works (e.g., "character_belief", "causal_mechanism", "constraint")
   */
  type?: string;
  /** 1536-dim embedding - can be reference ID or inline array (legacy) */
  embedding?: EmbeddingRef;
  /** Timestamp when embedding was generated */
  embeddedAt?: number;
  /** Model used for embedding (e.g., 'text-embedding-3-small') */
  embeddingModel?: string;
};

/** A single beat in a scene plan */
export type Beat = {
  fn: BeatFn;
  mechanism: BeatMechanism;
  /** One sentence: the concrete action or event */
  what: string;
  /** Multiple propositions — constraints the prose must satisfy */
  propositions: Proposition[];
  /** Centroid of proposition embeddings for beat-level semantic search */
  embeddingCentroid?: EmbeddingRef;
};

/** Structured scene plan — JSON replacement for the plain-text plan */
export type BeatPlan = {
  beats: Beat[];
};

/** Beat-aligned prose chunk — links prose to its generating beat */
export type BeatProse = {
  /** Index of the beat in the scene's BeatPlan.beats array */
  beatIndex: number;
  /** The prose text for this beat */
  prose: string;
};

/** Beat-to-prose mapping stored in Scene */
export type BeatProseMap = {
  /** Array of beat-aligned prose chunks */
  chunks: BeatProse[];
  /** Timestamp when this mapping was created */
  createdAt: number;
};

/** Markov transition matrix — probability of transitioning from one beat fn to another */
export type BeatTransitionMatrix = Partial<
  Record<BeatFn, Partial<Record<BeatFn, number>>>
>;

/** A user-saved prose profile that lives on a narrative. Different from the
 *  built-in presets (works) which are global and immutable. Saved profiles
 *  can be renamed, deleted, and used to switch the active proseProfile. */
export type SavedProseProfile = {
  id: string;
  name: string;
  profile: ProseProfile;
  createdAt: number;
};

/** Authorial prose profile — voice and style applied to all prose generation. */
export type ProseProfile = {
  /** Tonal register of the narration */
  register: string;
  /** Narrator's distance from the character */
  stance: string;
  /** Grammatical tense */
  tense?: string;
  /** Structural cadence of prose */
  sentenceRhythm?: string;
  /** How deep the narrator goes into the POV's interior — character thought in fiction; reasoning and evidentiary framing in non-fiction; agent's modelled state under the rule set in simulation. */
  interiority?: string;
  /** Proportion of prose given to dialogue */
  dialogueWeight?: string;
  /** Rhetorical and narrative devices the author uses */
  devices: string[];
  /** Show-don't-tell constraints — apply to ALL scenes */
  rules: string[];
  /** Negative constraints — specific prose failures to avoid for this voice */
  antiPatterns?: string[];
};

/** Mechanism distribution conditioned on beat function — preserves fn/mechanism correlation from source texts */
export type FnMechanismDistribution = Partial<
  Record<BeatFn, Partial<Record<BeatMechanism, number>>>
>;

/** Beat sampling data — derived from analyzed narratives, separate from voice profile. */
export type BeatSampler = {
  /** Markov chain transition probabilities between beat functions */
  markov: BeatTransitionMatrix;
  /** How often each mechanism appears per beat function — preserves the correlation from source texts */
  fnMechanismDistribution: FnMechanismDistribution;
  /** Average beats per 1000 words */
  beatsPerKWord: number;
};

export const BEAT_FN_LIST: BeatFn[] = [
  "breathe",
  "inform",
  "advance",
  "bond",
  "turn",
  "reveal",
  "shift",
  "expand",
  "foreshadow",
  "resolve",
];
export const BEAT_MECHANISM_LIST: BeatMechanism[] = [
  "dialogue",
  "thought",
  "action",
  "environment",
  "narration",
  "memory",
  "document",
  "comic",
];

// ── System Knowledge Graph ──────────────────────────────────────────────────

/** System node — a statement of how the world works.
 *  Written as a general present-tense rule or structural fact.
 *  No specific characters, no specific events. Narrator's structural truth about the universe.
 *  Works for fiction and non-fiction alike.
 *
 *  Examples:
 *  - "Magic performed near an underage wizard is attributed to that wizard by the Ministry, regardless of who cast it." (principle)
 *  - "Gu worms must be fed primeval stones or they weaken and die." (constraint)
 *  - "The Qing Mao Mountain sect allocates gu worms to disciples by rank each season." (convention)
 *  - "Horcruxes anchor the creator's soul to the mortal plane, preventing true death." (system)
 *  - "The Iron Bank of Braavos always collects its debts, even across generations." (structure)
 */
export type SystemNodeType =
  | "principle" // Fundamental truth — physical law, economic axiom, magic rule
  | "system" // Organized mechanism — governance, ecosystem, magic system, TCP/IP
  | "concept" // Abstract idea — theory, framework, phenomenon, category
  | "tension" // Contradiction — unresolved force, debate, opposing pressures
  | "event" // Significant occurrence — war, discovery, founding, publication
  | "structure" // Organization — institution, faction, hierarchy, research lab
  | "environment" // Physical/spatial reality — geography, climate, infrastructure
  | "convention" // Norm — custom, practice, etiquette, legal precedent
  | "constraint"; // Limitation — scarcity, cost, boundary, physical limit

export const SYSTEM_NODE_TYPES: SystemNodeType[] = [
  "principle",
  "system",
  "concept",
  "tension",
  "event",
  "structure",
  "environment",
  "convention",
  "constraint",
];

export type SystemNode = {
  id: string;
  concept: string;
  type: SystemNodeType;
};

export type SystemEdge = {
  from: string;
  to: string;
  relation: string;
};

export type SystemGraph = {
  nodes: Record<string, SystemNode>;
  edges: SystemEdge[];
};

export type SystemDelta = {
  addedNodes: { id: string; concept: string; type: SystemNodeType }[];
  addedEdges: { from: string; to: string; relation: string }[];
};

/** Force values are z-score normalized (mean = 0, units = standard deviations).
 *  0 = average moment, positive = above average, negative = below average.
 *  - fate:   thread phase transitions (weighted by jump magnitude) + relationship valence deltas
 *  - world:  entity world graph complexity delta (ΔN_c + √ΔE_c per scene)
 *  - system: system knowledge graph complexity delta (new nodes + new edges per scene)
 */
export type ForceSnapshot = {
  fate: number;
  world: number;
  system: number;
};

// ── Narrative Cube (Fate · World · System) ──────────────────────────────────
// The three forces (F·W·S) define a cube. Each corner is a recognisable narrative state.
export type CubeCornerKey =
  | "HHH"
  | "HHL"
  | "HLH"
  | "HLL"
  | "LHH"
  | "LHL"
  | "LLH"
  | "LLL";

export type CubeCorner = {
  key: CubeCornerKey;
  name: string;
  description: string;
  forces: ForceSnapshot;
};

export const NARRATIVE_CUBE: Record<CubeCornerKey, CubeCorner> = {
  HHH: {
    key: "HHH",
    name: "Epoch",
    description:
      "Everything converges — threads resolve, characters transform, and the world's rules expand. A defining moment that reshapes the narrative landscape.",
    forces: { fate: 1, world: 1, system: 1 },
  },
  HHL: {
    key: "HHL",
    name: "Climax",
    description:
      "Threads resolve and characters transform within established world rules. The fate of what's already been built — no new lore needed.",
    forces: { fate: 1, world: 1, system: -1 },
  },
  HLH: {
    key: "HLH",
    name: "Revelation",
    description:
      "Threads pay off through world-building. The world's rules explain why things happened — lore unlocks resolution without personal transformation.",
    forces: { fate: 1, world: -1, system: 1 },
  },
  HLL: {
    key: "HLL",
    name: "Closure",
    description:
      "Quiet resolution within established world rules. Tying up loose ends — conversations that needed to happen, debts paid, promises kept or broken.",
    forces: { fate: 1, world: -1, system: -1 },
  },
  LHH: {
    key: "LHH",
    name: "Discovery",
    description:
      "Characters transform through encountering new world systems. No threads resolve — pure exploration, world-building, and possibility.",
    forces: { fate: -1, world: 1, system: 1 },
  },
  LHL: {
    key: "LHL",
    name: "Growth",
    description:
      "Internal character development within established world rules. Characters train, bond, argue, and change through interaction — no new lore.",
    forces: { fate: -1, world: 1, system: -1 },
  },
  LLH: {
    key: "LLH",
    name: "Lore",
    description:
      "Pure world-building without resolution or transformation. Establishing rules, systems, cultures, and connections for future fate. Seeds planted in the world's structure.",
    forces: { fate: -1, world: -1, system: 1 },
  },
  LLL: {
    key: "LLL",
    name: "Rest",
    description:
      "Nothing resolves, no one transforms, no new world concepts. Recovery and breathing room — quiet character deliveries and seed-planting.",
    forces: { fate: -1, world: -1, system: -1 },
  },
};

/**
 * WorldExpansion — unified structure for introducing new entities and applying deltas.
 * Used by both WorldBuild (world expansion) and Scene (scene-level entity introduction).
 *
 * New relationships are created via relationshipDeltas: when no existing relationship
 * is found, the delta creates a new one with valenceDelta as the initial valence.
 */
export type WorldExpansion = {
  // ── New Entities ──────────────────────────────────────────────────────────
  newCharacters: Character[];
  newLocations: Location[];
  newArtifacts?: Artifact[];
  newThreads: Thread[];
  // ── Deltas (changes to existing + new relationships via valenceDelta) ───
  threadDeltas?: ThreadDelta[];
  worldDeltas?: WorldDelta[];
  systemDeltas?: SystemDelta;
  relationshipDeltas?: RelationshipDelta[];
  ownershipDeltas?: OwnershipDelta[];
  tieDeltas?: TieDelta[];
  // ── Network attributions (commit-level structural skeleton) ──────────────
  /** IDs (any kind — C/L/A/T/SYS) this expansion structurally leans on. */
  attributions?: string[];
  /** Edges between attributed ids using the CRG edge vocabulary. Feeds the
   *  cumulative network graph alongside per-scene attribution edges. */
  attributionEdges?: AttributionEdge[];
};

/**
 * Network attribution edge — typed connection between two attributed IDs
 * (any kind: C-, L-, A-, T-, SYS-). Reuses the CRG `ReasoningEdgeType`
 * vocabulary so generation, analysis, and CRG share one edge ontology
 * across the engine. Accumulated across scenes and world builds to grow
 * the cumulative network graph over time.
 */
export type AttributionEdgeRelation =
  | "enables"
  | "constrains"
  | "risks"
  | "requires"
  | "causes"
  | "reveals"
  | "develops"
  | "resolves"
  | "supersedes";

export type AttributionEdge = {
  from: string;
  to: string;
  relation: AttributionEdgeRelation;
};

// ── Prose/Plan Versioning ────────────────────────────────────────────────────
// Versions enable branch isolation: each branch can have its own prose/plan
// without affecting other branches. Resolution uses branch lineage + fork time.
//
// Version numbering: V{major}.{minor}
// Version hierarchy:
// - Generate (fresh generation) → new major version (V1, V2, V3)
// - Rewrite (AI revision) → minor version (V2.1, V2.2)
// - Edit (manual edit) → sub-minor version (V2.1.1, V2.1.2)
// Edits are cleared when rewrite or regeneration occurs (they branch from the new version).

/** Version type: 'generate' = fresh AI generation, 'rewrite' = AI revision, 'edit' = manual edit */
export type VersionType = "generate" | "rewrite" | "edit";

/** A versioned prose snapshot — tagged with the branch that created it */
export type ProseVersion = {
  prose: string;
  beatProseMap?: BeatProseMap;
  proseScore?: ProseScore;
  branchId: string;
  timestamp: number;
  /** Version number — major.minor.edit format (e.g., "1", "2.1", "2.1.3") */
  version: string;
  /** Whether this is a fresh generation, AI rewrite, or manual edit */
  versionType: VersionType;
  /** For rewrites/edits: the version this was derived from */
  parentVersion?: string;
  /** For generated prose: the plan version that produced this prose */
  sourcePlanVersion?: string;
};

/** A versioned plan snapshot — tagged with the branch that created it */
export type PlanVersion = {
  plan: BeatPlan;
  branchId: string;
  timestamp: number;
  /** Version number — major.minor.edit format (e.g., "1", "2.1", "2.1.3") */
  version: string;
  /** Whether this is a fresh generation, AI rewrite, or manual edit */
  versionType: VersionType;
  /** For rewrites/edits: the version this was derived from */
  parentVersion?: string;
};

/** Prose score from evaluation */
export type ProseScore = {
  overall: number;
  details?: Record<string, number>;
};

// ── Time Deltas ──────────────────────────────────────────────────────────────
// Scenes are treated as instants in time; time deltas capture the gap between
// consecutive scenes. Time is tracked relative to the first scene only — no
// absolute calendar reference (no "Monday 1st January 2026"). `value: 0`
// (with any unit) denotes a concurrent scene — same moment as the prior
// scene, different POV or vantage. Negative `value` denotes a backward jump
// on the timeline — used by two modes: FLASHBACK (one negative entry; scenes
// inside the past span use normal positive deltas; one eventual big positive
// delta snap-returns to present) and TIME-TRAVEL (one negative entry; scenes
// move forward from the new position; the narrative lives in the new time,
// no snap-return). Both share the shape (negative entry → forward motion);
// only the flashback returns.

export type TimeUnit =
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "year";

export type TimeDelta = {
  value: number;
  unit: TimeUnit;
  /** Optional natural-language phrasing of the transition — "the next morning",
   *  "years before, when she was a child", "by the time the funeral closed".
   *  Captures English-language flow nuance the {value, unit} pair cannot. */
  transition?: string;
};

export type Scene = {
  kind: "scene";
  id: string;
  arcId: string;
  locationId: string;
  /** Character whose perspective this scene is told from. Null when the
   *  source has no viewpoint entity (omniscient simulation, impersonal
   *  analytical writing, polyphonic sources). */
  povId: string | null;
  participantIds: string[];
  /** Artifact usages — which character used which artifact in this scene.
   *  Location-owned artifacts can be used communally; character-owned only by owner. */
  artifactUsages?: ArtifactUsage[];
  events: string[];
  threadDeltas: ThreadDelta[];
  worldDeltas: WorldDelta[];
  relationshipDeltas: RelationshipDelta[];
  /** System knowledge graph deltas — new concepts and connections about how the world works */
  systemDeltas?: SystemDelta;
  /** IDs (any kind — C/L/A/T/SYS) this scene structurally leans on. Unified
   *  attribution surface: introductions (new entities, new system nodes), deltas
   *  (threads moved, world graphs grown, system rules added), and structural
   *  references (rules invoked but not mutated, threads acknowledged, entities
   *  off-screen-affected) all flow through this single list. Drives node
   *  sizing / heat in the cumulative network graph and per-node usefulness
   *  metrics across the inspector and analytics views. */
  attributions?: string[];
  /** Typed edges between attributed ids using the CRG edge vocabulary —
   *  the scene's contribution to the cumulative network graph's structural
   *  skeleton. Captures cross-kind connections (character ↔ system rule,
   *  thread ↔ location, etc.) the LLM is asked to declare explicitly so the
   *  network grows over time rather than being inferred. */
  attributionEdges?: AttributionEdge[];
  /** Artifact ownership changes — objects changing hands between characters/locations */
  ownershipDeltas?: OwnershipDelta[];
  /** Tie changes — characters forming or breaking ties with locations */
  tieDeltas?: TieDelta[];
  // ── New Entities (optional — most scenes don't introduce entities) ────────
  /** New characters introduced in this scene */
  newCharacters?: Character[];
  /** New locations introduced in this scene */
  newLocations?: Location[];
  /** New artifacts introduced in this scene */
  newArtifacts?: Artifact[];
  /** New threads introduced in this scene — seeded with fresh stances at uniform prior over their outcomes. */
  newThreads?: Thread[];
  /** Version history for prose — enables branch isolation. Resolution uses branch lineage + fork time. */
  proseVersions?: ProseVersion[];
  /** Version history for plan — enables branch isolation. Resolution uses branch lineage + fork time. */
  planVersions?: PlanVersion[];
  /** Game-theoretic analysis — opt-in, additive layer derived from the beat plan. Single current analysis; regenerate to replace. */
  gameAnalysis?: SceneGameAnalysis;
  /** Learning question bank — opt-in, additive layer of multiple-choice
   *  questions testing the concepts and ideas a reader should take away from
   *  this scene. Extracted exhaustively from the scene with full-narrative
   *  context; like gameAnalysis it never mutates deltas and regenerating
   *  replaces the bank. Tags drive cross-scene quiz assembly. */
  questions?: LearningQuestion[];
  /** Estimated time elapsed since the prior scene in the branch. Required
   *  via prompting going forward — the LLM commits to a best-guess based on
   *  prose cues, even when the gap is fuzzy. Optional in the type for
   *  backward compatibility with scenes generated before this field existed.
   *  `value: 0` marks this scene as concurrent (same moment as the prior
   *  scene, different vantage). The first scene of a branch uses `value: 0`
   *  since there is no prior scene. Relative delta only — no absolute
   *  calendar anchor. */
  timeDelta?: TimeDelta | null;
  summary: string;
  audioUrl?: AudioRef;
  /** Embedding of scene summary for semantic search (reference or inline) */
  summaryEmbedding?: EmbeddingRef;
  /** Centroid of all beat centroids in the plan (reference or inline) */
  planEmbeddingCentroid?: EmbeddingRef;
  /** Embedding of full prose text for semantic search (reference or inline) */
  proseEmbedding?: EmbeddingRef;
  /** Wall-clock timestamp (ISO 8601) when this scene was committed into the
   *  narrative — by the LLM, by analysis extraction, or by reconstruction.
   *  Used to surface "when this prediction was made" for credibility when
   *  showing forecasts Meridians produced. Stamped at the boundary; never
   *  emitted by the LLM itself. Optional for backward compatibility with
   *  scenes generated before this field existed. */
  createdAt?: string;
};

export type WorldBuild = {
  kind: "world_build";
  id: string;
  summary: string;
  expansionManifest: WorldExpansion;
  /** Reasoning graph used to plan this expansion — stored for canvas viewing */
  reasoningGraph?: ReasoningGraphSnapshot;
  /** Wall-clock timestamp (ISO 8601) when this world commit landed. See
   *  Scene.createdAt — same purpose, applied to expansion commits. */
  createdAt?: string;
  /** Merges folded in as the basis for this expansion — same semantics as
   *  Arc.basisMergeIds, applied to world-expansion commits. Branch-relative
   *  for free: the WorldBuild only appears on branches that contain it. */
  basisMergeIds?: string[];
};

// ── Branch Evaluation ─────────────────────────────────────────────────────

/** Per-scene verdict from a branch evaluation pass */
export type SceneVerdict = "ok" | "edit" | "merge" | "cut" | "insert" | "move";

/** One scene's evaluation entry */
export type SceneEval = {
  sceneId: string;
  verdict: SceneVerdict;
  /** One-line reason for the verdict */
  reason: string;
  /** For "merge" verdicts: ID of the scene to merge INTO (the surviving scene absorbs this one's content) */
  mergeInto?: string;
  /** For "insert" verdicts: ID of the scene to insert AFTER */
  insertAfter?: string;
  /** For "move" verdicts: ID of the scene to place this scene AFTER (no content change, pure reposition) */
  moveAfter?: string;
};

/** Full branch evaluation — overall critique + per-scene verdicts */
export type StructureReview = {
  id: string;
  branchId: string;
  createdAt: string;
  /** High-level analysis (what's working, what's weak, thematic questions) */
  overall: string;
  /** Per-scene verdicts in timeline order */
  sceneEvals: SceneEval[];
  /** Detected repetitive patterns */
  repetitions: string[];
  /** Thematic question the evaluator surfaced */
  thematicQuestion: string;
};

// ── Prose Evaluation ─────────────────────────────────────────────────────────

export type ProseVerdict = "ok" | "edit";

export type ProseSceneEval = {
  sceneId: string;
  verdict: ProseVerdict;
  /** Specific issues found in the prose — actionable edit instructions */
  issues: string[];
};

export type ProseEvaluation = {
  id: string;
  branchId: string;
  createdAt: string;
  /** High-level prose quality analysis */
  overall: string;
  /** Per-scene prose verdicts */
  sceneEvals: ProseSceneEval[];
  /** Recurring prose issues across scenes */
  patterns: string[];
};

// ── Plan Evaluation ──────────────────────────────────────────────────────────

export type PlanVerdict = "ok" | "edit";

export type PlanSceneEval = {
  sceneId: string;
  verdict: PlanVerdict;
  /** Specific continuity or structural issues found in the beat plan */
  issues: string[];
};

export type PlanEvaluation = {
  id: string;
  branchId: string;
  createdAt: string;
  /** High-level continuity analysis */
  overall: string;
  /** Per-scene plan verdicts */
  sceneEvals: PlanSceneEval[];
  /** Recurring continuity issues across scenes */
  patterns: string[];
};

/** A timeline entry is a scene or world build. */
export type TimelineEntry = Scene | WorldBuild;

export function isScene(entry: TimelineEntry): entry is Scene {
  return entry.kind === "scene";
}

export function isWorldBuild(entry: TimelineEntry): entry is WorldBuild {
  return entry.kind === "world_build";
}

/** A variable — a lever on the possibility field. Each Present (per arc) and
 *  each Compass scenario owns its OWN custom variable set, generated for that
 *  particular moment. There is no shared catalogue, and Compass scenarios
 *  don't reference back to the arc's Present variables — every set stands
 *  alone.
 *
 *  Intensity index maps to a 5-level scale: 0 off, 1 weak, 2 mild, 3 strong,
 *  4 extreme. */
export type Variable = {
  id: string;
  /** Short display name (2–5 words). */
  name: string;
  /** One-sentence description of what this variable represents. */
  description: string;
  /** Free-form category for grouping in the UI. Scope-local; no cross-set
   *  consistency is enforced. */
  category: string;
  /** Realised intensity in this set (0–4). */
  intensity: number;
};

/** A named direction the Compass surfaces — a unique coordination of
 *  variables at chosen intensities. The Compass produces a cohort of these
 *  per arc, softmax-weighted by priorLogit. Read as precision prediction in
 *  simulation (probability the modelled system reaches this state) and as
 *  recommendation otherwise (how strongly the paradigm's compass pulls
 *  toward this direction). The operator can compare directions before
 *  committing one as the basis for next-arc generation. */
export type PlanningScenario = {
  id: string;
  name: string;
  /** Short one-sentence gestalt of the coordination — what this direction IS
   *  as a recognisable shape. Same register as a chapter epigraph for fiction,
   *  a section heading for a paper, a scenario name for simulation. */
  description?: string;
  /** Hex colour for the direction's polyline / card accents. */
  color: string;
  /** This direction's OWN variable set — generated custom for this particular
   *  coordination at the moment of generation. Does not reference back to
   *  the arc's Present variables; each direction stands alone. */
  variables: Variable[];
  /** LLM-estimated log-prior reflecting how plausible this scenario is given
   *  the narrative context. Range matches the stance evidence scale
   *  (STANCE_EVIDENCE_MIN/MAX = [-4, +4]) so scenario priors and thread
   *  evidence speak the same units: +4 = decisive evidence in favour, 0 =
   *  baseline plausibility, -4 = decisive against / rare tail. Softmax
   *  across the cohort produces display probabilities. Intensity is *not*
   *  used as a probability proxy — a high-intensity tail event gets a low
   *  priorLogit, not a deflated likelihood. */
  priorLogit?: number;
  /** Multi-sentence load-bearing logic for this coordination — which variables
   *  cascade into which, why these intensities, what makes the scenario
   *  plausible relative to its siblings. Anchors the priorLogit so the user
   *  can audit "why is this 18%?". */
  reasoning?: string;
  /** Alternatives considered and rejected — the option space this scenario
   *  selected from. The adjacent coordinations that were drafted and
   *  discarded, the rival readings of the substrate, the sibling
   *  scenarios this one specifically contrasts against. Universal
   *  inference shape — see ReasoningNodeSnapshot for the cross-graph
   *  definition. */
  considered?: string;
  /** What conditions would invalidate / falsify this scenario — the
   *  observation that would mean it didn't happen, the threshold whose
   *  non-crossing voids it, the load-bearing assumption whose breakage
   *  rules it out. Forces genuine forecasting work; if `breaks` is empty
   *  the scenario can't be wrong, which means it isn't forecasting. */
  breaks?: string;
  /** What becomes possible / cascades downstream if this direction holds —
   *  the threads it opens for the next arc, the stances it perturbs, the
   *  affordances it grants subsequent continuations. */
  opens?: string;
};

export type Arc = {
  id: string;
  name: string;
  sceneIds: string[];
  develops: string[];
  /** Locations this arc focuses on — determines the spatial graph shown */
  locationIds: string[];
  /** Characters active in this arc — determined by location + thread participants */
  activeCharacterIds: string[];
  /** Short sentence summarising the narrative direction of this arc */
  directionVector?: string;
  /** This arc's Present variables — the full definitions plus their realised
   *  intensities for the arc. No shared work-wide catalogue: each arc owns
   *  its own custom-generated set. Compass directions on the same arc each
   *  own their own independent variable sets too. Undefined / empty = arc
   *  has no variables defined yet, UI shows the fresh-page seed state. */
  presentVariables?: Variable[];
  /** Compass the Present variable set was extracted against — paradigm name
   *  + the operative cues (forward-motion shape, native attractors, natural
   *  cadence, tail vocabulary). One dense line (≤ 30 words) the model
   *  commits to BEFORE selecting variables, so the lens is auditable. A
   *  cultivation Present and a hardboiled-thriller Present read the same
   *  evidence differently; this field is the fingerprint of which reading
   *  was used. */
  presentParadigm?: string;
  /** Short one-sentence gestalt of the Present coordination — what this
   *  configuration *is* as a recognisable shape. Generated alongside the
   *  variables. When a Compass direction is committed via scenarios,
   *  the direction's own description is transferred onto the new arc's
   *  `presentDescription` so the lineage is preserved. */
  presentDescription?: string;
  /** Multi-sentence load-bearing logic for the Present variable coordination —
   *  WHY these variables are firing at these intensities given the arc's
   *  state: which mechanism feeds which, where the cascade runs, which symptom
   *  is the surface. Transferred from the parent scenario's `reasoning` on
   *  scenarios commit. */
  presentReasoning?: string;
  /** Log-prior plausibility score for this Present coordination, in the
   *  same STANCE_EVIDENCE_MIN/MAX range as Compass priorLogits ([-4, +4]).
   *  When a Compass direction is committed via scenarios, the
   *  direction's `priorLogit` is transferred onto the new arc's
   *  `presentLogit` — preserving "how strongly was this pulled-toward when
   *  it was chosen" as a permanent record of the path's rarity. When
   *  Present is regenerated directly, the LLM emits a self-estimated logit. */
  presentLogit?: number;
  /** Universal inference-shape fields for Present — same semantics as the
   *  fields on PlanningScenario (the Compass direction type) and node
   *  snapshots: option space, falsification handle, forward extension.
   *  Generated alongside the variables; transferred from the parent
   *  Compass direction on scenarios commit so lineage of the
   *  comparative + falsification reasoning is preserved across the branch
   *  fork. */
  presentConsidered?: string;
  presentBreaks?: string;
  presentOpens?: string;
  /** Optional user-supplied direction string captured at the last regenerate
   *  for transparency — shows what guidance shaped the cohort. */
  scenarioDirection?: string;
  /** Compass cohort — directions the engine recommends for the next arc,
   *  each a unique coordination of variables with a softmax-weighted
   *  priorLogit. Read as precision prediction in simulation, recommendation
   *  otherwise. Generated by the LLM and editable. The user picks one
   *  direction and that becomes the brief sent to scene generation. Empty /
   *  unset on past arcs unless the user deliberately seeds them. */
  planningScenarios?: PlanningScenario[];
  /** Compass lens the cohort was drafted against — paradigm name + the
   *  operative cues (forward-motion shape, native attractors, natural
   *  cadence, tail vocabulary). Cohort-level, distinct from
   *  `presentParadigm`: Present and Compass are independent extractions
   *  from the same evidence and may land on slightly different paradigm
   *  framings if the substrate is genre-hybrid. */
  planningParadigm?: string;
  /**
   * Compact snapshot of the global state AS OF the end of this arc — the
   * chess-board position. Who is where, what threads are live and at what
   * stage, what resources/artifacts are in play, what tensions stand.
   * Complementary to `directionVector` (forward-looking) — this is the
   * backward-looking state that downstream reasoning can treat as ground truth
   * without replaying every delta. Written in terse, structured prose.
   */
  worldState?: string;
  /** Reasoning graph used to plan this arc's scenes — stored for canvas viewing */
  reasoningGraph?: ReasoningGraphSnapshot;
  /**
   * Mode that was current when this arc was generated. Reference
   * (id only) into NarrativeState.modes — phase graphs are immutable
   * and never deleted, so a stable id reference preserves the working
   * model of reality the arc was built under, even if the user later
   * regenerates a new current phase graph or clears the active one.
   * Undefined = no phase graph was active when this arc was generated.
   */
  phaseGraphId?: string;
  /**
   * Merges (committed-stream resolutions) folded in as the basis for this
   * arc's continuation — the perspective-held reality the arc was generated
   * to extend. Streams and merges are global, but *consumption* is per-arc:
   * because an arc only appears on branches that contain its scenes, this
   * stamp makes "which merges continued reality" branch-relative. A branch
   * forked before this arc never sees the stamp. Undefined / empty = the arc
   * was generated without folding any merge.
   */
  basisMergeIds?: string[];
};

/** Stored reasoning graph snapshot — decoupled from the ai module for type safety */
export type ReasoningGraphSnapshot = {
  nodes: ReasoningNodeSnapshot[];
  edges: ReasoningEdgeSnapshot[];
  arcName: string;
  sceneCount: number;
  summary: string;
  /** Engine settings under which the CRG was built — force preference,
   *  reasoning mode, network bias. Persisted so scene generation (and
   *  later stages) can inherit the same tilt the CRG was reasoned under,
   *  keeping CRG → scene execution synchronised. */
  arcSettings?: {
    thinkingResource?: "fate" | "world" | "system" | "chaos" | "freeform";
    thinkingStyle?: "freeform" | "divergent" | "deduction" | "abduction" | "induction";
    networkBias?: "inside" | "outside" | "neutral";
  };
};

export type ReasoningNodeSnapshot = {
  id: string;
  /** Presentation order — causal/chronological position used for display. */
  index: number;
  /** Generation order — the order the reasoner thought of this node (JSON emission position). Differs from `index` in backward modes, which lets the UI surface the thinking pattern. */
  order?: number;
  type:
    | "fate"
    | "character"
    | "location"
    | "artifact"
    | "system"
    | "reasoning"
    | "pattern"
    | "warning"
    | "chaos"        // Creative agent — introduces new entities (characters/locations/artifacts/threads)
    | "conclusion"   // Load-bearing terminal answer to the investigation's direction. Uses the universal inference-shape: `detail` carries the concrete answer, `considered` / `breaks` / `opens` carry alternatives / falsification / cascades. Exactly one per graph when the direction is a question.
    // Plan-spine types — only produced by coordination-plan-derived
    // maps. Manual maps never emit these. Kept in the
    // shared union so the sidebar + canvas can render both kinds of
    // investigation through one code path.
    | "peak"
    | "valley"
    | "moment";
  label: string;
  detail?: string;
  /**
   * Universal inference shape — the three fields below appear on every
   * node-like artifact across the reasoning subsystem (this snapshot,
   * PhaseNodeSnapshot, PlanningScenario). Same field names, same abstract
   * semantics; per-context specifics live in the prompt that produced
   * the node, not in the type. Together they expose the *machinery* of
   * the inference rather than just the conclusion — the three handles a
   * reader uses to re-evaluate, stress-test, and extend the reasoning.
   *   - considered : the option space (alternatives rejected)
   *   - breaks     : the falsification handle (what invalidates it)
   *   - opens      : the forward extension (what cascades downstream)
   */
  /** Alternatives considered and rejected — the option space this
   *  inference selected from. Required by abduction/induction modes on
   *  reasoning-tier nodes; without it abduction collapses to post-hoc
   *  rationalisation. Inference-tier nodes only (reasoning, pattern,
   *  warning, chaos). */
  considered?: string;
  /** What conditions would invalidate this inference — the load-bearing
   *  assumption, the falsifying evidence, the way the chain could fail.
   *  Deduction mode's necessity test materialises here. */
  breaks?: string;
  /** What becomes possible / cascades downstream IF this holds — the
   *  second-order consequences. Divergent mode's outward branching
   *  materialises here. */
  opens?: string;
  /** Reference to a character / location / artifact in the narrative. Set
   *  when this node anchors to an existing world entity; cleared when the
   *  reference doesn't resolve (LLM hallucination) or when the node
   *  introduces a new entity. */
  entityId?: string;
  /** Reference to a thread in the narrative. Set on fate nodes that anchor
   *  to an existing thread; cleared on hallucination. */
  threadId?: string;
  /** Reference to a node in the system knowledge graph. Set on system nodes
   *  that anchor to an existing rule/principle/concept; cleared on
   *  hallucination or when the node introduces a new system rule. */
  systemNodeId?: string;
};

export type ReasoningEdgeSnapshot = {
  id: string;
  from: string;
  to: string;
  type: "enables" | "constrains" | "risks" | "requires" | "causes" | "reveals" | "develops" | "resolves" | "supersedes";
  label?: string;
};

/**
 * Per-arc reasoning graph node types. Extends the base ontology with a
 * `chaos` agent that explicitly authorises world expansion — introducing
 * new characters, locations, artifacts, or threads to fuel the arc.
 */

// ── Mode ──────────────────────────────────────────────────────────────
// A working model of reality the narrative is currently operating under.
// Distinct from CRG (which delivers per-arc causal reasoning): Modes
// capture the *current state* of the system — what patterns are active, what
// pressures are accumulating, what conventions are followed, what attractors
// the cast aims at, what landmarks anchor the past, what rules bind, what
// agents are driving. Mined from narrative context with optional user
// guidance, opt-in, and passed downstream into CRG / scene / plan / prose
// generation as the working state of reality.
//
// Modes are IMMUTABLE once generated. To change the working model, a
// new PRG is generated (optionally seeded by an existing one via basedOn).
// The "current" PRG is the one downstream generation reads from; it can be
// cleared (no active phase graph), in which case generation falls back to
// a historical viewpoint of the narrative context.
//
// STORAGE LIFECYCLE: PRGs are user-managed via the Phase tab — switch
// current, name, use as basis for a new PRG, or delete explicitly. Arcs
// hold an `arc.phaseGraphId` reference to the PRG that was current at
// arc generation time, preserving the model the arc was built under.
// `prunePhaseGraphs` (reference-counted helper) is exposed for opt-in
// cleanup, but the canonical lifecycle is explicit user management.

/**
 * Mode node types. The temporal stance is implicit in the type:
 *   - pattern    : recurring configuration · currently-active
 *   - convention : procedural default · currently-followed
 *   - attractor  : what's being aimed at · future-pointing
 *   - agent      : entity with stance · currently-driving
 *   - rule       : foreground constraint · currently-binding
 *   - pressure   : accumulated tension · accumulating-toward-discharge
 *   - landmark   : discharged event with persistent influence · past-but-anchoring
 */
export type PhaseNodeType =
  | "pattern"
  | "convention"
  | "attractor"
  | "agent"
  | "rule"
  | "pressure"
  | "landmark";

export type PhaseNodeSnapshot = {
  id: string;
  /** Presentation / causal order — used for display and sequential walks. */
  index: number;
  /** Generation order — the order the AI emitted this node (JSON position). May differ from `index` in backward modes. */
  order?: number;
  type: PhaseNodeType;
  label: string;
  detail?: string;
  /** Alternatives considered and rejected — the option space this node
   *  selected from. For PRG, the alternative readings of this machinery,
   *  the carve-outs and exceptions, the rules that look similar but
   *  aren't load-bearing here. Universal inference shape — see
   *  ReasoningNodeSnapshot for the cross-graph definition. */
  considered?: string;
  /** What conditions would invalidate / falsify this node. For PRG, the
   *  edges where the machinery fails, the thresholds whose crossing
   *  releases the pressure, the conditions that supersede the rule. */
  breaks?: string;
  /** What becomes possible / cascades downstream if this holds. For PRG,
   *  the operational downstream behaviour the machinery produces — what
   *  later CRG / scene generation can inherit and ground its work in. */
  opens?: string;
  /** Optional anchor — entity / thread / system-node id this phase claim is grounded in (when applicable). */
  entityId?: string;
  threadId?: string;
  systemNodeId?: string;
};

/** Mode edges reuse the CRG edge ontology — same nine types. */
export type PhaseEdgeSnapshot = {
  id: string;
  from: string;
  to: string;
  type: "enables" | "constrains" | "risks" | "requires" | "causes" | "reveals" | "develops" | "resolves" | "supersedes";
  label?: string;
};

/**
 * Stored Phase Reasoning Graph (PRG) — the working model of reality.
 * Immutable once stored; regeneration produces a new PRG (optionally seeded
 * by an existing one via `basedOn`). Arcs reference these by id via
 * `Arc.phaseGraphId`. Users manage the collection in the Phase tab: name,
 * switch current, use as basis, or delete explicitly.
 */
export type Phase = {
  id: string;
  /**
   * Display name shown in the Phase tab list. User-editable; defaults to a
   * timestamp or the LLM-generated summary's first clause when not set.
   */
  name?: string;
  /** 1-2 sentence summary of the working model this PRG asserts. */
  summary: string;
  nodes: PhaseNodeSnapshot[];
  edges: PhaseEdgeSnapshot[];
  /** PRG this one was seeded from (regeneration with a basis). Undefined = mined fresh from narrative context. */
  basedOn?: string;
  /** User guidance / hypothesis given at generation time (optional). */
  guidance?: string;
  createdAt: number;
};

// ── Coordination Plan ────────────────────────────────────────────────────────

/**
 * Extended node types for multi-arc coordination plans.
 *
 * Structural-spine nodes (peak/valley/moment) replace the old generic `plot`
 * type. The spine convention:
 *   • Exactly one peak OR valley anchors each arc (and carries arcIndex,
 *     sceneCount, forceMode) — this is the arc's structural commitment point.
 *   • Peaks are where forces converge and threads culminate.
 *   • Valleys are turning points where tension is seeded and the arc pivots.
 *   • Moments are everything else worth flagging at plan level (thread
 *     progressions, setpieces, reveals) — subordinate to the arc's anchor.
 */
export type CoordinationNodeType =
  | "fate"         // Thread's gravitational pull (inherited)
  | "character"    // Active agent (inherited)
  | "location"     // Setting (inherited)
  | "artifact"     // Object (inherited)
  | "system"       // World rule/principle (inherited)
  | "reasoning"    // Logical step (inherited)
  | "pattern"      // Cooperative agent (inherited)
  | "warning"      // Adversarial agent (inherited)
  | "chaos"        // Creative agent — spawns new characters/locations/artifacts/threads
  | "peak"         // Structural peak — forces converge, thread culminates
  | "valley"       // Structural valley — turning point, tension seeded
  | "moment";      // Key beat worth flagging in the plan that isn't a peak or valley

/** Thread stance intent for spine nodes — what the arc should do to the
 *  thread's stance. Binary: should the bearing shift? Should it close?
 *  Should a twist reverse the dominant outcome? */
export type ThreadStanceIntent =
  | "advance"    // move stance toward `outcome` without committing
  | "escalate"   // raise volume + move stance, set up payoff
  | "close"      // commit to `outcome` (stance → 1 for that outcome)
  | "twist"      // reverse prior direction (dominant outcome flips)
  | "maintain"   // pulse — keep volume alive without stance movement
  | "abandon";   // let volume decay, no evidence emitted

/**
 * Force mode for an arc, derived from the composition of its nodes.
 *  - fate-dominant: thread pressure drives the arc (fate + peak/valley with threadId)
 *  - world-dominant: entities drive the arc (character + location + artifact)
 *  - system-dominant: world rules drive the arc (system nodes)
 *  - chaos-dominant: outside forces drive the arc (chaos nodes spawn new entities)
 *  - balanced: no single category dominates
 */
export type ArcForceMode =
  | "fate-dominant"
  | "world-dominant"
  | "system-dominant"
  | "chaos-dominant"
  | "balanced";

/**
 * Node in a coordination plan — extends reasoning nodes with plan-specific fields.
 *
 * Spine nodes (peak/valley/moment) may carry thread-progression metadata
 * (threadId + stanceIntent + stanceOutcome). The one peak or valley that anchors an arc also
 * carries arcIndex, sceneCount, and forceMode.
 */
export type CoordinationNode = {
  id: string;
  /** Presentation order — causal/chronological position used for display. */
  index: number;
  /** Generation order — the order the reasoner thought of this node (JSON emission position). Differs from `index` in backward modes, which lets the UI surface the thinking pattern. */
  order?: number;
  type: CoordinationNodeType;
  label: string;
  detail?: string;
  /** Sibling hypotheses considered and rejected (inference-tier nodes
   *  only — reasoning/pattern/warning/chaos). See ReasoningNodeSnapshot. */
  considered?: string;
  /** What conditions would invalidate this inference. Inference-tier only. */
  breaks?: string;
  /** What becomes possible downstream if this inference holds. Inference-tier only. */
  opens?: string;
  /** Reference to entity (character/location/artifact) */
  entityId?: string;
  /** Reference to thread (for fate and spine nodes tracking thread progression) */
  threadId?: string;
  /** Reference to a node in the system knowledge graph (for system nodes anchoring to an existing rule/principle/constraint/tension). */
  systemNodeId?: string;
  /** Stance intent for this thread (for spine nodes tracking thread progression) */
  stanceIntent?: ThreadStanceIntent;
  /** Target outcome name (for advance/close/twist intents — must match an
   *  entry in the thread's outcomes array). */
  stanceOutcome?: string;
  /** Arc index 1-N (set only on the peak or valley that anchors an arc) */
  arcIndex?: number;
  /** Suggested scene count (set only on the arc-anchoring peak/valley) */
  sceneCount?: number;
  /** Force mode constraint (set only on the arc-anchoring peak/valley) */
  forceMode?: ArcForceMode;
  /**
   * Arc slot this node belongs to (1-indexed).
   * Nodes with arcSlot <= currentArc are visible during arc generation.
   * Allows progressive revelation — early arcs don't see late-plan reasoning.
   */
  arcSlot?: number;
};

/** Reuses the same edge types as reasoning graphs */
export type CoordinationEdge = ReasoningEdgeSnapshot;

/**
 * A coordination plan that orchestrates multiple arcs through backward induction.
 * Uses the same graph structure as arc reasoning but at a higher level of abstraction.
 */
export type CoordinationPlan = {
  id: string;
  /** All nodes in the plan */
  nodes: CoordinationNode[];
  /** All edges connecting nodes */
  edges: CoordinationEdge[];
  /** Total number of arcs in the plan */
  arcCount: number;
  /** High-level summary of the plan */
  summary: string;
  /**
   * Node IDs grouped by arc slot.
   * arcPartitions[0] = node IDs visible to arc 1
   * arcPartitions[1] = node IDs visible to arcs 1-2 (cumulative)
   * etc.
   */
  arcPartitions: string[][];
  /** Current arc being executed (0 = not started, 1-N = executing arc N) */
  currentArc: number;
  /** Arcs that have been completed */
  completedArcs: number[];
  /** Timestamp when plan was created */
  createdAt: number;
};

/** Stored plan state on a branch */
export type BranchPlan = {
  /** The coordination plan */
  plan: CoordinationPlan;
  /** Whether auto mode should execute this plan */
  autoExecute: boolean;
};

// ── Branch ───────────────────────────────────────────────────────────────────

/** Explicit version pointers for a scene — allows a branch to pin specific versions */
export type SceneVersionPointers = {
  /** Pinned prose version for this scene on this branch (undefined = auto-resolve) */
  proseVersion?: string;
  /** Pinned plan version for this scene on this branch (undefined = auto-resolve) */
  planVersion?: string;
};

export type Branch = {
  id: string;
  name: string;
  parentBranchId: string | null;
  /** Entry where this branch diverges from its parent (null for root) */
  forkEntryId: string | null;
  /** Ordered timeline entry IDs (scenes + world builds) owned by this branch */
  entryIds: string[];
  /** Branch-scoped coordination plan (optional — absent means no plan layer) */
  coordinationPlan?: BranchPlan;
  /** Explicit version pointers — sceneId → version pointers (optional, absent = auto-resolve) */
  versionPointers?: Record<string, SceneVersionPointers>;
  createdAt: number;
};

// ── Location Maps ──────────────────────────────────────────────────────────

/** A single parent→child containment edge within a location cluster. */
export type MapEdge = {
  from: string;
  to: string;
};

/**
 * A manually-placed label for one member location of a map. The map image is
 * rendered textless (except its baked-in parent title); the user drags a label
 * per child location onto its region in the annotator. `x`/`y` are normalized
 * [0..1] coordinates over the map image, so positions are resolution-independent.
 */
export type MapLabel = {
  locationId: string;
  x: number;
  y: number;
};

/**
 * A generated map of a location cluster. A cluster is a connected component of
 * the location parent/child graph (see lib/location-clusters.ts); a Board
 * is the Replicate-rendered image of one such cluster plus the snapshot of the
 * cluster membership it was generated from.
 *
 * The `signature` is the sorted member-id fingerprint at generation time. When
 * the live cluster's signature drifts (a location was added to / removed from
 * the cluster), the map is considered outdated and prime to regenerate.
 */
export type Board = {
  id: string;
  /** Cluster anchor — the top-most ancestor location id of the cluster. A map
   *  is matched to a live cluster by this root id. */
  rootLocationId: string;
  /** Display name — the root location's name at generation time. */
  name: string;
  /** Member location ids included when the map was generated (cluster snapshot). */
  locationIds: string[];
  /** Parent→child edges among members, captured at generation. */
  edges: MapEdge[];
  /** Sorted member-id fingerprint used to detect cluster drift / outdatedness. */
  signature: string;
  /** Scope depth this map was generated at — generations of descendants below
   *  the root that were included (undefined / Infinity ⇒ whole subtree). */
  depth?: number;
  /** Replicate-generated map image (asset id), once generated. */
  imageUrl?: ImageRef;
  /** The visual prompt used to render the map (transparency / regeneration). */
  prompt?: string;
  /** Manually-placed labels for member locations (drag-drop annotator). The map
   *  art is textless except the parent title; these position each child's name. */
  labels?: MapLabel[];
  createdAt: number;
  updatedAt: number;
};

/** A named region of the narrative — one or more whole arcs grouped together.
 *  Its scene slice is resolved from the arcs' sceneIds at view time, so it
 *  survives branch / version differences. Currently used to scope slide decks
 *  ("quarterly reports"), and reusable for any future range-based feature. */
export type Region = {
  id: string;
  name: string;
  /** Arcs composing this region (timeline order). */
  arcIds: string[];
};

// ── Narrative State ──────────────────────────────────────────────────────────

// ── Perspectives model (ROADMAP A0) ────────────────────────────────────────
// What a room gathers over time is PERSPECTIVES. A Member attaches to an
// entity/narrator Perspective and contributes a Stream of priors against it.
// Each Stream is itself a thread (outcomes + a Stance moved by its priors), so
// motivations live on the streams, not the perspective. One or many committed
// Streams collapse into a Merge, interleaving priors by commit time to extend
// continuity.
// Persisted on NarrativeState (no new IndexedDB store). Exactly one Member
// holds the GM role (single master device).

export type MemberRole = "gm" | "member";

export const MEMBER_ROLES: readonly MemberRole[] = ["gm", "member"];

export interface Member {
  id: string;
  firstName: string;
  lastName: string;
  /** E.164 — routing key for WhatsApp (A6), the live mobile page (B1), and the close-out (A3). */
  mobile?: string;
  role: MemberRole;
}

/** An AI game player. A persona (a preset personality or a custom prompt) is the
 *  basis for a varying, unique player that can operate an entity from that
 *  entity's perspective — an alternative to a real Member for thinking about the
 *  priors of a perspective: it augments stream suggestions, intuitions, and the
 *  continuation of priors. Persisted on NarrativeState (no new IndexedDB store);
 *  the preset prompt catalogue lives in `src/lib/agents/personas.ts`. */
export type AgentPersonaKey =
  | "strategist"
  | "diplomat"
  | "opportunist"
  | "idealist"
  | "skeptic"
  | "aggressor"
  | "guardian"
  | "maverick"
  | "analyst"
  | "survivor"
  | "custom";

export interface Agent {
  id: string;
  name: string;
  /** Preset personality, or "custom" to use `customPersona`. */
  persona: AgentPersonaKey;
  /** Free-text persona prompt — used (and required) when `persona === "custom"`. */
  customPersona?: string;
}

/** A perspective seat. Bound to an entity (character/location/artifact) or the
 *  general narrator vantage. The world itself is a seat (a location/Central-Bank
 *  perspective produces external events). */
export type PerspectiveKind = "character" | "location" | "artifact" | "narrator";

export interface Perspective {
  id: string;
  kind: PerspectiveKind;
  /** Entity id for character/location/artifact kinds; omitted for narrator. */
  entityRef?: string;
  label?: string;
  /** Members attached to this perspective. Empty → AI/inferred. */
  memberIds?: string[];
  /** An AI player attached to this perspective — set when an agent (rather than
   *  a member) drives its streams. */
  agentId?: string;
}

export type StreamState = "open" | "committed" | "closed";

/** One prior contributed to a Stream — a dated observation that doubles as a
 *  belief-log node (a thread-log node, but for a stream). The prose `text` is
 *  the member's intuition; the `updates` move the stream's stance. The first
 *  prior on a stream is the seeding intuition the stance was opened from. */
export interface StreamPrior {
  id: string;
  /** Member id; omitted for GM/system/AI notes. */
  authorId?: string;
  /** The prose intuition / observation. */
  text: string;
  at: number;
  // ── Belief mechanics (mirrors ThreadLogNode) ──────────────────────────────
  /** Per-outcome evidence this prior emits, log-odds shift in [-4, +4]. */
  updates?: OutcomeEvidence[];
  /** Which of the nine perceptual primitives this prior reads as. */
  logType?: ThreadLogNodeType;
  /** Change to the stance's attention (volume) from this prior. */
  volumeDelta?: number;
  /** Normalized KL info-gain stamped when the prior was applied (UI/analytics). */
  infoGain?: number;
  /** Stance volume immediately before this prior was applied. */
  preVolume?: number;
  /** Outcomes this prior introduced to the stream (mirrors ThreadLogNode). */
  addedOutcomes?: string[];
}

/** A Stream — a member's bearing on an open QUESTION, gathered over time
 *  (replaces the old Issue + Request). A Stream is a thread: it shares the Fate
 *  Thread mechanics (outcomes + a Stance of logits/volume/volatility evolved by
 *  evidence) but is owned by one member against one perspective, and its log
 *  nodes are its `priors`. Opened with an AI-instantiated stance seeded from the
 *  member's initial intuition (prior #1). Many streams can share one question —
 *  each a perspective's independently-seeded stance — forming a local market.
 *  Open while gathering, committed when folded into a Merge, or closed. */
export interface Stream {
  id: string;
  perspectiveId: string;
  /** The contributing member; omitted for AI/inferred streams. */
  memberId?: string;
  /** The AI player driving this stream — set instead of `memberId` when an
   *  agent (rather than a real member) thinks about this perspective's priors. */
  agentId?: string;
  /** The open question this stream holds a stance on. */
  title: string;
  /** Named outcomes the stance distributes over (length ≥ 2). Optional only
   *  for legacy streams opened before the belief model; always set now. */
  outcomes?: string[];
  /** The member's bearing over the outcomes — logits/volume/volatility. */
  stance?: Stance;
  /** Opening logits the stance was seeded with (the base for trajectory
   *  replay); derived from the AI's priorProbs at open. */
  openingLogits?: number[];
  /** Structural distance to resolution; scales evidence magnitude. */
  horizon?: ThreadHorizon;
  state: StreamState;
  /** When the stance committed to a winning outcome (soft closure). */
  closedAt?: number;
  /** Index into `outcomes` of the leading winner; set on soft closure. */
  closeOutcome?: number;
  /** How decisive the resolution was at closure, [0,1] (mirrors Thread). */
  resolutionQuality?: number;
  /** Priors gathered into this stream over time — the belief log. */
  priors: StreamPrior[];
  /** True when priors were AI-inferred (unattended / external seat). */
  inferred?: boolean;
  /** Origin branch — the branch this stream was opened on. Streams/merges are
   *  global storage but branch-SCOPED for visibility (ownership model): a
   *  stream is visible on its origin branch and every descendant, i.e. when its
   *  origin is on the active branch's ancestor lineage. Undefined = legacy /
   *  pre-branch-scoping stream, treated as visible everywhere. */
  branchId?: string;
  createdAt: number;
  updatedAt: number;
}

/** The committed final outcome(s) for one stream at a merge — the GM's call at
 *  the commit review. Defaults to the stream's leading stance; `overridden`
 *  flags a GM override of that lean.
 *
 *  Usually a SINGLE clean outcome (`outcome`). Optionally MULTI-resolution: the
 *  GM may commit a question to more than one outcome (`outcomes`, length ≥ 2)
 *  when the resolution is genuinely plural — left to the user's discretion. The
 *  generation LLM decides how to reconcile a multi-outcome set (both true, a
 *  blend, a sequence, a partial) if it makes sense. */
export interface MergeResolution {
  /** The primary committed outcome (a member of the stream's `outcomes`).
   *  Always set — the headline outcome even when the resolution is multi. */
  outcome: string;
  /** The FULL committed set when multi-resolution, including `outcome` as its
   *  first entry (length ≥ 2). Omitted / empty = a single clean resolution
   *  (the common case — read `outcome`). Use `resolutionOutcomes` to read the
   *  set uniformly across both shapes. */
  outcomes?: string[];
  /** True when the committed outcome(s) diverge from the stance's leader. */
  overridden?: boolean;
}

/** A Merge — a set of committed Streams folded together to extend continuity
 *  (replaces the old Session). The GM commits each stream with a FINAL outcome
 *  at a review step; streams are kept separate (not interleaved), and the merge
 *  records each stream's committed resolution. */
export interface Merge {
  id: string;
  label?: string;
  /** When the commit happened. */
  at: number;
  /** The committed streams folded together. */
  streamIds: string[];
  /** Per-stream final outcome assigned at the commit review (keyed by stream id). */
  resolutions?: Record<string, MergeResolution>;
  /** Optional note describing how continuity was extended. */
  summary?: string;
  /** Origin branch — the branch this merge was committed on (the branch whose
   *  generation folded it in). Branch-scoped for visibility like Stream.branchId:
   *  visible on its origin branch and descendants. Undefined = legacy, visible
   *  everywhere. */
  branchId?: string;
}

/** A merge proposed at the commit review but not yet persisted. Carried into
 *  the Generate panel as the continuity basis; a real Merge (with a minted id +
 *  timestamp) is created and stamped onto the produced arc / world-build only
 *  once a generation extends the narrative with it. Every Merge is therefore
 *  consumed-by-construction. */
export type ProposedMerge = Omit<Merge, "id" | "at">;

export type NarrativeState = {
  id: string;
  title: string;
  description: string;
  /** Derived cache — recomputed from world-build manifests + scene deltas via resolvedEntryKeys */
  characters: Record<string, Character>;
  /** Derived cache — recomputed from world-build manifests + scene deltas via resolvedEntryKeys */
  locations: Record<string, Location>;
  /** Derived cache — recomputed from world-build manifests + scene deltas via resolvedEntryKeys */
  threads: Record<string, Thread>;
  /** Derived cache — recomputed from world-build manifests + scene ownership deltas */
  artifacts: Record<string, Artifact>;
  arcs: Record<string, Arc>;
  scenes: Record<string, Scene>;
  worldBuilds: Record<string, WorldBuild>;
  branches: Record<string, Branch>;
  /** Derived cache — recomputed from world-build manifests + scene deltas via resolvedEntryKeys */
  relationships: RelationshipEdge[];
  /** Derived cache — cumulative system knowledge graph built from world-build manifests + scene deltas */
  systemGraph: SystemGraph;
  worldSummary: string;
  /** Authorial prose profile — voice, rhythm, and beat transition patterns for prose generation */
  proseProfile?: ProseProfile;
  /** User-saved prose profiles, narrative-scoped. The active profile is mirrored
   *  in `proseProfile`; this is the library for one-click switching. */
  savedProseProfiles?: SavedProseProfile[];
  /** User-defined regions — sets of arcs. Used by the slide dropdown to offer
   *  scoped ("quarterly") decks alongside the full-narrative deck; generic
   *  enough to drive other range-based features later. */
  regions?: Region[];
  coverImageUrl?: ImageRef;
  /** Style directive appended to all image generation prompts for visual consistency */
  imageStyle?: string;
  /** Story-level settings that guide generation (POV, tone, pacing, etc.) */
  storySettings?: StorySettings;
  /** Chat threads keyed by thread ID — persisted with the narrative */
  chatThreads?: Record<string, ChatThread>;
  /** Branch Chat threads — multi-branch analytical sessions, persisted
   *  with the narrative so prior cross-branch analysis can be revisited. */
  branchChatThreads?: Record<string, BranchChatThread>;
  /** Notes keyed by note ID — persisted with the narrative */
  priors?: Record<string, Prior>;
  /** Location maps keyed by map ID — Replicate-rendered images of location
   *  clusters (connected components of the location parent/child graph). */
  boards?: Record<string, Board>;
  /** Branch evaluations keyed by branch ID — most recent eval per branch */
  structureReviews?: Record<string, StructureReview>;
  /** Prose evaluations keyed by branch ID — most recent prose eval per branch */
  proseEvaluations?: Record<string, ProseEvaluation>;
  /** Plan evaluations keyed by branch ID — most recent plan eval per branch */
  planEvaluations?: Record<string, PlanEvaluation>;
  /** Paradigm — one of the six canonical world-shapes (fiction / non-fiction /
   *  simulation / analysis / paper / essay). Set at creation (wizard or text
   *  analysis); user can change post-hoc via the Patterns modal. Drives world
   *  generation, scene generation, world expansion. */
  paradigm?: NarrativeParadigm;
  /** Detected primary genre (fantasy, sci-fi, thriller, romance, horror, mystery, literary, etc.) */
  genre?: string;
  /** Detected specific subgenre (progression fantasy, space opera, cozy mystery, dark romance, LitRPG, xianxia, etc.) */
  subgenre?: string;
  /** Positive patterns — commandments defining what makes this series good (used by Orchestrator agent) */
  patterns?: string[];
  /** Anti-patterns — commandments defining what to avoid (used by Adversarial agent) */
  antiPatterns?: string[];
  /** Research surveys — one question across many respondents; see Survey types below. */
  surveys?: Record<string, Survey>;
  /** Research interviews — many questions for one subject; see Interview types below. */
  interviews?: Record<string, Interview>;
  /** Arc-anchored causal maps. Each entry hosts a reasoning graph
   *  attached to an arc. An arc may have many maps; the canvas
   *  cycles between them. Maps come from two sources: (a) the user
   *  explicitly creates one via the sidebar composer, or (b) the auto-mode
   *  coordination plan saves the CRG it built for that arc. */
  maps?: Record<string, ReasoningMap>;
  /**
   * Modes — historical collection of working models of reality. Keyed
   * by mode id. Immutable once stored; new phase graphs are added
   * (optionally seeded from an existing one), never mutated. Arcs reference
   * these by id. Empty / undefined = no phase graph has ever been generated.
   */
  phaseGraphs?: Record<string, Phase>;
  /**
   * Id of the currently-active phase graph that downstream generation reads
   * from. Undefined = no active phase graph (generation falls back to a
   * historical viewpoint of the narrative context). Setting / clearing this
   * field is the only mutation users perform on mode state.
   */
  currentPhaseGraphId?: string;
  /**
   * Canon branch — the one branch this world view treats as its OFFICIAL
   * record. Separate from `activeBranchId` (the branch the operator is
   * currently viewing / editing): canon is what other surfaces consume as
   * the world view's objective reality (landing-page cards, dashboard
   * cards, exported summaries), independent of where the operator's
   * cursor is right now. Defaults to the first-created branch when unset;
   * users can promote any other branch via the BranchModal.
   */
  canonBranchId?: string;
  /** Source files that contributed to this narrative — the corpus that
   *  created it (`mode: 'create'`) plus any later extension files
   *  (`mode: 'extend'`). The raw source text lives in IndexedDB as a
   *  text asset (`contentRef`); this dict just holds metadata. */
  files?: Record<string, SourceFile>;
  /** A0 — room members (exactly one holds the GM role). */
  members?: Record<string, Member>;
  /** A0 — AI players. Each carries a persona that can operate a perspective as
   *  an alternative to a real member (see `Agent`). */
  agents?: Record<string, Agent>;
  /** A0 — perspective seats (entity or narrator vantages, with their threads). */
  perspectives?: Record<string, Perspective>;
  /** A0 — streams: player contributions against a perspective. */
  streams?: Record<string, Stream>;
  /** A0 — merges: committed streams collapsed together to extend continuity. */
  merges?: Record<string, Merge>;
  /** Curriculum / knowledge tree — Topic entities the question bank is
   *  organised under. Keyed by topic id; parent chains form the tree. */
  topics?: Record<string, Topic>;
  /** Continual learning coverage — per-member recall state over the question
   *  bank. Opt-in/additive; populated as members take quizzes. */
  learningProgress?: LearningProgress;
  createdAt: number;
  updatedAt: number;
};

/** A source-text file attached to a narrative. Two flavours:
 *  - `mode: 'create'` — the corpus that birthed the world; born committed.
 *  - `mode: 'extend'` — uploaded later to extend the world. Walks the
 *    full lifecycle: staged → converting → ready → committed.
 *
 *  The raw text body lives in IndexedDB (contentRef); the extracted
 *  narrative slice (post-conversion, pre-commit) lives in IndexedDB too
 *  (extractedRef, JSON-serialised). The SourceFile record itself is
 *  pure metadata. */
export type SourceFile = {
  id: string;
  name: string;
  mode: 'create' | 'extend';
  /** IndexedDB asset id ("text_xxx") pointing at the raw source body. */
  contentRef: string;
  charCount: number;
  wordCount: number;
  createdAt: number;

  /** Lifecycle status. `committed` for creation files at stamp time;
   *  walks the full path for extension files. */
  status: 'staged' | 'converting' | 'ready' | 'committed' | 'failed';

  /** Set while status === 'converting' — points at the world-scoped
   *  AnalysisJob driving the pipeline. Cleared once the job completes
   *  (the job itself is removed from state.analysisJobs at that point). */
  analysisJobId?: string;

  /** Set once status === 'ready' — IndexedDB asset id ("text_xxx")
   *  holding the JSON-serialised extracted NarrativeState slice. */
  extractedRef?: string;

  /** Error message when status === 'failed'. */
  error?: string;

  /** Provenance discriminator. Absence (or 'analysis') = file produced
   *  by manual paste / file upload through the standard composer flow.
   *  'daily-log' = file produced by the Driver workspace compacting a
   *  set of Log entries through the synthesis step; conversion adds the
   *  continuation-first thread alignment pass for this class. */
  source?: 'analysis' | 'daily-log';
};

// ── Surveys ───────────────────────────────────────────────────────────────────
// Query the narrative's entities in parallel using their world-graph continuity
// (same mechanism as the Character persona chat). Each respondent answers in
// character; aggregates become research infographics for the author.

export type SurveyQuestionType =
  | "binary"   // yes / no
  | "likert"   // 1..scale — strongly disagree → strongly agree
  | "estimate" // numeric guess, optional unit
  | "choice"   // pick one of a named set
  | "open";    // short free-text response

export type SurveyRespondentKind = "character" | "location" | "artifact";

export type SurveyRespondentFilter = {
  kinds: SurveyRespondentKind[];
  /** Character relevance — anchor / recurring / transient. Empty = all. */
  characterRoles?: CharacterRole[];
  /** Location prominence — domain / place / margin. Empty = all. */
  locationProminence?: Location["prominence"][];
  /** Artifact significance — key / notable / minor. Empty = all. */
  artifactSignificance?: Artifact["significance"][];
};

export type SurveyConfig = {
  /** Likert scale size (3, 5, or 7). Defaults to 5. */
  scale?: 3 | 5 | 7;
  /** Choice options (for questionType === "choice"). */
  options?: string[];
  /** Unit suffix for estimate questions (e.g. "years", "li", "gold"). */
  unit?: string;
};

export type SurveyResponse = {
  respondentId: string;
  respondentKind: SurveyRespondentKind;
  /** The raw parsed answer, shape depends on questionType. */
  answer:
    | { type: "binary"; value: boolean }
    | { type: "likert"; value: number } // 1..scale
    | { type: "estimate"; value: number }
    | { type: "choice"; value: string }
    | { type: "open"; value: string };
  /** Short first-person reasoning the respondent offered, ≤ 2 sentences. */
  reasoning: string;
  timestamp: number;
  /** Error captured when this respondent's call failed — response retained so UI shows coverage. */
  error?: string;
};

export type SurveyStatus = "draft" | "running" | "complete" | "error";

export type Survey = {
  id: string;
  question: string;
  questionType: SurveyQuestionType;
  config?: SurveyConfig;
  respondentFilter: SurveyRespondentFilter;
  responses: Record<string, SurveyResponse>;
  status: SurveyStatus;
  /** Populated while status === 'running'. */
  progress?: { completed: number; total: number };
  /** Captured if the whole run halts (e.g. FatalApiError from credits). */
  error?: string;
  /**
   * Free-form category tag (e.g. "Trust", "Knowledge", "Predictions"). Used
   * to group surveys in the sidebar and infographic dashboards. Author-defined.
   */
  category?: string;
  createdAt: number;
  updatedAt: number;
};

// ── Interviews ────────────────────────────────────────────────────────────
// One subject × N questions: a deep psychological / contextual probe of a
// single character, location, or artifact. Same persona engine as surveys
// but inverted axis — author learns about ONE entity in depth instead of
// the WHOLE world on one question.

export type InterviewSubjectKind = SurveyRespondentKind;

export type InterviewQuestion = {
  id: string;
  question: string;
  questionType: SurveyQuestionType;
  config?: SurveyConfig;
};

export type InterviewAnswer = {
  questionId: string;
  /** Mirrors SurveyResponse.answer shape — same parser used. */
  answer: SurveyResponse["answer"];
  reasoning: string;
  timestamp: number;
  error?: string;
};

export type Interview = {
  id: string;
  subjectId: string;
  subjectKind: InterviewSubjectKind;
  /** Optional title — defaults to "<subject name>: <category>" in UI. */
  title?: string;
  /** Author-defined category (e.g. "Personality", "Values", "Knowledge Audit"). */
  category?: string;
  /** Ordered question batch — composer builds this; runner asks each in parallel. */
  questions: InterviewQuestion[];
  /** Indexed by questionId. */
  answers: Record<string, InterviewAnswer>;
  status: SurveyStatus;
  progress?: { completed: number; total: number };
  error?: string;
  createdAt: number;
  updatedAt: number;
};

/** Arc-anchored causal investigation — a reasoning graph attached to an arc,
 *  optionally steered by a user-provided direction. Multiple maps
 *  per arc are supported; the canvas cycles between them. The graph can be
 *  copied back into the GeneratePanel as guidance for subsequent generation.
 *
 *  Two creation paths feed this:
 *    - User opens the sidebar composer and runs one against an arc.
 *    - Auto-mode coordination plan generates a CRG for an arc and saves the
 *      result here.
 */
export type ReasoningMap = {
  id: string;
  /** Host arc id. An arc may have many maps. */
  arcId: string;
  /** The reasoning graph this investigation produced. Reuses the same
   *  snapshot shape as the legacy per-arc CRG so visualisation is shared. */
  graph: ReasoningGraphSnapshot;
  /** Direction prompt that steered the investigation — either the user's
   *  composer input, or the coordination plan directive that drove
   *  auto-generation. */
  direction: string;
  /** Where the investigation came from. */
  source: "manual" | "coordination-plan";
  /** Optional user-set label. Defaults to a derived title in UI. */
  title?: string;
  /** Engine settings the graph was built under. */
  settings?: {
    thinkingResource?: "fate" | "world" | "system" | "chaos" | "freeform";
    thinkingStyle?: "freeform" | "divergent" | "deduction" | "abduction" | "induction";
    networkBias?: "inside" | "outside" | "neutral";
  };
  createdAt: number;
  updatedAt: number;
};

// ── Game Theory Analysis (opt-in, post-hoc) ───────────────────────────────────
// Every consequential moment has a SHAPE — the full space of choices each
// party could have made, and the consequence of every pairing. What
// actually happened is one cell in that space. The shape names how stake
// CAN move between agents; the realised cell names how it DID move; the
// gap (arcCost) names what was left on the table.
//
// The shape exists independent of who realises a path through it: in
// fiction the author traces one, in argument the writer traces one, in
// simulation the rules and priors trace one, in analysis reality already
// traced one. ELO scores the agents in the world — never the author,
// rules, or analyst. They select; only the agents compete.

/** Dimension along which both players' actions are organised.
 *
 *  SCOPE: Interpersonal strategic beats — decisions between two (or more)
 *  agentic parties. Internal beats (self vs self) are out of scope.
 */
export type ActionAxis =
  // — Information & self-presentation —
  | "information"      // reveal ↔ conceal (facts about the world)
  | "identity"         // claim ↔ disown (who one is)

  // — Stance toward other party —
  | "trust"            // extend ↔ guard (individual vulnerability)
  | "alliance"         // ally ↔ separate (factional / group)
  | "status"           // assert ↔ defer (relative rank)

  // — Force & magnitude within interaction —
  | "pressure"         // press ↔ yield (intensity; absorbs control + confrontation)
  | "stakes"           // escalate ↔ deescalate (magnitude of consequence)

  // — Resource & obligation flow —
  | "resources"        // take ↔ give (physical transfer of value)
  | "obligation"       // incur ↔ discharge (debt / favor that survives transfer)

  // — Self-binding & tempo —
  | "commitment"       // commit ↔ withdraw / hedge (incl. moral — binding to a principle)
  | "timing";          // act ↔ wait

/** Strategic shape of the beat. The shape names how stake CAN move; the
 *  realised cell names how it DID move. Compressed from 19 — battle-of-sexes
 *  folds into coordination, cheap-talk into signaling, pure-opposition
 *  drops (rare, usually zero-sum in disguise), anti-coordination renamed
 *  to divergence. */
export type GameType =
  // — Symmetric-info preference structures —
  | "coordination"       // both want to align (incl. battle-of-sexes flavour)
  | "stag-hunt"          // coordination with payoff-dominant vs risk-dominant trade
  | "dilemma"            // mutual cooperation pareto-best but defection pays unilaterally
  | "chicken"            // mutual yield vs mutual collision (incl. war-of-attrition)
  | "divergence"         // both want to diverge (renamed anti-coordination)
  | "zero-sum"           // grid sums to zero — any gain matched by equal loss

  // — Asymmetric-info structures —
  | "signaling"          // informed party reveals type via costly action (incl. cheap-talk when costly enough)
  | "screening"          // uninformed party designs mechanism to sort agents by type
  | "principal-agent"    // delegation with hidden action (both required — task handed off AND execution opaque)
  | "stealth"            // covert action vs unaware observer (no delegation; observer's move is attention)

  // — Mechanism / structural —
  | "stackelberg"        // sequential commit-then-respond (leader visible, follower best-responds)
  | "bargaining"         // offer / counter / accept rounds (incl. one-shot ultimatum)
  | "commitment-game"    // credibility of self-binding promise IS the crux

  // — Multi-party —
  | "contest"            // n-player rank-ordered competition for a prize
  | "collective-action"  // n-player threshold contribution with free-rider dynamics

  // — Degenerate —
  | "trivial";           // no real strategic content

/** Intuitive explanation for each action axis — phrased as the question the
 *  axis asks of the beat. Both players' actions live on the SAME axis. */
export const ACTION_AXIS_LABELS: Record<ActionAxis, string> = {
  information:   "reveal ↔ conceal — what facts about the world does each side expose or hide?",
  identity:      "claim ↔ disown — do I assert who I am, or distance myself from it?",
  trust:         "extend ↔ guard — do I lower my defenses, or keep them up?",
  alliance:      "ally ↔ separate — are we on the same side going forward, or not?",
  status:        "assert ↔ defer — do I push for the higher position, or yield rank?",
  pressure:      "press ↔ yield — how much force am I applying, or absorbing? (Absorbs control: bind/release; and confrontation: engage/evade.)",
  stakes:        "escalate ↔ deescalate — am I raising or lowering what's on the line?",
  resources:     "take ↔ give — who ends up holding the resources / lives / knowledge?",
  obligation:    "incur ↔ discharge — am I taking on a debt/favor, or paying it off? (Distinct from resources: the owed-ness that survives the transfer.)",
  commitment:    "commit ↔ withdraw / hedge — am I binding myself, or keeping options open? (Absorbs moral: committing to a principle is moral self-binding.)",
  timing:        "act ↔ wait — do I move now, or hold and watch?",
};

/** Strategic shape of the beat — how stake CAN move. One concrete hint per
 *  line so the analyser reaches for the SHAPE, not the surface topic. */
export const GAME_TYPE_LABELS: Record<GameType, string> = {
  "coordination":      "Both want to end up in the same place. Stake moves together when actions match. Absorbs battle-of-sexes: if both want to meet but prefer different focal points, still coordination.",
  "stag-hunt":         "Coordination with a trust gate. Team up for a big shared prize, or play it safe alone. Payoff-dominant Nash exists but is risk-dominated by the safe play.",
  "dilemma":           "Mutual cooperation would pareto-dominate Nash, but each has a private incentive to defect — prisoner's-dilemma shape. Three structural facts must hold; see procedural gate.",
  "chicken":           "Both want the other to yield. If neither does, both crash. Mutual yielding is acceptable; the question is who blinks. Includes war-of-attrition.",
  "divergence":        "BOTH players actively want to differ from each other on a shared axis. If only one wants to diverge and the other prefers alignment (sneak vs guard), this is stealth or zero-sum, not divergence.",
  "zero-sum":          "The grid literally sums to zero in every cell. Any +X for one is -X for the other on a SHARED currency. If any cell leaves both positive or both negative, the beat is not zero-sum.",
  "signaling":         "Informed party reveals their type through a costly, hard-to-fake action. The signal is credible because weaker types couldn't afford to send it. Absorbs cheap-talk when the talk itself shapes the beat.",
  "screening":         "Uninformed party DESIGNS a mechanism that sorts agents by type — evaluations, tests, auctions, loyalty trials, ultimatum-framed challenges. Distinct from signaling (informed party VOLUNTEERS) and principal-agent (requires delegation).",
  "principal-agent":   "Requires BOTH (a) explicit delegation — one party hands a task to another — AND (b) hidden action — the principal can't directly observe what the agent does. If either is missing, it's something else. Not a sink for asymmetric-info beats.",
  "stealth":           "One player acts covertly; the other's move is passive attention allocation (scrutinise vs overlook), not active counter-action. Concealed maneuvers, surveillance, information theft — a player vs. an unaware or distracted counterpart. NO delegation (that's principal-agent).",
  "stackelberg":       "One moves first and commits visibly; the other watches, then responds. First-mover advantage or trap.",
  "bargaining":        "Offer → counter → accept/reject rounds. Each side strategising over when to concede. The grid size signals round count; one-shot ultimatum is the degenerate case.",
  "commitment-game":   "Whether one party can credibly bind themselves IS the game (vow, burned bridge, hostage, tattoo, contract). The believability of the promise is the whole strategic content.",
  "contest":           "Multiple players compete for a rank-ordered prize — tournament, auction, scramble for status.",
  "collective-action": "A group needs enough contributors to clear a threshold. Each is tempted to free-ride on others' effort.",
  "trivial":           "No real strategic content — a beat where the choice is in name only. Use sparingly.",
};

/** A single labelled action in a player's menu. */
export type PlayerAction = {
  /** 2-5 words naming the concrete action, e.g. "feigns C-grade aperture". */
  name: string;
};

/** One outcome cell.
 *  - duel (2-player): the world-state if A takes aAction and B takes bAction.
 *  - solo (1-player): one option in the decider's row — bActionName / stakeDeltaB
 *    omitted; stakeDeltaA is the immediate outcome if A takes this option. */
export type GameOutcome = {
  /** Name of A's action — must match an entry in playerAActions[].name. */
  aActionName: string;
  /** Name of B's action — must match an entry in playerBActions[].name.
   *  Omitted for solo decisions (no opponent). */
  bActionName?: string;
  /** 5-15 words narrating what happens at this cell. */
  description: string;
  /** A's stake delta: -4 (catastrophic for A) to +4 (ideal for A). */
  stakeDeltaA: number;
  /** B's stake delta: -4 to +4. Omitted for solo decisions. */
  stakeDeltaB?: number;
};

/** A strategic beat: the outcome space around a single decision.
 *
 *  Two flavours, discriminated by `kind`:
 *  - "duel" (default, 2-player): a full NxM matrix — A and B each pick from a
 *    menu, every pairing has a cell with both players' stake deltas.
 *  - "solo" (1-player): a ROW, not a matrix — one decider faces a menu of
 *    options under uncertainty (reality is the other seat). `playerB*` and
 *    `realizedBAction` are absent, `playerBActions` is empty, and `outcomes`
 *    holds one cell per option (keyed by aActionName, stakeDeltaA only). */
export type BeatGame = {
  /** Which beat in the scene's BeatPlan.beats this game corresponds to. */
  beatIndex: number;
  /** Short excerpt of the beat for context. */
  beatExcerpt: string;

  /** "duel" (2-player game, default when absent) or "solo" (1-player decision). */
  kind?: "duel" | "solo";

  /** Classical strategic frame of the beat (duel). For solo, advisory only. */
  gameType: GameType;
  /** Dimension the action(s) are organised along. */
  actionAxis: ActionAxis;

  // ── Player A (the decider) ───────────────────────────────────────────
  playerAId: string;
  playerAName: string;
  /** A's action / option menu, 1-4 entries. For solo, the row of options. */
  playerAActions: PlayerAction[];

  // ── Player B (absent for solo) ───────────────────────────────────────
  playerBId?: string;
  playerBName?: string;
  /** Empty array for solo decisions. */
  playerBActions: PlayerAction[];

  /**
   * duel: every (A, B) action pairing — exactly playerAActions.length *
   * playerBActions.length cells, looked up by action-name pair.
   * solo: one cell per option in playerAActions, looked up by aActionName.
   */
  outcomes: GameOutcome[];

  /** A's action name in the realized outcome (must match an A menu entry). */
  realizedAAction: string;
  /** B's action name in the realized outcome. Absent for solo. */
  realizedBAction?: string;

  /** One sentence explaining why the authored beat landed on the realized cell. */
  rationale: string;
};

/** Full game-theoretic analysis for a single scene. */
export type SceneGameAnalysis = {
  /** Sequential games extracted from the scene's beats — order matters. */
  games: BeatGame[];
  /** When this analysis was generated (ms since epoch). */
  generatedAt: number;
  /** Optional one-line summary of the scene's strategic shape. */
  summary?: string;
};

// ── Learning (Quiz) ────────────────────────────────────────────────────────
// A per-scene bank of multiple-choice questions testing the general concepts
// and ideas a reader should take from a scene. Purely additive (lives on
// scene.questions), context-aware of the wider world view, and tagged so the
// Learn surface can assemble quizzes scoped by tag, scene, arc, or the whole
// narrative.

/** Cognitive level a question targets — Bloom's Revised Taxonomy, ascending.
 *  remember (recall a fact) → understand (grasp a relationship/cause) →
 *  apply (use the idea in a new situation) → analyse (break down, compare,
 *  infer structure) → evaluate (judge, justify, critique) → create
 *  (synthesise something new from the material). */
export type BloomLevel =
  | "remember"
  | "understand"
  | "apply"
  | "analyse"
  | "evaluate"
  | "create";

export const BLOOM_LEVELS: BloomLevel[] = [
  "remember",
  "understand",
  "apply",
  "analyse",
  "evaluate",
  "create",
];

/** Independent difficulty rating — 7 bands from very-easy to very-hard.
 *  Orthogonal to Bloom level: a "remember" question can still be very-hard
 *  (an obscure detail) and a "create" question can be easy (an obvious
 *  synthesis). */
export type DifficultyBand =
  | "very-easy"
  | "easy"
  | "easy-medium"
  | "medium"
  | "medium-hard"
  | "hard"
  | "very-hard";

export const DIFFICULTY_BANDS: DifficultyBand[] = [
  "very-easy",
  "easy",
  "easy-medium",
  "medium",
  "medium-hard",
  "hard",
  "very-hard",
];

export type LearningQuestion = {
  id: string;
  /** Scene this question was extracted from. */
  sceneId: string;
  /** The question stem. */
  prompt: string;
  /** 2–6 answer options the reader chooses between. */
  options: string[];
  /** Index into `options` of the correct answer. */
  correctIndex: number;
  /** Why the correct answer is right — shown after the reader answers. */
  explanation?: string;
  /** The Topic this question is assigned to (Topic.id in NarrativeState.topics).
   *  Exactly one per question; reassignable. Undefined = untopiced (bucketed
   *  separately until placed in the tree). */
  topicId?: string;
  /** Cognitive level the question targets (Bloom's Revised Taxonomy). */
  bloom: BloomLevel;
  /** Independent difficulty rating (7 bands). */
  difficulty: DifficultyBand;
  /** ms since epoch when generated. */
  createdAt: number;
  /** Asset reference to this question's embedding (the embedded stem). Powers
   *  Expert search — semantic retrieval over the question bank, where matched
   *  questions' verified answers become the synthesis grounding. */
  embedding?: EmbeddingRef;
  /** ms epoch the embedding was generated. */
  embeddedAt?: number;
  /** Model used for the embedding (e.g. "text-embedding-3-small"). */
  embeddingModel?: string;
};

/** A node in the curriculum / knowledge tree. Topics are first-class entities
 *  (like characters/threads): questions are assigned to exactly one Topic, and
 *  the parent chain forms a re-organisable tree. A topic with `parentId: null`
 *  is a root. Re-parenting, renaming, merging, and deleting are all supported;
 *  new topics are generated/expanded as the question banks cover new fields. */
export type Topic = {
  id: string;
  name: string;
  /** Optional longer description, surfaced in the inspector. */
  description?: string;
  /** Parent topic id, or null for a root concept. */
  parentId: string | null;
  createdAt: number;
};

/** Scope a quiz is assembled over — drives the Learn surface's question pool.
 *  `"topic"` includes the chosen topic AND all its descendants. */
export type QuizScope = "scene" | "arc" | "topic" | "narrative";

// ── Learning coverage (continual, per-member) ───────────────────────────────
// A persisted, additive layer over the question bank tracking what each room
// member has seen and how well they know it. Powers spaced-repetition "focused
// review", coverage/mastery readouts, and weakest-concept targeting. Whoever
// sits down to quiz states which member they are; results record under that
// member. Like gameAnalysis it never mutates deltas — it lives alongside the
// bank.

/** Per-question recall state. The "understanding" signal is `strength` (an
 *  EWMA of correctness); `dueAt` drives spaced resurfacing. */
export type QuestionProgress = {
  /** Total attempts. */
  seen: number;
  /** Correct attempts. */
  correct: number;
  /** Consecutive-correct run (resets to 0 on a miss) — the Leitner box index. */
  streak: number;
  /** 0..1 EWMA of correctness, updated at each attempt — recall strength. */
  strength: number;
  /** ms epoch of the last attempt. */
  lastSeenAt: number;
  /** ms epoch this question should resurface for review. */
  dueAt: number;
};

/** One member's recall state, keyed by LearningQuestion id. */
export type MemberQuestionProgress = Record<string, QuestionProgress>;

/** Continual learning coverage for one world view, partitioned by member. */
export type LearningProgress = {
  /** memberId → (questionId → recall state). The special id `"solo"` is used
   *  on world views with no member roster so the feature still works. */
  byMember: Record<string, MemberQuestionProgress>;
  updatedAt: number;
};

/** Sentinel learner id for world views without a member roster. */
export const SOLO_LEARNER_ID = "solo";

/** Look up a timeline entry (scene or world build) by ID */
export function resolveEntry(
  n: NarrativeState,
  id: string,
): TimelineEntry | null {
  return n.scenes[id] ?? n.worldBuilds[id] ?? null;
}

export type NarrativeEntry = {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  sceneCount: number;
  coverThread: string;
  coverImageUrl?: ImageRef;
  /** Narrative shape classification key */
  shapeKey?: string;
  /** Narrative shape name for display */
  shapeName?: string;
  /** Narrative shape curve points [x,y] normalised 0-1 */
  shapeCurve?: [number, number][];
  /** Narrative archetype classification key */
  archetypeKey?: string;
  /** Narrative archetype name for display */
  archetypeName?: string;
  /** Overall force grade (0-100) */
  overallScore?: number;
  /** Narrative scale classification key */
  scaleKey?: string;
  /** Narrative scale name for display */
  scaleName?: string;
  /** World density classification key */
  densityKey?: string;
  /** World density name for display */
  densityName?: string;
};

// ── Story Settings ──────────────────────────────────────────────────────────

/** How many POV characters drive the narrative */
export type POVMode = "single" | "ensemble" | "free";

/** Which world commit to seed generations with */
export type WorldFocusMode = "latest" | "custom" | "none";

/** Reasoning effort level — controls how many thinking tokens the model uses before responding.
 *  Higher levels produce better structural decisions (causality, agency, convergence)
 *  at the cost of slower generation and higher token usage.
 *  Maps to OpenRouter's `reasoning.max_tokens` parameter. */
export type ReasoningLevel = "none" | "low" | "medium" | "high";

/** Max thinking tokens per reasoning level */
export const REASONING_BUDGETS: Record<ReasoningLevel, number> = {
  none: 0,
  low: 2048,
  medium: 8192,
  high: 24576,
};

/** Web search effort — enables OpenRouter's web plugin so the model can ground
 *  generation in up-to-date public information. Higher levels = more results
 *  retrieved per call, slower + more billed tokens. Defaults to 'none'.
 *  Maps to OpenRouter's web_search tool's `max_results` parameter. */
export type WebsearchLevel = "none" | "low" | "medium" | "high";

/** Max web-search results per individual search call (0 = plugin disabled).
 *  OpenRouter's web_search `max_results` parameter, applied per call. */
export const WEBSEARCH_MAX_RESULTS: Record<WebsearchLevel, number> = {
  none: 0,
  low: 3,
  medium: 5,
  high: 10,
};

/** Default cap on total results across all search calls in one request.
 *  Bounds cost / context size in agentic loops; configurable per story in
 *  Story Settings. Sized to fully load research-paradigm world generation
 *  with current data — the wizard's "Research mode" also lands here. */
export const WEBSEARCH_DEFAULT_MAX_TOTAL = 25;

/** Resolved websearch config — what the API layer attaches to a single
 *  generate call as OpenRouter web_search parameters. */
export type WebsearchConfig = {
  maxResults: number;
  maxTotalResults: number;
};

/** Output format for prose generation */
export type ProseFormat = "prose" | "screenplay" | "markdown";

/**
 * How a scene's beat plan is created.
 *
 * - "structure": forward generation. Plan is produced from scene structure
 *   (summary + deltas) via generateScenePlan; prose is then rendered from the
 *   plan. Current default flow.
 * - "prose": reverse engineering. Prose is rendered directly from scene
 *   structure without a pre-existing plan; the plan is then reverse-engineered
 *   from the generated prose via reverseEngineerScenePlan. Lets prose flow
 *   without the plan as a cage; costs an extra LLM call, and the plan becomes
 *   a record of what was written rather than a brief for what to write.
 */
export type PlanExtractionSource = "structure" | "prose";

/** Target archetype for force standards — what balance of forces the story aims for */
export type ArchetypeKey = "opus" | "series" | "atlas" | "chronicle" | "classic" | "stage" | "paper";

export type StorySettings = {
  /** How POV is distributed across the story */
  povMode: POVMode;
  /** Character IDs designated as POV characters (empty = use all anchors) */
  povCharacterIds: string[];
  /** High-level story direction / north star prompt for scene generation */
  storyDirection: string;
  /** High-level world direction / north star prompt for world expansion */
  worldDirection: string;
  /** Negative prompt — things the AI should avoid */
  storyConstraints: string;
  /** Target arc length in scenes */
  targetArcLength: number;
  /** Markov chain rhythm preset key (from MATRIX_PRESETS) */
  rhythmPreset: string;
  /** Prose voice/style the AI should mimic when writing */
  proseVoice: string;
  /** Guidance for how scene plans should be structured */
  planGuidance: string;
  /** Optional custom prompt for cover image generation */
  coverPrompt: string;
  /** World focus mode — which world commit to seed generations with */
  worldFocus: WorldFocusMode;
  /** Specific WorldBuild ID when worldFocus is 'custom' */
  worldFocusId?: string;
  /** Reasoning effort — how much thinking the model does before responding. Higher = better structural decisions, slower generation. */
  reasoningLevel: ReasoningLevel;
  /** Web search effort — controls OpenRouter web_search's per-call result
   *  count. 'none' disables the plugin entirely. Useful for analysis /
   *  paper / non-fiction paradigms; usually 'none' for pure fiction. */
  websearchLevel: WebsearchLevel;
  /** Cap on total search results across all search calls in one request.
   *  Bounds cost / context size in agentic loops. Ignored when
   *  websearchLevel is 'none'. */
  websearchMaxTotalResults: number;
  /** Beat profile preset key — selects a published work's beat/prose profile. Empty = default profile. */
  beatProfilePreset: string;
  /** Mechanism profile preset key — selects delivery mechanism distribution. Empty = default. */
  mechanismProfilePreset: string;
  /** Whether to use the pacing Markov chain (cube corners) for scene generation. */
  usePacingChain: boolean;
  /** Whether to use the beat profile Markov chain for plan generation. */
  useBeatChain: boolean;
  /** OpenAI TTS voice — one of: alloy, echo, fable, onyx, nova, shimmer */
  audioVoice: string;
  /** OpenAI TTS model — tts-1 (faster/cheaper) or tts-1-hd (higher quality) */
  audioModel: string;
  /** Output format for prose — standard fiction or screenplay format */
  proseFormat: ProseFormat;
  /**
   * How beat plans are created for scenes. "structure" (default) runs
   * structure → plan → prose. "prose" runs structure → prose → plan
   * reverse-engineered from prose. Applies to both manual generation and
   * auto flows.
   */
  planExtractionSource: PlanExtractionSource;
  /**
   * When true (default), storyDirection and storyConstraints are cleared
   * from this settings object after they guide a scene or CRG generation.
   * Prevents a directive from silently shaping every subsequent generation
   * without the user re-opting-in. Power users can toggle off to keep a
   * persistent north-star.
   */
  autoClearDirection: boolean;
  /**
   * When true (default), Search uses embedding-based vector search whenever
   * it's available (every scene on the branch has an embedded plan). When
   * false — or when vector search is unavailable — Search falls back to a
   * narrative-context search that reads the whole branch and answers from it
   * (slower, more token-expensive). Both modes attribute to database entities
   * in the same academic entity-ref citation style as chat.
   */
  vectorSearchEnabled: boolean;
  /**
   * Which search engine the Search surface uses. "vector" = embedding RAG over
   * the proposition bank; "expert" = embedding RAG over the curriculum question
   * bank (verified Q→A pairs ground the answer); "context" = full-branch
   * narrative-context read (always works, slower). Optional for backward
   * compatibility — read sites fall back to vectorSearchEnabled (true→"vector",
   * false→"context") via `resolveSearchMode`.
   */
  searchMode?: SearchMode;
  /**
   * Auto-mode configuration for this narrative. Per-story so each narrative
   * carries its own auto-engine behaviour (arc bounds, end conditions,
   * direction) and it travels with package export. Optional for backward
   * compatibility — read sites fall back to DEFAULT_AUTO_CONFIG.
   */
  autoConfig?: AutoConfig;
};

/** Default auto-mode configuration, used for new narratives and as the
 *  fallback when a narrative predates per-story autoConfig. Declared before
 *  DEFAULT_STORY_SETTINGS so the latter can embed it without a TDZ. */
export const DEFAULT_AUTO_CONFIG: AutoConfig = {
  endConditions: [{ type: "scene_count", target: 50 }],
  minArcLength: 2,
  maxArcLength: 5,
  direction: "",
  narrativeConstraints: "",
};

export const DEFAULT_STORY_SETTINGS: StorySettings = {
  povMode: "free",
  povCharacterIds: [],
  storyDirection: "",
  worldDirection: "",
  storyConstraints: "",
  targetArcLength: 4,
  rhythmPreset: "",
  proseVoice: "",
  planGuidance: "",
  coverPrompt: "",
  worldFocus: "none",
  reasoningLevel: "low",
  websearchLevel: "none",
  websearchMaxTotalResults: WEBSEARCH_DEFAULT_MAX_TOTAL,
  beatProfilePreset: "",
  mechanismProfilePreset: "",
  usePacingChain: false,
  useBeatChain: false,
  audioVoice: "onyx",
  audioModel: "tts-1",
  proseFormat: "prose",
  planExtractionSource: "structure",
  autoClearDirection: true,
  vectorSearchEnabled: true,
  searchMode: "vector",
  autoConfig: DEFAULT_AUTO_CONFIG,
};

/** Resolve the active search engine from settings, honouring the legacy
 *  `vectorSearchEnabled` boolean for narratives saved before `searchMode`
 *  existed (true→"vector", false→"context"). */
export function resolveSearchMode(
  settings: Pick<StorySettings, "searchMode" | "vectorSearchEnabled">,
): SearchMode {
  return settings.searchMode ?? (settings.vectorSearchEnabled ? "vector" : "context");
}

// ── Auto Mode ───────────────────────────────────────────────────────────────

export type AutoEndCondition =
  | { type: "scene_count"; target: number }
  | { type: "all_threads_resolved" }
  | { type: "arc_count"; target: number }
  | { type: "planning_complete" }
  | { type: "manual_stop" };

/** Auto actions map to story phases (setup → rising → midpoint → escalation → climax → resolution) */
export type AutoAction =
  | "setup"
  | "rising"
  | "midpoint"
  | "escalation"
  | "climax"
  | "resolution";

export type AutoConfig = {
  /** Stop conditions for the run (scene/arc count, planning-complete, manual). */
  endConditions: AutoEndCondition[];
  /** Arc-length bounds the engine samples between based on narrative pressure. */
  minArcLength: number;
  maxArcLength: number;
  /** High-level north star that steers every arc */
  direction: string;
  /** Constraints prompt — things the engine should avoid each arc. */
  narrativeConstraints: string;
};

export type AutoRunState = {
  isRunning: boolean;
  currentCycle: number;
  consecutiveFailures: number;
  /** Live status message shown in the control bar */
  statusMessage: string;
  totalScenesGenerated: number;
  totalWorldExpansions: number;
  startingSceneCount: number;
  startingArcCount: number;
  /** Live reasoning trace for the in-flight generation. Reset at the start
   *  of each cycle, appended to as tokens stream from the LLM. Surfaced by
   *  the auto-mode stream panel so the operator can check in on progress. */
  streamText: string;
};

// ── API Logs ─────────────────────────────────────────────────────────────────

export type ApiLogEntry = {
  id: string;
  timestamp: number;
  caller: string;
  /** AI model used for this call */
  model?: string;
  /** Narrative this call belongs to */
  narrativeId?: string;
  /** Analysis this call belongs to */
  analysisId?: string;
  status: "pending" | "success" | "error";
  durationMs: number | null;
  promptTokens: number;
  responseTokens: number | null;
  error: string | null;
  /** Truncated system prompt preview */
  systemPromptPreview?: string;
  /** Truncated prompt preview */
  promptPreview: string;
  /** Truncated response preview */
  responsePreview: string | null;
  /** Reasoning/thinking tokens used (if reasoning was enabled) */
  reasoningTokens?: number | null;
  /** Reasoning/thinking content from the model (if available) */
  reasoningContent?: string | null;
};

// ── System Logs ──────────────────────────────────────────────────────────────

export type SystemLogEntry = {
  id: string;
  timestamp: number;
  severity: "error" | "warning" | "info";
  category:
    | "network"
    | "timeout"
    | "parsing"
    | "validation"
    | "lifecycle"
    | "unknown";
  /** Human-readable message describing what happened */
  message: string;
  /** Raw error message from the exception (for errors/warnings) */
  errorMessage?: string;
  /** Stack trace if available (for errors) */
  errorStack?: string;
  /** Where the event occurred */
  source:
    | "auto-play"
    | "scenarios"
    | "manual-generation"
    | "analysis"
    | "world-expansion"
    | "direction-generation"
    | "prose-generation"
    | "plan-generation"
    | "pacing-sampling"
    | "beat-sampling"
    | "pressure-analysis"
    | "force-compute"
    | "reconstruction"
    | "review"
    | "embedding"
    | "search"
    | "persistence"
    | "asset"
    | "image-generation"
    | "audio-generation"
    | "ingest"
    | "api"
    | "mode"
    | "branch-chat"
    | "other";
  /** Current operation */
  operation?: string;
  /** Additional context */
  details?: Record<string, string | number | boolean | null | undefined>;
  /** Narrative this log belongs to */
  narrativeId?: string;
  /** Analysis this log belongs to */
  analysisId?: string;
};

// ── Text Analysis ────────────────────────────────────────────────────────────

export type AnalysisChunkResult = {
  chapterSummary: string;
  characters: {
    name: string;
    role: string;
    firstAppearance: boolean;
    imagePrompt?: string;
  }[];
  locations: {
    name: string;
    prominence?: string;
    parentName: string | null;
    description: string;
    imagePrompt?: string;
    tiedCharacterNames?: string[];
  }[];
  artifacts?: {
    name: string;
    significance: string;
    imagePrompt?: string;
    ownerName: string | null;
  }[];
  threads: {
    description: string;
    participantNames: string[];
    /** Named outcomes the stance distributes probability over. ≥2 entries. Default ["yes","no"]. */
    outcomes: string[];
    /** Structural distance from any scene to resolution. Drives evidence
     *  attenuation downstream. Undefined treated as 'medium'. */
    horizon?: ThreadHorizon;
    development: string;
    relatedThreadDescriptions?: string[];
  }[];
  scenes: {
    locationName: string;
    povName: string;
    participantNames: string[];
    events: string[];
    summary: string;
    sections: number[];
    prose?: string;
    threadDeltas: {
      threadDescription: string;
      logType: string;
      updates: { outcome: string; evidence: number }[];
      volumeDelta?: number;
      addOutcomes?: string[];
      rationale: string;
    }[];
    worldDeltas: {
      entityName: string;
      addedNodes: { content: string; type: string }[];
    }[];
    relationshipDeltas: {
      from: string;
      to: string;
      type: string;
      valenceDelta: number;
    }[];
    artifactUsages?: {
      artifactName: string;
      characterName: string | null;
      usage: string;
    }[];
    ownershipDeltas?: {
      artifactName: string;
      fromName: string;
      toName: string;
    }[];
    tieDeltas?: {
      locationName: string;
      characterName: string;
      action: "add" | "remove";
    }[];
    systemDeltas?: {
      addedNodes: { concept: string; type: string }[];
      addedEdges: {
        fromConcept: string;
        toConcept: string;
        relation: string;
      }[];
    };
    /** Time elapsed since the prior scene in the work — extracted from prose. */
    timeDelta?: TimeDelta | null;
    plan?: BeatPlan;
    beatProseMap?: BeatProseMap;
  }[];
  relationships: { from: string; to: string; type: string; valence: number }[];
};

/** Analysis pipeline phases */
export type AnalysisPhase =
  | "plans"
  | "structure"
  | "arcs"
  | "reconciliation"
  | "finalization"
  | "game-theory"
  | "summaries"
  | "variables"
  | "meta"
  | "assembly";

/** Meta-extraction output — produced by the meta-synthesis phase, consumed
 *  by assembly. Image style + prose profile + genre + pattern directives
 *  derived from a whole-work view of the chunk results. */
export type AnalysisMeta = {
  imageStyle?: string;
  proseProfile?: ProseProfile;
  planGuidance?: string;
  /** One of the nine canonical paradigms — drives the narrative's world-shape
   *  and every downstream generation pass once committed. */
  paradigm?: NarrativeParadigm;
  genre?: string;
  subgenre?: string;
  patterns?: string[];
  antiPatterns?: string[];
};

export type AnalysisJob = {
  id: string;
  title: string;
  sourceText: string;
  /** Run flavour:
   *  - 'create' (default) — assembles a brand-new narrative, lands in
   *    the global jobs list and the /analysis page.
   *  - 'extend' — world-scoped extension run. Filtered out of the
   *    /analysis page; on completion the result is stored on the
   *    linked SourceFile and the job is removed from in-memory state. */
  kind?: 'create' | 'extend';
  /** Set when `kind === 'extend'` — the narrative this run extends. */
  targetNarrativeId?: string;
  /** Set when `kind === 'extend'` — the SourceFile that owns this run.
   *  Used by the runner to flip the file's status (converting → ready
   *  → failed) and attach the extracted slice. */
  fileId?: string;
  /** Text split into numbered sections */
  chunks: { index: number; text: string; sectionCount: number }[];
  /** Per-chunk extraction results (phases 1-4 output, indexed parallel to chunks). */
  results: (AnalysisChunkResult | null)[];
  status: "pending" | "running" | "paused" | "completed" | "failed";
  /** Current pipeline phase — more reliable than parsing stream text */
  phase?: AnalysisPhase;
  currentChunkIndex: number;
  error?: string;
  /** The assembled narrative ID once complete */
  narrativeId?: string;
  /** Embedding progress tracking */
  embeddingProgress?: { completed: number; total: number };
  /** Opt-in beat plan extraction phase (Phase 2). When true, plans run
   *  and embeddings index the slice's beats + propositions for vector
   *  search / RAG. Default false — operator opts in via the Plans
   *  checkbox. Forced false when extractionMode === 'world' (no scenes
   *  → no plans). Positive phrasing for symmetry with
   *  runGameTheoryExtraction. */
  runPlanExtraction?: boolean;
  /** Opt-in per-scene game-theory decomposition pass. When true, after
   *  scene structure is extracted the runner kicks off the BeatGame
   *  analyser (axis classification, 2x2 payoff matrices, realized-cell
   *  tagging, Nash + ELO). Default false — opt-in via the Game theory
   *  checkbox. Forced false when extractionMode === 'world'. */
  runGameTheoryExtraction?: boolean;
  /** What the assembled NarrativeState should contain.
   *  - 'full' (default): scenes + arcs + per-batch world commits — ready to read.
   *  - 'world': one consolidated world commit only — a seed the operator
   *    builds their own continuity on top of. The scene-by-scene LLM
   *    extraction still runs (we need it to discover entities); only the
   *    assembled output differs. */
  extractionMode?: 'world' | 'full';
  // ── Cross-chunk pipeline outputs ──────────────────────────────────────────
  // Each field below is the canonical output of a discrete pipeline phase
  // that runs ONCE after per-chunk extraction completes. Assembly consumes
  // them deterministically; it makes no LLM calls of its own. Because the
  // outputs live on the job, a later "regenerate" (after the narrative is
  // deleted) re-runs assembly with zero LLM round-trips.
  //
  // Resumption: each field doubles as a completion marker. The runner
  // checks for the field's presence and skips the producing phase when set
  // — so a job can be paused mid-pipeline and resumed seamlessly without
  // re-running expensive LLM calls.
  /** Arc-grouping output (Phase 3). Skipped when present on resume. */
  arcGroups?: { name: string; directionVector?: string; worldState?: string; sceneIndices: number[] }[];
  /** Timestamp marker — reconciliation (Phase 4) completed at this time.
   *  Skipped on resume when set. */
  reconciledAt?: number;
  /** Timestamp marker — fate re-extract (Phase 5a) completed at this time.
   *  Skipped on resume when set. */
  fateReextractedAt?: number;
  /** Thread-dependency map — phase 5 output (Finalization). */
  threadDependencies?: Record<string, string[]>;
  /** Per-WorldBuild intent summaries, keyed by deterministic worldBuildId
   *  ("WB-<prefix>-001"). Phase output of WORLD_SUMMARIES. */
  worldBuildSummaries?: Record<string, string>;
  /** Whole-work meta — image style, prose profile, genre, patterns. Phase
   *  output of META_SYNTHESIS. */
  meta?: AnalysisMeta;
  createdAt: number;
  updatedAt: number;
};

// ── Narrative View State ─────────────────────────────────────────────────────
// UI state that is scoped to a specific narrative — swapped automatically when switching narratives.
// Persisted per-narrative in IndexedDB and restored when the narrative is loaded.

/**
 * NarrativeViewState — the per-narrative LOCAL UI cursor.
 *
 * This is NOT part of the world view document. It records where the operator is
 * *looking* — which surface is open, which scene/branch/inspector node is
 * selected, the current search, who's the active member, etc. It is always
 * EXCLUDED from package export / import: a teammate who imports the world view
 * gets the document (NarrativeState), not your cursor position or device-local
 * member selection.
 *
 * Lifetime today: SESSION-scoped. It resets to `defaultViewState` on every
 * narrative load / switch. (Per-narrative persistence helpers exist —
 * `saveViewState` / `loadViewState` in storage/persistence.ts, keyed
 * `viewState:${id}` — but are not currently wired into the store, so the cursor
 * does not yet survive a reload. Wire those in if a field here needs to.)
 *
 * Rule of thumb: if it travels with the world view to another person, it
 * belongs on NarrativeState (the document). If it's "where am I / what am I
 * looking at on this device", it belongs here.
 */
export type NarrativeViewState = {
  /** Which centre-view surface is active. Per-narrative UI selection — resets
   *  to the default on narrative switch alongside the rest of the view state. */
  graphViewMode: GraphViewMode;
  /** Tertiary toggle for the Belief surface (Mind → Belief): whether the
   *  dashboard reads the narrative's own Threads or the room's member-owned
   *  Streams. Both share the belief mechanics; the toggle swaps the source. */
  beliefSource: 'thread' | 'stream';
  activeBranchId: string | null;
  currentSceneIndex: number;
  inspectorContext: InspectorContext | null;
  inspectorHistory: InspectorContext[];
  selectedKnowledgeEntity: string | null;
  selectedThreadLog: string | null;
  /** Currently-selected investigation when the Map tab is active.
   *  The canvas falls back to the first investigation on the current scene
   *  if this id doesn't belong to the visible scene. */
  selectedMapId: string | null;
  currentSearchQuery: SearchQuery | null;
  currentResultIndex: number;
  searchFocusMode: boolean;
  activeChatThreadId: string | null;
  activeBranchChatThreadId: string | null;
  autoRunState: AutoRunState | null;
  isPlaying: boolean;
  /** The room's currently-active member on THIS device — presets the learner
   *  for Learn quizzes and the contributor for new streams. Set in the Members
   *  modal; null = no preset (manual choice each time). Device-local UI state,
   *  so it lives here (persisted, not exported) rather than on the document. */
  activeMemberId: string | null;
};

// ── App State ────────────────────────────────────────────────────────────────
export type InspectorContext =
  | { type: "scene"; sceneId: string }
  | { type: "character"; characterId: string }
  | { type: "location"; locationId: string }
  | { type: "thread"; threadId: string }
  | { type: "stream"; streamId: string }
  | { type: "streamPrior"; streamId: string; priorId: string }
  | { type: "merge"; mergeId: string }
  | { type: "arc"; arcId: string }
  | { type: "knowledge"; nodeId: string }
  | { type: "artifact"; artifactId: string }
  | { type: "world"; entityId: string; nodeId: string }
  | { type: "threadLog"; threadId: string; nodeId: string }
  | { type: "reasoning"; arcId?: string; worldBuildId?: string; nodeId: string }
  | { type: "mode"; phaseGraphId: string; nodeId: string }
  | { type: "topic"; topicId: string }
  | { type: "question"; sceneId: string; questionId: string };

export type WizardStep = "form" | "details" | "generate";

/** The nine canonical paradigms the engine supports. Each is an iconic
 *  text-form name; each maps to a distinct world-shape in the generation
 *  prompt:
 *  - fiction / non-fiction → populated-narrative (invented vs. observed)
 *  - simulation            → rule-governed-narrative (rules are load-bearing)
 *  - essay                 → singular-thinker (one named author working an argument)
 *  - panel                 → multi-thinker (AI agent team OR named human panel —
 *                            cooperative-with-disagreement, the work IS the contest
 *                            of minds becoming a synthesis)
 *  - atlas                 → reference-typology (entries / classification, system-only)
 *  - debate                → adversarial-contest (2+ parties locked in zero-sum stakes
 *                            under explicit rules of engagement)
 *  - record                → chronological-record (time-ordered log of events, real
 *                            or imagined; variable velocity — daily / monthly /
 *                            yearly / dynamic — entries replace scenes, the ORDERING
 *                            of time IS the structure)
 *  - game                  → multi-actor-contest (2+ actors take turns pursuing
 *                            contested stakes under enforceable rules; system-graph
 *                            IS the rule set, world tracks actors + resources +
 *                            positions, threads are open stakes; covers wargames,
 *                            tabletop RPGs, campaigns, market competition, trials,
 *                            anything multi-actor + turn-based + contested + ruled)
 *  Distinct on three axes: form of text (scenes / argument / entries / moves /
 *  log / turns), voice cardinality (single / multi / cast / chronicler /
 *  multi-actor), reality posture (invented / observed / rule-governed /
 *  typological / chronological / contested-under-rules).
 *  Defaults to 'fiction' in the wizard; the user can switch to any other paradigm. */
export type NarrativeParadigm =
  | 'fiction'
  | 'non-fiction'
  | 'simulation'
  | 'essay'
  | 'panel'
  | 'atlas'
  | 'debate'
  | 'record'
  | 'game';

export type WizardData = {
  title: string;
  premise: string;
  /** Optional seeding context — extra source material the user pastes in
   *  alongside the premise. Treated as authoritative reference material for
   *  the LLM to draw from when building the initial world. */
  sourceText?: string;
  /** Selected paradigm — steers world generation into one of the engine's
   *  canonical world-shapes. Defaults to 'fiction'. */
  paradigm: NarrativeParadigm;
  /** "Research mode" toggle for the wizard. When true, the world-generation
   *  call attaches OpenRouter's web plugin at the 'high' max-results-per-call
   *  tier with a saturating total-results cap (WEBSEARCH_RESEARCH_MAX_TOTAL).
   *  The new narrative is created with websearchLevel='high' and that same
   *  cap stored; Story Settings then lets the user dial level + cap down. */
  researchMode?: boolean;
  proseProfile?: ProseProfile;
  /** When true: generate world entities only — no introduction arc or scenes. Premise is treated as the full world plan document. */
  worldOnly?: boolean;
  /** Opening-arc scene count, set by the wizard slider. Bounded 2–8.
   *  Default 4 when unset. Ignored when `worldOnly` is true. */
  sceneCount?: number;
};

/**
 * Canvas view mode. Encodes BOTH the active domain (world / system /
 * threads / network) AND, for the four graph domains, the scope window
 * (scene / arc / full). The two axes are flattened into one union so a
 * single `state.viewState.graphViewMode` drives the topbar's domain tabs + scope
 * toggle and every graph view's rendering branch.
 *
 * Graph modes follow `{domain}-{scope}`:
 *   world-scene   / world-arc   / world-full   — Stage
 *   system-scene  / system-arc  / system-full  — SystemGraphView
 *   threads-scene / threads-arc / threads-full — ThreadGraphView
 *   threads-influence / streams-influence — SankeyView (Influence alluvial;
 *     Threads or Streams source, Full/Window span configured in-view)
 *   network-scene / network-arc / network-full — NetworkView
 *
 * Non-graph canvas modes (plan / prose / audio / decision / search /
 * vision / reasoning / belief / present / compass / mode) keep their
 * existing names — they have no scope dimension to encode.
 */
export type GraphViewMode =
  | "world-scene"
  | "world-arc"
  | "world-full"
  | "prose"
  | "plan"
  | "audio"
  | "decision"
  | "learning"
  | "system-scene"
  | "system-arc"
  | "system-full"
  | "threads-scene"
  | "threads-arc"
  | "threads-full"
  | "threads-influence"
  | "streams-influence"
  | "search"
  | "vision"
  | "streams"
  | "merges"
  | "map"
  | "network-scene"
  | "network-arc"
  | "network-full"
  | "belief"
  | "present"
  | "compass"
  | "mode"
  | "curriculum"
  | "curriculum-list"
  | "board";

// ── Chat Threads ──────────────────────────────────────────────────────────────
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Streamed reasoning tokens captured during the turn — assistant only.
   *  Persisted so the user can re-expand prior thinking after the fact. */
  reasoning?: string;
  /** Wall-clock duration of the turn in ms — labels collapsed reasoning. */
  durationMs?: number;
};

export type ChatThread = {
  id: string;
  name: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

// ── Branch Chat ───────────────────────────────────────────────────────────────
//
// Persisted multi-branch analytical chat. Distinct from chatThreads (which
// are single-branch / single-entity); branch-chat threads compare a SET of
// branches at scoped windows. The lab's foundation — v2 will reuse this
// thread shape as the substrate for controlled-variable experiments.

export type BranchChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Streamed reasoning tokens captured during the turn — assistant only. */
  reasoning?: string;
  /** Wall-clock duration of the turn in ms — labels collapsed reasoning. */
  durationMs?: number;
};

export type ScopeMode = "all" | "last" | "post-divergence" | "custom";

/** Serializable description of which entries to compare per branch. Re-resolves
 *  to a concrete BranchScope[] at use-time against the current branch
 *  sequences (so a thread keeps working after entries are added). */
export type ScopeState = {
  mode: ScopeMode;
  /** N for the "last" mode. */
  lastN: number;
  /** Custom ranges keyed by branch id. Used only when mode === 'custom'. */
  custom: Record<string, { start: number; end: number }>;
};

export type BranchChatThread = {
  id: string;
  name: string;
  messages: BranchChatMessage[];
  /** Branch IDs in the comparison set. */
  compareBranchIds: string[];
  /** Scope configuration — replays on thread re-open. */
  scopeState: ScopeState;
  createdAt: number;
  updatedAt: number;
};

// ── Driver entries (Daily Driver workspace) ───────────────────────────────────
//
// Daily-driver substrate. The Driver workspace gives the operator a queue
// they pour incoming material into — pasted briefings, links with quoted
// excerpts, one-line observations — without committing to structure.
// Entries pile up in the queue; a "compact" pass selects a subset and
// synthesises them into a markdown SourceFile, which then flows through
// the standard extend → reconcile → Apply pipeline. Entries are stateless:
// compaction is a read, the entry persists and can be re-included in
// later compacts.
export type Prior = {
  id: string;
  /** Short title — the operator's structural anchor for the entry. Shown
   *  on the queue card; used by the synthesiser as a grouping hint. May
   *  be empty (cards then fall back to a leading-line preview). */
  title?: string;
  /** Body. Operator paste targets this; structure is optional but the
   *  intent is "structured thought input", not stream-of-consciousness. */
  text: string;
  /** When the entry was captured (ms epoch). Used for grouping in the UI
   *  and for ordering within a compact. */
  capturedAt: number;
  /** Optional soft anchors typed inline with `#actor` / `#thread` style
   *  shortcuts. Synthesis treats them as hints, never requirements. */
  tags?: string[];
  /** SourceFile ids this entry has been folded into via a compact /
   *  synthesise pass. Non-empty = entry is locked (read-only — operator
   *  can no longer edit or delete it). Entry remains visible in the
   *  queue and is still selectable for inclusion in future compacts;
   *  re-use is allowed because synthesis is a read. Provenance for
   *  later auditing — "which file did this fragment end up in." */
  usedInFileIds?: string[];
};

export type AppState = {
  // App-level
  narratives: NarrativeEntry[];
  activeNarrativeId: string | null;
  activeNarrative: NarrativeState | null;
  /**
   * True once the initial IndexedDB + manifest load has fully settled.
   * Consumers use this to distinguish "narrative not yet loaded" from
   * "narrative genuinely doesn't exist" — e.g. the /narrative/[id] route
   * only redirects on unknown IDs after hydration is done.
   */
  hydrationComplete: boolean;
  analysisJobs: AnalysisJob[];

  // Narrative-scoped (swapped on narrative switch).
  //
  // Two homes, by what the data IS — not just where it's convenient:
  //  • activeNarrative (NarrativeState) — the DOCUMENT: content + config that
  //    travels with the world view on export/import (entities, scenes,
  //    branches, topics, questions, learningProgress, storySettings, members…).
  //  • viewState (NarrativeViewState) — the LOCAL UI CURSOR: where the operator
  //    is looking on this device (open surface, selected scene/branch/inspector,
  //    search, active member). Persisted per-narrative in IndexedDB but NOT
  //    exported. See the NarrativeViewState doc-comment for the rule of thumb.
  viewState: NarrativeViewState;
  /** Derived: Ordered timeline entry IDs (scenes + world builds) for the active branch */
  resolvedEntryKeys: string[];
};

export type BeatProfilePreset = {
  key: string;
  name: string;
  description: string;
  profile: ProseProfile;
  sampler?: BeatSampler;
};

export type MechanismProfilePreset = {
  key: string;
  name: string;
  description: string;
  distribution: Partial<Record<BeatMechanism, number>>;
};

// ─── Plan Candidates Types ──────────────────────────────────────────

/** A consistency violation — a proposition that contradicts prior established content */
export type ConsistencyViolation = {
  /** Beat index of the violating proposition */
  beatIndex: number;
  /** Proposition index within the beat */
  propIndex: number;
  /** The candidate proposition content */
  candidateContent: string;
  /** The prior proposition(s) it contradicts */
  priorContent: string[];
  /** Scene IDs of the prior propositions */
  priorSceneIds: string[];
  /** LLM verdict: true = violation confirmed */
  isViolation: boolean;
  /** Brief explanation from the LLM */
  explanation: string;
  /** Backward activation score that triggered the check */
  activationScore: number;
  /** Classification label of the candidate proposition */
  label: string;
};

export type PlanCandidate = {
  id: string;
  plan: BeatPlan;
  centroid: number[];
  similarityScore: number;
  beatScores: { beatIndex: number; score: number }[];
  timestamp: number;
  /** Proposition classifications for this candidate (computed against existing narrative) */
  propositionLabels?: Record<string, string>;
  /** Consistency violations detected in this candidate */
  consistencyViolations?: ConsistencyViolation[];
};

export type PlanCandidates = {
  sceneId: string;
  candidates: PlanCandidate[];
  winner: string;
  createdAt: number;
};

// ─── Semantic Search Types ──────────────────────────────────────────

/** Which search engine drives a query. Persisted on StorySettings.searchMode. */
export type SearchMode = "vector" | "expert" | "context";

export type SearchResult = {
  type: "proposition" | "scene" | "question";
  id: string;
  sceneId: string;
  /** Beat index within the scene's plan — only set for proposition results. */
  beatIndex?: number;
  /** Proposition index within the beat — only set for proposition results. */
  propIndex?: number;
  /** LearningQuestion id — only set for question results (Expert search). */
  questionId?: string;
  content: string;
  similarity: number;
  context: string;
};

export type SearchSynthesis = {
  /** AI-synthesized overview text with inline citations */
  overview: string;
  /** Inline citation metadata linking to results */
  citations: Array<{
    id: number;
    sceneId: string;
    type: "scene" | "proposition" | "question";
    title: string;
    similarity: number;
  }>;
};

/** Coverage audit surfaced to the UI when search can't run on one or both
 *  pools. Lets the UI point the user at the generate-embeddings or
 *  generate-plans affordance rather than returning an opaque empty set. */
export type SearchAvailability = {
  totalScenes: number;
  scenesWithSummaryEmbedding: number;
  scenesWithPlans: number;
  totalPropositions: number;
  propositionsWithEmbedding: number;
  /** True when at least one scene has a summary embedding. */
  summaryEmbeddingsReady: boolean;
  /** True when at least one proposition has an embedding. */
  propositionsReady: boolean;
  /** True when every scene on the branch has a generated plan. Vector search
   *  requires this — a partial proposition bank produces a biased retrieval
   *  (only the planned scenes can ever match). When false the UI falls back
   *  to a narrative-context search. */
  allScenesPlanned: boolean;
  // ── Expert search (curriculum question bank) ──────────────────────────────
  /** Total learning questions across the branch. */
  totalQuestions: number;
  /** Questions that have an embedding. */
  questionsWithEmbedding: number;
  /** Scenes carrying at least one question. */
  scenesWithQuestions: number;
  /** True when at least one question has an embedding. */
  questionsReady: boolean;
  /** True when every scene on the branch carries at least one question. Expert
   *  search requires this — its "area of expertise" must cover the whole branch
   *  or retrieval silently hides the un-questioned scenes (same discipline as
   *  allScenesPlanned for Vector). */
  allScenesHaveQuestions: boolean;
  /** True when every question on the branch is embedded. */
  allQuestionsEmbedded: boolean;
};

export type SearchQuery = {
  query: string;
  /** Which engine produced this result. "vector" = embedding RAG over the
   *  proposition bank; "expert" = embedding RAG over the curriculum question
   *  bank (matched questions' verified answers ground the synthesis);
   *  "context" = narrative-context fallback (no embeddings). The activation
   *  timeline is meaningful for "vector" and "expert" (question origins). */
  mode?: SearchMode;
  embedding: number[];
  synthesis?: SearchSynthesis;
  /** Combined results across both pools (scene summaries + propositions), sorted by similarity. */
  results: SearchResult[];
  /** Scene-summary pool results (thematic, high-level context). Top 10. */
  sceneResults: SearchResult[];
  /** Proposition pool results (specific facts). Top 10. */
  detailResults: SearchResult[];
  /** Timeline showing scene summary activation (direct similarity values). */
  sceneTimeline: { sceneIndex: number; similarity: number }[];
  /** Timeline showing proposition activation (max similarity per scene). */
  detailTimeline: { sceneIndex: number; maxSimilarity: number }[];
  topArc: { arcId: string; avgSimilarity: number } | null;
  topScene: { sceneId: string; similarity: number } | null;
  /** Coverage audit — populated on every search so the UI can guide the user when a pool is empty. */
  availability: SearchAvailability;
};

// ════════════════════════════════════════════════════════════════════════════
// Scenarios — parallel Compass-driven branch generation.
//
// The user has a Compass cohort on the current arc — each direction a
// complete coordination of variables at chosen intensities, weighted by
// priorLogit (read as precision prediction in simulation, recommendation
// otherwise). Scenarios takes the cohort and generates ONE arc continuation
// per direction in parallel, with the direction's variable coordination as
// primary generation guidance. Each result becomes a candidate Branch in the
// work's graph; on commit, every direction attaches as a sister divergence
// off the same fork, and the softmax-top direction's branch becomes active.
// ════════════════════════════════════════════════════════════════════════════

// ── Per-scenario run state ────────────────────────────────────────────────

export type ScenarioRunStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

/** One scenario in the batch, with its generation status and (when
 *  finished) its produced arc continuation. */
export type ScenarioRun = {
  /** Foreign key into the focused arc's planningScenarios. */
  scenarioId: string;
  /** Display name copied at run start so the panel doesn't depend on the
   *  scenario surviving regenerate while the batch is in flight. */
  name: string;
  /** Display color, same reason. */
  color: string;
  /** The scenario's variables (with intensities) captured at run start.
   *  Used as primary generation guidance. */
  variables: Variable[];
  /** Softmax probability at the moment the batch was launched. The branch
   *  with the highest probability becomes the active branch on commit. */
  probabilityAtStart: number;

  status: ScenarioRunStatus;
  /** Stream of LLM tokens for the panel preview. */
  streamText: string;
  /** Phase label for progress display ("planning scenes" / "writing"). */
  phase?: string;
  /** Coarse progress counter for the panel (e.g. scenes done / total). */
  progress?: { current: number; total: number };
  /** Error message if status === 'failed'. */
  error?: string;
  /** Raw LLM output captured when the failure was a JSON parse error.
   *  Feeds the per-scenario "Repair" button so the user can ask the model
   *  to fix the malformed output instead of paying for a full re-run.
   *  The repair flow does its own LLM-based diagnosis from this content. */
  failedRaw?: string;

  startedAt?: number;
  finishedAt?: number;

  /** Produced arc + scenes when status === 'done'. The first arc's
   *  presentVariables are stamped with the scenario's variables so the
   *  resulting branch "knows" which scenario it instantiated. */
  result?: {
    arc: Arc;
    scenes: Scene[];
    /** Snapshot of the narrative state with this arc applied, used to
     *  build the eventual branch on commit. */
    virtualNarrative: NarrativeState;
    virtualResolvedKeys: string[];
    virtualCurrentIndex: number;
  };
};

// ── Run config ────────────────────────────────────────────────────────────

export type ScenariosConfig = {
  /** Optional override — by default we use every scenario on the focused
   *  arc. Setting this lets the panel run a subset (e.g. just the top 3). */
  selectedScenarioIds?: string[];
  /** Optional high-level user direction layered on top of scenario
   *  guidance for every generation in the batch. */
  direction?: string;
  /** Constraints prompt — defaults from StorySettings.storyConstraints,
   *  overridable here. */
  constraintsPrompt?: string;
  /** Optional world-build commit to seed all generations with. */
  worldBuildFocusId?: string;
  /** Per-batch override for arc length. When unset, generateScenes falls
   *  back to `storySettings.targetArcLength`. Bounded 2–8 at the call site. */
  sceneCount?: number;
};

export const DEFAULT_SCENARIOS_CONFIG: ScenariosConfig = {};

// ── Overall run state ─────────────────────────────────────────────────────

export type ScenariosStatus = 'idle' | 'running' | 'complete' | 'cancelled';

export type ScenariosRunState = {
  status: ScenariosStatus;
  /** The arc this batch was launched against — every scenario continues
   *  from this arc's end state. */
  arcId: string | null;
  /** Per-scenario run state, keyed by scenarioId. */
  runs: Record<string, ScenarioRun>;
  /** Ordering of scenarioIds for stable display. */
  scenarioOrder: string[];
  config: ScenariosConfig;
  startedAt: number | null;
  finishedAt: number | null;
  /** Top-level error if the batch as a whole failed to start. */
  error?: string;
};

export function makeEmptyRunState(): ScenariosRunState {
  return {
    status: 'idle',
    arcId: null,
    runs: {},
    scenarioOrder: [],
    config: { ...DEFAULT_SCENARIOS_CONFIG },
    startedAt: null,
    finishedAt: null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function runDoneCount(state: ScenariosRunState): number {
  return state.scenarioOrder.reduce(
    (n, id) => n + (state.runs[id]?.status === 'done' ? 1 : 0),
    0,
  );
}

export function runFailedCount(state: ScenariosRunState): number {
  return state.scenarioOrder.reduce(
    (n, id) => n + (state.runs[id]?.status === 'failed' ? 1 : 0),
    0,
  );
}

export function runRunningCount(state: ScenariosRunState): number {
  return state.scenarioOrder.reduce(
    (n, id) => n + (state.runs[id]?.status === 'running' ? 1 : 0),
    0,
  );
}

/** Initialise a scenario run from a PlanningScenario + its softmax
 *  probability at launch time. */
export function initScenarioRun(
  scenario: PlanningScenario,
  probabilityAtStart: number,
): ScenarioRun {
  return {
    scenarioId: scenario.id,
    name: scenario.name,
    color: scenario.color,
    variables: scenario.variables.map((v) => ({ ...v })),
    probabilityAtStart,
    status: 'pending',
    streamText: '',
  };
}
