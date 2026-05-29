'use client';

import { useMemo, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { buildCumulativeSystemGraph, scoreSystemNodes } from '@/lib/narrative-utils';
import type { SystemNodeType } from '@/types/narrative';
import { CollapsibleSection } from './CollapsibleSection';

type AttributionEntry = {
  sceneId: string;
  sceneIndex: number;
  sceneTitle: string;
  /** True when this scene is the one that *introduced* the node (the node
   *  appears in this scene's systemDeltas.addedNodes). The introduction
   *  scene is also counted as a usage but tagged distinctly so the timeline
   *  can mark it. */
  isIntroduction: boolean;
};

type Props = {
  nodeId: string;
};

const TYPE_COLORS: Record<SystemNodeType, string> = {
  principle: 'bg-amber-400',
  system: 'bg-sky-400',
  concept: 'bg-violet-400',
  tension: 'bg-rose-400',
  event: 'bg-orange-400',
  structure: 'bg-teal-400',
  environment: 'bg-emerald-400',
  convention: 'bg-indigo-400',
  constraint: 'bg-red-400',
};

const TYPE_TEXT: Record<SystemNodeType, string> = {
  principle: 'text-amber-400',
  system: 'text-sky-400',
  concept: 'text-violet-400',
  tension: 'text-rose-400',
  event: 'text-orange-400',
  structure: 'text-teal-400',
  environment: 'text-emerald-400',
  convention: 'text-indigo-400',
  constraint: 'text-red-400',
};

export default function KnowledgeDetail({ nodeId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const graph = useMemo(() => {
    if (!narrative) return { nodes: {}, edges: [] };
    return buildCumulativeSystemGraph(
      narrative.scenes,
      state.resolvedEntryKeys,
      state.viewState.currentSceneIndex,
      narrative.worldBuilds,
    );
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  const node = graph.nodes[nodeId];

  // Impact score components for this node — same formula the Knowledge
  // panel ranks by (degree + attributions + reach). Surfacing here turns
  // the score from a list-only sort key into a per-node legibility
  // signal: the reader sees both the connections AND how genuinely
  // load-bearing the concept is across the world.
  const impact = useMemo(() => {
    if (!narrative) return null;
    const ranked = scoreSystemNodes(
      narrative,
      state.resolvedEntryKeys,
      state.viewState.currentSceneIndex,
    );
    const entry = ranked.find((r) => r.node.id === nodeId);
    if (!entry) return null;
    const total = ranked.length;
    const rank = ranked.findIndex((r) => r.node.id === nodeId) + 1;
    return {
      degree: entry.degree,
      attributions: entry.attributions,
      reach: entry.reach,
      score: entry.score,
      rank,
      total,
    };
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex, nodeId]);

  // All edges involving this node
  const connections = useMemo(() => {
    return graph.edges
      .filter((e) => e.from === nodeId || e.to === nodeId)
      .map((e) => {
        const otherId = e.from === nodeId ? e.to : e.from;
        const other = graph.nodes[otherId];
        const direction = e.from === nodeId ? 'outgoing' : 'incoming';
        return { otherId, other, relation: e.relation, direction };
      });
  }, [graph, nodeId]);

  // Group connections by the other node
  const grouped = useMemo(() => {
    const map = new Map<string, { other: typeof connections[0]['other']; relations: { relation: string; direction: string }[] }>();
    for (const c of connections) {
      if (!map.has(c.otherId)) {
        map.set(c.otherId, { other: c.other, relations: [] });
      }
      map.get(c.otherId)!.relations.push({ relation: c.relation, direction: c.direction });
    }
    return Array.from(map.entries()).sort((a, b) => b[1].relations.length - a[1].relations.length);
  }, [connections]);

  // Build index: for each knowledge node, which scene indices mention it
  const nodeSceneIndex = useMemo(() => {
    const map = new Map<string, number[]>();
    if (!narrative) return map;
    for (let i = 0; i <= state.viewState.currentSceneIndex && i < state.resolvedEntryKeys.length; i++) {
      const key = state.resolvedEntryKeys[i];
      const scene = narrative.scenes[key];
      const wb = narrative.worldBuilds?.[key];
      const wkm = scene?.systemDeltas ?? wb?.expansionManifest.systemDeltas;
      if (!wkm) continue;
      const ids = new Set<string>();
      for (const n of wkm.addedNodes ?? []) ids.add(n.id);
      for (const e of wkm.addedEdges ?? []) { ids.add(e.from); ids.add(e.to); }
      for (const id of ids) {
        if (!map.has(id)) map.set(id, []);
        map.get(id)!.push(i);
      }
    }
    return map;
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  // Navigate to a knowledge node:
  // - system-scene: jump to the nearest scene that mentions it, then zoom in
  // - system-arc / system-full: just zoom in on the node
  const navigateToNode = useCallback((targetId: string) => {
    if (state.graphViewMode === 'system-scene') {
      // Find nearest scene that mentions this node
      const sceneIndices = nodeSceneIndex.get(targetId) ?? [];
      if (sceneIndices.length > 0) {
        const current = state.viewState.currentSceneIndex;
        let nearest = sceneIndices[0];
        let minDist = Math.abs(current - nearest);
        for (const idx of sceneIndices) {
          const dist = Math.abs(current - idx);
          if (dist < minDist) { nearest = idx; minDist = dist; }
        }
        dispatch({ type: 'SET_SCENE_INDEX', index: nearest });
      }
    }
    dispatch({ type: 'SET_INSPECTOR', context: { type: 'knowledge', nodeId: targetId } });
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('focus-knowledge-node', { detail: { nodeId: targetId } }));
    }, 150);
  }, [nodeSceneIndex, state.graphViewMode, state.viewState.currentSceneIndex, dispatch]);

  // Scenes that *use* this node — either by introducing it
  // (systemDeltas.addedNodes contains it) or by attributing it
  // (systemAttributions includes it). Both are forms of usage; the
  // introduction is tagged so the timeline can mark it.
  // Co-activated nodes pulled from the same scene's full system footprint
  // (added + attributed) so co-activation captures rules that surfaced
  // together regardless of whether they were freshly introduced.
  // Unified attribution timeline — every entry that uses this node, whether
  // it's a scene that referenced it (systemAttributions), a scene that
  // introduced it (systemDeltas.addedNodes), or a world-build commit that
  // introduced it. Introductions are tagged so the row can mark them.
  const activations = useMemo(() => {
    const out: AttributionEntry[] = [];
    if (!narrative) return out;
    for (let i = 0; i <= state.viewState.currentSceneIndex && i < state.resolvedEntryKeys.length; i++) {
      const key = state.resolvedEntryKeys[i];
      const scene = narrative.scenes[key];
      const wb = narrative.worldBuilds?.[key];
      const addedIds = scene
        ? (scene.systemDeltas?.addedNodes ?? []).map((n) => n.id)
        : (wb?.expansionManifest?.systemDeltas?.addedNodes ?? []).map((n) => n.id);
      const attrs = (scene?.attributions ?? []).filter((id: string) => id.startsWith('SYS-'));
      const isIntroduction = addedIds.includes(nodeId);
      const isAttributed = attrs.includes(nodeId);
      if (!isIntroduction && !isAttributed) continue;
      const title =
        scene?.summary?.slice(0, 60) ??
        wb?.summary?.slice(0, 60) ??
        scene?.events?.[0]?.slice(0, 60) ??
        key;
      out.push({
        sceneId: key,
        sceneIndex: i,
        sceneTitle: title,
        isIntroduction,
      });
    }
    return out;
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex, nodeId]);

  if (!narrative) return null;
  if (!node) return <p className="text-xs text-text-dim">Node not found</p>;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${TYPE_COLORS[node.type] ?? 'bg-white/40'}`} />
          <h2 className="text-sm font-semibold text-text-primary">{node.concept}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] uppercase tracking-widest ${TYPE_TEXT[node.type] ?? 'text-text-dim'}`}>
            {node.type}
          </span>
          <span className="text-[10px] text-text-dim font-mono">{nodeId}</span>
        </div>
      </div>

      {/* Impact metrics — degree + attributions + reach, the same three
          signals that drive the Knowledge panel's ranking. Surfacing the
          breakdown alongside the composite score keeps the formula
          auditable from the per-node view, not just the directory. */}
      {impact && (
        <div className="flex items-center gap-3 px-2.5 py-1.5 rounded border border-white/8 bg-white/3">
          <div className="flex flex-col leading-tight">
            <span className="text-[9px] uppercase tracking-wider text-text-dim/70">Impact</span>
            <span className="text-[13px] font-mono text-text-primary tabular-nums">{impact.score}</span>
          </div>
          <div className="w-px h-6 bg-white/8" aria-hidden />
          <div className="grid grid-cols-3 gap-x-3 flex-1 text-[10px] font-mono tabular-nums">
            <div className="flex flex-col">
              <span className="text-text-dim/60 text-[9px] uppercase tracking-wider">Links</span>
              <span className="text-text-secondary">{impact.degree}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-text-dim/60 text-[9px] uppercase tracking-wider">Cites</span>
              <span className="text-text-secondary">{impact.attributions}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-text-dim/60 text-[9px] uppercase tracking-wider">Arcs</span>
              <span className="text-text-secondary">{impact.reach}</span>
            </div>
          </div>
          <div className="text-[10px] text-text-dim/60 font-mono tabular-nums shrink-0">
            #{impact.rank}/{impact.total}
          </div>
        </div>
      )}

      {/* Connections */}
      {grouped.length > 0 && (
        <CollapsibleSection title="Connections" count={connections.length}>
          <ul className="flex flex-col gap-2">
            {grouped.map(([otherId, { other, relations }]) => (
              <li key={otherId} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => navigateToNode(otherId)}
                  className="flex items-center gap-2 group"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${other ? TYPE_COLORS[other.type] ?? 'bg-white/40' : 'bg-white/20'}`} />
                  <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
                    {other?.concept ?? otherId}
                  </span>
                  {other && (
                    <span className={`text-[9px] ${TYPE_TEXT[other.type] ?? 'text-text-dim'}`}>
                      {other.type}
                    </span>
                  )}
                  {state.graphViewMode === 'system-scene' && (() => {
                    const indices = nodeSceneIndex.get(otherId);
                    if (!indices || indices.length === 0) return null;
                    const current = state.viewState.currentSceneIndex;
                    const nearest = indices.reduce((a, b) => Math.abs(b - current) < Math.abs(a - current) ? b : a);
                    if (nearest === current) return null;
                    const delta = nearest - current;
                    return <span className="text-[8px] text-text-dim/40 ml-auto">{delta > 0 ? '+' : ''}{delta}</span>;
                  })()}
                </button>
                {relations.map((r, i) => (
                  <span key={i} className="text-[10px] text-text-dim ml-4 flex items-center gap-1">
                    <span className="text-text-dim/50">{r.direction === 'outgoing' ? '\u2192' : '\u2190'}</span>
                    {r.relation}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {connections.length === 0 && (
        <p className="text-xs text-text-dim">No connections yet</p>
      )}

      {/* Attributions — scenes that lean on this rule (introduction or
          subsequent reference). Total usage count is the usefulness signal;
          the introduction scene is marked to preserve the creation/
          reference distinction. */}
      {activations.length > 0 && (
        <CollapsibleSection title="Attributions" count={activations.length}>
          <ul className="flex flex-col gap-1">
            {activations.map(({ sceneId, sceneTitle, isIntroduction }) => (
              <li key={sceneId} className="flex items-start gap-1.5">
                {isIntroduction && (
                  <span
                    title="Introduced in this entry"
                    className="text-[9px] uppercase tracking-widest text-text-dim/70 px-1 py-0.5 rounded border border-white/10 shrink-0 mt-px"
                  >
                    intro
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId } })}
                  className="text-xs text-text-secondary hover:text-text-primary transition-colors text-left"
                >
                  {sceneTitle}
                </button>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}
    </div>
  );
}
