import { describe, expect, it } from "vitest";

import { mentionedSeatIds, segmentMentions, type SeatHandle } from "@/lib/game/mentions";

const handles: SeatHandle[] = [
  { seatId: "s-harry", name: "Harry Potter" },
  { seatId: "s-ron", name: "Ron Weasley" },
  { seatId: "s-volde", name: "Voldemort" },
];

const tagged = (text: string) => [...mentionedSeatIds(text, handles)].sort();

describe("mentions — detection", () => {
  it("tags a full name and a first-name alias", () => {
    expect(tagged("watch out @Harry Potter")).toEqual(["s-harry"]);
    expect(tagged("@Harry, behind you")).toEqual(["s-harry"]);
    expect(tagged("@Voldemort is here")).toEqual(["s-volde"]);
  });

  it("tags multiple mentions in one message", () => {
    expect(tagged("@Harry and @Ron, regroup")).toEqual(["s-harry", "s-ron"]);
  });

  it("requires a boundary before @ and a full alias match", () => {
    expect(tagged("email me at owl@harry please")).toEqual([]); // mid-word @ → not a tag
    expect(tagged("@Har is not enough")).toEqual([]); // partial alias
    expect(tagged("@Harrys")).toEqual([]); // trailing letters → not a boundary
  });

  it("is case-insensitive", () => {
    expect(tagged("oi @harry")).toEqual(["s-harry"]);
  });

  it("returns nothing without handles or mentions", () => {
    expect([...mentionedSeatIds("@Harry", [])]).toEqual([]);
    expect(tagged("no tags here")).toEqual([]);
  });
});

describe("mentions — segmentation (for rendering)", () => {
  it("splits plain text around the mention token, preserving original casing", () => {
    const segs = segmentMentions("hey @Harry duck", handles);
    expect(segs).toEqual([
      { text: "hey ", seatIds: null },
      { text: "@Harry", seatIds: ["s-harry"] },
      { text: " duck", seatIds: null },
    ]);
  });

  it("prefers the longest alias (full name over first name)", () => {
    const segs = segmentMentions("@Harry Potter wins", handles);
    expect(segs[0]).toEqual({ text: "@Harry Potter", seatIds: ["s-harry"] });
  });

  it("a shared first name tags every matching seat", () => {
    const shared: SeatHandle[] = [
      { seatId: "a", name: "Harry Potter" },
      { seatId: "b", name: "Harry Osborn" },
    ];
    expect([...mentionedSeatIds("@Harry?", shared)].sort()).toEqual(["a", "b"]);
  });
});
