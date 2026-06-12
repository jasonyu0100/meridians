'use client';
// ToastContext — lightweight global toast for brief one-line feedback.
// Usage: const showToast = useToast(); showToast("message", "warning")
//
// The toast layer is PORTALED to <body> and sits on the top z-layer (`z-toast`),
// so it stays visible above every modal, fullscreen takeover, and portaled
// popover — including the high-z surfaces those mount on <body>. It also listens
// for the global `meridians:api-error` window event the LLM call layer
// (lib/ai/api.ts) broadcasts, so any failed / aborted / out-of-credits
// generation surfaces to the user instead of failing silently.

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ToastType = 'warning' | 'success' | 'info' | 'error';
type Toast = { id: number; message: string; type: ToastType };

const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const TYPE_STYLES: Record<ToastType, string> = {
  warning: 'bg-amber-500/15 border-amber-500/30 text-amber-200',
  success: 'bg-green-500/20 border-green-500/30 text-green-300',
  info: 'bg-white/10 border-white/20 text-text-secondary',
  error: 'bg-rose-500/20 border-rose-500/40 text-rose-200',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = 'warning') => {
    const id = Date.now() + Math.random();
    setToasts((t) => {
      // Dedupe: a message already on screen isn't stacked again — a fan-out that
      // all fails on the same cause (e.g. credit exhaustion) shows one toast.
      if (t.some((x) => x.message === message)) return t;
      return [...t, { id, message, type }];
    });
    // Errors linger a little longer than incidental feedback.
    const ttl = type === 'error' ? 6000 : 3500;
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);

  // Bridge the LLM call layer's failure broadcasts into error toasts.
  useEffect(() => {
    const onApiError = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) show(detail.message, 'error');
    };
    window.addEventListener('meridians:api-error', onApiError);
    return () => window.removeEventListener('meridians:api-error', onApiError);
  }, [show]);

  const overlay = (
    <div className="fixed top-14 right-4 z-toast flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`max-w-xs px-3 py-2 rounded-lg border text-[11px] font-medium leading-snug shadow-lg animate-in fade-in slide-in-from-top-1 duration-200 ${TYPE_STYLES[t.type]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      {typeof document !== 'undefined' && createPortal(overlay, document.body)}
    </ToastContext.Provider>
  );
}
