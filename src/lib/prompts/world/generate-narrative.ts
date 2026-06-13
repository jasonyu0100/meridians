/**
 * Whole-narrative generation — produces a complete world (characters,
 * locations, threads, artifacts, system rules, optional opening arc + scenes,
 * prose profile) from a title + premise. Two modes: full (4-scene opening
 * arc) or worldOnly (entities + system, no scenes).
 */

import type { NarrativeParadigm } from '@/types/narrative';
import {
  PROMPT_POV,
  PROMPT_FORCE_STANDARDS,
  PROMPT_STRUCTURAL_RULES,
  PROMPT_DELTAS,
  PROMPT_WORLD,
  PROMPT_ARC_STATE_GUIDANCE,
  PROMPT_SUMMARY_REQUIREMENT,
} from '../index';
import {
  composeAnalystIdentity,
  WORLD_ARCHITECT_BY_PARADIGM,
  type WorkIdentity,
} from '../paradigm';

const WORLD_ARCHITECT_SHARED =
  'A world view is a causally coherent, queryable knowledge structure — not by default a story. The paradigm decides the OUTPUT FORM. See the pattern blocks in the user prompt for the specific shape requirements. Full mode: also produce an opening arc (scene count is specified in the user prompt) + prose profile. World-only mode: entities + system + prose profile, no scenes. Initialize every entity you emit with seed nodes — never emit blank world graphs. Return ONLY valid JSON matching the schema in the user prompt.';

/** Multipurpose fallback — preserves the legacy prompt verbatim for the rare
 *  call that supplies no paradigm. */
const WORLD_ARCHITECT_FALLBACK =
  'You are a world-view architect. A world view is a causally coherent, queryable knowledge structure — not by default a story. Detect the paradigm first and pick the matching world-shape: fiction / non-fiction → POPULATED NARRATIVE (invented vs. observed humans / in-world figures); simulation → RULE-GOVERNED NARRATIVE (in-world figures the rules ACT ON; the rule set is load-bearing); essay → SINGULAR THINKER (one named author plus 1-3 cited interlocutors); panel → MULTI-THINKER (a named cast of agents OR human experts, cooperative-with-disagreement, the work IS the contest of minds reaching synthesis); atlas → REFERENCE TYPOLOGY (entries / taxa / categories, no scene flow, system-graph IS the work); debate → ADVERSARIAL CONTEST (two or more named parties locked in zero-sum stakes under explicit rules); record → CHRONOLOGICAL RECORD (time-ordered log of events, real or imagined; entries replace scenes; pick a time velocity — daily / monthly / yearly / dynamic); game → MULTI-ACTOR GAME (2+ actors take turns pursuing contested stakes under enforceable rules; system-graph IS the rule set, world tracks actors + resources + positions, threads are open stakes). The paradigm decides the OUTPUT FORM — do not default to fictional storytelling shape when the paradigm calls for entries, moves, sections, chronicled entries, or game turns. See the pattern blocks in the user prompt. Full mode: also produce an opening arc (scene count is specified in the user prompt) + prose profile. World-only mode: entities + system + prose profile, no scenes. Initialize every entity you emit with seed nodes — never emit blank world graphs. Return ONLY valid JSON matching the schema in the user prompt.';

/** Build the world-architect SYSTEM prompt. Case-based on the wizard-declared
 *  paradigm. When paradigm is unset, falls back to the multipurpose preamble. */
export function buildGenerateNarrativeSystem(paradigm?: NarrativeParadigm): string {
  if (!paradigm) return WORLD_ARCHITECT_FALLBACK;
  return `${WORLD_ARCHITECT_BY_PARADIGM[paradigm]} ${WORLD_ARCHITECT_SHARED}`;
}

/** @deprecated Use `buildGenerateNarrativeSystem(paradigm)` instead. Kept
 *  only because the export name is referenced from a few re-export indices;
 *  this resolves to the legacy multipurpose preamble for back-compat. */
export const GENERATE_NARRATIVE_SYSTEM = WORLD_ARCHITECT_FALLBACK;

export const DETECT_PATTERNS_SYSTEM =
  'You are a world-view diagnostician. Read content, structure, and register; identify the world view\'s register, genre, and subgenre — these may be narrative, but may equally be argumentative, typological, chronicled, or adversarial. Derive concrete pattern / anti-pattern commandments that encourage variety and prevent stagnation within the world view\'s actual paradigm. Patterns are positive directives that unlock fresh territory; anti-patterns are negative directives that flag staleness. Return ONLY valid JSON matching the schema in the user prompt.';

/** Build the detect-patterns system prompt with optional work identity.
 *  When paradigm is set, sharpens the prompt to detect patterns WITHIN that
 *  paradigm rather than from scratch. */
export function buildDetectPatternsSystem(work?: WorkIdentity): string {
  if (!work?.paradigm) return DETECT_PATTERNS_SYSTEM;
  return `${composeAnalystIdentity(work)} You diagnose THIS work's patterns and anti-patterns — concrete commandments that encourage variety and prevent stagnation within the operator-declared paradigm. Patterns are positive directives that unlock fresh territory within this paradigm's idiom; anti-patterns are negative directives that flag staleness specific to this paradigm. Return ONLY valid JSON matching the schema in the user prompt.`;
}

/** World-shape each paradigm maps to. Eight shapes:
 *  - populated-narrative — fiction OR non-fiction (events, agents, change)
 *  - rule-governed-narrative — simulation (events, but rules are load-bearing)
 *  - singular-thinker — essay (one author working an argument)
 *  - multi-thinker — panel (named cast, AI or human, contest-of-minds → synthesis)
 *  - reference-typology — atlas (entries / taxa, system-graph IS the work)
 *  - adversarial-contest — debate (2+ parties, zero-sum stakes, rules of engagement)
 *  - chronological-record — record (time-ordered log of events, variable velocity)
 *  - scenario — scenario (a real strategic moment modelled for play — actors, terrain,
 *    instruments, and operative dynamics reconstructed so the moment can be rehearsed) */
type ParadigmShape =
  | 'populated-narrative'
  | 'rule-governed-narrative'
  | 'singular-thinker'
  | 'multi-thinker'
  | 'reference-typology'
  | 'adversarial-contest'
  | 'chronological-record'
  | 'scenario';

