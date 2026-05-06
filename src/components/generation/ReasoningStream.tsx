"use client";

import { useState } from "react";

/**
 * Reasoning display primitives shared by BranchWorkbench and ChatPanel.
 *
 *   ReasoningInline      live during streaming. Plain dim italic text on a
 *                        left border. No scroll, no max-height — text grows
 *                        as it arrives. Once the answer starts streaming,
 *                        dims to push attention down to the response.
 *
 *   ReasoningCollapsed   persisted past-turn variant. "Thought for Xs"
 *                        header, click to expand prior thinking inline.
 */

export function ReasoningInline({ text, active }: { text: string; active: boolean }) {
  return (
    <div
      className={`flex flex-col gap-1 pl-3 border-l border-white/8 transition-opacity ${
        active ? "opacity-100" : "opacity-45"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="w-1 h-1 rounded-full bg-amber-300/60 animate-pulse" />
        <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim/50 font-mono">
          Thinking
        </span>
      </div>
      <div className="text-[11.5px] text-text-dim/55 italic leading-relaxed whitespace-pre-wrap">
        {text}
      </div>
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
      {open && (
        <div className="pl-3 border-l border-white/8 text-[11.5px] text-text-dim/55 italic leading-relaxed whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}
