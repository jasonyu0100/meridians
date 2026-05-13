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
// without remapping every commit collides on `S-001`, `C-01`, `L-01` etc.
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
    openedAt: 'S-001',
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
    locationId: 'L-01',
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
    id: 'N-01',
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
    const charA = makeCharacter('C-01', {
      world: {
        nodes: {
          'K-01': { id: 'K-01', type: 'trait', content: 'brave' },
        },
        edges: [],
      },
    });
    const locA = makeLocation('L-01', {
      world: {
        nodes: {
          'K-02': { id: 'K-02', type: 'trait', content: 'ancient' },
        },
        edges: [],
      },
    });
    const artA = makeArtifact('A-01', {
      world: {
        nodes: {
          'K-03': { id: 'K-03', type: 'trait', content: 'cursed' },
        },
        edges: [],
      },
    });
    const threadA = makeThread('T-01');
    const sceneA = makeScene('S-001', 'ARC-1');
    const arcA = makeArc('ARC-1');
    const narrative = makeNarrative({
      characters: { 'C-01': charA },
      locations: { 'L-01': locA },
      artifacts: { 'A-01': artA },
      threads: { 'T-01': threadA },
      scenes: { 'S-001': sceneA },
      arcs: { 'ARC-1': arcA },
      systemGraph: {
        nodes: {
          'SYS-001': { id: 'SYS-001', type: 'rule', concept: 'gravity' } as never,
        },
        edges: [],
      },
    });

    const taken = buildTakenFromNarrative(narrative);

    expect(taken.arc.has('ARC-1')).toBe(true);
    expect(taken.scene.has('S-001')).toBe(true);
    expect(taken.char.has('C-01')).toBe(true);
    expect(taken.loc.has('L-01')).toBe(true);
    expect(taken.art.has('A-01')).toBe(true);
    expect(taken.thread.has('T-01')).toBe(true);
    expect(taken.k.has('K-01')).toBe(true);
    expect(taken.k.has('K-02')).toBe(true);
    expect(taken.k.has('K-03')).toBe(true);
    expect(taken.sys.has('SYS-001')).toBe(true);
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
      sceneIds: ['S-001'],
      locationIds: ['L-01'],
      activeCharacterIds: ['C-01'],
      initialCharacterLocations: { 'C-01': 'L-01' },
      develops: ['C-01'],
    });
    const scene = makeScene('S-001', 'ARC-1', {
      povId: 'C-01',
      locationId: 'L-01',
      participantIds: ['C-01'],
      newCharacters: [makeCharacter('C-01')],
      newLocations: [makeLocation('L-01')],
    });

    const out = remapScenarioCommit(arc, [scene], taken);

    expect(out.arc.id).toBe('ARC-1');
    expect(out.scenes[0].id).toBe('S-001');
    expect(out.scenes[0].arcId).toBe('ARC-1');
    expect(out.scenes[0].povId).toBe('C-01');
    expect(out.arc.sceneIds).toEqual(['S-001']);
    expect(out.arc.initialCharacterLocations).toEqual({ 'C-01': 'L-01' });

    // Cumulative taken set has grown.
    expect(taken.arc.has('ARC-1')).toBe(true);
    expect(taken.scene.has('S-001')).toBe(true);
    expect(taken.char.has('C-01')).toBe(true);
    expect(taken.loc.has('L-01')).toBe(true);
  });
});

// ── remapScenarioCommit — collisions per class ───────────────────────────

