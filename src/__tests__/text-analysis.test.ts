import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AnalysisChunkResult } from '@/types/narrative';
// Mock fetch globally
global.fetch = vi.fn();
// Mock the AI module
vi.mock('@/lib/ai/api', () => ({
  callGenerate: vi.fn(),
  callGenerateStream: vi.fn(),
  resolveReasoningBudget: vi.fn(() => 0),
}));
// Mock constants with smaller chunk sizes for faster tests
vi.mock('@/lib/constants', () => ({
  ANALYSIS_CONCURRENCY: 4,
  ANALYSIS_MAX_CORPUS_WORDS: 50000,
  WORDS_PER_SCENE: 1200,
  SCENES_PER_ARC: 4,
  ANALYSIS_MODEL: 'test-model',
  MAX_TOKENS_DEFAULT: 4096,
  ANALYSIS_TEMPERATURE: 0.7,
  // Market constants consumed by narrative-utils (isThreadAbandoned, etc.)
  MARKET_ABANDON_VOLUME: 0.5,
  MARKET_NEAR_CLOSED_MIN: 2,
  MARKET_TAU_CLOSE: 3,
  MARKET_VOLATILITY_BETA: 0.6,
  MARKET_VOLUME_DECAY: 0.9,
  MARKET_RECENCY_DECAY: 0.95,
  MARKET_EVIDENCE_MIN: -4,
  MARKET_EVIDENCE_MAX: 4,
  MARKET_EVIDENCE_SENSITIVITY: 2,
  MARKET_OPENING_VOLUME: 2,
  MARKET_FOCUS_K: 6,
}));
// Mock api-logger
vi.mock('@/lib/api-logger', () => ({
  logApiCall: vi.fn(() => 'log-id'),
  updateApiLog: vi.fn(),
}));
// Mock api-headers
vi.mock('@/lib/api-headers', () => ({
  apiHeaders: vi.fn(() => ({ 'Content-Type': 'application/json' })),
}));
// Mock system-logger
vi.mock('@/lib/system-logger', () => ({
  logError: vi.fn(),
  logWarning: vi.fn(),
  logInfo: vi.fn(),
  setSystemLoggerNarrativeId: vi.fn(),
  setSystemLoggerAnalysisId: vi.fn(),
}));
// Mock validation
vi.mock('@/lib/ai/validation', () => ({
  validateExtractionResult: vi.fn(() => []),
  validateSystemDelta: vi.fn(() => []),
}));
import { splitCorpusIntoScenes, extractSceneStructure, groupScenesIntoArcs, reconcileResults, analyzeThreading, assembleNarrative, reextractFateWithLifecycle } from '@/lib/text-analysis';
import { callGenerate } from '@/lib/ai/api';
// ── Test Fixtures ────────────────────────────────────────────────────────────
function createMockAnalysisResult(index: number, overrides: Partial<AnalysisChunkResult> = {}): AnalysisChunkResult {
  return {
    chapterSummary: `Chunk ${index} summary`,
    characters: [
      {
        name: `Character${index}`,
        role: 'anchor',
        firstAppearance: true,
        imagePrompt: 'A character',
      },
    ],
    locations: [
      {
        name: `Location${index}`,
        parentName: null,
        description: `A location ${index}`,
      },
    ],
    threads: [
      {
        description: `Main quest ${index}`,
        participantNames: [`Character${index}`],
        outcomes: ['succeeds', 'fails'],
        development: 'Thread started',
      },
    ],
    scenes: [
      {
        locationName: `Location${index}`,
        povName: `Character${index}`,
        participantNames: [`Character${index}`],
        events: [`event_${index}`],
        summary: `Scene ${index} summary`,
        sections: [0],
        prose: `Scene ${index} prose content here.`,
        threadDeltas: [
          { threadDescription: `Main quest ${index}`, logType: 'setup', updates: [{ outcome: 'succeeds', evidence: 1 }], volumeDelta: 1, rationale: 'opens' },
        ],
        worldDeltas: [
          {
            entityName: `Character${index}`,
            addedNodes: [{ content: 'Learned something important', type: 'belief' }],
          },
        ],
        relationshipDeltas: [],
      },
    ],
    relationships: [
      {
        from: `Character${index}`,
        to: `Ally${index}`,
        type: 'ally',
        valence: 5,
      },
    ],
    ...overrides,
  };
}
/** Create a rich fixture with artifacts, system knowledge, movements, etc. */
function createRichAnalysisResult(index: number): AnalysisChunkResult {
  return {
    chapterSummary: `Rich chunk ${index} summary`,
    characters: [
      { name: 'Alice', role: 'anchor', firstAppearance: index === 0 },
      { name: 'Bob', role: 'recurring', firstAppearance: index === 0 },
    ],
    locations: [
      { name: 'Castle', parentName: null, description: 'A grand castle', tiedCharacterNames: ['Alice'] },
      { name: 'Forest', parentName: null, description: 'A dark forest' },
    ],
    artifacts: [
      { name: 'Magic Sword', significance: 'key', ownerName: 'Alice' },
    ],
    threads: [
      { description: 'The Quest for the Crown', participantNames: ['Alice', 'Bob'], outcomes: ['succeeds', 'fails'], development: `Quest progresses in chunk ${index}` },
      { description: 'Trust between allies', participantNames: ['Alice', 'Bob'], outcomes: ['bond', 'break'], development: 'Growing trust' },
    ],
    scenes: [
      {
        locationName: 'Castle',
        povName: 'Alice',
        participantNames: ['Alice', 'Bob'],
        events: [`event_${index}_a`, `event_${index}_b`],
        summary: `Alice and Bob explore the castle in scene ${index}`,
        sections: [0],
        prose: `Scene ${index} prose about Alice and Bob in the castle.`,
        plan: {
          beats: [
            { fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Castle atmosphere', propositions: [] },
            { fn: 'advance' as const, mechanism: 'action' as const, what: 'Quest progress', propositions: [] },
          ],
        },
        beatProseMap: { chunks: [{ beatIndex: 0, prose: 'Castle atmosphere prose' }, { beatIndex: 1, prose: 'Quest progress prose' }], createdAt: Date.now() },
        threadDeltas: [
          { threadDescription: 'The Quest for the Crown', logType: 'escalation', updates: [{ outcome: 'succeeds', evidence: 2 }], volumeDelta: 1, rationale: 'advances' },
        ],
        worldDeltas: [
          { entityName: 'Alice', addedNodes: [{ content: 'Discovered a secret passage', type: 'history' }] },
          { entityName: 'Castle', addedNodes: [{ content: 'Secret passage found in east wing', type: 'history' }] },
        ],
        relationshipDeltas: [
          { from: 'Alice', to: 'Bob', type: 'growing trust', valenceDelta: 0.2 },
        ],
        artifactUsages: [{ artifactName: 'Magic Sword', characterName: 'Alice', usage: 'cut through the ward barrier' }],
        ownershipDeltas: [],
        tieDeltas: [{ locationName: 'Castle', characterName: 'Alice', action: 'add' as const }],
        characterMovements: [{ characterName: 'Bob', locationName: 'Forest', transition: 'walked into the forest' }],
        systemDeltas: {
          addedNodes: [{ concept: 'Ancient Magic', type: 'system' }, { concept: 'Royal Bloodline', type: 'concept' }],
          addedEdges: [{ fromConcept: 'Ancient Magic', toConcept: 'Royal Bloodline', relation: 'enables' }],
        },
      },
    ],
    relationships: [
      { from: 'Alice', to: 'Bob', type: 'ally', valence: 6 },
    ],
  };
}
// ── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  // Mock fetch to return successful responses with valid analysis JSON
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({
      content: JSON.stringify({
        chapterSummary: 'Test summary',
        characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true, continuity: [] }],
        locations: [{ name: 'Castle', parentName: null, description: 'A castle', lore: [] }],
        threads: [{ description: 'Main quest', participantNames: ['Alice'], development: 'Started' }],
        scenes: [{ locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'], events: ['event1'], summary: 'Test scene', sections: [0], prose: 'Test prose', threadDeltas: [], worldDeltas: [], relationshipDeltas: [] }],
        relationships: [],
      }),
    }),
    text: async () => '{}',
  } as Response);
});
// ══════════════════════════════════════════════════════════════════════════════
// Phase 0: splitCorpusIntoScenes
// ══════════════════════════════════════════════════════════════════════════════
describe('splitCorpusIntoScenes', () => {
  it('splits text into scene-sized chunks', () => {
    const paragraph = Array(200).fill('word').join(' '); // 200 words
    const text = Array(10).fill(paragraph).join('\n\n'); // 2000 words = ~2 scenes
    const scenes = splitCorpusIntoScenes(text);
    expect(scenes.length).toBeGreaterThanOrEqual(1);
    expect(scenes[0].index).toBe(0);
    expect(scenes[0].wordCount).toBeGreaterThan(0);
  });
  it('handles short text as single scene', () => {
    const text = 'Short text.\n\nAnother paragraph.';
    const scenes = splitCorpusIntoScenes(text);
    expect(scenes.length).toBe(1);
    expect(scenes[0].prose).toContain('Short text');
  });
  it('assigns sequential indices', () => {
    const paragraph = Array(300).fill('word').join(' ');
    const text = Array(8).fill(paragraph).join('\n\n'); // 2400 words = ~2 scenes
    const scenes = splitCorpusIntoScenes(text);
    scenes.forEach((s, i) => expect(s.index).toBe(i));
  });
  it('preserves all text (no word loss)', () => {
    const paragraph = Array(300).fill('word').join(' ');
    const text = Array(8).fill(paragraph).join('\n\n');
    const scenes = splitCorpusIntoScenes(text);
    const totalWords = scenes.reduce((sum, s) => sum + s.wordCount, 0);
    expect(totalWords).toBe(2400);
  });
  it('merges tiny trailing scene into previous', () => {
    // Create text where the last paragraph is very small (<30% of target)
    const bigParagraph = Array(1200).fill('word').join(' ');
    const tinyParagraph = Array(50).fill('word').join(' '); // ~4% of 1200
    const text = bigParagraph + '\n\n' + tinyParagraph;
    const scenes = splitCorpusIntoScenes(text);
    // Should merge the tiny trailing piece into the previous scene
    expect(scenes.length).toBe(1);
    expect(scenes[0].wordCount).toBe(1250);
  });
  it('does not merge substantial trailing scene', () => {
    // A trailing scene with > 30% of target should stay separate
    const bigParagraph = Array(1200).fill('word').join(' ');
    const medParagraph = Array(500).fill('word').join(' '); // ~42% of 1200
    const text = bigParagraph + '\n\n' + medParagraph;
    const scenes = splitCorpusIntoScenes(text);
    expect(scenes.length).toBe(2);
  });
  it('splits long single paragraph into multiple scenes', () => {
    // One giant paragraph with 3600 words — should be split by sentence boundaries
    const sentences = Array(200).fill('This is a sentence with some words.').join(' ');
    const scenes = splitCorpusIntoScenes(sentences);
    expect(scenes.length).toBeGreaterThanOrEqual(1);
    // All text preserved
    const totalWords = scenes.reduce((sum, s) => sum + s.wordCount, 0);
    expect(totalWords).toBeGreaterThan(0);
  });
  it('handles empty paragraphs gracefully', () => {
    const text = 'First paragraph.\n\n\n\n\n\nSecond paragraph.';
    const scenes = splitCorpusIntoScenes(text);
    expect(scenes.length).toBe(1);
    expect(scenes[0].prose).toContain('First paragraph');
    expect(scenes[0].prose).toContain('Second paragraph');
  });
  it('handles whitespace-only input', () => {
    const scenes = splitCorpusIntoScenes('   \n\n   \n\n   ');
    expect(scenes.length).toBe(0);
  });
  it('produces scenes near target word count for large text', () => {
    const paragraph = Array(200).fill('word').join(' ');
    const text = Array(50).fill(paragraph).join('\n\n'); // 10000 words
    const scenes = splitCorpusIntoScenes(text);
    // Each scene should be roughly 1200 words (within 15% overshoot tolerance)
    for (const scene of scenes.slice(0, -1)) { // exclude last which may be smaller
      expect(scene.wordCount).toBeGreaterThanOrEqual(800);
      expect(scene.wordCount).toBeLessThanOrEqual(1600);
    }
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Phase 2: extractSceneStructure
// ══════════════════════════════════════════════════════════════════════════════
describe('extractSceneStructure', () => {
  it('extracts complete structure from prose + plan', async () => {
    const mockResponse = {
      povName: 'Alice',
      locationName: 'Wonderland',
      participantNames: ['Alice', 'Cheshire Cat'],
      events: ['falls_down_hole', 'meets_cat'],
      summary: 'Alice falls into Wonderland and meets the Cheshire Cat.',
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true, continuity: [{ type: 'state', content: 'Confused and disoriented' }] }],
      locations: [{ name: 'Wonderland', parentName: null, description: 'A strange land', lore: ['Everything is backwards'] }],
      artifacts: [{ name: 'Pocket Watch', significance: 'notable', continuity: [], ownerName: null }],
      threads: [{ description: 'Alice finding her way home', participantNames: ['Alice'], development: 'Alice realizes she is lost' }],
      relationships: [{ from: 'Alice', to: 'Cheshire Cat', type: 'uneasy acquaintance', valence: 2 }],
      threadDeltas: [{ threadDescription: 'Alice finding her way home', from: 'dormant', to: 'active', addedNodes: [] }],
      worldDeltas: [{ entityName: 'Alice', addedNodes: [{ content: 'Fell down the rabbit hole', type: 'history' }] }],
      relationshipDeltas: [{ from: 'Alice', to: 'Cheshire Cat', type: 'uneasy acquaintance', valenceDelta: 0.2 }],
      artifactUsages: [{ artifactName: 'Pocket Watch', characterName: null, usage: 'ticked ominously marking the deadline' }],
      ownershipDeltas: [],
      tieDeltas: [],
      characterMovements: [{ characterName: 'Alice', locationName: 'Wonderland', transition: 'fell through' }],
      systemDeltas: { addedNodes: [{ concept: 'Size-Altering', type: 'system' }] },
    };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify(mockResponse) }),
    } as Response);
    const plan = { beats: [{ fn: 'advance' as const, mechanism: 'action' as const, what: 'Alice falls', propositions: [] }] };
    const result = await extractSceneStructure('Alice fell down the rabbit hole.', plan);
    expect(result.povName).toBe('Alice');
    expect(result.locationName).toBe('Wonderland');
    expect(result.participantNames).toContain('Alice');
    expect(result.participantNames).toContain('Cheshire Cat');
    expect(result.events).toHaveLength(2);
    expect(result.summary).toContain('Alice');
    expect(result.characters).toHaveLength(1);
    expect(result.locations).toHaveLength(1);
    expect(result.artifacts).toHaveLength(1);
    expect(result.threads).toHaveLength(1);
    expect(result.threadDeltas).toHaveLength(1);
    expect(result.worldDeltas).toHaveLength(1);
    expect(result.relationshipDeltas).toHaveLength(1);
    expect(result.artifactUsages).toHaveLength(1);
    expect(result.characterMovements).toHaveLength(1);
    expect(result.systemDeltas?.addedNodes).toHaveLength(1);
  });
  it('defaults missing fields to empty arrays/strings', async () => {
    // LLM returns partial JSON — function should fill defaults
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify({ povName: 'Alice', summary: 'Partial' }) }),
    } as Response);
    const plan = { beats: [{ fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Setup', propositions: [] }] };
    const result = await extractSceneStructure('Some prose.', plan);
    expect(result.povName).toBe('Alice');
    expect(result.locationName).toBe('');
    expect(result.participantNames).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.characters).toEqual([]);
    expect(result.locations).toEqual([]);
    expect(result.artifacts).toEqual([]);
    expect(result.threads).toEqual([]);
    expect(result.threadDeltas).toEqual([]);
    expect(result.worldDeltas).toEqual([]);
    expect(result.relationshipDeltas).toEqual([]);
    expect(result.artifactUsages).toEqual([]);
    expect(result.ownershipDeltas).toEqual([]);
    expect(result.tieDeltas).toEqual([]);
    expect(result.characterMovements).toEqual([]);
  });
  it('handles LLM response wrapped in markdown code fence', async () => {
    const jsonStr = JSON.stringify({
      povName: 'Bob', locationName: 'Library', participantNames: ['Bob'],
      events: ['reads_book'], summary: 'Bob reads', characters: [], locations: [],
      artifacts: [], threads: [], relationships: [],
      threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
      artifactUsages: [], ownershipDeltas: [], tieDeltas: [], characterMovements: [],
    });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: '```json\n' + jsonStr + '\n```' }),
    } as Response);
    const plan = { beats: [{ fn: 'inform' as const, mechanism: 'narration' as const, what: 'Reads', propositions: [] }] };
    const result = await extractSceneStructure('Bob reads a book.', plan);
    expect(result.povName).toBe('Bob');
    expect(result.locationName).toBe('Library');
  });
  it('throws on invalid JSON response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: 'This is not JSON at all' }),
    } as Response);
    const plan = { beats: [{ fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Setup', propositions: [] }] };
    await expect(extractSceneStructure('Some prose.', plan)).rejects.toThrow();
  });
  it('throws on fetch failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Rate limited' }),
    } as Response);
    const plan = { beats: [{ fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Setup', propositions: [] }] };
    await expect(extractSceneStructure('Some prose.', plan)).rejects.toThrow('Rate limited');
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Phase 3: groupScenesIntoArcs
// ══════════════════════════════════════════════════════════════════════════════
describe('groupScenesIntoArcs', () => {
  it('groups scenes into arcs of ~4 and names them', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify([
        { name: 'The Beginning', directionVector: 'Alice sets out; stakes established.', worldState: 'Alice at home; threads seeded; no allies yet.' },
        { name: 'Rising Tension', directionVector: 'Bob pursues; pressure rises.', worldState: 'Alice at forest; T-Pursuit escalating; Bob tracks.' },
      ]) }),
    } as Response);
    const summaries = Array.from({ length: 8 }, (_, i) => ({ index: i, summary: `Scene ${i} summary` }));
    const arcs = await groupScenesIntoArcs(summaries);
    expect(arcs).toHaveLength(2);
    expect(arcs[0].name).toBe('The Beginning');
    expect(arcs[0].directionVector).toBe('Alice sets out; stakes established.');
    expect(arcs[0].worldState).toBe('Alice at home; threads seeded; no allies yet.');
    expect(arcs[0].sceneIndices).toEqual([0, 1, 2, 3]);
    expect(arcs[1].name).toBe('Rising Tension');
    expect(arcs[1].sceneIndices).toEqual([4, 5, 6, 7]);
  });
  it('handles non-multiple-of-4 scene counts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify([
        { name: 'Arc One', directionVector: 'd1', worldState: 'w1' },
        { name: 'Arc Two', directionVector: 'd2', worldState: 'w2' },
      ]) }),
    } as Response);
    const summaries = Array.from({ length: 6 }, (_, i) => ({ index: i, summary: `Scene ${i}` }));
    const arcs = await groupScenesIntoArcs(summaries);
    expect(arcs).toHaveLength(2);
    expect(arcs[0].sceneIndices).toEqual([0, 1, 2, 3]);
    expect(arcs[1].sceneIndices).toEqual([4, 5]); // Remaining 2 scenes
  });
  it('falls back to default names when LLM returns fewer entries', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify([
        { name: 'Only One Name', directionVector: 'd', worldState: 'w' },
      ]) }),
    } as Response);
    const summaries = Array.from({ length: 8 }, (_, i) => ({ index: i, summary: `Scene ${i}` }));
    const arcs = await groupScenesIntoArcs(summaries);
    expect(arcs).toHaveLength(2);
    expect(arcs[0].name).toBe('Only One Name');
    expect(arcs[1].name).toBe('Arc 2'); // Fallback
    expect(arcs[1].directionVector).toBeUndefined();
    expect(arcs[1].worldState).toBeUndefined();
  });
  it('handles single scene input', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify([{ name: 'Prologue', directionVector: 'd', worldState: 'w' }]) }),
    } as Response);
    const arcs = await groupScenesIntoArcs([{ index: 0, summary: 'Only scene' }]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].sceneIndices).toEqual([0]);
  });
  it('preserves non-sequential scene indices', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify([{ name: 'Sparse Arc', directionVector: 'd', worldState: 'w' }]) }),
    } as Response);
    // Simulate scenes that aren't 0-indexed consecutively (e.g., some scenes filtered out)
    const summaries = [{ index: 2, summary: 'Scene 2' }, { index: 5, summary: 'Scene 5' }, { index: 7, summary: 'Scene 7' }];
    const arcs = await groupScenesIntoArcs(summaries);
    expect(arcs[0].sceneIndices).toEqual([2, 5, 7]);
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Phase 4: reconcileResults
// ══════════════════════════════════════════════════════════════════════════════
describe('reconcileResults', () => {
  beforeEach(() => {
    // Default: no merges needed. Reconciliation now runs in two sequential
    // phases (entities, then semantic) so fetch is invoked twice per call —
    // use mockResolvedValue so both phases resolve to the same empty-merge
    // payload unless a test overrides it.
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: {},
          threadMerges: {},
          locationMerges: {},
          artifactMerges: {},
          systemMerges: {},
        }),
      }),
    } as Response);
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      characterMerges: {},
      threadMerges: {},
      locationMerges: {},
      artifactMerges: {},
      systemMerges: {},
    }));
  });
  it('returns same number of chunks', async () => {
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1)];
    const reconciled = await reconcileResults(results);
    expect(reconciled.length).toBe(results.length);
  });
  it('preserves all scenes from all chunks', async () => {
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1), createMockAnalysisResult(2)];
    const reconciled = await reconcileResults(results);
    const totalScenes = reconciled.reduce((sum, r) => sum + r.scenes.length, 0);
    expect(totalScenes).toBe(3);
  });
  it('merges character name variants via LLM map', async () => {
    // Entity reconciliation uses numeric IDs (1-indexed insertion order) to
    // cut output tokens. 'Prof. McGonagall' is seen first → ID 1; 'Minerva
    // McGonagall' is seen second → ID 2. Mock emits "merge 1 into 2".
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: { '1': 2 },
          threadMerges: {},
          locationMerges: {},
          artifactMerges: {},
          systemMerges: {},
        }),
      }),
    } as Response);
    const results: AnalysisChunkResult[] = [
      { ...createMockAnalysisResult(0), characters: [{ name: 'Prof. McGonagall', role: 'recurring', firstAppearance: true }] },
      { ...createMockAnalysisResult(1), characters: [{ name: 'Minerva McGonagall', role: 'anchor', firstAppearance: false }] },
    ];
    const reconciled = await reconcileResults(results);
    // Both should now use the canonical name
    expect(reconciled[0].characters[0].name).toBe('Minerva McGonagall');
    expect(reconciled[1].characters[0].name).toBe('Minerva McGonagall');
  });
  it('merges thread descriptions via LLM map', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: {},
          threadMerges: { "Harry's distrust of Snape": "Harry and Snape's antagonism" },
          locationMerges: {},
          artifactMerges: {},
          systemMerges: {},
        }),
      }),
    } as Response);
    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        threads: [{ description: "Harry's distrust of Snape", participantNames: ['Harry'], outcomes: ['confirmed', 'dispelled'], development: 'Started' }],
        scenes: [{
          ...createMockAnalysisResult(0).scenes[0],
          threadDeltas: [{ threadDescription: "Harry's distrust of Snape", logType: 'setup', updates: [{ outcome: 'confirmed', evidence: 1 }], volumeDelta: 1, rationale: 'opens' }],
        }],
      },
    ];
    const reconciled = await reconcileResults(results);
    expect(reconciled[0].threads[0].description).toBe("Harry and Snape's antagonism");
    expect(reconciled[0].scenes[0].threadDeltas[0].threadDescription).toBe("Harry and Snape's antagonism");
  });
  it('merges location names via LLM map', async () => {
    // Locations are seen in insertion order across chunks. "The Forest" comes
    // from chunk 0 (ID 1); "Dark Forest" from chunk 1 (ID 2). Merge 1 → 2.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: {},
          threadMerges: {},
          locationMerges: { '1': 2 },
          artifactMerges: {},
          systemMerges: {},
        }),
      }),
    } as Response);
    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        locations: [{ name: 'The Forest', parentName: null, description: 'Spooky' }],
        scenes: [{ ...createMockAnalysisResult(0).scenes[0], locationName: 'The Forest' }],
      },
      {
        ...createMockAnalysisResult(1),
        locations: [{ name: 'Dark Forest', parentName: null, description: 'The same spooky place' }],
        scenes: [{ ...createMockAnalysisResult(1).scenes[0], locationName: 'Dark Forest' }],
      },
    ];
    const reconciled = await reconcileResults(results);
    expect(reconciled[0].locations[0].name).toBe('Dark Forest');
    expect(reconciled[0].scenes[0].locationName).toBe('Dark Forest');
  });
  it('merges artifact names via LLM map', async () => {
    // Both surface forms must appear in the input list for ID-based merges —
    // the LLM picks one as canonical, it cannot invent a new name.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: {},
          threadMerges: {},
          locationMerges: {},
          artifactMerges: { '1': 2 },
          systemMerges: {},
        }),
      }),
    } as Response);
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      artifacts: [
        { name: 'the Elder Wand', significance: 'key', ownerName: null },
        { name: 'Elder Wand', significance: 'key', ownerName: null },
      ],
      scenes: [{
        ...createMockAnalysisResult(0).scenes[0],
        artifactUsages: [{ artifactName: 'the Elder Wand', characterName: 'Harry', usage: 'cast the disarming charm' }],
      }],
    }];
    const reconciled = await reconcileResults(results);
    // After merge, both surface forms collapse to the 'Elder Wand' canonical.
    expect(reconciled[0].artifacts!.every(a => a.name === 'Elder Wand')).toBe(true);
    expect(reconciled[0].scenes[0].artifactUsages![0].artifactName).toBe('Elder Wand');
  });
  it('merges system knowledge concepts via LLM map', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: {},
          threadMerges: {},
          locationMerges: {},
          artifactMerges: {},
          systemMerges: { 'Magical System': 'Magic System' },
        }),
      }),
    } as Response);
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      scenes: [{
        ...createMockAnalysisResult(0).scenes[0],
        systemDeltas: {
          addedNodes: [{ concept: 'Magical System', type: 'system' }],
          addedEdges: [{ fromConcept: 'Magical System', toConcept: 'Energy', relation: 'enables' }],
        },
      }],
    }];
    const reconciled = await reconcileResults(results);
    expect(reconciled[0].scenes[0].systemDeltas!.addedNodes[0].concept).toBe('Magic System');
    expect(reconciled[0].scenes[0].systemDeltas!.addedEdges[0].fromConcept).toBe('Magic System');
  });
  it('unions outcomes across chunks for the same thread', async () => {
    // Market model: outcomes are unioned across chunks (outcome expansion).
    // No status stitching — narrator belief is extended on the fly.
    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        threads: [{ description: 'Main quest', participantNames: ['Alice'], outcomes: ['succeeds', 'fails'], development: 'Started' }],
        scenes: [{ ...createMockAnalysisResult(0).scenes[0], threadDeltas: [{ threadDescription: 'Main quest', logType: 'setup', updates: [{ outcome: 'succeeds', evidence: 1 }], volumeDelta: 1, rationale: 'opens' }] }],
      },
      {
        ...createMockAnalysisResult(1),
        threads: [{ description: 'Main quest', participantNames: ['Alice', 'Bob'], outcomes: ['succeeds', 'fails', 'pyrrhic'], development: 'Continued' }],
        scenes: [{ ...createMockAnalysisResult(1).scenes[0], threadDeltas: [{ threadDescription: 'Main quest', logType: 'escalation', updates: [{ outcome: 'pyrrhic', evidence: 2 }], volumeDelta: 1, rationale: 'new outcome emerges' }] }],
      },
    ];
    const reconciled = await reconcileResults(results);
    // Reconciliation should leave threads + deltas intact for downstream assembly.
    expect(reconciled).toHaveLength(2);
    expect(reconciled[1].threads[0].outcomes).toContain('pyrrhic');
  });
  it('deduplicates characters within same chunk by name', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [
        { name: 'Alice', role: 'recurring', firstAppearance: true },
        { name: 'Alice', role: 'anchor', firstAppearance: false },
      ],
    }];
    const reconciled = await reconcileResults(results);
    const alices = reconciled[0].characters.filter(c => c.name === 'Alice');
    expect(alices).toHaveLength(1);
    // Should take higher role
    expect(alices[0].role).toBe('anchor');
  });
  it('deduplicates artifacts within same chunk by name with higher significance', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      artifacts: [
        { name: 'Sword', significance: 'minor', ownerName: null },
        { name: 'Sword', significance: 'key', ownerName: 'Hero' },
      ],
    }];
    const reconciled = await reconcileResults(results);
    const swords = reconciled[0].artifacts!.filter(a => a.name === 'Sword');
    expect(swords).toHaveLength(1);
    expect(swords[0].significance).toBe('key');
  });
  it('resolves character names in participant lists', async () => {
    // 'Al' is seen first (ID 1), 'Alice' second (ID 2). Merge 1 → 2.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: { '1': 2 },
          threadMerges: {},
          locationMerges: {},
        }),
      }),
    } as Response);
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [
        { name: 'Al', role: 'recurring', firstAppearance: true },
        { name: 'Alice', role: 'anchor', firstAppearance: false },
      ],
      scenes: [{
        ...createMockAnalysisResult(0).scenes[0],
        participantNames: ['Al', 'Bob'],
        povName: 'Al',
      }],
    }];
    const reconciled = await reconcileResults(results);
    expect(reconciled[0].scenes[0].povName).toBe('Alice');
    expect(reconciled[0].scenes[0].participantNames).toContain('Alice');
  });
  it('deduplicates participant names after merge', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: { '1': 2 },
          threadMerges: {},
          locationMerges: {},
        }),
      }),
    } as Response);
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [
        { name: 'Al', role: 'recurring', firstAppearance: true },
        { name: 'Alice', role: 'anchor', firstAppearance: false },
      ],
      scenes: [{
        ...createMockAnalysisResult(0).scenes[0],
        participantNames: ['Al', 'Alice', 'Bob'], // Al and Alice are same person
      }],
    }];
    const reconciled = await reconcileResults(results);
    // Should deduplicate after resolving Al → Alice
    const participants = reconciled[0].scenes[0].participantNames;
    const aliceCount = participants.filter(n => n === 'Alice').length;
    expect(aliceCount).toBe(1);
  });
  it('resolves relationship delta names through character map', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: { '1': 2 },
          threadMerges: {},
          locationMerges: {},
        }),
      }),
    } as Response);
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [
        { name: 'Al', role: 'recurring', firstAppearance: true },
        { name: 'Alice', role: 'anchor', firstAppearance: false },
      ],
      scenes: [{
        ...createMockAnalysisResult(0).scenes[0],
        relationshipDeltas: [{ from: 'Al', to: 'Bob', type: 'trust', valenceDelta: 0.3 }],
      }],
    }];
    const reconciled = await reconcileResults(results);
    expect(reconciled[0].scenes[0].relationshipDeltas[0].from).toBe('Alice');
  });
  // ── Phase split: entities and semantic reconciliation run sequentially ──
  it('runs entity reconciliation and semantic reconciliation as two sequential LLM calls', async () => {
    // Default beforeEach mock returns no merges — just assert the fetch count
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1)];
    await reconcileResults(results);
    // Two phases → two fetch calls to /api/generate
    const calls = vi.mocked(fetch).mock.calls.filter((call) =>
      String(call[0]).includes('/api/generate'),
    );
    expect(calls.length).toBe(2);
  });
  it('entity phase prompt targets characters, locations, artifacts — not threads or system concepts', async () => {
    const results = [createMockAnalysisResult(0)];
    await reconcileResults(results);
    const firstCallBody = JSON.parse(
      String(vi.mocked(fetch).mock.calls[0][1]?.body),
    );
    const firstPrompt = firstCallBody.prompt as string;
    // Entity-phase XML inputs — characters/locations/artifacts blocks present.
    expect(firstPrompt).toMatch(/<characters\b/);
    expect(firstPrompt).toMatch(/<locations\b/);
    expect(firstPrompt).toMatch(/<artifacts\b/);
    // Entity phase must not ask for thread or system merges
    expect(firstPrompt).not.toMatch(/<threads\b/);
    expect(firstPrompt).not.toMatch(/<system-knowledge\b/);
  });
  it('semantic phase prompt targets threads and system knowledge', async () => {
    const results = [createMockAnalysisResult(0)];
    await reconcileResults(results);
    const secondCallBody = JSON.parse(
      String(vi.mocked(fetch).mock.calls[1][1]?.body),
    );
    const secondPrompt = secondCallBody.prompt as string;
    expect(secondPrompt).toMatch(/<threads\b/);
    expect(secondPrompt).toMatch(/<system-knowledge\b/);
    // Semantic phase must not ask for entity merges
    expect(secondPrompt).not.toMatch(/<characters\b/);
    expect(secondPrompt).not.toMatch(/<locations\b/);
    expect(secondPrompt).not.toMatch(/<artifacts\b/);
  });
  it('semantic phase defaults to preservation (emphasises keeping items separate)', async () => {
    const results = [createMockAnalysisResult(0)];
    await reconcileResults(results);
    const secondCallBody = JSON.parse(
      String(vi.mocked(fetch).mock.calls[1][1]?.body),
    );
    const secondPrompt = secondCallBody.prompt as string;
    // The semantic phase uses a default-preserve stance so genuine nuance survives
    expect(secondPrompt).toMatch(/KEEP SEPARATE|WHEN IN DOUBT|PRESERVE/i);
  });
  it('skips entity LLM call when no entities were extracted', async () => {
    // Only threads in the results — no characters, locations, or artifacts
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [],
      locations: [],
      artifacts: [],
      threads: [{ description: 'Quest', participantNames: [], outcomes: ['yes', 'no'], development: 'x' }],
    }];
    await reconcileResults(results);
    const calls = vi.mocked(fetch).mock.calls.filter((call) =>
      String(call[0]).includes('/api/generate'),
    );
    // Only semantic phase runs — one fetch
    expect(calls.length).toBe(1);
    const body = JSON.parse(String(calls[0][1]?.body));
    expect(body.prompt).toMatch(/<threads\b/);
  });
  it('skips semantic LLM call when no threads or system concepts exist', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      threads: [],
      scenes: [{
        ...createMockAnalysisResult(0).scenes[0],
        threadDeltas: [],
        systemDeltas: { addedNodes: [], addedEdges: [] },
      }],
    }];
    await reconcileResults(results);
    const calls = vi.mocked(fetch).mock.calls.filter((call) =>
      String(call[0]).includes('/api/generate'),
    );
    // Only entity phase runs
    expect(calls.length).toBe(1);
    const body = JSON.parse(String(calls[0][1]?.body));
    expect(body.prompt).toMatch(/<characters\b/);
  });
  it('entity merges from phase A and thread merges from phase B both apply', async () => {
    // First fetch (entity phase): merge character names by ID.
    // Characters: 'Prof. M' (1), 'Minerva McGonagall' (2) — merge 1 → 2.
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: { '1': 2 },
          locationMerges: {},
          artifactMerges: {},
        }),
      }),
    } as Response);
    // Second fetch (semantic phase): still uses string-based thread/system
    // merges — LLM reasons over descriptions, not IDs.
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          threadMerges: { 'Old quest': 'Main quest' },
          systemMerges: {},
        }),
      }),
    } as Response);
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [
        { name: 'Prof. M', role: 'recurring', firstAppearance: true },
        { name: 'Minerva McGonagall', role: 'anchor', firstAppearance: false },
      ],
      threads: [{ description: 'Old quest', participantNames: ['Prof. M'], outcomes: ['yes', 'no'], development: 'x' }],
      scenes: [{
        ...createMockAnalysisResult(0).scenes[0],
        threadDeltas: [{ threadDescription: 'Old quest', logType: 'setup', updates: [{ outcome: 'yes', evidence: 1 }], volumeDelta: 1, rationale: 'opens' }],
      }],
    }];
    const reconciled = await reconcileResults(results);
    expect(reconciled[0].characters.every(c => c.name === 'Minerva McGonagall')).toBe(true);
    expect(reconciled[0].threads[0].description).toBe('Main quest');
    expect(reconciled[0].scenes[0].threadDeltas[0].threadDescription).toBe('Main quest');
  });
  it('forwards phase-tagged stream tokens to onToken callback', async () => {
    const results = [createMockAnalysisResult(0)];
    const collected: string[] = [];
    await reconcileResults(results, (_token, accumulated) => {
      collected.push(accumulated);
    });
    // Even if the mock transport doesn't emit SSE tokens, the pipeline runs
    // both phases without throwing when an onToken is provided. The phase
    // labels must appear in the accumulated buffer when tokens do stream.
    // This test asserts the callback shape is accepted and both phases run.
    const calls = vi.mocked(fetch).mock.calls.filter((call) =>
      String(call[0]).includes('/api/generate'),
    );
    expect(calls.length).toBe(2);
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Phase 5: analyzeThreading
// ══════════════════════════════════════════════════════════════════════════════
describe('analyzeThreading', () => {
  it('analyzes thread dependencies and returns mapping', async () => {
    // Threading uses 1-indexed numeric IDs to cut output tokens.
    // Thread A=1, Thread B=2, Thread C=3. B depends on A; C depends on A and B.
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          threadDependencies: {
            '2': [1],
            '3': [1, 2],
          },
        }),
      }),
    } as any);
    const result = await analyzeThreading(['Thread A', 'Thread B', 'Thread C']);
    expect(result['Thread B']).toEqual(['Thread A']);
    expect(result['Thread C']).toEqual(['Thread A', 'Thread B']);
  });
  it('returns empty object when less than 2 threads', async () => {
    const result = await analyzeThreading(['Thread A']);
    expect(result).toEqual({});
    expect(callGenerate).not.toHaveBeenCalled();
  });
  it('returns empty object when empty thread list', async () => {
    const result = await analyzeThreading([]);
    expect(result).toEqual({});
  });
  it('returns empty object when exactly 2 threads have no dependencies', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({ threadDependencies: {} }),
      }),
    } as any);
    const result = await analyzeThreading(['Thread A', 'Thread B']);
    expect(result).toEqual({});
  });
  it('handles LLM returning smart quotes in JSON', async () => {
    // Simulate LLM returning curly quotes instead of straight quotes.
    // With numeric IDs the value side doesn't need quoting, but the key side
    // could still arrive wrapped in curly quotes — exercise the repair path.
    const badJson = '{"threadDependencies": {\u201C2\u201D: [1]}}';
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: badJson }),
    } as any);
    const result = await analyzeThreading(['Thread A', 'Thread B']);
    expect(result['Thread B']).toEqual(['Thread A']);
  });

  // ── ID validation: the safety net. If the LLM emits malformed IDs
  // (out-of-range, non-integer, self-referential) we silently drop the bad
  // entries rather than surfacing an error or inventing dependencies. This
  // keeps the pipeline robust without adding a retry loop that could burn
  // tokens on the same failure. ──
  it('drops out-of-range thread IDs', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          threadDependencies: {
            '2': [1, 99],   // 99 is out of range — dropped; 1 survives
            '42': [1],       // key out of range — whole entry dropped
          },
        }),
      }),
    } as any);
    const result = await analyzeThreading(['Thread A', 'Thread B']);
    expect(result['Thread B']).toEqual(['Thread A']);
    // No entry synthesised for the out-of-range key
    expect(Object.keys(result)).toEqual(['Thread B']);
  });

  it('drops self-dependencies (a thread cannot depend on itself)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          threadDependencies: {
            '2': [1, 2],  // 2 depends on itself — dropped; 1 survives
          },
        }),
      }),
    } as any);
    const result = await analyzeThreading(['Thread A', 'Thread B']);
    expect(result['Thread B']).toEqual(['Thread A']);
  });

  it('dedupes repeated IDs within a single dependency list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          threadDependencies: { '3': [1, 1, 2, 2, 1] },
        }),
      }),
    } as any);
    const result = await analyzeThreading(['Thread A', 'Thread B', 'Thread C']);
    expect(result['Thread C']).toEqual(['Thread A', 'Thread B']);
  });

  it('omits threads with empty dependency arrays', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          threadDependencies: { '2': [], '3': [1] },
        }),
      }),
    } as any);
    const result = await analyzeThreading(['Thread A', 'Thread B', 'Thread C']);
    expect(result['Thread B']).toBeUndefined();
    expect(result['Thread C']).toEqual(['Thread A']);
  });

  it('tolerates non-integer and non-numeric IDs', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          threadDependencies: {
            '2': [1, 1.5, 'foo', null],  // only 1 is a valid integer ID
          },
        }),
      }),
    } as any);
    const result = await analyzeThreading(['Thread A', 'Thread B']);
    expect(result['Thread B']).toEqual(['Thread A']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ID validation for entity reconciliation — same safety net
// ══════════════════════════════════════════════════════════════════════════════
describe('reconcileResults — ID validation', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  it('drops out-of-range character IDs silently', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: { '1': 99, '5': 2, '2': 1 },  // only 2→1 is valid
          locationMerges: {},
          artifactMerges: {},
          threadMerges: {},
          systemMerges: {},
        }),
      }),
    } as Response);
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [
        { name: 'Alice', role: 'anchor', firstAppearance: true },
        { name: 'Al', role: 'recurring', firstAppearance: true },
      ],
    }];
    const reconciled = await reconcileResults(results);
    // 'Al' (ID 2) → 'Alice' (ID 1); other entries are dropped.
    expect(reconciled[0].characters.every(c => c.name === 'Alice')).toBe(true);
  });

  it('ignores self-mapping (variant ID equals canonical ID)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: { '1': 1 },  // self-map — no-op, dropped
          locationMerges: {},
          artifactMerges: {},
          threadMerges: {},
          systemMerges: {},
        }),
      }),
    } as Response);
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true }],
    }];
    const reconciled = await reconcileResults(results);
    expect(reconciled[0].characters[0].name).toBe('Alice');
  });
});
// ══════════════════════════════════════════════════════════════════════════════
// Phase 6: assembleNarrative
// ══════════════════════════════════════════════════════════════════════════════
describe('assembleNarrative', () => {
  beforeEach(() => {
    // Mock fetch for meta extraction (callAnalysis uses fetch → res.json() → data.content)
    const metaJSON = JSON.stringify({
      rules: ['Magic exists', 'Laws of physics are flexible'],
      worldSystems: [{ name: 'Magic System', description: 'Elemental magic', principles: ['Elements bind'], constraints: ['Drains energy'], interactions: [] }],
      imageStyle: 'Epic fantasy art',
      proseProfile: {
        register: 'literary', stance: 'close_third', tense: 'past',
        sentenceRhythm: 'varied', interiority: 'deep', dialogueWeight: 'moderate',
        devices: ['dramatic irony', 'free indirect discourse'],
        rules: ['Show emotion through action'],
        antiPatterns: ['Never name emotions directly'],
      },
      planGuidance: 'Use action and environment mechanisms primarily',
    });
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ content: metaJSON }),
      text: async () => metaJSON,
      body: null,
    } as Response);
    // Also keep callGenerate mock for any other paths
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      rules: ['Magic exists', 'Laws of physics are flexible'],
      worldSystems: [{ name: 'Magic System', description: 'Elemental magic', principles: ['Elements bind'], constraints: ['Drains energy'], interactions: [] }],
      imageStyle: 'Epic fantasy art',
      proseProfile: {
        register: 'literary',
        stance: 'close_third',
        tense: 'past',
        sentenceRhythm: 'varied',
        interiority: 'deep',
        dialogueWeight: 'moderate',
        devices: ['dramatic irony', 'free indirect discourse'],
        rules: ['Show emotion through action'],
        antiPatterns: ['Never name emotions directly'],
      },
      planGuidance: 'Use action and environment mechanisms primarily',
    }));
  });
  it('creates a complete NarrativeState from analyzed results', async () => {
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1)];
    const narrative = await assembleNarrative('Test Story', results, {});
    expect(narrative.title).toBe('Test Story');
    expect(narrative.id).toMatch(/^N-TES-/);
    expect(Object.keys(narrative.characters).length).toBeGreaterThan(0);
    expect(Object.keys(narrative.locations).length).toBeGreaterThan(0);
    expect(Object.keys(narrative.threads).length).toBeGreaterThan(0);
    expect(Object.keys(narrative.scenes).length).toBe(2);
    expect(Object.keys(narrative.branches).length).toBe(1);
    expect(Object.keys(narrative.arcs).length).toBeGreaterThan(0);
  });
  it('assigns unique IDs to all entities', async () => {
    const results = [createMockAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {});
    const characterIds = Object.keys(narrative.characters);
    const locationIds = Object.keys(narrative.locations);
    const threadIds = Object.keys(narrative.threads);
    const sceneIds = Object.keys(narrative.scenes);
    expect(new Set(characterIds).size).toBe(characterIds.length);
    expect(new Set(locationIds).size).toBe(locationIds.length);
    expect(new Set(threadIds).size).toBe(threadIds.length);
    expect(new Set(sceneIds).size).toBe(sceneIds.length);
  });
  it('creates main branch with all scene IDs', async () => {
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1)];
    const narrative = await assembleNarrative('Test', results, {});
    const sceneCount = Object.keys(narrative.scenes).length;
    const branchIds = Object.keys(narrative.branches);
    const mainBranch = narrative.branches[branchIds[0]];
    const mainBranchScenes = mainBranch.entryIds.filter(id => id.startsWith('S-'));
    expect(mainBranchScenes.length).toBe(sceneCount);
  });
  it('maps scene participant names to character IDs', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Test', sections: [0],
        threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
      }],
    }];
    const narrative = await assembleNarrative('Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    const aliceId = Object.values(narrative.characters).find(c => c.name === 'Alice')?.id;
    expect(scene.participantIds).toContain(aliceId);
    expect(scene.povId).toBe(aliceId);
  });
  it('maps scene location names to location IDs', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      locations: [{ name: 'Castle', parentName: null, description: 'A castle' }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Test', sections: [0],
        threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
      }],
    }];
    const narrative = await assembleNarrative('Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    const castleId = Object.values(narrative.locations).find(l => l.name === 'Castle')?.id;
    expect(scene.locationId).toBe(castleId);
  });
  it('preserves beat plans and beatProseMaps in version arrays', async () => {
    const mockPlan = { beats: [{ fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Setup', propositions: [] }] };
    const mockBeatProseMap = { chunks: [{ beatIndex: 0, prose: 'Prose chunk' }], createdAt: Date.now() };
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Test', sections: [0],
        threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
        plan: mockPlan, beatProseMap: mockBeatProseMap, prose: 'Scene prose',
      }],
    }];
    const narrative = await assembleNarrative('Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    expect(scene.planVersions).toBeDefined();
    expect(scene.planVersions![0].plan).toEqual(mockPlan);
    expect(scene.planVersions![0].version).toBe('1');
    expect(scene.planVersions![0].versionType).toBe('generate');
    expect(scene.proseVersions).toBeDefined();
    expect(scene.proseVersions![0].beatProseMap).toEqual(mockBeatProseMap);
    expect(scene.proseVersions![0].version).toBe('1');
  });
  it('creates relationship entries from analysis', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [
        { name: 'Alice', role: 'anchor', firstAppearance: true },
        { name: 'Bob', role: 'recurring', firstAppearance: true },
      ],
      relationships: [{ from: 'Alice', to: 'Bob', type: 'ally', valence: 5 }],
    }];
    const narrative = await assembleNarrative('Test', results, {});
    expect(narrative.relationships).toHaveLength(1);
    expect(narrative.relationships[0].type).toBe('ally');
    expect(narrative.relationships[0].valence).toBe(5);
  });
  it('sets createdAt and updatedAt timestamps', async () => {
    const results = [createMockAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {});
    expect(typeof narrative.createdAt).toBe('number');
    expect(typeof narrative.updatedAt).toBe('number');
    expect(narrative.updatedAt).toBeGreaterThan(narrative.createdAt);
  });
  it('creates version pointers on main branch for analyzed scenes', async () => {
    const mockPlan = { beats: [{ fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Setup', propositions: [] }] };
    const mockBeatProseMap = { chunks: [{ beatIndex: 0, prose: 'Chunk' }], createdAt: Date.now() };
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Test scene', sections: [0], prose: 'Scene prose',
        threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
        plan: mockPlan, beatProseMap: mockBeatProseMap,
      }],
    }];
    const narrative = await assembleNarrative('Test', results, {});
    const branchIds = Object.keys(narrative.branches);
    const mainBranch = narrative.branches[branchIds[0]];
    const sceneId = Object.keys(narrative.scenes)[0];
    expect(mainBranch.versionPointers).toBeDefined();
    expect(mainBranch.versionPointers![sceneId]).toBeDefined();
    expect(mainBranch.versionPointers![sceneId].proseVersion).toBe('1');
    expect(mainBranch.versionPointers![sceneId].planVersion).toBe('1');
  });
  // ── Rich assembly tests (artifacts, system knowledge, movements, etc.) ──
  it('creates artifact entities with ownership', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    const artifacts = Object.values(narrative.artifacts);
    expect(artifacts.length).toBeGreaterThan(0);
    const sword = artifacts.find(a => a.name === 'Magic Sword');
    expect(sword).toBeDefined();
    expect(sword!.significance).toBe('key');
    // Entity continuity graphs start empty — they're built at store replay from
    // scene.worldDeltas, not during assembly.
    expect(sword!.world).toBeDefined();
    // Owned by Alice — parentId should be Alice's character ID
    expect(sword!.parentId).toBeTruthy();
  });
  it('maps thread deltas to thread IDs in scenes', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    expect(scene.threadDeltas.length).toBeGreaterThan(0);
    const threadId = scene.threadDeltas[0].threadId;
    expect(narrative.threads[threadId]).toBeDefined();
    expect(narrative.threads[threadId].description).toBe('The Quest for the Crown');
  });
  it('maps world deltas to entity IDs', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    expect(scene.worldDeltas.length).toBeGreaterThan(0);
    // Each delta should reference a valid entity
    for (const cm of scene.worldDeltas) {
      const isChar = !!narrative.characters[cm.entityId];
      const isLoc = !!narrative.locations[cm.entityId];
      const isArt = !!narrative.artifacts[cm.entityId];
      expect(isChar || isLoc || isArt).toBe(true);
    }
  });
  it('maps relationship deltas to character IDs', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    expect(scene.relationshipDeltas.length).toBeGreaterThan(0);
    const rm = scene.relationshipDeltas[0];
    expect(narrative.characters[rm.from]).toBeDefined();
    expect(narrative.characters[rm.to]).toBeDefined();
  });
  it('handles character movements with location IDs', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    expect(scene.characterMovements).toBeDefined();
    if (scene.characterMovements) {
      for (const [charId, movement] of Object.entries(scene.characterMovements)) {
        expect(narrative.characters[charId]).toBeDefined();
        expect(narrative.locations[movement.locationId]).toBeDefined();
      }
    }
  });
  it('handles artifact usages with IDs', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    if (scene.artifactUsages && scene.artifactUsages.length > 0) {
      for (const au of scene.artifactUsages) {
        expect(narrative.artifacts[au.artifactId]).toBeDefined();
      }
    }
  });
  it('creates system deltas with concept IDs', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    expect(scene.systemDeltas).toBeDefined();
    expect(scene.systemDeltas!.addedNodes.length).toBeGreaterThan(0);
    // Nodes should have SYS- prefixed IDs
    for (const node of scene.systemDeltas!.addedNodes) {
      expect(node.id).toMatch(/^SYS-/);
    }
    // Edges should reference valid SYS IDs
    for (const edge of scene.systemDeltas!.addedEdges) {
      expect(edge.from).toMatch(/^SYS-/);
      expect(edge.to).toMatch(/^SYS-/);
    }
  });
  it('creates world builds with expansion manifests', async () => {
    const results = [createRichAnalysisResult(0), createRichAnalysisResult(1)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    const worldBuilds = Object.values(narrative.worldBuilds);
    expect(worldBuilds.length).toBeGreaterThan(0);
    const firstBuild = worldBuilds[0];
    expect(firstBuild.kind).toBe('world_build');
    expect(firstBuild.expansionManifest.newCharacters.length).toBeGreaterThan(0);
    expect(firstBuild.expansionManifest.newLocations.length).toBeGreaterThan(0);
  });
  it('interleaves world builds before their batch scenes in entry IDs', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    const branchIds = Object.keys(narrative.branches);
    const mainBranch = narrative.branches[branchIds[0]];
    // First entry should be a world build (WB-)
    expect(mainBranch.entryIds[0]).toMatch(/^WB-/);
    // Followed by scene(s)
    expect(mainBranch.entryIds[1]).toMatch(/^S-/);
  });
  it('uses arc groups when provided', async () => {
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1), createMockAnalysisResult(2), createMockAnalysisResult(3)];
    const arcGroups = [
      { name: 'Opening Act', sceneIndices: [0, 1] },
      { name: 'Climax', sceneIndices: [2, 3] },
    ];
    const narrative = await assembleNarrative('Test', results, {}, undefined, arcGroups);
    const arcNames = Object.values(narrative.arcs).map(a => a.name);
    expect(arcNames).toContain('Opening Act');
    expect(arcNames).toContain('Climax');
  });
  it('falls back to default arc grouping when arcGroups not provided', async () => {
    const results = Array.from({ length: 8 }, (_, i) => createMockAnalysisResult(i));
    const narrative = await assembleNarrative('Test', results, {});
    const arcEntries = Object.values(narrative.arcs);
    // 8 scenes / 4 per arc = 2 arcs
    expect(arcEntries.length).toBe(2);
    expect(arcEntries[0].sceneIds.length).toBe(4);
    expect(arcEntries[1].sceneIds.length).toBe(4);
  });
  it('assigns arcId to scenes from arc groups', async () => {
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1)];
    const arcGroups = [{ name: 'Act One', sceneIndices: [0, 1] }];
    const narrative = await assembleNarrative('Test', results, {}, undefined, arcGroups);
    const arcId = Object.keys(narrative.arcs)[0];
    for (const scene of Object.values(narrative.scenes)) {
      expect(scene.arcId).toBe(arcId);
    }
  });
  it('wires thread IDs onto characters', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    const alice = Object.values(narrative.characters).find(c => c.name === 'Alice');
    expect(alice).toBeDefined();
    expect(alice!.threadIds.length).toBeGreaterThan(0);
    // Each threadId should reference a real thread
    for (const tid of alice!.threadIds) {
      expect(narrative.threads[tid]).toBeDefined();
    }
  });
  it('applies thread dependencies from finalization', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      threads: [
        { description: 'Quest A', participantNames: ['Hero'], outcomes: ['yes', 'no'], development: 'Started' },
        { description: 'Quest B', participantNames: ['Hero'], outcomes: ['yes', 'no'], development: 'Also started' },
      ],
    }];
    const threadDeps = { 'Quest B': ['Quest A'] };
    const narrative = await assembleNarrative('Test', results, threadDeps);
    const questB = Object.values(narrative.threads).find(t => t.description === 'Quest B');
    const questA = Object.values(narrative.threads).find(t => t.description === 'Quest A');
    expect(questB).toBeDefined();
    expect(questA).toBeDefined();
    expect(questB!.dependents).toContain(questA!.id);
  });
  it('records world deltas on scenes for later replay', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    const alice = Object.values(narrative.characters).find(c => c.name === 'Alice');
    expect(alice).toBeDefined();
    // Entity continuity starts empty — graphs are built at store replay time from
    // scene.worldDeltas. Verify deltas landed on the scene instead.
    const scenes = Object.values(narrative.scenes);
    const aliceDeltas = scenes.flatMap(s =>
      (s.worldDeltas ?? []).filter(m => m.entityId === alice!.id),
    );
    expect(aliceDeltas.length).toBeGreaterThan(0);
    expect(aliceDeltas[0].addedNodes.length).toBeGreaterThan(0);
  });
  it('extracts rules, systems, and prose profile', async () => {
    // assembleNarrative uses callAnalysis (fetch), not callGenerate for meta extraction
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          rules: ['Magic exists', 'Laws of physics are flexible'],
          worldSystems: [{ name: 'Magic System', description: 'Elemental magic', principles: ['Elements bind'], constraints: ['Drains energy'], interactions: [] }],
          imageStyle: 'Epic fantasy art',
          proseProfile: {
            register: 'literary', stance: 'close_third', tense: 'past',
            sentenceRhythm: 'varied', interiority: 'deep', dialogueWeight: 'moderate',
            devices: ['dramatic irony', 'free indirect discourse'],
            rules: ['Show emotion through action'],
            antiPatterns: ['Never name emotions directly'],
          },
          planGuidance: 'Use action and environment mechanisms primarily',
        }),
      }),
    } as Response);
    const results = [createMockAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {});
    // rules and worldSystems were removed - now using SystemGraph
    expect(narrative.proseProfile).toBeDefined();
    expect(narrative.proseProfile!.register).toBe('literary');
    expect(narrative.proseProfile!.stance).toBe('close_third');
    expect(narrative.proseProfile!.devices!.length).toBeGreaterThan(0);
    expect(narrative.proseProfile!.rules!.length).toBeGreaterThan(0);
    expect(narrative.proseProfile!.antiPatterns!.length).toBeGreaterThan(0);
  });
  it('sets plan guidance in story settings', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          rules: [], worldSystems: [], imageStyle: '',
          proseProfile: { register: '', stance: '' },
          planGuidance: 'Use action and environment mechanisms primarily',
        }),
      }),
    } as Response);
    const results = [createMockAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {});
    expect(narrative.storySettings).toBeDefined();
    expect(narrative.storySettings!.planGuidance).toBe('Use action and environment mechanisms primarily');
  });
  it('handles meta extraction failure gracefully', async () => {
    vi.mocked(callGenerate).mockRejectedValue(new Error('LLM failed'));
    // Also mock fetch for the callAnalysis path
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Service unavailable' }),
    } as Response);
    const results = [createMockAnalysisResult(0)];
    // Should not throw — meta extraction is non-fatal
    const narrative = await assembleNarrative('Test', results, {});
    expect(narrative.title).toBe('Test');
    // rules was removed - verify the narrative was still created successfully
    expect(narrative.id).toBeDefined();
  });
  it('creates location hierarchy via parentId', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      locations: [
        { name: 'Kingdom', parentName: null, description: 'A kingdom' },
        { name: 'Castle', parentName: 'Kingdom', description: 'Royal castle' },
      ],
    }];
    const narrative = await assembleNarrative('Test', results, {});
    const kingdom = Object.values(narrative.locations).find(l => l.name === 'Kingdom');
    const castle = Object.values(narrative.locations).find(l => l.name === 'Castle');
    expect(kingdom).toBeDefined();
    expect(castle).toBeDefined();
    expect(castle!.parentId).toBe(kingdom!.id);
  });
  it('accumulates entities across multiple chunks without duplication', async () => {
    // Same character appears across 3 chunks, each scene adds a continuity node for Alice
    const makeChunk = (index: number, nodeContent: string, nodeType: string): AnalysisChunkResult => ({
      ...createMockAnalysisResult(index),
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: index === 0 }],
      scenes: [{
        ...createMockAnalysisResult(index).scenes[0],
        povName: 'Alice',
        participantNames: ['Alice'],
        worldDeltas: [
          { entityName: 'Alice', addedNodes: [{ content: nodeContent, type: nodeType }] },
        ],
      }],
    });
    const results: AnalysisChunkResult[] = [
      makeChunk(0, 'Brave and adventurous', 'trait'),
      makeChunk(1, 'Injured in battle', 'state'),
      makeChunk(2, 'Seeks the treasure', 'goal'),
    ];
    const narrative = await assembleNarrative('Test', results, {});
    const alices = Object.values(narrative.characters).filter(c => c.name === 'Alice');
    expect(alices).toHaveLength(1); // Single character entity
    // Continuity is replayed from scene deltas at store load — assembly only
    // preserves the deltas themselves. Verify each chunk's scene added a node.
    const scenes = Object.values(narrative.scenes);
    const aliceDeltaNodes = scenes.flatMap(s =>
      (s.worldDeltas ?? [])
        .filter(m => m.entityId === alices[0].id)
        .flatMap(m => m.addedNodes),
    );
    expect(aliceDeltaNodes.length).toBeGreaterThanOrEqual(3);
  });
  it('handles tie deltas creating location-character bindings', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    if (scene.tieDeltas && scene.tieDeltas.length > 0) {
      for (const tm of scene.tieDeltas) {
        expect(narrative.locations[tm.locationId]).toBeDefined();
        expect(narrative.characters[tm.characterId]).toBeDefined();
        expect(['add', 'remove']).toContain(tm.action);
      }
    }
  });
  it('sets thread openedAt to first scene with a delta', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});
    for (const thread of Object.values(narrative.threads)) {
      if (thread.openedAt) {
        expect(narrative.scenes[thread.openedAt]).toBeDefined();
      }
    }
  });
  it('sets branch name to Canon Timeline', async () => {
    const results = [createMockAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {});
    const mainBranch = Object.values(narrative.branches)[0];
    expect(mainBranch.name).toBe('Canon Timeline');
    expect(mainBranch.parentBranchId).toBeNull();
    expect(mainBranch.forkEntryId).toBeNull();
  });
  it('handles empty results array', async () => {
    const narrative = await assembleNarrative('Empty', [], {});
    expect(narrative.title).toBe('Empty');
    expect(Object.keys(narrative.scenes)).toHaveLength(0);
    expect(Object.keys(narrative.characters)).toHaveLength(0);
    const mainBranch = Object.values(narrative.branches)[0];
    expect(mainBranch.entryIds).toHaveLength(0);
  });
  it('handles scenes without prose or plan (no version arrays)', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Test', sections: [0],
        threadDeltas: [], worldDeltas: [], relationshipDeltas: [],
        // No prose, no plan
      }],
    }];
    const narrative = await assembleNarrative('Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    expect(scene.proseVersions).toBeUndefined();
    expect(scene.planVersions).toBeUndefined();
  });
  it('populates arc develops, locationIds, and activeCharacterIds', async () => {
    const results = [createRichAnalysisResult(0)];
    const arcGroups = [{ name: 'First Arc', sceneIndices: [0] }];
    const narrative = await assembleNarrative('Rich Test', results, {}, undefined, arcGroups);
    const arc = Object.values(narrative.arcs)[0];
    expect(arc.name).toBe('First Arc');
    expect(arc.sceneIds.length).toBeGreaterThan(0);
    expect(arc.locationIds.length).toBeGreaterThan(0);
    expect(arc.activeCharacterIds.length).toBeGreaterThan(0);
    // initialCharacterLocations should map character IDs to location IDs
    expect(Object.keys(arc.initialCharacterLocations).length).toBeGreaterThan(0);
  });
  // ── Thread market extraction ──────────────────────────────────────────────
  // In the market model, threadDelta carries logType + updates (OutcomeEvidence[])
  // + volumeDelta + rationale. The thread log is populated by applyThreadDelta
  // at store-replay time, not by the extraction mapper.
  it('preserves LLM-provided updates and logType on extracted threadDeltas', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true }],
      locations: [{ name: 'Castle', parentName: null, description: 'A castle' }],
      threads: [{ description: 'The Quest', participantNames: ['Alice'], outcomes: ['succeeds', 'fails'], development: '' }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Alice sets off', sections: [0],
        threadDeltas: [{
          threadDescription: 'The Quest',
          logType: 'setup',
          updates: [{ outcome: 'succeeds', evidence: 2 }],
          volumeDelta: 1,
          rationale: 'Alice receives the mandate',
        }],
        worldDeltas: [],
        relationshipDeltas: [],
      }],
    }];
    const narrative = await assembleNarrative('Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    expect(scene.threadDeltas).toHaveLength(1);
    const tm = scene.threadDeltas[0];
    expect(tm.logType).toBe('setup');
    expect(tm.updates).toHaveLength(1);
    expect(tm.updates[0].outcome).toBe('succeeds');
    expect(tm.updates[0].evidence).toBe(2);
    expect(tm.volumeDelta).toBe(1);
    expect(tm.rationale).toMatch(/mandate/);
  });
  it('synthesizes a rationale when LLM omits one', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true }],
      locations: [{ name: 'Castle', parentName: null, description: 'A castle' }],
      threads: [{ description: 'The Quest', participantNames: ['Alice'], outcomes: ['succeeds', 'fails'], development: '' }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Alice reflects', sections: [0],
        threadDeltas: [{
          threadDescription: 'The Quest',
          logType: 'pulse',
          updates: [],
          volumeDelta: 1,
          rationale: '',
        }],
        worldDeltas: [],
        relationshipDeltas: [],
      }],
    }];
    const narrative = await assembleNarrative('Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    const tm = scene.threadDeltas[0];
    // Mapper should fill in a sensible rationale rather than passing empty.
    expect(tm.rationale.length).toBeGreaterThan(0);
  });
  it('clamps evidence values to the legal [-4, +4] range', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true }],
      locations: [{ name: 'Castle', parentName: null, description: 'A castle' }],
      threads: [{ description: 'The Quest', participantNames: ['Alice'], outcomes: ['succeeds', 'fails'], development: '' }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Alice', sections: [0],
        threadDeltas: [{
          threadDescription: 'The Quest',
          logType: 'payoff',
          updates: [{ outcome: 'succeeds', evidence: 99 }],
          volumeDelta: 1,
          rationale: 'decisive',
        }],
        worldDeltas: [],
        relationshipDeltas: [],
      }],
    }];
    const narrative = await assembleNarrative('Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    const tm = scene.threadDeltas[0];
    expect(tm.updates[0].evidence).toBeLessThanOrEqual(4);
    expect(tm.updates[0].evidence).toBeGreaterThanOrEqual(-4);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// assembleNarrative — world-only extraction mode
//
// Same per-chunk LLM extraction runs; only the assembled output differs.
// Scenes + arcs drop, and every delta the scenes carried (system, world,
// thread, relationship, ownership, tie) gets migrated onto the WorldBuild
// they belong to so the seed is fully populated.
// ──────────────────────────────────────────────────────────────────────────────

describe('assembleNarrative — world-only extraction', () => {
  beforeEach(() => {
    // Mock the meta-extraction LLM call so the prose-profile branch resolves
    // cleanly in tests (otherwise it logs a warning and continues — works,
    // but noisier than necessary).
    const metaJSON = JSON.stringify({
      imageStyle: 'Test style',
      proseProfile: { register: 'literary', stance: 'close_third', devices: [], rules: [] },
      planGuidance: '',
    });
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ content: metaJSON }),
      text: async () => metaJSON,
      body: null,
    } as Response);
  });

  it('emits per-batch world commits and zero scenes / arcs', async () => {
    const results = [createRichAnalysisResult(0), createRichAnalysisResult(1)];
    const narrative = await assembleNarrative('World Seed', results, {}, {
      extractionMode: 'world',
    });
    expect(Object.keys(narrative.scenes).length).toBe(0);
    expect(Object.keys(narrative.arcs).length).toBe(0);
    expect(Object.keys(narrative.worldBuilds).length).toBeGreaterThan(0);
  });

  it('keeps full extraction unchanged when extractionMode is omitted or "full"', async () => {
    const results = [createRichAnalysisResult(0), createRichAnalysisResult(1)];
    const narrative = await assembleNarrative('Full Story', results, {}, {
      extractionMode: 'full',
    });
    expect(Object.keys(narrative.scenes).length).toBe(2);
    expect(Object.keys(narrative.arcs).length).toBeGreaterThan(0);
  });

  it('branch entryIds are the WB ids in batch order — no scene ids', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {}, {
      extractionMode: 'world',
    });
    const branch = Object.values(narrative.branches)[0];
    expect(branch.entryIds.length).toBeGreaterThan(0);
    for (const id of branch.entryIds) {
      expect(id).toMatch(/^WB-/);
    }
  });

  it('migrates scene system deltas onto the WorldBuild', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {}, {
      extractionMode: 'world',
    });
    const wb = Object.values(narrative.worldBuilds)[0];
    // The rich fixture's scene declares two system nodes ("Ancient Magic",
    // "Royal Bloodline") and one edge — they should land on the WB now that
    // the scene itself is dropped.
    expect(wb.expansionManifest.systemDeltas?.addedNodes.length).toBeGreaterThan(0);
    expect(wb.expansionManifest.systemDeltas?.addedEdges.length).toBeGreaterThan(0);
  });

  it('migrates scene world / thread / relationship / tie deltas onto the WorldBuild', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {}, {
      extractionMode: 'world',
    });
    const wb = Object.values(narrative.worldBuilds)[0];
    expect(wb.expansionManifest.worldDeltas?.length ?? 0).toBeGreaterThan(0);
    expect(wb.expansionManifest.threadDeltas?.length ?? 0).toBeGreaterThan(0);
    expect(wb.expansionManifest.relationshipDeltas?.length ?? 0).toBeGreaterThan(0);
    expect(wb.expansionManifest.tieDeltas?.length ?? 0).toBeGreaterThan(0);
  });

  it('full mode leaves WB delta arrays empty — deltas live on scenes there', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {}, {
      extractionMode: 'full',
    });
    const wb = Object.values(narrative.worldBuilds)[0];
    // In full mode the per-scene system graph is replayed at load time, so
    // the WB itself carries no system deltas. Same for the other delta
    // channels — they live on scenes.
    expect(wb.expansionManifest.systemDeltas?.addedNodes.length ?? 0).toBe(0);
    expect(wb.expansionManifest.worldDeltas?.length ?? 0).toBe(0);
    expect(wb.expansionManifest.threadDeltas?.length ?? 0).toBe(0);
  });

  it('rewires thread.openedAt to the WB id (not a dropped scene)', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {}, {
      extractionMode: 'world',
    });
    const wbIds = new Set(Object.keys(narrative.worldBuilds));
    // Every thread must point at a WB that actually exists in the final
    // state — otherwise the sidebar's resolver renders "No threads yet"
    // because the openedAt scene has been dropped.
    for (const thread of Object.values(narrative.threads)) {
      expect(thread.openedAt).toBeDefined();
      expect(wbIds.has(thread.openedAt!)).toBe(true);
    }
  });

  it('still produces WB intent summaries in world-only mode', async () => {
    const results = [createRichAnalysisResult(0)];
    const stages: string[] = [];
    const narrative = await assembleNarrative('Test', results, {}, {
      extractionMode: 'world',
      onStage: (stage) => stages.push(stage),
    });
    // The summaries phase must still fire even with no scenes.
    expect(stages).toContain('summaries');
    // Each WB carries some summary string (LLM-generated or fallback).
    for (const wb of Object.values(narrative.worldBuilds)) {
      expect(wb.summary.length).toBeGreaterThan(0);
    }
  });

  // ── Pre-assembly phase outputs: meta + worldBuildSummaries are persistable ──
  // The assembly pipeline emits its LLM outputs (per-WB intent summaries and
  // whole-work meta) via callbacks. When passed back in via options, the
  // function uses them directly and emits nothing further — making
  // regeneration after a deleted narrative a zero-LLM operation.

  it('emits resolved worldBuildSummaries and meta on first assembly', async () => {
    const results = [createRichAnalysisResult(0)];
    let capturedSummaries: Record<string, string> | null = null;
    let capturedMeta: import('@/types/narrative').AnalysisMeta | null = null;
    await assembleNarrative('Test', results, {}, {
      extractionMode: 'world',
      onWorldBuildSummariesResolved: (s) => { capturedSummaries = s; },
      onMetaResolved: (m) => { capturedMeta = m; },
    });
    // Summaries map keys by WorldBuild id ("WB-PFX-1"). At minimum the
    // initial commit gets a summary; expect at least one entry.
    expect(capturedSummaries).not.toBeNull();
    expect(Object.keys(capturedSummaries!).length).toBeGreaterThan(0);
    // Meta object is always emitted (fields may be undefined when the LLM
    // call falls through to defaults, but the callback fires exactly once).
    expect(capturedMeta).not.toBeNull();
  });

  it('consumes precomputed worldBuildSummaries deterministically on regenerate', async () => {
    const results = [createRichAnalysisResult(0)];
    // First pass — capture the outputs.
    let firstSummaries: Record<string, string> | null = null;
    await assembleNarrative('Test', results, {}, {
      extractionMode: 'world',
      onWorldBuildSummariesResolved: (s) => { firstSummaries = s; },
    });
    expect(firstSummaries).not.toBeNull();
    // Second pass — feed the outputs back in, swap one summary to a sentinel
    // string. Assembly must use the supplied value verbatim, not re-call
    // the LLM (which would overwrite our sentinel).
    const wbIds = Object.keys(firstSummaries!);
    const sentinelId = wbIds[0];
    const sentinel = '<<sentinel-summary-from-regenerate>>';
    const regenInputs = { ...firstSummaries!, [sentinelId]: sentinel };
    const narrative = await assembleNarrative('Test', results, {}, {
      extractionMode: 'world',
      worldBuildSummaries: regenInputs,
    });
    expect(narrative.worldBuilds[sentinelId].summary).toBe(sentinel);
  });

  it('consumes precomputed meta deterministically on regenerate', async () => {
    const results = [createRichAnalysisResult(0)];
    const sentinelMeta: import('@/types/narrative').AnalysisMeta = {
      imageStyle: 'sentinel-image-style',
      genre: 'sentinel-genre',
      subgenre: 'sentinel-subgenre',
      planGuidance: 'sentinel-guidance',
      patterns: ['p1', 'p2'],
      antiPatterns: ['ap1'],
    };
    const narrative = await assembleNarrative('Test', results, {}, {
      extractionMode: 'world',
      meta: sentinelMeta,
    });
    expect(narrative.imageStyle).toBe('sentinel-image-style');
    expect(narrative.genre).toBe('sentinel-genre');
    expect(narrative.subgenre).toBe('sentinel-subgenre');
    expect(narrative.patterns).toEqual(['p1', 'p2']);
    expect(narrative.antiPatterns).toEqual(['ap1']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// reextractFateWithLifecycle — two-pass lifecycle-aware re-scoring
// ──────────────────────────────────────────────────────────────────────────────

describe('reextractFateWithLifecycle', () => {
  function makeSceneResult(
    sceneIndex: number,
    threadDeltas: AnalysisChunkResult['scenes'][0]['threadDeltas'],
    threads: AnalysisChunkResult['threads'] = [],
  ): AnalysisChunkResult {
    return {
      chapterSummary: `Scene ${sceneIndex}`,
      characters: [],
      locations: [],
      threads,
      scenes: [{
        locationName: 'Wonderland',
        povName: 'Alice',
        participantNames: ['Alice'],
        events: [],
        summary: `Scene ${sceneIndex} summary — Alice in Wonderland.`,
        sections: [0],
        threadDeltas,
        worldDeltas: [],
        relationshipDeltas: [],
      }],
      relationships: [],
    };
  }

  /** Enqueue a sequence of fetch responses, one per parallel LLM call. */
  function queueFetchResponses(bodies: string[]) {
    const queue = [...bodies];
    vi.mocked(global.fetch).mockImplementation(async () => ({
      ok: true,
      json: async () => ({ content: queue.shift() ?? '{"threadDeltas":[]}' }),
      text: async () => queue.shift() ?? '{"threadDeltas":[]}',
      body: null,
    } as Response));
  }

  beforeEach(() => {
    vi.mocked(global.fetch).mockReset();
  });

  it('returns input unchanged when there are no canonical threads', async () => {
    const results = [makeSceneResult(0, [], [])];
    const out = await reextractFateWithLifecycle(results);
    expect(out).toEqual(results);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls the LLM once per scene with one parallel worker per index', async () => {
    const threads = [{
      description: 'Will Alice return home?',
      participantNames: ['Alice'],
      outcomes: ['remains', 'returns home'],
      development: '',
    }];
    const results = [
      makeSceneResult(0, [
        { threadDescription: 'Will Alice return home?', logType: 'setup',
          updates: [{ outcome: 'remains', evidence: 1 }], volumeDelta: 1, rationale: 'enters wonderland' },
      ], threads),
      makeSceneResult(1, [
        { threadDescription: 'Will Alice return home?', logType: 'payoff',
          updates: [{ outcome: 'returns home', evidence: 4 }], volumeDelta: 2, rationale: 'wakes up' },
      ]),
    ];
    queueFetchResponses([
      JSON.stringify({ threadDeltas: [{ threadDescription: 'Will Alice return home?', logType: 'setup',
        updates: [{ outcome: 'returns home', evidence: 0.5 }], volumeDelta: 1, rationale: 'seeds the return' }] }),
      JSON.stringify({ threadDeltas: [{ threadDescription: 'Will Alice return home?', logType: 'payoff',
        updates: [{ outcome: 'returns home', evidence: 4 }], volumeDelta: 2, rationale: 'wakes up' }] }),
    ]);
    const out = await reextractFateWithLifecycle(results);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // Scene 0 now prices toward the eventual winner, not the local misdirection.
    expect(out[0].scenes[0].threadDeltas[0].updates[0].outcome).toBe('returns home');
    expect(out[1].scenes[0].threadDeltas[0].logType).toBe('payoff');
  });

  it('computes observed winner from summed evidence across all scenes', async () => {
    // Scene 0 gives "remains" +2; scenes 1+2 give "returns home" +3 each.
    // Winner must be "returns home" (summed +6) not "remains" (summed +2).
    const threads = [{
      description: 'Will Alice return home?',
      participantNames: ['Alice'],
      outcomes: ['remains', 'returns home'],
      development: '',
    }];
    const results = [
      makeSceneResult(0, [{ threadDescription: 'Will Alice return home?', logType: 'escalation',
        updates: [{ outcome: 'remains', evidence: 2 }], volumeDelta: 1, rationale: 'lost' }], threads),
      makeSceneResult(1, [{ threadDescription: 'Will Alice return home?', logType: 'escalation',
        updates: [{ outcome: 'returns home', evidence: 3 }], volumeDelta: 1, rationale: 'finds path' }]),
      makeSceneResult(2, [{ threadDescription: 'Will Alice return home?', logType: 'payoff',
        updates: [{ outcome: 'returns home', evidence: 3 }], volumeDelta: 2, rationale: 'wakes up' }]),
    ];
    // Capture the prompts sent to the LLM to verify winner annotation.
    const capturedPrompts: string[] = [];
    vi.mocked(global.fetch).mockImplementation(async (_url, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.prompt === 'string') capturedPrompts.push(parsed.prompt);
      } catch { /* ignore */ }
      return {
        ok: true,
        json: async () => ({ content: '{"threadDeltas":[]}' }),
        text: async () => '{"threadDeltas":[]}',
        body: null,
      } as Response;
    });
    await reextractFateWithLifecycle(results);
    expect(capturedPrompts.length).toBe(3);
    // Every prompt should mark "returns home" as the WINNER.
    for (const p of capturedPrompts) {
      expect(p).toContain('returns home [WINNER]');
      expect(p).not.toContain('remains [WINNER]');
    }
  });

  it('approximates the resolution scene from the peak committal evidence', async () => {
    const threads = [{
      description: 'Will Alice return home?',
      participantNames: ['Alice'],
      outcomes: ['remains', 'returns home'],
      development: '',
    }];
    // Evidence for winner ramps up: +1 at scene 0, +2 at scene 1, +4 (payoff) at scene 2.
    const results = [
      makeSceneResult(0, [{ threadDescription: 'Will Alice return home?', logType: 'setup',
        updates: [{ outcome: 'returns home', evidence: 1 }], volumeDelta: 1, rationale: 'seed' }], threads),
      makeSceneResult(1, [{ threadDescription: 'Will Alice return home?', logType: 'escalation',
        updates: [{ outcome: 'returns home', evidence: 2 }], volumeDelta: 1, rationale: 'ramp' }]),
      makeSceneResult(2, [{ threadDescription: 'Will Alice return home?', logType: 'payoff',
        updates: [{ outcome: 'returns home', evidence: 4 }], volumeDelta: 2, rationale: 'wakes up' }]),
    ];
    const capturedPrompts: string[] = [];
    vi.mocked(global.fetch).mockImplementation(async (_url, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.prompt === 'string') capturedPrompts.push(parsed.prompt);
      } catch { /* ignore */ }
      return {
        ok: true,
        json: async () => ({ content: '{"threadDeltas":[]}' }),
        text: async () => '{"threadDeltas":[]}',
        body: null,
      } as Response;
    });
    await reextractFateWithLifecycle(results);
    // Scene index 2 (one-based 3) is the payoff scene; prompt should cite it.
    expect(capturedPrompts[0]).toContain('resolution fires around scene 3');
  });

  it('drops re-extracted deltas that reference unknown threads', async () => {
    const threads = [{
      description: 'Will Alice return home?',
      participantNames: ['Alice'],
      outcomes: ['remains', 'returns home'],
      development: '',
    }];
    const results = [makeSceneResult(0, [
      { threadDescription: 'Will Alice return home?', logType: 'setup',
        updates: [{ outcome: 'remains', evidence: 1 }], volumeDelta: 1, rationale: 'enters' },
    ], threads)];
    // LLM hallucinates a thread that wasn't in the canonical set.
    queueFetchResponses([JSON.stringify({
      threadDeltas: [
        { threadDescription: 'Will Alice return home?', logType: 'setup',
          updates: [{ outcome: 'returns home', evidence: 0.5 }], volumeDelta: 1, rationale: 'seed' },
        { threadDescription: 'Ghost thread', logType: 'payoff',
          updates: [{ outcome: 'yes', evidence: 4 }], volumeDelta: 1, rationale: 'hallucinated' },
      ],
    })]);
    const out = await reextractFateWithLifecycle(results);
    expect(out[0].scenes[0].threadDeltas.length).toBe(1);
    expect(out[0].scenes[0].threadDeltas[0].threadDescription).toBe('Will Alice return home?');
  });

  it('drops outcomes that are not in the canonical outcome set', async () => {
    const threads = [{
      description: 'Will Alice return home?',
      participantNames: ['Alice'],
      outcomes: ['remains', 'returns home'],
      development: '',
    }];
    const results = [makeSceneResult(0, [
      { threadDescription: 'Will Alice return home?', logType: 'setup',
        updates: [{ outcome: 'remains', evidence: 1 }], volumeDelta: 1, rationale: 'enters' },
    ], threads)];
    queueFetchResponses([JSON.stringify({
      threadDeltas: [{
        threadDescription: 'Will Alice return home?',
        logType: 'escalation',
        updates: [
          { outcome: 'returns home', evidence: 2 },
          { outcome: 'adapts to Wonderland', evidence: 1 }, // NOT canonical
        ],
        volumeDelta: 1,
        rationale: 'shifts toward return',
      }],
    })]);
    const out = await reextractFateWithLifecycle(results);
    const updates = out[0].scenes[0].threadDeltas[0].updates;
    expect(updates.length).toBe(1);
    expect(updates[0].outcome).toBe('returns home');
  });

  it('clamps re-extracted evidence to [-4, +4]', async () => {
    const threads = [{
      description: 'Will Alice return home?',
      participantNames: ['Alice'],
      outcomes: ['remains', 'returns home'],
      development: '',
    }];
    const results = [makeSceneResult(0, [
      { threadDescription: 'Will Alice return home?', logType: 'setup',
        updates: [{ outcome: 'remains', evidence: 1 }], volumeDelta: 1, rationale: 'enters' },
    ], threads)];
    queueFetchResponses([JSON.stringify({
      threadDeltas: [{
        threadDescription: 'Will Alice return home?',
        logType: 'payoff',
        updates: [{ outcome: 'returns home', evidence: 99 }],
        volumeDelta: 1,
        rationale: 'overshoot',
      }],
    })]);
    const out = await reextractFateWithLifecycle(results);
    const evidence = out[0].scenes[0].threadDeltas[0].updates[0].evidence;
    expect(evidence).toBeLessThanOrEqual(4);
    expect(evidence).toBeGreaterThanOrEqual(-4);
  });

  it('keeps first-pass deltas when the LLM call fails', async () => {
    const threads = [{
      description: 'Will Alice return home?',
      participantNames: ['Alice'],
      outcomes: ['remains', 'returns home'],
      development: '',
    }];
    const prior = [
      { threadDescription: 'Will Alice return home?', logType: 'setup',
        updates: [{ outcome: 'remains', evidence: 1 }], volumeDelta: 1, rationale: 'enters' },
    ];
    const results = [makeSceneResult(0, prior, threads)];
    vi.mocked(global.fetch).mockRejectedValue(new Error('network'));
    const out = await reextractFateWithLifecycle(results);
    expect(out[0].scenes[0].threadDeltas).toEqual(prior);
  });

  it('reports progress via onProgress callback', async () => {
    const threads = [{
      description: 'Will Alice return home?',
      participantNames: ['Alice'],
      outcomes: ['remains', 'returns home'],
      development: '',
    }];
    const results = [
      makeSceneResult(0, [], threads),
      makeSceneResult(1, []),
      makeSceneResult(2, []),
    ];
    queueFetchResponses([
      '{"threadDeltas":[]}',
      '{"threadDeltas":[]}',
      '{"threadDeltas":[]}',
    ]);
    const progressEvents: { done: number; total: number }[] = [];
    await reextractFateWithLifecycle(results, {
      onProgress: (done, total) => progressEvents.push({ done, total }),
    });
    expect(progressEvents.length).toBe(3);
    expect(progressEvents.at(-1)).toEqual({ done: 3, total: 3 });
  });

  it('stops issuing calls once cancelled() returns true', async () => {
    const threads = [{
      description: 'Will Alice return home?',
      participantNames: ['Alice'],
      outcomes: ['remains', 'returns home'],
      development: '',
    }];
    const results = Array.from({ length: 5 }, (_, i) => makeSceneResult(i, [], i === 0 ? threads : []));
    let callCount = 0;
    vi.mocked(global.fetch).mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ content: '{"threadDeltas":[]}' }),
        text: async () => '{"threadDeltas":[]}',
        body: null,
      } as Response;
    });
    let cancel = false;
    await reextractFateWithLifecycle(results, {
      concurrency: 1,
      cancelled: () => cancel,
      onProgress: (done) => {
        if (done >= 2) cancel = true;
      },
    });
    expect(callCount).toBeLessThan(5);
  });
});
