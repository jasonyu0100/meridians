'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import {
  computePortfolioSnapshot,
  buildPortfolioRows,
  currentFocusIds,
  replayThreadsAtIndex,
  type PortfolioRow,
} from '@/lib/portfolio-analytics';
import {
  THREAD_CATEGORY_HEX,
  THREAD_CATEGORY_LABEL,
  THREAD_CATEGORY_DESCRIPTION,
  outcomeColourBg,
  type ThreadCategory,
} from '@/lib/thread-category';

// ── Probability bar ────────────────────────────────────────────────────────

function ProbabilityBar({
  outcomes,
  probs,
  topIdx,
  dimmed,
}: {
  outcomes: string[];
  probs: number[];
  topIdx: number;
  dimmed?: boolean;
}) {
  return (
    <div
      className={`relative h-1.5 w-full flex rounded-full overflow-hidden bg-white/5${dimmed ? ' opacity-60' : ''}`}
      title={outcomes.map((o, i) => `${o}: ${(probs[i] * 100).toFixed(0)}%`).join('\n')}
    >
      {probs.map((p, i) => (
        <div
          key={`${outcomes[i]}-${i}`}
          className={`${outcomeColourBg(i)} ${i === topIdx ? '' : 'opacity-50'}`}
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

// ── Row ────────────────────────────────────────────────────────────────────

function PortfolioRowView({
  row,
  inFocus,
  maxVolume,
  onClick,
}: {
  row: PortfolioRow;
  inFocus: boolean;
  maxVolume: number;
  onClick: () => void;
}) {
  const { thread, probs, topIdx, margin, entropy, volume, category } = row;
  const dimmed = category === 'resolved' || category === 'abandoned';
  const closeLabel = thread.closedAt
    ? `resolved → ${thread.outcomes[thread.closeOutcome ?? 0]}`
    : null;
  const quality = thread.resolutionQuality;
  const catColor = THREAD_CATEGORY_HEX[category];

  return (
    <button
      onClick={onClick}
      className={`group text-left px-1 py-1.5 flex flex-col gap-1 hover:bg-white/3 transition-colors rounded-sm${dimmed ? ' opacity-60' : ''}`}
    >
      {/* Header: id + focus marker on one line, description on its own line below */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-text-dim shrink-0">
          {thread.id}
        </span>
        {inFocus && (
          <span
            className="text-[9px] font-medium ml-auto shrink-0"
            style={{ color: catColor }}
            title="In focus window"
          >
            focus
          </span>
        )}
      </div>
      <p className="text-xs text-text-primary leading-snug wrap-break-word">
        {thread.description}
      </p>

      {/* Category + leading outcome + margin */}
      <div className="flex items-center gap-2 text-[10px] min-w-0">
        <span
          className="shrink-0 font-medium"
          style={{ color: catColor }}
          title={THREAD_CATEGORY_DESCRIPTION[category]}
        >
          {THREAD_CATEGORY_LABEL[category]}
        </span>
        <span className="text-text-dim/40 shrink-0">·</span>
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

      {/* Probability stack */}
      <ProbabilityBar outcomes={thread.outcomes} probs={probs} topIdx={topIdx} dimmed={dimmed} />

      {/* Volume bar + entropy / quality indicator */}
      <div className="flex items-center gap-2">
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

// ── Top stats — plain numbers, no tile background, dividers between groups ─

function PortfolioStats({
  snapshot,
  focusCount,
}: {
  snapshot: ReturnType<typeof computePortfolioSnapshot>;
  focusCount: number;
}) {
  const openCount = snapshot.activeThreads;
  const uncertaintyPct = Math.round(snapshot.averageEntropy * 100);

  return (
    <div className="flex flex-col gap-2 px-1 py-2">
      {/* Primary stats — open / focus / uncertainty. Open is the clearest
          denominator; closed/abandoned rendered in the distribution below. */}
      <div className="flex items-baseline gap-2 text-[10px] text-text-dim">
        <div className="flex items-baseline gap-1">
          <span className="text-sm text-text-primary font-mono tabular-nums">
            {openCount}
          </span>
          <span>open</span>
        </div>
        <span className="text-text-dim/30">|</span>
        <div className="flex items-baseline gap-1">
          <span className="text-sm text-text-primary font-mono tabular-nums">
            {focusCount}
          </span>
          <span>in focus</span>
        </div>
        <span className="text-text-dim/30">|</span>
        <div
          className="flex items-baseline gap-1"
          title="Average uncertainty across open markets. 100% = maximum entropy, 0% = fully resolved."
        >
          <span className="text-sm text-text-primary font-mono tabular-nums">
            {uncertaintyPct}%
          </span>
          <span>uncertain</span>
        </div>
      </div>

      {/* Secondary row — totals + closed/abandoned counts */}
      {(snapshot.closedThreads > 0 || snapshot.abandonedThreads > 0) && (
        <div className="flex items-center gap-2 text-[10px] text-text-dim">
          <span>{snapshot.totalThreads} total</span>
          {snapshot.closedThreads > 0 && (
            <>
              <span className="text-text-dim/30">|</span>
              <span>
                <span className="text-emerald-300/80 font-mono tabular-nums">
                  {snapshot.closedThreads}
                </span>{' '}
                resolved
              </span>
            </>
          )}
          {snapshot.abandonedThreads > 0 && (
            <>
              <span className="text-text-dim/30">|</span>
              <span>
                <span className="font-mono tabular-nums">{snapshot.abandonedThreads}</span>{' '}
                abandoned
              </span>
            </>
          )}
        </div>
      )}

      {/* Attention bar — portfolio weight across open threads */}
      {openCount > 0 && (
        <div
          className="flex items-center gap-2 text-[10px] text-text-dim"
          title="Total volume across open threads — narrative attention carried by the portfolio."
        >
          <span>Attention</span>
          <div className="flex-1 h-0.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full bg-white/25"
              style={{
                width: `${Math.min(100, (snapshot.marketCap / (openCount * 5)) * 100)}%`,
              }}
            />
          </div>
          <span className="font-mono tabular-nums">{snapshot.marketCap.toFixed(0)}</span>
        </div>
      )}

      {/* Resolution quality — only when something has closed */}
      {snapshot.averageResolutionQuality !== null && (
        <div className="flex items-center gap-2 text-[10px] text-text-dim pt-1 border-t border-white/5">
          <span>Resolution quality</span>
          <span className="font-mono tabular-nums text-text-secondary">
            {Math.round(snapshot.averageResolutionQuality * 100)}%
          </span>
          <span className="text-text-dim/30">·</span>
          <span>
            <span className="text-emerald-300/80 tabular-nums">
              {snapshot.resolutionQualityBands.earned}
            </span>{' '}
            earned
          </span>
          <span>
            <span className="text-amber-300/80 tabular-nums">
              {snapshot.resolutionQualityBands.adequate}
            </span>{' '}
            adequate
          </span>
          <span>
            <span className="tabular-nums">{snapshot.resolutionQualityBands.thin}</span>{' '}
            thin
          </span>
        </div>
      )}
    </div>
  );
}

// ── Collapsible section ────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-1 py-1 hover:bg-white/3 rounded transition-colors"
      >
        <span
          className="text-[10px] text-text-dim transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ▶
        </span>
        <span className="text-[10px] font-semibold text-text-dim uppercase tracking-widest">
          {title}
        </span>
        <span className="text-[10px] text-text-dim ml-auto tabular-nums">{count}</span>
      </button>
      {open && <div className="flex flex-col">{children}</div>}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

// Category → section bucket. Groups the seven categories into readable
// sections in the sidebar.
function bucketOf(cat: ThreadCategory): 'focus' | 'live' | 'dormant' | 'resolved' | 'abandoned' {
  if (cat === 'resolved') return 'resolved';
  if (cat === 'abandoned') return 'abandoned';
  if (cat === 'dormant') return 'dormant';
  return 'live'; // saturating | contested | volatile | committed
}

export default function ThreadPortfolio() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;
  const currentIndex = state.viewState.currentSceneIndex;

  // Build a point-in-time narrative view where every thread's market state is
  // replayed scene-by-scene up to the user's current scene index. As the user
  // scrubs the timeline, probabilities, volume, and volatility visibly change
  // — the portfolio animates alongside the reader's position in the story.
  // Includes all threads in the narrative (not-yet-introduced ones appear at
  // uniform prior) — matches the graph / market views.
  const scrubbedNarrative = useMemo(() => {
    if (!narrative) return null;
    const threadsAtIndex = replayThreadsAtIndex(narrative, resolvedKeys, currentIndex);
    return { ...narrative, threads: threadsAtIndex };
  }, [narrative, resolvedKeys, currentIndex]);

  const rows = useMemo(() => {
    if (!scrubbedNarrative) return [];
    return buildPortfolioRows(scrubbedNarrative, resolvedKeys, currentIndex);
  }, [scrubbedNarrative, resolvedKeys, currentIndex]);

  const snapshot = useMemo(() => {
    if (!scrubbedNarrative) return null;
    return computePortfolioSnapshot(scrubbedNarrative);
  }, [scrubbedNarrative]);

  const focusIds = useMemo(() => {
    if (!scrubbedNarrative) return new Set<string>();
    return currentFocusIds(scrubbedNarrative, resolvedKeys, currentIndex);
  }, [scrubbedNarrative, resolvedKeys, currentIndex]);

  if (!narrative) {
    return (
      <div className="flex-1 flex items-center justify-center px-3">
        <p className="text-xs text-text-dim text-center">Select a narrative to view threads</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-3">
        <p className="text-xs text-text-dim text-center">No threads yet</p>
      </div>
    );
  }

  // Partition by bucket. Focus window threads float to the top regardless of
  // their category (they already carry the category colour via the inset edge).
  const focus: PortfolioRow[] = [];
  const live: PortfolioRow[] = [];
  const dormant: PortfolioRow[] = [];
  const abandoned: PortfolioRow[] = [];
  const closed: PortfolioRow[] = [];
  for (const r of rows) {
    const bucket = bucketOf(r.category);
    if (bucket === 'resolved') closed.push(r);
    else if (bucket === 'abandoned') abandoned.push(r);
    else if (focusIds.has(r.thread.id)) focus.push(r);
    else if (bucket === 'dormant') dormant.push(r);
    else live.push(r);
  }

  const maxVolume = Math.max(1, ...rows.map((r) => r.volume));

  const render = (list: PortfolioRow[]) =>
    list.map((row) => (
      <PortfolioRowView
        key={row.thread.id}
        row={row}
        inFocus={focusIds.has(row.thread.id)}
        maxVolume={maxVolume}
        onClick={() => {
          dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'threads' });
          dispatch({ type: 'SELECT_THREAD_LOG', threadId: row.thread.id });
          dispatch({
            type: 'SET_INSPECTOR',
            context: { type: 'thread', threadId: row.thread.id },
          });
        }}
      />
    ));

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-2">
      {snapshot && <PortfolioStats snapshot={snapshot} focusCount={focusIds.size} />}

      {focus.length > 0 && (
        <CollapsibleSection title="Focus" count={focus.length} defaultOpen>
          {render(focus)}
        </CollapsibleSection>
      )}

      {live.length > 0 && (
        <CollapsibleSection title="Out of focus" count={live.length} defaultOpen>
          {render(live)}
        </CollapsibleSection>
      )}

      {dormant.length > 0 && (
        <CollapsibleSection title="Dormant" count={dormant.length} defaultOpen={false}>
          {render(dormant)}
        </CollapsibleSection>
      )}

      {closed.length > 0 && (
        <CollapsibleSection title="Resolved" count={closed.length} defaultOpen={false}>
          {render(closed)}
        </CollapsibleSection>
      )}

      {abandoned.length > 0 && (
        <CollapsibleSection title="Abandoned" count={abandoned.length} defaultOpen={false}>
          {render(abandoned)}
        </CollapsibleSection>
      )}
    </div>
  );
}
