'use client';
// MergesView — the Vision "History" tab. A vertical timeline of merges: each
// folded a set of committed streams together to extend continuity. Clicking a
// merge opens it in the inspector (MergeDetail) — the permanent record of what
// was committed, with each stream's executive/recorded status and revert.
// Most recent at the top.

import { useMemo } from 'react';
import { useStore } from '@/lib/state/store';
import { IconChevronRight } from '@/components/icons';
import { PrMergedIcon } from './RoomUI';
import { buildMergeConsumerMap, mergesForBranch, resolutionOutcomes } from '@/lib/merges';

const fmtWhen = (ms: number) =>
  `${new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

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
        <header className="flex items-center gap-2 pb-2.5 mb-3 border-b border-white/5">
          <PrMergedIcon size={13} />
          <span className="text-[10px] uppercase tracking-[0.18em] text-text-dim/80 font-medium">
            History <span className="text-text-dim/40 ml-0.5">{merges.length}</span>
          </span>
          <span className="ml-auto text-[10px] text-text-dim/40">commits folded into continuity</span>
        </header>

        {merges.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-10 text-center text-[12px] text-text-dim/40 italic">
            No merges yet. Commit streams in the Streams tab to fold a merge into continuity.
          </div>
        ) : (
          <ol className="relative">
            {/* Lineage rail — the committed timeline, mirroring the branch tree. */}
            <div className="absolute left-[6px] top-2 bottom-3 w-px bg-white/8" aria-hidden />
            {merges.map((f) => {
              const streamIds = f.streamIds ?? [];
              const consumer = mergeConsumers.get(f.id);
              const folded = !!consumer;
              const exec = streamIds.filter((id) => resolutionOutcomes(f.resolutions?.[id]).length > 0).length;
              const rec = streamIds.length - exec;
              return (
                <li key={f.id} className="relative pl-6">
                  {/* Dot — filled when folded into continuity on this branch,
                      hollow when still pending (active vs inactive, branch-style). */}
                  <span
                    className="absolute left-[2px] top-[13px] h-[9px] w-[9px] rounded-full border-[1.5px] border-purple-400/70"
                    style={{ background: folded ? 'rgba(168,85,247,0.85)' : 'transparent' }}
                    aria-hidden
                  />
                  <button
                    onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'merge', mergeId: f.id } })}
                    className="group relative w-full overflow-hidden rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    {/* Folded rows get a quiet purple left-edge accent (mirrors
                        the branch tree's canon edge). */}
                    {folded && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-purple-400/70" aria-hidden />}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate text-[13px] font-medium text-text-primary group-hover:text-white transition-colors">{f.label || 'Commit'}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-text-dim/45 tabular-nums">{fmtWhen(f.at)}</span>
                      <IconChevronRight size={12} className="shrink-0 text-text-dim/25 group-hover:text-text-dim/60 transition-colors" />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-text-dim/55">
                      <span className="tabular-nums">{streamIds.length} {streamIds.length === 1 ? 'stream' : 'streams'}</span>
                      {exec > 0 && <><span className="text-text-dim/25">·</span><span className="text-emerald-300/75 tabular-nums">{exec} executive</span></>}
                      {rec > 0 && <><span className="text-text-dim/25">·</span><span className="tabular-nums">{rec} recorded</span></>}
                      <span className="text-text-dim/25">·</span>
                      {folded
                        ? <span className="truncate text-purple-300/80" title={`Folded into continuity on this branch at ${consumer!.name}`}>into {consumer!.name}</span>
                        : <span className="italic text-text-dim/40" title="Not yet used to continue reality on this branch">not yet folded</span>}
                    </div>
                    {f.summary && (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-text-secondary/80">{f.summary}</p>
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
