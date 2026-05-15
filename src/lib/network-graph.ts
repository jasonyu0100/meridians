/**
 * Network graph — the cumulative activation pattern across the narrative.
 * Aggregates attributions from every scene and world-build onto the real
 * entities/threads/system nodes. Scenes and world builds explicitly declare
 * which IDs they structurally lean on (`scene.attributions`) and how they
 * connect (`scene.attributionEdges`); the network walks them in timeline
 * order and grows.
 *
 * Network nodes: characters, locations, artifacts, threads, system nodes.
 * Network edges: typed connections declared via attributionEdges, using the
 *   shared CRG edge ontology (enables / constrains / requires / etc.).
 *
 * Each node carries two annotation dimensions:
 *
 *   1. tier     — heat snapshot       (hot / warm / cold / fresh)
 *   2. topology — position in the web (bridge / hub / leaf / isolated)
 *
 * Tier answers "how load-bearing is this node right now"; topology answers
 * "is it a cross-force connector, a within-cohort centre, a peripheral leaf,
 * or standing alone". Everything else the narrative already records directly
 * on the entity (threads carry market state, characters carry continuity,
 * scenes carry deltas) — duplicating it as network annotations was noise.
 */

import type { NarrativeState } from "@/types/narrative";

/** Window in graphs where freshly-introduced nodes get the "fresh" tier
 *  regardless of count. Set to 1 — only nodes first seen in the LATEST
 *  attribution step qualify as fresh. Wider windows preempt the hot/warm/cold
 *  tertile classifier in early game (3 graphs × FRESH_WINDOW=3 means every
 *  attributed node is fresh) — keeping it tight makes freshness a small,
 *  meaningful cohort. */
export const FRESH_WINDOW = 1;

/** Minimum attribution count required to be classified as "hot" — even when
 *  a node sits in the top tertile, it can't be hot until it's actually been
 *  referenced this many times. Prevents single-attribution nodes from
 *  reading as load-bearing in early game. */
const HOT_MIN_ATTRIBUTIONS = 2;

export type NetworkNodeKind =
  | "character"
  | "location"
  | "artifact"
  | "thread"
  | "system";

export type Force = "fate" | "world" | "system";

export type HeatTier = "hot" | "warm" | "cold" | "fresh";
export type Topology = "bridge" | "hub" | "leaf" | "isolated";

export type NetworkNode = {
  id: string;
  kind: NetworkNodeKind;
  label: string;
  /** Total attributions across every scene/world-build that referenced this id. */
  attributions: number;
  /** Attribution-step index (scene/world-build position in the timeline) where
   *  this node first received an attribution. -1 if the node has never been
   *  referenced. */
  firstSeenIndex: number;
  /** Attribution-step index of the most recent reference. -1 if never. */
  lastSeenIndex: number;
  /** Heat snapshot — relative to the rest of the network. */
  tier: HeatTier;
  /** Position in the network web. Bridges connect ≥2 distinct cohorts;
   *  hubs are well-connected within one cohort; leafs have a single edge;
   *  isolated have none. */
  topology: Topology;
};

export type NetworkEdge = {
  from: string;
  to: string;
  /** Number of times an attributionEdge connected these two ids across the
   *  aggregated scenes / world builds. */
  weight: number;
};

export type NetworkGraph = {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  /** Total number of attribution steps (scenes + world builds) aggregated. */
  graphCount: number;
};

// ── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Walk scenes + world builds in timeline order and accumulate attribution
 * counts and edges onto the real entities/threads/system nodes. Each scene
 * and world build that declares `attributions` / `attributionEdges` counts
 * as one step in the cumulative network; ids appearing in the attribution
 * list bump their count by one, and declared edges add weight between
 * endpoints.
 *
 * When `resolvedKeys` + `currentIndex` are provided, aggregation is
 * PROGRESSIVE: only scenes / world builds at or before `currentIndex` in the
 * resolved timeline are visited. When omitted, every scene and world build
 * in the narrative is visited (in the order they appear in their record
 * objects — branch-aware progressive mode is the supported path).
 */
