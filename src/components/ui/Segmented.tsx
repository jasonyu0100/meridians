"use client";

// Segmented — the canonical tab / toggle / segmented-control for the app.
//
// One component so every segmented control shares the same neutral surface
// scale instead of each modal hand-rolling its own (which is how violet
// `bg-bg-elevated` chrome crept in). The surface vocabulary is the app-wide
// transparent-ink overlay scale — theme-correct in every theme because the
// light theme remaps `--color-white` to a dark ink, so `white/x` overlays
// invert automatically:
//
//   track (resting)   bg-white/4     — the control's recessed groove
//   item · active     bg-white/10    — the selected segment
//   item · idle       text-text-dim, hover → text-text-secondary
//   item · active txt text-text-primary
//
// Accent (violet) is reserved for genuine semantic emphasis, never for plain
// control chrome — keep selection states neutral here.

import type { ReactNode } from "react";

export type SegmentedOption<T extends string> = {
  label: ReactNode;
  value: T;
  disabled?: boolean;
};

type Props<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Disable the whole control (e.g. while a generation is streaming). */
  disabled?: boolean;
  /** Visual density. `sm` = compact settings tabs, `md` = default modal tabs. */
  size?: "sm" | "md";
  /** Uppercase + letter-spaced labels (settings-style tabs). */
  uppercase?: boolean;
  /** Extra classes on the track (layout: `shrink-0`, `mb-4`, …). */
  className?: string;
};

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  size = "md",
  uppercase,
  className = "",
}: Props<T>) {
  const pad = size === "sm" ? "px-2 py-1.5 text-[10px]" : "px-3 py-1.5 text-[11px]";
  return (
    <div className={`flex gap-1 rounded-lg bg-white/4 p-0.5 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            disabled={disabled || o.disabled}
            className={`flex-1 rounded-md font-medium transition-colors ${pad} ${
              uppercase ? "uppercase tracking-wider" : ""
            } ${
              active
                ? "bg-white/10 text-text-primary"
                : "text-text-dim hover:text-text-secondary"
            } disabled:opacity-50`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
