import { describe, it, expect } from 'vitest';
import type { Scene, SystemDelta, SystemGraph, SystemNode, SystemNodeType } from '@/types/narrative';
import {
  EMPTY_SYSTEM_GRAPH,
  systemEdgeKey,
  sanitizeSystemDelta,
  applySystemDelta,
  seenSystemEdgeKeysFromGraph,
  normalizeSystemConcept,
  makeSystemIdAllocator,
  resolveSystemConceptIds,
  getSceneSystemAttributions,
} from '@/lib/system-graph';
// ── Fixture helpers ──────────────────────────────────────────────────────────
function node(id: string, concept: string, type: SystemNodeType = 'concept'): SystemNode {
  return { id, concept, type };
}
function edge(from: string, to: string, relation = 'relates_to') {
  return { from, to, relation };
}
function makeDelta(
  nodes: SystemNode[] = [],
  edges: { from: string; to: string; relation: string }[] = [],
): SystemDelta {
  return { addedNodes: nodes.slice(), addedEdges: edges.slice() };
}
// ── EMPTY_SYSTEM_GRAPH ────────────────────────────────────────────────────
describe('EMPTY_SYSTEM_GRAPH', () => {
  it('is a canonical empty graph', () => {
    expect(EMPTY_SYSTEM_GRAPH).toEqual({ nodes: {}, edges: [] });
  });
});
// ── systemEdgeKey ────────────────────────────────────────────────────────────────
describe('systemEdgeKey', () => {
  it('produces a stable key from from/to/relation', () => {
    expect(systemEdgeKey(edge('SYS-01', 'SYS-02', 'enables'))).toBe('SYS-01→SYS-02→enables');
  });
  it('differentiates edges that share endpoints but not relation', () => {
    const a = systemEdgeKey(edge('SYS-01', 'SYS-02', 'enables'));
    const b = systemEdgeKey(edge('SYS-01', 'SYS-02', 'blocks'));
    expect(a).not.toBe(b);
  });
  it('is directional', () => {
    const a = systemEdgeKey(edge('SYS-01', 'SYS-02', 'enables'));
    const b = systemEdgeKey(edge('SYS-02', 'SYS-01', 'enables'));
    expect(a).not.toBe(b);
  });
});
// ── sanitizeSystemDelta ───────────────────────────────────────────
describe('sanitizeSystemDelta', () => {
  it('filters self-loops (from === to)', () => {
    const m = makeDelta([], [edge('SYS-01', 'SYS-01', 'enables'), edge('SYS-01', 'SYS-02', 'enables')]);
    sanitizeSystemDelta(m, new Set(['SYS-01', 'SYS-02']), new Set());
    expect(m.addedEdges).toHaveLength(1);
    expect(m.addedEdges[0]).toEqual({ from: 'SYS-01', to: 'SYS-02', relation: 'enables' });
  });
  it('filters orphan edges (endpoint not in validIds)', () => {
    const m = makeDelta([], [edge('SYS-01', 'SYS-02'), edge('SYS-01', 'SYS-99'), edge('SYS-88', 'SYS-02')]);
    sanitizeSystemDelta(m, new Set(['SYS-01', 'SYS-02']), new Set());
    expect(m.addedEdges).toHaveLength(1);
    expect(m.addedEdges[0].to).toBe('SYS-02');
  });
  it('filters edges missing from, to, or relation', () => {
    const m: SystemDelta = {
      addedNodes: [],
      addedEdges: [
        { from: 'SYS-01', to: 'SYS-02', relation: '' },
        { from: '', to: 'SYS-02', relation: 'enables' },
        { from: 'SYS-01', to: '', relation: 'enables' },
        { from: 'SYS-01', to: 'SYS-02', relation: 'enables' },
      ],
    };
    sanitizeSystemDelta(m, new Set(['SYS-01', 'SYS-02']), new Set());
    expect(m.addedEdges).toHaveLength(1);
  });
  it('filters cross-delta duplicates using the shared seenEdgeKeys set', () => {
    const valid = new Set(['SYS-01', 'SYS-02']);
    const seen = new Set<string>();
    const m1 = makeDelta([], [edge('SYS-01', 'SYS-02', 'enables')]);
    const m2 = makeDelta([], [edge('SYS-01', 'SYS-02', 'enables'), edge('SYS-02', 'SYS-01', 'enables')]);
    sanitizeSystemDelta(m1, valid, seen);
    sanitizeSystemDelta(m2, valid, seen);
    // m1 keeps its one edge, m2 keeps only the reverse-direction one.
    expect(m1.addedEdges).toHaveLength(1);
    expect(m2.addedEdges).toHaveLength(1);
    expect(m2.addedEdges[0]).toEqual({ from: 'SYS-02', to: 'SYS-01', relation: 'enables' });
  });
  it('filters nodes missing concept or type', () => {
    const m: SystemDelta = {
      addedNodes: [
        { id: 'SYS-01', concept: 'Magic', type: 'system' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'SYS-02', concept: '', type: 'concept' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'SYS-03', concept: 'Ether', type: '' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: '', concept: 'Ley', type: 'concept' } as any,
      ],
      addedEdges: [],
    };
    sanitizeSystemDelta(m, new Set(['SYS-01', 'SYS-02', 'SYS-03']), new Set());
    expect(m.addedNodes).toHaveLength(1);
    expect(m.addedNodes[0].id).toBe('SYS-01');
  });
  it('handles undefined addedNodes/addedEdges gracefully', () => {
    const m = { addedNodes: undefined, addedEdges: undefined } as unknown as SystemDelta;
    sanitizeSystemDelta(m, new Set(), new Set());
    expect(m.addedNodes).toEqual([]);
    expect(m.addedEdges).toEqual([]);
  });
  it('returns the mutated object for chaining', () => {
    const m = makeDelta();
    const result = sanitizeSystemDelta(m, new Set(), new Set());
    expect(result).toBe(m);
  });
});
// ── applySystemDelta ──────────────────────────────────────────────
describe('applySystemDelta', () => {
  it('adds new nodes to the graph', () => {
    const graph: SystemGraph = { nodes: {}, edges: [] };
    applySystemDelta(graph, makeDelta([node('SYS-01', 'Magic', 'system')], []));
    expect(graph.nodes['SYS-01']).toEqual({ id: 'SYS-01', concept: 'Magic', type: 'system' });
  });
  it('does not overwrite existing nodes', () => {
    const graph: SystemGraph = { nodes: { 'SYS-01': node('SYS-01', 'Magic', 'system') }, edges: [] };
    applySystemDelta(graph, makeDelta([node('SYS-01', 'OTHER CONCEPT', 'principle')], []));
    expect(graph.nodes['SYS-01'].concept).toBe('Magic');
    expect(graph.nodes['SYS-01'].type).toBe('system');
  });
  it('adds new edges', () => {
    const graph: SystemGraph = { nodes: {}, edges: [] };
    applySystemDelta(graph, makeDelta([], [edge('SYS-01', 'SYS-02', 'enables')]));
    expect(graph.edges).toHaveLength(1);
  });
  it('does not duplicate existing edges', () => {
    const graph: SystemGraph = {
      nodes: {},
      edges: [edge('SYS-01', 'SYS-02', 'enables')],
    };
    applySystemDelta(graph, makeDelta([], [edge('SYS-01', 'SYS-02', 'enables')]));
    expect(graph.edges).toHaveLength(1);
  });
  it('treats different relations as different edges', () => {
    const graph: SystemGraph = {
      nodes: {},
      edges: [edge('SYS-01', 'SYS-02', 'enables')],
    };
    applySystemDelta(graph, makeDelta([], [edge('SYS-01', 'SYS-02', 'blocks')]));
    expect(graph.edges).toHaveLength(2);
  });
});
// ── seenSystemEdgeKeysFromGraph ────────────────────────────────────────────────────
describe('seenSystemEdgeKeysFromGraph', () => {
  it('returns a set of edge keys from the graph', () => {
    const graph: SystemGraph = {
      nodes: {},
      edges: [edge('SYS-01', 'SYS-02', 'enables'), edge('SYS-02', 'SYS-03', 'blocks')],
    };
    const seen = seenSystemEdgeKeysFromGraph(graph);
    expect(seen.has('SYS-01→SYS-02→enables')).toBe(true);
    expect(seen.has('SYS-02→SYS-03→blocks')).toBe(true);
    expect(seen.size).toBe(2);
  });
  it('handles undefined graph', () => {
    const seen = seenSystemEdgeKeysFromGraph(undefined);
    expect(seen.size).toBe(0);
  });
  it('handles empty graph', () => {
    const seen = seenSystemEdgeKeysFromGraph({ nodes: {}, edges: [] });
    expect(seen.size).toBe(0);
  });
});
// ── normalizeSystemConcept ───────────────────────────────────────────────────────
describe('normalizeSystemConcept', () => {
  it('lowercases', () => {
    expect(normalizeSystemConcept('Mana Binding')).toBe('mana binding');
  });
  it('trims whitespace', () => {
    expect(normalizeSystemConcept('  Mana Binding  ')).toBe('mana binding');
  });
  it('treats case + whitespace variants as equal', () => {
    expect(normalizeSystemConcept('MANA BINDING')).toBe(normalizeSystemConcept('  mana binding'));
  });
  it('does NOT normalize punctuation or hyphenation', () => {
    // Documented limitation: "mana-binding" and "mana binding" are distinct.
    expect(normalizeSystemConcept('mana-binding')).not.toBe(normalizeSystemConcept('mana binding'));
  });
});
// ── makeSystemIdAllocator ────────────────────────────────────────────────────────
describe('makeSystemIdAllocator', () => {
  it('starts at SYS-1 when seeded with no ids', () => {
    const alloc = makeSystemIdAllocator([]);
    expect(alloc()).toBe('SYS-1');
    expect(alloc()).toBe('SYS-2');
  });
  it('seeds from the max existing id', () => {
    const alloc = makeSystemIdAllocator(['SYS-1', 'SYS-5', 'SYS-3']);
    expect(alloc()).toBe('SYS-6');
    expect(alloc()).toBe('SYS-7');
  });
  it('reads zero-padded historical seeds without re-emitting them', () => {
    // Padded forms like SYS-017 exist only in old data; the allocator parses
    // them (counter=17) but always emits the canonical unpadded SYS-18 next.
    // This is the fix for the SYS-17 / SYS-017 namespace-collision class.
    const alloc = makeSystemIdAllocator(['SYS-017', 'SYS-005']);
    expect(alloc()).toBe('SYS-18');
  });
  it('ignores non-SYS ids in seed', () => {
    const alloc = makeSystemIdAllocator(['C-1', 'L-2', 'T-99', 'WK-9']);
    expect(alloc()).toBe('SYS-1');
  });
  it('ignores malformed ids in seed', () => {
    const alloc = makeSystemIdAllocator(['SYS-foo', 'SYS-', 'SYS-3']);
    expect(alloc()).toBe('SYS-4');
  });
  it('emits plain unpadded integers across the rollover boundary', () => {
    const alloc = makeSystemIdAllocator([]);
    for (let i = 0; i < 9; i++) alloc();
    expect(alloc()).toBe('SYS-10');
  });
  it('yields unique ids on repeated calls', () => {
    const alloc = makeSystemIdAllocator([]);
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(alloc());
    expect(ids.size).toBe(50);
  });
});
// ── resolveSystemConceptIds ──────────────────────────────────────────────────────
describe('resolveSystemConceptIds', () => {
  const alloc = (seed: string[] = []) => makeSystemIdAllocator(seed);
  it('allocates fresh ids for genuinely new concepts', () => {
    const { idMap, newNodes } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' },
        { id: 'SYS-GEN-2', concept: 'Leylines', type: 'concept' },
      ],
      {},
      alloc(),
    );
    expect(newNodes).toHaveLength(2);
    expect(idMap['SYS-GEN-1']).toBe('SYS-1');
    expect(idMap['SYS-GEN-2']).toBe('SYS-2');
    expect(newNodes[0]).toEqual({ id: 'SYS-1', concept: 'Mana Binding', type: 'system' });
  });
  it('collapses a raw node whose concept exists in the existing graph', () => {
    const existing = { 'SYS-07': node('SYS-07', 'Mana Binding', 'system') };
    const { idMap, newNodes } = resolveSystemConceptIds(
      [{ id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'principle' }],
      existing,
      alloc(['SYS-07']),
    );
    expect(idMap['SYS-GEN-1']).toBe('SYS-07');
    expect(newNodes).toHaveLength(0);
  });
  it('is case-insensitive when matching existing concepts', () => {
    const existing = { 'SYS-05': node('SYS-05', 'Mana Binding', 'system') };
    const { idMap, newNodes } = resolveSystemConceptIds(
      [{ id: 'SYS-GEN-1', concept: 'MANA BINDING', type: 'system' }],
      existing,
      alloc(['SYS-05']),
    );
    expect(idMap['SYS-GEN-1']).toBe('SYS-05');
    expect(newNodes).toHaveLength(0);
  });
  it('is whitespace-insensitive when matching existing concepts', () => {
    const existing = { 'SYS-05': node('SYS-05', 'Mana Binding', 'system') };
    const { idMap, newNodes } = resolveSystemConceptIds(
      [{ id: 'SYS-GEN-1', concept: '  mana binding  ', type: 'system' }],
      existing,
      alloc(['SYS-05']),
    );
    expect(idMap['SYS-GEN-1']).toBe('SYS-05');
    expect(newNodes).toHaveLength(0);
  });
  it('collapses within-batch duplicates to a single fresh id', () => {
    const { idMap, newNodes } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' },
        { id: 'SYS-GEN-2', concept: 'Mana Binding', type: 'concept' },
        { id: 'SYS-GEN-3', concept: 'MANA BINDING', type: 'principle' },
      ],
      {},
      alloc(),
    );
    expect(newNodes).toHaveLength(1);
    expect(idMap['SYS-GEN-1']).toBe('SYS-1');
    expect(idMap['SYS-GEN-2']).toBe('SYS-1');
    expect(idMap['SYS-GEN-3']).toBe('SYS-1');
  });
  it('existing-graph match takes priority over within-batch match', () => {
    const existing = { 'SYS-42': node('SYS-42', 'Mana Binding', 'system') };
    const { idMap, newNodes } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' },
        { id: 'SYS-GEN-2', concept: 'mana binding', type: 'concept' },
      ],
      existing,
      alloc(['SYS-42']),
    );
    expect(newNodes).toHaveLength(0);
    expect(idMap['SYS-GEN-1']).toBe('SYS-42');
    expect(idMap['SYS-GEN-2']).toBe('SYS-42');
  });
  it('preserves the first-occurrence concept + type when collapsing within-batch', () => {
    const { newNodes } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' },
        { id: 'SYS-GEN-2', concept: 'MANA BINDING', type: 'principle' },
      ],
      {},
      alloc(),
    );
    expect(newNodes[0].concept).toBe('Mana Binding');
    expect(newNodes[0].type).toBe('system');
  });
  it('skips raw nodes missing id, concept, or type', () => {
    const { newNodes } = resolveSystemConceptIds(
      [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: '', concept: 'A', type: 'concept' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'SYS-GEN-1', concept: '', type: 'concept' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'SYS-GEN-2', concept: 'B', type: '' } as any,
        { id: 'SYS-GEN-3', concept: 'C', type: 'concept' },
      ],
      {},
      alloc(),
    );
    expect(newNodes).toHaveLength(1);
    expect(newNodes[0].concept).toBe('C');
  });
  it('idMap enables correct edge remapping end-to-end', () => {
    // Simulates the caller pattern: resolve, then remap edges via idMap.
    const existing = { 'SYS-05': node('SYS-05', 'Magic', 'system') };
    const { idMap, newNodes } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Magic', type: 'system' }, // → SYS-05 (existing)
        { id: 'SYS-GEN-2', concept: 'Runes', type: 'concept' }, // → fresh
      ],
      existing,
      alloc(['SYS-05']),
    );
    const rawEdges = [edge('SYS-GEN-1', 'SYS-GEN-2', 'enables')];
    const remapped = rawEdges.map((e) => ({
      from: idMap[e.from] ?? e.from,
      to: idMap[e.to] ?? e.to,
      relation: e.relation,
    }));
    expect(newNodes).toHaveLength(1);
    expect(remapped[0]).toEqual({ from: 'SYS-05', to: 'SYS-6', relation: 'enables' });
  });
  it('reports existing-node ids that were re-mentioned as attributedExistingIds', () => {
    const existing = {
      'SYS-05': node('SYS-05', 'Magic', 'system'),
      'SYS-06': node('SYS-06', 'Runes', 'concept'),
    };
    const { attributedExistingIds, newNodes } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Magic', type: 'system' }, // → SYS-05 (re-mention)
        { id: 'SYS-GEN-2', concept: 'Runes', type: 'concept' }, // → SYS-06 (re-mention)
        { id: 'SYS-GEN-3', concept: 'Wards', type: 'concept' }, // → fresh, not an attribution
      ],
      existing,
      alloc(['SYS-05', 'SYS-06']),
    );
    expect(newNodes).toHaveLength(1);
    expect(newNodes[0].concept).toBe('Wards');
    expect(attributedExistingIds.sort()).toEqual(['SYS-05', 'SYS-06']);
  });
  it('does not duplicate attributedExistingIds when a concept re-mentioned multiple times', () => {
    const existing = { 'SYS-05': node('SYS-05', 'Magic', 'system') };
    const { attributedExistingIds } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Magic', type: 'system' },
        { id: 'SYS-GEN-2', concept: 'magic', type: 'concept' },
        { id: 'SYS-GEN-3', concept: 'MAGIC', type: 'principle' },
      ],
      existing,
      alloc(['SYS-05']),
    );
    expect(attributedExistingIds).toEqual(['SYS-05']);
  });
  it('within-batch duplicates do NOT count as attributions (only existing-graph re-mentions do)', () => {
    const { attributedExistingIds, newNodes } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Magic', type: 'system' }, // fresh
        { id: 'SYS-GEN-2', concept: 'Magic', type: 'concept' }, // batch dup of SYS-GEN-1
      ],
      {},
      alloc(),
    );
    expect(newNodes).toHaveLength(1);
    expect(attributedExistingIds).toEqual([]);
  });
  it('handles empty input', () => {
    const { idMap, newNodes } = resolveSystemConceptIds([], {}, alloc());
    expect(idMap).toEqual({});
    expect(newNodes).toEqual([]);
  });
});

