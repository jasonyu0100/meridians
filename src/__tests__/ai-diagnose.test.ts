// Tests for lib/ai/diagnose — error pattern-matcher driving the Repair / Retry diagnostics.

import { describe, expect, it } from 'vitest';
import { diagnoseError } from '@/lib/ai/diagnose';
import { JsonRepairableError } from '@/lib/ai/json';

// `diagnoseError` is the pattern-matcher that drives the API-logs Repair / Retry
// UI. It is pure (no network, no LLM) so we exercise every branch directly. The
// branches form a priority cascade — auth before rate-limit before 5xx before
// network before empty-response before truncation before parse-failure before
// generic — so the tests use string shapes that don't collide between branches.

describe('diagnoseError — auth / config (401, 403, credit)', () => {
  it('treats HTTP 401 as high-severity, non-retryable, non-repairable', () => {
    const d = diagnoseError(new Error('Request failed: 401 Unauthorized'));
    expect(d.severity).toBe('high');
    expect(d.retryable).toBe(false);
    expect(d.repairable).toBe(false);
    expect(d.summary.toLowerCase()).toContain('authentication');
  });

  it('treats HTTP 403 as high-severity auth failure', () => {
    const d = diagnoseError(new Error('403 Forbidden'));
    expect(d.severity).toBe('high');
    expect(d.retryable).toBe(false);
  });

  it('matches plain "unauthorized" / "forbidden" wording without a status code', () => {
    expect(diagnoseError(new Error('Unauthorized')).retryable).toBe(false);
    expect(diagnoseError(new Error('forbidden by policy')).retryable).toBe(false);
  });

  it('matches "api key" / "credit" messages — common OpenRouter wording', () => {
    expect(diagnoseError(new Error('Missing API key')).severity).toBe('high');
    expect(diagnoseError(new Error('Insufficient credit')).severity).toBe('high');
  });
});

describe('diagnoseError — rate limit (429)', () => {
  it('flags 429 as medium retryable, not repairable', () => {
    const d = diagnoseError(new Error('429 Too Many Requests'));
    expect(d.severity).toBe('medium');
    expect(d.retryable).toBe(true);
    expect(d.repairable).toBe(false);
    expect(d.summary.toLowerCase()).toContain('rate limit');
  });

  it('matches the literal phrase "rate limit"', () => {
    expect(diagnoseError(new Error('rate limit exceeded')).retryable).toBe(true);
  });
});

describe('diagnoseError — upstream 5xx', () => {
  it('classifies 500/502/503/504 as transient retryable', () => {
    for (const status of [500, 502, 503, 504]) {
      const d = diagnoseError(new Error(`${status} server error`));
      expect(d.severity).toBe('medium');
      expect(d.retryable).toBe(true);
      expect(d.repairable).toBe(false);
    }
  });

  it('matches "bad gateway" / "service unavailable" wording without a code', () => {
    expect(diagnoseError(new Error('bad gateway')).retryable).toBe(true);
    expect(diagnoseError(new Error('Service unavailable')).retryable).toBe(true);
  });
});

describe('diagnoseError — network / timeout / abort', () => {
  it('handles abort / timeout / ECONNRESET / network wording', () => {
    for (const msg of ['Request aborted', 'fetch timeout', 'ETIMEDOUT', 'socket ECONNRESET', 'network unreachable']) {
      const d = diagnoseError(new Error(msg));
      expect(d.retryable).toBe(true);
      expect(d.repairable).toBe(false);
      expect(d.summary.toLowerCase()).toMatch(/timed out|connection/);
    }
  });
});

describe('diagnoseError — empty response', () => {
  it('marks empty-response as high-severity but retryable', () => {
    const d = diagnoseError(new Error('Empty response from LLM — received no content'));
    expect(d.severity).toBe('high');
    expect(d.retryable).toBe(true);
    expect(d.repairable).toBe(false);
  });
});

describe('diagnoseError — truncation', () => {
  it('returns low severity, retryable, repairable when raw is available', () => {
    const err = Object.assign(new Error('Response truncated mid-array'), { raw: '{"scenes":[{"id":' });
    const d = diagnoseError(err, 'generateScenes');
    expect(d.severity).toBe('low');
    expect(d.retryable).toBe(true);
    expect(d.repairable).toBe(true);
    expect(d.summary.toLowerCase()).toContain('arc + scenes payload');
    expect(d.repairHint).toBeDefined();
    expect(d.repairHint!.toLowerCase()).toContain('truncated');
    expect(d.suggestion.toLowerCase()).toContain('repair');
  });

  it('matches the "max_tokens" hint as truncation', () => {
    const err = Object.assign(new Error('hit max_tokens limit'), { raw: '[' });
    expect(diagnoseError(err).repairable).toBe(true);
  });

  it('returns retryable-only (no repair, no hint) when raw is missing', () => {
    const d = diagnoseError(new Error('Response was truncated'));
    expect(d.repairable).toBe(false);
    expect(d.repairHint).toBeUndefined();
    expect(d.suggestion.toLowerCase()).toContain('retry');
  });

  it('falls back to the generic noun when caller is unknown', () => {
    const err = Object.assign(new Error('truncated'), { raw: '{' });
    const d = diagnoseError(err, 'somethingNotRegistered');
    expect(d.summary.toLowerCase()).toContain('the response');
  });
});

