import { describe, it, expect } from 'vitest';
import {
  buildTakenFromNarrative,
  remapScenarioCommit,
  type TakenIds,
} from '@/lib/experimentation-remap';
import type {
  Arc,
  Scene,
  Character,
  Location,
  Artifact,
  Thread,
  NarrativeState,
} from '@/types/narrative';
import { NARRATOR_AGENT_ID } from '@/types/narrative';
import { newNarratorBelief } from '@/lib/thread-log';
import { EMPTY_THREAD_LOG } from '@/lib/thread-log';

// Every parallel scenario worker mints IDs from the same root narrative, so
// without remapping every commit collides on `S-1`, `C-1`, `L-1` etc.
// These tests pin the contract: per-scenario remap mints fresh ids for
// newly-introduced entities, rewrites every cross-reference field, and lets
// references to existing narrative entities pass through.

// ── Fixture helpers ──────────────────────────────────────────────────────

function makeCharacter(id: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    name: id,
    role: 'recurring',
    world: { nodes: {}, edges: [] },
    threadIds: [],
    ...overrides,
  };
}

function makeLocation(id: string, overrides: Partial<Location> = {}): Location {
  return {
    id,
    name: id,
    prominence: 'place',
    parentId: null,
    tiedCharacterIds: [],
    threadIds: [],
    world: { nodes: {}, edges: [] },
    ...overrides,
  };
}

function makeArtifact(id: string, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id,
    name: id,
    significance: 'notable',
    world: { nodes: {}, edges: [] },
    threadIds: [],
    parentId: null,
    ...overrides,
  };
}

function makeThread(id: string, overrides: Partial<Thread> = {}): Thread {
  const outcomes = overrides.outcomes ?? ['yes', 'no'];
  return {
    id,
    description: `${id} question`,
    participants: [],
    outcomes,
    beliefs: {
      [NARRATOR_AGENT_ID]: newNarratorBelief(outcomes.length),
    },
    openedAt: 'S-1',
    dependents: [],
    threadLog: { ...EMPTY_THREAD_LOG },
    ...overrides,
  };
}

function makeScene(id: string, arcId: string, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id,
    arcId,
    summary: `${id} summary`,
    povId: null,
    locationId: 'L-1',
    participantIds: [],
    events: [],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    characterMovements: {},
    systemDeltas: { addedNodes: [], addedEdges: [] },
    ...overrides,
  };
}

function makeArc(id: string, overrides: Partial<Arc> = {}): Arc {
  return {
    id,
    name: id,
    sceneIds: [],
    develops: [],
    locationIds: [],
    activeCharacterIds: [],
    initialCharacterLocations: {},
    ...overrides,
  };
}

