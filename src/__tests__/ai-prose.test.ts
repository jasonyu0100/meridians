import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rewriteSceneProse } from '@/lib/ai/prose';
import type { NarrativeState, Scene } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';
// Mock all AI dependencies
vi.mock('@/lib/ai/api', () => ({
  callGenerate: vi.fn(),
  callGenerateStream: vi.fn(),
  resolveReasoningBudget: vi.fn(() => 0),
  resolveWebsearch: vi.fn(() => null),
  SYSTEM_PROMPT: 'Mock system prompt',
}));
vi.mock('@/lib/ai/context', () => ({
  sceneContext: vi.fn(() => 'Mock scene context block'),
  buildProseProfile: vi.fn(() => 'PROSE PROFILE\nVoice: literary, close third'),
}));
vi.mock('@/lib/ai/json', () => ({
  parseJson: vi.fn(),
}));
// Mock embeddings module — dynamic imports in ai/prose.ts would otherwise hit
// a real fetch('/api/embeddings') which fails with Invalid URL in the Node
// test env. Stub returns 1536-dim zero vectors so downstream code is happy.
vi.mock('@/lib/embeddings', () => ({
  generateEmbeddings: vi.fn(async (texts: string[]) =>
    texts.map(() => new Array(1536).fill(0)),
  ),
  generateEmbeddingsBatch: vi.fn(async (texts: string[]) =>
    texts.map(() => new Array(1536).fill(0)),
  ),
  embedPropositions: vi.fn(async (props: unknown[]) => props),
  computeCentroid: vi.fn(() => new Array(1536).fill(0)),
  resolveEmbedding: vi.fn(async () => null),
  resolveEmbeddingsBatch: vi.fn(async () => new Map()),
  cosineSimilarity: vi.fn(() => 0),
}));
import { callGenerate, callGenerateStream } from '@/lib/ai/api';
import { sceneContext } from '@/lib/ai/context';
import { parseJson } from '@/lib/ai/json';
// Helper to create minimal narrative
function createMinimalNarrative(): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test Story',
    description: 'A test story',
    worldSummary: 'A test world with magic and adventure.',
    characters: {
      'C-1': { id: 'C-1', name: 'Hero', role: 'anchor', world: { nodes: {}, edges: [] }, threadIds: [] },
      'C-2': { id: 'C-2', name: 'Mentor', role: 'recurring', world: { nodes: {}, edges: [] }, threadIds: [] },
    },
    locations: {
      'L-1': { id: 'L-1', name: 'Village', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], world: { nodes: {}, edges: [] }, threadIds: [] },
      'L-2': { id: 'L-2', name: 'Forest', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], world: { nodes: {}, edges: [] }, threadIds: [] },
    },
    threads: {
      'T-1': { id: 'T-1', description: 'Save the kingdom', outcomes: ["yes", "no"], stances: { narrator: { logits: [0, 0], volume: 2, volatility: 0 } }, participants: [], dependents: [], openedAt: 'S-1', threadLog: { nodes: {}, edges: [] } },
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
        events: ['Wakes up'],
        threadDeltas: [],
        worldDeltas: [],
        relationshipDeltas: [],
        summary: 'Hero wakes in village',
        proseVersions: [{
          prose: 'The morning sun crept through the window. Hero stretched and yawned, ready for adventure.',
          branchId: 'main',
          timestamp: Date.now(),
          version: '1',
          versionType: 'generate' as const,
        }],
      },
      'S-2': {
        kind: 'scene',
        id: 'S-2',
        arcId: 'ARC-1',
        locationId: 'L-1',
        povId: 'C-1',
        participantIds: ['C-1', 'C-2'],
        events: ['Meets mentor'],
        threadDeltas: [],
        worldDeltas: [],
        relationshipDeltas: [],
        summary: 'Hero meets mentor',
        proseVersions: [{
          prose: 'Mentor appeared at the door. "Your journey begins today," he said.',
          branchId: 'main',
          timestamp: Date.now(),
          version: '1',
          versionType: 'generate' as const,
        }],
      },
      'S-3': {
        kind: 'scene',
        id: 'S-3',
        arcId: 'ARC-1',
        locationId: 'L-2',
        povId: 'C-1',
        participantIds: ['C-1'],
        events: ['Enters forest'],
        threadDeltas: [],
        worldDeltas: [],
        relationshipDeltas: [],
        summary: 'Hero enters the dark forest',
        proseVersions: [{
          prose: 'The trees closed around Hero as he stepped into the forest. Shadows moved.',
          branchId: 'main',
          timestamp: Date.now(),
          version: '1',
          versionType: 'generate' as const,
        }],
      },
    },
    branches: {},
    worldBuilds: {},
    systemGraph: { nodes: {}, edges: [] },
    relationships: [],
    artifacts: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
