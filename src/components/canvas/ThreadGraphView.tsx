'use client';

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import * as d3 from 'd3';
import type { NarrativeState, Scene } from '@/types/narrative';
import { resolveEntry, NARRATOR_AGENT_ID } from '@/types/narrative';
import { resolveEntityName } from '@/lib/narrative-utils';
import {
  classifyThreadCategory,
  THREAD_CATEGORY_HEX,
  THREAD_CATEGORY_LABEL,
  THREAD_CATEGORY_DESCRIPTION,
  THREAD_CATEGORY_ORDER,
  type ThreadCategory,
} from '@/lib/thread-category';
import { replayThreadsAtIndex } from '@/lib/portfolio-analytics';
import { computeGroups } from './graph-utils';
import { IconChevronLeft, IconChevronRight, IconRefresh } from '@/components/icons';
import EvalBar from '@/components/timeline/EvalBar';
import { edgeWidthFor, SIM_ALPHA_START, SIM_ALPHA_DECAY, GRAPH_ZOOM_EXTENT, GRAPH_INITIAL_SCALE, FOCUS_OPACITY_ACTIVE, FOCUS_OPACITY_DIM, FOCUS_WIDTH_FACTOR_DIM, FOCUS_NODE_OPACITY_ACTIVE, FOCUS_NODE_OPACITY_DIM } from '@/lib/graph-styling';

// ── Types ───────────────────────────────────────────────────────────────────

type TNode = d3.SimulationNodeDatum & {
  id: string;
  description: string;
  category: ThreadCategory;
  activity: number; // delta count — drives size
  participantNames: string[];
  hasDeltaAtScene: boolean; // whether this thread has a delta at the current scene
};

type TLink = d3.SimulationLinkDatum<TNode> & {
  relation: 'dependent' | 'participant';
};

// ── Cluster detection (union-find by dependents + shared participants) ────

