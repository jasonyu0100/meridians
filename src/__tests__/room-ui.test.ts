// Tests for the pure helpers in components/stage/RoomUI — id-minting
// builders (stream / merge / prior) and the perspective/member name resolvers
// the Vision surfaces rely on. (The avatar/octicon components aren't exercised
// here — only the deterministic logic.)

import { describe, it, expect } from 'vitest';
import type { NarrativeState, Perspective } from '@/types/narrative';
import {
  buildStream,
  buildMerge,
  buildPrior,
  perspectiveName,
  perspectiveEntity,
  memberName,
} from '@/components/stage/RoomUI';

// A minimal narrative — only the fields the resolvers read.
const n = {
  characters: { c1: { id: 'c1', name: 'Fang Yuan' } },
  locations: { l1: { id: 'l1', name: 'Ice Ravine' } },
  artifacts: { a1: { id: 'a1', name: 'Frost Crystal Gu' } },
} as unknown as NarrativeState;

describe('builders', () => {
  it('buildStream opens an open stream, seeding the first prior when given', () => {
    const s = buildStream('persp-1', 'Will it hold?', 'm-1', 'first note');
    expect(s.state).toBe('open');
    expect(s.title).toBe('Will it hold?');
    expect(s.perspectiveId).toBe('persp-1');
    expect(s.memberId).toBe('m-1');
    expect(s.priors).toHaveLength(1);
    expect(s.priors[0].text).toBe('first note');
    expect(s.id).toMatch(/^stream-/);
  });

  it('buildStream with no seed prior has an empty prior log', () => {
    expect(buildStream('p', 't').priors).toHaveLength(0);
  });

  it('buildMerge carries label + streamIds + per-stream resolutions', () => {
    const m = buildMerge(['s1', 's2'], 'Week 1', { s1: { outcome: 'Yes' }, s2: { outcome: 'No', overridden: true } });
    expect(m.label).toBe('Week 1');
    expect(m.streamIds).toEqual(['s1', 's2']);
    expect(m.resolutions?.s2).toEqual({ outcome: 'No', overridden: true });
    expect(m.id).toMatch(/^merge-/);
    expect(typeof m.at).toBe('number');
  });

  it('buildPrior stamps id, text, author, and time', () => {
    const p = buildPrior('an observation', 'm-2');
    expect(p.text).toBe('an observation');
    expect(p.authorId).toBe('m-2');
    expect(p.id).toMatch(/^p-/);
    expect(typeof p.at).toBe('number');
  });
});

describe('perspectiveName', () => {
  const persp = (o: Partial<Perspective>): Perspective => ({ id: 'pp', kind: 'character', ...o });

  it('prefers an explicit label', () => {
    expect(perspectiveName(persp({ label: 'The Schemer', entityRef: 'c1' }), n)).toBe('The Schemer');
  });
  it('resolves the bound entity name by kind', () => {
    expect(perspectiveName(persp({ kind: 'character', entityRef: 'c1' }), n)).toBe('Fang Yuan');
    expect(perspectiveName(persp({ kind: 'location', entityRef: 'l1' }), n)).toBe('Ice Ravine');
    expect(perspectiveName(persp({ kind: 'artifact', entityRef: 'a1' }), n)).toBe('Frost Crystal Gu');
  });
  it('names the narrator vantage', () => {
    expect(perspectiveName(persp({ kind: 'narrator', entityRef: undefined }), n)).toBe('Narrator');
  });
  it('falls back to the kind label when the entity is missing', () => {
    expect(perspectiveName(persp({ kind: 'character', entityRef: 'missing' }), n)).toBe('Character');
  });
  it('is "unknown" for an undefined perspective', () => {
    expect(perspectiveName(undefined, n)).toBe('unknown');
  });
});

describe('perspectiveEntity', () => {
  it('returns the bound entity for entity perspectives', () => {
    expect(perspectiveEntity({ id: 'pp', kind: 'character', entityRef: 'c1' }, n)?.name).toBe('Fang Yuan');
  });
  it('returns undefined for the narrator vantage', () => {
    expect(perspectiveEntity({ id: 'pp', kind: 'narrator' }, n)).toBeUndefined();
  });
});

describe('memberName', () => {
  it('joins first + last, trims, and handles the empty/undefined cases', () => {
    expect(memberName({ id: 'm', firstName: 'Jason', lastName: 'Yu', role: 'gm' })).toBe('Jason Yu');
    expect(memberName({ id: 'm', firstName: '', lastName: '', role: 'member' })).toBe('unnamed');
    expect(memberName(undefined)).toBe('unassigned');
  });
});
