'use client';

// MediaField — display + upload + clear for a single entity/board image.
// Uploaded media renders at its NATURAL aspect ratio (uploads needn't match the
// generative defaults — 3:4 / 16:9 / 1:1 / 4:3), and files are stored into the
// per-narrative asset store. Replacing or clearing a local upload drops the
// previous asset so IndexedDB doesn't accumulate orphans.

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { assetManager } from '@/lib/storage/asset-manager';
import { useImageUrl } from '@/hooks/useAssetUrl';
import { IconImport, IconTrash, IconSpinner } from '@/components/icons';
import type { ImageRef } from '@/types/narrative';

type Props = {
  imageRef: ImageRef;
  alt: string;
  /** Short uppercase header, e.g. "Portrait" / "Board". */
  label: string;
  narrativeId: string;
  onSet: (assetId: string) => void;
  onClear: () => void;
  emptyHint?: string;
};

/** A ref points at a locally-stored asset (vs. an external URL or data URL) when
 *  it's one of our `img_…` ids — only those are safe to delete on replace/clear. */
function isLocalAsset(ref: ImageRef): ref is string {
  return !!ref && !ref.startsWith('http://') && !ref.startsWith('https://') && !ref.startsWith('data:');
}

export default function MediaField({
  imageRef,
  alt,
  label,
  narrativeId,
  onSet,
  onClear,
  emptyHint,
}: Props) {
  const resolvedUrl = useImageUrl(imageRef);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingest = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // A File is a Blob — store it directly at whatever dimensions it has.
      const assetId = await assetManager.storeImage(file, file.type, undefined, narrativeId);
      if (isLocalAsset(imageRef)) {
        try { await assetManager.deleteImage(imageRef); } catch { /* best effort */ }
      }
      onSet(assetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }, [imageRef, narrativeId, onSet]);

  const handleClear = useCallback(async () => {
    if (busy) return;
    if (isLocalAsset(imageRef)) {
      try { await assetManager.deleteImage(imageRef); } catch { /* best effort */ }
    }
    onClear();
  }, [busy, imageRef, onClear]);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) ingest(f);
    e.target.value = ''; // let the same file be re-selected after a clear
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) ingest(f);
  };

  return (
    <div
      className="group/media flex flex-col gap-1"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <input ref={inputRef} type="file" accept="image/*" onChange={onPick} className="hidden" />

      {resolvedUrl ? (
        // Image at its natural ratio. All chrome is hover-only and overlaid, so
        // a present image is just the image until you reach for it.
        <div className={`relative rounded-lg ${dragOver ? 'ring-1 ring-accent/60' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- resolvedUrl is a
              client-side object/blob URL for a locally-stored asset (unknown intrinsic
              size, no remote loader); next/image cannot optimize it. */}
          <img
            src={resolvedUrl}
            alt={alt}
            className="w-full h-auto rounded-lg border border-border"
          />
          {/* Label badge — fades in on hover, names which slot this is. */}
          <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/45 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-white/75 opacity-0 backdrop-blur-sm transition-opacity group-hover/media:opacity-100">
            {label}
          </span>
          {/* Replace / Clear — icon-only, top-right, hover-only. */}
          <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/media:opacity-100">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              title={`Replace ${label.toLowerCase()}`}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white/80 backdrop-blur-sm transition-colors hover:text-white disabled:opacity-60"
            >
              {busy ? <IconSpinner size={11} className="animate-spin" /> : <IconImport size={11} />}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={busy}
              title={`Clear ${label.toLowerCase()}`}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white/80 backdrop-blur-sm transition-colors hover:text-red-300 disabled:opacity-60"
            >
              <IconTrash size={11} />
            </button>
          </div>
        </div>
      ) : (
        // Empty — one quiet line. No header, no big placeholder.
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          title={`Upload ${label.toLowerCase()}`}
          className={`flex w-full items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-[10px] transition-colors ${
            dragOver ? 'border-accent/60 bg-accent/5 text-text-secondary' : 'border-white/10 text-text-dim hover:border-white/20 hover:text-text-secondary'
          }`}
        >
          {busy ? <IconSpinner size={10} className="shrink-0 animate-spin" /> : <IconImport size={10} className="shrink-0" />}
          <span className="truncate">{busy ? 'Uploading…' : emptyHint ?? `${label}`}</span>
        </button>
      )}

      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
