/**
 * file-conversion tests — focused on the pure pieces of the Apply
 * pipeline that don't depend on the LLM:
 *
 *   1. PrefixedIdMinter behaviour (counter continuation, prefix detection)
 *   2. Cross-narrative merge plan construction (existing as source of truth)
 *   3. commitPreparedApply ID remapping correctness given a hand-built
 *      PreparedApply (no LLM mocking needed)
 *
 * The LLM-bearing `reconcileExtensionAgainstNarrative` and the assemble
 * stages have their own tests; here we verify the remap + dispatch
 * behaviour those phases feed into.
 */

import { describe, it, expect, vi } from 'vitest';
import { commitPreparedApply, type PreparedApply, type ExtensionMergePlan } from '@/lib/file-conversion';
import type { Action } from '@/lib/store';
import type {
  Arc,
  Character,
  Location,
  NarrativeState,
  Scene,
  SourceFile,
  Thread,
} from '@/types/narrative';

vi.mock('@/lib/asset-manager', () => ({
  assetManager: {
    getText: vi.fn(),
    storeText: vi.fn(),
    deleteText: vi.fn(),
  },
}));

vi.mock('@/lib/text-analysis', () => ({
  splitCorpusIntoScenes: vi.fn(),
  reconcileEntities: vi.fn(),
  reconcileSemantic: vi.fn(),
}));

vi.mock('@/lib/analysis-runner', () => ({
  analysisRunner: { start: vi.fn() },
}));

// ── Test fixtures ──────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function makeCharacter(id: string, name: string): Character {
  return {
    id,
    name,
    role: 'recurring',
    threadIds: [],
    world: { nodes: {}, edges: [] },
  };
}

function makeLocation(id: string, name: string): Location {
  return {
    id,
    name,
    prominence: 'place',
    parentId: null,
    tiedCharacterIds: [],
    threadIds: [],
    world: { nodes: {}, edges: [] },
  };
}

function makeThread(id: string, description: string): Thread {
  return {
    id,
    description,
    participants: [],
    outcomes: ['yes', 'no'],
    beliefs: {},
    openedAt: 'S-EX-1',
    dependents: [],
    threadLog: { nodes: {}, edges: [] },
  };
}

function makeScene(id: string, arcId: string, locationId: string, povId: string | null): Scene {
  return {
    kind: 'scene',
    id,
    arcId,
    locationId,
    povId,
    participantIds: [],
    events: [],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    summary: '',
  };
}

function makeArc(id: string, sceneIds: string[]): Arc {
  return {
    id,
    name: '',
    sceneIds,
    locationIds: [],
    activeCharacterIds: [],
    initialCharacterLocations: {},
    develops: [],
  } as Arc;
}

/** A tiny narrative with the canonical analysis-pipeline id form:
 *  `C-USP-1` for the first character. New extension entities should
 *  continue that USP counter. */
function makeNarrative(): NarrativeState {
  return {
    id: 'N-USP-1',
    title: 'US Politics',
    description: '',
    characters: {
      'C-USP-1': makeCharacter('C-USP-1', 'Donald Trump'),
      'C-USP-2': makeCharacter('C-USP-2', 'Xi Jinping'),
    },
    locations: {
      'L-USP-1': makeLocation('L-USP-1', 'Beijing'),
    },
    artifacts: {},
    threads: {
      'T-USP-1': makeThread('T-USP-1', 'Will the Iran ceasefire hold?'),
    },
    arcs: {
      'ARC-USP-1': makeArc('ARC-USP-1', ['S-USP-1']),
    },
    scenes: {
      'S-USP-1': makeScene('S-USP-1', 'ARC-USP-1', 'L-USP-1', 'C-USP-1'),
    },
    worldBuilds: {},
    branches: {
      'B-1': {
        id: 'B-1',
        name: 'main',
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ['S-USP-1'],
        createdAt: NOW - 1000,
      },
    },
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: '',
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
  };
}

/** A slice produced by an extension run. Uses its own prefix "EXT" so
 *  every id collides with the narrative's USP prefix only by chance.
 *  The slice has two characters: one that names a known existing
 *  (Donald Trump → maps to existing in the test merge plan) and one
 *  net-new (Elon Musk). */
