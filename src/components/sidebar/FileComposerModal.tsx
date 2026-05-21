'use client';

/**
 * FileComposerModal — two-phase composer for extending the current world.
 *
 *  1. **Paste** — operator drops the corpus in. Continue when there's
 *     content under the size cap.
 *  2. **Setup** — title (auto-detected once the LLM call resolves but
 *     manually re-runnable), extraction mode, plan-extraction toggle.
 *     Mirrors the /analysis NewJobSetup shape so the two flows feel the
 *     same. Save stages the file; Save & Convert stages then kicks off
 *     conversion immediately.
 *
 * Lazy LLM call (detectTitleFromText) fires on phase transition and
 * also on the explicit "auto-detect" button so the operator can rerun
 * it after editing the source.
 */

import { useEffect, useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { useStore } from '@/lib/store';
import { stageFile, convertFile } from '@/lib/file-conversion';
import { splitCorpusIntoScenes } from '@/lib/text-analysis';
import { detectTitleFromText } from '@/lib/title-detect';
import { ANALYSIS_MAX_CORPUS_WORDS } from '@/lib/constants';

type Props = {
  onClose: () => void;
};

type ExtractionMode = 'world' | 'full';
type Phase = 'paste' | 'setup';

export function FileComposerModal({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const [phase, setPhase] = useState<Phase>('paste');
  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('full');
  // Both opt-in features default OFF — operators turn them on only
  // when they specifically want vector search (plans) or strategic
  // decomposition (game theory).
  const [extractPlans, setExtractPlans] = useState(false);
  const [runGameTheory, setRunGameTheory] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [busy, setBusy] = useState<false | 'save' | 'convert'>(false);
  const [error, setError] = useState<string | null>(null);

  // Plans + game-theory checkboxes are user-controlled regardless of
  // extraction mode — the downstream runner force-skips them when
  // `extractionMode === 'world'` (no scenes → no plans / games), so
  // the checkbox stays the single source of truth from the operator's
  // perspective.
  const effectiveExtractPlans = extractPlans;

  const trimmedContent = content.trim();
  const wordCount = trimmedContent ? trimmedContent.split(/\s+/).length : 0;
  const tooLarge = wordCount > ANALYSIS_MAX_CORPUS_WORDS;
  const sceneCount = trimmedContent && !tooLarge ? splitCorpusIntoScenes(content).length : 0;
  const canContinue = !!trimmedContent && !tooLarge && !busy;
  const canSubmit = !!narrative && !!trimmedContent && !!name.trim() && !tooLarge && !busy;

  /** Run the LLM title-inference once. Auto-fires on phase change to
   *  'setup'; also reachable via the explicit auto-detect button. */
  const runAutoDetect = async () => {
    if (!trimmedContent || detecting) return;
    setDetecting(true);
    try {
      const detected = await detectTitleFromText(content);
      if (detected) setName(detected);
    } finally {
      setDetecting(false);
    }
  };

  // First-entry auto-detect — fires the moment the operator moves into
  // the setup phase with a still-empty name. Edits later are manual.
  useEffect(() => {
    if (phase !== 'setup') return;
    if (name.trim().length > 0) return;
    void runAutoDetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleSave = async (then: 'save' | 'convert') => {
    if (!narrative || !canSubmit) return;
    setBusy(then);
    setError(null);
    try {
      const file = await stageFile(narrative, name, content, dispatch);
      if (then === 'convert') {
        await convertFile(narrative, file, dispatch, {
          extractionMode,
          runPlanExtraction: effectiveExtractPlans,
          runGameTheoryExtraction: runGameTheory,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <h2 className="text-[13px] font-medium text-text-primary">Add file</h2>
        <span className="text-[10px] text-text-dim/65 ml-2">
          {phase === 'paste' ? 'paste the source' : 'configure the extension'}
        </span>
        <span className="text-[10px] text-text-dim/55 ml-auto font-mono uppercase tracking-wider">
          {phase === 'paste' ? '1 / 2' : '2 / 2'}
        </span>
      </ModalHeader>

      {phase === 'paste' ? (
        <PastePhase
          content={content}
          onChange={setContent}
          wordCount={wordCount}
          sceneCount={sceneCount}
          tooLarge={tooLarge}
        />
      ) : (
        <SetupPhase
          name={name}
          onNameChange={setName}
          detecting={detecting}
          onAutoDetect={runAutoDetect}
          extractionMode={extractionMode}
          onModeChange={setExtractionMode}
          extractPlans={extractPlans}
          onPlansChange={setExtractPlans}
          runGameTheory={runGameTheory}
          onGameTheoryChange={setRunGameTheory}
          sceneCount={sceneCount}
          wordCount={wordCount}
          error={error}
        />
      )}

      <ModalFooter>
        {phase === 'paste' ? (
          <>
            <button
              onClick={onClose}
              className="text-[11px] px-3 py-1.5 rounded-full text-text-dim hover:text-text-secondary transition"
            >
              Cancel
            </button>
            <button
              onClick={() => setPhase('setup')}
              disabled={!canContinue}
              className="text-[11px] px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Continue
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setPhase('paste')}
              disabled={!!busy}
              className="text-[11px] px-3 py-1.5 rounded-full text-text-dim hover:text-text-secondary disabled:opacity-40 transition mr-auto"
            >
              ← Back
            </button>
            <button
              onClick={() => handleSave('save')}
              disabled={!canSubmit}
              className="text-[11px] px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-text-secondary hover:text-text-primary hover:bg-white/8 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => handleSave('convert')}
              disabled={!canSubmit}
              className="text-[11px] px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {busy === 'convert' ? 'Starting…' : 'Save & Convert'}
            </button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}

// ── Phase 1: paste ──────────────────────────────────────────────────────────

function PastePhase({
  content,
  onChange,
  wordCount,
  sceneCount,
  tooLarge,
}: {
  content: string;
  onChange: (v: string) => void;
  wordCount: number;
  sceneCount: number;
  tooLarge: boolean;
}) {
  return (
    <ModalBody>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <label className="block text-[10px] uppercase tracking-wider text-text-dim/75">
            Source text
          </label>
          <span className={`text-[10px] font-mono tabular-nums ${tooLarge ? 'text-red-400/80' : 'text-text-dim/60'}`}>
            {wordCount.toLocaleString()} words
            {sceneCount > 0 && ` · ${sceneCount} scene${sceneCount === 1 ? '' : 's'}`}
            {tooLarge && ` · max ${ANALYSIS_MAX_CORPUS_WORDS.toLocaleString()}`}
          </span>
        </div>
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste the corpus that should extend this world…"
          rows={16}
          className="w-full bg-white/5 border border-border rounded px-3 py-2 text-[12px] text-text-primary font-mono placeholder:text-text-dim focus:outline-none focus:border-white/20 transition-colors resize-y"
          style={{ scrollbarWidth: 'thin' }}
        />
        <p className="text-[10px] text-text-dim/55 leading-relaxed">
          Continue to name the file and choose how the analysis pipeline
          extracts it.
        </p>
      </div>
    </ModalBody>
  );
}

// ── Phase 2: setup ──────────────────────────────────────────────────────────

function SetupPhase({
  name,
  onNameChange,
  detecting,
  onAutoDetect,
  extractionMode,
  onModeChange,
  extractPlans,
  onPlansChange,
  runGameTheory,
  onGameTheoryChange,
  sceneCount,
  wordCount,
  error,
}: {
  name: string;
  onNameChange: (v: string) => void;
  detecting: boolean;
  onAutoDetect: () => void;
  extractionMode: ExtractionMode;
  onModeChange: (m: ExtractionMode) => void;
  extractPlans: boolean;
  onPlansChange: (v: boolean) => void;
  runGameTheory: boolean;
  onGameTheoryChange: (v: boolean) => void;
  sceneCount: number;
  wordCount: number;
  error: string | null;
}) {
  return (
    <ModalBody>
      <div className="space-y-4">
        <div className="flex items-baseline gap-2 text-[10px] font-mono tabular-nums text-text-dim/60">
          <span>{wordCount.toLocaleString()} words</span>
          {sceneCount > 0 && (
            <>
              <span className="text-text-dim/30">·</span>
              <span>
                {sceneCount} scene{sceneCount === 1 ? '' : 's'}
              </span>
            </>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label className="block text-[10px] uppercase tracking-wider text-text-dim/75">
              Name
            </label>
            <button
              type="button"
              onClick={onAutoDetect}
              disabled={detecting}
              className="text-[10px] uppercase tracking-wider font-mono text-text-dim/65 hover:text-text-secondary disabled:opacity-40 transition"
              title="Infer a title from the source text via LLM"
            >
              {detecting ? 'Detecting…' : 'Auto-detect'}
            </button>
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. Chapter 12 draft, interview transcript, market memo"
            className="w-full bg-white/5 border border-border rounded px-3 py-2 text-[12px] text-text-primary placeholder:text-text-dim focus:outline-none focus:border-white/20 transition-colors"
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-text-dim/75 mb-1.5">
            Extraction mode
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                {
                  value: 'full' as const,
                  label: 'World + Scenes',
                  desc: 'Scenes, arcs, and per-batch world commits — appendable as a coherent arc.',
                },
                {
                  value: 'world' as const,
                  label: 'World only',
                  desc: 'Per-batch world commits only — injects knowledge without adding scenes.',
                },
              ]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onModeChange(opt.value)}
                className={`text-left rounded-lg border px-3 py-2.5 transition ${
                  extractionMode === opt.value
                    ? 'border-white/30 bg-white/8'
                    : 'border-white/8 bg-white/2 hover:border-white/16 hover:bg-white/5'
                }`}
              >
                <div
                  className={`text-[11px] font-medium ${extractionMode === opt.value ? 'text-text-primary' : 'text-text-secondary'}`}
                >
                  {opt.label}
                </div>
                <div className="text-[10px] text-text-dim/55 leading-snug mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <OptInToggle
            checked={extractPlans}
            onChange={onPlansChange}
            label="Beat plans"
            hint="Enables vector search + RAG over the slice's beats and propositions."
          />
          <OptInToggle
            checked={runGameTheory}
            onChange={onGameTheoryChange}
            label="Game theory"
            hint="Per-scene strategic decomposition — payoff matrices, Nash, player ELO. Critical for understanding game dynamics; skip for non-strategic worlds."
          />
        </div>

        {error && <p className="text-[11px] text-red-400/80">{error}</p>}
        <p className="text-[10px] text-text-dim/55 leading-relaxed">
          Save stages the file. Save & Convert also runs the analysis pipeline
          immediately — nothing is applied to any branch until you commit.
        </p>
      </div>
    </ModalBody>
  );
}

/** Single opt-in feature toggle — checkbox + label + value-prop hint.
 *  Used for the two specialty extraction passes (plans + game theory),
 *  both default-off. Stacked vertically so the operator reads them as
 *  paired siblings rather than nested options. */
function OptInToggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-3.5 h-3.5 rounded border-white/20 bg-white/5 accent-white/60 cursor-pointer shrink-0"
      />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span
          className={`text-[12px] transition select-none ${
            checked ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'
          }`}
        >
          {label}
        </span>
        <span className="text-[10px] text-text-dim/65 leading-snug">{hint}</span>
      </div>
    </label>
  );
}
