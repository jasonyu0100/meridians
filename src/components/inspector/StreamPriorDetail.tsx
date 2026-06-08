"use client";

// StreamPriorDetail — inspector view for a single stream prior: perceptual
// primitive, the member's prose, per-outcome evidence, and how it moved the
// stance. The stream cousin of ThreadLogNodeDetail (a prior is a stream's
// belief-log node). Prose is editable; the logType + evidence are recorded by
// the scorer at add-time, so they're shown read-only.

import { useStore } from "@/lib/state/store";
import type { ThreadLogNodeType } from "@/types/narrative";
import { InlineText } from "./InlineEdit";
import { memberName } from "@/components/stage/RoomUI";

type Props = { streamId: string; priorId: string };

const TYPE_FILL: Record<ThreadLogNodeType, string> = {
  pulse: "#666",
  transition: "#EF4444",
  setup: "#FBBF24",
  escalation: "#F97316",
  payoff: "#34D399",
  twist: "#C084FC",
  callback: "#38BDF8",
  resistance: "#EF4444",
  stall: "#EF4444",
};

const TYPE_DESCRIPTIONS: Record<ThreadLogNodeType, string> = {
  pulse: "Question acknowledged — continuity maintained without change",
  transition: "Fundamental lifecycle state changed",
  setup: "Groundwork laid — foreshadowing, promise, seed planted",
  escalation: "Stakes rising within the current stage",
  payoff: "A promise made to the question has been fulfilled",
  twist: "The stance's direction changed — leader revised",
  callback: "Reference to earlier evidence — continuity rewarded",
  resistance: "Opposition experienced — counter-evidence to the lean",
  stall: "Not moving — self-diagnosis of drift",
};

const fmtStamp = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function StreamPriorDetail({ streamId, priorId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const stream = narrative.streams?.[streamId];
  if (!stream) return <p className="text-xs text-text-dim">Stream not found</p>;

  const priors = [...stream.priors].sort((a, b) => a.at - b.at);
  const index = priors.findIndex((p) => p.id === priorId);
  const prior = index >= 0 ? priors[index] : undefined;
  if (!prior) return <p className="text-xs text-text-dim">Prior not found</p>;

  const logType = prior.logType ?? "pulse";
  const author = prior.authorId ? narrative.members?.[prior.authorId] : undefined;
  const isSeed = index === 0;
  const prev = index > 0 ? priors[index - 1] : undefined;
  const next = index < priors.length - 1 ? priors[index + 1] : undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* Header — type + editable prose */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: TYPE_FILL[logType] }} />
          <span className="text-[10px] uppercase tracking-widest text-text-secondary">{logType}</span>
          {isSeed && <span className="text-[9px] uppercase tracking-wider text-amber-400/80">seed</span>}
          <span className="ml-auto text-[10px] text-text-dim font-mono">{fmtStamp(prior.at)}</span>
        </div>
        <InlineText
          value={prior.text}
          onSave={(text) => dispatch({ type: "EDIT_STREAM_PRIOR", streamId, priorId, text })}
          multiline
          className="text-sm text-text-primary leading-relaxed"
          inputClassName="text-sm"
        />
        {author && <span className="text-[10px] text-text-dim">by {memberName(author)}</span>}
      </div>

      {/* Type description */}
      <p className="text-[10px] text-text-dim italic">{TYPE_DESCRIPTIONS[logType]}</p>

      {/* Evidence — per-outcome log-odds shifts this prior emitted */}
      {(prior.updates ?? []).length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Evidence</h3>
          <ul className="flex flex-col gap-1">
            {(prior.updates ?? []).map((u, ui) => {
              const pos = u.evidence > 0, neg = u.evidence < 0;
              return (
                <li key={ui} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 min-w-0 truncate text-text-secondary">{u.outcome}</span>
                  <span
                    className={`font-mono tabular-nums px-1.5 py-0.5 rounded-full text-[11px] ${pos ? "bg-emerald-500/12 text-emerald-300" : neg ? "bg-red-500/12 text-red-300" : "bg-white/6 text-text-dim"}`}
                    title="Signed evidence in [−4, +4]. Shifts this outcome's logit by evidence / 2, then softmax renormalizes. |e|≥3 is decisive."
                  >
                    {u.evidence >= 0 ? "+" : ""}{u.evidence}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-[10px] text-text-dim italic">
          {isSeed ? "Seeding intuition — its directional weight lives in the opening logits, so it carries no further shift." : "No stance movement — an attention-only prior."}
        </p>
      )}

      {/* Stance impact — volume + info-gain readouts */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="flex flex-col gap-0.5 rounded-md border border-white/5 bg-white/2 px-2 py-1.5">
          <span className="text-[9px] uppercase tracking-wider text-text-dim">Δ volume</span>
          <span className="text-sm font-mono tabular-nums text-text-primary">
            {prior.volumeDelta !== undefined ? `${prior.volumeDelta >= 0 ? "+" : ""}${prior.volumeDelta.toFixed(1)}` : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-md border border-white/5 bg-white/2 px-2 py-1.5">
          <span className="text-[9px] uppercase tracking-wider text-text-dim">Info gain</span>
          <span className="text-sm font-mono tabular-nums text-text-primary">{(prior.infoGain ?? 0).toFixed(2)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-md border border-white/5 bg-white/2 px-2 py-1.5">
          <span className="text-[9px] uppercase tracking-wider text-text-dim">Pre-volume</span>
          <span className="text-sm font-mono tabular-nums text-text-primary">{(prior.preVolume ?? 0).toFixed(1)}</span>
        </div>
      </div>

      {prior.addedOutcomes && prior.addedOutcomes.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Introduced outcomes</h3>
          <div className="flex flex-wrap gap-1">
            {prior.addedOutcomes.map((o) => (
              <span key={o} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/6 text-text-secondary">{o}</span>
            ))}
          </div>
        </div>
      )}

      {/* Parent stream */}
      <button
        onClick={() => dispatch({ type: "SET_INSPECTOR", context: { type: "stream", streamId } })}
        className="text-xs text-text-secondary hover:text-text-primary transition-colors text-left"
      >
        &larr; {stream.title}
      </button>

      {/* Neighbouring priors */}
      {(prev || next) && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Sequence</h3>
          {prev && (
            <button
              onClick={() => dispatch({ type: "SET_INSPECTOR", context: { type: "streamPrior", streamId, priorId: prev.id } })}
              className="text-xs text-text-dim hover:text-text-secondary transition-colors text-left"
            >
              ← {prev.text.slice(0, 60)}{prev.text.length > 60 ? "…" : ""}
            </button>
          )}
          {next && (
            <button
              onClick={() => dispatch({ type: "SET_INSPECTOR", context: { type: "streamPrior", streamId, priorId: next.id } })}
              className="text-xs text-text-dim hover:text-text-secondary transition-colors text-left"
            >
              → {next.text.slice(0, 60)}{next.text.length > 60 ? "…" : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
