import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import type { AnalysisJob, AnalysisChunkResult, NarrativeState } from '@/types/narrative';
// Mock dependencies — new scene-first pipeline
vi.mock('@/lib/text-analysis', () => ({
  extractSceneStructure: vi.fn(),
  groupScenesIntoArcs: vi.fn(),
  reconcileResults: vi.fn(),
  analyzeThreading: vi.fn(),
  assembleNarrative: vi.fn(),
  reextractFateWithLifecycle: vi.fn(async (results: AnalysisChunkResult[]) => results),
}));
vi.mock('@/lib/ai/scenes', () => ({
  reverseEngineerScenePlan: vi.fn(),
}));
vi.mock('@/lib/ai/game-analysis', () => ({
  generateSceneGameAnalysis: vi.fn(),
}));
vi.mock('@/lib/constants', () => ({
  ANALYSIS_CONCURRENCY: 3,
  ANALYSIS_STAGGER_DELAY_MS: 10,
}));
vi.mock('@/lib/system-logger', () => ({
  logError: vi.fn(),
  logWarning: vi.fn(),
  logInfo: vi.fn(),
  setSystemLoggerNarrativeId: vi.fn(),
  setSystemLoggerAnalysisId: vi.fn(),
  onSystemLog: vi.fn(),
}));
vi.mock('@/lib/api-logger', () => ({
  setLoggerAnalysisId: vi.fn(),
  onApiLog: vi.fn(),
  onApiLogUpdate: vi.fn(),
}));
// Mock embedding modules (dynamically imported in runner)
vi.mock('@/lib/embeddings', () => ({
  embedPropositions: vi.fn(async (props: any[]) => props.map((p: any) => ({ ...p }))),
  generateEmbeddingsBatch: vi.fn(async (texts: string[]) => texts.map(() => new Array(1536).fill(0))),
  computeCentroid: vi.fn(() => new Array(1536).fill(0)),
}));
vi.mock('@/lib/asset-manager', () => ({
  assetManager: {
    getEmbedding: vi.fn(async () => new Array(1536).fill(0)),
    storeEmbedding: vi.fn(async () => 'emb-ref-123'),
  },
}));
import { extractSceneStructure, groupScenesIntoArcs, reconcileResults, analyzeThreading, reextractFateWithLifecycle, assembleNarrative } from '@/lib/text-analysis';
import { reverseEngineerScenePlan } from '@/lib/ai/scenes';
import { generateSceneGameAnalysis } from '@/lib/ai/game-analysis';
import { analysisRunner } from '@/lib/analysis-runner';
const mockNarrative: NarrativeState = {
  id: 'narrative-1',
  title: 'Test Narrative',
  description: '',
  worldSummary: '',
  characters: {},
  locations: {},
  threads: {},
  arcs: {},
  scenes: {},
  branches: {},
  worldBuilds: {},
  systemGraph: { nodes: {}, edges: [] },
  relationships: [],
  artifacts: {},
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
const mockStructureResult = {
  povName: 'Alice',
  locationName: 'Castle',
  participantNames: ['Alice'],
  events: ['event_1'],
  summary: 'Alice explores the castle.',
  characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true, continuity: [] }],
  locations: [{ name: 'Castle', parentName: null, description: 'A grand castle', lore: [] }],
  artifacts: [],
  threads: [{ description: 'Exploration', participantNames: ['Alice'], outcomes: ["yes", "no"], development: 'Started' }],
  relationships: [],
  threadDeltas: [{ threadDescription: 'Exploration', logType: 'setup', updates: [{ outcome: 'yes', evidence: 1 }], volumeDelta: 1, rationale: 'opened' }],
  worldDeltas: [],
  relationshipDeltas: [],
  artifactUsages: [],
  ownershipDeltas: [],
  tieDeltas: [],
};
// Speed up tests: eliminate all setTimeout delays (retries, backoffs, afterEach cleanup)
const origSetTimeout = globalThis.setTimeout;
beforeAll(() => {
  globalThis.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number, ...args: unknown[]) => {
    return origSetTimeout(fn, 0, ...args);
  }) as typeof globalThis.setTimeout;
});
afterAll(() => {
  globalThis.setTimeout = origSetTimeout;
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reverseEngineerScenePlan).mockResolvedValue({
    plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'Test beat', propositions: [] }] },
    beatProseMap: { chunks: [], createdAt: Date.now() },
  });
  vi.mocked(extractSceneStructure).mockResolvedValue(mockStructureResult);
  vi.mocked(groupScenesIntoArcs).mockResolvedValue([
    { name: 'The Beginning', sceneIndices: [0, 1] },
  ]);
  vi.mocked(reconcileResults).mockImplementation(async (results) => results);
  vi.mocked(analyzeThreading).mockResolvedValue({});
  vi.mocked(assembleNarrative).mockResolvedValue(mockNarrative);
  vi.mocked(generateSceneGameAnalysis).mockResolvedValue({
    generatedAt: Date.now(),
    games: [
      {
        beatIndex: 0,
        beatExcerpt: 'They paused before answering.',
        gameType: 'coordination',
        actionAxis: 'trust',
        playerAId: 'C-1',
        playerAName: 'Alice',
        playerAActions: [{ name: 'cooperate' }, { name: 'defect' }],
        playerBId: 'C-2',
        playerBName: 'Bob',
        playerBActions: [{ name: 'cooperate' }, { name: 'defect' }],
        outcomes: [
          { aActionName: 'cooperate', bActionName: 'cooperate', stakeDeltaA: 2, stakeDeltaB: 2, description: 'mutual win' },
          { aActionName: 'cooperate', bActionName: 'defect', stakeDeltaA: -1, stakeDeltaB: 3, description: 'A betrayed' },
          { aActionName: 'defect', bActionName: 'cooperate', stakeDeltaA: 3, stakeDeltaB: -1, description: 'B betrayed' },
          { aActionName: 'defect', bActionName: 'defect', stakeDeltaA: 0, stakeDeltaB: 0, description: 'standoff' },
        ],
        realizedAAction: 'cooperate',
        realizedBAction: 'cooperate',
        rationale: 'They worked together.',
      },
    ],
  });
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 10));
});
// ── Fixtures ────────────────────────────────────────────────────────────────
let jobCounter = 0;
function createMockJob(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    id: `JOB-${++jobCounter}`,
    title: 'Test Analysis',
    sourceText: 'Sample text for analysis',
    chunks: [
      { index: 0, text: 'Scene 1 prose text here with enough words.', sectionCount: 12 },
      { index: 1, text: 'Scene 2 prose text here with enough words.', sectionCount: 12 },
    ],
    results: [null, null],
    status: 'pending',
    currentChunkIndex: 0,
    // Plans are now opt-in at the job level. The runner skips Phase 2
    // unless this flag is set, so the pipeline tests that assert on
    // plan extraction need to flip it on explicitly.
    runPlanExtraction: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}
