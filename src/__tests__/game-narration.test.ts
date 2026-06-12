import { describe, expect, it } from "vitest";

import { missingRoomPerspectiveKeys, narrationKeysForRoom } from "@/lib/ai/game-narration";
import type { Arc, GameRoom, NarrativeState } from "@/types/narrative";

describe("narration — narrationKeysForRoom", () => {
  const narrative = {
    perspectives: {
      pA: { id: "pA", kind: "character", entityRef: "C-1" },
      pB: { id: "pB", kind: "location", entityRef: "L-1" },
      pNarr: { id: "pNarr", kind: "narrator" }, // no entityRef
    },
  } as unknown as NarrativeState;

  it("always leads with 'public', then one key per seated perspective's entity", () => {
    const room = {
      seats: { s1: { perspectiveId: "pA" }, s2: { perspectiveId: "pB" } },
    } as unknown as GameRoom;
    expect(narrationKeysForRoom(room, narrative)).toEqual(["public", "C-1", "L-1"]);
  });

  it("dedupes shared perspectives and skips entity-less (narrator) seats", () => {
    const room = {
      seats: { s1: { perspectiveId: "pA" }, s2: { perspectiveId: "pA" }, s3: { perspectiveId: "pNarr" } },
    } as unknown as GameRoom;
    expect(narrationKeysForRoom(room, narrative)).toEqual(["public", "C-1"]);
  });
});

describe("narration — missingRoomPerspectiveKeys (the READ-phase requirement)", () => {
  const narrative = {
    perspectives: { pA: { id: "pA", kind: "character", entityRef: "C-1" }, pB: { id: "pB", kind: "location", entityRef: "L-1" } },
  } as unknown as NarrativeState;
  const room = { seats: { s1: { perspectiveId: "pA" }, s2: { perspectiveId: "pB" } } } as unknown as GameRoom;
  const arc = (perspectives: Record<string, { text?: string }>): Arc => ({ perspectives } as unknown as Arc);

  it("returns every needed lens when the arc has none", () => {
    expect(missingRoomPerspectiveKeys(room, narrative, arc({}))).toEqual(["public", "C-1", "L-1"]);
  });

  it("skips lenses already recorded on the arc (no rewrites)", () => {
    expect(missingRoomPerspectiveKeys(room, narrative, arc({ public: { text: "x" }, "C-1": { text: "y" } }))).toEqual(["L-1"]);
  });

  it("treats an empty-text view as still missing (a failed render regenerates)", () => {
    expect(missingRoomPerspectiveKeys(room, narrative, arc({ public: { text: "" }, "C-1": { text: "y" }, "L-1": { text: "z" } }))).toEqual(["public"]);
  });

  it("is empty when every needed lens is already recorded", () => {
    expect(missingRoomPerspectiveKeys(room, narrative, arc({ public: { text: "a" }, "C-1": { text: "b" }, "L-1": { text: "c" } }))).toEqual([]);
  });
});
