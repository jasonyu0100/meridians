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
  /** The ONE cartographer directive (the style line is appended after it). The
   *  textless + distinct-coverage rules are restated in the final image prompt
   *  (see POST), so they live there once, not duplicated per view. */
  system: string;
  /** View-specific note on how to use each sub-region's description (a SPECIFIC,
   *  per-instance instruction for the user prompt — not the high-level viewpoint,
   *  which lives in `system`). */
  userGuidance: () => string;
}

const MAP_VIEWS: Record<MapViewId, MapView> = {
  terrain: {
    label: 'Top-down terrain',
    whenToUse: 'Geographic scale — a world, continent, kingdom, region, or stretch of wilderness whose sub-regions are LANDS (mountains, forests, provinces, seas, deserts). The default for anything larger than a single settlement.',
    system: "You write one image-gen prompt (3-4 sentences) for a FLAT 2D TOP-DOWN MAP in the specified art style: strict orthographic overhead view, like a printed atlas page laid flat — ZERO perspective/isometric/3D, no standing mountains or buildings, no shadows, no horizon, no sky. Open by naming it a flat top-down 2D map in the art style. Each sub-region is a flat, clearly-bordered, visually DISTINCT area drawn as map symbology (ridge-shading, textured fills, flat colour). Use each region's description ONLY for its biome/terrain — discard its camera/lighting words. The whole reads as ONE seamless continuous landmass (no tiles, panels or gaps); arrange sub-regions for visual appeal. Output ONLY the prompt.",
    userGuidance: () => `Use each region's description ONLY for its biome/terrain; discard its camera/lighting language.`,
  },
  isometric: {
    label: 'Isometric bird\'s-eye',
    whenToUse: 'Settlement or compound scale — a village, town, campus, monastery, market, or walled compound whose sub-regions are distinct BUILDINGS, courtyards, or districts spread across grounds. Best seen from above at a three-quarter angle.',
    system: "You write one image-gen prompt (3-4 sentences) for an ILLUSTRATED ISOMETRIC BIRD'S-EYE MAP in the specified art style: one cohesive site at a high three-quarter angle (~45°), like a hand-painted game map or scale model. Open by naming it an isometric bird's-eye map in the art style. Lay every sub-region on ONE shared ground plane under one light direction, each a DISTINCT, recognisable structure / courtyard / district joined by paths, walls and water into one unbroken place (no floating tiles or gaps). Use each region's description for its architecture, materials and surroundings; place sensibly. Output ONLY the prompt.",
    userGuidance: () => `Use each region's description for its architecture, materials and immediate surroundings.`,
  },
  floorplan: {
    label: 'Top-down floor plan',
    whenToUse: 'A single building or one level of it whose sub-regions are ROOMS, halls, or chambers on the SAME floor — best seen straight down as an architectural floor plan with walls, doorways and thresholds.',
    system: "You write one image-gen prompt (3-4 sentences) for an ORTHOGRAPHIC TOP-DOWN FLOOR PLAN in the specified art style: seen straight down from overhead, like a blueprint or dungeon map (no perspective, no 3D). Open by naming it a top-down floor plan in the art style. Lay every sub-region as a DISTINCT walled ROOM / hall / chamber on ONE continuous floor, separated by solid walls with doorways, so circulation makes sense. Use each room's description for its function, fixtures and materials. Output ONLY the prompt.",
    userGuidance: () => `Use each room's description for its function, fixtures and materials; lay rooms out so circulation makes sense.`,
  },
  cutaway: {
    label: 'Side-on cutaway',
    whenToUse: 'A vertical or multi-level structure whose sub-regions STACK by height or depth — a tower\'s floors, a ship\'s decks, a dungeon\'s levels, a multi-storey building, a mine or cave system descending underground. Seen from the side with the near wall cut away to reveal the interior.',
    system: "You write one image-gen prompt (3-4 sentences) for a SIDE-ON CROSS-SECTION (cutaway / x-ray elevation) in the specified art style: seen front-on at eye level with the near wall removed to reveal the interior, like a dollhouse or cutaway of a ship/tower/dungeon. Open by naming it a side-on cutaway cross-section in the art style. Stack every sub-region by its TRUE position (upper floors high, cellars low, fore/aft preserved), each a DISTINCT compartment divided by visible floors and walls into one continuous cut-through structure. Use each region's description for its contents, fixtures and materials. Output ONLY the prompt.",
    userGuidance: () => `Stack sub-regions by true height/depth (upper floors high, cellars low); use each description for its contents, fixtures and materials.`,
  },
  diagram: {
    label: 'Schematic diagram',
    whenToUse: 'ONLY when the place is NON-PHYSICAL or has no meaningful spatial layout — an abstract realm, a network, a dream or spirit world, a political or organisational structure — where the sub-regions are domains/nodes best shown as a clean connected diagram rather than a literal map.',
    system: "You write one image-gen prompt (3-4 sentences) for a CLEAN SCHEMATIC MAP-DIAGRAM in the specified art style: sub-regions as DISTINCT bounded nodes connected by clear links into one cohesive composition on a single backdrop. Open by naming it a clean schematic diagram in the art style. Every node is individually recognisable and visually separated, yet connected into one whole (no random scatter, no separate panels). Use each region's description for its motif, colour and form. Output ONLY the prompt.",
    userGuidance: () => `Draw sub-regions as distinct bounded nodes connected by clear links; use each description for its motif, colour and form.`,
  },
};

