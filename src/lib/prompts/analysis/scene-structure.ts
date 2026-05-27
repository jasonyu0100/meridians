/**
 * Scene Structure Extraction Prompts
 *
 * The scene-level extraction step that converts raw prose + beat plan into
 * narrative structure (entities, deltas, threads, events). Two pieces:
 *   1. The JSON schema / return-shape instructions (top half).
 *   2. The EXTRACTION STANDARDS field guide (bottom half).
 * They are concatenated before being sent.
 */

import type { BeatPlan } from '@/types/narrative';
import { FORCE_REFERENCE_MEANS } from '@/lib/narrative-utils';
import { PROMPT_STANCE_PRINCIPLES } from '../core/belief-calibration';

export const SCENE_STRUCTURE_SYSTEM = `You are a world-view structure extractor. Given a scene's exact prose and its beat plan, extract all entities, deltas, and structural data accurately. The scene may carry narrative events, argued claims, chronicled changes, classified attributes, contest moves, or rule-driven state transitions — extract whichever the paradigm presents. Dense content deserves rich extraction; sparse content deserves minimal extraction. Return only valid JSON.`;

/**
 * Build the scene-structure user prompt from prose + optional beat plan.
 * The returned string contains the JSON schema, a newline, and the full
 * EXTRACTION STANDARDS field guide.
 */
