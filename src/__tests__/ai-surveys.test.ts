// Tests for lib/ai/surveys — survey prompt building, proposal coercion, and response parsing.

import { describe, expect, it } from "vitest";
import {
  buildSurveyUserPrompt,
  coerceProposal,
  parseSurveyResponse,
  resolveRespondents,
  toggleRespondentTier,
  type Respondent,
} from "@/lib/ai/surveys";
import { CATEGORY_GUIDANCE, RESEARCH_CATEGORIES } from "@/lib/research-categories";
import type {
  Artifact,
  Character,
  Location,
  NarrativeState,
  Survey,
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

function makeSurvey(overrides: Partial<Survey> = {}): Survey {
  return {
    id: "S",
    question: "Are you committed to your path?",
    questionType: "binary",
    respondentFilter: { kinds: ["character"] },
    responses: {},
    status: "draft",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("resolveRespondents", () => {
  it("filters characters by role and orders anchors first", () => {
    const n = makeNarrative({
      characters: {
        T: makeChar("T", "transient", "Transient"),
        A: makeChar("A", "anchor", "Anchor"),
        R: makeChar("R", "recurring", "Recurring"),
      },
    });
    const out = resolveRespondents(n, { kinds: ["character"], characterRoles: ["anchor", "recurring"] });
    expect(out.map((r) => r.id)).toEqual(["A", "R"]);
  });

  it("filters locations by prominence", () => {
    const n = makeNarrative({
      locations: {
        D: makeLoc("D", "domain", "Domain"),
        M: makeLoc("M", "margin", "Margin"),
      },
    });
    const out = resolveRespondents(n, { kinds: ["location"], locationProminence: ["domain"] });
    expect(out.map((r) => r.id)).toEqual(["D"]);
  });

  it("filters artifacts by significance", () => {
    const n = makeNarrative({
      artifacts: {
        K: makeArtifact("K", "key", "Key"),
        N: makeArtifact("N", "notable", "Notable"),
      },
    });
    const out = resolveRespondents(n, { kinds: ["artifact"], artifactSignificance: ["key"] });
    expect(out.map((r) => r.id)).toEqual(["K"]);
  });

  it("includes all kinds when filter has more than one", () => {
    const n = makeNarrative({
      characters: { A: makeChar("A", "anchor") },
      locations: { L: makeLoc("L", "domain") },
      artifacts: { X: makeArtifact("X", "key") },
    });
    const out = resolveRespondents(n, {
      kinds: ["character", "location", "artifact"],
    });
    expect(out.map((r) => r.kind).sort()).toEqual(["artifact", "character", "location"]);
  });

  it("returns empty when filter omits all kinds the narrative has entries for", () => {
    const n = makeNarrative({ characters: { A: makeChar("A", "anchor") } });
    expect(resolveRespondents(n, { kinds: ["location"] })).toHaveLength(0);
  });
});

describe("buildSurveyUserPrompt", () => {
  it("requests JSON answer + reasoning for binary questions", () => {
    const out = buildSurveyUserPrompt(makeSurvey({ questionType: "binary" }));
    expect(out).toMatch(/"answer": true \| false/);
    expect(out).toMatch(/"reasoning"/);
  });

  it("includes the scale anchors for likert", () => {
    const out = buildSurveyUserPrompt(makeSurvey({ questionType: "likert", config: { scale: 7 } }));
    expect(out).toContain('scale="7"');
    expect(out).toContain("strongly disagree");
  });

  it("includes the unit attribute for estimate", () => {
    const out = buildSurveyUserPrompt(makeSurvey({ questionType: "estimate", config: { unit: "li" } }));
    expect(out).toContain('unit="li"');
  });

  it("lists choice options as XML <option> elements", () => {
    const out = buildSurveyUserPrompt(
      makeSurvey({ questionType: "choice", config: { options: ["fight", "flee", "negotiate"] } }),
    );
    expect(out).toContain('<option>fight</option>');
    expect(out).toContain('<option>flee</option>');
    expect(out).toContain('<option>negotiate</option>');
  });
});

const respChar = (): Respondent => ({
  kind: "character",
  id: "C",
  entity: makeChar("C", "anchor"),
});

describe("parseSurveyResponse", () => {
  it("parses binary booleans cleanly", () => {
    const out = parseSurveyResponse('{"answer": true, "reasoning": "obvious"}', makeSurvey({ questionType: "binary" }), respChar());
    expect(out.answer).toEqual({ type: "binary", value: true });
    expect(out.reasoning).toBe("obvious");
  });

  it("coerces yes/true/1 strings into binary true", () => {
    const out = parseSurveyResponse('{"answer": "Yes"}', makeSurvey({ questionType: "binary" }), respChar());
    expect(out.answer).toEqual({ type: "binary", value: true });
  });

  it("clamps likert into the configured scale range", () => {
    const survey = makeSurvey({ questionType: "likert", config: { scale: 5 } });
    expect(parseSurveyResponse('{"answer": 99}', survey, respChar()).answer).toEqual({ type: "likert", value: 5 });
    expect(parseSurveyResponse('{"answer": -3}', survey, respChar()).answer).toEqual({ type: "likert", value: 1 });
    expect(parseSurveyResponse('{"answer": "4"}', survey, respChar()).answer).toEqual({ type: "likert", value: 4 });
  });

  it("falls back to 0 for non-numeric estimate answers", () => {
    const out = parseSurveyResponse('{"answer": "many"}', makeSurvey({ questionType: "estimate" }), respChar());
    expect(out.answer).toEqual({ type: "estimate", value: 0 });
  });

  it("matches choice case-insensitively against the configured options", () => {
    const survey = makeSurvey({ questionType: "choice", config: { options: ["Fight", "Flee"] } });
    const out = parseSurveyResponse('{"answer": "flee"}', survey, respChar());
    expect(out.answer).toEqual({ type: "choice", value: "Flee" });
  });

  it("falls back to the first option when the model returns something unrecognised", () => {
    const survey = makeSurvey({ questionType: "choice", config: { options: ["Fight", "Flee"] } });
    const out = parseSurveyResponse('{"answer": "wat"}', survey, respChar());
    expect(out.answer).toEqual({ type: "choice", value: "Fight" });
  });

  it("trims open-ended text", () => {
    const out = parseSurveyResponse('{"answer": "  hello  ", "reasoning": "  why  "}', makeSurvey({ questionType: "open" }), respChar());
    expect(out.answer).toEqual({ type: "open", value: "hello" });
    expect(out.reasoning).toBe("why");
  });
});

describe("RESEARCH_CATEGORIES", () => {
  it("lists General as the first option", () => {
    expect(RESEARCH_CATEGORIES[0]).toBe("General");
  });

  it("has guidance text for every category", () => {
    for (const c of RESEARCH_CATEGORIES) {
      expect(CATEGORY_GUIDANCE[c]).toBeTruthy();
      expect(CATEGORY_GUIDANCE[c].length).toBeGreaterThan(40);
    }
  });
});

describe("toggleRespondentTier", () => {
  const ROLES = ["anchor", "recurring", "transient"] as const;

  it("treats undefined tier list as 'all included' and removes the clicked tier", () => {
    // UI contract: every chip shows lit when the filter lacks a tier array.
    // Clicking one must remove it from the implicit full set, not create a
    // single-element list that silently narrows scope to that tier alone.
    const next = toggleRespondentTier({ kinds: ["character"] }, "characterRoles", "transient", ROLES);
    expect(next.characterRoles).toEqual(["anchor", "recurring"]);
  });

  it("toggles a tier off when the list explicitly contains it", () => {
    const next = toggleRespondentTier(
      { kinds: ["character"], characterRoles: ["anchor", "recurring"] },
      "characterRoles",
      "anchor",
      ROLES,
    );
    expect(next.characterRoles).toEqual(["recurring"]);
  });

  it("toggles a tier back on when it was missing", () => {
    const next = toggleRespondentTier(
      { kinds: ["character"], characterRoles: ["anchor"] },
      "characterRoles",
      "recurring",
      ROLES,
    );
    expect(next.characterRoles).toEqual(["anchor", "recurring"]);
  });

  it("collapses back to undefined once every tier is included again", () => {
    const next = toggleRespondentTier(
      { kinds: ["character"], characterRoles: ["anchor", "recurring"] },
      "characterRoles",
      "transient",
      ROLES,
    );
    expect(next.characterRoles).toBeUndefined();
  });

  it("works identically for location prominence and artifact significance", () => {
    const prom = toggleRespondentTier(
      { kinds: ["location"] },
      "locationProminence",
      "domain",
      ["domain", "place", "margin"],
    );
    expect(prom.locationProminence).toEqual(["place", "margin"]);

    const sig = toggleRespondentTier(
      { kinds: ["artifact"], artifactSignificance: ["key", "notable", "minor"] },
      "artifactSignificance",
      "minor",
      ["key", "notable", "minor"],
    );
    expect(sig.artifactSignificance).toEqual(["key", "notable"]);
  });

  it("preserves sibling filter fields and the kinds list", () => {
    const before: Parameters<typeof toggleRespondentTier>[0] = {
      kinds: ["character", "location"],
      characterRoles: ["anchor"],
      locationProminence: ["domain"],
    };
    const next = toggleRespondentTier(before, "characterRoles", "recurring", ROLES);
    expect(next.kinds).toEqual(["character", "location"]);
    expect(next.locationProminence).toEqual(["domain"]);
  });
});

describe("coerceProposal", () => {
  it("returns null when the question is missing or empty", () => {
    expect(coerceProposal({})).toBeNull();
    expect(coerceProposal({ question: "   " })).toBeNull();
  });

  it("defaults to binary when questionType is invalid", () => {
    const out = coerceProposal({ question: "Do you see?", questionType: "weird" });
    expect(out?.questionType).toBe("binary");
  });

  it("preserves a likert scale from config", () => {
    const out = coerceProposal({
      question: "Trust level?",
      questionType: "likert",
      config: { scale: 7 },
    });
    expect(out?.config).toEqual({ scale: 7 });
  });

  it("drops an incomplete choice config (fewer than two options)", () => {
    const out = coerceProposal({
      question: "Pick",
      questionType: "choice",
      config: { options: ["only one"] },
    });
    expect(out?.config).toBeUndefined();
  });

  it("parses a valid suggestedFilter with kinds + tier arrays", () => {
    const out = coerceProposal({
      question: "Do the anchors trust the merchant?",
      questionType: "binary",
      suggestedFilter: {
        kinds: ["character"],
        characterRoles: ["anchor", "recurring"],
      },
    });
    expect(out?.suggestedFilter).toEqual({
      kinds: ["character"],
      characterRoles: ["anchor", "recurring"],
    });
  });

  it("drops the suggestedFilter when kinds is empty or malformed", () => {
    expect(coerceProposal({ question: "Q", suggestedFilter: {} })?.suggestedFilter).toBeUndefined();
    expect(coerceProposal({ question: "Q", suggestedFilter: { kinds: [] } })?.suggestedFilter).toBeUndefined();
    expect(coerceProposal({ question: "Q", suggestedFilter: { kinds: ["weird"] } })?.suggestedFilter).toBeUndefined();
  });

  it("filters tier arrays against the legal enum sets", () => {
    const out = coerceProposal({
      question: "Q",
      suggestedFilter: {
        kinds: ["character", "location"],
        characterRoles: ["anchor", "bogus", "recurring"],
        locationProminence: ["nonsense"],
      },
    });
    // Only the legal role values survive; the all-bogus prominence list is dropped entirely.
    expect(out?.suggestedFilter).toEqual({
      kinds: ["character", "location"],
      characterRoles: ["anchor", "recurring"],
    });
  });

  it("carries an intent string through when provided", () => {
    const out = coerceProposal({
      question: "Q",
      questionType: "binary",
      intent: "  reveal trust asymmetry  ",
    });
    expect(out?.intent).toBe("reveal trust asymmetry");
  });
});
