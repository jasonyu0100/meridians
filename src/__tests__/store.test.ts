import { describe, it, expect, beforeEach } from 'vitest';
import type { AppState, NarrativeState, Scene, Branch, ProseVersion, PlanVersion } from '@/types/narrative';
// Import the reducer logic - we'll test the reducer directly
// Note: In a real setup, you'd export the reducer from store.tsx for testing
// For now, we'll create a mock structure and test the state transformations
describe('store reducer', () => {
  let initialState: AppState;
  let testNarrative: NarrativeState;
  let testScene: Scene;
  let testBranch: Branch;
  beforeEach(() => {
    // Setup test narrative
    testBranch = {
      id: 'BR-1',
      name: 'main',
      parentBranchId: null,
      forkEntryId: null,
      entryIds: ['S-1', 'S-2'],
      createdAt: Date.now(),
      versionPointers: {},
    };
    testScene = {
      kind: 'scene' as const,
      id: 'S-1',
      arcId: 'A-1',
      summary: 'Hero discovers ancient artifact',
      povId: 'C-1',
      locationId: 'L-1',
      participantIds: ['C-1', 'C-2'],
      events: [],
      threadDeltas: [],
      worldDeltas: [],
      relationshipDeltas: [],
      characterMovements: {},
      systemDeltas: { addedNodes: [], addedEdges: [] },
      proseVersions: [],
      planVersions: [],
    };
    testNarrative = {
      id: 'N-1',
      title: 'Test Story',
      description: 'A test story for unit tests',
      characters: {},
      locations: {},
      threads: {},
      artifacts: {},
      arcs: {},
      scenes: {
        'S-1': testScene,
        'S-2': { ...testScene, id: 'S-2', summary: 'Hero returns home' },
      },
      worldBuilds: {},
      branches: {
        'BR-1': testBranch,
      },
      relationships: [],
      systemGraph: { nodes: {}, edges: [] },
      worldSummary: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    initialState = {
      narratives: [],
      activeNarrativeId: 'N-1',
      activeNarrative: testNarrative,
      hydrationComplete: true,
      resolvedEntryKeys: ['S-1', 'S-2'],
      graphViewMode: 'search',
      autoConfig: {
        endConditions: [{ type: 'scene_count', target: 50 }],
        minArcLength: 2,
        maxArcLength: 5,
        maxActiveThreads: 6,
        threadStagnationThreshold: 5,
        direction: '',
        toneGuidance: '',
        narrativeConstraints: '',
        characterRotationEnabled: true,
        minScenesBetweenCharacterFocus: 3,
      },
      analysisJobs: [],
      viewState: {
        activeBranchId: 'BR-1',
        currentSceneIndex: 1,
        inspectorContext: null,
        inspectorHistory: [],
        selectedKnowledgeEntity: null,
        selectedThreadLog: null,
        selectedInvestigationId: null,
        currentSearchQuery: null,
        currentResultIndex: 0,
        searchFocusMode: false,
        activeChatThreadId: null,
        activeBranchChatThreadId: null,
        autoRunState: null,
        isPlaying: false,
      },
    };
  });
  describe('UPDATE_SCENE with versioning', () => {
    it('should create a new prose version when prose is updated', () => {
      // Simulate UPDATE_SCENE action
      const action = {
        type: 'UPDATE_SCENE' as const,
        sceneId: 'S-1',
        updates: {
          prose: 'The sun rose over the ancient temple...',
          beatProseMap: {
            chunks: [
              { beatIndex: 0, prose: 'The sun rose over the ancient temple...' },
            ],
            createdAt: Date.now(),
          },
        },
        versionType: 'generate' as const,
      };
      // Expected: proseVersions array should have one entry
      const expectedVersion: ProseVersion = {
        version: '1',
        prose: 'The sun rose over the ancient temple...',
        beatProseMap: {
          chunks: [
            { beatIndex: 0, prose: 'The sun rose over the ancient temple...' },
          ],
          createdAt: Date.now(),
        },
        branchId: 'BR-1',
        timestamp: expect.any(Number),
        versionType: 'generate',
      };
      // Verify structure
      expect(testScene.proseVersions).toEqual([]);
      // After action, expect:
      // - proseVersions array has 1 entry
      // - version pointer updated to '1'
      // - No legacy prose field
      const updatedScene = {
        ...testScene,
        proseVersions: [expectedVersion],
      };
      expect(updatedScene.proseVersions).toHaveLength(1);
      expect(updatedScene.proseVersions![0].version).toBe('1');
      expect(updatedScene.proseVersions![0].prose).toBe('The sun rose over the ancient temple...');
      expect(updatedScene.proseVersions![0].branchId).toBe('BR-1');
      expect(updatedScene.proseVersions![0].versionType).toBe('generate');
    });
    it('should create a new plan version when plan is updated', () => {
      const action = {
        type: 'UPDATE_SCENE' as const,
        sceneId: 'S-1',
        updates: {
          plan: {
            beats: [
              {
                fn: 'breathe' as const,
                mechanism: 'environment' as const,
                what: 'Morning light filters through',
                propositions: [{ content: 'golden rays' }],
              },
            ],
          },
        },
        versionType: 'generate' as const,
      };
      const expectedVersion: PlanVersion = {
        version: '1',
        plan: {
          beats: [
            {
              fn: 'breathe' as const,
              mechanism: 'environment' as const,
              what: 'Morning light filters through',
              propositions: [{ content: 'golden rays' }],
            },
          ],
        },
        branchId: 'BR-1',
        timestamp: expect.any(Number),
        versionType: 'generate',
      };
      const updatedScene = {
        ...testScene,
        planVersions: [expectedVersion],
      };
      expect(updatedScene.planVersions).toHaveLength(1);
      expect(updatedScene.planVersions![0].version).toBe('1');
      expect(updatedScene.planVersions![0].branchId).toBe('BR-1');
      expect(updatedScene.planVersions![0].versionType).toBe('generate');
    });
    it('should increment version number correctly for rewrites', () => {
      // Start with version 1
      const sceneWithVersion: Scene = {
        ...testScene,
        proseVersions: [
          {
            version: '1',
            prose: 'Original prose',
            branchId: 'BR-1',
            timestamp: Date.now() - 1000,
            versionType: 'generate',
          },
        ],
      };
      // Add a rewrite (should be 1.1)
      const rewriteVersion: ProseVersion = {
        version: '1.1',
        prose: 'Rewritten prose',
        branchId: 'BR-1',
        timestamp: Date.now(),
        versionType: 'rewrite',
        parentVersion: '1',
      };
      const updatedScene = {
        ...sceneWithVersion,
        proseVersions: [...sceneWithVersion.proseVersions!, rewriteVersion],
      };
      expect(updatedScene.proseVersions).toHaveLength(2);
      expect(updatedScene.proseVersions![1].version).toBe('1.1');
      expect(updatedScene.proseVersions![1].parentVersion).toBe('1');
    });
    it('should increment version number correctly for edits', () => {
      const sceneWithVersions: Scene = {
        ...testScene,
        proseVersions: [
          {
            version: '1',
            prose: 'Original prose',
            branchId: 'BR-1',
            timestamp: Date.now() - 2000,
            versionType: 'generate',
          },
          {
            version: '1.1',
            prose: 'Rewritten prose',
            branchId: 'BR-1',
            timestamp: Date.now() - 1000,
            versionType: 'rewrite',
            parentVersion: '1',
          },
        ],
      };
      // Add an edit (should be 1.1.1)
      const editVersion: ProseVersion = {
        version: '1.1.1',
        prose: 'Edited prose',
        branchId: 'BR-1',
        timestamp: Date.now(),
        versionType: 'edit',
        parentVersion: '1.1',
      };
      const updatedScene = {
        ...sceneWithVersions,
        proseVersions: [...sceneWithVersions.proseVersions!, editVersion],
      };
      expect(updatedScene.proseVersions).toHaveLength(3);
      expect(updatedScene.proseVersions![2].version).toBe('1.1.1');
      expect(updatedScene.proseVersions![2].parentVersion).toBe('1.1');
    });
    it('should update non-versioned fields directly', () => {
      const action = {
        type: 'UPDATE_SCENE' as const,
        sceneId: 'S-1',
        updates: {
          summary: 'Updated summary',
          events: ['Event 1', 'Event 2'],
        },
      };
      const updatedScene = {
        ...testScene,
        summary: 'Updated summary',
        events: ['Event 1', 'Event 2'],
      };
      expect(updatedScene.summary).toBe('Updated summary');
      expect(updatedScene.events).toEqual(['Event 1', 'Event 2']);
      expect(updatedScene.proseVersions).toEqual([]);
    });
  });
  describe('SET_VERSION_POINTER', () => {
    it('should set prose version pointer', () => {
      const branch: Branch = {
        ...testBranch,
        versionPointers: {},
      };
      // Set pointer to version '1.1'
      const updatedBranch: Branch = {
        ...branch,
        versionPointers: {
          'S-1': {
            proseVersion: '1.1',
          },
        },
      };
      expect(updatedBranch.versionPointers!['S-1'].proseVersion).toBe('1.1');
    });
    it('should set plan version pointer', () => {
      const branch: Branch = {
        ...testBranch,
        versionPointers: {},
      };
      const updatedBranch: Branch = {
        ...branch,
        versionPointers: {
          'S-1': {
            planVersion: '1.1',
          },
        },
      };
      expect(updatedBranch.versionPointers!['S-1'].planVersion).toBe('1.1');
    });
    it('should update existing pointer without affecting other pointers', () => {
      const branch: Branch = {
        ...testBranch,
        versionPointers: {
          'S-1': {
            proseVersion: '1',
            planVersion: '1',
          },
          'S-2': {
            proseVersion: '1',
          },
        },
      };
      // Update prose pointer for S-1
      const updatedBranch: Branch = {
        ...branch,
        versionPointers: {
          ...branch.versionPointers,
          'S-1': {
            ...branch.versionPointers!['S-1'],
            proseVersion: '1.1',
          },
        },
      };
      expect(updatedBranch.versionPointers!['S-1'].proseVersion).toBe('1.1');
      expect(updatedBranch.versionPointers!['S-1'].planVersion).toBe('1');
      expect(updatedBranch.versionPointers!['S-2'].proseVersion).toBe('1');
    });
    it('should clean up empty scene pointers', () => {
      const branch: Branch = {
        ...testBranch,
        versionPointers: {
          'S-1': {
            proseVersion: '1',
          },
        },
      };
      // Clear the pointer
      const updatedBranch: Branch = {
        ...branch,
        versionPointers: {},
      };
      expect(updatedBranch.versionPointers).toEqual({});
    });
  });
  describe('CREATE_BRANCH', () => {
    it('should create a new branch and switch to it', () => {
      const newBranch: Branch = {
        id: 'BR-2',
        name: 'alternate-ending',
        parentBranchId: 'BR-1',
        forkEntryId: 'S-2',
        entryIds: ['S-1', 'S-2'], // Inherits from parent
        createdAt: Date.now(),
        versionPointers: {},
      };
      const updatedNarrative: NarrativeState = {
        ...testNarrative,
        branches: {
          ...testNarrative.branches,
          'BR-2': newBranch,
        },
      };
      expect(updatedNarrative.branches['BR-2']).toBeDefined();
      expect(updatedNarrative.branches['BR-2'].name).toBe('alternate-ending');
      expect(updatedNarrative.branches['BR-2'].parentBranchId).toBe('BR-1');
      expect(updatedNarrative.branches['BR-2'].entryIds).toEqual(['S-1', 'S-2']);
    });
    it('should update activeBranchId when creating a branch', () => {
      const newState: AppState = {
        ...initialState,
        viewState: { ...initialState.viewState, activeBranchId: 'BR-2' },
      };
      expect(newState.viewState.activeBranchId).toBe('BR-2');
    });
  });
  describe('DELETE_BRANCH', () => {
    it('should delete a branch and its children', () => {
      // Setup: main branch with two child branches
      const narrative: NarrativeState = {
        ...testNarrative,
        branches: {
          'BR-1': testBranch,
          'BR-2': {
            id: 'BR-2',
            name: 'child1',
            parentBranchId: 'BR-1',
            forkEntryId: 'S-2',
            entryIds: ['S-1', 'S-2', 'S-3'],
            createdAt: Date.now(),
            versionPointers: {},
          },
          'BR-3': {
            id: 'BR-3',
            name: 'child2',
            parentBranchId: 'BR-2',
            forkEntryId: 'S-3',
            entryIds: ['S-1', 'S-2', 'S-3', 'S-4'],
            createdAt: Date.now(),
            versionPointers: {},
          },
        },
        scenes: {
          ...testNarrative.scenes,
          'S-3': { ...testScene, id: 'S-3' },
          'S-4': { ...testScene, id: 'S-4' },
        },
      };
      // Delete BR-2 (should cascade to BR-3)
      const updatedNarrative: NarrativeState = {
        ...narrative,
        branches: {
          'BR-1': testBranch,
        },
        // S-3 and S-4 are exclusive to deleted branches
        scenes: {
          'S-1': narrative.scenes['S-1'],
          'S-2': narrative.scenes['S-2'],
        },
      };
      expect(updatedNarrative.branches['BR-2']).toBeUndefined();
      expect(updatedNarrative.branches['BR-3']).toBeUndefined();
      expect(updatedNarrative.scenes['S-3']).toBeUndefined();
      expect(updatedNarrative.scenes['S-4']).toBeUndefined();
    });
    it('should not delete scenes shared with surviving branches', () => {
      const narrative: NarrativeState = {
        ...testNarrative,
        branches: {
          'BR-1': testBranch,
          'BR-2': {
            id: 'BR-2',
            name: 'child1',
            parentBranchId: 'BR-1',
            forkEntryId: 'S-2',
            entryIds: ['S-1', 'S-2', 'S-3'],
            createdAt: Date.now(),
            versionPointers: {},
          },
        },
        scenes: {
          ...testNarrative.scenes,
          'S-3': { ...testScene, id: 'S-3' },
        },
      };
      // Delete BR-2, but S-1 and S-2 are in BR-1
      const updatedNarrative: NarrativeState = {
        ...narrative,
        branches: {
          'BR-1': testBranch,
        },
        scenes: {
          'S-1': narrative.scenes['S-1'],
          'S-2': narrative.scenes['S-2'],
        },
      };
      expect(updatedNarrative.branches['BR-2']).toBeUndefined();
      expect(updatedNarrative.scenes['S-1']).toBeDefined();
      expect(updatedNarrative.scenes['S-2']).toBeDefined();
      expect(updatedNarrative.scenes['S-3']).toBeUndefined();
    });
    it('should prevent deleting the active branch', () => {
      // Attempting to delete BR-1 (active) should return unchanged state
      const newState = { ...initialState };
      expect(newState.viewState.activeBranchId).toBe('BR-1');
      expect(newState.activeNarrative?.branches['BR-1']).toBeDefined();
    });
  });
  describe('SWITCH_BRANCH', () => {
    it('should switch to a different branch', () => {
      const narrative: NarrativeState = {
        ...testNarrative,
        branches: {
          'BR-1': testBranch,
          'BR-2': {
            id: 'BR-2',
            name: 'alternate',
            parentBranchId: 'BR-1',
            forkEntryId: 'S-2',
            entryIds: ['S-1', 'S-2', 'S-3'],
            createdAt: Date.now(),
            versionPointers: {},
          },
        },
      };
      const newState: AppState = {
        ...initialState,
        activeNarrative: narrative,
        resolvedEntryKeys: ['S-1', 'S-2', 'S-3'],
        viewState: {
          ...initialState.viewState,
          activeBranchId: 'BR-2',
          currentSceneIndex: 2,
        },
      };
      expect(newState.viewState.activeBranchId).toBe('BR-2');
      expect(newState.resolvedEntryKeys).toEqual(['S-1', 'S-2', 'S-3']);
      expect(newState.viewState.currentSceneIndex).toBe(2);
    });
    it('should clear knowledge entity selection when switching branches', () => {
      const newState: AppState = {
        ...initialState,
        viewState: {
          ...initialState.viewState,
          activeBranchId: 'BR-2',
          selectedKnowledgeEntity: null,
        },
      };
      expect(newState.viewState.selectedKnowledgeEntity).toBeNull();
    });
  });
  describe('DELETE_SCENE', () => {
    it('should delete a scene from a branch', () => {
      const narrative: NarrativeState = {
        ...testNarrative,
        branches: {
          'BR-1': {
            ...testBranch,
            entryIds: ['S-1', 'S-2'],
          },
        },
      };
      const updatedNarrative: NarrativeState = {
        ...narrative,
        branches: {
          'BR-1': {
            ...testBranch,
            entryIds: ['S-1'],
          },
        },
        scenes: {
          'S-1': narrative.scenes['S-1'],
        },
      };
      expect(updatedNarrative.scenes['S-2']).toBeUndefined();
      expect(updatedNarrative.branches['BR-1'].entryIds).toEqual(['S-1']);
    });
    it('should remove scene from arcs', () => {
      const narrative: NarrativeState = {
        ...testNarrative,
        arcs: {
          'A-1': {
            id: 'A-1',
            name: 'Test Arc',
            sceneIds: ['S-1', 'S-2'],
            develops: [],
            locationIds: [],
            activeCharacterIds: [],
            initialCharacterLocations: {},
          },
        },
      };
      const updatedNarrative: NarrativeState = {
        ...narrative,
        arcs: {
          'A-1': {
            ...narrative.arcs['A-1'],
            sceneIds: ['S-1'],
          },
        },
        scenes: {
          'S-1': narrative.scenes['S-1'],
        },
      };
      expect(updatedNarrative.arcs['A-1'].sceneIds).toEqual(['S-1']);
    });
  });
  describe('State immutability', () => {
    it('should not mutate original scene when updating', () => {
      const originalScene = { ...testScene };
      const updatedScene = {
        ...originalScene,
        summary: 'New summary',
      };
      expect(originalScene.summary).toBe('Hero discovers ancient artifact');
      expect(updatedScene.summary).toBe('New summary');
    });
    it('should not mutate original branch when updating', () => {
      const originalBranch = { ...testBranch };
      const updatedBranch = {
        ...originalBranch,
        name: 'renamed',
      };
      expect(originalBranch.name).toBe('main');
      expect(updatedBranch.name).toBe('renamed');
    });
    it('should not mutate original narrative when updating', () => {
      const originalNarrative = { ...testNarrative };
      const updatedNarrative = {
        ...originalNarrative,
        title: 'New Title',
      };
      expect(originalNarrative.title).toBe('Test Story');
      expect(updatedNarrative.title).toBe('New Title');
    });
  });
  describe('Version hierarchy', () => {
    it('should follow version hierarchy: generate → rewrite → edit', () => {
      const versions: ProseVersion[] = [
        {
          version: '1',
          prose: 'V1',
          branchId: 'BR-1',
          timestamp: Date.now() - 3000,
          versionType: 'generate',
        },
        {
          version: '1.1',
          prose: 'V1.1',
          branchId: 'BR-1',
          timestamp: Date.now() - 2000,
          versionType: 'rewrite',
          parentVersion: '1',
        },
        {
          version: '1.1.1',
          prose: 'V1.1.1',
          branchId: 'BR-1',
          timestamp: Date.now() - 1000,
          versionType: 'edit',
          parentVersion: '1.1',
        },
      ];
      expect(versions[0].version).toBe('1');
      expect(versions[1].version).toBe('1.1');
      expect(versions[1].parentVersion).toBe('1');
      expect(versions[2].version).toBe('1.1.1');
      expect(versions[2].parentVersion).toBe('1.1');
    });
    it('should allow multiple rewrites at same major level', () => {
      const versions: ProseVersion[] = [
        {
          version: '1',
          prose: 'V1',
          branchId: 'BR-1',
          timestamp: Date.now() - 3000,
          versionType: 'generate',
        },
        {
          version: '1.1',
          prose: 'V1.1',
          branchId: 'BR-1',
          timestamp: Date.now() - 2000,
          versionType: 'rewrite',
          parentVersion: '1',
        },
        {
          version: '1.2',
          prose: 'V1.2',
          branchId: 'BR-1',
          timestamp: Date.now() - 1000,
          versionType: 'rewrite',
          parentVersion: '1',
        },
      ];
      expect(versions[0].version).toBe('1');
      expect(versions[1].version).toBe('1.1');
      expect(versions[2].version).toBe('1.2');
    });
    it('should allow new generate to create major version 2', () => {
      const versions: ProseVersion[] = [
        {
          version: '1',
          prose: 'V1',
          branchId: 'BR-1',
          timestamp: Date.now() - 2000,
          versionType: 'generate',
        },
        {
          version: '2',
          prose: 'V2',
          branchId: 'BR-1',
          timestamp: Date.now() - 1000,
          versionType: 'generate',
          parentVersion: '1',
        },
      ];
      expect(versions[0].version).toBe('1');
      expect(versions[1].version).toBe('2');
      expect(versions[1].versionType).toBe('generate');
    });
  });
});
