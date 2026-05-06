import { describe, expect, it } from 'vitest';
import { buildGrid } from '@/components/generation/BranchModal';
import type { Branch } from '@/types/narrative';

// ── Test fixtures ────────────────────────────────────────────────────────────

function branch(
  id: string,
  parentBranchId: string | null,
  forkEntryId: string | null,
  entryIds: string[],
  createdAt = 0,
): Branch {
  return { id, name: id, parentBranchId, forkEntryId, entryIds, createdAt };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildGrid', () => {
  it('returns empty when there is no active branch', () => {
    const out = buildGrid([branch('A', null, null, ['e1'])], null);
    expect(out.columns).toEqual([]);
    expect(out.rows).toEqual([]);
    expect(out.forkConnectors).toEqual([]);
  });

  it('returns empty when there are no branches', () => {
    const out = buildGrid([], 'A');
    expect(out.columns).toEqual([]);
  });

  it('orders columns in DFS pre-order with siblings sorted by createdAt', () => {
    // Tree:
    //   ROOT (created 0)
    //     ├── A (created 1)
    //     │     └── A1 (created 2)
    //     └── B (created 3)
    const branches = [
      branch('B', 'ROOT', 'r1', ['b1'], 3),
      branch('A1', 'A', 'a1', ['a1a'], 2),
      branch('ROOT', null, null, ['r1', 'r2'], 0),
      branch('A', 'ROOT', 'r1', ['a1', 'a2'], 1),
    ];
    const out = buildGrid(branches, 'ROOT');
    expect(out.columns.map((c) => c.branchId)).toEqual(['ROOT', 'A', 'A1', 'B']);
  });

  it('places each entry on exactly one column — its origin', () => {
    // ROOT: r1 r2
    // A forks from r1, owns: a1
    const branches = [
      branch('ROOT', null, null, ['r1', 'r2'], 0),
      branch('A', 'ROOT', 'r1', ['a1'], 1),
    ];
    const out = buildGrid(branches, 'ROOT');
    // Find each entry across all rows; each should appear in exactly one column.
    const occurrences: Record<string, number> = {};
    for (const row of out.rows) {
      for (const eid of row.colEntryIds) {
        if (eid) occurrences[eid] = (occurrences[eid] ?? 0) + 1;
      }
    }
    expect(occurrences).toEqual({ r1: 1, r2: 1, a1: 1 });
  });

  it('computes child startRow as parent forkRow + 1', () => {
    // ROOT entries at rows 0,1
    // A forks from r2 (parent's row 1) → A.startRow = 2 → a1 at row 2
    const branches = [
      branch('ROOT', null, null, ['r1', 'r2'], 0),
      branch('A', 'ROOT', 'r2', ['a1', 'a2'], 1),
    ];
    const out = buildGrid(branches, 'ROOT');
    const rootCol = out.columns.findIndex((c) => c.branchId === 'ROOT');
    const aCol = out.columns.findIndex((c) => c.branchId === 'A');
    // Row 0: r1 on ROOT col only
    expect(out.rows[0].colEntryIds[rootCol]).toBe('r1');
    expect(out.rows[0].colEntryIds[aCol]).toBeNull();
    // Row 1: r2 on ROOT col only
    expect(out.rows[1].colEntryIds[rootCol]).toBe('r2');
    expect(out.rows[1].colEntryIds[aCol]).toBeNull();
    // Row 2: a1 on A col only (ROOT's track ends at r2)
    expect(out.rows[2].colEntryIds[aCol]).toBe('a1');
    expect(out.rows[2].colEntryIds[rootCol]).toBeNull();
  });

  it('attributes fork connectors to the entry origin column, not parentBranchId chain', () => {
    // Tree with inheritance chain:
    //   ROOT owns r1
    //   A forks from r1, owns a1 — A inherits r1 via chain
    //   B forks from r1 (the inherited entry on A), parent A
    // Per "first occurrence" attribution: B's fork connector should originate
    // from ROOT's column (origin of r1), NOT from A's column (which inherited).
    const branches = [
      branch('ROOT', null, null, ['r1'], 0),
      branch('A', 'ROOT', 'r1', ['a1'], 1),
      branch('B', 'A', 'r1', ['b1'], 2),
    ];
    const out = buildGrid(branches, 'A');
    const rootCol = out.columns.findIndex((c) => c.branchId === 'ROOT');
    const bCol = out.columns.findIndex((c) => c.branchId === 'B');
    const fc = out.forkConnectors.find(
      (f) => f.toCol === bCol,
    );
    expect(fc).toBeDefined();
    expect(fc!.fromCol).toBe(rootCol);
  });

  it('every non-root branch with own entries gets a fork connector', () => {
    const branches = [
      branch('ROOT', null, null, ['r1', 'r2'], 0),
      branch('A', 'ROOT', 'r1', ['a1'], 1),
      branch('B', 'ROOT', 'r2', ['b1'], 2),
    ];
    const out = buildGrid(branches, 'ROOT');
    expect(out.forkConnectors).toHaveLength(2);
    const aCol = out.columns.findIndex((c) => c.branchId === 'A');
    const bCol = out.columns.findIndex((c) => c.branchId === 'B');
    expect(out.forkConnectors.find((f) => f.toCol === aCol)).toBeDefined();
    expect(out.forkConnectors.find((f) => f.toCol === bCol)).toBeDefined();
  });

  it('skips fork connectors for branches with no own entries', () => {
    // C exists in tree but has emitted no entries yet.
    const branches = [
      branch('ROOT', null, null, ['r1'], 0),
      branch('C', 'ROOT', 'r1', [], 1),
    ];
    const out = buildGrid(branches, 'ROOT');
    expect(out.forkConnectors).toEqual([]);
  });

  it('places active in its natural DFS position — not forced rightmost', () => {
    // ROOT (active) has children A and B. With active in natural position,
    // children come AFTER active in column order, not before.
    const branches = [
      branch('ROOT', null, null, ['r1'], 0),
      branch('A', 'ROOT', 'r1', ['a1'], 1),
      branch('B', 'ROOT', 'r1', ['b1'], 2),
    ];
    const out = buildGrid(branches, 'ROOT');
    const order = out.columns.map((c) => c.branchId);
    const activeIdx = order.indexOf('ROOT');
    const aIdx = order.indexOf('A');
    const bIdx = order.indexOf('B');
    expect(activeIdx).toBeLessThan(aIdx);
    expect(activeIdx).toBeLessThan(bIdx);
  });

  it('subtree contiguity — a branch and its descendants sit consecutively', () => {
    //   ROOT
    //   ├── A
    //   │    └── A1
    //   └── B
    const branches = [
      branch('ROOT', null, null, ['r1'], 0),
      branch('B', 'ROOT', 'r1', ['b1'], 4),
      branch('A', 'ROOT', 'r1', ['a1'], 1),
      branch('A1', 'A', 'a1', ['a1a'], 2),
    ];
    const out = buildGrid(branches, 'ROOT');
    const order = out.columns.map((c) => c.branchId);
    const aIdx = order.indexOf('A');
    const a1Idx = order.indexOf('A1');
    const bIdx = order.indexOf('B');
    // A's subtree (A, A1) is contiguous; B sits after A's subtree.
    expect(a1Idx).toBe(aIdx + 1);
    expect(bIdx).toBeGreaterThan(a1Idx);
  });

  it('forkConnector.fromRow points at the actual row of the fork entry', () => {
    const branches = [
      branch('ROOT', null, null, ['r1', 'r2', 'r3'], 0),
      branch('A', 'ROOT', 'r2', ['a1'], 1), // forks from r2 (row 1)
    ];
    const out = buildGrid(branches, 'ROOT');
    const aCol = out.columns.findIndex((c) => c.branchId === 'A');
    const fc = out.forkConnectors.find((f) => f.toCol === aCol)!;
    expect(fc.fromRow).toBe(1); // r2's row
    expect(fc.toRow).toBe(2); // A.startRow
  });
});