// ── getSceneSystemAttributions ───────────────────────────────────────────────
describe('getSceneSystemAttributions', () => {
  function makeScene(opts: {
    addedNodes?: SystemNode[];
    explicitAttributions?: string[];
  }): Scene {
    // Minimal Scene shape — only the system fields matter for this helper.
    return {
      id: 'S-01',
      arcId: 'ARC-01',
      povId: null,
      locationId: 'L-01',
      participantIds: [],
      events: [],
      threadDeltas: [],
      worldDeltas: [],
      relationshipDeltas: [],
      systemDeltas: opts.addedNodes
        ? { addedNodes: opts.addedNodes, addedEdges: [] }
        : undefined,
      systemAttributions: opts.explicitAttributions,
      summary: '',
      timeDelta: { value: 0, unit: 'minute' },
      kind: 'scene',
    } as Scene;
  }

  it('returns empty when scene has no system data', () => {
    const out = getSceneSystemAttributions(makeScene({}));
    expect(out).toEqual([]);
  });

  it('attributes every introduced node — every system delta starts with 1 attribution', () => {
    const scene = makeScene({
      addedNodes: [node('SYS-01', 'A'), node('SYS-02', 'B')],
    });
    expect(getSceneSystemAttributions(scene)).toEqual(['SYS-01', 'SYS-02']);
  });

  it('merges explicit systemAttributions with introduced ids', () => {
    const scene = makeScene({
      addedNodes: [node('SYS-01', 'A')],
      explicitAttributions: ['SYS-99', 'SYS-77'],
    });
    expect(getSceneSystemAttributions(scene)).toEqual(['SYS-01', 'SYS-99', 'SYS-77']);
  });

  it('deduplicates when an id appears in both addedNodes and systemAttributions', () => {
    const scene = makeScene({
      addedNodes: [node('SYS-01', 'A')],
      explicitAttributions: ['SYS-01', 'SYS-99'],
    });
    expect(getSceneSystemAttributions(scene)).toEqual(['SYS-01', 'SYS-99']);
  });

  it('preserves order: introductions first, then explicit attributions', () => {
    const scene = makeScene({
      addedNodes: [node('SYS-A', 'a')],
      explicitAttributions: ['SYS-B'],
    });
    const out = getSceneSystemAttributions(scene);
    expect(out.indexOf('SYS-A')).toBeLessThan(out.indexOf('SYS-B'));
  });

  it('handles scene with only attributions, no deltas', () => {
    const scene = makeScene({ explicitAttributions: ['SYS-01', 'SYS-02'] });
    expect(getSceneSystemAttributions(scene)).toEqual(['SYS-01', 'SYS-02']);
  });
});
