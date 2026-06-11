'use client';
// StoryCard — series picker tile rendering a narrative's cover, title, and quick stats.

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useImageUrl } from '@/hooks/useAssetUrl';
import { ArchetypeIcon } from '@/components/ArchetypeIcon';
import { scoreColor, timeAgo } from '@/lib/utils/ui-utils';
import { useStore, narrativeToEntry } from '@/lib/state/store';
import { computeCanonExperience } from '@/lib/analysis/experience';
import { smoothPath } from '@/components/shared/ExperienceSparkline';
import type { NarrativeEntry } from '@/types/narrative';

export interface StoryCardProps {
  entry: NarrativeEntry;
  index: number;
  /** Size variant: "md" (default) or "lg" */
  size?: 'md' | 'lg';
  /** Show scale indicator (5-bar chart). Default: true */
  showScale?: boolean;
  /** Show density indicator (5-ring chart). Default: true */
  showDensity?: boolean;
  /** Show relative time instead of play button. Default: false */
  showTimeAgo?: boolean;
  /** Open slides view on click. Default: false */
  openSlides?: boolean;
  /** Base animation delay offset in seconds. Default: 0 */
  animationDelayBase?: number;
}

const SCALE_KEYS = ['short', 'story', 'novel', 'epic', 'serial'] as const;
const DENSITY_KEYS = ['sparse', 'focused', 'developed', 'rich', 'sprawling'] as const;

