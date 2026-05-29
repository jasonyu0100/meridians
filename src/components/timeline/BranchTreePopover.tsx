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
import { layoutBranchTree } from '@/lib/branch-tree';

const BRANCH_COLORS = ['#60A5FA', '#A78BFA', '#34D399', '#F97316', '#F472B6', '#FBBF24'];
function stableBranchColor(id: string, all: Branch[]): string {
  const idx = all.findIndex((b) => b.id === id);
  return BRANCH_COLORS[(idx < 0 ? 0 : idx) % BRANCH_COLORS.length];
}

const ROW_H = 44;          // height per branch row
const INDENT_W = 28;        // px per depth level — large enough that depth
                            // reads as clear nesting rather than near-flat
                            // when a 5+ level chain is stacked.
const RAIL_X = 14;         // x of the leftmost rail line
const DOT_R = 4;

type Props = {
  branches: Branch[];
  activeBranchId: string | null;
  /** Canon branch id (the world view's official record). The matching
   *  row is rendered with a gold ★ + "canon" tag so the operator can
   *  see at a glance which branch is the source of truth, independent
   *  of where the active cursor is. */
  canonBranchId?: string | null;
  onSwitch: (branchId: string) => void;
  onClose: () => void;
  onOpenFullView?: () => void;
  /** Optional formatter — given a branch, return a brief one-line subtitle
   *  (e.g. "3 sc · from main"). Keeps store-shaped concerns out of this
   *  presentational component. */
  formatSubtitle?: (branch: Branch) => string;
};

// Tree shape comes from `layoutBranchTree` (see src/lib/branch-tree.ts)
// so the popover and the graph view agree on hierarchy.

export function BranchTreePopover({
  branches,
  activeBranchId,
  canonBranchId,
  onSwitch,
  onClose,
  onOpenFullView,
  formatSubtitle,
}: Props) {
  const rows = useMemo(() => layoutBranchTree(branches), [branches]);
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
  // Width scales with the tree's max depth so deeply-nested branch names
  // don't get truncated. Base 360px leaves room for the canon star +
  // name + status tag at depth 0; each extra depth level steals INDENT_W
  // pixels for the indent, so we grow the container in lockstep.
  const maxDepth = rows.reduce((acc, r) => Math.max(acc, r.depth), 0);
  const baseWidthPx = 360;
  const widthPx = baseWidthPx + maxDepth * INDENT_W;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 mb-2 max-h-128 flex flex-col rounded-xl border border-white/8 bg-bg-panel/95 backdrop-blur-xl shadow-2xl z-50 overflow-hidden"
      style={{ width: `${widthPx}px` }}
      role="dialog"
      aria-label="Switch branch"
    >
      {/* Header — non-sticky so it can't fight the absolute layer below. */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 shrink-0">
        <span className="text-[10px] uppercase tracking-[0.18em] text-text-dim/80 font-medium">
          Branches <span className="text-text-dim/40 ml-0.5">{branches.length}</span>
        </span>
        {onOpenFullView && (
          <button
            onClick={() => {
              onOpenFullView();
              onClose();
            }}
            className="text-[9px] uppercase tracking-wider text-text-dim/70 hover:text-text-secondary transition-colors"
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
                  strokeOpacity={0.55}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              );
            })}
          </svg>

          {rows.map((node, i) => {
            const b = node.branch;
            const isActive = b.id === activeBranchId;
            const isCanon = b.id === canonBranchId;
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
                className={`absolute left-0 flex items-center text-left transition-colors ${
                  isActive ? 'bg-white/[0.07]' : 'hover:bg-white/[0.035]'
                }`}
                style={{
                  top: i * ROW_H,
                  width: '100%',
                  height: ROW_H,
                  paddingLeft: x + DOT_R + 10,
                  paddingRight: 12,
                }}
              >
                {/* Canon row gets a 2px gold left-edge accent — quieter
                    than tinting the entire row, distinct without
                    competing with the active highlight. */}
                {isCanon && (
                  <span
                    className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-300/80 pointer-events-none"
                    aria-hidden
                  />
                )}
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
                    opacity={isActive ? 1 : 0.7}
                  />
                </svg>

                <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {isCanon && (
                      <span
                        className="shrink-0 text-amber-300/95 leading-none"
                        title="Canon branch — the official record"
                        aria-label="Canon branch"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </span>
                    )}
                    <span
                      className={`text-[12px] leading-tight truncate ${
                        isCanon
                          ? isActive
                            ? 'text-amber-100 font-semibold'
                            : 'text-amber-200/95 font-medium'
                          : isActive
                            ? 'text-text-primary font-semibold'
                            : 'text-text-secondary'
                      }`}
                    >
                      {b.name}
                    </span>
                    {isActive && (
                      <span className="text-[8px] uppercase tracking-[0.16em] text-text-dim/70 shrink-0 ml-auto">
                        current
                      </span>
                    )}
                  </div>
                  {subtitle && (
                    <div className="text-[10px] text-text-dim/60 truncate tabular-nums">{subtitle}</div>
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
