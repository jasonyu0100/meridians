'use client';

/**
 * ApplyExtensionModal — two-phase Apply UI for an extension file.
 *
 * Phase 1 ("reconciling"): streams the LLM tokens from
 * `prepareExtensionApply` so the operator can watch the reconciliation
 * run against the active narrative. Existing entities are the source
 * of truth — the LLM is fed combined name lists and decides which
 * slice entities fold into existing records.
 *
 * Phase 2 ("preview"): once reconciliation resolves, shows a structured
 * summary — per-category merge lists and net-new counts — and offers
 * the operator a final "Append to current branch" confirmation. The
 * commit step is pure ID remapping + dispatch; no further LLM work.
 *
 * Design: monochromatic surveys aesthetic — white/5 cards, text-dim
 * meta lines, tracking-wider uppercase chips, sparing accent color
 * reserved for the merge-vs-new distinction.
 */

import { useEffect, useRef, useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { useStore } from '@/lib/state/store';
import {
  prepareExtensionApply,
  commitPreparedApply,
  type MergeSummary,
  type PreparedApply,
} from '@/lib/io/file-conversion';
import type { SourceFile } from '@/types/narrative';

type Props = {
  file: SourceFile;
  onClose: () => void;
};

type Stage =
  | { phase: 'reconciling' }
  | { phase: 'ready'; prepared: PreparedApply }
  | { phase: 'committing' }
  | { phase: 'error'; message: string };

export function ApplyExtensionModal({ file, onClose }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const branchId = state.viewState.activeBranchId;

  const [stage, setStage] = useState<Stage>({ phase: 'reconciling' });
  const [streamText, setStreamText] = useState('');
  const streamRef = useRef<HTMLPreElement>(null);

  // Kick off reconcile on mount. The component is keyed on file.id by the
  // caller, so remounts give a fresh reconcile. The synchronous "no
  // narrative" guard is folded into the same effect to keep the
  // set-state-on-mount path out of the render body.
  useEffect(() => {
    let cancelled = false;
    if (!narrative) {
      // Defer the setState a tick so it doesn't fire synchronously in
      // the effect body. queueMicrotask is the lightest way to escape
      // the effect's call stack while still landing the update before
      // the next paint.
      queueMicrotask(() => {
        if (cancelled) return;
        setStage({ phase: 'error', message: 'No active narrative.' });
      });
      return () => {
        cancelled = true;
      };
    }
    prepareExtensionApply(narrative, file, (_token, accumulated) => {
      if (cancelled) return;
      setStreamText(accumulated);
    })
      .then((prepared) => {
        if (cancelled) return;
        setStage({ phase: 'ready', prepared });
      })
      .catch((err) => {
        if (cancelled) return;
        setStage({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [file, narrative]);

  // Auto-scroll the streaming pane to bottom as tokens arrive.
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight });
  }, [streamText]);

  const handleAppend = () => {
    if (stage.phase !== 'ready' || !narrative || !branchId) return;
    setStage({ phase: 'committing' });
    try {
      commitPreparedApply(narrative, file, branchId, stage.prepared, dispatch);
      onClose();
    } catch (err) {
      setStage({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-px rounded bg-white/10 text-text-secondary shrink-0">
          apply
        </span>
        <h2 className="text-[13px] font-medium text-text-primary truncate">{file.name}</h2>
        <span className="text-[10px] text-text-dim/65 ml-auto shrink-0">{stageLabel(stage)}</span>
      </ModalHeader>

      {stage.phase === 'reconciling' && (
        <ModalBody>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-text-secondary">
                Reconciling slice against narrative…
              </span>
            </div>
            <p className="text-[10px] text-text-dim/65 leading-relaxed">
              Cross-referencing every character, location, artifact, thread and
              system concept in this file against the world&apos;s existing
              records. Variants that denote the same referent will fold into
              the existing entity; the rest land as net-new.
            </p>
            <pre
              ref={streamRef}
              className="text-[11px] text-text-dim font-mono whitespace-pre-wrap max-h-72 overflow-y-auto bg-white/3 rounded-lg p-3 leading-relaxed"
              style={{ scrollbarWidth: 'thin' }}
            >
              {streamText || ' '}
            </pre>
          </div>
        </ModalBody>
      )}

      {stage.phase === 'ready' && (
        <ModalBody>
          <MergePreview summary={stage.prepared.summary} />
        </ModalBody>
      )}

      {stage.phase === 'committing' && (
        <ModalBody>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] text-text-secondary">Appending…</span>
          </div>
        </ModalBody>
      )}

      {stage.phase === 'error' && (
        <ModalBody>
          <p className="text-[11px] text-red-400/80">{stage.message}</p>
        </ModalBody>
      )}

      <ModalFooter>
        {stage.phase === 'ready' && (
          <>
            <button
              onClick={onClose}
              className="text-[11px] px-3 py-1.5 rounded-full text-text-dim hover:text-text-secondary transition"
            >
              Cancel
            </button>
            <button
              onClick={handleAppend}
              disabled={!branchId}
              title={branchId ? 'Commit the merge to the active branch' : 'Select a branch first'}
              className="text-[11px] px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Append to current branch
            </button>
          </>
        )}
        {stage.phase === 'error' && (
          <button
            onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-text-primary transition"
          >
            Close
          </button>
        )}
        {stage.phase === 'reconciling' && (
          <button
            onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded-full text-text-dim hover:text-text-secondary transition"
          >
            Cancel
          </button>
        )}
      </ModalFooter>
    </Modal>
  );
}

function stageLabel(stage: Stage): string {
  switch (stage.phase) {
    case 'reconciling':
      return 'reconciling';
    case 'ready':
      return 'preview';
    case 'committing':
      return 'committing';
    case 'error':
      return 'failed';
  }
}

/** Pre-commit merge preview — surfaces every cross-narrative decision
 *  the reconcile pass made, so the operator can audit before append. */
function MergePreview({ summary }: { summary: MergeSummary }) {
  return (
    <div className="space-y-4">
      <SummaryRow
        label="Characters"
        merged={summary.characters.merged.length}
        added={summary.characters.new.length}
      />
      <MergeList kind="character" items={summary.characters.merged} />
      <NewList kind="character" items={summary.characters.new} />

      <SummaryRow
        label="Locations"
        merged={summary.locations.merged.length}
        added={summary.locations.new.length}
      />
      <MergeList kind="location" items={summary.locations.merged} />
      <NewList kind="location" items={summary.locations.new} />

      <SummaryRow
        label="Artifacts"
        merged={summary.artifacts.merged.length}
        added={summary.artifacts.new.length}
      />
      <MergeList kind="artifact" items={summary.artifacts.merged} />
      <NewList kind="artifact" items={summary.artifacts.new} />

      <SummaryRow
        label="Threads"
        merged={summary.threads.merged.length}
        added={summary.threads.new.length}
      />
      <ThreadMergeList items={summary.threads.merged} />
      <NewList kind="thread" items={summary.threads.new} />

      <SummaryRow
        label="System concepts"
        merged={summary.systemConcepts.merged.length}
        added={summary.systemConcepts.new.length}
      />
      <ConceptMergeList items={summary.systemConcepts.merged} />
      <NewList kind="concept" items={summary.systemConcepts.new} />

      <div className="pt-2 border-t border-white/8">
        <div className="grid grid-cols-3 gap-3 text-[10px] text-text-dim/75">
          <Stat label="Scenes" value={summary.scenes} />
          <Stat label="Arcs" value={summary.arcs} />
          <Stat label="World commits" value={summary.worldBuilds} />
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, merged, added }: { label: string; merged: number; added: number }) {
  return (
    <div className="flex items-baseline gap-2 mt-1">
      <span className="text-[9px] font-mono uppercase tracking-wider text-text-dim/70">
        {label}
      </span>
      <span className="text-[10px] text-text-dim/55 ml-auto tabular-nums">
        {merged} merge · {added} new
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-text-dim/55">{label}</span>
      <span className="text-[13px] font-mono tabular-nums text-text-primary">{value}</span>
    </div>
  );
}

function MergeList({
  items,
  kind,
}: {
  items: { sliceName: string; existingName: string }[];
  kind: 'character' | 'location' | 'artifact';
}) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((m) => (
        <li
          key={`${kind}-${m.sliceName}`}
          className="text-[11px] text-text-secondary flex items-baseline gap-2 px-2 py-1 rounded border border-white/5 bg-white/3"
        >
          <span className="truncate">{m.sliceName}</span>
          <span className="text-text-dim/40 shrink-0">→</span>
          <span className="text-text-primary truncate">{m.existingName}</span>
        </li>
      ))}
    </ul>
  );
}

function ThreadMergeList({
  items,
}: {
  items: { sliceDescription: string; existingDescription: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((m, i) => (
        <li
          key={`thread-${i}`}
          className="text-[11px] text-text-secondary px-2 py-1.5 rounded border border-white/5 bg-white/3"
        >
          <p className="truncate">{m.sliceDescription}</p>
          <p className="text-text-dim/50 truncate">→ {m.existingDescription}</p>
        </li>
      ))}
    </ul>
  );
}

function ConceptMergeList({
  items,
}: {
  items: { sliceConcept: string; existingConcept: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((m, i) => (
        <li
          key={`concept-${i}`}
          className="text-[11px] text-text-secondary px-2 py-1.5 rounded border border-white/5 bg-white/3"
        >
          <p className="truncate">{m.sliceConcept}</p>
          <p className="text-text-dim/50 truncate">→ {m.existingConcept}</p>
        </li>
      ))}
    </ul>
  );
}

function NewList({
  items,
  kind,
}: {
  items: string[];
  kind: 'character' | 'location' | 'artifact' | 'thread' | 'concept';
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((name, i) => (
        <span
          key={`${kind}-new-${i}`}
          className="text-[10px] text-text-dim px-1.5 py-px rounded border border-white/8 bg-white/3 truncate max-w-full"
          title={name}
        >
          {name}
        </span>
      ))}
    </div>
  );
}
