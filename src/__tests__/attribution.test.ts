// Tests for attribution derivation — scene/expansion attribution nodes and edges from deltas.

import { describe, expect, it } from "vitest";
import {
  deriveSceneAttributions,
  deriveSceneAttributionEdges,
  deriveExpansionAttributionEdges,
  ensureSceneAttributions,
  ensureExpansionAttributions,
} from "@/lib/forces/attribution";
import type {
  AttributionEdge,
  Scene,
  WorldExpansion,
} from "@/types/narrative";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    kind: "scene",
    id: "S-1",
    arcId: "ARC-1",
    locationId: "L-1",
    povId: null,
    participantIds: [],
    events: [],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    summary: "",
    ...overrides,
  } as Scene;
}

function makeExpansion(overrides: Partial<WorldExpansion> = {}): WorldExpansion {
  return {
    newCharacters: [],
    newLocations: [],
    newArtifacts: [],
    newThreads: [],
    ...overrides,
  } as WorldExpansion;
}

const edgeKey = (e: { from: string; to: string }) =>
  e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;

// ── deriveSceneAttributions ──────────────────────────────────────────────────

describe("deriveSceneAttributions", () => {
  it("lifts POV, participants, and location", () => {
    const scene = makeScene({
      povId: "C-1",
      participantIds: ["C-1", "C-2"],
      locationId: "L-5",
    });
    expect(new Set(deriveSceneAttributions(scene))).toEqual(
      new Set(["C-1", "C-2", "L-5"]),
    );
  });

  it("includes threadIds from threadDeltas and entityIds from worldDeltas", () => {
    const scene = makeScene({
      threadDeltas: [{ threadId: "T-3" } as never],
      worldDeltas: [{ entityId: "C-7", addedNodes: [] } as never],
    });
    expect(new Set(deriveSceneAttributions(scene))).toEqual(
      new Set(["L-1", "T-3", "C-7"]),
    );
  });

  it("includes both endpoints of relationshipDeltas", () => {
    const scene = makeScene({
      relationshipDeltas: [
        { from: "C-1", to: "C-2", type: "rival", valenceDelta: -0.5 },
      ],
    });
    expect(new Set(deriveSceneAttributions(scene))).toEqual(
      new Set(["L-1", "C-1", "C-2"]),
    );
  });

  it("includes artifact + character from artifactUsages", () => {
    const scene = makeScene({
      artifactUsages: [{ artifactId: "A-2", characterId: "C-3", usage: "" }],
    });
    expect(new Set(deriveSceneAttributions(scene))).toEqual(
      new Set(["L-1", "A-2", "C-3"]),
    );
  });

  it("includes both endpoints + artifact for ownershipDeltas", () => {
    const scene = makeScene({
      ownershipDeltas: [{ artifactId: "A-1", fromId: "C-1", toId: "L-2" }],
    });
    expect(new Set(deriveSceneAttributions(scene))).toEqual(
      new Set(["L-1", "A-1", "C-1", "L-2"]),
    );
  });

  it("includes character + location for tieDeltas", () => {
    const scene = makeScene({
      tieDeltas: [{ characterId: "C-1", locationId: "L-2", action: "add" }],
    });
    expect(new Set(deriveSceneAttributions(scene))).toEqual(
      new Set(["L-1", "C-1", "L-2"]),
    );
  });

  it("includes existing SYS ids referenced by systemDeltas.addedEdges, but NOT newly-introduced SYS nodes", () => {
    const scene = makeScene({
      systemDeltas: {
        addedNodes: [{ id: "SYS-NEW", concept: "fresh rule", type: "principle" }],
        addedEdges: [
          // edge from new node to existing — only existing endpoint counts
          { from: "SYS-NEW", to: "SYS-EXISTING", relation: "enables" },
        ],
      },
    });
    const ids = new Set(deriveSceneAttributions(scene));
    expect(ids.has("SYS-EXISTING")).toBe(true);
    expect(ids.has("SYS-NEW")).toBe(false);
  });

  it("strips newly-introduced entity ids that appear in typed fields", () => {
    // Same scene introduces C-NEW via newCharacters AND uses it as a participant.
    // The participant entry should NOT yield an attribution — introduction credits
    // automatically downstream and we don't want to double-count.
    const scene = makeScene({
      participantIds: ["C-NEW"],
      newCharacters: [{ id: "C-NEW", name: "Fresh" } as never],
    });
    expect(deriveSceneAttributions(scene)).not.toContain("C-NEW");
  });

  it("returns deduplicated ids when the same id appears in multiple delta fields", () => {
    const scene = makeScene({
      povId: "C-1",
      participantIds: ["C-1"],
      relationshipDeltas: [{ from: "C-1", to: "C-2", type: "x", valenceDelta: 0 }],
    });
    const ids = deriveSceneAttributions(scene);
    expect(ids.filter((id) => id === "C-1")).toHaveLength(1);
  });

  it("handles missing optional fields without throwing", () => {
    expect(() => deriveSceneAttributions(makeScene({}))).not.toThrow();
  });
});

