import type {
  BeatPlan,
  Character,
  Location,
  NarrativeState,
  Scene,
  Thread,
} from "@/types/narrative";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Mock the AI module
vi.mock("@/lib/ai/api", () => ({
  callGenerate: vi.fn(),
  callGenerateStream: vi.fn(),
  resolveReasoningBudget: vi.fn(() => 0),
  resolveWebsearch: vi.fn(() => 0),
  SYSTEM_PROMPT: "Test system prompt",
}));
// Mock context building
vi.mock("@/lib/ai/context", () => ({
  narrativeContext: vi.fn().mockReturnValue("Mock narrative context"),
  sceneContext: vi.fn().mockReturnValue("Mock scene context"),
  sceneScale: vi.fn().mockReturnValue({ estWords: 1500 }),
  buildProseProfile: vi.fn().mockReturnValue("PROSE PROFILE\nVoice: literary"),
}));
// Mock prompts
vi.mock("@/lib/ai/prompts", () => ({
  PROMPT_FORCE_STANDARDS: "Mock force standards",
  PROMPT_STRUCTURAL_RULES: "Mock structural rules",
  PROMPT_DELTAS: "Mock deltas",
  PROMPT_ARTIFACTS: "Mock artifacts",
  PROMPT_LOCATIONS: "Mock locations",
  PROMPT_POV: "Mock POV",
  PROMPT_WORLD: "Mock continuity",
  PROMPT_ARC_STATE_GUIDANCE: "Mock arc state guidance",
  PROMPT_SUMMARY_REQUIREMENT: "Mock summary requirement",
  PROMPT_BEAT_TAXONOMY: "Mock beat taxonomy",
  promptThreadLifecycle: vi.fn().mockReturnValue("Mock thread lifecycle"),
  buildThreadHealthPrompt: vi.fn().mockReturnValue("Mock thread health"),
  buildCompletedBeatsPrompt: vi.fn().mockReturnValue("Mock completed beats"),
  buildForceStandardsPrompt: vi.fn().mockReturnValue("Mock force standards prompt"),
  buildScenePlanSystemPrompt: vi.fn().mockReturnValue("Mock scene plan system prompt"),
  buildBeatAnalystSystemPrompt: vi.fn().mockReturnValue("Mock beat analyst system prompt"),
  buildScenePlanEditSystemPrompt: vi.fn().mockReturnValue("Mock scene plan edit system prompt"),
  buildSceneProseSystemPrompt: vi.fn().mockReturnValue("Mock scene prose system prompt"),
}));
// Mock markov functions
vi.mock("@/lib/markov", () => ({
  samplePacingSequence: vi.fn().mockReturnValue({
    steps: [
      {
        mode: "HHH",
        name: "Climax",
        description: "High everything",
        forces: { fate: [1, 2], world: [1, 2], system: [1, 2] },
      },
    ],
    pacingDescription: "Test pacing",
  }),
  buildSequencePrompt: vi.fn().mockReturnValue("Mock sequence prompt"),
  buildSingleStepPrompt: vi.fn().mockReturnValue("Mock step prompt"),
  detectCurrentMode: vi.fn().mockReturnValue("LLL"),
  MATRIX_PRESETS: [],
  DEFAULT_TRANSITION_MATRIX: {},
}));
// Mock beat profiles
vi.mock("@/lib/beat-profiles", () => ({
  resolveProfile: vi.fn().mockReturnValue({
    register: "literary",
    stance: "close_third",
    devices: ["metaphor"],
    rules: ["Show, dont tell"],
    antiPatterns: ["Purple prose"],
  }),
  resolveSampler: vi.fn().mockReturnValue({
    beatsPerKWord: 12,
    markov: {},
    fnMechanismDistribution: {},
  }),
  sampleBeatSequence: vi.fn().mockReturnValue([
    { fn: "breathe", mechanism: "environment" },
    { fn: "advance", mechanism: "action" },
    { fn: "turn", mechanism: "dialogue" },
  ]),
  DEFAULT_FN_MECHANISM_DIST: {
    breathe: { environment: 0.5, narration: 0.3, dialogue: 0.2 },
    inform: { dialogue: 0.5, narration: 0.3, thought: 0.2 },
    advance: { action: 0.4, dialogue: 0.4, narration: 0.2 },
    bond: { dialogue: 0.6, action: 0.2, thought: 0.2 },
    turn: { dialogue: 0.4, action: 0.4, narration: 0.2 },
    reveal: { action: 0.5, dialogue: 0.3, thought: 0.2 },
    shift: { dialogue: 0.4, action: 0.4, thought: 0.2 },
    expand: { narration: 0.5, dialogue: 0.3, document: 0.2 },
    foreshadow: { environment: 0.4, dialogue: 0.3, narration: 0.3 },
    resolve: { dialogue: 0.4, action: 0.4, narration: 0.2 },
  },
}));
// Mock embeddings module — dynamic imports in ai/scenes.ts would otherwise
// hit a real fetch('/api/embeddings') which fails with Invalid URL in the
// Node test env. Stub returns 1536-dim zero vectors so downstream code is
// happy.
vi.mock("@/lib/embeddings", () => ({
  generateEmbeddings: vi.fn(async (texts: string[]) =>
    texts.map(() => new Array(1536).fill(0)),
  ),
  generateEmbeddingsBatch: vi.fn(async (texts: string[]) =>
    texts.map(() => new Array(1536).fill(0)),
  ),
  embedPropositions: vi.fn(async (props: unknown[]) => props),
  computeCentroid: vi.fn(() => new Array(1536).fill(0)),
  resolveEmbedding: vi.fn(async () => null),
  resolveEmbeddingsBatch: vi.fn(async () => new Map()),
  cosineSimilarity: vi.fn(() => 0),
}));
// AssetManager reads from IndexedDB and must be init()'d before use. Scene
// generation stores every embedding through it — stub storage so the assertions
// don't require a running DB.
vi.mock("@/lib/asset-manager", () => {
  let counter = 0;
  return {
    assetManager: {
      init: vi.fn(async () => {}),
      storeEmbedding: vi.fn(async () => `EMB-${++counter}`),
      getEmbedding: vi.fn(async () => null),
      getEmbeddingsBatch: vi.fn(async () => new Map()),
    },
  };
});
import { callGenerate, callGenerateStream } from "@/lib/ai/api";
import {
  editScenePlan,
  generateScenePlan,
  generateSceneProse,
  generateScenes,
  reverseEngineerScenePlan,
  rewriteScenePlan,
  sanitizeScenes,
} from "@/lib/ai/scenes";
// ── Test Fixtures ────────────────────────────────────────────────────────────
function createScene(
  id: string,
  overrides: Partial<Scene> & { plan?: BeatPlan } = {},
): Scene {
  const { plan, ...rest } = overrides;
  return {
    kind: "scene",
    id,
    arcId: "ARC-1",
    povId: "C-1",
    locationId: "L-1",
    participantIds: ["C-1"],
    summary: `Scene ${id} summary`,
    events: ["event_1"],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    characterMovements: {},
    ...rest,
    ...(plan
      ? {
          planVersions: [
            {
              plan,
              branchId: "main",
              timestamp: Date.now(),
              version: "1",
              versionType: "generate" as const,
            },
          ],
        }
      : {}),
  };
}
function createCharacter(
  id: string,
  overrides: Partial<Character> = {},
): Character {
  return {
    id,
    name: `Character ${id}`,
    role: "recurring",
    threadIds: [],
    world: { nodes: {}, edges: [] },
    ...overrides,
  };
}
function createLocation(
  id: string,
  overrides: Partial<Location> = {},
): Location {
  return {
    id,
    name: `Location ${id}`,
    prominence: "place" as const,
    parentId: null,
    tiedCharacterIds: [],
    threadIds: [],
    world: { nodes: {}, edges: [] },
    ...overrides,
  };
}
function createThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    description: `Thread ${id} description`,
    outcomes: ["yes", "no"],
    beliefs: { narrator: { logits: [0, 0], volume: 2, volatility: 0 } },
    participants: [],
    dependents: [],
    openedAt: "s1",
    threadLog: { nodes: {}, edges: [] },
    ...overrides,
  };
}
function createMinimalNarrative(): NarrativeState {
  return {
    id: "N-1",
    title: "Test Narrative",
    description: "A test story",
    characters: {
      "C-1": createCharacter("C-1", { name: "Alice" }),
      "C-2": createCharacter("C-2", { name: "Bob" }),
    },
    locations: {
      "L-1": createLocation("L-1", { name: "Castle" }),
      "L-2": createLocation("L-2", { name: "Forest" }),
    },
    threads: {
      "T-1": createThread("T-1", { description: "Main quest" }),
      "T-2": createThread("T-2", { description: "Side quest" }),
    },
    artifacts: {},
    scenes: {},
    arcs: {},
    worldBuilds: {},
    branches: {
      main: {
        id: "main",
        name: "Main",
        parentBranchId: null,
        forkEntryId: null,
        entryIds: [],
        createdAt: Date.now(),
      },
    },
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: "A fantasy world",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
// ── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});
// ── generateScenes Tests ─────────────────────────────────────────────────────
describe("generateScenes", () => {
  it("returns parsed scenes and arc from LLM response", async () => {
    const mockResponse = JSON.stringify({
      arcName: "The Siege Begins",
      directionVector: "Alice leads the defense while Bob scouts.",
      scenes: [
        {
          id: "S-GEN-1",
          arcId: "ARC-1",
          locationId: "L-1",
          povId: "C-1",
          participantIds: ["C-1", "C-2"],
          events: ["battle_prep"],
          threadDeltas: [
            { threadId: "T-1", logType: "pulse", updates: [], volumeDelta: 1, rationale: "active→active" },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Alice prepares the castle defenses while Bob rides out.",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test direction");
    expect(result.scenes).toHaveLength(1);
    expect(result.arc.name).toBe("The Siege Begins");
    expect(result.scenes[0].summary).toContain("Alice prepares");
  });
  it("assigns sequential scene IDs", async () => {
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-1",
          arcId: "ARC-1",
          locationId: "L-1",
          povId: "C-1",
          participantIds: ["C-1"],
          events: [],
          threadDeltas: [],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene 1",
        },
        {
          id: "S-GEN-2",
          arcId: "ARC-1",
          locationId: "L-1",
          povId: "C-1",
          participantIds: ["C-1"],
          events: [],
          threadDeltas: [],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene 2",
        },
        {
          id: "S-GEN-3",
          arcId: "ARC-1",
          locationId: "L-1",
          povId: "C-1",
          participantIds: ["C-1"],
          events: [],
          threadDeltas: [],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene 3",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 3, "Test direction");
    expect(result.scenes[0].id).toBe("S-1");
    expect(result.scenes[1].id).toBe("S-2");
    expect(result.scenes[2].id).toBe("S-3");
  });
  it("sanitizes invalid character IDs from participantIds", async () => {
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-1",
          arcId: "ARC-1",
          locationId: "L-1",
          povId: "C-1",
          participantIds: ["C-1", "C-INVALID", "C-2"],
          events: [],
          threadDeltas: [],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Test scene",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test");
    // Invalid character should be stripped
    expect(result.scenes[0].participantIds).toEqual(["C-1", "C-2"]);
  });
  it("sanitizes invalid location IDs", async () => {
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-1",
          arcId: "ARC-1",
          locationId: "L-INVALID",
          povId: "C-1",
          participantIds: ["C-1"],
          events: [],
          threadDeltas: [],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Test scene",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test");
    // Invalid location should be replaced with first valid location
    expect(result.scenes[0].locationId).toBe("L-1");
  });
  it("sanitizes invalid thread IDs in threadDeltas", async () => {
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-1",
          arcId: "ARC-1",
          locationId: "L-1",
          povId: "C-1",
          participantIds: ["C-1"],
          events: [],
          threadDeltas: [
            { threadId: "T-1", logType: "pulse", updates: [], volumeDelta: 1, rationale: "active→active" },
            { threadId: "T-INVALID", logType: "escalation", updates: [{ outcome: "yes", evidence: 2 }], volumeDelta: 1, rationale: "active→critical" },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene 1",
        },
        {
          id: "S-GEN-2",
          arcId: "ARC-1",
          locationId: "L-2",
          povId: "C-2",
          participantIds: ["C-2"],
          events: [],
          threadDeltas: [
            { threadId: "T-2", logType: "escalation", updates: [{ outcome: "yes", evidence: 2 }], volumeDelta: 1, rationale: "First knowledge" },
            // Pulse with no log entries — should synthesize one too.
            { threadId: "T-2", logType: "pulse", updates: [], volumeDelta: 1, rationale: "active→active" },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test");
    // The T-INVALID delta references a non-existent thread and should be
    // dropped; the T-1 delta survives.
    expect(result.scenes[0].threadDeltas).toHaveLength(1);
    expect(result.scenes[0].threadDeltas[0].threadId).toBe("T-1");
    expect(result.scenes[0].threadDeltas[0].logType).toBe("pulse");
  });
  it('coerces invalid logType values to "pulse"', async () => {
    // If the LLM emits a logType outside the 9-primitive vocabulary the
    // sanitizer coerces it to "pulse" rather than dropping the delta.
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-1",
          arcId: "ARC-1",
          locationId: "L-1",
          povId: "C-1",
          participantIds: ["C-1"],
          events: [],
          threadDeltas: [
            // Invalid: "nonsense" is not in the log-type vocabulary.
            { threadId: "T-1", logType: "nonsense", updates: [{ outcome: "yes", evidence: 1 }], volumeDelta: 1, rationale: "will be coerced" },
            // Valid pulse pattern: attention-only maintenance.
            { threadId: "T-2", logType: "pulse", updates: [], volumeDelta: 1, rationale: "real pulse" },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test");
    const [t1, t2] = result.scenes[0].threadDeltas;
    expect(t1.logType).toBe("pulse"); // coerced
    expect(t2.logType).toBe("pulse"); // untouched
  });
});

// ── sanitizeScenes — newly-introduced entities visible to reference checks ──
// Regression: the LLM frequently puts a newly-introduced character ID in
// both `newCharacters` and `participantIds` of the same scene (the character
// participates in the scene that introduces them). If sanitization validates
// `participantIds` before registering `newCharacters`, the participant is
// stripped as "invalid" and the character disappears from scene inspectors,
// the world graph, and downstream logic. Entities registered in `new*`
// fields MUST be treated as valid references within the same scene.
describe("sanitizeScenes — introduced entities survive reference validation", () => {
  it("keeps newCharacter's id in participantIds", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1", "C-GEN-1"],
      povId: "C-1",
      locationId: "L-1",
      newCharacters: [
        {
          id: "C-GEN-1",
          name: "Liu He",
          role: "transient",
          threadIds: [],
          world: { nodes: {}, edges: [] },
        },
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.participantIds).toContain("C-GEN-1");
    expect(scene.newCharacters?.[0]?.id).toBe("C-GEN-1");
  });

  it("keeps newLocation's id as the scene's locationId", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-GEN-1",
      newLocations: [
        {
          id: "L-GEN-1",
          name: "Qing Mao Mountain's Edge",
          parentId: null,
          prominence: "place",
          tiedCharacterIds: [],
          threadIds: [],
          world: { nodes: {}, edges: [] },
        },
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.locationId).toBe("L-GEN-1");
  });

  it("keeps newArtifact's id in artifactUsages", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      artifactUsages: [{ artifactId: "A-GEN-1", characterId: "C-1", usage: "inspects" }],
      newArtifacts: [
        {
          id: "A-GEN-1",
          name: "Spring Autumn Cicada",
          significance: "key",
          parentId: null,
          threadIds: [],
          world: { nodes: {}, edges: [] },
        },
      ],
    } as unknown as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.artifactUsages?.[0]?.artifactId).toBe("A-GEN-1");
  });

  it("keeps newThread's id in threadDeltas", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      threadDeltas: [{ threadId: "T-GEN-1", logType: "setup", updates: [{ outcome: "yes", evidence: 1 }], volumeDelta: 1, rationale: "latent→seeded" }],
      newThreads: [
        {
          id: "T-GEN-1",
          description: "A fresh tension emerges",
          outcomes: ["yes", "no"],
          beliefs: { narrator: { logits: [0, 0], volume: 2, volatility: 0 } },
          participants: [],
          dependents: [],
          openedAt: "s1",
          threadLog: { nodes: {}, edges: [] },
        },
      ],
    } as unknown as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.threadDeltas.find((td) => td.threadId === "T-GEN-1")).toBeDefined();
  });

  it("keeps newCharacter's id as a worldDelta entityId", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1", "C-GEN-1"],
      povId: "C-1",
      locationId: "L-1",
      worldDeltas: [
        {
          entityId: "C-GEN-1",
          addedNodes: [{ id: "K-GEN-1", type: "trait", content: "calculating eyes" }],
        },
      ],
      newCharacters: [
        {
          id: "C-GEN-1",
          name: "Liu He",
          role: "transient",
          threadIds: [],
          world: { nodes: {}, edges: [] },
        },
      ],
    } as unknown as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.worldDeltas.find((wd) => wd.entityId === "C-GEN-1")).toBeDefined();
  });

  it("cross-scene: entity introduced in scene 1 is valid in scene 2", () => {
    const narrative = createMinimalNarrative();
    const scene1 = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      newCharacters: [
        {
          id: "C-GEN-1",
          name: "Liu He",
          role: "transient",
          threadIds: [],
          world: { nodes: {}, edges: [] },
        },
      ],
    } as Partial<Scene>);
    const scene2 = createScene("S-2", {
      participantIds: ["C-1", "C-GEN-1"],
      povId: "C-1",
      locationId: "L-1",
    } as Partial<Scene>);
    sanitizeScenes([scene1, scene2], narrative, "test");
    expect(scene2.participantIds).toContain("C-GEN-1");
  });

  it("still strips participantIds that reference genuinely unknown characters", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1", "C-DOES-NOT-EXIST"],
      povId: "C-1",
      locationId: "L-1",
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.participantIds).toContain("C-1");
    expect(scene.participantIds).not.toContain("C-DOES-NOT-EXIST");
  });

  it("auto-adds newCharacter ids to participantIds when the LLM forgot", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      newCharacters: [
        {
          id: "C-GEN-777",
          name: "Side Character",
          role: "transient",
          threadIds: [],
          world: {
            nodes: {
              "K-1": { id: "K-1", type: "trait", content: "Quiet, observant." },
            },
            edges: [],
          },
        },
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.participantIds).toContain("C-GEN-777");
  });
});

