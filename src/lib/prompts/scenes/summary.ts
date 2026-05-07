/**
 * Summary Requirement Prompt
 *
 * The scene summary is the load-bearing artifact that feeds plan and prose
 * generation downstream — and it's the only artifact other scenes can read.
 * Detail that lives only in prose evaporates at the scene boundary; detail
 * in the summary stays canonical and downstream-readable. Length matches
 * information density, not a fixed word count.
 */

export const PROMPT_SUMMARY_REQUIREMENT = `<summary-requirement length="adaptive — 3-6 sentences for routine scenes; expand without upper bound for cognition-dense scenes" hint="The prose writer's only brief for the scene. Match the register of the source material (fiction, non-fiction such as memoir / essay / reportage / research, or simulation — works modelling real-life events from a stated rule set).">

  <length-policy hint="Calibrate to information density. Under-writing dense scenes is the dominant failure mode.">
    <default kind="routine" length="3-6 sentences">Physical action, dialogue, observable events, single-thread movements, scene-setting beats.</default>

    <expand kind="cognition-dense" length="no functional upper bound — write the reasoning at full resolution">
      Triggers (any of): multi-step planning with named tradeoffs; scheme construction with multiple moving parts; modelling other agents' likely responses; deriving conclusions from named premises with each step's warrant; complex world-rule reveals; multi-thread coordination; reasoning depth that 3-6 sentences can't hold without compression.

      For these scenes, the summary MUST contain the actual computation, not a label for it.
        Wrong: "Mara refined her approach to the upcoming arbitration, weighing options and assessing risks."
        Right: "Mara considered three approaches to the arbitration. Approach A — open with her strongest precedent and force the panel to address it directly — offered fast resolution but burned her secondary arguments if the panel rejected it. Approach B — sequence weaker precedents first to anchor the panel's attention before deploying her strongest — depended on the chair's known impatience holding for at least thirty minutes. Approach C — concede the most contentious point upfront in exchange for a tighter scope ruling — sacrificed leverage but eliminated the panel's main objection. She rejected A because the chair's history showed he hardens against frontal arguments raised in the first ten minutes. She committed to B for the morning session while preparing C as a fallback for the afternoon, identifying the signal she needed from the chair's opening: if he raised the scope question, sequencing was unsalvageable and she had to pivot to C immediately."

      Expand the summary as far as the reasoning demands — multiple paragraphs are normal for genuinely dense scenes. The penalty is for missing content, not length.
    </expand>
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
    <pattern>Emotional or thematic endings that assert a feeling with no observable consequence.</pattern>
  </name-the-thing>
</summary-requirement>`;
