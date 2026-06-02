import { NextRequest, NextResponse } from 'next/server';
import { resolveKey } from '@/lib/resolve-api-key';
import { DEFAULT_MODEL } from '@/lib/constants';
import { logError, logInfo, logWarning } from '@/lib/system-logger';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REPLICATE_URL = 'https://api.replicate.com/v1/models/bytedance/seedream-4.5/predictions';

/** One region of a map — a location, its place in the containment tree, and
 *  its own visual description (image prompt) used to paint its terrain. */
type MapRegion = { name: string; prominence: string; parentName?: string; imagePrompt?: string };

type ImageRequest =
  | { type: 'character'; name: string; role: string; worldSummary: string; continuityHints: string[]; imagePrompt?: string; imageStyle?: string }
  | { type: 'location'; name: string; parentName?: string; worldSummary: string; continuityHints: string[]; imagePrompt?: string; imageStyle?: string }
  | { type: 'artifact'; name: string; significance: string; ownerName?: string; worldSummary: string; continuityHints: string[]; imagePrompt?: string; imageStyle?: string }
  | { type: 'map'; name: string; regions: MapRegion[]; imagePrompt?: string; imageStyle?: string };

/** Map view types. A map of a place + its sub-regions is rendered with whichever
 *  view best shows the whole AND keeps every sub-region distinct (labels are
 *  overlaid by hand afterward, so each sub-region must be individually
 *  identifiable). The set is OPEN — add an entry to `MAP_VIEWS` to support a new
 *  kind of structure, and the AI classifier picks it up automatically:
 *  - `terrain`   — orthographic top-down atlas (geographic scale)
 *  - `isometric` — illustrated isometric bird's-eye (settlements / compounds)
 *  - `floorplan` — orthographic top-down floor plan (one building's rooms)
 *  - `cutaway`   — side-on cross-section / x-ray (vertically stacked interiors)
 *  - `diagram`   — clean schematic of nodes + links (non-physical structures) */
type MapViewId = 'terrain' | 'isometric' | 'floorplan' | 'cutaway' | 'diagram';

interface MapView {
  /** Short human label (telemetry / future UI). */
  label: string;
  /** When this view is the best fit — fed to the AI classifier as its menu. */
  whenToUse: string;
  /** COMPOSITION block (appended to the system prompt + the final image prompt). */
  composition: string;
  /** Cartographer system directive (style + composition appended after it). */
  system: string;
  /** View-specific framing sentence(s); the structure outline follows it. */
  userGuidance: (title: string) => string;
  /** Trailing negative guard appended to the final image prompt. */
  negative: string;
}

