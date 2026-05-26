/**
 * Scene generation prompt — emits a JSON arc with N scenes (and their full
 * delta blocks) given the narrative context, brief, and pacing sequence.
 * Builder takes pre-built XML blocks for inputs / shared rules so the
 * prompts module stays free of upstream dependencies.
 */

import { modePriorityEntry } from "../mode/application";
import type { NarrativeParadigm } from '@/types/narrative';

export const GENERATE_SCENES_SYSTEM =
  'You are a scene generator producing one arc of structurally rich scenes. Honour the brief (reasoning graph / coordination plan / direction), the pacing sequence, and the active threads. Read the world-state across the three forces (fate / world / system); let the established work\'s profile decide which lead this arc — a Classic is fate-dominant, a Show is world-dominant, a Paper is system-dominant. Each scene should reshape future possibility-space (precedents, relationships, inner state, conceptual ground) rather than land without lasting effect. Different actors hold incompatible models — the same event gets divergent readings; emergence often arrives through actions taken on false, partial, or stale beliefs. Every scene pairs its summary with rich threadDeltas (rationale grounded in the scene), worldDeltas (15–25 word present-tense facts across 3+ entities), and ≥1 systemDelta. Match the narrative\'s naming style for any new entities. Return ONLY valid JSON matching the schema in the user prompt.';

// ── Per-paradigm scene discipline ────────────────────────────────────────────
// Mirrors the world-gen paradigm pattern: when the narrative carries a
// paradigm, inject ONLY the matching discipline block so the model sees a
// focused, deterministic standard for the scene shape it should produce.

const PARADIGM_SCENE_POPULATED_NARRATIVE = `<paradigm-scene-discipline paradigm="populated-narrative" hint="Fiction / non-fiction. Scenes are events in a populated world — characters act, places host action, time moves forward, the world changes through what happens in the scene.">
  <rule>Forward-time event narration IS the point. Scenes name what happens, who does it, what changes as a result.</rule>
  <rule>Names match the existing cast's register — NEVER AI-coded single-word names (Atlas, Cipher) here; those belong only in panel paradigm when the cast is AI agents.</rule>
</paradigm-scene-discipline>`;

const PARADIGM_SCENE_RULE_GOVERNED = `<paradigm-scene-discipline paradigm="rule-governed-narrative" critical="true" hint="Simulation. Scenes narrate what the rules force as conditions evolve — forward-time event modelling driven by the rule set, not authorial agency.">
  <rule>Forward-time event narration IS the point, BUT every scene's events trace back to the stated rules. When the rules force a state, the scene delivers it — even when 'the protagonist' would conventionally prevail. Recoveries must be earned by initial-condition shifts, rule changes, or agents finding new positions inside the existing rules.</rule>
  <rule>The system-graph carries scene-level weight. Each scene that invokes a rule should attribute the specific SYS-XX node; rule-driven outcomes should reference the mechanism that produced them.</rule>
  <rule>Diegetic overlays (HUD, log, status sheet, tier gate) are real to the characters — they literally see / read / cross them. NOT a meta-observer running the simulation from outside.</rule>
  <rule>Names match the modelled setting — Khrushchev, Yi, in-world cultivator names with sect honorifics. No AI-coded single-word names.</rule>
</paradigm-scene-discipline>`;

const PARADIGM_SCENE_SINGULAR_THINKER = `<paradigm-scene-discipline paradigm="singular-thinker" hint="Essay. One named author works through the argument; scenes are sections of cognition — claims considered, evidence weighed, counter-positions engaged, conclusions arrived at.">
  <rule>Forward-time event narration is rare. Scenes track the AUTHOR'S thinking process — the next claim taken up, the next counter engaged, the next implication derived.</rule>
  <rule>Internal friction (the author considering and rejecting alternatives) substitutes for inter-agent disagreement; cited interlocutors enter to be engaged or rebutted, not to be characters in a story.</rule>
  <rule>No fabricated quotes from real interlocutors. Engage cited positions as written; if you need an interlocutor's view you don't have, mark it as the author's inferred reading, not a quote.</rule>
</paradigm-scene-discipline>`;

