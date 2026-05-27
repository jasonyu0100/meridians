'use client';

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

// Wide viewBox (~2:1) so the chart renders horizontal-ish and labels at
// the left/right have plenty of room to extend outward without clipping
// the polygon or the container. With `w-full h-auto`, the SVG width fills
// the container and the height scales proportionally to this aspect.
const W = 1800;
const DEFAULT_H = 900;
const MAX_INTENSITY = 4;

/**
 * Radar (spider) chart of variable dispositions. Each variable becomes an
 * axis radiating from center; intensity (0–4) plots as distance along that
 * axis; a trace's polygon is its visual signature.
 *
 * Single trace (Present) reads as one signature shape; multiple traces
 * (Compass cohort) overlay so coordination signatures can be compared at a
 * glance — what makes one direction distinct from its peers becomes the
 * shape difference.
 *
 * Same trace-key/category conventions as the parallel-coords view it
 * replaces: axes keyed by lowercased name so independently-generated sets
 * collapse onto one axis, category of the first trace to mention a name
 * wins for axis colouring.
 */
export default function VariableRadarChart({
  traces,
  activeTraceId,
  hoveredTraceId,
  onHoverTrace,
  height = DEFAULT_H,
}: Props) {
  // Build the union axis list. Sort by category, then by name.
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
  const traceIntensityMaps = useMemo(
    () =>
      traces.map((t) => {
        const m = new Map<string, number>();
        for (const v of t.variables) m.set(v.name.trim().toLowerCase(), v.intensity);
        return m;
      }),
    [traces],
  );

  // Geometry. Center the radar; reserve a label ring outside the max
  // intensity radius so long names don't collide with the polygon edges.
  // R is driven by the shorter dimension (height) so the chart stays
  // square; the wider viewBox gives the labels room to extend horizontally
  // without truncating.
  const cx = W / 2;
  const cy = height / 2;
  // Leave generous margin: the polygon must fit comfortably between the
  // label ring and the viewBox edges, with room left over so the labels
  // themselves never collide with the polygon or get cut off.
  const R = height / 2 - 90;
  const LABEL_R = R + 50;

  // Start at top (-PI/2) and walk clockwise.
  const angleFor = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, axes.length);
  const pointAt = (i: number, intensity: number) => {
    const a = angleFor(i);
    const r = (intensity / MAX_INTENSITY) * R;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };

  if (axes.length === 0) {
    return (
      <div className="text-[11px] text-text-dim italic px-3 py-4">No variables yet.</div>
    );
  }

  // Concentric grid rings at intensity 1, 2, 3, 4. Each is a regular
  // polygon (not a circle) so the geometry matches the polygon traces
  // — visually you can read off "is the trace at intensity 3 on this
  // axis?" against the ring.
  const ringLevels = [1, 2, 3, 4];
  const ringPolygons = ringLevels.map((level) => {
    const pts = axes
      .map((_, i) => {
        const [x, y] = pointAt(i, level);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return { level, pts };
  });

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="block w-full h-auto">
      {/* Grid rings — faint, dashed except the outer ring */}
      {ringPolygons.map(({ level, pts }) => (
        <polygon
          key={level}
          points={pts}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
          strokeDasharray={level === MAX_INTENSITY ? undefined : '2,4'}
        />
      ))}

      {/* Axis spokes + labels */}
      {axes.map((axis, i) => {
        const [ex, ey] = pointAt(i, MAX_INTENSITY);
        const a = angleFor(i);
        const lx = cx + LABEL_R * Math.cos(a);
        const ly = cy + LABEL_R * Math.sin(a);
        const cColor = categoryColor(axis.category);
        // Anchor labels relative to angle so text always reads outward.
        const cosA = Math.cos(a);
        const anchor: 'start' | 'middle' | 'end' =
          cosA > 0.3 ? 'start' : cosA < -0.3 ? 'end' : 'middle';
        return (
          <g key={axis.key}>
            <line
              x1={cx}
              y1={cy}
              x2={ex}
              y2={ey}
              stroke={cColor + '55'}
              strokeWidth={1.5}
            />
            {/* Intensity tick dots along the spoke */}
            {ringLevels.map((lvl) => {
              const [tx, ty] = pointAt(i, lvl);
              return (
                <circle
                  key={lvl}
                  cx={tx}
                  cy={ty}
                  r={2}
                  fill={cColor + 'aa'}
                />
              );
            })}
            <text
              x={lx}
              y={ly}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={18}
              fill={cColor}
              fontFamily="var(--font-mono), monospace"
              style={{ fontWeight: 500 }}
            >
              {axis.name}
            </text>
          </g>
        );
      })}

      {/* Traces */}
      {traces.map((trace, traceIdx) => {
        const isActive = trace.id === activeTraceId;
        const isHovered = trace.id === hoveredTraceId;
        const dimmed =
          (activeTraceId != null || hoveredTraceId != null) && !isActive && !isHovered;
        const intensityMap = traceIntensityMaps[traceIdx];

        const points = axes.map((axis, i) => {
          const intensity = intensityMap.get(axis.key) ?? 0;
          const [x, y] = pointAt(i, intensity);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        const polygonPts = points.join(' ');

        // Single trace (or only one of many is in focus): fill the
        // signature so the shape reads as a body, not just an outline.
        // Multi-trace overlay defaults to outline-only so the shapes don't
        // muddy each other.
        const isSolo = traces.length === 1 || isActive || isHovered;
        const fillOpacity = isSolo ? 0.18 : 0;
        const strokeWidth = isActive ? 4 : isHovered ? 3.4 : 2.4;
        const strokeOpacity = isActive ? 1 : isHovered ? 1 : 0.78;

        return (
          <g
            key={trace.id}
            style={{ transition: 'opacity 0.2s' }}
            opacity={dimmed ? 0.16 : 1}
            onMouseEnter={() => onHoverTrace?.(trace.id)}
            onMouseLeave={() => onHoverTrace?.(null)}
          >
            {/* Wide invisible hit polygon for easier hover */}
            <polygon
              points={polygonPts}
              fill="transparent"
              stroke="transparent"
              strokeWidth={14}
              style={{ cursor: 'pointer' }}
            />
            <polygon
              points={polygonPts}
              fill={trace.color}
              fillOpacity={fillOpacity}
              stroke={trace.color}
              strokeWidth={strokeWidth}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={strokeOpacity}
            />
            {/* Vertex dots for non-zero intensities */}
            {axes.map((axis, i) => {
              const intensity = intensityMap.get(axis.key) ?? 0;
              if (intensity === 0) return null;
              const [x, y] = pointAt(i, intensity);
              return (
                <circle
                  key={axis.key}
                  cx={x}
                  cy={y}
                  r={isActive ? 6 : 4.5}
                  fill={trace.color}
                  stroke="#0c0a14"
                  strokeWidth={isActive ? 2 : 1.2}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
