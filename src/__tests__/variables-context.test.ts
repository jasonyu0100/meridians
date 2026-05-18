import { describe, it, expect } from 'vitest';
import { renderVariablesContextBlock, type VariablesContextSource } from '@/lib/ai/variables';
import type { Arc, Scene, Character, Location, Artifact, Thread } from '@/types/narrative';

// The variables context block is what downstream variable + scenario
// generation reads to understand the world's state. When a prior arc carried
// a Present coordination annotation (description + reasoning + the universal
// inference-shape fields), the next arc's generation should INHERIT that
// comparative + falsification reasoning rather than re-derive it. The arcs
// block surfacing the Present annotation is what makes that inheritance work.

// ── Fixture helpers ──────────────────────────────────────────────────────

function makeArc(id: string, overrides: Partial<Arc> = {}): Arc {
  return {
    id,
    name: id,
    sceneIds: [],
    develops: [],
    locationIds: [],
    activeCharacterIds: [],
    initialCharacterLocations: {},
    ...overrides,
  };
}

function makeScene(id: string, arcId: string): Scene {
  return {
    kind: 'scene',
    id,
    arcId,
    povId: null,
    locationId: 'L-1',
    participantIds: [],
    events: ['something happened'],
    summary: 'scene summary',
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    characterMovements: {},
  };
}

function makeSrc(arcs: Arc[], sceneIds: string[]): VariablesContextSource {
  const arcsMap: Record<string, Arc> = {};
  arcs.forEach((a) => { arcsMap[a.id] = a; });
  const scenesMap: Record<string, Scene> = {};
  sceneIds.forEach((sid) => {
    const arc = arcs.find((a) => a.sceneIds.includes(sid));
    if (arc) scenesMap[sid] = makeScene(sid, arc.id);
  });
  return {
    title: 'Test',
    characters: {} as Record<string, Character>,
    locations: { 'L-1': { id: 'L-1', name: 'Place', prominence: 'place', world: { nodes: {}, edges: [] } } as unknown as Location },
    artifacts: {} as Record<string, Artifact>,
    threads: {} as Record<string, Thread>,
    arcs: arcsMap,
    scenes: scenesMap,
    orderedEntryIds: sceneIds,
  };
}

// ── renderVariablesContextBlock — Present surfacing ─────────────────────

describe('renderVariablesContextBlock — arc Present surfacing', () => {
  it('renders arc id, name, and direction when no Present annotation exists', () => {
    const arcs = [makeArc('ARC-1', {
      name: 'Opening',
      directionVector: 'toward the cave',
      sceneIds: ['S-1'],
    })];
    const block = renderVariablesContextBlock(makeSrc(arcs, ['S-1']));
    expect(block).toContain('ARC-1');
    expect(block).toContain('Opening');
    expect(block).toContain('toward the cave');
    expect(block).not.toContain('present:');
  });

  it('surfaces description and reasoning when the arc carries a Present annotation', () => {
    const arcs = [makeArc('ARC-1', {
      sceneIds: ['S-1'],
      presentDescription: 'The faction consolidates under duress.',
      presentReasoning: 'Resource scarcity forces the merger.',
    })];
    const block = renderVariablesContextBlock(makeSrc(arcs, ['S-1']));
    expect(block).toContain('present:');
    expect(block).toContain('description: The faction consolidates under duress.');
    expect(block).toContain('reasoning: Resource scarcity forces the merger.');
  });

  it('surfaces the universal inference-shape fields with their canonical glyphs', () => {
    const arcs = [makeArc('ARC-1', {
      sceneIds: ['S-1'],
      presentConsidered: 'Adjacent X was considered.',
      presentBreaks: 'Breaks if Y crosses threshold.',
      presentOpens: 'Opens an arc-after-next thread.',
    })];
    const block = renderVariablesContextBlock(makeSrc(arcs, ['S-1']));
    expect(block).toContain('× considered: Adjacent X was considered.');
    expect(block).toContain('! breaks: Breaks if Y crosses threshold.');
    expect(block).toContain('⇒ opens: Opens an arc-after-next thread.');
  });

  it('renders Present fields in stable order (description, reasoning, considered, breaks, opens)', () => {
    const arcs = [makeArc('ARC-1', {
      sceneIds: ['S-1'],
      presentDescription: 'D-MARKER',
      presentReasoning: 'R-MARKER',
      presentConsidered: 'X-MARKER',
      presentBreaks: 'B-MARKER',
      presentOpens: 'O-MARKER',
    })];
    const block = renderVariablesContextBlock(makeSrc(arcs, ['S-1']));
    const idxD = block.indexOf('D-MARKER');
    const idxR = block.indexOf('R-MARKER');
    const idxX = block.indexOf('X-MARKER');
    const idxB = block.indexOf('B-MARKER');
    const idxO = block.indexOf('O-MARKER');
    expect(idxD).toBeGreaterThan(-1);
    expect(idxR).toBeGreaterThan(idxD);
    expect(idxX).toBeGreaterThan(idxR);
    expect(idxB).toBeGreaterThan(idxX);
    expect(idxO).toBeGreaterThan(idxB);
  });

  it('renders only the Present fields the arc actually authored', () => {
    // Partial Present — only description + opens. The block should NOT emit
    // empty lines for the missing fields (no dangling glyphs in the prompt).
    const arcs = [makeArc('ARC-1', {
      sceneIds: ['S-1'],
      presentDescription: 'Just a description.',
      presentOpens: 'And an opens.',
    })];
    const block = renderVariablesContextBlock(makeSrc(arcs, ['S-1']));
    expect(block).toContain('present:');
    expect(block).toContain('description: Just a description.');
    expect(block).toContain('⇒ opens: And an opens.');
    expect(block).not.toContain('reasoning:');
    expect(block).not.toContain('× considered');
    expect(block).not.toContain('! breaks');
  });

  it('keeps Present surfacing per-arc when multiple arcs each carry annotations', () => {
    const arcs = [
      makeArc('ARC-1', {
        sceneIds: ['S-1'],
        presentDescription: 'ARC-1-DESC',
        presentConsidered: 'ARC-1-CONSIDERED',
      }),
      makeArc('ARC-2', {
        sceneIds: ['S-2'],
        presentDescription: 'ARC-2-DESC',
        presentConsidered: 'ARC-2-CONSIDERED',
      }),
    ];
    const block = renderVariablesContextBlock(makeSrc(arcs, ['S-1', 'S-2']));
    expect(block).toContain('ARC-1-DESC');
    expect(block).toContain('ARC-1-CONSIDERED');
    expect(block).toContain('ARC-2-DESC');
    expect(block).toContain('ARC-2-CONSIDERED');
    // Each Present block should sit under its own arc; the first arc's
    // marker must precede the second arc's marker in the rendered output.
    expect(block.indexOf('ARC-1-DESC')).toBeLessThan(block.indexOf('ARC-2-DESC'));
  });
});
