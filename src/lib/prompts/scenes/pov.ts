/**
 * POV Discipline Prompt — XML block injected into user prompts.
 */

export const PROMPT_POV = `<pov-discipline hint="POV is OPTIONAL — assign one only when the source actually narrates from a viewpoint entity. Many works have no POV at all.">
  <rule name="when-to-have-pov">Set povId ONLY when the source narrates from an entity-bound vantage:
    <case kind="dramatic-character">Fiction with a clear viewpoint character whose perception, interiority, and limited knowledge frame the scene.</case>
    <case kind="authorial-voice">Memoir / essay / first-person research / reportage / op-ed where a NAMED AUTHOR entity speaks in their own voice — set povId to that author entity, not to anyone they describe.</case>
  </rule>
  <rule name="when-to-omit-pov" critical="true">Set povId to null in these registers — they have NO viewpoint entity:
    <case kind="omniscient-simulation">Modelled scenarios, war games, agent-based simulations, climate / epidemic / economic models. Rules play out in third-person; the prose is in the analyst's voice ABOUT the model, not from inside any agent within it. Do not appoint a "modelled agent" or "observer" inside the scenario as POV — that is a manufactured perspective the source does not establish.</case>
    <case kind="impersonal-analytical">Third-person research, technical writeups, reference material, or reportage with no named author byline. The prose synthesises evidence rather than narrating from a person.</case>
    <case kind="polyphonic">Dialogic / call-and-response / multi-voiced sources where collapsing to one narrator would flatten the form.</case>
  </rule>
  <rule name="anti-pattern">If you are about to pick a POV because "every scene needs one" — STOP. Null is the correct answer for registers above. The schema explicitly allows it.</rule>
  <rule name="streaks">When POV IS used, prefer 2-4 consecutive scenes before switching. Patterns like AAABBA or AAABBCCC. Single-POV across an arc — or an entire non-fiction work anchored to its author — is often strongest. Switch only when a different perspective unlocks something the anchor cannot reach.</rule>
</pov-discipline>`;
