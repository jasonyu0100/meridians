// Tests for lib/graph/network-graph — aggregate connection graph, tier/topology classification, and summaries.

import { describe, expect, test } from "vitest";
import {
  aggregateNetworkGraph,
  classifyTiers,
  classifyTopology,
  formatTierLabel,
  forceOfKind,
  summarizeNetworkState,
  type NetworkEdge,
  type NetworkNode,
  type NetworkNodeKind,
} from "@/lib/graph/network-graph";
import type {
  AttributionEdge,
  Character,
  Location,
  NarrativeState,
  Scene,
  Thread,
  WorldBuild,
} from "@/types/narrative";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeNarrative(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    title: "Test",
    worldSummary: "",
    characters: {},
    locations: {},
    artifacts: {},
    threads: {},
    arcs: {},
    scenes: {},
    worldBuilds: {},
    relationships: [],
    branches: {},
    structureEvaluations: [],
    proseEvaluations: [],
    planEvaluations: [],
    systemGraph: { nodes: {}, edges: [] },
    patterns: [],
    antiPatterns: [],
    ...overrides,
  } as NarrativeState;
}

function makeCharacter(id: string, name = id): Character {
  return {
    id,
    name,
    role: "anchor",
    threadIds: [],
    world: { nodes: {}, edges: [] },
  } as Character;
}

function makeLocation(id: string, name = id): Location {
  return {
    id,
    name,
    prominence: "place",
    parentId: null,
    threadIds: [],
    tiedCharacterIds: [],
    world: { nodes: {}, edges: [] },
  } as Location;
}

function makeThread(id: string, description = id): Thread {
  return {
    id,
    description,
    outcomes: ["yes", "no"],
    stances: { narrator: { logits: [0, 0], volume: 2, volatility: 0 } },
    participants: [],
    openedAt: "",
    dependents: [],
    threadLog: { nodes: {}, edges: [] },
  } as Thread;
}

function makeScene(opts: {
  id: string;
  arcId?: string;
  attributions?: string[];
  attributionEdges?: AttributionEdge[];
  newCharacters?: Character[];
  newLocations?: Location[];
  newThreads?: Thread[];
  locationId?: string | null;
}): Scene {
  return {
    kind: "scene",
    id: opts.id,
    arcId: opts.arcId ?? "ARC-1",
    povId: null,
    locationId: opts.locationId === undefined ? "L-1" : opts.locationId,
    participantIds: [],
    events: [],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    summary: "",
    attributions: opts.attributions,
    attributionEdges: opts.attributionEdges,
    newCharacters: opts.newCharacters,
    newLocations: opts.newLocations,
    newThreads: opts.newThreads,
  } as Scene;
}

