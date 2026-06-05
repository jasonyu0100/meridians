'use client';
// ApiLogsModal — modal wrapper around ApiLogsViewer with Narrative/Analysis/Misc scope selector.

import { useLogs } from '@/lib/state/logs-context';
import { analysisIdsForNarrative, useStore } from '@/lib/state/store';
import { ApiLogsViewer } from '@/components/apilogs/ApiLogsViewer';
import { useMemo, useState } from 'react';

type Scope = 'narrative' | 'analysis' | 'misc';

const SCOPES: { value: Scope; label: string; hint: string }[] = [
  { value: 'narrative', label: 'Narrative', hint: 'Calls tied to this narrative' },
  { value: 'analysis',  label: 'Analysis',  hint: 'Analysis & extension calls that built or extended this narrative' },
  { value: 'misc',      label: 'Global',    hint: 'Global calls not tied to a narrative — wizard world generation, premise suggestions, etc.' },
];

const EMPTY_MESSAGE: Record<Scope, string> = {
  narrative: 'No API calls yet. Generate or expand to see logs.',
  analysis:  'No analysis API calls yet.',
  misc:      'No global API calls. Wizard world-gen and one-off calls without a narrative show here.',
};

/**
 * World-view-side API logs entry point. The viewer chrome (list, detail tabs,
 * cost display) lives in `ApiLogsViewer`; this wrapper scopes the log set.
 * Three views:
 *  - Narrative — calls tagged with the active narrative
 *  - Analysis — text-analysis / extension calls that built or extended the active narrative
 *  - Global — unassociated calls (world-gen during wizard, suggestPremise, etc.)
 */
export function ApiLogsModal({ onClose }: { onClose: () => void }) {
  const { state: logsState, dispatch: logsDispatch } = useLogs();
  const { state: appState } = useStore();
  const [scope, setScope] = useState<Scope>('narrative');

  // Analysis/extension calls log under an `analysisId` scope; map the jobs that
  // built or extended the active narrative back to it so the Analysis tab is
  // narrative-scoped — and reconciles with the per-narrative gas meter.
  const narrativeAnalysisIds = useMemo(
    () => new Set(analysisIdsForNarrative(appState.analysisJobs, appState.activeNarrativeId)),
    [appState.analysisJobs, appState.activeNarrativeId],
  );

  // Tabs must be DISJOINT so Narrative + Analysis sum to the gas meter total.
  // An analysis/extension call can carry both a narrativeId (a narrative was
  // active when it ran) and an analysisId — count it once, as Analysis, and
  // exclude it from Narrative so the two tabs don't double-count the overlap.
  const isTiedAnalysis = (log: { analysisId?: string }) =>
    log.analysisId != null && narrativeAnalysisIds.has(log.analysisId);

  const filteredLogs = logsState.apiLogs.filter((log) => {
    if (scope === 'analysis') return isTiedAnalysis(log);
    if (scope === 'narrative') return log.narrativeId === appState.activeNarrativeId && !isTiedAnalysis(log);
    return !log.narrativeId && !log.analysisId;
  });

  const pendingCount = filteredLogs.filter((l) => l.status === 'pending').length;
  const errorCount = filteredLogs.filter((l) => l.status === 'error').length;

  return (
    <ApiLogsViewer
      onClose={onClose}
      logs={filteredLogs}
      title="API Logs"
      headerActions={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-md bg-white/5 p-0.5">
            {SCOPES.map((s) => (
              <button
                key={s.value}
                onClick={() => setScope(s.value)}
                title={s.hint}
                className={`text-[10px] px-2 py-1 rounded transition-colors select-none ${
                  scope === s.value
                    ? 'bg-white/10 text-text-secondary'
                    : 'text-text-dim/60 hover:text-text-dim'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {pendingCount > 0 && <span className="text-[10px] text-amber-400">{pendingCount} pending</span>}
          {errorCount > 0 && <span className="text-[10px] text-red-400">{errorCount} failed</span>}
        </div>
      }
      emptyMessage={EMPTY_MESSAGE[scope]}
      onClear={() => logsDispatch({ type: 'CLEAR_API_LOGS' })}
    />
  );
}
