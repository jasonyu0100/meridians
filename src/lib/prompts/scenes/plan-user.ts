/**
 * User prompts for the scene-plan pipeline:
 * - `buildScenePlanUserPrompt` — primary plan generator. Single-call: extract
 *   compulsory propositions from scene structural data AND build the beat plan
 *   that lands them, in one pass.
 * - `buildScenePlanEditUserPrompt` — repair pass.
 * - `buildBeatAnalystUserPrompt` — reverse-engineering pass that annotates
 *   ~100-word prose chunks with beat fn/mechanism/propositions.
 */

import { BEAT_FN_LIST, BEAT_MECHANISM_LIST } from "@/types/narrative";
import { PROMPT_BEAT_TAXONOMY } from "../core/beat-taxonomy";
import { PROMPT_PROPOSITIONS } from "../core/propositions";
import { modePriorityEntry } from "../mode/application";
import { WORDS_PER_BEAT, BEATS_PER_SCENE, WORDS_PER_SCENE } from "@/lib/constants";

export function buildScenePlanUserPrompt(args: {
  /** Pre-built input blocks joined into the `<inputs>` body. */
  inputBlocks: string;
}): string {
  return `<inputs>
${args.inputBlocks}
</inputs>

<integration-hierarchy hint="Priority order when inputs conflict.">
  <priority rank="1">SCENE STRUCTURAL DATA — every delta, event, and named element in the summary becomes a compulsory proposition; coverage is non-negotiable.</priority>
  <priority rank="2">BEAT SLOTS — sampler-assigned fn/mechanism. Copy verbatim.</priority>
  <priority rank="3">PROSE PROFILE — voice rules; beats inherit voice from the profile.</priority>
  <priority rank="4">SCENE GROUNDING — visual + continuity; bridge propositions glue here when the moment calls them.</priority>
  ${modePriorityEntry(5, "scene-plan")}
</integration-hierarchy>

<beat-sizing>
Each beat is ~${WORDS_PER_BEAT} words carrying 2–6 propositions (more in dense registers). Pack each beat to capacity, then roll overflow into a new beat. Every compulsory proposition and every structural delta lands in at least one beat — beats are cheap, lost claims are not. Reference envelope: ~${WORDS_PER_SCENE} words / ~${BEATS_PER_SCENE} beats standard; 4–6 for a breather; 14–18 for a richly-threaded scene.
</beat-sizing>

<profile-conformance>The PROSE PROFILE in context dictates style. Propositions must conform — plain factual if figurative is forbidden, evocative if allowed.</profile-conformance>

<output-format>
Return ONLY valid JSON:
{
  "compulsoryPropositions": [
    {"content": "single in-world fact in natural prose", "type": "free-label"}
  ],
  "beats": [
    {
      "fn": "${BEAT_FN_LIST.join("|")}",
      "mechanism": "${BEAT_MECHANISM_LIST.join("|")}",
      "what": "STRUCTURAL SUMMARY: what happens, not how it reads",
      "propositions": [
        {"content": "atomic claim", "type": "state|claim|definition|formula|evidence|rule|comparison|example"}
      ]
    }
  ],
  "propositions": [{"content": "atomic claim", "type": "state"}]
}
</output-format>

${PROMPT_BEAT_TAXONOMY}

${PROMPT_PROPOSITIONS}

<instructions>
  <task>Two-step single pass: (1) EXTRACT compulsory propositions from the scene structural data — every delta, event, and named element in the summary; (2) GLUE them into narrative flow as a beat plan — reorder for effect, group into beats, vary mechanisms, enrich with bridge propositions drawn from grounding and narrative context. Coverage of the compulsory list is non-negotiable; every compulsory proposition emitted in step 1 must also appear in some beat in step 2. Prose voice belongs to the prose stage — your job is the skeleton.</task>

  <extraction hint="Step 1 — compulsory propositions from the scene structural data block.">
    <definition>A compulsory proposition is a fact the prose MUST establish for the scene to count as having happened. Not atmosphere. Not craft flourish. A discrete, checkable claim phrased as natural prose that a reader can absorb directly — the prose writer drops it into a beat without rephrasing.</definition>
    <phrasing-discipline critical="true">
      <rule name="natural-language">Write as prose-ready statements about WHAT IS TRUE in the world. Past or present tense in the world's voice — not the engine's metadata.</rule>
      <rule name="no-identifier-echo">Never echo internal identifiers, snake_case event names, or system-node ids. Translate "instrument_malfunction" / "adaptive_countermeasure" / "SYS-7" into the actual phenomenon.</rule>
      <rule name="no-template-scaffolding">Do NOT write "An X event occurred" or "The thread 'Y' has shifted to 'Z', indicating W." Drop the framing entirely and state the in-world fact directly.</rule>
      <rule name="thread-shifts-as-events">For thread-shifts: do NOT quote the thread's question text or name its lifecycle status. Describe what actually happens in the scene that moves that thread. Threads frame as open questions across any register: dramatic ("will the alliance hold"), evidentiary ("does the chain of custody survive cross-examination"), argumentative ("does the proposed mechanism explain the residual"), or rule-driven ("does the front hold under doctrine X" / "does the SEIR curve cross threshold by week N" / "does the cultivation tier break"). Whichever the source carries, the proposition states the in-world event that moves it.</rule>
      <rule name="single-claim">One proposition = one atomic fact. Don't bundle multiple claims behind "and" or commas-as-ands.</rule>
      <rule name="no-cognition-collapse" critical="true">Cognitive content in the summary — named scenarios, weighed tradeoffs, derived conclusions, planned contingencies, modelled agent reactions — MUST decompose into one proposition per named element. Never collapse "considered scenarios A, B, and C" into a single "modelled potential paths." One scenario = one proposition.</rule>
    </phrasing-discipline>
    <coverage>
      <source name="summary" critical="true">PRIMARY SOURCE — extract exhaustively. Every discrete claim, named scenario, weighed tradeoff, derived conclusion, planned contingency, modelled agent reaction, articulated rule, and stated commitment becomes its own proposition. Dense summaries routinely emit 20+ propositions from the summary block alone.</source>
      <source name="thread-shifts">The in-world event that moves this thread.</source>
      <source name="world-changes">One proposition per added node, framed as a present-tense fact about the entity.</source>
      <source name="system-reveals">The world rule itself, stated as the world states it.</source>
      <source name="relationship-shifts">The concrete shift.</source>
      <source name="artifact-transfers">The transfer.</source>
      <source name="tie-changes">The tie established or severed.</source>
      <source name="artifact-usages">What the artifact does, concretely.</source>
      <source name="movements">The arrival/departure as in-world action.</source>
      <source name="events">The underlying happening — translate the event label into prose.</source>
      <source name="new-entities">That this entity now exists, plus one proposition per meaningful world-node they carry in.</source>
    </coverage>
    <completeness critical="true">There is no proposition budget. Under-extraction collapses the prose's resolution back to whatever the summary's gestures named. Do NOT deduplicate across delta types — each delta is its own commitment even if surface wording overlaps.</completeness>
  </extraction>

  <grounding-selection>
    Match mechanism to fact: visual ↔ environment/action/first-presence; beliefs/secrets/goals ↔ thought/dialogue; history/relation ↔ memory/callback; capability/weakness ↔ action under pressure. Surface a continuity fact only when THIS beat would naturally call it up. One or two glue facts per beat. Visual identity surfaces at least once per scene per visible participant. Bridge propositions read as callbacks (already-known); compulsory propositions read as fresh commitments.
  </grounding-selection>

  <opening-shape hint="Weave time-gap into texture, never as timestamp. Gap size shifts how visible the weaving is, not whether it happens. The scene's timeDelta carries direction (forward / concurrent / flashback) and may carry a transition natural-language phrase — surface that phrase or its sense in the opening beat.">
    <gap size="minor" range="concurrent · hours · same-day · multi-day">Texture only — light, mood, weather, wear, what's changed.</gap>
    <gap size="notable" range="multi-week">Clearer signal — a season turning, a project moved on, a wound healing.</gap>
    <gap size="major" range="multi-month">Weight with a re-anchor beat (status update, changed season, plan bearing fruit). Naming elapsed time directly is permitted when it carries force.</gap>
    <gap size="generational" range="year+">Acknowledge with weight — montage, aged-up reveal, environmental change.</gap>
    <gap size="flashback" range="negative — earlier on the timeline">First beat anchors the jump BACKWARD: a memory triggered, an excerpt from earlier records, a dispatch from before, a remembered scene that surfaces under present pressure. The reader must register that we have moved BACKWARD; the prior scene's present remains the reference point.</gap>
  </opening-shape>

  <transition-discipline hint="The scene's timeDelta carries an optional natural-language transition phrase (e.g. 'the next morning', 'years before, when she was a child', 'later that same evening'). When supplied, this phrase IS the prose-level transition signal — the opening beat should land it (verbatim, paraphrased, or restructured into texture) so the elapsed time reads naturally.">
    <rule>If the timeDelta carries a transition phrase, the opening beat MUST honour it — either incorporate the phrase directly when register supports it, or render its sense through texture (the morning light, the season turned, the years now visible on a face, the memory rising under present pressure).</rule>
    <rule>For flashback transitions (negative timeDelta), the transition phrase typically anchors the jump back ("years before...", "the night before the funeral..."). Use it; do not render a forward-flowing opening when the timeDelta points backward.</rule>
    <rule>Concurrent scenes (timeDelta = 0) typically need no opening transition — the scene continues from the prior moment from a different vantage. If a transition phrase is supplied for a concurrent scene, it is usually a vantage-shift signal ("meanwhile, across the city...") rather than a time signal.</rule>
  </transition-discipline>

  <rules>
    <rule name="opening">Most scenes open with 1–3 breathe beats establishing context — physical detail in fiction, evidentiary state in non-fiction, rule-state / initial conditions in simulation. Scenes structured as in-medias-res, epistolary, thesis-first essay, dream-logic, direct-address, refrain/invocation, or scenario briefing may open with their structural device — the prose profile or form declaration decides.</rule>
    <rule name="beat-weight">Each beat must carry concrete content under its declared fn — a proposition stated, a delta delivered, or the function meaningfully discharged (a turn, a shift, a reveal, etc). Beats with no payload are padding — cut them and the prose budget with them.</rule>
    <rule name="delta-coverage">Every structural delta (thread, world, relationship, system knowledge) maps to at least one beat. Thread transitions need a concrete trigger in 'what'; knowledge gains need a discovery mechanism (overheard, read, deduced, confessed, cited, witnessed); relationship shifts need a catalytic moment.</rule>
    <rule name="specificity">"She asks about the missing shipment; he deflects" — not "A tense exchange."</rule>

    <rule name="what-field" hint="'what' is a structural summary, not pre-written prose. Strip adjectives, adverbs, literary embellishment. Scaffold the mechanism so the prose writer can deliver both facts and rendering — give enough structure that quoted lines, specific physical moves, or named sensory details can be rendered without invention.">
      <mechanism name="dialogue">WHO speaks to WHOM, the SUBJECT, the TENSION/subtext. Example: "Lin pushes Marcus on the timeline; Marcus deflects with small talk about the weather, sizing up Lin's resolve."</mechanism>
      <mechanism name="action">SPECIFIC physical events, actors, affected targets. Example: "Adaeze swings the bar at the lock while Tomas drags the body clear."</mechanism>
      <mechanism name="thought">MENTAL OPERATION and its subject. Example: "Priya runs through the last three hires, hunting the pattern Daniels flagged."</mechanism>
      <mechanism name="environment">SENSORY/SPATIAL elements foregrounded. Example: "The kitchen still ticks warm, back door hanging open to wet grass."</mechanism>
      <mechanism name="narration">SYNTHETIC operation (time compression / signposting / commentary). Example: "Three weeks of routines compressed into a paragraph." In simulation register, narration may carry rule-state statements as load-bearing content: "The mobilisation order propagates through six prefectures in four days, and by day five the modelled supply-line stress crosses the 0.6 doctrine-X threshold."</mechanism>
      <mechanism name="memory">TRIGGER and what's RECALLED. Example: "Cardamom on the air pulls her back to her grandmother teaching her to read the night patrols."</mechanism>
      <mechanism name="document">DOCUMENT TYPE and its CONTENT. Example: "A telegram from Salim: three lines confirming the meeting, warning her to come alone." Simulation-register example: "The week-six surveillance bulletin: R0 measured at 1.41 across the eastern prefectures, doubling time 6.2 days, two new cluster sites flagged."</mechanism>
      <mechanism name="comic">COMIC DEVICE and its TARGET. Example: "The aide's offended mutter lands as bathos against the tension."</mechanism>
    </rule>

    <rule name="fixed-beat-slots" hint="When the sampler provides slots, fn and mechanism are pre-assigned.">
      Copy fn and mechanism verbatim into the beat output, in order. Authorship is limited to 'what' and 'propositions'. Slots encode the narrative's voice; overriding them drifts the voice. Stop early if content fits fewer beats; continue past the last slot if more are needed (sampler extends server-side).
      Fallback when no slots provided: pick fn and mechanism from the taxonomy; aim for 3+ distinct mechanisms across a multi-beat scene; default toward dialogue when two beats could plausibly be either dialogue or action/narration — dialogue is the mechanism LLMs habitually under-weight. Solitary POV, contemplative montage, or analytical register override.
    </rule>

    <rule name="mechanism-rendering">Mechanism names the DOMINANT register, not the exclusive one. A dialogue beat plans a SUBSTANTIVE exchange — multiple turns with subtext; a single tagged quote is not dialogue. If a slot's mechanism feels off for the scene (dialogue in solitary POV or single-author expository register), render creatively within that mechanism (interior speech, muttered aside, conversation with an absent party, quoted source positions placed in dialogue) rather than substituting — the mix is the voice. Non-dialogue beats in interaction scenes can embed dialogue snippets when participants are present together; the prose writer reads the scaffolding and decides per beat.</rule>

    <rule name="dialogue-agency" critical="true" hint="The dominant failure mode is treating multi-party exchanges as mute encounters resolved through gesture, narrated intent, or interior thought. Participants with stakes carry their own words — quoted, cited, or transcribed in whatever shape the profile calls for.">
      When a scene has 2+ participants in a substantive exchange (negotiation, confrontation, interview, instruction, alliance, persuasion, accusation, reconciliation, request, refusal, contested claim and counter-claim), at least one beat's 'what' must scaffold the actual exchange: WHO says WHAT to WHOM, with the substance, NOT just the outcome. Example: "First denial collapses when the counterpart names the specific incident; the cornered party bargains for terms; the other grants none." If the sampler's slot for an interaction-heavy moment is thought/action/narration and the content is genuinely a multi-party exchange, add an extra dialogue beat beyond the sampled slots — better one extra dialogue beat than parties negotiating in silence.
    </rule>
  </rules>
</instructions>`;
}

