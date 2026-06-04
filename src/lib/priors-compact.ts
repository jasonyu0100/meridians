/**
 * Daily Driver — synthesise queued entries into a markdown SourceFile.
 *
 * Operator flow: queue → select entries → compact → preview → Apply.
 * This module owns the *synthesise* step: it takes selected entries
 * and produces a coherent markdown document. The output then flows
 * through the standard file-conversion pipeline as a source='daily-log'
 * SourceFile, which adds the continuation-first thread alignment pass
 * during reconcile.
 *
 * Separation of concerns: synthesis is purely structural. It does NOT
 * see the existing narrative, does NOT align threads, does NOT do any
 * world-aware framing. That responsibility lives downstream in
 * file-conversion (`reconcileExtensionAgainstNarrative` with
 * `source: 'daily-log'`) and the thread-alignment pass inside it.
 * Synthesis turns unstructured fragments into a well-formed document;
 * the engine takes over from there.
 */

import type { Prior } from '@/types/narrative';
import {
  buildPriorsSynthesisPrompt,
  DRIVER_SYNTHESIS_SYSTEM,
} from '@/lib/prompts';

export type SynthesisePriorsCompactInput = {
  entries: ReadonlyArray<Prior>;
  /** Optional operator-supplied title for the compact (used as a hint
   *  in the prompt and as a candidate filename for the generated
   *  SourceFile). */
  compactTitle?: string;
  /** Streaming token callback — emits raw text as the LLM produces it.
   *  Used by the compact preview UI to render the markdown progressively. */
  onToken?: (token: string, accumulated: string) => void;
};

/** Run the synthesis LLM call and return the markdown body. Caller is
 *  responsible for (a) creating a SourceFile from the markdown,
 *  (b) staging it via the standard `stageFile` path with
 *  `source: 'daily-log'` set, and (c) dispatching
 *  MARK_PRIORS_USED with the new file id once the file is
 *  stored. This function is intentionally pure — no IDB writes, no
 *  store dispatches, no awareness of the active narrative. */
export async function synthesisePriorsCompact(
  input: SynthesisePriorsCompactInput,
): Promise<string> {
  const { entries, compactTitle, onToken } = input;
  if (entries.length === 0) {
    throw new Error('synthesisePriorsCompact: no entries selected');
  }

  const ordered = [...entries].sort((a, b) => a.capturedAt - b.capturedAt);
  const prompt = buildPriorsSynthesisPrompt({
    entries: ordered.map((e) => ({
      capturedAt: e.capturedAt,
      text: e.text,
      tags: e.tags,
    })),
    compactTitle,
  });

  const { apiHeaders } = await import('@/lib/core/api-headers');
  const { logApiCall, updateApiLog } = await import('@/lib/core/api-logger');
  const logId = logApiCall(
    'priorsSynthesis',
    prompt.length + DRIVER_SYNTHESIS_SYSTEM.length,
    prompt,
    'analysis',
    DRIVER_SYNTHESIS_SYSTEM,
  );
  const start = performance.now();

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        prompt,
        systemPrompt: DRIVER_SYNTHESIS_SYSTEM,
        stream: !!onToken,
        temperature: 0.6,
        reasoningBudget: 0,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Synthesis failed' }));
      updateApiLog(logId, {
        status: 'error',
        error: err.error ?? 'Synthesis failed',
        durationMs: Math.round(performance.now() - start),
      });
      throw new Error(err.error ?? 'Synthesis failed');
    }

    let markdown = '';
    if (onToken && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // /api/generate streams SSE-style "data: <json>" lines. Each
        // delta JSON has a `token` field; concat to build the body.
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload) as { token?: string };
            if (parsed.token) {
              markdown += parsed.token;
              onToken(parsed.token, markdown);
            }
          } catch {
            // Stray non-JSON line — skip silently rather than corrupt
            // the markdown body.
          }
        }
      }
    } else {
      const data = (await res.json()) as { content?: string };
      markdown = data.content ?? '';
    }

    updateApiLog(logId, {
      status: 'success',
      responseLength: markdown.length,
      durationMs: Math.round(performance.now() - start),
    });

    return markdown.trim();
  } catch (err) {
    updateApiLog(logId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - start),
    });
    throw err;
  }
}

/** Format the compact title operator gave us into a SourceFile name. If
 *  no title was provided, fall back to a date-stamped default. */
export function deriveCompactFilename(compactTitle: string | undefined): string {
  const trimmed = compactTitle?.trim();
  if (trimmed) return trimmed;
  const d = new Date();
  return `Driver compact — ${d.toISOString().slice(0, 10)}`;
}
