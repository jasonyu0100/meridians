'use client';
// MergesView — the Vision "History" tab. A vertical timeline of merges: each
// folded a set of committed streams together to extend continuity. Clicking a
// merge opens its detail — the permanent record of what was committed, with
// each stream's final outcome, belief trajectory, and the priors that fed it.
// Most recent at the top.

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/state/store';
import type { Merge, MergeResolution, Stream, NarrativeState } from '@/types/narrative';
import { IconChevronLeft, IconChevronRight } from '@/components/icons';
import { InlineText } from '@/components/inspector/InlineEdit';
import { PrMergedIcon, PerspectivePairBadge, perspectiveName } from './RoomUI';
import { StreamBeliefPanel, StreamBeliefSpark, OUTCOME_HEX, fmtStamp } from './StreamsView';
import { streamMargin } from '@/lib/forces/stream-stance';
import { buildMergeConsumerMap, mergesForBranch, resolutionOutcomes } from '@/lib/merges';

export function MergesView() {
  const { state } = useStore();
  const n = state.activeNarrative;
  // Merge opened for detail; stays in this tab.
  const [viewId, setViewId] = useState<string | null>(null);

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

  const viewing = viewId ? n.merges?.[viewId] : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4">
        {viewing ? (
          <MergeDetail merge={viewing} n={n} onBack={() => setViewId(null)} />
        ) : (
          <>
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
                        onClick={() => setViewId(f.id)}
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
          </>
        )}
      </div>
    </div>
  );
}

/** The insides of a merge — its label/summary (editable), an overview strip,
 *  and one read-only card per committed stream (final outcome + belief +
 *  priors). The historical mirror of the commit review. */