describe('diagnoseError — JSON parse failure (JsonRepairableError)', () => {
  it('matches by `name` even if the message does not include "failed to parse"', () => {
    const err = new JsonRepairableError('generateNarrative', '{"broken', 'something weird');
    const d = diagnoseError(err, 'generateNarrative');
    expect(d.severity).toBe('low');
    expect(d.repairable).toBe(true);
    expect(d.summary.toLowerCase()).toContain('initial narrative payload');
    expect(d.summary.toLowerCase()).toContain('malformed json');
    expect(d.repairHint).toBeDefined();
    expect(d.repairHint!.toLowerCase()).toContain('syntax');
  });

  it('extracts the underlying parser error from "Original error: …"', () => {
    const message =
      '[generateNarrative] Failed to parse JSON\n' +
      'Original error: Unexpected token } in JSON at position 42\n' +
      'Response preview: {"a":1}';
    const err = new JsonRepairableError('generateNarrative', '{"a":1}', message);
    const d = diagnoseError(err, 'generateNarrative');
    expect(d.summary).toContain('Unexpected token }');
    expect(d.repairHint).toContain('Unexpected token }');
  });

  it('matches plain Error whose message contains "failed to parse json"', () => {
    const d = diagnoseError(new Error('Failed to parse JSON: garbled'));
    expect(d.repairable).toBe(false); // no raw attached
    expect(d.summary.toLowerCase()).toContain('malformed');
    expect(d.repairHint).toBeUndefined();
  });
});

describe('diagnoseError — generic fallback', () => {
  it('returns medium severity with repair offered if raw is present', () => {
    const err = Object.assign(new Error('something exploded'), { raw: '{"partial":true}' });
    const d = diagnoseError(err);
    expect(d.severity).toBe('medium');
    expect(d.retryable).toBe(true);
    expect(d.repairable).toBe(true);
    expect(d.suggestion.toLowerCase()).toContain('repair');
  });

  it('returns retry-only when no raw is attached', () => {
    const d = diagnoseError(new Error('what'));
    expect(d.repairable).toBe(false);
    expect(d.repairHint).toBeUndefined();
  });

  it('handles non-Error inputs (string, undefined, plain object)', () => {
    expect(diagnoseError('a string failure').severity).toBe('medium');
    expect(diagnoseError(undefined).severity).toBe('medium');
    expect(diagnoseError({ message: 'plain object' }).severity).toBe('medium');
  });
});

describe('diagnoseError — caller noun lookup', () => {
  it('uses the caller-specific noun for every registered caller', () => {
    const cases: Array<[string, string]> = [
      ['generateNarrative', 'initial narrative payload'],
      ['generateScenes', 'arc + scenes payload'],
      ['expandWorld', 'world expansion payload'],
      ['scenarios', 'scenario arc payload'],
    ];
    for (const [caller, noun] of cases) {
      const err = Object.assign(new Error('truncated'), { raw: '{' });
      const d = diagnoseError(err, caller);
      expect(d.summary.toLowerCase()).toContain(noun);
    }
  });
});

describe('diagnoseError — branch priority', () => {
  it('prefers auth over rate-limit when both keywords appear', () => {
    // 401 + "rate limit" in the same message — auth branch wins (it comes first
    // in the cascade) and the result must be non-retryable.
    const d = diagnoseError(new Error('401 unauthorized: rate limit on free tier'));
    expect(d.retryable).toBe(false);
    expect(d.summary.toLowerCase()).toContain('authentication');
  });

  it('prefers truncation over generic JSON parse when both apply', () => {
    const err = Object.assign(
      new JsonRepairableError(
        'generateScenes',
        '{"scenes":[',
        '[generateScenes] Failed to parse JSON (likely truncated — response hit max_tokens limit)\nOriginal error: Unexpected end',
      ),
      {},
    );
    const d = diagnoseError(err, 'generateScenes');
    // Truncation branch fires first → repairHint mentions "truncated", not the
    // generic "syntax fixes" line from the JSON-parse branch.
    expect(d.repairHint).toBeDefined();
    expect(d.repairHint!.toLowerCase()).toContain('truncated');
    expect(d.repairHint!.toLowerCase()).not.toContain('balance brackets');
  });
});
