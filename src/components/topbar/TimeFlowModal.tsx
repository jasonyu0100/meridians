'use client';

import { useMemo, useState } from 'react';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { useStore } from '@/lib/store';
import {
  computeSceneOffsets,
  formatCumulative,
  formatTimeDelta,
  SECONDS_PER_UNIT,
  TIME_UNITS_ASCENDING,
  timeDeltaToSeconds,
} from '@/lib/time-deltas';
import { isScene, resolveEntry, type Scene, type TimeUnit } from '@/types/narrative';

type Props = { onClose: () => void };
type View = 'rhythm' | 'cumulative' | 'gaps' | 'distribution';

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: 'rhythm', label: 'Rhythm', hint: 'Sequence at a glance — where the story is in-the-moment vs days apart.' },
  { id: 'cumulative', label: 'Cumulative', hint: 'Running total — line rises on forward, dips on flashbacks.' },
  { id: 'gaps', label: 'Per-Scene Gaps', hint: 'Each jump as a signed bar. Forward goes up, flashback goes down.' },
  { id: 'distribution', label: 'Distribution', hint: 'How many gaps fell in each unit band — pacing fingerprint.' },
];

const FORWARD = '#fbbf24';
const FLASHBACK = '#a78bfa';
const CONCURRENT = '#64748b';
const CURRENT = '#22d3ee';

/** Time-flow visualisation across the active branch. Three views, all
 *  honouring real long-form pacing — non-linear, signed, banded across
 *  orders of magnitude (minute / hour / day / week / month / year). */
export function TimeFlowModal({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [view, setView] = useState<View>('rhythm');

  const data = useMemo(() => {
    if (!narrative) return null;
    const scenes: Scene[] = state.resolvedEntryKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
    if (scenes.length === 0) return null;
    const offsets = computeSceneOffsets(scenes);
    const gapsSec = scenes.map((s) => (s.timeDelta ? timeDeltaToSeconds(s.timeDelta) : 0));
    const minOffset = Math.min(0, ...offsets);
    const maxOffset = Math.max(0, ...offsets);
    const minGap = Math.min(0, ...gapsSec);
    const maxGap = Math.max(0, ...gapsSec);
    return { scenes, offsets, gapsSec, minOffset, maxOffset, minGap, maxGap };
  }, [narrative, state.resolvedEntryKeys]);

  if (!narrative || !data || data.scenes.length === 0) {
    return (
      <Modal onClose={onClose} size="2xl">
        <ModalHeader onClose={onClose}>
          <h2 className="text-sm font-semibold text-text-primary">Time</h2>
        </ModalHeader>
        <ModalBody>
          <p className="text-xs text-text-dim">No scenes on the active branch yet.</p>
        </ModalBody>
      </Modal>
    );
  }

  const currentIndex = state.viewState.currentSceneIndex;

  return (
    <Modal onClose={onClose} size="6xl">
      <ModalHeader onClose={onClose}>
        <h2 className="text-sm font-semibold text-text-primary">Time</h2>
        <span className="text-[10px] text-text-dim">non-linear · banded · signed</span>
      </ModalHeader>
      <ModalBody>
        <div className="flex flex-col gap-3">
          {/* View tabs */}
          <div className="flex items-center gap-1 border-b border-white/6">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className={`px-3 py-1.5 text-xs transition-colors -mb-px border-b-2 ${
                  view === v.id
                    ? 'border-amber-400 text-text-primary'
                    : 'border-transparent text-text-dim hover:text-text-secondary'
                }`}
              >
                {v.label}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-text-dim italic">
              {VIEWS.find((v) => v.id === view)?.hint}
            </span>
          </div>

          <Legend />

          <Summary
            totalSpan={formatCumulative(data.maxOffset)}
            earliestFlashback={data.minOffset < 0 ? formatCumulative(data.minOffset) : null}
            sceneCount={data.scenes.length}
            forwardCount={data.gapsSec.filter((g, i) => i > 0 && g > 0).length}
            flashbackCount={data.gapsSec.filter((g) => g < 0).length}
            concurrentCount={data.gapsSec.filter((g, i) => i > 0 && g === 0).length}
          />

          {view === 'rhythm' && (
            <RhythmView
              scenes={data.scenes}
              gapsSec={data.gapsSec}
              currentIndex={currentIndex}
              onSelect={(i) => dispatch({ type: 'SET_SCENE_INDEX', index: i })}
            />
          )}
          {view === 'cumulative' && (
            <CumulativeView
              scenes={data.scenes}
              offsets={data.offsets}
              currentIndex={currentIndex}
              onSelect={(i) => dispatch({ type: 'SET_SCENE_INDEX', index: i })}
            />
          )}
          {view === 'gaps' && (
            <GapsView
              scenes={data.scenes}
              gapsSec={data.gapsSec}
              currentIndex={currentIndex}
              onSelect={(i) => dispatch({ type: 'SET_SCENE_INDEX', index: i })}
            />
          )}
          {view === 'distribution' && (
            <DistributionView gapsSec={data.gapsSec} />
          )}
        </div>
      </ModalBody>
    </Modal>
  );
}

// ── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[10px] text-text-dim">
      <span><span style={{ color: FORWARD }}>●</span> forward</span>
      <span><span style={{ color: FLASHBACK }}>●</span> flashback (negative gap)</span>
      <span><span style={{ color: CONCURRENT }}>●</span> concurrent / opening</span>
      <span><span style={{ color: CURRENT }}>○</span> current scene</span>
    </div>
  );
}

