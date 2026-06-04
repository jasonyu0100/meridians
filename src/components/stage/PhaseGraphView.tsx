"use client";

/**
 * Phase Reasoning Graph (PRG) view — renders a phase graph with the same
 * dagre construction as the Causal Graph view, with phase-specific colors
 * and inspector context. Owns the generation flow (loading state +
 * streaming reasoning) so the StagePalette only dispatches an event;
 * mirrors the ScenePlanView pattern.
 */

import { useStore } from "@/lib/state/store";
import type { Phase, ReasoningGraphSnapshot } from "@/types/narrative";
import { PHASE_NODE_COLORS, REASONING_NODE_COLOR_UNKNOWN } from "@/lib/graph/reasoning-node-colors";
import { ReasoningGraphView } from "./ReasoningGraphView";
import { generatePhaseGraph } from "@/lib/ai/phase-graph";
import { nextId } from "@/lib/forces/narrative-utils";
import { logError } from "@/lib/core/system-logger";
import { useCallback, useEffect, useMemo, useState } from "react";

const resolveModeNodeColor = (type: string) => {
  return (PHASE_NODE_COLORS as Record<string, { fill: string; stroke: string; text: string }>)[type] ?? REASONING_NODE_COLOR_UNKNOWN;
};

type Props = {
  graph: Phase;
};

export function ModeView({ graph }: Props) {
  // Modes share the snapshot shape with reasoning graphs (same node /
  // edge fields). Adapt the PRG into the snapshot type the renderer expects.
  const adapted: ReasoningGraphSnapshot = useMemo(
    () => ({
      nodes: graph.nodes as unknown as ReasoningGraphSnapshot["nodes"],
      edges: graph.edges,
      arcName: graph.name ?? graph.summary,
      sceneCount: 0,
      summary: graph.summary,
    }),
    [graph],
  );

  // Memoised so its identity is stable across re-renders. Without useCallback
  // the inline arrow created a fresh reference each render → ReasoningGraphView's
  // handleNodeClick deps churned → its main render useEffect retriggered →
  // svg.call(zoom.transform, initialTransform) reset the pan/zoom on every
  // selection. Causal mode never passes this prop so it didn't surface there.
  const buildInspectorContext = useCallback(
    (nodeId: string) => ({ type: "mode" as const, phaseGraphId: graph.id, nodeId }),
    [graph.id],
  );

  return (
    <ReasoningGraphView
      graph={adapted}
      nodeColors={resolveModeNodeColor}
      buildInspectorContext={buildInspectorContext}
      inspectorContextType="mode"
      phaseGraphId={graph.id}
    />
  );
}

/**
 * Minimal empty state — matches the Plan empty placeholder convention:
 * terse two-line copy directing the user to the bottom palette.
 */
function ModeEmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
      <p className="text-[11px] text-text-dim">No phase graph active.</p>
      <p className="text-[10px] text-text-dim/40 max-w-md text-center">
        A PRG describes the world&apos;s meta machinery — economic underpinnings, generic patterns, institutional pulls. Use the palette below to generate one and trickle that body into causal, plan, and prose generation.
      </p>
    </div>
  );
}

/**
 * Loading state with streaming reasoning. Mirrors ScenePlanView's loading
 * UI: small spinner + label + the streaming reasoning text below.
 */
function ModeLoading({ reasoning }: { reasoning: string }) {
  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      <div className="max-w-2xl mx-auto px-8 pt-6 pb-32">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-3 h-3 border-2 border-emerald-400/30 border-t-emerald-400/80 rounded-full animate-spin" />
          <span className="text-[10px] text-text-dim">Generating phase graph...</span>
        </div>
        {reasoning && (
          <p className="text-[11px] text-text-dim/60 leading-relaxed whitespace-pre-wrap">
            {reasoning}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Wrapper rendered by the canvas when graphViewMode === 'mode'. Owns the
 * generation flow: listens for `canvas:phase-generate-submit` events,
 * tracks loading + streaming reasoning, dispatches the resulting PRG into
 * the store. The StagePalette only fires the event with guidance + basis.
 */
export function PhaseGraphView() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const activeId = narrative?.currentPhaseGraphId;
  const active = activeId ? narrative?.phaseGraphs?.[activeId] : undefined;

  const [isGenerating, setIsGenerating] = useState(false);
  const [reasoning, setReasoning] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset transient state when the active graph changes (e.g. after switch).
  useEffect(() => {
    setReasoning("");
    setError(null);
  }, [activeId]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<{ guidance?: string; basisId?: string }>).detail ?? {};
      if (!narrative || isGenerating) return;
      setIsGenerating(true);
      setReasoning("");
      setError(null);
      try {
        const basis = detail.basisId ? narrative.phaseGraphs?.[detail.basisId] : undefined;
        const draft = await generatePhaseGraph(
          narrative,
          state.resolvedEntryKeys,
          state.viewState.currentSceneIndex,
          {
            basedOn: basis,
            guidance: detail.guidance,
            onReasoning: (token) => setReasoning((prev) => prev + token),
          },
        );
        const id = nextId("PRG", Object.keys(narrative.phaseGraphs ?? {}));
        const fullGraph: Phase = { ...draft, id, createdAt: Date.now() };
        dispatch({ type: "ADD_PHASE_GRAPH", graph: fullGraph });
      } catch (err) {
        logError("Failed to generate phase graph", err, {
          source: "mode",
          operation: "mode-generate",
        });
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsGenerating(false);
      }
    };
    window.addEventListener("canvas:phase-generate-submit", handler);
    return () => window.removeEventListener("canvas:phase-generate-submit", handler);
  }, [narrative, isGenerating, state.resolvedEntryKeys, state.viewState.currentSceneIndex, dispatch]);

  if (isGenerating) return <ModeLoading reasoning={reasoning} />;
  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-[11px] text-red-400/80">{error}</p>
        <button
          onClick={() => setError(null)}
          className="text-[11px] px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-text-secondary hover:text-text-primary hover:bg-white/8 transition"
        >
          Dismiss
        </button>
      </div>
    );
  }
  if (!active || active.nodes.length === 0) return <ModeEmptyState />;
  return <ModeView graph={active} />;
}
