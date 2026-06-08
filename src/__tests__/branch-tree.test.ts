// Tests for branch-tree — entry origins, parent resolution, and layout of the git-like branch tree.

import { describe, expect, it } from 'vitest';
import {
  buildEntryOrigin,
  resolveBranchTreeParents,
  layoutBranchTree,
  branchLineageIds,
} from '@/lib/branch-tree';
import type { Branch } from '@/types/narrative';

// ── Fixture helper ───────────────────────────────────────────────────────────

function branch(
  id: string,
  parentBranchId: string | null,
  forkEntryId: string | null,
  entryIds: string[],
  createdAt = 0,
): Branch {
  return { id, name: id, parentBranchId, forkEntryId, entryIds, createdAt };
}

// ── buildEntryOrigin ─────────────────────────────────────────────────────────

describe('buildEntryOrigin', () => {
  it('maps each entry to the FIRST branch (in array order) whose entryIds contain it', () => {
    const branches = [
      branch('CANON', null, null, ['c1', 'c2', 'c3']),
      branch('A', 'CANON', 'c2', ['a1', 'a2']),
    ];
    const origin = buildEntryOrigin(branches);
    expect(origin.get('c1')).toBe('CANON');
    expect(origin.get('c2')).toBe('CANON');
    expect(origin.get('c3')).toBe('CANON');
    expect(origin.get('a1')).toBe('A');
    expect(origin.get('a2')).toBe('A');
  });

  it('does NOT reassign an entry whose origin was already set by an earlier branch', () => {
    // If a later branch's entryIds also contains 'c1' (data inconsistency),
    // the first occurrence wins. Canonical entries should stay attributed
    // to their actual originator.
    const branches = [
      branch('CANON', null, null, ['c1']),
      branch('DUPE', 'CANON', null, ['c1', 'd1']),
    ];
    const origin = buildEntryOrigin(branches);
    expect(origin.get('c1')).toBe('CANON');
    expect(origin.get('d1')).toBe('DUPE');
  });

  it('returns an empty map when no branches own any entries', () => {
    const branches = [branch('EMPTY', null, null, [])];
    const origin = buildEntryOrigin(branches);
    expect(origin.size).toBe(0);
  });

  it('returns an empty map for an empty branch list', () => {
    expect(buildEntryOrigin([]).size).toBe(0);
  });
});

// ── resolveBranchTreeParents ─────────────────────────────────────────────────