function makeWorldBuild(opts: {
  id: string;
  attributions?: string[];
  attributionEdges?: AttributionEdge[];
  newCharacters?: Character[];
  newLocations?: Location[];
  newThreads?: Thread[];
  systemNodes?: Array<{ id: string; concept: string; type: string }>;
}): WorldBuild {
  return {
    kind: "world_build",
    id: opts.id,
    summary: "",
    expansionManifest: {
      newCharacters: opts.newCharacters ?? [],
      newLocations: opts.newLocations ?? [],
      newArtifacts: [],
      newThreads: opts.newThreads ?? [],
      systemDeltas: opts.systemNodes
        ? {
            addedNodes: opts.systemNodes.map((n) => ({
              id: n.id,
              concept: n.concept,
              type: n.type as never,
            })),
            addedEdges: [],
          }
        : undefined,
      attributions: opts.attributions,
      attributionEdges: opts.attributionEdges,
    },
  } as WorldBuild;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("aggregateNetworkGraph", () => {
  test("includes every entity / thread / system node from the narrative — even unreferenced ones", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1"), "C-2": makeCharacter("C-2") },
      threads: { "T-1": makeThread("T-1") },
      systemGraph: {
        nodes: { "SYS-1": { id: "SYS-1", concept: "rule", type: "principle" } },
        edges: [],
      },
    });
    const network = aggregateNetworkGraph(narrative);
    const ids = network.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["C-1", "C-2", "SYS-1", "T-1"]);
    // None referenced — all cold with 0 attributions.
    for (const n of network.nodes) {
      expect(n.attributions).toBe(0);
      expect(n.tier).toBe("cold");
    }
  });

  test("counts attributions for every kind from scene.attributions", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1") },
      threads: { "T-1": makeThread("T-1") },
      systemGraph: {
        nodes: { "SYS-1": { id: "SYS-1", concept: "rule", type: "principle" } },
        edges: [],
      },
      scenes: {
        "S-1": makeScene({ id: "S-1", attributions: ["C-1", "T-1", "SYS-1"] }),
        "S-2": makeScene({ id: "S-2", attributions: ["C-1"] }),
      },
    });
    const network = aggregateNetworkGraph(narrative);
    expect(network.nodes.find((n) => n.id === "C-1")!.attributions).toBe(2);
    expect(network.nodes.find((n) => n.id === "T-1")!.attributions).toBe(1);
    expect(network.nodes.find((n) => n.id === "SYS-1")!.attributions).toBe(1);
  });

  test("deduplicates within a single attribution step", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1") },
      scenes: {
        "S-1": makeScene({ id: "S-1", attributions: ["C-1", "C-1", "C-1"] }),
      },
    });
    const network = aggregateNetworkGraph(narrative);
    expect(network.nodes.find((n) => n.id === "C-1")!.attributions).toBe(1);
  });

  test("aggregates across multiple scenes and world builds", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1") },
      threads: { "T-1": makeThread("T-1") },
      scenes: {
        "S-1": makeScene({ id: "S-1", attributions: ["C-1"] }),
        "S-2": makeScene({ id: "S-2", attributions: ["C-1", "T-1"] }),
      },
      worldBuilds: {
        "WB-1": makeWorldBuild({ id: "WB-1", attributions: ["C-1"] }),
      },
    });
    const network = aggregateNetworkGraph(narrative);
    expect(network.graphCount).toBe(3);
    expect(network.nodes.find((n) => n.id === "C-1")!.attributions).toBe(3);
    expect(network.nodes.find((n) => n.id === "T-1")!.attributions).toBe(1);
  });

  test("builds undirected edges from scene attributionEdges, accumulating weight", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1") },
      locations: { "L-1": makeLocation("L-1") },
      scenes: {
        "S-1": makeScene({
          id: "S-1",
          attributions: ["C-1", "L-1"],
          attributionEdges: [{ from: "C-1", to: "L-1", relation: "enables" }],
        }),
        "S-2": makeScene({
          id: "S-2",
          attributions: ["C-1", "L-1"],
          // Reversed direction — collapses with the prior edge.
          attributionEdges: [{ from: "L-1", to: "C-1", relation: "constrains" }],
        }),
      },
    });
    const network = aggregateNetworkGraph(narrative);
    expect(network.edges).toHaveLength(1);
    expect(network.edges[0].weight).toBe(2);
  });

  test("edge endpoints count as attributions even when omitted from the attributions list", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1") },
      locations: { "L-1": makeLocation("L-1") },
      scenes: {
        "S-1": makeScene({
          id: "S-1",
          attributions: [],
          attributionEdges: [{ from: "C-1", to: "L-1", relation: "enables" }],
        }),
      },
    });
    const network = aggregateNetworkGraph(narrative);
    expect(network.nodes.find((n) => n.id === "C-1")!.attributions).toBe(1);
    expect(network.nodes.find((n) => n.id === "L-1")!.attributions).toBe(1);
  });

  test("progressive aggregation respects the current-scene cutoff", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1"), "C-2": makeCharacter("C-2") },
      scenes: {
        "S-1": makeScene({
          id: "S-1",
          arcId: "A-1",
          attributions: ["C-1"],
          newCharacters: [makeCharacter("C-1")],
        }),
        "S-2": makeScene({
          id: "S-2",
          arcId: "A-2",
          attributions: ["C-2"],
          newCharacters: [makeCharacter("C-2")],
        }),
      },
    });
    const resolvedKeys = ["S-1", "S-2"];

    const upToFirst = aggregateNetworkGraph(narrative, resolvedKeys, 0);
    expect(upToFirst.graphCount).toBe(1);
    expect(upToFirst.nodes.find((n) => n.id === "C-1")!.attributions).toBe(1);
    expect(upToFirst.nodes.find((n) => n.id === "C-2")).toBeUndefined();

    const upToSecond = aggregateNetworkGraph(narrative, resolvedKeys, 1);
    expect(upToSecond.graphCount).toBe(2);
    expect(upToSecond.nodes.find((n) => n.id === "C-2")!.attributions).toBe(1);
  });

  test("progressive aggregation hides entities introduced by later world builds", () => {
    const expansionWorldBuild = makeWorldBuild({
      id: "WB-2",
      newCharacters: [makeCharacter("C-2")],
      newThreads: [makeThread("T-2")],
      systemNodes: [{ id: "SYS-2", concept: "late rule", type: "principle" }],
    });
    const initWorldBuild = makeWorldBuild({
      id: "WB-1",
      newCharacters: [makeCharacter("C-1")],
    });
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1"), "C-2": makeCharacter("C-2") },
      threads: { "T-2": makeThread("T-2") },
      systemGraph: { nodes: { "SYS-2": { id: "SYS-2", concept: "late rule", type: "principle" } }, edges: [] },
      scenes: {
        "S-1": makeScene({ id: "S-1", arcId: "A-1" }),
      },
      worldBuilds: { "WB-1": initWorldBuild, "WB-2": expansionWorldBuild },
    });
    const resolvedKeys = ["WB-1", "S-1", "WB-2"];

    const beforeExpansion = aggregateNetworkGraph(narrative, resolvedKeys, 1);
    const ids = beforeExpansion.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["C-1"]);

    const afterExpansion = aggregateNetworkGraph(narrative, resolvedKeys, 2);
    const idsAfter = afterExpansion.nodes.map((n) => n.id).sort();
    expect(idsAfter).toEqual(["C-1", "C-2", "SYS-2", "T-2"]);
  });

  test("firstSeenIndex tracks the first attribution step that referenced a node", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1"), "C-2": makeCharacter("C-2") },
      scenes: {
        "S-1": makeScene({ id: "S-1", attributions: ["C-1"] }),
        "S-2": makeScene({ id: "S-2", attributions: ["C-2"] }),
      },
    });
    const network = aggregateNetworkGraph(narrative);
    expect(network.nodes.find((n) => n.id === "C-1")!.firstSeenIndex).toBe(0);
    expect(network.nodes.find((n) => n.id === "C-2")!.firstSeenIndex).toBe(1);
  });

  test("scenes with no attribution data don't advance the step counter", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1") },
      scenes: {
        // No attributions, no edges, and no participation (location/pov/cast)
        // either — a genuinely empty step that shouldn't advance the counter.
        "S-1": makeScene({ id: "S-1", locationId: null }),
        "S-2": makeScene({ id: "S-2", attributions: ["C-1"] }),
      },
    });
    const network = aggregateNetworkGraph(narrative);
    expect(network.graphCount).toBe(1);
    expect(network.nodes.find((n) => n.id === "C-1")!.firstSeenIndex).toBe(0);
  });

  test("within-step edge dedup: same pair declared twice in one scene weights as one", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1"), "C-2": makeCharacter("C-2") },
      scenes: {
        "S-1": makeScene({
          id: "S-1",
          attributions: ["C-1", "C-2"],
          attributionEdges: [
            { from: "C-1", to: "C-2", relation: "develops" },
            // Same pair (any direction, any relation) shouldn't double-weight
            { from: "C-2", to: "C-1", relation: "causes" },
            { from: "C-1", to: "C-2", relation: "develops" },
          ],
        }),
      },
    });
    const network = aggregateNetworkGraph(narrative);
    expect(network.edges).toHaveLength(1);
    expect(network.edges[0].weight).toBe(1);
  });

  test("edge weight accumulates ONE per step, regardless of within-step repeats", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1"), "C-2": makeCharacter("C-2") },
      scenes: {
        "S-1": makeScene({
          id: "S-1",
          attributionEdges: [
            { from: "C-1", to: "C-2", relation: "develops" },
            { from: "C-1", to: "C-2", relation: "develops" }, // dup within step
          ],
        }),
        "S-2": makeScene({
          id: "S-2",
          attributionEdges: [{ from: "C-1", to: "C-2", relation: "causes" }],
        }),
        "S-3": makeScene({
          id: "S-3",
          attributionEdges: [{ from: "C-2", to: "C-1", relation: "enables" }],
        }),
      },
    });
    const network = aggregateNetworkGraph(narrative);
    expect(network.edges).toHaveLength(1);
    // Three distinct steps wired the pair → weight 3.
    expect(network.edges[0].weight).toBe(3);
  });

  test("network edge surfaces accumulated relation set", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1") },
      threads: { "T-1": makeThread("T-1") },
      scenes: {
        "S-1": makeScene({
          id: "S-1",
          attributionEdges: [{ from: "C-1", to: "T-1", relation: "develops" }],
        }),
        "S-2": makeScene({
          id: "S-2",
          attributionEdges: [{ from: "T-1", to: "C-1", relation: "causes" }],
        }),
      },
    });
    const network = aggregateNetworkGraph(narrative);
    expect(network.edges).toHaveLength(1);
    expect(network.edges[0].relations).toBeDefined();
    expect(new Set(network.edges[0].relations)).toEqual(
      new Set(["develops", "causes"]),
    );
  });

  test("self-loop edges are dropped", () => {
    const narrative = makeNarrative({
      characters: { "C-1": makeCharacter("C-1") },
      scenes: {
        "S-1": makeScene({
          id: "S-1",
          attributionEdges: [{ from: "C-1", to: "C-1", relation: "develops" }],
        }),
      },
    });
    const network = aggregateNetworkGraph(narrative);
    expect(network.edges).toHaveLength(0);
  });
});

