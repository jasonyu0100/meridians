'use client';

/**
 * CompactPreviewModal — runs synthesis on the selected queue entries
 * and lets the operator review / edit the resulting markdown before
 * staging it as a SourceFile.
 *
 * Flow:
 *   1. setup — entry count, optional title, removable per-entry list.
 *   2. operator clicks Synthesise → stream markdown live into the
 *      preview pane.
 *   3. preview — operator toggles between Formatted (rendered markdown)
 *      and Source (raw editable textarea); they can edit the source
 *      and the formatted view updates.
 *   4. staging — "Stage as file" creates the SourceFile
 *      (source='daily-log'), auto-starts conversion, marks consumed
 *      entries as used, and closes. The file then flows through the
 *      standard convert → reconcile → Apply pipeline (with the
 *      daily-log thread alignment pass on reconcile) from the Files
 *      panel.
 */

import { useState } from 'react';
import { useStore } from '@/lib/state/store';
import { IconTrash } from '@/components/icons';
import type { Prior } from '@/types/narrative';
import {
  synthesisePriorsCompact,
  deriveCompactFilename,
} from '@/lib/priors-compact';
import { stageFile, convertFile } from '@/lib/io/file-conversion';
import { Markdown } from '@/components/ui/Markdown';

type Stage = 'setup' | 'synthesising' | 'preview' | 'staging' | 'error';
type PreviewView = 'formatted' | 'source';
// 'ai'     — LLM synthesises the entries into one coherent markdown
//            document (default, higher quality, costs an API call).
// 'concat' — concatenate entries verbatim with markdown headings.
//            No transformation, no cost, predictable output. Useful
//            when the operator already wrote structured entries and
//            wants to flow them through Apply without rewriting.
type CompactMode = 'ai' | 'concat';

/** Build a markdown document by concatenating entries verbatim — no
 *  LLM. Each entry becomes a section: its title (or a date-stamped
 *  fallback) is the H2 heading, its body is the section content.
 *  Order matches synthesis (capturedAt ascending). */
function concatenateEntries(
  entries: ReadonlyArray<Prior>,
  compactTitle: string | undefined,
): string {
  const ordered = [...entries].sort((a, b) => a.capturedAt - b.capturedAt);
  const sections: string[] = [];
  if (compactTitle && compactTitle.trim()) {
    sections.push(`# ${compactTitle.trim()}\n`);
  }
  for (const e of ordered) {
    const heading = e.title?.trim()
      ? e.title.trim()
      : new Date(e.capturedAt).toLocaleString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
    sections.push(`## ${heading}\n\n${e.text.trim()}`);
  }
  return sections.join('\n\n');
}

