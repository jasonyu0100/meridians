// Tests for the curriculum-restructure sanitiser — the id-stable, cross-branch
// safety layer. Topics are global; these invariants guarantee a restructure
// never dangles a question or builds an invalid tree.

import { describe, it, expect } from 'vitest';
import { sanitizeCurriculum, applyCurriculumRestructure } from '@/lib/ai/curriculum-restructure';
import type { LearningQuestion, NarrativeState, Scene, Topic } from '@/types/narrative';

function topic(id: string, name: string, parentId: string | null): Topic {
  return { id, name, parentId, createdAt: 0 };
}

/** Minimal narrative — sanitizeCurriculum only reads `topics`. */
function narrativeWith(topics: Topic[]): NarrativeState {
  return {
    topics: Object.fromEntries(topics.map((t) => [t.id, t])),
  } as unknown as NarrativeState;
}

function question(id: string, topicId: string | undefined): LearningQuestion {
  return {
    id,
    sceneId: '',
    prompt: id,
    options: ['a', 'b'],
    correctIndex: 0,
    bloom: 'remember',
    difficulty: 'easy',
    createdAt: 0,
    topicId,
  };
}

function scene(id: string, questions: LearningQuestion[]): Scene {
  return { id, questions } as unknown as Scene;
}

/** Narrative with topics + scenes (scenes stand in for branch membership — all
 *  scenes are visited, modelling the cumulative cross-branch bank). */
function narrativeWithScenes(topics: Topic[], scenes: Scene[]): NarrativeState {
  return {
    topics: Object.fromEntries(topics.map((t) => [t.id, t])),
    scenes: Object.fromEntries(scenes.map((s) => [s.id, s])),
  } as unknown as NarrativeState;
}

describe('sanitizeCurriculum', () => {
  it('resolves merge chains to a terminal survivor and drops the rest', () => {
    const n = narrativeWith([
      topic('TOP-1', 'Root', null),
      topic('TOP-2', 'Dup A', null),
      topic('TOP-3', 'Dup B', null),
    ]);
    // A → B → C should collapse A and B onto C (TOP-1).
    const out = sanitizeCurriculum(
      { merges: [{ from: 'TOP-3', into: 'TOP-2' }, { from: 'TOP-2', into: 'TOP-1' }], renames: {}, assignments: {} },
      n,
    );
    const removed = new Set(out.merges.map((m) => m.from));
    expect(removed).toEqual(new Set(['TOP-2', 'TOP-3']));
    // Both resolve to the terminal survivor TOP-1.
    expect(out.merges.every((m) => m.into === 'TOP-1')).toBe(true);
    // Survivors = everything not merged away.
    expect(Object.keys(out.assignments).sort()).toEqual(['TOP-1']);
  });

  it('ignores self-merges and merges referencing unknown ids', () => {
    const n = narrativeWith([topic('TOP-1', 'A', null), topic('TOP-2', 'B', null)]);
    const out = sanitizeCurriculum(
      {
        merges: [
          { from: 'TOP-1', into: 'TOP-1' }, // self
          { from: 'TOP-9', into: 'TOP-1' }, // unknown from
          { from: 'TOP-2', into: 'TOP-9' }, // unknown into
        ],
        renames: {},
        assignments: {},
      },
      n,
    );
    expect(out.merges).toEqual([]);
    expect(Object.keys(out.assignments).sort()).toEqual(['TOP-1', 'TOP-2']);
  });

  it('redirects a parent that was merged away onto its survivor', () => {
    const n = narrativeWith([
      topic('TOP-1', 'Broad', null),
      topic('TOP-2', 'Broad dup', null),
      topic('TOP-3', 'Narrow', 'TOP-2'),
    ]);
    // Merge the duplicate broad topic into TOP-1; TOP-3 was parented under the
    // removed TOP-2 and must follow onto TOP-1.
    const out = sanitizeCurriculum(
      { merges: [{ from: 'TOP-2', into: 'TOP-1' }], renames: {}, assignments: { 'TOP-3': 'TOP-2' } },
      n,
    );
    expect(out.assignments['TOP-3']).toBe('TOP-1');
    expect(out.assignments['TOP-2']).toBeUndefined(); // merged away
  });

  it('breaks reparenting cycles by promoting to root', () => {
    const n = narrativeWith([topic('TOP-1', 'A', null), topic('TOP-2', 'B', null)]);
    const out = sanitizeCurriculum(
      { merges: [], renames: {}, assignments: { 'TOP-1': 'TOP-2', 'TOP-2': 'TOP-1' } },
      n,
    );
    // Exactly one of them ends at root; neither points into a cycle.
    const roots = Object.values(out.assignments).filter((p) => p === null).length;
    expect(roots).toBeGreaterThanOrEqual(1);
    // No self-parent.
    expect(out.assignments['TOP-1']).not.toBe('TOP-1');
    expect(out.assignments['TOP-2']).not.toBe('TOP-2');
  });

  it('drops self-parent and dangling parents', () => {
    const n = narrativeWith([topic('TOP-1', 'A', null), topic('TOP-2', 'B', null)]);
    const out = sanitizeCurriculum(
      { merges: [], renames: {}, assignments: { 'TOP-1': 'TOP-1', 'TOP-2': 'TOP-9' } },
      n,
    );
    expect(out.assignments['TOP-1']).toBeNull();
    expect(out.assignments['TOP-2']).toBeNull();
  });

  it('keeps only changed, non-empty renames on surviving topics', () => {
    const n = narrativeWith([topic('TOP-1', 'Wandlore', null), topic('TOP-2', 'Gone', null)]);
    const out = sanitizeCurriculum(
      {
        merges: [{ from: 'TOP-2', into: 'TOP-1' }],
        renames: { 'TOP-1': 'Wand Lore', 'TOP-2': 'Ignored', 'TOP-9': 'Unknown' },
        assignments: {},
      },
      n,
    );
    expect(out.renames).toEqual({ 'TOP-1': 'Wand Lore' }); // TOP-2 merged away, TOP-9 unknown
  });

  it('keeps a topic the model omitted at its current parent', () => {
    const n = narrativeWith([topic('TOP-1', 'Root', null), topic('TOP-2', 'Child', 'TOP-1')]);
    // assignments only mentions TOP-1; TOP-2 must keep its existing parent.
    const out = sanitizeCurriculum({ merges: [], renames: {}, assignments: { 'TOP-1': null } }, n);
    expect(out.assignments['TOP-2']).toBe('TOP-1');
  });
});