// ── sanitizeScenes — delta null-id edge cases ───────────────────────────────
describe("sanitizeScenes — delta null handling", () => {
  it("keeps ownershipDelta with null fromId (artifact introduced from nowhere)", () => {
    const narrative = createMinimalNarrative();
    narrative.artifacts = {
      "A-1": {
        id: "A-1",
        name: "Relic",
        significance: "notable",
        parentId: null,
        threadIds: [],
        world: { nodes: {}, edges: [] },
      },
    };
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      ownershipDeltas: [{ artifactId: "A-1", fromId: null, toId: "C-1" } as unknown as { artifactId: string; fromId: string; toId: string }],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.ownershipDeltas?.[0]).toEqual(
      expect.objectContaining({ artifactId: "A-1", fromId: null, toId: "C-1" }),
    );
  });

  it("keeps ownershipDelta with null toId (artifact discarded to nowhere)", () => {
    const narrative = createMinimalNarrative();
    narrative.artifacts = {
      "A-1": {
        id: "A-1",
        name: "Relic",
        significance: "notable",
        parentId: "C-1",
        threadIds: [],
        world: { nodes: {}, edges: [] },
      },
    };
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      ownershipDeltas: [{ artifactId: "A-1", fromId: "C-1", toId: null } as unknown as { artifactId: string; fromId: string; toId: string }],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.ownershipDeltas?.[0]).toEqual(
      expect.objectContaining({ artifactId: "A-1", fromId: "C-1", toId: null }),
    );
  });

  it("strips worldDelta entries with missing entityId", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      worldDeltas: [
        { entityId: "C-1", addedNodes: [{ id: "K-1", type: "trait", content: "x" }] },
        { entityId: "", addedNodes: [{ id: "K-2", type: "trait", content: "y" }] } as never,
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.worldDeltas).toHaveLength(1);
    expect(scene.worldDeltas[0].entityId).toBe("C-1");
  });

  it("strips newThread participants that reference unknown entities", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      newThreads: [
        {
          id: "T-GEN-1",
          description: "A tension",
          outcomes: ["yes", "no"],
          beliefs: { narrator: { logits: [0, 0], volume: 2, volatility: 0 } },
          participants: [
            { id: "C-1", type: "character" },
            { id: "C-GHOST", type: "character" },
          ],
          dependents: [],
          openedAt: "S-1",
          threadLog: { nodes: {}, edges: [] },
        },
      ],
    } as unknown as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.newThreads?.[0].participants).toEqual([
      { id: "C-1", type: "character" },
    ]);
  });

  it("drops phantom fields from newThread participants", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      newThreads: [
        {
          id: "T-GEN-1",
          description: "A tension",
          outcomes: ["yes", "no"],
          beliefs: { narrator: { logits: [0, 0], volume: 2, volatility: 0 } },
          participants: [
            { id: "C-1", type: "character", role: "active" } as unknown as { id: string; type: "character" },
          ],
          threadLog: { nodes: {}, edges: [] },
        },
      ],
    } as unknown as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.newThreads?.[0].participants[0]).toEqual({
      id: "C-1",
      type: "character",
    });
    expect(scene.newThreads?.[0].participants[0]).not.toHaveProperty("role");
  });

  it("defaults newThread openedAt and dependents when missing", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-7", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      newThreads: [
        {
          id: "T-GEN-1",
          description: "A tension",
          outcomes: ["yes", "no"],
          beliefs: { narrator: { logits: [0, 0], volume: 2, volatility: 0 } },
          participants: [],
          threadLog: { nodes: {}, edges: [] },
        } as unknown as never,
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.newThreads?.[0].openedAt).toBe("S-7");
    expect(scene.newThreads?.[0].dependents).toEqual([]);
  });
});

