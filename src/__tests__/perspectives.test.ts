// Tests for the pure perspective helpers — label resolution and the set of
// available lenses for a scene (public narrator + distinct real participants).

import { describe, it, expect } from 'vitest';
import { perspectiveLabel, availablePerspectiveKeys } from '@/lib/ai/perspectives';
import type { NarrativeState, Scene } from '@/types/narrative';

const narrative = {
  characters: { c1: { name: 'Alice' }, c2: { name: 'Bob' } },
  locations: { l1: { name: 'The Keep' } },
  artifacts: { a1: { name: 'The Ledger' } },
} as unknown as NarrativeState;

describe('perspectiveLabel', () => {
  it('resolves the public lens, entity names, and falls back to the key', () => {
    expect(perspectiveLabel(narrative, 'public')).toBe('Public');
    expect(perspectiveLabel(narrative, 'c1')).toBe('Alice');
    expect(perspectiveLabel(narrative, 'l1')).toBe('The Keep');
    expect(perspectiveLabel(narrative, 'a1')).toBe('The Ledger');
    expect(perspectiveLabel(narrative, 'ghost')).toBe('ghost');
  });
});

describe('availablePerspectiveKeys', () => {
  it('leads with public, then distinct real participants (POV + participants)', () => {
    const scene = { povId: 'c1', participantIds: ['c1', 'c2', 'l1'] } as unknown as Scene;
    expect(availablePerspectiveKeys(narrative, scene)).toEqual(['public', 'c1', 'c2', 'l1']);
  });

  it('drops ids that do not resolve to a real entity', () => {
    const scene = { povId: 'c1', participantIds: ['nope', 'a1'] } as unknown as Scene;
    expect(availablePerspectiveKeys(narrative, scene)).toEqual(['public', 'c1', 'a1']);
  });

  it('always includes at least the public lens', () => {
    const scene = { povId: null, participantIds: [] } as unknown as Scene;
    expect(availablePerspectiveKeys(narrative, scene)).toEqual(['public']);
  });
});
