/** GameShell — the live Conviction workspace, built to mirror the main narrative
 *  shell (AppShell): a left rail of seats, the poker board at centre, a right
 *  inspector rail + panel, and a bottom dock. The board is the one big
 *  distinction; everything else echoes the narrative UI so the two experiences
 *  feel like one app. The GM operates from the bottom deck and can act-as any
 *  seat (left rail / board / panel) to play for it — so a game runs solo for
 *  testing. Whose-turn is shown three ways: the board ring, the left-rail ring,
 *  and the bottom callout. Plan §8 / MERMAID §8. */
"use client";
import { useEffect, useRef, useState } from "react";

import { AddPlayersModal } from "@/components/game/AddPlayersModal";
import { GameBottomPanel } from "@/components/game/GameBottomPanel";
import { ChatPanel, GameWritePanel, LogPanel, PerspectivesPanel } from "@/components/game/GameSidePanels";
import { MergesView } from "@/components/stage/MergesView";
import { PokerTable } from "@/components/game/PokerTable";
import { Showdown } from "@/components/game/Showdown";
import { GeneratePanel } from "@/components/generation/GeneratePanel";
import { Avatar, perspectiveName } from "@/components/stage/RoomUI";
import { IconChat, IconCompass, IconDice, IconEye, IconList, IconMerge, IconPencil, IconPlus } from "@/components/icons";
import { useConviction } from "@/hooks/useConviction";
import { mentionedSeatIds, type SeatHandle } from "@/lib/game/mentions";
import { useStore } from "@/lib/state/store";
import type { GameRoom, NarrativeState } from "@/types/narrative";

type GameTab = "board" | "perspective" | "write" | "chat" | "history" | "log";

// Automatic-mode dwell for a reveal/untimed phase — the "watch it land" beat
// shared by the SHOWDOWN, SCORING, and untimed READ/WRITE/PLAY auto-advances.
const AUTO_BEAT_MS = 4500;

const TABS: { key: GameTab; icon: React.ReactNode; label: string; gmOnly?: boolean }[] = [
  { key: "board", icon: <IconCompass size={13} />, label: "Board" },
  // The three play phases the round walks a seat through: Read (Perspective) →
  // Write → Play (Board). The active tab auto-advances with the phase.
  { key: "perspective", icon: <IconEye size={13} />, label: "Perspective" },
  { key: "write", icon: <IconPencil size={13} />, label: "Write" },
  { key: "chat", icon: <IconChat size={13} />, label: "Chat" },
  // GM-only — full record, hidden when impersonating a player.
  { key: "history", icon: <IconMerge size={13} />, label: "History" },
  { key: "log", icon: <IconList size={13} />, label: "Log", gmOnly: true },
];

// The player loop walks three gates — READ the perspective → WRITE (open streams
// + priors) → PLAY (commit cards) — then SHOWDOWN (reveal) + RESOLVE (the GM
// generates). Generation runs off-clock between them.
const PHASE_STEPS: { label: string; phases: string[] }[] = [
  { label: "Read", phases: ["read"] },
  { label: "Write", phases: ["write"] },
  { label: "Play", phases: ["play"] },
  { label: "Resolve", phases: ["showdown", "resolve", "settle", "scoring"] },
];
const PHASE_LABEL: Record<string, string> = {
  read: "Read — the perspective",
  write: "Write — open streams & add priors",
  play: "Play — commit cards",
  showdown: "Showdown — reveal all cards",
  resolve: "Resolve — GM generates the continuation",
  settle: "Resolve",
  scoring: "Scoring — Impact revealed",
};

/** Always-visible phase + timer strip (sits above the bottom dock, on every tab)
 *  so the table never loses track of where the round is or how long is left. The
 *  GM can grant more time on the live clock (e.g. to let players keep writing). */
