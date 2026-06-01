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

/** Composition guidance per image type */
const COMPOSITION: Record<ImageRequest['type'], string> = {
  character: 'Single character portrait, head and shoulders, one subject only',
  location: 'Wide establishing shot, architectural or landscape composition',
  artifact: 'Single object study, isolated subject centred in frame, clear silhouette, museum-lit presentation',
  map: 'A FLAT 2D TOP-DOWN MAP in strict orthographic overhead projection — seen from directly above at a 90° angle, like a printed atlas page laid flat on a table. The overriding rule: ZERO perspective, ZERO isometric or oblique angle, ZERO 3D, ZERO vanishing point. Nothing is drawn standing or seen from the side — no 3D mountains, no buildings in elevation, no objects, no cast shadows, no depth, no horizon, no sky. All terrain is flat map symbology: ridge-shading for mountains, flat textured fills for forest, flat colour for water/ice/plains, flat plan-view marks for any structure. Rendered in the specified art style as a painterly but completely FLAT map — richness comes from the painted fills, never from 3D or perspective. ONE single seamless continuous landmass filling the frame, framed by a single thin outer border; sub-regions are clearly-bordered, visually DISTINCT flat areas within it, separated only by painted borders, rivers, coastlines or ridgelines, with terrain flowing continuously across them. NO separate tiles, hexes, panels, insets or vignettes, NO gaps, NO seams. Show ONLY this territory and its sub-regions — NO compass rose, NO extra lands. ABSOLUTELY NO TEXT anywhere on the image: no title, labels, place names, letters, numbers, calligraphy, banners, ribbons, markers, pins or watermarks — every label is added separately afterward.',
};

/** Aspect ratio per image type */
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
    // drawn as a CLOSED bordered area physically enclosing those children, all
    // the way down. The root (depth 0) is the outermost frame of the whole map.
    const role = depth === 0
      ? `THE WHOLE MAP — outermost encompassing territory enclosing every other region; its border is the outer frame around the entire map, with all ${kidCount} nested inside it`
      : kids.length > 0
        ? `${kind} — a closed bordered flat area drawn INSIDE its parent, itself enclosing its own ${kidCount}`
        : `${kind} — a small flat area inside its parent`;
    const lines = [`${indent}- "${label}" (${role})${look}`];
    for (const kid of kids) lines.push(...render(kid, depth + 1));
    return lines;
  };

  // Roots = regions with no in-scope parent (normally just the territory root).
  const names = new Set(regions.map((r) => r.name));
  const roots = regions.filter((r) => !r.parentName || !names.has(r.parentName));
  return roots.flatMap((r) => render(r, 0)).join('\n');
}

