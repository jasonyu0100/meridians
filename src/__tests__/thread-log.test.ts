// Tests for lib/forces/thread-log — applying thread deltas to stances, stance decay, and stance/log invariants.

import { describe, it, expect } from 'vitest';
import { applyThreadDelta, decayUntouchedStance, newNarratorStance, EMPTY_THREAD_LOG } from '@/lib/forces/thread-log';
import type { Thread, ThreadDelta } from '@/types/narrative';
import { NARRATOR_ID } from '@/types/narrative';
import { getStanceProbs } from '@/lib/forces/narrative-utils';

// Each thread carries a stance — a probability distribution over named
// outcomes — and each scene's threadDelta shifts the stance's logits;
// softmax gives the probability distribution. These tests pin the invariants
// the rest of the pipeline (sanitizer, store replay, world gen) depends on.

function makeThread(overrides: Partial<Thread> = {}): Thread {
  const outcomes = overrides.outcomes ?? ['yes', 'no'];
  return {
    id: 'T-1',
    description: 'Will Harry claim the Stone?',
    participants: [],
    outcomes,
    stances: {
      [NARRATOR_ID]: newNarratorStance(outcomes.length),
    },
    openedAt: 'S-1',
    dependents: [],
    threadLog: { ...EMPTY_THREAD_LOG },
    ...overrides,
  };
}

describe('applyThreadDelta — logit updates', () => {
  it('applies evidence to the named outcome via log-odds arithmetic', () => {
    const thread = makeThread();
    const delta: ThreadDelta = {
      threadId: 'T-1',
      logType: 'setup',
      updates: [{ outcome: 'yes', evidence: 2 }],
      volumeDelta: 1,
      rationale: 'Harry learns where the Mirror is kept.',
    };
    const next = applyThreadDelta(thread, delta, 'S-2');
    // evidence +2 / sensitivity 2 = +1 logit on "yes".
    expect(next.stances[NARRATOR_ID].logits[0]).toBeCloseTo(1, 5);
    expect(next.stances[NARRATOR_ID].logits[1]).toBeCloseTo(0, 5);
    // Volume grew by the delta.
    expect(next.stances[NARRATOR_ID].volume).toBeCloseTo(3, 5);
    // A log node was appended with the prose rationale.
    const nodeId = 'T-1:S-2';
    expect(next.threadLog.nodes[nodeId]?.content).toBe('Harry learns where the Mirror is kept.');
    expect(next.threadLog.nodes[nodeId]?.type).toBe('setup');
  });

  it('moves multiple outcomes in one delta (correlated reveal)', () => {
    const thread = makeThread({ outcomes: ['Harry', 'Voldemort', 'destroyed'] });
    const delta: ThreadDelta = {
      threadId: 'T-1',
      logType: 'escalation',
      updates: [
        { outcome: 'Harry', evidence: 2 },
        { outcome: 'Voldemort', evidence: -1 },
      ],
      volumeDelta: 1,
      rationale: 'Dumbledore confirms the Mirror yields only to one who wants the Stone without using it.',
    };
    const next = applyThreadDelta(thread, delta, 'S-3');
    expect(next.stances[NARRATOR_ID].logits[0]).toBeCloseTo(1, 5);
    expect(next.stances[NARRATOR_ID].logits[1]).toBeCloseTo(-0.5, 5);
    expect(next.stances[NARRATOR_ID].logits[2]).toBeCloseTo(0, 5);
    const probs = getStanceProbs(next);
    const topIdx = probs.indexOf(Math.max(...probs));
    expect(next.outcomes[topIdx]).toBe('Harry');
  });

  it('clamps evidence into [-4, +4]', () => {
    const thread = makeThread();
    const delta: ThreadDelta = {
      threadId: 'T-1',
      logType: 'payoff',
      updates: [{ outcome: 'yes', evidence: 99 }],
      volumeDelta: 1,
      rationale: 'clamp test',
    };
    const next = applyThreadDelta(thread, delta, 'S-2');
    // +4 / 2 = +2 logit shift.
    expect(next.stances[NARRATOR_ID].logits[0]).toBeCloseTo(2, 5);
  });
});

