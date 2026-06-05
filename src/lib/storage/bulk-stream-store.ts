/**
 * Shared per-scene streaming state for bulk / auto-mode generation.
 *
 * In parallel auto mode multiple scenes generate concurrently, each
 * dispatching `bulk:<mode>-token` / `bulk:<mode>-reasoning` events keyed
 * by sceneId. A naive component-local listener loses everything that
 * arrives while the user is viewing a different scene — switch back
 * mid-stream and the view is empty even though the stream is live.
 *
 * This module subscribes to every bulk event once (at module load) and
 * keeps the running accumulated text per sceneId+mode. Components read
 * via `useSceneBulkStream(sceneId, mode)` and get a live string + an
 * `active` flag, with full backfill on mount.
 *
 * Event contract (post-2026-05-23):
 *   - `bulk:<mode>-start`     → { sceneId }       resets the entry
 *   - `bulk:<mode>-token`     → { sceneId, token } token IS the FULL
 *     `bulk:<mode>-reasoning` → { sceneId, token } accumulated string
 *   - `bulk:<mode>-complete`  → { sceneId }       freezes (no clear, so
 *     the last visible text survives until the next start for that
 *     sceneId — prevents flicker between back-to-back runs)
 */

"use client";

import { useSyncExternalStore } from "react";

export type BulkMode = "plan" | "prose" | "game" | "questions";

type ModeEvents = { start: string; token: string; complete: string };
const EVENTS: Record<BulkMode, ModeEvents> = {
  plan:  { start: "bulk:plan-start",  token: "bulk:plan-reasoning",  complete: "bulk:plan-complete"  },
  prose: { start: "bulk:prose-start", token: "bulk:prose-token",     complete: "bulk:prose-complete" },
  game:  { start: "bulk:game-start",  token: "bulk:game-reasoning",  complete: "bulk:game-complete"  },
  questions: { start: "bulk:questions-start", token: "bulk:questions-reasoning", complete: "bulk:questions-complete" },
};

type Entry = { text: string; active: boolean };
const EMPTY: Entry = { text: "", active: false };

const stores: Record<BulkMode, Map<string, Entry>> = {
  plan:  new Map(),
  prose: new Map(),
  game:  new Map(),
  questions: new Map(),
};

// Subscribers keyed by `${mode}:${sceneId}` — components register one
// per render; we notify only the relevant key when its entry changes.
const subscribers = new Map<string, Set<() => void>>();

function subKey(mode: BulkMode, sceneId: string): string {
  return `${mode}:${sceneId}`;
}

function notify(mode: BulkMode, sceneId: string): void {
  const set = subscribers.get(subKey(mode, sceneId));
  if (!set) return;
  for (const cb of set) cb();
}

function setEntry(mode: BulkMode, sceneId: string, entry: Entry): void {
  stores[mode].set(sceneId, entry);
  notify(mode, sceneId);
}

let wired = false;
function wireGlobalListeners(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  (Object.keys(EVENTS) as BulkMode[]).forEach((mode) => {
    const { start, token: tokEv, complete } = EVENTS[mode];
    window.addEventListener(start, (e: Event) => {
      const { sceneId } = ((e as CustomEvent).detail ?? {}) as { sceneId?: string };
      if (!sceneId) return;
      setEntry(mode, sceneId, { text: "", active: true });
    });
    window.addEventListener(tokEv, (e: Event) => {
      const { sceneId, token } = ((e as CustomEvent).detail ?? {}) as { sceneId?: string; token?: string };
      if (!sceneId || typeof token !== "string") return;
      // Token is the ACCUMULATED string per the post-2026-05-23 contract;
      // replace, don't append.
      setEntry(mode, sceneId, { text: token, active: true });
    });
    window.addEventListener(complete, (e: Event) => {
      const { sceneId } = ((e as CustomEvent).detail ?? {}) as { sceneId?: string };
      if (!sceneId) return;
      const prev = stores[mode].get(sceneId) ?? EMPTY;
      setEntry(mode, sceneId, { text: prev.text, active: false });
    });
  });
}

/** Imperatively clear a scene's stream entry (e.g. after dispatch on
 *  cancel, or when a view wants the spinner to reset). */
export function clearSceneBulkStream(sceneId: string, mode: BulkMode): void {
  if (stores[mode].has(sceneId)) {
    stores[mode].delete(sceneId);
    notify(mode, sceneId);
  }
}

/** Hook for a single scene-view: returns the live accumulated text and an
 *  `active` flag for the given mode. Backfills on mount from any in-flight
 *  stream that started while this component was unmounted (the whole
 *  reason this store exists). Uses `useSyncExternalStore` so React reads
 *  the snapshot synchronously — no cascading render from an effect. */
export function useSceneBulkStream(sceneId: string | null | undefined, mode: BulkMode): Entry {
  wireGlobalListeners();
  const key = sceneId ? subKey(mode, sceneId) : null;
  const subscribe = (cb: () => void) => {
    if (!key) return () => {};
    let set = subscribers.get(key);
    if (!set) {
      set = new Set();
      subscribers.set(key, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) subscribers.delete(key);
    };
  };
  const getSnapshot = (): Entry =>
    sceneId ? stores[mode].get(sceneId) ?? EMPTY : EMPTY;
  // SSR fallback identical to client initial state — entries are always
  // empty until tokens arrive at runtime.
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