export function aggregateNetworkGraph(
  narrative: NarrativeState,
  resolvedKeys?: string[],
  currentIndex?: number,
): NetworkGraph {
  const attributions = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  const lastSeen = new Map<string, number>();
  const edgeWeights = new Map<string, number>();

  let stepIndex = 0;
  let stepCount = 0;

  const visitStep = (
    attributionList: ReadonlyArray<string> | undefined,
    edgeList: ReadonlyArray<{ from: string; to: string }> | undefined,
  ) => {
    if ((!attributionList || attributionList.length === 0) &&
        (!edgeList || edgeList.length === 0)) {
      // No attribution data on this step — skip without advancing stepIndex
      // so empty steps don't dilute freshness windows.
      return;
    }
    stepCount += 1;
    const seenThisStep = new Set<string>();
    for (const ref of attributionList ?? []) {
      if (!ref || seenThisStep.has(ref)) continue;
      seenThisStep.add(ref);
      attributions.set(ref, (attributions.get(ref) ?? 0) + 1);
      if (!firstSeen.has(ref)) firstSeen.set(ref, stepIndex);
      lastSeen.set(ref, stepIndex);
    }
    for (const edge of edgeList ?? []) {
      if (!edge?.from || !edge?.to || edge.from === edge.to) continue;
      const key = edge.from < edge.to
        ? `${edge.from}|${edge.to}`
        : `${edge.to}|${edge.from}`;
      edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
      // Edge endpoints that weren't in the explicit attribution list still
      // count as referenced — declaring an edge IS attribution.
      for (const ref of [edge.from, edge.to]) {
        if (seenThisStep.has(ref)) continue;
        seenThisStep.add(ref);
        attributions.set(ref, (attributions.get(ref) ?? 0) + 1);
        if (!firstSeen.has(ref)) firstSeen.set(ref, stepIndex);
        lastSeen.set(ref, stepIndex);
      }
    }
    stepIndex += 1;
  };

  // Decide which scenes and world builds are in scope for the current cutoff.
  // In progressive mode we also collect the set of entity / system ids that
  // have actually been introduced by scenes or world builds at or before the
  // cutoff, so a later world expansion's nodes don't leak into earlier views.
  const useProgressive = resolvedKeys !== undefined && currentIndex !== undefined;
  type Step =
    | { kind: "scene"; id: string }
    | { kind: "world_build"; id: string };
  let timelineOrderedItems: Step[] = [];
  const introducedEntityIds = new Set<string>();
  const introducedSystemIds = new Set<string>();

  if (useProgressive) {
    const keysInRange = resolvedKeys!.slice(0, currentIndex! + 1);
    for (const key of keysInRange) {
      const scene = narrative.scenes[key];
      if (scene) {
        timelineOrderedItems.push({ kind: "scene", id: scene.id });
        for (const c of scene.newCharacters ?? []) introducedEntityIds.add(c.id);
        for (const l of scene.newLocations ?? []) introducedEntityIds.add(l.id);
        for (const a of scene.newArtifacts ?? []) introducedEntityIds.add(a.id);
        for (const t of scene.newThreads ?? []) introducedEntityIds.add(t.id);
        for (const sn of scene.systemDeltas?.addedNodes ?? []) introducedSystemIds.add(sn.id);
        continue;
      }
      const wb = narrative.worldBuilds[key];
      if (wb) {
        timelineOrderedItems.push({ kind: "world_build", id: wb.id });
        for (const c of wb.expansionManifest.newCharacters) introducedEntityIds.add(c.id);
        for (const l of wb.expansionManifest.newLocations) introducedEntityIds.add(l.id);
        for (const a of wb.expansionManifest.newArtifacts ?? []) introducedEntityIds.add(a.id);
        for (const t of wb.expansionManifest.newThreads) introducedEntityIds.add(t.id);
        for (const sn of wb.expansionManifest.systemDeltas?.addedNodes ?? []) introducedSystemIds.add(sn.id);
      }
    }
  } else {
    timelineOrderedItems = [
      ...Object.values(narrative.scenes).map((s) => ({ kind: "scene" as const, id: s.id })),
      ...Object.values(narrative.worldBuilds).map((w) => ({ kind: "world_build" as const, id: w.id })),
    ];
  }

  for (const item of timelineOrderedItems) {
    if (item.kind === "scene") {
      const scene = narrative.scenes[item.id];
      if (scene) visitStep(scene.attributions, scene.attributionEdges);
    } else {
      const wb = narrative.worldBuilds[item.id];
      if (wb) visitStep(
        wb.expansionManifest.attributions,
        wb.expansionManifest.attributionEdges,
      );
    }
  }

  // graphCount is the legacy field name; preserve it on the return so callers
  // that already render "across N reasoning graphs" continue to work — but
  // populate it with stepCount (scenes + world builds visited).
  const graphCount = stepCount;

  // Build the raw nodes — one per real entity/thread/system node, including
  // unreferenced ones (they appear cold/isolated). In progressive mode skip
  // anything not yet introduced by the cutoff so a later world build's
  // characters / threads / system nodes don't bleed back into earlier scenes.
  const includeEntity = (id: string) => !useProgressive || introducedEntityIds.has(id);
  const includeSystem = (id: string) => !useProgressive || introducedSystemIds.has(id);
  const rawNodes: NetworkNode[] = [];
  for (const c of Object.values(narrative.characters)) {
    if (!includeEntity(c.id)) continue;
    rawNodes.push(blankNode(c.id, "character", c.name, attributions, firstSeen, lastSeen));
  }
  for (const l of Object.values(narrative.locations)) {
    if (!includeEntity(l.id)) continue;
    rawNodes.push(blankNode(l.id, "location", l.name, attributions, firstSeen, lastSeen));
  }
  for (const a of Object.values(narrative.artifacts ?? {})) {
    if (!includeEntity(a.id)) continue;
    rawNodes.push(blankNode(a.id, "artifact", a.name, attributions, firstSeen, lastSeen));
  }
  for (const t of Object.values(narrative.threads)) {
    if (!includeEntity(t.id)) continue;
    rawNodes.push(blankNode(t.id, "thread", t.description, attributions, firstSeen, lastSeen));
  }
  for (const s of Object.values(narrative.systemGraph?.nodes ?? {})) {
    if (!includeSystem(s.id)) continue;
    rawNodes.push(blankNode(s.id, "system", s.concept, attributions, firstSeen, lastSeen));
  }

  // Tiers — comparative, computed first so topology sees them.
  let nodes = classifyTiers(rawNodes, graphCount);

  // Edges (filtered to known nodes) — needed for topology.
  const knownIds = new Set(nodes.map((n) => n.id));
  const edges: NetworkEdge[] = [];
  for (const [key, weight] of edgeWeights.entries()) {
    const [from, to] = key.split("|");
    if (knownIds.has(from) && knownIds.has(to)) {
      edges.push({ from, to, weight });
    }
  }

  // Topology — uses edges + neighbour kinds.
  const kindLookup = new Map(nodes.map((n) => [n.id, n.kind]));
  nodes = classifyTopology(nodes, edges, kindLookup);

  return { nodes, edges, graphCount };
}

