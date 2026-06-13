/** RankingsView — the data-viz-first Rankings tab for a Conviction room. The pod
 *  badges show only place; the FULL Fate scoring lives here: who's moved the most
 *  Fate (the north star), how the standings evolved round-by-round, and — crucially
 *  — how much of each round's movement the world drove on its own (the Fate house
 *  band) versus the players. Three reads, top to bottom: the trajectory chart
 *  (scores together over time), the leaderboard (current standing + the house as a
 *  competitor), and the per-round influence bars (play vs outside force). Pure
 *  presentation off `room.scoreHistory` + the live cumulative snapshot. */
"use client";
import { Avatar, perspectiveName } from "@/components/stage/RoomUI";
import { fateScore } from "@/lib/game/scoring";
import type { GameRoom, NarrativeState, RoundScoreRecord, Seat } from "@/types/narrative";

/** The house band's reserved colour + a stable fallback palette for seats with no
 *  authored colour, so every line/row reads distinctly. */
const HOUSE_COLOR = "#94a3b8"; // slate — the world, not a player
const FALLBACK_COLORS = ["#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#fb7185", "#f472b6", "#22d3ee", "#a3e635"];

const colorOf = (seat: Seat, i: number): string => seat.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];

/** A ranked competitor row — a seat or the Fate house. */
interface Row {
  id: string;
  name: string;
  color: string;
  isHouse: boolean;
  isAgent: boolean;
  /** Raw cumulative Fate (source of truth). */
  impact: number;
  /** 0–100 saturating score (seats only; the house shows raw). */
  score: number;
  /** Last round's delta, if any. */
  last?: number;
}

