// Tests for lib/forces/thread-category — thread category thresholds, logit energy, and volatile/developing splits.

import { describe, it, expect } from 'vitest';
import type { Thread, ThreadLogNode } from '@/types/narrative';
import { NARRATOR_AGENT_ID } from '@/types/narrative';
import {
  classifyThreadCategory,
  computeRecentLogitEnergy,
  CATEGORY_THRESHOLDS,
} from '@/lib/forces/thread-category';

// Thread category = the single surface-level vocabulary every view renders.
// These tests lock the cross-sectional thresholds (saturating / contested /
// committed), the activity-aware signals (volatile via EWMA OR windowed log
// energy), and the developing/dormant split that replaced the old catch-all.

function mkThread(overrides: Partial<Thread> = {}): Thread {
  const outcomes = overrides.outcomes ?? ['yes', 'no'];
  return {
    id: 'T-1',
    description: 'Test thread',
    participants: [],
    outcomes,
    stances: {
      [NARRATOR_AGENT_ID]: {
        logits: new Array(outcomes.length).fill(0),
        volume: 2,
        volatility: 0,
        lastTouchedScene: 'S-1',
      },
    },
    openedAt: 'S-0',
    dependents: [],
    threadLog: { nodes: {}, edges: [] },
    ...overrides,
  };
}

function mkLogNode(id: string, updates: { outcome: string; evidence: number }[]): ThreadLogNode {
  return { id, type: 'pulse', content: '', sceneId: id.split(':')[1] ?? 'S-?', updates };
}

describe('classifyThreadCategory — terminal states', () => {
  it('returns resolved for closed markets', () => {
    const t = mkThread({ closedAt: 'S-10', closeOutcome: 0 });
    expect(classifyThreadCategory(t)).toBe('resolved');
  });

  it('returns abandoned when volume decayed below the floor', () => {
    const t = mkThread({
      stances: { [NARRATOR_AGENT_ID]: { logits: [0, 0], volume: 0.05, volatility: 0 } },
    });
    expect(classifyThreadCategory(t)).toBe('abandoned');
  });
});

describe('classifyThreadCategory — shape-based categories', () => {
  it('saturating fires when margin is in the near-closed band', () => {
    const t = mkThread({
      stances: { [NARRATOR_AGENT_ID]: { logits: [1.25, -1.25], volume: 3, volatility: 0 } },
    });
    expect(classifyThreadCategory(t)).toBe('saturating');
  });

  it('committed fires when one outcome clearly leads but margin is below saturating', () => {
    const t = mkThread({
      stances: { [NARRATOR_AGENT_ID]: { logits: [0.5, -0.5], volume: 2, volatility: 0 } },
    });
    expect(classifyThreadCategory(t)).toBe('committed');
  });

  it('contested fires when entropy is high and volume is present', () => {
    const t = mkThread({
      outcomes: ['a', 'b', 'c', 'd'],
      stances: { [NARRATOR_AGENT_ID]: { logits: [0, 0, 0, 0], volume: 3, volatility: 0 } },
    });
    expect(classifyThreadCategory(t)).toBe('contested');
  });
});

describe('classifyThreadCategory — volatile via EWMA spike', () => {
  it('fires when EWMA volatility crosses the threshold', () => {
    const t = mkThread({
      stances: { [NARRATOR_AGENT_ID]: { logits: [0.3, -0.3], volume: 2, volatility: 0.6 } },
    });
    expect(classifyThreadCategory(t)).toBe('volatile');
  });
});

