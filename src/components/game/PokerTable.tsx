/** The Board — Conviction's centre surface (plan §8, MERMAID §8). Just the felt:
 *  a contained, railed table with seat pods around the rim and a centre dealer
 *  pedestal (phase stepper · Fate odometer · switchable narration). Chat, the
 *  ranking, the hand and GM controls live in the GameShell rails/panels around
 *  it, mirroring the main narrative workspace. One metaphor (a poker table),
 *  skinned by the app theme; signature touches: luminous conviction stacks, a
 *  human/agent tell, the Fate odometer, and a clear whose-turn ring. */
"use client";
import { useEffect, useRef, useState } from "react";

import { FateOdometer } from "@/components/game/FateOdometer";
import { Avatar, perspectiveName } from "@/components/stage/RoomUI";
import { IconShare } from "@/components/icons";
import { convictionCeiling } from "@/lib/game/economy";
import { isHumanControlled, seatPresence, unreadyHumanSeats } from "@/lib/game/engine";
import type { GameRoom, NarrativeState, PlayedCard, RoundPhase, Seat, Stream } from "@/types/narrative";

/** 1 → "1st", 3 → "3rd", 10 → "10th". English ordinal suffix. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

const PHASE_LABEL: Record<string, string> = {
  read: "Read — the perspective",
  write: "Write — open streams & add priors",
  play: "Play — commit cards",
  showdown: "Showdown — reveal all cards",
  resolve: "Resolve — GM generates the continuation",
  settle: "Resolve",
  scoring: "Scoring — Impact revealed",
};

/** Phase countdown — informational pacing for GM + players (timers are GM-set
 *  per phase; absent/0 = untimed and the clock hides). Presentational: it counts
 *  down from the phase budget and freezes on pause; it never auto-advances in
 *  computer mode (the GM drives). */
/** Deadline-based round clock — counts down to `endsAt` (epoch ms). The round
 *  clock is anchored to when PLAY actually started (after perspectives are
 *  delivered), so it never runs during the off-clock delivery. Freezes on pause. */
function PhaseTimer({ endsAt, paused }: { endsAt: number; paused: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused]);
  const remaining = Math.max(0, endsAt - now);
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  const low = remaining <= 10000;
  return (
    <span
      className={`font-mono text-[11px] tabular-nums ${low ? "text-rose-400" : "text-text-dim/70"}`}
      title="Round clock — starts once play opens"
    >
      ⏱ {mm}:{String(ss).padStart(2, "0")}
    </span>
  );
}

// What the AI is producing while a phase shows `generating` — a small detail so
// the table knows WHAT is being computed, not just that something is.
const GEN_LABEL: Record<string, string> = {
  read: "Delivering perspectives",
  write: "Seeding streams & dealing",
  play: "Reading the table",
  showdown: "Reading the table",
  resolve: "Writing the continuation",
};

/** AI generation counter — counts UP from mount (mount = generation start, since
 *  it only renders while `generating`). Frames the wait as the AI's, NOT a player
 *  deadline: there's no player clock during generation. */
function GeneratingCounter({ label }: { label: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 250);
    return () => clearInterval(id);
  }, []);
  const s = Math.floor(elapsed / 1000);
  return (
    <span
      className="flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-accent"
      title="The AI is generating — players are NOT on a clock during this"
    >
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
      {label}
      <span className="font-mono tabular-nums text-accent/80">
        {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
      </span>
    </span>
  );
}

// The player loop — Read → Write → Play — then Resolve folds showdown + the
// merge/generate/settle/score.
const STEPS: { label: string; phases: RoundPhase[] }[] = [
  { label: "Read", phases: ["read"] },
  { label: "Write", phases: ["write"] },
  { label: "Play", phases: ["play"] },
  { label: "Resolve", phases: ["showdown", "resolve", "settle", "scoring"] },
];

