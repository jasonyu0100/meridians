import { describe, it, expect } from 'vitest';
import { buildSequentialPath, type ReasoningGraph, type ExpansionReasoningGraph } from '@/lib/ai/reasoning-graph';
import type { ReasoningGraphSnapshot, WorldBuild, NarrativeState } from '@/types/narrative';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createReasoningGraph(overrides: Partial<ReasoningGraph> = {}): ReasoningGraph {
  return {
    nodes: [
      { id: 'F1', index: 0, order: 0, type: 'fate', label: 'Thread needs escalation', threadId: 'T-1', detail: 'Fate pulls toward confrontation' },
      { id: 'R1', index: 1, order: 1, type: 'reasoning', label: 'Character must act', detail: 'Sets up the logic' },
      { id: 'C1', index: 2, order: 2, type: 'character', label: 'Character action', entityId: 'C-1' },
    ],
    edges: [
      { id: 'e1', from: 'F1', to: 'R1', type: 'requires' },
      { id: 'e2', from: 'R1', to: 'C1', type: 'requires' },
    ],
    arcName: 'Test Arc',
    sceneCount: 3,
    summary: 'A test reasoning graph',
    ...overrides,
  };
}

function createExpansionReasoningGraph(overrides: Partial<ExpansionReasoningGraph> = {}): ExpansionReasoningGraph {
  return {
    nodes: [
      { id: 'F1', index: 0, order: 0, type: 'fate', label: 'Thread needs antagonist', threadId: 'T-1', detail: 'Fate demands opposition' },
      { id: 'R1', index: 1, order: 1, type: 'reasoning', label: 'Faction provides conflict', detail: 'Creates opposition' },
      { id: 'G1', index: 2, order: 2, type: 'system', label: 'Gap identified', detail: 'Missing antagonist faction' },
      { id: 'C1', index: 3, order: 3, type: 'character', label: 'New character fills gap', entityId: 'C-2' },
      { id: 'P1', index: 4, order: 4, type: 'pattern', label: 'Variety opportunity', detail: 'Fresh direction' },
      { id: 'W1', index: 5, order: 5, type: 'warning', label: 'Avoid repetition', detail: 'Risk of staleness' },
    ],
    edges: [
      { id: 'e1', from: 'F1', to: 'R1', type: 'requires' },
      { id: 'e2', from: 'R1', to: 'C1', type: 'requires' },
      { id: 'e3', from: 'G1', to: 'C1', type: 'enables' },
      { id: 'e4', from: 'P1', to: 'R1', type: 'enables' },
      { id: 'e5', from: 'W1', to: 'R1', type: 'constrains' },
    ],
    expansionName: 'Test Expansion',
    summary: 'Expansion reasoning graph test',
    ...overrides,
  };
}

function createWorldBuildWithReasoning(): WorldBuild {
  const expansionGraph = createExpansionReasoningGraph();
  return {
    kind: 'world_build',
    id: 'WB-1',
    summary: 'Test world expansion',
    expansionManifest: {
      newCharacters: [],
      newLocations: [],
      newThreads: [],
      newArtifacts: [],
      systemDeltas: { addedNodes: [], addedEdges: [] },
    },
    reasoningGraph: {
      nodes: expansionGraph.nodes,
      edges: expansionGraph.edges,
      arcName: expansionGraph.expansionName,
      sceneCount: 0,
      summary: expansionGraph.summary,
    },
  };
}

// ── buildSequentialPath Tests ────────────────────────────────────────────────

