/**
 * file-conversion — world-scoped helpers for adding a source file to a
 * narrative and (optionally) kicking off its conversion.
 *
 * Files walk: staged → converting → ready → committed. This module
 * owns the staged + converting transitions. The "Apply to current
 * branch" step (ready → committed) lives separately.
 *
 * Extension jobs ride on the same `AnalysisRunner` as creation jobs but
 * are tagged `kind: 'extend'` with `targetNarrativeId` + `fileId`. The
 * runner removes them from state.analysisJobs once complete so they
 * never bleed into the global /analysis page; the SourceFile is the
 * durable record afterwards.
 */

import { assetManager } from '@/lib/asset-manager';
import { splitCorpusIntoScenes } from '@/lib/text-analysis';
import { analysisRunner } from '@/lib/analysis-runner';
import type { AnalysisJob, NarrativeState, SourceFile } from '@/types/narrative';
import type { Action } from '@/lib/store';

type Dispatch = (action: Action) => void;

/** Three-letter prefix from a title (same convention as id-space in
 *  text-analysis). Falls back to "TXT" when the title has no letters. */
function titlePrefix(title: string): string {
  return title.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'TXT';
}

/** Returns the smallest unused integer suffix for a given prefix in the
 *  narrative's existing file ids. So if F-HP-1 and F-HP-3 exist, this
 *  returns 4 (we always append; no gap reuse). */