export function RankingsView({ room, narrative }: { room: GameRoom; narrative: NarrativeState }) {
  const seats = Object.values(room.seats).filter((s) => s.status !== "pending");
  const history = room.scoreHistory ?? [];
  const houseImpact = room.fateHouseBand ?? 0;

  // Competitors = every seat + the Fate house, ranked by raw Fate moved.
  const seatRows: Row[] = seats.map((s, i) => ({
    id: s.id,
    name: perspectiveName(narrative.perspectives?.[s.perspectiveId], narrative),
    color: colorOf(s, i),
    isHouse: false,
    isAgent: s.driver === "agent",
    impact: s.fateImpact,
    score: fateScore(s.fateImpact),
    last: s.lastImpact,
  }));
  const rankedSeats = [...seatRows].sort((a, b) => b.impact - a.impact);
  const houseRow: Row = {
    id: "__house__",
    name: "Fate House",
    color: HOUSE_COLOR,
    isHouse: true,
    isAgent: false,
    impact: houseImpact,
    score: fateScore(houseImpact),
    last: history[history.length - 1]?.houseBand,
  };

  // Total movement = everything the play drove + everything the world did.
  const totalMovement = seatRows.reduce((a, r) => a + Math.max(0, r.impact), 0) + Math.max(0, houseImpact);
  const sharePct = (v: number) => (totalMovement > 0 ? (Math.max(0, v) / totalMovement) * 100 : 0);

  // Legacy fallback: a game whose rounds were scored BEFORE per-round history
  // existed has standings but no `scoreHistory`. Rather than a blank chart, plot
  // ONE synthetic point at the live cumulative so the trajectory shows the current
  // standing (rising from zero); real per-round history takes over from the next
  // scored round. The influence bars stay gated on real history (never synthetic).
  const hasImpact = seatRows.some((r) => r.impact > 1e-6) || houseImpact > 1e-6;
  const liveSnapshot: RoundScoreRecord = {
    roundIndex: room.round?.index ?? 0,
    perSeat: Object.fromEntries(seats.map((s) => [s.id, s.lastImpact ?? 0])),
    cumulative: Object.fromEntries(seats.map((s) => [s.id, s.fateImpact])),
    houseBand: houseImpact,
    houseCumulative: houseImpact,
    total: totalMovement,
  };
  const chartHistory = history.length > 0 ? history : hasImpact ? [liveSnapshot] : [];
  const synthetic = history.length === 0 && chartHistory.length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-5">
      {/* ── Header — the north-star totals at a glance ─────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-text-primary">Rankings</h2>
          <p className="text-[11px] text-text-dim/70">Fate moved — the north star. Who drove it, and how much the world drove itself.</p>
        </div>
        <div className="flex items-center gap-4">
          <Stat label="Fate moved" value={totalMovement.toFixed(1)} />
          <Stat label="Rounds" value={String(Math.max(history.length, room.round?.index ?? 0))} />
          <Stat label="House share" value={`${Math.round(sharePct(houseImpact))}%`} accent={HOUSE_COLOR} />
        </div>
      </div>

      {/* ── Trajectory — cumulative scores together over time ──────────────── */}
      <Section title="Trajectories" hint="Cumulative Fate per player over rounds — the house band tracks the world's own pull.">
        <TrajectoryChart rows={[...rankedSeats, houseRow]} history={chartHistory} />
        {synthetic && (
          <p className="mt-1 text-[10px] italic text-text-dim/45">
            Showing the current standing — earlier rounds in this game weren&apos;t recorded; round-by-round trajectories chart from the next scored round.
          </p>
        )}
        <Legend rows={[...rankedSeats, houseRow]} />
      </Section>

      {/* ── Leaderboard — current standing, the house as a competitor ──────── */}
      <Section title="Standing" hint="Ranked by raw Fate moved. The Fate House is the world's uncontrolled share — the field you're all playing against.">
        <div className="space-y-1.5">
          {rankedSeats.map((r, i) => (
            <LeaderRow key={r.id} row={r} place={i + 1} sharePct={sharePct(r.impact)} />
          ))}
          {/* The world as the final 'competitor' — outside force, set apart. */}
          <div className="pt-1.5">
            <LeaderRow row={houseRow} place={null} sharePct={sharePct(houseImpact)} />
          </div>
        </div>
      </Section>

      {/* ── Influence — play vs outside force, round by round ──────────────── */}
      {history.length > 0 && (
        <Section title="What drove each round" hint="Every round's movement split across the players and the Fate house — a wide house band means the world moved on its own.">
          <div className="space-y-2">
            {[...history].reverse().map((rec) => (
              <InfluenceBar key={rec.roundIndex} rec={rec} rankedSeats={rankedSeats} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Header stat ───────────────────────────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className="font-mono text-[18px] font-bold leading-none tabular-nums" style={{ color: accent ?? "var(--color-accent)" }}>
        {value}
      </span>
      <span className="text-[9px] uppercase tracking-wider text-text-dim/55">{label}</span>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/8 bg-white/2 p-4">
      <div className="mb-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary">{title}</h3>
        <p className="text-[10px] leading-snug text-text-dim/55">{hint}</p>
      </div>
      {children}
    </section>
  );
}

// ── Trajectory chart — cumulative Fate per competitor over rounds ─────────────
function TrajectoryChart({ rows, history }: { rows: Row[]; history: RoundScoreRecord[] }) {
  if (history.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-[11px] text-text-dim/50">
        Play a round to chart the standings.
      </div>
    );
  }
  const W = 720;
  const H = 240;
  const PAD = { l: 8, r: 8, t: 12, b: 18 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  // x: a leading 0-origin then one step per scored round, so lines rise from zero.
  const valueAt = (rec: RoundScoreRecord, r: Row): number =>
    r.isHouse ? rec.houseCumulative : rec.cumulative[r.id] ?? 0;
  const n = history.length + 1; // + origin
  const xAt = (i: number) => PAD.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);

  const yMax = Math.max(
    1e-6,
    ...history.map((rec) => Math.max(...rows.map((r) => valueAt(rec, r)))),
  );
  const yAt = (v: number) => PAD.t + (1 - v / (yMax * 1.08)) * plotH;

  const pathFor = (r: Row): string =>
    [0, ...history.map((rec) => valueAt(rec, r))]
      .map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`)
      .join(" ");

  return (
    <div className="h-56 w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full select-none">
        {/* baseline */}
        <line x1={PAD.l} x2={W - PAD.r} y1={yAt(0)} y2={yAt(0)} stroke="var(--color-text-dim)" strokeWidth={0.5} opacity={0.2} vectorEffect="non-scaling-stroke" />
        {rows.map((r) => (
          <path
            key={r.id}
            d={pathFor(r)}
            fill="none"
            stroke={r.color}
            strokeWidth={r.isHouse ? 1.5 : 2}
            strokeDasharray={r.isHouse ? "5 4" : undefined}
            opacity={r.isHouse ? 0.7 : 0.95}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* endpoint dots */}
        {rows.map((r) => {
          const v = valueAt(history[history.length - 1], r);
          return <circle key={r.id} cx={xAt(n - 1)} cy={yAt(v)} r={2.5} fill={r.color} opacity={r.isHouse ? 0.7 : 1} />;
        })}
      </svg>
    </div>
  );
}

// ── Legend — current value per competitor ─────────────────────────────────────
function Legend({ rows }: { rows: Row[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {rows.map((r) => (
        <span key={r.id} className="flex items-center gap-1.5 text-[10px] text-text-dim/70">
          <span
            className="inline-block h-2 w-2.5 rounded-sm"
            style={{ background: r.color, opacity: r.isHouse ? 0.7 : 1, outline: r.isHouse ? "1px dashed" : undefined }}
          />
          <span className={r.isHouse ? "italic" : "text-text-secondary"}>{r.name}</span>
          <span className="font-mono tabular-nums text-text-dim/55">{r.impact.toFixed(1)}</span>
        </span>
      ))}
    </div>
  );
}

// ── Leaderboard row ───────────────────────────────────────────────────────────
function LeaderRow({ row, place, sharePct }: { row: Row; place: number | null; sharePct: number }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
        row.isHouse ? "border-dashed border-white/12 bg-white/2" : "border-white/8 bg-white/3"
      }`}
    >
      {/* place / world glyph */}
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
          place === 1 ? "bg-amber-400 text-black" : place != null ? "bg-white/10 text-text-secondary" : "bg-transparent text-text-dim/60"
        }`}
      >
        {place ?? "✦"}
      </span>
      {!row.isHouse ? (
        <Avatar label={row.name} ai={row.isAgent} size={24} />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: `${HOUSE_COLOR}33` }}>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: HOUSE_COLOR }} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {row.isAgent && <span className="shrink-0 rounded bg-violet-500/90 px-1 text-[7px] font-bold leading-3 text-white">AI</span>}
          <span className={`truncate text-[12px] font-medium ${row.isHouse ? "italic text-text-secondary" : "text-text-primary"}`}>
            {row.name}
          </span>
          {row.isHouse && <span className="text-[9px] uppercase tracking-wider text-text-dim/45">outside force</span>}
        </div>
        {/* share bar */}
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full" style={{ width: `${sharePct}%`, background: row.color, opacity: row.isHouse ? 0.65 : 1 }} />
        </div>
      </div>
      {/* score + last delta */}
      <div className="flex shrink-0 flex-col items-end">
        <span className="font-mono text-[15px] font-bold leading-none tabular-nums" style={{ color: row.color }}>
          {row.isHouse ? row.impact.toFixed(1) : row.score}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-text-dim/50">
          {row.isHouse ? "raw Fate" : "Fate score"}
        </span>
      </div>
      {row.last != null && Math.abs(row.last) > 0.0049 && (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
            row.last >= 0 ? "bg-accent/15 text-accent" : "bg-rose-500/15 text-rose-300"
          }`}
          title="Last round's Impact"
        >
          {row.last >= 0 ? "+" : ""}
          {row.last.toFixed(1)}
        </span>
      )}
    </div>
  );
}

