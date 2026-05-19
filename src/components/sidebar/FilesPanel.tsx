'use client';

/**
 * FilesPanel — sidebar list of source files that contributed to this
 * narrative. Monochromatic aesthetic mirroring SurveyPanel: white/5
 * cards, tracking-wider uppercase meta lines, sparing accent reserved
 * for active states (the merge confirmation lives in its own modal).
 *
 * Lifecycle:
 *   staged    → Convert  → converting
 *   converting (engine running — shows progress from the linked AJ)
 *   ready     → Apply    → ApplyExtensionModal → committed
 *   failed    → Retry    → converting
 *   committed (no actions; click to view source)
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { SourceFileModal } from '@/components/sidebar/SourceFileModal';
import { FileComposerModal } from '@/components/sidebar/FileComposerModal';
import { ApplyExtensionModal } from '@/components/sidebar/ApplyExtensionModal';
import { convertFile } from '@/lib/file-conversion';
import { assetManager } from '@/lib/asset-manager';
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

// Status chip styles — monochromatic by default, status colour reserved
// for transient states (converting / ready / failed) so the eye snaps
// to files that need attention.
const STATUS_STYLE: Record<SourceFile['status'], { label: string; chip: string }> = {
  committed: { label: 'committed', chip: 'bg-white/10 text-text-dim/80' },
  staged: { label: 'staged', chip: 'bg-white/10 text-text-secondary' },
  converting: { label: 'converting', chip: 'bg-white/10 text-amber-400/85' },
  ready: { label: 'ready', chip: 'bg-white/10 text-emerald-400/85' },
  failed: { label: 'failed', chip: 'bg-white/10 text-red-400/85' },
};

function statusColor(status: SourceFile['status']): string {
  if (status === 'ready') return 'text-emerald-400/85';
  if (status === 'converting') return 'text-amber-400/85';
  if (status === 'failed') return 'text-red-400/85';
  return 'text-text-dim/75';
}

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

/** Pipeline phases in execution order. Extension jobs skip the
 *  narrative-level phases (meta, summaries) and may skip plans, so the
 *  pip rail is filtered to match what actually runs. */
const PHASE_ORDER: AnalysisPhase[] = [
  'structure',
  'plans',
  'arcs',
  'reconciliation',
  'finalization',
  'summaries',
  'meta',
  'assembly',
];

/** Per-card progress strip for `status === 'converting'`. Monochrome
 *  pip rail with a chunk fraction during chunk-iterating phases. */
