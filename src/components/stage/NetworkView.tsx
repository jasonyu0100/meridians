'use client';
// NetworkView — Stage Network surface: aggregate connection graph across all entities, rendered with D3.

import { useRef, useEffect, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/state/store';
import { aggregateNetworkGraph, type HeatTier, type NetworkNode } from '@/lib/graph/network-graph';
import { heatColor } from './graph-utils';
import { edgeWidthFor, SIM_ALPHA_START, SIM_ALPHA_DECAY, GRAPH_ZOOM_EXTENT, GRAPH_INITIAL_SCALE, FOCUS_OPACITY_ACTIVE, FOCUS_OPACITY_DIM, FOCUS_WIDTH_FACTOR_DIM, FOCUS_NODE_OPACITY_ACTIVE, FOCUS_NODE_OPACITY_DIM } from '@/lib/graph/graph-styling';
import type { AttributionEdgeRelation } from '@/types/narrative';

type NNode = d3.SimulationNodeDatum & NetworkNode & { degree: number };
type NLink = d3.SimulationLinkDatum<NNode> & { weight: number; relations?: AttributionEdgeRelation[] };

type Scope = 'scene' | 'arc' | 'narrative';

// Three-force palette. Threads = Fate, character/location/artifact = World,
// system = System. Used both as node fill in force mode and as the
// per-endpoint colour for edge stroke blending.
type ForceGroup = 'fate' | 'world' | 'system';
const FORCE_GROUP: Record<NetworkNode['kind'], ForceGroup> = {
  thread: 'fate',
  character: 'world',
  location: 'world',
  artifact: 'world',
  system: 'system',
};
const FORCE_COLOR: Record<ForceGroup, string> = {
  fate: '#EF4444',
  world: '#22C55E',
  system: '#3B82F6',
};
const FORCE_FILL: Record<NetworkNode['kind'], string> = {
  thread: FORCE_COLOR.fate,
  character: FORCE_COLOR.world,
  location: FORCE_COLOR.world,
  artifact: FORCE_COLOR.world,
  system: FORCE_COLOR.system,
};

// Note: the previous bespoke HEAT_RAMP (slate→ember→amber→red) and the
// FRESH_FILL cyan accent were dropped — node heat now uses the shared
// `heatColor` from graph-utils for parity with Stage, and edges
// render as plain white (also matching WG) instead of force-blended.

export default function NetworkView() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<NNode, NLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesRef = useRef<NNode[]>([]);

  const [showLabels, setShowLabels] = useState(true);
  // Scope is driven by the topbar's Scene / Arc / Full toggle via
  // `graphViewMode`. We map the three network modes onto the existing
  // Scope union so the aggregation code below doesn't change.
  const scope: Scope =
    state.viewState.graphViewMode === 'network-scene' ? 'scene'
    : state.viewState.graphViewMode === 'network-arc' ? 'arc'
    : 'narrative';
  // Heat is off by default — node fill defaults to the force colour
  // (fate/world/system) so the categorical signal reads cleanly.
  // Toggle on to swap the fill to the attribution-heat ramp.
  const [heatOn, setHeatOn] = useState(false);
  // Periphery off (default) hides nodes with zero attributions in the
  // current scope — entities that exist in the world but haven't been
  // touched in this scene / arc / narrative window. Toggle on to bring
  // them back in as the surrounding "rest of the world" context.
  const [showPeriphery, setShowPeriphery] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: NetworkNode } | null>(null);

  // Scope-aware aggregation:
  //   narrative — every resolved key up to the current scene (cumulative)
  //   arc       — only resolved keys belonging to the current arc (scenes
  //               sharing the current scene's arcId, up to the current index)
  //   scene     — only the current scene (single attribution step)
  // Arc and scene scopes hide edge relation labels; scene scope shows them
  // (one step → at most one relation per edge, so the label is meaningful).
  const network = useMemo(() => {
    if (!narrative) return { nodes: [], edges: [], graphCount: 0 };
    const keys = state.resolvedEntryKeys;
    const idx = state.viewState.currentSceneIndex;
    if (scope === 'narrative') {
      return aggregateNetworkGraph(narrative, keys, idx);
    }
    if (scope === 'scene') {
      const key = keys[idx];
      if (!key) return aggregateNetworkGraph(narrative, [], -1);
      // Pass the full cumulative timeline so prior-introduced entities are
      // visible; restrict attribution accumulation to just this scene.
      return aggregateNetworkGraph(narrative, keys, idx, { scopeKeys: new Set([key]) });
    }
    // arc scope — restrict attribution to the current arc's scenes, but keep
    // the cumulative timeline as the entity-existence source so cross-arc
    // references render with their attribution origin nodes.
    const currentKey = keys[idx];
    const currentScene = currentKey ? narrative.scenes[currentKey] : undefined;
    const arcId = currentScene?.arcId;
    if (!arcId) return aggregateNetworkGraph(narrative, [], -1);
    const arcScopeKeys = new Set(
      keys.slice(0, idx + 1).filter((k) => {
        const s = narrative.scenes[k];
        return s && s.arcId === arcId;
      }),
    );
    return aggregateNetworkGraph(narrative, keys, idx, { scopeKeys: arcScopeKeys });
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex, scope]);

  // Edge labels are only meaningful in scene scope — at higher scopes, multiple
  // edges between the same pair collapse into one network edge whose `relations`
  // could carry contradictory relations across scenes. Hide them entirely there.
  const showEdgeLabels = scope === 'scene';

  const kindCounts = useMemo(() => {
    const counts: Record<NetworkNode['kind'], number> = { character: 0, location: 0, artifact: 0, thread: 0, system: 0 };
    for (const n of network.nodes) counts[n.kind] += 1;
    return counts;
  }, [network.nodes]);

  // Two visual channels:
  //   - HEAT (continuous, drives node fill when the Heat toggle is on) =
  //     attribution intensity, using the same blue→green→red ramp
  //     Stage uses so the colour reading is consistent across
  //     graphs.
  //   - FORCE (categorical, drives halo + label, and fill when Heat is
  //     off) = which of the three forces a node belongs to.
  // maxAttribution is recomputed every data refresh; this ref keeps the
  // helper callable from any callback without a re-render.
  const heatCacheRef = useRef({ maxAttribution: 1 });
  const heatFillOf = (n: NetworkNode): string => {
    const t = heatCacheRef.current.maxAttribution > 0
      ? Math.min(1, n.attributions / heatCacheRef.current.maxAttribution)
      : 0;
    return heatColor(t);
  };
  const forceColorOf = (n: NetworkNode): string => FORCE_FILL[n.kind];

  // Initial setup
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    // Arrowhead marker placed at the polyline midpoint via marker-mid.
    // Matches the pattern used in Stage / SystemGraphView /
    // ThreadGraphView so every canvas graph encodes edge direction the
    // same way. context-stroke makes the head inherit each line's
    // stroke colour, including the blended force-field hues here.
    svg.append('defs').append('marker')
      .attr('id', 'n-arrow')
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
    const width = svgEl.clientWidth ?? 800;
    const height = svgEl.clientHeight ?? 600;
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(GRAPH_INITIAL_SCALE));

    g.append('g').attr('class', 'n-links');
    g.append('g').attr('class', 'n-edge-labels');
    // Halos sit between edges and nodes so the soft glow reads beneath
    // each active circle. Same layering pattern as TGV / KGV.
    g.append('g').attr('class', 'n-halos');
    g.append('g').attr('class', 'n-nodes');
    g.append('g').attr('class', 'n-labels');

    // Force settings tuned to match the system graph's spread and breathing.
    const sim = d3.forceSimulation<NNode, NLink>()
      .force('link', d3.forceLink<NNode, NLink>([]).id((d) => d.id).distance(140))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(0, 0))
      .force('x', d3.forceX(0).strength(0.05))
      .force('y', d3.forceY(0).strength(0.05))
      .force('collide', d3.forceCollide<NNode>().radius(40));
    simRef.current = sim;

    return () => { sim.stop(); simRef.current = null; gRef.current = null; };
  }, []);

  // Toggle labels visibility
  useEffect(() => {
    const g = gRef.current;
    if (!g) return;
    g.select('g.n-labels').attr('display', showLabels ? null : 'none');
  }, [showLabels]);

  // Data update
  useEffect(() => {
    const sim = simRef.current;
    const g = gRef.current;
    if (!sim || !g) return;
    setTooltip(null);

    // Apply the periphery filter BEFORE we compute degree /
    // max-attribution / sim layout — when periphery is off, nodes
    // with zero attributions in scope are dropped cleanly so the
    // remaining metrics scale against what's actually shown.
    const visibleNodes = showPeriphery
      ? network.nodes
      : network.nodes.filter((n) => n.attributions > 0);
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = showPeriphery
      ? network.edges
      : network.edges.filter((e) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to));

    // Degree from network edges (used for label sizing/opacity, matching system).
    const degreeMap = new Map<string, number>();
    for (const e of visibleEdges) {
      degreeMap.set(e.from, (degreeMap.get(e.from) ?? 0) + 1);
      degreeMap.set(e.to, (degreeMap.get(e.to) ?? 0) + 1);
    }
    const maxDegree = Math.max(...visibleNodes.map((n) => degreeMap.get(n.id) ?? 0), 1);
    const maxAttribution = Math.max(...visibleNodes.map((n) => n.attributions), 1);
    heatCacheRef.current.maxAttribution = maxAttribution;

    // Node radius — combine attribution AND degree so unreferenced nodes still
    // show as legible dots and load-bearing ones grow large like in system graph.
    const radiusOf = (d: NNode) => {
      const attrTerm = (d.attributions / maxAttribution) * 22;
      const degTerm = (d.degree / maxDegree) * 6;
      return 8 + attrTerm + degTerm;
    };

    const prevPos = new Map(nodesRef.current.map((n) => [n.id, { x: n.x, y: n.y, fx: n.fx, fy: n.fy }]));
    const simNodes: NNode[] = visibleNodes.map((n) => {
      const prev = prevPos.get(n.id);
      return {
        ...n,
        degree: degreeMap.get(n.id) ?? 0,
        ...(prev ?? {}),
      };
    });
    nodesRef.current = simNodes;
    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: NLink[] = visibleEdges
      .filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map((e) => ({
        source: nodeMap.get(e.from)!,
        target: nodeMap.get(e.to)!,
        weight: e.weight,
        relations: e.relations,
      }));

    // Adjacency for hover highlighting
    const adjacency = new Map<string, Set<string>>();
    for (const link of simLinks) {
      const a = (link.source as NNode).id;
      const b = (link.target as NNode).id;
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a)!.add(b);
      adjacency.get(b)!.add(a);
    }

    // Active set for the focus effect: nodes attributed AT the current
    // Active set comes directly from what the current scene attributed:
    //   nodes  ← scene.attributions      (the node ids referenced)
    //   edges  ← scene.attributionEdges  (the specific from→to pairs
    //                                     that actually occurred this
    //                                     scene)
    // Reading attributionEdges directly gives us exact per-scene edge
    // activation regardless of scope (works the same in narrative /
    // arc / scene mode) and covers world-build steps too. Falls back
    // to "both endpoints attributed" only when a scene has
    // attributions but no explicit attributionEdges (older data).
    const currentKey = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    const currentEntry = currentKey && narrative
      ? (narrative.scenes[currentKey] ?? narrative.worldBuilds[currentKey])
      : null;
    const activeNodeIds = new Set<string>(currentEntry?.attributions ?? []);
    const activeEdgeKey = new Set<string>();
    for (const ae of currentEntry?.attributionEdges ?? []) {
      // Edges are undirected for activation purposes; store both directions.
      activeEdgeKey.add(`${ae.from}|${ae.to}`);
      activeEdgeKey.add(`${ae.to}|${ae.from}`);
    }
    const isEdgeActive = (l: NLink): boolean => {
      const srcId = (l.source as NNode).id;
      const tgtId = (l.target as NNode).id;
      // Primary signal: scene's recorded attribution edges. In world
      // scope this surfaces the scene's declared subgraph as a
      // recognisable bright cluster inside the broader aggregate
      // network — the same shape that scene scope renders on its own.
      if (activeEdgeKey.size > 0) return activeEdgeKey.has(`${srcId}|${tgtId}`);
      // Fallback only when the scene attributed nodes but didn't
      // record explicit edges (older data) — require BOTH endpoints
      // active so we don't bleed activation across the whole network
      // via any one attributed hub.
      return activeNodeIds.has(srcId) && activeNodeIds.has(tgtId);
    };
    const scopedOpacity = (l: NLink): number =>
      isEdgeActive(l) ? FOCUS_OPACITY_ACTIVE : FOCUS_OPACITY_DIM;
    // Use the same uniform width base (edgeWidthFor(0.85)) as WG / TGV
    // so dim edges keep a visible stroke and active edges read as
    // emphatic. Per-edge weight scaling pushed low-weight Network
    // edges sub-pixel at the dim multiplier, which made their
    // arrowhead markers (filled triangles, naturally chunkier than
    // a hair-thin line) appear to float without their connecting
    // line — the triangles-without-edges bug.
    const ACTIVE_WIDTH = edgeWidthFor(0.85);
    const scopedWidth = (l: NLink): number =>
      isEdgeActive(l) ? ACTIVE_WIDTH : ACTIVE_WIDTH * FOCUS_WIDTH_FACTOR_DIM;
    // Edges are polylines (source → midpoint → target) so each one can
    // drop an arrowhead at the midpoint via marker-mid — same primitive
    // the other three canvas graphs use to encode direction.
    const linkSel = g.select<SVGGElement>('g.n-links')
      .selectAll<SVGPolylineElement, NLink>('polyline')
      .data(simLinks, (d) => `${(d.source as NNode).id}-${(d.target as NNode).id}`);
    linkSel.exit().remove();
    linkSel.enter().append('polyline')
      .merge(linkSel)
      // Apply fill='none' AND vector-effect on the merged selection,
      // not just enter — otherwise polylines that persist across data
      // updates retain their previous (or default-black) fill and
      // render as solid triangles (3-point polyline with implicit
      // closure). Same pattern WG / KGV / TGV use.
      .attr('fill', 'none')
      .attr('vector-effect', 'non-scaling-stroke')
      // Theme-aware stroke via CSS variable — white on dark themes, dark ink
      // on light — so edges stay visible on a white canvas and recolour live.
      // The categorical force-blend colouring read as noise here; nodes carry
      // the category, edges just carry topology.
      .style('stroke', 'var(--graph-edge)')
      // Group `opacity` (not stroke-opacity) so the arrowhead fades with
      // its line — context-stroke inherits colour only, not opacity, so
      // a faded line would otherwise render with a fully-opaque marker
      // and read louder than the line itself. Same pattern WG / KGV /
      // TGV use. .style() (inline) so values can't be overridden by CSS.
      .style('opacity', (d) => scopedOpacity(d))
      .style('stroke-width', (d) => scopedWidth(d))
      .attr('marker-mid', 'url(#n-arrow)');

    // Edge labels (scene scope only) — render the relation token mid-line.
    // For scopes that hide labels, the data join below clears the layer.
    const edgeLabelData = showEdgeLabels
      ? simLinks.filter((l) => l.relations && l.relations.length > 0)
      : [];
    const edgeLabelSel = g.select<SVGGElement>('g.n-edge-labels')
      .selectAll<SVGTextElement, NLink>('text')
      .data(edgeLabelData, (d) => `${(d.source as NNode).id}-${(d.target as NNode).id}`);
    edgeLabelSel.exit().remove();
    edgeLabelSel.enter().append('text')
      .attr('text-anchor', 'middle')
      .attr('pointer-events', 'none')
      .merge(edgeLabelSel)
      .attr('font-size', '9px')
      .attr('fill', '#9CA3AF')
      .attr('opacity', 0.75)
      .text((d) => (d.relations ?? []).join(' · '));

    // Halos — soft glow around scene-active nodes, matching the
    // TGV / KGV pattern. Sized larger than the node radius so the
    // bloom sits *around* the circle; semi-transparent so adjacent
    // halos blend rather than stamp. Colour follows the same fill
    // policy as the node itself (heat ramp when Heat is on, force
    // colour otherwise).
    const haloNodes = simNodes.filter((d) => activeNodeIds.has(d.id));
    const haloSel = g.select<SVGGElement>('g.n-halos')
      .selectAll<SVGCircleElement, NNode>('circle')
      .data(haloNodes, (d) => d.id);
    haloSel.exit().remove();
    haloSel.enter().append('circle')
      .attr('pointer-events', 'none')
      .merge(haloSel)
      .attr('r', (d) => radiusOf(d) + 10)
      .attr('fill', (d) => (heatOn ? heatFillOf(d) : forceColorOf(d)))
      .attr('stroke', 'none')
      .style('opacity', 0.32);

    // Nodes
    const nodeSel = g.select<SVGGElement>('g.n-nodes')
      .selectAll<SVGCircleElement, NNode>('circle')
      .data(simNodes, (d) => d.id);
    nodeSel.exit().remove();
    // Recency-modulated opacity: in narrative scope a long-untouched entity
    // should read as faded so the eye can find what's *currently active*.
    // Node focus opacity: nodes attributed at the current step are
    // active; everything else dims. Same primitive as WG / KGV / TGV.
    // Replaces the previous recency-ramp baseline so the scene-by-scene
    // activation signal reads consistently across the four canvas
    // graphs.
    const opacityForNode = (d: NNode): number =>
      activeNodeIds.has(d.id) ? FOCUS_NODE_OPACITY_ACTIVE : FOCUS_NODE_OPACITY_DIM;
    // Glow filter dropped from the per-node attr — SVG Gaussian blur runs
    // every frame and was the dominant render cost on larger networks.
    // Nodes read fine from fill + stroke alone; reserve the filter for
    // explicit emphasis (e.g. on hover) if we want it back.
    const nodeAll = nodeSel.enter().append('circle')
      .merge(nodeSel)
      .attr('class', 'graph-node')
      .attr('r', (d) => radiusOf(d))
      .attr('fill', (d) => (heatOn ? heatFillOf(d) : forceColorOf(d)))
      .style('opacity', (d) => opacityForNode(d))
      .attr('stroke', 'transparent')
      .attr('stroke-width', 2);

    // Drag behaviour — same as system graph.
    const drag = d3.drag<SVGCircleElement, NNode>()
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
        const rect = svgRef.current!.getBoundingClientRect();
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top - 10, node: d });
        const neighbors = adjacency.get(d.id) ?? new Set();
        // Non-adjacent node dim on hover matches WG / KGV / TGV (0.18).
        g.select('g.n-nodes').selectAll<SVGCircleElement, NNode>('circle')
          .style('opacity', (o) => (o.id === d.id || neighbors.has(o.id) ? 1 : 0.18));
        const touchesHovered = (l: NLink) => {
          const sId = (l.source as NNode).id, tId = (l.target as NNode).id;
          return sId === d.id || tId === d.id;
        };
        // Group `opacity` (not stroke-opacity) so the arrowhead fades
        // with its line — context-stroke inherits colour only, not
        // opacity. ALSO modulate stroke-width on hover to match the
        // primitive WG / KGV / TGV use — incident edges thicken,
        // non-incident edges thin below the dim baseline.
        g.select('g.n-links').selectAll<SVGPolylineElement, NLink>('polyline')
          .style('opacity', (l) => touchesHovered(l) ? Math.max(0.5, FOCUS_OPACITY_ACTIVE + 0.15) : 0.03)
          .style('stroke-width', (l) => touchesHovered(l) ? ACTIVE_WIDTH : ACTIVE_WIDTH * FOCUS_WIDTH_FACTOR_DIM);
        // Labels use `.style('opacity', ...)` so the mouseleave restore
        // (also `.style`) overrides cleanly. The earlier `.attr` here
        // left the inline-style untouched, so labels stayed stuck.
        g.select('g.n-labels').selectAll<SVGTextElement, NNode>('text')
          .style('opacity', (o) => (o.id === d.id || neighbors.has(o.id) ? 1 : 0.15));
      })
      .on('mouseleave', () => {
        setTooltip(null);
        g.select('g.n-nodes').selectAll<SVGCircleElement, NNode>('circle')
          .style('opacity', (o) => opacityForNode(o));
        g.select('g.n-links').selectAll<SVGPolylineElement, NLink>('polyline')
          .style('opacity', (l) => scopedOpacity(l))
          .style('stroke-width', (l) => scopedWidth(l));
        g.select('g.n-labels').selectAll<SVGTextElement, NNode>('text')
          .style('opacity', (o) => labelOpacity(o));
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        if (d.kind === 'character') dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: d.id } });
        else if (d.kind === 'location') dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: d.id } });
        else if (d.kind === 'artifact') dispatch({ type: 'SET_INSPECTOR', context: { type: 'artifact', artifactId: d.id } });
        else if (d.kind === 'thread') dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: d.id } });
        else if (d.kind === 'system') dispatch({ type: 'SET_INSPECTOR', context: { type: 'knowledge', nodeId: d.id } });
      });

    // Labels — show every node, scale font and opacity by degree (system style).
    const labelSel = g.select<SVGGElement>('g.n-labels')
      .selectAll<SVGTextElement, NNode>('text')
      .data(simNodes, (d) => d.id);
    labelSel.exit().remove();
    const labelEnter = labelSel.enter().append('text').attr('text-anchor', 'middle');
    // Labels carry force colour so the eye can read each entity's
    // category at a glance (fate / world / system). Opacity already
    // dampens peripheral nodes via labelOpacity, so colour serves as a
    // category signal rather than a noise multiplier.
    labelEnter.merge(labelSel)
      .text((d) => truncate(d.label, 36))
      .attr('fill', (d) => forceColorOf(d))
      .attr('font-size', (d) => `${Math.max(9, 9 + (d.degree / maxDegree) * 4)}px`)
      .attr('font-weight', (d) => d.degree >= maxDegree * 0.5 ? '600' : '400')
      .attr('opacity', (d) => labelOpacity(d))
      .attr('display', showLabels ? null : 'none')
      .attr('pointer-events', 'none');

    sim.nodes(simNodes);
    sim.force<d3.ForceLink<NNode, NLink>>('link')!.links(simLinks);
    sim.alpha(SIM_ALPHA_START).alphaDecay(SIM_ALPHA_DECAY).restart();

    // Cache the tick-frequency selections OUTSIDE the tick callback so we
    // don't re-query the DOM at 60Hz. This is the dominant per-frame cost.
    const linkPolys = g.select<SVGGElement>('g.n-links').selectAll<SVGPolylineElement, NLink>('polyline');
    const edgeLabelTexts = g.select<SVGGElement>('g.n-edge-labels').selectAll<SVGTextElement, NLink>('text');
    const haloCircles = g.select<SVGGElement>('g.n-halos').selectAll<SVGCircleElement, NNode>('circle');
    const nodeCircles = g.select<SVGGElement>('g.n-nodes').selectAll<SVGCircleElement, NNode>('circle');
    const labelTexts = g.select<SVGGElement>('g.n-labels').selectAll<SVGTextElement, NNode>('text');

    sim.on('tick', () => {
      linkPolys
        .attr('points', (d) => {
          const sx = (d.source as NNode).x ?? 0;
          const sy = (d.source as NNode).y ?? 0;
          const tx = (d.target as NNode).x ?? 0;
          const ty = (d.target as NNode).y ?? 0;
          return `${sx},${sy} ${(sx + tx) / 2},${(sy + ty) / 2} ${tx},${ty}`;
        });
      if (showEdgeLabels) {
        edgeLabelTexts
          .attr('x', (d) => (((d.source as NNode).x ?? 0) + ((d.target as NNode).x ?? 0)) / 2)
          .attr('y', (d) => (((d.source as NNode).y ?? 0) + ((d.target as NNode).y ?? 0)) / 2 - 4);
      }
      haloCircles
        .attr('cx', (d) => d.x ?? 0)
        .attr('cy', (d) => d.y ?? 0);
      nodeCircles
        .attr('cx', (d) => d.x ?? 0)
        .attr('cy', (d) => d.y ?? 0);
      labelTexts
        .attr('x', (d) => d.x ?? 0)
        .attr('y', (d) => (d.y ?? 0) + radiusOf(d) + 12);
    });
  }, [network, dispatch, showEdgeLabels, heatOn, showPeriphery]);

  if (!narrative) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-text-dim text-sm italic">No world view loaded.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col absolute inset-0 z-20">
      {/* Top legend strip — color / label toggles, swatches, scope footer.
          Scene / Arc / Full scope lives in the canvas topbar (drives this
          view via graphViewMode), not here. */}
      <div className="shrink-0 flex items-center gap-0 px-2 h-7 border-b border-border glass-panel z-30 overflow-x-auto">
        <button
          onClick={() => setShowLabels((v) => !v)}
          className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${showLabels ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'}`}
        >
          Labels
        </button>
        <button
          onClick={() => setHeatOn((v) => !v)}
          title="Swap node fill between force colour (default) and attribution heat"
          className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${heatOn ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'}`}
        >
          Heat
        </button>
        <button
          onClick={() => setShowPeriphery((v) => !v)}
          title="Show the periphery — nodes with zero attributions in the current scope, drawn in as surrounding context around the touched subgraph"
          className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${showPeriphery ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'}`}
        >
          Periphery
        </button>

        <div className="w-px h-3 bg-border mx-1" />

        {/* Force halo legend — halo colour identifies which of the three
            forces a node belongs to. */}
        <ForceSwatch color={FORCE_FILL.thread} label={`Fate ${kindCounts.thread}`} />
        <ForceSwatch
          color={FORCE_FILL.character}
          label={`World ${kindCounts.character + kindCounts.location + kindCounts.artifact}`}
        />
        <ForceSwatch color={FORCE_FILL.system} label={`System ${kindCounts.system}`} />

        {/* Heat ramp legend — only meaningful when Heat is on; node
            fill defaults to force colour, so showing the gradient
            when nothing uses it would just confuse the reading. */}
        {heatOn && (
          <>
            <div className="w-px h-3 bg-border mx-1" />
            <HeatLegend />
          </>
        )}

        <div className="w-px h-3 bg-border mx-1" />

        <span className="text-[9px] text-text-dim/60 px-1">{scopeFooter(scope, network.graphCount, state.viewState.currentSceneIndex)}</span>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <svg ref={svgRef} className="block h-full w-full" />
        {network.graphCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center pointer-events-none">
            <p className="text-text-dim text-sm italic max-w-md">
              {scope === 'scene'
                ? "This scene didn't declare any attributions or edges yet."
                : scope === 'arc'
                  ? 'No scenes in the current arc carry attributions yet. Scrub forward or generate scenes for this arc.'
                  : 'No attributions yet on this timeline. Generate scenes or expansions and the network will grow as you scrub forward.'}
            </p>
          </div>
        )}
        {tooltip && (
          <div
            className="absolute z-40 pointer-events-none"
            style={{ left: tooltip.x, top: tooltip.y - 12, transform: 'translate(-50%, -100%)' }}
          >
            <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 shadow-xl max-w-sm">
              <div className="flex items-start gap-2 mb-1">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5"
                  style={{
                    background: heatFillOf(tooltip.node),
                    boxShadow: `0 0 0 1.5px ${forceColorOf(tooltip.node)}99, 0 0 6px ${forceColorOf(tooltip.node)}55`,
                  }}
                />
                <div>
                  <span className="text-xs font-semibold text-text-primary whitespace-normal wrap-break-word">{tooltip.node.label}</span>
                  <span className="text-[10px] text-text-dim capitalize ml-1">({tooltip.node.kind})</span>
                </div>
              </div>
              <div className="text-[10px] text-text-secondary">
                {tooltip.node.tier} · ×{tooltip.node.attributions} attribution{tooltip.node.attributions === 1 ? '' : 's'}
                {tooltip.node.tier === 'fresh' && tooltip.node.firstSeenIndex >= 0 && (
                  <> · seeded graph {tooltip.node.firstSeenIndex + 1}</>
                )}
              </div>
            </div>
            <div className="flex justify-center"><div className="w-2.5 h-2.5 bg-bg-elevated border-r border-b border-border rotate-45 -mt-1.5" /></div>
          </div>
        )}
      </div>
    </div>
  );
}

