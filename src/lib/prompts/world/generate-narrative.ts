/**
 * Whole-narrative generation — produces a complete world (characters,
 * locations, threads, artifacts, system rules, optional opening arc + scenes,
 * prose profile) from a title + premise. Two modes: full (8-scene opening
 * arc) or worldOnly (entities + system, no scenes).
 */

export const GENERATE_NARRATIVE_SYSTEM =
  'You are a narrative architect spinning a complete seed from a title + premise. Build a tight, focused world with named entities, threads with named outcomes, and system rules. Full mode: also produce an 8-scene opening arc + prose profile. World-only mode: entities + system + prose profile, no scenes. Initialize every entity with seed nodes; never emit blank world graphs. Return ONLY valid JSON matching the schema in the user prompt.';

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

export type GenerateNarrativeArgs = {
  title: string;
  premise: string;
  /** When true: world entities only, no scenes/arcs. */
  worldOnly: boolean;
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
    worldOnly,
    forceReferenceMeansWorld,
    forceReferenceMeansSystem,
    worldTypicalBand,
    worldClimaxBand,
    systemTypicalBand,
    systemClimaxBand,
  } = args;

  return `<inputs>
  <task hint="${worldOnly ? 'World-only mode — output entities, no scenes or arcs.' : 'Full mode — entities + 8-scene opening arc + prose profile.'}">${worldOnly
    ? 'Extract and build a complete narrative world from the following plan. Do NOT generate scenes or arcs — output world entities only (characters, locations, threads, relationships, artifacts, rules, systems, prose profile).'
    : 'Create a complete narrative world.'}</task>
  <title>${title}</title>
  <${worldOnly ? 'narrative-plan' : 'premise'}>${premise}</${worldOnly ? 'narrative-plan' : 'premise'}>
</inputs>

<output-format>
Return JSON with this exact structure:
{
  "worldSummary": "2-3 sentence world description",
  "worldBuildSummary": "1-2 sentences (≤ 40 words). Plain prose. State the INTENT of this initial world commit — what creative space it opens, what tension it primes, which load-bearing entities, factions, or rules it brings into play. Used downstream to steer arc generation when this commit is read as <world-build-focus>, so name the load-bearing additions, not counts.",
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
      "locationId": "L-1",
      "povId": "C-1",
      "participantIds": ["C-1"],
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

<rules name="opening-arc" hint="Establish a tight, focused world. Counts below are minimums; exceed when the premise warrants it.">
  <minimums>
    <count entity="characters" target="≥8">2+ anchors, 3+ recurring, 3+ transient</count>
    <count entity="locations" target="≥6">parent/child hierarchy with at least 2 nesting levels</count>
    <count entity="threads" target="≥4">DELIBERATE MIX of shapes (see thread-shapes). 1+ discrete-resolution, 1+ slow-burn, 1+ constant-tension. At least 2 must share participants so their markets correlate.</count>
    <count entity="relationships" target="≥8">at least 1 hostile</count>
    <count entity="artifacts" target="≥1">when the premise involves tools, documents, instruments, sources, or objects that carry weight</count>
    <count entity="system-nodes" target="≥12">with ≥8 edges. The foundational system graph every future scene draws from; a thin root means thin scenes forever. Each node MUST be 15-25 words describing a general rule or structural fact. Include micro-rules (specific mechanics), mid-rules (institutional/economic), and macro-rules (cosmological/thematic).</count>
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
      <note>Thread logs track incremental answers.</note>
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

  <scene-coverage>
    <rule>Every anchor must appear in at least 3 scenes.</rule>
    <rule>Use at least 6 different locations across the 8 scenes.</rule>
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
