/** Conviction LIVE — the PRESENCE ROSTER. Who's at the table and whether they've
 *  readied (accepted). The round can't start, and can't advance to the next,
 *  until every human member shows green. Rendered on both the player shell and the
 *  GM's banner so everyone sees the same "waiting on X" picture, and the player
 *  carries their own ready toggle. Agents are AI — present by default, never listed
 *  here (they don't gate the round). */
"use client";
import { perspectiveName } from "@/components/stage/RoomUI";
import { isHumanControlled, seatPresence } from "@/lib/game/engine";
import type { GameRoom, NarrativeState } from "@/types/narrative";

/** The human-controlled seats the presence gate waits on — Member seats AND any
 *  agent seat a player has TAKEN OVER (online). Unclaimed agents (AI-driven) and
 *  gm-proxy / spectators don't gate, so they're not listed. */
export function gatingMembers(room: GameRoom) {
  return Object.values(room.seats).filter((s) => s.status !== "spectating" && isHumanControlled(s));
}

/** Status → dot colour + chip styling + label. red = offline (hasn't opened the
 *  game) · orange = online but not ready · green = ready. */
const PRESENCE_STYLE = {
  offline: { dot: "bg-rose-500", chip: "border-rose-500/30 bg-rose-500/10 text-rose-200", label: "offline" },
  waiting: { dot: "bg-amber-400 animate-pulse", chip: "border-amber-500/25 bg-amber-500/5 text-amber-100/80", label: "not ready" },
  ready: { dot: "bg-emerald-400", chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200", label: "ready" },
  ai: { dot: "bg-violet-400", chip: "border-violet-500/30 bg-violet-500/10 text-violet-200", label: "AI" },
} as const;

export function PresenceRoster({
  room,
  narrative,
  meSeatId,
  onToggleReady,
}: {
  room: GameRoom;
  narrative: NarrativeState;
  /** When set, renders this seat's own ready toggle on the right. */
  meSeatId?: string;
  onToggleReady?: (ready: boolean) => void;
}) {
  const members = gatingMembers(room);
  if (members.length === 0) return null;
  const waiting = members.filter((s) => seatPresence(s) !== "ready");
  const allReady = waiting.length === 0;
  const meReady = meSeatId ? !!room.seats[meSeatId]?.ready : false;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`text-[10px] font-semibold uppercase tracking-wider ${allReady ? "text-emerald-300/80" : "text-amber-300/80"}`}>
        {allReady ? "Everyone's in" : `Waiting on ${waiting.length} of ${members.length}`}
      </span>
      {members.map((s) => {
        const name = perspectiveName(narrative.perspectives?.[s.perspectiveId], narrative);
        const isMe = s.id === meSeatId;
        const st = PRESENCE_STYLE[seatPresence(s)];
        return (
          <span
            key={s.id}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${st.chip}`}
            title={`${name} — ${st.label}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
            <span className="max-w-36 truncate">{name}{isMe ? " (you)" : ""}</span>
            {/* A player piloting an AI seat still reads as an agent (they can leave
                and the AI takes back over) — a subtle violet tag marks it. */}
            {s.driver === "agent" && (
              <span className="shrink-0 rounded bg-violet-500/80 px-1 text-[7px] font-bold leading-3 text-white" title="AI seat — piloted by a player">
                AI
              </span>
            )}
          </span>
        );
      })}
      {meSeatId && onToggleReady && (
        <button
          onClick={() => onToggleReady(!meReady)}
          className={`ml-auto shrink-0 rounded-lg px-3 py-1 text-[12px] font-semibold transition ${
            meReady
              ? "border border-white/12 text-text-secondary hover:bg-white/5"
              : "bg-amber-400 text-black hover:bg-amber-300"
          }`}
        >
          {meReady ? "Step away" : "I’m ready ▸"}
        </button>
      )}
    </div>
  );
}
