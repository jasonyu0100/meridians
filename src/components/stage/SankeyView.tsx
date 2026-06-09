'use client';
// SankeyView — the Fate INFLUENCE alluvial. Columns are time buckets read off
// the logs; each entity (thread or stream) is a horizontal stream whose width
// at each bucket = the volume it drew there, so the picture reads as influence
// moving through time. Source (Threads / Streams) is chosen by the topbar; the
// span (Full / Window) and window size are configured in the bar below it.

import { useMemo, useRef, useState, useEffect } from 'react';
import * as d3 from 'd3';
import type { NarrativeState } from '@/types/narrative';
import { buildLogAlluvial, buildStreamAlluvial, type TimeGranularity } from '@/lib/forces/thread-alluvial';
import { EmptyState } from '@/components/shared/EmptyState';
import { IconThread } from '@/components/icons';

const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
  '#8b5cf6', '#22c55e', '#eab308', '#f43f5e', '#0ea5e9',
];

const NODE_W = 11;
const PAD = 9;
const TOP = 22;
const BOT = 8;
const ML = 8;
const MR = 8;
const WIN_MIN = 5;
const WIN_MAX = 31;

function ribbon(sx: number, tx: number, sy0: number, sy1: number, ty0: number, ty1: number): string {
  const xm = (sx + tx) / 2;
  return `M${sx},${sy0} C${xm},${sy0} ${xm},${ty0} ${tx},${ty0} L${tx},${ty1} C${xm},${ty1} ${xm},${sy1} ${sx},${sy1} Z`;
}

