"use client";

// CharacterDetail — inspector view for a character: role, inner world graph, threads, and image.

import {
  getWorldNodesAtScene,
  getRelationshipsAtScene,
  getThreadIdsAtScene,
  getOwnershipAtScene,
  getTiesAtScene,
} from "@/lib/graph/scene-filter";
import { useStore } from "@/lib/state/store";
import type { CharacterRole } from "@/types/narrative";
import React, { useState } from "react";
import { CollapsibleSection, Paginator, paginateRecent } from "./CollapsibleSection";
import ImagePromptEditor from "./ImagePromptEditor";
import MediaField from "./MediaField";
import { InlineText, InlineSelect } from "./InlineEdit";
import { AttributionsSection } from "./AttributionsSection";

const CHARACTER_ROLES: readonly CharacterRole[] = ["anchor", "recurring", "transient"];
import { buildPlayerGameSummary } from "@/lib/game-theory/game-theory-player";

type Props = {
  characterId: string;
};

const continuityDotColors: Record<string, string> = {
  trait: "bg-violet-400",
  state: "bg-emerald-400",
  history: "bg-amber-400",
  capability: "bg-blue-400",
  opinion: "bg-pink-300",
  relation: "bg-purple-400",
  secret: "bg-amber-500",
  goal: "bg-sky-400",
  weakness: "bg-red-400",
};