// ── Classifiers ──────────────────────────────────────────────────────────────

/** Bucket nodes into hot / warm / cold / fresh. Tiers are comparative across
 *  the network so a low-attribution story still has a meaningful "hot"
 *  cohort, with two calibrations to handle early game:
 *
 *  1. Freshness only applies when totalGraphs > 1 — with no historic
 *     baseline, there's nothing to be "fresh" against; let the tertile
 *     classifier do its job on the first graph.
 *  2. Hot requires a minimum attribution count (HOT_MIN_ATTRIBUTIONS) on
 *     top of the tertile placement — a single attribution can't read as
 *     load-bearing just because the network is small.
 */
export function classifyTiers(nodes: NetworkNode[], totalGraphs: number): NetworkNode[] {
  if (nodes.length === 0) return nodes;
  const freshThreshold = totalGraphs - FRESH_WINDOW;
  const freshActive = totalGraphs > 1;
  const counts = nodes.map((n) => n.attributions).filter((c) => c > 0).sort((a, b) => a - b);
  const len = counts.length;
  const lowCut = len > 0 ? counts[Math.floor(len / 3)] : 0;
  const highCut = len > 0 ? counts[Math.floor((2 * len) / 3)] : 0;

  return nodes.map((n) => {
    if (freshActive && n.firstSeenIndex >= 0 && n.firstSeenIndex >= freshThreshold) {
      return { ...n, tier: "fresh" as HeatTier };
    }
    if (n.attributions <= 0) return { ...n, tier: "cold" as HeatTier };
    if (n.attributions >= highCut && n.attributions >= HOT_MIN_ATTRIBUTIONS) {
      return { ...n, tier: "hot" as HeatTier };
    }
    if (n.attributions >= lowCut) return { ...n, tier: "warm" as HeatTier };
    return { ...n, tier: "cold" as HeatTier };
  });
}

/** Compute degree-based topology. Bridges connect ≥2 distinct force
 *  cohorts; hubs are well-connected within a single cohort; leafs have a
 *  single edge; isolated have none. */
