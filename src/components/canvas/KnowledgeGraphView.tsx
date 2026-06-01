'use client';

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/store';
import { buildCumulativeSystemGraph } from '@/lib/narrative-utils';
import type { NarrativeState, SystemNode } from '@/types/narrative';
import EvalBar from '@/components/timeline/EvalBar';
import { computeGroups, SYS_TYPE_COLORS, type SysNode, type SysLink } from './graph-utils';
import { edgeWidthFor, SIM_ALPHA_START, SIM_ALPHA_DECAY, GRAPH_ZOOM_EXTENT, GRAPH_INITIAL_SCALE, FOCUS_OPACITY_ACTIVE, FOCUS_OPACITY_DIM, FOCUS_WIDTH_FACTOR_DIM, FOCUS_NODE_OPACITY_ACTIVE, FOCUS_NODE_OPACITY_DIM } from '@/lib/graph-styling';

// ── Fullscreen button ────────────────────────────────────────────────────────

export function FullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      title={isFullscreen ? 'Exit full screen' : 'Full screen'}
      className="absolute bottom-4 right-4 z-30 w-9 h-9 flex items-center justify-center glass-pill text-text-dim hover:text-text-primary transition-colors"
    >
      {isFullscreen ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3v3a2 2 0 0 1-2 2H3" />
          <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
          <path d="M3 16h3a2 2 0 0 1 2 2v3" />
          <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      )}
    </button>
  );
}

// ── Knowledge Graph Views (Insight + Nexus) ─────────────────────────────────

