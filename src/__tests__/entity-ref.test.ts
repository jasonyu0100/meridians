// Tests for entity-ref — bracketed entity citations in chat / search, including
// multi-id (comma-separated) brackets like [C-31, C-32].

import { describe, expect, it } from "vitest";
import type { NarrativeState } from "@/types/narrative";
import {
  splitEntityRefIds,
  entityRefRegex,
  buildCitationNumbers,
  resolveEntityRef,
} from "@/lib/forces/entity-ref";
import { citedEntityIds } from "@/lib/search/citation-attribution";

// Minimal narrative: two characters the refs can resolve against.
const narrative = {
  characters: {
    "C-31": { id: "C-31", name: "Aragorn", role: "anchor" },
    "C-32": { id: "C-32", name: "Boromir", role: "recurring" },
  },
  locations: {},
  artifacts: {},
  threads: {},
  scenes: {},
  arcs: {},
  systemGraph: { nodes: {} },
  topics: {},
} as unknown as NarrativeState;

// ── splitEntityRefIds ────────────────────────────────────────────────────────

describe("splitEntityRefIds", () => {
  it("splits a comma-separated bracket body into individual ids", () => {
    expect(splitEntityRefIds("C-31, C-32")).toEqual(["C-31", "C-32"]);
  });

  it("returns a single-element list for one id", () => {
    expect(splitEntityRefIds("C-31")).toEqual(["C-31"]);
  });

  it("trims whitespace and drops blanks", () => {
    expect(splitEntityRefIds(" C-31 ,, C-32 ,")).toEqual(["C-31", "C-32"]);
  });
});

// ── regex ────────────────────────────────────────────────────────────────────

describe("entityRefRegex", () => {
  it("matches a multi-id bracket and captures the whole body", () => {
    const m = entityRefRegex().exec("see [C-31, C-32] here");
    expect(m?.[1]).toBe("C-31, C-32");
  });

  it("still matches a single-id bracket", () => {
    expect(entityRefRegex().exec("[C-31]")?.[1]).toBe("C-31");
  });

  it("does not match a markdown link label", () => {
    expect(entityRefRegex().exec("[C-31](http://x)")).toBeNull();
  });
});

// ── citation numbering / extraction ─────────────────────────────────────────

describe("buildCitationNumbers + citedEntityIds with multi-id brackets", () => {
  const text = "Both [C-31, C-32] clashed; later [C-31] returned, plus [C-99].";

  it("numbers each id inside a multi-id bracket, first-seen order, resolvable only", () => {
    const nums = buildCitationNumbers(text, narrative);
    expect(nums.get("C-31")).toBe(1);
    expect(nums.get("C-32")).toBe(2);
    // C-99 doesn't resolve, so it is never numbered.
    expect(nums.has("C-99")).toBe(false);
  });

  it("citedEntityIds expands and de-duplicates the grouped citation", () => {
    expect(citedEntityIds(text, narrative)).toEqual(["C-31", "C-32"]);
  });

  it("resolves each split id to its entity", () => {
    expect(resolveEntityRef(narrative, "C-31")?.label).toBe("Aragorn");
    expect(resolveEntityRef(narrative, "C-32")?.label).toBe("Boromir");
  });
});
