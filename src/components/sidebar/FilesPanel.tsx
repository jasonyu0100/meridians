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

// Status chip styles — monochromatic when settled (staged / committed),
// tinted into the app palette for the states that need attention. The
// active/processing state uses the violet accent (the engine working),
// not the old amber that fought the theme; ready/failed read as soft
// world-green / fate-red rather than stock Tailwind swatches.
const STATUS_STYLE: Record<SourceFile['status'], { label: string; chip: string }> = {
  committed: { label: 'committed', chip: 'bg-white/8 text-text-dim/80' },
  staged: { label: 'staged', chip: 'bg-white/8 text-text-secondary' },
  converting: { label: 'converting', chip: 'bg-accent/15 text-accent' },
  ready: { label: 'ready', chip: 'bg-emerald-400/12 text-emerald-300/90' },
  failed: { label: 'failed', chip: 'bg-red-400/12 text-red-300/90' },
};

function statusColor(status: SourceFile['status']): string {
  if (status === 'ready') return 'text-emerald-300/90';
  if (status === 'converting') return 'text-accent';
  if (status === 'failed') return 'text-red-300/90';
  return 'text-text-dim/75';
}

// Left-spine colour for a file card, keyed to its lifecycle state so the
// rail reads at a glance: violet while the engine runs, world-green when
// a slice is ready to apply, fate-red on failure, accent otherwise.
function statusAccentVar(status: SourceFile['status']): string {
  if (status === 'ready') return 'var(--color-world)';
  if (status === 'failed') return 'var(--color-fate)';
  return 'var(--accent)';
}

/** Map a file's status to the primary action that should appear on
 *  the card. Returns null when no primary action is meaningful
 *  (converting). The action row also renders Remove + Job as secondary
 *  affordances independent of this. */
function primaryAction(
  file: SourceFile,
  branchId: string | null,
): { kind: 'convert' | 'apply'; label: string } | null {
  if (file.status === 'staged') return { kind: 'convert', label: 'Convert' };
  if (file.status === 'failed') return { kind: 'convert', label: 'Retry' };
  if (file.status === 'ready') {
    return {
      kind: 'apply',
      label: branchId ? 'Extend branch' : 'Extend (no branch)',
    };
  }
  // Text-analysis-origin file: the corpus the world view was extracted from.
  // It's the same artifact an upload+process produces, so it can be added to a
  // timeline like any extended file. Creation retains the assembled slice
  // (extractedRef), so the file offers Extend branch directly — no re-analysis.
  // Legacy origin files created before slices were retained have none yet;
  // offer Convert to extract one from the stored source text.
  if (file.status === 'committed' && file.source === 'analysis') {
    if (file.extractedRef) {
      return { kind: 'apply', label: branchId ? 'Extend branch' : 'Extend (no branch)' };
    }
    return { kind: 'convert', label: 'Convert to timeline slice' };
  }
  return null;
}

const PHASE_LABEL: Partial<Record<AnalysisPhase, string>> = {
  structure: 'Extracting structure',
  plans: 'Extracting plans',
  arcs: 'Wiring arcs',
  reconciliation: 'Reconciling entities',
  finalization: 'Finalising',
  'game-theory': 'Decomposing game theory',
  summaries: 'Summarising worlds',
  variables: 'Extracting variables',
  meta: 'Extracting meta',
  assembly: 'Assembling slice',
};

/** Pipeline phases in execution order. Extension jobs skip narrative-
 *  level phases (meta, summaries) and the two specialty passes
 *  (plans, game-theory) only render when explicitly opted in. The
 *  pip rail filters to whatever's actually scheduled to run. */
