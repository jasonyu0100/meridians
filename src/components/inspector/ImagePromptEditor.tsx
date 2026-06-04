'use client';

// ImagePromptEditor — inline editor for an entity's image prompt with AI suggestion.

import { useState } from 'react';
import { useStore } from '@/lib/state/store';
import { suggestImagePrompt, type ImagePromptEntityKind } from '@/lib/ai';
import { IconSparkle, IconSpinner } from '@/components/icons';
import { InlineText } from './InlineEdit';

type Props = {
  kind: ImagePromptEntityKind;
  entityId: string;
  value: string | undefined;
};

const ACTION_BY_KIND: Record<ImagePromptEntityKind, string> = {
  character: 'SET_CHARACTER_IMAGE_PROMPT',
  location: 'SET_LOCATION_IMAGE_PROMPT',
  artifact: 'SET_ARTIFACT_IMAGE_PROMPT',
};

const ID_FIELD_BY_KIND: Record<ImagePromptEntityKind, string> = {
  character: 'characterId',
  location: 'locationId',
  artifact: 'artifactId',
};

export default function ImagePromptEditor({ kind, entityId, value }: Props) {
  const { state, dispatch } = useStore();
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = (imagePrompt: string) => {
    dispatch({
      type: ACTION_BY_KIND[kind],
      [ID_FIELD_BY_KIND[kind]]: entityId,
      imagePrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  };

  const handleSuggest = async () => {
    if (!state.activeNarrative || suggesting) return;
    setSuggesting(true);
    setError(null);
    try {
      const out = await suggestImagePrompt(kind, state.activeNarrative, entityId);
      persist(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suggest failed');
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-text-dim">Image Prompt</span>
        <button
          type="button"
          onClick={handleSuggest}
          disabled={suggesting}
          title="Rewrite using entity continuity, world summary, and image style"
          className={`flex items-center gap-1 text-[10px] transition-colors disabled:opacity-80 ${
            suggesting ? 'text-text-secondary animate-pulse' : 'text-text-dim hover:text-text-primary'
          }`}
        >
          {suggesting ? <IconSpinner size={10} className="animate-spin" /> : <IconSparkle size={10} />}
          {suggesting ? 'Thinking…' : 'Suggest'}
        </button>
      </div>
      {/* Same click-to-edit primitive as every other inspector field. */}
      <InlineText
        value={value ?? ''}
        onSave={persist}
        multiline
        placeholder="Click to write a prompt, or use Suggest to generate one from this entity's continuity."
        className="text-[11px] text-text-secondary italic leading-relaxed"
        inputClassName="text-[11px] leading-relaxed"
      />
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
