'use client';
// MergesView — the Vision "History" tab. A vertical timeline of merges: each
// folded a set of committed streams together to extend continuity. Clicking a
// merge opens it in the inspector (MergeDetail) — the permanent record of what
// was committed, with each stream's executive/recorded status and revert.
// Most recent at the top.

import { useMemo } from 'react';
import { useStore } from '@/lib/state/store';
import { IconChevronRight } from '@/components/icons';
import { PrMergedIcon, PerspectivePairBadge } from './RoomUI';
import { StreamBeliefSpark } from './StreamsView';
import { buildMergeConsumerMap, mergesForBranch, resolutionOutcomes } from '@/lib/merges';

export function MergesView() {
  const { state, dispatch } = useStore();
  const n = state.activeNarrative;

  // Branch-scoped: only merges visible on the active branch's lineage (owned by
  // it or an ancestor; legacy unstamped merges stay visible everywhere).
  const merges = useMemo(
    () => (n ? mergesForBranch(n, state.viewState.activeBranchId) : []).sort((a, b) => b.at - a.at),
    [n, state.viewState.activeBranchId],
  );
  // Branch-aware consumption: which merges have been folded into continuity on
  // the CURRENTLY-RESOLVED branch, and where. A merge folded on one branch
  // reads as "not yet folded" on a sibling branch that forked before it.
  const mergeConsumers = useMemo(
    () => (n ? buildMergeConsumerMap(n, state.resolvedEntryKeys) : new Map()),
    [n, state.resolvedEntryKeys],
  );

  if (!n) return <div className="p-6 text-[12px] text-text-dim/50">No narrative loaded.</div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4">
        <header className="flex items-center gap-2 pb-3">
          <PrMergedIcon size={15} />
          <h1 className="text-[13px] font-semibold text-text-primary">History</h1>
          <span className="text-[11px] text-text-dim/50">
            {merges.length} {merges.length === 1 ? 'commit' : 'commits'} folded into continuity
          </span>
        </header>

        {merges.length === 0 ? (
          <div className="rounded-lg border border-white/10 px-4 py-10 text-center text-[12px] text-text-dim/40 italic">
            No merges yet. Commit streams, then merge them in the Streams tab to collapse a merge.
          </div>
        ) : (
          <ol className="relative ml-2">
            <div className="absolute left-[5px] top-1 bottom-1 w-px bg-white/10" aria-hidden />
                {merges.map((f) => {
                  const streamIds = f.streamIds ?? [];
                  const merged = streamIds
                    .map((id) => n.streams?.[id])
                    .filter((s): s is NonNullable<typeof s> => Boolean(s));
                  const consumer = mergeConsumers.get(f.id);
                  return (
                    <li key={f.id} className="relative pl-6 pb-5 last:pb-0">
                      <span className="absolute left-0 top-1 w-[11px] h-[11px] rounded-full bg-purple-500/30 border border-purple-400/70" aria-hidden />
                      <button
                        onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'merge', mergeId: f.id } })}
                        className="group w-full text-left rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5 hover:bg-white/[0.04] hover:border-white/20 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <PrMergedIcon size={14} />
                          <span className="text-[13px] font-medium text-text-primary">{f.label || 'Commit'}</span>
                          <span className="ml-auto text-[11px] text-text-dim/50 tabular-nums">
                            {new Date(f.at).toLocaleString()}
                          </span>
                          <IconChevronRight size={13} className="text-text-dim/30 group-hover:text-text-dim/60 transition-colors" />
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-text-dim/60">
                          <span>{streamIds.length} {streamIds.length === 1 ? 'stream' : 'streams'} committed</span>
                          {consumer ? (
                            <span className="flex items-center gap-1 text-purple-300/80" title={`Folded into continuity on this branch at ${consumer.name}`}>
                              <PrMergedIcon size={11} /> folded into {consumer.name}
                            </span>
                          ) : (
                            <span className="text-text-dim/40 italic" title="Not yet used to continue reality on this branch">
                              not yet folded
                            </span>
                          )}
                        </div>
                        {f.summary && (
                          <p className="mt-1.5 text-[12px] text-text-secondary leading-relaxed line-clamp-2">{f.summary}</p>
                        )}
                        {/* Streams kept separate, each with its committed final outcome */}
                        {merged.length > 0 && (
                          <div className="mt-2.5 border-t border-white/6 pt-2 space-y-1.5">
                            {merged.map((s) => {
                              const res = f.resolutions?.[s.id];
                              return (
                                <div key={s.id} className="flex items-center gap-2 min-w-0">
                                  <PerspectivePairBadge memberId={s.memberId} agentId={s.agentId} perspectiveId={s.perspectiveId} n={n} size={16} />
                                  <span className="text-[12px] text-text-secondary truncate">{s.title}</span>
                                  {res ? (
                                    <span className="ml-auto shrink-0 flex items-center gap-1.5 max-w-[55%] justify-end flex-wrap">
                                      {res.overridden && <span className="text-[9px] uppercase tracking-wide text-amber-400/80">override</span>}
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 shrink-0" title="Executive decision — drives generation" />
                                      <span className="text-[12px] font-medium text-text-primary text-right break-words">{resolutionOutcomes(res).join(' + ')}</span>
                                    </span>
                                  ) : (
                                    <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wide text-text-dim/45 border border-white/10 rounded px-1.5 py-0.5" title="Recorded only — no executive decision; kept for the record, does not drive generation">
                                      recorded
                                    </span>
                                  )}
                                  <StreamBeliefSpark stream={s} />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
      </div>
    </div>
  );
}
