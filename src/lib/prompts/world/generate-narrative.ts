/**
 * Whole-narrative generation — produces a complete world (characters,
 * locations, threads, artifacts, system rules, optional opening arc + scenes,
 * prose profile) from a title + premise. Two modes: full (8-scene opening
 * arc) or worldOnly (entities + system, no scenes).
 */

export const GENERATE_NARRATIVE_SYSTEM =
  'You are a narrative architect. Detect the register first and pick the matching world-shape: fiction / non-fiction / simulation → POPULATED NARRATIVE (human or in-world characters — Khrushchev, Yi, invented people); analysis → AGENTIC AI TEAM with memorable single-word AI-coded names (Atlas, Cipher, Nexus, Vanguard) the user can invoke across passes; paper / essay → SINGULAR THINKER (one named author plus 1-3 cited interlocutors). See <register-handling> and the pattern blocks in the user prompt. Pure-abstract works (math theorem, formal proof) take zero populated-world entities. Full mode: also produce an 8-scene opening arc + prose profile. World-only mode: entities + system + prose profile, no scenes. Initialize every entity you emit with seed nodes — never emit blank world graphs. Return ONLY valid JSON matching the schema in the user prompt.';

export const DETECT_PATTERNS_SYSTEM =
  'You are a literary diagnostician. Read prose, structure, and content; identify the narrative\'s register, genre, and subgenre; derive concrete pattern / anti-pattern commandments that encourage variety and prevent stagnation. Patterns are positive directives that unlock fresh territory within the register; anti-patterns are negative directives that flag staleness. Return ONLY valid JSON matching the schema in the user prompt.';

import {
  PROMPT_POV,
  PROMPT_FORCE_STANDARDS,
  PROMPT_STRUCTURAL_RULES,
  PROMPT_DELTAS,
  PROMPT_WORLD,
  PROMPT_ARC_STATE_GUIDANCE,
  PROMPT_SUMMARY_REQUIREMENT,
} from '../index';

import type { NarrativeParadigm } from '@/types/narrative';

/** World-shape each paradigm maps to. */
type ParadigmShape = 'populated-narrative' | 'agentic-ai-team' | 'singular-thinker';

const PARADIGM_SHAPE: Record<NarrativeParadigm, { shape: ParadigmShape; directive: string }> = {
  'fiction':      { shape: 'populated-narrative', directive: 'Invented people in an invented world. Apply the populated minimums; use the cultural palette the premise implies.' },
  'non-fiction':  { shape: 'populated-narrative', directive: 'Real people, places, and documented events. Honour historical accuracy where the premise names real figures; the world IS the documented record.' },
  'simulation':   { shape: 'populated-narrative', directive: 'In-world figures the rules act on (e.g Khrushchev, Yi, an in-world commander or cultivator). System rules are load-bearing. Forward-time event modelling IS the point — scenes narrate what happens to the modelled world as the rules act over time. (If the user wanted interpretation of present evidence, they would have picked analysis.)' },
  'analysis':     { shape: 'agentic-ai-team',     directive: 'Virtual team of AI agents (Atlas, Cipher, Nexus, Vanguard) with devil\'s-advocate role + ≥1 adversarial pair, collective goal-thread tracks the thesis. CRITICAL: analysis ≠ simulation. The team works with EXISTING evidence (LLM knowledge + user\'s source material). Scenes are cognitive events over that evidence. NEVER narrate forward-time events, fabricated intercepts, or invented quotes as if freshly observed — scenarios are explicit hypotheticals the team models, not plot beats.' },
  'paper':        { shape: 'singular-thinker',    directive: 'One named author works through the argument. 1 anchor (the author), 1-3 transient cited interlocutors (the theorists / methods the paper engages or rebuts). System-graph IS the argument substrate; internal friction substitutes for inter-agent disagreement.' },
  'essay':        { shape: 'singular-thinker',    directive: 'One named author whose voice the work IS. 1 anchor, 1-3 transient interlocutors. The author\'s mind is the world; threads track the argument-questions they are pursuing.' },
};

// ── Per-paradigm prompt blocks ───────────────────────────────────────────────
// When the user picks a register in the wizard, ONLY the matching block is
// injected into the prompt — the other paradigms are dropped at build time.
// When the user leaves register unset, the full inference-mode block is used
// (model detects register from the premise).

const PARADIGM_POPULATED_NARRATIVE = `<populated-narrative-shape critical="true" hint="Fiction / non-fiction / simulation worlds — populated by named HUMAN (or in-world species) characters, places, and physical artifacts.">
  <intent>The world is populated. Apply the full populated minimums (characters ≥8, locations ≥6, relationships ≥8, artifacts ≥1, threads ≥4, system-nodes ≥12). Simulation populates real / modelled-world figures the rules act on (Khrushchev, Yi, an in-world cultivator); non-fiction populates real authors / subjects / witnesses; fiction populates invented people.</intent>
  <invariant>Use plausibly-human first/last names matching the cultural palette the premise implies — no AI-coded single-word names; those belong only in the agentic-ai-team paradigm.</invariant>
</populated-narrative-shape>`;

