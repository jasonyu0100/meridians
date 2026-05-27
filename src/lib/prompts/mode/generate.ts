/**
 * Mode generation prompt — mines narrative context (with optional
 * user guidance and optional seed graph) and emits a JSON phase graph
 * describing the HIGH-LEVEL META MACHINERY of the world / simulation: the
 * structural underpinnings of its economy, the meta-narrative tropes and
 * patterns the work runs on, the societal constraints and pulls of its
 * institutions, the foundational machinery from which everything else
 * derives meaning. Distinct from situational state — PRG describes the
 * MACHINERY OF REALITY, not the moment-to-moment action.
 *
 * Consumed downstream by CRG / scene / plan / prose generation: PRG sits
 * UNDER all of them as the foundational layer that gives meaningful body
 * to per-arc reasoning, beats, and prose. Its impact trickles down — the
 * higher layers operate ON TOP of the world the PRG describes.
 *
 * Modes are immutable; users regenerate (optionally seeded) or
 * clear to induce phase changes in the simulation.
 */

import { GRAPH_THINKING_PRINCIPLE } from "../reasoning/principles";
import {
  composeAnalystIdentity,
  type WorkIdentity,
} from "../paradigm";
import { PRINCIPLE_PARADIGM_FIDELITY } from "../principles";

export function buildPhaseGraphSystem(work?: WorkIdentity): string {
  const identity = work?.paradigm ? `${composeAnalystIdentity(work)} ` : '';
  const fidelity = work?.paradigm ? `\n\n${PRINCIPLE_PARADIGM_FIDELITY}` : '';
  return `${identity}You are a thinking partner. ${GRAPH_THINKING_PRINCIPLE} Scope: a phase graph exposing the META MACHINERY of this work — the structural underpinnings (economic / material / political / methodological / institutional / cultural), the patterns and conventions the work runs on, the landmarks whose machinery still binds. NOT situational state; the substrate downstream layers (CRG, scenes, plans, prose) inherit and operate on. In a simulation paradigm, the PRG IS the rule set being modelled — rules are the foundational laws, agents are institutional / faction / market drivers, pressures are macro forcings, landmarks are initial conditions whose machinery still binds. In other paradigms, the PRG names the conventions, attractors, and pressures the paradigm's own logic operates under. Return ONLY valid JSON matching the schema in the user prompt.${fidelity}`;
}

export type ModePromptArgs = {
  /** Pre-built `<narrative-context>` body. */
  context: string;
  /** Optional seed-graph block — XML-rendered prior phase graph the user is regenerating from. */
  basedOnSection?: string;
  /** Optional user guidance / hypothesis (free text). */
  guidance?: string;
  /** Min/max target node counts. */
  nodeCountMin: number;
  nodeCountMax: number;
};