export function buildScenePlanEditUserPrompt(args: {
  fullContext: string;
  sceneSummary: string;
  currentPlanJson: string;
  issueXml: string;
  beatFnList: string;
  beatMechanismList: string;
}): string {
  const { fullContext, sceneSummary, currentPlanJson, issueXml, beatFnList, beatMechanismList } = args;

  return `<inputs>
  <narrative-context hint="Branch-scoped continuity backdrop.">
${fullContext}
  </narrative-context>
  <scene-summary>${sceneSummary}</scene-summary>
  <current-plan>
${currentPlanJson}
  </current-plan>
  <issues hint="Every issue must be addressed in the returned plan.">
${issueXml}
  </issues>
</inputs>

<vocabulary>
  <beat-functions>${beatFnList}</beat-functions>
  <mechanisms>${beatMechanismList}</mechanisms>
</vocabulary>

<task>
Edit the plan to address every issue. Modify only beats the feedback targets — keep unchanged beats EXACTLY as-is (same fn, mechanism, what, propositions). Same beat count unless feedback explicitly requests adding/removing. You may modify fn/mechanism/what/propositions, add beats (fill gaps), remove beats (redundant/contradictory), or reorder (sequencing wrong). Preserve the overall scene arc.
</task>

<propositions>
2–4 atomic claims per beat in routine registers; dense, argumentative, or rule-driven registers may carry more. Extract concrete events, physical or institutional states, beliefs/goals/discoveries, world rules, relationship or stance shifts, named claims with warrants, rule-state transitions. Skip atmospheric texture and decorative flourish. When you modify a beat's 'what' field, update its propositions to match.
</propositions>

<what-field-discipline>
'what' is a STRUCTURAL SUMMARY, not pre-written prose. Strip adjectives, adverbs, literary embellishments. State the event, not its texture. Good: "Guard confronts him about the forged papers." Bad: "He muttered, 'The academy won't hold me long'" (pre-written prose with quotes).
</what-field-discipline>

<output-format>
Return the COMPLETE plan (all beats, not just changed ones) as JSON:
{
  "beats": [
    { "fn": "${beatFnList}", "mechanism": "${beatMechanismList}", "what": "...", "propositions": [{"content": "..."}] }
  ],
  "propositions": [{"content": "..."}]
}
</output-format>`;
}

