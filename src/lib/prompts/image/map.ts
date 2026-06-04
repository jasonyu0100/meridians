/**
 * Map prompt — turn a location and its containment tree into a single
 * image-gen prompt for one flat, top-down map.
 *
 * Every map uses the SAME projection: flat, seen straight down, like a printed
 * atlas page. What changes per map is only its SCALE — a world, a region, a
 * settlement, or a single site — which picks the cartographic vocabulary
 * (continents vs districts vs rooms). Scale is derived from the root location's
 * level, so the same level always looks the same (consistency) while different
 * levels read differently (differentiation). No 3D, no angle, no perspective —
 * that drift is the failure mode these prompts guard against.
 *
 * Shared by the client (which runs the prompt-crafting LLM call through the
 * trackable callGenerate path) and the /api/generate-image route (fallback),
 * so there is exactly one source for the map prompt — no drift.
 */

/** One region of a map — a location, its place in the containment tree, and
 *  its own visual description (image prompt) used to pick its terrain. */
export type MapRegion = { name: string; prominence: string; parentName?: string; imagePrompt?: string };

/** Spatial scale of a map. Picks the cartographic vocabulary; the projection
 *  (flat, top-down) is identical across all four. */
export type MapScale = 'world' | 'region' | 'settlement' | 'site';

/** Pick the scale from the root location's level. Global = the whole world;
 *  otherwise the root's prominence sets the scale. */
export function mapScaleFromRoot(opts: { isGlobal: boolean; prominence?: string }): MapScale {
  if (opts.isGlobal) return 'world';
  switch (opts.prominence) {
    case 'domain': return 'region';
    case 'place': return 'settlement';
    case 'margin': return 'site';
    default: return 'region';
  }
}

/** One literal line per scale: what the whole map is, what its sub-regions are,
 *  the kind of map to draw, and when to pick it (the classifier menu is built
 *  from `whenToUse`). Positive and concrete — no "board-game" framing (that
 *  biased the model toward 3D dioramas). Adding a scale = adding one entry. */
const SCALE: Record<MapScale, { whole: string; regions: string; style: string; whenToUse: string }> = {
  world:      { whole: 'the whole world',      regions: 'continents and countries', style: 'a world map of landmasses, coastlines and open ocean',  whenToUse: 'the entire world or a planet — its sub-regions are continents, oceans or whole nations' },
  region:     { whole: 'one region',           regions: 'lands and territories',     style: 'a regional map of terrain, rivers, forests and open country', whenToUse: 'a country, province or wide stretch of land — its sub-regions are territories, provinces or natural areas' },
  settlement: { whole: 'one settlement',       regions: 'districts and quarters',    style: 'a town plan of streets, blocks and squares',          whenToUse: 'a city, town or village — its sub-regions are districts, quarters, streets or notable buildings' },
  site:       { whole: 'one building or site', regions: 'rooms and grounds',          style: 'a floor plan of rooms, walls and courtyards',         whenToUse: 'a single building, compound or small site — its sub-regions are rooms, floors, courtyards or grounds' },
};

/** All scale ids, in order. The classifier picks one of these. */
export const MAP_SCALES = Object.keys(SCALE) as MapScale[];

/** The throughline that overrides everything and carries across every scale:
 *  an architect's plan — flat, top-down, measured, elegant. Stated once,
 *  positively, then a short list of what that rules out. Grounding maps in
 *  architectural design both enforces the flat overhead projection and gives
 *  every map, from world to floor, one coherent design sensibility. Borders are
 *  seamless, not discrete — regions flow into one another (handled in the
 *  system prompt's continuity clause), so the map reads as one elegant whole. */
const ARCHITECTURAL_PLAN = "Draw it as an architect's plan: flat and seen from directly overhead, with measured proportion, elegant composition and a clear, legible layout where every space is deliberately placed. No perspective, no tilt, no 3D, no raised buildings or terrain, no cast shadows, no horizon, no sky — depth comes only from shading and colour. Favour calm structural clarity over decoration.";

/** Map label = the English/Latin portion of a name. Strips a trailing
 *  parenthetical translation ("White Stone Pass (白石关)" → "White Stone Pass")
 *  so a label never carries CJK. Names with no Latin part are kept verbatim. */
export function displayLabel(name: string): string {
  const m = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (m && /[A-Za-z]/.test(m[1])) return m[1].trim();
  return name.trim();
}

/** Render the containment tree as an indented outline: the root (the whole map)
 *  with its sub-regions nested under it, each carrying its own look hint so the
 *  model paints the right terrain. No coordinates — the model lays the map out;
 *  we only fix the nesting and the look of each place. */
