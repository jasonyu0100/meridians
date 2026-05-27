'use client';

import { useLogs } from '@/lib/logs-context';
import { useStore } from '@/lib/store';
import { ApiLogsViewer } from '@/components/apilogs/ApiLogsViewer';
import { useState } from 'react';

type Scope = 'narrative' | 'analysis' | 'misc';

const SCOPES: { value: Scope; label: string; hint: string }[] = [
  { value: 'narrative', label: 'Narrative', hint: 'Calls tied to this narrative' },
  { value: 'analysis',  label: 'Analysis',  hint: 'Calls run by text-analysis jobs' },
  { value: 'misc',      label: 'Misc',      hint: 'Unassociated calls — world generation, suggestions, etc.' },
];

const EMPTY_MESSAGE: Record<Scope, string> = {
  narrative: 'No API calls yet. Generate or expand to see logs.',
  analysis:  'No analysis API calls yet.',
  misc:      'No misc API calls. World-gen and one-off calls without a narrative show here.',
};

/**
 * World-view-side API logs entry point. The viewer chrome (list, detail tabs,
 * cost display) lives in `ApiLogsViewer`; this wrapper scopes the log set.
 * Three views:
 *  - Narrative — calls tagged with the active narrative
 *  - Analysis — calls produced by text-analysis (any narrative)
 *  - Misc — global / unassociated (world-gen during wizard, suggestPremise, etc.)
 */
export function ApiLogsModal({ onClose }: { onClose: () => void }) {
  const { state: logsState, dispatch: logsDispatch } = useLogs();
  const { state: appState } = useStore();
  const [scope, setScope] = useState<Scope>('narrative');

  const filteredLogs = logsState.apiLogs.filter((log) => {
    if (scope === 'narrative') return log.narrativeId === appState.activeNarrativeId;
    if (scope === 'analysis') return !!log.analysisId;
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