function PhaseStepper({ phase }: { phase: RoundPhase }) {
  const active = STEPS.findIndex((s) => s.phases.includes(phase));
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((s, i) => (
        <div key={s.label} className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full transition ${
              i === active ? "bg-accent shadow-[0_0_8px] shadow-accent" : i < active ? "bg-white/40" : "bg-white/12"
            }`}
            title={s.label}
          />
          {i < STEPS.length - 1 && <span className={`h-px w-3 ${i < active ? "bg-white/30" : "bg-white/10"}`} />}
        </div>
      ))}
    </div>
  );
}

/** Conviction rendered as a POKER CHIP STACK — a column of chips in the seat's
 *  colour whose height scales with the balance (closer to a real table read than
 *  a meter). Dashed edge = the classic chip rim. */
function ConvictionStack({ value, ceiling, color }: { value: number; ceiling: number; color?: string }) {
  const hue = color ?? "var(--color-accent)";
  const chips = Math.max(1, Math.min(7, Math.round((value / ceiling) * 7)));
  return (
    <div className="flex items-end gap-1.5" title={`${value.toFixed(0)} conviction`}>
      <div className="relative" style={{ width: 16, height: 18 }}>
        {Array.from({ length: chips }).map((_, i) => (
          <span
            key={i}
            className="absolute left-0 rounded-full border border-dashed"
            style={{
              width: 16,
              height: 6,
              bottom: i * 2.2,
              background: `radial-gradient(circle at 50% 35%, color-mix(in oklab, ${hue} 80%, white 12%), ${hue})`,
              borderColor: "rgba(255,255,255,0.45)",
              boxShadow: "0 1px 1px rgba(0,0,0,0.5)",
            }}
          />
        ))}
      </div>
      <span className="font-mono text-[11px] leading-none tabular-nums text-text-secondary">{value.toFixed(0)}</span>
    </div>
  );
}

/** Hover tooltip for a played card — the readable detail the cramped felt card
 *  can't show. A concealed opponent card is NEVER leaked: its tooltip withholds
 *  the action until the showdown reveal. Pointer-events-none so it never blocks. */
function CardTooltip({ play, stream, concealed }: { play: PlayedCard; stream?: Stream; concealed: boolean }) {
  const question = stream?.title;
  const action = stream?.outcomes?.[play.card.outcome] ?? `action ${play.card.outcome}`;
  const dot = concealed ? "#a78bfa" : "var(--color-accent)";
  const status = concealed ? "face-down" : play.forcedReveal ? "forced open" : "open";
  return (
    <div className="pointer-events-none absolute top-full left-1/2 z-40 mt-2 hidden -translate-x-1/2 group-hover/card:block">
      {/* arrow points UP at the card (tooltip drops from below) */}
      <div className="flex justify-center">
        <div className="-mb-1.5 h-2.5 w-2.5 rotate-45 border-l border-t border-border bg-bg-elevated" />
      </div>
      <div className="max-w-sm w-52 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-left shadow-xl">
        <div className="mb-1 flex items-start gap-2">
          <span
            className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: dot, boxShadow: `0 0 6px color-mix(in oklab, ${dot} 50%, transparent)` }}
          />
          <div>
            {question && <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-dim">{question}</span>}
            <span className="whitespace-normal wrap-break-word text-xs font-semibold text-text-primary">
              {concealed ? "Concealed — revealed at showdown" : action}
            </span>
          </div>
        </div>
        <div className="text-[10px] text-text-secondary">
          <span className="font-mono tabular-nums text-accent">{play.conviction}</span> conviction · {status}
        </div>
      </div>
    </div>
  );
}

/** A card a seat has played, shown on the felt. Concealed cards read as a
 *  face-down back (🂠) until the showdown reveal; open cards show the action.
 *  Hovering surfaces a richer tooltip (full action / question / status). */
function MiniPlayedCard({ play, stream }: { play: PlayedCard; stream?: Stream }) {
  const concealed = !play.faceUp && !play.revealed;
  const action = stream?.outcomes?.[play.card.outcome] ?? `action ${play.card.outcome}`;
  return (
    <div className="group/card relative">
      <CardTooltip play={play} stream={stream} concealed={concealed} />
      {concealed ? (
        // Face-down — the themed violet back.
        <div className="flex h-12 w-9 cursor-default flex-col items-center justify-between rounded-md border border-violet-400/50 bg-linear-to-br from-violet-600/45 to-violet-950/65 p-1 shadow-md">
          <span className="text-[13px] leading-none text-violet-200">🂠</span>
          <span className="font-mono text-[10px] tabular-nums text-violet-100">{play.conviction}</span>
        </div>
      ) : (
        // Face-up — the printed white card-stock, action in dark ink.
        <div
          className={`flex h-12 w-9 cursor-default flex-col justify-between rounded-md border bg-linear-to-b from-[#ffffff] to-[#e8eaf2] p-1 shadow-md ${
            play.forcedReveal ? "border-rose-400/60" : "border-zinc-300"
          }`}
        >
          <span className="text-[7px] leading-[1.15] text-zinc-700 line-clamp-3">{action}</span>
          <span className="self-end font-mono text-[11px] font-semibold leading-none tabular-nums text-violet-600">{play.conviction}</span>
        </div>
      )}
    </div>
  );
}

function SeatPod({
  seat,
  narrative,
  rank,
  isActive,
  isActing,
  playing,
  ceiling,
  plays,
  streamsById,
  revealImpact = false,
  thinking = false,
  isNext = false,
  onClick,
}: {
  seat: Seat;
  narrative: NarrativeState;
  /** 1-based Fate-Metric rank among seats. */
  rank: number;
  isActive: boolean;
  isActing: boolean;
  /** The seat that acts NEXT after the active one (sequential play) — "on deck". */
  isNext?: boolean;
  /** Simultaneous play — this seat is still to commit, so its outline glows in
   *  its own colour (no single turn marker applies in this mode). */
  playing: boolean;
  ceiling: number;
  /** Cards this seat has committed this round — shown on the felt. */
  plays: PlayedCard[];
  streamsById: Record<string, Stream>;
  /** SCORING reveal — flash this seat's last-round Impact delta above the pod. */
  revealImpact?: boolean;
  /** This agent's move is being generated right now — pulse a "thinking" tell. */
  thinking?: boolean;
  onClick: () => void;
}) {
  const persp = narrative.perspectives?.[seat.perspectiveId];
  // The badge reflects the seat's TYPE (an agent seat stays "AI" even while a player
  // pilots it — they're only playing it temporarily, and leaving hands it back to
  // the AI). The presence DOT reflects who's live: shown whenever a human controls
  // the seat (a Member, or an agent a player has taken over). So a piloted agent
  // reads as "AI seat, human on it" — distinct from a Member's PLAYER badge.
  const isAgentSeat = seat.driver === "agent";
  const humanControlled = isHumanControlled(seat);
  const pilotedAgent = isAgentSeat && humanControlled; // a player is flying this AI seat
  const name = perspectiveName(persp, narrative);
  const leader = rank === 1;
  // A seat added mid-game waits out the current round — muted, with a "joins
  // next round" tell. It has no hand/turn until the next round opens.
  const pending = seat.status === "pending";
  return (
    <button type="button" onClick={onClick} className={`group flex w-32 flex-col items-center gap-1.5 ${pending ? "opacity-55" : ""}`}>
      <div className="relative">
        <div
          className={`rounded-full transition ${
            isActing ? "ring-2 ring-accent" : isActive ? "ring-2 ring-accent ring-offset-2 ring-offset-transparent" : isNext ? "ring-1 ring-accent/40 ring-dashed" : "group-hover:ring-1 group-hover:ring-white/25"
          }`}
          style={playing && !isActing && !isActive ? { boxShadow: `0 0 0 2px ${seat.color}, 0 0 14px ${seat.color}66` } : undefined}
        >
          <Avatar label={name} ai={isAgentSeat} size={44} />
        </div>
        {/* PRESENCE TELL — a human-controlled seat (a Member, or an agent a player
            has TAKEN OVER) carries a status dot: green = ready, orange = online but
            not ready, red = offline. An unclaimed agent is AI — no presence dot. */}
        {humanControlled && (() => {
          const p = seatPresence(seat);
          const dot = p === "ready" ? "bg-emerald-400" : p === "waiting" ? "bg-amber-400" : "bg-rose-500";
          return (
            <span
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-bg-base ${dot} ${p === "waiting" ? "animate-pulse" : ""}`}
              title={p === "ready" ? "Ready — online" : p === "waiting" ? "Online — not ready" : "Offline"}
            />
          );
        })()}
        {pending && (
          <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-amber-400/90 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-black shadow ring-2 ring-bg-base">
            next round
          </span>
        )}
        {/* Fate-Metric rank — leader gets the gold seat. */}
        <span
          className={`absolute -left-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums shadow ring-2 ring-bg-base ${
            leader ? "bg-amber-400 text-black" : "bg-bg-elevated text-text-secondary"
          }`}
          title={`${ordinal(rank)} · Fate moved`}
        >
          {ordinal(rank)}
        </span>
        {/* Agent deliberating — pulses over the pod while its move generates
            (takes the slot from "to act": this is the seat we're waiting on). */}
        {thinking ? (
          <span className="absolute -top-1.5 left-1/2 flex -translate-x-1/2 -translate-y-full items-center gap-1 whitespace-nowrap rounded-full bg-violet-500/90 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white shadow ring-2 ring-bg-base">
            <span className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-white [animation-delay:-0.3s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-white [animation-delay:-0.15s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-white" />
            </span>
            thinking
          </span>
        ) : (
          isActive && (
            <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-accent px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white shadow ring-2 ring-bg-base">
              to act
            </span>
          )
        )}
        {/* SCORING reveal — the Impact this seat just earned, flashed above the pod. */}
        {revealImpact && seat.lastImpact != null && (
          <span
            className={`absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full animate-[pulse_1.4s_ease-in-out] whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums shadow ring-2 ring-bg-base ${
              seat.lastImpact >= 0 ? "bg-accent text-white" : "bg-rose-500 text-white"
            }`}
            title={seat.lastImpactReason}
          >
            {seat.lastImpact >= 0 ? "+" : ""}{seat.lastImpact.toFixed(2)} Impact
          </span>
        )}
      </div>
      <span className="flex max-w-28 items-center gap-1 truncate text-[11px] font-medium text-text-primary">
        {isAgentSeat ? (
          // AI seat — keeps its violet badge even while piloted; the emerald ring +
          // "·YOU"-style dot is the subtle "a human is flying this AI" tell.
          <span
            className={`shrink-0 rounded bg-violet-500/90 px-1 text-[7px] font-bold leading-3 text-white ${pilotedAgent ? "ring-1 ring-emerald-400/80" : ""}`}
            title={pilotedAgent ? "AI seat — piloted by a player" : "AI player"}
          >
            {pilotedAgent ? "AI·LIVE" : "AI"}
          </span>
        ) : humanControlled ? (
          <span className="shrink-0 rounded bg-sky-500/90 px-1 text-[7px] font-bold leading-3 text-white">PLAYER</span>
        ) : (
          <span className="shrink-0 rounded bg-white/20 px-1 text-[7px] font-bold leading-3 text-white">GM</span>
        )}
        <span className="truncate">{name}</span>
      </span>
      <ConvictionStack value={seat.conviction} ceiling={ceiling} color={seat.color} />
      {/* Fate scoring lives in the Rankings tab now — the pod shows only the rank
          badge; the number + trajectory belong to the data-viz screen. */}
      {/* Cards this seat has played, laid on the felt in front of the pod. */}
      {plays.length > 0 && (
        <div className="flex items-end justify-center gap-1 pt-0.5">
          {plays.map((p, i) => (
            <MiniPlayedCard key={`${p.card.id}-${i}`} play={p} stream={streamsById[p.card.streamId]} />
          ))}
        </div>
      )}
    </button>
  );
}