function makeNarrative(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    id: 'N-1',
    title: 'Test',
    description: '',
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    arcs: {},
    scenes: {},
    worldBuilds: {},
    branches: {},
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── buildTakenFromNarrative ──────────────────────────────────────────────

describe('buildTakenFromNarrative', () => {
  it('captures every entity id across all 8 classes', () => {
    const charA = makeCharacter('C-1', {
      world: {
        nodes: {
          'K-1': { id: 'K-1', type: 'trait', content: 'brave' },
        },
        edges: [],
      },
    });
    const locA = makeLocation('L-1', {
      world: {
        nodes: {
          'K-2': { id: 'K-2', type: 'trait', content: 'ancient' },
        },
        edges: [],
      },
    });
    const artA = makeArtifact('A-1', {
      world: {
        nodes: {
          'K-3': { id: 'K-3', type: 'trait', content: 'cursed' },
        },
        edges: [],
      },
    });
    const threadA = makeThread('T-1');
    const sceneA = makeScene('S-1', 'ARC-1');
    const arcA = makeArc('ARC-1');
    const narrative = makeNarrative({
      characters: { 'C-1': charA },
      locations: { 'L-1': locA },
      artifacts: { 'A-1': artA },
      threads: { 'T-1': threadA },
      scenes: { 'S-1': sceneA },
      arcs: { 'ARC-1': arcA },
      systemGraph: {
        nodes: {
          'SYS-1': { id: 'SYS-1', type: 'rule', concept: 'gravity' } as never,
        },
        edges: [],
      },
    });

    const taken = buildTakenFromNarrative(narrative);

    expect(taken.arc.has('ARC-1')).toBe(true);
    expect(taken.scene.has('S-1')).toBe(true);
    expect(taken.char.has('C-1')).toBe(true);
    expect(taken.loc.has('L-1')).toBe(true);
    expect(taken.art.has('A-1')).toBe(true);
    expect(taken.thread.has('T-1')).toBe(true);
    expect(taken.k.has('K-1')).toBe(true);
    expect(taken.k.has('K-2')).toBe(true);
    expect(taken.k.has('K-3')).toBe(true);
    expect(taken.sys.has('SYS-1')).toBe(true);
  });

  it('returns empty sets for an empty narrative', () => {
    const taken = buildTakenFromNarrative(makeNarrative());
    expect(taken.arc.size).toBe(0);
    expect(taken.scene.size).toBe(0);
    expect(taken.char.size).toBe(0);
    expect(taken.loc.size).toBe(0);
    expect(taken.art.size).toBe(0);
    expect(taken.thread.size).toBe(0);
    expect(taken.k.size).toBe(0);
    expect(taken.sys.size).toBe(0);
  });
});

// ── remapScenarioCommit — pass-through ───────────────────────────────────

describe('remapScenarioCommit — no collisions', () => {
  it('passes ids through unchanged when nothing in the payload clashes with taken', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(),
      loc: new Set(),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1', {
      sceneIds: ['S-1'],
      locationIds: ['L-1'],
      activeCharacterIds: ['C-1'],
      initialCharacterLocations: { 'C-1': 'L-1' },
      develops: ['C-1'],
    });
    const scene = makeScene('S-1', 'ARC-1', {
      povId: 'C-1',
      locationId: 'L-1',
      participantIds: ['C-1'],
      newCharacters: [makeCharacter('C-1')],
      newLocations: [makeLocation('L-1')],
    });

    const out = remapScenarioCommit(arc, [scene], taken);

    expect(out.arc.id).toBe('ARC-1');
    expect(out.scenes[0].id).toBe('S-1');
    expect(out.scenes[0].arcId).toBe('ARC-1');
    expect(out.scenes[0].povId).toBe('C-1');
    expect(out.arc.sceneIds).toEqual(['S-1']);
    expect(out.arc.initialCharacterLocations).toEqual({ 'C-1': 'L-1' });

    // Cumulative taken set has grown.
    expect(taken.arc.has('ARC-1')).toBe(true);
    expect(taken.scene.has('S-1')).toBe(true);
    expect(taken.char.has('C-1')).toBe(true);
    expect(taken.loc.has('L-1')).toBe(true);
  });
});

// ── remapScenarioCommit — collisions per class ───────────────────────────

