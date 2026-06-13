/** Conviction LIVE — the PLAYER SHELL. The GM's full table experience for a
 *  remote player: the same PokerTable board, the same hand, the read brief, the
 *  write surface, chat, and the rankings — driven by the seat-scoped projection
 *  and POSTing intents up. GM-only affordances are gone: no left rail, no GM deck,
 *  no veto, no act-as-other-seats, no history/log. The player is locked to their
 *  seat and can do every PLAYER action (read, write, play, chat, move). */
"use client";
import { useEffect, useState } from "react";

import { PokerTable } from "@/components/game/PokerTable";
import { RankingsView } from "@/components/game/RankingsView";
import { SeatHand } from "@/components/game/SeatHand";
import { Showdown } from "@/components/game/Showdown";
import { ChatPanel, GameWritePanel, PerspectivesPanel } from "@/components/game/GameSidePanels";
import { MergesView } from "@/components/stage/MergesView";
import { Avatar, perspectiveName } from "@/components/stage/RoomUI";
import { PresenceRoster, gatingMembers } from "@/components/game/PresenceBar";
import { IconChat, IconCompass, IconEye, IconMerge, IconPencil, IconScorecard } from "@/components/icons";
import type { Intent, SeatProjection } from "@/lib/game/live/protocol";

type Tab = "board" | "perspective" | "write" | "chat" | "rankings" | "history";
const TABS: { key: Tab; icon: React.ReactNode; label: string }[] = [
  { key: "board", icon: <IconCompass size={13} />, label: "Board" },
  { key: "perspective", icon: <IconEye size={13} />, label: "Read" },
  { key: "write", icon: <IconPencil size={13} />, label: "Write" },
  { key: "chat", icon: <IconChat size={13} />, label: "Chat" },
  { key: "history", icon: <IconMerge size={13} />, label: "History" },
  { key: "rankings", icon: <IconScorecard size={13} />, label: "Rankings" },
];

const PHASE_LABEL: Record<string, string> = {
  read: "Read — the perspective",
  write: "Write — open streams & add priors",
  play: "Play — commit cards",
  showdown: "Showdown",
  resolve: "Resolving",
  settle: "Resolving",
  scoring: "Scoring — Impact revealed",
};

/** Live countdown to a deadline (epoch ms); hides when untimed. */
function Clock({ endsAt }: { endsAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!endsAt) return null;
  const remaining = Math.max(0, endsAt - now);
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  return (
    <span className={`font-mono text-[12px] tabular-nums ${remaining <= 10000 ? "text-rose-400" : "text-text-dim/80"}`}>
      ⏱ {mm}:{String(ss).padStart(2, "0")}
    </span>
  );
}

