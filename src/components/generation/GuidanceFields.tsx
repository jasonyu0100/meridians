'use client';
// GuidanceFields — direction input field with AI direction suggestion.

import { useState, useCallback, useEffect, useRef } from 'react';
import { useStore } from '@/lib/state/store';
import { suggestAutoDirection } from '@/lib/ai';

type Props = {
  direction: string;
  onDirectionChange: (value: string) => void;
  /** Hide suggest button */
  hideSuggest?: boolean;
  /** Override the Direction "Suggest" action. When provided, the button runs
   *  this instead of the default macro-direction suggestion — the handler owns
   *  populating the direction (and any sibling fields, e.g. an arc title). */
  onSuggestDirection?: () => void | Promise<void>;
};

/**
 * Reusable direction field with story-settings sync.
 *
 * - Defaults to "use story settings" when they exist
 * - Auto-updates parent when story settings change while checkbox is on
 * - Unchecking clears to editable textarea
 * - Suggest generates AI suggestion, unchecks, populates
 * - Re-checking restores current story settings
 */
export function GuidanceFields({
  direction, onDirectionChange, hideSuggest, onSuggestDirection,
}: Props) {
  const { state } = useStore();
  const narrative = state.activeNarrative;

  const storyDir = narrative?.storySettings?.storyDirection?.trim() ?? '';

  // Default to true when story settings exist
  const [useStoryDir, setUseStoryDir] = useState(!!storyDir);
  const [suggestingDir, setSuggestingDir] = useState(false);

  // Track previous story settings to detect changes
  const prevDirRef = useRef(storyDir);

  // When story settings change and checkbox is on, push new values to parent
  useEffect(() => {
    if (useStoryDir && storyDir !== prevDirRef.current) {
      onDirectionChange(storyDir);
    }
    prevDirRef.current = storyDir;
  }, [storyDir, useStoryDir, onDirectionChange]);

  // On mount, sync parent if using story settings
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (useStoryDir && storyDir && direction !== storyDir) onDirectionChange(storyDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSuggestDirection = useCallback(async () => {
    if (!narrative) return;
    setSuggestingDir(true);
    try {
      if (onSuggestDirection) {
        // Caller owns the suggestion (e.g. merge-aware arc title + direction).
        await onSuggestDirection();
        setUseStoryDir(false);
      } else {
        // Always use head index for generation operations
        const headIndex = state.resolvedEntryKeys.length - 1;
        const result = await suggestAutoDirection(narrative, state.resolvedEntryKeys, headIndex);
        onDirectionChange(result);
        setUseStoryDir(false);
      }
    } catch (err) {
      console.error('[guidance] suggest direction failed:', err);
    } finally {
      setSuggestingDir(false);
    }
  }, [narrative, state.resolvedEntryKeys, onDirectionChange, onSuggestDirection]);

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Direction"
        storyValue={storyDir}
        useStory={useStoryDir}
        onToggleStory={(checked) => { setUseStoryDir(checked); onDirectionChange(checked ? storyDir : ''); }}
        suggesting={suggestingDir}
        onSuggest={!hideSuggest ? handleSuggestDirection : undefined}
      >
        <textarea
          value={direction}
          onChange={(e) => { onDirectionChange(e.target.value); setUseStoryDir(false); }}
          placeholder="What should the world view focus on?"
          className="bg-bg-field border border-border rounded-lg px-3 py-2 text-[11px] text-text-primary w-full h-28 resize-none outline-none placeholder:text-text-dim focus:border-white/16 transition"
        />
      </Field>
    </div>
  );
}

function Field({ label, storyValue, useStory, onToggleStory, suggesting, onSuggest, children }: {
  label: string;
  storyValue: string;
  useStory: boolean;
  onToggleStory: (checked: boolean) => void;
  suggesting?: boolean;
  onSuggest?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest text-text-dim">{label}</span>
        {onSuggest && !useStory && (
          <button type="button" disabled={suggesting} onClick={onSuggest}
            className="text-[9px] text-text-dim hover:text-text-secondary transition disabled:opacity-30 uppercase tracking-wider">
            {suggesting ? 'Thinking...' : 'Suggest'}
          </button>
        )}
      </div>
      {useStory && storyValue ? (
        <p className="text-[11px] text-text-dim leading-snug whitespace-pre-wrap px-1">{storyValue}</p>
      ) : (
        children
      )}
      {storyValue && (
        <div className="flex justify-end mt-1">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={useStory} onChange={(e) => onToggleStory(e.target.checked)}
              className="accent-white/50 w-2.5 h-2.5" />
            <span className="text-[9px] text-text-dim">Use world view settings</span>
          </label>
        </div>
      )}
    </div>
  );
}
