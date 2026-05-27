'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { SlidesData } from '@/lib/slides-data';
import { SlideShell, SlideCard } from './SlideShell';

export function ShapeSlide({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;

    const { width } = svgRef.current.getBoundingClientRect();
    const height = 280;
    const margin = { top: 24, right: 24, bottom: 36, left: 40 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const eng = data.activityCurve;
    const x = d3.scaleLinear().domain([0, eng.length - 1]).range([0, w]);
    const maxAbs = Math.max(...eng.map((e) => Math.abs(e.smoothed)), 0.5) * 1.2;
    const y = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([h, 0]);
    const zeroY = y(0);

    // Grid
    g.append('line').attr('x1', 0).attr('y1', zeroY).attr('x2', w).attr('y2', zeroY)
      .attr('stroke', 'white').attr('stroke-opacity', 0.15);

    // Augment with interpolated zero-crossings so the orange/blue
    // regions clip cleanly at y=0 instead of dropping vertically at
    // scene vertices.
    type EngSample = { x: number; v: number };
    const augmented: EngSample[] = [];
    for (let i = 0; i < eng.length; i++) {
      const e = eng[i];
      augmented.push({ x: x(e.index), v: e.smoothed });
      if (i < eng.length - 1) {
        const a = e.smoothed;
        const b = eng[i + 1].smoothed;
        if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
          const t = a / (a - b);
          augmented.push({
            x: x(e.index) + t * (x(eng[i + 1].index) - x(e.index)),
            v: 0,
          });
        }
      }
    }

    // Positive area
    const posArea = d3.area<EngSample>()
      .x((p) => p.x)
      .y0(zeroY)
      .y1((p) => y(Math.max(0, p.v)))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(augmented).attr('d', posArea)
      .attr('fill', '#F59E0B').attr('fill-opacity', 0.12);

    // Negative area
    const negArea = d3.area<EngSample>()
      .x((p) => p.x)
      .y0(zeroY)
      .y1((p) => y(Math.min(0, p.v)))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(augmented).attr('d', negArea)
      .attr('fill', '#93C5FD').attr('fill-opacity', 0.08);

    // Macro trend
    const trendLine = d3.line<typeof eng[0]>()
      .x((d) => x(d.index))
      .y((d) => y(d.macroTrend))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(eng).attr('d', trendLine)
      .attr('fill', 'none').attr('stroke', 'white').attr('stroke-opacity', 0.25)
      .attr('stroke-width', 1.5).attr('stroke-dasharray', '6,4');

    // Delivery line with draw animation
    const line = d3.line<typeof eng[0]>()
      .x((d) => x(d.index))
      .y((d) => y(d.smoothed))
      .curve(d3.curveMonotoneX);

    const path = g.append('path').datum(eng).attr('d', line)
      .attr('fill', 'none').attr('stroke', '#F59E0B').attr('stroke-width', 2);

    const totalLength = (path.node() as SVGPathElement)?.getTotalLength() ?? 0;
    path.attr('stroke-dasharray', totalLength)
      .attr('stroke-dashoffset', totalLength)
      .transition().duration(2000).ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0);

    // Peak markers
    const peaks = eng.filter((e) => e.isPeak);
    g.selectAll('.peak').data(peaks).enter()
      .append('path')
      .attr('d', d3.symbol().type(d3.symbolTriangle).size(40)())
      .attr('transform', (d) => `translate(${x(d.index)},${y(d.smoothed) - 8})`)
      .attr('fill', '#FCD34D').attr('opacity', 0)
      .transition().delay(2000).duration(400)
      .attr('opacity', 0.9);

    // Valley markers
    const valleys = eng.filter((e) => e.isValley);
    g.selectAll('.valley').data(valleys).enter()
      .append('path')
      .attr('d', d3.symbol().type(d3.symbolTriangle).size(40)())
      .attr('transform', (d) => `translate(${x(d.index)},${y(d.smoothed) + 8}) rotate(180)`)
      .attr('fill', '#93C5FD').attr('opacity', 0)
      .transition().delay(2000).duration(400)
      .attr('opacity', 0.8);

    // X axis labels
    const labelCount = Math.min(8, eng.length);
    const step = Math.floor(eng.length / labelCount);
    for (let i = 0; i < eng.length; i += step) {
      g.append('text')
        .attr('x', x(i)).attr('y', h + 20)
        .attr('text-anchor', 'middle')
        .attr('fill', 'white').attr('fill-opacity', 0.3)
        .attr('font-size', 10).attr('font-family', 'monospace')
        .text(i + 1);
    }
  }, [data]);

  return (
    <SlideShell
      eyebrow="Activity · Shape"
      title="Delivery Curve"
      subtitle={`Narrative presence over ${data.sceneCount} scenes. Peaks mark high-intensity moments, valleys mark recovery deliveries.`}
      align="center"
      contentWidth="wide"
      rightSlot={
        data.shape && (
          <span className="text-xs px-2.5 py-1 rounded-full border border-amber-400/20 bg-amber-400/5 text-amber-400 font-medium">
            {data.shape.name}
          </span>
        )
      }
      footer={
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> {data.peaks.length} peak{data.peaks.length === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-300" /> {data.troughs.length} valle{data.troughs.length === 1 ? 'y' : 'ys'}
          </span>
        </div>
      }
    >
      <SlideCard>
        <svg ref={svgRef} className="w-full" style={{ height: 280 }} />
      </SlideCard>
    </SlideShell>
  );
}
