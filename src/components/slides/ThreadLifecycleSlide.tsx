'use client';
// ThreadLifecycle slide — shows thread arcs from setup through escalation to payoff/closure, coloured by logType.

import type { SlidesData } from '@/lib/slides-data';
import { SlideShell } from './SlideShell';

// Thread trajectory is coloured by the logType of each event — the primitive
// that actually ran (pulse / transition / setup / escalation / payoff / twist
// / callback / resistance / stall). Three semantic families: COMMIT (payoff,
// twist) closes a thread; MOTION (escalation, resistance, setup, callback,
// transition) advances it; QUIET (pulse, stall) just registers attention.
const LOG_TYPE_COLORS: Record<string, string> = {
  pulse:      '#64748B',  // slate — atmosphere
  stall:      '#475569',  // slate-dim — dysfunction
  setup:      '#FBBF24',  // amber — promise made
  escalation: '#FB923C',  // orange — pressure rising
  resistance: '#F87171',  // rose — opposition
  callback:   '#2DD4BF',  // teal — history honoured
  transition: '#38BDF8',  // sky — lifecycle position
  payoff:     '#10B981',  // emerald — promise paid
  twist:      '#A78BFA',  // violet — reversal
};

const LOG_TYPE_FAMILY: Record<string, 'commit' | 'motion' | 'quiet'> = {
  payoff: 'commit', twist: 'commit',
  escalation: 'motion', resistance: 'motion', setup: 'motion',
  callback: 'motion', transition: 'motion',
  pulse: 'quiet', stall: 'quiet',
};

// Visual weight per log type — committal events render larger so the eye
// lands on them. Motion events sit in the middle; quiet events are small.
const EVENT_HEIGHT: Record<string, number> = {
  payoff: 14, twist: 14,
  escalation: 10, resistance: 10, setup: 9, callback: 9, transition: 9,
  pulse: 5, stall: 5,
};

// Sort priority within each terminal group — committal events first, then
// motion, then quiet. Drives row order so the eye reads top-down by drama.
const LOG_TYPE_PRIORITY: Record<string, number> = {
  payoff: 0, twist: 1,
  escalation: 2, resistance: 3, setup: 4, callback: 5, transition: 6,
  pulse: 7, stall: 8,
};

// Legend groupings — communicates the three families instead of dumping
// nine categories in a row.
const LEGEND_GROUPS: { label: string; types: string[] }[] = [
  { label: 'Commit', types: ['payoff', 'twist'] },
  { label: 'Motion', types: ['setup', 'escalation', 'resistance', 'callback', 'transition'] },
  { label: 'Quiet', types: ['pulse', 'stall'] },
];

const ROW_H = 28;
const LABEL_W = 240;
const TIMELINE_W = 720;
const ARC_ZONE = 56;

