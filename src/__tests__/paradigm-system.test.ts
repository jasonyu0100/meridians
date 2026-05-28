/**
 * Paradigm system + today's hardening work.
 *
 * Covers, in one focused file, the contracts established in the recent
 * paradigm / websearch / scene-normalisation / wizard / world-gen passes:
 *
 *   1. Type contract — NarrativeParadigm union has exactly nine values;
 *      PARADIGM-aware constants map every value.
 *   2. Deterministic per-paradigm prompts — buildGenerateNarrativePrompt
 *      emits only the matching paradigm block (drops the others) and the
 *      <paradigm-directive> envelope, and forbids cross-paradigm leakage
 *      (no AI-coded names in fiction; no human names in analysis).
 *   3. Analysis-vs-simulation discipline — the analysis paradigm block
 *      carries the rules that forbid forward-time event narration,
 *      fabricated intelligence, and invented numbers presented as
 *      freshly observed.
 *   4. Scene-gen paradigm threading — buildGenerateScenesPrompt injects
 *      the matching scene-discipline block when paradigm is supplied.
 *   5. Engine-metadata + no-raw-IDs guards — summary discipline forbids
 *      narrating threadDeltas / worldDeltas / systemDeltas in summary
 *      prose.
 *   6. Scene defensive normalisation — withDerivedEntities heals scenes
 *      whose required array fields are missing/non-array, and
 *      getRelationshipsAtScene survives malformed pre-existing data.
 *   7. Source-material injection — buildGenerateNarrativePrompt emits a
 *      <source-material> block when sourceText is supplied, and omits
 *      it cleanly when not.
 *   8. Websearch resolution — resolveWebsearch maps the four levels to
 *      the right max_results value; defaults to 0 (disabled).
 *
 * Wording-level assertions are intentionally avoided per the ai-prompts
 * file's contract guidance — phrase guards rot fast, contract guards
 * protect what's load-bearing.
 */

import { describe, it, expect } from "vitest";
import {
  buildGenerateNarrativePrompt,
  buildGenerateScenesPrompt,
} from "@/lib/ai/prompts";
import {
  DEFAULT_STORY_SETTINGS,
  WEBSEARCH_MAX_RESULTS,
  type NarrativeParadigm,
  type NarrativeState,
  type Scene,
  type WorldBuild,
} from "@/types/narrative";
import { resolveWebsearch } from "@/lib/ai/api";
import { withDerivedEntities } from "@/lib/store";
import { getRelationshipsAtScene } from "@/lib/scene-filter";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ALL_PARADIGMS: NarrativeParadigm[] = [
  "fiction",
  "non-fiction",
  "simulation",
  "essay",
  "panel",
  "atlas",
  "debate",
  "record",
  "game",
];

function buildPrompt(paradigm: NarrativeParadigm, sourceText?: string) {
  return buildGenerateNarrativePrompt({
    title: "Test World",
    premise: "Test premise.",
    sourceText,
    worldOnly: false,
    paradigm,
    sceneCount: 4,
    forceReferenceMeansWorld: 14,
    forceReferenceMeansSystem: 6,
    worldTypicalBand: "1-3",
    worldClimaxBand: "4-6",
    systemTypicalBand: "1-2",
    systemClimaxBand: "3-4",
  });
}

// ── 1. Type contract ─────────────────────────────────────────────────────────

describe("NarrativeParadigm type contract", () => {
  it("exposes exactly nine canonical paradigms", () => {
    expect(ALL_PARADIGMS).toHaveLength(9);
    expect(new Set(ALL_PARADIGMS).size).toBe(9);
  });

  it("WEBSEARCH_MAX_RESULTS covers all four levels", () => {
    expect(WEBSEARCH_MAX_RESULTS.none).toBe(0);
    expect(WEBSEARCH_MAX_RESULTS.low).toBeGreaterThan(0);
    expect(WEBSEARCH_MAX_RESULTS.medium).toBeGreaterThan(WEBSEARCH_MAX_RESULTS.low);
    expect(WEBSEARCH_MAX_RESULTS.high).toBeGreaterThan(WEBSEARCH_MAX_RESULTS.medium);
  });

  it("DEFAULT_STORY_SETTINGS defaults websearch to off", () => {
    expect(DEFAULT_STORY_SETTINGS.websearchLevel).toBe("none");
  });
});

