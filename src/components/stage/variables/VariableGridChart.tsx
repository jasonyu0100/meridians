'use client';

import { useMemo } from 'react';
import { categoryColor } from '@/lib/ai/variables';
import type { Variable } from '@/types/narrative';

interface Trace {
  id: string;
  name?: string;
  color: string;
  variables: Variable[];
}

interface Props {
  traces: Trace[];
  activeTraceId?: string | null;
  hoveredTraceId?: string | null;
  onHoverTrace?: (id: string | null) => void;
  onSelectTrace?: (id: string) => void;
}

const MAX_INTENSITY = 4;

/**
 * Small-multiples view: every trace gets its own mini-radar tile in a
 * responsive grid. Lets the user scan a cohort's signatures side-by-side
 * without the muddiness of an overlay.
 *
 * The active trace's tile is highlighted; clicking any tile promotes it
 * (caller wires `onSelectTrace` to the active-scenario state).
 *
 * Axes are computed from the union of all variables across all traces and
 * shared across every tile so the signatures are directly comparable
 * (same axes, same orientation).
 */
export default function VariableGridChart({
  traces,
  activeTraceId,
  hoveredTraceId,
  onHoverTrace,
  onSelectTrace,
}: Props) {
  // Build the union axis list — same logic as the full radar so tiles align.
  const axes = useMemo(() => {
    const seen = new Map<string, { name: string; category: string }>();
    for (const trace of traces) {
      for (const v of trace.variables) {
        const key = v.name.trim().toLowerCase();
        if (!seen.has(key)) seen.set(key, { name: v.name, category: v.category || 'general' });
      }
    }
    return Array.from(seen.entries())
      .map(([key, info]) => ({ key, ...info }))
      .sort((a, b) => {
        const cat = a.category.localeCompare(b.category);
        return cat !== 0 ? cat : a.name.localeCompare(b.name);
      });
  }, [traces]);

  if (axes.length === 0 || traces.length === 0) {
    return (
      <div className="text-[11px] text-text-dim italic px-3 py-4">No variables yet.</div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-2">
      {traces.map((trace) => (
        <MiniRadar
          key={trace.id}
          trace={trace}
          axes={axes}
          isActive={trace.id === activeTraceId}
          isHovered={trace.id === hoveredTraceId}
          dimmed={
            (activeTraceId != null || hoveredTraceId != null) &&
            trace.id !== activeTraceId &&
            trace.id !== hoveredTraceId
          }
          onHover={() => onHoverTrace?.(trace.id)}
          onUnhover={() => onHoverTrace?.(null)}
          onSelect={() => onSelectTrace?.(trace.id)}
        />
      ))}
    </div>
  );
}

// ── Mini radar tile ──────────────────────────────────────────────────────

function MiniRadar({
  trace,
  axes,
  isActive,
  isHovered,
  dimmed,
  onHover,
  onUnhover,
  onSelect,
}: {
  trace: Trace;
  axes: { key: string; name: string; category: string }[];
  isActive: boolean;
  isHovered: boolean;
  dimmed: boolean;
  onHover: () => void;
  onUnhover: () => void;
  onSelect: () => void;
}) {
  const W = 220;
  const H = 220;
  const cx = W / 2;
  const cy = H / 2;
  // Tile labels are stripped — names live in the header above; the radar
  // here is purely the signature shape. R uses most of the tile, with a
  // tight margin so polygons don't kiss the edge.
  const R = Math.min(W, H) / 2 - 18;

  const angleFor = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, axes.length);
  const pointAt = (i: number, intensity: number) => {
    const a = angleFor(i);
    const r = (intensity / MAX_INTENSITY) * R;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };

  const intensityMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of trace.variables) m.set(v.name.trim().toLowerCase(), v.intensity);
    return m;
  }, [trace.variables]);

  const ringLevels = [1, 2, 3, 4];
  const polygonPts = axes
    .map((axis, i) => {
      const intensity = intensityMap.get(axis.key) ?? 0;
      const [x, y] = pointAt(i, intensity);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // Tile chrome — accented border for the active tile, hover lift for the
  // rest. Dimmed tiles fade so the active/hovered one carries the scan.
  const borderClass = isActive
    ? 'border-white/40 bg-white/4'
    : isHovered
      ? 'border-white/20 bg-white/3'
      : 'border-white/8 bg-white/1';

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onUnhover}
      style={{ opacity: dimmed ? 0.45 : 1, transition: 'opacity 0.2s, border-color 0.2s, background 0.2s' }}
      className={`group flex flex-col gap-2 rounded-lg border ${borderClass} p-2 text-left cursor-pointer`}
    >
      <div className="flex items-center gap-1.5 min-w-0 px-1">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: trace.color }}
        />
        <span className="text-[11px] text-text-primary truncate flex-1">
          {trace.name ?? trace.id}
        </span>
        {isActive && (
          <span className="text-[8px] uppercase tracking-widest text-text-dim">active</span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto">
        {/* Grid rings */}
        {ringLevels.map((level) => {
          const pts = axes
            .map((_, i) => {
              const [x, y] = pointAt(i, level);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');
          return (
            <polygon
              key={level}
              points={pts}
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={0.8}
              strokeDasharray={level === MAX_INTENSITY ? undefined : '2,3'}
            />
          );
        })}
        {/* Axis spokes (faint) */}
        {axes.map((axis, i) => {
          const [ex, ey] = pointAt(i, MAX_INTENSITY);
          const cColor = categoryColor(axis.category);
          return (
            <line
              key={axis.key}
              x1={cx}
              y1={cy}
              x2={ex}
              y2={ey}
              stroke={cColor + '33'}
              strokeWidth={0.6}
            />
          );
        })}
        {/* The signature polygon */}
        <polygon
          points={polygonPts}
          fill={trace.color}
          fillOpacity={isActive ? 0.28 : isHovered ? 0.22 : 0.16}
          stroke={trace.color}
          strokeWidth={isActive ? 2.4 : 1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.95}
        />
        {/* Vertex dots */}
        {axes.map((axis, i) => {
          const intensity = intensityMap.get(axis.key) ?? 0;
          if (intensity === 0) return null;
          const [x, y] = pointAt(i, intensity);
          return (
            <circle
              key={axis.key}
              cx={x}
              cy={y}
              r={isActive ? 3 : 2.4}
              fill={trace.color}
              stroke="#0c0a14"
              strokeWidth={0.8}
            />
          );
        })}
      </svg>
    </button>
  );
}