export default function CharacterDetail({ characterId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [continuityPage, setContinuityPage] = useState(0);
  const [threadPage, setThreadPage] = useState(0);
  const [relPage, setRelPage] = useState(0);
  const [lifecyclePage, setLifecyclePage] = useState(0);
  if (!narrative) return null;

  const character = narrative.characters[characterId];
  if (!character) return null;

  const sceneKeysUpToCurrent = state.resolvedEntryKeys.slice(
    0,
    state.viewState.currentSceneIndex + 1,
  );

  // Knowledge filtered to current scene
  const worldNodes = getWorldNodesAtScene(
    character.world.nodes,
    characterId,
    narrative.scenes,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  );

  // Threads filtered to current scene
  const threadIds = getThreadIdsAtScene(
    character.threadIds ?? [],
    narrative.threads,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  );

  // Relationships filtered + valence adjusted to current scene
  const relationships = getRelationshipsAtScene(
    narrative,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  ).filter((r) => r.from === characterId || r.to === characterId);

  // Current scene deltas for this character
  const currentSceneKey = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
  const currentScene = currentSceneKey
    ? narrative.scenes[currentSceneKey]
    : null;
  const recentWorldDeltas = currentScene
    ? currentScene.worldDeltas.filter((m) => m.entityId === characterId)
    : [];
  const recentRelationshipDeltas = currentScene
    ? currentScene.relationshipDeltas.filter(
        (rm) => rm.from === characterId || rm.to === characterId,
      )
    : [];
  const recentThreadDeltas = currentScene
    ? currentScene.threadDeltas.filter((tm) =>
        narrative.threads[tm.threadId]?.participants?.some(
          (a) => a.id === characterId,
        ),
      )
    : [];
  // Artifact signals tied specifically to this character:
  //  - usages they performed                         (this character WIELDED the artifact)
  //  - ownership transfers where they're either side (gained / lost an artifact)
  // Scene-wide events (currentScene.events) are intentionally dropped here
  // — they describe what HAPPENED in the scene globally, not what this
  // character did, which is the question this panel is supposed to answer.
  const recentArtifactUsages = currentScene
    ? (currentScene.artifactUsages ?? []).filter((au) => au.characterId === characterId)
    : [];
  const recentOwnershipDeltas = currentScene
    ? (currentScene.ownershipDeltas ?? []).filter((od) => od.fromId === characterId || od.toId === characterId)
    : [];
  const isPov = !!currentScene && currentScene.povId === characterId;
  const isPresent = !!currentScene && currentScene.participantIds.includes(characterId);
  const hasRecentActivity =
    isPov ||
    isPresent ||
    recentWorldDeltas.length > 0 ||
    recentRelationshipDeltas.length > 0 ||
    recentThreadDeltas.length > 0 ||
    recentArtifactUsages.length > 0 ||
    recentOwnershipDeltas.length > 0;

  // Scenes: all scenes up to current scene index where this character participates
  const lifecycle = sceneKeysUpToCurrent
    .map((k) => narrative.scenes[k])
    .filter((s) => s && s.participantIds.includes(characterId))
    .map((s) => ({
      sceneId: s.id,
      worldDeltas: s.worldDeltas.filter(
        (km) => km.entityId === characterId,
      ),
      relationshipDeltas: s.relationshipDeltas.filter(
        (rm) => rm.from === characterId || rm.to === characterId,
      ),
      threadDeltas: s.threadDeltas.filter((tm) =>
        narrative.threads[tm.threadId]?.participants?.some(
          (a) => a.id === characterId,
        ),
      ),
      locationId: s.locationId,
    }));

  return (
    <div className="flex flex-col gap-4">
      {/* Portrait — generated or uploaded; uploads keep their natural ratio */}
      <MediaField
        label="Portrait"
        alt={character.name}
        imageRef={character.imageUrl}
        narrativeId={narrative.id}
        onSet={(imageUrl) => dispatch({ type: "SET_CHARACTER_IMAGE", characterId, imageUrl })}
        onClear={() => dispatch({ type: "SET_CHARACTER_IMAGE", characterId, imageUrl: undefined })}
      />

      {/* Name + ID + role — name & role inline-editable (id · dropdown pattern) */}
      <div className="flex flex-col gap-0.5">
        <InlineText
          value={character.name}
          onSave={(name) => dispatch({ type: "UPDATE_CHARACTER", id: characterId, patch: { name } })}
          className="text-sm font-semibold text-text-primary"
          inputClassName="text-sm font-semibold"
        />
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-text-dim">{characterId}</span>
          <InlineSelect<CharacterRole>
            value={character.role}
            options={CHARACTER_ROLES}
            onSave={(role) => dispatch({ type: "UPDATE_CHARACTER", id: characterId, patch: { role } })}
            className="text-[9px]"
          />
        </div>
      </div>

      {/* Image prompt — editable, with AI suggest from continuity */}
      <ImagePromptEditor
        kind="character"
        entityId={characterId}
        value={character.imagePrompt}
      />


      {/* Recent — current scene activity tied to THIS character only */}
      {hasRecentActivity &&
        currentScene &&
        (() => {
          const totalCount =
            recentWorldDeltas.length +
            recentRelationshipDeltas.length +
            recentThreadDeltas.length +
            recentArtifactUsages.length +
            recentOwnershipDeltas.length;
          const groups: React.ReactNode[] = [];

          // Role in the scene — POV when this character is the POV;
          // "present" when they participate without being POV. Surfaced
          // first so the rest of the deltas read in the right frame.
          if (isPov || isPresent) {
            const locName = narrative.locations[currentScene.locationId]?.name;
            groups.push(
              <div key="role" className="flex items-center gap-1.5 text-[10px]">
                <span className={`uppercase tracking-widest ${isPov ? 'text-pov' : 'text-text-dim'}`}>
                  {isPov ? 'POV' : 'Present'}
                </span>
                {locName && (
                  <span className="text-text-dim/70">at {locName}</span>
                )}
              </div>,
            );
          }
          // Artifact usages performed by this character.
          if (recentArtifactUsages.length > 0) {
            groups.push(
              <ul key="artifact-usages" className="flex flex-col gap-0.5">
                {recentArtifactUsages.map((au, i) => {
                  const art = narrative.artifacts[au.artifactId];
                  return (
                    <li key={`${au.artifactId}-${i}`} className="text-xs text-text-secondary flex items-start gap-1">
                      <span className="shrink-0 text-amber-400">◆</span>
                      <span>
                        <button
                          type="button"
                          onClick={() =>
                            dispatch({
                              type: "SET_INSPECTOR",
                              context: { type: "artifact", artifactId: au.artifactId },
                            })
                          }
                          className="font-mono text-[10px] text-text-dim hover:text-text-secondary transition-colors"
                        >
                          {art?.name ?? au.artifactId}
                        </button>
                        {au.usage && <span className="text-text-secondary"> — {au.usage}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>,
            );
          }
          // Ownership shifts touching this character — gained / lost an artifact.
          if (recentOwnershipDeltas.length > 0) {
            groups.push(
              <ul key="ownership" className="flex flex-col gap-0.5">
                {recentOwnershipDeltas.map((od, i) => {
                  const art = narrative.artifacts[od.artifactId];
                  const gained = od.toId === characterId;
                  const otherId = gained ? od.fromId : od.toId;
                  const otherName = narrative.characters[otherId]?.name ?? narrative.locations[otherId]?.name ?? otherId;
                  return (
                    <li key={`${od.artifactId}-${i}`} className="text-xs text-text-secondary flex items-start gap-1">
                      <span className={`shrink-0 ${gained ? 'text-world' : 'text-drive'}`}>{gained ? '↘' : '↗'}</span>
                      <span>
                        <button
                          type="button"
                          onClick={() =>
                            dispatch({
                              type: "SET_INSPECTOR",
                              context: { type: "artifact", artifactId: od.artifactId },
                            })
                          }
                          className="font-mono text-[10px] text-text-dim hover:text-text-secondary transition-colors"
                        >
                          {art?.name ?? od.artifactId}
                        </button>
                        <span className="text-text-dim/70">
                          {gained ? ' from ' : ' to '}
                          {otherName}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>,
            );
          }
          if (recentThreadDeltas.length > 0) {
            groups.push(
              <ul key="threads" className="flex flex-col gap-0.5">
                {recentThreadDeltas.map((tm, i) => (
                  <li key={i} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "thread", threadId: tm.threadId },
                        })
                      }
                      className="font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary text-left"
                    >
                      {tm.threadId}
                      {narrative.threads[tm.threadId] && (
                        <span className="ml-1.5 font-sans text-text-dim">
                          {narrative.threads[tm.threadId].description}
                        </span>
                      )}
                    </button>
                    <span className="text-xs text-text-secondary">
                      <span className="text-text-dim">[{tm.logType}]</span>
                      {" "}
                      <span className="text-fate">{(tm.updates ?? []).map((u) => `${u.outcome}${u.evidence >= 0 ? '+' : ''}${u.evidence}`).join(' ')}</span>
                    </span>
                  </li>
                ))}
              </ul>,
            );
          }
          if (recentWorldDeltas.length > 0) {
            groups.push(
              <ul key="continuity" className="flex flex-col gap-0.5">
                {recentWorldDeltas.flatMap((km, kmIdx) =>
                  (km.addedNodes ?? []).map((node, nIdx) => (
                    <li
                      key={`${node.id}-${kmIdx}-${nIdx}`}
                      className="flex items-start gap-1"
                    >
                      <span className="shrink-0 text-world">+</span>
                      <span className="text-xs text-text-secondary">
                        {node.content}
                      </span>
                    </li>
                  )),
                )}
              </ul>,
            );
          }
          if (recentRelationshipDeltas.length > 0) {
            groups.push(
              <ul key="relationships" className="flex flex-col gap-0.5">
                {recentRelationshipDeltas.map((rm, rmIdx) => {
                  const otherId = rm.from === characterId ? rm.to : rm.from;
                  const otherName =
                    narrative.characters[otherId]?.name ?? otherId;
                  return (
                    <li
                      key={`${rm.from}-${rm.to}-${rmIdx}`}
                      className="text-xs text-text-secondary"
                    >
                      <span
                        className={
                          rm.valenceDelta >= 0 ? "text-world" : "text-drive"
                        }
                      >
                        {rm.valenceDelta > 0 ? "+" : ""}
                        {rm.valenceDelta}
                      </span>{" "}
                      {otherName}: {rm.type}
                    </li>
                  );
                })}
              </ul>,
            );
          }
          return (
            <CollapsibleSection title="Recent" count={totalCount}>
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_INSPECTOR",
                      context: { type: "scene", sceneId: currentScene.id },
                    })
                  }
                  className="font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary text-left mb-1"
                >
                  {currentScene.id}
                </button>
                {groups.map((group, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <div className="border-t border-white/5 my-1" />}
                    {group}
                  </React.Fragment>
                ))}
              </div>
            </CollapsibleSection>
          );
        })()}

      {/* Continuity — paginated, most recent first */}
      {worldNodes.length > 0 &&
        (() => {
          const { pageItems, totalPages, safePage } = paginateRecent(
            worldNodes,
            continuityPage,
          );
          return (
            <CollapsibleSection
              title="World"
              count={worldNodes.length}
            >
              <ul className="flex flex-col gap-1">
                {pageItems.map((node, i) => (
                  <li key={`${node.id}-${i}`}>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "SET_INSPECTOR", context: { type: "world", entityId: characterId, nodeId: node.id } })}
                      className="flex items-start gap-2 w-full text-left group"
                    >
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${continuityDotColors[node.type] ?? "bg-white/40"}`}
                      />
                      <span className="text-xs text-text-primary group-hover:text-white transition-colors">
                        {node.content}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <Paginator
                page={safePage}
                totalPages={totalPages}
                onPage={setContinuityPage}
              />
            </CollapsibleSection>
          );
        })()}

      {/* Threads — paginated, most recent first */}
      {threadIds.length > 0 &&
        (() => {
          const { pageItems, totalPages, safePage } = paginateRecent(
            threadIds,
            threadPage,
          );
          return (
            <CollapsibleSection title="Threads" count={threadIds.length}>
              <ul className="flex flex-col gap-1">
                {pageItems.map((tid, i) => (
                  <li key={`${tid}-${i}`}>
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "thread", threadId: tid },
                        })
                      }
                      className="block w-full text-left font-mono text-xs text-text-secondary transition-colors hover:text-text-primary"
                    >
                      {tid}
                      {narrative.threads[tid] && (
                        <span className="ml-1.5 font-sans text-text-dim">
                          {narrative.threads[tid].description}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              <Paginator
                page={safePage}
                totalPages={totalPages}
                onPage={setThreadPage}
              />
            </CollapsibleSection>
          );
        })()}

      {/* Artifacts owned by this character (at the current scene) */}
      {(() => {
        const sceneOwnership = getOwnershipAtScene(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
        // Only consider artifacts that have been introduced by this scene.
        // An artifact with no entry in sceneOwnership doesn't yet exist at this
        // point in the timeline — falling back to its final parentId would
        // leak future ownership into earlier scenes.
        const owned = Object.values(narrative.artifacts ?? {}).filter((a) => {
          if (!sceneOwnership.has(a.id)) return false;
          return sceneOwnership.get(a.id) === characterId;
        });
        if (owned.length === 0) return null;
        return (
          <CollapsibleSection title="Artifacts" count={owned.length}>
            <ul className="flex flex-col gap-1">
              {owned.map((art) => (
                <li key={art.id}>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: { type: "artifact", artifactId: art.id },
                      })
                    }
                    className="text-xs text-amber-400 transition-colors hover:underline"
                  >
                    {art.name}
                    <span className="ml-1.5 text-text-dim">
                      ({art.significance})
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        );
      })()}

      {/* Ties — locations this character has a significant bond with (at the current scene) */}
      {(() => {
        const sceneTies = getTiesAtScene(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
        const ties = Object.values(narrative.locations).filter((loc) =>
          (sceneTies.get(loc.id) ?? new Set()).has(characterId),
        );
        if (ties.length === 0) return null;
        return (
          <CollapsibleSection title="Ties" count={ties.length}>
            <ul className="flex flex-col gap-1">
              {ties.map((loc) => (
                <li key={loc.id}>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: { type: "location", locationId: loc.id },
                      })
                    }
                    className="text-xs text-text-primary transition-colors hover:underline"
                  >
                    {loc.name}
                    <span className="ml-1.5 text-[9px] text-text-dim">
                      {loc.prominence}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        );
      })()}

      {/* Relationships — paginated, most recent first */}
      {relationships.length > 0 &&
        (() => {
          const { pageItems, totalPages, safePage } = paginateRecent(
            relationships,
            relPage,
          );
          return (
            <CollapsibleSection
              title="Relationships"
              count={relationships.length}
            >
              <ul className="flex flex-col gap-2">
                {pageItems.map((rel, relIdx) => {
                  const isOutgoing = rel.from === characterId;
                  const otherId = isOutgoing ? rel.to : rel.from;
                  const other = narrative.characters[otherId];
                  const selfName = character.name;
                  const otherName = other?.name ?? otherId;
                  const fromName = isOutgoing ? selfName : otherName;
                  const toName = isOutgoing ? otherName : selfName;
                  const clamped = Math.max(-1, Math.min(1, rel.valence));
                  const pct = Math.abs(clamped) * 100;
                  const isPositive = rel.valence > 0;
                  const isNegative = rel.valence < 0;
                  return (
                    <li
                      key={`${rel.from}-${rel.to}-${rel.type}-${relIdx}`}
                      className="flex flex-col gap-1.5"
                    >
                      {/* Explicit source → destination so direction is unambiguous;
                          the character being viewed is bolded for orientation. */}
                      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
                        <span className={isOutgoing ? "text-text-primary font-semibold" : "text-text-secondary"}>
                          {isOutgoing ? selfName : (
                            <button
                              type="button"
                              onClick={() =>
                                dispatch({
                                  type: "SET_INSPECTOR",
                                  context: { type: "character", characterId: otherId },
                                })
                              }
                              className="hover:underline transition-colors"
                            >
                              {fromName}
                            </button>
                          )}
                        </span>
                        <span className="text-text-dim">→</span>
                        <span className={isOutgoing ? "text-text-secondary" : "text-text-primary font-semibold"}>
                          {isOutgoing ? (
                            <button
                              type="button"
                              onClick={() =>
                                dispatch({
                                  type: "SET_INSPECTOR",
                                  context: { type: "character", characterId: otherId },
                                })
                              }
                              className="hover:underline transition-colors"
                            >
                              {toName}
                            </button>
                          ) : selfName}
                        </span>
                      </div>
                      {rel.type && (
                        <div className="text-[10px] uppercase tracking-[0.12em] text-text-dim/80 font-mono">
                          {rel.type}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden relative">
                          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
                          {isPositive && (
                            <div
                              className="absolute top-0 bottom-0 left-1/2 rounded-r-full"
                              style={{
                                width: `${pct / 2}%`,
                                backgroundColor: "#22C55E",
                              }}
                            />
                          )}
                          {isNegative && (
                            <div
                              className="absolute top-0 bottom-0 rounded-l-full"
                              style={{
                                width: `${pct / 2}%`,
                                right: "50%",
                                backgroundColor: "#EF4444",
                              }}
                            />
                          )}
                        </div>
                        <span
                          className={`text-[10px] font-mono w-6 text-right ${isPositive ? "text-world" : isNegative ? "text-fate" : "text-text-dim"}`}
                        >
                          {rel.valence > 0 ? "+" : ""}
                          {Number(rel.valence.toFixed(2))}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Paginator
                page={safePage}
                totalPages={totalPages}
                onPage={setRelPage}
              />
            </CollapsibleSection>
          );
        })()}

      {/* Scenes — paginated, most recent first */}
      {lifecycle.length > 0 &&
        (() => {
          const { pageItems, totalPages, safePage } = paginateRecent(
            lifecycle,
            lifecyclePage,
          );
          return (
            <CollapsibleSection
              title="Scenes"
              count={lifecycle.length}
            >
              <ul className="flex flex-col gap-2">
                {pageItems.map(
                  ({
                    sceneId,
                    worldDeltas,
                    relationshipDeltas,
                    threadDeltas,
                    locationId,
                  }) => (
                    <li key={sceneId} className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: "SET_INSPECTOR",
                            context: { type: "scene", sceneId },
                          })
                        }
                        className="text-left font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary"
                      >
                        {sceneId}
                      </button>
                      {threadDeltas.map((tm, tmIdx) => (
                        <span
                          key={`${tm.threadId}-${tmIdx}`}
                          className="text-xs text-text-secondary"
                        >
                          {tm.threadId}: [{tm.logType}] {(tm.updates ?? []).map((u) => `${u.outcome}${u.evidence >= 0 ? '+' : ''}${u.evidence}`).join(' ')}
                        </span>
                      ))}
                      {worldDeltas.flatMap((km, kmIdx) =>
                        (km.addedNodes ?? []).map((node, nIdx) => (
                          <div
                            key={`${node.id}-${kmIdx}-${nIdx}`}
                            className="flex items-start gap-1.5 text-xs text-text-secondary"
                          >
                            <span className="shrink-0 text-world">+</span>
                            <span className="min-w-0">{node.content}</span>
                          </div>
                        )),
                      )}
                      {relationshipDeltas.map((rm, rmIdx) => {
                        const isOutgoing = rm.from === characterId;
                        const otherId = isOutgoing ? rm.to : rm.from;
                        const otherName =
                          narrative.characters[otherId]?.name ?? otherId;
                        const fromName = isOutgoing ? character.name : otherName;
                        const toName = isOutgoing ? otherName : character.name;
                        return (
                          <span
                            key={`${rm.from}-${rm.to}-${rmIdx}`}
                            className="text-xs text-text-secondary"
                          >
                            <span
                              className={
                                rm.valenceDelta >= 0
                                  ? "text-world"
                                  : "text-drive"
                              }
                            >
                              {rm.valenceDelta > 0 ? "+" : ""}
                              {rm.valenceDelta}
                            </span>{" "}
                            {fromName} → {toName}
                            {rm.type && (
                              <span className="text-text-dim/80">: {rm.type}</span>
                            )}
                          </span>
                        );
                      })}
                      {locationId && (
                        <span className="text-xs text-text-dim">
                          at {narrative.locations[locationId]?.name ?? locationId}
                        </span>
                      )}
                    </li>
                  ),
                )}
              </ul>
              <Paginator
                page={safePage}
                totalPages={totalPages}
                onPage={setLifecyclePage}
              />
            </CollapsibleSection>
          );
        })()}

      {/* Game theory — per-character ELO trajectory + W/L/D. Pulls
          from gameAnalysis on resolved-branch scenes up to the
          operator's current scene, so the chart matches the scrubber.
          Hidden entirely when this character has never been a
          player. */}
      {(() => {
        const summary = buildPlayerGameSummary(
          narrative,
          characterId,
          state.resolvedEntryKeys,
          state.viewState.currentSceneIndex,
        );
        if (!summary) return null;
        return (
          <CollapsibleSection title="Game theory" count={summary.games}>
            <PlayerGameSummaryView summary={summary} />
          </CollapsibleSection>
        );
      })()}

      <AttributionsSection targetId={characterId} />
    </div>
  );
}

/** Compact per-character ELO + W/L/D summary. Sparkline reads the
 *  trajectory directly; stats list current / peak / trough plus
 *  decisive record. */
function PlayerGameSummaryView({
  summary,
}: {
  summary: ReturnType<typeof buildPlayerGameSummary> & object;
}) {
  const { currentElo, peakElo, troughElo, history, games, wins, losses, draws } = summary;
  return (
    <div className="flex flex-col gap-3">
      <EloSparkline history={history} />
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <Stat label="Current" value={Math.round(currentElo)} accent="text-text-primary" />
        <Stat label="Peak" value={Math.round(peakElo)} accent="text-emerald-300/85" />
        <Stat label="Trough" value={Math.round(troughElo)} accent="text-rose-300/85" />
      </div>
      <div className="grid grid-cols-4 gap-2 text-[10px]">
        <Stat label="Games" value={games} />
        <Stat label="W" value={wins} accent="text-emerald-300/85" />
        <Stat label="L" value={losses} accent="text-rose-300/85" />
        <Stat label="D" value={draws} accent="text-text-dim/85" />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = 'text-text-secondary',
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider font-mono text-text-dim/60">
        {label}
      </span>
      <span className={`text-[12px] font-mono tabular-nums ${accent}`}>{value}</span>
    </div>
  );
}

function EloSparkline({ history }: { history: number[] }) {
  if (history.length < 2) {
    return (
      <div className="h-16 flex items-center justify-center text-[10px] text-text-dim/50 italic">
        Trajectory appears after the first game.
      </div>
    );
  }
  const W = 280;
  const H = 64;
  const PAD = 4;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const xAt = (i: number) => PAD + ((W - 2 * PAD) * i) / (history.length - 1);
  const yAt = (v: number) => PAD + (H - 2 * PAD) * (1 - (v - min) / range);
  const d = history.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(v)}`).join(' ');
  const tail = history[history.length - 1];
  // Final-rating dot in the colour of the trajectory's net direction.
  const netColour = tail >= history[0] ? '#34d399' : '#fb7185';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16 text-text-dim">
      {/* Baseline at the starting ELO so the line's direction is legible. */}
      <line
        x1={PAD}
        x2={W - PAD}
        y1={yAt(history[0])}
        y2={yAt(history[0])}
        stroke="currentColor"
        strokeWidth={0.5}
        strokeOpacity={0.4}
        strokeDasharray="2 3"
      />
      <path d={d} fill="none" stroke={netColour} strokeWidth={1.5} opacity={0.85} strokeLinecap="round" />
      <circle cx={xAt(history.length - 1)} cy={yAt(tail)} r={2.5} fill={netColour} opacity={0.95} />
    </svg>
  );
}
