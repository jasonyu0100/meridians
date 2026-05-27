'use client';

import React, { useMemo } from 'react';
import type { SlidesData, BeliefSnapshot } from '@/lib/slides-data';
import {
  THREAD_CATEGORY_HEX,
  THREAD_CATEGORY_LABEL,
} from '@/lib/thread-category';
import { SlideShell, SlideStatStrip } from './SlideShell';

// Outcome palette — matches the belief market view so a thread's outcome
// reads the same hue everywhere.
const OUTCOME_HEX: readonly string[] = [
  '#38BDF8', // sky
  '#FBBF24', // amber
  '#2DD4BF', // teal
  '#A78BFA', // violet
  '#FB7185', // rose
  '#34D399', // emerald
  '#818CF8', // indigo
  '#FB923C', // orange
];

function outcomeColor(i: number): string {
  return OUTCOME_HEX[i % OUTCOME_HEX.length];
}

function marginPhrase(margin: number): string {
  if (margin >= 3) return 'a hair from settling';
  if (margin >= 2) return 'leaning hard';
  if (margin >= 1) return 'leaning';
  if (margin >= 0.4) return 'edging ahead';
  return 'down the middle';
}

/** Per-belief trajectory chart — one polyline per outcome, probability over
 *  scene ordinal. Mirrors the FeaturedTrajectory shape in BeliefView so the
 *  visual language is consistent across the engine. Compact enough to grid
 *  several side-by-side. */