const PARADIGM_AGENTIC_TEAM = `<agentic-team-pattern critical="true" hint="Analysis shape — a virtual team of AI agents pursuing the user's thesis. Preserves continuities, force fields, surveys, interviews; gives the user a stable named cast they can invoke across future generation passes.">
  <naming critical="true" hint="AI agent names are the user's handle for invoking them later. Memorable, clearly AI-coded — not human first names.">
    <rule>Each agent has a SINGULAR, MEMORABLE name suggesting intelligence / system-role — one word, evocative, the kind the user can call back later ("next pass, have Vanguard challenge Atlas's read on X"). NEVER human-style first / last names (David Chen, Elena Vasquez) — those belong in populated-narrative paradigms.</rule>
    <palette kind="mythological">Atlas, Oracle, Athena, Mercury, Hermes, Janus, Argus</palette>
    <palette kind="cosmological / structural">Nexus, Vector, Pulse, Orbit, Quasar, Compass, Anchor, Helix</palette>
    <palette kind="heraldic / signal">Vanguard, Sentinel, Beacon, Standard, Herald, Aegis</palette>
    <palette kind="tools / instruments">Cipher, Quill, Forge, Lens, Anvil, Loom, Plumb</palette>
    <palette kind="archetypes">Sage, Scribe, Critic, Augur, Tribune, Cantor, Curator</palette>
    <invariant>Avoid generic words (Data, Model, Agent). Each name fits on a single token of working memory.</invariant>
  </naming>

  <archetypes hint="Pick the archetype matching the analytical goal.">
    <archetype name="research lab">synthesiser + specialists + methods/data + external reviewer. Goal: produce a finding.</archetype>
    <archetype name="macro / strategy team">synthesiser + sector specialists + quant + executor + risk-officer. Goal: build a thesis and act on it.</archetype>
    <archetype name="investigation crew">lead + forensics/methods + analyst + named-source channels. Goal: build the case.</archetype>
    <archetype name="think tank / editorial">director + analysts + critic + external interlocutor. Goal: produce recommendations or the work itself.</archetype>
    <archetype name="multi-agent AI orchestration">orchestrator + specialists + verifier. Goal: complete the user's request via division of cognitive labour.</archetype>
  </archetypes>

  <required-roles hint="Map each to anchor / recurring / transient.">
    <role kind="synthesiser" mapping="anchor">Commits the team to a direction; integrates other agents' findings.</role>
    <role kind="specialist" mapping="anchor / recurring">Domain expert per sub-question.</role>
    <role kind="devil's advocate" mapping="anchor / recurring" critical="true">EXPLICITLY challenges the consensus. Without this role the team is an echo chamber — ≥1 member MUST hold it.</role>
    <role kind="methods / data" mapping="recurring">Brings evidence, runs the model, cross-references sources.</role>
    <role kind="source / external" mapping="transient">External party feeding intelligence or forcing a thesis update.</role>
  </required-roles>

  <continuity-discipline>
    <rule>Each agent's world graph encodes role-coded nodes: capability, belief (methodological priors), history (prior commitments / completed analyses), weakness (blind spot), goal.</rule>
    <rule>≥1 adversarial pair baked in (methodological dispute, recency-vs-historical bias, breadth-vs-depth). Disagreement gives narrative tension without inventing fictional drama.</rule>
    <rule>The team's collective objective is a constant-tension thread ("does the thesis hold?"). Sub-questions become discrete-resolution threads, one per agent's focus.</rule>
  </continuity-discipline>

  <analysis-vs-simulation critical="true" hint="Most important discipline for analysis — get it wrong and the work degenerates into LARPing.">
    <core>Analysis works with EXISTING evidence (LLM knowledge of present + user's source material). Scenes are cognitive events over that evidence; simulation is forward-time event modelling and lives in a different paradigm.</core>
    <forbidden>
      <rule>No forward-time narration ("three days later, the PLA conducted an exercise"; "a new piece of data hits"). The only time-progression in analysis scenes is COGNITIVE (next meeting / next model run) — not external events.</rule>
      <rule>No fabricated intelligence ("Argus intercepted comms"; "Xi privately told Trump"; "Tribune's off-record memo"). Use publicly known evidence + user's source material — not invented covert sources.</rule>
      <rule>No specific numbers presented as freshly observed ("oil exports rebounded to 1.2 million bpd") unless from the source material or well-attested in LLM knowledge. Mark anything else as a model output or scenario assumption.</rule>
    </forbidden>
    <permitted>
      <rule>Scenarios as explicit hypotheticals ("the team models the case where the PLA exercises — under that scenario, conviction drops 12 points"). Reasoning over possible worlds, not narrating that they arrived.</rule>
      <rule>Re-interpretation of evidence on the table; model recalibration with adjusted priors; devil's-advocate challenges to readings — friction from competing READINGS of the SAME evidence.</rule>
      <rule>Name evidence gaps honestly when the team lacks data. Don't paper over with invented numbers.</rule>
    </permitted>
    <test>If "in the scene, X happened" can be replaced with "the team imagined a scenario where X would happen" without loss, the scene is analytical. If X must be a real new event, you've drifted into simulation — rewrite.</test>
  </analysis-vs-simulation>

  <example category="good" archetype="macro-team">
    Real World Investment Thesis. Team: Atlas (synthesiser), Cipher (geopolitical analyst, reads policy directives), Nexus (model runner), Vanguard (devil's advocate), Beacon (sector specialist), Quill (sources / open-source intelligence reader). Goal-thread: does the team's macro thesis outperform consensus over twelve months? Scene shape: the team re-reads the user's source material with the LLM's present knowledge, runs the Sentry Engine over varying priors, challenges each sub-thesis adversarially, and synthesises — they do NOT narrate "a new event arrived" as plot.
  </example>
</agentic-team-pattern>`;

const PARADIGM_SINGULAR_THINKER = `<singular-thinker-pattern critical="true" hint="Paper / essay shape — one named author works through the argument. Populate sparsely.">
  <required-roles>
    <role kind="author" mapping="anchor">The named thinker whose voice the work IS. Continuity carries their thesis, methodology, prior commitments, blind spots, the priors the argument moves through.</role>
    <role kind="interlocutor" mapping="transient">Cited theorist, named reviewer, primary-source author the work engages with directly. 1-3 typical; each carries a specific position the author engages or rebuts.</role>
  </required-roles>
  <discipline>
    <rule>Internal friction substitutes for team disagreement: the author considers and rejects alternative readings, engages cited positions, qualifies earlier commitments. Threads track the author's argument-questions, not external team goals.</rule>
    <rule>Relationships (when present) are intellectual lineages — mentor / inheritance / rebuttal / extension. Hostile is rare unless the author engages an adversarial position.</rule>
    <rule>The author's anchor world-graph is densest at belief / history (argument-trajectory, prior commitments) and goal (the thesis being arrived at).</rule>
  </discipline>
  <example category="good" register="paper">A solo paper on Song iron-coin abandonment: Dr. Wen (anchor) traces the regional smelter-output data; engages two cited interlocutors — Smith (the prior consensus the paper rebuts) and Park (whose methods the paper extends). Argument-thread: does the garrison-reduction prediction hold district-by-district?</example>
  <example category="good" register="essay">A personal essay on Bengali typography: the named author (anchor) traces three generations of typesetters in her own family; engages one cited interlocutor (the historian whose claim about Unicode the essay nuances). Argument-thread: what did each technology silently mistranslate?</example>
</singular-thinker-pattern>`;

/** Emits ONLY the matching paradigm block — the other paradigms are dropped at
 *  build time so the model gets a single, focused, deterministic standard. */
