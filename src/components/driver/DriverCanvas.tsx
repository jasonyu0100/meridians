'use client';

/**
 * DriverCanvas — daily-ingest workspace rendered as a canvas mode.
 *
 * Renders Entry (Apple-Notes-style note workspace) OR Search (the
 * existing vector search), driven by graphViewMode:
 *   - 'driver' → Entry
 *   - 'search' → Search (relocated under Driver in the topbar)
 *
 * The Entry/Search sub-tab switcher lives in CanvasTopBar, matching
 * the same pattern other canvas modes use for their sub-toggles
 * (Plan/Prose/Audio under Scene, Variables/Phase under Control).
 * Sub-tabs are persisted in graphViewMode so external callers (e.g.
 * FloatingPalette "go to search") land in the right sub-mode
 * automatically.
 *
 * Lifecycle of entries:
 *   - Queue       — entries not yet folded into any compact. Editable.
 *   - Historical  — entries used in at least one compact. Read-only.
 *
 * Re-use across the boundary is allowed: a historical entry stays
 * selectable for future compacts because synthesis is a read.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import type { DriverEntry } from '@/types/narrative';
import { SearchView } from '@/components/canvas/SearchView';
import { CompactPreviewModal } from './CompactPreviewModal';
import { DriverPalette } from './DriverPalette';

function isLocked(entry: DriverEntry): boolean {
  return !!entry.usedInFileIds && entry.usedInFileIds.length > 0;
}

/** Fallback display title — first non-empty line, trimmed. */
function previewTitle(entry: DriverEntry): string {
  if (entry.title && entry.title.trim()) return entry.title.trim();
  const firstLine = entry.text.split('\n').map((s) => s.trim()).find((s) => s.length > 0);
  if (!firstLine) return 'New note';
  return firstLine.length > 56 ? firstLine.slice(0, 53) + '…' : firstLine;
}

function previewBody(entry: DriverEntry): string {
  const body = entry.title?.trim()
    ? entry.text
    : entry.text.split('\n').slice(1).join('\n');
  const trimmed = body.trim();
  if (!trimmed) return '';
  return trimmed.length > 90 ? trimmed.slice(0, 87) + '…' : trimmed;
}

