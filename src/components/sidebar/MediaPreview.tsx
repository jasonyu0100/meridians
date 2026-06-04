'use client';

// MediaPreview — full-screen portal lightbox for previewing a media asset.

import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useImageUrl } from '@/hooks/useAssetUrl';
import { IconClose, IconChevronLeft, IconChevronRight } from '@/components/icons';

export type MediaItem = {
  id: string;
  imageUrl: string;
  label: string;
  sublabel?: string;
  /** The prompt this image was generated from. Shown as a quiet footer
   *  under the caption so the operator can read what produced the image
   *  without opening a separate inspector. Omit when no prompt exists
   *  (e.g. uploaded covers). */
  prompt?: string;
  aspectClass: string; // e.g. 'aspect-[3/4]' or 'aspect-video'
};

type Props = {
  items: MediaItem[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
};

export default function MediaPreview({ items, currentIndex, onNavigate, onClose }: Props) {
  const item = items[currentIndex];
  const resolvedUrl = useImageUrl(item?.imageUrl);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;

  const goPrev = useCallback(() => {
    if (hasPrev) onNavigate(currentIndex - 1);
  }, [hasPrev, currentIndex, onNavigate]);

  const goNext = useCallback(() => {
    if (hasNext) onNavigate(currentIndex + 1);
  }, [hasNext, currentIndex, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goPrev, goNext]);

  if (!item) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col items-center max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button — inset into the image's top-right corner. Sits
            on a translucent black pill so it's legible against any
            artwork. Stops click propagation so the backdrop's own
            onClose doesn't double-fire. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close preview"
          className="absolute top-3 right-3 z-20 w-7 h-7 flex items-center justify-center rounded-full bg-black/55 backdrop-blur-sm border border-white/15 text-white/75 hover:text-white hover:bg-black/75 hover:border-white/25 transition-colors"
        >
          <IconClose size={12} />
        </button>

        {/* Image */}
        {resolvedUrl && (
          <img
            src={resolvedUrl}
            alt={item.label}
            className="rounded-xl object-contain max-h-[75vh] max-w-[85vw] border border-white/10 shadow-2xl"
          />
        )}

        {/* Caption */}
        <div className="mt-3 text-center">
          <p className="text-sm text-white/90 font-medium">{item.label}</p>
          {item.sublabel && (
            <p className="text-[11px] text-white/40 mt-0.5">{item.sublabel}</p>
          )}
        </div>

        {/* Prompt — the text used to generate this image. Quiet, italic,
            wraps across multiple lines without pushing nav arrows around.
            Constrained to a comfortable reading width so it stays readable
            on wide / narrow artwork alike. */}
        {item.prompt && (
          <p className="mt-2 max-w-[min(60ch,85vw)] px-4 text-[11px] text-white/50 italic leading-relaxed text-center whitespace-pre-wrap">
            {item.prompt}
          </p>
        )}

        {/* Navigation arrows */}
        {hasPrev && (
          <button
            onClick={goPrev}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 w-9 h-9 flex items-center justify-center rounded-full bg-black/50 border border-white/10 text-white/50 hover:text-white hover:bg-black/70 transition-colors"
          >
            <IconChevronLeft size={14} />
          </button>
        )}
        {hasNext && (
          <button
            onClick={goNext}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 w-9 h-9 flex items-center justify-center rounded-full bg-black/50 border border-white/10 text-white/50 hover:text-white hover:bg-black/70 transition-colors"
          >
            <IconChevronRight size={14} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
