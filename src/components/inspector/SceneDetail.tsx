"use client";

// SceneDetail — inspector view for a scene: forces, cube mode, participants, and structural deltas.

import { computeForceSnapshots, detectCubeCorner, getEffectivePovId, resolveEntityName } from "@/lib/forces/narrative-utils";
import { useStore } from "@/lib/state/store";
import { formatTimeDelta } from "@/lib/forces/time-deltas";
import { isScene, resolveEntry, type InspectorContext, type NarrativeState, type Scene } from "@/types/narrative";
import { useMemo, useState } from "react";
import { InlineText } from "./InlineEdit";

type Props = {
  sceneId: string;
};

export default function SceneDetail({ sceneId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const forceSnapshot = useMemo(() => {
    if (!narrative) return { fate: 0, world: 0, system: 0 };
    const allScenes = state.resolvedEntryKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
    const forceMap = computeForceSnapshots(allScenes);
    return forceMap[sceneId] ?? { fate: 0, world: 0, system: 0 };
  }, [narrative, state.resolvedEntryKeys, sceneId]);

  const entry = narrative ? resolveEntry(narrative, sceneId) : null;

  // Entities introduced by this scene — taken directly from the authoritative
  // new* arrays. IDs are filtered against narrative.* so stale introductions
  // (e.g. an entity removed during revision) don't render as dead links.
  const firstAppearances = useMemo<{
    characters: string[];
    locations: string[];
    artifacts: string[];
    threads: string[];
  }>(() => {
    const empty = { characters: [], locations: [], artifacts: [], threads: [] };
    if (!narrative || !entry || entry.kind !== "scene") return empty;
    return {
      characters: (entry.newCharacters ?? [])
        .map((c) => c.id)
        .filter((id) => narrative.characters[id]),
      locations: (entry.newLocations ?? [])
        .map((l) => l.id)
        .filter((id) => narrative.locations[id]),
      artifacts: (entry.newArtifacts ?? [])
        .map((a) => a.id)
        .filter((id) => narrative.artifacts[id]),
      threads: (entry.newThreads ?? [])
        .map((t) => t.id)
        .filter((id) => narrative.threads[id]),
    };
  }, [narrative, entry]);

  if (!narrative) return null;
  if (!entry) return null;

  // ── World Build Commit view ─────────────────────────────────────────────
  if (entry.kind === "world_build") {
    const m = entry.expansionManifest;
    const totalWorldNodes = (m.worldDeltas ?? []).reduce(
      (acc, cm) => acc + (cm.addedNodes?.length ?? 0),
      0,
    );
    const isEmpty =
      m.newCharacters.length === 0 &&
      m.newLocations.length === 0 &&
      m.newThreads.length === 0 &&
      (m.newArtifacts?.length ?? 0) === 0 &&
      (m.systemDeltas?.addedNodes?.length ?? 0) === 0 &&
      (m.worldDeltas?.length ?? 0) === 0 &&
      (m.relationshipDeltas?.length ?? 0) === 0 &&
      (m.ownershipDeltas?.length ?? 0) === 0 &&
      (m.tieDeltas?.length ?? 0) === 0;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline gap-2">
          <h2 className="font-mono text-xs text-text-dim">{entry.id}</h2>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
            World Build
          </span>
        </div>

        <p className="text-xs text-text-secondary leading-relaxed">
          {entry.summary || "No summary available."}
        </p>

        {entry.createdAt && (() => {
          const dt = new Date(entry.createdAt);
          if (Number.isNaN(dt.getTime())) return null;
          return (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Committed
              </h3>
              <div className="flex flex-col gap-0.5">
                <div className="text-xs text-text-secondary font-mono">
                  {dt.toLocaleString(undefined, {
                    year: 'numeric', month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </div>
                <div className="text-[10px] text-text-dim">{entry.createdAt}</div>
              </div>
            </div>
          );
        })()}

        <div className="flex flex-col gap-1.5">
          {isEmpty && (
            <p className="text-[10px] text-text-dim italic">
              This expansion added nothing new.
            </p>
          )}
          {m.newCharacters.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Characters
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {m.newCharacters.map((mc) => {
                  const char = narrative.characters[mc.id];
                  return (
                    <button
                      key={mc.id}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "character", characterId: mc.id },
                        })
                      }
                      className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {char?.name ?? mc.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {m.newLocations.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Locations
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {m.newLocations.map((ml) => {
                  const loc = narrative.locations[ml.id];
                  return (
                    <button
                      key={ml.id}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "location", locationId: ml.id },
                        })
                      }
                      className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {loc?.name ?? ml.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {m.newThreads.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Threads
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {m.newThreads.map((mt) => {
                  const thread = narrative.threads[mt.id];
                  const depCount =
                    thread?.dependents?.filter((id) => narrative.threads[id])
                      .length ?? 0;
                  return (
                    <button
                      key={mt.id}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "thread", threadId: mt.id },
                        })
                      }
                      className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {thread?.description ?? mt.description}
                      {depCount > 0 && (
                        <span className="text-cyan-400/70 ml-1">
                          &#x21C4;{depCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(m.newArtifacts?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Artifacts
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {m.newArtifacts!.map((ma) => {
                  const art = narrative.artifacts?.[ma.id];
                  return (
                    <button
                      key={ma.id}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "artifact", artifactId: ma.id },
                        })
                      }
                      className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {art?.name ?? ma.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(m.systemDeltas?.addedNodes?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                System Knowledge
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {m.systemDeltas!.addedNodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() =>
                      dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "system-full" })
                    }
                    className="rounded bg-white/6 px-1.5 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                  >
                    {node.concept}
                    <span className="text-text-dim ml-1">({node.type})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {(m.worldDeltas?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                World ({totalWorldNodes})
              </h3>
              <div className="flex flex-col gap-0.5">
                {m.worldDeltas!.map((cm, i) => {
                  const char = narrative.characters[cm.entityId];
                  const loc = narrative.locations[cm.entityId];
                  const art = narrative.artifacts?.[cm.entityId];
                  const name = resolveEntityName(narrative, cm.entityId);
                  const kind = char
                    ? "character"
                    : loc
                      ? "location"
                      : art
                        ? "artifact"
                        : null;
                  return (
                    <button
                      key={`${cm.entityId}-${i}`}
                      type="button"
                      disabled={!kind}
                      onClick={() => {
                        if (kind === "character")
                          dispatch({
                            type: "SET_INSPECTOR",
                            context: {
                              type: "character",
                              characterId: cm.entityId,
                            },
                          });
                        else if (kind === "location")
                          dispatch({
                            type: "SET_INSPECTOR",
                            context: {
                              type: "location",
                              locationId: cm.entityId,
                            },
                          });
                        else if (kind === "artifact")
                          dispatch({
                            type: "SET_INSPECTOR",
                            context: {
                              type: "artifact",
                              artifactId: cm.entityId,
                            },
                          });
                      }}
                      className="text-left text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-60"
                    >
                      <span className="font-mono text-text-dim mr-1">
                        {cm.entityId}
                      </span>
                      {name}
                      <span className="text-text-dim ml-1">
                        +{cm.addedNodes?.length ?? 0} node
                        {(cm.addedNodes?.length ?? 0) === 1 ? "" : "s"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(m.relationshipDeltas?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Relationship Shifts
              </h3>
              <div className="flex flex-col gap-0.5">
                {m.relationshipDeltas!.map((rm, i) => {
                  const from = narrative.characters[rm.from]?.name ?? rm.from;
                  const to = narrative.characters[rm.to]?.name ?? rm.to;
                  const sign = rm.valenceDelta > 0 ? "+" : "";
                  return (
                    <div
                      key={`${rm.from}-${rm.to}-${i}`}
                      className="text-[10px] text-text-secondary"
                    >
                      <span className="text-text-primary">{from}</span>
                      <span className="text-text-dim mx-1">&rarr;</span>
                      <span className="text-text-primary">{to}</span>
                      <span className="text-text-dim ml-1">{rm.type}</span>
                      <span className="text-fate ml-1">
                        ({sign}
                        {rm.valenceDelta.toFixed(2)})
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {(m.ownershipDeltas?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Ownership
              </h3>
              <div className="flex flex-col gap-0.5">
                {m.ownershipDeltas!.map((om, i) => {
                  const art = narrative.artifacts?.[om.artifactId];
                  const fromName = resolveEntityName(narrative, om.fromId);
                  const toName = resolveEntityName(narrative, om.toId);
                  return (
                    <div
                      key={`${om.artifactId}-${i}`}
                      className="text-[10px] text-text-secondary"
                    >
                      <span className="text-text-primary">
                        {art?.name ?? om.artifactId}
                      </span>
                      <span className="text-text-dim mx-1">:</span>
                      <span>{fromName}</span>
                      <span className="text-text-dim mx-1">&rarr;</span>
                      <span>{toName}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {(m.tieDeltas?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Ties
              </h3>
              <div className="flex flex-col gap-0.5">
                {m.tieDeltas!.map((tm, i) => {
                  const loc = narrative.locations[tm.locationId];
                  const char = narrative.characters[tm.characterId];
                  return (
                    <div
                      key={`${tm.locationId}-${tm.characterId}-${i}`}
                      className="text-[10px] text-text-secondary"
                    >
                      <span className="text-text-primary">
                        {char?.name ?? tm.characterId}
                      </span>
                      <span className="text-text-dim mx-1">
                        {tm.action === "add" ? "joined" : "left"}
                      </span>
                      <span className="text-text-primary">
                        {loc?.name ?? tm.locationId}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Scene Commit view ───────────────────────────────────────────────────
  const scene = entry as Scene;
  const location = narrative.locations[scene.locationId];
  const effectivePovId = getEffectivePovId(scene);
  const povCharacter = effectivePovId
    ? narrative.characters[effectivePovId]
    : null;

  const cubeCorner = detectCubeCorner(forceSnapshot);

  const arc = Object.values(narrative.arcs).find((a) =>
    a.sceneIds.includes(sceneId),
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Scene ID + Arc */}
      <div className="flex items-baseline gap-2">
        <h2 className="font-mono text-xs text-text-dim">{scene.id}</h2>
        {arc && (
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "SET_INSPECTOR",
                context: { type: "arc", arcId: arc.id },
              })
            }
            className="text-[10px] text-text-dim uppercase tracking-wider hover:text-text-secondary transition-colors"
          >
            {arc.name}
          </button>
        )}
      </div>

      {/* Location + POV */}
      <div className="flex flex-col gap-1.5">
        {location && (
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "SET_INSPECTOR",
                context: { type: "location", locationId: location.id },
              })
            }
            className="flex items-center gap-1.5 text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            <svg
              className="w-3.5 h-3.5 shrink-0 text-text-dim"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
            <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">
              Location
            </span>
            {location.name}
          </button>
        )}
        {povCharacter && (
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "SET_INSPECTOR",
                context: { type: "character", characterId: povCharacter.id },
              })
            }
            className="flex items-center gap-1.5 text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            <svg
              className="w-3.5 h-3.5 shrink-0 text-text-dim"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">
              POV
            </span>
            {povCharacter.name}
          </button>
        )}
      </div>

      {/* Summary — editable */}
      <InlineText
        value={scene.summary}
        onSave={(summary) => dispatch({ type: "UPDATE_SCENE", sceneId: scene.id, patch: { summary } })}
        multiline
        placeholder="Click to write a scene summary."
        className="text-xs text-text-secondary leading-relaxed"
        inputClassName="text-xs leading-relaxed"
      />

      {/* First Appearances — entities introduced for the first time in this scene */}
      {(firstAppearances.characters.length > 0 ||
        firstAppearances.locations.length > 0 ||
        firstAppearances.artifacts.length > 0 ||
        firstAppearances.threads.length > 0) && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-emerald-400/15 bg-emerald-400/5 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <svg
              className="w-3 h-3 shrink-0 text-emerald-400/80"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2l1.8 5.5L19 9l-5 3.5L15.5 19 12 15.5 8.5 19 10 12.5 5 9l5.2-1.5z" />
            </svg>
            <h3 className="text-[10px] uppercase tracking-widest font-semibold text-emerald-400/80">
              First Appearances
            </h3>
            <span className="ml-auto text-[10px] text-emerald-400/40 font-mono tabular-nums">
              {firstAppearances.characters.length +
                firstAppearances.locations.length +
                firstAppearances.artifacts.length +
                firstAppearances.threads.length}
            </span>
          </div>
          {firstAppearances.characters.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wider text-text-dim">
                Characters · {firstAppearances.characters.length}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {firstAppearances.characters.map((cid) => {
                  const c = narrative.characters[cid];
                  if (!c) return null;
                  return (
                    <button
                      key={cid}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "character", characterId: cid },
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100 transition-colors hover:bg-emerald-400/20"
                    >
                      <span>{c.name}</span>
                      <span className="text-[8px] uppercase tracking-wider text-emerald-400/60">
                        {c.role}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {firstAppearances.locations.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wider text-text-dim">
                Locations · {firstAppearances.locations.length}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {firstAppearances.locations.map((lid) => {
                  const l = narrative.locations[lid];
                  if (!l) return null;
                  return (
                    <button
                      key={lid}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "location", locationId: lid },
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100 transition-colors hover:bg-emerald-400/20"
                    >
                      <span>{l.name}</span>
                      <span className="text-[8px] uppercase tracking-wider text-emerald-400/60">
                        {l.prominence}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {firstAppearances.artifacts.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wider text-text-dim">
                Artifacts · {firstAppearances.artifacts.length}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {firstAppearances.artifacts.map((aid) => {
                  const a = narrative.artifacts[aid];
                  if (!a) return null;
                  return (
                    <button
                      key={aid}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "artifact", artifactId: aid },
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100 transition-colors hover:bg-emerald-400/20"
                    >
                      <span>{a.name}</span>
                      <span className="text-[8px] uppercase tracking-wider text-emerald-400/60">
                        {a.significance}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {firstAppearances.threads.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wider text-text-dim">
                Threads · {firstAppearances.threads.length}
              </span>
              <div className="flex flex-col gap-1">
                {firstAppearances.threads.map((tid) => {
                  const t = narrative.threads[tid];
                  if (!t) return null;
                  return (
                    <button
                      key={tid}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "thread", threadId: tid },
                        })
                      }
                      className="group flex items-start gap-1.5 rounded bg-emerald-400/10 px-2 py-1 text-left transition-colors hover:bg-emerald-400/20"
                    >
                      <span className="shrink-0 font-mono text-[9px] text-emerald-400/60">
                        {tid}
                      </span>
                      <span className="text-[10px] leading-tight text-emerald-100">
                        {t.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Time Transition — natural-language phrase + signed gap. Negative
          values are flashbacks; zero is concurrent / opening. */}
      {scene.timeDelta && (() => {
        const td = scene.timeDelta;
        const gap = formatTimeDelta(td);
        const phrase = td.transition?.trim();
        const isFlashback = td.value < 0;
        const isConcurrent = td.value === 0;
        const accent = isFlashback
          ? "text-violet-400"
          : isConcurrent
            ? "text-text-dim"
            : "text-amber-400";
        return (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
              Time Transition
            </h3>
            <div className="flex flex-col gap-0.5">
              <div className={`text-xs font-medium ${accent}`}>
                {isFlashback ? "↶ " : isConcurrent ? "= " : "→ "}
                {gap}
              </div>
              {phrase && (
                <div className="text-xs italic text-text-secondary">
                  &ldquo;{phrase}&rdquo;
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Generation timestamp — wall-clock when this scene was committed.
          Surfaced for credibility on predictions: "this forecast was made on
          DATE". Stamped at the boundary by every generation path; absent on
          older scenes that pre-date the field. */}
      {scene.createdAt && (() => {
        const dt = new Date(scene.createdAt);
        if (Number.isNaN(dt.getTime())) return null;
        return (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
              Committed
            </h3>
            <div className="flex flex-col gap-0.5">
              <div className="text-xs text-text-secondary font-mono">
                {dt.toLocaleString(undefined, {
                  year: 'numeric', month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </div>
              <div className="text-[10px] text-text-dim">
                {scene.createdAt}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Participants */}
      {scene.participantIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Participants
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {scene.participantIds.map((cid, cidIdx) => {
              const character = narrative.characters[cid];
              if (!character) return null;
              return (
                <button
                  key={`${cid}-${cidIdx}`}
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_INSPECTOR",
                      context: { type: "character", characterId: cid },
                    })
                  }
                  className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                >
                  {character.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Artifact Usages */}
      {(scene.artifactUsages ?? []).length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Artifacts
          </h3>
          <div className="flex flex-col gap-1.5">
            {(scene.artifactUsages ?? []).map((au, auIdx) => {
              const artifact = narrative.artifacts[au.artifactId];
              const character = au.characterId
                ? narrative.characters[au.characterId]
                : null;
              if (!artifact) return null;
              return (
                <div
                  key={`${au.artifactId}-${au.characterId}-${auIdx}`}
                  className="flex flex-col gap-0.5"
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: {
                            type: "artifact",
                            artifactId: au.artifactId,
                          },
                        })
                      }
                      className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300 transition-colors hover:bg-amber-400/20"
                    >
                      {artifact.name}
                    </button>
                    {character && (
                      <span className="text-[10px] text-text-dim">
                        ({character.name})
                      </span>
                    )}
                  </div>
                  {au.usage && (
                    <span className="text-[10px] text-text-dim pl-2">
                      {au.usage}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Force Snapshot */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <svg width="24" height="12" viewBox="0 0 24 12">
            {cubeCorner.key.split("").map((c, i) => {
              const isHi = c === "H";
              const colors = ["#EF4444", "#22C55E", "#3B82F6"];
              const barH = isHi ? 10 : 5;
              const barY = isHi ? 1 : 6;
              return (
                <rect
                  key={i}
                  x={i * 9}
                  y={barY}
                  width={7}
                  height={barH}
                  rx={1.5}
                  fill={colors[i]}
                  opacity={isHi ? 1 : 0.4}
                />
              );
            })}
          </svg>
          <span className="text-[11px] text-text-secondary">
            {cubeCorner.name}
          </span>
        </div>
      </div>

      {/* Thread Deltas */}
      {scene.threadDeltas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Thread Deltas
          </h3>
          {scene.threadDeltas.map((tm, tmIdx) => {
            const thread = narrative.threads[tm.threadId];
            const updatesText = (tm.updates ?? [])
              .map((u) => `${u.outcome}${u.evidence >= 0 ? '+' : ''}${u.evidence}`)
              .join(' ');
            return (
              <div
                key={`${tm.threadId}-${tmIdx}`}
                className="flex flex-col gap-0.5 text-xs min-w-0"
              >
                <div className="flex items-start gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: { type: "thread", threadId: tm.threadId },
                      })
                    }
                    className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary transition-colors hover:bg-white/12 shrink-0"
                  >
                    {tm.threadId}
                  </button>
                  {thread && (
                    <span className="text-text-dim text-[10px] break-words min-w-0">
                      {thread.description}
                    </span>
                  )}
                </div>
                <div className="text-text-dim text-[10px] break-words min-w-0">
                  [{tm.logType}] {updatesText}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* World Deltas */}
      {scene.worldDeltas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            World Deltas
          </h3>
          {scene.worldDeltas.flatMap((km, kmIdx) => {
            const entityName = resolveEntityName(narrative, km.entityId);
            const entityContext: InspectorContext | null = narrative.characters[km.entityId]
              ? { type: "character", characterId: km.entityId }
              : narrative.locations[km.entityId]
                ? { type: "location", locationId: km.entityId }
                : narrative.artifacts?.[km.entityId]
                  ? { type: "artifact", artifactId: km.entityId }
                  : null;
            return (km.addedNodes ?? []).map((node, nIdx) => (
              <div
                key={`${km.entityId}-${node.id}-${kmIdx}-${nIdx}`}
                className="flex items-start gap-1.5 text-xs"
              >
                <span className="shrink-0 text-world">+</span>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        entityContext &&
                        dispatch({ type: "SET_INSPECTOR", context: entityContext })
                      }
                      disabled={!entityContext}
                      className="text-text-primary transition-colors hover:underline disabled:no-underline disabled:cursor-default"
                    >
                      {entityName}
                    </button>
                    <span className="font-mono text-[10px] text-text-dim">
                      {node.id}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: { type: "world", entityId: km.entityId, nodeId: node.id },
                      })
                    }
                    className="text-text-secondary text-left hover:text-text-primary transition-colors"
                  >
                    {node.content}
                  </button>
                </div>
              </div>
            ));
          })}
        </div>
      )}

      {/* Relationship Deltas */}
      {scene.relationshipDeltas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Relationship Deltas
          </h3>
          {scene.relationshipDeltas.map((rm, i) => {
            const fromName = narrative.characters[rm.from]?.name ?? rm.from;
            const toName = narrative.characters[rm.to]?.name ?? rm.to;
            return (
              <div
                key={`${rm.from}-${rm.to}-${i}`}
                className="flex flex-col gap-0.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: { type: "character", characterId: rm.from },
                      })
                    }
                    className="text-text-primary transition-colors hover:underline"
                  >
                    {fromName}
                  </button>
                  <span className="text-text-dim">→</span>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: { type: "character", characterId: rm.to },
                      })
                    }
                    className="text-text-primary transition-colors hover:underline"
                  >
                    {toName}
                  </button>
                  <span
                    className={
                      rm.valenceDelta >= 0 ? "text-world" : "text-fate"
                    }
                  >
                    {rm.valenceDelta > 0 ? "+" : ""}
                    {rm.valenceDelta}
                  </span>
                </div>
                {rm.type && (
                  <span className="text-[10px] uppercase tracking-[0.12em] text-text-dim/80 font-mono pl-2">
                    {rm.type}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Ownership Deltas */}
      {(scene.ownershipDeltas?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Artifact Transfers
          </h3>
          {scene.ownershipDeltas!.map((om, i) => {
            const artName = resolveEntityName(narrative, om.artifactId);
            const fromName = resolveEntityName(narrative, om.fromId);
            const toName = resolveEntityName(narrative, om.toId);
            return (
              <div
                key={`om-${om.artifactId}-${i}`}
                className="flex items-center gap-1.5 text-xs"
              >
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_INSPECTOR",
                      context: { type: "artifact", artifactId: om.artifactId },
                    })
                  }
                  className="text-amber-400 transition-colors hover:underline"
                >
                  {artName}
                </button>
                <span className="text-text-dim">
                  {fromName} → {toName}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Tie Deltas */}
      {(scene.tieDeltas?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Ties
          </h3>
          {scene.tieDeltas!.map((mm, i) => {
            const charName =
              narrative.characters[mm.characterId]?.name ?? mm.characterId;
            const locName =
              narrative.locations[mm.locationId]?.name ?? mm.locationId;
            return (
              <div
                key={`mm-${mm.locationId}-${mm.characterId}-${i}`}
                className="flex items-center gap-1.5 text-xs"
              >
                <span
                  className={mm.action === "add" ? "text-world" : "text-fate"}
                >
                  {mm.action === "add" ? "+" : "−"}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_INSPECTOR",
                      context: {
                        type: "character",
                        characterId: mm.characterId,
                      },
                    })
                  }
                  className="text-text-primary transition-colors hover:underline"
                >
                  {charName}
                </button>
                <span className="text-text-dim">
                  {mm.action === "add" ? "joins" : "leaves"}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_INSPECTOR",
                      context: { type: "location", locationId: mm.locationId },
                    })
                  }
                  className="text-text-primary transition-colors hover:underline"
                >
                  {locName}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* System Knowledge Deltas — additions only; edges live on the graph */}
      {(scene.systemDeltas?.addedNodes?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            System Knowledge
          </h3>
          {scene.systemDeltas!.addedNodes.map((node, i) => (
            <button
              key={`wk-node-${node.id}-${i}`}
              type="button"
              onClick={() =>
                dispatch({
                  type: "SET_INSPECTOR",
                  context: { type: "knowledge", nodeId: node.id },
                })
              }
              className="flex items-start gap-1.5 text-xs text-left hover:text-text-primary transition-colors"
            >
              <span className="shrink-0 text-world">+</span>
              <span className="min-w-0 text-text-primary">
                {node.concept}{' '}
                <span className="text-[10px] text-text-dim">({node.type})</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Attributions — what this scene acts on, split by force (World / System
          / Thread) with a segmented toggle. */}
      <SceneAttributions scene={scene} narrative={narrative} dispatch={dispatch} />

      {/* Events */}
      {scene.events.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Events
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {scene.events.map((evt, evtIdx) => (
              <span
                key={`${evt}-${evtIdx}`}
                className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400/80"
              >
                {evt}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Scene attributions split by force. The scene's flat `attributions` list mixes
 *  entity (World), system (System), and thread (Fate) ids; a segmented toggle
 *  views one force at a time. System ids freshly ADDED this scene are excluded
 *  (they're shown as creational additions above). */
type AttrForce = "world" | "system" | "thread";

function SceneAttributions({
  scene,
  narrative,
  dispatch,
}: {
  scene: Scene;
  narrative: NarrativeState;
  dispatch: (action: { type: "SET_INSPECTOR"; context: InspectorContext }) => void;
}) {
  const [force, setForce] = useState<AttrForce>("world");
  const addedSys = new Set((scene.systemDeltas?.addedNodes ?? []).map((n) => n.id));
  const attrs = scene.attributions ?? [];

  // Only show ids that resolve to a real node/entity/thread — a generation pass
  // can attribute a hallucinated or stale (pre-remap) id that points to nothing.
  const groups: Record<AttrForce, string[]> = {
    world: attrs.filter((id) =>
      (id.startsWith("C-") && narrative.characters[id]) ||
      (id.startsWith("L-") && narrative.locations[id]) ||
      (id.startsWith("A-") && narrative.artifacts[id]),
    ),
    system: attrs.filter((id) => id.startsWith("SYS-") && !addedSys.has(id) && narrative.systemGraph.nodes[id]),
    thread: attrs.filter((id) => id.startsWith("T-") && narrative.threads[id]),
  };
  const total = groups.world.length + groups.system.length + groups.thread.length;
  if (total === 0) return null;

  // Show the selected force, falling back to the first non-empty one.
  const active: AttrForce = groups[force].length > 0
    ? force
    : (["world", "system", "thread"] as AttrForce[]).find((f) => groups[f].length > 0) ?? force;

  const shortSystem = (concept: string) => {
    const dash = concept.indexOf(" — ");
    return dash > 0 ? concept.slice(0, dash) : concept;
  };
  const resolve = (id: string): { label: string; title: string; context: InspectorContext } => {
    if (id.startsWith("C-")) return { label: narrative.characters[id]?.name ?? id, title: narrative.characters[id]?.name ?? id, context: { type: "character", characterId: id } };
    if (id.startsWith("L-")) return { label: narrative.locations[id]?.name ?? id, title: narrative.locations[id]?.name ?? id, context: { type: "location", locationId: id } };
    if (id.startsWith("A-")) return { label: narrative.artifacts[id]?.name ?? id, title: narrative.artifacts[id]?.name ?? id, context: { type: "artifact", artifactId: id } };
    if (id.startsWith("SYS-")) { const n = narrative.systemGraph.nodes[id]; return { label: n ? shortSystem(n.concept) : id, title: n ? `${n.concept} (${n.type})` : id, context: { type: "knowledge", nodeId: id } }; }
    const t = narrative.threads[id];
    return { label: t?.description ?? id, title: t?.description ?? id, context: { type: "thread", threadId: id } };
  };

  const TABS: { key: AttrForce; label: string }[] = [
    { key: "world", label: "World" },
    { key: "system", label: "System" },
    { key: "thread", label: "Thread" },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
          Attributions
          <span className="ml-1.5 font-mono normal-case tracking-normal text-text-dim/60">{total}</span>
        </h3>
        <div className="flex items-center gap-0.5 rounded-md bg-white/4 p-0.5">
          {TABS.map((t) => {
            const count = groups[t.key].length;
            return (
              <button
                key={t.key}
                type="button"
                disabled={count === 0}
                onClick={() => setForce(t.key)}
                className={`rounded px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  active === t.key ? "bg-white/12 text-text-primary" : "text-text-dim hover:text-text-secondary"
                }`}
              >
                {t.label} <span className="font-mono tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {groups[active].map((id) => {
          const r = resolve(id);
          return (
            <button
              key={`attr-${id}`}
              type="button"
              onClick={() => dispatch({ type: "SET_INSPECTOR", context: r.context })}
              title={r.title}
              className="max-w-full truncate rounded border border-white/10 bg-white/2 px-1.5 py-0.5 text-[10px] text-text-secondary transition-colors hover:border-white/20 hover:text-text-primary"
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

