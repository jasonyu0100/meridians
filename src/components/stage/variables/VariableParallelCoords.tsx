'use client';
// VariableParallelCoords — parallel-coordinates plot of scenarios as paths across the shared variable pool.

import { useMemo } from 'react';
import { categoryColor } from '@/lib/ai/variables';
import type { Variable } from '@/types/narrative';

interface Trace {
  id: string;
  color: string;
  variables: Variable[];
}

interface Props {
  traces: Trace[];
  /** Currently focused trace — drawn at full weight, others dimmed. */
  activeTraceId?: string | null;
  /** Hover-isolation override. */
  hoveredTraceId?: string | null;
  onHoverTrace?: (id: string | null) => void;
  height?: number;
}

/**
 * Parallel-coordinates view of variable dispositions. Each trace brings its
 * OWN variable set (no shared catalogue) — we compute the union across all
 * traces, then each trace's polyline visits the union axes, with intensity 0
 * (off) where its set didn't include that variable.
 *
 * Variables are keyed by name (case-insensitive) so two traces with the
 * same-named variable align on the same axis. The category of the first trace
 * to mention a name wins for axis colouring.
 */
export default function VariableParallelCoords({
  traces,
  activeTraceId,
  hoveredTraceId,
  onHoverTrace,
  height = 500,
}: Props) {
  // Build the union axis list. Key by lowercased name so different ids with
  // the same display name (which can happen across independently-generated
  // sets) collapse onto one axis.
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

  // Per-trace lookup table for intensity by axis key.
  const traceIntensityMaps = useMemo(() => {
    return traces.map((t) => {
      const m = new Map<string, number>();
      for (const v of t.variables) m.set(v.name.trim().toLowerCase(), v.intensity);
      return m;
    });
  }, [traces]);

  const W = 1100;
  const PAD_L = 8;
  const PAD_R = 8;
  // Generous top padding gives the rotated axis labels room to extend
  // upward without clipping the SVG. The label baseline sits at
  // (axisX, PAD_T - 12) and rotates -28° outward, so the vertical extent
  // depends on label length × sin(28).
  const PAD_T = 160;
  const PAD_B = 40;
  // Reserve a left column for the intensity (Y-axis) labels so the
  // variable axes start beyond them.
  const Y_LABEL_W = 80;

  const axisXs = useMemo(() => {
    if (axes.length === 0) return [];
    const chartLeft = PAD_L + Y_LABEL_W;
    const chartRight = W - PAD_R;
    const availableSpan = chartRight - chartLeft;
    if (axes.length === 1) return [chartLeft + availableSpan / 2];
    const AXIS_SPACING = 120;
    const totalSpan = AXIS_SPACING * (axes.length - 1);
    const useSpan = Math.min(totalSpan, availableSpan);
    const startX = chartLeft + (availableSpan - useSpan) / 2;
    return axes.map((_, i) => startX + useSpan * (i / (axes.length - 1)));
  }, [axes]);

  const yScale = (intensity: number) => {
    const t = intensity / 4;
    return height - PAD_B - t * (height - PAD_T - PAD_B);
  };

  if (axes.length === 0) {
    return (
      <div className="text-[11px] text-text-dim italic px-3 py-4">
        No variables yet.
      </div>
    );
  }

  // Y-axis labels — intensity 0–4 mapped to the canonical scale words. The
  // same vocabulary used in the DispositionEditor buttons, so the parallel
  // chart reads at a glance ("this scenario is Strong on dial X").
  const INTENSITY_LABELS = ['—', 'Weak', 'Mild', 'Strong', 'Extreme'];

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="block w-full h-auto">
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1={PAD_L + Y_LABEL_W} x2={W - PAD_R} y1={yScale(i)} y2={yScale(i)} stroke="rgba(255,255,255,0.04)" strokeDasharray={i === 0 ? undefined : '2,4'} />
          {/* Y-axis tick label on the left edge — anchored end so labels
              extend leftward from the chart start. */}
          <text
            x={PAD_L + Y_LABEL_W - 8}
            y={yScale(i)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={13}
            fill="rgba(232,232,232,0.5)"
            fontFamily="var(--font-mono), monospace"
            style={{ fontWeight: 500, letterSpacing: '0.05em' }}
          >
            {INTENSITY_LABELS[i].toUpperCase()}
          </text>
        </g>
      ))}

      {axes.map((axis, i) => {
        const x = axisXs[i];
        const cColor = categoryColor(axis.category);
        return (
          <g key={axis.key}>
            <line x1={x} x2={x} y1={yScale(0)} y2={yScale(4)} stroke={cColor + '55'} strokeWidth={1.4} />
            {[0, 1, 2, 3, 4].map((lvl) => (
              <circle key={lvl} cx={x} cy={yScale(lvl)} r={2} fill={cColor + 'aa'} />
            ))}
            {/* Rotated label: anchored at the axis with -28° upward slant
                so long names extend toward the top-left without
                colliding with neighbouring axes. */}
            <g transform={`translate(${x}, ${PAD_T - 12}) rotate(-28)`}>
              <text
                fontSize={16}
                fill={cColor}
                fontFamily="var(--font-mono), monospace"
                style={{ fontWeight: 500 }}
              >
                {axis.name}
              </text>
            </g>
          </g>
        );
      })}

      {traces.map((trace, traceIdx) => {
        const isActive = trace.id === activeTraceId;
        const isHovered = trace.id === hoveredTraceId;
        const dimmed = (activeTraceId != null || hoveredTraceId != null) && !isActive && !isHovered;
        const intensityMap = traceIntensityMaps[traceIdx];
        const points: string[] = [];
        for (let i = 0; i < axes.length; i++) {
          const intensity = intensityMap.get(axes[i].key) ?? 0;
          points.push(`${axisXs[i].toFixed(1)} ${yScale(intensity).toFixed(1)}`);
        }
        const d = 'M ' + points.join(' L ');
        return (
          <g
            key={trace.id}
            style={{ transition: 'opacity 0.2s' }}
            opacity={dimmed ? 0.16 : 1}
            onMouseEnter={() => onHoverTrace?.(trace.id)}
            onMouseLeave={() => onHoverTrace?.(null)}
          >
            <path d={d} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer' }} />
            <path
              d={d}
              fill="none"
              stroke={trace.color}
              strokeWidth={isActive ? 2.6 : isHovered ? 2.2 : 1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={isActive ? 1 : 0.78}
            />
            {axes.map((axis, i) => {
              const intensity = intensityMap.get(axis.key) ?? 0;
              if (intensity === 0) return null;
              return (
                <circle
                  key={axis.key}
                  cx={axisXs[i]}
                  cy={yScale(intensity)}
                  r={isActive ? 3.2 : 2.4}
                  fill={trace.color}
                  stroke="#0c0a14"
                  strokeWidth={isActive ? 1.4 : 0.8}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
