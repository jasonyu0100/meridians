'use client';

// HierarchyModal — edit the location hierarchy (the map tree) of nested places.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/state/store';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { IconSpinner } from '@/components/icons';
import { ReasoningInline } from '@/components/generation/ReasoningStream';
import { outlineContext } from '@/lib/ai/context';
import {
  reorganizeLocationHierarchy,
  sanitizeHierarchy,
  LOCATION_FANOUT_MAX,
} from '@/lib/ai/hierarchy';

type Phase = 'thinking' | 'review' | 'error';

/** children-by-parent index from a parent map (null key = top level). */
function indexChildren(parents: Record<string, string | null>): Map<string | null, string[]> {
  const m = new Map<string | null, string[]>();
  for (const [id, p] of Object.entries(parents)) {
    const key = p ?? null;
    const arr = m.get(key);
    if (arr) arr.push(id);
    else m.set(key, [id]);
  }
  return m;
}

/**
 * HierarchyModal — rebuild the location containment tree with AI, streaming the
 * model's reasoning live, then let the operator review and EDIT the proposed
 * tree (re-parent any node, watching for over-full nodes) before applying. The
 * applied tree reshapes the whole map tree.
 */
export function HierarchyModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const [phase, setPhase] = useState<Phase>('thinking');
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<Record<string, string | null>>({});

  const streamRef = useRef<HTMLDivElement>(null);

  const locName = useCallback(
    (id: string) => narrative?.locations[id]?.name ?? id,
    [narrative],
  );

  const run = useCallback(async () => {
    if (!narrative) return;
    setPhase('thinking');
    setError(null);
    setStreamText('');
    try {
      const outline = outlineContext(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
      const parents = await reorganizeLocationHierarchy(narrative, {
        outline,
        onReasoning: (t) => setStreamText((p) => p + t),
      });
      setProposed(parents);
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  // Kick off on open. Deferred a tick so the generation's first setState doesn't
  // fire synchronously inside the effect (cascading-render lint). The cancel
  // flag (not a persistent ref) makes this StrictMode-safe: the throwaway mount's
  // timer is cancelled by its cleanup and the surviving mount reschedules, so
  // run() fires exactly once. `run` is stable while the modal is open.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => { if (!cancelled) void run(); }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [run]);

  // Keep the streaming view pinned to the latest tokens.
  useEffect(() => {
    if (phase === 'thinking' && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamText, phase]);

  const childrenOf = useMemo(() => {
    const m = indexChildren(proposed);
    for (const arr of m.values()) arr.sort((a, b) => locName(a).localeCompare(locName(b)));
    return m;
  }, [proposed, locName]);

  // Descendants of a node (so the parent picker can't create a cycle).
  const descendantsOf = useCallback(
    (id: string): Set<string> => {
      const out = new Set<string>();
      const stack = [...(childrenOf.get(id) ?? [])];
      while (stack.length) {
        const cur = stack.pop()!;
        if (out.has(cur)) continue;
        out.add(cur);
        stack.push(...(childrenOf.get(cur) ?? []));
      }
      return out;
    },
    [childrenOf],
  );

  const allIdsByName = useMemo(
    () =>
      Object.keys(narrative?.locations ?? {}).sort((a, b) => locName(a).localeCompare(locName(b))),
    [narrative, locName],
  );

  const setParent = useCallback((id: string, parentId: string | null) => {
    setProposed((prev) => ({ ...prev, [id]: parentId }));
  }, []);

  const apply = useCallback(() => {
    if (!narrative) return;
    dispatch({ type: 'REBUILD_LOCATION_HIERARCHY', parents: sanitizeHierarchy(proposed, narrative) });
    onClose();
  }, [narrative, proposed, dispatch, onClose]);

  // Stats for the review header.
  const topCount = (childrenOf.get(null) ?? []).length;
  const overfull = useMemo(
    () => [...childrenOf.entries()].filter(([, kids]) => kids.length > LOCATION_FANOUT_MAX).length,
    [childrenOf],
  );

  if (!narrative) return null;

  // One editable row + its subtree (indented). Each node picks its parent;
  // over-full nodes (too many children for one map) are flagged amber.
  const renderNode = (id: string, depth: number, seen: Set<string>): React.ReactNode => {
    if (seen.has(id)) return null;
    seen.add(id);
    const kids = childrenOf.get(id) ?? [];
    const banned = descendantsOf(id);
    const over = kids.length > LOCATION_FANOUT_MAX;
    return (
      <div key={id}>
        <div
          className="flex items-center gap-2 py-1 rounded hover:bg-white/5"
          style={{ paddingLeft: depth * 16 + 4 }}
        >
          <span className="text-[12px] text-text-primary truncate flex-1 min-w-0">
            {locName(id)}
            {kids.length > 0 && (
              <span className={`ml-1.5 text-[10px] tabular-nums ${over ? 'text-amber-300' : 'text-text-dim/60'}`}>
                ({kids.length}{over ? ` · over ${LOCATION_FANOUT_MAX}` : ''})
              </span>
            )}
          </span>
          <select
            value={proposed[id] ?? ''}
            onChange={(e) => setParent(id, e.target.value || null)}
            className="shrink-0 max-w-[44%] text-[10px] bg-bg-elevated border border-white/10 rounded-md px-1.5 py-1 text-text-secondary hover:border-white/20 outline-none transition-colors"
            title="Set parent (containing location)"
          >
            <option value="">— Top level —</option>
            {allIdsByName
              .filter((cand) => cand !== id && !banned.has(cand))
              .map((cand) => (
                <option key={cand} value={cand}>{locName(cand)}</option>
              ))}
          </select>
        </div>
        {kids.map((k) => renderNode(k, depth + 1, seen))}
      </div>
    );
  };

  const seen = new Set<string>();
  const roots = childrenOf.get(null) ?? [];

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="90vh">
      <ModalHeader onClose={onClose}>
        <h2 className="text-sm font-semibold text-text-primary">Rebuild location hierarchy</h2>
        <span className="text-[10px] uppercase tracking-widest text-text-dim shrink-0">
          {phase === 'review'
            ? `${topCount} top-level${overfull > 0 ? ` · ${overfull} over-full` : ''}`
            : phase === 'thinking' ? 'Generating' : 'Error'}
        </span>
      </ModalHeader>

      <ModalBody className="px-5 py-4 space-y-3">
        {phase === 'thinking' && (
          <>
            <p className="text-[11px] text-text-dim leading-relaxed">
              The model is studying the world and proposing a balanced, recursively-mappable tree.
            </p>
            <div ref={streamRef} className="h-[55vh] overflow-y-auto pr-1">
              {streamText
                ? <ReasoningInline text={streamText} active />
                : (
                  <div className="flex items-center gap-2 text-[11px] text-text-dim/60 pl-3 border-l border-white/8">
                    <IconSpinner size={12} className="animate-spin" />
                    Waiting for the model…
                  </div>
                )}
            </div>
          </>
        )}

        {phase === 'error' && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
            <p className="text-[11px] text-red-300/90 wrap-break-word">{error}</p>
          </div>
        )}

        {phase === 'review' && (
          <>
            <p className="text-[11px] text-text-dim leading-relaxed">
              Review the proposed tree. Re-parent any location with its dropdown; pick
              <span className="text-text-secondary"> Top level </span> to make it a root region.
              Over-full nodes (more than {LOCATION_FANOUT_MAX} children — too many for one legible map) are flagged amber.
            </p>
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-white/6 bg-white/2 p-2">
              {roots.length === 0
                ? <p className="text-[11px] text-text-dim/60 italic px-1 py-2">No locations.</p>
                : roots.map((r) => renderNode(r, 0, seen))}
            </div>
          </>
        )}
      </ModalBody>

      <ModalFooter>
        {(phase === 'review' || phase === 'error') && (
          <button
            onClick={() => void run()}
            className="text-xs font-semibold text-text-secondary hover:text-text-primary border border-white/10 hover:border-white/20 hover:bg-white/5 px-3 py-2 rounded-md transition-colors"
          >
            Regenerate
          </button>
        )}
        <button
          onClick={onClose}
          className="text-xs text-text-dim hover:text-text-primary px-3 py-2 rounded-md hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={apply}
          disabled={phase !== 'review'}
          className="text-xs font-semibold text-text-primary bg-white/10 hover:bg-white/16 px-3 py-2 rounded-md transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          Apply hierarchy
        </button>
      </ModalFooter>
    </Modal>
  );
}