export function buildBeatAnalystUserPrompt(args: {
  summary: string;
  chunkCount: number;
  chunksJson: string;
}): string {
  return `<inputs>
  <scene-summary>${args.summary}</scene-summary>
  <chunks count="${args.chunkCount}" hint="~100 words each. One beat per chunk, in order.">
${args.chunksJson}
  </chunks>
</inputs>

<output-format>
Return ONLY valid JSON:
{
  "beats": [
    {
      "index": 0,
      "fn": "${BEAT_FN_LIST.join("|")}",
      "mechanism": "${BEAT_MECHANISM_LIST.join("|")}",
      "what": "STRUCTURAL SUMMARY: what happens, not how it reads",
      "propositions": [
        {"content": "atomic claim", "type": "state|claim|definition|formula|evidence|rule|comparison|example"}
      ]
    }
  ]
}
</output-format>

${PROMPT_BEAT_TAXONOMY}

${PROMPT_PROPOSITIONS}

<task>
Annotate each chunk with its beat function, mechanism, and propositions. Mechanism must match how the prose was actually written (see beat taxonomy). Extraction density follows the source — light registers 1–2 props/beat, dense registers exhaustive. 'what' is a structural summary: strip adjectives, adverbs, embellishments. Good: "Guard confronts him about the forged papers."
</task>

<constraints>
  <constraint>Return EXACTLY ${args.chunkCount} beats, indexed 0 through ${args.chunkCount - 1}. Do NOT merge, skip, or add chunks.</constraint>
  <constraint>Every beat needs fn, mechanism, and what.</constraint>
  <constraint>Use ONLY these 10 beat functions: breathe, inform, advance, bond, turn, reveal, shift, expand, foreshadow, resolve.</constraint>
</constraints>`;
}

