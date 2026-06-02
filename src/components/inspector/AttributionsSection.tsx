'use client';

import { useStore } from '@/lib/store';
import { CollapsibleSection } from './CollapsibleSection';

/**
 * Attributions — scenes (up to the current head) whose `attributions` list cites
 * this id. The same signal System nodes surface, made available for threads and
 * entities so any node can be traced back to the scenes that invoke it.
 */
export function AttributionsSection({ targetId }: { targetId: string }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const entries: { sceneId: string; index: number; title: string }[] = [];
  for (let i = 0; i <= state.viewState.currentSceneIndex && i < state.resolvedEntryKeys.length; i++) {
    const key = state.resolvedEntryKeys[i];
    const scene = narrative.scenes[key];
    const wb = narrative.worldBuilds?.[key];
    const attrs = scene?.attributions ?? [];
    if (!attrs.includes(targetId)) continue;
    entries.push({
      sceneId: key,
      index: i,
      title: (scene?.summary ?? wb?.summary ?? key).slice(0, 70),
    });
  }
  if (entries.length === 0) return null;

  return (
    <CollapsibleSection title="Attributions" count={entries.length}>
      <ul className="flex flex-col gap-1">
        {entries.map((e) => (
          <li key={e.sceneId}>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: 'SET_SCENE_INDEX', index: e.index });
                dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId: e.sceneId } });
              }}
              className="flex items-baseline gap-1.5 text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
            >
              <span className="shrink-0 font-mono text-[10px] text-text-dim">S{e.index + 1}</span>
              <span className="truncate">{e.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}
