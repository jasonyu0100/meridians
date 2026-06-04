/**
 * Prose-generation instructions block — appended to the user prompt for
 * `generateSceneProse`. Two variants depending on whether the scene has an
 * active beat plan: the planned variant carries beat-boundary markers and
 * a worked dialogue example; the freeform variant carries the same craft
 * doctrine without the beat machinery.
 */

import { modePriorityEntry } from "../phase/application";

/** Final assembly: inputs + format rules + instructions. The system prompt
 *  stays high-level (role only); craft detail lives here. */
export function buildSceneProseUserPrompt(args: {
  inputBlocks: string;
  instruction: string;
  formatRules?: string;
  toneCue?: string;
  proseVoiceOverride?: string;
  direction?: string;
}): string {
  const toneBlock = args.toneCue?.trim()
    ? `\n<tone hint="Match the genre and register of the world.">${args.toneCue.trim()}</tone>`
    : '';
  const voiceBlock = args.proseVoiceOverride?.trim()
    ? `\n<author-voice hint="PRIMARY creative direction — all craft defaults below are subordinate to this voice.">\n${args.proseVoiceOverride.trim()}\n</author-voice>`
    : '';
  const directionBlock = args.direction?.trim()
    ? `\n<scene-direction>\n${args.direction.trim()}\n</scene-direction>`
    : '';
  const formatRulesBlock = args.formatRules?.trim()
    ? `\n<format-rules>\n${args.formatRules.trim()}\n</format-rules>`
    : '';

  return `<inputs>
${args.inputBlocks}
</inputs>${toneBlock}${voiceBlock}${formatRulesBlock}${directionBlock}

${args.instruction}`;
}

/** Shared craft doctrine — used in both planned and freeform variants. */
const CRAFT_DOCTRINE = `
    <rhythm-and-voice>
      <law>The prose profile is law; defaults below apply only when the profile is silent.</law>
      <rule>Where the profile specifies a rhythm (terse, flowing, periodic, cumulative, fragmented, staccato), obey it. Hemingway and Saramago have opposite rhythms and both are correct.</rule>
      <default>Vary sentence length, front-load clauses, use appositives, avoid inertial subject-verb-object patterns.</default>
      <register-fit>Match the register the prose profile declares. A texture that suits one register reads as failure in another — exposition that the profile asks for is the register; the same exposition imposed where the profile asks for embodied scene is a register mismatch.</register-fit>
    </rhythm-and-voice>

    <specificity hint="The source's voice decides whether a fact surfaces through demonstration, direct statement, image, or citation. Vagueness is the only universal failure.">
      <rule>The reader comes to hold the fact as true. Whether earned by showing fear through trembling hands, by naming the thing that shifted, or by citing the source — depends on what the prose profile and source register call for.</rule>
      <example type="bad">"She felt something shift" — nothing named.</example>
      <example type="good">"Her hands would not stop" / "She named the thing that shifted" — named particular carries the weight.</example>
      <invariant>The test is specificity, not the verb.</invariant>
    </specificity>

    <dialogue-agency hint="Applies in any register where two or more named participants exchange substantive content. The surface form follows the profile — quoted speech, transcribed exchange, cited correspondence, paraphrase with attribution.">
      <intent>Participants with agency carry their own words. The dominant prose failure in this engine is treating multi-participant interactions as mute encounters resolved through gesture, narrated intent, or summary attribution.</intent>
      <trigger>Any beat where 2+ participants engage in a substantive exchange — negotiation, confrontation, interview, instruction, alliance, persuasion, accusation, request, refusal, reconciliation, contested claim and counter-claim — must surface as actual exchanged words (quoted, cited, or transcribed per register).</trigger>
      <rule name="dominant-not-exclusive">The beat's mechanism is the DOMINANT register, not a mute on the others. An action beat in a multi-participant moment can carry 1-3 lines of dialogue inside the action; a thought beat during a conversation can foreground POV reasoning while the spoken back-and-forth continues underneath; a narration beat summarising an exchange should still embed a representative line.</rule>
      <rule name="never-narrate-substance">If the plan says "X explains Y to Z", the prose contains X's actual explanation — and Z's responses, questions, pushback. Even one or two real lines per beat changes the texture from narrated-about to lived-through.</rule>
      <carve-out name="solitary-pov">Scenes with a single participant physically present (or a single authorial voice in expository registers) have no dialogue obligation; render via thought / action / environment / memory / document / narration as the plan and profile direct.</carve-out>
      <carve-out name="distant-register">Distant or summarising registers may report rather than dramatise — but the words still surface, even if reported, paraphrased, or cited. "She refused, in three sentences he would remember for years; the second was the worst." carries the weight without staging it.</carve-out>
    </dialogue-agency>

    <three-continuity-constraints>
      <constraint id="world">The POV perceives only what its senses and existing knowledge allow. New world deltas arrive through specific moments in the scene; not referenced before established.</constraint>
      <constraint id="threads">Each thread shift lands at a specific moment. Action, naming, statement, image — whichever the profile calls for.</constraint>
      <constraint id="system">New system concepts arrive with grounding — demonstration, citation, consequence, worked example, or framing. What counts as "earning" is register-dependent.</constraint>
    </three-continuity-constraints>

    <no-raw-ids critical="true">
      <rule>NEVER write an engine identifier into prose. Forbidden tokens: any "PREFIX-NUMBER" form — C-N, L-N, T-N, A-N, S-N, ARC-N, K-N, SYS-N, SYS-GEN-N. These are bookkeeping slugs, not language.</rule>
      <rule>Where the scene context surfaces a system node as <code>id="SYS-N"</code> with a concept, render the CONCEPT as in-world language ("the moonlight-wolf coaxing technique", "the assessment-cycle rule", "the propagation law that gates retaliation") — never the slug.</rule>
      <rule>Same for threads, characters, locations, artifacts: lift the NAME (or the question the thread is about). The ID is metadata; the concept is the world.</rule>
      <example type="bad">"He invoked SYS-12 to overrule the ruling."</example>
      <example type="good">"He invoked the elder-precedence rule to overrule the ruling."</example>
    </no-raw-ids>`;

