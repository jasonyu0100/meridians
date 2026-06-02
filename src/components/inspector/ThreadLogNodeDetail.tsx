"use client";

import { useStore } from "@/lib/store";
import type { ThreadLogNode, ThreadLogNodeType } from "@/types/narrative";
import { useMemo } from "react";
import { InlineText, InlineSelect } from "./InlineEdit";

type Props = { threadId: string; nodeId: string };

const LOG_TYPES: readonly ThreadLogNodeType[] = [
  "pulse", "transition", "setup", "escalation", "payoff", "twist", "callback", "resistance", "stall",
];

const TYPE_FILL: Record<string, string> = {
  pulse: "#666",
  transition: "#EF4444",
  setup: "#FBBF24",
  escalation: "#F97316",
  payoff: "#34D399",
  twist: "#C084FC",
  callback: "#38BDF8",
  resistance: "#EF4444",
  stall: "#EF4444",
};

const TYPE_DESCRIPTIONS: Record<string, string> = {
  pulse: "Thread acknowledged — continuity maintained without change",
  transition: "Fundamental lifecycle state changed",
  setup: "Groundwork laid — foreshadowing, promise, seed planted",
  escalation: "Stakes rising within the current stage",
  payoff: "A promise made to the thread has been fulfilled",
  twist: "Thread's direction changed — own fate vector revised",
  callback: "Reference to earlier thread event — continuity rewarded",
  resistance: "Opposition experienced — the thread knows it's in conflict",
  stall: "Thread not moving — self-diagnosis of dysfunction",
};

export default function ThreadLogNodeDetail({ threadId, nodeId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const thread = narrative.threads[threadId];
  if (!thread) return <p className="text-xs text-text-dim">Thread not found</p>;

  const node = thread.threadLog?.nodes?.[nodeId] as ThreadLogNode | undefined;
  if (!node) return <p className="text-xs text-text-dim">Log node not found</p>;

  const edges = thread.threadLog?.edges ?? [];
  // The originating scene/worldbuild id — explicit on the node, else recovered
  // from the node id pattern `${threadId}:${sceneId}`.
  const logSceneId = node.sceneId ?? (nodeId.includes(":") ? nodeId.slice(nodeId.indexOf(":") + 1) : "");

  // All edges involving this node
  const connections = useMemo(() => {
    const allNodes = thread.threadLog?.nodes ?? {};
    return edges
      .filter((e) => e.from === nodeId || e.to === nodeId)
      .map((e) => {
        const otherId = e.from === nodeId ? e.to : e.from;
        const other = allNodes[otherId];
        const direction = e.from === nodeId ? "outgoing" : "incoming";
        return { otherId, other, relation: e.relation, direction };
      });
  }, [edges, thread.threadLog, nodeId]);

  // Find scenes where this node's thread delta occurred
  // (derive from scene.threadDeltas, matching by position in the node list)
  const mentionedScenes = useMemo(() => {
    const nodeIds = Object.keys(thread.threadLog?.nodes ?? {});
    const nodeIndex = nodeIds.indexOf(nodeId);
    if (nodeIndex < 0) return [];

    // Walk scenes in order, count thread deltas for this thread — the Nth delta corresponds to the Nth node
    const scenes: string[] = [];
    let deltaCount = 0;
    for (let i = 0; i < state.resolvedEntryKeys.length; i++) {
      const scene = narrative.scenes[state.resolvedEntryKeys[i]];
      if (!scene) continue;
      for (const tm of scene.threadDeltas) {
        if (tm.threadId === threadId) {
          if (deltaCount === nodeIndex) {
            scenes.push(scene.id);
          }
          deltaCount++;
        }
      }
    }
    return scenes;
  }, [narrative, threadId, nodeId, thread.threadLog, state.resolvedEntryKeys]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header — type + prose are inline-editable (patches the source delta) */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: TYPE_FILL[node.type] ?? "#888" }}
          />
          <InlineSelect<ThreadLogNodeType>
            value={node.type}
            options={LOG_TYPES}
            onSave={(logType) => dispatch({ type: "UPDATE_THREAD_LOG_NODE", threadId, sceneId: logSceneId, patch: { logType } })}
            className="text-[10px] uppercase tracking-widest"
          />
        </div>
        <InlineText
          value={node.content}
          onSave={(rationale) => dispatch({ type: "UPDATE_THREAD_LOG_NODE", threadId, sceneId: logSceneId, patch: { rationale } })}
          multiline
          className="text-sm text-text-primary leading-relaxed"
          inputClassName="text-sm"
        />
        <span className="font-mono text-[10px] text-text-dim">{nodeId}</span>
      </div>

      {/* Type description */}
      {TYPE_DESCRIPTIONS[node.type] && (
        <p className="text-[10px] text-text-dim italic">
          {TYPE_DESCRIPTIONS[node.type]}
        </p>
      )}

      {/* Parent thread */}
      <button
        onClick={() =>
          dispatch({
            type: "SET_INSPECTOR",
            context: { type: "thread", threadId },
          })
        }
        className="text-xs text-text-secondary hover:text-text-primary transition-colors text-left"
      >
        &larr; {thread.description}
      </button>

      {/* Connections */}
      {connections.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Connections ({connections.length})
          </h3>
          <ul className="flex flex-col gap-1.5">
            {connections.map((c, i) => (
              <li key={i} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-fate/70">
                    {c.direction === "outgoing" ? "→" : "←"}
                  </span>
                  {c.other ? (
                    <button
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: {
                            type: "threadLog",
                            threadId,
                            nodeId: c.otherId,
                          },
                        })
                      }
                      className="text-xs text-text-secondary hover:text-text-primary transition-colors text-left"
                    >
                      {c.other.content.slice(0, 60)}
                      {c.other.content.length > 60 ? "..." : ""}
                    </button>
                  ) : (
                    <span className="text-xs text-text-dim font-mono">
                      {c.otherId}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-text-dim pl-4">
                  {c.relation}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Scenes where this event occurred */}
      {mentionedScenes.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Occurred in
          </h3>
          <div className="flex flex-wrap gap-1">
            {mentionedScenes.map((sceneId, idx) => (
              <button
                key={idx}
                onClick={() =>
                  dispatch({
                    type: "SET_INSPECTOR",
                    context: { type: "scene", sceneId },
                  })
                }
                className="font-mono text-[10px] text-text-dim hover:text-text-secondary transition-colors"
              >
                {sceneId}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