function paradigmBlockFor(paradigm: NarrativeParadigm): string {
  switch (PARADIGM_SHAPE[paradigm].shape) {
    case 'populated-narrative': return PARADIGM_POPULATED_NARRATIVE;
    case 'agentic-ai-team':     return PARADIGM_AGENTIC_TEAM;
    case 'singular-thinker':    return PARADIGM_SINGULAR_THINKER;
  }
}

// ── Per-paradigm minimums ────────────────────────────────────────────────────

const MINIMUMS_POPULATED = `<minimums>
  <count entity="characters" target="≥8">2+ anchors, 3+ recurring, 3+ transient. Human / in-world species names matching the premise's cultural palette.</count>
  <count entity="locations" target="≥6">parent/child hierarchy with ≥2 nesting levels.</count>
  <count entity="threads" target="≥4">DELIBERATE MIX of shapes (1+ discrete-resolution, 1+ slow-burn, 1+ constant-tension). ≥2 must share participants so their markets correlate.</count>
  <count entity="relationships" target="≥8">at least 1 hostile.</count>
  <count entity="artifacts" target="≥1">when the premise involves tools, documents, instruments, sources, or objects that carry weight.</count>
  <count entity="system-nodes" target="≥12">with ≥8 edges. Each node 15-25 words. Mix of micro-rules, mid-rules, macro-rules.</count>
</minimums>`;

const MINIMUMS_AGENTIC_TEAM = `<minimums>
  <count entity="agents" target="≥8 AI-named">synthesiser (anchor) + 3-5 specialists (≥1 MUST hold devil's-advocate) + 1-2 methods/data + 2-3 transient sources / external reviewers. Use AI-coded single-word names — see agentic-team-pattern naming palettes.</count>
  <count entity="locations" target="≥6">team working spaces (HQ, conference room, individual offices) + field sites / archives / corpora / datasets the team engages with.</count>
  <count entity="threads" target="≥4">1+ constant-tension GOAL-THREAD capturing the team's collective thesis ("does the thesis hold?") + 1+ discrete-resolution per agent's investigative focus + 1+ slow-burn on the contested-claim space.</count>
  <count entity="relationships" target="≥8">≥1 methodological-adversarial pair (devil's-advocate vs synthesiser, data-vs-narrative, recency-vs-historical). Hostile here means productive friction, not personal enmity.</count>
  <count entity="artifacts" target="≥1">team tools (proprietary model, dataset, instrument), the primary sources / cited works the thesis leans on.</count>
  <count entity="system-nodes" target="≥20">with ≥12 edges. The system graph IS the argument — propositions, mechanisms, methods, evidence relations, predictions, contestation points.</count>
</minimums>`;

const MINIMUMS_SINGULAR_THINKER = `<minimums>
  <count entity="characters" target="2-4">1 anchor (the named author) + 1-3 transient interlocutors (cited theorists, named reviewers, primary-source authors the work engages or rebuts).</count>
  <count entity="locations" target="0-3">optional — study / archive / field site. Skip entirely if the argument doesn't ground in a place.</count>
  <count entity="threads" target="≥4">argument-questions the author is pursuing. 1+ constant-tension (the central thesis question) + sub-questions as discrete-resolution. Internal friction (rejected readings, qualified commitments) appears in thread logs.</count>
  <count entity="relationships" target="0-3">intellectual lineages — mentor / inheritance / rebuttal / extension. Hostile is rare unless the author engages an adversarial position.</count>
  <count entity="artifacts" target="0-3">the author's archive, primary sources, cited works being engaged with.</count>
  <count entity="system-nodes" target="≥20">with ≥12 edges. The system graph IS the argument substrate — propositions, mechanisms, evidence relations, predictions, the author's claims and counter-positions.</count>
</minimums>`;

function minimumsBlockFor(paradigm: NarrativeParadigm): string {
  switch (PARADIGM_SHAPE[paradigm].shape) {
    case 'populated-narrative': return MINIMUMS_POPULATED;
    case 'agentic-ai-team':     return MINIMUMS_AGENTIC_TEAM;
    case 'singular-thinker':    return MINIMUMS_SINGULAR_THINKER;
  }
}

export type GenerateNarrativeArgs = {
  title: string;
  premise: string;
  /** Optional seeding context — extra source material the user pastes as
   *  authoritative reference for the LLM to draw from when building the
   *  initial world. Injected as a `<source-material>` block. */
  sourceText?: string;
  /** When true: world entities only, no scenes/arcs. */
  worldOnly: boolean;
  /** Compulsory paradigm — selects the world-shape (populated-narrative /
   *  agentic-ai-team / singular-thinker) and the per-paradigm prompt blocks. */
  paradigm: NarrativeParadigm;
  forceReferenceMeansWorld: number;
  forceReferenceMeansSystem: number;
  worldTypicalBand: string;
  worldClimaxBand: string;
  systemTypicalBand: string;
  systemClimaxBand: string;
};

