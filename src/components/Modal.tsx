'use client';
// Modal — reusable modal shell (header/body/streaming-status) with starfield backdrop.

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { StarField } from '@/components/effects/StarField';
import { IconClose } from '@/components/icons';
import { useTheme } from '@/lib/state/theme-context';

type ModalSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '6xl' | 'full';

const SIZE_CLASSES: Record<ModalSize, string> = {
  xs: 'max-w-xs w-full',
  sm: 'max-w-sm w-full',
  md: 'max-w-md w-full',
  lg: 'max-w-lg w-full',
  xl: 'max-w-xl w-full',
  '2xl': 'max-w-2xl w-full',
  '4xl': 'max-w-4xl w-full',
  '6xl': 'max-w-6xl w-full',
  full: 'w-full h-full',
};

type Props = {
  onClose: () => void;
  children: ReactNode;
  /** Modal width — defaults to 'md' */
  size?: ModalSize;
  /** Fills the entire viewport (no backdrop, no centering) */
  fullScreen?: boolean;
  /** Custom max-height, e.g. '85vh'. Defaults to 'calc(100vh - 4rem)'. Ignored when fullScreen. */
  maxHeight?: string;
  /** Additional className on the panel */
  panelClassName?: string;
};

export function Modal({ onClose, children, size = 'md', fullScreen, maxHeight, panelClassName }: Props) {
  const { theme } = useTheme();
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Lock body scroll while a modal is open so the page scrollbar behind
  // the overlay doesn't appear alongside the modal's own scroll container.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Portal to <body> so `fixed inset-0` is viewport-relative — escapes any
  // transformed/scrolled ancestor (e.g. the Stage) that would otherwise trap
  // the overlay below the top bar.
  if (typeof document === 'undefined') return null;

  const content = fullScreen ? (
      <div className="fixed inset-0 bg-bg-base z-modal flex flex-col overflow-hidden">
        {/* Cosmic background — nebulae + glow + star field, identical to the
            home page's hero stack. Astral theme only; dark/light run flat.
            Pointer-events-none so all input still hits the modal content. */}
        {theme === 'astral' && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="cosmos-container absolute inset-0 z-0">
              <div className="nebula nebula-1" />
              <div className="nebula nebula-2" />
              <div className="nebula nebula-3" />
              <div className="cosmos-glow" />
            </div>
            <div className="cosmos-layer absolute inset-0 z-1">
              <StarField />
            </div>
          </div>
        )}
        {/* Content layer */}
        <div className="relative z-10 flex flex-col h-full">
          {children}
        </div>
      </div>
  ) : (
    <div className="fixed inset-0 bg-black/80 z-modal flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-bg-base border border-border rounded-2xl flex flex-col overflow-hidden ${SIZE_CLASSES[size]} ${panelClassName ?? ''}`}
        style={{ maxHeight: maxHeight ?? 'calc(100vh - 4rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

export function ModalHeader({ children, onClose, hideClose }: { children: ReactNode; onClose: () => void; hideClose?: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-white/6 shrink-0">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {children}
      </div>
      {!hideClose && (
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-white/5 transition-colors text-text-dim hover:text-text-primary shrink-0 ml-3"
        >
          <IconClose size={16} />
        </button>
      )}
    </div>
  );
}

export function ModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex-1 overflow-y-auto min-h-0 ${className ?? 'p-5'}`}>
      {children}
    </div>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/6 shrink-0">
      {children}
    </div>
  );
}

// ── StreamingStatus ─────────────────────────────────────────────────────
//
// Shared streaming UI for modal bodies: a pulsing green status dot + label
// at the top, the streaming text (when present) in a scrollable monospace
// pane below, or skeleton placeholder lines while waiting for the first
// token. The same pattern lives across every modal that fires a streaming
// generation so the user sees a consistent affordance — green dot means
// "working", label says what's being generated, text streams in below.

export function StreamingStatus({
  label,
  streamText,
  maxHeight = 'max-h-80',
}: {
  /** Active-tense status, e.g. "Generating reasoning graph…". */
  label: string;
  /** Streaming reasoning text — empty/undefined renders the skeleton. */
  streamText?: string;
  /** Tailwind max-height class for the stream pane. */
  maxHeight?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[11px] text-text-secondary">{label}</span>
      </div>
      {streamText ? (
        <pre className={`text-[11px] text-text-dim font-mono whitespace-pre-wrap ${maxHeight} overflow-y-auto bg-white/3 rounded-lg p-3 leading-relaxed`}>
          {streamText}
        </pre>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="h-3 w-3/4 bg-white/6 rounded animate-pulse" />
          <div className="h-3 w-2/3 bg-white/6 rounded animate-pulse" />
          <div className="h-3 w-5/6 bg-white/6 rounded animate-pulse" />
        </div>
      )}
    </div>
  );
}
