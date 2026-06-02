'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { computeForceSnapshots, computeActivityCurve, classifyCurrentPosition, getEffectivePovId } from '@/lib/narrative-utils';
import type { Scene } from '@/types/narrative';
import { InlineText } from './InlineEdit';

const POSITION_COLORS: Record<string, string> = {
  peak:    '#F59E0B',
  trough:  '#3B82F6',
  rising:  '#22C55E',
  falling: '#EF4444',
  stable:  'var(--color-text-secondary)',
};

// Per-logType colour for the transition badges — matches ThreadDetail. `pulse`
// uses a theme-neutral grey (not white) so it stays visible in light mode.
const LOG_TYPE_HEX: Record<string, string> = {
  pulse: '#9ca3af', transition: '#fbbf24', setup: '#fbbf24', escalation: '#fb923c',
  payoff: '#34d399', twist: '#a78bfa', callback: '#38bdf8', resistance: '#ef4444', stall: '#f87171',
};

type Props = {
  arcId: string;
};

export default function ArcDetail({ arcId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const arc = narrative.arcs[arcId];
  if (!arc) return null;

  const arcScenes = useMemo(() => {
    const resolvedSet = new Set(state.resolvedEntryKeys);
    return arc.sceneIds
      .filter((sid) => resolvedSet.has(sid))
      .map((sid) => narrative.scenes[sid])
      .filter(Boolean);
  }, [arc, narrative, state.resolvedEntryKeys]);

  const activity = useMemo(() => {
    const allScenes = state.resolvedEntryKeys
      .map((k) => narrative.scenes[k])
      .filter((s): s is Scene => !!s);
    if (allScenes.length === 0) return null;
    const forceMap = computeForceSnapshots(allScenes);
    const ordered = allScenes.map((s) => forceMap[s.id]).filter(Boolean);
    const pts = computeActivityCurve(ordered);
    if (pts.length < 2) return null;
    const arcSceneIds = new Set(arc.sceneIds);
    const arcStart = allScenes.findIndex((s) => arcSceneIds.has(s.id));
    const position = classifyCurrentPosition(pts);
    return { pts, arcStart, position };
  }, [narrative, state.resolvedEntryKeys, arc.sceneIds]);

  return (
    <div className="flex flex-col gap-4">
      {/* Arc header */}
      <div>
        <div className="flex items-baseline gap-2">
          <h2 className="text-[10px] uppercase tracking-widest text-text-dim">Arc</h2>
          <span className="font-mono text-[10px] text-text-dim">{arcId}</span>
        </div>
        <InlineText
          value={arc.name}
          onSave={(name) => dispatch({ type: 'UPDATE_ARC', arcId: arc.id, patch: { name } })}
          className="text-sm text-text-primary font-medium mt-0.5"
          inputClassName="text-sm font-medium"
        />
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-[10px] text-text-dim uppercase tracking-wider">
        <span>{arcScenes.length} scenes</span>
        <span>{arc.activeCharacterIds.length} characters</span>
        <span>{arc.locationIds.length} locations</span>
      </div>

      {/* Direction vector — forward-looking narrative intent (editable) */}
      <div className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Direction</h3>
        <InlineText
          value={arc.directionVector ?? ''}
          onSave={(directionVector) => dispatch({ type: 'UPDATE_ARC', arcId: arc.id, patch: { directionVector } })}
          multiline
          placeholder="Click to set the arc's forward-looking direction."
          className="text-xs text-text-secondary leading-relaxed italic"
          inputClassName="text-xs leading-relaxed"
        />
      </div>

      {/* World state — backward-looking board position as of end of arc (editable) */}
      <div className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">World State</h3>
        <InlineText
          value={arc.worldState ?? ''}
          onSave={(worldState) => dispatch({ type: 'UPDATE_ARC', arcId: arc.id, patch: { worldState } })}
          multiline
          placeholder="Click to set the board position at the end of this arc."
          className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap rounded bg-white/3 p-2 font-mono block"
          inputClassName="text-xs leading-relaxed font-mono"
        />
      </div>

      {/* Activity chart */}
      {activity && (() => {
        const { pts, arcStart, position } = activity;
        const n = pts.length;
        const W = 260, H = 48;
        const smoothed = pts.map((p) => p.smoothed);
        const min = Math.min(...smoothed);
        const max = Math.max(...smoothed);
        const range = max - min || 1;
        const toY = (v: number) => H - ((v - min) / range) * (H - 4) - 2;
        const allPts = smoothed.map((v, i) => `${(i / (n - 1)) * W},${toY(v)}`).join(' ');
        const arcX1 = arcStart >= 0 ? (arcStart / (n - 1)) * W : W;
        const arcPts = arcStart >= 0
          ? smoothed.slice(arcStart).map((v, i) => `${((arcStart + i) / (n - 1)) * W},${toY(v)}`).join(' ')
          : '';
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-widest text-text-dim">Activity</span>
              {position && (
                <span className="text-[9px] font-medium" style={{ color: POSITION_COLORS[position.key] ?? 'var(--color-text-secondary)' }}>
                  {position.name}
                </span>
              )}
            </div>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="rounded bg-text-dim/5 text-text-dim">
              <rect x={arcX1} y={0} width={W - arcX1} height={H} fill="rgba(245,158,11,0.06)" />
              <polyline points={allPts} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth="1" strokeLinejoin="round" />
              {arcPts && <polyline points={arcPts} fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
              {pts.map((p, i) => {
                if (!p.isPeak && !p.isValley) return null;
                const cx = (i / (n - 1)) * W;
                const cy = toY(p.smoothed);
                return p.isPeak
                  ? <polygon key={i} points={`${cx},${cy - 6} ${cx - 3.5},${cy} ${cx + 3.5},${cy}`} fill="#F59E0B" opacity="0.8" />
                  : <polygon key={i} points={`${cx},${cy + 6} ${cx - 3.5},${cy} ${cx + 3.5},${cy}`} fill="#3B82F6" opacity="0.8" />;
              })}
            </svg>
          </div>
        );
      })()}

      {/* Threads developed */}
      {arc.develops.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Develops
          </h3>
          <div className="flex flex-col gap-1">
            {arc.develops.map((threadId) => {
              const thread = narrative.threads[threadId];
              const transitions = arcScenes.flatMap((s) =>
                s.kind === 'scene' ? s.threadDeltas.filter((tm) => tm.threadId === threadId) : []
              );
              return (
                <button
                  key={threadId}
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: 'SET_INSPECTOR',
                      context: { type: 'thread', threadId },
                    })
                  }
                  className="flex flex-col gap-1 rounded bg-white/3 px-2 py-1.5 text-left transition-colors hover:bg-white/7 group"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-text-dim shrink-0">{threadId}</span>
                    <span className="text-[10px] text-text-secondary group-hover:text-text-primary transition-colors leading-relaxed">
                      {thread?.description ?? threadId}
                    </span>
                  </div>
                  {transitions.length > 0 && (
                    <div className="flex flex-col gap-1 pl-9">
                      {transitions.map((tm, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-1">
                          <span
                            className="text-[8px] uppercase tracking-wider font-semibold px-1 py-0.5 rounded"
                            style={{ color: LOG_TYPE_HEX[tm.logType] ?? '#888', backgroundColor: `${LOG_TYPE_HEX[tm.logType] ?? '#888'}1a` }}
                          >
                            {tm.logType}
                          </span>
                          {(tm.updates ?? []).map((u, j) => {
                            const pos = u.evidence > 0, neg = u.evidence < 0;
                            return (
                              <span
                                key={j}
                                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${pos ? 'bg-emerald-500/12 text-emerald-300' : neg ? 'bg-red-500/12 text-red-300' : 'bg-white/6 text-text-dim'}`}
                              >
                                <span className="truncate max-w-35">{u.outcome}</span>
                                <span className="font-mono tabular-nums shrink-0">{u.evidence >= 0 ? '+' : ''}{u.evidence}</span>
                              </span>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Characters */}
      {arc.activeCharacterIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Characters
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {arc.activeCharacterIds.map((cid) => {
              const char = narrative.characters[cid];
              if (!char) return null;
              return (
                <button
                  key={cid}
                  type="button"
                  onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: cid } })}
                  className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                >
                  {char.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Scene summaries */}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
          Scene Summaries
        </h3>
        <div className="flex flex-col gap-2">
          {arcScenes.map((scene, i) => {
            const sceneIdx = state.resolvedEntryKeys.indexOf(scene.id);
            const loc = scene.kind === 'scene' ? narrative.locations[scene.locationId] : null;
            const povId = scene.kind === 'scene' ? getEffectivePovId(scene) : null;
            const pov = povId ? narrative.characters[povId] : null;
            return (
              <button
                key={scene.id}
                type="button"
                onClick={() => {
                  if (sceneIdx >= 0) {
                    dispatch({ type: 'SET_SCENE_INDEX', index: sceneIdx });
                  }
                  dispatch({
                    type: 'SET_INSPECTOR',
                    context: { type: 'scene', sceneId: scene.id },
                  });
                }}
                className="group flex flex-col gap-1 rounded bg-white/3 p-2 text-left transition-colors hover:bg-white/7"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-text-dim shrink-0">{i + 1}</span>
                  {loc && <span className="text-[10px] text-text-dim">{loc.name}</span>}
                  {pov && <span className="text-[10px] text-text-dim ml-auto">POV: {pov.name}</span>}
                </div>
                <p className="text-xs text-text-secondary leading-relaxed group-hover:text-text-primary transition-colors">
                  {scene.summary || 'No summary available.'}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
