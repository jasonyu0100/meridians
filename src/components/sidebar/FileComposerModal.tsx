'use client';

/**
 * FileComposerModal — paste text + name a new source file for the
 * current narrative. Two commit paths:
 *  - **Save** — stages the file only. The user can convert it later.
 *  - **Save & Convert** — stages then immediately kicks off conversion.
 *
 * "Convert" runs the same text-analysis pipeline as a fresh world,
 * tagged `kind: 'extend'`. Its result lands on the SourceFile (status →
 * ready) for a later Apply step that commits new entities/scenes onto
 * the active branch.
 *
 * Options mirror /analysis's NewJobSetup:
 *  - Extraction mode: world-only (per-batch world commits, no scenes)
 *    or world + scenes (full assembly).
 *  - Extract plans: beat-plan extraction phase, gated by world+scenes
 *    mode (world-only has no scenes to attach plans to).
 */

import { useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { useStore } from '@/lib/store';
import { stageFile, convertFile } from '@/lib/file-conversion';
import { splitCorpusIntoScenes } from '@/lib/text-analysis';
import { ANALYSIS_MAX_CORPUS_WORDS } from '@/lib/constants';

type Props = {
  onClose: () => void;
};

type ExtractionMode = 'world' | 'full';

export function FileComposerModal({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('full');
  const [extractPlans, setExtractPlans] = useState(true);
  const [busy, setBusy] = useState<false | 'save' | 'convert'>(false);
  const [error, setError] = useState<string | null>(null);

  // Plans only make sense in 'full' mode — world-only drops scenes.
  const planExtractionAllowed = extractionMode === 'full';
  const effectiveExtractPlans = planExtractionAllowed && extractPlans;

  const trimmedContent = content.trim();
  const wordCount = trimmedContent ? trimmedContent.split(/\s+/).length : 0;
  const tooLarge = wordCount > ANALYSIS_MAX_CORPUS_WORDS;
  const sceneCount = trimmedContent && !tooLarge ? splitCorpusIntoScenes(content).length : 0;
  const canSubmit = !!narrative && !!trimmedContent && !!name.trim() && !tooLarge && !busy;

  const handleSave = async (then: 'save' | 'convert') => {
    if (!narrative || !canSubmit) return;
    setBusy(then);
    setError(null);
    try {
      const file = await stageFile(narrative, name, content, dispatch);
      if (then === 'convert') {
        await convertFile(narrative, file, dispatch, {
          extractionMode,
          skipPlanExtraction: !effectiveExtractPlans,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <h2 className="text-[13px] font-medium text-text-primary">Add file</h2>
        <span className="text-[10px] text-text-dim/65 ml-2">extend the current world</span>
      </ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim/75 mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Chapter 12 draft, interview transcript, market memo"
              className="w-full bg-white/5 border border-border rounded px-3 py-2 text-[12px] text-text-primary placeholder:text-text-dim focus:outline-none focus:border-white/20 transition-colors"
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-text-dim/75">
                Source text
              </label>
              <span className={`text-[10px] font-mono tabular-nums ${tooLarge ? 'text-red-400/80' : 'text-text-dim/60'}`}>
                {wordCount.toLocaleString()} words
                {sceneCount > 0 && ` · ${sceneCount} scene${sceneCount === 1 ? '' : 's'}`}
                {tooLarge && ` · max ${ANALYSIS_MAX_CORPUS_WORDS.toLocaleString()}`}
              </span>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste the corpus that should extend this world…"
              rows={12}
              className="w-full bg-white/5 border border-border rounded px-3 py-2 text-[12px] text-text-primary font-mono placeholder:text-text-dim focus:outline-none focus:border-white/20 transition-colors resize-y"
              style={{ scrollbarWidth: 'thin' }}
            />
          </div>

          {/* Extraction mode — mirrors NewJobSetup on /analysis. */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim/75 mb-1.5">
              Extraction mode
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                {
                  value: 'full' as const,
                  label: 'World + Scenes',
                  desc: 'Scenes, arcs, and per-batch world commits — appendable as a coherent arc.',
                },
                {
                  value: 'world' as const,
                  label: 'World only',
                  desc: 'Per-batch world commits only — injects knowledge without adding scenes.',
                },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setExtractionMode(opt.value)}
                  className={`text-left rounded-lg border px-3 py-2.5 transition ${
                    extractionMode === opt.value
                      ? 'border-emerald-500/40 bg-emerald-500/8'
                      : 'border-white/8 bg-white/2 hover:border-white/16 hover:bg-white/5'
                  }`}
                >
                  <div className={`text-[11px] font-medium ${extractionMode === opt.value ? 'text-emerald-200' : 'text-text-secondary'}`}>
                    {opt.label}
                  </div>
                  <div className="text-[10px] text-text-dim/55 leading-snug mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {planExtractionAllowed && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={extractPlans}
                  onChange={(e) => setExtractPlans(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 accent-emerald-500 cursor-pointer"
                />
                <span className="text-[11px] text-text-dim group-hover:text-text-secondary transition select-none">
                  Extract beat plans
                </span>
              </label>
              {!extractPlans && (
                <p className="text-[10px] text-amber-400/60 leading-relaxed pl-5">
                  Beat plans power semantic search over this slice. Skipping is faster but the new scenes won&apos;t be searchable.
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="text-[11px] text-red-400/80">{error}</p>
          )}
          <p className="text-[10px] text-text-dim/55 leading-relaxed">
            Convert runs the same pipeline as a fresh world (minus
            narrative-level meta, which the seed already owns). Nothing
            is applied to any branch — you choose when to commit later.
          </p>
        </div>
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onClose}
          disabled={!!busy}
          className="text-[11px] px-3 py-1.5 rounded-full text-text-dim hover:text-text-secondary disabled:opacity-40 transition"
        >
          Cancel
        </button>
        <button
          onClick={() => handleSave('save')}
          disabled={!canSubmit}
          className="text-[11px] px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-text-secondary hover:text-text-primary hover:bg-white/8 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => handleSave('convert')}
          disabled={!canSubmit}
          className="text-[11px] px-3 py-1.5 rounded-full bg-emerald-400/15 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {busy === 'convert' ? 'Starting…' : 'Save & Convert'}
        </button>
      </ModalFooter>
    </Modal>
  );
}
