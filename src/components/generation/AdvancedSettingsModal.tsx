'use client';
// AdvancedSettingsModal — fine-grained generation control for GMs. One focused
// surface, two mutually-exclusive modes:
//   • Whole arc — one opening location + featured cast for the whole arc.
//   • Per scene — knowing the arc length, stage each scene with its own
//     location, cast, opening transition, and a custom direction.
// Locations are chosen with a searchable, hierarchy-drilling picker; characters
// with a searchable, filterable multi-select — no dropdowns. Pacing presets and
// world-build focus apply to the whole generation regardless of mode.
//
// All settings are controlled by the parent (GeneratePanel), which renders a
// compact live summary beneath its divider and weaves them into the prompt.

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/state/store';
import { useImageUrlMap } from '@/hooks/useAssetUrl';
import type { Character, Location, TimeUnit } from '@/types/narrative';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { PACING_PRESETS, type PacingPreset } from '@/lib/pacing/pacing-markov';
import { IconChevronRight, IconChevronDown, IconSearch, IconCheck, IconClose, IconPlus } from '@/components/icons';

export type SceneSpec = {
  locationId: string | null;
  characterIds: string[];
  direction: string;
  /** Per-scene opening transition (the gap from the previous scene). */
  timeUnit: TimeUnit | 'automatic';
  timeValue: string;
};

const TIME_UNITS = ['automatic', 'minute', 'hour', 'day', 'week', 'month', 'year'] as const;

const ROLE_RANK: Record<string, number> = { anchor: 0, recurring: 1, transient: 2 };
const PROM_RANK: Record<string, number> = { domain: 0, place: 1, margin: 2 };

function shortLabel(name: string): string {
  const m = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m && /[A-Za-z]/.test(m[1]) ? m[1].trim() : name.trim();
}

