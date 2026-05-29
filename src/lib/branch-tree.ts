import type { Branch } from '@/types/narrative';

/**
 * Branch-tree primitives shared by every surface that visualises the
 * branch hierarchy as a nested tree (`BranchTreePopover`, and the
 * column-ordering / fork-connector logic inside `BranchModal.buildGrid`).
 *
 * The load-bearing idea: in InkTide, the "true" fork point of a branch
 * is not the abstract `parentBranchId` (which records the creation-time
 * ancestor) but `forkEntryId` — the entry where the branch peeled off
 * its actual history. Two branches that the data chains as
 * Canon → A → B → C may, in entry-space, all fork directly off Canon
 * at different scenes. The graph view encodes this by drawing fork
 * connectors from the column of the entry's ORIGIN; the popover encodes
 * it by nesting branches under the originator of their forkEntry. Both
 * use the same primitive: `entryOrigin[forkEntryId]`.
 */

// ── entryOrigin: which branch first introduced each entry ────────────────

/**
 * Map every entry id to the branch that ORIGINATED it — the first
 * branch (in array order) whose own `entryIds` contains the entry.
 * Subsequent branches that include the entry inherited it via the
 * parent chain; the origin is the canonical "owner" for fork
 * attribution.
 */
export function buildEntryOrigin(allBranches: Branch[]): Map<string, string> {
  const origin = new Map<string, string>();
  for (const b of allBranches) {
    for (const eid of b.entryIds) {
      if (!origin.has(eid)) origin.set(eid, b.id);
    }
  }
  return origin;
}

// ── Tree parent resolution ───────────────────────────────────────────────

/**
 * Resolve each branch's tree parent for nested-tree rendering.
 *
 * Primary signal: `entryOrigin[branch.forkEntryId]` — the branch that
 * originated the fork entry is the visualisation parent. This matches
 * what the graph view draws: a branch hooks off the column of its
 * fork-entry's origin, regardless of how the createdAt chain runs.
 *
 * Fallbacks (in order):
 *   • If the fork entry can't be located in any branch's entryIds
 *     (data inconsistency), fall back to `parentBranchId` if it
 *     points to an existing branch.
 *   • Self-referential origins (the branch's own forkEntry resolves
 *     to itself) are treated as no parent — a branch can't fork off
 *     itself.
 *   • Anything else returns null, surfacing the branch as a root.
 */
export function resolveBranchTreeParents(
  allBranches: Branch[],
): Map<string, string | null> {
  const byId = new Map(allBranches.map((b) => [b.id, b]));
  const entryOrigin = buildEntryOrigin(allBranches);
  const parentOf = new Map<string, string | null>();
  for (const b of allBranches) {
    let parent: string | null = null;
    if (b.forkEntryId) {
      const origin = entryOrigin.get(b.forkEntryId);
      if (origin && origin !== b.id) parent = origin;
    }
    // Fallback to parentBranchId only if it resolves to a different,
    // existing branch — never to self.
    if (
      !parent &&
      b.parentBranchId &&
      b.parentBranchId !== b.id &&
      byId.has(b.parentBranchId)
    ) {
      parent = b.parentBranchId;
    }
    parentOf.set(b.id, parent);
  }
  return parentOf;
}

// ── Layout ───────────────────────────────────────────────────────────────

/** Node in the laid-out tree — branch + its depth in the nested view +
 *  the row index of its parent (null when this branch is a root). */
export type BranchTreeNode = {
  branch: Branch;
  depth: number;
  parentRow: number | null;
};

/**
 * DFS pre-order from roots; siblings ordered by `createdAt` for
 * stability. Each row carries its depth (for indent) and its parent's
 * row index (for drawing connectors). Roots have `parentRow = null`.
 *
 * The tree shape comes from `resolveBranchTreeParents`, so the result
 * agrees with the graph view's fork visualisation.
 */
export function layoutBranchTree(allBranches: Branch[]): BranchTreeNode[] {
  const byId = new Map(allBranches.map((b) => [b.id, b]));
  const treeParent = resolveBranchTreeParents(allBranches);

  const childrenOf = new Map<string | null, Branch[]>();
  for (const b of allBranches) {
    const key = treeParent.get(b.id) ?? null;
    const list = childrenOf.get(key) ?? [];
    list.push(b);
    childrenOf.set(key, list);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }

  const rows: BranchTreeNode[] = [];
  const rowOf = new Map<string, number>();
  function dfs(id: string, depth: number) {
    const branch = byId.get(id);
    if (!branch) return;
    const parentId = treeParent.get(id) ?? null;
    const parentRow = parentId ? rowOf.get(parentId) ?? null : null;
    rowOf.set(id, rows.length);
    rows.push({ branch, depth, parentRow });
    const children = childrenOf.get(id) ?? [];
    for (const child of children) dfs(child.id, depth + 1);
  }
  const roots = childrenOf.get(null) ?? [];
  for (const root of roots) dfs(root.id, 0);
  return rows;
}
