'use client';

/**
 * FilesPanel — sidebar list of source files that contributed to this
 * narrative. Each card surfaces a status chip (committed / staged /
 * converting / ready / failed), char + word counts, a created-at line,
 * and status-appropriate action buttons.
 *
 * Lifecycle:
 *   staged    → Convert  → converting
 *   converting (engine running — shows progress from the linked AJ)
 *   ready     → Apply    → committed (Apply is stubbed in this milestone)
 *   failed    → Retry    → converting
 *   committed (no actions; click to view source)
 */

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { SourceFileModal } from '@/components/sidebar/SourceFileModal';
import { FileComposerModal } from '@/components/sidebar/FileComposerModal';
import { convertFile } from '@/lib/file-conversion';
import type { AnalysisJob, AnalysisPhase, SourceFile } from '@/types/narrative';

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

const STATUS_STYLE: Record<SourceFile['status'], { label: string; chip: string }> = {
  committed: { label: 'committed', chip: 'bg-sky-400/15 text-sky-300' },
  staged: { label: 'staged', chip: 'bg-white/10 text-text-secondary' },
  converting: { label: 'converting', chip: 'bg-amber-400/15 text-amber-300' },
  ready: { label: 'ready', chip: 'bg-emerald-400/15 text-emerald-300' },
  failed: { label: 'failed', chip: 'bg-red-400/15 text-red-300' },
};

const PHASE_LABEL: Partial<Record<AnalysisPhase, string>> = {
  structure: 'Extracting structure',
  plans: 'Extracting plans',
  arcs: 'Wiring arcs',
  reconciliation: 'Reconciling entities',
  finalization: 'Finalising',
  summaries: 'Summarising worlds',
  variables: 'Extracting variables',
  meta: 'Extracting meta',
  assembly: 'Assembling slice',
};

export default function FilesPanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [openId, setOpenId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const files = useMemo<SourceFile[]>(() => {
    if (!narrative) return [];
    return Object.values(narrative.files ?? {}).sort((a, b) => a.createdAt - b.createdAt);
  }, [narrative]);

  // Index analysis jobs by id so converting cards can show live phase
  // labels without re-querying. Extension jobs are removed from state
  // on completion (see analysis-runner) so this map is naturally sparse.
  const jobById = useMemo(() => {
    const map = new Map<string, AnalysisJob>();
    for (const j of state.analysisJobs) map.set(j.id, j);
    return map;
  }, [state.analysisJobs]);

  const openFile = files.find((f) => f.id === openId) ?? null;

  if (!narrative) {
    return (
      <div className="flex-1 flex items-center justify-center px-3">
        <p className="text-xs text-text-dim text-center">Select a narrative</p>
      </div>
    );
  }

  const handleConvert = (file: SourceFile) => {
    if (!narrative) return;
    void convertFile(narrative, file, dispatch);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 border-b border-border px-2 py-1.5 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-text-dim/65">
          {files.length} file{files.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={() => setComposerOpen(true)}
          className="text-[10px] px-2 py-0.5 rounded bg-emerald-400/15 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/25 transition"
        >
          + Add file
        </button>
      </div>

      {files.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-2">
          <p className="text-[11px] text-text-dim">No files yet</p>
          <p className="text-[10px] text-text-dim/60 text-center leading-relaxed">
            Add a file to extend this world. The same text-analysis
            pipeline runs on its corpus and the result is ready to apply
            to the current branch.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-2" style={{ scrollbarWidth: 'thin' }}>
          {files.map((f) => {
            const style = STATUS_STYLE[f.status];
            const job = f.analysisJobId ? jobById.get(f.analysisJobId) : undefined;
            const phaseLabel = f.status === 'converting' && job?.phase ? PHASE_LABEL[job.phase] ?? job.phase : null;
            return (
              <div
                key={f.id}
                className="group w-full text-left rounded-lg border border-white/5 bg-white/3 hover:bg-white/6 hover:border-white/10 transition-colors p-3"
              >
                <button onClick={() => setOpenId(f.id)} className="w-full text-left">
                  <div className="flex items-baseline gap-2 mb-1.5">
                    <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-px rounded ${style.chip}`}>
                      {style.label}
                    </span>
                    <span className="text-[11px] text-text-primary font-medium truncate flex-1 min-w-0">
                      {f.name}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 text-[10px] text-text-dim/75 font-mono tabular-nums">
                    <span>{formatCount(f.wordCount)} words</span>
                    <span className="text-text-dim/30">·</span>
                    <span>{formatCount(f.charCount)} chars</span>
                    <span className="text-text-dim/30 ml-auto">·</span>
                    <span>{formatDate(f.createdAt)}</span>
                  </div>
                </button>

                {phaseLabel && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="w-2.5 h-2.5 border-2 border-amber-400/30 border-t-amber-400/80 rounded-full animate-spin shrink-0" />
                    <span className="text-[10px] text-text-dim/80 truncate">{phaseLabel}…</span>
                  </div>
                )}

                {f.status === 'failed' && f.error && (
                  <p className="mt-1.5 text-[10px] text-red-400/75 leading-tight line-clamp-2">{f.error}</p>
                )}

                {/* Per-status actions */}
                {(f.status === 'staged' || f.status === 'failed' || f.status === 'ready') && (
                  <div className="mt-2 flex gap-1.5">
                    {f.status === 'staged' && (
                      <button
                        onClick={() => handleConvert(f)}
                        className="text-[10px] px-2 py-0.5 rounded bg-emerald-400/15 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/25 transition"
                      >
                        Convert
                      </button>
                    )}
                    {f.status === 'failed' && (
                      <button
                        onClick={() => handleConvert(f)}
                        className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-text-secondary hover:text-text-primary hover:bg-white/8 transition"
                      >
                        Retry
                      </button>
                    )}
                    {f.status === 'ready' && (
                      <button
                        disabled
                        title="Apply lands in the next milestone"
                        className="text-[10px] px-2 py-0.5 rounded bg-emerald-400/10 border border-emerald-400/20 text-emerald-300/60 cursor-not-allowed"
                      >
                        Apply to current branch
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {openFile && <SourceFileModal key={openFile.id} file={openFile} onClose={() => setOpenId(null)} />}
      {composerOpen && <FileComposerModal onClose={() => setComposerOpen(false)} />}
    </div>
  );
}
