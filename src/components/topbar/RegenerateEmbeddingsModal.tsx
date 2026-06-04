'use client';
// RegenerateEmbeddingsModal — trigger bulk re-embedding of scenes/beats/propositions with mode selection.

import { useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { useBulkEmbed, type EmbedMode } from '@/hooks/useBulkEmbed';

type Props = {
  onClose: () => void;
};

export function RegenerateEmbeddingsModal({ onClose }: Props) {
  const { isEmbedding, progress, error, computeStats, generateEmbeddings } = useBulkEmbed();
  const [selectedModes, setSelectedModes] = useState<Set<EmbedMode>>(new Set());

  const stats = computeStats();

  const handleToggleMode = (mode: EmbedMode) => {
    setSelectedModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) {
        next.delete(mode);
      } else {
        next.add(mode);
      }
      return next;
    });
  };

  const handleGenerate = async () => {
    if (selectedModes.size === 0) return;
    await generateEmbeddings(Array.from(selectedModes));
    if (!error) {
      // Auto-close on success
      setTimeout(onClose, 500);
    }
  };

  const formatProgress = () => {
    if (!progress) return null;
    const mode = progress.mode === 'summaries' ? 'summaries' : progress.mode === 'propositions' ? 'propositions' : 'prose';
    return `Embedding ${mode}: ${progress.completed}/${progress.total}`;
  };

  return (
    <Modal onClose={onClose} size="lg">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
          <span className="font-semibold text-sm text-text-primary">Regenerate Embeddings</span>
        </div>
      </ModalHeader>

      <ModalBody className="p-5 space-y-4">
        {/* Description */}
        <div className="p-3 bg-bg-surface border border-border rounded text-sm text-text-dim">
          <p className="mb-2">
            Regenerate missing embeddings for the current narrative. Useful when:
          </p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>Importing world views from before embeddings existed</li>
            <li>Embedding generation failed during plan/scene creation</li>
            <li>Manual plan edits (embeddings not auto-regenerated)</li>
            <li>Embeddings corrupted or incomplete</li>
          </ul>
        </div>

        {/* Coverage stats */}
        {stats && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-text-dim uppercase tracking-wide">
              Current Coverage
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-bg-surface border border-border rounded">
                <div className="text-xs text-text-dim mb-1">Summaries</div>
                <div className="text-lg font-bold text-text-primary">
                  {stats.summaries.total - stats.summaries.missing}/{stats.summaries.total}
                </div>
                <div className="text-[10px] text-text-dim">
                  {stats.summaries.missing > 0 ? `${stats.summaries.missing} missing` : 'Complete'}
                </div>
              </div>
              <div className="p-3 bg-bg-surface border border-border rounded">
                <div className="text-xs text-text-dim mb-1">Propositions</div>
                <div className="text-lg font-bold text-text-primary">
                  {stats.propositions.total - stats.propositions.missing}/{stats.propositions.total}
                </div>
                <div className="text-[10px] text-text-dim">
                  {stats.propositions.missing > 0 ? `${stats.propositions.missing} missing` : 'Complete'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mode selection */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-text-dim uppercase tracking-wide">
            Select What to Regenerate
          </div>
          <div className="space-y-2">
            {(['summaries', 'propositions'] as EmbedMode[]).map((mode) => {
              const modeStats = stats?.[mode];
              const hasMissing = modeStats && modeStats.missing > 0;
              const isSelected = selectedModes.has(mode);
              return (
                <label
                  key={mode}
                  className={`flex items-center gap-3 p-3 border rounded cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-accent/10 border-accent/50'
                      : 'bg-bg-surface border-border hover:border-accent/30'
                  } ${!hasMissing ? 'opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleMode(mode)}
                    disabled={isEmbedding || !hasMissing}
                    className="w-4 h-4 rounded border-border text-accent focus:ring-accent focus:ring-offset-0"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-text-primary capitalize">{mode}</div>
                    {modeStats && (
                      <div className="text-xs text-text-dim">
                        {hasMissing
                          ? `${modeStats.missing} of ${modeStats.total} missing`
                          : 'All embeddings present'}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Progress */}
        {isEmbedding && progress && (
          <div className="p-4 bg-bg-surface border border-accent/30 rounded">
            <div className="text-sm text-text-dim mb-2">{formatProgress()}</div>
            <div className="h-2 bg-bg-base rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${(progress.completed / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400">
            {error}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <div className="flex items-center justify-between w-full">
          <button
            onClick={onClose}
            disabled={isEmbedding}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isEmbedding ? 'Generating...' : 'Close'}
          </button>
          <button
            onClick={handleGenerate}
            disabled={isEmbedding || selectedModes.size === 0}
            className="px-4 py-2 bg-accent text-white rounded text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isEmbedding ? 'Generating...' : 'Regenerate Selected'}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
