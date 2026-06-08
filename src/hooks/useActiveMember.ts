"use client";

/**
 * useActiveMember — the room's currently-active member.
 *
 * One selection, set in the Members modal, that presets member-scoped surfaces:
 * Learn quizzes record coverage under this member, and stream contributions
 * default to them. It's a device-local UI selection, so it lives in the
 * per-narrative view state (`viewState.activeMemberId`) — persisted in
 * IndexedDB so it survives reloads, but not carried on package export. When
 * unset, those surfaces fall back to a manual choice.
 */

import { useCallback } from "react";
import { useStore } from "@/lib/state/store";
import type { Member } from "@/types/narrative";

export function useActiveMember(): {
  memberId: string | null;
  setMemberId: (id: string) => void;
} {
  const { state, dispatch } = useStore();
  const memberId = state.viewState.activeMemberId;
  const setMemberId = useCallback(
    (id: string) => dispatch({ type: "SET_ACTIVE_MEMBER", memberId: id || null }),
    [dispatch],
  );
  return { memberId, setMemberId };
}

/** Display name for a member ("First Last"), trimmed. */
export function memberName(m: Member): string {
  return `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Unnamed";
}
