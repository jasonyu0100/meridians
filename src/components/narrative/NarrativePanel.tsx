"use client";

import { useCallback, useRef, useState } from "react";
import { IconEye, IconLocationPin } from "@/components/icons";
import { getEffectivePovId } from "@/lib/narrative-utils";
import { useStore } from "@/lib/store";
import {
  computeSceneOffsets,
  formatCumulative,
  formatTimeDelta,
} from "@/lib/time-deltas";
import { resolveEntry, type Scene } from "@/types/narrative";
import { InlineText } from "@/components/inspector/InlineEdit";

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 800;
const DEFAULT_HEIGHT = 180;

export default function NarrativePanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const startY = useRef(0);
  const startH = useRef(0);

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startY.current = e.clientY;
      startH.current = height;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = startY.current - ev.clientY;
        const next = Math.max(
          MIN_HEIGHT,
          Math.min(MAX_HEIGHT, startH.current + delta),
        );
        setHeight(next);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [height],
  );

  if (!narrative) return null;

  const currentKey = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
  const entry = currentKey ? resolveEntry(narrative, currentKey) : null;

  if (!entry) return null;

  // Compute positional label (Scene 3, World 2, etc.)
  let sceneNum = 0;
  let worldNum = 0;
  let positionLabel = "";
  for (
    let i = 0;
    i <= state.viewState.currentSceneIndex &&
    i < state.resolvedEntryKeys.length;
    i++
  ) {
    const k = state.resolvedEntryKeys[i];
    if (narrative.scenes[k]) {
      sceneNum++;
      if (i === state.viewState.currentSceneIndex)
        positionLabel = `Scene ${sceneNum}`;
    } else if (narrative.worldBuilds[k]) {
      worldNum++;
      if (i === state.viewState.currentSceneIndex)
        positionLabel = `World ${worldNum}`;
    }
  }

  const containerClass =
    "relative shrink-0 glass-panel border-t border-border overflow-y-auto px-4 py-3";
  const containerStyle = { height };

  const resizeHandle = (
    <div
      className="absolute top-0 left-0 right-0 h-1 cursor-row-resize hover:bg-violet-300/15 active:bg-violet-300/25 transition-colors z-10"
      onMouseDown={onResizeMouseDown}
      title="Drag to resize"
    />
  );

  // World build commit view
  if (entry.kind === "world_build") {
    const m = entry.expansionManifest;
    return (
      <div className={containerClass} style={containerStyle}>
        {resizeHandle}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
              {positionLabel || "World Expansion"}
            </span>
            <span className="font-mono text-[10px] text-text-dim">
              {entry.id}
            </span>
          </div>
          {entry.createdAt && (() => {
            const dt = new Date(entry.createdAt);
            if (Number.isNaN(dt.getTime())) return null;
            return (
              <span
                className="text-[10px] text-text-dim font-mono shrink-0"
                title={`Committed: ${entry.createdAt}`}
              >
                committed {dt.toLocaleString(undefined, {
                  year: 'numeric', month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            );
          })()}
        </div>
        <div className="flex flex-col gap-1.5">
          {entry.summary && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">
                Summary
              </span>
              {entry.summary}
            </div>
          )}
          {m.newCharacters.length > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">
                Characters
              </span>
              {m.newCharacters
                .map((c) => narrative.characters[c.id]?.name ?? c.name)
                .join(", ")}
            </div>
          )}
          {m.newLocations.length > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">
                Locations
              </span>
              {m.newLocations
                .map((l) => narrative.locations[l.id]?.name ?? l.name)
                .join(", ")}
            </div>
          )}
          {m.newThreads.length > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">
                Threads
              </span>
              {m.newThreads
                .map(
                  (t) => narrative.threads[t.id]?.description ?? t.description,
                )
                .join(", ")}
            </div>
          )}
          {(m.newArtifacts?.length ?? 0) > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">
                Artifacts
              </span>
              {m
                .newArtifacts!.map(
                  (a) => narrative.artifacts?.[a.id]?.name ?? a.name,
                )
                .join(", ")}
            </div>
          )}
          {(m.systemDeltas?.addedNodes?.length ?? 0) > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">
                System Knowledge
              </span>
              {m.systemDeltas?.addedNodes.map((n) => n.concept).join(", ")}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Scene commit view — entry is narrowed to Scene after the world_build check
  const scene = entry as Scene;
  const location = narrative.locations[scene.locationId];
  const effectivePovId = getEffectivePovId(scene);
  const povCharacter = effectivePovId
    ? narrative.characters[effectivePovId]
    : null;
  const arc = Object.values(narrative.arcs).find((a) =>
    a.sceneIds.includes(scene.id),
  );

  // Cumulative time offset from the first scene in the branch. Walk the
  // resolved timeline, collect scenes only (world builds are not temporal),
  // and pick the offset at this scene's index.
  const branchScenes: Scene[] = [];
  for (const k of state.resolvedEntryKeys) {
    const s = narrative.scenes[k];
    if (s) branchScenes.push(s);
  }
  const sceneIdx = branchScenes.findIndex((s) => s.id === scene.id);
  const offsets = computeSceneOffsets(branchScenes);
  const cumulativeSeconds = sceneIdx >= 0 ? offsets[sceneIdx] : 0;
  const showTimeDelta = sceneIdx > 0 && scene.timeDelta != null;

  return (
    <div className={containerClass} style={containerStyle}>
      {resizeHandle}
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">
            {positionLabel}
          </span>
          <button
            type="button"
            onClick={() => dispatch({ type: "SET_INSPECTOR", context: { type: "scene", sceneId: scene.id } })}
            className="font-mono text-[10px] text-text-dim hover:text-text-secondary transition-colors"
            title="Inspect this scene"
          >
            {scene.id}
          </button>
          {arc && (
            <button
              type="button"
              onClick={() => dispatch({ type: "SET_INSPECTOR", context: { type: "arc", arcId: arc.id } })}
              className="text-[10px] text-text-dim uppercase tracking-wider hover:text-text-secondary transition-colors"
              title="Inspect this arc"
            >
              {arc.name}
            </button>
          )}
          {sceneIdx > 0 && cumulativeSeconds > 0 && (
            <span
              className="text-[10px] text-text-dim font-mono"
              title="Cumulative time from first scene"
            >
              T+{formatCumulative(cumulativeSeconds)}
            </span>
          )}
          {location && (
            <>
              <span className="text-text-dim text-[10px]">&middot;</span>
              <button
                type="button"
                onClick={() =>
                  dispatch({
                    type: "SET_INSPECTOR",
                    context: { type: "location", locationId: location.id },
                  })
                }
                className="flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors"
              >
                <IconLocationPin size={12} className="text-text-dim" />
                {location.name}
              </button>
            </>
          )}
          {povCharacter && (
            <>
              <span className="text-text-dim text-[10px]">&middot;</span>
              <button
                type="button"
                onClick={() =>
                  dispatch({
                    type: "SET_INSPECTOR",
                    context: { type: "character", characterId: povCharacter.id },
                  })
                }
                className="flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors"
              >
                <IconEye size={12} className="text-text-dim" />
                {povCharacter.name}
              </button>
            </>
          )}
        </div>
        {/* Generation timestamp on the far right — wall-clock when this
            scene was committed. Surfaced for credibility on predictions:
            "this forecast was made on DATE". Stamped at the boundary by
            every generation path; absent on older scenes that pre-date
            the field. */}
        {scene.createdAt && (() => {
          const dt = new Date(scene.createdAt);
          if (Number.isNaN(dt.getTime())) return null;
          return (
            <span
              className="text-[10px] text-text-dim font-mono shrink-0"
              title={`Committed: ${scene.createdAt}`}
            >
              committed {dt.toLocaleString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
          );
        })()}
      </div>
      <div className="text-sm leading-relaxed text-text-primary">
        {showTimeDelta && (
          <span
            className="text-text-dim italic mr-1.5"
            title="Time elapsed since prior scene (estimate)"
          >
            +{formatTimeDelta(scene.timeDelta)} —
          </span>
        )}
        <InlineText
          value={scene.summary}
          onSave={(summary) => dispatch({ type: "UPDATE_SCENE", sceneId: scene.id, patch: { summary } })}
          multiline
          placeholder="Click to write a scene summary."
          className="text-sm leading-relaxed text-text-primary"
          inputClassName="text-sm leading-relaxed"
        />
      </div>
    </div>
  );
}
