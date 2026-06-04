/**
 * World graph utilities — delta application.
 *
 * Mirrors thread-log.ts: each worldDelta represents one commit's
 * contribution (a world build or a scene) for a single entity. New nodes
 * chain sequentially in the order they appear via 'co_occurs' — no edges
 * are created across deltas and LLM-emitted addedEdges are ignored.
 * Node order alone defines the linkage.
 *
 * Type sanitization happens here at application time — invalid node types
 * fall back to 'trait'. This is the single chokepoint for world data.
 */

import type { World, WorldDelta, WorldNodeType } from '@/types/narrative';
import { WORLD_NODE_TYPES } from '@/types/narrative';

/** Empty world graph — the canonical "zero value" for entity initialization. */
export const EMPTY_WORLD: World = { nodes: {}, edges: [] };

/**
 * Validate and normalize a world node type.
 * Returns the type if valid, otherwise falls back to 'trait'.
 */
function sanitizeWorldNodeType(type: string | undefined): WorldNodeType {
  if (type && WORLD_NODE_TYPES.includes(type as WorldNodeType)) {
    return type as WorldNodeType;
  }
  return 'trait';
}

/**
 * Apply one additive world delta, returning a new graph.
 * New nodes are added in order and chained sequentially via 'co_occurs'.
 * Invalid node types are sanitized to 'trait' at this chokepoint.
 */
export function applyWorldDelta(graph: World, delta: WorldDelta): World {
  const nodes = { ...(graph.nodes ?? {}) };
  const edges = [...(graph.edges ?? [])];

  const newNodeIds: string[] = [];
  for (const n of delta.addedNodes ?? []) {
    if (!n.id || !n.content) continue;
    if (!nodes[n.id]) {
      nodes[n.id] = { id: n.id, type: sanitizeWorldNodeType(n.type), content: n.content };
      newNodeIds.push(n.id);
    }
  }

  // Chain new nodes sequentially within this delta — no cross-commit link.
  for (let i = 1; i < newNodeIds.length; i++) {
    edges.push({ from: newNodeIds[i - 1], to: newNodeIds[i], relation: 'co_occurs' });
  }

  return { nodes, edges };
}