describe("classifyTiers", () => {
  function nodeWith(id: string, attributions: number, firstSeenIndex = -1): NetworkNode {
    return {
      id,
      kind: "character",
      label: id,
      attributions,
      firstSeenIndex,
      lastSeenIndex: -1,
      tier: "cold",
      topology: "isolated",
    };
  }

  test("zero-attribution nodes are cold", () => {
    const out = classifyTiers([nodeWith("a", 0), nodeWith("b", 5)], 1);
    expect(out.find((n) => n.id === "a")!.tier).toBe("cold");
  });

  test("only nodes first seen in the LATEST graph are fresh (FRESH_WINDOW=1)", () => {
    const out = classifyTiers(
      [nodeWith("a", 1, 4), nodeWith("b", 1, 3), nodeWith("c", 1, 0)],
      5,
    );
    expect(out.find((n) => n.id === "a")!.tier).toBe("fresh");
    expect(out.find((n) => n.id === "b")!.tier).not.toBe("fresh");
    expect(out.find((n) => n.id === "c")!.tier).not.toBe("fresh");
  });

  test("freshness disabled when totalGraphs <= 1 (no historic baseline)", () => {
    const out = classifyTiers([nodeWith("a", 5, 0), nodeWith("b", 1, 0)], 1);
    expect(out.find((n) => n.id === "a")!.tier).not.toBe("fresh");
    expect(out.find((n) => n.id === "b")!.tier).not.toBe("fresh");
  });

  test("hot requires HOT_MIN_ATTRIBUTIONS even when in top tertile", () => {
    const out = classifyTiers(
      [nodeWith("a", 1, 0), nodeWith("b", 1, 0), nodeWith("c", 1, 0)],
      10,
    );
    for (const n of out) expect(n.tier).not.toBe("hot");
  });

  test("buckets non-fresh attributed nodes into hot/warm/cold tertiles", () => {
    const out = classifyTiers(
      [
        nodeWith("a", 1, 0),
        nodeWith("b", 5, 0),
        nodeWith("c", 10, 0),
      ],
      10,
    );
    expect(out.find((n) => n.id === "c")!.tier).toBe("hot");
    expect(out.find((n) => n.id === "a")!.tier).toBe("cold");
  });

  test("regression: 3 graphs doesn't mark every attributed node fresh", () => {
    const out = classifyTiers(
      [
        nodeWith("a", 3, 0),
        nodeWith("b", 3, 1),
        nodeWith("c", 3, 2),
        nodeWith("d", 3, 0),
      ],
      3,
    );
    expect(out.find((n) => n.id === "c")!.tier).toBe("fresh");
    expect(out.find((n) => n.id === "a")!.tier).not.toBe("fresh");
    expect(out.find((n) => n.id === "b")!.tier).not.toBe("fresh");
  });

  test("empty input returns empty array", () => {
    expect(classifyTiers([], 0)).toEqual([]);
  });
});