describe('resolveBranchTreeParents', () => {
  it('roots a branch whose forkEntryId is null', () => {
    const branches = [branch('CANON', null, null, ['c1', 'c2'])];
    const parents = resolveBranchTreeParents(branches);
    expect(parents.get('CANON')).toBe(null);
  });

  it('resolves parent via forkEntryId origin — NOT via parentBranchId chain', () => {
    // parentBranchId chain says: CANON → A → B
    // But B.forkEntryId points to a Canon-originated entry, so the
    // visualisation parent should be CANON, not A.
    const branches = [
      branch('CANON', null, null, ['c1', 'c2', 'c3']),
      branch('A', 'CANON', 'c1', ['a1', 'a2']),
      branch('B', 'A', 'c2', ['b1']),
    ];
    const parents = resolveBranchTreeParents(branches);
    expect(parents.get('A')).toBe('CANON');
    expect(parents.get('B')).toBe('CANON'); // forkEntryId 'c2' originates in CANON
  });

  it('chains correctly when forkEntryId points to a non-canon branch', () => {
    // B forks from an A-originated entry, so the popover places it
    // under A even though A is also under CANON in the chain.
    const branches = [
      branch('CANON', null, null, ['c1', 'c2']),
      branch('A', 'CANON', 'c1', ['a1', 'a2']),
      branch('B', 'A', 'a1', ['b1']),
    ];
    const parents = resolveBranchTreeParents(branches);
    expect(parents.get('A')).toBe('CANON');
    expect(parents.get('B')).toBe('A');
  });

  it('falls back to parentBranchId when forkEntryId cannot be located', () => {
    // forkEntryId 'missing' is not owned by any branch in the set;
    // the resolver should not silently orphan B — it falls back to
    // parentBranchId 'A' which still exists.
    const branches = [
      branch('CANON', null, null, ['c1']),
      branch('A', 'CANON', 'c1', ['a1']),
      branch('B', 'A', 'missing', ['b1']),
    ];
    const parents = resolveBranchTreeParents(branches);
    expect(parents.get('B')).toBe('A');
  });

  it('falls back to null when forkEntryId is missing AND parentBranchId points to a non-existent branch', () => {
    // Hard orphan: neither the fork entry nor the claimed parent
    // resolve. The branch should surface as a root rather than
    // vanishing from the tree.
    const branches = [
      branch('CANON', null, null, ['c1']),
      branch('ORPHAN', 'GHOST', 'phantom', ['o1']),
    ];
    const parents = resolveBranchTreeParents(branches);
    expect(parents.get('ORPHAN')).toBe(null);
  });

  it('refuses to treat a branch as its own parent when forkEntryId origin resolves to self', () => {
    // A degenerate case: the fork-entry's origin is the branch
    // itself. Treat as no parent rather than producing a self-cycle.
    const selfRef = branch('A', 'A', 'a1', ['a1']);
    const parents = resolveBranchTreeParents([selfRef]);
    expect(parents.get('A')).toBe(null);
  });
});

// ── layoutBranchTree ─────────────────────────────────────────────────────────

