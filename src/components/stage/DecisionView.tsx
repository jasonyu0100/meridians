"use client";

/**
 * DecisionView — scene-level game-theoretic analysis.
 *
 * Renders the scene as a vertical timeline of NxM decision matrices derived
 * from its beat plan, with analysis prose beside each matrix. Purely additive:
 * reads scene.gameAnalysis, never mutates scene deltas.
 *
 * Generation is controlled from the StagePalette (Generate / Clear / Auto),
 * matching the plan/prose pattern. This view listens for palette events.
 */

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/state/store";
import { EmptyState as SharedEmptyState } from "@/components/shared/EmptyState";
import { IconDice } from "@/components/icons";
import { generateSceneGameAnalysis } from "@/lib/ai";
import { useSceneBulkStream } from "@/lib/storage/bulk-stream-store";
import {
  arcCost,
  isSolo,
  nashEquilibria,
  outcomeAt,
  realizedIsNash,
  realizedOutcome,
  resolvePlayerName,
  stakeRank,
} from "@/lib/game-theory/game-theory";
import { GT_TIPS } from "@/lib/game-theory/game-theory-glossary";
import {
  ACTION_AXIS_LABELS,
  GAME_TYPE_LABELS,
} from "@/types/narrative";
import type {
  BeatGame,
  GameOutcome,
  NarrativeState,
  Scene,
  SceneGameAnalysis,
} from "@/types/narrative";

