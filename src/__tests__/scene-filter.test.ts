import { describe, it, expect } from 'vitest';
import {
  getIntroducedIds,
  getWorldNodesAtScene,
  getRelationshipsAtScene,
  getThreadIdsAtScene,
} from '@/lib/scene-filter';
import type { WorldBuild, Scene, WorldNode, WorldNodeType, NarrativeState, Thread } from '@/types/narrative';
// ── Test Fixtures ────────────────────────────────────────────────────────────
function createWorldBuild(
  id: string,
  characters: { id: string }[] = [],
  locations: { id: string }[] = [],
  threads: { id: string }[] = [],
  artifacts: { id: string }[] = [],
): WorldBuild {
  return {
    kind: 'world_build',
    id,
    summary: `World build ${id}`,
    expansionManifest: {
      newCharacters: characters.map((c) => ({ id: c.id, name: `Char ${c.id}`, role: 'anchor' as const, world: { nodes: {}, edges: [] }, threadIds: [] })),
      newLocations: locations.map((l) => ({ id: l.id, name: `Loc ${l.id}`, prominence: 'place' as const, parentId: null, tiedCharacterIds: [] as string[], world: { nodes: {}, edges: [] }, threadIds: [] })),
      newThreads: threads.map((t) => ({ id: t.id, description: `Thread ${t.id}`, outcomes: ['yes', 'no'], beliefs: {}, participants: [], dependents: [], openedAt: 'S-1', threadLog: { nodes: {}, edges: [] } })),
      newArtifacts: artifacts.map((a) => ({ id: a.id, name: `Artifact ${a.id}`, significance: 'key' as const, parentId: 'C-1', world: { nodes: {}, edges: [] }, threadIds: [] })),
      systemDeltas: { addedNodes: [], addedEdges: [] },
    },
  };
}
function createScene(
  id: string,
  worldDeltas: { entityId: string; addedNodes: { id: string; content: string; type: WorldNodeType }[] }[] = [],
  relationshipDeltas: { from: string; to: string; type: string; valenceDelta: number }[] = [],
): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'ARC-1',
    povId: 'C-1',
    locationId: 'L-1',
    participantIds: ['C-1'],
    events: [],
    threadDeltas: [],
    worldDeltas: worldDeltas.map((km) => ({
      ...km,
      addedEdges: [],
    })),
    relationshipDeltas: relationshipDeltas.map((rm) => ({
      ...rm,
    })),
    summary: `Scene ${id}`,
  };
}
function createMinimalNarrative(): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test',
    description: 'Test narrative',
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    scenes: {},
    arcs: {},
    worldBuilds: {},
    branches: {
      main: {
        id: 'main',
        name: 'Main',
        parentBranchId: null,
        forkEntryId: null,
        entryIds: [],
        createdAt: Date.now(),
      },
    },
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
// ── getIntroducedIds ─────────────────────────────────────────────────────────
describe('getIntroducedIds', () => {
  it('returns empty sets for no world builds or scenes', () => {
    const result = getIntroducedIds({}, {}, ['S-1', 'S-2'], 1);
    expect(result.characterIds.size).toBe(0);
    expect(result.locationIds.size).toBe(0);
    expect(result.threadIds.size).toBe(0);
    expect(result.artifactIds.size).toBe(0);
  });
  it('collects IDs from world builds up to current index', () => {
    const worldBuilds: Record<string, WorldBuild> = {
      'WB-1': createWorldBuild('WB-1', [{ id: 'C-1' }], [{ id: 'L-1' }], [{ id: 'T-1' }]),
      'WB-2': createWorldBuild('WB-2', [{ id: 'C-2' }], [{ id: 'L-2' }], [{ id: 'T-2' }]),
    };
    const resolvedKeys = ['WB-1', 'S-1', 'WB-2', 'S-2'];
    // At index 1 (after WB-1 and S-1)
    const result1 = getIntroducedIds(worldBuilds, {}, resolvedKeys, 1);
    expect(result1.characterIds.has('C-1')).toBe(true);
    expect(result1.characterIds.has('C-2')).toBe(false);
    // At index 3 (after WB-2)
    const result2 = getIntroducedIds(worldBuilds, {}, resolvedKeys, 3);
    expect(result2.characterIds.has('C-1')).toBe(true);
    expect(result2.characterIds.has('C-2')).toBe(true);
  });
  it('collects artifact IDs', () => {
    const worldBuilds: Record<string, WorldBuild> = {
      'WB-1': createWorldBuild('WB-1', [], [], [], [{ id: 'A-1' }, { id: 'A-2' }]),
    };
    const result = getIntroducedIds(worldBuilds, {}, ['WB-1'], 0);
    expect(result.artifactIds.has('A-1')).toBe(true);
    expect(result.artifactIds.has('A-2')).toBe(true);
  });
  it('handles empty resolved keys', () => {
    const worldBuilds: Record<string, WorldBuild> = {
      'WB-1': createWorldBuild('WB-1', [{ id: 'C-1' }]),
    };
    const result = getIntroducedIds(worldBuilds, {}, [], 0);
    expect(result.characterIds.size).toBe(0);
  });
  it('collects IDs from scene-introduced entities', () => {
    const scenes: Record<string, Scene> = {
      'S-1': {
        kind: 'scene',
        id: 'S-1',
        arcId: 'ARC-1',
        summary: 'Test scene',
        povId: 'C-1',
        locationId: 'L-1',
        participantIds: [],
        events: [],
        threadDeltas: [],
        worldDeltas: [],
        relationshipDeltas: [],
        newCharacters: [{ id: 'C-NEW', name: 'New Character', role: 'transient', threadIds: [], world: { nodes: {}, edges: [] } }],
        newLocations: [{ id: 'L-NEW', name: 'New Location', prominence: 'margin', threadIds: [], tiedCharacterIds: [], parentId: null, world: { nodes: {}, edges: [] } }],
      },
    };
    const result = getIntroducedIds({}, scenes, ['S-1'], 0);
    expect(result.characterIds.has('C-NEW')).toBe(true);
    expect(result.locationIds.has('L-NEW')).toBe(true);
  });
});
// ── getWorldNodesAtScene ────────────────────────────────────────────────
describe('getWorldNodesAtScene', () => {
  const nodes: Record<string, WorldNode> = {
    'K-1': { id: 'K-1', type: 'history', content: 'Initial knowledge' },
    'K-3': { id: 'K-3', type: 'history', content: 'Never mutated' },
  };
  it('returns all nodes when no deltas exist', () => {
    const scenes: Record<string, Scene> = {};
    const result = getWorldNodesAtScene(nodes, 'C-1', scenes, [], 0);
    expect(result.length).toBe(2);
  });
  it('includes nodes added up to current index', () => {
    const scenes: Record<string, Scene> = {
      'S-1': createScene('S-1', [{ entityId: 'C-1', addedNodes: [{ id: 'K-2', content: 'Added', type: 'history' }] }]),
      'S-2': createScene('S-2'),
    };
    const resolvedKeys = ['S-1', 'S-2'];
    const result = getWorldNodesAtScene(nodes, 'C-1', scenes, resolvedKeys, 1);
    expect(result.map((n) => n.id)).toContain('K-2');
  });
  it('does not include nodes added after current index', () => {
    const scenes: Record<string, Scene> = {
      'S-1': createScene('S-1'),
      'S-2': createScene('S-2', [{ entityId: 'C-1', addedNodes: [{ id: 'K-4', content: 'Future', type: 'history' }] }]),
    };
    const resolvedKeys = ['S-1', 'S-2'];
    // At index 0, K-4 hasn't been added yet
    const result = getWorldNodesAtScene(nodes, 'C-1', scenes, resolvedKeys, 0);
    expect(result.map((n) => n.id)).not.toContain('K-4');
    // At index 1, K-4 is added
    const result2 = getWorldNodesAtScene(nodes, 'C-1', scenes, resolvedKeys, 1);
    expect(result2.map((n) => n.id)).toContain('K-4');
  });
  it('accumulates nodes across scenes', () => {
    const scenes: Record<string, Scene> = {
      'S-1': createScene('S-1', [{ entityId: 'C-1', addedNodes: [{ id: 'K-5', content: 'First', type: 'history' }] }]),
      'S-2': createScene('S-2', [{ entityId: 'C-1', addedNodes: [{ id: 'K-6', content: 'Second', type: 'history' }] }]),
    };
    const resolvedKeys = ['S-1', 'S-2'];
    const result = getWorldNodesAtScene(nodes, 'C-1', scenes, resolvedKeys, 1);
    expect(result.map((n) => n.id)).toContain('K-5');
    expect(result.map((n) => n.id)).toContain('K-6');
  });
  it('filters by entity ID', () => {
    const scenes: Record<string, Scene> = {
      'S-1': createScene('S-1', [
        { entityId: 'C-1', addedNodes: [{ id: 'K-7', content: 'C01 learns', type: 'history' }] },
        { entityId: 'C-2', addedNodes: [{ id: 'K-8', content: 'C02 learns', type: 'history' }] },
      ]),
    };
    const resolvedKeys = ['S-1'];
    // C-1 should see K-7 but not K-8 (different entity)
    const result = getWorldNodesAtScene(nodes, 'C-1', scenes, resolvedKeys, 0);
    expect(result.map((n) => n.id)).toContain('K-7');
    expect(result.map((n) => n.id)).not.toContain('K-8');
  });
  it('includes never-mutated nodes', () => {
    const scenes: Record<string, Scene> = {
      'S-1': createScene('S-1', [{ entityId: 'C-1', addedNodes: [{ id: 'K-9', content: 'New', type: 'history' }] }]),
    };
    const resolvedKeys = ['S-1'];
    const result = getWorldNodesAtScene(nodes, 'C-1', scenes, resolvedKeys, 0);
    expect(result.map((n) => n.id)).toContain('K-3'); // Never mutated
  });
});
// ── getRelationshipsAtScene ──────────────────────────────────────────────────
describe('getRelationshipsAtScene', () => {
  it('returns empty array when no relationships exist', () => {
    const narrative = createMinimalNarrative();
    const result = getRelationshipsAtScene(narrative, [], 0);
    expect(result).toEqual([]);
  });
  it('excludes relationships with unintroduced characters', () => {
    const narrative = createMinimalNarrative();
    narrative.worldBuilds['WB-1'] = createWorldBuild('WB-1', [{ id: 'C-1' }]);
    narrative.relationships = [
      { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
    ];
    const result = getRelationshipsAtScene(narrative, ['WB-1'], 0);
    // C-2 not introduced, so relationship excluded
    expect(result.length).toBe(0);
  });
  it('includes relationships where both characters are introduced', () => {
    const narrative = createMinimalNarrative();
    narrative.worldBuilds['WB-1'] = createWorldBuild('WB-1', [{ id: 'C-1' }, { id: 'C-2' }]);
    narrative.relationships = [
      { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
    ];
    const result = getRelationshipsAtScene(narrative, ['WB-1'], 0);
    expect(result.length).toBe(1);
    expect(result[0].from).toBe('C-1');
  });
  it('subtracts future deltas from valence', () => {
    const narrative = createMinimalNarrative();
    narrative.worldBuilds['WB-1'] = createWorldBuild('WB-1', [{ id: 'C-1' }, { id: 'C-2' }]);
    // First scene establishes the relationship (so it's not "future created")
    narrative.scenes['S-1'] = createScene('S-1', [], [
      { from: 'C-1', to: 'C-2', type: 'ally', valenceDelta: 0.5 },
    ]);
    // Second scene modifies it
    narrative.scenes['S-2'] = createScene('S-2', [], [
      { from: 'C-1', to: 'C-2', type: 'rival', valenceDelta: -0.3 },
    ]);
    narrative.relationships = [
      { from: 'C-1', to: 'C-2', type: 'rival', valence: 0.2 }, // Final valence after S-2
    ];
    const resolvedKeys = ['WB-1', 'S-1', 'S-2'];
    // At index 1 (S-1), before S-2's delta
    const result = getRelationshipsAtScene(narrative, resolvedKeys, 1);
    expect(result.length).toBe(1);
    // Final valence is 0.2, future delta is -0.3, so valence at S-1 is 0.2 - (-0.3) = 0.5
    expect(result[0].valence).toBeCloseTo(0.5, 5);
  });
  it('excludes relationships created by future scenes', () => {
    const narrative = createMinimalNarrative();
    narrative.worldBuilds['WB-1'] = createWorldBuild('WB-1', [{ id: 'C-1' }, { id: 'C-2' }]);
    narrative.scenes['S-1'] = createScene('S-1');
    narrative.scenes['S-2'] = createScene('S-2', [], [
      { from: 'C-1', to: 'C-2', type: 'ally', valenceDelta: 0.5 },
    ]);
    narrative.relationships = [
      { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
    ];
    const resolvedKeys = ['WB-1', 'S-1', 'S-2'];
    // At index 1, relationship doesn't exist yet (created by S-2)
    const result = getRelationshipsAtScene(narrative, resolvedKeys, 1);
    expect(result.length).toBe(0);
  });
});
// ── getThreadIdsAtScene ──────────────────────────────────────────────────────
describe('getThreadIdsAtScene', () => {
  it('returns empty array for no threads', () => {
    const result = getThreadIdsAtScene([], {}, [], 0);
    expect(result).toEqual([]);
  });
  it('includes threads opened at or before current index', () => {
    const threads: Record<string, Thread> = {
      'T-1': {
        id: 'T-1',
        description: 'Desc 1',
        outcomes: ["yes", "no"],
        beliefs: { narrator: { logits: [0, 0], volume: 2, volatility: 0 } },
        openedAt: 'WB-1',
        dependents: [],
        participants: [],
        threadLog: { nodes: {}, edges: [] },
      },
      'T-2': {
        id: 'T-2',
        description: 'Desc 2',
        outcomes: ["yes", "no"],
        beliefs: { narrator: { logits: [0, 0], volume: 2, volatility: 0 } },
        openedAt: 'S-2',
        dependents: [],
        participants: [],
        threadLog: { nodes: {}, edges: [] },
      },
    };
    const resolvedKeys = ['WB-1', 'S-1', 'S-2'];
    // At index 0, only T-1 is introduced
    const result1 = getThreadIdsAtScene(['T-1', 'T-2'], threads, resolvedKeys, 0);
    expect(result1).toEqual(['T-1']);
    // At index 2, both threads are introduced
    const result2 = getThreadIdsAtScene(['T-1', 'T-2'], threads, resolvedKeys, 2);
    expect(result2).toEqual(['T-1', 'T-2']);
  });
  it('excludes threads with unknown openedAt', () => {
    const threads: Record<string, Thread> = {
      'T-1': {
        id: 'T-1',
        description: 'Desc 1',
        outcomes: ["yes", "no"],
        beliefs: { narrator: { logits: [0, 0], volume: 2, volatility: 0 } },
        openedAt: 'UNKNOWN-KEY',
        dependents: [],
        participants: [],
        threadLog: { nodes: {}, edges: [] },
      },
    };
    const resolvedKeys = ['WB-1', 'S-1'];
    const result = getThreadIdsAtScene(['T-1'], threads, resolvedKeys, 1);
    expect(result).toEqual([]);
  });
  it('handles missing thread gracefully', () => {
    const threads: Record<string, Thread> = {};
    const result = getThreadIdsAtScene(['T-1'], threads, ['S-1'], 0);
    expect(result).toEqual([]);
  });
});
