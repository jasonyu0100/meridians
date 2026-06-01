/**
 * location-clusters — derive location clusters from the parent/child graph.
 *
 * A "cluster" is a connected component of the location containment graph: every
 * location reachable from another via `parentId` links (treated as undirected).
 * Each cluster has a single anchor *root* — the top-most ancestor (the member
 * with no parent inside the component) — which is also how a persisted
 * `LocationMap` is matched back to a live cluster.
 *
 * Maps are generated per cluster; the cluster's `signature` (sorted member-id
 * fingerprint) lets the Maps tab detect when a cluster has drifted (a location
 * added or removed) so the corresponding map can be flagged outdated.
 */

import type { Location, LocationMap, MapEdge } from '@/types/narrative';

export type LocationCluster = {
  /** Top-most ancestor location id — the cluster anchor. */
  rootId: string;
  /** Root location's name — the cluster's display name. */
  name: string;
  /** All member location ids, sorted ascending. */
  locationIds: string[];
  /** Parent→child edges among members. */
  edges: MapEdge[];
  /** Sorted member-id fingerprint — compared against a map's stored signature. */
  signature: string;
};

/** Stable fingerprint of a set of member ids. */
export function clusterSignature(locationIds: string[]): string {
  return [...locationIds].sort().join('|');
}

/** Union-Find over location ids. */
class DisjointSet {
  private parent = new Map<string, string>();

  add(id: string) {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression.
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Compute location clusters from the parent/child graph.
 *
 * Only clusters with at least `minSize` members are returned (a map needs
 * spatial structure — a lone location is not a map). Defaults to 2.
 */
export function computeLocationClusters(
  locations: Record<string, Location>,
  minSize = 2,
): LocationCluster[] {
  const ids = Object.keys(locations);
  const ds = new DisjointSet();
  for (const id of ids) ds.add(id);

  // Union each location with its in-set parent — containment is undirected
  // for the purpose of grouping.
  for (const loc of Object.values(locations)) {
    if (loc.parentId && locations[loc.parentId]) {
      ds.union(loc.id, loc.parentId);
    }
  }

  // Bucket members by component root.
  const components = new Map<string, string[]>();
  for (const id of ids) {
    const root = ds.find(id);
    const bucket = components.get(root);
    if (bucket) bucket.push(id);
    else components.set(root, [id]);
  }

  const clusters: LocationCluster[] = [];
  for (const memberIds of components.values()) {
    if (memberIds.length < minSize) continue;

    // Anchor root = the member whose parent is outside the set (top ancestor).
    // Fall back to the most prominent / alphabetically-first member if the
    // component is unexpectedly rootless (e.g. a parentId cycle).
    const anchors = memberIds.filter((id) => {
      const p = locations[id].parentId;
      return !p || !locations[p];
    });
    const rootId = (anchors.length > 0 ? anchors : memberIds)
      .slice()
      .sort((a, b) => prominenceRank(locations[b]) - prominenceRank(locations[a])
        || locations[a].name.localeCompare(locations[b].name))[0];

    const sorted = [...memberIds].sort();
    const edges: MapEdge[] = [];
    for (const id of memberIds) {
      const p = locations[id].parentId;
      if (p && locations[p] && memberIds.includes(p)) {
        edges.push({ from: p, to: id });
      }
    }

    clusters.push({
      rootId,
      name: locations[rootId]?.name ?? 'Unnamed region',
      locationIds: sorted,
      edges,
      signature: clusterSignature(sorted),
    });
  }

  // Largest clusters first — the operator's attention goes to the richest maps.
  clusters.sort((a, b) => b.locationIds.length - a.locationIds.length
    || a.name.localeCompare(b.name));
  return clusters;
}

function prominenceRank(loc: Location): number {
  switch (loc.prominence) {
    case 'domain': return 2;
    case 'place': return 1;
    default: return 0; // margin
  }
}

export type MapStatus = 'none' | 'current' | 'outdated';

/** Find the persisted map for a cluster, matched by root id. */
export function mapForCluster(
  cluster: LocationCluster,
  maps: Record<string, LocationMap> | undefined,
): LocationMap | null {
  if (!maps) return null;
  return Object.values(maps).find((m) => m.rootLocationId === cluster.rootId) ?? null;
}

/** Status of a cluster's map: never generated, current, or drifted (outdated). */
export function clusterMapStatus(
  cluster: LocationCluster,
  map: LocationMap | null,
): MapStatus {
  if (!map || !map.imageUrl) return 'none';
  return map.signature === cluster.signature ? 'current' : 'outdated';
}
