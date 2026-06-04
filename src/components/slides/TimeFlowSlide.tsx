'use client';
// TimeFlow slide — D3 view of how narrative time flows across scenes (chronology, jumps, pacing).

import React, { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import type { SlidesData } from '@/lib/slides-data';
import {
  SECONDS_PER_UNIT,
  TIME_UNITS_ASCENDING,
  computeSceneOffsets,
  formatCumulative,
  timeDeltaToSeconds,
} from '@/lib/forces/time-deltas';
import { SlideShell, SlideCard, SlideStatStrip } from './SlideShell';

const FORWARD = '#fbbf24';
const FLASHBACK = '#a78bfa';
const CONCURRENT = '#64748b';

// Pacing-intensity bands — adapted from TimeFlowModal. Tight gaps peak at the
// top of the chart ("in-the-moment"), generational skips valley at the bottom.
// Each band gets equal visual height; the log-fraction within each band keeps
// the curve smooth across orders of magnitude.
const DECADE_SECONDS = SECONDS_PER_UNIT.year * 10;
const TOP_BAND_INDEX = TIME_UNITS_ASCENDING.length;
const TOTAL_POSITIONS = 8;

function bandIndexFor(seconds: number): number {
  const abs = Math.abs(seconds);
  if (abs < SECONDS_PER_UNIT.minute) return -1;
  if (abs >= DECADE_SECONDS) return TOP_BAND_INDEX;
  for (let i = TIME_UNITS_ASCENDING.length - 1; i >= 0; i--) {
    if (abs >= SECONDS_PER_UNIT[TIME_UNITS_ASCENDING[i]]) return i;
  }
  return -1;
}

function bandLowSeconds(b: number): number {
  if (b === TOP_BAND_INDEX) return DECADE_SECONDS;
  return SECONDS_PER_UNIT[TIME_UNITS_ASCENDING[b]];
}

/** Map a gap (signed seconds) to a 0..TOTAL_POSITIONS position. 0 = concurrent
 *  (peak intensity, top of chart), TOTAL_POSITIONS = decade-skip (valley). */
function bandPositionFor(gapSec: number): number {
  if (gapSec === 0) return 0;
  const abs = Math.abs(gapSec);
  if (abs < SECONDS_PER_UNIT.minute) {
    return Math.min(1, abs / SECONDS_PER_UNIT.minute);
  }
  const b = bandIndexFor(abs);
  const bandLow = bandLowSeconds(b);
  const bandHigh = b === TOP_BAND_INDEX ? bandLow * 10 : bandLowSeconds(b + 1);
  const frac = Math.min(1, Math.max(0, Math.log(abs / bandLow) / Math.log(bandHigh / bandLow)));
  return Math.min(TOTAL_POSITIONS, b + 1 + frac);
}

function intensityFor(gapSec: number): number {
  return Math.max(0, Math.min(1, 1 - bandPositionFor(gapSec) / TOTAL_POSITIONS));
}

const POSITION_LABELS: { pos: number; label: string }[] = [
  { pos: 0, label: 'concurrent' },
  { pos: 1, label: 'minute' },
  { pos: 2, label: 'hour' },
  { pos: 3, label: 'day' },
  { pos: 4, label: 'week' },
  { pos: 5, label: 'month' },
  { pos: 6, label: 'year' },
  { pos: 7, label: '10 years' },
];

/** Time-flow slide. Each scene's temporal gap from the prior scene is mapped
 *  to a vertical position — concurrent at the top, decade-skip at the bottom.
 *  Peaks read as "events close together"; valleys as "events apart". The
 *  gradient fill carries pacing without forcing the reader to trace the line. */
export function TimeFlowSlide({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const summary = useMemo(() => {
    const scenes = data.scenes;
    const gapsSec = scenes.map((s) => (s.timeDelta ? timeDeltaToSeconds(s.timeDelta) : 0));
    const offsets = computeSceneOffsets(scenes);
    const forwardCount = gapsSec.filter((g, i) => i > 0 && g > 0).length;
    const flashbackCount = gapsSec.filter((g) => g < 0).length;
    const concurrentCount = gapsSec.filter((g, i) => i > 0 && g === 0).length;
    const maxOffset = Math.max(0, ...offsets);
    const minOffset = Math.min(0, ...offsets);
    return {
      gapsSec,
      forwardCount,
      flashbackCount,
      concurrentCount,
      totalSpan: formatCumulative(maxOffset),
      earliestFlashback: minOffset < 0 ? formatCumulative(minOffset) : null,
    };
  }, [data.scenes]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;

    const { width } = svgRef.current.getBoundingClientRect();
    const height = 340;
    const margin = { top: 18, right: 24, bottom: 36, left: 80 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const n = data.sceneCount;
    if (n === 0) return;

    const x = d3.scaleLinear().domain([0, Math.max(1, n - 1)]).range([0, w]);
    const yForIntensity = (intensity: number) => (1 - intensity) * h;

    const points = summary.gapsSec.map((gap, i) => ({
      x: x(i),
      y: yForIntensity(intensityFor(gap)),
      gap,
      idx: i,
    }));

    // Gradient — warm at the top (tight pacing), cool at the bottom (slow).
    const defs = g.append('defs');
    const grad = defs.append('linearGradient')
      .attr('id', 'time-flow-gradient')
      .attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#fb7185').attr('stop-opacity', 0.55);
    grad.append('stop').attr('offset', '20%').attr('stop-color', '#fbbf24').attr('stop-opacity', 0.45);
    grad.append('stop').attr('offset', '50%').attr('stop-color', '#34d399').attr('stop-opacity', 0.3);
    grad.append('stop').attr('offset', '80%').attr('stop-color', '#818cf8').attr('stop-opacity', 0.2);
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#c084fc').attr('stop-opacity', 0.1);

    // Band tick lines + labels (concurrent / minute / hour / day / ...).
    for (const { pos, label } of POSITION_LABELS) {
      const intensity = 1 - pos / TOTAL_POSITIONS;
      const yLine = yForIntensity(intensity);
      const isPeak = pos === 0;
      g.append('line')
        .attr('x1', 0).attr('x2', w)
        .attr('y1', yLine).attr('y2', yLine)
        .attr('stroke', isPeak ? 'rgba(251,113,133,0.35)' : 'rgba(148,163,184,0.10)')
        .attr('stroke-width', isPeak ? 1 : 0.5)
        .attr('stroke-dasharray', isPeak ? '' : '2 4');
      g.append('text')
        .attr('x', -8).attr('y', yLine + 3)
        .attr('text-anchor', 'end')
        .attr('font-size', 10)
        .attr('fill', isPeak ? 'rgba(251,113,133,0.85)' : 'rgba(148,163,184,0.65)')
        .attr('font-weight', isPeak ? 600 : 400)
        .text(label);
    }

    // Baseline (decade-valley floor)
    g.append('line')
      .attr('x1', 0).attr('x2', w)
      .attr('y1', h).attr('y2', h)
      .attr('stroke', 'rgba(148,163,184,0.4)').attr('stroke-width', 1);

    // Area fill
    const area = d3.area<typeof points[0]>()
      .x((p) => p.x).y0(h).y1((p) => p.y).curve(d3.curveMonotoneX);
    g.append('path').datum(points).attr('d', area).attr('fill', 'url(#time-flow-gradient)');

    // Line on top of the area
    const line = d3.line<typeof points[0]>()
      .x((p) => p.x).y((p) => p.y).curve(d3.curveMonotoneX);
    const path = g.append('path')
      .datum(points)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(251,191,36,0.9)')
      .attr('stroke-width', 1.5)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');

    // Draw-in animation
    const totalLength = (path.node() as SVGPathElement)?.getTotalLength() ?? 0;
    if (totalLength > 0) {
      path.attr('stroke-dasharray', totalLength)
        .attr('stroke-dashoffset', totalLength)
        .transition().duration(1500).ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0);
    }

    // Scene markers — flashbacks render as violet with an arrow glyph.
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const td = data.scenes[i]?.timeDelta;
      const isFlashback = i > 0 && (td?.value ?? 0) < 0;
      g.append('circle')
        .attr('cx', p.x).attr('cy', p.y)
        .attr('r', 2.5)
        .attr('fill', isFlashback ? FLASHBACK : 'rgba(251,191,36,0.95)');
      if (isFlashback) {
        g.append('text')
          .attr('x', p.x).attr('y', p.y - 7)
          .attr('font-size', 10)
          .attr('text-anchor', 'middle')
          .attr('fill', FLASHBACK)
          .text('↶');
      }
    }

    // X-axis scene-index labels
    const labelCount = Math.min(10, n);
    const step = Math.max(1, Math.floor(n / labelCount));
    for (let i = 0; i < n; i += step) {
      g.append('text')
        .attr('x', x(i)).attr('y', h + 20)
        .attr('text-anchor', 'middle')
        .attr('font-size', 9)
        .attr('font-family', 'monospace')
        .attr('fill', 'rgba(148,163,184,0.6)')
        .text(i + 1);
    }
  }, [data, summary.gapsSec]);

  return (
    <SlideShell
      eyebrow="Time · Flow"
      title="Time Flow"
      subtitle="How time advances between scenes — peaks gather events into a single moment, valleys span weeks, months, or generations."
      align="center"
      contentWidth="wide"
      footer={
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: FORWARD }} /> forward</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: FLASHBACK }} /> flashback</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: CONCURRENT }} /> concurrent</span>
        </div>
      }
    >
      <SlideStatStrip
        className="mb-5"
        accent={
          <>
            total span <span className="text-text-secondary font-mono">{summary.totalSpan}</span>
            {summary.earliestFlashback ? ` · earliest flashback ${summary.earliestFlashback}` : ''}
          </>
        }
      >
        <span><span className="text-text-secondary font-mono">{data.sceneCount}</span> scenes</span>
        <span><span style={{ color: FORWARD }} className="font-mono">{summary.forwardCount}</span> forward</span>
        <span><span style={{ color: FLASHBACK }} className="font-mono">{summary.flashbackCount}</span> flashback{summary.flashbackCount === 1 ? '' : 's'}</span>
        <span><span style={{ color: CONCURRENT }} className="font-mono">{summary.concurrentCount}</span> concurrent</span>
      </SlideStatStrip>

      <SlideCard label="Pacing intensity · peaks = events close together · valleys = events apart">
        <svg ref={svgRef} className="w-full" style={{ height: 340 }} />
      </SlideCard>
    </SlideShell>
  );
}
