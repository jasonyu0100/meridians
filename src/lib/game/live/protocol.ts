/** Conviction LIVE — the wire protocol between the master (GM) device and remote
 *  players. Authority: the GM browser is the ONE writer (its reducer + IndexedDB
 *  are truth). Players are thin clients — they send INTENTS up and render a
 *  redacted ROOM + NARRATIVE SLICE down, so the SAME components the GM uses
 *  (PokerTable, SeatHand, RankingsView, …) render the full board for a player,
 *  minus the GM-only affordances. A guest pass binds a token to (gameId, seatId);
 *  a player can only ever act as — and see — their own seat. The broker only
 *  forwards messages + caches the latest projection; it holds no game truth. */
import type { GameRoom, NarrativeState } from "@/types/narrative";

// ── Intents (player → master) ────────────────────────────────────────────────
// One per player-facing `useConviction` method; the seat is implied by the guest
// pass (never trusted from the client), so no intent carries a seatId.
export type Intent =
  | { cmd: "play"; cardId: string; conviction: number; faceUp: boolean }
  | { cmd: "fold" }
  | { cmd: "chat"; text: string; scope: "global" | "location"; locationId?: string }
  | { cmd: "addPrior"; streamId: string; text: string }
  | { cmd: "openStream"; question: string; intuition?: string }
  | { cmd: "move"; locationId: string }
  | { cmd: "ready"; ready: boolean };

// ── The seat-scoped projection (master → player) ─────────────────────────────
// A REDACTED GameRoom (opponents' hidden cards + un-played hands stripped, guest
// passes/log removed) + a minimal NARRATIVE SLICE (just the names, the player's
// own streams, public-action streams, the head arc's read perspectives, and
// locations) — exactly enough for the shared game components to render the seat's
// full experience and nothing else of the narrative.
export interface SeatProjection {
  gameId: string;
  seatId: string;
  room: GameRoom;
  narrative: NarrativeState;
}

export type GuestPass = {
  token: string;
  gameId: string;
  seatId: string;
  /** Epoch ms; 0 = no expiry. */
  expiresAt: number;
};
