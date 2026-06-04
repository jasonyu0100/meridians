// Tests for lib/forces/positions — participation-derived cumulative entity locations across scenes.

import { computeCumulativePositions } from "@/lib/forces/positions";
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

  it("position equals scene.locationId when character first participates", () => {
    const s = narrative({
      "S-1": scene("S-1", { locationId: "L-1", participantIds: ["C-1", "C-2"] }),
    });
    const positions = computeCumulativePositions(s, ["S-1"], 0);
    expect(positions).toEqual({ "C-1": "L-1", "C-2": "L-1" });
  });

  it("position updates when character participates at a new locationId", () => {
    const s = narrative({
      "S-1": scene("S-1", { locationId: "L-1", participantIds: ["C-1"] }),
      "S-2": scene("S-2", { locationId: "L-2", participantIds: ["C-1"] }),
    });
    const positions = computeCumulativePositions(s, ["S-1", "S-2"], 1);
    expect(positions["C-1"]).toBe("L-2");
  });

  it("position persists when character does not appear in later scenes", () => {
    const s = narrative({
      "S-1": scene("S-1", { locationId: "L-1", participantIds: ["C-1"] }),
      "S-2": scene("S-2", { locationId: "L-9", participantIds: [] }),
    });
    expect(computeCumulativePositions(s, ["S-1", "S-2"], 1)["C-1"]).toBe("L-1");
  });

  it("respects currentIndex — does not see future scenes", () => {
    const s = narrative({
      "S-1": scene("S-1", { locationId: "L-1", participantIds: ["C-1"] }),
      "S-2": scene("S-2", { locationId: "L-9", participantIds: ["C-1"] }),
    });
    expect(computeCumulativePositions(s, ["S-1", "S-2"], 0)["C-1"]).toBe("L-1");
  });

  it("ignores keys that don't resolve to scenes (world-build entries)", () => {
    const s = narrative({
      "S-1": scene("S-1", { locationId: "L-1", participantIds: ["C-1"] }),
    });
    const positions = computeCumulativePositions(s, ["WB-1", "S-1"], 1);
    expect(positions["C-1"]).toBe("L-1");
  });

  it("carries position across arc boundaries via participation", () => {
    const s = narrative({
      "S-1": scene("S-1", {
        arcId: "ARC-1",
        locationId: "L-1",
        participantIds: ["C-1"],
      }),
      "S-2": scene("S-2", {
        arcId: "ARC-2",
        locationId: "L-9",
        participantIds: [],
      }),
    });
    // C-1's last participation was at L-1 — position persists into arc 2.
    expect(computeCumulativePositions(s, ["S-1", "S-2"], 1)["C-1"]).toBe("L-1");
  });
});
