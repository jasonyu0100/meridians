/** Conviction — the fullscreen poker-table modal (entry point: TopBar Play).
 *  Three states: no active room → GameSetup (carries over economy from the last
 *  ended game on the branch); active room → GameShell; a just-ended game →
 *  GameReport (the end-of-game debrief). Ending a game sets phase "ended" on the
 *  room (which unlocks the branch and tears down the shell) but keeps it pinned
 *  this session so the report shows — closing the report clears the pin, and the
 *  room data is preserved for economy carryover on the next game. */
"use client";
import { Modal } from "@/components/Modal";
import { GameReport } from "@/components/game/GameReport";
import { GameSetup } from "@/components/game/GameSetup";
import { GameShell } from "@/components/game/GameShell";
import { useConviction } from "@/hooks/useConviction";
import { useStore } from "@/lib/state/store";

export function ConvictionModal({ onClose }: { onClose: () => void }) {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const { room, endedRoom, startGame, clearGame, dismissReport } = useConviction();

  // Closing the report clears the session pin so a re-open lands on setup (the
  // ended room stays in gameRooms for economy carryover). Used for both the
  // report's Close button and a backdrop/escape dismiss while it's showing.
  const closeReport = () => {
    dismissReport();
    onClose();
  };

  return (
    <Modal fullScreen onClose={narrative && endedRoom ? closeReport : onClose}>
      {!narrative ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-text-dim">
          Open a world first.
          <button onClick={onClose} className="rounded border border-border-subtle px-3 py-1.5 text-[12px] text-text-secondary transition hover:bg-white/5">
            Close
          </button>
        </div>
      ) : endedRoom ? (
        // The game just ended — show the debrief. Clear & set up a new game
        // removes the room (and the pin) → setup; Close keeps it for carryover.
        <GameReport room={endedRoom} narrative={narrative} onClear={clearGame} onClose={closeReport} />
      ) : !room ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <GameSetup onStart={startGame} onClose={onClose} />
        </div>
      ) : (
        // Minimise = close the window; the GameRoom lives on NarrativeState so
        // the round persists (and epoch-anchored clocks keep ticking) until the
        // GM re-opens from the TopBar. End game sets phase "ended" and shows the
        // report; the room is preserved for economy carryover.
        <GameShell room={room} onMinimise={onClose} />
      )}
    </Modal>
  );
}
