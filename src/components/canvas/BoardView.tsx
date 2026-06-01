'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { useImageUrl, useImageUrlMap } from '@/hooks/useAssetUrl';
import { computeCumulativePositions } from '@/lib/positions';
import { GLOBAL_MAP_ROOT, GLOBAL_MAP_TITLE } from '@/lib/location-clusters';
import type { Character, LocationMap, NarrativeState } from '@/types/narrative';
import { IconMapPin } from '@/components/icons';

/** Label text = the English/Latin portion of a name; strips a trailing CJK
 *  parenthetical ("White Stone Pass (白石关)" → "White Stone Pass"). */
function displayLabel(name: string): string {
  const m = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (m && /[A-Za-z]/.test(m[1])) return m[1].trim();
  return name.trim();
}

/** Resolve the map rooted at a given location id (GLOBAL_MAP_ROOT → the
 *  synthetic global map). */
function mapByRoot(maps: Record<string, LocationMap>, rootId: string): LocationMap | undefined {
  return Object.values(maps).find((m) => m.rootLocationId === rootId);
}

/** True when `locId` is `ancestorId` itself or sits anywhere in its subtree —
 *  walks the parent chain upward (cycle-guarded). Used so a character standing
 *  in a sub-location rolls up into the territory label that contains it. */
