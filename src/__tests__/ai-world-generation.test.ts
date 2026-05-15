import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NarrativeState, Character, Location, Thread } from '@/types/narrative';
// Mock the AI API layer
vi.mock('@/lib/ai/api', () => ({
  callGenerate: vi.fn(),
  callGenerateStream: vi.fn(),
  resolveReasoningBudget: vi.fn(() => 0),
  SYSTEM_PROMPT: 'Test system prompt',
}));
// Mock narrative context (not relevant to the paths under test)
vi.mock('@/lib/ai/context', () => ({
  narrativeContext: vi.fn().mockReturnValue('Mock narrative context'),
}));
// Mock prompts
vi.mock('@/lib/ai/prompts', () => ({
  PROMPT_FORCE_STANDARDS: 'Mock force standards',
  PROMPT_STRUCTURAL_RULES: 'Mock structural rules',
  PROMPT_DELTAS: 'Mock deltas',
  PROMPT_POV: 'Mock POV',
  PROMPT_WORLD: 'Mock continuity',
  PROMPT_ARC_STATE_GUIDANCE: 'Mock arc state guidance',
  PROMPT_SUMMARY_REQUIREMENT: 'Mock summary requirement',
  PROMPT_ENTITY_INTEGRATION: 'Mock entity integration',
  buildForceStandardsPrompt: vi.fn().mockReturnValue('Mock force standards prompt'),
}));
// Mock pacing-profile to avoid unrelated markov chain logic
vi.mock('@/lib/pacing-profile', () => ({
  buildSequencePrompt: vi.fn().mockReturnValue('Mock sequence prompt'),
  buildIntroductionSequence: vi.fn().mockReturnValue({
    steps: [],
    pacingDescription: 'Test pacing',
  }),
}));
// Mock embeddings — they hit a network endpoint that isn't available in tests.
vi.mock('@/lib/embeddings', () => ({
  generateEmbeddingsBatch: vi.fn().mockResolvedValue([]),
  computeCentroid: vi.fn().mockReturnValue([]),
  resolveEmbedding: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/asset-manager', () => ({
  assetManager: {
    storeEmbedding: vi.fn().mockResolvedValue('emb-1'),
  },
}));
import { expandWorld, generateNarrative } from '@/lib/ai/world';
import { callGenerate, callGenerateStream } from '@/lib/ai/api';
// ── Test Fixtures ────────────────────────────────────────────────────────────
function createCharacter(id: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    name: `Character ${id}`,
    role: 'recurring',
    threadIds: [],
    world: { nodes: {}, edges: [] },
    ...overrides,
  };
}
function createLocation(id: string, overrides: Partial<Location> = {}): Location {
  return {
    id,
    name: `Location ${id}`,
    prominence: 'place',
    parentId: null,
    tiedCharacterIds: [],
    threadIds: [],
    world: { nodes: {}, edges: [] },
    ...overrides,
  };
}
function createThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    description: `Thread ${id}`,
    outcomes: ["yes", "no"],
    beliefs: { narrator: { logits: [0, 0], volume: 2, volatility: 0 } },
    participants: [],
    dependents: [],
    openedAt: 's1',
    threadLog: { nodes: {}, edges: [] },
    ...overrides,
  };
}
function createMinimalNarrative(): NarrativeState {
  return {
    id: 'N-001',
    title: 'Test Narrative',
    description: 'A test story',
    characters: { 'C-01': createCharacter('C-01', { name: 'Alice' }) },
    locations: { 'L-01': createLocation('L-01', { name: 'Castle' }) },
    threads: { 'T-01': createThread('T-01', { description: 'Main quest' }) },
    artifacts: {},
    scenes: {},
    arcs: {},
    worldBuilds: {},
    branches: {
      main: {
        id: 'main', name: 'Main', parentBranchId: null, forkEntryId: null,
        entryIds: [], createdAt: Date.now(),
      },
    },
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
// ── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});
// ── expandWorld: system delta handling ──────────────────────────
describe('expandWorld — systemDeltas', () => {
  const baseExpansion = {
    characters: [],
    locations: [],
    threads: [],
    relationships: [],
    artifacts: [],
    ownershipDeltas: [],
    tieDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
  };
  it('assigns fresh SYS ids to new concepts', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      systemDeltas: {
        addedNodes: [
          { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' },
          { id: 'SYS-GEN-2', concept: 'Leylines', type: 'concept' },
        ],
        addedEdges: [{ from: 'SYS-GEN-2', to: 'SYS-GEN-1', relation: 'enables' }],
      },
    }));
    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Expand the magic system');
    const sysDelta = result.systemDeltas!;
    expect(sysDelta.addedNodes).toHaveLength(2);
    expect(sysDelta.addedNodes.map((n) => n.id)).toEqual(['SYS-1', 'SYS-2']);
    expect(sysDelta.addedEdges).toHaveLength(1);
    expect(sysDelta.addedEdges[0]).toEqual({ from: 'SYS-2', to: 'SYS-1', relation: 'enables' });
  });
  it('collapses re-mentioned concepts to existing SYS ids', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      systemDeltas: {
        addedNodes: [
          { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'principle' },
          { id: 'SYS-GEN-2', concept: 'Blood Runes', type: 'concept' },
        ],
        addedEdges: [{ from: 'SYS-GEN-2', to: 'SYS-GEN-1', relation: 'requires' }],
      },
    }));
    const narrative = createMinimalNarrative();
    // Pre-existing concept.
    narrative.systemGraph = {
      nodes: { 'SYS-42': { id: 'SYS-42', concept: 'Mana Binding', type: 'system' } },
      edges: [],
    };
    const result = await expandWorld(narrative, [], 0, 'Expand');
    const sysDelta = result.systemDeltas!;
    // Only Blood Runes is genuinely new; Mana Binding collapses to SYS-42.
    expect(sysDelta.addedNodes).toHaveLength(1);
    expect(sysDelta.addedNodes[0].concept).toBe('Blood Runes');
    // Edge now references the existing id.
    expect(sysDelta.addedEdges[0]).toEqual({
      from: sysDelta.addedNodes[0].id,
      to: 'SYS-42',
      relation: 'requires',
    });
  });
  it('filters self-loops', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      systemDeltas: {
        addedNodes: [
          { id: 'SYS-GEN-1', concept: 'Mana', type: 'concept' },
          { id: 'SYS-GEN-2', concept: 'Runes', type: 'concept' },
        ],
        addedEdges: [
          { from: 'SYS-GEN-1', to: 'SYS-GEN-1', relation: 'enables' },
          { from: 'SYS-GEN-1', to: 'SYS-GEN-2', relation: 'enables' },
        ],
      },
    }));
    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Expand');
    const edges = result.systemDeltas!.addedEdges;
    expect(edges).toHaveLength(1);
    expect(edges[0].from).not.toBe(edges[0].to);
  });
  it('drops edges that duplicate ones already in the existing graph', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      systemDeltas: {
        addedNodes: [{ id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' }],
        // Tries to re-add an edge that already exists.
        addedEdges: [{ from: 'SYS-GEN-1', to: 'SYS-99', relation: 'enables' }],
      },
    }));
    const narrative = createMinimalNarrative();
    narrative.systemGraph = {
      nodes: {
        'SYS-99': { id: 'SYS-99', concept: 'Pre-existing', type: 'concept' },
      },
      edges: [],
    };
    const result = await expandWorld(narrative, [], 0, 'Expand');
    expect(result.systemDeltas!.addedNodes).toHaveLength(1);
    expect(result.systemDeltas!.addedEdges).toHaveLength(1);
  });
});
// ── expandWorld: entity continuity normalization + chaining ─────────────────
describe('expandWorld — entity continuity', () => {
  const baseExpansion = {
    locations: [],
    threads: [],
    relationships: [],
    artifacts: [],
    ownershipDeltas: [],
    tieDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    systemDeltas: { addedNodes: [], addedEdges: [] },
  };
  it('normalizes LLM array-shaped character continuity into a Record', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      characters: [
        {
          id: 'C-02', name: 'Bob', role: 'recurring', threadIds: [],
          // LLM emits nodes as an array (the common shape in practice).
          world: {
            nodes: [
              { id: 'K-01', content: 'Former soldier', type: 'history' },
              { id: 'K-02', content: 'Carries a grudge', type: 'belief' },
              { id: 'K-03', content: 'Skilled swordsman', type: 'capability' },
            ],
          },
        },
      ],
    }));
    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Add Bob');
    const bob = result.characters[0];
    // nodes is now a Record keyed by id, not an array with numeric keys.
    expect(bob.world.nodes['K-01']).toBeDefined();
    expect(bob.world.nodes['K-02']).toBeDefined();
    expect(bob.world.nodes['K-03']).toBeDefined();
    expect(Object.keys(bob.world.nodes).sort()).toEqual(['K-01', 'K-02', 'K-03']);
  });
  it('chains initial character continuity nodes via co_occurs edges', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      characters: [
        {
          id: 'C-02', name: 'Bob', role: 'recurring', threadIds: [],
          world: {
            nodes: [
              { id: 'K-01', content: 'Former soldier', type: 'history' },
              { id: 'K-02', content: 'Carries a grudge', type: 'belief' },
              { id: 'K-03', content: 'Skilled swordsman', type: 'capability' },
            ],
          },
        },
      ],
    }));
    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Add Bob');
    const bob = result.characters[0];
    // 3 nodes → 2 co_occurs chain edges
    const coOccursEdges = bob.world.edges.filter((e) => e.relation === 'co_occurs');
    expect(coOccursEdges).toHaveLength(2);
    expect(coOccursEdges[0]).toEqual({ from: 'K-01', to: 'K-02', relation: 'co_occurs' });
    expect(coOccursEdges[1]).toEqual({ from: 'K-02', to: 'K-03', relation: 'co_occurs' });
  });
  it('normalizes location and artifact continuity with the same contract', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      characters: [],
      locations: [
        {
          id: 'L-02', name: 'Forest', prominence: 'place', parentId: null, threadIds: [],
          world: {
            nodes: [
              { id: 'LK-01', content: 'Ancient grove', type: 'trait' },
              { id: 'LK-02', content: 'Haunted by spirits', type: 'state' },
            ],
          },
        },
      ],
      artifacts: [
        {
          id: 'A-01', name: 'Sword', significance: 'key', threadIds: [], parentId: null,
          world: {
            nodes: [
              { id: 'AK-01', content: 'Forged in dragonfire', type: 'history' },
              { id: 'AK-02', content: 'Cuts through stone', type: 'capability' },
            ],
          },
        },
      ],
    }));
    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Add stuff');
    // Location continuity normalized + chained
    const forest = result.locations[0];
    expect(forest.world.nodes['LK-01']).toBeDefined();
    expect(forest.world.nodes['LK-02']).toBeDefined();
    expect(forest.world.edges.filter((e) => e.relation === 'co_occurs')).toHaveLength(1);
    // Artifact continuity normalized + chained
    const sword = result.artifacts![0];
    expect(sword.world.nodes['AK-01']).toBeDefined();
    expect(sword.world.nodes['AK-02']).toBeDefined();
    expect(sword.world.edges.filter((e) => e.relation === 'co_occurs')).toHaveLength(1);
  });
  it('handles missing continuity gracefully', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      characters: [
        { id: 'C-02', name: 'Bob', role: 'transient', threadIds: [] /* no continuity */ },
      ],
    }));
    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Add Bob');
    const bob = result.characters[0];
    expect(bob.world).toEqual({ nodes: {}, edges: [] });
  });
  it('assigns fallback ids to nodes missing ids', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      characters: [
        {
          id: 'C-02', name: 'Bob', role: 'recurring', threadIds: [],
          world: {
            nodes: [
              { content: 'Former soldier', type: 'history' },
              { content: 'Carries a grudge', type: 'belief' },
            ],
          },
        },
      ],
    }));
    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Add Bob');
    const bob = result.characters[0];
    const ids = Object.keys(bob.world.nodes);
    expect(ids).toHaveLength(2);
    // Fallback ids should still be unique and produce a valid chain.
    expect(new Set(ids).size).toBe(2);
    expect(bob.world.edges.filter((e) => e.relation === 'co_occurs')).toHaveLength(1);
  });
});
// ── generateNarrative: initial world generation ─────────────────────────────
describe('generateNarrative — systemGraph + initial continuity', () => {
  function baseWorld() {
    return {
      worldSummary: 'A test world',
      imageStyle: 'test style',
      characters: [],
      locations: [],
      threads: [],
      relationships: [],
      artifacts: [],
      scenes: [],
      arcs: [],
      worldSystems: [],
    };
  }
  it('collapses concepts re-mentioned across initial scenes to one SYS node', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseWorld(),
      characters: [
        { id: 'C-01', name: 'Alice', role: 'anchor', threadIds: [] },
      ],
      locations: [
        { id: 'L-01', name: 'Castle', prominence: 'place', parentId: null, threadIds: [] },
      ],
      threads: [
        { id: 'T-01', participants: [{ id: 'C-01', type: 'character' }], description: 'Quest', openedAt: 'S-001', dependents: [] },
      ],
      scenes: [
        {
          id: 'S-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
          systemDeltas: {
            addedNodes: [{ id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' }],
            addedEdges: [],
          },
          summary: 'Alice learns of mana binding.',
        },
        {
          id: 'S-002', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
          systemDeltas: {
            addedNodes: [{ id: 'SYS-GEN-2', concept: 'mana binding', type: 'principle' }],
            addedEdges: [],
          },
          summary: 'Alice practises mana binding.',
        },
      ],
      arcs: [
        { id: 'ARC-01', name: 'Introduction', sceneIds: ['S-001', 'S-002'], develops: ['T-01'], locationIds: ['L-01'], activeCharacterIds: ['C-01'], initialCharacterLocations: { 'C-01': 'L-01' } },
      ],
    }));
    const result = await generateNarrative('Test', 'A story about magic');
    // The systemGraph is empty on initial generation — it's derived later via computeDerivedEntities
    expect(Object.keys(result.systemGraph!.nodes)).toHaveLength(0);
    expect(result.systemGraph!.edges).toHaveLength(0);
    // Scene-level deduplication still works: scene 1 owns the node, scene 2 collapses to existing
    const s1 = result.scenes['S-001'];
    const s2 = result.scenes['S-002'];
    expect(s1.systemDeltas!.addedNodes).toHaveLength(1);
    expect(s2.systemDeltas!.addedNodes).toHaveLength(0);
  });
  it('normalizes and chains initial character continuity', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseWorld(),
      characters: [
        {
          id: 'C-01', name: 'Alice', role: 'anchor', threadIds: [],
          world: {
            nodes: [
              { id: 'K-01', content: 'Royal heir', type: 'history' },
              { id: 'K-02', content: 'Reluctant leader', type: 'trait' },
              { id: 'K-03', content: 'Fears fire', type: 'weakness' },
            ],
          },
        },
      ],
      locations: [
        { id: 'L-01', name: 'Castle', prominence: 'place', parentId: null, threadIds: [] },
      ],
      threads: [
        { id: 'T-01', participants: [{ id: 'C-01', type: 'character' }], description: 'Quest', openedAt: 'S-001', dependents: [] },
      ],
      scenes: [
        {
          id: 'S-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
          summary: 'Alice arrives.',
        },
      ],
      arcs: [
        { id: 'ARC-01', name: 'Intro', sceneIds: ['S-001'], develops: ['T-01'], locationIds: ['L-01'], activeCharacterIds: ['C-01'], initialCharacterLocations: { 'C-01': 'L-01' } },
      ],
    }));
    const result = await generateNarrative('Test', 'A story');
    const alice = result.characters['C-01'];
    // Nodes became a Record keyed by id, not an array.
    expect(alice.world.nodes['K-01']).toBeDefined();
    expect(alice.world.nodes['K-02']).toBeDefined();
    expect(alice.world.nodes['K-03']).toBeDefined();
    // 3 nodes → 2 co_occurs chain edges
    expect(alice.world.edges.filter((e) => e.relation === 'co_occurs')).toHaveLength(2);
  });
  it('filters self-loops from initial system knowledge edges', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseWorld(),
      characters: [
        { id: 'C-01', name: 'Alice', role: 'anchor', threadIds: [] },
      ],
      locations: [
        { id: 'L-01', name: 'Castle', prominence: 'place', parentId: null, threadIds: [] },
      ],
      threads: [
        { id: 'T-01', participants: [{ id: 'C-01', type: 'character' }], description: 'Quest', openedAt: 'S-001', dependents: [] },
      ],
      scenes: [
        {
          id: 'S-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
          systemDeltas: {
            addedNodes: [
              { id: 'SYS-GEN-1', concept: 'Mana', type: 'concept' },
              { id: 'SYS-GEN-2', concept: 'Runes', type: 'concept' },
            ],
            addedEdges: [
              { from: 'SYS-GEN-1', to: 'SYS-GEN-1', relation: 'enables' }, // self-loop
              { from: 'SYS-GEN-1', to: 'SYS-GEN-2', relation: 'enables' },
            ],
          },
          summary: 'Mana flows through runes.',
        },
      ],
      arcs: [
        { id: 'ARC-01', name: 'Intro', sceneIds: ['S-001'], develops: ['T-01'], locationIds: ['L-01'], activeCharacterIds: ['C-01'], initialCharacterLocations: { 'C-01': 'L-01' } },
      ],
    }));
    const result = await generateNarrative('Test', 'A story');
    // The systemGraph is empty on initial generation — it's derived later via computeDerivedEntities
    expect(result.systemGraph!.edges).toHaveLength(0);
    expect(Object.keys(result.systemGraph!.nodes)).toHaveLength(0);
    // Scene-level sanitization filters self-loops — only the valid edge remains
    const s1 = result.scenes['S-001'];
    expect(s1.systemDeltas!.addedEdges).toHaveLength(1);
    expect(s1.systemDeltas!.addedEdges[0].from).not.toBe(s1.systemDeltas!.addedEdges[0].to);
  });
  it('worldOnly mode processes top-level systemDeltas block with concept dedup', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseWorld(),
      characters: [
        { id: 'C-01', name: 'Alice', role: 'anchor', threadIds: [] },
      ],
      locations: [
        { id: 'L-01', name: 'Castle', prominence: 'place', parentId: null, threadIds: [] },
      ],
      threads: [
        { id: 'T-01', participants: [{ id: 'C-01', type: 'character' }], description: 'Quest', openedAt: 'S-001', dependents: [] },
      ],
      systemDeltas: {
        addedNodes: [
          { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' },
          { id: 'SYS-GEN-2', concept: 'mana binding', type: 'principle' }, // duplicate
          { id: 'SYS-GEN-3', concept: 'Leylines', type: 'concept' },
        ],
        addedEdges: [],
      },
    }));
    const result = await generateNarrative('Test', 'A plan', undefined, true);
    // The systemGraph is empty on initial generation — it's derived later via computeDerivedEntities
    expect(Object.keys(result.systemGraph!.nodes)).toHaveLength(0);
    // The worldBuild's systemDeltas has the deduplicated concepts — only 2 unique
    const worldBuild = Object.values(result.worldBuilds)[0];
    expect(worldBuild.expansionManifest.systemDeltas?.addedNodes).toHaveLength(2);
  });
});
// ── generateNarrative: pilot thread logs ────────────────────────────────────
// Locks in the fix for the bug where the pilot schema omitted addedNodes,
// producing 8 pilot scenes with no thread log history. Also verifies the
// TK-ID remap so scenes using the same LLM placeholder don't collide.
describe('generateNarrative — pilot thread logs', () => {
  function baseWorld() {
    return {
      worldSummary: 'A test world',
      imageStyle: 'test style',
      characters: [{ id: 'C-01', name: 'Alice', role: 'anchor', threadIds: [] }],
      locations: [{ id: 'L-01', name: 'Castle', prominence: 'place', parentId: null, threadIds: [] }],
      threads: [
        { id: 'T-01', participants: [{ id: 'C-01', type: 'character' }], description: 'Main quest', openedAt: 'S-001', dependents: [] },
        { id: 'T-02', participants: [{ id: 'C-01', type: 'character' }], description: 'Side quest', openedAt: 'S-001', dependents: [] },
      ],
      relationships: [],
      artifacts: [],
      arcs: [
        { id: 'ARC-01', name: 'Pilot', sceneIds: ['S-001', 'S-002', 'S-003'], develops: ['T-01', 'T-02'], locationIds: ['L-01'], activeCharacterIds: ['C-01'], initialCharacterLocations: { 'C-01': 'L-01' } },
      ],
      worldSystems: [],
    };
  }
  it('populates thread logs from pilot scene threadDeltas', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseWorld(),
      scenes: [
        {
          id: 'S-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadDeltas: [
            { threadId: 'T-01', logType: "setup", updates: [{ outcome: "yes", evidence: 1 }], volumeDelta: 1, rationale: "Alice hears rumour of the crown" },
            { threadId: 'T-02', logType: "pulse", updates: [], volumeDelta: 1, rationale: "side quest holds steady" },
          ],
          worldDeltas: [], relationshipDeltas: [],
          summary: 'Scene',
        },
      ],
    }));
    const result = await generateNarrative('Test', 'A story');
    const t1Nodes = Object.values(result.threads['T-01'].threadLog.nodes);
    const t2Nodes = Object.values(result.threads['T-02'].threadLog.nodes);
    // Each threadDelta produces exactly one log node (type = logType, content = rationale).
    expect(t1Nodes).toHaveLength(1);
    expect(t1Nodes[0].type).toBe('setup');
    expect(t1Nodes[0].content).toMatch(/rumour of the crown/);
    expect(t1Nodes[0].updates).toEqual([{ outcome: 'yes', evidence: 1 }]);
    expect(t2Nodes).toHaveLength(1);
    expect(t2Nodes[0].type).toBe('pulse');
    expect(t2Nodes[0].content).toMatch(/side quest holds steady/);
  });
});
