import { describe, it, expect } from 'vitest';
import type { NarrativeState, Thread, Scene } from '@/types/narrative';
import { NARRATOR_AGENT_ID } from '@/types/narrative';
import {
  computePortfolioSnapshot,
  buildPortfolioRows,
  buildThreadTrajectory,
  currentFocusIds,
} from '@/lib/portfolio-analytics';

function mkThread(id: string, overrides: Partial<Thread> = {}): Thread {
  const outcomes = overrides.outcomes ?? ['yes', 'no'];
  return {
    id,
    description: `Thread ${id}`,
    participants: [],
    outcomes,
    stances: {
      [NARRATOR_AGENT_ID]: {
        logits: new Array(outcomes.length).fill(0),
        volume: 2, volatility: 0,
        lastTouchedScene: 'S-1',
      },
    },
    openedAt: 'S-0',
    dependents: [],
    threadLog: { nodes: {}, edges: [] },
    ...overrides,
  };
}

function mkScene(id: string, threadDeltas: Scene['threadDeltas'] = []): Scene {
  return {
    kind: 'scene', id, arcId: 'ARC-1', povId: 'C-1', locationId: 'L-1',
    participantIds: [], events: [], threadDeltas,
    worldDeltas: [], relationshipDeltas: [], summary: id,
  };
}

function mkNarrative(threads: Record<string, Thread>, scenes: Record<string, Scene> = {}): NarrativeState {
  return {
    id: 'N-TEST', title: 'T', description: '', characters: {}, locations: {}, artifacts: {},
    threads, scenes, arcs: {}, worldBuilds: {},
    branches: { main: { id: 'main', name: 'Main', parentBranchId: null, forkEntryId: null, entryIds: Object.keys(scenes), createdAt: 0 } },
    relationships: [], systemGraph: { nodes: {}, edges: [] },
    worldSummary: '', createdAt: 0, updatedAt: 0,
  };
}

describe('computePortfolioSnapshot', () => {
  it('buckets threads into active / closed / abandoned and sums belief weight', () => {
    const threads = {
      T1: mkThread('T1', { stances: { [NARRATOR_AGENT_ID]: { logits: [0, 0], volume: 3, volatility: 0 } } }),
      T2: mkThread('T2', {
        closedAt: 'S-10', closeOutcome: 0, resolutionQuality: 0.85,
        stances: { [NARRATOR_AGENT_ID]: { logits: [4, -4], volume: 5, volatility: 0 } },
      }),
      T3: mkThread('T3', { stances: { [NARRATOR_AGENT_ID]: { logits: [0, 0], volume: 0.1, volatility: 0 } } }),
    };
    const snapshot = computePortfolioSnapshot(mkNarrative(threads));
    expect(snapshot.totalThreads).toBe(3);
    expect(snapshot.activeThreads).toBe(1);
    expect(snapshot.closedThreads).toBe(1);
    expect(snapshot.abandonedThreads).toBe(1);
    // Market cap = volume of open threads only.
    expect(snapshot.beliefCap).toBeCloseTo(3, 1);
  });

  it('computes average resolution quality over closed threads', () => {
    const threads = {
      T1: mkThread('T1', { closedAt: 'S-1', closeOutcome: 0, resolutionQuality: 0.8 }),
      T2: mkThread('T2', { closedAt: 'S-2', closeOutcome: 1, resolutionQuality: 0.4 }),
    };
    const snap = computePortfolioSnapshot(mkNarrative(threads));
    expect(snap.averageResolutionQuality).toBeCloseTo(0.6, 5);
    expect(snap.resolutionQualityBands.earned).toBe(1);
    expect(snap.resolutionQualityBands.adequate).toBe(1);
    expect(snap.resolutionQualityBands.thin).toBe(0);
  });

  it('reports null average quality when nothing has closed', () => {
    const snap = computePortfolioSnapshot(mkNarrative({ T1: mkThread('T1') }));
    expect(snap.averageResolutionQuality).toBeNull();
  });
});

describe('buildPortfolioRows', () => {
  it('sorts active threads by focus score; sinks abandoned/resolved to the bottom', () => {
    const threads = {
      CLOSED: mkThread('CLOSED', { closedAt: 'S-1', closeOutcome: 0 }),
      COMMITTED: mkThread('COMMITTED', {
        // Margin ≈ 0.9 (below saturating threshold), topProb ≈ 0.71 → "committed" category.
        stances: { [NARRATOR_AGENT_ID]: { logits: [0.45, -0.45], volume: 2, volatility: 0, lastTouchedScene: 'S-1' } },
      }),
      NEAR: mkThread('NEAR', {
        stances: { [NARRATOR_AGENT_ID]: { logits: [2.5, 0], volume: 2, volatility: 0, lastTouchedScene: 'S-1' } },
      }),
      ABANDONED: mkThread('ABANDONED', {
        stances: { [NARRATOR_AGENT_ID]: { logits: [0, 0], volume: 0.1, volatility: 0 } },
      }),
    };
    const rows = buildPortfolioRows(mkNarrative(threads), ['S-1'], 0);
    const ids = rows.map((r) => r.thread.id);
    // Terminal states (abandoned, then resolved) pinned to the tail.
    expect(ids.indexOf('ABANDONED')).toBeGreaterThan(ids.indexOf('NEAR'));
    expect(ids.indexOf('ABANDONED')).toBeGreaterThan(ids.indexOf('COMMITTED'));
    expect(ids.indexOf('CLOSED')).toBeGreaterThan(ids.indexOf('ABANDONED'));
    // Among active threads, focus score orders them (volume × entropy ×
    // (1 + volatility) × recency). COMMITTED's higher entropy gives it a
    // higher focus score than the near-saturated NEAR here.
    expect(ids.indexOf('COMMITTED')).toBeLessThan(ids.indexOf('NEAR'));
  });

  it('attaches per-row market state (probs, margin, entropy, volume, category)', () => {
    const threads = {
      T1: mkThread('T1', {
        // Margin = 2.5 is in the near-closed band [2, 3) → saturating.
        stances: { [NARRATOR_AGENT_ID]: { logits: [1.25, -1.25], volume: 3, volatility: 0.4, lastTouchedScene: 'S-1' } },
      }),
    };
    const [row] = buildPortfolioRows(mkNarrative(threads), ['S-1'], 0);
    expect(row.probs[0]).toBeGreaterThan(row.probs[1]);
    expect(row.margin).toBeCloseTo(2.5, 5);
    expect(row.volume).toBe(3);
    expect(row.volatility).toBeCloseTo(0.4, 5);
    expect(row.category).toBe('saturating');
  });
});

