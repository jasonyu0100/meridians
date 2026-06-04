'use client';
// NarrativeEditModal — edit narrative meta (title, premise, cover) with AI-assisted refinement.

import { useState } from 'react';
import { useStore } from '@/lib/state/store';
import { apiHeaders } from '@/lib/core/api-headers';
import { assetManager } from '@/lib/storage/asset-manager';
import { useImageUrl } from '@/hooks/useAssetUrl';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { refineNarrativeMeta } from '@/lib/ai/premise';
import { outlineContext } from '@/lib/ai/context';
import type { NarrativeEntry } from '@/types/narrative';

function SpinnerIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`${className} animate-spin`} aria-hidden="true">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}

/** Minimal text-based "SUGGEST" action — matches the in-app suggest pattern
 *  (label-style affordance in the upper-right of a field). Uppercase
 *  tracking-wider; dim by default, lifts on hover. */
function SuggestButton({
  onClick,
  disabled,
  loading,
  title,
}: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="text-[10px] text-text-dim hover:text-text-primary uppercase tracking-wider transition-colors disabled:opacity-30 disabled:hover:text-text-dim disabled:cursor-not-allowed flex items-center gap-1.5"
    >
      {loading && <SpinnerIcon className="w-2.5 h-2.5" />}
      {loading ? 'Suggesting' : 'Suggest'}
    </button>
  );
}

