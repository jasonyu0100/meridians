"use client";

import {
  classifyThreadKind,
  computeBranchArcCoverage,
  focusScore,
  getMarketBelief,
  getMarketMargin,
  getMarketProbs,
  normalizedEntropy,
  scenesSinceTouched,
} from "@/lib/narrative-utils";
import {
  classifyThreadCategory,
  THREAD_CATEGORY_LABEL,
  THREAD_CATEGORY_TEXT,
  THREAD_CATEGORY_DESCRIPTION,
} from "@/lib/thread-category";
import { buildThreadTrajectory } from "@/lib/portfolio-analytics";
import { getThreadLogAtScene } from "@/lib/scene-filter";
import { MARKET_TAU_CLOSE, MARKET_ABANDON_VOLUME } from "@/lib/constants";
import type { NarrativeState, Thread, ThreadLogNodeType } from "@/types/narrative";
import { useStore } from "@/lib/store";
import { useMemo, useState } from "react";
import { CollapsibleSection, Paginator, paginateRecent } from "./CollapsibleSection";

import { outcomeColourHex } from "@/lib/thread-category";

type Props = {
  threadId: string;
};

const threadLogDotColors: Record<string, string> = {
  pulse: "bg-white/40",
  transition: "bg-fate",
  setup: "bg-amber-400",
  escalation: "bg-orange-400",
  payoff: "bg-emerald-400",
  twist: "bg-violet-400",
  callback: "bg-sky-400",
  resistance: "bg-red-500",
  stall: "bg-red-400/50",
};

// Shared hex palette for the log-type mix bar — matches dot colors above.
const LOG_TYPE_HEX: Record<ThreadLogNodeType, string> = {
  pulse: "#ffffff66",
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
  "payoff",
  "twist",
  "escalation",
  "setup",
  "resistance",
  "callback",
  "transition",
  "pulse",
  "stall",
];

// One-line reader-friendly definitions for every log type. Used in hover
// tooltips so the user learns the vocabulary while browsing.
const LOG_TYPE_GLOSS: Record<ThreadLogNodeType, string> = {
  pulse: "Attention without movement — the world view acknowledged this thread but the odds didn't shift.",
  transition: "Lifecycle state changed — the thread crossed a structural boundary.",
  setup: "A promise is being planted — future payoff telegraphed, odds nudge gently.",
  escalation: "Stakes rising — pressure mounts without yet resolving direction.",
  payoff: "A promise paid off — strong evidence, often closes the market toward an outcome.",
  twist: "The leader flipped — major shock, highest-information move you can see.",
  callback: "Past evidence re-activated — history being honored, modest probability shift.",
  resistance: "Something pushed back against the current direction — counter-evidence.",
  stall: "Nothing moved and it shows — thread is drifting, losing attention.",
};

// Rich, multi-line definitions for every market stat. These appear in the
// hover tooltip on each stat tile so the analyst can learn what they mean
// while reading the dashboard. Keep them self-contained — a reader new to
// the system should be able to understand any stat from its tooltip alone.
const STAT_GLOSS = {
  volume:
    "VOLUME — the cumulative narrative attention this market has earned.\n\nGrows when scenes touch it (volumeDelta); decays 10% each scene it's ignored. High volume = the world view keeps coming back to this. Below " +
    MARKET_ABANDON_VOLUME +
    " triggers abandonment.",
  uncertainty:
    "UNCERTAINTY — normalized entropy of the probability distribution, 0–100%.\n\n100% = every outcome equally likely (maximally contested). 0% = the market has decided. Read this as 'how much is still in play?'",
  volatility:
    "VOLATILITY (σ) — EWMA of recent evidence magnitude.\n\nHow hard the market has been shaken lately. A sudden twist spikes σ; a long quiet stretch decays it. High σ = the market is hot, expect more movement.",
  margin:
    "MARGIN (Δ) — log-odds gap between the top two outcomes.\n\nReads in natural-log units. Δ≈0 = tie. Δ≥" +
    MARKET_TAU_CLOSE +
    " with a payoff/twist of |evidence|≥3 triggers closure. Good shorthand for 'how decided is the leader?'",
  focus:
    "FOCUS — composite importance × sway score.\n\nvolume × entropy × (1 + volatility) × recency^gap. The portfolio sidebar orders by this. High focus = a market the world view is currently investing in AND is contested enough to still move.",
  gap:
    "GAP — scenes since the market last received evidence.\n\n∞ if never touched. Large gap + low volume → heading for abandonment. Large gap + high volume → dormant but potent; often a setup for a callback.",
};

