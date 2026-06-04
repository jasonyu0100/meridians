'use client';

// BoardAnnotator — overlays HTML labels/annotations onto a generated board/map image.

import { useCallback, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/state/store';
import { useImageUrl } from '@/hooks/useAssetUrl';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import type { Board, MapLabel } from '@/types/narrative';

/** Label text = the English/Latin portion of a name. Strips a trailing
 *  parenthetical translation ("White Stone Pass (白石关)" → "White Stone Pass")
 *  so labels stay in English, matching the map's baked-in title. */
function displayLabel(name: string): string {
  const m = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (m && /[A-Za-z]/.test(m[1])) return m[1].trim();
  return name.trim();
}

/**
 * BoardAnnotator — drag-and-drop label editor for a generated map.
 *
 * The map image is rendered textless except its baked-in parent title. Here the
 * user drags one label per child location onto its region; positions are stored
 * as normalized [0..1] coordinates on `Board.labels`, so they hold up at
 * any display size. Unplaced labels sit in a tray; drag one onto the map to
 * place it, drag a placed label to move it, or ✕ to return it to the tray.
 */
export function BoardAnnotator({ map, onClose }: { map: Board; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const url = useImageUrl(map.imageUrl);

  const imgRef = useRef<HTMLImageElement>(null);
  const [labels, setLabels] = useState<MapLabel[]>(map.labels ?? []);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // The DOM node of the label currently being dragged, plus the latest pointer
  // position and a rAF handle. During a drag we move this node directly (no
  // React re-render per mousemove) and only commit to `labels` state on release.
  const dragElRef = useRef<HTMLDivElement | null>(null);
  const latestPosRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Child locations that still exist (the parent is the baked title, not a chip).
  const children = useMemo(() => {
    if (!narrative) return [];
    return map.locationIds
      .filter((id) => id !== map.rootLocationId && narrative.locations[id])
      .map((id) => ({ id, name: displayLabel(narrative.locations[id].name) }));
  }, [narrative, map.locationIds, map.rootLocationId]);

  const placedIds = useMemo(() => new Set(labels.map((l) => l.locationId)), [labels]);
  const childIds = useMemo(() => new Set(children.map((c) => c.id)), [children]);
  const nameOf = useCallback(
    (id: string) => children.find((c) => c.id === id)?.name ?? id,
    [children],
  );

  // Pointer-drag: live-update the label's normalized position from the image's
  // bounding rect (clamped to the image), document-level listeners so the drag
  // survives the cursor leaving the chip. Matches the codebase's drag pattern.
  const beginDrag = useCallback((locationId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingId(locationId);
    // Coalesce mousemoves to one update per animation frame. While the dragged
    // label is already in the DOM, move it by mutating style directly (no React
    // render); only fall back to a state update to first place a tray label.
    const flush = () => {
      rafRef.current = null;
      const p = latestPosRef.current;
      if (!p) return;
      const el = dragElRef.current;
      if (el) {
        el.style.left = `${p.x * 100}%`;
        el.style.top = `${p.y * 100}%`;
      } else {
        setLabels((prev) => [...prev.filter((l) => l.locationId !== locationId), { locationId, x: p.x, y: p.y }]);
      }
    };
    const onMove = (ev: MouseEvent) => {
      const img = imgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      latestPosRef.current = {
        x: Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)),
      };
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(flush);
    };
    const onUp = () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      const p = latestPosRef.current;
      if (p) setLabels((prev) => [...prev.filter((l) => l.locationId !== locationId), { locationId, x: p.x, y: p.y }]);
      latestPosRef.current = null;
      dragElRef.current = null;
      setDraggingId(null);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const unplace = useCallback((locationId: string) => {
    setLabels((prev) => prev.filter((l) => l.locationId !== locationId));
  }, []);

  const save = useCallback(() => {
    // Keep only labels for members still in scope.
    const kept = labels.filter((l) => childIds.has(l.locationId));
    dispatch({ type: 'SAVE_BOARD', board: { ...map, labels: kept, updatedAt: Date.now() } });
    onClose();
  }, [labels, childIds, dispatch, map, onClose]);

  const unplaced = children.filter((c) => !placedIds.has(c.id));
  const placed = labels.filter((l) => childIds.has(l.locationId));

  return (
    <Modal onClose={onClose} size="4xl" maxHeight="92vh">
      <ModalHeader onClose={onClose}>
        <span className="text-sm text-text-primary truncate">Label map · {map.name}</span>
        <span className="text-[10px] text-text-dim shrink-0">
          {placed.length}/{children.length} placed
        </span>
      </ModalHeader>

      <ModalBody className="p-4 space-y-3">
        <p className="text-[11px] text-text-dim leading-relaxed">
          Drag each location label onto its region on the map. Drag a placed label to
          move it, or ✕ to send it back to the tray. Positions are saved with the map.
        </p>

        {/* Map canvas — relative wrapper sized to the image; labels are absolutely
            positioned by normalized coordinates over it. */}
        <div className="relative inline-block w-full select-none">
          {url ? (
            <img
              ref={imgRef}
              src={url}
              alt={map.name}
              draggable={false}
              className="block w-full h-auto rounded-lg border border-border"
            />
          ) : (
            <div className="w-full aspect-[4/3] rounded-lg border border-border bg-slate-50/3 flex items-center justify-center text-[11px] text-text-dim">
              Loading map image…
            </div>
          )}

          {/* Map title — overlaid, not baked into the image (image models garble
              text). This is the one label always shown; region labels are dragged
              on below. */}
          {url && (
            <div className="absolute top-0 inset-x-0 flex justify-center pt-3 pointer-events-none">
              <span className="px-4 py-1 rounded-full bg-slate-50/80 text-slate-900 text-lg font-bold tracking-wide shadow-[0_1px_6px_rgba(0,0,0,0.45)] ring-1 ring-black/10">
                {displayLabel(map.name)}
              </span>
            </div>
          )}

          {placed.map((lb) => (
            <div
              key={lb.locationId}
              ref={draggingId === lb.locationId ? dragElRef : null}
              onMouseDown={(e) => beginDrag(lb.locationId, e)}
              style={{ left: `${lb.x * 100}%`, top: `${lb.y * 100}%` }}
              className={`group absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-50/80 text-slate-900 text-[11px] font-bold tracking-wide whitespace-nowrap shadow-[0_1px_6px_rgba(0,0,0,0.45)] ring-1 transition-all ${
                draggingId === lb.locationId
                  ? 'ring-2 ring-accent scale-105 cursor-grabbing z-10'
                  : 'ring-black/10 cursor-grab hover:ring-accent/60'
              }`}
            >
              {/* Accent pin dot — anchors the label to its region. */}
              <span>{nameOf(lb.locationId)}</span>
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => unplace(lb.locationId)}
                title="Remove from map"
                className="text-red-500"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Tray of unplaced labels. */}
        <div className="rounded-lg border border-border bg-white/3 p-2">
          <p className="text-[9px] uppercase tracking-wider text-text-dim/60 mb-1.5">
            Unplaced labels {unplaced.length > 0 ? `(${unplaced.length})` : ''}
          </p>
          {unplaced.length === 0 ? (
            <p className="text-[11px] text-emerald-300/80">All locations placed.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {unplaced.map((c) => (
                <div
                  key={c.id}
                  onMouseDown={(e) => beginDrag(c.id, e)}
                  className={`px-2 py-1 rounded bg-bg-elevated border border-border text-[11px] text-text-primary hover:border-accent/50 transition-colors ${
                    draggingId === c.id ? 'cursor-grabbing border-accent' : 'cursor-grab'
                  }`}
                >
                  {c.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          onClick={onClose}
          className="text-[11px] px-3 py-1.5 rounded text-text-dim hover:text-text-primary hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={save}
          className="text-[11px] px-3 py-1.5 rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
        >
          Save labels
        </button>
      </ModalFooter>
    </Modal>
  );
}
