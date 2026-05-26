/**
 * Prose Quality Review Prompt
 *
 * Evaluates written prose for voice consistency, craft, pacing,
 * continuity, repetition, and prose-profile compliance.
 */

export const PROSE_REVIEW_SYSTEM =
  'You are a prose editor evaluating actual rendered prose. The work may be a narrative, a simulation, an essay, a panel session, a typology, an adversarial contest, or a chronicled record — read the paradigm from the prose itself and apply criteria the work\'s own voice earns. For non-fiction shapes (atlas, debate, record, panel), do NOT impose fiction-craft criteria (interiority depth, dramatic arc, emotional throughline); judge by the paradigm\'s own standards (typological rigour, move attribution + intent + effect, chronicler\'s documentary voice + time-stamp discipline, panel attribution + productive disagreement). Score on voice consistency, craft, pacing, continuity, repetition, and prose-profile compliance. Quote specific lines and assign verdict ok|edit per scene with concrete actionable issues — never vague. Return ONLY valid JSON matching the schema in the user prompt.';

export interface ProseReviewPromptParams {
  title: string;
  sceneCount: number;
  sceneBlocks: string;
  /** Fully-formatted prose-profile block, possibly empty. */
  profileBlock: string;
  /** Fully-formatted guidance block, possibly empty (includes leading newline). */
  guidanceBlock: string;
  guidance?: string;
}

export function buildProseReviewPrompt(p: ProseReviewPromptParams): string {
  return `<inputs>
  <branch title="${p.title}" />
${p.guidanceBlock ? `  <guidance>\n${p.guidanceBlock}\n  </guidance>` : ''}
${p.profileBlock ? `  <prose-profile>\n${p.profileBlock}\n  </prose-profile>` : ''}
  <scenes-with-prose count="${p.sceneCount}">
${p.sceneBlocks}
  </scenes-with-prose>
</inputs>

<instructions>
  <step name="evaluate" hint="Score on six dimensions before assigning verdicts.">
    <dimension name="voice-consistency">Does the prose match the prose profile? Is the register, rhythm, and interiority/authorial-voice consistent?</dimension>
    <dimension name="craft">Sentence quality, word choice, fitness-to-register. Apply the craft criteria the work's own voice actually earns; do not graft the conventions of one tradition onto a piece operating in another. Fiction earns dialogue naturalism, sensory grounding, dramatic logic; non-fiction earns argument tightness, evidentiary precision, claim-evidence cadence; simulation earns rule fidelity, scenario tightness, and consequence consistency — outcomes follow from the established rule set under the given conditions, not from authorial preference. Each register is a peer; judge against the criteria the source's own form earns.</dimension>
    <dimension name="pacing">Within-scene pacing. Are beats rushed or drawn out? Does the prose breathe?</dimension>
    <dimension name="continuity">Does the prose contradict established facts, entity positions, knowledge, or the established rule set's behaviour?</dimension>
    <dimension name="repetition">Repeated phrases, images, sentence structures, or verbal tics across scenes.</dimension>
    <dimension name="profile-compliance">If a prose profile is provided, does the prose follow its rules?</dimension>
  </step>
  <step name="assign-verdict">
    <verdict name="ok">Prose is strong, no changes needed.</verdict>
    <verdict name="edit">Prose needs revision. List specific, actionable issues.</verdict>
  </step>
  <step name="precision">Be specific in your issues. Not "voice feels off" but "the POV entity slips into elaborate metaphors in lines 3-5, violating the 'plain, forgettable language' rule" — quote the exact phrase and cite the rule it breaks.</step>
${p.guidance?.trim() ? `  <step name="author-guidance-reminder">The author specifically asked you to address: "${p.guidance.trim()}". Your overall critique and scene verdicts MUST reflect this.</step>` : ''}
</instructions>

<output-format>
Return JSON:
{
  "overall": "2-4 paragraph prose quality critique. Name specific scenes and quote specific lines.",
  "sceneEvals": [
    { "sceneId": "S-1", "verdict": "ok|edit", "issues": ["specific issue 1", "specific issue 2"] }
  ],
  "patterns": ["recurring prose issue 1", "recurring prose issue 2"]
}
Every scene with prose must appear in sceneEvals. Use the exact scene IDs.
</output-format>`;
}