const PARADIGM_SHAPE: Record<NarrativeParadigm, { shape: ParadigmShape; directive: string }> = {
  'fiction':      { shape: 'populated-narrative',      directive: 'REALITY POSTURE: invented. Populated scene-narrative — characters, places, and events are wholly authored; nothing needs to anchor to an external record. Fate (thread resolution) + World (character transformation) carry the weight; System provides the working rules of the imagined world. Match the register and setting the premise implies.' },
  'non-fiction':  { shape: 'populated-narrative',      directive: 'REALITY POSTURE: observed. Populated scene-narrative documenting what actually happened — every named person, place, event, and date anchored to the real record. Same form as fiction; the discipline is sourcing. Where the record has gaps, name the gap rather than fabricate. Fate + World carry the weight; System captures the institutions and patterns of the documented world.' },
  'simulation':   { shape: 'rule-governed-narrative',  directive: 'REALITY POSTURE: hybrid — sourceable rules acting on real or invented agents (Politburo decision rules, monsoon logistics, sect succession charter, electoral allocation, monetary-policy mechanism). Forward-time event modelling: System rules are LOAD-BEARING and drive what happens; scenes narrate what the rules force as conditions evolve. Threads close on rule-driven consequences, not authorial choice; recoveries are earned through initial-condition shifts or new positions inside the existing rules.' },
  'essay':        { shape: 'singular-thinker',         directive: 'REALITY POSTURE: observed evidence + named author. One anchor (the author — real, or a clearly-labelled invented persona) plus 1-3 transient interlocutors (cited theorists, primary-source authors the work engages or rebuts). The system-graph IS the argument substrate — propositions, mechanisms, evidence relations. Internal friction (considered-and-rejected readings, qualified commitments) substitutes for multi-voice disagreement. Threads track the argument-questions the author is pursuing.' },
  'panel':        { shape: 'multi-thinker',            directive: 'REALITY POSTURE: observed evidence + named cast. 2+ thinkers — AI agents (Atlas, Cipher, Nexus) OR human experts (Dr. Wen, Prof. Vasquez); pick one mode and commit. Cooperative-with-disagreement: the work IS the contest of minds reaching synthesis, with ≥1 devil\'s-advocate role and ≥1 adversarial pair. Scenes are COGNITIVE events over existing evidence (LLM knowledge + user source material), not invented forward-time events. The system-graph carries the argument; threads track the panel\'s shared question plus each member\'s sub-investigation.' },
  'atlas':        { shape: 'reference-typology',       directive: 'REALITY POSTURE: either — a real-world reference (a flora, an encyclopedia of jurisdictions, a doctrine corpus) or an invented codex (the sects of a secondary world). Form: a typology of entries replacing scenes; the curator orchestrates and specimens / categories / entities populate the work. System is everything — the typological structure IS the work, with dense cross-references between entries. Fate minimal (no dramatic resolution); World minimal (specimens don\'t transform). Threads, when present, track classification questions, not events.' },
  'debate':       { shape: 'adversarial-contest',      directive: 'REALITY POSTURE: either — a documented contest (trial, election, championship, M&A negotiation) or a hypothetical one (scripted moot, invented negotiation). Rules of engagement are typically sourceable even when contestants are invented. Two or more named parties locked in zero-sum stakes under explicit rules; each scene is a MOVE in the contest. Fate (who wins each axis) + System (rules of engagement) carry the weight; threads are AXES OF CONTESTATION whose outcomes favour one party or the other.' },
  'record':       { shape: 'chronological-record',     directive: 'REALITY POSTURE: either — a documented chronicle (Tacitus\'s Annals, a CEO\'s monthly report, Pepys\'s diary, a pandemic timeline) or an invented one (annals of a fictional kingdom, an imagined ship\'s log). Form: a TIME-ORDERED LOG of events in a chronicler\'s documentary voice; the ordering of time IS the structure. Each entry covers a moment or period. Pick a TIME VELOCITY — daily, monthly, yearly, or dynamic (granular during important periods, coarser during quiet stretches) — and respect it; velocity shifts ARE editorial signal. World (entities evolving over time) + System (institutions, patterns chronicled) carry the weight; Fate minimal — events happen, they don\'t structurally resolve. Threads are long-running trajectories tracked across entries.' },
  'scenario':     { shape: 'scenario',                 directive: 'REALITY POSTURE: a real strategic moment, modelled for play. A scenario reconstructs a KEY EVENT — historical or contemporary — worth modelling for the strategic dynamics in play at that instant (a crisis, a campaign, a negotiation, a market dislocation, a decisive turn). Model the load-bearing ACTORS (decision-makers and factions, each with its own goal, capabilities, constraints, and information), the LOCATIONS (the terrain the moment plays across), and the ARTIFACTS (the instruments that confer leverage). The system-graph captures the OPERATIVE DYNAMICS — the rules, pressures, and constraints that governed the moment. Threads are the LIVE STRATEGIC QUESTIONS it hangs on (what each actor is deciding, what could tip). POV is plural — each actor reasons from its own vantage; there is no single protagonist. The aim is a coherent, PLAYABLE model of reality that recreates the strategic dynamics for rehearsal — Meridians\' core demo form. Ground it in the real moment; where the record is thin, name the gap rather than invent.' },
};

// ── Per-paradigm prompt blocks ───────────────────────────────────────────────
// When the user picks a register in the wizard, ONLY the matching block is
// injected into the prompt — the other paradigms are dropped at build time.
// When the user leaves register unset, the full inference-mode block is used
// (model detects register from the premise).

const PARADIGM_POPULATED_NARRATIVE = `<populated-narrative-shape critical="true" hint="Fiction OR non-fiction — populated by named HUMAN (or in-world species) characters, places, and physical artifacts. Fate (thread resolution) and World (character transformation) carry the force weight.">
  <intent>The world is populated. Apply the full populated minimums (characters ≥8, locations ≥6, relationships ≥8, artifacts ≥1, threads ≥4, system-nodes ≥12). Fiction populates invented people; non-fiction populates real authors / subjects / witnesses. Same scene-shape — sourcing discipline differs (invented vs. documented record).</intent>
  <invariant>Use plausibly-human first/last names matching the setting the premise implies — no AI-coded single-word names; those belong only in the panel paradigm when the cast is AI agents.</invariant>
</populated-narrative-shape>`;

