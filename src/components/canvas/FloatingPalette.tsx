"use client";

import {
  IconAutoLoop,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconEdit,
  IconFlask,
  IconList,
  IconRefresh,
  IconReset,
  IconSearch,
  IconSettings,
  IconTrash,
} from "@/components/icons";
import type { InspectorContext } from "@/types/narrative";
import { InvestigationComposerModal } from "@/components/sidebar/investigations/InvestigationComposerModal";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useStore } from "@/lib/store";
import { resolvePlanForBranch, resolveProseForBranch } from "@/lib/narrative-utils";
import SceneRangeSelector, { type SceneRange } from "@/components/timeline/SceneRangeSelector";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type FloatingPaletteProps = {
  isBulkActive?: boolean;
  isBulkAudioActive?: boolean;
  isExperimentationActive?: boolean;
};

export default function FloatingPalette({
  isBulkActive = false,
  isBulkAudioActive = false,
  isExperimentationActive = false,
}: FloatingPaletteProps) {
  const { state, dispatch } = useStore();
  const access = useFeatureAccess();
  const narrative = state.activeNarrative;
  const isActive = narrative !== null;

  const totalScenes = state.resolvedEntryKeys.length;
  const isHead = state.viewState.currentSceneIndex === totalScenes - 1 && totalScenes > 0;
  const activeBranch =
    narrative && state.viewState.activeBranchId
      ? narrative.branches[state.viewState.activeBranchId]
      : null;
  const headSceneId = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
  const headIsOwned = activeBranch
    ? activeBranch.entryIds.includes(headSceneId)
    : false;
  // Block deletion if this scene is used as a fork point by any other branch
  const headIsForkPoint = narrative
    ? Object.values(narrative.branches).some(
        (b) => b.id !== state.viewState.activeBranchId && b.forkEntryId === headSceneId,
      )
    : false;
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  // Shared range state for bulk auto buttons across plan/prose/game/audio
  // modes. Only one mode is visible at a time so a single state is enough,
  // and persisting across modes lets the user keep their selection while
  // jumping between bulk passes.
  const [bulkRange, setBulkRange] = useState<SceneRange>(null);
  // Investigation composer mount — opened from the reasoning palette's
  // Generate/Regenerate affordances. Pre-seeds the host arc.
  const [investigationComposerArcId, setInvestigationComposerArcId] = useState<
    string | null
  >(null);
  // Dropdown that lists all investigations on the current arc — opens above
  // the bottom pill when the active-investigation indicator is clicked.
  const [investigationListOpen, setInvestigationListOpen] = useState(false);

  // Resolve the current scene's arc + its investigation list once for the
  // reasoning palette controls (Generate / Regenerate / Clear / indicator).
  const currentArcInvestigationCtx = useMemo(() => {
    if (!narrative) return null;
    const sceneKey = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    const scene = sceneKey ? narrative.scenes[sceneKey] : null;
    const arcId = scene?.arcId;
    if (!arcId) return null;
    const arc = narrative.arcs[arcId];
    if (!arc) return null;
    const list = Object.values(narrative.investigations ?? {})
      .filter((inv) => inv.arcId === arcId)
      .sort((a, b) => a.createdAt - b.createdAt);
    const selectedId = state.viewState.selectedInvestigationId;
    const active = list.length > 0
      ? (list.find((inv) => inv.id === selectedId) ?? list[0])
      : null;
    const activeIndex = active ? list.findIndex((inv) => inv.id === active.id) : -1;
    return { arcId, arcName: arc.name, list, active, activeIndex };
  }, [
    narrative,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
    state.viewState.selectedInvestigationId,
  ]);

  const isAutoActive = !!state.viewState.autoRunState?.isRunning;
  const isAnyModeActive =
    isAutoActive || isBulkActive || isBulkAudioActive || isExperimentationActive;

  const handleDeleteHead = useCallback(() => {
    if (!narrative || !state.viewState.activeBranchId || !isHead) return;
    const headSceneId = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    if (!headSceneId) return;

    const branchesWithEntry = Object.values(narrative.branches).filter((b) =>
      b.entryIds.includes(headSceneId),
    );

    if (branchesWithEntry.length <= 1) {
      dispatch({
        type: "DELETE_SCENE",
        sceneId: headSceneId,
        branchId: state.viewState.activeBranchId,
      });
    } else {
      dispatch({
        type: "REMOVE_BRANCH_ENTRY",
        entryId: headSceneId,
        branchId: state.viewState.activeBranchId,
      });
    }
    setDeleteConfirm(false);
  }, [
    narrative,
    state.viewState.activeBranchId,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
    isHead,
    dispatch,
  ]);

  const graphViewMode = state.graphViewMode;
  const isEditingMode =
    graphViewMode === "plan" ||
    graphViewMode === "prose" ||
    graphViewMode === "audio" ||
    graphViewMode === "game";
  const isPhaseMode = graphViewMode === "mode";
  const isReasoningMode = graphViewMode === "reasoning";

  // ── Node navigation for graph modes (phase / reasoning) ──────────────
  // Resolves the active graph + selection from store state and exposes
  // first/prev/next callbacks. Returns null when no graph is active so
  // the palette can omit the nav controls entirely.
  const graphNodeNav = useMemo(() => {
    if (!narrative) return null;

    if (isPhaseMode) {
      const activeId = narrative.currentModeId;
      const graph = activeId ? narrative.modes?.[activeId] : null;
      if (!graph || graph.nodes.length === 0 || !activeId) return null;
      const sorted = [...graph.nodes].sort((a, b) => a.index - b.index);
      const ctx = state.viewState.inspectorContext;
      const selectedId = ctx?.type === "mode" && ctx.modeId === activeId ? ctx.nodeId : null;
      const selectedIdx = selectedId ? sorted.findIndex((n) => n.id === selectedId) : -1;
      const buildContext = (nodeId: string): InspectorContext => ({
        type: "mode",
        modeId: activeId,
        nodeId,
      });
      return { sortedNodes: sorted, selectedIdx, buildContext };
    }

    if (isReasoningMode) {
      const sceneKey = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
      const scene = sceneKey ? narrative.scenes[sceneKey] : null;
      const arcId = scene?.arcId ?? null;

      // Active investigation takes priority — same precedence as the canvas
      // renderer in WorldGraph. Fall back to legacy world-build / arc CRGs
      // when a historical narrative has them.
      if (arcId) {
        const arcInvestigations = Object.values(narrative.investigations ?? {})
          .filter((inv) => inv.arcId === arcId)
          .sort((a, b) => a.createdAt - b.createdAt);
        if (arcInvestigations.length > 0) {
          const selectedId = state.viewState.selectedInvestigationId;
          const active =
            arcInvestigations.find((inv) => inv.id === selectedId) ?? arcInvestigations[0];
          if (active.graph.nodes.length) {
            const sorted = [...active.graph.nodes].sort((a, b) => a.index - b.index);
            const ctx = state.viewState.inspectorContext;
            const ctxSelectedId =
              ctx?.type === "reasoning" && ctx.arcId === arcId ? ctx.nodeId : null;
            const selectedIdx = ctxSelectedId
              ? sorted.findIndex((n) => n.id === ctxSelectedId)
              : -1;
            const buildContext = (nodeId: string): InspectorContext => ({
              type: "reasoning",
              arcId,
              nodeId,
            });
            return { sortedNodes: sorted, selectedIdx, buildContext };
          }
        }
      }

      const worldBuild = sceneKey ? narrative.worldBuilds?.[sceneKey] : null;
      if (worldBuild?.reasoningGraph?.nodes.length) {
        const sorted = [...worldBuild.reasoningGraph.nodes].sort((a, b) => a.index - b.index);
        const ctx = state.viewState.inspectorContext;
        const selectedId =
          ctx?.type === "reasoning" && ctx.worldBuildId === worldBuild.id ? ctx.nodeId : null;
        const selectedIdx = selectedId ? sorted.findIndex((n) => n.id === selectedId) : -1;
        const buildContext = (nodeId: string): InspectorContext => ({
          type: "reasoning",
          worldBuildId: worldBuild.id,
          nodeId,
        });
        return { sortedNodes: sorted, selectedIdx, buildContext };
      }
      const arc = arcId ? narrative.arcs[arcId] : null;
      if (arc?.reasoningGraph?.nodes.length) {
        const sorted = [...arc.reasoningGraph.nodes].sort((a, b) => a.index - b.index);
        const ctx = state.viewState.inspectorContext;
        const selectedId =
          ctx?.type === "reasoning" && ctx.arcId === arc.id ? ctx.nodeId : null;
        const selectedIdx = selectedId ? sorted.findIndex((n) => n.id === selectedId) : -1;
        const buildContext = (nodeId: string): InspectorContext => ({
          type: "reasoning",
          arcId: arc.id,
          nodeId,
        });
        return { sortedNodes: sorted, selectedIdx, buildContext };
      }
      return null;
    }

    return null;
  }, [
    narrative,
    isPhaseMode,
    isReasoningMode,
    state.viewState.inspectorContext,
    state.viewState.currentSceneIndex,
    state.viewState.selectedInvestigationId,
    state.resolvedEntryKeys,
  ]);

  const navToGraphNodeIdx = useCallback(
    (idx: number) => {
      if (!graphNodeNav) return;
      if (idx < 0 || idx >= graphNodeNav.sortedNodes.length) return;
      dispatch({
        type: "SET_INSPECTOR",
        context: graphNodeNav.buildContext(graphNodeNav.sortedNodes[idx].id),
      });
    },
    [graphNodeNav, dispatch],
  );

  const navFirstGraphNode = useCallback(() => navToGraphNodeIdx(0), [navToGraphNodeIdx]);
  const navPrevGraphNode = useCallback(() => {
    if (!graphNodeNav) return;
    const cur = graphNodeNav.selectedIdx;
    navToGraphNodeIdx(cur <= 0 ? 0 : cur - 1);
  }, [graphNodeNav, navToGraphNodeIdx]);
  const navNextGraphNode = useCallback(() => {
    if (!graphNodeNav) return;
    const cur = graphNodeNav.selectedIdx;
    navToGraphNodeIdx(cur < 0 ? 0 : Math.min(cur + 1, graphNodeNav.sortedNodes.length - 1));
  }, [graphNodeNav, navToGraphNodeIdx]);

  // Branch context for version resolution
  const branchId = state.viewState.activeBranchId;
  const branches = useMemo(() => narrative?.branches ?? {}, [narrative?.branches]);

  // Current scene — for checking if rewrite is available
  const currentScene = useMemo(() => {
    if (!narrative) return null;
    const key = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    return key ? (narrative.scenes[key] ?? null) : null;
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  const hasPlan = useMemo(() => {
    if (!currentScene || !branchId) return false;
    return !!resolvePlanForBranch(currentScene, branchId, branches);
  }, [currentScene, branchId, branches]);

  const hasProse = useMemo(() => {
    if (!currentScene || !branchId) return false;
    return !!resolveProseForBranch(currentScene, branchId, branches).prose;
  }, [currentScene, branchId, branches]);

  // Plan extraction source gates whether the Generate Plan button is available.
  // In 'prose' mode the plan is reverse-engineered from existing prose, so
  // prose must exist for the button to do anything meaningful — disable it
  // otherwise to make the requirement visible.
  const planSource = narrative?.storySettings?.planExtractionSource ?? 'structure';
  const canGeneratePlan = planSource === 'structure' || hasProse;
  const generatePlanDisabledReason = !canGeneratePlan
    ? 'Plan extraction is set to "prose". Generate prose first — the plan will be reverse-engineered from it.'
    : undefined;

  const hasAudio = !!currentScene?.audioUrl;
  const wrapperClasses = isActive ? "" : "opacity-30 pointer-events-none";
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateText, setGenerateText] = useState("");
  const generateInputRef = useRef<HTMLTextAreaElement>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteText, setRewriteText] = useState("");
  const rewriteInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (generateOpen) setTimeout(() => generateInputRef.current?.focus(), 50);
    else setGenerateText("");
  }, [generateOpen]);

  useEffect(() => {
    if (rewriteOpen) setTimeout(() => rewriteInputRef.current?.focus(), 50);
    else setRewriteText("");
  }, [rewriteOpen]);

  const submitGenerate = useCallback(() => {
    const event =
      graphViewMode === "plan"
        ? "canvas:generate-plan"
        : "canvas:generate-prose";
    window.dispatchEvent(
      new CustomEvent(event, { detail: { guidance: generateText.trim() } }),
    );
    setGenerateOpen(false);
    setGenerateText("");
  }, [generateText, graphViewMode]);

  const submitRewrite = useCallback(() => {
    if (!rewriteText.trim()) return;
    const event =
      graphViewMode === "plan" ? "canvas:rewrite-plan" : "canvas:rewrite-prose";
    window.dispatchEvent(
      new CustomEvent(event, { detail: { guidance: rewriteText.trim() } }),
    );
    setRewriteOpen(false);
    setRewriteText("");
  }, [rewriteText, graphViewMode]);

  // ── Phase mode state ─────────────────────────────────────────────────
  // Generation work and loading UI live in ModeCanvas (mirroring the
  // ScenePlanView pattern); the palette only dispatches a submit event.
  type PhasePaletteMode = "idle" | "generate" | "history";
  const [phaseMode, setPhaseMode] = useState<PhasePaletteMode>("idle");
  const [phaseGuidance, setPhaseGuidance] = useState("");
  const [phaseBasisId, setPhaseBasisId] = useState<string | null>(null);
  const [phaseEditingNameFor, setPhaseEditingNameFor] = useState<string | null>(null);
  const [phaseNameDraft, setPhaseNameDraft] = useState("");
  const phaseGuidanceRef = useRef<HTMLTextAreaElement>(null);

  const modes = useMemo(
    () => Object.values(narrative?.modes ?? {}).sort((a, b) => b.createdAt - a.createdAt),
    [narrative?.modes],
  );
  const activePhaseId = narrative?.currentModeId;
  const activeMode = activePhaseId ? narrative?.modes?.[activePhaseId] : undefined;

  const phaseClose = useCallback(() => {
    setPhaseMode("idle");
    setPhaseGuidance("");
    setPhaseBasisId(null);
    setPhaseEditingNameFor(null);
    setPhaseNameDraft("");
  }, []);

  useEffect(() => {
    if (phaseMode === "generate") setTimeout(() => phaseGuidanceRef.current?.focus(), 50);
  }, [phaseMode]);

  // Empty-state CTA / external triggers can dispatch this to open the
  // generate overlay without selecting a basis.
  useEffect(() => {
    const handler = () => setPhaseMode("generate");
    window.addEventListener("canvas:phase-generate", handler);
    return () => window.removeEventListener("canvas:phase-generate", handler);
  }, []);

  const phaseSubmitGenerate = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("canvas:phase-generate-submit", {
        detail: {
          guidance: phaseGuidance.trim() || undefined,
          basisId: phaseBasisId ?? undefined,
        },
      }),
    );
    phaseClose();
  }, [phaseGuidance, phaseBasisId, phaseClose]);

  const phaseSetActive = useCallback((id: string | null) => {
    dispatch({ type: "SET_CURRENT_PHASE_GRAPH", modeId: id });
  }, [dispatch]);

  const phaseRenameGraph = useCallback((id: string, name: string) => {
    dispatch({ type: "RENAME_PHASE_GRAPH", modeId: id, name });
    setPhaseEditingNameFor(null);
    setPhaseNameDraft("");
  }, [dispatch]);

  const phaseDeleteGraph = useCallback((id: string) => {
    if (!window.confirm("Delete this phase graph? Arcs that referenced it lose their working-model anchor.")) return;
    dispatch({ type: "DELETE_PHASE_GRAPH", modeId: id });
  }, [dispatch]);

  // ── Phase mode palette — same chevrons + search + glass-pill convention
  //    as the editing palette below. Generate / Regenerate / Clear share
  //    the same icon language; clicking the active indicator opens history.
  if (isPhaseMode) {
    const activeLabel = activeMode
      ? (activeMode.name ?? activeMode.summary.slice(0, 28))
      : "No active phase";
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
        {/* Generate guidance overlay */}
        {phaseMode === "generate" && (
          <div className="w-96 flex flex-col rounded-xl glass overflow-hidden">
            <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-world">
                {phaseBasisId ? "Regenerate from basis" : "Generate Mode"}
              </span>
              <button onClick={phaseClose} className="text-[10px] text-text-dim/40 hover:text-text-dim transition">
                &times;
              </button>
            </div>
            <div className="p-3 space-y-2.5">
              {phaseBasisId && (
                <div className="text-[10px] text-text-dim/70">
                  Seeding from <span className="text-text-secondary">{narrative?.modes?.[phaseBasisId]?.name ?? narrative?.modes?.[phaseBasisId]?.summary.slice(0, 40) ?? phaseBasisId}</span>
                </div>
              )}
              <textarea
                ref={phaseGuidanceRef}
                value={phaseGuidance}
                onChange={(e) => setPhaseGuidance(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") phaseClose();
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) phaseSubmitGenerate();
                }}
                placeholder='Optional hypothesis... e.g. "the world is shifting from clan-rule toward sect-rule"'
                className="w-full h-20 bg-black/30 border border-border rounded text-[11px] text-text-secondary p-2 resize-none outline-none focus:border-violet-300/30 transition-colors placeholder:text-text-dim/30"
              />
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-text-dim/30">&#x2318;Enter to submit</span>
                <button
                  onClick={phaseSubmitGenerate}
                  className="text-[10px] px-3 py-1 rounded transition bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15"
                >
                  Generate
                </button>
              </div>
            </div>
          </div>
        )}

        {/* History overlay */}
        {phaseMode === "history" && (
          <div className="w-md max-h-[60vh] flex flex-col rounded-xl glass overflow-hidden">
            <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-text-secondary">Mode History</span>
              <button onClick={phaseClose} className="text-[10px] text-text-dim/40 hover:text-text-dim transition">
                &times;
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-white/5">
              {modes.length === 0 ? (
                <div className="p-4 text-[11px] text-text-dim text-center">No phase graphs generated yet.</div>
              ) : (
                modes.map((g) => {
                  const isActive = g.id === activePhaseId;
                  const isEditing = phaseEditingNameFor === g.id;
                  return (
                    <div key={g.id} className="px-3 py-2 flex items-start gap-2 group">
                      <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-emerald-400" : "bg-white/10"}`} />
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={phaseNameDraft}
                            onChange={(e) => setPhaseNameDraft(e.target.value)}
                            onBlur={() => phaseRenameGraph(g.id, phaseNameDraft.trim() || (g.name ?? "Untitled PRG"))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") phaseRenameGraph(g.id, phaseNameDraft.trim() || (g.name ?? "Untitled PRG"));
                              if (e.key === "Escape") { setPhaseEditingNameFor(null); setPhaseNameDraft(""); }
                            }}
                            className="w-full bg-black/30 border border-border rounded px-1.5 py-0.5 text-[11px] text-text-primary outline-none focus:border-violet-300/30 transition-colors"
                          />
                        ) : (
                          <button
                            onClick={() => { setPhaseEditingNameFor(g.id); setPhaseNameDraft(g.name ?? ""); }}
                            className="text-[12px] text-text-primary hover:text-text-secondary text-left truncate w-full"
                            title="Click to rename"
                          >
                            {g.name ?? g.summary.slice(0, 60)}
                          </button>
                        )}
                        <p className="text-[10px] text-text-dim/70 line-clamp-2 mt-0.5">{g.summary}</p>
                        <div className="flex items-center gap-3 mt-1 text-[9px] text-text-dim/60 font-mono tabular-nums">
                          <span>{g.nodes.length} nodes</span>
                          <span>{g.edges.length} edges</span>
                          <span>{new Date(g.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                          {g.basedOn && <span title="Seeded from a prior PRG">seeded</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!isActive && (
                          <button
                            onClick={() => phaseSetActive(g.id)}
                            className="text-[9px] px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"
                          >
                            Activate
                          </button>
                        )}
                        <button
                          onClick={() => { setPhaseBasisId(g.id); setPhaseMode("generate"); }}
                          className="text-[9px] px-2 py-1 rounded text-text-dim hover:text-text-secondary hover:bg-white/5"
                          title="Use as basis for a new PRG"
                        >
                          Basis
                        </button>
                        <button
                          onClick={() => phaseDeleteGraph(g.id)}
                          className="text-[9px] px-2 py-1 rounded text-rose-400/70 hover:text-rose-300 hover:bg-rose-500/10"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Pill — node nav + actions (no scene nav: phase graphs are
            scene-independent, so navigating between graph nodes is the
            primary affordance). */}
        <div className={`glass-pill px-3 py-1.5 flex items-center gap-2 ${wrapperClasses}`}>
          {graphNodeNav ? (
            <>
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors disabled:opacity-30"
                onClick={navPrevGraphNode}
                disabled={graphNodeNav.selectedIdx <= 0}
                aria-label="Previous node"
                title="Previous node"
              >
                <IconChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
                onClick={navFirstGraphNode}
                aria-label="Reset to first node"
                title="Reset to first node"
              >
                <IconReset size={12} />
              </button>
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors disabled:opacity-30"
                onClick={navNextGraphNode}
                disabled={graphNodeNav.selectedIdx >= graphNodeNav.sortedNodes.length - 1}
                aria-label="Next node"
                title="Next node"
              >
                <IconChevronRight size={14} />
              </button>
            </>
          ) : (
            <span className="text-[10px] font-mono text-text-dim/40 px-2">No graph</span>
          )}

          <div className="w-px h-4 bg-white/12 mx-1" />

          {/* Generate (text, world color) */}
          <button
            type="button"
            className={`text-xs font-semibold px-2 py-1 rounded-md transition-colors uppercase tracking-wider ${
              phaseMode === "generate"
                ? "text-world bg-world/20"
                : "text-world bg-world/10 hover:bg-world/20"
            }`}
            onClick={() => {
              setPhaseBasisId(null);
              setPhaseMode(phaseMode === "generate" ? "idle" : "generate");
            }}
            title="Generate a new phase graph from canon"
          >
            Generate
          </button>

          {/* Regenerate (only when active) — opens generate overlay seeded by active */}
          {activeMode && (
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
              onClick={() => { setPhaseBasisId(activeMode.id); setPhaseMode("generate"); }}
              aria-label="Regenerate from active basis"
              title="Regenerate using active as basis"
            >
              <IconRefresh size={14} />
            </button>
          )}

          {/* Clear (only when active) */}
          {activeMode && (
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
              onClick={() => phaseSetActive(null)}
              aria-label="Clear active phase"
              title="Clear active phase"
            >
              <IconClose size={14} />
            </button>
          )}

          <div className="w-px h-4 bg-white/12 mx-1" />

          {/* Active indicator — clickable; opens history overlay */}
          <button
            type="button"
            className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md transition-colors ${
              phaseMode === "history" ? "bg-white/10" : "hover:bg-white/6"
            }`}
            onClick={() => setPhaseMode(phaseMode === "history" ? "idle" : "history")}
            aria-label="Mode history"
            title={`Open history (${modes.length})`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${activeMode ? "bg-emerald-400" : "bg-white/15"}`} />
            <span className="text-text-dim truncate max-w-32">{activeLabel}</span>
            {modes.length > 0 && (
              <span className="text-[9px] text-text-dim/40 tabular-nums">{modes.length}</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Reasoning (investigation) graph palette — mirrors the mode graph
  //    palette: node nav, Generate (opens composer), Regenerate (seeds
  //    composer with current arc), Clear (deletes active investigation),
  //    and an active-investigation indicator showing N/M for the arc.
  if (isReasoningMode) {
    const arcCtx = currentArcInvestigationCtx;
    const activeInv = arcCtx?.active ?? null;
    const totalInv = arcCtx?.list.length ?? 0;
    const canCompose = !!arcCtx?.arcId;
    return (
      <>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
          {/* Investigation switcher overlay — opens above the pill when the
              user clicks the active-investigation indicator. Mirrors the
              mode graph's history overlay so the bottom pill stays the
              single source of switching. */}
          {investigationListOpen && arcCtx && arcCtx.list.length > 0 && (
            <div className="w-80 max-h-[40vh] flex flex-col rounded-xl glass overflow-hidden">
              <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-text-secondary">
                  Investigations · {arcCtx.arcName}
                </span>
                <button
                  onClick={() => setInvestigationListOpen(false)}
                  className="text-[10px] text-text-dim/40 hover:text-text-dim transition"
                >
                  &times;
                </button>
              </div>
              <div className="overflow-y-auto divide-y divide-white/5">
                {arcCtx.list.map((inv, idx) => {
                  const isActive = inv.id === activeInv?.id;
                  return (
                    <button
                      key={inv.id}
                      onClick={() => {
                        dispatch({ type: "SET_SELECTED_INVESTIGATION", investigationId: inv.id });
                        setInvestigationListOpen(false);
                      }}
                      className={`w-full px-3 py-2 flex items-start gap-2 text-left transition-colors ${
                        isActive ? "bg-white/6" : "hover:bg-white/4"
                      }`}
                    >
                      <span
                        className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                          isActive ? "bg-emerald-400" : "bg-white/15"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[10px] font-mono text-text-dim/60 shrink-0">
                            #{idx + 1}
                          </span>
                          <span className="text-[11px] text-text-primary truncate flex-1">
                            {inv.direction || inv.graph.summary || "(continuation)"}
                          </span>
                          {inv.source === "coordination-plan" && (
                            <span className="text-[9px] uppercase tracking-wider text-emerald-300/70 shrink-0">
                              plan
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-[9px] text-text-dim/50 font-mono tabular-nums">
                          <span>{inv.graph.nodes.length}n</span>
                          <span>{inv.graph.edges.length}e</span>
                          <span>{new Date(inv.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className={`glass-pill px-3 py-1.5 flex items-center gap-2 ${wrapperClasses}`}>
            {graphNodeNav ? (
              <>
                <button
                  type="button"
                  className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors disabled:opacity-30"
                  onClick={navPrevGraphNode}
                  disabled={graphNodeNav.selectedIdx <= 0}
                  aria-label="Previous node"
                  title="Previous node"
                >
                  <IconChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
                  onClick={navFirstGraphNode}
                  aria-label="Reset to first node"
                  title="Reset to first node"
                >
                  <IconReset size={12} />
                </button>
                <button
                  type="button"
                  className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors disabled:opacity-30"
                  onClick={navNextGraphNode}
                  disabled={graphNodeNav.selectedIdx >= graphNodeNav.sortedNodes.length - 1}
                  aria-label="Next node"
                  title="Next node"
                >
                  <IconChevronRight size={14} />
                </button>
              </>
            ) : (
              <span className="text-[10px] font-mono text-text-dim/40 px-2">
                {arcCtx ? "No investigation on this arc" : "No reasoning graph at this scene"}
              </span>
            )}

            <div className="w-px h-4 bg-white/12 mx-1" />

            {/* Generate — opens the composer pre-targeted to the current arc */}
            <button
              type="button"
              disabled={!canCompose}
              className={`text-xs font-semibold px-2 py-1 rounded-md transition-colors uppercase tracking-wider ${
                canCompose
                  ? "text-world bg-world/10 hover:bg-world/20"
                  : "text-text-dim/40 bg-white/3 cursor-not-allowed"
              }`}
              onClick={() => arcCtx && setInvestigationComposerArcId(arcCtx.arcId)}
              title="Generate a new investigation on this arc"
            >
              Generate
            </button>

            {/* Clear (only when active) — deletes the active investigation */}
            {activeInv && (
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
                onClick={() => {
                  dispatch({ type: "DELETE_INVESTIGATION", investigationId: activeInv.id });
                  dispatch({ type: "SET_SELECTED_INVESTIGATION", investigationId: null });
                }}
                aria-label="Delete active investigation"
                title="Delete active investigation"
              >
                <IconClose size={14} />
              </button>
            )}

            <div className="w-px h-4 bg-white/12 mx-1" />

            {/* Active-investigation switcher — clicking opens an overlay
                that lists every investigation on this arc; selecting one
                makes it active. Mirrors the mode graph's history pill. */}
            <button
              type="button"
              disabled={!arcCtx || arcCtx.list.length === 0}
              onClick={() => setInvestigationListOpen((v) => !v)}
              className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md transition-colors ${
                investigationListOpen ? "bg-white/10" : "hover:bg-white/6"
              } ${(!arcCtx || arcCtx.list.length === 0) ? "cursor-default" : ""}`}
              title={
                activeInv
                  ? `Investigation ${arcCtx!.activeIndex + 1} of ${totalInv} on ${arcCtx!.arcName} — click to switch`
                  : arcCtx
                    ? `No investigation on ${arcCtx.arcName}`
                    : "No arc"
              }
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${activeInv ? "bg-emerald-400" : "bg-white/15"}`}
              />
              <span className="text-text-dim truncate max-w-32">
                {activeInv ? (activeInv.direction || activeInv.graph.summary || "(continuation)") : (arcCtx ? arcCtx.arcName : "—")}
              </span>
              {totalInv > 0 && (
                <span className="text-[9px] text-text-dim/40 tabular-nums">
                  {arcCtx!.activeIndex + 1}/{totalInv}
                </span>
              )}
            </button>
          </div>
        </div>
        {investigationComposerArcId && (
          <InvestigationComposerModal
            initialArcId={investigationComposerArcId}
            onClose={() => setInvestigationComposerArcId(null)}
            onCreate={(investigation) => {
              dispatch({ type: "CREATE_INVESTIGATION", investigation });
              dispatch({
                type: "SET_SELECTED_INVESTIGATION",
                investigationId: investigation.id,
              });
              setInvestigationComposerArcId(null);
            }}
          />
        )}
      </>
    );
  }

  // ── Editing mode palette (plan / prose) ───────────────────────────────
  if (isEditingMode) {
    return (
      <>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
          {/* Generate guidance overlay */}
          {generateOpen && (
            <div className="w-96 flex flex-col rounded-xl glass overflow-hidden">
              <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                <span
                  className={`text-[10px] uppercase tracking-wider text-emerald-400/70`}
                >
                  Generate {graphViewMode === "plan" ? "Plan" : "Prose"}
                </span>
                <button
                  onClick={() => setGenerateOpen(false)}
                  className="text-[10px] text-text-dim/40 hover:text-text-dim transition"
                >
                  &times;
                </button>
              </div>
              <div className="p-3">
                <textarea
                  ref={generateInputRef}
                  value={generateText}
                  onChange={(e) => setGenerateText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setGenerateOpen(false);
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                      submitGenerate();
                  }}
                  placeholder={
                    graphViewMode === "plan"
                      ? 'Optional direction... e.g. "focus on the power struggle" or "open with a quiet moment"'
                      : 'Optional direction... e.g. "write it sparse and clipped" or "lean into sensory detail"'
                  }
                  className="w-full h-20 bg-black/30 border border-border rounded text-[11px] text-text-secondary p-2 resize-none outline-none focus:border-violet-300/30 transition-colors placeholder:text-text-dim/30"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[9px] text-text-dim/30">
                    &#x2318;Enter to submit
                  </span>
                  <button
                    onClick={submitGenerate}
                    className={`text-[10px] px-3 py-1 rounded transition bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15`}
                  >
                    Generate
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Rewrite guidance overlay */}
          {rewriteOpen && (
            <div className="w-96 flex flex-col rounded-xl glass overflow-hidden">
              <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                <span
                  className={`text-[10px] uppercase tracking-wider ${
                    graphViewMode === "plan"
                      ? "text-sky-400"
                      : "text-emerald-400"
                  }`}
                >
                  Rewrite {graphViewMode === "plan" ? "Plan" : "Prose"}
                </span>
                <button
                  onClick={() => setRewriteOpen(false)}
                  className="text-[10px] text-text-dim/40 hover:text-text-dim transition"
                >
                  &times;
                </button>
              </div>
              <div className="p-3">
                <textarea
                  ref={rewriteInputRef}
                  value={rewriteText}
                  onChange={(e) => setRewriteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRewriteOpen(false);
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                      submitRewrite();
                  }}
                  placeholder={
                    graphViewMode === "plan"
                      ? 'Describe what to change... e.g. "add more tension before the reveal" or "swap the dialogue beat for inner monologue"'
                      : 'Describe what to change... e.g. "make the opening more visceral" or "tighten the pacing in the middle section"'
                  }
                  className="w-full h-20 bg-black/30 border border-border rounded text-[11px] text-text-secondary p-2 resize-none outline-none focus:border-violet-300/30 transition-colors placeholder:text-text-dim/30"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[9px] text-text-dim/30">
                    &#x2318;Enter to submit
                  </span>
                  <button
                    onClick={submitRewrite}
                    disabled={!rewriteText.trim()}
                    className={`text-[10px] px-3 py-1 rounded transition disabled:opacity-30 disabled:cursor-not-allowed ${
                      graphViewMode === "plan"
                        ? "bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500/15"
                        : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15"
                    }`}
                  >
                    Rewrite
                  </button>
                </div>
              </div>
            </div>
          )}

          <div
            className={`glass-pill px-3 py-1.5 flex items-center gap-2 ${wrapperClasses}`}
          >
            {/* Scene nav */}
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
              onClick={() => dispatch({ type: "PREV_SCENE" })}
              aria-label="Previous scene"
            >
              <IconChevronLeft size={14} />
            </button>
            <button
              type="button"
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${state.graphViewMode === 'search' ? "text-text-primary bg-white/10" : "text-text-secondary hover:text-text-primary hover:bg-white/6"}`}
              onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'search' })}
              aria-label="Search narrative"
              title="Search narrative"
            >
              <IconSearch size={12} />
            </button>
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
              onClick={() => dispatch({ type: "NEXT_SCENE" })}
              aria-label="Next scene"
            >
              <IconChevronRight size={14} />
            </button>

            {/* Plan/Prose/Audio palette actions — hidden during auto/Experimentation/bulk */}
            {!isAnyModeActive && (
              <>
                <div className="w-px h-4 bg-white/12 mx-1" />

                {/* Plan palette actions */}
                {graphViewMode === "plan" && (
                  <>
                    <button
                      type="button"
                      className={`text-xs font-semibold px-2 py-1 rounded-md transition-colors uppercase tracking-wider ${!canGeneratePlan ? "text-text-dim/30 bg-white/3 cursor-not-allowed" : "text-world bg-world/10 hover:bg-world/20"}`}
                      onClick={() => {
                        if (canGeneratePlan) {
                          setGenerateOpen((v) => !v);
                          setRewriteOpen(false);
                        }
                      }}
                      title={canGeneratePlan ? undefined : generatePlanDisabledReason}
                    >
                      Generate
                    </button>
                    {hasPlan && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-sky-400 bg-sky-500/10 hover:bg-sky-500/20"
                        onClick={() => {
                          setRewriteOpen((v) => !v);
                          setGenerateOpen(false);
                        }}
                        title="Rewrite with guidance"
                      >
                        <IconRefresh size={14} />
                      </button>
                    )}
                    {hasPlan && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("canvas:clear-plan"),
                          )
                        }
                        title="Clear plan"
                      >
                        <IconClose size={14} />
                      </button>
                    )}
                    <div className="w-px h-4 bg-white/12 mx-0.5" />
                    <button
                      type="button"
                      className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-blue-400 bg-blue-500/10 hover:bg-blue-500/20"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("canvas:open-candidates"),
                        )
                      }
                      title="Generate multiple candidate plans and rank by semantic similarity"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                        <line x1="12" y1="22.08" x2="12" y2="12" />
                      </svg>
                    </button>
                    <SceneRangeSelector
                      range={bulkRange}
                      onChange={setBulkRange}
                      placement="top"
                      focus="plan"
                      trigger={{
                        icon: <IconAutoLoop size={14} />,
                        className: "w-7 h-7 flex items-center justify-center rounded-md transition-colors text-amber-400 bg-amber-500/10 hover:bg-amber-500/20",
                        title: "Bulk generate plans — pick range",
                      }}
                      onStart={(r) =>
                        window.dispatchEvent(
                          new CustomEvent("canvas:bulk-plan", { detail: { range: r } }),
                        )
                      }
                      startLabel="Start plan generation"
                    />
                  </>
                )}

                {/* Prose palette actions */}
                {graphViewMode === "prose" && (
                  <>
                    <button
                      type="button"
                      className={`text-xs font-semibold px-2 py-1 rounded-md transition-colors uppercase tracking-wider ${!hasPlan ? "text-text-dim/30 bg-white/3 cursor-not-allowed" : "text-world bg-world/10 hover:bg-world/20"}`}
                      onClick={() => {
                        if (hasPlan) {
                          setGenerateOpen((v) => !v);
                          setRewriteOpen(false);
                        }
                      }}
                      title={hasPlan ? undefined : "Generate a plan first"}
                    >
                      Generate
                    </button>
                    {hasProse && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20"
                        onClick={() => {
                          setRewriteOpen((v) => !v);
                          setGenerateOpen(false);
                        }}
                        title="Rewrite with guidance"
                      >
                        <IconRefresh size={14} />
                      </button>
                    )}
                    {hasProse && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("canvas:edit-prose"),
                          )
                        }
                        title="Edit prose"
                      >
                        <IconEdit size={14} />
                      </button>
                    )}
                    {hasProse && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("canvas:clear-prose"),
                          )
                        }
                        title="Clear prose"
                      >
                        <IconClose size={14} />
                      </button>
                    )}
                    <div className="w-px h-4 bg-white/12 mx-0.5" />
                    <SceneRangeSelector
                      range={bulkRange}
                      onChange={setBulkRange}
                      placement="top"
                      focus="prose"
                      trigger={{
                        icon: <IconAutoLoop size={14} />,
                        className: "w-7 h-7 flex items-center justify-center rounded-md transition-colors text-amber-400 bg-amber-500/10 hover:bg-amber-500/20",
                        title: "Bulk generate prose — pick range (requires plans)",
                      }}
                      onStart={(r) =>
                        window.dispatchEvent(
                          new CustomEvent("canvas:bulk-prose", { detail: { range: r } }),
                        )
                      }
                      startLabel="Start prose generation"
                    />
                  </>
                )}

                {/* Game palette actions — Generate / Clear / Auto */}
                {graphViewMode === "game" && (
                  <>
                    <button
                      type="button"
                      className="text-xs font-semibold px-2 py-1 rounded-md transition-colors uppercase tracking-wider text-world bg-world/10 hover:bg-world/20"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("canvas:generate-game"),
                        )
                      }
                    >
                      Generate
                    </button>
                    {currentScene?.gameAnalysis && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("canvas:clear-game"),
                          )
                        }
                        title="Clear analysis"
                      >
                        <IconClose size={14} />
                      </button>
                    )}
                    <div className="w-px h-4 bg-white/12 mx-0.5" />
                    <SceneRangeSelector
                      range={bulkRange}
                      onChange={setBulkRange}
                      placement="top"
                      focus="game"
                      trigger={{
                        icon: <IconAutoLoop size={14} />,
                        className: "w-7 h-7 flex items-center justify-center rounded-md transition-colors text-amber-400 bg-amber-500/10 hover:bg-amber-500/20",
                        title: "Analyse scenes — pick range (sliding-window parallel)",
                      }}
                      onStart={(r) =>
                        window.dispatchEvent(
                          new CustomEvent("canvas:bulk-game", { detail: { range: r } }),
                        )
                      }
                      startLabel="Start game analysis"
                    />
                  </>
                )}

                {/* Audio palette actions */}
                {graphViewMode === "audio" && (
                  <>
                    <button
                      type="button"
                      className={`text-xs font-semibold px-2 py-1 rounded-md transition-colors uppercase tracking-wider ${hasProse ? "text-world bg-world/10 hover:bg-world/20" : "text-text-dim/30 bg-white/3 cursor-not-allowed"}`}
                      onClick={() =>
                        hasProse &&
                        window.dispatchEvent(
                          new CustomEvent("canvas:generate-audio"),
                        )
                      }
                      title={hasProse ? undefined : "Generate prose first"}
                    >
                      Generate
                    </button>
                    {hasAudio && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("canvas:clear-audio"),
                          )
                        }
                        title="Clear audio"
                      >
                        <IconClose size={14} />
                      </button>
                    )}
                    <div className="w-px h-4 bg-white/12 mx-0.5" />
                    <SceneRangeSelector
                      range={bulkRange}
                      onChange={setBulkRange}
                      placement="top"
                      focus="audio"
                      trigger={{
                        icon: <IconAutoLoop size={14} />,
                        className: "w-7 h-7 flex items-center justify-center rounded-md transition-colors text-amber-400 bg-amber-500/10 hover:bg-amber-500/20",
                        title: "Bulk generate audio — pick range (requires prose)",
                      }}
                      onStart={(r) =>
                        window.dispatchEvent(
                          new CustomEvent("canvas:bulk-audio", { detail: { range: r } }),
                        )
                      }
                      startLabel="Start audio generation"
                    />
                  </>
                )}
              </>
            )}

            <div className="w-px h-4 bg-white/12 mx-1" />

            {/* Story Settings — always visible */}
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("open-story-settings"))
              }
              title="Story settings"
            >
              <IconSettings size={14} />
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
      {/* Palette row: bar + delete button side by side */}
      <div className="flex items-center gap-2">
        <div
          className={`glass-pill px-3 py-1.5 flex items-center gap-2 ${wrapperClasses}`}
        >
          {/* Scene navigation — always visible */}
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
            onClick={() => dispatch({ type: "PREV_SCENE" })}
            aria-label="Previous scene"
          >
            <IconChevronLeft size={14} />
          </button>

          {/* Search */}
          <button
            type="button"
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
              state.graphViewMode === 'search'
                ? "text-text-primary bg-white/10"
                : "text-text-secondary hover:text-text-primary hover:bg-white/6"
            }`}
            onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'search' })}
            aria-label="Search narrative"
            title="Search narrative"
          >
            <IconSearch size={12} />
          </button>

          {/* Next */}
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
            onClick={() => dispatch({ type: "NEXT_SCENE" })}
            aria-label="Next scene"
          >
            <IconChevronRight size={14} />
          </button>

          {/* Action buttons — hidden during auto/Experimentation/bulk */}
          {!isAnyModeActive && (
            <>
              {/* Divider */}
              <div className="w-px h-4 bg-white/12 mx-1" />

              {/* Generate */}
              <button
                type="button"
                className="text-xs font-semibold text-world bg-world/10 px-2 py-1 rounded-md hover:bg-world/20 transition-colors uppercase tracking-wider"
                onClick={() => {
                  if (access.userApiKeys && !access.hasOpenRouterKey) {
                    window.dispatchEvent(new Event("open-api-keys"));
                    return;
                  }
                  window.dispatchEvent(new CustomEvent("open-generate-panel"));
                }}
              >
                Generate
              </button>

              {/* Experimentation is no longer exposed here — it now lives
                  in the Future view's topbar, alongside the scenarios that
                  feed it. The bottom palette stays focused on view-level
                  generation actions (Generate, Auto). */}

              {/* Auto */}
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                onClick={() => {
                  if (access.userApiKeys && !access.hasOpenRouterKey) {
                    window.dispatchEvent(new Event("open-api-keys"));
                    return;
                  }
                  window.dispatchEvent(new CustomEvent("open-auto-settings"));
                }}
                title="Auto mode"
              >
                <IconAutoLoop size={14} />
              </button>

              {/* Future — jump to Future view and kick off scenario generation */}
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-blue-400 bg-blue-500/10 hover:bg-blue-500/20"
                onClick={() => {
                  if (access.userApiKeys && !access.hasOpenRouterKey) {
                    window.dispatchEvent(new Event("open-api-keys"));
                    return;
                  }
                  // sessionStorage flag survives the view-switch render gap;
                  // VariablesView consumes it on mount.
                  try {
                    sessionStorage.setItem(
                      "inktide:pending-generate-future",
                      "1",
                    );
                  } catch {
                    // ignore — falls back to manual regenerate
                  }
                  dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "future" });
                }}
                title="Generate future scenarios"
              >
                <IconFlask size={14} />
              </button>

              {/* Divider */}
              <div className="w-px h-4 bg-white/12 mx-1" />
            </>
          )}

          {/* Coordination Plan */}
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("open-coordination-plan"))
            }
            title="Coordination plan"
          >
            <IconList size={14} />
          </button>

          {/* Story Settings — always visible */}
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("open-story-settings"))
            }
            title="Story settings"
          >
            <IconSettings size={14} />
          </button>
        </div>

        {/* Delete head scene button */}
        {isActive &&
          isHead &&
          headIsOwned &&
          (headIsForkPoint ? (
            <button
              type="button"
              disabled
              title="Another branch forks from this scene — delete that branch first"
              className="w-8 h-8 flex items-center justify-center rounded-full glass-pill text-text-dim opacity-30 cursor-not-allowed"
            >
              <IconTrash size={14} />
            </button>
          ) : deleteConfirm ? (
            <div className="glass-pill px-2 py-1.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleDeleteHead}
                className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-dim hover:text-text-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              className="w-8 h-8 flex items-center justify-center rounded-full glass-pill text-text-dim hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Delete head scene"
            >
              <IconTrash size={14} />
            </button>
          ))}
      </div>
    </div>
  );
}
