"use client";

/**
 * ScenePerspectivesView — Content → Perspectives.
 *
 * Narrative perspectives on a scene, each the canon entry retold through one
 * lens: the **public** narrator, plus each participant. A perspective is a
 * summary (scene-summary register) derived from canon but free to add
 * non-canon, lens-specific detail. Purely additive — reads scene.perspectives,
 * never mutates deltas.
 *
 * Layout is a left column of avatars (map-style grey circles — entity image
 * when available, letter fallback otherwise; a globe for the public lens) that
 * select which perspective fills the reading pane on the right. Generation is
 * driven from the StagePalette (matching plan / prose / learning): the Generate
 * button fans out **all available perspectives in parallel**; the open lens can
 * also be regenerated on its own.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/state/store";
import { generateScenePerspective, availablePerspectiveKeys, perspectiveLabel } from "@/lib/ai";
import { Avatar } from "@/components/stage/RoomUI";
import { useImageUrlMap } from "@/hooks/useAssetUrl";
import { IconRefresh, IconUser, IconGlobe } from "@/components/icons";
import { EmptyState } from "@/components/shared/EmptyState";
import type { NarrativeState, Scene } from "@/types/narrative";

/** The world entity behind a perspective key (or undefined for the public lens). */
function keyEntity(narrative: NarrativeState, key: string) {
  return narrative.characters[key] ?? narrative.locations[key] ?? narrative.artifacts?.[key];
}

/** Public lens avatar — a grey map-style circle carrying a globe. */
function PublicAvatar({ size = 30, selected = false }: { size?: number; selected?: boolean }) {
  return (
    <div
      title="Public"
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full flex items-center justify-center bg-slate-300 text-slate-700 shadow-sm ${
        selected ? "ring-2 ring-accent ring-offset-1 ring-offset-bg-base" : ""
      }`}
    >
      <IconGlobe size={Math.round(size * 0.5)} />
    </div>
  );
}

export function ScenePerspectivesView({
  narrative,
  scene,
}: {
  narrative: NarrativeState;
  scene: Scene;
}) {
  const { state, dispatch } = useStore();
  const resolvedKeys = state.resolvedEntryKeys;
  const currentIndex = state.viewState.currentSceneIndex;

  const keys = useMemo(() => availablePerspectiveKeys(narrative, scene), [narrative, scene]);
  const perspectives = scene.perspectives ?? {};
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("public");

  // Resolve entity portraits for the whole column in one batch.
  const imageRefs = useMemo(
    () => keys.map((k) => keyEntity(narrative, k)?.imageUrl ?? undefined),
    [keys, narrative],
  );
  const imageMap = useImageUrlMap(imageRefs);

  // Reset selection + error when the scene changes; prefer the first lens that
  // already has a perspective, else the public narrator.
  useEffect(() => {
    setError(null);
    const firstReady = keys.find((k) => scene.perspectives?.[k]?.text);
    setSelectedKey(firstReady ?? keys[0] ?? "public");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id]);

  const activeKey = keys.includes(selectedKey) ? selectedKey : keys[0] ?? "public";

  // Generate a single perspective and save it.
  const genOne = useCallback(
    async (key: string) => {
      setRunning((s) => new Set(s).add(key));
      try {
        const text = await generateScenePerspective(narrative, scene, key, resolvedKeys, currentIndex);
        dispatch({
          type: "SET_SCENE_PERSPECTIVE",
          sceneId: scene.id,
          view: { key, label: perspectiveLabel(narrative, key), text, generatedAt: Date.now() },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
      }
    },
    [narrative, scene, resolvedKeys, currentIndex, dispatch],
  );

  // ── Palette events — generate ALL in parallel / clear ──
  useEffect(() => {
    async function handleGenerate() {
      setError(null);
      window.dispatchEvent(new CustomEvent("bulk:perspectives-start", { detail: { sceneId: scene.id } }));
      try {
        // Fan out every available lens at once — the headline behaviour.
        await Promise.all(availablePerspectiveKeys(narrative, scene).map((k) => genOne(k)));
      } finally {
        window.dispatchEvent(new CustomEvent("bulk:perspectives-complete", { detail: { sceneId: scene.id } }));
      }
    }
    function handleClear() {
      dispatch({ type: "CLEAR_SCENE_PERSPECTIVES", sceneId: scene.id });
      setError(null);
    }
    window.addEventListener("canvas:generate-perspectives", handleGenerate);
    window.addEventListener("canvas:clear-perspectives", handleClear);
    return () => {
      window.removeEventListener("canvas:generate-perspectives", handleGenerate);
      window.removeEventListener("canvas:clear-perspectives", handleClear);
    };
  }, [narrative, scene, dispatch, genOne]);

  const activeView = perspectives[activeKey];
  const activeBusy = running.has(activeKey);
  const activeIsPublic = activeKey === "public";

  return (
    <div className="flex h-full">
      {/* Avatar column — one lens per row, image-or-letter map-style grey. */}
      <div className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-white/8 px-2 py-3">
        {keys.map((key) => {
          const isPublic = key === "public";
          const view = perspectives[key];
          const busy = running.has(key);
          const selected = key === activeKey;
          const label = perspectiveLabel(narrative, key);
          const ref = keyEntity(narrative, key)?.imageUrl ?? undefined;
          const url = ref ? imageMap.get(ref) ?? null : null;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedKey(key)}
              title={label}
              className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                selected ? "bg-white/8" : "hover:bg-white/4"
              }`}
            >
              {isPublic ? (
                <PublicAvatar selected={selected} />
              ) : (
                <Avatar label={label} imageUrl={url} size={30} selected={selected} />
              )}
              <div className="min-w-0 flex-1">
                <div className={`truncate text-xs ${selected ? "text-text-primary" : "text-text-secondary"}`}>
                  {label}
                </div>
                <div className="text-[9px] uppercase tracking-wide text-text-dim/60">
                  {busy ? "Writing…" : isPublic ? "Narrator" : view ? "Ready" : "Empty"}
                </div>
              </div>
              {/* status pip */}
              {!busy && (
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${view ? "bg-emerald-400/70" : "bg-white/10"}`}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Reading pane — the selected lens. */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-300/90">
              {error}
            </div>
          )}

          {keys.length === 0 ? (
            <EmptyState icon={IconUser} title="No lenses available." hint="This scene has no participants to voice." />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-white/8 pb-2">
                <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  {activeIsPublic ? <IconGlobe size={14} /> : <IconUser size={14} />}
                  {perspectiveLabel(narrative, activeKey)}
                  {activeIsPublic && (
                    <span className="rounded bg-white/8 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-dim/70">
                      widely known
                    </span>
                  )}
                </div>
                <button
                  onClick={() => genOne(activeKey)}
                  disabled={activeBusy}
                  title={activeView ? "Regenerate this perspective" : "Generate this perspective"}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-dim/70 transition-colors hover:bg-white/5 hover:text-text-primary disabled:opacity-40"
                >
                  <IconRefresh size={11} className={activeBusy ? "animate-spin" : ""} />
                  {activeBusy ? "Writing…" : activeView ? "Regenerate" : "Generate"}
                </button>
              </div>

              <div className="text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap">
                {activeBusy && !activeView ? (
                  <span className="text-text-dim/50">{`Writing ${perspectiveLabel(narrative, activeKey)}'s perspective…`}</span>
                ) : activeView ? (
                  activeView.text
                ) : (
                  <span className="text-text-dim/40">
                    Not generated. Use Generate in the palette below to write all lenses in parallel, or Generate
                    above for just this one.
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