/** Circular avatar — image, else a letter circle (shared map-annotation style). */
function Circle({ url, name, size, ring }: { url: string | null; name: string; size: number; ring?: boolean }) {
  const base = `rounded-full object-cover shrink-0 ${ring ? 'ring-2 ring-accent' : 'ring-1 ring-white/10'}`;
  // Dynamic data:/blob: avatar at a caller-supplied pixel size — next/image
  // would force a fixed intrinsic size and break the inline sizing.
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt={name} style={{ width: size, height: size }} className={base} draggable={false} />;
  return (
    <div style={{ width: size, height: size }} className={`bg-slate-300 flex items-center justify-center ${base}`}>
      <span className="font-bold leading-none text-slate-600" style={{ fontSize: Math.max(8, Math.round(size * 0.42)) }}>
        {shortLabel(name)[0]?.toUpperCase() ?? '?'}
      </span>
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-white/2 border border-white/8 px-2.5 focus-within:border-white/16">
      <IconSearch size={13} className="text-text-dim/45 shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent py-1.5 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none"
      />
      {value && (
        <button onClick={() => onChange('')} className="text-text-dim/40 hover:text-text-primary shrink-0" title="Clear">
          <IconClose size={12} />
        </button>
      )}
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[10px] uppercase tracking-widest text-text-dim">{children}</span>
);

// ── Location picker — search + hierarchy drill ───────────────────────────────
export function LocationPicker({
  locations, urlFor, value, onChange,
}: {
  locations: Record<string, Location>;
  urlFor: (id: string | null) => string | null;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Location[]>();
    for (const loc of Object.values(locations)) {
      const key = loc.parentId && locations[loc.parentId] ? loc.parentId : null;
      const arr = map.get(key) ?? [];
      arr.push(loc);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (PROM_RANK[a.prominence] ?? 3) - (PROM_RANK[b.prominence] ?? 3) || a.name.localeCompare(b.name));
    }
    return map;
  }, [locations]);

  const ancestry = (id: string): Location[] => {
    const out: Location[] = [];
    const seen = new Set<string>();
    let cur: string | null | undefined = id;
    while (cur && locations[cur] && !seen.has(cur)) { seen.add(cur); out.unshift(locations[cur]); cur = locations[cur].parentId; }
    return out;
  };
  const pathLabel = (id: string) => ancestry(id).map((l) => shortLabel(l.name)).join(' › ');

  const q = query.trim().toLowerCase();
  const crumbs = cursor ? ancestry(cursor) : [];
  const rows = q
    ? Object.values(locations).filter((l) => l.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name))
    : childrenOf.get(cursor) ?? [];

  const hasKids = (id: string) => (childrenOf.get(id)?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/1.5 p-2.5">
      <SearchInput value={query} onChange={setQuery} placeholder="Search locations…" />

      {/* Selected banner */}
      {value && locations[value] && (
        <div className="flex items-center gap-2 rounded-md bg-accent/8 px-2 py-1.5">
          <Circle url={urlFor(value)} name={locations[value].name} size={20} ring />
          <span className="flex-1 min-w-0 truncate text-[11px] text-text-primary">{pathLabel(value)}</span>
          <button onClick={() => onChange(null)} className="text-text-dim/50 hover:text-red-400 shrink-0" title="Clear — any location">
            <IconClose size={12} />
          </button>
        </div>
      )}

      {/* Breadcrumb (hierarchy mode only) */}
      {!q && cursor && (
        <div className="flex items-center gap-1 text-[10px] text-text-dim/60">
          <button onClick={() => setCursor(null)} className="hover:text-text-secondary">All</button>
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1 min-w-0">
              <IconChevronRight size={9} className="text-text-dim/30" />
              <button onClick={() => setCursor(c.id)} className={`truncate max-w-[120px] ${i === crumbs.length - 1 ? 'text-text-secondary' : 'hover:text-text-secondary'}`}>
                {shortLabel(c.name)}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: 200 }}>
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-center text-[10.5px] text-text-dim/40 italic">
            {Object.keys(locations).length === 0 ? 'No locations yet.' : 'No matches.'}
          </p>
        ) : (
          rows.map((loc) => {
            const sel = value === loc.id;
            const drillable = !q && hasKids(loc.id);
            return (
              <div
                key={loc.id}
                className={`group flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer ${sel ? 'bg-accent/10' : 'hover:bg-white/5'}`}
                onClick={() => onChange(loc.id)}
              >
                <Circle url={urlFor(loc.id)} name={loc.name} size={24} ring={sel} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] text-text-primary truncate">{shortLabel(loc.name)}</div>
                  <div className="text-[9px] text-text-dim/45 truncate capitalize">{q ? pathLabel(loc.id) : loc.prominence}</div>
                </div>
                {sel && <IconCheck size={13} className="text-accent shrink-0" />}
                {drillable && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setCursor(loc.id); }}
                    className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-text-dim/40 hover:text-text-primary hover:bg-white/10"
                    title={`Open ${shortLabel(loc.name)}`}
                  >
                    <IconChevronRight size={14} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Character picker — search + filterable multi-select ───────────────────────
function CharacterPicker({
  characters, urlFor, selected, onToggle, onClear,
}: {
  characters: Character[];
  urlFor: (c: Character) => string | null;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const rows = q ? characters.filter((c) => c.name.toLowerCase().includes(q)) : characters;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/1.5 p-2.5">
      <div className="flex items-center gap-2">
        <div className="flex-1"><SearchInput value={query} onChange={setQuery} placeholder="Search characters…" /></div>
        {selected.length > 0 && (
          <button onClick={onClear} className="shrink-0 text-[10px] text-text-dim/60 hover:text-red-400 transition-colors">
            Clear {selected.length}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: 200 }}>
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-center text-[10.5px] text-text-dim/40 italic">
            {characters.length === 0 ? 'No characters yet.' : 'No matches.'}
          </p>
        ) : (
          rows.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onToggle(c.id)}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left ${on ? 'bg-accent/10' : 'hover:bg-white/5'}`}
              >
                <Circle url={urlFor(c)} name={c.name} size={24} ring={on} />
                <span className="flex-1 min-w-0 truncate text-[11.5px] text-text-primary">{c.name}</span>
                <span className="shrink-0 text-[9px] uppercase tracking-wide text-text-dim/40">{c.role}</span>
                {on && <IconCheck size={13} className="text-accent shrink-0" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Transition control ───────────────────────────────────────────────────────
function TransitionRow({
  unit, value, onUnit, onValue,
}: {
  unit: TimeUnit | 'automatic';
  value: string;
  onUnit: (u: TimeUnit | 'automatic') => void;
  onValue: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {unit !== 'automatic' && (
        <input
          type="number"
          step={1}
          value={value}
          onChange={(e) => onValue(e.target.value)}
          placeholder="auto"
          className="w-14 rounded-md px-2 py-1 text-[11px] bg-white/2 border border-white/6 text-text-primary placeholder:text-text-dim focus:border-white/16 outline-none"
        />
      )}
      {TIME_UNITS.map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => { onUnit(u); if (u === 'automatic') onValue(''); }}
          className={`rounded-md px-2.5 py-1 text-[11px] capitalize transition border ${
            unit === u
              ? 'bg-white/10 border-white/20 text-text-primary'
              : 'bg-white/2 border-white/6 text-text-dim hover:bg-white/6 hover:text-text-secondary'
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}

export function AdvancedSettingsModal({
  sceneCount,
  seedLocationId,
  onSeedLocation,
  perSceneCast,
  onPerSceneCast,
  arcCharacterIds,
  onArcCharacters,
  sceneSpecs,
  onSceneSpecs,
  onSceneCount,
  firstSceneTimeUnit,
  onTimeUnit,
  firstSceneTimeValue,
  onTimeValue,
  worldBuildFocusId,
  onWorldBuildFocus,
  pacingEnabled,
  onPickPacingPreset,
  onClose,
}: {
  sceneCount: number;
  seedLocationId: string | null;
  onSeedLocation: (id: string | null) => void;
  perSceneCast: boolean;
  onPerSceneCast: (v: boolean) => void;
  arcCharacterIds: string[];
  onArcCharacters: (ids: string[]) => void;
  sceneSpecs: SceneSpec[];
  onSceneSpecs: (specs: SceneSpec[]) => void;
  onSceneCount: (n: number) => void;
  firstSceneTimeUnit: TimeUnit | 'automatic';
  onTimeUnit: (u: TimeUnit | 'automatic') => void;
  firstSceneTimeValue: string;
  onTimeValue: (v: string) => void;
  worldBuildFocusId: string | null;
  onWorldBuildFocus: (id: string | null) => void;
  pacingEnabled: boolean;
  onPickPacingPreset: (preset: PacingPreset) => void;
  onClose: () => void;
}) {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const locations = useMemo(() => narrative?.locations ?? {}, [narrative]);
  const characters = useMemo(
    () =>
      Object.values(narrative?.characters ?? {}).sort(
        (a, b) => (ROLE_RANK[a.role] ?? 3) - (ROLE_RANK[b.role] ?? 3) || a.name.localeCompare(b.name),
      ),
    [narrative],
  );

  const urlMap = useImageUrlMap(
    useMemo(() => [...Object.values(locations).map((l) => l.imageUrl), ...characters.map((c) => c.imageUrl)], [locations, characters]),
  );
  const urlForChar = (c: Character) => (c.imageUrl ? urlMap.get(c.imageUrl) ?? null : null);
  const urlForLoc = (id: string | null) => {
    const ref = id ? locations[id]?.imageUrl : undefined;
    return ref ? urlMap.get(ref) ?? null : null;
  };

  // Per-scene specs stay length-aligned to sceneCount on read/write.
  const specAt = (i: number): SceneSpec =>
    sceneSpecs[i] ?? { locationId: null, characterIds: [], direction: '', timeUnit: 'automatic', timeValue: '' };
  const setSpec = (i: number, patch: Partial<SceneSpec>) => {
    const next: SceneSpec[] = Array.from({ length: sceneCount }, (_, k) => specAt(k));
    next[i] = { ...next[i], ...patch };
    onSceneSpecs(next);
  };
  const toggleSceneChar = (i: number, id: string) => {
    const cur = specAt(i).characterIds;
    setSpec(i, { characterIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const toggleArcChar = (id: string) =>
    onArcCharacters(arcCharacterIds.includes(id) ? arcCharacterIds.filter((x) => x !== id) : [...arcCharacterIds, id]);

  // Per-scene blocks are an accordion — one open at a time; modular add/remove
  // keeps sceneSpecs and the arc length (sceneCount) in lockstep.
  const [expanded, setExpanded] = useState(0);
  const allSpecs = (): SceneSpec[] => Array.from({ length: sceneCount }, (_, k) => specAt(k));
  const addScene = () => {
    onSceneSpecs([...allSpecs(), { locationId: null, characterIds: [], direction: '', timeUnit: 'automatic', timeValue: '' }]);
    onSceneCount(sceneCount + 1);
    setExpanded(sceneCount);
  };
  const removeScene = (i: number) => {
    onSceneSpecs(allSpecs().filter((_, k) => k !== i));
    onSceneCount(Math.max(1, sceneCount - 1));
    setExpanded((e) => Math.max(0, Math.min(e, sceneCount - 2)));
  };

  const wbEntries = useMemo(() => Object.values(narrative?.worldBuilds ?? {}), [narrative]);

  const sceneSummary = (i: number) => {
    const s = specAt(i);
    const bits: string[] = [];
    if (s.locationId && locations[s.locationId]) bits.push(shortLabel(locations[s.locationId].name));
    if (s.characterIds.length) bits.push(`${s.characterIds.length} cast`);
    if (s.direction.trim()) bits.push('note');
    return bits.join(' · ') || 'free';
  };

  return (
    <Modal onClose={onClose} size="4xl" maxHeight="88vh">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Advanced settings</h2>
          <span className="text-[11px] text-text-dim/50">cast, place, transitions, pacing</span>
        </div>
      </ModalHeader>

      <ModalBody className="p-5 flex flex-col gap-6">
        {/* ── Mode: full-width tab select ──────────────────────────────── */}
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/8 bg-white/2 p-1">
          {([['arc', 'Whole arc'], ['scene', 'Per scene']] as const).map(([val, label]) => {
            const on = (val === 'scene') === perSceneCast;
            return (
              <button
                key={val}
                onClick={() => onPerSceneCast(val === 'scene')}
                className={`rounded-lg py-2 text-[12px] font-medium transition ${on ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-secondary'}`}
              >
                {label}{val === 'scene' ? ` · ${sceneCount}` : ''}
              </button>
            );
          })}
        </div>

        {/* ── Cast & place editor ──────────────────────────────────────── */}
        {!perSceneCast ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] text-text-secondary">Opening location</span>
                <LocationPicker locations={locations} urlFor={urlForLoc} value={seedLocationId} onChange={onSeedLocation} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] text-text-secondary">Featured characters <span className="text-text-dim/45">· need not appear every scene</span></span>
                <CharacterPicker characters={characters} urlFor={urlForChar} selected={arcCharacterIds} onToggle={toggleArcChar} onClear={() => onArcCharacters([])} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-text-secondary">Opening transition</span>
              <TransitionRow unit={firstSceneTimeUnit} value={firstSceneTimeValue} onUnit={onTimeUnit} onValue={onTimeValue} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {Array.from({ length: sceneCount }, (_, i) => {
              const spec = specAt(i);
              const open = expanded === i;
              return (
                <div key={i} className={`rounded-xl border transition ${open ? 'border-accent/30 bg-white/3' : 'border-white/8 bg-white/2'}`}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpanded(open ? -1 : i)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(open ? -1 : i); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left cursor-pointer"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/8 text-[10px] font-bold text-text-secondary shrink-0">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-text-primary">Scene {i + 1}</div>
                      <div className="text-[10px] text-text-dim/50 truncate">{sceneSummary(i)}</div>
                    </div>
                    {sceneCount > 1 && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); removeScene(i); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeScene(i); } }}
                        className="shrink-0 flex h-6 w-6 items-center justify-center rounded-md text-text-dim/40 hover:text-red-400 hover:bg-white/5"
                        title="Remove scene"
                      >
                        <IconClose size={13} />
                      </span>
                    )}
                    <IconChevronDown size={14} className={`shrink-0 text-text-dim/40 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </div>
                  {open && (
                    <div className="flex flex-col gap-3 px-3.5 pb-3.5 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] text-text-dim/60">Location</span>
                          <LocationPicker locations={locations} urlFor={urlForLoc} value={spec.locationId} onChange={(id) => setSpec(i, { locationId: id })} />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] text-text-dim/60">Characters</span>
                          <CharacterPicker characters={characters} urlFor={urlForChar} selected={spec.characterIds} onToggle={(id) => toggleSceneChar(i, id)} onClear={() => setSpec(i, { characterIds: [] })} />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[10px] text-text-dim/60">{i === 0 ? 'Opening transition' : 'Gap from previous scene'}</span>
                        <TransitionRow unit={spec.timeUnit} value={spec.timeValue} onUnit={(u) => setSpec(i, { timeUnit: u })} onValue={(v) => setSpec(i, { timeValue: v })} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[10px] text-text-dim/60">Custom direction</span>
                        <textarea
                          value={spec.direction}
                          onChange={(e) => setSpec(i, { direction: e.target.value })}
                          rows={3}
                          placeholder="What should happen in this scene — the beat, the turn, the reveal… (optional)"
                          className="w-full resize-none rounded-md bg-white/2 border border-white/8 px-2.5 py-2 text-[11px] text-text-primary placeholder:text-text-dim/40 focus:border-white/16 outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <button
              onClick={addScene}
              className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-white/12 text-[11px] text-text-dim hover:text-text-primary hover:border-white/20 hover:bg-white/2 transition-colors"
            >
              <IconPlus size={13} /> Add scene
            </button>
          </div>
        )}

        {/* ── General settings (apply to the whole generation) ─────────── */}
        {(pacingEnabled || wbEntries.length > 0) && (
          <div className="flex items-center gap-2 pt-1">
            <div className="h-px flex-1 bg-white/8" />
            <Label>General</Label>
            <div className="h-px flex-1 bg-white/8" />
          </div>
        )}

        {/* ── Pacing presets ───────────────────────────────────────────── */}
        {pacingEnabled && (
          <section>
            <Label>Pacing preset</Label>
            <div className="mt-2 grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1">
              {PACING_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => onPickPacingPreset(preset)}
                  className="rounded-lg px-3 py-2 text-left transition border border-white/6 bg-white/2 hover:bg-white/6 hover:border-white/12 flex items-center justify-between gap-2"
                >
                  <span className="text-[11px] font-medium text-text-primary truncate">{preset.name}</span>
                  <span className="text-[10px] text-text-dim/50 shrink-0">{preset.modes.length}s</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-text-dim/45 mt-1.5">Picking a preset sets the scene count and previews the sequence.</p>
          </section>
        )}

        {/* ── World build focus ────────────────────────────────────────── */}
        {wbEntries.length > 0 && (
          <section>
            <Label>World build focus</Label>
            <div className="mt-2 flex flex-col gap-1 max-h-32 overflow-y-auto pr-1">
              {wbEntries.map((wb) => {
                const isSelected = worldBuildFocusId === wb.id;
                return (
                  <button
                    key={wb.id}
                    type="button"
                    onClick={() => onWorldBuildFocus(isSelected ? null : wb.id)}
                    className={`rounded-lg px-3 py-2 text-left transition border ${
                      isSelected ? 'bg-white/10 border-white/20' : 'bg-white/2 border-white/6 hover:bg-white/6 hover:border-white/12'
                    }`}
                  >
                    <p className={`text-xs line-clamp-1 ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}>{wb.summary}</p>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </ModalBody>

      <ModalFooter>
        <div className="flex justify-end w-full">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/12 bg-white/5 px-4 py-1.5 text-[12px] font-medium text-text-primary hover:bg-white/10 transition-colors"
          >
            Done
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