// ── deriveSceneAttributionEdges ──────────────────────────────────────────────

describe("deriveSceneAttributionEdges", () => {
  it("relationshipDeltas → develops edge", () => {
    const scene = makeScene({
      relationshipDeltas: [{ from: "C-1", to: "C-2", type: "x", valenceDelta: 0 }],
    });
    expect(deriveSceneAttributionEdges(scene)).toEqual([
      { from: "C-1", to: "C-2", relation: "develops" },
    ]);
  });

  it("artifactUsages → character requires artifact", () => {
    const scene = makeScene({
      artifactUsages: [{ artifactId: "A-1", characterId: "C-1", usage: "" }],
    });
    expect(deriveSceneAttributionEdges(scene)).toEqual([
      { from: "C-1", to: "A-1", relation: "requires" },
    ]);
  });

  it("ownershipDeltas → causes (new owner) + supersedes (prior owner)", () => {
    const scene = makeScene({
      ownershipDeltas: [{ artifactId: "A-1", fromId: "C-1", toId: "C-2" }],
    });
    const edges = deriveSceneAttributionEdges(scene);
    const keys = edges.map((e) => `${e.from}→${e.to}:${e.relation}`);
    expect(keys).toContain("C-2→A-1:causes");
    expect(keys).toContain("C-1→A-1:supersedes");
  });

  it("threadDeltas wire to POV and to scene location", () => {
    const scene = makeScene({
      povId: "C-1",
      locationId: "L-1",
      threadDeltas: [{ threadId: "T-1" } as never],
    });
    const edges = deriveSceneAttributionEdges(scene);
    const keys = edges.map(edgeKey);
    expect(keys).toContain(edgeKey({ from: "C-1", to: "T-1" }));
    expect(keys).toContain(edgeKey({ from: "T-1", to: "L-1" }));
  });

  it("skips edges with missing endpoints or self-loops", () => {
    const scene = makeScene({
      povId: null,
      locationId: "L-1",
      threadDeltas: [{ threadId: "T-1" } as never],
      relationshipDeltas: [{ from: "C-1", to: "C-1", type: "x", valenceDelta: 0 }],
    });
    const edges = deriveSceneAttributionEdges(scene);
    // No POV → no pov-thread edge. Self-loop → no relationship edge.
    expect(edges.every((e) => e.from !== e.to)).toBe(true);
    expect(edges.some((e) => e.from === "" || e.to === "")).toBe(false);
  });

  it("maps systemDeltas.addedEdges through the relation vocabulary", () => {
    const scene = makeScene({
      systemDeltas: {
        addedNodes: [],
        addedEdges: [
          { from: "SYS-1", to: "SYS-2", relation: "governs" },
          { from: "SYS-3", to: "SYS-4", relation: "enables" },
          { from: "SYS-5", to: "SYS-6", relation: "exist_within" },
          { from: "SYS-7", to: "SYS-8", relation: "created_by" },
        ],
      },
    });
    const out = deriveSceneAttributionEdges(scene).filter((e) =>
      e.from.startsWith("SYS-"),
    );
    const byPair = new Map(out.map((e) => [`${e.from}→${e.to}`, e.relation]));
    expect(byPair.get("SYS-1→SYS-2")).toBe("constrains"); // governs → constrains
    expect(byPair.get("SYS-3→SYS-4")).toBe("enables");
    expect(byPair.get("SYS-5→SYS-6")).toBe("requires"); // exist_within → requires
    expect(byPair.get("SYS-7→SYS-8")).toBe("causes"); // created_by → causes
  });
});

// ── ensureSceneAttributions (merge LLM + derived) ────────────────────────────