describe('classifyThreadCategory — volatile via windowed log energy', () => {
  it('fires when gradual recent drift accumulates past the energy threshold', () => {
    // Three recent log nodes each contributing +2 evidence (= +1 logit shift),
    // totalling 3.0 logits of absolute motion. EWMA volatility may have
    // decayed, but the windowed energy surfaces the real activity.
    const nodes: Record<string, ThreadLogNode> = {
      'T-1:S-2': mkLogNode('T-1:S-2', [{ outcome: 'yes', evidence: 2 }]),
      'T-1:S-3': mkLogNode('T-1:S-3', [{ outcome: 'yes', evidence: 2 }]),
      'T-1:S-4': mkLogNode('T-1:S-4', [{ outcome: 'yes', evidence: 2 }]),
    };
    const t = mkThread({
      stances: { [NARRATOR_AGENT_ID]: { logits: [3, -3], volume: 2, volatility: 0.15 } },
      threadLog: { nodes, edges: [] },
      closedAt: undefined,
    });
    // Sanity: volatility is below threshold on its own.
    expect(t.stances[NARRATOR_AGENT_ID].volatility).toBeLessThan(CATEGORY_THRESHOLDS.volatileMin);
    // But windowed energy catches it.
    expect(computeRecentLogitEnergy(t)).toBeGreaterThanOrEqual(CATEGORY_THRESHOLDS.volatileRecentEnergy);
    // Margin here (= 6) is above TAU_CLOSE so the thread would normally close,
    // but this thread hasn't been closed (closedAt undefined). Classifier
    // treats it as open and should surface the activity signal.
    // Note: saturating only fires in [NEAR_CLOSED_MIN, TAU_CLOSE), so margin=6
    // skips saturating → volatile wins.
    expect(classifyThreadCategory(t)).toBe('volatile');
  });

  it('does NOT fire on log energy below threshold', () => {
    const nodes: Record<string, ThreadLogNode> = {
      'T-1:S-2': mkLogNode('T-1:S-2', [{ outcome: 'yes', evidence: 1 }]),
    };
    const t = mkThread({
      stances: { [NARRATOR_AGENT_ID]: { logits: [0.1, -0.1], volume: 2, volatility: 0.1 } },
      threadLog: { nodes, edges: [] },
    });
    expect(classifyThreadCategory(t)).not.toBe('volatile');
  });
});

describe('classifyThreadCategory — developing vs dormant', () => {
  // Using 3-outcome threads so we can sit in the "no decisive shape" zone:
  // topProb below the committed cutoff AND entropy below the contested cutoff.
  // With probs ≈ [0.60, 0.30, 0.10]: entropy_norm ≈ 0.82 (< 0.85), topProb = 0.60 (< 0.65).
  const MODERATE_LOGITS = [0.79, 0.10, -1.0];

  it('developing when recently touched and no decisive shape (with scene context)', () => {
    const t = mkThread({
      outcomes: ['a', 'b', 'c'],
      stances: { [NARRATOR_AGENT_ID]: { logits: MODERATE_LOGITS, volume: 2, volatility: 0.1 } },
    });
    expect(classifyThreadCategory(t, { scenesSinceTouch: 1 })).toBe('developing');
  });

  it('dormant when touch is older than the recency window (with scene context)', () => {
    const t = mkThread({
      outcomes: ['a', 'b', 'c'],
      stances: { [NARRATOR_AGENT_ID]: { logits: MODERATE_LOGITS, volume: 2, volatility: 0.1 } },
    });
    expect(classifyThreadCategory(t, { scenesSinceTouch: 10 })).toBe('dormant');
  });

  it('dormant when never touched (scenesSinceTouch = Infinity)', () => {
    const t = mkThread({
      outcomes: ['a', 'b', 'c'],
      stances: { [NARRATOR_AGENT_ID]: { logits: MODERATE_LOGITS, volume: 2, volatility: 0 } },
    });
    expect(classifyThreadCategory(t, { scenesSinceTouch: Infinity })).toBe('dormant');
  });

  it('without scene context: developing when log has non-trivial recent energy', () => {
    const nodes: Record<string, ThreadLogNode> = {
      'T-1:S-2': mkLogNode('T-1:S-2', [{ outcome: 'a', evidence: 1 }]),
    };
    const t = mkThread({
      outcomes: ['a', 'b', 'c'],
      stances: { [NARRATOR_AGENT_ID]: { logits: MODERATE_LOGITS, volume: 2, volatility: 0.1 } },
      threadLog: { nodes, edges: [] },
    });
    expect(classifyThreadCategory(t)).toBe('developing');
  });

  it('without scene context: dormant when log is empty', () => {
    const t = mkThread({
      outcomes: ['a', 'b', 'c'],
      stances: { [NARRATOR_AGENT_ID]: { logits: MODERATE_LOGITS, volume: 2, volatility: 0.1 } },
    });
    expect(classifyThreadCategory(t)).toBe('dormant');
  });
});

