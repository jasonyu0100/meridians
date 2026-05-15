/**
 * ID remapping for Experimentation commits.
 *
 * Every parallel scenario worker calls `generateScenes` against the SAME
 * root narrative, so each worker mints IDs (`ARC-N`, `S-N`, `C-N`,
 * `L-N`, `A-N`, `T-N`, `K-N`, system node ids) from an identical
 * starting state. On commit, every freshly-introduced ID across N
 * scenarios collides on the same `C-15`, `L-8`, etc.
 *
 * This module performs a per-scenario remap, walking every reference
 * field in the scenes + arc and substituting fresh ids drawn from a
 * cumulative "taken" set carried across the commit batch. After remap,
 * each scenario's payload has globally-unique ids for everything it
 * newly introduces, while references to pre-existing entities (already
 * in the live narrative) pass through untouched.
 */

import type {
  Arc,
  Scene,
  Character,
  Location,
  Artifact,
  Thread,
  World,
  WorldEdge,
  WorldDelta,
  SystemDelta,
  NarrativeState,
} from '@/types/narrative';

// ── Public types ──────────────────────────────────────────────────────────

/** Per-scenario remap result — the rewritten arc + scenes ready to dispatch. */
export type RemappedRun = {
  arc: Arc;
  scenes: Scene[];
};

/** Cumulative taken-id sets, mutated as each scenario is remapped. */
export type TakenIds = {
  arc: Set<string>;
  scene: Set<string>;
  char: Set<string>;
  loc: Set<string>;
  art: Set<string>;
  thread: Set<string>;
  k: Set<string>;
  sys: Set<string>;
};

