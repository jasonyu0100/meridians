/**
 * Ingestion Prompts
 *
 * Prompts for parsing pasted text into structured world data.
 *
 * Only the prose-profile path is wired in the current pipeline. The earlier
 * rules / systems extractors (buildIngestRulesPrompt / buildIngestSystemsPrompt
 * + their SYSTEM constants) were never called and were removed in the
 * prompt-cleanup pass — restore from git history if those extractors come back.
 */

export const INGEST_PROSE_PROFILE_SYSTEM =
  'You extract a prose profile — voice, register, stance, devices, rules, anti-patterns — from pasted text. Pick values that genuinely match the source; do not default to any single tradition\'s toolkit. Read the source on its own terms. Return ONLY valid JSON matching the schema in the user prompt.';

export const DERIVE_PROSE_PROFILE_SYSTEM =
  'You derive a prose profile from a narrative\'s own context (entities, threads, prose excerpts) rather than a pasted style guide. Read the source\'s register from its own voice; do not import conventions the source does not earn. Return ONLY valid JSON matching the schema in the user prompt.';

/**
 * Prompt for extracting prose profile from text.
 * Extracts voice, stance, devices, and rules.
 *
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
 * Prompt for deriving a prose profile from a narrative's own context
 * (characters, threads, prose excerpts) rather than a pasted style guide.
 * `context` is pre-built — pass the formatted narrative context block.
 */
export function buildDeriveProseProfilePrompt(context: string): string {
  return `<inputs>
  <narrative-context>
${context}
  </narrative-context>
</inputs>

<instructions>
  <task>Derive the prose profile that best fits this narrative's voice. Read the source on its own terms; do not import conventions the source does not earn.</task>

  <consider>
    <factor>What register suits this narrative's subject and intended readership? Detect across the three first-class registers — fiction, non-fiction, simulation. Simulation cues: a rule set is surfaced as load-bearing; in-world mechanics drive events; outcomes are rule-driven rather than authorial; diegetic overlays (HUD, log, dashboard, status sheet, tier gate) appear as narrative content.</factor>
    <factor>What stance and tense fit the work as written? In simulation registers, stance often tracks an observer or modelled agent.</factor>
    <factor>What sentence rhythm matches the pacing?</factor>
    <factor>How deep should interiority go? Where the source operates analytically, interiority maps to reasoning and evidentiary framing rather than private thought. In simulation registers, interiority can map to the agent's modelled state under the rules.</factor>
    <factor>What rhetorical devices would serve this work? Pick from the toolkit the source genuinely uses.</factor>
    <factor>What craft rules should guide prose generation? (SPECIFIC imperatives, not generic advice.)</factor>
    <factor>What specific prose failures would break this voice? (Concrete anti-patterns.)</factor>
  </consider>

  <quality-bar hint="Derive from the declared voice, not from one school's doctrine.">
    <bad>Write well / Be descriptive / Show don't tell / any universal platitude.</bad>
    <good>Show emotion through physical reaction when stakes are high; name it when reflecting at distance.</good>
    <good>Let the image carry the argument — weather, object-mood, and gesture are world-claims, not decoration.</good>
    <good>Frontload the claim; let evidence earn it sentence by sentence.</good>
    <good>Rotate voice per section; never let one register dominate for more than two sections running.</good>
    <good>Each recurrence must carry a named variation — a new detail, a shifted POV, an inverted outcome.</good>
    <bad-anti-pattern>Don't be boring / Avoid bad prose.</bad-anti-pattern>
    <good-anti-pattern>NEVER use 'This was a [Name]' to introduce a mechanic — show what it does.</good-anti-pattern>
    <good-anti-pattern>Do not hedge a strong claim with 'perhaps' or 'arguably' when you have the evidence to back it.</good-anti-pattern>
    <good-anti-pattern>Do not follow an image with a sentence that explains the image.</good-anti-pattern>
  </quality-bar>

  <coverage>Extract as many devices, rules, and anti-patterns as the source genuinely carries — no cap on any. Use snake_case for multi-word values.</coverage>
</instructions>

<output-format>
Return JSON:
{"register": "...", "stance": "...", "tense": "...", "sentenceRhythm": "...", "interiority": "...", "dialogueWeight": "...", "devices": [...], "rules": [...], "antiPatterns": [...]}
</output-format>`;
}
