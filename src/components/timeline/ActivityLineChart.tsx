'use client';
// ActivityLineChart — D3 line chart of per-scene Activity (weighted force aggregate) over the timeline.

import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import type { ActivityPoint } from '@/lib/forces/narrative-utils';
import type { ChartStyle } from './ForceLineChart';

// Orange above the zero line = high-activity scenes; light blue below =
// low-activity stretches. Same palette as EvalBar so the two read as
// one instrument.
const ACTIVITY_COLOR = '#F59E0B'; // orange — above-zero (high-activity)
const PEAK_COLOR = '#FCD34D';
const LOW_ACTIVITY_COLOR = '#93C5FD';   // light blue — below-zero (low-activity)

const CURVE_FNS = {
  smooth: d3.curveMonotoneX,
  linear: d3.curveLinear,
  step: d3.curveStepAfter,
};

type ActivityLineChartProps = {
  activity: ActivityPoint[];
  currentIndex: number;
  windowStart?: number;
  windowEnd?: number;
  raw?: boolean;
  style?: ChartStyle;
  average?: number;
};

export default function ActivityLineChart({
  activity,
  currentIndex,
  windowStart,
  windowEnd,
  raw,
  style,
  average,
}: ActivityLineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 200, height: 60 });

  const showArea = style?.showArea ?? true;
  const showWindow = style?.showWindow ?? true;
  const curveFn = CURVE_FNS[style?.curve ?? 'smooth'];

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) setDims({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (activity.length === 0) return;

    const { width, height } = dims;

    const xScale = d3.scaleLinear()
      .domain([0, Math.max(activity.length - 1, 1)])
      .range([0, width]);

    // Percentile-clipped domain so the chart isn't visually dominated by a
    // handful of extreme scenes. Values outside the clipped range are clamped
    // to the chart edge and marked with overflow ticks.
    const allValues = activity.flatMap((e) => [e.smoothed, e.macroTrend]);
    const absSorted = allValues.map(Math.abs).sort((a, b) => a - b);
    const pIdx = Math.max(0, Math.floor(absSorted.length * 0.95) - 1);
    const clipAbs = Math.max(absSorted[pIdx] ?? 0.5, 0.5);
    const trueAbs = absSorted.at(-1) ?? clipAbs;
    const hasOverflow = trueAbs > clipAbs * 1.05;
    const yScale = d3.scaleLinear()
      .domain([-clipAbs * 1.15, clipAbs * 1.15])
      .range([height, 0])
      .clamp(true);

    const zeroY = yScale(0);

    // Zero line
    svg.append('line')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', zeroY).attr('y2', zeroY)
      .attr('stroke', '#FFFFFF').attr('stroke-width', 0.5).attr('opacity', 0.12);

    // Window highlight
    if (showWindow && windowStart != null && windowEnd != null && activity.length > 1) {
      const wx1 = xScale(windowStart);
      const wx2 = xScale(windowEnd);
      svg.append('rect')
        .attr('x', wx1).attr('y', 0)
        .attr('width', Math.max(wx2 - wx1, 1)).attr('height', height)
        .attr('fill', ACTIVITY_COLOR).attr('opacity', 0.06);
      svg.append('line')
        .attr('x1', wx1).attr('x2', wx1)
        .attr('y1', 0).attr('y2', height)
        .attr('stroke', ACTIVITY_COLOR).attr('stroke-width', 0.5).attr('opacity', 0.3);
    }

    // High-activity region (above zero) — orange fill, matches EvalBar.
    // Augmented data inserts interpolated zero-crossings between adjacent
    // samples so the orange/blue regions clip cleanly at y=0 instead of
    // dropping vertically at scene vertices.
    if (showArea) {
      type ActivitySample = { x: number; v: number };
      const augmented: ActivitySample[] = [];
      for (let i = 0; i < activity.length; i++) {
        const e = activity[i];
        augmented.push({ x: xScale(e.index), v: e.smoothed });
        if (i < activity.length - 1) {
          const a = e.smoothed;
          const b = activity[i + 1].smoothed;
          if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
            const t = a / (a - b);
            augmented.push({
              x: xScale(e.index) + t * (xScale(activity[i + 1].index) - xScale(e.index)),
              v: 0,
            });
          }
        }
      }

      svg.append('path')
        .datum(augmented)
        .attr('d', d3.area<ActivitySample>()
          .x((p) => p.x)
          .y0(zeroY)
          .y1((p) => yScale(Math.max(0, p.v)))
          .curve(curveFn))
        .attr('fill', ACTIVITY_COLOR).attr('opacity', 0.22);

      // Low-activity region (below zero) — light blue fill.
      svg.append('path')
        .datum(augmented)
        .attr('d', d3.area<ActivitySample>()
          .x((p) => p.x)
          .y0(zeroY)
          .y1((p) => yScale(Math.min(0, p.v)))
          .curve(curveFn))
        .attr('fill', LOW_ACTIVITY_COLOR).attr('opacity', 0.20);
    }

    // Macro trend (dashed white)
    svg.append('path')
      .datum(activity)
      .attr('d', d3.line<ActivityPoint>()
        .x((e) => xScale(e.index))
        .y((e) => yScale(e.macroTrend))
        .curve(d3.curveMonotoneX))
      .attr('fill', 'none')
      .attr('stroke', 'rgba(255,255,255,0.2)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,3');

    // Primary smoothed activity line
    svg.append('path')
      .datum(activity)
      .attr('d', d3.line<ActivityPoint>()
        .x((e) => xScale(e.index))
        .y((e) => yScale(e.smoothed))
        .curve(curveFn))
      .attr('fill', 'none')
      .attr('stroke', ACTIVITY_COLOR)
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.9);

    // Peak markers — small dots
    for (const e of activity) {
      if (!e.isPeak) continue;
      const cx = xScale(e.index);
      const cy = yScale(e.smoothed);
      svg.append('circle')
        .attr('cx', cx).attr('cy', cy)
        .attr('r', 2)
        .attr('fill', PEAK_COLOR)
        .attr('opacity', 0.9);
    }

    // Valley markers — small dots
    for (const e of activity) {
      if (!e.isValley) continue;
      const cx = xScale(e.index);
      const cy = yScale(e.smoothed);
      svg.append('circle')
        .attr('cx', cx).attr('cy', cy)
        .attr('r', 2)
        .attr('fill', LOW_ACTIVITY_COLOR)
        .attr('opacity', 0.8);
    }

    // Overflow markers for smoothed values outside the clipped domain.
    if (hasOverflow) {
      const overflowHi = clipAbs * 1.15;
      const overflowLo = -clipAbs * 1.15;
      for (const e of activity) {
        const x = xScale(e.index);
        if (e.smoothed > overflowHi) {
          svg.append('path')
            .attr('d', `M ${x - 2.5} 3 L ${x + 2.5} 3 L ${x} 0 Z`)
            .attr('fill', ACTIVITY_COLOR)
            .attr('opacity', 0.7);
        } else if (e.smoothed < overflowLo) {
          svg.append('path')
            .attr('d', `M ${x - 2.5} ${height - 3} L ${x + 2.5} ${height - 3} L ${x} ${height} Z`)
            .attr('fill', LOW_ACTIVITY_COLOR)
            .attr('opacity', 0.7);
        }
      }
    }

    // Current scene cursor
    if (currentIndex >= 0 && currentIndex < activity.length) {
      const e = activity[currentIndex];
      const cx = xScale(e.index);
      const cy = yScale(e.smoothed);

      svg.append('line')
        .attr('x1', cx).attr('x2', cx)
        .attr('y1', 0).attr('y2', height)
        .attr('stroke', 'rgba(255,255,255,0.15)')
        .attr('stroke-width', 1);

      svg.append('circle')
        .attr('cx', cx).attr('cy', cy)
        .attr('r', 3)
        .attr('fill', ACTIVITY_COLOR)
        .attr('stroke', '#111')
        .attr('stroke-width', 1.5);
    }
  }, [activity, currentIndex, dims, windowStart, windowEnd, showArea, showWindow, curveFn]);

  const currentValue = currentIndex >= 0 && currentIndex < activity.length
    ? activity[currentIndex]
    : undefined;

  return (
    <div className="flex-1 flex flex-col px-2 py-1.5 min-w-0 overflow-hidden">
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="flex items-baseline gap-1">
          <span className="text-[9px] uppercase tracking-wider text-text-dim">Activity</span>
          {raw && <span className="text-[8px] text-text-dim opacity-50">raw</span>}
        </span>
        <span className="flex items-center gap-1.5">
          {average !== undefined && (
            <span className="text-[9px] font-mono font-medium" style={{ color: ACTIVITY_COLOR, opacity: 0.5 }}>
              ({average.toFixed(2)})
            </span>
          )}
          {currentValue && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: ACTIVITY_COLOR, boxShadow: `0 0 4px ${ACTIVITY_COLOR}` }}
              />
              <span className="text-[9px] font-mono font-semibold" style={{ color: ACTIVITY_COLOR }}>
                {currentValue.smoothed.toFixed(2)}
              </span>
            </span>
          )}
        </span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0">
        <svg ref={svgRef} width={dims.width} height={dims.height} className="block" preserveAspectRatio="none" />
      </div>
    </div>
  );
}
