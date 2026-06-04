// Tests for branch scope control — resolveScopes and default scope state over branch sequence info.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCOPE_STATE,
  resolveScopes,
  type BranchSequenceInfo,
} from '@/components/generation/BranchScopeControl';
import type { ScopeState } from '@/types/narrative';

// ── Test fixtures ────────────────────────────────────────────────────────────

const branches: BranchSequenceInfo[] = [
  { branchId: 'A', name: 'A', color: '#000', length: 10 },
  { branchId: 'B', name: 'B', color: '#000', length: 6 },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolveScopes', () => {
  it('mode=all selects every entry on every branch', () => {
    const state: ScopeState = { mode: 'all', lastN: 5, custom: {} };
    const out = resolveScopes(state, branches, 4);
    expect(out).toEqual([
      { branchId: 'A', start: 1, end: 10 },
      { branchId: 'B', start: 1, end: 6 },
    ]);
  });

  it('mode=last takes the trailing N entries from each branch', () => {
    const state: ScopeState = { mode: 'last', lastN: 3, custom: {} };
    const out = resolveScopes(state, branches, 4);
    // Branch A (length 10): last 3 → 8..10
    // Branch B (length 6): last 3 → 4..6
    expect(out).toEqual([
      { branchId: 'A', start: 8, end: 10 },
      { branchId: 'B', start: 4, end: 6 },
    ]);
  });

  it('mode=last clamps start to 1 when N exceeds branch length', () => {
    const state: ScopeState = { mode: 'last', lastN: 50, custom: {} };
    const out = resolveScopes(state, branches, 4);
    expect(out[0]).toEqual({ branchId: 'A', start: 1, end: 10 });
    expect(out[1]).toEqual({ branchId: 'B', start: 1, end: 6 });
  });

  it('mode=post-divergence starts each branch at the divergence index', () => {
    const state: ScopeState = { mode: 'post-divergence', lastN: 5, custom: {} };
    const out = resolveScopes(state, branches, 4);
    expect(out).toEqual([
      { branchId: 'A', start: 4, end: 10 },
      { branchId: 'B', start: 4, end: 6 },
    ]);
  });

  it('mode=post-divergence clamps to branch length when divergence exceeds it', () => {
    const state: ScopeState = { mode: 'post-divergence', lastN: 5, custom: {} };
    // Divergence past the end of branch B (length 6).
    const out = resolveScopes(state, branches, 12);
    expect(out[1]).toEqual({ branchId: 'B', start: 6, end: 6 });
  });

  it('mode=custom uses per-branch ranges when provided', () => {
    const state: ScopeState = {
      mode: 'custom',
      lastN: 5,
      custom: {
        A: { start: 3, end: 7 },
        B: { start: 2, end: 5 },
      },
    };
    const out = resolveScopes(state, branches, 4);
    expect(out).toEqual([
      { branchId: 'A', start: 3, end: 7 },
      { branchId: 'B', start: 2, end: 5 },
    ]);
  });

  it('mode=custom falls back to full branch when no custom entry exists for a branch', () => {
    const state: ScopeState = {
      mode: 'custom',
      lastN: 5,
      custom: { A: { start: 3, end: 7 } },
    };
    const out = resolveScopes(state, branches, 4);
    expect(out[0]).toEqual({ branchId: 'A', start: 3, end: 7 });
    expect(out[1]).toEqual({ branchId: 'B', start: 1, end: 6 });
  });

  it('returns an empty (0..0) scope for empty branches regardless of mode', () => {
    const empty: BranchSequenceInfo[] = [
      { branchId: 'X', name: 'X', color: '#000', length: 0 },
    ];
    for (const mode of ['all', 'last', 'post-divergence', 'custom'] as const) {
      const state: ScopeState = { mode, lastN: 5, custom: {} };
      expect(resolveScopes(state, empty, 1)[0]).toEqual({
        branchId: 'X',
        start: 0,
        end: 0,
      });
    }
  });

  it('default scope state is post-divergence with sensible defaults', () => {
    expect(DEFAULT_SCOPE_STATE.mode).toBe('post-divergence');
    expect(DEFAULT_SCOPE_STATE.lastN).toBe(5);
    expect(DEFAULT_SCOPE_STATE.custom).toEqual({});
  });
});