const PARADIGM_SCENE_MULTI_THINKER = `<paradigm-scene-discipline paradigm="multi-thinker" critical="true" hint="Panel. A named cast of 2+ thinkers (AI agents OR human experts) works with EXISTING evidence. Scenes are cognitive events — meetings, model runs, deliberations — not plot beats.">
  <forbidden>
    <rule>No forward-time event narration ("three days later, the PLA conducted an exercise"; "a new piece of data hits"). Time progresses through the panel's COGNITIVE process (next meeting / next model run), not through external world events.</rule>
    <rule>No fabricated intelligence ("Argus intercepted comms"; "Xi privately told Trump"; "the dissenter's off-record memo"). Use publicly known evidence + the narrative's source material — not invented covert sources.</rule>
    <rule>No specific numbers presented as freshly observed unless they come from the source material or are well-attested in LLM knowledge. Otherwise mark them as model outputs or scenario assumptions.</rule>
  </forbidden>
  <permitted>
    <rule>Scenarios as explicit hypotheticals ("the panel models the case where X happens — under that scenario, conviction drops 12 points"). Reasoning over possible worlds, not narrating that they arrived.</rule>
    <rule>Re-interpretation of evidence on the table, model recalibration with adjusted priors, dissenter challenges to readings. Friction comes from competing READINGS of the SAME evidence.</rule>
    <rule>Name evidence gaps honestly when the panel lacks data — don't paper over with invented numbers.</rule>
  </permitted>
  <test>If "in the scene, X happened" can be replaced with "the panel imagined a scenario where X would happen" without loss, the scene is panel-shaped. If X must be a real new event, you've drifted into simulation — rewrite.</test>
</paradigm-scene-discipline>`;

const PARADIGM_SCENE_REFERENCE_TYPOLOGY = `<paradigm-scene-discipline paradigm="reference-typology" hint="Atlas. NOT scene-driven in the event sense. Each 'scene' is an ENTRY — a specimen description, a doctrine articulation, a category definition. Structure replaces story.">
  <rule>Entries are structurally complete — they classify, define, or articulate; they don't narrate events. A specimen's habitat, behaviour, taxonomy belongs in the entry; a story about a specimen does not.</rule>
  <rule>The curator's voice is consistent and authoritative across entries. Avoid letting the curator become a character; they orchestrate, not participate.</rule>
  <rule>Cross-references between entries are the substance — what extends what, what depends on what, what supersedes what. Build them densely via systemDeltas + attributionEdges; aggregate into the system-graph.</rule>
  <rule>Threads (when present) are classification questions ("does this specimen belong in family X?"), not dramatic arcs. They resolve through the typology's internal logic, not through events.</rule>
</paradigm-scene-discipline>`;

const PARADIGM_SCENE_ADVERSARIAL_CONTEST = `<paradigm-scene-discipline paradigm="adversarial-contest" critical="true" hint="Debate. Two or more named parties locked in zero-sum stakes under explicit rules. Each scene is a MOVE in the contest — a witness called, an exchange in cross, a campaign ad, a bid raised. Resolution flows through the contest's rules.">
  <rule>Each scene is a MOVE. Moves have attribution (which contestant made the move), intent (what axis it targets), and effect (how the rules + arbiter scored it). Avoid descriptive scenes that aren't moves.</rule>
  <rule>Threads are AXES OF CONTESTATION — each thread's outcome favours one contestant or the other. Zero-sum: when one party advances on an axis, the other retreats or holds.</rule>
  <rule>The rules of engagement (system-graph) are load-bearing. Every move's legitimacy traces back to a rule; every scoring decision traces back to the arbiter's reading of the rules.</rule>
  <rule>The arbiter's call is canon. When the rules force a verdict, the scene delivers it — the work resolves through the contest's mechanism, not through authorial sympathy.</rule>
  <rule>Names match the contest's setting — a courtroom has lawyers / judges / witnesses with plausibly-human names; a campaign has candidates / staffers with the same. No AI-coded single-word names.</rule>
</paradigm-scene-discipline>`;