const MAP_VIEWS: Record<MapViewId, MapView> = {
  terrain: {
    label: 'Top-down terrain',
    whenToUse: 'Geographic scale — a world, continent, kingdom, region, or stretch of wilderness whose sub-regions are LANDS (mountains, forests, provinces, seas, deserts). The default for anything larger than a single settlement.',
    composition: 'A FLAT 2D TOP-DOWN MAP in strict orthographic overhead projection — seen from directly above at a 90° angle, like a printed atlas page laid flat on a table. The overriding rule: ZERO perspective, ZERO isometric or oblique angle, ZERO 3D, ZERO vanishing point. Nothing is drawn standing or seen from the side — no 3D mountains, no buildings in elevation, no objects, no cast shadows, no depth, no horizon, no sky. All terrain is flat map symbology: ridge-shading for mountains, flat textured fills for forest, flat colour for water/ice/plains, flat plan-view marks for any structure. Rendered in the specified art style as a painterly but completely FLAT map — richness comes from the painted fills, never from 3D or perspective. ONE single seamless continuous landmass filling the frame, framed by a single thin outer border; sub-regions are clearly-bordered, visually DISTINCT flat areas within it, separated only by painted borders, rivers, coastlines or ridgelines, with terrain flowing continuously across them. NO separate tiles, hexes, panels, insets or vignettes, NO gaps, NO seams. Show ONLY this territory and its sub-regions — NO compass rose, NO extra lands. ABSOLUTELY NO TEXT anywhere on the image: no title, labels, place names, letters, numbers, calligraphy, banners, ribbons or watermarks — every label is added separately afterward.',
    system: "You are a cartographic description specialist. Given a territory and its sub-regions, produce a single image generation prompt (3-4 sentences) for a FLAT 2D TOP-DOWN MAP rendered in the specified art style. The viewpoint rule overrides everything: seen from DIRECTLY ABOVE in strict orthographic projection, like a printed atlas page laid flat — ZERO perspective, ZERO isometric/oblique angle, ZERO 3D, no standing mountains, no buildings in elevation, no cast shadows, no horizon, no sky. Open by stating it is a flat top-down 2D map in the named art style. Each sub-region is a flat, clearly-bordered, visually DISTINCT area: depict its terrain as flat map symbology only — ridge-shading for mountains, flat textured fills for forest, flat colour for water/ice/plains, flat plan-view marks for any structure. Each sub-region below comes with a 3D establishing-shot description — use it ONLY to choose the BIOME/TERRAIN TYPE; DISCARD every word about camera, perspective, lighting, framing or depth, and render a flat overhead area. The map must read as ONE seamless continuous landmass, not a grid of tiles: sub-regions separated only by painted borders/rivers/ridgelines with terrain flowing across them — never tiles, hexes, panels or vignettes, never gaps. Arrange the sub-regions for visual appeal — you choose where each sits. CRITICAL — the image must contain ABSOLUTELY NO TEXT of any kind (all labels are overlaid afterward). The region names below are for YOUR layout reasoning only and must never be written on the map. Output ONLY the prompt, nothing else.",
    userGuidance: (title) => `Create a FLAT 2D TOP-DOWN MAP prompt for the territory "${title}" and its sub-regions, rendered in the work's art style (named at the end). Strict orthographic overhead view — seen from directly above like a printed atlas page laid flat: NO perspective, NO isometric/oblique angle, NO 3D, no standing mountains or buildings, no shadows, no horizon, no sky. Use each region's description ONLY to choose the BIOME/TERRAIN TYPE to paint; discard its camera/lighting language. Render ONE single seamless continuous landmass filling the frame (not separate tiles or panels — sub-regions flow into each other across painted borders/rivers/ridgelines with no gaps), framed by a single outer border.`,
    negative: 'FLAT 2D TOP-DOWN MAP, strict orthographic overhead view seen from directly above like a printed atlas page laid flat. NO perspective, NO isometric, NO oblique angle, NO 3D, NO standing mountains, NO buildings in elevation, NO cast shadows, NO depth, NO horizon, NO sky — flat map symbology only. One single seamless continuous landmass, sub-regions flowing across painted borders with no gaps, no separate tiles, hexes, panels or vignettes, no seams; each sub-region a clearly-bordered visually distinct flat area; only this territory and its sub-regions, no compass rose, no extra lands. ABSOLUTELY NO TEXT anywhere: no title, no labels, no place names, no letters, no numbers, no calligraphy, no Chinese or other CJK characters, no banners, ribbons, logos or watermarks',
  },
  isometric: {
    label: 'Isometric bird\'s-eye',
    whenToUse: 'Settlement or compound scale — a village, town, campus, monastery, market, or walled compound whose sub-regions are distinct BUILDINGS, courtyards, or districts spread across grounds. Best seen from above at a three-quarter angle.',
    composition: "An ILLUSTRATED ISOMETRIC BIRD'S-EYE MAP of a single place seen from a high three-quarter overhead angle (~45°) — like a hand-painted game-world map or a scale architectural model. ONE cohesive continuous site fills the frame on a single shared ground plane under one consistent light direction: a settlement, compound or building complex whose sub-regions are DISTINCT, individually recognisable structures, courtyards or districts, joined by paths, walls, bridges, water and grounds so the whole reads as one unbroken place. NO floating tiles, panels, insets or vignettes, NO gaps, NO seams, NO split views, NO grid. Rendered in the specified art style with clean, readable architecture — fidelity comes from distinct buildings and well-composed grounds, not from clutter. Show ONLY this place and its sub-regions — nothing beyond its edges, NO compass rose. ABSOLUTELY NO TEXT anywhere on the image: no title, labels, place names, letters, numbers, calligraphy, banners, ribbons, signs or watermarks — every label is added separately afterward.",
    system: "You are a cartographic illustration specialist. Given a place and its sub-regions, produce a single image generation prompt (3-4 sentences) for an ILLUSTRATED ISOMETRIC BIRD'S-EYE MAP in the specified art style — one cohesive site seen from a high three-quarter overhead angle (~45°), like a hand-painted game map or a scale architectural model. Open by stating it is an illustrated isometric bird's-eye map in the named art style. Lay every sub-region out on ONE shared ground plane under a single consistent light direction, each a DISTINCT, individually recognisable structure / courtyard / district, joined by paths, walls, water and grounds so the whole reads as one unbroken place — never floating tiles, panels, insets or vignettes, never gaps or split views. Each sub-region below comes with an establishing-shot description — use it to choose that structure's ARCHITECTURE, MATERIALS and immediate surroundings, and place it sensibly next to the others. Arrange the layout for visual appeal — you choose where each sits. CRITICAL — the image must contain ABSOLUTELY NO TEXT of any kind (all labels are overlaid afterward). The region names below are for YOUR layout reasoning only and must never be written on the map. Output ONLY the prompt, nothing else.",
    userGuidance: (title) => `Create an ILLUSTRATED ISOMETRIC BIRD'S-EYE MAP prompt for "${title}" and its sub-regions, rendered in the work's art style (named at the end). High three-quarter overhead angle (~45°) over ONE cohesive site on a single shared ground plane with one consistent light direction — like a hand-painted game-world map or scale model. Use each region's description to choose its architecture, materials and surroundings, then place it. Render ONE cohesive site filling the frame — distinct buildings/courtyards/districts joined by paths, walls and water, never floating tiles, panels or vignettes, no gaps.`,
    negative: "ILLUSTRATED ISOMETRIC BIRD'S-EYE MAP, one cohesive site seen from a high three-quarter overhead angle on a single ground plane under one consistent light direction. Distinct buildings, courtyards and districts joined by paths, walls and water — never floating tiles, hexes, panels, insets or vignettes, no gaps, no seams, no split-screen, no grid. Only this place and its sub-regions, no compass rose, nothing beyond its edges. NOT a photograph. ABSOLUTELY NO TEXT anywhere: no title, no labels, no place names, no letters, no numbers, no calligraphy, no Chinese or other CJK characters, no banners, ribbons, signs, logos or watermarks",
  },
  floorplan: {
    label: 'Top-down floor plan',
    whenToUse: 'A single building or one level of it whose sub-regions are ROOMS, halls, or chambers on the SAME floor — best seen straight down as an architectural floor plan with walls, doorways and thresholds.',
    composition: 'An ARCHITECTURAL FLOOR PLAN seen straight down from directly overhead in orthographic projection — like a blueprint or a tabletop dungeon map, rendered in the specified art style. ONE single building or level fills the frame: its sub-regions are individual ROOMS / halls / chambers, each a clearly-walled enclosed space, separated by solid walls with doorways or thresholds between them, all joined into one continuous floor — never floating tiles, panels, insets or vignettes, NO gaps, NO seams. Walls, floors and key fixtures are shown in plan view with consistent line weight and a coherent palette; each room is a DISTINCT, individually recognisable space. Show ONLY this building and its rooms — nothing beyond the outer walls, NO compass rose. ABSOLUTELY NO TEXT anywhere on the image: no title, labels, room names, letters, numbers, calligraphy, dimensions, watermarks — every label is added separately afterward.',
    system: "You are an architectural draughting specialist. Given a building and its rooms, produce a single image generation prompt (3-4 sentences) for an ORTHOGRAPHIC TOP-DOWN FLOOR PLAN in the specified art style — seen straight down from directly overhead, like a blueprint or a dungeon map. Open by stating it is a top-down architectural floor plan in the named art style. Lay every sub-region out as a DISTINCT walled ROOM / hall / chamber on ONE continuous floor, separated by solid walls with doorways between them, arranged so circulation makes sense — never floating tiles, panels or vignettes, never gaps. Each sub-region below comes with a description — use it to choose that room's FUNCTION, fixtures and materials. Arrange the layout for sensible flow and visual appeal. CRITICAL — the image must contain ABSOLUTELY NO TEXT of any kind, no room names and no dimensions (all labels are overlaid afterward). The region names below are for YOUR layout reasoning only and must never be written on the plan. Output ONLY the prompt, nothing else.",
    userGuidance: (title) => `Create an ORTHOGRAPHIC TOP-DOWN FLOOR PLAN prompt for "${title}" and its rooms, rendered in the work's art style (named at the end). Seen straight down from directly overhead like a blueprint — walls, doorways, thresholds and key fixtures in plan view on one continuous floor. Use each room's description to choose its function, fixtures and materials, and lay the rooms out so circulation makes sense.`,
    negative: 'ARCHITECTURAL FLOOR PLAN, orthographic top-down seen straight down from directly overhead like a blueprint. Walled rooms on one continuous floor connected by doorways — never floating tiles, panels, insets or vignettes, no gaps, no seams. NOT an isometric or 3D view, NOT a perspective interior, NOT a photo, no horizon, no sky. Only this building and its rooms, nothing beyond the outer walls, no compass rose. ABSOLUTELY NO TEXT anywhere: no title, no labels, no room names, no letters, no numbers, no dimensions, no calligraphy, no Chinese or other CJK characters, no logos or watermarks',
  },
  cutaway: {
    label: 'Side-on cutaway',
    whenToUse: 'A vertical or multi-level structure whose sub-regions STACK by height or depth — a tower\'s floors, a ship\'s decks, a dungeon\'s levels, a multi-storey building, a mine or cave system descending underground. Seen from the side with the near wall cut away to reveal the interior.',
    composition: 'A SIDE-ON CROSS-SECTION (cutaway / x-ray elevation) seen from straight in front at eye level, with the near wall removed to reveal the interior — like a dollhouse, a cutaway diagram of a ship or tower, or a layered dungeon, rendered in the specified art style. ONE single structure fills the frame, its sub-regions stacked and placed by real position (upper floors high, cellars and depths low; fore/aft or left/right preserved), each a DISTINCT compartment / level / room divided by visible floors and walls, all part of one continuous cut-through structure — never floating tiles, panels, insets or vignettes, NO gaps, NO seams. Consistent single side-on viewpoint and light; each sub-region is individually recognisable. Show ONLY this structure and its interior — nothing beyond its outer shell, NO sky filler. ABSOLUTELY NO TEXT anywhere on the image: no title, labels, place names, letters, numbers, calligraphy, watermarks — every label is added separately afterward.',
    system: "You are a cutaway-diagram illustration specialist. Given a structure and its interior sub-regions, produce a single image generation prompt (3-4 sentences) for a SIDE-ON CROSS-SECTION (cutaway / x-ray elevation) in the specified art style — seen from the front at eye level with the near wall removed to reveal the interior, like a dollhouse or a layered diagram of a ship, tower or dungeon. Open by stating it is a side-on cutaway cross-section in the named art style. Stack and place every sub-region by its TRUE position — upper floors high, cellars and depths low, fore/aft preserved — each a DISTINCT compartment divided by visible floors and walls, all part of one continuous cut-through structure — never floating tiles, panels or vignettes, never gaps. Each sub-region below comes with a description — use it to choose that compartment's contents, fixtures and materials. CRITICAL — the image must contain ABSOLUTELY NO TEXT of any kind (all labels are overlaid afterward). The region names below are for YOUR layout reasoning only and must never be written on the image. Output ONLY the prompt, nothing else.",
    userGuidance: (title) => `Create a SIDE-ON CROSS-SECTION (cutaway / x-ray elevation) prompt for "${title}" and its interior sub-regions, rendered in the work's art style (named at the end). Front-on at eye level with the near wall cut away to reveal the inside — sub-regions stacked by true height/depth (upper floors high, cellars low), divided by visible floors and walls into one continuous cut-through structure. Use each region's description to choose its contents, fixtures and materials.`,
    negative: 'SIDE-ON CROSS-SECTION cutaway / x-ray elevation seen from the front at eye level with the near wall removed. Interior compartments stacked by true height and depth, divided by visible floors and walls into one continuous structure — never floating tiles, panels, insets or vignettes, no gaps, no seams. NOT a top-down plan, NOT an isometric bird\'s-eye, NOT a photo. Only this structure and its interior, nothing beyond its outer shell. ABSOLUTELY NO TEXT anywhere: no title, no labels, no place names, no letters, no numbers, no calligraphy, no Chinese or other CJK characters, no logos or watermarks',
  },
  diagram: {
    label: 'Schematic diagram',
    whenToUse: 'ONLY when the place is NON-PHYSICAL or has no meaningful spatial layout — an abstract realm, a network, a dream or spirit world, a political or organisational structure — where the sub-regions are domains/nodes best shown as a clean connected diagram rather than a literal map.',
    composition: 'A CLEAN SCHEMATIC MAP-DIAGRAM rendered in the specified art style — the place\'s sub-regions drawn as DISTINCT bounded nodes (cells, islands, bordered zones, orbs) connected by clear links or paths into ONE cohesive composition on a single backdrop. Each node is individually recognisable and visually separated by space, borders or connectors, yet the whole reads as one connected structure — no random scatter, no gaps that break the composition, no separate panels or insets. Rendered with clean, readable forms and a coherent palette. Show ONLY these nodes and their links. ABSOLUTELY NO TEXT anywhere on the image: no title, labels, names, letters, numbers, calligraphy, watermarks — every label is added separately afterward.',
    system: "You are a schematic-diagram specialist. Given a non-physical structure and its sub-parts, produce a single image generation prompt (3-4 sentences) for a CLEAN SCHEMATIC MAP-DIAGRAM in the specified art style — the sub-regions as DISTINCT bounded nodes connected by clear links into one cohesive composition. Open by stating it is a clean schematic diagram in the named art style. Make every node individually recognisable and visually separated, yet connected into one whole — never random scatter, never separate panels or insets, never gaps that break the composition. Each sub-region below comes with a description — use it to choose that node's MOTIF, colour and form. Arrange for clarity and visual appeal. CRITICAL — the image must contain ABSOLUTELY NO TEXT of any kind (all labels are overlaid afterward). The region names below are for YOUR layout reasoning only and must never be written on the diagram. Output ONLY the prompt, nothing else.",
    userGuidance: (title) => `Create a CLEAN SCHEMATIC MAP-DIAGRAM prompt for "${title}" and its sub-regions, rendered in the work's art style (named at the end). Draw the sub-regions as DISTINCT bounded nodes connected by clear links into one cohesive composition on a single backdrop. Use each region's description to choose its motif, colour and form. Keep every node individually recognisable and visually separated, yet connected into one whole.`,
    negative: 'CLEAN SCHEMATIC MAP-DIAGRAM, distinct bounded nodes connected by clear links into one cohesive composition on a single backdrop. Never random scatter, never separate panels, insets or vignettes, no gaps that break the composition. NOT a literal landscape, NOT a photo. ABSOLUTELY NO TEXT anywhere: no title, no labels, no names, no letters, no numbers, no calligraphy, no Chinese or other CJK characters, no logos or watermarks',
  },
};

