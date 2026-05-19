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

export function FileComposerModal({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState<false | 'save' | 'convert'>(false);
  const [error, setError] = useState<string | null>(null);

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
      if (then === 'convert') await convertFile(narrative, file, dispatch);
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
              rows={14}
              className="w-full bg-white/5 border border-border rounded px-3 py-2 text-[12px] text-text-primary font-mono placeholder:text-text-dim focus:outline-none focus:border-white/20 transition-colors resize-y"
              style={{ scrollbarWidth: 'thin' }}
            />
          </div>
          {error && (
            <p className="text-[11px] text-red-400/80">{error}</p>
          )}
          <p className="text-[10px] text-text-dim/55 leading-relaxed">
            Convert runs the full text-analysis pipeline on this file
            (same as a new world). It does not modify any branch — you
            apply the result to the current branch in a later step.
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
