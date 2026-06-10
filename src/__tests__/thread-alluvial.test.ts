// Tests for the Influence alluvial. Streams ride a sliding calendar-time window
// (bucketMs, branch scoping, granularity, tag mode, bucket units); Fate / World
// / System read off scene deltas (Unit vs Type bands, bucket size). Only the
// pure data builders are exercised (no React / D3).

import { describe, it, expect } from 'vitest';
import {
  buildStreamAlluvial,
  buildForceAlluvial,
  granularityMs,
} from '@/lib/forces/thread-alluvial';
import type { NarrativeState } from '@/types/narrative';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = 1_900_000_000_000; // fixed epoch ms so buckets don't jitter

function stream(
  id: string,
  branchId: string | null,
  priors: number[] | { at: number; logType?: string }[],
) {
  const norm = priors.map((p) => (typeof p === 'number' ? { at: p } : p));
  return {
    id,
    branchId,
    title: id,
    state: 'open',
    priors: norm.map((p, i) => ({ id: `${id}-${i}`, text: '', at: p.at, logType: p.logType })),
  };
}
function nar(streams: Record<string, ReturnType<typeof stream>>): NarrativeState {
  return { streams } as unknown as NarrativeState;
}

// ── Scene-based fixtures (Fate / World / System) ────────────────────────────
type SceneSpec = {
  arcId?: string;
  threadDeltas?: { threadId: string; logType: string; volumeDelta?: number }[];
  worldDeltas?: { entityId: string; addedNodes: { id: string; content: string; type: string }[] }[];
  systemDeltas?: { addedNodes: { id: string; concept: string; type: string }[]; addedEdges: [] };
};
function scenesNar(specs: Record<string, SceneSpec>): { narrative: NarrativeState; keys: string[] } {
  const keys = Object.keys(specs);
  const scenes: Record<string, unknown> = {};
  for (const id of keys) {
    scenes[id] = { kind: 'scene', id, arcId: specs[id].arcId ?? 'a1', ...specs[id] };
  }
  const narrative = {
    scenes,
    worldBuilds: {},
    arcs: {},
    threads: { t1: { id: 't1', description: 'q1', stances: {} }, t2: { id: 't2', description: 'q2', stances: {} } },
    characters: { c1: { id: 'c1', name: 'Char One' } },
    locations: {},
    artifacts: {},
  } as unknown as NarrativeState;
  return { narrative, keys };
}

describe('granularityMs', () => {
  it('returns the ms width of each unit', () => {
    expect(granularityMs('hour')).toBe(HOUR);
    expect(granularityMs('day')).toBe(DAY);
    expect(granularityMs('week')).toBe(7 * DAY);
  });
});

describe('buildStreamAlluvial — window frame', () => {
  it('returns exactly N cells ending at the cursor, with bucketMs = one unit', () => {
    const d = buildStreamAlluvial(nar({ s1: stream('s1', null, [NOW]) }), {
      window: true, windowUnits: 5, granularity: 'day', nowMs: NOW, branchId: null,
    });
    expect(d.buckets).toHaveLength(5);
    expect(d.bucketMs).toBe(DAY);
    // The prior at NOW lands in the final (cursor) cell.
    expect((d.volumes[4].get('s1') ?? 0)).toBeGreaterThan(0);
    expect(d.currentBucket).toBe(4);
  });

  it('honours small window sizes with no minimum cap', () => {
    const d = buildStreamAlluvial(nar({ s1: stream('s1', null, [NOW]) }), {
      window: true, windowUnits: 1, granularity: 'day', nowMs: NOW, branchId: null,
    });
    expect(d.buckets).toHaveLength(1);
  });

  it('slides with the cursor — stepping nowMs back by one unit shifts the frame', () => {
    const a = buildStreamAlluvial(nar({ s1: stream('s1', null, [NOW]) }), {
      window: true, windowUnits: 3, granularity: 'day', nowMs: NOW, branchId: null,
    });
    const b = buildStreamAlluvial(nar({ s1: stream('s1', null, [NOW]) }), {
      window: true, windowUnits: 3, granularity: 'day', nowMs: NOW - DAY, branchId: null,
    });
    expect(Number(a.buckets[2].key) - Number(b.buckets[2].key)).toBe(DAY);
  });

  it('does NOT collapse when navigated far before the earliest prior', () => {
    const far = buildStreamAlluvial(nar({ s1: stream('s1', null, [NOW]) }), {
      window: true, windowUnits: 4, granularity: 'day', nowMs: NOW - 1000 * DAY, branchId: null,
    });
    expect(far.buckets).toHaveLength(4); // a steady continuum, not 1 stray cell
  });

  it('buckets by the hour when granularity is hour', () => {
    const d = buildStreamAlluvial(nar({ s1: stream('s1', null, [NOW]) }), {
      window: true, windowUnits: 3, granularity: 'hour', nowMs: NOW, branchId: null,
    });
    expect(d.bucketMs).toBe(HOUR);
  });
});