const PARADIGM_RULE_GOVERNED = `<rule-governed-narrative-shape critical="true" hint="Simulation shape — populated like fiction/non-fiction, but the SYSTEM force is load-bearing: rules drive what happens, not character agency. Counterfactuals, wargames, agent-based models, cultivation, LitRPG, policy modelling.">
  <intent>In-world figures the rules ACT ON (Khrushchev under Politburo decision rules; Yi under monsoon + tribute-grain logistics; a cultivator under sect succession charter + qi-reservoir mechanics; a candidate under electoral-system rules). Apply the populated minimums BUT the system-graph carries disproportionate weight — system-nodes ≥20 with ≥12 edges, encoding the rule set as a real machine.</intent>
  <discipline>
    <rule name="rules-load-bearing">Threads close on RULE-DRIVEN consequences, not authorial choice. When the rules force a state, the work delivers it — even when "the protagonist" would conventionally prevail. Recoveries must be earned by initial-condition shifts, rule changes, or agents finding new positions inside the existing rules.</rule>
    <rule name="forward-time">Scenes narrate what HAPPENS to the modelled world as the rules act over time. Forward-time event modelling IS the point — distinct from a Panel (which interprets present evidence) or a Debate (which is two-sided combat under contest rules).</rule>
    <rule name="diegetic-overlay">When rules surface as a HUD / log / status sheet / tier gate, those overlays are real to the characters (a cultivator literally sees their qi tier; a wargame general literally reads a turn report). NOT a meta-observer running the simulation from outside.</rule>
  </discipline>
  <invariant>Use plausibly-human first/last names matching the setting the premise implies — Khrushchev, Yi, Dara Shukoh, an in-world cultivator with a sect-style name. No AI-coded single-word names.</invariant>
  <example category="good" flavour="wargame">The thirteen days of October 1962 from Khrushchev's chair: SS-4 deployment as initial state, Politburo decision rules as the constraint set, the moment-by-moment turn where the alternative was always still on the table.</example>
  <example category="good" flavour="cultivation">The Iron Cloud Sect's hereditary qi-reservoir has thinned a generation faster than doctrine permits; the next tier-crossing falls in spring, the elders are split three ways, and the founder's charter does not say what happens when the reservoir refuses an ascendant.</example>
</rule-governed-narrative-shape>`;

const PARADIGM_SINGULAR_THINKER = `<singular-thinker-pattern critical="true" hint="Essay shape — ONE named author works through the argument. Populate sparsely. The author's mind IS the world.">
  <required-roles>
    <role kind="author" mapping="anchor">The named thinker whose voice the work IS. Continuity carries their thesis, methodology, prior commitments, blind spots, the priors the argument moves through.</role>
    <role kind="interlocutor" mapping="transient">Cited theorist, named reviewer, primary-source author the work engages with directly. 1-3 typical; each carries a specific position the author engages or rebuts.</role>
  </required-roles>
  <discipline>
    <rule>Internal friction substitutes for team disagreement: the author considers and rejects alternative readings, engages cited positions, qualifies earlier commitments. Threads track the author's argument-questions, not external team goals.</rule>
    <rule>Relationships (when present) are intellectual lineages — mentor / inheritance / rebuttal / extension. Hostile is rare unless the author engages an adversarial position.</rule>
    <rule>The author's anchor world-graph is densest at belief / history (argument-trajectory, prior commitments) and goal (the thesis being arrived at).</rule>
    <rule>The system-graph IS the argument substrate — propositions, mechanisms, evidence relations, predictions, claims, counter-positions. System-nodes ≥20 with ≥12 edges.</rule>
  </discipline>
  <stance-flavours hint="Optional sub-shapes within essay; the prose register adapts but the world-shape stays the same.">
    <flavour name="research-finding">Dr. Wen presents an empirical claim with methods + evidence + a testable prediction. Closer to a formal paper in tone.</flavour>
    <flavour name="exploratory">A personal-critical essay working an idea — Joan Didion, Annie Dillard, the working-it-out register.</flavour>
    <flavour name="prescriptive">A manifesto / polemic — the author argues for a corrective; threads track commitments demanded of the reader.</flavour>
  </stance-flavours>
  <example category="good" stance="research-finding">A solo paper on Song iron-coin abandonment: Dr. Wen (anchor) traces the regional smelter-output data; engages two cited interlocutors — Smith (the prior consensus rebutted) and Park (whose methods the paper extends). Argument-thread: does the garrison-reduction prediction hold district-by-district?</example>
  <example category="good" stance="exploratory">A personal essay on Bengali typography: the named author (anchor) traces three generations of typesetters in her own family; engages one cited interlocutor (the historian whose claim about Unicode the essay nuances). Argument-thread: what did each technology silently mistranslate?</example>
</singular-thinker-pattern>`;

