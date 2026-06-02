'use client';

/**
 * Belief dashboard — the world view's belief, built from per-thread stances. A canvas view of the
 * portfolio. Replaces the old ThreadGraphModal. Reactive to the current scene
 * index: scrubbing replays every thread's belief up to that point and the
 * dashboard animates alongside it.
 *
 * Layout:
 *   1. Drill-down — featured stance + scrollable stance list sidebar (lead panel)
 *   2. Overview — KPI sparkline cards (current value + trend up to now)
 *   3. Movers — top probability shifts + volatility leaders
 *   4. Composition — category mix, uncertainty histogram, resolution quality
 *   5. Screener — all-stances grid with category filter
 *
 * We're passive observers right now — the dashboard reads the narrative but
 * never dispatches evidence. Future iterations will add controls for
 * operators to influence stances directly.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NarrativeState, Thread } from '@/types/narrative';
import { useStore } from '@/lib/store';
import {
  buildPortfolioRows,
  buildPortfolioTrajectory,
  buildThreadTrajectory,
  computePortfolioSnapshot,
  computeRecentMovements,
  currentFocusIds,
  replayThreadsAtIndex,
  type PortfolioRow,
  type PortfolioTrajectoryPoint,
  type ThreadMovement,
  type ThreadTrajectoryPoint,
} from '@/lib/portfolio-analytics';
import {
  THREAD_CATEGORY_HEX,
  THREAD_CATEGORY_LABEL,
  THREAD_CATEGORY_DESCRIPTION,
  outcomeColourHex,
  type ThreadCategory,
} from '@/lib/thread-category';
import { getThreadStance, getStanceMargin, getStanceProbs, countScenes, sceneOrdinalAt } from '@/lib/narrative-utils';

// ── Category filter chips ──────────────────────────────────────────────────

type CategoryFilter = 'all' | ThreadCategory;

const CATEGORY_FILTER_ORDER: CategoryFilter[] = [
  'all',
  'saturating',
  'contested',
  'volatile',
  'committed',
  'dormant',
  'resolved',
  'abandoned',
];

function CategoryFilterBar({
  active,
  onChange,
  counts,
}: {
  active: CategoryFilter;
  onChange: (c: CategoryFilter) => void;
  counts: Record<CategoryFilter, number>;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {CATEGORY_FILTER_ORDER.map((cat) => {
        if (cat !== 'all' && counts[cat] === 0) return null;
        const isActive = active === cat;
        const color = cat === 'all' ? undefined : THREAD_CATEGORY_HEX[cat];
        return (
          <button
            key={cat}
            onClick={() => onChange(cat)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors shrink-0 ${
              isActive
                ? 'border-white/30 bg-white/10 text-text-primary'
                : 'border-transparent text-text-dim hover:text-text-secondary hover:bg-white/5'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              {color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
              <span className="capitalize">{cat}</span>
              <span className="text-text-dim/60 tabular-nums">{counts[cat]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Probability trajectory (stacked-area chart) ────────────────────────────

function FeaturedTrajectory({
  thread,
  points,
}: {
  thread: Thread;
  points: ThreadTrajectoryPoint[];
}) {
  // Measure the container so viewBox maps 1:1 to pixels. Without this,
  // preserveAspectRatio="none" stretches glyphs non-uniformly and text looks
  // squished/elongated.
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ W: 720, H: 280 });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setDims({ W: Math.round(r.width), H: Math.round(r.height) });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { W, H } = dims;
  const PAD_L = 36;
  const PAD_R = 56;
  const PAD_T = 12;
  const PAD_B = 24;
  const plotW = Math.max(0, W - PAD_L - PAD_R);
  const plotH = Math.max(0, H - PAD_T - PAD_B);

  if (points.length === 0) {
    // Thread isn't introduced on the current timeline yet (no
    // resolvable openedAt). Render flat horizontal lines at the
    // thread's initial-prior probabilities so the operator still sees
    // the distribution shape spatially, with a "not yet introduced"
    // annotation that makes the temporal status clear.
    const priorProbs = getStanceProbs(thread);
    return (
      <div ref={containerRef} className="w-full h-72">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full select-none">
          <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="transparent" />
          {/* Grid */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
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
              />
              <text
                x={PAD_L - 6}
                y={PAD_T + (1 - f) * plotH + 3}
                textAnchor="end"
                className="text-[9px] tabular-nums"
                fill="#555"
              >
                {Math.round(f * 100)}%
              </text>
            </g>
          ))}
          {/* Flat lines at the prior — dashed to read as "not yet
              priced", muted opacity. Per-outcome vertical nudge so
              tied probabilities don't collapse onto each other. */}
          {priorProbs.map((p, k) => {
            const numOutcomes = priorProbs.length;
            const off = (k - (numOutcomes - 1) / 2) * 3.5;
            const y = PAD_T + (1 - p) * plotH + off;
            return (
              <line
                key={k}
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y}
                y2={y}
                stroke={outcomeColourHex(k)}
                strokeWidth={1.5}
                strokeDasharray="3 4"
                opacity={0.5}
              />
            );
          })}
        </svg>
      </div>
    );
  }

  const n = points.length;
  const xAt = (i: number) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (p: number) => PAD_T + (1 - p) * plotH;

  // Use the trajectory's own outcomes list (last point — outcomes only grow
  // via addOutcomes, never shrink). Renders against `pt.probs` 1:1, so a
  // mid-narrative outcome expansion that diverges from the live
  // narrative.threads[id].outcomes still renders correctly and the per-
  // scene percentages sum to 100%.
  const chartOutcomes = points[points.length - 1].outcomes;
  const numOutcomes = chartOutcomes.length;
  // Colour-key each chart outcome off its position in the LIVE thread's
  // outcomes — same convention the portfolio sidebar uses — so any view
  // showing this outcome paints it the same hue. If the trajectory's
  // outcome isn't in the live list (rare race), fall back to its tail
  // index.
  const liveIdxByName = new Map<string, number>();
  thread.outcomes.forEach((o, i) => liveIdxByName.set(o, i));
  const colourIdxOf = (k: number) => liveIdxByName.get(chartOutcomes[k]) ?? k;
  // Per-outcome vertical nudge so tied probabilities render as parallel strokes
  // rather than collapsing onto each other. 3.5px keeps tied lines legible
  // without falsifying the data meaningfully (≈1.4pp on a 0–100% axis).
  const lineOffset = (k: number) => (k - (numOutcomes - 1) / 2) * 3.5;

  // Build one polyline per outcome — the probability of that outcome over
  // time. Readers can trace which outcome surged when.
  const lines = chartOutcomes.map((_, k) => {
    const off = lineOffset(k);
    const d = points
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(pt.probs[k] ?? 0) + off}`)
      .join(' ');
    return { k, d };
  });

  return (
    <div ref={containerRef} className="w-full h-72">
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full select-none">
      {/* Plot background */}
      <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="transparent" />
      {/* Horizontal grid at 0, 25, 50, 75, 100 */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
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
          />
          <text
            x={PAD_L - 6}
            y={PAD_T + (1 - f) * plotH + 3}
            textAnchor="end"
            className="text-[9px] tabular-nums"
            fill="#555"
          >
            {Math.round(f * 100)}%
          </text>
        </g>
      ))}
      {/* Outcome lines */}
      {lines.map(({ k, d }) => (
        <path
          key={k}
          d={d}
          fill="none"
          stroke={outcomeColourHex(colourIdxOf(k))}
          strokeWidth={1.75}
          opacity={0.85}
          strokeLinecap="round"
        />
      ))}
      {/* Endpoint dots — labels live in the left-side outcome list, so we only
          mark the current position here. Use the trajectory's own outcomes
          for the same length-alignment guarantee as the polyline. */}
      {chartOutcomes.map((_, k) => {
        const p = points[points.length - 1].probs[k] ?? 0;
        return (
          <circle
            key={k}
            cx={xAt(points.length - 1)}
            cy={yAt(p) + lineOffset(k)}
            r={2.5}
            fill={outcomeColourHex(colourIdxOf(k))}
            opacity={0.9}
          />
        );
      })}
      {/* X axis labels — first label flags the introduction scene
          explicitly so the chart's leftmost point reads as
          "the stance opens HERE", not as the timeline origin. Last
          label is the current scene cursor. Scene-only ordinals
          throughout — world commits don't count. */}
      <text x={PAD_L} y={H - 4} className="text-[9px]" fill="#7c7c8a">
        introduced · scene {points[0].sceneOrdinal}
      </text>
      <text x={W - PAD_R} y={H - 4} textAnchor="end" className="text-[9px]" fill="#555">
        scene {points[points.length - 1].sceneOrdinal}
      </text>
    </svg>
    </div>
  );
}

// ── Featured stance panel ──────────────────────────────────────────────────

function FeaturedStance({
  thread,
  points,
  category,
}: {
  thread: Thread;
  points: ThreadTrajectoryPoint[];
  category: ThreadCategory;
}) {
  // The trajectory's tail point is the canonical source for both the
  // outcome labels and their probabilities at the current scene index —
  // they're snapshotted together from the same softmax distribution, so the
  // displayed percentages always sum to 100% and match what the chart
  // plots. Fall back to the live thread only when no scenes have replayed
  // for this stance yet.
  const tail = points.length > 0 ? points[points.length - 1] : null;
  const tailOutcomes = tail ? tail.outcomes : thread.outcomes;
  const tailProbs = tail ? tail.probs : getStanceProbs(thread);
  const belief = getThreadStance(thread);
  const { margin } = getStanceMargin(thread);
  // Colour-key off the live thread's outcome ordering — matches the
  // portfolio sidebar and the inspector so a given outcome paints the
  // same hue in every view.
  const liveIdxByName = new Map<string, number>();
  thread.outcomes.forEach((o, i) => liveIdxByName.set(o, i));
  const ranked = tailOutcomes
    .map((o, i) => ({ outcome: o, idx: i, colourIdx: liveIdxByName.get(o) ?? i, prob: tailProbs[i] ?? 0 }))
    .sort((a, b) => b.prob - a.prob);
  const catColor = THREAD_CATEGORY_HEX[category];

  return (
    <div className="relative flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/2.5 backdrop-blur-xl p-6 panel-raise overflow-hidden">
      {/* Top highlight — Apple-style lit edge */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/15 to-transparent" />
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 text-[10px] text-text-dim uppercase tracking-wider">
              <span className="font-mono">{thread.id}</span>
              <span className="text-text-dim/40">·</span>
              <span
                className="font-medium"
                style={{ color: catColor }}
                title={THREAD_CATEGORY_DESCRIPTION[category]}
              >
                {THREAD_CATEGORY_LABEL[category]}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-text-primary leading-tight mt-1 wrap-break-word">
              {thread.description}
            </h2>
          </div>
        </div>
        <div className="flex items-baseline gap-4 text-[10px] text-text-dim shrink-0">
          <div className="flex flex-col items-end">
            <span className="text-sm text-text-primary font-mono tabular-nums">
              {(belief?.volume ?? 0).toFixed(1)}
            </span>
            <span>volume</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-sm text-text-primary font-mono tabular-nums">
              Δ{margin.toFixed(1)}
            </span>
            <span>margin</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-sm text-text-primary font-mono tabular-nums">
              {(belief?.volatility ?? 0).toFixed(2)}
            </span>
            <span>volatility</span>
          </div>
        </div>
      </div>

      {/* Body: outcomes (left) + trajectory (right). Outcomes are vertically
          centered alongside the chart so the legend sits at the chart's visual
          midline rather than floating at the top. */}
      <div className="grid grid-cols-[minmax(220px,280px)_1fr] gap-4 items-center">
        {/* Outcome list */}
        <div className="flex flex-col gap-2 self-center">
          {ranked.map(({ outcome, idx, colourIdx, prob }) => (
            <div key={`${outcome}-${idx}`} className="flex items-start gap-2">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0 mt-1"
                style={{ background: outcomeColourHex(colourIdx) }}
              />
              <span className="text-xs text-text-primary flex-1 wrap-break-word min-w-0 leading-snug">
                {outcome}
              </span>
              <span className="text-sm font-semibold font-mono tabular-nums text-text-primary shrink-0">
                {Math.round(prob * 100)}%
              </span>
            </div>
          ))}
          {thread.closedAt && (
            <div className="mt-2 pt-2 border-t border-white/5 text-[10px] text-text-dim">
              Closed at <span className="font-mono">{thread.closedAt}</span> →{' '}
              <span style={{ color: catColor }}>
                {thread.outcomes[thread.closeOutcome ?? 0]}
              </span>
              {thread.resolutionQuality !== undefined && (
                <>
                  {' '}· quality{' '}
                  <span className="font-mono tabular-nums">
                    {Math.round(thread.resolutionQuality * 100)}%
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Trajectory */}
        <div className="min-w-0">
          <FeaturedTrajectory thread={thread} points={points} />
        </div>
      </div>
    </div>
  );
}

// ── All-stances grid card ──────────────────────────────────────────────────

function StanceCard({
  row,
  inFocus,
  onSelect,
}: {
  row: PortfolioRow;
  inFocus: boolean;
  onSelect: () => void;
}) {
  const { thread, probs, topIdx, margin, volume, category } = row;
  const catColor = THREAD_CATEGORY_HEX[category];
  const dimmed = category === 'resolved' || category === 'abandoned';

  return (
    <button
      onClick={onSelect}
      className={`group text-left flex flex-col gap-2 p-3 rounded-lg border border-white/6 hover:border-white/15 hover:bg-white/3 transition-colors ${
        dimmed ? 'opacity-60' : ''
      }`}
      style={inFocus ? { borderLeft: `3px solid ${catColor}` } : undefined}
    >
      <div className="flex items-center justify-between gap-2 text-[10px] text-text-dim">
        <span className="font-mono">{thread.id}</span>
        <div className="flex items-center gap-1.5">
          <span
            className="font-medium"
            style={{ color: catColor }}
            title={THREAD_CATEGORY_DESCRIPTION[category]}
          >
            {THREAD_CATEGORY_LABEL[category]}
          </span>
          {inFocus && (
            <>
              <span className="text-text-dim/40">·</span>
              <span style={{ color: catColor }}>focus</span>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-text-primary leading-snug wrap-break-word">
        {thread.description}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-dim min-w-0 flex-1">
          <span className="text-text-secondary font-mono">{thread.outcomes[topIdx]}</span>{' '}
          <span className="font-mono tabular-nums text-text-primary">
            {Math.round((probs[topIdx] ?? 0) * 100)}%
          </span>
        </span>
        <span className="text-[9px] text-text-dim font-mono tabular-nums shrink-0">
          Δ{margin.toFixed(1)}
        </span>
        <span className="text-[9px] text-text-dim font-mono tabular-nums shrink-0">
          vol {volume.toFixed(1)}
        </span>
      </div>
      <div className="h-1 w-full flex rounded-full overflow-hidden bg-white/5">
        {probs.map((p, i) => (
          <div
            key={i}
            style={{
              width: `${p * 100}%`,
              background: outcomeColourHex(i),
              opacity: i === topIdx ? 1 : 0.5,
            }}
          />
        ))}
      </div>
    </button>
  );
}

// ── Stance list sidebar (in-view switcher) ─────────────────────────────────

function StanceListSidebar({
  rows,
  focusIds,
  selectedId,
  onSelect,
}: {
  rows: PortfolioRow[];
  focusIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = query.trim()
    ? rows.filter((r) => {
        const q = query.toLowerCase();
        return (
          r.thread.id.toLowerCase().includes(q) ||
          r.thread.description.toLowerCase().includes(q)
        );
      })
    : rows;
  // Partition filtered rows into focus / other — each rendered as its own
  // labelled section in the sidebar.
  const focusRows = filtered.filter((r) => focusIds.has(r.thread.id));
  const otherRows = filtered.filter((r) => !focusIds.has(r.thread.id));

  const renderRow = (row: PortfolioRow) => {
    const isSelected = selectedId === row.thread.id;
    const catColor = THREAD_CATEGORY_HEX[row.category];
    const topProb = row.probs[row.topIdx] ?? 0;
    const dimmed =
      row.category === 'resolved' || row.category === 'abandoned';
    return (
      <button
        key={row.thread.id}
        onClick={() => onSelect(row.thread.id)}
        className={`group flex items-start gap-2 py-1.5 px-2 rounded-md transition-colors text-left border-l-2 ${
          isSelected
            ? 'bg-white/8'
            : 'hover:bg-white/3 border-transparent'
        } ${dimmed ? 'opacity-55' : ''}`}
        style={
          isSelected
            ? { borderLeftColor: catColor }
            : { borderLeftColor: 'transparent' }
        }
      >
        <span
          className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
          style={{ background: catColor }}
          title={THREAD_CATEGORY_DESCRIPTION[row.category]}
        />
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-[10px] text-text-dim">
            <span className="font-mono">{row.thread.id}</span>
            <span
              className="capitalize"
              style={{ color: catColor }}
              title={THREAD_CATEGORY_DESCRIPTION[row.category]}
            >
              {THREAD_CATEGORY_LABEL[row.category]}
            </span>
            <span
              className="ml-auto font-mono tabular-nums text-[9px] px-1.5 py-px rounded-sm border border-white/10 bg-white/5 text-text-secondary shrink-0"
              title={`Focus score = volume × entropy × (1 + volatility) × recency^gap\n\nvolume ${row.volume.toFixed(1)} · entropy ${row.entropy.toFixed(2)} · volatility ${row.volatility.toFixed(2)} · gap ${Number.isFinite(row.gap) ? row.gap : '∞'}`}
            >
              {row.focus >= 10
                ? row.focus.toFixed(1)
                : row.focus >= 1
                  ? row.focus.toFixed(2)
                  : row.focus.toFixed(3)}
            </span>
          </div>
          <p className="text-[11px] text-text-primary leading-snug wrap-break-word">
            {row.thread.description}
          </p>
          <div className="flex items-center gap-2 text-[10px] text-text-dim">
            <span className="font-mono">
              {row.thread.outcomes[row.topIdx]}
            </span>
            <span className="ml-auto font-mono tabular-nums text-text-primary shrink-0">
              {Math.round(topProb * 100)}%
            </span>
          </div>
        </div>
      </button>
    );
  };

  const renderSection = (
    title: string,
    sectionRows: PortfolioRow[],
    accentColor?: string,
  ) => {
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-2 px-2 pt-2 pb-1.5">
          <span
            className="text-[9px] uppercase tracking-[0.14em] font-medium"
            style={{ color: accentColor ?? 'var(--color-text-dim)' }}
          >
            {title}
          </span>
          <span className="flex-1 h-px bg-white/5" />
          <span className="text-[9px] text-text-dim font-mono tabular-nums">
            {sectionRows.length}
          </span>
        </div>
        {sectionRows.length === 0 ? (
          <p className="text-[10px] text-text-dim/70 italic px-2 pb-2">
            No stances.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {sectionRows.map(renderRow)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/2.5 backdrop-blur-xl h-full overflow-hidden panel-raise">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/15 to-transparent" />
      <div className="absolute inset-0 flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] uppercase tracking-[0.18em] text-text-dim">
            Stances
          </h3>
          <span className="text-[10px] text-text-dim font-mono tabular-nums">
            {filtered.length}
            {filtered.length !== rows.length ? ` / ${rows.length}` : ''}
          </span>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stances…"
          className="text-[11px] bg-transparent border-b border-white/8 px-2 py-1.5 text-text-primary placeholder:text-text-dim focus:outline-none focus:border-white/20 transition-colors"
        />
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col pr-1">
          {filtered.length === 0 ? (
            <p className="text-[10px] text-text-dim italic px-2 py-3">
              No matches.
            </p>
          ) : (
            <>
              {renderSection('In focus', focusRows, '#FBBF24')}
              {renderSection('Out of focus', otherRows)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sparkline — lightweight SVG line chart for KPI trends ──────────────────

function Sparkline({
  values,
  color,
  fill,
  yMin,
  yMax,
}: {
  values: number[];
  color: string;
  fill?: string;
  yMin?: number;
  yMax?: number;
}) {
  if (values.length === 0) {
    return (
      <div className="h-10 w-full flex items-center justify-center text-[9px] text-text-dim/60">
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
  const xAt = (i: number) =>
    n === 1 ? W / 2 : pad + (i / (n - 1)) * (W - pad * 2);
  const yAt = (v: number) =>
    pad + (1 - (v - minY) / range) * (H - pad * 2);
  const linePath = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${xAt(n - 1).toFixed(1)} ${H - pad} L ${xAt(0).toFixed(1)} ${H - pad} Z`;
  const last = values[values.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-10 w-full"
      aria-hidden="true"
    >
      {fill && <path d={areaPath} fill={fill} />}
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xAt(n - 1)} cy={yAt(last)} r={1.6} fill={color} />
    </svg>
  );
}

