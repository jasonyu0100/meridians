/**
 * Ingestion Prompts
 *
 * Prompts for parsing pasted text into structured world data and for
 * generating short prose samples that exercise a given profile (used by
 * the blind taste test in the Prose Profile panel).
 */

export const INGEST_PROSE_PROFILE_SYSTEM =
  'You extract a prose profile — voice, register, stance, devices, rules, anti-patterns — from pasted text. Pick values that genuinely match the source; do not default to any single tradition\'s toolkit. Read the source on its own terms. Return ONLY valid JSON matching the schema in the user prompt.';

export const REFINE_PROSE_PROFILE_SYSTEM =
  'You refine an existing prose profile using the user\'s guidance — pasted prose, editorial notes, or a natural-language adjustment ("make it more clinical", "add a rule against adverbs"). Keep fields the user did not touch; update only what the guidance demands. Return ONLY valid JSON matching the schema.';

export const PROSE_SAMPLE_SYSTEM =
  'You write a short prose sample (120-180 words) that exercises a given prose profile against a fully-specified seed scenario. The seed pins the character, setting, and observation — these are constants across every sample in the blind-comparison set. You must NOT rename the character, change the setting, or invent a different observation. Voice carries the difference: register, stance, rhythm, interiority, devices, rules. Return prose only — no preamble, no labels.';

/**
 * Prompt for extracting prose profile from text.
 * Register/stance/devices lists are register-neutral: they cover fiction,
 * non-fiction (memoir, essay, reportage, research, history, case study),
 * and simulation (works modelling real-life events from a stated rule set —
 * historical counterfactual, economic / policy / wargame / scenario / agent-
 * based / LitRPG-cultivation, where in-world mechanics drive events and any
 * diegetic overlay is narrative content). The LLM selects the value that
 * fits the source text, not a fiction-default.
 */
export function buildIngestProseProfilePrompt(text: string, existingProfile?: string): string {
  const existingBlock = existingProfile
    ? `  <existing-profile hint="Override where text suggests.">\n${existingProfile}\n  </existing-profile>\n`
    : '';

  return `<inputs>
${existingBlock}  <source-text>
${text}
  </source-text>
</inputs>

<instructions>
  <task>Extract prose profile — voice, style, craft choices.</task>

  <fields hint="Use snake_case for multi-word values.">
    <field name="register">conversational | literary | raw | lyrical | formal | sardonic | mythic | journalistic | scholarly | pedagogical | theoretical | polemical | systemic (rule-set foregrounded, mechanics drive events) | diegetic-log (HUD / dashboard / status sheet surfaces as narrative content)</field>
    <field name="stance">close_third | distant_third | first_person | omniscient | close_first | authorial | essayistic | reportorial | dialogic | choral</field>
    <field name="tense">past | present | future</field>
    <field name="sentenceRhythm">terse | flowing | staccato | varied | periodic | cumulative</field>
    <field name="interiority">surface | moderate | deep | stream_of_consciousness | analytical | evidentiary | state-tracked (agent's modelled state under the rule set, for simulation registers)</field>
    <field name="dialogueWeight">heavy | moderate | sparse | minimal | none</field>
    <field name="devices">Extract every device the source genuinely uses — no cap. Pick from a wide range; no single tradition is the default.
      <set name="dramatic-realist">free_indirect_discourse, dramatic_irony, unreliable_narrator, extended_metaphor, epistolary_fragments, stream_of_consciousness</set>
      <set name="lyric / fabulist / mythic / oral">refrain, litany, invocation, catalogue, direct_address, mythic_cadence, liturgical, oracular, call_and_response, frame_tale, magical_realist_baseline, lyric_digression, image_as_argument</set>
      <set name="polyphonic / experimental">polyvocality, code_switching, document_collage, metafiction, framing_commentary, silence_as_beat, typographic_constraint (Oulipo), translation_as_form, hybrid_essay_fiction</set>
      <set name="non-fiction">signposting, rhetorical_question, parallel_structure, case_study, counterargument_staging, citation_weaving, worked_example, braided_essay, auto_theory, archival_fragment, testimony, reportage_cadence</set>
      <set name="simulation">rule_statement, initial_conditions_block, state_transition_log, diegetic_overlay (HUD / status sheet / dashboard rendered in-world), tier_gate, finding_log, anomaly_log, scenario_branch, counterfactual_clause, mechanism_first_exposition, observer_log_voice</set>
      <note>Prefer devices that genuinely match the source's voice. When the source draws on a specific non-Western tradition (wuxia, kishōtenketsu, rasa, frame-tale, magical realism, polyvocality, ceremonial forms), name devices from that tradition; otherwise the Western / Anglo realist toolkit is the working default.</note>
    </field>
    <field name="rules">SPECIFIC imperatives for sentence-level craft — as many as the source's voice genuinely demands, no cap.</field>
    <field name="antiPatterns">SPECIFIC failures to avoid — as many as the source's voice genuinely defines against, no cap.</field>
  </fields>

  <quality-bar>
    <example type="bad">Write well.</example>
    <example type="good">Show emotion through physical reaction, never name it.</example>
    <example type="good">State the claim before the evidence, never bury the thesis in a narrative opener.</example>
    <example type="good">Let the image carry the argument; do not gloss it.</example>
  </quality-bar>
</instructions>

<output-format>
Return JSON:
{"register": "...", "stance": "...", "tense": "...", "sentenceRhythm": "...", "interiority": "...", "dialogueWeight": "...", "devices": [...], "rules": [...], "antiPatterns": [...]}
</output-format>`;
}

