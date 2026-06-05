'use client';

// LocationDetail — inspector view for a location: prominence, accumulated history graph, threads, and image.

import { useState } from 'react';
import { useStore } from '@/lib/state/store';
import { buildMapScope } from '@/lib/map/map-layout';
import { getWorldNodesAtScene, getThreadIdsAtScene, getOwnershipAtScene, getTiesAtScene } from '@/lib/graph/scene-filter';
import { CollapsibleSection, Paginator, paginateRecent } from './CollapsibleSection';
import ImagePromptEditor from './ImagePromptEditor';
import MediaField from './MediaField';
import { InlineText, InlineSelect } from './InlineEdit';
import { AttributionsSection } from './AttributionsSection';
import type { LocationProminence } from '@/types/narrative';

const LOCATION_PROMINENCE: readonly LocationProminence[] = ['domain', 'place', 'margin'];

type Props = {
  locationId: string;
};

const continuityDotColors: Record<string, string> = {
  trait: 'bg-violet-400',
  state: 'bg-emerald-400',
  history: 'bg-amber-400',
  capability: 'bg-blue-400',
  opinion: 'bg-pink-300',
  relation: 'bg-purple-400',
  secret: 'bg-amber-500',
  goal: 'bg-sky-400',
  weakness: 'bg-red-400',
};

