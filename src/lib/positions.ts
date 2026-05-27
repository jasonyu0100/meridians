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