const PARADIGM_MULTI_THINKER = `<multi-thinker-pattern critical="true" hint="Panel shape — a named cast of 2+ thinkers (AI agents OR human experts) pursuing a shared question. Cooperative-with-disagreement: the work IS the contest of minds becoming a synthesis. Distinct from Debate (zero-sum adversarial) — a panel collaborates AT disagreement, a debate fights TO win.">
  <cast-mode critical="true" hint="The premise dictates which mode; pick one and commit to it consistently across the work.">
    <mode kind="agentic-ai">A virtual team of AI agents — memorable single-word AI-coded names. Best for analytical teams the user can invoke across future passes ("next pass, have Vanguard challenge Atlas's read on X"). Naming palettes: mythological (Atlas, Oracle, Athena, Janus, Argus), cosmological / structural (Nexus, Vector, Pulse, Orbit, Quasar, Compass, Helix), heraldic / signal (Vanguard, Sentinel, Beacon, Herald, Aegis), tools / instruments (Cipher, Quill, Forge, Lens, Anvil, Loom), archetypes (Sage, Scribe, Critic, Augur, Tribune, Curator). Avoid generic words (Data, Model, Agent).</mode>
    <mode kind="human-panel">A named cast of human experts — plausibly-human first / last names (Dr. Wen, Prof. Vasquez, Tariq Chen, Annika Solberg). Best for Davos-style panels, podcast roundtables, expert councils, advisory boards, research teams of named people. Naming follows populated-narrative discipline.</mode>
    <invariant>Never mix the two modes in one cast — a panel is all-AI OR all-human, not a hybrid.</invariant>
  </cast-mode>

  <archetypes hint="Pick the archetype matching the panel's goal.">
    <archetype name="research lab">synthesiser + specialists + methods/data + external reviewer. Goal: produce a finding.</archetype>
    <archetype name="macro / strategy team">synthesiser + sector specialists + quant + executor + risk-officer. Goal: build a thesis and act on it.</archetype>
    <archetype name="investigation crew">lead + forensics/methods + analyst + named-source channels. Goal: build the case.</archetype>
    <archetype name="think tank / editorial">director + analysts + critic + external interlocutor. Goal: produce recommendations or the work itself.</archetype>
    <archetype name="advisory panel / roundtable">facilitator + named experts + dissenter + external interlocutor. Goal: deliver a recommendation through deliberation.</archetype>
  </archetypes>

  <required-roles hint="Map each to anchor / recurring / transient. The roles hold regardless of cast-mode.">
    <role kind="synthesiser / facilitator" mapping="anchor">Commits the panel to a direction; integrates other members' findings.</role>
    <role kind="specialist" mapping="anchor / recurring">Domain expert per sub-question.</role>
    <role kind="devil's advocate / dissenter" mapping="anchor / recurring" critical="true">EXPLICITLY challenges the consensus. Without this role the panel is an echo chamber — ≥1 member MUST hold it.</role>
    <role kind="methods / data" mapping="recurring">Brings evidence, runs the model, cross-references sources.</role>
    <role kind="source / external" mapping="transient">External party feeding intelligence or forcing a thesis update.</role>
  </required-roles>

  <continuity-discipline>
    <rule>Each panel member's world graph encodes role-coded nodes: capability, belief (methodological priors), history (prior commitments / completed work), weakness (blind spot), goal.</rule>
    <rule>≥1 adversarial pair baked in (methodological dispute, recency-vs-historical bias, breadth-vs-depth). Disagreement gives narrative tension without inventing fictional drama.</rule>
    <rule>The panel's collective objective is a constant-tension thread ("does the thesis hold?"). Sub-questions become discrete-resolution threads, one per member's focus.</rule>
  </continuity-discipline>

  <evidence-discipline critical="true" hint="A panel works with EXISTING evidence — LLM knowledge + user's source material. Scenes are cognitive events over that evidence, not invented forward-time events. (If the work is supposed to model events forward under rules, the user should have picked SIMULATION.)">
    <forbidden>
      <rule>No forward-time narration as if freshly observed ("three days later, the PLA conducted an exercise"). The only time-progression in panel scenes is COGNITIVE (next meeting / next model run) — not external events.</rule>
      <rule>No fabricated intelligence ("Argus intercepted comms"; "Xi privately told Trump"). Use publicly known evidence + user's source material — not invented covert sources.</rule>
      <rule>No specific numbers presented as freshly observed unless from the source material or well-attested in LLM knowledge. Mark anything else as a model output or scenario assumption.</rule>
    </forbidden>
    <permitted>
      <rule>Scenarios as explicit hypotheticals ("the panel models the case where X — under that scenario, conviction drops 12 points"). Reasoning over possible worlds, not narrating that they arrived.</rule>
      <rule>Re-interpretation of evidence on the table; model recalibration with adjusted priors; dissenter challenges to readings — friction from competing READINGS of the SAME evidence.</rule>
      <rule>Name evidence gaps honestly when the panel lacks data. Don't paper over with invented numbers.</rule>
    </permitted>
    <test>If "in the scene, X happened" can be replaced with "the panel imagined a scenario where X would happen" without loss, the scene is panel-shaped. If X must be a real new event, you've drifted into simulation — switch paradigms.</test>
  </evidence-discipline>

  <example category="good" mode="agentic-ai" archetype="macro-team">
    Real World Investment Thesis. Cast: Atlas (synthesiser), Cipher (geopolitical analyst), Nexus (model runner), Vanguard (devil's advocate), Beacon (sector specialist), Quill (open-source intelligence). Goal-thread: does the panel's macro thesis outperform consensus over twelve months? Scene shape: re-read user's source material, run the engine over varying priors, challenge each sub-thesis adversarially, synthesise.
  </example>
  <example category="good" mode="human-panel" archetype="advisory">
    Pandemic-response advisory panel: Dr. Aiyana Webb (facilitator, public-health policy), Prof. Tariq Chen (epidemiology), Dr. Lena Sokolov (economics, dissenter), Yusuf Bashir (operations / supply-chain), Margarethe Voss (legal). Goal-thread: does the recommended NPI bundle hold up under the model's adjusted priors? Scene shape: panel meetings deliberating evidence packets — no invented case data, only re-readings of what the brief contains.
  </example>
</multi-thinker-pattern>`;

const PARADIGM_REFERENCE_TYPOLOGY = `<reference-typology-shape critical="true" hint="Atlas shape — a field guide, codex, encyclopedia, doctrine, taxonomy. NOT scene-driven. The system-graph IS the work. Forces: System dominant; Fate minimal (entries don't 'resolve'); World minimal (specimens don't transform).">
  <intent>The work classifies, names, and structures a domain. Entries (specimens, taxa, principles, doctrines) replace scenes. The system-graph carries everything — relationships between entries, hierarchical classification, cross-references, mechanism couplings. System-nodes ≥30, edges ≥20.</intent>
  <required-roles>
    <role kind="curator" mapping="anchor">The named author(s) or institution that orchestrates the typology. May be a single curator, an editorial board, or an institutional voice — the curator's authority shapes the taxonomy's structure.</role>
    <role kind="specimen / entry" mapping="recurring or transient">The individual items being classified — species in a flora, doctrines in a codex, concepts in a reference work, terms in a glossary. Each gets a world-node block of stable facts.</role>
  </required-roles>
  <discipline>
    <rule name="entries-not-scenes">A "scene" in Atlas paradigm is an ENTRY — a specimen description, a doctrine articulation, a category definition. It has structure (classification facts, attributes, relations) not events.</rule>
    <rule name="no-resolution-threads">Threads are minimal and don't close in the narrative sense. When present, they track CLASSIFICATION questions ("does X belong in family Y?") that resolve through the typology's internal logic, not through events.</rule>
    <rule name="system-graph-is-the-work">The relationships BETWEEN entries — what extends what, what depends on what, what supersedes what — IS the substance. Build it densely; cross-reference aggressively.</rule>
    <rule name="curator-discipline">The curator's voice is consistent and authoritative. Avoid biographical entries where the curator becomes a character; their role is structural, not narrative.</rule>
  </discipline>
  <example category="good" flavour="field-guide">A guide to the cultivators of the Eastern Sects. Curator: the Inquiry Hall (institutional voice). Entries: 14 major sects, ranked by tier-doctrine + practitioner-density. System-graph: succession charters, qi-reservoir capacities, tier-crossing rituals, doctrinal compatibilities. No threads, no events.</example>
  <example category="good" flavour="doctrine">A central bank's monetary doctrine. Curator: the Bank's policy committee (institutional voice). Entries: 22 named instruments (rate-policy, balance-sheet, forward-guidance, FX, macroprudential), each with operating principles + activation conditions + interaction rules. System-graph: instrument interactions, triggering conditions, sequencing constraints.</example>
</reference-typology-shape>`;

