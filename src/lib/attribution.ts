/**
 * Attribution derivation — defensive helper that walks a scene's (or
 * world-build's) typed structural fields and lifts the load-bearing ids out
 * as a unified attribution set. The LLM is asked to emit `attributions` and
 * `attributionEdges` explicitly; this helper guarantees a minimum baseline
 * even when the LLM is sparse or omits them entirely.
 *
 * Network graph correctness depends on every scene contributing the ids its
 * own deltas already touch. Without this fallback, a scene that the LLM
 * leaves blank shows up as zero attributions and the network goes cold —
 * which is misleading: those participants and threads ARE being engaged.
 *
 * Run AFTER ID remapping (so the ids here are the real ids, not GEN
 * placeholders) and AFTER the LLM-emitted `scene.attributions` has been
 * sanitised. The helper merges its derived set INTO the existing list,
 * deduplicating.
 */

import type {
  AttributionEdge,
  AttributionEdgeRelation,
  Scene,
  WorldExpansion,
} from "@/types/narrative";

/** Map the old systemDeltas edge vocabulary onto the CRG/attribution one. */
function mapSysRelation(rel: string): AttributionEdgeRelation {
  switch (rel) {
    case "enables": return "enables";
    case "governs": return "constrains";
    case "opposes": return "constrains";
    case "extends": return "develops";
    case "created_by": return "causes";
    case "constrains": return "constrains";
    case "exist_within": return "requires";
    default: return "develops";
  }
}

/**
 * Lift every load-bearing existing id out of a scene's structural fields.
 * Returns the union of:
 *   - povId, participantIds, locationId
 *   - threadDeltas → threadId
 *   - worldDeltas → entityId
 *   - relationshipDeltas → from + to
 *   - artifactUsages → artifactId + characterId
 *   - ownershipDeltas → artifactId + fromId + toId
 *   - tieDeltas → locationId + characterId
 *   - characterMovements → characterId + locationId
 *
 * Newly-introduced ids (from newCharacters/newLocations/newArtifacts/newThreads
 * and systemDeltas.addedNodes) are NOT included here — they earn attribution
 * automatically downstream via the introduction. Same rule the LLM is given.
 * SYS- ids referenced via systemDeltas.addedEdges are included so existing
 * system rules invoked by the scene contribute heat.
 */
export function deriveSceneAttributions(scene: Scene): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  if (scene.povId) add(scene.povId);
  for (const pid of scene.participantIds ?? []) add(pid);
  if (scene.locationId) add(scene.locationId);

  for (const tm of scene.threadDeltas ?? []) add(tm.threadId);
  for (const wd of scene.worldDeltas ?? []) add(wd.entityId);
  for (const rm of scene.relationshipDeltas ?? []) {
    add(rm.from);
    add(rm.to);
  }
  for (const au of scene.artifactUsages ?? []) {
    add(au.artifactId);
    add(au.characterId);
  }
  for (const om of scene.ownershipDeltas ?? []) {
    add(om.artifactId);
    add(om.fromId);
    add(om.toId);
  }
  for (const td of scene.tieDeltas ?? []) {
    add(td.locationId);
    add(td.characterId);
  }
  for (const [charId, mv] of Object.entries(scene.characterMovements ?? {})) {
    add(charId);
    add(mv.locationId);
  }

  // Existing system rules the scene leans on through edges in its systemDeltas
  // (the addedNodes are new and credited at introduction; the edge endpoints
  // that point at existing SYS-N ids are the structural references).
  const introducedSysIds = new Set(
    (scene.systemDeltas?.addedNodes ?? []).map((n) => n.id),
  );
  for (const e of scene.systemDeltas?.addedEdges ?? []) {
    if (e.from && !introducedSysIds.has(e.from)) add(e.from);
    if (e.to && !introducedSysIds.has(e.to)) add(e.to);
  }

  // Filter out any newly-introduced ids that snuck in via the typed fields
  // (e.g. participantIds referencing a same-scene newCharacter). New ids get
  // attribution at introduction; double-counting them inflates heat.
  const newIds = new Set<string>([
    ...(scene.newCharacters ?? []).map((c) => c.id),
    ...(scene.newLocations ?? []).map((l) => l.id),
    ...(scene.newArtifacts ?? []).map((a) => a.id),
    ...(scene.newThreads ?? []).map((t) => t.id),
  ]);
  return out.filter((id) => !newIds.has(id));
}

