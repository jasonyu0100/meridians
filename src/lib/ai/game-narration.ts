/** Conviction narration — the perspective lenses a room reads through each round.
 *  The retellings themselves are rendered by `generateArcPerspective` over the
 *  continuation arc; the shared `Arc.perspectives` store holds them. This module
 *  is the pure selection: who needs a lens, and which are still missing on an arc
 *  (the conviction READ phase's generation requirement). */
import type { Arc, GameRoom, NarrativeState, Perspective } from "@/types/narrative";

const PUBLIC_KEY = "public";

/** The perspective entity keys a room's seats read through — `public` first,
 *  then each seat's entity (deduped; narrator seats only get public). */
export function narrationKeysForRoom(room: GameRoom, narrative: NarrativeState): string[] {
  const keys = new Set<string>([PUBLIC_KEY]);
  for (const seat of Object.values(room.seats)) {
    const persp = narrative.perspectives?.[seat.perspectiveId] as Perspective | undefined;
    if (persp?.entityRef) keys.add(persp.entityRef);
  }
  return [...keys];
}

/** The READ-phase requirement: the room's lenses that the arc does NOT yet carry
 *  a recorded perspective for. Empty = nothing to generate (every needed lens is
 *  already on the arc — so re-entry / a mid-game seat fills gaps, never rewrites). */
export function missingRoomPerspectiveKeys(room: GameRoom, narrative: NarrativeState, arc: Arc): string[] {
  return narrationKeysForRoom(room, narrative).filter((key) => !arc.perspectives?.[key]?.text);
}
