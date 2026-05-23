'use client';

import { useLogs } from '@/lib/logs-context';
import { useStore } from '@/lib/store';
import { ApiLogsViewer } from '@/components/apilogs/ApiLogsViewer';

/**
 * World-view-side API logs entry point. The actual viewer chrome (list,
 * detail tabs, cost display) lives in `ApiLogsViewer` so this modal
 * and the analysis-page modal share one implementation. This wrapper
 * just scopes the log set to the active world view's calls — no source
 * filter dropdown, since these logs are by definition world-view calls
 * (analysis logs live in a separate modal on the analysis page).
 */
export function ApiLogsModal({ onClose }: { onClose: () => void }) {
  const { state: logsState, dispatch: logsDispatch } = useLogs();
  const { state: appState } = useStore();

  const filteredLogs = logsState.apiLogs.filter(
    (log) => log.narrativeId === appState.activeNarrativeId,
  );

  const pendingCount = filteredLogs.filter((l) => l.status === 'pending').length;
  const errorCount = filteredLogs.filter((l) => l.status === 'error').length;

  return (
    <ApiLogsViewer
      onClose={onClose}
      logs={filteredLogs}
      title="API Logs"
      headerActions={
        <div className="flex items-center gap-2">
          {pendingCount > 0 && <span className="text-[10px] text-amber-400">{pendingCount} pending</span>}
          {errorCount > 0 && <span className="text-[10px] text-red-400">{errorCount} failed</span>}
        </div>
      }
      emptyMessage="No API calls yet. Generate or expand to see logs."
      onClear={() => logsDispatch({ type: 'CLEAR_API_LOGS' })}
    />
  );
}
