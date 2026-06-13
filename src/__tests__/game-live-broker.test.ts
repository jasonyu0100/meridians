import { describe, it, expect, beforeEach } from "vitest";

import {
  registerPasses,
  subscribeHost,
  subscribeGuest,
  publishView,
  submitIntent,
  publishEnded,
  hasHost,
} from "@/lib/game/live/broker";
import type { GuestPass, SeatProjection } from "@/lib/game/live/protocol";

// Each test uses its own gameId so the module-singleton channels don't bleed.
let n = 0;
const gid = () => `BTEST-${n}`;
const pass = (token: string, seatId: string): GuestPass => ({ token, gameId: gid(), seatId, expiresAt: 0 });
const proj = (seatId: string): SeatProjection =>
  ({ gameId: gid(), seatId, room: {}, narrative: {} } as unknown as SeatProjection);

/** A sink that records every message it receives. */
const collector = () => {
  const msgs: { type: string; [k: string]: unknown }[] = [];
  return { sink: (m: unknown) => msgs.push(m as { type: string }), msgs };
};

beforeEach(() => {
  n += 1;
});

describe("broker — token validation + fan-out + intent routing", () => {
  it("denies a guest with an unknown / expired token", () => {
    registerPasses(gid(), [{ token: "ok", gameId: gid(), seatId: "s1", expiresAt: 0 }]);
    expect(subscribeGuest(gid(), "WRONG", () => {})).toBeNull();
    // expired
    registerPasses(gid(), [{ token: "old", gameId: gid(), seatId: "s1", expiresAt: 1 }]);
    expect(subscribeGuest(gid(), "old", () => {})).toBeNull();
  });

  it("replays the latest cached view to a guest the instant it connects", () => {
    registerPasses(gid(), [pass("t1", "s1")]);
    publishView(gid(), proj("s1")); // cached before anyone listens
    const { sink, msgs } = collector();
    const unsub = subscribeGuest(gid(), "t1", sink);
    expect(unsub).not.toBeNull();
    expect(msgs[0]).toMatchObject({ type: "view" });
  });

  it("says 'waiting' when the host hasn't published yet", () => {
    registerPasses(gid(), [pass("t1", "s1")]);
    const { sink, msgs } = collector();
    subscribeGuest(gid(), "t1", sink);
    expect(msgs[0]).toMatchObject({ type: "waiting" });
  });

  it("fans a view ONLY to that seat's guests", () => {
    registerPasses(gid(), [pass("t1", "s1"), pass("t2", "s2")]);
    const a = collector();
    const b = collector();
    subscribeGuest(gid(), "t1", a.sink); // s1
    subscribeGuest(gid(), "t2", b.sink); // s2
    a.msgs.length = 0;
    b.msgs.length = 0;
    publishView(gid(), proj("s1"));
    expect(a.msgs.some((m) => m.type === "view")).toBe(true); // s1 got it
    expect(b.msgs.some((m) => m.type === "view")).toBe(false); // s2 did NOT
  });

  it("forwards an intent to the host with the token's BOUND seat", () => {
    registerPasses(gid(), [pass("t1", "s1")]);
    const host = collector();
    subscribeHost(gid(), host.sink);
    const ok = submitIntent(gid(), "t1", { cmd: "fold" });
    expect(ok).toBe(true);
    const intent = host.msgs.find((m) => m.type === "intent");
    expect(intent).toMatchObject({ type: "intent", seatId: "s1" }); // seat from the pass, not the client
  });

  it("rejects an intent with a bad token, or when no host is connected", () => {
    registerPasses(gid(), [pass("t1", "s1")]);
    expect(submitIntent(gid(), "BAD", { cmd: "fold" })).toBe(false); // bad token
    expect(submitIntent(gid(), "t1", { cmd: "fold" })).toBe(false); // no host connected yet
    expect(hasHost(gid())).toBe(false);
    subscribeHost(gid(), () => {});
    expect(hasHost(gid())).toBe(true);
    expect(submitIntent(gid(), "t1", { cmd: "fold" })).toBe(true);
  });

  it("revoking a pass drops the guest's connection", () => {
    registerPasses(gid(), [pass("t1", "s1"), pass("t2", "s2")]);
    const a = collector();
    subscribeGuest(gid(), "t1", a.sink);
    a.msgs.length = 0;
    // Re-register WITHOUT t1 → revoked.
    registerPasses(gid(), [pass("t2", "s2")]);
    publishView(gid(), proj("s1"));
    expect(a.msgs.some((m) => m.type === "view")).toBe(false); // no longer receiving
    expect(submitIntent(gid(), "t1", { cmd: "fold" })).toBe(false); // pass gone
  });

  it("notifies the host on guest online (0→1) and offline (1→0) edges", () => {
    registerPasses(gid(), [pass("t1", "s1")]);
    const host = collector();
    subscribeHost(gid(), host.sink);
    const guest = collector();
    const unsub = subscribeGuest(gid(), "t1", guest.sink)!;
    expect(host.msgs).toContainEqual(expect.objectContaining({ type: "presence", seatId: "s1", online: true }));
    host.msgs.length = 0;
    unsub();
    expect(host.msgs).toContainEqual(expect.objectContaining({ type: "presence", seatId: "s1", online: false }));
  });

  it("only flips presence on the FIRST connect / LAST disconnect (two devices, one seat)", () => {
    registerPasses(gid(), [pass("t1", "s1")]);
    const host = collector();
    subscribeHost(gid(), host.sink);
    const a = subscribeGuest(gid(), "t1", () => {})!;
    const b = subscribeGuest(gid(), "t1", () => {})!; // 2nd device, same pass
    const online = host.msgs.filter((m) => m.type === "presence" && m.online === true);
    expect(online).toHaveLength(1); // only the 0→1 edge
    a(); // still one device left
    expect(host.msgs.filter((m) => m.type === "presence" && m.online === false)).toHaveLength(0);
    b(); // last one out → offline
    expect(host.msgs.filter((m) => m.type === "presence" && m.online === false)).toHaveLength(1);
  });

  it("replays current presence to a freshly (re)connected host", () => {
    registerPasses(gid(), [pass("t1", "s1")]);
    subscribeGuest(gid(), "t1", () => {}); // online before any host
    const host = collector();
    subscribeHost(gid(), host.sink);
    expect(host.msgs).toContainEqual(expect.objectContaining({ type: "presence", seatId: "s1", online: true }));
  });

  it("publishEnded notifies guests and tears the channel down", () => {
    registerPasses(gid(), [pass("t1", "s1")]);
    const a = collector();
    subscribeGuest(gid(), "t1", a.sink);
    publishEnded(gid());
    expect(a.msgs.some((m) => m.type === "ended")).toBe(true);
    // Channel gone → token no longer resolves.
    expect(subscribeGuest(gid(), "t1", () => {})).toBeNull();
  });
});
