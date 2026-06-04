/**
 * Reference validation for reasoning-graph nodes.
 *
 * Each typed node has a canonical reference field:
 *   - fate                            → threadId  (existing thread)
 *   - character / location / artifact → entityId  (existing entity of that kind)
 *   - system                          → systemNodeId (existing SYS-XX node)
 *
 * Hallucinated references are CLEARED rather than dropping the node — the
 * node still carries useful reasoning content, but downstream consumers
 * can tell it isn't anchored. References on the wrong type (e.g.
 * entityId on a fate node) are also cleared. Chaos / reasoning / pattern
 * / warning nodes have no reference expectation; any references they
 * carry are cleared because they're meta-nodes, not anchors.
 */

import type { NarrativeState } from "@/types/narrative";
import { logWarning, type LogContext } from "@/lib/core/system-logger";
import type { ReasoningNode } from "./types";

export function validateNodeReferences(
  node: ReasoningNode,
  narrative: NarrativeState,
  context: { source: LogContext["source"]; arcName: string },
): ReasoningNode {
  const validators: Record<string, (id: string) => boolean> = {
    character: (id) => !!narrative.characters[id],
    location: (id) => !!narrative.locations[id],
    artifact: (id) => !!narrative.artifacts?.[id],
  };

  const out: ReasoningNode = { ...node };
  const warn = (kind: string, badRef: string) => {
    logWarning(
      `Reasoning node "${node.label}" (${node.type}) referenced unknown ${kind} "${badRef}" — cleared`,
      undefined,
      {
        source: context.source,
        operation: "reasoning-graph-validate",
        details: { arcName: context.arcName, nodeId: node.id, type: node.type },
      },
    );
  };

  switch (node.type) {
    case "fate":
      if (out.threadId && !narrative.threads[out.threadId]) {
        warn("thread", out.threadId);
        out.threadId = undefined;
      }
      out.entityId = undefined;
      out.systemNodeId = undefined;
      break;
    case "character":
    case "location":
    case "artifact": {
      const validator = validators[node.type];
      if (out.entityId && !validator(out.entityId)) {
        warn(node.type, out.entityId);
        out.entityId = undefined;
      }
      // Defensive: if the LLM put the id in the wrong field, try to recover.
      if (!out.entityId && out.systemNodeId && validator(out.systemNodeId)) {
        out.entityId = out.systemNodeId;
      }
      out.threadId = undefined;
      out.systemNodeId = undefined;
      break;
    }
    case "system":
      if (out.systemNodeId && !narrative.systemGraph?.nodes[out.systemNodeId]) {
        warn("system node", out.systemNodeId);
        out.systemNodeId = undefined;
      }
      // Recover from the legacy pattern of putting SYS-XX into entityId.
      if (!out.systemNodeId && out.entityId && narrative.systemGraph?.nodes[out.entityId]) {
        out.systemNodeId = out.entityId;
      }
      out.entityId = undefined;
      out.threadId = undefined;
      break;
    case "chaos":
    case "reasoning":
    case "pattern":
    case "warning":
      out.entityId = undefined;
      out.threadId = undefined;
      out.systemNodeId = undefined;
      break;
  }
  return out;
}
