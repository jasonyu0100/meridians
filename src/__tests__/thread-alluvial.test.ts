// Tests for the Streams influence alluvial: the fixed-size sliding time window,
// per-column time width (bucketMs), branch scoping, and granularity helpers.
// Only the pure data builder is exercised (no React / D3).

import { describe, it, expect } from 'vitest';
import { buildStreamAlluvial, granularityMs } from '@/lib/forces/thread-alluvial';
import type { NarrativeState } from '@/types/narrative';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = 1_900_000_000_000; // fixed epoch ms so buckets don't jitter

function stream(id: string, branchId: string | null, priorAts: number[]) {
  return {
    id,
    branchId,
    title: id,
    state: 'open',
    priors: priorAts.map((at, i) => ({ id: `${id}-${i}`, text: '', at })),
  };
}
function nar(streams: Record<string, ReturnType<typeof stream>>): NarrativeState {
  return { streams } as unknown as NarrativeState;
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

  it('enforces a minimum of 3 cells', () => {
    const d = buildStreamAlluvial(nar({ s1: stream('s1', null, [NOW]) }), {
      window: true, windowUnits: 1, granularity: 'day', nowMs: NOW, branchId: null,
    });
    expect(d.buckets).toHaveLength(3);
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
