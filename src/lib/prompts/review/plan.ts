/**
 * Plan Quality Review Prompt
 *
 * Continuity review of beat plans — verifies beats are internally consistent,
 * cross-scene continuous, and deliver the declared deltas.
 */

export const PLAN_REVIEW_SYSTEM =
  'You are a continuity editor reviewing scene beat plans. For each scene check beat-to-delta alignment, cross-plan continuity, internal beat logic, entity knowledge, and spatial/temporal consistency. The plans may serve narrative, simulation, essay, panel, atlas, debate, or record paradigms — verify that each plan\'s shape matches its paradigm: simulation plans must deliver the rule-driven consequence the deltas claim (a system delta declaring a rule fires must have a beat where the rule is actually applied); essay plans must move through argument-shape beats (claim, evidence, counter, conclusion) not action beats; atlas plans must structure as classification not chronology; debate plans must trace attribution + intent + effect; record plans must respect time-stamp velocity. Assign verdict ok|edit per scene with precise issue references (cite beat numbers). Return ONLY valid JSON matching the schema in the user prompt.';

export interface PlanReviewPromptParams {
  title: string;
  threadBlock: string;
  /** Entity-knowledge block — characters, sources, institutions, concepts, modelled agents and their state under the rule set. */
  charBlock: string;
  sceneCount: number;
  sceneBlocks: string;
  /** Fully-formatted guidance block, possibly empty (includes leading newline). */
  guidanceBlock: string;
  guidance?: string;
}

export function buildPlanReviewPrompt(p: PlanReviewPromptParams): string {
  return `<inputs>
  <branch title="${p.title}" />
${p.guidanceBlock ? `  <guidance>\n${p.guidanceBlock}\n  </guidance>` : ''}
  <threads>
${p.threadBlock}
  </threads>
  <entity-knowledge>
${p.charBlock || '(none tracked yet)'}
  </entity-knowledge>
  <scenes-with-beat-plans count="${p.sceneCount}">
${p.sceneBlocks}
  </scenes-with-beat-plans>
</inputs>

<instructions>
  <step name="check" hint="For each scene, walk these five checks.">
    <check name="beat-to-delta-alignment">Do the beats actually show what the declared deltas claim? If a thread delta says T-3 escalates, which specific beat delivers that escalation? If no beat does, flag it.</check>
    <check name="cross-plan-continuity">Does this plan's opening beats follow logically from the previous plan's closing beats? Entity positions, emotional/epistemic states, knowledge, conditions.</check>
    <check name="internal-beat-logic">Do beats within the plan follow causally? Does beat 5 depend on something beat 3 established?</check>
    <check name="entity-knowledge">Does any beat have an entity act on or invoke information not yet established in prior scenes or earlier beats? "Information" here includes a modelled agent's state under the rule set — an agent cannot apply a rule, hold a resource, or occupy a state the rule set has not yet established for them.</check>
    <check name="spatial-temporal">Are participants where they should be? Can all beats plausibly occur in one scene?</check>
  </step>
  <step name="assign-verdict">
    <verdict name="ok">Beats are consistent, deltas are earned by specific beats.</verdict>
    <verdict name="edit">Issues found. Each issue must reference a specific beat number and what's wrong.</verdict>
  </step>
  <step name="precision">Be precise: "Beat 4 declares the POV entity recognises a specific seal/source/pattern, but no prior beat or scene establishes that prior exposure" — not "continuity error."</step>
${p.guidance?.trim() ? `  <step name="author-guidance-reminder">The author asked you to address: "${p.guidance.trim()}".</step>` : ''}
</instructions>

<output-format>
Return JSON:
{
  "overall": "2-3 paragraph analysis focused on beat quality and delta alignment.",
  "sceneEvals": [
    { "sceneId": "S-1", "verdict": "ok|edit", "issues": ["Beat N: specific issue"] }
  ],
  "patterns": ["recurring issue across multiple plans"]
}
Every scene with a plan must appear.
</output-format>`;
}
