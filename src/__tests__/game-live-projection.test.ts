import { describe, it, expect } from "vitest";

import { projectForSeat } from "@/lib/game/live/projection";
import type { GameRoom, NarrativeState, Seat, Stream } from "@/types/narrative";

// Minimal fixtures — enough to exercise the redaction boundary.
const stream = (id: string, perspectiveId: string): Stream =>
  ({ id, perspectiveId, title: `Q ${id}`, outcomes: ["a", "b"], state: "open", branchId: "b1" } as unknown as Stream);

const seat = (id: string, over: Partial<Seat> = {}): Seat =>
  ({ id, perspectiveId: `p-${id}`, conviction: 50, color: "#fff", driver: "human", locationId: "L1", fateImpact: 0, ...over } as Seat);

function fixture() {
  const narrative = {
    title: "Test",
    branches: {},
    scenes: {},
    arcs: {},
    locations: { L1: { id: "L1", name: "Hall" } },
    perspectives: {
      "p-s1": { id: "p-s1", kind: "character", entityRef: "c1" },
      "p-s2": { id: "p-s2", kind: "character", entityRef: "c2" },
    },
    characters: { c1: { id: "c1", name: "Alice" }, c2: { id: "c2", name: "Bob" } },
    streams: { s1: stream("s1", "p-s1"), s2: stream("s2", "p-s2") },
  } as unknown as NarrativeState;

  const card = (id: string, streamId: string) => ({ id, streamId, outcome: 0, cost: 10, origin: "dealt" as const });
  const room = {
    id: "g1",
    branchId: "b1",
    phase: "round",
    paused: false,
    economy: { playOrder: "sequential", facedownPremium: 1.5, cardsPerRound: 3 },
    seats: { s1: seat("s1"), s2: seat("s2") },
    chat: [
      { id: "m1", scope: "global", seatId: "s1", text: "hi all", at: 1 },
      { id: "m2", scope: "location", seatId: "s2", text: "secret", at: 2, locationId: "L1", roundIndex: 0 },
    ],
    round: {
      index: 0,
      phase: "play",
      turnOrder: ["s1", "s2"],
      activeSeat: "s1",
      hands: {
        s1: { seatId: "s1", cards: [card("k1", "s1")], played: [{ card: card("k1", "s1"), faceUp: true, conviction: 10, playedAt: 1 }] },
        // Bob committed a FACE-DOWN card — must be redacted for Alice.
        s2: { seatId: "s2", cards: [card("k2", "s2")], played: [{ card: card("k2", "s2"), faceUp: false, conviction: 12, playedAt: 1 }] },
      },
      thinkingSeats: [],
    },
  } as unknown as GameRoom;
  return { room, narrative };
}

