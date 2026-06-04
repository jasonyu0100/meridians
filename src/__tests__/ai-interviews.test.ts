// Tests for lib/ai/interviews — single-subject interview question coercion and subject resolution.

import { describe, expect, it } from "vitest";
import { coerceQuestion, resolveSubject } from "@/lib/ai/interviews";
import type {
  Artifact,
  Character,
  Location,
  NarrativeState,
} from "@/types/narrative";

function makeNarrative(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    id: "N",
    title: "T",
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
  return {
    id,
    name,
    role,
    world: { nodes: {}, edges: [] },
    threadIds: [],
  } as Character;
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

function makeArtifact(id: string, significance: Artifact["significance"], name = id): Artifact {
  return {
    id,
    name,
    significance,
    parentId: null,
    world: { nodes: {}, edges: [] },
    threadIds: [],
  } as Artifact;
}

describe("resolveSubject", () => {
  it("returns the character wrapped as a Respondent", () => {
    const n = makeNarrative({ characters: { A: makeChar("A", "anchor", "Anchor") } });
    const r = resolveSubject(n, "A", "character");
    expect(r).toEqual({ kind: "character", id: "A", entity: n.characters.A });
  });

  it("returns the location wrapped as a Respondent", () => {
    const n = makeNarrative({ locations: { L: makeLoc("L", "domain", "Domain") } });
    const r = resolveSubject(n, "L", "location");
    expect(r).toEqual({ kind: "location", id: "L", entity: n.locations.L });
  });

  it("returns the artifact wrapped as a Respondent", () => {
    const n = makeNarrative({ artifacts: { X: makeArtifact("X", "key", "Key") } });
    const r = resolveSubject(n, "X", "artifact");
    expect(r).toEqual({ kind: "artifact", id: "X", entity: n.artifacts!.X });
  });

  it("returns null for an unknown id", () => {
    const n = makeNarrative({ characters: { A: makeChar("A", "anchor") } });
    expect(resolveSubject(n, "nobody", "character")).toBeNull();
  });

  it("returns null when the kind doesn't match any registry", () => {
    const n = makeNarrative({ characters: { A: makeChar("A", "anchor") } });
    // Searching for "A" as a location — character store has A but locations don't.
    expect(resolveSubject(n, "A", "location")).toBeNull();
  });
});

describe("coerceQuestion", () => {
  it("returns null when the question text is missing or empty", () => {
    expect(coerceQuestion({})).toBeNull();
    expect(coerceQuestion({ question: "   " })).toBeNull();
  });

  it("defaults an invalid questionType to 'open' (interview-safe fallback)", () => {
    const out = coerceQuestion({ question: "Tell me about yourself.", questionType: "weird" });
    expect(out?.questionType).toBe("open");
  });

  it("trims whitespace from the question text", () => {
    const out = coerceQuestion({ question: "  Who do you trust?  " });
    expect(out?.question).toBe("Who do you trust?");
  });

  it("normalises an invalid likert scale to 5", () => {
    const out = coerceQuestion({
      question: "How sure are you?",
      questionType: "likert",
      config: { scale: 99 },
    });
    expect(out?.config).toEqual({ scale: 5 });
  });

  it("keeps a legal likert scale (3, 5, or 7)", () => {
    for (const scale of [3, 5, 7] as const) {
      const out = coerceQuestion({
        question: "How sure?",
        questionType: "likert",
        config: { scale },
      });
      expect(out?.config).toEqual({ scale });
    }
  });

  it("preserves an estimate unit string", () => {
    const out = coerceQuestion({
      question: "How many li?",
      questionType: "estimate",
      config: { unit: " li " },
    });
    expect(out?.config).toEqual({ unit: "li" });
  });

  it("drops a choice config with fewer than two options", () => {
    const out = coerceQuestion({
      question: "Pick one",
      questionType: "choice",
      config: { options: ["only"] },
    });
    expect(out?.config).toBeUndefined();
  });

  it("keeps a valid choice config with ≥2 options", () => {
    const out = coerceQuestion({
      question: "Fight or flee?",
      questionType: "choice",
      config: { options: ["fight", "flee", "negotiate"] },
    });
    expect(out?.config).toEqual({ options: ["fight", "flee", "negotiate"] });
  });

  it("strips empty/non-string choice options before counting", () => {
    const out = coerceQuestion({
      question: "Pick",
      questionType: "choice",
      config: { options: ["  ", "A", null, "", "B"] },
    });
    expect(out?.config).toEqual({ options: ["A", "B"] });
  });
});
