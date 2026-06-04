/**
 * map-tree-layout — arrange annotated territory maps as a top-down tree of
 * image "boards" for the World-graph overlay.
 *
 * Maps are 1-depth (a parent territory + its direct children), so the full
 * hierarchy is a *forest of nested boards*: a board rooted at a parent shows
 * that parent + its children; a child that itself has its own (applicable) map
 * gets its own board one tier below, linked by a containment edge. A synthetic
 * "Global" board (every top-level location) roots the whole thing when present.
 *
 * The module is pure (no React/d3): given the maps, the live location graph,
 * and which locations are currently present in the world-graph scope, it
 * returns the boards to draw (rects in graph coords), the parent→child board
 * edges, and per-location *anchors* — the pinned positions for location nodes,
 * computed from each map's hand-placed labels (normalized 0..1 over the image).
 */

import type { Location, Board } from '@/types/narrative';
import { GLOBAL_MAP_ROOT } from '@/lib/location-clusters';

/** Board geometry, in graph coordinates. 640×480 is 4:3 — matches the aspect
 *  the annotator places labels against, so normalized label coords map cleanly. */
export const BOARD_W = 640;
export const BOARD_H = 480;
export const BOARD_H_GAP = 120; // horizontal gap between sibling subtrees
export const BOARD_V_GAP = 260; // vertical gap between tiers (depth)
/** Y of a board's title text — where a board's own root location is pinned. */
export const BOARD_TITLE_Y = 28;

export type MapBoard = {
  map: Board;
  /** map.rootLocationId — GLOBAL_MAP_ROOT for the synthetic global board. */
  rootId: string;
  /** Tier from the top (0 = forest root / global). */
  depth: number;
  /** Top-left of the board rect, in graph coords. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BoardEdge = { parentRootId: string; childRootId: string };

export type MapTreeLayout = {
  boards: MapBoard[];
  edges: BoardEdge[];
  /** locationId → pinned anchor in graph coords. */
  anchors: Record<string, { x: number; y: number }>;
  /** Convenience: the set of location ids that have an anchor (= keys of `anchors`). */
  pinnedLocationIds: Set<string>;
};

const EMPTY: MapTreeLayout = { boards: [], edges: [], anchors: {}, pinnedLocationIds: new Set() };

/** A location is top-level when it has no parent (or a dangling parent). */
function isTopLevel(locations: Record<string, Location>, id: string): boolean {
  const p = locations[id]?.parentId;
  return !p || !locations[p];
}

/**
 * A map joins the tree when it can usefully anchor nodes:
 *  - has an image, and
 *  - can anchor at least one present, hand-LABELLED sub-region.
 *
 * Crucially this does NOT require the stored signature to match the live scope.
 * A hand-placed label is a durable position for its own location, so honour it
 * even after the hierarchy drifts (e.g. a Rebuild-hierarchy re-parent) — the
 * worst case is a slightly stale backdrop image, while node positions stay
 * correct. Present sub-regions that lack a label simply float (no position to
 * pin them to); they don't disqualify the whole board.
 */
function isApplicable(
  map: Board,
  presentLocationIds: Set<string>,
): boolean {
  if (!map.imageUrl) return false;
  const labelled = new Set((map.labels ?? []).map((l) => l.locationId));
  return map.locationIds.some(
    (id) => id !== map.rootLocationId && presentLocationIds.has(id) && labelled.has(id),
  );
}

/**
 * Build the top-down tree-of-boards layout for the maps applicable to the
 * locations currently present in the world graph. Returns empty when none
 * apply.
 */
