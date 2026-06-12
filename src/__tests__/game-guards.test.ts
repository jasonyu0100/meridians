import { describe, expect, it } from "vitest";

import {
  activeGameForBranch,
  branchOfMerge,
  branchOfStream,
  isBranchGameLocked,
} from "@/lib/game/guards";
import type { NarrativeState } from "@/types/narrative";

const n = {
  gameRooms: {
    live: { id: "live", branchId: "b-live", phase: "round" },
    paused: { id: "paused", branchId: "b-paused", phase: "round", paused: true },
    done: { id: "done", branchId: "b-done", phase: "ended" },
  },
  streams: { st1: { id: "st1", branchId: "b-stream" } },
  merges: { m1: { id: "m1", branchId: "b-merge" } },
} as unknown as NarrativeState;

describe("guards — active game + branch lock", () => {
  it("finds the non-ended game on a branch", () => {
    expect(activeGameForBranch(n, "b-live")?.id).toBe("live");
    expect(activeGameForBranch(n, "b-done")).toBeUndefined(); // ended → not active
    expect(activeGameForBranch(n, "b-none")).toBeUndefined();
    expect(activeGameForBranch(n, null)).toBeUndefined();
  });

  it("a paused game still locks the branch (pause only halts timers)", () => {
    expect(isBranchGameLocked(n, "b-paused")).toBe(true);
  });

  it("locks live branches, leaves ended/unknown branches free", () => {
    expect(isBranchGameLocked(n, "b-live")).toBe(true);
    expect(isBranchGameLocked(n, "b-done")).toBe(false);
    expect(isBranchGameLocked(n, "b-none")).toBe(false);
    expect(isBranchGameLocked(n, undefined)).toBe(false);
  });
});

describe("guards — entity → branch resolution", () => {
  it("resolves a stream's / merge's owning branch, undefined when missing", () => {
    expect(branchOfStream(n, "st1")).toBe("b-stream");
    expect(branchOfStream(n, "nope")).toBeUndefined();
    expect(branchOfMerge(n, "m1")).toBe("b-merge");
    expect(branchOfMerge(n, "nope")).toBeUndefined();
  });
});
