// Tests for lib/merges — branch-scoped visibility (ownership model),
// per-branch merge consumption (basisMergeIds on arcs / world-builds), and the
// <continuity-basis> prompt block renderer.

import { describe, it, expect } from 'vitest';
import type { NarrativeState, Stream, Merge, Branch, Scene, WorldBuild, Arc } from '@/types/narrative';
import {
  streamsForBranch,
  mergesForBranch,
  forkLedger,
  collectConsumedMergeIds,
  findMergeConsumer,
  buildMergeConsumerMap,
  mergeConsumerFor,
  renderMergeBasisBlock,
  resolutionOutcomes,
  isMultiResolution,
} from '@/lib/merges';

// ── Fixture builders ─────────────────────────────────────────────────────────

function branch(id: string, parentBranchId: string | null, entryIds: string[] = []): Branch {
  return { id, name: id, parentBranchId, forkEntryId: null, entryIds, createdAt: 0 };
}

function stream(id: string, branchId?: string, extra: Partial<Stream> = {}): Stream {
  return {
    id,
    perspectiveId: 'p1',
    title: `Q ${id}`,
    state: 'open',
    priors: [],
    createdAt: 0,
    updatedAt: 0,
    branchId,
    ...extra,
  };
}

function merge(id: string, branchId?: string, extra: Partial<Merge> = {}): Merge {
  return { id, at: 0, streamIds: [], branchId, ...extra };
}

function scene(id: string, arcId: string): Scene {
  return { kind: 'scene', id, arcId } as unknown as Scene;
}

function worldBuild(id: string, basisMergeIds?: string[]): WorldBuild {
  return { kind: 'world_build', id, summary: '', expansionManifest: {}, basisMergeIds } as unknown as WorldBuild;
}

function arc(id: string, basisMergeIds?: string[]): Arc {
  return { id, name: `Arc ${id}`, sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], basisMergeIds } as unknown as Arc;
}

/** A narrative with a CANON → A → B lineage and a sibling C off CANON. */
function makeNarrative(over: Partial<NarrativeState> = {}): NarrativeState {
  return {
    branches: {
      CANON: branch('CANON', null),
      A: branch('A', 'CANON'),
      B: branch('B', 'A'),
      C: branch('C', 'CANON'),
    },
    streams: {},
    merges: {},
    scenes: {},
    worldBuilds: {},
    arcs: {},
    perspectives: {},
    members: {},
    characters: {},
    locations: {},
    artifacts: {},
    ...over,
  } as unknown as NarrativeState;
}

// ── streamsForBranch / mergesForBranch (strict ownership) ────────────────────

describe('streamsForBranch (ownership)', () => {
  const n = makeNarrative({
    streams: {
      s_canon: stream('s_canon', 'CANON'),
      s_a: stream('s_a', 'A'),
      s_c: stream('s_c', 'C'),
    },
  });

  it('shows only the streams a branch OWNS', () => {
    expect(streamsForBranch(n, 'CANON').map((s) => s.id)).toEqual(['s_canon']);
    expect(streamsForBranch(n, 'A').map((s) => s.id)).toEqual(['s_a']);
    expect(streamsForBranch(n, 'C').map((s) => s.id)).toEqual(['s_c']);
  });

  it('a branch never sees another branch\'s streams (full isolation)', () => {
    expect(streamsForBranch(n, 'A').some((s) => s.id === 's_canon' || s.id === 's_c')).toBe(false);
  });
});

describe('mergesForBranch (ownership)', () => {
  const n = makeNarrative({
    merges: { m_a: merge('m_a', 'A'), m_c: merge('m_c', 'C') },
  });

  it('shows only the merges a branch OWNS', () => {
    expect(mergesForBranch(n, 'A').map((m) => m.id)).toEqual(['m_a']);
    expect(mergesForBranch(n, 'C').map((m) => m.id)).toEqual(['m_c']);
  });
});

// ── forkLedger (copy-on-fork) ────────────────────────────────────────────────