describe('remapScenarioCommit — arc + scene collisions', () => {
  it('mints fresh arc and scene ids and keeps scene.arcId / arc.sceneIds consistent', () => {
    const taken: TakenIds = {
      arc: new Set(['ARC-1']),
      scene: new Set(['S-1', 'S-2']),
      char: new Set(),
      loc: new Set(),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1', { sceneIds: ['S-1', 'S-2'] });
    const scenes = [
      makeScene('S-1', 'ARC-1'),
      makeScene('S-2', 'ARC-1'),
    ];

    const out = remapScenarioCommit(arc, scenes, taken);

    expect(out.arc.id).not.toBe('ARC-1');
    expect(out.scenes[0].id).not.toBe('S-1');
    expect(out.scenes[1].id).not.toBe('S-2');
    // arc.sceneIds and scene.arcId are kept consistent post-remap.
    expect(out.arc.sceneIds).toEqual([out.scenes[0].id, out.scenes[1].id]);
    expect(out.scenes[0].arcId).toBe(out.arc.id);
    expect(out.scenes[1].arcId).toBe(out.arc.id);
    // Scene ids are still S-prefixed and unique.
    expect(out.scenes[0].id).toMatch(/^S-\d+$/);
    expect(out.scenes[1].id).toMatch(/^S-\d+$/);
    expect(out.scenes[0].id).not.toBe(out.scenes[1].id);
  });
});

describe('remapScenarioCommit — character collisions', () => {
  it('mints fresh character ids and updates every cross-reference field', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(['C-1']),
      loc: new Set(),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1', {
      activeCharacterIds: ['C-1', 'C-99'],
      initialCharacterLocations: { 'C-1': 'L-1', 'C-99': 'L-1' },
      develops: ['C-1'],
    });
    const scene = makeScene('S-1', 'ARC-1', {
      povId: 'C-1',
      participantIds: ['C-1', 'C-99'],
      characterMovements: {
        'C-1': { locationId: 'L-2', reason: 'flees' } as never,
      },
      relationshipDeltas: [
        { from: 'C-1', to: 'C-99', type: 'rival', valenceDelta: -1 },
      ],
      tieDeltas: [{ locationId: 'L-1', characterId: 'C-1', action: 'add' }],
      newCharacters: [makeCharacter('C-1')],
    });

    const out = remapScenarioCommit(arc, [scene], taken);
    const newCharId = out.scenes[0].newCharacters![0].id;

    expect(newCharId).not.toBe('C-1');
    expect(newCharId).toMatch(/^C-\d+$/);

    // Arc-level character refs
    expect(out.arc.activeCharacterIds).toContain(newCharId);
    expect(out.arc.activeCharacterIds).toContain('C-99'); // not in payload — pass-through
    expect(out.arc.initialCharacterLocations[newCharId]).toBe('L-1');
    expect(out.arc.develops).toContain(newCharId);

    // Scene-level character refs
    expect(out.scenes[0].povId).toBe(newCharId);
    expect(out.scenes[0].participantIds).toContain(newCharId);
    expect(out.scenes[0].participantIds).toContain('C-99'); // pass-through
    expect(out.scenes[0].characterMovements?.[newCharId]).toBeDefined();
    expect(out.scenes[0].characterMovements?.['C-1']).toBeUndefined();
    expect(out.scenes[0].relationshipDeltas[0].from).toBe(newCharId);
    expect(out.scenes[0].relationshipDeltas[0].to).toBe('C-99');
    expect(out.scenes[0].tieDeltas?.[0].characterId).toBe(newCharId);
  });
});

describe('remapScenarioCommit — location collisions', () => {
  it('mints fresh location ids and updates every cross-reference field', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(),
      loc: new Set(['L-1']),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1', {
      locationIds: ['L-1'],
      initialCharacterLocations: { 'C-1': 'L-1' },
      develops: ['L-1'],
    });
    const scene = makeScene('S-1', 'ARC-1', {
      locationId: 'L-1',
      characterMovements: {
        'C-1': { locationId: 'L-1', reason: 'arrives' } as never,
      },
      tieDeltas: [{ locationId: 'L-1', characterId: 'C-1', action: 'add' }],
      newLocations: [makeLocation('L-1', { tiedCharacterIds: ['C-1'] })],
    });

    const out = remapScenarioCommit(arc, [scene], taken);
    const newLocId = out.scenes[0].newLocations![0].id;

    expect(newLocId).not.toBe('L-1');
    expect(newLocId).toMatch(/^L-\d+$/);

    expect(out.arc.locationIds).toEqual([newLocId]);
    expect(out.arc.initialCharacterLocations['C-1']).toBe(newLocId);
    expect(out.arc.develops).toContain(newLocId);
    expect(out.scenes[0].locationId).toBe(newLocId);
    expect(out.scenes[0].characterMovements?.['C-1']?.locationId).toBe(newLocId);
    expect(out.scenes[0].tieDeltas?.[0].locationId).toBe(newLocId);
  });

  it('remaps location.parentId when the parent is itself a newly-introduced (colliding) location', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(),
      loc: new Set(['L-1', 'L-2']),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1');
    const scene = makeScene('S-1', 'ARC-1', {
      newLocations: [
        makeLocation('L-1'),
        makeLocation('L-2', { parentId: 'L-1' }),
      ],
    });

    const out = remapScenarioCommit(arc, [scene], taken);
    const parentId = out.scenes[0].newLocations![0].id;
    const childId = out.scenes[0].newLocations![1].id;
    expect(parentId).not.toBe('L-1');
    expect(childId).not.toBe('L-2');
    expect(out.scenes[0].newLocations![1].parentId).toBe(parentId);
  });
});

