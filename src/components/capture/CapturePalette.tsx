'use client';

/**
 * CapturePalette — floating bottom-center dock for the Queue sub-tab.
 * Visually identical to StagePalette (same glass-pill chrome).
 *
 * Three actions:
 *   - "+" mints an empty entry and focuses the editor.
 *   - sparkle opens a floating popover ABOVE the pill (Prose/Plan-style
 *     generate overlay) with a direction textarea and, when the
 *     narrative has web search enabled, a source URL input. Submitting
 *     generates a new entry via the LLM.
 *   - "Synthesise" opens the compact preview modal with the entire
 *     queue (the primary CTA, analogue of "Generate" in the scene
 *     palette).
 */

import { useState, useRef, useEffect } from 'react';

export function CapturePalette({
  queueCount,
  websearchEnabled,
  onCreate,
  onGenerate,
  onSynthesiseAll,
}: {
  queueCount: number;
  /** When true, the source-URL field is shown in the generate popover
   *  (and web_fetch is available to the LLM). When false, only the
   *  direction prompt is shown. */
  websearchEnabled: boolean;
  onCreate: () => void;
  /** Generate an entry from a direction prompt + optional source URL.
   *  Resolves once the entry has been minted into the queue. */
  onGenerate: (direction: string, sourceUrl?: string) => Promise<void>;
  onSynthesiseAll: () => void;
}) {
  const canSynthesise = queueCount > 0;
  const [genOpen, setGenOpen] = useState(false);
  const [direction, setDirection] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const directionRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the direction textarea when the popover opens.
  useEffect(() => {
    if (genOpen) directionRef.current?.focus();
  }, [genOpen]);

  function closeForm() {
    if (busy) return;
    setGenOpen(false);
    setDirection('');
    setSourceUrl('');
  }

  async function submit() {
    const dir = direction.trim();
    const url = sourceUrl.trim();
    if (!dir && !url) return;
    setBusy(true);
    try {
      await onGenerate(dir, url || undefined);
      setGenOpen(false);
      setDirection('');
      setSourceUrl('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 pointer-events-none">
      {/* Generate-entry popover — appears above the pill, matches the
          StagePalette guidance overlay used by Prose / Plan generate. */}
      {genOpen && (
        <div className="w-96 flex flex-col rounded-xl glass overflow-hidden pointer-events-auto">
          <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-violet-300">
              Generate entry
            </span>
            <button
              onClick={closeForm}
              disabled={busy}
              className="text-[10px] text-text-dim/40 hover:text-text-dim transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              &times;
            </button>
          </div>
          <div className="p-3 space-y-2.5">
            <textarea
              ref={directionRef}
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeForm();
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
              }}
              placeholder='Direction… e.g. "summarise the post-Beijing summit briefing"'
              disabled={busy}
              className="w-full h-20 bg-black/30 border border-border rounded text-[11px] text-text-secondary p-2 resize-none outline-none focus:border-violet-300/30 transition-colors placeholder:text-text-dim/30 disabled:opacity-50"
            />
            {websearchEnabled && (
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeForm();
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
                }}
                placeholder="Source URL (optional) — fetched and extracted through the direction lens"
                disabled={busy}
                className="w-full bg-black/30 border border-border rounded text-[11px] text-text-secondary p-2 outline-none focus:border-violet-300/30 transition-colors placeholder:text-text-dim/30 disabled:opacity-50"
              />
            )}
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-text-dim/30">&#x2318;Enter to submit</span>
              <button
                onClick={() => void submit()}
                disabled={busy || (!direction.trim() && !sourceUrl.trim())}
                className="text-[10px] px-3 py-1 rounded transition bg-violet-500/10 border border-violet-500/20 text-violet-300 hover:bg-violet-500/15 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {busy && <div className="w-2.5 h-2.5 border-2 border-violet-300/30 border-t-violet-300 rounded-full animate-spin" />}
                {busy ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="glass-pill px-3 py-1.5 flex items-center gap-2 pointer-events-auto">
        {/* New entry — sky-tinted circular icon button, paired in
            hue with the emerald Synthesise CTA on the right edge. */}
        <button
          type="button"
          onClick={onCreate}
          aria-label="New entry"
          title="New entry"
          className="w-7 h-7 flex items-center justify-center rounded-full text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* Generate (sparkle) — toggles the popover above. Violet-tinted
            to differentiate from new (sky) + synthesise (emerald). */}
        <button
          type="button"
          onClick={() => (genOpen ? closeForm() : setGenOpen(true))}
          aria-label="Generate entry from prompt"
          title="Generate entry from prompt"
          className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
            genOpen
              ? 'text-violet-200 bg-violet-500/30'
              : 'text-violet-300 bg-violet-500/15 hover:bg-violet-500/25'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
          </svg>
        </button>

        {/* Count chip — only when there's something in the queue. */}
        {queueCount > 0 && (
          <>
            <div className="w-px h-4 bg-white/12 mx-1" />
            <span className="text-[10px] text-text-dim/65 font-mono tabular-nums">
              {queueCount} {queueCount === 1 ? 'entry' : 'entries'} in queue
            </span>
          </>
        )}

        <div className="w-px h-4 bg-white/12 mx-1" />

        <button
          type="button"
          onClick={onSynthesiseAll}
          disabled={!canSynthesise}
          title={canSynthesise ? 'Synthesise all queue entries into one file' : 'Add an entry first'}
          className={`text-xs font-semibold px-3 py-1 rounded-md transition-colors uppercase tracking-wider ${
            !canSynthesise
              ? 'text-text-dim/30 bg-white/3 cursor-not-allowed'
              : 'text-emerald-400 bg-emerald-500/15 hover:bg-emerald-500/25'
          }`}
        >
          Synthesise
        </button>
      </div>
    </div>
  );
}