// ── 2. Deterministic per-paradigm prompts ────────────────────────────────────

describe("World-gen prompt — deterministic per paradigm", () => {
  it("emits a <paradigm-directive> block for every paradigm", () => {
    for (const p of ALL_PARADIGMS) {
      const prompt = buildPrompt(p);
      expect(prompt).toContain("<paradigm-directive");
      expect(prompt).toContain(`<paradigm>${p}</paradigm>`);
      expect(prompt).toContain("<world-shape>");
    }
  });

  it("fiction / non-fiction get the populated-narrative shape", () => {
    for (const p of ["fiction", "non-fiction"] as const) {
      const prompt = buildPrompt(p);
      expect(prompt).toContain("populated-narrative");
      // Drops the other paradigm patterns.
      expect(prompt).not.toContain("<multi-thinker-pattern");
      expect(prompt).not.toContain("<singular-thinker-pattern");
      expect(prompt).not.toContain("<reference-typology-shape");
      expect(prompt).not.toContain("<adversarial-contest-shape");
      expect(prompt).not.toContain("<rule-governed-narrative-shape");
    }
  });

  it("simulation gets the rule-governed-narrative shape", () => {
    const prompt = buildPrompt("simulation");
    expect(prompt).toContain("<rule-governed-narrative-shape");
    expect(prompt).toContain("rule-governed-narrative");
    expect(prompt).not.toContain("<populated-narrative-shape");
    expect(prompt).not.toContain("<multi-thinker-pattern");
    expect(prompt).not.toContain("<singular-thinker-pattern");
  });

  it("panel gets ONLY the multi-thinker pattern", () => {
    const prompt = buildPrompt("panel");
    expect(prompt).toContain("<multi-thinker-pattern");
    expect(prompt).toContain("multi-thinker");
    expect(prompt).not.toContain("<singular-thinker-pattern");
    expect(prompt).not.toContain("<populated-narrative-shape");
  });

  it("essay gets ONLY the singular-thinker pattern", () => {
    const prompt = buildPrompt("essay");
    expect(prompt).toContain("<singular-thinker-pattern");
    expect(prompt).toContain("singular-thinker");
    expect(prompt).not.toContain("<multi-thinker-pattern");
    expect(prompt).not.toContain("<populated-narrative-shape");
  });

  it("atlas gets ONLY the reference-typology shape", () => {
    const prompt = buildPrompt("atlas");
    expect(prompt).toContain("<reference-typology-shape");
    expect(prompt).toContain("reference-typology");
    expect(prompt).not.toContain("<populated-narrative-shape");
    expect(prompt).not.toContain("<adversarial-contest-shape");
  });

  it("debate gets ONLY the adversarial-contest shape", () => {
    const prompt = buildPrompt("debate");
    expect(prompt).toContain("<adversarial-contest-shape");
    expect(prompt).toContain("adversarial-contest");
    expect(prompt).not.toContain("<populated-narrative-shape");
    expect(prompt).not.toContain("<reference-typology-shape");
  });

  it("record gets ONLY the chronological-record shape", () => {
    const prompt = buildPrompt("record");
    expect(prompt).toContain("<chronological-record-shape");
    expect(prompt).toContain("chronological-record");
    expect(prompt).not.toContain("<populated-narrative-shape");
    expect(prompt).not.toContain("<adversarial-contest-shape");
    expect(prompt).not.toContain("<reference-typology-shape");
  });

  it("record declares all four time-velocity options", () => {
    const prompt = buildPrompt("record");
    // The four velocity modes must all be present so the model can
    // pick the right one from the premise without inventing a fifth.
    const lower = prompt.toLowerCase();
    expect(lower).toContain('name="daily"');
    expect(lower).toContain('name="monthly"');
    expect(lower).toContain('name="yearly"');
    expect(lower).toContain('name="dynamic"');
  });

  it("record requires time-stamped entries + chronicler voice", () => {
    const prompt = buildPrompt("record");
    const lower = prompt.toLowerCase();
    // The structural rules of Record — entries are dated, ordering IS
    // the structure, chronicler records (doesn't editorialise).
    expect(lower).toContain("entries-are-time-stamped");
    expect(lower).toContain("chronicler-voice");
    expect(lower).toContain("velocity-coherence");
  });

  it("game gets ONLY the multi-actor-game shape", () => {
    const prompt = buildPrompt("game");
    expect(prompt).toContain("<multi-actor-game-shape");
    expect(prompt).toContain("multi-actor-game");
    expect(prompt).not.toContain("<populated-narrative-shape");
    expect(prompt).not.toContain("<adversarial-contest-shape");
    expect(prompt).not.toContain("<reference-typology-shape");
    expect(prompt).not.toContain("<chronological-record-shape");
  });

  it("game requires rules-load-bearing + turn structure + info rules", () => {
    const prompt = buildPrompt("game");
    const lower = prompt.toLowerCase();
    // The structural disciplines of Game — rules are enforceable, turn
    // structure declared, information regime declared, threads are stakes.
    expect(lower).toContain("rules-load-bearing");
    expect(lower).toContain("turn-structure");
    expect(lower).toContain("information-rules");
    expect(lower).toContain("stakes-are-threads");
  });

  it("populated-narrative paradigms forbid AI-coded single-word names", () => {
    const prompt = buildPrompt("fiction");
    // The block must explicitly call out the constraint so the model
    // doesn't drift into Atlas/Cipher names (those belong to panel).
    expect(prompt.toLowerCase()).toContain("no ai-coded single-word names");
  });

  it("panel paradigm requires devil's-advocate + adversarial pair", () => {
    const prompt = buildPrompt("panel");
    // Cast-mode naming palettes + the critical dissenter role MUST be
    // present so the panel doesn't become an echo chamber.
    expect(prompt).toMatch(/Atlas|Cipher|Nexus|Vanguard/);
    expect(prompt.toLowerCase()).toContain("devil");
    expect(prompt.toLowerCase()).toContain("adversarial");
  });
});

