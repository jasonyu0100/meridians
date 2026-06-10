// Tests for lib/scenarios/scenarios-engine — scenario direction building, virtual state, and variable stamping.

import { describe, it, expect } from 'vitest';
import {
  buildDirectionFromScenario,
  buildVirtualState,
  stampScenarioVariables,
} from '@/lib/scenarios/scenarios-engine';
import type {
  Arc,
  NarrativeState,
  PlanningScenario,
  Variable,
} from '@/types/narrative';

// The scenarios engine drives parallel scenario commits. The behaviour
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
    ...overrides,
  };
}

function makeNarrative(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    id: 'N-1',
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
      sceneIds: ['S-1', 'S-2'],
      develops: ['C-1'],
      locationIds: ['L-1'],
      activeCharacterIds: ['C-1', 'C-2'],
    });
    const stamped = stampScenarioVariables(arc, [makeVariable('var-a', 2)]);
    expect(stamped.id).toBe('ARC-1');
    expect(stamped.name).toBe('Opening');
    expect(stamped.directionVector).toBe('toward the cave');
    expect(stamped.sceneIds).toEqual(['S-1', 'S-2']);
    expect(stamped.develops).toEqual(['C-1']);
    expect(stamped.locationIds).toEqual(['L-1']);
    expect(stamped.activeCharacterIds).toEqual(['C-1', 'C-2']);
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
      sceneIds: ['S-1'],
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
          entryIds: ['S-1'],
          createdAt: 1,
        },
      },
    });
    const incomingArc = makeArc('ARC-1', { sceneIds: ['S-2'] });
    const vars: Variable[] = [makeVariable('var-new', 2)];
    const virtual = buildVirtualState(narrative, ['S-1'], incomingArc, [], 'br-main', vars);
    const merged = virtual.narrative.arcs['ARC-1'];
    expect(merged.presentVariables?.map((v) => v.id)).toEqual(['var-new']);
    expect(merged.sceneIds).toEqual(['S-1', 'S-2']);
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

// ── Scenario-shape stamp: full Present annotation transfer ──────────────
//
// When a Future scenario is committed as the basis for a new branch arc,
// every load-bearing annotation field rides across: description, reasoning,
// the three universal inference-shape fields (`considered`, `breaks`,
// `opens`), and the priorLogit. Losing any of these means the new arc's
// Present panel can't show the lineage the user picked.

function makeScenario(overrides: Partial<PlanningScenario> = {}): PlanningScenario {
  return {
    id: 'sc-1',
    name: 'Scenario A',
    color: '#34d399',
    variables: [makeVariable('var-a', 3), makeVariable('var-dormant', 0)],
    ...overrides,
  };
}

describe('stampScenarioVariables — scenario overload', () => {
  it('transfers description, reasoning, and priorLogit onto the arc', () => {
    const arc = makeArc('ARC-1');
    const scenario = makeScenario({
      description: 'The faction consolidates under duress.',
      reasoning: 'Resource scarcity forces the merger; standing-quorum loops back to ratify it.',
      priorLogit: 1.5,
    });
    const stamped = stampScenarioVariables(arc, scenario);
    expect(stamped.presentDescription).toBe('The faction consolidates under duress.');
    expect(stamped.presentReasoning).toBe('Resource scarcity forces the merger; standing-quorum loops back to ratify it.');
    expect(stamped.presentLogit).toBe(1.5);
  });

  it('transfers the universal inference-shape fields (considered / breaks / opens)', () => {
    const arc = makeArc('ARC-1');
    const scenario = makeScenario({
      considered: 'Alternative: rival faction defection (rejected: timing).',
      breaks: 'Breaks if the standing-quorum is dissolved before ratification.',
      opens: 'Opens a thread on cross-faction succession.',
    });
    const stamped = stampScenarioVariables(arc, scenario);
    expect(stamped.presentConsidered).toBe('Alternative: rival faction defection (rejected: timing).');
    expect(stamped.presentBreaks).toBe('Breaks if the standing-quorum is dissolved before ratification.');
    expect(stamped.presentOpens).toBe('Opens a thread on cross-faction succession.');
  });

  it('leaves Present fields undefined when the scenario does not set them', () => {
    // A scenario emitted without the universal-shape fields shouldn't leave
    // stale data on the arc — undefined means "not authored", which the
    // UI uses as the signal to hide those panel sections.
    const arc = makeArc('ARC-1', {
      presentConsidered: 'stale considered',
      presentBreaks: 'stale breaks',
      presentOpens: 'stale opens',
    });
    const stamped = stampScenarioVariables(arc, makeScenario());
    expect(stamped.presentConsidered).toBeUndefined();
    expect(stamped.presentBreaks).toBeUndefined();
    expect(stamped.presentOpens).toBeUndefined();
  });

  it('still filters intensity-zero variables when given a scenario', () => {
    const arc = makeArc('ARC-1');
    const stamped = stampScenarioVariables(arc, makeScenario());
    expect(stamped.presentVariables?.map((v) => v.id)).toEqual(['var-a']);
  });
});

