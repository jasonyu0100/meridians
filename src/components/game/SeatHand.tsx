/** The hand — a row of cards at the bottom of the felt, grouped/divided by
 *  stream (plan §8). Tap a card → a commit tray of one-tap stake chips (Play /
 *  Raise ×2 / ×3 / All-in); no sliders. Concealment is a single toggle. Each
 *  stake commits immediately at that amount (the GM can veto a mis-tap). */
"use client";
import { useState } from "react";

import { ConvictionCard } from "@/components/game/ConvictionCard";
import { canAfford, effectiveCost } from "@/lib/game/economy";
import { streamProbs } from "@/lib/forces/stream-stance";
import type { ConvictionEconomy, Hand, Stream } from "@/types/narrative";

export function SeatHand({
  hand,
  streamsById,
  balance,
  economy,
  canPlay,
  onPlay,
  onVeto,
}: {
  hand: Hand;
  streamsById: Record<string, Stream>;
  balance: number;
  economy: ConvictionEconomy;
  canPlay: boolean;
  onPlay: (cardId: string, conviction: number, faceUp: boolean) => void;
  /** GM-only — pull back a committed play (refund + revert the stance). */
  onVeto?: (playIndex: number) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // Concealment: a face-down play hides the action until the showdown reveal and
  // pays the premium (a higher minimum). Offered only when the room prices it.
  const [faceDown, setFaceDown] = useState(false);
  const canConceal = economy.facedownPremium > 1;

  // All cards stay in the hand, grouped by stream — a PLAYED card isn't removed,
  // it lifts (raised) to show it's committed (the index into played for veto).
  const playIndexOf = (cardId: string) => hand.played.findIndex((p) => p.card.id === cardId);
  const byStream = new Map<string, typeof hand.cards>();
  for (const c of hand.cards) {
    const arr = byStream.get(c.streamId) ?? [];
    arr.push(c);
    byStream.set(c.streamId, arr);
  }

  const sel = hand.cards.find((c) => c.id === selected) ?? null;
  const committed = hand.played.length;
  // Raising = buying insurance on the draw, so it's only available when the
  // contest is decided by odds (random) or forces the rarest (highest-cost).
  const canRaise = economy.resolveBias === "random" || economy.resolveBias === "highest-cost";

  // Minimum commit for the current selection — the premium floor when concealed.
  const minCommit = sel ? effectiveCost(sel.cost, !faceDown, economy) : 0;
  const affordable = sel ? minCommit <= balance : false;

  // One-tap stake chips. Play = the floor; raises are fixed multiples; All-in
  // commits the whole stack. Only amounts the seat can afford (and that aren't
  // duplicates) are shown.
  const stakes: { key: string; label: string; amt: number }[] = [];
  if (sel) {
    stakes.push({ key: "play", label: faceDown ? "Conceal" : "Play", amt: minCommit });
    if (canRaise) {
      for (const m of [2, 3]) if (minCommit * m <= balance) stakes.push({ key: `x${m}`, label: `Raise ×${m}`, amt: minCommit * m });
      if (balance > minCommit && !stakes.some((s) => s.amt === balance)) stakes.push({ key: "max", label: "All in", amt: balance });
    }
  }

  const commit = (amt: number) => {
    if (!sel || amt < minCommit || amt > balance) return;
    onPlay(sel.id, amt, !faceDown);
    setSelected(null);
    setFaceDown(false);
  };

  if (byStream.size === 0) {
    return <div className="py-4 text-center text-sm text-text-dim/60">No cards in hand — pose a question to be dealt one.</div>;
  }

  return (
    <div className="relative flex flex-col items-center gap-2">
      {/* The hand — each STREAM (open question) is its own panel so the distinct
          decisions read clearly; its action-cards sit inside. You can back more
          than one card per stream (multi-outcome), with a merge caveat. */}
      <div className="flex items-start justify-center gap-3 overflow-x-auto px-2 pb-2">
        {[...byStream.entries()].map(([streamId, cards]) => {
          const stream = streamsById[streamId];
          const probs = stream ? streamProbs(stream) : [];
          const playedOutcomes = new Set<number>();
          for (const c of cards) if (playIndexOf(c.id) >= 0) playedOutcomes.add(c.outcome);
          const multiOutcome = playedOutcomes.size >= 2;
          return (
            <div
              key={streamId}
              className="flex shrink-0 flex-col gap-2 rounded-2xl border border-white/12 bg-white/3 px-3 pt-2.5 pb-3"
            >
              {/* The open question — the decision this stream poses. */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent/70">open question</span>
                <span className="text-[13px] font-medium leading-snug text-text-primary line-clamp-2">
                  {stream?.title ?? streamId}
                </span>
              </div>
              {/* The action-cards — raised lift needs headroom: translate(-16px) + chip(-8px) = 24px above layout. */}
              <div className="flex justify-center gap-2 pt-7">
                {cards.map((card) => {
                  const pi = playIndexOf(card.id);
                  const play = pi >= 0 ? hand.played[pi] : undefined;
                  return (
                    <ConvictionCard
                      key={card.id}
                      card={card}
                      actionLabel={stream?.outcomes?.[card.outcome] ?? `action ${card.outcome}`}
                      streamTitle={stream?.title ?? streamId}
                      prob={probs[card.outcome] ?? 0}
                      selected={selected === card.id}
                      disabled={!canPlay || !canAfford(balance, card.cost, true, committed, economy)}
                      committed={play ? { conviction: play.conviction, faceUp: play.faceUp, revealed: play.revealed, forcedReveal: play.forcedReveal } : undefined}
                      hideStreamTitle
                      canDeselect={canPlay}
                      onClick={
                        play
                          ? (onVeto ? () => onVeto(pi) : undefined)
                          : () => setSelected(selected === card.id ? null : card.id)
                      }
                    />
                  );
                })}
              </div>
              {/* Footer hint — multi-outcome play is allowed, with a merge caveat. */}
              {multiOutcome ? (
                <div className="flex items-start gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-[11px] leading-snug text-amber-200/90">
                  <span>⚠</span>
                  <span>Multi-outcome — backing several actions here may not merge cleanly; the engine interprets and may resolve the conflict between your own cards.</span>
                </div>
              ) : (
                cards.length > 1 && (
                  <span className="text-center text-[11px] text-text-dim/55">back one — or several (multi-outcome)</span>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Floating commit palette — appears centred ABOVE the hand on select, so
          the stake controls are big, legible, and out of the way of the cards. */}
      {sel && canPlay && (
        <div className="absolute bottom-full left-1/2 z-20 mb-3 -translate-x-1/2">
          <div className="flex items-center gap-4 rounded-2xl border border-accent/30 bg-bg-elevated px-5 py-3 shadow-2xl shadow-black/60">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-text-dim/60">commit on</span>
              <span className="max-w-52 truncate text-sm font-semibold text-text-primary">
                {streamsById[sel.streamId]?.outcomes?.[sel.outcome]}
              </span>
            </div>

            {/* Concealment — a single toggle (only when the room prices it). */}
            {canConceal && (
              <button
                type="button"
                onClick={() => setFaceDown((v) => !v)}
                title={faceDown ? `Concealed — pays ×${economy.facedownPremium}, hidden until showdown` : "Open play — tap to conceal"}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs transition ${
                  faceDown ? "border-violet-400/50 bg-violet-500/20 text-violet-200" : "border-border-subtle text-text-dim hover:text-text-secondary"
                }`}
              >
                🂠 {faceDown ? `concealed ×${economy.facedownPremium}` : "conceal"}
              </button>
            )}

            {/* One-tap stake chips — each commits immediately at that amount. */}
            {!affordable ? (
              <span className="text-xs text-rose-400/90">Not enough conviction · need {minCommit}</span>
            ) : (
              <div className="flex items-center gap-2">
                {stakes.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => commit(s.amt)}
                    title={`${s.label} — commit ${s.amt} conviction`}
                    className={`flex min-w-18 flex-col items-center rounded-xl border px-4 py-2 leading-tight transition ${
                      s.key === "play"
                        ? "border-accent bg-accent text-white shadow-sm shadow-accent/30 hover:bg-accent/90"
                        : "border-border-subtle text-text-secondary hover:border-accent/60 hover:text-text-primary"
                    }`}
                  >
                    <span className="text-[10px] uppercase tracking-wider opacity-80">{s.label}</span>
                    <span className="font-mono text-xl font-bold tabular-nums">{s.amt}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Little pointer down to the hand */}
          <div className="mx-auto h-3 w-3 -translate-y-1.5 rotate-45 border-b border-r border-accent/30 bg-bg-elevated" />
        </div>
      )}

    </div>
  );
}