export function CompactPreviewModal({
  entries,
  onClose,
  onStaged,
}: {
  entries: ReadonlyArray<Prior>;
  onClose: () => void;
  onStaged: () => void;
}) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [stage, setStage] = useState<Stage>('setup');
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<PreviewView>('formatted');
  const [mode, setMode] = useState<CompactMode>('ai');
  // Operator can drop entries from the compact in setup phase. Default
  // is all selected entries; locally-removed ids are filtered out
  // before synthesis. We also expose a hard-delete that removes the
  // entry from the narrative entirely.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  if (!narrative) return null;

  const activeEntries = entries.filter((e) => !removedIds.has(e.id));

  function dropFromCompact(id: string) {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function deleteEntry(id: string) {
    // Hard-delete: remove from narrative (will no-op on locked entries
    // per reducer guard, though selection set should never include
    // locked ones).
    dispatch({ type: 'DELETE_PRIOR', entryId: id });
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  async function handleSynthesise() {
    if (activeEntries.length === 0) return;
    setError(null);
    setMarkdown('');
    // Concatenate mode — no LLM call. Build the markdown locally and
    // jump straight to the preview / edit phase. Cheap, predictable,
    // operator's structure passes through untouched.
    if (mode === 'concat') {
      setMarkdown(concatenateEntries(activeEntries, title.trim() || undefined));
      setStage('preview');
      return;
    }
    setStage('synthesising');
    try {
      const result = await synthesisePriorsCompact({
        entries: activeEntries,
        compactTitle: title.trim() || undefined,
        onToken: (_token, accumulated) => setMarkdown(accumulated),
      });
      setMarkdown(result);
      setStage('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  }

  async function handleStage() {
    if (!narrative) return;
    if (!markdown.trim()) return;
    setStage('staging');
    try {
      const name = deriveCompactFilename(title);
      const file = await stageFile(narrative, name, markdown.trim(), dispatch, {
        source: 'daily-log',
      });
      dispatch({
        type: 'MARK_PRIORS_USED',
        entryIds: activeEntries.map((e) => e.id),
        fileId: file.id,
      });
      await convertFile(narrative, file, dispatch);
      onStaged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/75 backdrop-blur-sm p-6">
      <div className="w-full max-w-5xl h-[92vh] flex flex-col rounded-xl border border-white/10 bg-bg-base/95 shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-white/8">
          <h2 className="text-[11px] uppercase tracking-[0.15em] font-mono text-text-secondary">
            Compact preview
          </h2>
          <span className="text-[10px] text-text-dim/60 font-mono tabular-nums">
            {activeEntries.length} {activeEntries.length === 1 ? 'entry' : 'entries'}
            {removedIds.size > 0 && (
              <span className="text-text-dim/40"> · {removedIds.size} removed</span>
            )}
          </span>

          <div className="ml-auto flex items-center gap-3">
            {/* View toggle — only when there's something to preview. */}
            {(stage === 'preview' || stage === 'synthesising' || stage === 'staging') && (
              <div className="flex items-center gap-px rounded overflow-hidden border border-white/10">
                <ViewPill label="Formatted" active={view === 'formatted'} onClick={() => setView('formatted')} />
                <ViewPill label="Source" active={view === 'source'} onClick={() => setView('source')} />
              </div>
            )}

            <button
              onClick={onClose}
              disabled={stage === 'synthesising' || stage === 'staging'}
              className="text-[11px] uppercase tracking-wider font-mono text-text-dim/55 hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              Close
            </button>
          </div>
        </header>

        {stage === 'setup' && (
          <SetupPane
            title={title}
            onTitleChange={setTitle}
            entries={entries}
            removedIds={removedIds}
            activeCount={activeEntries.length}
            mode={mode}
            onModeChange={setMode}
            onDropFromCompact={dropFromCompact}
            onDeleteEntry={deleteEntry}
            onCancel={onClose}
            onSynthesise={handleSynthesise}
          />
        )}

        {(stage === 'synthesising' || stage === 'preview' || stage === 'staging') && (
          <PreviewPane
            stage={stage}
            view={view}
            markdown={markdown}
            onMarkdownChange={setMarkdown}
            entryCount={activeEntries.length}
            onCancel={onClose}
            onReSynthesise={handleSynthesise}
            onStage={handleStage}
          />
        )}

        {stage === 'error' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-[12px] text-red-400/90">Combine failed</p>
            {error && (
              <p className="text-[11px] text-text-dim/70 max-w-md leading-relaxed">{error}</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={onClose}
                className="text-[11px] uppercase tracking-wider font-mono text-text-dim/65 hover:text-text-primary transition px-3 py-1.5"
              >
                Close
              </button>
              <button
                onClick={() => setStage('setup')}
                className="text-[12px] px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 text-text-primary transition"
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Setup pane ────────────────────────────────────────────────────────

function SetupPane({
  title,
  onTitleChange,
  entries,
  removedIds,
  activeCount,
  mode,
  onModeChange,
  onDropFromCompact,
  onDeleteEntry,
  onCancel,
  onSynthesise,
}: {
  title: string;
  onTitleChange: (v: string) => void;
  entries: ReadonlyArray<Prior>;
  removedIds: Set<string>;
  activeCount: number;
  mode: CompactMode;
  onModeChange: (m: CompactMode) => void;
  onDropFromCompact: (id: string) => void;
  onDeleteEntry: (id: string) => void;
  onCancel: () => void;
  onSynthesise: () => void;
}) {
  const ordered = [...entries].sort((a, b) => a.capturedAt - b.capturedAt);
  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
        <p className="text-[12.5px] text-text-secondary leading-relaxed max-w-2xl">
          {mode === 'ai'
            ? 'Combine the selected entries into a single markdown document. The output stages as a daily-log file and runs through the standard ingest pipeline — with the continuation-first thread-integration pass on reconcile.'
            : 'Concatenate the selected entries verbatim — no LLM rewrite. Each entry becomes its own H2 section using its title (or capture timestamp as fallback). The output stages as a daily-log file the same way.'}
        </p>

        <label className="block max-w-2xl">
          <span className="block text-[10px] uppercase tracking-wider font-mono text-text-dim/70 mb-1.5">
            Title (optional)
          </span>
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="e.g. Geopolitics digest — week of 2026-05-21"
            className="w-full bg-white/3 border border-white/10 rounded px-3 py-2 text-[13px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/25 transition"
          />
        </label>

        {/* Mode toggle — LLM synthesis vs verbatim concatenation. */}
        <div className="max-w-2xl">
          <span className="block text-[10px] uppercase tracking-wider font-mono text-text-dim/70 mb-1.5">
            Compaction mode
          </span>
          <div className="flex items-center gap-px rounded-md overflow-hidden border border-white/10 w-fit">
            <ModeOption
              label="AI combine"
              hint="LLM rewrites the entries into a coherent document"
              active={mode === 'ai'}
              onClick={() => onModeChange('ai')}
            />
            <ModeOption
              label="Concatenate"
              hint="Join entries verbatim under H2 headings"
              active={mode === 'concat'}
              onClick={() => onModeChange('concat')}
            />
          </div>
        </div>

        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <h3 className="text-[10px] uppercase tracking-wider font-mono text-text-dim/70">
              Entries in this compact
            </h3>
            <span className="text-[10px] text-text-dim/50 font-mono tabular-nums">
              {activeCount} / {entries.length}
            </span>
          </div>
          <ul className="space-y-2">
            {ordered.map((e) => {
              const removed = removedIds.has(e.id);
              const title = previewTitle(e);
              const preview = previewBody(e);
              return (
                <li
                  key={e.id}
                  className={`group rounded-lg border p-3 transition ${
                    removed
                      ? 'border-white/4 bg-white/2 opacity-40'
                      : 'border-white/8 bg-white/3 hover:border-white/15'
                  }`}
                >
                  <div className="flex items-baseline gap-3">
                    <h4 className="text-[12px] font-medium text-text-primary truncate flex-1">
                      {title}
                    </h4>
                    <span className="text-[9px] text-text-dim/45 font-mono shrink-0">
                      {new Date(e.capturedAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {!removed && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                        <button
                          onClick={() => onDropFromCompact(e.id)}
                          title="Drop from this compact (entry stays in queue)"
                          className="text-[10px] uppercase tracking-wider font-mono text-text-dim/60 hover:text-text-primary transition px-1.5 py-0.5"
                        >
                          Drop
                        </button>
                        <button
                          onClick={() => onDeleteEntry(e.id)}
                          title="Delete entry permanently"
                          className="w-6 h-6 rounded flex items-center justify-center text-text-dim/55 hover:text-red-400 hover:bg-red-500/10 transition"
                        >
                          <IconTrash size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                  {preview && !removed && (
                    <p className="mt-1.5 text-[11.5px] text-text-dim/75 leading-snug line-clamp-2">
                      {preview}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <footer className="shrink-0 flex items-center gap-2 px-6 py-3 border-t border-white/8 bg-black/20">
        <button
          onClick={onCancel}
          className="text-[11px] uppercase tracking-wider font-mono text-text-dim/65 hover:text-text-primary px-3 py-1.5 transition"
        >
          Cancel
        </button>
        <button
          onClick={onSynthesise}
          disabled={activeCount === 0}
          className="ml-auto text-[12px] px-4 py-2 rounded bg-emerald-400/15 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/25 hover:border-emerald-400/60 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          {mode === 'concat' ? 'Concatenate →' : 'Combine →'}
        </button>
      </footer>
    </>
  );
}

// ── Mode option pill ──────────────────────────────────────────────────

function ModeOption({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={`flex flex-col items-start gap-0.5 px-3 py-1.5 transition-colors ${
        active
          ? 'bg-white/10 text-text-primary'
          : 'text-text-dim/70 hover:text-text-secondary hover:bg-white/5'
      }`}
    >
      <span className="text-[11px] uppercase tracking-wider font-mono">{label}</span>
      <span className="text-[9px] text-text-dim/55 leading-tight">{hint}</span>
    </button>
  );
}

// ── Preview pane ──────────────────────────────────────────────────────

function PreviewPane({
  stage,
  view,
  markdown,
  onMarkdownChange,
  entryCount,
  onCancel,
  onReSynthesise,
  onStage,
}: {
  stage: 'synthesising' | 'preview' | 'staging';
  view: PreviewView;
  markdown: string;
  onMarkdownChange: (v: string) => void;
  entryCount: number;
  onCancel: () => void;
  onReSynthesise: () => void;
  onStage: () => void;
}) {
  void entryCount;
  return (
    <>
      <div className="shrink-0 flex items-center gap-3 px-6 py-2 border-b border-white/6">
        <span className="text-[10px] uppercase tracking-wider font-mono text-text-dim/70">
          {stage === 'synthesising' && '⟳ Combining…'}
          {stage === 'preview' && '✓ Ready to stage'}
          {stage === 'staging' && '⟳ Staging file + starting conversion…'}
        </span>
        <span className="text-[10px] text-text-dim/55 font-mono tabular-nums ml-auto">
          {markdown.length.toLocaleString()} chars
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {view === 'formatted' ? (
          <div className="max-w-3xl mx-auto px-8 py-6">
            {markdown.trim() ? (
              <Markdown text={markdown} variant="reading" />
            ) : (
              <p className="text-[11px] text-text-dim/45 italic">
                Combined output will appear here…
              </p>
            )}
          </div>
        ) : (
          <textarea
            value={markdown}
            onChange={(e) => onMarkdownChange(e.target.value)}
            readOnly={stage !== 'preview'}
            className="w-full h-full bg-bg-base/40 px-8 py-6 text-[13px] text-text-primary leading-relaxed resize-none outline-none font-mono"
            placeholder={stage === 'synthesising' ? 'Tokens will stream here…' : 'Markdown source — editable.'}
          />
        )}
      </div>

      <footer className="shrink-0 flex items-center gap-2 px-6 py-3 border-t border-white/8 bg-black/20">
        <button
          onClick={onCancel}
          disabled={stage === 'synthesising' || stage === 'staging'}
          className="text-[11px] uppercase tracking-wider font-mono text-text-dim/65 hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition px-3 py-1.5"
        >
          {stage === 'preview' ? 'Discard' : 'Cancel'}
        </button>
        {stage === 'preview' && (
          <button
            onClick={onReSynthesise}
            className="text-[11px] uppercase tracking-wider font-mono text-text-dim/70 hover:text-text-primary transition px-3 py-1.5"
          >
            Re-combine
          </button>
        )}
        <button
          onClick={onStage}
          disabled={stage !== 'preview' || !markdown.trim()}
          className="ml-auto text-[12px] px-4 py-2 rounded bg-emerald-400/15 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/25 hover:border-emerald-400/60 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-emerald-400/15 transition"
        >
          Stage as file →
        </button>
      </footer>
    </>
  );
}

// ── View toggle pill ──────────────────────────────────────────────────

function ViewPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 text-[10px] uppercase tracking-wider font-mono transition ${
        active ? 'bg-white/10 text-text-primary' : 'text-text-dim/65 hover:text-text-secondary hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  );
}

// ── Local helpers ─────────────────────────────────────────────────────

function previewTitle(entry: Prior): string {
  if (entry.title && entry.title.trim()) return entry.title.trim();
  const firstLine = entry.text.split('\n').map((s) => s.trim()).find((s) => s.length > 0);
  if (!firstLine) return 'Untitled';
  return firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine;
}

function previewBody(entry: Prior): string {
  const body = entry.title?.trim()
    ? entry.text
    : entry.text.split('\n').slice(1).join('\n');
  return body.trim();
}