function BeliefTrajectoryChart({
  belief,
  width,
  height,
}: {
  belief: BeliefSnapshot;
  width: number;
  height: number;
}) {
  const padL = 24;
  const padR = 8;
  const padT = 6;
  const padB = 12;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = Math.max(0, height - padT - padB);

  const points = belief.trajectory;
  const numOutcomes = belief.outcomes.length;

  if (points.length === 0) {
    // No trajectory replay — render flat lines at the current stance so
    // the visual shape is consistent across the grid.
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full select-none">
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={padL}
            x2={width - padR}
            y1={padT + (1 - f) * plotH}
            y2={padT + (1 - f) * plotH}
            stroke="#fff"
            strokeWidth={0.5}
            opacity={0.05}
            strokeDasharray={f === 0 || f === 1 ? undefined : '2 4'}
          />
        ))}
        {belief.outcomes.map((o, k) => {
          const offset = (k - (numOutcomes - 1) / 2) * 2.5;
          const y = padT + (1 - o.p) * plotH + offset;
          return (
            <line
              key={k}
              x1={padL}
              x2={width - padR}
              y1={y}
              y2={y}
              stroke={outcomeColor(k)}
              strokeWidth={1.25}
              strokeDasharray="3 4"
              opacity={0.55}
            />
          );
        })}
      </svg>
    );
  }

  const n = points.length;
  const xAt = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (p: number) => padT + (1 - p) * plotH;
  const lineOffset = (k: number) => (k - (numOutcomes - 1) / 2) * 2.5;

  // One polyline per outcome
  const lines = belief.outcomes.map((_, k) => {
    const off = lineOffset(k);
    const d = points
      .map((pt, i) => {
        const p = pt.probs[k] ?? 0;
        return `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${(yAt(p) + off).toFixed(1)}`;
      })
      .join(' ');
    return { k, d };
  });

  const firstOrdinal = points[0].sceneOrdinal;
  const lastOrdinal = points[points.length - 1].sceneOrdinal;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full select-none">
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line
            x1={padL}
            x2={width - padR}
            y1={padT + (1 - f) * plotH}
            y2={padT + (1 - f) * plotH}
            stroke="#fff"
            strokeWidth={0.5}
            opacity={0.05}
            strokeDasharray={f === 0 || f === 1 ? undefined : '2 4'}
          />
        </g>
      ))}
      {/* Y-axis percentages — sparse: just 0/50/100 to keep the small
          chart legible */}
      {[0, 0.5, 1].map((f) => (
        <text
          key={f}
          x={padL - 3}
          y={padT + (1 - f) * plotH + 3}
          textAnchor="end"
          fontSize={7.5}
          fill="rgba(148,163,184,0.55)"
          className="tabular-nums"
        >
          {Math.round(f * 100)}
        </text>
      ))}
      {/* Outcome polylines */}
      {lines.map(({ k, d }) => (
        <path
          key={k}
          d={d}
          fill="none"
          stroke={outcomeColor(k)}
          strokeWidth={1.5}
          opacity={0.85}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {/* Endpoint dots */}
      {belief.outcomes.map((_, k) => {
        const p = points[points.length - 1].probs[k] ?? 0;
        return (
          <circle
            key={k}
            cx={xAt(points.length - 1)}
            cy={yAt(p) + lineOffset(k)}
            r={2}
            fill={outcomeColor(k)}
            opacity={0.95}
          />
        );
      })}
      {/* X-axis labels */}
      <text x={padL} y={height - 2} fontSize={7.5} fill="rgba(148,163,184,0.55)">
        sc {firstOrdinal}
      </text>
      <text x={width - padR} y={height - 2} textAnchor="end" fontSize={7.5} fill="rgba(148,163,184,0.55)">
        sc {lastOrdinal}
      </text>
    </svg>
  );
}

/** Compact card: question + category chip + lean prose + trajectory chart +
 *  outcome legend. The chart carries the bulk of the meaning; the prose
 *  anchors the reader. */
function BeliefCard({ b }: { b: BeliefSnapshot }) {
  const color = THREAD_CATEGORY_HEX[b.category];
  const leanPct = Math.round(b.pLean * 100);
  return (
    <div
      className="rounded-lg border bg-white/[0.02] p-3 flex flex-col"
      style={{ borderColor: `${color}33` }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-[8.5px] uppercase tracking-widest" style={{ color }}>
          {THREAD_CATEGORY_LABEL[b.category]}
        </span>
        <span className="ml-auto text-[9px] font-mono text-text-dim shrink-0">
          {leanPct}% · {marginPhrase(b.margin)}
        </span>
      </div>

      <p className="text-[11.5px] text-text-primary/90 leading-snug mb-1 line-clamp-2" title={b.description}>
        {b.description}
      </p>

      {b.participantNames.length > 0 && (
        <p className="text-[9.5px] text-text-dim italic mb-2 truncate" title={b.participantNames.join(', ')}>
          {b.participantNames.join(', ')}
        </p>
      )}

      {/* Trajectory chart */}
      <div className="flex-1 min-h-[100px] mb-2">
        <BeliefTrajectoryChart belief={b} width={320} height={100} />
      </div>

      {/* Outcome legend — colour swatches + names + current probability */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] font-mono">
        {b.outcomes.map((o, k) => (
          <span key={k} className="flex items-center gap-1 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: outcomeColor(k) }} />
            <span className="text-text-secondary truncate" title={o.name}>{o.name}</span>
            <span className="text-text-dim/70 tabular-nums shrink-0">{Math.round(o.p * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The work's belief system rendered as top-volume open questions with
 *  per-scene stance trajectories. Mirrors the belief market view's prediction
 *  graph — each card carries the same outcome-over-time chart so the operator
 *  reads how each belief CAME to its current lean, not just where it is. */
export function BeliefSystemSlide({ data }: { data: SlidesData }) {
  // The slides-data builder already sorts by volume desc and attaches
  // trajectories to the top-N. Filter out anything without a trajectory so
  // the slide only shows beliefs we can actually plot through time.
  const featured = useMemo(
    () => data.beliefs.filter((b) => b.trajectory.length > 0).slice(0, 6),
    [data.beliefs],
  );
  const liveCount = data.beliefs.length;
  const totalCount = data.threadCount;
  const closedCount = Math.max(0, totalCount - liveCount);

  return (
    <SlideShell
      eyebrow="Fate · Belief System"
      title="Belief System"
      subtitle="The world view's top open questions, with their stance evolution. Each chart traces how the lean has moved scene by scene — the Fate force made visible."
      contentWidth="wide"
    >
      <SlideStatStrip
        className="mb-5"
        accent="top open questions by attention — closed and abandoned are not shown"
      >
        <span><span className="text-text-secondary font-mono">{liveCount}</span> live</span>
        <span><span className="text-text-secondary font-mono">{closedCount}</span> settled</span>
        <span><span className="text-text-secondary font-mono">{featured.length}</span> charted</span>
      </SlideStatStrip>

      {featured.length === 0 ? (
        <div className="flex items-center justify-center flex-1">
          <p className="text-text-dim text-sm italic">
            {liveCount === 0
              ? 'No open questions — belief system at rest.'
              : 'Open questions exist but have no resolved trajectory yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 flex-1 min-h-0 overflow-y-auto pr-1">
          {featured.map((b) => (
            <BeliefCard key={b.threadId} b={b} />
          ))}
        </div>
      )}
    </SlideShell>
  );
}
