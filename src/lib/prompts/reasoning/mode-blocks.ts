/**
 * Reasoning-mode prompt blocks — one block per mode, selected at prompt-
 * assembly time by `reasoningModeBlock(mode)`.
 *
 * 2×2 positions:
 *   - DIVERGENT   (forward + expansive)   ↔ ABDUCTION (backward + selective)
 *   - DEDUCTION   (forward + narrow)      ↔ INDUCTION (backward + generalising)
 *
 * Drift neighbor graph (empirical failure modes — backward modes silently
 * flip forward once scaffolding exists; narrow modes quietly expand once
 * "necessary" loosens):
 *   - ABDUCTION  → drifts into DEDUCTION  (forward-from-last-prior)
 *   - INDUCTION  → drifts into DEDUCTION  (forward-from-sketched-principle)
 *   - DIVERGENT  → drifts into ABDUCTION  (commits to first coherent branch)
 *   - DEDUCTION  → drifts into DIVERGENT  ("necessary" turns one-of-several)
 */

import type { ThinkingStyle } from "@/lib/ai/reasoning-graph/types";

/** Shared 2×2 grid — referenced by every mode block. */
const FULL_2X2 = `<full-2x2>
    <mode name="divergent">forward + expansive: one → many possibilities</mode>
    <mode name="deduction">forward + narrow: premise → necessary consequence</mode>
    <mode name="abduction">backward + selective: committed outcome ← best hypothesis</mode>
    <mode name="induction">backward + generalising: shared pattern ← many observations</mode>
  </full-2x2>`;

/**
 * Divergent mode — "what else could be true from here?" Branches outward,
 * expanding the solution space. Risk: never terminates without external selection.
 */
const DIVERGENT_MODE_BLOCK = `<reasoning-mode name="divergent" position="forward+expansive" archetype="branching, solution-space expansion">
  <position>FORWARD + EXPANSIVE — one source branches into many possibilities. Shape: a tree fanning outward, 1 → N → N².</position>
  <taxonomic-opposite mode="abduction">Divergent generates alternatives forward; abduction picks among them backward from a committed outcome.</taxonomic-opposite>
  <drift-neighbor mode="abduction">Collapses when the first coherent branch becomes attractive and you start selecting rather than generating. Tell: comparing branches before finishing the set. Counter: complete the planned set BEFORE scoring any branch.</drift-neighbor>
  ${FULL_2X2}

  <core-question>What else could be true from here? Branch outward without committing — EXPAND the solution space, don't pick a winner.</core-question>

  <branch-set-quality-check hint="Apply once over the SET, not each branch.">
    <axis index="1" name="qualitative-distinctness">Branches differing only in surface vocabulary are one branch. Collapse or replace.</axis>
    <axis index="2" name="force-space-spread">Branches must distribute across forces (System/World/Fate). >70% one dominant force = regenerate the underweight forces.</axis>
    <axis index="3" name="pairwise-compatibility">Note for each pair: mutually exclusive or compatible. All-exclusive is a fork; all-compatible is one future with accessories. Healthy sets have both.</axis>
    <axis index="4" name="retroactive-regret">If the true outcome were revealed, would you regret NOT generating any branch? If the obvious set is complete but the tail is missing, add at least one low-probability branch.</axis>
  </branch-set-quality-check>

  <termination-criterion>Stop when all four checks pass — NOT at a node count. Failed check → regenerate the offending branches.</termination-criterion>

  <arrow-composition hint="Dominant, not exclusive.">
    <primary edges="causes, enables, reveals, develops">Forward arrows at HIGH branching. A single source often carries 2–4 outgoing forward arrows into distinct possibilities. Tree, not chain.</primary>
    <secondary edges="requires, constrains">Sparingly; only when a branch surfaces a prerequisite.</secondary>
    <situational edges="risks, resolves">As branches call for.</situational>
  </arrow-composition>

  <node-order alignment="aligned">
    <plan-first>Emit plannedNodeCount BEFORE the nodes array. Scopes the branching up front.</plan-first>
    <generation>Start at the present state, branch outward to consequences.</generation>
    <presentation>Index 0 is the source. Later indices are consequences flowing outward. \`order\` matches \`index\` — visible signature of forward-aligned divergent thinking.</presentation>
  </node-order>

  <mindset>
    <rule>Prefer producing branches over elaborating one chain deeply.</rule>
    <rule>Contradictory branches are welcome — two incompatible consequences from the same premise widen the space.</rule>
    <rule>Scoring branches before all are written = drift to abduction. Committing to a single through-line = drift to deduction. Back off and branch.</rule>
  </mindset>

  <summary>The graph is an EXPANSION, not a solution — many possible futures hanging off the current state, the arc free to select later.</summary>
</reasoning-mode>`;

