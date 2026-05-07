/**
 * POV Discipline Prompt — XML block injected into user prompts.
 */

export const PROMPT_POV = `<pov-discipline hint="POV is OPTIONAL — assign one only when the source actually narrates from a viewpoint entity. Many works have no POV at all.">
  <rule name="when-to-have-pov">Set povId when the source narrates from an entity-bound vantage:
    <case kind="viewpoint-entity">A clear viewpoint entity whose perception, interiority, and limited knowledge frame the scene. Holds across registers — a fiction lead character, an in-world participant in a simulation-register narrative (a general, a candidate, a cultivator, a minister, a swing-state voter), an investigator in narrative non-fiction.</case>
    <case kind="authorial-voice">Memoir / essay / first-person research / reportage / op-ed where a NAMED AUTHOR entity speaks in their own voice — set povId to that author entity, not to anyone they describe.</case>
  </rule>
  <rule name="when-to-omit-pov" critical="true">Set povId to null when the source has no viewpoint entity:
    <case kind="impersonal-analytical">Third-person research, technical writeups, reference material, or reportage with no named author byline. The prose synthesises evidence rather than narrating from a person.</case>
    <case kind="scenario-writeup">A simulation-register source whose prose IS an analyst's third-person account ABOUT the model — rules playing out in synthesis voice, no in-world participant carrying the scene. (Distinct from a simulation-register narrative whose POV IS an in-world participant — those take the viewpoint-entity case above.)</case>
    <case kind="polyphonic">Dialogic / call-and-response / multi-voiced sources where collapsing to one narrator would flatten the form.</case>
  </rule>
  <rule name="anti-meta-pov" critical="true">For simulation-register narratives that DO sit inside the modelled world, the POV is the in-world participant — never an out-of-frame analyst, modeller, or "Simulation Core observer". Manufacturing a meta-observer POV for an in-world simulation narrative leaks engine machinery into the diegesis.</rule>
  <rule name="anti-pattern">If you are about to pick a POV because "every scene needs one" — STOP. Null is the correct answer for the no-viewpoint registers above. The schema explicitly allows it.</rule>
  <rule name="streaks">When POV IS used, prefer 2-4 consecutive scenes before switching. Patterns like AAABBA or AAABBCCC. Single-POV across an arc — or an entire non-fiction work anchored to its author — is often strongest. Switch only when a different perspective unlocks something the anchor cannot reach.</rule>
</pov-discipline>`;
