"use client";

// StreamDetail — inspector view for a stream: stance across outcomes, belief
// stats, and the priors log. The stream cousin of ThreadDetail — streams share
// the Fate-thread belief mechanics but are HEAD-based (driven by member priors
// stamped in wall-clock time, not scene deltas), so there's no scene replay.

import { useMemo, useState } from "react";
import { useStore } from "@/lib/state/store";
import type { ThreadLogNodeType } from "@/types/narrative";
import { normalizedEntropy } from "@/lib/forces/narrative-utils";
import {
  streamProbs,
  streamMargin,
  classifyStreamCategory,
} from "@/lib/forces/stream-stance";
import {
  THREAD_CATEGORY_LABEL,
  THREAD_CATEGORY_TEXT,
  THREAD_CATEGORY_DESCRIPTION,
  outcomeColourHex,
} from "@/lib/forces/thread-category";
import { STANCE_TAU_CLOSE, STANCE_ABANDON_VOLUME } from "@/lib/constants";
import { CollapsibleSection, Paginator, paginateRecent } from "./CollapsibleSection";
import { InlineText } from "./InlineEdit";
import { PerspectivePairBadge } from "@/components/stage/RoomUI";

type Props = { streamId: string };

const LOG_TYPE_HEX: Record<ThreadLogNodeType, string> = {
  pulse: "#9ca3af",
  transition: "#fbbf24",
  setup: "#fbbf24",
  escalation: "#fb923c",
  payoff: "#34d399",
  twist: "#a78bfa",
  callback: "#38bdf8",
  resistance: "#ef4444",
  stall: "#f87171aa",
};

const LOG_TYPE_ORDER: ThreadLogNodeType[] = [
  "payoff", "twist", "escalation", "setup", "resistance", "callback", "transition", "pulse", "stall",
];

const LOG_TYPE_GLOSS: Record<ThreadLogNodeType, string> = {
  pulse: "Attention without movement — the prior acknowledged the question but the odds didn't shift.",
  transition: "Lifecycle state changed — the stream crossed a structural boundary.",
  setup: "A promise is being planted — future payoff telegraphed, odds nudge gently.",
  escalation: "Stakes rising — pressure mounts without yet resolving direction.",
  payoff: "A promise paid off — strong evidence, often closes the stance toward an outcome.",
  twist: "The leader flipped — major shock, highest-information move you can see.",
  callback: "Past evidence re-activated — history being honored, modest probability shift.",
  resistance: "Something pushed back against the current direction — counter-evidence.",
  stall: "Nothing moved and it shows — the stream is drifting, losing attention.",
};

const STAT_GLOSS = {
  volume:
    "VOLUME — cumulative member attention this stance has earned.\n\nGrows when priors carry a volumeDelta. Below " +
    STANCE_ABANDON_VOLUME + " the stream reads as abandoned.",
  uncertainty:
    "UNCERTAINTY — normalized entropy of the distribution, 0–100%.\n\n100% = every outcome equally likely. 0% = the stance has decided.",
  volatility:
    "VOLATILITY (σ) — EWMA of recent prior magnitude.\n\nHow hard the stance has been shaken lately. High σ = the stream is hot.",
  margin:
    "MARGIN (Δ) — log-odds gap between the top two outcomes.\n\nΔ≈0 = tie. Δ≥" + STANCE_TAU_CLOSE +
    " with a decisive payoff/twist triggers soft closure.",
  focus:
    "FOCUS — composite attention × contestedness × turbulence.\n\nvolume × (0.15 + entropy) × (1 + volatility). The Stream dashboard orders by this.",
  priors:
    "PRIORS — observations gathered into this stream over time.\n\nThe first prior is the seeding intuition; each subsequent one moves the stance.",
};

