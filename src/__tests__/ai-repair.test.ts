// Tests for lib/ai/repair — repairJsonOutput LLM-assisted JSON fix with per-caller schema specs (callGenerate mocked).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { repairJsonOutput, type RepairPlan } from '@/lib/ai/repair';
import { callGenerate } from '@/lib/ai/api';
import { ANALYSIS_MODEL, MAX_TOKENS_LARGE } from '@/lib/constants';

// `repairJsonOutput` only talks to the LLM through callGenerate, so we mock
// just the api boundary. Everything we want to assert (system-prompt
// assembly, registered-caller lookup, plan propagation, cleanJson on the
// response) sits inside the function and runs unmocked.
//
// The new two-stage flow calls planRepair first (when no plan is passed),
// so tests that exercise the repair-stage prompt assembly pass an explicit
// RepairPlan to skip the planning round-trip.
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

const PLAN: RepairPlan = {
  fixable: true,
  issue: 'truncated mid-payload',
  plan: 'Close the open array with ]. Preserve every id verbatim.',
};

describe('repairJsonOutput — system-prompt assembly (plan supplied)', () => {
  it('embeds the registered caller context (purpose + schema) for a known caller', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{"ok":true}');
    await repairJsonOutput('{"truncated":', 'generateNarrative', PLAN);
    const [, systemPrompt] = lastCallArgs();
    expect(systemPrompt).toContain('<original-caller>generateNarrative</original-caller>');
    expect(systemPrompt).toContain('<purpose>');
    expect(systemPrompt).toMatch(/<expected-shape\b/);
    expect(systemPrompt).toContain('</expected-shape>');
    expect(systemPrompt).toContain('<priority>');
    expect(systemPrompt).toContain('characters');
    expect(systemPrompt).toContain('scenes');
  });

  it('omits the context block entirely for an unknown caller', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{}');
    await repairJsonOutput('{"x":1}', 'somethingUnregistered', PLAN);
    const [, systemPrompt] = lastCallArgs();
    expect(systemPrompt).not.toContain('<original-caller>');
    expect(systemPrompt).not.toMatch(/<expected-shape\b/);
    expect(systemPrompt).not.toContain('<priority>');
    // Baseline rules still present
    expect(systemPrompt).toContain('strict JSON repair tool');
    expect(systemPrompt).toContain('CLOSE it with the minimum brackets');
  });

  it('embeds the diagnosis-stage plan as <repair-plan> and the issue as <diagnosed-issue>', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{}');
    await repairJsonOutput('{"x":1}', 'generateScenes', PLAN);
    const [, systemPrompt] = lastCallArgs();
    expect(systemPrompt).toMatch(/<diagnosed-issue\b/);
    expect(systemPrompt).toContain(PLAN.issue);
    expect(systemPrompt).toContain('</diagnosed-issue>');
    expect(systemPrompt).toMatch(/<repair-plan\b/);
    expect(systemPrompt).toContain(PLAN.plan);
    expect(systemPrompt).toContain('</repair-plan>');
  });

  it('puts the registered context BEFORE the plan so the plan reads as a focused override', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{}');
    await repairJsonOutput('{', 'expandWorld', PLAN);
    const [, systemPrompt] = lastCallArgs();
    const ctxIdx = systemPrompt!.indexOf('<original-caller>');
    const planIdx = systemPrompt!.indexOf('<repair-plan');
    expect(ctxIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeGreaterThan(-1);
    expect(ctxIdx).toBeLessThan(planIdx);
  });

  it('refuses to repair when the plan reports the output is not fixable', async () => {
    const unfixable: RepairPlan = {
      fixable: false,
      issue: 'Output is preamble text, not JSON.',
      plan: '',
    };
    await expect(
      repairJsonOutput('Let me think about this...', 'generateScenes', unfixable),
    ).rejects.toThrow(/not repairable/i);
    expect(mockedCallGenerate).not.toHaveBeenCalled();
  });

  it('covers every registered caller', async () => {
    // Add a new caller? The set must be extended here AND in repair.ts —
    // mismatch surfaces as a failing case rather than silent fallback to the
    // generic baseline.
    for (const caller of ['generateNarrative', 'generateScenes', 'expandWorld']) {
      mockedCallGenerate.mockReset();
      mockedCallGenerate.mockResolvedValueOnce('{}');
      await repairJsonOutput('{}', caller, PLAN);
      const [, systemPrompt] = mockedCallGenerate.mock.calls[0];
      expect(systemPrompt, `caller=${caller}`).toContain(`<original-caller>${caller}</original-caller>`);
    }
  });
});

describe('repairJsonOutput — request shape', () => {
  it('wraps the raw payload in <malformed> tags in the user prompt', async () => {
    const raw = '{"truncated":';
    mockedCallGenerate.mockResolvedValueOnce('{}');
    await repairJsonOutput(raw, 'generateScenes', PLAN);
    const [userPrompt] = lastCallArgs();
    expect(userPrompt).toContain('<malformed>');
    expect(userPrompt).toContain(raw);
    expect(userPrompt).toContain('</malformed>');
  });

  it('uses MAX_TOKENS_LARGE, ANALYSIS_MODEL, caller-suffixed log name, no reasoning, JSON mode', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{}');
    await repairJsonOutput('{"x":1}', 'generateScenes', PLAN);
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
    await repairJsonOutput('{}', 'unknownThing', PLAN);
    expect(lastCallArgs()[3]).toBe('unknownThing:repair');
  });

  it('without a plan, runs planRepair first then the repair stage (two callGenerate calls)', async () => {
    // Stage 1: planning model returns a fixable plan as JSON.
    mockedCallGenerate.mockResolvedValueOnce(
      JSON.stringify({ fixable: true, issue: 'truncated', plan: 'Close the open array.' }),
    );
    // Stage 2: repair model returns valid JSON.
    mockedCallGenerate.mockResolvedValueOnce('{"ok":true}');
    await repairJsonOutput('{"truncated":[', 'generateScenes');
    expect(mockedCallGenerate).toHaveBeenCalledTimes(2);
    const [planArgs, repairArgs] = mockedCallGenerate.mock.calls;
    expect(planArgs[3]).toBe('generateScenes:diagnose');
    expect(repairArgs[3]).toBe('generateScenes:repair');
  });
});

describe('repairJsonOutput — response handling', () => {
  it('runs cleanJson on the LLM output (strips code fences, trailing commas)', async () => {
    mockedCallGenerate.mockResolvedValueOnce('```json\n{"ok":true,}\n```');
    const result = await repairJsonOutput('{"ok":', 'generateScenes', PLAN);
    expect(result).toBe('{"ok":true}');
  });

  it('returns clean JSON unchanged when the model already gives a tidy response', async () => {
    mockedCallGenerate.mockResolvedValueOnce('{"id":"x","scenes":[]}');
    const result = await repairJsonOutput('{"id":"x","scenes":[', 'scenarios', PLAN);
    expect(result).toBe('{"id":"x","scenes":[]}');
  });

  it('propagates errors from the underlying LLM call', async () => {
    mockedCallGenerate.mockRejectedValueOnce(new Error('429 rate limit'));
    await expect(repairJsonOutput('{', 'generateScenes')).rejects.toThrow('rate limit');
  });
});