describe('buildStreamAlluvial — branch scoping', () => {
  const n = nar({ a: stream('a', 'b1', [NOW]), b: stream('b', 'b2', [NOW]) });

  it('shows only the active branch\'s streams by default', () => {
    const d = buildStreamAlluvial(n, { window: true, windowUnits: 3, granularity: 'day', nowMs: NOW, branchId: 'b1' });
    expect(d.volumes.some((v) => v.has('a'))).toBe(true);
    expect(d.volumes.some((v) => v.has('b'))).toBe(false);
  });

  it('widens to every branch when allBranches is set', () => {
    const d = buildStreamAlluvial(n, { window: true, windowUnits: 3, granularity: 'day', nowMs: NOW, allBranches: true });
    expect(d.volumes.some((v) => v.has('a'))).toBe(true);
    expect(d.volumes.some((v) => v.has('b'))).toBe(true);
  });
});

describe('buildStreamAlluvial — full mode chunking', () => {
  it('widens bucketMs to groupSize × unit when the span exceeds the column cap', () => {
    const full = buildStreamAlluvial(nar({ s1: stream('s1', null, [NOW - 50 * DAY, NOW]) }), {
      window: false, windowUnits: 5, granularity: 'day', nowMs: NOW, branchId: null,
    });
    expect(full.bucketMs).toBeGreaterThan(DAY);
    expect((full.bucketMs ?? 0) % DAY).toBe(0);
    expect(full.buckets.length).toBeLessThanOrEqual(18);
  });
});

describe('buildStreamAlluvial — Unit vs Type mode', () => {
  const n = nar({
    s1: stream('s1', null, [{ at: NOW, logType: 'setup' }, { at: NOW, logType: 'payoff' }]),
    s2: stream('s2', null, [{ at: NOW, logType: 'setup' }]),
  });

  it('Unit mode bands by stream id', () => {
    const d = buildStreamAlluvial(n, { window: true, windowUnits: 3, granularity: 'day', nowMs: NOW, branchId: null, mode: 'individual' });
    expect(d.volumes[2].has('s1')).toBe(true);
    expect(d.volumes[2].has('s2')).toBe(true);
    expect(d.volumes[2].has('setup')).toBe(false);
  });

  it('Type mode bands by prior logType, summed across streams', () => {
    const d = buildStreamAlluvial(n, { window: true, windowUnits: 3, granularity: 'day', nowMs: NOW, branchId: null, mode: 'tags' });
    expect(d.volumes[2].has('s1')).toBe(false);
    // two `setup` priors (one per stream) + one `payoff`
    expect(d.volumes[2].get('setup')).toBe(2);
    expect(d.volumes[2].get('payoff')).toBe(1);
  });
});

describe('buildStreamAlluvial — bucket units', () => {
  it('widens each window column to bucketUnits × unit', () => {
    const d = buildStreamAlluvial(nar({ s1: stream('s1', null, [NOW]) }), {
      window: true, windowUnits: 4, granularity: 'day', nowMs: NOW, branchId: null, bucketUnits: 2,
    });
    expect(d.buckets).toHaveLength(4);
    expect(d.bucketMs).toBe(2 * DAY);
    // The prior at NOW still lands in the final (cursor) cell.
    expect((d.volumes[3].get('s1') ?? 0)).toBeGreaterThan(0);
  });
});

