'use client';

/**
 * Shared chart primitives — the single source of truth for the app's inline
 * line charts. Two components live here:
 *
 *   - `Sparkline`        — the small KPI trend box (current value + line/area).
 *   - `TrajectoryChart`  — the probability-over-time multi-line chart used by
 *                          every belief surface (one polyline per outcome).
 *
 * The invariant that keeps them consistent across views: **a stroked SVG must
 * never scale its own stroke width.** `TrajectoryChart` enforces this by
 * measuring its container and setting the viewBox to the real pixel size (1:1
 * mapping, no distortion). `Sparkline` keeps `preserveAspectRatio="none"` for
 * the tiny stretched boxes but pins stroke width with `vectorEffect`. Per-view
 * copies of these used to drift on exactly this axis (a fixed viewBox scaled
 * "meet" thinned the lines; `preserveAspectRatio="none"` stretched them) — the
 * point of this module is that no caller sets those knobs by hand anymore.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

// ── Measured viewBox ────────────────────────────────────────────────────────

/** Observe a container and return its pixel size, so a chart's viewBox can map
 *  1:1 to pixels (strokes + geometry render undistorted at any width). */
export function useMeasuredViewBox(
  fallbackW = 720,
  fallbackH = 280,
): { ref: RefObject<HTMLDivElement | null>; W: number; H: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ W: fallbackW, H: fallbackH });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setDims({ W: Math.round(r.width), H: Math.round(r.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, W: dims.W, H: dims.H };
}

// ── Sparkline ─────────────────────────────────────────────────────────────

/** Tiny trend line (+ optional area fill) for KPI cards. Stretched to fill its
 *  box via `preserveAspectRatio="none"`, but stroke width is pinned with
 *  `vectorEffect="non-scaling-stroke"` so thickness is identical at any size. */
export function Sparkline({
  values,
  color,
  fill,
  yMin,
  yMax,
  strokeWidth = 1.2,
  className = 'h-10 w-full',
}: {
  values: number[];
  color: string;
  fill?: string;
  yMin?: number;
  yMax?: number;
  strokeWidth?: number;
  className?: string;
}) {
  if (values.length === 0) {
    return (
      <div className={`${className} flex items-center justify-center text-[9px] text-text-dim/60`}>
        no data
      </div>
    );
  }
  const W = 200;
  const H = 40;
  const pad = 2;
  const minY = yMin ?? Math.min(...values);
  const maxY = yMax ?? Math.max(...values);
  const range = Math.max(1e-9, maxY - minY);
  const n = values.length;
  const xAt = (i: number) => (n === 1 ? W / 2 : pad + (i / (n - 1)) * (W - pad * 2));
  const yAt = (v: number) => pad + (1 - (v - minY) / range) * (H - pad * 2);
  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${xAt(n - 1).toFixed(1)} ${H - pad} L ${xAt(0).toFixed(1)} ${H - pad} Z`;
  const last = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      {fill && <path d={areaPath} fill={fill} />}
      <path d={linePath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={xAt(n - 1)} cy={yAt(last)} r={1.6} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── TrajectoryChart ─────────────────────────────────────────────────────────

export type TrajPoint = { probs: number[] };

/** Probability-over-time chart: one polyline per outcome, y ∈ [0,1]. Measures
 *  its container for a 1:1 viewBox so stroke widths + geometry render the same
 *  in every belief surface. Domain views wrap this with their own colour-keying
 *  and axis labels; this owns sizing + stroke. */
export function TrajectoryChart({
  points,
  outcomeCount,
  colourOf,
  axes = false,
  nudgeTies = false,
  highlightIdx,
  endpointDots = false,
  xLeft,
  xRight,
  emptyProbs,
  emptyColourOf,
  className = 'w-full h-72',
}: {
  /** Per-step probability vectors (index k = outcome k). */
  points: TrajPoint[];
  outcomeCount: number;
  /** Hue for outcome index k. */
  colourOf: (k: number) => string;
  /** Render the % gridlines + axis labels (else a bare, full-bleed chart). */
  axes?: boolean;
  /** Nudge tied lines apart vertically so they don't collapse onto each other. */
  nudgeTies?: boolean;
  /** Emphasize one outcome (thicker + opaque, others dimmed). */
  highlightIdx?: number;
  endpointDots?: boolean;
  xLeft?: string;
  xRight?: string;
  /** When `points` is empty, draw flat dashed lines at this prior distribution. */
  emptyProbs?: number[];
  emptyColourOf?: (k: number) => string;
  /** Wrapper sizing — must give the chart a real width + height to measure. */
  className?: string;
}) {
  const { ref, W, H } = useMeasuredViewBox(720, 280);
  const PAD_L = axes ? 36 : 0;
  const PAD_R = axes ? 56 : 0;
  const PAD_T = axes ? 12 : 0;
  const PAD_B = axes ? 24 : 0;
  const plotW = Math.max(0, W - PAD_L - PAD_R);
  const plotH = Math.max(0, H - PAD_T - PAD_B);
  const yAt = (p: number) => PAD_T + (1 - p) * plotH;

  const grid = axes
    ? [0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={PAD_T + (1 - f) * plotH}
            y2={PAD_T + (1 - f) * plotH}
            stroke="var(--color-text-dim)"
            strokeWidth={0.5}
            opacity={0.18}
            strokeDasharray={f === 0 || f === 1 ? undefined : '2 4'}
            vectorEffect="non-scaling-stroke"
          />
          <text x={PAD_L - 6} y={PAD_T + (1 - f) * plotH + 3} textAnchor="end" className="text-[9px] tabular-nums" fill="#555">
            {Math.round(f * 100)}%
          </text>
        </g>
      ))
    : null;

  // Empty — thread/stream not yet priced. Flat dashed lines at the prior.
  if (points.length === 0) {
    const probs = emptyProbs ?? [];
    const cOf = emptyColourOf ?? colourOf;
    return (
      <div ref={ref} className={className}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full select-none">
          {grid}
          {probs.map((p, k) => {
            const off = nudgeTies ? (k - (probs.length - 1) / 2) * 3.5 : 0;
            const y = yAt(p) + off;
            return (
              <line key={k} x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke={cOf(k)} strokeWidth={1.5} strokeDasharray="3 4" opacity={0.5} vectorEffect="non-scaling-stroke" />
            );
          })}
        </svg>
      </div>
    );
  }

  const n = points.length;
  const xAt = (i: number) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const offset = (k: number) => (nudgeTies ? (k - (outcomeCount - 1) / 2) * 3.5 : 0);
  const lines = Array.from({ length: outcomeCount }, (_, k) => {
    const off = offset(k);
    const d =
      n === 1
        ? `M ${PAD_L} ${yAt(points[0].probs[k] ?? 0) + off} L ${W - PAD_R} ${yAt(points[0].probs[k] ?? 0) + off}`
        : points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(pt.probs[k] ?? 0) + off}`).join(' ');
    return { k, d };
  });
  const strokeFor = (k: number) => (highlightIdx === undefined ? 1.75 : k === highlightIdx ? 1.75 : 1.4);
  const opacityFor = (k: number) => (highlightIdx === undefined ? 0.85 : k === highlightIdx ? 1 : 0.5);

  return (
    <div ref={ref} className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full select-none">
        {grid}
        {lines.map(({ k, d }) => (
          <path key={k} d={d} fill="none" stroke={colourOf(k)} strokeWidth={strokeFor(k)} opacity={opacityFor(k)} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
        {endpointDots &&
          Array.from({ length: outcomeCount }, (_, k) => (
            <circle key={k} cx={xAt(n - 1)} cy={yAt(points[n - 1].probs[k] ?? 0) + offset(k)} r={2.5} fill={colourOf(k)} opacity={0.9} />
          ))}
        {axes && xLeft && (
          <text x={PAD_L} y={H - 4} className="text-[9px]" fill="#7c7c8a">{xLeft}</text>
        )}
        {axes && xRight && (
          <text x={W - PAD_R} y={H - 4} textAnchor="end" className="text-[9px]" fill="#555">{xRight}</text>
        )}
      </svg>
    </div>
  );
}
