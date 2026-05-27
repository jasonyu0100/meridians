/**
 * Inspect a thrown error from a generation call and produce a user-facing
 * diagnosis: what likely went wrong, how bad it is, what to do next, and
 * (when applicable) a focused instruction the LLM repair pass can use.
 *
 * Pure function over the error shape — no network, no LLM. Pattern-matches
 * the error name + message against the shapes thrown by callGenerate (HTTP
 * status, timeout, fatal API), parseJson (JsonRepairableError, truncation
 * preview, empty response), and downstream validation failures.
 */

export type DiagnosisSeverity = 'low' | 'medium' | 'high';

export type ErrorDiagnosis = {
  severity: DiagnosisSeverity;
  /** Plain-English one-liner naming the root cause. */
  summary: string;
  /** Concrete next-step recommendation for the user. */
  suggestion: string;
  /** Whether re-running the same call is likely to help. */
  retryable: boolean;
  /** Whether the malformed raw output is available + a repair pass can
   *  realistically succeed. UI shows the Repair button only when true. */
  repairable: boolean;
  /** Focused instruction handed to the repair LLM — names the diagnosed
   *  issue so the model knows what to fix rather than guessing. Empty
   *  when there's nothing more specific to say beyond "fix the JSON". */
  repairHint?: string;
};

type ErrorLike = { name?: string; message?: string; raw?: string };

function pickMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as ErrorLike).message === 'string') {
    return (err as ErrorLike).message!;
  }
  return String(err);
}

function hasRaw(err: unknown): err is { raw: string } {
  return !!err && typeof err === 'object' && 'raw' in err && typeof (err as ErrorLike).raw === 'string';
}

/** Caller-specific noun for the repair-hint sentence ("the narrative",
 *  "the arc", "the expansion") so the LLM prompt reads naturally. */
const CALLER_NOUN: Record<string, string> = {
  generateNarrative: 'the initial narrative payload',
  generateScenes: 'the arc + scenes payload',
  expandWorld: 'the world expansion payload',
  scenarios: 'the scenario arc payload',
};

export function diagnoseError(err: unknown, caller?: string): ErrorDiagnosis {
  const message = pickMessage(err);
  const lower = message.toLowerCase();
  const repairableRaw = hasRaw(err);
  const noun = (caller && CALLER_NOUN[caller]) || 'the response';

  // ── Auth / config errors — neither retry nor repair will help ────────
  if (/\b(401|403)\b/.test(message) || lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('api key') || lower.includes('credit')) {
    return {
      severity: 'high',
      summary: 'Authentication or credit failure.',
      suggestion: 'Check your OpenRouter API key and billing; re-running with the same credentials will fail the same way.',
      retryable: false,
      repairable: false,
    };
  }

  // ── Rate limit — retry after waiting ─────────────────────────────────
  if (/\b429\b/.test(message) || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      severity: 'medium',
      summary: 'Provider rate limit hit.',
      suggestion: 'Wait a minute and retry. If it persists, lower concurrency in story settings.',
      retryable: true,
      repairable: false,
    };
  }

  // ── Server errors (5xx) — retry usually works ────────────────────────
  if (/\b5\d{2}\b/.test(message) || lower.includes('bad gateway') || lower.includes('service unavailable')) {
    return {
      severity: 'medium',
      summary: 'Upstream provider error (5xx).',
      suggestion: 'Transient — retry. If repeated, check OpenRouter status.',
      retryable: true,
      repairable: false,
    };
  }

  // ── Network / timeout / abort ────────────────────────────────────────
  if (lower.includes('abort') || lower.includes('timeout') || lower.includes('etimedout') || lower.includes('econnreset') || lower.includes('network')) {
    return {
      severity: 'medium',
      summary: 'Request timed out or the connection dropped.',
      suggestion: 'Retry — the call did not complete. Consider shortening the prompt or lowering scope if it keeps timing out.',
      retryable: true,
      repairable: false,
    };
  }

  // ── Empty response — model returned nothing ──────────────────────────
  if (lower.includes('empty response from llm') || lower.includes('received no content')) {
    return {
      severity: 'high',
      summary: 'Model returned no content.',
      suggestion: 'Retry. If repeated, the prompt may be hitting a content-filter — try simpler wording.',
      retryable: true,
      repairable: false,
    };
  }

  // ── Truncated JSON — common large-payload failure ────────────────────
  if (lower.includes('truncated') || lower.includes('max_tokens')) {
    return {
      severity: 'low',
      summary: `${noun} was cut off before completing.`,
      suggestion: repairableRaw
        ? 'Repair will ask the model to close the structure and recover what was emitted; cheaper than a full re-run.'
        : 'Retry. Consider scoping smaller (fewer scenes, lighter expansion) if it keeps truncating.',
      retryable: true,
      repairable: repairableRaw,
      repairHint: repairableRaw
        ? `The output appears to have been truncated mid-payload. Close the open array/object with the minimum brackets needed and DO NOT pad missing entries — leave the last value as it appears in the malformed input.`
        : undefined,
    };
  }

  // ── JsonRepairableError (any parse failure) ──────────────────────────
  if ((err && typeof err === 'object' && (err as ErrorLike).name === 'JsonRepairableError') || lower.includes('failed to parse json')) {
    // Try to surface what specifically broke — the parseJson preview block
    // tends to include "unexpected token X" or similar.
    const causeMatch = message.match(/original error:\s*(.+)/i);
    const cause = causeMatch?.[1].split('\n')[0]?.trim();
    return {
      severity: 'low',
      summary: `${noun} returned malformed JSON${cause ? ` (${cause})` : ''}.`,
      suggestion: repairableRaw
        ? 'Repair will ask the model to clean up the syntax — usually succeeds for unescaped quotes, unquoted values, or missing commas.'
        : 'Retry — the response was malformed and there is no raw to repair.',
      retryable: true,
      repairable: repairableRaw,
      repairHint: repairableRaw
        ? `The JSON failed to parse${cause ? ` — error: ${cause}` : ''}. Focus on syntax fixes: balance brackets, escape unescaped quotes inside string values, add missing commas, and quote bare values that should be strings. PRESERVE every key and every value verbatim — never drop or invent fields.`
        : undefined,
    };
  }

  // ── Generic / unknown ────────────────────────────────────────────────
  return {
    severity: 'medium',
    summary: 'Unrecognised generation failure.',
    suggestion: repairableRaw
      ? 'Retry first. If a malformed payload is the issue, Repair can try to clean it up.'
      : 'Retry. If the same error repeats, copy the diagnostic into a bug report.',
    retryable: true,
    repairable: repairableRaw,
  };
}
