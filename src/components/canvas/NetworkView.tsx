'use client';

import { useRef, useEffect, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/store';
import { aggregateNetworkGraph, type HeatTier, type NetworkNode } from '@/lib/network-graph';
import { edgeOpacityFor, edgeWidthFor, SIM_ALPHA_START, SIM_ALPHA_DECAY } from '@/lib/graph-styling';
import type { AttributionEdgeRelation } from '@/types/narrative';

type NNode = d3.SimulationNodeDatum & NetworkNode & { degree: number };
type NLink = d3.SimulationLinkDatum<NNode> & { weight: number; relations?: AttributionEdgeRelation[] };

type Scope = 'scene' | 'arc' | 'narrative';

// Force palette — matches CubeCornerBadge / ForcesOverviewSlide.
const FORCE_FILL: Record<NetworkNode['kind'], string> = {
  thread: '#EF4444',     // Fate
  character: '#22C55E',  // World
  location: '#22C55E',   // World
  artifact: '#22C55E',   // World
  system: '#3B82F6',     // System
};

const HEAT_FILL: Record<HeatTier, string> = {
  hot: '#EF4444',
  warm: '#F59E0B',
  fresh: '#22D3EE',
  cold: '#52525B',
};

type ColorMode = 'force' | 'heat';

export default function NetworkView() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<NNode, NLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesRef = useRef<NNode[]>([]);
  const colorModeRef = useRef<ColorMode>('heat');

  const [colorMode, setColorMode] = useState<ColorMode>('heat');
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
      return aggregateNetworkGraph(narrative, [key], 0);
    }
    // arc scope — find current scene's arcId, filter keys to scenes in that arc.
    const currentKey = keys[idx];
    const currentScene = currentKey ? narrative.scenes[currentKey] : undefined;
    const arcId = currentScene?.arcId;
    if (!arcId) return aggregateNetworkGraph(narrative, [], -1);
    const arcKeys = keys.slice(0, idx + 1).filter((k) => {
      const s = narrative.scenes[k];
      return s && s.arcId === arcId;
    });
    return aggregateNetworkGraph(narrative, arcKeys, arcKeys.length - 1);
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex, scope]);

  // Edge labels are only meaningful in scene scope — at higher scopes, multiple
  // edges between the same pair collapse into one network edge whose `relations`
  // could carry contradictory relations across scenes. Hide them entirely there.
  const showEdgeLabels = scope === 'scene';

  const tierCounts = useMemo(() => {
    const counts: Record<HeatTier, number> = { hot: 0, warm: 0, cold: 0, fresh: 0 };
    for (const n of network.nodes) counts[n.tier] += 1;
    return counts;
  }, [network.nodes]);

  const kindCounts = useMemo(() => {
    const counts: Record<NetworkNode['kind'], number> = { character: 0, location: 0, artifact: 0, thread: 0, system: 0 };
    for (const n of network.nodes) counts[n.kind] += 1;
    return counts;
  }, [network.nodes]);

  const colorOf = (n: NetworkNode): string =>
    colorModeRef.current === 'heat' ? HEAT_FILL[n.tier] : FORCE_FILL[n.kind];

  // Initial setup
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const g = svg.append('g');
    gRef.current = g;

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);
    const width = svgEl.clientWidth ?? 800;
    const height = svgEl.clientHeight ?? 600;
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.9));

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

  // Recolor without resimulating when colorMode changes
  useEffect(() => {
    colorModeRef.current = colorMode;
    const g = gRef.current;
    if (!g) return;
    g.select('g.n-nodes').selectAll<SVGCircleElement, NNode>('circle')
      .attr('fill', (d) => colorOf(d));
    g.select('g.n-labels').selectAll<SVGTextElement, NNode>('text')
      .attr('fill', (d) => colorOf(d));

  }, [colorMode]);

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
    // every canvas graph view speaks the same visual language.
    const opacityFor = (weight: number) => edgeOpacityFor(weight / maxWeight);
    const widthFor = (weight: number) => edgeWidthFor(weight / maxWeight);
    const linkSel = g.select<SVGGElement>('g.n-links')
      .selectAll<SVGLineElement, NLink>('line')
      .data(simLinks, (d) => `${(d.source as NNode).id}-${(d.target as NNode).id}`);
    linkSel.exit().remove();
    linkSel.enter().append('line').merge(linkSel)
      .attr('stroke', '#ffffff')
      .attr('stroke-opacity', (d) => opacityFor(d.weight))
      .attr('stroke-width', (d) => widthFor(d.weight));

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
    // Glow filter dropped from the per-node attr — SVG Gaussian blur runs
    // every frame and was the dominant render cost on larger networks.
    // Nodes read fine from fill + stroke alone; reserve the filter for
    // explicit emphasis (e.g. on hover) if we want it back.
    const nodeAll = nodeSel.enter().append('circle')
      .style('cursor', 'pointer')
      .merge(nodeSel)
      .attr('r', (d) => radiusOf(d))
      .attr('fill', (d) => colorOf(d))
      .attr('opacity', (d) => d.attributions === 0 ? 0.4 : 0.9)
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
        g.select('g.n-links').selectAll<SVGLineElement, NLink>('line')
          .attr('stroke-opacity', (l) => {
            const sId = (l.source as NNode).id, tId = (l.target as NNode).id;
            const touches = sId === d.id || tId === d.id;
            // Touching the hovered node: lift toward full opacity scaled by
            // weight so dominant adjacent edges stay dominant. Non-touching:
            // collapse to a near-invisible field that lets the focal cluster
            // breathe.
            return touches ? Math.max(0.55, opacityFor(l.weight) + 0.2) : 0.04;
          });
        g.select('g.n-labels').selectAll<SVGTextElement, NNode>('text')
          .attr('opacity', (o) => (o.id === d.id || neighbors.has(o.id) ? 1 : 0.15));
      })
      .on('mouseleave', () => {
        setTooltip(null);
        g.select('g.n-nodes').selectAll<SVGCircleElement, NNode>('circle')
          .attr('opacity', (o) => o.attributions === 0 ? 0.4 : 0.9);
        g.select('g.n-links').selectAll<SVGLineElement, NLink>('line')
          .attr('stroke-opacity', (l) => opacityFor(l.weight));
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
    labelEnter.merge(labelSel)
      .text((d) => truncate(d.label, 36))
      .attr('fill', (d) => colorOf(d))
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
    const linkLines = g.select<SVGGElement>('g.n-links').selectAll<SVGLineElement, NLink>('line');
    const edgeLabelTexts = g.select<SVGGElement>('g.n-edge-labels').selectAll<SVGTextElement, NLink>('text');
    const nodeCircles = g.select<SVGGElement>('g.n-nodes').selectAll<SVGCircleElement, NNode>('circle');
    const labelTexts = g.select<SVGGElement>('g.n-labels').selectAll<SVGTextElement, NNode>('text');

    sim.on('tick', () => {
      linkLines
        .attr('x1', (d) => (d.source as NNode).x ?? 0)
        .attr('y1', (d) => (d.source as NNode).y ?? 0)
        .attr('x2', (d) => (d.target as NNode).x ?? 0)
        .attr('y2', (d) => (d.target as NNode).y ?? 0);
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
        <p className="text-text-dim text-sm italic">No narrative loaded.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col absolute inset-0 z-20">
      {/* Top legend strip — scope tabs on the left, then color / label toggles, swatches, scope footer */}
      <div className="shrink-0 flex items-center gap-0 px-2 h-7 border-b border-border glass-panel z-30 overflow-x-auto">
        <ScopeTab active={scope === 'scene'} onClick={() => setScope('scene')} label="Scene" />
        <ScopeTab active={scope === 'arc'} onClick={() => setScope('arc')} label="Arc" />
        <ScopeTab active={scope === 'narrative'} onClick={() => setScope('narrative')} label="Narrative" />

        <div className="w-px h-3 bg-border mx-1" />

        <button
          onClick={() => setColorMode('heat')}
          className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${colorMode === 'heat' ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'}`}
        >
          Heat
        </button>
        <button
          onClick={() => setColorMode('force')}
          className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${colorMode === 'force' ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'}`}
        >
          Force
        </button>
        <button
          onClick={() => setShowLabels((v) => !v)}
          className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${showLabels ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'}`}
        >
          Labels
        </button>

        <div className="w-px h-3 bg-border mx-1" />

        {colorMode === 'force' ? (
          <>
            <Swatch color={FORCE_FILL.thread} label={`Fate ${kindCounts.thread}`} />
            <Swatch color={FORCE_FILL.character} label={`World ${kindCounts.character + kindCounts.location + kindCounts.artifact}`} />
            <Swatch color={FORCE_FILL.system} label={`System ${kindCounts.system}`} />
          </>
        ) : (
          <>
            <Swatch color={HEAT_FILL.hot} label={`Hot ${tierCounts.hot}`} />
            <Swatch color={HEAT_FILL.warm} label={`Warm ${tierCounts.warm}`} />
            <Swatch color={HEAT_FILL.fresh} label={`Fresh ${tierCounts.fresh}`} />
            <Swatch color={HEAT_FILL.cold} label={`Cold ${tierCounts.cold}`} />
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
                    background: colorOf(tooltip.node),
                    boxShadow: `0 0 6px ${colorOf(tooltip.node)}80`,
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

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 px-1">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-[8px] text-text-dim/60">{label}</span>
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
