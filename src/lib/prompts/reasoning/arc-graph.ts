/**
 * Investigation reasoning-graph prompt — produces a flexible causal graph
 * that serves as a THINKING AID for free-form reasoning anchored to a
 * position in the narrative. The user comes with something they want to
 * think through (a question, a hypothesis, an actor's stance, a tension,
 * a what-if) and the graph lays out the causal structure that grounds
 * that reasoning. The same artifact CAN additionally be used as a
 * continuation seed — copied back into generation as direction — but
 * that's a downstream option, not the default purpose.
 *
 * Coordination plans live in a separate prompt: those are solely focused
 * on long-form continuation. Investigations are intentionally multipurpose.
 *
 * Takes pre-built dynamic blocks (network state, pattern / anti-pattern
 * sections, style + resource preference blocks, prior-graph divergence
 * section) so the prompts module stays free of upstream dependencies.
 */

import { modePriorityEntry } from "../mode/application";
import { GRAPH_THINKING_PRINCIPLE } from "./principles";
import {
  composeAnalystIdentity,
  type WorkIdentity,
} from "../paradigm-roles";
import { PRINCIPLE_PARADIGM_FIDELITY } from "../principles";

function reasoningIdentity(work?: WorkIdentity): string {
  return work?.paradigm ? `${composeAnalystIdentity(work)} ` : '';
}

function reasoningFidelity(work?: WorkIdentity): string {
  return work?.paradigm ? `\n\n${PRINCIPLE_PARADIGM_FIDELITY}` : '';
}

export function buildArcReasoningGraphSystem(work?: WorkIdentity): string {
  return `${reasoningIdentity(work)}You are a thinking partner. ${GRAPH_THINKING_PRINCIPLE} Scope: a causal reasoning graph anchored to a position in this work. Investigations are open-ended chains — walk the substrate (entities, threads, system rules, fate, world) and surface what the position genuinely supports. When the direction asks for a hypothesis or outcome, yield it as a \`conclusion\` node grounded in real reasons drawn from the substrate. When the direction names an angle, explore it. When empty, continue from this position. Honour the thinking style (abduction / divergent / deduction / induction). Return ONLY valid JSON matching the schema in the user prompt.${reasoningFidelity(work)}`;
}

export function buildCoordinationPlanSystem(work?: WorkIdentity): string {
  return `${reasoningIdentity(work)}You are a thinking partner. ${GRAPH_THINKING_PRINCIPLE} Scope: a multi-arc coordination plan derived by BACKWARD INDUCTION — peaks (forces converge, threads culminate) and valleys (the arc pivots) as anchors, one per arc. Chronological indexing, agency distributed across actors, arc sizes and force compositions mixed, patterns/warnings routed around. In this paradigm's native register, peaks/valleys land as the paradigm's own load-bearing turning points (a dramatic climax in fiction; a rule-driven threshold crossing in simulation; a counterclaim ascendance in essay; an axis flipping in debate; a regime change in record). Return ONLY valid JSON matching the schema in the user prompt.${reasoningFidelity(work)}`;
}

export type CoordinationPlanContextForPrompt = {
  arcIndex: number;
  arcCount: number;
  forceMode?: string | null;
  directive: string;
};

export type ArcReasoningGraphArgs = {
  context: string;
  networkStateLine: string;
  activeThreads: string;
  characters: string;
  locations: string;
  artifacts: string;
  systemKnowledge: string;
  patternsSection: string;
  antiPatternsSection: string;
  arcName: string;
  sceneCount: number;
  coordinationPlanContext: CoordinationPlanContextForPrompt | undefined;
  direction: string;
  priorGraphSection: string;
  /** Pre-rendered <mode> block (or "" when no phase graph is active). */
  modeSection: string;
  forcePreferenceBlockText: string;
  reasoningModeBlockText: string;
  networkBiasBlockText: string;
  /** Min node-count target (computed from sceneCount × reasoning scale). */
  nodeCountMin: number;
  /** Max node-count target. */
  nodeCountMax: number;
};