describe('remapScenarioCommit — artifact collisions', () => {
  it('mints fresh artifact ids and updates usages + ownership deltas', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(),
      loc: new Set(),
      art: new Set(['A-1']),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1', { develops: ['A-1'] });
    const scene = makeScene('S-1', 'ARC-1', {
      artifactUsages: [
        { artifactId: 'A-1', characterId: 'C-1', usage: 'wields' },
      ],
      ownershipDeltas: [{ artifactId: 'A-1', fromId: 'C-1', toId: 'L-1' }],
      newArtifacts: [makeArtifact('A-1')],
    });

    const out = remapScenarioCommit(arc, [scene], taken);
    const newArtId = out.scenes[0].newArtifacts![0].id;

    expect(newArtId).not.toBe('A-1');
    expect(newArtId).toMatch(/^A-\d+$/);
    expect(out.arc.develops).toContain(newArtId);
    expect(out.scenes[0].artifactUsages?.[0].artifactId).toBe(newArtId);
    expect(out.scenes[0].artifactUsages?.[0].characterId).toBe('C-1'); // pass-through
    expect(out.scenes[0].ownershipDeltas?.[0].artifactId).toBe(newArtId);
    expect(out.scenes[0].ownershipDeltas?.[0].fromId).toBe('C-1');
    expect(out.scenes[0].ownershipDeltas?.[0].toId).toBe('L-1');
  });

  it('remaps ownership fromId/toId when they reference a colliding new character/location', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(['C-1']),
      loc: new Set(['L-1']),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const scene = makeScene('S-1', 'ARC-1', {
      ownershipDeltas: [{ artifactId: 'A-99', fromId: 'C-1', toId: 'L-1' }],
      newCharacters: [makeCharacter('C-1')],
      newLocations: [makeLocation('L-1')],
    });

    const out = remapScenarioCommit(makeArc('ARC-1'), [scene], taken);
    const newCharId = out.scenes[0].newCharacters![0].id;
    const newLocId = out.scenes[0].newLocations![0].id;

    expect(out.scenes[0].ownershipDeltas?.[0].fromId).toBe(newCharId);
    expect(out.scenes[0].ownershipDeltas?.[0].toId).toBe(newLocId);
    expect(out.scenes[0].ownershipDeltas?.[0].artifactId).toBe('A-99'); // pass-through
  });
});

describe('remapScenarioCommit — thread collisions', () => {
  it('mints fresh thread ids and updates threadDeltas + participants', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(),
      loc: new Set(),
      art: new Set(),
      thread: new Set(['T-1']),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1', { develops: ['T-1'] });
    const scene = makeScene('S-1', 'ARC-1', {
      threadDeltas: [
        {
          threadId: 'T-1',
          logType: 'setup',
          updates: [{ outcome: 'yes', evidence: 2 }],
          volumeDelta: 1,
          rationale: 'opens',
        },
      ],
      newThreads: [
        makeThread('T-1', {
          participants: [{ id: 'C-1', kind: 'character' } as never],
        }),
      ],
    });

    const out = remapScenarioCommit(arc, [scene], taken);
    const newThreadId = out.scenes[0].newThreads![0].id;

    expect(newThreadId).not.toBe('T-1');
    expect(newThreadId).toMatch(/^T-\d+$/);
    expect(out.arc.develops).toContain(newThreadId);
    expect(out.scenes[0].threadDeltas[0].threadId).toBe(newThreadId);
    // Participant id is C-1 — not in maps, passes through.
    expect(out.scenes[0].newThreads![0].participants[0].id).toBe('C-1');
  });

  it('remaps thread participants when they reference a colliding new character', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(['C-1']),
      loc: new Set(),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const scene = makeScene('S-1', 'ARC-1', {
      newCharacters: [makeCharacter('C-1')],
      newThreads: [
        makeThread('T-99', {
          participants: [{ id: 'C-1', kind: 'character' } as never],
        }),
      ],
    });

    const out = remapScenarioCommit(makeArc('ARC-1'), [scene], taken);
    const newCharId = out.scenes[0].newCharacters![0].id;
    expect(out.scenes[0].newThreads![0].participants[0].id).toBe(newCharId);
  });
});