// ── KPI trend card — current value + sparkline + delta vs. start ───────────

function KPITrendCard({
  label,
  points,
  valueFn,
  formatValue,
  formatDelta,
  hint,
  accent,
  yMin,
  yMax,
  deltaBetter,
}: {
  label: string;
  points: PortfolioTrajectoryPoint[];
  valueFn: (p: PortfolioTrajectoryPoint) => number;
  formatValue: (v: number) => string;
  formatDelta?: (d: number) => string;
  hint?: string;
  accent?: string;
  yMin?: number;
  yMax?: number;
  /** Which direction of movement is "good" (green). For uncertainty, falling
   *  might be positive; for attention, rising is positive. Defaults to "up". */
  deltaBetter?: 'up' | 'down' | 'neutral';
}) {
  const values = useMemo(() => points.map(valueFn), [points, valueFn]);
  const hasData = values.length > 0;
  const current = hasData ? values[values.length - 1] : 0;
  const start = hasData ? values[0] : 0;
  const peak = hasData ? Math.max(...values) : 0;
  const delta = current - start;
  const showDelta = hasData && values.length > 1 && Math.abs(delta) > 1e-6;
  const better = deltaBetter ?? 'up';
  const deltaColor =
    !showDelta || better === 'neutral'
      ? 'var(--color-text-dim)'
      : (delta > 0 && better === 'up') || (delta < 0 && better === 'down')
        ? '#34d399'
        : '#fb7185';
  const lineColor = accent ?? '#38bdf8';
  const fillColor = `${lineColor}22`;
  return (
    <div
      className="relative flex flex-col gap-1.5 p-3.5 rounded-xl border border-white/8 bg-white/2.5 backdrop-blur-xl min-w-0 overflow-hidden panel-raise-sm"
      title={hint}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/12 to-transparent" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-text-dim truncate">
          {label}
        </span>
        {showDelta && (
          <span
            className="text-[10px] font-mono tabular-nums shrink-0"
            style={{ color: deltaColor }}
            title={`Change since scene ${points[0].sceneOrdinal}: ${formatDelta ? formatDelta(delta) : delta.toFixed(2)}`}
          >
            {delta >= 0 ? '▲' : '▼'}
            {formatDelta ? formatDelta(Math.abs(delta)) : Math.abs(delta).toFixed(2)}
          </span>
        )}
      </div>
      <span
        className="text-lg font-mono tabular-nums leading-tight"
        style={{ color: lineColor }}
      >
        {hasData ? formatValue(current) : '—'}
      </span>
      <Sparkline
        values={values}
        color={lineColor}
        fill={fillColor}
        yMin={yMin}
        yMax={yMax}
      />
      {hasData && (
        <div className="flex items-center justify-between text-[9px] text-text-dim font-mono tabular-nums">
          <span title={`Value at first charted scene (scene ${points[0].sceneOrdinal}).`}>
            start {formatValue(start)}
          </span>
          <span title="Highest value reached across the charted window.">
            peak {formatValue(peak)}
          </span>
          <span title={`Scenes covered by this trend (up to scene ${points[points.length - 1].sceneOrdinal}).`}>
            {values.length} scn
          </span>
        </div>
      )}
    </div>
  );
}

