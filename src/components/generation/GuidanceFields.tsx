'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { suggestAutoDirection } from '@/lib/ai';

type Props = {
  direction: string;
  constraints: string;
  onDirectionChange: (value: string) => void;
  onConstraintsChange: (value: string) => void;
  /** Hide suggest buttons */
  hideSuggest?: boolean;
};

/**
 * Reusable direction + constraints fields with story-settings sync.
 *
 * - Defaults to "use story settings" when they exist
 * - Auto-updates parent when story settings change while checkbox is on
 * - Unchecking clears to editable textarea
 * - Suggest generates AI suggestion, unchecks, populates
 * - Re-checking restores current story settings
 */
export function GuidanceFields({
  direction, constraints, onDirectionChange, onConstraintsChange, hideSuggest,
}: Props) {
  const { state } = useStore();
  const narrative = state.activeNarrative;

  const storyDir = narrative?.storySettings?.storyDirection?.trim() ?? '';
  const storyCon = narrative?.storySettings?.storyConstraints?.trim() ?? '';

  // Default to true when story settings exist
  const [useStoryDir, setUseStoryDir] = useState(!!storyDir);
  const [useStoryCon, setUseStoryCon] = useState(!!storyCon);
  const [suggestingDir, setSuggestingDir] = useState(false);

  // Track previous story settings to detect changes
  const prevDirRef = useRef(storyDir);
  const prevConRef = useRef(storyCon);

  // When story settings change and checkbox is on, push new values to parent
  useEffect(() => {
    if (useStoryDir && storyDir !== prevDirRef.current) {
      onDirectionChange(storyDir);
    }
    prevDirRef.current = storyDir;
  }, [storyDir, useStoryDir, onDirectionChange]);

  useEffect(() => {
    if (useStoryCon && storyCon !== prevConRef.current) {
      onConstraintsChange(storyCon);
    }
    prevConRef.current = storyCon;
  }, [storyCon, useStoryCon, onConstraintsChange]);

  // On mount, sync parent if using story settings
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (useStoryDir && storyDir && direction !== storyDir) onDirectionChange(storyDir);
    if (useStoryCon && storyCon && constraints !== storyCon) onConstraintsChange(storyCon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSuggestDirection = useCallback(async () => {
    if (!narrative) return;
    setSuggestingDir(true);
    try {
      // Always use head index for generation operations
      const headIndex = state.resolvedEntryKeys.length - 1;
      const result = await suggestAutoDirection(narrative, state.resolvedEntryKeys, headIndex);
      onDirectionChange(result);
      setUseStoryDir(false);
    } catch (err) {
      console.error('[guidance] suggest direction failed:', err);
    } finally {
      setSuggestingDir(false);
    }
  }, [narrative, state.resolvedEntryKeys, onDirectionChange]);

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
          className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-[11px] text-text-primary w-full h-14 resize-none outline-none placeholder:text-text-dim focus:border-white/16 transition"
        />
      </Field>

      <Field
        label="Constraints"
        storyValue={storyCon}
        useStory={useStoryCon}
        onToggleStory={(checked) => { setUseStoryCon(checked); onConstraintsChange(checked ? storyCon : ''); }}
      >
        <textarea
          value={constraints}
          onChange={(e) => { onConstraintsChange(e.target.value); setUseStoryCon(false); }}
          placeholder="What should NOT happen..."
          className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-[11px] text-text-primary w-full h-12 resize-none outline-none placeholder:text-text-dim focus:border-white/16 transition"
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
