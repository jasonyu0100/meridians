'use client';

/**
 * ThreadsPanel — sidebar pane mirroring SurveyPanel / MapPanel
 * shape: top bar with a count, then a stream of thread cards.
 *
 * Top-level grouping matches BeliefView's "In focus" / "Out of focus"
 * split: focused threads — the ones the engine identifies as carrying
 * the most narrative attention — surface above the rest. Each group is
 * collapsible so you can hide the half you don't care about. Within a
 * group, rows are sorted by lifecycle (open → dormant → resolved →
 * abandoned) so closed entries don't crowd live ones; the per-card
 * lifecycle chip still tells you each thread's individual state.
 */

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/state/store';
import {
  buildPortfolioRows,
  currentFocusIds,
  replayThreadsAtIndex,
  type PortfolioRow,
} from '@/lib/analysis/portfolio-analytics';
import {
  THREAD_CATEGORY_HEX,
  THREAD_CATEGORY_LABEL,
  THREAD_CATEGORY_DESCRIPTION,
  outcomeColourBg,
  type ThreadCategory,
} from '@/lib/forces/thread-category';

// ── Probability bar ────────────────────────────────────────────────────────

function ProbabilityBar({
  outcomes,
  probs,
  topIdx,
  dimmed,
  colourIdx,
}: {
  outcomes: string[];
  probs: number[];
  topIdx: number;
  dimmed?: boolean;
  /** Per-segment palette index, keyed to the LIVE outcome ordering so a given
   *  outcome gets the same hue here as in the ThreadDetail bars. Falls back to
   *  the segment's own position when absent. */
  colourIdx?: number[];
}) {
  return (
    <div
      className={`relative h-1.5 w-full flex rounded-full overflow-hidden bg-white/5${dimmed ? ' opacity-60' : ''}`}
      title={outcomes.map((o, i) => `${o}: ${(probs[i] * 100).toFixed(0)}%`).join('\n')}
    >
      {probs.map((p, i) => (
        <div
          key={`${outcomes[i]}-${i}`}
          className={`${outcomeColourBg(colourIdx?.[i] ?? i)} ${i === topIdx ? '' : 'opacity-50'}`}
          style={{ width: `${p * 100}%` }}
        />
      ))}
    </div>
  );
}

// ── Volume bar ─────────────────────────────────────────────────────────────

function VolumeBar({ volume, scale }: { volume: number; scale: number }) {
  const filled = Math.min(1, volume / scale);
  return (
    <div className="h-0.5 w-full rounded-full bg-white/5" title={`volume ${volume.toFixed(1)}`}>
      <div className="h-full rounded-full bg-white/30" style={{ width: `${filled * 100}%` }} />
    </div>
  );
}

// ── Card ───────────────────────────────────────────────────────────────────

/** Single thread expressed as a group-box card — shared `.panel-card`
 *  surface (top-lit gradient + content-keyed left spine) used by Survey,
 *  Map, Knowledge, Compass, and File panels. The spine is keyed
 *  to the thread's lifecycle category colour. */
function ThreadCard({
  row,
  maxVolume,
  onClick,
}: {
  row: PortfolioRow;
  maxVolume: number;
  onClick: () => void;
}) {
  const { thread, probs, topIdx, margin, entropy, volume, category, colourIdx } = row;
  const dimmed = category === 'resolved' || category === 'abandoned';
  const closeLabel = thread.closedAt
    ? `resolved → ${thread.outcomes[thread.closeOutcome ?? 0]}`
    : null;
  const quality = thread.resolutionQuality;
  const catColor = THREAD_CATEGORY_HEX[category];

  return (
    <button
      onClick={onClick}
      className={`panel-card w-full text-left p-3 flex flex-col gap-1.5${dimmed ? ' opacity-65' : ''}`}
      style={{ ['--card-accent']: catColor } as React.CSSProperties}
    >
      {/* Header — a lifecycle chip (category-coloured dot + neutral label, so
          it reads in any theme) with the thread id opposite. Focus state is
          conveyed by the parent group, so the in-row badge is gone. */}
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full bg-white/5 text-[9px] uppercase tracking-wider font-mono text-text-dim/75"
          title={THREAD_CATEGORY_DESCRIPTION[category]}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: catColor }} />
          {THREAD_CATEGORY_LABEL[category]}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-text-dim/45 font-mono ml-auto">
          {thread.id}
        </span>
      </div>

      <p className="text-[12px] text-text-primary leading-snug">{thread.description}</p>

      {/* Leading outcome + margin */}
      <div className="flex items-baseline gap-2 text-[10px]">
        {closeLabel ? (
          <span className="font-mono truncate" style={{ color: catColor }}>
            {closeLabel}
          </span>
        ) : (
          <span className="text-text-dim font-mono truncate min-w-0">
            {thread.outcomes[topIdx]}{' '}
            <span className="text-text-dim/70">{(probs[topIdx] * 100).toFixed(0)}%</span>
          </span>
        )}
        <span className="text-text-dim/60 font-mono ml-auto tabular-nums shrink-0">
          Δ{margin.toFixed(1)}
        </span>
      </div>

      <ProbabilityBar outcomes={thread.outcomes} probs={probs} topIdx={topIdx} dimmed={dimmed} colourIdx={colourIdx} />

      {/* Volume + entropy / quality */}
      <div className="flex items-center gap-2 mt-0.5">
        <div className="flex-1">
          <VolumeBar volume={volume} scale={maxVolume || 1} />
        </div>
        <span className="text-[9px] text-text-dim font-mono tabular-nums shrink-0">
          {quality !== undefined
            ? `q ${quality.toFixed(2)}`
            : `H ${entropy.toFixed(2)}`}
        </span>
      </div>
    </button>
  );
}