function ConvertingProgress({ job, fallbackLabel }: { job?: AnalysisJob; fallbackLabel: string }) {
  const phase: AnalysisPhase | undefined = job?.phase;
  const label = phase ? PHASE_LABEL[phase] ?? phase : fallbackLabel;
  const isChunkPhase = phase === 'structure' || phase === 'plans';
  const completedChunks = job ? (job.results ?? []).filter((r) => r !== null).length : 0;
  const totalChunks = job?.chunks.length ?? 0;
  const isExtension = job?.kind === 'extend';
  const skipsPlans = job?.skipPlanExtraction;
  const visiblePhases = PHASE_ORDER.filter((p) => {
    if (skipsPlans && p === 'plans') return false;
    if (isExtension && (p === 'meta' || p === 'summaries')) return false;
    return true;
  });
  const currentIdx = phase ? visiblePhases.indexOf(phase) : -1;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-amber-400/85 animate-pulse shrink-0" />
        <span className="text-[10px] text-text-dim/80 truncate flex-1 min-w-0">{label}…</span>
        {isChunkPhase && totalChunks > 0 && (
          <span className="text-[9px] text-text-dim/60 font-mono tabular-nums shrink-0">
            {completedChunks}/{totalChunks}
          </span>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        {visiblePhases.map((p, i) => {
          const done = currentIdx >= 0 && i < currentIdx;
          const active = i === currentIdx;
          return (
            <div
              key={p}
              title={PHASE_LABEL[p] ?? p}
              className={`h-0.5 flex-1 rounded ${
                done ? 'bg-white/30' : active ? 'bg-amber-400/85' : 'bg-white/8'
              }`}
            />
          );
        })}
      </div>
      {isChunkPhase && totalChunks > 0 && (
        <div className="h-0.5 w-full bg-white/6 rounded overflow-hidden">
          <div
            className="h-full bg-amber-400/70 transition-all"
            style={{ width: `${Math.min(100, (completedChunks / totalChunks) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function FilesPanel() {
  const { state, dispatch } = useStore();
  const router = useRouter();
  const narrative = state.activeNarrative;
  const branchId = state.viewState.activeBranchId;
  const [openId, setOpenId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [applyFileId, setApplyFileId] = useState<string | null>(null);

  const files = useMemo<SourceFile[]>(() => {
    if (!narrative) return [];
    return Object.values(narrative.files ?? {}).sort((a, b) => a.createdAt - b.createdAt);
  }, [narrative]);

  // Index analysis jobs by id so converting cards can show live phase.
  const jobById = useMemo(() => {
    const map = new Map<string, AnalysisJob>();
    for (const j of state.analysisJobs) map.set(j.id, j);
    return map;
  }, [state.analysisJobs]);

  const openFile = files.find((f) => f.id === openId) ?? null;
  const applyFile = files.find((f) => f.id === applyFileId) ?? null;

  if (!narrative) {
    return (
      <div className="p-4 text-[11px] text-text-dim">
        Open a narrative to manage its source files.
      </div>
    );
  }

  const handleConvert = (file: SourceFile) => {
    if (!narrative) return;
    void convertFile(narrative, file, dispatch);
  };

  /** Hard-delete a file: drop the metadata + the text asset. Any
   *  branches that already absorbed this file's slice keep their merged
   *  entities — Apply is irreversible at the branch level. */
  const handleRemove = async (file: SourceFile) => {
    if (!narrative) return;
    try {
      await assetManager.deleteText(file.contentRef);
      if (file.extractedRef) await assetManager.deleteText(file.extractedRef);
    } catch {
      // Best-effort cleanup — the file record is still removed below.
    }
    dispatch({ type: 'DELETE_SOURCE_FILE', narrativeId: narrative.id, fileId: file.id });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar — mirrors SurveyPanel's count + "+ New" pattern. */}
      <div className="shrink-0 px-3 py-2 border-b border-white/8 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-text-dim/70">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <button
          onClick={() => setComposerOpen(true)}
          className="ml-auto text-[11px] px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-text-primary transition-colors"
        >
          + Add
        </button>
      </div>

      {files.length === 0 ? (
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col items-center justify-center p-8 text-center gap-2">
          <svg className="w-8 h-8 text-text-dim/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
          <p className="text-[11px] text-text-dim/80">Extend this world with a source file.</p>
          <p className="text-[10px] text-text-dim/50 max-w-xs leading-relaxed">
            Tap <span className="text-text-secondary">+ Add</span> to attach a corpus.
            The same analysis pipeline runs on it; once ready, you can append the
            slice onto the active branch.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-3" style={{ scrollbarWidth: 'thin' }}>
          {files.map((f) => {
            const style = STATUS_STYLE[f.status];
            const job = f.analysisJobId ? jobById.get(f.analysisJobId) : undefined;
            const phaseLabel = f.status === 'converting' && job?.phase ? PHASE_LABEL[job.phase] ?? job.phase : null;
            const commitsByBranch = f.commits ?? {};
            const branchCount = Object.keys(commitsByBranch).length;
            const onActiveBranch = branchId ? commitsByBranch[branchId] : undefined;
            const totalScenes = Object.values(commitsByBranch).reduce(
              (sum, c) => sum + c.sceneIds.length,
              0,
            );
            return (
              <div
                key={f.id}
                className="group w-full rounded-lg border border-white/5 bg-white/3 hover:bg-white/6 hover:border-white/10 transition-colors p-3"
              >
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[9px] uppercase tracking-wider text-text-dim/70 font-mono">
                    {f.mode}
                  </span>
                  {onActiveBranch && (
                    <span className="text-[9px] uppercase tracking-wider text-emerald-400/85 font-mono">
                      · on branch
                    </span>
                  )}
                  <span className={`text-[9px] uppercase tracking-wider font-mono ml-auto ${statusColor(f.status)}`}>
                    {style.label}
                  </span>
                </div>
                <button
                  onClick={() => setOpenId(f.id)}
                  className="text-[12px] text-text-primary leading-snug text-left w-full hover:underline underline-offset-2 truncate"
                  title="View source text"
                >
                  {f.name}
                </button>
                <div className="mt-1.5 flex items-baseline gap-2 text-[10px] text-text-dim/70 font-mono tabular-nums">
                  <span>{formatCount(f.wordCount)} words</span>
                  <span className="text-text-dim/30">·</span>
                  <span>{formatCount(f.charCount)} chars</span>
                  <span className="text-text-dim/30 ml-auto">·</span>
                  <span>{formatDate(f.createdAt)}</span>
                </div>

                {f.status === 'converting' && (
                  <ConvertingProgress job={job} fallbackLabel={phaseLabel ?? 'Converting'} />
                )}

                {f.status === 'failed' && f.error && (
                  <p className="mt-1.5 text-[10px] text-red-400/75 leading-tight line-clamp-2">{f.error}</p>
                )}

                {/* Commit ledger — per-branch summary when the slice has
                    landed somewhere. */}
                {branchCount > 0 && (
                  <p className="mt-1.5 text-[9px] uppercase tracking-wider text-text-dim/55 font-mono">
                    applied to {branchCount} branch{branchCount === 1 ? '' : 'es'} · {totalScenes} scene{totalScenes === 1 ? '' : 's'}
                  </p>
                )}

                {/* Action row. Apply is gated by the active branch having
                    no commit for this file yet — re-apply is possible on
                    different branches, but not on the same branch twice. */}
                <div className="mt-2 flex items-center gap-2">
                  {f.status === 'staged' && (
                    <button
                      onClick={() => handleConvert(f)}
                      className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-text-primary transition"
                    >
                      Convert
                    </button>
                  )}
                  {f.status === 'failed' && (
                    <button
                      onClick={() => handleConvert(f)}
                      className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-text-primary transition"
                    >
                      Retry
                    </button>
                  )}
                  {f.status === 'ready' && !onActiveBranch && (
                    <button
                      onClick={() => setApplyFileId(f.id)}
                      disabled={!branchId}
                      title={branchId ? 'Open the merge modal' : 'Select a branch first'}
                      className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      Apply to current branch
                    </button>
                  )}
                  {f.status === 'ready' && onActiveBranch && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-400/10 text-emerald-400/85 cursor-default">
                      Applied here
                    </span>
                  )}
                  {f.mode === 'extend' && (
                    <button
                      onClick={() => void handleRemove(f)}
                      className="text-[10px] px-2 py-0.5 rounded text-text-dim/60 hover:text-red-400/85 transition"
                      title="Remove this file (branches that absorbed it keep their content)"
                    >
                      Remove
                    </button>
                  )}
                  {f.analysisJobId && (
                    <button
                      onClick={() =>
                        router.push(`/extensions/${narrative.id}?job=${f.analysisJobId}`)
                      }
                      className="text-[9px] uppercase tracking-wider font-mono text-text-dim/60 hover:text-text-secondary transition ml-auto"
                      title="Open the conversion job in the extension runner"
                    >
                      job ↗
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openFile && (
        <SourceFileModal key={openFile.id} file={openFile} onClose={() => setOpenId(null)} />
      )}
      {composerOpen && <FileComposerModal onClose={() => setComposerOpen(false)} />}
      {applyFile && (
        <ApplyExtensionModal
          key={applyFile.id}
          file={applyFile}
          onClose={() => setApplyFileId(null)}
        />
      )}
    </div>
  );
}