/**
 * Abduction mode — "what prior configuration best explains this outcome?"
 * Reasons backward from a committed terminal to specific prior setup.
 * Risk: post-hoc rationalisation; silently flips forward mid-chain.
 */
const ABDUCTION_MODE_BLOCK = `<reasoning-mode name="abduction" position="backward+selective" archetype="inference to best explanation">
  <position>BACKWARD + SELECTIVE — a committed outcome is explained by picking the best among competing prior configurations. Shape: hypothesis chains converging on a terminal, ONE selected, others rejected.</position>
  <taxonomic-opposite mode="divergent">Divergent generates many forward without committing; abduction picks one backward from a committed outcome. A single hypothesis is not abduction — REQUIRES competitors scored against each other.</taxonomic-opposite>
  <drift-neighbor mode="deduction">Real risk: abduction silently flips to forward derivation once the first prior is committed. ANCHOR DISCIPLINE below is the countermeasure — most important part of this block.</drift-neighbor>
  ${FULL_2X2}

  <core-question>What prior configuration best explains this outcome? Reason BACKWARD from terminal states (fate nodes) to priors. You generate EXPLANATIONS for fates already TRUE — not forward simulations.</core-question>

  <anchor-discipline critical="true" hint="READ FIRST — abductive chains drift deductive mid-chain without this.">
    <reference-point>At every new node, the reference is the FATE TERMINAL — not the previously generated node. Ask "WHAT EXPLAINS THE FATE?" not "what follows from the last node?"</reference-point>
    <failure-mode>You correctly generate N-1 by reasoning back from terminal, then generate N-2 by reasoning FORWARD from N-1. Chain starts abductive, silently converts to deductive.</failure-mode>
    <self-check>Each new node: does it still directly explain the TERMINAL FATE, or has it become a consequence of the last prior? If the latter, discard and reanchor.</self-check>
  </anchor-discipline>

  <secondary-failure-mode>Post-hoc rationalisation. Guard: generate 2–3 COMPETING hypotheses per fate node and score them before selecting. An explanation that doesn't survive comparison is not an explanation.</secondary-failure-mode>

  <abductive-procedure>
    <step index="1" name="treat-fate-committed">Don't question whether it occurs. It will. Only question: what makes it feel inevitable.</step>
    <step index="2" name="generate-competing-hypotheses">Generate 2–3 hypotheses (H1, H2, H3) — each a candidate reasoning node or chain explaining the fate.</step>
    <step index="3" name="score-each" axes="coherence, sufficiency, minimality, retroactive-inevitability">Coherence (no contradictions). Sufficiency (fully accounts for the fate). Minimality (fewest new nodes). Retroactive-inevitability (would the audience feel it was engineered rather than accidental?).</step>
    <step index="4" name="select">Highest-scoring hypothesis; record WHY others were rejected (cite specific axis failures).</step>
    <step index="5" name="anomalies-first">Chaos and warning nodes are highest-priority evidence. Hypotheses failing to explain them are incomplete.</step>
    <step index="6" name="check-information-asymmetry">Tag each node VISIBLE (observable by any participant or audience) or HIDDEN (only via specific knowledge, foreknowledge, or withheld evidence). A valid chain has at least one HIDDEN — all-visible eliminates the work's tension.</step>
  </abductive-procedure>

  <retroactive-inevitability-test>Could this setup have been deliberately arranged by someone who already knew the outcome? Yes → valid. No → revise; it's accidental, not inevitable. Engineered inevitability is the target — coherence + sufficiency + minimality are necessary; failing this produces narrative that feels lucky rather than fated.</retroactive-inevitability-test>

  <arrow-composition hint="Dominant, not exclusive.">
    <primary edges="requires, develops, causes">Backward arrows. \`requires\` = "fate depends on this prior"; \`develops\` = "this matured into the fate"; \`causes\` = "this prior produced the fate".</primary>
    <avoid edges="enables">Avoid as terminal edge into a fate — implies optionality; abductive conclusions are not optional.</avoid>
    <secondary edges="constrains, reveals">Where the hypothesis genuinely leans on a rule or info disclosure.</secondary>
    <situational edges="risks, resolves">As the chain calls.</situational>
  </arrow-composition>

  <node-order alignment="diverged" hint="Generation and presentation DIVERGE.">
    <plan-first>Emit plannedNodeCount BEFORE the nodes array — TERMINAL fate gets index N-1 while generated first.</plan-first>
    <generation>Terminal first, then priors in discovery order (auto-captured as \`order\`).</generation>
    <presentation hint="\`index\` field — topological order over edges.">
      <step>\`A requires B\` → B is prior. \`A causes B\` → A is prior. \`S constrains E\` → S is prior.</step>
      <step>Index 0 to a node with NO causal predecessors. Each subsequent index: predecessors already lower. Terminal fate = N-1.</step>
      <step>Causally-parallel nodes ordered by which naturally introduces its shared downstream first.</step>
    </presentation>
    <signature>Generation backward (terminal first); presentation forward (terminal last). \`order\` shows the investigator's path; \`index\` shows the chronology presented.</signature>
    <example>4-node chain emitted [fate, prior-A, prior-B, prior-C] with edges \`fate requires prior-A\`, \`prior-A requires prior-B\`, \`prior-A requires prior-C\` → indices [fate=3, A=2, B=0, C=1].</example>
  </node-order>

  <mindset>
    <rule>Fate is input, not output — you explain it.</rule>
    <rule>Two fate nodes sharing an explanation share a single reasoning node with edges to both — don't duplicate.</rule>
    <rule>If a chain needs many new elements, it's failing minimality — revise, don't pad.</rule>
  </mindset>

  <summary>The graph is an INVESTIGATIVE RECONSTRUCTION — fate nodes with backward chains to specific prior configurations, each chain chosen over competitors.</summary>
</reasoning-mode>`;