/** Board-game design ethos shared by every map view: legible, discrete,
 *  well-separated spaces. Board games lay a board out cleanly precisely so each
 *  position reads at a glance — that's the target. */
const MAP_BOARD_DESIGN = 'Design the whole image like a well-crafted BOARD-GAME BOARD: clean, highly legible, with strong figure-ground and a balanced composition. Every sub-region is a clearly demarcated discrete space, generously separated from its neighbours so none blur together. Immersive extra detail (atmosphere, scatter, flora, props, weathering) is welcome to make the board feel alive — but it is BACKGROUND only and must never read as another region.';

/** Composition guidance per image type (map uses the terrain default; the real
 *  map composition is chosen per view at the call sites via `MAP_VIEWS`). */
const COMPOSITION: Record<ImageRequest['type'], string> = {
  character: 'Single character portrait, head and shoulders, one subject only',
  location: 'Wide establishing shot, architectural or landscape composition',
  artifact: 'Single object study, isolated subject centred in frame, clear silhouette, museum-lit presentation',
  map: MAP_VIEWS.terrain.composition,
};

/** Aspect ratio per image type. Every map view stays 4:3 so hand-placed labels
 *  (normalized 0..1) line up regardless of how the map was rendered. */
const ASPECT_RATIO: Record<ImageRequest['type'], string> = {
  character: '3:4',
  location: '16:9',
  artifact: '1:1',
  map: '4:3',
};

