'use client';
// UsageModal — detailed API usage breakdown: per-model token spend and cost over the log.

import { useMemo, useState } from 'react';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { MODEL_PRICING, DEFAULT_PRICING } from '@/lib/constants';
import type { ApiLogEntry } from '@/types/narrative';

// ── Helpers (shared with GasMeter, duplicated locally to keep the modal self-
// contained — same formulas, no behaviour drift if either side moves) ────────

function getPricing(model?: string) {
  if (!model) return DEFAULT_PRICING;
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

const IMAGE_PRICING: Record<string, number> = {
  'replicate/seedream-4.5': 0.04,
};

function isImageGenCall(entry: ApiLogEntry): boolean {
  return entry.model?.startsWith('replicate/') === true || entry.caller.includes('generateImage');
}

function costForEntry(entry: ApiLogEntry): number {
  if (isImageGenCall(entry)) return IMAGE_PRICING[entry.model ?? ''] ?? 0.04;
  const p = getPricing(entry.model);
  const inputCost = (entry.promptTokens / 1_000_000) * p.input;
  const outputCost = ((entry.responseTokens ?? 0) / 1_000_000) * p.output;
  const reasoningCost = ((entry.reasoningTokens ?? 0) / 1_000_000) * p.output;
  return inputCost + outputCost + reasoningCost;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

function formatCost(v: number): string {
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}

function formatDateShort(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function formatDateLong(d: Date): string {
  return `${formatDateShort(d)} ${d.getFullYear()}`;
}

// ── Time range ───────────────────────────────────────────────────────────────

type RangeKey = '7d' | '1m' | '3m' | '6m' | '1y' | 'all';

const RANGE_DAYS: Record<Exclude<RangeKey, 'all'>, number> = {
  '7d': 7,
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
};

function rangeWindow(logs: ApiLogEntry[], range: RangeKey): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  if (range === 'all') {
    const minTs = logs.length > 0 ? Math.min(...logs.map((l) => l.timestamp)) : end.getTime();
    const start = new Date(minTs);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  const start = new Date(end);
  start.setDate(start.getDate() - (RANGE_DAYS[range] - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

// ── Daily bucket ─────────────────────────────────────────────────────────────

type DailyBucket = {
  date: Date;
  key: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  calls: number;
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bucketDaily(logs: ApiLogEntry[], start: Date, end: Date): DailyBucket[] {
  const map = new Map<string, DailyBucket>();
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = dayKey(cursor);
    map.set(key, { date: new Date(cursor), key, inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  const startMs = start.getTime();
  const endMs = end.getTime();
  for (const log of logs) {
    // Failed calls still incurred (billed) input-token cost; only exclude
    // still-pending in-flight calls — consistent with the gas meter.
    if (log.status === 'pending') continue;
    if (log.timestamp < startMs || log.timestamp > endMs) continue;
    const d = new Date(log.timestamp);
    const bucket = map.get(dayKey(d));
    if (!bucket) continue;
    bucket.calls += 1;
    bucket.cost += costForEntry(log);
    if (!isImageGenCall(log)) {
      bucket.inputTokens += log.promptTokens;
      bucket.outputTokens += (log.responseTokens ?? 0) + (log.reasoningTokens ?? 0);
    }
  }
  return [...map.values()];
}

// ── Metric ───────────────────────────────────────────────────────────────────

type MetricKey = 'output' | 'input' | 'cost' | 'calls';

const METRIC_CONFIG: Record<MetricKey, { title: string; color: string; format: (v: number) => string; pick: (b: DailyBucket) => number }> = {
  output: {
    title: 'Daily Output Tokens',
    color: '#5EBFB3', // teal — matches the reference screenshot
    format: formatTokensCompact,
    pick: (b) => b.outputTokens,
  },
  input: {
    title: 'Daily Input Tokens',
    color: '#60A5FA',
    format: formatTokensCompact,
    pick: (b) => b.inputTokens,
  },
  cost: {
    title: 'Daily Cost',
    color: '#A78BFA',
    format: formatCost,
    pick: (b) => b.cost,
  },
  calls: {
    title: 'Daily API Calls',
    color: '#FACC15',
    format: (v) => String(Math.round(v)),
    pick: (b) => b.calls,
  },
};

// ── Monotone cubic (Fritsch-Carlson) → cubic Bezier path ────────────────────
//
// Smooth curve that never overshoots its data points. Catmull-Rom produces
// nicer-looking peaks but dips below the baseline at sharp falls-to-zero;
// monotone cubic preserves the floor at the cost of slightly flatter peaks.
// Right trade-off for a usage chart with a hard floor at 0.

function smoothPath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;

  // Secant slopes between consecutive points
  const dx: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1].x - pts[i].x;
    dx.push(h);
    slopes.push(h === 0 ? 0 : (pts[i + 1].y - pts[i].y) / h);
  }

  // Initial tangents — average of neighbouring secants; endpoints take their own
  const tangents: number[] = new Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      tangents[i] = 0; // local extremum — flat tangent prevents overshoot
    } else {
      tangents[i] = (slopes[i - 1] + slopes[i]) / 2;
    }
  }

  // Fritsch-Carlson monotonicity adjustment
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / slopes[i];
    const b = tangents[i + 1] / slopes[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const t = 3 / h;
      tangents[i] = t * a * slopes[i];
      tangents[i + 1] = t * b * slopes[i];
    }
  }

  // Emit cubic Beziers — convert (point, tangent) pairs to control points
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    const cp1x = pts[i].x + h / 3;
    const cp1y = pts[i].y + (tangents[i] * h) / 3;
    const cp2x = pts[i + 1].x - h / 3;
    const cp2y = pts[i + 1].y - (tangents[i + 1] * h) / 3;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${pts[i + 1].x.toFixed(2)} ${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

// ── Area chart ───────────────────────────────────────────────────────────────

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) ticks.push(i * step);
  return ticks;
}

function AreaChart({
  buckets,
  metric,
}: {
  buckets: DailyBucket[];
  metric: MetricKey;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const config = METRIC_CONFIG[metric];

  const W = 920;
  const H = 360;
  const PAD = { top: 24, right: 24, bottom: 36, left: 64 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;

  const values = buckets.map(config.pick);
  const rawMax = Math.max(...values, 0);
  const ticks = niceTicks(rawMax || 1, 5);
  const yMax = ticks[ticks.length - 1] || 1;

  const points = buckets.map((b, i) => {
    const x = buckets.length <= 1
      ? PAD.left + cw / 2
      : PAD.left + (i / (buckets.length - 1)) * cw;
    const v = config.pick(b);
    const y = PAD.top + ch - (v / yMax) * ch;
    return { x, y, v, b };
  });

  const linePath = smoothPath(points);
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${PAD.top + ch} L ${points[0].x} ${PAD.top + ch} Z`
    : '';

  // X-axis labels — sample ~10 evenly spaced ticks
  const xLabelCount = Math.min(10, buckets.length);
  const xLabelIndices: number[] = [];
  if (buckets.length > 0) {
    for (let i = 0; i < xLabelCount; i++) {
      const idx = Math.round((i / Math.max(1, xLabelCount - 1)) * (buckets.length - 1));
      if (xLabelIndices[xLabelIndices.length - 1] !== idx) xLabelIndices.push(idx);
    }
  }

  const gradId = `usage-area-${metric}`;

  return (
    <div
      className="relative"
      onMouseLeave={() => setHovered(null)}
    >
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        className="overflow-visible"
        onMouseMove={(e) => {
          if (points.length === 0) return;
          const svg = e.currentTarget;
          const rect = svg.getBoundingClientRect();
          const xRatio = (e.clientX - rect.left) / rect.width;
          const xPx = xRatio * W;
          // find nearest point by x
          let best = 0;
          let bestDist = Infinity;
          for (let i = 0; i < points.length; i++) {
            const dist = Math.abs(points[i].x - xPx);
            if (dist < bestDist) { bestDist = dist; best = i; }
          }
          setHovered(best);
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={config.color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={config.color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Y-axis grid + labels */}
        {ticks.map((t, i) => {
          const y = PAD.top + ch - (t / yMax) * ch;
          return (
            <g key={i}>
              <line
                x1={PAD.left}
                y1={y}
                x2={PAD.left + cw}
                y2={y}
                stroke="white"
                strokeOpacity={0.06}
                strokeDasharray={i === 0 ? '' : '3 3'}
              />
              <text
                x={PAD.left - 10}
                y={y + 4}
                textAnchor="end"
                fill="white"
                fillOpacity={0.35}
                fontSize="11"
                fontFamily="ui-monospace, monospace"
              >
                {config.format(t)}
              </text>
            </g>
          );
        })}

        {/* Area + line */}
        {points.length > 0 && (
          <>
            <path d={areaPath} fill={`url(#${gradId})`} />
            <path d={linePath} fill="none" stroke={config.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}

        {/* X-axis labels */}
        {xLabelIndices.map((idx) => {
          const p = points[idx];
          if (!p) return null;
          return (
            <text
              key={idx}
              x={p.x}
              y={PAD.top + ch + 20}
              textAnchor="middle"
              fill="white"
              fillOpacity={0.4}
              fontSize="11"
              fontFamily="ui-monospace, monospace"
            >
              {formatDateShort(p.b.date)}
            </text>
          );
        })}

        {/* Hover crosshair + tooltip */}
        {hovered !== null && points[hovered] && (() => {
          const p = points[hovered];
          const tipText = `${formatDateShort(p.b.date)}`;
          const valueText = config.format(p.v);
          const tipW = 132;
          const tipH = 50;
          let tipX = p.x - tipW / 2;
          if (tipX < PAD.left) tipX = PAD.left;
          if (tipX + tipW > PAD.left + cw) tipX = PAD.left + cw - tipW;
          let tipY = p.y - tipH - 12;
          if (tipY < PAD.top) tipY = p.y + 12;
          return (
            <g pointerEvents="none">
              <line
                x1={p.x}
                y1={PAD.top}
                x2={p.x}
                y2={PAD.top + ch}
                stroke={config.color}
                strokeOpacity={0.3}
                strokeWidth={1}
              />
              <circle cx={p.x} cy={p.y} r={5} fill={config.color} />
              <circle cx={p.x} cy={p.y} r={5} fill="none" stroke="white" strokeOpacity={0.6} strokeWidth={1.5} />
              <rect
                x={tipX}
                y={tipY}
                width={tipW}
                height={tipH}
                rx={8}
                fill="#0a0a0a"
                stroke="white"
                strokeOpacity={0.15}
              />
              <text x={tipX + 12} y={tipY + 19} fill="white" fillOpacity={0.7} fontSize="11" fontFamily="ui-monospace, monospace">
                {tipText}
              </text>
              <text x={tipX + 12} y={tipY + 37} fill={config.color} fontSize="14" fontWeight={600} fontFamily="ui-monospace, monospace">
                {valueText}
              </text>
            </g>
          );
        })()}
      </svg>

      {/* Legend */}
      <div className="flex items-center justify-center gap-2 mt-2">
        <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: config.color }}>
          <span className="inline-block w-3 h-0.5 rounded" style={{ background: config.color }} />
          <span className="inline-block w-1.5 h-1.5 rounded-full border" style={{ borderColor: config.color }} />
          <span>{config.title.replace('Daily ', '')}</span>
        </span>
      </div>
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

type Props = {
  logs: ApiLogEntry[];
  onClose: () => void;
};

export function UsageModal({ logs, onClose }: Props) {
  const [metric, setMetric] = useState<MetricKey>('output');
  const [range, setRange] = useState<RangeKey>('1m');

  // Failed calls still incurred cost; exclude only still-pending in-flight
  // calls — consistent with the gas meter and the live API-logs total.
  const billableLogs = useMemo(() => logs.filter((l) => l.status !== 'pending'), [logs]);

  const { start, end } = useMemo(() => rangeWindow(billableLogs, range), [billableLogs, range]);

  const buckets = useMemo(() => bucketDaily(billableLogs, start, end), [billableLogs, start, end]);

  const totals = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let cost = 0;
    let calls = 0;
    let activeDays = 0;
    for (const b of buckets) {
      inputTokens += b.inputTokens;
      outputTokens += b.outputTokens;
      cost += b.cost;
      calls += b.calls;
      if (b.calls > 0) activeDays += 1;
    }
    return { inputTokens, outputTokens, cost, calls, activeDays };
  }, [buckets]);

  return (
    <Modal onClose={onClose} size="6xl" maxHeight="92vh">
      {/* Header — title + metric icons + time range tabs */}
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            <span className="text-[15px] font-semibold text-text-primary">Usage</span>
          </div>

          {/* Metric toggle */}
          <div className="flex items-center rounded-md border border-white/8 overflow-hidden">
            {(['output', 'input', 'cost', 'calls'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`text-[11px] px-3 py-1 capitalize transition-colors ${
                  metric === m ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-secondary'
                }`}
              >
                {m === 'output' ? 'Output' : m === 'input' ? 'Input' : m === 'cost' ? 'Cost' : 'Calls'}
              </button>
            ))}
          </div>

          {/* Range tabs — pushed to the right */}
          <div className="ml-auto flex items-center rounded-md border border-white/8 overflow-hidden">
            {(['7d', '1m', '3m', '6m', '1y', 'all'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`text-[11px] px-3 py-1 transition-colors ${
                  range === r ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-secondary'
                }`}
              >
                {r === 'all' ? 'All' : r}
              </button>
            ))}
          </div>
        </div>
      </ModalHeader>

      <ModalBody>
        {/* Date range subtitle */}
        <div className="text-[12px] text-text-dim mb-4">
          {formatDateLong(start)} — {formatDateLong(end)}
        </div>

        {/* Summary card */}
        <div className="rounded-xl border border-white/8 bg-white/3 px-5 py-4 mb-4">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <Stat label="Calls" value={String(totals.calls)} />
            <Stat label="In" value={formatTokens(totals.inputTokens)} />
            <Stat label="Out" value={formatTokens(totals.outputTokens)} />
            <Stat label="Cost" value={formatCost(totals.cost)} accent />
            <Stat label="Active Days" value={`${totals.activeDays}/${buckets.length}`} />
          </div>
        </div>

        {/* Chart card */}
        <div className="rounded-xl border border-white/8 bg-white/3 px-5 py-4">
          <div className="text-[13px] text-text-secondary mb-3">{METRIC_CONFIG[metric].title}</div>
          {buckets.length === 0 || totals.calls === 0 ? (
            <div className="flex items-center justify-center h-64 text-[12px] text-text-dim">
              No usage data in this range yet
            </div>
          ) : (
            <AreaChart buckets={buckets} metric={metric} />
          )}
        </div>

        {/* Footnote */}
        <div className="mt-3 text-[10px] text-text-dim">
          Aggregated from completed API calls (failed calls still incur input-token cost; pending calls excluded). Reasoning tokens included in output. Image generations contribute to cost and call count only.
        </div>
      </ModalBody>
    </Modal>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-text-dim">{label}</span>
      <span className={`text-[16px] font-semibold font-mono ${accent ? 'text-emerald-400' : 'text-text-primary'}`}>{value}</span>
    </div>
  );
}
