'use client';

/**
 * Shared analytics + visualisation primitives for scenarios
 * branches, ported from the legacy MCTS inspector. Pure functions over
 * `ScenarioRun.result` so the same widgets can render in the left rail
 * (compact) and the right inspector (expanded).
 */

import { useMemo } from 'react';
import {
  computeForceSnapshots,
  computeRawForceTotals,
  computeActivityCurve,
  classifyCurrentPosition,
  detectCubeCorner,
  gradeForces,
  computeSwingMagnitudes,
  FORCE_REFERENCE_MEANS,
} from '@/lib/narrative-utils';
import type { Scene, ForceSnapshot, NarrativeState, ScenarioRun } from '@/types/narrative';
import { IconLocationPin, IconEye } from '@/components/icons';

// ── Score colouring (ported from legacy MCTSPanel) ───────────────────────

export function scoreColorClass(v: number): string {
  if (v >= 90) return 'text-emerald-400';
  if (v >= 80) return 'text-lime-400';
  if (v >= 70) return 'text-yellow-400';
  if (v >= 60) return 'text-orange-400';
  return 'text-rose-400';
}

export function scoreBgClass(v: number): string {
  if (v >= 90) return 'bg-emerald-500/10 border-emerald-500/20';
  if (v >= 80) return 'bg-lime-500/10 border-lime-500/20';
  if (v >= 70) return 'bg-yellow-500/10 border-yellow-500/20';
  if (v >= 60) return 'bg-orange-500/10 border-orange-500/20';
  return 'bg-rose-500/10 border-rose-500/20';
}

// ── Cube corner colour palette ───────────────────────────────────────────

const CUBE_COLORS: Record<string, string> = {
  HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
  LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
};

const POSITION_COLORS: Record<string, string> = {
  peak:    '#F59E0B',
  trough:  '#3B82F6',
  rising:  '#22C55E',
  falling: '#EF4444',
  stable:  'var(--color-text-secondary)',
};

// Per-logType colour for transition badges — matches ThreadDetail / ArcDetail.
// `pulse` uses a theme-neutral grey so it stays visible in light mode.
const LOG_TYPE_HEX: Record<string, string> = {
  pulse: '#9ca3af', transition: '#fbbf24', setup: '#fbbf24', escalation: '#fb923c',
  payoff: '#34d399', twist: '#a78bfa', callback: '#38bdf8', resistance: '#ef4444', stall: '#f87171',
};

// ── Derive everything from a scenario's result ───────────────────────────

export type ScenarioMetrics = {
  /** Just this scenario's generated scenes. */
  scenes: Scene[];
  /** Per-scene normalised force snapshots over those scenes — used for cube
   *  corner detection and the per-arc sparkline. */
  forceMap: Record<string, ForceSnapshot>;
  /** Activity curve over the FULL timeline (prior narrative + this arc) so
   *  peak/trough/rising/falling classification is judged in context, not
   *  in isolation over 4 scenes. */
  fullActivityPoints: ReturnType<typeof computeActivityCurve>;
  /** Index in `fullActivityPoints` where this scenario's arc begins (the
   *  segment to highlight in the chart). */
  arcStartIndex: number;
  /** Position derived from the FULL curve, not just the arc — answers
   *  "where in the broader story is this arc landing?". */
  position: ReturnType<typeof classifyCurrentPosition> | null;
  /** Sparkline series over JUST the arc — each arc gets its own shape. */
  arcSparkline: number[];
  /** Predicted post-commit narrative grade — computed over the FULL
   *  virtual narrative (prior scenes + this arc's scenes). This matches
   *  the formula used in `narrativeToEntry` so the number the user sees
   *  here is the number that will appear in the narrative shelf once they
   *  commit this branch. */
  grade: ReturnType<typeof gradeForces>;
  /** Arc-only grade for comparison — what this arc looks like in
   *  isolation, mirroring the legacy MCTS `scoreArc`. Useful when the
   *  user wants to see "how good is THIS arc on its own merits?". */
  arcGrade: ReturnType<typeof gradeForces>;
};

/** Compute the analytics bundle for one scenario's generated arc.
 *
 * Three important behaviours:
 *
 * 1. **Grading uses RAW per-scene force totals**, not normalised z-score
 *    snapshots. `gradeForces` divides by `FORCE_REFERENCE_MEANS` internally
 *    (the calibration constants — HP/Alice/QNF means). Feeding z-scores in
 *    floors every grade near zero.
 *
 * 2. **Primary score predicts the POST-COMMIT narrative score**, not
 *    arc-only. We compute over `virtualResolvedKeys` (full prior +
 *    this arc) so the number matches what `narrativeToEntry` will report
 *    once the user commits this branch. Eliminates the discrepancy
 *    between "what the panel shows" and "what the narrative shelf shows
 *    after commit". Arc-only grade is also exposed as `arcGrade` for
 *    reference.
 *
 * 3. **Activity classification spans the FULL resolved timeline**, not
 *    just the new arc. A 4-scene smoothed series is trivially "rising" if
 *    the largest is last; only against the full curve can we honestly
 *    classify the arc as peak / trough / rising / falling.
 */
