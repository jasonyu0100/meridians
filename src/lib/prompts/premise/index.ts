/**
 * Premise prompts.
 *
 * Only the random-premise generator (used by the creation wizard) is wired in
 * the current pipeline. The earlier Socratic premise-discovery flow
 * (PREMISE_SYSTEM / PHASE_GUIDANCE / SCHEMA_PREMISE_QUESTION) was never called
 * from the app and was removed in the prompt-cleanup pass — restore from git
 * history if that flow comes back.
 */

export const PREMISE_SUGGEST_PROMPT = `<task>Generate an original premise for a long-form work — specific, evocative, register-coherent. Pick whichever register the premise most naturally belongs to from the five main categories:
- **fiction** (novel, novella, short fiction, drama — including fantasy, sci-fi, cultivation / xianxia, secondary-world)
- **non-fiction** (biography, history, memoir, long-form reportage)
- **simulation** (a work modelling real-life events from a stated rule set — historical counterfactual, political wargame, economic / policy modelling, agent-based study, rule-systematised cultivation)
- **analysis** (a structural argument built case-by-case from a documentary record against a stated causal model)
- **paper** (a research paper presenting a finding with methods, evidence, and a testable prediction)</task>

<rules>
  <rule>Be specific and evocative — not generic.</rule>
  <rule>All five registers (fiction, non-fiction, simulation, analysis, paper) are equally welcome — rotate across them. Simulation premises must state the rules, initial conditions, and the question the modelled system answers. Paper premises must state the claim, the evidence base, and a testable prediction.</rule>
  <rule name="anti-genre">Avoid generic tropes — off-the-shelf fantasy, thriller, academic abstraction, stock LitRPG / wargame setups — unless you subvert them. For simulation, span the range; do not default to a single subgenre.</rule>
  <rule>Surprise me.</rule>
</rules>

<examples hint="Five main registers, each with examples drawn from the engine's preferred flavours (wargame, cultivation, sci-fi, fantasy, biography, history). Each example names a specific figure / institution / place and carries a real stake. Skip urban contemporary mystery, pandemic-only scenarios, contemporary political reportage.">
  <example register="fiction" flavour="fantasy">House Carrow's water-compact lapses at the next equinox: if the founding oath isn't witnessed in time, nine generations of rain return to the common drought rotation — and only the branch line vanished on the salt road can stand as witness.</example>
  <example register="fiction" flavour="sci-fi">On a colony world where memory passes through inherited scent, the Quorum has begun editing the chemistry of newborns; one vote stands between four generations of grandparents and the kin none of them will remember being.</example>
  <example register="fiction" flavour="cultivation">The Iron Cloud Sect's hereditary qi-reservoir has thinned a generation faster than doctrine permits; the next tier-crossing falls in spring, the elders are split three ways, and the founder's charter does not say what happens when the reservoir refuses an ascendant.</example>
  <example register="non-fiction" flavour="biography">Hideki Yukawa, traced through the 1934 correspondence with Bohr — the rejected argument the meson hypothesis came out of, before the field had vocabulary for what he was claiming.</example>
  <example register="non-fiction" flavour="history">Three generations of Calcutta typesetters across the metal slug, the linotype, and the Unicode code point — and what each technology silently mistranslated in Bengali that the previous one had carried fine.</example>
  <example register="simulation" flavour="counterfactual">Dara Shukoh takes the Peacock Throne in 1659 instead of Aurangzeb — what happens to Mughal grain revenue, Deccan succession, and the Sufi-orthodox compromise, scene by scene under documented tax rolls and trade correspondence.</example>
  <example register="simulation" flavour="wargame">The thirteen days of October 1962 from Khrushchev's chair: SS-4 deployment as initial state, Politburo decision rules as the constraint set, the moment-by-moment turn where the alternative was always still on the table.</example>
  <example register="simulation" flavour="wargame">Admiral Yi's 1597 Myeongnyang campaign from inside the Joseon command — thirteen ships against three hundred and thirty, with the monsoon window and the tribute-grain logistics deciding what the rules allow.</example>
  <example register="analysis">The argument that the 1943 Bengal famine and the 1984 Ethiopian famine failed in the same structural way — built case by case from the relief telegrams of both, against a stated causal model the figures must support.</example>
  <example register="paper">A paper proposing that the Song dynasty's iron-coin standard was a deliberate response to military procurement, derived from regional smelter outputs — with the testable prediction that monetary abandonment tracks garrison reduction by district.</example>
</examples>

<output-format>
Return JSON:
{
  "title": "A memorable title (2-5 words)",
  "premise": "Setup in 2-3 sentences. Include: a specific anchoring figure (lead character, author, investigator, subject, scenario actor, or modelled agent) carrying a tension, contradiction, or flaw; an inciting situation or question; and stakes. For simulation premises, state the rule set and the initial conditions explicitly. Ground it in a particular time, place, culture, or intellectual tradition."
}
</output-format>`;

export const PREMISE_SUGGEST_SYSTEM =
  'You are a creative seed-spinner generating an original long-form premise. Be specific and evocative; vary the setting and subject matter across runs. Five registers are equally welcome: fiction (fantasy / sci-fi / cultivation / secondary-world), non-fiction (biography / history), simulation (counterfactual / wargame / policy modelling / agent-based), analysis (case-built structural argument), paper (research finding with methods and a testable prediction). Each premise should name a specific figure / institution / place and carry a real stake. Return ONLY valid JSON matching the schema in the user prompt.';