export function buildMapTreeLayout(args: {
  maps: Record<string, Board>;
  locations: Record<string, Location>;
  presentLocationIds: Set<string>;
}): MapTreeLayout {
  const { maps, locations, presentLocationIds } = args;

  // 1. Applicable maps, keyed by root.
  const applicable = new Map<string, Board>();
  for (const m of Object.values(maps ?? {})) {
    if (isApplicable(m, presentLocationIds)) applicable.set(m.rootLocationId, m);
  }
  if (applicable.size === 0) return EMPTY;

  const hasGlobal = applicable.has(GLOBAL_MAP_ROOT);

  // 2. Forest linkage. A board's parent is the board rooted at its root's parent
  //    location (1-depth containment); top-level roots attach to global if present.
  const parentOf = new Map<string, string | null>();
  for (const rootId of applicable.keys()) {
    if (rootId === GLOBAL_MAP_ROOT) { parentOf.set(rootId, null); continue; }
    const parentLocId = locations[rootId]?.parentId;
    if (parentLocId && applicable.has(parentLocId)) parentOf.set(rootId, parentLocId);
    else if (hasGlobal && isTopLevel(locations, rootId)) parentOf.set(rootId, GLOBAL_MAP_ROOT);
    else parentOf.set(rootId, null);
  }

  const childrenOf = new Map<string, string[]>();
  for (const [rootId, parent] of parentOf) {
    if (parent == null) continue;
    const bucket = childrenOf.get(parent);
    if (bucket) bucket.push(rootId);
    else childrenOf.set(parent, [rootId]);
  }
  const nameOf = (rootId: string) =>
    applicable.get(rootId)?.name ?? locations[rootId]?.name ?? rootId;
  const sortKids = (ids: string[]) => [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  // 3. Tidy top-down layout. Subtree width bottom-up; each node centered over
  //    its (centered) children block.
  // A board descends from where its root sits on the map ABOVE: each child
  // board is centered under its root's label position on the parent board (so
  // the tree mirrors the spatial arrangement of the higher map), de-overlapped
  // left-to-right. Root boards (no map above) lay out in a row. Tier by depth.
  const boards: MapBoard[] = [];
  const boardByRootId = new Map<string, MapBoard>();
  const tierY = (depth: number) => depth * (BOARD_H + BOARD_V_GAP);

  const makeBoard = (rootId: string, depth: number, centerX: number): MapBoard => {
    const b: MapBoard = {
      map: applicable.get(rootId)!,
      rootId,
      depth,
      x: centerX - BOARD_W / 2,
      y: tierY(depth),
      w: BOARD_W,
      h: BOARD_H,
    };
    boards.push(b);
    boardByRootId.set(rootId, b);
    return b;
  };

  const placeChildren = (b: MapBoard) => {
    const kids = sortKids(childrenOf.get(b.rootId) ?? []);
    if (kids.length === 0) return;
    const labelX = new Map((b.map.labels ?? []).map((l) => [l.locationId, l.x] as const));
    // Desired center = the child root's label x on THIS board (the map above),
    // so a child board hangs directly below its region. Sort by that x, then
    // push right to avoid overlap while preserving left-to-right order.
    const desired = kids
      .map((k) => ({ k, cx: b.x + (labelX.get(k) ?? 0.5) * b.w }))
      .sort((a, z) => a.cx - z.cx);
    let prevRight = -Infinity;
    for (const { k, cx } of desired) {
      const center = Math.max(cx, prevRight + BOARD_H_GAP + BOARD_W / 2);
      const child = makeBoard(k, b.depth + 1, center);
      prevRight = child.x + BOARD_W;
      placeChildren(child);
    }
  };

  // Place each forest-root subtree at a temporary origin, then shift it right of
  // the previous subtree's extent so subtrees never overlap.
  const roots = sortKids([...applicable.keys()].filter((id) => parentOf.get(id) == null));
  let cursorLeft = 0;
  for (const root of roots) {
    const startIdx = boards.length;
    makeBoard(root, 0, 0);
    placeChildren(boardByRootId.get(root)!);
    const subtree = boards.slice(startIdx);
    const shift = cursorLeft - Math.min(...subtree.map((b) => b.x));
    for (const b of subtree) b.x += shift;
    cursorLeft = Math.max(...subtree.map((b) => b.x + b.w)) + BOARD_H_GAP;
  }

  // 4. Recenter the whole layout on the origin (matches forceCenter(0,0)).
  const minX = Math.min(...boards.map((b) => b.x));
  const maxX = Math.max(...boards.map((b) => b.x + b.w));
  const minY = Math.min(...boards.map((b) => b.y));
  const maxY = Math.max(...boards.map((b) => b.y + b.h));
  const offX = -(minX + maxX) / 2;
  const offY = -(minY + maxY) / 2;
  for (const b of boards) { b.x += offX; b.y += offY; }

  // 5. Edges.
  const edges: BoardEdge[] = [];
  for (const [rootId, parent] of parentOf) {
    if (parent != null && applicable.has(parent)) edges.push({ parentRootId: parent, childRootId: rootId });
  }

  // 6. Anchors. A location is positioned by the map ABOVE it — its label on its
  //    parent board — so it sits relative to its sibling regions. Phase 1 lays
  //    every present label as a pin. Phase 2 is a fallback only for forest-root
  //    territories (no map above): pin them to their own board's title so they
  //    still have a home.
  const anchors: Record<string, { x: number; y: number }> = {};
  for (const b of boards) {
    for (const lb of b.map.labels ?? []) {
      if (!presentLocationIds.has(lb.locationId)) continue;
      // Only the board that CURRENTLY contains this location is authoritative —
      // so a stale label left on a former parent's map (after a re-parent) can't
      // hijack the position from the location's real parent board.
      const belongs = b.rootId === GLOBAL_MAP_ROOT
        ? isTopLevel(locations, lb.locationId)
        : locations[lb.locationId]?.parentId === b.rootId;
      if (!belongs) continue;
      anchors[lb.locationId] = { x: b.x + lb.x * b.w, y: b.y + lb.y * b.h };
    }
  }
  for (const b of boards) {
    if (b.rootId === GLOBAL_MAP_ROOT) continue;      // synthetic — no node to pin
    if (parentOf.get(b.rootId) != null) continue;    // positioned by the map above
    if (!presentLocationIds.has(b.rootId)) continue;
    if (anchors[b.rootId]) continue;
    anchors[b.rootId] = { x: b.x + b.w / 2, y: b.y + BOARD_TITLE_Y };
  }

  return { boards, edges, anchors, pinnedLocationIds: new Set(Object.keys(anchors)) };
}
