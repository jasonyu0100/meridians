'use client';
// LocationSelectorModal — pick a location to seed a generation, by drilling
// through the location hierarchy (Location.parentId) with avatar circles and
// breadcrumb arrows. Deliberately independent of the board/maps: it reads the
// raw parent→child tree, so it works even when no territory maps exist. Avatars
// use the location's generated image when present, else a grey letter fallback
// (the same map-annotation style as the board).

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/state/store';
import { useImageUrlMap } from '@/hooks/useAssetUrl';
import type { Location } from '@/types/narrative';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { IconChevronRight, IconMapPin } from '@/components/icons';

const PROMINENCE_RANK: Record<string, number> = { domain: 0, place: 1, margin: 2 };

/** English/Latin portion of a name; strips a trailing CJK parenthetical
 *  ("White Stone Pass (白石关)" → "White Stone Pass"). Mirrors BoardView. */
function displayLabel(name: string): string {
  const m = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (m && /[A-Za-z]/.test(m[1])) return m[1].trim();
  return name.trim();
}

/** Root → id (inclusive) chain, walking parentId upward (cycle-guarded). */
function ancestry(locations: Record<string, Location>, id: string): Location[] {
  const out: Location[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = id;
  while (cur && locations[cur] && !seen.has(cur)) {
    seen.add(cur);
    out.unshift(locations[cur]);
    cur = locations[cur].parentId;
  }
  return out;
}

/** Circular location avatar — image when available, else a grey letter circle. */
function LocCircle({ url, name, size = 40, ring }: { url: string | null; name: string; size?: number; ring?: boolean }) {
  const cls = `rounded-full object-cover shrink-0 transition-all ${ring ? 'ring-2 ring-accent' : 'ring-1 ring-black/10'}`;
  if (url) {
    return <img src={url} alt={name} style={{ width: size, height: size }} className={cls} draggable={false} />;
  }
  return (
    <div
      style={{ width: size, height: size }}
      className={`bg-slate-300 flex items-center justify-center ${cls}`}
    >
      <span className="font-bold leading-none text-slate-600" style={{ fontSize: Math.max(9, Math.round(size * 0.42)) }}>
        {displayLabel(name)[0]?.toUpperCase() ?? '?'}
      </span>
    </div>
  );
}

export function LocationSelectorModal({
  selectedId: initialSelected,
  onSelect,
  onClose,
}: {
  selectedId?: string | null;
  onSelect: (locationId: string) => void;
  onClose: () => void;
}) {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const locations = useMemo(() => narrative?.locations ?? {}, [narrative]);

  // Children grouped by parent. A location whose parentId is missing/dangling is
  // treated as a root, so nothing is ever orphaned out of view.
  const childrenOf = useMemo(() => {
    const all = Object.values(locations);
    const map = new Map<string | null, Location[]>();
    for (const loc of all) {
      const key = loc.parentId && locations[loc.parentId] ? loc.parentId : null;
      const arr = map.get(key) ?? [];
      arr.push(loc);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort(
        (a, b) =>
          (PROMINENCE_RANK[a.prominence] ?? 3) - (PROMINENCE_RANK[b.prominence] ?? 3) ||
          a.name.localeCompare(b.name),
      );
    }
    return map;
  }, [locations]);

  const urlMap = useImageUrlMap(useMemo(() => Object.values(locations).map((l) => l.imageUrl), [locations]));
  const urlFor = (loc: Location) => (loc.imageUrl ? urlMap.get(loc.imageUrl) ?? null : null);

  // `cursor` is the location whose children fill the grid; null = top level.
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialSelected ?? null);

  const crumbs = cursor ? ancestry(locations, cursor) : [];
  const level = childrenOf.get(cursor) ?? [];
  const selectedLoc = selected ? locations[selected] : null;
  const selectedPath = selected ? ancestry(locations, selected).map((l) => displayLabel(l.name)).join(' › ') : '';

  const hasKids = (id: string) => (childrenOf.get(id)?.length ?? 0) > 0;

  return (
    <Modal onClose={onClose} size="4xl" maxHeight="84vh">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <IconMapPin size={15} />
          <h2 className="text-sm font-semibold text-text-primary">Seed location</h2>
          <span className="text-[11px] text-text-dim/50">drill in to pick where the arc opens</span>
        </div>
      </ModalHeader>

      <ModalBody className="p-5 flex flex-col gap-4">
        {/* Breadcrumb — avatar trail with arrows; each crumb ascends + selects. */}
        <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
          <button
            onClick={() => setCursor(null)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors ${
              cursor === null ? 'text-text-primary bg-white/6' : 'text-text-dim hover:text-text-secondary hover:bg-white/4'
            }`}
          >
            <IconMapPin size={12} /> All locations
          </button>
          {crumbs.map((c) => (
            <span key={c.id} className="flex items-center gap-1.5">
              <IconChevronRight size={11} className="text-text-dim/40" />
              <button
                onClick={() => { setCursor(c.id); setSelected(c.id); }}
                className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors ${
                  selected === c.id ? 'text-text-primary bg-white/6' : 'text-text-dim hover:text-text-secondary hover:bg-white/4'
                }`}
              >
                <LocCircle url={urlFor(c)} name={c.name} size={20} />
                <span className="truncate max-w-[140px]">{displayLabel(c.name)}</span>
              </button>
            </span>
          ))}
        </div>

        {/* Level grid — tap an avatar to select, tap the arrow to drill in. */}
        {level.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-10 text-center text-[12px] text-text-dim/45 italic">
            {Object.keys(locations).length === 0
              ? 'No locations in this world view yet.'
              : 'Nothing nested here — this location has no sub-locations.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 overflow-y-auto pr-1" style={{ maxHeight: '52vh' }}>
            {level.map((loc) => {
              const drillable = hasKids(loc.id);
              const isSel = selected === loc.id;
              return (
                <div
                  key={loc.id}
                  className={`group relative flex items-start gap-3 rounded-xl px-3.5 py-3 cursor-pointer transition-colors ${
                    isSel ? 'bg-accent/8 ring-1 ring-accent/40' : 'bg-white/2 hover:bg-white/5'
                  }`}
                  onClick={() => setSelected(loc.id)}
                >
                  <LocCircle url={urlFor(loc)} name={loc.name} size={44} ring={isSel} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="text-[13px] font-medium text-text-primary leading-snug break-words">{displayLabel(loc.name)}</div>
                    <div className="mt-1 text-[10px] text-text-dim/55">
                      <span className="capitalize">{loc.prominence}</span>
                      {drillable && <> · {childrenOf.get(loc.id)!.length} inside</>}
                    </div>
                  </div>
                  {drillable && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setCursor(loc.id); setSelected(loc.id); }}
                      className="shrink-0 mt-1.5 flex h-7 w-7 items-center justify-center rounded-full text-text-dim/40 hover:text-text-primary hover:bg-white/10 transition-colors"
                      title={`Drill into ${displayLabel(loc.name)}`}
                    >
                      <IconChevronRight size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <div className="flex items-center gap-3 w-full">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {selectedLoc ? (
              <>
                <LocCircle url={urlFor(selectedLoc)} name={selectedLoc.name} size={26} />
                <div className="min-w-0">
                  <div className="text-[12px] text-text-primary truncate">{displayLabel(selectedLoc.name)}</div>
                  {selectedPath && <div className="text-[10px] text-text-dim/50 truncate">{selectedPath}</div>}
                </div>
              </>
            ) : (
              <span className="text-[11px] text-text-dim/50">Select a location to seed the opening scene.</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-text-dim hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => selected && onSelect(selected)}
            disabled={!selected}
            className="shrink-0 rounded-lg border border-accent/40 bg-accent/15 px-3.5 py-1.5 text-[12px] font-medium text-text-primary hover:bg-accent/25 transition-colors disabled:opacity-30"
          >
            Use this location
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
