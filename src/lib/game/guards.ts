/** Conviction guardrails — world-state protection while a game is live
 *  (CONCEPT.md §Key invariants; plan §5b). A game runs on the HEAD of its
 *  branch, so out-of-band deletion or manual generation onto that branch would
 *  corrupt the round loop. These pure predicates back the reducer hard-guard and
 *  the UI's disabled-affordance tooltips. The game's OWN RESOLVE generation runs
 *  through useConviction (BULK_ADD_SCENES directly), so it is never caught here. */
import type { GameRoom, NarrativeState } from "@/types/narrative";

/** The active (non-ended) game on a branch, if any. Pause does NOT unlock —
 *  it only halts timers and frees the GM to navigate. */
export function activeGameForBranch(
  n: NarrativeState,
  branchId: string | null | undefined,
): GameRoom | undefined {
  if (!branchId) return undefined;
  return Object.values(n.gameRooms ?? {}).find(
    (r) => r.branchId === branchId && r.phase !== "ended",
  );
}

/** True when a branch carries a live game — deletion + manual generation onto it
 *  are forbidden until the game ends or is cleared. */
export function isBranchGameLocked(
  n: NarrativeState,
  branchId: string | null | undefined,
): boolean {
  return !!activeGameForBranch(n, branchId);
}

/** Resolve the branch a stream/merge belongs to (for guarding REMOVE_STREAM /
 *  REVERT_MERGE which carry an entity id, not a branchId). */
export function branchOfStream(n: NarrativeState, streamId: string): string | undefined {
  return n.streams?.[streamId]?.branchId ?? undefined;
}
export function branchOfMerge(n: NarrativeState, mergeId: string): string | undefined {
  return n.merges?.[mergeId]?.branchId ?? undefined;
}

export const GAME_LOCK_MESSAGE =
  "Game active on this branch — generation is the GM's one-click round advance, and delete is locked until the game ends or is cleared.";
