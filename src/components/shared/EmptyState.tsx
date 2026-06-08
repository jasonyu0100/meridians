'use client';

// EmptyState — the universal "nothing here yet" placeholder for stage tabs
// (Mind / Channel) and any other full-height surface. It fills its container
// and centres on both axes, so every empty tab reads the same regardless of
// how the host view lays itself out. Replaces the per-view hand-rolled blocks
// that disagreed on centring (some `h-full justify-center`, some `flex-1
// justify-center py-20` which collapsed to the top when the parent wasn't a
// flex column).
//
// Centring strategy: `absolute inset-0`. Host views often nest their empty
// state inside auto-height content wrappers (e.g. `max-w-2xl mx-auto pt-6`),
// where `h-full` resolves to content height and pins to the top. Absolute
// positioning escapes those non-positioned wrappers and anchors to the
// nearest positioned ancestor — the stage's `relative flex-1` container —
// so it always fills the full surface and centres. The overlay is
// `pointer-events-none` so it never blocks the palette/canvas beneath; only
// the optional action re-enables pointer events.

import type { ComponentType } from 'react';

export interface EmptyStateProps {
  /** Optional glyph rendered in a circular frame above the title. */
  icon?: ComponentType<{ size?: number; className?: string }>;
  /** Primary line — what's missing. */
  title: string;
  /** Optional explanatory paragraph (constrained to a readable measure). */
  description?: string;
  /** Optional dimmer action hint, e.g. "Use the palette below to generate one." */
  hint?: string;
  /** Optional interactive slot (a button / link) rendered below the copy. */
  action?: React.ReactNode;
  /** Extra classes merged onto the centring wrapper. */
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  hint,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center pointer-events-none ${className}`}
    >
      {Icon && (
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-text-dim/50">
          <Icon size={18} />
        </div>
      )}
      <p className="text-[13px] text-text-secondary">{title}</p>
      {description && (
        <p className="text-[11px] text-text-dim/60 max-w-md leading-relaxed">
          {description}
        </p>
      )}
      {hint && <p className="text-[10px] text-text-dim/40">{hint}</p>}
      {action && <div className="mt-1 pointer-events-auto">{action}</div>}
    </div>
  );
}
