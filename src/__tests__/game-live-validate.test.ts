import { describe, it, expect } from "vitest";

import { intentAllowed, sanitizeIntent } from "@/lib/game/live/validate";
import type { GameRoom, NarrativeState } from "@/types/narrative";
import type { Intent } from "@/lib/game/live/protocol";

function setup(over: { phase?: string; playOrder?: string; activeSeat?: string | null; paused?: boolean } = {}) {
  const room = {
    id: "g1",
    branchId: "b1",
    phase: "round",
    paused: over.paused ?? false,
    locations: ["L1", "L2"],
    economy: { playOrder: over.playOrder ?? "sequential" },
    seats: {
      s1: { id: "s1", perspectiveId: "p1", locationId: "L1", status: "playing" },
      s2: { id: "s2", perspectiveId: "p2", locationId: "L2", status: "playing" },
      pend: { id: "pend", perspectiveId: "p3", locationId: "L1", status: "pending" },
    },
    round: { phase: over.phase ?? "play", activeSeat: over.activeSeat === undefined ? "s1" : over.activeSeat },
  } as unknown as GameRoom;
  const narrative = {
    streams: {
      s1q: { id: "s1q", perspectiveId: "p1", state: "open" },
      s2q: { id: "s2q", perspectiveId: "p2", state: "open" },
    },
    perspectives: { p1: { kind: "character", entityRef: "c1" }, p2: { kind: "character", entityRef: "c2" }, p3: { kind: "location" } },
    locations: { L1: { id: "L1", name: "Hall" }, L2: { id: "L2", name: "Yard" } },
  } as unknown as NarrativeState;
  return { room, narrative };
}

describe("intentAllowed — the master's untrusted-wire gate", () => {
  it("rejects an unknown seat and a pending seat", () => {
    const { room, narrative } = setup();
    expect(intentAllowed(room, narrative, "ghost", { cmd: "chat", text: "hi", scope: "global" }).ok).toBe(false);
    expect(intentAllowed(room, narrative, "pend", { cmd: "chat", text: "hi", scope: "global" }).ok).toBe(false);
  });

  describe("play / fold — phase + turn", () => {
    const play: Intent = { cmd: "play", cardId: "k", conviction: 10, faceUp: true };
    it("allows the ACTIVE seat to play in sequential, rejects others", () => {
      const { room, narrative } = setup({ phase: "play", activeSeat: "s1" });
      expect(intentAllowed(room, narrative, "s1", play).ok).toBe(true);
      expect(intentAllowed(room, narrative, "s2", play).ok).toBe(false); // not your turn
    });
    it("allows ANY seat to play in simultaneous", () => {
      const { room, narrative } = setup({ phase: "play", playOrder: "simultaneous", activeSeat: null });
      expect(intentAllowed(room, narrative, "s1", play).ok).toBe(true);
      expect(intentAllowed(room, narrative, "s2", play).ok).toBe(true);
    });
    it("rejects play outside the play phase or while paused", () => {
      expect(intentAllowed(setup({ phase: "write" }).room, setup().narrative, "s1", play).ok).toBe(false);
      expect(intentAllowed(setup({ phase: "play", paused: true }).room, setup().narrative, "s1", play).ok).toBe(false);
    });
  });

  describe("addPrior — write phase + STREAM OWNERSHIP", () => {
    it("allows a seat to prior its OWN stream in write", () => {
      const { room, narrative } = setup({ phase: "write" });
      expect(intentAllowed(room, narrative, "s1", { cmd: "addPrior", streamId: "s1q", text: "x" }).ok).toBe(true);
    });
    it("REJECTS priors on another seat's stream", () => {
      const { room, narrative } = setup({ phase: "write" });
      const v = intentAllowed(room, narrative, "s1", { cmd: "addPrior", streamId: "s2q", text: "x" });
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toMatch(/your stream/);
    });
    it("rejects priors outside the write phase", () => {
      const { room, narrative } = setup({ phase: "play" });
      expect(intentAllowed(room, narrative, "s1", { cmd: "addPrior", streamId: "s1q", text: "x" }).ok).toBe(false);
    });
  });

  describe("move — character only, real location", () => {
    it("allows a character seat to move to a real location", () => {
      const { room, narrative } = setup();
      expect(intentAllowed(room, narrative, "s1", { cmd: "move", locationId: "L2" }).ok).toBe(true);
    });
    it("rejects a non-character seat and an unknown location", () => {
      const { room, narrative } = setup();
      expect(intentAllowed(room, narrative, "pend", { cmd: "move", locationId: "L2" }).ok).toBe(false); // pending first, but also non-character p3
      expect(intentAllowed(room, narrative, "s1", { cmd: "move", locationId: "NOWHERE" }).ok).toBe(false);
    });
  });

  describe("ready — presence, allowed even before a seat is dealt in", () => {
    it("allows a PLAYING seat to ready / unready", () => {
      const { room, narrative } = setup();
      expect(intentAllowed(room, narrative, "s1", { cmd: "ready", ready: true }).ok).toBe(true);
      expect(intentAllowed(room, narrative, "s1", { cmd: "ready", ready: false }).ok).toBe(true);
    });
    it("allows a PENDING (mid-game joiner) seat to ready — the one thing it may do early", () => {
      const { room, narrative } = setup();
      // every other intent is rejected for a pending seat…
      expect(intentAllowed(room, narrative, "pend", { cmd: "chat", text: "hi", scope: "global" }).ok).toBe(false);
      // …but readying up is allowed so it can clear the gate before joining.
      expect(intentAllowed(room, narrative, "pend", { cmd: "ready", ready: true }).ok).toBe(true);
    });
    it("still rejects ready from an unknown seat", () => {
      const { room, narrative } = setup();
      expect(intentAllowed(room, narrative, "ghost", { cmd: "ready", ready: true }).ok).toBe(false);
    });
  });

  it("rejects empty chat / empty question", () => {
    const { room, narrative } = setup({ phase: "write" });
    expect(intentAllowed(room, narrative, "s1", { cmd: "chat", text: "   ", scope: "global" }).ok).toBe(false);
    expect(intentAllowed(room, narrative, "s1", { cmd: "openStream", question: "  " }).ok).toBe(false);
  });
});

describe("sanitizeIntent — clamp a whisper to the seat's own location", () => {
  it("rewrites a location chat's locationId to the sender's actual place", () => {
    const { room } = setup();
    const out = sanitizeIntent(room, "s1", { cmd: "chat", text: "psst", scope: "location", locationId: "L2" });
    expect(out).toEqual({ cmd: "chat", text: "psst", scope: "location", locationId: "L1" }); // s1 is at L1, not L2
  });
  it("leaves global chat + other intents untouched", () => {
    const { room } = setup();
    const g: Intent = { cmd: "chat", text: "all", scope: "global" };
    expect(sanitizeIntent(room, "s1", g)).toEqual(g);
    const p: Intent = { cmd: "play", cardId: "k", conviction: 5, faceUp: false };
    expect(sanitizeIntent(room, "s1", p)).toEqual(p);
  });
});
