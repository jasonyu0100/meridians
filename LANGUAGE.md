# Meridians — shared vocabulary

The canonical terms the manifesto, README, CLAUDE.md, in-app copy, and prompts all use. Each entry is the one-paragraph definition; if a term shows up in any doc, it should mean what this file says it means. When in doubt, this is the source of truth — drift here gets corrected first.

## Category positioning

**Meridians is an evolving game that codifies reality.** Specifically: it lives in the unclaimed segment where *gaming, education, and strategy converge*. Not a strategy tool dressed up as a game; not a serious game pretending to be entertainment; not an educational platform with a strategy layer bolted on. An evolving game that adapts to its players' scenarios and turns their reality into playable worlds. The expert system that emerges sharpens because the team keeps updating its world; the world stays alive because the team keeps playing it. *Maintenance is the practice, and the practice is the value.* When choosing vocabulary across docs, lean into the **gaming + education + strategy** triad — avoid framing that collapses Meridians into any single one of the three.

## Layers

Four conceptual layers stack from the substrate up to the room:

1. **Substrate** — what the engine measures.
2. **Stance / belief** — what the world view currently thinks.
3. **Reasoning** — how the engine plans forward.
4. **Play (War Room)** — how humans use it.

---

## Substrate

The measured layer. The engine reads any coherent long-form text and turns it into a typed knowledge structure with deterministic scoring.

**World View** — A causally coherent, mutable, queryable knowledge structure extracted from any coherent long-form text. *Any* coherent text describes one: a market brief, a memoir, a paper, a policy doctrine, a campaign plan, a novel. "World view" and "narrative" are interchangeable here — narrative is the canonical case study, world view is the underlying abstraction.

**Substrate** — The engine + math + ledger together. The thing that hosts a world view, runs the deterministic scoring, keeps the cumulative record, and survives across sessions. The manifesto says "convene the room on the substrate"; this is what we mean.

**Forces** — The three measured fields the substrate exposes. Together they capture how hard a world view is working at any point.

- **System** — Rules, principles, structures, conventions, constraints. The abstract field.
- **World** — Characters, locations, artifacts and their lived state. The physical field.
- **Fate** — Open questions and the world view's bearing on them. The possibility field.

Frequently abbreviated **SWF**. "Sufficiently primed SWF corpus" means the substrate has accumulated enough depth across all three to host a War Room.

**Activity** — `A = w_F·F + w_W·W + w_S·S`. The signature-weighted sum of the three forces at any scene. Reads "how hard the world view is working right now." Weights come from PCA on the normalised force curves; not hand-picked.

**Signature** — Where a work sits on the unit 3-simplex of the three forces. Recovered from the dominant principal component of `(F, W, S)`. Names the work's archetype: *Classic* (fate-dominant), *Show / Stage* (world-dominant), *Paper* (system-dominant), *Opus* (balanced), and the pairwise mixes (*Series*, *Atlas*, *Chronicle*).

---

## Stance / belief

The world view doesn't just record what *is*; it carries what it currently *thinks* about what's undecided. The stance layer is how that thinking is structured.

**Threads** — Open questions the world view is open on. Each thread is a question ("Will X happen?") with a set of named outcomes (binary `["yes", "no"]` or multi-outcome). Threads are the substrate's mechanism for tracking everything that hasn't been resolved.

**Stance** — A thread's current bearing across its outcomes. State = (probability distribution via softmax over logits, volume, volatility). Stances update every scene that emits a thread delta; they close when the leading outcome's logit margin clears a threshold *and* the closing scene emits a payoff or twist.

**Belief System** — The aggregate of every open stance. The world view's *current bearing across everything undecided*. The belief is the aggregation; stances are the units; threads are the questions stances answer.

**Priors** — What the substrate has compounded over time: graded forecasts, resolved bets, counterparty plays seen and named, structural shape the room has rehearsed, calibrated reads of which actors move which way under which pressure. *The moat is your priors.* Their quality decides the result; the math is fixed and cheap.

**Queue** — The curated surface between sessions. Operators drop articles, transcripts, observations, market updates — anything that might move a prior — into the queue. Each session opens by walking the queue: what shifts priors enters the substrate, the rest ages out. *Curation, not capture.* Automated feeds (market data, news) are optional accuracy aids piped into the same queue — the human still decides what enters the ledger.

