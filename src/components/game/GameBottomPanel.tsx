/** Conviction bottom dock (GameShell) — the lower panel that mirrors the
 *  narrative workspace's bottom strip. It adapts to who's at the wheel:
 *   · GM (not impersonating) → the control deck: the one-click round advance,
 *     pause/end/clear, and a clear whose-turn callout. GMs hold no cards, so the
 *     space is the operator console — a game can be run solo for testing.
 *   · Impersonating a seat → that seat's player interface: the hand of cards +
 *     play controls (same view the player would get), with a turn banner.
 *  Plan §8 / §5b–c. */
"use client";
import { useState } from "react";

import { Modal, ModalHeader } from "@/components/Modal";
import { SeatHand } from "@/components/game/SeatHand";
import { LocationPicker } from "@/components/generation/AdvancedSettingsModal";
import { perspectiveName } from "@/components/stage/RoomUI";
import type { GameRoom, NarrativeState } from "@/types/narrative";

// The player loop — Read → Write → Play — then Showdown + Resolve.
const NEXT_LABEL: Record<string, string> = {
  read: "Open the write window",
  write: "Deal & open play",
  play: "Close acting · showdown",
  showdown: "Continue to resolution",
  resolve: "Generate in the panel",
};

/** Phase → what's happening (the verb shown on the deck). */
const PHASE_VERB: Record<string, string> = {
  read: "Read — perspectives delivered; seats catch up",
  write: "Write — players open streams & add priors",
  play: "Play — players commit cards",
  showdown: "Showdown — reveal all cards, settle conflicts together",
  resolve: "Resolve — GM generates the continuation in the panel",
};

