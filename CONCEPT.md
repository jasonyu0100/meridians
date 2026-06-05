# Conviction — Meridians' Rehearsal Card Game (CONCEPT)

> **The spec for [ROADMAP.md](ROADMAP.md) A4 (Rehearsal)** — *Conviction*, the War Room played as a card game on the substrate. **Conviction is the first rehearsal mode, not the only one** — rehearsal is a pluggable layer over the shared resolver, so other game formats can ride the same substrate later; this doc specs the first. ROADMAP A4 defers here; the build plan is the **Tickets** section, the unknowns are in **Open questions**. Rides on the shipping engine (threads/stances, variable cohort, causal reasoning graphs, game-theory/ELO — see [CLAUDE.md](CLAUDE.md)). Vocabulary: [LANGUAGE.md](LANGUAGE.md).

---

## The core

**Why it's called Conviction.** The game is about **belief made visible.** Having conviction in what's true, *demonstrating it, and showing it to others* is what lets a team coordinate and succeed in chaos. Mostly you let the story unfold and read the table — but in the moments that matter, the move is **creating certainty: committing, hard, and forcing an outcome where everyone can see you do it.** It's a game of life, and it's meant to be intuitive — *conviction is the resource you spend, the signal you send, and the point.*

**The pitch.** Conviction turns the room's model of reality into a **wargame you can play.** A table of perspectives — allies, rivals, and the world itself — bets on what happens next: you spend a scarce budget to **buy certainty where you have conviction**, signal and bluff to coordinate or mislead, and let everything you don't pay for fall to chance. Then the engine plays the table's bets forward into a future you have to live with. Poker's read-and-commit nerve, a wargame's information conflict — run on your own substrate; **a fight against entropy that trains the one reflex strategy needs: committing well under uncertainty, and surviving the consequences.**

**Mechanically:** *perspectives play cards under a budget, in a turn order, resolved by a causal graph into kept branches* — the **fast twin of Capture** (same threads, stances, and resolver, played in a session instead of accumulated over a week; ROADMAP A1–A3). Build the capture resolver and you've built most of this.

