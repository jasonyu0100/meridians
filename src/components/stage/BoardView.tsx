'use client';
// BoardView — Stage board surface: board-game style map with nested location maps and participant avatars.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/state/store';
import { useImageUrl, useImageUrlMap } from '@/hooks/useAssetUrl';
import { lastKnownPositions } from '@/lib/forces/positions';
import { GLOBAL_MAP_ROOT, GLOBAL_MAP_TITLE } from '@/lib/graph/location-clusters';
import type { Character, Board, NarrativeState } from '@/types/narrative';
import { IconMapPin } from '@/components/icons';
import { EmptyState } from '@/components/shared/EmptyState';

/** How many avatars a cluster shows before collapsing behind a "+N" toggle. */
const COLLAPSED_AVATARS = 5;

/** Label text = the English/Latin portion of a name; strips a trailing CJK
 *  parenthetical ("White Stone Pass (白石关)" → "White Stone Pass"). */
function displayLabel(name: string): string {
  const m = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (m && /[A-Za-z]/.test(m[1])) return m[1].trim();
  return name.trim();
}

/** Resolve the map rooted at a given location id (GLOBAL_MAP_ROOT → the
 *  synthetic global map). */
function mapByRoot(maps: Record<string, Board>, rootId: string): Board | undefined {
  return Object.values(maps).find((m) => m.rootLocationId === rootId);
}

/** True when `locId` is `ancestorId` itself or sits anywhere in its subtree —
 *  walks the parent chain upward (cycle-guarded). Used so a character standing
 *  in a sub-location rolls up into the territory label that contains it. */
function isWithin(locations: NarrativeState['locations'], locId: string, ancestorId: string): boolean {
  let cur: string | null | undefined = locId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = locations[cur]?.parentId;
  }
  return false;
}

/** The map ABOVE the one rooted at `rootId`: the nearest ancestor location that
 *  has its own map, or the global map if `rootId` is a top-level territory.
 *  Returns null when there's no parent map (already at the top). */
function parentMapRoot(
  narrative: NarrativeState,
  maps: Record<string, Board>,
  rootId: string,
): string | null {
  if (rootId === GLOBAL_MAP_ROOT) return null;
  let p = narrative.locations[rootId]?.parentId;
  while (p) {
    if (mapByRoot(maps, p)) return p;
    p = narrative.locations[p]?.parentId;
  }
  const isTopLevel = !narrative.locations[rootId]?.parentId || !narrative.locations[narrative.locations[rootId].parentId!];
  if (isTopLevel && mapByRoot(maps, GLOBAL_MAP_ROOT)) return GLOBAL_MAP_ROOT;
  return null;
}

/** Build the path of map roots from the top down to `start`, so the back
 *  button ascends the real hierarchy even when the user opens mid-tree. */
function buildPath(narrative: NarrativeState, maps: Record<string, Board>, start: string): string[] {
  const path = [start];
  let cur = start;
  const seen = new Set([start]);
  let parent = parentMapRoot(narrative, maps, cur);
  while (parent && !seen.has(parent)) {
    path.unshift(parent);
    seen.add(parent);
    cur = parent;
    parent = parentMapRoot(narrative, maps, cur);
  }
  return path;
}

/** Depth of a location in the containment tree (0 = top-level). */
function locDepth(locations: NarrativeState['locations'], locId: string): number {
  let d = 0;
  let cur: string | null | undefined = locations[locId]?.parentId;
  const seen = new Set<string>([locId]);
  while (cur && !seen.has(cur)) {
    d++;
    seen.add(cur);
    cur = locations[cur]?.parentId;
  }
  return d;
}

/** Pick the most useful starting board for a location:
 *  1. the map that shows the location directly as a region (tightest scope), else
 *  2. the deepest existing map whose subtree still contains it — i.e. the lowest
 *     map in the tree with a child region leading down to the location (so when
 *     the location's own map isn't generated, we land on the nearest ancestor
 *     map that does exist rather than jumping all the way to Global), else
 *  3. the global map, else any map with an image. */