function Summary({
  totalSpan,
  earliestFlashback,
  sceneCount,
  forwardCount,
  flashbackCount,
  concurrentCount,
}: {
  totalSpan: string;
  earliestFlashback: string | null;
  sceneCount: number;
  forwardCount: number;
  flashbackCount: number;
  concurrentCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] text-text-dim border border-white/6 rounded px-3 py-1.5">
      <span><span className="text-text-secondary">{sceneCount}</span> scenes</span>
      <span><span className="text-amber-400">{forwardCount}</span> forward</span>
      <span><span className="text-violet-400">{flashbackCount}</span> flashback{flashbackCount === 1 ? '' : 's'}</span>
      <span><span className="text-slate-400">{concurrentCount}</span> concurrent</span>
      <span className="ml-auto">total span <span className="text-text-secondary">{totalSpan}</span>{earliestFlashback ? ` · earliest flashback ${earliestFlashback}` : ''}</span>
    </div>
  );
}

// ── Banded scale (shared across views) ───────────────────────────────────────
// Each unit (minute / hour / day / week / month / year) gets equal visual
// space; log interpolation inside each band. Sub-minute lives in a half-band
// near the origin. The scale is signed: positive bands go up, negative bands
// (flashbacks) mirror down.

// Band indices: 0 = minute, 1 = hour, 2 = day, 3 = week, 4 = month,
// 5 = year (1y..<10y), 6 = decade (≥10y). Decade extends the scale beyond
// the canonical TimeUnit set so multi-year skips are visually distinct from
// single-year ones.
const DECADE_SECONDS = SECONDS_PER_UNIT.year * 10;
const TOP_BAND_INDEX = TIME_UNITS_ASCENDING.length; // 6 (decade)

function bandIndexFor(seconds: number): number {
  const abs = Math.abs(seconds);
  if (abs < SECONDS_PER_UNIT.minute) return -1;
  if (abs >= DECADE_SECONDS) return TOP_BAND_INDEX;
  for (let i = TIME_UNITS_ASCENDING.length - 1; i >= 0; i--) {
    if (abs >= SECONDS_PER_UNIT[TIME_UNITS_ASCENDING[i]]) return i;
  }
  return -1;
}

function bandLabel(b: number): string {
  if (b === TOP_BAND_INDEX) return '10 years';
  return pluralUnit(TIME_UNITS_ASCENDING[b]);
}

function bandLowSeconds(b: number): number {
  if (b === TOP_BAND_INDEX) return DECADE_SECONDS;
  return SECONDS_PER_UNIT[TIME_UNITS_ASCENDING[b]];
}