describe('forkLedger', () => {
  const base = () => makeNarrative({
    streams: {
      s1: stream('s1', 'A', { priors: [{ id: 'p1', text: 'x', at: 1 }] }),
    },
    merges: {
      m1: merge('m1', 'A', { streamIds: ['s1'], resolutions: { s1: { outcome: 'yes' } } }),
    },
  });

  it('deep-copies the parent\'s streams + merges with fresh ids + origin links', () => {
    const n = base();
    const { streams, merges } = forkLedger(n, 'A', 'B');
    expect(streams).toHaveLength(1);
    expect(merges).toHaveLength(1);

    const s = streams[0];
    expect(s.id).toBe('s1::B');
    expect(s.branchId).toBe('B');
    expect(s.originStreamId).toBe('s1');
    // Deep copy — mutating the copy never touches the source.
    s.priors.push({ id: 'p2', text: 'y', at: 2 });
    expect(n.streams!.s1.priors).toHaveLength(1);

    const m = merges[0];
    expect(m.id).toBe('m1::B');
    expect(m.branchId).toBe('B');
    expect(m.originMergeId).toBe('m1');
    // Merge stream-refs + resolution keys remapped to the copied stream.
    expect(m.streamIds).toEqual(['s1::B']);
    expect(Object.keys(m.resolutions!)).toEqual(['s1::B']);
  });

  it('propagates the ROOT origin through chained forks', () => {
    const n = base();
    const child = forkLedger(n, 'A', 'B').streams[0];
    // Re-home the copy on B, then fork B → C.
    const n2 = makeNarrative({ streams: { [child.id]: child } });
    const grandchild = forkLedger(n2, 'B', 'C').streams[0];
    expect(grandchild.originStreamId).toBe('s1'); // root, not s1::B
  });

  it('a root fork (no parent) copies nothing', () => {
    expect(forkLedger(base(), null, 'X')).toEqual({ streams: [], merges: [] });
  });
});

// ── Copy-on-fork integration (what the CREATE_BRANCH reducer composes) ───────

describe('copy-on-fork integration', () => {
  // Mirror the reducer body: fork the ledger, then fold the copies into the
  // global dicts + register the child branch.
  function fork(n: NarrativeState, from: string, to: string): NarrativeState {
    const { streams, merges } = forkLedger(n, from, to);
    return {
      ...n,
      branches: { ...n.branches, [to]: branch(to, from) },
      streams: { ...(n.streams ?? {}), ...Object.fromEntries(streams.map((s) => [s.id, s])) },
      merges: { ...(n.merges ?? {}), ...Object.fromEntries(merges.map((m) => [m.id, m])) },
    } as NarrativeState;
  }

  it('child owns independent copies; the parent keeps its originals (isolation)', () => {
    const n0 = makeNarrative({
      streams: { s1: stream('s1', 'CANON', { priors: [{ id: 'p1', text: 'x', at: 1 }] }) },
      merges: { m1: merge('m1', 'CANON', { streamIds: ['s1'] }) },
    });
    const n = fork(n0, 'CANON', 'B');

    // Ownership: parent sees the original, child sees its own copy.
    expect(streamsForBranch(n, 'CANON').map((s) => s.id)).toEqual(['s1']);
    expect(streamsForBranch(n, 'B').map((s) => s.id)).toEqual(['s1::B']);
    expect(mergesForBranch(n, 'B').map((m) => m.id)).toEqual(['m1::B']);
    expect(n.streams!['s1::B'].originStreamId).toBe('s1'); // comparison link

    // Isolation: a prior added on the child never touches the parent's stream.
    n.streams!['s1::B'].priors.push({ id: 'p2', text: 'y', at: 2 });
    expect(n.streams!.s1.priors).toHaveLength(1);
    expect(n.streams!['s1::B'].priors).toHaveLength(2);
  });

  it('reverting a merge on the child leaves the parent\'s merge intact', () => {
    const n0 = makeNarrative({
      streams: { s1: stream('s1', 'CANON') },
      merges: { m1: merge('m1', 'CANON', { streamIds: ['s1'] }) },
    });
    const n = fork(n0, 'CANON', 'B');
    // Simulate REVERT_MERGE on B — drop only B's owned copy.
    delete n.merges!['m1::B'];
    expect(mergesForBranch(n, 'CANON').map((m) => m.id)).toEqual(['m1']); // parent untouched
    expect(mergesForBranch(n, 'B')).toHaveLength(0);                      // child reverted, isolated
  });

  it('a grandchild fork keeps each generation isolated and the root origin linked', () => {
    const n0 = makeNarrative({ streams: { s1: stream('s1', 'CANON') } });
    const n1 = fork(n0, 'CANON', 'B');
    const n2 = fork(n1, 'B', 'C');
    expect(streamsForBranch(n2, 'C').map((s) => s.id)).toEqual(['s1::B::C']);
    expect(n2.streams!['s1::B::C'].originStreamId).toBe('s1'); // root origin, not s1::B
    // All three generations coexist independently.
    expect(streamsForBranch(n2, 'CANON').map((s) => s.id)).toEqual(['s1']);
    expect(streamsForBranch(n2, 'B').map((s) => s.id)).toEqual(['s1::B']);
  });
});