export function PokerTable({
  room,
  narrative,
  actAsSeatId,
  onActAsSeat,
  isGM = false,
  blocked = false,
  onInvite,
}: {
  room: GameRoom;
  narrative: NarrativeState;
  actAsSeatId: string | null;
  onActAsSeat: (seatId: string | null) => void;
  /** GM view — gets the invite action on the presence gate. */
  isGM?: boolean;
  /** The table can't advance until human seats are ready — show the centre gate. */
  blocked?: boolean;
  /** Open the share / invite (link + QR) flow. */
  onInvite?: () => void;
}) {
  const round = room.round;
  const seats = Object.values(room.seats);
  const ceiling = convictionCeiling(room.economy);
  // Simultaneous play has no single turn — instead glow the outline of every
  // seat still to commit, so the table reads who we're waiting on at a glance.
  const simultaneousPlay = round?.phase === "play" && room.economy.playOrder === "simultaneous";
  // Sequential play has an order — number the pods by their place in the queue and
  // mark who's on deck, so the whole turn order reads effortlessly. (Simultaneous
  // is a free-for-all: no order, anything's up for grabs, so no numbers.)
  const sequentialPlay = round?.phase === "play" && room.economy.playOrder !== "simultaneous";
  const turnOrder = round?.turnOrder ?? [];
  const activeOrderIdx = round?.activeSeat ? turnOrder.indexOf(round.activeSeat) : -1;
  const nextSeatId = sequentialPlay && activeOrderIdx >= 0 ? turnOrder[(activeOrderIdx + 1) % turnOrder.length] : undefined;
  const totalFate = seats.reduce((s, x) => s + x.fateImpact, 0);
  const lastEventText = room.log?.[room.log.length - 1]?.text ?? "";

  // Presence gate — the seats we're still waiting on (offline / not readied). When
  // blocked, the centre offers the one unblocking action: invite (GM goes live;
  // a player just forwards the already-minted links).
  const waitingOn = blocked ? unreadyHumanSeats(room) : [];
  const canInvite = !!onInvite && (isGM || room.live);

  // Fate-Metric rank per seat (1 = most Fate moved), shown on each pod.
  const rankBySeat = new Map<string, number>();
  [...seats]
    .sort((a, b) => b.fateImpact - a.fateImpact)
    .forEach((s, i) => rankBySeat.set(s.id, i + 1));

  // Measure the container so we can constrain the table to fit in both
  // dimensions. When the bottom panel is tall (play mode), the available height
  // shrinks; without this the table is clipped by the overflow-hidden rail.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerDims, setContainerDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ASPECT = 1.7;
  const PAD = 64; // p-8 = 32px × 2
  const MAX_W = 1040;
  const tableWidth = containerDims
    ? Math.min(MAX_W, containerDims.w - PAD, (containerDims.h - PAD) * ASPECT)
    : undefined;

  return (
    <div ref={containerRef} className="relative flex h-full items-center justify-center overflow-hidden p-8">
      <div className="relative" style={{ width: tableWidth ?? '100%', aspectRatio: String(ASPECT), maxWidth: MAX_W }}>
        {/* Rail */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "radial-gradient(ellipse at center, #161c2b 0%, #0a0e18 100%)",
            boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        />
        {/* Felt */}
        <div
          className="absolute rounded-full"
          style={{
            inset: "14px",
            background:
              "radial-gradient(ellipse at 50% 42%, color-mix(in oklab, var(--color-accent) 14%, #0c1322) 0%, #070b13 72%)",
            boxShadow: "inset 0 0 90px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.04)",
          }}
        />
        <div className="absolute rounded-full border border-white/5" style={{ inset: "12%" }} />

        {/* Generating — a prominent spinning halo ringing the centre pedestal,
            so the table reads as "working" at a glance. Pointer-events-none and
            masked to a thin arc-ring (the pedestal content stays legible inside). */}
        {round?.generating && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div
              className="aspect-square w-[min(56%,30rem)] animate-spin rounded-full"
              style={{
                animationDuration: "1.3s",
                background:
                  "conic-gradient(from 0deg, transparent 0%, transparent 55%, color-mix(in oklab, var(--color-accent) 70%, transparent) 88%, var(--color-accent) 100%)",
                WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 7px))",
                mask: "radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 7px))",
                filter: "drop-shadow(0 0 10px color-mix(in oklab, var(--color-accent) 45%, transparent))",
              }}
            />
          </div>
        )}

        {/* Centre dealer pedestal — phase + timer + the Fate Metric, nothing
            else (narration lives in the Public / Private tabs). */}
        <div className="absolute left-1/2 top-1/2 flex w-[min(48%,26rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4">
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-[9px] font-semibold uppercase tracking-[0.32em] text-text-dim/50">
              Round {(round?.index ?? 0) + 1}
            </span>
            <span className="max-w-88 text-[11px] uppercase leading-snug tracking-[0.2em] text-text-secondary">
              {PHASE_LABEL[round?.phase ?? ""] ?? round?.phase}
            </span>
          </div>
          {round && <PhaseStepper phase={round.phase} />}

          {/* Presence gate — the table is frozen until players ready up. A quiet
              line in the natural pedestal stack + the one unblocking action
              (invite): the GM goes live, a player just forwards the links. */}
          {blocked && (
            <div className="flex items-center gap-2.5">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-200/90">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                Waiting for {waitingOn.length || "all"} {waitingOn.length === 1 ? "player" : "players"}
              </span>
              {canInvite && (
                <button
                  onClick={() => onInvite?.()}
                  className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-[11px] font-medium text-text-secondary transition hover:border-white/30 hover:text-text-primary"
                  title={isGM ? "Go live and share a link / QR per seat" : "Share the invite links with players"}
                >
                  <IconShare size={12} />
                  {isGM ? "Invite" : "Share"}
                </button>
              )}
            </div>
          )}

          {/* Whose turn — stated by NAME, clear on the felt. Sequential names the
              one seat up; simultaneous tells the table everyone is acting at once. */}
          {round?.phase === "play" && (
            sequentialPlay && round.activeSeat && room.seats[round.activeSeat] ? (
              <div className="flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: room.seats[round.activeSeat].color, boxShadow: `0 0 8px ${room.seats[round.activeSeat].color}` }}
                />
                <span className="text-[13px] font-semibold text-text-primary">
                  {perspectiveName(narrative.perspectives?.[room.seats[round.activeSeat].perspectiveId], narrative)}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-accent/80">to play</span>
              </div>
            ) : simultaneousPlay ? (
              <div className="rounded-full border border-white/12 bg-white/5 px-3 py-1 text-[11px] font-medium text-text-secondary">
                All seats playing — commit at once
              </div>
            ) : null
          )}

          <FateOdometer value={totalFate} />

          {/* Timer / generating counter + pot — a single quiet status line. */}
          <div className="flex items-center gap-3 text-[10px] text-text-dim/60">
            {round?.generating ? (
              <GeneratingCounter key={round.generatingLabel ?? round.phase} label={round.generatingLabel ?? GEN_LABEL[round.phase] ?? "AI working"} />
            ) : (
              // The round clock only runs once the facilitating generation has
              // finished: READ (anchored readStartedAt), WRITE (writeStartedAt),
              // and PLAY (playStartedAt) each get their own.
              ((round?.phase === "read" &&
                round.readStartedAt != null &&
                (round.timers?.read ?? 0) > 0 && (
                  <PhaseTimer endsAt={round.readStartedAt + (round.timers?.read ?? 0)} paused={room.paused} />
                )) ||
                (round?.phase === "write" &&
                  round.writeStartedAt != null &&
                  (round.timers?.write ?? 0) > 0 && (
                    <PhaseTimer endsAt={round.writeStartedAt + (round.timers?.write ?? 0)} paused={room.paused} />
                  )) ||
                (round?.phase === "play" &&
                  // Sequential = per-move clock (turnStartedAt); simultaneous = shared window (playStartedAt).
                  (room.economy.playOrder !== "simultaneous" ? round.turnStartedAt : round.playStartedAt) != null &&
                  (round.timers?.play ?? 0) > 0 && (
                    <PhaseTimer
                      endsAt={(room.economy.playOrder !== "simultaneous" ? round.turnStartedAt! : round.playStartedAt!) + (round.timers?.play ?? 0)}
                      paused={room.paused}
                    />
                  )) ||
                (round?.phase === "scoring" &&
                  round.scoringStartedAt != null &&
                  (round.timers?.scoring ?? 0) > 0 && (
                    <PhaseTimer endsAt={round.scoringStartedAt + (round.timers?.scoring ?? 0)} paused={room.paused} />
                  )))
            )}
            {round?.pot ? (
              <span>
                pot <span className="font-mono tabular-nums text-text-secondary">{round.pot.toFixed(0)}</span>
              </span>
            ) : null}
          </div>

          {/* Off-clock generation — reassure the table the timer is paused while
              the continuation is written (no one is on the clock). */}
          {round?.generating && (
            <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim/40">the clock waits while the world takes shape</span>
          )}

          {/* Most recent event — a small, single-line ticker so the table always
              has a read on what just happened without opening the log. */}
          {lastEventText && (
            <span className="max-w-88 truncate text-[10px] text-text-dim/45" title={lastEventText}>
              {lastEventText}
            </span>
          )}
        </div>

        {/* Seat pods around the rim */}
        {seats.map((seat, i) => {
          const angle = (i / seats.length) * 2 * Math.PI;
          const x = 50 + 47 * Math.sin(angle);
          const y = 50 - 45 * Math.cos(angle);
          return (
            // Hovering a pod lifts it above sibling pods, so a played card's
            // drop-down tooltip clears neighbouring avatars instead of being
            // painted over by them (the pods are absolute siblings).
            <div key={seat.id} className="absolute -translate-x-1/2 -translate-y-1/2 hover:z-popover" style={{ left: `${x}%`, top: `${y}%` }}>
              <SeatPod
                seat={seat}
                narrative={narrative}
                rank={rankBySeat.get(seat.id) ?? 1}
                isActive={round?.activeSeat === seat.id}
                isActing={actAsSeatId === seat.id}
                playing={simultaneousPlay && (round?.hands[seat.id]?.played?.length ?? 0) === 0}
                ceiling={ceiling}
                plays={round?.hands[seat.id]?.played ?? []}
                streamsById={narrative.streams ?? {}}
                revealImpact={round?.phase === "scoring"}
                thinking={round?.phase === "play" && !!round?.thinkingSeats?.includes(seat.id)}
                isNext={seat.id === nextSeatId}
                onClick={() => onActAsSeat(actAsSeatId === seat.id ? null : seat.id)}
              />
            </div>
          );
        })}

        {/* Turn marker — a token on the felt in front of the seat whose turn it
            is, sitting between the pod and the centre. Only rendered in ordered
            play, where a single seat acts at a time; simultaneous play has no
            single turn, so it falls back to the pod outline glow below. */}
        {(() => {
          const actIdx = seats.findIndex((s) => s.id === round?.activeSeat);
          if (actIdx < 0) return null;
          const angle = (actIdx / seats.length) * 2 * Math.PI;
          const x = 50 + 33 * Math.sin(angle);
          const y = 50 - 32 * Math.cos(angle);
          return (
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 h-5 w-5 rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.6)] ring-2 ring-white/85"
              style={{ left: `${x}%`, top: `${y}%`, background: seats[actIdx].color }}
              title="Turn marker — it’s this seat’s turn"
            />
          );
        })()}
      </div>
    </div>
  );
}