export function useScenarioMetrics(run: ScenarioRun): ScenarioMetrics | null {
  return useMemo(() => {
    if (!run.result || run.result.scenes.length === 0) return null;
    const scenes = run.result.scenes;
    const virtual = run.result.virtualNarrative;

    // ── Per-scene normalised forces (for cube glyphs + sparkline) ──
    const forceMap = computeForceSnapshots(scenes, [], virtual);

    // ── Pull the full virtual timeline once ────────────────────────
    const fullScenes: Scene[] = [];
    for (const key of run.result.virtualResolvedKeys) {
      const s = virtual.scenes[key];
      if (s) fullScenes.push(s);
    }
    const arcStartIndex = Math.max(0, fullScenes.length - scenes.length);

    // ── Primary score: full-narrative grade (mirrors narrativeToEntry)
    // This is what the user will see in the narrative shelf after they
    // commit. Same calls, same args, same order — keeps the two numbers
    // in lockstep.
    const fullRaw = computeRawForceTotals(fullScenes, virtual);
    const fullRawForces: ForceSnapshot[] = fullRaw.fate.map((_, i) => ({
      fate: fullRaw.fate[i],
      world: fullRaw.world[i],
      system: fullRaw.system[i],
    }));
    const fullSwings = computeSwingMagnitudes(fullRawForces, FORCE_REFERENCE_MEANS);
    const grade = gradeForces(fullRaw.fate, fullRaw.world, fullRaw.system, fullSwings);

    // ── Arc-only grade for the "how good is THIS arc alone" view ──
    const arcRaw = computeRawForceTotals(scenes, virtual);
    const arcRawForces: ForceSnapshot[] = arcRaw.fate.map((_, i) => ({
      fate: arcRaw.fate[i],
      world: arcRaw.world[i],
      system: arcRaw.system[i],
    }));
    const arcSwings = computeSwingMagnitudes(arcRawForces, FORCE_REFERENCE_MEANS);
    const arcGrade = gradeForces(arcRaw.fate, arcRaw.world, arcRaw.system, arcSwings);

    // ── Activity curve over the FULL timeline ─────────────────────
    const fullForceMap = computeForceSnapshots(fullScenes, [], virtual);
    const fullForces = fullScenes
      .map((s) => fullForceMap[s.id])
      .filter((f): f is ForceSnapshot => !!f);
    const fullActivityPoints = computeActivityCurve(fullForces);
    const position = fullActivityPoints.length > 0
      ? classifyCurrentPosition(fullActivityPoints)
      : null;

    // ── Sparkline over JUST the arc (per-arc shape) ────────────────
    const arcSparkline = scenes
      .map((s) => forceMap[s.id])
      .filter((f): f is ForceSnapshot => !!f)
      .map((f) => f.fate + f.world + f.system);

    return {
      scenes,
      forceMap,
      fullActivityPoints,
      arcStartIndex,
      position,
      arcSparkline,
      grade,
      arcGrade,
    };
  }, [run.result]);
}

// ── Compact cube strip (used in left rail and inspector header) ──────────

export function CubeStrip({ scenes, forceMap, max = 12 }: {
  scenes: Scene[];
  forceMap: Record<string, ForceSnapshot>;
  max?: number;
}) {
  const slice = scenes.slice(0, max);
  return (
    <span className="inline-flex items-center gap-px shrink-0">
      {slice.map((s) => {
        const f = forceMap[s.id];
        if (!f) return null;
        const c = detectCubeCorner(f);
        return (
          <span
            key={s.id}
            className="w-2 h-2 rounded-sm"
            style={{ backgroundColor: CUBE_COLORS[c.key] ?? '#6b7280' }}
            title={`${c.name} (${c.key})`}
          />
        );
      })}
      {scenes.length > max && (
        <span className="text-[8px] text-text-dim/60 ml-0.5">+{scenes.length - max}</span>
      )}
    </span>
  );
}

// ── Sparkline (per-arc shape) ────────────────────────────────────────────

