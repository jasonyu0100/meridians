"use client";

/**
 * ArcPerspectivesView — Content → Perspectives.
 *
 * Perspectives on an ARC, each synthesizing the whole arc (all its scenes)
 * through one lens: the **public** narrator (third person), plus each
 * participant (first person). A perspective is a skim-read digest derived from
 * canon but free to add non-canon, lens-specific detail. Purely additive —
 * reads arc.perspectives, never mutates deltas. An entity absent from every arc
 * scene gets an offstage "elsewhere" account.
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
import { generateArcPerspective, availablePerspectiveKeys, otherPerspectiveKeys, perspectiveLabel } from "@/lib/ai";
import { Avatar, ScoreRevealBanner } from "@/components/stage/RoomUI";
import { useImageUrlMap } from "@/hooks/useAssetUrl";
import { IconRefresh, IconUser, IconGlobe } from "@/components/icons";
import { EmptyState } from "@/components/shared/EmptyState";
import type { Arc, NarrativeState } from "@/types/narrative";

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

export function ArcPerspectivesView({
  narrative,
  arc,
}: {
  narrative: NarrativeState;
  arc: Arc;
}) {
  const { state, dispatch } = useStore();
  const resolvedKeys = state.resolvedEntryKeys;

  // Canon = the public narrator + every participant in the arc. Non-canon =
  // every OTHER entity, voiced as an offstage "elsewhere" account (opt-in,
  // generated on demand — kept out of the bulk fan-out).
  const keys = useMemo(() => availablePerspectiveKeys(narrative, arc), [narrative, arc]);
  const otherKeys = useMemo(() => otherPerspectiveKeys(narrative, arc), [narrative, arc]);
  const allKeys = useMemo(() => [...keys, ...otherKeys], [keys, otherKeys]);
  const isOther = useCallback((k: string) => otherKeys.includes(k), [otherKeys]);
  const perspectives = arc.perspectives ?? {};
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("public");

  // Resolve entity portraits for the whole column in one batch.
  const imageRefs = useMemo(
    () => allKeys.map((k) => keyEntity(narrative, k)?.imageUrl ?? undefined),
    [allKeys, narrative],
  );
  const imageMap = useImageUrlMap(imageRefs);

  // Reset selection + error when the arc changes; prefer the first lens that
  // already has a perspective, else the public narrator.
  useEffect(() => {
    setError(null);
    const firstReady = allKeys.find((k) => arc.perspectives?.[k]?.text);
    setSelectedKey(firstReady ?? keys[0] ?? "public");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arc.id]);

  const activeKey = allKeys.includes(selectedKey) ? selectedKey : keys[0] ?? "public";

  // Generate a single perspective and save it.
  const genOne = useCallback(
    async (key: string) => {
      setRunning((s) => new Set(s).add(key));
      try {
        const text = await generateArcPerspective(narrative, arc, key, resolvedKeys);
        dispatch({
          type: "SET_ARC_PERSPECTIVE",
          arcId: arc.id,
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
    [narrative, arc, resolvedKeys, dispatch],
  );

  // ── Palette events — generate ALL in parallel / clear ──
  useEffect(() => {
    async function handleGenerate() {
      setError(null);
      window.dispatchEvent(new CustomEvent("bulk:perspectives-start", { detail: { arcId: arc.id } }));
      try {
        // Fan out every available lens at once — but only the ones NOT already
        // generated. Bulk Generate FILLS GAPS; a full regen is Clear → Generate,
        // and a single lens has its own regenerate button. (Without this, Generate
        // needlessly rewrites perspectives that already exist.)
        const missing = availablePerspectiveKeys(narrative, arc).filter((k) => !arc.perspectives?.[k]?.text);
        await Promise.all(missing.map((k) => genOne(k)));
      } finally {
        window.dispatchEvent(new CustomEvent("bulk:perspectives-complete", { detail: { arcId: arc.id } }));
      }
    }
    function handleClear() {
      dispatch({ type: "CLEAR_ARC_PERSPECTIVES", arcId: arc.id });
      setError(null);
    }
    window.addEventListener("canvas:generate-perspectives", handleGenerate);
    window.addEventListener("canvas:clear-perspectives", handleClear);
    return () => {
      window.removeEventListener("canvas:generate-perspectives", handleGenerate);
      window.removeEventListener("canvas:clear-perspectives", handleClear);
    };
  }, [narrative, arc, dispatch, genOne]);

  const activeView = perspectives[activeKey];
  const activeBusy = running.has(activeKey);
  const activeIsPublic = activeKey === "public";
  const activeIsOther = isOther(activeKey);

  // One avatar row — shared by the canon group and the non-canon "Other" group.
  const renderRow = (key: string) => {
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
            {busy ? "Writing…" : isPublic ? "Narrator" : view ? "Ready" : isOther(key) ? "Elsewhere" : "Empty"}
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
  };

  return (
    <div className="flex h-full">
      {/* Avatar column — one lens per row, image-or-letter map-style grey.
          Canon (public + arc participants) first; a divider then the non-canon
          "Other perspectives" — every entity outside the arc, voiced offstage. */}
      <div className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-white/8 px-2 py-3">
        {keys.map(renderRow)}
        {otherKeys.length > 0 && (
          <>
            <div className="mt-2 flex items-center gap-2 px-2 pt-2 pb-1">
              <div className="h-px flex-1 bg-white/8" />
              <span className="text-[8px] font-semibold uppercase tracking-widest text-text-dim/50">
                Other · non-canon
              </span>
              <div className="h-px flex-1 bg-white/8" />
            </div>
            {otherKeys.map(renderRow)}
          </>
        )}
      </div>

      {/* Reading pane — the selected lens. */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-300/90">
              {error}
            </div>
          )}

          {allKeys.length === 0 ? (
            <EmptyState icon={IconUser} title="No lenses available." hint="This arc has no participants to voice." />
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
                  {activeIsOther && (
                    <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-300/70">
                      non-canon · elsewhere
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

              {/* Conviction scoring feedback for this lens, when the arc was
                  played through a game — the same "score reveal" the game shows. */}
              {!activeIsPublic && arc.scoreFeedback?.[activeKey] && (
                <ScoreRevealBanner impact={arc.scoreFeedback[activeKey].impact} reason={arc.scoreFeedback[activeKey].reason} />
              )}

              <div className="text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap">
                {activeBusy && !activeView ? (
                  <span className="text-text-dim/50">{`Writing ${perspectiveLabel(narrative, activeKey)}'s perspective…`}</span>
                ) : activeView ? (
                  activeView.text
                ) : (
                  <span className="text-text-dim/40">
                    {activeIsOther
                      ? "Not generated. This is a non-canon lens — an entity outside this arc, voiced as a concurrent “elsewhere” account. Use Generate above to write it (it stays out of the bulk fan-out)."
                      : "Not generated. Use Generate in the palette below to write all lenses in parallel, or Generate above for just this one."}
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