/**
 * Induction mode — "what general pattern explains these observations?"
 * Reasons backward from multiple observed states to the shared principle.
 * Risk: locks onto the first coherent pattern and stops exploring.
 */
const INDUCTION_MODE_BLOCK = `<reasoning-mode name="induction" position="backward+generalising" archetype="pattern across observations">
  <position>BACKWARD + GENERALISING — many observations converge on a shared principle. Shape: a watershed — leaves at the bottom feeding one root at the top.</position>
  <taxonomic-opposite mode="deduction">Deduction derives consequences forward from a rule; induction infers the rule backward from many cases. A single observation is not induction — REQUIRES multiple cases sharing a pattern.</taxonomic-opposite>
  <drift-neighbor mode="deduction" hint="Opposite and drift coincide here — especially treacherous.">Once a principle is sketched, further "principle" nodes become forward derivations from the first rather than inductions from fresh evidence.</drift-neighbor>
  ${FULL_2X2}

  <core-question>What general pattern explains these observations? Reason backward from MULTIPLE observed states (scenes, arcs, behaviours, events) to the SHARED principle. Abduction explains one outcome with a specific prior; induction explains several with a general rule.</core-question>

  <anchor-discipline critical="true" hint="READ FIRST — inductive chains drift deductive once a principle is sketched.">
    Reference point at each new node is the OBSERVATION CLUSTER, not the last principle. Ask "DOES THIS ACCOUNT FOR THE OBSERVATIONS?" — NOT "what follows from the principle?" Failure mode: you correctly sketch a principle fitting first observations, then derive new principle nodes as logical consequences of the first — generalising stops, theoretical extension begins. Every principle node earns its place by explaining observations, not by extending another principle.
  </anchor-discipline>

  <observation-set-validation hint="Apply BEFORE sketching any principle.">
    <axis index="1" name="evidence-diversity">Observations must be STRUCTURALLY disparate (different actors, locations, stakes, mechanisms). Three near-identical cases = one pattern in three forms, not three independent witnesses. Variance across at least one non-trivial axis per pair.</axis>
    <axis index="2" name="break-case-probe">Before committing: what observation would FALSIFY this principle? If none conceivable, principle is tautology or too loose. If conceivable, scan the corpus — counterexample-present-but-unsearched invalidates the induction.</axis>
    <axis index="3" name="pattern-alternative-retention">Hold at least ONE competing generalisation as a secondary node. Same evidence often supports multiple patterns; collapsing to first-fit is the signature induction bug. Secondary must be genuinely competitive, not strawman.</axis>
    <gate>Only after all three pass do you draw the principle edges.</gate>
  </observation-set-validation>

  <secondary-failure-mode>Locks onto the first coherent pattern. If you land one in the first few nodes, try to break it — what observation doesn't this account for?</secondary-failure-mode>

  <arrow-composition hint="Dominant, not exclusive.">
    <primary edges="requires, constrains">Backward arrows. \`A requires B\` = "observed A is explained by prior pattern B". \`constrains\` points from the rule back onto specific instances that obey it.</primary>
    <secondary edges="reveals, develops">Where the pattern has downstream implications worth naming.</secondary>
    <situational edges="causes, enables, risks, resolves">As the pattern calls.</situational>
  </arrow-composition>

  <node-order alignment="diverged" hint="Generation and presentation DIVERGE.">
    Emit plannedNodeCount BEFORE the nodes array — places the inferred principle at index 0 while emitted last.
    Generation: observations first, principle last — scientist's assembly (auto-captured as \`order\`).
    Presentation (\`index\`): topological — principle is causally prior to observations. Index 0 to the root principle. Subsequent indices: predecessors lower. Multiple principles: root-first (most-general lowest), sub-patterns after, observations last. Never scatter a principle between its cases.
    Signature: generation runs up from observations; presentation runs down from the principle.
    Example: 3 observations generalised into 1 principle — emit [obs-A, obs-B, obs-C, principle] with edges \`obs-X requires principle\`. Presentation: principle=0, obs at 1/2/3 in cascade order.
  </node-order>

  <mindset>
    Observations are evidence, plural — a single observation is abduction. Goal is a PATTERN that generalises; a principle explaining one observation isn't inductive. Multiple plausible patterns: keep both as competitors rather than collapsing.
  </mindset>

  <summary>The graph is a GENERALISATION — many observed states at the leaves converging on principle nodes that explain them all.</summary>
</reasoning-mode>`;

