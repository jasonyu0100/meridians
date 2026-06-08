'use client';

/**
 * Stream belief dashboard — the Stream surface of Mind → Belief, mirroring the
 * Thread dashboard ([BeliefView]) but sourced from the room's member-owned
 * Streams. Threads and Streams share the belief mechanics (stance, outcomes,
 * trajectory, category), so the layout is identical: headline, drill-down
 * (featured stream + sidebar), overview KPI sparklines, movers, composition,
 * and a category-filtered screener.
 *
 * Unlike the Thread surface this is HEAD-based — streams are driven by priors
 * stamped in wall-clock time, not scenes, so there's no scrubber. Aggregate
 * analytics come from `lib/analysis/stream-portfolio`.
 */

import { useMemo, useState } from 'react';
import type { Stream } from '@/types/narrative';
import { useStore } from '@/lib/state/store';
import { Sparkline, TrajectoryChart } from '@/components/shared/charts';
import {
  buildStreamRows,
  computeStreamSnapshot,
  buildStreamPortfolioTrajectory,
  computeStreamMovers,
  currentStreamFocusIds,
  type StreamRow,
  type StreamSnapshot,
  type StreamTrajectoryAggPoint,
  type StreamMovement,
} from '@/lib/analysis/stream-portfolio';
import {
  THREAD_CATEGORY_HEX,
  THREAD_CATEGORY_LABEL,
  THREAD_CATEGORY_DESCRIPTION,
  outcomeColourHex,
  type ThreadCategory,
} from '@/lib/forces/thread-category';
import { streamTrajectory } from '@/lib/forces/stream-stance';
import { streamsForBranch } from '@/lib/merges';
import { PerspectivePairBadge } from './RoomUI';

// ── Category filter chips ──────────────────────────────────────────────────

type CategoryFilter = 'all' | ThreadCategory;

