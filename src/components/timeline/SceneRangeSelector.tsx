'use client';
// SceneRangeSelector — draggable selector for picking a contiguous scene range on the timeline.

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/state/store';
import { resolveEntry, isScene } from '@/types/narrative';
import type { Scene } from '@/types/narrative';
import { resolvePlanForBranch, resolveProseForBranch } from '@/lib/forces/narrative-utils';

export type SceneRange = { start: number; end: number } | null;

/**
 * Given a scene range (indices into scene-only entries) and the full resolvedKeys,
 * return the subset of resolvedKeys that fall within the range (scenes only).
 */
export function filterKeysBySceneRange(
  resolvedKeys: string[],
  narrative: { scenes: Record<string, unknown> } | null,
  range: SceneRange,
): string[] {
  if (!narrative || !range) return resolvedKeys;
  const sceneKeys: string[] = [];
  for (const key of resolvedKeys) {
    if (narrative.scenes[key]) sceneKeys.push(key);
  }
  return sceneKeys.slice(range.start, range.end + 1);
}

/**
 * Compact trigger + portal popout dialog for selecting a scene range.
 * Shows scene availability per stream (structure / plan / prose).
 * Dual-handle range slider + number inputs.
 *
 * Polymorphic trigger:
 *   - default: a pill showing "All N" / "M of N" (used by review eval).
 *   - custom: pass `trigger` for a different button (e.g. an auto-loop icon).
 *
 * Optional confirm step:
 *   - pass `onStart` to render a Start CTA inside the popover; the CTA closes
 *     the popover and forwards the chosen range. Used by bulk auto modes
 *     where the user must explicitly confirm a range before kicking off a run.
 */
export type StreamFocus = 'plan' | 'prose' | 'audio' | 'game' | 'questions' | 'perspectives';

