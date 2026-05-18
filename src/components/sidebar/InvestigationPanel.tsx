"use client";

import { InvestigationComposerModal } from "@/components/sidebar/investigations/InvestigationComposerModal";
import { useStore } from "@/lib/store";
import type { ArcInvestigation } from "@/types/narrative";
import { useMemo, useState } from "react";

/**
 * Sidebar pane: arc-anchored Investigations. Each entry is a CRG attached
 * to an arc; opening one navigates the canvas to that arc's last scene
 * and shows the graph. Multiple investigations per arc are supported.
 *
 * UX shape mirrors Surveys / Interviews: top "+ New" opens the composer
 * modal; the stream below shows past investigations as compact cards.
 */
export default function InvestigationPanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [composerOpen, setComposerOpen] = useState(false);

  // Last scene index per arc — used to sort the list in narrative order and
  // to navigate to an arc when an investigation is opened.
  const arcLastSceneIndex = useMemo(() => {
    const map = new Map<string, number>();
    if (!narrative) return map;
    state.resolvedEntryKeys.forEach((key, i) => {
      const scene = narrative.scenes[key];
      if (scene?.arcId) map.set(scene.arcId, i);
    });
    return map;
  }, [narrative, state.resolvedEntryKeys]);

  const investigations = useMemo<ArcInvestigation[]>(() => {
    const all = Object.values(narrative?.investigations ?? {});
    // Show investigations whose host arc is in the current branch's resolved
    // timeline, plus any coordination-plan-derivative investigations (those
    // are always considered relevant since they originate from an executed plan).
    const visible = all.filter(
      (inv) => arcLastSceneIndex.has(inv.arcId) || inv.source === "coordination-plan",
    );
    return visible.sort((a, b) => {
      const pa = arcLastSceneIndex.get(a.arcId) ?? Number.POSITIVE_INFINITY;
      const pb = arcLastSceneIndex.get(b.arcId) ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      // Within the same arc, oldest first so the cycle UI reads chronologically.
      return a.createdAt - b.createdAt;
    });
  }, [narrative?.investigations, arcLastSceneIndex]);

  function openInvestigation(inv: ArcInvestigation) {
    const idx = arcLastSceneIndex.get(inv.arcId);
    if (idx !== undefined) {
      dispatch({ type: "SET_SCENE_INDEX", index: idx });
    }
    dispatch({ type: "SET_SELECTED_INVESTIGATION", investigationId: inv.id });
    dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "reasoning" });
  }

  if (!narrative) {
    return (
      <div className="p-4 text-[11px] text-text-dim">
        Open a narrative to investigate its arcs.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-3 py-2 border-b border-white/8 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-text-dim/70">
          {investigations.length}{" "}
          {investigations.length === 1 ? "investigation" : "investigations"}
        </span>
        <button
          onClick={() => setComposerOpen(true)}
          className="ml-auto text-[11px] px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-text-primary transition-colors"
        >
          + New
        </button>
      </div>

      {investigations.length === 0 ? (
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col items-center justify-center p-8 text-center gap-2">
          <svg className="w-8 h-8 text-text-dim/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="m20 20-3.5-3.5" />
          </svg>
          <p className="text-[11px] text-text-dim/80">Open a causal investigation on any arc.</p>
          <p className="text-[10px] text-text-dim/50 max-w-xs leading-relaxed">
            Tap <span className="text-text-secondary">+ New</span> to reason about the forces shaping an arc. Copy the result back into generation as direction.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          {investigations.map((inv) => {
            const arc = narrative.arcs[inv.arcId];
            const arcPosition = arcLastSceneIndex.get(inv.arcId);
            return (
              <div
                key={inv.id}
                className="group border-b border-white/5 px-3 py-2.5 hover:bg-white/3 transition-colors cursor-pointer"
                onClick={() => openInvestigation(inv)}
              >
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[10px] font-mono text-text-dim/60 shrink-0">
                    {arcPosition !== undefined ? `#${arcPosition + 1}` : "?"}
                  </span>
                  <span className="text-[11px] text-text-primary truncate flex-1">
                    {arc?.name ?? "Unknown arc"}
                  </span>
                  {inv.source === "coordination-plan" && (
                    <span className="text-[9px] uppercase tracking-wider text-emerald-300/70 shrink-0">
                      plan
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "DELETE_INVESTIGATION", investigationId: inv.id });
                    }}
                    className="text-text-dim/40 hover:text-fate opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
                    title="Delete investigation"
                  >
                    &times;
                  </button>
                </div>
                {inv.direction && (
                  <p className="text-[10px] text-text-dim/70 mt-1 line-clamp-2 italic">
                    {inv.direction}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {composerOpen && (
        <InvestigationComposerModal
          onClose={() => setComposerOpen(false)}
          onCreate={(investigation) => {
            dispatch({ type: "CREATE_INVESTIGATION", investigation });
            setComposerOpen(false);
            const idx = arcLastSceneIndex.get(investigation.arcId);
            if (idx !== undefined) dispatch({ type: "SET_SCENE_INDEX", index: idx });
            dispatch({ type: "SET_SELECTED_INVESTIGATION", investigationId: investigation.id });
            dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "reasoning" });
          }}
        />
      )}
    </div>
  );
}
