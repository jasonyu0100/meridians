"use client";
// ThemeMenu — compact dropdown to pick the app colour theme from preview
// swatches. Styled like the other top-bar pill dropdowns (usage, slides).

import { THEMES, useTheme, type Theme } from "@/lib/state/theme-context";

type ThemeOption = {
  id: Theme;
  name: string;
  desc: string;
  /** Preview swatch colours, sampled from the theme's tokens. */
  swatch: { bg: string; panel: string; text: string; accent: string };
};

const OPTIONS: Record<Theme, ThemeOption> = {
  astral: {
    id: "astral",
    name: "Astral",
    desc: "Luminous deep-space violet with drifting nebulae and a star field — the Meridians signature.",
    swatch: { bg: "#0e0820", panel: "#2b2153", text: "#ededf2", accent: "#c4b5fd" },
  },
  dark: {
    id: "dark",
    name: "Dark",
    desc: "Clean neutral dark. No cosmos — flat, focused, low-distraction.",
    swatch: { bg: "#0a0a0b", panel: "#1c1c1f", text: "#ededed", accent: "#9ca3af" },
  },
  light: {
    id: "light",
    name: "Light",
    desc: "Bright neutral surface with dark text. Best for daylight and print-style reading.",
    swatch: { bg: "#f4f4f7", panel: "#ffffff", text: "#1a1a22", accent: "#6d5ae6" },
  },
};

export function ThemeMenu({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="absolute top-full right-0 mt-1.5 z-[100] min-w-[256px] bg-bg-base border border-white/12 rounded-lg shadow-2xl shadow-black/60 overflow-hidden p-1.5">
      {THEMES.map((id) => {
        const o = OPTIONS[id];
        const active = theme === id;
        return (
          <button
            key={id}
            onClick={() => { setTheme(id); onClose(); }}
            className={`w-full flex items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${
              active ? "bg-white/8" : "hover:bg-white/5"
            }`}
          >
            {/* Preview swatch — mini window of the theme */}
            <div
              className="relative h-8 w-11 shrink-0 overflow-hidden rounded border border-border"
              style={{ background: o.swatch.bg }}
            >
              <div className="absolute left-1 top-1 h-2 w-6 rounded" style={{ background: o.swatch.panel }} />
              <div className="absolute left-1 bottom-1 h-1 w-5 rounded-full" style={{ background: o.swatch.text }} />
              <div className="absolute right-1 bottom-1 h-1.5 w-1.5 rounded-full" style={{ background: o.swatch.accent }} />
            </div>

            <div className="min-w-0 flex-1">
              <span className="text-[12px] font-medium text-text-primary">{o.name}</span>
              <p className="text-[10px] text-text-dim/70 leading-snug line-clamp-1">{o.desc}</p>
            </div>

            {active && (
              <svg className="w-3.5 h-3.5 shrink-0 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