export default function SceneRangeSelector({
  range,
  onChange,
  trigger,
  onStart,
  startLabel,
  placement = 'bottom',
  focus,
}: {
  range: SceneRange;
  onChange: (range: SceneRange) => void;
  trigger?: { icon: ReactNode; className?: string; title?: string };
  /** Start a bulk run over the chosen range. `targetAll` = regenerate even
   *  scenes that already have the focus's artifact; when false (default) the
   *  run fills gaps only — scenes missing that artifact. */
  onStart?: (range: SceneRange, targetAll: boolean) => void;
  startLabel?: string;
  placement?: 'top' | 'bottom';
  /** Which generation surface the picker is being used FOR — drives the
   *  slider track dot colour + which stream's availability the dots
   *  reflect. Undefined falls back to the plan + prose two-row default
   *  (used by eval modals that work across both streams). */
  focus?: StreamFocus;
}) {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;
  const branchId = state.viewState.activeBranchId;
  const branches = useMemo(() => narrative?.branches ?? {}, [narrative?.branches]);

  const [open, setOpen] = useState(false);
  // Gap-fill by default; the operator can opt into regenerating existing.
  const [targetAll, setTargetAll] = useState(false);
  const popoutRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoutPos, setPopoutPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);

  // Resolve all scenes from timeline
  const sceneEntries = useMemo(() => {
    if (!narrative) return [];
    const entries: { index: number; scene: Scene }[] = [];
    for (let i = 0; i < resolvedKeys.length; i++) {
      const entry = resolveEntry(narrative, resolvedKeys[i]);
      if (entry && isScene(entry)) {
        entries.push({ index: i, scene: entry as Scene });
      }
    }
    return entries;
  }, [narrative, resolvedKeys]);

  const totalScenes = sceneEntries.length;

  // Per-stream availability (using resolved versions for current branch).
  // Tracks each downstream artifact the user might be inspecting: plans /
  // prose are version-resolved per branch; audio + game-analysis live
  // directly on the scene (no per-branch resolution).
  const streamAvail = useMemo(() => {
    const hasPlan: boolean[] = [];
    const hasProse: boolean[] = [];
    const hasAudio: boolean[] = [];
    const hasGame: boolean[] = [];
    const hasQuestions: boolean[] = [];
    const hasPerspectives: boolean[] = [];
    for (const { scene } of sceneEntries) {
      if (branchId) {
        const plan = resolvePlanForBranch(scene, branchId, branches);
        const { prose } = resolveProseForBranch(scene, branchId, branches);
        hasPlan.push(!!(plan?.beats?.length));
        hasProse.push(!!prose);
      } else {
        hasPlan.push(false);
        hasProse.push(false);
      }
      hasAudio.push(!!scene.audioUrl);
      hasGame.push(!!(scene.gameAnalysis?.games?.length));
      hasQuestions.push(!!(scene.questions?.length));
      // Perspectives are arc-scoped — a scene "has" them if its arc does.
      const arc = narrative?.arcs[scene.arcId];
      hasPerspectives.push(!!(arc?.perspectives && Object.keys(arc.perspectives).length));
    }
    return { hasPlan, hasProse, hasAudio, hasGame, hasQuestions, hasPerspectives };
  }, [sceneEntries, branchId, branches, narrative]);

  const effectiveStart = range?.start ?? 0;
  const effectiveEnd = range?.end ?? Math.max(0, totalScenes - 1);

  const rangeStats = useMemo(() => {
    const count = effectiveEnd - effectiveStart + 1;
    let plans = 0;
    let prose = 0;
    let audio = 0;
    let games = 0;
    let questions = 0;
    let perspectives = 0;
    for (let i = effectiveStart; i <= effectiveEnd && i < totalScenes; i++) {
      if (streamAvail.hasPlan[i]) plans++;
      if (streamAvail.hasProse[i]) prose++;
      if (streamAvail.hasAudio[i]) audio++;
      if (streamAvail.hasGame[i]) games++;
      if (streamAvail.hasQuestions[i]) questions++;
      if (streamAvail.hasPerspectives[i]) perspectives++;
    }
    return { count, plans, prose, audio, games, questions, perspectives };
  }, [effectiveStart, effectiveEnd, totalScenes, streamAvail]);

  // Position the popout relative to the trigger via portal. Anchoring from
  // the bottom of the viewport (when placement === 'top') avoids needing to
  // measure the popout's height — the bottom edge is pinned 4px above the
  // trigger and the popout grows upward.
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoutWidth = 288; // w-72 = 18rem = 288px
    let left = rect.right - popoutWidth;
    if (left < 8) left = 8;
    if (placement === 'top') {
      setPopoutPos({ bottom: window.innerHeight - rect.top + 4, left });
    } else {
      setPopoutPos({ top: rect.bottom + 4, left });
    }
  }, [open, placement]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoutRef.current && !popoutRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (totalScenes === 0) return null;

  const isFullRange = !range || (effectiveStart === 0 && effectiveEnd === totalScenes - 1);

  const defaultTriggerClass = `text-[10px] px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
    isFullRange
      ? 'bg-white/5 text-text-dim hover:text-text-secondary'
      : 'bg-cyan-500/15 text-cyan-400'
  }`;

  return (
    <>
      {/* Trigger — pill by default, custom icon when `trigger` is provided */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={trigger?.className ?? defaultTriggerClass}
        title={trigger?.title}
      >
        {trigger ? trigger.icon : (
          isFullRange ? <>All {totalScenes}</> : <>{rangeStats.count} of {totalScenes}</>
        )}
      </button>

      {/* Portal popout */}
      {open && popoutPos && createPortal(
        <div
          ref={popoutRef}
          className="fixed z-popover w-72 bg-neutral-900/95 backdrop-blur-md border border-white/10 rounded-lg shadow-xl p-3 space-y-3"
          style={{ top: popoutPos.top, bottom: popoutPos.bottom, left: popoutPos.left }}
        >
          {/* Title + reset */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-text-primary">Scene Range</span>
            {!isFullRange && (
              <button
                onClick={() => onChange(null)}
                className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-text-dim hover:text-text-secondary transition-colors"
              >
                Reset to all
              </button>
            )}
          </div>

          {/* Dual-handle range slider */}
          <RangeSlider
            min={0}
            max={totalScenes - 1}
            start={effectiveStart}
            end={effectiveEnd}
            streamAvail={streamAvail}
            focus={focus}
            onChange={(s, e) => {
              if (s === 0 && e === totalScenes - 1) {
                onChange(null);
              } else {
                onChange({ start: s, end: e });
              }
            }}
          />

          {/* Number inputs */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-[9px] text-text-dim uppercase tracking-wider">From</label>
              <input
                type="number"
                min={1}
                max={effectiveEnd + 1}
                value={effectiveStart + 1}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(effectiveEnd, parseInt(e.target.value) - 1 || 0));
                  if (v === 0 && effectiveEnd === totalScenes - 1) onChange(null);
                  else onChange({ start: v, end: effectiveEnd });
                }}
                className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-text-secondary font-mono focus:outline-none focus:border-cyan-500/30"
              />
            </div>
            <div className="text-text-dim text-[10px] mt-3">--</div>
            <div className="flex-1">
              <label className="text-[9px] text-text-dim uppercase tracking-wider">To</label>
              <input
                type="number"
                min={effectiveStart + 1}
                max={totalScenes}
                value={effectiveEnd + 1}
                onChange={(e) => {
                  const v = Math.max(effectiveStart, Math.min(totalScenes - 1, parseInt(e.target.value) - 1 || 0));
                  if (effectiveStart === 0 && v === totalScenes - 1) onChange(null);
                  else onChange({ start: effectiveStart, end: v });
                }}
                className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-text-secondary font-mono focus:outline-none focus:border-cyan-500/30"
              />
            </div>
          </div>

          {/* Scene IDs at boundaries */}
          <div className="flex items-center justify-between text-[9px] font-mono text-text-dim">
            <span>{sceneEntries[effectiveStart]?.scene.id}</span>
            <span>{sceneEntries[effectiveEnd]?.scene.id}</span>
          </div>

          {/* Stream availability summary — one entry per generation surface
              so the user can see at a glance which artifacts exist for the
              chosen range. Existing counts read in the surface's accent
              colour; zero counts fade to text-dim. */}
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[9px] pt-1 border-t border-white/5">
            <span className="text-text-dim">
              {rangeStats.count} scene{rangeStats.count !== 1 ? 's' : ''}
            </span>
            <span className={rangeStats.plans > 0 ? 'text-amber-400/70' : 'text-text-dim/40'}>
              {rangeStats.plans} plan{rangeStats.plans !== 1 ? 's' : ''}
            </span>
            <span className={rangeStats.prose > 0 ? 'text-violet-400/70' : 'text-text-dim/40'}>
              {rangeStats.prose} prose
            </span>
            <span className={rangeStats.audio > 0 ? 'text-sky-400/70' : 'text-text-dim/40'}>
              {rangeStats.audio} audio
            </span>
            <span className={rangeStats.games > 0 ? 'text-rose-400/70' : 'text-text-dim/40'}>
              {rangeStats.games} game{rangeStats.games !== 1 ? 's' : ''}
            </span>
            <span className={rangeStats.questions > 0 ? 'text-emerald-400/70' : 'text-text-dim/40'}>
              {rangeStats.questions} question{rangeStats.questions !== 1 ? 's' : ''}
            </span>
            <span className={rangeStats.perspectives > 0 ? 'text-world/70' : 'text-text-dim/40'}>
              {rangeStats.perspectives} perspective{rangeStats.perspectives !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Optional Start CTA — bulk auto modes require an explicit confirm.
              The count reflects the preset: gap-fill targets only scenes
              MISSING the focus's artifact; "target all" regenerates every
              scene in range. */}
          {onStart && (() => {
            const present =
              focus === 'plan' ? rangeStats.plans :
              focus === 'prose' ? rangeStats.prose :
              focus === 'audio' ? rangeStats.audio :
              focus === 'game' ? rangeStats.games :
              focus === 'questions' ? rangeStats.questions :
              focus === 'perspectives' ? rangeStats.perspectives : 0;
            const missing = Math.max(0, rangeStats.count - present);
            const targetCount = focus ? (targetAll ? rangeStats.count : missing) : rangeStats.count;
            const nothingToFill = !!focus && !targetAll && targetCount === 0;
            return (
              <div className="space-y-2 pt-1 border-t border-white/5">
                {focus && (
                  <label className="flex items-center gap-2 text-[10px] text-text-dim cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={targetAll}
                      onChange={(e) => setTargetAll(e.target.checked)}
                      className="accent-amber-500 w-3 h-3"
                    />
                    <span>
                      Target all <span className="text-text-dim/50">— regenerate existing (off: fill gaps only)</span>
                    </span>
                  </label>
                )}
                <button
                  type="button"
                  disabled={nothingToFill}
                  onClick={() => { onStart(range, targetAll); setOpen(false); }}
                  className={`w-full text-[11px] font-semibold px-2 py-1.5 rounded border transition-colors uppercase tracking-wider ${
                    nothingToFill
                      ? 'bg-white/5 text-text-dim/40 border-white/10 cursor-not-allowed'
                      : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {nothingToFill
                    ? 'Nothing missing in range'
                    : startLabel
                      ? `${startLabel} · ${targetCount}`
                      : `Generate ${targetCount} scene${targetCount !== 1 ? 's' : ''}`}
                </button>
              </div>
            );
          })()}
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Dual-handle range slider ────────────────────────────────────────────────

// Per-stream colour pairs for slider dots: bright when the scene index is
// inside the selected range, faded otherwise. Listed as full Tailwind
// classes so the JIT detects them.
const STREAM_DOT_COLORS: Record<StreamFocus, { inRange: string; outRange: string }> = {
  plan: { inRange: 'bg-amber-400/70', outRange: 'bg-amber-400/20' },
  prose: { inRange: 'bg-violet-400/70', outRange: 'bg-violet-400/20' },
  audio: { inRange: 'bg-sky-400/70', outRange: 'bg-sky-400/20' },
  game: { inRange: 'bg-rose-400/70', outRange: 'bg-rose-400/20' },
  questions: { inRange: 'bg-emerald-400/70', outRange: 'bg-emerald-400/20' },
  perspectives: { inRange: 'bg-world/70', outRange: 'bg-world/20' },
};

function RangeSlider({
  min,
  max,
  start,
  end,
  streamAvail,
  focus,
  onChange,
}: {
  min: number;
  max: number;
  start: number;
  end: number;
  streamAvail: {
    hasPlan: boolean[];
    hasProse: boolean[];
    hasAudio: boolean[];
    hasGame: boolean[];
    hasQuestions: boolean[];
    hasPerspectives: boolean[];
  };
  focus?: StreamFocus;
  onChange: (start: number, end: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'start' | 'end' | null>(null);
  const total = max - min;

  const posToVal = useCallback((clientX: number) => {
    if (!trackRef.current || total === 0) return min;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(min + ratio * total);
  }, [min, total]);

  const handlePointerDown = useCallback((handle: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = handle;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const val = posToVal(e.clientX);
    if (draggingRef.current === 'start') {
      onChange(Math.min(val, end), end);
    } else {
      onChange(start, Math.max(val, start));
    }
  }, [posToVal, start, end, onChange]);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const startPct = total > 0 ? ((start - min) / total) * 100 : 0;
  const endPct = total > 0 ? ((end - min) / total) * 100 : 100;

  return (
    <div
      className="relative h-8 select-none touch-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Track background with stream availability dots. When `focus` is
          set the track shows a SINGLE dot row reflecting that stream's
          availability in its accent colour — matches what the picker is
          actually being used to set up. Unfocused (eval modal) falls back
          to the two-row plan+prose default. */}
      <div ref={trackRef} className="absolute inset-x-3 top-3 h-2 rounded-full bg-white/5">
        {/* Stream availability indicators */}
        {total > 0 && Array.from({ length: Math.min(total + 1, 80) }, (_, i) => {
          const sceneIdx = Math.round(min + (i / Math.min(total, 79)) * total);
          const x = ((sceneIdx - min) / total) * 100;
          const inRange = sceneIdx >= start && sceneIdx <= end;
          if (focus) {
            const streamArr =
              focus === 'plan' ? streamAvail.hasPlan :
              focus === 'prose' ? streamAvail.hasProse :
              focus === 'audio' ? streamAvail.hasAudio :
              focus === 'questions' ? streamAvail.hasQuestions :
              focus === 'perspectives' ? streamAvail.hasPerspectives :
              streamAvail.hasGame;
            const present = streamArr[sceneIdx];
            const colors = STREAM_DOT_COLORS[focus];
            return (
              <div
                key={i}
                className="absolute inset-y-0 flex items-center"
                style={{ left: `${x}%`, transform: 'translateX(-50%)' }}
              >
                <div
                  className={`w-1 h-1 rounded-full ${
                    present
                      ? inRange ? colors.inRange : colors.outRange
                      : 'bg-transparent'
                  }`}
                />
              </div>
            );
          }
          const plan = streamAvail.hasPlan[sceneIdx];
          const prose = streamAvail.hasProse[sceneIdx];
          return (
            <div
              key={i}
              className="absolute top-0 h-full flex flex-col justify-center"
              style={{ left: `${x}%`, transform: 'translateX(-50%)' }}
            >
              {/* Top dot: plan */}
              <div
                className={`w-1 h-1 rounded-full mb-px ${
                  plan
                    ? inRange ? 'bg-amber-400/60' : 'bg-amber-400/20'
                    : 'bg-transparent'
                }`}
              />
              {/* Bottom dot: prose */}
              <div
                className={`w-1 h-1 rounded-full ${
                  prose
                    ? inRange ? 'bg-violet-400/60' : 'bg-violet-400/20'
                    : 'bg-transparent'
                }`}
              />
            </div>
          );
        })}

        {/* Selected range fill */}
        <div
          className="absolute top-0 h-full rounded-full bg-cyan-500/20"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />
      </div>

      {/* Start handle */}
      <div
        className="absolute top-1.5 w-3 h-4 rounded-sm bg-cyan-400/80 border border-cyan-300/40 cursor-ew-resize hover:bg-cyan-400 transition-colors shadow-md"
        style={{ left: `calc(${startPct}% * (100% - 24px) / 100% + 12px - 6px)` }}
        onPointerDown={handlePointerDown('start')}
      />

      {/* End handle */}
      <div
        className="absolute top-1.5 w-3 h-4 rounded-sm bg-cyan-400/80 border border-cyan-300/40 cursor-ew-resize hover:bg-cyan-400 transition-colors shadow-md"
        style={{ left: `calc(${endPct}% * (100% - 24px) / 100% + 12px - 6px)` }}
        onPointerDown={handlePointerDown('end')}
      />
    </div>
  );
}