describe('remapScenarioCommit — world node (K) collisions', () => {
  it('remaps world delta added nodes and rewrites entityId when the entity is also new', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(['C-1']),
      loc: new Set(),
      art: new Set(),
      thread: new Set(),
      k: new Set(['K-1']),
      sys: new Set(),
    };
    const scene = makeScene('S-1', 'ARC-1', {
      worldDeltas: [
        {
          entityId: 'C-1',
          addedNodes: [{ id: 'K-1', content: 'new trait', type: 'trait' }],
        },
      ],
      newCharacters: [makeCharacter('C-1')],
    });

    const out = remapScenarioCommit(makeArc('ARC-1'), [scene], taken);
    const newCharId = out.scenes[0].newCharacters![0].id;
    const remappedDelta = out.scenes[0].worldDeltas[0];

    expect(remappedDelta.entityId).toBe(newCharId);
    expect(remappedDelta.addedNodes[0].id).not.toBe('K-1');
    expect(remappedDelta.addedNodes[0].id).toMatch(/^K-\d+$/);
  });

  it('remaps the internal node ids of new-entity world graphs and their edges', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(),
      loc: new Set(),
      art: new Set(),
      thread: new Set(),
      k: new Set(['K-1', 'K-2']),
      sys: new Set(),
    };
    const character = makeCharacter('C-77', {
      world: {
        nodes: {
          'K-1': { id: 'K-1', type: 'trait', content: 'brave' },
          'K-2': { id: 'K-2', type: 'trait', content: 'loyal' },
        },
        edges: [{ from: 'K-1', to: 'K-2', relation: 'reinforces' }],
      },
    });
    const scene = makeScene('S-1', 'ARC-1', { newCharacters: [character] });

    const out = remapScenarioCommit(makeArc('ARC-1'), [scene], taken);
    const rewrittenChar = out.scenes[0].newCharacters![0];
    const nodeIds = Object.keys(rewrittenChar.world.nodes);

    expect(nodeIds).toHaveLength(2);
    for (const nid of nodeIds) {
      expect(nid).toMatch(/^K-\d+$/);
      expect(nid).not.toBe('K-1');
      expect(nid).not.toBe('K-2');
      // node.id field is kept consistent with the record key.
      expect(rewrittenChar.world.nodes[nid].id).toBe(nid);
    }
    // The single edge has both endpoints rewritten.
    const edge = rewrittenChar.world.edges[0];
    expect(nodeIds).toContain(edge.from);
    expect(nodeIds).toContain(edge.to);
  });
});

describe('remapScenarioCommit — system node (SYS) collisions', () => {
  it('remaps system delta nodes/edges and systemAttributions', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(),
      loc: new Set(),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(['SYS-1']),
    };
    const scene = makeScene('S-1', 'ARC-1', {
      systemDeltas: {
        addedNodes: [
          { id: 'SYS-1', concept: 'mana scarcity', type: 'rule' as never },
        ],
        addedEdges: [{ from: 'SYS-1', to: 'SYS-999', relation: 'constrains' }],
      },
      systemAttributions: ['SYS-1', 'SYS-999'],
    });

    const out = remapScenarioCommit(makeArc('ARC-1'), [scene], taken);
    const newSysId = out.scenes[0].systemDeltas!.addedNodes[0].id;

    expect(newSysId).not.toBe('SYS-1');
    expect(newSysId).toMatch(/^SYS-\d+$/);
    expect(out.scenes[0].systemDeltas!.addedEdges[0].from).toBe(newSysId);
    // SYS-999 isn't in the payload — passes through.
    expect(out.scenes[0].systemDeltas!.addedEdges[0].to).toBe('SYS-999');
    expect(out.scenes[0].systemAttributions).toContain(newSysId);
    expect(out.scenes[0].systemAttributions).toContain('SYS-999');
  });
});