// ── buildDirectionFromScenario ──────────────────────────────────────────
//
// The direction string is the PRIMARY guidance the LLM sees when
// generating an arc from a scenario. The universal inference-shape fields
// must surface there so scene generation inherits the comparative +
// falsification reasoning the scenario already produced.

describe('buildDirectionFromScenario', () => {
  it('places the scenario name and variables block in the output', () => {
    const direction = buildDirectionFromScenario(makeScenario({
      name: 'Calculated Escalation',
      variables: [makeVariable('var-a', 3)],
    }));
    expect(direction).toContain('SCENARIO: Calculated Escalation');
    expect(direction).toContain('PRIMARY GUIDANCE — VARIABLE COORDINATION');
    expect(direction.toLowerCase()).toContain('var-a @ strong (intensity 3/4)');
  });

  it('includes description and reasoning lines when supplied', () => {
    const direction = buildDirectionFromScenario(makeScenario({
      description: 'A short gestalt.',
      reasoning: 'The load-bearing logic.',
    }));
    expect(direction).toContain('Description: A short gestalt.');
    expect(direction).toContain('Why this continuation is plausible: The load-bearing logic.');
  });

  it('threads the universal inference-shape fields into the direction', () => {
    const direction = buildDirectionFromScenario(makeScenario({
      considered: 'Adjacent coordination X (rejected).',
      breaks: 'Breaks if Y crosses threshold.',
      opens: 'Opens an arc-after-next thread.',
    }));
    expect(direction).toContain('× considered');
    expect(direction).toContain('Adjacent coordination X (rejected).');
    expect(direction).toContain('! breaks');
    expect(direction).toContain('Breaks if Y crosses threshold.');
    expect(direction).toContain('⇒ opens');
    expect(direction).toContain('Opens an arc-after-next thread.');
  });

  it('includes the steering directive that ties scene generation to the new fields', () => {
    // The prompt language tells scene generation to STEER AGAINST rejected
    // alternatives, HONOUR `breaks` as a test, and let `opens` shape the
    // arc end-state. Without that directive the new fields are decoration.
    const direction = buildDirectionFromScenario(makeScenario({
      considered: 'X.',
      breaks: 'Y.',
      opens: 'Z.',
    }));
    expect(direction).toMatch(/steer AGAINST the rejected alternatives/i);
    expect(direction).toMatch(/honour `breaks` as the test/i);
    expect(direction).toMatch(/`opens` shape the END of the arc/i);
  });

  it('omits inference-shape lines when the scenario did not author them', () => {
    const direction = buildDirectionFromScenario(makeScenario());
    expect(direction).not.toContain('× considered');
    expect(direction).not.toContain('! breaks');
    expect(direction).not.toContain('⇒ opens');
  });

  it('prefixes overall direction when supplied', () => {
    const direction = buildDirectionFromScenario(makeScenario(), {
      overallDirection: 'The work pivots toward consolidation.',
    });
    expect(direction.indexOf('OVERALL DIRECTION')).toBeLessThan(direction.indexOf('SCENARIO:'));
    expect(direction).toContain('The work pivots toward consolidation.');
  });
});

// ── Virtual state preserves Present inference-shape on merge ────────────

describe('buildVirtualState with scenario Present fields', () => {
  it('propagates the scenario inference-shape onto an arc merge', () => {
    // Mirrors a scenario continuation that appends scenes to an arc that
    // already exists — the new Present annotation must override stale
    // values rather than be silently dropped during the spread.
    const existingArc = makeArc('ARC-1', {
      sceneIds: ['S-1'],
      presentDescription: 'stale',
      presentReasoning: 'stale',
      presentConsidered: 'stale',
      presentBreaks: 'stale',
      presentOpens: 'stale',
    });
    const narrative = makeNarrative({
      arcs: { 'ARC-1': existingArc },
      branches: {
        'br-main': {
          id: 'br-main',
          name: 'main',
          parentBranchId: null,
          forkEntryId: null,
          entryIds: ['S-1'],
          createdAt: 1,
        },
      },
    });
    const incomingArc = makeArc('ARC-1', { sceneIds: ['S-2'] });
    const scenario = makeScenario({
      description: 'fresh desc',
      reasoning: 'fresh reasoning',
      considered: 'fresh considered',
      breaks: 'fresh breaks',
      opens: 'fresh opens',
      priorLogit: 2.1,
    });
    const virtual = buildVirtualState(narrative, ['S-1'], incomingArc, [], 'br-main', scenario);
    const merged = virtual.narrative.arcs['ARC-1'];
    expect(merged.presentDescription).toBe('fresh desc');
    expect(merged.presentReasoning).toBe('fresh reasoning');
    expect(merged.presentConsidered).toBe('fresh considered');
    expect(merged.presentBreaks).toBe('fresh breaks');
    expect(merged.presentOpens).toBe('fresh opens');
    expect(merged.presentLogit).toBe(2.1);
  });
});
