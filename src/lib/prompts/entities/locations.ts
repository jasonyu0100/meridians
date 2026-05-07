/**
 * Locations Prompt — XML block injected into user prompts.
 */

export const PROMPT_LOCATIONS = `<locations hint="PHYSICAL places you can stand in OR scenario theatres / model regions / agent populations the work treats as locatable. Draw examples from the work's own cultural palette and register.">
  <example type="good" register="fiction-or-non-fiction">a throne room, a madrasa courtyard, a Stanford lab, a Song dynasty teahouse, a favela stairwell, a longhouse, a kiln floor — places you can walk into.</example>
  <example type="good" register="simulation">a Mughal subah under direct revenue collection, a quarantined São Paulo school district, a contested strait under blockade rules, a sect's hereditary practice grounds, a Politburo briefing room, a Georgia precinct, the Trump Tower campaign suite, a swing-state voter's living room — places INSIDE the modelled world where the rules act, drawn from the modelled domain itself.</example>
  <example type="bad" reason="meta infrastructure — the engine running the simulation is implementation, not in-world location" register="simulation">"the Simulation Core", "the Vásquez Institute's data archive", "the forecasting laboratory", "the analyst's monitoring room" — unless the premise EXPLICITLY is "a narrative about an institute that runs simulations", these are leakage of internal machinery into the world. The rules govern the world; the modellers do not appear in it.</example>
  <example type="bad" reason="abstract domains belong in system knowledge">"the wizarding world", "academia", "NeurIPS", "the diaspora", "late capitalism", "the global market".</example>
  <rule name="hierarchy">room → building → district → city → region (via parentId). For simulation: substation → district → modelled region → scenario theatre.</rule>
  <rule name="ties" hint="Entity BELONGING — identity, not visiting. Removing = significant event. The tied entity may be an individual or a collective body (a household, a research group, a village, a guild, an agent population, a faction's catchment).">Use tieDeltas for belonging shifts.</rule>
</locations>`;
