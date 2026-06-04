"use client";
// BranchScopeControl — picker for the context scope (time horizon) a branch operation sees.

import { useEffect, useMemo, useState } from "react";
import type { BranchScope } from "@/lib/ai/branch-chat";
import type { ScopeMode, ScopeState } from "@/types/narrative";

/**
 * Branch scope control — mode chips + per-branch dual-handle range slider.
 *
 * The control is the lab's *variable widget*. v1 uses it to scope analytical
 * chat; v2 will reuse it as a controlled-variable axis in experiments. State
 * shape (mode + per-branch ranges) is intentionally serializable and lives in
 * types/narrative.ts so it can be persisted on branch-chat threads.
 */

export type { ScopeMode, ScopeState };

export const DEFAULT_SCOPE_STATE: ScopeState = {
  mode: "post-divergence",
  lastN: 5,
  custom: {},
};

export type BranchSequenceInfo = {
  branchId: string;
  name: string;
  /** Stable colour for the branch. */
  color: string;
  /** Total number of resolved entries on this branch. */
  length: number;
};

/** Compute the active per-branch scopes from the current state + branch info.
 *  Used by both the control's UI and branch-chat when dispatching turns. */
export function resolveScopes(
  state: ScopeState,
  branches: BranchSequenceInfo[],
  /** Index of the first divergent entry (1-based). For 1 branch this is just 1. */
  divergenceStart: number,
): BranchScope[] {
  return branches.map((b) => {
    if (b.length === 0) return { branchId: b.branchId, start: 0, end: 0 };
    switch (state.mode) {
      case "all":
        return { branchId: b.branchId, start: 1, end: b.length };
      case "last": {
        const start = Math.max(1, b.length - state.lastN + 1);
        return { branchId: b.branchId, start, end: b.length };
      }
      case "post-divergence":
        return {
          branchId: b.branchId,
          start: Math.min(divergenceStart, b.length),
          end: b.length,
        };
      case "custom": {
        const c = state.custom[b.branchId];
        if (c) return { branchId: b.branchId, start: c.start, end: c.end };
        // Fallback when custom state is missing — full branch.
        return { branchId: b.branchId, start: 1, end: b.length };
      }
    }
  });
}

const MODE_LABELS: Record<ScopeMode, string> = {
  all: "All",
  last: "Last N",
  "post-divergence": "Post-divergence",
  custom: "Custom",
};

const MODE_ORDER: ScopeMode[] = ["all", "last", "post-divergence", "custom"];

type Props = {
  branches: BranchSequenceInfo[];
  divergenceStart: number;
  state: ScopeState;
  onChange: (next: ScopeState) => void;
};

/** Shared resolution + handler logic between the chips and sliders surfaces.
 *  Both consume the same `(state, branches, divergence) → onChange` shape. */
function useScopeHandlers(
  branches: BranchSequenceInfo[],
  divergenceStart: number,
  state: ScopeState,
  onChange: (next: ScopeState) => void,
) {
  const resolved = useMemo(
    () => resolveScopes(state, branches, divergenceStart),
    [state, branches, divergenceStart],
  );

  // When the user enters custom mode, seed `custom` from the currently
  // resolved windows so they edit *from* the current state, not from scratch.
  function handleModeChange(next: ScopeMode) {
    if (next === "custom" && Object.keys(state.custom).length === 0) {
      const seeded: Record<string, { start: number; end: number }> = {};
      resolved.forEach((s) => {
        seeded[s.branchId] = { start: s.start || 1, end: s.end || 1 };
      });
      onChange({ ...state, mode: next, custom: seeded });
    } else {
      onChange({ ...state, mode: next });
    }
  }

  function handleLastNChange(n: number) {
    const clamped = Math.max(1, Math.min(50, Math.floor(n)));
    onChange({ ...state, lastN: clamped });
  }

  function handleRangeChange(branchId: string, range: { start: number; end: number }) {
    onChange({
      ...state,
      mode: "custom",
      custom: { ...state.custom, [branchId]: range },
    });
  }

  return { resolved, handleModeChange, handleLastNChange, handleRangeChange };
}

