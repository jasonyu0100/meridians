import type { StoredBriefing } from './briefing';

// ── Thread (Prediction-Market Model) ────────────────────────────────────────
//
// Threads are prediction markets over named outcomes. Each scene emits
// evidence that updates logits; softmax(logits) gives the probability
// distribution. Fate is information-gain (entropy change) weighted by volume.
//
// Binary threads use outcomes: ["yes", "no"]; multi-outcome threads enumerate
// their possibilities ("Harry wins" / "Voldemort wins" / "Destroyed" / ...).
// Binary is just the N=2 case — the math parameterizes by |outcomes|.

/** Canonical agent whose belief is the "market price" before per-character
 *  markets are populated. Phase 1: only the narrator holds a belief. */
export const NARRATOR_AGENT_ID = "narrator" as const;

/** A belief held by a single agent (narrator or character) over a thread's
 *  outcomes. Logits live in R; softmax gives a probability distribution. */
export type Belief = {
  /** Per-outcome logits (same length as thread.outcomes). */
  logits: number[];
  /** Cumulative narrative attention. Decays per untouched scene. */
  volume: number;
  /** EWMA of recent |Δlogit| magnitudes — how much the thread is moving. */
  volatility: number;
  /** Last scene id that touched this belief. Used for decay and recency. */
  lastTouchedScene?: string;
};

export type ThreadParticipant = {
  id: string;
  type: "character" | "location" | "artifact";
};

// ── Thread Log ──────────────────────────────────────────────────────────────