describe('rewriteSceneProse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('returns prose from LLM JSON response', async () => {
    const mockProse = 'The rewritten prose with improvements.';
    const proseResponse = JSON.stringify({ prose: mockProse });
    const changelogResponse = JSON.stringify({ changelog: '• Fixed pacing\n• Added tension' });
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(proseResponse)
      .mockResolvedValueOnce(changelogResponse);
    vi.mocked(parseJson)
      .mockImplementation((raw: string, _label?: string) => JSON.parse(raw));
    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-2']!;
    const result = await rewriteSceneProse(
      narrative,
      scene,
      ['S-1', 'S-2', 'S-3'],
      'Original prose here',
      'Add more tension in the dialogue',
    );
    expect(result.prose).toBe(mockProse);
    expect(result.changelog).toBe('• Fixed pacing\n• Added tension');
    expect(callGenerate).toHaveBeenCalledTimes(2);
  });
  it('handles streaming mode with onToken callback', async () => {
    const mockProse = 'Streamed prose content.';
    const tokens: string[] = [];
    const changelogResponse = JSON.stringify({ changelog: '• Streamed changes' });
    vi.mocked(callGenerateStream).mockResolvedValue(mockProse);
    vi.mocked(callGenerate).mockResolvedValue(changelogResponse);
    vi.mocked(parseJson).mockImplementation((raw: string) => JSON.parse(raw));
    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-2']!;
    const result = await rewriteSceneProse(
      narrative,
      scene,
      ['S-1', 'S-2', 'S-3'],
      'Original prose',
      'Analysis',
      0,
      0,
      undefined,
      (token) => tokens.push(token),
    );
    expect(result.prose).toBe(mockProse);
    expect(callGenerateStream).toHaveBeenCalled();
    expect(callGenerate).toHaveBeenCalledTimes(1); // Only changelog call
  });
  it('includes past scene context when contextPast > 0', async () => {
    const mockProse = 'Prose with past context.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });
    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-2']!;
    await rewriteSceneProse(
      narrative,
      scene,
      ['S-1', 'S-2', 'S-3'],
      'Original prose',
      'Analysis',
      1, // contextPast = 1
    );
    const promptCall = vi.mocked(callGenerate).mock.calls[0]![0];
    expect(promptCall).toContain('PRECEDING SCENES');
    expect(promptCall).toContain('Hero wakes in village');
  });
  it('includes future scene context when contextFuture > 0', async () => {
    const mockProse = 'Prose with future context.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });
    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-2']!;
    await rewriteSceneProse(
      narrative,
      scene,
      ['S-1', 'S-2', 'S-3'],
      'Original prose',
      'Analysis',
      0,
      1, // contextFuture = 1
    );
    const promptCall = vi.mocked(callGenerate).mock.calls[0]![0];
    expect(promptCall).toContain('FOLLOWING SCENES');
    expect(promptCall).toContain('Hero enters the dark forest');
  });
  it('includes pinned reference scenes', async () => {
    const mockProse = 'Prose with references.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });
    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-2']!;
    await rewriteSceneProse(
      narrative,
      scene,
      ['S-1', 'S-2', 'S-3'],
      'Original prose',
      'Analysis',
      0,
      0,
      ['S-3'], // Reference scene
    );
    const promptCall = vi.mocked(callGenerate).mock.calls[0]![0];
    expect(promptCall).toContain('PINNED REFERENCE SCENES');
    expect(promptCall).toContain('Hero enters the dark forest');
  });
  it('excludes current scene from reference scenes', async () => {
    const mockProse = 'Prose without self-reference.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });
    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-2']!;
    await rewriteSceneProse(
      narrative,
      scene,
      ['S-1', 'S-2', 'S-3'],
      'Original prose',
      'Analysis',
      0,
      0,
      ['S-2'], // Same as current scene
    );
    const promptCall = vi.mocked(callGenerate).mock.calls[0]![0];
    expect(promptCall).not.toContain('PINNED REFERENCE SCENES');
  });
  it('uses prose voice override when available', async () => {
    const mockProse = 'Voiced prose.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });
    const narrative = createMinimalNarrative();
    narrative.storySettings = { ...DEFAULT_STORY_SETTINGS, proseVoice: 'Write in a lyrical, poetic style with rich metaphors.' };
    const scene = narrative.scenes['S-2']!;
    await rewriteSceneProse(
      narrative,
      scene,
      ['S-1', 'S-2', 'S-3'],
      'Original prose',
      'Analysis',
    );
    // The author voice override now flows through the user prompt (system
    // prompt stays lean role-only). Check the user-prompt body.
    const userPromptArg = vi.mocked(callGenerate).mock.calls[0]![0];
    expect(userPromptArg).toContain('lyrical, poetic style');
  });
  it('handles changelog array format', async () => {
    const mockProse = 'Prose.';
    const proseResponse = JSON.stringify({ prose: mockProse });
    const changelogResponse = JSON.stringify({ changelog: ['First change', 'Second change'] });
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(proseResponse)
      .mockResolvedValueOnce(changelogResponse);
    vi.mocked(parseJson).mockImplementation((raw: string) => JSON.parse(raw));
    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-2']!;
    const result = await rewriteSceneProse(
      narrative,
      scene,
      ['S-1', 'S-2', 'S-3'],
      'Original prose',
      'Analysis',
    );
    expect(result.changelog).toBe('• First change\n• Second change');
  });
  it('propagates errors when changelog generation fails', async () => {
    // A changelog call failure surfaces from rewriteSceneProse rather than
    // being swallowed — the caller is expected to retry or surface the error.
    const mockProse = 'Good prose.';
    const proseResponse = JSON.stringify({ prose: mockProse });
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(proseResponse)
      .mockRejectedValueOnce(new Error('Changelog failed'));
    vi.mocked(parseJson).mockImplementation((raw: string) => JSON.parse(raw));
    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-2']!;
    await expect(
      rewriteSceneProse(narrative, scene, ['S-1', 'S-2', 'S-3'], 'Original prose', 'Analysis'),
    ).rejects.toThrow('Changelog failed');
  });
  it('uses default paragraph context when no expanded context', async () => {
    const mockProse = 'Prose with default context.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });
    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-2']!;
    await rewriteSceneProse(
      narrative,
      scene,
      ['S-1', 'S-2', 'S-3'],
      'Original prose',
      'Analysis',
      0, // contextPast = 0
      0, // contextFuture = 0
    );
    const promptCall = vi.mocked(callGenerate).mock.calls[0]![0];
    // Should include ending/opening snippets via the XML neighbor blocks,
    // not full scenes.
    expect(promptCall).toContain('<previous-scene-ending>');
    expect(promptCall).toContain('<next-scene-opening>');
  });
  it('handles scene not in resolvedKeys', async () => {
    const mockProse = 'Prose for orphan scene.';
    const proseResponse = JSON.stringify({ prose: mockProse });
    const changelogResponse = JSON.stringify({ changelog: '' });
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(proseResponse)
      .mockResolvedValueOnce(changelogResponse);
    vi.mocked(parseJson).mockImplementation((raw: string) => JSON.parse(raw));
    const narrative = createMinimalNarrative();
    const orphanScene: Scene = {
      kind: 'scene',
      id: 'S-ORPHAN',
      arcId: 'ARC-1',
      locationId: 'L-1',
      povId: 'C-1',
      participantIds: ['C-1'],
      events: [],
      threadDeltas: [],
      worldDeltas: [],
      relationshipDeltas: [],
      summary: 'Orphan scene',
    };
    narrative.scenes['S-ORPHAN'] = orphanScene;
    const result = await rewriteSceneProse(
      narrative,
      orphanScene,
      ['S-1', 'S-2', 'S-3'], // Does not include S-ORPHAN
      'Original prose',
      'Analysis',
    );
    expect(result.prose).toBe(mockProse);
    expect(sceneContext).toHaveBeenCalled();
  });
});