/**
 * Deduction mode — "if this premise is true, what must follow?" Forward
 * simulation with logical necessity. Risk: a plausible-looking chain from
 * a bad premise produces confident garbage.
 */
const DEDUCTION_MODE_BLOCK = `<reasoning-mode name="deduction" position="forward+narrow" archetype="premise → necessary consequence">
  <position>FORWARD + NARROW — a premise generates necessary consequences in a tight linear chain. Shape: 1 → 1 → 1 → 1, low branching, a derivation.</position>
  <taxonomic-opposite mode="induction">Induction infers a rule backward from cases; deduction derives consequences forward from a rule.</taxonomic-opposite>
  <drift-neighbor mode="divergent">Collapses when a "necessary" consequence is actually one of several alternatives and the chain branches. Tell: "and therefore X" when the premise admits X, Y, or Z. High branching = divergent, not deductive. Stop and either revise the premise to be genuinely narrow, or admit the mode switch.</drift-neighbor>
  ${FULL_2X2}

  <core-question>If this premise is true, what must follow? Each forward arrow represents a NECESSARY step.</core-question>

  <register-fit hint="Deduction is the DEFAULT thinking mode for simulation register — works that model real-life events from a stated rule set under given initial conditions. Premise → necessary consequence under the rules is precisely what a wargame, counterfactual, policy-model, pandemic / climate scenario, or agent-based study runs on. Fiction and non-fiction reach for deduction selectively; simulation reaches for it as the engine itself.</register-fit>

  <premise-validation critical="true" hint="READ FIRST — a plausible chain from a bad premise produces confident garbage. Apply BEFORE deriving any consequence.">
    <axis index="1" name="groundedness">Premise anchored in an existing world/system/continuity node (committed thread, stated goal, accepted rule)? Or asserted freshly? Asserted premises fail — revise until the root cites a real node the narrative has already established.</axis>
    <axis index="2" name="specificity">Premise statable in ONE declarative sentence? If it needs clauses, lists, or "and also", it's several premises — split or narrow.</axis>
    <axis index="3" name="non-triviality">Premise generates AT LEAST THREE non-obvious consequences? Sketch them mentally first. Chain terminating after one step = self-executing premise; three obvious consequences = ornamental chain.</axis>
    <axis index="4" name="counterfactual-sensitivity">If the premise were slightly different (one word altered, one condition negated), would the chain look SUBSTANTIALLY different? If not, the chain is driven by smuggled background assumptions — rewrite so the premise is load-bearing, or name the smuggled assumption as a second root.</axis>
    <gate>Any axis fails, DO NOT BUILD THE CHAIN. False confidence is worse than no chain.</gate>
  </premise-validation>

  <secondary-failure-mode>Absurd conclusion = premise needs revision. Don't patch the consequence, revise upstream.</secondary-failure-mode>

  <arrow-composition hint="Dominant, not exclusive.">
    <primary edges="causes, enables, requires, resolves">Tight logical arrows. Each must feel necessary, not optional. \`requires\` still points consequence → premise (state depends on premise).</primary>
    <secondary edges="constrains, develops">When the chain hits a rule or deepens a consequence.</secondary>
    <situational edges="reveals, risks">As the derivation calls.</situational>
  </arrow-composition>

  <node-order alignment="aligned">
    Emit plannedNodeCount BEFORE the nodes array. Index 0 = premise; later indices = derived consequences; highest = final conclusion. \`order\` matches \`index\`.
  </node-order>

  <mindset>
    Premise is load-bearing and has passed the four axes — name it clearly at the root. Each node answers: "given the previous, what MUST be true next?" If the answer is one-of-several, you're in divergent mode. Logical necessity over narrative interest — flat-but-necessary stays. Any node with >1 outgoing causal arrow into a consequence = drift to divergent; collapse to the single necessary consequence or admit the mode switch.
  </mindset>

  <summary>The graph is a DERIVATION — top-to-bottom, each step locks into the next, arriving at a conclusion the premise made inevitable.</summary>
</reasoning-mode>`;

