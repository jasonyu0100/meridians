import { describe, it, expect } from 'vitest';
import type { NarrativeState, Scene, Character, Location } from '@/types/narrative';
import { computeWorldMetrics } from '@/lib/ai/world';
// ── Test Fixtures ────────────────────────────────────────────────────────────
function createScene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'arc-1',
    povId: 'C-1',
    locationId: 'L-1',
    participantIds: ['C-1'],
    summary: `Scene ${id} summary`,
    events: ['Event 1'],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    characterMovements: {},
    ...overrides,
  };
}
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
    prominence: 'place' as const,
    parentId: null,
    tiedCharacterIds: [],
    threadIds: [],
    world: { nodes: {}, edges: [] },
    ...overrides,
  };
}
function createMinimalNarrative(): NarrativeState {
  return {
    id: 'N-1',
    title: 'Test Narrative',
    description: 'A test story',
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
// ── computeWorldMetrics Tests ────────────────────────────────────────────────
describe('computeWorldMetrics', () => {
  describe('basic metrics', () => {
    it('returns zeros for empty narrative', () => {
      const narrative = createMinimalNarrative();
      const result = computeWorldMetrics(narrative, []);
      expect(result.totalScenes).toBe(0);
      expect(result.totalCharacters).toBe(0);
      expect(result.totalLocations).toBe(0);
      expect(result.usedCharacters).toBe(0);
      expect(result.usedLocations).toBe(0);
    });
    it('counts total characters and locations', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1'),
        'C-2': createCharacter('C-2'),
        'C-3': createCharacter('C-3'),
      };
      narrative.locations = {
        'L-1': createLocation('L-1'),
        'L-2': createLocation('L-2'),
      };
      const result = computeWorldMetrics(narrative, []);
      expect(result.totalCharacters).toBe(3);
      expect(result.totalLocations).toBe(2);
    });
    it('counts used characters and locations from scenes', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1'),
        'C-2': createCharacter('C-2'),
        'C-3': createCharacter('C-3'), // Not used in any scene
      };
      narrative.locations = {
        'L-1': createLocation('L-1'),
        'L-2': createLocation('L-2'), // Not used in any scene
      };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1', 'C-2'], locationId: 'L-1' }),
        'S-2': createScene('S-2', { participantIds: ['C-1'], locationId: 'L-1' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2']);
      expect(result.totalScenes).toBe(2);
      expect(result.usedCharacters).toBe(2); // C-1 and C-2
      expect(result.usedLocations).toBe(1); // L-1 only
    });
  });
  describe('average scenes per character', () => {
    it('calculates average correctly', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1'),
        'C-2': createCharacter('C-2'),
      };
      narrative.locations = { 'L-1': createLocation('L-1') };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1', 'C-2'], locationId: 'L-1' }),
        'S-2': createScene('S-2', { participantIds: ['C-1'], locationId: 'L-1' }),
        'S-3': createScene('S-3', { participantIds: ['C-1'], locationId: 'L-1' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2', 'S-3']);
      // C-1 appears in 3 scenes, C-2 appears in 1 scene
      // Average = (3 + 1) / 2 = 2
      expect(result.avgScenesPerCharacter).toBe(2);
    });
    it('returns 0 when no characters used', () => {
      const narrative = createMinimalNarrative();
      const result = computeWorldMetrics(narrative, []);
      expect(result.avgScenesPerCharacter).toBe(0);
    });
  });
  describe('cast concentration', () => {
    it('calculates concentration as ratio of most-used character', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1'),
        'C-2': createCharacter('C-2'),
      };
      narrative.locations = { 'L-1': createLocation('L-1') };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1'], locationId: 'L-1' }),
        'S-2': createScene('S-2', { participantIds: ['C-1'], locationId: 'L-1' }),
        'S-3': createScene('S-3', { participantIds: ['C-1'], locationId: 'L-1' }),
        'S-4': createScene('S-4', { participantIds: ['C-2'], locationId: 'L-1' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2', 'S-3', 'S-4']);
      // C-1 appears in 3 of 4 scenes = 75%
      expect(result.castConcentration).toBe(0.75);
    });
    it('returns 0 when no scenes', () => {
      const narrative = createMinimalNarrative();
      const result = computeWorldMetrics(narrative, []);
      expect(result.castConcentration).toBe(0);
    });
  });
  describe('stale characters', () => {
    it('marks characters as stale when not seen recently', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1'),
        'C-2': createCharacter('C-2'),
      };
      narrative.locations = { 'L-1': createLocation('L-1') };
      // Create 20 scenes - C-2 only appears in first scene
      const scenes: Record<string, Scene> = {};
      const keys: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const id = `S-${String(i).padStart(3, '0')}`;
        scenes[id] = createScene(id, {
          participantIds: i === 1 ? ['C-1', 'C-2'] : ['C-1'],
          locationId: 'L-1',
        });
        keys.push(id);
      }
      narrative.scenes = scenes;
      const result = computeWorldMetrics(narrative, keys);
      // staleThreshold = max(5, 20 * 0.3) = 6
      // C-2 last seen at index 0, (20 - 1 - 0) = 19 > 6 → stale
      expect(result.staleCharacters).toBe(1);
    });
    it('does not mark characters as stale when recently seen', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1'),
        'C-2': createCharacter('C-2'),
      };
      narrative.locations = { 'L-1': createLocation('L-1') };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1', 'C-2'], locationId: 'L-1' }),
        'S-2': createScene('S-2', { participantIds: ['C-1', 'C-2'], locationId: 'L-1' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2']);
      expect(result.staleCharacters).toBe(0);
    });
  });
  describe('average knowledge per character', () => {
    it('calculates average knowledge nodes', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1', {
          world: { nodes: { 'K-1': { id: 'K-1', type: 'secret', content: 'A secret' } }, edges: [] },
        }),
        'C-2': createCharacter('C-2', {
          world: {
            nodes: {
              'K-2': { id: 'K-2', type: 'history', content: 'Fact 1' },
              'K-3': { id: 'K-3', type: 'history', content: 'Fact 2' },
              'K-4': { id: 'K-4', type: 'history', content: 'Fact 3' },
            },
            edges: [],
          },
        }),
      };
      const result = computeWorldMetrics(narrative, []);
      // (1 + 3) / 2 = 2
      expect(result.avgKnowledgePerCharacter).toBe(2);
    });
    it('returns 0 when no characters', () => {
      const narrative = createMinimalNarrative();
      const result = computeWorldMetrics(narrative, []);
      expect(result.avgKnowledgePerCharacter).toBe(0);
    });
    it('handles characters without continuity', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1'), // No continuity
        'C-2': createCharacter('C-2', {
          world: { nodes: { 'K-1': { id: 'K-1', type: 'history', content: 'Fact' } }, edges: [] },
        }),
      };
      const result = computeWorldMetrics(narrative, []);
      // (0 + 1) / 2 = 0.5
      expect(result.avgKnowledgePerCharacter).toBe(0.5);
    });
  });
  describe('location concentration', () => {
    it('calculates concentration as ratio of most-used location', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = { 'C-1': createCharacter('C-1') };
      narrative.locations = {
        'L-1': createLocation('L-1'),
        'L-2': createLocation('L-2'),
      };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1'], locationId: 'L-1' }),
        'S-2': createScene('S-2', { participantIds: ['C-1'], locationId: 'L-1' }),
        'S-3': createScene('S-3', { participantIds: ['C-1'], locationId: 'L-2' }),
        'S-4': createScene('S-4', { participantIds: ['C-1'], locationId: 'L-1' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2', 'S-3', 'S-4']);
      // L-1 appears in 3 of 4 scenes = 75%
      expect(result.locationConcentration).toBe(0.75);
    });
  });
  describe('stale locations', () => {
    it('marks locations as stale when not used recently', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = { 'C-1': createCharacter('C-1') };
      narrative.locations = {
        'L-1': createLocation('L-1'),
        'L-2': createLocation('L-2'),
      };
      // Create 20 scenes - L-2 only used in first scene
      const scenes: Record<string, Scene> = {};
      const keys: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const id = `S-${String(i).padStart(3, '0')}`;
        scenes[id] = createScene(id, {
          participantIds: ['C-1'],
          locationId: i === 1 ? 'L-2' : 'L-1',
        });
        keys.push(id);
      }
      narrative.scenes = scenes;
      const result = computeWorldMetrics(narrative, keys);
      // L-2 last seen at index 0, (20 - 1 - 0) = 19 > 6 → stale
      expect(result.staleLocations).toBe(1);
    });
  });
  describe('location depth', () => {
    it('calculates max nesting depth', () => {
      const narrative = createMinimalNarrative();
      narrative.locations = {
        'L-1': createLocation('L-1', { parentId: undefined }), // Root
        'L-2': createLocation('L-2', { parentId: 'L-1' }), // Depth 2
        'L-3': createLocation('L-3', { parentId: 'L-2' }), // Depth 3
        'L-4': createLocation('L-4', { parentId: 'L-3' }), // Depth 4
      };
      const result = computeWorldMetrics(narrative, []);
      expect(result.locationDepth).toBe(4);
    });
    it('returns 0 when no locations', () => {
      const narrative = createMinimalNarrative();
      const result = computeWorldMetrics(narrative, []);
      expect(result.locationDepth).toBe(0);
    });
    it('handles multiple root locations', () => {
      const narrative = createMinimalNarrative();
      narrative.locations = {
        'L-1': createLocation('L-1', { parentId: undefined }), // Root 1
        'L-2': createLocation('L-2', { parentId: 'L-1' }), // Depth 2 under L-1
        'L-3': createLocation('L-3', { parentId: undefined }), // Root 2
        'L-4': createLocation('L-4', { parentId: 'L-3' }), // Depth 2 under L-3
        'L-5': createLocation('L-5', { parentId: 'L-4' }), // Depth 3 under L-3
      };
      const result = computeWorldMetrics(narrative, []);
      expect(result.locationDepth).toBe(3); // Max depth is under L-3
    });
    it('handles circular references gracefully', () => {
      const narrative = createMinimalNarrative();
      narrative.locations = {
        'L-1': createLocation('L-1', { parentId: 'L-2' }),
        'L-2': createLocation('L-2', { parentId: 'L-1' }),
      };
      // Should not infinite loop
      const result = computeWorldMetrics(narrative, []);
      expect(result.locationDepth).toBeGreaterThanOrEqual(0);
    });
  });
  describe('average children per location', () => {
    it('calculates average child count', () => {
      const narrative = createMinimalNarrative();
      narrative.locations = {
        'L-1': createLocation('L-1', { parentId: undefined }), // Has 2 children
        'L-2': createLocation('L-2', { parentId: 'L-1' }), // Has 1 child
        'L-3': createLocation('L-3', { parentId: 'L-1' }), // Has 0 children
        'L-4': createLocation('L-4', { parentId: 'L-2' }), // Has 0 children
      };
      const result = computeWorldMetrics(narrative, []);
      // L-1: 2 children, L-2: 1 child, L-3: 0, L-4: 0
      // Average = (2 + 1 + 0 + 0) / 4 = 0.75
      expect(result.avgChildrenPerLocation).toBe(0.75);
    });
  });
  describe('relationships per character', () => {
    it('calculates relationships per character correctly', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1'),
        'C-2': createCharacter('C-2'),
        'C-3': createCharacter('C-3'),
        'C-4': createCharacter('C-4'),
      };
      narrative.relationships = [
        { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
        { from: 'C-1', to: 'C-3', type: 'rival', valence: -0.5 },
        { from: 'C-2', to: 'C-3', type: 'friend', valence: 0.7 },
      ];
      const result = computeWorldMetrics(narrative, []);
      // 3 relationships × 2 / 4 characters = 1.5
      expect(result.relationshipsPerCharacter).toBe(1.5);
    });
    it('returns 0 when no characters', () => {
      const narrative = createMinimalNarrative();
      narrative.relationships = [
        { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
      ];
      const result = computeWorldMetrics(narrative, []);
      expect(result.relationshipsPerCharacter).toBe(0);
    });
  });
  describe('orphaned characters', () => {
    it('counts characters not in any relationship', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1'),
        'C-2': createCharacter('C-2'),
        'C-3': createCharacter('C-3'), // Orphaned
        'C-4': createCharacter('C-4'), // Orphaned
      };
      narrative.relationships = [
        { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
      ];
      const result = computeWorldMetrics(narrative, []);
      expect(result.orphanedCharacters).toBe(2);
    });
    it('counts all characters as orphaned when no relationships', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1'),
        'C-2': createCharacter('C-2'),
      };
      narrative.relationships = [];
      const result = computeWorldMetrics(narrative, []);
      expect(result.orphanedCharacters).toBe(2);
    });
  });
  describe('recommendation logic', () => {
    // The recommendation logic requires depth/breadth signals to exceed the other by > 1
    // So we need at least 2 more signals in one direction than the other
    it('recommends depth when multiple depth signals present', () => {
      const narrative = createMinimalNarrative();
      // Set up multiple depth signals:
      // 1. Low knowledge density (< 3 nodes/char)
      // 2. Sparse relationships (< 2/char)
      // 3. Orphaned characters (> 2)
      narrative.characters = {
        'C-1': createCharacter('C-1'),
        'C-2': createCharacter('C-2'),
        'C-3': createCharacter('C-3'),
        'C-4': createCharacter('C-4'),
      };
      // No continuity = 0 knowledge per character (< 3) → depth signal
      // No relationships = 4 orphaned (> 2) → depth signal
      // 0 relationships / 4 chars = 0 relationships per char (< 2) → depth signal
      narrative.relationships = [];
      // Multiple locations spread out to avoid breadth signals
      narrative.locations = {
        'L-1': createLocation('L-1'),
        'L-2': createLocation('L-2'),
        'L-3': createLocation('L-3'),
        'L-4': createLocation('L-4'),
      };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1', 'C-2'], locationId: 'L-1' }),
        'S-2': createScene('S-2', { participantIds: ['C-3', 'C-4'], locationId: 'L-2' }),
        'S-3': createScene('S-3', { participantIds: ['C-1', 'C-3'], locationId: 'L-3' }),
        'S-4': createScene('S-4', { participantIds: ['C-2', 'C-4'], locationId: 'L-4' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2', 'S-3', 'S-4']);
      expect(result.recommendation).toBe('depth');
      expect(result.reasoning).toContain('Depth recommended');
    });
    it('recommends depth when orphaned characters and sparse relationships', () => {
      const narrative = createMinimalNarrative();
      // Enough knowledge to avoid that signal, but orphans + sparse relationships
      narrative.characters = {
        'C-1': createCharacter('C-1', { world: { nodes: { 'K-1': { id: 'K-1', type: 'secret', content: 'Secret 1' }, 'K-2': { id: 'K-2', type: 'history', content: 'Fact 1' }, 'K-3': { id: 'K-3', type: 'history', content: 'Fact 2' } }, edges: [] } }),
        'C-2': createCharacter('C-2', { world: { nodes: { 'K-4': { id: 'K-4', type: 'history', content: 'Fact 3' }, 'K-5': { id: 'K-5', type: 'history', content: 'Fact 4' }, 'K-6': { id: 'K-6', type: 'history', content: 'Fact 5' } }, edges: [] } }),
        'C-3': createCharacter('C-3', { world: { nodes: { 'K-7': { id: 'K-7', type: 'history', content: 'Fact 6' }, 'K-8': { id: 'K-8', type: 'history', content: 'Fact 7' }, 'K-9': { id: 'K-9', type: 'history', content: 'Fact 8' } }, edges: [] } }),
        'C-4': createCharacter('C-4', { world: { nodes: { 'K-10': { id: 'K-10', type: 'history', content: 'Fact 9' }, 'K-11': { id: 'K-11', type: 'history', content: 'Fact 10' }, 'K-12': { id: 'K-12', type: 'history', content: 'Fact 11' } }, edges: [] } }),
      };
      // No relationships: 4 orphaned (> 2), 0 per char (< 2) - two depth signals
      narrative.relationships = [];
      narrative.locations = {
        'L-1': createLocation('L-1'),
        'L-2': createLocation('L-2'),
        'L-3': createLocation('L-3'),
        'L-4': createLocation('L-4'),
      };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1', 'C-2'], locationId: 'L-1' }),
        'S-2': createScene('S-2', { participantIds: ['C-3', 'C-4'], locationId: 'L-2' }),
        'S-3': createScene('S-3', { participantIds: ['C-1', 'C-3'], locationId: 'L-3' }),
        'S-4': createScene('S-4', { participantIds: ['C-2', 'C-4'], locationId: 'L-4' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2', 'S-3', 'S-4']);
      expect(result.recommendation).toBe('depth');
      expect(result.reasoning).toContain('orphaned');
    });
    it('recommends breadth when multiple breadth signals present', () => {
      const narrative = createMinimalNarrative();
      // Set up multiple breadth signals:
      // 1. High location concentration (> 50%)
      // 2. Few locations relative to cast (< 30%)
      // Add enough knowledge and relationships to avoid depth signals
      narrative.characters = {
        'C-1': createCharacter('C-1', {
          world: { nodes: { 'K-1': { id: 'K-1', type: 'history', content: 'Fact 1' }, 'K-2': { id: 'K-2', type: 'history', content: 'Fact 2' }, 'K-3': { id: 'K-3', type: 'history', content: 'Fact 3' } }, edges: [] },
        }),
        'C-2': createCharacter('C-2', {
          world: { nodes: { 'K-4': { id: 'K-4', type: 'history', content: 'Fact 4' }, 'K-5': { id: 'K-5', type: 'history', content: 'Fact 5' }, 'K-6': { id: 'K-6', type: 'history', content: 'Fact 6' } }, edges: [] },
        }),
        'C-3': createCharacter('C-3', {
          world: { nodes: { 'K-7': { id: 'K-7', type: 'history', content: 'Fact 7' }, 'K-8': { id: 'K-8', type: 'history', content: 'Fact 8' }, 'K-9': { id: 'K-9', type: 'history', content: 'Fact 9' } }, edges: [] },
        }),
        'C-4': createCharacter('C-4', {
          world: { nodes: { 'K-10': { id: 'K-10', type: 'history', content: 'Fact 10' }, 'K-11': { id: 'K-11', type: 'history', content: 'Fact 11' }, 'K-12': { id: 'K-12', type: 'history', content: 'Fact 12' } }, edges: [] },
        }),
        'C-5': createCharacter('C-5', {
          world: { nodes: { 'K-13': { id: 'K-13', type: 'history', content: 'Fact 13' }, 'K-14': { id: 'K-14', type: 'history', content: 'Fact 14' }, 'K-15': { id: 'K-15', type: 'history', content: 'Fact 15' } }, edges: [] },
        }),
        'C-6': createCharacter('C-6', {
          world: { nodes: { 'K-16': { id: 'K-16', type: 'history', content: 'Fact 16' }, 'K-17': { id: 'K-17', type: 'history', content: 'Fact 17' }, 'K-18': { id: 'K-18', type: 'history', content: 'Fact 18' } }, edges: [] },
        }),
        'C-7': createCharacter('C-7', {
          world: { nodes: { 'K-19': { id: 'K-19', type: 'history', content: 'Fact 19' }, 'K-20': { id: 'K-20', type: 'history', content: 'Fact 20' }, 'K-21': { id: 'K-21', type: 'history', content: 'Fact 21' } }, edges: [] },
        }),
        'C-8': createCharacter('C-8', {
          world: { nodes: { 'K-22': { id: 'K-22', type: 'history', content: 'Fact 22' }, 'K-23': { id: 'K-23', type: 'history', content: 'Fact 23' }, 'K-24': { id: 'K-24', type: 'history', content: 'Fact 24' } }, edges: [] },
        }),
        'C-9': createCharacter('C-9', {
          world: { nodes: { 'K-25': { id: 'K-25', type: 'history', content: 'Fact 25' }, 'K-26': { id: 'K-26', type: 'history', content: 'Fact 26' }, 'K-27': { id: 'K-27', type: 'history', content: 'Fact 27' } }, edges: [] },
        }),
        'C-10': createCharacter('C-10', {
          world: { nodes: { 'K-28': { id: 'K-28', type: 'history', content: 'Fact 28' }, 'K-29': { id: 'K-29', type: 'history', content: 'Fact 29' }, 'K-30': { id: 'K-30', type: 'history', content: 'Fact 30' } }, edges: [] },
        }),
      };
      // Add enough relationships to avoid sparse/orphan signals (at least 2/char)
      narrative.relationships = [
        { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
        { from: 'C-2', to: 'C-3', type: 'ally', valence: 0.5 },
        { from: 'C-3', to: 'C-4', type: 'ally', valence: 0.5 },
        { from: 'C-4', to: 'C-5', type: 'ally', valence: 0.5 },
        { from: 'C-5', to: 'C-6', type: 'ally', valence: 0.5 },
        { from: 'C-6', to: 'C-7', type: 'ally', valence: 0.5 },
        { from: 'C-7', to: 'C-8', type: 'ally', valence: 0.5 },
        { from: 'C-8', to: 'C-9', type: 'ally', valence: 0.5 },
        { from: 'C-9', to: 'C-10', type: 'ally', valence: 0.5 },
        { from: 'C-10', to: 'C-1', type: 'ally', valence: 0.5 },
      ];
      // Only 1 location for 10 characters = 10% (< 30%) → breadth signal
      // All scenes in same location = 100% concentration (> 50%) → breadth signal
      narrative.locations = {
        'L-1': createLocation('L-1'),
      };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1', 'C-2', 'C-3', 'C-4', 'C-5'], locationId: 'L-1' }),
        'S-2': createScene('S-2', { participantIds: ['C-6', 'C-7', 'C-8', 'C-9', 'C-10'], locationId: 'L-1' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2']);
      expect(result.recommendation).toBe('breadth');
      expect(result.reasoning).toContain('Breadth recommended');
    });
    it('recommends breadth when stale characters and few locations', () => {
      const narrative = createMinimalNarrative();
      // 10 characters - 5 will be stale (> 40%)
      // Only 2 locations for 10 chars (20% < 30%) - another breadth signal
      narrative.characters = {
        'C-1': createCharacter('C-1', { world: { nodes: { 'K-1': { id: 'K-1', type: 'history', content: 'Fact' }, 'K-2': { id: 'K-2', type: 'history', content: 'Fact' }, 'K-3': { id: 'K-3', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-2': createCharacter('C-2', { world: { nodes: { 'K-4': { id: 'K-4', type: 'history', content: 'Fact' }, 'K-5': { id: 'K-5', type: 'history', content: 'Fact' }, 'K-6': { id: 'K-6', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-3': createCharacter('C-3', { world: { nodes: { 'K-7': { id: 'K-7', type: 'history', content: 'Fact' }, 'K-8': { id: 'K-8', type: 'history', content: 'Fact' }, 'K-9': { id: 'K-9', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-4': createCharacter('C-4', { world: { nodes: { 'K-10': { id: 'K-10', type: 'history', content: 'Fact' }, 'K-11': { id: 'K-11', type: 'history', content: 'Fact' }, 'K-12': { id: 'K-12', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-5': createCharacter('C-5', { world: { nodes: { 'K-13': { id: 'K-13', type: 'history', content: 'Fact' }, 'K-14': { id: 'K-14', type: 'history', content: 'Fact' }, 'K-15': { id: 'K-15', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-6': createCharacter('C-6', { world: { nodes: { 'K-16': { id: 'K-16', type: 'history', content: 'Fact' }, 'K-17': { id: 'K-17', type: 'history', content: 'Fact' }, 'K-18': { id: 'K-18', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-7': createCharacter('C-7', { world: { nodes: { 'K-19': { id: 'K-19', type: 'history', content: 'Fact' }, 'K-20': { id: 'K-20', type: 'history', content: 'Fact' }, 'K-21': { id: 'K-21', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-8': createCharacter('C-8', { world: { nodes: { 'K-22': { id: 'K-22', type: 'history', content: 'Fact' }, 'K-23': { id: 'K-23', type: 'history', content: 'Fact' }, 'K-24': { id: 'K-24', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-9': createCharacter('C-9', { world: { nodes: { 'K-25': { id: 'K-25', type: 'history', content: 'Fact' }, 'K-26': { id: 'K-26', type: 'history', content: 'Fact' }, 'K-27': { id: 'K-27', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-10': createCharacter('C-10', { world: { nodes: { 'K-28': { id: 'K-28', type: 'history', content: 'Fact' }, 'K-29': { id: 'K-29', type: 'history', content: 'Fact' }, 'K-30': { id: 'K-30', type: 'history', content: 'Fact' } }, edges: [] } }),
      };
      narrative.relationships = [
        { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
        { from: 'C-2', to: 'C-3', type: 'ally', valence: 0.5 },
        { from: 'C-3', to: 'C-4', type: 'ally', valence: 0.5 },
        { from: 'C-4', to: 'C-5', type: 'ally', valence: 0.5 },
        { from: 'C-5', to: 'C-6', type: 'ally', valence: 0.5 },
        { from: 'C-6', to: 'C-7', type: 'ally', valence: 0.5 },
        { from: 'C-7', to: 'C-8', type: 'ally', valence: 0.5 },
        { from: 'C-8', to: 'C-9', type: 'ally', valence: 0.5 },
        { from: 'C-9', to: 'C-10', type: 'ally', valence: 0.5 },
        { from: 'C-10', to: 'C-1', type: 'ally', valence: 0.5 },
      ];
      // Only 2 locations for 10 characters (20% < 30%) → breadth signal
      narrative.locations = {
        'L-1': createLocation('L-1'),
        'L-2': createLocation('L-2'),
      };
      // Create 20 scenes
      // - Characters C-1 through C-5 only appear in first 2 scenes (stale after)
      // - Remaining scenes use C-6-C-10 evenly to avoid cast concentration
      const scenes: Record<string, Scene> = {};
      const keys: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const id = `S-${String(i).padStart(3, '0')}`;
        if (i <= 2) {
          scenes[id] = createScene(id, {
            participantIds: ['C-1', 'C-2', 'C-3', 'C-4', 'C-5'],
            locationId: 'L-1',
          });
        } else {
          // Rotate through C-6 to C-10
          const charIdx = ((i - 3) % 5) + 6;
          const char2Idx = ((i - 2) % 5) + 6;
          scenes[id] = createScene(id, {
            participantIds: [`C-${String(charIdx).padStart(2, '0')}`, `C-${String(char2Idx).padStart(2, '0')}`],
            locationId: i % 2 === 0 ? 'L-1' : 'L-2',
          });
        }
        keys.push(id);
      }
      narrative.scenes = scenes;
      const result = computeWorldMetrics(narrative, keys);
      // Should have breadth signals: stale characters (50% > 40%) + few locations (20% < 30%)
      expect(result.recommendation).toBe('breadth');
      expect(result.reasoning).toContain('Breadth recommended');
    });
    it('recommends balanced when signals are equal', () => {
      const narrative = createMinimalNarrative();
      // Set up a balanced world with no strong signals
      // - 3 knowledge per char (>= 3) → no depth signal
      // - Deep location hierarchy (depth 3 with 3 root locations) → no depth signal
      // - All chars connected with 2 relationships each → no depth signal
      // - Locations well distributed → no breadth signal
      narrative.characters = {
        'C-1': createCharacter('C-1', {
          world: { nodes: { 'K-1': { id: 'K-1', type: 'history', content: 'Fact 1' }, 'K-2': { id: 'K-2', type: 'history', content: 'Fact 2' }, 'K-3': { id: 'K-3', type: 'history', content: 'Fact 3' } }, edges: [] },
        }),
        'C-2': createCharacter('C-2', {
          world: { nodes: { 'K-4': { id: 'K-4', type: 'history', content: 'Fact 4' }, 'K-5': { id: 'K-5', type: 'history', content: 'Fact 5' }, 'K-6': { id: 'K-6', type: 'history', content: 'Fact 6' } }, edges: [] },
        }),
        'C-3': createCharacter('C-3', {
          world: { nodes: { 'K-7': { id: 'K-7', type: 'history', content: 'Fact 7' }, 'K-8': { id: 'K-8', type: 'history', content: 'Fact 8' }, 'K-9': { id: 'K-9', type: 'history', content: 'Fact 9' } }, edges: [] },
        }),
        'C-4': createCharacter('C-4', {
          world: { nodes: { 'K-10': { id: 'K-10', type: 'history', content: 'Fact 10' }, 'K-11': { id: 'K-11', type: 'history', content: 'Fact 11' }, 'K-12': { id: 'K-12', type: 'history', content: 'Fact 12' } }, edges: [] },
        }),
      };
      narrative.relationships = [
        { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
        { from: 'C-2', to: 'C-3', type: 'ally', valence: 0.5 },
        { from: 'C-3', to: 'C-4', type: 'ally', valence: 0.5 },
        { from: 'C-4', to: 'C-1', type: 'ally', valence: 0.5 },
      ];
      // 3 locations with hierarchy (depth 3) to avoid shallow hierarchy signal
      // Also 3 locs <= 3 locs condition
      narrative.locations = {
        'L-1': createLocation('L-1'), // root
        'L-2': { ...createLocation('L-2'), parentId: 'L-1' }, // child
        'L-3': { ...createLocation('L-3'), parentId: 'L-2' }, // grandchild (depth 3)
      };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1', 'C-2'], locationId: 'L-1' }),
        'S-2': createScene('S-2', { participantIds: ['C-2', 'C-3'], locationId: 'L-2' }),
        'S-3': createScene('S-3', { participantIds: ['C-3', 'C-4'], locationId: 'L-3' }),
        'S-4': createScene('S-4', { participantIds: ['C-4', 'C-1'], locationId: 'L-1' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2', 'S-3', 'S-4']);
      expect(result.recommendation).toBe('balanced');
    });
    it('reports balanced reasoning when signals roughly equal', () => {
      const narrative = createMinimalNarrative();
      // Create a world with equal depth and breadth signals (1 each)
      // Depth signal: sparse relationships (< 2/char) - only 1 relationship / 4 chars
      // Breadth signal: high location concentration (> 50%) - 3/4 scenes at L-1
      // (avoid "few locations" signal by having >= 30% ratio: 2 locs / 4 chars = 50%)
      narrative.characters = {
        'C-1': createCharacter('C-1', {
          world: { nodes: { 'K-1': { id: 'K-1', type: 'history', content: 'Fact 1' }, 'K-2': { id: 'K-2', type: 'history', content: 'Fact 2' }, 'K-3': { id: 'K-3', type: 'history', content: 'Fact 3' } }, edges: [] },
        }),
        'C-2': createCharacter('C-2', {
          world: { nodes: { 'K-4': { id: 'K-4', type: 'history', content: 'Fact 4' }, 'K-5': { id: 'K-5', type: 'history', content: 'Fact 5' }, 'K-6': { id: 'K-6', type: 'history', content: 'Fact 6' } }, edges: [] },
        }),
        'C-3': createCharacter('C-3', {
          world: { nodes: { 'K-7': { id: 'K-7', type: 'history', content: 'Fact 7' }, 'K-8': { id: 'K-8', type: 'history', content: 'Fact 8' }, 'K-9': { id: 'K-9', type: 'history', content: 'Fact 9' } }, edges: [] },
        }),
        'C-4': createCharacter('C-4', {
          world: { nodes: { 'K-10': { id: 'K-10', type: 'history', content: 'Fact 10' }, 'K-11': { id: 'K-11', type: 'history', content: 'Fact 11' }, 'K-12': { id: 'K-12', type: 'history', content: 'Fact 12' } }, edges: [] },
        }),
      };
      // Only 1 relationship → 2 endpoints / 4 chars = 0.5/char (< 2) → depth signal
      // 2 orphans (C-3, C-4) → but we need only 1 depth signal, so add more relationships
      // Actually: 1 rel = 2 endpoints → 4 chars → 0.5/char + 2 orphans = 2 depth signals
      // Let me use 2 rels: 4 endpoints / 4 chars = 1/char (< 2) → 1 depth signal, 0 orphans
      narrative.relationships = [
        { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
        { from: 'C-3', to: 'C-4', type: 'ally', valence: 0.5 },
      ];
      // 2 locations for 4 chars (50% >= 30%) → no "few locations" signal
      // But use L-1 for 3/4 scenes → 75% concentration (> 50%) → breadth signal
      narrative.locations = {
        'L-1': createLocation('L-1'),
        'L-2': createLocation('L-2'),
      };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1', 'C-2'], locationId: 'L-1' }),
        'S-2': createScene('S-2', { participantIds: ['C-2', 'C-3'], locationId: 'L-1' }),
        'S-3': createScene('S-3', { participantIds: ['C-3', 'C-4'], locationId: 'L-1' }),
        'S-4': createScene('S-4', { participantIds: ['C-4', 'C-1'], locationId: 'L-2' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2', 'S-3', 'S-4']);
      // 1 depth signal (sparse relationships) vs 1 breadth signal (high location concentration) = balanced
      expect(result.recommendation).toBe('balanced');
      expect(result.reasoning.toLowerCase()).toContain('balanced');
    });
  });
  describe('depth signals', () => {
    it('detects shallow location hierarchy', () => {
      const narrative = createMinimalNarrative();
      // 4 locations but max depth of 2
      narrative.locations = {
        'L-1': createLocation('L-1'),
        'L-2': createLocation('L-2'),
        'L-3': createLocation('L-3', { parentId: 'L-1' }),
        'L-4': createLocation('L-4', { parentId: 'L-2' }),
      };
      narrative.characters = {
        'C-1': createCharacter('C-1'),
      };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1'], locationId: 'L-1' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1']);
      expect(result.locationDepth).toBe(2);
      expect(result.reasoning).toContain('shallow');
    });
    it('detects high cast concentration', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1', { world: { nodes: { 'K-1': { id: 'K-1', type: 'history', content: 'Fact' }, 'K-2': { id: 'K-2', type: 'history', content: 'Fact' }, 'K-3': { id: 'K-3', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-2': createCharacter('C-2', { world: { nodes: { 'K-4': { id: 'K-4', type: 'history', content: 'Fact' }, 'K-5': { id: 'K-5', type: 'history', content: 'Fact' }, 'K-6': { id: 'K-6', type: 'history', content: 'Fact' } }, edges: [] } }),
      };
      narrative.relationships = [
        { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
        { from: 'C-2', to: 'C-1', type: 'ally', valence: 0.5 },
      ];
      narrative.locations = { 'L-1': createLocation('L-1') };
      // C-1 appears in all 5 scenes, C-2 only in 1
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1', 'C-2'], locationId: 'L-1' }),
        'S-2': createScene('S-2', { participantIds: ['C-1'], locationId: 'L-1' }),
        'S-3': createScene('S-3', { participantIds: ['C-1'], locationId: 'L-1' }),
        'S-4': createScene('S-4', { participantIds: ['C-1'], locationId: 'L-1' }),
        'S-5': createScene('S-5', { participantIds: ['C-1'], locationId: 'L-1' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2', 'S-3', 'S-4', 'S-5']);
      expect(result.castConcentration).toBe(1.0); // 5/5 = 100%
      expect(result.reasoning).toContain('concentration');
    });
    it('detects sparse relationships', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-1': createCharacter('C-1', { world: { nodes: { 'K-1': { id: 'K-1', type: 'history', content: 'Fact' }, 'K-2': { id: 'K-2', type: 'history', content: 'Fact' }, 'K-3': { id: 'K-3', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-2': createCharacter('C-2', { world: { nodes: { 'K-4': { id: 'K-4', type: 'history', content: 'Fact' }, 'K-5': { id: 'K-5', type: 'history', content: 'Fact' }, 'K-6': { id: 'K-6', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-3': createCharacter('C-3', { world: { nodes: { 'K-7': { id: 'K-7', type: 'history', content: 'Fact' }, 'K-8': { id: 'K-8', type: 'history', content: 'Fact' }, 'K-9': { id: 'K-9', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-4': createCharacter('C-4', { world: { nodes: { 'K-10': { id: 'K-10', type: 'history', content: 'Fact' }, 'K-11': { id: 'K-11', type: 'history', content: 'Fact' }, 'K-12': { id: 'K-12', type: 'history', content: 'Fact' } }, edges: [] } }),
      };
      // Only 1 relationship = 0.5 per character (< 2)
      narrative.relationships = [
        { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
      ];
      narrative.locations = { 'L-1': createLocation('L-1') };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1', 'C-2', 'C-3', 'C-4'], locationId: 'L-1' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1']);
      expect(result.relationshipsPerCharacter).toBe(0.5); // 1 * 2 / 4
      expect(result.reasoning).toContain('sparse relationships');
    });
  });
  describe('breadth signals', () => {
    it('detects few locations relative to cast', () => {
      const narrative = createMinimalNarrative();
      // 10 characters, only 2 locations (< 30%)
      const chars: Record<string, Character> = {};
      for (let i = 1; i <= 10; i++) {
        const id = `C-${String(i).padStart(2, '0')}`;
        chars[id] = createCharacter(id, {
          world: { nodes: { [`K-${i}`]: { id: `K-${i}`, type: 'history', content: 'Fact' }, [`K-${i}0`]: { id: `K-${i}0`, type: 'history', content: 'Fact' }, [`K-${i}00`]: { id: `K-${i}00`, type: 'history', content: 'Fact' } }, edges: [] },
        });
      }
      narrative.characters = chars;
      // Add enough relationships
      narrative.relationships = [
        { from: 'C-1', to: 'C-2', type: 'ally', valence: 0.5 },
        { from: 'C-2', to: 'C-3', type: 'ally', valence: 0.5 },
        { from: 'C-3', to: 'C-4', type: 'ally', valence: 0.5 },
        { from: 'C-4', to: 'C-5', type: 'ally', valence: 0.5 },
        { from: 'C-5', to: 'C-6', type: 'ally', valence: 0.5 },
        { from: 'C-6', to: 'C-7', type: 'ally', valence: 0.5 },
        { from: 'C-7', to: 'C-8', type: 'ally', valence: 0.5 },
        { from: 'C-8', to: 'C-9', type: 'ally', valence: 0.5 },
        { from: 'C-9', to: 'C-10', type: 'ally', valence: 0.5 },
        { from: 'C-10', to: 'C-1', type: 'ally', valence: 0.5 },
      ];
      narrative.locations = {
        'L-1': createLocation('L-1'),
        'L-2': createLocation('L-2'),
      };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1', 'C-2'], locationId: 'L-1' }),
        'S-2': createScene('S-2', { participantIds: ['C-3', 'C-4'], locationId: 'L-2' }),
      };
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2']);
      // 2 locations / 10 characters = 20% (< 30%)
      expect(result.reasoning).toContain('location count low');
    });
  });
  describe('edge cases', () => {
    it('handles world commits in resolvedKeys', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = { 'C-1': createCharacter('C-1') };
      narrative.locations = { 'L-1': createLocation('L-1') };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1'], locationId: 'L-1' }),
      };
      narrative.worldBuilds = {
        'WB-1': {
          id: 'WB-1',
          kind: 'world_build',
          summary: 'Test world build',
          expansionManifest: {
            newCharacters: [],
            newLocations: [],
            newThreads: [],
            newArtifacts: [],
            systemDeltas: { addedNodes: [], addedEdges: [] },
          },
        },
      };
      // resolvedKeys includes both scenes and world builds
      const result = computeWorldMetrics(narrative, ['WB-1', 'S-1']);
      // World builds should be filtered out
      expect(result.totalScenes).toBe(1);
    });
    it('handles missing scenes in resolvedKeys', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = { 'C-1': createCharacter('C-1') };
      narrative.locations = { 'L-1': createLocation('L-1') };
      narrative.scenes = {
        'S-1': createScene('S-1', { participantIds: ['C-1'], locationId: 'L-1' }),
      };
      // S-2 doesn't exist
      const result = computeWorldMetrics(narrative, ['S-1', 'S-2', 'S-3']);
      expect(result.totalScenes).toBe(1);
    });
  });
});