describe("ensureSceneAttributions", () => {
  it("preserves LLM-emitted attributions at the head, appends derived after", () => {
    const scene = makeScene({
      povId: "C-1",
      attributions: ["SYS-99", "C-OTHER"], // LLM declared structural reference
    });
    ensureSceneAttributions(scene);
    expect(scene.attributions!.slice(0, 2)).toEqual(["SYS-99", "C-OTHER"]);
    // POV + location appended after.
    expect(scene.attributions).toContain("C-1");
    expect(scene.attributions).toContain("L-1");
  });

  it("dedups when LLM emit and derive overlap", () => {
    const scene = makeScene({
      povId: "C-1",
      attributions: ["C-1"], // already declared by LLM
    });
    ensureSceneAttributions(scene);
    expect(scene.attributions!.filter((id) => id === "C-1")).toHaveLength(1);
  });

  it("merges LLM-emitted edges with derived edges, deduping by undirected pair", () => {
    const scene = makeScene({
      relationshipDeltas: [{ from: "C-1", to: "C-2", type: "x", valenceDelta: 0 }],
      attributionEdges: [
        // LLM declared the same pair, opposite direction, different relation
        { from: "C-2", to: "C-1", relation: "causes" },
      ],
    });
    ensureSceneAttributions(scene);
    const keys = (scene.attributionEdges ?? []).map(edgeKey);
    const c1c2 = edgeKey({ from: "C-1", to: "C-2" });
    expect(keys.filter((k) => k === c1c2)).toHaveLength(1);
    // LLM order wins — its "causes" survives, the derived "develops" is dropped.
    expect(scene.attributionEdges![0]).toEqual({
      from: "C-2",
      to: "C-1",
      relation: "causes",
    });
  });

  it("populates attributionEdges even when the LLM emits none", () => {
    const scene = makeScene({
      povId: "C-1",
      threadDeltas: [{ threadId: "T-1" } as never],
    });
    ensureSceneAttributions(scene);
    expect(scene.attributionEdges).toBeDefined();
    expect(scene.attributionEdges!.length).toBeGreaterThan(0);
  });

  it("is idempotent — running twice doesn't grow either list", () => {
    const scene = makeScene({
      povId: "C-1",
      relationshipDeltas: [{ from: "C-1", to: "C-2", type: "x", valenceDelta: 0 }],
    });
    ensureSceneAttributions(scene);
    const attrsAfter1 = [...(scene.attributions ?? [])];
    const edgesAfter1 = [...(scene.attributionEdges ?? [])];
    ensureSceneAttributions(scene);
    expect(scene.attributions).toEqual(attrsAfter1);
    expect(scene.attributionEdges).toEqual(edgesAfter1);
  });
});

// ── deriveExpansionAttributionEdges + ensureExpansionAttributions ────────────

describe("expansion attributions + edges", () => {
  it("derives edges from expansion's typed deltas", () => {
    const expansion = makeExpansion({
      relationshipDeltas: [{ from: "C-1", to: "C-2", type: "x", valenceDelta: 0 }],
      tieDeltas: [{ characterId: "C-1", locationId: "L-3", action: "add" }],
    });
    const edges = deriveExpansionAttributionEdges(expansion);
    const keys = edges.map((e) => edgeKey(e));
    expect(keys).toContain(edgeKey({ from: "C-1", to: "C-2" }));
    expect(keys).toContain(edgeKey({ from: "C-1", to: "L-3" }));
  });

  it("ensureExpansionAttributions merges LLM-declared and derived", () => {
    const expansion = makeExpansion({
      relationshipDeltas: [{ from: "C-1", to: "C-2", type: "x", valenceDelta: 0 }],
      attributions: ["SYS-99"],
      attributionEdges: [{ from: "SYS-99", to: "C-1", relation: "constrains" }],
    });
    ensureExpansionAttributions(expansion);
    expect(expansion.attributions).toContain("SYS-99");
    expect(expansion.attributions).toContain("C-1");
    expect(expansion.attributions).toContain("C-2");
    // LLM edge + derived edge both present.
    const keys = (expansion.attributionEdges ?? []).map(edgeKey);
    expect(keys).toContain(edgeKey({ from: "SYS-99", to: "C-1" }));
    expect(keys).toContain(edgeKey({ from: "C-1", to: "C-2" }));
  });

  it("strips newly-introduced ids from the attribution list", () => {
    const expansion = makeExpansion({
      newCharacters: [{ id: "C-NEW", name: "Fresh" } as never],
      relationshipDeltas: [
        // Existing C-1 ↔ newly-introduced C-NEW
        { from: "C-1", to: "C-NEW", type: "x", valenceDelta: 0 },
      ],
    });
    ensureExpansionAttributions(expansion);
    expect(expansion.attributions).toContain("C-1");
    expect(expansion.attributions).not.toContain("C-NEW");
  });
});

// ── LLM emit + derive don't double-count weight ──────────────────────────────

describe("merge invariants", () => {
  it("a single pair declared by LLM and also derived produces exactly one edge", () => {
    const scene = makeScene({
      relationshipDeltas: [{ from: "C-1", to: "C-2", type: "x", valenceDelta: 0 }],
      attributionEdges: [{ from: "C-1", to: "C-2", relation: "develops" } as AttributionEdge],
    });
    ensureSceneAttributions(scene);
    expect(scene.attributionEdges).toHaveLength(1);
  });

  it("LLM edge in opposite direction still collapses with derived (undirected pair-key)", () => {
    const scene = makeScene({
      relationshipDeltas: [{ from: "C-1", to: "C-2", type: "x", valenceDelta: 0 }],
      attributionEdges: [{ from: "C-2", to: "C-1", relation: "develops" } as AttributionEdge],
    });
    ensureSceneAttributions(scene);
    expect(scene.attributionEdges).toHaveLength(1);
  });
});
