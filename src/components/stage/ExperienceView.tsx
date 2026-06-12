'use client';
// ExperienceView — the Experience surface. Scores how the branch's played
// history (and its rehearsals on other branches) relate to each scene. Reads
// the one cross-branch summary-embedding cosine matrix (cached in experience.ts)
// that every Experience surface shares, so the numbers here match the scorecard.
//
// Four readings, all 0–100, all from that one matrix:
//   • Prior        — BACKWARD. "Have we been here before?" similarity to scenes
//                    earlier in global play (own branch or others).
//   • Posterior    — FORWARD (foresight). similarity to scenes that come LATER.
//   • Connectivity — OMNIDIRECTIONAL. total match mass.
//   • Experience   — additive XP over rehearsed moments → a progression Level.
//
// The data viz: smooth, value-coloured Prior-and-Posterior-by-arc sparklines
// (prior knowledge backward / foresight forward), a current-scene panel listing
// the scenes it most resembles with CROSS-BRANCH navigation (jump straight to an
// off-branch rehearsal), and an on-demand AI rehearsal report for the scene.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/state/store';
import {
  computeExperienceReport,
  auditExperienceAvailability,
  experienceLevel,
  locateScene,
  type ExperienceReport,
  type ExpMatch,
} from '@/lib/analysis/experience';
import { generateExperienceReport, type ReportMatch } from '@/lib/ai/experience-report';
import { resolveEntry, isScene } from '@/types/narrative';
import { EmptyState } from '@/components/shared/EmptyState';
import { ExperienceSparkline, expBandColor as scoreColor } from '@/components/shared/ExperienceSparkline';
import { IconSignals, IconRefresh } from '@/components/icons';

function ReadingPair({ prior, posterior }: { prior: number; posterior: number }) {
  const items = [
    { label: 'Prior knowledge', v: prior, hint: 'backward — seen it before' },
    { label: 'Foresight', v: posterior, hint: 'forward — foreseen ahead' },
  ];
  return (
    <div className="flex gap-2.5">
      {items.map(({ label, v, hint }) => (
        <div key={label} className="flex-1 rounded-lg border border-white/8 bg-white/2 px-3 py-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-medium text-text-secondary">{label}</span>
            <span className="text-lg font-bold tabular-nums" style={{ color: scoreColor(v) }}>{v}</span>
          </div>
          <div className="text-[9px] text-text-dim/50 mt-0.5 leading-tight">{hint}</div>
        </div>
      ))}
    </div>
  );
}

