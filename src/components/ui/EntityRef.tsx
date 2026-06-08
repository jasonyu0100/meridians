'use client';

/**
 * EntityRef — inline citation badge rendered in chat for a `[C-12]`-style
 * annotation, academic-essay style.
 *
 * The assistant writes the entity's natural name followed by its bracketed
 * id (`Aragorn [C-12]`). Rather than print the id, each reference renders as
 * a type-tinted citation number: distinct entities are numbered in order of
 * first appearance across the message (the mapping comes from
 * `CitationNumberContext`, populated by `Markdown`), and repeat mentions of the
 * same entity reuse the same number. The marker's colour signals the entity
 * kind. The id resolves against the active narrative (deterministic keyed
 * lookup, no LLM); hovering reveals a card with the entity's full name, type,
 * id, and detail, and a click navigates the inspector to its detail view (the
 * inspector auto-reveals on a new context — see InspectorPanel).
 *
 * Unresolvable ids render nothing at all — only the entity's natural name is
 * left in the prose — so a hallucinated id never appears as a citation.
 */

import { createContext, useContext, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/state/store';
import { useTheme } from '@/lib/state/theme-context';
import { resolveEntityRef, type EntityRefInfo, type EntityRefKind } from '@/lib/forces/entity-ref';

/**
 * Citation numbering for the message currently being rendered: maps each
 * distinct bracket id to its ordinal (1, 2, 3 …). Provided by `Markdown` after
 * a one-pass scan; null when entity annotation is disabled.
 */
export const CitationNumberContext = createContext<Map<string, number> | null>(null);

/** Per-kind citation styling — a faint type-tinted fill + tinted number, so the
 *  marker's colour signals what kind of entity it cites; brighter on hover.
 *  Dark themes (astral/dark) use light -300 text on a faint fill; the light
 *  theme needs darker -700 text or the numbers wash out (see KIND_BADGE_LIGHT).
 *  The app themes via CSS-variable remaps, not Tailwind `dark:`, so the variant
 *  is chosen at runtime from `useTheme()`. */
const KIND_BADGE: Record<EntityRefKind, string> = {
  character: 'bg-sky-400/15 text-sky-300 hover:bg-sky-400/25 hover:text-sky-200',
  location: 'bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25 hover:text-emerald-200',
  artifact: 'bg-amber-400/15 text-amber-300 hover:bg-amber-400/25 hover:text-amber-200',
  thread: 'bg-violet-400/15 text-violet-300 hover:bg-violet-400/25 hover:text-violet-200',
  scene: 'bg-rose-400/15 text-rose-300 hover:bg-rose-400/25 hover:text-rose-200',
  arc: 'bg-fuchsia-400/15 text-fuchsia-300 hover:bg-fuchsia-400/25 hover:text-fuchsia-200',
  knowledge: 'bg-teal-400/15 text-teal-300 hover:bg-teal-400/25 hover:text-teal-200',
  topic: 'bg-indigo-400/15 text-indigo-300 hover:bg-indigo-400/25 hover:text-indigo-200',
  question: 'bg-cyan-400/15 text-cyan-300 hover:bg-cyan-400/25 hover:text-cyan-200',
};

/** Light-theme citation styling — darker -700 text on a soft tint, so the
 *  numbers read clearly against a light background instead of washing out. */
const KIND_BADGE_LIGHT: Record<EntityRefKind, string> = {
  character: 'bg-sky-500/12 text-sky-700 hover:bg-sky-500/20 hover:text-sky-800',
  location: 'bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-800',
  artifact: 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 hover:text-amber-800',
  thread: 'bg-violet-500/12 text-violet-700 hover:bg-violet-500/20 hover:text-violet-800',
  scene: 'bg-rose-500/12 text-rose-700 hover:bg-rose-500/20 hover:text-rose-800',
  arc: 'bg-fuchsia-500/12 text-fuchsia-700 hover:bg-fuchsia-500/20 hover:text-fuchsia-800',
  knowledge: 'bg-teal-500/12 text-teal-700 hover:bg-teal-500/20 hover:text-teal-800',
  topic: 'bg-indigo-500/12 text-indigo-700 hover:bg-indigo-500/20 hover:text-indigo-800',
  question: 'bg-cyan-500/12 text-cyan-700 hover:bg-cyan-500/20 hover:text-cyan-800',
};

/** Per-kind dot used in the hover-card header. */
const KIND_DOT: Record<EntityRefKind, string> = {
  character: 'bg-sky-400',
  location: 'bg-emerald-400',
  artifact: 'bg-amber-400',
  thread: 'bg-violet-400',
  scene: 'bg-rose-400',
  arc: 'bg-fuchsia-400',
  knowledge: 'bg-teal-400',
  topic: 'bg-indigo-400',
  question: 'bg-cyan-400',
};

const BADGE_BASE =
  'inline-flex items-center justify-center rounded min-w-[1.25em] px-1 mx-0.5 align-baseline text-[0.78em] font-mono font-medium leading-[1.5] tabular-nums';

const CARD_WIDTH = 300;
const CARD_GAP = 6;
const VIEWPORT_PADDING = 8;

type AnchorRect = { top: number; bottom: number; left: number };

/**
 * Hover card, portaled to <body> and fixed-positioned from the badge's
 * bounding rect. Rendering it in a portal escapes the chat panel's scroll
 * `overflow`, which would otherwise clip the card at the panel edges.
 */
function HoverCard({ info, anchor }: { info: EntityRefInfo; anchor: AnchorRect }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer above the badge; flip below when there isn't room.
    let top = anchor.top - h - CARD_GAP;
    if (top < VIEWPORT_PADDING) top = anchor.bottom + CARD_GAP;
    top = Math.max(VIEWPORT_PADDING, Math.min(vh - h - VIEWPORT_PADDING, top));
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(vw - CARD_WIDTH - VIEWPORT_PADDING, anchor.left),
    );
    setPos({ top, left });
  }, [anchor.top, anchor.bottom, anchor.left]);

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      className="pointer-events-none fixed z-9999 rounded-lg border border-white/10 bg-bg-panel/95 px-3 py-2.5 shadow-xl backdrop-blur-xl"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: CARD_WIDTH, opacity: pos ? 1 : 0 }}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[info.kind]}`} />
        <span className="text-[8.5px] uppercase tracking-[0.18em] font-mono text-text-dim/65">
          {info.typeLabel}
        </span>
        <span className="text-[8.5px] font-mono text-text-dim/35">{info.id}</span>
      </div>
      <div className="mt-1.5 text-[12.5px] font-medium leading-snug text-text-primary">
        {info.label}
      </div>
      {info.detail && info.detail !== info.label && (
        <div className="mt-1 text-[11px] leading-snug text-text-secondary/75">
          {info.detail}
        </div>
      )}
      <div className="mt-2 text-[8.5px] uppercase tracking-[0.16em] font-mono text-text-dim/45">
        Click to open in inspector
      </div>
    </div>,
    document.body,
  );
}

export function EntityRef({ id }: { id: string }) {
  const { state, dispatch } = useStore();
  const { theme } = useTheme();
  const info = resolveEntityRef(state.activeNarrative, id);
  const citations = useContext(CitationNumberContext);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  if (!info) {
    // Unknown / unresolvable id — render nothing so a hallucinated id never
    // appears as a citation; the entity's natural name stays in the prose.
    return null;
  }

  // Ordinal for this reference; fall back to the raw id only if the scan didn't
  // see it (shouldn't happen — both read the same text and resolve identically).
  const number = citations?.get(id.trim());
  const marker = number != null ? String(number) : id;

  const showCard = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.top, bottom: r.bottom, left: r.left });
  };

  return (
    <span className="relative inline-block align-baseline">
      <button
        ref={btnRef}
        type="button"
        onClick={() =>
          dispatch({ type: 'SET_INSPECTOR', context: info.inspector })
        }
        onMouseEnter={showCard}
        onMouseLeave={() => setAnchor(null)}
        className={`${BADGE_BASE} cursor-pointer transition-colors ${(theme === 'light' ? KIND_BADGE_LIGHT : KIND_BADGE)[info.kind]}`}
      >
        {marker}
      </button>
      {anchor && <HoverCard info={info} anchor={anchor} />}
    </span>
  );
}
