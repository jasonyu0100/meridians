// Entity positions — derives each character's current location from scene participation history.

import type { NarrativeState } from "@/types/narrative";

/**
 * Compute each character's current location by walking scenes up to
 * currentIndex in chronological order. Position is the locationId of the
 * most recent scene where the character is a participant — a character's
 * position only changes when they appear somewhere new.
 *
 * Participation is the only signal: no separate movement delta to maintain.
 * Characters never seen in any scene up to currentIndex have no entry.
 */
export function computeCumulativePositions(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): Record<string, string> {
  const positions: Record<string, string> = {};
  const lastIdx = Math.min(currentIndex, resolvedKeys.length - 1);
  for (let i = 0; i <= lastIdx; i++) {
    const scene = narrative.scenes[resolvedKeys[i]];
    if (!scene || !scene.locationId) continue;
    for (const pid of scene.participantIds) {
      positions[pid] = scene.locationId;
    }
  }
  return positions;
}

/** Last-known position = participation-derived position, OVERLAID with any live
 *  Conviction movement intent. A seated character that has signalled a move this
 *  round (`movedThisRound`) is shown AT its intended location — the move updates
 *  last-known-position immediately, before the continuation realises it. Once the
 *  continuation generates, participation re-asserts the truth and the game
 *  re-syncs, so this overlay is only the in-round signal. Falls back exactly to
 *  participation when no game is live. */
export function lastKnownPositions(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): Record<string, string> {
  const positions = computeCumulativePositions(narrative, resolvedKeys, currentIndex);
  const room = Object.values(narrative.gameRooms ?? {}).find((r) => r.phase !== "ended");
  if (room) {
    for (const seat of Object.values(room.seats)) {
      if (!seat.movedThisRound) continue;
      const persp = narrative.perspectives?.[seat.perspectiveId];
      if (persp?.kind === "character" && persp.entityRef) positions[persp.entityRef] = seat.locationId;
    }
  }
  return positions;
}