describe("classifyTopology", () => {
  function makeNode(id: string, kind: NetworkNodeKind = "character"): NetworkNode {
    return {
      id, kind, label: id,
      attributions: 1,
      firstSeenIndex: 0, lastSeenIndex: 0,
      tier: "warm", topology: "isolated",
    };
  }

  function classify(nodes: NetworkNode[], edges: NetworkEdge[]): NetworkNode[] {
    const lookup = new Map(nodes.map((n) => [n.id, n.kind]));
    return classifyTopology(nodes, edges, lookup);
  }

  test("no edges → isolated", () => {
    const out = classify([makeNode("a")], []);
    expect(out[0].topology).toBe("isolated");
  });

  test("single edge → leaf", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges: NetworkEdge[] = [{ from: "a", to: "b", weight: 1 }];
    const out = classify(nodes, edges);
    expect(out.find((n) => n.id === "a")!.topology).toBe("leaf");
  });

  test("multiple edges all within one force cohort → hub", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges: NetworkEdge[] = [
      { from: "c", to: "a", weight: 1 },
      { from: "c", to: "b", weight: 1 },
    ];
    const out = classify(nodes, edges);
    expect(out.find((n) => n.id === "c")!.topology).toBe("hub");
  });

  test("edges spanning ≥2 force cohorts → bridge", () => {
    const nodes = [
      makeNode("c", "character"),
      makeNode("t", "thread"),
      makeNode("ch", "character"),
    ];
    const edges: NetworkEdge[] = [
      { from: "c", to: "t", weight: 1 },
      { from: "c", to: "ch", weight: 1 },
    ];
    const out = classify(nodes, edges);
    expect(out.find((n) => n.id === "c")!.topology).toBe("bridge");
  });
});

