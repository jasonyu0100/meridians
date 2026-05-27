import {
  averageSwing,
  buildCumulativeSystemGraph,
  classifyArchetype,
  classifyCurrentPosition,
  classifyNarrativeShape,
  classifyScale,
  classifyWorldDensity,
  computeActivityCurve,
  computeForceSnapshots,
  computeRawForceTotals,
  computeSwingMagnitudes,
  computeWindowedForces,
  cubeCornerProximity,
  detectCubeCorner,
  forceDistance,
  gradeForce,
  gradeForces,
  movingAverage,
  nextId,
  nextIds,
  rankSystemNodes,
  resolveEntrySequence,
  zScoreNormalize,
} from "@/lib/narrative-utils";
import type {
  Branch,
  ForceSnapshot,
  NarrativeState,
  Scene,
  SystemGraph,
} from "@/types/narrative";
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
function createNarrative(
  overrides: Partial<NarrativeState> = {},
): NarrativeState {
  return {
    id: "test-narrative",
    title: "Test",
    description: "Test narrative",
    characters: {},
    locations: {},
    threads: {},
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
    artifacts: {},
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}
// ── ID Generation ────────────────────────────────────────────────────────────
describe("nextId", () => {
  it("returns first ID when no existing IDs", () => {
    expect(nextId("C", [])).toBe("C-1");
    expect(nextId("S", [])).toBe("S-1");
  });
  it("increments from highest existing ID", () => {
    expect(nextId("C", ["C-1", "C-2", "C-3"])).toBe("C-4");
  });
  it("handles non-sequential existing IDs", () => {
    expect(nextId("C", ["C-1", "C-5", "C-3"])).toBe("C-6");
  });
  it("handles complex ID formats", () => {
    expect(nextId("C", ["C-1742000000-3", "C-1"])).toBe("C-4");
  });
  it("reads zero-padded historical IDs without aliasing them", () => {
    // Old data may carry "C-01" / "S-007" — parser tolerates them but the
    // allocator emits the canonical unpadded form, so SYS-17 and SYS-017
    // cannot coexist as duplicate output.
    expect(nextId("S", ["S-007", "S-002"])).toBe("S-8");
  });
});
describe("nextIds", () => {
  it("generates multiple sequential IDs", () => {
    const ids = nextIds("C", ["C-1"], 3);
    expect(ids).toEqual(["C-2", "C-3", "C-4"]);
  });
  it("handles empty existing IDs", () => {
    const ids = nextIds("S", [], 2);
    expect(ids).toEqual(["S-1", "S-2"]);
  });
});
// ── Branch Resolution ────────────────────────────────────────────────────────
describe("resolveEntrySequence", () => {
  it("returns empty array for non-existent branch", () => {
    const branches: Record<string, Branch> = {};
    expect(resolveEntrySequence(branches, "non-existent")).toEqual([]);
  });
  it("returns own entries for root branch", () => {
    const branches: Record<string, Branch> = {
      main: {
        id: "main",
        name: "Main",
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ["S-1", "S-2"],
        createdAt: 0,
      },
    };
    expect(resolveEntrySequence(branches, "main")).toEqual(["S-1", "S-2"]);
  });
  it("includes parent entries up to fork point", () => {
    const branches: Record<string, Branch> = {
      main: {
        id: "main",
        name: "Main",
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ["S-1", "S-2", "S-3"],
        createdAt: 0,
      },
      child: {
        id: "child",
        name: "Child",
        entryIds: ["S-4", "S-5"],
        parentBranchId: "main",
        forkEntryId: "S-2",
        createdAt: 1,
      },
    };
    expect(resolveEntrySequence(branches, "child")).toEqual([
      "S-1",
      "S-2",
      "S-4",
      "S-5",
    ]);
  });
  it("handles deeply nested branches", () => {
    const branches: Record<string, Branch> = {
      main: {
        id: "main",
        name: "Main",
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ["S-1", "S-2"],
        createdAt: 0,
      },
      child: {
        id: "child",
        name: "Child",
        entryIds: ["S-3"],
        parentBranchId: "main",
        forkEntryId: "S-1",
        createdAt: 1,
      },
      grandchild: {
        id: "grandchild",
        name: "Grandchild",
        entryIds: ["S-4"],
        parentBranchId: "child",
        forkEntryId: "S-3",
        createdAt: 2,
      },
    };
    expect(resolveEntrySequence(branches, "grandchild")).toEqual([
      "S-1",
      "S-3",
      "S-4",
    ]);
  });
});
// Thread status computation was removed with the lifecycle→market migration.
// Market-state derivation (probs, closure, abandonment) is covered in
// thread-log.test.ts and auto-engine.test.ts.
// ── Force Distance & Cube Detection ──────────────────────────────────────────
describe("forceDistance", () => {
  it("returns 0 for identical snapshots", () => {
    const a: ForceSnapshot = { fate: 1, world: 1, system: 1 };
    expect(forceDistance(a, a)).toBe(0);
  });
  it("computes Euclidean distance", () => {
    const a: ForceSnapshot = { fate: 0, world: 0, system: 0 };
    const b: ForceSnapshot = { fate: 3, world: 4, system: 0 };
    expect(forceDistance(a, b)).toBe(5);
  });
});
describe("detectCubeCorner", () => {
  it("detects HHH corner for high forces", () => {
    const forces: ForceSnapshot = { fate: 1.5, world: 1.5, system: 1.5 };
    const corner = detectCubeCorner(forces);
    expect(corner.key).toBe("HHH");
  });
  it("detects LLL corner for low forces", () => {
    const forces: ForceSnapshot = { fate: -1.5, world: -1.5, system: -1.5 };
    const corner = detectCubeCorner(forces);
    expect(corner.key).toBe("LLL");
  });
});
describe("cubeCornerProximity", () => {
  it("returns 1 when at the corner", () => {
    const forces: ForceSnapshot = { fate: 1, world: 1, system: 1 };
    expect(cubeCornerProximity(forces, "HHH")).toBeCloseTo(1, 1);
  });
  it("returns smaller values further from corner", () => {
    const close: ForceSnapshot = { fate: 0.9, world: 0.9, system: 0.9 };
    const far: ForceSnapshot = { fate: -1, world: -1, system: -1 };
    expect(cubeCornerProximity(close, "HHH")).toBeGreaterThan(
      cubeCornerProximity(far, "HHH"),
    );
  });
});
// ── Swing Computation ────────────────────────────────────────────────────────
describe("computeSwingMagnitudes", () => {
  it("returns [0] for single snapshot", () => {
    const snapshots: ForceSnapshot[] = [{ fate: 1, world: 1, system: 1 }];
    expect(computeSwingMagnitudes(snapshots)).toEqual([0]);
  });
  it("computes Euclidean distance between consecutive snapshots", () => {
    const snapshots: ForceSnapshot[] = [
      { fate: 0, world: 0, system: 0 },
      { fate: 1, world: 0, system: 0 },
    ];
    const swings = computeSwingMagnitudes(snapshots);
    expect(swings[0]).toBe(0);
    expect(swings[1]).toBe(1);
  });
  it("normalizes by reference means when provided", () => {
    const snapshots: ForceSnapshot[] = [
      { fate: 0, world: 0, system: 0 },
      { fate: 2, world: 0, system: 0 },
    ];
    const refMeans = { fate: 2, world: 1, system: 1 };
    const swings = computeSwingMagnitudes(snapshots, refMeans);
    expect(swings[1]).toBe(1); // 2/2 = 1
  });
});
describe("averageSwing", () => {
  it("returns 0 for empty or single snapshot", () => {
    expect(averageSwing([])).toBe(0);
    expect(averageSwing([{ fate: 1, world: 1, system: 1 }])).toBe(0);
  });
});
// ── Z-Score Normalization ────────────────────────────────────────────────────
describe("zScoreNormalize", () => {
  it("returns empty array for empty input", () => {
    expect(zScoreNormalize([])).toEqual([]);
  });
  it("returns all zeros for constant values", () => {
    expect(zScoreNormalize([5, 5, 5, 5])).toEqual([0, 0, 0, 0]);
  });
  it("normalizes with mean 0 and unit std", () => {
    const values = [2, 4, 6, 8];
    const normalized = zScoreNormalize(values);
    // Mean should be 0
    const mean = normalized.reduce((s, v) => s + v, 0) / normalized.length;
    expect(mean).toBeCloseTo(0, 5);
    // Std should be ~1
    const variance =
      normalized.reduce((s, v) => s + v * v, 0) / normalized.length;
    expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
  });
});
// ── Force Computation ────────────────────────────────────────────────────────
describe("computeForceSnapshots", () => {
  it("returns empty object for empty scenes", () => {
    expect(computeForceSnapshots([])).toEqual({});
  });
  it("computes z-score normalized forces", () => {
    const scenes: Scene[] = [
      createScene({
        id: "S-1",
        threadDeltas: [
          { threadId: "T-1", logType: "setup", updates: [{ outcome: "yes", evidence: 1 }], volumeDelta: 1, rationale: "latent→seeded" },
        ],
        worldDeltas: [],
        events: ["event1"],
      }),
      createScene({
        id: "S-2",
        threadDeltas: [
          { threadId: "T-1", logType: "setup", updates: [{ outcome: "yes", evidence: 1 }], volumeDelta: 1, rationale: "seeded→active" },
        ],
        worldDeltas: [
          {
            entityId: "C-1",
            addedNodes: [{ id: "K-1", content: "secret", type: "secret" }],
          },
        ],
        events: ["event1", "event2"],
      }),
    ];
    const snapshots = computeForceSnapshots(scenes);
    expect(Object.keys(snapshots)).toHaveLength(2);
    expect(snapshots["S-1"]).toBeDefined();
    expect(snapshots["S-2"]).toBeDefined();
  });
});
describe("computeRawForceTotals", () => {
  it("returns empty arrays for empty scenes", () => {
    const result = computeRawForceTotals([]);
    expect(result).toEqual({ fate: [], world: [], system: [] });
  });
  it("computes raw values without normalization", () => {
    const scenes: Scene[] = [
      createScene({
        id: "S-1",
        threadDeltas: [
          { threadId: "T-1", logType: "setup", updates: [{ outcome: "yes", evidence: 1 }], volumeDelta: 1, rationale: "opens" },
        ],
      }),
    ];
    const result = computeRawForceTotals(scenes);
    expect(result.fate).toHaveLength(1);
    // F = log(1 + 1) × (1 + log(1 + 1)) = ln(2) × (1 + ln(2))
    expect(result.fate[0]).toBeCloseTo(Math.log(2) * (1 + Math.log(2)));
  });
});

// ── Fate formula invariants (market model) ─────────────────────────────────
// Fate is the information-gain approximation:
//   F ≈ Σ log(1 + peak_|evidence|) × (1 + log(1 + volumeDelta))
// The invariants below lock the shape: stronger evidence earns more, higher
// volume scales linearly in log, zero-update / zero-volume deltas earn zero,
// and sign of evidence doesn't matter (twists earn like payoffs).
describe("fate formula invariants", () => {
  const fate = (evidence: number, volumeDelta = 0) =>
    computeRawForceTotals([
      createScene({
        threadDeltas: [{
          threadId: 'T-1',
          logType: 'payoff',
          updates: [{ outcome: 'yes', evidence }],
          volumeDelta,
          rationale: 'test',
        }],
      }),
    ]).fate[0];

  it("stronger evidence earns strictly more fate", () => {
    const prev = [0, 1, 2, 3, 4].map((e) => fate(e));
    for (let i = 1; i < prev.length; i++) {
      expect(prev[i]).toBeGreaterThan(prev[i - 1]);
    }
  });

  it("evidence sign is irrelevant (peak absolute value drives fate)", () => {
    expect(fate(3)).toBeCloseTo(fate(-3));
    expect(fate(4)).toBeCloseTo(fate(-4));
  });

  it("zero evidence + zero volume earns zero fate", () => {
    expect(fate(0, 0)).toBe(0);
  });

  it("higher volume scales fate up for the same evidence", () => {
    const low = fate(3, 0);
    const high = fate(3, 4);
    expect(high).toBeGreaterThan(low);
  });

  it("saturating evidence (+4) matches log(5) × unit-volume", () => {
    // log(1+4) × (1 + log(1+0)) = log(5) ≈ 1.609
    expect(fate(4, 0)).toBeCloseTo(Math.log(5));
  });

  it("multiple updates within a delta use the peak", () => {
    const scene = createScene({
      threadDeltas: [{
        threadId: 'T-1',
        logType: 'payoff',
        updates: [
          { outcome: 'yes', evidence: 1 },
          { outcome: 'no', evidence: -4 },
        ],
        volumeDelta: 0,
        rationale: 'test',
      }],
    });
    expect(computeRawForceTotals([scene]).fate[0]).toBeCloseTo(Math.log(5));
  });
});
// ── Moving Average ───────────────────────────────────────────────────────────
describe("movingAverage", () => {
  it("returns same array for window size 1", () => {
    const data = [1, 2, 3, 4, 5];
    expect(movingAverage(data, 1)).toEqual(data);
  });
  it("computes correct moving averages", () => {
    const data = [1, 2, 3, 4, 5];
    const result = movingAverage(data, 3);
    expect(result[0]).toBe(1); // [1]
    expect(result[1]).toBe(1.5); // [1, 2]
    expect(result[2]).toBe(2); // [1, 2, 3]
    expect(result[3]).toBe(3); // [2, 3, 4]
    expect(result[4]).toBe(4); // [3, 4, 5]
  });
});
// ── Activity Curve ───────────────────────────────────────────────────────────
describe("computeActivityCurve", () => {
  it("returns empty array for empty input", () => {
    expect(computeActivityCurve([])).toEqual([]);
  });
  it("computes activity points with all properties", () => {
    const snapshots: ForceSnapshot[] = [
      { fate: 0, world: 0, system: 0 },
      { fate: 1, world: 1, system: 1 },
      { fate: -1, world: -1, system: -1 },
      { fate: 0.5, world: 0.5, system: 0.5 },
    ];
    const curve = computeActivityCurve(snapshots);
    expect(curve).toHaveLength(4);
    for (const point of curve) {
      expect(point).toHaveProperty("index");
      expect(point).toHaveProperty("activity");
      expect(point).toHaveProperty("tension");
      expect(point).toHaveProperty("smoothed");
      expect(point).toHaveProperty("macroTrend");
      expect(point).toHaveProperty("isPeak");
      expect(point).toHaveProperty("isValley");
    }
  });
});
// ── Shape Classification ─────────────────────────────────────────────────────
describe("classifyNarrativeShape", () => {
  it("returns flat for very short delivery arrays", () => {
    const shape = classifyNarrativeShape([0.5, 0.5, 0.5]);
    expect(shape.key).toBe("flat");
  });
  it("returns flat for constant deliveries", () => {
    const deliveries = Array(20).fill(0.5);
    const shape = classifyNarrativeShape(deliveries);
    expect(shape.key).toBe("flat");
  });
  it("detects escalating pattern for rising deliveries", () => {
    const deliveries = Array(20)
      .fill(0)
      .map((_, i) => i * 0.1);
    const shape = classifyNarrativeShape(deliveries);
    expect(shape.key).toBe("escalating");
  });
});
// ── Archetype Classification ─────────────────────────────────────────────────
describe("classifyArchetype", () => {
  it("returns opus when every force clears the Opus floor (≥22)", () => {
    // All three at 22 or higher → opus. The floor sits one notch above the
    // dominance floor (21), so clearly-balanced profiles like 22/23/24 land
    // here instead of being demoted to a two-force pair.
    expect(
      classifyArchetype({ fate: 22, world: 22, system: 22, swing: 20, overall: 86 }).key,
    ).toBe("opus");
    expect(
      classifyArchetype({ fate: 22, world: 23, system: 24, swing: 20, overall: 89 }).key,
    ).toBe("opus");
    expect(
      classifyArchetype({ fate: 24, world: 25, system: 23, swing: 20, overall: 92 }).key,
    ).toBe("opus");
  });
  it("demotes three-way nominal dominance when any force sits below the Opus floor", () => {
    // fate 24 + world 21 + system 24 — all three nominally dominant (≥21,
    // within 5 of max), but world=21 is below Opus floor 22. Weakest force
    // (world) is dropped, leaving fate + system → atlas.
    expect(
      classifyArchetype({ fate: 24, world: 21, system: 24, swing: 20, overall: 89 }).key,
    ).toBe("atlas");
    // fate weakest of the three-way → chronicle (world + system)
    expect(
      classifyArchetype({ fate: 21, world: 24, system: 24, swing: 20, overall: 89 }).key,
    ).toBe("chronicle");
    // system weakest of the three-way → series (fate + world)
    expect(
      classifyArchetype({ fate: 24, world: 24, system: 21, swing: 20, overall: 89 }).key,
    ).toBe("series");
  });
  it("returns series for co-dominant fate + world", () => {
    const grades = { fate: 24, world: 23, system: 15, swing: 18, overall: 80 };
    expect(classifyArchetype(grades).key).toBe("series");
  });
  it("returns atlas for co-dominant fate + system", () => {
    const grades = { fate: 24, world: 15, system: 22, swing: 18, overall: 79 };
    expect(classifyArchetype(grades).key).toBe("atlas");
  });
  it("returns chronicle for co-dominant world + system", () => {
    const grades = { fate: 15, world: 23, system: 22, swing: 18, overall: 78 };
    expect(classifyArchetype(grades).key).toBe("chronicle");
  });
  it("returns classic for fate-dominant", () => {
    const grades = { fate: 24, world: 15, system: 15, swing: 18, overall: 72 };
    expect(classifyArchetype(grades).key).toBe("classic");
  });
  it("returns stage for world-dominant", () => {
    const grades = { fate: 15, world: 24, system: 15, swing: 18, overall: 72 };
    expect(classifyArchetype(grades).key).toBe("stage");
  });
  it("returns paper for system-dominant", () => {
    const grades = { fate: 15, world: 15, system: 24, swing: 18, overall: 72 };
    expect(classifyArchetype(grades).key).toBe("paper");
  });
  it("requires ≥21 to count as dominant even if within 5 of max", () => {
    // fate 20 is within 5 of max but below the dominance floor → no fate
    // dominance. With world 20 below floor too, only system dominates → paper.
    const grades = { fate: 20, world: 20, system: 22, swing: 12, overall: 70 };
    expect(classifyArchetype(grades).key).toBe("paper");
  });
  it("returns emerging for low grades", () => {
    const grades = { fate: 10, world: 12, system: 8, swing: 10, overall: 40 };
    expect(classifyArchetype(grades).key).toBe("emerging");
  });
  it("returns emerging when all forces are below the dominance floor", () => {
    // All within 5 of each other, all below 21 — no dominant force
    const grades = { fate: 19, world: 20, system: 18, swing: 14, overall: 68 };
    expect(classifyArchetype(grades).key).toBe("emerging");
  });
});
// ── Scale Classification ─────────────────────────────────────────────────────
describe("classifyScale", () => {
  it("classifies by scene count", () => {
    expect(classifyScale(10).key).toBe("short");
    expect(classifyScale(30).key).toBe("story");
    expect(classifyScale(80).key).toBe("novel");
    expect(classifyScale(200).key).toBe("epic");
    expect(classifyScale(500).key).toBe("serial");
  });
});
// ── World Density Classification ─────────────────────────────────────────────
describe("classifyWorldDensity", () => {
  it("returns sparse for zero scenes", () => {
    expect(classifyWorldDensity(0, 5, 3, 2, 10).key).toBe("sparse");
  });
  it("calculates density correctly", () => {
    // (10 + 5 + 5 + 5) / 10 = 2.5
    const result = classifyWorldDensity(10, 10, 5, 5, 5);
    expect(result.density).toBeCloseTo(2.5, 1);
    expect(result.key).toBe("rich");
  });
});
// ── Current Position Classification ──────────────────────────────────────────
describe("classifyCurrentPosition", () => {
  it("returns stable for empty points", () => {
    expect(classifyCurrentPosition([]).key).toBe("stable");
  });
  it("detects peak when last point is peak", () => {
    const points = [
      { index: 0, activity: 0.2, tension: 0, smoothed: 0.2, macroTrend: 0.3, isPeak: false, isValley: false },
      { index: 1, activity: 0.8, tension: 0, smoothed: 0.8, macroTrend: 0.5, isPeak: true, isValley: false },
    ];
    expect(classifyCurrentPosition(points).key).toBe("peak");
  });
  it("detects trough when last point is valley", () => {
    const points = [
      { index: 0, activity: 0.8, tension: 0, smoothed: 0.8, macroTrend: 0.5, isPeak: false, isValley: false },
      { index: 1, activity: 0.2, tension: 0, smoothed: 0.2, macroTrend: 0.3, isPeak: false, isValley: true },
    ];
    expect(classifyCurrentPosition(points).key).toBe("trough");
  });
});
// ── Windowed Forces ──────────────────────────────────────────────────────────
describe("computeWindowedForces", () => {
  it("returns empty result for empty scenes", () => {
    const result = computeWindowedForces([], 0);
    expect(result.forceMap).toEqual({});
  });
  it("computes forces within window", () => {
    const scenes = [
      createScene({ id: "S-1" }),
      createScene({ id: "S-2" }),
      createScene({ id: "S-3" }),
    ];
    const result = computeWindowedForces(scenes, 2, 2);
    expect(result.windowStart).toBe(1);
    expect(result.windowEnd).toBe(2);
    expect(Object.keys(result.forceMap)).toContain("S-2");
    expect(Object.keys(result.forceMap)).toContain("S-3");
  });
});
// ── Grading Functions ────────────────────────────────────────────────────────
describe("gradeForce", () => {
  it("returns floor of 8 for 0 input", () => {
    expect(gradeForce(0)).toBe(8);
  });
  it("caps at 25", () => {
    expect(gradeForce(100)).toBe(25);
  });
  it("returns 21 at normalized mean of 1 (dominance threshold)", () => {
    expect(gradeForce(1)).toBe(21);
  });
  it("returns floor of 8 at zero", () => {
    expect(gradeForce(0)).toBe(8);
  });
});
describe("gradeForces", () => {
  it("returns grades for each force and overall", () => {
    const grades = gradeForces(
      [2.5, 2.5], // fate at reference
      [7, 7], // world at reference
      [4, 4], // system at reference
      [1, 1], // swing
    );
    expect(grades).toHaveProperty("fate");
    expect(grades).toHaveProperty("world");
    expect(grades).toHaveProperty("system");
    expect(grades).toHaveProperty("swing");
    expect(grades).toHaveProperty("overall");
    // Individual grades are rounded before summing for overall, which is also rounded
    // So overall should be within ±2 of the sum due to rounding
    const sum = grades.fate + grades.world + grades.system + grades.swing;
    expect(Math.abs(grades.overall - sum)).toBeLessThanOrEqual(2);
  });
});
// ── System Knowledge Graph ────────────────────────────────────────────────────
describe("rankSystemNodes", () => {
  it("returns empty array for empty graph", () => {
    const graph: SystemGraph = { nodes: {}, edges: [] };
    expect(rankSystemNodes(graph)).toEqual([]);
  });
  it("ranks nodes by degree centrality", () => {
    const graph: SystemGraph = {
      nodes: {
        "K-1": { id: "K-1", concept: "Magic", type: "system" },
        "K-2": { id: "K-2", concept: "Wands", type: "system" },
        "K-3": { id: "K-3", concept: "Spells", type: "concept" },
      },
      edges: [
        { from: "K-1", to: "K-2", relation: "enables" },
        { from: "K-1", to: "K-3", relation: "enables" },
        { from: "K-2", to: "K-3", relation: "produces" },
      ],
    };
    const ranked = rankSystemNodes(graph);
    expect(ranked[0].node.id).toBe("K-1"); // degree 2
  });
});
describe("buildCumulativeSystemGraph", () => {
  it("accumulates deltas from scenes", () => {
    const scenes: Record<string, Scene> = {
      "S-1": createScene({
        id: "S-1",
        systemDeltas: {
          addedNodes: [{ id: "K-1", concept: "Magic", type: "system" }],
          addedEdges: [],
        },
      }),
      "S-2": createScene({
        id: "S-2",
        systemDeltas: {
          addedNodes: [{ id: "K-2", concept: "Wands", type: "system" }],
          addedEdges: [{ from: "K-1", to: "K-2", relation: "enables" }],
        },
      }),
    };
    const graph = buildCumulativeSystemGraph(scenes, ["S-1", "S-2"], 1);
    expect(Object.keys(graph.nodes)).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });
});
