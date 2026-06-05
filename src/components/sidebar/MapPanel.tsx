"use client";

// MapPanel — sidebar panel listing generated board/maps and launching the map composer.

import { MapComposerModal } from "@/components/sidebar/maps/MapComposerModal";
import { useStore } from "@/lib/state/store";
import type { ReasoningMap } from "@/types/narrative";
import { useMemo, useState } from "react";

/**
 * Sidebar pane: arc-anchored Maps. Each entry is a CRG attached
 * to an arc; opening one navigates the canvas to that arc's last scene
 * and shows the graph. Multiple maps per arc are supported.
 *
 * UX shape mirrors Surveys / Interviews: top "+ New" opens the composer
 * modal; the stream below shows past maps as compact cards.
 *
 * Single combined view (no focused/all toggle): the current arc's
 * maps are pulled to the top under a "This arc" divider, then a
 * chronological list of every investigation follows below. When the cursor
 * is on a world commit (no arc), only the chronological list shows.
 */
export default function MapPanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [composerOpen, setComposerOpen] = useState(false);

  // Resolve the current arc from the cursor. When the cursor is on a
  // world commit (scene-less entry) or there's no narrative, this is null
  // and the "This arc" section is omitted.
  const currentArcId = useMemo<string | null>(() => {
    if (!narrative) return null;
    const key = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    const scene = key ? narrative.scenes[key] : null;
    return scene?.arcId ?? null;
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);
  const currentArcName = currentArcId ? narrative?.arcs[currentArcId]?.name ?? null : null;

  // Last scene index per arc — used to sort the list in narrative order and
  // to navigate to an arc when an investigation is opened. Indices are
  // into resolvedEntryKeys (which includes world commits) because
  // SET_SCENE_INDEX takes a resolvedKeys index.
  const arcLastSceneIndex = useMemo(() => {
    const map = new Map<string, number>();
    if (!narrative) return map;
    state.resolvedEntryKeys.forEach((key, i) => {
      const scene = narrative.scenes[key];
      if (scene?.arcId) map.set(scene.arcId, i);
    });
    return map;
  }, [narrative, state.resolvedEntryKeys]);

  // Scene-only range per arc — start / end scene numbers EXCLUDING world
  // commits, so the card shows the arc's narrative position (e.g.
  // "Scenes 12–18") rather than a noisy mixed index. Used purely for
  // display; navigation still goes through `arcLastSceneIndex` against
  // resolvedEntryKeys.
  const arcSceneRange = useMemo(() => {
    const map = new Map<string, { start: number; end: number }>();
    if (!narrative) return map;
    let sceneNum = 0;
    for (const key of state.resolvedEntryKeys) {
      const scene = narrative.scenes[key];
      if (!scene) continue;
      sceneNum++;
      if (!scene.arcId) continue;
      const existing = map.get(scene.arcId);
      if (!existing) map.set(scene.arcId, { start: sceneNum, end: sceneNum });
      else existing.end = sceneNum;
    }
    return map;
  }, [narrative, state.resolvedEntryKeys]);

  const allMaps = useMemo<ReasoningMap[]>(() => {
    const all = Object.values(narrative?.maps ?? {});
    // Show maps whose host arc is in the current branch's resolved
    // timeline, plus any coordination-plan-derivative maps (those
    // are always considered relevant since they originate from an executed plan).
    const visible = all.filter(
      (inv) => arcLastSceneIndex.has(inv.arcId) || inv.source === "coordination-plan",
    );
    // Latest-first ordering — most recently created maps bubble to
    // the top regardless of host arc. The user's primary navigation pattern
    // is "what did I just generate?", so recency beats arc-chronology.
    return visible.sort((a, b) => b.createdAt - a.createdAt);
  }, [narrative?.maps, arcLastSceneIndex]);

  // Current-arc subset, pulled to the top for quick access.
  const arcMaps = useMemo<ReasoningMap[]>(() => {
    if (!currentArcId) return [];
    return allMaps.filter((inv) => inv.arcId === currentArcId);
  }, [allMaps, currentArcId]);

  function openMap(inv: ReasoningMap) {
    const idx = arcLastSceneIndex.get(inv.arcId);
    if (idx !== undefined) {
      dispatch({ type: "SET_SCENE_INDEX", index: idx });
    }
    dispatch({ type: "SET_SELECTED_MAP", mapId: inv.id });
    dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "map" });
  }

  function renderCard(inv: ReasoningMap) {
    const arc = narrative?.arcs[inv.arcId];
    const nodes = inv.graph?.nodes?.length ?? 0;
    const edges = inv.graph?.edges?.length ?? 0;
    const style = inv.settings?.thinkingStyle;
    const resource = inv.settings?.thinkingResource;
    const range = arcSceneRange.get(inv.arcId);
    const rangeLabel = range
      ? range.start === range.end
        ? `Scene ${range.start}`
        : `Scenes ${range.start}–${range.end}`
      : null;
    return (
      <div
        key={inv.id}
        onClick={() => openMap(inv)}
        className="panel-card group w-full text-left p-3 cursor-pointer"
        style={{
          ['--card-accent']: inv.source === 'coordination-plan' ? 'var(--color-world)' : 'var(--accent)',
        } as React.CSSProperties}
      >
        {/* Header: source chip · thinking style · resource — same chip row
            pattern as SurveyCard's "questionType · category". */}
        <div className="flex items-baseline gap-2 mb-1">
          <span
            className={`text-[9px] uppercase tracking-wider font-mono ${
              inv.source === "coordination-plan" ? "text-emerald-300/80" : "text-text-dim/70"
            }`}
          >
            {inv.source === "coordination-plan" ? "Plan" : "Manual"}
          </span>
          {style && style !== "freeform" && (
            <span className="text-[9px] uppercase tracking-wider font-mono text-violet-300/70">
              · {style}
            </span>
          )}
          {resource && resource !== "freeform" && (
            <span className="text-[9px] uppercase tracking-wider font-mono text-amber-300/70">
              · {resource}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: "DELETE_MAP", mapId: inv.id });
            }}
            className="ml-auto text-text-dim/40 hover:text-fate opacity-0 group-hover:opacity-100 transition-opacity text-[14px] leading-none shrink-0"
            title="Delete investigation"
          >
            &times;
          </button>
        </div>

        {/* Body: arc name (the subject) + scene-only range + optional
            direction (the brief). Parallel to a survey's question + meta. */}
        <p className="text-[12px] text-text-primary leading-snug">
          {arc?.name ?? "Unknown arc"}
        </p>
        {rangeLabel && (
          <p className="mt-0.5 text-[10px] font-mono text-text-dim/60 tabular-nums">
            {rangeLabel}
          </p>
        )}
        {inv.direction && (
          <p className="mt-1 text-[10px] text-text-dim/70 italic line-clamp-2 leading-snug">
            {inv.direction}
          </p>
        )}

        {/* Footer: graph dimensions + date — mirrors SurveyCard's
            sparkline/summary row. */}
        <div className="mt-2 flex items-center gap-2 text-[9px] font-mono text-text-dim/60 tabular-nums">
          <span>{nodes} node{nodes !== 1 ? "s" : ""}</span>
          <span>·</span>
          <span>{edges} edge{edges !== 1 ? "s" : ""}</span>
          <span className="ml-auto">
            {new Date(inv.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
          </span>
        </div>
      </div>
    );
  }

  if (!narrative) {
    return (
      <div className="p-4 text-[11px] text-text-dim">
        Open a world view to investigate its arcs.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 h-9 px-3 border-b border-white/8 flex items-center gap-2">
        <span className="text-[11px] text-text-primary">Maps</span>
        <span className="text-[10px] uppercase tracking-wider text-text-dim/50 tabular-nums">
          {allMaps.length}
        </span>
        <button
          onClick={() => setComposerOpen(true)}
          className="ml-auto text-[11px] px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-text-primary transition-colors shrink-0"
        >
          + New
        </button>
      </div>

      {allMaps.length === 0 ? (
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
        <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-2">
          {/* This-arc section — only when the cursor is on an arc. */}
          {currentArcId && (
            <>
              <div className="flex items-center gap-2 px-0.5 pb-0.5">
                <span
                  className="text-[9px] uppercase tracking-wider text-text-dim/50 shrink-0 truncate max-w-[70%]"
                  title={currentArcName ?? undefined}
                >
                  This arc · {currentArcName ?? "—"}
                </span>
                <div className="h-px flex-1 bg-white/8" />
              </div>
              {arcMaps.length > 0 ? (
                arcMaps.map(renderCard)
              ) : (
                <p className="px-0.5 py-1 text-[10px] text-text-dim/50 leading-relaxed">
                  No maps on this arc yet. Tap{" "}
                  <span className="text-text-secondary">+ New</span> to investigate it.
                </p>
              )}

              {/* Divider into the full chronological list. */}
              <div className="flex items-center gap-2 px-0.5 pt-2 pb-0.5">
                <span className="text-[9px] uppercase tracking-wider text-text-dim/50 shrink-0">
                  All maps
                </span>
                <div className="h-px flex-1 bg-white/8" />
              </div>
            </>
          )}

          {/* Full chronological list (latest first). */}
          {allMaps.map(renderCard)}
        </div>
      )}

      {composerOpen && (
        <MapComposerModal
          onClose={() => setComposerOpen(false)}
          onCreate={(investigation) => {
            dispatch({ type: "CREATE_MAP", investigation });
            setComposerOpen(false);
            const idx = arcLastSceneIndex.get(investigation.arcId);
            if (idx !== undefined) dispatch({ type: "SET_SCENE_INDEX", index: idx });
            dispatch({ type: "SET_SELECTED_MAP", mapId: investigation.id });
            dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "map" });
          }}
        />
      )}
    </div>
  );
}