describe("forceOfKind", () => {
  test("threads → fate, system → system, c/l/a → world", () => {
    expect(forceOfKind("thread")).toBe("fate");
    expect(forceOfKind("system")).toBe("system");
    expect(forceOfKind("character")).toBe("world");
    expect(forceOfKind("location")).toBe("world");
    expect(forceOfKind("artifact")).toBe("world");
  });
});

describe("summarizeNetworkState", () => {
  test("empty network", () => {
    expect(summarizeNetworkState({ nodes: [], edges: [], graphCount: 0 })).toMatch(/empty/i);
  });

  test("nodes but no graphs reads as no-attribution state", () => {
    const nodes: NetworkNode[] = [{
      id: "C-1", kind: "character", label: "A",
      attributions: 0,
      firstSeenIndex: -1, lastSeenIndex: -1,
      tier: "cold", topology: "isolated",
    }];
    const out = summarizeNetworkState({ nodes, edges: [], graphCount: 0 });
    expect(out).toMatch(/no attributions/i);
  });

  test("includes per-cohort counts and topology line", () => {
    const node = (id: string, kind: NetworkNodeKind, tier: NetworkNode["tier"]): NetworkNode => ({
      id, kind, label: id,
      attributions: tier === "cold" ? 0 : 1,
      firstSeenIndex: 0, lastSeenIndex: 0,
      tier, topology: "isolated",
    });
    const nodes = [node("C-1", "character", "hot"), node("T-1", "thread", "warm"), node("SYS-1", "system", "cold")];
    const out = summarizeNetworkState({ nodes, edges: [], graphCount: 3 });
    expect(out).toContain("Fate");
    expect(out).toContain("World");
    expect(out).toContain("System");
    expect(out).toContain("Topology");
  });
});

describe("formatTierLabel", () => {
  function makeNode(overrides: Partial<NetworkNode>): NetworkNode {
    return {
      id: "a", kind: "character", label: "A",
      attributions: 0,
      firstSeenIndex: -1, lastSeenIndex: -1,
      tier: "cold", topology: "isolated",
      ...overrides,
    };
  }

  test("undefined node returns empty string", () => {
    expect(formatTierLabel(undefined)).toBe("");
  });

  test("never-referenced cold node renders tier + topology", () => {
    expect(formatTierLabel(makeNode({}))).toBe("{cold ×0, isolated}");
  });

  test("hot bridge attributed node", () => {
    const node = makeNode({ attributions: 5, tier: "hot", topology: "bridge" });
    expect(formatTierLabel(node)).toBe("{hot ×5, bridge}");
  });

  test("warm hub node", () => {
    const node = makeNode({ attributions: 4, tier: "warm", topology: "hub" });
    expect(formatTierLabel(node)).toBe("{warm ×4, hub}");
  });
});