// ── Horizon visibility ────────────────────────────────────────────────────
//
// Horizon is a STATED INTENT — the LLM (or operator) classifies a thread at
// open time as short / medium / long / epic. The thread can still outlive
// its horizon; we don't enforce, we surface. The badge shows the declared
// horizon; an adjacent "outlier" pill appears when the thread has lived
// longer than the typical span for its horizon.

const HORIZON_TYPICAL_MAX_SCENES: Record<NonNullable<Thread['horizon']>, number> = {
  short: 3,
  medium: 8,
  long: 24,
  epic: 96,
};

function ThreadHorizonBadge({ thread, narrative }: { thread: Thread; narrative: NarrativeState }) {
  const horizon = thread.horizon ?? 'medium';
  const sceneCount = computeThreadSceneCount(thread, narrative.scenes);
  const expectedMax = HORIZON_TYPICAL_MAX_SCENES[horizon];
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 cursor-help font-mono"
      title={`horizon: ${horizon} — structural distance from any scene to this thread's resolution.\n\nshort  ~ 2-3 scenes (immediate trust, fight outcome)\nmedium ~ within an arc, 4-8 scenes (sect rivalry)\nlong   ~ multi-arc, segment-spanning (faction war)\nepic   ~ series-spanning / open-ended (eternal life)\n\nDrives evidence-magnitude attenuation. Long/epic threads only fire small directional pulses on routine wins; reserve full magnitude for structural pivots that re-shape the resolution path.\n\nThis thread has lived ${sceneCount} scene${sceneCount === 1 ? '' : 's'} (typical max for ${horizon}: ~${expectedMax}). Threads can outlive their horizon — the field is descriptive, not enforced.`}
    >
      {horizon}
    </span>
  );
}

function computeThreadSceneCount(thread: Thread, scenes: NarrativeState['scenes']): number {
  let count = 0;
  for (const sceneId of Object.keys(scenes)) {
    const scene = scenes[sceneId];
    if (!scene) continue;
    if ((scene.threadDeltas ?? []).some((td) => td.threadId === thread.id)) count++;
  }
  return count;
}

// ── Stat tile — a labeled value with a rich hover definition ───────────────

