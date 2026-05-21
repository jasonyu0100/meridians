'use client';

import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { useBulkStreamPreview, type BulkMode } from '@/hooks/useBulkStreamPreview';

/**
 * Cross-scene bulk streaming banner. Renders ONLY when the bulk pass is
 * processing a scene *other* than the one currently in view — when the
 * operator is on the same scene, each view's existing scene-bound
 * streaming UI is the canonical surface.
 *
 * Shared across ScenePlanView, SceneProseView, and SceneGameTheoryView
 * so the cross-scene experience is identical regardless of which view
 * the operator is sitting on.
 */

const MODE_LABEL: Record<BulkMode, string> = {
  plan: 'Planning',
  prose: 'Writing',
  game: 'Analysing games in',
};

const MODE_ACCENT: Record<BulkMode, string> = {
  plan: 'text-sky-300/85',
  prose: 'text-emerald-300/85',
  game: 'text-amber-300/85',
};

const TAIL_CHARS = 1200;

export function BulkStreamBanner({
  mode,
  currentSceneId,
}: {
  mode: BulkMode;
  currentSceneId: string;
}) {
  const preview = useBulkStreamPreview(mode);
  const { state } = useStore();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Auto-stick to bottom as tokens arrive.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [preview.text]);

  // Hide when nothing is streaming, or when the bulk is on this scene
  // (the view's own in-scene UI surfaces that case).
  if (!preview.active) return null;
  if (!preview.sceneId || preview.sceneId === currentSceneId) return null;

  const narrative = state.activeNarrative;
  const targetScene = narrative?.scenes[preview.sceneId];
  const targetSummary = targetScene?.summary?.slice(0, 60) ?? preview.sceneId;
  const visible =
    preview.text.length > TAIL_CHARS ? preview.text.slice(-TAIL_CHARS) : preview.text;

  return (
    <div className="max-w-2xl mx-auto px-8 pt-6 pb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-3 h-3 border-2 border-sky-400/30 border-t-sky-400/80 rounded-full animate-spin" />
        <span className={`text-[10px] uppercase tracking-wider font-mono ${MODE_ACCENT[mode]}`}>
          {MODE_LABEL[mode]} &ldquo;{targetSummary}{targetSummary.length === 60 ? '…' : ''}&rdquo;
        </span>
      </div>
      {visible && (
        <div
          ref={containerRef}
          className="max-h-40 overflow-y-auto text-[11px] text-text-dim/60 leading-relaxed whitespace-pre-wrap font-mono"
          style={{ scrollbarWidth: 'thin' }}
        >
          {visible}
        </div>
      )}
    </div>
  );
}