/**
 * Cross-kind attribution edges lifted from a scene's typed delta fields.
 * Same purpose as deriveSceneAttributions but for connections. The CRG
 * relation vocabulary is mapped from delta semantics:
 *   - relationshipDeltas (char↔char)         → develops
 *   - artifactUsages (char↔artifact)         → requires
 *   - ownershipDeltas (artifact transfer)    → causes (new owner) +
 *                                              supersedes (prior owner)
 *   - tieDeltas (char↔location)              → develops
 *   - characterMovements (char↔destination)  → develops
 *   - threadDeltas + povId / locationId      → develops
 *   - systemDeltas.addedEdges (sys↔sys)      → mapped via mapSysRelation
 *
 * Network aggregation collapses direction and dedups within step, so the
 * exact direction picked here only matters for scene-scope rendering where
 * the relation label is shown. Picked to read sensibly in that context.
 */
export function deriveSceneAttributionEdges(scene: Scene): AttributionEdge[] {
  const out: AttributionEdge[] = [];
  const push = (from: string | null | undefined, to: string | null | undefined, relation: AttributionEdgeRelation) => {
    if (!from || !to || from === to) return;
    out.push({ from, to, relation });
  };

  for (const rm of scene.relationshipDeltas ?? []) {
    push(rm.from, rm.to, "develops");
  }
  for (const au of scene.artifactUsages ?? []) {
    push(au.characterId, au.artifactId, "requires");
  }
  for (const om of scene.ownershipDeltas ?? []) {
    push(om.toId, om.artifactId, "causes");
    push(om.fromId, om.artifactId, "supersedes");
  }
  for (const td of scene.tieDeltas ?? []) {
    push(td.characterId, td.locationId, "develops");
  }
  for (const [charId, mv] of Object.entries(scene.characterMovements ?? {})) {
    push(charId, mv.locationId, "develops");
  }
  // Threads engaged in this scene wire to its POV and to its location, so the
  // network surfaces "where is this thread playing out" and "who is carrying it".
  for (const tm of scene.threadDeltas ?? []) {
    push(scene.povId, tm.threadId, "develops");
    push(tm.threadId, scene.locationId, "develops");
  }
  for (const se of scene.systemDeltas?.addedEdges ?? []) {
    push(se.from, se.to, mapSysRelation(se.relation));
  }
  return out;
}

/** Edge version of deriveSceneAttributions for world expansions. World builds
 *  have no POV / locationId / artifactUsages / characterMovements, so the
 *  surface is narrower. */
export function deriveExpansionAttributionEdges(expansion: WorldExpansion): AttributionEdge[] {
  const out: AttributionEdge[] = [];
  const push = (from: string | null | undefined, to: string | null | undefined, relation: AttributionEdgeRelation) => {
    if (!from || !to || from === to) return;
    out.push({ from, to, relation });
  };

  for (const rm of expansion.relationshipDeltas ?? []) {
    push(rm.from, rm.to, "develops");
  }
  for (const om of expansion.ownershipDeltas ?? []) {
    push(om.toId, om.artifactId, "causes");
    push(om.fromId, om.artifactId, "supersedes");
  }
  for (const td of expansion.tieDeltas ?? []) {
    push(td.characterId, td.locationId, "develops");
  }
  for (const se of expansion.systemDeltas?.addedEdges ?? []) {
    push(se.from, se.to, mapSysRelation(se.relation));
  }
  return out;
}