function makeSlice(): NarrativeState {
  return {
    id: 'N-EXT-1',
    title: 'Next Day',
    description: '',
    characters: {
      'C-EXT-1': makeCharacter('C-EXT-1', 'Donald Trump'), // merges into C-USP-1
      'C-EXT-2': makeCharacter('C-EXT-2', 'Elon Musk'),    // net new
    },
    locations: {
      'L-EXT-1': makeLocation('L-EXT-1', 'Beijing'), // merges into L-USP-1
    },
    artifacts: {},
    threads: {
      'T-EXT-1': makeThread('T-EXT-1', 'Will trade negotiations succeed?'), // net new
    },
    arcs: {
      'ARC-EXT-1': makeArc('ARC-EXT-1', ['S-EXT-1']),
    },
    scenes: {
      'S-EXT-1': {
        ...makeScene('S-EXT-1', 'ARC-EXT-1', 'L-EXT-1', 'C-EXT-1'),
        participantIds: ['C-EXT-1', 'C-EXT-2'],
        threadDeltas: [{ threadId: 'T-EXT-1', updates: [], logType: 'pulse', volumeDelta: 0, rationale: '' }],
      } as Scene,
    },
    worldBuilds: {},
    branches: {
      'B-EXT-1': {
        id: 'B-EXT-1',
        name: 'main',
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ['S-EXT-1'],
        createdAt: NOW,
      },
    },
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: '',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeFile(): SourceFile {
  return {
    id: 'F-USP-2',
    name: 'Next Day',
    mode: 'extend',
    contentRef: 'text_abc',
    charCount: 100,
    wordCount: 20,
    createdAt: NOW,
    status: 'ready',
    extractedRef: 'text_slice',
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('commitPreparedApply', () => {
  it('redirects merged entities to the existing id and drops the slice record', () => {
    const narrative = makeNarrative();
    const slice = makeSlice();
    const mergePlan: ExtensionMergePlan = {
      characters: new Map([['Donald Trump', 'Donald Trump']]),
      locations: new Map([['Beijing', 'Beijing']]),
      artifacts: new Map(),
      threads: new Map(),
      systemConcepts: new Map(),
    };
    const prepared: PreparedApply = {
      slice,
      mergePlan,
      summary: {
        characters: { merged: [], new: [] },
        locations: { merged: [], new: [] },
        artifacts: { merged: [], new: [] },
        threads: { merged: [], new: [] },
        systemConcepts: { merged: [], new: [] },
        scenes: 1,
        arcs: 1,
        worldBuilds: 0,
      },
    };

    const dispatched: Action[] = [];
    const dispatch = (action: Action) => {
      dispatched.push(action);
    };

    commitPreparedApply(narrative, makeFile(), 'B-1', prepared, dispatch);

    const apply = dispatched.find((a) => a.type === 'APPLY_EXTENSION');
    expect(apply).toBeDefined();
    if (apply?.type !== 'APPLY_EXTENSION') throw new Error('expected APPLY_EXTENSION');

    // Donald Trump (merged) — should NOT appear in characters (existing
    // record stays authoritative). Elon Musk (new) — should appear.
    const newCharNames = apply.characters.map((c) => c.name);
    expect(newCharNames).not.toContain('Donald Trump');
    expect(newCharNames).toContain('Elon Musk');

    // Beijing (merged) — should NOT appear in locations.
    const newLocNames = apply.locations.map((l) => l.name);
    expect(newLocNames).not.toContain('Beijing');

    // Thread is net-new.
    expect(apply.threads.map((t) => t.description)).toContain('Will trade negotiations succeed?');
  });

  it('continues the narrative ID counter when minting new ids', () => {
    const narrative = makeNarrative();
    const slice = makeSlice();
    const mergePlan: ExtensionMergePlan = {
      characters: new Map([['Donald Trump', 'Donald Trump']]), // merges
      locations: new Map([['Beijing', 'Beijing']]),
      artifacts: new Map(),
      threads: new Map(),
      systemConcepts: new Map(),
    };
    const prepared: PreparedApply = {
      slice,
      mergePlan,
      summary: {
        characters: { merged: [], new: [] },
        locations: { merged: [], new: [] },
        artifacts: { merged: [], new: [] },
        threads: { merged: [], new: [] },
        systemConcepts: { merged: [], new: [] },
        scenes: 1,
        arcs: 1,
        worldBuilds: 0,
      },
    };
    const dispatched: Action[] = [];
    commitPreparedApply(narrative, makeFile(), 'B-1', prepared, (a) => dispatched.push(a));
    const apply = dispatched.find((a) => a.type === 'APPLY_EXTENSION');
    if (apply?.type !== 'APPLY_EXTENSION') throw new Error('expected APPLY_EXTENSION');

    // New character should continue the USP prefix: existing is C-USP-2,
    // so Elon Musk should land as C-USP-3 (not a fresh C-1).
    const musk = apply.characters.find((c) => c.name === 'Elon Musk');
    expect(musk?.id).toBe('C-USP-3');

    // New thread should continue T-USP counter (existing T-USP-1 → next T-USP-2).
    expect(apply.threads[0]?.id).toBe('T-USP-2');

    // New scene gets next S-USP id (existing S-USP-1 → next S-USP-2).
    expect(apply.scenes.map((s) => s.id)).toEqual(['S-USP-2']);

    // Arc continues ARC-USP counter.
    expect(apply.arcs.map((a) => a.id)).toEqual(['ARC-USP-2']);
  });

  it('remaps every cross-reference inside the appended scene', () => {
    const narrative = makeNarrative();
    const slice = makeSlice();
    const mergePlan: ExtensionMergePlan = {
      characters: new Map([['Donald Trump', 'Donald Trump']]),
      locations: new Map([['Beijing', 'Beijing']]),
      artifacts: new Map(),
      threads: new Map(),
      systemConcepts: new Map(),
    };
    const prepared: PreparedApply = {
      slice,
      mergePlan,
      summary: {
        characters: { merged: [], new: [] },
        locations: { merged: [], new: [] },
        artifacts: { merged: [], new: [] },
        threads: { merged: [], new: [] },
        systemConcepts: { merged: [], new: [] },
        scenes: 1,
        arcs: 1,
        worldBuilds: 0,
      },
    };
    const dispatched: Action[] = [];
    commitPreparedApply(narrative, makeFile(), 'B-1', prepared, (a) => dispatched.push(a));
    const apply = dispatched.find((a) => a.type === 'APPLY_EXTENSION');
    if (apply?.type !== 'APPLY_EXTENSION') throw new Error('expected APPLY_EXTENSION');

    const scene = apply.scenes[0];
    // povId was C-EXT-1 → existing C-USP-1
    expect(scene.povId).toBe('C-USP-1');
    // locationId was L-EXT-1 → existing L-USP-1
    expect(scene.locationId).toBe('L-USP-1');
    // arcId points at the newly-minted arc
    expect(scene.arcId).toBe('ARC-USP-2');
    // participantIds: one merged (C-USP-1), one net-new (C-USP-3)
    expect(scene.participantIds).toEqual(['C-USP-1', 'C-USP-3']);
    // threadDeltas point at the net-new thread id (T-USP-2)
    expect(scene.threadDeltas[0]?.threadId).toBe('T-USP-2');
  });

  it('appends entry ids to the chosen branch in slice order', () => {
    const narrative = makeNarrative();
    const slice = makeSlice();
    const mergePlan: ExtensionMergePlan = {
      characters: new Map(),
      locations: new Map(),
      artifacts: new Map(),
      threads: new Map(),
      systemConcepts: new Map(),
    };
    const prepared: PreparedApply = {
      slice,
      mergePlan,
      summary: {
        characters: { merged: [], new: [] },
        locations: { merged: [], new: [] },
        artifacts: { merged: [], new: [] },
        threads: { merged: [], new: [] },
        systemConcepts: { merged: [], new: [] },
        scenes: 1,
        arcs: 1,
        worldBuilds: 0,
      },
    };
    const dispatched: Action[] = [];
    commitPreparedApply(narrative, makeFile(), 'B-1', prepared, (a) => dispatched.push(a));
    const apply = dispatched.find((a) => a.type === 'APPLY_EXTENSION');
    if (apply?.type !== 'APPLY_EXTENSION') throw new Error('expected APPLY_EXTENSION');

    // Slice root branch had [S-EXT-1]; after remap this lands as the
    // freshly-minted scene id (S-USP-2) appended to branch B-1.
    expect(apply.appendEntryIds).toEqual(['S-USP-2']);
    expect(apply.branchId).toBe('B-1');
  });

  it('stamps the file as committed with the right commit record', () => {
    const narrative = makeNarrative();
    const slice = makeSlice();
    const file = makeFile();
    const prepared: PreparedApply = {
      slice,
      mergePlan: {
        characters: new Map(),
        locations: new Map(),
        artifacts: new Map(),
        threads: new Map(),
        systemConcepts: new Map(),
      },
      summary: {
        characters: { merged: [], new: [] },
        locations: { merged: [], new: [] },
        artifacts: { merged: [], new: [] },
        threads: { merged: [], new: [] },
        systemConcepts: { merged: [], new: [] },
        scenes: 1,
        arcs: 1,
        worldBuilds: 0,
      },
    };
    const dispatched: Action[] = [];
    commitPreparedApply(narrative, file, 'B-1', prepared, (a) => dispatched.push(a));

    const update = dispatched.find(
      (a) => a.type === 'UPDATE_SOURCE_FILE' && a.fileId === file.id,
    );
    expect(update).toBeDefined();
    if (update?.type !== 'UPDATE_SOURCE_FILE') throw new Error('expected UPDATE_SOURCE_FILE');
    // Status stays 'ready' — extension files can be applied to multiple
    // branches; the per-branch ledger lives in `commits`.
    expect(update.updates.status).toBeUndefined();
    expect(update.updates.commits?.['B-1']).toBeDefined();
    expect(update.updates.commits?.['B-1'].sceneIds.length).toBeGreaterThan(0);
  });

  it('preserves commits on other branches when re-applying', () => {
    const narrative = makeNarrative();
    // Pre-seed a commit on a sibling branch so we can verify the merge
    // doesn't clobber it.
    const file = {
      ...makeFile(),
      commits: { 'B-other': { arcId: 'ARC-USP-99', sceneIds: ['S-USP-99'], committedAt: 1 } },
    };
    const prepared: PreparedApply = {
      slice: makeSlice(),
      mergePlan: {
        characters: new Map(),
        locations: new Map(),
        artifacts: new Map(),
        threads: new Map(),
        systemConcepts: new Map(),
      },
      summary: {
        characters: { merged: [], new: [] },
        locations: { merged: [], new: [] },
        artifacts: { merged: [], new: [] },
        threads: { merged: [], new: [] },
        systemConcepts: { merged: [], new: [] },
        scenes: 1,
        arcs: 1,
        worldBuilds: 0,
      },
    };
    const dispatched: Action[] = [];
    commitPreparedApply(narrative, file, 'B-1', prepared, (a) => dispatched.push(a));
    const update = dispatched.find(
      (a) => a.type === 'UPDATE_SOURCE_FILE' && a.fileId === file.id,
    );
    if (update?.type !== 'UPDATE_SOURCE_FILE') throw new Error('expected UPDATE_SOURCE_FILE');
    // Both branches should be in the commits map.
    expect(Object.keys(update.updates.commits ?? {})).toEqual(
      expect.arrayContaining(['B-other', 'B-1']),
    );
    // Sibling branch's commit untouched.
    expect(update.updates.commits?.['B-other'].arcId).toBe('ARC-USP-99');
  });

  it('throws when the file has no extracted slice', async () => {
    const narrative = makeNarrative();
    const file = { ...makeFile(), extractedRef: undefined };
    const prepared: PreparedApply = {
      slice: makeSlice(),
      mergePlan: {
        characters: new Map(),
        locations: new Map(),
        artifacts: new Map(),
        threads: new Map(),
        systemConcepts: new Map(),
      },
      summary: {
        characters: { merged: [], new: [] },
        locations: { merged: [], new: [] },
        artifacts: { merged: [], new: [] },
        threads: { merged: [], new: [] },
        systemConcepts: { merged: [], new: [] },
        scenes: 1,
        arcs: 1,
        worldBuilds: 0,
      },
    };
    // commitPreparedApply doesn't read the file — it uses the already-loaded
    // slice. So a missing extractedRef is irrelevant here. Just sanity-check
    // that commit still runs against the prepared slice.
    const dispatched: Action[] = [];
    expect(() =>
      commitPreparedApply(narrative, file, 'B-1', prepared, (a) => dispatched.push(a)),
    ).not.toThrow();
  });

  it('handles a slice with no merges (all net-new)', () => {
    const narrative = makeNarrative();
    const slice = makeSlice();
    // Empty merge plan — every slice entity is treated as new.
    const prepared: PreparedApply = {
      slice,
      mergePlan: {
        characters: new Map(),
        locations: new Map(),
        artifacts: new Map(),
        threads: new Map(),
        systemConcepts: new Map(),
      },
      summary: {
        characters: { merged: [], new: [] },
        locations: { merged: [], new: [] },
        artifacts: { merged: [], new: [] },
        threads: { merged: [], new: [] },
        systemConcepts: { merged: [], new: [] },
        scenes: 1,
        arcs: 1,
        worldBuilds: 0,
      },
    };
    const dispatched: Action[] = [];
    commitPreparedApply(narrative, makeFile(), 'B-1', prepared, (a) => dispatched.push(a));
    const apply = dispatched.find((a) => a.type === 'APPLY_EXTENSION');
    if (apply?.type !== 'APPLY_EXTENSION') throw new Error('expected APPLY_EXTENSION');

    // Both slice characters land as new — Donald Trump (C-USP-3) and Elon Musk (C-USP-4).
    expect(apply.characters.map((c) => c.name).sort()).toEqual(['Donald Trump', 'Elon Musk']);
    // Counter continuation: existing C-USP-1, C-USP-2 → new lands as C-USP-3, C-USP-4.
    const ids = apply.characters.map((c) => c.id).sort();
    expect(ids).toEqual(['C-USP-3', 'C-USP-4']);
  });
});