// Scale signals for the keyword fallback. Word-boundary matched against region
// names + their image prompts. TERRAIN = land/geography; ARCH = built places.
const TERRAIN_RE = /\b(mountain|range|peak|ridge|cliff|forest|wood|woodland|jungle|sea|ocean|lake|river|stream|delta|plain|steppe|prairie|desert|dune|tundra|ice|glacier|frost|snowfield|continent|kingdom|empire|realm|province|region|territory|land|valley|ravine|gorge|canyon|coast|shore|island|isle|archipelago|wild|wilds|wasteland|waste|marsh|swamp|moor|meadow|frontier|badland|highland|lowland|basin|plateau|reef|bay|gulf|strait|peninsula|expanse|wilderness|terrain|cavern|cave)s?\b/gi;
const ARCH_RE = /\b(hall|manor|academy|school|temple|shrine|palace|castle|fortress|keep|tower|citadel|compound|estate|courtyard|monastery|sect|pavilion|chamber|room|library|market|bazaar|plaza|square|district|ward|quarter|gatehouse|gate|dungeon|cellar|vault|laboratory|workshop|forge|smithy|barracks|dormitory|dorm|arena|theatre|theater|station|deck|cabin|hold|village|town|city|settlement|hamlet|outpost|camp|fort|stronghold|garrison|harbour|harbor|port|dock|wharf|mansion|villa|house|inn|tavern|hospital|clinic|office|factory|mill|warehouse|prison|jail|cathedral|chapel|abbey|garden|park|farm|ranch|mine|quarry|tomb|crypt|mausoleum|observatory|spire|hut|cottage|lodge|shop|store)s?\b/gi;