/** Use LLM to craft a rich visual description for image generation */
async function describeVisually(openrouterKey: string, request: ImageRequest): Promise<string> {
  // If an imagePrompt already exists, use it directly
  if (request.imagePrompt) {
    return request.imagePrompt;
  }

  const styleDirective = request.imageStyle
    ? `\nIMPORTANT: The entire image MUST be rendered in this visual style, applied consistently to every element: ${request.imageStyle}.`
    : '';

  // Maps are rendered fully textless — image models garble baked text (and
  // invent nonsense calligraphy in stylised work). The title and every region
  // label are HTML overlays placed afterward, so the prompt forbids ALL text.
  const systemPrompt = request.type === 'map'
    ? `You are a cartographic description specialist. Given a territory and its sub-regions, produce a single image generation prompt (3-4 sentences) for a FLAT 2D TOP-DOWN MAP rendered in the specified art style. The viewpoint rule overrides everything: seen from DIRECTLY ABOVE in strict orthographic projection, like a printed atlas page laid flat — ZERO perspective, ZERO isometric/oblique angle, ZERO 3D, no standing mountains, no buildings in elevation, no cast shadows, no horizon, no sky. Open by stating it is a flat top-down 2D map in the named art style. Each sub-region is a flat, clearly-bordered, visually DISTINCT area: depict its terrain as flat map symbology only — ridge-shading for mountains, flat textured fills for forest, flat colour for water/ice/plains, flat plan-view marks for any structure. Each sub-region below comes with a 3D establishing-shot description — use it ONLY to choose the BIOME/TERRAIN TYPE; DISCARD every word about camera, perspective, lighting, framing or depth, and render a flat overhead area. The map must read as ONE seamless continuous landmass, not a grid of tiles: sub-regions separated only by painted borders/rivers/ridgelines with terrain flowing across them — never tiles, hexes, panels or vignettes, never gaps. Arrange the sub-regions for visual appeal — you choose where each sits. CRITICAL — the image must contain ABSOLUTELY NO TEXT: no title, labels, place names, letters, numbers or calligraphy of any kind (all labels are overlaid afterward), so never instruct any writing to appear. The region names below are for YOUR layout reasoning only and must never be written on the map. Output ONLY the prompt, nothing else.${styleDirective}

COMPOSITION: ${COMPOSITION[request.type]}`
    : `You are a visual description specialist. Given narrative context, produce a single concise image generation prompt (2-3 sentences max). Focus on visual details: appearance, clothing, atmosphere, lighting, color palette. Never include text, words, or watermarks in the description. Output ONLY the prompt, nothing else.${styleDirective}

COMPOSITION: ${COMPOSITION[request.type]}`;

  let userPrompt: string;
  if (request.type === 'character') {
    userPrompt = `Create a character portrait prompt for "${request.name}" (role: ${request.role}) in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
  } else if (request.type === 'location') {
    const parent = request.parentName ? ` (inside ${request.parentName})` : '';
    userPrompt = `Create an establishing shot prompt for the location "${request.name}"${parent} in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
  } else if (request.type === 'map') {
    const mapTitle = displayLabel(request.name);
    userPrompt = `Create a FLAT 2D TOP-DOWN MAP prompt for the territory "${mapTitle}" and its sub-regions, rendered in the work's art style (named at the end). Strict orthographic overhead view — seen from directly above like a printed atlas page laid flat: NO perspective, NO isometric/oblique angle, NO 3D, no standing mountains or buildings, no shadows, no horizon, no sky. Region outline (each line is a region and a 3D-shot description of it — use that description ONLY to choose the BIOME/TERRAIN TYPE to paint; discard all its camera/perspective/lighting language and render the area flat and top-down as a clearly-bordered DISTINCT area; the names are for YOUR layout reasoning only and must NEVER be written on the map):\n${describeMapStructure(request.regions)}\nRender ONE single seamless continuous landmass filling the frame (not separate tiles, hexes or panels — sub-regions flow into each other across painted borders/rivers/ridgelines with no gaps), framed by a single outer border. The image must contain ABSOLUTELY NO TEXT of any kind — no title, names, labels, letters, numbers or calligraphy anywhere; every label is overlaid afterward.`;
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
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function POST(req: NextRequest) {
  const replicateToken = resolveKey(req, 'x-replicate-key', 'REPLICATE_API_TOKEN');
  const openrouterKey = resolveKey(req, 'x-openrouter-key', 'OPENROUTER_API_KEY');

  if (!replicateToken) return NextResponse.json({ error: 'Replicate API token required' }, { status: 401 });
  if (!openrouterKey) return NextResponse.json({ error: 'OpenRouter API key required' }, { status: 401 });

  const startedAt = Date.now();
  try {
    const body = await req.json() as ImageRequest;
    logInfo(`Image generation request received`, {
      source: 'image-generation',
      operation: 'request',
      details: { type: body.type, hasCustomStyle: !!body.imageStyle },
    });

    // Step 1: Get or craft the visual prompt
    const visualPrompt = await describeVisually(openrouterKey, body);
    if (!visualPrompt) {
      logWarning('Failed to generate visual description', 'empty visual prompt', {
        source: 'image-generation',
        operation: 'describe-visually',
        details: { type: body.type },
      });
      return NextResponse.json({ error: 'Failed to generate visual description' }, { status: 500 });
    }

    // Build prompt: style → subject → composition → safety (consistent across all types)
    // Style ALWAYS leads — even with custom imagePrompt — to ensure visual consistency
    const parts: string[] = [];
    if (body.imageStyle) parts.push(body.imageStyle);
    parts.push(visualPrompt);
    parts.push(COMPOSITION[body.type]);
    // Trailing guard. The map art is textless except its parent title (labels
    // are placed by hand afterwards), so the negative prompt forbids all other
    // writing and keeps the flat, seamless, distinct-region look.
    parts.push(body.type === 'map'
      ? 'FLAT 2D TOP-DOWN MAP, strict orthographic overhead view seen from directly above like a printed atlas page laid flat. NO perspective, NO isometric, NO oblique angle, NO 3D, NO standing mountains, NO buildings in elevation, NO cast shadows, NO depth, NO horizon, NO sky — flat map symbology only. One single seamless continuous landmass, sub-regions flowing across painted borders with no gaps, no separate tiles, hexes, panels or vignettes, no seams; each sub-region a clearly-bordered visually distinct flat area; only this territory and its sub-regions, no compass rose, no extra lands. ABSOLUTELY NO TEXT anywhere: no title, no labels, no place names, no letters, no numbers, no calligraphy, no Chinese or other CJK characters, no banners, ribbons, markers, pins, logos or watermarks'
      : 'No text, no letters, no watermarks');
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
      details: { type: body.type, durationMs: Date.now() - startedAt, attempts },
    });
    // Return the Replicate URL directly - client will download and store in IndexedDB
    return NextResponse.json({ imageUrl: replicateUrl, visualPrompt });
  } catch (err) {
    logError('Image generation failed', err, {
      source: 'image-generation',
      operation: 'request',
      details: { durationMs: Date.now() - startedAt },
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
