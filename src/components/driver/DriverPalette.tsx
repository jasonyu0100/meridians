'use client';

/**
 * DriverPalette — floating bottom-center dock for the Entry sub-tab.
 * Visually identical to FloatingPalette (same glass-pill chrome).
 *
 * Two direct actions, no overlays:
 *   - "+" mints an empty entry and focuses the editor.
 *   - "Synthesise" opens the compact preview modal with the entire
 *     queue (the primary CTA, analogue of "Generate" in the scene
 *     palette).
 */

export function DriverPalette({
  queueCount,
  onCreate,
  onSynthesiseAll,
}: {
  queueCount: number;
  onCreate: () => void;
  onSynthesiseAll: () => void;
}) {
  const canSynthesise = queueCount > 0;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 pointer-events-none">
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

        {/* Count chip — only when there's something in the queue.
            Zero-state is implied by the disabled Synthesise CTA below. */}
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