export function Sparkline({ series, width = 48, height = 14 }: {
  series: number[];
  width?: number;
  height?: number;
}) {
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = Math.max(max - min, 0.05);
  const path = series
    .map((v, i) => `${(i / (series.length - 1)) * width},${height - ((v - min) / range) * (height - 2) - 1}`)
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <polyline
        points={path}
        fill="none"
        stroke="#F59E0B"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Full activity chart (inspector) ──────────────────────────────────────
// Visual language matches the main timeline `ActivityLineChart`:
//   • zero baseline as a faint horizontal rule
//   • orange filled area above zero (high-activity)
//   • light-blue filled area below zero (low-activity)
//   • macro-trend dashed white line
//   • solid orange smoothed line on top
//   • small circle peak markers (yellow), valley markers (light blue)
// Plus an scenarios-specific arc-range highlight that tints the
// background where this scenario's new scenes sit.

const ACTIVITY_COLOR = '#F59E0B';
const PEAK_COLOR = '#FCD34D';
const LOW_ACTIVITY_COLOR = '#93C5FD';

export function ActivityChart({ points, arcStartIndex, width = 360, height = 64 }: {
  points: ReturnType<typeof computeActivityCurve>;
  /** Index in `points` where the new arc begins. The slice from this
   *  index onward is highlighted with a tinted background. */
  arcStartIndex: number;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const n = points.length;
  const smoothed = points.map((p) => p.smoothed);
  const macro = points.map((p) => p.macroTrend);

  // Percentile-clipped symmetric domain so a single outlier doesn't
  // flatten the rest. Mirrors the 95th-percentile clip the main chart
  // uses.
  const all = [...smoothed, ...macro];
  const absSorted = all.map(Math.abs).sort((a, b) => a - b);
  const pIdx = Math.max(0, Math.floor(absSorted.length * 0.95) - 1);
  const clipAbs = Math.max(absSorted[pIdx] ?? 0.5, 0.5);
  const domain = clipAbs * 1.15;

  const xOf = (i: number) => (i / (n - 1)) * width;
  // Symmetric around zero so positive = top half, negative = bottom half.
  const toY = (v: number) => {
    const clamped = Math.max(-domain, Math.min(domain, v));
    return height / 2 - (clamped / domain) * (height / 2 - 2);
  };
  const zeroY = toY(0);

  // Augment the smoothed series with interpolated zero-crossings so the
  // orange / blue fills clip cleanly at y=0 instead of dropping vertical
  // edges between scenes that straddle the baseline. Same idea as the
  // main chart's d3.area construction.
  type Sample = { x: number; v: number };
  const augmented: Sample[] = [];
  for (let i = 0; i < n; i++) {
    augmented.push({ x: xOf(i), v: smoothed[i] });
    if (i < n - 1) {
      const a = smoothed[i];
      const b = smoothed[i + 1];
      if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
        const t = a / (a - b);
        augmented.push({ x: xOf(i) + t * (xOf(i + 1) - xOf(i)), v: 0 });
      }
    }
  }

  // Two filled-area polygons: positive lobe (orange) and negative lobe
  // (blue). Each rides along the baseline for non-contributing samples.
  const posArea =
    augmented
      .map((p) => `${p.x},${toY(Math.max(0, p.v))}`)
      .join(' ') + ` ${augmented[augmented.length - 1].x},${zeroY} ${augmented[0].x},${zeroY}`;
  const negArea =
    augmented
      .map((p) => `${p.x},${toY(Math.min(0, p.v))}`)
      .join(' ') + ` ${augmented[augmented.length - 1].x},${zeroY} ${augmented[0].x},${zeroY}`;

  const linePath = points.map((p, i) => `${xOf(i)},${toY(p.smoothed)}`).join(' ');
  const macroPath = points.map((p, i) => `${xOf(i)},${toY(p.macroTrend)}`).join(' ');

  const arcStart = Math.max(0, Math.min(n - 1, arcStartIndex));
  const arcX = xOf(arcStart);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="rounded bg-text-dim/5 text-text-dim">
      {/* Arc-range tint — context cue for where the new scenes sit. */}
      {arcStart < n - 1 && (
        <rect x={arcX} y={0} width={width - arcX} height={height} fill={ACTIVITY_COLOR} fillOpacity={0.06} />
      )}
      {/* Zero baseline. */}
      <line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke="currentColor" strokeOpacity={0.3} strokeWidth={0.5} />
      {/* High / low filled areas. */}
      <polygon points={posArea} fill={ACTIVITY_COLOR} fillOpacity={0.22} />
      <polygon points={negArea} fill={LOW_ACTIVITY_COLOR} fillOpacity={0.20} />
      {/* Macro trend (dashed). */}
      <polyline points={macroPath} fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1} strokeDasharray="4 3" />
      {/* Primary smoothed line. */}
      <polyline
        points={linePath}
        fill="none"
        stroke={ACTIVITY_COLOR}
        strokeWidth={1.5}
        strokeOpacity={0.9}
        strokeLinejoin="round"
      />
      {/* Peak / valley dots — same shapes/colours as the main chart. */}
      {points.map((p, i) => {
        if (!p.isPeak && !p.isValley) return null;
        const cx = xOf(i);
        const cy = toY(p.smoothed);
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={2}
            fill={p.isPeak ? PEAK_COLOR : LOW_ACTIVITY_COLOR}
            opacity={p.isPeak ? 0.9 : 0.8}
          />
        );
      })}
    </svg>
  );
}