// ── Cumulative taken-set across consecutive scenarios ────────────────────

describe('remapScenarioCommit — cumulative taken set', () => {
  it('two scenarios with identical payload ids produce three globally-unique id sets', () => {
    const taken: TakenIds = {
      arc: new Set(['ARC-1']),
      scene: new Set(['S-1']),
      char: new Set(['C-1']),
      loc: new Set(['L-1']),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };

    // Two scenarios, both mint the same proposed IDs from the same root.
    const makePayload = () => ({
      arc: makeArc('ARC-1', {
        sceneIds: ['S-1'],
        activeCharacterIds: ['C-1'],
        locationIds: ['L-1'],
      }),
      scenes: [
        makeScene('S-1', 'ARC-1', {
          povId: 'C-1',
          locationId: 'L-1',
          newCharacters: [makeCharacter('C-1')],
          newLocations: [makeLocation('L-1')],
        }),
      ],
    });

    const r1 = remapScenarioCommit(makePayload().arc, makePayload().scenes, taken);
    const r2 = remapScenarioCommit(makePayload().arc, makePayload().scenes, taken);

    // Each scenario gets a distinct arc, scene, char, loc id.
    expect(r1.arc.id).not.toBe(r2.arc.id);
    expect(r1.scenes[0].id).not.toBe(r2.scenes[0].id);
    expect(r1.scenes[0].newCharacters![0].id).not.toBe(
      r2.scenes[0].newCharacters![0].id,
    );
    expect(r1.scenes[0].newLocations![0].id).not.toBe(
      r2.scenes[0].newLocations![0].id,
    );

    // Cross-references remain consistent within each scenario.
    expect(r1.arc.sceneIds[0]).toBe(r1.scenes[0].id);
    expect(r2.arc.sceneIds[0]).toBe(r2.scenes[0].id);
    expect(r1.scenes[0].povId).toBe(r1.scenes[0].newCharacters![0].id);
    expect(r2.scenes[0].povId).toBe(r2.scenes[0].newCharacters![0].id);
    expect(r1.scenes[0].locationId).toBe(r1.scenes[0].newLocations![0].id);
    expect(r2.scenes[0].locationId).toBe(r2.scenes[0].newLocations![0].id);
  });
});

// ── Existing-entity references pass through ──────────────────────────────

describe('remapScenarioCommit — existing entity passthrough', () => {
  it('does not remap ids that reference live-narrative entities (absent from payload)', () => {
    // C-EXIST and L-EXIST are in the live narrative; this scenario uses them
    // by reference but doesn't introduce them. They should pass through.
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(['C-EXIST']),
      loc: new Set(['L-EXIST']),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1', {
      activeCharacterIds: ['C-EXIST'],
      locationIds: ['L-EXIST'],
      initialCharacterLocations: { 'C-EXIST': 'L-EXIST' },
    });
    const scene = makeScene('S-1', 'ARC-1', {
      povId: 'C-EXIST',
      locationId: 'L-EXIST',
      participantIds: ['C-EXIST'],
    });

    const out = remapScenarioCommit(arc, [scene], taken);

    expect(out.arc.activeCharacterIds).toEqual(['C-EXIST']);
    expect(out.arc.locationIds).toEqual(['L-EXIST']);
    expect(out.arc.initialCharacterLocations).toEqual({ 'C-EXIST': 'L-EXIST' });
    expect(out.scenes[0].povId).toBe('C-EXIST');
    expect(out.scenes[0].locationId).toBe('L-EXIST');
    expect(out.scenes[0].participantIds).toEqual(['C-EXIST']);
  });
});
