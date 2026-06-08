// Tests for lib/forces/stream-stance — the Vision belief engine. A Stream is a
// thread: it opens with an AI-seeded stance, priors apply evidence (with
// outcome expansion), the stance soft-closes on a committal finish, and the
// portfolio classifies into the same categories as the belief system. These
// pin the invariants the Streams UI + commit/history flows depend on.

import { describe, it, expect } from 'vitest';
import {
  openStream,
  applyStreamPrior,
  streamProbs,
  streamMargin,
  streamTrajectory,
  classifyStreamCategory,
} from '@/lib/forces/stream-stance';
import type { Stream } from '@/types/narrative';
import { STANCE_OPENING_VOLUME } from '@/lib/constants';

function open(overrides: Partial<Parameters<typeof openStream>[0]> = {}) {
  return openStream({
    perspectiveId: 'persp-1',
    memberId: 'm-1',
    question: 'Will the storm hit?',
    outcomes: ['Yes', 'No'],
    intuition: 'A gut read.',
    ...overrides,
  });
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('openStream', () => {
  it('opens an open stream with the question, outcomes, a seeded stance, and prior #1', () => {
    const s = open();
    expect(s.state).toBe('open');
    expect(s.title).toBe('Will the storm hit?');
    expect(s.outcomes).toEqual(['Yes', 'No']);
    expect(s.stance).toBeDefined();
    expect(s.stance!.volume).toBe(STANCE_OPENING_VOLUME);
    expect(s.openingLogits).toHaveLength(2);
    // The intuition is stored as the seeding prior (no evidence shift).
    expect(s.priors).toHaveLength(1);
    expect(s.priors[0].text).toBe('A gut read.');
    expect(s.priors[0].updates ?? []).toHaveLength(0);
  });

  it('seeds the stance from priorProbs — a skewed prior leans the distribution', () => {
    const s = open({ priorProbs: [0.85, 0.15] });
    const probs = streamProbs(s);
    expect(probs[0]).toBeGreaterThan(probs[1]);
    expect(sum(probs)).toBeCloseTo(1, 5);
  });

  it('defaults to uniform when no priors are supplied', () => {
    const probs = streamProbs(open());
    expect(probs[0]).toBeCloseTo(0.5, 5);
    expect(probs[1]).toBeCloseTo(0.5, 5);
  });
});

describe('applyStreamPrior', () => {
  it('applies evidence — leans the stance, accrues volume, appends the prior, stamps infoGain', () => {
    const s0 = open();
    const s1 = applyStreamPrior(s0, {
      text: 'Pressure dropping fast.',
      updates: [{ outcome: 'Yes', evidence: 3 }],
      logType: 'escalation',
      volumeDelta: 1,
    });
    const probs = streamProbs(s1);
    expect(probs[0]).toBeGreaterThan(probs[1]); // Yes now leads
    expect(s1.stance!.volume).toBe(STANCE_OPENING_VOLUME + 1);
    expect(s1.stance!.volatility).toBeGreaterThan(0);
    expect(s1.priors).toHaveLength(2);
    expect(s1.priors[1].infoGain).toBeGreaterThan(0);
    expect(s1.priors[1].updates).toEqual([{ outcome: 'Yes', evidence: 3 }]);
    // Immutability — the original stream is untouched.
    expect(s0.priors).toHaveLength(1);
  });

  it('clamps evidence to [-4, 4]', () => {
    const s = applyStreamPrior(open(), { text: 'huge', updates: [{ outcome: 'Yes', evidence: 99 }], logType: 'payoff' });
    expect(s.priors[1].updates![0].evidence).toBe(4);
  });

  it('expands outcomes via addOutcomes (new outcome joins at logit 0)', () => {
    const s = applyStreamPrior(open(), {
      text: 'A third path appears.',
      addOutcomes: ['Maybe'],
      logType: 'twist',
    });
    expect(s.outcomes).toContain('Maybe');
    expect(s.outcomes).toHaveLength(3);
    expect(s.priors[1].addedOutcomes).toContain('Maybe');
    expect(streamProbs(s)).toHaveLength(3);
  });

  it('folds an unknown-outcome update into the market (implicit expansion)', () => {
    const s = applyStreamPrior(open(), {
      text: 'Something new.',
      updates: [{ outcome: 'Delayed', evidence: 2 }],
      logType: 'setup',
    });
    expect(s.outcomes).toContain('Delayed');
  });

  it('soft-closes on a committal finish (payoff, |evidence|≥3, margin past τ) without sealing state', () => {
    let s = open();
    s = applyStreamPrior(s, { text: 'building', updates: [{ outcome: 'Yes', evidence: 4 }], logType: 'escalation' });
    s = applyStreamPrior(s, { text: 'it lands', updates: [{ outcome: 'Yes', evidence: 4 }], logType: 'payoff' });
    expect(s.closedAt).toBeDefined();
    expect(s.closeOutcome).toBe(0); // Yes
    expect(s.resolutionQuality).toBeGreaterThan(0);
    expect(s.resolutionQuality).toBeLessThanOrEqual(1);
    // Soft closure keeps the stream open to further priors.
    expect(s.state).toBe('open');
  });

  it('seals committed / closed streams — no further priors are applied', () => {
    const committed: Stream = { ...open(), state: 'committed' };
    expect(applyStreamPrior(committed, { text: 'late', updates: [{ outcome: 'Yes', evidence: 4 }] })).toBe(committed);

    const closed: Stream = { ...open(), state: 'closed' };
    const after = applyStreamPrior(closed, { text: 'late', updates: [{ outcome: 'Yes', evidence: 4 }] });
    expect(after.priors).toHaveLength(closed.priors.length);
  });
});

describe('streamMargin', () => {
  it('reports the leading outcome and a non-negative margin', () => {
    const s = applyStreamPrior(open(), { text: 'lean yes', updates: [{ outcome: 'Yes', evidence: 3 }], logType: 'escalation' });
    const { topIdx, margin } = streamMargin(s);
    expect(topIdx).toBe(0);
    expect(margin).toBeGreaterThan(0);
  });
});

describe('streamTrajectory', () => {
  it('returns one snapshot per prior, replayed from the opening logits', () => {
    let s = open({ priorProbs: [0.6, 0.4] });
    s = applyStreamPrior(s, { text: 'a', updates: [{ outcome: 'Yes', evidence: 2 }], logType: 'setup' });
    s = applyStreamPrior(s, { text: 'b', updates: [{ outcome: 'No', evidence: 2 }], logType: 'resistance' });
    const traj = streamTrajectory(s);
    expect(traj).toHaveLength(s.priors.length);
    for (const pt of traj) expect(sum(pt.probs)).toBeCloseTo(1, 5);
    // The final trajectory point matches the live stance.
    const last = traj[traj.length - 1];
    streamProbs(s).forEach((p, i) => expect(last.probs[i]).toBeCloseTo(p, 5));
  });
});

describe('classifyStreamCategory', () => {
  it('is resolved once soft-closed', () => {
    const s: Stream = { ...open(), closedAt: Date.now(), closeOutcome: 0 };
    expect(classifyStreamCategory(s)).toBe('resolved');
  });

  it('is contested for a high-entropy multi-outcome stance with volume', () => {
    const s = open({ outcomes: ['A', 'B', 'C'] }); // uniform, volume 2, no movement
    expect(classifyStreamCategory(s)).toBe('contested');
  });

  it('is committed when one outcome clearly leads without saturating', () => {
    // Construct a stance leaning ~80/20 (topProb high, margin below the
    // saturating threshold, entropy below the contested threshold).
    const s: Stream = {
      ...open(),
      stance: { logits: [0.7, -0.7], volume: 2, volatility: 0 },
    };
    expect(classifyStreamCategory(s)).toBe('committed');
  });

  it('is saturating when the margin sits in the near-closed band', () => {
    const s: Stream = { ...open(), stance: { logits: [2.5, 0], volume: 2, volatility: 0 } };
    expect(classifyStreamCategory(s)).toBe('saturating');
  });

  it('is volatile when the stance has been moving sharply', () => {
    const s: Stream = { ...open(), stance: { logits: [0.5, 0], volume: 2, volatility: 0.6 } };
    expect(classifyStreamCategory(s)).toBe('volatile');
  });

  it('is abandoned when volume has decayed below the floor', () => {
    const base = open();
    const s: Stream = {
      ...base,
      stance: { logits: [0, 0], volume: 0.3, volatility: 0 },
      priors: [...base.priors, { id: 'p2', text: 'later', at: base.createdAt + 1 }],
    };
    expect(classifyStreamCategory(s)).toBe('abandoned');
  });
});

describe('streamTrajectory with mid-stream outcome expansion', () => {
  it('pads the replay base so every snapshot covers the grown outcome set', () => {
    let s = open(); // 2 outcomes
    s = applyStreamPrior(s, { text: 'a new path', addOutcomes: ['Maybe'], updates: [{ outcome: 'Maybe', evidence: 2 }], logType: 'twist' });
    expect(s.outcomes).toHaveLength(3);
    const traj = streamTrajectory(s);
    const last = traj[traj.length - 1];
    expect(last.probs).toHaveLength(3);
    expect(sum(last.probs)).toBeCloseTo(1, 5);
    // Earlier snapshots (before the outcome existed) still normalise cleanly.
    expect(sum(traj[0].probs)).toBeCloseTo(1, 5);
  });
});
