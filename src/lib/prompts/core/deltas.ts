/**
 * Delta Guidelines Prompt — XML block injected into user prompts that emit
 * structural deltas. Field shapes + emission discipline. Force formulas and
 * floors live in forces.ts; market discipline (evidence scale, logtype table,
 * principles, closure, abandonment) lives in market-calibration.ts and
 * thread-lifecycle.ts — this file doesn't restate them.
 */

import { FORCE_BANDS, fmtBand } from '@/lib/narrative-utils';

const W = FORCE_BANDS.world;
const S = FORCE_BANDS.system;

export const PROMPT_DELTAS = `<deltas hint="Inputs to force formulas. Earn from prose; never invent. Under-tagging is the dominant failure. Register-neutral: the same delta shapes carry fiction, non-fiction, and simulation. In simulation register, system deltas are higher-density and often DRIVE the world deltas the scene records (a propagation law fires → modelled state updates); thread deltas often log rule-state shifts (a parameter threshold crossed, a gate tripped, an objective met under the model's rules) rather than dramatic turns.">
  <node-content>15-25 words, PRESENT TENSE, specific and concrete.</node-content>

  <density-tiers hint="Above the per-scene floor in forces.ts.">
    <tier name="breather">0 transitions, ${fmtBand(W.quiet)} world, ${fmtBand(S.quiet)} system.</tier>
    <tier name="typical">0-1 transitions, ${fmtBand(W.typical)} world, ${fmtBand(S.typical)} system + edges.</tier>
    <tier name="climactic">1-2 transitions, ${fmtBand(W.climax, true)} world, ${fmtBand(S.climax)} system + edges.</tier>
    <tier name="theory-or-lore-dump">6-10 world, 6-12 system.</tier>
  </density-tiers>

  <initialization-floor>
    <rule>Every new character / location / artifact must have ≥1 node in its world.nodes at creation.</rule>
    <rule>Every new thread must declare ≥2 named outcomes and open with a threadDelta carrying evidence on at least one outcome (logType "setup").</rule>
  </initialization-floor>

  <thread-deltas hint="Field shapes and multi-outcome update patterns. Market-discipline blocks (principles, evidence scale, logtype, closure, abandonment) carry the rest.">
    <question-shape>
      A thread question carries an arc when it has stakes, uncertainty, and contested outcomes (binary or multi-outcome). Dramatic, evidentiary, argumentative, and rule-driven questions are all valid — outcomes are concrete states the work can adjudicate. Examples: "Can Ayesha clear her grandfather's name before the tribunal ends?" → ["yes", "no"]. "Which faction claims the southern province?" → ["Tahir house", "Konoe clan", "merchant guilds", "nobody"]. "Does the replication study confirm, refute, or partially support the original finding?" → ["confirms", "refutes", "partial"]. "Does the modelled epidemic cross the regional containment threshold before the policy intervention takes effect?" → ["contained", "breaches threshold", "delayed breach"]. Picaresque / ironic / open-inquiry forms may use a deliberately simple recurring question — register must earn it.
    </question-shape>

    <fields>
      <field name="updates[]">per-outcome { outcome: string, evidence: number in [-4, 4]; decimals encouraged (e.g. 1.5 or -0.8); rounded to 1dp }.</field>
      <field name="logType">one of { pulse, transition, setup, escalation, payoff, twist, callback, resistance, stall }.</field>
      <field name="volumeDelta">integer change to attention in [0, 2] (negative only when deliberately quieted).</field>
      <field name="rationale">ONE prose sentence grounded in the scene — what TRANSPIRED in natural language and what it implies for the question. In fiction / non-fiction this is what the audience witnesses on the page; in simulation it is what state the rule set forced under the current conditions. Don't quote outcome identifiers (technical names like "yes_with_great_cost"); don't reference logType or evidence numbers. Margin annotation, not database column.</field>
      <field name="addOutcomes[]" rare="true">names of NEW outcomes added mid-narrative when a scene genuinely opens a new possibility.</field>
    </fields>

    <outcome-expansion hint="Reserved for scenes that GENUINELY open new possibilities — a third contender, a new faction, a previously-unconsidered option.">
      New outcomes join at neutral prior (logit=0); same-scene evidence then shifts the new outcome. Most arcs open 0 outcomes; opening 1 once or twice total is normal; opening 2+ in one scene signals overloading. Example: "A third cousin's claim to the throne surfaces" → addOutcomes: ["cousin"]; updates: [{outcome:"cousin", evidence:2}]. NOT for "the apprentice now suspects the elder of the theft" — that's evidence on an existing outcome.
    </outcome-expansion>

    <multi-outcome-updates hint="When a market has 3+ outcomes, a single scene often moves several in different directions and magnitudes. Treat each outcome as a separate lever.">
      <pattern name="reveal-suppresses-rivals">A decisive reveal for one outcome usually SUPPRESSES its rivals. {Okonkwo, Nwoye, the colonial agent}: news of a hidden alliance with Okonkwo = updates: [{Okonkwo, +3}, {Nwoye, -1}, {the colonial agent, 0}]. Active rival gets squeezed; unrelated option barely moves.</pattern>
      <pattern name="lockstep-spectrum">Related outcomes on a spectrum can move LOCKSTEP at different magnitudes. {fails, partial, succeeds, triumphant}: central agent clears the test but reveals a weakness → [{partial, +2}, {succeeds, +1}, {triumphant, -1}, {fails, -1}].</pattern>
      <pattern name="absence-vs-evidence-against">Absence of evidence on an outcome is not evidence against it. If the scene doesn't touch an option, omit it from updates — pass-through preserves its relative standing when the rival moves.</pattern>
      <pattern name="zero-sum-discipline">Treat evidence as zero-sum within the market only when the scene genuinely forces a trade-off. Otherwise let shifts be independent; softmax renormalises.</pattern>
      <two-outcome-markets>Mirror evidence by default ({yes+2, no-1} for a clear but not decisive shift). One-sided nudges ({yes+1} alone) imply the rival is unchanged — legitimate for ambient reinforcement.</two-outcome-markets>
    </multi-outcome-updates>

    <density>2–6 threads per scene; focus-window threads first. Don't emit zero-evidence zero-volume entries.</density>
  </thread-deltas>

  <world-deltas hint="Entity's PRESENT-TENSE facts.">
    <by-entity-type>
      <type kind="characters">new behaviours, beliefs, capabilities, states, wounds, goals, secrets.</type>
      <type kind="locations">new history, properties, dangers, rules, atmospheric facts.</type>
      <type kind="artifacts">new capabilities, limitations, states demonstrated through use.</type>
    </by-entity-type>
    <example type="good">"Akira carries a hand-shaped burn mark from the night her household fell." / "The force grading formula is calibrated so published works score 85-92 on a 100-point curve." — present-tense facts, specific.</example>
    <example type="bad" reason="events belong in thread log">"Akira discovered..." / "The authors realised..."</example>
    <rule name="node-order">Order matters (auto-chains).</rule>

    <tag-richly hint="Entities are SPONGES: rich prose supports many nodes per entity; sparse prose supports few. No per-entity cap.">
      <density-guide>A reflective POV alone often carries 4-6 nodes — shifts in belief, state, goal, capability, position, method, uncertainty, secret, or commitment. A location or institution re-entered in a dense scene carries 2-3 new properties. A quiet pass-through carries one. Under-tagging a rich summary is the failure.</density-guide>
      <discipline name="agency-over-orbit">A node carrying agency ("the elder suspects the apprentice is hiding something", "the reviewer suspects the dataset is mis-sampled") beats one that only records orbit ("the elder is impressed", "the reviewer is impressed").</discipline>
      <discipline name="off-stage">Off-stage deltas are valid when news, rumour, faction intelligence, or cited-elsewhere finding would realistically reach them. Across an arc the entity set evolves alongside the POV, not waiting on it.</discipline>
      <discipline name="no-padding">Participants who were unchanged get nothing.</discipline>
    </tag-richly>
  </world-deltas>

  <system-deltas hint="How the WORLD / DOMAIN WORKS. Rules, principles, mechanisms, gates, propagation laws, causal couplings, constraints — not things, not events. In rule-driven works (simulation, modelled scenarios) these ARE the substrate of consequence; treat rule-mechanic content as legitimate and weighty system substance.">
    <example type="good">"Spirit-marks near uninitiated apprentices are attributed to them regardless of source." / "Cross-check protocols at the tribunal require concurrence from three department heads to ratify a hostile identification." / "Delivery is computed as the equal-weighted mean of z-score-normalised force values." / "Infection rate doubles whenever cross-region travel exceeds the dampening threshold." / "Reinforcements arrive on a six-turn delay once a province falls below 20% supply." / "A central bank that cuts rates while inflation expectations are unanchored loses credibility on a one-meeting lag." / "Cultivation tier gates require concurrent mastery of breath-circulation and meridian alignment." — general rules, not things or events.</example>
    <example type="bad" reason="too vague / specific not general / event not rule">"The art" / "Akira's plan" / "They met in the chamber"</example>
    <directive>NAME the implicit mechanic — a cross-check bypassed surfaces the cross-check structure; an artifact resonating surfaces its behaviour class; a deduction surfaces the pattern detected; a modelled threshold crossed surfaces the propagation law; a tier gate triggered surfaces the gate condition. Never emit \`systemDeltas: {}\`.</directive>
    <types>principle | system | concept | tension | constraint.</types>
    <edges>enables | governs | opposes | extends | constrains.</edges>
  </system-deltas>

  <relationship-deltas>SHIFTS only — emit when the scene's events actually move the pair, skip when they don't. valenceDelta: ±0.1 subtle drift, ±0.3 meaningful (named on-page trigger), ±0.5 dramatic (irreversible). Successive minute shifts are legitimate accumulation; the failure is reusing the same magnitude regardless of what the trigger does.</relationship-deltas>
  <events>2-4 word tags, 2-4 per scene.</events>
  <artifact-usages>When an artifact / tool delivers utility. Every usage has a wielder.</artifact-usages>
  <ownership-deltas>Artifact changes hands.</ownership-deltas>
  <character-movements>Physical location changes only.</character-movements>
</deltas>`;
