'use client';
// EvalBar — timeline bar surfacing per-scene structural evaluation verdicts.

import { useMemo, useState, useEffect, useRef } from 'react';
import { useStore } from '@/lib/state/store';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import {
  computeForceSnapshots,
  computeActivityCurve,
  computeRawForceTotals,
  computeForceSignature,
} from '@/lib/forces/narrative-utils';

/**
 * Floating vertical activity bar. Grows from centre: orange gradient
 * fills upward for high-activity scenes, light-blue gradient fills
 * downward for low-activity stretches. Spring animation on scene
 * change. Matches the shading on the activity line chart so the two
 * instruments read as one.
 */
export default function EvalBar() {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const resolvedEntryKeys = state.resolvedEntryKeys;
  const currentSceneIndex = state.viewState.currentSceneIndex;

  const allScenes = useMemo(() => {
    if (!narrative) return [];
    return resolvedEntryKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
  }, [narrative, resolvedEntryKeys]);

  const activityCurve = useMemo(() => {
    if (allScenes.length === 0) return [];
    const snapshots = Object.values(computeForceSnapshots(allScenes, [], narrative));
    // Weight by the work's own signature (PCA) so the activity curve
    // reflects its actual force vocabulary rather than equal-weighting.
    const raw = computeRawForceTotals(allScenes, narrative);
    const sig = computeForceSignature(raw.fate, raw.world, raw.system);
    return computeActivityCurve(snapshots, sig.weights);
  }, [allScenes, narrative]);

  const currentActivity = useMemo(() => {
    if (!narrative || allScenes.length === 0 || activityCurve.length === 0) return null;
    const sceneIdx = Math.min(
      allScenes.length - 1,
      resolvedEntryKeys.slice(0, currentSceneIndex + 1)
        .filter((k) => resolveEntry(narrative, k)?.kind === 'scene').length - 1,
    );
    if (sceneIdx < 0 || sceneIdx >= activityCurve.length) return null;
    return activityCurve[sceneIdx];
  }, [narrative, allScenes, activityCurve, currentSceneIndex, resolvedEntryKeys]);

  // Sigmoid: activity z-score → 0..100% (50% = average activity level)
  const targetPct = useMemo(() => {
    if (!currentActivity) return 50;
    const d = currentActivity.smoothed;
    return 100 / (1 + Math.exp(-d * 3.0));
  }, [currentActivity]);

  // Spring animation
  const [displayPct, setDisplayPct] = useState(targetPct);
  const [calibrating, setCalibrating] = useState(false);
  const prevTarget = useRef(targetPct);
  const animFrame = useRef<number>(0);

  useEffect(() => {
    if (prevTarget.current === targetPct) return;
    const from = prevTarget.current;
    const to = targetPct;
    const delta = to - from;
    prevTarget.current = to;

    setCalibrating(true);
    const start = performance.now();
    const duration = 600;

    const spring = (t: number) => {
      const decay = Math.exp(-5 * t);
      return 1 - decay * Math.cos(8 * t);
    };

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      setDisplayPct(from + delta * spring(t));
      if (t < 1) {
        animFrame.current = requestAnimationFrame(tick);
      } else {
        setDisplayPct(to);
        setCalibrating(false);
      }
    };

    cancelAnimationFrame(animFrame.current);
    animFrame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame.current);
  }, [targetPct]);

  const isPositive = displayPct >= 50;
  const extent = Math.abs(displayPct - 50); // 0-50% how far from center
  const displayValue = currentActivity
    ? (currentActivity.smoothed >= 0 ? '+' : '') + currentActivity.smoothed.toFixed(1)
    : '—';

  const tag = currentActivity?.isPeak ? 'PEAK' : currentActivity?.isValley ? 'VALLEY' : null;

  // Fill grows from center: positive upward, negative downward
  // Gradient deepens from center (subtle) to edge (saturated)
  const fillStyle = isPositive
    ? { bottom: '50%', height: `${extent}%` }
    : { top: '50%', height: `${extent}%` };

  const fillGradient = isPositive
    ? 'linear-gradient(to top, rgba(245, 158, 11, 0.08), rgba(245, 158, 11, 0.55))'
    : 'linear-gradient(to bottom, rgba(147, 197, 253, 0.08), rgba(147, 197, 253, 0.55))';

  return (
    <div className="absolute left-6 top-1/2 -translate-y-1/2 z-20 select-none"
      style={{ height: '60%' }}
      title={`Activity: ${displayValue}${tag ? ` · ${tag}` : ''}`}
    >
      {/* Bar track */}
      <div className="w-4 h-full rounded-full overflow-hidden shadow-lg">
        <div className="relative w-full h-full backdrop-blur-sm" style={{ background: 'var(--track-bg)' }}>
          {/* Growing fill from center */}
          <div
            className="absolute inset-x-0"
            style={{ ...fillStyle, background: fillGradient }}
          />
          {/* Center tick (zero line) */}
          <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        </div>
      </div>

      {/* Label — to the right of the bar at fill edge */}
      <div
        className="absolute left-full pointer-events-none"
        style={{ bottom: `${displayPct}%`, transform: 'translateY(50%)' }}
      >
        <span className={`ml-1.5 text-[10px] font-mono font-semibold whitespace-nowrap drop-shadow-md`}
          style={{ color: calibrating ? 'var(--text-dim)' : isPositive ? 'rgba(245,158,11,0.8)' : 'rgba(147,197,253,0.8)' }}
        >
          {displayValue}
        </span>
        {tag && (
          <span className="ml-1 text-[9px] font-bold drop-shadow-md"
            style={{ color: isPositive ? 'rgba(245,158,11,0.6)' : 'rgba(147,197,253,0.6)' }}
          >
            {tag}
          </span>
        )}
      </div>
    </div>
  );
}