describe('classifyThreadCategory — screenshot regression', () => {
  // The original bug: a thread visibly breaking out (top-outcome prob 25% →
  // 60% over ~2 scenes) was labelled "dormant" because the EWMA volatility
  // had smoothed below 0.5 and topProb (0.60) sat below the committed cutoff.
  // Expected: recency + recent-energy now push it to a meaningful category.
  it('classifies a recently-breaking-out thread as volatile or developing, never dormant', () => {
    const nodes: Record<string, ThreadLogNode> = {
      // Two +2 evidence pushes on "trapped" over the last two scenes.
      'T-ALI-6:S-20': mkLogNode('T-ALI-6:S-20', [{ outcome: 'trapped', evidence: 2 }]),
      'T-ALI-6:S-21': mkLogNode('T-ALI-6:S-21', [{ outcome: 'trapped', evidence: 2 }]),
    };
    const t: Thread = {
      id: 'T-ALI-6',
      description: 'Can Alice navigate the absurdities of Wonderland?',
      participants: [],
      outcomes: ['trapped', 'loses identity', 'adapts', 'escapes'],
      stances: {
        [NARRATOR_AGENT_ID]: {
          // Logits roughly matching the 60/17/17/6 screenshot distribution.
          logits: [1.25, 0.0, 0.0, -1.0],
          volume: 2.0,
          volatility: 0.18,
          lastTouchedScene: 'S-21',
        },
      },
      openedAt: 'S-2',
      dependents: [],
      threadLog: { nodes, edges: [] },
    };
    const cat = classifyThreadCategory(t, { scenesSinceTouch: 0 });
    expect(cat).not.toBe('dormant');
    // Top prob is ~0.60 — below committed threshold. Two +1-logit pushes in
    // the last two scenes = energy 2.0, well above the volatile threshold.
    expect(cat).toBe('volatile');
  });
});

describe('computeRecentLogitEnergy', () => {
  it('sums absolute logit shifts across the recent window', () => {
    const nodes: Record<string, ThreadLogNode> = {
      'T-1:S-2': mkLogNode('T-1:S-2', [{ outcome: 'yes', evidence: 2 }]),  // +1 logit
      'T-1:S-3': mkLogNode('T-1:S-3', [{ outcome: 'yes', evidence: -1 }]), // +0.5 abs
      'T-1:S-4': mkLogNode('T-1:S-4', [{ outcome: 'yes', evidence: 3 }]),  // +1.5 logit
    };
    const t = mkThread({ threadLog: { nodes, edges: [] } });
    expect(computeRecentLogitEnergy(t, 3)).toBeCloseTo(3.0, 5);
  });

  it('only counts the last N log entries (window slides)', () => {
    const nodes: Record<string, ThreadLogNode> = {
      'T-1:S-2': mkLogNode('T-1:S-2', [{ outcome: 'yes', evidence: 4 }]), // excluded
      'T-1:S-3': mkLogNode('T-1:S-3', [{ outcome: 'yes', evidence: 2 }]),
      'T-1:S-4': mkLogNode('T-1:S-4', [{ outcome: 'yes', evidence: 2 }]),
    };
    const t = mkThread({ threadLog: { nodes, edges: [] } });
    expect(computeRecentLogitEnergy(t, 2)).toBeCloseTo(2.0, 5);
  });

  it('returns 0 for an empty log', () => {
    const t = mkThread();
    expect(computeRecentLogitEnergy(t)).toBe(0);
  });
});
