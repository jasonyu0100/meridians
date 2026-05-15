/**
 * Phase 1 of scene-plan generation — extract the compulsory propositions
 * (the discrete, checkable claims a reader must come away believing) from a
 * scene's structural data. Scene-only context; no narrative history.
 */

/** High-level identity only. Coverage rules and output schema live in the
 *  user prompt. */
export const EXTRACT_PROPOSITIONS_SYSTEM =
  `You are a scene fact-extractor. Read a scene's structural data (summary, deltas, new entities, events) and return the COMPLETE set of compulsory propositions the scene must land. Each proposition is prose-ready natural language a reader can absorb directly — never identifier-echoes or template scaffolding. Follow the coverage rules and output schema supplied in the user prompt. Return ONLY the JSON requested.`;

export function buildExtractPropositionsUserPrompt(args: { sceneXml: string }): string {
  return `<inputs>
  <scene>
${args.sceneXml}
  </scene>
</inputs>

<definition name="compulsory-proposition">A fact the prose MUST establish for the scene to count as having happened. Not atmosphere. Not craft flourish. A discrete, checkable claim phrased as natural prose the audience can absorb directly — the prose writer drops it into a beat without rephrasing.</definition>

<phrasing-discipline critical="true" hint="Each proposition is consumed downstream by the prose writer. If it reads like a database row, the prose layer has to translate it before use, which both costs work and risks the metadata leaking into the page.">
  <rule name="natural-language">Write as prose-ready statements about WHAT IS TRUE in the world. Past or present tense in the world's voice — not the engine's metadata.</rule>
  <rule name="no-identifier-echo" critical="true">Never echo internal identifiers, snake_case event names, or any "PREFIX-NUMBER" engine slug. Forbidden tokens: C-N, L-N, T-N, A-N, S-N, ARC-N, K-N, SYS-N, SYS-GEN-N. Translate every system-node reference to its CONCEPT in the world's voice ("the moonlight-wolf coaxing technique"), every thread reference to what it's ABOUT, every entity reference to its NAME. The structured fields downstream carry the IDs; propositions carry only the prose-ready phenomenon.</rule>
  <rule name="no-template-scaffolding">Do NOT write "An X event occurred" or "The thread 'Y' has shifted to 'Z', indicating W." Drop the framing entirely and state the in-world fact directly.</rule>
  <rule name="thread-shifts-as-events">For threadDeltas: do NOT quote the thread's question text or name its lifecycle status. Describe what actually happens in the scene that moves that thread (the discovery, the choice, the consequence). The thread's description is your anchor for what's at stake; the proposition states the in-world event.</rule>
  <rule name="events-as-prose">For events: the event string is a label, not the proposition. Render the underlying happening as a concrete prose statement.</rule>
  <rule name="no-system-jargon">Avoid framework terms ("state-change", "system-reveal", "thread-shift", "adaptive countermeasure") unless the world itself uses them as in-world vocabulary.</rule>
  <rule name="single-claim">One proposition = one atomic fact. Don't bundle multiple claims behind "and" or commas-as-ands.</rule>
  <rule name="no-cognition-collapse" critical="true" hint="The dominant failure mode for cognition-dense scenes. Prose can only render named content; if propositions name only the gesture, prose only has the gesture to dramatise.">
    Cognitive content in the summary — named scenarios, weighed tradeoffs, derived conclusions, planned contingencies, modelled agent reactions — MUST decompose into one proposition per named element. Never collapse "considered scenarios A, B, and C with their tradeoffs" into a single proposition like "she weighed her options." That collapse erases everything the prose writer needs and leaves them with stand-in verbs ("simulated", "calculated risks", "considered options") instead of the actual computation. One scenario = one proposition. One tradeoff = one proposition. One conclusion = one proposition. One planned contingency = one proposition.
  </rule>
</phrasing-discipline>

<examples>
  <bad reason="identifier echo, template scaffolding">"An instrument_malfunction occurred."</bad>
  <good>"Adaeze's transmitter stutters once, then falls silent in her hand."</good>
  <bad reason="quoting thread question + lifecycle status">"The thread 'Will Yusra recover the ledger without detection?' has shifted to 'resistance', indicating she succeeds with minor cost."</bad>
  <good>"Yusra retrieves the ledger, but the customs office's seal-readers leave a faint signature on her credentials."</good>
  <bad reason="system jargon, abstract">"The relay network's core functionality is now directly targeted by the regulator's adaptive countermeasures."</bad>
  <good>"The regulator is actively jamming the relay network, scrambling its routing tables."</good>
  <bad reason="bundled claims">"The relay network was used by Lin for night-time reconnaissance, but experienced targeted interference and distortion."</bad>
  <good>["Lin queries the relay network to track the night patrol's rounds.", "The relay network suffers targeted interference mid-query."]</good>
  <bad reason="simulation register — engine bookkeeping rather than in-world rule-driven event">"The system_rule for containment was triggered by SYS-4."</bad>
  <good reason="simulation register — the rule-driven outcome stated as in-world fact">["The reproduction number crosses 1.4 at week six of the modelled outbreak.", "Lagos prefecture activates its tier-two containment order in response."]</good>
  <bad reason="cognition-collapse — one gesture proposition for an entire chain of reasoning">["Mara refined her approach to the upcoming arbitration, weighing options and assessing risks."]</bad>
  <good reason="each named scenario, tradeoff, and conclusion gets its own proposition">[
    "Mara considers opening the arbitration with her strongest precedent and forcing the panel to address it directly — fast resolution, but burns her secondary arguments if the panel rejects it.",
    "Mara considers sequencing weaker precedents first to anchor the panel's attention before deploying her strongest — depends on the chair's known impatience holding for at least thirty minutes.",
    "Mara considers conceding the most contentious point upfront in exchange for a tighter scope ruling — sacrifices leverage but eliminates the panel's main objection.",
    "Mara rejects the strongest-precedent opening because the chair's history shows he hardens against frontal arguments raised in the first ten minutes.",
    "Mara commits to the sequencing approach for the morning session while preparing the concession approach as a fallback for the afternoon.",
    "Mara identifies the signal she needs from the chair's opening remarks: if he raises the scope question, sequencing is unsalvageable and she must pivot.",
  ]</good>
</examples>

<thoroughness hint="Every structural element in the scene data maps to at least one proposition. A missed delta becomes a continuity hole. A missed cognitive element from a dense summary becomes a prose-layer fabrication or, more commonly, a stand-in verb where the actual content should be.">
  <coverage>
    <source name="summary" critical="true">PRIMARY SOURCE — extract exhaustively. The summary runs 3-6 sentences for routine scenes and expands without upper bound for cognition-dense scenes. Every discrete claim, named scenario, weighed tradeoff, derived conclusion, planned contingency, modelled agent reaction, articulated rule, and stated commitment becomes its own proposition. A dense summary commonly yields 20+ propositions from the summary alone — that is the design. The deltas below capture the summary's structural footprint (which threads moved, which entities changed); the summary itself carries the semantic content the prose writer must dramatise. If the summary names three scenarios, emit three scenario-propositions plus whatever weighing and conclusion propositions the summary makes — never collapse them into "considered options." Completeness here is the load-bearing rule; the prose layer cannot recover what extraction discards.</source>
    <source name="threadDelta">The in-world event that moves this thread. Use the thread's description as the anchor for what's at stake; describe the moment that shifts it.</source>
    <source name="worldDelta">One proposition per addedNode, framed as a present-tense fact about the entity ("Yusra now distrusts the customs authority").</source>
    <source name="systemDelta.addedNodes">The world rule itself, stated as the world states it (not "rule X is added").</source>
    <source name="relationshipDeltas">The concrete shift ("Lin now resents the chair").</source>
    <source name="ownershipDeltas">The transfer ("the heirloom passes to the daughter").</source>
    <source name="tieDeltas">The tie established or severed, in plain language.</source>
    <source name="artifactUsages">What the artifact does in the scene, concretely.</source>
    <source name="characterMovements">The arrival/departure as in-world action.</source>
    <source name="events">The underlying happening — translate the event label into prose. If the label is opaque, infer from the surrounding deltas/summary what the label points at.</source>
    <source name="new-entities">That this entity now exists, plus one proposition per meaningful world-node they carry in (each as a fact about that entity).</source>
  </coverage>
</thoroughness>

<rules>
  <rule name="no-dedupe">Do NOT deduplicate across delta types — each delta is its own commitment even if surface wording overlaps. (But the SAME fact restated three times in different words across one source is a single proposition.)</rule>
  <rule name="no-texture">Do NOT include sensory texture, weather, or background atmosphere — those belong to plan-layer enrichment, not propositions.</rule>
  <rule name="no-ordering">Do NOT impose ordering — group by source for clarity. Reordering is the planner's job.</rule>
  <rule name="completeness" critical="true">Completeness matters more than minimalism. There is no proposition budget. A 30-sentence summary should produce a long proposition list; under-extraction collapses the prose's resolution back to whatever the summary's gestures named, undoing the depth the summary captured.</rule>
</rules>

<instructions>
  <step name="walk-summary">Walk the summary first — every sentence may carry one or more propositions. For dense summaries (multi-paragraph cognition, scenario chains, derived conclusions) extract until every named element has a corresponding proposition.</step>
  <step name="walk-deltas">Walk every other block of the scene XML (deltas, events, new entities). No structural element uncovered.</step>
  <step name="extract">Emit propositions per the coverage rules. Group by source. Cognition-dense summaries routinely emit 20+ propositions from the summary block alone — that is correct.</step>
  <step name="phrase">Re-read each proposition. If it contains an identifier, snake_case label, template phrase ("X occurred", "thread Y has shifted"), quoted thread question, or stand-in cognitive verb ("considered options", "modelled scenarios", "weighed factors") — rewrite it as the in-world fact, naming the actual content.</step>
</instructions>

<output-format>
Return ONLY JSON: { "propositions": [{"content": "single in-world fact in natural prose", "type": "free-label"}, ...] }
Type is a free label (event, state, rule, relation, secret, goal, transfer, tie, movement, emergence…).
</output-format>`;
}
