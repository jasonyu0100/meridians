import { computeCumulativePositions } from "@/lib/positions";
import type { NarrativeState, Scene } from "@/types/narrative";
import { describe, expect, it } from "vitest";

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: "scene",
    id,
    arcId: "ARC-1",
    povId: null,
    locationId: "L-1",
    participantIds: [],
    summary: "",
    events: [],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    ...overrides,
  };
}

function narrative(scenes: Record<string, Scene>): NarrativeState {
  return {
    id: "N-1",
    title: "Test",
    characters: {},
    locations: {},
    artifacts: {},
    threads: {},
    relationships: [],
    arcs: {},
    scenes,
    worldBuilds: {},
    branches: {},
    structureEvaluations: {},
  } as unknown as NarrativeState;
}

describe("computeCumulativePositions", () => {
  it("returns empty map when no scenes", () => {
    expect(computeCumulativePositions(narrative({}), [], 0)).toEqual({});
  });

  it("seeds position from first scene participation when never moved", () => {
    const s = narrative({
      "S-1": scene("S-1", { locationId: "L-1", participantIds: ["C-1", "C-2"] }),
    });
    const positions = computeCumulativePositions(s, ["S-1"], 0);
    expect(positions).toEqual({ "C-1": "L-1", "C-2": "L-1" });
  });

  it("applies characterMovements as overrides", () => {
    const s = narrative({
      "S-1": scene("S-1", { locationId: "L-1", participantIds: ["C-1"] }),
      "S-2": scene("S-2", {
        locationId: "L-1",
        participantIds: ["C-1"],
        characterMovements: { "C-1": { locationId: "L-2", transition: "walks east" } },
      }),
    });
    const positions = computeCumulativePositions(s, ["S-1", "S-2"], 1);
    expect(positions["C-1"]).toBe("L-2");
  });

  it("carries position across arc boundaries via the cumulative walk", () => {
    const s = narrative({
      "S-1": scene("S-1", {
        arcId: "ARC-1",
        locationId: "L-1",
        participantIds: ["C-1"],
        characterMovements: { "C-1": { locationId: "L-2", transition: "rides north" } },
      }),
      "S-2": scene("S-2", {
        arcId: "ARC-2",
        locationId: "L-9",
        participantIds: ["C-1"],
      }),
    });
    // Before S-2 fires: position from prior arc's movement, not from S-2's locationId.
    expect(computeCumulativePositions(s, ["S-1", "S-2"], 0)["C-1"]).toBe("L-2");
    // After S-2 runs without movements: still L-2 (no override emitted).
    expect(computeCumulativePositions(s, ["S-1", "S-2"], 1)["C-1"]).toBe("L-2");
  });

  it("respects currentIndex — does not see future movements", () => {
    const s = narrative({
      "S-1": scene("S-1", { locationId: "L-1", participantIds: ["C-1"] }),
      "S-2": scene("S-2", {
        locationId: "L-1",
        participantIds: ["C-1"],
        characterMovements: { "C-1": { locationId: "L-9", transition: "leaves" } },
      }),
    });
    expect(computeCumulativePositions(s, ["S-1", "S-2"], 0)["C-1"]).toBe("L-1");
  });

  it("ignores keys that don't resolve to scenes (world-build entries)", () => {
    const s = narrative({
      "S-1": scene("S-1", { locationId: "L-1", participantIds: ["C-1"] }),
    });
    // "WB-1" isn't in scenes — it's a worldBuild key. Should be skipped silently.
    const positions = computeCumulativePositions(s, ["WB-1", "S-1"], 1);
    expect(positions["C-1"]).toBe("L-1");
  });
});