// ── Instrument: category distribution ──────────────────────────────────────

function CategoryBreakdown({ rows }: { rows: PortfolioRow[] }) {
  const total = rows.length || 1;
  const counts: Record<ThreadCategory, number> = {
    saturating: 0,
    contested: 0,
    volatile: 0,
    committed: 0,
    developing: 0,
    dormant: 0,
    resolved: 0,
    abandoned: 0,
  };
  for (const r of rows) counts[r.category]++;
  const order: ThreadCategory[] = [
    'saturating',
    'volatile',
    'contested',
    'committed',
    'developing',
    'dormant',
    'resolved',
    'abandoned',
  ];
  return (
    <div className="relative flex flex-col gap-3 p-4 rounded-xl border border-white/8 bg-white/2.5 backdrop-blur-xl overflow-hidden panel-raise-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-text-dim">
          Category mix
        </h3>
        <span className="text-[10px] text-text-dim font-mono tabular-nums">
          {total} stances
        </span>
      </div>
      {/* Stacked bar */}
      <div className="h-1.5 w-full flex rounded-full overflow-hidden bg-white/5">
        {order.map((cat) =>
          counts[cat] === 0 ? null : (
            <div
              key={cat}
              title={`${THREAD_CATEGORY_LABEL[cat]} · ${counts[cat]}`}
              style={{
                width: `${(counts[cat] / total) * 100}%`,
                background: THREAD_CATEGORY_HEX[cat],
              }}
            />
          ),
        )}
      </div>
      {/* Legend with counts */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {order.map((cat) => (
          <div key={cat} className="flex items-center gap-2 text-[11px]">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: THREAD_CATEGORY_HEX[cat] }}
            />
            <span className="text-text-secondary capitalize flex-1">{cat}</span>
            <span className="font-mono tabular-nums text-text-primary">
              {counts[cat]}
            </span>
            <span className="text-text-dim font-mono tabular-nums w-8 text-right">
              {Math.round((counts[cat] / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Instrument: resolution quality bands ───────────────────────────────────

function ResolutionQualityPanel({
  snapshot,
}: {
  snapshot: ReturnType<typeof computePortfolioSnapshot>;
}) {
  const bands = snapshot.resolutionQualityBands;
  const total = bands.earned + bands.adequate + bands.thin;
  const avg = snapshot.averageResolutionQuality;
  const items: Array<{ label: string; count: number; color: string; hint: string }> = [
    { label: 'Earned', count: bands.earned, color: '#34D399', hint: 'Resolution quality ≥ 0.7' },
    { label: 'Adequate', count: bands.adequate, color: '#FBBF24', hint: '0.4 ≤ quality < 0.7' },
    { label: 'Thin', count: bands.thin, color: '#FB7185', hint: 'Quality < 0.4' },
  ];
  return (
    <div className="relative flex flex-col gap-3 p-4 rounded-xl border border-white/8 bg-white/2.5 backdrop-blur-xl overflow-hidden panel-raise-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-text-dim">
          Resolution quality
        </h3>
        <span className="text-[10px] text-text-dim font-mono tabular-nums">
          {avg !== null ? `avg ${Math.round(avg * 100)}%` : 'no closures'}
        </span>
      </div>
      {total === 0 ? (
        <p className="text-[11px] text-text-dim">
          No stances have closed yet. Quality is scored at payoff.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it) => (
            <div key={it.label} className="flex flex-col gap-1" title={it.hint}>
              <div className="flex items-center gap-2 text-[11px]">
                <span
                  className="w-2 h-2 rounded-sm shrink-0"
                  style={{ background: it.color }}
                />
                <span className="text-text-secondary flex-1">{it.label}</span>
                <span className="font-mono tabular-nums text-text-primary">
                  {it.count}
                </span>
                <span className="text-text-dim font-mono tabular-nums w-8 text-right">
                  {Math.round((it.count / total) * 100)}%
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full"
                  style={{
                    width: `${(it.count / total) * 100}%`,
                    background: it.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Instrument: volatility leaders ─────────────────────────────────────────

// ── Instrument: top movers (probability shift vs. N scenes ago) ───────────

function TopMovers({
  movements,
  rowsById,
  lookback,
  onSelect,
}: {
  movements: ThreadMovement[];
  rowsById: Map<string, PortfolioRow>;
  lookback: number;
  onSelect: (id: string) => void;
}) {
  const top = movements.filter((m) => Math.abs(m.deltaProb) >= 0.01).slice(0, 5);
  return (
    <div className="relative flex flex-col gap-3 p-4 rounded-xl border border-white/8 bg-white/2.5 backdrop-blur-xl overflow-hidden panel-raise-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-text-dim">
          Top movers
        </h3>
        <span
          className="text-[10px] text-text-dim"
          title={`Change in leading-outcome probability vs. ${lookback} scenes ago.`}
        >
          vs −{lookback} scenes
        </span>
      </div>
      {top.length === 0 ? (
        <p className="text-[11px] text-text-dim">No material movement in the window.</p>
      ) : (
        <div className="flex flex-col">
          {top.map((m) => {
            const row = rowsById.get(m.threadId);
            const up = m.deltaProb >= 0;
            const deltaPct = (m.deltaProb * 100).toFixed(1);
            const accent = up ? '#34D399' : '#FB7185';
            return (
              <button
                key={m.threadId}
                onClick={() => onSelect(m.threadId)}
                className="group flex items-center gap-2 py-1.5 border-b border-white/4 last:border-b-0 hover:bg-white/3 transition-colors text-left -mx-1 px-1"
              >
                <span
                  className="text-[10px] font-mono tabular-nums w-8 text-right shrink-0"
                  style={{ color: accent }}
                >
                  {up ? '▲' : '▼'}
                  {Math.abs(Number(deltaPct))}%
                </span>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-[11px] text-text-primary leading-snug">
                    {row?.thread.description ?? m.threadId}
                  </span>
                  <span className="text-[10px] text-text-dim font-mono">
                    {m.topOutcome}{' '}
                    <span className="text-text-dim/70">
                      {Math.round(m.priorProb * 100)}% → {Math.round(m.nowProb * 100)}%
                    </span>
                  </span>
                </div>
                {row && (
                  <span
                    className="text-[9px] uppercase tracking-wider shrink-0"
                    style={{ color: THREAD_CATEGORY_HEX[row.category] }}
                    title={THREAD_CATEGORY_DESCRIPTION[row.category]}
                  >
                    {THREAD_CATEGORY_LABEL[row.category]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Instrument: volatility leaders (EWMA of recent shock) ──────────────────

function VolatilityLeaders({
  rows,
  onSelect,
}: {
  rows: PortfolioRow[];
  onSelect: (id: string) => void;
}) {
  const leaders = rows
    .filter((r) => r.category !== 'resolved' && r.category !== 'abandoned')
    .slice()
    .sort((a, b) => b.volatility - a.volatility)
    .slice(0, 5);
  return (
    <div className="relative flex flex-col gap-3 p-4 rounded-xl border border-white/8 bg-white/2.5 backdrop-blur-xl overflow-hidden panel-raise-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-text-dim">
          Volatility leaders
        </h3>
        <span className="text-[10px] text-text-dim">top {leaders.length}</span>
      </div>
      {leaders.length === 0 ? (
        <p className="text-[11px] text-text-dim">No live stances.</p>
      ) : (
        <div className="flex flex-col">
          {leaders.map((row, i) => {
            const maxVol = leaders[0].volatility || 1;
            const pct = (row.volatility / maxVol) * 100;
            return (
              <button
                key={row.thread.id}
                onClick={() => onSelect(row.thread.id)}
                className="group flex items-center gap-2 py-1.5 border-b border-white/4 last:border-b-0 hover:bg-white/3 transition-colors text-left -mx-1 px-1"
              >
                <span className="text-[10px] text-text-dim font-mono tabular-nums w-4 text-right shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-[11px] text-text-primary leading-snug">
                    {row.thread.description}
                  </span>
                  <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: THREAD_CATEGORY_HEX[row.category],
                      }}
                    />
                  </div>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-text-primary shrink-0">
                  σ{row.volatility.toFixed(2)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Instrument: entropy distribution (how contested is the portfolio) ──────

function EntropyHistogram({ rows }: { rows: PortfolioRow[] }) {
  const live = rows.filter(
    (r) => r.category !== 'resolved' && r.category !== 'abandoned',
  );
  const bins = [0, 0, 0, 0, 0]; // 0–20 / 20–40 / 40–60 / 60–80 / 80–100
  for (const r of live) {
    const b = Math.min(4, Math.floor(r.entropy * 5));
    bins[b]++;
  }
  const maxBin = Math.max(1, ...bins);
  const labels = ['0–20', '20–40', '40–60', '60–80', '80–100'];
  return (
    <div className="relative flex flex-col gap-3 p-4 rounded-xl border border-white/8 bg-white/2.5 backdrop-blur-xl overflow-hidden panel-raise-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-text-dim">
          Uncertainty distribution
        </h3>
        <span className="text-[10px] text-text-dim font-mono tabular-nums">
          {live.length} live
        </span>
      </div>
      {live.length === 0 ? (
        <p className="text-[11px] text-text-dim">No live stances.</p>
      ) : (
        <div className="flex items-end gap-1.5 h-20">
          {bins.map((count, i) => {
            const h = (count / maxBin) * 100;
            return (
              <div
                key={i}
                className="flex-1 flex flex-col items-center gap-1 min-w-0"
                title={`${labels[i]}% entropy · ${count} stances`}
              >
                <span className="text-[9px] text-text-dim font-mono tabular-nums">
                  {count}
                </span>
                <div className="w-full flex-1 flex items-end">
                  <div
                    className="w-full rounded-sm"
                    style={{
                      height: `${Math.max(h, 2)}%`,
                      background: '#38BDF8',
                      opacity: 0.4 + 0.12 * i,
                    }}
                  />
                </div>
                <span className="text-[9px] text-text-dim font-mono tabular-nums">
                  {labels[i]}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Portfolio headline (stats across top) ──────────────────────────────────

function PortfolioHeadline({
  snapshot,
  focusCount,
  focusK,
}: {
  snapshot: ReturnType<typeof computePortfolioSnapshot>;
  focusCount: number;
  focusK: number;
}) {
  const uncertaintyPct = Math.round(snapshot.averageEntropy * 100);
  const item = (value: string, label: string, hint?: string) => (
    <div className="flex flex-col" title={hint}>
      <span className="text-base text-text-primary font-mono tabular-nums">{value}</span>
      <span className="text-[10px] text-text-dim">{label}</span>
    </div>
  );
  return (
    <div className="flex items-center gap-6 flex-wrap">
      {item(String(snapshot.totalThreads), 'stances')}
      <span className="text-text-dim/30">|</span>
      {item(String(snapshot.activeThreads), 'open')}
      <span className="text-text-dim/30">|</span>
      {item(`${focusCount}/${focusK}`, 'in focus')}
      <span className="text-text-dim/30">|</span>
      {item(
        `${uncertaintyPct}%`,
        'uncertain',
        'Average entropy across open stances — higher = more contested.',
      )}
      <span className="text-text-dim/30">|</span>
      {item(snapshot.beliefCap.toFixed(0), 'attention', 'Total volume across open stances.')}
      {snapshot.closedThreads > 0 && (
        <>
          <span className="text-text-dim/30">|</span>
          {item(String(snapshot.closedThreads), 'resolved')}
        </>
      )}
    </div>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────

export default function BeliefView() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;
  const currentIndex = state.viewState.currentSceneIndex;

  // Point-in-time replay — the whole dashboard moves with the scrubber.
  // We include every thread in the narrative (introduced or not) so the list
  // mirrors what the graph view shows. Threads that haven't opened yet appear
  // at uniform prior with no volume — they'll land in "Out of focus".
  const scrubbedNarrative: NarrativeState | null = useMemo(() => {
    if (!narrative) return null;
    const threadsAtIndex = replayThreadsAtIndex(narrative, resolvedKeys, currentIndex);
    return { ...narrative, threads: threadsAtIndex };
  }, [narrative, resolvedKeys, currentIndex]);

  const rows = useMemo(() => {
    if (!scrubbedNarrative) return [];
    return buildPortfolioRows(scrubbedNarrative, resolvedKeys, currentIndex);
  }, [scrubbedNarrative, resolvedKeys, currentIndex]);

  const snapshot = useMemo(() => {
    if (!scrubbedNarrative) return null;
    return computePortfolioSnapshot(scrubbedNarrative);
  }, [scrubbedNarrative]);

  const focusIds = useMemo(() => {
    if (!scrubbedNarrative) return new Set<string>();
    return currentFocusIds(scrubbedNarrative, resolvedKeys, currentIndex);
  }, [scrubbedNarrative, resolvedKeys, currentIndex]);

  // Featured thread — local to this view. Seeded once from the focus set; the
  // selection then sticks across scene changes (scrubber moves data, not the
  // picked stance). Re-seeds only when the prior selection becomes invalid.
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedThreadId && scrubbedNarrative?.threads[selectedThreadId]) return;
    const seed =
      rows.find((r) => focusIds.has(r.thread.id))?.thread.id ??
      rows.find((r) => r.category !== 'resolved' && r.category !== 'abandoned')?.thread.id ??
      rows[0]?.thread.id;
    if (seed) setSelectedThreadId(seed);
  }, [selectedThreadId, scrubbedNarrative, rows, focusIds]);

  const featuredId = selectedThreadId && scrubbedNarrative?.threads[selectedThreadId] ? selectedThreadId : null;

  const featuredThread = featuredId ? scrubbedNarrative?.threads[featuredId] : null;
  const featuredRow = rows.find((r) => r.thread.id === featuredId);
  const featuredTrajectory = useMemo(() => {
    if (!narrative || !featuredId) return [] as ThreadTrajectoryPoint[];
    return buildThreadTrajectory(narrative, featuredId, resolvedKeys.slice(0, currentIndex + 1));
  }, [narrative, featuredId, resolvedKeys, currentIndex]);

  // Category filter state — applied to the All Stances grid only.
  const [catFilter, setCatFilter] = useState<CategoryFilter>('all');
  const filterCounts: Record<CategoryFilter, number> = {
    all: rows.length,
    saturating: 0,
    contested: 0,
    volatile: 0,
    committed: 0,
    developing: 0,
    dormant: 0,
    resolved: 0,
    abandoned: 0,
  };
  for (const r of rows) filterCounts[r.category]++;

  const filteredRows = useMemo(() => {
    if (catFilter === 'all') return rows;
    return rows.filter((r) => r.category === catFilter);
  }, [rows, catFilter]);

  // Movers — probability shift over the last N scenes. Default window of 5
  // matches the analyst's "what happened recently?" glance. Short-circuit for
  // empty narratives so we don't waste a replay pass.
  const MOVERS_LOOKBACK = 5;
  const movements = useMemo(() => {
    if (!narrative) return [] as ThreadMovement[];
    return computeRecentMovements(narrative, resolvedKeys, currentIndex, MOVERS_LOOKBACK);
  }, [narrative, resolvedKeys, currentIndex]);
  const rowsById = useMemo(() => {
    const m = new Map<string, PortfolioRow>();
    for (const r of rows) m.set(r.thread.id, r);
    return m;
  }, [rows]);

  // Portfolio trajectory — scene-by-scene snapshot of every KPI. One pass
  // over the timeline; feeds every Overview sparkline card.
  const trajectory = useMemo(() => {
    if (!narrative) return [] as PortfolioTrajectoryPoint[];
    return buildPortfolioTrajectory(narrative, resolvedKeys, currentIndex);
  }, [narrative, resolvedKeys, currentIndex]);

  if (!narrative) {
    return (
      <div className="h-full w-full flex items-center justify-center text-[11px] text-text-dim">
        Select a narrative to view its belief.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-[11px] text-text-dim">
        No stances open yet — threads will appear here once scenes begin producing evidence.
      </div>
    );
  }

  const selectThread = (id: string) => {
    setSelectedThreadId(id);
    dispatch({ type: 'SELECT_THREAD_LOG', threadId: id });
    dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: id } });
  };

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-5 flex flex-col gap-5">
        {/* Portfolio headline */}
        {snapshot && (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <PortfolioHeadline snapshot={snapshot} focusCount={focusIds.size} focusK={6} />
            <span className="text-[10px] text-text-dim">
              Passive observer · scene{' '}
              {Math.max(1, sceneOrdinalAt(narrative, resolvedKeys, currentIndex))} of{' '}
              {countScenes(narrative, resolvedKeys)}
            </span>
          </div>
        )}

        {/* 1. Drill-down — featured stance + stance list, up top per user preference. */}
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] uppercase tracking-widest text-text-dim">
            Drill-down
          </h2>
          <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-4 items-stretch">
            {featuredThread && featuredRow ? (
              <FeaturedStance
                thread={featuredThread}
                points={featuredTrajectory}
                category={featuredRow.category}
              />
            ) : (
              <div className="rounded-xl border border-white/8 p-6 text-[11px] text-text-dim">
                Select a stance to feature.
              </div>
            )}
            <StanceListSidebar
              rows={rows}
              focusIds={focusIds}
              selectedId={featuredId}
              onSelect={selectThread}
            />
          </div>
        </div>

        {/* 2. Overview — KPI trend cards (current value + sparkline). */}
        {snapshot && (
          <div className="flex flex-col gap-2">
            <h2 className="text-[11px] uppercase tracking-widest text-text-dim">
              Overview
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                <KPITrendCard
                  label="Attention"
                  points={trajectory}
                  valueFn={(p) => p.attention}
                  formatValue={(v) => v.toFixed(0)}
                  formatDelta={(d) => d.toFixed(1)}
                  hint={
                    "ATTENTION over time — cumulative volume across open stances, scene by scene.\n\nRising = the world view is loading more narrative weight onto active threads. Falling = attention is decaying faster than new evidence is coming in."
                  }
                  accent="#38bdf8"
                  deltaBetter="up"
                />
                <KPITrendCard
                  label="Uncertainty"
                  points={trajectory}
                  valueFn={(p) => p.uncertainty * 100}
                  formatValue={(v) => `${Math.round(v)}%`}
                  formatDelta={(d) => `${d.toFixed(1)}pp`}
                  hint={
                    "UNCERTAINTY over time — average normalized entropy across open stances.\n\n100% = every outcome equally likely. A healthy arc usually trends down as stances commit; a flat-high line means the world view isn't paying off its questions."
                  }
                  accent="#fbbf24"
                  yMin={0}
                  yMax={100}
                  deltaBetter="down"
                />
                <KPITrendCard
                  label="Volatility"
                  points={trajectory}
                  valueFn={(p) => p.volatility}
                  formatValue={(v) => `σ ${v.toFixed(2)}`}
                  formatDelta={(d) => d.toFixed(2)}
                  hint={
                    "VOLATILITY over time — average EWMA of recent evidence magnitude.\n\nSpikes mark scenes where multiple stances took large shocks. Flat = quiet stretch. Use this to spot when the world view entered a turbulent phase."
                  }
                  accent="#a78bfa"
                  deltaBetter="neutral"
                />
                <KPITrendCard
                  label="Saturation"
                  points={trajectory}
                  valueFn={(p) => p.saturationRate * 100}
                  formatValue={(v) => `${Math.round(v)}%`}
                  formatDelta={(d) => `${d.toFixed(1)}pp`}
                  hint={
                    "SATURATION over time — share of live stances within the near-closure band.\n\nRises before climactic stretches (many stances converging on a decision). Sudden drop = a wave of closures fired."
                  }
                  accent={THREAD_CATEGORY_HEX.saturating}
                  yMin={0}
                  yMax={100}
                  deltaBetter="up"
                />
                <KPITrendCard
                  label="Contested"
                  points={trajectory}
                  valueFn={(p) => p.contestedRate * 100}
                  formatValue={(v) => `${Math.round(v)}%`}
                  formatDelta={(d) => `${d.toFixed(1)}pp`}
                  hint={
                    "CONTESTED over time — share of live stances with entropy ≥ 70%.\n\nHigh contested rate = the world view is keeping questions open. Falls as stances commit; a late climb usually signals fresh questions being opened."
                  }
                  accent={THREAD_CATEGORY_HEX.contested}
                  yMin={0}
                  yMax={100}
                  deltaBetter="neutral"
                />
                <KPITrendCard
                  label="Resolved"
                  points={trajectory}
                  valueFn={(p) => p.closedCount}
                  formatValue={(v) => String(Math.round(v))}
                  formatDelta={(d) => `+${Math.round(d)}`}
                  hint={
                    "RESOLVED over time — cumulative count of stances that have closed.\n\nMonotonically non-decreasing. Flat = no closures; steep step = a payoff beat just landed. Gives you the resolution rhythm of the world view."
                  }
                  accent={THREAD_CATEGORY_HEX.resolved}
                  deltaBetter="up"
                />
            </div>
          </div>
        )}

        {/* 3. Movers — what shifted since the analyst last looked. */}
        {rows.length > 0 && (
          <div className="flex flex-col gap-2">
            <h2 className="text-[11px] uppercase tracking-widest text-text-dim">
              Movers
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TopMovers
                movements={movements}
                rowsById={rowsById}
                lookback={MOVERS_LOOKBACK}
                onSelect={selectThread}
              />
              <VolatilityLeaders rows={rows} onSelect={selectThread} />
            </div>
          </div>
        )}

        {/* 4. Composition — how the portfolio is shaped. */}
        {snapshot && rows.length > 0 && (
          <div className="flex flex-col gap-2">
            <h2 className="text-[11px] uppercase tracking-widest text-text-dim">
              Composition
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <CategoryBreakdown rows={rows} />
              <EntropyHistogram rows={rows} />
              <ResolutionQualityPanel snapshot={snapshot} />
            </div>
          </div>
        )}

        {/* 5. Screener — all stances, filterable by category. */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[11px] uppercase tracking-widest text-text-dim">
                Screener
              </h2>
              <span className="text-[10px] text-text-dim/70">all stances</span>
            </div>
            <span className="text-[10px] text-text-dim">
              {filteredRows.length} shown
            </span>
          </div>
          <CategoryFilterBar active={catFilter} onChange={setCatFilter} counts={filterCounts} />
          {(() => {
            const focusGrid = filteredRows.filter((r) => focusIds.has(r.thread.id));
            const otherGrid = filteredRows.filter((r) => !focusIds.has(r.thread.id));
            const section = (
              title: string,
              list: PortfolioRow[],
              accent?: string,
            ) => {
              if (list.length === 0) return null;
              return (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h3
                      className="text-[11px] uppercase tracking-widest font-medium"
                      style={{ color: accent ?? 'var(--color-text-dim)' }}
                    >
                      {title}
                    </h3>
                    <span className="text-[10px] text-text-dim font-mono tabular-nums">
                      {list.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {list.map((row) => (
                      <StanceCard
                        key={row.thread.id}
                        row={row}
                        inFocus={focusIds.has(row.thread.id)}
                        onSelect={() => selectThread(row.thread.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            };
            return (
              <>
                {section('In focus', focusGrid, '#FBBF24')}
                {section('Out of focus', otherGrid)}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