const PARADIGM_SHAPE_MAP: Record<NarrativeParadigm, string> = {
  'fiction':      PARADIGM_SCENE_POPULATED_NARRATIVE,
  'non-fiction':  PARADIGM_SCENE_POPULATED_NARRATIVE,
  'simulation':   PARADIGM_SCENE_RULE_GOVERNED,
  'essay':        PARADIGM_SCENE_SINGULAR_THINKER,
  'panel':        PARADIGM_SCENE_MULTI_THINKER,
  'atlas':        PARADIGM_SCENE_REFERENCE_TYPOLOGY,
  'debate':       PARADIGM_SCENE_ADVERSARIAL_CONTEST,
};

export type GenerateScenesPromptArgs = {
  /** Pre-built `<inputs>...</inputs>` body (all input blocks joined). */
  inputBlocks: string;
  arcId: string;
  povRestrictedHint: string;
  /** Whether a pacing sequence was provided (decides priority entry visibility). */
  hasPacingSequence: boolean;
  /** Pre-built modular prompt blocks shared across scene generation paths. */
  sharedRulesBlock: string;
  /** Narrative paradigm — injects the matching scene-shape discipline block.
   *  When omitted, no paradigm-specific block is emitted (back-compat). */
  paradigm?: NarrativeParadigm;
};

