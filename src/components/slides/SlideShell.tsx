'use client';

import React from 'react';

/**
 * Shared layout shell for every slide in the deck.
 *
 * Design principles:
 *
 *  • **Symmetric gutters.** Horizontal padding is identical on every slide;
 *    content lives inside a centered max-width column so the deck reads as
 *    one document on widescreen displays.
 *
 *  • **Top-anchored header, bottom-anchored footer.** Title block at the
 *    top, optional footer at the bottom, body fills the middle. The reader
 *    learns this rhythm once and never has to re-orient.
 *
 *  • **Unified title hierarchy.** The eyebrow (small uppercase label) +
 *    title (large bold) + subtitle (dim body text) trio is the canonical
 *    opening for every slide. Slides without one of the three pass
 *    undefined and the shell elides it cleanly.
 *
 *  • **Vertical balance.** Bodies that fit comfortably get vertically
 *    centered into the remaining space; long bodies fill it from the top
 *    and scroll internally if needed. The shell hands the choice to the
 *    caller via the `align` prop.
 *
 *  • **One frame style for chart cards.** `SlideCard` wraps charts and
 *    similar dense regions in the same border + background so the deck
 *    feels uniform without forcing every chart into the same dimensions.
 *
 * Keep this file small. Layout primitives only — no domain logic, no D3,
 * no data fetching. Slides import from here; this file imports nothing.
 */

type Align = 'center' | 'top';

export function SlideShell({
  eyebrow,
  title,
  subtitle,
  rightSlot,
  footer,
  align = 'top',
  contentWidth = 'normal',
  children,
}: {
  /** Small uppercase label above the title (e.g. "Paradigm · Signature"). */
  eyebrow?: React.ReactNode;
  /** Primary slide title — required. */
  title: React.ReactNode;
  /** Single-line dim body under the title. */
  subtitle?: React.ReactNode;
  /** Right-aligned accessory in the header row (chips, tags, badges). */
  rightSlot?: React.ReactNode;
  /** Bottom strip — formula notes, legends, supplementary metadata. */
  footer?: React.ReactNode;
  /** `center` centres the body vertically into the remaining space (good
   *  for compact slides — title-cards, archetype-callouts). `top` anchors
   *  the body to the header and lets it fill downward (good for grids,
   *  ranked lists, large charts). */
  align?: Align;
  /** `normal` caps the content column at `max-w-6xl`. `wide` lets long
   *  charts breathe via `max-w-7xl`. `narrow` keeps the column tight
   *  (`max-w-4xl`) for short prose / hero slides. */
  contentWidth?: 'narrow' | 'normal' | 'wide';
  children: React.ReactNode;
}) {
  const widthClass =
    contentWidth === 'narrow'
      ? 'max-w-4xl'
      : contentWidth === 'wide'
        ? 'max-w-7xl'
        : 'max-w-6xl';

  return (
    <div className="h-full px-12 py-10 flex flex-col">
      {/* Centered content column — gives the deck horizontal symmetry. */}
      <div className={`mx-auto w-full ${widthClass} flex flex-col flex-1 min-h-0`}>
        {/* Header — eyebrow + title + subtitle + optional right slot. */}
        <header className="mb-6 shrink-0">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1 min-w-0">
              {eyebrow && (
                <div className="text-[10px] uppercase tracking-[0.3em] text-text-dim mb-2">
                  {eyebrow}
                </div>
              )}
              <h2 className="text-3xl font-bold text-text-primary tracking-tight leading-tight">
                {title}
              </h2>
              {subtitle && (
                <p className="text-sm text-text-secondary leading-relaxed mt-2 max-w-3xl">
                  {subtitle}
                </p>
              )}
            </div>
            {rightSlot && <div className="shrink-0 pt-1">{rightSlot}</div>}
          </div>
        </header>

        {/* Body — `align` decides whether to centre or top-anchor. */}
        <main
          className={`flex flex-col min-h-0 ${
            align === 'center' ? 'flex-1 justify-center' : 'flex-1'
          }`}
        >
          {children}
        </main>

        {/* Optional footer — keeps formula notes and legends at the bottom. */}
        {footer && (
          <footer className="mt-6 pt-4 border-t border-white/[0.05] text-[10px] text-text-dim shrink-0">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/** Card frame for charts and dense regions. One style across the deck so
 *  every chart sits in the same visual container — different sizes are
 *  fine, but the bezel should always look the same. */
export function SlideCard({
  label,
  children,
  className = '',
}: {
  /** Optional small uppercase label rendered in a top band. */
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-white/[0.08] bg-white/[0.02] overflow-hidden ${className}`}>
      {label && (
        <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-text-dim border-b border-white/[0.06]">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

/** Thin stat-strip frame used above charts. The shell is opinionated about
 *  the bezel and spacing; callers decide what tokens to render inside. The
 *  flex container lays them out with consistent gaps; `accent` (when
 *  provided) right-aligns the trailing context. */
export function SlideStatStrip({
  children,
  accent,
  className = '',
}: {
  children: React.ReactNode;
  /** Right-aligned trailing element (italic context, total, etc.). */
  accent?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-text-dim border border-white/[0.08] rounded-md px-3 py-2 ${className}`}>
      {children}
      {accent && <span className="ml-auto text-text-dim/70 italic">{accent}</span>}
    </div>
  );
}