export function GameBottomPanel({
  room,
  narrative,
  actAsSeatId,
  onAdvance,
  onCancelGeneration,
  onPause,
  onEnd,
  onClear,
  onPlay,
  onVeto,
  onActAsSeat,
  onMove,
  onResolveOpen,
  onMinimise,
  playLocked,
}: {
  room: GameRoom;
  narrative: NarrativeState;
  actAsSeatId: string | null;
  onAdvance: () => Promise<void> | void;
  /** GM cancels the in-flight generation (e.g. if it has stalled) — clears the
   *  generating/thinking flags so the phase unblocks and Advance can retry. */
  onCancelGeneration: () => void;
  onPause: (paused: boolean) => void;
  onEnd: () => void;
  onClear: () => void;
  onPlay: (seatId: string, cardId: string, conviction: number, faceUp: boolean) => void;
  /** GM veto — pull back a committed play for a seat (refund + revert stance). */
  onVeto: (seatId: string, playIndex: number) => void;
  onActAsSeat: (seatId: string | null) => void;
  onMove: (seatId: string, locationId: string) => void;
  /** Open the Generate Panel to resolve (GM clicks "Resolve in panel"). */
  onResolveOpen: () => void;
  /** Minimise — close the window; the game keeps running on the branch. */
  onMinimise: () => void;
  /** True once the play clock has elapsed — cards lock in, no more edits. */
  playLocked: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const round = room.round;
  const phase = round?.phase ?? "";
  const generating = !!round?.generating;
  const resolving = phase === "resolve";
  // The GM can cancel any round-machine generation it's waiting on (perspectives,
  // seeding, agents deciding, conflict read) or a stalled background agent
  // decision (thinkingSeats). The RESOLVE continuation is owned by the Generate
  // Panel, so it's excluded here.
  const thinkingActive = (round?.thinkingSeats?.length ?? 0) > 0;
  const canCancel = (generating && !resolving) || thinkingActive;
  const activeSeat = round?.activeSeat ? room.seats[round.activeSeat] : null;
  const seatName = (id?: string | null) =>
    id ? perspectiveName(narrative.perspectives?.[room.seats[id]?.perspectiveId], narrative) : "";

  const advance = async () => {
    setBusy(true);
    try {
      await onAdvance();
    } finally {
      setBusy(false);
    }
  };

  // ── Impersonating a seat → the player interface ─────────────────────────────
  if (actAsSeatId && round) {
    const seat = room.seats[actAsSeatId];
    const yourTurn =
      round.phase === "play" &&
      !playLocked &&
      (room.economy.playOrder === "simultaneous" || round.activeSeat === actAsSeatId || seat.driver === "gm-proxy");
    // GM override: the operator can play for ANY seat (agent or member) during
    // PLAY, even past the clock. Phase is still enforced — only cards in PLAY.
    const gmOverride = round.phase === "play" && (playLocked || (!yourTurn && seat.driver !== "gm-proxy"));
    const canPlayHand = yourTurn || gmOverride;
    const isCharacter = narrative.perspectives?.[seat?.perspectiveId ?? ""]?.kind === "character";
    const locations = Object.values(narrative.locations ?? {});
    return (
      <div className="shrink-0 border-t border-border bg-bg-base/70 px-4 py-3">
        <div className="mx-auto w-full max-w-4xl">
        <div className="mb-2 flex items-center gap-3 text-sm">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-text-dim/55">acting as</span>
            <span className="text-[15px] font-semibold text-text-primary">{seatName(actAsSeatId)}</span>
          </span>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-accent">{seat?.conviction.toFixed(0)}cv</span>
          {/* Move = a signal of intended position (unrestricted; characters only).
              Re-scopes whisper and rides into the resolve merge. Opens the
              hierarchical/search location picker (same pattern as Generate
              advanced settings). */}
          {isCharacter && locations.length > 0 && (
            <button
              onClick={() => setMoveOpen(true)}
              title="Move — signals where this character intends to go"
              className="flex items-center gap-1 rounded-md border border-border-subtle bg-bg-field/60 px-2 py-1 text-xs text-text-dim/80 hover:text-text-primary"
            >
              <span>📍 {narrative.locations[seat.locationId]?.name ?? "move"}</span>
              {seat.movedThisRound && <span className="text-accent">· moving ▸</span>}
            </button>
          )}
          {moveOpen && (
            <Modal onClose={() => setMoveOpen(false)} size="sm">
              <ModalHeader onClose={() => setMoveOpen(false)}>Move {seatName(actAsSeatId)}</ModalHeader>
              <div className="p-3">
                <p className="mb-2 text-[11px] text-text-dim/70">
                  Where does {seatName(actAsSeatId)} intend to go? Movement is a signal — it re-scopes whispers
                  and tells the continuation where to place this character.
                </p>
                <LocationPicker
                  locations={narrative.locations}
                  urlFor={() => null}
                  value={seat.locationId}
                  onChange={(id) => {
                    if (id) onMove(actAsSeatId, id);
                    setMoveOpen(false);
                  }}
                />
              </div>
            </Modal>
          )}
          {round.phase === "write" && (
            <span
              className="flex items-center gap-1 text-xs text-text-dim/55"
              title="Cards are dealt — they become playable once the play window opens"
            >
              🔒 cards lock until play
            </span>
          )}
          {round.phase === "play" &&
            (playLocked ? (
              <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-300" title="Clock elapsed — the GM can still play on a seat's behalf">
                Time up — GM override
              </span>
            ) : yourTurn ? (
              <span className="rounded-full bg-accent/20 px-2.5 py-1 text-xs font-medium text-accent">Your move</span>
            ) : gmOverride ? (
              <span className="rounded-full bg-violet-500/20 px-2.5 py-1 text-xs font-medium text-violet-300">GM playing for {seatName(actAsSeatId)}</span>
            ) : (
              <span className="text-xs text-text-dim/70">Waiting — it’s {seatName(round.activeSeat)}’s turn</span>
            ))}
          {/* Sequential play — the seat can COMMIT its turn and pass early, before
              the clock runs out (simultaneous has no per-seat turn, so it's hidden;
              there the GM closes the whole window). */}
          {round.phase === "play" && room.economy.playOrder !== "simultaneous" && yourTurn && (
            <button
              onClick={advance}
              disabled={busy}
              title="Commit your turn and pass to the next seat — you don't have to wait for the clock"
              className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white transition hover:bg-accent/90 disabled:opacity-40"
            >
              {busy ? "…" : "End my turn ▸"}
            </button>
          )}
          <button onClick={() => onActAsSeat(null)} className="ml-auto text-xs text-text-dim hover:text-text-primary">
            step out to GM view
          </button>
        </div>
        {/* Cards appear from WRITE onward — never in READ. In WRITE they're
            shown but not yet playable (canPlayHand is false until PLAY). */}
        {round.phase !== "read" && (
          <SeatHand
            hand={round.hands[actAsSeatId] ?? { seatId: actAsSeatId, cards: [], played: [] }}
            streamsById={narrative.streams ?? {}}
            balance={seat?.conviction ?? 0}
            economy={room.economy}
            canPlay={canPlayHand}
            onPlay={(cardId, conviction, faceUp) => onPlay(actAsSeatId, cardId, conviction, faceUp)}
            onVeto={(i) => onVeto(actAsSeatId, i)}
          />
        )}
        </div>
      </div>
    );
  }

  // ── GM control deck ─────────────────────────────────────────────────────────
  return (
    <div className="flex shrink-0 justify-center border-t border-border bg-bg-base px-4 py-3.5">
      <div className="flex w-full max-w-5xl items-center gap-3">
      <span className="shrink-0 rounded-md bg-white/5 px-2 py-1 text-[11px] font-semibold uppercase tracking-widest text-text-dim/70">GM</span>

      {/* Primary action — the one-click round progression. Fixed width so the
          label swapping (Generating… / Advance / Resolve) never jolts the row. */}
      <button
        type="button"
        disabled={busy || room.paused || generating}
        onClick={resolving ? onResolveOpen : advance}
        className="flex h-11 min-w-56 shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-white shadow-sm shadow-accent/30 transition hover:bg-accent/90 disabled:opacity-40"
      >
        {generating ? "Generating…" : resolving ? "Resolve in panel" : busy ? "Working…" : NEXT_LABEL[phase] ?? "Advance"} ▸
      </button>
      {/* Cancel — pull the plug on a stalled generation. Clears the generating /
          thinking flags so the phase unblocks; the GM re-clicks Advance to retry. */}
      {canCancel && (
        <button
          type="button"
          onClick={onCancelGeneration}
          title="Cancel the in-flight generation (e.g. if it has stalled). The round stays put — click Advance to retry."
          className="flex h-11 shrink-0 items-center rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 text-sm font-medium text-rose-300 transition hover:bg-rose-500/20"
        >
          Cancel
        </button>
      )}
      <button
        type="button"
        onClick={() => onPause(!room.paused)}
        title={room.paused ? "Resume the round" : "Pause — freeze the clock; the branch stays locked"}
        className="flex h-11 shrink-0 items-center rounded-lg border border-white/12 bg-white/5 px-4 text-sm font-medium text-text-secondary transition hover:bg-white/10 hover:text-text-primary"
      >
        {room.paused ? "Resume" : "Pause"}
      </button>

      {/* Whose-turn callout — the operator's orientation */}
      <div className="ml-1 flex min-w-0 flex-1 items-center gap-2 text-xs">
        {phase === "play" && room.economy.playOrder === "simultaneous" ? (
          <span className="text-text-dim/75">
            Round {(round?.index ?? 0) + 1} · Play — all seats commit simultaneously; Advance to close the window
          </span>
        ) : phase === "play" && activeSeat ? (
          <>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: activeSeat.color }} />
            <span className="truncate text-text-secondary">
              It’s <span className="font-medium text-text-primary">{seatName(round?.activeSeat)}</span>’s turn
            </span>
            {activeSeat.driver === "agent" ? (
              <span className="text-[11px] text-text-dim/60">— agent; Advance to auto-play</span>
            ) : (
              <button
                onClick={() => onActAsSeat(activeSeat.id)}
                className="rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/25"
              >
                play for them ▸
              </button>
            )}
          </>
        ) : room.paused ? (
          <span className="text-amber-400/80">Paused — branch still locked. Resume to continue.</span>
        ) : (
          <span className="text-text-dim/75">
            Round {(round?.index ?? 0) + 1} · {PHASE_VERB[phase] ?? ""}
          </span>
        )}
      </div>

      {/* Session controls — separated from the round actions by a divider so the
          GM never confuses "advance the round" with "leave / end the game". */}
      <div className="flex shrink-0 items-center gap-2 border-l border-white/10 pl-3">
        <button
          onClick={onMinimise}
          title="Minimise — return to the main UI; the game keeps running on this branch"
          className="flex h-11 items-center rounded-lg border border-white/12 bg-white/5 px-3.5 text-sm font-medium text-text-secondary transition hover:bg-white/10 hover:text-text-primary"
        >
          Minimise
        </button>
        <button
          onClick={onEnd}
          title="End game — finish this game and unlock the branch"
          className="flex h-11 items-center rounded-lg border border-white/12 bg-white/5 px-3.5 text-sm font-medium text-text-secondary transition hover:bg-white/10 hover:text-text-primary"
        >
          End game
        </button>
        <button
          onClick={onClear}
          title="Abandon — discard this game entirely (no economy carryover)"
          className="flex h-11 items-center rounded-lg border border-rose-500/40 px-3.5 text-sm font-medium text-rose-400 transition hover:bg-rose-500/10"
        >
          Abandon
        </button>
      </div>
      </div>
    </div>
  );
}