function collectDispatches(dispatch: (action: any) => void): any[] {
  const dispatched: any[] = [];
  const wrapper = (action: any) => { dispatched.push(action); dispatch(action); };
  return [dispatched, wrapper] as any;
}
// ══════════════════════════════════════════════════════════════════════════════
// Full Pipeline
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Full Pipeline', () => {
  it('completes all 6 phases: plans → structure → arcs → reconcile → finalize → assemble', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));
    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(2);
    expect(extractSceneStructure).toHaveBeenCalledTimes(2);
    expect(groupScenesIntoArcs).toHaveBeenCalledTimes(1);
    expect(reconcileResults).toHaveBeenCalledTimes(1);
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
    const statusUpdates = dispatched.filter(a => a.type === 'UPDATE_ANALYSIS_JOB').map(a => a.updates);
    expect(statusUpdates.some(u => u.phase === 'plans')).toBe(true);
    expect(statusUpdates.some(u => u.phase === 'structure')).toBe(true);
    expect(statusUpdates.some(u => u.phase === 'arcs')).toBe(true);
    expect(statusUpdates.some(u => u.phase === 'reconciliation')).toBe(true);
    expect(statusUpdates.some(u => u.phase === 'assembly')).toBe(true);
    expect(statusUpdates.some(u => u.status === 'completed')).toBe(true);
  });
  it('dispatches ADD_NARRATIVE on successful completion', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));
    const addNarrative = dispatched.find(a => a.type === 'ADD_NARRATIVE');
    expect(addNarrative).toBeDefined();
    expect(addNarrative.narrative.id).toBe('narrative-1');
  });
  it('sets status to running at start', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));
    const first = dispatched[0];
    expect(first.type).toBe('UPDATE_ANALYSIS_JOB');
    expect(first.updates.status).toBe('running');
  });
  it('sets narrativeId on completion', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));
    const completed = dispatched.find(a => a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.status === 'completed');
    expect(completed).toBeDefined();
    expect(completed.updates.narrativeId).toBe('narrative-1');
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Phase 1: Plans
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Phase 1: Plans', () => {
  it('skips scenes that already have plans', async () => {
    const job = createMockJob({
      results: [
        {
          chapterSummary: 'Already done',
          characters: [],
          locations: [],
          threads: [],
          scenes: [{
            locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
            events: ['event'], summary: 'Existing', sections: [],
            prose: 'Existing prose',
            plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'existing', propositions: [] }] },
            threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
          }],
          relationships: [],
        },
        null,
      ],
    });
    await analysisRunner.start(job, () => {});
    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(1);
  });
  it('handles plan extraction failure gracefully — pipeline continues', async () => {
    vi.mocked(reverseEngineerScenePlan).mockRejectedValue(new Error('LLM failed'));
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));
    // Pipeline continues despite plan failures
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
    const completed = dispatched.find(a => a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.status === 'completed');
    expect(completed).toBeDefined();
  });
  it('initializes result with plan + prose after successful extraction', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    // reconcileResults receives results with plans populated
    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    // At least the successfully planned scenes should have plans
    const withPlans = reconciledInput.filter(r => r.scenes?.[0]?.plan);
    expect(withPlans.length).toBeGreaterThan(0);
  });
  it('stores prose text from chunk in plan result', async () => {
    const job = createMockJob({
      chunks: [{ index: 0, text: 'Specific prose content for testing.', sectionCount: 12 }],
      results: [null],
    });
    await analysisRunner.start(job, () => {});
    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    expect(reconciledInput[0].scenes[0].prose).toBe('Specific prose content for testing.');
  });
  it('skips plan extraction when runPlanExtraction is not set (default opt-in)', async () => {
    // createMockJob defaults runPlanExtraction:true; override to false
    // to exercise the opt-in semantics — phase 2 should NOT call
    // reverseEngineerScenePlan, and reconcile should still run on
    // structure-only results.
    const job = createMockJob({ runPlanExtraction: false });
    await analysisRunner.start(job, () => {});
    expect(reverseEngineerScenePlan).not.toHaveBeenCalled();
    expect(reconcileResults).toHaveBeenCalledTimes(1);
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Game theory (opt-in Phase 7)
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Game theory (opt-in)', () => {
  it('does NOT run the game-theory pass by default', async () => {
    // Default job has runGameTheoryExtraction unset → analyser must
    // not be called even though scenes exist on the assembled narrative.
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    expect(generateSceneGameAnalysis).not.toHaveBeenCalled();
  });
  it('runs the analyser once per assembled scene when opted in', async () => {
    // Make assembleNarrative return a narrative with two scenes so the
    // game-theory pass has work to do. Each scene should receive its
    // own analyser invocation; mutation lands on scene.gameAnalysis.
    const sceneA = { kind: 'scene' as const, id: 'S-1', summary: 's1', povId: 'C-1', locationId: 'L-1', participantIds: [], events: [], threadDeltas: [], worldDeltas: [], relationshipDeltas: [], arcId: 'A-1' };
    const sceneB = { ...sceneA, id: 'S-2', summary: 's2' };
    vi.mocked(assembleNarrative).mockResolvedValueOnce({
      ...mockNarrative,
      scenes: { 'S-1': sceneA, 'S-2': sceneB },
    } as NarrativeState);
    const job = createMockJob({ runGameTheoryExtraction: true });
    await analysisRunner.start(job, () => {});
    expect(generateSceneGameAnalysis).toHaveBeenCalledTimes(2);
  });
  it('emits a game-theory phase update when opted in', async () => {
    const sceneA = { kind: 'scene' as const, id: 'S-1', summary: 's1', povId: 'C-1', locationId: 'L-1', participantIds: [], events: [], threadDeltas: [], worldDeltas: [], relationshipDeltas: [], arcId: 'A-1' };
    vi.mocked(assembleNarrative).mockResolvedValueOnce({
      ...mockNarrative,
      scenes: { 'S-1': sceneA },
    } as NarrativeState);
    const job = createMockJob({ runGameTheoryExtraction: true });
    const dispatched: any[] = [];
    await analysisRunner.start(job, (a) => dispatched.push(a));
    const phaseUpdate = dispatched.find(
      (a) => a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.phase === 'game-theory',
    );
    expect(phaseUpdate).toBeDefined();
  });
  it('tolerates per-scene analyser failure without breaking the pipeline', async () => {
    const sceneA = { kind: 'scene' as const, id: 'S-1', summary: 's1', povId: 'C-1', locationId: 'L-1', participantIds: [], events: [], threadDeltas: [], worldDeltas: [], relationshipDeltas: [], arcId: 'A-1' };
    vi.mocked(assembleNarrative).mockResolvedValueOnce({
      ...mockNarrative,
      scenes: { 'S-1': sceneA },
    } as NarrativeState);
    vi.mocked(generateSceneGameAnalysis).mockRejectedValueOnce(new Error('boom'));
    const job = createMockJob({ runGameTheoryExtraction: true });
    const dispatched: any[] = [];
    await analysisRunner.start(job, (a) => dispatched.push(a));
    const completed = dispatched.find(
      (a) => a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.status === 'completed',
    );
    expect(completed).toBeDefined();
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Phase 2: Structure
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Phase 2: Structure', () => {
  it('extracts structure for scenes with plans', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    expect(extractSceneStructure).toHaveBeenCalledTimes(2);
  });
  it('passes structure results to reconciliation', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    expect(reconciledInput.length).toBe(2);
    // Structure phase populates chapterSummary from structure result
    expect(reconciledInput[0].chapterSummary).toBe('Alice explores the castle.');
  });
  it('populates scene deltas from structure result', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    const scene = reconciledInput[0].scenes[0];
    expect(scene.povName).toBe('Alice');
    expect(scene.locationName).toBe('Castle');
    expect(scene.threadDeltas).toHaveLength(1);
    expect(scene.threadDeltas[0].threadDescription).toBe('Exploration');
  });
  it('populates chunk-level entities from structure result', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    expect(reconciledInput[0].characters).toHaveLength(1);
    expect(reconciledInput[0].characters[0].name).toBe('Alice');
    expect(reconciledInput[0].locations).toHaveLength(1);
    expect(reconciledInput[0].threads).toHaveLength(1);
  });
  it('handles structure extraction failure gracefully — pipeline continues', async () => {
    vi.mocked(extractSceneStructure).mockRejectedValue(new Error('LLM failed'));
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    // Pipeline continues — assembly still runs
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
  });
  it('still attempts structure even when plans fail — uses prose alone', async () => {
    vi.mocked(reverseEngineerScenePlan).mockRejectedValue(new Error('All plans failed'));
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    // Structure extraction is attempted (with prose, plan may be null)
    expect(extractSceneStructure).toHaveBeenCalled();
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Phase 3: Arcs
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Phase 3: Arcs', () => {
  it('passes scene summaries to arc grouping', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    expect(groupScenesIntoArcs).toHaveBeenCalledTimes(1);
    const args = vi.mocked(groupScenesIntoArcs).mock.calls[0][0];
    expect(args.length).toBe(2);
    // Summaries come from structure extraction
    expect(args[0].summary).toBe('Alice explores the castle.');
  });
  it('falls back to default arc names on grouping failure', async () => {
    vi.mocked(groupScenesIntoArcs).mockRejectedValue(new Error('LLM failed'));
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    // Assembly still runs — arcGroups passed to assembleNarrative
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
    // Runner now uses the options-object overload — arcGroups lives there.
    const opts = vi.mocked(assembleNarrative).mock.calls[0][3] as { arcGroups?: { name: string; sceneIndices: number[] }[] } | undefined;
    const arcGroups = opts?.arcGroups;
    // Fallback creates "Arc 1", "Arc 2", etc.
    expect(arcGroups).toBeDefined();
    expect(arcGroups![0].name).toMatch(/^Arc \d+$/);
  });
  it('stores arc groups on job for assembly', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    // Runner now uses the options-object overload — arcGroups lives there.
    const opts = vi.mocked(assembleNarrative).mock.calls[0][3] as { arcGroups?: { name: string; sceneIndices: number[] }[] } | undefined;
    const arcGroups = opts?.arcGroups;
    expect(arcGroups).toBeDefined();
    expect(arcGroups![0].name).toBe('The Beginning');
    expect(arcGroups![0].sceneIndices).toEqual([0, 1]);
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Phase 4: Reconciliation
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Phase 4: Reconciliation', () => {
  it('passes non-null results to reconciliation', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    // Should filter out null results
    expect(reconciledInput.every(r => r !== null)).toBe(true);
  });
  it('updates results array with reconciled data', async () => {
    const reconciledResult: AnalysisChunkResult = {
      chapterSummary: 'RECONCILED',
      characters: [], locations: [], threads: [],
      scenes: [{ locationName: '', povName: '', participantNames: [], events: [], summary: '', sections: [], threadDeltas: [], worldDeltas: [], relationshipDeltas: [] }],
      relationships: [],
    };
    vi.mocked(reconcileResults).mockResolvedValue([reconciledResult, reconciledResult]);
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));
    // Results should be updated after reconciliation
    const resultUpdates = dispatched.filter(a => a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.results);
    expect(resultUpdates.length).toBeGreaterThan(0);
  });
  it('handles reconciliation failure gracefully — uses raw results', async () => {
    vi.mocked(reconcileResults).mockRejectedValue(new Error('Reconciliation failed'));
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    // Assembly still runs with unreconciled data
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Phase 5: Finalization
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Phase 5: Finalization', () => {
  it('dispatches finalization phase update', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));
    const finalizationUpdate = dispatched.find(a =>
      a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.phase === 'finalization'
    );
    expect(finalizationUpdate).toBeDefined();
  });
  it('calls analyzeThreading with unique thread descriptions', async () => {
    // Setup: structure returns 2 threads across 2 scenes
    vi.mocked(extractSceneStructure).mockResolvedValue({
      ...mockStructureResult,
      threads: [
        { description: 'Quest A', participantNames: ['Alice'], outcomes: ["yes", "no"], development: 'Started' },
        { description: 'Quest B', participantNames: ['Alice'], outcomes: ["yes", "no"], development: 'Also started' },
      ],
    });
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    expect(analyzeThreading).toHaveBeenCalledTimes(1);
    const threads = vi.mocked(analyzeThreading).mock.calls[0][0];
    expect(threads).toContain('Quest A');
    expect(threads).toContain('Quest B');
  });
  it('skips analyzeThreading when fewer than 2 unique threads', async () => {
    // Only 1 unique thread across all results
    vi.mocked(extractSceneStructure).mockResolvedValue({
      ...mockStructureResult,
      threads: [{ description: 'Only Thread', participantNames: ['Alice'], outcomes: ["yes", "no"], development: 'Started' }],
    });
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    // analyzeThreading should not be called (< 2 threads)
    expect(analyzeThreading).not.toHaveBeenCalled();
  });
  it('handles finalization failure gracefully', async () => {
    vi.mocked(analyzeThreading).mockRejectedValue(new Error('Thread analysis failed'));
    vi.mocked(extractSceneStructure).mockResolvedValue({
      ...mockStructureResult,
      threads: [
        { description: 'A', participantNames: ['Alice'], outcomes: ["yes", "no"], development: '' },
        { description: 'B', participantNames: ['Alice'], outcomes: ["yes", "no"], development: '' },
      ],
    });
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    // Assembly still runs
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
  });
  it('passes thread dependencies to assembly', async () => {
    const deps = { 'Quest B': ['Quest A'] };
    vi.mocked(analyzeThreading).mockResolvedValue(deps);
    vi.mocked(extractSceneStructure).mockResolvedValue({
      ...mockStructureResult,
      threads: [
        { description: 'Quest A', participantNames: ['Alice'], outcomes: ["yes", "no"], development: '' },
        { description: 'Quest B', participantNames: ['Alice'], outcomes: ["yes", "no"], development: '' },
      ],
    });
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    const threadDepsArg = vi.mocked(assembleNarrative).mock.calls[0][2];
    expect(threadDepsArg).toEqual(deps);
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Phase 6: Assembly
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Phase 6: Assembly', () => {
  it('dispatches assembly phase update', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));
    const assemblyUpdate = dispatched.find(a =>
      a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.phase === 'assembly'
    );
    expect(assemblyUpdate).toBeDefined();
  });
  it('passes title and completed results to assembleNarrative', async () => {
    const job = createMockJob({ title: 'My Book' });
    await analysisRunner.start(job, () => {});
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
    const [title, results] = vi.mocked(assembleNarrative).mock.calls[0];
    expect(title).toBe('My Book');
    expect(results.length).toBe(2);
  });
  it('marks job as failed when assembly throws', async () => {
    vi.mocked(assembleNarrative).mockRejectedValue(new Error('Assembly exploded'));
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));
    const failedUpdate = dispatched.find(a =>
      a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.status === 'failed'
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate.updates.error).toBe('Assembly exploded');
    // ADD_NARRATIVE should NOT be dispatched
    const addNarrative = dispatched.find(a => a.type === 'ADD_NARRATIVE');
    expect(addNarrative).toBeUndefined();
  });
  it('filters null results before passing to assembly', async () => {
    // One plan fails, so one result stays null
    let callCount = 0;
    vi.mocked(reverseEngineerScenePlan).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('First plan failed');
      return { plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'Test', propositions: [] }] }, beatProseMap: { chunks: [], createdAt: Date.now() } };
    });
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    const results = vi.mocked(assembleNarrative).mock.calls[0][1];
    // Should only contain non-null results
    expect(results.every(r => r !== null)).toBe(true);
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Cancellation & Lifecycle
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Cancellation & Lifecycle', () => {
  it('pauses job when cancelled during plans phase', async () => {
    vi.mocked(reverseEngineerScenePlan).mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 100))
    );
    const job = createMockJob({
      chunks: Array.from({ length: 10 }, (_, i) => ({ index: i, text: `Scene ${i}`, sectionCount: 12 })),
      results: Array(10).fill(null),
    });
    const dispatched: any[] = [];
    const promise = analysisRunner.start(job, (action) => dispatched.push(action));
    await new Promise(resolve => setTimeout(resolve, 20));
    analysisRunner.pause(job.id);
    await promise;
    const statusUpdates = dispatched.filter(a => a.type === 'UPDATE_ANALYSIS_JOB').map(a => a.updates);
    expect(statusUpdates.some(u => u.status === 'paused')).toBe(true);
  });
  it('pauses job when cancelled between phases', async () => {
    // Make plan extraction complete quickly but cancel before structure
    vi.mocked(reverseEngineerScenePlan).mockImplementation(async () => {
      return { plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'Test', propositions: [] }] }, beatProseMap: { chunks: [], createdAt: Date.now() } };
    });
    // Cancel during structure phase
    vi.mocked(extractSceneStructure).mockImplementation(async () => {
      // Signal cancellation immediately
      return mockStructureResult;
    });
    const job = createMockJob();
    const dispatched: any[] = [];
    // Start and immediately pause after plans complete
    const promise = analysisRunner.start(job, (action) => {
      dispatched.push(action);
      // Cancel after plans phase completes and structure phase starts
      if ((action as any).updates?.phase === 'structure') {
        analysisRunner.pause(job.id);
      }
    });
    await promise;
    const statusUpdates = dispatched.filter(a => a.type === 'UPDATE_ANALYSIS_JOB').map(a => a.updates);
    expect(statusUpdates.some(u => u.status === 'paused')).toBe(true);
    // Assembly should NOT have run
    expect(assembleNarrative).not.toHaveBeenCalled();
  });
  it('does not start a duplicate job', async () => {
    // Make first job take long
    vi.mocked(reverseEngineerScenePlan).mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 200))
    );
    const job = createMockJob();
    const dispatched: any[] = [];
    const promise1 = analysisRunner.start(job, (action) => dispatched.push(action));
    // Try to start same job again
    await analysisRunner.start(job, () => {});
    analysisRunner.pause(job.id);
    await promise1;
    // reverseEngineerScenePlan should only be called from the first start
    // (the second start is a no-op)
  });
  it('cleans up after completion', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    // After completion, runner should not report as running
    expect(analysisRunner.isRunning(job.id)).toBe(false);
    expect(analysisRunner.getStreamText(job.id)).toBe('');
    expect(analysisRunner.getInFlightIndices(job.id)).toEqual([]);
  });
  it('cleans up after failure', async () => {
    vi.mocked(assembleNarrative).mockRejectedValue(new Error('Fatal'));
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    expect(analysisRunner.isRunning(job.id)).toBe(false);
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Event System
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Event System', () => {
  it('emits stream events during pipeline', async () => {
    const streamTexts: string[] = [];
    const unsub = analysisRunner.onStream((jobId, text) => {
      streamTexts.push(text);
    });
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    unsub();
    // Should have emitted stream events for plans, structure, arcs, reconciliation, assembly
    expect(streamTexts.length).toBeGreaterThan(0);
    expect(streamTexts.some(t => t.includes('Plans'))).toBe(true);
    expect(streamTexts.some(t => t.includes('Structure'))).toBe(true);
  });
  it('listener can be unsubscribed', async () => {
    const streamTexts: string[] = [];
    const unsub = analysisRunner.onStream((jobId, text) => {
      streamTexts.push(text);
    });
    unsub();
    const job = createMockJob();
    await analysisRunner.start(job, () => {});
    // Should not have received any events after unsubscribing
    expect(streamTexts).toHaveLength(0);
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Concurrency
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Concurrency', () => {
  it('respects concurrency limit for plan extraction', async () => {
    let maxConcurrent = 0;
    let current = 0;
    vi.mocked(reverseEngineerScenePlan).mockImplementation(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise(resolve => setTimeout(resolve, 20));
      current--;
      return { plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'Test', propositions: [] }] }, beatProseMap: { chunks: [], createdAt: Date.now() } };
    });
    const job = createMockJob({
      chunks: Array.from({ length: 10 }, (_, i) => ({ index: i, text: `Scene ${i} prose`, sectionCount: 12 })),
      results: Array(10).fill(null),
    });
    await analysisRunner.start(job, () => {});
    // ANALYSIS_CONCURRENCY is mocked to 3
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });
  it('processes all scenes even with concurrency limit', async () => {
    const job = createMockJob({
      chunks: Array.from({ length: 6 }, (_, i) => ({ index: i, text: `Scene ${i} prose`, sectionCount: 12 })),
      results: Array(6).fill(null),
    });
    await analysisRunner.start(job, () => {});
    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(6);
    // Structure also runs for each successfully planned scene
    expect(extractSceneStructure).toHaveBeenCalledTimes(6);
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Edge Cases
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Edge Cases', () => {
  it('handles job with single chunk', async () => {
    const job = createMockJob({
      chunks: [{ index: 0, text: 'Only scene.', sectionCount: 5 }],
      results: [null],
    });
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));
    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(1);
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
    expect(dispatched.some(a => a.type === 'ADD_NARRATIVE')).toBe(true);
  });
  it('handles job where all plan extractions fail', async () => {
    vi.mocked(reverseEngineerScenePlan).mockRejectedValue(new Error('All fail'));
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));
    // Pipeline still completes (assembly with empty data)
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
    expect(dispatched.some(a => a.updates?.status === 'completed')).toBe(true);
  });
  it('handles partial results from prior run', async () => {
    const existingResult: AnalysisChunkResult = {
      chapterSummary: 'Already analyzed',
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true }],
      locations: [],
      threads: [{ description: 'Thread', participantNames: ['Alice'], outcomes: ["yes", "no"], development: 'Done' }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Done', sections: [], prose: 'Done prose',
        plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'done', propositions: [] }] },
        threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
      }],
      relationships: [],
    };
    const job = createMockJob({
      results: [existingResult, null], // First chunk done, second pending
    });
    await analysisRunner.start(job, () => {});
    // Only second chunk needs plan extraction
    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(1);
    // But structure extraction skips scene 0 too (already has chapterSummary)
    // Scene 1 gets structure extraction
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
  });
  it('dispatches progress updates during parallel plan phase', async () => {
    const job = createMockJob({
      chunks: Array.from({ length: 4 }, (_, i) => ({ index: i, text: `Scene ${i}`, sectionCount: 12 })),
      results: Array(4).fill(null),
    });
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));
    // Should have multiple result updates as scenes complete
    const resultUpdates = dispatched.filter(a =>
      a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.results
    );
    expect(resultUpdates.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Resume — phases that have already produced their canonical output skip on
// re-run. Each phase's completion marker on the AnalysisJob doubles as the
// resume guard.
// ══════════════════════════════════════════════════════════════════════════════
describe('AnalysisRunner — Resume from partial progress', () => {
  it('skips arc grouping when arcGroups already on the job', async () => {
    const job = createMockJob({
      arcGroups: [{ name: 'Pre-existing Arc', sceneIndices: [0, 1] }],
    });
    await analysisRunner.start(job, () => {});
    expect(groupScenesIntoArcs).not.toHaveBeenCalled();
    // Assembly still receives the persisted groups verbatim.
    const opts = vi.mocked(assembleNarrative).mock.calls[0][3] as { arcGroups?: { name: string; sceneIndices: number[] }[] } | undefined;
    expect(opts?.arcGroups?.[0].name).toBe('Pre-existing Arc');
  });

  it('skips reconciliation when reconciledAt is set', async () => {
    const job = createMockJob({
      reconciledAt: Date.now() - 60_000,
    });
    await analysisRunner.start(job, () => {});
    expect(reconcileResults).not.toHaveBeenCalled();
  });

  it('skips fate re-extract when fateReextractedAt is set', async () => {
    const job = createMockJob({
      fateReextractedAt: Date.now() - 60_000,
    });
    await analysisRunner.start(job, () => {});
    expect(reextractFateWithLifecycle).not.toHaveBeenCalled();
  });

  it('skips thread-deps LLM when threadDependencies already on the job', async () => {
    const job = createMockJob({
      threadDependencies: { 'T-1': ['T-2'] },
    });
    await analysisRunner.start(job, () => {});
    expect(analyzeThreading).not.toHaveBeenCalled();
  });

  it('passes worldBuildSummaries + meta through to assembly when persisted', async () => {
    const job = createMockJob({
      worldBuildSummaries: { 'WB-TST-1': 'persisted summary' },
      meta: { imageStyle: 'persisted-style', patterns: ['p1'] },
    });
    await analysisRunner.start(job, () => {});
    const opts = vi.mocked(assembleNarrative).mock.calls[0][3] as {
      worldBuildSummaries?: Record<string, string>;
      meta?: { imageStyle?: string; patterns?: string[] };
    } | undefined;
    expect(opts?.worldBuildSummaries?.['WB-TST-1']).toBe('persisted summary');
    expect(opts?.meta?.imageStyle).toBe('persisted-style');
  });

  it('full resume: every cross-chunk phase is skipped when all markers set', async () => {
    const job = createMockJob({
      // Per-chunk done (chapterSummary + plan present) so structure/plans skip.
      results: [
        {
          chapterSummary: 'done',
          characters: [], locations: [], threads: [],
          scenes: [{
            locationName: 'X', povName: 'Y', participantNames: [], events: [], summary: 'done',
            sections: [], prose: 'p',
            plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'd', propositions: [] }] },
            threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
          }],
          relationships: [],
        },
        {
          chapterSummary: 'done',
          characters: [], locations: [], threads: [],
          scenes: [{
            locationName: 'X', povName: 'Y', participantNames: [], events: [], summary: 'done',
            sections: [], prose: 'p',
            plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'd', propositions: [] }] },
            threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
          }],
          relationships: [],
        },
      ],
      arcGroups: [{ name: 'Done', sceneIndices: [0, 1] }],
      reconciledAt: 1,
      fateReextractedAt: 1,
      threadDependencies: { 'T-1': [] },
    });
    await analysisRunner.start(job, () => {});
    // Only assembly runs — every LLM-bearing phase is skipped.
    expect(reverseEngineerScenePlan).not.toHaveBeenCalled();
    expect(extractSceneStructure).not.toHaveBeenCalled();
    expect(groupScenesIntoArcs).not.toHaveBeenCalled();
    expect(reconcileResults).not.toHaveBeenCalled();
    expect(reextractFateWithLifecycle).not.toHaveBeenCalled();
    expect(analyzeThreading).not.toHaveBeenCalled();
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
  });
});
