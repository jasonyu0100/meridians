/** A conviction card — the thing in your hand (plan §8). A card is a committed
 *  ACTION on one of the seat's own streams, priced by rarity (−log p). Tall,
 *  rarity-bordered; the rarer the bet, the more it glows. Theme-token skinned. */
"use client";
import { rarityTier, type RarityTier } from "@/lib/game/economy";
import type { Card } from "@/types/narrative";

const TIER_RING: Record<RarityTier, string> = {
  common: "border-white/15",
  uncommon: "border-sky-400/50",
  rare: "border-violet-400/60 shadow-[0_0_12px_-2px] shadow-violet-500/40",
  legendary: "border-amber-400/70 shadow-[0_0_16px_-1px] shadow-amber-500/50",
};
const TIER_LABEL: Record<RarityTier, string> = {
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  legendary: "legendary",
};

export function ConvictionCard({
  card,
  actionLabel,
  streamTitle,
  prob,
  selected = false,
  disabled = false,
  committed,
  hideStreamTitle = false,
  canDeselect = false,
  onClick,
}: {
  card: Card;
  actionLabel: string;
  streamTitle: string;
  prob: number;
  selected?: boolean;
  disabled?: boolean;
  /** Set once this card is PLAYED — the card lifts (raised) and shows its
   *  committed conviction, instead of being pulled into a separate list. */
  committed?: { conviction: number; faceUp: boolean; revealed?: boolean; forcedReveal?: boolean };
  /** Panel-hand mode: suppress the stream-title line and the conviction chip
   *  (both are shown by the panel header / card cost already). */
  hideStreamTitle?: boolean;
  /** When true, a selected-but-unaffordable card can still be clicked to deselect.
   *  Pass false (or omit) when the timer has expired so cards are fully locked. */
  canDeselect?: boolean;
  /** Click handler — on committed cards this acts as the GM veto (pull back + refund). */
  onClick?: () => void;
}) {
  const tier = rarityTier(card.cost);
  const isCommitted = !!committed;
  const concealed = !!committed && !committed.faceUp && !committed.revealed;
  return (
    <div className="relative flex flex-col items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled && !isCommitted && !(selected && canDeselect)}
        className={`relative flex w-40 shrink-0 flex-col justify-between rounded-xl border p-3 text-left transition ${
          concealed ? "bg-linear-to-b from-violet-700/40 to-violet-950/60" : "bg-linear-to-b from-bg-elevated to-black/40"
        } ${
          isCommitted
            ? `-translate-y-4 ring-2 ${concealed ? "ring-violet-400/70" : committed!.forcedReveal ? "ring-rose-400/70" : "ring-accent"} shadow-xl shadow-black/50`
            : selected
              ? "ring-2 ring-accent -translate-y-2"
              : "hover:-translate-y-1"
        } ${TIER_RING[tier]} ${disabled && !isCommitted ? "opacity-40 cursor-not-allowed" : isCommitted ? (onClick ? "cursor-pointer" : "cursor-default") : "cursor-pointer"}`}
        style={{ height: 200 }}
        title={streamTitle}
      >
        {!hideStreamTitle && <div className="truncate text-[9px] uppercase tracking-wider text-text-dim/70">{streamTitle}</div>}
        <div className="flex flex-1 items-center">
          {concealed ? (
            <span className="flex w-full flex-col items-center gap-1 text-violet-200">
              <span className="text-2xl leading-none">🂠</span>
              <span className="text-[10px] uppercase tracking-wider">concealed</span>
            </span>
          ) : (
            <span
              className="text-sm font-medium leading-snug text-text-primary line-clamp-5"
              title={actionLabel}
            >
              {actionLabel}
            </span>
          )}
        </div>
        <div className="flex items-end justify-between">
          <span className="text-[9px] uppercase tracking-wider text-text-dim/60">{TIER_LABEL[tier]}</span>
          <span className="font-mono text-xl leading-none tabular-nums text-accent">{card.cost}</span>
        </div>
        {!isCommitted && (
          <span className="absolute right-1.5 top-1.5 font-mono text-[10px] tabular-nums text-text-dim/55">{(prob * 100).toFixed(0)}%</span>
        )}
      </button>

      {/* Committed conviction chip — only shown outside panel-hand mode (e.g.
          Showdown) where the panel header doesn't already label the stream. */}
      {isCommitted && !hideStreamTitle && (
        <span
          className={`pointer-events-none absolute -top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums shadow ${
            concealed ? "bg-violet-500 text-white" : committed!.forcedReveal ? "bg-rose-500 text-white" : "bg-accent text-white"
          }`}
        >
          ◆ {committed!.conviction}
        </span>
      )}
    </div>
  );
}
