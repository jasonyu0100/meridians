'use client';
// RegenerateEmbeddingsModal — embeddings coverage dashboard.
//
// Surfaces what each search engine needs and how close the branch is:
//   • Vector  ← scene plans (propositions) — needs every scene planned, then embedded
//   • Expert  ← curriculum questions       — needs every scene questioned, then embedded
//   • Summaries / Prose are auxiliary embedding pools.
// Each row shows embedding coverage + a one-click "embed missing", and — when
// the underlying content itself is incomplete — a redirect to the Plan or
// Questions surface to generate it first.

import { useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { useBulkEmbed, type EmbedMode, type EmbedStats } from '@/hooks/useBulkEmbed';
import { useStore } from '@/lib/state/store';

type Props = {
  onClose: () => void;
};

type Row = {
  mode: EmbedMode;
  label: string;
  /** Which search engine this pool powers (shown as a chip). */
  powers?: string;
  embedded: number;
  total: number;
  /** Optional content-coverage gate (e.g. scenes planned / questioned). When
   *  it's incomplete, embedding alone can't make the engine usable, so we offer
   *  a redirect to generate the missing content first. */
  coverage?: { covered: number; total: number; label: string; goLabel: string; onGo: () => void };
};

/** A coverage bar — green when complete, amber while incomplete. */
function CoverageBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
      <div
        className={`h-full transition-all duration-300 ${pct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function RegenerateEmbeddingsModal({ onClose }: Props) {
  const { dispatch } = useStore();
  const { isEmbedding, progress, error, computeStats, generateEmbeddings, clearEmbeddings } = useBulkEmbed();
  const [activeMode, setActiveMode] = useState<EmbedMode | 'all' | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // Scope: the active branch's timeline, or every scene across all branches
  // (narrative-wide — needed so Experience scoring covers other branches).
  const [allBranches, setAllBranches] = useState(true);

  const stats = computeStats(allBranches);

  const goTo = (mode: 'plan' | 'learning') => {
    dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode });
    onClose();
  };

  const runEmbed = async (modes: EmbedMode[], tag: EmbedMode | 'all') => {
    setActiveMode(tag);
    await generateEmbeddings(modes, allBranches);
    setActiveMode(null);
  };

  const rows: Row[] = stats
    ? [
        {
          mode: 'propositions',
          label: 'Propositions',
          powers: 'Vector',
          embedded: stats.propositions.total - stats.propositions.missing,
          total: stats.propositions.total,
          coverage: {
            covered: stats.planCoverage.covered,
            total: stats.planCoverage.total,
            label: 'scenes planned',
            goLabel: 'Go to Plan',
            onGo: () => goTo('plan'),
          },
        },
        {
          mode: 'questions',
          label: 'Questions',
          powers: 'Expert',
          embedded: stats.questions.total - stats.questions.missing,
          total: stats.questions.total,
          coverage: {
            covered: stats.questionCoverage.covered,
            total: stats.questionCoverage.total,
            label: 'scenes questioned',
            goLabel: 'Go to Questions',
            onGo: () => goTo('learning'),
          },
        },
        {
          mode: 'summaries',
          label: 'Summaries',
          embedded: stats.summaries.total - stats.summaries.missing,
          total: stats.summaries.total,
        },
        {
          mode: 'prose',
          label: 'Prose',
          embedded: stats.prose.total - stats.prose.missing,
          total: stats.prose.total,
        },
      ]
    : [];

  const totalMissing = stats
    ? stats.propositions.missing + stats.questions.missing + stats.summaries.missing + stats.prose.missing
    : 0;

  return (
    <Modal onClose={onClose} size="lg">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
          <span className="font-semibold text-sm text-text-primary">Embeddings &amp; coverage</span>
        </div>
      </ModalHeader>

      <ModalBody className="p-5 space-y-4">
        <p className="text-xs text-text-dim leading-relaxed">
          Search engines run on embeddings. <span className="text-text-secondary">Vector</span> reads scene
          plans (propositions); <span className="text-text-secondary">Expert</span> reads the curriculum
          question bank. Each pool needs its content generated first, then embedded. Regenerate here after
          imports, manual edits, or failed generation.
        </p>

        {/* Scope toggle — branch vs narrative-wide (all branches) */}
        <div className="flex items-center justify-between rounded-lg border border-white/8 px-3 py-2">
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-text-secondary">Scope</span>
            <span className="text-[9px] text-text-dim/60">
              {allBranches ? 'Every scene across all branches' : 'Active branch timeline only'}
            </span>
          </div>
          <div className="flex items-center rounded-md overflow-hidden border border-white/10">
            <button
              onClick={() => setAllBranches(false)}
              className={`px-2 py-1 text-[10px] font-medium transition-colors ${!allBranches ? 'bg-white/10 text-text-primary' : 'text-text-dim/60 hover:text-text-secondary'}`}
            >
              This branch
            </button>
            <div className="w-px h-4 bg-white/10" />
            <button
              onClick={() => setAllBranches(true)}
              className={`px-2 py-1 text-[10px] font-medium transition-colors ${allBranches ? 'bg-white/10 text-text-primary' : 'text-text-dim/60 hover:text-text-secondary'}`}
            >
              All branches
            </button>
          </div>
        </div>

        {/* Per-pool coverage rows */}
        <div className="space-y-2.5">
          {rows.map((row) => {
            const frac = row.total > 0 ? row.embedded / row.total : 1;
            const missing = row.total - row.embedded;
            const contentIncomplete = !!row.coverage && row.coverage.covered < row.coverage.total;
            const busy = isEmbedding && activeMode === row.mode;
            return (
              <div key={row.mode} className="p-3 bg-bg-surface border border-border rounded space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{row.label}</span>
                    {row.powers && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-300">
                        {row.powers}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-mono text-text-dim">
                    {row.embedded}/{row.total} embedded
                  </span>
                </div>

                <CoverageBar value={frac} />

                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-text-dim">
                    {row.total === 0 ? (
                      <span>Nothing to embed yet.</span>
                    ) : missing > 0 ? (
                      <span className="text-amber-400">{missing} missing</span>
                    ) : (
                      <span className="text-emerald-400">All embedded</span>
                    )}
                    {row.coverage && row.coverage.total > 0 && (
                      <span className={`ml-2 ${contentIncomplete ? 'text-amber-400/80' : 'text-text-dim/70'}`}>
                        · {row.coverage.covered}/{row.coverage.total} {row.coverage.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {contentIncomplete && row.coverage && (
                      <button
                        onClick={row.coverage.onGo}
                        disabled={isEmbedding}
                        className="px-2 py-1 rounded text-[11px] text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
                      >
                        {row.coverage.goLabel}
                      </button>
                    )}
                    <button
                      onClick={() => runEmbed([row.mode], row.mode)}
                      disabled={isEmbedding || missing === 0}
                      className="px-2 py-1 rounded text-[11px] text-text-secondary bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {busy ? 'Embedding…' : 'Embed missing'}
                    </button>
                  </div>
                </div>

                {/* Coverage caption for the gated pools */}
                {contentIncomplete && row.coverage && (
                  <div className="text-[10px] text-text-dim/70 leading-snug">
                    {row.powers} search hides un-{row.coverage.label.split(' ')[1]} scenes until coverage is
                    complete — generate the rest, then embed.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Progress */}
        {isEmbedding && progress && (
          <div className="p-3 bg-bg-surface border border-accent/30 rounded">
            <div className="text-xs text-text-dim mb-2 capitalize">
              Embedding {progress.mode}: {progress.completed}/{progress.total}
            </div>
            <div className="h-2 bg-bg-base rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400">{error}</div>
        )}
      </ModalBody>

      <ModalFooter>
        <div className="flex items-center justify-between w-full">
          <button
            onClick={onClose}
            disabled={isEmbedding}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isEmbedding ? 'Generating…' : 'Close'}
          </button>
          <div className="flex items-center gap-2">
            {/* Clear all embeddings (scene-level: summary / prose / plan centroid),
                two-step confirm. Honours the branch / all-branches scope. */}
            <button
              onClick={async () => {
                if (!confirmClear) { setConfirmClear(true); return; }
                setConfirmClear(false);
                await clearEmbeddings(allBranches);
              }}
              onMouseLeave={() => setConfirmClear(false)}
              disabled={isEmbedding}
              className={`px-3 py-2 rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                confirmClear
                  ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                  : 'bg-white/5 text-text-dim hover:bg-white/10 hover:text-text-secondary'
              }`}
            >
              {confirmClear ? `Confirm clear${allBranches ? ' (all branches)' : ''}` : 'Clear all'}
            </button>
            <button
              onClick={() => runEmbed(missingModes(stats), 'all')}
              disabled={isEmbedding || totalMissing === 0}
              className="px-4 py-2 bg-accent text-white rounded text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isEmbedding && activeMode === 'all'
                ? 'Generating…'
                : totalMissing > 0
                  ? `Embed all missing (${totalMissing})`
                  : 'All embedded'}
            </button>
          </div>
        </div>
      </ModalFooter>
    </Modal>
  );
}

/** The set of pools that still have missing embeddings. */
function missingModes(stats: EmbedStats | null): EmbedMode[] {
  if (!stats) return [];
  const modes: EmbedMode[] = [];
  if (stats.propositions.missing > 0) modes.push('propositions');
  if (stats.questions.missing > 0) modes.push('questions');
  if (stats.summaries.missing > 0) modes.push('summaries');
  if (stats.prose.missing > 0) modes.push('prose');
  return modes;
}
