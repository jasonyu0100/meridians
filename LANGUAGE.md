# Meridians — shared vocabulary

The canonical terms the manifesto, README, CLAUDE.md, in-app copy, and prompts all use. Each entry is the one-paragraph definition; if a term shows up in any doc, it should mean what this file says it means. When in doubt, this is the source of truth — drift here gets corrected first.

## Category positioning

**Meridians is an evolving game that codifies reality.** Specifically: it lives in the unclaimed segment where *gaming, education, and strategy converge*. Not a strategy tool dressed up as a game; not a serious game pretending to be entertainment; not an educational platform with a strategy layer bolted on. An evolving game that adapts to its players' scenarios and turns their reality into playable worlds. The world view sharpens because the team keeps updating it; it stays alive because the team keeps playing it. *Maintenance is the practice, and the practice is the value.* When choosing vocabulary across docs, lean into the **gaming + education + strategy** triad — avoid framing that collapses Meridians into any single one of the three.

## Vision thesis — Capture & Conviction

**Vision thesis** — the bet the whole product rests on: **human judgement, exercised as vision, is the one human edge that doesn't go away.** Models scale prediction, language, search, and optimisation faster than any operator; what they don't originate is the act of *choosing which future to play toward, who gets a seat, and which moves are worth making*. Meridians is built to honour, sharpen, and compound that act — by **battle-testing judgement against AI-simulated teams and situations** built to surprise. It is exercised in **two modes** — Capture and Conviction — *two sides of one coin, run at two tempos*: **Capture is the asynchronous practice** (the slow side, compounds), **Conviction the live practice** (the fast side, sells).