const PHASE_ORDER: AnalysisPhase[] = [
  'structure',
  'plans',
  'arcs',
  'reconciliation',
  'finalization',
  'game-theory',
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
  const runsPlans = !!job?.runPlanExtraction;
  const runsGameTheory = !!job?.runGameTheoryExtraction;
  const visiblePhases = PHASE_ORDER.filter((p) => {
    if (p === 'plans' && !runsPlans) return false;
    if (p === 'game-theory' && !runsGameTheory) return false;
    if (isExtension && (p === 'meta' || p === 'summaries')) return false;
    return true;
  });
  const currentIdx = phase ? visiblePhases.indexOf(phase) : -1;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
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
                done ? 'bg-accent/45' : active ? 'bg-accent' : 'bg-white/8'
              }`}
            />
          );
        })}
      </div>
      {isChunkPhase && totalChunks > 0 && (
        <div className="h-0.5 w-full bg-white/6 rounded overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
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
        Open a world view to manage its source files.
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
            const job = f.analysisJobId ? jobById.get(f.analysisJobId) : undefined;
            const phaseLabel =
              f.status === 'converting' && job?.phase ? PHASE_LABEL[job.phase] ?? job.phase : null;
            const primary = primaryAction(f, branchId);
            // Text-analysis-origin files (the corpus a world view was extracted
            // from) get the same affordances as a traditional file addition —
            // they're removable like an 'extend' file, not a frozen record.
            const isAnalysisOrigin = f.source === 'analysis';
            const removable = f.mode === 'extend' || isAnalysisOrigin;
            return (
              <div
                key={f.id}
                className="panel-card group p-3.5"
                style={{ ['--card-accent']: statusAccentVar(f.status) } as React.CSSProperties}
              >
                {/* Meta row: kind on the left, status on the right. */}
                <div className="flex items-baseline justify-between mb-2 text-[9px] uppercase tracking-wider font-mono">
                  <span className="flex items-center gap-1 text-text-dim/65">
                    {f.mode}
                    {isAnalysisOrigin && (
                      <span
                        title="Created from text analysis"
                        aria-label="Created from text analysis"
                        className="text-amber-300/80"
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
                        </svg>
                      </span>
                    )}
                  </span>
                  <span className={statusColor(f.status)}>{STATUS_STYLE[f.status].label}</span>
                </div>

                {/* Title — the click target for source-view. Single line of
                    visual weight; everything else hangs off it. */}
                <button
                  onClick={() => setOpenId(f.id)}
                  className="block text-[13px] text-text-primary font-medium leading-snug text-left hover:underline underline-offset-2 truncate w-full"
                  title="View source text"
                >
                  {f.name}
                </button>

                {/* Stats — one line, no dividers, right-aligned date. */}
                <div className="mt-1 flex items-baseline justify-between text-[10px] text-text-dim/60 font-mono tabular-nums">
                  <span>
                    {formatCount(f.wordCount)} words&nbsp;&nbsp;·&nbsp;&nbsp;{formatCount(f.charCount)} chars
                  </span>
                  <span>{formatDate(f.createdAt)}</span>
                </div>

                {f.status === 'converting' && (
                  <ConvertingProgress job={job} fallbackLabel={phaseLabel ?? 'Converting'} />
                )}

                {f.status === 'failed' && f.error && (
                  <p className="mt-2 text-[10px] text-red-400/75 leading-tight line-clamp-2">
                    {f.error}
                  </p>
                )}

                {/* Action row — circular icon buttons. Primary action
                    (convert / apply) sits left; secondary affordances
                    (remove, open job) hug the right edge. Labels live
                    in the `title` tooltip so the row stays uncluttered. */}
                {(primary || removable || f.analysisJobId) && (
                  <div className="mt-3 flex items-center gap-2">
                    {primary?.kind === 'convert' && (
                      <button
                        onClick={() => handleConvert(f)}
                        title={primary.label}
                        aria-label={primary.label}
                        className="w-8 h-8 rounded-full border border-white/15 bg-white/8 hover:bg-white/15 hover:border-white/30 text-text-primary transition flex items-center justify-center"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="6 4 20 12 6 20 6 4" />
                        </svg>
                      </button>
                    )}
                    {primary?.kind === 'apply' && (
                      <button
                        onClick={() => setApplyFileId(f.id)}
                        disabled={!branchId}
                        title={branchId ? 'Extend the current branch with this file' : 'Select a branch first'}
                        aria-label={primary.label}
                        className="w-8 h-8 rounded-full border border-emerald-400/35 bg-emerald-400/12 hover:bg-emerald-400/20 hover:border-emerald-400/55 text-emerald-300 transition flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-400/12 disabled:hover:border-emerald-400/35"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14M6 13l6 6 6-6" />
                        </svg>
                      </button>
                    )}
                    {f.analysisJobId && (
                      <button
                        onClick={() =>
                          router.push(`/extensions/${narrative.id}?job=${f.analysisJobId}`)
                        }
                        title="Open analysis job"
                        aria-label="Open analysis job"
                        className="ml-auto w-8 h-8 rounded-full border border-white/10 bg-transparent hover:bg-white/10 hover:border-white/25 text-text-dim/65 hover:text-text-primary transition flex items-center justify-center"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </button>
                    )}
                    {removable && (
                      <button
                        onClick={() => void handleRemove(f)}
                        title="Remove file"
                        aria-label="Remove file"
                        className={`w-8 h-8 rounded-full border border-white/10 bg-transparent hover:bg-red-500/15 hover:border-red-400/45 text-text-dim/55 hover:text-red-400 transition flex items-center justify-center ${
                          f.analysisJobId ? '' : 'ml-auto'
                        }`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
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
