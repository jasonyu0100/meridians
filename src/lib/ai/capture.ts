/**
 * Driver entry generation.
 *
 * Produces a single Driver entry ({title, text}) from a user direction
 * prompt and, optionally, a source URL. When the narrative has web search
 * enabled, the model can fetch the URL via OpenRouter's web_fetch tool
 * and ground the entry in the page's content; when disabled, the URL is
 * ignored and generation runs offline.
 *
 * Intentionally context-free — the model writes from the direction alone,
 * not from the narrative's entities / threads / world. Driver entries are
 * an INGEST surface (operator capturing fragments INTO the narrative);
 * coupling them to the narrative's current state would bias what gets
 * captured against what's already known. Free-form preserves that
 * boundary; downstream synthesis is where narrative grounding kicks in.
 */

import type { NarrativeState } from '@/types/narrative';
import { callGenerate, resolveWebsearch } from './api';
import { parseJson } from './json';
import { logError, logInfo } from '@/lib/core/system-logger';

const PRIOR_ENTRY_SYSTEM = `You produce a single Driver ENTRY — a short, structured fragment of thought captured into an operator's daily-ingest workspace.

OUTPUT FIELDS (strict JSON, no other keys):
- title — a brief structural anchor (3–8 words). Names the entry's substance; not a sentence.
- text  — the body. Structured thought, not stream-of-consciousness. Markdown allowed; concise paragraphs or bullets where they help.

INPUT CONTRACT:
- <direction> — what the operator wants captured. Always present unless only a URL is given.
- <source-url> — a page to draw from. When present, you MUST call the \`web_fetch\` tool with that URL as your FIRST action. Do NOT compose the entry from prior knowledge of the URL; fetch the live page and synthesise from the returned content. Failing to fetch when a URL is provided is a hard failure — the entry will be wrong because the page is the operator's source of truth, not your training data.

COMBINATION RULES (after any fetch completes):
- direction + URL → an EXTRACTION from the fetched page, framed by the direction. The direction is the editorial lens; the page is the source material.
- direction only → write to the direction. You may call web_search if the direction names a current event you don't have reliable training-data coverage of; otherwise skip tools.
- URL only → treat the URL as both source and direction. Fetch, then extract its key substance into an entry.

DISCIPLINE:
- Substance over framing. No "this article discusses…", no "in this entry…". Lead with the claim, the observation, the fact, the question.
- When extracting from a fetched page, paraphrase and condense — do not quote at length, do not echo headlines.
- One entry per call. No preamble, no scaffolding. Output ONLY the JSON object: {"title": "...", "text": "..."}.`;

export async function generatePrior(
  narrative: NarrativeState | null | undefined,
  direction: string,
  sourceUrl?: string,
): Promise<{ title: string; text: string }> {
  const trimmedDirection = direction.trim();
  const trimmedUrl = sourceUrl?.trim() || undefined;
  if (!trimmedDirection && !trimmedUrl) {
    throw new Error('generatePrior: direction or sourceUrl required');
  }

  logInfo('Generating driver entry', {
    source: 'ingest',
    operation: 'generate-driver-entry',
    details: {
      narrativeId: narrative?.id,
      hasDirection: !!trimmedDirection,
      hasUrl: !!trimmedUrl,
    },
  });

  const userPrompt = [
    trimmedDirection ? `<direction>${escapeXml(trimmedDirection)}</direction>` : '',
    trimmedUrl
      ? `<source-url fetch="required">${escapeXml(trimmedUrl)}</source-url>\n\nCall web_fetch on the URL above before composing the entry — do not rely on prior knowledge of the page.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  // Honour the narrative's websearchLevel so the operator's per-story
  // setting controls whether web_fetch is available for URL extraction.
  // When the narrative is null (no active story) or websearchLevel is
  // 'none', web tools are absent and any URL provided will be processed
  // from the model's prior knowledge of the URL — usually a bad result,
  // hence the URL field is gated in the UI to only appear when web is
  // enabled.
  const websearch = resolveWebsearch(narrative);

  let raw: string;
  try {
    raw = await callGenerate(
      userPrompt,
      PRIOR_ENTRY_SYSTEM,
      undefined,
      'generatePrior',
      undefined,
      undefined,
      true,
      undefined,
      websearch,
    );
  } catch (err) {
    logError('generatePrior call failed', err, {
      source: 'ingest',
      operation: 'generate-driver-entry',
    });
    throw err;
  }

  const parsed = parseJson(raw, 'generatePrior') as { title?: unknown; text?: unknown };
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  if (!text) {
    throw new Error('generatePrior: model returned no text');
  }
  return { title, text };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