export function ThreadLifecycleSlide({ data }: { data: SlidesData }) {
  const totalScenes = data.scenes.length;
  if (totalScenes === 0) return null;

  // Build rows + per-event marks. Each event becomes a glyph on the row;
  // committal events stand taller than quiet ones.
  type Mark = { sceneIdx: number; status: string };
  type Row = {
    threadId: string;
    description: string;
    firstScene: number;
    lastScene: number;
    endStatus: string;
    marks: Mark[];
    isTerminal: boolean;
  };

  const rows: Row[] = data.threadLifecycles
    .map((tl) => {
      const firstScene = tl.statuses[0]?.sceneIdx ?? 0;
      const lastScene = tl.statuses[tl.statuses.length - 1]?.sceneIdx ?? totalScenes - 1;
      const endStatus = tl.statuses[tl.statuses.length - 1]?.status ?? 'pulse';
      const marks: Mark[] = tl.statuses.map((s) => ({ sceneIdx: s.sceneIdx, status: s.status }));
      const isTerminal = endStatus === 'payoff' || endStatus === 'twist';
      return { threadId: tl.threadId, description: tl.description, firstScene, lastScene, endStatus, marks, isTerminal };
    });

  // Sort: resolved threads first (the work's earned closures), then live
  // threads (drama in motion), each subgroup ordered by end-status priority.
  rows.sort((a, b) => {
    if (a.isTerminal !== b.isTerminal) return a.isTerminal ? -1 : 1;
    const pa = LOG_TYPE_PRIORITY[a.endStatus] ?? 9;
    const pb = LOG_TYPE_PRIORITY[b.endStatus] ?? 9;
    return pa - pb || a.firstScene - b.firstScene;
  });

  // Insert a SECTION marker before the first live row so we can render a
  // group divider in the SVG. Tracks the row index where Live starts.
  const liveStartIdx = rows.findIndex((r) => !r.isTerminal);

  const SVG_W = LABEL_W + TIMELINE_W + ARC_ZONE;
  // Extra vertical space for the section divider when both groups exist.
  const dividerSpace = liveStartIdx > 0 ? 14 : 0;
  const SVG_H = rows.length * ROW_H + 20 + dividerSpace;

  const sceneToX = (idx: number) => LABEL_W + (idx / Math.max(totalScenes - 1, 1)) * TIMELINE_W;
  const rowY = (rowIdx: number) => {
    const base = rowIdx * ROW_H + 14;
    return rowIdx >= liveStartIdx && liveStartIdx > 0 ? base + dividerSpace : base;
  };

  // Build convergence arcs. Anchor at the END of the source thread's bar
  // (a converged-FROM thread has finished its work and points to its
  // successor), terminating at the START of the target thread's bar.
  const rowIndex = new Map(rows.map((r, i) => [r.threadId, i]));
  const arcs = (data.threadConvergences ?? [])
    .map((c) => ({ ...c, fromRow: rowIndex.get(c.fromId), toRow: rowIndex.get(c.toId) }))
    .filter((a): a is typeof a & { fromRow: number; toRow: number } => a.fromRow !== undefined && a.toRow !== undefined);

  const terminalCount = rows.filter((r) => r.isTerminal).length;
  const liveCount = rows.length - terminalCount;

  // Scene tick density — show ~12 ticks across the timeline regardless of
  // scene count, so the axis stays legible whether the work is 30 or 300
  // scenes long.
  const TICK_COUNT = Math.min(12, totalScenes);
  const tickIndices = Array.from({ length: TICK_COUNT }, (_, i) =>
    Math.round((i / Math.max(TICK_COUNT - 1, 1)) * (totalScenes - 1)),
  );

  return (
    <SlideShell
      eyebrow="Threads · Convergence"
      title="Thread Convergence"
      subtitle="Every thread on a shared scene timeline — coloured by the perceptual primitive that fired at each beat. Committed threads sit above the divider; threads still in motion below. Arcs to the right tie threads that converge."
      contentWidth="wide"
      rightSlot={
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-emerald-300/80">{terminalCount} settled</span>
          <span className="text-text-dim/40">·</span>
          <span className="text-amber-300/80">{liveCount} live</span>
          {arcs.length > 0 && (
            <>
              <span className="text-text-dim/40">·</span>
              <span className="text-cyan-300/80">{arcs.length} converge</span>
            </>
          )}
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {LEGEND_GROUPS.map((group) => (
            <span key={group.label} className="flex items-center gap-2">
              <span className="text-text-dim/80 uppercase tracking-widest text-[9px]">{group.label}</span>
              <span className="flex items-center gap-1.5">
                {group.types.map((status) => (
                  <span
                    key={status}
                    className="flex items-center gap-1 text-[10px]"
                    title={status}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: LOG_TYPE_COLORS[status] }} />
                    <span className="text-text-dim/90 capitalize">{status}</span>
                  </span>
                ))}
              </span>
            </span>
          ))}
          {arcs.length > 0 && (
            <span className="flex items-center gap-1.5 text-[10px] text-text-dim/90 ml-2">
              <span className="w-4 h-0 border-t border-cyan-400/70" />
              Convergence
            </span>
          )}
        </div>
      }
    >
      <div className="overflow-auto flex-1 rounded-lg border border-white/[0.06] bg-white/[0.015]">
        <svg width={SVG_W} height={SVG_H} className="block">
          {/* Scene tick grid */}
          {tickIndices.map((idx) => {
            const x = sceneToX(idx);
            return (
              <g key={`grid-${idx}`}>
                <line x1={x} y1={6} x2={x} y2={SVG_H - 16} stroke="#fff" strokeWidth={0.5} opacity={0.04} />
                <text x={x} y={SVG_H - 4} textAnchor="middle" fontSize={10} fill="rgba(148,163,184,0.55)" className="font-mono">
                  {idx + 1}
                </text>
              </g>
            );
          })}

          {/* Section labels */}
          {liveStartIdx > 0 && (
            <>
              <text x={8} y={6 + 8} fontSize={9} fill="rgba(16,185,129,0.7)" className="uppercase tracking-widest font-mono">
                Settled
              </text>
              <line
                x1={4}
                x2={LABEL_W + TIMELINE_W + 4}
                y1={liveStartIdx * ROW_H + 14 + dividerSpace / 2}
                y2={liveStartIdx * ROW_H + 14 + dividerSpace / 2}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
                strokeDasharray="3 6"
              />
              <text
                x={8}
                y={liveStartIdx * ROW_H + 14 + dividerSpace / 2 + 12}
                fontSize={9}
                fill="rgba(251,191,36,0.7)"
                className="uppercase tracking-widest font-mono"
              >
                In motion
              </text>
            </>
          )}
          {liveStartIdx === 0 && (
            <text x={8} y={6 + 8} fontSize={9} fill="rgba(251,191,36,0.7)" className="uppercase tracking-widest font-mono">
              In motion
            </text>
          )}

          {/* Thread rows */}
          {rows.map((row, rowIdx) => {
            const y = rowY(rowIdx);
            const barH = 4;
            const barY = y + (ROW_H - barH) / 2;
            const x1 = sceneToX(row.firstScene);
            const x2 = sceneToX(row.lastScene);
            return (
              <g key={row.threadId}>
                {/* Row label — full description with subtle ID prefix tooltip */}
                <text
                  x={LABEL_W - 12}
                  y={y + ROW_H / 2 + 1}
                  dominantBaseline="middle"
                  textAnchor="end"
                  fontSize={11}
                  fill={row.isTerminal ? 'rgba(148,163,184,0.55)' : 'rgba(226,232,240,0.85)'}
                >
                  {row.description.length > 32 ? row.description.slice(0, 30) + '…' : row.description}
                  <title>{row.description}</title>
                </text>

                {/* Lifeline — thin track running the thread's full span */}
                <line
                  x1={x1}
                  x2={x2}
                  y1={y + ROW_H / 2}
                  y2={y + ROW_H / 2}
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth={1}
                />

                {/* Backbone bar — softer fill behind the lifeline */}
                <rect
                  x={x1}
                  y={barY}
                  width={Math.max(x2 - x1, 2)}
                  height={barH}
                  rx={2}
                  fill="rgba(255,255,255,0.04)"
                />

                {/* Per-event marks — height scales with semantic weight */}
                {row.marks.map((m, i) => {
                  const cx = sceneToX(m.sceneIdx);
                  const h = EVENT_HEIGHT[m.status] ?? 6;
                  const family = LOG_TYPE_FAMILY[m.status] ?? 'quiet';
                  const colour = LOG_TYPE_COLORS[m.status] ?? '#888';
                  // Commit / motion render as a vertical bar; quiet as a
                  // dim dot so the eye prioritises the dramatic events.
                  if (family === 'quiet') {
                    return (
                      <circle
                        key={`m-${i}`}
                        cx={cx}
                        cy={y + ROW_H / 2}
                        r={1.5}
                        fill={colour}
                        opacity={0.55}
                      />
                    );
                  }
                  return (
                    <rect
                      key={`m-${i}`}
                      x={cx - 1.25}
                      y={y + (ROW_H - h) / 2}
                      width={2.5}
                      height={h}
                      rx={1}
                      fill={colour}
                      opacity={family === 'commit' ? 0.95 : 0.75}
                    />
                  );
                })}

                {/* Terminal cap — ring around the closing event marker, so
                    settled threads visually "land" instead of trailing off. */}
                {row.isTerminal && (
                  <circle
                    cx={sceneToX(row.lastScene)}
                    cy={y + ROW_H / 2}
                    r={8}
                    fill="none"
                    stroke={LOG_TYPE_COLORS[row.endStatus] ?? '#10B981'}
                    strokeWidth={1}
                    opacity={0.45}
                  />
                )}
              </g>
            );
          })}

          {/* Convergence arcs — draw from end-of-source to start-of-target,
              curving through the right margin. Cyan to keep them visually
              separate from the per-thread colour story. */}
          {arcs.map((arc, i) => {
            const fromY = rowY(arc.fromRow) + ROW_H / 2;
            const toY = rowY(arc.toRow) + ROW_H / 2;
            const fromX = sceneToX(rows[arc.fromRow].lastScene);
            const margin = LABEL_W + TIMELINE_W + 12 + (i % 4) * 8;
            const d = `M ${fromX} ${fromY} C ${margin + 24} ${fromY}, ${margin + 24} ${toY}, ${fromX} ${toY}`;
            return (
              <g key={`arc-${i}`}>
                <path
                  d={d}
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth={1}
                  opacity={0.32}
                />
                <circle cx={fromX} cy={fromY} r={2.5} fill="#22d3ee" opacity={0.5} />
                <circle cx={fromX} cy={toY} r={2.5} fill="#22d3ee" opacity={0.5} />
              </g>
            );
          })}
        </svg>
      </div>
    </SlideShell>
  );
}