// ── Per-round influence — players vs the Fate house ───────────────────────────
function InfluenceBar({ rec, rankedSeats }: { rec: RoundScoreRecord; rankedSeats: Row[] }) {
  // Movement magnitude this round: |each seat's credit| + the house band. Width =
  // share of that magnitude, so a wide house segment reads as "the world moved it".
  const segs = rankedSeats
    .map((r) => ({ id: r.id, name: r.name, color: r.color, mag: Math.abs(rec.perSeat[r.id] ?? 0) }))
    .filter((s) => s.mag > 1e-6);
  const houseMag = Math.max(0, rec.houseBand);
  const denom = segs.reduce((a, s) => a + s.mag, 0) + houseMag || 1;
  const housePct = (houseMag / denom) * 100;

  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0 text-[10px] uppercase tracking-wider text-text-dim/55">R{rec.roundIndex + 1}</span>
      <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-white/5">
        {segs.map((s) => (
          <div key={s.id} title={`${s.name} · ${s.mag.toFixed(2)}`} style={{ width: `${(s.mag / denom) * 100}%`, background: s.color }} />
        ))}
        {houseMag > 1e-6 && (
          <div
            title={`Fate House · ${houseMag.toFixed(2)}`}
            style={{
              width: `${housePct}%`,
              backgroundImage: `repeating-linear-gradient(45deg, ${HOUSE_COLOR}, ${HOUSE_COLOR} 3px, transparent 3px, transparent 6px)`,
              backgroundColor: `${HOUSE_COLOR}55`,
            }}
          />
        )}
      </div>
      <span className="w-20 shrink-0 text-right text-[10px] tabular-nums text-text-dim/55" title="Share the world drove on its own">
        house {Math.round(housePct)}%
      </span>
    </div>
  );
}