---

## Reasoning

The substrate plans forward through typed graphs and probabilistic cohorts. Reasoning is how the engine answers "what could happen next, and why?"

**Causal Reasoning Graph (CRG)** — A per-arc typed graph of 8–20 nodes (fate / reasoning / character / location / artifact / system / pattern / warning / chaos) linked by typed edges (requires / enables / constrains / risks / causes / reveals / develops / resolves). Built before any scene of the arc is generated; scenes then execute the graph. *Consequence isn't a line; it's a graph.*

**Phase Reasoning Graph (PRG)** — The meta-machinery layer. A working model of the world's economy, conventions, attractors, agents, rules, pressures, and landmarks — mined from narrative context and inherited by every downstream stage (CRG, scene, plan, prose, expansion). The UI calls this the **Mode Graph**; both names refer to the same artifact. *The PRG describes how the world WORKS; the CRG describes how this arc REASONS within it.*

**Variables** — Load-bearing forces (not symptoms) that most reshape a world view's trajectory if they shift. Each variable carries an *intensity* on a 5-level scale: `0 off, 1 weak, 2 mild, 3 strong, 4 extreme`. Variables come in two surfaces: a *present* set (the arc's current load-bearing forces) and a *future* set (the cohort of next-arc scenarios as coordinations over a shared pool).

**Variable Prediction** — The probabilistic alternative to causal reasoning. Where a CRG commits to one chain (what *must* happen and why), variable prediction produces a *cohort* of timelines with relative probabilities (what *could* happen, how likely). Each scenario is a pattern of variable intensities; a priorLogit ∈ `[-4, +4]` scores each scenario relative to its siblings; softmax across the cohort yields the displayed probability.

**Compass** — The room-facing surface that exposes the current decision space: the load-bearing variables and the activations they admit. The cohort reads as a *compass* over possible continuations. In the UI this is the *Variables view*; in prose we say *the Compass*.

---

## Play (War Room)

The application layer. Where the substrate is *used* — by teams, in rooms, on a regular cadence. A War Room is three things at once: a **role-play simulator**, a **strategy table**, and a **living expert system** the team owns and maintains.

**War Room** — A vision-based, role-played, information-asymmetric game on the substrate. The application; the room you convene. A sufficiently primed SWF corpus deploys directly into one. Operators take seats, hold private logs, signal with cards, negotiate, commit to phased moves. *Cards signal intent in public; private logs hold actual intent; the substrate keeps the ledger.*

**Card** — An intent signal played in the open. Either **AI-dealt** (from the substrate's read of available moves for the seat) or **custom-authored** (a bespoke decision, disclosure, or side-channel proposal). Both count as intent signals. AI-dealt cards keep the game honest to the substrate's possibility space; custom cards keep it honest to the operator's real intuition.

**Private Log** — An entity's hidden state, actual intent, secret information. Every seat carries one. Cards are the channel between the private log and the public game state — the player chooses to disclose, leak, or never reveal.

**Public Summary** — The global game-state tracker. What the table sees; the aggregate of what entities have chosen to expose. Reads at a glance via the **map / board state** (spatial: graph, grid, hex, map) and the **raw graph substrate** underneath.

**Decision Matrix** — The per-scene game-theoretic decomposition. Each scene contains a sequence of 2×2 games, classified along 14 axes × 19 game shapes, with integer stake deltas `[-4, +4]` per player per cell. Drives Nash analysis, ELO rating, behavioural tagging per actor. Also called **incentive structures** when discussing the conceptual frame; the same artifact.

**Stakes** — The cost layer optionally attached to plays. Three settings:

- **Fictional** — ELO, leaderboards, the satisfaction of a calibrated call.
- **Reality-anchored** — forecast questions graded against what the record returns, with prize pools.
- **Real** — actual trades, hedges, or positions recorded as commitments.

Stakes turn rehearsal into *skin-in-the-game rehearsal*; the cost of a dishonest signal becomes structural.

**Session** — One meeting of the room. Typically one to two hours for the weekly cadence (markets, current ops, campaigns), two to four hours for the monthly cadence (doctrine, portfolio, life direction). A session is the unit of practice.

**Cadence** — The rhythm at which a room meets. Weekly for what moves fast; monthly for what moves slow. *Life is a long-term game; preparedness is a long-term practice.* Recommended cadence stays plain.

**Practice** — The institution of regular sessions. The compounding loop. The fiftieth weekly War Room is qualitatively different from the tenth because the priors underneath have absorbed fifty cycles of adversarial rehearsal, fifty curated information drops, fifty graded forecasts. *Readiness is a habit.* Practice is what makes the room earn its keep.

**Rehearsal** — What happens inside a session. The room plays the future forward — first along the compass's probabilistically ranked continuations, then along free-form branches the operators want to test on instinct. Every play-through is a fork the substrate keeps and grades against what reality returns.

**Question Bank** — A team's expert system, materialised. Multiple-choice questions generated directly from the substrate's scenes and arcs ("Given *this* regime, what move from the regulator?" / "Which faction holds leverage when the supply line is cut?"). Each question carries (a) the substrate's calibrated **correct answer**, (b) a set of **distractors** — the plausible-but-wrong reads the substrate weighs against, which is where the nuance lives, and (c) an **embedding** of the question text so the bank is searchable by meaning. The bank serves three roles at once: **acclimation** (new operators learn the team's subjective world by working through it — each world has its own rules; the bank is how you learn them), **testing** (distractors expose where intuition diverges from calibrated priors; expert disagreement opens new threads), and **answering** (see *Expert System RAG*). *The bigger the bank, the more real decisions covered, the stronger the expert system.*

