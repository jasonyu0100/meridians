"use client";
// LogsProvider — narrative-scoped React context for API + system logs, with persistence and stale pruning.

import { API_LOG_STALE_THRESHOLD_MS } from "@/lib/constants";
import {
  loadApiLogs,
  saveApiLogs,
  saveAnalysisApiLogs,
  loadSystemLogs,
  saveSystemLogs,
  saveAnalysisSystemLogs,
} from "@/lib/storage/persistence";
import type { ApiLogEntry, SystemLogEntry } from "@/types/narrative";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

// Maximum log entries to keep in memory (prevents unbounded growth)
const MAX_LOG_ENTRIES = 500;

// ── State ────────────────────────────────────────────────────────────────────

type LogsState = {
  apiLogs: ApiLogEntry[];
  systemLogs: SystemLogEntry[];
};

const initialState: LogsState = {
  apiLogs: [],
  systemLogs: [],
};

// ── Actions ──────────────────────────────────────────────────────────────────

type LogsAction =
  | { type: "LOG_API_CALL"; entry: ApiLogEntry }
  | { type: "UPDATE_API_LOG"; id: string; updates: Partial<ApiLogEntry> }
  | { type: "HYDRATE_API_LOGS"; logs: ApiLogEntry[] }
  | { type: "CLEAR_API_LOGS" }
  | { type: "LOG_SYSTEM"; entry: SystemLogEntry }
  | { type: "HYDRATE_SYSTEM_LOGS"; logs: SystemLogEntry[] }
  | { type: "CLEAR_SYSTEM_LOGS" };

// ── Reducer ──────────────────────────────────────────────────────────────────

function logsReducer(state: LogsState, action: LogsAction): LogsState {
  switch (action.type) {
    case "LOG_API_CALL": {
      const newLogs = [...state.apiLogs, action.entry];
      // Prune oldest entries if exceeding limit
      if (newLogs.length > MAX_LOG_ENTRIES) {
        return { ...state, apiLogs: newLogs.slice(-MAX_LOG_ENTRIES) };
      }
      return { ...state, apiLogs: newLogs };
    }

    case "UPDATE_API_LOG":
      return {
        ...state,
        apiLogs: state.apiLogs.map((l) =>
          l.id === action.id ? { ...l, ...action.updates } : l
        ),
      };

    case "HYDRATE_API_LOGS": {
      // Merge loaded logs with any existing in-memory logs (avoid duplicates)
      const existingIds = new Set(state.apiLogs.map((l) => l.id));
      const newLogs = action.logs.filter((l) => !existingIds.has(l.id));
      const merged = [...newLogs, ...state.apiLogs];
      // Sort by timestamp and keep within limit
      merged.sort((a, b) => a.timestamp - b.timestamp);
      return { ...state, apiLogs: merged.slice(-MAX_LOG_ENTRIES) };
    }

    case "CLEAR_API_LOGS":
      return { ...state, apiLogs: [] };

    case "LOG_SYSTEM": {
      const newLogs = [...state.systemLogs, action.entry];
      // Prune oldest entries if exceeding limit
      if (newLogs.length > MAX_LOG_ENTRIES) {
        return { ...state, systemLogs: newLogs.slice(-MAX_LOG_ENTRIES) };
      }
      return { ...state, systemLogs: newLogs };
    }

    case "HYDRATE_SYSTEM_LOGS": {
      // Merge loaded logs with any existing in-memory logs (avoid duplicates)
      const existingIds = new Set(state.systemLogs.map((l) => l.id));
      const newLogs = action.logs.filter((l) => !existingIds.has(l.id));
      const merged = [...newLogs, ...state.systemLogs];
      // Sort by timestamp and keep within limit
      merged.sort((a, b) => a.timestamp - b.timestamp);
      return { ...state, systemLogs: merged.slice(-MAX_LOG_ENTRIES) };
    }

    case "CLEAR_SYSTEM_LOGS":
      return { ...state, systemLogs: [] };

    default:
      return state;
  }
}

// ── Context ──────────────────────────────────────────────────────────────────

type LogsContextType = {
  state: LogsState;
  dispatch: React.Dispatch<LogsAction>;
};