export function classifyTopology(
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  kindLookup: Map<string, NetworkNodeKind>,
): NetworkNode[] {
  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    if (!neighbours.has(e.from)) neighbours.set(e.from, []);
    if (!neighbours.has(e.to)) neighbours.set(e.to, []);
    neighbours.get(e.from)!.push(e.to);
    neighbours.get(e.to)!.push(e.from);
  }

  return nodes.map((n) => {
    const adj = neighbours.get(n.id) ?? [];
    let topology: Topology;
    if (adj.length === 0) topology = "isolated";
    else if (adj.length === 1) topology = "leaf";
    else {
      const forces = new Set<Force>();
      for (const nid of adj) {
        const k = kindLookup.get(nid);
        if (k) forces.add(forceOfKind(k));
      }
      topology = forces.size >= 2 ? "bridge" : "hub";
    }
    return { ...n, topology };
  });
}

// ── Cohort summary ───────────────────────────────────────────────────────────

/** Per-force breakdown rendered as a compact NETWORK STATE block for the
 *  reasoning prompt — gives the LLM a top-level read on which cohorts are
 *  saturated / shallow / expanding before it dives into per-node decisions. */
export function summarizeNetworkState(network: NetworkGraph): string {
  if (network.nodes.length === 0) {
    return "NETWORK STATE: empty.";
  }
  if (network.graphCount === 0) {
    return `NETWORK STATE: ${network.nodes.length} nodes total, no attributions yet (everything dormant).`;
  }

  const buckets: Record<Force, NetworkNode[]> = { fate: [], world: [], system: [] };
  for (const n of network.nodes) buckets[forceOfKind(n.kind)].push(n);

  const cohortLine = (force: Force, label: string): string => {
    const cohort = buckets[force];
    if (cohort.length === 0) return `- ${label}: none yet.`;
    const hot = cohort.filter((n) => n.tier === "hot").length;
    const warm = cohort.filter((n) => n.tier === "warm").length;
    const cold = cohort.filter((n) => n.tier === "cold").length;
    const fresh = cohort.filter((n) => n.tier === "fresh").length;

    let verdict = "balanced";
    if (cohort.length === 0) verdict = "empty";
    else if (cold / cohort.length > 0.6) verdict = "shallow (most untouched)";
    else if (hot / cohort.length > 0.6) verdict = "saturated";
    else if (fresh > 0) verdict = "expanding";

    return `- ${label} (${cohort.length}): ${hot} hot · ${warm} warm · ${fresh} fresh · ${cold} cold — ${verdict}.`;
  };

  const bridges = network.nodes.filter((n) => n.topology === "bridge").length;
  const hubs = network.nodes.filter((n) => n.topology === "hub").length;

  return [
    `NETWORK STATE — cumulative across ${network.graphCount} attribution step${network.graphCount === 1 ? "" : "s"} (scenes + world builds):`,
    cohortLine("fate", "Fate"),
    cohortLine("world", "World"),
    cohortLine("system", "System"),
    `- Topology: ${bridges} bridge${bridges === 1 ? "" : "s"} (cross-force connectors), ${hubs} hub${hubs === 1 ? "" : "s"} (within-cohort centres).`,
  ].join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Map a network-node kind to its narrative force axis. */
export function forceOfKind(kind: NetworkNodeKind): Force {
  if (kind === "thread") return "fate";
  if (kind === "system") return "system";
  return "world"; // character / location / artifact
}

function blankNode(
  id: string,
  kind: NetworkNodeKind,
  label: string,
  attributions: Map<string, number>,
  firstSeen: Map<string, number>,
  lastSeen: Map<string, number>,
): NetworkNode {
  return {
    id,
    kind,
    label,
    attributions: attributions.get(id) ?? 0,
    firstSeenIndex: firstSeen.get(id) ?? -1,
    lastSeenIndex: lastSeen.get(id) ?? -1,
    // Placeholders — classifiers fill these in.
    tier: "cold",
    topology: "isolated",
  };
}

/** Look up a node by id. Convenient for inline labelling in narrative context. */
export function buildTierLookup(network: NetworkGraph): Map<string, NetworkNode> {
  return new Map(network.nodes.map((n) => [n.id, n]));
}


/** Compact human-readable annotation for prompt context.
 *
 *  Examples:
 *    {hot ×14, bridge}
 *    {warm ×4, leaf}
 *    {cold ×0, isolated}
 *    {fresh ×1, hub}
 */
export function formatTierLabel(node: NetworkNode | undefined): string {
  if (!node) return "";
  return `{${node.tier} ×${node.attributions}, ${node.topology}}`;
}