- **Capture** — the *slow, asynchronous* side. Capturing reality via **Priors**: each seat records its running stance *over time, no convening required* — observations dropped in as life happens, from each perspective's own vantage — tracked and calibrated until the room is a **cognitive operating system** that compounds. The retention engine and the moat — the reason a team stays. Asynchronous by nature: it runs *between* sessions, on each member's own clock. (The prior-collection surface is **Priors**; the loop beat is **Capture**, below.)
- **Conviction** — the *fast, live* side and the **day-one value**: a real-time, **high-feedback-loop** session the room convenes and plays together, where judgement is **battle-tested against AI-simulated teams** in dynamic situations. The flagship form is the **adversarial coordination drill**: a team takes one side of the table and an **AI adversary** takes the other (the competitor, the regulator, the rival), hunting the seams in how the team coordinates under information asymmetry. By the first session the gaps show — *felt and undeniable, verified in the room rather than in the engine*, and largely free of the cross-domain validity bet (a competent, surprising opponent is enough; it needn't be "right" about the real world). It bypasses the 2–3-month substrate wait — the drill sells the room on day one. Conviction is played as the **Rehearsal** card game; rehearsal is a **pluggable layer**, so other live formats can ride the same substrate later. The **wedge, not the whole thesis** — the compounding Capture substrate is what justifies retention and price past the demo. (Load-bearing build risk: the adversary must be genuinely sharp against people who aren't the founders; a facilitated loss must teach, not humiliate; seed a thin layer of the team's real context so the seams are *theirs*.)

*Capture is what reality **is**; Conviction is how it **could go**. Two tempos: Capture runs **asynchronous** (priors recorded over time, between sessions), Conviction runs **live** (a synchronous high-feedback session). We hook a room with Conviction (fast, live rehearsal) and keep it with Capture (slow, asynchronous calibration). Both run the same substrate.*

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

**Stream** — A single **perspective's** bearing on one open question, gathered over time. The per-seat unit of the belief layer: a Stream *is* a Thread (same named outcomes + a Stance of logits / volume / volatility, evolved by evidence) but **owned by one member against one perspective**, and its belief-log nodes are its **priors**. Many Streams can hold the *same* question — each a different seat's independently-seeded stance — forming a *local market* whose divergence is preserved, never averaged. Opened from a member's seeding intuition (prior #1), a Stream runs *open* while gathering, *committed* when folded into a Merge, and *closed* once the question settles. **Threads are the world view's belief over narrative questions; Streams are the parallel, perspective-scoped belief layer feeding the room.** *The Stream is the **transducer that makes the qualitative quantitative**: a prose prior is scored into a stance update, and a chain of priors becomes a tracked belief — distribution, margin, uncertainty, volatility — moving over time. That one move is what makes the rest measurable: a stream is an idea under test (which holds, decays, gets overturned, scores calibrated against the write-back); cross-seat stance distance reads as **alignment** one way and **diversity** the other. See **Calibration** below.*

**Prior** (the unit) — One dated observation contributed to a Stream (`StreamPrior`): a prose intuition that doubles as a belief-log node, its `updates` moving the Stream's stance. Distinct from **Priors** (below), the compounded asset — a *prior* is one entry, *Priors* is what they amount to.

**Merge** — Committed Streams folded into continuity: the war-room commit. It interleaves a set of streams' priors by time and extends the world view forward from them. Streams + Merges are a **global ledger** shared across branches, made branch-relative via `basisMergeIds`. A **Conviction** round *is* a Merge — the round's plays assembled and played forward.

**Humanistic priors** — the human-centric core, and why the rest holds together. The unit of value is human *judgement* — the read each person carries on the questions that matter. Meridians honours it and aggregates it: many individual stances, gathered, weighed, and resolved into one living model that **manifests as narrative**. *Human-up, not data-down* — the part of an organisation that lives only in its people, surfaced rather than scraped. The mechanism is **Priors** (below); the conviction is that an organisation's truest model is the aggregate of its people's judgement, told as a story.

**Priors** — Both the compounded asset and the surface that builds it (formerly the *Queue*). As an asset: what the substrate has compounded over time — graded forecasts, resolved bets, counterparty plays seen and named, structural shape rehearsed, calibrated reads of which actors move which way under which pressure. *The moat is your priors;* their depth and freshness decide the result, the math is fixed and cheap. As a surface: a **perspective-based prior-collection system**. Members collect observations against the room's open questions — filtering the noise, structuring each prior, setting the open-ended threads worth tracking (web search assists the drafting; *curation, not capture*, never scraped). Priors are **per-perspective** — each seat keeps its own, a **general perspective** by default — and read out a calibrated, running probability on how each thread resolves as evidence accumulates: a **local stance** that moves over the chronology its priors were added. Divergence across seats is preserved (an adversary's seat holds deliberately hostile priors; what's shared is the board, not the belief). A seat's running prior-set is a **Stream** (above); folding a seat's Priors into the world view commits its Stream via a **Merge**, and that committed stance guides move generation — the next *N* scenes that carry the story forward. **AI-simulated seats:** because Priors are per-seat, an empty or quiet seat can have its priors *simulated* by the engine from its stances and open questions — keeping a thin-rostered team whole, putting AI agents in seats beside humans, and at the limit running a fully autonomous room. Humans are the main support; simulation lets the loop run when a human isn't there.

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

The application layer. Where the substrate is *used* — by teams, in rooms, on a regular cadence. A War Room is two things at once: a **role-play simulator** for rehearsing the future and a **strategy table** for deciding on it.

**The loop — Model, Capture, Rehearsal** — Playing Meridians is one loop in three beats on a shared substrate (rule of three). **Model** reads the narrative you already have and makes it playable — extraction into a typed world view. **Capture** (formerly *Calibration*) keeps it honest as the story continues and is **per-perspective by design**: every seat sharpens *its own* **Stream** on *its own* open questions as priors accumulate. It is **not** belief-pooling — what is shared is the *board, not the belief* — which is exactly what you must not collapse when a seat models an adversary who should surprise you (its seat keeps deliberately hostile priors). Priors arrive two ways: **live**, each member tends their own seat through the full interface; **dark**, they drop observations into the room's encrypted **Signal** number and the GM routes each into the seat it came from. A sparse seat just holds a wider, less-settled stance — never folded into another's. **Rehearsal** plays the chapters that haven't arrived — the breadth game, the bulk of the War Room: only the moves the room *commits to or holds at high certainty* advance the simulation; the contested space is played forward over the **Compass** through board / card / information dynamics — a *compressed simulation of reality*, to *rehearse possible futures*. A committed stance is a *soft prior, not a constraint* — contested threads are protected and play-throughs carry a divergence directive, so Rehearsal explores the state space instead of re-enacting the prior. The first rehearsal mode is **Conviction** (the card game). Every play-through is a fork the substrate keeps and grades against what reality returns — the check that keeps the loop honest. *(An earlier framing had a third human beat, "Review" — a post-play audit plus a per-decision causal audit called "Butterfly". Both were retired as loop phases; the generated slide-deck survives as **Onboarding decks**.)*

**War Room** — A vision-based, role-played, information-asymmetric game on the substrate. The application; the room you convene. A sufficiently primed SWF corpus deploys directly into one. Operators take seats, hold private logs, signal with cards, negotiate, commit to phased moves. *Cards signal intent in public; private logs hold actual intent; the substrate keeps the ledger.* The board is a **shorthand for lived reality** — for now an information-asymmetry card game driven by how operators play their variables and signal, the experience deliberately built for high feedback loops, thinking periods, and board-game play (a shared board on the console, a private hand per seat, drafting decisions). Still a work in progress.

**Perspective** — A **seat**. Bound to an entity (character / location / artifact) or the general narrator vantage; the world itself takes a seat (a hurricane is a location seat, a rate hike a Central-Bank seat — external events are just a seat's plays). Held by one or more **Members**, driven by an **Agent**, or left empty to be AI-inferred. Each perspective accumulates **Streams**. "Seat" and "perspective" are interchangeable; *seat* for the play register, *perspective* for the data model.

**Member** — A human participant in the room. Exactly one holds the **Game Master** role (the single master device); the rest hold seats. Carries the routing keys that bind it across doors — a **session token** for **live** (the Cloudflare tunnel) and a **Signal number/UUID** for **dark** capture.

**Agent** — An AI player: a **persona** (a preset personality or a custom prompt) that drives a perspective's Streams in place of a human — augmenting its suggestions, intuitions, and the continuation of its priors. Lets a thin-rostered room stay whole, puts AI seats beside humans, and at the limit runs an autonomous room.

**Conviction** — The **live practice** (the fast side of the Vision thesis; formerly "Playback"): the War Room convened and played in real time, where judgement is battle-tested against AI-simulated teams (specced in [CONCEPT.md](CONCEPT.md); *not yet built*). A game about *belief made visible* — seats spend scarce **conviction** to back what they believe about the near future, **show or hide** it to coordinate or mislead, and the engine plays the table's bets forward into a kept branch. It is the **fast twin of Capture**: same threads, stances, and resolver, run in a session instead of over weeks. It's played as the **Rehearsal** card game; rehearsal is a **pluggable layer** over the shared resolver, so other live formats can ride the same substrate later. *Capitalised "Conviction" is the live practice / game; lowercase "conviction" is the resource it runs on — priced by improbability (`−log p`), it banks but decays (`α = 0.9`).*

**Access model — Console / Live (Cloudflare tunnel) / Dark (Signal)** — How a room runs across devices. The **console** is the laptop (the *master device*) that holds the substrate, drives the shared screen everyone reads, and is the **single source of truth** — no sync, no merge, no conflict. Non-GMs reach it two ways. **Live (Cloudflare tunnel):** when the GM hosts, a **`cloudflared` quick tunnel** (free, no account) gives the local instance a session-scoped public **HTTPS URL** (`…trycloudflare.com`) with a real cert — non-GMs open it on any phone (QR, no app install) and get the **full interface** (same substrate, board, live state), **read-write**, **PIN-gated**, GM **elevated**. Not a crippled mobile view — the real interface. The tunnel is *public* exposure (TLS terminates at Cloudflare's edge), so **application-layer auth is the perimeter** — two-stage pairing, the daemon rejects everything unauthenticated but the rate-limited pairing endpoint; the binary is bundled (or fetched on first run), spawned at SETUP and killed on close, so exposure dies with the session. Fully-private tables run **LAN-only** (no tunnel). *(Replaces the ngrok tunnel — `cloudflared` is free, no-account, real-cert, and bundle-able in Electron.)* **Dark:** when the machine is off, the **always-on capture layer** stays open for members to drop priors any time. **Signal is the one capture channel** — **end-to-end encrypted**, security-first (dedicated room number via `signal-cli`, **DMs not a group** — a group would leak every seat's beliefs — quarantined one-way ingress, bare admissibility ack). **No server-side component** — the tunnel is third-party, Signal is a normal chat. *The console holds the truth; live you join it over the tunnel, dark you feed it through Signal.*

**Game Master** — The single person who owns the master device and the room: keeps the data safe (the substrate is one encrypted `.meridian` file, backed up by the operator, optionally copied to an in-app online drive), convenes the sessions, refines the models, and holds the truth. May be a **volunteer inside the organization** or a **facilitator on our side**. The GM is the **curation-and-commit layer and the gatekeeper**: decides when the instance lives (hosts it, spawns the **Cloudflare quick tunnel**, shares the URL), and which inputs graduate into the substrate — reviewing the **Signal capture inbox** when the instance comes back online, curating, and committing what earns it. Holds **elevated privileges** while non-GMs have full read-write over the tunnel. Everyone else joins as a seat. *Local-first by default; data responsibility is the operator's.*

**Card** — An intent signal played in the open. Either **AI-dealt** (from the substrate's read of available moves for the seat) or **custom-authored** (a bespoke decision, disclosure, or side-channel proposal). Both count as intent signals. AI-dealt cards keep the game honest to the substrate's possibility space; custom cards keep it honest to the operator's real intuition.

**Private Log** — An entity's hidden state, actual intent, secret information. Every seat carries one. Cards are the channel between the private log and the public game state — the player chooses to disclose, leak, or never reveal.

**Public Summary** — The global game-state tracker. What the table sees; the aggregate of what entities have chosen to expose. Reads at a glance via the two display surfaces: the **Board** (a board-game-style map with nested maps) and the **Graph** (the raw substrate — nodes and edges) underneath. These are the only two map types; switching between them is re-projection, not rebuilding.

**Surfaces** — The four clusters the workspace is organised around, the general language users learn (the StageBar groups its ~29 view modes into these). **Signals** (the *Capture* cluster; formerly "Vision" — renamed to free that word for the [Vision thesis](#vision-thesis--capture--conviction)) — the room / perspective workspace, three sub-tabs: **Entry** (the raw-note priors-ingest surface, `vision`), **Streams**, and commit **History** (Merges). **Base** (the world-as-state cluster; formerly "State") — the **Board** (map + location hierarchy), the graph domains (**World / System / Threads / Network**, each at *Scene / Arc / Full* scope), and the **Curriculum**. **Mind** — the stance and machinery: **Belief**, **Compass**, **Phase** (Mode Graph), **Decision** (Matrix), **Map**, and **Search**. **Channel** (the *Scene* cluster) — the move being authored: **Plan / Prose / Audio / Questions**. The console shows these; non-GMs reach the full set live over the Cloudflare quick tunnel, and capture async through Signal when it's dark.

**Decision Matrix** — The per-scene game-theoretic decomposition: a sequence of decisions (1- or 2-player), each scored with integer stake deltas, driving Nash analysis, ELO, and the player archetypes. Full vocabulary in **Strategic play (game theory)** below. Also called **incentive structures**.

**Stakes** — The cost layer optionally attached to plays. Three settings:

- **Fictional** — ELO, leaderboards, the satisfaction of a calibrated call.
- **Reality-anchored** — forecast questions graded against what the record returns, with prize pools.
- **Real** — actual trades, hedges, or positions recorded as commitments.

Stakes turn rehearsal into *skin-in-the-game rehearsal*; the cost of a dishonest signal becomes structural.

**Calibration** — The proof layer of the practice (the *concept*, distinct from the retired loop-beat name now folded into **Capture**). Streams make judgement measurable (see **Stream**); **post-hoc Brier scoring** then grades it: each seat's stance is frozen at decision time (the forecast, committed *before* the outcome is known), the **Game Master records what reality did later** as a *confirmed* resolution, and the gap between the two is scored per seat across every resolved thread. The post-hoc step is only the *outcome*, never the belief; it is not a retrospective thumbs-up but a score on the probability committed beforehand, rewarding calibration over many questions (a strictly proper rule — can't be gamed by hedging). Aggregated, each seat earns a **computed believability weight** — the per-seat track record an **idea meritocracy** needs and asserts but never had a number for ([Dalio's Principles](https://www.simonandschuster.com/books/Principles/Ray-Dalio/9781501124020) is the cultural antecedent; the **calibration corpus** is the audit trail it lacked). The reasoning stays attached, so a bad score is auditable. *Honest limits:* it bites only where threads resolve observably, the signal lives in the corpus not the single event, and it leans on the GM's faithful write-back. **History is the calibration gym** — replaying a decision whose outcome is already known gives clean, immediate feedback the live slow domains never hand you. *Streams make the qualitative quantitative; the write-back makes it true.*

**Session** — One meeting of the room. Typically one to two hours for the weekly cadence (markets, current ops, campaigns), two to four hours for the monthly cadence (doctrine, portfolio, life direction). A session is the unit of practice.

**Cadence** — The rhythm at which a room meets. Weekly for what moves fast; monthly for what moves slow. *Life is a long-term game; preparedness is a long-term practice.* Recommended cadence stays plain.

**Practice** — The institution of regular sessions. The compounding loop. The fiftieth weekly War Room is qualitatively different from the tenth because the priors underneath have absorbed fifty cycles of adversarial rehearsal, fifty curated information drops, fifty graded forecasts. *Readiness is a habit.* Practice is what makes the room earn its keep.

**Rehearsal** — The breadth game (the third beat of *The loop — Model, Capture, Rehearsal*), played in session. The room plays the future forward — first along the Compass's probabilistically ranked continuations, then along free-form branches the operators want to test on instinct. The first rehearsal mode is **Conviction**, the card game; rehearsal is a pluggable layer, so other formats can ride the same resolver later. Every play-through is a fork the substrate keeps and grades against what reality returns. *The purpose of the play is to rehearse possible futures.*

**Onboarding decks** — Generated **slide decks** over a slice of the substrate — a room's history and the key decisions that shaped it — that **update a newcomer's priors** when they join a team, move between teams, or are introduced to a new room. The lightweight onboarding surface (no session to convene), and it **regenerates as the substrate moves** so it stays current. Pushed to members' phones, it doubles as the **knowledge-transfer** surface; resolved threads and pivotal decisions make natural deck beats. (Survives from the retired *Review* phase, where it was the deck-delivery mechanism.)

---

## Strategic play (game theory)

A facet of Play: the strategic layer beneath the prose. Each consequential beat is a **decision** the engine deconstructs and scores; the scores drive ELO and the player archetypes. Purely additive — written to `scene.gameAnalysis`, never mutating the force deltas.

**Decision** — A consequential beat, sealed and scored. Two kinds:

- **Duel** (2-player) — a strategic game against another agent. A full NxM matrix: each player picks from a menu, every pairing is a cell with both players' stake deltas.
- **Solo** (1-player) — a pivotal choice against the world, reality in the other seat. A *row*, not a matrix: one decider, a menu of options, one immediate stake delta per option (take the job, hold or fold, relocate, confess now or wait).

**Decision Matrix** — The per-scene sequence of decisions. Each carries an **action axis** and (for duels) a **game shape**, with integer **stake deltas** per cell. Also called **incentive structures** — the same artifact.

**Stake delta** — An integer in `[-4, +4]` scoring how much an outcome advances (+) or harms (−) a player's arc-level interests. *Magnitude is importance*: a pivotal beat uses the full ±4, a quiet beat stays ±1. Scored honestly per cell — never warped to justify what happened; a dominated cell landing as realized is signal.

**Action axis** — The dimension a decision trades on; both players' actions live on the SAME axis. Eleven: information, identity, trust, alliance, status, pressure, stakes, resources, obligation, commitment, timing.

**Game shape** — The strategic frame of a duel — one of sixteen: coordination, stag-hunt, dilemma, chicken, divergence, zero-sum, signaling, screening, principal-agent, stealth, stackelberg, bargaining, commitment-game, contest, collective-action, trivial. Solo decisions have no shape.

**Nash equilibrium** — A cell no player can improve on by switching alone. For a solo decision, the stake-maximising option (the rational pick against an indifferent world). **Realized cell** — what actually happened; landing off-Nash is signal (arc, identity, or principle over local stake), not error.

**Arc cost** — Stake a player left on the table: the best outcome available to them minus the realized one. For a solo decision, regret against the best option.

**Stake rank** — Where the realized cell sits in a player's preference order over the whole grid (1 = best).

**ELO** — Continuous skill rating per player, updated each decision. `ELO_INITIAL = 1500`, `ELO_K = 32`. The **margin score** folds margin-of-victory into the update — duel: `clamp(0.5 + (ΔA − ΔB)/16, 0, 1)`; solo: `clamp(0.5 + ΔA/8, 0, 1)` against **par** (reality, a fixed non-learning opponent at 1500, `ELO_PAR`). K is **stake-weighted** so high-stake beats move ratings far more than low-stake ones. The player archetypes fall out of the trajectory plus the outcome mix.

### Player archetypes

The behavioural tags a player earns from their decision record. Tag `id` matches its `label` (kebab-case) for consistency. Grouped:

- **Role** (one headline): *prime mover* (drives the game; the world bends toward them), *adversary* (dominates at others' expense), *tragic figure* (absorbs cost, declines anyway), *mentor* (gives more stake than they take), *comeback* (arc climbs from below), *slipping* (loses ground across the window), *trickster* (wins the information game, high variance), *counterforce* (exists to push against another's motion), *anchor* (stable, cooperative, near-baseline).
- **Relational outcome** (how realized cells split): *extractor* (gains at the other's expense), *sacrificial* (pays so others gain), *scorched-earth* (lands in both-lose cells), *uneven ally* (cooperates but takes the bigger slice), *ally* (genuine even cooperation).
- **Trajectory**: *dominant* (lands near the top of every grid), *rising* / *falling* (rating climbed / eroded), *high-variance* (wins big, loses big), *steady* (rating barely swings).
- **Solo decision style**: *soloist* (most calls are 1-player bets against the world), *sure-handed* (usually takes the stake-maximising option), *gambler* (passes up the safe-best, plays for the upside).
- **Strategic style**: *defies the odds* (keeps winning moments rational play says they shouldn't — the prime-mover signature), *strategist* (overwhelmingly plays the Nash move and it pays), *off-script* (rarely plays the rational move).
- **Agency** (from game-shape participation): *schemer* (wins information-asymmetric games), *power-broker* (sets the terms — first mover in commitment / bargaining), *combatant* (lives in zero-sum / chicken / divergence), *coordinator* (builds shared action in alignment games).
- **Arc shift**: *upward arc* / *downward arc* (late outcomes substantially better / worse than early).
- **Relationships**: *rival: X* (losing record concentrated against X), *leads: X* (winning record against X).
- **Role bias**: *initiator* (almost always the prime mover / Player A), *responder* (almost always reacting / Player B).
- **Affinity**: *axis: X* (characteristic action axis), *X-heavy* (characteristic game shape).

---

## Learning (study layer)

A facet of Play: a way to be *brought up to speed on* a world view and tested against it. Purely additive and post-hoc — like the Decision Matrix, it never mutates the force deltas.

**Question bank** — Per-scene **multiple-choice questions** the engine generates from a finished scene, stored on `scene.questions`. The atomic unit of the study layer.

**Scoped practice** — Running the banks across any slice of the world view — a scene, an arc, the whole narrative, or a **topic** — from the **Learn** modal. The same banks back every learning surface; the scope decides which questions are drawn.

**Curriculum** — A reorganisable **Topic** tree that organises the question bank into a teachable structure (each question assigned 1:1 to a topic). The substrate read as a syllabus.

**Coverage** — Per-**member** spaced-repetition recall layered over the curriculum: who has been tested on what, and what is due. Turns *Onboarding decks* (passive review) into *active recall* — the testing counterpart to the deck.

---

## Vocabulary discipline

A few rules-of-the-road that keep the language tight across docs and prompts:

1. **Prefer the canonical term over a paraphrase.** "Priors" not "accumulated knowledge" or "queue" or "between-session input"; "compass" not "scenario picker".
2. **System / World / Fate are always capitalised when naming the forces** — even mid-sentence — to distinguish from the everyday senses of those words. "the System force" / "the world view's *world* is rich" (lowercase only when it's clearly the noun, not the force).
3. **"World view" and "narrative" are interchangeable.** Narrative is the canonical case study; world view is the underlying abstraction. Use whichever fits register. Avoid "model" or "simulation" as substitutes — both have other meanings here.
4. **PRG = Mode Graph** in the UI; either name is fine in prose. CRG has only one name.
5. **War Room is the application; substrate is the engine.** Never call the substrate a "war room"; never call the War Room "the engine".
6. **Private and Public are first-class adjectives, not modes.** "A private War Room" / "a public game on a hosted substrate". Not "private mode".
7. **Cards are intent signals.** Avoid "moves" (the substrate uses "move" loosely for the underlying action); reserve "card" for what the player actually plays.
8. **Stakes are a layer, not a feature.** Stakes are *attached to plays*, optional, opt-in. Avoid calling them "the betting feature" or "the gambling layer".
9. **Don't introduce new vocabulary without adding it here.** If a recurring concept shows up in two or more docs and isn't in LANGUAGE.md, it either belongs here or it's drift that should be corrected back to an existing term.
10. **Console / live (Cloudflare tunnel) / dark (Signal) is the access language.** The console is the master device (the laptop that holds the substrate and drives the shared screen). **Live**, non-GMs reach the *full interface* over a PIN-gated **`cloudflared` quick tunnel** — a session-scoped public HTTPS URL (read-write; GM elevated; app-layer auth is the perimeter; the binary is bundled and spawned per session; LAN-only fallback for fully-private tables). **Dark**, the async capture layer runs over **Signal** — the one capture channel, **end-to-end encrypted** (dedicated number, DMs not a group, quarantined ingress); the GM curates and commits. There is **no server-side component** (the tunnel is third-party; Signal = a normal chat). In user-facing copy don't call the console "the server"; the tunnel view is the **real interface**, not a "crippled mobile view." *(Replaces ngrok and WhatsApp entirely, on security grounds; all-in on Cloudflare + Signal; no Tailscale.)*
11. **Priors are human-made, never scraped.** The prior-collection is humanistic by design — a person filters, structures, and sets the threads; web search only *assists* drafting. Don't reintroduce "automated feeds" or "scrapers" as inputs.
12. **Two map types only: Graph and Board.** The raw graph substrate and a board-game-style map with nested maps. Don't reintroduce "grid" or "hex" as board geometries.
13. **The queue is now "Priors."** "Queue" / "Driver" survive only as code/UI labels inside the **Signals** (Capture) surface; in prose and vocabulary it's *Priors*.
14. **Player-archetype tag `id` matches its `label`** (kebab-case) in the game-theory dashboard — no literary/code-name drift between what's stored and what's shown. New tags get an entry under *Player archetypes* above.
15. **A decision is 1- or 2-player.** Two-player = *duel* (a matrix); one-player = *solo* (a row, reality in the other seat). Don't describe game theory as inherently two-player.
16. **Threads and Streams are distinct.** A **Thread** is the world view's own belief over a narrative question; a **Stream** is one perspective's belief over an open question (member-owned, its priors are its log). Don't use "thread" for a member's per-seat bearing, or "stream" for the canonical narrative belief.
17. **The loop is *Model → Capture → Rehearsal*.** Three beats, no fourth. *Review* and *Butterfly* are retired as loop phases — don't reintroduce them; the slide-deck output lives on as **Onboarding decks**.
18. **Conviction (capital) is the live practice / game; conviction (lowercase) is the resource.** Conviction is the live practice (was "Playback"), played as the **Rehearsal** card game — rehearsal is a pluggable layer, so other live formats can ride the same substrate later. *Rehearsal* names the act (playing the future forward); *Conviction* names the practice it's played as. Don't call conviction "the betting chips".
19. **The Learning layer is additive and post-hoc.** Question banks, scoped practice, Curriculum, and Coverage read the world view; they never mutate force deltas. Don't frame Learning as part of generation.
20. **Capture is the asynchronous practice; Conviction is the live one.** Tempo is the clean split — Capture runs *async* (priors recorded over time, between sessions, no convening), Conviction runs *live* (a synchronous, high-feedback session the room plays together, battle-testing judgement against AI-simulated teams). The two modes of the Vision thesis (*human judgement-as-vision is the edge that doesn't go away*). Don't blur it: don't call Capture "live" or Conviction "asynchronous" at the practice level; "Playback" is retired in favour of **Conviction**. (The access model's *live (Cloudflare tunnel) / dark (Signal)* is a separate, device-reach layer — orthogonal to this practice-tempo split.)
