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

import type { Scene, WorldExpansion } from "@/types/narrative";

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
 * Merge LLM-emitted attributions with the derived baseline. Preserves the
 * LLM's order at the head (its emphasis tells us which ids it considered
 * most load-bearing) and appends derived-only ids after.
 */
export function ensureSceneAttributions(scene: Scene): void {
  const seen = new Set<string>(scene.attributions ?? []);
  const merged = [...(scene.attributions ?? [])];
  for (const id of deriveSceneAttributions(scene)) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  if (merged.length > 0) scene.attributions = merged;
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
}