function makeBandedScale(opts: {
  minSeconds: number;
  maxSeconds: number;
  innerHeight: number;
  paddingTop: number;
}) {
  // Each visited unit gets a band of equal visual height. Allocate a band
  // ONLY for sides that actually have data — flashback-free narratives
  // don't need a negative half. Each side needs (max-band + 2) bands worth
  // of vertical space: band 0 (minute) sits between unit-tick 0 and
  // unit-tick 1 (1*BAND_PX above origin), and the top band ends at
  // (max-band+1)*BAND_PX above origin, with frac up to 1 reaching
  // (max-band+2)*BAND_PX.
  const upMaxBand = bandIndexFor(opts.maxSeconds);
  const downMaxBand = bandIndexFor(opts.minSeconds);
  const positiveBandCount = opts.maxSeconds > 0 ? Math.max(1, upMaxBand + 2) : 0;
  const negativeBandCount = opts.minSeconds < 0 ? Math.max(1, downMaxBand + 2) : 0;
  const totalBands = Math.max(1, positiveBandCount + negativeBandCount);
  // Per-band pixel height — keep at least 28 so labels are legible even on
  // narratives that only span minutes; grow to fill innerHeight when more
  // bands are present.
  const BAND_PX = Math.max(28, opts.innerHeight / totalBands);
  // Layout: positive bands sit ABOVE origin (small y), negative bands sit
  // BELOW (large y). Origin lives at the BOUNDARY between them — at the
  // bottom of the positive area, top of the negative area.
  const yZero = opts.paddingTop + positiveBandCount * BAND_PX;
  const plotHeightActual = totalBands * BAND_PX;

  function yForSeconds(seconds: number): number {
    if (seconds === 0) return yZero;
    const sign = seconds < 0 ? -1 : 1;
    const abs = Math.abs(seconds);
    const band = bandIndexFor(seconds);
    if (band < 0) {
      // Sub-minute — sits within the first BAND_PX of its side.
      const frac = abs / SECONDS_PER_UNIT.minute;
      return yZero - sign * frac * BAND_PX;
    }
    const bandLow = bandLowSeconds(band);
    // Top band's high edge is 10× its low (decade band → 100y, year→decade).
    const bandHigh = band === TOP_BAND_INDEX
      ? bandLow * 10
      : bandLowSeconds(band + 1);
    const frac = Math.min(1, Math.max(0, Math.log(abs / bandLow) / Math.log(bandHigh / bandLow)));
    // The +1 unit-tick line for band b sits at yZero ± (b+1)*BAND_PX. A
    // value at frac=0 lands on that tick; frac=1 lands at the next tick
    // (the next unit's tick).
    const offsetFromOrigin = (band + 1) * BAND_PX + frac * BAND_PX;
    return yZero - sign * offsetFromOrigin;
  }

  // Tick lines at unit boundaries — only on the sides where we have data.
  // Includes the +10 years (decade) tick when the data reaches it.
  const ticks: { y: number; label: string; sign: '+' | '-' }[] = [];
  for (let b = 0; b <= upMaxBand; b++) {
    ticks.push({ y: yForSeconds(bandLowSeconds(b)), label: bandLabel(b), sign: '+' });
  }
  for (let b = 0; b <= downMaxBand; b++) {
    ticks.push({ y: yForSeconds(-bandLowSeconds(b)), label: bandLabel(b), sign: '-' });
  }

  return { yForSeconds, yZero, plotHeightActual, ticks };
}

// ── Rhythm view ──────────────────────────────────────────────────────────────
// Each scene is a colour-coded block in a horizontal strip. Colour encodes
// the gap-band into that scene — at-a-glance the chart shows where the
// narrative is "in the moment" (warm, tight blocks), where days/weeks
// elapse (cooler blocks), and where huge skips occur (deep blocks).
// Below the strip: detected RUNS of consecutive same-band scenes are
// labelled, surfacing the work's pacing structure (e.g. "8 scenes / hour-
// paced", "3 scenes / week-paced") without making the user trace the strip.

// Band-colour mapping. Index -1 (sub-minute) is "in the moment" — warmest.
// Decade (top) is the coolest; concurrent and flashback have their own
// treatments overlaid on top of the base band colour.
const BAND_COLOUR: Record<number, { base: string; label: string; tone: string }> = {
  [-1]: { base: '#fb7185', label: 'in-the-moment (sub-minute)', tone: 'red' },
  0: { base: '#fb923c', label: 'minute-paced', tone: 'orange' },
  1: { base: '#fbbf24', label: 'hour-paced', tone: 'amber' },
  2: { base: '#facc15', label: 'day-paced', tone: 'yellow' },
  3: { base: '#34d399', label: 'week-paced', tone: 'emerald' },
  4: { base: '#38bdf8', label: 'month-paced', tone: 'sky' },
  5: { base: '#818cf8', label: 'year-paced', tone: 'indigo' },
  6: { base: '#c084fc', label: 'decade-skip', tone: 'violet' },
};
const CONCURRENT_BLOCK = '#64748b';

