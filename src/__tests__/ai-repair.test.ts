import { beforeEach, describe, expect, it, vi } from 'vitest';
import { repairJsonOutput } from '@/lib/ai/repair';
import { callGenerate } from '@/lib/ai/api';
import { ANALYSIS_MODEL, MAX_TOKENS_LARGE } from '@/lib/constants';

// `repairJsonOutput` only talks to the LLM through callGenerate, so we mock
// just the api boundary. Everything we want to assert (system-prompt
// assembly, registered-caller lookup, hint propagation, cleanJson on the
// response) sits inside the function and runs unmocked.
vi.mock('@/lib/ai/api', () => ({
  callGenerate: vi.fn(),
}));

const mockedCallGenerate = vi.mocked(callGenerate);

beforeEach(() => {
  mockedCallGenerate.mockReset();
});

function lastCallArgs() {
  expect(mockedCallGenerate).toHaveBeenCalledTimes(1);
  return mockedCallGenerate.mock.calls[0];
}

describe('repairJsonOutput — system-prompt assembly', () => {
  it('embeds the registered caller context (purpose + schema) for a known caller', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{"ok":true}');
    await repairJsonOutput('{"truncated":', 'generateNarrative');
    const [, systemPrompt] = lastCallArgs();
    expect(systemPrompt).toContain('<original-caller>generateNarrative</original-caller>');
    expect(systemPrompt).toContain('<purpose>');
    // <expected-shape …> carries a `hint=…` attribute, so match the opener loosely
    expect(systemPrompt).toMatch(/<expected-shape\b/);
    expect(systemPrompt).toContain('</expected-shape>');
    expect(systemPrompt).toContain('<priority>');
    // The schema is built by the same generator-side builder — it must reach
    // the repair model with the load-bearing top-level fields intact.
    expect(systemPrompt).toContain('characters');
    expect(systemPrompt).toContain('scenes');
  });

  it('omits the context block entirely for an unknown caller', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{}');
    await repairJsonOutput('{"x":1}', 'somethingUnregistered');
    const [, systemPrompt] = lastCallArgs();
    expect(systemPrompt).not.toContain('<original-caller>');
    expect(systemPrompt).not.toMatch(/<expected-shape\b/);
    expect(systemPrompt).not.toContain('<priority>');
    // Baseline rules still present
    expect(systemPrompt).toContain('strict JSON repair tool');
    expect(systemPrompt).toContain('CLOSE it with the minimum brackets');
  });

  it('appends <diagnosed-issue> when a repair hint is provided, omits it otherwise', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{}');
    await repairJsonOutput('{"x":1}', 'generateScenes', 'truncated mid-payload');
    let [, systemPrompt] = lastCallArgs();
    expect(systemPrompt).toMatch(/<diagnosed-issue\b/);
    expect(systemPrompt).toContain('truncated mid-payload');
    expect(systemPrompt).toContain('</diagnosed-issue>');

    mockedCallGenerate.mockReset();
    mockedCallGenerate.mockResolvedValueOnce('{}');
    await repairJsonOutput('{"x":1}', 'generateScenes');
    [, systemPrompt] = lastCallArgs();
    expect(systemPrompt).not.toMatch(/<diagnosed-issue\b/);
  });

  it('puts the registered context BEFORE the diagnostic hint so the hint reads as a focused override', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{}');
    await repairJsonOutput('{', 'expandWorld', 'unescaped quote in dialogue');
    const [, systemPrompt] = lastCallArgs();
    const ctxIdx = systemPrompt!.indexOf('<original-caller>');
    const hintIdx = systemPrompt!.indexOf('<diagnosed-issue');
    expect(ctxIdx).toBeGreaterThan(-1);
    expect(hintIdx).toBeGreaterThan(-1);
    expect(ctxIdx).toBeLessThan(hintIdx);
  });

  it('covers every registered caller', async () => {
    // Add a new caller? The set must be extended here AND in repair.ts —
    // mismatch surfaces as a failing case rather than silent fallback to the
    // generic baseline.
    for (const caller of ['generateNarrative', 'generateScenes', 'expandWorld']) {
      mockedCallGenerate.mockReset();
      mockedCallGenerate.mockResolvedValueOnce('{}');
      await repairJsonOutput('{}', caller);
      const [, systemPrompt] = mockedCallGenerate.mock.calls[0];
      expect(systemPrompt, `caller=${caller}`).toContain(`<original-caller>${caller}</original-caller>`);
    }
  });
});

describe('repairJsonOutput — request shape', () => {
  it('wraps the raw payload in <malformed> tags in the user prompt', async () => {
    const raw = '{"truncated":';
    mockedCallGenerate.mockResolvedValueOnce('{}');
    await repairJsonOutput(raw, 'generateScenes');
    const [userPrompt] = lastCallArgs();
    expect(userPrompt).toContain('<malformed>');
    expect(userPrompt).toContain(raw);
    expect(userPrompt).toContain('</malformed>');
  });

  it('uses MAX_TOKENS_LARGE, ANALYSIS_MODEL, caller-suffixed log name, no reasoning, JSON mode', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{}');
    await repairJsonOutput('{"x":1}', 'generateScenes');
    const args = lastCallArgs();
    // Signature: (userPrompt, systemPrompt, maxTokens, callerName, model, reasoning, jsonMode)
    expect(args[2]).toBe(MAX_TOKENS_LARGE);
    expect(args[3]).toBe('generateScenes:repair');
    expect(args[4]).toBe(ANALYSIS_MODEL);
    expect(args[5]).toBe(0);
    expect(args[6]).toBe(true);
  });

  it('suffixes the log caller correctly for unknown callers too', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{}');
    await repairJsonOutput('{}', 'unknownThing');
    expect(lastCallArgs()[3]).toBe('unknownThing:repair');
  });
});

describe('repairJsonOutput — response handling', () => {
  it('runs cleanJson on the LLM output (strips code fences, trailing commas)', async () => {
    mockedCallGenerate.mockResolvedValueOnce('```json\n{"ok":true,}\n```');
    const result = await repairJsonOutput('{"ok":', 'generateScenes');
    expect(result).toBe('{"ok":true}');
  });

  it('returns clean JSON unchanged when the model already gives a tidy response', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{"id":"x","scenes":[]}');
    const result = await repairJsonOutput('{"id":"x","scenes":[', 'scenarios');
    expect(result).toBe('{"id":"x","scenes":[]}');
  });

  it('propagates errors from the underlying LLM call', async () => {
    mockedCallGenerate.mockRejectedValueOnce(new Error('429 rate limit'));
    await expect(repairJsonOutput('{', 'generateScenes')).rejects.toThrow('rate limit');
  });
});
