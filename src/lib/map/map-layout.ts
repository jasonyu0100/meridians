/**
 * map-layout — resolve the location subtree a map covers.
 *
 * Maps are board-game / fantasy-atlas style: the root location is the
 * encompassing territory, and its descendants are nested regions inside it.
 * The spatial construction is left to the image model — we describe the
 * containment *structure* (parent → children) in natural language and seed it
 * with each location's own image prompt, rather than dictating coordinates.
 *
 * This module just resolves *which* locations are in scope and the containment
 * edges/fingerprint among them. Scope is `(rootId, depth)`: the root plus its
 * descendants down to `depth` generations. `depth = Infinity` ⇒ whole subtree.
 */

import type { Location, MapEdge } from '@/types/narrative';
import { clusterSignature } from '@/lib/graph/location-clusters';

export type MapScope = {
  /** Root location id — the encompassing territory. */
  rootId: string;
  /** All in-scope location ids (root + descendants within depth), sorted. */
  memberIds: string[];
  /** Parent→child containment edges among members. */
  edges: MapEdge[];
  /** Sorted member-id fingerprint — compared against a stored map signature. */
  signature: string;
};

/**
 * Member ids = `rootId` + descendants within `depth` generations (BFS over the
 * parent/child graph). `depth = Infinity` (the default) ⇒ whole subtree.
 * Depth 1 = root + its direct children, depth 2 adds grandchildren, etc.
 */
export function computeMapScope(
  locations: Record<string, Location>,
  rootId: string,
  depth: number = Infinity,
): string[] {
  if (!locations[rootId]) return [];
  const members: string[] = [rootId];
  let frontier = [rootId];
  let level = 0;
  while (level < depth && frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of Object.values(locations)) {
        if (child.parentId === id && !members.includes(child.id)) {
          members.push(child.id);
          next.push(child.id);
        }
      }
    }
    frontier = next;
    level += 1;
  }
  return members;
}

/** Resolve a map scope to its members, containment edges, and fingerprint. */
export function buildMapScope(
  locations: Record<string, Location>,
  rootId: string,
  depth: number = Infinity,
): MapScope {
  const memberIds = computeMapScope(locations, rootId, depth);
  const members = new Set(memberIds);
  const edges: MapEdge[] = [];
  for (const id of memberIds) {
    const p = locations[id]?.parentId;
    if (p && members.has(p)) edges.push({ from: p, to: id });
  }
  const sorted = [...memberIds].sort();
  return { rootId, memberIds: sorted, edges, signature: clusterSignature(sorted) };
}