export function StoryCard({
  entry: rawEntry,
  index,
  size = 'md',
  showScale = true,
  showDensity = true,
  showTimeAgo = false,
  openSlides = false,
  animationDelayBase = 0,
}: StoryCardProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // If this card's narrative is currently hydrated in the store, derive
  // its metrics fresh rather than using the persisted entry snapshot.
  // Grades are cheap to compute (milliseconds) and we never want a stale
  // score on the card — the scorecard and slides derive the same way, so
  // all three surfaces agree by construction.
  const { state } = useStore();
  const entry = useMemo(() => {
    const hydrated = state.activeNarrative;
    if (hydrated?.id === rawEntry.id) return narrativeToEntry(hydrated);
    return rawEntry;
  }, [rawEntry, state.activeNarrative]);

  // Canon-branch recall (Prior) badge — computed from scene summary embeddings
  // when this card's narrative is the hydrated one (full branch/scene data on
  // hand); cached per id so it persists across the session.
  const [canonRecall, setCanonRecall] = useState<number | null>(null);
  useEffect(() => {
    const full = state.activeNarrative;
    if (!full || full.id !== rawEntry.id) return;
    let cancelled = false;
    // Shares the cached matrix in computeExperienceReport (single source).
    computeCanonExperience(full)
      .then((r) => { if (!cancelled) setCanonRecall(r ? r.prior : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [state.activeNarrative, rawEntry.id]);

  const coverUrl = useImageUrl(entry.coverImageUrl);
  const isLg = size === 'lg';
  const svgSize = isLg ? 22 : 20;
  const svgHeight = isLg ? 10 : 9;

  return (
    <div
      onClick={() => router.push(`/narrative/${entry.id}${openSlides ? '?slides=1' : ''}`)}
      className={`group relative shrink-0 cursor-pointer animate-fade-up ${isLg ? 'w-56' : 'w-52'}`}
      style={{ animationDelay: `${animationDelayBase + index * 0.08}s` }}
    >
      <div
        className={`relative rounded-xl overflow-hidden border transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_8px_30px_-10px_rgba(80,200,160,0.2)] ${isLg ? 'h-96' : 'h-80'} ${
          coverUrl
            // Over a cover image: keep true white/black so the scrim + overlaid
            // text stay legible regardless of theme.
            ? 'media-overlay border-white/6 bg-transparent group-hover:border-white/15'
            // No image: themed surface so the card is visible on a light page.
            : 'border-border bg-bg-panel group-hover:border-border'
        }`}
      >
        {coverUrl && (
          <div className="absolute inset-0">
            <img
              src={coverUrl}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-black/20" />
          </div>
        )}
        <div className="relative h-full flex flex-col p-4 pt-4">
          <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/30">
            {entry.sceneCount} scenes
          </p>
          <div className="mt-auto">
            <h3
              className={`font-semibold leading-snug mb-1.5 text-white/90 group-hover:text-white transition-colors ${isLg ? 'text-[15px]' : 'text-[14px]'}`}
            >
              {entry.title}
            </h3>
            <p
              className={`text-white/40 leading-relaxed ${isLg ? 'text-[11px] line-clamp-4' : 'text-[11px] line-clamp-3'}`}
            >
              {entry.coverThread || entry.description}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-white/8 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Shape curve sparkline */}
              {entry.shapeCurve && (
                <div title={entry.shapeName ?? 'Shape'}>
                  <svg
                    width={svgSize}
                    height={svgHeight}
                    viewBox={`0 0 ${svgSize} ${svgHeight}`}
                    className="opacity-70"
                  >
                    <path
                      d={smoothPath(
                        entry.shapeCurve.map(([x, y]) => ({
                          x: x * svgSize,
                          y: svgHeight - y * svgHeight,
                        })),
                      )}
                      fill="none"
                      stroke="#fb923c"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}

              {/* Archetype icon */}
              {entry.archetypeKey && (
                <ArchetypeIcon archetypeKey={entry.archetypeKey} size={11} />
              )}

              {/* Scale indicator (5-bar chart) */}
              {showScale && entry.scaleKey && (
                <div title={entry.scaleKey}>
                  <svg width="11" height="11" viewBox="0 0 18 18" className="shrink-0 opacity-70">
                    {[0, 1, 2, 3, 4].map((j) => {
                      const scaleIdx = SCALE_KEYS.indexOf(entry.scaleKey as typeof SCALE_KEYS[number]);
                      return (
                        <rect
                          key={j}
                          x={2 + j * 3}
                          y={14 - (j + 1) * 2.4}
                          width={2}
                          height={(j + 1) * 2.4}
                          rx={0.5}
                          fill={j <= scaleIdx ? '#22D3EE' : '#ffffff10'}
                        />
                      );
                    })}
                  </svg>
                </div>
              )}

              {/* Density indicator (5-ring chart) */}
              {showDensity && entry.densityKey && (
                <div title={entry.densityKey}>
                  <svg width="11" height="11" viewBox="0 0 18 18" className="shrink-0 opacity-70">
                    {[0, 1, 2, 3, 4].map((j) => {
                      const densityIdx = DENSITY_KEYS.indexOf(entry.densityKey as typeof DENSITY_KEYS[number]);
                      return (
                        <circle
                          key={j}
                          cx={9}
                          cy={9}
                          r={2 + j * 1.8}
                          fill="none"
                          stroke={j <= densityIdx ? '#34D399' : '#ffffff10'}
                          strokeWidth={0.8}
                        />
                      );
                    })}
                  </svg>
                </div>
              )}

              {/* Overall score */}
              {entry.overallScore !== undefined && (
                <span
                  className="text-[10px] font-mono font-semibold"
                  style={{ color: scoreColor(entry.overallScore) }}
                >
                  {entry.overallScore}
                </span>
              )}

              {/* Canon-branch recall (Prior) */}
              {canonRecall !== null && (
                <span
                  className="text-[10px] font-mono font-semibold"
                  style={{ color: scoreColor(canonRecall) }}
                  title="Canon-branch recall — how much of the branch the room has seen before (Prior)"
                >
                  ⟲{canonRecall}
                </span>
              )}
            </div>

            {/* Right side: time ago or play button */}
            {showTimeAgo ? (
              <span className="text-[9px] text-white/25 font-mono" suppressHydrationWarning>
                {mounted ? timeAgo(entry.updatedAt) : ''}
              </span>
            ) : (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-white/30 group-hover:text-white/60 transition-colors ml-0.5"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
