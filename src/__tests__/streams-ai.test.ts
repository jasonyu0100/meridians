// Tests for lib/ai/streams — the Vision AI helpers' parsing/normalisation/
// fallbacks (not the model itself). callGenerate is mocked to return canned
// JSON; the real parseJson runs so the cleanup + validation logic is exercised.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as apiModule from '@/lib/ai/api';
import {
  instantiateStream,
  scoreStreamPrior,
  suggestQuestion,
  suggestIntuition,
  suggestPrior,
} from '@/lib/ai/streams';

vi.mock('@/lib/ai/api');
vi.mock('@/lib/core/system-logger', () => ({ logError: vi.fn() }));

const mockReply = (json: string) => vi.mocked(apiModule.callGenerate).mockResolvedValue(json);

beforeEach(() => vi.clearAllMocks());

describe('instantiateStream', () => {
  it('parses outcomes + renormalises priorProbs to sum 1', async () => {
    mockReply(JSON.stringify({ outcomes: ['A', 'B', 'C'], priorProbs: [2, 1, 1], logType: 'setup', horizon: 'medium', rationale: 'r' }));
    const r = await instantiateStream({ question: 'q', intuition: 'i' });
    expect(r.outcomes).toEqual(['A', 'B', 'C']);
    expect(r.priorProbs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(r.priorProbs[0]).toBeGreaterThan(r.priorProbs[1]); // 2 > 1 after norm
  });

  it('falls back to Yes/No when the model returns < 2 outcomes', async () => {
    mockReply(JSON.stringify({ outcomes: ['Only'], priorProbs: [1] }));
    const r = await instantiateStream({ question: 'q', intuition: 'i' });
    expect(r.outcomes).toEqual(['Yes', 'No']);
  });

  it('uses uniform priorProbs when length mismatches the outcomes', async () => {
    mockReply(JSON.stringify({ outcomes: ['A', 'B', 'C'], priorProbs: [0.9, 0.1] }));
    const r = await instantiateStream({ question: 'q', intuition: 'i' });
    expect(r.priorProbs).toHaveLength(3);
    r.priorProbs.forEach((p) => expect(p).toBeCloseTo(1 / 3, 5));
  });

  it('reuses fixedOutcomes verbatim and ignores the model outcomes', async () => {
    mockReply(JSON.stringify({ outcomes: ['X', 'Y'], priorProbs: [0.5, 0.5] }));
    const r = await instantiateStream({ question: 'q', intuition: 'i', fixedOutcomes: ['Trap', 'Safe', 'Unknown'] });
    expect(r.outcomes).toEqual(['Trap', 'Safe', 'Unknown']);
    expect(r.priorProbs).toHaveLength(3); // uniform since model gave 2
  });

  it('defaults an invalid logType/horizon to setup/medium', async () => {
    mockReply(JSON.stringify({ outcomes: ['A', 'B'], priorProbs: [0.5, 0.5], logType: 'bogus', horizon: 'forever' }));
    const r = await instantiateStream({ question: 'q', intuition: 'i' });
    expect(r.logType).toBe('setup');
    expect(r.horizon).toBe('medium');
  });
});

describe('scoreStreamPrior', () => {
  it('parses evidence updates, logType, volumeDelta, and addOutcomes', async () => {
    mockReply(JSON.stringify({ updates: [{ outcome: 'Yes', evidence: 3 }], logType: 'escalation', volumeDelta: 2, addOutcomes: ['Maybe'] }));
    const r = await scoreStreamPrior({ question: 'q', outcomes: ['Yes', 'No'], priorText: 'p' });
    expect(r.updates).toEqual([{ outcome: 'Yes', evidence: 3 }]);
    expect(r.logType).toBe('escalation');
    expect(r.volumeDelta).toBe(2);
    expect(r.addOutcomes).toEqual(['Maybe']);
  });

  it('drops malformed updates and clamps volumeDelta to ≥ 0; bad logType → pulse', async () => {
    mockReply(JSON.stringify({ updates: [{ outcome: 'Yes', evidence: 'x' }, { outcome: 'No', evidence: -2 }], logType: 'nope', volumeDelta: -5 }));
    const r = await scoreStreamPrior({ question: 'q', outcomes: ['Yes', 'No'], priorText: 'p' });
    expect(r.updates).toEqual([{ outcome: 'No', evidence: -2 }]); // string-evidence dropped
    expect(r.logType).toBe('pulse');
    expect(r.volumeDelta).toBe(0);
  });
});

describe('suggestion helpers', () => {
  it('suggestQuestion returns the trimmed question string', async () => {
    mockReply(JSON.stringify({ question: '  What now?  ' }));
    expect(await suggestQuestion({ perspectiveLabel: 'X' })).toBe('What now?');
  });

  it('suggestQuestion tolerates a missing question field', async () => {
    mockReply(JSON.stringify({}));
    expect(await suggestQuestion({})).toBe('');
  });

  it('suggestIntuition returns the trimmed intuition string', async () => {
    mockReply(JSON.stringify({ intuition: '  Lean yes.  ' }));
    expect(await suggestIntuition({ question: 'q' })).toBe('Lean yes.');
  });

  it('suggestPrior returns the trimmed prior string', async () => {
    mockReply(JSON.stringify({ prior: '  A new development.  ' }));
    expect(await suggestPrior({ question: 'q', outcomes: ['Yes', 'No'], priors: [] })).toBe('A new development.');
  });
});
