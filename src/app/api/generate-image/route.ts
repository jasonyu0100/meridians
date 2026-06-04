// POST /api/generate-image — proxy to OpenRouter (prompt) + Replicate (Seedream) for map/region images.

import { NextRequest, NextResponse } from 'next/server';
import { resolveKey } from '@/lib/core/resolve-api-key';
import { DEFAULT_MODEL } from '@/lib/constants';
import { logError, logInfo, logWarning } from '@/lib/core/system-logger';
import { buildMapImagePrompts, type MapRegion, type MapScale } from '@/lib/prompts/image/map';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REPLICATE_URL = 'https://api.replicate.com/v1/models/bytedance/seedream-4.5/predictions';

type ImageRequest =
  | { type: 'character'; name: string; role: string; worldSummary: string; continuityHints: string[]; imagePrompt?: string; imageStyle?: string }
  | { type: 'location'; name: string; parentName?: string; worldSummary: string; continuityHints: string[]; imagePrompt?: string; imageStyle?: string }
  | { type: 'artifact'; name: string; significance: string; ownerName?: string; worldSummary: string; continuityHints: string[]; imagePrompt?: string; imageStyle?: string }
  | { type: 'map'; name: string; regions: MapRegion[]; imagePrompt?: string; imageStyle?: string; scale?: MapScale };

/** Composition guidance per image type (maps use the flat-map directive baked
 *  into the shared `buildMapImagePrompts`; this entry is the short final-prompt
 *  fallback). */
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

/** Use LLM to craft a rich visual description for image generation. Returns the
 *  crafted `prompt` plus the `systemPrompt` / `userPrompt` that produced it, so
 *  callers can surface the real prompts in the API log (the request body alone
 *  hides the actual image-gen instructions). Maps are normally crafted on the
 *  client through the trackable callGenerate path and arrive here as a ready
 *  `imagePrompt`; the map branch below is the fallback when none rides in (it
 *  reuses the shared `buildMapImagePrompts` so there's no prompt drift). */
async function describeVisually(
  openrouterKey: string,
  request: ImageRequest,
): Promise<{ prompt: string; systemPrompt?: string; userPrompt?: string }> {
  // If an imagePrompt already exists, use it directly
  if (request.imagePrompt) {
    return { prompt: request.imagePrompt };
  }

  let systemPrompt: string;
  let userPrompt: string;
  if (request.type === 'map') {
    // Fallback only — the board prompt is normally crafted client-side. Maps are
    // rendered fully textless (image models garble baked text); the shared
    // builder bakes that in and the final image prompt re-states the guards.
    ({ system: systemPrompt, user: userPrompt } = buildMapImagePrompts(request));
  } else {
    const styleDirective = request.imageStyle
      ? `\nIMPORTANT: The entire image MUST be rendered in this visual style, applied consistently to every element: ${request.imageStyle}.`
      : '';
    systemPrompt = `You are a visual description specialist. Given narrative context, produce a single concise image generation prompt (2-3 sentences max). Focus on visual details: appearance, clothing, atmosphere, lighting, color palette. Never include text, words, or watermarks in the description. Output ONLY the prompt, nothing else.${styleDirective}

COMPOSITION: ${COMPOSITION[request.type]}`;

    if (request.type === 'character') {
      userPrompt = `Create a character portrait prompt for "${request.name}" (role: ${request.role}) in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
    } else if (request.type === 'location') {
      const parent = request.parentName ? ` (inside ${request.parentName})` : '';
      userPrompt = `Create an establishing shot prompt for the location "${request.name}"${parent} in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
    } else {
      const owner = request.ownerName ? ` (owned by ${request.ownerName})` : '';
      userPrompt = `Create an object study prompt for the artifact "${request.name}" (${request.significance})${owner} in this world: ${request.worldSummary}. Context clues: ${request.continuityHints.join('; ') || 'none'}.`;
    }
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
    // Every map is a flat, top-down map; `scale` only picks the cartographic
    // vocabulary (world / region / settlement / site).
    const isMap = body.type === 'map';
    const mapScale = body.type === 'map' ? (body.scale ?? null) : null;
    logInfo(`Image generation request received`, {
      source: 'image-generation',
      operation: 'request',
      details: { type: body.type, hasCustomStyle: !!body.imageStyle, ...(isMap ? { mapScale } : {}) },
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
    // For maps the style directives are already baked into `visualPrompt` by the
    // cartographer prompts, but the image model still needs the two hard guards
    // re-stated directly in the FINAL prompt or it drifts: (1) flat, top-down,
    // one cohesive map, (2) NO text. Kept short so the prompt stays well under
    // the image API's 4000-char cap.
    const parts: string[] = [];
    if (body.imageStyle) parts.push(body.imageStyle);
    parts.push(visualPrompt);
    if (isMap) {
      parts.push('One flat map seen from directly overhead — no perspective, no tilt, no 3D, no raised buildings, no cast shadows, no horizon, no sky. It is one continuous, seamless surface: regions flow into one another through soft natural transitions, not hard outlines, separate tiles, panels or insets');
      parts.push('No text anywhere on the image — no labels, place names, letters, numbers or calligraphy; every label is added by hand afterward');
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
      details: { type: body.type, durationMs: Date.now() - startedAt, attempts, ...(isMap ? { mapScale } : {}) },
    });
    // Return the Replicate URL directly - client will download and store in
    // IndexedDB. The constructed prompts ride along so the client can log the
    // REAL image-gen instructions (system + cartographer + final image prompt),
    // not just the request body.
    return NextResponse.json({ imageUrl: replicateUrl, visualPrompt, systemPrompt, userPrompt, finalPrompt, mapView: mapScale });
  } catch (err) {
    logError('Image generation failed', err, {
      source: 'image-generation',
      operation: 'request',
      details: { durationMs: Date.now() - startedAt },
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
