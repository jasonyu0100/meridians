import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconstructBranch, type ReconstructionProgress, type ReconstructionCallbacks } from '@/lib/ai/reconstruct';
import type { NarrativeState, Scene, Branch, StructureReview, WorldBuild } from '@/types/narrative';
// Mock all AI dependencies
vi.mock('@/lib/ai/api', () => ({
  callGenerate: vi.fn(),
  resolveReasoningBudget: vi.fn(() => 0),
  resolveWebsearch: vi.fn(() => null),
  SYSTEM_PROMPT: 'Mock system prompt',
}));
vi.mock('@/lib/ai/context', () => ({
  narrativeContext: vi.fn(() => 'Mock narrative context'),
}));
vi.mock('@/lib/ai/json', () => ({
  parseJson: vi.fn((str: string) => JSON.parse(str)),
}));
import { callGenerate } from '@/lib/ai/api';
import { parseJson } from '@/lib/ai/json';
// Helper to create minimal narrative
function createMinimalNarrative(): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test Story',
    description: 'A test story',
    worldSummary: 'A test world.',
    characters: {
      'C-1': { id: 'C-1', name: 'Hero', role: 'anchor', world: { nodes: {}, edges: [] }, threadIds: [] },
      'C-2': { id: 'C-2', name: 'Mentor', role: 'recurring', world: { nodes: {}, edges: [] }, threadIds: [] },
    },
    locations: {
      'L-1': { id: 'L-1', name: 'Village', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], world: { nodes: {}, edges: [] }, threadIds: [] },
      'L-2': { id: 'L-2', name: 'Forest', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], world: { nodes: {}, edges: [] }, threadIds: [] },
    },
    threads: {
      'T-1': { id: 'T-1', description: 'Main quest', outcomes: ["yes", "no"], stances: { narrator: { logits: [0, 0], volume: 2, volatility: 0 } }, participants: [], dependents: [], openedAt: 'S-1', threadLog: { nodes: {}, edges: [] } },
    },
    arcs: {
      'ARC-1': { id: 'ARC-1', name: 'Beginning', sceneIds: ['S-1', 'S-2', 'S-3'], develops: [], locationIds: [], activeCharacterIds: [] },
    },
    scenes: {
      'S-1': {
        kind: 'scene',
        id: 'S-1',
        arcId: 'ARC-1',
        locationId: 'L-1',
        povId: 'C-1',
        participantIds: ['C-1'],
        events: ['wakes'],
        threadDeltas: [{ threadId: 'T-1', logType: "setup", updates: [{ outcome: "yes", evidence: 1 }], volumeDelta: 1, rationale: "latent→active" }],
        worldDeltas: [],
        relationshipDeltas: [],
        summary: 'Hero wakes in village',
      },
      'S-2': {
        kind: 'scene',
        id: 'S-2',
        arcId: 'ARC-1',
        locationId: 'L-1',
        povId: 'C-1',
        participantIds: ['C-1', 'C-2'],
        events: ['meets_mentor'],
        threadDeltas: [{ threadId: 'T-1', logType: "pulse", updates: [], volumeDelta: 1, rationale: "active→active" }],
        worldDeltas: [],
        relationshipDeltas: [],
        summary: 'Hero meets mentor',
      },
      'S-3': {
        kind: 'scene',
        id: 'S-3',
        arcId: 'ARC-1',
        locationId: 'L-2',
        povId: 'C-1',
        participantIds: ['C-1'],
        events: ['enters_forest'],
        threadDeltas: [],
        worldDeltas: [],
        relationshipDeltas: [],
        summary: 'Hero enters forest',
      },
    },
    branches: {
      'BR-1': {
        id: 'BR-1',
        name: 'main',
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ['S-1', 'S-2', 'S-3'],
        createdAt: Date.now(),
      },
    },
    worldBuilds: {},
    systemGraph: { nodes: {}, edges: [] },
    relationships: [],
    artifacts: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
