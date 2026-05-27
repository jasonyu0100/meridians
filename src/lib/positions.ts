import type { NarrativeState } from "@/types/narrative";

/**
 * Walk every scene up to currentIndex in chronological order and replay
 * characterMovements deltas to compute each character's current location.
 *
 * Falls back to first-participation scene location as the implicit seed for
 * characters who have never been explicitly moved — preserves the legacy
 * "participation = presence" assumption for first introductions while
 * letting characterMovements be the source of truth for everything after.
 *
 * Cumulative across arc boundaries: this is the cross-arc counterpart to
 * graph-utils.computeCharacterPositions (which is scoped to a single arc and
 * reads arc.initialCharacterLocations).
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
    if (!scene) continue;
    for (const pid of scene.participantIds) {
      if (!(pid in positions) && scene.locationId) positions[pid] = scene.locationId;
    }
    if (scene.characterMovements) {
      for (const [charId, mv] of Object.entries(scene.characterMovements)) {
        positions[charId] = mv.locationId;
      }
    }
  }
  return positions;
}