function MergeDetail({ merge, n, onBack }: { merge: Merge; n: NarrativeState; onBack: () => void }) {
  const { state, dispatch } = useStore();
  const consumer = useMemo(
    () => buildMergeConsumerMap(n, state.resolvedEntryKeys).get(merge.id) ?? null,
    [n, state.resolvedEntryKeys, merge.id],
  );
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  const streamIds = merge.streamIds ?? [];
  const merged = streamIds
    .map((id) => n.streams?.[id])
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  const overrides = merged.filter((s) => merge.resolutions?.[s.id]?.overridden).length;
  const totalPriors = merged.reduce((sum, s) => sum + s.priors.length, 0);
  // Executive = streams committed to an outcome (drive generation); recorded =
  // folded in without one (organisational record, non-driving).
  const executive = merged.filter((s) => merge.resolutions?.[s.id]).length;
  const recorded = merged.length - executive;

  // Editable label/summary persist via CREATE_MERGE (an upsert keyed by id).
  const saveMerge = (patch: Partial<Merge>) =>
    dispatch({ type: 'CREATE_MERGE', merge: { ...merge, ...patch } });

  // How many of this merge's streams will reopen (committed, not sealed by
  // another merge). Committed-once is the norm, so this is usually all of them.
  const reopenable = merged.filter((s) => s.state === 'committed').length;

  const doRevert = () => {
    dispatch({ type: 'REVERT_MERGE', mergeId: merge.id });
    onBack();
  };

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-[11px] text-text-dim/70 hover:text-text-primary transition-colors mb-3"
      >
        <IconChevronLeft size={13} /> History
      </button>

      <div className="flex items-center gap-2">
        <PrMergedIcon size={16} />
        <span className="text-[15px] font-semibold text-text-primary min-w-0">
          <InlineText
            value={merge.label || ''}
            placeholder="Commit"
            onSave={(label) => saveMerge({ label })}
          />
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-text-dim/50 tabular-nums">
          {new Date(merge.at).toLocaleString()}
        </span>
      </div>

      {/* Continuity status — branch-aware: was this merge folded into the
          reality the current branch displays, and where. */}
      <div className="mt-2 flex items-center gap-2 text-[11px]">
        {consumer ? (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/10 border border-purple-400/30 text-purple-200" title="This branch continues reality from this merge">
            <PrMergedIcon size={12} /> Folded into continuity at {consumer.name}
          </span>
        ) : (
          <span className="px-2 py-1 rounded-md border border-white/8 text-text-dim/50 italic" title="Not yet used to continue reality on this branch">
            Not yet folded into continuity on this branch
          </span>
        )}
      </div>

      {/* Overview strip — executive (drives generation) vs recorded (kept for
          the organisational record only) leads, since that split is the merge's
          core distinction. */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        <OverviewStat value={String(executive)} label="executive" tone="emerald" />
        <OverviewStat value={String(recorded)} label="recorded" />
        <OverviewStat value={String(totalPriors)} label="priors folded" />
        <OverviewStat value={String(overrides)} label="overrides" accent={overrides > 0} />
      </div>

      {/* Summary — how continuity was extended */}
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
        <label className="text-[10px] uppercase tracking-wider text-text-dim/50">Summary</label>
        <div className="mt-1 text-[12px] text-text-secondary leading-relaxed">
          <InlineText
            value={merge.summary || ''}
            multiline
            placeholder="How did this merge extend continuity?"
            onSave={(summary) => saveMerge({ summary })}
          />
        </div>
      </div>

      {/* Per-stream record */}
      <div className="mt-4 space-y-4">
        {merged.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/8 px-4 py-6 text-center text-[11px] text-text-dim/40 italic">
            The committed streams for this merge are no longer present.
          </div>
        ) : (
          merged.map((s) => (
            <MergeStreamCard key={s.id} stream={s} resolution={merge.resolutions?.[s.id]} n={n} />
          ))
        )}
      </div>

      {/* Revert — undo the commit: reopen the streams it sealed and unstamp it
          as a continuity basis. Generated content stays; the streams go back to
          open so the questions can keep gathering priors. */}
      <div className="mt-6 rounded-lg border border-red-500/20 bg-red-500/3 px-3 py-3">
        {confirmingRevert ? (
          <div className="space-y-2.5">
            <p className="text-[12px] text-text-secondary leading-relaxed">
              Revert this merge? {reopenable > 0
                ? `${reopenable} ${reopenable === 1 ? 'stream returns' : 'streams return'} to open and can take priors again.`
                : 'No streams will reopen.'}{' '}
              The merge record is removed.
              {consumer && (
                <> Continuity already generated at <span className="text-text-primary">{consumer.name}</span> from this merge is <span className="text-text-primary">not</span> rolled back — only the basis stamp is cleared.</>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={doRevert}
                className="rounded-md bg-red-500/80 hover:bg-red-500 px-3 py-1.5 text-[12px] font-medium text-white transition-colors"
              >
                Revert merge
              </button>
              <button
                onClick={() => setConfirmingRevert(false)}
                className="rounded-md border border-white/10 hover:border-white/20 px-3 py-1.5 text-[12px] text-text-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-text-primary">Revert merge</div>
              <div className="text-[11px] text-text-dim/60">Reopen the committed streams and remove this commit.</div>
            </div>
            <button
              onClick={() => setConfirmingRevert(true)}
              className="ml-auto shrink-0 rounded-md border border-red-500/30 hover:border-red-500/50 hover:bg-red-500/10 px-3 py-1.5 text-[12px] text-red-300/90 transition-colors"
            >
              Revert
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OverviewStat({ value, label, accent, tone }: { value: string; label: string; accent?: boolean; tone?: 'emerald' }) {
  const valueColor = tone === 'emerald' ? 'text-emerald-400/90' : accent ? 'text-amber-400/90' : 'text-text-primary';
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2 flex flex-col gap-0.5">
      <span className={`text-[16px] font-mono tabular-nums leading-none ${valueColor}`}>{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-text-dim/40">{label}</span>
    </div>
  );
}

/** One committed stream inside a merge — final outcome (with override divergence
 *  from what the belief actually leaned), the belief panel, and the sealed
 *  priors that produced it. Read-only: a committed stance can't take more priors. */
function MergeStreamCard({ stream, resolution, n }: { stream: Stream; resolution?: MergeResolution; n: NarrativeState }) {
  const outcomes = stream.outcomes ?? [];
  const { topIdx } = streamMargin(stream);
  const leader = outcomes[topIdx];
  const committedSet = resolutionOutcomes(resolution);
  const multi = committedSet.length > 1;
  const overridden = resolution?.overridden && !!leader && !committedSet.includes(leader);
  const priors = [...stream.priors].sort((a, b) => a.at - b.at);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <PerspectivePairBadge memberId={stream.memberId} agentId={stream.agentId} perspectiveId={stream.perspectiveId} n={n} size={22} />
        <span className="text-[14px] font-semibold text-text-primary truncate">{stream.title}</span>
        <span
          className={`shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
            resolution
              ? 'border-emerald-400/40 text-emerald-300/90'
              : 'border-white/12 text-text-dim/55'
          }`}
          title={resolution
            ? 'Executive decision — a commitment to updating reality; drives generation'
            : 'Recorded only — no executive stance; kept for the record, does not drive generation'}
        >
          {resolution ? 'executive' : 'recorded'}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-text-dim/40">
          {perspectiveName(n.perspectives?.[stream.perspectiveId], n)}
        </span>
      </div>

      {/* Committed outcome(s) — and where they diverged from the accumulated belief */}
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 flex-wrap ${committedSet.length > 0 ? 'border-white/8 bg-white/[0.015]' : 'border-dashed border-white/8'}`}>
        <span className="text-[10px] uppercase tracking-wider text-text-dim/50">{committedSet.length > 0 ? 'Committed' : 'Recorded'}</span>
        {multi && <span className="text-[9px] uppercase tracking-wide text-purple-300/70">multi</span>}
        {committedSet.length > 0 ? (
          <span className="flex items-center gap-2 flex-wrap min-w-0">
            {committedSet.map((o) => {
              const idx = outcomes.indexOf(o);
              return (
                <span key={o} className="flex items-center gap-1.5 min-w-0">
                  {idx >= 0 && (
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: OUTCOME_HEX[idx % OUTCOME_HEX.length] }} />
                  )}
                  <span className="text-[13px] font-semibold text-text-primary break-words">{o}</span>
                </span>
              );
            })}
          </span>
        ) : (
          <span className="text-[12px] text-text-dim/50">no executive decision — kept for the record, doesn&apos;t drive generation</span>
        )}
        {overridden && (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-amber-400/80">
            <span className="uppercase tracking-wide">override</span>
            <span className="text-text-dim/50">belief leaned {leader}</span>
          </span>
        )}
      </div>

      {/* Belief — distribution + how the stance moved over the priors */}
      {outcomes.length > 0 && <StreamBeliefPanel stream={stream} />}

      {/* Priors that fed it (sealed) */}
      {priors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider text-text-dim/50">Priors over time</label>
          <div className="rounded-lg border border-white/8 divide-y divide-white/6 max-h-48 overflow-y-auto">
            {priors.map((p) => (
              <div key={p.id} className="flex items-baseline gap-2 px-3 py-1.5">
                <span className="shrink-0 text-[10px] text-text-dim/40 tabular-nums">{fmtStamp(p.at)}</span>
                {p.logType && <span className="shrink-0 text-[9px] uppercase tracking-wide text-text-dim/40">{p.logType}</span>}
                <span className="text-[12px] text-text-secondary leading-snug">{p.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