function labelOpacity(d: NNode): number {
  if (d.attributions === 0) return 0.35;
  return d.degree >= 2 ? 0.9 : 0.65;
}

/** Force swatch — label colour echoes the force-tinted node text in the
 *  graph so the legend reads as a direct echo of the rendering. */
function ForceSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="px-1.5 text-[9px] font-medium" style={{ color }}>
      {label}
    </span>
  );
}

/** Continuous heat ramp legend — same blue → green → red gradient
 *  Stage uses, since `heatColor` from graph-utils is the
 *  shared source of truth for node fills when Heat is on. */
function HeatLegend() {
  return (
    <span className="flex items-center gap-1.5 px-1">
      <span className="text-[8px] text-text-dim/50">cold</span>
      <span
        className="block h-1.5 w-12 rounded-full"
        style={{ background: 'linear-gradient(to right, #3B82F6, #22C55E, #EF4444)' }}
      />
      <span className="text-[8px] text-text-dim/50">hot</span>
    </span>
  );
}

function scopeFooter(scope: Scope, graphCount: number, currentIndex: number): string {
  const step = (n: number) => `${n} step${n === 1 ? '' : 's'}`;
  if (scope === 'narrative') return `${step(graphCount)} · cumulative to scene ${currentIndex + 1}`;
  if (scope === 'arc') return `${step(graphCount)} · current arc to scene ${currentIndex + 1}`;
  return `${step(graphCount)} · scene ${currentIndex + 1}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
