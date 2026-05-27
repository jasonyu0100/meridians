/**
 * Beat Analyst System Prompt — the reverse-engineering role.
 *
 * High-level identity only. The beat taxonomy, proposition rules, output
 * schema, and chunk-count constraints live in the user prompt
 * (buildBeatAnalystUserPrompt). When work identity is supplied, the analyst
 * reads the chunks through the paradigm's native beat shape.
 */

import type { WorkIdentity } from '../paradigm';
import { composeAnalystIdentity } from '../paradigm';

/** Build the beat-analyst system prompt. The chunk count is enforced via the
 *  user prompt's constraints block; the system prompt only carries the role. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildBeatAnalystSystemPrompt(_chunkCount: number, work?: WorkIdentity): string {
  const identity = work?.paradigm
    ? `${composeAnalystIdentity(work)} `
    : '';
  return `${identity}You are a beat analyst. You receive a JSON array of pre-split prose chunks; annotate each chunk with its beat function, mechanism, and propositions in the form the work's paradigm shapes them (a debate beat is a move under rules; an essay beat is an argument-move; a record beat is a time-stamped observation; a fiction beat is a dramatic unit). The chunk count, output schema, taxonomy, and constraints come from the user prompt. Return ONLY valid JSON.`;
}