/** Composition guidance per image type (map uses the terrain default; the real
 *  map composition is chosen per view at the call sites via `MAP_VIEWS`). */
const COMPOSITION: Record<ImageRequest['type'], string> = {
  character: 'Single character portrait, head and shoulders, one subject only',
  location: 'Wide establishing shot, architectural or landscape composition',
  artifact: 'Single object study, isolated subject centred in frame, clear silhouette, museum-lit presentation',
  map: 'A clean, textless top-down map',
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

/** Count the real sub-regions (the root frames the board, not a sub-region) so
 *  the prompt can demand distinct coverage of all of them. */
function countSubRegions(regions: MapRegion[]): number {
  const names = new Set(regions.map((r) => r.name));
  return regions.filter((r) => r.parentName && names.has(r.parentName)).length;
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
    ? `${view.system}${styleDirective}`
    : `You are a visual description specialist. Given narrative context, produce a single concise image generation prompt (2-3 sentences max). Focus on visual details: appearance, clothing, atmosphere, lighting, color palette. Never include text, words, or watermarks in the description. Output ONLY the prompt, nothing else.${styleDirective}

COMPOSITION: ${COMPOSITION[request.type]}`;

  let userPrompt: string;
  if (request.type === 'character') {
    userPrompt = `Create a character portrait prompt for "${request.name}" (role: ${request.role}) in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
  } else if (request.type === 'location') {
    const parent = request.parentName ? ` (inside ${request.parentName})` : '';
    userPrompt = `Create an establishing shot prompt for the location "${request.name}"${parent} in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
  } else if (request.type === 'map') {
    const subRegionCount = countSubRegions(request.regions);
    // The SPECIFICS: this place, its sub-regions, how to read their descriptions,
    // and the two hard rules (distinct coverage + no text). The high-level view
    // rules live in the system prompt.
    userPrompt = `Map of "${displayLabel(request.name)}" and its ${subRegionCount} sub-regions. ${view.userGuidance()}
Sub-regions (names are for YOUR layout reasoning only — NEVER write them on the image):
${describeMapStructure(request.regions)}
CRITICAL: render ONE cohesive, continuous map (a single unified scene, not separate tiles or panels) that contains all ${subRegionCount} sub-regions — each present and identifiable in its own area, yet flowing together into one coherent whole; none omitted.
CRITICAL: ABSOLUTELY NO TEXT anywhere (no names, labels, letters, numbers, calligraphy) and no pins, markers or symbols — a clean illustration; labels are added by hand afterward.`;
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
    // For maps the full view directives are already baked into `visualPrompt` by
    // the cartographer prompts, but the image model still needs the two hard
    // guards re-stated directly in the FINAL prompt or it ignores them:
    // (1) ONE cohesive map that still contains every sub-region, (2) NO text.
    // Kept short so the prompt stays well under the image API's 4000-char cap.
    const parts: string[] = [];
    if (body.imageStyle) parts.push(body.imageStyle);
    parts.push(visualPrompt);
    if (mapView) {
      parts.push('ONE single cohesive, continuous map — a unified scene, NOT a grid of tiles, panels, insets or vignettes, no gaps or seams. All the named sub-regions are present within that one map, each identifiable in its own area but flowing naturally into its neighbours as part of the same whole');
      parts.push('ABSOLUTELY NO TEXT anywhere on the image — no labels, place names, titles, letters, numbers, calligraphy or CJK characters; no pins, markers, dots or symbols either. A clean, completely textless illustration — every label is overlaid by hand afterward');
    } else {
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
