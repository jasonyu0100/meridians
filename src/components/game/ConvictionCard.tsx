/** A conviction card — the thing in your hand (plan §8). A card is a committed
 *  ACTION on one of the seat's own streams, priced by rarity (−log p). Tall and
 *  rarity-bordered, dressed like a real playing card: corner indices (rank + a
 *  rarity "suit" pip, mirrored top-left / bottom-right), a faint centre watermark,
 *  and a foil streak on legendaries. Two faces: FACE-UP is printed white card-stock
 *  (the action legible in dark ink); FACE-DOWN (concealed) flips to a themed violet
 *  back with a medallion + lattice. The white face is theme-independent on purpose
 *  — a card reads as a card on any table. */
"use client";
import { rarityTier, type RarityTier } from "@/lib/game/economy";
import type { Card } from "@/types/narrative";

// Rarity frame on the WHITE face — saturated edges that read on card-stock, the
// rarer the bet the more it glows.
const TIER_RING_FACE: Record<RarityTier, string> = {
  common: "border-zinc-300",
  uncommon: "border-sky-400/70",
  rare: "border-violet-400/70 shadow-[0_0_14px_-3px] shadow-violet-500/45",
  legendary: "border-amber-400/80 shadow-[0_0_18px_-2px] shadow-amber-500/50",
};
// Rarity frame on the themed BACK — the original dark-table glow.
const TIER_RING_BACK: Record<RarityTier, string> = {
  common: "border-white/15",
  uncommon: "border-sky-400/50",
  rare: "border-violet-400/60 shadow-[0_0_12px_-2px] shadow-violet-500/40",
  legendary: "border-amber-400/70 shadow-[0_0_16px_-1px] shadow-amber-500/50",
};
// The rank (cost) ink on the white face — coloured by rarity like a suit.
const TIER_INK: Record<RarityTier, string> = {
  common: "text-zinc-700",
  uncommon: "text-sky-600",
  rare: "text-violet-600",
  legendary: "text-amber-600",
};
const TIER_LABEL: Record<RarityTier, string> = {
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  legendary: "legendary",
};
// The rarity "suit" — an escalating brilliance, outline diamond → filled → sparkle
// → star. Doubles as the corner pip, the centre watermark, and the back medallion.
const TIER_PIP: Record<RarityTier, string> = {
  common: "◇",
  uncommon: "◆",
  rare: "✦",
  legendary: "★",
};

/** A card's corner index — the rank (cost) stacked over the rarity pip, as on a
 *  real playing card. Rendered top-left and (rotated) bottom-right so the card
 *  reads right-way-up from either end. */
