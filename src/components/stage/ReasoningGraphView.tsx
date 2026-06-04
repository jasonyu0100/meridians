"use client";

import { useStore } from "@/lib/store";
import type {
  ReasoningGraphSnapshot,
  ReasoningNodeSnapshot,
  ReasoningEdgeSnapshot,
  InspectorContext,
} from "@/types/narrative";
import * as d3 from "d3";
import dagre from "dagre";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";

// ── Styling Constants ────────────────────────────────────────────────────────

type ReasoningEdgeType = ReasoningEdgeSnapshot["type"];

/** Per-node-type colour palette. Default = causal-graph palette. Phase
 *  graphs pass their own palette via the `nodeColors` prop. */
type NodePalette = { fill: string; stroke: string; text: string };
type NodeColorResolver = (type: string) => NodePalette;

function ordinalSuffix(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

import { REASONING_NODE_COLORS_PLAN, REASONING_NODE_COLOR_UNKNOWN } from "@/lib/reasoning-node-colors";

const NODE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  ...REASONING_NODE_COLORS_PLAN,
  unknown: REASONING_NODE_COLOR_UNKNOWN,
};

const getNodeColor = (type: string) => NODE_COLORS[type] ?? REASONING_NODE_COLOR_UNKNOWN;

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

const NODE_WIDTH = 200;
const NODE_HEIGHT = 56;
const ACTIVE_NODE_COLOR = "#fbbf24";

// ── Dagre Layout Types ───────────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data: ReasoningNodeSnapshot;
}

interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  type: ReasoningEdgeType;
  label?: string;
  points: { x: number; y: number }[];
}

// ── Component ────────────────────────────────────────────────────────────────

type Props = {
  graph: ReasoningGraphSnapshot;
  /** Arc ID when viewing arc reasoning */
  arcId?: string;
  /** World build ID when viewing expansion reasoning */
  worldBuildId?: string;
  /**
   * Optional override of the per-type node colour resolver. Phase Reasoning
   * Graphs (PRGs) pass their own palette so the same dagre rendering serves
   * both causal and phase views with distinct hues. Default = the existing
   * causal palette.
   */
  nodeColors?: NodeColorResolver;
  /**
   * Optional override of the inspector context built when a node is clicked.
   * Default builds a `reasoning` context (causal). Phase view passes a
   * builder that emits `phase` contexts.
   */
  buildInspectorContext?: (nodeId: string) => InspectorContext;
  /** Type discriminator used to match the active inspector context against this view. */
  inspectorContextType?: "reasoning" | "mode";
  /** When inspectorContextType === "mode", the phase graph id we're rendering. */
  phaseGraphId?: string;
};

