"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// ── Theme model ──────────────────────────────────────────────────────────────
//
// Three themes share one token contract (see globals.css). The active theme is
// a class on <html> — `theme-astral` | `theme-dark` | `theme-light` — which
// swaps the raw CSS variables the Tailwind utilities resolve to. A no-FOUC
// inline script in the root layout applies the stored class before paint; this
// context mirrors that into React state so components (cosmos gating, the theme
// modal) can read and change it.

export type Theme = "astral" | "dark" | "light";

export const THEMES: Theme[] = ["astral", "dark", "light"];
export const THEME_STORAGE_KEY = "meridians_theme";
export const DEFAULT_THEME: Theme = "astral";

function isTheme(value: unknown): value is Theme {
  return value === "astral" || value === "dark" || value === "light";
}

/** Apply a theme class to <html> and keep the coarse light/dark hint in sync. */
export function applyThemeClass(theme: Theme) {
  const el = document.documentElement;
  el.classList.remove(
    "theme-astral",
    "theme-dark",
    "theme-light",
    "dark",
    "light",
  );
  el.classList.add(`theme-${theme}`);
  // Coarse hint kept for any UA-styled form controls / native widgets.
  el.classList.add(theme === "light" ? "light" : "dark");
  el.style.colorScheme = theme === "light" ? "light" : "dark";
}

/** Resolve the initial theme on the client: stored preference first, then the
 * class the no-FOUC script applied, then the default. Server renders default. */
function readInitialTheme(): Theme {
  if (typeof document === "undefined") return DEFAULT_THEME;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(raw)) return raw;
  } catch {
    /* localStorage unavailable — fall back to the DOM class */
  }
  const c = document.documentElement.classList;
  if (c.contains("theme-dark")) return "dark";
  if (c.contains("theme-light")) return "light";
  if (c.contains("theme-astral")) return "astral";
  return DEFAULT_THEME;
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Lazy initialiser resolves the stored theme on the client, so the first
  // React render matches the painted theme (no flash).
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  // Keep the <html> class in sync with state — a pure external-system sync, so
  // the DOM is corrected if SSR painted the default before hydration resolved
  // the stored preference.
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyThemeClass(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore persistence failure */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
