'use client';
// ForceDecomposition slide — D3 breakdown of Fate/World/System contributions across the work.

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { SlidesData } from '@/lib/slides-data';
import { SlideShell, SlideCard } from './SlideShell';

/** Mean and population standard deviation of a series. Used to z-score each
 *  force against its OWN distribution so the chart shows how unusual each
 *  beat is per force, not absolute magnitude. Std floors at 1e-6 so a
 *  perfectly flat force still renders without dividing by zero. */
function meanStd(xs: number[]): { mean: number; std: number } {
  if (xs.length === 0) return { mean: 0, std: 1e-6 };
  let s = 0;
  for (const v of xs) s += v;
  const mean = s / xs.length;
  let v = 0;
  for (const x of xs) v += (x - mean) * (x - mean);
  const std = Math.sqrt(v / xs.length);
  return { mean, std: Math.max(std, 1e-6) };
}

export function ForceDecompositionSlide({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;

    const { width } = svgRef.current.getBoundingClientRect();
    const height = 300;
    const margin = { top: 20, right: 24, bottom: 36, left: 44 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const n = data.sceneCount;
    const raw = data.rawForces;

    const x = d3.scaleLinear().domain([0, n - 1]).range([0, w]);

    // Z-score each force against its OWN distribution — (x - mean) / std.
    // Shape is readable independent of absolute magnitude, and 0 reads as
    // "average for this force" while +/- shows how unusual the beat is.
    const fateStat = meanStd(raw.fate);
    const worldStat = meanStd(raw.world);
    const systemStat = meanStd(raw.system);

    const fateZ = raw.fate.map((v) => (v - fateStat.mean) / fateStat.std);
    const worldZ = raw.world.map((v) => (v - worldStat.mean) / worldStat.std);
    const systemZ = raw.system.map((v) => (v - systemStat.mean) / systemStat.std);

    // Symmetric domain around 0 — clamp to the largest observed magnitude so
    // outliers don't crush the typical shape, with a sensible floor at +/-3
    // so flat series still show a meaningful axis.
    const maxZ = Math.max(
      ...fateZ.map(Math.abs),
      ...worldZ.map(Math.abs),
      ...systemZ.map(Math.abs),
      3,
    );
    const y = d3.scaleLinear().domain([-maxZ * 1.05, maxZ * 1.05]).range([h, 0]);

    // Grid lines on the z-score scale. 0 line is the per-force average.
    const ticks = [-2, -1, 0, 1, 2];
    for (const t of ticks) {
      const isZero = t === 0;
      g.append('line').attr('x1', 0).attr('y1', y(t)).attr('x2', w).attr('y2', y(t))
        .attr('stroke', 'white').attr('stroke-opacity', isZero ? 0.18 : 0.06);
      g.append('text').attr('x', -8).attr('y', y(t) + 3)
        .attr('text-anchor', 'end').attr('fill', 'white').attr('fill-opacity', isZero ? 0.5 : 0.25)
        .attr('font-size', 9).attr('font-family', 'monospace')
        .text(t > 0 ? `+${t}σ` : t < 0 ? `${t}σ` : 'avg');
    }

    // Each force lives on its own z-score, plotted against the shared axis.
    const forces = [
      { data: systemZ, color: '#3B82F6', label: 'System' },
      { data: worldZ, color: '#22C55E', label: 'World' },
      { data: fateZ, color: '#EF4444', label: 'Fate' },
    ];

    const zeroY = y(0);
    for (const f of forces) {
      // Area fills from the 0 line (per-force average) so above-average and
      // below-average stretches read as positive / negative pulls.
      const area = d3.area<number>()
        .x((_, i) => x(i))
        .y0(zeroY)
        .y1((d) => y(d))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(f.data)
        .attr('d', area)
        .attr('fill', f.color)
        .attr('fill-opacity', 0.08);

      const line = d3.line<number>()
        .x((_, i) => x(i))
        .y((d) => y(d))
        .curve(d3.curveMonotoneX);

      const path = g.append('path')
        .datum(f.data)
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', f.color)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.8);

      // Draw animation
      const totalLength = (path.node() as SVGPathElement)?.getTotalLength() ?? 0;
      path.attr('stroke-dasharray', totalLength)
        .attr('stroke-dashoffset', totalLength)
        .transition().duration(1500).ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0);
    }

    // X axis
    const labelCount = Math.min(10, n);
    const step = Math.max(1, Math.floor(n / labelCount));
    for (let i = 0; i < n; i += step) {
      g.append('text').attr('x', x(i)).attr('y', h + 20)
        .attr('text-anchor', 'middle').attr('fill', 'white').attr('fill-opacity', 0.3)
        .attr('font-size', 9).attr('font-family', 'monospace').text(i + 1);
    }
  }, [data]);

  // Per-force mean and std for the legend annotations.
  const fateStat = meanStd(data.rawForces.fate);
  const worldStat = meanStd(data.rawForces.world);
  const systemStat = meanStd(data.rawForces.system);

  // Find crossover points where the leading force (in its own z-units)
  // shifts. "Leading" means "furthest above its own average" at that beat
  // — the force whose engine is firing hardest RELATIVE to itself.
  const crossovers: { idx: number; from: string; to: string }[] = [];
  let prevDom = '';
  for (let i = 0; i < data.sceneCount; i++) {
    const p = (data.rawForces.fate[i] - fateStat.mean) / fateStat.std;
    const c = (data.rawForces.world[i] - worldStat.mean) / worldStat.std;
    const k = (data.rawForces.system[i] - systemStat.mean) / systemStat.std;
    const dom = p >= c && p >= k ? 'Fate' : c >= p && c >= k ? 'World' : 'System';
    if (prevDom && dom !== prevDom) {
      crossovers.push({ idx: i, from: prevDom, to: dom });
    }
    prevDom = dom;
  }

  return (
    <SlideShell
      eyebrow="Forces · Decomposition"
      title="Force Decomposition"
      subtitle="Each force z-scored against its own distribution — the 0 line is each force's average, ±σ shows how unusual each beat is per force. Peaks and valleys read as interactions, independent of absolute magnitude."
      align="center"
      contentWidth="wide"
      footer={
        <div className="flex flex-col gap-3">
          {/* Legend — each force's own mean and std ship alongside its swatch */}
          <div className="flex items-center gap-6">
            {[
              { label: 'Fate', color: '#EF4444', stat: fateStat },
              { label: 'World', color: '#22C55E', stat: worldStat },
              { label: 'System', color: '#3B82F6', stat: systemStat },
            ].map((f) => (
              <span key={f.label} className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded" style={{ backgroundColor: f.color }} />
                <span style={{ color: f.color }}>{f.label}</span>
                <span className="text-text-dim/70 font-mono">
                  μ {f.stat.mean.toFixed(1)} · σ {f.stat.std.toFixed(1)}
                </span>
              </span>
            ))}
          </div>
          {crossovers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {crossovers.slice(0, 5).map((c, i) => (
                <span key={i} className="px-2 py-0.5 rounded bg-white/[0.03] border border-white/5">
                  Scene {c.idx + 1}: {c.from} &rarr; {c.to}
                </span>
              ))}
            </div>
          )}
        </div>
      }
    >
      <SlideCard>
        <svg ref={svgRef} className="w-full" style={{ height: 320 }} />
      </SlideCard>
    </SlideShell>
  );
}