/** Thread log node — a statement of something that occurred in a specific scene.
 *  Written in simple past tense. One fact, one sentence, no interpretation.
 *  Nine perceptual primitives — the thread's model of its own situation.
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
 *  [-4, +4] applied as a log-odds shift: logit[k] += evidence / sensitivity.
 *  The LLM emits these; softmax renormalizes probabilities automatically. */
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
   *  Doubles as the rationale that grounds the market update. */
  content: string;
  /** The scene where this event occurred. */
  sceneId?: string;
  /** Per-outcome evidence emitted in this scene. Empty array = pulse
   *  (attention maintenance without directional movement). */
  updates?: OutcomeEvidence[];
  /** Change to volume (narrative attention) contributed by this event. */
  volumeDelta?: number;
  /** Outcomes added to the thread's market at this scene (if any).
   *  Present only on scenes that structurally expanded the market. */
  addedOutcomes?: string[];
  /** Normalized Shannon info-gain at this delta: |H(pre) − H(post)| / ln(N).
   *  Range [0, 1]. Populated by applyThreadDelta; read by the refined fate
   *  formula so we don't need a trajectory replay to score the scene. */
  infoGain?: number;
  /** Market volume immediately before this delta was applied. Lets the fate
   *  formula weight information gain by how much attention the market
   *  was carrying at the moment of movement. */
  preVolume?: number;
  /** Scenes elapsed since the thread opened, at the time of this delta.
   *  Only meaningful on closing deltas — drives the buildup bonus. */
  buildup?: number;
  /** True if this delta triggered closure (margin ≥ τ, committal logType,
   *  decisive evidence). Used by the fate closure bonus. */
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
 * Used by the market-calibration prompts (Principle 8: scope-distance
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
  /** Named outcomes the market prices. Length ≥ 2. Binary: ["yes", "no"].
   *  Multi-outcome enumerates possibilities. The softmax over per-outcome
   *  logits gives the probability distribution. */
  outcomes: string[];
  /** Structural distance from any given scene to the thread's resolution.
   *  Set when the thread opens; static for the thread's lifetime. Drives
   *  evidence-magnitude attenuation via Principle 8 in the calibration
   *  prompts. Undefined treated as 'medium' for backwards compatibility. */
  horizon?: ThreadHorizon;
  /** Per-agent beliefs over the outcomes. Phase 1: beliefs[NARRATOR_AGENT_ID]
   *  is the only entry and serves as the "market price." Phase 5 adds
   *  per-character beliefs; market price becomes an aggregate. */
  beliefs: Record<string, Belief>;
  openedAt: string;
  dependents: string[];
  /** Terminal: set when the market commits to a winning outcome. */
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
 *
 *  Examples:
 *  - "Harry Potter has a lightning-bolt scar on his forehead." (trait)
 *  - "Snape is secretly working as a double agent for the Order." (secret)
 *  - "The Dursley household is hostile to anything associated with magic." (trait)
 *  - "Gandalf carries the elven ring Narya, the Ring of Fire." (relation)
 *  - "The Iron Throne is forged from a thousand surrendered swords." (history)
 */
export type WorldNodeType =
  | "trait" // Inherent characteristic — personality, atmosphere, physical property
  | "state" // Current condition — wounded, ruined, activated, contested
  | "history" // Past experience — memory, founding event, provenance
  | "capability" // What it can do — skill, strategic value, function
  | "belief" // Subjective truth — opinion, legend, lore, contested claim
  | "relation" // Connection to another entity — bond, sacred-to, bound-to
  | "secret" // Hidden information — hidden knowledge, concealed origin
  | "goal" // Orientation — ambition, purpose, intended use
  | "weakness"; // Vulnerability — fear, structural flaw, limitation

export const WORLD_NODE_TYPES: WorldNodeType[] = [
  "trait",
  "state",
  "history",
  "capability",
  "belief",
  "relation",
  "secret",
  "goal",
  "weakness",
];

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
/** A scene's effect on a thread's prediction market. The LLM emits one
 *  ThreadDelta per affected thread per scene. Math applies integer `evidence`
 *  values as log-odds shifts (logit[k] += evidence / sensitivity), renormalizes
 *  via softmax, and appends a ThreadLogNode to the thread's event log. */
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
  /** New outcomes to add to the thread's market, mid-story. Rare — reserved
   *  for scenes that genuinely open new possibilities (a reveal introduces a
   *  third contender, a character realises an option they hadn't considered).
   *  Appended with logit=0, which gives them the prior of "equally likely as
   *  the current best outcome" before any evidence is applied in this same
   *  delta via `updates`. Duplicates of existing outcomes are ignored. */
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

/** Beat sampling data — derived from analyzed works, separate from voice profile. */
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

export type CharacterMovement = {
  locationId: string;
  /** Descriptive transition narrating how the character moved, e.g. "Rode horseback through the night to Bree" */
  transition: string;
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
  /** Characters who move in this scene — characterId → movement details. Only include deltas. */
  characterMovements?: Record<string, CharacterMovement>;
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
  /** New threads introduced in this scene — seeded as fresh markets at uniform prior over their outcomes. */
  newThreads?: Thread[];
  /** Version history for prose — enables branch isolation. Resolution uses branch lineage + fork time. */
  proseVersions?: ProseVersion[];
  /** Version history for plan — enables branch isolation. Resolution uses branch lineage + fork time. */
  planVersions?: PlanVersion[];
  /** Game-theoretic analysis — opt-in, additive layer derived from the beat plan. Single current analysis; regenerate to replace. */
  gameAnalysis?: SceneGameAnalysis;
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
   *  showing forecasts InkTide produced. Stamped at the boundary; never
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

/** A variable that characterises the future-machinery of a narrative — the
 *  kinds of forces, pressures, or contingencies that can fire across arcs.
 *  Extracted per-narrative during text analysis; reused across arcs as the
 *  vocabulary that both present-state snapshots and forward planning
 *  hypotheses are built against. */
/** A variable — a lever on the possibility field. Each Present (per arc) and
 *  each Future scenario owns its OWN custom variable set, generated for that
 *  particular moment. There is no shared catalogue, and scenarios don't
 *  reference back to the arc's Present variables — every set stands alone.
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

/** A named hypothesis about how a future arc could unfold — a unique
 *  disposition of variables at chosen intensities. Multiple scenarios per
 *  arc let the author lay out a cohort of plausible futures and compare
 *  their dispositions before committing one as the basis for generation. */
export type PlanningScenario = {
  id: string;
  name: string;
  /** Short one-sentence gestalt of the coordination — what this scenario IS
   *  as a recognisable shape. Same register as a chapter epigraph for fiction,
   *  a section heading for a paper, a scenario name for simulation. */
  description?: string;
  /** Hex colour for the scenario's polyline / card accents. */
  color: string;
  /** This scenario's OWN variable set — generated custom for this particular
   *  future at the moment of generation. Does not reference back to the
   *  arc's Present variables; each scenario stands alone. */
  variables: Variable[];
  /** LLM-estimated log-prior reflecting how plausible this scenario is given
   *  the narrative context. Range matches the prediction market's evidence
   *  scale (MARKET_EVIDENCE_MIN/MAX = [-4, +4]) so scenario priors and
   *  thread evidence speak the same units: +4 = decisive evidence in
   *  favour, 0 = baseline plausibility, -4 = decisive against / rare tail.
   *  Softmax across the cohort produces display probabilities. Intensity is
   *  *not* used as a probability proxy — a high-intensity tail event gets a
   *  low priorLogit, not a deflated likelihood. */
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
   *  rules it out. Forces genuine prediction-market work; if `breaks` is
   *  empty the scenario can't be wrong, which means it isn't forecasting. */
  breaks?: string;
  /** What becomes possible / cascades downstream if this scenario holds —
   *  the threads it opens for the next arc, the markets it perturbs, the
   *  affordances it grants future continuations. */
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
  /** Starting positions — characterId → locationId. Established at arc start. */
  initialCharacterLocations: Record<string, string>;
  /** Short sentence summarising the narrative direction of this arc */
  directionVector?: string;
  /** This arc's Present variables — the full definitions plus their realised
   *  intensities for the arc. No shared narrative-wide catalogue: each arc
   *  owns its own custom-generated set. Future scenarios on the same arc
   *  each own their own independent variable sets too. Undefined / empty =
   *  arc has no variables defined yet, UI shows the fresh-page seed state. */
  presentVariables?: Variable[];
  /** Short one-sentence gestalt of the Present coordination — what this
   *  configuration *is* as a recognisable shape. Generated alongside the
   *  variables. When a Future scenario is committed via experimentation, the
   *  scenario's own description is transferred onto the new arc's
   *  `presentDescription` so the lineage is preserved. */
  presentDescription?: string;
  /** Multi-sentence load-bearing logic for the Present variable coordination —
   *  WHY these variables are firing at these intensities given the arc's
   *  state: which mechanism feeds which, where the cascade runs, which symptom
   *  is the surface. Transferred from the parent scenario's `reasoning` on
   *  experimentation commit. */
  presentReasoning?: string;
  /** Log-prior plausibility score for this Present coordination, in the
   *  same MARKET_EVIDENCE_MIN/MAX range as scenario priorLogits ([-4, +4]).
   *  When a Future scenario is committed via experimentation, the
   *  scenario's `priorLogit` is transferred onto the new arc's
   *  `presentLogit` — preserving "how likely was this when it was chosen"
   *  as a permanent record of the path's rarity. When Present is
   *  regenerated directly, the LLM emits a self-estimated logit. */
  presentLogit?: number;
  /** Universal inference-shape fields for Present — same semantics as the
   *  fields on PlanningScenario and node snapshots: option space,
   *  falsification handle, forward extension. Generated alongside the
   *  variables; transferred from the parent scenario on experimentation
   *  commit so lineage of the comparative + falsification reasoning is
   *  preserved across the branch fork. */
  presentConsidered?: string;
  presentBreaks?: string;
  presentOpens?: string;
  /** Optional user-supplied direction string captured at the last regenerate
   *  for transparency — shows what guidance shaped the cohort. */
  scenarioDirection?: string;
  /** Cohort of probable next-arc futures, each a unique disposition of
   *  variables. Generated by the LLM and editable. Acts as the playground
   *  for shaping continuation; the user picks one scenario and that becomes
   *  the brief sent to scene generation. Empty / unset on past arcs unless
   *  the user deliberately seeds them. */
  planningScenarios?: PlanningScenario[];
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
  modeId?: string;
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
    | "chaos"   // Creative agent — introduces new entities (characters/locations/artifacts/threads)
    // Plan-spine types — only produced by coordination-plan-derived
    // investigations. Manual investigations never emit these. Kept in the
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
   * ModeNodeSnapshot, PlanningScenario). Same field names, same abstract
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
// hold an `arc.modeId` reference to the PRG that was current at
// arc generation time, preserving the model the arc was built under.
// `pruneModes` (reference-counted helper) is exposed for opt-in
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
export type ModeNodeType =
  | "pattern"
  | "convention"
  | "attractor"
  | "agent"
  | "rule"
  | "pressure"
  | "landmark";

export type ModeNodeSnapshot = {
  id: string;
  /** Presentation / causal order — used for display and sequential walks. */
  index: number;
  /** Generation order — the order the AI emitted this node (JSON position). May differ from `index` in backward modes. */
  order?: number;
  type: ModeNodeType;
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
export type ModeEdgeSnapshot = {
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
 * `Arc.modeId`. Users manage the collection in the Phase tab: name,
 * switch current, use as basis, or delete explicitly.
 */
export type Mode = {
  id: string;
  /**
   * Display name shown in the Phase tab list. User-editable; defaults to a
   * timestamp or the LLM-generated summary's first clause when not set.
   */
  name?: string;
  /** 1-2 sentence summary of the working model this PRG asserts. */
  summary: string;
  nodes: ModeNodeSnapshot[];
  edges: ModeEdgeSnapshot[];
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

/** Thread market intent for spine nodes — what the arc should do to the thread's
 *  prediction market. Binary: should the price move? Should it close? Should
 *  a twist reverse the dominant outcome? */
export type ThreadMarketIntent =
  | "advance"    // move price toward `outcome` without committing
  | "escalate"   // raise volume + move price, set up payoff
  | "close"      // commit to `outcome` (price → 1 for that outcome)
  | "twist"      // reverse prior direction (dominant outcome flips)
  | "maintain"   // pulse — keep volume alive without price movement
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
 * (threadId + marketIntent + marketOutcome). The one peak or valley that anchors an arc also
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
  /** Market intent for this thread (for spine nodes tracking thread progression) */
  marketIntent?: ThreadMarketIntent;
  /** Target outcome name (for advance/close/twist intents — must match an
   *  entry in the thread's outcomes array). */
  marketOutcome?: string;
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

// ── Narrative State ──────────────────────────────────────────────────────────

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
  driverEntries?: Record<string, DriverEntry>;
  /** Branch evaluations keyed by branch ID — most recent eval per branch */
  structureReviews?: Record<string, StructureReview>;
  /** Prose evaluations keyed by branch ID — most recent prose eval per branch */
  proseEvaluations?: Record<string, ProseEvaluation>;
  /** Plan evaluations keyed by branch ID — most recent plan eval per branch */
  planEvaluations?: Record<string, PlanEvaluation>;
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
  /** Arc-anchored causal investigations. Each entry hosts a reasoning graph
   *  attached to an arc. An arc may have many investigations; the canvas
   *  cycles between them. Investigations come from two sources: (a) the user
   *  explicitly creates one via the sidebar composer, or (b) the auto-mode
   *  coordination plan saves the CRG it built for that arc. */
  investigations?: Record<string, ArcInvestigation>;
  /**
   * Modes — historical collection of working models of reality. Keyed
   * by mode id. Immutable once stored; new phase graphs are added
   * (optionally seeded from an existing one), never mutated. Arcs reference
   * these by id. Empty / undefined = no phase graph has ever been generated.
   */
  modes?: Record<string, Mode>;
  /**
   * Id of the currently-active phase graph that downstream generation reads
   * from. Undefined = no active phase graph (generation falls back to a
   * historical viewpoint of the narrative context). Setting / clearing this
   * field is the only mutation users perform on mode state.
   */
  currentModeId?: string;
  /** Last market briefing the operator generated for this narrative — held
   *  so the Brief tab can hydrate without re-calling the LLM, and so a
   *  stale briefing flags itself when the head moves on or the active
   *  branch changes. */
  lastBriefing?: StoredBriefing;
  /** Source files that contributed to this narrative — the corpus that
   *  created it (`mode: 'create'`) plus any later extension files
   *  (`mode: 'extend'`). The raw source text lives in IndexedDB as a
   *  text asset (`contentRef`); this dict just holds metadata. */
  files?: Record<string, SourceFile>;
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
 *  optionally steered by a user-provided direction. Multiple investigations
 *  per arc are supported; the canvas cycles between them. The graph can be
 *  copied back into the GeneratePanel as guidance for subsequent generation.
 *
 *  Two creation paths feed this:
 *    - User opens the sidebar composer and runs one against an arc.
 *    - Auto-mode coordination plan generates a CRG for an arc and saves the
 *      result here.
 */
export type ArcInvestigation = {
  id: string;
  /** Host arc id. An arc may have many investigations. */
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
// Each beat that bears a strategic decision is modelled as an N×M game between
// two players. This is an EVALUATOR: the outcome grid is the decision space,
// not a predictor. The realized cell (what the author actually did) can be
// Nash, Nash-adjacent, or strictly dominated — that's information, not error.
// Characters who trade local optimality for arc-level payoff are exactly what
// we want to learn about.

/** Dimension along which both players' actions are organised.
 *
 *  SCOPE: This taxonomy models **interpersonal strategic beats** — decisions
 *  between two (or more) agentic parties. Internal beats (self vs self, pure
 *  introspection) are out of scope and should be skipped or flagged trivial;
 *  a separate lightweight system covers those.
 */
export type ActionAxis =
  // — Information & self-presentation —
  | "disclosure"       // reveal ↔ conceal
  | "identity"         // claim ↔ disown

  // — Stance toward other party —
  | "trust"            // extend ↔ guard
  | "alliance"         // ally ↔ separate
  | "confrontation"    // engage ↔ evade
  | "status"           // assert ↔ defer

  // — Force & magnitude within interaction —
  | "pressure"         // press ↔ yield
  | "stakes"           // escalate ↔ deescalate
  | "control"          // bind ↔ release

  // — Resource & obligation flow —
  | "acquisition"      // take ↔ give
  | "obligation"       // incur ↔ discharge

  // — Moral / normative —
  | "moral"            // transgress ↔ uphold (acts against a principle or person)

  // — Self-binding & tempo —
  | "commitment"       // commit ↔ withdraw / hedge
  | "timing";          // act ↔ wait

/** Classical strategic structure of the beat. Consolidated taxonomy —
 *  war-of-attrition folds into chicken; ultimatum folds into bargaining.
 *  Screening is kept separate from principal-agent because conflating them
 *  drives principal-agent overuse (any asymmetric-info beat drifts into it). */
export type GameType =
  // — Symmetric payoff structures —
  | "coordination"       // both want the same outcome; alignment problem
  | "anti-coordination"  // players want opposite outcomes on a shared axis
  | "battle-of-sexes"    // both want to coordinate but prefer different equilibria
  | "dilemma"            // mutual cooperation pareto-optimal but each tempted to defect
  | "stag-hunt"          // coordination with payoff-dominant vs risk-dominant trade-off
  | "chicken"            // mutual yielding vs mutual collision (incl. time-extended war-of-attrition)
  | "zero-sum"           // one gains exactly what the other loses (payoff grid sums to zero)
  | "pure-opposition"    // conflict over incommensurable values (honor vs survival, love vs duty)

  // — Asymmetric / structural —
  | "contest"            // n-player competition for rank-ordered prize
  | "collective-action"  // n-player threshold contribution; free-rider dynamics
  | "principal-agent"    // delegation with HIDDEN action — principal can't directly observe what agent did
  | "screening"          // uninformed party structures choices to sort agent types (evaluations, tests, auctions)
  | "signaling"          // informed party reveals type through costly, hard-to-fake action
  | "stealth"            // actor acts covertly; observer's move is attention allocation, not active counter-action
  | "stackelberg"        // sequential; leader commits visibly, follower best-responds

  // — Communication / mechanism layers —
  | "cheap-talk"         // non-binding communication shapes the beat
  | "commitment-game"    // binding vs non-binding promise is the crux
  | "bargaining"         // propose / counter / accept dynamics (incl. one-shot ultimatum)

  // — Degenerate —
  | "trivial";           // no real strategic content — use sparingly

/** Intuitive explanation for each action axis — "dichotomy — question the axis
 *  asks of the beat". Phrased as the question a reader can apply to the scene. */
export const ACTION_AXIS_LABELS: Record<ActionAxis, string> = {
  disclosure:    "reveal ↔ conceal — what information does each side expose or hide?",
  identity:      "claim ↔ disown — do I assert who I am, or distance myself from it?",
  trust:         "extend ↔ guard — do I lower my defenses, or keep them up?",
  alliance:      "ally ↔ separate — are we on the same side going forward, or not?",
  confrontation: "engage ↔ evade — do I meet this head-on or find a way around it?",
  status:        "assert ↔ defer — do I push for the higher position, or yield rank?",
  pressure:      "press ↔ yield — how much force am I applying, or absorbing?",
  stakes:        "escalate ↔ deescalate — am I raising or lowering what's on the line?",
  control:       "bind ↔ release — am I imposing constraint, or lifting it?",
  acquisition:   "take ↔ give — who ends up holding the resources / lives / knowledge?",
  obligation:    "incur ↔ discharge — am I taking on a debt/favor, or paying it off?",
  moral:         "transgress ↔ uphold — does this act violate a principle, or honor it?",
  commitment:    "commit ↔ withdraw / hedge — am I binding myself, or keeping options open?",
  timing:        "act ↔ wait — do I move now, or hold and watch?",
};

/** Intuitive explanation for each game type — the strategic shape as it would
 *  feel to a reader, not a game theorist. One concrete hint per line. */
export const GAME_TYPE_LABELS: Record<GameType, string> = {
  "coordination":      "Both want to end up in the same place. The question is just: which place?",
  "anti-coordination": "BOTH players actively want to diverge — mutual desire to differ. If only one party wants to diverge and the other would prefer to align (e.g., a sneak vs. a guard — the guard would like to be where the sneak is), this is stealth or zero-sum, not anti-coordination.",
  "battle-of-sexes":   "Both want to meet, but each prefers their own venue. Coordination with a tug-of-war underneath.",
  "dilemma":           "Cooperation would be best for both, but each has a private incentive to betray — prisoner's-dilemma shape.",
  "stag-hunt":         "Team up for a big shared prize, or play it safe alone. Trust and risk-appetite decide.",
  "chicken":           "Both want the other to yield. If neither does, both crash — escalation contest.",
  "zero-sum":          "The payoff grid literally sums to zero — anything I gain, you lose, same magnitude. If any cell leaves both positive (or both negative), this is NOT zero-sum.",
  "pure-opposition":   "Values clash with NO SHARED CURRENCY — honor vs survival, love vs duty, faith vs reason. Rare and specific. If both parties care about the same axis (power, reputation, control, resources) and simply want different amounts, that's zero-sum or anti-coordination, not pure-opposition. Ask: can I name the single thing both want more of? If yes, it's not this.",
  "contest":           "Multiple players compete for a ranked prize — tournament, auction, scramble for status.",
  "collective-action": "A group needs enough contributors to pull something off. Each is tempted to free-ride on others' effort.",
  "principal-agent":   "Requires BOTH (a) explicit delegation — one party hands a task to another — AND (b) hidden action — the principal can't directly observe what the agent does and must rely on outcomes or design incentives. If either is missing, it's something else. Not a sink for asymmetric-info beats.",
  "screening":         "Uninformed party structures choices to sort agents by type — evaluations, tests, auctions, interview questions designed to reveal who is who. Choose this over principal-agent when the beat is about sorting candidates, not monitoring a delegated task.",
  "signaling":         "Informed party reveals their type through a costly, hard-to-fake action. The signal is only credible if weaker types couldn't afford to send it.",
  "stealth":           "One player attempts something whose success depends on the other NOT NOTICING. The observer's 'move' is passive attention allocation (scrutinise vs. overlook), not an active counter-action. Covert actions, surveillance, concealed maneuvers, information theft — a player vs. an unaware or distracted counterpart.",
  "stackelberg":       "One moves first and commits visibly; the other watches, then responds. First-mover advantage or trap.",
  "cheap-talk":        "Words exchanged but nothing binds. Persuasion, posturing, bluffing — the talk itself is the move.",
  "commitment-game":   "Can one party bind themselves to act (vow, burned bridge, hostage)? Credibility of the promise is the whole game.",
  "bargaining":        "Offers and counteroffers across rounds — each side strategising over when to concede. Ultimatum is the one-round version.",
  "trivial":           "No real strategic content — a beat where the choice is in name only.",
};

/** A single labelled action in a player's menu. */
export type PlayerAction = {
  /** 2-5 words naming the concrete action, e.g. "feigns C-grade aperture". */
  name: string;
};

/** One outcome cell: the world-state if A takes aAction and B takes bAction. */
export type GameOutcome = {
  /** Name of A's action — must match an entry in playerAActions[].name. */
  aActionName: string;
  /** Name of B's action — must match an entry in playerBActions[].name. */
  bActionName: string;
  /** 5-15 words narrating what happens at this cell. */
  description: string;
  /** A's stake delta: -4 (catastrophic for A) to +4 (ideal for A). */
  stakeDeltaA: number;
  /** B's stake delta: -4 to +4. */
  stakeDeltaB: number;
};

/** A strategic beat: the outcome space around a single decision. */
export type BeatGame = {
  /** Which beat in the scene's BeatPlan.beats this game corresponds to. */
  beatIndex: number;
  /** Short excerpt of the beat for context. */
  beatExcerpt: string;

  /** Classical strategic frame of the beat. */
  gameType: GameType;
  /** Dimension both players' actions are organised along. */
  actionAxis: ActionAxis;

  // ── Player A ─────────────────────────────────────────────────────────
  playerAId: string;
  playerAName: string;
  /** A's action menu, 1-4 entries. */
  playerAActions: PlayerAction[];

  // ── Player B ─────────────────────────────────────────────────────────
  playerBId: string;
  playerBName: string;
  playerBActions: PlayerAction[];

  /**
   * Every (A, B) action pairing — exactly playerAActions.length *
   * playerBActions.length entries. Order is not significant; cells are looked
   * up by their action-name pair.
   */
  outcomes: GameOutcome[];

  /** A's action name in the realized outcome (must match an A menu entry). */
  realizedAAction: string;
  /** B's action name in the realized outcome. */
  realizedBAction: string;

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

/** Output format for prose generation */
export type ProseFormat = "prose" | "screenplay" | "simulation" | "meta";

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
  /** Default world expansion strategy — depth deepens the existing sandbox, breadth widens the map, dynamic auto-selects based on metrics */
  expansionStrategy: "depth" | "breadth" | "dynamic";
  /** Reasoning effort — how much thinking the model does before responding. Higher = better structural decisions, slower generation. */
  reasoningLevel: ReasoningLevel;
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
   * Default thinking mode pre-populated into the reasoning-graph pickers.
   * User can override per-generation. Mirrors ThinkingStyle in lib/ai.
   */
  defaultThinkingStyle: "freeform" | "divergent" | "deduction" | "abduction" | "induction";
  /**
   * Default force preference pre-populated into the reasoning-graph
   * pickers. User can override per-generation. Mirrors ThinkingResource
   * in lib/ai.
   */
  defaultThinkingResource:
    | "freeform"
    | "fate"
    | "world"
    | "system"
    | "chaos";
  /**
   * Default graph density pre-populated into the reasoning-graph
   * pickers. User can override per-generation.
   */
  defaultReasoningSize: "small" | "medium" | "large";
  /**
   * Default network thinking mode — biases reasoning toward, away from, or
   * balanced across the cumulative activation pattern of the narrative's
   * entities, threads, and system nodes. Pre-populates the per-generation
   * picker; always overridable via ArcReasoningOptions.networkBias.
   *  - `inside`: anchor in HOT nodes; deepen the gravitational centres
   *  - `outside`: reach for COLD or FRESH nodes; break the dominant pattern
   *  - `neutral`: use what the arc needs — balanced across hot and cold
   */
  defaultNetworkBias: "inside" | "outside" | "neutral";
  /**
   * When true (default), storyDirection and storyConstraints are cleared
   * from this settings object after they guide a scene or CRG generation.
   * Prevents a directive from silently shaping every subsequent generation
   * without the user re-opting-in. Power users can toggle off to keep a
   * persistent north-star.
   */
  autoClearDirection: boolean;
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
  expansionStrategy: "dynamic",
  reasoningLevel: "low",
  beatProfilePreset: "",
  mechanismProfilePreset: "",
  usePacingChain: false,
  useBeatChain: false,
  audioVoice: "onyx",
  audioModel: "tts-1",
  proseFormat: "prose",
  planExtractionSource: "structure",
  defaultThinkingStyle: "abduction",
  defaultThinkingResource: "freeform",
  defaultReasoningSize: "medium",
  defaultNetworkBias: "neutral",
  autoClearDirection: true,
};

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
  endConditions: AutoEndCondition[];
  minArcLength: number;
  maxArcLength: number;
  maxActiveThreads: number;
  threadStagnationThreshold: number;
  /** High-level north star that steers every arc */
  direction: string;
  toneGuidance: string;
  /** Constraints prompt — defaults from StorySettings.storyConstraints, overridable here */
  narrativeConstraints: string;
  characterRotationEnabled: boolean;
  minScenesBetweenCharacterFocus: number;
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
    | "experimentation"
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
    /** Named outcomes the market prices. ≥2 entries. Default ["yes","no"]. */
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
    characterMovements?: {
      characterName: string;
      locationName: string;
      transition: string;
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
  /** Skip the beat plan extraction phase (Phase 2) — structure-only analysis.
   *  Forced true when extractionMode === 'world' (no scenes → no plans). */
  skipPlanExtraction?: boolean;
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

export type NarrativeViewState = {
  activeBranchId: string | null;
  currentSceneIndex: number;
  inspectorContext: InspectorContext | null;
  inspectorHistory: InspectorContext[];
  selectedKnowledgeEntity: string | null;
  selectedThreadLog: string | null;
  /** Currently-selected investigation when the Investigation tab is active.
   *  The canvas falls back to the first investigation on the current scene
   *  if this id doesn't belong to the visible scene. */
  selectedInvestigationId: string | null;
  currentSearchQuery: SearchQuery | null;
  currentResultIndex: number;
  searchFocusMode: boolean;
  activeChatThreadId: string | null;
  activeBranchChatThreadId: string | null;
  autoRunState: AutoRunState | null;
  isPlaying: boolean;
};

// ── App State ────────────────────────────────────────────────────────────────
export type InspectorContext =
  | { type: "scene"; sceneId: string }
  | { type: "character"; characterId: string }
  | { type: "location"; locationId: string }
  | { type: "thread"; threadId: string }
  | { type: "arc"; arcId: string }
  | { type: "knowledge"; nodeId: string }
  | { type: "artifact"; artifactId: string }
  | { type: "world"; entityId: string; nodeId: string }
  | { type: "threadLog"; threadId: string; nodeId: string }
  | { type: "reasoning"; arcId?: string; worldBuildId?: string; nodeId: string }
  | { type: "mode"; modeId: string; nodeId: string };

export type WizardStep = "form" | "details" | "generate";

export type CharacterSketch = {
  name: string;
  role: "anchor" | "recurring" | "transient";
  description: string;
};

export type LocationSketch = {
  name: string;
  description: string;
};

export type ThreadSketch = {
  description: string;
  participantNames: string[];
};

export type WizardData = {
  title: string;
  premise: string;
  characters: CharacterSketch[];
  locations: LocationSketch[];
  threads: ThreadSketch[];
  proseProfile?: ProseProfile;
  /** When true: generate world entities only — no introduction arc or scenes. Premise is treated as the full world plan document. */
  worldOnly?: boolean;
};

export type GraphViewMode =
  | "spatial"
  | "overview"
  | "prose"
  | "plan"
  | "audio"
  | "game"
  | "spark"
  | "codex"
  | "pulse"
  | "threads"
  | "search"
  | "driver"
  | "reasoning"
  | "network"
  | "market"
  | "present"
  | "future"
  | "mode";

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
export type DriverEntry = {
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

  // Global preferences
  graphViewMode: GraphViewMode;
  autoConfig: AutoConfig;

  // Narrative-scoped (swapped on narrative switch)
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

export type SearchResult = {
  type: "proposition" | "scene";
  id: string;
  sceneId: string;
  /** Beat index within the scene's plan — only set for proposition results. */
  beatIndex?: number;
  /** Proposition index within the beat — only set for proposition results. */
  propIndex?: number;
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
    type: "scene" | "proposition";
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
};

export type SearchQuery = {
  query: string;
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