function reCount(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

/** Keyword fallback for the map view, used when the AI classifier
 *  (`classifyMapView`) is unavailable or unparseable. It only distinguishes the
 *  two broad, safe defaults — `terrain` (land) vs `isometric` (built place) —
 *  the finer interior views (floorplan / cutaway / diagram) are left to the AI.
 *  The ROOT sets the scale; an ambiguous root (e.g. the synthetic "Global" map)
 *  falls back to the sub-regions, flipping to isometric only on a clear
 *  built-structure majority so broad multi-territory maps stay atlases. */
function classifyMapViewHeuristic(regions: MapRegion[]): MapViewId {
  const names = new Set(regions.map((r) => r.name));
  const roots = regions.filter((r) => !r.parentName || !names.has(r.parentName));
  const root = roots[0];
  const textOf = (r: MapRegion) => `${r.name} ${r.imagePrompt ?? ''}`;

  if (root) {
    const rt = textOf(root);
    const rArch = reCount(rt, ARCH_RE);
    const rTerr = reCount(rt, TERRAIN_RE);
    if (rArch > rTerr) return 'isometric';
    if (rTerr > rArch) return 'terrain';
  }

  // Root ambiguous — look at the sub-regions, biased toward terrain for breadth.
  const children = regions.filter((r) => r !== root);
  let cArch = 0;
  let cTerr = 0;
  for (const c of children) {
    const t = textOf(c);
    cArch += reCount(t, ARCH_RE);
    cTerr += reCount(t, TERRAIN_RE);
  }
  return cArch >= 2 && cArch > cTerr * 2 ? 'isometric' : 'terrain';
}

/** Choose the map view with an initial AI pass that reads the actual structure
 *  being rendered — the place, its sub-regions and their visual descriptions —
 *  and picks the view from `MAP_VIEWS` that best shows the whole while keeping
 *  every sub-region distinct. More robust than keywords for in-between cases (a
 *  ship's decks → cutaway, a manor's rooms → floorplan, a spirit realm →
 *  diagram). Falls back to the keyword heuristic on any failure or unparseable
 *  reply, so a flaky model never blocks generation. */
async function classifyMapView(openrouterKey: string, name: string, regions: MapRegion[]): Promise<MapViewId> {
  const ids = Object.keys(MAP_VIEWS) as MapViewId[];
  try {
    const menu = ids.map((id) => `- "${id}" — ${MAP_VIEWS[id].whenToUse}`).join('\n');
    const systemPrompt = `You are a cartography director. Choose the SINGLE best view for rendering a map of a place and its sub-regions. Judge by what the place physically IS and what its sub-regions ARE, and pick the view that shows the whole AND makes every sub-region distinct and individually identifiable (labels are added afterward). Reply with EXACTLY ONE of these ids, lowercase, nothing else:\n${menu}`;
    const userPrompt = `Place: "${displayLabel(name)}"\nSub-regions (each line is a region; the trailing text is its visual description):\n${describeMapStructure(regions)}\n\nWhich view id?`;

    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Narrative Engine',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 12,
      }),
    });
    if (!res.ok) throw new Error(`LLM error: ${res.status}`);
    const data = await res.json();
    const reply = (data.choices?.[0]?.message?.content ?? '').toLowerCase();
    // The earliest-appearing id token wins (ids are mutually non-substring).
    let best: MapViewId | null = null;
    let bestAt = Infinity;
    for (const id of ids) {
      const at = reply.indexOf(id);
      if (at !== -1 && at < bestAt) { bestAt = at; best = id; }
    }
    if (best) return best;
    throw new Error(`unparseable view reply: ${reply.slice(0, 40)}`);
  } catch (err) {
    logWarning('Map view AI classification failed — using keyword heuristic', err, {
      source: 'image-generation',
      operation: 'classify-map-view',
    });
    return classifyMapViewHeuristic(regions);
  }
}

