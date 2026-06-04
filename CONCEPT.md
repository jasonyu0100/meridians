# Meridians — The Rehearsal Card Game (CONCEPT)

> **Forward-looking. A working theory, not a spec.** This is the design space for the War Room as a *playable card game on the substrate* — the concrete shape of [ROADMAP.md](ROADMAP.md) A4 (Rehearsal) and the exploratory "card-based, information-asymmetric gameplay" item. Everything here is meant to be argued with and refined. The grounded engine it rides on (threads/stances, the variable cohort, game-theory decomposition, ELO, Butterfly) already ships — see [CLAUDE.md](CLAUDE.md). Vocabulary: [LANGUAGE.md](LANGUAGE.md).

---

## 1. The premise

Once a week's priors have updated the narrative state (Capture → resolve, ROADMAP A1–A3), the room **branches off and plays the future forward as possibilities, not priors.** Rehearsal is where a table of players explores *how things could unfold* — committing stances, reading each other, and watching the engine resolve their collective bets into branches.

**Two speeds of one game.** Capture and Rehearsal are *the same game at different clock speeds* — the parallels are deliberate, not coincidental.
- **Capture (the weekly priors loop, A1–A3) is the slow-motion version.** Over a week, each perspective accumulates **free-text priors** that nudge its stance logits; the outcome *emerges* from that accumulation (prediction-market convergence) and resolves once, at week's end.
- **Rehearsal is the same game at high speed.** Instead of accumulating text, you play a **discrete card** that commits a **discrete outcome**, and the round resolves immediately.

Same perspectives, same open threads, same stances, same causal resolver (§7e) — only the input granularity and the clock differ. The mapping is one-to-one: a tracked thread is a board thread; a week of priors is a hand of cards; the weekly resolve is a showdown. The one real difference is **discreteness** — the fast game's outcomes are discrete commitments (a card = one chosen outcome), not the softmax-blended result of accumulated priors. Build the fast game and you've largely built the slow one, and vice-versa.

It's played **like poker, in rounds.** You go around the table; each player must **play** (face up or face down) or **fold** (out for the round). The kept forks *are* the rehearsed futures.

The point is not to win chips. The point is to **rehearse probable futures and pressure-test decisions** — the poker frame is the vehicle, because it's a game everyone already knows and it naturally produces hidden information, commitment, and opposition.

**One coherent system.** Strip it down and the whole game is: *perspectives play cards under a budget, in a configurable turn order, resolved by a causal graph.* Budget is the cost of playing cards — it caps how much you can commit, and (since you signal only by playing) how much you can communicate (§7d). Revealing is free; face-up vs face-down is a signalling choice (§2). Turn order is a GM dial — deterministic or random (§3). And there's nothing outside the rules: human players, AI actors, and even the world itself (a *Central Bank* or *Nature* seat) are all just perspectives playing cards (§7f). Every other section is a refinement of that one sentence.

**What good play looks like.** Played right, the game demands **high coordination between allied players** — and because the only channel is play, that coordination runs on **information signalling** (what you show, what you hide) and **budget control** (what you can afford to commit, and thus to communicate). The effect is to turn the room's decision-making into genuine **strategic planning**: weighing causal factors, reading opponents, positioning commitments ahead of the reveal. What the game deliberately does *not* hand the players is the verdict — **the positive or negative outcome of a turn is resolved by the LLM generation** (§7e), not declared by the table. You plan, signal, and commit; the world (the causal graph) decides whether it worked. That separation — *players own the strategy, the engine owns the resolution* — is the point: it's what keeps the planning honest rather than self-graded.

---

## 2. What a card is

A card is a **stance on an open question** — the same thread/stance machinery from Capture. No parallel system. But a hand is **part chosen, part dealt:**

- **Stance cards (chosen).** Outcomes on your perspective's own open questions (e.g. a trader's *"where does gold go?"* over price levels). You decide which to commit; each costs budget. This is the skill / read part of your hand.
- **Dealt cards (RNG) — and every hand differs.** The rest of the hand is **dealt by the system from distributions loaded by the world model** (cohort priors / stance distributions), so you're dealt what's **plausible for your perspective**, not arbitrary cards — and crucially, **each seat is dealt a *different* hand.** This is both the luck of the draw *and* the reason contests resolve cleanly: two seats never hold the identical card to bid head-to-head, so opposed play is always *different cards pushing a thread*, reconciled by the engine (§7d). You play the hand you're dealt, not one you fully chose.

