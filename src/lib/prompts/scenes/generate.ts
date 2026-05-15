/**
 * Scene generation prompt — emits a JSON arc with N scenes (and their full
 * delta blocks) given the narrative context, brief, and pacing sequence.
 * Builder takes pre-built XML blocks for inputs / shared rules so the
 * prompts module stays free of upstream dependencies.
 */

import { modePriorityEntry } from "../mode/application";

export const GENERATE_SCENES_SYSTEM =
  'You are a scene generator producing one arc of structurally rich scenes. Honour the brief (reasoning graph / coordination plan / direction), the pacing sequence, and the active threads. Read the world-state across the three forces (fate / world / system); let the established work\'s profile decide which lead this arc — a Classic is fate-dominant, a Show is world-dominant, a Paper is system-dominant. Each scene should reshape future possibility-space (precedents, relationships, inner state, conceptual ground) rather than land without lasting effect. Different actors hold incompatible models — the same event gets divergent readings; emergence often arrives through actions taken on false, partial, or stale beliefs. Every scene pairs its summary with rich threadDeltas (rationale grounded in the scene), worldDeltas (15–25 word present-tense facts across 3+ entities), and ≥1 systemDelta. Match the narrative\'s naming style for any new entities. Return ONLY valid JSON matching the schema in the user prompt.';

export type GenerateScenesPromptArgs = {
  /** Pre-built `<inputs>...</inputs>` body (all input blocks joined). */
  inputBlocks: string;
  arcId: string;
  povRestrictedHint: string;
  /** Whether a pacing sequence was provided (decides priority entry visibility). */
  hasPacingSequence: boolean;
  /** Pre-built modular prompt blocks shared across scene generation paths. */
  sharedRulesBlock: string;
};