/** A short block that explicitly opts the LLM out of an imposed thinking
 *  shape. The graph is still typed and causal, but the chain's inference
 *  pattern is left to the model's own chain-of-thought. */
const FREEFORM_MODE_BLOCK = `<reasoning-mode name="freeform" position="unconstrained" archetype="model's own chain of thought">
  <intent>No imposed thinking pattern. Use whichever inference shape fits the direction best — backward selection, forward derivation, branching, generalisation, analogy, constraint propagation, or any mix. Pick the shape that makes the resulting graph most useful to the user as a thinking aid.</intent>
  <discipline>Even without an imposed mode, the graph itself stays causal and typed. Reasoning nodes still carry their own causal logic in detail; the three forces (fate, world, system) still interact; the terminal still earns its position. Freeform means the inference shape is yours to choose, not that the discipline is off.</discipline>
</reasoning-mode>`;

/** Dispatch the reasoning-mode block. Defaults to freeform (let the model
 *  choose its own chain-of-thought shape) when nothing is supplied. */
export function reasoningModeBlock(mode: ThinkingStyle | undefined): string {
  switch (mode) {
    case "induction":
      return INDUCTION_MODE_BLOCK;
    case "deduction":
      return DEDUCTION_MODE_BLOCK;
    case "divergent":
      return DIVERGENT_MODE_BLOCK;
    case "abduction":
      return ABDUCTION_MODE_BLOCK;
    case "freeform":
    default:
      return FREEFORM_MODE_BLOCK;
  }
}