export function buildProseInstructionsWithPlan(args: { wordsPerBeat: number }): string {
  const { wordsPerBeat } = args;
  return `<instructions>
  <integration-hierarchy hint="Priority order when inputs conflict.">
    <priority rank="1" critical="true">PARADIGM-SHAPE DIRECTIVE — defines what this 'scene' actually is in the work's paradigm. The directive is authoritative. When beat plan, prose profile, or scene context use scene-language that conflicts with the paradigm shape (e.g. the plan tags "dialogue" beats for a typology entry, or scene context names a POV for a chronicle), render to the paradigm — the directive overrides default storytelling form.</priority>
    <priority rank="2">BEAT PLAN — structural backbone WITHIN the paradigm; render every beat's propositions in the assigned mechanism and order.</priority>
    <priority rank="3">PROSE PROFILE — authorial voice; rules below apply only where the profile is silent.</priority>
    <priority rank="4">SCENE CONTEXT — POV, setting, participants, deltas; the substrate the beats render against.</priority>
    ${modePriorityEntry(5, "scene-prose")}
  </integration-hierarchy>

  <follow-plan>Each beat maps to a passage of output. The mechanism defines the delivery MODE (dialogue, thought, action, environment, narration, memory, document, comic); the propositions define FACTS TO TRANSMIT — in-world events, argued claims, observed evidence, rule-driven outcomes, modelled state transitions, agent decisions, recorded changes, classified attributes, contest moves; the paradigm-shape directive decides which of these the work actually carries. Weave both into the paradigm's voice.</follow-plan>

  <beat-boundary-markers hint="Open every beat with a marker line. Markers are stripped from final output.">
    Format: \`[BEAT:N]\` on its own line BEFORE the beat's prose — N is the 0-indexed beat number. Every beat opens with its marker, including beat 0. No closing marker; the next \`[BEAT:N+1]\` (or end of output) ends the previous beat. Example for a 3-beat scene:
    [BEAT:0]
    Prose for beat 0...
    [BEAT:1]
    Prose for beat 1...
    [BEAT:2]
    Prose for beat 2...
  </beat-boundary-markers>

  <reference name="mechanisms" hint="Delivery modes — what each beat's mechanism field tells the writer to do. Format-rules block above OVERRIDES this for non-prose formats.">
    <mechanism-catalog default-format="prose">
      <mechanism id="dialogue">
        <definition>A substantive EXCHANGE between participants — quoted speech, transcribed exchange, or cited positions placed in active dialogue with one another, depending on the profile. Not a single line with a tag — at least 3–5 turns, distinct voices, subtext (what is NOT said), interruptions or silences that carry weight, non-verbal or material business interleaved between lines. Dialogue carries the bulk of the beat's word budget. A "dialogue" beat that resolves in one or two lines has failed the mechanism.</definition>
        <craft-target hint="Shared across registers; texture varies by what the source register treats as substance.">
          Distinct voices, multi-turn, subtext carried by what is implied rather than stated, non-verbal or material business doing as much work as the spoken lines, silence or pause as a turn. What "subtext" is made of differs by register — interpersonal trust and power in fiction, methodological commitment and citation discipline in non-fiction argumentation, rule-state and modelled trajectory in simulation. Pick whichever the prose profile and source register call for.
        </craft-target>
        <worked-example beat="Marcus confronts Daniel about the missing ledger" register="fiction">
          <success-render>
            "The ledger." Marcus didn't sit. He set his palms flat on the table, as though the wood might lie if he didn't hold it down. "The one from the eastern storehouse."
            Daniel looked up from his tea. "You'll have to be more specific. I've signed off on four ledgers this week."
            "You know which one."
            "I know which one you've been losing sleep over." Daniel tilted the cup, watched a leaf fold in on itself. "That's a different question."
            Silence. Outside, a guard's footfall receded down the corridor, then returned, paused, moved on.
            "If the inspector finds discrepancies —"
            "He won't." Daniel set the cup down. His fingers were steady. "Because the ledger he sees will be the correct one." A small, almost fond smile. "I thought you trusted me, Marcus."
            Marcus's palms left marks on the wood. He didn't answer. He didn't need to.
          </success-render>
          <annotation>Distinct cadences (Marcus clipped, Daniel elliptical); subtext (accusation, evasion, power inversion) carried by what is implied rather than stated; non-verbal business (palms on the table, the tea leaf, the footsteps, the withheld answer) does as much work as the quoted lines; the silence at the midpoint is a turn.</annotation>
        </worked-example>
        <worked-example beat="Hossain and Ríos renegotiate the displacement-window cap mid-drought wargame" register="simulation">
          <success-render>
            "The cap sits at twelve thousand." Hossain didn't open her tablet. The figure was already on the shared dashboard, pulsing amber. "Lift it past fifteen and the eastern corridor saturates by Tuesday."
            Ríos studied his coffee. "The eastern corridor saturates anyway. Your model assumes orderly movement."
            "My model assumes the rules everyone signed."
            "The rules everyone signed assumed rainfall." He let the silence sit until the operator at the next station glanced over. "Lift it to eighteen for forty-eight hours. I'll absorb the corridor."
            "Absorb how. With what." She finally tapped the tablet. The R-coefficient line jumped, settled. "If your absorption isn't on the dashboard, it isn't real."
            Ríos didn't look at the dashboard. "It will be."
          </success-render>
          <annotation>Same craft target, simulation texture. Distinct registers (Hossain procedural and rule-bound, Ríos elliptical and pushing the rules); rule-driven subtext (each line is bounded by what the simulation permits — caps, model assumptions, dashboard truth); material business carrying weight (the unopened tablet, the operator's glance, the R-coefficient line jumping); silence again as the turn. Substance here is rule-state and modelled trajectory, not interpersonal trust — but the density and the way subtext does the work are the same.</annotation>
        </worked-example>
      </mechanism>
      <mechanism id="thought">Interior reasoning or private cognition rendered in the POV's voice — whatever form interiority takes in this register. In simulation register, interiority can include the agent's modelled state under the rules — what the rules force them to consider next.</mechanism>
      <mechanism id="action">Physical movement, gesture, interaction with objects, observable procedure. In simulation register, action can include rule-mediated procedure (a containment order being executed, a tariff schedule being applied, a cultivation breath-cycle being completed).</mechanism>
      <mechanism id="environment">Setting, weather, atmosphere, sensory or material details of the space. In simulation register, this extends to the modelled state of the environment under the rule set (current threat level, reproduction number, treaty status, qi density).</mechanism>
      <mechanism id="narration">Authorial / synthesising voice — rhetoric, time compression, signposting, framing. In simulation register, narration may include rule-state statements ("the front held under doctrine X for a further forty-eight hours") and instrumentation readouts ("R0 drifted to 1.4 by week six") as LOAD-BEARING content, not flavour — these statements ARE the events.</mechanism>
      <mechanism id="memory">A prior moment recalled or invoked by association.</mechanism>
      <mechanism id="document">Embedded text shown literally — letter, sign, excerpt, table, citation, screenshot, transcript. Simulation register often relies on documents (status sheets, finding logs, treaty texts, dashboard readouts) carrying canonical state.</mechanism>
      <mechanism id="comic">Humour, irony, absurdity, bathos, undercut expectations.</mechanism>
    </mechanism-catalog>

    <propositions hint="Facts the scene must establish. The source's voice dictates the mode of transmission.">
      <invariant>The reader comes to hold the fact as true. Demonstration, direct statement, image, or citation — whichever the prose profile calls for, applied to the specific particular this beat carries.</invariant>
      <example mode="sensory">"Mist covers the village" → dampness on skin, houses emerging from whiteness.</example>
      <example mode="direct-statement">"Mist covered the village, and the village stopped speaking of its dead."</example>
      <example mode="citation">"The research shows X" — stated, attributed, grounded.</example>
      <failure>Hedged language without a specific named claim.</failure>
    </propositions>
${CRAFT_DOCTRINE}

    <beat-sizing target="${wordsPerBeat}">
      <rule>Each beat is ~${wordsPerBeat} words. Light beats may land at ~${Math.round(wordsPerBeat * 0.7)}; dense dialogue or action beats with many propositions may stretch to ~${Math.round(wordsPerBeat * 1.3)}.</rule>
      <rule>Consecutive beats stay comparable in length unless the plan's mechanism explicitly calls for contrast.</rule>
      <rule>Don't pad to hit the target; don't cut propositions to fit.</rule>
    </beat-sizing>

    <closing-rules>
      <rule name="profile-compliance">Every sentence conforms to the voice, register, devices, and rules declared in the prose profile. If the profile forbids figurative language, use zero figures of speech. If it requires specific devices, use them.</rule>
    </closing-rules>
  </reference>
</instructions>`;
}