export default function KnowledgeGraphView({ narrative, resolvedKeys, currentIndex, mode, hideControls, hideLegend }: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentIndex: number;
  // 'system-arc' renders the cumulative system graph restricted to deltas
  // from scenes in the CURRENT ARC (scenes sharing currentScene.arcId, up
  // to currentIndex). Scene-attributed node highlighting still keys off
  // the current scene — the arc scope is purely a visibility filter on
  // the cumulative graph.
  mode: 'system-scene' | 'system-arc' | 'system-full';
  hideControls?: boolean;
  hideLegend?: boolean;
}) {
  const { dispatch } = useStore();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<SysNode, SysLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesRef = useRef<SysNode[]>([]);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showRelations, setShowRelations] = useState(false);
  const [showTypes, setShowTypes] = useState(true);
  const [showEval, setShowEval] = useState(true);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; concept: string; type: string; degree: number } | null>(null);
  const [sysGroups, setSysGroups] = useState<SysNode[][]>([]);
  const [sysFocusedGroupIndex, setSysFocusedGroupIndex] = useState<number | null>(null);

  const graphData = useMemo(() => {
    if (mode === 'system-scene') {
      const key = resolvedKeys[currentIndex];
      const scene = narrative.scenes[key];
      const wb = narrative.worldBuilds[key];
      const wkm = scene?.systemDeltas ?? wb?.expansionManifest.systemDeltas;
      if (!wkm) return { nodes: {}, edges: [] };
      const nodes: Record<string, SystemNode> = {};
      for (const n of wkm.addedNodes ?? []) {
        nodes[n.id] = { id: n.id, concept: n.concept, type: n.type };
      }
      for (const e of wkm.addedEdges ?? []) {
        if (!nodes[e.from] && narrative.systemGraph.nodes[e.from]) nodes[e.from] = narrative.systemGraph.nodes[e.from];
        if (!nodes[e.to] && narrative.systemGraph.nodes[e.to]) nodes[e.to] = narrative.systemGraph.nodes[e.to];
      }
      return { nodes, edges: wkm.addedEdges ?? [] };
    }
    if (mode === 'system-arc') {
      // Restrict the cumulative replay to scenes belonging to the current
      // arc, up to currentIndex. Includes world-build commits at those
      // positions (they ride alongside the scene at the same index).
      const currentKey = resolvedKeys[currentIndex];
      const currentScene = currentKey ? narrative.scenes[currentKey] : undefined;
      const currentArcId = currentScene?.arcId;
      if (!currentArcId) return { nodes: {}, edges: [] };
      const arcKeys = resolvedKeys.slice(0, currentIndex + 1).filter((k) => {
        const s = narrative.scenes[k];
        if (s) return s.arcId === currentArcId;
        // World-build commits don't carry arcId — include them if they
        // sit on the same timeline window as the arc.
        return !!narrative.worldBuilds[k];
      });
      return buildCumulativeSystemGraph(narrative.scenes, arcKeys, arcKeys.length - 1, narrative.worldBuilds);
    }
    return buildCumulativeSystemGraph(narrative.scenes, resolvedKeys, currentIndex, narrative.worldBuilds);
  }, [narrative, resolvedKeys, currentIndex, mode]);

  // Scene-added node IDs for highlight in the broader scopes (codex /
  // spark-arc). Spark renders only the scene's own delta so the highlight
  // wouldn't add information there.
  const sceneNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (mode === 'system-full' || mode === 'system-arc') {
      const key = resolvedKeys[currentIndex];
      const scene = narrative.scenes[key];
      const wb = narrative.worldBuilds[key];
      const wkm = scene?.systemDeltas ?? wb?.expansionManifest.systemDeltas;
      for (const n of wkm?.addedNodes ?? []) ids.add(n.id);
    }
    return ids;
  }, [narrative, resolvedKeys, currentIndex, mode]);

  // ── Initial setup: create SVG structure, zoom, glow filters (once) ──
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    // Arrowhead marker (placed midway via marker-mid on polylines). context-
    // stroke makes the head inherit each line's stroke colour.
    svg.append('defs').append('marker')
      .attr('id', 'wk-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 9)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'context-stroke');

    const g = svg.append('g');
    gRef.current = g;

    // Zoom — shared config across all canvas graph views.
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent(GRAPH_ZOOM_EXTENT)
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);
    zoomRef.current = zoom;
    const width = svgEl.clientWidth ?? 800;
    const height = svgEl.clientHeight ?? 600;
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(GRAPH_INITIAL_SCALE));

    // Create link and node groups (order matters for layering)
    g.append('g').attr('class', 'wk-links');
    // Halos render between links and nodes — bloom sits behind the node but
    // above any link passing through.
    g.append('g').attr('class', 'wk-halos');
    g.append('g').attr('class', 'wk-nodes');
    g.append('g').attr('class', 'wk-labels');

    // Simulation
    const sim = d3.forceSimulation<SysNode, SysLink>()
      .force('link', d3.forceLink<SysNode, SysLink>([]).id((d) => d.id).distance(140))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(0, 0))
      .force('x', d3.forceX(0).strength(0.05))
      .force('y', d3.forceY(0).strength(0.05))
      .force('collide', d3.forceCollide<SysNode>().radius(40));
    simRef.current = sim;

    return () => { sim.stop(); simRef.current = null; gRef.current = null; };
  }, []); // Only on mount

  // ── Data update: merge nodes/links into persistent simulation ──
  useEffect(() => {
    const sim = simRef.current;
    const g = gRef.current;
    if (!sim || !g) return;

    const nodeList = Object.values(graphData.nodes);
    const degreeMap = new Map<string, number>();
    for (const e of graphData.edges) {
      degreeMap.set(e.from, (degreeMap.get(e.from) ?? 0) + 1);
      degreeMap.set(e.to, (degreeMap.get(e.to) ?? 0) + 1);
    }
    // Per-node usage count across the visible window. Counts both
    // introductions (systemDeltas.addedNodes) and attributions
    // (systemAttributions) — every reference is a usage; the introduction
    // is the first usage. This is the "usefulness" signal that combines
    // with edge degree below so isolated-but-highly-cited rules still read
    // as load-bearing.
    const activationMap = new Map<string, number>();
    for (let i = 0; i <= currentIndex && i < resolvedKeys.length; i++) {
      const key = resolvedKeys[i];
      const scene = narrative.scenes[key];
      if (!scene) continue;
      for (const n of scene.systemDeltas?.addedNodes ?? []) {
        activationMap.set(n.id, (activationMap.get(n.id) ?? 0) + 1);
      }
      for (const id of scene.attributions ?? []) {
        if (!id.startsWith('SYS-')) continue;
        activationMap.set(id, (activationMap.get(id) ?? 0) + 1);
      }
    }
    const maxDegree = Math.max(...nodeList.map((n) => degreeMap.get(n.id) ?? 0), 1);
    const maxActivation = Math.max(...nodeList.map((n) => activationMap.get(n.id) ?? 0), 1);
    const nodeRadius = (d: SysNode) => {
      // 60% activation, 40% degree — usefulness leads, structure backs it up.
      const aNorm = (activationMap.get(d.id) ?? 0) / maxActivation;
      const dNorm = (d.degree ?? 0) / maxDegree;
      return 10 + (aNorm * 0.6 + dNorm * 0.4) * 28;
    };

    // Preserve positions of existing nodes
    const prevPos = new Map(nodesRef.current.map((n) => [n.id, { x: n.x, y: n.y }]));
    const simNodes: SysNode[] = nodeList.map((n) => {
      const prev = prevPos.get(n.id);
      return { id: n.id, concept: n.concept, type: n.type, degree: degreeMap.get(n.id) ?? 0, ...(prev ?? {}) };
    });
    nodesRef.current = simNodes;
    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: SysLink[] = graphData.edges
      .filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map((e) => ({ source: nodeMap.get(e.from)!, target: nodeMap.get(e.to)!, relation: e.relation }));

    // Update links — polylines (source → midpoint → target) so each edge
    // shows direction via an arrowhead at its midpoint without breaking the
    // straight centre-to-centre geometry.
    const linkSel = g.select<SVGGElement>('g.wk-links')
      .selectAll<SVGPolylineElement, SysLink>('polyline')
      .data(simLinks, (d) => `${(d.source as SysNode).id}-${(d.target as SysNode).id}`);
    linkSel.exit().remove();
    const linkEnter = linkSel.enter().append('polyline');
    const linkAll = linkEnter.merge(linkSel)
      // Apply fill='none' AND vector-effect to the merged selection so
      // persisting polylines can't render as solid triangles (3-point
      // polyline + default fill).
      .attr('fill', 'none')
      .attr('vector-effect', 'non-scaling-stroke');
    // Edge intensity: opacity uses the shared focus pattern (active /
    // dim). In codex mode, edges touching a scene-attributed node read
    // at FOCUS_OPACITY_ACTIVE; everything else — including the case
    // where no system nodes were activated at this scene — stays at
    // FOCUS_OPACITY_DIM so structure is visible without competing with
    // the focal set. Spark mode (no scene focus) just uses the active
    // opacity uniformly. Width still tracks endpoint degree so the
    // global topology is legible.
    const edgeT = (d: SysLink) =>
      ((d.source as SysNode).degree + (d.target as SysNode).degree) / (maxDegree * 2);
    // Base edge styles — pulled out as named callbacks so the mouseleave
    // handler can restore them without duplicating the focus logic.
    // Spark renders only the scene's own delta — every visible edge IS
    // active, no focus needed. Codex (full) and system-arc (arc) render
    // broader sets where the current-scene focus needs to pop above a
    // dim baseline.
    const baseEdgeOpacity = (d: SysLink): number => {
      if (mode === 'system-scene') return FOCUS_OPACITY_ACTIVE;
      const touches = sceneNodeIds.has((d.source as SysNode).id) ||
        sceneNodeIds.has((d.target as SysNode).id);
      return touches ? FOCUS_OPACITY_ACTIVE : FOCUS_OPACITY_DIM;
    };
    const baseEdgeWidth = (d: SysLink): number => {
      const base = edgeWidthFor(edgeT(d));
      if (mode === 'system-scene') return base;
      const touches = sceneNodeIds.has((d.source as SysNode).id) ||
        sceneNodeIds.has((d.target as SysNode).id);
      return touches ? base : base * FOCUS_WIDTH_FACTOR_DIM;
    };
    linkAll
      // Theme-aware stroke via CSS variable (white on dark, dark ink on light).
      .style('stroke', 'var(--graph-edge)')
      // .style() (inline) so the values can't be overridden by any cached
      // or future CSS rule on parent classes.
      .style('opacity', baseEdgeOpacity)
      .style('stroke-width', baseEdgeWidth)
      .attr('marker-mid', 'url(#wk-arrow)');

    // Adjacency for hover highlighting — built from simLinks so edges that
    // share endpoints with the hovered node can be lit independently of
    // the scene-focus baseline.
    const adjacency = new Map<string, Set<string>>();
    for (const l of simLinks) {
      const a = (l.source as SysNode).id;
      const b = (l.target as SysNode).id;
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a)!.add(b);
      adjacency.get(b)!.add(a);
    }

    // Halos for nodes the current scene introduced or touched. Replaces the
    // earlier "dim non-scene nodes" approach so concept colours read true
    // and the just-changed set pops via the bloom.
    const isActive = (d: SysNode) => (mode === 'system-full' || mode === 'system-arc') && sceneNodeIds.has(d.id);
    const activeNodes = simNodes.filter(isActive);
    const haloSel = g.select<SVGGElement>('g.wk-halos')
      .selectAll<SVGCircleElement, SysNode>('circle')
      .data(activeNodes, (d) => d.id);
    haloSel.exit().remove();
    const haloEnter = haloSel.enter().append('circle');
    const haloAll = haloEnter.merge(haloSel);
    haloAll
      .attr('r', (d) => nodeRadius(d) + 10)
      .attr('fill', (d) => showTypes ? (SYS_TYPE_COLORS[d.type] ?? '#888') : '#888')
      .attr('opacity', 0.32)
      .attr('pointer-events', 'none');

    // Update nodes
    const nodeSel = g.select<SVGGElement>('g.wk-nodes')
      .selectAll<SVGCircleElement, SysNode>('circle')
      .data(simNodes, (d) => d.id);
    nodeSel.exit().remove();
    const nodeEnter = nodeSel.enter().append('circle').style('cursor', 'pointer');
    const nodeAll = nodeEnter.merge(nodeSel);
    nodeAll
      .attr('class', 'graph-node')
      .attr('r', nodeRadius)
      .attr('fill', (d) => showTypes ? (SYS_TYPE_COLORS[d.type] ?? '#888') : '#888')
      .attr('stroke', (d) => isActive(d) ? '#fff' : 'transparent')
      .attr('stroke-width', 2)
      // Node focus: in codex / spark-arc, scene-attributed nodes read at
      // full opacity; others dim. Spark renders only the scene's own delta
      // so every node IS active — uniform full opacity. Same primitive
      // WG / TGV / Network.
      .style('opacity', (d) => {
        if (mode === 'system-scene') return FOCUS_NODE_OPACITY_ACTIVE;
        return isActive(d) ? FOCUS_NODE_OPACITY_ACTIVE : FOCUS_NODE_OPACITY_DIM;
      });

    // Tooltip + drag events
    const drag = d3.drag<SVGCircleElement, SysNode>()
      .on('start', (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
        setTooltip(null);
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null; d.fy = null;
      });
    nodeAll.call(drag);

    nodeAll
      .on('mouseenter', (event, d) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (rect) {
          setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top - 10, concept: d.concept, type: d.type, degree: d.degree });
        }
        // Activate edges incident to the hovered node; collapse the rest
        // below the dim baseline so the focal star reads as the only
        // structure on screen. Matches the same primitive WG / TGV /
        // Network use.
        const incident = (l: SysLink) => {
          const sId = (l.source as SysNode).id;
          const tId = (l.target as SysNode).id;
          return sId === d.id || tId === d.id;
        };
        g.select<SVGGElement>('g.wk-links')
          .selectAll<SVGPolylineElement, SysLink>('polyline')
          .style('opacity', (l) => incident(l) ? Math.max(FOCUS_OPACITY_ACTIVE + 0.15, 0.65) : 0.03)
          .style('stroke-width', (l) => incident(l) ? edgeWidthFor(edgeT(l)) : edgeWidthFor(edgeT(l)) * FOCUS_WIDTH_FACTOR_DIM);
        // Also fade non-adjacent nodes so the cluster pops.
        const neighbors = adjacency.get(d.id) ?? new Set<string>();
        g.select<SVGGElement>('g.wk-nodes')
          .selectAll<SVGCircleElement, SysNode>('circle')
          .style('opacity', (o) => (o.id === d.id || neighbors.has(o.id)) ? FOCUS_NODE_OPACITY_ACTIVE : 0.18);
      })
      .on('mouseleave', () => {
        setTooltip(null);
        // Restore base scoped styles (edges by focus rule, nodes by isActive).
        g.select<SVGGElement>('g.wk-links')
          .selectAll<SVGPolylineElement, SysLink>('polyline')
          .style('opacity', baseEdgeOpacity)
          .style('stroke-width', baseEdgeWidth);
        g.select<SVGGElement>('g.wk-nodes')
          .selectAll<SVGCircleElement, SysNode>('circle')
          .style('opacity', (o) => {
            if (mode === 'system-scene') return FOCUS_NODE_OPACITY_ACTIVE;
            return isActive(o) ? FOCUS_NODE_OPACITY_ACTIVE : FOCUS_NODE_OPACITY_DIM;
          });
      })
      .on('click', (_event, d) => {
        _event.stopPropagation();
        dispatch({ type: 'SET_INSPECTOR', context: { type: 'knowledge', nodeId: d.id } });
        window.dispatchEvent(new CustomEvent('focus-knowledge-node', { detail: { nodeId: d.id } }));
      });

    // Update labels
    const labelSel = g.select<SVGGElement>('g.wk-labels')
      .selectAll<SVGTextElement, SysNode>('text')
      .data(simNodes, (d) => d.id);
    labelSel.exit().remove();
    const labelEnter = labelSel.enter().append('text').attr('text-anchor', 'middle');
    const labelAll = labelEnter.merge(labelSel);
    labelAll
      .attr('fill', (d) => showTypes ? (SYS_TYPE_COLORS[d.type] ?? '#ccc') : '#ccc')
      .attr('font-size', (d) => `${Math.max(9, 9 + (d.degree / maxDegree) * 4)}px`)
      .attr('font-weight', (d) => d.degree >= maxDegree * 0.5 ? '600' : '400')
      .attr('display', showLabels ? 'block' : 'none')
      .attr('opacity', 1)
      .text((d) => {
        // Truncate at em dash or long descriptions for clean graph labels
        const concept = d.concept ?? '';
        const dash = concept.indexOf(' — ');
        return dash > 0 ? concept.slice(0, dash) : concept.slice(0, 40) + (concept.length > 40 ? '…' : '');
      });

    // Relation labels on edges
    const relGroup = g.selectAll<SVGGElement, unknown>('g.wk-relations').data([0]);
    const relGroupEnter = relGroup.enter().append('g').attr('class', 'wk-relations');
    const relGroupAll = relGroupEnter.merge(relGroup);
    const relSel = relGroupAll
      .selectAll<SVGTextElement, SysLink>('text')
      .data(simLinks, (d) => `${(d.source as SysNode).id}-${(d.target as SysNode).id}-rel`);
    relSel.exit().remove();
    const relEnter = relSel.enter().append('text').attr('text-anchor', 'middle').attr('font-size', '8px');
    const relAll = relEnter.merge(relSel);
    relAll
      .attr('fill', '#ffffff30')
      .attr('display', showRelations ? 'block' : 'none')
      .text((d) => d.relation);

    // Update simulation
    sim.nodes(simNodes);
    (sim.force('link') as d3.ForceLink<SysNode, SysLink>).links(simLinks);
    (sim.force('collide') as d3.ForceCollide<SysNode>).radius((d) => nodeRadius(d) + 30);
    sim.on('tick', () => {
      linkAll
        .attr('points', (d) => {
          const sx = (d.source as SysNode).x ?? 0;
          const sy = (d.source as SysNode).y ?? 0;
          const tx = (d.target as SysNode).x ?? 0;
          const ty = (d.target as SysNode).y ?? 0;
          return `${sx},${sy} ${(sx + tx) / 2},${(sy + ty) / 2} ${tx},${ty}`;
        });
      nodeAll
        .attr('cx', (d) => d.x ?? 0)
        .attr('cy', (d) => d.y ?? 0);
      haloAll
        .attr('cx', (d) => d.x ?? 0)
        .attr('cy', (d) => d.y ?? 0);
      labelAll
        .attr('x', (d) => d.x ?? 0)
        .attr('y', (d) => d.y ?? 0)
        .attr('dy', (d) => -(nodeRadius(d) + 5));
      relAll
        .attr('x', (d) => ((d.source as SysNode).x! + (d.target as SysNode).x!) / 2)
        .attr('y', (d) => ((d.source as SysNode).y! + (d.target as SysNode).y!) / 2);
    });
    sim.alpha(SIM_ALPHA_START).alphaDecay(SIM_ALPHA_DECAY).restart();

    // Compute connected groups and reset focus
    setSysGroups(computeGroups(simNodes, simLinks));
    setSysFocusedGroupIndex(null);
  }, [graphData, mode, sceneNodeIds, showLabels, showRelations, showTypes]);

  // ── Zoom to focused group ──
  useEffect(() => {
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!svgEl || !zoom || sysFocusedGroupIndex === null || !sysGroups[sysFocusedGroupIndex]) return;

    const group = sysGroups[sysFocusedGroupIndex];
    const width = svgEl.clientWidth || 800;
    const height = svgEl.clientHeight || 600;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of group) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const padding = 80;
    minX -= padding; minY -= padding; maxX += padding; maxY += padding;
    const bw = maxX - minX;
    const bh = maxY - minY;
    const scale = Math.min(width / bw, height / bh, 2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-cx, -cy);

    d3.select(svgEl)
      .transition()
      .duration(500)
      .call(zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void, transform);
  }, [sysFocusedGroupIndex, sysGroups]);

  const navigateSysGroup = useCallback(
    (direction: 'next' | 'prev' | 'reset') => {
      if (sysGroups.length === 0) return;
      if (direction === 'reset') {
        setSysFocusedGroupIndex(null);
        const svgEl = svgRef.current;
        const zoom = zoomRef.current;
        if (svgEl && zoom) {
          const width = svgEl.clientWidth ?? 800;
          const height = svgEl.clientHeight ?? 600;
          d3.select(svgEl)
            .transition()
            .duration(500)
            .call(zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void, d3.zoomIdentity.translate(width / 2, height / 2).scale(GRAPH_INITIAL_SCALE));
        }
        return;
      }
      setSysFocusedGroupIndex((prev) => {
        if (prev === null) return 0;
        if (direction === 'next') return (prev + 1) % sysGroups.length;
        return (prev - 1 + sysGroups.length) % sysGroups.length;
      });
    },
    [sysGroups],
  );

  // Listen for focus-knowledge-node events and zoom to the target
  useEffect(() => {
    const handler = (e: Event) => {
      const nodeId = (e as CustomEvent).detail?.nodeId;
      if (!nodeId) return;
      const target = nodesRef.current.find((n) => n.id === nodeId);
      const svgEl = svgRef.current;
      const zoom = zoomRef.current;
      if (!target || !svgEl || !zoom || target.x == null || target.y == null) return;
      const svg = d3.select(svgEl);
      const width = svgEl.clientWidth ?? 800;
      const height = svgEl.clientHeight ?? 600;
      const scale = 2;
      const transform = d3.zoomIdentity
        .translate(width / 2 - target.x * scale, height / 2 - target.y * scale)
        .scale(scale);
      svg.transition().duration(600).call(
        zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void,
        transform,
      );
    };
    window.addEventListener('focus-knowledge-node', handler);
    return () => window.removeEventListener('focus-knowledge-node', handler);
  }, []);

  const legendStripItems = [
    { key: 'labels', label: 'Labels', checked: showLabels, toggle: () => setShowLabels((v) => !v) },
    { key: 'relations', label: 'Relations', checked: showRelations, toggle: () => setShowRelations((v) => !v) },
    { key: 'types', label: 'Types', checked: showTypes, toggle: () => setShowTypes((v) => !v) },
    { key: 'eval', label: 'Eval', checked: showEval, toggle: () => setShowEval((v) => !v) },
  ];

  return (
    <div className={hideControls ? 'flex flex-col absolute inset-0 z-20' : 'absolute inset-0 z-20'}>
      {/* Legend strip — replaces floating controls */}
      {hideControls && (
        <div className="shrink-0 flex items-center gap-0 px-2 h-7 border-b border-border glass-panel z-30">
          {legendStripItems.map(({ key, label, checked, toggle }) => (
            <button key={key} onClick={toggle}
              className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${checked ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'}`}>
              {label}
            </button>
          ))}
          {showTypes && (
            <>
              <div className="w-px h-3 bg-border mx-1" />
              {Object.entries(SYS_TYPE_COLORS).map(([type, color]) => (
                <span key={type} className="flex items-center gap-1 px-1">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[8px] text-text-dim/50 capitalize">{type}</span>
                </span>
              ))}
            </>
          )}
        </div>
      )}
      <div className={hideControls ? 'relative flex-1 overflow-hidden' : 'h-full w-full'}>
      <svg ref={svgRef} className="h-full w-full" style={{ background: 'transparent' }} />
      {/* Floating controls fallback — only when not using legend strip */}
      {!hideControls && (
      <div className="absolute top-2 left-2 z-30 flex items-center gap-0">
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showLabels} onChange={() => setShowLabels((v) => !v)} className="accent-accent-cta w-3 h-3" />
          Labels
        </label>
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showRelations} onChange={() => setShowRelations((v) => !v)} className="accent-accent-cta w-3 h-3" />
          Relations
        </label>
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showTypes} onChange={() => setShowTypes((v) => !v)} className="accent-accent-cta w-3 h-3" />
          Types
        </label>
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showEval} onChange={() => setShowEval((v) => !v)} className="accent-accent-cta w-3 h-3" />
          Eval
        </label>
      </div>
      )}
      {showEval && <EvalBar />}
      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-40 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y - 12, transform: 'translate(-50%, -100%)' }}
        >
          <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 shadow-xl max-w-sm">
            <div className="flex items-start gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ background: SYS_TYPE_COLORS[tooltip.type] ?? '#888', boxShadow: `0 0 6px ${SYS_TYPE_COLORS[tooltip.type] ?? '#888'}80` }} />
              <div>
                <span className="text-xs font-semibold text-text-primary whitespace-normal wrap-break-word">{tooltip.concept}</span>
                <span className="text-[10px] text-text-dim capitalize ml-1">({tooltip.type})</span>
              </div>
            </div>
            <div className="text-[10px] text-text-secondary">{tooltip.degree} connection{tooltip.degree !== 1 ? 's' : ''}</div>
          </div>
          <div className="flex justify-center"><div className="w-2.5 h-2.5 bg-bg-elevated border-r border-b border-border rotate-45 -mt-1.5" /></div>
        </div>
      )}
      {/* Legend + Group navigation (bottom-left) */}
      <div className="absolute bottom-4 left-2 z-30 flex flex-col gap-1 items-start">
        {!hideLegend && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-bg-surface text-[10px] leading-none text-text-dim">
          {Object.entries(SYS_TYPE_COLORS).map(([type, color]) => (
            <span key={type} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              <span className="capitalize">{type}</span>
            </span>
          ))}
        </div>
        )}
        {sysGroups.length > 1 && (
        <div className="flex items-center gap-1 rounded bg-bg-surface text-[11px] leading-none">
          <button
            className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
            onClick={() => navigateSysGroup('prev')}
            title="Previous group"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="text-text-dim px-0.5 tabular-nums">
            {sysFocusedGroupIndex !== null
              ? `${sysFocusedGroupIndex + 1}/${sysGroups.length} (${sysGroups[sysFocusedGroupIndex].length})`
              : `${sysGroups.length} groups`}
          </span>
          <button
            className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
            onClick={() => navigateSysGroup('next')}
            title="Next group"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
          {sysFocusedGroupIndex !== null && (
            <>
              <div className="w-px h-3.5 bg-border" />
              <button
                className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
                onClick={() => navigateSysGroup('reset')}
                title="Reset view"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
              </button>
            </>
          )}
        </div>
        )}
      </div>
      </div>
    </div>
  );
}