function pickStartRoot(
  narrative: NarrativeState,
  maps: Record<string, Board>,
  currentLocId: string | null,
): string | null {
  const all = Object.values(maps);
  if (all.length === 0) return null;
  if (currentLocId) {
    // 1. Maps that show the location as a region of their own — tightest first.
    const direct = all
      .filter((m) => m.imageUrl && m.locationIds.includes(currentLocId))
      .sort((a, b) => a.locationIds.length - b.locationIds.length);
    if (direct[0]) return direct[0].rootLocationId;
    // 2. No direct map — the deepest existing map whose subtree contains it.
    const containing = all
      .filter(
        (m) =>
          m.imageUrl &&
          m.rootLocationId !== GLOBAL_MAP_ROOT &&
          isWithin(narrative.locations, currentLocId, m.rootLocationId),
      )
      .sort((a, b) => locDepth(narrative.locations, b.rootLocationId) - locDepth(narrative.locations, a.rootLocationId));
    if (containing[0]) return containing[0].rootLocationId;
  }
  const global = mapByRoot(maps, GLOBAL_MAP_ROOT);
  if (global?.imageUrl) return GLOBAL_MAP_ROOT;
  const withImage = all.find((m) => m.imageUrl) ?? all[0];
  return withImage?.rootLocationId ?? null;
}

/** Small circular character avatar — image when available, else an initial.
 *  `active` marks a participant in the current scene with a subtle accent ring
 *  and lifts them above the overlap stack; everyone else renders normally. */
function Avatar({ char, url, onClick, active }: { char: Character; url: string | null; onClick: () => void; active: boolean }) {
  return (
    <button
      onClick={onClick}
      title={active ? `${char.name} · in this scene` : char.name}
      className={`w-7 h-7 rounded-full overflow-hidden shadow-md bg-slate-200 flex items-center justify-center shrink-0 transition-all hover:ring-2 hover:ring-accent ${
        active ? 'ring-2 ring-accent z-10' : ''
      }`}
    >
      {url
        // Runtime-generated avatar (blob/data URL from IndexedDB) — next/image can't optimise it.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt={char.name} className="w-full h-full object-cover" />
        : <span className="text-[10px] font-bold text-slate-500">{char.name[0] ?? '?'}</span>}
    </button>
  );
}

/** Small circular location avatar shown inside a region / title label. Uses the
 *  generated image when available, else a grey letter-fallback circle (map
 *  style) so un-illustrated regions still read as world entities. */
function LocAvatar({ url, name, size = 16 }: { url: string | null; name: string; size?: number }) {
  if (url) {
    return (
      // Runtime-generated avatar (blob/data URL from IndexedDB) — next/image can't optimise it.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0 ring-1 ring-black/10 -ml-0.5"
        draggable={false}
      />
    );
  }
  return (
    <div
      title={name}
      style={{ width: size, height: size }}
      className="rounded-full shrink-0 ring-1 ring-black/10 -ml-0.5 bg-slate-300 flex items-center justify-center"
    >
      <span className="font-bold leading-none text-slate-600" style={{ fontSize: Math.max(8, Math.round(size * 0.5)) }}>
        {name[0]?.toUpperCase() ?? "?"}
      </span>
    </div>
  );
}

/**
 * BoardView — fluid, one-map-at-a-time board viewer.
 *
 * Shows a single annotated map filling the canvas: its labelled regions, and
 * under each label the characters currently at that location (for the active
 * scene) clustered together. Regions that have their own sub-map are clickable
 * to drill in; a breadcrumb + Back ascend to parent maps. Coverage is partial
 * by nature — maps with no image fall back to a region list, regions without a
 * sub-map simply aren't drillable.
 */