describe("projectForSeat — the seat-scoped redaction boundary", () => {
  it("returns null for a seat not in the room", () => {
    const { room, narrative } = fixture();
    expect(projectForSeat(room, narrative, "ghost")).toBeNull();
  });

  it("gives a seat its own hand + streams (only theirs)", () => {
    const { room, narrative } = fixture();
    const p = projectForSeat(room, narrative, "s1")!;
    expect(p.seatId).toBe("s1");
    expect(p.room.round!.hands.s1.cards.map((c) => c.id)).toEqual(["k1"]); // my hand full
    expect(Object.keys(p.narrative.streams ?? {})).toContain("s1"); // my stream resolves
  });

  it("strips opponents' un-played cards (you can't see their hand)", () => {
    const { room, narrative } = fixture();
    const p = projectForSeat(room, narrative, "s1")!;
    expect(p.room.round!.hands.s2.cards).toEqual([]); // Bob's dealt cards hidden
  });

  it("REDACTS an opponent's face-down card (no resolvable stream leaks)", () => {
    const { room, narrative } = fixture();
    const p = projectForSeat(room, narrative, "s1")!;
    const bobPlay = p.room.round!.hands.s2.played[0];
    expect(bobPlay.card.streamId).toBe(""); // action stripped
    expect(p.narrative.streams?.["s2"]).toBeUndefined(); // Bob's stream withheld
  });

  it("KEEPS a seat's own face-down card fully (you see your own move)", () => {
    const { room, narrative } = fixture();
    room.round!.hands.s1.played[0].faceUp = false;
    const p = projectForSeat(room, narrative, "s1")!;
    expect(p.room.round!.hands.s1.played[0].card.streamId).toBe("s1"); // not redacted for yourself
  });

  it("scopes chat to global + your own location this round", () => {
    const { room, narrative } = fixture();
    const p1 = projectForSeat(room, narrative, "s1")!;
    expect(p1.room.chat.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
    room.seats.s1.locationId = "L2";
    const p2 = projectForSeat(room, narrative, "s1")!;
    expect(p2.room.chat.map((m) => m.id)).toEqual(["m1"]);
  });

  it("strips guest tokens + the GM log from the player's room", () => {
    const { room, narrative } = fixture();
    (room as { guestPasses?: unknown }).guestPasses = [{ token: "secret", gameId: "g1", seatId: "s1", expiresAt: 0 }];
    (room as { log?: unknown }).log = [{ id: "e1", at: 1, kind: "play", text: "gm only" }];
    const p = projectForSeat(room, narrative, "s2")!;
    expect(p.room.guestPasses).toBeUndefined();
    expect(p.room.log).toEqual([]);
  });

  it("propagates seat presence (online / ready) untouched for the status dots", () => {
    const { room, narrative } = fixture();
    room.seats.s2.online = true;
    room.seats.s2.ready = true;
    const p = projectForSeat(room, narrative, "s1")!;
    expect(p.room.seats.s2.online).toBe(true);
    expect(p.room.seats.s2.ready).toBe(true);
  });

  // Round history + merges (Perspectives / History tabs) — shipped, but each arc's
  // perspectives scoped to PUBLIC + MY OWN read; no other player's lens crosses.
  function withHistory() {
    const { room, narrative } = fixture();
    narrative.arcs = {
      a1: {
        id: "a1",
        name: "Round 1",
        perspectives: {
          public: { key: "public", text: "everyone saw this" },
          c1: { key: "c1", text: "Alice's private read" },
          c2: { key: "c2", text: "Bob's PRIVATE read" },
        },
      },
    } as unknown as NarrativeState["arcs"];
    narrative.scenes = { sc1: { id: "sc1", arcId: "a1" } } as unknown as NarrativeState["scenes"];
    narrative.branches = { b1: { id: "b1", entryIds: ["sc1"] } } as unknown as NarrativeState["branches"];
    narrative.merges = { mg1: { id: "mg1", branchId: "b1", at: 1, streamIds: ["s1"], summary: "round 1 merge" } } as unknown as NarrativeState["merges"];
    room.round!.continuationSceneId = "sc1";
    return { room, narrative };
  }

  it("ships the branch + arc history + merge ledger so Perspectives/History render", () => {
    const { room, narrative } = withHistory();
    const p = projectForSeat(room, narrative, "s1")!;
    expect(p.narrative.branches?.["b1"]?.entryIds).toEqual(["sc1"]);
    expect(p.narrative.scenes?.["sc1"]?.arcId).toBe("a1");
    expect(p.narrative.arcs?.["a1"]).toBeTruthy();
    expect(Object.keys(p.narrative.merges ?? {})).toEqual(["mg1"]);
  });

  it("scopes arc perspectives to PUBLIC + my own — never another player's private read", () => {
    const { room, narrative } = withHistory();
    const forAlice = projectForSeat(room, narrative, "s1")!;
    const persp = forAlice.narrative.arcs!["a1"].perspectives!;
    expect(persp["public"]).toBeTruthy(); // public is shared
    expect(persp["c1"]).toBeTruthy(); // Alice's own read travels
    expect(persp["c2"]).toBeUndefined(); // Bob's private read does NOT leak to Alice
  });
});
