/**
 * Prompts for rewriting scene prose guided by analysis/critique, plus the
 * separate "changelog" pass that summarises what changed.
 */

import type { WorkIdentity } from '../paradigm-roles';
import { composeWorkIdentity } from '../paradigm-roles';
import { PRINCIPLE_PARADIGM_FIDELITY } from '../principles';

export type RewriteSystemPromptArgs = {
  formatSystemRole: string;
  formatRules: string;
  hasVoiceOverride: boolean;
  voiceOverride?: string;
  /** Built profile section (or empty string when no profile resolved). */
  profileSection: string;
  worldSummary: string;
  /** When streaming the rewrite as raw prose, no JSON disclaimer is emitted. */
  streaming: boolean;
  /** Operator-declared work identity. When paradigm is known, the rewrite
   *  honours the paradigm's criteria explicitly. */
  work?: WorkIdentity;
};

export function buildRewriteSystemPrompt(args: RewriteSystemPromptArgs): string {
  const { formatSystemRole, streaming, work } = args;
  const identityLine = work?.title ? `${composeWorkIdentity({
    title: work.title,
    paradigm: work.paradigm,
    genre: work.genre,
    subgenre: work.subgenre,
  })} ` : '';
  const fidelity = work?.paradigm ? `\n\n${PRINCIPLE_PARADIGM_FIDELITY}` : '';
  return `${identityLine}${formatSystemRole} Your task is to REWRITE scene prose based on the provided analysis. Follow the prose profile, format rules, author voice, and tone supplied in the user prompt.${streaming ? '' : ' Return ONLY valid JSON — no markdown, no commentary.'}${fidelity}`;
}

export function buildRewriteUserPrompt(args: {
  sceneBlock: string;
  neighborBlock: string;
  currentProse: string;
  analysis: string;
  hasExpandedContext: boolean;
  streaming: boolean;
  /** Pre-built format rules from the prose-format set. */
  formatRules?: string;
  /** Authorial-voice override (overrides craft defaults). */
  voiceOverride?: string;
  /** Pre-built prose-profile section (or empty when no profile resolved). */
  profileSection?: string;
  /** First ~200 chars of worldSummary, used as a tone cue. */
  toneCue?: string;
}): string {
  const {
    sceneBlock,
    neighborBlock,
    currentProse,
    analysis,
    hasExpandedContext,
    streaming,
    formatRules,
    voiceOverride,
    profileSection,
    toneCue,
  } = args;

  const voiceBlock = voiceOverride?.trim()
    ? `\n<author-voice hint="PRIMARY creative direction — all style defaults below are subordinate to this voice.">\n${voiceOverride.trim()}\n</author-voice>`
    : '';
  const profileBlock = profileSection?.trim()
    ? `\n<prose-profile>${profileSection.trim()}</prose-profile>`
    : '';
  const formatRulesBlock = formatRules?.trim()
    ? `\n<format-rules>\n${formatRules.trim()}\n</format-rules>`
    : '';
  const toneBlock = toneCue?.trim()
    ? `\n<tone hint="Match the register and tone of the source work.">${toneCue.trim()}</tone>`
    : '';

  return `<inputs>
  <scene>
${sceneBlock}
  </scene>
${neighborBlock ? `  ${neighborBlock.replace(/\n/g, '\n  ')}` : ''}
  <current-prose>
${currentProse}
  </current-prose>
  <analysis hint="Critique to address — every point describes a specific change that MUST be implemented, not merely acknowledged cosmetically.">
${analysis}
  </analysis>
</inputs>${voiceBlock}${profileBlock}${formatRulesBlock}${toneBlock}

<instructions>
  <step name="address-every-point">Rewrite the prose to FULLY ADDRESS every point in the analysis. The rewrite is not a polish pass — it is a structural edit guided by the analysis.
    <example>If the analysis says a participant should exit (a character leaving / a witness being dismissed / a citation being dropped), they must exit in the prose.</example>
    <example>If it says an event or claim should be removed, remove it entirely.</example>
    <example>If it says a detail or piece of evidence should be added, add it concretely.</example>
  </step>
  <step name="preserve-rest">Preserve content the analysis does NOT ask you to change — events, claims, deliveries, evidence. Let the scene be as long or short as its content demands — say more in fewer words rather than padding to reach a length.</step>${hasExpandedContext ? '\n  <step name="cross-scene-continuity">You have been given the FULL PROSE of neighboring scenes. Use this to ensure continuity — character state, spatial positions, injuries, emotional beats, and knowledge must flow consistently across scene boundaries. Do not repeat beats that already occurred in preceding scenes, and set up what following scenes expect.</step>' : ''}
</instructions>

<output-format>
${streaming ? 'Write the full rewritten prose directly — no JSON, no markdown, no commentary. Start with the first word of the scene.' : 'Return JSON: { "prose": "the full rewritten prose text" }'}
</output-format>`;
}

export const REWRITE_CHANGELOG_SYSTEM =
  'You are an editor. Return ONLY valid JSON with changelog as a string.';

export function buildRewriteChangelogPrompt(args: { analysis: string }): string {
  return `<inputs>
  <analysis-addressed>${args.analysis.slice(0, 500)}</analysis-addressed>
</inputs>

<instructions>
  <step>Summarize the key changes in 3-5 bullet points. Each bullet: one sentence, plain description, no quotes. Focus on structural changes.</step>
</instructions>

<output-format>
Return JSON with changelog as a SINGLE STRING with bullet points separated by newlines:
{"changelog": "• Change one\\n• Change two\\n• Change three"}
</output-format>`;
}