export default function ExperienceView() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const keys = state.resolvedEntryKeys;
  const currentIndex = state.viewState.currentSceneIndex;

  const [report, setReport] = useState<ExperienceReport | null>(null);
  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI rehearsal report (per scene, on demand). The committed report persists on
  // the scene (scene.experienceReport); while generating we stream into live
  // buffers (text + reasoning) keyed to the scene being reported.
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const [stream, setStream] = useState<{ sceneId: string; text: string; reasoning: string } | null>(null);
  const streamBuf = useRef<{ text: string; reasoning: string }>({ text: '', reasoning: '' });

  // Pending cross-branch / cross-scene navigation awaiting confirmation.
  const [pendingNav, setPendingNav] = useState<ExpMatch | null>(null);

  const audit = useMemo(
    () => (narrative ? auditExperienceAvailability(narrative) : { totalScenes: 0, scenesWithEmbedding: 0 }),
    [narrative],
  );
  const runnable = audit.scenesWithEmbedding >= 2;

  const computeKey = `${narrative?.id ?? ''}:${state.viewState.activeBranchId ?? ''}:${audit.scenesWithEmbedding}:${keys.length}`;
  useEffect(() => {
    if (!narrative || !runnable) { setReport(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    computeExperienceReport(narrative, keys)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computeKey]);

  const currentScene = useMemo(() => {
    const e = narrative ? resolveEntry(narrative, keys[currentIndex]) : null;
    return e && isScene(e) ? e : null;
  }, [narrative, keys, currentIndex]);

  if (!narrative) return null;
  if (!runnable) {
    return (
      <EmptyState
        icon={IconSignals}
        title="Experience needs scene embeddings."
        hint={`${audit.scenesWithEmbedding} of ${audit.totalScenes} scenes embedded. Generate embeddings (TopBar → Regenerate Embeddings) so the room can relate each scene to its played history.`}
      />
    );
  }

  const cur = currentScene ? report?.perScene.get(currentScene.id) : undefined;
  const summaryFor = (id: string) => {
    const e = resolveEntry(narrative, id);
    return e && isScene(e) ? e.summary : '';
  };

  const branchName = (branchId: string) => narrative.branches?.[branchId]?.name ?? branchId;

  // Navigation is gated behind a confirmation — clicking a match arms it; the
  // user confirms before we move the cursor or (for off-branch matches) switch
  // branch and place the cursor on the target scene.
  const confirmNav = () => {
    const m = pendingNav;
    if (!m) return;
    if (!m.offBranch && m.keyIndex >= 0) {
      dispatch({ type: 'SET_SCENE_INDEX', index: m.keyIndex });
    } else {
      const loc = locateScene(narrative, m.sceneId);
      if (loc) {
        dispatch({ type: 'SWITCH_BRANCH', branchId: loc.branchId });
        dispatch({ type: 'SET_SCENE_INDEX', index: loc.index });
      }
    }
    setPendingNav(null);
  };

  const MatchRow = ({ m, dir }: { m: ExpMatch; dir: 'back' | 'fwd' }) => {
    const days = m.ageMs != null ? Math.round(Math.abs(m.ageMs) / 86_400_000) : null;
    const loc = m.offBranch ? locateScene(narrative, m.sceneId) : null;
    return (
      <button
        onClick={() => setPendingNav(m)}
        className="group flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-white/5 transition-colors w-full"
        title={m.offBranch ? `Go to ${loc ? branchName(loc.branchId) : 'another branch'}` : 'Go to this scene'}
      >
        <span className="tabular-nums text-[11px] font-semibold w-9 shrink-0" style={{ color: scoreColor(Math.round(m.similarity * 100)) }}>
          {Math.round(m.similarity * 100)}%
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">{summaryFor(m.sceneId)}</span>
        {m.offBranch && (
          <span className="shrink-0 rounded-sm bg-violet-500/15 px-1 py-px text-[8px] font-medium uppercase tracking-wide text-violet-300/80">
            ⤳ {loc ? branchName(loc.branchId) : 'branch'}
          </span>
        )}
        {days != null && (
          <span className="text-[9px] text-text-dim/50 shrink-0 tabular-nums">{days}d {dir === 'back' ? 'before' : 'after'}</span>
        )}
      </button>
    );
  };

  const runAiReport = async () => {
    if (!currentScene || !cur) return;
    const sceneId = currentScene.id;
    // RAG context: the top-5 prior-knowledge matches (their summaries), judged
    // against this scene's summary as the reference.
    const used = cur.priorMatches.slice(0, 5);
    const matches: ReportMatch[] = used.map((m) => ({
      summary: summaryFor(m.sceneId),
      similarity: m.similarity,
      offBranch: m.offBranch,
      prior: report?.perScene.get(m.sceneId)?.prior ?? 0,
    }));
    setAiLoading(true);
    setAiError(null);
    setShowReasoning(true);
    streamBuf.current = { text: '', reasoning: '' };
    setStream({ sceneId, text: '', reasoning: '' });
    try {
      const text = await generateExperienceReport({
        sceneSummary: currentScene.summary,
        matches,
        onToken: (t) => { streamBuf.current.text += t; setStream({ sceneId, ...streamBuf.current }); },
        onReasoning: (t) => { streamBuf.current.reasoning += t; setStream({ sceneId, ...streamBuf.current }); },
      });
      // Persist on the scene so it survives reloads + branch switches.
      dispatch({
        type: 'REVISE_SCENE',
        sceneId,
        updates: {
          experienceReport: {
            text,
            reasoning: streamBuf.current.reasoning || undefined,
            matchIds: used.map((m) => m.sceneId),
            generatedAt: new Date().toISOString(),
          },
        },
      });
      setStream(null);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
      setStream(null);
    } finally {
      setAiLoading(false);
    }
  };

  // ── Arc-series for the two graphs ──
  const arcs = report ? [...report.perArc.values()] : [];
  const arcLabels = arcs.map((a) => (a.arcId === '—' ? 'Unassigned' : (narrative.arcs[a.arcId]?.name ?? a.arcId)));
  const arcPriors = arcs.map((a) => a.prior);
  const arcPosteriors = arcs.map((a) => a.posterior);
  // Jump to the first in-branch scene of the picked arc.
  const goToArc = (i: number) => {
    const arcId = arcs[i]?.arcId;
    if (!arcId) return;
    for (let k = 0; k < keys.length; k++) {
      const e = resolveEntry(narrative, keys[k]);
      if (e && isScene(e) && (e.arcId ?? '—') === arcId) { dispatch({ type: 'SET_SCENE_INDEX', index: k }); break; }
    }
  };

  const lvl = report ? experienceLevel(report.experienceXP) : null;

  // What to display in the report block: the live stream while generating this
  // scene, otherwise the persisted report on the scene.
  const streaming = stream && currentScene && stream.sceneId === currentScene.id ? stream : null;
  const saved = currentScene?.experienceReport ?? null;
  const reportText = streaming ? streaming.text : saved?.text ?? '';
  const reportReasoning = streaming ? streaming.reasoning : saved?.reasoning ?? '';
  const hasReport = !!reportText || !!reportReasoning;

  return (
    <div className="absolute inset-0 z-20 flex flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-300/90">{error}</div>
          )}

          {/* Headline: Experience Level + XP + branch triad */}
          {report && lvl && (
            <div className="rounded-xl border border-white/8 bg-white/2 px-5 py-4">
              <div className="flex items-baseline gap-2.5">
                <span className="text-[34px] font-bold font-mono leading-none tracking-tight" style={{ color: '#facc15' }}>L{lvl.level}</span>
                <span className="text-[16px] font-medium text-text-secondary truncate">{lvl.label}</span>
              </div>
              <div className="mt-3 h-1.5 w-full rounded-full bg-white/8 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(lvl.progress * 100)}%`, background: '#facc15' }} />
              </div>
              <div className="mt-4 border-t border-white/8 pt-3.5">
                <ReadingPair prior={report.branchPrior} posterior={report.branchPosterior} />
              </div>
            </div>
          )}

          {/* Coverage diagnostics */}
          {report && report.scenesResolved < report.scenesWithEmbedding ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[10px] text-red-300/90 leading-snug">
              {report.scenesWithEmbedding - report.scenesResolved} of {report.scenesWithEmbedding} embedding refs failed to load (vectors not in store) — those scenes score 0. Run Regenerate Embeddings across all branches.
            </div>
          ) : report && report.scenesWithEmbedding < report.totalScenes ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-300/90 leading-snug">
              {report.scenesWithEmbedding} of {report.totalScenes} scenes embedded — the rest score 0. Bulk Embed across all branches for full coverage.
            </div>
          ) : null}

          {/* Data viz: prior knowledge (backward) + foresight (forward) by arc */}
          {arcs.length > 1 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-white/8 bg-white/2 px-3 py-3">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wide text-text-dim/60">Prior knowledge</span>
                  <span className="text-[9px] text-text-dim/40">backward · per arc</span>
                </div>
                <ExperienceSparkline values={arcPriors} labels={arcLabels} onPick={goToArc} />
              </div>
              <div className="rounded-xl border border-white/8 bg-white/2 px-3 py-3">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wide text-text-dim/60">Foresight</span>
                  <span className="text-[9px] text-text-dim/40">forward · per arc</span>
                </div>
                <ExperienceSparkline values={arcPosteriors} labels={arcLabels} onPick={goToArc} />
              </div>
            </div>
          )}

          {/* Current scene — matches + AI rehearsal report */}
          {currentScene && cur && (
            <div className="rounded-xl border border-white/8 bg-white/2">
              <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
                <span className="text-xs font-medium text-text-primary">This scene</span>
                <div className="flex items-center gap-3 text-[11px] tabular-nums">
                  <span style={{ color: scoreColor(cur.prior) }}>Prior knowledge {cur.prior}</span>
                  <span style={{ color: scoreColor(cur.posterior) }}>Foresight {cur.posterior}</span>
                </div>
              </div>
              <div className="px-3 py-2.5">
                <div className="text-[12px] text-text-secondary line-clamp-2 mb-2.5">{currentScene.summary}</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-[10px] uppercase tracking-wide text-text-dim/50">Prior — rehearsed before</div>
                    {cur.priorMatches.length ? cur.priorMatches.map((m) => <MatchRow key={m.sceneId} m={m} dir="back" />)
                      : <div className="text-[11px] text-text-dim/40 px-2 py-1">Nothing earlier — unrehearsed.</div>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-[10px] uppercase tracking-wide text-text-dim/50">Posterior — foreseen ahead</div>
                    {cur.posteriorMatches.length ? cur.posteriorMatches.map((m) => <MatchRow key={m.sceneId} m={m} dir="fwd" />)
                      : <div className="text-[11px] text-text-dim/40 px-2 py-1">Nothing later yet.</div>}
                  </div>
                </div>

                {/* AI rehearsal report — a RAG over the top-5 prior-knowledge
                    matches, judged against this scene. Reasoning is shown, and
                    the committed report persists on the scene. */}
                <div className="mt-3 border-t border-white/8 pt-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-text-dim/50">Rehearsal report</span>
                    <div className="flex items-center gap-2">
                      {reportReasoning && (
                        <button
                          onClick={() => setShowReasoning((s) => !s)}
                          className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-text-dim hover:bg-white/5 transition-colors"
                        >
                          {showReasoning ? 'Hide reasoning' : 'Show reasoning'}
                        </button>
                      )}
                      <button
                        onClick={runAiReport}
                        disabled={aiLoading}
                        className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-text-secondary hover:bg-white/10 transition-colors disabled:opacity-50"
                      >
                        {aiLoading && <IconRefresh size={10} className="animate-spin" />}
                        {hasReport ? 'Regenerate' : 'Generate report'}
                      </button>
                    </div>
                  </div>
                  {aiError && <div className="mt-2 text-[10px] text-red-300/80">{aiError}</div>}

                  {/* Reasoning trace (collapsible) */}
                  {reportReasoning && showReasoning && (
                    <div className="mt-2 rounded-md border border-white/8 bg-black/20 px-2.5 py-2">
                      <div className="text-[8px] uppercase tracking-widest text-text-dim/40 mb-1">Reasoning{streaming && aiLoading ? ' · thinking…' : ''}</div>
                      <div className="whitespace-pre-wrap text-[11px] leading-relaxed text-text-dim/70 font-mono">{reportReasoning}</div>
                    </div>
                  )}

                  {/* Report prose */}
                  {hasReport ? (
                    <div className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-text-secondary">
                      {reportText}
                      {streaming && aiLoading && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-text-secondary/60 align-middle" />}
                    </div>
                  ) : !aiLoading && (
                    <div className="mt-1.5 text-[11px] text-text-dim/40">Have we played anything like this before? Ask the analyst to weigh the top 5 matches against this scene.</div>
                  )}
                  {saved && !streaming && (
                    <div className="mt-1.5 text-[8px] text-text-dim/30 font-mono">grounded on {saved.matchIds.length} prior {saved.matchIds.length === 1 ? 'match' : 'matches'}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Per-arc table */}
          {report && report.perArc.size > 0 && (
            <div className="rounded-xl border border-white/8 bg-white/2 px-3 py-3">
              <div className="text-[10px] uppercase tracking-wide text-text-dim/50 mb-2">By arc</div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[9px] uppercase tracking-wide text-text-dim/40">
                  <span className="flex-1 min-w-0">Arc</span>
                  <span className="w-24 text-right">Prior knowledge</span>
                  <span className="w-16 text-right">Foresight</span>
                </div>
                {arcs.map((a, i) => (
                  <button
                    key={a.arcId}
                    onClick={() => goToArc(i)}
                    className="flex items-center gap-2 text-[11px] tabular-nums hover:bg-white/5 rounded px-1 -mx-1 transition-colors text-left"
                  >
                    <span className="flex-1 min-w-0 truncate text-text-secondary">{arcLabels[i]}</span>
                    <span className="w-24 text-right" style={{ color: scoreColor(a.prior) }}>{a.prior}</span>
                    <span className="w-16 text-right" style={{ color: scoreColor(a.posterior) }}>{a.posterior}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation confirmation — gate cross-branch / cross-scene jumps */}
      {pendingNav && (() => {
        const loc = pendingNav.offBranch ? locateScene(narrative, pendingNav.sceneId) : null;
        const crossBranch = !!loc && loc.branchId !== state.viewState.activeBranchId;
        return (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50" onClick={() => setPendingNav(null)}>
            <div className="w-[min(440px,90%)] rounded-xl border border-white/12 bg-surface shadow-2xl p-4" onClick={(e) => e.stopPropagation()}>
              <div className="text-[11px] uppercase tracking-wide text-text-dim/60 mb-1.5">
                {crossBranch ? 'Switch branch & go to scene' : 'Go to scene'}
              </div>
              {crossBranch && (
                <div className="mb-2 text-[12px] text-text-secondary">
                  This match lives on branch <span className="font-medium text-text-primary">{branchName(loc!.branchId)}</span>. Confirming will switch the active branch and move the cursor there.
                </div>
              )}
              <div className="rounded-md border border-white/8 bg-white/2 px-2.5 py-2 text-[12px] text-text-secondary line-clamp-3">
                {summaryFor(pendingNav.sceneId) || 'this scene'}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setPendingNav(null)}
                  className="rounded-md border border-white/10 px-3 py-1.5 text-[11px] text-text-dim hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmNav}
                  className="rounded-md border border-violet-400/30 bg-violet-500/20 px-3 py-1.5 text-[11px] text-violet-100 hover:bg-violet-500/30 transition-colors"
                >
                  {crossBranch ? 'Switch & go' : 'Go to scene'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