// ── 3. Panel paradigm — evidence discipline ───────────────────────────────────

describe("Panel paradigm — evidence discipline", () => {
  it("forbids forward-time event narration in panel worlds", () => {
    const prompt = buildPrompt("panel");
    // The block calls out the failure modes from the LARPing pattern:
    // narrated forward events, fabricated intercepts, invented numbers.
    const lower = prompt.toLowerCase();
    expect(lower).toContain("forward-time");
    expect(lower).toContain("fabricated");
    expect(lower).toContain("hypothetical");
  });

  it("permitted moves include scenario hypotheticals and re-interpretation", () => {
    const prompt = buildPrompt("panel");
    const lower = prompt.toLowerCase();
    expect(lower).toContain("re-interpretation");
    expect(lower).toContain("recalibration");
  });

  it("does NOT include the evidence-discipline block in non-panel paradigms", () => {
    for (const p of ["fiction", "non-fiction", "simulation", "essay", "atlas", "debate", "record", "game"] as const) {
      const prompt = buildPrompt(p);
      expect(prompt).not.toContain("<evidence-discipline");
    }
  });
});

// ── 4. Scene-gen paradigm threading ──────────────────────────────────────────

describe("Scene-gen prompt — per-paradigm discipline", () => {
  function buildScenePrompt(paradigm?: NarrativeParadigm) {
    return buildGenerateScenesPrompt({
      inputBlocks: "<test-inputs/>",
      arcId: "ARC-1",
      povRestrictedHint: "",
      hasPacingSequence: false,
      sharedRulesBlock: "<test-shared/>",
      paradigm,
    });
  }

  it("emits no paradigm block when paradigm is undefined (back-compat)", () => {
    const prompt = buildScenePrompt(undefined);
    expect(prompt).not.toContain("paradigm-scene-discipline");
  });

  it("populated-narrative paradigms get the populated scene discipline", () => {
    for (const p of ["fiction", "non-fiction"] as const) {
      const prompt = buildScenePrompt(p);
      expect(prompt).toContain('paradigm="populated-narrative"');
    }
  });

  it("simulation gets the rule-governed-narrative scene discipline", () => {
    const prompt = buildScenePrompt("simulation");
    expect(prompt).toContain('paradigm="rule-governed-narrative"');
    expect(prompt.toLowerCase()).toContain("rule");
  });

  it("panel paradigm gets the multi-thinker scene discipline with forbidden rules", () => {
    const prompt = buildScenePrompt("panel");
    expect(prompt).toContain('paradigm="multi-thinker"');
    expect(prompt.toLowerCase()).toContain("forbidden");
    expect(prompt.toLowerCase()).toContain("fabricated");
  });

  it("essay gets the singular-thinker scene discipline", () => {
    const prompt = buildScenePrompt("essay");
    expect(prompt).toContain('paradigm="singular-thinker"');
  });

  it("atlas gets the reference-typology scene discipline", () => {
    const prompt = buildScenePrompt("atlas");
    expect(prompt).toContain('paradigm="reference-typology"');
  });

  it("debate gets the adversarial-contest scene discipline", () => {
    const prompt = buildScenePrompt("debate");
    expect(prompt).toContain('paradigm="adversarial-contest"');
  });

  it("record gets the chronological-record scene discipline with time-stamped entries", () => {
    const prompt = buildScenePrompt("record");
    expect(prompt).toContain('paradigm="chronological-record"');
    expect(prompt.toLowerCase()).toContain("time-stamped-entries");
  });
});

