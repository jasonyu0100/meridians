'use client';
// ForceTimeline — scrollable scene-by-scene timeline strip with force snapshots per scene.

import { useMemo, useState, useRef, useEffect } from 'react';
import { useStore } from '@/lib/state/store';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { computeForceSnapshots, computeWindowedForces, computeRawForceTotals, computeActivityCurve, movingAverage, FORCE_WINDOW_SIZE, classifyCurrentPosition, detectCubeCorner } from '@/lib/forces/narrative-utils';
import ForceLineChart, { type ChartStyle } from './ForceLineChart';
import ActivityLineChart from './ActivityLineChart';
import { FORCE_TIMELINE_WINDOW_DEFAULT } from '@/lib/constants';

const FORCE_CONFIG = [
  { key: 'fate' as const, label: 'Fate', color: 'var(--color-fate)' },
  { key: 'world' as const, label: 'World', color: 'var(--color-world)' },
  { key: 'system' as const, label: 'System', color: 'var(--color-system)' },
] as const;

type Scope = 'global' | 'local';

export default function ForceTimeline() {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const resolvedEntryKeys = state.resolvedEntryKeys;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('global');
  const [showRaw, setShowRaw] = useState(true);

  // Global view window: cap how many scenes are rendered in the chart at once
  const [globalWindow, setGlobalWindow] = useState<number | null>(FORCE_TIMELINE_WINDOW_DEFAULT);
  const [chartStyle, setChartStyle] = useState<ChartStyle>({
    showArea: true,
    showWindow: true,
    showMovingAvg: true,
    curve: 'smooth',
  });
  const popRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [settingsOpen]);

  // All scenes in timeline order — each scene is one datapoint
  const allScenes = useMemo(() => {
    if (!narrative) return [];
    return resolvedEntryKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
  }, [narrative, resolvedEntryKeys]);

  // Map current timeline index (which includes world commits) → scene-array index
  const currentSceneIdx = useMemo(() => {
    if (allScenes.length === 0 || !narrative) return -1;
    return Math.min(
      allScenes.length - 1,
      resolvedEntryKeys.slice(0, state.viewState.currentSceneIndex + 1)
        .filter((k) => resolveEntry(narrative, k)?.kind === 'scene').length - 1,
    );
  }, [allScenes, state.viewState.currentSceneIndex, resolvedEntryKeys, narrative]);

  // Windowed forces
  const windowed = useMemo(() => {
    if (currentSceneIdx < 0) return null;
    return computeWindowedForces(allScenes, currentSceneIdx);
  }, [allScenes, currentSceneIdx]);

  // Full-history forces (normalized) — one datapoint per scene.
  // Passing narrative opts into the refined fate formula (F7) and
  // rank→Gaussian normalisation.
  const globalForceData = useMemo(() => {
    if (!narrative || allScenes.length === 0) return { fate: [] as number[], world: [] as number[], system: [] as number[] };
    const forceMap = computeForceSnapshots(allScenes, [], narrative);
    const fate: number[] = [];
    const world: number[] = [];
    const system: number[] = [];
    for (const s of allScenes) {
      const f = forceMap[s.id] ?? { fate: 0, world: 0, system: 0 };
      fate.push(f.fate);
      world.push(f.world);
      system.push(f.system);
    }
    return { fate, world, system };
  }, [narrative, allScenes]);

  // Full-history forces (raw) — one datapoint per scene
  const globalRawForceData = useMemo(() => {
    if (!narrative || allScenes.length === 0) return { fate: [] as number[], world: [] as number[], system: [] as number[] };
    const raw = computeRawForceTotals(allScenes, narrative);
    return { fate: raw.fate, world: raw.world, system: raw.system };
  }, [narrative, allScenes]);

  // Window-only forces for local scope (normalized)
  const localForceData = useMemo(() => {
    if (!windowed || !narrative) return { fate: [] as number[], world: [] as number[], system: [] as number[] };
    const fate: number[] = [];
    const world: number[] = [];
    const system: number[] = [];
    const windowScenes = allScenes.slice(windowed.windowStart, windowed.windowEnd + 1);
    let lastForce = { fate: 0, world: 0, system: 0 };
    for (const s of windowScenes) {
      lastForce = windowed.forceMap[s.id] ?? lastForce;
      fate.push(lastForce.fate);
      world.push(lastForce.world);
      system.push(lastForce.system);
    }
    return { fate, world, system };
  }, [windowed, allScenes, narrative]);

  // Window-only forces for local scope (raw)
  const localRawForceData = useMemo(() => {
    if (!windowed || !narrative) return { fate: [] as number[], world: [] as number[], system: [] as number[] };
    const windowScenes = allScenes.slice(windowed.windowStart, windowed.windowEnd + 1);
    const raw = computeRawForceTotals(windowScenes, narrative);
    return { fate: raw.fate, world: raw.world, system: raw.system };
  }, [windowed, allScenes, narrative]);

  const isLocal = scope === 'local';
  const fullChartData = isLocal
    ? (showRaw ? localRawForceData : localForceData)
    : (showRaw ? globalRawForceData : globalForceData);

  // Apply global window: slice around currentSceneIdx when in global scope
  const { chartData, globalWindowOffset } = useMemo(() => {
    if (isLocal || globalWindow === null || fullChartData.fate.length <= globalWindow) {
      return { chartData: fullChartData, globalWindowOffset: 0 };
    }
    const anchor = currentSceneIdx;
    const half = Math.floor(globalWindow / 2);
    let start = anchor - half;
    let end = start + globalWindow;
    if (start < 0) { start = 0; end = globalWindow; }
    if (end > fullChartData.fate.length) { end = fullChartData.fate.length; start = end - globalWindow; }
    start = Math.max(0, start);
    return {
      chartData: {
        fate: fullChartData.fate.slice(start, end),
        world: fullChartData.world.slice(start, end),
        system: fullChartData.system.slice(start, end),
      },
      globalWindowOffset: start,
    };
  }, [isLocal, globalWindow, fullChartData, currentSceneIdx]);

  // Moving averages for each force
  const chartMA = useMemo(() => ({
    fate: movingAverage(chartData.fate, FORCE_WINDOW_SIZE),
    world: movingAverage(chartData.world, FORCE_WINDOW_SIZE),
    system: movingAverage(chartData.system, FORCE_WINDOW_SIZE),
  }), [chartData]);

  // Window averages — average z-score within the current normalization window
  const chartAvg = useMemo(() => {
    const avg = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
    if (isLocal) {
      return {
        fate: avg(chartData.fate),
        world: avg(chartData.world),
        system: avg(chartData.system),
      };
    }
    // In global mode, translate windowed range into visible-data coords
    const ws = Math.max(0, (windowed?.windowStart ?? 0) - globalWindowOffset);
    const we = Math.min(chartData.fate.length, ((windowed?.windowEnd ?? chartData.fate.length - 1) + 1) - globalWindowOffset);
    return {
      fate: avg(chartData.fate.slice(ws, we)),
      world: avg(chartData.world.slice(ws, we)),
      system: avg(chartData.system.slice(ws, we)),
    };
  }, [chartData, isLocal, windowed, globalWindowOffset]);

  const chartCurrentIndex = isLocal
    ? (localForceData.fate.length - 1)
    : currentSceneIdx - globalWindowOffset;

  // Window highlight range for global chart (scene-array indices, adjusted for window offset)
  const windowRange = useMemo(() => {
    if (!windowed || isLocal) return undefined;
    return {
      start: windowed.windowStart - globalWindowOffset,
      end: windowed.windowEnd - globalWindowOffset,
    };
  }, [windowed, isLocal, globalWindowOffset]);

  // Activity curve with topology — always from normalized forces for proper curvature
  const normalizedChartData = isLocal ? localForceData : globalForceData;
  const activityCurve = useMemo(() => {
    if (normalizedChartData.fate.length === 0) return [];
    // Apply same windowing as chartData but on normalized values
    let fate = normalizedChartData.fate;
    let world = normalizedChartData.world;
    let system = normalizedChartData.system;
    if (!isLocal && globalWindow !== null && fate.length > globalWindow) {
      const anchor = currentSceneIdx;
      const half = Math.floor(globalWindow / 2);
      let start = anchor - half;
      let end = start + globalWindow;
      if (start < 0) { start = 0; end = globalWindow; }
      if (end > fate.length) { end = fate.length; start = end - globalWindow; }
      start = Math.max(0, start);
      fate = fate.slice(start, end);
      world = world.slice(start, end);
      system = system.slice(start, end);
    }
    const snapshots = fate.map((_, i) => ({ fate: fate[i], world: world[i], system: system[i] }));
    return computeActivityCurve(snapshots);
  }, [normalizedChartData, isLocal, globalWindow, currentSceneIdx]);

  // Local position + recent activity sparkline from the trailing window
  const { currentPosition, recentSparkline } = useMemo(() => {
    if (allScenes.length === 0) return { currentPosition: null, recentSparkline: [] };
    const scenes = windowed
      ? allScenes.slice(windowed.windowStart, windowed.windowEnd + 1)
      : allScenes;
    const snapshotMap = computeForceSnapshots(scenes);
    const ordered = scenes.map((s) => snapshotMap[s.id]).filter(Boolean);
    const pts = computeActivityCurve(ordered);
    const position = ordered.length > 0 ? classifyCurrentPosition(pts) : null;
    // Last ~12 smoothed values for the mini sparkline
    const spark = pts.slice(-12).map((p) => p.smoothed);
    return { currentPosition: position, recentSparkline: spark };
  }, [windowed, allScenes]);

  // Cube corner at current scene (normalized forces)
  const cubeCorner = useMemo(() => {
    if (currentSceneIdx < 0 || globalForceData.fate.length === 0) return null;
    const idx = Math.min(currentSceneIdx, globalForceData.fate.length - 1);
    return detectCubeCorner({
      fate: globalForceData.fate[idx],
      world: globalForceData.world[idx],
      system: globalForceData.system[idx],
    });
  }, [globalForceData, currentSceneIdx]);

  if (!narrative) {
    return (
      <div className="flex items-center justify-center h-25 shrink-0 glass-panel border-t border-border">
        <span className="text-text-dim text-xs tracking-widest uppercase">
          No force data
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-25 shrink-0 glass-panel border-t border-border">
      {/* Left: shape + cube panel */}
      <div className="flex flex-col justify-center border-r border-border shrink-0 w-36">
        {/* Position row */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50">
          {currentPosition && recentSparkline.length > 1 ? (
            <>
              <svg width="36" height="18" viewBox="0 0 36 18" className="shrink-0">
                {(() => {
                  const n = recentSparkline.length;
                  const min = Math.min(...recentSparkline);
                  const max = Math.max(...recentSparkline);
                  const range = max - min || 1;
                  const pts = recentSparkline.map((v, i) =>
                    `${(i / (n - 1)) * 36},${18 - ((v - min) / range) * 18}`
                  ).join(' ');
                  return <polyline points={pts} fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
                })()}
              </svg>
              <div className="flex flex-col min-w-0">
                <span className="text-[8px] uppercase tracking-widest text-text-dim">Local</span>
                <span className="text-[11px] font-medium text-text-primary truncate">{currentPosition.name}</span>
              </div>
            </>
          ) : (
            <span className="text-[9px] text-text-dim">—</span>
          )}
        </div>
        {/* Cube row */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          {cubeCorner ? (
            <>
              <svg width="36" height="18" viewBox="0 0 36 18" className="shrink-0">
                {(['P','C','K'] as const).map((label, i) => {
                  const isHigh = cubeCorner.key[i] === 'H';
                  const colors = ['#EF4444', '#22C55E', '#3B82F6'];
                  const barH = isHigh ? 14 : 6;
                  const x = i * 13;
                  return (
                    <g key={label}>
                      <rect x={x} y={18 - barH} width={10} height={barH} rx={1.5} fill={colors[i]} opacity={0.7} />
                      <text x={x + 5} y={17} textAnchor="middle" fontSize="4.5" fill="rgba(255,255,255,0.45)" fontFamily="monospace">{label}</text>
                    </g>
                  );
                })}
              </svg>
              <div className="flex flex-col min-w-0">
                <span className="text-[8px] uppercase tracking-widest text-text-dim">Cube</span>
                <span className="text-[11px] font-medium text-text-primary truncate">{cubeCorner.name}</span>
              </div>
            </>
          ) : (
            <span className="text-[9px] text-text-dim">—</span>
          )}
        </div>
      </div>

      {/* Activity chart (first) — signature-weighted curve with orange
          shading above zero (high-activity) and light-blue below
          (low-activity), peak/valley markers, macro trend. */}
      <div className="flex-1 min-w-0 border-r border-border">
        <ActivityLineChart
          activity={activityCurve}
          currentIndex={chartCurrentIndex}
          windowStart={!isLocal ? windowRange?.start : undefined}
          windowEnd={!isLocal ? windowRange?.end : undefined}
          raw={showRaw}
          style={chartStyle}
          average={activityCurve.length > 0 ? activityCurve.reduce((s, p) => s + p.smoothed, 0) / activityCurve.length : undefined}
        />
      </div>

      {/* Force line charts */}
      {FORCE_CONFIG.map((cfg) => (
        <div
          key={cfg.key}
          className="flex-1 min-w-0 border-r border-border"
        >
          <ForceLineChart
            data={chartData[cfg.key]}
            color={cfg.color}
            label={cfg.label}
            currentIndex={chartCurrentIndex}
            windowStart={!isLocal ? windowRange?.start : undefined}
            windowEnd={!isLocal ? windowRange?.end : undefined}
            positive={showRaw}
            raw={showRaw}
            style={chartStyle}
            movingAvg={chartMA[cfg.key]}
            average={chartAvg[cfg.key]}
          />
        </div>
      ))}

      {/* Right: Settings gear */}
      <div className="relative flex items-center justify-center px-2 border-l border-border shrink-0 w-9" ref={popRef}>
        <button
          type="button"
          onClick={() => setSettingsOpen((o) => !o)}
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
            settingsOpen ? 'text-text-primary bg-white/8' : 'text-text-dim hover:text-text-primary hover:bg-white/6'
          }`}
          title="Force graph settings"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {settingsOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-48 rounded-lg glass py-2 px-2.5 z-50">
            <span className="text-[9px] uppercase tracking-widest text-text-dim block mb-2">
              Graph Settings
            </span>

            {/* Scope toggle */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-text-secondary">Scope</span>
              <div className="flex rounded-md overflow-hidden border border-white/10">
                {(['global', 'local'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={`px-2 py-0.5 text-[10px] capitalize transition-colors ${
                      scope === s
                        ? 'bg-white/12 text-text-primary'
                        : 'text-text-dim hover:text-text-secondary'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Global window size */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-text-secondary">Window</span>
              <div className="flex rounded-md overflow-hidden border border-white/10">
                {([50, 100, 200, null] as const).map((w) => (
                  <button
                    key={w ?? 'all'}
                    type="button"
                    onClick={() => setGlobalWindow(w)}
                    className={`px-2 py-0.5 text-[10px] font-mono transition-colors ${
                      globalWindow === w
                        ? 'bg-white/12 text-text-primary'
                        : 'text-text-dim hover:text-text-secondary'
                    }`}
                  >
                    {w ?? 'All'}
                  </button>
                ))}
              </div>
            </div>

            {/* Curve style */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-text-secondary">Curve</span>
              <div className="flex rounded-md overflow-hidden border border-white/10">
                {(['smooth', 'linear', 'step'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChartStyle((prev) => ({ ...prev, curve: c }))}
                    className={`px-2 py-0.5 text-[10px] capitalize transition-colors ${
                      chartStyle.curve === c
                        ? 'bg-white/12 text-text-primary'
                        : 'text-text-dim hover:text-text-secondary'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Show area fill */}
            <label className="flex items-center justify-between mb-1.5 cursor-pointer">
              <span className="text-[11px] text-text-secondary">Area fill</span>
              <button
                type="button"
                role="switch"
                aria-checked={chartStyle.showArea}
                onClick={() => setChartStyle((prev) => ({ ...prev, showArea: !prev.showArea }))}
                className={`w-7 h-4 rounded-full transition-colors relative ${
                  chartStyle.showArea ? 'bg-white/25' : 'bg-white/8'
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                  chartStyle.showArea ? 'left-3.5' : 'left-0.5'
                }`} />
              </button>
            </label>

            {/* Show window highlight */}
            <label className="flex items-center justify-between mb-1.5 cursor-pointer">
              <span className="text-[11px] text-text-secondary">Window highlight</span>
              <button
                type="button"
                role="switch"
                aria-checked={chartStyle.showWindow}
                onClick={() => setChartStyle((prev) => ({ ...prev, showWindow: !prev.showWindow }))}
                className={`w-7 h-4 rounded-full transition-colors relative ${
                  chartStyle.showWindow ? 'bg-white/25' : 'bg-white/8'
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                  chartStyle.showWindow ? 'left-3.5' : 'left-0.5'
                }`} />
              </button>
            </label>

            {/* Show moving average */}
            <label className="flex items-center justify-between mb-1.5 cursor-pointer">
              <span className="text-[11px] text-text-secondary">Moving average</span>
              <button
                type="button"
                role="switch"
                aria-checked={chartStyle.showMovingAvg}
                onClick={() => setChartStyle((prev) => ({ ...prev, showMovingAvg: !prev.showMovingAvg }))}
                className={`w-7 h-4 rounded-full transition-colors relative ${
                  chartStyle.showMovingAvg ? 'bg-white/25' : 'bg-white/8'
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                  chartStyle.showMovingAvg ? 'left-3.5' : 'left-0.5'
                }`} />
              </button>
            </label>

            {/* Raw scores */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-[11px] text-text-secondary">Raw scores</span>
              <button
                type="button"
                role="switch"
                aria-checked={showRaw}
                onClick={() => setShowRaw((v) => !v)}
                className={`w-7 h-4 rounded-full transition-colors relative ${
                  showRaw ? 'bg-white/25' : 'bg-white/8'
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                  showRaw ? 'left-3.5' : 'left-0.5'
                }`} />
              </button>
            </label>
          </div>
        )}
      </div>

    </div>
  );
}