export function buildModePrompt(args: ModePromptArgs): string {
  const { context, basedOnSection, guidance, nodeCountMin, nodeCountMax } = args;

  return `<inputs>
  <narrative-context>
${context}
  </narrative-context>
${basedOnSection ? `\n  ${basedOnSection.replace(/\n/g, '\n  ')}\n` : ''}
${guidance?.trim() ? `  <user-hypothesis hint="The user proposes a particular reading of the working model. Surface a phase graph that embodies or tests this hypothesis where the canon supports it; do not invent canon to fit it.">${guidance.trim()}</user-hypothesis>\n` : ''}
</inputs>

<task>Mine the narrative context and emit a PHASE GRAPH — the high-level META MACHINERY of this work. Describe the structural underpinnings (economic / material, political / institutional, rule-system or methodological framework, cultural / disciplinary, generic, institutional) that everything else derives from.</task>

<phase-doctrine>
  <principle name="meta-not-situational">A phase graph describes the WORK'S MACHINERY, not its moment-to-moment state. Situational claims (a current negotiation, a section currently rebutting an author) belong in CRG/scene work. Machinery claims describe the structural underpinnings situational reasoning sits on top of — the resource economy that pressures certain agents to compete, the incentive economy that rewards novelty over confirmation, the institutional rules that shape how disputes are mounted.</principle>
  <principle name="machinery-trickles-down">Higher-priority layers (direction, CRG, scenes, beats, prose) operate ON TOP of the world this PRG describes. Surface the underpinnings and the higher layers will inherit meaningful body — economic and incentive structures that explain why agents act the way they do, conventions that explain why the next beats land, institutional pulls that explain why groupings stay in their lanes or break out.</principle>
  <principle name="canon-grounded">Every node anchors in the source above. A meta-claim with no supporting evidence in source is a hallucination — surface only the machinery the source ACTUALLY implies. The user-hypothesis (if present) is a lens, not a licence to invent.</principle>
  <principle name="structural-not-individual">Agents are FACTIONS, INSTITUTIONS, MARKETS, SCHOOLS-OF-THOUGHT, GENERIC FORCES — not individual actors. A licensure body, a merchant guild, a funding agency, a dominant methodological school is structural; a single named individual is not. Pressures are MACRO (demographic, economic, political, cultural, epistemic) not interpersonal. Patterns are STRUCTURAL shapes — the kind a tradition, discipline, or institution reproduces across instances, not work-level configurations.</principle>
  <principle name="seven-types">Each node type captures a different facet of the machinery: pattern (structural tropes the work runs on), convention (procedural defaults), attractor (where the machinery structurally pulls), agent (institutional/faction/market driver), rule (foundational rule that shapes what's possible — physical, economic, methodological, normative), pressure (macro pressure accumulating in the world), landmark (foundational past event or seminal work whose machinery still defines the present). Pick the type that matches what the node IS at the meta level.</principle>
  <principle name="examples-of-scope">Good PRG nodes describe structural underpinnings: "a finite resource creates winner-take-all dynamics that hollow out middle-tier institutions" (rule); "every act of foreknowledge accrues a debt that must eventually settle" (pattern); "the dominant licensure body functions as the de facto gatekeeper" (agent); "gradual depopulation of trained practitioners across the periphery" (pressure); "a foundational compact still defines the present succession framework" (landmark). Simulation-register examples (span subgenres — historical counterfactual / wargame / policy / pandemic / climate / agent-based / cultivation): "Mughal jagir revenue is reassessed every cycle against assessed yield" (rule); "Politburo standing-vote requires 72-hour unanimity for DEFCON escalation" (rule); "schools compound transmission risk by gathering mixed cohorts" (pressure); "the redistribution panchayat enforces above the four-hectare ceiling" (agent); "the founding Concord still defines hereditary practice rights" (landmark); "hereditary qi-reservoirs deplete one generation faster than doctrine permits, forcing succession crises" (pattern). Bad PRG nodes are situational ("an actor distrusts a counterpart", "this paragraph rebuts the cited claim", "the model produced output X this turn") or source-fact ("the artefact is currently at the southern fortress", "the dataset has 1,245 rows") — neither describes the machinery downstream layers should inherit.</principle>
</phase-doctrine>

<node-types hint="Every node grounded in canon, framed at the META level. Every PRG node carries the universal INFERENCE-NODE-SHAPE (detail + considered + breaks + opens) — see <inference-node-shape> below. The four fields together turn a PRG claim into a thinking aid: detail names the machinery, considered names rival readings, breaks names the conditions under which the machinery fails, opens names downstream cascades the CRG can inherit.">
  <type name="pattern">A structural trope or recurring shape the work runs on. NOT a single-instance configuration — a STRUCTURAL pattern at the level of "this kind of work always does X". Label = the trope in 4-12 words.</type>
  <type name="convention">A procedural default — how the work's world or field handles a class of situation. Label = the default. Conventions are rules embedded in practice, not individual habits.</type>
  <type name="attractor">A target the work's machinery STRUCTURALLY pulls toward — the long-arc destination implied by economics, demographics, political dynamics, or structural tradition. Label = the target. Not an individual entity's goal — a systemic gravitational well.</type>
  <type name="agent">An INSTITUTIONAL / FACTIONAL / MARKET / SCHOOL-OF-THOUGHT driver — a structural agent the work contains. Use entityId only for named institutional entities; structural agents are NOT individual actors. Label = the agent + its drive.</type>
  <type name="rule">A FOUNDATIONAL rule that shapes what's possible — physical machinery, economic laws, methodological constraints, normative bindings. Use systemNodeId for existing SYS-XX rules. Label = the rule as it shapes the world.</type>
  <type name="pressure">A MACRO pressure — demographic, economic, political, cultural, epistemic — accumulating in the work. NOT an interpersonal tension. Label = the pressure + its discharge target.</type>
  <type name="landmark">A FOUNDATIONAL past event or seminal work whose machinery still defines the present. Label = the event + its enduring machinery.</type>
</node-types>

<inference-node-shape hint="Universal shape — same fields as CRG / coord-plan. For PRG, the handles describe how the machinery WORKS, FAILS, and CASCADES.">
  <field name="detail" required="true">2–4 sentences. The meta-level principle + canon evidence (sections/arcs/cases) + why the underlying tradition makes it structural. Must read as specific to THIS work, not generic.</field>
  <field name="considered" required="true" critical="true">1–3 sentences naming rival readings of the same evidence — alternative interpretations of this machinery considered and discarded. If no rival reading genuinely applies (rule unambiguously stated at [source]), say so explicitly here — never omit silently.</field>
  <field name="breaks" required="strongly-encouraged">1–2 sentences. Carve-outs / edge cases / conditions where the machinery does NOT bind. Every operational structure has them; a node with none is suspicious.</field>
  <field name="opens" required="strongly-encouraged">1–2 sentences. Downstream operational cascade — what a CRG/scene can inherit. The field that makes the PRG inheritable.</field>
  <discipline>Every node MUST carry \`considered\` (silent omission is logged).</discipline>
</inference-node-shape>

<edge-types hint="Reuse the CRG ontology. Direction matters.">
  <edge name="enables">A makes B possible (B could exist without A, but not in this phase).</edge>
  <edge name="constrains">A limits/blocks B.</edge>
  <edge name="risks">A creates danger for B.</edge>
  <edge name="requires">A depends on B (A needs B; reversing corrupts the graph silently).</edge>
  <edge name="causes">A leads to B (B would not exist without A).</edge>
  <edge name="reveals">A exposes information in B.</edge>
  <edge name="develops">A deepens B (use for agents/attractors that mature, not generic logic).</edge>
  <edge name="resolves">A concludes/answers B.</edge>
  <edge name="supersedes">A replaces/overrides B — the older claim, rule, pattern, or convention is no longer load-bearing; A is what the phase now operates on. Use when a new convention has displaced an older one, when a landmark's influence has been overtaken, when a fresh pattern is succeeding a faded one.</edge>
</edge-types>

<requirements>
  <requirement index="1" name="meta-not-situational" critical="true">Every node describes WORLD MACHINERY, not situational state. If a node could be answered by "what's happening right now in this scene/arc", it belongs in CRG, not PRG. Rewrite at the structural level (economic, political, methodological, cultural, generic, institutional) until removing the node would change the work's machinery, not just the current narrative thread.</requirement>
  <requirement index="2" name="canon-grounded" critical="true">Every node cites or implicates specific source — but framed as the META principle, not the source instance. "Three mentor figures lost across arcs 1-4" is the EVIDENCE; the node says "Mentor figures structurally fall before the work's decisive commitment". Generic claims that could attach to any work fail.</requirement>
  <requirement index="3" name="trickle-down-test">For each node, ask: would a downstream CRG / scene / plan / prose generator inherit MEANINGFUL BODY from this? Could it use the machinery to ground per-arc reasoning? If the answer is no, the node is too abstract — sharpen until it gives downstream layers something to operate on. The \`opens\` field is the load-bearing cascade for inheritability.</requirement>
  <requirement index="3b" name="inference-shape-on-every-node" critical="true">Every PRG node carries the full <inference-node-shape>: \`detail\` + \`considered\` + \`breaks\` + \`opens\`. PRG nodes describe machinery, so each handle exposes a different operational facet (rival readings; failure conditions; downstream cascades). A node that supplies only \`detail\` is a generic principle; the other three are what make it a usable thinking aid AND an inheritable substrate for downstream stages.</requirement>
  <requirement index="4" name="structural-agents">Agents are INSTITUTIONS / FACTIONS / MARKETS / SCHOOLS-OF-THOUGHT / GENERIC FORCES — not individual actors. A licensure body, a merchant guild, a funding agency, a dominant methodological school — yes; a single named entity carrying the weight on its own — no (it belongs in CRG). Use entityId only when an existing entity functions as a structural institution. At least 2 distinct structural agents in any non-trivial PRG.</requirement>
  <requirement index="5" name="node-count">Target ${nodeCountMin}-${nodeCountMax} nodes. Distribute across types — a PRG that is all patterns or all rules under-represents the machinery.</requirement>
  <requirement index="6" name="every-type-considered">Walk the seven node types deliberately. Not every type must appear, but each must be considered; absence is a deliberate choice.</requirement>
  <requirement index="7" name="pressure-discharge">Every pressure node names a discharge target at the macro level — what the structural pressure is heading toward (forced consolidation, regime collapse, demographic shift). Pressures without structural direction are texture, not phase.</requirement>
  <requirement index="8" name="landmark-anchoring">Every landmark names the present-tense MACHINERY it still defines — the operational framework, the legal compact, the precedent. "Influence persists" is too vague; say what STRUCTURE it still produces.</requirement>
  <requirement index="9" name="sequential-indexing">\`index\` is a topological order over the edges — 0 is a root (no causal predecessors), each later index's predecessors have lower indices. Walking ascending indices should read as the world's machinery building up from foundational landmarks/rules to current attractors.</requirement>
  <requirement index="10" name="entity-references">Agent nodes use entityId only for institutional/structural entities; rule nodes use systemNodeId for existing SYS-XX rules; landmark/pressure nodes can use threadId when anchored to a major arc-spanning thread. Hallucinated ids are stripped at parse time.</requirement>
  <requirement index="11" name="connect-the-graph">No orphans. Patterns embody landmarks; landmarks enable rules; rules constrain conventions; conventions encode agent-behaviour; agents create pressures; pressures pull toward attractors. Lone nodes are decoration; cut or connect.</requirement>
  <requirement index="12" name="supersedes-where-relevant">When the world's machinery has shifted (a new convention has displaced an older one, a foundational landmark has been overtaken by a newer one), mark with a \`supersedes\` edge. Do NOT include the superseded node as a separate orphan — fold it into the supersession.</requirement>
  <requirement index="13" name="based-on-divergence">If a prior phase graph is provided, do NOT replicate it. The new graph must visibly diverge — supersede outdated nodes, surface emergent machinery the prior missed, retire pressures that have structurally discharged.</requirement>
  <requirement index="14" name="hypothesis-honesty">If the user provided a hypothesis, surface evidence FOR it where canon's machinery supports, evidence AGAINST where canon contradicts, and refuse to invent. The PRG is the user's diagnostic instrument for the world's machinery — distorting it to match the hypothesis breaks the instrument.</requirement>
</requirements>

<shape-of-good-mode>
  A diagram of the WORK'S MACHINERY: the structural underpinnings that everything situational sits on top of. Foundational rules shape what's possible; conventions encode how the work's world or field handles classes of situation; institutional and school-of-thought agents drive at the structural level; macro pressures accumulate; foundational landmarks (founding events, seminal works) define the present's terms; structural patterns give the work its shape; attractors name where the machinery is structurally pulling. When you finish, scan: could this PRG describe ONLY this work, or is it generic? Could a CRG / scene generator looking at this PRG inherit meaningful body for THIS work's reasoning? If yes, it's working; if no, it's too abstract.
</shape-of-good-mode>

<output-format>
Return ONLY a JSON object.

<format-requirements>
  <ids>SEMANTIC slugs prefixed by type: \`<type>-<kebab-case-subject>\`. 3-6 words, lowercase, hyphenated. Examples: \`pattern-mentor-falls-before-final\`, \`convention-succession-by-formal-challenge\`, \`attractor-faction-consolidation\`, \`agent-licensure-board-enforcement\`, \`rule-foundational-resource-non-renewable\`, \`pressure-practitioner-line-decline\`, \`landmark-founding-concord\`. Do NOT use opaque codes.</ids>
  <labels>PROPER ENGLISH (4-12 words), natural language. Each label states the META machinery as a fact about how the world works.</labels>
</format-requirements>

<example>
{
  "summary": "1-2 sentence reading of the work's META machinery — the structural underpinnings (economic/political/methodological/cultural/generic) downstream reasoning will inherit.",
  "plannedNodeCount": 9,
  "nodes": [
    {"id": "landmark-founding-concord", "index": 0, "type": "landmark", "label": "The founding Concord established the modern licensure economy", "detail": "When the practising orders withdrew from open contact with the wider polity, the resulting compact became the structural basis of every institution that followed — the licensure board's enforcement remit, the academies' isolation, the underground markets.", "considered": "Considered as a parallel pressure rather than a landmark — rejected because the present-tense institutions still operate inside the Concord's framework rather than around it.", "breaks": "Breaks (operationally) if a polity-wide convocation re-opens the compact — the work hasn't shown this as a current possibility, so the machinery persists.", "opens": "Cascades into present-day enforcement events: every public exposure of unsanctioned practice accrues an institutional debt downstream reasoning must price."},
    {"id": "rule-reservoir-non-renewable", "index": 1, "type": "rule", "label": "Hereditary practising lines do not regenerate within a generation", "detail": "Once a practising lineage thins below the threshold, recovery is structurally impossible within a single generation — houses must intermarry or fade.", "considered": "Considered as a slow demographic trend rather than a hard rule — rejected because canon shows multiple cases where lines below threshold could not recover even with deliberate effort, signalling a structural constraint not a tendency.", "breaks": "Carve-out: branches admitted to the regulatory registry are exempt (their lines count as merged with the registry's). Edge case: foreign hereditary lines arriving via marriage can refresh a faltering house.", "opens": "Cascades into faction politics: middle-tier houses live one bad cycle from extinction, structurally shaping alliance behaviour — downstream CRG inherits this when modelling any house's strategic horizon.", "systemNodeId": "SYS-12"},
    {"id": "pattern-mentor-falls-before-final", "index": 2, "type": "pattern", "label": "Mentor figures structurally fall before the anchor's final commitment", "detail": "Structural pattern this kind of work runs on: the anchor must face the decisive moment without the mentor's continued mediation, so the work systematically removes the mentor in the middle act — whether the decisive moment is a confrontation, a published claim, or a final argument.", "considered": "Considered as 'mentor fails the anchor's expectations' rather than 'mentor is removed' — rejected because canon evidence shows literal removal (death, departure, retraction) across three of the four prior arcs, not just disillusionment.", "breaks": "Breaks if a mentor's removal cost would corrupt a load-bearing thread (e.g. mentor as POV); in those cases the work substitutes a structural absence — mentor stays alive but becomes unavailable.", "opens": "Trickles down to CRG: any mentor introduced in the opening arc carries structural mortality weight by the late middle. Downstream layers should price this when deciding which entity becomes a mentor figure."},
    {"id": "agent-licensure-board", "index": 3, "type": "agent", "label": "The licensure board enforces sanction against unsanctioned practice", "detail": "Structural agent — not a single individual but the polity's enforcement mechanism. Its leverage: investigators, sanctioned punishments, regulatory courts.", "considered": "Considered framing as a passive bureaucracy that responds to complaints — rejected because canon shows the board initiating investigations proactively when underground markets lean toward exposure.", "breaks": "Cannot act inside a sanctioned academy or hereditary house. Cannot pursue cases the standing-quorum has invalidated. Edge case: charters older than the Concord exempt their bearers entirely.", "opens": "Manifests in canon as enforcement events that re-price the underground markets which lean too far toward exposure — CRG arcs whose plans involve unsanctioned operations must price the board's likely response."},
    {"id": "agent-houses-compact", "index": 4, "type": "agent", "label": "The Great Houses' founding compact governs all succession law", "detail": "Institutional agent: the compact is the operational legal framework; every house's internal politics derive from how they interpret it. Drives toward consolidation under whichever interpretation gains majority backing."},
    {"id": "pressure-line-decline", "index": 5, "type": "pressure", "label": "Demographic decline of the old practising lines, accumulating toward forced intermarriage", "detail": "Macro pressure: birth rates among the old houses have fallen for three generations, leaving them with insufficient heirs. Threshold: one more bad cycle forces consolidation. Discharge form: most likely an inter-house marriage compact or a forced merger under the Great Houses' framework."},
    {"id": "convention-succession-by-challenge", "index": 6, "type": "convention", "label": "House succession decided by formal challenge, not strict bloodline", "detail": "Cultural default since the founding compact: leadership transfers through formal challenge, with ritual outcomes binding. Standing exception: branches that have entered the regulatory registry are exempt. Enforced by the Great Houses compact."},
    {"id": "attractor-house-consolidation", "index": 7, "type": "attractor", "label": "Structural consolidation of the Great Houses under a single succession framework", "detail": "Where the machinery pulls: economic pressure (line decline) + demographic pressure (heir shortage) + the compact's interpretation politics all gravitate toward unified succession. What would deflect: a successful counter-framework that lets houses survive without consolidating."},
    {"id": "pattern-foreknowledge-debt-cycle", "index": 8, "type": "pattern", "label": "Structural rule: every act of foreknowledge accrues a debt that must eventually settle", "detail": "Meta-structural pattern this kind of work reproduces — the debt always settles, the only question is on what scale. Trickles down to CRG: every plan that uses prior knowledge must include a cost that arc reasoning prices into the chain."}
  ],
  "edges": [
    {"id": "e1", "from": "landmark-founding-concord", "to": "rule-reservoir-non-renewable", "type": "enables"},
    {"id": "e2", "from": "rule-reservoir-non-renewable", "to": "agent-licensure-board", "type": "constrains"},
    {"id": "e3", "from": "convention-succession-by-challenge", "to": "pressure-line-decline", "type": "causes"},
    {"id": "e4", "from": "pattern-mentor-falls-before-final", "to": "agent-licensure-board", "type": "constrains"},
    {"id": "e5", "from": "agent-houses-compact", "to": "agent-licensure-board", "type": "enables"},
    {"id": "e6", "from": "pressure-line-decline", "to": "attractor-house-consolidation", "type": "risks"},
    {"id": "e7", "from": "agent-licensure-board", "to": "attractor-house-consolidation", "type": "develops"},
    {"id": "e8", "from": "pattern-foreknowledge-debt-cycle", "to": "pattern-mentor-falls-before-final", "type": "supersedes"}
  ]
}
</example>
</output-format>

<final-instruction>Return ONLY the JSON object.</final-instruction>`;
}
