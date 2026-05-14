'use client';

import { useState, useMemo, useRef, useLayoutEffect } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntrySequence } from '@/lib/narrative-utils';
import { Modal } from '@/components/Modal';
import { BranchChat } from './BranchChat';
import type { Branch, NarrativeState } from '@/types/narrative';

// ─── Colours ──────────────────────────────────────────────────────────────────

const BRANCH_COLORS = ['#60A5FA', '#A78BFA', '#34D399', '#F97316', '#F472B6', '#FBBF24'];
const bColor = (ci: number) => BRANCH_COLORS[ci % BRANCH_COLORS.length];

function stableBranchColor(branchId: string, allBranches: Branch[]): string {
  const idx = allBranches.findIndex(b => b.id === branchId);
  return bColor(idx >= 0 ? idx : 0);
}

// ─── Graph layout ─────────────────────────────────────────────────────────────

const ROW_H = 38;
const COL_W = 28;
const DOT_R = 6;
const LPAD = 14;

/** Maximum branches that can be compared side-by-side. Beyond this the
 *  oldest selection drops when a new one is added. */
const MAX_COMPARE_BRANCHES = 10;

function colX(col: number): number {
  return LPAD + col * COL_W;
}

export type GridRow = { colEntryIds: (string | null)[] };
export type ForkConnector = { fromRow: number; fromCol: number; toRow: number; toCol: number };

