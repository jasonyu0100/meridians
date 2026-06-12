'use client';
// Dashboard page — story library + new-analysis entry point with creation wizard and API-key gating.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useStore, SEED_NARRATIVE_IDS } from '@/lib/state/store';
import { useWizard } from '@/lib/state/wizard-context';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { CreationWizard } from '@/components/wizard/CreationWizard';
import ApiKeyModal from '@/components/topbar/ApiKeyModal';
import { StoryCard } from '@/components/cards/StoryCard';
import { StarField } from '@/components/effects/StarField';

export default function DashboardPage() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const { state: wizardState, dispatch: wizardDispatch } = useWizard();
  const access = useFeatureAccess();
  const { userApiKeys, hasOpenRouterKey } = access;
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [analysisText, setAnalysisText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleOpenApiKeys = () => setApiKeysOpen(true);
    window.addEventListener('open-api-keys', handleOpenApiKeys);
    return () => window.removeEventListener('open-api-keys', handleOpenApiKeys);
  }, []);

  const needsKeys = userApiKeys && !hasOpenRouterKey;

  const openCreate = useCallback((prefill?: string) => {
    if (needsKeys) { setApiKeysOpen(true); return; }
    wizardDispatch({ type: 'OPEN', prefill });
  }, [needsKeys, wizardDispatch]);

  const [sortKey, setSortKey] = useState<'recent' | 'name'>('recent');
  const [reversed, setReversed] = useState(false);

  const toggleSort = (key: 'recent' | 'name') => {
    if (key === sortKey) setReversed((r) => !r);
    else { setSortKey(key); setReversed(false); }
  };

  const userNarratives = useMemo(() => {
    const list = state.narratives.filter((e) => !SEED_NARRATIVE_IDS.has(e.id));
    const cmp = sortKey === 'recent'
      ? (a: typeof list[number], b: typeof list[number]) => b.updatedAt - a.updatedAt
      : (a: typeof list[number], b: typeof list[number]) => a.title.localeCompare(b.title);
    const sorted = [...list].sort(cmp);
    return reversed ? sorted.reverse() : sorted;
  }, [state.narratives, sortKey, reversed]);

  return (
    <>
      <div className="min-h-screen bg-bg-base flex flex-col">
        {/* Cosmic background — nebulae + star field */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="cosmos-container absolute inset-0 z-0">
            <div className="nebula nebula-1" />
            <div className="nebula nebula-2" />
            <div className="nebula nebula-3" />
            <div className="cosmos-glow" />
          </div>
          <div className="absolute inset-0 z-10">
            <StarField />
          </div>
        </div>

        <div className="relative z-10 w-full px-4 sm:px-8 pt-8 pb-20">
          {/* Header */}
          <div className="max-w-4xl mx-auto mb-8">
            <h1 className="text-xl font-semibold text-white/90">Dashboard</h1>
          </div>

          {/* Quick Actions */}
          <div className="max-w-4xl mx-auto mb-6 flex items-center gap-2">
            <button
              onClick={() => openCreate()}
              className="flex items-center gap-2 text-xs text-white/50 hover:text-white/90 px-3 py-1.5 rounded-lg border border-white/8 hover:border-white/15 hover:bg-white/4 transition"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create
            </button>
          </div>

          {/* Analysis Input */}
          <div className="max-w-4xl mx-auto mb-12">
            <div className="rounded-xl border border-white/8 bg-white/2 focus-within:border-white/12 transition">
              <textarea
                ref={inputRef}
                value={analysisText}
                onChange={(e) => setAnalysisText(e.target.value)}
                rows={4}
                className="w-full bg-transparent text-white text-sm px-4 pt-4 pb-2 resize-none focus:outline-none placeholder:text-white/25"
                placeholder="Paste text to analyze into a world view..."
              />
              <div className="flex items-center justify-between px-4 pb-3">
                <span className="text-[10px] text-white/20 font-mono">
                  {analysisText.trim() ? `${analysisText.trim().split(/\s+/).length.toLocaleString()} words` : 'text analysis'}
                </span>
                <button
                  onClick={() => {
                    if (!analysisText.trim()) return;
                    if (needsKeys) { setApiKeysOpen(true); return; }
                    import('@/lib/storage/analysis-transfer').then(({ setAnalysisSource }) =>
                      setAnalysisSource(analysisText).then(() => router.push('/analysis?new=1'))
                    );
                  }}
                  disabled={!analysisText.trim()}
                  className="text-white/60 hover:text-white border border-white/10 hover:border-white/20 disabled:opacity-20 text-xs font-medium px-4 py-1.5 rounded-md transition"
                >
                  Analyze
                </button>
              </div>
            </div>
          </div>

          {/* Your World Views */}
          <div className="max-w-4xl mx-auto mb-12">
            <div className="flex items-center gap-3 mb-5">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono">Your World Views</h2>
              <div className="flex-1 h-px bg-white/6" />
              {userNarratives.length > 1 && (
                <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.15em]">
                  {(['recent', 'name'] as const).map((k) => {
                    const active = sortKey === k;
                    const label = k === 'recent'
                      ? (active && reversed ? 'Oldest' : 'Recent')
                      : (active && reversed ? 'Z–A' : 'A–Z');
                    return (
                      <button
                        key={k}
                        onClick={() => toggleSort(k)}
                        className={`px-2 py-1 rounded transition ${active ? 'text-white/80 bg-white/6' : 'text-white/30 hover:text-white/60'}`}
                        title={active ? 'Reverse order' : `Sort by ${k === 'recent' ? 'recency' : 'name'}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {userNarratives.length > 0 ? (
              <div className="flex gap-3 flex-wrap">
                {userNarratives.map((entry, i) => (
                  <StoryCard key={entry.id} entry={entry} index={i} showTimeAgo />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 border border-dashed border-white/8 rounded-lg">
                <p className="text-white/25 text-sm">No world views yet</p>
                <button
                  onClick={() => openCreate()}
                  className="mt-3 text-xs text-white/40 hover:text-white/70 underline underline-offset-2 transition"
                >
                  Create your first narrative
                </button>
              </div>
            )}
          </div>

          {/* Analysis Jobs — exclude world-scoped extension runs (they live on /extensions) */}
          {state.analysisJobs.filter((j) => j.kind !== 'extend').length > 0 && (
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center gap-3 mb-5">
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono">Analysis Jobs</h2>
                <div className="flex-1 h-px bg-white/6" />
              </div>
              <div className="flex flex-col gap-2">
                {state.analysisJobs.filter((j) => j.kind !== 'extend').map((job) => {
                  const completedChunks = job.results.filter((r) => r !== null).length;
                  const totalChunks = job.chunks.length;
                  const progress = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0;
                  return (
                    <div
                      key={job.id}
                      className="group flex items-center gap-4 border border-white/6 rounded-lg px-4 py-3 hover:border-white/12 transition cursor-pointer"
                      onClick={() => router.push(`/analysis?job=${job.id}`)}
                    >
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        job.status === 'completed' ? 'bg-emerald-400' :
                        job.status === 'failed' ? 'bg-red-400' :
                        job.status === 'running' ? 'bg-world animate-pulse' :
                        job.status === 'paused' ? 'bg-yellow-400/60' : 'bg-white/20'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-white/80 font-medium truncate block">{job.title}</span>
                        <span className="text-[10px] text-white/25 font-mono">{completedChunks}/{totalChunks} chunks &middot; {progress}%</span>
                      </div>
                      <div className="w-24 h-1.5 bg-white/6 rounded-full overflow-hidden shrink-0">
                        <div className={`h-full rounded-full transition-all ${job.status === 'failed' ? 'bg-red-500/60' : job.status === 'completed' ? 'bg-emerald-500/60' : 'bg-world/60'}`} style={{ width: `${progress}%` }} />
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); dispatch({ type: 'DELETE_ANALYSIS_JOB', id: job.id }); }}
                        className="text-white/15 hover:text-white/50 text-sm opacity-0 group-hover:opacity-100 transition shrink-0"
                      >&times;</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {wizardState.isOpen && <CreationWizard />}
      {apiKeysOpen && <ApiKeyModal access={access} onClose={() => setApiKeysOpen(false)} />}
    </>
  );
}