export function ReasoningGraphView({
  graph,
  arcId,
  worldBuildId,
  nodeColors,
  buildInspectorContext,
  inspectorContextType = "reasoning",
  phaseGraphId,
}: Props) {
  const { state, dispatch } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const initialTransformRef = useRef<d3.ZoomTransform | null>(null);
  const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
  const [layoutEdges, setLayoutEdges] = useState<LayoutEdge[]>([]);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  const resolveNodeColor: NodeColorResolver = useCallback(
    (type: string) => (nodeColors ? nodeColors(type) : getNodeColor(type)),
    [nodeColors],
  );

  // Track selected node from inspector context
  const selectedNodeId = useMemo(() => {
    const ctx = state.viewState.inspectorContext;
    if (!ctx) return null;
    if (inspectorContextType === "mode" && ctx.type === "mode") {
      return ctx.phaseGraphId === phaseGraphId ? ctx.nodeId : null;
    }
    if (inspectorContextType === "reasoning" && ctx.type === "reasoning") {
      if ((arcId && ctx.arcId === arcId) || (worldBuildId && ctx.worldBuildId === worldBuildId)) {
        return ctx.nodeId;
      }
    }
    return null;
  }, [state.viewState.inspectorContext, arcId, worldBuildId, inspectorContextType, phaseGraphId]);

  // Handle clicking a node to open inspector
  const handleNodeClick = useCallback((node: ReasoningNodeSnapshot) => {
    const context: InspectorContext = buildInspectorContext
      ? buildInspectorContext(node.id)
      : { type: "reasoning", arcId, worldBuildId, nodeId: node.id };
    dispatch({ type: "SET_INSPECTOR", context });
  }, [dispatch, arcId, worldBuildId, buildInspectorContext]);

  // Watch for container size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
        }
      }
    });

    observer.observe(container);

    // Initial size check
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setContainerSize({ width: rect.width, height: rect.height });
    }

    return () => observer.disconnect();
  }, []);

  // Compute dagre layout
  useEffect(() => {
    if (graph.nodes.length === 0) return;

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "TB",
      nodesep: 50,
      ranksep: 70,
      marginx: 40,
      marginy: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const node of graph.nodes) {
      g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }

    for (const edge of graph.edges) {
      if (graph.nodes.some((n) => n.id === edge.from) && graph.nodes.some((n) => n.id === edge.to)) {
        g.setEdge(edge.from, edge.to);
      }
    }

    dagre.layout(g);

    const nodes: LayoutNode[] = graph.nodes.map((node) => {
      const layoutNode = g.node(node.id);
      return {
        id: node.id,
        x: layoutNode.x,
        y: layoutNode.y,
        width: layoutNode.width,
        height: layoutNode.height,
        data: node,
      };
    });

    const edges: LayoutEdge[] = graph.edges
      .filter((e) => graph.nodes.some((n) => n.id === e.from) && graph.nodes.some((n) => n.id === e.to))
      .map((edge) => {
        const layoutEdge = g.edge(edge.from, edge.to);
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: edge.type,
          label: edge.label,
          points: layoutEdge?.points ?? [],
        };
      });

    setLayoutNodes(nodes);
    setLayoutEdges(edges);
  }, [graph]);

  // D3 visualization with dagre layout - depends on container size
  useEffect(() => {
    if (!svgRef.current || layoutNodes.length === 0 || containerSize.width === 0 || containerSize.height === 0) return;

    const svg = d3.select(svgRef.current);
    const width = containerSize.width;
    const height = containerSize.height;

    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    const gMain = svg.append("g").attr("class", "main-group");
    const gEdges = gMain.append("g").attr("class", "edges");
    const gNodes = gMain.append("g").attr("class", "nodes");

    // Arrow markers
    for (const [type, color] of Object.entries(EDGE_COLORS)) {
      defs
        .append("marker")
        .attr("id", `arrow-canvas-${type}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 8)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L10,0L0,4")
        .attr("fill", color);
    }

    const lineGenerator = d3
      .line<{ x: number; y: number }>()
      .x((d) => d.x)
      .y((d) => d.y)
      .curve(d3.curveBasis);

    // Render edges
    gEdges
      .selectAll<SVGPathElement, LayoutEdge>("path")
      .data(layoutEdges)
      .join("path")
      .attr("d", (d) => lineGenerator(d.points) ?? "")
      .attr("fill", "none")
      .attr("stroke", (d) => EDGE_COLORS[d.type])
      .attr("stroke-width", 2)
      .attr("marker-end", (d) => `url(#arrow-canvas-${d.type})`)
      .attr("opacity", 0.7);

    // Edge labels
    gEdges
      .selectAll<SVGTextElement, LayoutEdge>("text")
      .data(layoutEdges)
      .join("text")
      .attr("x", (d) => {
        const mid = Math.floor(d.points.length / 2);
        return d.points[mid]?.x ?? 0;
      })
      .attr("y", (d) => {
        const mid = Math.floor(d.points.length / 2);
        return (d.points[mid]?.y ?? 0) - 6;
      })
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("fill", (d) => EDGE_COLORS[d.type])
      .attr("opacity", 0.9)
      .text((d) => d.type);

    // Render nodes
    const nodeGroups = gNodes
      .selectAll<SVGGElement, LayoutNode>("g")
      .data(layoutNodes)
      .join("g")
      .attr("transform", (d) => `translate(${d.x - d.width / 2},${d.y - d.height / 2})`)
      .attr("cursor", "pointer")
      .on("click", (_, d) => {
        handleNodeClick(d.data);
      });

    // Node rectangles
    nodeGroups
      .append("rect")
      .attr("class", "node-rect")
      .attr("width", (d) => d.width)
      .attr("height", (d) => d.height)
      .attr("rx", 8)
      .attr("ry", 8)
      .attr("fill", (d) => resolveNodeColor(d.data.type).fill)
      .attr("stroke", (d) => resolveNodeColor(d.data.type).stroke)
      .attr("stroke-width", 2);

    // (Per-node index badge removed — the StagePalette nav already
    //  surfaces the current position as N/total, so showing the index
    //  on every node duplicated the same signal in two places.)

    // Generation-order pill — only when it differs from index (backward
    // thinking modes). Small, top-left of the node, visible signature of
    // abductive/inductive thinking.
    const divergentNodes = nodeGroups.filter(
      (d) =>
        typeof d.data.order === "number" &&
        d.data.order !== d.data.index,
    );

    divergentNodes
      .append("rect")
      .attr("x", 8)
      .attr("y", 6)
      .attr("width", 16)
      .attr("height", 10)
      .attr("rx", 2)
      .attr("fill", "rgba(15,23,42,0.9)")
      .attr("stroke", "rgba(148,163,184,0.4)")
      .attr("stroke-width", 0.5);

    divergentNodes
      .append("text")
      .attr("x", 16)
      .attr("y", 11)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "7px")
      .attr("font-weight", "500")
      .attr("fill", "#94a3b8")
      .attr("pointer-events", "none")
      .text((d) => `g${d.data.order}`);

    divergentNodes
      .append("title")
      .text(
        (d) =>
          `Presented at index ${d.data.index} · Generated ${(d.data.order ?? 0) + 1}${ordinalSuffix((d.data.order ?? 0) + 1)}`,
      );

    // Type badge (top-right)
    nodeGroups
      .append("rect")
      .attr("x", (d) => d.width - 60)
      .attr("y", 6)
      .attr("width", 54)
      .attr("height", 16)
      .attr("rx", 4)
      .attr("fill", "rgba(0,0,0,0.3)");

    nodeGroups
      .append("text")
      .attr("x", (d) => d.width - 33)
      .attr("y", 14)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "9px")
      .attr("font-weight", "500")
      .attr("fill", (d) => resolveNodeColor(d.data.type).text)
      .attr("text-transform", "uppercase")
      .attr("letter-spacing", "0.5px")
      .text((d) => d.data.type.slice(0, 9));

    // Node label (main text)
    nodeGroups
      .append("text")
      .attr("x", (d) => d.width / 2)
      .attr("y", (d) => d.height / 2 + 6)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "11px")
      .attr("font-weight", "500")
      .attr("fill", (d) => resolveNodeColor(d.data.type).text)
      .attr("pointer-events", "none")
      .text((d) => {
        const label = d.data.label;
        return label.length > 28 ? label.slice(0, 26) + "..." : label;
      });

    // Calculate bounds and center
    const bounds = {
      minX: Math.min(...layoutNodes.map((n) => n.x - n.width / 2)),
      maxX: Math.max(...layoutNodes.map((n) => n.x + n.width / 2)),
      minY: Math.min(...layoutNodes.map((n) => n.y - n.height / 2)),
      maxY: Math.max(...layoutNodes.map((n) => n.y + n.height / 2)),
    };
    const graphWidth = bounds.maxX - bounds.minX + 80;
    const graphHeight = bounds.maxY - bounds.minY + 80;
    const scale = Math.min(width / graphWidth, height / graphHeight, 1);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    const initialTransform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-centerX, -centerY);

    initialTransformRef.current = initialTransform;

    // Setup zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 3])
      .on("zoom", (event) => {
        gMain.attr("transform", event.transform.toString());
      });

    zoomRef.current = zoom;

    // Apply zoom behavior to SVG
    svg.call(zoom);

    // Apply initial transform to center and scale the graph
    svg.call(zoom.transform, initialTransform);

  }, [layoutNodes, layoutEdges, containerSize, handleNodeClick]);

  // Highlight selected node
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    svg.selectAll<SVGGElement, LayoutNode>("g.nodes g").each(function (d) {
      const g = d3.select(this);
      const isSelected = d.id === selectedNodeId;

      g.select("rect.node-rect")
        .attr("stroke-width", isSelected ? 4 : 2)
        .attr("stroke", isSelected ? ACTIVE_NODE_COLOR : resolveNodeColor(d.data.type).stroke);
    });
  }, [selectedNodeId]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim">
        No reasoning graph available
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 w-full h-full overflow-hidden relative">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className="cursor-grab active:cursor-grabbing"
        style={{ display: 'block' }}
      />
      {/* Floating summary card — top-left. Shows the graph's name + summary
          + structural counts so users can read the overall shape without
          leaving the canvas. Long summaries collapse to ~3 lines with an
          expand toggle; arcName is suppressed when it duplicates the
          summary (phase graphs without an explicit name fall back to
          summary, which would render the same text twice). */}
      {(() => {
        const summary = graph.summary?.trim() ?? "";
        const name = graph.arcName?.trim() ?? "";
        const showName = !!name && name !== summary;
        const isLong = summary.length > 180;
        return (
          <div className="absolute top-3 left-3 max-w-xs glass rounded-lg px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono mb-1">
              {inspectorContextType === "mode" ? "Mode" : "Causal Graph"}
            </div>
            {showName && (
              <div className="text-xs font-semibold text-text-primary mb-1 whitespace-normal wrap-break-word">
                {name}
              </div>
            )}
            {summary && (
              <div
                className={`text-[11px] text-text-secondary leading-snug whitespace-normal wrap-break-word ${
                  !summaryExpanded && isLong ? "line-clamp-3" : ""
                }`}
              >
                {summary}
              </div>
            )}
            <div className="flex items-center justify-between mt-1.5">
              <div className="text-[10px] text-text-dim/70 font-mono tabular-nums">
                {graph.nodes.length} node{graph.nodes.length === 1 ? '' : 's'} · {graph.edges.length} edge{graph.edges.length === 1 ? '' : 's'}
              </div>
              {isLong && (
                <button
                  type="button"
                  onClick={() => setSummaryExpanded((v) => !v)}
                  className="text-[10px] text-text-dim hover:text-violet-200 transition-colors font-mono uppercase tracking-wider"
                >
                  {summaryExpanded ? "Less" : "More"}
                </button>
              )}
            </div>
            {/* Conclusion preview — when the investigation yielded a
                definitive answer, surface the conclusion node's label inline
                so the canvas view reads the result without needing to walk
                the graph. Detail lives in the inspector when the user opens
                the node. */}
            {(() => {
              const conclusion = graph.nodes.find((n) => n.type === "conclusion");
              if (!conclusion) return null;
              return (
                <div className="mt-2 pt-2 border-t border-white/8">
                  <div className="flex items-baseline gap-1.5 mb-0.5">
                    <span className="text-[10px] leading-none text-amber-300">★</span>
                    <span className="text-[9px] uppercase tracking-[0.18em] text-amber-300/80 font-mono">Answer</span>
                  </div>
                  <div className="text-[11px] text-text-primary leading-snug whitespace-normal wrap-break-word">
                    {conclusion.label}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}
    </div>
  );
}
