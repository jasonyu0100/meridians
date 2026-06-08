/**
 * Search Synthesis Tests
 *
 * Both search modes answer in academic prose and attribute to database
 * entities in the same entity-ref citation style as chat (`Aragorn [C-1]`).
 * The citations are resolved from the answer text at DISPLAY time, so
 * `synthesizeSearchResults` returns an empty structured `citations` array —
 * these tests cover the prompt assembly (retrieved evidence + entity roster),
 * streaming, and the error fallback.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { synthesizeSearchResults } from '@/lib/ai/search-synthesis';
import type { NarrativeState, SearchResult } from '@/types/narrative';
import * as apiModule from '@/lib/ai/api';
// Mock modules
vi.mock('@/lib/ai/api');
vi.mock('@/lib/core/system-logger');
describe('synthesizeSearchResults', () => {
  let mockNarrative: NarrativeState;
  let mockSceneResults: SearchResult[];
  let mockDetailResults: SearchResult[];
  let mockTopArc: { arcId: string; avgSimilarity: number };
  let mockTopScene: { sceneId: string; similarity: number };
  let mockTimeline: Array<{ sceneIndex: number; maxSimilarity: number }>;
  beforeEach(() => {
    vi.clearAllMocks();
    mockNarrative = {
      id: 'test-narrative',
      title: 'Test Story',
      description: 'A test narrative',
      worldSummary: '',
      artifacts: {},
      characters: {},
      locations: {},
      threads: {},
      arcs: {
        arc1: {
          id: 'arc1',
          name: 'Act I',
          sceneIds: ['scene1', 'scene2'],
          develops: [],
          locationIds: [],
          activeCharacterIds: [],
        },
      },
      scenes: {},
      worldBuilds: {},
      branches: {
        main: {
          id: 'main',
          name: 'main',
          parentBranchId: null,
          forkEntryId: null,
          entryIds: [],
          createdAt: 0,
        },
      },
      relationships: [],
      systemGraph: { nodes: {}, edges: [] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // Split results into scene-level and detail-level
    mockSceneResults = [
      {
        type: 'scene',
        id: 'scene2-scene',
        sceneId: 'scene2',
        content: 'Hero faces a challenge',
        similarity: 0.82,
        context: 'Hero faces a challenge',
      },
    ];
    mockDetailResults = [
      {
        type: 'proposition',
        id: 'scene1-0-0',
        sceneId: 'scene1',
        beatIndex: 0,
        propIndex: 0,
        content: 'The castle gates swing open',
        similarity: 0.95,
        context: 'Beat 1: Hero enters the castle',
      },
      {
        type: 'proposition',
        id: 'scene1-1-0',
        sceneId: 'scene1',
        beatIndex: 1,
        propIndex: 0,
        content: 'King reveals the prophecy',
        similarity: 0.88,
        context: 'Beat 2: King reveals the prophecy',
      },
    ];
    mockTopArc = {
      arcId: 'arc1',
      avgSimilarity: 0.85,
    };
    mockTopScene = {
      sceneId: 'scene1',
      similarity: 0.90,
    };
    mockTimeline = [
      { sceneIndex: 0, maxSimilarity: 0.90 },
      { sceneIndex: 1, maxSimilarity: 0.82 },
      { sceneIndex: 2, maxSimilarity: 0.75 },
    ];
    // Default successful response — prose with entity-ref + numeric-looking
    // markers, to confirm we DON'T parse them into structured citations.
    vi.mocked(apiModule.callGenerateStream).mockImplementation(
      async (_prompt: string, _system: string, onToken: (token: string) => void): Promise<string> => {
        const response =
          'The search reveals key moments in the journey [1]. The castle entrance [2] and the prophecy revelation [3] are central themes.';
        if (onToken) {
          for (const char of response) onToken(char);
        }
        return response;
      }
    );
  });
  it('should call AI API with the retrieved evidence and query', async () => {
    const query = 'castle entrance';
    await synthesizeSearchResults(
      mockNarrative,
      query,
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );
    expect(apiModule.callGenerateStream).toHaveBeenCalled();
    const callArgs = vi.mocked(apiModule.callGenerateStream).mock.calls[0];
    const [prompt] = callArgs;
    expect(prompt).toContain('TOP PROPOSITIONS');
    expect(prompt).toContain('citable-entities');
    expect(prompt).toContain(query);
  });
  it('should include the retrieved propositions in the context', async () => {
    await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );
    const [prompt] = vi.mocked(apiModule.callGenerateStream).mock.calls[0];
    expect(prompt).toContain('The castle gates swing open');
    expect(prompt).toContain('King reveals the prophecy');
  });
  it('should stream tokens to callback', async () => {
    const onToken = vi.fn();
    await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline,
      onToken
    );
    expect(onToken).toHaveBeenCalled();
  });
  it('should return the overview and an empty structured citation list', async () => {
    const result = await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );
    expect(typeof result.overview).toBe('string');
    expect(result.overview.length).toBeGreaterThan(0);
    // Attribution is resolved from entity-ref citations at render time — no
    // numeric citation index is returned, even though the answer text contains
    // bracketed markers.
    expect(Array.isArray(result.citations)).toBe(true);
    expect(result.citations.length).toBe(0);
  });
  it('should include the most relevant arc in the context', async () => {
    await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );
    const [prompt] = vi.mocked(apiModule.callGenerateStream).mock.calls[0];
    expect(prompt).toContain('MOST RELEVANT ARC');
    expect(prompt).toContain('Act I');
  });
  it('should handle synthesis errors with fallback', async () => {
    vi.mocked(apiModule.callGenerateStream).mockRejectedValue(new Error('API error'));
    const result = await synthesizeSearchResults(
      mockNarrative,
      'test query',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );
    // Fallback overview references the query + the top arc; no citations.
    expect(result.overview).toContain('test query');
    expect(result.overview).toContain('Act I');
    expect(result.citations.length).toBe(0);
  });
  it('should handle null top arc gracefully', async () => {
    const result = await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      null,
      mockTopScene,
      mockTimeline
    );
    expect(result.overview).toBeDefined();
    expect(result.citations).toBeDefined();
  });
  it('should handle empty results', async () => {
    vi.mocked(apiModule.callGenerateStream).mockRejectedValue(new Error('No results'));
    const result = await synthesizeSearchResults(
      mockNarrative,
      'test',
      [],
      [],
      null,
      null,
      []
    );
    expect(result.overview).toBeDefined();
    expect(result.citations.length).toBe(0);
  });
  it('should not call onToken if not provided', async () => {
    await expect(
      synthesizeSearchResults(
        mockNarrative,
        'test',
        mockSceneResults,
        mockDetailResults,
        mockTopArc,
        mockTopScene,
        mockTimeline
      )
    ).resolves.toBeDefined();
  });
});
