'use client';

/**
 * ImportFileModal — copy a source file from another world view into the
 * current one. Two phases:
 *
 *  1. **Pick world** — list every other narrative (the active one is
 *     excluded). Selecting one loads its full state and reads its
 *     `files` map.
 *  2. **Pick files** — multi-select the source files to bring over.
 *     Import clones the raw text asset (and the extracted slice, when the
 *     source already converted) into the current narrative's id-space and
 *     stages a fresh SourceFile via ADD_SOURCE_FILE.
 *
 * Imported files arrive as `mode: 'extend'`. A file that carried an
 * extracted slice lands `ready` (immediately appendable to the active
 * branch); one without lands `staged` (Convert first). The clone is a
 * deep copy at the asset level — deleting the source narrative later
 * leaves the imported copy intact.
 */

import { useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { useStore } from '@/lib/state/store';
import { assetManager } from '@/lib/storage/asset-manager';
import { loadNarrative } from '@/lib/storage/persistence';
import type { NarrativeState, SourceFile } from '@/types/narrative';

type Props = {
  onClose: () => void;
};

type Phase = 'pick-world' | 'pick-files';

/** Three-letter prefix from a title (mirrors file-conversion's id-space). */
function titlePrefix(title: string): string {
  return title.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'TXT';
}

/** Mint the next `F-<prefix>-<n>` not present in `taken`, registering it
 *  so a batch import keeps minting distinct ids against a live set. */
function mintFileId(prefix: string, taken: Set<string>): string {
  const re = new RegExp(`^F-${prefix}-(\\d+)$`);
  let n = 1;
  for (const id of taken) {
    const m = id.match(re);
    if (m) n = Math.max(n, parseInt(m[1], 10) + 1);
  }
  while (taken.has(`F-${prefix}-${n}`)) n++;
  const id = `F-${prefix}-${n}`;
  taken.add(id);
  return id;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ImportFileModal({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const target = state.activeNarrative;

  const [phase, setPhase] = useState<Phase>('pick-world');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
  const [sourceNarrative, setSourceNarrative] = useState<NarrativeState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingWorld, setLoadingWorld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Other narratives — exclude the active one and sort most-recent first.
  const others = state.narratives
    .filter((n) => n.id !== target?.id)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const handlePickWorld = async (id: string, title: string) => {
    setLoadingWorld(true);
    setError(null);
    setSourceTitle(title);
    try {
      const n = await loadNarrative(id);
      const files = n ? Object.values(n.files ?? {}).sort((a, b) => a.createdAt - b.createdAt) : [];
      setSourceNarrative(n);
      setSourceFiles(files);
      setSelected(new Set());
      setPhase('pick-files');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingWorld(false);
    }
  };

  const toggle = (fileId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const handleImport = async () => {
    if (!target || !sourceNarrative || selected.size === 0) return;
    setBusy(true);
    setError(null);
    const taken = new Set(Object.keys(target.files ?? {}));
    const prefix = titlePrefix(target.title);
    const failures: string[] = [];
    try {
      for (const src of sourceFiles) {
        if (!selected.has(src.id)) continue;
        // Clone the raw source text into the target's id-space.
        const content = await assetManager.getText(src.contentRef);
        if (content == null) {
          failures.push(src.name);
          continue;
        }
        const newContentRef = await assetManager.storeText(content, undefined, target.id);

        // Carry over the extracted slice when the source already converted
        // it — lets the imported file skip straight to Extend.
        let newExtractedRef: string | undefined;
        if (src.extractedRef) {
          const sliceJson = await assetManager.getText(src.extractedRef);
          if (sliceJson != null) {
            newExtractedRef = await assetManager.storeText(sliceJson, undefined, target.id);
          }
        }

        const file: SourceFile = {
          id: mintFileId(prefix, taken),
          name: src.name,
          mode: 'extend',
          contentRef: newContentRef,
          charCount: src.charCount,
          wordCount: src.wordCount,
          createdAt: Date.now(),
          status: newExtractedRef ? 'ready' : 'staged',
          ...(newExtractedRef ? { extractedRef: newExtractedRef } : {}),
        };
        dispatch({ type: 'ADD_SOURCE_FILE', narrativeId: target.id, file });
      }
      if (failures.length > 0) {
        setError(
          `Imported the rest, but couldn't read source text for: ${failures.join(', ')}.`,
        );
        setBusy(false);
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <h2 className="text-[13px] font-medium text-text-primary">Import file</h2>
        <span className="text-[10px] text-text-dim/65 ml-2">
          {phase === 'pick-world' ? 'choose a world view' : `from ${sourceTitle}`}
        </span>
        <span className="text-[10px] text-text-dim/55 ml-auto font-mono uppercase tracking-wider">
          {phase === 'pick-world' ? '1 / 2' : '2 / 2'}
        </span>
      </ModalHeader>

      {phase === 'pick-world' ? (
        <ModalBody>
          {others.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[11px] text-text-dim/80">No other world views to import from.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {others.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handlePickWorld(n.id, n.title)}
                  disabled={loadingWorld}
                  className="w-full text-left rounded-lg border border-white/8 bg-white/2 px-3 py-2.5 hover:border-white/16 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] text-text-primary font-medium truncate">{n.title}</span>
                    <span className="text-[10px] text-text-dim/55 font-mono tabular-nums shrink-0">
                      {n.sceneCount} {n.sceneCount === 1 ? 'scene' : 'scenes'}
                    </span>
                  </div>
                  {n.description && (
                    <p className="text-[10px] text-text-dim/60 leading-snug mt-0.5 line-clamp-1">
                      {n.description}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
          {loadingWorld && (
            <p className="mt-3 text-[10px] text-text-dim/60">Loading files…</p>
          )}
          {error && <p className="mt-3 text-[11px] text-red-400/80">{error}</p>}
        </ModalBody>
      ) : (
        <ModalBody>
          {sourceFiles.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[11px] text-text-dim/80">
                {sourceTitle} has no source files to import.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {sourceFiles.map((f) => {
                const isSel = selected.has(f.id);
                const hasSlice = !!f.extractedRef;
                return (
                  <label
                    key={f.id}
                    className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition ${
                      isSel
                        ? 'border-white/30 bg-white/8'
                        : 'border-white/8 bg-white/2 hover:border-white/16 hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(f.id)}
                      className="mt-0.5 w-3.5 h-3.5 rounded border-white/20 bg-white/5 accent-white/60 cursor-pointer shrink-0"
                    />
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="text-[12px] text-text-primary font-medium truncate">{f.name}</span>
                      <span className="text-[10px] text-text-dim/55 font-mono tabular-nums">
                        {formatCount(f.wordCount)} words&nbsp;·&nbsp;{formatCount(f.charCount)} chars
                        {hasSlice && (
                          <span className="ml-1.5 text-emerald-300/80 not-italic">· slice ready</span>
                        )}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-[10px] text-text-dim/55 leading-relaxed">
            Files with a ready slice arrive appendable to the active branch; the
            rest arrive staged for conversion. The copy is independent — nothing
            links back to {sourceTitle}.
          </p>
          {error && <p className="mt-2 text-[11px] text-red-400/80">{error}</p>}
        </ModalBody>
      )}

      <ModalFooter>
        {phase === 'pick-world' ? (
          <button
            onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded-full text-text-dim hover:text-text-secondary transition"
          >
            Cancel
          </button>
        ) : (
          <>
            <button
              onClick={() => {
                setPhase('pick-world');
                setError(null);
              }}
              disabled={busy}
              className="text-[11px] px-3 py-1.5 rounded-full text-text-dim hover:text-text-secondary disabled:opacity-40 transition mr-auto"
            >
              ← Back
            </button>
            <button
              onClick={handleImport}
              disabled={busy || selected.size === 0}
              className="text-[11px] px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {busy
                ? 'Importing…'
                : selected.size > 0
                  ? `Import ${selected.size} file${selected.size === 1 ? '' : 's'}`
                  : 'Import'}
            </button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