export function buildArcReasoningGraphPrompt(args: ArcReasoningGraphArgs): string {
  const {
    context,
    networkStateLine,
    activeThreads,
    characters,
    locations,
    artifacts,
    systemKnowledge,
    patternsSection,
    antiPatternsSection,
    arcName,
    sceneCount,
    coordinationPlanContext,
    direction,
    priorGraphSection,
    modeSection,
    forcePreferenceBlockText,
    reasoningModeBlockText,
    networkBiasBlockText,
    nodeCountMin,
    nodeCountMax,
  } = args;

  return `<inputs>
  <narrative-context>
${context}
  </narrative-context>

  <network-state>${networkStateLine}</network-state>

  <available-entities hint="Quick pick-list — full annotations live on the entity tags in the narrative context above.">
    <active-threads hint="Threads are QUESTIONS the narrative must answer.">
${activeThreads || "None yet"}
    </active-threads>
    <key-characters>
${characters || "None yet"}
    </key-characters>
    <key-locations>
${locations || "None yet"}
    </key-locations>
    <key-artifacts>
${artifacts || "None yet"}
    </key-artifacts>
    <system-knowledge>
${systemKnowledge || "None yet"}
    </system-knowledge>
  </available-entities>

${patternsSection ? `  <patterns hint="Positive commandments to reinforce.">\n${patternsSection}\n  </patterns>` : ''}
${antiPatternsSection ? `  <anti-patterns hint="Pitfalls to avoid.">\n${antiPatternsSection}\n  </anti-patterns>` : ''}

  <investigation-brief anchored-to="${arcName}">
    ${direction.trim()
      ? `<direction hint="PRIMARY STEERING INPUT — what the user wants to think about. The graph's terminal answers it; the chain shows the reasoning that arrives at it.">${direction}</direction>`
      : `<direction hint="No direction supplied — default to CONTINUATION. Reason about what is causally about to unfold from this position in the narrative / arc, and why.">(continue the narrative — what comes next given the forces in play, and why)</direction>`}
  </investigation-brief>
${modeSection ? `\n  ${modeSection.replace(/\n/g, '\n  ')}\n` : ''}
${priorGraphSection ? `\n  ${priorGraphSection.replace(/\n/g, '\n  ')}\n` : ''}
${forcePreferenceBlockText ? `  ${forcePreferenceBlockText.replace(/\n/g, '\n  ')}\n` : ''}
${reasoningModeBlockText ? `  ${reasoningModeBlockText.replace(/\n/g, '\n  ')}\n` : ''}
</inputs>

<task>Build a causal reasoning graph that serves as a THINKING AID for the user, anchored to "${arcName}" as the current position in the narrative. Let the direction steer the shape: if it asks a question, the chain arrives at the answer; if it names an angle, the graph explores that angle's causal structure; if it's empty, default to CONTINUATION — what is causally about to unfold from this position, and why. The user will follow the chain step by step, refer to it, and may optionally copy its reasoning back into generation.</task>

<integration-hierarchy hint="When inputs conflict, this is the priority order. Higher-rank inputs override lower-rank ones; lower-rank inputs are still always relevant.">
  <priority rank="1">DIRECTION — the user's explicit ask. The graph's shape, terminal, and chain orientation are determined by what they're trying to think through. When direction is empty, the implicit ask is "continue from here" — reason about what unfolds next.</priority>
  <priority rank="2">PRIOR ARC GRAPH — divergence pressure; this investigation must NOT replicate the prior spine.</priority>
  ${modePriorityEntry(3, "reasoning-arc")}
  <priority rank="4">NARRATIVE CONTEXT — entities, threads, system rules; the substrate the chain stands on.</priority>
  <priority rank="5">THINKING STYLE / RESOURCE PREFERENCE — engine tilt applied within the constraints above.</priority>
</integration-hierarchy>

<reasoning-doctrine hint="Foundational principles guiding how the graph is constructed.">
  <principle name="threads-are-influence">Fate threads are INFLUENCE, not anchors. The signal per thread (LEANS / ACTIVE / CONTESTED / VOLATILE / FADING) is the force field — like characters, locations, system rules. LEANS pulls toward the leading outcome unless you're staging a twist. CONTESTED leaves room; ending more contested than started is legitimate. VOLATILE = where twists land. FADING = don't force evidence unless deliberately resurrecting.</principle>
  <principle name="markets-swing">Probability leadership is not destiny. A LEANS signal says "currently most likely given evidence" — not "the arc must deliver X." When the reasoning credibly forces a system event (hidden rule surfaces, constraint blocks the plan) or world event (allegiance change, rival capability surfacing, alliance fractures), the arc delivers it — even flipping a p=0.75 leader. Stage as twist nodes, not resistance nibbling. World and system can overturn fate's pull.</principle>
  <principle name="nodes-earn-existence">Every node does distinct work. Same subject (actor × action × target) = one node with more edges, not two. Minor-variation repetition is a pulse on the existing step.</principle>
  <principle name="novelty-is-motion">Novelty is forward motion. Resolved threads mostly stay resolved. Prefer NEW chains of reasoning over extending existing ones into minor variation. Sameness is stall; variety is how the audience feels the narrative moving.</principle>
  <principle name="three-forces-aggregate">Fate, world, and system converge here. Fate markets exert pressure; world entities bring agency; system rules constrain. Coherence comes from interaction, not dominance. Fate-only = thread outline; world-only = entity sketch; system-only = rulebook. Aggregation is the craft.</principle>
  <principle name="resolution-is-consequence">Resolution is the audience's payoff, but it's a CONSEQUENCE of reasoning, not a prerequisite. Land a LEANS thread when volume + margin + scene count suffice; otherwise the market carries forward. Forcing closure the arc can't earn is worse than leaving the thread pulsing. The feedback loop converges when each arc is honest about what it can deliver.</principle>
  <principle name="inference-exposes-its-machinery" critical="true">Reasoning, pattern, warning, and chaos nodes are INFERENCE-TIER — they exist to do thinking work the priors can't do alone. A reasoning node that only restates its predecessors is a description, not an inference. Genuine inference EXPOSES its machinery: what it selected from (rejected siblings), what would invalidate it (failure conditions), what it opens up (second-order possibilities). The four-field shape below is how the reader walks the chain and re-evaluates it at each step — without these handles, the graph collapses to chain-of-thought.</principle>
</reasoning-doctrine>

<inference-node-shape hint="Required on inference-tier nodes (reasoning, pattern, warning, chaos, conclusion). Priors do NOT use this shape.">
  <field name="detail" required="true">1–3 sentences. The causal logic — given predecessors, why this step follows. NOT graph-position metadata.</field>
  <field name="considered" required="true" critical="true">1–3 sentences naming sibling hypotheses considered and discarded, with why. Genuinely competitive, not strawmen. If no alternative genuinely applies (substrate fact / inherited constraint / terminal commitment), say so explicitly here — never omit silently.</field>
  <field name="breaks" required="strongly-encouraged">1–2 sentences. The load-bearing assumption whose negation voids the inference. If you can't name it, the inference doesn't predict.</field>
  <field name="opens" required="strongly-encouraged">1–2 sentences. Second-order possibilities this opens beyond the graph's drawn edges.</field>
  <discipline>Every inference-tier node MUST carry \`considered\` (silent omission is logged). \`detail\` is required; \`breaks\` and \`opens\` strongly encouraged.</discipline>
</inference-node-shape>

<node-types hint="Every node grounded in SPECIFIC context from the inputs above.">
  <type name="fate">A thread the reasoning actively couples to — landing an outcome, pushing toward resolution, or seeding a new market. NOT mandatory; appears when reasoning genuinely engages a thread. Use threadId. Label = what the thread does in this arc. LEANS often earns a closure-landing fate; CONTESTED may earn a deliberately-refused-to-resolve fate; FADING usually earns no fate at all.</type>
  <type name="character">An active agent with their OWN goals — not a reactive foil. Use entityId. Label = position/goal. Distribute agency: a graph routed through one focal actor is failure of agency. Include 2–3 distinct actors as drivers (rival, ally, counterpart — each with independent stake), each with their own causal chain.</type>
  <type name="location">A setting. Use entityId. Label = what it enables/constrains.</type>
  <type name="artifact">An object. Use entityId. Label = its role in reasoning.</type>
  <type name="system">A world rule/principle/constraint. Use systemNodeId for existing SYS-XX. Label = the rule as it applies here. New rules: omit systemNodeId — but reuse beats invention.</type>
  <type name="reasoning">A step in the causal chain — a distinct state-change (demand → plan, plan → action, action → consequence, consequence → new pressure). Same subject = one node with more edges. Minor restatements are pulses on the existing step — escalate or merge. Label = the inference (3-8 words). Carries the FULL INFERENCE-NODE SHAPE: <code>detail</code> + <code>considered</code> + <code>breaks</code> + <code>opens</code> (see <inference-node-shape> below). The four fields together expose the reasoning machinery, not just the conclusion — a node that supplies only <code>detail</code> is a description; the others are what make it a thinking aid.</type>
  <type name="pattern">NOVEL-PATTERN GENERATOR. Proposes a structural shape this work HAS NOT used before — fresh configuration, rhythm, or relational geometry. Specific, not generic. Examples: "First arc resolved through a non-POV actor's choice", "Two anchors separated across the arc". Scan prior arcs first.</type>
  <type name="warning">PATTERN-REPETITION DETECTOR. Flags shapes the narrative has already used — resolution rhythms, conflict geometries, dynamics, cadences — that this arc is drifting toward. Examples: "Third arc ending in external relief", "A and B have used tension-then-reconciliation three times", "Fourth consecutive fate-dominant arc". Name the repetition concretely.</type>
  <type name="chaos">OUTSIDE FORCE — operates outside fate/world/system. Two modes: unanticipated event (problems the existing entities couldn't anticipate, resolutions they couldn't construct — sudden interruption, new arrival, latent property surfacing); creative engine (seeds new threads later arcs develop). Sparingly under freeform; extensively under chaos-preference. Label = what arrives and its role. DO NOT set entityId or threadId — spawned via world expansion.</type>
  <type name="conclusion">DEFINITIVE ANSWER — the load-bearing terminal when the direction asks for a hypothesis or outcome. Exactly one per graph or omitted; sits at the highest \`index\` with incoming \`requires\` edges from substrate-grounded reasoning nodes. \`detail\` IS the answer and MUST be concrete — named instruments, actors, events, outcomes, timings — specific enough to act on. Abstract restatements of the substrate ("growth despite tension", "the system adapts") are a failure mode.</type>
</node-types>

<edge-types>
  <edge name="enables">A makes B possible (B could exist without A, but not here).</edge>
  <edge name="constrains">A limits/blocks B.</edge>
  <edge name="risks">A creates danger for B.</edge>
  <edge name="requires">A depends on B (direction matters — A needs B, not B needs A; reversing this corrupts the graph silently).</edge>
  <edge name="causes">A leads to B (B would not exist without A).</edge>
  <edge name="reveals">A exposes information in B.</edge>
  <edge name="develops">A deepens B (use for character/thread arcs only, not generic logic steps).</edge>
  <edge name="resolves">A concludes/answers B.</edge>
  <edge name="supersedes">A replaces/overrides B — the older claim, rule, plan, commitment, or state is no longer load-bearing; A is what the graph now operates on. Use when a new system rule overrides a prior one, when a fate commitment subverts an earlier expectation, when a character's revised model displaces their old model, or when a chaos event makes a prior reasoning step obsolete. Direction: A is the new/current, B is the old/displaced.</edge>
</edge-types>

<requirements>
  <requirement index="1" name="direction-shapes-the-graph" critical="true">The direction (or its absence) determines the graph's shape. When the direction asks for a hypothesis or outcome (actionable verbs: "what to buy / do / recommend", "which X", "should we / will"), yield a \`conclusion\` terminal grounded in real reasons drawn from the substrate — see the conclusion example below. Thematic angles explore causal structure without a conclusion. Empty direction = continuation mode. Name what you're investigating in the summary.</requirement>
  <requirement index="2" name="start-where-pressure-strongest">In backward modes (abduction/induction), start from the terminal — the conclusion answering the direction, or the most consequential next development the position is loaded with — and reason backward to the entity facts and rules that enable it. Terminal can be a conclusion, fate, reasoning, character-transformation, or system-revelation node; whichever best honours the direction.</requirement>
  <requirement index="3" name="causal-complexity">Capture REAL complexity. Threads pull on multiple things, entities influence multiple moments, rules constrain several choices. When you add a node, show all the places it matters. A graph that reads as a single vertical chain is under-representing the structure.</requirement>
  <requirement index="4" name="aggregate-three-forces">Coherence comes from fate, world, and system interacting, not one dominating. Fate-only = thread sketch; world-only = entity study; system-only = rulebook. Let the three argue with each other.</requirement>
  <requirement index="5" name="sequential-indexing">\`index\` = causal topological order: 0 is root, predecessors have lower indices, terminal at highest. Walking ascending should feel coherent, not subgraph jumps. \`order\` (auto-captured from array position) may differ from \`index\` in backward modes. Emit \`plannedNodeCount\` before the nodes array.</requirement>
  <requirement index="6" name="id-references">Character/location/artifact nodes MUST use entityId from AVAILABLE ENTITIES. Fate nodes MUST use threadId from Active Threads. System nodes MUST use systemNodeId from System Knowledge (copy [SYS-XX] verbatim) — only omit when introducing a genuinely new rule. Hallucinated IDs are stripped at parse time. Reuse beats invention.</requirement>
  <requirement index="7" name="single-entity-node-per-entity">Same character/system mattering in multiple places = ONE node with multiple edges. Don't duplicate.</requirement>
  <requirement index="8" name="node-count">Let the situation size the graph. A focused direction may want 6-10 nodes; a sprawling free-form investigation may want 15-25. Target ${nodeCountMin}-${nodeCountMax} as a soft range — go higher when the position genuinely supports more complexity, go lower when the chain reads cleaner short.</requirement>
  <requirement index="9" name="creative-agent-counts">Pattern / warning / chaos nodes are optional — include them only when they meaningfully shape the chain. Pattern node = a fresh structural shape worth naming; warning = a specific repetition risk; chaos = an outside-force seed. Skip rather than pad.</requirement>
  <requirement index="10" name="non-deterministic">Each reasoning path contains at least one SURPRISE — something that doesn't follow obviously from the context. The point of the graph is to enrich the user's thinking, not confirm what they already know.</requirement>
  <requirement index="11" name="reasoning-node-details" critical="true">Every reasoning node's \`detail\` carries its OWN causal logic — 1-3 sentences explaining WHY this inference follows given its predecessors and WHAT it makes possible for its successors. Walking the chain by ascending \`index\` should read as a continuous argument the user can follow step by step. A graph whose details all read as graph-position attributions ("backward from the terminal", "step in the chain") has labelled the diagram instead of doing the reasoning.</requirement>
  <requirement index="12" name="inference-shape-on-inference-tier" critical="true">Every INFERENCE-TIER node (reasoning, pattern, warning, chaos, conclusion) carries the full <inference-node-shape> above: \`detail\` + \`considered\` + \`breaks\` + \`opens\`. Inference-tier nodes that emit only \`detail\` are description, not reasoning — the other three fields are what lifts the graph above default chain-of-thought into a thinking aid the user can re-evaluate at each step. Priors (character, location, artifact, system, fate) do NOT carry this shape — they're substrate, not selections over it. Skipping a field on an inference node only when nothing genuinely fits (e.g. \`considered\` on a node with no real alternatives, \`opens\` on a terminal node that closes rather than opens); silent omission across the graph means the discipline is being skipped, not honoured.</requirement>
  <requirement index="13" name="no-subject-or-pattern-repetition">Same actor + action + target = one node with more edges. Same SHAPE rephrased ("X exploits chaos to acquire Y" iterated for three Y's) = one pattern rehearsed. Each reasoning node brings a different mode of inference — deduction, abduction, analogy, inversion, constraint propagation.</requirement>
</requirements>

<shape-of-good-investigation-graph>
  A thinking aid. The user reads the chain and learns something they didn't see on entry — a tension, a constraint, a path, a hidden coupling. The terminal is the payoff (a conclusion when direction asked a question, or the resolution of the free-form investigation otherwise). Key entities connect to several reasoning nodes; rules constrain multiple choices; the chain converges from several roots rather than running as a single vertical line. The summary names what is being investigated in one sentence so the user can decide whether to follow it through.
</shape-of-good-investigation-graph>

<output-format>
Return a JSON object.

<format-requirements>
  <ids>SEMANTIC slugs prefixed by type: \`<type>-<kebab-case-subject>\`. 3-6 words, lowercase, hyphenated. Examples: \`fate-position-secured\`, \`reason-witness-exposure\`, \`char-actor-knows-weakness\`, \`sys-hierarchy-forbids\`, \`chaos-outsider-seeks-entry\`. Edges become self-describing. Do NOT use opaque codes like F1, R2.</ids>
  <labels>PROPER ENGLISH (3-10 words), natural language. GOOD: "Actor exploits prior knowledge of the constraint". BAD: "Thread escalation node", "R2_REQUIRES_C1".</labels>
</format-requirements>

<orderings hint="Two distinct concepts.">
  <ordering name="order">Thinking order — auto-captured from JSON array position. In backward modes the terminal is emitted first, so it lands at \`order: 0\`.</ordering>
  <ordering name="index">Presentation / causal topological order. Roots low, terminal highest. Downstream consumers walk by \`index\`.</ordering>
  <note>Forward modes align; backward modes diverge — the example below (abduction) has terminal at \`order: 0-2\` but \`index: 4-6\`.</note>
</orderings>

<example>
{
  "summary": "1-2 sentence summary of the arc's reasoning",
  "plannedNodeCount": 7,  // commit first; terminal's index = N-1
  "nodes": [
    // Backward mode: terminal first (order 0-2 at index 4-6).
    // order: 0 · index: 4 — fate node the reasoning LANDS (not mandated).
    {"id": "fate-position-secured", "index": 4, "type": "fate", "label": "Coalition secures the contested position through shared cause", "detail": "T-1 leaned 'secured' (p=0.78); reasoning delivers it. Closure plausible given volume and scene count.", "threadId": "T-1"},
    // order: 1 · index: 5 — cost that falls out of the path taken. Inference-tier node carries the full shape: detail + considered + breaks + opens.
    {"id": "reason-observer-exposure", "index": 5, "type": "reasoning", "label": "Negotiation exposes the principal actor to a hostile observer", "detail": "Securing the coalition's terms requires the principal to demonstrate the faction's structural weakness in front of the counterpart's council. The act of demonstrating is the act of disclosing — there is no version of this negotiation where the observer doesn't see what the principal knows. Once seen, the knowledge cannot be denied or pretended away in later sections.", "considered": "Could have routed via private envoy (rejected: counterpart's protocol explicitly forbids private negotiation on standing-affecting matters, per SYS-12). Could have routed via the principal's senior — rejected because the senior's prior commitment to a rival faction makes them a hostile carrier of the same disclosure.", "breaks": "Breaks if the principal can mount a partial disclosure that satisfies the counterpart's evidence threshold without naming the weakness — only viable if the latent artifact's properties surface first, which the timeline can't guarantee.", "opens": "Opens a new thread (will the observer speak) priced at uniform prior; opens an obligation arc (counterpart now owes a reciprocal disclosure under their own protocol); opens a leverage market between observer and principal that subsequent arcs can re-price."},
    // order: 2 · index: 6 — new thread emerges from the cost.
    {"id": "fate-observer-leverage", "index": 6, "type": "fate", "label": "Observer now holds leverage over the principal", "detail": "Observer exposure seeds a new uncertainty: will the observer speak. New market opens at uniform prior; later arcs re-price.", "threadId": "T-NEW"},
    // order: 3 · index: 3 — the causal step.
    {"id": "reason-position-needs-coalition", "index": 3, "type": "reasoning", "label": "Securing the position requires coalition with a counterpart faction", "detail": "The principal's faction lacks the resources to hold the position alone (per the rule constraining their standing). The counterpart faction has those resources but won't share without a meaningful concession. The principal's privately held knowledge of their weakness is the only currency that satisfies both sides — making coalition through disclosure the necessary path. Hands off to: the negotiation that must happen, and the observer it inevitably exposes."},
    // Roots (thought of last in backward mode).
    // order: 4 · index: 0 — who.
    {"id": "char-actor-knows-weakness", "index": 0, "type": "character", "label": "Principal actor knows the faction's structural weakness", "entityId": "actual-character-id-from-narrative"},
    // order: 5 · index: 1 — rule.
    {"id": "sys-hierarchy-forbids-direct", "index": 1, "type": "system", "label": "Standing hierarchy forbids direct negotiation", "systemNodeId": "actual-SYS-id-from-narrative"},
    // order: 6 · index: 2 — outside force; spawned via world expansion (no entityId).
    {"id": "chaos-outsider-seeks-entry", "index": 2, "type": "chaos", "label": "An outsider from a counterpart faction arrives seeking entry"}
  ],
  "edges": [
    // \`requires\`: to-node has LOWER index (prerequisite). \`causes\`/\`enables\`/\`constrains\`: from-node has LOWER index.
    {"id": "e1", "from": "fate-position-secured", "to": "reason-position-needs-coalition", "type": "requires"},
    {"id": "e2", "from": "reason-position-needs-coalition", "to": "char-actor-knows-weakness", "type": "requires"},
    {"id": "e3", "from": "sys-hierarchy-forbids-direct", "to": "char-actor-knows-weakness", "type": "constrains"},
    {"id": "e4", "from": "chaos-outsider-seeks-entry", "to": "reason-position-needs-coalition", "type": "enables"},
    {"id": "e5", "from": "reason-position-needs-coalition", "to": "reason-observer-exposure", "type": "causes"},
    {"id": "e6", "from": "reason-observer-exposure", "to": "fate-observer-leverage", "type": "causes"}
  ]
}
</example>

<example hint="Question-shaped direction — terminal is a CONCLUSION node. Direction was an actionable question, so the graph MUST yield a concrete named answer at the highest index. Pattern adapts to ANY domain — investment ('what to buy'), wargame ('which course of action'), forecasting ('when does X collapse'), narrative ('which faction wins the succession'), research ('what does the data support').">
{
  "summary": "Investigating which exposures the current regime favours beyond the user's existing gold position.",
  "plannedNodeCount": 5,
  "nodes": [
    // Backward mode: conclusion first.
    // order: 0 · index: 4 — the load-bearing answer. Concrete, named, actionable.
    {
      "id": "conclusion-pair-energy-payment-rails",
      "index": 4,
      "type": "conclusion",
      "label": "Long energy-infrastructure + BRICS+ payment-rail basket; underweight USD duration",
      "detail": "Add (1) midstream/transport energy infrastructure with cashflow profiles indexed to a stable $70-95 Brent band — XOM/EPD/KMI-shape exposures — over upstream majors whose torque to price volatility we expect compressed; (2) a BRICS+ cross-border payment-infrastructure basket — CIPS-adjacent fintech, mBridge participants, settlement-layer providers — sized 5-8% of new capital; and (3) underweight USD duration via shorter-dated TIPS plus a small EM-local-currency sleeve. Gold position stays — it's the regime hedge these exposures complement, not duplicate.",
      "considered": "Long upstream oil majors (rejected: torque to Brent volatility we explicitly expect compressed under managed Iran ceasefire). Long EM sovereign hard-currency debt (rejected: USD-denominated, doesn't express the de-dollarisation thesis). Long China A-shares for managed-stability beta (rejected: stability is a floor not a tailwind; capital controls cap upside).",
      "breaks": "Whole answer breaks if (a) Brent breaks above $130 from Hormuz closure — energy-infra cashflows decouple from price band; (b) a confirmed Trump-Xi meeting cancellation breaks the de-escalation cadence, forcing the equity tail risk back open; (c) a BRICS+ payment rail experiences a credibility-shaking liquidity failure.",
      "opens": "Opens a pair-trade lattice (energy-infra vs gold, EM-local vs DXY) the user can re-balance as the cohort re-prices. Opens a watchlist of de-escalation-cadence trip-wires (next four Trump-Xi meetings)."
    },
    // order: 1 · index: 3 — supporting reasoning step.
    {
      "id": "reason-stable-brent-favors-infra",
      "index": 3,
      "type": "reasoning",
      "label": "Stable Brent band favours infrastructure over extraction",
      "detail": "If Iran ceasefire holds and China leverage caps Brent volatility, midstream/transport infrastructure earns the higher risk-adjusted return because its cashflows index to volumes through a stable price band, not to absolute price spikes. Upstream extractors lose their volatility option.",
      "considered": "Could route through integrated majors that capture both extraction and infrastructure — rejected because the integration discount under stable bands is larger than the diversification benefit at this position size.",
      "breaks": "Breaks if Brent volatility returns (Hormuz closure, OPEC+ discipline failure).",
      "opens": "Opens a pair trade: long infra, short upstream majors as a volatility-compression expression."
    },
    // Roots.
    // order: 2 · index: 0 — fate substrate (existing thread the conclusion couples to).
    {"id": "fate-iran-ceasefire-holds", "index": 0, "type": "fate", "label": "Iran ceasefire holding caps oil volatility", "threadId": "T-USP-03"},
    // order: 3 · index: 1 — system substrate.
    {"id": "sys-china-leverage-iran", "index": 1, "type": "system", "label": "China's trade leverage over Iran enforces ceasefire", "systemNodeId": "SYS-27"},
    // order: 4 · index: 2 — system substrate.
    {"id": "sys-brics-rails-mature", "index": 2, "type": "system", "label": "BRICS+ payment rails reaching usable depth", "systemNodeId": "SYS-DED-16"}
  ],
  "edges": [
    {"id": "e1", "from": "conclusion-pair-energy-payment-rails", "to": "reason-stable-brent-favors-infra", "type": "requires"},
    {"id": "e2", "from": "conclusion-pair-energy-payment-rails", "to": "sys-brics-rails-mature", "type": "requires"},
    {"id": "e3", "from": "reason-stable-brent-favors-infra", "to": "fate-iran-ceasefire-holds", "type": "requires"},
    {"id": "e4", "from": "sys-china-leverage-iran", "to": "fate-iran-ceasefire-holds", "type": "enables"}
  ]
}
</example>
</output-format>

<final-instruction>Return ONLY the JSON object.</final-instruction>`;
}
