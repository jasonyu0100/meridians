/**
 * Beat Functions & Mechanisms Prompt — XML block injected into user prompts.
 *
 * Single source of truth for beat classification — used by plan generation,
 * reverse engineering, and prose generation.
 */

export const PROMPT_BEAT_TAXONOMY = `<beat-taxonomy hint="A beat is a single move within a scene. The 10 functions name what the move does; the 8 mechanisms name how the prose delivers it. The substance is whatever the source's register naturally carries — narrative event, argued claim, surfaced finding, image, current rule-state report — the taxonomy is the same.">

  <functions count="10" hint="What the beat does.">
    <fn name="breathe">Atmosphere, grounding, framing, stage-setting, statement of current rule-state.</fn>
    <fn name="inform">Someone learns something NOW — a participant or the audience registers a new fact, result, recognition, or rule reading.</fn>
    <fn name="advance">Forward motion: goals pursued, claim pressed, evidence accumulates, position consolidates, modelled trajectory progresses.</fn>
    <fn name="bond">Relational shift between any two positions — entities, stakeholders, framings, work and audience.</fn>
    <fn name="turn">Revelation, reversal, interruption, counterargument.</fn>
    <fn name="reveal">Underlying nature exposed through action or choice — of an entity, a rule, a dataset, a source, a modelled mechanism.</fn>
    <fn name="shift">Power dynamic or rule-driven leverage inverts — between participants, between framings, between stakeholders, between rule-driven trajectories.</fn>
    <fn name="expand">New rule, system, geography, mechanism, gate, propagation law, or citation introduced.</fn>
    <fn name="foreshadow">Plants information for LATER payoff (a seed that pays off as callback or as prediction tested).</fn>
    <fn name="resolve">Tension releases; question answered; claim settled; finding stated; rule-driven outcome locked.</fn>
  </functions>

  <mechanisms count="8" hint="How prose delivers. In simulation register, narration / document / environment frequently carry rule-state content — a casualty table is a document doing inform, a model dashboard or scenario map is environment doing breathe, an after-action paragraph is narration doing reveal, a finding-log entry or status sheet is document doing inform or resolve.">
    <mechanism name="dialogue">Quoted speech, quoted source, interview excerpt, reported speech, agent decision spoken aloud.</mechanism>
    <mechanism name="thought">Internal monologue or authorial reasoning — the POV's private inference, calculation, recognition, or modelled-state read.</mechanism>
    <mechanism name="action">Physical movement, gesture, demonstrated operation, procedure, worked step, executed move under the rule set.</mechanism>
    <mechanism name="environment">Setting, weather, sounds, dashboard / map / scenario board surfacing rule-state — sensory or situational establishment of the scene's space.</mechanism>
    <mechanism name="narration">Narrator voice, exposition, time compression, signposting, synthesis, observer-log voice over a model step or after-action note.</mechanism>
    <mechanism name="memory">Flashback or precedent triggered by association — earlier event, prior case, precursor literature, prior model run.</mechanism>
    <mechanism name="document">Embedded text — letter, sign, citation, table caption, figure, footnote, data excerpt, casualty table, status sheet, finding log, tier-gate readout.</mechanism>
    <mechanism name="comic">Humor, irony, absurdity, bathos, deliberate understatement.</mechanism>
  </mechanisms>

  <edge-cases>
    <case>Overhearing → environment.</case>
    <case>Thinking / reasoning internally → thought.</case>
    <case>Describing speech or paraphrasing a source → narration.</case>
    <case>Direct quotation of a source → dialogue or document (pick the closer fit).</case>
  </edge-cases>
</beat-taxonomy>`;
