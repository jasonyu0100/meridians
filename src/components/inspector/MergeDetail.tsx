"use client";

// MergeDetail — inspector view for a merge: the war-room commit that folded a
// set of streams into continuity. Shows the executive decisions (resolved
// streams that drive generation) vs the recorded ones (folded in for the record,
// non-driving), where the merge was folded into continuity on this branch, and
// links each stream through to its own Stream detail.

import { useMemo, useState } from "react";
import { useStore } from "@/lib/state/store";
import type { Merge, MergeResolution } from "@/types/narrative";
import { resolutionOutcomes, findMergeConsumer } from "@/lib/merges";
import { streamProbs, streamMargin } from "@/lib/forces/stream-stance";
import { outcomeColourHex } from "@/lib/forces/thread-category";
import { PerspectivePairBadge } from "@/components/stage/RoomUI";
import { InlineText } from "./InlineEdit";

type Props = { mergeId: string };

const fmtStamp = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** One stream row inside a merge — executive (committed outcome) or recorded
 *  (unresolved). Clickable through to the Stream detail. */
function MergeStreamRow({ streamId, resolution }: { streamId: string; resolution?: MergeResolution }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative!;
  const stream = narrative.streams?.[streamId];
  if (!stream) return null;

  const committed = resolutionOutcomes(resolution);
  const isExecutive = committed.length > 0;
  const outcomes = stream.outcomes ?? [];
  const { topIdx } = streamMargin(stream);
  const leader = outcomes[topIdx];
  const overridden = !!resolution?.overridden && !!leader && !committed.includes(leader);

  // Recorded rows show the leading-outcome of their final distribution, so the
  // reader sees where the unused line was pointing without a committed call.
  const probs = streamProbs(stream);
  const leaderPct = leader ? Math.round((probs[topIdx] ?? 0) * 100) : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => dispatch({ type: "SET_INSPECTOR", context: { type: "stream", streamId } })}
        className="flex w-full flex-col gap-1 rounded bg-white/3 px-2 py-1.5 text-left transition-colors hover:bg-white/7 group"
      >
        <div className="flex items-start gap-2 min-w-0">
          <PerspectivePairBadge memberId={stream.memberId} agentId={stream.agentId} perspectiveId={stream.perspectiveId} n={narrative} size={16} />
          <span className="flex-1 min-w-0 text-[11px] text-text-secondary group-hover:text-text-primary transition-colors leading-snug wrap-break-word">{stream.title}</span>
          <span
            className={`mt-0.5 shrink-0 text-[8px] uppercase tracking-wide px-1 py-0.5 rounded border ${
              isExecutive ? "border-emerald-400/40 text-emerald-300/90" : "border-white/12 text-text-dim/55"
            }`}
            title={isExecutive
              ? "Executive decision — a commitment to updating reality; drives generation"
              : "Recorded only — no executive stance; kept for the record, does not drive generation"}
          >
            {isExecutive ? "executive" : "recorded"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap pl-[26px]">
          {isExecutive ? (
            <>
              {overridden && <span className="text-[8px] uppercase tracking-wide text-amber-400/80">override</span>}
              {committed.map((o) => {
                const idx = outcomes.indexOf(o);
                return (
                  <span key={o} className="inline-flex items-center gap-1 text-[10px] text-text-primary">
                    {idx >= 0 && <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: outcomeColourHex(idx) }} />}
                    <span className="break-words">{o}</span>
                  </span>
                );
              })}
              {committed.length > 1 && <span className="text-[8px] uppercase tracking-wide text-purple-300/70">multi</span>}
            </>
          ) : (
            <span className="text-[10px] text-text-dim/55 italic">
              {leader ? <>tracks distribution · leaning {leader}{leaderPct !== null ? ` ${leaderPct}%` : ""}</> : "tracks distribution"}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

export default function MergeDetail({ mergeId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [confirmingRevert, setConfirmingRevert] = useState(false);

  const merge: Merge | undefined = narrative?.merges?.[mergeId];

  const consumer = useMemo(
    () => (narrative ? findMergeConsumer(narrative, state.resolvedEntryKeys, mergeId) : null),
    [narrative, state.resolvedEntryKeys, mergeId],
  );

  if (!narrative || !merge) return null;

  const streamIds = merge.streamIds ?? [];
  const executive = streamIds.filter((id) => resolutionOutcomes(merge.resolutions?.[id]).length > 0).length;
  const recorded = streamIds.length - executive;
  // How many streams reopen on revert (committed, not sealed by another merge).
  const reopenable = streamIds
    .map((id) => narrative.streams?.[id])
    .filter((s) => s?.state === "committed").length;

  const saveMerge = (patch: Partial<Merge>) =>
    dispatch({ type: "CREATE_MERGE", merge: { ...merge, ...patch } });

  const doRevert = () => {
    dispatch({ type: "REVERT_MERGE", mergeId });
    dispatch({ type: "SET_INSPECTOR", context: null });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-dim self-start">merge</span>
          <span className="text-[10px] text-text-dim/60 tabular-nums ml-auto">{fmtStamp(merge.at)}</span>
        </div>
        <InlineText
          value={merge.label ?? ""}
          onSave={(label) => saveMerge({ label })}
          placeholder="Commit"
          className="text-sm text-text-primary font-medium"
          inputClassName="text-sm font-medium"
        />
      </div>

      {/* Continuity status — where this merge was folded in on the active branch */}
      <button
        type="button"
        disabled={!consumer}
        onClick={() => consumer?.kind === "arc" && dispatch({ type: "SET_INSPECTOR", context: { type: "arc", arcId: consumer.id } })}
        className={`flex items-center gap-1.5 self-start rounded-md border px-2 py-1 text-[11px] transition-colors ${
          consumer
            ? "border-purple-400/30 bg-purple-500/10 text-purple-200 hover:bg-purple-500/16"
            : "border-white/8 text-text-dim/50 italic cursor-default"
        }`}
        title={consumer ? `Folded into continuity at ${consumer.name}` : "Not yet used to continue reality on this branch"}
      >
        {consumer ? `Folded into continuity at ${consumer.name}` : "Not yet folded into continuity on this branch"}
      </button>

      {/* Counts — executive vs recorded leads, the merge's core distinction */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-0.5 rounded-md border border-white/5 bg-white/2 px-2 py-1.5" title="Executive decisions — committed outcomes that drive generation">
          <span className="text-[9px] uppercase tracking-wider text-text-dim">Executive</span>
          <span className="text-sm font-mono tabular-nums text-emerald-400/90">{executive}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-md border border-white/5 bg-white/2 px-2 py-1.5" title="Recorded only — folded in for the record, non-driving">
          <span className="text-[9px] uppercase tracking-wider text-text-dim">Recorded</span>
          <span className="text-sm font-mono tabular-nums text-text-primary">{recorded}</span>
        </div>
      </div>

      {/* Summary */}
      <div className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Summary</h3>
        <InlineText
          value={merge.summary ?? ""}
          onSave={(summary) => saveMerge({ summary })}
          multiline
          placeholder="How did this merge extend continuity?"
          className="text-xs text-text-secondary leading-relaxed"
          inputClassName="text-xs leading-relaxed"
        />
      </div>

      {/* Streams folded in */}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
          Streams <span className="text-text-dim/50">({streamIds.length})</span>
        </h3>
        {streamIds.length === 0 ? (
          <p className="text-[11px] text-text-dim/40 italic">No streams on this merge.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {streamIds.map((id) => (
              <MergeStreamRow key={id} streamId={id} resolution={merge.resolutions?.[id]} />
            ))}
          </ul>
        )}
      </div>

      {/* Revert — reopen the committed streams and remove this commit. Generated
          continuity is not rolled back; only the basis stamp is cleared. */}
      <div className="border-t border-white/8 pt-3">
        {confirmingRevert ? (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-text-dim/70 leading-relaxed">
              {reopenable > 0
                ? `${reopenable} ${reopenable === 1 ? "stream returns" : "streams return"} to open and can take priors again.`
                : "No streams will reopen."}{" "}
              The merge record is removed.
              {consumer && (
                <> Continuity already generated at <span className="text-text-primary">{consumer.name}</span> is <span className="text-text-primary">not</span> rolled back — only the basis stamp is cleared.</>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={doRevert}
                className="rounded-md bg-red-500/80 hover:bg-red-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors"
              >
                Revert merge
              </button>
              <button
                onClick={() => setConfirmingRevert(false)}
                className="rounded-md border border-white/10 hover:border-white/20 px-3 py-1.5 text-[11px] text-text-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingRevert(true)}
            className="rounded-md border border-red-500/30 hover:border-red-500/50 hover:bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300/90 transition-colors"
            title="Reopen the committed streams and remove this commit"
          >
            Revert merge
          </button>
        )}
      </div>
    </div>
  );
}