export function DecisionView({
  narrative,
  scene,
}: {
  narrative: NarrativeState;
  scene: Scene;
}) {
  const { state, dispatch } = useStore();
  const analysis = scene.gameAnalysis;
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branchId = state.viewState.activeBranchId;

  // Bulk game-analysis streaming — reasoning text accumulated globally
  // per-sceneId by the bulk-stream-store. Switching scenes mid-stream
  // shows the in-flight reasoning immediately rather than starting from
  // empty. `bulkActive` here mirrors the in-flight state of THIS scene's
  // entry only.
  const bulkGame = useSceneBulkStream(scene.id, "game");
  const reasoning = bulkGame.text;
  const bulkActive = bulkGame.active;

  // Either local Generate or Auto-mode processing this scene counts as streaming.
  const isStreaming = isGenerating || bulkActive;

  // ── Palette events — listen for generate/clear from StagePalette ────
  // Reasoning text is driven by useSceneBulkStream above; the dispatched
  // bulk events feed it (accumulated string per token). No direct
  // setReasoning calls needed in this component.
  useEffect(() => {
    async function handleGenerate() {
      if (isGenerating) return;
      setIsGenerating(true);
      setError(null);
      window.dispatchEvent(new CustomEvent('bulk:game-start', { detail: { sceneId: scene.id } }));
      try {
        const result = await generateSceneGameAnalysis(
          narrative,
          scene,
          undefined,
          (_token, accumulated) => {
            window.dispatchEvent(new CustomEvent('bulk:game-reasoning', { detail: { sceneId: scene.id, token: accumulated } }));
          },
        );
        dispatch({
          type: "SET_GAME_ANALYSIS",
          sceneId: scene.id,
          analysis: result,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        window.dispatchEvent(new CustomEvent('bulk:game-complete', { detail: { sceneId: scene.id } }));
        setIsGenerating(false);
      }
    }

    function handleClear() {
      dispatch({ type: "CLEAR_GAME_ANALYSIS", sceneId: scene.id });
      setError(null);
    }

    window.addEventListener("canvas:generate-game", handleGenerate);
    window.addEventListener("canvas:clear-game", handleClear);
    return () => {
      window.removeEventListener("canvas:generate-game", handleGenerate);
      window.removeEventListener("canvas:clear-game", handleClear);
    };
  }, [narrative, scene, branchId, dispatch, isGenerating]);

  // Clear local error when scene changes
  useEffect(() => {
    setError(null);
  }, [scene.id]);

  return (
    <div className="h-full w-full overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      <div className="w-full px-10 py-10">
        {isStreaming && !analysis && (
          <div className="max-w-2xl mx-auto px-8 pt-6 pb-32">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 border-2 border-sky-400/30 border-t-sky-400/80 rounded-full animate-spin" />
              <span className="text-[10px] text-text-dim">
                {bulkActive ? "Auto-analysing games..." : "Analysing games..."}
              </span>
            </div>
            {reasoning && (
              <p className="text-[11px] text-text-dim/60 leading-relaxed whitespace-pre-wrap">
                {reasoning}
              </p>
            )}
          </div>
        )}

        {isStreaming && analysis && (
          <div className="max-w-2xl mx-auto px-8 pt-6 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 border-2 border-sky-400/30 border-t-sky-400/80 rounded-full animate-spin" />
              <span className="text-[10px] text-text-dim">
                {bulkActive ? "Auto re-analysing..." : "Re-analysing..."}
              </span>
            </div>
            {reasoning && (
              <p className="text-[11px] text-text-dim/60 leading-relaxed whitespace-pre-wrap">
                {reasoning}
              </p>
            )}
          </div>
        )}

        {!analysis && !isStreaming && !error && <EmptyState />}

        {error && !isStreaming && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="gt-neg text-[12px] text-red-400/80">
              Analysis failed.
            </p>
            <p className="text-[10px] text-text-dim/75 max-w-md text-center leading-relaxed">
              {error}
            </p>
            <p className="text-[10px] text-text-dim/65">
              Use the palette below to retry.
            </p>
          </div>
        )}

        {analysis && <AnalysisTimeline analysis={analysis} narrative={narrative} regenerating={isStreaming} />}
      </div>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <SharedEmptyState
      icon={IconDice}
      title="No game analysis yet for this scene."
      hint="Use the palette below to generate one."
    />
  );
}

// ── Timeline — vertical sequence of matrices with analysis prose beside ────

function AnalysisTimeline({
  analysis,
  narrative,
  regenerating,
}: {
  analysis: SceneGameAnalysis;
  narrative: NarrativeState;
  regenerating: boolean;
}) {
  // Wrap each stored game with freshly-resolved player names so the timeline
  // always shows the current entity display names rather than the snapshot
  // taken at analysis time. Falls back to the stored name if the entity has
  // been deleted since.
  const games = analysis.games.map<BeatGame>((g) => ({
    ...g,
    playerAName: resolvePlayerName(narrative, g.playerAId, g.playerAName),
    playerBName: g.playerBId
      ? resolvePlayerName(narrative, g.playerBId, g.playerBName)
      : g.playerBName,
  }));
  return (
    <div>
      {/* Header */}
      <div className="border-b border-white/8 pb-4 mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[12px] uppercase tracking-[0.2em] text-text-dim/80 font-semibold">
            strategic decomposition
          </span>
          {regenerating && (
            <span className="text-[12px] text-sky-400/70 animate-pulse">
              regenerating…
            </span>
          )}
          <span className="text-[12px] text-text-dim/65 ml-auto tabular-nums">
            {games.length} {games.length === 1 ? "decision" : "decisions"}
          </span>
        </div>
        {analysis.summary && (
          <p className="text-[13px] text-text-secondary leading-relaxed">
            {analysis.summary}
          </p>
        )}
      </div>

      {/* Empty timeline */}
      {games.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <p className="text-[12px] text-text-dim/80">
            No decision beats found in this scene.
          </p>
          <p className="text-[10px] text-text-dim/65 max-w-md text-center leading-relaxed">
            Strategic analysis looks for beats where participants make meaningful
            choices. This scene&apos;s beats may be pure atmosphere or exposition.
          </p>
        </div>
      )}

      {/* Vertical timeline — entries stack directly with internal pb so the
          spine drawn inside each entry reaches the next node without a gap. */}
      <div className="flex flex-col">
        {games.map((game, i) => (
          <TimelineEntry
            key={`${game.beatIndex}-${i}`}
            game={game}
            index={i}
            isLast={i === games.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

// ── Single timeline entry: matrix on the left, analysis on the right ───────

function TimelineEntry({
  game,
  index,
  isLast,
}: {
  game: BeatGame;
  index: number;
  isLast: boolean;
}) {
  const solo = isSolo(game);
  // Solo decisions stack into a single column, so a fixed narrow width is enough.
  // Duel grids scale with the menu so big grids stay legible.
  const cols = game.playerBActions.length;
  const matrixWidthPx = solo ? 460 : Math.max(420, 140 + cols * 150);

  return (
    <div className={`relative flex gap-6 ${isLast ? "" : "pb-10"}`}>
      {!isLast && (
        <div className="absolute left-[13.5px] top-8 bottom-0 w-px bg-gradient-to-b from-white/15 to-white/5" />
      )}

      {/* Marker + index */}
      <div className="shrink-0 flex flex-col items-start pt-1">
        <div className="relative w-7 h-7 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-white/25" />
          <span className="relative text-[12px] font-mono font-semibold text-text-secondary">
            {index + 1}
          </span>
        </div>
      </div>

      {/* Entry body: matrix + analysis. Analysis is vertically centered
          relative to the matrix so big grids stay legible beside short
          analysis blocks. */}
      <div className="flex-1 flex gap-10 min-w-0 items-center">
        {/* Board — matrix for duel, single option-row for solo */}
        <div className="shrink-0" style={{ width: matrixWidthPx }}>
          {solo ? <SoloBoard game={game} /> : <MatrixBoard game={game} />}
        </div>

        {/* Analysis prose */}
        <div className="flex-1 min-w-0 max-w-2xl flex flex-col gap-3">
          <PlayersHeader game={game} />

          {/* Subtitle: beat index + game type + axis (hover for dichotomy) */}
          <div className="flex items-center gap-2 -mt-1 flex-wrap">
            <span className="text-[12px] uppercase tracking-wider text-text-dim/75">
              beat {game.beatIndex + 1}
            </span>
            <span className="text-text-dim/20">·</span>
            <span
              className="gt-sky text-[11px] font-mono font-medium text-sky-300/90 bg-sky-400/10 px-1.5 py-px rounded"
              title={solo ? "A 1-player decision — the actor chooses against the world, no opponent." : GAME_TYPE_LABELS[game.gameType] ?? ""}
            >
              {solo ? "1-player decision" : game.gameType}
            </span>
            <span
              className="text-[11px] font-mono font-medium text-text-dim/75 bg-white/5 px-1.5 py-px rounded"
              title={ACTION_AXIS_LABELS[game.actionAxis] ?? ""}
            >
              {game.actionAxis}
            </span>
          </div>

          {/* One-line copy explaining the strategic frame — names live in the
              pills above; only the descriptions go here to avoid repetition. */}
          <p className="text-[11px] text-text-dim/65 leading-snug -mt-2">
            {!solo && (
              <>
                <span>{GAME_TYPE_LABELS[game.gameType] ?? ""}</span>
                <span className="text-text-dim/30"> · </span>
              </>
            )}
            <span>{ACTION_AXIS_LABELS[game.actionAxis] ?? game.actionAxis}</span>
          </p>

          {game.beatExcerpt && (
            <p className="text-[12px] text-text-secondary leading-relaxed italic">
              {game.beatExcerpt}
            </p>
          )}

          {game.rationale && (
            <div title={GT_TIPS.rationaleRealized}>
              <div className="text-[12px] uppercase tracking-wider text-text-dim/80 font-semibold mb-1">
                why the author picked this cell
              </div>
              <p className="text-[12px] text-text-secondary leading-relaxed">
                {game.rationale}
              </p>
            </div>
          )}

          <StrategicShape game={game} />
        </div>
      </div>
    </div>
  );
}

function PlayersHeader({ game }: { game: BeatGame }) {
  const cell = realizedOutcome(game);
  const deltaA = cell?.stakeDeltaA ?? 0;
  const deltaB = cell?.stakeDeltaB ?? 0;
  const aWins = deltaA > deltaB;
  const bWins = deltaB > deltaA;

  const nameClass = (winner: boolean, loser: boolean): string => {
    if (winner) return "gt-pos text-emerald-300";
    if (loser) return "gt-neg text-red-400/80";
    return "text-text-secondary";
  };

  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  // Solo: one decider, one immediate outcome — reality is the other seat.
  if (isSolo(game)) {
    return (
      <div className="flex items-baseline gap-2 text-[13px]">
        <PlayerLink
          id={game.playerAId}
          name={game.playerAName}
          className={`font-semibold ${deltaA > 0 ? "gt-pos text-emerald-300" : deltaA < 0 ? "gt-neg text-red-400/80" : "text-text-secondary"}`}
        />
        <span
          className="font-mono text-[12px] text-text-dim/80 tabular-nums"
          title={GT_TIPS.stakeDeltaPair}
        >
          {fmt(deltaA)}
        </span>
        <span className="text-[12px] text-text-dim/55">vs the world</span>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-2 text-[13px]">
      <PlayerLink
        id={game.playerAId}
        name={game.playerAName}
        className={`font-semibold ${nameClass(aWins, bWins)}`}
      />
      <span
        className="font-mono text-[12px] text-text-dim/80 tabular-nums"
        title={GT_TIPS.stakeDeltaPair}
      >
        {fmt(deltaA)}&nbsp;/&nbsp;{fmt(deltaB)}
      </span>
      <PlayerLink
        id={game.playerBId ?? ""}
        name={game.playerBName ?? ""}
        className={`font-semibold ${nameClass(bWins, aWins)}`}
      />
    </div>
  );
}

/**
 * Clickable player name — opens the entity in the inspector panel.
 * Resolves kind (character/location/artifact) from the narrative registry;
 * falls back to plain text if the entity isn't in the registry (deleted).
 */
function PlayerLink({
  id,
  name,
  className,
}: {
  id: string;
  name: string;
  className?: string;
}) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const context = useMemo(() => {
    if (!narrative) return null;
    if (narrative.characters[id]) return { type: "character" as const, characterId: id };
    if (narrative.locations[id]) return { type: "location" as const, locationId: id };
    if (narrative.artifacts[id]) return { type: "artifact" as const, artifactId: id };
    return null;
  }, [narrative, id]);

  if (!context) {
    // Entity deleted or phantom — render as plain text, not a button
    return <span className={className}>{name}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => dispatch({ type: "SET_INSPECTOR", context })}
      className={`${className ?? ""} hover:underline underline-offset-[3px] decoration-1 cursor-pointer`}
      title={`Open ${name} in inspector`}
    >
      {name}
    </button>
  );
}

// ── Strategic shape — Nash count + realized-rank per player ────────────────
// Descriptive only. The realized cell can be off-Nash or low-rank; that is
// signal, not error — it's the author trading stake for arc.

function StrategicShape({ game }: { game: BeatGame }) {
  const solo = isSolo(game);
  const ne = useMemo(() => nashEquilibria(game), [game]);
  const isRealizedNash = realizedIsNash(game);
  const rankA = stakeRank(game, "A");
  const rankB = stakeRank(game, "B");
  const arcCostA = arcCost(game, "A");
  const arcCostB = arcCost(game, "B");

  return (
    <div>
      <div className="text-[12px] uppercase tracking-wider text-text-dim/80 font-semibold mb-1.5">
        strategic shape
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {ne.length > 0 ? (
          <span
            className="gt-sky text-[11px] px-1.5 py-0.5 rounded bg-sky-400/15 text-sky-300 font-mono uppercase"
            title={solo ? "The stake-maximising option — the rational pick against an indifferent world." : GT_TIPS.nashEquilibrium}
          >
            {solo
              ? (ne.length === 1 ? "best option" : `${ne.length} best`)
              : (ne.length === 1 ? "1 nash" : `${ne.length} nash`)}
          </span>
        ) : (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-text-dim/75 font-mono uppercase"
            title={GT_TIPS.noPureNash}
          >
            {solo ? "no clear best" : "no pure nash"}
          </span>
        )}
        {isRealizedNash && (
          <span
            className="gt-sky text-[11px] px-1.5 py-0.5 rounded bg-sky-400/10 text-sky-300 border border-sky-400/20"
            title={solo ? "The decider took the stake-maximising option." : GT_TIPS.realizedEqNash}
          >
            {solo ? "took the best" : "realized ≡ nash"}
          </span>
        )}
        {!isRealizedNash && ne.length > 0 && (
          <span
            className="gt-amber text-[11px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-300/80 border border-amber-400/20"
            title={solo ? "The decider passed up the stake-maximising option — arc over local stake." : GT_TIPS.offNash}
          >
            {solo ? "off-best option" : "off-nash cell"}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 text-[12px] text-text-dim/85">
        {rankA && (
          <div title={GT_TIPS.stakeRank}>
            <PlayerLink id={game.playerAId} name={game.playerAName} className="text-white font-medium" />
            <span className="text-text-dim/75">
              {solo
                ? `: picked the ${ordinal(rankA.rank)}-best of ${rankA.total} options`
                : `: got the ${ordinal(rankA.rank)}-best of ${rankA.total} possible outcomes`}
              {arcCostA > 0 && (
                <span className="gt-amber text-amber-300/85" title={GT_TIPS.arcCost}>
                  {" "}· left +{arcCostA} on the table
                </span>
              )}
            </span>
          </div>
        )}
        {rankB && game.playerBId && (
          <div title={GT_TIPS.stakeRank}>
            <PlayerLink id={game.playerBId} name={game.playerBName ?? game.playerBId} className="gt-sky text-sky-200 font-medium" />
            <span className="text-text-dim/75">
              : got the {ordinal(rankB.rank)}-best of {rankB.total} possible outcomes
              {arcCostB > 0 && (
                <span className="gt-amber text-amber-300/85" title={GT_TIPS.arcCost}>
                  {" "}· left +{arcCostB} on the table
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** "1st", "2nd", "3rd", ... for the stake-rank line. */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// ── Matrix board — dynamic NxM grid ────────────────────────────────────────

function MatrixBoard({ game }: { game: BeatGame }) {
  const nash = useMemo(() => {
    const set = new Set<string>();
    for (const p of nashEquilibria(game)) {
      set.add(`${p.aActionName}::${p.bActionName}`);
    }
    return set;
  }, [game]);

  return (
    <table
      className="border-collapse w-full rounded-lg overflow-hidden"
      style={{ borderSpacing: 0 }}
    >
      <thead>
        <tr>
          {/* Diagonal corner cell: B top-right, A bottom-left */}
          <th className="relative px-3 py-3 w-24 overflow-hidden">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "linear-gradient(to top right, transparent calc(50% - 0.5px), rgba(255,255,255,0.10) calc(50% - 0.5px), rgba(255,255,255,0.10) calc(50% + 0.5px), transparent calc(50% + 0.5px))",
              }}
            />
            <div className="relative flex flex-col items-end gap-2">
              <PlayerLink
                id={game.playerBId ?? ""}
                name={game.playerBName ?? ""}
                className="text-[12px] font-medium text-text-primary"
              />
              <div className="self-start">
                <PlayerLink
                  id={game.playerAId}
                  name={game.playerAName}
                  className="text-[12px] font-medium text-text-secondary"
                />
              </div>
            </div>
          </th>
          {game.playerBActions.map((action, i) => (
            <th key={`bh-${i}`} className="px-3 py-2 text-center">
              <AxisLabel text={action.name} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {game.playerAActions.map((aAction, aIdx) => (
          <tr key={`row-${aIdx}`}>
            <th className="px-2 py-2 text-right align-middle">
              <AxisLabel text={aAction.name} align="right" />
            </th>
            {game.playerBActions.map((bAction, bIdx) => {
              const outcome = outcomeAt(game, aAction.name, bAction.name);
              const key = `${aAction.name}::${bAction.name}`;
              const isNash = nash.has(key);
              const isRealized =
                aAction.name === game.realizedAAction &&
                bAction.name === game.realizedBAction;
              return (
                <Cell
                  key={`cell-${aIdx}-${bIdx}`}
                  outcome={outcome}
                  isNash={isNash}
                  isRealized={isRealized}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AxisLabel({
  text,
  align = "center",
}: {
  text: string;
  align?: "center" | "right";
}) {
  const justify = align === "right" ? "text-right" : "text-center";
  return (
    <div className={`text-[10px] text-text-primary leading-snug ${justify}`}>
      {text}
    </div>
  );
}

function Cell({
  outcome,
  isNash,
  isRealized,
}: {
  outcome: GameOutcome | null;
  isNash: boolean;
  isRealized: boolean;
}) {
  const cellBg = isRealized
    ? "bg-amber-400/10 ring-1 ring-inset ring-amber-400/40"
    : "bg-white/2";

  if (!outcome) {
    return (
      <td className={`relative px-4 py-4 align-top h-32 border-l border-t border-white/10 ${cellBg}`}>
        <p className="text-[11px] text-text-dim/50 italic">(outcome missing)</p>
      </td>
    );
  }

  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const deltaColor = (n: number) => {
    if (n > 0) return "gt-pos text-emerald-300";
    if (n < 0) return "gt-neg text-red-400/80";
    return "text-text-dim/70";
  };

  return (
    <td className={`relative px-4 py-4 align-top h-32 border-l border-t border-white/10 ${cellBg}`}>
      <div className="absolute top-1.5 right-1.5 flex gap-1">
        {isNash && (
          <span
            className="gt-sky text-[10px] font-semibold px-1 py-px rounded bg-sky-400/20 text-sky-200 uppercase tracking-wider"
            title={GT_TIPS.nashCell}
          >
            nash
          </span>
        )}
        {isRealized && (
          <span
            className="gt-amber text-[10px] font-semibold px-1 py-px rounded bg-amber-400/25 text-amber-200 uppercase tracking-wider"
            title={GT_TIPS.realizedCell}
          >
            realized
          </span>
        )}
      </div>

      {/* Stake deltas — signed, colored by sign. A first, B second. */}
      <div
        className="flex items-baseline gap-1.5 mb-1.5"
        title={GT_TIPS.stakeDeltaPair}
      >
        <span className={`text-[16px] font-mono font-bold leading-none tabular-nums ${deltaColor(outcome.stakeDeltaA)}`}>
          {fmt(outcome.stakeDeltaA)}
        </span>
        <span className="text-[12px] font-mono text-text-dim/65 leading-none">/</span>
        <span className={`text-[16px] font-mono font-bold leading-none tabular-nums ${deltaColor(outcome.stakeDeltaB ?? 0)}`}>
          {fmt(outcome.stakeDeltaB ?? 0)}
        </span>
      </div>
      <p className="text-[12px] text-text-dim/85 leading-snug">{outcome.description}</p>
    </td>
  );
}

// ── Solo board — a single row of option cells (1-player decision) ──────────
// No matrix: the decider faces a menu of options, each with one immediate
// outcome on the −4…+4 scale. Reality is the other seat. The chosen option is
// ringed; the stake-maximising option is marked "best".

function SoloBoard({ game }: { game: BeatGame }) {
  const best = useMemo(() => {
    const set = new Set<string>();
    for (const p of nashEquilibria(game)) set.add(p.aActionName);
    return set;
  }, [game]);

  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const deltaColor = (n: number) =>
    n > 0 ? "gt-pos text-emerald-300" : n < 0 ? "gt-neg text-red-400/80" : "text-text-dim/70";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <PlayerLink
          id={game.playerAId}
          name={game.playerAName}
          className="text-[12px] font-medium text-text-secondary"
        />
        <span className="text-[10px] uppercase tracking-wider text-text-dim/55">
          decides
        </span>
      </div>
      <div className="flex flex-col rounded-lg overflow-hidden border border-white/10">
        {game.playerAActions.map((opt, i) => {
          const outcome = outcomeAt(game, opt.name);
          const delta = outcome?.stakeDeltaA ?? 0;
          const isRealized = opt.name === game.realizedAAction;
          const isBest = best.has(opt.name);
          return (
            <div
              key={`opt-${i}`}
              className={`relative px-3 py-3 ${i > 0 ? "border-t border-white/10" : ""} ${
                isRealized
                  ? "bg-amber-400/10 ring-1 ring-inset ring-amber-400/40"
                  : "bg-white/2"
              }`}
            >
              <div className="absolute top-1.5 right-1.5 flex gap-1">
                {isBest && (
                  <span
                    className="gt-sky text-[10px] font-semibold px-1 py-px rounded bg-sky-400/20 text-sky-200 uppercase tracking-wider"
                    title="Stake-maximising option — the rational pick against an indifferent world."
                  >
                    best
                  </span>
                )}
                {isRealized && (
                  <span
                    className="gt-amber text-[10px] font-semibold px-1 py-px rounded bg-amber-400/25 text-amber-200 uppercase tracking-wider"
                    title={GT_TIPS.realizedCell}
                  >
                    chosen
                  </span>
                )}
              </div>
              <div className="text-[10px] text-text-primary leading-snug mb-1.5 pr-12">
                {opt.name}
              </div>
              <div
                className={`text-[16px] font-mono font-bold leading-none tabular-nums mb-1.5 ${deltaColor(delta)}`}
                title="Immediate outcome on the −4…+4 scale"
              >
                {fmt(delta)}
              </div>
              {outcome && (
                <p className="text-[11px] text-text-dim/85 leading-snug">
                  {outcome.description}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
