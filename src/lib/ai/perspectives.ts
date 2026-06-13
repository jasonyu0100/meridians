// Arc perspectives — retell a whole ARC (all its scenes) through a single lens
// (the public narrator, or a participant entity). Each is a skim-read digest in
// the scene-summary register, derived from canon but free to add non-canon,
// lens-specific detail. Generated in parallel from the Content → Perspectives tab
// and the Conviction READ brief.

import type { Arc, NarrativeState } from '@/types/narrative';
import { resolveEntry } from '@/types/narrative';
import { callGenerateStream } from './api';
import {
  buildPerspectiveSystemPrompt,
  buildPerspectiveUserPrompt,
  buildOffstagePerspectiveSystemPrompt,
  buildOffstagePerspectiveUserPrompt,
} from '@/lib/prompts/scenes/perspective';
import { WRITING_MODEL } from '@/lib/constants';
import { logInfo } from '@/lib/core/system-logger';

const PUBLIC_KEY = 'public';
const CONTINUITY_SCENES = 6; // recent scenes before the arc, fed in as the lens's prior history

/** Entity display name for a perspective key (or "Public" for the narrator). */
export function perspectiveLabel(narrative: NarrativeState, key: string): string {
  if (key === PUBLIC_KEY) return 'Public';
  return (
    narrative.characters[key]?.name ??
    narrative.locations[key]?.name ??
    narrative.artifacts?.[key]?.name ??
    key
  );
}

/** The arc's scenes in order, resolved to real Scene objects with summaries. */
function arcScenes(narrative: NarrativeState, arc: Arc) {
  return (arc.sceneIds ?? [])
    .map((id) => narrative.scenes[id])
    .filter((s): s is NonNullable<typeof s> => !!s);
}

/** The perspectives available for an arc: the public narrator + each distinct
 *  participant (POV or participant in ANY of the arc's scenes) that resolves to
 *  a real entity. */
export function availablePerspectiveKeys(narrative: NarrativeState, arc: Arc): string[] {
  const keys = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (!id) return;
    if (narrative.characters[id] || narrative.locations[id] || narrative.artifacts?.[id]) keys.add(id);
  };
  for (const scene of arcScenes(narrative, arc)) {
    add(scene.povId);
    for (const id of scene.participantIds ?? []) add(id);
  }
  return [PUBLIC_KEY, ...keys];
}

/** Every OTHER entity not in the arc — characters, locations, artifacts that
 *  take part in NONE of the arc's scenes. These are the non-canon "other"
 *  perspectives: an offstage entity gets an imagined concurrent moment
 *  ("elsewhere") rather than a retelling of events it never witnessed.
 *  Ordered most-prominent first (anchors / domains / key artifacts), then by
 *  name, so the on-demand list reads sensibly. */
export function otherPerspectiveKeys(narrative: NarrativeState, arc: Arc): string[] {
  const inArc = new Set(availablePerspectiveKeys(narrative, arc));
  const rank = (r: string | undefined, order: string[]) => {
    const i = r ? order.indexOf(r) : -1;
    return i === -1 ? order.length : i;
  };
  type Row = { id: string; name: string; group: number; sub: number };
  const rows: Row[] = [];
  for (const c of Object.values(narrative.characters)) {
    if (inArc.has(c.id)) continue;
    rows.push({ id: c.id, name: c.name ?? c.id, group: 0, sub: rank(c.role, ["anchor", "recurring", "transient"]) });
  }
  for (const l of Object.values(narrative.locations)) {
    if (inArc.has(l.id)) continue;
    rows.push({ id: l.id, name: l.name ?? l.id, group: 1, sub: rank(l.prominence, ["domain", "place", "margin"]) });
  }
  for (const a of Object.values(narrative.artifacts ?? {})) {
    if (inArc.has(a.id)) continue;
    rows.push({ id: a.id, name: a.name ?? a.id, group: 2, sub: rank(a.significance, ["key", "notable", "minor"]) });
  }
  rows.sort((a, b) => a.group - b.group || a.sub - b.sub || a.name.localeCompare(b.name));
  return rows.map((r) => r.id);
}

/** Whether an entity appears in the arc (POV or participant in any arc scene).
 *  When false, the entity is offstage for the whole arc and gets an imagined
 *  concurrent moment instead of a retelling of events it never witnessed. */
function isArcParticipant(narrative: NarrativeState, arc: Arc, entityKey: string): boolean {
  return arcScenes(narrative, arc).some(
    (s) => s.povId === entityKey || (s.participantIds ?? []).includes(entityKey),
  );
}

/** The arc's position in the timeline: the index of its FIRST scene in the
 *  resolved entry list (where the arc begins). Continuity is everything before
 *  it. Falls back to the end of the list if no arc scene is found. */
function arcStartIndex(arc: Arc, resolvedKeys: string[]): number {
  const ids = new Set(arc.sceneIds ?? []);
  for (let i = 0; i < resolvedKeys.length; i++) if (ids.has(resolvedKeys[i])) return i;
  return resolvedKeys.length;
}

/** The arc's canonical events — its scene summaries in order, the ground truth
 *  the perspective synthesizes across. */
function buildArcCanon(narrative: NarrativeState, arc: Arc): string {
  const summaries = arcScenes(narrative, arc)
    .map((s) => s.summary)
    .filter(Boolean);
  if (!summaries.length) return '';
  return summaries.map((s, i) => `${i + 1}. ${s}`).join('\n\n');
}

/** Recent scene summaries BEFORE the arc, optionally only those a given entity
 *  participated in — the lens's continuity going into the arc. */