export function buildGenerateScenesPrompt(args: GenerateScenesPromptArgs): string {
  const {
    inputBlocks,
    arcId,
    povRestrictedHint,
    hasPacingSequence,
    sharedRulesBlock,
    paradigm,
  } = args;

  const priorities = [
    `  <priority rank="1">USER-SUPPLIED CONTEXT — operator's direction, constraints, narrative settings, explicit guidance. Beats engine defaults whenever it speaks; defaults apply only where the operator is silent.</priority>`,
    `  <priority rank="2">BRIEF — reasoning graph (CRG) / coordination-plan directive / direction. Scenes execute the brief.</priority>`,
    `  <priority rank="3">ARC SETTINGS — force preference / reasoning mode / network bias the CRG was built under. Scenes inherit the engine tilt.</priority>`,
    `  <priority rank="4">WORLD-BUILD FOCUS — recently-introduced entities and latent threads this arc must activate. Bring them on-screen.</priority>`,
    hasPacingSequence ? `  <priority rank="5">PACING SEQUENCE — per-scene mode + force band targets.</priority>` : '',
    `  ${modePriorityEntry(6, "scene-structure")}`,
    `  <priority rank="7">NARRATIVE CONTEXT — characters, threads, system knowledge, recent history.</priority>`,
  ].filter(Boolean).join('\n');

  const paradigmBlock = paradigm ? `\n${PARADIGM_SHAPE_MAP[paradigm]}\n` : '';

  return `<inputs>
${inputBlocks}
</inputs>

<integration-hierarchy hint="Priority order when inputs conflict.">
${priorities}
</integration-hierarchy>
${paradigmBlock}

<summary-discipline>The summary IS the delta budget. Write the summary so every intended delta has a source sentence — every entity-change, rule-surfacing, thread-move, and off-screen-affected party traceable to a sentence. Under-tagging is the dominant failure mode.
  <rule name="no-raw-ids" critical="true">NEVER echo engine identifiers in summary prose. Forbidden tokens: any "PREFIX-NUMBER" form — C-N, L-N, T-N, A-N, S-N, ARC-N, K-N, SYS-N, SYS-GEN-N, etc. The summary is read by downstream prose and plan stages as the authoritative scene brief; an ID slug inside prose ("using SYS-98", "via T-12") leaks engine bookkeeping into the rendered text. Translate every reference to its in-world name or concept:
    <example bad="Using techniques from SYS-98 (Moonlight Wolf Gu larvae coaxing), Chun coaxes three larvae." good="Using the moonlight-wolf coaxing technique, Chun coaxes three larvae." />
    <example bad="The market on T-12 escalated when Fang Yuan revealed the timeline." good="The question of whether the sect would commit to early defence escalated when Fang Yuan revealed the timeline." />
    <example bad="ThreadDeltas update T-1 and T-5 with strong positive evidence for decoupling acceleration and actionable leak." good="Zhang's hint on direct R&amp;D subsidy strengthens the team's read on near-term decoupling, and the leak itself crosses the actionable bar — sourced, dated, specific enough to trade against." note="The IDs leak inside a disguise pattern: engine-bookkeeping prose. Cleaning the engine-metadata (no-engine-metadata rule below) also fixes the ID leak." />
    Structured ID fields (systemAttributions, participantIds, threadDeltas.threadId, etc.) carry the IDs separately — that is where they belong, never inside summary prose.
  </rule>
  <rule name="no-engine-metadata" critical="true">The summary describes what happened IN-WORLD. NEVER reference engine field names (threadDeltas, worldDeltas, systemDeltas, relationshipDeltas, attributions, attributionEdges, ownershipDeltas, tieDeltas, characterMovements, artifactUsages, events) as bookkeeping inside summary prose. These fields exist SEPARATELY in the JSON; the cross-reference discipline (every delta traces to a summary sentence — see above) lives in your REASONING, not in the summary text.
    <example bad="ThreadDeltas update T-1 with strong positive evidence; WorldDeltas capture Elena's skepticism; SystemDeltas add a rule about Treasury fiscal constraints." good="Hollister's leak on Treasury debt-servicing pressure forces Elena to widen her error bands on decoupling timing — the fiscal constraint enters the model as a rule that can moderate the pace of strategic competition." />
    <example bad="ThreadDeltas update T-3 with evidence against overextension, shifting probability towards 'contain'." good="Kenji's LNG-routing data — Russian cargoes still reaching European buyers under disguised ownership — flips the team's read on Russian economic strain from overextending to partially contained, since the sanctions are not binding the way the production figures implied." note="Outcome-name quoting ('contain') is the same leakage class as engine-field-name leakage; both are bookkeeping vocabulary surfacing in narrative." />
    <why>Engine-bookkeeping recap inside the summary is a self-checklist of what you intend to put in the delta fields. The fields catch up structurally — you do not need to narrate them. Reclaim that budget for naming the substance (which scenario was weighed, which tradeoff was accepted, which rule was established).</why>
  </rule>
</summary-discipline>

<non-repetition critical="true" hint="Scenes must each commit something the prior scenes did not. Read <scene-history> before emitting; cross-check every scene you draft against the most recent ~6-8 entries.">
  <check name="beat-shape">Two scenes with the same beat shape (same POV reflecting, same confrontation, same revelation, same task-completion) is repetition unless the recurrence is itself the point (a refrain, a ritual, a deliberate echo). Default: VARY the shape.</check>
  <check name="delta-pattern">If two scenes' worldDeltas hit the same entities with the same node-types in the same direction (e.g. POV gains another "belief" about the same antagonist; same location accrues another "history" entry) the second scene is treading water. Move the cast — touch a different entity, surface a different node-type, or reveal a fact that re-frames an earlier delta.</check>
  <check name="thread-trigger">Two scenes shifting the same thread in the same direction with the same trigger (same character's same suspicion, same elder's same warning, same sensor's same reading) is phantom motion. Force a different trigger — a new party intervenes, a rule fires unexpectedly, an off-stage event re-prices the thread.</check>
  <check name="location-rotation">Three+ consecutive scenes in the same location without a structural reason (siege, locked-room, single-day arc) is a setting-trap. Rotate venues so the world stays material.</check>
  <check name="cast-rotation">Same participant set across consecutive scenes flattens the network. Bring named secondary entities on-screen; let third-party agendas surface.</check>
  <check name="redundancy-against-rolled-up-arcs">Far-tier arc-summary entries carry the chess-board state at end of each arc — do not re-cover ground they've already resolved. If your draft scene re-establishes a fact a prior arc-summary already commits, cut it.</check>
  <fallback>If a draft scene fails ≥2 checks, regenerate it with a different angle: switch POV, introduce a new entity or third-party event, or reframe the scene's central question. Better to commit a fresh-but-shorter beat than a polished repetition.</fallback>
</non-repetition>

<output-format>
Return JSON with this exact structure.

{
  "arcName": "2-4 words drawn from the narrative's own register. Mood-coded ('Seeds of Distrust') or concrete-event ('Tier Tribulation', 'Ratification Vote') — both fine. Bad: generic ('Continuation') or a register that doesn't match the world the cast lives in.",
  "directionVector": "1-2 sentences. Central pressure (what is closing, sharpening, tipping) and shape of consequence. Vector, not script.",
  "worldState": "Compact state snapshot at END of arc — the chess-board position.",
  "scenes": [
    {
      "id": "S-GEN-1",
      "arcId": "${arcId}",
      "locationId": "existing location ID, OR null for essay / paper / analysis sections with no scene-location (argument sections, theoretical exposition, voice-of-nobody passages)",
      "povId": "viewpoint entity ID OR null. Set to a participant character (fiction) or named author entity (memoir/essay/first-person non-fiction) when the source narrates from that vantage. Set to null for omniscient simulation, impersonal analytical writing, polyphonic / dialogic sources — registers that have no viewpoint entity. Do not appoint a 'modelled agent' inside a simulation as POV. See pov-discipline for the full rule.${povRestrictedHint}",
      "participantIds": ["existing character IDs — empty array is valid for essay / paper / analysis sections with no on-stage participants"],
      "summary": "Prose in NAMES not IDs — and NEVER reference engine field names (threadDeltas / worldDeltas / systemDeltas / etc.) inside the summary; see summary-discipline above. Length adapts to content: 3-6 sentences for routine scenes (fiction / non-fiction-narrative / simulation default), cognition-dense expansion WITHOUT UPPER BOUND for multi-step planning, scenario modelling, complex reveals, layered argument. For essay / paper / analysis, cognition-dense IS the default — most sections weigh claims, present evidence, state a mechanism, engage a counter, or derive an implication. Name each scenario weighed, each tradeoff accepted, each conclusion reached. This is the prose writer's only brief and the only artifact other scenes can read.",
      "timeDelta": {"value": 1, "unit": "minute|hour|day|week|month|year", "transition": "natural-language phrase — 'the next morning', 'years before', 'later that evening' — captures English-language flow"},
      "artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX", "usage": "what the artifact did"}],
      "characterMovements": {"C-XX": {"locationId": "L-YY", "transition": "how they travelled"}},
      "events": ["event_tag_1", "event_tag_2"],
      "threadDeltas": [{"threadId": "T-XX", "logType": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "updates": [{"outcome": "outcome name from thread.outcomes", "evidence": 1.5}], "volumeDelta": 1, "addOutcomes": ["optional — only when this scene structurally opens a possibility not previously in the market"], "rationale": "the summary sentence that moved this market"}],
      "worldDeltas": [{"entityId": "C-XX|L-XX|A-XX", "addedNodes": [{"id": "K-GEN-1", "content": "15-25 words, present tense", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
      "relationshipDeltas": [{"from": "C-XX", "to": "C-YY", "type": "short relation label — mentor, rival, ally, kin, debtor, peer, etc.", "valenceDelta": 0.1}],
      "systemDeltas": {"addedNodes": [{"id": "SYS-GEN-1", "concept": "15-25 words, general rule, no specific entities/events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "SYS-GEN-1", "to": "SYS-XX", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]},
      "ownershipDeltas": [{"artifactId": "A-XX", "fromId": "C-XX|L-XX|null", "toId": "C-YY|L-YY|null"}],
      "tieDeltas": [{"locationId": "L-XX", "characterId": "C-XX", "action": "add|remove"}],
      "newCharacters": [{"id": "C-GEN-1", "name": "Full Name", "role": "anchor|recurring|transient", "threadIds": [], "imagePrompt": "literal physical description", "world": {"nodes": {"K-GEN-XXX": {"id": "K-GEN-XXX", "type": "trait|history|capability|secret|goal", "content": "key fact"}}, "edges": []}}],
      "newLocations": [{"id": "L-GEN-1", "name": "Name", "prominence": "domain|place|margin", "parentId": "L-XX|null", "tiedCharacterIds": [], "threadIds": [], "imagePrompt": "literal visual description", "world": {"nodes": {"K-GEN-XXX": {"id": "K-GEN-XXX", "type": "trait|history", "content": "key fact"}}, "edges": []}}],
      "newArtifacts": [{"id": "A-GEN-1", "name": "Name", "significance": "key|notable|minor", "parentId": "C-XX|L-XX|null", "threadIds": [], "imagePrompt": "literal visual description", "world": {"nodes": {"K-GEN-XXX": {"id": "K-GEN-XXX", "type": "trait|capability|history|state", "content": "one fact per node"}}, "edges": []}}],
      "newThreads": [{"id": "T-GEN-1", "description": "thread question", "outcomes": ["yes", "no"], "participants": [{"id": "C-XX", "type": "character|location|artifact"}], "threadLog": {"nodes": {}, "edges": []}}],
      "attributions": ["C-XX", "L-XX", "T-XX", "SYS-XX"],
      "attributionEdges": [{"from": "C-XX", "to": "SYS-XX", "relation": "requires|enables|constrains|risks|causes|reveals|develops|resolves|supersedes"}]
    }
  ]
}
</output-format>

<instructions>
  <rule name="introduce-new-entities">Introduce new entities liberally when the scene needs them (a messenger, a venue, a document, a new rivalry, a cited source). Each new entity needs ≥1 world node at creation; each new thread needs ≥1 setup log entry.</rule>

  <rule name="naming-discipline">New entities use concrete, in-world proper names — match the existing cast's style (length, language family, honorific conventions). Descriptive labels belong in world-node content, NEVER in \`name\`. Bad: "Shadow Seeker", "The Stranger", "Old Man". Good: a name that could pass as one of the existing cast's.</rule>

  <rule name="collapse-on-reveal" critical="true" hint="When a scene REVEALS a load-bearing fact (location, identity, capability, intent, relationship truth, artifact's effect, finding, source attribution, rule-driven outcome), the summary AND worldDelta MUST name the specific fact. Future scenes causally reason on whatever this scene commits.">
    Distinguish IN-CHARACTER UNCERTAINTY (a POV figure can suspect, infer, hypothesise without commitment) from CANONICAL FACT (when a worldDelta says the fact is now known/established/confirmed, the canon commits). Phrases like "probable location", "likely identity", "the answer", "the intelligence", "the rule-driven outcome" used as canonical commitments are placeholders that read as reveals while transmitting nothing. Test: if you can replace the named fact with "[REDACTED]" and the summary still reads as a reveal, you've written a placeholder — rewrite until the canon carries the actual fact.
    <example type="good" register="simulation" flavour="wargame">"Under the modelled mobilisation rules, the eastern front absorbs 18 divisions before week three; the resulting supply-line stress drops doctrine-X compliance below the 0.6 threshold and the front fragments at the Drava crossing." (the specific rule-driven state — divisions, threshold, breakage point — is named, not gestured)</example>
    <example type="good" register="fiction" flavour="cultivation">"Elder Ji's tribulation reading shows the Iron Cloud reservoir admitted Lin Wei's draw at the 7th-tier threshold; capacity drops to 0.82 of nominal, sealing the sect's next two ascensions to a two-year gap under the founder's charter."</example>
    <example type="good" register="non-fiction" flavour="biography">"The archival cross-check confirms Yukawa's 13 March 1934 letter to Bohr predates the meson hypothesis manuscript by six weeks, naming the field-mediator argument the Copenhagen group later said arrived without precedent."</example>
    <example type="good" register="fiction" flavour="fantasy">"The Carrow branch steward read the founding compact aloud at the equinox witness; the rain returned to the lapsed lands within the hour, confirming that ritual recitation — not bloodline alone — re-anchors the water-rights."</example>
    <example type="good" register="paper">"The district-by-district cross-tabulation confirmed the prediction: in 34 of 41 prefectures where the Song garrison was reduced before 1180, iron-coin minting ceased within two regnal years; the seven outliers all retained frontier-supply duties documented in the local fiscal records."</example>
  </rule>

  <rule name="ids">scene S-GEN-N, knowledge K-GEN-N, system SYS-GEN-N (reused SYS nodes keep original ID). character/location/artifact/thread GEN-N placeholders remapped downstream. Use plain integers — no leading zeros (write S-GEN-1, not S-GEN-001).</rule>

  <rule name="time-delta" critical="true" hint="Gaps reshape what the scene commits — pick a mode, let the deltas answer for it.">
    <shape>{value: integer, unit, transition}. Positive = forward, 0 = concurrent / first scene, negative = backward. transition is the natural-language phrase prose reads verbatim. Approximate values fine.</shape>
    <sign-alignment critical="true">Sign matches transition direction. Backward phrase ("earlier", "ago", "X before", flashback, Time-Turner-style rewind) = NEGATIVE value. Forward phrase ("later", "next morning", "X after") = POSITIVE value.
      <correct>{value: -3, unit: "hour", transition: "three hours earlier, using the Time-Turner"}</correct>
      <correct>{value: -10, unit: "year", transition: "flashback to her schooldays"}</correct>
      <wrong>{value: 3, unit: "hour", transition: "three hours earlier, using the Time-Turner"} — phrase is backward, sign is forward.</wrong>
    </sign-alignment>
    <mode name="continuous-step">Default. Minutes-to-days; deltas reflect what happens IN the scene. e.g. {3, hour, "that evening"}, {1, day, "the next morning"}.</mode>
    <mode name="large-skip" hint="≥1 week with active anchors. The skip itself is a load-bearing event.">
      The opening scene MUST compensate for off-screen drift, not just narrate the present:
      • threads moved during the gap (stalls decay with negative volumeDelta + "stall"; live ones advance with "escalation"/"transition"; some close off-screen as "payoff"/"twist" citing the interval)
      • anchors and named off-screen entities accrue aged-state worldDeltas — capabilities gained/lost, relationships eroded/hardened
      • if the world's rules/institutions/conventions shifted during the gap, ≥1 systemDelta captures it
      • summary opens by naming what the gap changed — the scene now operates on those facts, not on the pre-gap state
    </mode>
    <mode name="flashback" hint="Excursion into the past; time flows FORWARD inside the past span; narrative EVENTUALLY snaps back to present.">
      <entry>One big NEGATIVE value opens the flashback. e.g. {-10, year, "flashback to her schooldays"}.</entry>
      <inside>Subsequent scenes in the flashback use NORMAL POSITIVE deltas — time flows forward inside the past span exactly like ordinary continuity (e.g. {1, hour, "later that afternoon"}, {1, day, "the next morning"}). Flashbacks can span multiple scenes; do NOT force the very next scene to be the return.</inside>
      <exit>ONE eventual scene snap-returns to present with a big POSITIVE delta sized to cancel the entry PLUS the forward motion accumulated inside. e.g. after a 10-year flashback covering ~2 days of past-time: ~{10, year, "back in the present"}.</exit>
      <invariant>Reveal-weighted for the FRAME: the present POV/reader LEARNS through the flashback; worldDeltas on the return scene favour belief/state/secret nodes on the PRESENT-self. Within the past span itself, scenes canonise past events at their past-time position (this is when the reader first sees them) — but the prior present-day state is NOT mutated by the flashback's events.</invariant>
    </mode>
    <mode name="time-travel" hint="Diegetic travel — timeline forks; time flows FORWARD from the new position; NO return.">
      <entry>One NEGATIVE value opens the travel. e.g. {-3, hour, "three hours earlier, using the Time-Turner"}.</entry>
      <inside>Subsequent scenes use NORMAL POSITIVE deltas — time flows forward from the new earlier position exactly like ordinary continuity. e.g. {1, hour, "an hour after arrival"}.</inside>
      <no-return>The narrative LIVES in the new time. Subsequent deltas are relative to the new position, NOT to the pre-travel present. There is no snap-back.</no-return>
      <invariant>
        • traveller carries memory forward (worldDeltas flag knowledge "carried from later")
        • world snaps to its earlier state; do NOT propagate present-day deltas backward
        • surface the mechanic as a systemDelta; add a chaos/rupture marker for paradox-prone travel
      </invariant>
    </mode>
    <decision-test>Both modes share the shape: negative entry, then forward motion. Flashback EVENTUALLY snap-returns to present; time-travel does NOT. Continuous vs skip: ≥1 week with active anchors = skip, compensate.</decision-test>
  </rule>

  <rule name="tag-richly-discipline" hint="Floors and per-tier density bands live in force-standards / deltas; this rule adds scene-shape-specific guidance.">
    <thread-step>One threadDelta per thread per scene; transitions move ONE step forward.</thread-step>
    <profile mode="reflective-pov" hint="Solo-POV scenes, mostly thinking/planning.">POV is STILL the most-changed entity — expect 4-6 nodes on POV alone (belief/state/goal/capability/secret), plus 2-3 on adjacent entities (location witnessed, artifact handled, off-screen party affected). A reflective scene with only one POV delta is broken.</profile>
    <profile mode="team-collaboration" hint="Agentic-team scenes — team meeting, debate, decision-commit, adversarial review. Common in essay / analysis / paper / simulation worlds built on the agentic-team-pattern.">EVERY agent in the room is a candidate for worldDeltas — each contributes their lens, accumulates a belief / capability / state node. A team meeting with deltas only on the coordinator is broken: name what each specialist established, what the devil's advocate challenged, what the data role contributed. Goal-thread (the team's collective objective) MUST move (escalation / transition / pulse) when a substantive collaboration scene runs.</profile>
    <profile mode="source-meeting" hint="One agent gathering intelligence from a transient source. Common in agentic-team worlds.">POV agent + source = 2 entities, but the deltas extend OFF-SCREEN: the team back home accumulates the relayed intelligence as a belief / state node; the transient source's continuity gains provenance / relationship nodes. The thread that closes when the intel is acted on shifts probability now, not later.</profile>
    <directive>AGENCY over ORBIT. OFF-SCREEN deltas are valid (news/rumour/intelligence). REUSE existing node IDs — only NEW concepts count toward floors.</directive>
  </rule>

  <worked-example name="thin-vs-rich" hint="Same summary; the difference is extraction discipline. IDs below are schematic — substitute the actual entities your narrative provides.">
    <summary>The investigator combined fragments from the archive viewing with the residue signature on the recovered instrument. The reading revealed the surveillance was embedded within the refinement of every instrument at the maker's workshop — overturning the prior model and demanding a new counter-strategy.</summary>
    <rich target="8 world across 5 entities + 2 system">
worldDeltas: [
  {POV-character, nodes: [belief "the surveillance embeds inside instrument-core refinement", state "prior external-monitoring model is overturned", goal "shift to proactive counter-surveillance strategy", capability "can compose multi-source archival corpora"]},
  {archive-artifact, nodes: [capability "the archive resolves composite records into multi-layered revelations"]},
  {recovered-instrument, nodes: [trait "carries the surveillance signature embedded at refinement"]},
  {residue-evidence, nodes: [trait "the residue traces carry monitoring data readable through the archive"]},
  {safehouse-location, nodes: [history "served as the analysis site"]}
]
systemDeltas: { addedNodes: [principle "the authority's surveillance operates by embedding monitoring within instrument-core refinement", concept "the archive resolves record corpora into patterned revelations"], addedEdges: [governs(principle, concept)] }
threadDeltas: [one transition + optional pulse on the surveillance-inquiry thread]
    </rich>
    <takeaway>Apply this richness pattern to every scene.</takeaway>
  </worked-example>

  <reference name="shared-rules">
${sharedRulesBlock}
  </reference>

  <closing-step name="attributions-and-edges" critical="true" hint="Emit LAST — after every other field. Synthesise from the scene you just wrote.">
    <attributions>Existing ids the scene structurally leans on (C/L/A/T/SYS). One per load-bearing reference; skip "merely on-screen" or "passively in the world". Newly-introduced ids credit automatically downstream — don't list them. 0–12 typical.</attributions>
    <attribution-edges>Typed cross-kind connections the scene activates — character↔system, thread↔location, artifact↔character, thread↔character, system↔thread. Relation: one of enables, constrains, requires, risks, causes, reveals, develops, resolves, supersedes. Same-kind wiring is already covered by relationshipDeltas / systemDeltas.addedEdges — don't duplicate it here. 0–8 typical.</attribution-edges>
  </closing-step>
</instructions>`;
}