// ── sanitizeScenes — entity shape defaults ──────────────────────────────────
describe("sanitizeScenes — new entity shape", () => {
  it("defaults newLocation prominence to 'place' when missing", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      newLocations: [
        {
          id: "L-GEN-1",
          name: "Hidden Grove",
          parentId: null,
          tiedCharacterIds: [],
          threadIds: [],
          world: {
            nodes: { "K-1": { id: "K-1", type: "trait", content: "Moss-carpeted." } },
            edges: [],
          },
        } as unknown as never,
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.newLocations?.[0].prominence).toBe("place");
  });

  it("coerces invalid newLocation prominence to 'place'", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      newLocations: [
        {
          id: "L-GEN-1",
          name: "Ambiguous Spot",
          prominence: "nonsense" as unknown as "place",
          parentId: null,
          tiedCharacterIds: [],
          threadIds: [],
          world: {
            nodes: { "K-1": { id: "K-1", type: "trait", content: "Strange." } },
            edges: [],
          },
        },
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.newLocations?.[0].prominence).toBe("place");
  });

  it("defaults newArtifact parentId to null when missing", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      newArtifacts: [
        {
          id: "A-GEN-1",
          name: "Odd Relic",
          significance: "notable",
          threadIds: [],
          world: {
            nodes: { "K-1": { id: "K-1", type: "trait", content: "Glows faintly." } },
            edges: [],
          },
        } as unknown as never,
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.newArtifacts?.[0].parentId).toBeNull();
  });

  it("coerces invalid newArtifact significance to 'minor'", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      newArtifacts: [
        {
          id: "A-GEN-1",
          name: "Odd Relic",
          significance: "super-duper" as unknown as "minor",
          parentId: null,
          threadIds: [],
          world: {
            nodes: { "K-1": { id: "K-1", type: "trait", content: "Glows faintly." } },
            edges: [],
          },
        },
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.newArtifacts?.[0].significance).toBe("minor");
  });

  it("drops phantom fields the LLM emits outside the Artifact type", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      newArtifacts: [
        {
          id: "A-GEN-1",
          name: "Blood-Siphon Gu",
          significance: "notable",
          parentId: null,
          threadIds: [],
          description: "A translucent red worm.",
          utility: "Drains primeval essence.",
          world: {
            nodes: { "K-1": { id: "K-1", type: "trait", content: "Translucent red worm." } },
            edges: [],
          },
        } as unknown as never,
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.newArtifacts?.[0]).not.toHaveProperty("description");
    expect(scene.newArtifacts?.[0]).not.toHaveProperty("utility");
  });

  it("coerces invalid newCharacter role to 'transient'", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-1"],
      povId: "C-1",
      locationId: "L-1",
      newCharacters: [
        {
          id: "C-GEN-1",
          name: "Nameless",
          role: "sidekick" as unknown as "transient",
          threadIds: [],
          world: {
            nodes: { "K-1": { id: "K-1", type: "trait", content: "Watchful." } },
            edges: [],
          },
        },
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.newCharacters?.[0].role).toBe("transient");
  });
});
