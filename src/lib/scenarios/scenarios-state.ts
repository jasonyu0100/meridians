/**
 * Scenarios state helpers.
 *
 * The new scenario-batch model keeps run state inside the React hook
 * (`useScenarios`). The only shared utility worth a module-level
 * home is `applySceneDeltas` — it applies a list of scenes' deltas
 * (relationships, world graphs, threads, system graph) to a narrative
 * snapshot, used by the engine to compute virtual post-arc previews
 * without touching the live store.
 */

import { applyWorldDelta } from "@/lib/graph/world-graph";
import { applyThreadDelta } from "@/lib/forces/thread-log";
import type { NarrativeState, Scene } from "@/types/narrative";

/**
 * Apply scene deltas (relationship + world + thread + system) to a
 * narrative state, returning a new state object. Pure; never mutates the
 * input. Duplicates the in-store reducer logic so the engine can compute
 * virtual snapshots without importing the React store module.
 */
export function applySceneDeltas(
  n: NarrativeState,
  scenes: Scene[],
): NarrativeState {
  let relationships = [...n.relationships];
  const characters = { ...n.characters };
  const locations = { ...n.locations };
  const artifacts = { ...n.artifacts };
  const threads = { ...n.threads };
  const systemGraph = {
    nodes: { ...n.systemGraph?.nodes },
    edges: [...(n.systemGraph?.edges ?? [])],
  };

  for (const scene of scenes) {
    for (const rm of scene.relationshipDeltas) {
      const idx = relationships.findIndex(
        (r) => r.from === rm.from && r.to === rm.to,
      );
      if (idx >= 0) {
        const existing = relationships[idx];
        relationships = [
          ...relationships.slice(0, idx),
          {
            ...existing,
            type: rm.type,
            valence: Math.max(
              -1,
              Math.min(1, existing.valence + rm.valenceDelta),
            ),
          },
          ...relationships.slice(idx + 1),
        ];
      } else {
        relationships.push({
          from: rm.from,
          to: rm.to,
          type: rm.type,
          valence: Math.max(-1, Math.min(1, rm.valenceDelta)),
        });
      }
    }
    for (const km of scene.worldDeltas) {
      const char = characters[km.entityId];
      const loc = locations[km.entityId];
      const art = artifacts[km.entityId];
      if (char)
        characters[km.entityId] = {
          ...char,
          world: applyWorldDelta(char.world, km),
        };
      else if (loc)
        locations[km.entityId] = {
          ...loc,
          world: applyWorldDelta(loc.world, km),
        };
      else if (art)
        artifacts[km.entityId] = {
          ...art,
          world: applyWorldDelta(art.world, km),
        };
    }
    for (const tm of scene.threadDeltas) {
      const thread = threads[tm.threadId];
      if (thread) threads[tm.threadId] = applyThreadDelta(thread, tm, scene.id);
    }
    const wkm = scene.systemDeltas;
    if (wkm) {
      for (const node of wkm.addedNodes ?? []) {
        if (!systemGraph.nodes[node.id]) {
          systemGraph.nodes[node.id] = {
            id: node.id,
            concept: node.concept,
            type: node.type,
          };
        }
      }
      for (const edge of wkm.addedEdges ?? []) {
        if (
          !systemGraph.edges.some(
            (e: { from: string; to: string; relation: string }) =>
              e.from === edge.from &&
              e.to === edge.to &&
              e.relation === edge.relation,
          )
        ) {
          systemGraph.edges.push({
            from: edge.from,
            to: edge.to,
            relation: edge.relation,
          });
        }
      }
    }
  }

  return {
    ...n,
    relationships,
    characters,
    locations,
    artifacts,
    threads,
    systemGraph,
  };
}