function createMockCallbacks(): ReconstructionCallbacks & { progress: ReconstructionProgress[]; readyScenes: Scene[]; createdBranches: Branch[] } {
  const progress: ReconstructionProgress[] = [];
  const readyScenes: Scene[] = [];
  const createdBranches: Branch[] = [];
  return {
    progress,
    readyScenes,
    createdBranches,
    onProgress: (p) => progress.push({ ...p }),
    onSceneReady: (scene) => readyScenes.push({ ...scene }),
    onBranchCreated: (branch) => createdBranches.push({ ...branch }),
  };
}
describe('reconstructBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('passes through ok scenes unchanged', async () => {
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: 'Good scene' },
        { sceneId: 'S-2', verdict: 'ok', reason: 'Good scene' },
        { sceneId: 'S-3', verdict: 'ok', reason: 'Good scene' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(result.scenes).toHaveLength(3);
    // ok scenes reuse their original IDs
    expect(result.scenes[0].id).toBe('S-1');
    expect(result.scenes[1].id).toBe('S-2');
    expect(result.scenes[2].id).toBe('S-3');
    expect(callGenerate).not.toHaveBeenCalled();
  });
  it('removes cut scenes from timeline', async () => {
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'cut', reason: 'Redundant scene' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes.map(s => s.id)).toEqual(['S-1', 'S-3']);
    expect(result.branch.entryIds).toEqual(['S-1', 'S-3']);
  });
  it('edits scenes with edit verdict via LLM', async () => {
    const editedScene = {
      locationId: 'L-2',
      povId: 'C-1',
      participantIds: ['C-1', 'C-2'],
      events: ['revised_event'],
      threadDeltas: [],
      worldDeltas: [],
      relationshipDeltas: [],
      summary: 'Revised scene with fixes',
    };
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(editedScene));
    vi.mocked(parseJson).mockReturnValue(editedScene);
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'edit', reason: 'Needs pacing fix' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(result.scenes).toHaveLength(3);
    // Edited scenes get new IDs
    expect(result.scenes[1].id).not.toBe('S-2');
    expect(result.scenes[1].summary).toBe('Revised scene with fixes');
    expect(callGenerate).toHaveBeenCalledTimes(1);
  });
  it('inserts new scenes via LLM', async () => {
    const insertedScene = {
      locationId: 'L-1',
      povId: 'C-2',
      participantIds: ['C-2'],
      events: ['new_event'],
      threadDeltas: [{ threadId: 'T-1', logType: "pulse", updates: [], volumeDelta: 1, rationale: "active→active" }],
      worldDeltas: [],
      relationshipDeltas: [],
      summary: 'New transition scene',
    };
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(insertedScene));
    vi.mocked(parseJson).mockReturnValue(insertedScene);
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'ok', reason: '' },
        { sceneId: 'INSERT-1', verdict: 'insert', reason: 'Missing transition', insertAfter: 'S-2' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(result.scenes).toHaveLength(4);
    expect(result.scenes[2].summary).toBe('New transition scene');
    expect(callGenerate).toHaveBeenCalledTimes(1);
  });
  it('moves scenes to new positions', async () => {
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'move', reason: 'Should come after S-3', moveAfter: 'S-3' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(result.scenes).toHaveLength(3);
    // S-2 moved after S-3: order is now S-1, S-3, S-2
    expect(result.scenes.map(s => s.id)).toEqual(['S-1', 'S-3', 'S-2']);
  });
  it('merges scenes via LLM', async () => {
    const mergedScene = {
      locationId: 'L-1',
      povId: 'C-1',
      participantIds: ['C-1', 'C-2'],
      events: ['combined_event'],
      threadDeltas: [{ threadId: 'T-1', logType: "setup", updates: [{ outcome: "yes", evidence: 1 }], volumeDelta: 1, rationale: "latent→active" }],
      worldDeltas: [],
      relationshipDeltas: [],
      summary: 'Combined scene with both beats',
    };
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(mergedScene));
    vi.mocked(parseJson).mockReturnValue(mergedScene);
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'merge', reason: 'Absorb into S-1', mergeInto: 'S-1' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(result.scenes).toHaveLength(2);
    // S-2 is removed, S-1 is merged
    expect(result.scenes[0].summary).toBe('Combined scene with both beats');
    expect(callGenerate).toHaveBeenCalledTimes(1);
  });
  it('creates branch with version suffix', async () => {
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'ok', reason: '' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(result.branch.name).toBe('main v2');
    expect(result.branch.parentBranchId).toBeNull(); // Root branch
  });
  it('preserves world builds in timeline order', async () => {
    const narrative = createMinimalNarrative();
    const worldBuild: WorldBuild = {
      id: 'WB-1',
      kind: 'world_build',
      summary: 'World expansion',
      expansionManifest: {
        newCharacters: [],
        newLocations: [],
        newThreads: [],
        newArtifacts: [],
        systemDeltas: { addedNodes: [], addedEdges: [] },
      },
    };
    narrative.worldBuilds['WB-1'] = worldBuild;
    // World build appears between S-1 and S-2
    narrative.branches['BR-1'].entryIds = ['S-1', 'WB-1', 'S-2', 'S-3'];
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'ok', reason: '' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'WB-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(result.branch.entryIds).toContain('WB-1');
    expect(result.branch.entryIds.indexOf('WB-1')).toBe(1);
  });
  it('invokes progress callbacks', async () => {
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'ok', reason: '' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(callbacks.progress.length).toBeGreaterThan(0);
    expect(callbacks.progress.some(p => p.phase === 'preparing')).toBe(true);
    expect(callbacks.progress.some(p => p.phase === 'done')).toBe(true);
    expect(callbacks.createdBranches).toHaveLength(1);
  });
  it('handles insert at START position', async () => {
    const insertedScene = {
      locationId: 'L-1',
      povId: 'C-1',
      participantIds: ['C-1'],
      events: ['opening'],
      threadDeltas: [],
      worldDeltas: [],
      relationshipDeltas: [],
      summary: 'Opening scene',
    };
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(insertedScene));
    vi.mocked(parseJson).mockReturnValue(insertedScene);
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'INSERT-1', verdict: 'insert', reason: 'Need an opening', insertAfter: 'START' },
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'ok', reason: '' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(result.scenes).toHaveLength(4);
    expect(result.scenes[0].summary).toBe('Opening scene');
  });
  it('handles cancellation', async () => {
    vi.mocked(callGenerate).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 10));
      return JSON.stringify({ summary: 'Should not appear' });
    });
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'edit', reason: 'Fix' },
        { sceneId: 'S-2', verdict: 'edit', reason: 'Fix' },
        { sceneId: 'S-3', verdict: 'edit', reason: 'Fix' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    // Cancel immediately
    const promise = reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    cancelledRef.current = true;
    const result = await promise;
    // Should still return a result but with partial work
    expect(result.branch).toBeDefined();
    expect(result.scenes).toBeDefined();
  });
  it('handles edit failures gracefully', async () => {
    vi.mocked(callGenerate).mockRejectedValue(new Error('LLM failed'));
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'edit', reason: 'Fix pacing' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    // Should complete without throwing even when LLM operations fail
    expect(result.scenes).toHaveLength(3);
  });
  it('updates arc sceneIds after reconstruction', async () => {
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'cut', reason: 'Remove' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(result.arcs['ARC-1'].sceneIds).toEqual(['S-1', 'S-3']);
  });
  it('increments version when branch already has version suffix', async () => {
    const narrative = createMinimalNarrative();
    narrative.branches['BR-1'].name = 'main v2';
    narrative.branches['BR-2'] = {
      id: 'BR-2',
      name: 'main v3',
      parentBranchId: null,
      forkEntryId: null,
      entryIds: [],
      createdAt: Date.now(),
    };
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'ok', reason: '' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(result.branch.name).toBe('main v4');
  });
  it('includes thematic question in edit prompts', async () => {
    const editedScene = { summary: 'Edited' };
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(editedScene));
    vi.mocked(parseJson).mockReturnValue(editedScene);
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'edit', reason: 'Fix' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: ['Hero always wins', 'Mentor gives advice'],
      thematicQuestion: 'What defines true courage?',
      overall: 'Story lacks tension',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    const promptArg = vi.mocked(callGenerate).mock.calls[0]![0];
    expect(promptArg).toContain('What defines true courage?');
    expect(promptArg).toContain('Hero always wins');
  });
  it('chains inserts correctly (INSERT-2 after INSERT-1)', async () => {
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ summary: 'First insert' }))
      .mockResolvedValueOnce(JSON.stringify({ summary: 'Second insert' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ summary: 'First insert' })
      .mockReturnValueOnce({ summary: 'Second insert' });
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'INSERT-1', verdict: 'insert', reason: 'First insert', insertAfter: 'S-1' },
        { sceneId: 'INSERT-2', verdict: 'insert', reason: 'Second insert', insertAfter: 'INSERT-1' },
        { sceneId: 'S-2', verdict: 'ok', reason: '' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    expect(result.scenes).toHaveLength(5);
    // Order: S-1, INSERT-1, INSERT-2, S-2, S-3
    expect(result.scenes[0].id).toBe('S-1');
    expect(result.scenes[1].summary).toBe('First insert');
    expect(result.scenes[2].summary).toBe('Second insert');
    expect(result.scenes[3].id).toBe('S-2');
  });
  // ── Thread log preservation through reconstruction ────────────────────────
  // Locks in the fix for the bug where the reconstruct schemas omitted
  // addedNodes, causing the LLM to strip log entries from edited/merged/
  // inserted scenes.
  it('preserves market evidence from LLM when editing a scene', async () => {
    const editedScene = {
      locationId: 'L-2',
      povId: 'C-1',
      participantIds: ['C-1'],
      events: ['revised'],
      threadDeltas: [{
        threadId: 'T-1',
        logType: 'escalation',
        updates: [{ outcome: 'yes', evidence: 3 }],
        volumeDelta: 2,
        rationale: 'Hero commits to the final stand, stakes rise',
      }],
      worldDeltas: [],
      relationshipDeltas: [],
      summary: 'Revised scene with market evidence',
    };
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(editedScene));
    vi.mocked(parseJson).mockReturnValue(editedScene);
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'edit', reason: 'Needs stakes' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    // The edited scene must still carry its log entries — before the
    // schema fix, the LLM would return threadDeltas without addedNodes
    // and the scene's thread log would go blank.
    const edited = result.scenes.find((s) => s.summary === 'Revised scene with market evidence');
    expect(edited).toBeDefined();
    expect(edited!.threadDeltas).toHaveLength(1);
    expect(edited!.threadDeltas[0].logType).toBe('escalation');
    expect(edited!.threadDeltas[0].updates).toHaveLength(1);
    expect(edited!.threadDeltas[0].updates[0].evidence).toBe(3);
    expect(edited!.threadDeltas[0].rationale).toMatch(/commits to the final stand/);
  });
  it('preserves market evidence from LLM when inserting a new scene', async () => {
    const insertedScene = {
      locationId: 'L-1',
      povId: 'C-2',
      participantIds: ['C-2'],
      events: ['bridge_beat'],
      threadDeltas: [{
        threadId: 'T-1',
        logType: 'pulse',
        updates: [],
        volumeDelta: 1,
        rationale: 'Mentor checks in on the hero',
      }],
      worldDeltas: [],
      relationshipDeltas: [],
      summary: 'Inserted transition scene',
    };
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(insertedScene));
    vi.mocked(parseJson).mockReturnValue(insertedScene);
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-1',
      sceneEvals: [
        { sceneId: 'S-1', verdict: 'ok', reason: '' },
        { sceneId: 'S-2', verdict: 'ok', reason: '' },
        { sceneId: 'INSERT-1', verdict: 'insert', reason: 'Missing bridge', insertAfter: 'S-2' },
        { sceneId: 'S-3', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };
    const result = await reconstructBranch(
      narrative,
      ['S-1', 'S-2', 'S-3'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    const inserted = result.scenes.find((s) => s.summary === 'Inserted transition scene');
    expect(inserted).toBeDefined();
    expect(inserted!.threadDeltas).toHaveLength(1);
    expect(inserted!.threadDeltas[0].logType).toBe('pulse');
    expect(inserted!.threadDeltas[0].rationale).toMatch(/Mentor checks in/);
  });
});