/**
 * Merge LLM-emitted attributions + attributionEdges with the derived
 * baselines. Preserves the LLM's order at the head (its emphasis tells us
 * which ids it considered most load-bearing); appends derived-only entries
 * after. Edges dedupe by (min(from,to) | max(from,to)) so direction doesn't
 * matter for collision detection — this matches the network aggregator.
 */
export function ensureSceneAttributions(scene: Scene): void {
  const seen = new Set<string>(scene.attributions ?? []);
  const mergedIds = [...(scene.attributions ?? [])];
  for (const id of deriveSceneAttributions(scene)) {
    if (seen.has(id)) continue;
    seen.add(id);
    mergedIds.push(id);
  }
  if (mergedIds.length > 0) scene.attributions = mergedIds;

  const edgeKey = (e: { from: string; to: string }) =>
    e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;
  const seenEdges = new Set<string>((scene.attributionEdges ?? []).map(edgeKey));
  const mergedEdges = [...(scene.attributionEdges ?? [])];
  for (const e of deriveSceneAttributionEdges(scene)) {
    const k = edgeKey(e);
    if (seenEdges.has(k)) continue;
    seenEdges.add(k);
    mergedEdges.push(e);
  }
  if (mergedEdges.length > 0) scene.attributionEdges = mergedEdges;
}

/**
 * Same shape for a WorldExpansion — pull existing ids the expansion touches
 * out of its typed delta fields and merge with whatever attributions the
 * source already declared. World expansions don't have povId / participants /
 * locationId, so the surface is narrower than scenes.
 */
export function ensureExpansionAttributions(expansion: WorldExpansion): void {
  const seen = new Set<string>(expansion.attributions ?? []);
  const merged = [...(expansion.attributions ?? [])];
  const add = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    merged.push(id);
  };

  for (const tm of expansion.threadDeltas ?? []) add(tm.threadId);
  for (const wd of expansion.worldDeltas ?? []) add(wd.entityId);
  for (const rm of expansion.relationshipDeltas ?? []) {
    add(rm.from);
    add(rm.to);
  }
  for (const om of expansion.ownershipDeltas ?? []) {
    add(om.artifactId);
    add(om.fromId);
    add(om.toId);
  }
  for (const td of expansion.tieDeltas ?? []) {
    add(td.locationId);
    add(td.characterId);
  }

  // Existing SYS endpoints referenced by addedEdges (not newly introduced).
  const introducedSysIds = new Set(
    (expansion.systemDeltas?.addedNodes ?? []).map((n) => n.id),
  );
  for (const e of expansion.systemDeltas?.addedEdges ?? []) {
    if (e.from && !introducedSysIds.has(e.from)) add(e.from);
    if (e.to && !introducedSysIds.has(e.to)) add(e.to);
  }

  // Strip ids the expansion is itself introducing — they credit at intro.
  const newIds = new Set<string>([
    ...expansion.newCharacters.map((c) => c.id),
    ...expansion.newLocations.map((l) => l.id),
    ...(expansion.newArtifacts ?? []).map((a) => a.id),
    ...expansion.newThreads.map((t) => t.id),
  ]);
  const final = merged.filter((id) => !newIds.has(id));
  if (final.length > 0) expansion.attributions = final;

  // Same merge for edges.
  const edgeKey = (e: { from: string; to: string }) =>
    e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;
  const seenEdges = new Set<string>((expansion.attributionEdges ?? []).map(edgeKey));
  const mergedEdges = [...(expansion.attributionEdges ?? [])];
  for (const e of deriveExpansionAttributionEdges(expansion)) {
    const k = edgeKey(e);
    if (seenEdges.has(k)) continue;
    seenEdges.add(k);
    mergedEdges.push(e);
  }
  if (mergedEdges.length > 0) expansion.attributionEdges = mergedEdges;
}
