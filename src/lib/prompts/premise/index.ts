/**
 * Premise prompts.
 *
 * Only the random-premise generator (used by the creation wizard) is wired in
 * the current pipeline. The earlier Socratic premise-discovery flow
 * (PREMISE_SYSTEM / PHASE_GUIDANCE / SCHEMA_PREMISE_QUESTION) was never called
 * from the app and was removed in the prompt-cleanup pass — restore from git
 * history if that flow comes back.
 */

export const PREMISE_SUGGEST_PROMPT = `<task>Generate an original premise for a long-form work — specific, evocative, register-coherent. The work may be fiction (novel, novella, short fiction, drama), non-fiction (memoir, essay, long-form reportage, research, history, case study), or simulation (a work that models real-life events from a stated rule set — historical counterfactual, economic / policy / political-wargame / pandemic / climate scenario, agent-based study, LitRPG / cultivation / xianxia where in-world mechanics drive events) — pick whichever register the premise most naturally belongs to.</task>

<rules>
  <rule>Be specific and evocative — not generic.</rule>
  <rule name="originality">Draw from any genre, register, time period, or culture — East Asian, South Asian, African, Middle Eastern, Indigenous, Latin American, diasporic, non-Western-canonical — and do not default to Anglo/European settings.</rule>
  <rule>Non-fiction and simulation premises are as welcome as fiction. Simulation premises must surface a load-bearing rule set: state the rules, the initial conditions, and the question the modelled system is being asked to answer.</rule>
  <rule name="anti-genre">Avoid generic tropes of any genre — Western fantasy/sci-fi, thriller, academic abstraction, default LitRPG dungeon-crawl, off-the-shelf wargame setups — unless you subvert them. When you reach for simulation, span the range (historical counterfactual / economic-policy / political-wargame / pandemic / climate / agent-based / scientific-process / rule-systematised fiction); do not default to a single subgenre.</rule>
  <rule>Surprise me.</rule>
</rules>

<examples hint="Span all three registers; do not weight toward any one.">
  <example register="fiction">A retired Yoruba diviner is summoned to investigate disappearances in a Lagos high-rise where the lifts open onto floors absent from the building plans.</example>
  <example register="non-fiction">A memoir of three generations of Bengali typesetters tracing how the metal slug, the linotype, and the Unicode code point each rewrote what could be printed in their language.</example>
  <example register="simulation-counterfactual">What happens to the Mughal grain economy and Deccan succession if Dara Shukoh, not Aurangzeb, takes the Peacock Throne in 1659 — scene-by-scene under documented revenue rules and contemporaneous trade networks.</example>
  <example register="simulation-wargame">A turn-by-turn 1962 Cuba escalation run from the Soviet Politburo's vantage: declassified intelligence as initial state, Khrushchev's known decision rules as the constraint set.</example>
  <example register="simulation-policy">An agent-based model of caste-network reform under three contending land-redistribution policies in 1990s rural Bihar — scenes following individual cultivators as rules collide with kin obligations.</example>
  <example register="simulation-pandemic">A propagation scenario run on real 2009 H1N1 mobility data with a counterfactual: what if São Paulo state schools had stayed open the full term?</example>
  <example register="simulation-cultivation">A Daoist sect's hereditary qi-reservoir depletes a generation faster than its doctrine permits — what political and doctrinal states the sect reaches across twenty years under its own succession rules.</example>
</examples>

<output-format>
Return JSON:
{
  "title": "A memorable title (2-5 words)",
  "premise": "Setup in 2-3 sentences. Include: a specific anchoring figure (lead character, author, investigator, subject, scenario actor, or modelled agent) carrying a tension, contradiction, or flaw; an inciting situation or question; and stakes. For simulation premises, state the rule set and the initial conditions explicitly. Ground it in a particular time, place, culture, or intellectual tradition."
}
</output-format>`;

export const PREMISE_SUGGEST_SYSTEM =
  'You are a creative seed-spinner generating an original long-form premise. Be specific and evocative; favour non-Western settings; keep fiction, non-fiction, and simulation premises equally welcome (simulation = a rule-governed model of real-life events, including historical counterfactuals, economic / policy modelling, political wargames, pandemic / climate scenarios, agent-based studies, scientific-process modelling, and rule-systematised fiction). When proposing simulation, span the range — do not default to LitRPG. Return ONLY valid JSON matching the schema in the user prompt.';