function CornerIndex({ cost, pip, ink, rotated }: { cost: number; pip: string; ink: string; rotated?: boolean }) {
  return (
    <span
      className={`pointer-events-none absolute z-20 flex flex-col items-center leading-none ${ink} ${
        rotated ? "bottom-2 right-2 rotate-180" : "top-2 left-2"
      }`}
    >
      <span className="font-mono text-[12px] font-bold tabular-nums">{cost}</span>
      <span className="text-[10px] leading-none">{pip}</span>
    </span>
  );
}

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
  const pip = TIER_PIP[tier];
  const isCommitted = !!committed;
  // The face-down side: a played card concealed until the showdown reveal.
  const showBack = !!committed && !committed.faceUp && !committed.revealed;

  // Inks swap with the face: dark on white card-stock, light on the violet back.
  const titleInk = showBack ? "text-violet-200/70" : "text-zinc-400";
  const labelInk = showBack ? "text-violet-200/55" : "text-zinc-400";
  const cornerInk = showBack ? "text-violet-100" : TIER_INK[tier];
  const probInk = showBack ? "text-violet-200/55" : "text-zinc-400";

  return (
    <div className="relative flex flex-col items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled && !isCommitted && !(selected && canDeselect)}
        className={`group relative flex w-40 shrink-0 flex-col justify-between overflow-hidden rounded-xl border p-3 text-left transition ${
          showBack ? "bg-linear-to-br from-violet-700/55 to-violet-950/75" : "bg-linear-to-b from-[#ffffff] to-[#e8eaf2]"
        } ${
          isCommitted
            ? `-translate-y-4 ring-2 ${showBack ? "ring-violet-400/70" : committed!.forcedReveal ? "ring-rose-400/70" : "ring-accent"} shadow-xl shadow-black/50`
            : selected
              ? "ring-2 ring-accent -translate-y-2"
              : "hover:-translate-y-1"
        } ${showBack ? TIER_RING_BACK[tier] : TIER_RING_FACE[tier]} ${disabled && !isCommitted ? "opacity-40 cursor-not-allowed" : isCommitted ? (onClick ? "cursor-pointer" : "cursor-default") : "cursor-pointer"}`}
        style={{ height: 200 }}
        title={streamTitle}
      >
        {/* Printed-card inner frame — a faint hairline inset, the tell of card-stock:
            a violet hairline on the back, a zinc one on the white face. */}
        <span
          className={`pointer-events-none absolute inset-1.5 rounded-lg border ${showBack ? "border-violet-300/15" : "border-zinc-200/70"}`}
        />

        {/* Centre watermark — the rarity pip ghosted large behind the content, the
            way a court card carries a central motif. Face only. */}
        {!showBack && (
          <span className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
            <span className={`text-[80px] leading-none opacity-[0.05] ${TIER_INK[tier]}`}>{pip}</span>
          </span>
        )}

        {/* Legendary foil — a single diagonal sheen streak across the stock. */}
        {!showBack && tier === "legendary" && (
          <span
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              backgroundImage:
                "linear-gradient(135deg, transparent 32%, rgba(251,191,36,0.16) 46%, rgba(255,255,255,0.4) 50%, rgba(251,191,36,0.16) 54%, transparent 68%)",
            }}
          />
        )}

        {/* Concealed-back lattice — a crosshatched weave, the classic card back. */}
        {showBack && (
          <span
            className="pointer-events-none absolute inset-2.5 z-0 rounded-md opacity-40"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(196,181,253,0.3) 0 1.5px, transparent 1.5px 7px), repeating-linear-gradient(-45deg, rgba(196,181,253,0.3) 0 1.5px, transparent 1.5px 7px)",
            }}
          />
        )}

        {/* Corner indices — rank + pip, mirrored, so the card reads from either end. */}
        <CornerIndex cost={card.cost} pip={pip} ink={cornerInk} />
        <CornerIndex cost={card.cost} pip={pip} ink={cornerInk} rotated />

        {/* Stream title — padded clear of the top-left corner index. */}
        {!hideStreamTitle && (
          <div className={`relative z-10 truncate pl-5 pr-7 text-[9px] uppercase tracking-wider ${titleInk}`}>{streamTitle}</div>
        )}
        <div className="relative z-10 flex flex-1 items-center px-1">
          {showBack ? (
            <span className="flex w-full flex-col items-center gap-1.5 text-violet-100">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-violet-300/40 bg-violet-500/20 text-xl shadow-inner shadow-black/30">
                {pip}
              </span>
              <span className="text-[9px] uppercase tracking-[0.2em] text-violet-200/70">concealed</span>
            </span>
          ) : (
            <span className="text-sm font-medium leading-snug text-zinc-900 line-clamp-5" title={actionLabel}>
              {actionLabel}
            </span>
          )}
        </div>
        {/* Footer — the rarity name + its pip, like a deck's maker's mark. */}
        <div className="relative z-10 flex items-end justify-between">
          <span className={`flex items-center gap-1 text-[9px] uppercase tracking-wider ${labelInk}`}>
            <span className={showBack ? "text-violet-200/70" : TIER_INK[tier]}>{pip}</span>
            {TIER_LABEL[tier]}
          </span>
        </div>
        {!isCommitted && (
          <span className={`absolute right-2 top-2 z-20 font-mono text-[10px] tabular-nums ${probInk}`}>{(prob * 100).toFixed(0)}%</span>
        )}
      </button>

      {/* Committed conviction chip — only shown outside panel-hand mode (e.g.
          Showdown) where the panel header doesn't already label the stream. */}
      {isCommitted && !hideStreamTitle && (
        <span
          className={`pointer-events-none absolute -top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums text-white shadow ${
            showBack ? "bg-violet-500" : committed!.forcedReveal ? "bg-rose-500" : "bg-accent"
          }`}
        >
          ◆ {committed!.conviction}
        </span>
      )}
    </div>
  );
}