/** XML fragment for the compulsory-propositions block — its own rules sub-block
 *  + the proposition list. Inserted into the scene-plan user-prompt inputs. */
export function buildCompulsoryPropositionsBlock(args: {
  propositions: { content: string; type?: string }[];
}): string {
  if (args.propositions.length === 0) return '';
  const propsXml = args.propositions
    .map(
      (p, i) =>
        `    <proposition index="${i + 1}"${p.type ? ` type="${p.type}"` : ''}>${p.content}</proposition>`,
    )
    .join('\n');
  return `<compulsory-propositions hint="The prose MUST transmit every one of these — they are the scene's commitments. Listed in EXTRACTION ORDER (grouped by structural source); extraction order is NOT delivery order.">
  <rules>
    <rule name="coverage">Every proposition lands in some beat. None dropped.</rule>
    <rule name="reorder">Sequence for narrative effect — late reveals, early hooks, payoff after setup, interleaved lines of action. Page order is a craft decision; the prose-profile decides whether propositions are demonstrated, stated, or imaged.</rule>
    <rule name="glue">Where the narrative context shows a gap (a relationship not seen recently, a rule about to be invoked, a memory that frames a moment), add a small number of glue propositions from grounding/narrative-context to bridge. Glue enriches; it does not replace.</rule>
    <rule name="group">Multiple propositions can share a beat when they deliver together (a single dialogue exchange can carry three thread moves). Don't force 1:1.</rule>
  </rules>
  <propositions>
${propsXml}
  </propositions>
</compulsory-propositions>`;
}