describe('applyCurriculumRestructure (cross-branch question redirect)', () => {
  it('merges a topic and redirects its questions in EVERY scene, removing the topic', () => {
    // TOP-2 is referenced by a question in S-2 (model this as a scene only on
    // another branch). Merging TOP-2 → TOP-1 must redirect that question even
    // though it lives on a different scene.
    const n = narrativeWithScenes(
      [topic('TOP-1', 'Keep', null), topic('TOP-2', 'Dup', null)],
      [
        scene('S-1', [question('Q-1', 'TOP-1')]),
        scene('S-2', [question('Q-2', 'TOP-2')]),
      ],
    );
    const { topics, scenes } = applyCurriculumRestructure(n, {
      assignments: { 'TOP-1': null },
      renames: {},
      merges: [{ from: 'TOP-2', into: 'TOP-1' }],
    });
    expect(topics['TOP-2']).toBeUndefined(); // merged away
    expect(topics['TOP-1']).toBeDefined();
    expect(scenes['S-2'].questions![0].topicId).toBe('TOP-1'); // redirected cross-scene
    expect(scenes['S-1'].questions![0].topicId).toBe('TOP-1'); // untouched
    // No question points at a removed topic anywhere.
    for (const s of Object.values(scenes)) {
      for (const q of s.questions ?? []) {
        if (q.topicId) expect(topics[q.topicId]).toBeDefined();
      }
    }
  });

  it('applies reparenting + rename to surviving topics', () => {
    const n = narrativeWithScenes(
      [topic('TOP-1', 'Broad', null), topic('TOP-2', 'Wandlore', null)],
      [scene('S-1', [question('Q-1', 'TOP-1'), question('Q-2', 'TOP-2')])],
    );
    const { topics } = applyCurriculumRestructure(n, {
      assignments: { 'TOP-1': null, 'TOP-2': 'TOP-1' },
      renames: { 'TOP-2': 'Wand Lore' },
      merges: [],
    });
    expect(topics['TOP-2'].parentId).toBe('TOP-1');
    expect(topics['TOP-2'].name).toBe('Wand Lore');
  });

  it('prunes a topic left with no questions after a merge', () => {
    // TOP-2 has no questions and no children; after the restructure it should be
    // pruned (it only existed as an empty node).
    const n = narrativeWithScenes(
      [topic('TOP-1', 'Keep', null), topic('TOP-2', 'Empty', null)],
      [scene('S-1', [question('Q-1', 'TOP-1')])],
    );
    const { topics } = applyCurriculumRestructure(n, {
      assignments: { 'TOP-1': null, 'TOP-2': null },
      renames: {},
      merges: [],
    });
    expect(topics['TOP-2']).toBeUndefined();
    expect(topics['TOP-1']).toBeDefined();
  });
});