export default function LocationDetail({ locationId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [continuityPage, setContinuityPage] = useState(0);
  const [threadPage, setThreadPage] = useState(0);
  const [scenesPage, setScenesPage] = useState(0);
  if (!narrative) return null;

  const location = narrative.locations[locationId];
  if (!location) return null;

  // The map (UI: "board") rooted at this location, if one has been generated or uploaded.
  const board = Object.values(narrative.boards ?? {}).find((b) => b.rootLocationId === locationId);

  const parent = location.parentId ? narrative.locations[location.parentId] : null;

  const sceneKeysUpToCurrent = state.resolvedEntryKeys.slice(0, state.viewState.currentSceneIndex + 1);

  // Knowledge filtered to current scene (location knowledge uses locationId as characterId
  // in the delta replay — location-specific knowledge nodes aren't changed by scenes,
  // so we pass the locationId and any matching deltas will be respected)
  const worldNodes = getWorldNodesAtScene(
    location.world.nodes,
    locationId,
    narrative.scenes,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  );

  // Threads filtered to current scene
  const threadIds = getThreadIdsAtScene(
    location.threadIds ?? [],
    narrative.threads,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  );

  // Lifecycle: only scenes up to current scene index
  const locationThreadIds = new Set(location.threadIds ?? []);
  const lifecycle = sceneKeysUpToCurrent
    .map((k) => narrative.scenes[k])
    .filter((s) => s && s.locationId === locationId)
    .map((s) => ({
      sceneId: s.id,
      threadDeltas: s.threadDeltas.filter((tm) => locationThreadIds.has(tm.threadId)),
      worldDeltas: s.worldDeltas.filter((km) => km.entityId === locationId),
      participantIds: s.participantIds,
    }));

  return (
    <div className="flex flex-col gap-4">
      {/* Establishing shot — generated or uploaded; uploads keep their natural ratio */}
      <MediaField
        label="Image"
        alt={location.name}
        imageRef={location.imageUrl}
        narrativeId={narrative.id}
        onSet={(imageUrl) => dispatch({ type: 'SET_LOCATION_IMAGE', locationId, imageUrl })}
        onClear={() => dispatch({ type: 'SET_LOCATION_IMAGE', locationId, imageUrl: undefined })}
      />

      {/* Board — the map rooted at this location, shown beneath the establishing
          shot. Uploadable/clearable on its own; uploading when no board exists
          mints one over the location's 1-depth scope so it joins the map tree. */}
      <MediaField
        label="Board"
        alt={`${location.name} board`}
        imageRef={board?.imageUrl}
        narrativeId={narrative.id}
        onSet={(imageUrl) => {
          const now = Date.now();
          if (board) {
            dispatch({ type: 'SAVE_BOARD', board: { ...board, imageUrl, updatedAt: now } });
          } else {
            const scope = buildMapScope(narrative.locations, locationId, 1);
            dispatch({
              type: 'SAVE_BOARD',
              board: {
                id: `map-${locationId}-${now}`,
                rootLocationId: locationId,
                name: location.name,
                locationIds: scope.memberIds,
                edges: scope.edges,
                signature: scope.signature,
                depth: 1,
                imageUrl,
                createdAt: now,
                updatedAt: now,
              },
            });
          }
        }}
        onClear={() => {
          if (!board) return;
          // Keep a board that carries hand-placed labels (just drop its image);
          // remove an upload-only board outright so no empty shell lingers.
          if ((board.labels?.length ?? 0) > 0) {
            dispatch({ type: 'SAVE_BOARD', board: { ...board, imageUrl: undefined, updatedAt: Date.now() } });
          } else {
            dispatch({ type: 'DELETE_BOARD', boardId: board.id });
          }
        }}
      />

      {/* Name + ID — name + prominence inline-editable */}
      <div className="flex flex-col gap-0.5">
        <InlineText
          value={location.name}
          onSave={(name) => dispatch({ type: 'UPDATE_LOCATION', id: locationId, patch: { name } })}
          className="text-sm font-semibold text-text-primary"
          inputClassName="text-sm font-semibold"
        />
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-text-dim">{locationId}</span>
          <InlineSelect<LocationProminence>
            value={location.prominence}
            options={LOCATION_PROMINENCE}
            onSave={(prominence) => dispatch({ type: 'UPDATE_LOCATION', id: locationId, patch: { prominence } })}
            className="text-[9px]"
          />
        </div>
      </div>

      {/* Parent location — editable (cycle-safe: excludes self + descendants) */}
      {(() => {
        const locs = Object.values(narrative.locations);
        const descendants = new Set<string>();
        const stack = [locationId];
        while (stack.length) {
          const cur = stack.pop()!;
          for (const l of locs) {
            if (l.parentId === cur && !descendants.has(l.id)) { descendants.add(l.id); stack.push(l.id); }
          }
        }
        const options = locs
          .filter((l) => l.id !== locationId && !descendants.has(l.id))
          .sort((a, b) => a.name.localeCompare(b.name));
        return (
          <div className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span className="text-text-dim">in</span>
            <select
              value={location.parentId ?? ''}
              onChange={(e) => dispatch({ type: 'UPDATE_LOCATION', id: locationId, patch: { parentId: e.target.value || null } })}
              title="Set containing location"
              className="cursor-pointer bg-bg-field border border-white/10 rounded px-1.5 py-0.5 text-text-secondary hover:border-accent/50 outline-none transition-colors max-w-[70%] truncate"
            >
              <option value="">— top level —</option>
              {options.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        );
      })()}

      {/* Ties — characters with a significant bond to this location (at the current scene) */}
      {(() => {
        const sceneTies = getTiesAtScene(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
        const tiedIds = Array.from(sceneTies.get(locationId) ?? []);
        const tied = tiedIds.map(id => narrative.characters[id]).filter(Boolean);
        if (tied.length === 0) return null;
        return (
          <CollapsibleSection title="Ties" count={tied.length}>
            <ul className="flex flex-col gap-1">
              {tied.map((char) => (
                <li key={char.id}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: char.id } })}
                    className="text-xs text-text-primary transition-colors hover:underline"
                  >
                    {char.name}
                    <span className="ml-1.5 text-[9px] text-text-dim">{char.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        );
      })()}

      {/* Image prompt — editable, with AI suggest from continuity */}
      <ImagePromptEditor
        kind="location"
        entityId={locationId}
        value={location.imagePrompt}
      />

      {/* Spatial connections */}
      {(() => {
        const allLocations = Object.values(narrative.locations);
        const children = allLocations.filter((l) => l.parentId === locationId);
        const siblings = parent
          ? allLocations.filter((l) => l.parentId === parent.id && l.id !== locationId)
          : [];
        if (children.length === 0 && siblings.length === 0) return null;
        return (
          <CollapsibleSection title="Spatial" count={children.length + siblings.length}>
            <div className="flex flex-col gap-2">
              {children.length > 0 && (
                <div>
                  <span className="text-[9px] text-text-dim uppercase tracking-wide">Contains</span>
                  <ul className="flex flex-col gap-1 mt-1">
                    {children.map((child) => (
                      <li key={child.id}>
                        <button
                          type="button"
                          onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: child.id } })}
                          className="text-xs text-text-primary transition-colors hover:underline"
                        >
                          {child.name}
                          <span className="ml-1.5 text-[9px] text-text-dim">{child.prominence}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {siblings.length > 0 && (
                <div>
                  <span className="text-[9px] text-text-dim uppercase tracking-wide">Nearby</span>
                  <ul className="flex flex-col gap-1 mt-1">
                    {siblings.map((sib) => (
                      <li key={sib.id}>
                        <button
                          type="button"
                          onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: sib.id } })}
                          className="text-xs text-text-secondary transition-colors hover:underline"
                        >
                          {sib.name}
                          <span className="ml-1.5 text-[9px] text-text-dim">{sib.prominence}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CollapsibleSection>
        );
      })()}

      {/* Continuity — paginated, most recent first */}
      {worldNodes.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(worldNodes, continuityPage);
        return (
          <CollapsibleSection title="World" count={worldNodes.length}>
            <ul className="flex flex-col gap-1">
              {pageItems.map((node, i) => (
                <li key={`${node.id}-${i}`}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'world', entityId: locationId, nodeId: node.id } })}
                    className="flex items-start gap-2 w-full text-left group"
                  >
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${continuityDotColors[node.type] ?? 'bg-white/40'}`} />
                    <span className="text-xs text-text-primary group-hover:text-white transition-colors">{node.content}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Paginator page={safePage} totalPages={totalPages} onPage={setContinuityPage} />
          </CollapsibleSection>
        );
      })()}

      {/* Threads — paginated, most recent first */}
      {threadIds.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(threadIds, threadPage);
        return (
          <CollapsibleSection title="Threads" count={threadIds.length}>
            <ul className="flex flex-col gap-1">
              {pageItems.map((tid, i) => (
                <li key={`${tid}-${i}`}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: tid } })}
                    className="block w-full text-left font-mono text-xs text-text-secondary transition-colors hover:text-text-primary"
                  >
                    {tid}
                    {narrative.threads[tid] && (
                      <span className="ml-1.5 font-sans text-text-dim">{narrative.threads[tid].description}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <Paginator page={safePage} totalPages={totalPages} onPage={setThreadPage} />
          </CollapsibleSection>
        );
      })()}

      {/* Artifacts at this location (at the current scene) */}
      {(() => {
        const sceneOwnership = getOwnershipAtScene(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
        // Only artifacts already introduced by this scene. No fallback to
        // final parentId — that leaks future state into the present.
        const owned = Object.values(narrative.artifacts ?? {}).filter((a) => {
          if (!sceneOwnership.has(a.id)) return false;
          return sceneOwnership.get(a.id) === locationId;
        });
        if (owned.length === 0) return null;
        return (
          <CollapsibleSection title="Artifacts" count={owned.length}>
            <ul className="flex flex-col gap-1">
              {owned.map((art) => (
                <li key={art.id}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'artifact', artifactId: art.id } })}
                    className="text-xs text-amber-400 transition-colors hover:underline"
                  >
                    {art.name}
                    <span className="ml-1.5 text-text-dim">({art.significance})</span>
                  </button>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        );
      })()}

      {/* Scenes — paginated, most recent first */}
      {lifecycle.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(lifecycle, scenesPage);
        return (
          <CollapsibleSection title="Scenes" count={lifecycle.length}>
            {pageItems.length > 0 && (
              <ul className="flex flex-col gap-2">
                {pageItems.map(({ sceneId, threadDeltas, worldDeltas, participantIds }) => (
                  <li key={sceneId} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId } })}
                      className="text-left font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary"
                    >
                      {sceneId}
                    </button>
                    {threadDeltas.map((tm, tmIdx) => (
                      <span key={`${tm.threadId}-${tmIdx}`} className="text-xs text-text-secondary">
                        {tm.threadId}: [{tm.logType}] {(tm.updates ?? []).map((u) => `${u.outcome}${u.evidence >= 0 ? '+' : ''}${u.evidence}`).join(' ')}
                      </span>
                    ))}
                    {worldDeltas.flatMap((km, kmIdx) =>
                      (km.addedNodes ?? []).map((node, nIdx) => (
                        <div
                          key={`${km.entityId}-${node.id}-${kmIdx}-${nIdx}`}
                          className="flex items-start gap-1.5 text-xs text-text-secondary"
                        >
                          <span className="shrink-0 text-world">+</span>
                          <span className="min-w-0">{node.content}</span>
                        </div>
                      ))
                    )}
                    {participantIds.length > 0 && (
                      <span className="text-xs text-text-dim">
                        {participantIds
                          .map((id) => narrative.characters[id]?.name ?? id)
                          .join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Paginator page={safePage} totalPages={totalPages} onPage={setScenesPage} />
          </CollapsibleSection>
        );
      })()}

      <AttributionsSection targetId={locationId} />
    </div>
  );
}
