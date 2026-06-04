// Core LLM call layer — callGenerate / callGenerateStream against /api/generate, plus reasoning/websearch resolvers.

import { apiHeaders } from '@/lib/core/api-headers';
import { DEFAULT_MODEL, API_TIMEOUT_MS, API_STREAM_TIMEOUT_MS } from '@/lib/constants';
import { FatalApiError, isFatalStatus } from '@/lib/ai/errors';
import { REASONING_BUDGETS, WEBSEARCH_MAX_RESULTS, WEBSEARCH_DEFAULT_MAX_TOTAL, type NarrativeState, type WebsearchConfig } from '@/types/narrative';

/** Resolve a story's reasoning budget (thinking tokens) from its settings.
 *  Returns the canonical number (including 0 for "none") so callers pass
 *  the user's intent through unchanged. */
export function resolveReasoningBudget(narrative: NarrativeState | undefined | null): number {
  return REASONING_BUDGETS[narrative?.storySettings?.reasoningLevel ?? 'low'];
}

/** Resolve a story's websearch config from its settings. Returns null when
 *  websearch is disabled; otherwise a {maxResults, maxTotalResults} object
 *  the API route attaches as OpenRouter's web_search plugin parameters.
 *  Pass directly to callGenerate / callGenerateStream — they emit the
 *  plugin only when a non-null config is supplied. */
export function resolveWebsearch(narrative: NarrativeState | undefined | null): WebsearchConfig | null {
  const settings = narrative?.storySettings;
  const level = settings?.websearchLevel ?? 'none';
  const maxResults = WEBSEARCH_MAX_RESULTS[level];
  if (maxResults <= 0) return null;
  return {
    maxResults,
    maxTotalResults: settings?.websearchMaxTotalResults ?? WEBSEARCH_DEFAULT_MAX_TOTAL,
  };
}

export async function callGenerateStream(
  prompt: string,
  systemPrompt: string,
  onToken: (token: string) => void,
  maxTokens?: number,
  caller = 'callGenerateStream',
  model?: string,
  reasoningBudget?: number,
  onReasoning?: (token: string) => void,
  temperature?: number,
  /** Websearch config — null/undefined leaves the plugin off.
   *  Pass the value from resolveWebsearch(narrative). */
  websearch?: WebsearchConfig | null,
): Promise<string> {
  const resolvedModel = model ?? DEFAULT_MODEL;
  const { logApiCall, updateApiLog } = await import('@/lib/core/api-logger');
  const logId = logApiCall(caller, prompt.length + (systemPrompt?.length ?? 0), prompt, resolvedModel, systemPrompt);
  const start = performance.now();

  // Set up abort controller with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_STREAM_TIMEOUT_MS);

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, stream: true, ...(maxTokens ? { maxTokens } : {}), ...(model ? { model } : {}), ...(reasoningBudget !== undefined ? { reasoningBudget } : {}), ...(temperature !== undefined ? { temperature } : {}), ...(websearch ? { websearch } : {}) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}: ${res.statusText}` }));
      const message = err.error || 'Generation failed';
      updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
      if (isFatalStatus(res.status)) throw new FatalApiError(res.status, `[${caller}] ${message}`);
      throw new Error(`[${caller}] ${message}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let reasoningFull = '';
    let usage: { promptTokens?: number; completionTokens?: number } | null = null;
    let lastLogFlush = 0;
    const LOG_FLUSH_MS = 200;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const chunk = JSON.parse(trimmed.slice(6));
            const token = chunk.token ?? '';
            if (token) {
              full += token;
              onToken(token);
            }
            const reasoning = chunk.reasoning ?? '';
            if (reasoning) {
              reasoningFull += reasoning;
              onReasoning?.(reasoning);
            }
            // Capture usage data from final chunk
            if (chunk.usage) {
              usage = chunk.usage;
            }
          } catch (err) {
            console.warn(`[${caller}] malformed SSE chunk`, { line: trimmed.slice(0, 200), err });
          }
        }
      }

      const now = Date.now();
      if (now - lastLogFlush >= LOG_FLUSH_MS) {
        lastLogFlush = now;
        updateApiLog(logId, {
          responsePreview: full,
          ...(reasoningFull ? { reasoningContent: reasoningFull } : {}),
        });
      }
    }

    clearTimeout(timeoutId);
    updateApiLog(logId, {
      status: 'success',
      durationMs: Math.round(performance.now() - start),
      responseLength: full.length,
      responsePreview: full,
      ...(reasoningFull ? { reasoningContent: reasoningFull, reasoningTokens: Math.ceil(reasoningFull.length / 4) } : {}),
      // Use actual token counts from API when available
      ...(usage?.promptTokens != null ? { actualPromptTokens: usage.promptTokens } : {}),
      ...(usage?.completionTokens != null ? { actualCompletionTokens: usage.completionTokens } : {}),
    });
    return full;
  } catch (err) {
    clearTimeout(timeoutId);
    // Preserve fatal errors — loops rely on `instanceof FatalApiError` to halt.
    if (err instanceof FatalApiError) throw err;

    const isAbort = err instanceof Error && err.name === 'AbortError';
    const isFetchError = err instanceof Error && err.message.includes('fetch failed');
    let message: string;

    if (isAbort) {
      message = `[${caller}] Request timed out after ${API_STREAM_TIMEOUT_MS || API_TIMEOUT_MS}ms (model: ${resolvedModel}, tokens: ${maxTokens ?? 'default'})`;
    } else if (isFetchError) {
      message = `[${caller}] Network error - fetch failed (model: ${resolvedModel}, prompt: ${prompt.length} chars). Check API connectivity.`;
    } else {
      message = err instanceof Error ? err.message : String(err);
    }

    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    throw new Error(message);
  }
}

