import type { NarrativeState } from '@/types/narrative';
import { callGenerateStream, resolveReasoningBudget } from './api';
import { parseJson } from './json';
import { MAX_TOKENS_DEFAULT } from '@/lib/constants';
import { logInfo } from '@/lib/system-logger';

/** The sweet-spot number of DIRECT children per node (incl. the top level): a
 *  single map legibly shows roughly this many distinct regions. The prompt aims
 *  here. */
export const LOCATION_FANOUT_TARGET = 6;

/** Hard ceiling the prompt asks the model to respect. Each node with children
 *  becomes ONE map image, and an image can only legibly hold a handful of
 *  anchored regions — so a node with more children than this cannot be mapped.
 *  We bias toward balance through prompting and let the operator fix the rest in
 *  the review step (no brittle auto-enforcement). */
export const LOCATION_FANOUT_MAX = 8;

type Assignment = { id: string; parentId: string | null };

/** One-line description of every location for the model: id, name, prominence,
 *  current parent and a trimmed visual blurb so it can judge real containment. */
function describeLocations(narrative: NarrativeState): string {
  return Object.values(narrative.locations)
    .map((l) => {
      const parent = l.parentId ? (narrative.locations[l.parentId]?.name ?? 'unknown') : '(top-level)';
      const blurb = (l.imagePrompt ?? '').trim().replace(/\s+/g, ' ').slice(0, 180);
      return `- id=${l.id} | "${l.name}" | prominence=${l.prominence} | currentParent=${parent}${blurb ? ` | ${blurb}` : ''}`;
    })
    .join('\n');
}

/** The EXISTING containment tree, rendered as an indented outline so the model
 *  can read the prior structure holistically — what already nests where — and
 *  use it as a cue rather than starting blind. Cycle-guarded; locations with a
 *  dangling/missing parent are treated as top-level. */