// ── collectConsumedMergeIds ──────────────────────────────────────────────────

describe('collectConsumedMergeIds', () => {
  it('collects basisMergeIds from the arcs of resolved scenes and from world-builds', () => {
    const n = makeNarrative({
      arcs: { ARC1: arc('ARC1', ['m1', 'm2']) },
      scenes: { s1: scene('s1', 'ARC1'), s2: scene('s2', 'ARC1') },
      worldBuilds: { wb1: worldBuild('wb1', ['m3']) },
    });
    const consumed = collectConsumedMergeIds(n, ['s1', 's2', 'wb1']);
    expect([...consumed].sort()).toEqual(['m1', 'm2', 'm3']);
  });

  it('reads each arc only once even across many scenes (no dupes)', () => {
    const n = makeNarrative({
      arcs: { ARC1: arc('ARC1', ['m1']) },
      scenes: { s1: scene('s1', 'ARC1'), s2: scene('s2', 'ARC1'), s3: scene('s3', 'ARC1') },
    });
    expect([...collectConsumedMergeIds(n, ['s1', 's2', 's3'])]).toEqual(['m1']);
  });

  it('returns empty when nothing on the branch folded a merge', () => {
    const n = makeNarrative({
      arcs: { ARC1: arc('ARC1') },
      scenes: { s1: scene('s1', 'ARC1') },
    });
    expect(collectConsumedMergeIds(n, ['s1']).size).toBe(0);
  });
});

// ── findMergeConsumer / buildMergeConsumerMap ────────────────────────────────

describe('findMergeConsumer', () => {
  const n = makeNarrative({
    arcs: { ARC1: arc('ARC1', ['m1']) },
    scenes: { s1: scene('s1', 'ARC1') },
    worldBuilds: { wb1: worldBuild('wb1', ['m2']) },
  });

  it('names the arc that folded a merge', () => {
    const c = findMergeConsumer(n, ['s1', 'wb1'], 'm1');
    expect(c).toMatchObject({ kind: 'arc', id: 'ARC1', name: 'Arc ARC1' });
  });

  it('names the world-build that folded a merge', () => {
    const c = findMergeConsumer(n, ['s1', 'wb1'], 'm2');
    expect(c).toMatchObject({ kind: 'world', id: 'wb1', name: 'World expansion' });
  });

  it('returns null for a merge not consumed on the branch', () => {
    expect(findMergeConsumer(n, ['s1', 'wb1'], 'm-unused')).toBeNull();
  });

  it('buildMergeConsumerMap indexes every consumed merge in one pass', () => {
    const map = buildMergeConsumerMap(n, ['s1', 'wb1']);
    expect(map.get('m1')?.id).toBe('ARC1');
    expect(map.get('m2')?.id).toBe('wb1');
    expect(map.has('m-unused')).toBe(false);
  });

  it('matches a forked merge COPY via its origin (shared entry references the original)', () => {
    // A pre-fork (shared) entry consumed the ORIGINAL 'm1'; a child owns a copy
    // with a fresh id + originMergeId 'm1'. Consumption must still recognise it.
    const n2 = makeNarrative({
      arcs: { ARC1: arc('ARC1', ['m1']) },
      scenes: { s1: scene('s1', 'ARC1') },
      merges: { 'm1::B': merge('m1::B', 'B', { originMergeId: 'm1' }) },
    });
    expect(findMergeConsumer(n2, ['s1'], 'm1::B')).toMatchObject({ id: 'ARC1' });
    const map = buildMergeConsumerMap(n2, ['s1']);
    expect(mergeConsumerFor(map, n2.merges!['m1::B'])?.id).toBe('ARC1');
  });
});

// ── renderMergeBasisBlock ────────────────────────────────────────────────────

