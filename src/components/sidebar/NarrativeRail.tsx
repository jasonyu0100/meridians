'use client';

// NarrativeRail — left vertical rail navigating between narrative views and tools.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useParams } from 'next/navigation';
import { useImageUrl } from '@/hooks/useAssetUrl';
import { useStore } from '@/lib/state/store';
import { useWizard } from '@/lib/state/wizard-context';
import { ArchetypeIcon } from '@/components/ArchetypeIcon';
import { IconPlus } from '@/components/icons';
import { scoreColor, timeAgo } from '@/lib/utils/ui-utils';
import type { NarrativeEntry } from '@/types/narrative';

const TILE_BG = 'rgba(255,255,255,0.06)';

const SCALE_KEYS = ['short', 'story', 'novel', 'epic', 'serial'] as const;
const DENSITY_KEYS = ['sparse', 'focused', 'developed', 'rich', 'sprawling'] as const;

const CARD_WIDTH = 248;
const CARD_GAP = 10;
const VIEWPORT_PADDING = 8;

function initialOf(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}

type AnchorRect = { top: number; right: number; height: number };

function InfoCard({ entry, anchor }: { entry: NarrativeEntry; anchor: AnchorRect }) {
  const coverUrl = useImageUrl(entry.coverImageUrl);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: anchor.top + anchor.height / 2,
    left: anchor.right + CARD_GAP,
  });
  const [mounted, setMounted] = useState(false);
  // Hydration guard: timeAgo() is time-relative, so it must only render client-side
  // to avoid an SSR/client text mismatch. A one-shot mount flip is the standard pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vh = window.innerHeight;
    let top = anchor.top + anchor.height / 2 - h / 2;
    top = Math.max(VIEWPORT_PADDING, Math.min(vh - h - VIEWPORT_PADDING, top));
    setPos({ top, left: anchor.right + CARD_GAP });
  }, [anchor.top, anchor.right, anchor.height, entry.id]);

  const scaleIdx = entry.scaleKey
    ? SCALE_KEYS.indexOf(entry.scaleKey as typeof SCALE_KEYS[number])
    : -1;
  const densityIdx = entry.densityKey
    ? DENSITY_KEYS.indexOf(entry.densityKey as typeof DENSITY_KEYS[number])
    : -1;
  const blurb = entry.coverThread || entry.description;
  const hasIndicators =
    entry.shapeCurve ||
    entry.archetypeKey ||
    scaleIdx >= 0 ||
    densityIdx >= 0 ||
    entry.overallScore !== undefined;

  return (
    <div
      ref={cardRef}
      role="tooltip"
      className="pointer-events-none fixed z-popover rounded-lg bg-bg-overlay/95 border border-white/10 shadow-xl backdrop-blur-md overflow-hidden"
      style={{ top: pos.top, left: pos.left, width: CARD_WIDTH }}
    >
      <div className="flex gap-2.5 p-2.5">
        <div
          className="shrink-0 w-12 h-12 rounded-md overflow-hidden ring-1 ring-white/10"
          style={{ background: coverUrl ? undefined : TILE_BG }}
        >
          {coverUrl ? (
            // Resolved IndexedDB object URL — next/image can't optimize blob/object URLs.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="flex items-center justify-center w-full h-full text-[16px] font-semibold text-text-secondary">
              {initialOf(entry.title)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-text-primary leading-snug line-clamp-2">
            {entry.title}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.12em] text-white/40">
            <span>{entry.sceneCount} scenes</span>
            <span className="text-white/20">·</span>
            <span suppressHydrationWarning>{mounted ? timeAgo(entry.updatedAt) : ''}</span>
          </div>
        </div>
      </div>

      {blurb && (
        <p className="px-2.5 pb-2 text-[11px] leading-relaxed text-white/55 whitespace-pre-wrap">
          {blurb}
        </p>
      )}

      {hasIndicators && (
        <div className="px-2.5 py-2 border-t border-white/8 flex items-center gap-2">
          {entry.shapeCurve && (
            <div title={entry.shapeName ?? 'Shape'}>
              <svg width={22} height={10} viewBox="0 0 22 10" className="opacity-70">
                <polyline
                  points={entry.shapeCurve.map(([x, y]) => `${x * 22},${10 - y * 10}`).join(' ')}
                  fill="none"
                  stroke="#fb923c"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}
          {entry.archetypeKey && (
            <div title={entry.archetypeName ?? entry.archetypeKey}>
              <ArchetypeIcon archetypeKey={entry.archetypeKey} size={11} />
            </div>
          )}
          {scaleIdx >= 0 && (
            <div title={entry.scaleName ?? entry.scaleKey}>
              <svg width="11" height="11" viewBox="0 0 18 18" className="shrink-0 opacity-70">
                {[0, 1, 2, 3, 4].map((j) => (
                  <rect
                    key={j}
                    x={2 + j * 3}
                    y={14 - (j + 1) * 2.4}
                    width={2}
                    height={(j + 1) * 2.4}
                    rx={0.5}
                    fill={j <= scaleIdx ? '#22D3EE' : '#ffffff10'}
                  />
                ))}
              </svg>
            </div>
          )}
          {densityIdx >= 0 && (
            <div title={entry.densityName ?? entry.densityKey}>
              <svg width="11" height="11" viewBox="0 0 18 18" className="shrink-0 opacity-70">
                {[0, 1, 2, 3, 4].map((j) => (
                  <circle
                    key={j}
                    cx={9}
                    cy={9}
                    r={2 + j * 1.8}
                    fill="none"
                    stroke={j <= densityIdx ? '#34D399' : '#ffffff10'}
                    strokeWidth={0.8}
                  />
                ))}
              </svg>
            </div>
          )}
          {entry.overallScore !== undefined && (
            <span
              className="ml-auto text-[11px] font-mono font-semibold"
              style={{ color: scoreColor(entry.overallScore) }}
            >
              {entry.overallScore}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function RailTile({ entry, isActive }: { entry: NarrativeEntry; isActive: boolean }) {
  const router = useRouter();
  const coverUrl = useImageUrl(entry.coverImageUrl);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  const showTip = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.top, right: r.right, height: r.height });
  };
  const hideTip = () => setAnchor(null);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => router.push(`/narrative/${entry.id}`)}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        className={`relative shrink-0 w-9 h-9 rounded-lg overflow-hidden transition-all outline-none ${
          isActive
            ? 'ring-2 ring-violet-300/70 shadow-[0_0_14px_rgba(196,181,253,0.35)]'
            : 'ring-1 ring-white/8 hover:ring-white/25'
        }`}
        style={{ background: coverUrl ? undefined : TILE_BG }}
        aria-label={entry.title}
      >
        {coverUrl ? (
          // Resolved IndexedDB object URL — next/image can't optimize blob/object URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="flex items-center justify-center w-full h-full text-[13px] font-semibold text-text-secondary">
            {initialOf(entry.title)}
          </span>
        )}
      </button>
      {anchor && typeof document !== 'undefined' &&
        createPortal(<InfoCard entry={entry} anchor={anchor} />, document.body)}
    </>
  );
}

function QuickAddTile() {
  const { dispatch: wizardDispatch } = useWizard();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);

  const showTip = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setTip({ top: r.top + r.height / 2, left: r.right + CARD_GAP });
  };
  const hideTip = () => setTip(null);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => wizardDispatch({ type: 'OPEN' })}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        aria-label="New narrative"
        className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-text-dim border border-dashed border-white/15 hover:text-text-primary hover:border-white/30 hover:bg-white/4 transition-all outline-none"
      >
        <IconPlus size={16} />
      </button>
      {tip && typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-popover px-2 py-1 rounded-md bg-bg-overlay/95 border border-white/10 text-[11px] text-text-primary whitespace-nowrap shadow-lg backdrop-blur-sm"
            style={{ top: tip.top, left: tip.left, transform: 'translateY(-50%)' }}
          >
            New narrative
          </div>,
          document.body,
        )}
    </>
  );
}

export default function NarrativeRail() {
  const { state } = useStore();
  const params = useParams();
  const activeId = (params?.id as string | undefined) ?? state.activeNarrativeId ?? null;

  if (state.narratives.length === 0) return null;

  const ordered = [...state.narratives].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="h-full w-14 shrink-0 border-r border-white/8 bg-bg-base/60 backdrop-blur-sm">
      <div className="h-full overflow-y-auto overflow-x-hidden flex flex-col items-center gap-2 py-2">
        <QuickAddTile />
        {ordered.map((entry) => (
          <RailTile key={entry.id} entry={entry} isActive={entry.id === activeId} />
        ))}
      </div>
    </div>
  );
}