function formatDateShort(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function DriverCanvas() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const subTab: 'entry' | 'search' =
    state.graphViewMode === 'search' ? 'search' : 'entry';
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [compactOpen, setCompactOpen] = useState(false);
  // 'selection' = compact the operator's checked subset of queue entries.
  // 'queue'     = compact every entry in the queue (Synthesise-all button).
  const [compactScope, setCompactScope] = useState<'selection' | 'queue'>('selection');

  const entries = useMemo<DriverEntry[]>(() => {
    if (!narrative) return [];
    return Object.values(narrative.driverEntries ?? {}).sort(
      (a, b) => b.capturedAt - a.capturedAt,
    );
  }, [narrative]);

  const queue = useMemo(() => entries.filter((e) => !isLocked(e)), [entries]);
  const historical = useMemo(() => entries.filter((e) => isLocked(e)), [entries]);

  // Auto-select the most recent entry when none is active.
  useEffect(() => {
    if (subTab !== 'entry') return;
    if (activeId && entries.some((e) => e.id === activeId)) return;
    setActiveId(queue[0]?.id ?? historical[0]?.id ?? null);
  }, [subTab, activeId, entries, queue, historical]);

  if (!narrative) {
    return (
      <div className="h-full flex items-center justify-center text-text-dim text-sm">
        Open a narrative to use Driver.
      </div>
    );
  }

  // Search sub-tab: the SearchView owns its surface.
  if (subTab === 'search') {
    return (
      <div className="h-full overflow-hidden">
        <SearchView />
      </div>
    );
  }

  const activeEntry = activeId ? entries.find((e) => e.id === activeId) ?? null : null;
  const selectedQueueEntries = queue.filter((e) => selectedIds.has(e.id));

  function createEntry() {
    const id = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    dispatch({
      type: 'CREATE_DRIVER_ENTRY',
      entry: { id, text: '', capturedAt: Date.now() },
    });
    setActiveId(id);
    // Ensure we're on the Entry sub-tab in case operator was on Search.
    if (state.graphViewMode === 'search') {
      dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'driver' });
    }
  }

  function updateActive(updates: { title?: string; text?: string }) {
    if (!activeEntry || isLocked(activeEntry)) return;
    dispatch({ type: 'UPDATE_DRIVER_ENTRY', entryId: activeEntry.id, ...updates });
  }

  function deleteEntry(entry: DriverEntry) {
    if (isLocked(entry)) return;
    dispatch({ type: 'DELETE_DRIVER_ENTRY', entryId: entry.id });
    setSelectedIds((prev) => {
      if (!prev.has(entry.id)) return prev;
      const next = new Set(prev);
      next.delete(entry.id);
      return next;
    });
    if (activeId === entry.id) {
      const remaining = entries.filter((e) => e.id !== entry.id);
      setActiveId(remaining[0]?.id ?? null);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="h-full flex min-h-0 overflow-hidden">
      {/* Sidebar — notes list, grouped Queue / Historical */}
      <aside className="w-64 shrink-0 border-r border-white/8 bg-black/15 flex flex-col min-h-0">
        {/* Selection bar — only when queue items are selected */}
        {selectedIds.size > 0 && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-white/6 bg-amber-400/8">
            <span className="text-[10px] text-amber-300/85 font-mono tabular-nums">
              {selectedIds.size} selected
            </span>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-[10px] text-text-dim/60 hover:text-text-secondary transition"
            >
              Clear
            </button>
            <button
              onClick={() => {
                setCompactScope('selection');
                setCompactOpen(true);
              }}
              className="ml-auto text-[10px] uppercase tracking-wider font-mono text-emerald-300/90 hover:text-emerald-200 transition"
            >
              Compact →
            </button>
          </div>
        )}

        {/* Notes list — grouped */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {entries.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[11px] text-text-dim/85 mb-3">No notes yet.</p>
              <button
                onClick={createEntry}
                className="text-[11px] text-text-secondary hover:text-text-primary underline underline-offset-2 transition"
              >
                + Create your first note
              </button>
            </div>
          ) : (
            <>
              {queue.length > 0 && (
                <NoteGroup
                  label="Queue"
                  items={queue}
                  activeId={activeId}
                  selectedIds={selectedIds}
                  onSelect={setActiveId}
                  onToggleCheckbox={toggleSelect}
                  showCheckboxes
                />
              )}
              {historical.length > 0 && (
                <NoteGroup
                  label="Historical"
                  items={historical}
                  activeId={activeId}
                  selectedIds={selectedIds}
                  onSelect={setActiveId}
                  onToggleCheckbox={() => {}}
                  showCheckboxes={false}
                  dimmed
                />
              )}
            </>
          )}
        </div>
      </aside>

      {/* Main pane — note editor + floating palette. The palette docks
          at the bottom-center over the editor; relative positioning
          here gives it an anchor. */}
      <main className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden relative">
        {activeEntry ? (
          <NoteEditor
            entry={activeEntry}
            onUpdate={updateActive}
            onDelete={() => deleteEntry(activeEntry)}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-center px-8">
            <div className="max-w-sm space-y-3">
              <p className="text-[13px] text-text-dim/85">No note selected.</p>
              <p className="text-[11px] text-text-dim/55 leading-relaxed">
                Capture fragments — briefings, observations, quoted excerpts —
                then synthesise the queue into a file that flows into this
                narrative.
              </p>
            </div>
          </div>
        )}

        <DriverPalette
          queueCount={queue.length}
          onCreate={createEntry}
          onSynthesiseAll={() => {
            setCompactScope('queue');
            setCompactOpen(true);
          }}
        />
      </main>

      {compactOpen && (
        <CompactPreviewModal
          entries={compactScope === 'queue' ? queue : selectedQueueEntries}
          onClose={() => setCompactOpen(false)}
          onStaged={() => {
            setSelectedIds(new Set());
            setCompactOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ── Note group ────────────────────────────────────────────────────────

function NoteGroup({
  label,
  items,
  activeId,
  selectedIds,
  onSelect,
  onToggleCheckbox,
  showCheckboxes,
  dimmed,
}: {
  label: string;
  items: DriverEntry[];
  activeId: string | null;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggleCheckbox: (id: string) => void;
  showCheckboxes: boolean;
  dimmed?: boolean;
}) {
  return (
    <div className={dimmed ? 'opacity-75' : ''}>
      <div className="flex items-baseline gap-2 px-3 pt-3 pb-1.5">
        <h2 className="text-[10px] uppercase tracking-widest font-mono text-text-dim/65">
          {label}
        </h2>
        <span className="text-[10px] text-text-dim/40 font-mono tabular-nums ml-auto">
          {items.length}
        </span>
      </div>
      <ul className="space-y-px">
        {items.map((entry) => (
          <li key={entry.id}>
            <NoteRow
              entry={entry}
              active={activeId === entry.id}
              selected={selectedIds.has(entry.id)}
              onSelect={() => onSelect(entry.id)}
              onToggleCheckbox={() => onToggleCheckbox(entry.id)}
              showCheckbox={showCheckboxes}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoteRow({
  entry,
  active,
  selected,
  onSelect,
  onToggleCheckbox,
  showCheckbox,
}: {
  entry: DriverEntry;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleCheckbox: () => void;
  showCheckbox: boolean;
}) {
  const title = previewTitle(entry);
  const body = previewBody(entry);
  return (
    <button
      onClick={onSelect}
      className={`group w-full text-left px-3 py-2.5 flex items-start gap-2 transition border-l-2 ${
        active
          ? 'bg-white/8 border-amber-400/60'
          : 'border-transparent hover:bg-white/3'
      }`}
    >
      {showCheckbox && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheckbox();
          }}
          role="checkbox"
          aria-checked={selected}
          className={`mt-0.5 w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 cursor-pointer transition ${
            selected
              ? 'bg-amber-400/90 border-amber-400'
              : 'border-white/20 opacity-0 group-hover:opacity-100 hover:border-white/45'
          } ${selected ? 'opacity-100' : ''}`}
        >
          {selected && (
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-black">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[12.5px] font-medium text-text-primary truncate">
            {title}
          </h3>
          <span className="text-[9px] text-text-dim/55 font-mono tabular-nums ml-auto shrink-0">
            {formatDateShort(entry.capturedAt)}
          </span>
        </div>
        {body && (
          <p className="mt-0.5 text-[10.5px] text-text-dim/65 leading-snug truncate">
            {body}
          </p>
        )}
      </div>
    </button>
  );
}

// ── Note editor (main pane) ───────────────────────────────────────────

function NoteEditor({
  entry,
  onUpdate,
  onDelete,
}: {
  entry: DriverEntry;
  onUpdate: (updates: { title?: string; text?: string }) => void;
  onDelete: () => void;
}) {
  const locked = isLocked(entry);
  const title = entry.title ?? '';
  const text = entry.text;

  // Auto-grow the body textarea to fit content. Without this the
  // textarea has its own internal scrollbar that competes with the
  // outer scroll container, producing the double-scroll effect.
  // useLayoutEffect runs before paint so the resize is invisible.
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, entry.id]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Top strip — single subtle line carrying date (always) + lock
          state + delete affordance. Replaces the prior heavy locked
          banner AND the footer; one row of meta keeps the writing
          surface visually quiet. */}
      <div className="shrink-0 flex items-center gap-3 px-8 py-2 border-b border-white/5 group/strip">
        <span className="text-[10px] text-text-dim/55 font-mono">
          {formatDateShort(entry.capturedAt)}
        </span>
        {locked && (
          <span
            className="text-[10px] uppercase tracking-wider font-mono text-amber-300/75"
            title={`Used in ${entry.usedInFileIds?.length ?? 0} compact${(entry.usedInFileIds?.length ?? 0) === 1 ? '' : 's'}`}
          >
            historical
          </span>
        )}
        {!locked && (
          <button
            onClick={onDelete}
            title="Delete note"
            aria-label="Delete note"
            className="ml-auto w-6 h-6 rounded flex items-center justify-center text-text-dim/40 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover/strip:opacity-100 transition"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-10 py-8 space-y-3">
          <input
            value={title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            placeholder="Title"
            readOnly={locked}
            className="w-full bg-transparent text-[22px] font-semibold text-text-primary placeholder:text-text-dim/30 outline-none leading-tight"
          />
          <textarea
            ref={bodyRef}
            value={text}
            onChange={(e) => onUpdate({ text: e.target.value })}
            placeholder="Start writing…"
            readOnly={locked}
            rows={1}
            className="w-full bg-transparent text-[14px] text-text-primary placeholder:text-text-dim/40 resize-none outline-none overflow-hidden leading-relaxed"
          />
        </div>
      </div>
    </div>
  );
}