function renderCurrentHierarchy(narrative: NarrativeState): string {
  const locs = Object.values(narrative.locations);
  const childrenOf = new Map<string | null, typeof locs>();
  for (const l of locs) {
    const key = l.parentId && narrative.locations[l.parentId] ? l.parentId : null;
    const bucket = childrenOf.get(key);
    if (bucket) bucket.push(l);
    else childrenOf.set(key, [l]);
  }
  const lines: string[] = [];
  const seen = new Set<string>();
  const walk = (parentKey: string | null, depth: number) => {
    const kids = (childrenOf.get(parentKey) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const k of kids) {
      if (seen.has(k.id)) continue; // defensive against cycles
      seen.add(k.id);
      lines.push(`${'  '.repeat(depth)}- ${k.name} [id=${k.id}, ${k.prominence}]`);
      walk(k.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join('\n') || '(flat — every location is currently top-level)';
}

const HIERARCHY_SYSTEM = `You are a world cartographer. You are given every location in a fictional world with its prominence and a short description, the EXISTING containment tree, and (often) a narrative outline. Your job is to (re)build the SPATIAL CONTAINMENT TREE — which location physically sits inside which — so it makes thematic and spatial sense and renders well as a hierarchy of maps.

A child location is PHYSICALLY INSIDE or PART OF its parent (a shop inside a town, a town inside a region, a region inside a continent). The tree is the map tree: EACH node with children becomes ONE map image showing those children, and an image can legibly hold only a handful of distinct regions (each marked with a single anchor). So a node with too many children CANNOT be mapped — bounded fan-out and a balanced, multi-level tree are the entire point. We are building a RECURSIVE understanding of the world: region → sub-region → place, where every level is its own readable map.

FIRST, build a coherent mental model of the world's geography: read the descriptions, the existing hierarchy and the narrative outline together and decide what the world's regions are, what sits inside what, and how the places relate. Only then assign parents.

RULES:
- STUDY THE EXISTING HIERARCHY as a cue — it encodes what the author / prior generation already believed about containment. PRESERVE the groupings that already make spatial and thematic sense; re-parent only where it genuinely improves coherence or balance. Do not reshuffle arbitrarily, but do fix flat or lopsided structure (e.g. everything dumped at the top level).
- Output an assignment for EVERY location id given, exactly once. Use ONLY the ids provided. Never invent ids or locations.
- parentId is the id of the containing location, or null for a top-level location (a broad region/domain that sits directly on the world map).
- BOUNDED FAN-OUT IS A HARD CONSTRAINT. Aim for about ${LOCATION_FANOUT_TARGET} direct children per node and NEVER exceed ${LOCATION_FANOUT_MAX} — for EVERY node, including the top level. If a node would have too many children, you MUST introduce an intermediate level: pick the few broadest of those children as grouping parents (a district, a quarter, a sub-region) and nest the rest beneath them. Prefer a deep, multi-level tree over any wide fan.
- BALANCE. Spread locations so no single branch is overloaded while siblings are nearly empty. Don't build one giant subtree beside many singletons.
- The top level (parentId=null) must hold only a SMALL set (about ${LOCATION_FANOUT_TARGET}, never more than ${LOCATION_FANOUT_MAX}) of the broadest regions/domains — not every place. Everything else nests beneath them.
- Use prominence as a hint, not a rule: 'domain' = broad territory (natural high-level parent), 'place' = mid-scale, 'margin' = small leaf. But honour the descriptions: real containment beats prominence.
- Containment must be physically plausible. Use BOTH the descriptions and the narrative context (when provided) to judge where each place really sits — travel between locations, which places are reached "within" or "near" others, factional/regional groupings, and how the geography is described in the story. Do not place a location inside one it could not be part of. If unsure, attach it to the nearest broader location that plausibly contains it; only use null when it is genuinely a top-level region.
- Prefer balanced subtrees: spread locations so no single branch is overloaded while others are empty.

Output ONLY JSON: {"assignments":[{"id":"<id>","parentId":"<id>"|null}, ...]}. No prose.`;

/** Force a proposed parent map into a valid forest: only real ids, no
 *  self-parents, no dangling parents, no cycles. Any location the model omitted
 *  keeps its existing parent. Cycles are broken by promoting the offending node
 *  to top-level. */
function sanitizeForest(
  proposed: Map<string, string | null>,
  narrative: NarrativeState,
): Record<string, string | null> {
  const ids = new Set(Object.keys(narrative.locations));
  const result = new Map<string, string | null>();

  for (const id of ids) {
    let p = proposed.has(id) ? proposed.get(id)! : (narrative.locations[id].parentId ?? null);
    if (p === id) p = null; // self-parent
    if (p != null && !ids.has(p)) p = null; // dangling parent
    result.set(id, p);
  }

  // Break cycles: walking up from a node must terminate at a root.
  for (const id of ids) {
    const seen = new Set<string>([id]);
    let cur = result.get(id) ?? null;
    while (cur != null) {
      if (seen.has(cur)) {
        result.set(id, null); // cut this node's link to break the loop
        break;
      }
      seen.add(cur);
      cur = result.get(cur) ?? null;
    }
  }

  return Object.fromEntries(result);
}

/** Public wrapper: coerce an (operator-edited) parent map into a valid forest —
 *  real ids only, no self-parents, dangling parents, or cycles. Used by the
 *  review modal before applying edits. */
export function sanitizeHierarchy(
  parents: Record<string, string | null>,
  narrative: NarrativeState,
): Record<string, string | null> {
  return sanitizeForest(new Map(Object.entries(parents)), narrative);
}

/** Largest direct-children count across the resulting tree (for logging / QA). */
function maxFanout(parents: Record<string, string | null>): number {
  const counts = new Map<string | null, number>();
  for (const parent of Object.values(parents)) counts.set(parent, (counts.get(parent) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

/**
 * Ask the model to rebuild the entire location containment tree and return a
 * validated `{ locationId -> parentId|null }` forest. The caller reviews/edits
 * it before applying, so this is a PROPOSAL — we trust the model's prompting and
 * leave the final say to the operator. Maps derive purely from `parentId`, so
 * the applied result reshapes the map tree.
 *
 * Streams the model's reasoning via `onReasoning` so the caller can show it
 * thinking live (using the story's own reasoning level, like every other call).
 * `repairFromRaw` re-parses a prior malformed output instead of a fresh call.
 */
export async function reorganizeLocationHierarchy(
  narrative: NarrativeState,
  opts: {
    outline?: string;
    onReasoning?: (token: string) => void;
    repairFromRaw?: string;
  } = {},
): Promise<Record<string, string | null>> {
  const locationCount = Object.keys(narrative.locations).length;
  if (locationCount === 0) return {};

  // The story outline is enhancing causal context: it tells the model how places
  // actually relate (travel, "within/near", regional/factional grouping) so the
  // rebuilt containment is grounded in the narrative, not just names. The
  // Locations list stays authoritative for ids/existence.
  const outlineBlock = opts.outline?.trim()
    ? `\n\nNARRATIVE OUTLINE (causal context — use ONLY to judge how places relate; do not add or rename locations):\n${opts.outline.trim().slice(0, 18000)}`
    : '';

  const userPrompt = `World: "${narrative.title}". ${locationCount} locations.\n\nLocations (authoritative id list):\n${describeLocations(narrative)}\n\nEXISTING HIERARCHY (current containment tree — use as a cue; keep what makes sense, fix what doesn't):\n${renderCurrentHierarchy(narrative)}${outlineBlock}\n\nBuild a coherent mental model of the world, then rebuild the spatial containment tree. Return the assignments JSON for every id above.`;

  const raw = opts.repairFromRaw
    ?? (await callGenerateStream(
      userPrompt,
      HIERARCHY_SYSTEM,
      () => {}, // content tokens (the JSON) aren't shown live — only reasoning is
      MAX_TOKENS_DEFAULT,
      'reorganizeLocationHierarchy',
      undefined,
      resolveReasoningBudget(narrative),
      (t) => opts.onReasoning?.(t),
    ));

  const parsed = parseJson(raw, 'reorganizeLocationHierarchy') as { assignments?: Assignment[] };
  const assignments = Array.isArray(parsed?.assignments) ? parsed.assignments : [];

  const proposed = new Map<string, string | null>();
  for (const a of assignments) {
    if (a && typeof a.id === 'string') proposed.set(a.id, a.parentId ?? null);
  }

  const parents = sanitizeForest(proposed, narrative);
  const topLevel = Object.values(parents).filter((p) => p == null).length;
  logInfo('Location hierarchy proposed', {
    source: 'world-expansion',
    operation: 'reorganize-hierarchy',
    details: { locationCount, assigned: proposed.size, topLevel, maxFanout: maxFanout(parents) },
  });
  return parents;
}