function isWithin(locations: NarrativeState['locations'], locId: string, ancestorId: string): boolean {
  let cur: string | undefined = locId;
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
  maps: Record<string, LocationMap>,
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
function buildPath(narrative: NarrativeState, maps: Record<string, LocationMap>, start: string): string[] {
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

/** Pick the most useful starting board: the map that shows the current scene's
 *  location as a region, else the global map, else any map with an image. */
function pickStartRoot(
  narrative: NarrativeState,
  maps: Record<string, LocationMap>,
  currentLocId: string | null,
): string | null {
  const all = Object.values(maps);
  if (all.length === 0) return null;
  if (currentLocId) {
    // Prefer the deepest map containing the location (rooted nearest to it).
    const containing = all
      .filter((m) => m.imageUrl && m.locationIds.includes(currentLocId))
      .sort((a, b) => b.locationIds.length - a.locationIds.length); // smaller scope = nearer; but locationIds count ~ proxy
    // A tighter board (fewer members) is usually the more specific one.
    const nearest = containing.sort((a, b) => a.locationIds.length - b.locationIds.length)[0];
    if (nearest) return nearest.rootLocationId;
  }
  const global = mapByRoot(maps, GLOBAL_MAP_ROOT);
  if (global?.imageUrl) return GLOBAL_MAP_ROOT;
  const withImage = all.find((m) => m.imageUrl) ?? all[0];
  return withImage?.rootLocationId ?? null;
}

/** Small circular character avatar — image when available, else an initial. */
function Avatar({ char, url, onClick }: { char: Character; url: string | null; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={char.name}
      className="w-7 h-7 rounded-full overflow-hidden border-2 border-white shadow-md bg-bg-elevated flex items-center justify-center shrink-0 hover:ring-2 hover:ring-accent transition-shadow"
    >
      {url
        ? <img src={url} alt={char.name} className="w-full h-full object-cover" />
        : <span className="text-[10px] font-bold text-text-secondary">{char.name[0] ?? '?'}</span>}
    </button>
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
  const maps = useMemo(() => narrative?.maps ?? {}, [narrative]);

  const currentScene = useMemo(() => {
    if (!narrative) return null;
    const key = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    return key ? narrative.scenes[key] ?? null : null;
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  // Each character's current location (latest participated scene up to head).
  const charsByLocation = useMemo(() => {
    const m = new Map<string, Character[]>();
    if (!narrative) return m;
    const positions = computeCumulativePositions(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
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

  // Navigation stack of map roots; current = last. Reset to a fresh path when
  // the narrative changes (kept across scene changes so the user stays put).
  const startPath = useMemo(() => {
    if (!narrative) return [];
    const start = pickStartRoot(narrative, maps, currentScene?.locationId ?? null);
    return start ? buildPath(narrative, maps, start) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrative?.id]);
  const [stack, setStack] = useState<string[]>(startPath);
  useEffect(() => { setStack(startPath); }, [startPath]);

  const currentRoot = stack[stack.length - 1] ?? null;
  const currentMap = currentRoot ? (currentRoot === GLOBAL_MAP_ROOT ? mapByRoot(maps, GLOBAL_MAP_ROOT) : mapByRoot(maps, currentRoot)) : undefined;
  const imageUrl = useImageUrl(currentMap?.imageUrl);

  const push = useCallback((rootId: string) => setStack((s) => [...s, rootId]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const jumpTo = useCallback((idx: number) => setStack((s) => s.slice(0, idx + 1)), []);

  // The map directly above the current one (nearest ancestor with its own map,
  // or the Global board). Clicking the title ascends to it.
  const parentRoot = currentRoot && narrative ? parentMapRoot(narrative, maps, currentRoot) : null;
  const goToParent = useCallback(() => {
    if (parentRoot && narrative) setStack(buildPath(narrative, maps, parentRoot));
  }, [parentRoot, narrative, maps]);

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
    return <div className="flex items-center justify-center h-full"><p className="text-text-dim text-sm italic">No world view selected.</p></div>;
  }
  if (Object.keys(maps).length === 0 || !currentMap) {
    return (
      <div className="flex items-center justify-center h-full px-6">
        <p className="text-text-dim text-sm italic text-center max-w-sm">
          No maps yet. Generate territory maps in the Media drive (Maps tab) and place their labels to navigate them here.
        </p>
      </div>
    );
  }

  // Child labels = members other than the root, in placement order. Each label
  // is drillable when a map is rooted at that location.
  const labels = (currentMap.labels ?? []).filter((lb) => lb.locationId !== currentMap.rootLocationId);

  const renderCluster = (locId: string) => {
    // Gather everyone whose current location is this territory or any
    // descendant of it — a character in a sub-location counts as "inside" the
    // label that contains it. Sibling labels on a map are disjoint subtrees, so
    // no one is double-counted.
    const chars: Character[] = [];
    for (const [exactLoc, bucket] of charsByLocation) {
      if (isWithin(narrative.locations, exactLoc, locId)) chars.push(...bucket);
    }
    if (chars.length === 0) return null;
    const shown = chars.slice(0, 6);
    return (
      <div className="flex -space-x-2 mt-1 justify-center">
        {shown.map((c) => (
          <Avatar key={c.id} char={c} url={c.imageUrl ? charImages.get(c.imageUrl) ?? null : null} onClick={() => inspectCharacter(c.id)} />
        ))}
        {chars.length > shown.length && (
          <span className="w-7 h-7 rounded-full bg-black/70 text-white text-[9px] font-bold flex items-center justify-center border-2 border-white shadow-md shrink-0">
            +{chars.length - shown.length}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="relative h-full flex flex-col bg-bg-base">
      {/* Breadcrumb / navigation strip */}
      <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b border-border">
        <button
          onClick={back}
          disabled={stack.length <= 1}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded text-text-dim hover:text-text-primary hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Back to parent map"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back
        </button>
        <div className="w-px h-3.5 bg-white/10" />
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
          {stack.map((rootId, idx) => (
            <div key={rootId} className="flex items-center gap-1 shrink-0">
              {idx > 0 && <span className="text-text-dim/40 text-[10px]">›</span>}
              <button
                onClick={() => jumpTo(idx)}
                className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                  idx === stack.length - 1 ? 'text-text-primary font-medium' : 'text-text-dim hover:text-text-secondary hover:bg-white/5'
                }`}
              >
                {titleOf(rootId)}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Board */}
      <div ref={areaRef} className="flex-1 min-h-0 overflow-hidden flex items-center justify-center p-6">
        {imageUrl ? (
          // Explicit 4:3 box sized to fit the measured area, so the whole map
          // always stays inside its allocation. Maps are generated 4:3, matching
          // the aspect labels were normalized against — labels (placed as 0..1
          // fractions) line up exactly.
          <div className="relative select-none" style={{ width: board.w, height: board.h }}>
            <img src={imageUrl} alt={currentMap.name} className="absolute inset-0 w-full h-full object-cover rounded-lg border border-border shadow-lg" draggable={false} />

            {/* Map title — clicking ascends to the parent map when one exists. */}
            <div className="absolute top-0 inset-x-0 flex justify-center pt-3">
              <button
                onClick={goToParent}
                disabled={!parentRoot}
                title={parentRoot ? `Up to ${titleOf(parentRoot)}` : titleOf(currentRoot!)}
                className={`px-4 py-1 rounded-full bg-slate-50/80 text-slate-900 text-lg font-bold tracking-wide shadow-[0_1px_6px_rgba(0,0,0,0.45)] ring-1 transition-all ${
                  parentRoot ? 'ring-accent/40 hover:ring-accent cursor-pointer' : 'ring-black/10 cursor-default'
                }`}
              >
                {titleOf(currentRoot!)}
              </button>
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
                    onClick={() => drillRoot && push(drillRoot)}
                    disabled={!drillRoot}
                    title={drillRoot ? `Open ${name} map` : name}
                    className={`flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full bg-slate-50/80 text-slate-900 text-[11px] font-bold tracking-wide whitespace-nowrap shadow-[0_1px_6px_rgba(0,0,0,0.45)] ring-1 transition-all ${
                      drillRoot ? 'ring-accent/40 hover:ring-accent cursor-pointer' : 'ring-black/10 cursor-default'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-sm shrink-0" />
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
                    onClick={() => drillRoot && push(drillRoot)}
                    disabled={!drillRoot}
                    className={`flex items-center gap-1.5 text-xs flex-1 text-left ${drillRoot ? 'text-accent hover:underline cursor-pointer' : 'text-text-primary cursor-default'}`}
                  >
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