describe('remapScenarioCommit — arc + scene collisions', () => {
  it('mints fresh arc and scene ids and keeps scene.arcId / arc.sceneIds consistent', () => {
    const taken: TakenIds = {
      arc: new Set(['ARC-1']),
      scene: new Set(['S-001', 'S-002']),
      char: new Set(),
      loc: new Set(),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1', { sceneIds: ['S-001', 'S-002'] });
    const scenes = [
      makeScene('S-001', 'ARC-1'),
      makeScene('S-002', 'ARC-1'),
    ];

    const out = remapScenarioCommit(arc, scenes, taken);

    expect(out.arc.id).not.toBe('ARC-1');
    expect(out.scenes[0].id).not.toBe('S-001');
    expect(out.scenes[1].id).not.toBe('S-002');
    // arc.sceneIds and scene.arcId are kept consistent post-remap.
    expect(out.arc.sceneIds).toEqual([out.scenes[0].id, out.scenes[1].id]);
    expect(out.scenes[0].arcId).toBe(out.arc.id);
    expect(out.scenes[1].arcId).toBe(out.arc.id);
    // Scene ids are still S-prefixed and unique.
    expect(out.scenes[0].id).toMatch(/^S-\d{3}$/);
    expect(out.scenes[1].id).toMatch(/^S-\d{3}$/);
    expect(out.scenes[0].id).not.toBe(out.scenes[1].id);
  });
});

describe('remapScenarioCommit — character collisions', () => {
  it('mints fresh character ids and updates every cross-reference field', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(['C-01']),
      loc: new Set(),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1', {
      activeCharacterIds: ['C-01', 'C-99'],
      initialCharacterLocations: { 'C-01': 'L-01', 'C-99': 'L-01' },
      develops: ['C-01'],
    });
    const scene = makeScene('S-001', 'ARC-1', {
      povId: 'C-01',
      participantIds: ['C-01', 'C-99'],
      characterMovements: {
        'C-01': { locationId: 'L-02', reason: 'flees' } as never,
      },
      relationshipDeltas: [
        { from: 'C-01', to: 'C-99', type: 'rival', valenceDelta: -1 },
      ],
      tieDeltas: [{ locationId: 'L-01', characterId: 'C-01', action: 'add' }],
      newCharacters: [makeCharacter('C-01')],
    });

    const out = remapScenarioCommit(arc, [scene], taken);
    const newCharId = out.scenes[0].newCharacters![0].id;

    expect(newCharId).not.toBe('C-01');
    expect(newCharId).toMatch(/^C-\d{2}$/);

    // Arc-level character refs
    expect(out.arc.activeCharacterIds).toContain(newCharId);
    expect(out.arc.activeCharacterIds).toContain('C-99'); // not in payload — pass-through
    expect(out.arc.initialCharacterLocations[newCharId]).toBe('L-01');
    expect(out.arc.develops).toContain(newCharId);

    // Scene-level character refs
    expect(out.scenes[0].povId).toBe(newCharId);
    expect(out.scenes[0].participantIds).toContain(newCharId);
    expect(out.scenes[0].participantIds).toContain('C-99'); // pass-through
    expect(out.scenes[0].characterMovements?.[newCharId]).toBeDefined();
    expect(out.scenes[0].characterMovements?.['C-01']).toBeUndefined();
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
      loc: new Set(['L-01']),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1', {
      locationIds: ['L-01'],
      initialCharacterLocations: { 'C-01': 'L-01' },
      develops: ['L-01'],
    });
    const scene = makeScene('S-001', 'ARC-1', {
      locationId: 'L-01',
      characterMovements: {
        'C-01': { locationId: 'L-01', reason: 'arrives' } as never,
      },
      tieDeltas: [{ locationId: 'L-01', characterId: 'C-01', action: 'add' }],
      newLocations: [makeLocation('L-01', { tiedCharacterIds: ['C-01'] })],
    });

    const out = remapScenarioCommit(arc, [scene], taken);
    const newLocId = out.scenes[0].newLocations![0].id;

    expect(newLocId).not.toBe('L-01');
    expect(newLocId).toMatch(/^L-\d{2}$/);

    expect(out.arc.locationIds).toEqual([newLocId]);
    expect(out.arc.initialCharacterLocations['C-01']).toBe(newLocId);
    expect(out.arc.develops).toContain(newLocId);
    expect(out.scenes[0].locationId).toBe(newLocId);
    expect(out.scenes[0].characterMovements?.['C-01']?.locationId).toBe(newLocId);
    expect(out.scenes[0].tieDeltas?.[0].locationId).toBe(newLocId);
  });

  it('remaps location.parentId when the parent is itself a newly-introduced (colliding) location', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(),
      loc: new Set(['L-01', 'L-02']),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1');
    const scene = makeScene('S-001', 'ARC-1', {
      newLocations: [
        makeLocation('L-01'),
        makeLocation('L-02', { parentId: 'L-01' }),
      ],
    });

    const out = remapScenarioCommit(arc, [scene], taken);
    const parentId = out.scenes[0].newLocations![0].id;
    const childId = out.scenes[0].newLocations![1].id;
    expect(parentId).not.toBe('L-01');
    expect(childId).not.toBe('L-02');
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
      art: new Set(['A-01']),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1', { develops: ['A-01'] });
    const scene = makeScene('S-001', 'ARC-1', {
      artifactUsages: [
        { artifactId: 'A-01', characterId: 'C-01', usage: 'wields' },
      ],
      ownershipDeltas: [{ artifactId: 'A-01', fromId: 'C-01', toId: 'L-01' }],
      newArtifacts: [makeArtifact('A-01')],
    });

    const out = remapScenarioCommit(arc, [scene], taken);
    const newArtId = out.scenes[0].newArtifacts![0].id;

    expect(newArtId).not.toBe('A-01');
    expect(newArtId).toMatch(/^A-\d{2}$/);
    expect(out.arc.develops).toContain(newArtId);
    expect(out.scenes[0].artifactUsages?.[0].artifactId).toBe(newArtId);
    expect(out.scenes[0].artifactUsages?.[0].characterId).toBe('C-01'); // pass-through
    expect(out.scenes[0].ownershipDeltas?.[0].artifactId).toBe(newArtId);
    expect(out.scenes[0].ownershipDeltas?.[0].fromId).toBe('C-01');
    expect(out.scenes[0].ownershipDeltas?.[0].toId).toBe('L-01');
  });

  it('remaps ownership fromId/toId when they reference a colliding new character/location', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(['C-01']),
      loc: new Set(['L-01']),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const scene = makeScene('S-001', 'ARC-1', {
      ownershipDeltas: [{ artifactId: 'A-99', fromId: 'C-01', toId: 'L-01' }],
      newCharacters: [makeCharacter('C-01')],
      newLocations: [makeLocation('L-01')],
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
      thread: new Set(['T-01']),
      k: new Set(),
      sys: new Set(),
    };
    const arc = makeArc('ARC-1', { develops: ['T-01'] });
    const scene = makeScene('S-001', 'ARC-1', {
      threadDeltas: [
        {
          threadId: 'T-01',
          logType: 'setup',
          updates: [{ outcome: 'yes', evidence: 2 }],
          volumeDelta: 1,
          rationale: 'opens',
        },
      ],
      newThreads: [
        makeThread('T-01', {
          participants: [{ id: 'C-01', kind: 'character' } as never],
        }),
      ],
    });

    const out = remapScenarioCommit(arc, [scene], taken);
    const newThreadId = out.scenes[0].newThreads![0].id;

    expect(newThreadId).not.toBe('T-01');
    expect(newThreadId).toMatch(/^T-\d{2}$/);
    expect(out.arc.develops).toContain(newThreadId);
    expect(out.scenes[0].threadDeltas[0].threadId).toBe(newThreadId);
    // Participant id is C-01 — not in maps, passes through.
    expect(out.scenes[0].newThreads![0].participants[0].id).toBe('C-01');
  });

  it('remaps thread participants when they reference a colliding new character', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(['C-01']),
      loc: new Set(),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };
    const scene = makeScene('S-001', 'ARC-1', {
      newCharacters: [makeCharacter('C-01')],
      newThreads: [
        makeThread('T-99', {
          participants: [{ id: 'C-01', kind: 'character' } as never],
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
      char: new Set(['C-01']),
      loc: new Set(),
      art: new Set(),
      thread: new Set(),
      k: new Set(['K-01']),
      sys: new Set(),
    };
    const scene = makeScene('S-001', 'ARC-1', {
      worldDeltas: [
        {
          entityId: 'C-01',
          addedNodes: [{ id: 'K-01', content: 'new trait', type: 'trait' }],
        },
      ],
      newCharacters: [makeCharacter('C-01')],
    });

    const out = remapScenarioCommit(makeArc('ARC-1'), [scene], taken);
    const newCharId = out.scenes[0].newCharacters![0].id;
    const remappedDelta = out.scenes[0].worldDeltas[0];

    expect(remappedDelta.entityId).toBe(newCharId);
    expect(remappedDelta.addedNodes[0].id).not.toBe('K-01');
    expect(remappedDelta.addedNodes[0].id).toMatch(/^K-\d{2}$/);
  });

  it('remaps the internal node ids of new-entity world graphs and their edges', () => {
    const taken: TakenIds = {
      arc: new Set(),
      scene: new Set(),
      char: new Set(),
      loc: new Set(),
      art: new Set(),
      thread: new Set(),
      k: new Set(['K-01', 'K-02']),
      sys: new Set(),
    };
    const character = makeCharacter('C-77', {
      world: {
        nodes: {
          'K-01': { id: 'K-01', type: 'trait', content: 'brave' },
          'K-02': { id: 'K-02', type: 'trait', content: 'loyal' },
        },
        edges: [{ from: 'K-01', to: 'K-02', relation: 'reinforces' }],
      },
    });
    const scene = makeScene('S-001', 'ARC-1', { newCharacters: [character] });

    const out = remapScenarioCommit(makeArc('ARC-1'), [scene], taken);
    const rewrittenChar = out.scenes[0].newCharacters![0];
    const nodeIds = Object.keys(rewrittenChar.world.nodes);

    expect(nodeIds).toHaveLength(2);
    for (const nid of nodeIds) {
      expect(nid).toMatch(/^K-\d{2}$/);
      expect(nid).not.toBe('K-01');
      expect(nid).not.toBe('K-02');
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
      sys: new Set(['SYS-001']),
    };
    const scene = makeScene('S-001', 'ARC-1', {
      systemDeltas: {
        addedNodes: [
          { id: 'SYS-001', concept: 'mana scarcity', type: 'rule' as never },
        ],
        addedEdges: [{ from: 'SYS-001', to: 'SYS-999', relation: 'constrains' }],
      },
      systemAttributions: ['SYS-001', 'SYS-999'],
    });

    const out = remapScenarioCommit(makeArc('ARC-1'), [scene], taken);
    const newSysId = out.scenes[0].systemDeltas!.addedNodes[0].id;

    expect(newSysId).not.toBe('SYS-001');
    expect(newSysId).toMatch(/^SYS-\d{3}$/);
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
      scene: new Set(['S-001']),
      char: new Set(['C-01']),
      loc: new Set(['L-01']),
      art: new Set(),
      thread: new Set(),
      k: new Set(),
      sys: new Set(),
    };

    // Two scenarios, both mint the same proposed IDs from the same root.
    const makePayload = () => ({
      arc: makeArc('ARC-1', {
        sceneIds: ['S-001'],
        activeCharacterIds: ['C-01'],
        locationIds: ['L-01'],
      }),
      scenes: [
        makeScene('S-001', 'ARC-1', {
          povId: 'C-01',
          locationId: 'L-01',
          newCharacters: [makeCharacter('C-01')],
          newLocations: [makeLocation('L-01')],
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
    const scene = makeScene('S-001', 'ARC-1', {
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