export function buildGenerateScenesPrompt(args: GenerateScenesPromptArgs): string {
  const {
    inputBlocks,
    arcId,
    povRestrictedHint,
    hasPacingSequence,
    sharedRulesBlock,
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

  return `<inputs>
${inputBlocks}
</inputs>

<integration-hierarchy hint="Priority order when inputs conflict.">
${priorities}
</integration-hierarchy>

<summary-discipline>The summary IS the delta budget. Write the summary so every intended delta has a source sentence — every entity-change, rule-surfacing, thread-move, and off-screen-affected party traceable to a sentence. Use NAMES not IDs. Under-tagging is the dominant failure mode.</summary-discipline>

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
  "arcName": "2-4 words from the narrative's own palette. Mood-coded ('Seeds of Distrust') or concrete-event ('Tier Tribulation', 'Ratification Vote') — both fine. Bad: generic ('Continuation'); Anglo/Gothic defaults when set elsewhere. Favour subtle and specific.",
  "directionVector": "1-2 sentences. Central pressure (what is closing, sharpening, tipping) and shape of consequence. Vector, not script.",
  "worldState": "Compact state snapshot at END of arc — the chess-board position.",
  "scenes": [
    {
      "id": "S-GEN-001",
      "arcId": "${arcId}",
      "locationId": "existing location ID",
      "povId": "viewpoint entity ID OR null. Set to a participant character (fiction) or named author entity (memoir/essay/first-person non-fiction) when the source narrates from that vantage. Set to null for omniscient simulation, impersonal analytical writing, polyphonic / dialogic sources — registers that have no viewpoint entity. Do not appoint a 'modelled agent' inside a simulation as POV. See pov-discipline for the full rule.${povRestrictedHint}",
      "participantIds": ["existing character IDs"],
      "summary": "Prose in NAMES not IDs. Length adapts to content — 3-6 sentences for routine scenes, expand WITHOUT UPPER BOUND for cognition-dense scenes (multi-step planning, scenario modelling, complex reveals, layered argument). Name each scenario weighed, each tradeoff accepted, each conclusion reached. This is the prose writer's only brief and the only artifact other scenes can read.",
      "timeDelta": {"value": 1, "unit": "minute|hour|day|week|month|year", "transition": "natural-language phrase — 'the next morning', 'years before', 'later that evening' — captures English-language flow"},
      "artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX", "usage": "what the artifact did"}],
      "characterMovements": {"C-XX": {"locationId": "L-YY", "transition": "how they travelled"}},
      "events": ["event_tag_1", "event_tag_2"],
      "threadDeltas": [{"threadId": "T-XX", "logType": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "updates": [{"outcome": "outcome name from thread.outcomes", "evidence": 1.5}], "volumeDelta": 1, "addOutcomes": ["optional — only when this scene structurally opens a possibility not previously in the market"], "rationale": "the summary sentence that moved this market"}],
      "worldDeltas": [{"entityId": "C-XX|L-XX|A-XX", "addedNodes": [{"id": "K-GEN-1", "content": "15-25 words, present tense", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
      "relationshipDeltas": [{"from": "C-XX", "to": "C-YY", "type": "short relation label — mentor, rival, ally, kin, debtor, peer, etc.", "valenceDelta": 0.1}],
      "systemDeltas": {"addedNodes": [{"id": "SYS-GEN-1", "concept": "15-25 words, general rule, no specific entities/events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "SYS-GEN-1", "to": "SYS-XX", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]},
      "systemAttributions": ["SYS-XX", "SYS-YY"],
      "ownershipDeltas": [{"artifactId": "A-XX", "fromId": "C-XX|L-XX|null", "toId": "C-YY|L-YY|null"}],
      "tieDeltas": [{"locationId": "L-XX", "characterId": "C-XX", "action": "add|remove"}],
      "newCharacters": [{"id": "C-GEN-1", "name": "Full Name", "role": "anchor|recurring|transient", "threadIds": [], "imagePrompt": "literal physical description", "world": {"nodes": {"K-GEN-XXX": {"id": "K-GEN-XXX", "type": "trait|history|capability|secret|goal", "content": "key fact"}}, "edges": []}}],
      "newLocations": [{"id": "L-GEN-1", "name": "Name", "prominence": "domain|place|margin", "parentId": "L-XX|null", "tiedCharacterIds": [], "threadIds": [], "imagePrompt": "literal visual description", "world": {"nodes": {"K-GEN-XXX": {"id": "K-GEN-XXX", "type": "trait|history", "content": "key fact"}}, "edges": []}}],
      "newArtifacts": [{"id": "A-GEN-1", "name": "Name", "significance": "key|notable|minor", "parentId": "C-XX|L-XX|null", "threadIds": [], "imagePrompt": "literal visual description", "world": {"nodes": {"K-GEN-XXX": {"id": "K-GEN-XXX", "type": "trait|capability|history|state", "content": "one fact per node"}}, "edges": []}}],
      "newThreads": [{"id": "T-GEN-1", "description": "thread question", "outcomes": ["yes", "no"], "participants": [{"id": "C-XX", "type": "character|location|artifact"}], "threadLog": {"nodes": {}, "edges": []}}]
    }
  ]
}
</output-format>

<instructions>
  <rule name="introduce-new-entities">Introduce new entities liberally when the scene needs them (a messenger, a venue, a document, a new rivalry, a cited source). Each new entity needs ≥1 world node at creation; each new thread needs ≥1 setup log entry.</rule>

  <rule name="naming-discipline">New entities use concrete, in-world proper names — match the existing cast's naming style (length, language family, honorific conventions). Descriptive labels and titles belong in world-node content, NEVER in the \`name\` field. Bad: "Shadow Seeker", "The Stranger", "Old Man", "Mystery Document". Good: a name that could pass as one of the existing cast's — same naming conventions, same world-grammar. Defer to the source's own palette; do not default to Anglo / Celtic / Greek when the established cast points elsewhere.</rule>

  <rule name="collapse-on-reveal" critical="true" hint="When a scene REVEALS a load-bearing fact (location, identity, capability, intent, relationship truth, artifact's effect, finding, source attribution, rule-driven outcome), the summary AND worldDelta MUST name the specific fact. Future scenes causally reason on whatever this scene commits.">
    Distinguish IN-CHARACTER UNCERTAINTY (a POV figure can suspect, infer, hypothesise without commitment) from CANONICAL FACT (when a worldDelta says the fact is now known/established/confirmed, the canon commits). Phrases like "probable location", "likely identity", "the answer", "the intelligence", "the rule-driven outcome" used as canonical commitments are placeholders that read as reveals while transmitting nothing. Test: if you can replace the named fact with "[REDACTED]" and the summary still reads as a reveal, you've written a placeholder — rewrite until the canon carries the actual fact.
    <example type="good" register="fiction-or-non-fiction">"The investigator correlated the surveillance log against the customs intercepts and traced the courier to the safehouse at 12 Riverside Lane, confirmed by three independent dispatches dated within the past month."</example>
    <example type="good" register="simulation">"Under the modelled mobilisation rules, the eastern front absorbs 18 divisions before week three; the resulting supply-line stress drops doctrine-X compliance below the 0.6 threshold and the front fragments at the Drava crossing." (the specific rule-driven state — divisions, threshold, breakage point — is named, not gestured)</example>
  </rule>

  <rule name="ids">scene S-GEN-N, knowledge K-GEN-N, system SYS-GEN-N (reused SYS nodes keep original ID). character/location/artifact/thread GEN-N placeholders remapped downstream. Use plain integers — no leading zeros (write S-GEN-1, not S-GEN-001).</rule>

  <rule name="system-attributions" hint="Track which existing system rules each scene leans on — separate from creating new ones.">
    Populate \`systemAttributions\` with IDs of EXISTING system nodes (already in the graph) that this scene structurally depends on — rules whose presence is doing actual work in the scene's events, not rules that merely happen to touch the world. Distinct from \`systemDeltas.addedNodes\` (which is for genuinely new concepts).
    DISCIPLINE: cite a rule only when removing it would change the scene's outcome. 0–8 attributions per scene. Don't pad. A rule "merely active in the world" is not an attribution; a rule "load-bearing in this scene's logic" is.
    EDGE PROMPTS: when two existing system nodes are co-attributed in the same scene and no edge yet links them, emit a new \`addedEdges\` entry capturing the relationship the scene just surfaced. Co-attribution without a connection is the strongest signal that a connection deserves to exist.
  </rule>

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
    <mode name="flashback" hint="Excursion into the past; narrative returns.">
      Negative value. Reveal-weighted: the present POV/reader LEARNS; the past does not re-mutate. worldDeltas favour belief/state/secret nodes on the present-self. A later scene MUST cancel the jump with a positive delta. e.g. {-10, year, "flashback to her schooldays"} → eventually {10, year, "back in the present"}.
    </mode>
    <mode name="time-travel" hint="Diegetic travel — timeline forks, no return.">
      Negative value. Unlike flashback, the narrative now LIVES in the new time; subsequent deltas are relative to the new position.
      • traveller carries memory forward (worldDeltas flag knowledge "carried from later")
      • world snaps to its earlier state; do NOT propagate present-day deltas backward
      • surface the mechanic as a systemDelta; add a chaos/rupture marker for paradox-prone travel
      e.g. {-3, hour, "three hours earlier, using the Time-Turner"} → next scene {1, hour, "an hour after arrival"}.
    </mode>
    <decision-test>Flashback returns; time-travel doesn't. Continuous vs skip: ≥1 week with active anchors = skip, compensate.</decision-test>
  </rule>

  <rule name="tag-richly-discipline" hint="Floors and per-tier density bands live in force-standards / deltas; this rule adds scene-shape-specific guidance.">
    <thread-step>One threadDelta per thread per scene; transitions move ONE step forward.</thread-step>
    <profile mode="reflective-pov" hint="Solo-POV scenes, mostly thinking/planning.">POV is STILL the most-changed entity — expect 4-6 nodes on POV alone (belief/state/goal/capability/secret), plus 2-3 on adjacent entities (location witnessed, artifact handled, off-screen party affected). A reflective scene with only one POV delta is broken.</profile>
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
</instructions>`;
}
