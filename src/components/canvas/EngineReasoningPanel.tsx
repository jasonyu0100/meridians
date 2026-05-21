'use client';

/**
 * EngineReasoningPanel — single docked surface that mirrors whatever
 * generation pass is currently streaming. Sits at the bottom of the
 * canvas regardless of which view the operator is on, so reasoning
 * (and prose tokens, for prose runs) stays visible while they browse.
 *
 * Sources covered:
 *   - Auto mode    — reads autoRunState.streamText from the store.
 *   - Bulk plan    — listens to `bulk:plan-reasoning` window events.
 *   - Bulk prose   — listens to `bulk:prose-token` window events.
 *   - Bulk game    — listens to `bulk:game-reasoning` window events.
 *   - Manual plan / prose — those views dispatch the same bulk events
 *     so this panel picks them up automatically.
 *
 * Active source = whichever fired most recently. Switches automatically
 * as the operator's actions move through the pipeline. Panel
 * disappears when every source has been idle for the timeout window.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';

type Source = 'auto' | 'plan' | 'prose' | 'game';

type Stream = {
  text: string;
  sceneId?: string;
  updatedAt: number;
};

const TAIL_CHARS = 1400;
const IDLE_MS = 8_000;

const SOURCE_LABEL: Record<Source, string> = {
  auto: 'Auto · reasoning',
  plan: 'Plan · reasoning',
  prose: 'Prose · writing',
  game: 'Game theory · reasoning',
};

const SOURCE_ACCENT: Record<Source, string> = {
  auto: 'bg-amber-400/80 text-amber-300/85',
  plan: 'bg-sky-400/80 text-sky-300/85',
  prose: 'bg-emerald-400/80 text-emerald-300/85',
  game: 'bg-amber-300/80 text-amber-200/85',
};

export function EngineReasoningPanel() {
  const { state } = useStore();
  const auto = state.viewState.autoRunState;

  // Per-source streams. Auto pulls from the store; the rest accumulate
  // from window events. We track lastUpdatedAt per source so the panel
  // can pick the most-recent active one without binding to a specific
  // mode.
  const [planStream, setPlanStream] = useState<Stream | null>(null);
  const [proseStream, setProseStream] = useState<Stream | null>(null);
  const [gameStream, setGameStream] = useState<Stream | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Tick once a second so the idle-out logic re-evaluates and the
  // panel disappears cleanly even when no token has arrived recently.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Bulk + manual event subscriptions. Plan / game emit reasoning
  // tokens (model thinking); prose emits text tokens (actual writing).
  // Both are useful to surface; the panel header tells the operator
  // which one is in flight.
  useEffect(() => {
    function onPlanStart(e: Event) {
      const { sceneId } = (e as CustomEvent).detail ?? {};
      setPlanStream({ text: '', sceneId, updatedAt: Date.now() });
    }
    function onPlanReasoning(e: Event) {
      const { sceneId, token } = (e as CustomEvent).detail ?? {};
      if (typeof token !== 'string') return;
      // Some emitters send accumulated, others a delta — accept both
      // by replacing when the new token is a strict extension of prior.
      setPlanStream((prev) => {
        const prior = prev && prev.sceneId === sceneId ? prev.text : '';
        const next = token.startsWith(prior) ? token : prior + token;
        return { text: next, sceneId, updatedAt: Date.now() };
      });
    }
    function onPlanComplete() {
      // Leave the text intact so the operator can still read it; the
      // idle timeout will hide the panel after IDLE_MS.
      setPlanStream((prev) => (prev ? { ...prev, updatedAt: prev.updatedAt } : prev));
    }
    function onProseStart(e: Event) {
      const { sceneId } = (e as CustomEvent).detail ?? {};
      setProseStream({ text: '', sceneId, updatedAt: Date.now() });
    }
    function onProseToken(e: Event) {
      const { sceneId, token } = (e as CustomEvent).detail ?? {};
      if (typeof token !== 'string') return;
      setProseStream((prev) => {
        const prior = prev && prev.sceneId === sceneId ? prev.text : '';
        return { text: prior + token, sceneId, updatedAt: Date.now() };
      });
    }
    function onGameReasoning(e: Event) {
      const { sceneId, token } = (e as CustomEvent).detail ?? {};
      if (typeof token !== 'string') return;
      setGameStream((prev) => {
        const prior = prev && prev.sceneId === sceneId ? prev.text : '';
        const next = token.startsWith(prior) ? token : prior + token;
        return { text: next, sceneId, updatedAt: Date.now() };
      });
    }
    window.addEventListener('bulk:plan-start', onPlanStart);
    window.addEventListener('bulk:plan-reasoning', onPlanReasoning);
    window.addEventListener('bulk:plan-complete', onPlanComplete);
    window.addEventListener('bulk:prose-start', onProseStart);
    window.addEventListener('bulk:prose-token', onProseToken);
    window.addEventListener('bulk:game-reasoning', onGameReasoning);
    return () => {
      window.removeEventListener('bulk:plan-start', onPlanStart);
      window.removeEventListener('bulk:plan-reasoning', onPlanReasoning);
      window.removeEventListener('bulk:plan-complete', onPlanComplete);
      window.removeEventListener('bulk:prose-start', onProseStart);
      window.removeEventListener('bulk:prose-token', onProseToken);
      window.removeEventListener('bulk:game-reasoning', onGameReasoning);
    };
  }, []);

  // Pick the most recently active source. Auto is its own canonical
  // signal — when auto is RUNNING, it always wins (the cycle's
  // reasoning is the dominant thing happening). Otherwise compare
  // updated-at timestamps.
  const autoActive = !!auto?.isRunning;
  const autoStream: Stream | null = autoActive
    ? {
        text: auto?.streamText ?? '',
        // Treat auto as "just updated" while running so it stays on top.
        updatedAt: now,
      }
    : null;

  let active: { source: Source; stream: Stream } | null = null;
  if (autoStream) {
    active = { source: 'auto', stream: autoStream };
  } else {
    const candidates: Array<[Source, Stream | null]> = [
      ['plan', planStream],
      ['prose', proseStream],
      ['game', gameStream],
    ];
    let best: { source: Source; stream: Stream } | null = null;
    for (const [source, stream] of candidates) {
      if (!stream) continue;
      if (now - stream.updatedAt > IDLE_MS) continue;
      if (!best || stream.updatedAt > best.stream.updatedAt) {
        best = { source, stream };
      }
    }
    active = best;
  }

  // Auto-stick to bottom on every text change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active?.stream.text]);

  if (!active) return null;
  const { source, stream } = active;
  const visible = stream.text.length > TAIL_CHARS ? stream.text.slice(-TAIL_CHARS) : stream.text;
  const status = source === 'auto' ? auto?.statusMessage ?? '' : '';

  return (
    <div
      className="absolute bottom-4 left-4 right-4 z-20 pointer-events-none flex justify-center"
      aria-live="polite"
    >
      <div className="pointer-events-auto w-full max-w-3xl flex flex-col rounded-lg glass overflow-hidden">
        <header className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
          <div className={`w-2 h-2 rounded-full animate-pulse ${SOURCE_ACCENT[source].split(' ')[0]}`} />
          <span className={`text-[10px] uppercase tracking-wider font-mono ${SOURCE_ACCENT[source].split(' ')[1]}`}>
            {SOURCE_LABEL[source]}
          </span>
          {stream.sceneId && (
            <span className="text-[10px] text-text-dim/65 font-mono">· {stream.sceneId}</span>
          )}
          {status && (
            <span className="text-[10px] text-text-dim/70 truncate">{status}</span>
          )}
        </header>
        {visible ? (
          <div
            ref={containerRef}
            className="px-3 py-2 max-h-40 overflow-y-auto text-[11px] text-text-dim/75 leading-relaxed whitespace-pre-wrap font-mono"
            style={{ scrollbarWidth: 'thin' }}
          >
            {visible}
          </div>
        ) : (
          <div className="px-3 py-2 text-[10px] text-text-dim/45 italic">
            Streaming…
          </div>
        )}
      </div>
    </div>
  );
}
