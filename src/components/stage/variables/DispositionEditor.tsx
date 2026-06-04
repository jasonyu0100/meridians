'use client';
// DispositionEditor — editing rack for a scenario's variable activations (per-variable intensity levels).

import { useMemo, useState } from 'react';
import { categoryColor, VARIABLE_INTENSITY_LEVELS } from '@/lib/ai/variables';
import type { Variable } from '@/types/narrative';

interface Props {
  /** This scope's full variable set (Present per arc, or one scenario's
   *  own custom set). Each Variable carries its own intensity. */
  variables: Variable[];
  /** Optional pool of additional variables that are NOT in the active set
   *  but could plausibly be activated — typically variables from sibling
   *  directions in the same Compass cohort, or the arc's Present. Revealed
   *  by a "Show more" toggle. Deduplicated against `variables` by id and
   *  name (lowercased). When activated, the parent's `onChange` is called
   *  with the variable id; the parent is responsible for adding the full
   *  Variable to its scope's set. */
  pool?: Variable[];
  /** Accent colour for the active intensity highlight when categories
   *  aren't driving the colour. */
  color?: string;
  /** When true, each variable's accent inherits from its category. */
  colorByCategory?: boolean;
  readOnly?: boolean;
  onChange?: (variableId: string, intensity: number) => void;
  /** Called when a pool variable is activated. Receives the full Variable
   *  with the chosen intensity baked in. Parent is responsible for adding
   *  it to the active set. If omitted, pool reveal is disabled. */
  onAddFromPool?: (variable: Variable) => void;
  /** Force a single-column layout (categories stack vertically). Used when
   *  the editor sits in a narrow sidebar — the responsive grid would
   *  otherwise crush variable names into unreadable columns. */
  singleColumn?: boolean;
}

/**
 * Editable rack of intensity sliders, grouped by variable category. Works
 * uniformly for arc Present and for a single scenario's variable set —
 * the parent passes the right `variables` array.
 */
