'use client';

import { useState, useMemo, useRef, useLayoutEffect } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntrySequence } from '@/lib/narrative-utils';
import { Modal } from '@/components/Modal';
import { BranchWorkbench } from './BranchWorkbench';
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

function colX(col: number): number {
  return LPAD + col * COL_W;
}

type GridRow = { colEntryIds: (string | null)[] };
type ForkConnector = { fromRow: number; fromCol: number; toRow: number; toCol: number };

function buildGrid(
  allBranches: Branch[],
  activeBranchId: string | null,
  narrative: NarrativeState,
): { columns: { branchId: string }[]; rows: GridRow[]; forkConnectors: ForkConnector[] } {
  if (!activeBranchId || allBranches.length === 0) {
    return { columns: [], rows: [], forkConnectors: [] };
  }

  const byId = new Map(allBranches.map(b => [b.id, b]));
  const activeSeq = resolveEntrySequence(narrative.branches, activeBranchId);
  const activeEntrySet = new Set(activeSeq);

  const ancestrySet = new Set<string>();
  {
    let bid = byId.get(activeBranchId)?.parentBranchId ?? null;
    while (bid) {
      ancestrySet.add(bid);
      bid = byId.get(bid)?.parentBranchId ?? null;
    }
  }

  const others: Branch[] = [];
  const added = new Set<string>();
  function addB(b: Branch) {
    if (added.has(b.id) || b.id === activeBranchId) return;
    if (b.parentBranchId) { const p = byId.get(b.parentBranchId); if (p) addB(p); }
    added.add(b.id);
    others.push(b);
  }
  allBranches.forEach(b => { if (b.id !== activeBranchId) addB(b); });

  const columns: { branchId: string }[] = [
    ...others.map(b => ({ branchId: b.id })),
    { branchId: activeBranchId },
  ];
  const numCols = columns.length;
  const currentCol = numCols - 1;

  type BranchTrack = { col: number; entryPositions: Map<string, number> };
  const tracks = new Map<string, BranchTrack>();

  const activePositions = new Map(activeSeq.map((eid, i) => [eid, i]));
  tracks.set(activeBranchId, { col: currentCol, entryPositions: activePositions });

  const forkConnectors: ForkConnector[] = [];
  let totalRows = activeSeq.length;

  for (const b of others) {
    const col = columns.findIndex(c => c.branchId === b.id);
    const isAncestor = ancestrySet.has(b.id);

    let forkRow: number;
    let forkCol: number;
    let entriesToShow: string[];

    if (isAncestor) {
      const seq = resolveEntrySequence(narrative.branches, b.id);
      let lcp = 0;
      while (lcp < activeSeq.length && lcp < seq.length && activeSeq[lcp] === seq[lcp]) lcp++;
      forkRow = lcp - 1;
      forkCol = currentCol;
      entriesToShow = b.entryIds.filter(eid => !activeEntrySet.has(eid));
    } else {
      forkRow = -1;
      forkCol = currentCol;

      if (b.forkEntryId) {
        if (b.parentBranchId && b.parentBranchId !== activeBranchId) {
          const parentTrack = tracks.get(b.parentBranchId);
          if (parentTrack && parentTrack.entryPositions.has(b.forkEntryId)) {
            forkRow = parentTrack.entryPositions.get(b.forkEntryId)!;
            forkCol = parentTrack.col;
          }
        }
        if (forkRow === -1 && activePositions.has(b.forkEntryId)) {
          forkRow = activePositions.get(b.forkEntryId)!;
          forkCol = currentCol;
        }
      }

      entriesToShow = b.entryIds;
    }

    const startRow = forkRow + 1;
    const entryPositions = new Map<string, number>();
    entriesToShow.forEach((eid, i) => { entryPositions.set(eid, startRow + i); });

    tracks.set(b.id, { col, entryPositions });
    totalRows = Math.max(totalRows, startRow + entriesToShow.length);

    if (entriesToShow.length > 0 && forkRow >= 0) {
      forkConnectors.push({ fromRow: forkRow, fromCol: forkCol, toRow: startRow, toCol: col });
    }
  }

  const rows: GridRow[] = Array.from({ length: totalRows }, () => ({
    colEntryIds: Array<string | null>(numCols).fill(null),
  }));

  for (let i = 0; i < activeSeq.length && i < totalRows; i++) {
    rows[i].colEntryIds[currentCol] = activeSeq[i];
  }

  for (const b of others) {
    const track = tracks.get(b.id)!;
    for (const [eid, row] of track.entryPositions) {
      if (row >= 0 && row < totalRows) rows[row].colEntryIds[track.col] = eid;
    }
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

type ViewMode = 'graph' | 'compare' | 'workbench';

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
      ? buildGrid(allBranches, viewingBranchId, narrative)
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
        : prev.length >= 4 ? [...prev.slice(1), branchId] : [...prev, branchId],
    );
  }

  const numCols = columns.length;
  const currentCol = numCols - 1;
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
              onClick={() => setViewMode('workbench')}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                viewMode === 'workbench' ? 'bg-white/12 text-text-primary' : 'text-text-dim hover:text-text-secondary'
              }`}
              title="Multi-branch analytical chat with controlled scopes"
            >
              Workbench
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
                            branch for comparison/workbench. Independent of
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
              currentCol={currentCol}
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
            <WorkbenchView
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
  currentCol: number;
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

function GraphView({
  narrative, allBranches, activeBranchId, selectedBranchId,
  columns, rows, forkConnectors, currentCol, svgW, branchLastRow,
  entryLabel, isWorldEntry, onSelect, onSwitch, parentChainOf,
  currentEntryId, forkEntryId, onSetForkEntry,
}: GraphViewProps) {
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

      {/* Graph */}
      <div className="flex-1 overflow-auto px-6 py-5 min-h-0">
        {rows.length === 0 ? (
          <p className="text-xs text-text-dim text-center py-12">No commits yet. Generate some scenes first.</p>
        ) : (
          <div className="flex">
            <svg width={svgW} height={totalHeight} className="shrink-0">

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
                const y1 = rowCenter(fc.fromRow) + DOT_R + 1;
                const x2 = colX(fc.toCol);
                const y2 = rowCenter(fc.toRow) - DOT_R - 1;
                const midY = (y1 + y2) / 2;
                const c = stableBranchColor(columns[fc.toCol].branchId, allBranches);
                return (
                  <path
                    key={`fc-${i}`}
                    d={`M${x1} ${y1} C${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`}
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
                const labelEntryId = row.colEntryIds[currentCol] ?? null;
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
                    className={`group flex items-start pl-2 gap-2 py-1.5 rounded-md transition-colors ${
                      isForkRow ? 'bg-white/8' : isCurrentRow ? 'bg-white/4' : 'hover:bg-white/3'
                    }`}
                  >
                    {labelEntryId && (
                      <>
                        {isCurrentRow && (
                          <span
                            title="Your current scene"
                            className="text-[9px] uppercase tracking-widest text-text-dim border border-white/10 px-1 py-0.5 rounded shrink-0 mt-0.5"
                          >
                            here
                          </span>
                        )}
                        <p
                          className={`flex-1 text-xs leading-snug whitespace-pre-wrap wrap-break-word ${labelIsActive ? 'text-text-primary' : 'text-text-secondary'}`}
                        >
                          {entryLabel(labelEntryId)}
                        </p>
                        <button
                          onClick={() => onSetForkEntry(labelEntryId)}
                          title="Fork a new branch from this entry"
                          className={`shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded transition-all ${
                            isForkRow
                              ? 'bg-white/15 text-text-primary'
                              : 'text-text-dim opacity-0 group-hover:opacity-100 hover:bg-white/8 hover:text-text-secondary'
                          }`}
                        >
                          {isForkRow ? '◇ fork point' : '◇ fork here'}
                        </button>
                        {headCols.length > 0 && (
                          <div className="flex gap-1 shrink-0">
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
                        )}
                      </>
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
          {compareBranchIds.length >= 4 && (
            <span className="text-[10px] text-text-dim">· max 4 columns (oldest drops)</span>
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

// ─── Workbench view ───────────────────────────────────────────────────────────

type WorkbenchViewProps = {
  narrative: NarrativeState;
  allBranches: Branch[];
  compareBranchIds: string[];
  onToggleCompare: (id: string) => void;
  onRestoreCompareBranches: (ids: string[]) => void;
};

function WorkbenchView({
  narrative,
  allBranches,
  compareBranchIds,
  onToggleCompare,
  onRestoreCompareBranches,
}: WorkbenchViewProps) {
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
          {compareBranchIds.length >= 4 && (
            <span className="text-[10px] text-text-dim">· max 4 (oldest drops)</span>
          )}
        </div>
      </div>

      <BranchWorkbench
        narrative={narrative}
        allBranches={allBranches}
        compareBranchIds={compareBranchIds}
        branchColor={(id) => stableBranchColor(id, allBranches)}
        onRestoreCompareBranches={onRestoreCompareBranches}
      />
    </>
  );
}
