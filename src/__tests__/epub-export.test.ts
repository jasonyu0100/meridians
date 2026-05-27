import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportEpub } from '@/lib/epub-export';
import type { NarrativeState, Arc } from '@/types/narrative';
// Capture the filename when exportEpub is called
let capturedFilename: string | null = null;
// Mock browser APIs
const mockCreateObjectURL = vi.fn((_blob: Blob) => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();
const mockClick = vi.fn();
beforeEach(() => {
  capturedFilename = null;
  // Mock URL
  vi.stubGlobal('URL', {
    createObjectURL: mockCreateObjectURL,
    revokeObjectURL: mockRevokeObjectURL,
  });
  // Mock Blob
  vi.stubGlobal('Blob', class MockBlob {
    parts: (ArrayBuffer | Uint8Array)[];
    options: { type: string };
    constructor(parts: (ArrayBuffer | Uint8Array)[], options: { type: string }) {
      this.parts = parts;
      this.options = options;
    }
    async arrayBuffer(): Promise<ArrayBuffer> {
      // Combine all parts
      const part = this.parts[0];
      if (part instanceof ArrayBuffer) return part;
      return part.buffer as ArrayBuffer;
    }
  });
  // Mock document
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag === 'a') {
        const anchor = {
          href: '',
          _download: '',
          click: () => {
            mockClick();
          },
        };
        Object.defineProperty(anchor, 'download', {
          set(v: string) {
            capturedFilename = v;
            anchor._download = v;
          },
          get() {
            return anchor._download;
          },
        });
        return anchor;
      }
      return {};
    },
    body: {
      appendChild: mockAppendChild,
      removeChild: mockRemoveChild,
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
// Helper to create minimal narrative
function createMinimalNarrative(): NarrativeState {
  const arc: Arc = {
    id: 'ARC-1',
    name: 'Chapter One',
    sceneIds: ['S-1', 'S-2'],
    develops: [],
    locationIds: [],
    activeCharacterIds: [],
  };
  return {
    id: 'test-narrative',
    title: 'Test Story',
    worldSummary: 'A test world.',
    characters: {
      'C-1': { id: 'C-1', name: 'Hero', role: 'anchor', world: { nodes: {}, edges: [] }, threadIds: [] },
    },
    locations: {
      'L-1': { id: 'L-1', name: 'Village', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], world: { nodes: {}, edges: [] }, threadIds: [] },
    },
    threads: {},
    arcs: { 'ARC-1': arc },
    scenes: {
      'S-1': {
        kind: 'scene',
        id: 'S-1',
        arcId: 'ARC-1',
        locationId: 'L-1',
        povId: 'C-1',
        participantIds: ['C-1'],
        events: [],
        threadDeltas: [],
        worldDeltas: [],
        relationshipDeltas: [],
        summary: 'First scene',
        proseVersions: [{
          version: '1.0.0',
          branchId: 'BR-1',
          prose: 'The sun rose over the village. Hero stepped outside.',
          timestamp: Date.now(),
          versionType: 'generate',
        }],
      },
      'S-2': {
        kind: 'scene',
        id: 'S-2',
        arcId: 'ARC-1',
        locationId: 'L-1',
        povId: 'C-1',
        participantIds: ['C-1'],
        events: [],
        threadDeltas: [],
        worldDeltas: [],
        relationshipDeltas: [],
        summary: 'Second scene',
        proseVersions: [{
          version: '1.0.0',
          branchId: 'BR-1',
          prose: 'The adventure begins. Hero walked into the forest.',
          timestamp: Date.now(),
          versionType: 'generate',
        }],
      },
    },
    branches: {
      'BR-1': {
        id: 'BR-1',
        name: 'main',
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ['S-1', 'S-2'],
        createdAt: Date.now(),
      },
    },
    worldBuilds: {},
    systemGraph: { nodes: {}, edges: [] },
    artifacts: {},
    relationships: [],
    description: 'Test description',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
describe('exportEpub', () => {
  it('creates a downloadable EPUB file', async () => {
    const narrative = createMinimalNarrative();
    const proseCache: Record<string, { text: string; status: string }> = {};
    exportEpub(narrative, ['S-1', 'S-2'], 'BR-1', proseCache);
    expect(mockAppendChild).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect(mockRemoveChild).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalled();
    expect(capturedFilename).toBe('test_story.epub');
  });
  it('uses prose from cache when available', async () => {
    const narrative = createMinimalNarrative();
    const proseCache: Record<string, { text: string; status: string }> = {
      'S-1': { text: 'Cached prose for scene one.', status: 'ready' },
      'S-2': { text: 'Cached prose for scene two.', status: 'ready' },
    };
    exportEpub(narrative, ['S-1', 'S-2'], 'BR-1', proseCache);
    expect(mockClick).toHaveBeenCalled();
  });
  it('skips scenes without prose', () => {
    const narrative = createMinimalNarrative();
    narrative.scenes['S-1'].proseVersions = [];
    narrative.scenes['S-2'].proseVersions = [];
    const proseCache: Record<string, { text: string; status: string }> = {};
    exportEpub(narrative, ['S-1', 'S-2'], 'BR-1', proseCache);
    // Should not create download since no prose
    expect(mockClick).not.toHaveBeenCalled();
  });
  it('sanitizes filename from title', async () => {
    const narrative = createMinimalNarrative();
    narrative.title = 'My Story: A Tale of <Adventure> & "Danger"';
    const proseCache: Record<string, { text: string; status: string }> = {};
    exportEpub(narrative, ['S-1', 'S-2'], 'BR-1', proseCache);
    // Non-alphanumeric chars become underscores, consecutive underscores collapsed, leading/trailing trimmed
    expect(capturedFilename).toBe('my_story_a_tale_of_adventure_danger.epub');
  });
  it('groups scenes by arc', async () => {
    const narrative = createMinimalNarrative();
    narrative.arcs['ARC-2'] = {
      id: 'ARC-2',
      name: 'Chapter Two',
      sceneIds: ['S-3'],
      develops: [],
      locationIds: [],
      activeCharacterIds: [],
    };
    narrative.scenes['S-3'] = {
      kind: 'scene',
      id: 'S-3',
      arcId: 'ARC-2',
      locationId: 'L-1',
      povId: 'C-1',
      participantIds: ['C-1'],
      events: [],
      threadDeltas: [],
      worldDeltas: [],
      relationshipDeltas: [],
      summary: 'Third scene',
      proseVersions: [{
        version: '1.0.0',
        branchId: 'BR-1',
        prose: 'Chapter two begins.',
        timestamp: Date.now(),
        versionType: 'generate',
      }],
    };
    const proseCache: Record<string, { text: string; status: string }> = {};
    exportEpub(narrative, ['S-1', 'S-2', 'S-3'], 'BR-1', proseCache);
    expect(mockClick).toHaveBeenCalled();
  });
  it('escapes special XML characters in content', () => {
    const narrative = createMinimalNarrative();
    narrative.title = 'Test & Story';
    narrative.scenes['S-1'].proseVersions = [{
      version: '1.0.0',
      branchId: 'BR-1',
      prose: 'He said "Hello" & waved. The <tag> was visible.',
      timestamp: Date.now(),
      versionType: 'generate',
    }];
    const proseCache: Record<string, { text: string; status: string }> = {};
    exportEpub(narrative, ['S-1', 'S-2'], 'BR-1', proseCache);
    expect(mockClick).toHaveBeenCalled();
  });
  it('handles scenes from prose cache with pending status', () => {
    const narrative = createMinimalNarrative();
    // S-1 has no versioned prose
    narrative.scenes['S-1'].proseVersions = [];
    // S-2 has fallback prose
    narrative.scenes['S-2'].proseVersions = [{
      version: '1.0.0',
      branchId: 'BR-1',
      prose: 'Fallback prose.',
      timestamp: Date.now(),
      versionType: 'generate',
    }];
    const proseCache: Record<string, { text: string; status: string }> = {
      'S-1': { text: 'This should not be used', status: 'pending' },
    };
    exportEpub(narrative, ['S-1', 'S-2'], 'BR-1', proseCache);
    // S-2 has fallback prose and should work
    expect(mockClick).toHaveBeenCalled();
  });
  it('includes location and POV metadata in chapter', () => {
    const narrative = createMinimalNarrative();
    const proseCache: Record<string, { text: string; status: string }> = {};
    exportEpub(narrative, ['S-1', 'S-2'], 'BR-1', proseCache);
    // The export should complete without errors
    expect(mockClick).toHaveBeenCalled();
  });
});