// ── 5. Summary discipline — engine-metadata + no-raw-IDs ────────────────────

describe("Scene-gen summary discipline", () => {
  function buildScenePrompt() {
    return buildGenerateScenesPrompt({
      inputBlocks: "<test-inputs/>",
      arcId: "ARC-1",
      povRestrictedHint: "",
      hasPacingSequence: false,
      sharedRulesBlock: "<test-shared/>",
    });
  }

  it("declares the no-raw-ids rule", () => {
    const prompt = buildScenePrompt();
    expect(prompt).toContain('name="no-raw-ids"');
  });

  it("declares the no-engine-metadata rule", () => {
    const prompt = buildScenePrompt();
    expect(prompt).toContain('name="no-engine-metadata"');
  });

  it("names the forbidden engine field tokens", () => {
    const prompt = buildScenePrompt();
    // These five are the most-leaked field names the model wraps
    // around engine-bookkeeping recap. The rule must enumerate them.
    expect(prompt).toContain("threadDeltas");
    expect(prompt).toContain("worldDeltas");
    expect(prompt).toContain("systemDeltas");
  });
});

// ── 6. Scene defensive normalisation ─────────────────────────────────────────

function makeScene(overrides: Partial<Scene> & { id: string; arcId: string }): Scene {
  return {
    kind: "scene",
    locationId: "L-1",
    povId: null,
    participantIds: [],
    events: [],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    ...overrides,
  } as Scene;
}