export function buildProseInstructionsFreeform(args: { wordsPerBeat: number }): string {
  const { wordsPerBeat } = args;
  return `<instructions>
  <integration-hierarchy hint="No beat plan in this mode.">
    <priority rank="1" critical="true">PARADIGM-SHAPE DIRECTIVE — defines what this 'scene' actually is in the work's paradigm. The directive is authoritative; when other inputs conflict, render to the paradigm.</priority>
    <priority rank="2">PROSE PROFILE — authorial voice; rules below apply only where the profile is silent.</priority>
    <priority rank="3">SCENE CONTEXT — POV, setting, participants, deltas.</priority>
    ${modePriorityEntry(4, "scene-prose")}
  </integration-hierarchy>

  <reference name="craft-doctrine">
${CRAFT_DOCTRINE}

    <delivery-mandate>
      <rule>Render every thread shift, world change, relationship delta, and system reveal in the mode the profile declares.</rule>
      <rule>Foreshadow through imagery, subtext, or explicit framing per profile.</rule>
    </delivery-mandate>

    <beat-sizing target="${wordsPerBeat}">
      <rule>Even without a plan, think in ~${wordsPerBeat}-word beats — one beat ≈ one paragraph or tight scene moment.</rule>
      <rule>If a single beat runs past ~${wordsPerBeat * 2} words, it's probably two beats.</rule>
    </beat-sizing>

    <opening-transition hint="Weave time-gap into texture, never as timestamp. The scene's <time-gap> block carries a transition attribute when one is supplied — that natural-language phrase IS the prose-level signal for the gap; honour it (verbatim, paraphrased, or as texture).">
      <gap level="minor" magnitude="concurrent | hours | same-day | multi-day">Texture only — a small change in light, posture, wear, attention, or where a thought picks up. NEVER write "X hours later".</gap>
      <gap level="notable" magnitude="multi-week">A clearer signal — a season turning, a project moved on, a wound healing, a draft revised, a citation freshened.</gap>
      <gap level="major" magnitude="multi-month">Weight the opening with a re-anchor — status update, changed condition, recapitulation of where things stood. Naming elapsed time directly is permitted when it carries force.</gap>
      <gap level="generational" magnitude="year+">Mark with weight — compressed passage, aged-up description, generational reframing, environmental change. Underplaying reads as continuity error.</gap>
      <gap level="flashback" magnitude="negative — earlier on the timeline">Open by anchoring the jump BACKWARD: a memory rising under present pressure, an excerpt from earlier records, a remembered scene, a dispatch from before the prior scene. Reader must register that the timeline has reversed — the prior scene's present remains the reference point.</gap>
    </opening-transition>

    <closing-rules>Every sentence conforms to the declared voice, register, devices, and rules.</closing-rules>
  </reference>
</instructions>`;
}