export default function DispositionEditor({
  variables,
  pool,
  color = '#a78bfa',
  colorByCategory = false,
  readOnly,
  onChange,
  onAddFromPool,
  singleColumn = false,
}: Props) {
  const gridClass = singleColumn
    ? 'grid grid-cols-1 gap-4'
    : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4';
  const [showPool, setShowPool] = useState(false);

  const activeIds = useMemo(() => new Set(variables.map((v) => v.id)), [variables]);
  const activeNames = useMemo(
    () => new Set(variables.map((v) => v.name.toLowerCase().trim())),
    [variables],
  );
  // Pool entries that aren't already in the active set. Dedupe by id + name
  // (case-insensitive) so sibling scenarios using the same variable under either
  // an id-match or name-match get filtered out.
  const filteredPool = useMemo(() => {
    if (!pool || pool.length === 0) return [];
    const seen = new Set<string>();
    const out: Variable[] = [];
    for (const v of pool) {
      const key = v.name.toLowerCase().trim();
      if (activeIds.has(v.id) || activeNames.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  }, [pool, activeIds, activeNames]);

  const grouped = useMemo(() => {
    const m = new Map<string, Variable[]>();
    for (const v of variables) {
      const cat = v.category || 'general';
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(v);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [variables]);

  const groupedPool = useMemo(() => {
    if (filteredPool.length === 0) return [] as [string, Variable[]][];
    const m = new Map<string, Variable[]>();
    for (const v of filteredPool) {
      const cat = v.category || 'general';
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(v);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredPool]);

  const canShowPool = !readOnly && !!onAddFromPool && filteredPool.length > 0;

  if (variables.length === 0 && filteredPool.length === 0) {
    return <div className="text-[11px] text-text-dim italic px-3 py-4">No variables in this set.</div>;
  }

  return (
    <div className="px-3 py-2 flex flex-col gap-3">
      {variables.length === 0 && (
        <div className="text-[11px] text-text-dim italic">No active variables. Use “Show more” below to draw from the cohort pool.</div>
      )}
      <div className={gridClass}>
      {grouped.map(([category, vars]) => {
        const catColor = colorByCategory ? categoryColor(category) : color;
        return (
          <section key={category}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: catColor }} />
              <span className="text-[9px] uppercase tracking-[0.15em] text-text-dim/70 font-mono">{category}</span>
              <span className="text-[9px] text-text-dim/50 font-mono ml-auto">
                {vars.filter((v) => v.intensity > 0).length}/{vars.length}
              </span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {vars.map((v) => {
                const active = v.intensity > 0;
                const accent = colorByCategory ? catColor : color;
                return (
                  <li
                    key={v.id}
                    className={`rounded border px-2.5 py-1.5 transition ${active ? 'bg-white/3' : 'border-white/6 bg-white/1'}`}
                    style={active ? { borderColor: accent + '4d' } : undefined}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span
                        className={`text-[11px] truncate ${active ? 'text-text-primary' : 'text-text-secondary'}`}
                        title={v.description}
                      >
                        {v.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {VARIABLE_INTENSITY_LEVELS.map((lvl) => {
                        const isActive = v.intensity === lvl.idx;
                        const Tag = readOnly ? 'div' : 'button';
                        return (
                          <Tag
                            key={lvl.idx}
                            onClick={readOnly ? undefined : () => onChange?.(v.id, lvl.idx)}
                            className={`flex-1 text-[9px] uppercase tracking-[0.15em] font-mono py-1 rounded text-center transition ${
                              isActive
                                ? 'text-text-primary'
                                : readOnly
                                  ? 'text-text-dim/30'
                                  : 'text-text-dim/50 hover:text-text-secondary hover:bg-white/5 cursor-pointer'
                            }`}
                            style={isActive ? { background: accent + '22', boxShadow: `0 0 0 1px ${accent}88` } : undefined}
                            title={lvl.desc}
                          >
                            {lvl.label}
                          </Tag>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      </div>

      {canShowPool && (
        <div className="border-t border-white/6 pt-2">
          <button
            type="button"
            onClick={() => setShowPool((p) => !p)}
            className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-text-dim hover:text-text-secondary font-mono transition"
          >
            <svg
              className={`w-2.5 h-2.5 transition-transform ${showPool ? 'rotate-90' : ''}`}
              viewBox="0 0 8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 1 L6 4 L2.5 7" />
            </svg>
            <span>{showPool ? 'Hide' : 'Show'} more · {filteredPool.length} unused</span>
          </button>
          {showPool && (
            <div className={`mt-2 ${gridClass}`}>
              {groupedPool.map(([category, vars]) => {
                const catColor = colorByCategory ? categoryColor(category) : color;
                return (
                  <section key={category}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="w-1.5 h-1.5 rounded-full opacity-50" style={{ background: catColor }} />
                      <span className="text-[9px] uppercase tracking-[0.15em] text-text-dim/50 font-mono">{category}</span>
                      <span className="text-[9px] text-text-dim/40 font-mono ml-auto">{vars.length}</span>
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {vars.map((v) => {
                        const accent = colorByCategory ? catColor : color;
                        return (
                          <li
                            key={v.id}
                            className="rounded border border-dashed border-white/10 bg-white/1 px-2.5 py-1.5 opacity-70 hover:opacity-100 transition"
                          >
                            <div className="flex items-baseline justify-between gap-2 mb-1">
                              <span
                                className="text-[11px] truncate text-text-secondary"
                                title={v.description}
                              >
                                {v.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-0.5">
                              {VARIABLE_INTENSITY_LEVELS.map((lvl) => {
                                if (lvl.idx === 0) {
                                  // Off-state placeholder for the inactive pool row — keeps
                                  // alignment with active variables but unclickable.
                                  return (
                                    <div
                                      key={lvl.idx}
                                      className="flex-1 text-[9px] uppercase tracking-[0.15em] font-mono py-1 rounded text-center text-text-dim/30"
                                    >
                                      {lvl.label}
                                    </div>
                                  );
                                }
                                return (
                                  <button
                                    key={lvl.idx}
                                    onClick={() => onAddFromPool?.({ ...v, intensity: lvl.idx })}
                                    className="flex-1 text-[9px] uppercase tracking-[0.15em] font-mono py-1 rounded text-center text-text-dim/50 hover:text-text-secondary hover:bg-white/5 cursor-pointer transition"
                                    style={{ outline: `1px dashed ${accent}33`, outlineOffset: '-1px' }}
                                    title={`Activate at ${lvl.desc}`}
                                  >
                                    {lvl.label}
                                  </button>
                                );
                              })}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
