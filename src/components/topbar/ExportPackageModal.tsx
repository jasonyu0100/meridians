'use client';

import { useState, useEffect } from 'react';
import { exportAsPackage, calculateExactExportSize, type ExportOptions } from '@/lib/package-export';
import { formatBytes } from '@/lib/package-import';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import type { NarrativeState } from '@/types/narrative';

type Props = {
  narrative: NarrativeState;
  onClose: () => void;
};

type SizeEstimate = {
  narrative: number;
  embeddings: number;
  audio: number;
  images: number;
  total: number;
};

export function ExportPackageModal({ narrative, onClose }: Props) {
  const [options, setOptions] = useState<ExportOptions>({
    includeEmbeddings: true,
    includeAudio: true,
    includeImages: true,
    compressionLevel: 'medium',
  });

  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState({ status: '', percent: 0 });
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState<SizeEstimate>({
    narrative: 0,
    embeddings: 0,
    audio: 0,
    images: 0,
    total: 0,
  });
  const [calculating, setCalculating] = useState(false);

  // Calculate exact sizes when options change
  useEffect(() => {
    let cancelled = false;

    async function calculate() {
      setCalculating(true);
      try {
        const sizes = await calculateExactExportSize(narrative, options);
        if (!cancelled) {
          setEstimate(sizes);
        }
      } catch (err) {
        console.error('Failed to calculate export size:', err);
      } finally {
        if (!cancelled) {
          setCalculating(false);
        }
      }
    }

    calculate();

    return () => {
      cancelled = true;
    };
  }, [narrative, options]);

  async function handleExport() {
    setExporting(true);
    setError('');
    setProgress({ status: 'Starting...', percent: 0 });

    try {
      const zipBlob = await exportAsPackage(narrative, options, (status, percent) => {
        setProgress({ status, percent });
      });

      // Download the file
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${narrative.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.inktide`;
      a.click();
      URL.revokeObjectURL(url);

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Modal onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>
        <h2 className="text-[13px] font-semibold text-text-primary">Export World View Package</h2>
      </ModalHeader>
      <ModalBody className="p-4 space-y-4">
        {/* Story info */}
        <div className="p-3 bg-white/3 rounded-lg border border-white/8">
          <h3 className="text-[12px] font-semibold text-text-primary mb-1">{narrative.title}</h3>
          <p className="text-[10px] text-text-dim">
            {Object.keys(narrative.scenes).length} scenes
          </p>
        </div>

        {/* Asset selection */}
        <div className="space-y-2">
          <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">Include Assets</label>

          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={options.includeEmbeddings}
              onChange={(e) => setOptions({ ...options, includeEmbeddings: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-2 focus:ring-blue-500/30"
            />
            <span className="text-[11px] text-text-secondary group-hover:text-text-primary transition-colors">
              Embeddings ({formatBytes(estimate.embeddings)})
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={options.includeAudio}
              onChange={(e) => setOptions({ ...options, includeAudio: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-2 focus:ring-blue-500/30"
            />
            <span className="text-[11px] text-text-secondary group-hover:text-text-primary transition-colors">
              Audio ({formatBytes(estimate.audio)})
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={options.includeImages}
              onChange={(e) => setOptions({ ...options, includeImages: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-2 focus:ring-blue-500/30"
            />
            <span className="text-[11px] text-text-secondary group-hover:text-text-primary transition-colors">
              Images ({formatBytes(estimate.images)})
            </span>
          </label>
        </div>

        {/* Compression level */}
        <div className="space-y-2">
          <label className="text-[10px] text-text-dim uppercase tracking-wider block">Compression</label>
          <div className="flex gap-2">
            {(['none', 'medium', 'max'] as const).map((level) => (
              <button
                key={level}
                onClick={() => setOptions({ ...options, compressionLevel: level })}
                className={`flex-1 text-[10px] px-3 py-1.5 rounded-lg border transition-colors ${
                  options.compressionLevel === level
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-300'
                    : 'border-white/10 bg-white/3 text-text-dim hover:text-text-secondary hover:border-white/20'
                }`}
              >
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Size estimate */}
        <div className="p-3 bg-white/3 rounded-lg border border-white/8 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-text-dim">World view structure</span>
            <span className="text-text-secondary font-mono">{formatBytes(estimate.narrative)}</span>
          </div>
          {options.includeEmbeddings && estimate.embeddings > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-text-dim">Embeddings</span>
              <span className="text-text-secondary font-mono">{formatBytes(estimate.embeddings)}</span>
            </div>
          )}
          {options.includeAudio && estimate.audio > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-text-dim">Audio</span>
              <span className="text-text-secondary font-mono">{formatBytes(estimate.audio)}</span>
            </div>
          )}
          {options.includeImages && estimate.images > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-text-dim">Images</span>
              <span className="text-text-secondary font-mono">{formatBytes(estimate.images)}</span>
            </div>
          )}
          <div className="pt-1.5 border-t border-white/8 flex items-center justify-between text-[11px]">
            <span className="text-text-secondary font-semibold">Total</span>
            <span className="text-text-primary font-mono font-semibold">{formatBytes(estimate.total)}</span>
          </div>
        </div>

        {/* Progress */}
        {exporting && (
          <div className="space-y-2">
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-[10px] text-text-dim text-center">{progress.status}</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-[10px] text-red-400">{error}</p>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onClose}
          disabled={exporting}
          className="text-[11px] px-3 py-1.5 rounded-md bg-white/5 text-text-dim hover:text-text-secondary transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="text-[11px] px-3 py-1.5 rounded-md bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-colors font-medium disabled:opacity-50"
        >
          {exporting ? 'Exporting...' : 'Export Package'}
        </button>
      </ModalFooter>
    </Modal>
  );
}
