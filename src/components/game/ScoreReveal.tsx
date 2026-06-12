/** ScoreReveal — the scoring animation that plays after Arc Gen (CONCEPT.md
 *  §scoring), the sibling of the Showdown reveal but for PLAYER SCORES. It tells
 *  the whole round's scoring story, top to bottom: each thread shows how much Fate
 *  it moved, the AI's reasoning for how it landed, each seat's credit + one-line
 *  attribution, and — surfaced clearly — the slice the WORLD owned (the Fate house
 *  band, out of any player's control). Then the standings update with each seat's
 *  round delta + new total + rank. Reads purely off the assembled `RoundScoreReveal`
 *  (no recomputation here); the reveal staggers in like the Showdown flip. */
"use client";
import { useEffect, useState } from "react";

import type { RoundScoreReveal } from "@/lib/ai/game-scoring";

const fate = (x: number) => x.toFixed(2);
const signed = (x: number) => (x >= 0 ? `+${x.toFixed(2)}` : x.toFixed(2));
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** A horizontal bar splitting a thread's (or the round's) Fate into the players'
 *  share and the world's own (house band) — the band is the headline. */
function FateSplit({ totalFate, houseBand, revealed }: { totalFate: number; houseBand: number; revealed: boolean }) {
  const players = Math.max(0, totalFate - houseBand);
  const housePct = pct(houseBand, totalFate);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-black/40 ring-1 ring-inset ring-white/10">
        <div
          className="h-full bg-accent transition-all duration-700"
          style={{ width: revealed ? `${100 - housePct}%` : "0%" }}
          title={`players moved ${fate(players)}`}
        />
        <div
          className="h-full bg-amber-400/70 transition-all duration-700"
          style={{ width: revealed ? `${housePct}%` : "0%" }}
          title={`Fate (the world) moved ${fate(houseBand)}`}
        />
      </div>
      <div className="flex items-center gap-2 text-[9px] text-text-dim/60">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent" /> players {fate(players)}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-400/70" /> Fate (house) {fate(houseBand)} · {housePct}%
        </span>
      </div>
    </div>
  );
}

export function ScoreReveal({
  reveal,
  onContinue,
  canContinue,
}: {
  reveal: RoundScoreReveal;
  onContinue: () => void;
  /** GM-only — advance into the next turn. */
  canContinue: boolean;
}) {
  // Same opening beat as the Showdown reveal so the two board-centre animations
  // feel like one family (Showdown → Arc Gen → ScoreReveal).
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setRevealed(true), 650);
    return () => clearTimeout(id);
  }, []);

  const { threads, standings, totalFate, houseBand } = reveal;
  const housePct = pct(houseBand, totalFate);

  return (
    <div className="flex h-full w-full flex-col items-center gap-5 overflow-y-auto p-8">
      {/* Header — the round's Fate, and how much the world owned. */}
      <div className="flex w-full max-w-3xl flex-col items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.4em] text-accent/80">Scoring · Round {reveal.roundIndex + 1}</span>
        <span className="text-[12px] text-text-dim/70">
          {fate(totalFate)} Fate moved this round — <span className="text-amber-300/90">{housePct}% was the world&apos;s own</span> (out of any player&apos;s control)
        </span>
        <div className="mt-1 w-full max-w-md">
          <FateSplit totalFate={totalFate} houseBand={houseBand} revealed={revealed} />
        </div>
      </div>

      {/* Per-thread breakdown — movers first; reasoning + per-seat credit + the band. */}
      <div className="flex w-full max-w-3xl flex-col gap-3">
        {threads.map((t, ti) => (
          <div
            key={t.threadId}
            className="rounded-xl border border-white/8 bg-white/2 p-3 transition-all duration-500"
            style={{ opacity: revealed ? 1 : 0, transform: revealed ? "translateY(0)" : "translateY(8px)", transitionDelay: `${ti * 120}ms` }}
          >
            <div className="mb-1.5 flex items-start justify-between gap-3">
              <span className="text-[12px] font-medium text-text-primary">{t.question}</span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-secondary" title="Fate this thread moved">
                {fate(t.totalFate)} Fate
              </span>
            </div>
            {t.reasoning && <p className="mb-2 text-[10px] leading-relaxed text-text-dim/70">{t.reasoning}</p>}
            <div className="mb-2">
              <FateSplit totalFate={t.totalFate} houseBand={t.houseBand} revealed={revealed} />
            </div>
            <div className="flex flex-col gap-1">
              {t.seats.map((s) => (
                <div key={s.seatId} className="flex items-center gap-2 text-[11px]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="shrink-0 font-medium text-text-primary">{s.name}</span>
                  <span className="min-w-0 flex-1 truncate text-text-dim/60">{s.reasoning}</span>
                  <span
                    className={`shrink-0 font-mono tabular-nums ${s.credit >= 0.0049 ? "text-accent" : s.credit <= -0.0049 ? "text-rose-400" : "text-text-dim/50"}`}
                  >
                    {signed(s.credit)}
                  </span>
                </div>
              ))}
              {/* The thread's own house band, called out as its own line. */}
              <div className="flex items-center gap-2 border-t border-white/6 pt-1 text-[11px]">
                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400/70" />
                <span className="shrink-0 font-medium text-amber-300/90">Fate (the world)</span>
                <span className="min-w-0 flex-1 truncate text-text-dim/50">emergent — no player drove this</span>
                <span className="shrink-0 font-mono tabular-nums text-amber-300/80">{signed(t.houseBand)}</span>
              </div>
            </div>
          </div>
        ))}
        {threads.length === 0 && <div className="text-center text-[12px] text-text-dim/60">No threads moved this round.</div>}
      </div>

      {/* Standings — round delta + new total + rank. */}
      <div className="flex w-full max-w-3xl flex-col gap-1.5 rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="mb-1 text-[9px] uppercase tracking-[0.2em] text-text-dim/60">Standings · Fate moved</div>
        {standings.map((s, i) => (
          <div
            key={s.seatId}
            className="flex items-center gap-2 text-[12px] transition-all duration-500"
            style={{ opacity: revealed ? 1 : 0, transitionDelay: `${threads.length * 120 + i * 80}ms` }}
          >
            <span className={`w-4 text-center font-mono text-[10px] ${s.rank === 1 ? "text-amber-300" : "text-text-dim/50"}`}>{s.rank}</span>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="flex-1 truncate text-text-secondary">{s.name}</span>
            <span className={`font-mono tabular-nums ${s.credit >= 0.0049 ? "text-accent" : s.credit <= -0.0049 ? "text-rose-400" : "text-text-dim/40"}`}>
              {signed(s.credit)}
            </span>
            <span className="w-14 text-right font-mono tabular-nums text-text-primary">★ {fate(s.total)}</span>
          </div>
        ))}
      </div>

      {canContinue && (
        <button
          type="button"
          onClick={onContinue}
          disabled={!revealed}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-[12px] font-semibold text-white shadow-sm shadow-accent/30 transition hover:bg-accent/90 disabled:opacity-40"
        >
          Continue to next turn ▸
        </button>
      )}
    </div>
  );
}
