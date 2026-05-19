/**
 * detectTitleFromText — single-shot LLM call that infers a title from
 * the opening of a corpus. Used by both the analysis NewJobSetup
 * (auto-fires once on mount) and the FileComposerModal (manual
 * "auto-detect" affordance next to the name field).
 *
 * Returns an empty string on any failure / out-of-range output, so
 * callers can simply guard with `if (detected) setTitle(detected)`
 * without hand-rolling error UX.
 */

import { apiHeaders } from '@/lib/api-headers';
import { logApiCall, updateApiLog } from '@/lib/api-logger';
import { DEFAULT_MODEL } from '@/lib/constants';

const SYSTEM_PROMPT =
  'You identify book/screenplay/text titles from their content. Reply with only the title in proper title case.';

export async function detectTitleFromText(chunkText: string): Promise<string> {
  const sample = chunkText.slice(0, 4000);
  const prompt = `Here is the first chunk of a text. What is the title of this work? Reply with ONLY the title, nothing else. No quotes, no explanation.\n\n${sample}`;
  const logId = logApiCall(
    'detectTitleFromText',
    prompt.length + SYSTEM_PROMPT.length,
    prompt,
    DEFAULT_MODEL,
    SYSTEM_PROMPT,
  );
  const start = performance.now();
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt: SYSTEM_PROMPT, maxTokens: 50 }),
    });
    if (!res.ok) {
      updateApiLog(logId, {
        status: 'error',
        error: `HTTP ${res.status}`,
        durationMs: Math.round(performance.now() - start),
      });
      return '';
    }
    const data = await res.json();
    const title = (data.content ?? '').trim().replace(/^["']|["']$/g, '');
    updateApiLog(logId, {
      status: 'success',
      durationMs: Math.round(performance.now() - start),
      responseLength: title.length,
      responsePreview: title,
    });
    // Sanity gate — empty or absurdly long means the LLM didn't land
    // on a real title; let the caller fall back to a manual entry.
    return title.length > 0 && title.length < 100 ? title : '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateApiLog(logId, {
      status: 'error',
      error: message,
      durationMs: Math.round(performance.now() - start),
    });
    return '';
  }
}
