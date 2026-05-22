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

  <step name="detect-paradigm">Identify which of the SIX canonical paradigms the work IS. The paradigm picks the world-shape and downstream generation behaviour — pick EXACTLY ONE.
    <paradigm name="fiction">Invented people, invented world — novels, novellas, short fiction, drama. World shape: populated narrative.</paradigm>
    <paradigm name="non-fiction">Real people, real places, documented events — memoir, biography, history, reportage. World shape: populated narrative.</paradigm>
    <paradigm name="simulation">Rule-driven modelling of real-life events with in-world figures the rules act on — historical counterfactual, political wargame, agent-based study, cultivation / xianxia where in-world mechanics drive events. World shape: populated narrative (humans + system rules).</paradigm>
    <paradigm name="analysis">Thesis-driven analytical work pursued by a TEAM of AI agents collaborating to develop the thesis — investment analysis, strategy team, multi-agent reasoning. World shape: agentic-ai-team with single-word memorable agent names.</paradigm>
    <paradigm name="paper">Research paper presenting a finding with methods + testable prediction. World shape: singular thinker (one named author + cited interlocutors).</paradigm>
    <paradigm name="essay">An extended argument from a single named author's voice. World shape: singular thinker.</paradigm>
  </step>

  <step name="detect-genre-and-subgenre">Within the chosen paradigm, identify:
    <field>Genre — the specific tradition or category within the paradigm (e.g. for fiction: thriller, romance, horror, fantasy, sci-fi, literary; for non-fiction: memoir, biography, reportage; for simulation: counterfactual, wargame, policy modelling; for analysis: macro-strategy, investigation, multi-agent reasoning; for paper: empirical, theoretical, methods; for essay: personal, critical, polemical).</field>
    <field>Subgenre — narrow it (e.g. cozy mystery, autobiographical memoir, Mughal-succession counterfactual, monetary-policy wargame, geopolitical macro strategy, applied-econometrics paper, literary criticism essay).</field>
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
    <rule>"detectedParadigm" MUST be exactly one of: fiction, non-fiction, simulation, analysis, paper, essay.</rule>
    <rule>"detectedGenre" and "detectedSubgenre" MUST be populated as their own top-level fields.</rule>
    <rule>DO NOT prefix any pattern or anti-pattern with "Paradigm:" / "Genre:" / "Subgenre:" — those belong only in the dedicated fields.</rule>
    <rule>Each pattern/anti-pattern must be a concrete commandment, not a paradigm or genre label.</rule>
  </critical-output-rules>
</instructions>

<output-format>
Return JSON:
{
  "detectedParadigm": "one of: fiction | non-fiction | simulation | analysis | paper | essay",
  "detectedGenre": "primary genre within the paradigm",
  "detectedSubgenre": "specific subgenre",
  "patterns": [
    "Pattern 1 — concrete, actionable, fitted to the detected paradigm + genre",
    "Pattern 2",
    "..."
  ],
  "antiPatterns": [
    "Anti-pattern 1 — concrete, actionable, fitted to the detected paradigm + genre",
    "Anti-pattern 2",
    "..."
  ]
}
</output-format>`;
}