export async function callGenerate(prompt: string, systemPrompt: string, maxTokens?: number, caller = 'callGenerate', model?: string, reasoningBudget?: number, jsonMode = true, temperature?: number, websearch?: WebsearchConfig | null): Promise<string> {
  const resolvedModel = model ?? DEFAULT_MODEL;
  const { logApiCall, updateApiLog } = await import('@/lib/core/api-logger');
  const logId = logApiCall(caller, prompt.length + (systemPrompt?.length ?? 0), prompt, resolvedModel, systemPrompt);
  const start = performance.now();

  // Set up abort controller with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, ...(maxTokens ? { maxTokens } : {}), ...(model ? { model } : {}), ...(reasoningBudget !== undefined ? { reasoningBudget } : {}), ...(jsonMode ? { jsonMode: true } : {}), ...(temperature !== undefined ? { temperature } : {}), ...(websearch ? { websearch } : {}) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json();
      const message = err.error || 'Generation failed';
      updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
      if (isFatalStatus(res.status)) throw new FatalApiError(res.status, message);
      throw new Error(message);
    }
    const data = await res.json();
    const content = data.content;
    clearTimeout(timeoutId);
    updateApiLog(logId, {
      status: 'success',
      durationMs: Math.round(performance.now() - start),
      responseLength: content.length,
      responsePreview: content,
      ...(data.reasoning ? { reasoningContent: data.reasoning } : {}),
      ...(data.reasoningTokens != null ? { reasoningTokens: data.reasoningTokens } : {}),
      // Use actual token counts from API when available
      ...(data.usage?.promptTokens != null ? { actualPromptTokens: data.usage.promptTokens } : {}),
      ...(data.usage?.completionTokens != null ? { actualCompletionTokens: data.usage.completionTokens } : {}),
    });
    return content;
  } catch (err) {
    clearTimeout(timeoutId);
    // Preserve fatal errors — loops rely on `instanceof FatalApiError` to halt.
    if (err instanceof FatalApiError) throw err;

    const isAbort = err instanceof Error && err.name === 'AbortError';
    const isFetchError = err instanceof Error && err.message.includes('fetch failed');
    let message: string;

    if (isAbort) {
      message = `[${caller}] Request timed out after ${API_STREAM_TIMEOUT_MS || API_TIMEOUT_MS}ms (model: ${resolvedModel}, tokens: ${maxTokens ?? 'default'})`;
    } else if (isFetchError) {
      message = `[${caller}] Network error - fetch failed (model: ${resolvedModel}, prompt: ${prompt.length} chars). Check API connectivity.`;
    } else {
      message = err instanceof Error ? err.message : String(err);
    }

    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    throw new Error(message);
  }
}

// Re-exported from prompts directory so existing import paths keep working.
export { SYSTEM_PROMPT } from '@/lib/prompts/core/system';