**Playing a card** = committing an outcome — a weighted bet on one branch. The weight is **conviction = `volume`** (the attention weight already on every stance); betting harder moves the market more and contributes more Fate. Conviction is **scarce** — playing a card costs from a **budget** (§7d), so you cannot go all-in.

**Revealing is free; the choice is signalling.** Playing a card costs budget whether it's face up or down — what differs is information:
- **Face down** = private commitment (a screening game — others must infer your hand; the sealed-decision seed for Butterfly, A6).
- **Face up** = a signal (you're deliberately telling the table something — a signaling game).

**Communication is only through play.** You can't simply *announce* your hand — there's no cheap talk. The only channel is which cards you play and whether you show them. Selective disclosure **is** the language: a face-up card tells the table something (to coordinate, signal, or steer); a face-down one withholds it. What makes showing a card *risky* is the red team (§7b) — revealing costs no budget, but a revealed stance can be exploited, so disclosure carries real strategic risk. Without a predator reading your reveals, showing is consequence-free and the channel goes dead.

These aren't invented mechanics; *signaling* and *screening* are two of the engine's 16 game types. The card table just surfaces the information asymmetry the substrate already models.

---

## 3. The round — setup, then play

### Round setup (the GM scopes the play area)
Before any cards, the GM frames the round — **relevant information, not the play itself.** This scopes *where, who, and the situation*; it never dictates outcomes.

- **Locations in play** — the possible places the round can unfold across (the board's spatial scope). Drawn from existing `Location` entities; a subset, not the whole map.
- **Playable characters** — which perspectives / characters are seated and active this round. A subset of the cast — others sit out, or play as AI / inferred seats (§7a).
- **Round concept** — a general premise that continues the narrative from the resolved state (e.g. *"the negotiation reconvenes after the leak"*). Sets the frame the contested thread lives in — closer to a direction vector / arc premise than a script. It says *what situation we're playing into*, not *how it resolves.*

Setup defines the play area; the players define the play. It's as much **context as scope** — the concept + cast + locations are the context packet the resolver reads: the CRG built at showdown (§7e) draws its `location` / `character` nodes from what setup put in play, and the cast determines which **world-power seats** (§7f) are at the table and what's in their remit.

**The GM is a facilitator, optionally a player.** The GM runs the substrate — frames the round, handles turn order, triggers generation. They **may also take a perspective seat and play**, or **opt out** and purely referee. What the GM never pilots is the world-power seats (§7f): those stay AI-played, so the *engine* — not the GM — owns the consequences (invariant #1). When the GM does play a seat, fairness rests on not weaponising the engine's hidden reads (stance distributions, priorLogits) that operating the master device exposes — a real tension, flagged in §9.

### Play (poker loop)
**Turn order is configurable** (a GM setting), because how the table goes around changes the game:
- **Deterministic** — a fixed seat order, poker-style. Predictable; rewards reading the players who act before you and positioning against those after.
- **Random** — order reshuffled each round (or each go-around). An extra element of chaos; you can't count on acting after a given rival, so you commit with less positional information.

World-power seats (§7f) sit in the same order as everyone else.

1. **One contested thread is "the board"** for the round — put in play by the GM or the engine, within the round concept. (One community card at a time keeps it legible; rounds cycle through the contested threads.)
2. Going around the table, each player must **play** (face up / face down) their stance on the board thread, or **fold.**
3. **Folding ends your turns for the round** — any threads you haven't committed fall to a **stance sampled from the probability distribution** (§7d): you accept the probabilistic default instead of steering it, and forfeit the right to *react* to what others reveal. You stop spending; you stop steering. A real tradeoff, not a penalty — sometimes the likely default is exactly what you'd have bet anyway.
4. **Showdown** resolves the round: face-down cards reveal, and the committed stances generate the continuation. **By default this is a causal-graph resolution** (§7e) — the round's cards seed a CRG that abduces the realistic path to them and scenes execute it. (The aggregate prior model — `priorLogit` → softmax over the variable pool — still *ranks* how probable each coordination is; the CRG *generates* the resolved branch's actual continuation.)
5. Across successive rounds, play/fold traces a **path through the possibility tree.** The forks are kept.

**What a card controls.** Paid unopposed, a card *buys* its outcome (you can force even a long-shot, at its rarity price; §7d). What no card buys is the **consequences** — the CRG owns the causal fallout (§5, invariant #1) — and where seats genuinely oppose, the outcome itself becomes a payment-weighted reconciliation, not a fiat. So you control what you commit; the engine controls what it costs you.

---

## 4. Scoring — present, but not the point

**Scoring is not the priority, and it needs no new machinery.** The engine already has a game-theory **ELO** system (`game-theory.ts`, the Decision Matrix) that scores meaningful decisions — the card game **reuses it rather than building its own.** Two things to hold:

- **The fast game's primary feedback is experiential**, not a number: the budget you paid and the consequences the engine generated (invariant #1). You *feel* whether forcing an outcome was worth it.
- **ELO / calibration accrues better in the slow game** (Capture, over weeks), where the sample is large enough to mean something. A single session is too few hands for a per-session score to be signal, so we don't foreground one. Apply the existing ELO across sessions if you want a ladder; don't compute a live scoreboard each round.

The two axes below are the *concept* of what good play optimises — **calibration** (was your read right) and **influence** (did your bets steer the branch) — not a live scoreboard:

| Axis | What it rewards |
| --- | --- |
| **Calibration** | did your committed stance match what the sim actually generated |
| **Influence** | did your bets steer which branch got generated at all |

The game lives in the gap between **what you want** (your perspective's interest) and **what you believe** (your read). What *enforces* that gap isn't a grade — it's the **cost and the consequences**: forcing a long-shot costs its full rarity price up front (§7d), and the engine owns the fallout (§5, invariant #1). Wish-casting is self-taxing, no scoreboard required.

---

## 5. The four invariants (why "just pick the best outcome" isn't free)

Players *will* try to choose the best outcome for their stance — that's the intended move. It's a game only because "best" is made expensive and contingent. **All four must hold; remove any one and the game collapses:**

1. **Buy the outcome, not its consequences.** Budget can *force* even an unlikely outcome — but you only buy the outcome itself, and only **unopposed** (contested, it's a payment-weighted bid into a reconciliation; §7d). The engine owns the **consequences**: the CRG generates the causal fallout — often the very `chaos`/`warning` conditions a long-shot requires — which can be a monkey's paw. You get exactly what you forced, plus everything the world does about it. So forcing is never free fiat; it's an expensive bet that the consequences will serve you. *(And because consequences are **state-dependent** — the same forced move plays out differently in different world states — players learning the world's causal patterns is genuine rehearsal insight, not a fixed exploit. That learning is the point, not a leak.)*
2. **You pay for divergence up front.** Betting against the predicted reality costs its full rarity price (−log p, §7d) whether or not it pays off — so wish-casting is *self-taxing*, no external scoreboard required. Reality doesn't grade you after the fact; the price did, before you committed.
3. **Opposed interests.** If everyone wants the same future there's no bluff and no game — it's consensus forecasting. This is *why adversary / other-org perspectives (A1 inferred priors) are a precondition, not a side feature.*
4. **Hidden information.** Face-down play makes "best outcome" strategic, not declarative — your best bet depends on hands you can't see. Full information collapses it to independent optimization.

---

## 6. Failure modes to design against

- **Cooperative room, shared interest** → no opposition → collapses to forecasting. Needs opposed perspectives, or there's nothing to rehearse.
- **Predictable sim** → calibration is trivial, everyone's right, no spread. Resolution must carry genuine uncertainty (the power-law cohort, the fat tail).
- **Free conviction** → if you can bet max on everything, bets carry no information. Conviction must have a **budget** — see §7d.

### 7d. Budget — the spine of the game
Budget is the resource the whole game turns on, and it governs exactly one thing: **what you can play.** Committing a stance costs budget; you can't back every thread, so committing to one is forgoing another — that opportunity cost is what gives a play weight and gives folding meaning. (Revealing is *free* — face-up vs face-down is a signalling choice, not a budget cost; see §2.)

**How a card is priced — by improbability.** A card costs in proportion to how *unlikely* the outcome it commits is, given the engine's predicted probability `p` (the cohort softmax / current stance distribution). The principled form is **surprisal: cost ∝ conviction × (−log p)** — and that's no accident: −log p is the same information measure **Fate** is built on (Fate = information gain), so cost and Fate become one currency. Betting the **modal, likely outcome is cheap; forcing an improbable one is expensive.** You *can* drag the world onto a long-shot branch — you just pay for it.

The effects:
- **The game tracks realistic scenarios by default** — left alone, cheap likely bets dominate and the sim follows the modal future. Drama costs budget; someone has to *spend* to bend reality off its likely path.
- **Budget is the reality-bending resource.** A contrarian who forces the tail and is *right* (calibration) reaps a large payoff for the budget burned; wrong, and they spent everything dragging the world somewhere it didn't go. That's where forecasting skill expresses.
- **The difficulty dial gets richer** (below): a tight budget pins the table to the modal future (little bending affordable); a loose budget lets players buy improbable, dramatic divergences. Budget tunes not just *how much* you play but *how weird* the room can get.
- **It dovetails with resolution (§7e):** a paid-for improbable outcome is a high-conviction `fate` node the CRG must *justify*, usually by abducing the `chaos`/`warning` conditions that make a long-shot plausible — exactly how improbable things happen. The cost bought the right to demand them.

Pricing is off **public** predicted probability (the pre-round prediction + revealed plays), so a card's cost is knowable before you commit — unpredictable cost would be frustrating, not strategic.

**You're paying for certainty.** Budget buys one thing: **certainty over an outcome.** Playing a card *locks* that outcome as your committed stance; spend nothing on a thread and it stays uncertain — its outcome **sampled from the predicted distribution**. Rarity pricing is just the price of certainty: making a likely outcome certain is cheap, making an unlikely one certain is expensive (cost = that outcome's own −log p). You're converting probability into a sure thing, and the further from likely, the more it costs. This is why the table tracks reality by default — unplayed threads sample the likely future for free; you spend budget only to *force* a thread to a chosen, often unlikely, outcome.

**Not playing is inherently face-down.** A thread you don't play puts no card on the table, so it shows nothing — indistinguishable from a face-down commitment. Silence reads as hidden either way, so not-playing is naturally camouflaged: the table can't tell whether you've locked an outcome face-down or simply left it to chance.

**Certainty is only guaranteed unopposed — and differentiated hands keep contests clean.** On a thread no one contests, paying buys the outcome outright. But there's **no symmetric bid-war**, because **each seat is dealt a different hand** (§2): two players never hold the identical card to throw against each other. Opposed play is always *different cards pushing one thread in different directions* (one holds "gold crashes," another "gold holds") — and where they genuinely conflict, the **CRG reconciles them** (§7e), payment-weighted: both become `fate` nodes, the engine abduces a reality where each *partially* manifests, and the tension surfaces as `chaos`/`warning` nodes. So budget buys certainty in the quiet, and a weighted bid into a reconciliation where interests are opposed (§5) — never a winner-take-all.

The budget is the **GM's primary difficulty dial**, and it bites on **coordination.** Players signal only by *playing cards face up* (§2), so the number of cards you can play caps how much you can signal — and lowering the budget means fewer plays, hence fewer face-up signals, hence **the table can coordinate less.** That's the difficulty curve: a generous budget lets allies play freely, signal, and converge on good outcomes; a starved budget forces them to commit in the dark on a handful of cards, unable to read or coordinate with each other. Generous early budget = exploration and coordination; shrinking budget = forced conviction under silence. (Open: per-round vs per-session pool, regeneration, fold refunds — §9.)

---

## 7. What makes the games interesting (the three asks)

### 7a. AI actors (GM-configured)
Not every seat is human. The GM can configure **AI players** that hold a perspective and play its cards:
- **Gap-fill** — an unattended seat (A1 inferred priors) plays its stance so the table is never blind to an absent party.
- **Adversary** — an opposed / other-org perspective played by the engine, supplying the opposition the game requires.
- **Beside humans** — AI actors as full players, not just fillers (the exploratory frontier).

AI actors play from the **same stance machinery** — they bet conviction, play face up/down, fold. The GM configures *which* seats are AI, their disposition (cooperative / adversarial / wildcard), and how aggressively they bet. Inferred-prior seats and AI actors are the same substrate; the difference is whether the seat *plays in rounds* or just contributes priors before the room.

### 7b. Red teaming
A first-class role, not just a hostile stance. A **red-team perspective's job is to attack the table's consensus** — find the future the room is under-pricing and bet it. Mechanically it's an AI actor (or human) configured to:
- bet *against* the modal continuation (push mass into the tail),
- target threads the table has converged on (consensus = attack surface),
- be scored on **finding the divergence reality rewards**, not on matching the room.
Red teaming is how rehearsal stays honest — it's the structural defense against a room that only rehearses the future it already believes. Ties directly into A5 (divergence → next thing to capture).

**The red team is also what makes information a resource.** Revealing costs no budget — so the *only* thing that makes a face-down card worthwhile is that a face-up one can be **exploited.** The red team is that predator: it reads every face-up card for the consensus it can attack, so disclosing a stance is genuinely dangerous. Remove the red team and showing is consequence-free → everyone plays face up → concealment is pointless → the hidden-information game (invariant #4) collapses. So the red team isn't a flavour role; it's the structural reason concealment, selective disclosure, and communication-through-play exist at all. Players protect their read from it and reveal only when the upside (coordinating, signalling, steering) beats the exposure. That tension is the live game.

### 7c. Causal actions (cards that act on other cards)
The frontier, and the part that turns this from parallel betting into a *game*. Some cards don't just bet an outcome — they **change what other players can do**:
- **Block** — *if I play this, you cannot play that.* (A move forecloses an opponent's option.)
- **Force** — compel another seat to play (no fold) on a given thread.
- **Reveal** — flip an opponent's face-down card (screening → information).
- **Gate / enable** — a play that unlocks an outcome that was otherwise unavailable.

These map to the reasoning-graph edge types the engine already uses — `constrains`, `requires`, `enables`, `risks`. A causal card is a **typed edge played onto the table**: it rewrites the option space for the round, not just the odds. This is also where the deepest design risk lives — causal cards can create dominant strategies, lock loops, or kingmaker dynamics. **Needs the most careful balancing.** (Open question: are causal cards a separate deck from stance cards, or a property some stance cards carry?)

---

### 7e. Causal resolution — the round's cards generate the continuation graph (default)
The default way a round resolves: **the cards played become the inputs to a causal reasoning graph (CRG), and the engine generates the realistic continuation from it.** This is the CRG doing its native job — abduction: *committed outcome ← the most realistic causal path to it.*

- **Played stance cards → `fate` nodes.** The committed outcomes are the fate the arc must reason toward. **Conviction weights load-bearing-ness**: a high-conviction card is a central commitment the graph must honor; a low one is soft and may be overridden by the chain.
- **Causal cards (§7c) → edges.** Block / force / gate plays are seeded directly as `constrains` / `requires` / `enables` / `risks` edges — a round's cards are a *partial CRG*, and generation completes it.
- **Generation builds the realistic chain.** `generateReasoningGraph` (abduction by default) fills in the substrate / reasoning / warning nodes that make the collective bet coherent. Scenes then execute the graph → the rehearsed continuation.
- **This is how the world pushes back (invariant #1).** Wishful or mutually contradictory bets can't abduce a clean path — the graph sprouts `warning` / `chaos` nodes or forces a realistic reconciliation the players didn't intend. The CRG is the realism check on the table's wishes; you weighted the outcome, the graph decided whether the world can get there.
- **This is also the calibration signal (invariant #2).** Players are scored on whether the generated continuation matched their bet. Because the CRG abduces realistically rather than rubber-stamping, a miscalibrated bet shows up as a strained or ruptured graph — that *is* the feedback.

Relationship to the variable cohort: **softmax says how likely, the CRG says what happens and why.** They're complementary; the CRG is the default *generation* path for the resolved branch.

**This is a general resolution function, not a card-game feature.** Causal resolution is *how Meridians makes sense of divergent stances held by different perspectives* — human players, AI actors, inferred seats — whoever is involved. The rehearsal round is one source of those stances; **the weekly prior collection is the other.** When a week of per-perspective priors resolves (ROADMAP A3), it produces the same input: multiple actors holding divergent positions on shared open threads. A flat aggregate (average / softmax alone) discards the causal structure and the disagreement. The CRG reconciles them — it abduces a continuation where the perspectives *interact causally* (A's commitment constrains B's, the adversary's stance forces a contingency), producing a realistic continuation rather than a blurred mean. So both surfaces — the card game (fast, discrete, round-based) and the prior collection (slow, accumulated, weekly) — feed **the same causal resolution engine.** They're two clock speeds of one game (§1): the only difference the resolver sees is whether a stance arrived as a discrete card or as a week's accumulated priors.

*(Open: how literally do played cards / per-perspective stances map to fate nodes — 1:1, or synthesized? How is contradiction surfaced — a visible chaos node, a failed showdown, a forced reconciliation? §9.)*

### 7f. The world as a seat (external actors)
There is **no separate shock subsystem.** External events are just a perspective's plays. A world can be set up with **world-power actors** — *God / Nature*, a *Central Bank*, a *Market*, a *Regulator* — characters whose remit is the events no ordinary player controls. They're seated like any perspective (usually AI-played, §7a), hold their own open questions, and play cards under the **same budget and turn order** as everyone else.

- A hurricane is the **Nature** seat playing a card. A rate hike is the **Central Bank** seat playing a card. A crackdown is the **Regulator** seat playing a card.
- They're bound by the same rules: a Central Bank has a **budget** (limited interventions), takes its slot in the **turn order**, and its cards enter resolution as `fate` / `chaos` nodes in the CRG (§7e) like anyone's.
- **Volatility is configuration, not a dice roll** — how active or aggressive a world-actor is, and whether it's even seated, is set at world / round setup. A calm round leaves Nature unseated; a turbulent one seats an aggressive Central Bank.
- **Responding to a world-actor is ordinary causal evaluation** — the same *"someone played that, what do I play?"* decision under budget. Hedging against a possible rate hike is just spending budget to respond to the Central Bank seat. No special hedge mechanic, no exogenous-vs-adversary split.

The payoff is **one coherent system.** Every event — a player's bet, an adversary's move, an act of god — is *a perspective playing a card under budget and turn order, resolved by the CRG.* Nothing sits outside the rules; the "outside" is modeled as a seat. (The fat tail still lives in resolution — it's the genuine uncertainty the CRG samples — but deliberate external events are *authored by world-actor seats*, not rolled.)

## 8. How this wires into the shipping engine

| Card-game concept | Existing primitive |
| --- | --- |
| Round setup (scope) | `Location` / `Character` entities + a direction vector / arc premise |
| Stance card (chosen) | open question + stance (threads, `thread-log`) |
| Dealt hand (RNG) | sampled from cohort priors / stance distributions (plausible-for-perspective) |
| Reveal / signal | face-up vs face-down play; *free* — a signalling choice, the only communication channel |
| Bet / conviction | stance `volume` / attention weight |
| Face up / face down | signaling / screening (game-theory axes) |
| Showdown ranking | variable cohort `priorLogit` → softmax (how likely) |
| Showdown generation (default) | cards → CRG → realistic continuation (`generateReasoningGraph`, abduction) |
| Conviction → node weight | high-conviction card = load-bearing `fate` node |
| Branch per round | Compass scenarios → sister branches (`scenarios-engine`) |
| Calibration / ELO | margin score → ELO (`game-theory.ts`) — *reused, not prioritised; accrues over the slow game* |
| Sealed face-down card | Butterfly sealed decision (ROADMAP A6) |
| Causal cards | reasoning-graph edges (`constrains` / `enables` / `requires` / `risks`) |
| Budget | the spine — cost to play a card; revealing is free (no shipped primitive; new) |
| Card cost | improbability-priced: conviction × (−log p), p = cohort softmax / stance prob |
| Turn order | GM setting: deterministic (poker) or randomized |
| World-power actor (God / Central Bank / Nature) | an AI-played `Character` seat; its cards *are* the external events |
| Hedge / contingency | budget spent responding to a world-actor seat (ordinary causal evaluation) |
| AI actor / inferred seat | A1 inferred priors |
| Red team → next capture | A5 divergence hand-off |

---

## 9. Open questions (refine here)

- **GM-as-player fairness** — *decided:* the GM may play a perspective or opt out to pure refereeing; world-power seats stay AI (§3, §7f). Still open: when the GM plays, how is the master-device information edge (visible stance distributions / priorLogits) neutralised — commit-before-seeing, a blind mode, or trust?
- **Scoring** — *decided:* not prioritised; reuse the existing game-theory ELO, fast-game feedback is cost + consequence (§4). Still open: do we ever surface a cross-session ladder, and is "influence" ever computed or left purely conceptual?
- **One board thread vs several** — does a round ever put multiple threads in play?
- **Round-setup authorship** — GM-authored, engine-proposed-then-GM-approved, or both? Can the engine suggest a round concept + scoped locations/characters from the resolved state, with the GM editing?
- **Turn order** — does *random* reshuffle per round or per go-around? Do world-power seats get a fixed slot (e.g. Nature always resolves last) or shuffle in with everyone?
- **World-actor remit & budget** — what's in a Central Bank / Nature / Regulator seat's power, and how big is its budget? Always AI, or can a human play the world? Always seated, or only when the concept calls for one?
- **Causal-card deck** — separate deck, or a property of stance cards? How to prevent dominant/lock strategies?
- **The dealt (RNG) hand** — *decided:* each seat is dealt a *different* hand, which is what keeps contests clean (§2, §7d). Still open: what exactly the dealt non-stance cards are (causal cards? events? extra outcomes?), how much of a hand is chosen vs dealt, and whether that ratio shifts with difficulty.
- **Conviction budget** — confirmed as a mechanic and the GM's difficulty dial (§7d). Still open: per-round vs per-session pool, regenerating vs fixed, and whether folding refunds unspent conviction.
- **Card pricing curve** — confirmed: improbability-priced, cost ∝ conviction × (−log p) (§7d). Still open: does the price move *intra-round* as cards reveal and the market shifts (pari-mutuel style), or stay fixed at the pre-round prediction? Does conviction add a convex term of its own (quadratic-voting style) on top of the −log p factor?
- **Default resolution** — for an unplayed thread, does the system *sample* from the distribution (variance, occasional surprises even when no one paid) or take the modal/argmax outcome (deterministic, safe)? Sampling adds free chaos; argmax keeps the unpaid baseline boringly realistic. Possibly a GM dial.
- **AI actor transparency** — do humans know which seats are AI? Does the red team announce itself?
- **Where rehearsal commits** — confirmed: a showdown resolves *the branch* (the fork), never the canonical trunk thread. Rehearsal commits inside the sandbox.
- **Round count / end condition** — when does a hand end? When all but one fold? When the contested threads are exhausted?
- **Cards → CRG mapping** — do played cards become fate nodes 1:1, or are they synthesized into fewer? How does conviction translate to node weight numerically?
- **Surfacing contradiction** — when the table's bets can't cohere, how does the CRG show it: a visible `chaos` node, a failed showdown the room must redo, or a forced reconciliation the players have to accept?
- **Contested certainty** — *decided:* differentiated hands (no identical-card bid-war) + payment-weighted CRG reconciliation, both commitments partially manifesting (§7d, §2). Still open: the exact weighting of payment → fate-node weight in the reconciliation, and how visibly the engine shows *why* it reconciled the way it did (the legibility the resolution rests on).