const PARADIGM_ADVERSARIAL_CONTEST = `<adversarial-contest-shape critical="true" hint="Debate shape — two or more named parties locked in zero-sum stakes under explicit rules. A trial, a campaign, a championship, an M&A negotiation, a structured debate. The work IS the contest. Forces: Fate (who wins) + System (rules of engagement); World tracks each party's shifting capacity / posture.">
  <intent>The structure is adversarial-by-design — parties have OPPOSING goals, the work resolves one way or the other (binary, graded, or split-decision). Each scene is a MOVE in the contest; threads track each AXIS OF CONTESTATION; world deltas track each party's shifting capacity.</intent>
  <required-roles>
    <role kind="contestant" mapping="anchor" critical="true">Each named party in the contest is an anchor — 2+ required. Each carries a goal, a capacity, a strategy, a vulnerability. Their world-graphs evolve as the contest progresses.</role>
    <role kind="arbiter" mapping="anchor or recurring">Judge, referee, electorate, market, panel, audience — whatever determines the outcome under the rules. May be a single named figure or a collective body. The arbiter is NOT a contestant.</role>
    <role kind="counsel / support" mapping="recurring or transient">Each contestant's team — advisors, witnesses, analysts, seconds. May be present or implied.</role>
  </required-roles>
  <discipline>
    <rule name="zero-sum-stakes">The contest has explicit win conditions. When one party advances on an axis, the other retreats (or holds). Threads are axes of contestation ("will the prosecution prove intent?"; "will the merger close on the original terms?"; "will candidate X carry the swing states?") — each thread's outcome favours one party or the other.</rule>
    <rule name="rules-of-engagement">The system-graph captures the contest's RULES — procedural, evidentiary, temporal, jurisdictional. These rules are load-bearing: they determine what moves are available, what counts as a win, what triggers a verdict. System-nodes ≥15.</rule>
    <rule name="moves-not-narration">Each scene is a MOVE — a witness called, an exchange in cross-examination, a campaign ad, a debate response, a bid raised, a counter-offer tabled. Moves have attribution (which party made the move), intent (what axis it targets), and effect (how the rules + arbiter scored it).</rule>
    <rule name="resolution-condition">The contest closes through the rules' mechanism — a verdict, a vote tally, a decision, a signed deal, a championship belt. Threads close on the contest's own logic; the arbiter's call is canon.</rule>
  </discipline>
  <example category="good" flavour="legal">A criminal trial: Prosecution (anchor — DA Carla Mendoza), Defense (anchor — defense counsel Anand Krishnan), Judge Brennan (arbiter, anchor), witnesses + experts (transient). Rules: the jurisdiction's criminal procedure code, evidence law, sentencing guidelines. Threads: each charge ("will premeditation hold?", "will the corroboration survive cross?"). Scenes: opening statements, direct, cross, motions, closing, deliberations, verdict.</example>
  <example category="good" flavour="m-and-a">A hostile acquisition: Acquirer (anchor — CEO Reuben Holt), Target (anchor — chairman Mei Lin), Board of the Target (arbiter, anchor collective), institutional shareholders (recurring), antitrust regulator (transient). Rules: governing-law shareholder vote thresholds, antitrust review, fiduciary-duty constraints. Threads: each axis ("will the price clear the fairness opinion?", "will antitrust approve?"). Scenes: bids, counter-bids, poison-pill activations, board votes, regulatory filings.</example>
  <example category="good" flavour="electoral">A presidential campaign in its final 60 days: two named major-party candidates (anchors), the electorate (arbiter, collective), running mates + campaign managers (recurring), pollsters + journalists (transient). Rules: state-by-state electoral allocation, debate-commission schedule, FEC limits. Threads: each axis ("will candidate X carry the Rust Belt?", "will the debate move undecideds?"). Scenes: rallies, debates, ad releases, scandals breaking, election night.</example>
</adversarial-contest-shape>`;

const PARADIGM_CHRONOLOGICAL_RECORD = `<chronological-record-shape critical="true" hint="Record shape — a time-ordered LOG of events, real or imagined. The ordering of time IS the structure. Entries replace scenes. Forces: World (entities/states evolve over time) + System (institutions, rules, patterns chronicled); Fate minimal (events happen, they don't structurally 'resolve').">
  <intent>The work is a CHRONICLE — a chronological log of events, granular at whatever velocity the premise calls for. Each "scene" is an ENTRY: a moment in time (or period), with what happened and what changed. The reader walks the timeline; the structure is the sequence, not arc or argument.</intent>

  <time-velocity critical="true" hint="The velocity of the chronicle — how dense the entries are in time. Pick from the premise, default to dynamic when unclear.">
    <option name="daily">A daily log: one entry per day. Best for short windows of high activity — a thirteen-day crisis, a campaign's final week, a research expedition's voyage, a hospital course of treatment, a diary kept across a season. Time-velocity field on each entry: a date (2023-10-14).</option>
    <option name="monthly">One entry per month. Best for medium-span chronicles — a fiscal year's board meetings, a year-long policy rollout, a season-by-season military campaign, a monthly journal across years. Time-velocity field: a month + year (Oct 2023).</option>
    <option name="yearly">One entry per year — annals. Best for long-span chronicles — dynastic histories, a regiment's hundred-year record, a city's reign-by-reign chronicle, a research lab's decade-by-decade output. Time-velocity field: a year.</option>
    <option name="dynamic" critical="true">VARIABLE velocity — granular detail during important periods, coarser during quiet stretches. A year-by-year chronicle that drops to day-by-day during the rebellion, then back. A decade-by-decade history that zooms to month-by-month during the founding. This is often the strongest mode — it lets the chronicler give weight to what matters without padding the rest. Time-velocity field: explicit per entry (a date, a month, a year, or a range).</option>
  </time-velocity>

  <required-roles>
    <role kind="chronicler" mapping="anchor">The named voice (or institutional voice) recording the chronicle. May be a single diarist (Pepys, Boswell), an annalist (Tacitus), an editorial body (a monastic scriptorium), or an institution (a ship's logbook, a hospital chart). The chronicler's perspective shapes WHAT counts as an entry.</role>
    <role kind="subject" mapping="anchor or recurring">The entity / entities / institution whose history is being chronicled — a kingdom, a person's life, a research lab, a vessel, a war, a market. The subject evolves entry-by-entry; the chronicler logs the evolution.</role>
    <role kind="figure" mapping="recurring or transient">Named people, institutions, places that appear in entries. Each gets a stable-fact world-node block; relationships and state changes are recorded as world deltas at the entries they appear in.</role>
  </required-roles>

  <discipline>
    <rule name="entries-are-time-stamped" critical="true">Every entry's summary leads with a TIME marker matching the chosen velocity (a date, a month-year, a year, or a range). The time IS structurally load-bearing — entries are not just ordered, they're DATED.</rule>
    <rule name="what-changed-not-arc">An entry records WHAT HAPPENED and WHAT CHANGED in this time-step. World deltas track entity state evolution; system deltas track rule / institution / pattern changes. There is no scene-level "fate stance" — events happen, the chronicler logs them.</rule>
    <rule name="threads-are-trajectories">Threads in Record are LONG-RUNNING TRAJECTORIES tracked across entries — a war's progression, a market's trend, a person's career arc, a doctrine's evolution. They accumulate evidence over many entries; they don't "close" with a payoff in the dramatic sense, though their state can reach a terminal point (war ends, person dies, doctrine is replaced).</rule>
    <rule name="chronicler-voice">The chronicler records — they do not editorialise heavily. The voice is documentary, not argumentative (if you want argument, pick ESSAY). Quotes are quoted, not invented; gaps in the record are named.</rule>
    <rule name="velocity-coherence">Once the velocity is chosen, entries respect it. A daily chronicle does not skip days silently (mark gaps); a yearly chronicle does not detour into a single afternoon's hour-by-hour (that's a flag to switch to dynamic velocity). When dynamic, the velocity shifts ARE the editorial signal — readers learn to read density as importance.</rule>
  </discipline>

  <example category="good" flavour="daily-diary" velocity="daily">Pepys's London diary, 1665–1666: daily entries tracking the plague and the fire. Chronicler: Samuel Pepys (anchor). Subjects: the city (anchor, evolving state), the Navy Office (recurring), Charles II (recurring), Pepys's household (recurring). Threads: "the plague's progression", "the rebuilding of London", "Pepys's standing at court". Entries: dated, each logging what happened that day + what changed.</example>
  <example category="good" flavour="annals" velocity="yearly">A reign-by-reign chronicle of an invented kingdom of Vael, 0–273 V.E. Chronicler: the Cloister Annalists (institutional voice, anchor). Subjects: the royal house (anchor), the Six Provinces (recurring), the Cloister Order (recurring). Threads: "the succession crisis cycle", "the southern provinces' tax revolts", "the spread of the Reformist creed". Entries: one per year, leading with the year + ruler.</example>
  <example category="good" flavour="dynamic" velocity="dynamic">A pandemic chronicle, 2019–2024. Chronicler: a public-health archivist (anchor). Velocity: yearly for 2019 (pre-emergence) and 2024 (recovery); monthly for most of 2020–2023; day-by-day for the Wuhan-emergence window and the vaccine-rollout window. Threads: "case-count trajectory by region", "policy-response gradient", "vaccine-development timeline", "long-COVID research progression". Entries: each dated at the velocity active for that period; the velocity SHIFTS themselves are editorial signal.</example>
  <example category="good" flavour="ship-log" velocity="daily">An invented exploration vessel's log across an 18-month expedition. Chronicler: the captain (anchor) + the ship's surgeon-naturalist (recurring co-chronicler). Subjects: the vessel (anchor), the crew (recurring), waypoints (recurring), specimens collected (transient). Threads: "the southern-passage attempt", "the crew's health", "the natural-history catalogue". Entries: daily, leading with date + coordinates + weather.</example>
</chronological-record-shape>`;