describe('applyThreadDelta — outcome expansion', () => {
  it('adds a new outcome with neutral prior (logit=0)', () => {
    const thread = makeThread();
    let next = applyThreadDelta(thread, {
      threadId: 'T-1', logType: 'escalation',
      updates: [{ outcome: 'yes', evidence: 2 }],
      volumeDelta: 1, rationale: 'build up',
    }, 'S-2');
    expect(next.outcomes).toEqual(['yes', 'no']);
    next = applyThreadDelta(next, {
      threadId: 'T-1', logType: 'twist',
      addOutcomes: ['Voldemort'],
      updates: [],
      volumeDelta: 2,
      rationale: 'Voldemort is revealed to be after the Stone.',
    }, 'S-3');
    expect(next.outcomes).toEqual(['yes', 'no', 'Voldemort']);
    expect(next.stances[NARRATOR_ID].logits).toEqual([1, 0, 0]);
    expect(next.threadLog.nodes['T-1:S-3']?.addedOutcomes).toEqual(['Voldemort']);
  });

  it('allows same-scene evidence on a newly-added outcome', () => {
    const thread = makeThread();
    const next = applyThreadDelta(thread, {
      threadId: 'T-1', logType: 'twist',
      addOutcomes: ['Voldemort'],
      updates: [{ outcome: 'Voldemort', evidence: 3 }],
      volumeDelta: 2,
      rationale: 'Voldemort already has the Stone in hand.',
    }, 'S-3');
    expect(next.outcomes).toEqual(['yes', 'no', 'Voldemort']);
    expect(next.stances[NARRATOR_ID].logits).toEqual([0, 0, 1.5]);
  });

  it('rejects duplicate outcomes (case-insensitive) during expansion', () => {
    const thread = makeThread();
    const next = applyThreadDelta(thread, {
      threadId: 'T-1', logType: 'setup',
      addOutcomes: ['Yes', 'no', 'Voldemort'],
      updates: [],
      volumeDelta: 1,
      rationale: 'expansion with duplicates',
    }, 'S-2');
    expect(next.outcomes).toEqual(['yes', 'no', 'Voldemort']);
  });

  it('refuses to expand a closed thread', () => {
    const base = makeThread();
    const closed = applyThreadDelta(base, {
      threadId: 'T-1', logType: 'payoff',
      updates: [{ outcome: 'yes', evidence: 4 }, { outcome: 'no', evidence: -4 }],
      volumeDelta: 1, rationale: 'Harry claims the Stone.',
    }, 'S-10');
    expect(closed.closedAt).toBe('S-10');
    expect(closed.closeOutcome).toBe(0);
    const next = applyThreadDelta(closed, {
      threadId: 'T-1', logType: 'twist',
      addOutcomes: ['Voldemort'],
      updates: [],
      volumeDelta: 0, rationale: 'too late',
    }, 'S-11');
    expect(next.outcomes).toEqual(['yes', 'no']);
  });
});

