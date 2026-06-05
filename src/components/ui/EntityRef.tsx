'use client';

/**
 * EntityRef — inline citation badge rendered in chat for a `[C-12]`-style
 * annotation, academic-essay style.
 *
 * The assistant writes the entity's natural name followed by its bracketed
 * id (`Aragorn [C-12]`). This renders the id as a small type-tinted badge
 * that sits beside the name — it supplements the prose, it doesn't replace
 * it. The id is resolved against the active narrative (deterministic keyed
 * lookup, no LLM); hovering reveals a card with the entity's full name,
 * type, and detail, and a click navigates the inspector to its detail view
 * (the inspector auto-reveals on a new context — see InspectorPanel).
 *
 * Unresolvable ids render as an inert muted badge so a hallucinated id can
 * never pose as a real entity.
 */

import { useStore } from '@/lib/state/store';
import { resolveEntityRef, type EntityRefKind } from '@/lib/forces/entity-ref';

/** Per-kind badge styling — faint tinted fill, tinted text, brighter on hover. */
const KIND_BADGE: Record<EntityRefKind, string> = {
  character: 'bg-sky-400/12 text-sky-300/90 hover:bg-sky-400/22 hover:text-sky-200',
  location: 'bg-emerald-400/12 text-emerald-300/90 hover:bg-emerald-400/22 hover:text-emerald-200',
  artifact: 'bg-amber-400/12 text-amber-300/90 hover:bg-amber-400/22 hover:text-amber-200',
  thread: 'bg-violet-400/12 text-violet-300/90 hover:bg-violet-400/22 hover:text-violet-200',
  scene: 'bg-rose-400/12 text-rose-300/90 hover:bg-rose-400/22 hover:text-rose-200',
  arc: 'bg-fuchsia-400/12 text-fuchsia-300/90 hover:bg-fuchsia-400/22 hover:text-fuchsia-200',
  knowledge: 'bg-teal-400/12 text-teal-300/90 hover:bg-teal-400/22 hover:text-teal-200',
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
};

const BADGE_BASE =
  'inline-flex items-center rounded-md px-1.5 py-px mx-0.5 align-baseline text-[0.72em] font-mono font-medium leading-[1.4] tracking-tight';

export function EntityRef({ id }: { id: string }) {
  const { state, dispatch } = useStore();
  const info = resolveEntityRef(state.activeNarrative, id);

  if (!info) {
    // Unknown / unresolvable id — inert muted badge.
    return (
      <span
        className={`${BADGE_BASE} bg-white/5 text-text-dim/50`}
        title={`Unknown reference ${id}`}
      >
        {id}
      </span>
    );
  }

  return (
    <span className="group relative inline-block align-baseline">
      <button
        type="button"
        onClick={() =>
          dispatch({ type: 'SET_INSPECTOR', context: info.inspector })
        }
        title={`${info.typeLabel}: ${info.label} — open in inspector`}
        className={`${BADGE_BASE} cursor-pointer transition-colors ${KIND_BADGE[info.kind]}`}
      >
        {info.id}
      </button>

      {/* Hover card — spans only (valid inline content inside <p>). */}
      <span className="pointer-events-none absolute left-0 bottom-full z-50 mb-1.5 w-max max-w-80 opacity-0 translate-y-1 transition-all duration-100 group-hover:opacity-100 group-hover:translate-y-0">
        <span className="block rounded-lg border border-white/10 bg-bg-panel/95 px-3 py-2.5 shadow-xl backdrop-blur-xl">
          <span className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[info.kind]}`} />
            <span className="text-[8.5px] uppercase tracking-[0.18em] font-mono text-text-dim/65">
              {info.typeLabel}
            </span>
            <span className="text-[8.5px] font-mono text-text-dim/35">{info.id}</span>
          </span>
          <span className="mt-1.5 block text-[12.5px] font-medium leading-snug text-text-primary">
            {info.label}
          </span>
          {info.detail && info.detail !== info.label && (
            <span className="mt-1 block text-[11px] leading-snug text-text-secondary/75">
              {info.detail}
            </span>
          )}
          <span className="mt-2 block text-[8.5px] uppercase tracking-[0.16em] font-mono text-text-dim/45">
            Click to open in inspector
          </span>
        </span>
      </span>
    </span>
  );
}
