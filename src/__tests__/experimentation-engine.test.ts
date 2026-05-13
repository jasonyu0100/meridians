import { describe, it, expect } from 'vitest';
import {
  buildVirtualState,
  stampScenarioVariables,
} from '@/lib/experimentation-engine';
import type {
  Arc,
  NarrativeState,
  Variable,
} from '@/types/narrative';

// The experimentation engine drives parallel scenario commits. The behaviour
// pinned here is the per-scenario variable stamp: every new arc carries the
// variables that produced it as `presentVariables`, with intensity-zero
// entries filtered out so the surface reflects only what's firing. Both the
// virtual preview and the real commit path go through the same helper so the
// previewed arc matches the committed one — a regression here means the
// committed branch loses its variable fingerprint.

// ── Fixture helpers ──────────────────────────────────────────────────────

function makeVariable(id: string, intensity: number, overrides: Partial<Variable> = {}): Variable {
  return {
    id,
    name: id,
    description: `${id} description`,
    category: 'general',
    intensity,
    ...overrides,
  };
}

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

function makeNarrative(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    id: 'N-01',
    title: 'Test',
    description: '',
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    arcs: {},
    scenes: {},
    worldBuilds: {},
    branches: {},
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── stampScenarioVariables ───────────────────────────────────────────────

describe('stampScenarioVariables', () => {
  it('stamps the firing variables onto the arc', () => {
    const arc = makeArc('ARC-1');
    const vars: Variable[] = [
      makeVariable('var-a', 3),
      makeVariable('var-b', 1),
    ];
    const stamped = stampScenarioVariables(arc, vars);
    expect(stamped.presentVariables).toEqual(vars);
  });

  it('filters out intensity-zero variables (dormant variables)', () => {
    const arc = makeArc('ARC-1');
    const vars: Variable[] = [
      makeVariable('var-a', 0),
      makeVariable('var-b', 2),
      makeVariable('var-c', 0),
      makeVariable('var-d', 4),
    ];
    const stamped = stampScenarioVariables(arc, vars);
    expect(stamped.presentVariables?.map((v) => v.id)).toEqual(['var-b', 'var-d']);
  });

  it('returns an empty array when every variable is dormant', () => {
    const arc = makeArc('ARC-1');
    const vars: Variable[] = [
      makeVariable('var-a', 0),
      makeVariable('var-b', 0),
    ];
    const stamped = stampScenarioVariables(arc, vars);
    expect(stamped.presentVariables).toEqual([]);
  });

  it('preserves every other field on the arc', () => {
    const arc = makeArc('ARC-1', {
      name: 'Opening',
      directionVector: 'toward the cave',
      sceneIds: ['S-001', 'S-002'],
      develops: ['C-01'],
      locationIds: ['L-01'],
      activeCharacterIds: ['C-01', 'C-02'],
      initialCharacterLocations: { 'C-01': 'L-01' },
    });
    const stamped = stampScenarioVariables(arc, [makeVariable('var-a', 2)]);
    expect(stamped.id).toBe('ARC-1');
    expect(stamped.name).toBe('Opening');
    expect(stamped.directionVector).toBe('toward the cave');
    expect(stamped.sceneIds).toEqual(['S-001', 'S-002']);
    expect(stamped.develops).toEqual(['C-01']);
    expect(stamped.locationIds).toEqual(['L-01']);
    expect(stamped.activeCharacterIds).toEqual(['C-01', 'C-02']);
    expect(stamped.initialCharacterLocations).toEqual({ 'C-01': 'L-01' });
  });

  it('does not mutate the input arc', () => {
    const arc = makeArc('ARC-1');
    expect(arc.presentVariables).toBeUndefined();
    stampScenarioVariables(arc, [makeVariable('var-a', 2)]);
    expect(arc.presentVariables).toBeUndefined();
  });

  it('overwrites any presentVariables already on the arc', () => {
    const arc = makeArc('ARC-1', {
      presentVariables: [makeVariable('var-old', 4)],
    });
    const stamped = stampScenarioVariables(arc, [makeVariable('var-new', 2)]);
    expect(stamped.presentVariables?.map((v) => v.id)).toEqual(['var-new']);
  });
});

// ── buildVirtualState ────────────────────────────────────────────────────

describe('buildVirtualState', () => {
  it('places the stamped arc into the virtual narrative', () => {
    const narrative = makeNarrative({
      branches: {
        'br-main': {
          id: 'br-main',
          name: 'main',
          parentBranchId: null,
          forkEntryId: null,
          entryIds: [],
          createdAt: 1,
        },
      },
    });
    const arc = makeArc('ARC-1');
    const vars: Variable[] = [
      makeVariable('var-a', 3),
      makeVariable('var-b', 0),
    ];
    const virtual = buildVirtualState(narrative, [], arc, [], 'br-main', vars);
    const stampedArc = virtual.narrative.arcs['ARC-1'];
    expect(stampedArc).toBeDefined();
    expect(stampedArc.presentVariables?.map((v) => v.id)).toEqual(['var-a']);
  });

  it('merges presentVariables onto an existing arc with the same id', () => {
    // Mirrors what happens when a scenario continuation appends scenes to an
    // arc that already lives in the root narrative — the variables still need to
    // override the stale ones so the resulting branch reflects this scenario.
    const arc = makeArc('ARC-1', {
      sceneIds: ['S-001'],
      presentVariables: [makeVariable('var-old', 4)],
    });
    const narrative = makeNarrative({
      arcs: { 'ARC-1': arc },
      branches: {
        'br-main': {
          id: 'br-main',
          name: 'main',
          parentBranchId: null,
          forkEntryId: null,
          entryIds: ['S-001'],
          createdAt: 1,
        },
      },
    });
    const incomingArc = makeArc('ARC-1', { sceneIds: ['S-002'] });
    const vars: Variable[] = [makeVariable('var-new', 2)];
    const virtual = buildVirtualState(narrative, ['S-001'], incomingArc, [], 'br-main', vars);
    const merged = virtual.narrative.arcs['ARC-1'];
    expect(merged.presentVariables?.map((v) => v.id)).toEqual(['var-new']);
    expect(merged.sceneIds).toEqual(['S-001', 'S-002']);
  });

  it('does not mutate the root narrative', () => {
    const narrative = makeNarrative({
      branches: {
        'br-main': {
          id: 'br-main',
          name: 'main',
          parentBranchId: null,
          forkEntryId: null,
          entryIds: [],
          createdAt: 1,
        },
      },
    });
    const arc = makeArc('ARC-1');
    buildVirtualState(narrative, [], arc, [], 'br-main', [makeVariable('var-a', 2)]);
    expect(narrative.arcs['ARC-1']).toBeUndefined();
  });
});
