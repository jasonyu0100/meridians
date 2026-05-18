"use client";

import { useStore } from "@/lib/store";
import type { ReasoningNodeSnapshot, ReasoningEdgeSnapshot } from "@/types/narrative";
import { useMemo, useState } from "react";

/** Expandable inference-shape field — collapsed by default with a 1-line
 *  preview so the node detail stays scannable when `considered` / `breaks`
 *  / `opens` carry a paragraph each. Shared between this panel and
 *  ModeNodeDetail; same affordance as VariablesView's ExpandableField. */
function ExpandableField({
  label, icon, iconColor, content, defaultOpen = false,
}: {
  label: string;
  icon?: string;
  iconColor?: string;
  content: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const preview = useMemo(() => {
    if (defaultOpen) return '';
    const firstSentenceEnd = content.search(/[.!?](\s|$)/);
    return firstSentenceEnd > 0 && firstSentenceEnd < 100
      ? content.slice(0, firstSentenceEnd + 1)
      : content.slice(0, 80) + (content.length > 80 ? '…' : '');
  }, [content, defaultOpen]);
  // Minimal quote-style — see VariablesView for the same component shape.
  return (
    <div className={`${iconColor ?? 'text-text-dim/40'} ${open ? '' : 'opacity-60 hover:opacity-100'} transition-opacity`}>
      <div className="flex flex-col border-l-2 border-current pl-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 py-0.5 text-left w-full group"
        >
          {icon && (
            <span className="text-[12px] leading-none font-bold w-2.5 text-center">
              {icon}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wider text-text-secondary font-medium">
            {label}
          </span>
          {!open && preview && (
            <span className="flex-1 min-w-0 text-[11px] text-text-dim/70 leading-snug truncate">
              {preview}
            </span>
          )}
          <span className="ml-auto shrink-0 text-text-dim/40 group-hover:text-text-secondary transition text-[12px] leading-none font-mono">
            {open ? '−' : '+'}
          </span>
        </button>
        {open && (
          <p className="pt-0.5 pb-1 text-xs text-text-secondary leading-relaxed">
            {content}
          </p>
        )}
      </div>
    </div>
  );
}

type ReasoningNodeType = ReasoningNodeSnapshot["type"];
type ReasoningEdgeType = ReasoningEdgeSnapshot["type"];

import { REASONING_NODE_COLORS_PLAN } from "@/lib/reasoning-node-colors";

const NODE_COLORS: Record<ReasoningNodeType, { fill: string; stroke: string; text: string }> = REASONING_NODE_COLORS_PLAN;

const EDGE_COLORS: Record<ReasoningEdgeType, string> = {
  enables: "#22c55e",
  constrains: "#ef4444",
  risks: "#f59e0b",
  requires: "#3b82f6",
  causes: "#64748b",
  reveals: "#a855f7",
  develops: "#06b6d4",
  resolves: "#10b981",
  supersedes: "#ec4899",
};

function ordinalSuffix(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

const TYPE_DESCRIPTIONS: Record<ReasoningNodeType, string> = {
  fate: "Thread's gravitational pull — influences events toward resolution or unexpected turns",
  character: "An active agent in the reasoning chain",
  location: "A setting that constrains or enables action",
  artifact: "An object with narrative significance",
  system: "A world rule, principle, or constraint",
  reasoning: "A logical step in the causal chain",
  pattern: "Positive reinforcement — encouraging variety and fresh approaches",
  warning: "Negative reinforcement — preventing stagnation and repetition",
  chaos: "Outside force — spawns a new character, location, artifact, or thread into the arc",
  // Plan-spine types — only appear in coordination-plan-derived
  // investigations; tells the operator this node anchors a structural beat.
  peak: "Arc-anchor peak — where forces converge and a thread culminates",
  valley: "Arc-anchor valley — turning point where tension is seeded and the arc pivots",
  moment: "Plan-level beat — thread escalation, setpiece, reveal, or setup between anchors",
};

type Props = {
  arcId?: string;
  worldBuildId?: string;
  nodeId: string;
};

export default function ReasoningNodeDetail({ arcId, worldBuildId, nodeId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const { node, sourceName, graph, connectedEdges } = useMemo(() => {
    if (!narrative) return { node: null, sourceName: null, graph: null, connectedEdges: [] };

    // Resolution order:
    //   1. Active arc investigation (current paradigm)
    //   2. Legacy arc.reasoningGraph
    //   3. Legacy worldBuild.reasoningGraph
    let graph = null;
    let sourceName: string | null = null;

    if (arcId) {
      const arcInvestigations = Object.values(narrative.investigations ?? {})
        .filter((inv) => inv.arcId === arcId)
        .sort((a, b) => a.createdAt - b.createdAt);
      if (arcInvestigations.length > 0) {
        const selectedId = state.viewState.selectedInvestigationId;
        const active =
          arcInvestigations.find((inv) => inv.id === selectedId) ?? arcInvestigations[0];
        // Only use this investigation's graph if it actually contains the
        // node we're looking for — otherwise fall through to legacy sources.
        if (active.graph.nodes.some((n) => n.id === nodeId)) {
          graph = active.graph;
          sourceName = narrative.arcs[arcId]?.name ?? "Investigation";
        }
      }
    }

    if (!graph && arcId) {
      const arc = narrative.arcs[arcId];
      if (arc?.reasoningGraph) {
        graph = arc.reasoningGraph;
        sourceName = arc.name;
      }
    }

    if (!graph && worldBuildId) {
      const worldBuild = narrative.worldBuilds[worldBuildId];
      if (worldBuild?.reasoningGraph) {
        graph = worldBuild.reasoningGraph;
        sourceName = worldBuild.summary.slice(0, 50);
      }
    }

    if (!graph) return { node: null, sourceName: null, graph: null, connectedEdges: [] };

    const node = graph.nodes.find((n) => n.id === nodeId);
    const connectedEdges = graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
    return { node, sourceName, graph, connectedEdges };
  }, [narrative, arcId, worldBuildId, nodeId, state.viewState.selectedInvestigationId]);

  if (!node || !graph) {
    return (
      <div className="text-text-dim text-sm">
        Reasoning node not found
      </div>
    );
  }

  const navigateToNode = (id: string) => {
    dispatch({
      type: "SET_INSPECTOR",
      context: { type: "reasoning", arcId, worldBuildId, nodeId: id },
    });
  };

  const navigateToEntity = () => {
    if (!node.entityId || !narrative) return;

    // Check if it's a character, location, or artifact
    if (narrative.characters[node.entityId]) {
      dispatch({
        type: "SET_INSPECTOR",
        context: { type: "character", characterId: node.entityId },
      });
    } else if (narrative.locations[node.entityId]) {
      dispatch({
        type: "SET_INSPECTOR",
        context: { type: "location", locationId: node.entityId },
      });
    } else if (narrative.artifacts?.[node.entityId]) {
      dispatch({
        type: "SET_INSPECTOR",
        context: { type: "artifact", artifactId: node.entityId },
      });
    }
  };

  const navigateToThread = () => {
    if (!node.threadId) return;
    dispatch({
      type: "SET_INSPECTOR",
      context: { type: "thread", threadId: node.threadId },
    });
  };

  const navigateToSystemNode = () => {
    if (!node.systemNodeId) return;
    dispatch({
      type: "SET_INSPECTOR",
      context: { type: "knowledge", nodeId: node.systemNodeId },
    });
  };

  const systemNode =
    node.systemNodeId && narrative?.systemGraph?.nodes[node.systemNodeId];

  const colors = NODE_COLORS[node.type];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 relative"
          style={{ backgroundColor: colors.fill, color: colors.text }}
          title={
            typeof node.order === "number" && node.order !== node.index
              ? `Presentation index ${node.index} · Generated ${node.order + 1}${ordinalSuffix(node.order + 1)}`
              : `Index ${node.index}`
          }
        >
          {node.index}
          {typeof node.order === "number" && node.order !== node.index && (
            <span
              className="absolute -bottom-1 -right-1 px-1 rounded text-[8px] font-mono bg-bg-base/90 border border-white/15 text-text-dim leading-tight"
              title={`Generated ${node.order + 1}${ordinalSuffix(node.order + 1)} (thinking order)`}
            >
              g{node.order}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider"
              style={{ backgroundColor: colors.fill, color: colors.text }}
            >
              {node.type}
            </span>
            <span className="text-[10px] text-text-dim font-mono">#{node.id}</span>
          </div>
          <h2 className="text-sm font-semibold text-text-primary leading-snug">
            {node.label}
          </h2>
        </div>
      </div>

      {/* Type description */}
      <p className="text-[10px] text-text-dim italic">
        {TYPE_DESCRIPTIONS[node.type]}
      </p>

      {/* Detail */}
      {node.detail && <ExpandableField label="Detail" content={node.detail} defaultOpen />}

      {/* Universal inference-shape fields — option space, falsification handle,
          forward extension. Same fields across CRG / PRG / scenarios so the
          reader uses the same mental model wherever they encounter inference.
          Collapsed by default so the panel stays scannable; click to expand. */}
      {node.considered && (
        <ExpandableField label="Considered" icon="×" iconColor="text-amber-400" content={node.considered} />
      )}
      {node.breaks && (
        <ExpandableField label="Breaks" icon="!" iconColor="text-rose-400" content={node.breaks} />
      )}
      {node.opens && (
        <ExpandableField label="Opens" icon="⇒" iconColor="text-emerald-400" content={node.opens} />
      )}

      {/* References */}
      {(node.entityId || node.threadId || node.systemNodeId) && (
        <div className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-text-dim">References</h3>
          <div className="space-y-1.5">
            {node.entityId && (
              <button
                onClick={navigateToEntity}
                className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded bg-white/3 hover:bg-white/6 transition group"
              >
                <span className="text-[10px] text-text-dim">Entity:</span>
                <span className="text-[11px] text-cyan-400 font-mono group-hover:text-cyan-300 transition">
                  {node.entityId}
                </span>
              </button>
            )}
            {node.threadId && (
              <button
                onClick={navigateToThread}
                className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded bg-white/3 hover:bg-white/6 transition group"
              >
                <span className="text-[10px] text-text-dim">Thread:</span>
                <span className="text-[11px] text-amber-400 font-mono group-hover:text-amber-300 transition">
                  {node.threadId}
                </span>
              </button>
            )}
            {node.systemNodeId && (
              <button
                onClick={navigateToSystemNode}
                disabled={!systemNode}
                className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded bg-white/3 hover:bg-white/6 transition group disabled:cursor-default disabled:hover:bg-white/3"
              >
                <span className="text-[10px] text-text-dim shrink-0">System:</span>
                <span className="text-[11px] text-violet-400 font-mono group-hover:text-violet-300 transition shrink-0">
                  {node.systemNodeId}
                </span>
                {systemNode && (
                  <span className="text-[10px] text-text-secondary group-hover:text-text-primary transition leading-snug">
                    {systemNode.concept}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Connections */}
      {connectedEdges.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-text-dim">
            Connections ({connectedEdges.length})
          </h3>
          <div className="space-y-1">
            {connectedEdges.map((edge) => {
              const isOutgoing = edge.from === nodeId;
              const otherId = isOutgoing ? edge.to : edge.from;
              const otherNode = graph.nodes.find((n) => n.id === otherId);

              return (
                <button
                  key={edge.id}
                  onClick={() => navigateToNode(otherId)}
                  className="w-full text-left px-2 py-1.5 rounded bg-white/3 hover:bg-white/6 transition group"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-mono shrink-0"
                      style={{ color: EDGE_COLORS[edge.type] }}
                    >
                      {isOutgoing ? "->" : "<-"} {edge.type}
                    </span>
                    <span className="text-[11px] text-text-secondary group-hover:text-text-primary transition leading-snug flex-1">
                      {otherNode?.label ?? otherId}
                    </span>
                    {otherNode && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded shrink-0"
                        style={{
                          backgroundColor: NODE_COLORS[otherNode.type].fill,
                          color: NODE_COLORS[otherNode.type].text,
                        }}
                      >
                        {otherNode.type}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Source context */}
      <div className="pt-3 border-t border-border space-y-2">
        <h3 className="text-[10px] uppercase tracking-wider text-text-dim">
          {arcId ? "Arc" : "World Expansion"}
        </h3>
        <div className="text-xs text-text-secondary">
          <span className="font-medium text-text-primary">{sourceName}</span>
          <span className="text-text-dim"> &middot; {graph.nodes.length} nodes</span>
        </div>
        <p className="text-[10px] text-text-dim leading-relaxed">
          {graph.summary}
        </p>
      </div>

      {/* Legend */}
      <div className="pt-3 border-t border-border space-y-2">
        <h3 className="text-[10px] uppercase tracking-wider text-text-dim">Node Types</h3>
        <div className="grid grid-cols-2 gap-1">
          {(Object.keys(NODE_COLORS) as ReasoningNodeType[]).map((type) => (
            <div key={type} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded"
                style={{ backgroundColor: NODE_COLORS[type].fill }}
              />
              <span className={`text-[9px] capitalize ${type === node.type ? "text-text-primary font-medium" : "text-text-dim"}`}>
                {type}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