export function NarrativeEditModal({ entry, onClose }: { entry: NarrativeEntry; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.narratives.find((n) => n.id === entry.id);
  const activeFull = state.activeNarrative?.id === entry.id ? state.activeNarrative : null;

  const [title, setTitle] = useState(entry.title);
  const [description, setDescription] = useState(entry.description ?? '');
  const [coverPrompt, setCoverPrompt] = useState('');
  const [coverGenerating, setCoverGenerating] = useState(false);
  const [coverError, setCoverError] = useState('');
  const coverImageRef = narrative?.coverImageUrl ?? entry.coverImageUrl;
  const coverUrl = useImageUrl(coverImageRef);

  const [refining, setRefining] = useState<'title' | 'description' | null>(null);
  const [refineError, setRefineError] = useState('');

  async function handleRefine(kind: 'title' | 'description') {
    if (!activeFull || refining) return;
    setRefining(kind);
    setRefineError('');
    try {
      // Build the same arc-grouped outline the rest of the pipeline reads —
      // scenes + world commits up to the cursor, with the present marked.
      // This is the authoritative narrative context the refinement should
      // ground on; trimmed hand-rolled samples drift from what the work is.
      const outline = outlineContext(
        activeFull,
        state.resolvedEntryKeys,
        state.viewState.currentSceneIndex,
      );
      const result = await refineNarrativeMeta({
        kind,
        narrative: { ...activeFull, title, description },
        outline,
      });
      if (kind === 'title' && result.title) setTitle(result.title);
      if (kind === 'description' && result.description) setDescription(result.description);
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefining(null);
    }
  }

  function handleSave() {
    dispatch({
      type: 'UPDATE_NARRATIVE_META',
      narrativeId: entry.id,
      title: title.trim() || entry.title,
      description: description.trim(),
    });
    onClose();
  }

  async function handleGenerateCover() {
    setCoverGenerating(true);
    setCoverError('');
    try {
      const res = await fetch('/api/generate-cover', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          title,
          description,
          coverPrompt: coverPrompt.trim() || undefined,
          imageStyle: state.activeNarrative?.imageStyle || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Cover generation failed');
      }
      const { imageUrl } = await res.json();

      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error('Failed to download cover image');

      const blob = await imgRes.blob();
      const assetId = await assetManager.storeImage(blob, blob.type, undefined, entry.id);

      dispatch({ type: 'SET_COVER_IMAGE', narrativeId: entry.id, imageUrl: assetId });
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoverGenerating(false);
    }
  }

  function handleRemoveCover() {
    dispatch({ type: 'SET_COVER_IMAGE', narrativeId: entry.id, imageUrl: '' });
  }

  const wandDisabled = !activeFull || refining !== null;
  const wandTitle = activeFull
    ? 'AI refine from the world view\'s accumulated content'
    : 'Open this world view to enable AI refine';

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Edit World View</h2>
          <p className="text-[10px] text-text-dim uppercase tracking-wider">
            Cover, title, and description for this world view
          </p>
        </div>
      </ModalHeader>
      <ModalBody className="p-6">
        <div className="space-y-4">
          {/* Cover */}
          <div>
            <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">Cover</label>
            <div className="flex gap-3">
              {/* Cover image with corner X */}
              <div className="relative shrink-0 group">
                <div className="w-36 rounded-lg overflow-hidden border border-white/10 bg-bg-elevated">
                  {coverUrl ? (
                    <img src={coverUrl} alt="Cover" className="w-full aspect-2/3 object-cover" />
                  ) : (
                    <div className="w-full aspect-2/3 flex items-center justify-center">
                      <span className="text-[9px] text-text-dim/30">No cover</span>
                    </div>
                  )}
                </div>
                {coverUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveCover}
                    title="Remove cover"
                    className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/55 hover:bg-black/75 text-white/85 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3" aria-hidden="true">
                      <path d="M18 6L6 18" />
                      <path d="M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Prompt + circular regenerate */}
              <div className="flex-1 flex gap-2 items-stretch">
                <textarea
                  value={coverPrompt}
                  onChange={(e) => setCoverPrompt(e.target.value)}
                  placeholder="Image prompt — leave empty to auto-generate from the world view"
                  className="flex-1 bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-blue-500/40 resize-none transition-colors"
                />
                <button
                  onClick={handleGenerateCover}
                  disabled={coverGenerating}
                  title={coverUrl ? 'Regenerate cover' : 'Generate cover'}
                  aria-label={coverUrl ? 'Regenerate cover' : 'Generate cover'}
                  className="shrink-0 self-center w-10 h-10 rounded-full border border-white/10 bg-bg-elevated text-text-secondary hover:bg-white/8 hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                >
                  {coverGenerating ? (
                    <SpinnerIcon className="w-4 h-4" />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
                      <path d="M3 12a9 9 0 0 1 15.4-6.36L21 8" />
                      <path d="M21 3v5h-5" />
                      <path d="M21 12a9 9 0 0 1-15.4 6.36L3 16" />
                      <path d="M3 21v-5h5" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <p className="text-[9px] text-text-dim/50 mt-1">
              Cover image used in pickers, sidebars, and shared views.
            </p>
            {coverError && <p className="text-[10px] text-red-400/80 mt-1">{coverError}</p>}
          </div>

          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] text-text-dim uppercase tracking-wider">Title</label>
              <SuggestButton
                onClick={() => handleRefine('title')}
                disabled={wandDisabled}
                loading={refining === 'title'}
                title={wandTitle}
              />
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary outline-none focus:border-blue-500/40 transition-colors"
            />
            <p className="text-[9px] text-text-dim/50 mt-1">
              Short name for this world view. Suggest pulls from the world&rsquo;s own content.
            </p>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] text-text-dim uppercase tracking-wider">Description</label>
              <SuggestButton
                onClick={() => handleRefine('description')}
                disabled={wandDisabled}
                loading={refining === 'description'}
                title={wandTitle}
              />
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-blue-500/40 resize-none transition-colors"
            />
            <p className="text-[9px] text-text-dim/50 mt-1">
              One or two sentences capturing the world view. Suggest pulls from entities, threads, and recent scenes.
            </p>
            {refineError && <p className="text-[10px] text-red-400/80 mt-1">{refineError}</p>}
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onClose}
          className="text-[10px] px-3 py-1.5 rounded-md bg-white/5 text-text-dim hover:text-text-secondary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="text-[10px] px-3 py-1.5 rounded-md bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors font-semibold"
        >
          Save
        </button>
      </ModalFooter>
    </Modal>
  );
}
