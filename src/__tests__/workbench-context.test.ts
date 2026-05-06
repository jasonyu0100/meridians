import { describe, expect, it } from 'vitest';
import { buildWorkbenchContext } from '@/lib/ai/workbench';
import { EMPTY_SYSTEM_GRAPH } from '@/lib/system-graph';
import type {
  Arc,
  Branch,
  NarrativeState,
  Scene,
} from '@/types/narrative';

// ── Minimal fixture builder — only the fields buildWorkbenchContext reads ────

function scene(id: string, arcId: string, summary: string): Scene {
  return {
    id,
    arcId,
    povId: null,
    locationId: 'L-01',
    participantIds: [],
    events: [],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    summary,
    timeDelta: { value: 0, unit: 'minute' },
    kind: 'scene',
  } as Scene;
}

function arc(id: string, name: string, sceneIds: string[]): Arc {
  return {
    id,
    name,
    sceneIds,
    develops: [],
    locationIds: [],
    activeCharacterIds: [],
    initialCharacterLocations: {},
  } as Arc;
}

function branch(
  id: string,
  parent: string | null,
  forkEntryId: string | null,
  entryIds: string[],
): Branch {
  return { id, name: id, parentBranchId: parent, forkEntryId, entryIds, createdAt: 0 };
}

function makeNarrative(opts: {
  scenes: Scene[];
  arcs: Arc[];
  branches: Branch[];
}): NarrativeState {
  return {
    id: 'N-01',
    title: 'Test',
    scenes: Object.fromEntries(opts.scenes.map((s) => [s.id, s])),
    arcs: Object.fromEntries(opts.arcs.map((a) => [a.id, a])),
    branches: Object.fromEntries(opts.branches.map((b) => [b.id, b])),
    characters: {},
    locations: {
      'L-01': {
        id: 'L-01',
        name: 'TestLoc',
        prominence: 'place',
        threadIds: [],
        world: { nodes: {}, edges: [] },
      },
    },
    artifacts: {},
    threads: {},
    worldBuilds: {},
    systemGraph: EMPTY_SYSTEM_GRAPH,
    structureEvaluations: {},
    proseEvaluations: {},
    planEvaluations: {},
    direction: '',
    constraints: '',
    worldDirection: '',
    worldConstraints: '',
    worldSummary: '',
    storySettings: {} as NarrativeState['storySettings'],
  } as unknown as NarrativeState;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildWorkbenchContext', () => {
  it('returns the empty-branches sentinel when scopes is empty', () => {
    const n = makeNarrative({ scenes: [], arcs: [], branches: [] });
    expect(buildWorkbenchContext(n, [])).toBe('<branches />');
  });

  it('renders a single branch outline grouped by arc', () => {
    const n = makeNarrative({
      scenes: [
        scene('S1', 'A1', 'opening scene'),
        scene('S2', 'A1', 'second scene'),
      ],
      arcs: [arc('A1', 'Origin', ['S1', 'S2'])],
      branches: [branch('Canon', null, null, ['S1', 'S2'])],
    });
    const out = buildWorkbenchContext(n, [{ branchId: 'Canon', start: 1, end: 2 }]);
    expect(out).toContain('<branch name="Canon"');
    expect(out).toContain('<arc name="Origin">');
    expect(out).toContain('<scene index="1"');
    expect(out).toContain('<scene index="2"');
    expect(out).toContain('opening scene');
    expect(out).toContain('second scene');
  });

  it('respects scope start/end — only entries within window are rendered', () => {
    const n = makeNarrative({
      scenes: [
        scene('S1', 'A1', 'first'),
        scene('S2', 'A1', 'second'),
        scene('S3', 'A1', 'third'),
        scene('S4', 'A1', 'fourth'),
      ],
      arcs: [arc('A1', 'Origin', ['S1', 'S2', 'S3', 'S4'])],
      branches: [branch('Canon', null, null, ['S1', 'S2', 'S3', 'S4'])],
    });
    const out = buildWorkbenchContext(n, [{ branchId: 'Canon', start: 2, end: 3 }]);
    expect(out).not.toContain('first');
    expect(out).toContain('second');
    expect(out).toContain('third');
    expect(out).not.toContain('fourth');
    // Indices are GLOBAL — entry #2 should still show as index="2", not "1".
    expect(out).toContain('<scene index="2"');
    expect(out).toContain('<scene index="3"');
    expect(out).not.toContain('<scene index="1"');
  });

  it('emits a shared-baseline block for the LCP across multiple branches', () => {
    // Canon has 4 entries; Branch B forks from S2 and adds S3b.
    // Shared prefix [S1, S2] is the baseline.
    const n = makeNarrative({
      scenes: [
        scene('S1', 'A1', 'shared one'),
        scene('S2', 'A1', 'shared two'),
        scene('S3', 'A1', 'canon-only'),
        scene('S3b', 'A2', 'branch-only divergence'),
      ],
      arcs: [
        arc('A1', 'Mainline', ['S1', 'S2', 'S3']),
        arc('A2', 'Divergence', ['S3b']),
      ],
      branches: [
        branch('Canon', null, null, ['S1', 'S2', 'S3']),
        branch('B', 'Canon', 'S2', ['S3b']),
      ],
    });
    const out = buildWorkbenchContext(n, [
      { branchId: 'Canon', start: 1, end: 3 },
      { branchId: 'B', start: 1, end: 3 },
    ]);
    expect(out).toContain('<shared-baseline');
    expect(out).toContain('shared one');
    expect(out).toContain('shared two');
    // Each branch block still appears.
    expect(out).toContain('<branch name="Canon"');
    expect(out).toContain('<branch name="B"');
  });

  it('does NOT emit shared-baseline for a single branch', () => {
    const n = makeNarrative({
      scenes: [scene('S1', 'A1', 'only')],
      arcs: [arc('A1', 'Solo', ['S1'])],
      branches: [branch('Canon', null, null, ['S1'])],
    });
    const out = buildWorkbenchContext(n, [{ branchId: 'Canon', start: 1, end: 1 }]);
    expect(out).not.toContain('<shared-baseline');
  });

  it('marks an empty scope explicitly', () => {
    const n = makeNarrative({
      scenes: [],
      arcs: [],
      branches: [branch('Empty', null, null, [])],
    });
    const out = buildWorkbenchContext(n, [{ branchId: 'Empty', start: 0, end: 0 }]);
    expect(out).toContain('<branch name="Empty"');
    expect(out).toContain('<empty />');
  });
});
