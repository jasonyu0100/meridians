'use client';

import { useRef, useEffect, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/store';
import { aggregateNetworkGraph, type HeatTier, type NetworkNode } from '@/lib/network-graph';
import { edgeOpacityFor, edgeWidthFor, SIM_ALPHA_START, SIM_ALPHA_DECAY, GRAPH_ZOOM_EXTENT, GRAPH_INITIAL_SCALE } from '@/lib/graph-styling';
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

// Fresh accent — distinct cyan for very-recently-introduced nodes so the
// "just seeded" signal stays legible against the warm heat ramp.
const FRESH_FILL = '#22D3EE';

// Continuous heat interpolator — cold slate sweeps through ember and
// amber into a vivid orange-red at the top. Wider chromatic range so heat
// reads dynamically across the network without losing the gradient feel.
// Force identity is conveyed by the halo / label colour instead, removing
// the need for a heat-vs-force toggle.
const HEAT_RAMP = d3.interpolateRgbBasis([
  '#3F3F46', // cold slate
  '#7C5A28', // ember undertow
  '#C77B1A', // burnt amber
  '#F59E0B', // vivid amber
  '#F97316', // hot orange
  '#EF4444', // searing red
]);

// Mid-blend two hex colours in RGB space. Used to colour cross-force edges
// so a fate↔world link reads as a gradient between the two forces.
function blendHex(a: string, b: string, t = 0.5): string {
  return d3.interpolateRgb(a, b)(t);
}

export default function NetworkView() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<NNode, NLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesRef = useRef<NNode[]>([]);

  const [showLabels, setShowLabels] = useState(true);
  const [scope, setScope] = useState<Scope>('narrative');
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

  // Two visual channels, no toggle:
  //   - HEAT (continuous, drives node fill) = attribution intensity
  //   - FORCE (categorical, drives halo + label) = which of the three forces
  // maxAttribution is recomputed every data refresh; this ref keeps the
  // helper callable from any callback without a re-render.
  const heatCacheRef = useRef({ maxAttribution: 1 });
  const heatFillOf = (n: NetworkNode): string => {
    if (n.tier === 'fresh') return FRESH_FILL;
    const t = heatCacheRef.current.maxAttribution > 0
      ? Math.min(1, n.attributions / heatCacheRef.current.maxAttribution)
      : 0;
    // Floor non-zero attribution at 0.15 along the ramp so a single
    // attribution still registers as warm rather than slate.
    return HEAT_RAMP(n.attributions > 0 ? 0.15 + t * 0.85 : 0);
  };
  const forceColorOf = (n: NetworkNode): string => FORCE_FILL[n.kind];

  // Initial setup
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    // Arrowhead marker placed at the polyline midpoint via marker-mid.
    // Matches the pattern used in WorldGraph / KnowledgeGraphView /
    // ThreadGraphView so every canvas graph encodes edge direction the
    // same way. context-stroke makes the head inherit each line's
    // stroke colour, including the blended force-field hues here.
    svg.append('defs').append('marker')
      .attr('id', 'n-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 9)
      .attr('refY', 0)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
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

    // Degree from network edges (used for label sizing/opacity, matching system).
    const degreeMap = new Map<string, number>();
    for (const e of network.edges) {
      degreeMap.set(e.from, (degreeMap.get(e.from) ?? 0) + 1);
      degreeMap.set(e.to, (degreeMap.get(e.to) ?? 0) + 1);
    }
    const maxDegree = Math.max(...network.nodes.map((n) => degreeMap.get(n.id) ?? 0), 1);
    const maxAttribution = Math.max(...network.nodes.map((n) => n.attributions), 1);
    heatCacheRef.current.maxAttribution = maxAttribution;

    // Node radius — combine attribution AND degree so unreferenced nodes still
    // show as legible dots and load-bearing ones grow large like in system graph.
    const radiusOf = (d: NNode) => {
      const attrTerm = (d.attributions / maxAttribution) * 22;
      const degTerm = (d.degree / maxDegree) * 6;
      return 8 + attrTerm + degTerm;
    };

    const prevPos = new Map(nodesRef.current.map((n) => [n.id, { x: n.x, y: n.y, fx: n.fx, fy: n.fy }]));
    const simNodes: NNode[] = network.nodes.map((n) => {
      const prev = prevPos.get(n.id);
      return {
        ...n,
        degree: degreeMap.get(n.id) ?? 0,
        ...(prev ?? {}),
      };
    });
    nodesRef.current = simNodes;
    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: NLink[] = network.edges
      .filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map((e) => ({
        source: nodeMap.get(e.from)!,
        target: nodeMap.get(e.to)!,
        weight: e.weight,
        relations: e.relations,
      }));

    const maxWeight = Math.max(...simLinks.map((l) => l.weight), 1);

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

    // Links — opacity AND width scale with edge weight via shared helper so
    // every canvas graph view speaks the same visual language. Stroke colour
    // is the mid-blend of the endpoints' force colours, which makes
    // cross-force edges (fate↔world, world↔system, fate↔system) read as
    // bridges between the three force fields rather than as anonymous white
    // lines. Same-force edges show as a tinted version of their force.
    const opacityFor = (weight: number) => edgeOpacityFor(weight / maxWeight);
    const widthFor = (weight: number) => edgeWidthFor(weight / maxWeight);
    const linkColour = (d: NLink) => {
      const a = (d.source as NNode).kind;
      const b = (d.target as NNode).kind;
      const colA = FORCE_FILL[a];
      const colB = FORCE_FILL[b];
      return colA === colB ? colA : blendHex(colA, colB, 0.5);
    };
    // Edges are polylines (source → midpoint → target) so each one can
    // drop an arrowhead at the midpoint via marker-mid — same primitive
    // the other three canvas graphs use to encode direction.
    const linkSel = g.select<SVGGElement>('g.n-links')
      .selectAll<SVGPolylineElement, NLink>('polyline')
      .data(simLinks, (d) => `${(d.source as NNode).id}-${(d.target as NNode).id}`);
    linkSel.exit().remove();
    linkSel.enter().append('polyline')
      .attr('fill', 'none')
      .attr('vector-effect', 'non-scaling-stroke')
      .merge(linkSel)
      .attr('stroke', (d) => linkColour(d))
      // .style() (inline) so the values can't be overridden by any cached
      // or future CSS rule on parent classes.
      .style('stroke-opacity', (d) => opacityFor(d.weight))
      .style('stroke-width', (d) => widthFor(d.weight))
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

    // Nodes
    const nodeSel = g.select<SVGGElement>('g.n-nodes')
      .selectAll<SVGCircleElement, NNode>('circle')
      .data(simNodes, (d) => d.id);
    nodeSel.exit().remove();
    // Recency-modulated opacity: in narrative scope a long-untouched entity
    // should read as faded so the eye can find what's *currently active*.
    // In scoped views (scene / arc) recency over the scope window is too
    // narrow to be meaningful, so we keep the simpler attribution gate there.
    const totalSteps = Math.max(network.graphCount, 1);
    const opacityForNode = (d: NNode) => {
      if (d.attributions === 0) return 0.32;
      if (scope !== 'narrative') return 0.9;
      const lastSeen = d.lastSeenIndex >= 0 ? d.lastSeenIndex : 0;
      const recency = lastSeen / Math.max(totalSteps - 1, 1); // 0..1
      // Floor at 0.45 so stale-but-real nodes still register; ceiling at 0.95.
      return 0.45 + recency * 0.5;
    };
    // Glow filter dropped from the per-node attr — SVG Gaussian blur runs
    // every frame and was the dominant render cost on larger networks.
    // Nodes read fine from fill + stroke alone; reserve the filter for
    // explicit emphasis (e.g. on hover) if we want it back.
    const nodeAll = nodeSel.enter().append('circle')
      .merge(nodeSel)
      .attr('class', 'graph-node')
      .attr('r', (d) => radiusOf(d))
      .attr('fill', (d) => heatFillOf(d))
      .attr('opacity', (d) => opacityForNode(d))
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
        g.select('g.n-nodes').selectAll<SVGCircleElement, NNode>('circle')
          .attr('opacity', (o) => (o.id === d.id || neighbors.has(o.id) ? 1 : 0.12));
        g.select('g.n-links').selectAll<SVGPolylineElement, NLink>('polyline')
          .style('stroke-opacity', (l) => {
            const sId = (l.source as NNode).id, tId = (l.target as NNode).id;
            const touches = sId === d.id || tId === d.id;
            // Touching the hovered node: lift toward full opacity scaled by
            // weight so dominant adjacent edges stay dominant. Non-touching:
            // collapse to a near-invisible field that lets the focal cluster
            // breathe.
            return touches ? Math.max(0.35, opacityFor(l.weight) + 0.15) : 0.03;
          });
        g.select('g.n-labels').selectAll<SVGTextElement, NNode>('text')
          .attr('opacity', (o) => (o.id === d.id || neighbors.has(o.id) ? 1 : 0.15));
      })
      .on('mouseleave', () => {
        setTooltip(null);
        g.select('g.n-nodes').selectAll<SVGCircleElement, NNode>('circle')
          .attr('opacity', (o) => opacityForNode(o));
        g.select('g.n-links').selectAll<SVGPolylineElement, NLink>('polyline')
          .style('stroke-opacity', (l) => opacityFor(l.weight));
        g.select('g.n-labels').selectAll<SVGTextElement, NNode>('text')
          .attr('opacity', (o) => labelOpacity(o));
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
      nodeCircles
        .attr('cx', (d) => d.x ?? 0)
        .attr('cy', (d) => d.y ?? 0);
      labelTexts
        .attr('x', (d) => d.x ?? 0)
        .attr('y', (d) => (d.y ?? 0) + radiusOf(d) + 12);
    });
  }, [network, dispatch, showEdgeLabels]);

  if (!narrative) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-text-dim text-sm italic">No world view loaded.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col absolute inset-0 z-20">
      {/* Top legend strip — scope tabs on the left, then color / label toggles, swatches, scope footer */}
      <div className="shrink-0 flex items-center gap-0 px-2 h-7 border-b border-border glass-panel z-30 overflow-x-auto">
        <ScopeTab active={scope === 'scene'} onClick={() => setScope('scene')} label="Scene" />
        <ScopeTab active={scope === 'arc'} onClick={() => setScope('arc')} label="Arc" />
        <ScopeTab active={scope === 'narrative'} onClick={() => setScope('narrative')} label="World View" />

        <div className="w-px h-3 bg-border mx-1" />

        <button
          onClick={() => setShowLabels((v) => !v)}
          className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${showLabels ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'}`}
        >
          Labels
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

        <div className="w-px h-3 bg-border mx-1" />

        {/* Heat ramp legend — node fill encodes attribution intensity. */}
        <HeatLegend />

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

/** Continuous heat ramp legend — a small gradient bar with the
 *  cold→hot anchors labelled so the operator can decode node fills. */
function HeatLegend() {
  return (
    <span className="flex items-center gap-1.5 px-1">
      <span className="text-[8px] text-text-dim/50">cold</span>
      <span
        className="block h-1.5 w-12 rounded-full"
        style={{
          background:
            'linear-gradient(to right, #3F3F46 0%, #7C5A28 20%, #C77B1A 40%, #F59E0B 60%, #F97316 80%, #EF4444 100%)',
        }}
      />
      <span className="text-[8px] text-text-dim/50">hot</span>
    </span>
  );
}

function ScopeTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] font-medium px-2 py-1 rounded transition-colors select-none ${active ? 'text-text-primary' : 'text-text-dim/50 hover:text-text-dim'}`}
    >
      {label}
    </button>
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
