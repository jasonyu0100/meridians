// experience-report.ts — AI rehearsal/experience report. A small RAG: given the
// scene the room faces (the reference) and the TOP prior-knowledge matches from
// the cumulative branch history (their summaries + similarity + whether they
// were simulated on another branch + their own prior), the LLM judges — have we
// seen / rehearsed / experienced something like this before, and how prepared
// are we? Streams reasoning + report so both can be shown and persisted.

import { callGenerateStream } from './api';
import { GENERATE_MODEL } from '@/lib/constants';

export interface ReportMatch {
  summary: string;
  similarity: number; // 0–1
  offBranch: boolean; // simulated on a different branch (a rehearsal of this future)
  prior: number;      // 0–100 the matched scene's own prior knowledge
}

const SYSTEM = `You are the room's experience analyst. You decide, from prior play, whether the room has REHEARSED or EXPERIENCED a situation like the one it now faces, and how prepared it therefore is.

You are doing retrieval-augmented judgement: the SITUATION NOW is the reference, and the PRIOR MATCHES are the most similar moments retrieved from the cumulative branch history. Ground every claim in those retrieved summaries — cite them by their resemblance, don't invent matches.

A match on ANOTHER branch is a simulation of this future — a rehearsal — and weighs heavily; a match on the same branch is an in-story echo. Similarity is the strength of the resemblance. Be concrete and honest: high-similarity, cross-branch, recent matches = genuinely prepared; weak or absent matches = this is largely unrehearsed and the room is improvising.

Write 2–4 tight paragraphs: (1) a one-line verdict on preparedness, (2) what specifically we have rehearsed that resembles this, citing the matched moments, (3) the blind spots — what about this moment we have NOT seen before. No preamble, no headings, plain prose.`;

function buildPrompt(sceneSummary: string, matches: ReportMatch[]): string {
  const matchBlock = matches.length
    ? matches
        .map((m, i) =>
          `${i + 1}. [${Math.round(m.similarity * 100)}% similar · ${m.offBranch ? 'OTHER branch (rehearsal)' : 'same branch'} · its prior knowledge ${m.prior}] ${m.summary}`,
        )
        .join('\n')
    : '(no prior matches — nothing resembling this has been played before)';

  return `<situation-now hint="The reference — the scene the room faces right now.">
${sceneSummary}
</situation-now>

<prior-matches hint="The scenes from the cumulative branch history most similar to the situation now, strongest first. This is the retrieved context.">
${matchBlock}
</prior-matches>

<task>Judge whether the room has rehearsed or experienced something like the situation now, and how prepared it is. Follow the system instructions.</task>`;
}

/** Generate the rehearsal/experience report for one scene + its top matches.
 *  Streams: onToken receives report prose, onReasoning receives the thinking
 *  trace. Resolves to the final report text. */
export async function generateExperienceReport(args: {
  sceneSummary: string;
  matches: ReportMatch[];
  onToken?: (t: string) => void;
  onReasoning?: (t: string) => void;
}): Promise<string> {
  const { sceneSummary, matches, onToken, onReasoning } = args;
  const prompt = buildPrompt(sceneSummary, matches);
  const text = await callGenerateStream(
    prompt,
    SYSTEM,
    (t) => onToken?.(t),
    700,
    'generateExperienceReport',
    GENERATE_MODEL,
    1024, // reasoning budget — surface the analyst's reasoning
    (t) => onReasoning?.(t),
  );
  return text.trim();
}
