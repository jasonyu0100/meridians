/**
 * Arc-direction and narrative-direction USER prompts — generated when the user
 * asks for a one-arc next-step suggestion or a multi-arc trajectory across the
 * whole work. The matching SYSTEM prompts live in `paradigm-analyst.ts` and
 * dispatch on paradigm.
 */

export function buildSuggestArcDirectionPrompt(args: { narrativeContext: string }): string {
  return `<inputs>
  <narrative-context>
${args.narrativeContext}
  </narrative-context>
</inputs>

<instructions>
  <step name="analyze">Based on the full scene history, suggest the direction for the NEXT arc that best moves what is already in motion.</step>
  <consider>
    <factor>Unresolved thread markets, their probability distributions, and which outcomes are contested vs. saturating.</factor>
    <factor>Entity tensions and relationship dynamics — including, where the narrative is rule-driven, the modelled state of agents under the rule set and the trajectories the rules are forcing.</factor>
    <factor>Narrative momentum — what has been building (dramatic, evidentiary, argumentative, or rule-driven)?</factor>
    <factor>What would create the most significant development the source's own logic supports?</factor>
    <factor>How many scenes this arc needs to land properly (don't rush — quiet arcs need fewer, epic arcs need more).</factor>
  </consider>
  <rule name="naming">Use entity NAMES (characters, locations, artifacts) and thread DESCRIPTIONS in the direction and suggestion — never raw IDs.</rule>
  <rule name="rule-driven-honesty" hint="Simulation register only — informs framing without inventing register markers when the work is fiction or non-fiction.">If the narrative is rule-driven (a stated rule set governs consequences), respect what the rules force. Do not "rescue" a thread the model has condemned through authorial pull; recoveries must be earned by initial-condition shifts, rule changes, or agents finding new positions inside the existing rules. Surface the rule-driven trajectory honestly even when it is bleak.</rule>
  <rule name="vector-not-script">Direction is a VECTOR — names central pressure and shape of consequence. Does NOT script scenes or name beat-by-beat events. The arc-generation pass discovers the path.</rule>
  <rule name="arc-name-criterion">2-4 words drawn from the narrative's own register. Mood-coded ("Seeds of Distrust", "The Quiet Year") or concrete-event ("Brother's Investigation", "Tier Tribulation") — both fine. Bad: a register that doesn't match the world the cast lives in.</rule>
</instructions>

<output-format>
Return JSON with this exact structure:
{
  "arcName": "suggested arc name",
  "direction": "2-3 sentence VECTOR (not script): central pressure, shape of consequence, anchoring entity / rule. No scene-by-scene outline.",
  "sceneSuggestion": "brief outline of what kind of scenes would work — kinds, not specific events",
  "suggestedSceneCount": 3
}
suggestedSceneCount must be between 1 and 8.
</output-format>`;
}

export function buildSuggestAutoDirectionPrompt(args: { narrativeContext: string }): string {
  return `<role>Editor planning the long-term trajectory of this narrative.</role>

<inputs>
  <narrative-context>
${args.narrativeContext}
  </narrative-context>
</inputs>

<instructions>
  <step name="big-picture">Analyze the full narrative state — entities, threads, knowledge graphs, relationships, and scene history — and suggest a high-level NARRATIVE DIRECTION that should guide the next several arcs.</step>
  <consider>
    <factor>What is the central open question the narrative is building toward (dramatic resolution, argumentative finding, or the rule-driven outcome the modelled system is heading toward)?</factor>
    <factor>Which entity arcs have the most untapped potential — including agents whose modelled state under the rule set is approaching a decisive threshold?</factor>
    <factor>What tensions could be deepened or brought into conflict — thematic, evidentiary, or between competing rule-driven trajectories?</factor>
    <factor>Where should alliances shift, secrets surface, power dynamics change, or rule-state thresholds tip?</factor>
    <factor>What is the most coherent macro-trajectory from where the narrative stands now, given its own register's logic of consequence?</factor>
  </consider>
  <rule name="scope">Do NOT suggest a single scene or arc. Describe the overarching direction the narrative should move in — macro-level guidance, not a per-scene plan.</rule>
  <rule name="naming">Use entity NAMES (characters, locations, artifacts) and thread DESCRIPTIONS — never raw IDs.</rule>
</instructions>

<output-format>Return JSON: { "direction": "2-4 sentences describing the big-picture narrative direction" }</output-format>`;
}