// ── Fate / World / System (scene-based) ─────────────────────────────────────
describe('buildForceAlluvial — Fate', () => {
  const { narrative, keys } = scenesNar({
    sc1: { threadDeltas: [{ threadId: 't1', logType: 'escalation' }] },
    sc2: { threadDeltas: [{ threadId: 't1', logType: 'payoff' }, { threadId: 't2', logType: 'setup' }] },
  });

  it('Unit mode bands by thread', () => {
    const d = buildForceAlluvial(narrative, keys, 1, false, 11, 'fate', 'individual');
    expect(d.volumes[0].get('t1')).toBe(1);
    expect(d.volumes[1].get('t1')).toBe(1);
    expect(d.volumes[1].get('t2')).toBe(1);
    expect(d.threadOrder).toContain('t1');
    expect(d.threadOrder).toContain('t2');
  });

  it('Type mode bands by logType primitive', () => {
    const d = buildForceAlluvial(narrative, keys, 1, false, 11, 'fate', 'tags');
    expect(d.volumes[0].get('escalation')).toBe(1);
    expect(d.volumes[1].get('payoff')).toBe(1);
    expect(d.volumes[1].get('setup')).toBe(1);
    expect(d.volumes[1].has('t1')).toBe(false);
  });

  it('folds volumeDelta into attention', () => {
    const { narrative: nv, keys: ks } = scenesNar({
      sc1: { threadDeltas: [{ threadId: 't1', logType: 'escalation', volumeDelta: 3 }] },
    });
    const d = buildForceAlluvial(nv, ks, 0, false, 11, 'fate', 'individual');
    expect(d.volumes[0].get('t1')).toBe(4); // 1 base + 3 volumeDelta
  });
});

describe('buildForceAlluvial — World', () => {
  const { narrative, keys } = scenesNar({
    sc1: { worldDeltas: [{ entityId: 'c1', addedNodes: [
      { id: 'n1', content: '', type: 'trait' },
      { id: 'n2', content: '', type: 'state' },
    ] }] },
  });

  it('Unit mode bands by entity, volume = added node count', () => {
    const d = buildForceAlluvial(narrative, keys, 0, false, 11, 'world', 'individual');
    expect(d.volumes[0].get('c1')).toBe(2);
    expect(d.meta.get('c1')?.label).toBe('Char One');
  });

  it('Type mode bands by WorldNodeType', () => {
    const d = buildForceAlluvial(narrative, keys, 0, false, 11, 'world', 'tags');
    expect(d.volumes[0].get('trait')).toBe(1);
    expect(d.volumes[0].get('state')).toBe(1);
    expect(d.volumes[0].has('c1')).toBe(false);
  });
});

describe('buildForceAlluvial — System (type-only)', () => {
  const { narrative, keys } = scenesNar({
    sc1: { systemDeltas: { addedNodes: [
      { id: 's1', concept: '', type: 'principle' },
      { id: 's2', concept: '', type: 'system' },
    ], addedEdges: [] } },
  });

  it('bands by SystemNodeType', () => {
    const d = buildForceAlluvial(narrative, keys, 0, false, 11, 'system', 'tags');
    expect(d.volumes[0].get('principle')).toBe(1);
    expect(d.volumes[0].get('system')).toBe(1);
  });
});

describe('buildForceAlluvial — bucket size', () => {
  const fourScenes = scenesNar({
    sc1: { threadDeltas: [{ threadId: 't1', logType: 'pulse' }] },
    sc2: { threadDeltas: [{ threadId: 't1', logType: 'pulse' }] },
    sc3: { threadDeltas: [{ threadId: 't1', logType: 'pulse' }] },
    sc4: { threadDeltas: [{ threadId: 't1', logType: 'pulse' }] },
  });

  it('aggregates bucketSize consecutive scenes into one window column', () => {
    const { narrative, keys } = fourScenes;
    const d = buildForceAlluvial(narrative, keys, 0, true, 11, 'fate', 'individual', 2);
    expect(d.buckets).toHaveLength(2); // 4 scenes / 2-per-column
    expect(d.volumes[0].get('t1')).toBe(2);
    expect(d.volumes[1].get('t1')).toBe(2);
  });

  it('Full mode separates the whole span by bucketSize (not by arc)', () => {
    const { narrative, keys } = fourScenes;
    const perScene = buildForceAlluvial(narrative, keys, 0, false, 11, 'fate', 'individual', 1);
    expect(perScene.buckets).toHaveLength(4); // one column per scene at size 1

    const grouped = buildForceAlluvial(narrative, keys, 0, false, 11, 'fate', 'individual', 2);
    expect(grouped.buckets).toHaveLength(2); // two scenes per column
    expect(grouped.volumes[0].get('t1')).toBe(2);
    expect(grouped.volumes[1].get('t1')).toBe(2);
  });
});
