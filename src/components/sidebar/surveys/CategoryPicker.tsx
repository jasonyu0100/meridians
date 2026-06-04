"use client";

// CategoryPicker — selector for the eight research-lens categories used by surveys and interviews.

import { useState } from "react";
import { RESEARCH_CATEGORIES } from "@/lib/research-categories";

/**
 * Compact category chip selector. Same UI for surveys + interviews —
 * surveys use it to scope a global probe; interviews use it to frame a
 * subject's question batch. Empty = "let the engine pick".
 */
export function CategoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [customMode, setCustomMode] = useState(value !== "" && !RESEARCH_CATEGORIES.includes(value as never));

  return (
    <div className="flex items-center gap-1 flex-wrap text-[10px]">
      {RESEARCH_CATEGORIES.map((c) => (
        <button
          key={c}
          onClick={() => {
            setCustomMode(false);
            onChange(value === c ? "" : c);
          }}
          className={`px-1.5 py-0.5 rounded transition-colors ${
            value === c
              ? "bg-amber-400/20 text-amber-400"
              : "text-text-dim hover:text-text-secondary hover:bg-white/5"
          }`}
        >
          {c}
        </button>
      ))}
      {customMode ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (!value.trim()) setCustomMode(false);
          }}
          placeholder="Custom"
          className="bg-white/5 border border-white/10 rounded text-[10px] text-text-primary px-1.5 py-0.5 placeholder:text-text-dim/40 focus:outline-none focus:border-white/20 w-24"
        />
      ) : (
        <button
          onClick={() => {
            setCustomMode(true);
            onChange("");
          }}
          className="px-1.5 py-0.5 rounded text-text-dim/60 hover:text-text-secondary hover:bg-white/5 transition-colors"
        >
          + Custom
        </button>
      )}
    </div>
  );
}