// ── Cube sequence (visual strip with names) ──────────────────────────────

export function CubeSequence({ scenes, forceMap, onSelectScene }: {
  scenes: Scene[];
  forceMap: Record<string, ForceSnapshot>;
  onSelectScene?: (index: number) => void;
}) {
  return (
    <div className="flex items-center flex-wrap gap-y-1">
      {scenes.map((s, i) => {
        const f = forceMap[s.id];
        const c = f ? detectCubeCorner(f) : null;
        const inner = (
          <span
            className="flex items-center gap-1 px-1 py-0.5 rounded"
            style={{ backgroundColor: c ? `${CUBE_COLORS[c.key]}15` : 'transparent' }}
          >
            {c && (
              <svg width="15" height="8" viewBox="0 0 15 8">
                {['F','W','S'].map((_, fi) => {
                  const isHi = c.key[fi] === 'H';
                  const cols = ['#EF4444', '#22C55E', '#3B82F6'];
                  return (
                    <rect
                      key={fi}
                      x={fi * 5.5}
                      y={isHi ? 0 : 4}
                      width={4}
                      height={isHi ? 7 : 3}
                      rx={0.8}
                      fill={cols[fi]}
                      opacity={isHi ? 0.8 : 0.25}
                    />
                  );
                })}
              </svg>
            )}
            <span className="text-[9px] font-medium" style={{ color: c ? CUBE_COLORS[c.key] : '#6b7280' }}>
              {c?.name ?? '?'}
            </span>
          </span>
        );
        return (
          <span key={s.id} className="flex items-center">
            {i > 0 && <span className="text-text-dim/25 text-[11px] mx-0.5">→</span>}
            {onSelectScene ? (
              <button type="button" onClick={() => onSelectScene(i)} className="hover:opacity-80 transition-opacity">
                {inner}
              </button>
            ) : inner}
          </span>
        );
      })}
    </div>
  );
}

// ── Force grade strip — score + dominant force at a glance ───────────────
// The sub-grades (F/W/S/Sw out of 25 each) are removed: they were
// internal formula components that didn't communicate anything actionable.
// What IS valuable is which force is doing the work — knowing an arc is
// World-dominant vs Fate-dominant tells you what kind of arc it is at a
// glance, in plain language tied to the cube vocabulary.

export function GradeStrip({ grade }: { grade: ReturnType<typeof gradeForces> }) {
  // Pick the dominant force by the highest of the three structural grades
  // (swing is a derivative — it measures contrast, not a force per se).
  const sub: Array<{ label: string; value: number; color: string }> = [
    { label: 'Fate-dominant', value: grade.fate, color: '#EF4444' },
    { label: 'World-dominant', value: grade.world, color: '#22C55E' },
    { label: 'System-dominant', value: grade.system, color: '#3B82F6' },
  ];
  const dominant = sub.reduce((best, x) => (x.value > best.value ? x : best), sub[0]);
  // Tag "balanced" when no single force is meaningfully ahead — within 3
  // grade-points of the runner-up. The numeric threshold mirrors the
  // legacy MCTS panel's tolerance for treating multi-force arcs as
  // composite rather than dominant.
  const sorted = [...sub].sort((a, b) => b.value - a.value);
  const balanced = sorted[0].value - sorted[1].value < 3;
  return (
    <div className="flex items-center gap-3 text-[10px] font-mono">
      <div className="flex items-baseline gap-1">
        <span className="text-text-dim uppercase tracking-wider text-[9px]">Score</span>
        <span className={`text-base font-semibold ${scoreColorClass(grade.overall)}`}>{grade.overall}</span>
      </div>
      <div className="w-px h-3 bg-white/10" />
      <span
        className="text-[10px] uppercase tracking-wider"
        style={{ color: balanced ? 'var(--color-text-secondary)' : dominant.color }}
      >
        {balanced ? 'Balanced' : dominant.label}
      </span>
    </div>
  );
}

// ── Develops section (threads this branch progresses) ────────────────────

/** One thread transition — logType badge + per-outcome evidence chips. Matches
 *  the Scenes view in ThreadDetail / ArcDetail so branched generation reads the
 *  same as the committed timeline. */
