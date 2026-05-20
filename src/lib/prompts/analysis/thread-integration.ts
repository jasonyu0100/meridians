/**
 * Thread Integration Prompt (Daily-Driver only)
 *
 * The thread-integration pass is the heart of "make the file native"
 * for daily-driver ingests. Other entity types (characters / locations
 * / artifacts / system concepts) align cheaply by name or phrasing —
 * threads need real integration work because they're propositions, not
 * proper names, and a daily file is dominated by continuations of
 * existing markets rather than novel ones.
 *
 * This pass receives only slice threads that survived reconcileSemantic
 * as net-new (description-match merges already happened). It asks the
 * LLM to identify, for each remaining slice thread, the existing
 * thread it materially advances — or to mark it genuinely NOVEL when
 * no continuity exists. Output augments the merge plan before commit;
 * downstream remap retargets the slice's threadDeltas onto the
 * existing thread ids so the daily file's evidence flows into the
 * established markets.
 *
 * Outcome and participant expansion happens mechanically after this
 * pass (Phase III.b) — when a slice thread is integrated into an
 * existing one, the existing thread's outcome and participant lists
 * absorb the slice's contributions.
 */

export const THREAD_INTEGRATION_SYSTEM = `You integrate newly-extracted thread propositions from a daily ingest into the existing narrative's open threads. The default stance is CONTINUATION-FIRST: daily intake is almost always advancing existing markets, not opening new questions. For each candidate slice thread, identify the existing thread it materially advances. Mark a slice thread NOVEL only when its central question, participants, and outcomes have no continuity to anything existing. Return only valid JSON using numeric ids.`;

type AlignmentThread = {
  description: string;
  participantSummary?: string;
  outcomes?: ReadonlyArray<string>;
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildThreadIntegrationPrompt(
  sliceCandidates: ReadonlyArray<AlignmentThread>,
  existingOpenThreads: ReadonlyArray<AlignmentThread>,
): string {
  const sliceXml = sliceCandidates
    .map((t, i) => {
      const outcomes = t.outcomes && t.outcomes.length > 0
        ? ` outcomes="${t.outcomes.map((o) => escapeXml(o)).join(' | ')}"`
        : '';
      const participants = t.participantSummary
        ? ` participants="${escapeXml(t.participantSummary)}"`
        : '';
      return `    <slice id="${i + 1}"${participants}${outcomes}>${escapeXml(t.description)}</slice>`;
    })
    .join('\n');
  const existingXml = existingOpenThreads
    .map((t, i) => {
      const outcomes = t.outcomes && t.outcomes.length > 0
        ? ` outcomes="${t.outcomes.map((o) => escapeXml(o)).join(' | ')}"`
        : '';
      const participants = t.participantSummary
        ? ` participants="${escapeXml(t.participantSummary)}"`
        : '';
      return `    <existing id="${i + 1}"${participants}${outcomes}>${escapeXml(t.description)}</existing>`;
    })
    .join('\n');

  return `<inputs>
  <slice-candidates count="${sliceCandidates.length}" note="Threads newly extracted from a daily ingest. Most are likely continuations of existing markets.">
${sliceXml}
  </slice-candidates>
  <existing-open-threads count="${existingOpenThreads.length}" note="Open narrative threads the slice candidates may continue.">
${existingXml}
  </existing-open-threads>
</inputs>

<instructions>
  <task>For each slice candidate, determine whether it materially advances one of the existing open threads (CONTINUES) or asks a question with no continuity to any existing thread (NOVEL).</task>

  <guiding-principle>Default to CONTINUES. Daily ingest content overwhelmingly advances markets the narrative is already running. Mark NOVEL only when the slice thread's central question, participants, scope, AND outcomes share nothing materially with any existing thread.</guiding-principle>

  <continues-when>
    <example>Slice thread asks the same central question as an existing thread, with the same participants — even if phrased differently.</example>
    <example>Slice thread is a phase later in the same question's lifecycle (existing: "will X happen?" → slice: "how is X unfolding?").</example>
    <example>Slice thread tightens an existing thread's scope (existing: "Country X's response" → slice: "Country X's sanction package").</example>
    <example>Slice thread's outcomes line up with an existing thread's outcomes — same set of resolutions in play, same actors.</example>
    <example>Slice thread restates an existing thread's question with new evidence terms but identical structural shape.</example>
  </continues-when>

  <novel-when hint="All of these must hold for NOVEL.">
    <example>Different participants — no overlap of core actors with any existing thread.</example>
    <example>Different domain — a market on capability is not a continuation of a market on intent.</example>
    <example>Different time horizon — a question about long-term institutional drift is not a continuation of a question about a single decision.</example>
    <example>Outcomes don't fit — the slice thread's possible resolutions cannot be mapped onto any existing thread's outcome set.</example>
  </novel-when>

  <continues-vs-merge-distinction>
    The standard reconcile pass before this one already merged slice threads whose DESCRIPTIONS match existing threads. The slice candidates you see here are those that *survived* description-match preservation. You are looking for SEMANTIC continuations the surface-form check missed — different wording, same question.
  </continues-vs-merge-distinction>

  <one-target-rule>Each slice thread continues at most ONE existing thread. If a slice thread could plausibly continue multiple existing threads, pick the one whose participants and outcomes match most precisely; if none clearly wins, mark NOVEL — better a parallel new thread than a wrong merge.</one-target-rule>

  <output-shape>
    <step>For every slice id, emit exactly one entry in the "alignments" array. Each entry is either {"slice": N, "continues": M} where M is an existing id, or {"slice": N, "novel": true}. Use the numeric ids from the lists above verbatim — never invent ids.</step>
    <step>If you find no plausible continuation for any slice candidate, return {"alignments": []}.</step>
  </output-shape>
</instructions>

<output-format>
Return JSON:
{
  "alignments": [
    { "slice": <sliceId>, "continues": <existingId> }
    | { "slice": <sliceId>, "novel": true }
  ]
}
</output-format>`;
}