const CATEGORY_FILTER_ORDER: CategoryFilter[] = [
  'all',
  'saturating',
  'contested',
  'volatile',
  'committed',
  'developing',
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

// ── Featured stream trajectory (probability-over-priors lines) ──────────────

function FeaturedTrajectory({ stream }: { stream: Stream }) {
  const traj = streamTrajectory(stream);
  return (
    <TrajectoryChart
      points={traj}
      outcomeCount={(stream.outcomes ?? []).length}
      colourOf={(k) => outcomeColourHex(k)}
      axes
      endpointDots
      xLeft="opened"
      xRight={`${traj.length} ${traj.length === 1 ? 'prior' : 'priors'}`}
    />
  );
}

// ── Featured stream panel ──────────────────────────────────────────────────

function FeaturedStream({ row }: { row: StreamRow }) {
  const { stream, probs, topIdx, margin, volume, volatility, category } = row;
  const outcomes = stream.outcomes ?? [];
  const ranked = outcomes
    .map((o, i) => ({ outcome: o, idx: i, prob: probs[i] ?? 0 }))
    .sort((a, b) => b.prob - a.prob);
  const catColor = THREAD_CATEGORY_HEX[category];
  const { state } = useStore();
  const n = state.activeNarrative;

  return (
    <div className="relative flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/2.5 backdrop-blur-xl p-6 panel-raise overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/15 to-transparent" />
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col min-w-0 gap-1.5">
          <div className="flex items-center gap-2 text-[10px] text-text-dim uppercase tracking-wider">
            <span
              className="font-medium"
              style={{ color: catColor }}
              title={THREAD_CATEGORY_DESCRIPTION[category]}
            >
              {THREAD_CATEGORY_LABEL[category]}
            </span>
            <span className="text-text-dim/40">·</span>
            <span>{stream.priors.length} {stream.priors.length === 1 ? 'prior' : 'priors'}</span>
            {stream.inferred && <><span className="text-text-dim/40">·</span><span className="text-amber-400/70 italic normal-case">inferred</span></>}
          </div>
          <h2 className="text-lg font-semibold text-text-primary leading-tight wrap-break-word">
            {stream.title}
          </h2>
          <PerspectivePairBadge memberId={stream.memberId} agentId={stream.agentId} perspectiveId={stream.perspectiveId} n={n} size={20} />
        </div>
        <div className="flex items-baseline gap-4 text-[10px] text-text-dim shrink-0">
          <div className="flex flex-col items-end">
            <span className="text-sm text-text-primary font-mono tabular-nums">{volume.toFixed(1)}</span>
            <span>volume</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-sm text-text-primary font-mono tabular-nums">Δ{margin.toFixed(1)}</span>
            <span>margin</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-sm text-text-primary font-mono tabular-nums">{volatility.toFixed(2)}</span>
            <span>volatility</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(220px,280px)_1fr] gap-4 items-center">
        <div className="flex flex-col gap-2 self-center">
          {ranked.map(({ outcome, idx, prob }) => (
            <div key={`${outcome}-${idx}`} className="flex items-start gap-2">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0 mt-1" style={{ background: outcomeColourHex(idx) }} />
              <span className="text-xs text-text-primary flex-1 wrap-break-word min-w-0 leading-snug">{outcome}</span>
              <span className="text-sm font-semibold font-mono tabular-nums text-text-primary shrink-0">{Math.round(prob * 100)}%</span>
            </div>
          ))}
          {stream.closedAt && (
            <div className="mt-2 pt-2 border-t border-white/5 text-[10px] text-text-dim">
              Resolved →{' '}
              <span style={{ color: catColor }}>{outcomes[stream.closeOutcome ?? topIdx]}</span>
              {stream.resolutionQuality !== undefined && (
                <> · quality <span className="font-mono tabular-nums">{Math.round(stream.resolutionQuality * 100)}%</span></>
              )}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <FeaturedTrajectory stream={stream} />
        </div>
      </div>
    </div>
  );
}

// ── Stream list sidebar ─────────────────────────────────────────────────────

function StreamListSidebar({
  rows,
  focusIds,
  selectedId,
  onSelect,
}: {
  rows: StreamRow[];
  focusIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = query.trim()
    ? rows.filter((r) => r.stream.title.toLowerCase().includes(query.toLowerCase()))
    : rows;
  const focusRows = filtered.filter((r) => focusIds.has(r.stream.id));
  const otherRows = filtered.filter((r) => !focusIds.has(r.stream.id));

  const renderRow = (row: StreamRow) => {
    const isSelected = selectedId === row.stream.id;
    const catColor = THREAD_CATEGORY_HEX[row.category];
    const topProb = row.probs[row.topIdx] ?? 0;
    const dimmed = row.category === 'resolved' || row.category === 'abandoned';
    return (
      <button
        key={row.stream.id}
        onClick={() => onSelect(row.stream.id)}
        className={`group flex items-start gap-2 py-1.5 px-2 rounded-md transition-colors text-left border-l-2 ${
          isSelected ? 'bg-white/8' : 'hover:bg-white/3 border-transparent'
        } ${dimmed ? 'opacity-55' : ''}`}
        style={isSelected ? { borderLeftColor: catColor } : { borderLeftColor: 'transparent' }}
      >
        <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: catColor }} title={THREAD_CATEGORY_DESCRIPTION[row.category]} />
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-[10px] text-text-dim">
            <span className="capitalize" style={{ color: catColor }}>{THREAD_CATEGORY_LABEL[row.category]}</span>
            <span className="ml-auto font-mono tabular-nums text-[9px] px-1.5 py-px rounded-sm border border-white/10 bg-white/5 text-text-secondary shrink-0"
              title={`Focus = volume × (0.15 + entropy) × (1 + volatility)\n\nvolume ${row.volume.toFixed(1)} · entropy ${row.entropy.toFixed(2)} · volatility ${row.volatility.toFixed(2)}`}>
              {row.focus >= 10 ? row.focus.toFixed(1) : row.focus >= 1 ? row.focus.toFixed(2) : row.focus.toFixed(3)}
            </span>
          </div>
          <p className="text-[11px] text-text-primary leading-snug wrap-break-word">{row.stream.title}</p>
          <div className="flex items-center gap-2 text-[10px] text-text-dim">
            <span className="font-mono truncate">{(row.stream.outcomes ?? [])[row.topIdx]}</span>
            <span className="ml-auto font-mono tabular-nums text-text-primary shrink-0">{Math.round(topProb * 100)}%</span>
          </div>
        </div>
      </button>
    );
  };

  const renderSection = (title: string, sectionRows: StreamRow[], accentColor?: string) => (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-2 pt-2 pb-1.5">
        <span className="text-[9px] uppercase tracking-[0.14em] font-medium" style={{ color: accentColor ?? 'var(--color-text-dim)' }}>{title}</span>
        <span className="flex-1 h-px bg-white/5" />
        <span className="text-[9px] text-text-dim font-mono tabular-nums">{sectionRows.length}</span>
      </div>
      {sectionRows.length === 0 ? (
        <p className="text-[10px] text-text-dim/70 italic px-2 pb-2">No streams.</p>
      ) : (
        <div className="flex flex-col gap-0.5">{sectionRows.map(renderRow)}</div>
      )}
    </div>
  );

  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/2.5 backdrop-blur-xl h-full overflow-hidden panel-raise">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/15 to-transparent" />
      <div className="absolute inset-0 flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] uppercase tracking-[0.18em] text-text-dim">Streams</h3>
          <span className="text-[10px] text-text-dim font-mono tabular-nums">
            {filtered.length}{filtered.length !== rows.length ? ` / ${rows.length}` : ''}
          </span>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search streams…"
          className="text-[11px] bg-transparent border-b border-white/8 px-2 py-1.5 text-text-primary placeholder:text-text-dim focus:outline-none focus:border-white/20 transition-colors"
        />
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col pr-1">
          {filtered.length === 0 ? (
            <p className="text-[10px] text-text-dim italic px-2 py-3">No matches.</p>
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

// ── KPI card ─────────────────────────────────────────────────────────────────

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
  points: StreamTrajectoryAggPoint[];
  valueFn: (p: StreamTrajectoryAggPoint) => number;
  formatValue: (v: number) => string;
  formatDelta?: (d: number) => string;
  hint?: string;
  accent?: string;
  yMin?: number;
  yMax?: number;
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
    <div className="relative flex flex-col gap-1.5 p-3.5 rounded-xl border border-white/8 bg-white/2.5 backdrop-blur-xl min-w-0 overflow-hidden panel-raise-sm" title={hint}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/12 to-transparent" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-text-dim truncate">{label}</span>
        {showDelta && (
          <span className="text-[10px] font-mono tabular-nums shrink-0" style={{ color: deltaColor }}>
            {delta >= 0 ? '▲' : '▼'}{formatDelta ? formatDelta(Math.abs(delta)) : Math.abs(delta).toFixed(2)}
          </span>
        )}
      </div>
      <span className="text-lg font-mono tabular-nums leading-tight" style={{ color: lineColor }}>
        {hasData ? formatValue(current) : '—'}
      </span>
      <Sparkline values={values} color={lineColor} fill={fillColor} yMin={yMin} yMax={yMax} />
      {hasData && (
        <div className="flex items-center justify-between text-[9px] text-text-dim font-mono tabular-nums">
          <span>start {formatValue(start)}</span>
          <span>peak {formatValue(peak)}</span>
          <span>{values.length} evt</span>
        </div>
      )}
    </div>
  );
}

// ── Composition instruments ──────────────────────────────────────────────────

function CategoryBreakdown({ rows }: { rows: StreamRow[] }) {
  const total = rows.length || 1;
  const counts: Record<ThreadCategory, number> = {
    saturating: 0, contested: 0, volatile: 0, committed: 0, developing: 0, dormant: 0, resolved: 0, abandoned: 0,
  };
  for (const r of rows) counts[r.category]++;
  const order: ThreadCategory[] = ['saturating', 'volatile', 'contested', 'committed', 'developing', 'dormant', 'resolved', 'abandoned'];
  return (
    <div className="relative flex flex-col gap-3 p-4 rounded-xl border border-white/8 bg-white/2.5 backdrop-blur-xl overflow-hidden panel-raise-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-text-dim">Category mix</h3>
        <span className="text-[10px] text-text-dim font-mono tabular-nums">{total} streams</span>
      </div>
      <div className="h-1.5 w-full flex rounded-full overflow-hidden bg-white/5">
        {order.map((cat) => counts[cat] === 0 ? null : (
          <div key={cat} title={`${THREAD_CATEGORY_LABEL[cat]} · ${counts[cat]}`} style={{ width: `${(counts[cat] / total) * 100}%`, background: THREAD_CATEGORY_HEX[cat] }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {order.map((cat) => (
          <div key={cat} className="flex items-center gap-2 text-[11px]">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: THREAD_CATEGORY_HEX[cat] }} />
            <span className="text-text-secondary capitalize flex-1">{cat}</span>
            <span className="font-mono tabular-nums text-text-primary">{counts[cat]}</span>
            <span className="text-text-dim font-mono tabular-nums w-8 text-right">{Math.round((counts[cat] / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EntropyHistogram({ rows }: { rows: StreamRow[] }) {
  const live = rows.filter((r) => r.category !== 'resolved' && r.category !== 'abandoned');
  const bins = [0, 0, 0, 0, 0];
  for (const r of live) bins[Math.min(4, Math.floor(r.entropy * 5))]++;
  const maxBin = Math.max(1, ...bins);
  const labels = ['0–20', '20–40', '40–60', '60–80', '80–100'];
  return (
    <div className="relative flex flex-col gap-3 p-4 rounded-xl border border-white/8 bg-white/2.5 backdrop-blur-xl overflow-hidden panel-raise-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-text-dim">Uncertainty distribution</h3>
        <span className="text-[10px] text-text-dim font-mono tabular-nums">{live.length} live</span>
      </div>
      {live.length === 0 ? (
        <p className="text-[11px] text-text-dim">No live streams.</p>
      ) : (
        <div className="flex items-end gap-1.5 h-20">
          {bins.map((count, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${labels[i]}% entropy · ${count} streams`}>
              <span className="text-[9px] text-text-dim font-mono tabular-nums">{count}</span>
              <div className="w-full flex-1 flex items-end">
                <div className="w-full rounded-sm" style={{ height: `${Math.max((count / maxBin) * 100, 2)}%`, background: '#38BDF8', opacity: 0.4 + 0.12 * i }} />
              </div>
              <span className="text-[9px] text-text-dim font-mono tabular-nums">{labels[i]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResolutionQualityPanel({ snapshot }: { snapshot: StreamSnapshot }) {
  const bands = snapshot.resolutionQualityBands;
  const total = bands.earned + bands.adequate + bands.thin;
  const avg = snapshot.averageResolutionQuality;
  const items = [
    { label: 'Earned', count: bands.earned, color: '#34D399', hint: 'Resolution quality ≥ 0.7' },
    { label: 'Adequate', count: bands.adequate, color: '#FBBF24', hint: '0.4 ≤ quality < 0.7' },
    { label: 'Thin', count: bands.thin, color: '#FB7185', hint: 'Quality < 0.4' },
  ];
  return (
    <div className="relative flex flex-col gap-3 p-4 rounded-xl border border-white/8 bg-white/2.5 backdrop-blur-xl overflow-hidden panel-raise-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-text-dim">Resolution quality</h3>
        <span className="text-[10px] text-text-dim font-mono tabular-nums">{avg !== null ? `avg ${Math.round(avg * 100)}%` : 'no closures'}</span>
      </div>
      {total === 0 ? (
        <p className="text-[11px] text-text-dim">No streams have resolved yet. Quality is scored at closure.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it) => (
            <div key={it.label} className="flex flex-col gap-1" title={it.hint}>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: it.color }} />
                <span className="text-text-secondary flex-1">{it.label}</span>
                <span className="font-mono tabular-nums text-text-primary">{it.count}</span>
                <span className="text-text-dim font-mono tabular-nums w-8 text-right">{Math.round((it.count / total) * 100)}%</span>
              </div>
              <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                <div className="h-full" style={{ width: `${(it.count / total) * 100}%`, background: it.color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Movers ───────────────────────────────────────────────────────────────────

function TopMovers({
  movements,
  rowsById,
  lookback,
  onSelect,
}: {
  movements: StreamMovement[];
  rowsById: Map<string, StreamRow>;
  lookback: number;
  onSelect: (id: string) => void;
}) {
  const top = movements.filter((m) => Math.abs(m.deltaProb) >= 0.01).slice(0, 5);
  return (
    <div className="relative flex flex-col gap-3 p-4 rounded-xl border border-white/8 bg-white/2.5 backdrop-blur-xl overflow-hidden panel-raise-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-text-dim">Top movers</h3>
        <span className="text-[10px] text-text-dim" title={`Change in leading-outcome probability vs. ${lookback} priors ago.`}>vs −{lookback} priors</span>
      </div>
      {top.length === 0 ? (
        <p className="text-[11px] text-text-dim">No material movement.</p>
      ) : (
        <div className="flex flex-col">
          {top.map((m) => {
            const row = rowsById.get(m.streamId);
            const up = m.deltaProb >= 0;
            const accent = up ? '#34D399' : '#FB7185';
            return (
              <button key={m.streamId} onClick={() => onSelect(m.streamId)} className="group flex items-center gap-2 py-1.5 border-b border-white/4 last:border-b-0 hover:bg-white/3 transition-colors text-left -mx-1 px-1">
                <span className="text-[10px] font-mono tabular-nums w-8 text-right shrink-0" style={{ color: accent }}>
                  {up ? '▲' : '▼'}{Math.abs(Number((m.deltaProb * 100).toFixed(1)))}%
                </span>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-[11px] text-text-primary leading-snug">{row?.stream.title ?? m.streamId}</span>
                  <span className="text-[10px] text-text-dim font-mono">
                    {m.topOutcome} <span className="text-text-dim/70">{Math.round(m.priorProb * 100)}% → {Math.round(m.nowProb * 100)}%</span>
                  </span>
                </div>
                {row && (
                  <span className="text-[9px] uppercase tracking-wider shrink-0" style={{ color: THREAD_CATEGORY_HEX[row.category] }} title={THREAD_CATEGORY_DESCRIPTION[row.category]}>
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

function VolatilityLeaders({ rows, onSelect }: { rows: StreamRow[]; onSelect: (id: string) => void }) {
  const leaders = rows
    .filter((r) => r.category !== 'resolved' && r.category !== 'abandoned')
    .slice()
    .sort((a, b) => b.volatility - a.volatility)
    .slice(0, 5);
  return (
    <div className="relative flex flex-col gap-3 p-4 rounded-xl border border-white/8 bg-white/2.5 backdrop-blur-xl overflow-hidden panel-raise-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-text-dim">Volatility leaders</h3>
        <span className="text-[10px] text-text-dim">top {leaders.length}</span>
      </div>
      {leaders.length === 0 ? (
        <p className="text-[11px] text-text-dim">No live streams.</p>
      ) : (
        <div className="flex flex-col">
          {leaders.map((row, i) => {
            const maxVol = leaders[0].volatility || 1;
            return (
              <button key={row.stream.id} onClick={() => onSelect(row.stream.id)} className="group flex items-center gap-2 py-1.5 border-b border-white/4 last:border-b-0 hover:bg-white/3 transition-colors text-left -mx-1 px-1">
                <span className="text-[10px] text-text-dim font-mono tabular-nums w-4 text-right shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-[11px] text-text-primary leading-snug">{row.stream.title}</span>
                  <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(row.volatility / maxVol) * 100}%`, background: THREAD_CATEGORY_HEX[row.category] }} />
                  </div>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-text-primary shrink-0">σ{row.volatility.toFixed(2)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Screener card ──────────────────────────────────────────────────────────

function StreamCard({ row, inFocus, onSelect }: { row: StreamRow; inFocus: boolean; onSelect: () => void }) {
  const { stream, probs, topIdx, margin, volume, category, colourIdx } = row;
  const catColor = THREAD_CATEGORY_HEX[category];
  const dimmed = category === 'resolved' || category === 'abandoned';
  return (
    <button
      onClick={onSelect}
      className={`group text-left flex flex-col gap-2 p-3 rounded-lg border border-white/6 hover:border-white/15 hover:bg-white/3 transition-colors ${dimmed ? 'opacity-60' : ''}`}
      style={inFocus ? { borderLeft: `3px solid ${catColor}` } : undefined}
    >
      <div className="flex items-center justify-between gap-2 text-[10px] text-text-dim">
        <span className="font-medium capitalize" style={{ color: catColor }} title={THREAD_CATEGORY_DESCRIPTION[category]}>{THREAD_CATEGORY_LABEL[category]}</span>
        {inFocus && <span style={{ color: catColor }}>focus</span>}
      </div>
      <p className="text-xs text-text-primary leading-snug wrap-break-word">{stream.title}</p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-dim min-w-0 flex-1 truncate">
          <span className="text-text-secondary font-mono">{(stream.outcomes ?? [])[topIdx]}</span>{' '}
          <span className="font-mono tabular-nums text-text-primary">{Math.round((probs[topIdx] ?? 0) * 100)}%</span>
        </span>
        <span className="text-[9px] text-text-dim font-mono tabular-nums shrink-0">Δ{margin.toFixed(1)}</span>
        <span className="text-[9px] text-text-dim font-mono tabular-nums shrink-0">vol {volume.toFixed(1)}</span>
      </div>
      <div className="h-1 w-full flex rounded-full overflow-hidden bg-white/5">
        {probs.map((p, i) => (
          <div key={i} style={{ width: `${p * 100}%`, background: outcomeColourHex(colourIdx[i] ?? i), opacity: i === topIdx ? 1 : 0.5 }} />
        ))}
      </div>
    </button>
  );
}

// ── Headline ─────────────────────────────────────────────────────────────────

function PortfolioHeadline({ snapshot, focusCount, focusK }: { snapshot: StreamSnapshot; focusCount: number; focusK: number }) {
  const uncertaintyPct = Math.round(snapshot.averageEntropy * 100);
  const item = (value: string, label: string, hint?: string) => (
    <div className="flex flex-col" title={hint}>
      <span className="text-base text-text-primary font-mono tabular-nums">{value}</span>
      <span className="text-[10px] text-text-dim">{label}</span>
    </div>
  );
  return (
    <div className="flex items-center gap-6 flex-wrap">
      {item(String(snapshot.totalStreams), 'streams')}
      <span className="text-text-dim/30">|</span>
      {item(String(snapshot.activeStreams), 'open')}
      <span className="text-text-dim/30">|</span>
      {item(`${focusCount}/${focusK}`, 'in focus')}
      <span className="text-text-dim/30">|</span>
      {item(`${uncertaintyPct}%`, 'uncertain', 'Average entropy across open streams — higher = more contested.')}
      <span className="text-text-dim/30">|</span>
      {item(snapshot.beliefCap.toFixed(0), 'attention', 'Total volume across open streams.')}
      {snapshot.closedStreams > 0 && (
        <>
          <span className="text-text-dim/30">|</span>
          {item(String(snapshot.closedStreams), 'settled')}
        </>
      )}
    </div>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────

const MOVERS_LOOKBACK = 3;
const FOCUS_K = 6;

export default function StreamBeliefView() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  // Branch-scoped: streams visible on the active branch's lineage.
  const streams = useMemo(
    () => (narrative ? streamsForBranch(narrative, state.viewState.activeBranchId) : []),
    [narrative, state.viewState.activeBranchId],
  );

  const rows = useMemo(
    () => buildStreamRows(streams).slice().sort((a, b) => (b.volatility - a.volatility) || (b.focus - a.focus) || (b.volume - a.volume)),
    [streams],
  );
  const snapshot = useMemo(() => computeStreamSnapshot(rows), [rows]);
  const focusIds = useMemo(() => currentStreamFocusIds(rows, FOCUS_K), [rows]);
  const trajectory = useMemo(() => buildStreamPortfolioTrajectory(streams), [streams]);
  const movements = useMemo(() => computeStreamMovers(streams, MOVERS_LOOKBACK), [streams]);
  const rowsById = useMemo(() => {
    const m = new Map<string, StreamRow>();
    for (const r of rows) m.set(r.stream.id, r);
    return m;
  }, [rows]);

  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);
  const featuredId = useMemo(() => {
    if (selectedStreamId && rowsById.has(selectedStreamId)) return selectedStreamId;
    return (
      rows.find((r) => focusIds.has(r.stream.id))?.stream.id ??
      rows.find((r) => r.category !== 'resolved' && r.category !== 'abandoned')?.stream.id ??
      rows[0]?.stream.id ??
      null
    );
  }, [selectedStreamId, rows, focusIds, rowsById]);
  const featuredRow = featuredId ? rowsById.get(featuredId) : undefined;

  const [catFilter, setCatFilter] = useState<CategoryFilter>('all');
  const filterCounts: Record<CategoryFilter, number> = {
    all: rows.length, saturating: 0, contested: 0, volatile: 0, committed: 0, developing: 0, dormant: 0, resolved: 0, abandoned: 0,
  };
  for (const r of rows) filterCounts[r.category]++;
  const filteredRows = useMemo(() => (catFilter === 'all' ? rows : rows.filter((r) => r.category === catFilter)), [rows, catFilter]);

  if (!narrative) {
    return <div className="h-full w-full flex items-center justify-center text-[11px] text-text-dim">Select a narrative to view its belief.</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-center text-[11px] text-text-dim px-6">
        No streams open yet — open a stream against a perspective (Vision → Streams) to start gathering priors.
      </div>
    );
  }

  const selectStream = (id: string) => {
    setSelectedStreamId(id);
    dispatch({ type: 'SET_INSPECTOR', context: { type: 'stream', streamId: id } });
  };

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-5 flex flex-col gap-5">
        {/* Headline */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <PortfolioHeadline snapshot={snapshot} focusCount={focusIds.size} focusK={FOCUS_K} />
          <span className="text-[10px] text-text-dim">Member-owned · HEAD</span>
        </div>

        {/* 1. Drill-down */}
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] uppercase tracking-widest text-text-dim">Drill-down</h2>
          <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-4 items-stretch">
            {featuredRow ? (
              <FeaturedStream row={featuredRow} />
            ) : (
              <div className="rounded-xl border border-white/8 p-6 text-[11px] text-text-dim">Select a stream to feature.</div>
            )}
            <StreamListSidebar rows={rows} focusIds={focusIds} selectedId={featuredId} onSelect={selectStream} />
          </div>
        </div>

        {/* 2. Overview — KPI trends */}
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] uppercase tracking-widest text-text-dim">Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            <KPITrendCard label="Attention" points={trajectory} valueFn={(p) => p.attention} formatValue={(v) => v.toFixed(0)} formatDelta={(d) => d.toFixed(1)}
              hint="ATTENTION over time — cumulative volume across open streams." accent="#38bdf8" deltaBetter="up" />
            <KPITrendCard label="Uncertainty" points={trajectory} valueFn={(p) => p.uncertainty * 100} formatValue={(v) => `${Math.round(v)}%`} formatDelta={(d) => `${d.toFixed(1)}pp`}
              hint="UNCERTAINTY over time — average normalized entropy across open streams." accent="#fbbf24" yMin={0} yMax={100} deltaBetter="down" />
            <KPITrendCard label="Volatility" points={trajectory} valueFn={(p) => p.volatility} formatValue={(v) => `σ ${v.toFixed(2)}`} formatDelta={(d) => d.toFixed(2)}
              hint="VOLATILITY over time — average EWMA of recent prior magnitude." accent="#a78bfa" deltaBetter="neutral" />
            <KPITrendCard label="Saturation" points={trajectory} valueFn={(p) => p.saturationRate * 100} formatValue={(v) => `${Math.round(v)}%`} formatDelta={(d) => `${d.toFixed(1)}pp`}
              hint="SATURATION over time — share of live streams near closure." accent={THREAD_CATEGORY_HEX.saturating} yMin={0} yMax={100} deltaBetter="up" />
            <KPITrendCard label="Contested" points={trajectory} valueFn={(p) => p.contestedRate * 100} formatValue={(v) => `${Math.round(v)}%`} formatDelta={(d) => `${d.toFixed(1)}pp`}
              hint="CONTESTED over time — share of live streams with high entropy." accent={THREAD_CATEGORY_HEX.contested} yMin={0} yMax={100} deltaBetter="neutral" />
            <KPITrendCard label="Resolved" points={trajectory} valueFn={(p) => p.closedCount} formatValue={(v) => String(Math.round(v))} formatDelta={(d) => `+${Math.round(d)}`}
              hint="RESOLVED over time — cumulative count of streams that have closed." accent={THREAD_CATEGORY_HEX.resolved} deltaBetter="up" />
          </div>
        </div>

        {/* 3. Movers */}
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] uppercase tracking-widest text-text-dim">Movers</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TopMovers movements={movements} rowsById={rowsById} lookback={MOVERS_LOOKBACK} onSelect={selectStream} />
            <VolatilityLeaders rows={rows} onSelect={selectStream} />
          </div>
        </div>

        {/* 4. Composition */}
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] uppercase tracking-widest text-text-dim">Composition</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <CategoryBreakdown rows={rows} />
            <EntropyHistogram rows={rows} />
            <ResolutionQualityPanel snapshot={snapshot} />
          </div>
        </div>

        {/* 5. Screener */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[11px] uppercase tracking-widest text-text-dim">Screener</h2>
              <span className="text-[10px] text-text-dim/70">all streams</span>
            </div>
            <span className="text-[10px] text-text-dim">{filteredRows.length} shown</span>
          </div>
          <CategoryFilterBar active={catFilter} onChange={setCatFilter} counts={filterCounts} />
          {(() => {
            const focusGrid = filteredRows.filter((r) => focusIds.has(r.stream.id));
            const otherGrid = filteredRows.filter((r) => !focusIds.has(r.stream.id));
            const section = (title: string, list: StreamRow[], accent?: string) => {
              if (list.length === 0) return null;
              return (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[11px] uppercase tracking-widest font-medium" style={{ color: accent ?? 'var(--color-text-dim)' }}>{title}</h3>
                    <span className="text-[10px] text-text-dim font-mono tabular-nums">{list.length}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {list.map((row) => (
                      <StreamCard key={row.stream.id} row={row} inFocus={focusIds.has(row.stream.id)} onSelect={() => selectStream(row.stream.id)} />
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
