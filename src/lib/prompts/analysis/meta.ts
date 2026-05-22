/**
 * Meta extraction prompt — runs at the end of corpus analysis to derive the
 * narrative's image style, prose profile, plan guidance, genre/subgenre, and
 * pattern / anti-pattern commandments. Reads the assembled world context
 * (entities, threads, scene summaries, prose excerpts) and returns the meta
 * block that gets persisted to the narrative. Register-neutral.
 */

export const META_EXTRACTION_SYSTEM =
  'You are a literary analyst. Extract the visual style and prose voice of a narrative. Return only valid JSON.';

export function buildMetaExtractionPrompt(args: { metaContext: string }): string {
  return `<inputs>
  <meta-context hint="World summary, entity/thread data, scene summaries, and prose excerpts.">
${args.metaContext}
  </meta-context>
</inputs>

<instructions>
  <task>Extract the visual style, prose voice, plan guidance, paradigm, genre, and pattern / anti-pattern commandments for this narrative.</task>

  <field name="paradigm" hint="One of the SIX canonical paradigms the engine supports. Pick EXACTLY one — this drives the world-shape every downstream generation pass operates under.">
    <option name="fiction">Invented people in an invented world. World shape: populated narrative.</option>
    <option name="non-fiction">Real people, real places, documented events — memoir, biography, history, reportage. World shape: populated narrative.</option>
    <option name="simulation">Rule-driven modelling of real-life events with in-world figures the rules act on — counterfactual, wargame, agent-based, cultivation / xianxia where in-world mechanics drive events. World shape: populated narrative + load-bearing system rules.</option>
    <option name="analysis">Thesis-driven analytical work pursued by a TEAM of AI agents collaborating to develop the thesis. World shape: agentic-ai-team with single-word AI agent names.</option>
    <option name="paper">Research paper presenting a finding with methods + testable prediction. World shape: singular thinker (one named author + cited interlocutors).</option>
    <option name="essay">An extended argument from a single named author's voice. World shape: singular thinker.</option>
  </field>

  <field name="imageStyle">A short (1-2 sentence) visual style description for consistent imagery.</field>

  <field name="proseProfile" hint="Infer the author's distinctive voice and style. Choose values that describe this specific work, not generic labels.">
    <subfield name="register">conversational | literary | raw | clinical | sardonic | lyrical | mythic | journalistic | scholarly | pedagogical | theoretical | polemical | (or other)</subfield>
    <subfield name="stance">close_third | intimate_first_person | omniscient_ironic | detached_observer | unreliable_first | authorial | essayistic | reportorial | (or other)</subfield>
    <subfield name="tense">past | present</subfield>
    <subfield name="sentenceRhythm">terse | varied | flowing | staccato | periodic | (or other)</subfield>
    <subfield name="interiority" hint="What the POV's interior is made of — fiction tends to character thought (surface | moderate | deep | embedded), non-fiction tends to reasoning/evidentiary framing (analytical | evidentiary), simulation tends to the agent's modelled state under the rule set (state-tracked). Pick the value that fits the source; coin a new one if none of these match.">surface | moderate | deep | embedded | analytical | evidentiary | state-tracked</subfield>
    <subfield name="dialogueWeight">sparse | moderate | heavy | almost_none</subfield>
    <subfield name="devices">2-5 literary devices this author characteristically employs (specific, not generic). Pick from the toolkit the source genuinely uses — whatever register the source occupies, name the devices it actually deploys (e.g. free indirect style, anaphora, signposting, counterargument-staging, case-study framing, citation-weaving, leitmotif, rule-statement-then-application, scenario-step-tracking, diegetic status overlay).</subfield>
    <subfield name="rules" hint="Derive from what the author DOES.">
      3-6 SPECIFIC prose rules as imperatives — concrete enough to apply sentence-by-sentence.
      <example type="bad">Write well.</example>
      <example type="good">Show emotion through physical reaction, never name it.</example>
      <example type="good">No figurative language — just plain statements of fact.</example>
      <example type="good">Exposition delivered only through discovery and dialogue.</example>
      <example type="good">State the claim before the evidence; never bury the thesis in a narrative opener.</example>
    </subfield>
    <subfield name="antiPatterns" hint="Derive from what the author does NOT do.">
      3-5 SPECIFIC prose failures to avoid.
      <example type="bad">Don't be boring.</example>
      <example type="good">NEVER use 'This was a [Name]' to introduce a mechanic — show what it does.</example>
      <example type="good">No strategic summaries in internal monologue ('He calculated that...') — show calculation through action.</example>
      <example type="good">Do not follow a reveal with a sentence restating its significance.</example>
      <example type="good">Do not hedge a strong claim with 'perhaps' or 'arguably' when the evidence supports it.</example>
    </subfield>
  </field>

  <field name="planGuidance">2-4 sentences of specific guidance for scene beat plans. What mechanisms should dominate? How should exposition / evidence be handled? What should plans avoid? Be specific to this work's voice.</field>

  <field name="patterns" count="3-5" hint="Positive thematic commandments — what makes THIS narrative good. Derive from the work's declared register and subject.">
    <consider>Conventions the work embraces and executes well, whatever its register.</consider>
    <consider>Structural patterns that define the work's rhythm.</consider>
    <consider>Entity dynamics characteristic of the work — relationships between the participants the source actually carries (people, institutions, claims, sources, modelled agents under the rule set).</consider>
    <note>NOT prose style — that lives in proseProfile.</note>
    <example>Every cost paid must compound into later consequence.</example>
    <example>The underdog earns every advantage through sacrifice, never luck.</example>
    <example>Every claim is paid for in evidence before it is extended.</example>
    <example>Counter-evidence is staged before the position is taken.</example>
    <example>Every consequence follows from a rule already declared; no novel outcome appears without its rule on the page.</example>
  </field>

  <field name="antiPatterns" count="3-5" hint="Negative narrative commandments — what to avoid in THIS work.">
    <consider>Conventions the work actively subverts or avoids.</consider>
    <consider>Common pitfalls in this register.</consider>
    <consider>Patterns that would break THIS work's tone.</consider>
    <example>No unseeded resolutions — solutions must be planted before they pay off.</example>
    <example>No convenient capability gains without prior setup.</example>
    <example>Adversaries cannot be stupid just to let the anchor entity win.</example>
    <example>No claim asserted without evidence the prior text has earned.</example>
    <example>No outcome that the declared rule set would not force under the given conditions; do not bend rules for narrative convenience.</example>
  </field>
</instructions>

<output-format>
Return JSON:
{
  "paradigm": "one of: fiction | non-fiction | simulation | analysis | paper | essay — EXACTLY one of these six values, no other strings allowed",
  "imageStyle": "style directive",
  "genre": "primary register or genre within the paradigm (e.g. literary fiction, memoir, lyric essay, criticism, longform journalism, investigative reportage, theoretical paper, empirical paper, archival history, historical counterfactual, policy / wargame scenario, agent-based study, LitRPG / cultivation).",
  "subgenre": "specific subgenre or sub-form (e.g. progression fantasy, cozy mystery, autotheory, ablation paper, war reportage, oral history, Mughal-succession counterfactual, monetary-policy wargame, pandemic propagation scenario, cultivation-tier xianxia) — pick the most identifying form.",
  "proseProfile": {
    "register": "tonal register — e.g. 'literary, low-key', 'wry academic', 'plainspoken reportage'",
    "stance": "narrator's distance — e.g. 'close third', 'omniscient', 'detached observer'",
    "tense": "grammatical tense — e.g. 'past', 'present'",
    "sentenceRhythm": "structural cadence — e.g. 'short clauses with periodic long sweeps', 'cumulative compound'",
    "interiority": "depth into POV interior — e.g. 'shallow, action-led', 'frequent free-indirect thought'",
    "dialogueWeight": "share given to dialogue — e.g. 'dialogue-heavy', 'sparse, expository only'",
    "devices": ["device1", "device2"],
    "rules": ["prose rule 1", "prose rule 2"],
    "antiPatterns": ["anti-pattern 1", "anti-pattern 2"]
  },
  "planGuidance": "How beat plans should be structured for this work",
  "patterns": ["narrative pattern 1", "narrative pattern 2"],
  "antiPatterns": ["narrative anti-pattern 1", "narrative anti-pattern 2"]
}
</output-format>`;
}