export function buildGrid(
  allBranches: Branch[],
  activeBranchId: string | null,
): { columns: { branchId: string }[]; rows: GridRow[]; forkConnectors: ForkConnector[] } {
  if (!activeBranchId || allBranches.length === 0) {
    return { columns: [], rows: [], forkConnectors: [] };
  }

  const byId = new Map(allBranches.map(b => [b.id, b]));

  // Each entry id is owned by exactly one branch — the branch whose own
  // `entryIds` contains it. That's its "first occurrence" / origin. All
  // other branches that contain the entry inherited it via the parent
  // chain. Fork attribution is based on origin so connectors always run
  // from the column that actually drew the entry, never from empty space.
  const entryOrigin = new Map<string, string>();
  for (const b of allBranches) {
    for (const eid of b.entryIds) {
      if (!entryOrigin.has(eid)) entryOrigin.set(eid, b.id);
    }
  }

  // Column ordering: explicit DFS pre-order from roots, with siblings sorted
  // by createdAt for stability. Each branch's full subtree is contiguous —
  // parents always sit to the left of their descendants — so fork connectors
  // run forward (parent column → child column on the right) without crossing
  // unrelated columns. Active sits in its natural DFS position.
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

  const ordered: Branch[] = [];
  function dfs(branchId: string) {
    const branch = byId.get(branchId);
    if (branch) ordered.push(branch);
    const children = childrenOf.get(branchId) ?? [];
    for (const child of children) dfs(child.id);
  }
  const roots = childrenOf.get(null) ?? [];
  for (const root of roots) dfs(root.id);

  const columns: { branchId: string }[] = ordered.map((b) => ({ branchId: b.id }));
  const numCols = columns.length;

  // Each entry sits at exactly one (column, row). Its column is its origin
  // (the branch in `entryOrigin`); its row is computed by walking the branch
  // tree: a root branch's first entry is at row 0, and a child branch's
  // first entry is at (parent's row of the fork entry) + 1. Walking in DFS
  // pre-order guarantees parents are computed before children.
  const entryRow = new Map<string, number>();
  const branchStartRow = new Map<string, number>();
  let totalRows = 0;

  for (const b of ordered) {
    let startRow = 0;
    if (b.parentBranchId && b.forkEntryId) {
      const forkRow = entryRow.get(b.forkEntryId);
      if (forkRow !== undefined) {
        startRow = forkRow + 1;
      }
      // Else: data inconsistency (forkEntryId not yet placed); default to 0.
    }
    branchStartRow.set(b.id, startRow);
    b.entryIds.forEach((eid, i) => {
      entryRow.set(eid, startRow + i);
    });
    if (b.entryIds.length > 0) {
      totalRows = Math.max(totalRows, startRow + b.entryIds.length);
    } else {
      // Empty branches still need a row slot for their incoming connector.
      totalRows = Math.max(totalRows, startRow + 1);
    }
  }

  // Build the row grid: each row.colEntryIds[col] holds the entry id at that
  // (col, row), if any. With the origin-based model, exactly one column per
  // row has an entry — never duplicated.
  const rows: GridRow[] = Array.from({ length: totalRows }, () => ({
    colEntryIds: Array<string | null>(numCols).fill(null),
  }));

  for (const b of ordered) {
    const col = columns.findIndex((c) => c.branchId === b.id);
    if (col < 0) continue;
    const startRow = branchStartRow.get(b.id) ?? 0;
    b.entryIds.forEach((eid, i) => {
      const ri = startRow + i;
      if (ri < totalRows) rows[ri].colEntryIds[col] = eid;
    });
  }

  // Fork connectors: from origin column at the entry's row to the child
  // branch's column at its first own row. Origin column is guaranteed to
  // draw the fork entry (by construction), so the connector always lands
  // on a real dot — no empty-column gaps, no lineage extensions needed.
  const forkConnectors: ForkConnector[] = [];
  for (const b of ordered) {
    if (!b.parentBranchId || !b.forkEntryId) continue;
    if (b.entryIds.length === 0) continue;
    const originId = entryOrigin.get(b.forkEntryId);
    if (!originId) continue;
    const fromCol = columns.findIndex((c) => c.branchId === originId);
    const toCol = columns.findIndex((c) => c.branchId === b.id);
    const fromRow = entryRow.get(b.forkEntryId);
    const toRow = branchStartRow.get(b.id);
    if (fromCol < 0 || toCol < 0 || fromRow === undefined || toRow === undefined) {
      continue;
    }
    forkConnectors.push({ fromRow, fromCol, toRow, toCol });
  }

  return { columns, rows, forkConnectors };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countEntryKinds(entryIds: string[], n: NarrativeState) {
  let scenes = 0; let worlds = 0;
  for (const id of entryIds) {
    if (n.worldBuilds[id]) worlds++;
    else if (n.scenes[id]) scenes++;
  }
  return { scenes, worlds };
}

function parentChain(branchId: string, n: NarrativeState): Branch[] {
  const chain: Branch[] = [];
  let bid: string | null = n.branches[branchId]?.parentBranchId ?? null;
  while (bid) {
    const b = n.branches[bid];
    if (!b) break;
    chain.push(b);
    bid = b.parentBranchId;
  }
  return chain;
}

function longestCommonPrefix(seqs: string[][]): number {
  if (seqs.length === 0) return 0;
  const min = Math.min(...seqs.map(s => s.length));
  let lcp = 0;
  while (lcp < min) {
    const v = seqs[0][lcp];
    if (seqs.some(s => s[lcp] !== v)) break;
    lcp++;
  }
  return lcp;
}

// ─── Component ────────────────────────────────────────────────────────────────

type ViewMode = 'graph' | 'compare' | 'chat';

export function BranchModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [selectedBranchIdRaw, setSelectedBranchId] = useState<string | null>(state.viewState.activeBranchId);
  const [compareBranchIdsRaw, setCompareBranchIds] = useState<string[]>(
    state.viewState.activeBranchId ? [state.viewState.activeBranchId] : [],
  );

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [newBranchName, setNewBranchName] = useState('');
  const [forkEntryId, setForkEntryId] = useState<string | null>(
    state.resolvedEntryKeys[state.viewState.currentSceneIndex] ?? null,
  );

  const allBranches = useMemo(
    () => (narrative ? Object.values(narrative.branches) : []),
    [narrative],
  );

  const branchIdSet = useMemo(() => new Set(allBranches.map(b => b.id)), [allBranches]);
  const selectedBranchId = selectedBranchIdRaw && branchIdSet.has(selectedBranchIdRaw)
    ? selectedBranchIdRaw
    : state.viewState.activeBranchId;
  const compareBranchIds = useMemo(
    () => compareBranchIdsRaw.filter(id => branchIdSet.has(id)),
    [compareBranchIdsRaw, branchIdSet],
  );

  const viewingBranchId = selectedBranchId ?? state.viewState.activeBranchId;
  const { columns, rows, forkConnectors } = useMemo(
    () => narrative
      ? buildGrid(allBranches, viewingBranchId)
      : { columns: [], rows: [], forkConnectors: [] },
    [allBranches, viewingBranchId, narrative],
  );
  const viewingSequence = useMemo(
    () => narrative && viewingBranchId
      ? resolveEntrySequence(narrative.branches, viewingBranchId)
      : [],
    [narrative, viewingBranchId],
  );
  const viewingSequenceSet = useMemo(() => new Set(viewingSequence), [viewingSequence]);
  // forkEntryId may be stale after switching viewing branches — fall back to the branch's tip
  const effectiveForkEntryId = forkEntryId && viewingSequenceSet.has(forkEntryId)
    ? forkEntryId
    : (viewingSequence[viewingSequence.length - 1] ?? null);

  if (!narrative) return null;

  const entryLabel = (id: string): string => {
    const wb = narrative.worldBuilds[id];
    if (wb) return wb.summary;
    return narrative.scenes[id]?.summary ?? id;
  };

  const isWorldEntry = (id: string): boolean => !!narrative.worldBuilds[id];

  function getDescendants(branchId: string): Branch[] {
    const result: Branch[] = [];
    const queue = [branchId];
    while (queue.length > 0) {
      const id = queue.pop()!;
      allBranches.forEach((b) => {
        if (b.parentBranchId === id) {
          result.push(b);
          queue.push(b.id);
        }
      });
    }
    return result;
  }

  function wouldDeleteActiveBranch(branchId: string): boolean {
    if (branchId === state.viewState.activeBranchId) return true;
    return getDescendants(branchId).some((b) => b.id === state.viewState.activeBranchId);
  }

  function handleRename(branchId: string) {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    dispatch({ type: 'RENAME_BRANCH', branchId, name: renameValue.trim() });
    setRenamingId(null);
  }

  function handleDeleteClick(branchId: string) {
    if (wouldDeleteActiveBranch(branchId)) return;
    const descendants = getDescendants(branchId);
    if (descendants.length > 0) {
      setPendingDeleteId(branchId);
    } else {
      dispatch({ type: 'DELETE_BRANCH', branchId });
    }
  }

  function handleDeleteConfirm() {
    if (!pendingDeleteId) return;
    dispatch({ type: 'DELETE_BRANCH', branchId: pendingDeleteId });
    setPendingDeleteId(null);
  }

  function handleSwitch(branchId: string) {
    dispatch({ type: 'SWITCH_BRANCH', branchId });
    onClose();
  }

  function handleFork() {
    if (!effectiveForkEntryId || !viewingBranchId) return;
    const name = newBranchName.trim() || `Branch ${allBranches.length + 1}`;
    dispatch({
      type: 'CREATE_BRANCH',
      branch: {
        id: `B-${Date.now()}`,
        name,
        parentBranchId: viewingBranchId,
        forkEntryId: effectiveForkEntryId,
        entryIds: [],
        createdAt: Date.now(),
      },
    });
    setNewBranchName('');
    onClose();
  }

  function toggleCompare(branchId: string) {
    setCompareBranchIds(prev =>
      prev.includes(branchId)
        ? prev.filter(id => id !== branchId)
        : prev.length >= MAX_COMPARE_BRANCHES ? [...prev.slice(1), branchId] : [...prev, branchId],
    );
  }

  const numCols = columns.length;
  const svgW = numCols > 0 ? LPAD + numCols * COL_W + 8 : 0;
  const currentEntryId = state.resolvedEntryKeys[state.viewState.currentSceneIndex] ?? null;

  const branchLastRow = new Map<string, number>();
  rows.forEach((row, ri) => {
    row.colEntryIds.forEach((eid, ci) => {
      if (eid != null) branchLastRow.set(columns[ci].branchId, ri);
    });
  });

  return (
    <Modal onClose={onClose} fullScreen>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/6 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-text-primary">Branches</h2>
          <span className="text-[10px] text-text-dim uppercase tracking-widest">
            {allBranches.length} total · {state.resolvedEntryKeys.length} entries on active
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-white/5 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('graph')}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                viewMode === 'graph' ? 'bg-white/12 text-text-primary' : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              Graph
            </button>
            <button
              onClick={() => setViewMode('compare')}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                viewMode === 'compare' ? 'bg-white/12 text-text-primary' : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              Compare
            </button>
            <button
              onClick={() => setViewMode('chat')}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                viewMode === 'chat' ? 'bg-white/12 text-text-primary' : 'text-text-dim hover:text-text-secondary'
              }`}
              title="Multi-branch analytical chat with controlled scopes"
            >
              Chat
            </button>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/5 transition-colors text-text-dim hover:text-text-primary"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside className="w-72 border-r border-white/6 flex flex-col shrink-0">
          <div className="px-4 pt-4 pb-2">
            <p className="text-[10px] text-text-dim uppercase tracking-widest">All Branches</p>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
            {allBranches.map((b) => {
              const isActive = b.id === state.viewState.activeBranchId;
              const isSelected = selectedBranchId === b.id;
              const isInCompare = compareBranchIds.includes(b.id);
              const isRenaming = renamingId === b.id;
              const c = stableBranchColor(b.id, allBranches);
              const seq = resolveEntrySequence(narrative.branches, b.id);
              const { scenes, worlds } = countEntryKinds(seq, narrative);

              const cardActive = viewMode !== 'graph' ? isInCompare : isSelected;

              return (
                <div
                  key={b.id}
                  className={`group flex items-stretch gap-2 px-2 py-2 rounded-lg mb-0.5 cursor-pointer transition-colors ${
                    cardActive ? 'bg-white/8' : 'hover:bg-white/4'
                  }`}
                  onClick={() => {
                    if (viewMode !== 'graph') toggleCompare(b.id);
                    else setSelectedBranchId(b.id);
                  }}
                >
                  <div className="w-1 rounded-full shrink-0" style={{ backgroundColor: c }} />
                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => handleRename(b.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(b.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className="w-full bg-transparent text-xs text-text-primary outline-none border-b border-white/20"
                      />
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs text-text-primary truncate flex-1">{b.name}</span>
                        {isActive && (
                          <span className="text-[8px] uppercase tracking-wider text-text-dim shrink-0">current</span>
                        )}
                        {/* Focus toggle — visible across ALL views. Marks
                            branch for comparison/chat. Independent of
                            row click and the switch mechanism. */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCompare(b.id);
                          }}
                          className="shrink-0 flex items-center gap-1 text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors"
                          style={{
                            backgroundColor: isInCompare ? `${c}33` : 'transparent',
                            color: isInCompare ? c : 'rgba(255,255,255,0.4)',
                            boxShadow: isInCompare
                              ? `inset 0 0 0 1px ${c}55`
                              : 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                          }}
                          title={
                            isInCompare
                              ? 'Remove from comparison focus'
                              : 'Add to comparison focus'
                          }
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full transition-colors"
                            style={{
                              backgroundColor: isInCompare ? c : 'transparent',
                              boxShadow: isInCompare ? 'none' : `inset 0 0 0 1px ${c}88`,
                            }}
                          />
                          {isInCompare ? 'Focus' : 'Focus'}
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[10px] text-text-dim mt-0.5">
                      <span>{scenes} sc</span>
                      {worlds > 0 && <span>· {worlds} w</span>}
                      {b.parentBranchId && (
                        <span className="truncate">· from {narrative.branches[b.parentBranchId]?.name ?? '—'}</span>
                      )}
                    </div>

                    {pendingDeleteId === b.id ? (
                      <div className="flex items-center gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[9px] text-red-400/80 flex-1">
                          Also deletes {getDescendants(b.id).length} child{getDescendants(b.id).length !== 1 ? 'ren' : ''}
                        </span>
                        <button
                          onClick={handleDeleteConfirm}
                          className="text-[9px] text-red-400 px-1.5 py-0.5 rounded bg-red-500/15 hover:bg-red-500/25 transition-colors"
                        >
                          confirm
                        </button>
                        <button
                          onClick={() => setPendingDeleteId(null)}
                          className="text-[9px] text-text-dim hover:text-text-secondary px-1.5 py-0.5 rounded hover:bg-white/6 transition-colors"
                        >
                          cancel
                        </button>
                      </div>
                    ) : (
                      <div
                        className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!isActive && (
                          <button
                            onClick={() => handleSwitch(b.id)}
                            className="text-[9px] text-text-secondary hover:text-text-primary px-1.5 py-0.5 rounded hover:bg-white/6 transition-colors"
                          >
                            switch to
                          </button>
                        )}
                        <button
                          onClick={() => { setRenamingId(b.id); setRenameValue(b.name); }}
                          className="text-[9px] text-text-dim hover:text-text-secondary px-1.5 py-0.5 rounded hover:bg-white/6 transition-colors"
                        >
                          rename
                        </button>
                        {!isActive && (
                          <button
                            onClick={() => handleDeleteClick(b.id)}
                            disabled={wouldDeleteActiveBranch(b.id)}
                            title={wouldDeleteActiveBranch(b.id) ? 'Active branch depends on this one' : undefined}
                            className="text-[9px] px-1.5 py-0.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-red-400/60 hover:text-red-400 hover:bg-red-500/10"
                          >
                            delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-white/6 p-3 shrink-0 bg-white/2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-text-dim uppercase tracking-widest">New Branch</p>
              {effectiveForkEntryId === currentEntryId && currentEntryId && (
                <span className="text-[9px] text-text-dim">at current scene</span>
              )}
            </div>
            <p className="text-[10px] text-text-secondary mb-2 leading-tight">
              Forking from <span className="text-text-primary">{narrative.branches[viewingBranchId ?? '']?.name ?? '—'}</span>
            </p>
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder={`Branch ${allBranches.length + 1}`}
              className="bg-bg-elevated border border-border rounded-md px-2 py-1.5 text-xs text-text-primary w-full outline-none placeholder:text-text-dim mb-2"
            />
            <label className="text-[9px] uppercase tracking-widest text-text-dim block mb-1">Fork after</label>
            <select
              value={effectiveForkEntryId ?? ''}
              onChange={(e) => setForkEntryId(e.target.value || null)}
              className="bg-bg-elevated border border-border rounded-md px-2 py-1.5 text-xs text-text-primary w-full outline-none mb-2"
            >
              {viewingSequence.map((key, idx) => {
                const label = narrative.worldBuilds[key]
                  ? narrative.worldBuilds[key].summary
                  : (narrative.scenes[key]?.summary ?? key);
                return (
                  <option key={key} value={key} className="bg-bg-panel">
                    {idx + 1}. {label.slice(0, 60)}{label.length > 60 ? '…' : ''}
                  </option>
                );
              })}
            </select>
            <p className="text-[9px] text-text-dim mb-2 leading-tight">
              Tip: click any row in the graph to set the fork point.
            </p>
            <button
              onClick={handleFork}
              disabled={!effectiveForkEntryId}
              className="w-full bg-white/10 hover:bg-white/16 text-text-primary text-xs font-semibold px-3 py-2 rounded-md transition disabled:opacity-30 disabled:pointer-events-none"
            >
              Create Branch
            </button>
          </div>
        </aside>

        {/* ── Main ────────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          {viewMode === 'graph' ? (
            <GraphView
              narrative={narrative}
              allBranches={allBranches}
              activeBranchId={state.viewState.activeBranchId}
              selectedBranchId={selectedBranchId}
              columns={columns}
              rows={rows}
              forkConnectors={forkConnectors}
              svgW={svgW}
              branchLastRow={branchLastRow}
              entryLabel={entryLabel}
              isWorldEntry={isWorldEntry}
              onSelect={setSelectedBranchId}
              onSwitch={handleSwitch}
              parentChainOf={(id) => parentChain(id, narrative)}
              currentEntryId={currentEntryId}
              forkEntryId={effectiveForkEntryId}
              onSetForkEntry={setForkEntryId}
            />
          ) : viewMode === 'compare' ? (
            <CompareView
              narrative={narrative}
              allBranches={allBranches}
              activeBranchId={state.viewState.activeBranchId}
              compareBranchIds={compareBranchIds}
              entryLabel={entryLabel}
              isWorldEntry={isWorldEntry}
              onToggleCompare={toggleCompare}
              onSwitch={handleSwitch}
            />
          ) : (
            <BranchChatView
              narrative={narrative}
              allBranches={allBranches}
              compareBranchIds={compareBranchIds}
              onToggleCompare={toggleCompare}
              onRestoreCompareBranches={(ids) => setCompareBranchIds(ids)}
            />
          )}
        </main>
      </div>
    </Modal>
  );
}

// ─── Graph view ───────────────────────────────────────────────────────────────

type GraphViewProps = {
  narrative: NarrativeState;
  allBranches: Branch[];
  activeBranchId: string | null;
  selectedBranchId: string | null;
  columns: { branchId: string }[];
  rows: GridRow[];
  forkConnectors: ForkConnector[];
  svgW: number;
  branchLastRow: Map<string, number>;
  entryLabel: (id: string) => string;
  isWorldEntry: (id: string) => boolean;
  onSelect: (id: string) => void;
  onSwitch: (id: string) => void;
  parentChainOf: (id: string) => Branch[];
  currentEntryId: string | null;
  forkEntryId: string | null;
  onSetForkEntry: (id: string) => void;
};

type LayoutMode = 'tracks' | 'map';

function GraphView({
  narrative, allBranches, activeBranchId, selectedBranchId,
  columns, rows, forkConnectors, svgW, branchLastRow,
  entryLabel, isWorldEntry, onSelect, onSwitch, parentChainOf,
  currentEntryId, forkEntryId, onSetForkEntry,
}: GraphViewProps) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('tracks');
  const selected = selectedBranchId ? narrative.branches[selectedBranchId] : null;
  const selectedColor = selected ? stableBranchColor(selected.id, allBranches) : '#666';
  const selectedSeq = selected ? resolveEntrySequence(narrative.branches, selected.id) : [];
  const selectedKinds = countEntryKinds(selectedSeq, narrative);
  const selectedChain = selected ? parentChainOf(selected.id) : [];
  const selectedForkLabel = selected?.forkEntryId ? entryLabel(selected.forkEntryId) : null;
  const selectedColIdx = selectedBranchId ? columns.findIndex(c => c.branchId === selectedBranchId) : -1;

  // Measure each label row so the SVG dots line up with multi-line summaries
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [rowHeights, setRowHeights] = useState<number[]>(() => rows.map(() => ROW_H));

  useLayoutEffect(() => {
    const measured = rows.map((_, i) => labelRefs.current[i]?.offsetHeight ?? ROW_H);
    setRowHeights(prev =>
      prev.length === measured.length && prev.every((h, i) => h === measured[i]) ? prev : measured,
    );
  }, [rows]);

  const rowOffsets = useMemo(() => {
    const out: number[] = [0];
    for (let i = 0; i < rowHeights.length; i++) out.push(out[i] + (rowHeights[i] ?? ROW_H));
    // Ensure offsets array has rows.length + 1 entries even if measurement hasn't caught up
    while (out.length <= rows.length) out.push(out[out.length - 1] + ROW_H);
    return out;
  }, [rowHeights, rows.length]);

  const rowCenter = (ri: number) => rowOffsets[ri] + (rowHeights[ri] ?? ROW_H) / 2;
  const totalHeight = rowOffsets[rows.length] ?? 0;

  // Map each row to active's entry (if any). With the origin-based grid,
  // active's column draws only its own entries — but the label column needs
  // to surface every entry on active's resolved sequence (inherited too) so
  // the user can read the full timeline. This walks active's sequence and
  // looks each entry up in the row grid.
  const activeSeqRowMap = useMemo(() => {
    const m = new Map<number, string>();
    if (!activeBranchId) return m;
    const activeSeq = resolveEntrySequence(narrative.branches, activeBranchId);
    const entryToRow = new Map<string, number>();
    rows.forEach((row, ri) => {
      row.colEntryIds.forEach((eid) => {
        if (eid && !entryToRow.has(eid)) entryToRow.set(eid, ri);
      });
    });
    for (const eid of activeSeq) {
      const r = entryToRow.get(eid);
      if (r !== undefined) m.set(r, eid);
    }
    return m;
  }, [activeBranchId, narrative.branches, rows]);

  return (
    <>
      {/* Inspector card */}
      {selected && (
        <div className="px-6 pt-5 pb-4 border-b border-white/6 shrink-0">
          <div className="flex items-start gap-4">
            <div className="w-1 self-stretch rounded-full" style={{ backgroundColor: selectedColor }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-base font-semibold text-text-primary">{selected.name}</h3>
                {selected.id === activeBranchId && (
                  <span className="text-[9px] uppercase tracking-widest text-text-dim border border-white/10 px-1.5 py-0.5 rounded">
                    current
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-text-dim flex-wrap">
                <span>{selectedKinds.scenes} scenes</span>
                {selectedKinds.worlds > 0 && <span>· {selectedKinds.worlds} world builds</span>}
                <span>· {selectedSeq.length} total entries</span>
                {selectedChain.length > 0 && (
                  <span>· chain: {selectedChain.map(b => b.name).reverse().join(' → ')} → {selected.name}</span>
                )}
                {selectedForkLabel && (
                  <span className="truncate">· forked at: <span className="text-text-secondary">{selectedForkLabel}</span></span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {selected.id !== activeBranchId && (
                <button
                  onClick={() => onSwitch(selected.id)}
                  className="text-xs text-text-primary bg-white/10 hover:bg-white/16 px-3 py-1.5 rounded-md transition-colors"
                >
                  Switch to this branch
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Layout mode toggle — small chip pair, top-right of the graph area.
          Tracks = current per-row labelled view; Map = top-down tree of all
          branches, no summaries, useful when many forks to scan structure. */}
      <div className="px-6 pt-3 flex items-center justify-end shrink-0">
        <div className="flex items-center gap-0.5 bg-white/5 border border-white/8 rounded-md p-0.5">
          {(['tracks', 'map'] as LayoutMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setLayoutMode(m)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded transition-colors ${
                layoutMode === m
                  ? 'bg-white/15 text-text-primary'
                  : 'text-text-dim hover:text-text-primary hover:bg-white/4'
              }`}
              title={
                m === 'tracks'
                  ? 'Per-row entry summaries on the active branch'
                  : 'Top-down tree of all branches — structure only, no summaries'
              }
            >
              {m === 'tracks' ? 'Tracks' : 'Map'}
            </button>
          ))}
        </div>
      </div>

      {/* Graph */}
      <div className="flex-1 overflow-auto px-6 py-5 min-h-0">
        {rows.length === 0 ? (
          <p className="text-xs text-text-dim text-center py-12">No commits yet. Generate some scenes first.</p>
        ) : layoutMode === 'map' ? (
          <MapGraph
            narrative={narrative}
            allBranches={allBranches}
            activeBranchId={activeBranchId}
            selectedBranchId={selectedBranchId}
            columns={columns}
            rows={rows}
            forkConnectors={forkConnectors}
            isWorldEntry={isWorldEntry}
            onSelect={onSelect}
            onSwitch={onSwitch}
          />
        ) : (
          <div className="flex">
            <svg width={svgW} height={totalHeight} className="shrink-0">

              {/* Active column band — persistent faint highlight so the
                  current branch stays identifiable even when selection
                  moves elsewhere. Sits beneath the selected highlight so
                  selected (when ≠ active) renders on top. */}
              {(() => {
                const activeIdx = activeBranchId
                  ? columns.findIndex((c) => c.branchId === activeBranchId)
                  : -1;
                if (activeIdx < 0 || activeIdx === selectedColIdx) return null;
                return (
                  <rect
                    x={colX(activeIdx) - DOT_R - 3}
                    y={0}
                    width={(DOT_R + 3) * 2}
                    height={totalHeight}
                    fill={`${stableBranchColor(columns[activeIdx].branchId, allBranches)}08`}
                    rx={6}
                  />
                );
              })()}

              {/* Selected column highlight */}
              {selectedColIdx >= 0 && (
                <rect
                  x={colX(selectedColIdx) - DOT_R - 3}
                  y={0}
                  width={(DOT_R + 3) * 2}
                  height={totalHeight}
                  fill={`${stableBranchColor(columns[selectedColIdx].branchId, allBranches)}11`}
                  rx={6}
                />
              )}

              {rows.map((row, ri) => {
                if (ri === 0) return null;
                return columns.map((_c, ci) => {
                  const prev = rows[ri - 1].colEntryIds[ci];
                  const curr = row.colEntryIds[ci];
                  if (!prev || !curr) return null;
                  const x = colX(ci);
                  const c = stableBranchColor(columns[ci].branchId, allBranches);
                  const y1 = rowCenter(ri - 1) + DOT_R + 1;
                  const y2 = rowCenter(ri) - DOT_R - 1;
                  return <line key={`sp-${ri}-${ci}`} x1={x} y1={y1} x2={x} y2={y2} stroke={c} strokeWidth={2} />;
                });
              })}

              {forkConnectors.map((fc, i) => {
                const x1 = colX(fc.fromCol);
                const y1 = rowCenter(fc.fromRow) + DOT_R;
                const x2 = colX(fc.toCol);
                const y2 = rowCenter(fc.toRow) - DOT_R;
                // Smooth S-curve. Control points pull along the dominant axis
                // (vertical here) by max(dy * 0.5, dx * 0.6) so wide forks
                // (across many columns, only one row apart) get extra
                // vertical room and avoid sharp near-90° bends.
                const dy = y2 - y1;
                const dx = Math.abs(x2 - x1);
                const sweep = Math.max(dy * 0.5, dx * 0.6);
                const c = stableBranchColor(columns[fc.toCol].branchId, allBranches);
                return (
                  <path
                    key={`fc-${i}`}
                    d={`M${x1} ${y1} C${x1} ${y1 + sweep} ${x2} ${y2 - sweep} ${x2} ${y2}`}
                    stroke={c}
                    strokeWidth={2}
                    fill="none"
                  />
                );
              })}

              {rows.map((row, ri) =>
                row.colEntryIds.map((eid, ci) => {
                  if (!eid) return null;
                  const x = colX(ci);
                  const cy = rowCenter(ri);
                  const c = stableBranchColor(columns[ci].branchId, allBranches);
                  return isWorldEntry(eid) ? (
                    <rect
                      key={`d-${ri}-${ci}`}
                      x={x - DOT_R + 1} y={cy - DOT_R + 1}
                      width={(DOT_R - 1) * 2} height={(DOT_R - 1) * 2}
                      rx={1} fill={c}
                      transform={`rotate(45 ${x} ${cy})`}
                    />
                  ) : (
                    <circle key={`d-${ri}-${ci}`} cx={x} cy={cy} r={DOT_R} fill={c} />
                  );
                })
              )}
            </svg>

            {/* Labels column */}
            <div className="flex-1 min-w-0 ml-2">
              {rows.map((row, ri) => {
                const labelEntryId = activeSeqRowMap.get(ri) ?? null;
                const labelIsActive = labelEntryId != null;

                const headCols = columns
                  .map((c, ci) => ({ ci, branchId: c.branchId }))
                  .filter(({ ci, branchId }) =>
                    branchLastRow.get(branchId) === ri && row.colEntryIds[ci] != null,
                  );

                const isCurrentRow = labelEntryId === currentEntryId;
                const isForkRow = labelEntryId === forkEntryId;

                return (
                  <div
                    key={ri}
                    ref={(el) => { labelRefs.current[ri] = el; }}
                    style={{ minHeight: ROW_H }}
                    className={`group px-2 py-1.5 rounded-md transition-colors ${
                      isForkRow ? 'bg-white/8' : isCurrentRow ? 'bg-white/4' : 'hover:bg-white/3'
                    }`}
                  >
                    {labelEntryId && (
                      <div className="flex flex-col gap-1.5">
                        {/* Badge cluster — full-width row above the prose so
                            the text below can span the full column without
                            being constrained by chip widths. */}
                        <div className="flex flex-wrap justify-end items-center gap-1">
                          {isCurrentRow && (
                            <span
                              title="Your current scene"
                              className="mr-auto text-[9px] uppercase tracking-widest text-text-dim border border-white/10 px-1 py-0.5 rounded"
                            >
                              here
                            </span>
                          )}
                          <button
                            onClick={() => onSetForkEntry(labelEntryId)}
                            title="Fork a new branch from this entry"
                            className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded transition-all ${
                              isForkRow
                                ? 'bg-white/15 text-text-primary'
                                : 'text-text-dim opacity-0 group-hover:opacity-100 hover:bg-white/8 hover:text-text-secondary'
                            }`}
                          >
                            {isForkRow ? '◇ fork point' : '◇ fork here'}
                          </button>
                          {headCols.map(({ branchId }) => {
                            const branch = narrative.branches[branchId];
                            const isActive = branchId === activeBranchId;
                            const c = stableBranchColor(branchId, allBranches);
                            return (
                              <button
                                key={branchId}
                                onClick={() => onSelect(branchId)}
                                onDoubleClick={() => onSwitch(branchId)}
                                title={isActive ? 'current — double-click to switch' : 'click to inspect, double-click to switch'}
                                className="px-1.5 py-0.5 rounded text-[9px] font-semibold transition-opacity hover:opacity-80"
                                style={{
                                  backgroundColor: isActive ? c : `${c}33`,
                                  color: isActive ? '#000' : c,
                                }}
                              >
                                {branch?.name ?? branchId}
                              </button>
                            );
                          })}
                        </div>
                        <p
                          className={`text-xs leading-snug whitespace-pre-wrap wrap-break-word ${labelIsActive ? 'text-text-primary' : 'text-text-secondary'}`}
                        >
                          {entryLabel(labelEntryId)}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Map view ────────────────────────────────────────────────────────────────
//
// Compact zoomed-out version of the Tracks layout — same column-per-branch
// vertical grid + same fork curves, just smaller and without the summary
// column on the right. Designed for scanning a wide tree of branches when
// per-row labels would overwhelm. Branch names render as rotated text above
// their columns. Same interaction model as Tracks: click a column to select,
// double-click to switch. Centered in the viewport.

// Horizontal Map orientation — time flows left-to-right along the X axis,
// branches are stacked horizontal lanes on the Y axis. Same data as Tracks,
// rotated 90°. Reads as a git-style timeline overview where divergences fan
// out vertically and chronological progression is the dominant axis.
const MAP_ENTRY_W = 14;   // X spacing per entry (time step)
const MAP_LANE_H = 24;    // Y spacing per branch lane
const MAP_DOT_R = 3.5;
const MAP_TOP_PAD = 12;
const MAP_BOTTOM_PAD = 12;
const MAP_LABEL_W = 110;  // Left padding for branch name labels.

function mapEntryX(ri: number): number {
  return MAP_LABEL_W + ri * MAP_ENTRY_W + MAP_ENTRY_W / 2;
}
function mapLaneY(ci: number): number {
  return MAP_TOP_PAD + ci * MAP_LANE_H + MAP_LANE_H / 2;
}

type MapGraphProps = {
  narrative: NarrativeState;
  allBranches: Branch[];
  activeBranchId: string | null;
  selectedBranchId: string | null;
  columns: { branchId: string }[];
  rows: GridRow[];
  forkConnectors: ForkConnector[];
  isWorldEntry: (id: string) => boolean;
  onSelect: (id: string) => void;
  onSwitch: (id: string) => void;
};

function MapGraph({
  narrative,
  allBranches,
  activeBranchId,
  selectedBranchId,
  columns,
  rows,
  forkConnectors,
  isWorldEntry,
  onSelect,
  onSwitch,
}: MapGraphProps) {
  if (columns.length === 0 || rows.length === 0) {
    return (
      <p className="text-xs text-text-dim text-center py-12">
        No branches to map yet.
      </p>
    );
  }

  // Natural coordinate-space dimensions. SVG renders at 100% of container
  // via viewBox auto-fit. Horizontal layout: width grows with timeline
  // length (rows = entries), height grows with branch count (columns =
  // lanes). Scale-up is capped so tiny trees don't get absurdly stretched.
  const svgW = MAP_LABEL_W + rows.length * MAP_ENTRY_W + 16;
  const svgH = MAP_TOP_PAD + columns.length * MAP_LANE_H + MAP_BOTTOM_PAD;
  const MAX_SCALE_UP = 3;

  const selectedColIdx = selectedBranchId
    ? columns.findIndex((c) => c.branchId === selectedBranchId)
    : -1;
  const activeColIdx = activeBranchId
    ? columns.findIndex((c) => c.branchId === activeBranchId)
    : -1;

  return (
    <div className="w-full h-full flex items-center justify-center">
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full"
        style={{
          maxWidth: svgW * MAX_SCALE_UP,
          maxHeight: svgH * MAX_SCALE_UP,
        }}
      >
        {/* Lane highlights — selected branch gets a brighter band, active
            branch a fainter one. Spans the full timeline width including the
            label gutter so the eye can sweep along the lane easily. */}
        {columns.map((col, ci) => {
          const isSelected = ci === selectedColIdx;
          const isActive = ci === activeColIdx;
          if (!isSelected && !isActive) return null;
          const c = stableBranchColor(col.branchId, allBranches);
          const y = mapLaneY(ci) - MAP_DOT_R - 4;
          return (
            <rect
              key={`hl-${ci}`}
              x={0}
              y={y}
              width={svgW}
              height={(MAP_DOT_R + 4) * 2}
              fill={isSelected ? `${c}1f` : `${c}0d`}
              rx={4}
            />
          );
        })}

        {/* Lane hit areas — invisible rect per branch for selecting /
            switching. Sits behind the visible elements. */}
        {columns.map((col, ci) => (
          <rect
            key={`hit-${ci}`}
            x={0}
            y={mapLaneY(ci) - MAP_LANE_H / 2}
            width={svgW}
            height={MAP_LANE_H}
            fill="transparent"
            onClick={() => onSelect(col.branchId)}
            onDoubleClick={() => onSwitch(col.branchId)}
            className="cursor-pointer"
          />
        ))}

        {/* Branch name labels — left-aligned, one per lane. With a small
            color stripe so each lane is identifiable at a glance. */}
        {columns.map((col, ci) => {
          const branch = narrative.branches[col.branchId];
          if (!branch) return null;
          const c = stableBranchColor(col.branchId, allBranches);
          const isActive = ci === activeColIdx;
          const isSelected = ci === selectedColIdx;
          const y = mapLaneY(ci);
          return (
            <g
              key={`hdr-${ci}`}
              onClick={() => onSelect(col.branchId)}
              onDoubleClick={() => onSwitch(col.branchId)}
              className="cursor-pointer"
            >
              <rect
                x={4}
                y={y - MAP_LANE_H / 2 + 4}
                width={2.5}
                height={MAP_LANE_H - 8}
                rx={1.25}
                fill={c}
                opacity={isSelected ? 1 : 0.75}
              />
              <text
                x={12}
                y={y + 3.5}
                fill={isSelected ? '#fff' : isActive ? c : '#a8a8a8'}
                fontSize={10}
                fontWeight={isSelected || isActive ? 600 : 400}
              >
                {(branch.name ?? col.branchId).slice(0, 16)}
              </text>
            </g>
          );
        })}

        {/* Same-branch lane segments — horizontal strokes connecting
            consecutive entries on a lane. Time flows left-to-right. */}
        {rows.map((row, ri) => {
          if (ri === 0) return null;
          return columns.map((_c, ci) => {
            const prev = rows[ri - 1].colEntryIds[ci];
            const curr = row.colEntryIds[ci];
            if (!prev || !curr) return null;
            const y = mapLaneY(ci);
            const c = stableBranchColor(columns[ci].branchId, allBranches);
            const x1 = mapEntryX(ri - 1) + MAP_DOT_R + 0.5;
            const x2 = mapEntryX(ri) - MAP_DOT_R - 0.5;
            return (
              <line
                key={`sp-${ri}-${ci}`}
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke={c}
                strokeWidth={1.5}
              />
            );
          });
        })}

        {/* Fork connectors — smooth S-curve between lanes. Control points
            sweep horizontally proportional to the larger of dx and dy, so
            forks crossing many lanes (large dy, small dx) get extra
            horizontal room and avoid the sharp near-90° bend that happens
            when the control points sit too close to the endpoints. */}
        {forkConnectors.map((fc, i) => {
          const x1 = mapEntryX(fc.fromRow) + MAP_DOT_R + 0.5;
          const y1 = mapLaneY(fc.fromCol);
          const x2 = mapEntryX(fc.toRow) - MAP_DOT_R - 0.5;
          const y2 = mapLaneY(fc.toCol);
          const dx = x2 - x1;
          const dy = Math.abs(y2 - y1);
          const sweep = Math.max(dx * 0.5, dy * 0.6);
          const c = stableBranchColor(columns[fc.toCol].branchId, allBranches);
          return (
            <path
              key={`fc-${i}`}
              d={`M${x1} ${y1} C${x1 + sweep} ${y1} ${x2 - sweep} ${y2} ${x2} ${y2}`}
              stroke={c}
              strokeWidth={1.5}
              fill="none"
            />
          );
        })}

        {/* Entry markers — tiny dots / diamonds, same shape semantics as
            Tracks (scenes round, world commits diamond). */}
        {rows.map((row, ri) =>
          row.colEntryIds.map((eid, ci) => {
            if (!eid) return null;
            const cx = mapEntryX(ri);
            const cy = mapLaneY(ci);
            const c = stableBranchColor(columns[ci].branchId, allBranches);
            return isWorldEntry(eid) ? (
              <rect
                key={`d-${ri}-${ci}`}
                x={cx - MAP_DOT_R + 0.5}
                y={cy - MAP_DOT_R + 0.5}
                width={(MAP_DOT_R - 0.5) * 2}
                height={(MAP_DOT_R - 0.5) * 2}
                fill={c}
                transform={`rotate(45 ${cx} ${cy})`}
              />
            ) : (
              <circle
                key={`d-${ri}-${ci}`}
                cx={cx}
                cy={cy}
                r={MAP_DOT_R}
                fill={c}
              />
            );
          })
        )}
      </svg>
    </div>
  );
}

// ─── Compare view ─────────────────────────────────────────────────────────────

type CompareViewProps = {
  narrative: NarrativeState;
  allBranches: Branch[];
  activeBranchId: string | null;
  compareBranchIds: string[];
  entryLabel: (id: string) => string;
  isWorldEntry: (id: string) => boolean;
  onToggleCompare: (id: string) => void;
  onSwitch: (id: string) => void;
};

function CompareView({
  narrative, allBranches, activeBranchId, compareBranchIds,
  entryLabel, isWorldEntry, onToggleCompare, onSwitch,
}: CompareViewProps) {
  const selectedBranches = compareBranchIds
    .map(id => allBranches.find(b => b.id === id))
    .filter((b): b is Branch => !!b);

  const sequences = selectedBranches.map(b => resolveEntrySequence(narrative.branches, b.id));
  const lcp = sequences.length > 1 ? longestCommonPrefix(sequences) : 0;
  const sharedEntries = sequences[0]?.slice(0, lcp) ?? [];

  return (
    <>
      {/* Selector chips */}
      <div className="px-6 pt-4 pb-3 border-b border-white/6 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest text-text-dim mr-1">Comparing</span>
          {allBranches.map(b => {
            const c = stableBranchColor(b.id, allBranches);
            const isShown = compareBranchIds.includes(b.id);
            return (
              <button
                key={b.id}
                onClick={() => onToggleCompare(b.id)}
                className={`text-[11px] px-2 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                  isShown ? 'bg-white/10 text-text-primary' : 'bg-white/3 text-text-dim hover:bg-white/6 hover:text-text-secondary'
                }`}
                style={isShown ? { boxShadow: `inset 2px 0 0 ${c}` } : {}}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: isShown ? c : `${c}66` }}
                />
                {b.name}
              </button>
            );
          })}
          {compareBranchIds.length >= MAX_COMPARE_BRANCHES && (
            <span className="text-[10px] text-text-dim">· max {MAX_COMPARE_BRANCHES} columns (oldest drops)</span>
          )}
        </div>
      </div>

      {selectedBranches.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-text-dim">
          Select branches above to compare them side by side.
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">

          {/* Shared ancestry */}
          {lcp > 0 && (
            <div className="px-6 py-3 border-b border-white/6 shrink-0 bg-white/1.5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest text-text-dim">
                  Shared ancestry · {lcp} entries
                </p>
                <p className="text-[10px] text-text-dim">divergence at #{lcp + 1}</p>
              </div>
              <div className="max-h-32 overflow-y-auto pr-2 space-y-0.5">
                {sharedEntries.map((eid, i) => (
                  <div key={`shared-${eid}-${i}`} className="flex items-center gap-2 text-[11px] text-text-dim hover:text-text-secondary py-0.5">
                    <span className="w-6 text-right tabular-nums shrink-0">{i + 1}</span>
                    <span className={`w-2 h-2 shrink-0 ${isWorldEntry(eid) ? 'rotate-45 bg-text-dim' : 'rounded-full bg-text-dim'}`} />
                    <span className="truncate">{entryLabel(eid).slice(0, 140)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Side-by-side columns */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden flex gap-3 px-6 py-4 min-h-0">
            {selectedBranches.map((b, bi) => {
              const c = stableBranchColor(b.id, allBranches);
              const seq = sequences[bi];
              const tail = seq.slice(lcp);
              const isActive = b.id === activeBranchId;

              return (
                <div
                  key={b.id}
                  className="flex flex-col min-w-65 flex-1 max-w-md bg-white/2 rounded-lg border border-white/6 overflow-hidden"
                >
                  {/* Column header */}
                  <div className="px-3 py-2 border-b border-white/6 shrink-0" style={{ borderLeft: `3px solid ${c}` }}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-text-primary truncate">{b.name}</span>
                        {isActive && (
                          <span className="text-[8px] uppercase tracking-widest text-text-dim border border-white/10 px-1 rounded shrink-0">
                            current
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!isActive && (
                          <button
                            onClick={() => onSwitch(b.id)}
                            className="text-[9px] text-text-secondary hover:text-text-primary px-1.5 py-0.5 rounded hover:bg-white/6 transition-colors"
                          >
                            switch
                          </button>
                        )}
                        <button
                          onClick={() => onToggleCompare(b.id)}
                          className="text-[9px] text-text-dim hover:text-text-secondary px-1.5 py-0.5 rounded hover:bg-white/6 transition-colors"
                        >
                          remove
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-text-dim">
                      {seq.length} total · <span className="text-text-secondary">{tail.length} unique</span>
                    </p>
                  </div>

                  {/* Column entries */}
                  <div className="flex-1 overflow-y-auto p-2 min-h-0">
                    {tail.length === 0 ? (
                      <p className="text-[10px] text-text-dim text-center py-6">
                        Identical to shared ancestry — no divergent entries yet.
                      </p>
                    ) : (
                      tail.map((eid, i) => {
                        const idx = lcp + i + 1;
                        const isWorld = isWorldEntry(eid);
                        return (
                          <div
                            key={`${b.id}-${eid}-${i}`}
                            className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-white/4 transition-colors"
                          >
                            <span className="text-[10px] text-text-dim tabular-nums w-6 text-right pt-0.5 shrink-0">
                              {idx}
                            </span>
                            <span
                              className={`w-2 h-2 mt-1.5 shrink-0 ${isWorld ? 'rotate-45' : 'rounded-full'}`}
                              style={{ backgroundColor: c }}
                            />
                            <span className="text-[11px] text-text-secondary leading-snug flex-1 min-w-0">
                              {entryLabel(eid)}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Branch chat view ─────────────────────────────────────────────────────────

type BranchChatViewProps = {
  narrative: NarrativeState;
  allBranches: Branch[];
  compareBranchIds: string[];
  onToggleCompare: (id: string) => void;
  onRestoreCompareBranches: (ids: string[]) => void;
};

function BranchChatView({
  narrative,
  allBranches,
  compareBranchIds,
  onToggleCompare,
  onRestoreCompareBranches,
}: BranchChatViewProps) {
  return (
    <>
      {/* Selector chips — same shape as CompareView so selection feels
          consistent across the two analytical modes. */}
      <div className="px-6 pt-4 pb-3 border-b border-white/6 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest text-text-dim mr-1">
            Comparing
          </span>
          {allBranches.map((b) => {
            const c = stableBranchColor(b.id, allBranches);
            const isShown = compareBranchIds.includes(b.id);
            return (
              <button
                key={b.id}
                onClick={() => onToggleCompare(b.id)}
                className={`text-[11px] px-2 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                  isShown
                    ? 'bg-white/10 text-text-primary'
                    : 'bg-white/3 text-text-dim hover:bg-white/6 hover:text-text-secondary'
                }`}
                style={isShown ? { boxShadow: `inset 2px 0 0 ${c}` } : {}}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: isShown ? c : `${c}66` }}
                />
                {b.name}
              </button>
            );
          })}
          {compareBranchIds.length >= MAX_COMPARE_BRANCHES && (
            <span className="text-[10px] text-text-dim">· max {MAX_COMPARE_BRANCHES} (oldest drops)</span>
          )}
        </div>
      </div>

      <BranchChat
        narrative={narrative}
        allBranches={allBranches}
        compareBranchIds={compareBranchIds}
        branchColor={(id) => stableBranchColor(id, allBranches)}
        onRestoreCompareBranches={onRestoreCompareBranches}
      />
    </>
  );
}