function describeMapStructure(regions: MapRegion[]): string {
  const childrenOf = new Map<string | undefined, MapRegion[]>();
  for (const r of regions) {
    const bucket = childrenOf.get(r.parentName);
    if (bucket) bucket.push(r);
    else childrenOf.set(r.parentName, [r]);
  }

  const render = (region: MapRegion, depth: number): string[] => {
    const indent = '  '.repeat(depth);
    const look = region.imagePrompt?.trim() ? ` — ${region.imagePrompt.trim()}` : '';
    const kids = childrenOf.get(region.name) ?? [];
    const role = depth === 0 ? 'the whole map; its border is the outer edge' : 'an area inside its parent';
    const lines = [`${indent}- "${displayLabel(region.name)}" (${role})${look}`];
    for (const kid of kids) lines.push(...render(kid, depth + 1));
    return lines;
  };

  // Roots = regions with no in-scope parent (normally just the territory root).
  const names = new Set(regions.map((r) => r.name));
  const roots = regions.filter((r) => !r.parentName || !names.has(r.parentName));
  return roots.flatMap((r) => render(r, 0)).join('\n');
}

/** Count the real sub-regions (the root frames the map, not a sub-region). */
function countSubRegions(regions: MapRegion[]): number {
  const names = new Set(regions.map((r) => r.name));
  return regions.filter((r) => r.parentName && names.has(r.parentName)).length;
}

/** Derive scale from the regions alone (fallback when no scale is supplied) by
 *  reading the root region's prominence. */
function scaleFromRegions(regions: MapRegion[]): MapScale {
  const names = new Set(regions.map((r) => r.name));
  const root = regions.find((r) => !r.parentName || !names.has(r.parentName));
  return mapScaleFromRoot({ isGlobal: false, prominence: root?.prominence });
}

/** Assemble the system + user prompts for one map. The caller runs the LLM call
 *  (client-side via callGenerate so it's logged; the route falls back to this
 *  only when no prompt rides in). The map is rendered fully textless — image
 *  models garble baked text — so labels are HTML overlays placed afterward and
 *  the prompt forbids all text. */
export function buildMapImagePrompts(args: { name: string; regions: MapRegion[]; imageStyle?: string; scale?: MapScale }): { system: string; user: string } {
  const scale = args.scale ?? scaleFromRegions(args.regions);
  const s = SCALE[scale];
  const styleLine = args.imageStyle ? ` Render everything in this art style: ${args.imageStyle}.` : '';

  const system = `You write one image-generation prompt (2-3 sentences) for a single map: ${s.style}. ${ARCHITECTURAL_PLAN} The map is one continuous, seamless surface — its sub-regions flow into one another through soft natural transitions (coastlines, rivers, ridgelines, gradual shifts in terrain and colour), never hard outlines, separate tiles, panels or insets; each region still occupies its own recognisable area so it can be found at a glance.${styleLine} Use each place's description only to choose its terrain and colour; ignore any camera, angle or lighting words in it. Output only the prompt.`;

  const subRegionCount = countSubRegions(args.regions);
  const user = `Map of "${displayLabel(args.name)}" — ${s.whole}, showing ${subRegionCount} ${s.regions}.
Sub-regions (for your layout only — never write these names on the map):
${describeMapStructure(args.regions)}
Give every sub-region its own recognisable area, all flowing together into one continuous, seamless map with soft transitions and no hard borders between them; none left out. No text anywhere on the image — every label is added by hand afterward.`;

  return { system, user };
}

/** Build the prompts for the scale classifier — the LLM pass that reads a place
 *  and its sub-regions and picks which flat map scale best represents them. The
 *  menu is built from each scale's `whenToUse`, so adding a scale extends the
 *  classifier automatically. Every choice is still a flat top-down map; only the
 *  scale changes. The caller parses the reply down to one id and falls back to
 *  `mapScaleFromRoot` on anything unexpected. */
export function buildMapScaleClassifierPrompt(args: { name: string; regions: MapRegion[] }): { system: string; user: string } {
  const menu = MAP_SCALES.map((id) => `- ${id}: ${SCALE[id].whenToUse}`).join('\n');
  const system = `You choose which kind of flat, top-down map best represents a place and its sub-regions. Every option is a flat overhead map — you are only choosing the scale.
${menu}
Reply with exactly one id from the list and nothing else.`;
  const user = `Place: "${displayLabel(args.name)}"
Sub-regions:
${describeMapStructure(args.regions)}

Which single id best represents this? Reply with only the id.`;
  return { system, user };
}