function TransitionRow({ logType, updates }: { logType: string; updates: { outcome: string; evidence: number }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span
        className="text-[8px] uppercase tracking-wider font-semibold px-1 py-0.5 rounded"
        style={{ color: LOG_TYPE_HEX[logType] ?? '#888', backgroundColor: `${LOG_TYPE_HEX[logType] ?? '#888'}1a` }}
      >
        {logType}
      </span>
      {updates.map((u, j) => {
        const pos = u.evidence > 0, neg = u.evidence < 0;
        return (
          <span
            key={j}
            className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${pos ? 'bg-emerald-500/12 text-emerald-300' : neg ? 'bg-red-500/12 text-red-300' : 'bg-white/6 text-text-dim'}`}
          >
            <span className="truncate max-w-35">{u.outcome}</span>
            <span className="font-mono tabular-nums shrink-0">{u.evidence >= 0 ? '+' : ''}{u.evidence}</span>
          </span>
        );
      })}
    </div>
  );
}

export function DevelopsList({ run }: { run: ScenarioRun }) {
  if (!run.result) return null;
  const { arc, scenes, virtualNarrative } = run.result;
  if (arc.develops.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Develops</h3>
      <div className="flex flex-col gap-1.5">
        {arc.develops.map((threadId) => {
          const thread = virtualNarrative.threads[threadId];
          const transitions = scenes.flatMap((s) =>
            s.threadDeltas.filter((tm) => tm.threadId === threadId),
          );
          return (
            <div key={threadId} className="flex flex-col gap-1 rounded bg-white/3 px-2 py-1.5">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-text-dim shrink-0">{threadId}</span>
                <span className="text-[10px] text-text-secondary leading-relaxed">
                  {thread?.description ?? threadId}
                </span>
              </div>
              {transitions.length > 0 && (
                <div className="flex flex-col gap-1 pl-9">
                  {transitions.map((tm, i) => (
                    <TransitionRow key={i} logType={tm.logType} updates={tm.updates ?? []} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Scene list (clickable scene cards) ───────────────────────────────────

export function SceneList({
  scenes,
  forceMap,
  narrative,
  onSelectScene,
}: {
  scenes: Scene[];
  forceMap: Record<string, ForceSnapshot>;
  narrative: NarrativeState;
  onSelectScene: (index: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {scenes.map((s, i) => {
        const loc = narrative.locations[s.locationId];
        const pov = s.povId ? narrative.characters[s.povId] : null;
        const f = forceMap[s.id];
        const c = f ? detectCubeCorner(f) : null;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelectScene(i)}
            className="group flex flex-col gap-1 rounded bg-white/3 p-2 text-left transition-colors hover:bg-white/[0.07]"
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono text-[10px] text-text-dim">{i + 1}</span>
              {c && (
                <span className="flex items-center gap-1">
                  <svg width="18" height="10" viewBox="0 0 18 10">
                    {[0, 1, 2].map((fi) => {
                      const isHi = c.key[fi] === 'H';
                      const colors = ['#EF4444', '#22C55E', '#3B82F6'];
                      return (
                        <rect
                          key={fi}
                          x={fi * 6.5}
                          y={isHi ? 1 : 5}
                          width={5}
                          height={isHi ? 8 : 4}
                          rx={1}
                          fill={colors[fi]}
                          opacity={isHi ? 0.8 : 0.25}
                        />
                      );
                    })}
                  </svg>
                  <span className="text-[9px] font-medium" style={{ color: CUBE_COLORS[c.key] }}>
                    {c.name}
                  </span>
                </span>
              )}
              <span className="text-[10px] text-text-dim">{loc?.name ?? s.locationId}</span>
              {(pov || s.povId) && (
                <span className="text-[10px] text-text-dim ml-auto">POV: {pov?.name ?? s.povId}</span>
              )}
            </div>
            <p className="text-xs text-text-secondary leading-relaxed group-hover:text-text-primary transition-colors">
              {s.summary || 'No summary available.'}
            </p>
            {s.events.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {s.events.map((ev, j) => (
                  <span key={j} className="text-[9px] bg-amber-500/10 text-amber-400/80 rounded px-1.5 py-0.5">
                    {ev}
                  </span>
                ))}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Scene detail (drill-down) ────────────────────────────────────────────

export function SceneDetail({
  scene,
  index,
  forces,
  narrative,
  onBack,
}: {
  scene: Scene;
  index: number;
  forces: ForceSnapshot | null;
  narrative: NarrativeState;
  onBack: () => void;
}) {
  const corner = forces ? detectCubeCorner(forces) : null;
  const loc = narrative.locations[scene.locationId];
  const pov = scene.povId ? narrative.characters[scene.povId] : null;

  // First appearances — entities the scene introduces for the very first
  // time. Filtered against the resolved narrative so we don't show ghost
  // ids that didn't actually land.
  const firstAppearances = {
    characters: (scene.newCharacters ?? []).map((c) => c.id).filter((id) => narrative.characters[id]),
    locations: (scene.newLocations ?? []).map((l) => l.id).filter((id) => narrative.locations[id]),
    artifacts: (scene.newArtifacts ?? []).map((a) => a.id).filter((id) => narrative.artifacts[id]),
    threads: (scene.newThreads ?? []).map((t) => t.id).filter((id) => narrative.threads[id]),
  };
  const hasFirstAppearances =
    firstAppearances.characters.length > 0 ||
    firstAppearances.locations.length > 0 ||
    firstAppearances.artifacts.length > 0 ||
    firstAppearances.threads.length > 0;

  // System attributions filtered to exclude ids already shown as additions
  // — mirrors the canvas SceneDetail so attributions surface what the
  // scene is *acting on*, not what it just minted.
  const addedSystemIds = new Set((scene.systemDeltas?.addedNodes ?? []).map((n) => n.id));
  const attributionsOnly = (scene.attributions ?? []).filter(
    (id: string) => id.startsWith('SYS-') && !addedSystemIds.has(id),
  );

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-[10px] text-text-dim hover:text-text-secondary transition-colors self-start"
      >
        <span>←</span> Back to scenes
      </button>

      <div className="flex items-baseline gap-2">
        <h2 className="font-mono text-xs text-text-dim">Scene {index + 1}</h2>
        <span className="font-mono text-xs text-text-dim/70">{scene.id}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <IconLocationPin size={14} className="shrink-0 text-text-dim" />
          <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">Location</span>
          {loc?.name ?? scene.locationId}
        </div>
        {(pov || scene.povId) && (
          <div className="flex items-center gap-1.5 text-xs text-text-secondary">
            <IconEye size={14} className="shrink-0 text-text-dim" />
            <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">POV</span>
            {pov?.name ?? scene.povId}
          </div>
        )}
      </div>

      <p className="text-xs text-text-secondary leading-relaxed">
        {scene.summary || 'No summary available.'}
      </p>

      {/* First Appearances — emerald callout, matches canvas inspector. */}
      {hasFirstAppearances && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-emerald-400/15 bg-emerald-400/5 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <svg className="w-3 h-3 shrink-0 text-emerald-400/80" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l1.8 5.5L19 9l-5 3.5L15.5 19 12 15.5 8.5 19 10 12.5 5 9l5.2-1.5z" />
            </svg>
            <h3 className="text-[10px] uppercase tracking-widest font-semibold text-emerald-400/80">
              First Appearances
            </h3>
            <span className="ml-auto text-[10px] text-emerald-400/40 font-mono tabular-nums">
              {firstAppearances.characters.length +
                firstAppearances.locations.length +
                firstAppearances.artifacts.length +
                firstAppearances.threads.length}
            </span>
          </div>
          {firstAppearances.characters.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wider text-text-dim">
                Characters · {firstAppearances.characters.length}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {firstAppearances.characters.map((cid) => {
                  const c = narrative.characters[cid];
                  if (!c) return null;
                  return (
                    <span
                      key={cid}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100"
                    >
                      <span>{c.name}</span>
                      <span className="text-[8px] uppercase tracking-wider text-emerald-400/60">
                        {c.role}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {firstAppearances.locations.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wider text-text-dim">
                Locations · {firstAppearances.locations.length}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {firstAppearances.locations.map((lid) => {
                  const l = narrative.locations[lid];
                  if (!l) return null;
                  return (
                    <span
                      key={lid}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100"
                    >
                      <span>{l.name}</span>
                      <span className="text-[8px] uppercase tracking-wider text-emerald-400/60">
                        {l.prominence}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {firstAppearances.artifacts.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wider text-text-dim">
                Artifacts · {firstAppearances.artifacts.length}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {firstAppearances.artifacts.map((aid) => {
                  const a = narrative.artifacts[aid];
                  if (!a) return null;
                  return (
                    <span
                      key={aid}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100"
                    >
                      <span>{a.name}</span>
                      <span className="text-[8px] uppercase tracking-wider text-emerald-400/60">
                        {a.significance}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {firstAppearances.threads.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wider text-text-dim">
                Threads · {firstAppearances.threads.length}
              </span>
              <div className="flex flex-col gap-1">
                {firstAppearances.threads.map((tid) => {
                  const t = narrative.threads[tid];
                  if (!t) return null;
                  return (
                    <div
                      key={tid}
                      className="flex items-start gap-1.5 rounded bg-emerald-400/10 px-2 py-1"
                    >
                      <span className="shrink-0 font-mono text-[9px] text-emerald-400/60">{tid}</span>
                      <span className="text-[10px] leading-tight text-emerald-100">
                        {t.description}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Time Transition — natural-language phrase with directional accent.
          Negative = flashback (violet), zero = concurrent (dim), positive
          = forward (amber). Mirrors the canvas presentation. */}
      {scene.timeDelta && (() => {
        const td = scene.timeDelta;
        const phrase = td.transition?.trim();
        const isFlashback = td.value < 0;
        const isConcurrent = td.value === 0;
        const accent = isFlashback
          ? 'text-violet-400'
          : isConcurrent
            ? 'text-text-dim'
            : 'text-amber-400';
        const gapLabel = `${td.value} ${td.unit}`;
        return (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Time Transition</h3>
            <div className="flex flex-col gap-0.5">
              <div className={`text-xs font-medium ${accent}`}>
                {isFlashback ? '↶ ' : isConcurrent ? '= ' : '→ '}
                {gapLabel}
              </div>
              {phrase && (
                <div className="text-xs italic text-text-secondary">&ldquo;{phrase}&rdquo;</div>
              )}
            </div>
          </div>
        );
      })()}

      {scene.participantIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Participants</h3>
          <div className="flex flex-wrap gap-1.5">
            {scene.participantIds.map((pid, pidIdx) => {
              const char = narrative.characters[pid];
              return (
                <span
                  key={`${pid}-${pidIdx}`}
                  className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary"
                >
                  {char?.name ?? pid}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {corner && forces && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <svg width="24" height="12" viewBox="0 0 24 12">
              {corner.key.split('').map((_, i) => {
                const isHi = corner.key[i] === 'H';
                const colors = ['#EF4444', '#22C55E', '#3B82F6'];
                return (
                  <rect
                    key={i}
                    x={i * 9}
                    y={isHi ? 1 : 6}
                    width={7}
                    height={isHi ? 10 : 5}
                    rx={1.5}
                    fill={colors[i]}
                    opacity={isHi ? 1 : 0.4}
                  />
                );
              })}
            </svg>
            <span className="text-[11px] text-text-secondary">{corner.name}</span>
          </div>
          <div className="flex gap-3">
            {([
              { label: 'Fate', value: forces.fate, color: '#EF4444' },
              { label: 'World', value: forces.world, color: '#22C55E' },
              { label: 'System', value: forces.system, color: '#3B82F6' },
            ] as const).map(({ label, value, color }) => (
              <div key={label} className="flex flex-1 flex-col gap-1">
                <span className="text-[10px] uppercase text-text-dim">{label}</span>
                <div className="h-1.5 w-full rounded-full bg-white/6">
                  <div
                    className="h-1.5 rounded-full"
                    style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {scene.events.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Events</h3>
          <div className="flex flex-wrap gap-1.5">
            {scene.events.map((ev, j) => (
              <span key={j} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400/80">
                {ev}
              </span>
            ))}
          </div>
        </div>
      )}

      {scene.threadDeltas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Thread Deltas</h3>
          {scene.threadDeltas.map((tm, j) => {
            const thread = narrative.threads[tm.threadId];
            return (
              <div key={j} className="flex flex-col gap-0.5 text-xs">
                <div className="flex items-baseline gap-1.5">
                  <span className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary shrink-0">
                    {tm.threadId}
                  </span>
                  {thread && (
                    <span className="text-text-dim text-[10px] leading-snug flex-1">
                      {thread.description}
                    </span>
                  )}
                </div>
                <div className="pl-2">
                  <TransitionRow logType={tm.logType} updates={tm.updates ?? []} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {scene.relationshipDeltas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Relationships</h3>
          {scene.relationshipDeltas.map((rm, j) => {
            const fromName = narrative.characters[rm.from]?.name ?? rm.from;
            const toName = narrative.characters[rm.to]?.name ?? rm.to;
            return (
              <div key={j} className="flex flex-col gap-0.5 text-xs">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="text-text-primary">{fromName}</span>
                  <span className="text-text-dim">→</span>
                  <span className="text-text-primary">{toName}</span>
                  <span
                    className={`font-mono text-[10px] ml-auto ${
                      rm.valenceDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {rm.valenceDelta > 0 ? '+' : ''}
                    {rm.valenceDelta}
                  </span>
                </div>
                {rm.type && (
                  <span className="text-[10px] uppercase tracking-[0.12em] text-text-dim/80 font-mono pl-2">
                    {rm.type}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {scene.worldDeltas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">World</h3>
          {scene.worldDeltas.flatMap((km, j) => {
            const entityName =
              narrative.characters[km.entityId]?.name ??
              narrative.locations[km.entityId]?.name ??
              narrative.artifacts[km.entityId]?.name ??
              km.entityId;
            return (km.addedNodes ?? []).map((nd, k) => (
              <div key={`${j}-${k}`} className="flex flex-col gap-0.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-text-primary">{entityName}</span>
                  <span className="text-emerald-400">+</span>
                  <span className="font-mono text-[10px] text-text-dim">{nd.id}</span>
                </div>
                <span className="text-text-secondary pl-2">{nd.content}</span>
              </div>
            ));
          })}
        </div>
      )}

      {scene.systemDeltas &&
        (scene.systemDeltas.addedNodes?.length > 0 || scene.systemDeltas.addedEdges?.length > 0) && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[10px] uppercase tracking-widest text-text-dim">System Knowledge</h3>
            {scene.systemDeltas.addedNodes?.map((wkn, j) => (
              <div key={`wkn-${j}`} className="flex items-baseline gap-1.5 text-xs">
                <span className="text-emerald-400">+</span>
                <span className="text-text-primary">{wkn.concept}</span>
                <span className="text-[10px] text-text-dim">({wkn.type})</span>
              </div>
            ))}
            {scene.systemDeltas.addedEdges?.map((wke, j) => {
              const fromNode = narrative.systemGraph?.nodes?.[wke.from];
              const toNode = narrative.systemGraph?.nodes?.[wke.to];
              const shortName = (concept: string) => {
                const d = concept.indexOf(' — ');
                return d > 0 ? concept.slice(0, d) : concept;
              };
              return (
                <div key={`wke-${j}`} className="text-xs pl-3 text-text-dim">
                  {shortName(fromNode?.concept ?? wke.from)}{' '}
                  <span className="italic">{wke.relation}</span>{' '}
                  {shortName(toNode?.concept ?? wke.to)}
                </div>
              );
            })}
          </div>
        )}

      {scene.artifactUsages && scene.artifactUsages.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Artifact Usages</h3>
          {scene.artifactUsages.map((au, j) => {
            const artName = narrative.artifacts[au.artifactId]?.name ?? au.artifactId;
            const charName = au.characterId
              ? narrative.characters[au.characterId]?.name ?? au.characterId
              : null;
            return (
              <div key={j} className="flex flex-col gap-0.5 text-xs">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-text-primary">{artName}</span>
                  {charName && (
                    <>
                      <span className="text-text-dim text-[10px]">by</span>
                      <span className="text-text-secondary">{charName}</span>
                    </>
                  )}
                </div>
                {au.usage && (
                  <span className="text-text-secondary pl-2 leading-snug">{au.usage}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {scene.ownershipDeltas && scene.ownershipDeltas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Artifact Transfers</h3>
          {scene.ownershipDeltas.map((od, j) => {
            const artName = narrative.artifacts[od.artifactId]?.name ?? od.artifactId;
            const fromName =
              narrative.characters[od.fromId]?.name ??
              narrative.locations[od.fromId]?.name ??
              od.fromId;
            const toName =
              narrative.characters[od.toId]?.name ??
              narrative.locations[od.toId]?.name ??
              od.toId;
            return (
              <div key={j} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                <span className="text-text-primary">{artName}</span>
                <span className="text-text-dim">·</span>
                <span className="text-text-secondary">{fromName}</span>
                <span className="text-text-dim">→</span>
                <span className="text-text-secondary">{toName}</span>
              </div>
            );
          })}
        </div>
      )}

      {scene.tieDeltas && scene.tieDeltas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Location Ties</h3>
          {scene.tieDeltas.map((td, j) => {
            const charName = narrative.characters[td.characterId]?.name ?? td.characterId;
            const locName = narrative.locations[td.locationId]?.name ?? td.locationId;
            return (
              <div key={j} className="flex items-center gap-1.5 text-xs">
                <span className={td.action === 'add' ? 'text-emerald-400' : 'text-rose-400'}>
                  {td.action === 'add' ? '+' : '−'}
                </span>
                <span className="text-text-primary">{charName}</span>
                <span className="text-text-dim">↔</span>
                <span className="text-text-secondary">{locName}</span>
              </div>
            );
          })}
        </div>
      )}

      {attributionsOnly.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            System Attributions
            <span className="ml-1.5 text-text-dim/60 font-mono normal-case tracking-normal">
              {attributionsOnly.length}
            </span>
          </h3>
          <div className="flex flex-wrap gap-1">
            {attributionsOnly.map((attrId: string) => {
              const node = narrative.systemGraph?.nodes?.[attrId];
              const shortName = (concept: string) => {
                const dash = concept.indexOf(' — ');
                return dash > 0 ? concept.slice(0, dash) : concept;
              };
              return (
                <span
                  key={`attr-${attrId}`}
                  className="rounded border border-white/10 bg-white/2 px-1.5 py-0.5 text-[10px] text-text-secondary"
                  title={node ? `${node.concept} (${node.type})` : attrId}
                >
                  {node ? shortName(node.concept) : attrId}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export { POSITION_COLORS };
