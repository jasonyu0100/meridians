import { beforeEach, describe, expect, it, vi } from "vitest";

// Conflict detection — mock the model and test the group-filtering contract:
// only valid claim ids survive, groups dedupe, and a group must have ≥2 to count.
vi.mock("@/lib/ai/api", () => ({ callGenerate: vi.fn() }));

import { callGenerate } from "@/lib/ai/api";
import { detectConflicts } from "@/lib/ai/game-conflicts";

const mockJson = (obj: unknown) => vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(obj));
const claims = [
  { id: "a", perspective: "Bull", question: "gold?", action: "gold rises" },
  { id: "b", perspective: "Bear", question: "gold?", action: "gold falls" },
  { id: "c", perspective: "Cat", question: "rates?", action: "hold" },
];

describe("detectConflicts — group filtering", () => {
  beforeEach(() => vi.mocked(callGenerate).mockReset());

  it("returns [] without calling the model for fewer than two claims", async () => {
    const out = await detectConflicts({ claims: [claims[0]] });
    expect(out).toEqual([]);
    expect(callGenerate).not.toHaveBeenCalled();
  });

  it("returns a valid conflicting group", async () => {
    mockJson({ conflicts: [["a", "b"]] });
    expect(await detectConflicts({ claims })).toEqual([["a", "b"]]);
  });

  it("strips unknown ids and drops groups that fall below two", async () => {
    mockJson({ conflicts: [["a", "ghost"], ["b", "c"]] });
    // ["a","ghost"] → ["a"] (length 1, dropped); ["b","c"] kept.
    expect(await detectConflicts({ claims })).toEqual([["b", "c"]]);
  });

  it("dedupes repeated ids within a group", async () => {
    mockJson({ conflicts: [["a", "a", "b"]] });
    expect(await detectConflicts({ claims })).toEqual([["a", "b"]]);
  });

  it("returns [] when conflicts is missing or not an array", async () => {
    mockJson({ conflicts: "nope" });
    expect(await detectConflicts({ claims })).toEqual([]);
  });
});