function PhaseBar({ room, now, canControl, onAddTime }: { room: GameRoom; now: number; canControl: boolean; onAddTime: (s: number) => void }) {
  const round = room.round;
  if (!round) return null;
  const activeStep = PHASE_STEPS.findIndex((s) => s.phases.includes(round.phase));
  // The live clock follows the open window: READ, WRITE, and PLAY each carry
  // their own anchored timer. All run off-clock-safe (anchored only after the
  // facilitating generation finished).
  const anchor: { ms: number; startedAt?: number } =
    round.phase === "read"
      ? { ms: round.timers?.read ?? 0, startedAt: round.readStartedAt }
      : round.phase === "write"
        ? { ms: round.timers?.write ?? 0, startedAt: round.writeStartedAt }
        : round.phase === "play"
          ? { ms: round.timers?.play ?? 0, startedAt: round.playStartedAt }
          : { ms: 0 };
  const windowMs = anchor.ms;
  const startedAt = anchor.startedAt;
  const timed = windowMs > 0 && startedAt != null && !round.generating;
  const remaining = timed ? Math.max(0, startedAt! + windowMs - now) : 0;
  const low = remaining <= 10_000;
  const mm = Math.floor(remaining / 60_000);
  const ss = Math.floor((remaining % 60_000) / 1000);
  return (
    <div className="flex shrink-0 justify-center border-t border-white/8 bg-bg-base/60 px-4 py-1.5">
      <div className="flex w-full max-w-4xl items-center gap-3">
        <span className="text-[10px] uppercase tracking-wider text-text-dim/60">Round {(round.index ?? 0) + 1}</span>
        <div className="flex items-center gap-1.5">
          {PHASE_STEPS.map((s, i) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span
                className={`text-[10px] font-medium ${
                  i === activeStep ? "text-accent" : i < activeStep ? "text-text-dim/60" : "text-text-dim/30"
                }`}
              >
                {s.label}
              </span>
              {i < PHASE_STEPS.length - 1 && (
                <span className={`h-px w-3 ${i < activeStep ? "bg-white/25" : "bg-white/10"}`} />
              )}
            </div>
          ))}
        </div>
        <span className="truncate text-[11px] text-text-secondary">
          {round.generating ? `${round.generatingLabel ?? "Generating"}…` : PHASE_LABEL[round.phase] ?? round.phase}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {room.paused && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-text-dim">paused</span>
          )}
          {timed && !room.paused && (
            <span className={`font-mono text-[12px] tabular-nums ${low ? "text-rose-400" : "text-text-dim/80"}`}>
              ⏱ {mm}:{String(ss).padStart(2, "0")}
            </span>
          )}
          {/* GM grants more time so players can keep deciding / writing. */}
          {canControl && timed && (
            <div className="flex items-center gap-1">
              {[30, 60].map((s) => (
                <button
                  key={s}
                  onClick={() => onAddTime(s)}
                  title={`Give players ${s} more seconds`}
                  className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] font-medium text-text-dim transition hover:bg-white/10 hover:text-text-primary"
                >
                  +{s >= 60 ? "1m" : `${s}s`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function GameShell({ room, onMinimise }: { room: GameRoom; onMinimise: () => void }) {
  const { state } = useStore();
  const narrative = state.activeNarrative as NarrativeState;
  const {
    actAsSeatId, advance, pendingMerge, completeResolve, setResolveGenerating, playCard, vetoPlay, setContestedOutcome,
    editGroupRealism, rerunShowdownRealism, actAsSeat, move,
    openNewStream, pause, extendClock, endGame, clearGame, sendChat, addSeats,
  } = useConviction();
  const [tab, setTab] = useState<GameTab>("board");
  const [addPlayersOpen, setAddPlayersOpen] = useState(false);
  // Per-seat "chat seen up to" (session-only) — drives the @-mention badge.
  const [chatSeen, setChatSeen] = useState<Record<string, number>>({});
  // Tracks the last auto-applied play-step (per seat) so the tab auto-advances
  // exactly once per Read → Write → Play step change.
  const [autoKey, setAutoKey] = useState<string | null>(null);
  const [resolvePanelOpen, setResolvePanelOpen] = useState(false);
  const resolving = room.round?.phase === "resolve";

  // Resolve-panel visibility sync (during-render — the React-blessed pattern this
  // file already uses for `autoKey`, not a setState-in-effect). Two rules:
  //   · Leaving RESOLVE closes the panel, so it never bleeds into the next round.
  //   · Automatic approval OPENS it once per round (ref-guarded) instead of
  //     generating silently — the panel then auto-runs its own generation, so a
  //     light-touch GM watches the continuation's reasoning stream hands-free.
  const [autoResolveOpenedKey, setAutoResolveOpenedKey] = useState<string | null>(null);
  if (!resolving && resolvePanelOpen) {
    setResolvePanelOpen(false);
  } else if (resolving && room.autoResolve && !room.paused) {
    const key = `${room.id}:${room.round?.index}`;
    if (autoResolveOpenedKey !== key) {
      setAutoResolveOpenedKey(key);
      setResolvePanelOpen(true);
    }
  }

  // Auto-advance the SHOWDOWN watch into resolution when the GM opted into full
  // auto (a brief beat to watch the reveal, then on). Manual rooms wait for the
  // GM's "Continue" on the board. Once per round (guarded by ref).
  const showdownAdvancedRef = useRef<string | null>(null);
  const showingDown = room.round?.phase === "showdown";
  useEffect(() => {
    if (!showingDown || !room.autoResolve || room.paused) return;
    const key = `${room.id}:${room.round?.index}`;
    if (showdownAdvancedRef.current === key) return;
    showdownAdvancedRef.current = key;
    const id = setTimeout(() => void advance(), AUTO_BEAT_MS);
    return () => clearTimeout(id);
  }, [showingDown, room.autoResolve, room.paused, room.id, room.round?.index, advance]);

  // Auto-advance the SCORING reveal into the next round in full-auto rooms — a
  // beat to watch the Impact land, then on. Manual rooms wait for the GM's "next
  // round" on the deck. Once per round (guarded by ref).
  const scoringAdvancedRef = useRef<string | null>(null);
  const scoring = room.round?.phase === "scoring";
  useEffect(() => {
    if (!scoring || !room.autoResolve || room.paused) return;
    const key = `${room.id}:${room.round?.index}`;
    if (scoringAdvancedRef.current === key) return;
    scoringAdvancedRef.current = key;
    const id = setTimeout(() => void advance(), AUTO_BEAT_MS);
    return () => clearTimeout(id);
  }, [scoring, room.autoResolve, room.paused, room.id, room.round?.index, advance]);

  // 1s clock so the play timer can lock plays + writes when it elapses (kept in
  // state so render stays pure — no Date.now() in the render body).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const playMs = room.round?.timers?.play ?? 0;
  const playLocked =
    room.round?.phase === "play" &&
    playMs > 0 &&
    !room.paused &&
    room.round.playStartedAt != null &&
    now - room.round.playStartedAt > playMs;
  // The WRITE window has its own clock, anchored to when the deal generation
  // finished. Once it elapses, new streams + priors lock — all writes must land
  // before PLAY opens.
  const writeMs = room.round?.timers?.write ?? 0;
  const writeLocked =
    room.round?.phase === "write" &&
    writeMs > 0 &&
    !room.paused &&
    room.round.writeStartedAt != null &&
    now - room.round.writeStartedAt > writeMs;

  // ── Automatic approval — the hands-free pilot ───────────────────────────────
  // In Automatic mode the table runs itself: each timed phase advances the moment
  // its clock runs out, with no GM approval in between. The SHOWDOWN / RESOLVE /
  // SCORING beats are driven by the dedicated effects above; this drives the three
  // human-facing windows — READ (deliver perspectives on entry, then leave when
  // the read clock lapses), WRITE (leave when the write clock lapses), and PLAY
  // (leave when the play clock lapses, walking past any seat still on the clock).
  // An untimed phase falls back to a short beat so the loop never stalls; pause or
  // End game still halts everything (the pilot gates on `paused`). Each transition
  // fires exactly once (ref-keyed by round + phase + sub-step).
  const auto = !!room.autoResolve && !room.paused;
  const elapsed = (startedAt: number | undefined, windowMs: number) =>
    startedAt != null && now - startedAt > (windowMs > 0 ? windowMs : AUTO_BEAT_MS);
  const readMs = room.round?.timers?.read ?? 0;
  const readElapsed = auto && room.round?.phase === "read" && elapsed(room.round.readStartedAt, readMs);
  const writeElapsed = auto && room.round?.phase === "write" && elapsed(room.round.writeStartedAt, writeMs);
  const playElapsed = auto && room.round?.phase === "play" && elapsed(room.round.playStartedAt, playMs);
  const pilotRef = useRef<string | null>(null);
  const pPhase = room.round?.phase;
  const pIndex = room.round?.index;
  const pGenerating = room.round?.generating;
  const pReadStarted = room.round?.readStartedAt;
  const pActive = room.round?.activeSeat;
  useEffect(() => {
    if (!auto || !pPhase || pGenerating) return;
    let subKey: string | null = null;
    if (pPhase === "read") subKey = pReadStarted == null ? "deliver" : readElapsed ? "leave" : null;
    else if (pPhase === "write") subKey = writeElapsed ? "leave" : null;
    else if (pPhase === "play") subKey = playElapsed ? `leave:${pActive ?? "x"}` : null;
    if (!subKey) return;
    const key = `${room.id}:${pIndex}:${pPhase}:${subKey}`;
    if (pilotRef.current === key) return;
    pilotRef.current = key;
    void advance();
  }, [auto, room.id, pPhase, pIndex, pGenerating, pReadStarted, pActive, readElapsed, writeElapsed, playElapsed, advance]);

  // GM-only tabs collapse when impersonating a player; fall back to the board.
  const isGM = actAsSeatId === null;
  const visibleTabs = TABS.filter((t) => !t.gmOnly || isGM);
  // SHOWDOWN pulls EVERYONE to the board to watch the reveal (no tab freedom).
  const inShowdown = room.round?.phase === "showdown";
  const activeTab = inShowdown ? "board" : visibleTabs.some((t) => t.key === tab) ? tab : "board";

  const round = room.round;
  const seats = Object.values(room.seats);

  // Auto-advance the tab through the round's three player phases so a seat's turn
  // walks the player through the loop:
  //   Start → (Perspective Gen) → READ (Perspective tab) → WRITE (Write tab) →
  //   (Stream & Intuition Gen) → PLAY (Board) → (Arc Gen) → next turn.
  const playStep: "read" | "write" | "play" | null =
    round?.phase === "read" ? "read" : round?.phase === "write" ? "write" : round?.phase === "play" ? "play" : null;
  const stepTab: GameTab | null =
    playStep === "read" ? "perspective" : playStep === "write" ? "write" : playStep === "play" ? "board" : null;
  // One auto-switch per (seat × step) change, only while acting as a seat — leaves
  // manual navigation free within a step. (Adjusting state during render is the
  // React-blessed pattern for syncing to a changing input — not a setState-in-effect.)
  const wantKey = actAsSeatId && stepTab ? `${actAsSeatId}:${playStep}` : null;
  if (wantKey !== autoKey) {
    setAutoKey(wantKey);
    if (wantKey && stepTab) setTab(stepTab);
  }

  // @-mention notifications for the acting seat: unseen messages (not self) that
  // tag it, in a conversation it can see (global, or its own current-round place).
  const chatHandles: SeatHandle[] = seats.map((s) => ({
    seatId: s.id,
    name: perspectiveName(narrative.perspectives?.[s.perspectiveId], narrative),
  }));
  const myLoc = actAsSeatId ? room.seats[actAsSeatId]?.locationId : undefined;
  const roundIndex = round?.index ?? -1;
  // Forced to 0 while the Chat tab is open (you're reading it); otherwise the
  // count of unseen, non-self mentions of the acting seat in a visible channel.
  const chatMentions =
    !actAsSeatId || activeTab === "chat"
      ? 0
      : room.chat.filter((m) => {
          if (m.seatId === actAsSeatId || m.at <= (chatSeen[actAsSeatId] ?? 0)) return false;
          const visible =
            m.scope === "global" || (m.scope === "location" && m.locationId === myLoc && m.roundIndex === roundIndex);
          return visible && mentionedSeatIds(m.text, chatHandles).has(actAsSeatId);
        }).length;

  // Mark chat seen for the acting seat whenever entering OR leaving the Chat tab
  // (an event handler — not a setState-in-effect), so newly-arrived mentions
  // count only after you've stepped away.
  const selectTab = (key: GameTab) => {
    if (inShowdown) return; // tabs are frozen on the board during the reveal
    if ((key === "chat" || activeTab === "chat") && actAsSeatId) {
      setChatSeen((prev) => ({ ...prev, [actAsSeatId]: Date.now() }));
    }
    setTab(key);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-base">
      <div className="flex min-h-0 flex-1">
        {/* LEFT RAIL — seats (the roster + whose-turn + act-as) */}
        <div className="flex w-14 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-white/8 bg-bg-base/60 py-2 backdrop-blur-sm">
          <button
            onClick={() => actAsSeat(null)}
            title="Game Master view"
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
              actAsSeatId === null ? "bg-white/10 text-text-primary ring-1 ring-white/20" : "text-text-dim hover:bg-white/5 hover:text-text-primary"
            }`}
          >
            <IconDice size={16} />
          </button>
          <div className="h-px w-7 bg-white/8" />
          {seats.map((seat) => {
            const isActive = round?.activeSeat === seat.id;
            const isActing = actAsSeatId === seat.id;
            const pending = seat.status === "pending";
            const thinking = round?.phase === "play" && !!round?.thinkingSeats?.includes(seat.id);
            const name = perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative);
            return (
              <button
                key={seat.id}
                onClick={() => actAsSeat(isActing ? null : seat.id)}
                title={`${name}${pending ? " · joins next round" : thinking ? " · thinking…" : isActive ? " · to act" : ""}`}
                className={`relative rounded-lg p-0.5 transition ${
                  thinking ? "ring-2 ring-violet-400/70" : isActing ? "ring-2 ring-accent" : isActive ? "ring-2 ring-accent/60" : "ring-1 ring-white/8 hover:ring-white/25"
                } ${pending ? "opacity-50" : ""}`}
              >
                <Avatar label={name} ai={seat.driver === "agent"} size={32} />
                {thinking ? (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-violet-400 shadow-[0_0_6px] shadow-violet-400" />
                ) : (
                  isActive && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_6px] shadow-accent" />
                )}
                {pending && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-bg-base"
                    title="Joins next round"
                  />
                )}
              </button>
            );
          })}
          {/* GM-only — add players to the live game; they join next round. */}
          {isGM && (
            <button
              onClick={() => setAddPlayersOpen(true)}
              title="Add players — join next round"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-text-dim ring-1 ring-dashed ring-white/15 transition hover:bg-white/5 hover:text-text-primary hover:ring-white/30"
            >
              <IconPlus size={15} />
            </button>
          )}
        </div>

        {/* MAIN — a full-width Chrome-style tab strip (minus the player rail) with
            the Board as the default tab; alternate views render full-width and
            centred for a minimalist read. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-3">
            {visibleTabs.map((t) => {
              const on = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => selectTab(t.key)}
                  className={`relative flex shrink-0 items-center gap-1.5 px-2.5 py-2.5 text-[11px] font-medium transition ${
                    on ? "text-text-primary" : "text-text-dim/70 hover:text-text-secondary"
                  }`}
                >
                  {t.icon}
                  {t.label}
                  {t.key === "chat" && chatMentions > 0 && (
                    <span
                      className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-black"
                      title={`${chatMentions} new mention${chatMentions === 1 ? "" : "s"}`}
                    >
                      {chatMentions}
                    </span>
                  )}
                  {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
                </button>
              );
            })}
            {/* Viewing-as — makes the perspective filter explicit. */}
            <span className="ml-auto shrink-0 pl-3 text-[10px] text-text-dim/60">
              {actAsSeatId ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: room.seats[actAsSeatId]?.color }} />
                  viewing as {perspectiveName(narrative.perspectives?.[room.seats[actAsSeatId]?.perspectiveId], narrative)}
                </span>
              ) : (
                <span className="uppercase tracking-wider text-text-dim/50">GM · full view</span>
              )}
            </span>
          </div>
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            {inShowdown ? (
              // The reveal takes the board: every committed card shown, conflicts
              // resolved together, in prep for the GM's generate (resolve) call.
              <Showdown
                room={room}
                narrative={narrative}
                onContinue={advance}
                canContinue={isGM}
                onSetOutcome={isGM ? setContestedOutcome : undefined}
                onEditRealism={isGM ? editGroupRealism : undefined}
                onRerunRealism={isGM ? rerunShowdownRealism : undefined}
              />
            ) : activeTab === "board" ? (
              <PokerTable room={room} narrative={narrative} actAsSeatId={actAsSeatId} onActAsSeat={actAsSeat} />
            ) : activeTab === "chat" ? (
              // Full-height messenger — its own internal scroll + pinned composer.
              <div className="mx-auto h-full w-full max-w-2xl">
                <ChatPanel room={room} narrative={narrative} actAsSeatId={actAsSeatId} onSend={sendChat} />
              </div>
            ) : activeTab === "write" ? (
              <GameWritePanel
                room={room}
                narrative={narrative}
                actAsSeatId={actAsSeatId}
                locked={!!writeLocked}
                onOpenStream={openNewStream}
              />
            ) : activeTab === "history" ? (
              <MergesView branchId={room.branchId} />
            ) : activeTab === "perspective" ? (
              // The panel owns its own reading width (max-w-3xl) for legibility.
              <PerspectivesPanel room={room} narrative={narrative} actAsSeatId={actAsSeatId} scope="both" />
            ) : (
              <div className="mx-auto w-full max-w-2xl">
                {activeTab === "log" && <LogPanel room={room} />}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Always-visible phase + timer — every tab, so the table never loses the round. */}
      <PhaseBar room={room} now={now} canControl={isGM} onAddTime={extendClock} />

      {/* BOTTOM DOCK — GM deck or the impersonated seat's hand */}
      <GameBottomPanel
        room={room}
        narrative={narrative}
        actAsSeatId={actAsSeatId}
        onAdvance={advance}
        onPause={pause}
        onEnd={() => endGame()}
        onClear={() => { clearGame(); onMinimise(); }}
        onPlay={playCard}
        onVeto={vetoPlay}
        onActAsSeat={actAsSeat}
        onMove={move}
        onResolveOpen={() => setResolvePanelOpen(true)}
        onMinimise={onMinimise}
        playLocked={!!playLocked}
      />

      {/* RESOLVE — the real Generate Panel, pre-loaded with the merge built from
          the players' card resolutions. In GM (manual) approval the GM clicks
          "Resolve in panel" to open it and runs generation by hand; in Automatic
          approval the effect above opens it and it auto-runs (autoGenerate). Either
          way, on a real generation the game settles + scores + opens the next round. */}
      {resolving && resolvePanelOpen && (
        <GeneratePanel
          proposedMerge={pendingMerge ?? undefined}
          // Automatic approval fires generation on its own once the merge loads, so
          // the GM watches the reasoning stream without clicking Generate.
          autoGenerate={!!room.autoResolve}
          // Progress the round ONLY when an arc was actually generated. Closing
          // the panel without generating just dismisses it — the round stays in
          // RESOLVE so the GM can reopen and generate.
          onGenerated={completeResolve}
          // Just dismiss — never reset `generating` here: the panel can't be closed
          // mid-generation, and on success `completeResolve` has already moved the
          // round to SCORING, so touching `generating` would clobber that transition.
          onClose={() => setResolvePanelOpen(false)}
          // Surface generation on the board for players while the GM drives the panel.
          onLoadingChange={setResolveGenerating}
        />
      )}

      {/* Add players mid-game — same seat-setup metaphor as the original setup;
          confirmed seats join `pending` and enter play when the next round opens. */}
      {addPlayersOpen && (
        <AddPlayersModal
          room={room}
          onAdd={(configs) => addSeats(configs)}
          onClose={() => setAddPlayersOpen(false)}
        />
      )}
    </div>
  );
}