describe('renderMergeBasisBlock', () => {
  // Stream whose belief leans 'yes' (logit[0] highest) but the GM committed 'no'.
  const overriddenStream = stream('s1', 'A', {
    title: 'Will the treaty hold?',
    memberId: 'm1',
    outcomes: ['yes', 'no'],
    stance: { logits: [1.2, 0.1], volume: 3, volatility: 0 },
    priors: [
      { id: 'p1', text: 'envoy returned with signed terms', at: 1, logType: 'payoff' },
      { id: 'p2', text: 'troops still massing at the border', at: 2, logType: 'escalation' },
    ],
  });

  const baseNarrative = makeNarrative({
    streams: { s1: overriddenStream },
    perspectives: { p1: { id: 'p1', kind: 'character', entityRef: 'c1' } },
    members: { m1: { id: 'm1', firstName: 'Ada', lastName: 'Lovelace', role: 'member' } },
    characters: { c1: { id: 'c1', name: 'Envoy Mar}> "Quill"' } } as unknown as NarrativeState['characters'],
  });

  it('returns null when there are no merges', () => {
    expect(renderMergeBasisBlock(baseNarrative, [])).toBeNull();
  });

  it('renders an unresolved stream as <open> record-only (no fact, non-driving)', () => {
    // The merge folds s1 in but commits NO outcome — it stays unresolved, kept
    // in the merge as organisational record (an executive decision elsewhere).
    const m = merge('m1', 'A', { streamIds: ['s1'], resolutions: {} });
    const block = renderMergeBasisBlock(baseNarrative, [m])!;
    expect(block).not.toBeNull();
    expect(block).toContain('<open ');
    // belief leans 'yes' (logit 1.2 vs 0.1) → ~75/25, leaning 'yes'.
    expect(block).toContain('leaning="yes"');
    expect(block).toContain('distribution="yes 75% · no 25%"');
    // Priors are framed as non-driving organisational record, not as evidence
    // for a committed fact and not as a driver of generation.
    expect(block).toContain('ORGANISATIONAL RECORD');
    expect(block).toContain('NON-DRIVING');
    expect(block).toContain('envoy returned with signed terms');
    // No committed outcome is asserted for an unresolved stream.
    expect(block).not.toContain('outcome="');
    // The synthesis carries the open-question handling step + the executive-only
    // driving rule.
    expect(block).toContain('open-questions');
    expect(block).toContain('executive');
  });

  it('returns null when a merged stream has neither a resolution nor outcomes to weight', () => {
    // A bare stream (no outcomes, no stance) carries no distribution → nothing
    // renderable, so the whole block collapses to null.
    const bare = makeNarrative({
      streams: { bare: stream('bare', 'A') },
      perspectives: { p1: { id: 'p1', kind: 'narrator' } },
    });
    const m = merge('m1', 'A', { streamIds: ['bare'], resolutions: {} });
    expect(renderMergeBasisBlock(bare, [m])).toBeNull();
  });

  it('renders a merge that mixes a resolved stream and an open-ended one', () => {
    const openStream = stream('s2', 'A', {
      title: 'Who holds the pass?',
      outcomes: ['north', 'south'],
      stance: { logits: [0.2, 0.2], volume: 2, volatility: 0 },
      priors: [{ id: 'q1', text: 'both sides moving troops', at: 1, logType: 'setup' }],
    });
    const mixed = makeNarrative({
      streams: { s1: overriddenStream, s2: openStream },
      perspectives: { p1: { id: 'p1', kind: 'character', entityRef: 'c1' } },
      members: { m1: { id: 'm1', firstName: 'Ada', lastName: 'Lovelace', role: 'member' } },
      characters: { c1: { id: 'c1', name: 'Envoy' } } as unknown as NarrativeState['characters'],
    });
    const m = merge('m1', 'A', { streamIds: ['s1', 's2'], resolutions: { s1: { outcome: 'no' } } });
    const block = renderMergeBasisBlock(mixed, [m])!;
    // The resolved stream keeps its committed-outcome spine.
    expect(block).toContain('<resolved ');
    expect(block).toContain('outcome="no"');
    // The unresolved stream renders alongside it as open-ended.
    expect(block).toContain('<open ');
    expect(block).toContain('Who holds the pass?');
  });

  it('renders the committed outcome, perspective + member attribution, and priors', () => {
    const m = merge('m1', 'A', {
      label: 'Session 1 close',
      streamIds: ['s1'],
      resolutions: { s1: { outcome: 'no', overridden: true } },
    });
    const block = renderMergeBasisBlock(baseNarrative, [m])!;
    expect(block).toContain('<continuity-basis');
    expect(block).toContain('Session 1 close');
    expect(block).toContain('outcome="no"');
    expect(block).toContain('member="Ada Lovelace"');
    // Perspective resolves to the bound character's name.
    expect(block).toContain('Envoy Mar');
    // Priors are carried as secondary directional pressure.
    expect(block).toContain('envoy returned with signed terms');
    expect(block).toContain('[payoff]');
  });

  it('ships the de-noising synthesis directive that turns noisy priors into a direction', () => {
    const m = merge('m1', 'A', {
      streamIds: ['s1'],
      resolutions: { s1: { outcome: 'no' } },
    });
    const block = renderMergeBasisBlock(baseNarrative, [m])!;
    // The synthesis block is what tells the consumer to de-noise priors +
    // resolutions into the direction the continuation advances along, and to
    // concretely realise each committed outcome (the coverage mandate).
    expect(block).toContain('<synthesis');
    expect(block).toContain('signal-vs-noise');
    expect(block).toContain('extract-vector');
    expect(block).toContain('realise-each');
  });

  it('flags overrides with the belief lean the committed outcome diverged from', () => {
    const m = merge('m1', 'A', {
      streamIds: ['s1'],
      resolutions: { s1: { outcome: 'no', overridden: true } },
    });
    const block = renderMergeBasisBlock(baseNarrative, [m])!;
    expect(block).toContain('overridden="true"');
    // belief leaned 'yes' (logit[0] highest) even though 'no' was committed.
    expect(block).toContain('belief-leaned="yes"');
  });

  it('renders the realism determination (telling + reasoning + closure) into the basis', () => {
    // The preprocessing enrichment that must reach generation: a contested /
    // pre-resolved question carries what reality DID + why + whether it closes.
    const m = merge('m1', 'A', {
      streamIds: ['s1'],
      resolutions: {
        s1: { outcome: 'no', telling: 'The truce frays as troops dig in.', reasoning: 'Momentum already past the point of recall.', closes: true },
      },
    });
    const block = renderMergeBasisBlock(baseNarrative, [m])!;
    expect(block).toContain('<conflict-resolution');
    expect(block).toContain('status="closed"'); // closes: true
    expect(block).toContain('<telling>The truce frays as troops dig in.</telling>');
    expect(block).toContain('<reasoning>Momentum already past the point of recall.</reasoning>');
  });

  it('marks an open (non-closing) realism verdict + omits reasoning when absent', () => {
    const m = merge('m1', 'A', {
      streamIds: ['s1'],
      resolutions: { s1: { outcome: 'no', telling: 'A fragile pause holds — for now.' } },
    });
    const block = renderMergeBasisBlock(baseNarrative, [m])!;
    expect(block).toContain('status="open"'); // closes falsy
    expect(block).toContain('<telling>A fragile pause holds — for now.</telling>');
    expect(block).not.toContain('<reasoning>');
  });

  it('does not flag override when the committed outcome matches the lean', () => {
    const m = merge('m1', 'A', {
      streamIds: ['s1'],
      resolutions: { s1: { outcome: 'yes' } },
    });
    const block = renderMergeBasisBlock(baseNarrative, [m])!;
    expect(block).not.toContain('overridden="true"');
    expect(block).toContain('outcome="yes"');
  });

  it('escapes XML-significant characters in attributes', () => {
    const m = merge('m1', 'A', {
      streamIds: ['s1'],
      resolutions: { s1: { outcome: 'yes' } },
    });
    const block = renderMergeBasisBlock(baseNarrative, [m])!;
    // The character name contains } and " — must be entity-escaped, never raw.
    expect(block).toContain('&quot;');
    expect(block).not.toContain('"Quill"');
  });

  it('renders a multi-resolution as the primary outcome plus the full set', () => {
    const m = merge('m1', 'A', {
      streamIds: ['s1'],
      // Committed to BOTH yes and partial — the LLM reconciles them.
      resolutions: { s1: { outcome: 'yes', outcomes: ['yes', 'partial'] } },
    });
    const block = renderMergeBasisBlock(baseNarrative, [m])!;
    expect(block).toContain('outcome="yes"');
    expect(block).toContain('multi-resolved="yes + partial"');
  });
});

// ── resolutionOutcomes / isMultiResolution ───────────────────────────────────

describe('resolutionOutcomes', () => {
  it('returns the single outcome as a one-element set', () => {
    expect(resolutionOutcomes({ outcome: 'yes' })).toEqual(['yes']);
  });

  it('returns the full multi set, ignoring the duplicated primary', () => {
    expect(resolutionOutcomes({ outcome: 'yes', outcomes: ['yes', 'partial'] })).toEqual(['yes', 'partial']);
  });

  it('is empty for an undefined resolution or one with no outcome', () => {
    expect(resolutionOutcomes(undefined)).toEqual([]);
    expect(resolutionOutcomes({ outcome: '' })).toEqual([]);
  });

  it('isMultiResolution is true only when more than one outcome is committed', () => {
    expect(isMultiResolution({ outcome: 'yes' })).toBe(false);
    expect(isMultiResolution({ outcome: 'yes', outcomes: ['yes'] })).toBe(false);
    expect(isMultiResolution({ outcome: 'yes', outcomes: ['yes', 'no'] })).toBe(true);
  });
});
