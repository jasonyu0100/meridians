/** Conviction LIVE — the intent GATE (master side). Going master-client means the
 *  UI can no longer be trusted to gate actions: a remote player could craft any
 *  intent. The master runs EVERY intent through this pure check before applying it
 *  — phase, turn, and ownership — so a player can only do what their seat may do,
 *  when it may do it. The base `useConviction` methods stay permissive (the GM has
 *  override powers via act-as); this is the layer that makes the wire safe. */
import type { GameRoom, NarrativeState } from "@/types/narrative";
import type { Intent } from "./protocol";

export type Verdict = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Verdict => ({ ok: false, reason });
const yes: Verdict = { ok: true };

/** Is it this seat's turn to act in PLAY? (Simultaneous = always; sequential =
 *  only the active seat.) */
function seatMayPlay(room: GameRoom, seatId: string): boolean {
  return room.economy.playOrder === "simultaneous" || room.round?.activeSeat === seatId;
}

/** Whether `seatId` is allowed to perform `intent` against the current room. The
 *  master rejects (drops) anything that fails. */
export function intentAllowed(
  room: GameRoom,
  narrative: NarrativeState,
  seatId: string,
  intent: Intent,
): Verdict {
  const seat = room.seats[seatId];
  if (!seat) return no("no such seat");
  // Readiness is the one thing a not-yet-seated player MUST be able to do — a
  // mid-game joiner readies up (status="pending") before the next round opens.
  if (intent.cmd === "ready") return yes;
  if (seat.status === "pending") return no("seat joins next round");
  const round = room.round;

  switch (intent.cmd) {
    case "play":
      if (room.paused) return no("paused");
      if (round?.phase !== "play") return no("not the play phase");
      if (!seatMayPlay(room, seatId)) return no("not your turn");
      return yes;
    case "fold":
      if (room.paused) return no("paused");
      if (round?.phase !== "play") return no("not the play phase");
      if (!seatMayPlay(room, seatId)) return no("not your turn");
      return yes;
    case "addPrior": {
      if (room.paused) return no("paused");
      if (round?.phase !== "write") return no("not the write phase");
      const stream = narrative.streams?.[intent.streamId];
      if (!stream) return no("no such stream");
      if (stream.perspectiveId !== seat.perspectiveId) return no("not your stream");
      return yes;
    }
    case "openStream":
      if (room.paused) return no("paused");
      if (round?.phase !== "write") return no("not the write phase");
      if (!intent.question.trim()) return no("empty question");
      return yes;
    case "move":
      // Movement is a signal; only character seats carry a location.
      if (narrative.perspectives?.[seat.perspectiveId]?.kind !== "character") return no("seat has no location");
      if (!room.locations.includes(intent.locationId) && !narrative.locations?.[intent.locationId]) return no("no such location");
      return yes;
    case "chat":
      if (!intent.text.trim()) return no("empty message");
      return yes;
  }
}

/** Normalise an intent before applying — clamp a player's location whisper to
 *  the place they are ACTUALLY at, so they can't whisper into a room they've not
 *  entered (the projection redacts on the receiving side too; this is the source). */
export function sanitizeIntent(room: GameRoom, seatId: string, intent: Intent): Intent {
  if (intent.cmd === "chat" && intent.scope === "location") {
    return { ...intent, locationId: room.seats[seatId]?.locationId };
  }
  return intent;
}
