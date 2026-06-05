'use client';
// SlideRegionsModal — configure named regions (sets of arcs) to view scoped
// ("quarterly") slide decks on. Each region is composed of whole arcs; the
// slide dropdown lists saved regions alongside the full-narrative deck.
//
// A region is built by dragging a selection over a VERTICAL TIMELINE of arcs:
// drag across arc blocks to select a contiguous range, or grab the start/end
// handles to adjust either edge — a range-slider over the story's arcs.

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { NarrativeState, Region } from '@/types/narrative';
import { useStore } from '@/lib/state/store';
import { arcsInTimelineOrder, regionSceneSpan } from '@/lib/slides-data';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { IconTrash } from '@/components/icons';

type Props = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  onClose: () => void;
};

/** Distinct colours for already-assigned regions on the timeline (cycled by
 *  region order). Regions partition the arcs — divide and conquer. */
const REGION_PALETTE = ['#8B5CF6', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#F43F5E'];

/** Human label for a region's scene span — "Scenes 5–18 · 14 scenes". */
function spanLabel(narrative: NarrativeState, resolvedKeys: string[], region: Region): string {
  const { count, firstNum, lastNum } = regionSceneSpan(narrative, resolvedKeys, region);
  if (count === 0) return 'No scenes in this branch';
  const range = firstNum === lastNum ? `Scene ${firstNum}` : `Scenes ${firstNum}–${lastNum}`;
  return `${range} · ${count} scene${count === 1 ? '' : 's'}`;
}

export function SlideRegionsModal({ narrative, resolvedKeys, onClose }: Props) {
  const { dispatch } = useStore();
  const regions = useMemo(() => narrative.regions ?? [], [narrative.regions]);
  const arcs = useMemo(() => arcsInTimelineOrder(narrative, resolvedKeys), [narrative, resolvedKeys]);

  // Per-arc scene span, precomputed for the timeline blocks + size bars.
  const arcInfo = useMemo(
    () => arcs.map((a) => ({
      arc: a,
      ...regionSceneSpan(narrative, resolvedKeys, { id: a.id, name: a.name, arcIds: [a.id] }),
    })),
    [arcs, narrative, resolvedKeys],
  );
  const maxCount = useMemo(() => Math.max(1, ...arcInfo.map((x) => x.count)), [arcInfo]);

  // Which saved region owns each arc (first writer wins) + its colour. Owned
  // arcs are locked out of new selections — regions partition the timeline.
  const arcOwner = useMemo(() => {
    const m = new Map<string, { region: Region; color: string }>();
    regions.forEach((r, idx) => {
      const color = REGION_PALETTE[idx % REGION_PALETTE.length];
      for (const aid of r.arcIds) if (!m.has(aid)) m.set(aid, { region: r, color });
    });
    return m;
  }, [regions]);

  const isFree = useCallback((i: number) => i >= 0 && i < arcs.length && !arcOwner.has(arcs[i].id), [arcs, arcOwner]);
  /** The contiguous run of FREE arcs containing i, or null if i is taken. A new
   *  region's selection is confined to one such run (can't cross a taken arc). */
  const freeRunOf = useCallback((i: number): [number, number] | null => {
    if (!isFree(i)) return null;
    let s = i, e = i;
    while (isFree(s - 1)) s--;
    while (isFree(e + 1)) e++;
    return [s, e];
  }, [isFree]);

  // Draft selection over the timeline — a contiguous [startIdx, endIdx] arc
  // range, or null when nothing is selected.
  const [draftName, setDraftName] = useState('');
  // Tracks whether the user has typed a name — once they have, we use their
  // text; otherwise the name is derived from the selected arcs.
  const [nameDirty, setNameDirty] = useState(false);
  const [sel, setSel] = useState<[number, number] | null>(null);

  // Auto-name derived from the selected arcs (single → that arc's name;
  // range → "First – Last"). The user's typed name takes over once set.
  const autoName = useMemo(() => {
    if (!sel) return '';
    const a = arcs[sel[0]];
    const b = arcs[sel[1]];
    if (!a || !b) return '';
    return sel[0] === sel[1] ? a.name : `${a.name} – ${b.name}`;
  }, [sel, arcs]);
  const effectiveName = nameDirty ? draftName : autoName;

  // Active drag: which edge is moving ('new' = fresh anchor drag from a block,
  // 'start'/'end' = a handle resizing one edge), the fixed anchor index, and the
  // free run the selection is confined to (so it never crosses a taken arc).
  const drag = useRef<{ edge: 'new' | 'start' | 'end'; anchor: number; run: [number, number] } | null>(null);
  useEffect(() => {
    const up = () => { drag.current = null; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const startAt = useCallback((i: number) => {
    const run = freeRunOf(i);
    if (!run) return; // taken arc — not selectable
    drag.current = { edge: 'new', anchor: i, run };
    setSel([i, i]);
  }, [freeRunOf]);

  const grabEdge = useCallback((edge: 'start' | 'end') => {
    setSel((prev) => {
      if (prev) {
        const run = freeRunOf(prev[0]) ?? prev;
        drag.current = { edge, anchor: -1, run };
      }
      return prev;
    });
  }, [freeRunOf]);

  // Pointer entered arc block i mid-drag → extend/resize the selection, clamped
  // to the free run so taken arcs can't be swept into the selection.
  const enterAt = useCallback((i: number) => {
    const d = drag.current;
    if (!d) return;
    const ci = Math.max(d.run[0], Math.min(d.run[1], i));
    setSel((prev) => {
      if (d.edge === 'new') return [Math.min(d.anchor, ci), Math.max(d.anchor, ci)];
      if (!prev) return [ci, ci];
      if (d.edge === 'start') return [Math.min(ci, prev[1]), prev[1]];
      return [prev[0], Math.max(ci, prev[0])];
    });
  }, []);

  const save = useCallback((next: Region[]) => {
    dispatch({ type: 'SET_REGIONS', regions: next });
  }, [dispatch]);

  const draftArcIds = useMemo(
    () => (sel ? arcs.slice(sel[0], sel[1] + 1).map((a) => a.id) : []),
    [sel, arcs],
  );
  const draftRegion = useMemo<Region>(
    () => ({ id: 'draft', name: draftName, arcIds: draftArcIds }),
    [draftName, draftArcIds],
  );
  const draftSpan = draftArcIds.length > 0 ? spanLabel(narrative, resolvedKeys, draftRegion) : null;

  const canAdd = effectiveName.trim().length > 0 && draftArcIds.length > 0;
  const addRegion = useCallback(() => {
    if (!canAdd) return;
    save([...regions, { id: `region-${Date.now().toString(36)}`, name: effectiveName.trim(), arcIds: draftArcIds }]);
    setDraftName('');
    setNameDirty(false);
    setSel(null);
  }, [canAdd, effectiveName, draftArcIds, regions, save]);

  const clearDraft = useCallback(() => {
    setSel(null);
    setDraftName('');
    setNameDirty(false);
  }, []);

  const renameRegion = useCallback((id: string, name: string) => {
    save(regions.map((r) => (r.id === id ? { ...r, name } : r)));
  }, [regions, save]);
  const deleteRegion = useCallback((id: string) => {
    save(regions.filter((r) => r.id !== id));
  }, [regions, save]);

  return (
    <Modal onClose={onClose} size="lg" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">Slide deck regions</h2>
          <p className="text-[11px] text-text-dim/70">
            Drag over the arc timeline to build a region — view scoped decks like quarterly reports.
          </p>
        </div>
      </ModalHeader>

      <ModalBody className="flex flex-col gap-5 p-5">
        {/* Existing regions */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-wider text-text-dim/70">Saved regions</h3>
          {regions.length === 0 ? (
            <p className="text-[12px] text-text-dim/60 italic">
              None yet — drag the timeline below to build one.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {regions.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/3 px-3 py-2">
                  <input
                    value={r.name}
                    onChange={(e) => renameRegion(r.id, e.target.value)}
                    className="flex-1 min-w-0 bg-transparent text-[13px] text-text-primary outline-none border-b border-transparent focus:border-white/20"
                  />
                  <span className="text-[10px] text-text-dim/70 font-mono tabular-nums shrink-0">
                    {r.arcIds.length} arc{r.arcIds.length === 1 ? '' : 's'} · {spanLabel(narrative, resolvedKeys, r)}
                  </span>
                  <button
                    onClick={() => deleteRegion(r.id)}
                    title="Delete region"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-text-dim hover:text-red-300 hover:bg-red-500/10 transition-colors"
                  >
                    <IconTrash size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* New region — drag-selectable arc timeline */}
        <section className="flex flex-col gap-3 rounded-lg border border-white/8 bg-white/2 p-3">
          <h3 className="text-[10px] uppercase tracking-wider text-text-dim/70">New region</h3>

          {arcs.length === 0 ? (
            <p className="text-[12px] text-text-dim/60 italic">No arcs in this branch yet.</p>
          ) : (
            <>
              {/* Vertical timeline: a rail with one block per arc. Drag across
                  blocks to select a contiguous range; grab the start/end grips
                  to nudge one edge. */}
              <div className="flex gap-2">
                <div className="w-px bg-white/10 my-1 ml-1.5 shrink-0" aria-hidden />
                <div className="flex-1 flex flex-col select-none rounded-md overflow-hidden border border-white/8 max-h-85 overflow-y-auto">
                  {arcInfo.map(({ arc, count, firstNum, lastNum }, i) => {
                    const owner = arcOwner.get(arc.id);
                    const inSel = !owner && sel !== null && i >= sel[0] && i <= sel[1];
                    const isStart = !owner && sel !== null && i === sel[0];
                    const isEnd = !owner && sel !== null && i === sel[1];
                    return (
                      <div
                        key={arc.id}
                        onPointerDown={(e) => { if (owner) return; e.preventDefault(); startAt(i); }}
                        onPointerEnter={() => enterAt(i)}
                        title={owner ? `In region “${owner.region.name}”` : undefined}
                        style={owner ? { backgroundColor: `${owner.color}1F`, borderLeftColor: owner.color } : undefined}
                        className={`relative flex items-center gap-2.5 h-10 px-2.5 border-l-2 transition-colors ${
                          owner
                            ? 'cursor-not-allowed'
                            : inSel
                              ? 'cursor-pointer bg-accent/12 border-accent'
                              : 'cursor-pointer border-transparent hover:bg-white/5'
                        } ${i > 0 ? 'border-t border-t-white/5' : ''}`}
                      >
                        <span className="text-[10px] font-mono text-text-dim/60 tabular-nums w-9 shrink-0">
                          Arc {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] truncate leading-tight ${owner ? 'text-text-secondary' : 'text-text-primary'}`}>{arc.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <div className="h-1 rounded-full bg-white/10 overflow-hidden" style={{ width: 64 }}>
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${(count / maxCount) * 100}%`, backgroundColor: owner ? owner.color : inSel ? 'var(--color-accent, #818cf8)' : 'rgba(255,255,255,0.3)' }}
                              />
                            </div>
                            <span className="text-[9px] font-mono text-text-dim/50 tabular-nums">
                              {firstNum === lastNum ? `sc ${firstNum}` : `sc ${firstNum}–${lastNum}`}
                            </span>
                          </div>
                        </div>

                        {/* Owned → show its region as a chip; free + selected →
                            edge handles to resize the selection. */}
                        {owner ? (
                          <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium truncate max-w-28"
                            style={{ color: owner.color, backgroundColor: `${owner.color}1F`, border: `1px solid ${owner.color}55` }}
                          >
                            {owner.region.name}
                          </span>
                        ) : (
                          <>
                            {isStart && (
                              <div
                                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); grabEdge('start'); }}
                                title="Drag to move the start"
                                className="absolute -top-1 left-1/2 -translate-x-1/2 w-10 h-2 rounded-full bg-accent cursor-ns-resize shadow ring-2 ring-bg-base"
                              />
                            )}
                            {isEnd && (
                              <div
                                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); grabEdge('end'); }}
                                title="Drag to move the end"
                                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-10 h-2 rounded-full bg-accent cursor-ns-resize shadow ring-2 ring-bg-base"
                              />
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <input
                value={effectiveName}
                onChange={(e) => { setDraftName(e.target.value); setNameDirty(true); }}
                placeholder="Region name (auto-filled from arcs — edit to rename)"
                className="w-full bg-white/5 text-[13px] text-text-primary rounded px-2.5 py-1.5 outline-none border border-white/10 focus:border-white/25 placeholder:text-text-dim/40"
              />

              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-text-dim/70">
                  {sel === null
                    ? 'Drag the timeline to select arcs'
                    : `${sel[1] - sel[0] + 1} arc${sel[1] === sel[0] ? '' : 's'}${draftSpan ? ` · ${draftSpan}` : ''}`}
                </span>
                <div className="flex items-center gap-2">
                  {sel !== null && (
                    <button
                      onClick={clearDraft}
                      className="px-2.5 py-1.5 rounded-lg text-[12px] text-text-dim/70 hover:text-text-primary hover:bg-white/5 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    onClick={addRegion}
                    disabled={!canAdd}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Add region
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </ModalBody>
    </Modal>
  );
}