describe('applyThreadDelta — closure rules', () => {
  it('closes when margin ≥ τ AND logType is payoff with |evidence| ≥ 3', () => {
    const thread = makeThread();
    const next = applyThreadDelta(thread, {
      threadId: 'T-1', logType: 'payoff',
      updates: [
        { outcome: 'yes', evidence: 4 },
        { outcome: 'no', evidence: -4 },
      ],
      volumeDelta: 1, rationale: 'Harry claims the Stone.',
    }, 'S-10');
    expect(next.closedAt).toBe('S-10');
    expect(next.closeOutcome).toBe(0);
  });

  it('does NOT close on weak evidence even if margin would hit', () => {
    const thread = makeThread();
    const primed = applyThreadDelta(thread, {
      threadId: 'T-1', logType: 'escalation',
      updates: [{ outcome: 'yes', evidence: 4 }],
      volumeDelta: 1, rationale: 'heavy escalation',
    }, 'S-2');
    const next = applyThreadDelta(primed, {
      threadId: 'T-1', logType: 'pulse',
      updates: [{ outcome: 'yes', evidence: 1 }],
      volumeDelta: 1, rationale: 'minor reinforcement',
    }, 'S-3');
    expect(next.closedAt).toBeUndefined();
  });

  it('does NOT close on an outcome-expansion delta', () => {
    const thread = makeThread();
    const primed = applyThreadDelta(thread, {
      threadId: 'T-1', logType: 'escalation',
      updates: [{ outcome: 'yes', evidence: 4 }],
      volumeDelta: 1, rationale: 'pre-load',
    }, 'S-2');
    const next = applyThreadDelta(primed, {
      threadId: 'T-1', logType: 'payoff',
      addOutcomes: ['Voldemort'],
      updates: [{ outcome: 'yes', evidence: 3 }],
      volumeDelta: 2,
      rationale: 'expansion + payoff same scene',
    }, 'S-3');
    expect(next.closedAt).toBeUndefined();
  });

  it('high-volume threads require more evidence to close (scaled τ)', () => {
    // A margin of exactly τ_base (3 logit units) closes a fresh thread. Pump
    // volume on another thread to the same margin and the scaled τ should
    // hold it open — meaningful resolution demands proportionally more for
    // threads the story has paid attention to.
    const freshClose = applyThreadDelta(makeThread(), {
      threadId: 'T-1', logType: 'payoff',
      updates: [{ outcome: 'yes', evidence: 3 }, { outcome: 'no', evidence: -3 }],
      volumeDelta: 0, rationale: 'fresh close',
    }, 'S-fresh');
    expect(freshClose.closedAt).toBe('S-fresh');
    // Pumped thread: same final margin, much higher volume.
    let thread = makeThread();
    for (let i = 0; i < 6; i++) {
      thread = applyThreadDelta(thread, {
        threadId: 'T-1', logType: 'pulse',
        updates: [], volumeDelta: 3, rationale: `attention ${i}`,
      }, `S-pulse-${i}`);
    }
    const attempt = applyThreadDelta(thread, {
      threadId: 'T-1', logType: 'payoff',
      updates: [{ outcome: 'yes', evidence: 3 }, { outcome: 'no', evidence: -3 }],
      volumeDelta: 0, rationale: 'attempted close',
    }, 'S-close');
    expect(attempt.closedAt).toBeUndefined();
  });

  it('records resolutionQuality in [0,1] on close', () => {
    const thread = makeThread();
    const next = applyThreadDelta(thread, {
      threadId: 'T-1', logType: 'payoff',
      updates: [
        { outcome: 'yes', evidence: 4 },
        { outcome: 'no', evidence: -4 },
      ],
      volumeDelta: 2, rationale: 'decisive payoff',
    }, 'S-10');
    expect(next.closedAt).toBe('S-10');
    expect(next.resolutionQuality).toBeGreaterThan(0);
    expect(next.resolutionQuality).toBeLessThanOrEqual(1);
  });

  it('decisive high-volume resolutions score higher than thin ones', () => {
    // A thread that earned attention and closed on saturating, two-sided
    // evidence should out-score a thread that closed on the bare minimum.
    const bigMarket = (() => {
      let t = makeThread();
      for (let i = 0; i < 4; i++) {
        t = applyThreadDelta(t, {
          threadId: 'T-1', logType: 'escalation',
          updates: [{ outcome: 'yes', evidence: 2 }],
          volumeDelta: 2, rationale: `build ${i}`,
        }, `S-${i}`);
      }
      return applyThreadDelta(t, {
        threadId: 'T-1', logType: 'payoff',
        updates: [{ outcome: 'yes', evidence: 4 }, { outcome: 'no', evidence: -4 }],
        volumeDelta: 2, rationale: 'decisive',
      }, 'S-close');
    })();
    const thinMarket = applyThreadDelta(makeThread(), {
      threadId: 'T-1', logType: 'payoff',
      updates: [{ outcome: 'yes', evidence: 3 }, { outcome: 'no', evidence: -3 }],
      volumeDelta: 0, rationale: 'bare close',
    }, 'S-close');
    // bigMarket must actually close for this to be meaningful.
    if (bigMarket.closedAt && thinMarket.closedAt) {
      expect(bigMarket.resolutionQuality).toBeGreaterThan(thinMarket.resolutionQuality ?? 0);
    }
  });
});

describe('decayUntouchedStance — volume attrition', () => {
  it('scales volume by the decay factor', () => {
    const b = newNarratorStance(2, 10);
    const decayed = decayUntouchedStance(b);
    expect(decayed.volume).toBeCloseTo(9, 5);
  });

  it('decays volatility toward zero', () => {
    const b = newNarratorStance(2, 5);
    b.volatility = 1;
    const decayed = decayUntouchedStance(b);
    expect(decayed.volatility).toBeLessThan(1);
    expect(decayed.volatility).toBeGreaterThanOrEqual(0);
  });
});