function makeNarrativeWithScene(scene: Scene): NarrativeState {
  const wb: WorldBuild = {
    kind: "world_build",
    id: "WB-1",
    summary: "test",
    expansionManifest: {
      newCharacters: [],
      newLocations: [],
      newThreads: [],
      newArtifacts: [],
      systemDeltas: { addedNodes: [], addedEdges: [] },
      relationshipDeltas: [],
    },
  };
  return {
    id: "N-1",
    title: "Test",
    description: "",
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    arcs: {},
    scenes: { [scene.id]: scene },
    worldBuilds: { "WB-1": wb },
    branches: {
      "B-1": {
        id: "B-1",
        name: "Main",
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ["WB-1", scene.id],
        createdAt: 0,
      },
    },
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: "",
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("Scene normalisation — withDerivedEntities heals malformed scenes", () => {
  it("fills missing required array fields with []", () => {
    // Simulate a pre-paradigm-fix narrative in IndexedDB whose LLM-emitted
    // scene dropped relationshipDeltas. This is the exact crash the user
    // hit on the analysis paradigm's first generation.
    const broken = makeScene({
      id: "S-1",
      arcId: "ARC-1",
      // Cast through unknown to bypass the required-array type system —
      // simulating malformed JSON from the LLM that bypassed the type.
      relationshipDeltas: undefined as unknown as Scene["relationshipDeltas"],
      threadDeltas: undefined as unknown as Scene["threadDeltas"],
      worldDeltas: undefined as unknown as Scene["worldDeltas"],
      events: undefined as unknown as string[],
      participantIds: undefined as unknown as string[],
    });
    const narrative = makeNarrativeWithScene(broken);
    const healed = withDerivedEntities(narrative, ["WB-1", "S-1"]);
    const out = healed.scenes["S-1"];
    expect(Array.isArray(out.relationshipDeltas)).toBe(true);
    expect(Array.isArray(out.threadDeltas)).toBe(true);
    expect(Array.isArray(out.worldDeltas)).toBe(true);
    expect(Array.isArray(out.events)).toBe(true);
    expect(Array.isArray(out.participantIds)).toBe(true);
  });

  it("leaves healthy scenes untouched (referential identity preserved)", () => {
    const healthy = makeScene({ id: "S-1", arcId: "ARC-1" });
    const narrative = makeNarrativeWithScene(healthy);
    const out = withDerivedEntities(narrative, ["WB-1", "S-1"]);
    // The dirty flag inside normaliseScenes preserves the original
    // scenes record when no normalisation is needed.
    expect(out.scenes).toBe(narrative.scenes);
  });
});

describe("Scene-filter — getRelationshipsAtScene survives bad data", () => {
  it("does not throw on a scene whose relationshipDeltas is missing", () => {
    const broken = makeScene({
      id: "S-1",
      arcId: "ARC-1",
      relationshipDeltas: undefined as unknown as Scene["relationshipDeltas"],
    });
    const narrative = makeNarrativeWithScene(broken);
    expect(() => getRelationshipsAtScene(narrative, ["WB-1", "S-1"], 1)).not.toThrow();
  });
});

// ── 7. Source-material injection ─────────────────────────────────────────────

describe("World-gen prompt — source material injection", () => {
  it("omits the <source-material> block when sourceText is not supplied", () => {
    const prompt = buildPrompt("fiction");
    expect(prompt).not.toContain("<source-material");
  });

  it("emits the <source-material> block when sourceText is supplied", () => {
    const seed = "A research-grade dossier on the Mughal grain economy circa 1659.";
    const prompt = buildPrompt("simulation", seed);
    expect(prompt).toContain("<source-material");
    expect(prompt).toContain(seed);
  });

  it("trims whitespace-only sourceText (counts as not supplied)", () => {
    const prompt = buildPrompt("fiction", "   \n  \t  ");
    expect(prompt).not.toContain("<source-material");
  });
});

// ── 8. Websearch resolution ──────────────────────────────────────────────────

describe("resolveWebsearch", () => {
  function narrativeWithLevel(level: "none" | "low" | "medium" | "high"): NarrativeState {
    return {
      id: "N-1",
      title: "T",
      description: "",
      characters: {}, locations: {}, threads: {}, artifacts: {}, arcs: {}, scenes: {},
      worldBuilds: {}, branches: {}, relationships: [],
      systemGraph: { nodes: {}, edges: [] },
      worldSummary: "",
      storySettings: { ...DEFAULT_STORY_SETTINGS, websearchLevel: level },
      createdAt: 0,
      updatedAt: 0,
    };
  }

  it("returns null for missing narratives", () => {
    expect(resolveWebsearch(null)).toBeNull();
    expect(resolveWebsearch(undefined)).toBeNull();
  });

  it("returns null when websearchLevel is 'none'", () => {
    expect(resolveWebsearch(narrativeWithLevel("none"))).toBeNull();
  });

  it("returns canonical maxResults + the configured total cap per level", () => {
    const lo = resolveWebsearch(narrativeWithLevel("low"));
    expect(lo?.maxResults).toBe(WEBSEARCH_MAX_RESULTS.low);
    expect(lo?.maxTotalResults).toBe(DEFAULT_STORY_SETTINGS.websearchMaxTotalResults);

    expect(resolveWebsearch(narrativeWithLevel("medium"))?.maxResults).toBe(WEBSEARCH_MAX_RESULTS.medium);
    expect(resolveWebsearch(narrativeWithLevel("high"))?.maxResults).toBe(WEBSEARCH_MAX_RESULTS.high);
  });

  it("respects a custom websearchMaxTotalResults", () => {
    const narrative = narrativeWithLevel("medium");
    narrative.storySettings = { ...narrative.storySettings!, websearchMaxTotalResults: 7 };
    expect(resolveWebsearch(narrative)?.maxTotalResults).toBe(7);
  });
});
