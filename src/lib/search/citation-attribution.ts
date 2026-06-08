/**
 * Citation → scene attribution.
 *
 * Both search modes answer in academic prose with chat-style entity-ref
 * citations (`Aragorn [C-1]`, `the parley [S-12]`). Vector mode also carries a
 * similarity-weighted activation timeline; context mode has no similarities.
 * To give context mode the SAME scene-origin UI (timeline + "where did this
 * come from"), we derive a per-scene relevance curve from the entities the
 * answer actually cited: a scene scores by how many distinct cited entities
 * are involved in it. This mirrors the vector `sceneTimeline` shape so the UI
 * renders both modes identically.
 */

import { entityRefRegex, resolveEntityRef } from "@/lib/forces/entity-ref";
import type { NarrativeState } from "@/types/narrative";

/** Distinct, valid (resolvable) entity ids cited in `text`, in order of first
 *  appearance. Hallucinated / unresolvable ids are dropped — same rule the
 *  renderer uses, so this list matches the visible citations exactly. */
export function citedEntityIds(
  text: string,
  narrative: NarrativeState | null | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = entityRefRegex();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = m[1].trim();
    if (seen.has(id)) continue;
    seen.add(id);
    if (!resolveEntityRef(narrative, id)) continue;
    out.push(id);
  }
  return out;
}

/** Entity ids "involved" in a scene: the scene itself, its POV, participants,
 *  location, the threads it moves, and any entity its world deltas touch.
 *  Used to attribute a cited entity back to the scenes it appears in. */
function sceneInvolvedIds(narrative: NarrativeState, sceneId: string): Set<string> {
  const ids = new Set<string>();
  const scene = narrative.scenes[sceneId];
  if (!scene) return ids;
  ids.add(scene.id);
  if (scene.povId) ids.add(scene.povId);
  for (const p of scene.participantIds ?? []) ids.add(p);
  if (scene.locationId) ids.add(scene.locationId);
  for (const td of scene.threadDeltas ?? []) ids.add(td.threadId);
  for (const wd of scene.worldDeltas ?? []) if (wd.entityId) ids.add(wd.entityId);
  return ids;
}

/**
 * Per-entry activation timeline derived from the cited entities, normalized to
 * 0..1. Same shape as the vector-mode `sceneTimeline` (`{ sceneIndex,
 * similarity }`), so the existing heat-curve renders unchanged. Non-scene
 * entries (world commits) stay at 0.
 */
export function buildCitationSceneTimeline(
  narrative: NarrativeState,
  resolvedKeys: string[],
  text: string,
): { sceneIndex: number; similarity: number }[] {
  const cited = new Set(citedEntityIds(text, narrative));
  const raw = resolvedKeys.map((key, i) => {
    const scene = narrative.scenes[key];
    if (!scene || cited.size === 0) return { sceneIndex: i, count: 0 };
    const involved = sceneInvolvedIds(narrative, key);
    let count = 0;
    for (const id of cited) if (involved.has(id)) count += 1;
    return { sceneIndex: i, count };
  });
  const max = raw.reduce((m, r) => Math.max(m, r.count), 0);
  return raw.map((r) => ({
    sceneIndex: r.sceneIndex,
    similarity: max > 0 ? r.count / max : 0,
  }));
}