**Expert System** — The decision-making contextual model a team builds on top of its substrate. **The expert system IS the question bank**, not a separate artefact — it's what the bank becomes once it's deep enough to answer real questions. Owned and maintained by the team; refined every session and every question taken. The War Room is the vehicle by which a team *trains, tests, and maintains* its expert system.

**Expert System RAG** — Semantic retrieval over the embedded question bank. When an operator asks something new, the substrate finds the closest known questions by cosine similarity and uses their calibrated answers as grounding for a synthesised response. The mechanism by which the expert system *answers* novel questions, not just tests on them.

**Acclimation** — How users learn the world a War Room operates in. Each world is subjective; the rules differ from team to team and from domain to domain. Operators acclimate by playing sessions and by working through the question bank — the bank is the most concrete vehicle the substrate has for teaching the *shape* of a world to someone who hasn't yet lived inside it.

**Knowledge Transfer** — A first-class use of the room: the substrate is the organisation's institutional memory made queryable. New team members onboard by playing sessions and working through the question bank rather than reading dead documentation. Departing experts leave their disagreements with the bank behind, where the substrate keeps them.

---

## Vocabulary discipline

A few rules-of-the-road that keep the language tight across docs and prompts:

1. **Prefer the canonical term over a paraphrase.** "Priors" not "accumulated knowledge"; "queue" not "between-session input"; "compass" not "scenario picker".
2. **System / World / Fate are always capitalised when naming the forces** — even mid-sentence — to distinguish from the everyday senses of those words. "the System force" / "the world view's *world* is rich" (lowercase only when it's clearly the noun, not the force).
3. **"World view" and "narrative" are interchangeable.** Narrative is the canonical case study; world view is the underlying abstraction. Use whichever fits register. Avoid "model" or "simulation" as substitutes — both have other meanings here.
4. **PRG = Mode Graph** in the UI; either name is fine in prose. CRG has only one name.
5. **War Room is the application; substrate is the engine.** Never call the substrate a "war room"; never call the War Room "the engine".
6. **Private and Public are first-class adjectives, not modes.** "A private War Room" / "a public game on a hosted substrate". Not "private mode".
7. **Cards are intent signals.** Avoid "moves" (the substrate uses "move" loosely for the underlying action); reserve "card" for what the player actually plays.
8. **Stakes are a layer, not a feature.** Stakes are *attached to plays*, optional, opt-in. Avoid calling them "the betting feature" or "the gambling layer".
9. **Don't introduce new vocabulary without adding it here.** If a recurring concept shows up in two or more docs and isn't in LANGUAGE.md, it either belongs here or it's drift that should be corrected back to an existing term.
