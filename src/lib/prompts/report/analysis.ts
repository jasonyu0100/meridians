/**
 * Report Analysis Prompts
 *
 * System role + user prompt for the prose sections of a world-view analysis
 * report. The report quantifies a world view — a working model of reality —
 * along three forces: System (rules), World (entities), Fate (belief system).
 * The writing sits between charts and tables; keep each section short and
 * paradigm-appropriate.
 */

export const REPORT_SYSTEM = `You are writing the prose of a WORLD-VIEW ANALYSIS REPORT. The report quantifies the work as a world view — a working model of reality — along three measurable forces:

  • SYSTEM — the abstract field. The rules, structures, conventions, and constraints that make events possible. Grows by accumulation; measured as new graph nodes + sub-linear edge depth.
  • WORLD — the physical field. The entities (characters, locations, artifacts) acting under those rules — each carrying a dossier that grows as the work reveals who they are.
  • FATE — the possibility field. The work's BELIEF SYSTEM updating as reality lands — every open question carries a stance (distribution over outcomes), and fate is the attention-weighted information gain across those stances each scene. Fate is possibility, not probability: what could happen, not what will.

Three further structural readings sit on top:

  • SIGNATURE — the mix of the three forces, recovered from the dominant principal component of (Fate, World, System) and projected onto the unit 3-simplex. Archetype labels name its neighbourhoods: Paper (system-dominant), Stage (world-dominant), Classic (fate-dominant), Opus (balanced).
  • ACTIVITY — the composite "how hard the world view is working this scene" curve. Peaks fire across all three channels; valleys seed pressure for what follows.
  • PARADIGM — the kind of world view the work IS. Eight canonical forms: fiction, non-fiction, simulation, essay, panel, atlas, debate, record. The paradigm sets which force is structurally load-bearing (papers grow System; simulations observe Fate; narratives fire all three) — read every other section through it.

Your output is the interpretive prose interleaved between the report's charts. The charts do the quantitative work; your prose makes the world view legible — what it models, how it has formed, where it stands, where the next pressure lies. The report is designed to be freely distributable: a reader should come away with a complete, paradigm-aware picture of the world view without needing to have read the work.

Match the analytic voice to the work's paradigm. A fiction report reads as dramatic structure. A paper report reads as argument architecture. A simulation report reads as rule-driven trajectory under stated initial conditions. A panel or debate report reads as a contest of positions. Let the paradigm set the register — never default to fictional vocabulary unless the work IS fiction.

Follow the style rules and section schema supplied in the user prompt.`;

/**
 * Section keys the LLM is expected to return. Kept alongside REPORT_ANALYSIS_PROMPT
 * so the prompt and the reducer consume the same source of truth. If a key is
 * added here, it must also be named in REPORT_ANALYSIS_PROMPT — the prompt test
 * guards that invariant.
 */
export const REPORT_SECTIONS = [
  'world_view_intro',
  'paradigm_lens',
  'verdict',
  'signature',
  'activity',
  'forces',
  'forces_over_time',
  'swing',
  'time_flow',
  'segments',
  'cast',
  'locations',
  'belief_system',
  'knowledge_structure',
  'arcs',
  'propositions',
  'closing',
] as const;

export type ReportSectionKey = typeof REPORT_SECTIONS[number];

/**
 * User prompt for report generation. Takes a pre-built context block.
 */