describe('currentFocusIds', () => {
  it('returns the set of top-K threads selected for generation priority', () => {
    const threads: Record<string, Thread> = {};
    for (let i = 0; i < 10; i++) {
      threads[`T${i}`] = mkThread(`T${i}`, {
        stances: { [NARRATOR_AGENT_ID]: { logits: [0, 0], volume: i + 1, volatility: 0, lastTouchedScene: 'S-1' } },
      });
    }
    const ids = currentFocusIds(mkNarrative(threads), ['S-1'], 0, 3);
    expect(ids.size).toBe(3);
    // Highest-volume threads win focus.
    expect(ids.has('T9')).toBe(true);
    expect(ids.has('T8')).toBe(true);
    expect(ids.has('T7')).toBe(true);
  });
});

describe('buildThreadTrajectory', () => {
  it('replays belief evolution scene-by-scene', () => {
    // openedAt='S-1' ⇒ thread introduced at the first resolved key
    // (strict introduction — see buildThreadTrajectory).
    const threads = { T1: mkThread('T1', { openedAt: 'S-1' }) };
    const scenes: Record<string, Scene> = {
      'S-1': mkScene('S-1', [
        { threadId: 'T1', logType: 'setup', updates: [{ outcome: 'yes', evidence: 2 }], volumeDelta: 1, rationale: 'opens' },
      ]),
      'S-2': mkScene('S-2', [
        { threadId: 'T1', logType: 'escalation', updates: [{ outcome: 'yes', evidence: 3 }], volumeDelta: 1, rationale: 'rises' },
      ]),
    };
    const points = buildThreadTrajectory(mkNarrative(threads, scenes), 'T1', ['S-1', 'S-2']);
    expect(points).toHaveLength(2);
    // Probability on "yes" increases monotonically scene-by-scene.
    expect(points[1].probs[0]).toBeGreaterThan(points[0].probs[0]);
    // Volume grows with each +1 delta.
    expect(points[1].volume).toBeGreaterThan(points[0].volume);
  });

  it('stops replay at closure (trajectory ends at resolved scene)', () => {
    const threads = { T1: mkThread('T1', { openedAt: 'S-1' }) };
    const scenes: Record<string, Scene> = {
      'S-1': mkScene('S-1', [
        { threadId: 'T1', logType: 'payoff', updates: [{ outcome: 'yes', evidence: 4 }, { outcome: 'no', evidence: -4 }], volumeDelta: 1, rationale: 'decisive' },
      ]),
      'S-2': mkScene('S-2', []),
    };
    const points = buildThreadTrajectory(mkNarrative(threads, scenes), 'T1', ['S-1', 'S-2']);
    expect(points).toHaveLength(1);
  });

  it('returns an empty trajectory when openedAt does not resolve on the current branch', () => {
    // Thread's openedAt points at a key NOT in the resolved keys —
    // the thread isn't introduced on this timeline, so we emit no
    // points. The UI renders the prior-line fallback instead.
    const threads = { T1: mkThread('T1', { openedAt: 'S-OFFBRANCH' }) };
    const scenes: Record<string, Scene> = {
      'S-1': mkScene('S-1', []),
      'S-2': mkScene('S-2', []),
    };
    const points = buildThreadTrajectory(mkNarrative(threads, scenes), 'T1', ['S-1', 'S-2']);
    expect(points).toHaveLength(0);
  });

  it('starts the trajectory at openedAt, not the timeline origin', () => {
    // openedAt='S-2' ⇒ thread is introduced at scene 2. Trajectory
    // should have a single point at scene 2; scene 1 is excluded
    // because the thread didn't yet exist there.
    const threads = { T1: mkThread('T1', { openedAt: 'S-2' }) };
    const scenes: Record<string, Scene> = {
      'S-1': mkScene('S-1', []),
      'S-2': mkScene('S-2', [
        { threadId: 'T1', logType: 'setup', updates: [{ outcome: 'yes', evidence: 1 }], volumeDelta: 1, rationale: 'opens' },
      ]),
    };
    const points = buildThreadTrajectory(mkNarrative(threads, scenes), 'T1', ['S-1', 'S-2']);
    expect(points).toHaveLength(1);
    expect(points[0].sceneId).toBe('S-2');
    expect(points[0].sceneOrdinal).toBe(2);
  });
});
