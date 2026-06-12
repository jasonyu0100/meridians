/** GameReport — the end-of-game debrief for the GM (CONCEPT.md: a per-game read
 *  of how everything went). Not just a leaderboard: the final standings on the
 *  Fate Metric, the table stats (rounds, streams, merges, continuations, talk),
 *  a per-seat read (Impact share, conviction left, commitments, goals), and a
 *  story recap from the public perspectives delivered across the game. Full
 *  information — it's the GM's record. */
"use client";
import { Avatar, perspectiveName } from "@/components/stage/RoomUI";
import { fateScore } from "@/lib/game/scoring";
import { streamsForBranch } from "@/lib/merges";
import type { GameRoom, NarrativeState, Seat } from "@/types/narrative";

const SECTION = "text-[10px] uppercase tracking-[0.18em] text-text-dim/70";
const CARD = "rounded-lg border border-white/10 bg-white/2";

/** A qualitative read on a seat's run from its share of the Fate moved. */
function impactRead(share: number, impact: number): string {
  if (impact <= 0.005) return "Passenger — never moved Fate";
  if (impact < 0) return "Worked against the grain";
  if (share >= 0.45) return "Dominant force — drove the world";
  if (share >= 0.22) return "Major driver";
  if (share >= 0.08) return "Contributor";
  return "Bit player";
}

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 px-3 py-2.5 ${CARD}`}>
      <span className="font-mono text-xl tabular-nums text-text-primary">{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-text-dim/70">{label}</span>
      {hint && <span className="text-[9px] text-text-dim/50">{hint}</span>}
    </div>
  );
}

export function GameReport({
  room,
  narrative,
  onClear,
  onClose,
}: {
  room: GameRoom;
  narrative: NarrativeState;
  onClear: () => void;
  onClose: () => void;
}) {
  const seats = [...Object.values(room.seats)].sort((a, b) => b.fateImpact - a.fateImpact);
  const totalImpact = seats.reduce((s, x) => s + x.fateImpact, 0);
  const rounds = (room.round?.index ?? 0) + 1;
  const winner = seats[0];

  const streams = streamsForBranch(narrative, room.branchId);
  const committed = streams.filter((s) => s.state !== "open").length;
  const merges = Object.values(narrative.merges ?? {}).filter((m) => m.branchId === room.branchId);
  const branchScenes = (narrative.branches[room.branchId]?.entryIds ?? [])
    .map((id) => narrative.scenes[id])
    .filter(Boolean);
  // Perspectives are arc-scoped — the public account is delivered per arc. Walk
  // the branch's scenes, collect distinct arcs in order, keep those delivered.
  const seenArcs = new Set<string>();
  const delivered = branchScenes
    .map((s) => s.arcId)
    .filter((arcId) => arcId && !seenArcs.has(arcId) && seenArcs.add(arcId))
    .map((arcId) => narrative.arcs[arcId])
    .filter((a) => a?.perspectives?.["public"]);
  const ownStreams = (seat: Seat) => streams.filter((s) => s.perspectiveId === seat.perspectiveId);
  const nameOf = (seat: Seat) => perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-7 px-8 py-10">
        {/* Header + winner */}
        <header className="flex flex-col items-center gap-3 text-center">
          <span className={SECTION}>Game report · {narrative.title}</span>
          <h2 className="bg-linear-to-r from-violet-300 via-fuchsia-200 to-rose-300 bg-clip-text text-2xl font-semibold text-transparent">
            {winner ? `${nameOf(winner)} drove the world` : "Game over"}
          </h2>
          {winner && (
            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
              <Avatar label={nameOf(winner)} ai={winner.driver === "agent"} size={28} />
              <span>
                topped the Fate Metric with a{" "}
                <span className="font-mono tabular-nums text-accent">Fate score of {fateScore(winner.fateImpact)}</span> over {rounds} round
                {rounds === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </header>

        {/* Table stats */}
        <section className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <StatTile label="Rounds" value={rounds} />
          <StatTile label="Fate moved" value={totalImpact.toFixed(2)} hint="sum of seat Impact" />
          <StatTile label="Continuations" value={delivered.length || merges.length} hint="scenes authored" />
          <StatTile label="Streams" value={`${committed}/${streams.length}`} hint="committed / opened" />
          <StatTile label="Table talk" value={room.chat.length} hint="messages" />
        </section>

        {/* Final standings */}
        <section className="flex flex-col gap-2.5">
          <div className={SECTION}>Final standings · Fate moved</div>
          <div className="flex flex-col gap-2">
            {seats.map((seat, i) => {
              const share = totalImpact > 0 ? seat.fateImpact / totalImpact : 0;
              return (
                <div key={seat.id} className={`flex flex-col gap-1.5 px-3 py-2.5 ${CARD}`}>
                  <div className="flex items-center gap-2.5">
                    <span className="w-4 text-center font-mono text-[12px] tabular-nums text-text-dim/60">{i + 1}</span>
                    <Avatar label={nameOf(seat)} ai={seat.driver === "agent"} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-medium text-text-primary">{nameOf(seat)}</span>
                        <span className="text-[9px] uppercase tracking-wider text-text-dim/50">
                          {seat.driver === "agent" ? "AI" : seat.driver === "human" ? "member" : "GM"}
                        </span>
                      </div>
                      <span className="text-[10px] text-text-dim/70">{impactRead(share, seat.fateImpact)}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="font-mono text-[13px] tabular-nums text-accent">{fateScore(seat.fateImpact)}</span>
                      <span className="text-[9px] text-text-dim/50">{(share * 100).toFixed(0)}% of Fate</span>
                    </div>
                  </div>
                  <div className="ml-6 h-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${fateScore(seat.fateImpact)}%`, background: seat.color }}
                    />
                  </div>
                  {/* per-seat detail */}
                  <div className="ml-6 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-text-dim/70">
                    <span>conviction left <span className="font-mono tabular-nums text-text-secondary">{seat.conviction.toFixed(0)}</span></span>
                    <span>
                      streams <span className="font-mono tabular-nums text-text-secondary">{ownStreams(seat).length}</span>
                    </span>
                    {seat.goals.length > 0 && (
                      <span>
                        goals{" "}
                        {seat.goals
                          .map((g) => {
                            const st = narrative.streams?.[g.threadId];
                            return st?.outcomes?.[g.targetOutcome] ?? "—";
                          })
                          .join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Story recap — the public account, round by round */}
        {delivered.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <div className={SECTION}>How it unfolded · public account</div>
            <div className="flex flex-col gap-2">
              {delivered.map((a, i) => (
                <div key={a.id} className={`px-3 py-2.5 ${CARD}`}>
                  <div className="mb-1 text-[9px] uppercase tracking-wider text-text-dim/50">{a.name || `Arc ${i + 1}`}</div>
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-text-secondary">
                    {a.perspectives?.["public"]?.text}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Actions */}
        <div className="flex items-center justify-center gap-2 pb-4">
          <button
            onClick={onClear}
            className="rounded-full border border-border-subtle px-4 py-1.5 text-[12px] text-text-secondary transition hover:bg-white/5"
          >
            Clear &amp; set up a new game
          </button>
          <button
            onClick={onClose}
            className="rounded-full bg-violet-500 px-5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-violet-400"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
