/** Conviction LIVE — the seat-scoped PROJECTION (the security boundary). Given
 *  the master's full room + narrative and a seat, produce a REDACTED room + a
 *  minimal narrative SLICE the shared game components can render for that player.
 *  Redaction: an opponent's face-down cards lose their action, opponents' un-played
 *  hands are stripped, other seats' private streams and the rest of the narrative
 *  never cross, and the guest-pass tokens / GM log are removed. Pure + testable. */
import { mergesForBranch, streamsForBranch } from "@/lib/merges";
import type { Arc, GameRoom, Hand, Merge, NarrativeState, RoundState, Stream } from "@/types/narrative";
import type { SeatProjection } from "./protocol";

/** The head arc the round narrates (its continuation, now the branch head). */
function headArcOf(room: GameRoom, narrative: NarrativeState) {
  const sceneId = room.round?.continuationSceneId;
  const arcId = sceneId ? narrative.scenes[sceneId]?.arcId : undefined;
  return arcId ? narrative.arcs[arcId] : undefined;
}

/** Redact the room to what THIS seat may see: keep all public table state, but
 *  strip opponents' un-played cards and blank their concealed plays. */
function redactRoom(room: GameRoom, seatId: string): GameRoom {
  const round: RoundState | null = room.round
    ? {
        ...room.round,
        hands: Object.fromEntries(
          Object.entries(room.round.hands).map(([sid, hand]): [string, Hand] => {
            if (sid === seatId) return [sid, hand]; // my hand — full
            const played = hand.played.map((p) =>
              !p.faceUp && !p.revealed ? { ...p, card: { ...p.card, streamId: "", outcome: -1 } } : p,
            );
            // Opponents: hide the cards they were dealt but haven't committed.
            return [sid, { ...hand, cards: [], played }];
          }),
        ),
      }
    : null;
  // Chat I can see: all GLOBAL, plus LOCATION whispers at MY place this round.
  const me = room.seats[seatId];
  const chat = room.chat.filter(
    (m) =>
      m.scope === "global" ||
      (m.scope === "location" && m.locationId === me?.locationId && m.roundIndex === room.round?.index),
  );
  // Strip GM-only / secret fields (tokens, the event log).
  return { ...room, round, chat, guestPasses: undefined, log: [], live: false };
}

/** Build the minimal narrative slice the shared components read — names, the
 *  player's own + public streams, the head arc's read perspectives, locations. */
function narrativeSlice(room: GameRoom, narrative: NarrativeState, seatId: string): NarrativeState {
  const perspectives: NarrativeState["perspectives"] = {};
  const characters: Record<string, { id: string; name: string }> = {};
  const locations: Record<string, { id: string; name: string }> = {};
  const artifacts: Record<string, { id: string; name: string }> = {};

  // Names for every seat (for perspectiveName) — only id + name leak, nothing else.
  for (const s of Object.values(room.seats)) {
    const p = narrative.perspectives?.[s.perspectiveId];
    if (!p) continue;
    perspectives[s.perspectiveId] = p;
    if (p.entityRef) {
      const src =
        p.kind === "character" ? narrative.characters : p.kind === "location" ? narrative.locations : narrative.artifacts;
      const ent = src?.[p.entityRef];
      if (ent) {
        const bucket = p.kind === "character" ? characters : p.kind === "location" ? locations : artifacts;
        bucket[p.entityRef] = { id: ent.id, name: ent.name };
      }
    }
  }
  // Locations the player can move to (id + name only).
  for (const l of Object.values(narrative.locations ?? {})) locations[l.id] = { id: l.id, name: l.name };

  // Streams the player sees: ALL of their OWN (open to write into, plus committed /
  // closed so the Write panel's "Committed & closed" history matches the GM's) +
  // the public-action streams (any non-concealed committed card).
  const branchStreams = streamsForBranch(narrative, room.branchId);
  const mySeat = room.seats[seatId];
  const streams: Record<string, Stream> = {};
  for (const s of branchStreams) {
    if (mySeat && s.perspectiveId === mySeat.perspectiveId) streams[s.id] = s;
  }
  const publicStreamIds = new Set<string>();
  for (const hand of Object.values(room.round?.hands ?? {})) {
    for (const p of hand.played) if (p.faceUp || p.revealed) publicStreamIds.add(p.card.streamId);
  }
  for (const s of branchStreams) if (publicStreamIds.has(s.id)) streams[s.id] = s;

  // ROUND HISTORY — the full sequence of delivered arcs (the Perspectives panel's
  // history) + the branch entry order + scene→arc map + the merge ledger (the
  // History tab). Every arc's perspectives are scoped to PUBLIC + this seat's own
  // read, so no other player's private lens ever crosses the wire. Arc names /
  // summaries and merge results are canonical (already public game outcomes).
  const myEntity = mySeat ? narrative.perspectives?.[mySeat.perspectiveId]?.entityRef : undefined;
  const scopeArc = (a: Arc): Arc => {
    const persp: NonNullable<Arc["perspectives"]> = {};
    if (a.perspectives?.["public"]) persp["public"] = a.perspectives["public"];
    if (myEntity && a.perspectives?.[myEntity]) persp[myEntity] = a.perspectives[myEntity];
    return { ...a, perspectives: persp };
  };
  const arcs: NarrativeState["arcs"] = {};
  const scenes: NarrativeState["scenes"] = {};
  const branch = narrative.branches?.[room.branchId];
  const entryIds = branch?.entryIds ?? [];
  for (const id of entryIds) {
    const sc = narrative.scenes[id];
    if (!sc) continue; // world-commit entries carry no arc — skipped (as the panel does)
    scenes[id] = { id: sc.id, arcId: sc.arcId } as NarrativeState["scenes"][string];
    const a = narrative.arcs[sc.arcId];
    if (a && !arcs[a.id]) arcs[a.id] = scopeArc(a);
  }
  // The head arc + its continuation scene, even if not yet woven into entryIds.
  const headArc = headArcOf(room, narrative);
  const contId = room.round?.continuationSceneId;
  if (headArc && !arcs[headArc.id]) arcs[headArc.id] = scopeArc(headArc);
  if (contId && !scenes[contId]) {
    const arcId = headArc?.id ?? narrative.scenes[contId]?.arcId ?? "";
    scenes[contId] = { id: contId, arcId } as NarrativeState["scenes"][string];
  }
  const branches = branch ? { [room.branchId]: branch } : {};
  const merges: Record<string, Merge> = {};
  for (const m of mergesForBranch(narrative, room.branchId)) merges[m.id] = m;

  return {
    title: narrative.title,
    perspectives,
    characters,
    locations,
    artifacts,
    streams,
    arcs,
    scenes,
    branches,
    merges,
    threads: {},
    worldBuilds: {},
    members: {},
    agents: {},
  } as unknown as NarrativeState;
}

/** The full seat projection (redacted room + narrative slice). Null if the seat
 *  isn't in the room (revoked / bad token). */
export function projectForSeat(room: GameRoom, narrative: NarrativeState, seatId: string): SeatProjection | null {
  if (!room.seats[seatId]) return null;
  return {
    gameId: room.id,
    seatId,
    room: redactRoom(room, seatId),
    narrative: narrativeSlice(room, narrative, seatId),
  };
}