const REGION_KIND: Record<string, string> = {
  domain: 'major territory',
  place: 'region',
  margin: 'minor locale',
};

/** Map label = the English/Latin portion of a name. Strips a trailing
 *  parenthetical translation ("White Stone Pass (白石关)" → "White Stone Pass")
 *  so every map label renders in English, never CJK. Names with no Latin part
 *  are kept verbatim (nothing better to show). */
function displayLabel(name: string): string {
  const m = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (m && /[A-Za-z]/.test(m[1])) return m[1].trim();
  return name.trim();
}

/** Render the containment structure as an indented natural-language outline:
 *  the root territory, with its sub-regions nested under it (recursively), each
 *  carrying its own visual description so the model paints the right terrain.
 *  No coordinates — the model lays the board out for visual appeal; we only fix
 *  the nesting (what sits inside what) and the look of each place. */
function describeMapStructure(regions: MapRegion[]): string {
  const childrenOf = new Map<string | undefined, MapRegion[]>();
  for (const r of regions) {
    const key = r.parentName;
    const bucket = childrenOf.get(key);
    if (bucket) bucket.push(r);
    else childrenOf.set(key, [r]);
  }

  const render = (region: MapRegion, depth: number): string[] => {
    const indent = '  '.repeat(depth);
    const kind = REGION_KIND[region.prominence] ?? 'locale';
    const look = region.imagePrompt?.trim() ? ` — ${region.imagePrompt.trim()}` : '';
    const kids = childrenOf.get(region.name) ?? [];
    const kidCount = `${kids.length} sub-region${kids.length > 1 ? 's' : ''}`;
    const label = displayLabel(region.name);
    // Containment is visual and recursive: every region that has children is
    // drawn as a CLOSED bounded area physically enclosing those children, all
    // the way down. The root (depth 0) is the outermost extent of the whole map.
    // Wording is view-neutral — the chosen view (terrain/isometric/floorplan/
    // cutaway/diagram) decides whether a "bounded area" is a land, a building or
    // a node.
    const role = depth === 0
      ? `THE WHOLE MAP — outermost extent enclosing every other region; its edge frames the entire map, with all ${kidCount} nested inside it`
      : kids.length > 0
        ? `${kind} — a distinct bounded area drawn INSIDE its parent, itself enclosing its own ${kidCount}`
        : `${kind} — a small distinct area inside its parent`;
    const lines = [`${indent}- "${label}" (${role})${look}`];
    for (const kid of kids) lines.push(...render(kid, depth + 1));
    return lines;
  };

  // Roots = regions with no in-scope parent (normally just the territory root).
  const names = new Set(regions.map((r) => r.name));
  const roots = regions.filter((r) => !r.parentName || !names.has(r.parentName));
  return roots.flatMap((r) => render(r, 0)).join('\n');
}