function buildLinks(narrative: NarrativeState, nodeIds: Set<string>): TLink[] {
  const links: TLink[] = [];
  const seen = new Set<string>();

  // Explicit dependents only
  for (const t of Object.values(narrative.threads)) {
    if (!nodeIds.has(t.id)) continue;
    for (const depId of t.dependents) {
      if (!nodeIds.has(depId)) continue;
      const key = [t.id, depId].sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ source: t.id, target: depId, relation: 'dependent' });
      }
    }
  }

  return links;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ThreadGraphView({
  narrative,
  resolvedKeys,
  currentIndex,
  mode,
  onSelectThread,
  hideControls,
  hideLegend,
}: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentIndex: number;
  // 'threads-arc' renders the same full-threads layout as 'threads-full'
  // but filters the visible set to threads with a delta anywhere in the
  // CURRENT ARC (scenes sharing currentScene.arcId, up to currentIndex).
  // Coordination highlighting / hasDeltaAtScene focus still keys off the
  // current scene — the arc scope is purely a visibility filter.
  mode: 'threads-scene' | 'threads-arc' | 'threads-full';
  onSelectThread: (threadId: string) => void;
  hideControls?: boolean;
  hideLegend?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<TNode, TLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesRef = useRef<TNode[]>([]);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [showLabels, setShowLabels] = useState(true);
  const [showRelations, setShowRelations] = useState(false);
  const [showTypes, setShowTypes] = useState(true);
  const [showEval, setShowEval] = useState(true);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; description: string; category: ThreadCategory; participants: string[]; activity: number } | null>(null);
  const [groups, setGroups] = useState<TNode[][]>([]);
  const [focusedGroup, setFocusedGroup] = useState<number | null>(null);

  // Market-derived category per thread, evaluated at the CURRENT scene index.
  // Without scene-scrubbing, a thread that closes at scene 8 would already read
  // as "resolved" when the user is viewing scene 1. Replay beliefs up to the
  // current position so categories track the reader's vantage point.
  const categories = useMemo(() => {
    const scrubbed = replayThreadsAtIndex(narrative, resolvedKeys, currentIndex);
    return Object.fromEntries(
      Object.entries(scrubbed).map(([id, t]) => {
        const lastTouched = t.stances?.[NARRATOR_AGENT_ID]?.lastTouchedScene;
        const touchedIdx = lastTouched ? resolvedKeys.indexOf(lastTouched) : -1;
        const scenesSinceTouch = touchedIdx < 0 ? Infinity : currentIndex - touchedIdx;
        return [id, classifyThreadCategory(t, { scenesSinceTouch })];
      }),
    ) as Record<string, ThreadCategory>;
  }, [narrative, resolvedKeys, currentIndex]);

  // ── Compute delta counts per thread and scene-specific deltas ──
  // `arcDeltaThreads` collects threads with deltas anywhere in the
  // current scene's arc (scenes sharing currentScene.arcId, up to
  // currentIndex). Used by `pulse-arc` mode to scope the visible set
  // to arc-relevant threads.
  const { deltaCounts, sceneDeltaThreads, arcDeltaThreads } = useMemo(() => {
    const counts = new Map<string, number>();
    const sceneDelts = new Set<string>();
    const arcDelts = new Set<string>();
    const currentKey = resolvedKeys[currentIndex];
    const currentScene = currentKey ? narrative.scenes[currentKey] : undefined;
    const currentArcId = currentScene?.arcId;

    for (let i = 0; i <= currentIndex && i < resolvedKeys.length; i++) {
      const key = resolvedKeys[i];
      const entry = resolveEntry(narrative, key);
      if (!entry) continue;
      const inCurrentArc = entry.kind === 'scene' && entry.arcId === currentArcId;
      if (entry.kind === 'scene') {
        for (const tm of entry.threadDeltas) {
          counts.set(tm.threadId, (counts.get(tm.threadId) ?? 0) + 1);
          if (i === currentIndex) sceneDelts.add(tm.threadId);
          if (inCurrentArc) arcDelts.add(tm.threadId);
        }
      } else if (entry.kind === 'world_build') {
        for (const t of entry.expansionManifest.newThreads) {
          counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
          if (i === currentIndex) sceneDelts.add(t.id);
        }
      }
    }
    return { deltaCounts: counts, sceneDeltaThreads: sceneDelts, arcDeltaThreads: arcDelts };
  }, [narrative, resolvedKeys, currentIndex]);

  // ── Build graph data ──
  const graphData = useMemo(() => {
    const allThreads = Object.values(narrative.threads);

    // Only show threads that have been introduced by the current scene index
    const visibleKeys = new Set(resolvedKeys.slice(0, currentIndex + 1));

    const visibleThreads = mode === 'threads-scene'
      ? allThreads.filter(t => sceneDeltaThreads.has(t.id))
      : mode === 'threads-arc'
        ? allThreads.filter(t => arcDeltaThreads.has(t.id))
        : allThreads.filter(t =>
            deltaCounts.has(t.id) || visibleKeys.has(t.openedAt)
          );

    const nodeIds = new Set(visibleThreads.map(t => t.id));

    const nodes: TNode[] = visibleThreads.map(t => {
      const category = categories[t.id] ?? 'dormant';
      const participantNames = t.participants.map(p => resolveEntityName(narrative, p.id));
      return {
        id: t.id,
        description: t.description,
        category,
        activity: deltaCounts.get(t.id) ?? 0,
        participantNames,
        hasDeltaAtScene: sceneDeltaThreads.has(t.id),
      };
    });

    const links = buildLinks(narrative, nodeIds);

    return { nodes, links };
  }, [narrative, resolvedKeys, currentIndex, mode, categories, deltaCounts, sceneDeltaThreads, arcDeltaThreads]);

  // ── Initial SVG setup (once) ──
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    // Arrowhead for dependent (parent → child) thread links. context-stroke
    // means the marker inherits the line's colour.
    svg.append('defs').append('marker')
      .attr('id', 'tg-arrow')
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

    // Layer groups. Halos sit between links and nodes so the bloom renders
    // behind the node circle but on top of any line passing through.
    g.append('g').attr('class', 't-links');
    g.append('g').attr('class', 't-halos');
    g.append('g').attr('class', 't-nodes');
    g.append('g').attr('class', 't-labels');
    g.append('g').attr('class', 't-relations');

    // Simulation
    const sim = d3.forceSimulation<TNode, TLink>()
      .force('link', d3.forceLink<TNode, TLink>([]).id((d) => d.id).distance(160))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(0, 0))
      .force('x', d3.forceX(0).strength(0.05))
      .force('y', d3.forceY(0).strength(0.05))
      .force('collide', d3.forceCollide<TNode>().radius(50));
    simRef.current = sim;

    return () => { sim.stop(); simRef.current = null; gRef.current = null; };
  }, []);

  // ── Data update ──
  useEffect(() => {
    const sim = simRef.current;
    const g = gRef.current;
    if (!sim || !g) return;

    // Size scales with the absolute number of thread deltas a thread has
    // accumulated. Linear growth (+3px per delta) keeps the visual signal
    // obvious as a thread gets busier — one delta matters, ten matters
    // ten times more. Capped at 60px so a runaway thread doesn't swamp
    // the rest of the layout.
    const nodeRadius = (d: TNode) => Math.min(60, 10 + d.activity * 3);

    // Preserve positions
    const prevPos = new Map(nodesRef.current.map(n => [n.id, { x: n.x, y: n.y }]));
    const simNodes: TNode[] = graphData.nodes.map(n => {
      const prev = prevPos.get(n.id);
      return { ...n, ...(prev ?? {}) };
    });
    nodesRef.current = simNodes;
    const nodeMap = new Map(simNodes.map(n => [n.id, n]));

    const simLinks: TLink[] = graphData.links
      .filter(l => {
        const sId = typeof l.source === 'string' ? l.source : (l.source as TNode).id;
        const tId = typeof l.target === 'string' ? l.target : (l.target as TNode).id;
        return nodeMap.has(sId) && nodeMap.has(tId);
      })
      .map(l => ({
        source: typeof l.source === 'string' ? l.source : (l.source as TNode).id,
        target: typeof l.target === 'string' ? l.target : (l.target as TNode).id,
        relation: l.relation,
      }));

    // Links — polylines (source → midpoint → target) so dependent links can
    // drop an arrowhead at the midpoint via marker-mid without breaking the
    // straight centre-to-centre geometry.
    const linkSel = g.select<SVGGElement>('g.t-links')
      .selectAll<SVGPolylineElement, TLink>('polyline')
      .data(simLinks, d => `${(d.source as TNode).id ?? d.source}-${(d.target as TNode).id ?? d.target}`);
    linkSel.exit().remove();
    const linkEnter = linkSel.enter().append('polyline')
      .attr('fill', 'none')
      .attr('vector-effect', 'non-scaling-stroke');
    const linkAll = linkEnter.merge(linkSel);
    // Edge intensity: opacity + width scale with relation kind. Dependent
    // links are structural (thread→thread convergence) and read prominent;
    // participant links are softer dotted lines connecting threads to their
    // entities.
    // Mirrors KnowledgeGraphView's activation focus: in the scene-
    // Focus opacity: in scene-focused mode ('threads'), edges touching a
    // thread that took a delta at the current scene read at
    // FOCUS_OPACITY_ACTIVE; everything else — including the case where
    // no thread took a delta at this scene — stays at FOCUS_OPACITY_DIM
    // so structure is visible without competing with the focal cluster.
    // Pulse mode (no scene focus) just uses the active opacity
    // uniformly. Width keeps the relation-based hierarchy so dependent
    // links read as structural and participant links as connective.
    linkAll
      .attr('stroke', '#ffffff')
      // .style() (inline) so the values can't be overridden by any cached
      // or future CSS rule on parent classes.
      // Thread edges encode COORDINATION — an edge between two threads
      // is only "active" when BOTH threads took a delta at the current
      // scene (they moved together). One-sided activity isn't
      // coordination, so the edge stays dim. This is the key semantic
      // difference from KGV/WG/Network, where a single endpoint in the
      // active set is enough to light the edge.
      //
      // Important: d.source / d.target are still STRINGS when this
      // style callback first runs — d3.forceLink only resolves them to
      // node references after `sim.force('link').links(simLinks)` is
      // applied below. Look up via nodeMap so the AND check actually
      // sees `hasDeltaAtScene` and doesn't silently return undefined.
      // 'threads-scene' renders only threads touched at the current scene,
      // so there's no dim baseline to draw against — everything reads
      // active. 'threads-arc' and 'threads-full' both render a broader
      // set where the current-scene focus needs to pop above the dim
      // baseline.
      .style('opacity', (d) => {
        if (mode === 'threads-scene') return FOCUS_OPACITY_ACTIVE;
        const srcId = typeof d.source === 'string' ? d.source : (d.source as TNode).id;
        const tgtId = typeof d.target === 'string' ? d.target : (d.target as TNode).id;
        const srcNode = nodeMap.get(srcId);
        const tgtNode = nodeMap.get(tgtId);
        const both = !!srcNode?.hasDeltaAtScene && !!tgtNode?.hasDeltaAtScene;
        return both ? FOCUS_OPACITY_ACTIVE : FOCUS_OPACITY_DIM;
      })
      .style('stroke-width', (d) => {
        const base = d.relation === 'dependent' ? edgeWidthFor(0.7) : edgeWidthFor(0.2);
        if (mode === 'threads-scene') return base;
        const srcId = typeof d.source === 'string' ? d.source : (d.source as TNode).id;
        const tgtId = typeof d.target === 'string' ? d.target : (d.target as TNode).id;
        const srcNode = nodeMap.get(srcId);
        const tgtNode = nodeMap.get(tgtId);
        const both = !!srcNode?.hasDeltaAtScene && !!tgtNode?.hasDeltaAtScene;
        return both ? base : base * FOCUS_WIDTH_FACTOR_DIM;
      })
      .attr('stroke-dasharray', d => d.relation === 'participant' ? '3,3' : 'none')
      .attr('marker-mid', d => d.relation === 'dependent' ? 'url(#tg-arrow)' : null);

    // Halos — soft colour bloom behind any thread that took a delta in the
    // current scene. Replaces the previous "dim the inactive ones" approach
    // so node colours read true and the active set pops via the halo
    // instead of via everyone else fading.
    const activeNodes = simNodes.filter(d => d.hasDeltaAtScene);
    const haloSel = g.select<SVGGElement>('g.t-halos')
      .selectAll<SVGCircleElement, TNode>('circle')
      .data(activeNodes, d => d.id);
    haloSel.exit().remove();
    const haloEnter = haloSel.enter().append('circle');
    const haloAll = haloEnter.merge(haloSel);
    haloAll
      .attr('r', d => nodeRadius(d) + 10)
      .attr('fill', d => showTypes ? THREAD_CATEGORY_HEX[d.category] : '#888')
      .attr('opacity', 0.32)
      .attr('pointer-events', 'none');

    // Nodes
    const nodeSel = g.select<SVGGElement>('g.t-nodes')
      .selectAll<SVGCircleElement, TNode>('circle')
      .data(simNodes, d => d.id);
    nodeSel.exit().remove();
    const nodeEnter = nodeSel.enter().append('circle').style('cursor', 'pointer');
    const nodeAll = nodeEnter.merge(nodeSel);
    nodeAll
      .attr('class', 'graph-node')
      .attr('r', nodeRadius)
      .attr('fill', d => showTypes ? THREAD_CATEGORY_HEX[d.category] : '#888')
      .attr('stroke', d => d.hasDeltaAtScene ? '#fff' : 'transparent')
      .attr('stroke-width', 2)
      // Node focus: in arc / full modes, threads that took a delta at this
      // scene are active; others dim. Scene mode (only scene-touched
      // threads visible) keeps everything at active opacity since the
      // visible set IS the active set. Same primitive WG / KGV / Network.
      .style('opacity', (d) => {
        if (mode === 'threads-scene') return FOCUS_NODE_OPACITY_ACTIVE;
        return d.hasDeltaAtScene ? FOCUS_NODE_OPACITY_ACTIVE : FOCUS_NODE_OPACITY_DIM;
      });

    // Drag
    const drag = d3.drag<SVGCircleElement, TNode>()
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
        if (!rect) return;
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top - 10, description: d.description, category: d.category, participants: d.participantNames, activity: d.activity });
      })
      .on('mouseleave', () => setTooltip(null))
      .on('click', (_event, d) => {
        _event.stopPropagation();
        onSelectThread(d.id);
      });

    // Labels
    const labelSel = g.select<SVGGElement>('g.t-labels')
      .selectAll<SVGTextElement, TNode>('text')
      .data(simNodes, d => d.id);
    labelSel.exit().remove();
    const labelEnter = labelSel.enter().append('text').attr('text-anchor', 'middle');
    const labelAll = labelEnter.merge(labelSel);
    labelAll
      .attr('fill', d => showTypes ? THREAD_CATEGORY_HEX[d.category] : '#ccc')
      .attr('font-size', d => `${Math.min(12, 9 + d.activity * 0.3)}px`)
      .attr('font-weight', d => d.activity >= 5 ? '600' : '400')
      .attr('display', showLabels ? 'block' : 'none')
      .attr('opacity', 1)
      .text(d => {
        const desc = d.description;
        return desc.length > 35 ? desc.slice(0, 33) + '…' : desc;
      });

    // Relation labels
    const relSel = g.select<SVGGElement>('g.t-relations')
      .selectAll<SVGTextElement, TLink>('text')
      .data(simLinks, d => `${(d.source as TNode).id ?? d.source}-${(d.target as TNode).id ?? d.target}-rel`);
    relSel.exit().remove();
    const relEnter = relSel.enter().append('text').attr('text-anchor', 'middle').attr('font-size', '8px');
    const relAll = relEnter.merge(relSel);
    relAll
      .attr('fill', '#ffffff25')
      .attr('display', showRelations ? 'block' : 'none')
      .text(d => d.relation === 'dependent' ? 'depends' : 'shared');

    // Update simulation
    sim.nodes(simNodes);
    (sim.force('link') as d3.ForceLink<TNode, TLink>).links(simLinks);
    (sim.force('collide') as d3.ForceCollide<TNode>).radius(d => nodeRadius(d) + 30);
    sim.on('tick', () => {
      linkAll
        .attr('points', d => {
          const sx = (d.source as TNode).x ?? 0;
          const sy = (d.source as TNode).y ?? 0;
          const tx = (d.target as TNode).x ?? 0;
          const ty = (d.target as TNode).y ?? 0;
          return `${sx},${sy} ${(sx + tx) / 2},${(sy + ty) / 2} ${tx},${ty}`;
        });
      nodeAll
        .attr('cx', d => d.x ?? 0)
        .attr('cy', d => d.y ?? 0);
      haloAll
        .attr('cx', d => d.x ?? 0)
        .attr('cy', d => d.y ?? 0);
      labelAll
        .attr('x', d => d.x ?? 0)
        .attr('y', d => d.y ?? 0)
        .attr('dy', d => -(nodeRadius(d) + 5));
      relAll
        .attr('x', d => ((d.source as TNode).x! + (d.target as TNode).x!) / 2)
        .attr('y', d => ((d.source as TNode).y! + (d.target as TNode).y!) / 2);
    });
    sim.alpha(SIM_ALPHA_START).alphaDecay(SIM_ALPHA_DECAY).restart();

    setGroups(computeGroups(simNodes, simLinks));
    setFocusedGroup(null);
  }, [graphData, mode, showLabels, showRelations, showTypes, onSelectThread]);

  // ── Zoom to focused group ──
  useEffect(() => {
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!svgEl || !zoom || focusedGroup === null || !groups[focusedGroup]) return;

    const group = groups[focusedGroup];
    const width = svgEl.clientWidth || 800;
    const height = svgEl.clientHeight || 600;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of group) {
      const x = n.x ?? 0, y = n.y ?? 0;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const padding = 80;
    const bw = maxX - minX + padding * 2;
    const bh = maxY - minY + padding * 2;
    const scale = Math.min(width / bw, height / bh, 2);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    d3.select(svgEl)
      .transition()
      .duration(500)
      .call(
        zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void,
        d3.zoomIdentity.translate(width / 2, height / 2).scale(scale).translate(-cx, -cy),
      );
  }, [focusedGroup, groups]);

  const navigateGroup = useCallback(
    (direction: 'next' | 'prev' | 'reset') => {
      if (groups.length === 0) return;
      if (direction === 'reset') {
        setFocusedGroup(null);
        const svgEl = svgRef.current;
        const zoom = zoomRef.current;
        if (svgEl && zoom) {
          const w = svgEl.clientWidth ?? 800, h = svgEl.clientHeight ?? 600;
          d3.select(svgEl).transition().duration(500).call(
            zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void,
            d3.zoomIdentity.translate(w / 2, h / 2).scale(GRAPH_INITIAL_SCALE),
          );
        }
        return;
      }
      setFocusedGroup(prev => {
        if (prev === null) return 0;
        if (direction === 'next') return (prev + 1) % groups.length;
        return (prev - 1 + groups.length) % groups.length;
      });
    },
    [groups],
  );

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
              {THREAD_CATEGORY_ORDER.map((cat) => (
                <span key={cat} className="flex items-center gap-1 px-1" title={THREAD_CATEGORY_DESCRIPTION[cat]}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: THREAD_CATEGORY_HEX[cat] }} />
                  <span className="text-[8px] text-text-dim/50">{THREAD_CATEGORY_LABEL[cat]}</span>
                </span>
              ))}
            </>
          )}
        </div>
      )}
      <div className={hideControls ? 'relative flex-1 overflow-hidden' : 'h-full w-full'}>
      <svg ref={svgRef} className="h-full w-full" style={{ background: 'transparent' }} />

      {/* Floating controls fallback */}
      {!hideControls && (
      <div className="absolute top-2 left-2 z-30 flex items-center gap-0">
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showLabels} onChange={() => setShowLabels(v => !v)} className="accent-accent-cta w-3 h-3" />
          Labels
        </label>
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showRelations} onChange={() => setShowRelations(v => !v)} className="accent-accent-cta w-3 h-3" />
          Relations
        </label>
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showTypes} onChange={() => setShowTypes(v => !v)} className="accent-accent-cta w-3 h-3" />
          Types
        </label>
        <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface text-[11px] leading-none text-text-dim hover:text-text-default cursor-pointer select-none">
          <input type="checkbox" checked={showEval} onChange={() => setShowEval(v => !v)} className="accent-accent-cta w-3 h-3" />
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
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5"
                style={{ background: THREAD_CATEGORY_HEX[tooltip.category], boxShadow: `0 0 6px ${THREAD_CATEGORY_HEX[tooltip.category]}80` }}
              />
              <div>
                <span className="text-xs font-semibold text-text-primary whitespace-normal wrap-break-word">{tooltip.description}</span>
                <span className="text-[10px] text-text-dim ml-1">({THREAD_CATEGORY_LABEL[tooltip.category]})</span>
              </div>
            </div>
            {tooltip.participants.length > 0 && (
              <div className="text-[10px] text-text-secondary mb-0.5">{tooltip.participants.join(', ')}</div>
            )}
            <div className="text-[10px] text-text-dim">{tooltip.activity} delta{tooltip.activity !== 1 ? 's' : ''}</div>
          </div>
          <div className="flex justify-center"><div className="w-2.5 h-2.5 bg-bg-elevated border-r border-b border-border rotate-45 -mt-1.5" /></div>
        </div>
      )}

      {/* Group navigation (bottom-left) */}
      <div className="absolute bottom-4 left-2 z-30 flex flex-col gap-1 items-start">
        {!hideLegend && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-bg-surface text-[10px] leading-none text-text-dim">
          {THREAD_CATEGORY_ORDER.map((cat) => (
            <span key={cat} className="flex items-center gap-1" title={THREAD_CATEGORY_DESCRIPTION[cat]}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: THREAD_CATEGORY_HEX[cat] }} />
              <span>{THREAD_CATEGORY_LABEL[cat]}</span>
            </span>
          ))}
        </div>
        )}
        {groups.length > 1 && (
        <div className="flex items-center gap-1 rounded bg-bg-surface text-[11px] leading-none">
          <button
            className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
            onClick={() => navigateGroup('prev')}
            title="Previous group"
          >
            <IconChevronLeft size={12} />
          </button>
          <span className="text-text-dim px-0.5 tabular-nums">
            {focusedGroup !== null
              ? `${focusedGroup + 1}/${groups.length} (${groups[focusedGroup].length})`
              : `${groups.length} groups`}
          </span>
          <button
            className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
            onClick={() => navigateGroup('next')}
            title="Next group"
          >
            <IconChevronRight size={12} />
          </button>
          {focusedGroup !== null && (
            <>
              <div className="w-px h-3.5 bg-border" />
              <button
                className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
                onClick={() => navigateGroup('reset')}
                title="Reset view"
              >
                <IconRefresh size={12} />
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
