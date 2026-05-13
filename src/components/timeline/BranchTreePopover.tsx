'use client';

/**
 * Floating tree-shaped branch switcher, anchored off the timeline strip's
 * branch chip. Shows the branch lineage as an indented tree with curved
 * parent → child connectors — the same DFS ordering and origin-attribution
 * `BranchModal.buildGrid` uses, just rendered vertically as a compact
 * lineage view instead of a full timeline map.
 *
 * Visual cues:
 *   • depth via indent + connector lines from the parent's column
 *   • per-branch colour stripe (stable, derived from creation order)
 *   • active row highlighted; current branch tagged
 *   • click anywhere on the row to switch
 *   • hover reveals a "View in branches…" affordance that defers to the
 *     full BranchModal for advanced operations (rename, delete, compare)
 */

import { useMemo, useRef, useEffect } from 'react';
import type { Branch } from '@/types/narrative';

const BRANCH_COLORS = ['#60A5FA', '#A78BFA', '#34D399', '#F97316', '#F472B6', '#FBBF24'];
function stableBranchColor(id: string, all: Branch[]): string {
  const idx = all.findIndex((b) => b.id === id);
  return BRANCH_COLORS[(idx < 0 ? 0 : idx) % BRANCH_COLORS.length];
}

const ROW_H = 36;          // height per branch row
const INDENT_W = 16;       // px per depth level
const RAIL_X = 12;         // x of the leftmost rail line
const DOT_R = 4;

type Props = {
  branches: Branch[];
  activeBranchId: string | null;
  onSwitch: (branchId: string) => void;
  onClose: () => void;
  onOpenFullView?: () => void;
  /** Optional formatter — given a branch, return a brief one-line subtitle
   *  (e.g. "3 sc · from main"). Keeps store-shaped concerns out of this
   *  presentational component. */
  formatSubtitle?: (branch: Branch) => string;
};

type LayoutNode = {
  branch: Branch;
  depth: number;
  parentRow: number | null;
};

/** DFS pre-order from roots; siblings ordered by createdAt for stability.
 *  Same algorithm as BranchModal.buildGrid so the row order matches what
 *  the user already sees in the full graph view. */
function layout(allBranches: Branch[]): LayoutNode[] {
  const byId = new Map(allBranches.map((b) => [b.id, b]));
  const childrenOf = new Map<string | null, Branch[]>();
  for (const b of allBranches) {
    const key = b.parentBranchId ?? null;
    const list = childrenOf.get(key) ?? [];
    list.push(b);
    childrenOf.set(key, list);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }
  const rows: LayoutNode[] = [];
  const rowOf = new Map<string, number>();
  function dfs(id: string, depth: number) {
    const branch = byId.get(id);
    if (!branch) return;
    const parentRow = branch.parentBranchId ? rowOf.get(branch.parentBranchId) ?? null : null;
    rowOf.set(id, rows.length);
    rows.push({ branch, depth, parentRow });
    const children = childrenOf.get(id) ?? [];
    for (const child of children) dfs(child.id, depth + 1);
  }
  const roots = childrenOf.get(null) ?? [];
  for (const root of roots) dfs(root.id, 0);
  return rows;
}

export function BranchTreePopover({
  branches,
  activeBranchId,
  onSwitch,
  onClose,
  onOpenFullView,
  formatSubtitle,
}: Props) {
  const rows = useMemo(() => layout(branches), [branches]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside + Esc to close. The popover is meant to feel like a
  // contextual menu — escape-able and dismissable without commitment.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (rows.length === 0) return null;

  const treeHeight = rows.length * ROW_H + 8;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 mb-2 w-80 max-h-96 flex flex-col rounded-lg border border-white/10 bg-bg-panel/95 backdrop-blur-xl shadow-2xl z-50 overflow-hidden"
      role="dialog"
      aria-label="Switch branch"
    >
      {/* Header — non-sticky so it can't fight the absolute layer below. */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/6 shrink-0 bg-bg-panel">
        <span className="text-[10px] uppercase tracking-widest text-text-dim">
          Branches <span className="text-text-dim/50">({branches.length})</span>
        </span>
        {onOpenFullView && (
          <button
            onClick={() => {
              onOpenFullView();
              onClose();
            }}
            className="text-[9px] uppercase tracking-wider text-text-dim hover:text-text-primary transition-colors"
            title="Open the full branch graph for rename / delete / compare"
          >
            Open full view →
          </button>
        )}
      </div>

      {/* Scroll body — rows + connectors share one absolutely-positioned
          coordinate space, so layout is deterministic and there's no
          flow-vs-absolute conflict that could overlap the header. */}
      <div className="overflow-y-auto flex-1">
        <div className="relative" style={{ height: treeHeight }}>
          <svg
            className="absolute inset-0 pointer-events-none"
            width="100%"
            height={treeHeight}
          >
            {/* Parent → child connectors. Vertical drop from parent's dot
                to the child's row, then a short horizontal hook into the
                child's dot. */}
            {rows.map((node, i) => {
              if (node.parentRow == null) return null;
              const parent = rows[node.parentRow];
              const parentX = RAIL_X + parent.depth * INDENT_W;
              const childX = RAIL_X + node.depth * INDENT_W;
              const parentY = node.parentRow * ROW_H + ROW_H / 2;
              const childY = i * ROW_H + ROW_H / 2;
              const c = stableBranchColor(node.branch.id, branches);
              return (
                <path
                  key={`conn-${node.branch.id}`}
                  d={`M ${parentX} ${parentY + DOT_R + 1} L ${parentX} ${childY} L ${childX - DOT_R - 1} ${childY}`}
                  stroke={c}
                  strokeOpacity={0.35}
                  strokeWidth={1.5}
                  fill="none"
                />
              );
            })}
          </svg>

          {rows.map((node, i) => {
            const b = node.branch;
            const isActive = b.id === activeBranchId;
            const c = stableBranchColor(b.id, branches);
            const x = RAIL_X + node.depth * INDENT_W;
            const subtitle = formatSubtitle ? formatSubtitle(b) : '';
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  onSwitch(b.id);
                  onClose();
                }}
                className={`absolute left-0 flex items-center gap-2 text-left transition-colors ${
                  isActive ? 'bg-white/8' : 'hover:bg-white/4'
                }`}
                style={{
                  top: i * ROW_H,
                  width: '100%',
                  height: ROW_H,
                  paddingLeft: x + DOT_R + 6,
                  paddingRight: 8,
                }}
              >
                {/* Dot at this depth, layered on top of the connector line */}
                <svg
                  className="absolute pointer-events-none"
                  style={{ left: x - DOT_R, top: ROW_H / 2 - DOT_R }}
                  width={DOT_R * 2}
                  height={DOT_R * 2}
                >
                  <circle
                    cx={DOT_R}
                    cy={DOT_R}
                    r={DOT_R}
                    fill={isActive ? c : 'transparent'}
                    stroke={c}
                    strokeWidth={1.5}
                    opacity={isActive ? 1 : 0.8}
                  />
                </svg>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`text-[11px] leading-snug truncate ${
                        isActive ? 'text-text-primary font-semibold' : 'text-text-secondary'
                      }`}
                    >
                      {b.name}
                    </span>
                    {isActive && (
                      <span className="text-[8px] uppercase tracking-wider text-text-dim shrink-0">
                        current
                      </span>
                    )}
                  </div>
                  {subtitle && (
                    <div className="text-[9px] text-text-dim/70 font-mono truncate">{subtitle}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
