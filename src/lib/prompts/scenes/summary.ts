/**
 * Summary Requirement Prompt
 *
 * The scene summary is the load-bearing artifact that feeds plan and prose
 * generation downstream — and it's the only artifact other scenes can read.
 * Detail that lives only in prose evaporates at the scene boundary; detail
 * in the summary stays canonical and downstream-readable. Length matches
 * information density, not a fixed word count.
 */

export const PROMPT_SUMMARY_REQUIREMENT = `<summary-requirement length="adaptive — depends on paradigm" hint="The downstream writer's only brief — the artifact every later pass (plan, prose, structural fate, briefing, search) reads. Calibrate density to what this scene actually carries; the paradigm decides whether 'routine' or 'cognition-dense' is the default.">

  <length-policy hint="Calibrate to information density. Under-writing dense scenes is the dominant failure mode.">
    <default kind="routine" length="3-6 sentences">Physical action, dialogue, observable events, single-thread movements, scene-setting beats, simple contest moves, single-time-step chronicle entries.</default>

    <expand kind="cognition-dense" length="no functional upper bound — write the reasoning at full resolution">
      Triggers (any of): multi-step planning with named tradeoffs; scheme construction with multiple moving parts; modelling other agents' likely responses; deriving conclusions from named premises with each step's warrant; complex rule-set reveals; multi-thread coordination; argument sections weighing claim against counter; panel sessions where the cast actually disagrees and converges; typology entries that distinguish their entry against neighbours; reasoning depth that 3-6 sentences can't hold without compression.

      For these scenes, the summary MUST contain the actual computation, not a label for it.
        Wrong: "Mara refined her approach to the upcoming arbitration, weighing options and assessing risks."
        Right: "Mara considered three approaches to the arbitration. Approach A — open with her strongest precedent and force the panel to address it directly — offered fast resolution but burned her secondary arguments if the panel rejected it. Approach B — sequence weaker precedents first to anchor the panel's attention before deploying her strongest — depended on the chair's known impatience holding for at least thirty minutes. Approach C — concede the most contentious point upfront in exchange for a tighter scope ruling — sacrificed leverage but eliminated the panel's main objection. She rejected A because the chair's history showed he hardens against frontal arguments raised in the first ten minutes. She committed to B for the morning session while preparing C as a fallback for the afternoon, identifying the signal she needed from the chair's opening: if he raised the scope question, sequencing was unsalvageable and she had to pivot to C immediately."

      Expand the summary as far as the reasoning demands — multiple paragraphs are normal for genuinely dense scenes. The penalty is for missing content, not length.
    </expand>

    <by-paradigm hint="The paradigm decides which case is the default. The cognition-dense bar above is the same in every paradigm; what shifts is how often you'll cross it.">
      <paradigm name="fiction / non-fiction">Routine is the default; expand to cognition-dense when triggers fire (multi-step planning, complex reveals, layered argument staged through a viewpoint).</paradigm>
      <paradigm name="simulation">Routine for scenes that execute the rules straightforwardly; cognition-dense when the agent under the rules is reasoning about position, counter-moves, modelled trajectories, or rule-state in detail.</paradigm>
      <paradigm name="essay">Cognition-dense is the DEFAULT — most sections weigh claims, present evidence, state a mechanism, engage a counter, or derive an implication. A 3-6 sentence summary signals a framing or transitional section; argument-bearing sections read longer.</paradigm>
      <paradigm name="panel">Cognition-dense is the DEFAULT for sessions where the cast disagrees and reasons through evidence; routine for opening / closing / scheduling beats.</paradigm>
      <paradigm name="atlas">Cognition-dense when the entry distinguishes itself against neighbours, articulates a mechanism, or carves a sub-classification; routine for simple descriptive entries.</paradigm>
      <paradigm name="debate">Routine for procedural moves (filings, witness called, motion entered); cognition-dense when the move embodies strategy, calibrates leverage, or hinges on the contest's rules in nontrivial ways.</paradigm>
      <paradigm name="record">Routine for chronicle entries logging single events at the declared velocity; cognition-dense when an entry compresses a long period, weighs multiple trajectories at once, or marks a structural shift.</paradigm>
    </by-paradigm>
  </length-policy>

  <division-of-labour>
    <captures-in-summary>Claims made, scenarios weighed, conclusions reached, named tradeoffs accepted, structural relationships inferred, the reasoning chain itself. Anything downstream prose / plan / future scenes need to be coherent with.</captures-in-summary>
    <captures-in-plan-and-prose>Sensory texture, beat pacing, line-by-line dialogue, atmospheric detail, prose flavour. Plan and prose handle HOW the cognition is delivered; the summary owns WHAT was cognised.</captures-in-plan-and-prose>
    <why>Prose-only detail is per-scene — the next scene's plan can't see it. Summary is canonical and read by every downstream pass (plan, prose, fate-reextract, briefing, search). If a thought matters across scenes, it must live in the summary.</why>
  </division-of-labour>

  <include>
    <item>Specific entity names (not IDs).</item>
    <item>Concrete specifics (objects, dialogue, data, claims).</item>
    <item>Observable consequences.</item>
    <item>Context — time span, method, tone shifts, structural role.</item>
    <item kind="cognition-dense">Each scenario considered (named), each tradeoff weighed (named), each conclusion reached (named), each agent modelled (named with their predicted reaction).</item>
  </include>

  <name-the-thing hint="Specificity is what works; vagueness is what fails. The source's register decides whether the named thing surfaces through demonstration, direct statement, image, or citation — not the prompt.">
    <pattern>Inner-state verbs (realizes, confirms, understands, suspects, decides) standing alone as the ONLY delta — unless the realisation itself is NAMED (a specific new claim, a specific reframing) and ATTRIBUTED (to author, narrator, or source). "She felt something shift" fails. "The narrator realises the archive is organised by the logic of its absences, not its holdings" works.</pattern>
    <pattern>Stand-in cognitive verbs that label thinking without naming content: "considered the situation", "weighed his options", "planned carefully". Name what — the scenarios, the tradeoffs, the conclusion.</pattern>
    <pattern>Gestural emotion-words ("felt", "seemed", "somehow", "a strange sense", "face etched", "expression unreadable", "groundbreaking implications") without a specific tether.</pattern>
    <pattern>Emotional or thematic endings that assert a feeling with no observable consequence. "David leaves unsettled, realising his source's narrative may be only one side of the story" partially redeems itself with a named reframe (one-side-of-two) but "unsettled" is gestural. Tether the consequence: "David downgrades his confidence in the Zhang lead from canonical to contested, now treating it as one of two competing narratives the next scene must reconcile."</pattern>
  </name-the-thing>

  <no-engine-metadata critical="true" hint="The summary is IN-WORLD content. Engine bookkeeping has its own structured fields — never narrate the bookkeeping inside the summary.">
    <rule>NEVER reference engine field names — threadDeltas, worldDeltas, systemDeltas, relationshipDeltas, attributions, attributionEdges, ownershipDeltas, tieDeltas, characterMovements, artifactUsages, events — as bookkeeping inside summary prose. These fields exist SEPARATELY in the JSON. The cross-reference discipline (every delta traces to a summary sentence) lives in your reasoning, NOT in the summary text.</rule>
    <wrong>"ThreadDeltas update T-1 and T-5 with strong positive evidence for decoupling acceleration."</wrong>
    <wrong>"SystemDeltas add a rule about Chinese policy leak dual purposes."</wrong>
    <wrong>"WorldDeltas capture Elena's skepticism and each expert's conviction."</wrong>
    <wrong>"ThreadDeltas update T-3 with evidence against overextension, shifting probability towards 'contain'."</wrong>
    <right>Write the in-world content that JUSTIFIES those deltas — what was claimed, what evidence shifted the read, what rule the scene established as canonical fact. "Zhang's hint on direct R&D subsidy adds a concrete bypass mechanism to the model, raising the team's 2027-trigger probability from 65% to 70%." "The committee commits to a 70% confidence floor before allocating, citing the 2008 carry-trade incident as Elena's reference."</right>
    <why>Engine-bookkeeping recap in the summary is a self-checklist of what you intend to put in the delta fields. The fields catch up structurally — you do not need to narrate them. Reclaim that budget for the in-world substance.</why>
  </no-engine-metadata>
</summary-requirement>`;
