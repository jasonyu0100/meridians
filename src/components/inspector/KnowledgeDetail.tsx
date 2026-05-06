'use client';

import { useMemo, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { buildCumulativeSystemGraph } from '@/lib/narrative-utils';
import type { SystemNodeType } from '@/types/narrative';
import { CollapsibleSection } from './CollapsibleSection';

type AttributionEntry = {
  sceneId: string;
  sceneIndex: number;
  sceneTitle: string;
  /** Nodes co-active with this one in the same scene — both introductions
   *  and attributions count, since either is a form of usage. */
  coAttributed: string[];
  /** True when this scene is the one that *introduced* the node (the node
   *  appears in this scene's systemDeltas.addedNodes). The introduction
   *  scene is also counted as a usage but tagged distinctly so the timeline
   *  can mark it. */
  isIntroduction: boolean;
};

type CoActivation = {
  otherId: string;
  count: number;
  sceneIds: string[];
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
  // - Spark mode: jump to the nearest scene that mentions it, then zoom in
  // - Codex mode: just zoom in on the node
  const navigateToNode = useCallback((targetId: string) => {
    if (state.graphViewMode === 'spark') {
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
  const activations = useMemo(() => {
    const out: AttributionEntry[] = [];
    if (!narrative) return out;
    for (let i = 0; i <= state.viewState.currentSceneIndex && i < state.resolvedEntryKeys.length; i++) {
      const key = state.resolvedEntryKeys[i];
      const scene = narrative.scenes[key];
      if (!scene) continue;
      const addedIds = (scene.systemDeltas?.addedNodes ?? []).map((n) => n.id);
      const attrs = scene.systemAttributions ?? [];
      const isIntroduction = addedIds.includes(nodeId);
      const isAttributed = attrs.includes(nodeId);
      if (!isIntroduction && !isAttributed) continue;
      const all = new Set<string>([...addedIds, ...attrs]);
      all.delete(nodeId);
      const coAttributed = Array.from(all);
      const title =
        scene.summary?.slice(0, 60) ?? scene.events?.[0]?.slice(0, 60) ?? key;
      out.push({
        sceneId: key,
        sceneIndex: i,
        sceneTitle: title,
        coAttributed,
        isIntroduction,
      });
    }
    return out;
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex, nodeId]);

  // Co-activations: other nodes that have been attributed alongside this one,
  // ranked by frequency. Each entry tracks the scenes where the pair was
  // co-attributed — so the "Connect" button can attach a new edge to a real
  // scene rather than a synthetic one.
  const coActivations = useMemo(() => {
    const counts = new Map<string, CoActivation>();
    for (const a of activations) {
      for (const otherId of a.coAttributed) {
        if (!counts.has(otherId)) {
          counts.set(otherId, { otherId, count: 0, sceneIds: [] });
        }
        const entry = counts.get(otherId)!;
        entry.count += 1;
        entry.sceneIds.push(a.sceneId);
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
  }, [activations]);

  // Set of other nodes already linked to this one (either direction) — used
  // to filter "needs connection" suggestions in the Attributions section.
  const linkedNodeIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of graph.edges) {
      if (e.from === nodeId) s.add(e.to);
      else if (e.to === nodeId) s.add(e.from);
    }
    return s;
  }, [graph.edges, nodeId]);

  const connectCoActivation = useCallback(
    (otherId: string, sceneId: string) => {
      // Direction: this node → other (relation defaults to a neutral
      // "extends" since the user can refine in a future inline editor).
      dispatch({
        type: 'ADD_SYSTEM_EDGE',
        sceneId,
        edge: { from: nodeId, to: otherId, relation: 'extends' },
      });
    },
    [dispatch, nodeId],
  );

  // Scenes where this node was introduced
  const introScenes = useMemo(() => {
    const scenes: { sceneId: string; sceneTitle: string }[] = [];
    if (!narrative) return scenes;
    for (let i = 0; i <= state.viewState.currentSceneIndex && i < state.resolvedEntryKeys.length; i++) {
      const key = state.resolvedEntryKeys[i];
      const scene = narrative.scenes[key];
      const wb = narrative.worldBuilds?.[key];
      const wkm = scene?.systemDeltas ?? wb?.expansionManifest.systemDeltas;
      if (!wkm) continue;
      const added = wkm.addedNodes ?? [];
      if (added.some((n) => n.id === nodeId)) {
        const title = scene?.events?.[0]?.slice(0, 60) ?? wb?.summary?.slice(0, 60) ?? key;
        scenes.push({ sceneId: key, sceneTitle: title });
      }
    }
    return scenes;
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

      {/* Connections */}
      {grouped.length > 0 && (
        <CollapsibleSection title="Connections" count={connections.length} defaultOpen>
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
                  {state.graphViewMode === 'spark' && (() => {
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
          subsequent reference), plus co-activation suggestions. Total usage
          count is the usefulness signal; the introduction scene is marked
          to preserve the creation/reference distinction. */}
      {activations.length > 0 && (
        <CollapsibleSection title="Attributions" count={activations.length} defaultOpen>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1">
              {activations.map(({ sceneId, sceneIndex, sceneTitle, isIntroduction }) => (
                <button
                  key={sceneId}
                  type="button"
                  onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId } })}
                  title={isIntroduction ? `Introduced in: ${sceneTitle}` : sceneTitle}
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                    isIntroduction
                      ? 'bg-white/12 text-text-primary ring-1 ring-white/15'
                      : 'bg-white/5 text-text-secondary hover:bg-white/10 hover:text-text-primary'
                  }`}
                >
                  {isIntroduction && <span className="mr-0.5">+</span>}#{sceneIndex + 1}
                </button>
              ))}
            </div>
            {coActivations.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[10px] uppercase tracking-widest text-text-dim/70">
                  Co-activated
                </p>
                <ul className="flex flex-col gap-1">
                  {coActivations.map(({ otherId, count, sceneIds }) => {
                    const other = graph.nodes[otherId];
                    const isLinked = linkedNodeIds.has(otherId);
                    return (
                      <li key={otherId} className="flex items-center gap-2 group">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${other ? TYPE_COLORS[other.type] ?? 'bg-white/40' : 'bg-white/20'}`} />
                        <button
                          type="button"
                          onClick={() => navigateToNode(otherId)}
                          className="text-xs text-text-secondary hover:text-text-primary transition-colors flex-1 text-left truncate"
                        >
                          {other?.concept ?? otherId}
                        </button>
                        <span className="text-[10px] text-text-dim/60 font-mono tabular-nums shrink-0">
                          ×{count}
                        </span>
                        {!isLinked && (
                          <button
                            type="button"
                            onClick={() => connectCoActivation(otherId, sceneIds[sceneIds.length - 1])}
                            title="Create an edge between these co-activated nodes"
                            className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-white/10 text-text-dim opacity-0 group-hover:opacity-100 hover:bg-white/8 hover:text-text-secondary transition-all shrink-0"
                          >
                            + connect
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Introduced in */}
      {introScenes.length > 0 && (
        <CollapsibleSection title="Introduced in" count={introScenes.length}>
          <ul className="flex flex-col gap-1">
            {introScenes.map(({ sceneId, sceneTitle }) => (
              <li key={sceneId}>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId } })}
                  className="text-xs text-text-secondary hover:text-text-primary transition-colors"
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