/**
 * Prompt for refining an existing profile with user guidance.
 * The existing profile is the baseline; the guidance is either pasted prose
 * the user wants the profile to move toward, or a natural-language instruction
 * ("make it more clinical", "drop the adverbs rule"). Untouched fields stay.
 */
export function buildRefineProseProfilePrompt(existingProfile: string, guidance: string): string {
  return `<inputs>
  <existing-profile hint="Baseline. Keep fields the guidance does not touch.">
${existingProfile}
  </existing-profile>
  <guidance hint="Pasted prose, editorial notes, OR a natural-language adjustment.">
${guidance}
  </guidance>
</inputs>

<instructions>
  <task>Return the existing profile updated according to the guidance. Preserve fields the guidance does not address — do not strip rules, devices, or values that are still valid.</task>

  <discipline>
    <rule>If the guidance is a prose sample, infer what changed (register, rhythm, interiority, devices) and update only those.</rule>
    <rule>If the guidance is editorial notes or a natural-language instruction, apply each instruction precisely. "More X" raises register, rhythm, or device weight in the direction of X; "less X" or "drop X" lowers or removes.</rule>
    <rule>Do not invent rules or anti-patterns the guidance does not justify. Do not regress untouched fields to generic defaults.</rule>
  </discipline>

  <fields>Same schema as ingest — register, stance, tense, sentenceRhythm, interiority, dialogueWeight, devices[], rules[], antiPatterns[]. Use snake_case for multi-word values.</fields>
</instructions>

<output-format>
Return JSON:
{"register": "...", "stance": "...", "tense": "...", "sentenceRhythm": "...", "interiority": "...", "dialogueWeight": "...", "devices": [...], "rules": [...], "antiPatterns": [...]}
</output-format>`;
}

/**
 * Prompt for generating a short prose sample that exercises a given profile.
 * Used by the blind taste test — multiple samples produced from the same seed
 * scenario but different profiles. Voice carries the difference, not content.
 */
export function buildProseSamplePrompt(profileBlock: string, seedScenario: string): string {
  return `<inputs>
  <prose-profile>
${profileBlock}
  </prose-profile>
  <seed-scenario hint="This scenario is constant across every sample in the comparison set. Character, setting, and observation are PINNED. Voice is the only thing that varies.">
${seedScenario}
  </seed-scenario>
</inputs>

<instructions>
  <task>Write 120-180 words of prose for the seed scenario in the voice of the profile above. The scenario is fully specified — character, setting, and the load-bearing observation are constants you MUST honour exactly.</task>

  <content-discipline hint="These are the controlled variables. If you change them, the comparison is broken.">
    <rule>Use the EXACT character name and identity given in the seed. Do not rename, re-gender, or re-age the character.</rule>
    <rule>Use the EXACT setting described in the seed. Do not relocate or re-skin it (no swapping a bedroom for an attic, an apartment for a house, a lab for a workshop).</rule>
    <rule>The OBSERVATION named in the seed is the only thing that has changed. Do not invent additional changes, additional anomalies, or additional discoveries. Do not substitute a different object for the one specified.</rule>
    <rule>Do not invent a backstory, a system, or a world-context the seed does not state. The seed gives you all the content you get.</rule>
  </content-discipline>

  <voice-discipline hint="This is where the profile shows.">
    <rule>Honour the profile's stance (POV) and tense exactly.</rule>
    <rule>Exercise at least two of the profile's devices visibly in the prose.</rule>
    <rule>Honour the profile's rules and antiPatterns.</rule>
    <rule>If the profile is non-fiction / analytical / simulation, the seed still applies — render the same character noticing the same thing in that register, do not switch to a different scenario.</rule>
  </voice-discipline>

  <output>
    <rule>Return prose only — no preamble, no headings, no labels, no quote marks around the whole sample.</rule>
  </output>
</instructions>`;
}
