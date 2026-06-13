/** Conviction LIVE — the in-process BROKER. A dumb message hub living in the
 *  single Next server process the GM runs (and tunnels): it forwards intents from
 *  players UP to the host and views from the host DOWN to players, and caches the
 *  latest per-seat view for late joiners / reconnects. It holds NO game truth —
 *  that's the GM browser's reducer + IndexedDB. Survives HMR via globalThis.
 *
 *  Wire: SSE down (host gets intents; each guest gets its seat's views), HTTP POST
 *  up (host publishes views; guest submits intents). A guest pass (token → seat)
 *  is the only authority a player carries — registered by the host, checked here. */
import type { GuestPass, Intent, SeatProjection } from "./protocol";

type Sink = (msg: unknown) => void;

interface Channel {
  /** Host SSE sinks — receive `{type:"intent"}` / `{type:"presence"}` messages. */
  hosts: Set<Sink>;
  /** Guest SSE sinks keyed by token — each receives ITS seat's `{type:"view"}`. */
  guests: Map<string, Sink>;
  /** Latest view per seat — replayed to a guest the instant it (re)connects. */
  latest: Map<string, SeatProjection>;
  /** Registered guest passes (token → seat binding). */
  passes: Map<string, GuestPass>;
  /** Live guest CONNECTION count per seat — how many devices are currently
   *  streaming that seat. >0 = the player is ONLINE (has opened the game). The
   *  host is notified on the 0↔1 edges so it can flag the seat online/offline. */
  online: Map<string, number>;
}

const store: { channels: Map<string, Channel> } =
  // Reuse across HMR reloads so live connections survive a dev recompile.
  (globalThis as unknown as { __convictionBroker?: { channels: Map<string, Channel> } }).__convictionBroker ??
  ((globalThis as unknown as { __convictionBroker?: unknown }).__convictionBroker = { channels: new Map() });

function channel(gameId: string): Channel {
  let c = store.channels.get(gameId);
  if (!c) {
    c = { hosts: new Set(), guests: new Map(), latest: new Map(), passes: new Map(), online: new Map() };
    store.channels.set(gameId, c);
  }
  return c;
}

// ── Guest passes ──────────────────────────────────────────────────────────────
/** Host registers (or refreshes) the seat tokens for a game. Revokes any token
 *  no longer present, dropping its live connection. */
export function registerPasses(gameId: string, passes: GuestPass[]): void {
  const c = channel(gameId);
  const next = new Map(passes.map((p) => [p.token, p]));
  // Drop connections whose pass was revoked.
  for (const token of c.guests.keys()) {
    if (!next.has(token)) c.guests.delete(token);
  }
  c.passes = next;
}

function resolvePass(gameId: string, token: string): GuestPass | null {
  const p = store.channels.get(gameId)?.passes.get(token);
  if (!p) return null;
  if (p.expiresAt && Date.now() > p.expiresAt) return null;
  return p;
}

// ── Host side ─────────────────────────────────────────────────────────────────
/** Host opens its intent stream — returns an unsubscribe. Replays current seat
 *  presence so a (re)connecting host immediately knows who's online. */
export function subscribeHost(gameId: string, sink: Sink): () => void {
  const c = channel(gameId);
  c.hosts.add(sink);
  for (const [seatId, count] of c.online) if (count > 0) sink({ type: "presence", seatId, online: true });
  return () => c.hosts.delete(sink);
}

/** Tell every connected host a seat's online status changed. */
function notifyPresence(c: Channel, seatId: string, online: boolean): void {
  for (const sink of c.hosts) sink({ type: "presence", seatId, online });
}

/** Host publishes a seat's view — cached and fanned out to that seat's guests. */
export function publishView(gameId: string, view: SeatProjection): void {
  const c = channel(gameId);
  c.latest.set(view.seatId, view);
  for (const [token, sink] of c.guests) {
    if (c.passes.get(token)?.seatId === view.seatId) sink({ type: "view", view });
  }
}

/** Host signals the game ended / cleared — tells everyone to close. */
export function publishEnded(gameId: string): void {
  const c = store.channels.get(gameId);
  if (!c) return;
  for (const sink of c.guests.values()) sink({ type: "ended" });
  store.channels.delete(gameId);
}

// ── Guest side ────────────────────────────────────────────────────────────────
/** Guest opens its view stream — validated by token; immediately replays the
 *  latest cached view for its seat. Returns null if the pass is invalid. */
export function subscribeGuest(gameId: string, token: string, sink: Sink): (() => void) | null {
  const pass = resolvePass(gameId, token);
  if (!pass) return null;
  const c = channel(gameId);
  c.guests.set(token, sink);
  // Mark the seat online (0→1 edge tells the host this player just came on).
  const seatId = pass.seatId;
  const before = c.online.get(seatId) ?? 0;
  c.online.set(seatId, before + 1);
  if (before === 0) notifyPresence(c, seatId, true);
  const cached = c.latest.get(seatId);
  if (cached) sink({ type: "view", view: cached });
  else sink({ type: "waiting" }); // host hasn't published yet
  return () => {
    if (c.guests.get(token) === sink) c.guests.delete(token);
    // Decrement presence; 1→0 edge tells the host this player went offline.
    const count = c.online.get(seatId) ?? 0;
    const next = Math.max(0, count - 1);
    c.online.set(seatId, next);
    if (count > 0 && next === 0) notifyPresence(c, seatId, false);
  };
}

/** Guest submits an intent — validated, then forwarded to the host(s) with the
 *  token's bound seat (never trusted from the client). Returns false if invalid. */
export function submitIntent(gameId: string, token: string, intent: Intent): boolean {
  const pass = resolvePass(gameId, token);
  if (!pass) return false;
  const c = channel(gameId);
  if (c.hosts.size === 0) return false; // no master connected
  for (const sink of c.hosts) sink({ type: "intent", seatId: pass.seatId, intent });
  return true;
}

/** Whether a master is currently connected for this game. */
export function hasHost(gameId: string): boolean {
  return (store.channels.get(gameId)?.hosts.size ?? 0) > 0;
}
