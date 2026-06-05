"use client";

// CompassPanel — inspector surface for an arc's Present/Future variable scenarios (the Compass).

import { useStore } from "@/lib/state/store";
import type { Arc } from "@/types/narrative";
import { useMemo } from "react";

/** An arc that carries a compass reading, plus the derived display data. */
type CompassReading = {
  arc: Arc;
  /** Index into resolvedEntryKeys of the arc's last scene — navigation target. */
  lastSceneIndex: number;
  variableCount: number;
  directionCount: number;
  paradigm: string | null;
};

/**
 * Sidebar pane: arc-anchored Compass readings. Mirrors the Maps
 * pane in shape — a stream of compact cards, one per arc that carries a
 * compass reading (Present variables and/or a Compass direction cohort).
 * Opening one navigates the canvas to that arc's last scene and switches
 * the graph to the Compass surface (CompassView).
 *
 * A "compass reading" exists on an arc when it has `presentVariables`
 * (the Present surface) or `planningScenarios` (the Compass / Future
 * cohort). Both are extractions on the same Compass surface; the card
 * shows whichever are present.
 *
 * Single combined view (no focused/all toggle): the current arc's reading
 * is pulled to the top under a "This arc" divider, then a chronological
 * list of every reading follows below. When the cursor is on a world
 * commit (no arc), only the chronological list shows.
 */
export default function CompassPanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  // Resolve the current arc from the cursor. Null when parked on a world
  // commit or with no narrative — the "This arc" section is then omitted.
  const currentArcId = useMemo<string | null>(() => {
    if (!narrative) return null;
    const key = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    const scene = key ? narrative.scenes[key] : null;
    return scene?.arcId ?? null;
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);
  const currentArcName = currentArcId ? narrative?.arcs[currentArcId]?.name ?? null : null;

  // Last scene index per arc (into resolvedEntryKeys, incl. world commits) —
  // navigation target when a reading is opened, and the basis for ordering.
  const arcLastSceneIndex = useMemo(() => {
    const map = new Map<string, number>();
    if (!narrative) return map;
    state.resolvedEntryKeys.forEach((key, i) => {
      const scene = narrative.scenes[key];
      if (scene?.arcId) map.set(scene.arcId, i);
    });
    return map;
  }, [narrative, state.resolvedEntryKeys]);

  // Scene-only range per arc (EXCLUDING world commits) for the card's
  // narrative-position label — parallel to MapPanel.
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

  const allReadings = useMemo<CompassReading[]>(() => {
    if (!narrative) return [];
    const readings: CompassReading[] = [];
    for (const arc of Object.values(narrative.arcs ?? {})) {
      const lastSceneIndex = arcLastSceneIndex.get(arc.id);
      // Only surface arcs that are actually in the current branch's timeline.
      if (lastSceneIndex === undefined) continue;
      const variableCount = arc.presentVariables?.length ?? 0;
      const directionCount = arc.planningScenarios?.length ?? 0;
      if (variableCount === 0 && directionCount === 0) continue;
      readings.push({
        arc,
        lastSceneIndex,
        variableCount,
        directionCount,
        paradigm: arc.planningParadigm ?? arc.presentParadigm ?? null,
      });
    }
    // Narrative order — top-to-bottom follows the story's progression.
    return readings.sort((a, b) => a.lastSceneIndex - b.lastSceneIndex);
  }, [narrative, arcLastSceneIndex]);

  // Current-arc reading(s), pulled to the top for quick access.
  const arcReadings = useMemo<CompassReading[]>(() => {
    if (!currentArcId) return [];
    return allReadings.filter((r) => r.arc.id === currentArcId);
  }, [allReadings, currentArcId]);

  function openReading(reading: CompassReading) {
    dispatch({ type: "SET_SCENE_INDEX", index: reading.lastSceneIndex });
    // Land on the Compass cohort when one exists, else the Present surface.
    dispatch({
      type: "SET_GRAPH_VIEW_MODE",
      mode: reading.directionCount > 0 ? "compass" : "present",
    });
  }

  function renderCard(reading: CompassReading) {
    const { arc, variableCount, directionCount, paradigm } = reading;
    const range = arcSceneRange.get(arc.id);
    const rangeLabel = range
      ? range.start === range.end
        ? `Scene ${range.start}`
        : `Scenes ${range.start}–${range.end}`
      : null;
    return (
      <div
        key={arc.id}
        onClick={() => openReading(reading)}
        className="panel-card group w-full text-left p-3 cursor-pointer"
        style={{
          ['--card-accent']: directionCount > 0 ? 'var(--accent)' : 'var(--color-system)',
        } as React.CSSProperties}
      >
        {/* Header: which surfaces this arc carries. */}
        <div className="flex items-baseline gap-2 mb-1">
          {variableCount > 0 && (
            <span className="text-[9px] uppercase tracking-wider font-mono text-sky-300/80">
              Present
            </span>
          )}
          {directionCount > 0 && (
            <span className="text-[9px] uppercase tracking-wider font-mono text-violet-300/80">
              {variableCount > 0 ? "· " : ""}Compass
            </span>
          )}
        </div>

        {/* Body: arc name + scene range + optional paradigm lens. */}
        <p className="text-[12px] text-text-primary leading-snug">{arc.name ?? "Unknown arc"}</p>
        {rangeLabel && (
          <p className="mt-0.5 text-[10px] font-mono text-text-dim/60 tabular-nums">{rangeLabel}</p>
        )}
        {paradigm && (
          <p className="mt-1 text-[10px] text-text-dim/70 italic line-clamp-2 leading-snug">{paradigm}</p>
        )}

        {/* Footer: surface dimensions. */}
        <div className="mt-2 flex items-center gap-2 text-[9px] font-mono text-text-dim/60 tabular-nums">
          <span>
            {variableCount} variable{variableCount !== 1 ? "s" : ""}
          </span>
          <span>·</span>
          <span>
            {directionCount} direction{directionCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    );
  }

  if (!narrative) {
    return (
      <div className="p-4 text-[11px] text-text-dim">
        Open a world view to read its compass.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 h-9 px-3 border-b border-white/8 flex items-center gap-2">
        <span className="text-[11px] text-text-primary">Compass</span>
        <span className="text-[10px] uppercase tracking-wider text-text-dim/50 tabular-nums">
          {allReadings.length}
        </span>
      </div>

      {allReadings.length === 0 ? (
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col items-center justify-center p-8 text-center gap-2">
          <svg
            className="w-8 h-8 text-text-dim/30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" strokeLinejoin="round" />
          </svg>
          <p className="text-[11px] text-text-dim/80">No compass readings yet.</p>
          <p className="text-[10px] text-text-dim/50 max-w-xs leading-relaxed">
            Open the <span className="text-text-secondary">Compass</span> on an arc to extract its
            load-bearing variables and chart next-arc directions.
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
              {arcReadings.length > 0 ? (
                arcReadings.map(renderCard)
              ) : (
                <p className="px-0.5 py-1 text-[10px] text-text-dim/50 leading-relaxed">
                  No compass reading on this arc yet. Open the{" "}
                  <span className="text-text-secondary">Compass</span> to extract its variables.
                </p>
              )}

              {/* Divider into the full chronological list. */}
              <div className="flex items-center gap-2 px-0.5 pt-2 pb-0.5">
                <span className="text-[9px] uppercase tracking-wider text-text-dim/50 shrink-0">
                  All readings
                </span>
                <div className="h-px flex-1 bg-white/8" />
              </div>
            </>
          )}

          {/* Full chronological list (narrative order). */}
          {allReadings.map(renderCard)}
        </div>
      )}
    </div>
  );
}