const PARADIGM_SCENARIO = `<scenario-shape critical="true" hint="Scenario — a real strategic moment (historical or contemporary) modelled for play. Reconstruct the actors, terrain, and instruments of a key event so its strategic dynamics can be rehearsed. The system-graph is the operative dynamics; world tracks each actor's position; threads are the live strategic questions. Forces: System (the dynamics in play) + Fate (how the stakes tip) carry the weight; World tracks each actor's shifting hand. This is Meridians' core demo form.">
  <intent>Model a KEY EVENT worth recreating for the strategy in play at that instant — a crisis, a campaign, a negotiation, a market dislocation, a decisive turn. The aim is a coherent, PLAYABLE model of reality: a board the actors can be run on, again and again, to rehearse how the moment could go. Ground it in the real moment; where the record is thin, name the gap rather than invent.</intent>

  <model-the-pieces>
    <actors>The decision-makers and factions in play — each a full agent with its own GOAL (what it's after), CAPABILITIES and RESOURCES (what it can bring to bear), CONSTRAINTS (what binds it), and INFORMATION (what it knows vs. doesn't, and what it misreads). They reason from their own vantage; their world-graphs carry their private read of the moment.</actors>
    <locations>The terrain the moment plays across — theatres, capitals, chokepoints, the rooms where decisions land. Position is leverage: who holds what shapes what's possible.</locations>
    <artifacts>The instruments that confer leverage — weapons, documents, treaties, assets, channels, intelligence. Each is a lever some actor commands.</artifacts>
  </model-the-pieces>

  <discipline>
    <rule name="dynamics-as-system" critical="true">The system-graph captures the OPERATIVE DYNAMICS of the moment — the rules, pressures, constraints, and couplings that governed it (escalation ladders, alliance commitments, supply limits, deadlines, market microstructure). These make the model cohere and are what a rehearsal reasons over.</rule>
    <rule name="stakes-as-threads">Threads are the LIVE STRATEGIC QUESTIONS the moment hangs on — what each actor is deciding, what could tip ("are the missiles withdrawn?", "does the front hold?", "does the deal clear?"). Their outcomes enumerate the ways the moment could resolve.</rule>
    <rule name="plural-vantage">No single protagonist. Each actor reasons from its own information set; alliances and oppositions are relationships, not one collapsed voice. POV moves between actors.</rule>
    <rule name="playable">The model exists to be PLAYED — keep it coherent enough that the actors can be run forward from the modelled state. Every piece should pull weight in the strategic dynamics; texture that shapes no decision is noise.</rule>
  </discipline>

  <example category="good" flavour="crisis">Cuban Missile Crisis, October 1962. Actors: Soviet Politburo (Khrushchev, Mikoyan, Malinovsky — goal: trade the missiles for a Berlin/Turkey concession without war; constrained by sea-lift exposure), US ExComm (Kennedy, McNamara, Rusk — goal: remove the missiles without escalation; constrained by hawk pressure and the clock), Cuban Government (narrower hand, exposed terrain). Locations: the quarantine line, Berlin, the Jupiter sites in Turkey. Artifacts: the missiles, the U-2 imagery, the back-channel. Dynamics (system): the escalation ladder, the 13-day clock, asymmetric intelligence. Stakes (threads): "are the missiles withdrawn?", "is Berlin held?", "does the quarantine hold without a shot?".</example>

  <example category="good" flavour="campaign">A pivotal campaign turn — say a contested river crossing. Actors: the advancing command and the defending command (each with forces, supply state, doctrine, and what their reconnaissance shows), the political seat that can release reserves. Locations: the crossing, the rail head, the flank towns. Artifacts: the bridging train, the intercepted order, the reserve divisions. Dynamics: supply-line stress, the weather window, the chain-of-command lag. Stakes: "is the crossing forced before the thaw?", "do the reserves arrive in time?", "does the flank hold?".</example>

  <example category="good" flavour="market">A sovereign-bond liquidity crunch across a tense week. Actors: primary dealers (size, inventory, balance-sheet limits), the central bank (sets the rate, can open repo), institutional buyers. Locations: the auction, the repo desk. Artifacts: the balance sheets, the facility terms, the public prints. Dynamics: market microstructure, the intervention triggers, end-of-session marks. Stakes: "does the auction clear?", "does the bank intervene?", "which dealer eats the losses?".</example>
</scenario-shape>`;

/** Emits ONLY the matching paradigm block — the other paradigms are dropped at
 *  build time so the model gets a single, focused, deterministic standard. */
