import { NextRequest, NextResponse } from 'next/server';
import { resolveKey } from '@/lib/resolve-api-key';
import { DEFAULT_MODEL, MAX_TOKENS_DEFAULT, DEFAULT_TEMPERATURE } from '@/lib/constants';
import { logError } from '@/lib/system-logger';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function POST(req: NextRequest) {
  const apiKey = resolveKey(req, 'x-openrouter-key', 'OPENROUTER_API_KEY');
  if (!apiKey) {
    return NextResponse.json({ error: 'OpenRouter API key required' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { prompt, systemPrompt, model, maxTokens, stream, temperature, reasoningBudget, jsonMode, websearch } = body as {
      prompt: string;
      systemPrompt?: string;
      model?: string;
      maxTokens?: number;
      stream?: boolean;
      temperature?: number;
      reasoningBudget?: number;
      jsonMode?: boolean;
      websearch?: { maxResults: number; maxTotalResults?: number };
    };

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Narrative Engine',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: [
          ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
          { role: 'user' as const, content: prompt },
        ],
        temperature: temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: maxTokens || MAX_TOKENS_DEFAULT,
        ...(stream ? { stream: true } : {}),
        // OpenRouter's unified reasoning config. `enabled: true` is the
        // universal opt-in (Gemini 2.5 Flash needs this — without it the
        // model runs non-thinking and emits no reasoning deltas at all,
        // which is why plan was silently empty while prose / game worked).
        // `max_tokens` is the budget hint; OpenRouter rejects sending both
        // `max_tokens` and `effort` together, so we use max_tokens only and
        // rely on `enabled: true` to engage providers that don't honour the
        // budget directly.
        ...(reasoningBudget && reasoningBudget > 0
          ? {
              reasoning: {
                enabled: true,
                max_tokens: reasoningBudget,
              },
            }
          : {}),
        // OpenRouter server tools — web_search grounds generation in current
        // public info, web_fetch lets the model deepen its read of any URL.
        // The two are paired so the model can decide whether to search or
        // fetch as it generates. `max_results` caps results per individual
        // search call; `max_total_results` caps total across all calls in
        // this request, bounding cost in agentic loops. Docs:
        //   https://openrouter.ai/docs/guides/features/server-tools/web-search
        //   https://openrouter.ai/docs/guides/features/server-tools/web-fetch
        ...(websearch && websearch.maxResults > 0
          ? {
              tools: [
                {
                  type: 'openrouter:web_search',
                  parameters: {
                    max_results: websearch.maxResults,
                    ...(websearch.maxTotalResults && websearch.maxTotalResults > 0
                      ? { max_total_results: websearch.maxTotalResults }
                      : {}),
                  },
                },
                { type: 'openrouter:web_fetch' },
              ],
            }
          : {}),
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('OpenRouter request failed', errorText, {
        source: 'api',
        operation: 'openrouter-call',
        details: { status: response.status, model: model || DEFAULT_MODEL, stream: !!stream },
      });
      return NextResponse.json({ error: `OpenRouter error: ${errorText}` }, { status: response.status });
    }

    // Streaming mode: pipe SSE chunks through to client
    if (stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'No response body' })}\n\n`));
            controller.close();
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') {
                  if (trimmed === 'data: [DONE]') {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  }
                  continue;
                }
                if (trimmed.startsWith('data: ')) {
                  try {
                    const chunk = JSON.parse(trimmed.slice(6));
                    const delta = chunk.choices?.[0]?.delta;
                    const token = delta?.content ?? '';
                    // Forward reasoning tokens separately so the client can capture them
                    const reasoning = delta?.reasoning ?? '';
                    if (token) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
                    }
                    if (reasoning) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ reasoning })}\n\n`));
                    }
                    // Forward usage data from final chunk (OpenRouter includes it in the last message)
                    if (chunk.usage) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        usage: {
                          promptTokens: chunk.usage.prompt_tokens ?? null,
                          completionTokens: chunk.usage.completion_tokens ?? null,
                        }
                      })}\n\n`));
                    }
                  } catch {
                    // skip malformed chunks
                  }
                }
              }
            }
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Non-streaming mode: existing behavior
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    // Extract reasoning content if present (OpenRouter returns it in message.reasoning or reasoning_details)
    const message = data.choices?.[0]?.message;
    const reasoning = message?.reasoning
      ?? message?.reasoning_content
      ?? (Array.isArray(message?.reasoning_details) ? message.reasoning_details.map((d: { content?: string }) => d.content ?? '').join('') : null);
    const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? null;
    // Return actual token usage from OpenRouter
    const usage = data.usage ? {
      promptTokens: data.usage.prompt_tokens ?? null,
      completionTokens: data.usage.completion_tokens ?? null,
    } : null;
    return NextResponse.json({ content, ...(reasoning ? { reasoning } : {}), ...(reasoningTokens != null ? { reasoningTokens } : {}), ...(usage ? { usage } : {}) });
  } catch (err) {
    logError('OpenRouter handler crashed', err, {
      source: 'api',
      operation: 'generate-handler',
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