const LogsContext = createContext<LogsContextType | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function LogsProvider({
  children,
  activeNarrativeId,
}: {
  children: ReactNode;
  activeNarrativeId: string | null;
}) {
  const [state, dispatch] = useReducer(logsReducer, initialState);
  const prevNarrativeIdRef = useRef<string | null>(null);
  const activeNarrativeIdRef = useRef<string | null>(activeNarrativeId);
  activeNarrativeIdRef.current = activeNarrativeId;

  // Load logs when narrative changes
  useEffect(() => {
    if (!activeNarrativeId) return;
    if (activeNarrativeId === prevNarrativeIdRef.current) return;

    prevNarrativeIdRef.current = activeNarrativeId;

    // Load API logs for this narrative
    loadApiLogs(activeNarrativeId).then((logs) => {
      if (logs.length > 0) {
        dispatch({ type: "HYDRATE_API_LOGS", logs });
      }
    });

    // Load system logs for this narrative
    loadSystemLogs(activeNarrativeId).then((logs) => {
      if (logs.length > 0) {
        dispatch({ type: "HYDRATE_SYSTEM_LOGS", logs });
      }
    });
  }, [activeNarrativeId]);

  // Refs to track current logs for immediate saves
  const logsRef = useRef<ApiLogEntry[]>([]);
  logsRef.current = state.apiLogs;

  const systemLogsRef = useRef<SystemLogEntry[]>([]);
  systemLogsRef.current = state.systemLogs;

  // Wire API logger to this context - save immediately on each log
  useEffect(() => {
    import("@/lib/core/api-logger").then(({ onApiLog, onApiLogUpdate }) => {
      onApiLog((entry) => {
        dispatch({ type: "LOG_API_CALL", entry });
        // Save immediately - to narrative or analysis store
        if (entry.narrativeId) {
          const updated = [...logsRef.current.filter((l) => l.id !== entry.id), entry];
          const forNarrative = updated.filter((l) => l.narrativeId === entry.narrativeId);
          saveApiLogs(entry.narrativeId, forNarrative.slice(-MAX_LOG_ENTRIES));
        } else if (entry.analysisId) {
          const updated = [...logsRef.current.filter((l) => l.id !== entry.id), entry];
          const forAnalysis = updated.filter((l) => l.analysisId === entry.analysisId);
          saveAnalysisApiLogs(entry.analysisId, forAnalysis.slice(-MAX_LOG_ENTRIES));
        }
      });
      onApiLogUpdate((id, updates) => {
        dispatch({ type: "UPDATE_API_LOG", id, updates });
        // Save immediately - find the log to determine which store
        const log = logsRef.current.find((l) => l.id === id);
        if (log?.narrativeId) {
          const updated = logsRef.current.map((l) =>
            l.id === id ? { ...l, ...updates } : l
          );
          const forNarrative = updated.filter((l) => l.narrativeId === log.narrativeId);
          saveApiLogs(log.narrativeId, forNarrative);
        } else if (log?.analysisId) {
          const updated = logsRef.current.map((l) =>
            l.id === id ? { ...l, ...updates } : l
          );
          const forAnalysis = updated.filter((l) => l.analysisId === log.analysisId);
          saveAnalysisApiLogs(log.analysisId, forAnalysis);
        }
      });
    });
  }, []);

  // Keep logger aware of which narrative is active
  useEffect(() => {
    import("@/lib/core/api-logger").then(({ setLoggerNarrativeId }) => {
      setLoggerNarrativeId(activeNarrativeId);
    });
  }, [activeNarrativeId]);

  // Wire system logger to this context - save immediately on each log
  useEffect(() => {
    import("@/lib/core/system-logger").then(({ onSystemLog }) => {
      onSystemLog((entry) => {
        // Defer dispatch — logs can be emitted synchronously from inside
        // the StoreProvider reducer (e.g. sanitizeScenes), and dispatching
        // into LogsProvider during another component's render is illegal.
        queueMicrotask(() => {
          dispatch({ type: "LOG_SYSTEM", entry });
          if (entry.narrativeId) {
            const updated = [...systemLogsRef.current.filter((l) => l.id !== entry.id), entry];
            const forNarrative = updated.filter((l) => l.narrativeId === entry.narrativeId);
            saveSystemLogs(entry.narrativeId, forNarrative.slice(-MAX_LOG_ENTRIES));
          } else if (entry.analysisId) {
            const updated = [...systemLogsRef.current.filter((l) => l.id !== entry.id), entry];
            const forAnalysis = updated.filter((l) => l.analysisId === entry.analysisId);
            saveAnalysisSystemLogs(entry.analysisId, forAnalysis.slice(-MAX_LOG_ENTRIES));
          }
        });
      });
    });
  }, []);

  // Keep system logger aware of which narrative is active
  useEffect(() => {
    import("@/lib/core/system-logger").then(({ setSystemLoggerNarrativeId }) => {
      setSystemLoggerNarrativeId(activeNarrativeId);
    });
  }, [activeNarrativeId]);

  // Stale log cleanup - mark pending API logs as error after threshold
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      state.apiLogs.forEach((log) => {
        if (
          log.status === "pending" &&
          now - log.timestamp > API_LOG_STALE_THRESHOLD_MS
        ) {
          dispatch({
            type: "UPDATE_API_LOG",
            id: log.id,
            updates: {
              status: "error",
              error: "Request timed out (marked stale)",
            },
          });
        }
      });
    }, 60000); // Check every 60 seconds

    return () => clearInterval(interval);
  }, [state.apiLogs]);

  return (
    <LogsContext.Provider value={{ state, dispatch }}>
      {children}
    </LogsContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useLogs() {
  const ctx = useContext(LogsContext);
  if (!ctx) {
    throw new Error("useLogs must be used within a LogsProvider");
  }
  return ctx;
}

// Re-export action helper for cleaner API
export function useLogsActions() {
  const { dispatch } = useLogs();

  return {
    clearApiLogs: useCallback(
      () => dispatch({ type: "CLEAR_API_LOGS" }),
      [dispatch]
    ),
    clearSystemLogs: useCallback(
      () => dispatch({ type: "CLEAR_SYSTEM_LOGS" }),
      [dispatch]
    ),
  };
}