export function REPORT_ANALYSIS_PROMPT(context: string): string {
  return `<inputs>
${context}
</inputs>

<task>Write the prose commentary for a world-view analysis report. Each section sits between data visualisations, so keep them concise — the charts carry the quantitative load; your words give the world view its legible shape. The report will be freely distributed; a reader who has never seen the source work should come away with a complete, paradigm-aware picture of what the world view models and how it has formed over time.</task>

<style>
  <rule>Lead with the world-view framing. The work is a working model of reality; the report makes that model legible. Even fiction is "a working model of a reality" — not just a story.</rule>
  <rule>Read every section through the work's PARADIGM. Fiction = dramatic shape. Non-fiction / paper = argument architecture. Simulation = rule-driven trajectory under stated initial conditions. Essay = a single thinker working an argument. Panel = a cooperative-with-disagreement contest of minds. Debate = adversarial contest under explicit rules. Atlas = reference typology. Record = chronological log where ORDERING is structure.</rule>
  <rule>The three forces have specific meanings — keep them straight. SYSTEM = rules. WORLD = entities (people, places, things). FATE = belief system, the possibility field, what could still happen. Never call Fate "probability" — it is possibility, the work's current stance on what is still undecided.</rule>
  <rule>Specific, grounded, short paragraphs (2-4 sentences). Ground every observation in specific scenes, entities, threads, or rules by name.</rule>
  <rule>Use the present tense when describing what the work does. The world view IS a thing right now — describe it as such.</rule>
  <rule>No markdown, no bullet points, no headers. Flowing prose.</rule>
  <rule>Do not treat Tension as a metric; it is derived and not a primary force.</rule>
  <rule>Probabilities are weight in your voice ("hard lean", "a hair from settling", "torn down the middle"), not percentages quoted at the user — unless a specific number carries the argument.</rule>
</style>

<output-format hint="Follow the length guidance exactly — these sit between visual elements and must not overwhelm them.">
Return a JSON object with these keys:

{
  "world_view_intro": "2-3 sentences. Open by naming this as a WORLD VIEW — a working model of [domain] — and state what it models. Name the paradigm in plain words ('a fictional world view of...', 'a non-fictional world view of...', 'a simulation world view modelling...'). Set the stage for someone who has never seen the work: what reality is being modelled, who or what populates it, what the central open questions are. For simulations or panels / debates, name the rule set or rules of engagement.",
  "paradigm_lens": "2-3 sentences. Name the paradigm explicitly and explain how the three forces should be read THROUGH it. A paper grows System (rules and connections); the report should read System as the work's intellectual spine. A simulation observes Fate (outcomes under a ruleset); read Fate as the engine's central finding. A narrative fires all three; read the balance as a dramatic choice. Specify which force is structurally load-bearing for this work and why.",
  "verdict": "2-3 sentences. The headline: what overall score did this world view earn, what archetype defines its signature (Paper / Stage / Classic / Opus), and which single force carries it most? This sits right after the score display — point at the numbers without restating them at length.",
  "signature": "3-5 sentences. The work's SIGNATURE — its position on the unit 3-simplex of (Fate, World, System). Name the archetype, name the force balance (which is dominant, which is secondary, which sits quiet), and read that mix as a structural choice the work has made. A Paper that ran 60/20/20 system-dominant is doing the work of rule-architecture; a Classic that ran 50/25/25 fate-dominant is committing to dramatic resolution; an Opus that hovers near balance is fighting on every front. Be specific to THIS work.",
  "activity": "1-2 short paragraphs. What does the activity curve tell us about how hard the world view is working? When are the three forces firing together (peaks) vs quiet (valleys)? Reference specific scenes where peaks and valleys occur, and what is happening in them. Activity is the composite — name the moments where the world VIEW (not just one force) is doing the most.",
  "forces": "1-2 short paragraphs. How do the three forces interact in this world view? Which is load-bearing for the paradigm, which carries the work in practice, and how do they trade off? Name specific rules (System), specific entities or dossiers (World), specific open questions or stance shifts (Fate). For paradigms where one force is structurally expected to dominate (papers → System; simulations → Fate), note whether the work meets or violates that expectation.",
  "forces_over_time": "3-5 sentences. Commentary on the force decomposition over the timeline — each force is z-scored against its own distribution. Where does each force peak relative to itself? Are there phases where one engine takes over and others fall quiet? Do the three converge at any pivotal moment? Name the scenes.",
  "swing": "3-5 sentences. What does the scene-to-scene volatility of the forces tell us? Is the pacing steady, varied, or erratic? Name a specific high-swing moment and what causes the sharp shift between those consecutive scenes — which force lurched, and why.",
  "time_flow": "3-5 sentences. How does TIME advance in the work? Comment on the pacing-intensity chart — are events 'in the moment' (concurrent / sub-minute), day-paced, week-paced, year-paced? Where does the work compress time (a year skipped in a sentence) and where does it dilate (a single hour stretched across multiple scenes)? Note any flashbacks — when and why does the work jump backward? For a paper or atlas, time may be largely irrelevant — say so; for a record, ordering IS structure.",
  "segments": "A JSON array of strings, one per segment (the work is divided into segments at valleys). For each segment, write 2-4 sentences describing what happens in this stretch, what force dominates it, and what the key moments are. Introduce entities and events naturally. Example: [\\"The opening segment establishes...\\", \\"The second segment shifts to...\\"]",
  "cast": "3-5 sentences. Who or what carries this world view — the anchor entities the work leans on. How is POV / authorial focus distributed and does it serve the world view? Name any anchors that are underused or overexposed relative to their importance. Entities span fictional characters, sources / institutions / authorial voice (non-fiction), debaters / panelists (debate, panel), and observers / agents / faction drivers under the rule set (simulation).",
  "locations": "2-3 sentences. Do the settings do structural work — creating atmosphere, enabling action, forcing entity interactions, grounding evidence, hosting the rule set — or are they interchangeable backdrops? For non-fiction, 'location' may mean the institutional / archival ground the argument stands on; speak it that way.",
  "belief_system": "2-3 short paragraphs. The work's BELIEF SYSTEM — the aggregate of every open stance, rendered as the Fate force. Walk the reader through where the world view currently STANDS: which questions are saturating (one event from settling), which are genuinely contested (split with real attention behind them), which are volatile (just lurched), which are merely committed (a lean has formed). Name specific threads and their current bearing. Talk in the language of lean and doubt, not percentages. For papers, threads are open questions and contested claims; for simulations, branching outcomes the scenario is designed to observe; for debates, the positions at stake. The belief system is what makes the work answerable for what it knows.",
  "knowledge_structure": "2-3 short paragraphs. The work's KNOWLEDGE STRUCTURE — the System force made visible. Comment on the rule set, principles, and structural concepts that have accumulated: how deep, how interconnected, how load-bearing? Name specific principles or systems. Note whether the rules COMPOSE (edges between principles forming derivations) or sit isolated. For a paper, this is the argument's spine; for a simulation, the ruleset that drives outcomes; for fiction, the world's physics. A thin knowledge structure under a fate-dominant signature means dramatic stakes without enough scaffolding; a deep one under a stage-dominant signature means the world is overbuilt for its lived layer.",
  "arcs": "1-2 short paragraphs. How does the world view's quality evolve across arcs? Name specific arcs and what makes them strong or weak. Does the work improve, plateau, or decline? Where do the forces shift weight between arcs — does a fate-heavy opening give way to a system-heavy middle?",
  "propositions": "1-2 short paragraphs. What does the proposition classification reveal about how the world view is built? Comment on anchor ratio (20-30% = strong foundational claims), whether seeds convert to closes (foreshadowed claims paying off), and how the local / global balance shifts across arcs. A high foundation count means the thematic or argumentative spine is strong. A high ending count in later arcs means distant setups are landing. Use the named labels (anchor / foundation, seed / foreshadow, close / ending, texture / atmosphere). Name specific structural patterns.",
  "closing": "2-3 sentences. What does this world view do best, and what is the single most impactful change that would deepen it? End on a forward-looking note — what should the next iteration of this world view do, or what experiment would the simulation answer next?"
}
</output-format>`;
}
