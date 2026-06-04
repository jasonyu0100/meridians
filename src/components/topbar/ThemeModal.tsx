"use client";
// ThemeModal — pick the app colour theme from preview swatches.

import { Modal, ModalBody, ModalHeader } from "@/components/Modal";
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

export function ThemeModal({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useTheme();

  return (
    <Modal onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>
        <h2 className="text-sm font-semibold text-text-primary">Theme</h2>
      </ModalHeader>
      <ModalBody>
        <p className="text-[11px] text-text-dim mb-4">
          Choose the workspace appearance. Your choice is saved on this device
          and applied everywhere.
        </p>
        <div className="space-y-2.5">
          {THEMES.map((id) => {
            const o = OPTIONS[id];
            const active = theme === id;
            return (
              <button
                key={id}
                onClick={() => setTheme(id)}
                className={`w-full flex items-center gap-3.5 rounded-xl border p-3 text-left transition-colors ${
                  active
                    ? "border-violet-300/60 bg-white/5"
                    : "border-border hover:bg-white/5"
                }`}
              >
                {/* Preview swatch — mini window of the theme */}
                <div
                  className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-border"
                  style={{ background: o.swatch.bg }}
                >
                  <div
                    className="absolute left-1.5 top-1.5 h-3 w-9 rounded"
                    style={{ background: o.swatch.panel }}
                  />
                  <div
                    className="absolute left-1.5 bottom-1.5 h-1.5 w-7 rounded-full"
                    style={{ background: o.swatch.text }}
                  />
                  <div
                    className="absolute right-1.5 bottom-1.5 h-2.5 w-2.5 rounded-full"
                    style={{ background: o.swatch.accent }}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-text-primary">
                      {o.name}
                    </span>
                    {active && (
                      <span className="text-[9px] uppercase tracking-wide text-violet-300 font-semibold">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-text-dim mt-0.5 leading-snug">
                    {o.desc}
                  </p>
                </div>

                {/* Radio indicator */}
                <div
                  className={`shrink-0 h-4 w-4 rounded-full border flex items-center justify-center ${
                    active ? "border-violet-300" : "border-border"
                  }`}
                >
                  {active && (
                    <div className="h-2 w-2 rounded-full bg-violet-300" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </ModalBody>
    </Modal>
  );
}