function Seg({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
        active ? 'bg-white/10 text-text-primary' : 'text-text-dim/60 hover:text-text-secondary hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}

export default function SankeyView({
  narrative,
  resolvedKeys,
  currentIndex,
  source,
  onSelectThread,
  onSelectStream,
}: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentIndex: number;
  source: 'threads' | 'streams';
  onSelectThread: (id: string) => void;
  onSelectStream: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [span, setSpan] = useState<'full' | 'window'>('window');
  const [windowSize, setWindowSize] = useState(15);
  const [granularity, setGranularity] = useState<TimeGranularity>('week');
  // Snapshot "now" once so weekly buckets don't jitter on every render.
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () =>
      source === 'threads'
        ? buildLogAlluvial(narrative, resolvedKeys, currentIndex, span === 'window', windowSize)
        : buildStreamAlluvial(narrative, { window: span === 'window', windowUnits: windowSize, granularity, nowMs }),
    [source, narrative, resolvedKeys, currentIndex, span, windowSize, granularity, nowMs],
  );

  const layout = useMemo(() => {
    const { w, h } = size;
    if (w < 80 || h < 60) return null;
    const { buckets, volumes, threadOrder, currentBucket, meta } = data;
    if (buckets.length === 0) return null;

    const active = threadOrder.filter((id) => volumes.some((v) => (v.get(id) ?? 0) > 0));
    if (active.length === 0) return null;

    let scale = Infinity;
    volumes.forEach((v) => {
      let total = 0;
      let count = 0;
      for (const id of active) {
        const vol = v.get(id) ?? 0;
        if (vol > 0) { total += vol; count++; }
      }
      if (total > 0) {
        const availH = h - TOP - BOT - PAD * Math.max(0, count - 1);
        scale = Math.min(scale, Math.max(0.2, availH) / total);
      }
    });
    if (!isFinite(scale)) return null;

    const B = buckets.length;
    const avail = w - NODE_W - ML - MR;
    let step = B > 1 ? avail / (B - 1) : 0;
    const MAX_STEP = 220;
    if (step > MAX_STEP) step = MAX_STEP;
    const totalW = (B - 1) * step + NODE_W;
    const offsetX = Math.max(ML, (w - totalW) / 2);
    const colX = (b: number) => offsetX + b * step;

    const pos = new Map<string, { y0: number; y1: number }>();
    volumes.forEach((v, b) => {
      let used = 0;
      let count = 0;
      for (const id of active) {
        const vol = v.get(id) ?? 0;
        if (vol > 0) { used += vol * scale; count++; }
      }
      used += PAD * Math.max(0, count - 1);
      let cursor = TOP + Math.max(0, (h - TOP - BOT - used) / 2);
      for (const id of active) {
        const vol = v.get(id) ?? 0;
        if (vol <= 0) continue;
        pos.set(`${b}:${id}`, { y0: cursor, y1: cursor + vol * scale });
        cursor += vol * scale + PAD;
      }
    });

    const color = d3.scaleOrdinal<string, string>().domain(active).range(COLORS);

    type S = { id: string; sx: number; tx: number; sy0: number; sy1: number; ty0: number; ty1: number };
    const segs: S[] = [];
    for (const id of active) {
      const bs: number[] = [];
      volumes.forEach((v, b) => { if ((v.get(id) ?? 0) > 0) bs.push(b); });
      for (let k = 0; k + 1 < bs.length; k++) {
        const p0 = pos.get(`${bs[k]}:${id}`)!;
        const p1 = pos.get(`${bs[k + 1]}:${id}`)!;
        segs.push({ id, sx: colX(bs[k]) + NODE_W, tx: colX(bs[k + 1]), sy0: p0.y0, sy1: p0.y1, ty0: p1.y0, ty1: p1.y1 });
      }
    }

    const firstBucketOf = new Map<string, number>();
    for (const id of active) {
      const b = volumes.findIndex((v) => (v.get(id) ?? 0) > 0);
      if (b >= 0) firstBucketOf.set(id, b);
    }

    const nodes: { id: string; b: number; x: number; y0: number; y1: number }[] = [];
    pos.forEach((p, key) => {
      const [bStr, id] = key.split(/:(.+)/);
      nodes.push({ id, b: Number(bStr), x: colX(Number(bStr)), y0: p.y0, y1: p.y1 });
    });

    const nowX = currentBucket >= 0 ? colX(currentBucket) + NODE_W / 2 : null;

    return { buckets, nodes, segs, color, colX, step, firstBucketOf, nowX, meta, w, h, B };
  }, [size, data]);

  const onPick = (id: string) => (source === 'threads' ? onSelectThread(id) : onSelectStream(id));

  return (
    <div className="absolute inset-0 z-20 flex flex-col">
      {/* Config bar (below the stage bar) — span + window size. Mirrors the
          World/System graph toolbars: glass-panel, fixed height, bottom border. */}
      <div className="shrink-0 flex items-center gap-2 px-2 h-7 border-b border-border glass-panel z-30 text-[10px] text-text-dim/70">
        <IconThread size={12} />
        <span className="uppercase tracking-wider">Influence</span>
        <span className="text-text-dim/40">·</span>
        <span className="capitalize">{source}</span>

        {/* Streams ride an absolute-time continuum — pick the bucket
            granularity. Threads are per-scene, so this is hidden there. */}
        {source === 'streams' && (
          <div className="ml-2 flex items-center rounded-md overflow-hidden border border-white/10">
            {(['day', 'week', 'month'] as const).map((g, i) => (
              <div key={g} className="flex items-center">
                {i > 0 && <div className="w-px h-4 bg-white/10" />}
                <Seg active={granularity === g} onClick={() => setGranularity(g)}>
                  {g === 'day' ? 'Day' : g === 'week' ? 'Week' : 'Month'}
                </Seg>
              </div>
            ))}
          </div>
        )}

        <div className={`flex items-center rounded-md overflow-hidden border border-white/10 ${source === 'streams' ? '' : 'ml-2'}`}>
          <Seg active={span === 'full'} onClick={() => setSpan('full')}>Full</Seg>
          <div className="w-px h-4 bg-white/10" />
          <Seg active={span === 'window'} onClick={() => setSpan('window')}>Window</Seg>
        </div>
        {span === 'window' && (
          <div className="flex items-center gap-1 rounded-md border border-white/10 px-1">
            <button
              className="px-1 text-text-dim/60 hover:text-text-primary disabled:opacity-30"
              disabled={windowSize <= WIN_MIN}
              onClick={() => setWindowSize((s) => Math.max(WIN_MIN, s - 2))}
            >
              −
            </button>
            <span className="tabular-nums text-text-secondary">
              {windowSize}{source === 'streams' ? ` ${granularity === 'day' ? 'd' : granularity === 'week' ? 'w' : 'mo'}` : ''}
            </span>
            <button
              className="px-1 text-text-dim/60 hover:text-text-primary disabled:opacity-30"
              disabled={windowSize >= WIN_MAX}
              onClick={() => setWindowSize((s) => Math.min(WIN_MAX, s + 2))}
            >
              +
            </button>
          </div>
        )}
        <span className="text-text-dim/40">·</span>
        <span>{source === 'streams' ? 'concurrent activity' : 'width = volume'}</span>
      </div>

      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        {layout ? (
          <svg width={layout.w} height={layout.h} className="block">
            <g>
              {layout.buckets.map((bk, b) => (
                <text
                  key={`bl-${bk.key}-${b}`}
                  x={layout.colX(b) + NODE_W / 2}
                  y={12}
                  textAnchor="middle"
                  className="pointer-events-none select-none"
                  fontSize={9}
                  fill="currentColor"
                  fillOpacity={layout.nowX !== null && layout.colX(b) + NODE_W / 2 === layout.nowX ? 0.75 : 0.4}
                >
                  {bk.label.length > 14 ? bk.label.slice(0, 13) + '…' : bk.label}
                </text>
              ))}
            </g>
            <g>
              {layout.segs.map((s, i) => {
                const act = hovered === null || hovered === s.id;
                return (
                  <path
                    key={`s-${s.id}-${i}`}
                    d={ribbon(s.sx, s.tx, s.sy0, s.sy1, s.ty0, s.ty1)}
                    fill={layout.color(s.id)}
                    fillOpacity={act ? 0.34 : 0.07}
                    style={{ transition: 'fill-opacity 120ms' }}
                  />
                );
              })}
            </g>
            <g>
              {layout.nodes.map((n) => {
                const m = layout.meta.get(n.id);
                const bandH = n.y1 - n.y0;
                const dim = !!(m?.closed || m?.abandoned);
                const act = hovered === null || hovered === n.id;
                const isFirst = layout.firstBucketOf.get(n.id) === n.b;
                const isLastCol = n.b === layout.B - 1;
                const labelRoom = layout.step - NODE_W - 12;
                const showLabel = isFirst && bandH >= 9 && m && (labelRoom > 24 || isLastCol);
                const charBudget = Math.max(6, Math.floor(Math.max(labelRoom, 130) / 6.2));
                return (
                  <g
                    key={`${n.b}:${n.id}`}
                    className="cursor-pointer"
                    onClick={() => onPick(n.id)}
                    onMouseEnter={() => setHovered(n.id)}
                    onMouseLeave={() => setHovered(null)}
                    opacity={act ? 1 : 0.45}
                    style={{ transition: 'opacity 120ms' }}
                  >
                    <title>
                      {m?.label ?? n.id}
                      {m?.closed ? '\n· closed' : m?.abandoned ? '\n· abandoned' : ''}
                    </title>
                    <rect
                      x={n.x} y={n.y0} width={NODE_W} height={Math.max(1, bandH)} rx={2}
                      fill={layout.color(n.id)}
                      fillOpacity={dim ? 0.5 : 1}
                      stroke={m?.abandoned ? '#ef4444' : m?.closed ? '#a855f7' : 'transparent'}
                      strokeWidth={dim ? 1 : 0}
                    />
                    {showLabel && (
                      <text
                        x={isLastCol ? n.x - 6 : n.x + NODE_W + 6}
                        y={n.y0 + bandH / 2}
                        textAnchor={isLastCol ? 'end' : 'start'}
                        dominantBaseline="middle"
                        className="pointer-events-none select-none"
                        fontSize={Math.min(11, Math.max(9, bandH * 0.5))}
                        fill="currentColor"
                        fillOpacity={dim ? 0.45 : 0.85}
                      >
                        {(m?.label ?? '').slice(0, charBudget)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
            {/* Playhead — present scene, drawn on top like a video editor's
                index cursor: a solid vibrant line + a downward triangle. */}
            {layout.nowX !== null && (
              <g className="pointer-events-none">
                <line
                  x1={layout.nowX} x2={layout.nowX} y1={9} y2={layout.h - BOT + 2}
                  stroke="#22d3ee" strokeOpacity={0.95} strokeWidth={1.5}
                />
                <polygon
                  points={`${layout.nowX - 5},1 ${layout.nowX + 5},1 ${layout.nowX},10`}
                  fill="#22d3ee"
                />
              </g>
            )}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={IconThread}
              title={source === 'streams' ? 'No stream priors to chart.' : 'No fate volume to chart.'}
              hint={
                source === 'streams'
                  ? 'Streams gather priors over time — once they do, their influence shows here.'
                  : 'No thread attention recorded yet — generate scenes to see fate influence over time.'
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
