'use client';

/**
 * KnowledgePanel — ranked directory of system-graph nodes.
 *
 * Visual language mirrors SurveyPanel's card list: each node is a card
 * with a chip-style header (type + score badge), concept body, and a
 * "sparkline" footer that decomposes the score into its three components
 * (degree / attributions / reach).
 *
 * The aim: surface what's genuinely load-bearing in the system. See
 * `scoreSystemNodes` for the formula — degree + attributions + reach.
 * A node that fails any axis sinks naturally.
 *
 * Click a card to open the KnowledgeDetail inspector for that node.
 */

import { useMemo } from 'react';
import { useStore } from '@/lib/state/store';
import { scoreSystemNodes } from '@/lib/forces/narrative-utils';
import type { SystemNodeType } from '@/types/narrative';

/** Per-type accent — used on the type chip + the score bar. */
// `hex` drives the card's left spine (--card-accent); text/bar stay as
// Tailwind utilities for the type chip and impact bar.
const TYPE_ACCENT: Record<SystemNodeType, { text: string; bar: string; hex: string }> = {
  principle:   { text: 'text-amber-300/80',   bar: 'bg-amber-400/70',   hex: '#fbbf24' },
  system:      { text: 'text-sky-300/80',     bar: 'bg-sky-400/70',     hex: '#38bdf8' },
  concept:     { text: 'text-violet-300/80',  bar: 'bg-violet-400/70',  hex: '#a78bfa' },
  tension:     { text: 'text-rose-300/80',    bar: 'bg-rose-400/70',    hex: '#fb7185' },
  event:       { text: 'text-emerald-300/80', bar: 'bg-emerald-400/70', hex: '#34d399' },
  structure:   { text: 'text-cyan-300/80',    bar: 'bg-cyan-400/70',    hex: '#22d3ee' },
  environment: { text: 'text-teal-300/80',    bar: 'bg-teal-400/70',    hex: '#2dd4bf' },
  convention:  { text: 'text-indigo-300/80',  bar: 'bg-indigo-400/70',  hex: '#818cf8' },
  constraint:  { text: 'text-orange-300/80',  bar: 'bg-orange-400/70',  hex: '#fb923c' },
};

export default function KnowledgePanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;
  const cursor = state.viewState.currentSceneIndex;

  // Score as of the currently-viewed scene so the list matches the canvas.
  const ranked = useMemo(() => {
    if (!narrative) return [];
    return scoreSystemNodes(narrative, resolvedKeys, cursor);
  }, [narrative, resolvedKeys, cursor]);

  if (!narrative) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-[11px] text-text-dim/60 italic">
        No active narrative.
      </div>
    );
  }

  if (ranked.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-dim/60 px-6 text-center">
        <svg className="w-7 h-7 mb-1 text-text-dim/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M8 12h8M12 8v8" />
        </svg>
        <p className="text-[11px] text-text-dim/80">No system knowledge yet.</p>
        <p className="text-[10px] text-text-dim/50 max-w-xs leading-relaxed">
          Knowledge accrues as scenes commit system-delta nodes — principles, rules, tensions, structures.
        </p>
      </div>
    );
  }

  const max = ranked[0]?.score || 1;

  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-2">
      {ranked.map(({ node, degree, attributions, reach, score }) => {
        const accent = TYPE_ACCENT[node.type] ?? { text: 'text-text-dim', bar: 'bg-white/40', hex: 'var(--accent)' };
        const intensity = Math.max(0.08, Math.min(1, score / max));
        return (
          <button
            key={node.id}
            type="button"
            onClick={() =>
              dispatch({
                type: 'SET_INSPECTOR',
                context: { type: 'knowledge', nodeId: node.id },
              })
            }
            className="panel-card w-full text-left p-3"
            style={{ ['--card-accent']: accent.hex } as React.CSSProperties}
          >
            {/* Header: type chip + impact badge (mirrors survey card's
                "questionType · category · status" row). */}
            <div className="flex items-baseline gap-2 mb-1">
              <span className={`text-[9px] uppercase tracking-wider font-mono ${accent.text}`}>
                {node.type}
              </span>
              <span className="ml-auto text-[9px] uppercase tracking-wider font-mono text-text-secondary tabular-nums">
                {score}
              </span>
            </div>

            {/* Body: concept text — matches the survey question line. */}
            <p className="text-[12px] text-text-primary leading-snug">{node.concept}</p>

            {/* Footer: impact "sparkline" — bar shows score relative to
                top-ranked, components break it down. Matches survey's
                sparkline + summary footer. */}
            <div className="mt-2 flex items-center gap-2 text-[10px] text-text-dim/80">
              <ImpactBar intensity={intensity} accentBar={accent.bar} />
              <span className="text-text-dim/70 tabular-nums shrink-0 font-mono text-[9px]">
                {degree} links · {attributions} cites · {reach} arc{reach !== 1 ? 's' : ''}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Inline impact bar — visual rank weight using the type's accent. */
function ImpactBar({ intensity, accentBar }: { intensity: number; accentBar: string }) {
  return (
    <div className="flex-1 h-0.75 rounded-full bg-white/5 overflow-hidden">
      <div
        className={`h-full ${accentBar} transition-[width]`}
        style={{ width: `${intensity * 100}%` }}
      />
    </div>
  );
}