function bandKey(gapSec: number, isFirst: boolean): { idx: number | 'concurrent' | 'first'; colour: string; label: string } {
  if (isFirst) return { idx: 'first', colour: CONCURRENT_BLOCK, label: 'opening' };
  if (gapSec === 0) return { idx: 'concurrent', colour: CONCURRENT_BLOCK, label: 'concurrent' };
  const b = bandIndexFor(gapSec);
  const meta = BAND_COLOUR[b] ?? BAND_COLOUR[0];
  return { idx: b, colour: meta.base, label: meta.label };
}

// Map a gap to a 0..1 intensity. Tight gaps PEAK (1.0); slow gaps VALLEY (0.0).
// Continuous across band boundaries: log-fraction within each band so a 30-
// minute gap and a 5-hour gap sit at clearly different heights even though
// both are "in the same band visually".
//
// Position scale (0 = top peak, 8 = bottom valley):
//   0 = concurrent (gap = 0)
//   0..1 = sub-minute (interpolated)
//   1..2 = minute band
//   2..3 = hour band
//   3..4 = day band
//   4..5 = week band
//   5..6 = month band
//   6..7 = year band (1y..<10y)
//   7..8 = decade band (≥10y, log-saturating)
const TOTAL_POSITIONS = 8;

function bandPositionFor(gapSec: number): number {
  if (gapSec === 0) return 0;
  const abs = Math.abs(gapSec);
  if (abs < SECONDS_PER_UNIT.minute) {
    return Math.min(1, abs / SECONDS_PER_UNIT.minute);
  }
  const b = bandIndexFor(abs); // 0..6
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

function RhythmView({
  scenes,
  gapsSec,
  currentIndex,
  onSelect,
}: {
  scenes: Scene[];
  gapsSec: number[];
  currentIndex: number;
  onSelect: (i: number) => void;
}) {
  // ── Inverse area chart layout ──────────────────────────────────────────
  // X = scene index (uniform spacing). Y = intensity, peaks at the top
  // (tight pacing), valleys at the bottom (slow / generational gaps).
  const SCENE_WIDTH = 22;
  const PADDING_X = 70;
  const PADDING_TOP = 24;
  const PADDING_BOTTOM = 32;
  const PLOT_HEIGHT = 260;
  const innerHeight = PLOT_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const totalWidth = PADDING_X * 2 + Math.max(scenes.length, 1) * SCENE_WIDTH;
  const xForIndex = (i: number) => PADDING_X + i * SCENE_WIDTH + SCENE_WIDTH / 2;
  const yForIntensity = (intensity: number) => PADDING_TOP + (1 - intensity) * innerHeight;
  const yBaseline = PADDING_TOP + innerHeight;

  // Build the line + area path. The line walks scene-by-scene; the area
  // closes back to the baseline so the filled region under the curve
  // visually carries the pacing density.
  const points = scenes.map((_, i) => ({ x: xForIndex(i), y: yForIntensity(intensityFor(gapsSec[i])) }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = points.length > 0
    ? `M ${points[0].x.toFixed(1)} ${yBaseline.toFixed(1)} ` +
      points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') +
      ` L ${points[points.length - 1].x.toFixed(1)} ${yBaseline.toFixed(1)} Z`
    : '';

  return (
    <div className="flex flex-col gap-3">
      {/* Inverse area chart — peaks = tight, valleys = slow */}
      <div className="rounded-lg border border-white/10 bg-bg-elev/40 overflow-hidden">
        <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-text-dim border-b border-white/6 flex items-center justify-between">
          <span>Pacing intensity · peaks = events close together · valleys = events apart</span>
        </div>
        <div className="overflow-x-auto">
          <svg width={totalWidth} height={PLOT_HEIGHT} className="block">
            <defs>
              <linearGradient id="rhythm-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fb7185" stopOpacity="0.55" />
                <stop offset="20%" stopColor="#fbbf24" stopOpacity="0.45" />
                <stop offset="50%" stopColor="#34d399" stopOpacity="0.30" />
                <stop offset="80%" stopColor="#818cf8" stopOpacity="0.20" />
                <stop offset="100%" stopColor="#c084fc" stopOpacity="0.10" />
              </linearGradient>
            </defs>

            {/* Horizontal band tick lines + labels */}
            {POSITION_LABELS.map(({ pos, label }) => {
              const intensity = 1 - pos / TOTAL_POSITIONS;
              const y = yForIntensity(intensity);
              const isPeak = pos === 0;
              return (
                <g key={`pos-${pos}`}>
                  <line
                    x1={PADDING_X}
                    x2={totalWidth - 8}
                    y1={y}
                    y2={y}
                    stroke={isPeak ? 'rgba(251,113,133,0.35)' : 'rgba(148,163,184,0.10)'}
                    strokeWidth={isPeak ? 1 : 0.5}
                    strokeDasharray={isPeak ? '' : '2 4'}
                  />
                  <text x={PADDING_X - 6} y={y + 3} fontSize={9} fill={isPeak ? 'rgba(251,113,133,0.85)' : 'rgba(148,163,184,0.7)'} textAnchor="end" fontWeight={isPeak ? 600 : 400}>
                    {label}
                  </text>
                </g>
              );
            })}

            {/* Baseline (decade valley floor) */}
            <line
              x1={PADDING_X}
              x2={totalWidth - 8}
              y1={yBaseline}
              y2={yBaseline}
              stroke="rgba(148,163,184,0.45)"
              strokeWidth={1}
            />

            {/* Area fill */}
            {areaPath && <path d={areaPath} fill="url(#rhythm-area)" stroke="none" />}

            {/* Line on top of the area */}
            {linePath && <path d={linePath} fill="none" stroke="rgba(251,191,36,0.85)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}

            {/* Scene markers — clickable, with flashback overlay */}
            {scenes.map((scene, i) => {
              const value = scene.timeDelta?.value ?? 0;
              const isFlashback = i > 0 && value < 0;
              const isFirst = i === 0;
              const { x, y } = points[i];
              const isCurrent = i === currentIndex;
              const td = scene.timeDelta;
              const phrase = td?.transition?.trim();
              const { label } = bandKey(gapsSec[i], isFirst);
              const tooltip = `Scene ${i + 1}${scene.summary ? ` — ${scene.summary.slice(0, 60)}` : ''}\nGap: ${td ? formatTimeDelta(td) : '—'} (${isFlashback ? 'flashback · ' : ''}${label})${phrase ? `\nTransition: ${phrase}` : ''}`;
              return (
                <g
                  key={`marker-${scene.id}-${i}`}
                  className="cursor-pointer"
                  onClick={() => onSelect(i)}
                >
                  <title>{tooltip}</title>
                  <circle cx={x} cy={y} r={isCurrent ? 6 : 3} fill={isFlashback ? FLASHBACK : 'rgba(251,191,36,0.95)'} stroke={isCurrent ? CURRENT : 'transparent'} strokeWidth={isCurrent ? 2 : 0} />
                  {isFlashback && (
                    <text x={x} y={y - 8} fontSize={10} fill={FLASHBACK} textAnchor="middle">↶</text>
                  )}
                </g>
              );
            })}

            {/* X-axis scene-index labels */}
            {scenes.map((_, i) => {
              const step = Math.max(1, Math.ceil(scenes.length / 12));
              if (i !== 0 && i !== scenes.length - 1 && i % step !== 0) return null;
              return (
                <text
                  key={`xlabel-${i}`}
                  x={xForIndex(i)}
                  y={PLOT_HEIGHT - PADDING_BOTTOM + 16}
                  fontSize={9}
                  fill="rgba(148,163,184,0.6)"
                  textAnchor="middle"
                >
                  {i + 1}
                </text>
              );
            })}
          </svg>
        </div>
      </div>

    </div>
  );
}

// ── Cumulative view ──────────────────────────────────────────────────────────

function CumulativeView({
  scenes,
  offsets,
  currentIndex,
  onSelect,
}: {
  scenes: Scene[];
  offsets: number[];
  currentIndex: number;
  onSelect: (i: number) => void;
}) {
  const SCENE_WIDTH = 32;
  const PADDING_X = 64;
  const PADDING_TOP = 24;
  const PADDING_BOTTOM = 40;
  const innerHeight = 360;
  const totalWidth = PADDING_X * 2 + scenes.length * SCENE_WIDTH;

  const minOffset = Math.min(0, ...offsets);
  const maxOffset = Math.max(0, ...offsets);
  const scale = makeBandedScale({ minSeconds: minOffset, maxSeconds: maxOffset, innerHeight, paddingTop: PADDING_TOP });
  const totalHeight = scale.plotHeightActual + PADDING_TOP + PADDING_BOTTOM;
  const xForIndex = (i: number) => PADDING_X + i * SCENE_WIDTH + SCENE_WIDTH / 2;

  const pathD = scenes
    .map((_, i) => {
      const x = xForIndex(i);
      const y = scale.yForSeconds(offsets[i]);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <ChartFrame totalWidth={totalWidth} totalHeight={totalHeight}>
      <BandGrid ticks={scale.ticks} yZero={scale.yZero} totalWidth={totalWidth} paddingX={PADDING_X} />
      <path d={pathD} fill="none" stroke={`${FORWARD}99`} strokeWidth={1.5} />
      {scenes.map((scene, i) => {
        const td = scene.timeDelta;
        const value = td?.value ?? 0;
        const x = xForIndex(i);
        const y = scale.yForSeconds(offsets[i]);
        const isFlashback = value < 0;
        const isConcurrent = value === 0 && i !== 0;
        const fill = i === 0 || isConcurrent ? CONCURRENT : isFlashback ? FLASHBACK : FORWARD;
        return (
          <SceneMarker
            key={`marker-${scene.id}-${i}`}
            x={x}
            y={y}
            fill={fill}
            isCurrent={i === currentIndex}
            tooltip={tooltipFor(scene, i, td, offsets[i])}
            onClick={() => onSelect(i)}
            extra={
              isFlashback && i > 0 ? (
                <line
                  x1={xForIndex(i - 1)}
                  x2={x}
                  y1={scale.yForSeconds(offsets[i - 1])}
                  y2={y}
                  stroke={`${FLASHBACK}66`}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
              ) : null
            }
          />
        );
      })}
      <SceneIndexLabels scenes={scenes} xForIndex={xForIndex} y={totalHeight - PADDING_BOTTOM + 16} />
    </ChartFrame>
  );
}

// ── Per-Scene Gaps view ──────────────────────────────────────────────────────
// Each gap as a signed bar from the zero line. Forward = up, flashback = down.

function GapsView({
  scenes,
  gapsSec,
  currentIndex,
  onSelect,
}: {
  scenes: Scene[];
  gapsSec: number[];
  currentIndex: number;
  onSelect: (i: number) => void;
}) {
  const SCENE_WIDTH = 32;
  const PADDING_X = 64;
  const PADDING_TOP = 24;
  const PADDING_BOTTOM = 40;
  const innerHeight = 360;
  const totalWidth = PADDING_X * 2 + scenes.length * SCENE_WIDTH;

  const minGap = Math.min(0, ...gapsSec);
  const maxGap = Math.max(0, ...gapsSec);
  const scale = makeBandedScale({ minSeconds: minGap, maxSeconds: maxGap, innerHeight, paddingTop: PADDING_TOP });
  const totalHeight = scale.plotHeightActual + PADDING_TOP + PADDING_BOTTOM;
  const xForIndex = (i: number) => PADDING_X + i * SCENE_WIDTH + SCENE_WIDTH / 2;

  return (
    <ChartFrame totalWidth={totalWidth} totalHeight={totalHeight}>
      <BandGrid ticks={scale.ticks} yZero={scale.yZero} totalWidth={totalWidth} paddingX={PADDING_X} />
      {scenes.map((scene, i) => {
        const td = scene.timeDelta;
        const value = td?.value ?? 0;
        const gap = gapsSec[i];
        const x = xForIndex(i);
        const yBar = scale.yForSeconds(gap);
        const isFlashback = value < 0;
        const isConcurrent = value === 0 && i !== 0;
        const fill = i === 0 || isConcurrent ? CONCURRENT : isFlashback ? FLASHBACK : FORWARD;
        const barTop = Math.min(yBar, scale.yZero);
        const barHeight = Math.max(2, Math.abs(yBar - scale.yZero));
        return (
          <g
            key={`bar-${scene.id}-${i}`}
            className="cursor-pointer"
            onClick={() => onSelect(i)}
          >
            <title>{tooltipFor(scene, i, td, undefined)}</title>
            <rect
              x={x - SCENE_WIDTH / 2 + 4}
              y={barTop}
              width={SCENE_WIDTH - 8}
              height={barHeight}
              fill={`${fill}55`}
              stroke={fill}
              strokeWidth={i === currentIndex ? 1.5 : 0.5}
            />
            {i === currentIndex && (
              <rect
                x={x - SCENE_WIDTH / 2 + 4}
                y={barTop}
                width={SCENE_WIDTH - 8}
                height={barHeight}
                fill="none"
                stroke={CURRENT}
                strokeWidth={1.5}
              />
            )}
          </g>
        );
      })}
      <SceneIndexLabels scenes={scenes} xForIndex={xForIndex} y={totalHeight - PADDING_BOTTOM + 16} />
    </ChartFrame>
  );
}

// ── Distribution view ────────────────────────────────────────────────────────
// Compact horizontal histogram — one row per category. Reads top-to-bottom:
// flashbacks (largest unit first), concurrent, forward (largest unit last).
// Numbers right-aligned for easy comparison across rows.

function DistributionView({ gapsSec }: { gapsSec: number[] }) {
  type Row = { key: string; label: string; sign: '+' | '-' | '0'; count: number };
  const fwdCounts: number[] = Array(TOP_BAND_INDEX + 1).fill(0);
  const backCounts: number[] = Array(TOP_BAND_INDEX + 1).fill(0);
  let concurrentCount = 0;

  for (const g of gapsSec) {
    if (g === 0) { concurrentCount++; continue; }
    const b = bandIndexFor(g);
    if (b < 0) continue;
    if (g > 0) fwdCounts[b]++;
    else backCounts[b]++;
  }

  // Build rows. Drop empty bands so the chart only shows what matters.
  // Bands run minute (0) → decade (TOP_BAND_INDEX = 6, "+10 years").
  const labelFor = (b: number) => bandLabel(b);
  const flashbackRows: Row[] = [];
  for (let b = TOP_BAND_INDEX; b >= 0; b--) {
    if (backCounts[b] > 0) {
      flashbackRows.push({ key: `-${b}`, label: `−1 ${labelFor(b)}`, sign: '-', count: backCounts[b] });
    }
  }
  const forwardRows: Row[] = [];
  for (let b = 0; b <= TOP_BAND_INDEX; b++) {
    if (fwdCounts[b] > 0) {
      forwardRows.push({ key: `+${b}`, label: `+1 ${labelFor(b)}`, sign: '+', count: fwdCounts[b] });
    }
  }
  const concurrentRow: Row[] = concurrentCount > 0
    ? [{ key: '0', label: 'concurrent / opening', sign: '0', count: concurrentCount }]
    : [];
  const rows: Row[] = [...flashbackRows, ...concurrentRow, ...forwardRows];

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-bg-elev/40 p-6 text-center">
        <p className="text-xs text-text-dim">No gaps to bucket yet.</p>
      </div>
    );
  }

  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);

  function colourFor(sign: Row['sign']): string {
    if (sign === '+') return FORWARD;
    if (sign === '-') return FLASHBACK;
    return CONCURRENT;
  }

  return (
    <div className="rounded-lg border border-white/10 bg-bg-elev/40 overflow-hidden">
      <div className="grid items-center gap-x-3 px-4 py-3 text-[10px] text-text-dim uppercase tracking-widest border-b border-white/6"
           style={{ gridTemplateColumns: '160px 1fr 60px 50px' }}>
        <span>band</span>
        <span>distribution</span>
        <span className="text-right">count</span>
        <span className="text-right">share</span>
      </div>
      <div className="flex flex-col">
        {rows.map((row) => {
          const fillPct = (row.count / maxCount) * 100;
          const sharePct = (row.count / total) * 100;
          const colour = colourFor(row.sign);
          return (
            <div
              key={row.key}
              className="grid items-center gap-x-3 px-4 py-2 border-b border-white/4 last:border-b-0 hover:bg-white/2 transition-colors"
              style={{ gridTemplateColumns: '160px 1fr 60px 50px' }}
            >
              <span className="text-xs font-mono" style={{ color: colour }}>{row.label}</span>
              <div className="relative h-5 rounded bg-white/4 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{ width: `${fillPct}%`, backgroundColor: `${colour}55`, borderRight: `1px solid ${colour}` }}
                />
              </div>
              <span className="text-xs text-right font-mono text-text-secondary">{row.count}</span>
              <span className="text-[10px] text-right font-mono text-text-dim">{sharePct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
      <div className="px-4 py-2 text-[10px] text-text-dim border-t border-white/6 flex justify-between">
        <span>{rows.length} populated band{rows.length === 1 ? '' : 's'}</span>
        <span>{total} gap{total === 1 ? '' : 's'} total</span>
      </div>
    </div>
  );
}

// ── Shared chart bits ────────────────────────────────────────────────────────

function ChartFrame({ totalWidth, totalHeight, children }: { totalWidth: number; totalHeight: number; children: React.ReactNode }) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-white/10 bg-bg-elev/40">
      <svg width={totalWidth} height={totalHeight} className="block">
        {children}
      </svg>
    </div>
  );
}

function BandGrid({
  ticks,
  yZero,
  totalWidth,
  paddingX,
}: {
  ticks: { y: number; label: string; sign: '+' | '-' }[];
  yZero: number;
  totalWidth: number;
  paddingX: number;
}) {
  return (
    <g>
      {ticks.map(({ y, label, sign }, idx) => (
        <g key={`tick-${sign}${label}-${idx}`}>
          <line
            x1={paddingX}
            x2={totalWidth - 8}
            y1={y}
            y2={y}
            stroke="rgba(148,163,184,0.10)"
            strokeWidth={0.5}
            strokeDasharray="2 4"
          />
          <text x={paddingX - 6} y={y + 3} fontSize={9} fill="rgba(148,163,184,0.7)" textAnchor="end">
            {sign === '-' ? '−' : '+'}1 {label}
          </text>
        </g>
      ))}
      <line x1={paddingX} x2={totalWidth - 8} y1={yZero} y2={yZero} stroke="rgba(148,163,184,0.45)" strokeWidth={1} />
      <text x={paddingX - 6} y={yZero + 3} fontSize={9} fill="rgba(148,163,184,0.85)" textAnchor="end" fontWeight={600}>
        origin
      </text>
    </g>
  );
}

function SceneMarker({
  x,
  y,
  fill,
  isCurrent,
  tooltip,
  onClick,
  extra,
}: {
  x: number;
  y: number;
  fill: string;
  isCurrent: boolean;
  tooltip: string;
  onClick: () => void;
  extra?: React.ReactNode;
}) {
  const r = isCurrent ? 6 : 4;
  return (
    <g className="cursor-pointer" onClick={onClick}>
      <title>{tooltip}</title>
      {extra}
      <circle cx={x} cy={y} r={r + 4} fill="transparent" />
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={fill}
        stroke={isCurrent ? CURRENT : 'transparent'}
        strokeWidth={isCurrent ? 2 : 0}
      />
    </g>
  );
}

function SceneIndexLabels({
  scenes,
  xForIndex,
  y,
}: {
  scenes: Scene[];
  xForIndex: (i: number) => number;
  y: number;
}) {
  const step = Math.max(1, Math.ceil(scenes.length / 12));
  return (
    <g>
      {scenes.map((_, i) => {
        if (i !== 0 && i !== scenes.length - 1 && i % step !== 0) return null;
        return (
          <text
            key={`xlabel-${i}`}
            x={xForIndex(i)}
            y={y}
            fontSize={9}
            fill="rgba(148,163,184,0.6)"
            textAnchor="middle"
          >
            {i + 1}
          </text>
        );
      })}
    </g>
  );
}

function tooltipFor(scene: Scene, i: number, td: Scene['timeDelta'], cumulative: number | undefined): string {
  const tdDescr = td ? formatTimeDelta(td) : '—';
  const phrase = td?.transition?.trim();
  const summary = scene.summary?.slice(0, 60);
  const lines = [
    `Scene ${i + 1}${summary ? ` — ${summary}` : ''}`,
    `Gap: ${tdDescr}`,
  ];
  if (phrase) lines.push(`Transition: ${phrase}`);
  if (cumulative !== undefined) lines.push(`Cumulative: ${formatCumulative(cumulative)}`);
  return lines.join('\n');
}

function pluralUnit(unit: TimeUnit): string {
  return `${unit}s`;
}