export function buildSceneStructurePrompt(prose: string, plan: BeatPlan | null): string {
  const prompt = `<inputs>
  <scene-prose>
${prose}
  </scene-prose>${plan ? `\n  <beat-plan beats="${plan.beats.length}" hint="Use as a guide for where events happen.">\n${plan.beats.map((b, i) => `    <beat index="${i + 1}" fn="${b.fn}" mechanism="${b.mechanism}">${b.what}</beat>`).join('\n')}\n  </beat-plan>` : ''}
</inputs>

<instructions>
  <task>Extract narrative structure from the scene's prose.</task>

  <three-planes hint="Extract each independently.">

- WORLD (MATERIAL plane): tangible, embodied entities — characters, locations, artifacts. Includes people, places, objects, institutions, datasets, figures, charts, embedded documents — anything with its own continuity. Every new stable fact about an entity. This is a DENSITY lever — reach for the detail the source genuinely earns.
  W = ΔN_c + √ΔE_c. Ref: ~${FORCE_REFERENCE_MEANS.world}/scene.
- SYSTEM (ABSTRACT plane): rules, mechanisms, principles — how the world works, not the things themselves. Physical laws, social order, theorems, methods, constraints, modelled rule sets, gates, propagation laws, causal couplings. Rule and knowledge density — NOT incidental setting. Also a DENSITY lever — under-extraction is the dominant failure. In a simulation source — work that models real-life events from a stated rule set — the rule mechanics LIVE here: extract every gate, threshold, constraint, propagation law, and causal coupling the source declares. System carries the engine of consequence.
  S = ΔN + √ΔE. Ref: ~${FORCE_REFERENCE_MEANS.system}/scene.
- FATE (METAPHYSICAL plane): the higher-order pull that governs what material and abstract can't account for alone. Threads are PREDICTION MARKETS over named outcomes; a scene contributes fate by genuinely moving what a neutral observer would believe, weighted by the attention the scene paid to the thread. This is NOT a density lever — it is GENUINE CAREFUL MEASUREMENT. Price each thread's evidence by the concrete events in the scene; do NOT tune magnitudes to reach a target number. Fate is OUTPUT, not INPUT. There is no per-scene fate count to aim for — a quiet scene honestly emits pulses (|e|=0) and small evidence; a pivotal scene honestly emits committal evidence. Under-pricing a real payoff or over-pricing a routine scene both corrupt the trajectory. Reads naturally as a dramatic question, a claim in contention, an open inquiry, or a rule-driven question ("does the modelled system reach state X under conditions Y?") depending on the source's register; in simulation, payoffs are rule-forced state arrivals — the rules forcing closure under the given conditions, not authorial choice.

Return JSON:
{
  "povName": "POV — the viewpoint entity (a character in fiction; the authorial voice for essay / research / reportage; the observer or modelled agent whose vantage tracks events under the rule set in simulation works)",
  "locationName": "Where this scene takes place",
  "participantNames": ["All characters present"],
  "events": ["short_event_tags"],
  "summary": "Narrative summary using entity and location NAMES. Length is ADAPTIVE — 3-6 sentences for routine scenes; expand WITHOUT UPPER BOUND for cognition-dense scenes (multi-step planning, scheme construction, scenario modelling, complex world-rule reveals, sustained argument construction). For dense scenes, capture the ACTUAL computation — name each scenario weighed, each tradeoff accepted, each conclusion reached. Stand-in cognitive verbs ('considered the situation', 'planned carefully', 'refined the strategy') are failures: extract what the source text actually shows the reasoning entity working through. The summary is the only artifact downstream prose / plan / fate-reextract / search can read; if the cognition isn't here, it's lost.",
  "characters": [{"name": "Full Name", "role": "anchor|recurring|transient", "firstAppearance": false, "imagePrompt": "1-2 sentence LITERAL physical description: concrete traits like hair colour, build, clothing style. No metaphors or figurative language."}],
  "locations": [{"name": "Location Name", "prominence": "domain|place|margin", "parentName": "Parent or null", "description": "Brief description", "imagePrompt": "1-2 sentence LITERAL visual description: architecture, landscape, lighting, weather. Concrete physical details only, no metaphors.", "tiedCharacterNames": ["characters tied here"]}],
  "artifacts": [{"name": "Artifact Name", "significance": "key|notable|minor", "imagePrompt": "1-2 sentence LITERAL visual description — concrete physical details only, no metaphors or figurative language", "ownerName": "owner or null"}],
  "threads": [{"description": "A QUESTION with stakes, uncertainty, contested outcomes — 15-30 words. BAD: 'Will X succeed?' GOOD: 'Can Marcus protect his daughter from the cult that killed his wife?' / 'Does the proposed mechanism explain anomalies the prior model cannot?' / 'Does the modelled grid reach cascading failure under the declared load schedule?'", "participantNames": ["names"], "outcomes": ["named outcome 1", "named outcome 2", "..."], "horizon": "short | medium | long | epic — structural distance from any scene to this thread's resolution. short = 2-3 scenes (immediate question, local outcome). medium = within an arc, 4-8 scenes. long = multi-arc, segment-spanning. epic = work-spanning or open-ended (eternal life, dynastic ambition, civilisational trajectory, long-horizon equilibria). Drives evidence-magnitude attenuation in the fate-reextract pass.", "development": "15-25 words: how this question was advanced or answered in this scene"}],
  "relationships": [{"from": "Name", "to": "Name", "type": "short relation label — mentor, rival, ally, kin, debtor, peer, etc.", "valence": 0.0}],
  "threadDeltas": [{"threadDescription": "exact thread description", "logType": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "updates": [{"outcome": "outcome name from thread.outcomes", "evidence": 1.5}], "volumeDelta": 1, "addOutcomes": ["optional — new outcome names if the scene opens possibilities not previously in the stance"], "rationale": "15-25 words — the specific summary sentence that moved the stance this scene"}],
  "worldDeltas": [{"entityName": "Name", "addedNodes": [{"content": "15-25 words, PRESENT tense: a stable fact about the entity — their unique perspective on reality, identity, or condition. Emit as many 15-25-word nodes per entity as the scene genuinely reveals — no count cap.", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
  "relationshipDeltas": [{"from": "Name", "to": "Name", "type": "short relation label — mentor, rival, ally, kin, debtor, peer, etc.", "valenceDelta": 0.1}],
  "artifactUsages": [{"artifactName": "Name", "characterName": "who or null", "usage": "what the artifact did"}],
  "ownershipDeltas": [{"artifactName": "Name", "fromName": "prev", "toName": "new"}],
  "tieDeltas": [{"locationName": "Name", "characterName": "Name", "action": "add|remove"}],
  "timeDelta": {"value": 1, "unit": "hour", "transition": "an hour later"},
  "systemDeltas": {"addedNodes": [{"concept": "15-25 words, PRESENT tense: a general rule or structural fact — how the world works, no specific characters or events. Emit as many nodes as the scene genuinely reveals about how the world works — no count cap.", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"fromConcept": "name", "toConcept": "name", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]}
}`;

  const fieldGuide = `
<extraction-standards>
  <intent>Analysis filters an unlimited source — the prose in front of you. No quality floor, no count cap; count follows the information the text actually carries.</intent>
  <invariant name="match-the-source">Sparse prose → few nodes; dense prose → many. Applies entity-by-entity: rich entity reveals → many nodes; thin reveals → few. Don't under-extract to hit a target; don't pad to fill a slot.</invariant>
  <invariant name="format">15-25 words per node, present tense, distinct claims, one claim per node.</invariant>
  <invariant name="omit-empty-entries" critical="true">If nothing to add for a delta type, OMIT the entry — never emit a placeholder with missing fields. Every \`systemDeltas.addedNodes\` entry MUST have non-empty \`concept\`; every \`worldDeltas\` entry MUST have non-empty \`entityName\` and node \`content\`; every \`threads\` entry MUST have non-empty \`description\`. Malformed entries are dropped.</invariant>
</extraction-standards>

<detecting-fate>
  <definition>Fate is the HIGHER-ORDER force that compels world and system to bend toward narrative meaning — what pulls arcs toward resolution against or beyond the local logic of rules and character traits.</definition>
  <criterion>STAKES (what's at risk), UNCERTAINTY (outcome not obvious), INVESTMENT (we care).</criterion>
  <example category="weak">"Will [Name] succeed?" — too plain unless the form is picaresque/satirical.</example>
  <example category="strong">"Can Ayesha clear her grandfather's name before the tribunal ends?" / "Does the proposed mechanism explain anomalies the prior model cannot?" / "What role did diaspora networks play in the movement before digital coordination?" / "Does the modelled coalition fragment before the budget cycle closes under the declared payoff structure?"</example>
  <key-test>If a development is fully explained by traits, constraints, and rules — that's ordinary world/system activity, NOT fate. Fate earns weight when developments OUTRUN those explanations: a commitment kept at cost the prior profile wouldn't predict, a coincidence ratifying itself into pattern, a claim landing because the work's overall trajectory required it rather than because local causation forced it.</key-test>
  <selectivity>Routine lifecycle movement of minor threads (meetings arranged, letters delivered, small-stakes plans proceeding) does NOT earn fate weight. Reserve transitions and payoffs for arc-central threads. Forcing fate where it isn't present inflates the signal and dilutes the archetype read downstream.</selectivity>
</detecting-fate>

<thread-creation>
  <intent>Threads are EXPENSIVE — arc-spanning tensions the work promises to resolve. Err FEWER, BIGGER. A full-length work typically has 5-15; a shorter work or single segment 3-8. Extracting 10+ per scene means you're coding scene tensions as threads — collapse into worldDeltas instead.</intent>
  <gate>Candidate becomes a thread only if ALL three pass.</gate>
  <criterion id="multi-scene-span">Takes many scenes (ideally arcs) to answer; anything that resolves within a scene is scene-level tension, not a thread.</criterion>
  <criterion id="arc-central">Resolving it moves the work's larger trajectory, not day-to-day texture.</criterion>
  <criterion id="irreversible">Answering commits the work to a new state; recurring dynamics that reset every scene are local texture, not threads.</criterion>
  <fallback>Failed candidate → capture as worldDelta on the relevant entity, not as a thread.</fallback>
  <example category="bad" reason="recurring dynamic / trait verification / micro-question">"Will the rivals keep needling each other?" / "Can the manager keep up the self-image of a beloved boss?" / "Does the next paragraph add a fresh citation?"</example>
  <example category="good" reason="arc-central + multi-scene + irreversible">"Will the central pair's mutual attraction develop into a relationship despite an existing commitment?" / "Does the proposed architecture outperform prior baselines on long-range tasks?" / "Can the unipolar moment be sustained against multipolar economic gravity?" / "Does the modelled epidemic reach herd-threshold before mitigation policy lifts under the declared transmission parameters?"</example>
</thread-creation>

<threads-as-stances>
  <model>A thread is a named question the work has committed to, with NAMED OUTCOMES. The stance prices each outcome (via logits → softmax). The stance is the world view's current bearing on the question (via logits → softmax). Scenes emit evidence that shifts per-outcome logits; the audience's belief over "which outcome wins" evolves across the narrative.</model>

  <outcomes required="true">
    <range>2 to ~6 named possibilities covering the resolution space.</range>
    <default shape="binary">outcomes: ["yes", "no"] for yes/no questions.</default>
    <example shape="multi" question="Who claims the throne?">["Stark", "Lannister", "Targaryen", "nobody"]</example>
    <example shape="multi" question="How does Marcus die?">["by cult", "sacrificing for daughter", "escapes alive", "natural causes"]</example>
    <invariant>Outcomes must be DISTINCT and MUTUALLY EXCLUSIVE — they partition the resolution space.</invariant>
    <mece-tests>
      <test id="disjoint">No two outcomes can both be true.
        <bad>["instability persists", "new major conflict"] — they co-occur.</bad>
        <good>["no major conflict", "one", "multiple"]</good>
        <bad>["reasserts pre-eminence", "maintains influence at cost"] — second is a weaker form of first; pick one axis.</bad>
      </test>
      <test id="exhaustive">Covers every live future the question admits; add a residual outcome rather than forcing a fit.</test>
      <test id="neutral-labels">Outcomes name observable future-states, not slogans or framings. Never emit an outcome whose name encodes a position the source text rejected (e.g. "US reasserts pre-eminence" in a corpus arguing the unipolar moment is over).</test>
      <test id="specific-not-meta">
        <rule>Reject outcomes that describe THAT something happens rather than WHAT. Two failure shapes:
          (a) Trigger-word labels: "complex", "significant", "meaningful", "important", "notable", "has effect", "matters" without specific referent.
          (b) Category labels: "hidden X discovered", "true Y revealed", "secret Z exposed" — name a category, not which member resolves. The LLM reinterprets the category at close time, so closure carries no structural information. Specify the member as its own outcome.</rule>
        <bad>["reveals complex connection", "turns out to be unimportant"] — what IS the connection?</bad>
        <bad>["hidden talent discovered", "no hidden talent"] — which talent?</bad>
        <good>["they share an ancestor", "they trained under the same master", "they are rival agents of the same faction", "they have no connection"]</good>
        <good>["A-grade aperture confirmed", "C-grade confirmed, strategic cunning recognised", "C-grade confirmed and dismissed"] — concrete members of one category.</good>
        <fallback>If you can't enumerate concrete members, the question is under-specified — rephrase it.</fallback>
      </test>
    </mece-tests>
  </outcomes>

  <prior-probs encouraged="true">
    <shape>priorProbs: number[] aligned with outcomes[], in-world base rates a neutral observer would assign BEFORE any scene evidence. Must be positive and sum to ~1; the system renormalises and clamps to opening guardrails.</shape>
    <rule>Reason in-world: base rates for this kind of attempt in this world, the entity's visible starting position, common failure modes.</rule>
    <prohibition>Do NOT weight for narrative / genre / authorial expectations (a focal entity will not prevail "because it's a revenge tale" or "because the author is making this argument" — price as if you didn't know how the work resolves).</prohibition>
    <example>A 15-year-old apprentice at a hazardous initiation rite where most fail, four outcomes [succeeds fully, partial success, fails and is gravely injured, fails due to misuse] → priorProbs ≈ [0.10, 0.30, 0.40, 0.20]. NOT uniform, NOT success-weighted.</example>
    <rule>Binary defaults [0.5, 0.5] only when truly symmetric. "Will X survive the gauntlet?" in a lethal gauntlet is NOT 50/50.</rule>
    <fallback>If genuinely indistinguishable, omit the field and the system uses uniform.</fallback>
  </prior-probs>
</threads-as-stances>

<thread-deltas>
  <intent>Per-scene evidence that moves the stance.</intent>
  <field name="updates" shape="per-outcome { outcome: string, evidence: int in [-4, +4] }">
    <magnitude band="small">+1..+2 small shift</magnitude>
    <magnitude band="meaningful">+2..+3 meaningful</magnitude>
    <magnitude band="decisive">+3..+4 decisive (payoff/twist territory)</magnitude>
    <rule>Negative evidence = the outcome became less likely.</rule>
    <rule>Multiple outcomes can move in a single scene (a reveal lifting one and suppressing another).</rule>
    <evidence-discipline>
      <directive>Every threadDelta emission must trace to the stance principles below.</directive>
      <scope-note hint="This is a blind first-pass extraction; the chunk in front of you is all you see.">No live probability vector is available — Principle 4 (reprice-from-current-state) reduces to "price from concrete events in this chunk's prose, not from inferred trajectory." Principle 5 (saturation-resists-resolution) applies through the hedge-to-magnitude table below: closure-grade evidence (|e|≥3, logType payoff/twist) requires a named in-world transition in the prose, not assertion. The fate-reextract pass downstream re-prices each scene with full corpus knowledge.</scope-note>
      <stance-principles>
${PROMPT_STANCE_PRINCIPLES}
      </stance-principles>
      <lexical-calibration>
        <rule name="rhetoric-not-probability">Hedge words cap the magnitude; word-count does not inflate it.</rule>
        <table name="hedge-to-magnitude">
          <row hedge="mentions / notes X">|e| 0, volumeDelta 0-1</row>
          <row hedge="leans / tilts toward X">|e| ≈ 1, posterior ~55-60%</row>
          <row hedge="treats X as structural / load-bearing">|e| ≈ 1-2, posterior ~60-70%</row>
          <row hedge="commits / argues / proves / shows X">|e| ≈ 2-3, posterior ~70-85%</row>
          <row hedge="X is inevitable / decisive">|e| ≈ 3-4, closure</row>
        </table>
        <rule>A passage that asserts then walks back stays small-magnitude.</rule>
        <rule name="distributional-vs-modal">Rare-event rhetoric ("tail risk has grown", "base rates no longer apply") shifts the TAIL outcome 5-15% up from prior base rates, NOT past 50%. A rare-event stance at 5-10% becomes 15-25%, not 60-70%, on distributional claims. Only on-page events (detonation, declared test, announced succession) move the modal outcome — those come with |e| ≥ 3, logType payoff/twist. Rhetoric framing the tail as the headline lifts the tail; the modal stays modal.</rule>
        <rule name="text-volume-not-probability">Authors detail the interesting outcome, not the likeliest one. Price by hedges and events, not by word-share per outcome.</rule>
      </lexical-calibration>
    </evidence-discipline>
  </field>
  <field name="logType">
    <value name="pulse">0</value>
    <value name="setup">+1</value>
    <value name="escalation">+2..+3</value>
    <value name="payoff">+3..+4</value>
    <value name="twist">±3 reversal</value>
    <value name="resistance">−1..−2</value>
    <value name="callback">volume spike</value>
    <value name="stall">no movement expected</value>
    <value name="transition">volume > evidence</value>
  </field>
  <field name="volumeDelta">+0..+2 attention change (how much the scene spotlighted this thread).</field>
  <field name="addOutcomes" frequency="rare">New outcome names when a scene structurally opens a possibility not previously in the stance (a third contender arrives, an option no one had considered surfaces). Neutral prior (logit=0). Most scenes don't expand.</field>
  <field name="rationale">
    <shape>ONE prose sentence grounded in what happens in the scene. Natural language — describe the event in a marginal annotation voice that fits the source register. For simulation works where a payoff or twist fires because the established rule set forces it under the current conditions, cite the rule explicitly in the rationale (e.g. "the load on node 7 crosses 1.2× rated capacity for two consecutive ticks, tripping the cascade as the propagation rule dictates"); rule-driven closures should read distinguishably from authorially-asserted ones.</shape>
    <prohibition>DO NOT quote outcome identifiers (they're technical names).</prohibition>
    <prohibition>DO NOT mention evidence numbers or logType.</prohibition>
    <invariant>Two good rationales on the SAME delta should read like two descriptions of the same moment, not two schema dumps.</invariant>
  </field>
  <coverage>Touch every thread the scene engages. Threads the scene NAMES, observes, or invokes without shifting take a pulse (volumeDelta=+1, evidence=0..0.5) — pulses keep stances alive and let minute motion accumulate. Threads with no on-page connection get no entry. Err toward emitting when uncertain. No count cap.</coverage>
  <invariant>Evidence ≠ volume: does the scene change WHAT we believe (evidence) or ATTENTION on the thread (volumeDelta)?</invariant>
  <correlation>One event can legitimately move multiple threads; each rationale cites its driving sentence.</correlation>
</thread-deltas>

<world-deltas>
  <intent>What we LEARN about an entity that wasn't known before. Applies to characters, locations, and artifacts.</intent>
  <scope target="characters">New behaviour, belief, capability, or inner state revealed. Not restating what's already known.</scope>
  <scope target="locations">New history, rules, dangers, or properties revealed. A location revisited can still earn continuity if the scene reveals something new about it.</scope>
  <scope target="artifacts">New capabilities, limitations, or properties demonstrated through usage.</scope>
  <scope target="short-lived-artifacts" examples="tables, figures, equations, embedded letters/notes/documents">The worldDelta captures the CONTENTS revealed — the data shown, the claim plotted, the text quoted. This is the artifact's entire knowledge graph; it will rarely be extended by later scenes.</scope>
  <quality-bar>Each node describes something NOT KNOWN before this scene.</quality-bar>
  <example category="bad" hint="Observation about the entity is not a fact about the entity. Already-established facts are not new.">"Alice is curious" / "The White Rabbit has pink eyes."</example>
  <example category="good" hint="Each names a new fact about a specific entity-type — pick whichever the source's register supports.">
    Fiction (new-behaviour): "Alice abandons caution entirely, chasing the Rabbit without considering how to return." ·
    Fiction (new-location-property): "The forest conceals an ancient boundary ward that repels outsiders." ·
    Non-fiction (new-stance): "The investigator now treats the courier's testimony as compromised after the dock-time discrepancy surfaces." ·
    Analysis (artifact-content): "Table 2 reports a 2.3 BLEU drop on EN-DE when positional encoding is removed." ·
    Simulation (new-agent-state): "The Politburo commits to graduated retaliation under the declared escalation rules, ruling out unilateral withdrawal for two turns."
  </example>
  <coverage>Every entity the scene reveals something new about gets one 15-25-word node per distinct claim. No count cap per entity.</coverage>
  <coverage>Entities that appear without revealing anything new: ZERO nodes. Do NOT manufacture nodes to pad coverage — but DO extract every stable fact the scene actually shows.</coverage>
  <field name="addedEdges">Connect causally linked changes with "follows", "causes", "contradicts", "enables".</field>
  <field name="types">trait, state, history, capability, belief, relation, secret, goal, weakness</field>
</world-deltas>

<relationship-deltas>
  <intent>Only when a relationship SHIFTS, not just exists.</intent>
  <field name="valenceDelta">
    <magnitude band="subtle">±0.1 — passing reaction, mild update, drift on existing valence.</magnitude>
    <magnitude band="meaningful">±0.2-0.3 — concrete on-page event reframes how the parties stand toward each other (a confrontation, a betrayal admitted, a kindness that changes register).</magnitude>
    <magnitude band="dramatic">±0.4-0.5 — irreversible shift, oath broken or sworn, blood drawn, alliance crystallised or snapped.</magnitude>
  </field>
  <discipline name="match-the-trigger">Magnitude follows the on-page trigger. Successive minute shifts (±0.1, occasionally ±0.2) are legitimate when each scene contributes a real concrete event — a held look, a withheld word, a small concession. Failure mode: reusing the same magnitude regardless of what the trigger does.</discipline>
  <coverage>Emit one per genuine shift the scene shows — no count cap, no count floor.</coverage>
</relationship-deltas>

<system-deltas>
  <intent>REVEALED rules of how the world works, not entity observations. 15-25 words, PRESENT TENSE. Action / dialogue scenes may reveal none; exposition / world-building / mechanism-explaining / rule-stating scenes may reveal many. Match the source. In simulation works the rule mechanics are the substrate the work explores — extract every gate, threshold, propagation law, causal coupling, constraint, and modelled mechanism the source declares; under-extraction here loses the engine of consequence.</intent>
  <example category="good">"Practitioners cannot move directly between certain warded grounds; ancient enchantments block translocation across the boundary."</example>
  <example category="good">"The bearer of the cursed object is corrupted over time, amplifying desire for power."</example>
  <example category="good">"Self-attention computes weighted sums where each position attends to all positions in the sequence."</example>
  <example category="good" reason="rule-mechanic">"Once a node's load exceeds 1.2× rated capacity for two consecutive ticks, the node trips and shifts its load to neighbours."</example>
  <example category="good" reason="rule-mechanic">"Cultivators at the foundation tier cannot cross to the golden-core tier without a heavenly tribulation cleared by personal channelling, not external aid."</example>
  <example category="bad" reason="too vague / too short">"Magic" / "Transformer architecture" — name a label without describing what it DOES.</example>
  <field name="types">principle, system, concept, tension, event, structure, environment, convention, constraint</field>
  <field name="edges">enables, governs, opposes, extends, created_by, constrains, exist_within</field>
</system-deltas>

<entity-extraction>
  <invariant>Entities carry ONLY identity (name, role, significance). ALL world/lore MUST be emitted as scenes[].worldDeltas on the scene where it is revealed.</invariant>

  <entity-class id="characters">
    <definition>Conscious beings with AGENCY IN THE SCENE.</definition>
    <test>Does this person ACT, SPEAK, DECIDE, or THINK within the scene? If they are only NAMED (cited, referenced, listed, footnoted) without acting, they are NOT a character — skip entirely.</test>
    <example category="good" hint="Agency on the page is what matters; the surface form varies by register.">
      Named figures who act on the page: a fiction lead character; a memoir's narrator; a primary witness or historical figure depicted acting in reportage; researchers ONLY when depicted performing operations ("we trained..."); modelled agents the rules act on (a candidate, a general, a cultivator, a faction's leader); non-human agents with named agency.
    </example>
    <example category="bad" hint="Distinguish reference-by-name from agency-on-page.">
      Inline citations or bibliography ("Vaswani et al., 2017", "(Misra and Maaten, 2020)") — pointers to prior work, no on-page agency. Collectives or name-drops ("the scientific community", "reviewers", "prior work by X and Y") — not characters. Meta-modellers in simulation register ("Dr. Vásquez at the Simulation Core") — internal machinery, not in-world character, unless the premise explicitly puts them there.
    </example>
    <edge-case test="delete-and-reread">Take the scene, delete the character. Does the scene still read the same? If yes, they are a reference/citation, not a character. Do not extract them, and do not invent a transient character for one-line name-drops.</edge-case>
    <field name="role" values="anchor | recurring | transient">Shapes retrieval weight and salience, NOT a worldDelta count target. Emit as many 15-25-word nodes as the text genuinely reveals — a transient walk-on with one dense reveal = one node; an anchor laid bare = as many nodes as the reveals earn.</field>
  </entity-class>

  <entity-class id="locations">
    <definition>PHYSICAL or institutional areas the work treats as locatable — places you can stand in, venues for the work's events.</definition>
    <example category="good" hint="A location is somewhere the work's events HAPPEN; the texture varies by register but the shape is constant.">
      Fiction: a throne room, a teahouse, a forest at the boundary ward. Non-fiction: an archive reading-room, a rural clinic, a courtroom, a documented field site. Analysis: a lab, a benchmark testbed, a dataset's collection environment. Simulation: a Mughal subah under direct revenue, a Politburo briefing room, a Georgia precinct, a quarantined district.
    </example>
    <example category="bad" hint="Abstract domains and engine-running infrastructure are NOT locations.">
      "A field of inquiry", "the wizarding world", "academia" — abstract domains belong in system knowledge. "The Simulation Core", "the analyst's monitoring room", "the forecasting laboratory" — engine running a simulation is implementation, not in-world location, unless the premise explicitly puts the modellers in the world.
    </example>
    <field name="parentName">Nest locations.</field>
    <field name="tiedCharacterNames">Characters who BELONG (residents, members).</field>
    <field name="prominence" values="domain | place | margin">Shapes retrieval weight, NOT node count. Emit as many 15-25-word nodes as the text reveals — history, rules, dangers, atmosphere, properties.</field>
  </entity-class>

  <entity-class id="artifacts">
    <definition>Things with UTILITY or ECONOMIC VALUE — used, wielded, possessed, consumed, deployed, or (in simulation) whose contents drive the rule machinery.</definition>
    <test>Does this artifact deliver a specific utility to someone in the scene? If no utility → not an artifact.</test>
    <example category="good" hint="Utility is what unites them; the form varies by register.">
      Fiction: a ceremonial dagger, a family heirloom manuscript, a cursed talisman. Non-fiction: a field-notebook, a primary-source letter, an archival photograph, a court filing. Analysis: "Table 2: BLEU scores", "Figure 3: ablation curve", a trained-model checkpoint, a benchmark dataset. Simulation: a treaty draft, a transmission-parameter table, a doctrinal manual, an in-world Ministry of Health bulletin.
    </example>
    <example category="bad">Concepts, techniques, principles, named metrics, method classes ("Transformers", "GANs"), inline citations, the work itself, collectives ("the authors") — systemDeltas or non-entities, not artifacts.</example>
    <field name="ownerName">character/location/null. Figures/tables/equations: the author (or null). Documents: sender or writer.</field>
    <field name="significance" values="key | notable | minor">Shapes retrieval weight, NOT node count. Nodes follow the content the artifact genuinely carries — no cap.</field>
    <subtype id="short-lived" examples="tables, figures, equations, embedded letters / notes / maps / bulletins, dispatches">
      <invariant>The artifact's utility IS its content. worldDeltas MUST capture it — what the table shows, what the letter says, what the dispatch reports. Don't promote contents to systemDeltas unless the text itself generalises them into a rule.</invariant>
      <example category="good" hint="Single-claim short-lived artifacts — one node per distinct claim. The shape holds across registers.">
        Analysis (table): "Removing positional encoding drops BLEU 2.3 on EN-DE, showing positional signal is load-bearing." ·
        Fiction (letter): "Mentor's instructions to keep the child with the relatives until of age, with a warning that the threat may return." ·
        Non-fiction (transcript): "Witness places the suspect at the dock between 0140 and 0210, contradicting the manifest's 0030 sailing." ·
        Simulation (parameter table): "Sets β=0.18, mobility m=1.4 in the southern corridor; under the propagation rule, regional R₀ exceeds 1.5 once schools reopen."
      </example>
      <example category="good" type="lore-heavy" hint="Lore-dense artifacts routinely warrant 10+ distinct claim-nodes. Same shape across registers — a treaty's 12 clauses, a results table's 9 sub-findings, a multi-organ ritual artefact, a doctrinal manual's accumulated provisions.">
        Each clause / sub-finding / organ / mechanism / provision the content actually carries gets its own 15-25-word node. Three thin nodes when fifteen are earned is under-extraction; one run-on node with multiple claims should split along claim boundaries.
      </example>
      <example category="bad">"Table 2 shows results" / "A letter from the mentor" / "The treaty has provisions" — labels without contents.</example>
    </subtype>
    <deduplication>Same figure/table/equation/document across scenes is ONE artifact. Don't emit "Figure 10" and "Figure 10: standard architectures and their collapse capacity" separately — pick the fullest labelled form.</deduplication>
  </entity-class>

  <entity-class id="threads">
    <definition>Narrative tensions.</definition>
    <field name="development">What specifically happened.</field>
  </entity-class>
</entity-extraction>

<distinctness>
  <invariant>Every entity must be genuinely distinct from all others.</invariant>
  <rule type="threads">Two threads are distinct if resolving one does NOT automatically resolve the other.</rule>
  <rule type="characters">Two characters are distinct if they are different people (not name variants).</rule>
  <rule type="locations">Two locations are distinct if they are different physical spaces (not name variants).</rule>
  <rule type="artifacts">Two artifacts are distinct if they are different objects (not name variants).</rule>
  <rule type="system-concepts">Two system concepts are distinct if they describe different rules/facts (not rephrasing).</rule>
  <fallback>If entities overlap, pick ONE canonical form. Do not extract duplicates.</fallback>
</distinctness>

<minor-fields>
  <field name="events">2-4 word tags naming discrete beats. Emit one per distinct beat the scene contains — no count cap. Rule-driven state changes (a tier crossing, a threshold breach, a cascade triggering, a policy lifting) are legitimate beats; tag them as the source frames them.</field>
  <field name="artifactUsages">
    <intent>When an artifact delivers utility. Every artifact referenced for what it DOES (not just mentioned by name) is a usage.</intent>
    <invariant>Every usage MUST have a character who used it.</invariant>
    <field name="usage">Describe WHAT the artifact did — the specific utility delivered (searched for X, generated Y, computed Z).</field>
  </field>
  <field name="ownershipDeltas">Only when artifacts change hands.</field>
  <field name="tieDeltas">Significant bond changes. NOT temporary visits.</field>
</minor-fields>

<time-delta required="true">
  <intent>Gap since the PRIOR scene. Each scene is an instant; this field captures the transition as an estimate. Approximate is fine — captures the general flow.</intent>
  <invariant>Always commit to a best-guess; do not skip the field.</invariant>
  <field name="value">integer. Positive = forward, 0 = concurrent / first scene, negative = backward jump on the timeline (flashback OR diegetic time-travel — see special cases).</field>
  <field name="unit" values="minute | hour | day | week | month | year" />
  <field name="transition" optional="true">Short natural-language phrase capturing the English-language flow of the transition — "the next morning", "years before, when he was a boy", "by the time the funeral closed", "later that same evening". Carries the prose-level shape the {value, unit} pair cannot; downstream prose layers read this verbatim. Omit only when the source itself gives no transitional cue.</field>
  <example>{value: 1, unit: "minute", transition: "moments later"}</example>
  <example>{value: 6, unit: "hour", transition: "that evening"}</example>
  <example>{value: 3, unit: "year", transition: "three years later"}</example>
  <example>{value: -10, unit: "year", transition: "flashback to her schooldays"}</example>
  <example>{value: -3, unit: "hour", transition: "three hours earlier, using the Time-Turner"}</example>
  <special-case kind="concurrent">{value: 0, unit: "minute"} — same moment, different POV / vantage, OR the FIRST scene. Do NOT default to 0 for anything else.</special-case>
  <special-case kind="flashback">ONE negative value OPENS the excursion (memory, excerpt, recalled scene). Scenes INSIDE the flashback span move FORWARD with normal positive deltas — time flows forward in the past exactly like ordinary continuity. ONE eventual scene snap-returns to the present with a big positive delta that cancels the entry PLUS the forward motion accumulated inside.</special-case>
  <special-case kind="time-travel">ONE negative value OPENS the travel. Scenes INSIDE move FORWARD from the NEW earlier position (time flows forward in the new timeline). NO return; subsequent deltas are relative to the new position.</special-case>
  <sign-alignment critical="true">Sign matches transition direction. Backward phrase ("earlier", "ago", "X before", flashback, Time-Turner-style rewind) = NEGATIVE value. Forward phrase ("later", "next morning", "X after") = POSITIVE value.
    <correct>{value: -3, unit: "hour", transition: "three hours earlier, using the Time-Turner"}</correct>
    <correct>{value: -10, unit: "year", transition: "flashback to her schooldays"}</correct>
    <wrong>{value: 3, unit: "hour", transition: "three hours earlier, using the Time-Turner"} — phrase is backward, sign is forward.</wrong>
  </sign-alignment>
  <rule>ESTIMATE — read prose cues, pick the most plausible value. Default to small units for same-day gaps, days/weeks for section breaks.</rule>
  <rule>RELATIVE — no absolute calendar anchor.</rule>
  <rule>When the source's sections are not chronological events (typical of expository / argumentative structures), default to {value: 0, unit: "minute"} and use non-zero only when one section genuinely follows another in narrative time.</rule>
</time-delta>

`;

  return prompt + '\n' + fieldGuide;
}