**The turn — what you actually do.** Going around the table, on your turn you take **one action**: **Play** a card (commit to an outcome, pay its cost — *face-up* to signal, *face-down* to hide), **Raise** (pour more conviction into an outcome you've already backed), **Pass** (hold this go-around), or **Fold** (out for the round; threads you never backed fall to chance). When the table is done, the round resolves. Poker's grammar — *bet · raise · check · fold* — over claims about the future.

**The rules:**

1. **A card is a concrete claim about the near future** — *"gold closes below $2,400 this quarter," "the CFO resigns," "the regulator opens a probe."* It's a stance on one open thread (the same threads Capture uses); your hand is **~5–8 cards**, drawn from the threads your perspective cares about. Playing one commits you to that outcome.
2. **Conviction is the scarce resource — and it accumulates, up to a cap.** Each card costs **conviction** priced by improbability (`−log p`): the likely call is cheap, forcing a long-shot is dear. You draw a conviction **allowance each round, and unspent conviction banks — but only up to a cap.** Enough to save a war chest for the bet that matters, never an unlimited hoard, so sitting on conviction forever wastes it. The real game is *when* to spend: back cheap likely outcomes now, or save (within the cap) to force the improbable future you believe in. You can't back everything — that scarcity is the tension. Threads you don't back are **sampled from the distribution**; the GM sets the allowance and the cap (the difficulty dial).
3. **Revealing is free; face-up vs face-down is signalling.** The only communication channel is *play* — no cheap talk. Hiding is worthwhile only because the **red team** can exploit what you show.
4. **Turn order is configurable** — deterministic (poker) or random.
5. **At the end of a round, the cards build a CRG that determines how the future plays out.** The played cards become the inputs to a causal reasoning graph; that graph *is* the continuation — it abduces the realistic path from the cards and the round forks a kept branch. This is the **same resolver Capture's merge uses** (ROADMAP A3) — divergent stances reconcile causally, not as a blurred average.
6. **Perspectives are the seats** — a character, location, artifact, or the general narrator; human- or AI-played. The **world itself is a seat**: a hurricane is a location seat, a rate hike a Central Bank seat — external events are just a seat's plays.

**The one invariant — buy the outcome, not the consequences.** You can force an outcome (unopposed; contested, it's a payment-weighted reconciliation), but the engine owns the **fallout** — often a monkey's paw. Consequences are *state-dependent*, so players learning the world's causal patterns is the rehearsal value, not an exploit.

**What good play is:** high coordination between allies, run through **signalling** (what you show vs hide) and **budget control** (what you can afford to commit). Players own the strategy; the engine owns the verdict — which is what keeps the planning honest rather than self-graded.

---

## The dynamic

**What it trains — a fight against entropy.** The point is to *shape how strategists think.* The mechanics are the real disciplines of decision under uncertainty: **signal and read** (what to show, what to hide), **spend a scarce budget** (you can't back everything), **commit to your read and trust your gut** (paying to pin down what you believe is true). And the core move: **you buy certainty where you have conviction; everything you don't pay for resolves at random.** Play is a fight against **entropy** — spending scarce certainty to carve a coherent future out of a world that otherwise drifts to noise. The table is adversarial, so the disciplines of warfare — information, feint, coordination, defection — are embodied, not bolted on.

**A round, felt.** You're dealt a hand of concrete claims on the threads in play. You read the board and the other seats; decide what to back and how hard — the likely call is cheap, a long-shot is dear, and you can always **fold and bank your conviction for a round that matters more**. You choose what to **show** (to coordinate or bluff) and what to **hide** (so an adversary can't exploit it). Players negotiate in the open — then hands reveal and the round's cards **build the causal graph that writes what happens next.** You get the outcome you paid for, plus whatever the world does about it. The board moves; the next round deals.

**Concretely (a markets room).** The thread on the table: *"does the central bank hold or cut?"* The dovish seat backs **cut** cheaply — it's the modal call. A hawk, convinced of a surprise, spends heavily to force **hold**, face-down. Allies signal to line up behind one read; the adversary seat bets the tail. At showdown the cards resolve into a continuation — rates hold, but the graph abduces the inflation scare that *made* them hold, and the seat that forced it watches its other positions take the hit. The room learns which priors were wrong; the next round opens on the new world.

---

## Key concepts (in brief)

- **Hands are differentiated and part-dealt.** Each seat gets a *different* hand: chosen stance cards (its own open questions) + RNG-dealt cards sampled from world-model distributions. Differentiation is what keeps contests clean — no two seats hold the identical card to bid head-to-head, so opposition is always *different cards* the CRG reconciles.
- **Red team is emergent, not a coded role.** It's just what an *adversarial* seat does — bet against the modal, target converged threads. Give a seat a hostile disposition (an AI seat, R6; or a human with opposed interests) and it red-teams; nothing to build. It matters because it's *what makes information a resource* — without a predator reading your reveals, hiding is pointless and the signalling game dies. Opposed interests are the precondition for the whole hidden-information game, not a feature on top of it.
- **AI & world seats.** The GM configures AI players (gap-fill / adversary) and world-power seats; all play under the same budget + turn order. Reuses Capture's inferred priors (A1).
- **Causal cards (frontier).** Block / force / reveal / gate — cards that change what *others* can play, expressed as reasoning-graph edges. Highest balance risk; prototype before building.
- **GM = facilitator, optionally a player.** Runs setup / turns / generation; may take a seat or pure-referee; **never pilots the world seats** (the engine owns consequences). Exactly one GM per room (ROADMAP guardrail).
- **Where it commits:** a showdown resolves *the branch* (a kept fork), never the canonical trunk — rehearsal is a sandbox.
- **Scoring isn't the point.** Reuse the existing game-theory ELO (`game-theory.ts`) if a ladder is wanted; the real feedback is **cost + consequence**.

---

## Tickets (ROADMAP A4)

> Build the fast game on the capture substrate (A0–A3) — **two speeds, one game**, so most of this is *reuse, not new engine*.

- **R1 · Round setup.** GM scopes the play area: locations (subset of `Location`), playable perspectives (A0), a round concept (direction vector / premise); one contested thread is "the board." *Reuses:* A0 + `Location`/`Character`.
- **R2 · The hand.** Deal each seat a *different* hand — chosen stance cards (its open threads) + RNG-dealt cards from world-model distributions. *Reuses:* A1 threads/stances.
- **R3 · Conviction budget & pricing.** A conviction pool per seat that **accumulates to a cap** (allowance each round, unspent banks up to a ceiling); cost = `−log p` of the chosen outcome; unplayed → sampled; GM sets allowance + cap (difficulty dial). *Reuses:* A2 stance/cohort distributions.
- **R4 · Play loop.** Configurable turn order; go around the table; each seat plays (face up/down — free) or folds. *Reuses:* UI/state over the hand.
- **R5 · End of round → build the CRG.** The round's played cards build a CRG that determines the future: cards → fate nodes (conviction-weighted; contested = payment-weighted reconciliation) → realistic continuation → kept branch (trunk stays open). *Reuses:* **A3 causal resolver** (the two-speeds payoff).
- **R6 · AI & world seats.** GM-configured AI players (with disposition — cooperative / adversarial / wildcard; an adversarial one red-teams) and world-power seats (location/artifact/general) playing under the same rules. *Reuses:* A1 inferred priors + A0 perspectives.
- **R7 · Causal cards (frontier).** Block / force / reveal / gate as reasoning-graph edges. Highest balance risk — design carefully, build last. *Reuses:* edge types + R5.

---

## Open questions (settle during design)

- **Contested certainty** — exact weighting of payment → fate-node share in the reconciliation, and how the engine *shows* why it reconciled (the legibility the whole resolution rests on).
- **Conviction budget** — *decided:* it accumulates (allowance each round + unspent banks) **up to a cap**, so saving for a big forced bet is a real play but unlimited hoarding isn't. Still open: the allowance size, the cap, and whether folding refunds.
- **Pricing** — fixed at pre-round prediction, or moves intra-round as cards reveal (pari-mutuel)? Any convex term on conviction on top of `−log p`?
- **Default resolution** — unplayed thread *sampled* (variance) or *argmax* (safe)? Possibly a GM dial.
- **The dealt hand** — what the dealt non-stance cards are (causal? events? extra outcomes?), and the chosen-vs-dealt ratio.
- **Round shape** — one board thread or several? When does a round end (all fold / threads exhausted)?
- **GM-as-player fairness** — when the GM plays, how is the master-device info edge (visible distributions) neutralised?
- **Transparency** — do players know which seats are AI? Does the red team announce itself?