function paradigmBlockFor(paradigm: NarrativeParadigm): string {
  switch (PARADIGM_SHAPE[paradigm].shape) {
    case 'populated-narrative':     return PARADIGM_POPULATED_NARRATIVE;
    case 'rule-governed-narrative': return PARADIGM_RULE_GOVERNED;
    case 'singular-thinker':        return PARADIGM_SINGULAR_THINKER;
    case 'multi-thinker':           return PARADIGM_MULTI_THINKER;
    case 'reference-typology':      return PARADIGM_REFERENCE_TYPOLOGY;
    case 'adversarial-contest':     return PARADIGM_ADVERSARIAL_CONTEST;
    case 'chronological-record':    return PARADIGM_CHRONOLOGICAL_RECORD;
    case 'scenario':                return PARADIGM_SCENARIO;
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
  /** Scenes in the opening arc. Set by the wizard slider; ignored when
   *  `worldOnly` is true. Bounded 2–8 at the call site. */
  sceneCount: number;
  /** Force reference means + bands — the calibrated RICHNESS BAR a high-quality
   *  opening reaches, surfaced in the prompt as an aspirational reference, not a
   *  quota to hit. From FORCE_REFERENCE_MEANS / FORCE_BANDS. */
  forceReferenceMeansWorld: number;
  forceReferenceMeansSystem: number;
  worldTypicalBand: string;
  worldClimaxBand: string;
  systemTypicalBand: string;
  systemClimaxBand: string;
};

/** Output schema for generateNarrative — exact JSON shape the model must
 *  emit. Exported so the LLM-assisted repair path can reuse the same
 *  schema spec instead of a drift-prone hand-written copy. Single source
 *  of truth for both generation and repair. */
export function buildNarrativeOutputSchema(args: { worldOnly: boolean }): string {
  const { worldOnly } = args;
  return `{
  "worldSummary": "2-3 sentence world description",
  "worldBuildSummary": "1-2 sentences (≤ 40 words). Plain prose. State the INTENT of this initial world commit — what creative space it opens, what tension it primes, which load-bearing entities, factions, or rules it brings into play. Used downstream to steer arc generation when this commit is read as <world-build-focus>, so name the load-bearing additions, not counts.",
  "genre": "Primary genre WITHIN the chosen paradigm — e.g. for fiction: fantasy, sci-fi, thriller, romance, horror, mystery, literary; for non-fiction: biography, history, memoir, reportage; for simulation: counterfactual, wargame, policy modelling, cultivation; for essay: empirical, theoretical, personal, critical, polemical; for panel: macro-strategy, investigation, multi-agent reasoning, advisory; for atlas: field guide, codex, doctrine, encyclopedia; for debate: trial, election, championship, M&A; for record: diary, annals, ship's log, board minutes, hospital chart, pandemic chronicle.",
  "subgenre": "Specific sub-form within the genre.",
  "imageStyle": "A concise visual style directive for all generated images.",
  "characters": [
    {"id": "C-1", "name": "Full name", "role": "anchor|recurring|transient", "threadIds": ["T-1"], "imagePrompt": "1-2 sentence LITERAL physical description.", "world": {"nodes": [{"id": "K-1", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense"}]}}
  ],
  "locations": [
    {"id": "L-1", "name": "Location name", "prominence": "domain|place|margin", "parentId": null, "threadIds": [], "imagePrompt": "1-2 sentence LITERAL visual description.", "world": {"nodes": [{"id": "LK-1", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense"}]}}
  ],
  "threads": [
    {"id": "T-1", "participants": [{"id": "C-1", "type": "character|location|artifact"}], "description": "Frame as a QUESTION: 15-30 words", "outcomes": ["Named possibilities. Binary default: ['yes','no']. 2–6 distinct, mutually exclusive entries."], "horizon": "short | medium | long | epic", "openedAt": "S-1", "dependents": []}
  ],
  "relationshipDeltas": [
    {"from": "C-1", "to": "C-2", "type": "short relation label", "valenceDelta": 0.5}
  ],
  "artifacts": [
    {"id": "A-1", "name": "Artifact name", "significance": "key|notable|minor", "threadIds": [], "parentId": "character or location ID, or null", "world": {"nodes": [{"id": "AK-1", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense"}]}, "imagePrompt": "1-2 sentence LITERAL visual description"}
  ],${worldOnly ? `
  "systemDeltas": {"addedNodes": [{"id": "SYS-1", "concept": "15-25 words, PRESENT tense", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "SYS-1", "to": "SYS-2", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]},
  "attributions": ["C-1", "L-1", "T-1", "SYS-1"],
  "attributionEdges": [{"from": "C-1", "to": "SYS-1", "relation": "requires|enables|constrains|risks|causes|reveals|develops|resolves|supersedes"}],` : `
  "scenes": [
    {
      "id": "S-1",
      "arcId": "ARC-1",
      "locationId": "L-1 — existing location ID, OR null when no locations are populated",
      "povId": "C-1 — viewpoint entity ID, OR null for omniscient / analytical / voice-of-nobody scenes",
      "participantIds": ["C-1 — may be empty array for analysis / paper scenes"],
      "summary": "REQUIRED. The spine of the scene; every delta below must trace back to something stated here. Prose in NAMES not IDs. Length adapts: 3-6 sentences for routine scenes; expand WITHOUT UPPER BOUND for cognition-dense scenes.",
      "timeDelta": {"value": 1, "unit": "hour"},
      "artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX", "usage": "what the artifact did"}],
      "events": ["event_tag"],
      "threadDeltas": [{"threadId": "T-1", "logType": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "updates": [{"outcome": "outcome name from thread.outcomes", "evidence": 1.5}], "volumeDelta": 1, "addOutcomes": ["optional"], "rationale": "10-20 words, prose only"}],
      "worldDeltas": [{"entityId": "C-XX", "addedNodes": [{"id": "K-GEN-1", "content": "15-25 words, PRESENT tense", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
      "relationshipDeltas": [],
      "systemDeltas": {"addedNodes": [{"id": "SYS-GEN-1", "concept": "15-25 words, PRESENT tense", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "SYS-GEN-1", "to": "SYS-GEN-2", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]},
      "attributions": ["C-1", "L-1", "T-1", "SYS-1"],
      "attributionEdges": [{"from": "C-1", "to": "SYS-1", "relation": "requires|enables|constrains|risks|causes|reveals|develops|resolves|supersedes"}]
    }
  ],
  "arcs": [
    {"id": "ARC-1", "name": "Arc name", "sceneIds": ["S-1"], "develops": ["T-1"], "locationIds": ["L-1"], "activeCharacterIds": ["C-1"], "directionVector": "Forward-looking intent", "worldState": "Backward-looking compact state snapshot as of END of arc"}
  ],`}
  "proseProfile": {
    "register": "the tonal register (conversational/literary/raw/clinical/sardonic/lyrical/mythic/journalistic or other)",
    "stance": "narrative stance (close_third/intimate_first_person/omniscient_ironic/detached_observer/unreliable_first or other)",
    "tense": "past or present",
    "sentenceRhythm": "terse/varied/flowing/staccato/periodic or other",
    "interiority": "surface/moderate/deep/embedded; analytical/evidentiary for non-fiction; state-tracked for simulation",
    "dialogueWeight": "sparse/moderate/heavy/almost_none",
    "devices": ["2-4 literary devices"],
    "rules": ["3-6 SPECIFIC prose rules as imperatives"],
    "antiPatterns": ["3-5 SPECIFIC prose failures to avoid"]
  },
  "planGuidance": "2-4 sentences of specific guidance for scene beat plans.",
  "patterns": ["3-5 positive thematic commandments derived from THIS narrative's REGISTER and GENRE."],
  "antiPatterns": ["3-5 negative commandments — common pitfalls in THIS register/genre to avoid."]
}`;
}

export function buildGenerateNarrativePrompt(args: GenerateNarrativeArgs): string {
  const {
    title,
    premise,
    sourceText,
    worldOnly,
    paradigm,
    sceneCount,
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
${paradigmDirectiveBlock}  <task hint="${worldOnly ? 'World-only mode — output entities, no scenes or arcs.' : `Full mode — entities + ${sceneCount}-scene opening arc + prose profile.`}">${worldOnly
    ? 'Extract and build a complete narrative world from the following plan. Do NOT generate scenes or arcs — output world entities only (characters, locations, threads, relationships, artifacts, rules, systems, prose profile).'
    : 'Create a complete narrative world.'}</task>
  <title>${title}</title>
  <${worldOnly ? 'narrative-plan' : 'premise'}>${premise}</${worldOnly ? 'narrative-plan' : 'premise'}>
${sourceMaterialBlock}</inputs>

<output-format>
Return JSON with this exact structure:
${buildNarrativeOutputSchema({ worldOnly })}
</output-format>

<rules name="opening-arc" hint="Establish a tight, focused world. Stand on the extraction principle: each entry carries at least one real fact, further entries must be core knowledge (not noise), and richer material yields more entries. The paradigm block above already carries the world's natural SHAPE — populate to it, no count quota. Paradigm is fixed by the user's selection (or inferred when omitted).">
  ${paradigmBlockFor(paradigm)}

  <system-examples hint="What good foundational system-nodes (rules / dynamics) look like across paradigms.">
    <example category="bad" reason="too-short">Tribunal</example>
    <example category="good" register="fiction" flavour="fantasy">A house's right to bind rain to its lands lapses if the founding water-compact goes three generations without a renewing oath; lapsed lands return to common drought rotation under the regent's ledger.</example>
    <example category="good" register="fiction" flavour="cultivation">A disciple ascends a tier only when the sect elder witnesses a tribulation crossing AND the qi-reservoir admits the new draw; reservoir capacity binds the sect to a fixed succession rate.</example>
    <example category="good" register="fiction" flavour="sci-fi">A colony's memory-scent inheritance passes only along confirmed matrilineal lines registered at the genome archive; off-register children carry the chemistry but no inheritance rights, and the archive can be edited only by quorum.</example>
    <example category="good" register="scenario" flavour="crisis">A border raid escalates to open conflict only when the cumulative grievance ledger crosses the threshold set by the suzerain's tribute schedule, gating retaliation through a mandatory seven-day council convocation.</example>
    <example category="good" register="paper">A finding is admitted to the journal's record only after two reviewers, blind to author and institution, sign off on methods AND data within the 16-week revision cycle; managing-editor override requires written dissent.</example>
  </system-examples>${worldOnly ? '' : `
  <scenes count="exactly ${sceneCount}, one arc">Operator-chosen length — generate exactly that many. Per-scene density stands on the extraction principle above: each scene logs as many discrete world/system entries as its content genuinely carries — no per-scene quota. As a RICHNESS BAR (the depth high-quality openings reach, not a target to hit): richly-realised stories run around ~${forceReferenceMeansWorld} world / ~${forceReferenceMeansSystem} system entries per scene — typical scenes near ${worldTypicalBand} world and ${systemTypicalBand} system, climaxes near ${worldClimaxBand} world and ${systemClimaxBand} system. Write scenes worth that depth and let the prose carry the count.</scenes>`}

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
      <stance-behaviour>Goes from high uncertainty to collapse in a single decisive scene; once answered, it closes and stays closed.</stance-behaviour>
      <placement>Early-arc hooks.</placement>
    </shape>
    <shape id="slow-burn" seed="1-2">
      <intent>Stays genuinely uncertain across many arcs.</intent>
      <stance-behaviour>Oscillates and re-prices but doesn't close until structural conditions align late in the work.</stance-behaviour>
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
      <stance-behaviour>May never close within the work's scope; probability drifts as events reshape the anchor's stance.</stance-behaviour>
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
    <directive>Name with specificity. Match the premise's setting — when the source clearly implies a non-Western tradition (Mughal court, Lagos newsroom, Heian Japan), draw names from that tradition; otherwise the default register is Western / Anglo and you should trust your strongest baseline.</directive>
    <step index="1" name="source-from-real-traditions">Source names from real census records, historical obscurities, regional naming traditions, or deliberate etymological construction rooted in SPECIFIC traditions matching the world's origin. A world inspired by Song Dynasty China should have names sourced from Chinese historical records; an Ottoman one from Turkish / Arabic / Persian roots; an English-village one from real surnames + place-names; a Silicon Valley one from contemporary US naming conventions.</step>
    <step index="2" name="internal-consistency">Pick a consistent naming register for each faction or region and stay within it. Internal consistency is more important than variety.</step>
    <step index="3" name="texture">Prefer rough, blunt, asymmetric names where the source tradition allows it. Names with hard consonant clusters, unexpected syllable stress, tonal marks, or occupational origins feel lived-in. Smooth melodic names with open vowels feel generated — unless the register is genuinely melodic, in which case lean into it.</step>
    <step index="4" name="surnames">From occupations, geography, patronymics/matronymics, or clan names — never compound noun+noun invention (Stormrider, Shadowbane).</step>
    <step index="5" name="locations">Derive from terrain, founders, or linguistic corruption of older words. They should sound like they've been mispronounced for centuries within their own language family.</step>
    <step index="6" name="threads-and-systems">Concrete and specific. "The Tithe of Ash" not "The Power System". "The Lazar Compact" not "The Ancient Alliance". Match the register the premise establishes.</step>
    <test>If a name could appear interchangeably across 10 different generic works, it's too generic. If it could only belong to THIS world, it's right.</test>
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