function buildContinuity(
  narrative: NarrativeState,
  resolvedKeys: string[],
  startIndex: number,
  entityKey: string | null,
): string {
  const lines: string[] = [];

  // For an entity lens, lead with its stable known facts (its world graph).
  if (entityKey) {
    const entity =
      narrative.characters[entityKey] ?? narrative.locations[entityKey] ?? narrative.artifacts?.[entityKey];
    const facts = Object.values(entity?.world?.nodes ?? {})
      .map((n) => n.content)
      .filter(Boolean);
    if (facts.length) lines.push(`Known to ${perspectiveLabel(narrative, entityKey)}:\n` + facts.map((f) => `· ${f}`).join('\n'));
  }

  const summaries: string[] = [];
  for (let i = startIndex - 1; i >= 0 && summaries.length < CONTINUITY_SCENES; i--) {
    const e = resolveEntry(narrative, resolvedKeys[i]);
    if (!e || e.kind !== 'scene' || !e.summary) continue;
    if (entityKey && e.povId !== entityKey && !(e.participantIds ?? []).includes(entityKey)) continue;
    summaries.unshift(e.summary);
  }
  if (summaries.length) lines.push('Recent events:\n' + summaries.map((s) => `— ${s}`).join('\n\n'));

  return lines.join('\n\n');
}

/** The entity's last known location name before the arc starts — the most
 *  recent scene it took part in. Empty when it has never been seen. */
function lastKnownLocation(
  narrative: NarrativeState,
  resolvedKeys: string[],
  startIndex: number,
  entityKey: string,
): string {
  for (let i = startIndex - 1; i >= 0; i--) {
    const e = resolveEntry(narrative, resolvedKeys[i]);
    if (!e || e.kind !== 'scene') continue;
    if ((e.povId === entityKey || (e.participantIds ?? []).includes(entityKey)) && e.locationId)
      return narrative.locations[e.locationId]?.name ?? '';
  }
  return '';
}

/** This entity's recent prior perspective deliveries on EARLIER arcs (its own
 *  offstage/private narration history), oldest-first, up to a few — so the
 *  offstage life continues coherently rather than resetting each arc. */
function priorArcPerspectivesFor(
  narrative: NarrativeState,
  arc: Arc,
  resolvedKeys: string[],
  entityKey: string,
  limit = 3,
): string {
  const thisStart = arcStartIndex(arc, resolvedKeys);
  const earlier = Object.values(narrative.arcs ?? {})
    .filter((a) => a.id !== arc.id && arcStartIndex(a, resolvedKeys) < thisStart)
    .sort((a, b) => arcStartIndex(a, resolvedKeys) - arcStartIndex(b, resolvedKeys));
  const texts = earlier
    .map((a) => a.perspectives?.[entityKey]?.text?.trim())
    .filter((t): t is string => !!t);
  return texts.slice(-limit).map((t) => `— ${t}`).join('\n\n');
}

/**
 * Generate one ARC perspective. `key` is `public` (public narrator) or a
 * participant entity id. Synthesizes the whole arc through that lens. Returns
 * the perspective digest text. Caller saves it via SET_ARC_PERSPECTIVE; callers
 * fan these out in parallel.
 */
export async function generateArcPerspective(
  narrative: NarrativeState,
  arc: Arc,
  key: string,
  resolvedKeys: string[],
  opts: {
    onReasoning?: (token: string, accumulated: string) => void;
    /** Stream the answer text as it's written (for live "watch it build" UIs). */
    onToken?: (token: string, accumulated: string) => void;
  } = {},
): Promise<string> {
  const isPublic = key === PUBLIC_KEY;
  const label = perspectiveLabel(narrative, key);
  logInfo('Generating arc perspective', {
    source: 'analysis',
    operation: 'generate-perspective',
    details: { narrativeId: narrative.id, arcId: arc.id, key },
  });

  const startIndex = arcStartIndex(arc, resolvedKeys);
  const outline = `${arc.name}${arc.directionVector ? ` — ${arc.directionVector}` : ''}`;
  const continuity = buildContinuity(narrative, resolvedKeys, startIndex, isPublic ? null : key);
  // Perspective retelling is a register/voice task on already-decided canon — it
  // doesn't need a thinking budget. Keep it reasoning-free (like the narrative
  // stream-creation calls) so it stays cheap, especially the per-seat READ fan-out.
  const reasoningBudget = 0;

  // OFFSTAGE: a non-public entity that appears in NONE of the arc's scenes isn't
  // there to witness them. Don't retell the events — imagine its concurrent,
  // elsewhere life across the arc's span (last location + routine + ongoing
  // concerns), grounded in continuity and its prior deliveries, clear of canon.
  const offstage = !isPublic && !isArcParticipant(narrative, arc, key);
  const systemPrompt = offstage ? buildOffstagePerspectiveSystemPrompt() : buildPerspectiveSystemPrompt();
  const userPrompt = offstage
    ? buildOffstagePerspectiveUserPrompt({
        label,
        lastLocation: lastKnownLocation(narrative, resolvedKeys, startIndex, key),
        continuity,
        priorPerspectives: priorArcPerspectivesFor(narrative, arc, resolvedKeys, key),
        outline,
      })
    : buildPerspectiveUserPrompt({ label, isPublic, canon: buildArcCanon(narrative, arc), continuity, outline });

  let reasoning = '';
  let answer = '';
  const raw = await callGenerateStream(
    userPrompt,
    systemPrompt,
    (token) => {
      answer += token;
      opts.onToken?.(token, answer);
    },
    undefined,
    `generateArcPerspective:${offstage ? 'offstage:' : ''}${key}`,
    WRITING_MODEL,
    reasoningBudget,
    (token) => {
      reasoning += token;
      opts.onReasoning?.(token, reasoning);
    },
  );
  return raw.trim();
}
