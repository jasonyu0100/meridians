/**
 * Branch Chat — multi-branch analytical chat.
 *
 * Lab tool for evaluating candidate branches at controlled windows. The user
 * selects N branches with per-branch scope (start..end entry indices), then
 * chats with an analyst that has all scoped windows in context.
 *
 * Register-agnostic by design: prompts describe analysis in engine primitives
 * (branch, entry, thread, delta, divergence, closure, pressure) and let the
 * model adapt vocabulary to whatever the source happens to be — fiction draft,
 * research paper, wargame simulation, essay, anything.
 *
 * v1 ships analytical chat. v2 will reuse the same scope primitives as
 * controlled-variable experiment knobs (vary one, hold others, generate
 * candidate continuations).
 */

import { ANALYSIS_TEMPERATURE, DEFAULT_MODEL, MAX_TOKENS_DEFAULT } from '@/lib/constants';
import type { NarrativeState } from '@/types/narrative';
import { resolveEntrySequence } from '@/lib/narrative-utils';
import { callGenerateStream, resolveReasoningBudget } from './api';

// ── Types ───────────────────────────────────────────────────────────────────

/** A scoped slice of a branch — 1-indexed inclusive entry range. */
export type BranchScope = {
  branchId: string;
  /** First entry index in scope (1-based). */
  start: number;
  /** Last entry index in scope (1-based, inclusive). */
  end: number;
};

export type BranchChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  /** Streamed reasoning tokens captured during the turn — assistant only.
   *  Persisted so the operator can re-expand prior thinking after the fact. */
  reasoning?: string;
  /** Wall-clock duration of the turn in ms — used to label collapsed
   *  reasoning ("Thought for 8s"). */
  durationMs?: number;
};

// ── Example queries ─────────────────────────────────────────────────────────
//
// Birdseye, register-agnostic prompts the operator can fire as a starting
// turn. The operator's primary interest is which branch makes the better
// continuation candidate — through a realism (plausibility) lens and through
// an engagement (compellingness) lens. The questions span both axes plus
// their tradeoff.

export const EXAMPLE_QUERIES: string[] = [
  "Which branch's trajectory is most plausible from here?",
  'Which branch is most compelling to continue from?',
  'What is the most likely next development in each branch?',
  'Where does each branch trade realism for engagement?',
  'Which branch sets up the richest future possibilities?',
];

// ── System prompt ───────────────────────────────────────────────────────────

const BRANCH_CHAT_SYSTEM = `You are an analyst comparing multiple branches of a long-form work at a birdseye level. Branches are parallel timelines. The operator has selected scoped windows on each branch and is interrogating them in a research-lab session.

Data discipline:
- You receive OUTLINES — scene summaries grouped by arc — not prose, not engine deltas, not state annotations. Reason about structural shape, divergence patterns, commitments, and outcome states. Do not invent engine-level details (thread evidence numbers, force values, delta counts) that aren't in the outline.

Register discipline:
- The work may be fiction, non-fiction (research paper, essay, report), wargame simulation, alternate-history, or anything else. NEVER impose fiction-specific framing — no "reader", "story", "author", "chapter", "narrator", "plot". Use engine primitives only: branch, entry, arc, scene, divergence, commitment, trajectory, outcome, terminal state.
- Match the source's voice. If a branch reads as analytical prose, sound analytical. If operational, sound operational. If narrative, sound narrative. The source dictates vocabulary; you do not.

Reasoning discipline:
- Anchor every comparative claim in concrete content from the outlines — what happened in that arc, which thread shifted, which commitment landed. Vague comparisons are useless to the operator.
- Build on prior turns; do not repeat earlier analysis verbatim.
- When the scope changed since the last turn, re-evaluate against the current windows — old conclusions may not hold.

Output discipline — write natural prose. The outline blocks are internal grounding for you; the operator reads only what you write. Refer to arcs, scenes, threads, and entities by their natural-language labels and the content from the summaries. Do NOT lean on internal ids (entry indices, scene ids, branch ids) as identifiers in the prose — use the branch's name and the arc / scene's substance ("in the alliance-fractures arc on Branch 2", "the scene where the protagonist refuses the deal"). A precise global index is welcome when the operator is asking about a specific position or two outlines diverge ambiguously; never as parentheticals after every noun. Brief attribution by branch + substance is the target — schema citation is not.

Format: clean markdown. Use H2/H3 headings only when the response has multiple parts. Length: thorough but compact. Intelligence per token, not throat-clearing.`;