describe('layoutBranchTree', () => {
  it('orders rows in DFS pre-order with siblings sorted by createdAt', () => {
    // Tree (entry-origin-derived):
    //   CANON (created 0)
    //     ├── A (created 1, forked at c1)
    //     │     └── A1 (created 2, forked at a1)
    //     └── B (created 3, forked at c1)
    const branches = [
      branch('B', 'CANON', 'c1', ['b1'], 3),
      branch('A1', 'A', 'a1', ['a1a'], 2),
      branch('CANON', null, null, ['c1', 'c2'], 0),
      branch('A', 'CANON', 'c1', ['a1', 'a2'], 1),
    ];
    const rows = layoutBranchTree(branches);
    expect(rows.map((r) => r.branch.id)).toEqual(['CANON', 'A', 'A1', 'B']);
  });

  it('assigns the correct depth to each row', () => {
    const branches = [
      branch('CANON', null, null, ['c1', 'c2'], 0),
      branch('A', 'CANON', 'c1', ['a1'], 1),
      branch('A1', 'A', 'a1', ['a1a'], 2),
      branch('A2', 'A1', 'a1a', ['a2a'], 3),
    ];
    const rows = layoutBranchTree(branches);
    const depthOf = Object.fromEntries(rows.map((r) => [r.branch.id, r.depth]));
    expect(depthOf['CANON']).toBe(0);
    expect(depthOf['A']).toBe(1);
    expect(depthOf['A1']).toBe(2);
    expect(depthOf['A2']).toBe(3);
  });

  it('flattens a parentBranchId-chained chain when every fork points back to canon', () => {
    // Data shape that exposed the original bug: A, B, C, D all chain
    // via parentBranchId but every forkEntryId is a CANON-originated
    // entry. The popover must show them as siblings of CANON, matching
    // what the graph view draws.
    const branches = [
      branch('CANON', null, null, ['c1', 'c2', 'c3', 'c4'], 0),
      branch('A', 'CANON', 'c1', ['a1'], 1),
      branch('B', 'A', 'c2', ['b1'], 2),
      branch('C', 'B', 'c3', ['c1x'], 3),
      branch('D', 'C', 'c4', ['d1'], 4),
    ];
    const rows = layoutBranchTree(branches);
    const depthOf = Object.fromEntries(rows.map((r) => [r.branch.id, r.depth]));
    // All non-canon branches forked off CANON entries → they're all
    // depth 1 siblings of CANON, regardless of the createdAt chain.
    expect(depthOf['CANON']).toBe(0);
    expect(depthOf['A']).toBe(1);
    expect(depthOf['B']).toBe(1);
    expect(depthOf['C']).toBe(1);
    expect(depthOf['D']).toBe(1);
  });

  it('records the correct parentRow for each non-root branch', () => {
    const branches = [
      branch('CANON', null, null, ['c1', 'c2'], 0),
      branch('A', 'CANON', 'c1', ['a1'], 1),
      branch('A1', 'A', 'a1', ['a1a'], 2),
    ];
    const rows = layoutBranchTree(branches);
    // Row order: CANON (0), A (1), A1 (2)
    expect(rows[0].parentRow).toBe(null);   // CANON is root
    expect(rows[1].parentRow).toBe(0);      // A → CANON's row
    expect(rows[2].parentRow).toBe(1);      // A1 → A's row
  });

  it('surfaces hard orphans as roots rather than dropping them', () => {
    const branches = [
      branch('CANON', null, null, ['c1'], 0),
      branch('ORPHAN', 'GHOST', 'phantom', ['o1'], 1),
    ];
    const rows = layoutBranchTree(branches);
    // Both branches should appear; ORPHAN at depth 0 because its
    // parent chain doesn't resolve.
    const ids = rows.map((r) => r.branch.id).sort();
    expect(ids).toEqual(['CANON', 'ORPHAN']);
    const orphanRow = rows.find((r) => r.branch.id === 'ORPHAN')!;
    expect(orphanRow.depth).toBe(0);
    expect(orphanRow.parentRow).toBe(null);
  });

  it('returns an empty list for an empty branch set', () => {
    expect(layoutBranchTree([])).toEqual([]);
  });

  it('sorts sibling roots by createdAt — earliest first', () => {
    const branches = [
      branch('LATE', null, null, ['l1'], 5),
      branch('EARLY', null, null, ['e1'], 1),
      branch('MID', null, null, ['m1'], 3),
    ];
    const rows = layoutBranchTree(branches);
    expect(rows.map((r) => r.branch.id)).toEqual(['EARLY', 'MID', 'LATE']);
  });
});

// ── branchLineageIds ─────────────────────────────────────────────────────────

describe('branchLineageIds', () => {
  // CANON → A → B  (linear) with a sibling C off CANON.
  const branches: Record<string, Branch> = {
    CANON: branch('CANON', null, null, []),
    A: branch('A', 'CANON', null, []),
    B: branch('B', 'A', null, []),
    C: branch('C', 'CANON', null, []),
  };

  it('includes the branch itself and every ancestor up to root', () => {
    expect([...branchLineageIds(branches, 'B')].sort()).toEqual(['A', 'B', 'CANON']);
  });

  it('a root branch is its own lineage', () => {
    expect([...branchLineageIds(branches, 'CANON')]).toEqual(['CANON']);
  });

  it('excludes sibling and descendant branches', () => {
    const linA = branchLineageIds(branches, 'A');
    expect(linA.has('C')).toBe(false); // sibling
    expect(linA.has('B')).toBe(false); // descendant
  });

  it('returns empty for null / unknown branch ids', () => {
    expect(branchLineageIds(branches, null).size).toBe(0);
    expect(branchLineageIds(branches, 'NOPE').size).toBe(0);
  });

  it('is cycle-guarded against a malformed parent chain', () => {
    const cyclic: Record<string, Branch> = {
      X: branch('X', 'Y', null, []),
      Y: branch('Y', 'X', null, []),
    };
    // Should terminate and contain exactly the two branches, not loop forever.
    expect([...branchLineageIds(cyclic, 'X')].sort()).toEqual(['X', 'Y']);
  });
});
