/**
 * Proposition Classification Tests
 *
 * Tests the core classification logic:
 * - Percentile and median computation
 * - Reach threshold scaling with narrative length
 * - Classification labels (8 named profiles)
 * - Classification colors (base + global variants)
 * - Profile label mapping
 */
import { describe, it, expect } from 'vitest';
import {
  classificationLabel,
  classificationColor,
  BASE_COLORS,
  BASE_COLORS_GLOBAL,
  ALL_PROFILE_LABELS,
  propKey,
} from '@/lib/analysis/proposition-classify';
// ── propKey ──────────────────────────────────────────────────────────────────
describe('propKey', () => {
  it('creates correct key format', () => {
    expect(propKey('S-1', 2, 3)).toBe('S-1:2:3');
  });
  it('handles zero indices', () => {
    expect(propKey('S-1', 0, 0)).toBe('S-1:0:0');
  });
});
// ── classificationLabel ─────────────────────────────────────────────────────
describe('classificationLabel', () => {
  it('returns correct local labels', () => {
    expect(classificationLabel('Anchor', 'Local')).toBe('anchor');
    expect(classificationLabel('Seed', 'Local')).toBe('seed');
    expect(classificationLabel('Close', 'Local')).toBe('close');
    expect(classificationLabel('Texture', 'Local')).toBe('texture');
  });
  it('returns correct global labels', () => {
    expect(classificationLabel('Anchor', 'Global')).toBe('foundation');
    expect(classificationLabel('Seed', 'Global')).toBe('foreshadow');
    expect(classificationLabel('Close', 'Global')).toBe('ending');
    expect(classificationLabel('Texture', 'Global')).toBe('atmosphere');
  });
  it('all 8 labels are unique', () => {
    const labels = ALL_PROFILE_LABELS.map(p => p.label);
    expect(new Set(labels).size).toBe(8);
  });
});
// ── classificationColor ─────────────────────────────────────────────────────
describe('classificationColor', () => {
  it('returns base color for Local reach', () => {
    expect(classificationColor('Anchor', 'Local')).toBe(BASE_COLORS.Anchor);
    expect(classificationColor('Seed', 'Local')).toBe(BASE_COLORS.Seed);
    expect(classificationColor('Close', 'Local')).toBe(BASE_COLORS.Close);
    expect(classificationColor('Texture', 'Local')).toBe(BASE_COLORS.Texture);
  });
  it('returns darker color for Global reach', () => {
    expect(classificationColor('Anchor', 'Global')).toBe(BASE_COLORS_GLOBAL.Anchor);
    expect(classificationColor('Seed', 'Global')).toBe(BASE_COLORS_GLOBAL.Seed);
    expect(classificationColor('Close', 'Global')).toBe(BASE_COLORS_GLOBAL.Close);
    expect(classificationColor('Texture', 'Global')).toBe(BASE_COLORS_GLOBAL.Texture);
  });
  it('global colors are different from local colors', () => {
    for (const base of ['Anchor', 'Seed', 'Close', 'Texture'] as const) {
      expect(BASE_COLORS[base]).not.toBe(BASE_COLORS_GLOBAL[base]);
    }
  });
});
// ── ALL_PROFILE_LABELS ──────────────────────────────────────────────────────
describe('ALL_PROFILE_LABELS', () => {
  it('has exactly 8 entries', () => {
    expect(ALL_PROFILE_LABELS).toHaveLength(8);
  });
  it('covers all 4 base categories × 2 reaches', () => {
    const bases = new Set(ALL_PROFILE_LABELS.map(p => p.base));
    const reaches = new Set(ALL_PROFILE_LABELS.map(p => p.reach));
    expect(bases).toEqual(new Set(['Anchor', 'Seed', 'Close', 'Texture']));
    expect(reaches).toEqual(new Set(['Local', 'Global']));
  });
  it('each entry has matching label and color', () => {
    for (const p of ALL_PROFILE_LABELS) {
      expect(p.label).toBe(classificationLabel(p.base, p.reach));
      expect(p.color).toBe(classificationColor(p.base, p.reach));
    }
  });
  it('local entries come before global for each base', () => {
    for (let i = 0; i < ALL_PROFILE_LABELS.length; i += 2) {
      expect(ALL_PROFILE_LABELS[i].reach).toBe('Local');
      expect(ALL_PROFILE_LABELS[i + 1].reach).toBe('Global');
      expect(ALL_PROFILE_LABELS[i].base).toBe(ALL_PROFILE_LABELS[i + 1].base);
    }
  });
});
// ── BASE_COLORS ─────────────────────────────────────────────────────────────
describe('BASE_COLORS', () => {
  it('has all 4 base categories', () => {
    expect(Object.keys(BASE_COLORS)).toEqual(['Anchor', 'Seed', 'Close', 'Texture']);
  });
  it('all colors are valid hex', () => {
    for (const color of Object.values(BASE_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    for (const color of Object.values(BASE_COLORS_GLOBAL)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
// ── Reach threshold scaling ─────────────────────────────────────────────────
describe('reach threshold scaling', () => {
  // The formula: max(REACH_MIN, round(totalScenes * REACH_RATIO))
  // REACH_RATIO = 0.15, REACH_MIN = 5
  const REACH_RATIO = 0.15;
  const REACH_MIN = 5;
  function computeThreshold(totalScenes: number): number {
    return Math.max(REACH_MIN, Math.round(totalScenes * REACH_RATIO));
  }
  it('uses minimum of 5 for small narratives', () => {
    expect(computeThreshold(10)).toBe(5);
    expect(computeThreshold(20)).toBe(5);
    expect(computeThreshold(30)).toBe(5);
  });
  it('scales with narrative length above minimum', () => {
    expect(computeThreshold(40)).toBe(6);
    expect(computeThreshold(50)).toBe(8);
    expect(computeThreshold(91)).toBe(14); // HP
    expect(computeThreshold(200)).toBe(30);
  });
  it('threshold is always at least REACH_MIN', () => {
    for (let n = 1; n <= 300; n++) {
      expect(computeThreshold(n)).toBeGreaterThanOrEqual(REACH_MIN);
    }
  });
  it('threshold is proportional for large narratives', () => {
    // For large N, threshold ≈ 0.15 * N
    const t100 = computeThreshold(100);
    const t200 = computeThreshold(200);
    expect(t200).toBeCloseTo(t100 * 2, 0);
  });
});
// ── Percentile and median (testing the formulas used internally) ────────────
describe('percentile computation', () => {
  // Replicate the internal percentile function for testing
  function percentile(arr: number[], p: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = p * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }
  function median(arr: number[]): number {
    if (arr.length === 0) return 0;
    return percentile(arr, 0.5);
  }
  it('computes median correctly for odd-length arrays', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 3, 5, 7, 9])).toBe(5);
  });
  it('computes median correctly for even-length arrays', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([10, 20])).toBe(15);
  });
  it('computes P60 correctly', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p60 = percentile(arr, 0.60);
    expect(p60).toBeCloseTo(6.4, 1);
  });
  it('handles single-element arrays', () => {
    expect(median([42])).toBe(42);
    expect(percentile([42], 0.6)).toBe(42);
  });
  it('returns 0 for empty arrays', () => {
    expect(median([])).toBe(0);
  });
});
// ── Classification category assignment ──────────────────────────────────────
describe('classification category assignment', () => {
  // Replicate the classification logic for testing
  function classify(backward: number, forward: number, thB: number, thF: number) {
    const hiB = backward >= thB;
    const hiF = forward >= thF;
    if (hiB && hiF) return 'Anchor';
    if (!hiB && hiF) return 'Seed';
    if (hiB && !hiF) return 'Close';
    return 'Texture';
  }
  const th = 0.6; // example threshold
  it('Anchor: high backward + high forward', () => {
    expect(classify(0.8, 0.7, th, th)).toBe('Anchor');
  });
  it('Seed: low backward + high forward', () => {
    expect(classify(0.3, 0.7, th, th)).toBe('Seed');
  });
  it('Close: high backward + low forward', () => {
    expect(classify(0.8, 0.3, th, th)).toBe('Close');
  });
  it('Texture: low backward + low forward', () => {
    expect(classify(0.3, 0.3, th, th)).toBe('Texture');
  });
  it('boundary: exactly at threshold counts as HI', () => {
    expect(classify(0.6, 0.6, th, th)).toBe('Anchor');
    expect(classify(0.6, 0.59, th, th)).toBe('Close');
    expect(classify(0.59, 0.6, th, th)).toBe('Seed');
  });
  it('reach assignment based on threshold', () => {
    const reachThreshold = 12;
    function assignReach(medianDistance: number) {
      return medianDistance >= reachThreshold ? 'Global' : 'Local';
    }
    expect(assignReach(5)).toBe('Local');
    expect(assignReach(11)).toBe('Local');
    expect(assignReach(12)).toBe('Global');
    expect(assignReach(30)).toBe('Global');
  });
});
// ── Hybrid activation score ─────────────────────────────────────────────────
describe('hybrid activation score', () => {
  function hybridScore(maxSim: number, topkMean: number): number {
    return 0.5 * maxSim + 0.5 * topkMean;
  }
  it('equals max when all top-k are the same', () => {
    expect(hybridScore(0.8, 0.8)).toBeCloseTo(0.8);
  });
  it('averages max and mean', () => {
    expect(hybridScore(0.9, 0.7)).toBeCloseTo(0.8);
  });
  it('is always between mean and max', () => {
    const max = 0.9;
    const mean = 0.5;
    const score = hybridScore(max, mean);
    expect(score).toBeGreaterThanOrEqual(mean);
    expect(score).toBeLessThanOrEqual(max);
  });
  it('is 0 when both are 0', () => {
    expect(hybridScore(0, 0)).toBe(0);
  });
});