// ── Collapsible group ─────────────────────────────────────────────────────

/** Header + collapsible body. The header is a hairline rule + label + count
 *  + chevron, modelled on BeliefView's `renderSection` plus the toggle
 *  affordance the previous CollapsibleSection used. */
function CollapsibleGroup({
  title,
  count,
  accentColor,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  accentColor?: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-1 py-1.5 hover:opacity-80 transition-opacity"
      >
        <span
          className="text-[9px] transition-transform text-text-dim/70"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ▶
        </span>
        <span
          className="text-[10px] uppercase tracking-widest font-semibold"
          style={{ color: accentColor ?? 'var(--color-text-dim)' }}
        >
          {title}
        </span>
        <span className="flex-1 h-px bg-white/5" />
        <span className="text-[10px] text-text-dim/70 font-mono tabular-nums">{count}</span>
      </button>
      {open && <div className="space-y-2 mt-2">{children}</div>}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

// Lifecycle priority for within-group sorting. Lower = listed first.
const LIFECYCLE_RANK: Record<ThreadCategory, number> = {
  saturating: 0,
  committed: 0,
  volatile: 0,
  contested: 0,
  developing: 0,
  dormant: 1,
  resolved: 2,
  abandoned: 3,
};

export default function ThreadsPanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;
  const currentIndex = state.viewState.currentSceneIndex;

  // Build a point-in-time narrative view where every thread's stance is
  // replayed scene-by-scene up to the user's current scene index. As the user
  // scrubs the timeline, probabilities, volume, and volatility visibly change
  // — the portfolio animates alongside the reader's position in the story.
  // Includes all threads in the narrative (not-yet-introduced ones appear at
  // uniform prior) — matches the graph / belief views.
  const scrubbedNarrative = useMemo(() => {
    if (!narrative) return null;
    const threadsAtIndex = replayThreadsAtIndex(narrative, resolvedKeys, currentIndex);
    return { ...narrative, threads: threadsAtIndex };
  }, [narrative, resolvedKeys, currentIndex]);

  const rows = useMemo(() => {
    if (!scrubbedNarrative || !narrative) return [];
    return buildPortfolioRows(scrubbedNarrative, resolvedKeys, currentIndex, narrative.threads);
  }, [scrubbedNarrative, narrative, resolvedKeys, currentIndex]);

  const focusIds = useMemo(() => {
    if (!scrubbedNarrative) return new Set<string>();
    return currentFocusIds(scrubbedNarrative, resolvedKeys, currentIndex);
  }, [scrubbedNarrative, resolvedKeys, currentIndex]);

  if (!narrative) {
    return (
      <div className="p-4 text-[11px] text-text-dim">
        Open a world view to view its threads.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="shrink-0 h-9 px-3 border-b border-white/8 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-text-dim/70">0 threads</span>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col items-center justify-center p-8 text-center gap-2">
          <svg className="w-8 h-8 text-text-dim/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <p className="text-[11px] text-text-dim/80">No threads in this world view yet.</p>
          <p className="text-[10px] text-text-dim/50 max-w-xs leading-relaxed">
            Threads appear as soon as scenes register thread deltas — the engine
            records them, this panel shows the live portfolio.
          </p>
        </div>
      </div>
    );
  }

  // Partition by focus / not-focus. Within each group, sort by lifecycle so
  // open stances surface before dormant / resolved / abandoned ones — and
  // by remaining margin tightness within the same lifecycle bucket (tighter
  // stances carry more uncertainty and read as more interesting).
  const focusRows: PortfolioRow[] = [];
  const otherRows: PortfolioRow[] = [];
  for (const r of rows) {
    if (focusIds.has(r.thread.id)) focusRows.push(r);
    else otherRows.push(r);
  }
  const compareRows = (a: PortfolioRow, b: PortfolioRow) => {
    const rankDiff = LIFECYCLE_RANK[a.category] - LIFECYCLE_RANK[b.category];
    if (rankDiff !== 0) return rankDiff;
    return a.margin - b.margin;
  };
  focusRows.sort(compareRows);
  otherRows.sort(compareRows);

  const maxVolume = Math.max(1, ...rows.map((r) => r.volume));

  const renderCards = (list: PortfolioRow[]) =>
    list.map((row) => (
      <ThreadCard
        key={row.thread.id}
        row={row}
        maxVolume={maxVolume}
        onClick={() => {
          dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'threads-full' });
          dispatch({ type: 'SELECT_THREAD_LOG', threadId: row.thread.id });
          dispatch({
            type: 'SET_INSPECTOR',
            context: { type: 'thread', threadId: row.thread.id },
          });
        }}
      />
    ));

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 h-9 px-3 border-b border-white/8 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-text-dim/70">
          {rows.length} {rows.length === 1 ? 'thread' : 'threads'}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-text-dim/45 font-mono ml-auto">
          {focusRows.length} in focus
        </span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-4">
        {focusRows.length > 0 && (
          <CollapsibleGroup
            title="In focus"
            count={focusRows.length}
            accentColor="#FBBF24"
            defaultOpen
          >
            {renderCards(focusRows)}
          </CollapsibleGroup>
        )}
        {otherRows.length > 0 && (
          <CollapsibleGroup title="Out of focus" count={otherRows.length} defaultOpen>
            {renderCards(otherRows)}
          </CollapsibleGroup>
        )}
      </div>
    </div>
  );
}