/** Inline scope-chips row. Designed to sit alongside other controls (e.g.
 *  the thread picker) — no outer padding or border. Renders the SCOPE label,
 *  mode chips, the Last-N input, and a right-aligned summary line. */
export function BranchScopeChips({
  branches,
  divergenceStart,
  state,
  onChange,
  showLabel = true,
  showSummary = true,
}: Props & { showLabel?: boolean; showSummary?: boolean }) {
  const { resolved, handleModeChange, handleLastNChange } = useScopeHandlers(
    branches,
    divergenceStart,
    state,
    onChange,
  );
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {showLabel && (
        <span className="text-[10px] uppercase tracking-widest text-text-dim/70 font-mono">
          Scope
        </span>
      )}
      <div className="flex items-center gap-0.5 bg-white/5 border border-white/8 rounded-md p-0.5">
        {MODE_ORDER.map((m) => (
          <button
            key={m}
            onClick={() => handleModeChange(m)}
            className={`text-[11.5px] font-medium px-2.5 py-1 rounded transition-colors ${
              state.mode === m
                ? "bg-white/18 text-text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                : "text-text-dim hover:text-text-primary hover:bg-white/4"
            }`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
      {state.mode === "last" && (
        <div className="flex items-center gap-1.5 text-[11px] text-text-dim">
          <span>N =</span>
          <input
            type="number"
            min={1}
            max={50}
            value={state.lastN}
            onChange={(e) => handleLastNChange(Number(e.target.value))}
            className="w-12 bg-white/4 border border-white/8 rounded px-1.5 py-0.5 text-text-primary outline-none focus:border-white/20"
          />
        </div>
      )}
      {showSummary && (
        <>
          <div className="flex-1" />
          <span className="text-[10px] text-text-dim/60 font-mono tabular-nums">
            {summarizeScopes(resolved)}
          </span>
        </>
      )}
    </div>
  );
}

/** Per-branch dual-handle slider stack. Renders only when `state.mode ===
 *  'custom'`. Returns null otherwise so the parent can render it
 *  unconditionally without conditional padding/border logic. */
export function BranchScopeSliders({
  branches,
  divergenceStart,
  state,
  onChange,
}: Props) {
  const { resolved, handleRangeChange } = useScopeHandlers(
    branches,
    divergenceStart,
    state,
    onChange,
  );
  if (state.mode !== "custom") return null;
  return (
    <div className="flex flex-col gap-1.5">
      {branches.map((b, i) => {
        const r = resolved[i] ?? { start: 1, end: b.length };
        return (
          <BranchRangeSlider
            key={b.branchId}
            name={b.name}
            color={b.color}
            length={b.length}
            start={r.start}
            end={r.end}
            onChange={(range) => handleRangeChange(b.branchId, range)}
          />
        );
      })}
    </div>
  );
}

/** Composed widget for callers that want chips + sliders in one block.
 *  Equivalent to stacking BranchScopeChips above BranchScopeSliders. */
export function BranchScopeControl(props: Props) {
  return (
    <div className="flex flex-col gap-2">
      <BranchScopeChips {...props} />
      <BranchScopeSliders {...props} />
    </div>
  );
}

function summarizeScopes(scopes: BranchScope[]): string {
  if (scopes.length === 0) return "";
  const total = scopes.reduce((acc, s) => acc + Math.max(0, s.end - s.start + 1), 0);
  return `${scopes.length} branch${scopes.length === 1 ? "" : "es"} · ${total} entries in scope`;
}

// ── Dual-handle range slider ────────────────────────────────────────────────

function BranchRangeSlider({
  name,
  color,
  length,
  start,
  end,
  onChange,
}: {
  name: string;
  color: string;
  length: number;
  start: number;
  end: number;
  onChange: (range: { start: number; end: number }) => void;
}) {
  // Local state during drag — committed on release.
  const [localStart, setLocalStart] = useState(start);
  const [localEnd, setLocalEnd] = useState(end);

  // Re-sync when external state changes (e.g. mode switch reseeded custom).
  useEffect(() => {
    setLocalStart(start);
    setLocalEnd(end);
  }, [start, end]);

  const max = Math.max(1, length);
  const empty = length === 0;

  function commit(s: number, e: number) {
    const clampedS = Math.max(1, Math.min(s, max));
    const clampedE = Math.max(clampedS, Math.min(e, max));
    onChange({ start: clampedS, end: clampedE });
  }

  return (
    <div className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-white/3 transition-colors">
      <div className="w-24 shrink-0 flex items-center gap-1.5 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-[11px] text-text-secondary truncate">{name}</span>
      </div>

      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-[10px] text-text-dim/60 font-mono tabular-nums w-6 text-right shrink-0">
          {empty ? "—" : localStart}
        </span>
        <div className="relative flex-1 h-5">
          {/* Track */}
          <div className="absolute inset-y-1/2 -translate-y-1/2 left-0 right-0 h-0.5 bg-white/8 rounded-full" />
          {/* Selected segment */}
          {!empty && (
            <div
              className="absolute inset-y-1/2 -translate-y-1/2 h-0.5 rounded-full"
              style={{
                left: `${((localStart - 1) / Math.max(1, max - 1)) * 100}%`,
                right: `${(1 - (localEnd - 1) / Math.max(1, max - 1)) * 100}%`,
                background: color,
                opacity: 0.7,
              }}
            />
          )}
          {/* Start handle */}
          <input
            type="range"
            min={1}
            max={max}
            value={localStart}
            disabled={empty}
            onChange={(e) => {
              const v = Math.min(Number(e.target.value), localEnd);
              setLocalStart(v);
            }}
            onMouseUp={() => commit(localStart, localEnd)}
            onTouchEnd={() => commit(localStart, localEnd)}
            onKeyUp={() => commit(localStart, localEnd)}
            className="dual-range-input absolute inset-0 w-full appearance-none bg-transparent pointer-events-auto"
            style={{ zIndex: 2 }}
            aria-label={`${name} start`}
          />
          {/* End handle */}
          <input
            type="range"
            min={1}
            max={max}
            value={localEnd}
            disabled={empty}
            onChange={(e) => {
              const v = Math.max(Number(e.target.value), localStart);
              setLocalEnd(v);
            }}
            onMouseUp={() => commit(localStart, localEnd)}
            onTouchEnd={() => commit(localStart, localEnd)}
            onKeyUp={() => commit(localStart, localEnd)}
            className="dual-range-input absolute inset-0 w-full appearance-none bg-transparent pointer-events-auto"
            style={{ zIndex: 3 }}
            aria-label={`${name} end`}
          />
        </div>
        <span className="text-[10px] text-text-dim/60 font-mono tabular-nums w-6 shrink-0">
          {empty ? "—" : localEnd}
        </span>
      </div>

      <span className="text-[10px] text-text-dim/50 font-mono w-14 text-right shrink-0">
        of {length}
      </span>

      {/* Slider thumb styling — both handles share visual language; second
          handle's pointer-events stack on top so the right edge is grabbable
          even when the two handles overlap. */}
      <style jsx>{`
        .dual-range-input::-webkit-slider-thumb {
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: ${color};
          border: 2px solid rgba(0, 0, 0, 0.55);
          cursor: pointer;
          pointer-events: auto;
          margin-top: 0;
        }
        .dual-range-input::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: ${color};
          border: 2px solid rgba(0, 0, 0, 0.55);
          cursor: pointer;
          pointer-events: auto;
        }
        .dual-range-input::-webkit-slider-runnable-track {
          background: transparent;
          height: 2px;
        }
        .dual-range-input::-moz-range-track {
          background: transparent;
          height: 2px;
        }
        .dual-range-input {
          pointer-events: none;
        }
        .dual-range-input::-webkit-slider-thumb {
          pointer-events: auto;
        }
      `}</style>
    </div>
  );
}