describe('buildSequentialPath', () => {
  it('should format nodes in index order with connections', () => {
    const graph = createReasoningGraph();
    const path = buildSequentialPath(graph);

    // Should contain all nodes in order (backward reasoning: fate first)
    expect(path).toContain('[0] FATE: Thread needs escalation');
    expect(path).toContain('[1] REASONING: Character must act');
    expect(path).toContain('[2] CHARACTER: Character action');

    // Should show outgoing edges
    expect(path).toContain('requires→R1');
    expect(path).toContain('requires→C1');
  });

  it('should include entity references', () => {
    const graph = createReasoningGraph();
    const path = buildSequentialPath(graph);

    expect(path).toContain('@C-1'); // entityId reference
    expect(path).toContain('#T-1'); // threadId reference
  });

  it('should include node details', () => {
    const graph = createReasoningGraph();
    const path = buildSequentialPath(graph);

    // Detail is prefixed with `· ` (bullet) to distinguish from edge arrows
    // which use → and ←.
    expect(path).toContain('· Sets up the logic');
  });

  it('should handle empty graph', () => {
    const graph = createReasoningGraph({ nodes: [], edges: [] });
    const path = buildSequentialPath(graph);

    expect(path).toBe('');
  });

  it('should handle nodes without edges', () => {
    const graph = createReasoningGraph({
      nodes: [{ id: 'R1', index: 0, order: 0, type: 'reasoning', label: 'Standalone' }],
      edges: [],
    });
    const path = buildSequentialPath(graph);

    expect(path).toContain('[0] REASONING: Standalone');
    expect(path).not.toContain('→');
  });

  it('should work with expansion reasoning graphs', () => {
    const graph = createExpansionReasoningGraph();
    const path = buildSequentialPath(graph);

    // Should include pattern and warning node types
    expect(path).toContain('PATTERN:');
    expect(path).toContain('WARNING:');
    expect(path).toContain('SYSTEM:');
  });

  it('should render incoming edges so convergence points are visible', () => {
    // R1 has an incoming edge from F1 (F1 requires R1), and C1 has an
    // incoming edge from R1 (R1 requires C1). The new format surfaces
    // each node's predecessors on its own entry so an LLM reading
    // sequentially can see the full bidirectional context without having
    // to scan the whole list.
    const graph = createReasoningGraph();
    const path = buildSequentialPath(graph);

    expect(path).toContain('in:');
    expect(path).toMatch(/F1←requires/);
    expect(path).toMatch(/R1←requires/);
  });
});

// ── Reasoning Graph Structure Tests ──────────────────────────────────────────

describe('ReasoningGraph structure', () => {
  it('should have required fields for arc reasoning', () => {
    const graph = createReasoningGraph();

    expect(graph.arcName).toBeDefined();
    expect(graph.sceneCount).toBeDefined();
    expect(graph.summary).toBeDefined();
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
  });

  it('should have valid node types', () => {
    const graph = createReasoningGraph();
    const validTypes = ['fate', 'character', 'location', 'artifact', 'system', 'reasoning', 'pattern', 'warning'];

    for (const node of graph.nodes) {
      expect(validTypes).toContain(node.type);
    }
  });

  it('should have valid edge types', () => {
    const graph = createReasoningGraph();
    const validTypes = ['enables', 'constrains', 'risks', 'requires', 'causes', 'reveals', 'develops', 'resolves', 'supersedes'];

    for (const edge of graph.edges) {
      expect(validTypes).toContain(edge.type);
    }
  });
});

describe('ExpansionReasoningGraph structure', () => {
  it('should have expansionName instead of arcName', () => {
    const graph = createExpansionReasoningGraph();

    expect(graph.expansionName).toBeDefined();
    expect((graph as unknown as ReasoningGraph).arcName).toBeUndefined();
  });

  it('should include cooperative agent (pattern) nodes', () => {
    const graph = createExpansionReasoningGraph();
    const patternNodes = graph.nodes.filter(n => n.type === 'pattern');

    expect(patternNodes.length).toBeGreaterThan(0);
  });

  it('should include adversarial agent (warning) nodes', () => {
    const graph = createExpansionReasoningGraph();
    const warningNodes = graph.nodes.filter(n => n.type === 'warning');

    expect(warningNodes.length).toBeGreaterThan(0);
  });
});

// ── WorldBuild Reasoning Graph Tests ─────────────────────────────────────────

describe('WorldBuild with reasoningGraph', () => {
  it('should store reasoning graph snapshot on world build', () => {
    const worldBuild = createWorldBuildWithReasoning();

    expect(worldBuild.reasoningGraph).toBeDefined();
    expect(worldBuild.reasoningGraph!.nodes.length).toBeGreaterThan(0);
    expect(worldBuild.reasoningGraph!.edges.length).toBeGreaterThan(0);
  });

  it('should convert ExpansionReasoningGraph to ReasoningGraphSnapshot format', () => {
    const worldBuild = createWorldBuildWithReasoning();
    const snapshot = worldBuild.reasoningGraph!;

    // Should have arcName (mapped from expansionName)
    expect(snapshot.arcName).toBe('Test Expansion');
    // Should have sceneCount = 0 for world builds
    expect(snapshot.sceneCount).toBe(0);
    expect(snapshot.summary).toBeDefined();
  });

  it('should be usable with buildSequentialPath', () => {
    const worldBuild = createWorldBuildWithReasoning();
    const path = buildSequentialPath(worldBuild.reasoningGraph!);

    expect(path).toContain('SYSTEM:');
    expect(path).toContain('CHARACTER:');
    expect(path).toContain('REASONING:');
  });
});
