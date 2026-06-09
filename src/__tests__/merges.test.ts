// Tests for lib/merges — branch-scoped visibility (ownership model),
// per-branch merge consumption (basisMergeIds on arcs / world-builds), and the
// <continuity-basis> prompt block renderer.

import { describe, it, expect } from 'vitest';
import type { NarrativeState, Stream, Merge, Branch, Scene, WorldBuild, Arc } from '@/types/narrative';
import {
  isVisibleOnBranch,
  streamsForBranch,
  mergesForBranch,
  collectConsumedMergeIds,
  findMergeConsumer,
  buildMergeConsumerMap,
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

// ── isVisibleOnBranch ──────────────────────────────────────────────────────

describe('isVisibleOnBranch', () => {
  const lineage = new Set(['B', 'A', 'CANON']);

  it('shows a row whose origin is on the lineage', () => {
    expect(isVisibleOnBranch('A', lineage)).toBe(true);
    expect(isVisibleOnBranch('CANON', lineage)).toBe(true);
  });

  it('hides a row whose origin is off the lineage (a sibling branch)', () => {
    expect(isVisibleOnBranch('C', lineage)).toBe(false);
  });

  it('treats an unstamped (legacy) row as visible everywhere', () => {
    expect(isVisibleOnBranch(undefined, lineage)).toBe(true);
    expect(isVisibleOnBranch(undefined, new Set())).toBe(true);
  });
});

// ── streamsForBranch / mergesForBranch ───────────────────────────────────────

describe('streamsForBranch', () => {
  const n = makeNarrative({
    streams: {
      s_canon: stream('s_canon', 'CANON'),
      s_a: stream('s_a', 'A'),
      s_b: stream('s_b', 'B'),
      s_c: stream('s_c', 'C'),
      s_legacy: stream('s_legacy', undefined),
    },
  });

  it('a descendant sees ancestor + own streams, not sibling ones', () => {
    // Active branch B: lineage B→A→CANON. Sees s_canon, s_a, s_b, s_legacy. NOT s_c.
    const ids = streamsForBranch(n, 'B').map((s) => s.id).sort();
    expect(ids).toEqual(['s_a', 's_b', 's_canon', 's_legacy']);
  });

  it('an ancestor does NOT see streams opened on a descendant', () => {
    // Active branch CANON: only its own + legacy. Not s_a / s_b / s_c.
    const ids = streamsForBranch(n, 'CANON').map((s) => s.id).sort();
    expect(ids).toEqual(['s_canon', 's_legacy']);
  });

  it('sibling branches share the common ancestor but not each other (divergence)', () => {
    // C forks off CANON, so it inherits s_canon — but NOT s_a / s_b (the A line).
    expect(streamsForBranch(n, 'C').map((s) => s.id).sort()).toEqual(['s_c', 's_canon', 's_legacy']);
    expect(streamsForBranch(n, 'C').some((s) => s.id === 's_a' || s.id === 's_b')).toBe(false);
    // A inherits s_canon too but never sees C's stream.
    expect(streamsForBranch(n, 'A').map((s) => s.id).sort()).toEqual(['s_a', 's_canon', 's_legacy']);
    expect(streamsForBranch(n, 'A').some((s) => s.id === 's_c')).toBe(false);
  });

  it('a null active branch still surfaces legacy streams', () => {
    expect(streamsForBranch(n, null).map((s) => s.id)).toEqual(['s_legacy']);
  });

  it('surfaces a stream whose origin branch no longer exists (orphan fallback)', () => {
    // Defense-in-depth: branch deletion normally removes owned streams, but a
    // stream stamped with a GONE branch must still be reachable (recoverable),
    // never silently invisible. It shows regardless of the active branch.
    const orphaned = makeNarrative({
      streams: { s_orphan: stream('s_orphan', 'DELETED_BRANCH'), s_a: stream('s_a', 'A') },
    });
    expect(streamsForBranch(orphaned, 'CANON').map((s) => s.id)).toContain('s_orphan');
    expect(streamsForBranch(orphaned, 'B').map((s) => s.id)).toContain('s_orphan');
    // A live sibling's stream is still correctly hidden from CANON.
    expect(streamsForBranch(orphaned, 'CANON').map((s) => s.id)).not.toContain('s_a');
  });
});

describe('mergesForBranch', () => {
  const n = makeNarrative({
    merges: {
      m_a: merge('m_a', 'A'),
      m_c: merge('m_c', 'C'),
      m_legacy: merge('m_legacy', undefined),
    },
  });

  it('scopes merges by lineage like streams', () => {
    expect(mergesForBranch(n, 'B').map((m) => m.id).sort()).toEqual(['m_a', 'm_legacy']);
    expect(mergesForBranch(n, 'C').map((m) => m.id).sort()).toEqual(['m_c', 'm_legacy']);
  });

  it('surfaces a merge whose origin branch no longer exists (orphan fallback)', () => {
    const orphaned = makeNarrative({
      merges: { m_orphan: merge('m_orphan', 'DELETED_BRANCH') },
    });
    expect(mergesForBranch(orphaned, 'CANON').map((m) => m.id)).toContain('m_orphan');
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

  it('renders an unresolved stream as <open> with its stance distribution (no fact)', () => {
    // The merge folds s1 in but commits NO outcome — it stays open-ended.
    const m = merge('m1', 'A', { streamIds: ['s1'], resolutions: {} });
    const block = renderMergeBasisBlock(baseNarrative, [m])!;
    expect(block).not.toBeNull();
    expect(block).toContain('<open ');
    // belief leans 'yes' (logit 1.2 vs 0.1) → ~75/25, leaning 'yes'.
    expect(block).toContain('leaning="yes"');
    expect(block).toContain('distribution="yes 75% · no 25%"');
    // Priors are framed as open thought, not as evidence for a committed fact.
    expect(block).toContain('OPEN THOUGHT');
    expect(block).toContain('envoy returned with signed terms');
    // No committed outcome is asserted for an open-ended stream.
    expect(block).not.toContain('outcome="');
    // The synthesis carries the open-question handling step.
    expect(block).toContain('open-questions');
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
