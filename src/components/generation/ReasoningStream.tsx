"use client";
// ReasoningStream — reasoning display primitives (inline + collapsible) shared by BranchChat and ChatPanel.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Reasoning display primitives shared by BranchChat and ChatPanel.
 *
 *   ReasoningInline      live during streaming. Dim italic text on a left
 *                        border, capped to a max-height that scrolls (and
 *                        auto-follows the stream) with an Expand toggle to
 *                        lift the cap. Once the answer starts streaming,
 *                        dims to push attention down to the response.
 *
 *   ReasoningCollapsed   persisted past-turn variant. "Thought for Xs"
 *                        header, click to expand prior thinking inline —
 *                        the expanded body carries the same max-height +
 *                        Expand affordance.
 */

const COLLAPSED_MAX_H = "max-h-40"; // ~10rem starting cap before Expand

/**
 * The reasoning text body: dim italic prose capped to a starting max-height
 * that scrolls. Shows an Expand / Collapse control only when the content
 * actually overflows the cap. When `follow` is set (live streaming), keeps
 * the scroll pinned to the newest text while the cap is in place.
 */
function ReasoningBody({ text, follow }: { text: string; follow?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Detect whether the capped body is actually clipping content.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  // While streaming and capped, follow the newest reasoning text.
  useEffect(() => {
    if (!follow || expanded) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, follow, expanded]);

  return (
    <div className="flex flex-col gap-1 items-start min-w-0 w-full">
      <div
        ref={scrollRef}
        className={`pl-3 border-l border-white/8 text-[11.5px] text-text-dim/55 italic leading-relaxed whitespace-pre-wrap w-full ${
          expanded ? "" : `${COLLAPSED_MAX_H} overflow-y-auto`
        }`}
      >
        {text}
      </div>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-3 text-[9px] uppercase tracking-[0.16em] font-mono text-text-dim/45 hover:text-text-secondary transition-colors"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      )}
    </div>
  );
}

export function ReasoningInline({ text, active }: { text: string; active: boolean }) {
  return (
    <div
      className={`flex flex-col gap-1 transition-opacity ${
        active ? "opacity-100" : "opacity-45"
      }`}
    >
      <div className="flex items-center gap-1.5 pl-3">
        <span className="w-1 h-1 rounded-full bg-amber-300/60 animate-pulse" />
        <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim/50 font-mono">
          Thinking
        </span>
      </div>
      <ReasoningBody text={text} follow={active} />
    </div>
  );
}

export function ReasoningCollapsed({
  text,
  durationMs,
}: {
  text: string;
  durationMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const label =
    durationMs != null
      ? `Thought for ${(durationMs / 1000).toFixed(1)}s`
      : "Thought";
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="self-start flex items-center gap-1.5 text-[10px] text-text-dim/60 hover:text-text-secondary transition-colors group"
      >
        <span
          className={`text-text-dim/40 group-hover:text-text-dim/70 transition-transform ${
            open ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
        <span className="uppercase tracking-[0.16em] font-mono">{label}</span>
      </button>
      {open && <ReasoningBody text={text} />}
    </div>
  );
}
