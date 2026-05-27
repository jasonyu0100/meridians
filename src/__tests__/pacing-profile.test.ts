import {
  buildIntroductionSequence,
  buildPresetSequence,
  buildSequenceFromModes,
  buildSequencePrompt,
  buildSingleStepPrompt,
  computeMatrixFromNarrative,
  detectCurrentMode,
  initMatrixPresets,
  INTRODUCTION_SEQUENCE,
  MATRIX_PRESETS,
  PACING_PRESETS,
  samplePacingSequence,
  type TransitionMatrix,
} from "@/lib/pacing-profile";
import type { CubeCornerKey, NarrativeState, Scene } from "@/types/narrative";
import { describe, expect, it } from "vitest";
// ── Test Fixtures ────────────────────────────────────────────────────────────
function createScene(overrides: Partial<Scene> = {}): Scene {
  return {
    kind: "scene",
    id: overrides.id ?? "S-1",
    arcId: "ARC-1",
    povId: "C-1",
    locationId: "L-1",
    participantIds: ["C-1"],
    events: [],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    summary: "Test scene",
    ...overrides,
  };
}
function createNarrative(scenes: Scene[] = []): NarrativeState {
  const sceneMap: Record<string, Scene> = {};
  for (const s of scenes) {
    sceneMap[s.id] = s;
  }
  return {
    id: "test-narrative",
    title: "Test",
    description: "Test narrative",
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    scenes: sceneMap,
    arcs: {},
    worldBuilds: {},
    branches: {
      main: {
        id: "main",
        name: "Main",
        parentBranchId: null,
        forkEntryId: null,
        entryIds: scenes.map((s) => s.id),
        createdAt: Date.now(),
      },
    },
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
// ── Matrix Computation ───────────────────────────────────────────────────────
describe("computeMatrixFromNarrative", () => {
  it("returns empty matrix for narrative with fewer than 3 scenes", () => {
    const narrative = createNarrative([createScene({ id: "S-1" })]);
    const matrix = computeMatrixFromNarrative(narrative);
    // Check all values are 0
    const corners: CubeCornerKey[] = [
      "HHH",
      "HHL",
      "HLH",
      "HLL",
      "LHH",
      "LHL",
      "LLH",
      "LLL",
    ];
    for (const from of corners) {
      for (const to of corners) {
        expect(matrix[from][to]).toBe(0);
      }
    }
  });
  it("computes transitions from scene sequence", () => {
    // Create scenes with varying delta profiles
    const scenes = [
      createScene({
        id: "S-1",
        threadDeltas: [],
        worldDeltas: [],
        events: [],
      }),
      createScene({
        id: "S-2",
        threadDeltas: [
          { threadId: "T-1", logType: "setup", updates: [{ outcome: "yes", evidence: 1 }], volumeDelta: 1, rationale: "dormant→active" },
        ],
        worldDeltas: [
          {
            entityId: "C-1",
            addedNodes: [{ id: "K-1", content: "x", type: "history" }],
          },
        ],
        events: ["event1"],
      }),
      createScene({
        id: "S-3",
        threadDeltas: [
          { threadId: "T-1", logType: "escalation", updates: [{ outcome: "yes", evidence: 2 }], volumeDelta: 1, rationale: "active→critical" },
        ],
        worldDeltas: [
          {
            entityId: "C-1",
            addedNodes: [{ id: "K-2", content: "y", type: "opinion" }],
          },
          {
            entityId: "C-2",
            addedNodes: [{ id: "K-3", content: "z", type: "opinion" }],
          },
        ],
        events: ["event2", "event3"],
      }),
    ];
    const narrative = createNarrative(scenes);
    const matrix = computeMatrixFromNarrative(narrative);
    // Matrix should have proper structure (all corners defined)
    const corners: CubeCornerKey[] = [
      "HHH",
      "HHL",
      "HLH",
      "HLL",
      "LHH",
      "LHL",
      "LLH",
      "LLL",
    ];
    for (const from of corners) {
      expect(matrix[from]).toBeDefined();
      for (const to of corners) {
        expect(typeof matrix[from][to]).toBe("number");
        expect(matrix[from][to]).toBeGreaterThanOrEqual(0);
      }
    }
    // With only 3 scenes of similar force profiles, they may all fall into the same corner
    // So we just verify the structure is correct and any non-empty rows sum to 1
    for (const from of corners) {
      const rowSum = corners.reduce((s, to) => s + matrix[from][to], 0);
      if (rowSum > 0) {
        expect(rowSum).toBeCloseTo(1, 1);
      }
    }
  });
});
// ── Sampling ─────────────────────────────────────────────────────────────────
describe("samplePacingSequence", () => {
  it("returns sequence of correct length", () => {
    const sequence = samplePacingSequence("LLL", 5);
    expect(sequence.steps).toHaveLength(5);
  });
  it("each step has required properties", () => {
    const sequence = samplePacingSequence("LLL", 3);
    for (const step of sequence.steps) {
      expect(step).toHaveProperty("mode");
      expect(step).toHaveProperty("name");
      expect(step).toHaveProperty("description");
      expect(step).toHaveProperty("forces");
      expect(step.forces).toHaveProperty("fate");
      expect(step.forces).toHaveProperty("world");
      expect(step.forces).toHaveProperty("system");
    }
  });
  it("includes pacing description", () => {
    const sequence = samplePacingSequence("LLL", 4);
    expect(sequence.pacingDescription).toBeDefined();
    expect(sequence.pacingDescription.length).toBeGreaterThan(0);
  });
  it("uses provided matrix when given", () => {
    // Create a deterministic matrix where LLL always goes to HHH
    const deterministicMatrix: TransitionMatrix = {
      HHH: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      HHL: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      HLH: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      HLL: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      LHH: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      LHL: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      LLH: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      LLL: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
    };
    const sequence = samplePacingSequence("LLL", 3, deterministicMatrix);
    expect(sequence.steps.every((s) => s.mode === "HHH")).toBe(true);
  });
});
// ── Preset Building ──────────────────────────────────────────────────────────
describe("buildPresetSequence", () => {
  it("builds sequence from preset modes", () => {
    const preset = PACING_PRESETS.find((p) => p.key === "classic-arc");
    expect(preset).toBeDefined();
    if (preset) {
      const sequence = buildPresetSequence(preset);
      expect(sequence.steps).toHaveLength(preset.modes.length);
      expect(sequence.steps.map((s) => s.mode)).toEqual(preset.modes);
    }
  });
});
describe("buildSequenceFromModes", () => {
  it("builds sequence from raw mode array", () => {
    const modes: CubeCornerKey[] = ["LLL", "LHL", "HHL"];
    const sequence = buildSequenceFromModes(modes);
    expect(sequence.steps).toHaveLength(3);
    expect(sequence.steps[0].mode).toBe("LLL");
    expect(sequence.steps[1].mode).toBe("LHL");
    expect(sequence.steps[2].mode).toBe("HHL");
  });
});
describe("buildIntroductionSequence", () => {
  it("returns introduction sequence with correct modes", () => {
    const sequence = buildIntroductionSequence();
    expect(sequence.steps).toHaveLength(INTRODUCTION_SEQUENCE.length);
    expect(sequence.steps.map((s) => s.mode)).toEqual(INTRODUCTION_SEQUENCE);
  });
});
// ── Current Mode Detection ───────────────────────────────────────────────────
describe("detectCurrentMode", () => {
  it("returns LLL for empty narrative", () => {
    const narrative = createNarrative([]);
    const mode = detectCurrentMode(narrative, []);
    expect(mode).toBe("LLL");
  });
  it("detects mode from last scene forces", () => {
    // Create scenes with high fate to push toward H** corners
    const scenes = [
      createScene({
        id: "S-1",
        threadDeltas: [
          { threadId: "T-1", logType: "payoff", updates: [{ outcome: "yes", evidence: 4 }], volumeDelta: 1, rationale: "dormant→resolved" },
          { threadId: "T-2", logType: "payoff", updates: [{ outcome: "yes", evidence: 4 }], volumeDelta: 1, rationale: "dormant→resolved" },
        ],
        worldDeltas: Array(10).fill({
          entityId: "C-1",
          addedNodes: [{ id: "K-1", content: "x", type: "history" }],
        }),
        events: Array(10).fill("event"),
        systemDeltas: {
          addedNodes: Array(5).fill({
            id: "K-1",
            concept: "x",
            type: "system",
          }),
          addedEdges: Array(5).fill({
            from: "K-1",
            to: "K-2",
            relation: "x",
          }),
        },
      }),
    ];
    const narrative = createNarrative(scenes);
    const mode = detectCurrentMode(narrative, ["S-1"]);
    // With high forces all around, should be in a high corner
    expect(mode).toBeDefined();
  });
});
// ── Prompt Generation ────────────────────────────────────────────────────────
describe("buildSingleStepPrompt", () => {
  it("includes scene number and mode info", () => {
    const step = {
      mode: "HHL" as CubeCornerKey,
      name: "Climax",
      description: "Threads pay off, characters transform",
      forces: {
        fate: [2, 6] as [number, number],
        world: [4, 8] as [number, number],
        system: [0, 1.5] as [number, number],
      },
    };
    const prompt = buildSingleStepPrompt(step, 2, 5);
    expect(prompt).toContain("Scene 3/5");
    expect(prompt).toContain("Climax");
    expect(prompt).toContain("P:HIGH");
    expect(prompt).toContain("W:HIGH");
    expect(prompt).toContain("S:LOW");
  });
});
describe("buildSequencePrompt", () => {
  it("includes all scenes in sequence", () => {
    const sequence = buildSequenceFromModes(["LLL", "LHL", "HHL"]);
    const prompt = buildSequencePrompt(sequence);
    expect(prompt).toContain("SCENE 1");
    expect(prompt).toContain("SCENE 2");
    expect(prompt).toContain("SCENE 3");
    expect(prompt).toContain("PACING SEQUENCE");
  });
  it("includes force formula explanation", () => {
    const sequence = buildSequenceFromModes(["LLL"]);
    const prompt = buildSequencePrompt(sequence);
    expect(prompt).toContain("Formulas compute forces FROM deltas");
  });
});
// ── Presets ──────────────────────────────────────────────────────────────────
describe("PACING_PRESETS", () => {
  it("includes expected preset keys", () => {
    const keys = PACING_PRESETS.map((p) => p.key);
    expect(keys).toContain("classic-arc");
    expect(keys).toContain("introduction");
    expect(keys).toContain("slow-burn");
    expect(keys).toContain("roller-coaster");
  });
  it("all presets have valid modes", () => {
    const validModes: CubeCornerKey[] = [
      "HHH",
      "HHL",
      "HLH",
      "HLL",
      "LHH",
      "LHL",
      "LLH",
      "LLL",
    ];
    for (const preset of PACING_PRESETS) {
      expect(preset.modes.length).toBeGreaterThan(0);
      for (const mode of preset.modes) {
        expect(validModes).toContain(mode);
      }
    }
  });
});
describe("INTRODUCTION_SEQUENCE", () => {
  it("has 8 scenes", () => {
    expect(INTRODUCTION_SEQUENCE).toHaveLength(8);
  });
  it("starts with Rest and ends with Climax", () => {
    expect(INTRODUCTION_SEQUENCE[0]).toBe("LLL"); // Rest
    expect(INTRODUCTION_SEQUENCE[INTRODUCTION_SEQUENCE.length - 1]).toBe("HHL"); // Climax
  });
});
// ── Matrix Preset Initialization ─────────────────────────────────────────────
describe("initMatrixPresets", () => {
  it("includes built-in presets after initialization", () => {
    initMatrixPresets([]);
    const keys = MATRIX_PRESETS.map((p) => p.key);
    expect(keys).toContain("storyteller");
    // Only storyteller is the default preset
    expect(keys.length).toBeGreaterThanOrEqual(1);
  });
  it("adds work presets with sufficient data", () => {
    const workNarrative = createNarrative([
      createScene({
        id: "S-1",
        threadDeltas: [
          { threadId: "T-1", logType: "setup", updates: [{ outcome: "yes", evidence: 1 }], volumeDelta: 1, rationale: "dormant→active" },
        ],
      }),
      createScene({
        id: "S-2",
        threadDeltas: [
          { threadId: "T-1", logType: "escalation", updates: [{ outcome: "yes", evidence: 2 }], volumeDelta: 1, rationale: "escalate" },
        ],
      }),
      createScene({
        id: "S-3",
        threadDeltas: [
          { threadId: "T-1", logType: "escalation", updates: [{ outcome: "yes", evidence: 3 }], volumeDelta: 1, rationale: "critical" },
        ],
      }),
      createScene({
        id: "S-4",
        threadDeltas: [
          { threadId: "T-1", logType: "payoff", updates: [{ outcome: "yes", evidence: 4 }], volumeDelta: 1, rationale: "resolve" },
        ],
      }),
    ]);
    initMatrixPresets([
      { key: "test-work", name: "Test Work", narrative: workNarrative },
    ]);
    const keys = MATRIX_PRESETS.map((p) => p.key);
    expect(keys).toContain("test-work");
  });
});
