'use client';
// ExperienceScorePanel — the Experience scorecard. Experience XP → Level is the
// headline, with an arc-by-arc Prior-knowledge sparkline (mirroring the
// narrative scorecard's Score-by-arc graph). Prior knowledge + Foresight ride
// along as secondary readings.

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/state/store';
import {
  computeExperienceReport,
  auditExperienceAvailability,
  experienceLevel,
  type ExperienceReport,
} from '@/lib/analysis/experience';
import { ExperienceSparkline, expBandColor as c } from '@/components/shared/ExperienceSparkline';

export function ExperienceScorePanel() {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const keys = state.resolvedEntryKeys;
  const [report, setReport] = useState<ExperienceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [arcMetric, setArcMetric] = useState<'prior' | 'foresight'>('prior');

  const audit = useMemo(
    () => (narrative ? auditExperienceAvailability(narrative) : { totalScenes: 0, scenesWithEmbedding: 0 }),
    [narrative, keys],
  );
  const runnable = audit.scenesWithEmbedding >= 2;
  const key = `${narrative?.id ?? ''}:${audit.scenesWithEmbedding}:${keys.length}`;

  useEffect(() => {
    if (!narrative || !runnable) { setReport(null); return; }
    let cancelled = false;
    setLoading(true);
    computeExperienceReport(narrative, keys)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch(() => { if (!cancelled) setReport(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!runnable) {
    return (
      <p className="text-[11px] text-text-dim text-center py-6">
        {audit.scenesWithEmbedding} / {audit.totalScenes} scenes embedded — generate embeddings to score experience.
      </p>
    );
  }
  if (!report) {
    return <p className="text-[11px] text-text-dim text-center py-6">{loading ? 'Computing…' : 'No data.'}</p>;
  }

  const lvl = experienceLevel(report.experienceXP);
  const lvlColor = '#facc15'; // level UI is yellow
  const arcs = [...report.perArc.values()];
  const arcValues = arcs.map((a) => (arcMetric === 'prior' ? a.prior : a.posterior));
  const arcLabels = arcs.map((a) => (a.arcId === '—' ? 'Unassigned' : (narrative?.arcs[a.arcId]?.name ?? a.arcId)));

  return (
    <div className="flex flex-col gap-3">
      {/* North Star: Experience — Level + progress */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[24px] font-bold font-mono leading-none tracking-tight" style={{ color: lvlColor }}>L{lvl.level}</span>
          <span className="text-[13px] font-medium text-text-secondary truncate">{lvl.label}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-white/8 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(lvl.progress * 100)}%`, background: lvlColor }} />
        </div>
      </div>

      {/* Coverage / resolution diagnostics. A scene scores 0 if it has no
          embedding ref, OR if its ref is present but the vector didn't load
          (stale/seed refs whose vectors aren't in this browser's store). */}
      {report.scenesResolved < report.scenesWithEmbedding ? (
        <div className="rounded border border-red-500/30 bg-red-500/5 px-2 py-1.5 text-[9px] text-red-300/90 leading-snug">
          {report.scenesWithEmbedding - report.scenesResolved} embedding refs failed to load — Regenerate Embeddings.
        </div>
      ) : report.scenesWithEmbedding < report.totalScenes ? (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[9px] text-amber-300/90 leading-snug">
          {report.scenesWithEmbedding} / {report.totalScenes} scenes embedded — Bulk Embed for the rest.
        </div>
      ) : null}

      {/* Prior / Foresight by arc — toggle which curve the sparkline draws */}
      {arcValues.length > 1 && (
        <div className="border-t border-white/8 pt-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[9px] uppercase tracking-widest text-text-dim">{arcMetric} by arc</div>
            <div className="flex rounded border border-white/8 overflow-hidden">
              {(['prior', 'foresight'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setArcMetric(m)}
                  className={`px-1.5 py-0.5 text-[8px] uppercase tracking-wider transition-colors ${
                    arcMetric === m ? 'bg-white/10 text-text-secondary' : 'text-text-dim hover:text-text-secondary'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <ExperienceSparkline values={arcValues} labels={arcLabels} />
        </div>
      )}

      {/* Secondary readings */}
      <div className="grid grid-cols-2 gap-2 border-t border-white/8 pt-2">
        {[
          { label: 'Prior', v: report.branchPrior },
          { label: 'Foresight', v: report.branchPosterior },
        ].map(({ label, v }) => (
          <div key={label} className="rounded border border-white/5 px-2 py-1.5 flex items-baseline justify-between">
            <span className="text-[9px] uppercase tracking-wider text-text-dim">{label}</span>
            <span className="text-[13px] font-mono font-bold" style={{ color: c(v) }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
