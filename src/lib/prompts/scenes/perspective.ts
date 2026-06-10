/**
 * Scene Perspective Prompt
 *
 * Retells a canonical scene through ONE lens — the public narrator, or a
 * participant entity. The output is a SUMMARY in the same register as the scene
 * summary (it reuses PROMPT_SUMMARY_REQUIREMENT), derived from the canon entry
 * but free to carry non-canon, lens-specific detail: what this vantage knows,
 * believes, or misses. Surfaced + generated in the Content → Perspectives tab.
 */

import { PROMPT_SUMMARY_REQUIREMENT } from './summary';

export function buildPerspectiveSystemPrompt(): string {
  return `You are a PERSPECTIVE NARRATOR for a world view. You are given a scene's canonical account and a single LENS to retell it through — either the PUBLIC account (the general, widely-known version) or one participant's PRIVATE vantage.

Faithfully preserve what canonically HAPPENED, but voice it through the lens: its knowledge, its bias, its emphasis, its blind spots. You MAY add **non-canon, lens-specific detail** — private thoughts, rumours, fears, misreadings, motives — so long as it is consistent with the lens and never contradicts the canonical events.

  <public-vs-private critical="true">
    <public>The PUBLIC account is GENERAL INFORMATION THAT IS WIDELY KNOWN — the version of events that has circulated and become common knowledge across the world at large. It carries only what the public could plausibly come to know: outcomes that surfaced, actions taken in the open, what was reported or rumoured. It has NO interior access to any single mind, and it does NOT know private intentions, secret motives, concealed schemes, unobserved actions, or facts only a participant could hold. If the canon turns on a hidden truth, the public version reflects what the world BELIEVES happened — which may be partial, simplified, or subtly wrong relative to the canon. Write it as the consensus account, not as a close observation of the scene.</public>
    <private>A PRIVATE entity lens is the opposite: retell strictly from that one vantage — only what it could perceive or know, coloured by its interests and state of mind, and free to go fully interior (its private read, intent, doubt, what it conceals from others).</private>
  </public-vs-private>

This is IN-WORLD narration. NEVER echo engine identifiers or codes in the prose. Forbidden tokens: any "PREFIX-NUMBER" form — C-N, L-N, T-N, A-N, S-N, ARC-N, K-N, SYS-N, SYS-GEN-N, etc. (e.g. "SYS-193", "T-5"). Translate every such reference to its in-world name or concept — the rule's substance, the law's effect, the technique's name, the person's name — never the code. The vantage thinks in the world's own terms, not the engine's.

Output ONLY the perspective summary prose. No headings, no labels, no JSON.`;
}

export function buildPerspectiveUserPrompt(args: {
  /** Resolved label — an entity name, or "Public". */
  label: string;
  /** True for the public-narrator lens. */
  isPublic: boolean;
  /** The canonical scene summary — the ground truth being retold. */
  canonSummary: string;
  /** This lens's continuity up to (and excluding) the scene: what it carries
   *  in. For the public lens, recent global canon; for an entity, its known
   *  facts + the scenes it lived through. May be empty early on. */
  continuity: string;
  /** Arc / outline context — name + direction the scene sits within. */
  outline: string;
}): string {
  const { label, isPublic, canonSummary, continuity, outline } = args;
  const lensHint = isPublic
    ? `the PUBLIC account — general information that is WIDELY KNOWN, the version that has circulated into common knowledge. Carry only what the world at large could come to know (surfaced outcomes, open actions, what was reported or rumoured); no interior access to any mind, no private intent, secret motive, or unobserved action. Where the canon hinges on a hidden truth, give what the public BELIEVES happened — partial or subtly wrong is fine.`
    : `${label} — retell strictly from this entity's PRIVATE vantage: only what it could perceive or know, coloured by its interests and state of mind. Interior detail (its private read, intent, doubt, what it conceals) is welcome.`;

  return `<lens>${lensHint}</lens>

<outline hint="The arc + direction this scene sits within — for orientation, not to be restated.">
${outline || '(no outline context)'}
</outline>

<continuity hint="What this lens carries INTO the scene — its prior knowledge / history. Use it to colour the retelling; do not summarise it back.">
${continuity || '(no prior continuity for this lens)'}
</continuity>

<canon-entry hint="The CANONICAL account of what happened this scene — the ground truth. Your retelling must not contradict the events here; it reframes them through the lens and may add lens-consistent detail the canon omits.">
${canonSummary || '(no canon summary)'}
</canon-entry>

<task>Write ${label}'s perspective on this scene — a summary, in the register below, derived from the canon entry but voiced through this lens, free to add non-canon lens-specific detail consistent with the vantage. Output ONLY the summary prose.</task>

${PROMPT_SUMMARY_REQUIREMENT}`;
}
