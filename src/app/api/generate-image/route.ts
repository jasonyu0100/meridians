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

/** The map treatment. Meridians supports exactly two map types: the RAW GRAPH
 *  map (the WorldGraph — drawn live from the substrate, never image-generated)
 *  and this BOARD-GAME STYLE map. Every generated map — a world, a region, a
 *  settlement, a building — renders as ONE cohesive board-game board: a
 *  hand-painted top-down strategy board whose sub-regions are distinct,
 *  clearly-bordered territories nested inside their parent and joined into one
 *  continuous whole. Nesting is handled by the map tree (drilling into a child
 *  opens that child's own board); within a single board, sub-regions are bounded
 *  areas. Labels are overlaid by hand afterward, so the board is rendered fully
 *  textless and every sub-region must stay individually identifiable. */
const MAP_BOARD_VIEW = {
  /** The ONE cartographer directive (the style line is appended after it). The
   *  textless + distinct-coverage rules are restated in the final image prompt
   *  (see POST), so they live there once. */
  system: "You write one image-gen prompt (3-4 sentences) for a BOARD-GAME STYLE MAP BOARD in the specified art style: one cohesive hand-painted top-down board, like a tabletop strategy game map laid flat — a single unified board, no perspective tiles, no standing 3D clutter, no shadows, no horizon, no sky. Open by naming it a flat top-down board-game style map board in the art style. Draw every sub-region as a distinct, clearly-bordered TERRITORY with its own fill/texture, each nested inside its parent's bounds and joined to its neighbours by borders, paths and water into ONE seamless board (no gaps, panels or floating tiles). Use each region's description ONLY for its terrain/character — discard its camera/lighting words. Arrange the territories for a balanced, readable board. Output ONLY the prompt.",
  /** Per-instance note for the user prompt (how to read each sub-region). */
  userGuidance: () => `Draw each sub-region as a distinct bordered territory nested inside its parent; use each region's description only for its look, not its camera/lighting.`,
};

/** Composition guidance per image type (maps use the board-game directive baked
 *  into `MAP_BOARD_VIEW`; this entry is the short final-prompt fallback). */
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
    // drawn as a CLOSED bounded territory physically enclosing those children,
    // all the way down. The root (depth 0) is the outermost extent of the whole
    // board.
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

/** Use LLM to craft a rich visual description for image generation. Maps always
 *  render as the single board-game style board (`MAP_BOARD_VIEW`). Returns the
 *  crafted `prompt` plus the `systemPrompt` / `userPrompt` that produced it, so
 *  callers can surface the real prompts in the API log (the request body alone
 *  hides the actual image-gen instructions). */
async function describeVisually(
  openrouterKey: string,
  request: ImageRequest,
): Promise<{ prompt: string; systemPrompt?: string; userPrompt?: string }> {
  // If an imagePrompt already exists, use it directly
  if (request.imagePrompt) {
    return { prompt: request.imagePrompt };
  }

  const styleDirective = request.imageStyle
    ? `\nIMPORTANT: The entire image MUST be rendered in this visual style, applied consistently to every element: ${request.imageStyle}.`
    : '';

  // Maps are rendered fully textless — image models garble baked text (and
  // invent nonsense calligraphy in stylised work). The title and every region
  // label are HTML overlays placed afterward, so the prompt forbids ALL text.
  const systemPrompt = request.type === 'map'
    ? `${MAP_BOARD_VIEW.system}${styleDirective}`
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
    userPrompt = `Map of "${displayLabel(request.name)}" and its ${subRegionCount} sub-regions. ${MAP_BOARD_VIEW.userGuidance()}
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
    // Maps always render as the single board-game style board.
    const isMap = body.type === 'map';
    logInfo(`Image generation request received`, {
      source: 'image-generation',
      operation: 'request',
      details: { type: body.type, hasCustomStyle: !!body.imageStyle, ...(isMap ? { mapView: 'board' } : {}) },
    });

    // Step 1: Get or craft the visual prompt
    const { prompt: visualPrompt, systemPrompt, userPrompt } = await describeVisually(openrouterKey, body);
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
    if (isMap) {
      parts.push('ONE single cohesive, continuous board-game style map board — a unified board, NOT a grid of tiles, panels, insets or vignettes, no gaps or seams. All the named sub-regions are present within that one board, each identifiable in its own bordered territory but flowing naturally into its neighbours as part of the same whole');
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
      details: { type: body.type, durationMs: Date.now() - startedAt, attempts, ...(isMap ? { mapView: 'board' } : {}) },
    });
    // Return the Replicate URL directly - client will download and store in
    // IndexedDB. The constructed prompts ride along so the client can log the
    // REAL image-gen instructions (system + cartographer + final image prompt),
    // not just the request body.
    return NextResponse.json({ imageUrl: replicateUrl, visualPrompt, systemPrompt, userPrompt, finalPrompt, mapView: isMap ? 'board' : null });
  } catch (err) {
    logError('Image generation failed', err, {
      source: 'image-generation',
      operation: 'request',
      details: { durationMs: Date.now() - startedAt },
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
