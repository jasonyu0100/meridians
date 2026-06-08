'use client';

// CurriculumRestructureModal — reorganise the global topic tree with AI.
//
// Mirrors the location HierarchyModal: stream the model's reasoning, then let
// the operator review the proposed tree and re-parent any topic before
// applying. Beyond reparenting, the proposal carries MERGES (fold redundant
// topics — the questions follow) and RENAMES, shown as a summary. Restructuring
// is global (topics are shared across branches) but id-stable, so the cumulative
// question bank stays intact everywhere — see curriculum-restructure.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/state/store';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { IconSpinner } from '@/components/icons';
import { ReasoningInline } from '@/components/generation/ReasoningStream';
import {
  reorganizeCurriculum,
  resanitizeCurriculum,
  proposalTopicName,
  proposalHasChanges,
  TOPIC_FANOUT_MAX,
  type CurriculumProposal,
} from '@/lib/ai/curriculum-restructure';

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

export function CurriculumRestructureModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const topics = useMemo(() => narrative?.topics ?? {}, [narrative?.topics]);

  const [phase, setPhase] = useState<Phase>('thinking');
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CurriculumProposal | null>(null);
  const [parents, setParents] = useState<Record<string, string | null>>({});

  const streamRef = useRef<HTMLDivElement>(null);

  // Survivor label, honouring the proposal's renames.
  const nameOf = useCallback(
    (id: string) => (proposal ? proposalTopicName(proposal, topics, id) : topics[id]?.name ?? id),
    [proposal, topics],
  );

  const run = useCallback(async () => {
    if (!narrative) return;
    setPhase('thinking');
    setError(null);
    setStreamText('');
    try {
      const result = await reorganizeCurriculum(narrative, {
        onReasoning: (t) => setStreamText((p) => p + t),
      });
      setProposal(result);
      setParents(result.assignments);
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [narrative]);

  // Kick off on open — deferred a tick (StrictMode-safe, matches HierarchyModal).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => { if (!cancelled) void run(); }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [run]);

  useEffect(() => {
    if (phase === 'thinking' && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamText, phase]);

  const childrenOf = useMemo(() => {
    const m = indexChildren(parents);
    for (const arr of m.values()) arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return m;
  }, [parents, nameOf]);

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

  const survivorIdsByName = useMemo(
    () => Object.keys(parents).sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [parents, nameOf],
  );

  const setParent = useCallback((id: string, parentId: string | null) => {
    setParents((prev) => ({ ...prev, [id]: parentId }));
  }, []);

  const apply = useCallback(() => {
    if (!narrative || !proposal) return;
    const clean = resanitizeCurriculum(proposal, parents, narrative);
    dispatch({
      type: 'RESTRUCTURE_CURRICULUM',
      assignments: clean.assignments,
      renames: clean.renames,
      merges: clean.merges,
    });
    onClose();
  }, [narrative, proposal, parents, dispatch, onClose]);

  // Review-header stats.
  const topCount = (childrenOf.get(null) ?? []).length;
  const mergeCount = proposal?.merges.length ?? 0;
  const renameCount = proposal ? Object.keys(proposal.renames).length : 0;
  const overfull = useMemo(
    () => [...childrenOf.entries()].filter(([, kids]) => kids.length > TOPIC_FANOUT_MAX).length,
    [childrenOf],
  );

  // Whether the (possibly operator-edited) proposal actually changes anything —
  // so Apply never silently no-ops on an identity restructure.
  const hasChanges = useMemo(() => {
    if (!proposal || !narrative) return false;
    const clean = resanitizeCurriculum(proposal, parents, narrative);
    return proposalHasChanges(clean, narrative.topics ?? {});
  }, [proposal, parents, narrative]);

  if (!narrative) return null;

  // One editable row + its subtree (indented), each with a parent picker.
  const renderNode = (id: string, depth: number, seen: Set<string>): React.ReactNode => {
    if (seen.has(id)) return null;
    seen.add(id);
    const kids = childrenOf.get(id) ?? [];
    const banned = descendantsOf(id);
    const over = kids.length > TOPIC_FANOUT_MAX;
    const renamed = !!proposal?.renames[id];
    return (
      <div key={id}>
        <div className="flex items-center gap-2 py-1 rounded hover:bg-white/5" style={{ paddingLeft: depth * 16 + 4 }}>
          <span className="text-[12px] text-text-primary truncate flex-1 min-w-0">
            {nameOf(id)}
            {renamed && (
              <span className="ml-1.5 text-[10px] text-teal-300/80" title={`Renamed from "${topics[id]?.name}"`}>
                ✎
              </span>
            )}
            {kids.length > 0 && (
              <span className={`ml-1.5 text-[10px] tabular-nums ${over ? 'text-amber-300' : 'text-text-dim/60'}`}>
                ({kids.length}{over ? ` · over ${TOPIC_FANOUT_MAX}` : ''})
              </span>
            )}
          </span>
          <select
            value={parents[id] ?? ''}
            onChange={(e) => setParent(id, e.target.value || null)}
            className="shrink-0 max-w-[44%] text-[10px] bg-bg-field border border-white/10 rounded-md px-1.5 py-1 text-text-secondary hover:border-white/20 outline-none transition-colors"
            title="Set parent topic"
          >
            <option value="">— Top level —</option>
            {survivorIdsByName
              .filter((cand) => cand !== id && !banned.has(cand))
              .map((cand) => (
                <option key={cand} value={cand}>{nameOf(cand)}</option>
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
        <h2 className="text-sm font-semibold text-text-primary">Restructure curriculum</h2>
        <span className="text-[10px] uppercase tracking-widest text-text-dim shrink-0">
          {phase === 'review'
            ? `${topCount} top-level${mergeCount ? ` · ${mergeCount} merged` : ''}${renameCount ? ` · ${renameCount} renamed` : ''}${overfull ? ` · ${overfull} over-full` : ''}`
            : phase === 'thinking' ? 'Generating' : 'Error'}
        </span>
      </ModalHeader>

      <ModalBody className="px-5 py-4 space-y-3">
        {phase === 'thinking' && (
          <>
            <p className="text-[11px] text-text-dim leading-relaxed">
              The model is studying the whole topic tree — merging duplicates, rebalancing fan-out, and
              fixing mis-nestings into a cleaner curriculum.
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

        {phase === 'review' && proposal && (
          <>
            {proposal.rationale && (
              <p className="text-[11px] text-text-secondary/80 leading-relaxed border-l-2 border-teal-500/40 pl-3">
                {proposal.rationale}
              </p>
            )}
            <p className="text-[11px] text-text-dim leading-relaxed">
              Review the proposed tree. Re-parent any topic with its dropdown; pick
              <span className="text-text-secondary"> Top level </span> for a root area. Applies to the whole
              work — topics are shared across branches — but ids stay stable, so every branch&apos;s questions
              follow along.
            </p>

            {/* Merges — the questions of `from` move to `into`. */}
            {proposal.merges.length > 0 && (
              <div className="rounded-lg border border-white/6 bg-white/2 p-2">
                <div className="text-[10px] uppercase tracking-widest text-text-dim/70 mb-1">
                  Merges ({proposal.merges.length})
                </div>
                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                  {proposal.merges.map((m) => (
                    <div key={m.from} className="text-[11px] text-text-secondary/80">
                      <span className="text-rose-300/80 line-through">{topics[m.from]?.name ?? m.from}</span>
                      <span className="text-text-dim/50 mx-1.5">→</span>
                      <span className="text-emerald-300/90">{nameOf(m.into)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-white/6 bg-white/2 p-2">
              {roots.length === 0
                ? <p className="text-[11px] text-text-dim/60 italic px-1 py-2">No topics.</p>
                : roots.map((r) => renderNode(r, 0, seen))}
            </div>
            {!hasChanges && (
              <p className="text-[11px] text-text-dim/70 italic">
                No changes proposed — the curriculum is already well-structured. Re-parent a topic above,
                or Regenerate, to make a change.
              </p>
            )}
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
          disabled={phase !== 'review' || !hasChanges}
          className="text-xs font-semibold text-text-primary bg-white/10 hover:bg-white/16 px-3 py-2 rounded-md transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          Apply restructure
        </button>
      </ModalFooter>
    </Modal>
  );
}
