'use client';

/**
 * SourceFileModal — full-source-text viewer for a SourceFile. Hydrates
 * the raw body from the assets DB on mount (the narrative JSON only
 * stores a ref) and offers a copy-to-clipboard action.
 */

import { useEffect, useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { assetManager } from '@/lib/asset-manager';
import { Markdown } from '@/components/ui/Markdown';
import type { SourceFile } from '@/types/narrative';

type Props = {
  file: SourceFile;
  onClose: () => void;
};

type View = 'formatted' | 'source';

export function SourceFileModal({ file, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // All files render markdown by default — the renderer falls through
  // to plain paragraphs when no markdown tokens are present, so this
  // is non-destructive for plain-text source files too. Operator can
  // flip to Source to see raw input.
  const [view, setView] = useState<View>('formatted');

  // FilesPanel keys this modal on file.id so swapping files remounts the
  // component, which is why we can hydrate from contentRef just once on
  // mount without a synchronous reset inside the effect.
  useEffect(() => {
    let cancelled = false;
    assetManager
      .getText(file.contentRef)
      .then((text) => {
        if (cancelled) return;
        if (text == null) setError('Source text is missing from local storage.');
        else setContent(text);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [file.contentRef]);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy failed. Select the text manually and copy with Cmd+C.');
    }
  };

  const kindChip = file.mode === 'create'
    ? { label: 'create', class: 'bg-sky-400/15 text-sky-300' }
    : { label: 'extend', class: 'bg-emerald-400/15 text-emerald-300' };

  return (
    <Modal onClose={onClose} size="4xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-px rounded shrink-0 ${kindChip.class}`}>
          {kindChip.label}
        </span>
        <h2 className="text-[13px] font-medium text-text-primary truncate">{file.name}</h2>
        <span className="text-[10px] text-text-dim/65 font-mono tabular-nums shrink-0 ml-auto">
          {file.wordCount.toLocaleString()} words · {file.charCount.toLocaleString()} chars
        </span>
        {/* Formatted / Source toggle — markdown rendering for compacted
            files (and any other markdown source files). */}
        <div className="ml-3 flex items-center gap-px rounded overflow-hidden border border-white/10 shrink-0">
          <ViewPill label="Formatted" active={view === 'formatted'} onClick={() => setView('formatted')} />
          <ViewPill label="Source" active={view === 'source'} onClick={() => setView('source')} />
        </div>
      </ModalHeader>
      <ModalBody className="p-0">
        {content == null && !error && (
          <div className="px-5 py-8 text-center">
            <p className="text-[11px] text-text-dim">Loading source…</p>
          </div>
        )}
        {error && (
          <div className="px-5 py-8 text-center">
            <p className="text-[11px] text-red-400/80">{error}</p>
          </div>
        )}
        {content != null && (
          view === 'formatted' ? (
            <div className="px-5 py-4 max-w-3xl mx-auto" style={{ scrollbarWidth: 'thin' }}>
              <Markdown text={content} variant="reading" />
            </div>
          ) : (
            <pre
              className="text-[12px] text-text-secondary font-mono leading-relaxed whitespace-pre-wrap px-5 py-4 select-text"
              style={{ scrollbarWidth: 'thin' }}
            >
              {content}
            </pre>
          )
        )}
      </ModalBody>
      <ModalFooter>
        <button
          onClick={handleCopy}
          disabled={!content}
          className="text-[11px] px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-text-secondary hover:text-text-primary hover:bg-white/8 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {copied ? 'Copied' : 'Copy source'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

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
