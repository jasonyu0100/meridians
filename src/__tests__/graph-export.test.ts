import { describe, expect, it } from "vitest";
import {
  exportGraphView,
  graphViewLabel,
  isExportableGraphMode,
} from "@/lib/graph-export";
import type {
  Character,
  Location,
  NarrativeState,
  Scene,
  Thread,
} from "@/types/narrative";

function baseNarrative(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    id: "N",
    title: "Test World",
    description: "",
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    arcs: {},
    scenes: {},
    worldBuilds: {},
    branches: {},
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: "",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as NarrativeState;
}

function makeChar(id: string, role: Character["role"], name = id): Character {
  return { id, name, role, world: { nodes: {}, edges: [] }, threadIds: [] } as Character;
}

function makeLoc(id: string, prominence: Location["prominence"], name = id): Location {
  return {
    id,
    name,
    prominence,
    parentId: null,
    tiedCharacterIds: [],
    world: { nodes: {}, edges: [] },
    threadIds: [],
  } as Location;
}

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    kind: "scene",
    id: "S-1",
    arcId: "A-1",
    summary: "A meeting at the gates",
    povId: "C-1",
    locationId: "L-1",
    participantIds: ["C-1", "C-2"],
    events: [],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    characterMovements: {},
    systemDeltas: { addedNodes: [], addedEdges: [] },
    proseVersions: [],
    planVersions: [],
    ...overrides,
  } as Scene;
}

describe("graphViewLabel", () => {
  it("maps each graph mode to a canonical 'Scope · Domain' string", () => {
    expect(graphViewLabel("spatial").full).toBe("Scene · World");
    expect(graphViewLabel("overview").full).toBe("Full · World");
    expect(graphViewLabel("spark").full).toBe("Scene · System");
    expect(graphViewLabel("codex").full).toBe("Full · System");
    expect(graphViewLabel("pulse").full).toBe("Scene · Threads");
    expect(graphViewLabel("threads").full).toBe("Full · Threads");
  });

  it("overrides with the entity name when drilled into an inner-world view", () => {
    const label = graphViewLabel("spatial", "Harry Potter");
    expect(label.full).toBe("Harry Potter · Inner World");
    expect(label.scope).toBe("Entity");
    expect(label.domain).toBe("Inner World");
  });
});

describe("isExportableGraphMode", () => {
  it("accepts the six graph-domain modes", () => {
    for (const m of ["spatial", "overview", "spark", "codex", "pulse", "threads"] as const) {
      expect(isExportableGraphMode(m)).toBe(true);
    }
  });

  it("rejects scene-editorial sub-views", () => {
    for (const m of ["plan", "prose", "audio", "game", "search", "reasoning"] as const) {
      expect(isExportableGraphMode(m)).toBe(false);
    }
  });
});

describe("exportGraphView", () => {
  it("prefixes every export with the narrative title and scope label", () => {
    const out = exportGraphView({
      narrative: baseNarrative(),
      mode: "overview",
      resolvedKeys: [],
      currentSceneIndex: 0,
    });
    expect(out.startsWith("# Test World — Full · World")).toBe(true);
  });

  it("exports scene-world with POV, location, and participants", () => {
    const narrative = baseNarrative({
      characters: {
        "C-1": makeChar("C-1", "anchor", "Anchor"),
        "C-2": makeChar("C-2", "recurring", "Ally"),
      },
      locations: { "L-1": makeLoc("L-1", "domain", "Gates") },
      scenes: { "S-1": makeScene() },
    });
    const out = exportGraphView({
      narrative,
      mode: "spatial",
      resolvedKeys: ["S-1"],
      currentSceneIndex: 0,
    });
    expect(out).toContain("POV: Anchor (anchor)");
    expect(out).toContain("Location: Gates (domain)");
    expect(out).toContain("A meeting at the gates");
    expect(out).toContain("**Anchor** — anchor");
    expect(out).toContain("**Ally** — recurring");
  });

  it("exports full-world with sorted characters, locations, and artifacts", () => {
    const narrative = baseNarrative({
      characters: {
        T: makeChar("T", "transient", "Transient"),
        A: makeChar("A", "anchor", "Anchor"),
        R: makeChar("R", "recurring", "Recurring"),
      },
      locations: {
        D: makeLoc("D", "domain", "Domain"),
        M: makeLoc("M", "margin", "Margin"),
      },
    });
    const out = exportGraphView({
      narrative,
      mode: "overview",
      resolvedKeys: [],
      currentSceneIndex: 0,
    });
    // Anchors before recurring before transient → ordering by role rank.
    const iAnchor = out.indexOf("**Anchor**");
    const iTransient = out.indexOf("**Transient**");
    expect(iAnchor).toBeGreaterThan(-1);
    expect(iTransient).toBeGreaterThan(-1);
    expect(iAnchor).toBeLessThan(iTransient);
  });

  it("exports full-threads grouped as active vs closed/abandoned", () => {
    const mkThread = (id: string, description: string, closed: boolean): Thread => ({
      id,
      description,
      outcomes: ["yes", "no"],
      beliefs: {
        narrator: { logits: [0, 0], volume: 2, volatility: 0, lastTouchedScene: "S-0" },
      },
      participants: [],
      openedAt: "S-0",
      dependents: [],
      threadLog: { nodes: {}, edges: [] },
      ...(closed ? { closedAt: "S-1", closeOutcome: 0 } : {}),
    });
    const threads: Record<string, Thread> = {
      T1: mkThread("T1", "live question", false),
      T2: mkThread("T2", "already paid off", true),
    };
    const out = exportGraphView({
      narrative: baseNarrative({ threads }),
      mode: "threads",
      resolvedKeys: [],
      currentSceneIndex: 0,
    });
    expect(out).toContain("## Active threads (1)");
    expect(out).toContain("## Closed / abandoned (1)");
    expect(out).toContain("top=");
    expect(out).toContain("closed →");
  });

  it("exports entity inner-world when selectedEntityId is provided", () => {
    const char = makeChar("C-1", "anchor", "Anchor");
    char.world = {
      nodes: {
        n1: { id: "n1", type: "belief", content: "change is possible" },
        n2: { id: "n2", type: "history", content: "raised in exile" },
      },
      edges: [],
    };
    const out = exportGraphView({
      narrative: baseNarrative({ characters: { "C-1": char } }),
      mode: "spatial",
      resolvedKeys: [],
      currentSceneIndex: 0,
      selectedEntityId: "C-1",
    });
    expect(out).toContain("Anchor · Inner World");
    expect(out).toContain("change is possible");
    expect(out).toContain("raised in exile");
  });
});