export function BoardView() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const maps = useMemo(() => narrative?.boards ?? {}, [narrative]);

  const currentScene = useMemo(() => {
    if (!narrative) return null;
    const key = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    return key ? narrative.scenes[key] ?? null : null;
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  // Per-cluster expand/minimize. Collapsed clusters show only the first few
  // avatars (active-scene members first) + a "+N" toggle; expanded show all.
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const toggleCluster = useCallback((key: string) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Each character's current location (latest participated scene up to head).
  const charsByLocation = useMemo(() => {
    const m = new Map<string, Character[]>();
    if (!narrative) return m;
    const positions = lastKnownPositions(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
    for (const [eid, locId] of Object.entries(positions)) {
      const c = narrative.characters[eid];
      if (!c) continue;
      const bucket = m.get(locId);
      if (bucket) bucket.push(c);
      else m.set(locId, [c]);
    }
    return m;
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  // Character portrait refs for cluster avatars.
  const charImageRefs = useMemo(() => {
    if (!narrative) return [];
    return Object.values(narrative.characters).map((c) => c.imageUrl).filter((u): u is string => !!u);
  }, [narrative]);
  const charImages = useImageUrlMap(charImageRefs);

  // Location image refs for label avatars.
  const locImageRefs = useMemo(() => {
    if (!narrative) return [];
    return Object.values(narrative.locations).map((l) => l.imageUrl).filter((u): u is string => !!u);
  }, [narrative]);
  const locImages = useImageUrlMap(locImageRefs);

  // Navigation stack of map roots; current = last. The path follows the active
  // scene: when the narrative loads or the scene's location changes, jump to the
  // map that shows that location (the user can still drill/ascend within it).
  const startPath = useMemo(() => {
    if (!narrative) return [];
    const start = pickStartRoot(narrative, maps, currentScene?.locationId ?? null);
    return start ? buildPath(narrative, maps, start) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrative?.id, currentScene?.locationId]);
  const [stack, setStack] = useState<string[]>(startPath);
  useEffect(() => { setStack(startPath); }, [startPath]);

  const currentRoot = stack[stack.length - 1] ?? null;
  const currentMap = currentRoot ? (currentRoot === GLOBAL_MAP_ROOT ? mapByRoot(maps, GLOBAL_MAP_ROOT) : mapByRoot(maps, currentRoot)) : undefined;
  const imageUrl = useImageUrl(currentMap?.imageUrl);

  // Navigating between location boards updates the right inspector to the
  // location we land on (skip the synthetic Global root — it has no entity).
  const inspectLocation = useCallback((rootId: string) => {
    if (rootId === GLOBAL_MAP_ROOT || !narrative?.locations[rootId]) return;
    dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: rootId } });
  }, [dispatch, narrative]);

  const push = useCallback((rootId: string) => {
    setStack((s) => [...s, rootId]);
    inspectLocation(rootId);
  }, [inspectLocation]);

  // The map directly above the current one (nearest ancestor with its own map,
  // or the Global board). Clicking the title ascends to it.
  const parentRoot = currentRoot && narrative ? parentMapRoot(narrative, maps, currentRoot) : null;
  const goToParent = useCallback(() => {
    if (parentRoot && narrative) {
      setStack(buildPath(narrative, maps, parentRoot));
      inspectLocation(parentRoot);
    }
  }, [parentRoot, narrative, maps, inspectLocation]);

  // The board is the largest 4:3 box (maps are generated 4:3) that fits the
  // available area. Measuring the area and sizing the box explicitly keeps the
  // map inside its allocation in both dimensions, and gives the % -positioned
  // labels an exact box to anchor to.
  const areaRef = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const PAD = 48; // p-6 (24px) on each side
    const measure = () => {
      const aw = Math.max(0, el.clientWidth - PAD);
      const ah = Math.max(0, el.clientHeight - PAD);
      const w = Math.min(aw, (ah * 4) / 3);
      setBoard({ w, h: (w * 3) / 4 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const inspectCharacter = useCallback((id: string) => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: id } }), [dispatch]);

  const titleOf = useCallback((rootId: string) => {
    if (rootId === GLOBAL_MAP_ROOT) return GLOBAL_MAP_TITLE;
    return displayLabel(maps[rootId]?.name ?? narrative?.locations[rootId]?.name ?? rootId);
  }, [maps, narrative]);

  if (!narrative) {
    return <EmptyState icon={IconMapPin} title="No world view selected." />;
  }
  if (Object.keys(maps).length === 0 || !currentMap) {
    return (
      <EmptyState
        icon={IconMapPin}
        title="No maps yet."
        hint="Generate territory maps in the Media drive (Maps tab) and place their labels to navigate them here."
      />
    );
  }

  // Child labels = members other than the root, in placement order. Each label
  // is drillable when a map is rooted at that location.
  const labels = (currentMap.labels ?? []).filter((lb) => lb.locationId !== currentMap.rootLocationId);

  // Resolve a location's generated image to a displayable URL (null when none).
  const locUrl = (locId: string): string | null => {
    const ref = narrative.locations[locId]?.imageUrl;
    return ref ? locImages.get(ref) ?? null : null;
  };

  // Participants of the active scene — highlighted; sorted to the front so the
  // active cast is on top of the overlap stack.
  const sceneParticipants = new Set(currentScene?.participantIds ?? []);
  const renderAvatars = (chars: Character[], clusterKey: string) => {
    if (chars.length === 0) return null;
    // Active-scene members first, so a collapsed cluster surfaces the cast.
    const ordered = [...chars].sort((a, b) => Number(sceneParticipants.has(b.id)) - Number(sceneParticipants.has(a.id)));
    const expanded = expandedClusters.has(clusterKey);
    const collapsible = ordered.length > COLLAPSED_AVATARS;
    const shown = expanded || !collapsible ? ordered : ordered.slice(0, COLLAPSED_AVATARS);
    const hidden = ordered.length - shown.length;
    return (
      <div className="flex flex-wrap -space-x-2 mt-1 justify-center max-w-50">
        {shown.map((c) => (
          <Avatar key={c.id} char={c} url={c.imageUrl ? charImages.get(c.imageUrl) ?? null : null} active={sceneParticipants.has(c.id)} onClick={() => inspectCharacter(c.id)} />
        ))}
        {collapsible && (
          <button
            onClick={() => toggleCluster(clusterKey)}
            title={expanded ? 'Show fewer' : `Show all ${ordered.length}`}
            className="w-7 h-7 rounded-full bg-slate-200 text-slate-600 text-[9px] font-bold flex items-center justify-center shrink-0 shadow-md hover:ring-2 hover:ring-accent transition-all z-10"
          >
            {expanded ? '–' : `+${hidden}`}
          </button>
        )}
      </div>
    );
  };

  // Everyone whose current location is this territory or any descendant of it —
  // a character in a sub-location counts as "inside" the label that contains it.
  // Sibling labels on a map are disjoint subtrees, so no one is double-counted.
  const renderCluster = (locId: string) =>
    renderAvatars(
      [...charsByLocation]
        .filter(([exactLoc]) => isWithin(narrative.locations, exactLoc, locId))
        .flatMap(([, bucket]) => bucket),
      locId,
    );

  // Members standing at the parent (map root) itself — within the root's
  // territory but not inside any drilled-down child label, so they aren't shown
  // anywhere else. Rendered under the title.
  const parentMembers = [...charsByLocation]
    .filter(([exactLoc]) =>
      isWithin(narrative.locations, exactLoc, currentMap.rootLocationId) &&
      !labels.some((lb) => isWithin(narrative.locations, exactLoc, lb.locationId)),
    )
    .flatMap(([, bucket]) => bucket);

  return (
    <div className="relative h-full flex flex-col bg-bg-base">
      {/* Board — navigation is in the map itself: click the title to ascend to
          the parent map, click a region label to drill into its sub-map. */}
      <div ref={areaRef} className="flex-1 min-h-0 overflow-hidden flex items-center justify-center p-6">
        {imageUrl ? (
          // Explicit 4:3 box sized to fit the measured area, so the whole map
          // always stays inside its allocation. Maps are generated 4:3, matching
          // the aspect labels were normalized against — labels (placed as 0..1
          // fractions) line up exactly.
          <div className="relative select-none" style={{ width: board.w, height: board.h }}>
            {/* Runtime-generated map image (blob/data URL from IndexedDB) — next/image can't optimise it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={currentMap.name} className="absolute inset-0 w-full h-full object-cover rounded-lg border border-border shadow-lg" draggable={false} />

            {/* Map title — clicking ascends to the parent map when one exists.
                Members standing at the parent itself cluster beneath it. */}
            <div className="absolute top-0 inset-x-0 flex flex-col items-center pt-3">
              <button
                onClick={goToParent}
                disabled={!parentRoot}
                title={parentRoot ? `Up to ${titleOf(parentRoot)}` : titleOf(currentRoot!)}
                className={`inline-flex items-center gap-2 px-4 py-1 rounded-full bg-slate-50/80 text-slate-900 text-lg font-bold tracking-wide shadow-[0_1px_6px_rgba(0,0,0,0.45)] ring-1 transition-all ${
                  parentRoot ? 'ring-accent/40 hover:ring-accent cursor-pointer' : 'ring-black/10 cursor-default'
                }`}
              >
                <LocAvatar url={locUrl(currentRoot!)} name={titleOf(currentRoot!)} size={24} />
                {titleOf(currentRoot!)}
              </button>
              {renderAvatars(parentMembers, currentMap.rootLocationId)}
            </div>

            {/* Region labels + character clusters */}
            {labels.map((lb) => {
              const drillRoot = mapByRoot(maps, lb.locationId)?.rootLocationId;
              const name = displayLabel(narrative.locations[lb.locationId]?.name ?? lb.locationId);
              return (
                <div
                  key={lb.locationId}
                  style={{ left: `${lb.x * 100}%`, top: `${lb.y * 100}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                >
                  <button
                    onClick={() => drillRoot ? push(drillRoot) : inspectLocation(lb.locationId)}
                    title={drillRoot ? `Open ${name} map` : `Inspect ${name}`}
                    className={`flex items-center gap-1.5 ${locUrl(lb.locationId) ? 'pl-1 pr-2' : 'px-2'} py-0.5 rounded-full bg-slate-50/80 text-slate-900 text-[11px] font-bold tracking-wide whitespace-nowrap shadow-[0_1px_6px_rgba(0,0,0,0.45)] ring-1 cursor-pointer transition-all ${
                      drillRoot ? 'ring-accent/40 hover:ring-accent' : 'ring-black/10 hover:ring-accent/50'
                    }`}
                  >
                    <LocAvatar url={locUrl(lb.locationId)} name={name} />
                    {name}
                  </button>
                  {renderCluster(lb.locationId)}
                </div>
              );
            })}
          </div>
        ) : (
          // Fallback when the map image hasn't been generated: a region list that
          // still supports navigation + character clusters.
          <div className="w-full max-w-md max-h-full overflow-y-auto space-y-2">
            <p className="text-[11px] text-text-dim/70 mb-2">Map image not generated — showing regions.</p>
            {labels.length === 0 && <p className="text-[11px] text-text-dim/50 italic">No labelled regions on this map.</p>}
            {labels.map((lb) => {
              const drillRoot = mapByRoot(maps, lb.locationId)?.rootLocationId;
              const name = displayLabel(narrative.locations[lb.locationId]?.name ?? lb.locationId);
              return (
                <div key={lb.locationId} className="flex items-center gap-2 rounded-lg border border-border bg-white/3 px-3 py-2">
                  <button
                    onClick={() => drillRoot ? push(drillRoot) : inspectLocation(lb.locationId)}
                    title={drillRoot ? `Open ${name} map` : `Inspect ${name}`}
                    className={`flex items-center gap-1.5 text-xs flex-1 text-left cursor-pointer hover:underline ${drillRoot ? 'text-accent' : 'text-text-primary'}`}
                  >
                    <LocAvatar url={locUrl(lb.locationId)} name={name} />
                    {drillRoot && <IconMapPin size={12} />}
                    {name}
                  </button>
                  {renderCluster(lb.locationId)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
