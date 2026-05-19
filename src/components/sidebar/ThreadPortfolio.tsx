'use client';

/**
 * ThreadPortfolio — sidebar pane mirroring SurveyPanel / InvestigationPanel
 * shape: top bar with a count, then a stream of cards. Threads are grouped
 * by lifecycle bucket (focus / open / dormant / resolved / abandoned);
 * groups stay always-expanded and are separated by dividers, so the whole
 * portfolio reads as a single scrollable list with section breaks.
 */

import { useMemo } from 'react';
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

// ── Card ───────────────────────────────────────────────────────────────────

/** Single thread expressed as a group-box card — same surface treatment
 *  (rounded-lg + border-white/5 + bg-white/3 hover lift) used by Survey,
 *  Investigation, and File panels. */
function ThreadCard({
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
      className={`w-full text-left rounded-lg border border-white/5 bg-white/3 hover:bg-white/6 hover:border-white/10 transition-colors p-3 flex flex-col gap-1.5${dimmed ? ' opacity-65' : ''}`}
    >
      {/* Meta row — id on the left, lifecycle category on the right, mirrors
          the SurveyCard's questionType / status header. */}
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] uppercase tracking-wider text-text-dim/70 font-mono">
          {thread.id}
        </span>
        {inFocus && (
          <span className="text-[9px] uppercase tracking-wider font-mono text-amber-400/80">
            · focus
          </span>
        )}
        <span
          className="text-[9px] uppercase tracking-wider font-mono ml-auto"
          style={{ color: catColor }}
          title={THREAD_CATEGORY_DESCRIPTION[category]}
        >
          {THREAD_CATEGORY_LABEL[category]}
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

      <ProbabilityBar outcomes={thread.outcomes} probs={probs} topIdx={topIdx} dimmed={dimmed} />

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

// ── Stats block ────────────────────────────────────────────────────────────

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
    <div className="rounded-lg border border-white/5 bg-white/3 p-3 flex flex-col gap-2">
      <div className="flex items-baseline gap-3 text-[10px] text-text-dim">
        <div className="flex items-baseline gap-1">
          <span className="text-sm text-text-primary font-mono tabular-nums">{openCount}</span>
          <span>open</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-sm text-text-primary font-mono tabular-nums">{focusCount}</span>
          <span>in focus</span>
        </div>
        <div
          className="flex items-baseline gap-1 ml-auto"
          title="Average uncertainty across open markets. 100% = maximum entropy, 0% = fully resolved."
        >
          <span className="text-sm text-text-primary font-mono tabular-nums">{uncertaintyPct}%</span>
          <span>uncertain</span>
        </div>
      </div>

      {(snapshot.closedThreads > 0 || snapshot.abandonedThreads > 0) && (
        <div className="flex items-baseline gap-3 text-[10px] text-text-dim">
          <span>
            <span className="font-mono tabular-nums text-text-secondary">
              {snapshot.totalThreads}
            </span>{' '}
            total
          </span>
          {snapshot.closedThreads > 0 && (
            <span>
              <span className="font-mono tabular-nums text-emerald-300/80">
                {snapshot.closedThreads}
              </span>{' '}
              resolved
            </span>
          )}
          {snapshot.abandonedThreads > 0 && (
            <span>
              <span className="font-mono tabular-nums">{snapshot.abandonedThreads}</span>{' '}
              abandoned
            </span>
          )}
        </div>
      )}

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

      {snapshot.averageResolutionQuality !== null && (
        <div className="flex items-center gap-2 text-[10px] text-text-dim">
          <span>Resolution</span>
          <span className="font-mono tabular-nums text-text-secondary">
            {Math.round(snapshot.averageResolutionQuality * 100)}%
          </span>
          <span className="ml-auto">
            <span className="text-emerald-300/80 tabular-nums">
              {snapshot.resolutionQualityBands.earned}
            </span>{' '}
            earned ·{' '}
            <span className="text-amber-300/80 tabular-nums">
              {snapshot.resolutionQualityBands.adequate}
            </span>{' '}
            adequate ·{' '}
            <span className="tabular-nums">{snapshot.resolutionQualityBands.thin}</span> thin
          </span>
        </div>
      )}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────

/** Lightweight title row that opens each lifecycle group. Plain text, no
 *  click target — the previous CollapsibleSection toggles are gone. */
function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2 px-1">
      <span className="text-[10px] font-semibold text-text-dim uppercase tracking-widest">
        {title}
      </span>
      <span className="text-[10px] text-text-dim/70 font-mono tabular-nums ml-auto">
        {count}
      </span>
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
      <div className="p-4 text-[11px] text-text-dim">
        Open a narrative to view its threads.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="shrink-0 px-3 py-2 border-b border-white/8 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-text-dim/70">0 threads</span>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col items-center justify-center p-8 text-center gap-2">
          <svg className="w-8 h-8 text-text-dim/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <p className="text-[11px] text-text-dim/80">No threads in this narrative yet.</p>
          <p className="text-[10px] text-text-dim/50 max-w-xs leading-relaxed">
            Threads appear as soon as scenes register thread deltas — the engine
            records them, this panel shows the live portfolio.
          </p>
        </div>
      </div>
    );
  }

  // Partition by bucket. Focus window threads float to the top regardless of
  // their category — they keep their category colour via the lifecycle chip.
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

  const renderCards = (list: PortfolioRow[]) =>
    list.map((row) => (
      <ThreadCard
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

  // Sections rendered in fixed lifecycle order. Each non-empty section
  // contributes a header + its cards; sections are separated by a hairline
  // divider so the boundary is visible without nesting collapsibles.
  const sections: Array<{ title: string; rows: PortfolioRow[] }> = [
    { title: 'Focus', rows: focus },
    { title: 'Open', rows: live },
    { title: 'Dormant', rows: dormant },
    { title: 'Resolved', rows: closed },
    { title: 'Abandoned', rows: abandoned },
  ].filter((s) => s.rows.length > 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-3 py-2 border-b border-white/8 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-text-dim/70">
          {rows.length} {rows.length === 1 ? 'thread' : 'threads'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-3">
        {snapshot && <PortfolioStats snapshot={snapshot} focusCount={focusIds.size} />}

        {sections.map((section, idx) => (
          <div key={section.title} className="space-y-2">
            {idx > 0 && <div className="border-t border-white/8 -mx-3 mb-3" />}
            <SectionHeader title={section.title} count={section.rows.length} />
            <div className="space-y-2">{renderCards(section.rows)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
