"use client";

/**
 * Shared inference-shape renderer — the canonical visual language for the
 * universal inference-shape (detail load-bearing; considered / breaks /
 * opens as supporting handles) used across CRG, PRG, planning scenarios,
 * and anywhere reasoning surfaces in the app.
 *
 * Replaces three duplicated `ExpandableField` definitions previously
 * scattered across ReasoningNodeDetail, PhaseNodeDetail, and CompassView.
 * Renders the same shape with the same glyphs (× / ! / ⇒) and carries
 * legend tooltips on every label so the visual taxonomy is learnable.
 */

import { useMemo, useState } from "react";

/** Legend text rendered as `title` (hover tooltip) on each field's label.
 *  Documents what the glyph means so a reader new to the inference-shape
 *  can learn it without reading docs. */
export const INFERENCE_LEGEND = {
  detail: "Load-bearing content — the inference, claim, or answer itself",
  considered: "Alternative readings considered and rejected, with why — the option space this selected from",
  breaks: "Falsification handle — what would invalidate this inference",
  opens: "Forward extension — second-order possibilities this opens beyond the drawn edges",
} as const;

/** Single collapsible field. Exposed so callers can render bespoke labels
 *  alongside the canonical four (e.g. CompassView's "Reasoning" alias
 *  for `detail`). */
export function ExpandableField({
  label,
  legend,
  icon,
  iconColor,
  content,
  defaultOpen = false,
}: {
  label: string;
  /** Hover tooltip text — typically one of the `INFERENCE_LEGEND` entries. */
  legend?: string;
  /** Glyph rendered before the label (× / ! / ⇒). Optional. */
  icon?: string;
  iconColor?: string;
  content: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const preview = useMemo(() => {
    if (defaultOpen) return "";
    const firstSentenceEnd = content.search(/[.!?](\s|$)/);
    return firstSentenceEnd > 0 && firstSentenceEnd < 100
      ? content.slice(0, firstSentenceEnd + 1)
      : content.slice(0, 80) + (content.length > 80 ? "…" : "");
  }, [content, defaultOpen]);
  return (
    <div
      className={`${iconColor ?? "text-text-dim/40"} ${open ? "" : "opacity-60 hover:opacity-100"} transition-opacity`}
    >
      <div className="flex flex-col border-l-2 border-current pl-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 py-0.5 text-left w-full group"
          title={legend}
        >
          {icon && (
            <span className="text-[12px] leading-none font-bold w-2.5 text-center">
              {icon}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wider text-text-secondary font-medium">
            {label}
          </span>
          {!open && preview && (
            <span className="flex-1 min-w-0 text-[11px] text-text-dim/70 leading-snug truncate">
              {preview}
            </span>
          )}
          <span className="ml-auto shrink-0 text-text-dim/40 group-hover:text-text-secondary transition text-[12px] leading-none font-mono">
            {open ? "−" : "+"}
          </span>
        </button>
        {open && (
          <p className="pt-0.5 pb-1 text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
            {content}
          </p>
        )}
      </div>
    </div>
  );
}

/** Render the full universal inference-shape — detail + considered + breaks
 *  + opens — in canonical order with canonical glyphs and legend tooltips.
 *  Caller may rename the load-bearing field via `detailLabel` (e.g.
 *  "Reasoning" for the variable-scenario surface where the field was
 *  historically called that). */
export function InferenceFields({
  detail,
  considered,
  breaks,
  opens,
  detailLabel = "Detail",
  detailDefaultOpen = true,
}: {
  detail?: string;
  considered?: string;
  breaks?: string;
  opens?: string;
  /** Override for the load-bearing field's label. Default "Detail". */
  detailLabel?: string;
  /** Whether the load-bearing field starts expanded. Default true. */
  detailDefaultOpen?: boolean;
}) {
  return (
    <>
      {detail && (
        <ExpandableField
          label={detailLabel}
          legend={INFERENCE_LEGEND.detail}
          content={detail}
          defaultOpen={detailDefaultOpen}
        />
      )}
      {considered && (
        <ExpandableField
          label="Considered"
          legend={INFERENCE_LEGEND.considered}
          icon="×"
          iconColor="text-amber-400"
          content={considered}
        />
      )}
      {breaks && (
        <ExpandableField
          label="Breaks"
          legend={INFERENCE_LEGEND.breaks}
          icon="!"
          iconColor="text-rose-400"
          content={breaks}
        />
      )}
      {opens && (
        <ExpandableField
          label="Opens"
          legend={INFERENCE_LEGEND.opens}
          icon="⇒"
          iconColor="text-emerald-400"
          content={opens}
        />
      )}
    </>
  );
}