export function PlayerShell({ projection, send }: { projection: SeatProjection; send: (i: Intent) => void }) {
  const { room, narrative, seatId } = projection;
  const [tab, setTab] = useState<Tab>("board");
  const round = room.round;
  const me = room.seats[seatId];
  const myName = perspectiveName(narrative.perspectives?.[me?.perspectiveId ?? ""], narrative);
  const seq = room.economy.playOrder !== "simultaneous";

  // Global table moments live on the BOARD — the showdown reveal, the GM's resolve
  // generation, and the scoring Impact reveal are all watched there, so they reach
  // every player at the same beat (perspective-framed by the projection). SHOWDOWN
  // additionally FREEZES the tabs (you can't wander off mid-reveal), mirroring the
  // GM. Read → the perspective; Write → the write surface; everything else → board.
  const inShowdown = round?.phase === "showdown";
  const watchPhase = round?.phase === "play" || round?.phase === "showdown" || round?.phase === "resolve" || round?.phase === "settle" || round?.phase === "scoring";
  const [autoKey, setAutoKey] = useState<string | null>(null);
  const stepTab: Tab | null =
    round?.phase === "read" ? "perspective" : round?.phase === "write" ? "write" : watchPhase ? "board" : null;
  const wantKey = stepTab ? `${round?.index}:${round?.phase}` : null;
  if (wantKey && wantKey !== autoKey) {
    setAutoKey(wantKey);
    if (stepTab) setTab(stepTab);
  }
  // Frozen to the board during the reveal (the GM is driving it).
  const activeTab: Tab = inShowdown ? "board" : tab;

  // Presence bar: shown whenever the table is waiting on anyone, OR a new round is
  // about to start (read phase, perspectives not yet delivered) — the moments the
  // gate bites. Once everyone's in and the round is rolling, it collapses.
  const members = gatingMembers(room);
  const someoneWaiting = members.some((s) => !s.ready);
  const preRound = round?.phase === "read" && round.readStartedAt == null;
  const showPresence = members.length > 0 && (someoneWaiting || preRound);

  const hand = round?.hands[seatId] ?? { seatId, cards: [], played: [] };
  const yourTurn =
    round?.phase === "play" && !room.paused && (room.economy.playOrder === "simultaneous" || round.activeSeat === seatId);

  // Play-clock deadline (mode-aware), for the phase bar.
  const playAnchor = seq ? round?.turnStartedAt : round?.playStartedAt;
  const endsAt =
    !round || room.paused || round.generating
      ? undefined
      : round.phase === "read" && round.readStartedAt && round.timers?.read
        ? round.readStartedAt + round.timers.read
        : round.phase === "write" && round.writeStartedAt && round.timers?.write
          ? round.writeStartedAt + round.timers.write
          : round.phase === "play" && playAnchor && round.timers?.play
            ? playAnchor + round.timers.play
            : undefined;

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-bg-base text-text-primary">
      {/* Top bar — YOUR identity (avatar + name, ringed in your seat colour) + tabs */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-bg-base/80 px-4 py-2">
        <div className="shrink-0 rounded-full p-0.5" style={{ boxShadow: `0 0 0 2px ${me?.color ?? "#888"}` }}>
          <Avatar label={myName} size={28} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-semibold leading-tight">{myName}</span>
            {/* Piloting an AI seat — you're flying an agent; leaving hands it back. */}
            {me?.driver === "agent" && (
              <span className="rounded bg-violet-500/80 px-1 py-px text-[8px] font-bold uppercase tracking-wider text-white" title="You're piloting an AI seat — leave and the agent resumes">
                Piloting AI
              </span>
            )}
            {/* Always-available presence toggle — readying gates the round; stepping
                away mid-round never stops the live round, only the NEXT one. */}
            <button
              onClick={() => send({ cmd: "ready", ready: !me?.ready })}
              title={me?.ready ? "You're ready — tap to step away" : "Tap to ready up"}
              className={`flex items-center gap-1 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider transition ${
                me?.ready
                  ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                  : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${me?.ready ? "bg-emerald-400" : "bg-amber-400"}`} />
              {me?.ready ? "Ready" : "Ready up"}
            </button>
          </div>
          <div className="text-[9px] uppercase tracking-wider text-text-dim/55">{narrative.title}</div>
        </div>
        <nav className="ml-4 flex items-center gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              disabled={inShowdown}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition disabled:opacity-30 ${
                activeTab === t.key ? "bg-white/10 text-text-primary" : "text-text-dim hover:bg-white/5 hover:text-text-secondary"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
        <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-accent">
          {me?.conviction.toFixed(0) ?? 0}cv
        </span>
      </header>

      {/* PRESENCE — who's at the table, who's accepted, and your own ready toggle.
          The round won't start (and won't roll to the next) until every member is
          green. Once everyone's in and the round is rolling, this collapses away;
          it returns the moment the table is waiting on someone again. Un-readying
          mid-round never stops the live round — it only gates the NEXT one. */}
      {showPresence && (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/6 px-4 py-2">
          <PresenceRoster room={room} narrative={narrative} meSeatId={seatId} onToggleReady={(r) => send({ cmd: "ready", ready: r })} />
        </div>
      )}

      {/* Main */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {inShowdown ? (
          // The reveal takes the board for everyone — read-only for players (the GM
          // drives Continue / outcome calls). Same component the GM watches.
          <div className="h-full overflow-y-auto">
            <Showdown room={room} narrative={narrative} onContinue={() => {}} canContinue={false} />
          </div>
        ) : activeTab === "board" ? (
          // The real board — locked to this seat (no act-as: onActAsSeat is a no-op).
          <PokerTable room={room} narrative={narrative} actAsSeatId={seatId} onActAsSeat={() => {}} />
        ) : activeTab === "perspective" ? (
          // The GM's Perspectives panel, 1:1 — scoped by the projection to this
          // seat's own private read + the public account (no other player's lens).
          <PerspectivesPanel room={room} narrative={narrative} actAsSeatId={seatId} scope="both" />
        ) : activeTab === "write" ? (
          // The GM's exact Write panel, in player mode — add-prior + open-stream
          // route to the master as intents; store-only affordances are suppressed.
          <GameWritePanel
            room={room}
            narrative={narrative}
            actAsSeatId={seatId}
            locked={round?.phase !== "write"}
            onOpenStream={(_sid, q, intu) => send({ cmd: "openStream", question: q, intuition: intu })}
            onAddPrior={(_sid, streamId, text) => send({ cmd: "addPrior", streamId, text })}
          />
        ) : activeTab === "chat" ? (
          // The GM's exact chat — global + your own location; sends route as intents.
          <div className="mx-auto h-full w-full max-w-2xl">
            <ChatPanel
              room={room}
              narrative={narrative}
              actAsSeatId={seatId}
              onSend={(_sid, text, scope, locationId) => send({ cmd: "chat", text, scope, locationId })}
            />
          </div>
        ) : activeTab === "history" ? (
          // The merge ledger, 1:1 — read-only off the projected branch history.
          <MergesView
            branchId={room.branchId}
            narrative={narrative}
            resolvedEntryKeys={narrative.branches?.[room.branchId]?.entryIds ?? []}
            interactive={false}
          />
        ) : activeTab === "rankings" ? (
          <div className="h-full overflow-y-auto">
            <RankingsView room={room} narrative={narrative} />
          </div>
        ) : null}
      </main>

      {/* Phase + clock strip */}
      <div className="flex shrink-0 items-center gap-3 border-t border-white/8 bg-bg-base/60 px-4 py-1.5 text-[11px]">
        <span className="text-[10px] uppercase tracking-wider text-text-dim/60">Round {(round?.index ?? 0) + 1}</span>
        <span className="truncate text-text-secondary">
          {room.paused ? "Paused by the GM" : round?.generating ? `${round.generatingLabel ?? "Working"}…` : PHASE_LABEL[round?.phase ?? ""] ?? "Waiting"}
        </span>
        <span className="ml-auto">
          <Clock endsAt={endsAt} />
        </span>
      </div>

      {/* Bottom dock — your hand (the player's deck), play surface */}
      {round?.phase === "play" && (
        <div className="shrink-0 border-t border-border bg-bg-base/70 px-4 py-3">
          <div className="mx-auto w-full max-w-4xl">
            <div className="mb-2 flex items-center gap-2 text-[12px]">
              {yourTurn ? (
                <span className="rounded-full bg-accent/20 px-2.5 py-1 text-xs font-medium text-accent">Your move</span>
              ) : round.activeSeat ? (
                <span className="text-text-dim/70">
                  Waiting — it&rsquo;s {perspectiveName(narrative.perspectives?.[room.seats[round.activeSeat]?.perspectiveId ?? ""], narrative)}&rsquo;s turn
                </span>
              ) : (
                <span className="text-text-dim/70">Play is open</span>
              )}
              {yourTurn && seq && (
                <button
                  onClick={() => send({ cmd: "fold" })}
                  className="ml-auto rounded-lg border border-white/12 px-3 py-1 text-[12px] text-text-secondary hover:bg-white/5"
                >
                  Pass / end my turn ▸
                </button>
              )}
            </div>
            <SeatHand
              hand={hand}
              streamsById={narrative.streams ?? {}}
              balance={me?.conviction ?? 0}
              economy={room.economy}
              canPlay={!!yourTurn}
              onPlay={(cardId, conviction, faceUp) => send({ cmd: "play", cardId, conviction, faceUp })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