export function buildGenerateNarrativePrompt(args: GenerateNarrativeArgs): string {
  const {
    title,
    premise,
    sourceText,
    worldOnly,
    paradigm,
    forceReferenceMeansWorld,
    forceReferenceMeansSystem,
    worldTypicalBand,
    worldClimaxBand,
    systemTypicalBand,
    systemClimaxBand,
  } = args;

  const paradigmEntry = PARADIGM_SHAPE[paradigm];
  const paradigmDirectiveBlock = `  <paradigm-directive critical="true" hint="User-selected paradigm. Generate the world in this shape.">
    <paradigm>${paradigm}</paradigm>
    <world-shape>${paradigmEntry.shape}</world-shape>
    <directive>${paradigmEntry.directive}</directive>
  </paradigm-directive>\n`;

  const sourceMaterialBlock = sourceText && sourceText.trim()
    ? `  <source-material hint="Authoritative seeding context supplied by the user. Treat as reference material the world should draw from — honour names, facts, structural details, and relationships present here. The premise above states the goal; this block provides the raw material.">
${sourceText.trim()}
  </source-material>\n`
    : '';

  return `<inputs>
${paradigmDirectiveBlock}  <task hint="${worldOnly ? 'World-only mode — output entities, no scenes or arcs.' : 'Full mode — entities + 8-scene opening arc + prose profile.'}">${worldOnly
    ? 'Extract and build a complete narrative world from the following plan. Do NOT generate scenes or arcs — output world entities only (characters, locations, threads, relationships, artifacts, rules, systems, prose profile).'
    : 'Create a complete narrative world.'}</task>
  <title>${title}</title>
  <${worldOnly ? 'narrative-plan' : 'premise'}>${premise}</${worldOnly ? 'narrative-plan' : 'premise'}>
${sourceMaterialBlock}</inputs>

<output-format>
Return JSON with this exact structure:
{
  "worldSummary": "2-3 sentence world description",
  "worldBuildSummary": "1-2 sentences (≤ 40 words). Plain prose. State the INTENT of this initial world commit — what creative space it opens, what tension it primes, which load-bearing entities, factions, or rules it brings into play. Used downstream to steer arc generation when this commit is read as <world-build-focus>, so name the load-bearing additions, not counts.",
  "genre": "Primary genre WITHIN the chosen paradigm — e.g. for fiction: fantasy, sci-fi, thriller, romance, horror, mystery, literary; for non-fiction: biography, history, memoir, reportage; for simulation: counterfactual, wargame, policy modelling, cultivation; for analysis: macro-strategy, investigation, multi-agent reasoning; for paper: empirical, theoretical, methods; for essay: personal, critical, polemical.",
  "subgenre": "Specific sub-form within the genre — e.g. progression fantasy, cozy mystery, autobiographical memoir, Mughal-succession counterfactual, monetary-policy wargame, geopolitical macro strategy, applied-econometrics paper, literary criticism essay. Pick the most identifying form.",
  "imageStyle": "A concise visual style directive for all generated images (e.g. 'watercolour style with soft lighting'). Should capture the tone, medium, palette, and aesthetic that best fits this world.",
  "characters": [
    {"id": "C-1", "name": "Full name matching the cultural palette of the world — rough, asymmetric, lived-in", "role": "anchor|recurring|transient", "threadIds": ["T-1"], "imagePrompt": "1-2 sentence LITERAL physical description — concrete traits (hair colour, build, clothing). No metaphors or figurative language; image generators interpret literally.", "world": {"nodes": [{"id": "K-1", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense: a stable fact about this character — trait, belief, capability, state, secret, goal, or weakness"}]}}
  ],
  "locations": [
    {"id": "L-1", "name": "Location name from geography, founders, or corrupted older words — concrete and specific", "prominence": "domain|place|margin", "parentId": null, "threadIds": [], "imagePrompt": "1-2 sentence LITERAL visual description — concrete architecture, landscape, lighting. No metaphors or figurative language; image generators interpret literally.", "world": {"nodes": [{"id": "LK-1", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense: a stable fact about this location — history, rules, dangers, atmosphere, or properties"}]}}
  ],
  "threads": [
    {"id": "T-1", "participants": [{"id": "C-1", "type": "character|location|artifact"}], "description": "Frame as a QUESTION: 'Will X succeed?' 'Can Y be trusted?' 'What is the truth behind Z?' — 15-30 words, specific", "outcomes": ["Named possibilities the market prices. Binary default: ['yes','no']. Multi-outcome when resolution is N-way. Must be distinct, mutually exclusive, 2–6 entries."], "horizon": "short | medium | long | epic — structural distance from any scene to this thread's resolution. short = 2-3 scenes, medium = within an arc, long = multi-arc, epic = work-spanning or open-ended. Drives evidence-magnitude attenuation downstream — pick honestly.", "openedAt": "S-1", "dependents": []}
  ],
  "relationshipDeltas": [
    {"from": "C-1", "to": "C-2", "type": "short relation label — mentor, rival, ally, kin, debtor, peer, etc.", "valenceDelta": 0.5}
  ],
  "artifacts": [
    {"id": "A-1", "name": "Artifact name — concrete and specific to its function or origin", "significance": "key|notable|minor", "threadIds": [], "parentId": "character or location ID, or null for world-owned", "world": {"nodes": [{"id": "AK-1", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense: what this artifact is, what it does, its history, powers, or limitations"}]}, "imagePrompt": "1-2 sentence LITERAL visual description — concrete physical details only, no metaphors or figurative language"}
  ],${worldOnly ? `
  "systemDeltas": {"addedNodes": [{"id": "SYS-1", "concept": "15-25 words, PRESENT tense: a general rule or structural fact about how the world works — no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "SYS-1", "to": "SYS-2", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]},
  "attributions": ["C-1", "L-1", "T-1", "SYS-1"],
  "attributionEdges": [{"from": "C-1", "to": "SYS-1", "relation": "requires|enables|constrains|risks|causes|reveals|develops|resolves|supersedes"}],` : `
  "scenes": [
    {
      "id": "S-1",
      "arcId": "ARC-1",
      "locationId": "L-1 — existing location ID, OR null when no locations are populated (analysis / paper)",
      "povId": "C-1 — viewpoint entity ID, OR null for omniscient / analytical / voice-of-nobody scenes",
      "participantIds": ["C-1 — may be empty array for analysis / paper scenes with no on-stage participants"],
      "summary": "REQUIRED — WRITE THIS FIRST. The spine of the scene; every delta below must trace back to something stated here. Prose in NAMES not IDs. Length adapts to content — 3-6 sentences for routine scenes (physical action, dialogue, observable events, single-thread movements, scene-setting beats), expand WITHOUT UPPER BOUND for cognition-dense scenes (multi-step planning, scenario modelling, scheme construction, modelling other agents' reactions, complex world-rule reveals, layered argument). For dense scenes, capture the ACTUAL computation — name each scenario weighed, each tradeoff accepted, each conclusion reached, each agent modelled with their predicted reaction. Stand-in cognitive verbs ('considered the situation', 'planned carefully', 'weighed his options') are failures: name what was cognised. This is the prose writer's only brief and the only artifact other scenes can read — detail that lives only in prose evaporates at the scene boundary. Include context that shapes how the scene is written (time span, technique, tone). No sentences ending in emotions or realizations without a named, attributed referent.",
      "timeDelta": {"value": 1, "unit": "hour"},
      "artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX", "usage": "what the artifact did — how it delivered utility"}],
      "events": ["event_tag"],
      "threadDeltas": [{"threadId": "T-1", "logType": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "updates": [{"outcome": "outcome name from thread.outcomes", "evidence": 1.5}], "volumeDelta": 1, "addOutcomes": ["optional — new outcome names if this scene opens a possibility not previously in the market"], "rationale": "thread-specific prose sentence (10-20 words) — what the scene does to this thread in natural language. Do NOT quote outcome identifiers, mention evidence numbers, or reference logType."}],
      "worldDeltas": [{"entityId": "C-XX", "addedNodes": [{"id": "K-GEN-1", "content": "15-25 words, PRESENT tense: a stable fact about the entity — what they experienced, became, or now possess", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
      "relationshipDeltas": [],
      "systemDeltas": {"addedNodes": [{"id": "SYS-GEN-1", "concept": "15-25 words, PRESENT tense: a general rule or structural fact about how the world works — no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "SYS-GEN-1", "to": "SYS-GEN-2", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]},
      "attributions": ["C-1", "L-1", "T-1", "SYS-1"],
      "attributionEdges": [{"from": "C-1", "to": "SYS-1", "relation": "requires|enables|constrains|risks|causes|reveals|develops|resolves|supersedes"}]
    }
  ],
  "arcs": [
    {"id": "ARC-1", "name": "Arc name — a short thematic label for this narrative segment", "sceneIds": ["S-1"], "develops": ["T-1"], "locationIds": ["L-1"], "activeCharacterIds": ["C-1"], "initialCharacterLocations": {"C-1": "L-1"}, "directionVector": "Forward-looking intent — see ARC METADATA guidance below.", "worldState": "Backward-looking compact state snapshot as of END of arc — see ARC METADATA guidance below for domain-adaptive form."}
  ],`}
  "proseProfile": {
    "register": "the tonal register (conversational/literary/raw/clinical/sardonic/lyrical/mythic/journalistic or other)",
    "stance": "narrative stance (close_third/intimate_first_person/omniscient_ironic/detached_observer/unreliable_first or other)",
    "tense": "past or present",
    "sentenceRhythm": "terse/varied/flowing/staccato/periodic or other",
    "interiority": "surface/moderate/deep/embedded for character thought; analytical/evidentiary for non-fiction reasoning; state-tracked for simulation agents under the rule set; or another value the source actually fits",
    "dialogueWeight": "sparse/moderate/heavy/almost_none",
    "devices": ["2-4 literary devices that suit this world's tone"],
    "rules": ["3-6 SPECIFIC prose rules as imperatives — these must be concrete enough to apply sentence-by-sentence. BAD: 'Write well'. GOOD: 'Show emotion through physical reaction, never name it' / 'No figurative language — just plain statements of fact' / 'Terse does not mean monotone — vary between clipped fragments and occasional longer compound sentences'"],
    "antiPatterns": ["3-5 SPECIFIC prose failures to avoid — concrete patterns that break this voice. BAD: 'Don't be boring'. GOOD: 'NEVER use \"This was a [Name]\" to introduce a mechanic — show what it does, not what it is called' / 'No strategic summaries in internal monologue (\"He calculated that...\") — show calculation through action' / 'Do not follow a system reveal with a sentence restating its significance' / 'Do not write narrator summaries of what the character already achieved on-page'"]
  },
  "planGuidance": "2-4 sentences of specific guidance for scene beat plans. What mechanisms should dominate? How should exposition be handled? What should plans avoid? EXAMPLE: 'Prioritise demonstration and direct exchange over expository narration. System mechanics surface through use, not summary. Interior or authorial reflection should be tactical and clipped. Plans should never include a beat whose purpose is to explain a concept that was already demonstrated in a prior beat.'",
  "patterns": ["3-5 positive thematic commandments derived from THIS narrative's REGISTER and GENRE. First identify the register/genre/subgenre — cozy mystery, literary realism, speculative, memoir, essay, reportage, research paper, ethnographic study, history, historical counterfactual, economic / policy modelling, political wargame, pandemic / climate scenario, agent-based study, LitRPG / cultivation / xianxia, or whatever the source actually is — then extract patterns that make narratives in this tradition succeed: register-specific moves to embrace, structural rhythms (e.g. 'Each arc ends with a finding and a cost', 'Every rule invoked must produce a downstream consequence the next arc carries'), entity dynamics typical of the form. EXAMPLES (across registers): 'Every cost paid must compound into later consequence', 'Argument advances through specific cases, not general claims', 'The investigator's blind spots must be staged before they are exposed', 'Every rule-driven outcome must trace back to a stated rule'"],
  "antiPatterns": ["3-5 negative commandments — common pitfalls in THIS register/genre to avoid. Tropes or moves to subvert, common failures in the form, patterns that would break this work's tone. EXAMPLES (across registers): 'No convenient breakthroughs without earned setup', 'Anchor entities cannot be diminished just to let other anchors look strong', 'No info-dumps disguised as dialogue', 'No source paraphrased without attribution', 'No conclusion the evidence has not yet earned', 'No outcome that the stated rule set does not actually entail'"]
}
</output-format>

<rules name="opening-arc" hint="Establish a tight, focused world. Counts are minimums; exceed when warranted. Paradigm is fixed by the user's selection (or inferred when omitted) — see the paradigm block above.">
  ${paradigmBlockFor(paradigm)}

  ${minimumsBlockFor(paradigm)}
  <example-block hint="System-node examples — what good foundational rules look like across paradigms.">
    <example category="bad" reason="too-short">Tribunal</example>
    <example category="good" register="fiction" flavour="fantasy">A house's right to bind rain to its lands lapses if the founding water-compact goes three generations without a renewing oath; lapsed lands return to common drought rotation under the regent's ledger.</example>
    <example category="good" register="fiction" flavour="cultivation">A disciple ascends a tier only when the sect elder witnesses a tribulation crossing AND the qi-reservoir admits the new draw; reservoir capacity binds the sect to a fixed succession rate.</example>
    <example category="good" register="fiction" flavour="sci-fi">A colony's memory-scent inheritance passes only along confirmed matrilineal lines registered at the genome archive; off-register children carry the chemistry but no inheritance rights, and the archive can be edited only by quorum.</example>
    <example category="good" register="simulation" flavour="wargame">A border raid escalates to open conflict only when the cumulative grievance ledger crosses the threshold set by the suzerain's tribute schedule, gating retaliation through a mandatory seven-day council convocation.</example>
    <example category="good" register="paper">A finding is admitted to the journal's record only after two reviewers, blind to author and institution, sign off on methods AND data within the 16-week revision cycle; managing-editor override requires written dissent.</example>${worldOnly ? '' : `
    <count entity="scenes" target="≥8 in 1 arc">Averaging ~${forceReferenceMeansWorld} world nodes and ~${forceReferenceMeansSystem} system nodes per scene (the grading reference means). Some scenes quiet, some dense — but the MEAN across the arc must hit the reference or the whole opening grades in the 60s.</count>
    <density typical="touches 3-5 entities; ${worldTypicalBand} world nodes; ${systemTypicalBand} system concepts" climactic="${worldClimaxBand} world; ${systemClimaxBand} system" />`}
  </minimums>

  <seeding-fate>
    <intent>A great narrative is pregnant with consequence. Every entity you create should carry the seeds of future tension.</intent>
    <rule>Threads are fate's mechanism — each thread is a COMPELLING question (stakes + uncertainty + investment) the narrative MUST eventually answer.</rule>
    <rule>Characters carry secrets that WILL come out, goals that WILL collide, relationships that WILL be tested.</rule>
    <rule>Locations hold histories that WILL matter, resources that WILL be contested, rules that WILL constrain.</rule>
    <rule>Artifacts have costs that WILL be paid, powers that WILL be exercised, origins that WILL be revealed.</rule>
    <rule>Systems create pressures that WILL force action — scarcity breeds conflict, power demands trade-offs.</rule>
    <invariant>From the first scene the audience should sense that SOMETHING LARGER IS COMING. Every detail is a load-bearing seed; you're priming the connections that will matter.</invariant>
    <rule name="plant-surprises">At least 2 characters carry undisclosed information not yet surfaced anywhere in the work (these go in world nodes of type "secret").</rule>
    <rule name="create-asymmetries">What Character A believes about Character B should differ from reality in ways that will surface later.</rule>
    <rule name="build-pressure">Threads should share participants so collision is INEVITABLE, not coincidental.</rule>
  </seeding-fate>

  <entity-definitions>
    <entity id="characters">Named beings with agency — people, named animals, sentient AI (AGI), authors, investigators, named sources, subjects, witnesses. In simulation register: in-world participants the rules act on (a commander, a minister, a trader, an in-world epidemiologist working a real outbreak, a cultivator under the world's tier system, a candidate, a swing-state voter, a campaign strategist) — NOT a meta-modeller running a simulation of these events from outside. Non-sentient AI systems are artifacts.</entity>
    <entity id="locations">Spatial areas, regions, or institutions — places you can be IN, physically or institutionally (a city, an archive, a laboratory, a movement). In simulation register: scenario theatres INSIDE the modelled world (a Mughal subah, a strait, a quarantined district, a Georgia precinct, a Politburo briefing room, a campaign suite), agent populations treated as a place (a guild, a sect, a faction's catchment) — NOT an out-of-frame "Simulation Core", "data archive", or "forecasting laboratory" unless the premise explicitly asks for that meta-narrative.</entity>
    <entity id="artifacts">Anything that delivers utility — tools, documents, instruments, sources. Active, not passive concepts. Concepts belong in system knowledge. In simulation register: rule documents in-world (treaties, doctrinal texts, statutes, a campaign's internal polling report), instruments characters wield (sensors, telegrams, audit ledgers, an indictment filing), and rule-readouts ONLY when the modelled world itself contains them as objects characters interact with (a LitRPG stat sheet, a wargame turn report passed between commanders, a cultivation tier certificate, an in-world Ministry of Health bulletin). NEVER an out-of-frame modeller's forecast / dashboard / dampener-parameter unless the premise is explicitly a meta-narrative about modelling.</entity>
    <entity id="threads">
      <definition>QUESTIONS that shape fate — stakes, uncertainty, contested outcomes. Match the narrative's register.</definition>
      <example category="bad">Will X succeed?</example>
      <example category="good" register="fiction" flavour="fantasy">Can the Carrow branch line stand as witness to the founding oath before the equinox closes the water-compact for good?</example>
      <example category="good" register="fiction" flavour="cultivation">Does Disciple Lin Wei's tier crossing hold under Elder Ji's witness, or does the Iron Cloud reservoir reject the draw and seal the sect to a two-year ascension drought?</example>
      <example category="good" register="fiction" flavour="sci-fi">Will the off-register heirs win Quorum to edit the genome archive before the inheritance vote closes on the next generation?</example>
      <example category="good" register="simulation" flavour="wargame">Under the modelled tribute schedule and grievance threshold, does the border alliance hold past the third raid cycle?</example>
      <example category="good" register="non-fiction" flavour="biography">Does the 1934 archival record support the meson hypothesis emerging from Yukawa's dispute with Bohr, or did the field retrofit the attribution later?</example>
      <example category="good" register="analysis">Does the proposed structural cause explain the famine-relief failures across both colonial Bengal and 1980s Ethiopia?</example>
      <example category="good" register="paper">Does the Song iron-coin abandonment correlate, district by district, with the garrison-reduction record the paper predicts it should?</example>
      <example category="good" register="analysis" shape="agentic-team-goal-thread">Does the MacroFund team's geopolitical thesis outperform consensus benchmarks over the next twelve months? — constant-tension goal-thread the whole team is pursuing.</example>
      <example category="good" register="paper" shape="agentic-team-goal-thread">Does Dr. Wen's iron-coin team produce a paper that survives the journal's two-reviewer cycle without methodological revision? — the team's collective goal-thread.</example>
      <note>Thread logs track incremental answers. For agentic-team worlds, ALWAYS include one constant-tension goal-thread that captures the team's collective objective; sub-threads track each agent's investigative focus.</note>
    </entity>
  </entity-definitions>

  <thread-shapes hint="Threads differ in how they live and die. A good seed mixes them.">
    <shape id="discrete-resolution" seed="1-2">
      <intent>A concrete question with a clean answer. Resolves within 1-3 arcs when the evidence is in.</intent>
      <outcomes>Usually binary or small-N — "What grade aperture does X have?" → {A, B, C, D}.</outcomes>
      <market-behaviour>Goes from high uncertainty to collapse in a single decisive scene; once answered, it closes and stays closed.</market-behaviour>
      <placement>Early-arc hooks.</placement>
    </shape>
    <shape id="slow-burn" seed="1-2">
      <intent>Stays genuinely uncertain across many arcs.</intent>
      <market-behaviour>Oscillates and re-prices but doesn't close until structural conditions align late in the work.</market-behaviour>
      <example>Can the rebellion topple the regime?</example>
      <example>Does the theory survive the critical test case?</example>
      <placement>The narrative's middle spine.</placement>
      <maintenance>Requires a healthy diet of small evidence updates scene-by-scene; starve them and they abandon.</maintenance>
    </shape>
    <shape id="constant-tension" seed="1-2">
      <intent>A philosophical or interior spine that pulses forever — asks a question that shapes every decision.</intent>
      <example>Can the anchor entity redeem their past?</example>
      <example>Will the anchor ever reconcile with the parent who shaped them?</example>
      <example>Is the field's foundational assumption defensible?</example>
      <market-behaviour>May never close within the work's scope; probability drifts as events reshape the anchor's stance.</market-behaviour>
      <maintenance>Need recurring small pulses to stay alive (volume decay is lethal); treat them as the narrative's weather, not its fate spine.</maintenance>
    </shape>
    <invariant>Within the same narrative, these shapes should read as distinctly different. A discrete-resolution thread that pulses through 20 scenes without resolving has been mis-shaped. A constant-tension thread that closes cleanly in arc 3 has been mis-shaped. Name the shape when you seed — match the question to the lifetime you intend.</invariant>
  </thread-shapes>

  <character-depth-by-role hint="Minimums; go deeper for complex characters.">
    <intent>These initial world nodes become the first readings the grader sees, and anchor entities will be revisited for world deltas across every scene, so seed them richly.</intent>
    <ordering>List each entity's nodes in the causal/temporal order they became true — adjacent nodes auto-chain into the entity's inner graph, no manual edges needed.</ordering>
    <depth role="anchor" target="6-8 world nodes">defining trait, goal, belief, weakness, secret, capability, relation, history</depth>
    <depth role="recurring" target="3-4 world nodes">role, relationship to an anchor, one hidden dimension, one capability or limitation</depth>
    <depth role="transient" target="1-2 world nodes">function and a distinguishing trait</depth>
  </character-depth-by-role>

  <input-handling>
    <intent>The premise may include user-provided characters, locations, threads, rules, and systems. Handle both cases.</intent>
    <case kind="seeded">Use the provided entities as anchors and starting points. Expand the world around them — add adjacent entities (supporting cast, additional sources, fellow witnesses, peer institutions, related schools-of-thought), sub-locations, connecting threads. Honour the user's descriptions and relationships but deepen them with secrets, contradictions, and hidden connections. The user's input is the skeleton; you build the muscle and skin.</case>
    <case kind="bare-premise">Interpret the premise ambitiously. Extrapolate a full world with factions, geography, history, power structures, and the rule set the work models. A one-line premise — whether a high-concept genre tag, a memoir hook, an essay's central question, a research paper's lead finding, a historical-counterfactual scenario, an economic / policy model, a political wargame setup, or a cultivation / LitRPG ladder — should produce a world as rich and specific as one seeded with 20 entities. Do not produce a thin world just because the input was thin.</case>
  </input-handling>

  <naming critical="true">
    <intent>The premise may contain placeholder or generic names (e.g. "The Reincarnator", "The Elder Council", "Shadow Realm"). Replace ALL placeholder names with original, specific names. Naming is the single biggest quality signal.</intent>
    <directive>Name with cultural specificity, not generic invented syllables. Names should be rooted in real traditions of the world's implied culture.</directive>
    <step index="1" name="detect-cultural-origin">
      <rule>Detect the cultural origin the premise implies, then source names from THAT palette. No palette is the default; no palette is disfavoured. The failure is reflexive defaulting in ANY direction — Anglo names on a Mughal premise, Yoruba names on a Silicon Valley premise, Japanese names on a US-politics premise are the same error. Mughal → Persian / Arabic / Turkic; Lagos → Yoruba / Igbo / Akan; Heian → Japanese; US politics, British memoir, Silicon Valley → Anglo / European / diasporic. Match what the premise asks for.</rule>
      <palette region="east-asian">Han Chinese (classical / modern), Japanese (kun/on readings), Korean, Vietnamese, Mongolian</palette>
      <palette region="south-asian">Sanskrit, Tamil/Dravidian, Bengali, Punjabi, Sinhala, Pashto</palette>
      <palette region="middle-eastern / west-asian">Arabic, Persian/Farsi, Turkish, Hebrew, Aramaic, Kurdish</palette>
      <palette region="african">Yoruba, Igbo, Akan, Amharic, Swahili, Zulu, Wolof, Hausa, Malagasy, Tamazight</palette>
      <palette region="indigenous">Nahuatl, Quechua, Navajo, Cree, Māori, Hawaiian, Sami — use respectfully, avoid sacred/taboo names</palette>
      <palette region="european">Anglo / English, Romance (French / Spanish / Italian / Portuguese / Romanian), Germanic, Slavic, Baltic, Nordic, Celtic, Greek, Latin</palette>
      <palette region="post-colonial / maritime">Latin American, Caribbean, Lusophone African, Filipino, Indonesian, Malay</palette>
      <palette region="diasporic / multicultural">Names that mark hybridity (e.g. Chinese-Peruvian, Lebanese-Brazilian, British-Nigerian) where the premise calls for it</palette>
    </step>
    <step index="2" name="source-from-real-cultures">Source names from real census records, historical obscurities, regional naming traditions, or deliberate etymological construction rooted in SPECIFIC cultures matching the world's origin. A world inspired by Song Dynasty China should have names sourced from Chinese historical records. A world inspired by Ottoman history from Turkish/Arabic/Persian roots. A West African-inspired world from Yoruba, Akan, or Wolof roots. A Sanskrit-inflected world from Vedic or Tamil sources.</step>
    <step index="3" name="multicultural-palettes">For multicultural worlds: each faction, region, or cultural group gets its own distinct naming palette reflecting its origin. Names should signal which part of the world a character comes from.</step>
    <step index="4" name="internal-consistency">Pick a consistent cultural palette for each faction or region and stay within it. Internal consistency is more important than variety.</step>
    <step index="5" name="texture">Prefer rough, blunt, asymmetric names where the source tradition allows it. Names with hard consonant clusters, unexpected syllable stress, tonal marks, or occupational origins feel lived-in. Smooth melodic names with open vowels feel generated — unless the palette is genuinely melodic (e.g. Hawaiian, Japanese), in which case lean into the tradition's own texture.</step>
    <step index="6" name="surnames">From occupations, geography, patronymics/matronymics, or clan names — never compound noun+noun invention (Stormrider, Shadowbane).</step>
    <step index="7" name="locations">Derive from terrain, founders, or linguistic corruption of older words. They should sound like they've been mispronounced for centuries within their own language family.</step>
    <step index="8" name="threads-and-systems">Concrete and specific. "The Tithe of Ash" not "The Power System". "The Lazar Compact" not "The Ancient Alliance". Match the cultural palette — a Mughal-inspired system might be "The Mansabdari Ledger", a West African one "The Ọba's Covenant".</step>
    <test>If a name could appear interchangeably across 10 different generic works in any register or culture, it's too generic. If it could only belong to THIS world and this culture, it's right.</test>
    <respect>When drawing from Indigenous or living religious traditions, avoid names with explicit sacred/taboo status. Use the tradition's everyday register, not its ceremonial one, unless the premise explicitly calls for the latter and handles it with weight.</respect>
  </naming>

  <location-hierarchy-and-agency>
    <rule>Build spatial nesting: Region → Settlement → District → Specific Place.</rule>
    <rule>A city with 5 sub-locations feels more real than 5 unconnected cities.</rule>
    <rule>Include contrasting environments: if the narrative opens in a safe space, the world needs a dangerous or unstable counterpart.</rule>
    <agency>A location is BOTH a place AND its people. A delta village is its floodplain AND its fishers AND its song cycles. A city is infrastructure AND culture AND collective will. A kingdom is territory AND governance AND identity. A monastery is cells AND its order. A research institute is buildings AND its reviewers. Locations think, feel, and act through their inhabitants.</agency>
    <prominence level="domain" target="4-6 world nodes">Centers of power with deep inner worlds. They impose rules on the entities within them and have collective agency — a kingdom demands fealty, a city mourns its dead, a research field polices its methods, an institution pursues its agenda.</prominence>
    <prominence level="place" target="2-3 world nodes">Recurring settings. History, state, trait.</prominence>
    <prominence level="margin" target="1 world node">Transitional. Trait or state.</prominence>
  </location-hierarchy-and-agency>

  <relationships>
    <rule>Connect anchors to MANY characters (6+ relationships per anchor).</rule>
    <rule>Asymmetric descriptions: "A admires B" while "B suspects A".</rule>
    <rule>At least 2 hidden relationships (known to the audience, not yet to the entities involved).</rule>
  </relationships>

  <artifacts-and-tools>
    <intent>Artifacts are things that by themselves can provide utility. They extend what's possible — a ceremonial weapon changes how someone fights, a foundational dataset changes the scale of an inquiry, a primary-source archive reorders an investigator's hypotheses, a contested instrument anchors a research programme, a treaty or doctrinal text fixes the rules a scenario must run under, a calibrated mobility table sets which trajectories the model can produce. Artifacts modify their wielder's capabilities and constrain their choices.</intent>
    <significance level="key" count="1" target="5-7 world nodes">A capability-altering entity. Traits, capabilities, history, weaknesses, secrets, goals. Must connect to at least 2 threads. Its inner world should rival a recurring character's. Define HOW it changes what its wielder can do.</significance>
    <significance level="notable" count="1" target="3-4 world nodes">A tool, document, or instrument that grants a specific capability. Capability, history, relation, weakness. Owned by an entity who uses it — the wielder's capabilities should reflect the artifact.</significance>
    <significance level="minor" count="1" target="1-2 world nodes">A small object with narrative potential. Can be at a location.</significance>
    <invariant>Artifacts must feel integral to the world. Key artifacts should have world edges (capability motivated_by history, weakness caused_by trait).</invariant>
  </artifacts-and-tools>${worldOnly ? '' : `

  <scene-coverage hint="Applies when characters / locations are populated. For analysis / paper with no characters or locations, scenes are sections of argument — these coverage rules do not bind. Scene fields locationId and povId may be null in that case.">
    <rule when="anchors present">Every anchor must appear in at least 3 scenes.</rule>
    <rule when="locations present">Use at least 6 different locations across the 8 scenes.</rule>
  </scene-coverage>

  <time-delta required="true">
    <intent>Each scene is an instant; timeDelta captures the gap since the PRIOR scene as an estimate. Approximate is fine — captures the general flow.</intent>
    <invariant>Always commit to a best-guess; do not skip the field.</invariant>
    <field name="value">integer (positive = forward, 0 = concurrent, negative = backward jump on the timeline — flashback OR diegetic time-travel; see special cases).</field>
    <field name="unit" values="minute | hour | day | week | month | year">Pick the unit that reads most naturally.</field>
    <example>{value: 3, unit: "hour", transition: "that evening"}</example>
    <example>{value: 1, unit: "day", transition: "the next morning"}</example>
    <example>{value: 3, unit: "year", transition: "three years later"}</example>
    <example>{value: -10, unit: "year", transition: "flashback to her schooldays"}</example>
    <example>{value: -3, unit: "hour", transition: "three hours earlier, using the Time-Turner"}</example>
    <special-case kind="concurrent">{value: 0} — same moment, different POV / vantage, OR the first scene of the arc. Do NOT default to 0 for anything else.</special-case>
    <special-case kind="flashback">ONE negative value OPENS the excursion. Scenes INSIDE move FORWARD with normal positive deltas (time flows forward in the past). ONE eventual big positive delta snap-returns to the present, cancelling the entry plus motion accumulated inside.</special-case>
    <special-case kind="time-travel">ONE negative value OPENS the travel. Scenes INSIDE move FORWARD from the new position (time flows forward in the new timeline). NO return; subsequent deltas relative to the new position.</special-case>
    <sign-alignment critical="true">Sign matches transition direction. Backward phrase (flashback, Time-Turner-style rewind, "earlier", "ago", "X before") = NEGATIVE. Forward phrase ("later", "next morning", "X after") = POSITIVE.
      <wrong>{value: 3, unit: "hour", transition: "three hours earlier, using the Time-Turner"} — phrase is backward, sign is forward.</wrong>
    </sign-alignment>
    <rule>Estimate from prose cues, not a calendar.</rule>
  </time-delta>

  ${PROMPT_POV}
  ${PROMPT_FORCE_STANDARDS}
  ${PROMPT_STRUCTURAL_RULES}
  ${PROMPT_DELTAS}
  ${PROMPT_WORLD}
  ${PROMPT_ARC_STATE_GUIDANCE}
  ${PROMPT_SUMMARY_REQUIREMENT}`}
</rules>
`;
}
