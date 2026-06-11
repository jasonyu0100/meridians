'use client';
// ExperienceSparkline — smooth, value-coloured area line with a hover tooltip.
// The line colour follows the score band along x (red <70 → orange → light
// green → strong green) and the fill is a red→green vertical gradient, matching
// the narrative Score-by-arc graph. Used by the Experience scorecard + tab.

import { useId, useRef, useState } from 'react';

export function expBandColor(v: number): string {
  if (v >= 90) return '#22c55e'; // strong green
  if (v >= 80) return '#a3e635'; // light green
  if (v >= 70) return '#f59e0b'; // orange
  return '#f87171';              // red
}

/** Catmull-Rom → cubic-bezier smoothing through the points. */
export function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

export function ExperienceSparkline({
  values,
  labels,
  height = 80,
  onPick,
}: {
  values: number[];
  labels?: string[];
  height?: number;
  /** Click a point — receives its index. */
  onPick?: (index: number) => void;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Stable, unique gradient ids per instance (avoids cross-instance collisions).
  const gid = useId().replace(/:/g, '');

  if (values.length < 2) return null;
  const W = 340, H = height, PAD = { top: 14, right: 10, bottom: 8, left: 22 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;
  const seg = cw / (values.length - 1);
  const x = (i: number) => PAD.left + i * seg;
  const y = (v: number) => PAD.top + ch - (Math.max(0, Math.min(100, v)) / 100) * ch;
  const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
  const linePath = smoothPath(pts);
  const areaPath = `${linePath} L${x(values.length - 1).toFixed(2)},${PAD.top + ch} L${x(0).toFixed(2)},${PAD.top + ch} Z`;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vbX = ((e.clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(values.length - 1, Math.round((vbX - PAD.left) / seg))));
  };

  return (
    <svg
      ref={ref}
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      className="overflow-visible"
      style={{ cursor: onPick ? 'pointer' : 'default' }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      onClick={() => { if (onPick && hover !== null) onPick(hover); }}
    >
      <defs>
        {/* line colour follows the value band along x */}
        <linearGradient id={`${gid}-line`} x1="0" y1="0" x2="1" y2="0">
          {values.map((v, i) => (
            <stop key={i} offset={`${(i / (values.length - 1)) * 100}%`} stopColor={expBandColor(v)} />
          ))}
        </linearGradient>
        {/* red→green vertical band gradient under the curve */}
        <linearGradient id={`${gid}-area`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.28" />
          <stop offset="35%" stopColor="#a3e635" stopOpacity="0.18" />
          <stop offset="65%" stopColor="#f59e0b" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#f87171" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <text x={PAD.left - 4} y={y(g) + 3} textAnchor="end" fontSize="7" fill="rgba(255,255,255,0.3)" fontFamily="monospace">{g}</text>
        </g>
      ))}
      <path d={areaPath} fill={`url(#${gid}-area)`} />
      <path d={linePath} fill="none" stroke={`url(#${gid}-line)`} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {hover !== null && (
        <g pointerEvents="none">
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ch} stroke="rgba(255,255,255,0.22)" strokeWidth="0.75" strokeDasharray="2 2" />
          <circle cx={x(hover)} cy={y(values[hover])} r="2.8" fill={expBandColor(values[hover])} />
          <text
            x={Math.max(PAD.left + 10, Math.min(W - PAD.right - 10, x(hover)))}
            y={Math.max(PAD.top - 3, y(values[hover]) - 6)}
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fontFamily="monospace"
            fill={expBandColor(values[hover])}
          >
            {values[hover]}{labels && labels[hover] ? `  ${labels[hover].length > 18 ? labels[hover].slice(0, 17) + '…' : labels[hover]}` : ''}
          </text>
        </g>
      )}
    </svg>
  );
}