function StatTile({
  label,
  value,
  hint,
  delta,
  deltaTone,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  delta?: string;
  deltaTone?: "up" | "down" | "flat";
  accent?: string;
}) {
  const deltaColor =
    deltaTone === "up" ? "#34d399" : deltaTone === "down" ? "#fb7185" : "var(--color-text-dim)";
  return (
    <div
      className="flex flex-col gap-0.5 rounded-md border border-white/5 bg-white/2 px-2 py-1.5 cursor-help"
      title={hint}
    >
      <span className="text-[9px] uppercase tracking-wider text-text-dim">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-sm font-mono tabular-nums"
          style={{ color: accent ?? "var(--color-text-primary)" }}
        >
          {value}
        </span>
        {delta && (
          <span
            className="text-[10px] font-mono tabular-nums"
            style={{ color: deltaColor }}
          >
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Log-type mix bar — distribution of event types across thread lifetime ──

function LogTypeMixBar({
  counts,
  total,
}: {
  counts: Record<ThreadLogNodeType, number>;
  total: number;
}) {
  if (total === 0) return null;
  const segments = LOG_TYPE_ORDER.filter((t) => counts[t] > 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className="text-[9px] uppercase tracking-wider text-text-dim cursor-help"
          title={
            "EVIDENCE MIX — how this market has moved across its lifetime.\n\n" +
            "Every scene emits a log type. The shape of this bar tells you the market's signature: payoff-heavy = decisive, twist-heavy = volatile, pulse-heavy = maintained but slow-moving."
          }
        >
          Evidence mix
        </span>
        <span className="text-[9px] text-text-dim/70 font-mono tabular-nums ml-auto">
          {total} events
        </span>
      </div>
      <div className="h-1.5 w-full flex rounded-full overflow-hidden bg-white/5">
        {segments.map((t) => {
          const pct = (counts[t] / total) * 100;
          return (
            <div
              key={t}
              title={`${t} × ${counts[t]} (${pct.toFixed(0)}%)\n\n${LOG_TYPE_GLOSS[t]}`}
              className="cursor-help h-full"
              style={{ width: `${pct}%`, background: LOG_TYPE_HEX[t] }}
            />
          );
        })}
      </div>
      {/* Tiny legend — shows only the segments present, with count & label */}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px]">
        {segments.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 text-text-dim cursor-help"
            title={LOG_TYPE_GLOSS[t]}
          >
            <span
              className="h-1.5 w-1.5 rounded-sm"
              style={{ background: LOG_TYPE_HEX[t] }}
            />
            <span className="capitalize">{t}</span>
            <span className="font-mono tabular-nums text-text-dim/70">
              {counts[t]}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Closure-proximity gauge — how close to the τ threshold this market is ──

function SaturationGauge({ margin }: { margin: number }) {
  const pct = Math.min(100, (Math.abs(margin) / MARKET_TAU_CLOSE) * 100);
  const near = pct >= 66;
  const ready = pct >= 100;
  const color = ready ? "#34d399" : near ? "#fbbf24" : "#64748b";
  const label = ready ? "Ready to close" : near ? "Saturating" : "In play";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span
          className="text-[9px] uppercase tracking-wider text-text-dim cursor-help"
          title={
            "CLOSURE PROXIMITY — how close |margin| is to the τ threshold (" +
            MARKET_TAU_CLOSE +
            ").\n\nAt 100%, the next payoff/twist with |evidence|≥3 can officially close the market. Under 66% = still in genuine play. Above 66% = the world view is committing — expect a payoff soon."
          }
        >
          Closure proximity
        </span>
        <span
          className="text-[10px] font-mono tabular-nums"
          style={{ color }}
        >
          {pct.toFixed(0)}%
        </span>
        <span
          className="text-[9px] ml-auto"
          style={{ color }}
        >
          {label}
        </span>
      </div>
      <div
        className="h-1 w-full rounded-full bg-white/5 overflow-hidden cursor-help"
        title={`|margin| ${Math.abs(margin).toFixed(2)} / τ ${MARKET_TAU_CLOSE} = ${pct.toFixed(0)}%`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function ThreadDetail({ threadId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [logPage, setLogPage] = useState(0);
  const [scenesPage, setScenesPage] = useState(0);

  const thread = narrative?.threads[threadId];

  // Market-derived category per thread.
  const currentCategory = useMemo(
    () => (thread ? classifyThreadCategory(thread) : 'dormant'),
    [thread],
  );

  // Progressive reveal: thread log nodes visible at current scene index
  const visibleLog = useMemo(() => {
    if (!narrative || !thread) return { nodes: [], edges: [] };
    return getThreadLogAtScene(
      thread.threadLog ?? { nodes: {}, edges: [] },
      threadId,
      narrative.scenes,
      state.resolvedEntryKeys,
      state.viewState.currentSceneIndex,
    );
  }, [
    narrative,
    thread,
    threadId,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  ]);

  // Probability trajectory replayed scene-by-scene up to the current index —
  // the "up to scene" history that powers the sparkline + current distribution.
  const trajectory = useMemo(() => {
    if (!narrative) return [];
    return buildThreadTrajectory(
      narrative,
      threadId,
      state.resolvedEntryKeys.slice(0, state.viewState.currentSceneIndex + 1),
    );
  }, [
    narrative,
    threadId,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  ]);

  if (!narrative || !thread) return null;

  // Resolve anchor names
  const anchors = (thread.participants ?? []).map((a) => ({
    ...a,
    name:
      a.type === "character"
        ? (narrative.characters[a.id]?.name ?? a.id)
        : (narrative.locations[a.id]?.name ?? a.id),
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Thread ID badge + description */}
      <div className="flex flex-col gap-1">
        <span className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-dim self-start">
          {thread.id}
        </span>
        <p className="text-sm text-text-primary">{thread.description}</p>
      </div>

      {/* Category + kind + horizon + bandwidth */}
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] uppercase tracking-widest cursor-help ${THREAD_CATEGORY_TEXT[currentCategory]}`}
          title={`${THREAD_CATEGORY_LABEL[currentCategory].toUpperCase()} — ${THREAD_CATEGORY_DESCRIPTION[currentCategory]}\n\nCategory is derived from volume + entropy + volatility + gap. It's the single-word summary of the market's current state.`}
        >
          {THREAD_CATEGORY_LABEL[currentCategory]}
        </span>
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded-full cursor-help ${
            classifyThreadKind(thread, narrative.scenes) === "storyline"
              ? "bg-blue-500/15 text-blue-400"
              : "bg-amber-500/15 text-amber-400"
          }`}
          title={
            classifyThreadKind(thread, narrative.scenes) === "storyline"
              ? "STORYLINE — a long-running thread spanning multiple arcs. Think season-arc questions."
              : "INCIDENT — a short-lived thread, usually resolved within 1–2 arcs. Think episode-of-the-week."
          }
        >
          {classifyThreadKind(thread, narrative.scenes)}
        </span>
        <ThreadHorizonBadge thread={thread} narrative={narrative} />
        {(() => {
          const { touched, total } = computeBranchArcCoverage(
            threadId,
            narrative.scenes,
            state.resolvedEntryKeys,
          );
          return (
            <span
              className="text-[9px] text-text-dim font-mono ml-auto cursor-help"
              title="ACTIVE ARCS — how many arcs on this branch have touched this thread.\n\nA thread that only appears in 1 arc is localized; one appearing in many arcs is load-bearing for the world view's structure."
            >
              {touched}/{total} arcs
            </span>
          );
        })()}
      </div>

      {/* Market — up-to-scene probability distribution + trajectory */}
      {(() => {
        const tailPoint =
          trajectory.length > 0 ? trajectory[trajectory.length - 1] : null;
        const tailProbs = tailPoint ? tailPoint.probs : getMarketProbs(thread);
        const tailOutcomes = tailPoint ? tailPoint.outcomes : thread.outcomes;
        // Colour-key the outcomes off the LIVE narrative state's ordering
        // (`thread.outcomes`) so the inspector and the portfolio bar always
        // paint the same outcome with the same hue. The trajectory and the
        // store-replayed thread may diverge in outcome ORDER if their
        // addOutcomes-application paths disagree subtly; matching by name
        // sidesteps that — the colour follows the outcome string, not its
        // position in whichever array. Probs still come from the trajectory
        // tail (so 100%-sum is preserved across mid-narrative expansions);
        // tail-only outcomes (not yet in the live thread) fall through to
        // their tail index.
        const liveIdxByName = new Map<string, number>();
        thread.outcomes.forEach((o, i) => liveIdxByName.set(o, i));
        const belief = getMarketBelief(thread);
        const { margin } = getMarketMargin(thread);
        const currentEntropy = normalizedEntropy(tailProbs);
        const ranked = tailOutcomes
          .map((outcome, idx) => ({
            outcome,
            idx,
            colourIdx: liveIdxByName.get(outcome) ?? idx,
            prob: tailProbs[idx] ?? 0,
          }))
          .sort((a, b) => b.prob - a.prob);
        const topIdx = ranked[0]?.idx ?? 0;
        const catColor = `var(--color-fate)`;
        const isClosed =
          thread.closedAt !== undefined && thread.closeOutcome !== undefined;

        // ── Secondary derived stats ────────────────────────────────────────
        // Focus score — composite importance × sway (portfolio ranking key).
        const focus = focusScore(
          thread,
          state.resolvedEntryKeys,
          state.viewState.currentSceneIndex,
        );
        // Gap — scenes since the market last received evidence.
        const gap = scenesSinceTouched(
          thread,
          state.resolvedEntryKeys,
          state.viewState.currentSceneIndex,
        );
        // Movement over the last LOOKBACK scenes — leader Δprob, Δvol.
        const LOOKBACK = 5;
        const priorPoint =
          trajectory.length > LOOKBACK
            ? trajectory[trajectory.length - 1 - LOOKBACK]
            : trajectory[0] ?? null;
        const priorTopProb = priorPoint ? priorPoint.probs[topIdx] ?? 0 : 0;
        const priorVolume = priorPoint?.volume ?? 0;
        const priorEntropy = priorPoint?.entropy ?? currentEntropy;
        const deltaTopProb = tailPoint
          ? (tailPoint.probs[topIdx] ?? 0) - priorTopProb
          : 0;
        const deltaVolume = tailPoint ? (tailPoint.volume ?? 0) - priorVolume : 0;
        const deltaEntropy = tailPoint ? currentEntropy - priorEntropy : 0;
        // Evidence-type mix — aggregate counts across the thread log.
        const logCounts: Record<ThreadLogNodeType, number> = {
          pulse: 0,
          transition: 0,
          setup: 0,
          escalation: 0,
          payoff: 0,
          twist: 0,
          callback: 0,
          resistance: 0,
          stall: 0,
        };
        for (const node of Object.values(thread.threadLog?.nodes ?? {})) {
          if (node.type in logCounts) logCounts[node.type as ThreadLogNodeType]++;
        }
        const logTotal = Object.values(logCounts).reduce((a, b) => a + b, 0);

        const fmtDelta = (n: number, digits = 2) =>
          `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
        const tone = (n: number): "up" | "down" | "flat" =>
          Math.abs(n) < 1e-3 ? "flat" : n > 0 ? "up" : "down";

        return (
          <div className="flex flex-col gap-3 rounded-lg border border-white/5 bg-white/1.5 p-3">
            {/* Ranked outcomes with probability bars */}
            <ul className="flex flex-col gap-1.5">
              {ranked.map(({ outcome, idx, colourIdx, prob }) => {
                const color = outcomeColourHex(colourIdx);
                const isWinner = isClosed && thread.closeOutcome === idx;
                const logit = belief?.logits[idx] ?? 0;
                return (
                  <li key={`${outcome}-${idx}`} className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-sm shrink-0"
                        style={{ background: color }}
                      />
                      <span
                        className={`text-xs flex-1 wrap-break-word min-w-0 leading-snug ${isWinner ? "text-text-primary font-medium" : "text-text-secondary"}`}
                        title={`${outcome}\n\nprobability ${Math.round(prob * 100)}% · logit ${logit.toFixed(2)}\n\nThe logit is the raw log-odds behind the probability. Evidence +e shifts it by e / 2; softmax renormalizes to the probability.`}
                      >
                        {outcome}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-text-primary cursor-help"
                        title={`logit ${logit.toFixed(2)} → probability ${(prob * 100).toFixed(1)}%`}
                      >
                        {Math.round(prob * 100)}%
                      </span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full"
                        style={{
                          width: `${prob * 100}%`,
                          background: color,
                          opacity: ranked[0].idx === idx ? 1 : 0.55,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Primary market stats — six-tile grid with rich tooltips */}
            <div className="grid grid-cols-3 gap-1.5">
              <StatTile
                label="Volume"
                value={(belief?.volume ?? 0).toFixed(1)}
                delta={deltaVolume !== 0 ? fmtDelta(deltaVolume, 1) : undefined}
                deltaTone={tone(deltaVolume)}
                hint={STAT_GLOSS.volume}
              />
              <StatTile
                label="Uncertainty"
                value={`${Math.round(currentEntropy * 100)}%`}
                delta={
                  Math.abs(deltaEntropy) >= 0.005
                    ? `${fmtDelta(deltaEntropy * 100, 0)}pp`
                    : undefined
                }
                deltaTone={tone(-deltaEntropy)}
                hint={STAT_GLOSS.uncertainty}
              />
              <StatTile
                label="Volatility"
                value={`σ ${(belief?.volatility ?? 0).toFixed(2)}`}
                hint={STAT_GLOSS.volatility}
              />
              <StatTile
                label="Margin"
                value={`Δ ${margin.toFixed(2)}`}
                hint={STAT_GLOSS.margin}
              />
              <StatTile
                label="Focus"
                value={
                  focus >= 10
                    ? focus.toFixed(1)
                    : focus >= 1
                      ? focus.toFixed(2)
                      : focus.toFixed(3)
                }
                hint={STAT_GLOSS.focus}
                accent={focus > 0 ? "#fbbf24" : undefined}
              />
              <StatTile
                label="Gap"
                value={Number.isFinite(gap) ? `${gap} scn` : "—"}
                hint={STAT_GLOSS.gap}
                accent={
                  Number.isFinite(gap) && gap >= 8 ? "#fb7185" : undefined
                }
              />
            </div>

            {/* Movement band — headline change over the last LOOKBACK scenes */}
            {trajectory.length > 1 && (
              <div
                className="flex items-center gap-3 text-[10px] rounded-md bg-white/2 border border-white/5 px-2 py-1.5 cursor-help"
                title={`MOVEMENT — change in the leading outcome vs. ${LOOKBACK} scenes ago.\n\n"${ranked[0]?.outcome}" moved from ${Math.round(priorTopProb * 100)}% to ${Math.round((tailPoint?.probs[topIdx] ?? 0) * 100)}%. Volume ${priorVolume.toFixed(1)} → ${(tailPoint?.volume ?? 0).toFixed(1)}.\n\nUse this to tell whether the market is actively moving or has stalled.`}
              >
                <span className="text-text-dim uppercase tracking-wider">
                  Last {Math.min(LOOKBACK, trajectory.length - 1)} scn
                </span>
                <span className="flex items-baseline gap-1">
                  <span className="text-text-dim">top</span>
                  <span
                    className="font-mono tabular-nums"
                    style={{
                      color:
                        Math.abs(deltaTopProb) < 0.005
                          ? "var(--color-text-dim)"
                          : deltaTopProb > 0
                            ? "#34d399"
                            : "#fb7185",
                    }}
                  >
                    {deltaTopProb >= 0 ? "▲" : "▼"}
                    {Math.abs(deltaTopProb * 100).toFixed(1)}%
                  </span>
                </span>
                <span className="flex items-baseline gap-1">
                  <span className="text-text-dim">vol</span>
                  <span
                    className="font-mono tabular-nums"
                    style={{
                      color:
                        Math.abs(deltaVolume) < 0.05
                          ? "var(--color-text-dim)"
                          : deltaVolume > 0
                            ? "#34d399"
                            : "#fb7185",
                    }}
                  >
                    {fmtDelta(deltaVolume, 1)}
                  </span>
                </span>
                <span className="flex items-baseline gap-1 ml-auto">
                  <span className="text-text-dim">H</span>
                  <span
                    className="font-mono tabular-nums"
                    style={{
                      color:
                        Math.abs(deltaEntropy) < 0.005
                          ? "var(--color-text-dim)"
                          : deltaEntropy < 0
                            ? "#34d399"
                            : "#fb7185",
                    }}
                  >
                    {fmtDelta(deltaEntropy * 100, 0)}pp
                  </span>
                </span>
              </div>
            )}

            {/* Closure-proximity gauge */}
            {!isClosed && <SaturationGauge margin={margin} />}

            {/* Evidence-type distribution across thread log */}
            {logTotal > 0 && <LogTypeMixBar counts={logCounts} total={logTotal} />}

            {/* Resolution footer */}
            {isClosed && (
              <div className="text-[10px] text-text-dim pt-1 border-t border-white/5">
                Closed at{" "}
                <span className="font-mono text-text-secondary">
                  {thread.closedAt}
                </span>{" "}
                → <span style={{ color: catColor }}>
                  {thread.outcomes[thread.closeOutcome ?? 0]}
                </span>
                {thread.resolutionQuality !== undefined && (
                  <>
                    {" · quality "}
                    <span
                      className="font-mono tabular-nums text-text-secondary cursor-help"
                      title="RESOLUTION QUALITY — how earned the closure felt.\n\nFactors: volatility-adjusted lead, recency of contested state, how often the winning outcome held first place. Higher = the world view built to this; lower = the outcome arrived without enough evidence."
                    >
                      {Math.round(thread.resolutionQuality * 100)}%
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Thread Log — progressive-reveal paginated list */}
      {visibleLog.nodes.length > 0 &&
        (() => {
          const { pageItems, totalPages, safePage } = paginateRecent(
            visibleLog.nodes,
            logPage,
          );
          return (
            <CollapsibleSection
              title="Thread Log"
              count={visibleLog.nodes.length}
              defaultOpen
            >
              <ul className="flex flex-col gap-1">
                {pageItems.map((node, i) => (
                  <li
                    key={`${node.id}-${i}`}
                    className="flex items-start gap-2"
                  >
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${threadLogDotColors[node.type] ?? "bg-white/40"}`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: {
                            type: "threadLog",
                            threadId,
                            nodeId: node.id,
                          },
                        })
                      }
                      className="text-xs text-text-primary hover:text-white transition-colors text-left"
                    >
                      {node.content}
                    </button>
                  </li>
                ))}
              </ul>
              <Paginator
                page={safePage}
                totalPages={totalPages}
                onPage={setLogPage}
              />
            </CollapsibleSection>
          );
        })()}

      {/* Scenes — derived from scene.threadDeltas, up to current index */}
      {(() => {
        const sceneKeysUpToCurrent = state.resolvedEntryKeys.slice(
          0,
          state.viewState.currentSceneIndex + 1,
        );
        const sceneTouches = sceneKeysUpToCurrent
          .map((k) => narrative.scenes[k])
          .filter(
            (s) =>
              s && s.threadDeltas.some((tm) => tm.threadId === threadId),
          )
          .map((s) => ({
            sceneId: s.id,
            deltas: s.threadDeltas.filter(
              (tm) => tm.threadId === threadId,
            ),
          }));
        if (sceneTouches.length === 0) return null;
        const { pageItems, totalPages, safePage } = paginateRecent(
          sceneTouches,
          scenesPage,
        );
        return (
          <CollapsibleSection title="Scenes" count={sceneTouches.length}>
            <ul className="flex flex-col gap-1.5">
              {pageItems.map(({ sceneId, deltas }) => (
                <li key={sceneId} className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: { type: "scene", sceneId },
                      })
                    }
                    className="text-left font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary"
                  >
                    {sceneId}
                  </button>
                  {deltas.map((tm, tmIdx) => (
                    <span
                      key={`${tm.threadId}-${tmIdx}`}
                      className={`text-xs cursor-help ${tm.logType === 'pulse' || tm.logType === 'stall' ? "text-text-dim" : "text-fate"}`}
                      title={`${tm.logType.toUpperCase()} — ${LOG_TYPE_GLOSS[tm.logType as ThreadLogNodeType] ?? ''}\n\nEvidence is signed and in [−4, +4]. Each +e shifts that outcome's logit by e / 2; softmax renormalizes to probabilities. |e|≥3 is a decisive move.`}
                    >
                      [{tm.logType}] {(tm.updates ?? []).map((u) => `${u.outcome}${u.evidence >= 0 ? '+' : ''}${u.evidence}`).join(' ')}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <Paginator
              page={safePage}
              totalPages={totalPages}
              onPage={setScenesPage}
            />
          </CollapsibleSection>
        );
      })()}

      {/* Anchors */}
      <div className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
          {anchors.length === 0 ? "General Thread" : "Anchors"}
        </h3>
        {anchors.map((a, i) => (
          <button
            key={`${a.id}-${i}`}
            type="button"
            onClick={() =>
              dispatch({
                type: "SET_INSPECTOR",
                context:
                  a.type === "character"
                    ? { type: "character", characterId: a.id }
                    : { type: "location", locationId: a.id },
              })
            }
            className="text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            <span className="text-[10px] text-text-dim mr-1">{a.type}</span>
            {a.name}
          </button>
        ))}
      </div>

      {/* Connected Threads — bidirectional: what this thread converges with + what depends on it */}
      {(() => {
        const convergesWith = thread.dependents.filter(
          (id) => narrative.threads[id],
        );
        const dependedOnBy = Object.values(narrative.threads).filter(
          (t) => t.id !== threadId && t.dependents.includes(threadId),
        );
        if (convergesWith.length === 0 && dependedOnBy.length === 0)
          return null;
        return (
          <div className="flex flex-col gap-2">
            {convergesWith.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                  Converges With
                </h3>
                <ul className="flex flex-col gap-1">
                  {convergesWith.map((depId) => (
                    <li key={depId}>
                      <button
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: "SET_INSPECTOR",
                            context: { type: "thread", threadId: depId },
                          })
                        }
                        className="text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
                      >
                        <span className="font-mono text-[10px] text-text-dim mr-1">
                          {depId}
                        </span>
                        {narrative.threads[depId]?.description}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {dependedOnBy.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                  Connected From
                </h3>
                <ul className="flex flex-col gap-1">
                  {dependedOnBy.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: "SET_INSPECTOR",
                            context: { type: "thread", threadId: t.id },
                          })
                        }
                        className="text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
                      >
                        <span className="font-mono text-[10px] text-text-dim mr-1">
                          {t.id}
                        </span>
                        {t.description}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