function StatTile({
  label, value, hint, accent,
}: { label: string; value: string; hint: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-white/5 bg-white/2 px-2 py-1.5 cursor-help" title={hint}>
      <span className="text-[9px] uppercase tracking-wider text-text-dim">{label}</span>
      <span className="text-sm font-mono tabular-nums" style={{ color: accent ?? "var(--color-text-primary)" }}>{value}</span>
    </div>
  );
}

function LogTypeMixBar({ counts, total }: { counts: Record<ThreadLogNodeType, number>; total: number }) {
  if (total === 0) return null;
  const segments = LOG_TYPE_ORDER.filter((t) => counts[t] > 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-wider text-text-dim cursor-help"
          title="EVIDENCE MIX — how this stance has moved across its priors. payoff-heavy = decisive, twist-heavy = volatile, pulse-heavy = maintained but slow-moving.">
          Evidence mix
        </span>
        <span className="text-[9px] text-text-dim/70 font-mono tabular-nums ml-auto">{total} priors</span>
      </div>
      <div className="h-1.5 w-full flex rounded-full overflow-hidden bg-white/5">
        {segments.map((t) => (
          <div key={t} title={`${t} × ${counts[t]}\n\n${LOG_TYPE_GLOSS[t]}`} className="cursor-help h-full"
            style={{ width: `${(counts[t] / total) * 100}%`, background: LOG_TYPE_HEX[t] }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px]">
        {segments.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 text-text-dim cursor-help" title={LOG_TYPE_GLOSS[t]}>
            <span className="h-1.5 w-1.5 rounded-sm" style={{ background: LOG_TYPE_HEX[t] }} />
            <span className="capitalize">{t}</span>
            <span className="font-mono tabular-nums text-text-dim/70">{counts[t]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function SaturationGauge({ margin }: { margin: number }) {
  const pct = Math.min(100, (Math.abs(margin) / STANCE_TAU_CLOSE) * 100);
  const near = pct >= 66;
  const ready = pct >= 100;
  const color = ready ? "#34d399" : near ? "#fbbf24" : "#64748b";
  const label = ready ? "Ready to close" : near ? "Saturating" : "In play";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] uppercase tracking-wider text-text-dim cursor-help"
          title={"CLOSURE PROXIMITY — how close |margin| is to the τ threshold (" + STANCE_TAU_CLOSE + "). At 100%, the next decisive payoff/twist can soft-close the stance."}>
          Closure proximity
        </span>
        <span className="text-[10px] font-mono tabular-nums" style={{ color }}>{pct.toFixed(0)}%</span>
        <span className="text-[9px] ml-auto" style={{ color }}>{label}</span>
      </div>
      <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

const fmtStamp = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function StreamDetail({ streamId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [priorPage, setPriorPage] = useState(0);

  const stream = narrative?.streams?.[streamId];

  const category = useMemo(() => (stream ? classifyStreamCategory(stream) : "dormant"), [stream]);

  if (!narrative || !stream) return null;

  const outcomes = stream.outcomes ?? [];
  const probs = streamProbs(stream);
  const { topIdx, margin } = streamMargin(stream);
  const volume = stream.stance?.volume ?? 0;
  const volatility = stream.stance?.volatility ?? 0;
  const entropy = normalizedEntropy(probs);
  const focus = volume * (0.15 + entropy) * (1 + volatility);
  const isClosed = stream.closedAt !== undefined && stream.closeOutcome !== undefined;
  const catColor = "var(--color-fate)";

  const ranked = outcomes
    .map((outcome, idx) => ({ outcome, idx, prob: probs[idx] ?? 0 }))
    .sort((a, b) => b.prob - a.prob);

  // Evidence-type mix across the stream's priors.
  const logCounts: Record<ThreadLogNodeType, number> = {
    pulse: 0, transition: 0, setup: 0, escalation: 0, payoff: 0, twist: 0, callback: 0, resistance: 0, stall: 0,
  };
  for (const p of stream.priors) {
    const t = p.logType ?? "pulse";
    if (t in logCounts) logCounts[t]++;
  }
  const logTotal = Object.values(logCounts).reduce((a, b) => a + b, 0);

  // Newest-first priors for the log section.
  const priorsDesc = [...stream.priors].sort((a, b) => b.at - a.at);

  // Other streams holding the same question — a local market of perspectives.
  const sharesQuestion = Object.values(narrative.streams ?? {}).filter(
    (s) => s.id !== streamId && s.title.trim().toLowerCase() === stream.title.trim().toLowerCase(),
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Stream id + title */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-dim self-start">stream</span>
          <span className="text-[10px] uppercase tracking-wider text-text-dim">
            {stream.state}{stream.inferred && <span className="text-amber-400/70 italic"> · inferred</span>}
          </span>
        </div>
        <InlineText
          value={stream.title}
          onSave={(title) => dispatch({ type: "UPSERT_STREAM", stream: { ...stream, title } })}
          multiline
          className="text-sm text-text-primary"
          inputClassName="text-sm"
        />
        <PerspectivePairBadge memberId={stream.memberId} agentId={stream.agentId} perspectiveId={stream.perspectiveId} n={narrative} size={20} />
      </div>

      {/* Category + horizon */}
      <div className="flex items-center gap-2">
        <span className={`text-[10px] uppercase tracking-widest cursor-help ${THREAD_CATEGORY_TEXT[category]}`}
          title={`${THREAD_CATEGORY_LABEL[category].toUpperCase()} — ${THREAD_CATEGORY_DESCRIPTION[category]}\n\nDerived from volume + entropy + volatility.`}>
          {THREAD_CATEGORY_LABEL[category]}
        </span>
        {stream.horizon && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 font-mono cursor-help"
            title="HORIZON — stated structural distance to resolution; scales evidence magnitude.">
            {stream.horizon}
          </span>
        )}
        <span className="text-[9px] text-text-dim font-mono ml-auto">{stream.priors.length} priors</span>
      </div>

      {/* Stance — distribution + belief stats */}
      <div className="flex flex-col gap-3 rounded-lg border border-white/5 bg-white/1.5 p-3">
        {outcomes.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {ranked.map(({ outcome, idx, prob }) => {
              const color = outcomeColourHex(idx);
              const isWinner = isClosed && stream.closeOutcome === idx;
              const logit = stream.stance?.logits[idx] ?? 0;
              return (
                <li key={`${outcome}-${idx}`} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: color }} />
                    <span className={`text-xs flex-1 wrap-break-word min-w-0 leading-snug ${isWinner ? "text-text-primary font-medium" : "text-text-secondary"}`}
                      title={`${outcome}\n\nprobability ${Math.round(prob * 100)}% · logit ${logit.toFixed(2)}`}>
                      {outcome}
                    </span>
                    <span className="text-xs font-mono tabular-nums text-text-primary">{Math.round(prob * 100)}%</span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full" style={{ width: `${prob * 100}%`, background: color, opacity: ranked[0].idx === idx ? 1 : 0.55 }} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[11px] text-text-dim italic">Legacy stream — no belief outcomes.</p>
        )}

        {/* Belief stats */}
        <div className="grid grid-cols-3 gap-1.5">
          <StatTile label="Volume" value={volume.toFixed(1)} hint={STAT_GLOSS.volume} />
          <StatTile label="Uncertainty" value={`${Math.round(entropy * 100)}%`} hint={STAT_GLOSS.uncertainty} />
          <StatTile label="Volatility" value={`σ ${volatility.toFixed(2)}`} hint={STAT_GLOSS.volatility} />
          <StatTile label="Margin" value={`Δ ${margin.toFixed(2)}`} hint={STAT_GLOSS.margin} />
          <StatTile label="Focus" value={focus >= 10 ? focus.toFixed(1) : focus >= 1 ? focus.toFixed(2) : focus.toFixed(3)} hint={STAT_GLOSS.focus} accent={focus > 0 ? "#fbbf24" : undefined} />
          <StatTile label="Priors" value={String(stream.priors.length)} hint={STAT_GLOSS.priors} />
        </div>

        {!isClosed && outcomes.length > 0 && <SaturationGauge margin={margin} />}
        {logTotal > 0 && <LogTypeMixBar counts={logCounts} total={logTotal} />}

        {isClosed && (
          <div className="text-[10px] text-text-dim pt-1 border-t border-white/5">
            Resolved → <span style={{ color: catColor }}>{outcomes[stream.closeOutcome ?? topIdx]}</span>
            {stream.resolutionQuality !== undefined && (
              <> · quality <span className="font-mono tabular-nums text-text-secondary">{Math.round(stream.resolutionQuality * 100)}%</span></>
            )}
          </div>
        )}
      </div>

      {/* Priors log — each entry links to its prior detail */}
      {priorsDesc.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(priorsDesc, priorPage);
        return (
          <CollapsibleSection title="Priors" count={priorsDesc.length} defaultOpen>
            <ul className="flex flex-col gap-2.5">
              {pageItems.map((p) => (
                <li key={p.id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[8px] uppercase tracking-wider font-semibold px-1 py-0.5 rounded cursor-help"
                      style={{ color: LOG_TYPE_HEX[p.logType ?? "pulse"], backgroundColor: `${LOG_TYPE_HEX[p.logType ?? "pulse"]}1a` }}
                      title={`${(p.logType ?? "pulse").toUpperCase()} — ${LOG_TYPE_GLOSS[p.logType ?? "pulse"]}`}>
                      {p.logType ?? "pulse"}
                    </span>
                    {(p.updates ?? []).map((u, ui) => {
                      const pos = u.evidence > 0, neg = u.evidence < 0;
                      return (
                        <span key={ui}
                          className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full cursor-help ${pos ? "bg-emerald-500/12 text-emerald-300" : neg ? "bg-red-500/12 text-red-300" : "bg-white/6 text-text-dim"}`}
                          title={`Evidence ${u.evidence >= 0 ? "+" : ""}${u.evidence} on "${u.outcome}". Shifts that outcome's logit by evidence / 2, then softmax renormalizes.`}>
                          <span className="truncate max-w-35">{u.outcome}</span>
                          <span className="font-mono tabular-nums shrink-0">{u.evidence >= 0 ? "+" : ""}{u.evidence}</span>
                        </span>
                      );
                    })}
                    <span className="ml-auto font-mono text-[9px] text-text-dim/60 shrink-0">{fmtStamp(p.at)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "SET_INSPECTOR", context: { type: "streamPrior", streamId, priorId: p.id } })}
                    className="flex items-start gap-2 text-left group"
                  >
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: LOG_TYPE_HEX[p.logType ?? "pulse"] }} />
                    <span className="text-xs text-text-primary group-hover:text-white transition-colors">{p.text}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Paginator page={safePage} totalPages={totalPages} onPage={setPriorPage} />
          </CollapsibleSection>
        );
      })()}

      {/* Shares this question — sibling streams in the same local market */}
      {sharesQuestion.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Shares this question</h3>
          <ul className="flex flex-col gap-1">
            {sharesQuestion.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "SET_INSPECTOR", context: { type: "stream", streamId: s.id } })}
                  className="flex items-center gap-2 text-left text-xs text-text-secondary transition-colors hover:text-text-primary w-full"
                >
                  <PerspectivePairBadge memberId={s.memberId} agentId={s.agentId} perspectiveId={s.perspectiveId} n={narrative} size={16} />
                  <span className={`text-[10px] uppercase tracking-wider ${THREAD_CATEGORY_TEXT[classifyStreamCategory(s)]}`}>
                    {THREAD_CATEGORY_LABEL[classifyStreamCategory(s)]}
                  </span>
                  <span className="ml-auto font-mono tabular-nums text-text-dim shrink-0">{s.priors.length}p</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