/** Use LLM to craft a rich visual description for image generation. For maps,
 *  `mapView` selects the cartographic treatment from `MAP_VIEWS`. Returns the
 *  crafted `prompt` plus the `systemPrompt` / `userPrompt` that produced it, so
 *  callers can surface the real prompts in the API log (the request body alone
 *  hides the actual image-gen instructions). */
async function describeVisually(
  openrouterKey: string,
  request: ImageRequest,
  mapView: MapViewId = 'terrain',
): Promise<{ prompt: string; systemPrompt?: string; userPrompt?: string }> {
  // If an imagePrompt already exists, use it directly
  if (request.imagePrompt) {
    return { prompt: request.imagePrompt };
  }

  const styleDirective = request.imageStyle
    ? `\nIMPORTANT: The entire image MUST be rendered in this visual style, applied consistently to every element: ${request.imageStyle}.`
    : '';

  const view = MAP_VIEWS[mapView];

  // Maps are rendered fully textless — image models garble baked text (and
  // invent nonsense calligraphy in stylised work). The title and every region
  // label are HTML overlays placed afterward, so the prompt forbids ALL text.
  const systemPrompt = request.type === 'map'
    ? `${view.system}${styleDirective}

COMPOSITION: ${view.composition}

BOARD DESIGN: ${MAP_BOARD_DESIGN}`
    : `You are a visual description specialist. Given narrative context, produce a single concise image generation prompt (2-3 sentences max). Focus on visual details: appearance, clothing, atmosphere, lighting, color palette. Never include text, words, or watermarks in the description. Output ONLY the prompt, nothing else.${styleDirective}

COMPOSITION: ${COMPOSITION[request.type]}`;

  let userPrompt: string;
  if (request.type === 'character') {
    userPrompt = `Create a character portrait prompt for "${request.name}" (role: ${request.role}) in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
  } else if (request.type === 'location') {
    const parent = request.parentName ? ` (inside ${request.parentName})` : '';
    userPrompt = `Create an establishing shot prompt for the location "${request.name}"${parent} in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
  } else if (request.type === 'map') {
    // View-specific framing, then the shared structure outline + textless rule.
    userPrompt = `${view.userGuidance(displayLabel(request.name))}
Structure outline (each line is a region with its visual description — use the description to choose its look / architecture / terrain / contents; the names are for YOUR layout reasoning only and must NEVER be written on the image):
${describeMapStructure(request.regions)}
Every sub-region must read as a DISTINCT, individually identifiable area, clearly separated from its neighbours. Do NOT draw any pins, markers, dots, anchors, icons or symbols on top of the map — it is a clean illustration only; labels are overlaid by hand afterward. The image must contain ABSOLUTELY NO TEXT of any kind — no title, names, labels, letters, numbers or calligraphy anywhere.`;
  } else {
    const owner = request.ownerName ? ` (owned by ${request.ownerName})` : '';
    userPrompt = `Create an object study prompt for the artifact "${request.name}" (${request.significance})${owner} in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
  }

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openrouterKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Narrative Engine',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 300,
    }),
  });

  if (!res.ok) throw new Error(`LLM error: ${await res.text()}`);
  const data = await res.json();
  return { prompt: data.choices?.[0]?.message?.content?.trim() ?? '', systemPrompt, userPrompt };
}

export async function POST(req: NextRequest) {
  const replicateToken = resolveKey(req, 'x-replicate-key', 'REPLICATE_API_TOKEN');
  const openrouterKey = resolveKey(req, 'x-openrouter-key', 'OPENROUTER_API_KEY');

  if (!replicateToken) return NextResponse.json({ error: 'Replicate API token required' }, { status: 401 });
  if (!openrouterKey) return NextResponse.json({ error: 'OpenRouter API key required' }, { status: 401 });

  const startedAt = Date.now();
  try {
    const body = await req.json() as ImageRequest;
    // For maps, an initial AI pass reads the structure and picks the best view
    // for what's depicted (keyword heuristic on fallback).
    const mapView: MapViewId | null = body.type === 'map'
      ? await classifyMapView(openrouterKey, body.name, body.regions)
      : null;
    logInfo(`Image generation request received`, {
      source: 'image-generation',
      operation: 'request',
      details: { type: body.type, hasCustomStyle: !!body.imageStyle, ...(mapView ? { mapView } : {}) },
    });

    // Step 1: Get or craft the visual prompt
    const { prompt: visualPrompt, systemPrompt, userPrompt } = await describeVisually(openrouterKey, body, mapView ?? 'terrain');
    if (!visualPrompt) {
      logWarning('Failed to generate visual description', 'empty visual prompt', {
        source: 'image-generation',
        operation: 'describe-visually',
        details: { type: body.type },
      });
      return NextResponse.json({ error: 'Failed to generate visual description' }, { status: 500 });
    }

    // Build prompt: style → subject → guard. Style ALWAYS leads.
    // For maps NOTHING is re-appended here — the full view / board-design
    // directives were already baked into `visualPrompt` by the cartographer
    // system + user prompts (which go to the LLM, not the image API). Non-map
    // types still get their composition + a short no-text guard.
    const parts: string[] = [];
    if (body.imageStyle) parts.push(body.imageStyle);
    parts.push(visualPrompt);
    if (!mapView) {
      parts.push(COMPOSITION[body.type]);
      parts.push('No text, no letters, no watermarks');
    }
    const finalPrompt = parts.join('. ');
    const aspectRatio = ASPECT_RATIO[body.type];

    // Step 2: Generate image with Seedream 4.5 (create prediction)
    const response = await fetch(REPLICATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${replicateToken}`,
      },
      body: JSON.stringify({
        input: {
          prompt: finalPrompt,
          aspect_ratio: aspectRatio,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Replicate prediction request failed', errorText, {
        source: 'image-generation',
        operation: 'replicate-create',
        details: { status: response.status, type: body.type },
      });
      return NextResponse.json({ error: `Replicate error: ${errorText}` }, { status: response.status });
    }

    const prediction = await response.json();

    // Step 3: Poll for completion (max 60 seconds)
    const pollUrl = prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`;
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds
    let completedPrediction = prediction;

    while (attempts < maxAttempts) {
      if (completedPrediction.status === 'succeeded') break;
      if (completedPrediction.status === 'failed' || completedPrediction.status === 'canceled') {
        logError(`Replicate prediction ${completedPrediction.status}`, completedPrediction.error || 'Unknown error', {
          source: 'image-generation',
          operation: 'replicate-poll',
          details: { status: completedPrediction.status, attempts, type: body.type },
        });
        return NextResponse.json({
          error: `Image generation ${completedPrediction.status}: ${completedPrediction.error || 'Unknown error'}`
        }, { status: 500 });
      }

      // Wait 1 second before polling
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;

      const pollRes = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${replicateToken}` },
      });

      if (!pollRes.ok) {
        logError('Failed to poll Replicate prediction status', `HTTP ${pollRes.status}`, {
          source: 'image-generation',
          operation: 'replicate-poll',
          details: { attempts, type: body.type },
        });
        return NextResponse.json({ error: 'Failed to poll prediction status' }, { status: 500 });
      }

      completedPrediction = await pollRes.json();
    }

    if (completedPrediction.status !== 'succeeded') {
      logWarning('Image generation timed out', `status=${completedPrediction.status} after ${attempts} attempts`, {
        source: 'image-generation',
        operation: 'replicate-poll',
        details: { attempts, maxAttempts, type: body.type },
      });
      return NextResponse.json({ error: 'Image generation timed out' }, { status: 500 });
    }

    const replicateUrl = Array.isArray(completedPrediction.output) ? completedPrediction.output[0] : completedPrediction.output;

    if (!replicateUrl) {
      logError('Empty output from Replicate', JSON.stringify(completedPrediction).slice(0, 500), {
        source: 'image-generation',
        operation: 'replicate-result',
        details: { type: body.type },
      });
      return NextResponse.json({ error: 'No image URL in completed prediction' }, { status: 500 });
    }

    logInfo(`Image generated successfully`, {
      source: 'image-generation',
      operation: 'success',
      details: { type: body.type, durationMs: Date.now() - startedAt, attempts, ...(mapView ? { mapView } : {}) },
    });
    // Return the Replicate URL directly - client will download and store in
    // IndexedDB. The constructed prompts ride along so the client can log the
    // REAL image-gen instructions (system + cartographer + final image prompt),
    // not just the request body.
    return NextResponse.json({ imageUrl: replicateUrl, visualPrompt, systemPrompt, userPrompt, finalPrompt, mapView });
  } catch (err) {
    logError('Image generation failed', err, {
      source: 'image-generation',
      operation: 'request',
      details: { durationMs: Date.now() - startedAt },
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