// ── Context builder ─────────────────────────────────────────────────────────
//
// Outlines only. Per-branch slices are rendered as scene-summary outlines
// grouped by arc, with global entry indices preserved so the operator's
// citations match what they see in the column view. No deltas, no thread
// tags, no world counts — pure structural skeleton. This is what "birdseye"
// means in this system: same vantage a human reader of the summaries would
// have, no engine instrumentation.

function clampScope(scope: BranchScope, length: number): { start: number; end: number } {
  if (length === 0) return { start: 0, end: 0 };
  const start = Math.max(1, Math.min(scope.start, length));
  const end = Math.max(start, Math.min(scope.end, length));
  return { start, end };
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

/** Render one branch as a scope-windowed outline. Scene entries are grouped
 *  under their owning arc; world commits appear as standalone markers. Entry
 *  numbering uses the GLOBAL index within the branch (not a 1-based offset
 *  within the scope) so cross-references stay consistent. */
function renderBranchOutline(
  narrative: NarrativeState,
  branchId: string,
  scope: BranchScope,
): string {
  const branch = narrative.branches[branchId];
  const name = branch?.name ?? branchId;
  const seq = resolveEntrySequence(narrative.branches, branchId);
  const { start, end } = clampScope(scope, seq.length);

  const headerAttrs = `name="${escapeAttr(name)}" id="${branchId}" scope="${start}..${end}" branch-length="${seq.length}"`;
  if (start === 0 || seq.length === 0) {
    return `<branch ${headerAttrs}>\n  <empty />\n</branch>`;
  }

  // Pre-build arc lookup once.
  const arcForScene = new Map<string, string>();
  for (const arc of Object.values(narrative.arcs)) {
    for (const sid of arc.sceneIds) arcForScene.set(sid, arc.id);
  }

  type Section =
    | { kind: 'arc'; arcId: string | null; arcName: string; entries: string[] }
    | { kind: 'world-commit'; line: string };
  const sections: Section[] = [];
  const arcGroupMap = new Map<string, Section & { kind: 'arc' }>();

  for (let i = start - 1; i < end; i++) {
    const eid = seq[i];
    const globalIndex = i + 1;
    const wb = narrative.worldBuilds[eid];
    if (wb) {
      sections.push({
        kind: 'world-commit',
        line: `  <world-commit index="${globalIndex}">${wb.summary ?? eid}</world-commit>`,
      });
      continue;
    }

    const scene = narrative.scenes[eid];
    if (!scene) continue;

    const arcId = arcForScene.get(eid) ?? null;
    let group: Section & { kind: 'arc' };
    const groupKey = arcId ?? `_standalone_${globalIndex}`;
    if (arcGroupMap.has(groupKey)) {
      group = arcGroupMap.get(groupKey)!;
    } else {
      const arc = arcId ? narrative.arcs[arcId] : null;
      group = { kind: 'arc', arcId, arcName: arc?.name ?? 'Standalone', entries: [] };
      arcGroupMap.set(groupKey, group);
      sections.push(group);
    }

    const povName = scene.povId
      ? narrative.characters[scene.povId]?.name ?? scene.povId
      : 'narrator';
    const locName = narrative.locations[scene.locationId]?.name ?? scene.locationId;
    group.entries.push(
      `    <scene index="${globalIndex}" pov="${escapeAttr(povName)}" location="${escapeAttr(locName)}">${scene.summary ?? ''}</scene>`,
    );
  }

  const body = sections
    .map((s) => {
      if (s.kind === 'world-commit') return s.line;
      return `  <arc name="${escapeAttr(s.arcName)}">\n${s.entries.join('\n')}\n  </arc>`;
    })
    .join('\n');

  return `<branch ${headerAttrs}>\n${body}\n</branch>`;
}

/**
 * Build the multi-branch context payload. Per-branch outlines within the
 * operator's scope window, plus a shared-ancestry baseline (LCP across the
 * selected sequences) rendered as a terse summary list. Outlines preserve
 * global entry indices so analysis citations match the column view.
 */
export function buildBranchChatContext(
  narrative: NarrativeState,
  scopes: BranchScope[],
): string {
  if (scopes.length === 0) return '<branches />';

  const sequences = scopes.map((s) => ({
    scope: s,
    seq: resolveEntrySequence(narrative.branches, s.branchId),
  }));

  // Shared baseline = LCP across all selected sequences. Rendered as terse
  // summary lines, not full outlines — context only, not target of analysis.
  let lcp = 0;
  if (sequences.length > 1) {
    const min = Math.min(...sequences.map((s) => s.seq.length));
    while (lcp < min) {
      const v = sequences[0].seq[lcp];
      if (sequences.some((s) => s.seq[lcp] !== v)) break;
      lcp++;
    }
  }

  const baselineBlock = (() => {
    if (lcp === 0) return '';
    const baseline = sequences[0].seq.slice(0, lcp);
    const lines = baseline
      .map((eid, i) => {
        const wb = narrative.worldBuilds[eid];
        const summary = wb
          ? wb.summary
          : narrative.scenes[eid]?.summary ?? '';
        return `${i + 1}. ${summary.slice(0, 200)}`;
      });
    return `<shared-baseline hint="Entries shared across all selected branches before divergence. Context only — not the analysis target.">\n${lines.join('\n')}\n</shared-baseline>`;
  })();

  const branchBlocks = scopes.map((scope) =>
    renderBranchOutline(narrative, scope.branchId, scope),
  );

  return [baselineBlock, ...branchBlocks].filter(Boolean).join('\n\n');
}

// ── Streaming turn ──────────────────────────────────────────────────────────

/**
 * Run one branch-chat turn. Builds the full context for the current scopes,
 * serialises prior conversation, fires the new user turn against the LLM
 * with streaming. Returns the assistant's complete response.
 *
 * Caller is responsible for appending the result to the conversation state.
 */
export async function streamBranchChatTurn(opts: {
  narrative: NarrativeState;
  scopes: BranchScope[];
  history: BranchChatMessage[];
  newTurn: string;
  scopeChangedSinceLastTurn?: boolean;
  onToken: (token: string) => void;
  /** Streamed reasoning tokens (when the model exposes thinking/reasoning).
   *  Shown to the operator in real time so the analyst's thought process is
   *  visible during long turns. */
  onReasoning?: (token: string) => void;
}): Promise<string> {
  const { narrative, scopes, history, newTurn, scopeChangedSinceLastTurn, onToken, onReasoning } = opts;

  const branchContext = buildBranchChatContext(narrative, scopes);

  const conversationBlock = history.length === 0
    ? ''
    : `<conversation hint="Prior turns in this session. Build on them; do not repeat verbatim.">\n${history
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n')}\n</conversation>`;

  const scopeChangeNote = scopeChangedSinceLastTurn
    ? `<scope-change-notice>Scope was modified since the previous turn. Re-evaluate against the current scopes.</scope-change-notice>\n\n`
    : '';

  const userPrompt = [
    branchContext,
    conversationBlock,
    scopeChangeNote.trim(),
    `<turn>${newTurn}</turn>`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const reasoningBudget = resolveReasoningBudget(narrative);

  return callGenerateStream(
    userPrompt,
    BRANCH_CHAT_SYSTEM,
    onToken,
    MAX_TOKENS_DEFAULT,
    'branch-chat-turn',
    DEFAULT_MODEL,
    reasoningBudget,
    onReasoning,
    ANALYSIS_TEMPERATURE,
  );
}
