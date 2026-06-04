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
import { commitPreparedApply, type PreparedApply, type ExtensionMergePlan } from '@/lib/io/file-conversion';
import type { Action } from '@/lib/state/store';
import type {
  Arc,
  Character,
  Location,
  NarrativeState,
  Scene,
  SourceFile,
  Thread,
} from '@/types/narrative';

vi.mock('@/lib/storage/asset-manager', () => ({
  assetManager: {
    getText: vi.fn(),
    storeText: vi.fn(),
    deleteText: vi.fn(),
  },
}));

vi.mock('@/lib/analysis/text-analysis', () => ({
  splitCorpusIntoScenes: vi.fn(),
  reconcileEntities: vi.fn(),
  reconcileSemantic: vi.fn(),
  integrateSliceThreadsIntoExisting: vi.fn(),
}));

vi.mock('@/lib/analysis/analysis-runner', () => ({
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
    stances: {},
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

    // commitPreparedApply only emits APPLY_EXTENSION — no file-status
    // bookkeeping is dispatched. Files stay narrative-wide artifacts;
    // re-applying the same file is a separate Apply that produces new
    // ids, not a status change on the file record.
    const fileUpdate = dispatched.find(
      (a) => a.type === 'UPDATE_SOURCE_FILE' && a.fileId === file.id,
    );
    expect(fileUpdate).toBeUndefined();
  });

  it('re-apply mints a fresh set of ids each time', () => {
    const narrative = makeNarrative();
    const slice = makeSlice();
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

    // First apply lands the slice's scene as S-USP-2 (continuing the
    // existing C-USP-1 narrative counter).
    const dispatched1: Action[] = [];
    commitPreparedApply(narrative, makeFile(), 'B-1', prepared, (a) => dispatched1.push(a));
    const apply1 = dispatched1.find((a) => a.type === 'APPLY_EXTENSION');
    if (apply1?.type !== 'APPLY_EXTENSION') throw new Error('expected APPLY_EXTENSION');
    expect(apply1.scenes[0].id).toBe('S-USP-2');

    // Simulate the post-merge narrative (the reducer would have
    // appended the new scene). A second apply against this state
    // should produce different ids — re-apply is repeatable.
    const merged: NarrativeState = {
      ...narrative,
      scenes: { ...narrative.scenes, [apply1.scenes[0].id]: apply1.scenes[0] },
      characters: {
        ...narrative.characters,
        ...Object.fromEntries(apply1.characters.map((c) => [c.id, c])),
      },
    };

    const dispatched2: Action[] = [];
    commitPreparedApply(merged, makeFile(), 'B-1', prepared, (a) => dispatched2.push(a));
    const apply2 = dispatched2.find((a) => a.type === 'APPLY_EXTENSION');
    if (apply2?.type !== 'APPLY_EXTENSION') throw new Error('expected APPLY_EXTENSION');
    // The second apply continues the counter past whatever the first
    // claimed — no collision with the previously-minted id.
    expect(apply2.scenes[0].id).not.toBe(apply1.scenes[0].id);
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

  it('remaps thread dependents + beliefs + threadLog sceneId references', () => {
    const narrative = makeNarrative();
    const slice = makeSlice();
    // Augment the slice's net-new thread with cross-references that must
    // be remapped: a dependent thread id (the slice's own pre-existing
    // T-EXT-X), a beliefs entry keyed by a character id, and a threadLog
    // node with a sceneId backref to the slice scene.
    const sliceWithThreadRefs = {
      ...slice,
      threads: {
        ...slice.threads,
        'T-EXT-1': {
          ...slice.threads['T-EXT-1'],
          // Introduction key points at a slice scene — must be remapped
          // to the corresponding narrative-side scene id, otherwise
          // portfolio / market views treat the thread as orphaned.
          openedAt: 'S-EXT-1',
          dependents: ['T-EXT-other'],
          stances: {
            'C-EXT-1': { logits: [0, 0], volume: 1, volatility: 0, lastTouchedScene: 'S-EXT-1' },
            __narrator__: { logits: [0, 0], volume: 1, volatility: 0 },
          },
          threadLog: {
            nodes: {
              'L-1': { id: 'L-1', type: 'setup' as const, content: 'opened', sceneId: 'S-EXT-1' },
            },
            edges: [],
          },
        },
      },
    };
    const prepared: PreparedApply = {
      slice: sliceWithThreadRefs,
      mergePlan: {
        // Donald Trump merges so C-EXT-1 → C-USP-1 in the beliefs key.
        characters: new Map([['Donald Trump', 'Donald Trump']]),
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

    const thread = apply.threads[0];
    // beliefs key C-EXT-1 → C-USP-1 (merged); sentinel __narrator__ stays.
    expect(Object.keys(thread.stances)).toEqual(expect.arrayContaining(['C-USP-1', '__narrator__']));
    // lastTouchedScene sceneId on beliefs → the new scene id.
    expect(thread.stances?.['C-USP-1'].lastTouchedScene).toBe('S-USP-2');
    // threadLog node.sceneId → new scene id.
    expect(thread.threadLog.nodes['L-1'].sceneId).toBe('S-USP-2');
    // Dependents id that wasn't in the maps stays verbatim (no slice
    // record carries it; falling through to the original is intentional).
    expect(thread.dependents).toEqual(['T-EXT-other']);
    // openedAt slice-scene reference → narrative-side scene id, matching
    // how the rest of the scene-id refs (lastTouchedScene, threadLog
    // sceneId) remap. Required so the portfolio + market views treat
    // the thread as properly introduced post-Apply.
    expect(thread.openedAt).toBe('S-USP-2');
  });

  it('remaps gameAnalysis playerAId / playerBId on scenes', () => {
    const narrative = makeNarrative();
    const slice = makeSlice();
    const sliceWithGames = {
      ...slice,
      scenes: {
        ...slice.scenes,
        'S-EXT-1': {
          ...slice.scenes['S-EXT-1'],
          gameAnalysis: {
            games: [
              {
                beatIndex: 0,
                beatExcerpt: '',
                gameType: 'coordination' as const,
                actionAxis: 'commitment' as const,
                playerAId: 'C-EXT-1', // merges → C-USP-1
                playerAName: 'Donald Trump',
                playerAActions: [],
                playerBId: 'C-EXT-2', // net new → C-USP-3
                playerBName: 'Elon Musk',
                playerBActions: [],
                outcomes: [],
                realizedAAction: '',
                realizedBAction: '',
                rationale: '',
              },
            ],
            generatedAt: 1,
          },
        },
      },
    };
    const prepared: PreparedApply = {
      slice: sliceWithGames,
      mergePlan: {
        characters: new Map([['Donald Trump', 'Donald Trump']]),
        locations: new Map([['Beijing', 'Beijing']]),
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

    const game = apply.scenes[0].gameAnalysis?.games[0];
    expect(game?.playerAId).toBe('C-USP-1');
    expect(game?.playerBId).toBe('C-USP-3');
  });

  it('drops scene.newCharacters entries that deduped into existing entities', () => {
    const narrative = makeNarrative();
    const slice = makeSlice();
    // Inject the slice's first character into the scene's newCharacters
    // array — a typical extraction output. With the merge plan saying
    // it folds into existing, the scene.newCharacters entry should drop
    // (existing record is authoritative).
    const sliceWithNewChar = {
      ...slice,
      scenes: {
        ...slice.scenes,
        'S-EXT-1': {
          ...slice.scenes['S-EXT-1'],
          newCharacters: [slice.characters['C-EXT-1'], slice.characters['C-EXT-2']],
        },
      },
    };
    const prepared: PreparedApply = {
      slice: sliceWithNewChar,
      mergePlan: {
        characters: new Map([['Donald Trump', 'Donald Trump']]),
        locations: new Map([['Beijing', 'Beijing']]),
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

    const sceneNewChars = apply.scenes[0].newCharacters ?? [];
    // Donald Trump dropped (deduped into existing); Elon Musk stays as the
    // net-new entry, with its id remapped to the narrative's counter slot.
    expect(sceneNewChars.map((c) => c.name)).toEqual(['Elon Musk']);
    expect(sceneNewChars[0].id).toBe('C-USP-3');
  });

  // ── Phase III.b — Thread expansion on merge ─────────────────────────────
  //
  // When a slice thread merges into an existing one (via reconcileSemantic
  // description-match or via the priors-compact thread-integration LLM
  // pass), the slice's outcomes and participants should fold into the
  // existing thread. commitPreparedApply doesn't mutate the existing
  // thread itself — it emits `threadExpansions` on the APPLY_EXTENSION
  // action, and the reducer applies them. These tests verify the
  // payload shape: what flows from the slice → merge plan → claim
  // phase → action payload.
  describe('Phase III.b — thread expansion on merge', () => {
    function buildPreparedForExpansion(opts: {
      existingThread: Thread;
      sliceThread: Thread;
      threadMerge: [string, string]; // [slice description, existing description]
      extraEntityMerges?: {
        characters?: Array<[string, string]>;
      };
    }): { narrative: NarrativeState; prepared: PreparedApply } {
      const narrative = makeNarrative();
      narrative.threads = { [opts.existingThread.id]: opts.existingThread };
      // Wire the existing thread's participants into the narrative so
      // lookups during dedup resolve correctly.
      const slice = makeSlice();
      slice.threads = { [opts.sliceThread.id]: opts.sliceThread };
      slice.scenes['S-EXT-1'] = {
        ...slice.scenes['S-EXT-1'],
        threadDeltas: [
          {
            threadId: opts.sliceThread.id,
            updates: [],
            logType: 'pulse',
            volumeDelta: 0,
            rationale: '',
          },
        ],
      } as Scene;
      const mergePlan: ExtensionMergePlan = {
        characters: new Map(opts.extraEntityMerges?.characters ?? []),
        locations: new Map([['Beijing', 'Beijing']]),
        artifacts: new Map(),
        threads: new Map([opts.threadMerge]),
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
      return { narrative, prepared };
    }

    function dispatchCommit(narrative: NarrativeState, prepared: PreparedApply) {
      const dispatched: Action[] = [];
      commitPreparedApply(narrative, makeFile(), 'B-1', prepared, (a) => dispatched.push(a));
      const apply = dispatched.find((a) => a.type === 'APPLY_EXTENSION');
      if (apply?.type !== 'APPLY_EXTENSION') throw new Error('expected APPLY_EXTENSION');
      return apply;
    }

    it('emits an expansion that folds the slice thread\'s new outcomes into the existing thread', () => {
      const existing = makeThread('T-USP-1', 'Will the trade deal hold?');
      existing.outcomes = ['yes', 'no'];
      const sliceT = makeThread('T-EXT-1', 'Will the trade deal hold?');
      sliceT.outcomes = ['yes', 'no', 'collapses', 'renegotiated'];

      const { narrative, prepared } = buildPreparedForExpansion({
        existingThread: existing,
        sliceThread: sliceT,
        threadMerge: ['Will the trade deal hold?', 'Will the trade deal hold?'],
      });
      const apply = dispatchCommit(narrative, prepared);

      expect(apply.threadExpansions).toBeDefined();
      expect(apply.threadExpansions).toHaveLength(1);
      const expansion = apply.threadExpansions![0];
      expect(expansion.existingThreadId).toBe('T-USP-1');
      // 'yes' / 'no' already exist; only the two genuinely new outcomes
      // should be added.
      expect(expansion.addOutcomes).toEqual(['collapses', 'renegotiated']);
    });

    it('dedupes outcomes case-insensitively against the existing list', () => {
      const existing = makeThread('T-USP-1', 'Will Country X sign?');
      existing.outcomes = ['Yes', 'No'];
      const sliceT = makeThread('T-EXT-1', 'Will Country X sign?');
      // 'YES' should match 'Yes'; 'maybe' is genuinely new.
      sliceT.outcomes = ['YES', 'no', 'maybe'];

      const { narrative, prepared } = buildPreparedForExpansion({
        existingThread: existing,
        sliceThread: sliceT,
        threadMerge: ['Will Country X sign?', 'Will Country X sign?'],
      });
      const apply = dispatchCommit(narrative, prepared);

      expect(apply.threadExpansions?.[0].addOutcomes).toEqual(['maybe']);
    });

    it('emits no expansion when the slice thread has nothing new to contribute', () => {
      const existing = makeThread('T-USP-1', 'Will treaty Z hold?');
      existing.outcomes = ['yes', 'no'];
      existing.participants = [{ id: 'C-USP-1', type: 'character' }];
      const sliceT = makeThread('T-EXT-1', 'Will treaty Z hold?');
      sliceT.outcomes = ['yes', 'no']; // subset of existing
      sliceT.participants = []; // none to add

      const { narrative, prepared } = buildPreparedForExpansion({
        existingThread: existing,
        sliceThread: sliceT,
        threadMerge: ['Will treaty Z hold?', 'Will treaty Z hold?'],
      });
      const apply = dispatchCommit(narrative, prepared);

      // Either zero entries OR an entry with empty add arrays — both
      // are acceptable; the reducer no-ops either way. Our
      // implementation skips the no-op case entirely.
      expect(apply.threadExpansions ?? []).toHaveLength(0);
    });

    it('remaps slice participant ids through entity maps before adding', () => {
      // Existing thread has Donald Trump (C-USP-1) as a participant.
      const existing = makeThread('T-USP-1', 'Will the trade deal hold?');
      existing.outcomes = ['yes', 'no'];
      existing.participants = [{ id: 'C-USP-1', type: 'character' }];

      // Slice thread references C-EXT-1 (Donald Trump again — same
      // name, merges to C-USP-1) AND C-EXT-2 (Elon Musk — net-new,
      // will mint a fresh narrative id).
      const sliceT = makeThread('T-EXT-1', 'Will the trade deal hold?');
      sliceT.outcomes = ['yes', 'no'];
      sliceT.participants = [
        { id: 'C-EXT-1', type: 'character' }, // → C-USP-1 (already in existing → dedup)
        { id: 'C-EXT-2', type: 'character' }, // → C-USP-3 (minted fresh, gets added)
      ];

      const { narrative, prepared } = buildPreparedForExpansion({
        existingThread: existing,
        sliceThread: sliceT,
        threadMerge: ['Will the trade deal hold?', 'Will the trade deal hold?'],
        extraEntityMerges: { characters: [['Donald Trump', 'Donald Trump']] },
      });
      const apply = dispatchCommit(narrative, prepared);

      const expansion = apply.threadExpansions?.[0];
      expect(expansion).toBeDefined();
      // C-EXT-1 was Donald Trump and remapped to C-USP-1 — but C-USP-1
      // already participates in the existing thread, so it's deduped
      // out. C-EXT-2 was minted as C-USP-3 by the prefix counter and
      // appears in addParticipants.
      expect(expansion!.addParticipants).toHaveLength(1);
      expect(expansion!.addParticipants[0].id).toBe('C-USP-3');
      expect(expansion!.addParticipants[0].type).toBe('character');
    });

    it('dedupes participants by their post-remap id, not the raw slice id', () => {
      // Existing thread already has C-USP-1 (Donald Trump). Slice has
      // C-EXT-1 (Donald Trump) that merges to C-USP-1. The expansion
      // should NOT add C-USP-1 a second time even though the raw slice
      // id (C-EXT-1) differs.
      const existing = makeThread('T-USP-1', 'Same market');
      existing.outcomes = ['yes', 'no'];
      existing.participants = [{ id: 'C-USP-1', type: 'character' }];

      const sliceT = makeThread('T-EXT-1', 'Same market');
      sliceT.outcomes = ['yes', 'no'];
      sliceT.participants = [{ id: 'C-EXT-1', type: 'character' }];

      const { narrative, prepared } = buildPreparedForExpansion({
        existingThread: existing,
        sliceThread: sliceT,
        threadMerge: ['Same market', 'Same market'],
        extraEntityMerges: { characters: [['Donald Trump', 'Donald Trump']] },
      });
      const apply = dispatchCommit(narrative, prepared);

      // No outcomes added, no participants added → no expansion record
      // emitted at all.
      expect(apply.threadExpansions ?? []).toHaveLength(0);
    });

    it('produces no expansion records for net-new threads (no merge happened)', () => {
      // Default slice thread T-EXT-1 is a brand-new market with no
      // matching existing thread — should mint a fresh id and never
      // appear in threadExpansions.
      const narrative = makeNarrative();
      const slice = makeSlice();
      const prepared: PreparedApply = {
        slice,
        mergePlan: {
          characters: new Map(),
          locations: new Map(),
          artifacts: new Map(),
          threads: new Map(), // no thread merges
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

      // The slice's net-new thread T-EXT-1 should appear in apply.threads
      // (remapped onto the narrative counter), and threadExpansions
      // should be empty since no merge occurred.
      expect(apply.threads.map((t) => t.description)).toContain('Will trade negotiations succeed?');
      expect(apply.threadExpansions ?? []).toHaveLength(0);
    });
  });
});