function nextFileNumber(narrative: NarrativeState, prefix: string): number {
  const ids = Object.keys(narrative.files ?? {});
  let max = 0;
  const re = new RegExp(`^F-${prefix}-(\\d+)$`);
  for (const id of ids) {
    const m = id.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/** Stage a new file on the narrative. Stores the raw text in IDB and
 *  dispatches ADD_SOURCE_FILE. Returns the staged SourceFile so the
 *  caller can immediately kick off conversion if desired. */
export async function stageFile(
  narrative: NarrativeState,
  name: string,
  content: string,
  dispatch: Dispatch,
): Promise<SourceFile> {
  const prefix = titlePrefix(narrative.title || name);
  const num = nextFileNumber(narrative, prefix);
  const contentRef = await assetManager.storeText(content, undefined, narrative.id);
  const file: SourceFile = {
    id: `F-${prefix}-${num}`,
    name: name.trim() || `File ${num}`,
    mode: 'extend',
    contentRef,
    charCount: content.length,
    wordCount: content.trim().split(/\s+/).filter(Boolean).length,
    createdAt: Date.now(),
    status: 'staged',
  };
  dispatch({ type: 'ADD_SOURCE_FILE', narrativeId: narrative.id, file });
  return file;
}

/** Options that mirror the /analysis NewJobSetup form. Both are
 *  preserved on the AnalysisJob so resume / retry sees the same shape. */
export type ConvertFileOptions = {
  /** 'full' = world commits + scenes + arcs (default).
   *  'world' = per-batch world commits only — knowledge injection without
   *  adding new scenes to a branch. */
  extractionMode?: 'world' | 'full';
  /** When true, the runner skips Phase 2 (beat plans + embeddings).
   *  Beat plans drive semantic search; skipping is faster but the slice's
   *  new scenes won't be searchable until plans are generated later. */
  skipPlanExtraction?: boolean;
};

/** Kick off the conversion pipeline for a staged or failed file.
 *  Constructs an `AnalysisJob` tagged with kind='extend' so the runner
 *  routes the result back onto the SourceFile instead of creating a new
 *  narrative, flips the file to status='converting', and starts the run.
 *  Returns the job id for callers that want to subscribe to progress. */
export async function convertFile(
  narrative: NarrativeState,
  file: SourceFile,
  dispatch: Dispatch,
  options: ConvertFileOptions = {},
): Promise<string | null> {
  const content = await assetManager.getText(file.contentRef);
  if (!content) {
    dispatch({
      type: 'UPDATE_SOURCE_FILE',
      narrativeId: narrative.id,
      fileId: file.id,
      updates: { status: 'failed', error: 'Source text missing from local storage.' },
    });
    return null;
  }

  const scenes = splitCorpusIntoScenes(content);
  const chunks = scenes.map((s) => ({
    index: s.index,
    text: s.prose,
    sectionCount: Math.ceil(s.wordCount / 100),
  }));

  const extractionMode = options.extractionMode ?? 'full';
  // Plans only make sense in 'full' mode (world-only drops scenes).
  // Force skip on world-only regardless of the caller's preference so
  // the runner doesn't waste an LLM phase on doomed scenes.
  const skipPlanExtraction = extractionMode === 'world' || options.skipPlanExtraction === true;

  const jobId = `AJX-${Date.now().toString(36)}`;
  const job: AnalysisJob = {
    id: jobId,
    title: file.name,
    sourceText: content,
    chunks,
    results: new Array(chunks.length).fill(null),
    status: 'running',
    phase: 'structure',
    currentChunkIndex: 0,
    kind: 'extend',
    targetNarrativeId: narrative.id,
    fileId: file.id,
    // Only stamp the override when non-default — keeps job shape minimal
    // and matches NewJobSetup's spread pattern on /analysis.
    ...(extractionMode === 'world' && { extractionMode: 'world' as const }),
    ...(skipPlanExtraction && { skipPlanExtraction: true }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  dispatch({ type: 'ADD_ANALYSIS_JOB', job });
  dispatch({
    type: 'UPDATE_SOURCE_FILE',
    narrativeId: narrative.id,
    fileId: file.id,
    updates: { status: 'converting', analysisJobId: jobId, error: undefined },
  });

  // Fire-and-forget. Errors propagate via the runner's job/file updates.
  analysisRunner.start(job, dispatch).catch(() => { /* runner has its own error handling */ });

  return jobId;
}

// ── Apply ────────────────────────────────────────────────────────────────────
//
// Applies a `ready` SourceFile's extracted slice to the target narrative.
// Walks the slice (a NarrativeState produced by the extension pipeline) and
// remaps every id into the target's namespace, deduplicating named entities
// (characters / locations / artifacts / threads) against existing records.
// The result is dispatched as a single APPLY_EXTENSION action that mutates
// the target atomically and appends the new entries to the chosen branch's
// `entryIds`.

/** Lowercased + trimmed name key used for dedup. */
function normalizeName(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/** Mint a fresh `<prefix>-<n>` id not in `taken`. Matches the canonical
 *  unpadded form used by the analysis pipeline. */
function mintFreshId(prefix: string, taken: Set<string>): string {
  let n = 1;
  while (true) {
    const candidate = `${prefix}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
    n++;
  }
}

/** Mint a fresh world-graph node id ("K-<n>") not in `taken`. */
function mintFreshK(taken: Set<string>): string {
  return mintFreshId('K', taken);
}

type RemapMaps = {
  char: Map<string, string>;
  loc: Map<string, string>;
  art: Map<string, string>;
  thread: Map<string, string>;
  scene: Map<string, string>;
  worldBuild: Map<string, string>;
  arc: Map<string, string>;
  /** World-graph node ids (the "K-…" namespace) — kept globally rather
   *  than per-entity since the canonical analysis pipeline allocates from
   *  one pool. */
  k: Map<string, string>;
  /** System-graph node ids (SYS-…). */
  sys: Map<string, string>;
};

type TakenSets = {
  char: Set<string>;
  loc: Set<string>;
  art: Set<string>;
  thread: Set<string>;
  scene: Set<string>;
  worldBuild: Set<string>;
  arc: Set<string>;
  k: Set<string>;
  sys: Set<string>;
};

function buildTaken(n: NarrativeState): TakenSets {
  const charK: string[] = [];
  for (const c of Object.values(n.characters)) charK.push(...Object.keys(c.world?.nodes ?? {}));
  for (const l of Object.values(n.locations)) charK.push(...Object.keys(l.world?.nodes ?? {}));
  for (const a of Object.values(n.artifacts ?? {})) charK.push(...Object.keys(a.world?.nodes ?? {}));
  return {
    char: new Set(Object.keys(n.characters)),
    loc: new Set(Object.keys(n.locations)),
    art: new Set(Object.keys(n.artifacts ?? {})),
    thread: new Set(Object.keys(n.threads)),
    scene: new Set(Object.keys(n.scenes)),
    worldBuild: new Set(Object.keys(n.worldBuilds ?? {})),
    arc: new Set(Object.keys(n.arcs)),
    k: new Set(charK),
    sys: new Set(Object.keys(n.systemGraph?.nodes ?? {})),
  };
}

const PREFIX = {
  char: 'C',
  loc: 'L',
  art: 'A',
  thread: 'T',
  scene: 'S',
  worldBuild: 'WB',
  arc: 'ARC',
  k: 'K',
  sys: 'SYS',
} as const;

function remap(id: string | undefined, map: Map<string, string>): string {
  if (!id) return id ?? '';
  return map.get(id) ?? id;
}

function remapAny(id: string | undefined, ...maps: Map<string, string>[]): string {
  if (!id) return id ?? '';
  for (const m of maps) if (m.has(id)) return m.get(id)!;
  return id;
}

/** Walk a slice's world graph (entity inner graph) and remap node ids
 *  through the global `k` map, minting fresh ids for any nodes the map
 *  doesn't yet cover (the slice's own internal node id namespace). */
type WorldGraphLike = {
  nodes: Record<string, { id: string; content: string; type: string }>;
  edges: { from: string; to: string; relation: string }[];
};
function remapWorldGraph(
  world: WorldGraphLike | undefined,
  maps: RemapMaps,
  taken: TakenSets,
): WorldGraphLike {
  if (!world) return { nodes: {}, edges: [] };
  for (const oldId of Object.keys(world.nodes)) {
    if (!maps.k.has(oldId)) {
      const fresh = taken.k.has(oldId) ? mintFreshK(taken.k) : (taken.k.add(oldId), oldId);
      maps.k.set(oldId, fresh);
    }
  }
  const nodes: Record<string, { id: string; content: string; type: string }> = {};
  for (const [oldId, node] of Object.entries(world.nodes)) {
    const newId = maps.k.get(oldId) ?? oldId;
    nodes[newId] = { ...node, id: newId };
  }
  const edges = world.edges.map((e) => ({
    from: maps.k.get(e.from) ?? e.from,
    to: maps.k.get(e.to) ?? e.to,
    relation: e.relation,
  }));
  return { nodes, edges };
}

export type ApplyResult = {
  /** New entity ids added to the target — used for the SourceFile commit
   *  record so the user can audit what landed. */
  introducedSceneIds: string[];
  introducedArcId: string | null;
};

/** Apply a `ready` file's extracted slice to the given branch on the
 *  target narrative. Returns the commit record (arc + scene ids) so the
 *  caller can stamp the SourceFile.
 *
 *  Dedup strategy: characters / locations / artifacts dedup by lowercased
 *  name; threads dedup by lowercased description. When a slice entity
 *  matches an existing one by name, its id is rewritten to the existing
 *  id and the entity record itself is dropped (the existing record is
 *  authoritative). Genuinely new entities mint a fresh id under the
 *  target's namespace if their proposed id collides.
 *
 *  Branch append: every entry id in the slice's root branch lands at the
 *  tail of the chosen branch's entryIds, in slice order. */
export async function applyExtensionToBranch(
  narrative: NarrativeState,
  file: SourceFile,
  branchId: string,
  dispatch: Dispatch,
): Promise<ApplyResult> {
  if (!file.extractedRef) {
    throw new Error('No extracted slice on this file — convert it first.');
  }
  const sliceJson = await assetManager.getText(file.extractedRef);
  if (!sliceJson) {
    throw new Error('Extracted slice is missing from local storage.');
  }
  const slice = JSON.parse(sliceJson) as NarrativeState;

  // ── Build dedup indexes against the target's existing entities ────────
  const charByName = new Map<string, string>();
  for (const c of Object.values(narrative.characters)) charByName.set(normalizeName(c.name), c.id);
  const locByName = new Map<string, string>();
  for (const l of Object.values(narrative.locations)) locByName.set(normalizeName(l.name), l.id);
  const artByName = new Map<string, string>();
  for (const a of Object.values(narrative.artifacts ?? {})) artByName.set(normalizeName(a.name), a.id);
  const threadByDesc = new Map<string, string>();
  for (const t of Object.values(narrative.threads)) threadByDesc.set(normalizeName(t.description), t.id);

  // ── Init id maps + taken sets ────────────────────────────────────────
  const taken = buildTaken(narrative);
  const maps: RemapMaps = {
    char: new Map(),
    loc: new Map(),
    art: new Map(),
    thread: new Map(),
    scene: new Map(),
    worldBuild: new Map(),
    arc: new Map(),
    k: new Map(),
    sys: new Map(),
  };

  // Helper: claim an id either by matching name to existing or minting fresh.
  // Returns whether the entity is "fresh" (caller should add to target).
  function claim(
    sliceId: string,
    name: string | undefined,
    nameIndex: Map<string, string>,
    kind: 'char' | 'loc' | 'art' | 'thread',
  ): { id: string; fresh: boolean } {
    const key = normalizeName(name);
    const existing = key ? nameIndex.get(key) : undefined;
    if (existing) {
      maps[kind].set(sliceId, existing);
      return { id: existing, fresh: false };
    }
    // Genuinely new — keep the slice id if it doesn't collide, else mint.
    const set = taken[kind];
    const id = set.has(sliceId) ? mintFreshId(PREFIX[kind], set) : (set.add(sliceId), sliceId);
    maps[kind].set(sliceId, id);
    return { id, fresh: true };
  }

  // ── Phase 1: claim ids for slice entities (dedup-aware) ──────────────
  type Pending<T> = { entity: T; targetId: string };
  const newCharacters: Pending<import('@/types/narrative').Character>[] = [];
  const newLocations: Pending<import('@/types/narrative').Location>[] = [];
  const newArtifacts: Pending<import('@/types/narrative').Artifact>[] = [];
  const newThreads: Pending<import('@/types/narrative').Thread>[] = [];

  for (const c of Object.values(slice.characters)) {
    const { id, fresh } = claim(c.id, c.name, charByName, 'char');
    if (fresh) newCharacters.push({ entity: c, targetId: id });
  }
  for (const l of Object.values(slice.locations)) {
    const { id, fresh } = claim(l.id, l.name, locByName, 'loc');
    if (fresh) newLocations.push({ entity: l, targetId: id });
  }
  for (const a of Object.values(slice.artifacts ?? {})) {
    const { id, fresh } = claim(a.id, a.name, artByName, 'art');
    if (fresh) newArtifacts.push({ entity: a, targetId: id });
  }
  for (const t of Object.values(slice.threads)) {
    const { id, fresh } = claim(t.id, t.description, threadByDesc, 'thread');
    if (fresh) newThreads.push({ entity: t, targetId: id });
  }

  // Scenes, worldBuilds, arcs — always treated as new (slice-scoped),
  // collision-renamed only.
  for (const id of Object.keys(slice.scenes)) {
    const next = taken.scene.has(id) ? mintFreshId(PREFIX.scene, taken.scene) : (taken.scene.add(id), id);
    maps.scene.set(id, next);
  }
  for (const id of Object.keys(slice.worldBuilds ?? {})) {
    const next = taken.worldBuild.has(id) ? mintFreshId(PREFIX.worldBuild, taken.worldBuild) : (taken.worldBuild.add(id), id);
    maps.worldBuild.set(id, next);
  }
  for (const id of Object.keys(slice.arcs)) {
    const next = taken.arc.has(id) ? mintFreshId(PREFIX.arc, taken.arc) : (taken.arc.add(id), id);
    maps.arc.set(id, next);
  }
  // System graph nodes — collision-rename.
  for (const id of Object.keys(slice.systemGraph?.nodes ?? {})) {
    const next = taken.sys.has(id) ? mintFreshId(PREFIX.sys, taken.sys) : (taken.sys.add(id), id);
    maps.sys.set(id, next);
  }

  // ── Phase 2: rewrite scenes, worldBuilds, arcs, and new entities ─────

  const rewrittenCharacters = newCharacters.map(({ entity: c, targetId }) => ({
    ...c,
    id: targetId,
    threadIds: (c.threadIds ?? []).map((tid) => remap(tid, maps.thread)),
    world: remapWorldGraph(c.world as WorldGraphLike | undefined, maps, taken),
  }));
  const rewrittenLocations = newLocations.map(({ entity: l, targetId }) => ({
    ...l,
    id: targetId,
    parentId: l.parentId ? remap(l.parentId, maps.loc) : l.parentId ?? null,
    tiedCharacterIds: (l.tiedCharacterIds ?? []).map((cid) => remap(cid, maps.char)),
    threadIds: (l.threadIds ?? []).map((tid) => remap(tid, maps.thread)),
    world: remapWorldGraph(l.world as WorldGraphLike | undefined, maps, taken),
  }));
  const rewrittenArtifacts = newArtifacts.map(({ entity: a, targetId }) => ({
    ...a,
    id: targetId,
    parentId: a.parentId ? remapAny(a.parentId, maps.char, maps.loc) : a.parentId,
    threadIds: (a.threadIds ?? []).map((tid) => remap(tid, maps.thread)),
    world: remapWorldGraph(a.world as WorldGraphLike | undefined, maps, taken),
  }));
  const rewrittenThreads = newThreads.map(({ entity: t, targetId }) => ({
    ...t,
    id: targetId,
    participants: t.participants.map((p) => ({
      ...p,
      id: remapAny(p.id, maps.char, maps.loc, maps.art),
    })),
  }));

  // Scenes — full rewrite of every cross-ref.
  const sliceScenes = Object.values(slice.scenes);
  const rewrittenScenes = sliceScenes.map((s) => {
    const newId = remap(s.id, maps.scene);
    // New-entity sub-arrays embedded in scenes — drop entries that dedup'd
    // into an existing entity (their world graph is already on the target).
    const sceneNewChars = (s.newCharacters ?? []).filter((c) => {
      const key = normalizeName(c.name);
      return !(key && charByName.has(key));
    }).map((c) => ({
      ...c,
      id: remap(c.id, maps.char),
      threadIds: (c.threadIds ?? []).map((tid) => remap(tid, maps.thread)),
      world: remapWorldGraph(c.world as WorldGraphLike | undefined, maps, taken),
    }));
    const sceneNewLocs = (s.newLocations ?? []).filter((l) => {
      const key = normalizeName(l.name);
      return !(key && locByName.has(key));
    }).map((l) => ({
      ...l,
      id: remap(l.id, maps.loc),
      parentId: l.parentId ? remap(l.parentId, maps.loc) : l.parentId ?? null,
      tiedCharacterIds: (l.tiedCharacterIds ?? []).map((cid) => remap(cid, maps.char)),
      threadIds: (l.threadIds ?? []).map((tid) => remap(tid, maps.thread)),
      world: remapWorldGraph(l.world as WorldGraphLike | undefined, maps, taken),
    }));
    const sceneNewArts = (s.newArtifacts ?? []).filter((a) => {
      const key = normalizeName(a.name);
      return !(key && artByName.has(key));
    }).map((a) => ({
      ...a,
      id: remap(a.id, maps.art),
      parentId: a.parentId ? remapAny(a.parentId, maps.char, maps.loc) : a.parentId,
      threadIds: (a.threadIds ?? []).map((tid) => remap(tid, maps.thread)),
      world: remapWorldGraph(a.world as WorldGraphLike | undefined, maps, taken),
    }));
    const sceneNewThreads = (s.newThreads ?? []).filter((t) => {
      const key = normalizeName(t.description);
      return !(key && threadByDesc.has(key));
    }).map((t) => ({
      ...t,
      id: remap(t.id, maps.thread),
      participants: t.participants.map((p) => ({
        ...p,
        id: remapAny(p.id, maps.char, maps.loc, maps.art),
      })),
    }));

    return {
      ...s,
      id: newId,
      arcId: remap(s.arcId, maps.arc),
      povId: s.povId ? remap(s.povId, maps.char) : s.povId,
      locationId: remap(s.locationId, maps.loc),
      participantIds: s.participantIds.map((id) => remap(id, maps.char)),
      newCharacters: sceneNewChars,
      newLocations: sceneNewLocs,
      newArtifacts: sceneNewArts,
      newThreads: sceneNewThreads,
      threadDeltas: s.threadDeltas.map((tm) => ({
        ...tm,
        threadId: remap(tm.threadId, maps.thread),
      })),
      worldDeltas: s.worldDeltas.map((d) => ({
        ...d,
        entityId: remapAny(d.entityId, maps.char, maps.loc, maps.art),
        addedNodes: (d.addedNodes ?? []).map((n) => {
          if (!maps.k.has(n.id)) {
            const fresh = taken.k.has(n.id) ? mintFreshK(taken.k) : (taken.k.add(n.id), n.id);
            maps.k.set(n.id, fresh);
          }
          return { ...n, id: maps.k.get(n.id) ?? n.id };
        }),
      })),
      relationshipDeltas: s.relationshipDeltas.map((rm) => ({
        ...rm,
        from: remap(rm.from, maps.char),
        to: remap(rm.to, maps.char),
      })),
      artifactUsages: (s.artifactUsages ?? []).map((au) => ({
        ...au,
        artifactId: remap(au.artifactId, maps.art),
        characterId: au.characterId ? remap(au.characterId, maps.char) : au.characterId,
      })),
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
      characterMovements: s.characterMovements
        ? Object.fromEntries(
            Object.entries(s.characterMovements).map(([cid, mv]) => [
              remap(cid, maps.char),
              { ...mv, locationId: remap(mv.locationId, maps.loc) },
            ]),
          )
        : s.characterMovements,
      attributions: (s.attributions ?? []).map((id) =>
        remapAny(id, maps.char, maps.loc, maps.art, maps.thread, maps.sys),
      ),
      attributionEdges: (s.attributionEdges ?? []).map((e) => ({
        from: remapAny(e.from, maps.char, maps.loc, maps.art, maps.thread, maps.sys),
        to: remapAny(e.to, maps.char, maps.loc, maps.art, maps.thread, maps.sys),
        relation: e.relation,
      })),
      systemDeltas: s.systemDeltas
        ? {
            ...s.systemDeltas,
            addedNodes: (s.systemDeltas.addedNodes ?? []).map((n) => ({
              ...n,
              id: maps.sys.get(n.id) ?? n.id,
            })),
            addedEdges: (s.systemDeltas.addedEdges ?? []).map((e) => ({
              ...e,
              from: maps.sys.get(e.from) ?? e.from,
              to: maps.sys.get(e.to) ?? e.to,
            })),
          }
        : s.systemDeltas,
    };
  });

  // Arcs — id + sceneIds + locationIds + activeCharacterIds + develops.
  const sliceArcs = Object.values(slice.arcs);
  const rewrittenArcs = sliceArcs.map((a) => ({
    ...a,
    id: remap(a.id, maps.arc),
    sceneIds: a.sceneIds.map((sid) => remap(sid, maps.scene)),
    locationIds: a.locationIds.map((lid) => remap(lid, maps.loc)),
    activeCharacterIds: a.activeCharacterIds.map((cid) => remap(cid, maps.char)),
    initialCharacterLocations: Object.fromEntries(
      Object.entries(a.initialCharacterLocations ?? {}).map(([cid, lid]) => [
        remap(cid, maps.char),
        remap(lid, maps.loc),
      ]),
    ),
    develops: (a.develops ?? []).map((id) =>
      remapAny(id, maps.char, maps.loc, maps.art, maps.thread),
    ),
  }));

  // WorldBuilds — id-level only for v1. The expansionManifest is
  // snapshot data; cross-ids inside it stay stable post-remap.
  const sliceWorldBuilds = Object.values(slice.worldBuilds ?? {});
  const rewrittenWorldBuilds = sliceWorldBuilds.map((wb) => ({
    ...wb,
    id: remap(wb.id, maps.worldBuild),
  }));

  // Slice's root-branch entry order — gives us the append sequence.
  const sliceRootBranch = Object.values(slice.branches).find((b) => b.parentBranchId === null);
  const appendEntryIds = (sliceRootBranch?.entryIds ?? []).map((eid) =>
    remapAny(eid, maps.scene, maps.worldBuild),
  );

  // ── Dispatch the atomic merge ────────────────────────────────────────
  dispatch({
    type: 'APPLY_EXTENSION',
    narrativeId: narrative.id,
    branchId,
    fileId: file.id,
    characters: rewrittenCharacters as import('@/types/narrative').Character[],
    locations: rewrittenLocations as import('@/types/narrative').Location[],
    artifacts: rewrittenArtifacts as import('@/types/narrative').Artifact[],
    threads: rewrittenThreads as import('@/types/narrative').Thread[],
    scenes: rewrittenScenes as import('@/types/narrative').Scene[],
    worldBuilds: rewrittenWorldBuilds as import('@/types/narrative').WorldBuild[],
    arcs: rewrittenArcs as import('@/types/narrative').Arc[],
    appendEntryIds,
  });

  const arcId = rewrittenArcs[0]?.id ?? null;
  const sceneIds = rewrittenScenes.map((s) => s.id);

  // Stamp the file as committed.
  dispatch({
    type: 'UPDATE_SOURCE_FILE',
    narrativeId: narrative.id,
    fileId: file.id,
    updates: {
      status: 'committed',
      commit: {
        branchId,
        arcId: arcId ?? '',
        sceneIds,
        committedAt: Date.now(),
      },
    },
  });

  return { introducedSceneIds: sceneIds, introducedArcId: arcId };
}
