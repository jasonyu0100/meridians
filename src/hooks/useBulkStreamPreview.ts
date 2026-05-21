'use client';

import { useEffect, useState } from 'react';

/**
 * Cross-scene bulk stream subscription. Each scene view (plan / prose /
 * game) uses this to surface whatever bulk pass is currently in flight,
 * even when the operator is viewing a different scene than the one
 * being processed. Scene-bound state (planCache, proseState, etc.)
 * stays gated by sceneId in the views themselves; this hook only tracks
 * the live preview surface.
 *
 * Mode → event names:
 *   plan  → bulk:plan-start / bulk:plan-reasoning / bulk:plan-complete
 *   prose → bulk:prose-start / bulk:prose-token   / bulk:prose-complete
 *   game  → bulk:game-start  / bulk:game-reasoning / bulk:game-complete
 */
export type BulkMode = 'plan' | 'prose' | 'game';

export type BulkStreamPreview = {
  /** True between start and complete on any scene. */
  active: boolean;
  /** Which scene the bulk is currently processing. */
  sceneId: string | null;
  /** Accumulated stream text for the current scene. */
  text: string;
};

const EVENTS: Record<BulkMode, { start: string; token: string; complete: string }> = {
  plan:  { start: 'bulk:plan-start',  token: 'bulk:plan-reasoning',  complete: 'bulk:plan-complete'  },
  prose: { start: 'bulk:prose-start', token: 'bulk:prose-token',     complete: 'bulk:prose-complete' },
  game:  { start: 'bulk:game-start',  token: 'bulk:game-reasoning',  complete: 'bulk:game-complete'  },
};

export function useBulkStreamPreview(mode: BulkMode): BulkStreamPreview {
  const [state, setState] = useState<BulkStreamPreview>({
    active: false,
    sceneId: null,
    text: '',
  });

  useEffect(() => {
    const { start, token, complete } = EVENTS[mode];

    const onStart = (e: Event) => {
      const { sceneId } = ((e as CustomEvent).detail ?? {}) as { sceneId?: string };
      setState({ active: true, sceneId: sceneId ?? null, text: '' });
    };
    const onToken = (e: Event) => {
      const { sceneId, token: tok } = ((e as CustomEvent).detail ?? {}) as { sceneId?: string; token?: string };
      if (typeof tok !== 'string') return;
      setState((prev) => {
        // Switched scenes mid-flight: reset text to the incoming token.
        if (prev.sceneId !== sceneId) {
          return { active: true, sceneId: sceneId ?? null, text: tok };
        }
        // Plan / game emitters send the accumulated string; prose sends
        // deltas. Detect by checking whether the new token is a strict
        // extension of the prior accumulation.
        const next = tok.startsWith(prev.text) ? tok : prev.text + tok;
        return { active: true, sceneId: sceneId ?? null, text: next };
      });
    };
    const onComplete = () => {
      // Leave sceneId / text intact so the preview doesn't flicker
      // between scenes in a queue. The next start resets them.
      setState((prev) => ({ ...prev, active: false }));
    };

    window.addEventListener(start, onStart);
    window.addEventListener(token, onToken);
    window.addEventListener(complete, onComplete);
    return () => {
      window.removeEventListener(start, onStart);
      window.removeEventListener(token, onToken);
      window.removeEventListener(complete, onComplete);
    };
  }, [mode]);

  return state;
}
