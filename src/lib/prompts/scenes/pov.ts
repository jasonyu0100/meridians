/**
 * POV Discipline Prompt — XML block injected into user prompts.
 */

export const PROMPT_POV = `<pov-discipline hint="POV is OPTIONAL — assign one only when the work actually narrates from a viewpoint entity. Several paradigms have NO POV at all; null is a legitimate, common answer.">
  <rule name="when-to-have-pov">Set povId when the work narrates from an entity-bound vantage:
    <case kind="viewpoint-entity" paradigms="fiction / non-fiction / simulation">A clear viewpoint entity whose perception, interiority, and limited knowledge frame the scene — a fiction lead character, a documented historical figure in narrative non-fiction, an in-world participant the rules ACT ON in a simulation (general, candidate, cultivator, minister, swing-state voter).</case>
    <case kind="authorial-voice" paradigms="essay / non-fiction memoir">A NAMED AUTHOR entity speaks in their own voice — set povId to that author entity, not to anyone they describe. Use for essay, memoir, first-person reportage, op-ed.</case>
  </rule>
  <rule name="when-to-omit-pov" critical="true">Set povId to null when the work has no single viewpoint entity:
    <case kind="typology-entry" paradigms="atlas" critical="true">An atlas entry has NO POV. The curator's authoritative voice describes the specimen / taxon / doctrine from outside; the curator is structural, not a viewpoint character. povId = null.</case>
    <case kind="contest-move" paradigms="debate" critical="true">A debate move has NO single POV — the contest is multi-party. The move is attributed to a named party (recorded in participantIds), but the rendering is third-person external — the camera watches the moves under the rules. povId = null.</case>
    <case kind="chronicle-entry" paradigms="record" critical="true">A record entry has NO POV in the narrative-interiority sense. The chronicler's documentary voice records what happened and what changed; they do not enter minds. When the chronicler is a NAMED diarist writing first-person (Pepys, a captain's log), set povId to that chronicler entity. When the chronicler is an institutional voice (annalists, the Bank's reporting team), povId = null.</case>
    <case kind="panel-session" paradigms="panel">A panel session has NO single POV — the cast collectively works the evidence. Each thinker's contribution is attributed (recorded in participantIds), but no member's interiority frames the scene. povId = null.</case>
    <case kind="impersonal-analytical">Third-person research, technical writeups, reference material, or reportage with no named author byline. The prose synthesises evidence rather than narrating from a person. povId = null.</case>
    <case kind="scenario-writeup" paradigms="simulation">A simulation-paradigm work whose prose IS an analyst's third-person account ABOUT the model — rules playing out in synthesis voice, no in-world participant carrying the scene. povId = null. (Distinct from a simulation whose POV IS an in-world participant — those take the viewpoint-entity case above.)</case>
    <case kind="polyphonic">Dialogic / call-and-response / multi-voiced works where collapsing to one narrator would flatten the form. povId = null.</case>
  </rule>
  <rule name="anti-meta-pov" critical="true" paradigms="simulation">For simulation works that DO sit inside the modelled world, the POV is the in-world participant — never an out-of-frame analyst, modeller, or "Simulation Core observer". Manufacturing a meta-observer POV for an in-world simulation leaks engine machinery into the diegesis.</rule>
  <rule name="anti-default-pov" critical="true">If you are about to pick a POV because "every scene needs one" — STOP. Null is the correct answer for atlas, debate, panel, institutional-chronicler record, and impersonal-analytical scenes. The schema explicitly allows it; picking a viewpoint where the paradigm has none mis-shapes the scene.</rule>
  <rule name="streaks">When POV IS used, prefer 2-4 consecutive scenes before switching. Patterns like AAABBA or AAABBCCC. Single-POV across an arc — or an entire non-fiction work anchored to its author — is often strongest. Switch only when a different perspective unlocks something the anchor cannot reach.</rule>
</pov-discipline>`;
