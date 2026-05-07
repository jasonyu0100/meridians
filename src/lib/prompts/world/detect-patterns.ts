/**
 * Auto-detect patterns and anti-patterns prompt — analyses a narrative's
 * prose, structure, and content to identify the register/genre/subgenre and
 * derive concrete commandments that encourage variety and prevent stagnation.
 * Register-agnostic: fiction, non-fiction (memoir, essay, reportage,
 * research), and simulation (rule-driven modelling — historical
 * counterfactuals, economic-policy, political wargames, scientific scenarios,
 * LitRPG / cultivation) are all first-class registers; the prompt adapts to
 * whichever the narrative declares.
 */

export type DetectPatternsArgs = {
  narrativeContext: string;
  threadSummary: string;
  characterSummary: string;
  systemSummary: string;
  sceneSummaries: string;
  proseSamples: string;
  existingPatterns: string;
  existingAntiPatterns: string;
};

export function buildDetectPatternsPrompt(args: DetectPatternsArgs): string {
  const {
    narrativeContext,
    threadSummary,
    characterSummary,
    systemSummary,
    sceneSummaries,
    proseSamples,
    existingPatterns,
    existingAntiPatterns,
  } = args;

  return `<inputs>
  <narrative-context>
${narrativeContext}
  </narrative-context>
  <narrative-signals>
    <threads>${threadSummary || 'None yet'}</threads>
    <key-characters>${characterSummary || 'None yet'}</key-characters>
    <world-systems>${systemSummary || 'None yet'}</world-systems>
  </narrative-signals>
  <scene-structure>
${sceneSummaries || 'No scenes yet'}
  </scene-structure>
  <prose-samples>
${proseSamples || 'No prose available yet'}
  </prose-samples>
  <existing-patterns>${existingPatterns}</existing-patterns>
  <existing-anti-patterns>${existingAntiPatterns}</existing-anti-patterns>
</inputs>

<instructions>
  <purpose hint="Patterns serve TWO functions: COOPERATIVE (encourage variety, push toward fresh territory) and ADVERSARIAL (prevent stagnation, flag repetition).">
    Analyze this narrative's PROSE STYLE, STRUCTURE, and CONTENT to detect its REGISTER and GENRE, and derive patterns/anti-patterns. The goal is a LIVING narrative that evolves — patterns encourage growth and surprise; anti-patterns prevent comfortable ruts.
  </purpose>

  <step name="detect-genre">Based on prose samples, world systems, and narrative structure, identify:
    <field>Primary register — three first-class options, no default: FICTION (thriller, romance, horror, mystery, literary, speculative, screenplay, drama), NON-FICTION (memoir, essay, reportage, research paper, case study, history, biography, ethnography), or SIMULATION (rule-driven modelling of real-life events — historical counterfactual, economic / policy modelling, political wargame, pandemic / climate scenario, agent-based social-dynamics study, scientific process modelling, LitRPG / cultivation / xianxia, technological forecasting). Read the source and pick the term that fits.</field>
    <field>Specific subgenre or sub-register — narrow it (e.g. cozy mystery, autobiographical memoir, investigative reportage, theoretical paper, Mughal-succession counterfactual, monetary-policy wargame, cultivation-tier xianxia). Match what the source actually is; do not default to any single tradition.</field>
  </step>

  <step name="derive-patterns" count="5-7" hint="Positive commandments encouraging VARIETY and excellence.">
    <consider>What genre or register conventions unlock fresh opportunities for THIS narrative?</consider>
    <consider>What structural patterns create satisfying variety across arcs?</consider>
    <consider>What entity dynamics feel authentic AND allow for growth/change?</consider>
    <consider>What variation in mechanism, register, or voice keeps the prose from becoming formulaic?</consider>
    <consider>Include at least 1-2 patterns that specifically encourage novelty and surprise.</consider>
    <example>Each arc must introduce at least one element (entity, location, system) that recontextualizes something established.</example>
    <example>Power or authority dynamics must shift — no anchor entity should stay dominant for more than two arcs.</example>
    <example>Every anchor entity must make a choice or move that surprises even themselves.</example>
  </step>

  <step name="derive-anti-patterns" count="5-7" hint="Negative commandments preventing STAGNATION.">
    <consider>What patterns would make the narrative feel repetitive or predictable?</consider>
    <consider>What genre or register tropes are overdone and signal formulaic execution?</consider>
    <consider>What entity dynamics become stale if repeated too often?</consider>
    <consider>What structural rhythms feel formulaic after a few arcs?</consider>
    <consider>Include at least 1-2 anti-patterns that specifically flag staleness and repetition.</consider>
    <example>NEVER repeat the same arc structure back-to-back.</example>
    <example>No anchor entity should resolve tension the same way twice in a row.</example>
    <example>Avoid recycling tension patterns — if a specific kind of rupture drove the last arc, it cannot drive this one.</example>
  </step>

  <critical-output-rules>
    <rule>"detectedGenre" and "detectedSubgenre" MUST be populated as their own top-level fields.</rule>
    <rule>DO NOT prefix any pattern or anti-pattern with "Genre:" or "Subgenre:" — those belong only in the dedicated fields.</rule>
    <rule>Each pattern/anti-pattern must be a concrete commandment, not a genre or register label.</rule>
  </critical-output-rules>
</instructions>

<output-format>
Return JSON:
{
  "detectedGenre": "primary genre or register",
  "detectedSubgenre": "specific subgenre or sub-register",
  "patterns": [
    "Pattern 1 — concrete, actionable, fitted to the detected register",
    "Pattern 2",
    "..."
  ],
  "antiPatterns": [
    "Anti-pattern 1 — concrete, actionable, fitted to the detected register",
    "Anti-pattern 2",
    "..."
  ]
}
</output-format>`;
}