export function buildTakenFromNarrative(n: NarrativeState): TakenIds {
  const charKs: string[] = [];
  for (const c of Object.values(n.characters)) charKs.push(...Object.keys(c.world?.nodes ?? {}));
  const locKs: string[] = [];
  for (const l of Object.values(n.locations)) locKs.push(...Object.keys(l.world?.nodes ?? {}));
  const artKs: string[] = [];
  for (const a of Object.values(n.artifacts ?? {})) artKs.push(...Object.keys(a.world?.nodes ?? {}));
  return {
    arc: new Set(Object.keys(n.arcs)),
    scene: new Set(Object.keys(n.scenes)),
    char: new Set(Object.keys(n.characters)),
    loc: new Set(Object.keys(n.locations)),
    art: new Set(Object.keys(n.artifacts ?? {})),
    thread: new Set(Object.keys(n.threads)),
    k: new Set([...charKs, ...locKs, ...artKs]),
    sys: new Set(Object.keys(n.systemGraph?.nodes ?? {})),
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────

type IdMaps = {
  arc: Map<string, string>;
  scene: Map<string, string>;
  char: Map<string, string>;
  loc: Map<string, string>;
  art: Map<string, string>;
  thread: Map<string, string>;
  k: Map<string, string>;
  sys: Map<string, string>;
};

function makeMaps(): IdMaps {
  return {
    arc: new Map(),
    scene: new Map(),
    char: new Map(),
    loc: new Map(),
    art: new Map(),
    thread: new Map(),
    k: new Map(),
    sys: new Map(),
  };
}

/** Mint a fresh id with the given prefix that isn't in `taken`. Canonical
 *  unpadded form (`SYS-7`, not `SYS-07`) — matches the rest of the pipeline so
 *  scenario commits can't introduce padded duplicates like SYS-017 alongside
 *  an existing SYS-17. */
function fresh(prefix: string, taken: Set<string>): string {
  let n = 1;
  while (true) {
    const candidate = `${prefix}-${n}`;
    if (!taken.has(candidate)) return candidate;
    n++;
  }
}

/**
 * Reserve an id for a newly-introduced entity. If the proposed id already
 * exists in `taken`, mint a fresh one. Either way add to `taken` and store
 * the mapping (even when no rename occurred — downstream walks need the
 * map populated to know "this id is a NEW entity in this scenario").
 */
function reserve(
  proposedId: string,
  prefix: string,
  taken: Set<string>,
  map: Map<string, string>,
): string {
  const next = taken.has(proposedId) ? fresh(prefix, taken) : proposedId;
  taken.add(next);
  map.set(proposedId, next);
  return next;
}

/** Apply a map if the original id is in it, else pass through. */
function remap(id: string | undefined, map: Map<string, string>): string {
  if (!id) return id ?? '';
  return map.get(id) ?? id;
}

/** Try each map in order — used for fields that can reference any of
 *  several entity types (e.g. ownership from/to can be character or location). */
function remapAny(id: string | undefined, ...maps: Map<string, string>[]): string {
  if (!id) return id ?? '';
  for (const m of maps) if (m.has(id)) return m.get(id)!;
  return id;
}

// ── World / system delta helpers ─────────────────────────────────────────

function remapWorld(world: World, kMap: Map<string, string>, prefix: string, taken: Set<string>): World {
  // Pre-pass: reserve fresh ids for every node in this world (only new
  // ones — pre-existing world nodes wouldn't be in the entity's
  // `newCharacters`/etc. payload anyway, but defensive). The map is
  // shared across the whole scenario so we keep id continuity across
  // entities that reference each other's nodes.
  for (const nid of Object.keys(world.nodes ?? {})) {
    if (!kMap.has(nid)) reserve(nid, prefix, taken, kMap);
  }
  const nodes: Record<string, World['nodes'][string]> = {};
  for (const [id, node] of Object.entries(world.nodes ?? {})) {
    const newId = remap(id, kMap);
    nodes[newId] = { ...node, id: newId };
  }
  const edges: WorldEdge[] = (world.edges ?? []).map((e) => ({
    ...e,
    from: remap(e.from, kMap),
    to: remap(e.to, kMap),
  }));
  return { nodes, edges };
}

function remapWorldDelta(d: WorldDelta, kMap: Map<string, string>, entityMap: Map<string, string>): WorldDelta {
  // WorldDelta only carries addedNodes (no edges) — see `WorldDelta` in
  // types/narrative.ts. World edges live inside per-entity world graphs.
  return {
    ...d,
    entityId: remap(d.entityId, entityMap),
    addedNodes: (d.addedNodes ?? []).map((n) => ({ ...n, id: remap(n.id, kMap) })),
  };
}

function remapSystemDelta(d: SystemDelta, sysMap: Map<string, string>): SystemDelta {
  return {
    ...d,
    addedNodes: (d.addedNodes ?? []).map((n) => ({ ...n, id: remap(n.id, sysMap) })),
    addedEdges: (d.addedEdges ?? []).map((e) => ({
      ...e,
      from: remap(e.from, sysMap),
      to: remap(e.to, sysMap),
    })),
  };
}

// ── Public entry point ───────────────────────────────────────────────────

/**
 * Remap one scenario's arc + scenes against the cumulative taken-id sets.
 * Mutates `taken` (adds new ids) and returns the rewritten arc + scenes.
 * All cross-references inside the payload are updated so the result is
 * internally consistent.
 *
 * IDs that reference entities ALREADY in the live narrative (i.e. not in
 * the scenario's `newCharacters`/etc. payload) pass through untouched —
 * those entities are shared across branches by design.
 */
export function remapScenarioCommit(
  arc: Arc,
  scenes: Scene[],
  taken: TakenIds,
): RemappedRun {
  const maps = makeMaps();

  // ── Phase 1 — RESERVE: walk every newly-introduced id and mint a
  // collision-free replacement, building up the maps.

  // Arc id (always considered "new" — generateScenes mints it from
  // narrative.arcs, so any collision is real).
  reserve(arc.id, 'ARC', taken.arc, maps.arc);

  // Scene ids.
  for (const s of scenes) reserve(s.id, 'S', taken.scene, maps.scene);

  // Newly-introduced entities (per-scene).
  for (const s of scenes) {
    for (const c of s.newCharacters ?? []) reserve(c.id, 'C', taken.char, maps.char);
    for (const l of s.newLocations ?? []) reserve(l.id, 'L', taken.loc, maps.loc);
    for (const a of s.newArtifacts ?? []) reserve(a.id, 'A', taken.art, maps.art);
    for (const t of s.newThreads ?? []) reserve(t.id, 'T', taken.thread, maps.thread);
    // World-graph nodes inside world deltas
    for (const d of s.worldDeltas ?? []) {
      for (const n of d.addedNodes ?? []) reserve(n.id, 'K', taken.k, maps.k);
    }
    // System-graph nodes
    if (s.systemDeltas) {
      for (const n of s.systemDeltas.addedNodes ?? []) reserve(n.id, 'SYS', taken.sys, maps.sys);
    }
  }

  // Walk new-entity world graphs to reserve their internal node ids. The
  // remapWorld helper handles the actual rewrite in Phase 2; we just
  // pre-reserve here so cross-entity edges (rare) resolve consistently.
  for (const s of scenes) {
    for (const c of s.newCharacters ?? []) {
      for (const nid of Object.keys(c.world?.nodes ?? {})) {
        if (!maps.k.has(nid)) reserve(nid, 'K', taken.k, maps.k);
      }
    }
    for (const l of s.newLocations ?? []) {
      for (const nid of Object.keys(l.world?.nodes ?? {})) {
        if (!maps.k.has(nid)) reserve(nid, 'K', taken.k, maps.k);
      }
    }
    for (const a of s.newArtifacts ?? []) {
      for (const nid of Object.keys(a.world?.nodes ?? {})) {
        if (!maps.k.has(nid)) reserve(nid, 'K', taken.k, maps.k);
      }
    }
  }

  // ── Phase 2 — REWRITE: apply the maps to every reference field.

  const newArcId = remap(arc.id, maps.arc);

  // Arc-level refs. Locations / characters / develops / etc. may
  // reference existing entities (not in maps) — those pass through.
  const rewrittenArc: Arc = {
    ...arc,
    id: newArcId,
    sceneIds: arc.sceneIds.map((sid) => remap(sid, maps.scene)),
    locationIds: arc.locationIds.map((lid) => remap(lid, maps.loc)),
    activeCharacterIds: arc.activeCharacterIds.map((cid) => remap(cid, maps.char)),
    initialCharacterLocations: Object.fromEntries(
      Object.entries(arc.initialCharacterLocations).map(([cid, lid]) => [
        remap(cid, maps.char),
        remap(lid, maps.loc),
      ]),
    ),
    develops: arc.develops.map((id) =>
      remapAny(id, maps.char, maps.loc, maps.art, maps.thread),
    ),
  };

  const rewrittenScenes: Scene[] = scenes.map((s) => {
    const rewrittenNewChars: Character[] = (s.newCharacters ?? []).map((c) => ({
      ...c,
      id: remap(c.id, maps.char),
      world: remapWorld(c.world ?? { nodes: {}, edges: [] }, maps.k, 'K', taken.k),
    }));
    const rewrittenNewLocs: Location[] = (s.newLocations ?? []).map((l) => ({
      ...l,
      id: remap(l.id, maps.loc),
      parentId: l.parentId ? remap(l.parentId, maps.loc) : l.parentId ?? null,
      tiedCharacterIds: (l.tiedCharacterIds ?? []).map((cid) => remap(cid, maps.char)),
      world: remapWorld(l.world ?? { nodes: {}, edges: [] }, maps.k, 'K', taken.k),
    }));
    const rewrittenNewArts: Artifact[] = (s.newArtifacts ?? []).map((a) => ({
      ...a,
      id: remap(a.id, maps.art),
      world: remapWorld(a.world ?? { nodes: {}, edges: [] }, maps.k, 'K', taken.k),
    }));
    const rewrittenNewThreads: Thread[] = (s.newThreads ?? []).map((t) => ({
      ...t,
      id: remap(t.id, maps.thread),
      participants: t.participants.map((p) => ({
        ...p,
        id: remapAny(p.id, maps.char, maps.loc, maps.art),
      })),
    }));

    return {
      ...s,
      id: remap(s.id, maps.scene),
      arcId: newArcId,
      povId: s.povId ? remap(s.povId, maps.char) : s.povId,
      locationId: remap(s.locationId, maps.loc),
      participantIds: s.participantIds.map((id) => remap(id, maps.char)),
      artifactUsages: (s.artifactUsages ?? []).map((au) => ({
        ...au,
        artifactId: remap(au.artifactId, maps.art),
        characterId: au.characterId ? remap(au.characterId, maps.char) : au.characterId,
      })),
      characterMovements: s.characterMovements
        ? Object.fromEntries(
            Object.entries(s.characterMovements).map(([cid, mv]) => [
              remap(cid, maps.char),
              { ...mv, locationId: remap(mv.locationId, maps.loc) },
            ]),
          )
        : s.characterMovements,
      relationshipDeltas: s.relationshipDeltas.map((rm) => ({
        ...rm,
        from: remap(rm.from, maps.char),
        to: remap(rm.to, maps.char),
      })),
      threadDeltas: s.threadDeltas.map((tm) => ({
        ...tm,
        threadId: remap(tm.threadId, maps.thread),
      })),
      worldDeltas: s.worldDeltas.map((d) =>
        remapWorldDelta(d, maps.k, (() => {
          // entityId points at a character / location / artifact — try
          // each map in turn. Build a unified map for this delta call.
          const u = new Map<string, string>();
          for (const [k, v] of maps.char) u.set(k, v);
          for (const [k, v] of maps.loc) u.set(k, v);
          for (const [k, v] of maps.art) u.set(k, v);
          return u;
        })()),
      ),
      systemDeltas: s.systemDeltas ? remapSystemDelta(s.systemDeltas, maps.sys) : s.systemDeltas,
      systemAttributions: (s.systemAttributions ?? []).map((id) => remap(id, maps.sys)),
      ownershipDeltas: (s.ownershipDeltas ?? []).map((om) => ({
        ...om,
        artifactId: remap(om.artifactId, maps.art),
        fromId: remapAny(om.fromId, maps.char, maps.loc),
        toId: remapAny(om.toId, maps.char, maps.loc),
      })),
      tieDeltas: (s.tieDeltas ?? []).map((td) => ({
        ...td,
        locationId: remap(td.locationId, maps.loc),
        characterId: remap(td.characterId, maps.char),
      })),
      newCharacters: rewrittenNewChars.length > 0 ? rewrittenNewChars : s.newCharacters,
      newLocations: rewrittenNewLocs.length > 0 ? rewrittenNewLocs : s.newLocations,
      newArtifacts: rewrittenNewArts.length > 0 ? rewrittenNewArts : s.newArtifacts,
      newThreads: rewrittenNewThreads.length > 0 ? rewrittenNewThreads : s.newThreads,
    };
  });

  return { arc: rewrittenArc, scenes: rewrittenScenes };
}
