# Conviction — Meridians' Rehearsal Card Game (CONCEPT)

> **Spec for [ROADMAP.md](ROADMAP.md) A4 (Rehearsal).** Conviction is the War Room played as a **turn-based card game** on the shipping substrate — threads/stances, **streams/priors**, **merges**, **locations** ([CLAUDE.md](CLAUDE.md)). This doc is implementation-first: the **game loop as a state machine**, and the **type model** that backs it (what we reuse, what's net-new). Vocabulary: [LANGUAGE.md](LANGUAGE.md).

---

## In one paragraph

**Conviction is a game of fates** — each seat shapes the **fate of its character**, and of the world, through the **conviction it holds in its beliefs**. It's the engine's thesis made playable: **Fate** is the force, the world view's **streams / stances** are the beliefs, **conviction** is what moves them — so to have influence is to back what you believe hard enough that the world bends to it. Round by round, perspectives (allies, rivals, the world itself — human or agent) are dealt **cards** — concrete claims on open questions, priced by how *unlikely* they are — and spend scarce conviction to **play** them, *face-up* to signal or *face-down* to hide. The table's commitments fold into a **merge** the engine plays forward into a kept **branch** you then live in. It's **Capture run live** — the same streams, priors, and resolver, a week compressed into a session. No assigned goals; the spine is **agency + consequence**, scored only by how much **Fate** you drove.

---

## What it feels like

You don't *predict* the future here — you **author** it, then live in it. Every card is a belief you've *paid* for, so the game makes your certainty honest. Play it like poker — bluff face-down, stake your name face-up, ally and betray at the reveal — except the pot is **what happens next**, and your **conviction stack sits on the felt for all to read**. A fat stack is a standing threat the table has to answer; the signature move is to **build it in the open, then spend it to bend one pivotal call's odds so far the draw is a formality** — the world still owns the snap, and you wear the fallout, monkey's-paw and all. The branch **remembers** the fate you bent. What it trains is the edge that outlasts better models — **the nerve to commit.**

---

## How to play

**Streams are yours.** A **stream is owned by one perspective** — *your* private bearing on an open question (the shipped `Stream`: one member-owned stance + its priors). There are **no shared "board" streams**: the shared, visible layer is the world's **canonical threads**, and each seat holds its **own** streams — its private bets on where those threads land. You open, work, and play **only your own streams**.

A turn, concretely:
1. **Open & work your streams.** Pose the open questions you want to drive — each becomes a **new stream you own** — and update **priors** on streams you already hold. A plausible prior (admissibility-gated) shifts your stance's odds, which both **re-prices your cards** and **earns conviction** for the information it moves. This is "working the model": you reshape *your own* streams before you bet them.
2. **Play cards on your own streams.** A card commits **conviction** to one outcome of *one of your streams* — *face-up* (cheaper, telegraphs the call) or *face-down* (priced concealment, only if the GM allows it). You never play on another seat's stream; you assert **your** version and back it as hard as you can afford.
3. **The Merge reconciles — contention is indirect.** At RESOLVE every seat's committed streams fold into the round's **`Merge`**. Where two perspectives' streams **claim the same thread differently**, they don't collide on a shared pot — they collide *at the merge*, which weights the conflicting claims by **committed conviction** and writes the heavier one into the **canonical continuation** (compatible claims can multi-resolve; never averaged). You don't outbid a rival *on their stream* — you out-commit them on the **shared outcome** both your streams bear on.
4. **Live with it, then get scored.** The continuation generates, the canonical threads move, and **SCORING** attributes that movement back to whoever's streams drove it (§The scoring math). You're scored on **Fate moved**, never on whether your particular claim "won."

So the skill loop is: **open the right questions, bend their odds with honest priors, and spend conviction where your bearing can actually move a thread** — then let the merge turn the table's separate, owned streams into one world.

---

## The game loop (state machine)

A game is a **branch**; a `GameRoom` runs over it. **Chat (global + location) is always open** — it runs through *every* phase, not just the narration windows. Setting or reassigning a personal **goal** and **requesting a new quest** (asking the GM to open a thread) are likewise always-available, conviction-free actions. Humans take their turns by hand; agents resolve theirs automatically.

**Two variants — Rounds & Showdown** (`GameRoom.variant`). They differ **only in the commitment mechanism** — *how seats spend conviction and signal*. Everything else is shared: narration, the merge→generate resolution, the conviction economy, branch isolation, the reveal window, and the *One window* GM progression below.

- **Rounds** *(default — slower, more strategic)* — a **sequential, deterministic phase machine**: one known state at a time, seats acting **one at a time in poker turn order** (rotating button) through discrete READ and PLAY phases. You watch the table commit before you do. The canonical loop, specified below.
- **Showdown** *(faster, more dynamic)* — **real-time and simultaneous**: no turn order, no button. A single **LIVE window** opens and **every seat works the model and plays cards at once** against one shared clock, watching face-up plays land live and re-signalling until it closes. Trades deliberation for tempo.

Both close the same way: when the round/window ends, committed cards assemble into the round's `Merge` and the engine plays it forward (§RESOLVE → §SETTLE).

**What it's a game of — communication as much as calculation.** Your one channel to bend the world is the **prior**: a claim you articulate well enough that the resolver finds it **admissible** *and* is genuinely **moved** by it. Writing the **meaningful, legible prior** — structuring your reasoning so the AI understands and shifts the canonical odds toward your outcome — is the core craft, because that shift is what makes a **long-shot cheap** (push `p` up and its `−ln p` cost falls) and tilts the **draw** your way. So Conviction is four games at once: **communication *with* the AI** (priors it understands and believes), **communication *between* players** (chat, alliances, bluffs), **strategy *against* the AI** (the tempo duel below, AI-driven rivals), and **management of risk and probability** (the conviction economy and the draw). The edge it trains isn't only nerve — it's the ability to **make your thinking legible to a model and a table at once**.

**What's being tested — judgement under tempo.** In human-vs-AI play the rehearsal target is the **human's ability to decide well under time pressure against an agent that makes near-instant, fully-contextual moves**. That asymmetry is the point — it pressures the one edge meant to stay human — and the two variants stress it differently. **Showdown** is **raw real-time pressure**: the AI commits and re-signals the moment the window opens, crowding your decision space while you're still reading the board. **Rounds** is **bounded-clock deliberation**: you get a dedicated turn, but the contrast between your finite think-time and the agent's instantaneous, perfectly-informed reply is the felt edge — and it compounds across turns. Tune `TIMER_*` to set how hard either bites.

**One window, automated.** Conviction is a **gamified layer over the shipping stream / merge / generate UI** — it doesn't replace those surfaces, it **wraps and automates** them into one continuous, immersive window for GM and players. The **board is the shared surface** everyone watches the game through (§Surfaces); the **Generate Panel is the GM's progression control inside that same window** — a GM-only overlay on the board, not a second screen — through which the GM advances the round in **one click** (deal, pricing, the narration batch, income/decay all run automatically). Results render onto the board for the table. The GM can always **override** — expand that control to drop to the underlying stream/merge tools and edit — because they're the GM. Players never see the Generate Panel; they see only the board and their hand.

### Rounds (the default loop)

```
SETUP ─▶ [WAITING?] ─▶ ROUND ─▶ ROUND ─▶ …
                         │
   ┌─────────────────────┴───────────────────────────────────────────┐
   ▼                                                                   │
PUBLIC_NARRATION ─▶ PRIVATE_NARRATION ─▶ READ WRITE ─▶ PLAY ─▶ RESOLVE ─▶ [SHOWDOWN] ─▶ SETTLE ─▶ SCORING ─┘
```

1. **SETUP** *(GM, desktop)* — GM builds the `GameRoom`: picks the **locations** in play, **creates and seats perspectives** (each assigned a driver — `human` / `agent` / `gm-proxy`; a **human seat must bind a registered `Member`** from the members table, and any seat with no member is **filled by an agent**), sets the opening **roster**, and dials the **conviction economy** (income, decay) — with all **timing + economy values tweakable under Advanced settings** (§Constants). Chooses the **variant** (`rounds` = turn-ordered & strategic / `showdown` = real-time & fast) and the **mode**: `computer` (single screen, GM proxies everyone — start immediately) or `remote` (players join their own controllers — go to WAITING). *(Showdown wants `remote`; see Access & play modes.)*
2. **WAITING** *(remote only)* — a waiting room: seats join via per-seat link/QR (`status: pending → joined`). GM **starts** when ready; unfilled competitive seats fall back to `agent`.
3. **PUBLIC_NARRATION** — **delivers** the **public** narration that brings the table up to date on the game's status (pre-generated in the RESOLVE batch off the canon; round 1 narrates the opening state). Public, everyone, first. A timer runs; chat is open (global + location).
4. **PRIVATE_NARRATION** — then **delivers** each seat's **private** `PerspectiveView` — its **special context** (continuity + vantage), from the same RESOLVE batch. Strict delivery order: **public → private**. Timer runs; chat continues. Players may also pull **non-canon views** of past scenes while reading.
5. **READ WRITE** — each seat is dealt its **hand** — cards on **its own streams** (ones it has opened, plus engine-sampled candidate streams seeded to its vantage) — then **works the model**: it can **update priors** on its existing streams (shifting the odds → re-pricing those cards) and **open new streams it owns** by **posing open questions** (fresh perspective-owned streams that, once admissible, **deal new cards**). This write-back is where **emergent play** comes from — each seat reshapes **its own** streams before betting them. A seat may also take its **one move** here — a single hop on the location tree — which changes **the streams it holds** (it's dealt against its new place) and **who it shares location chat with**. Bounded by the read timer; stand pat to skip.
6. **PLAY** — **poker turn order** (rotating button). On a turn a seat **plays** card(s) on **its own streams** *face-up* (cheaper, telegraphs the call) or *face-down* (`× FACEDOWN_PREMIUM`, concealed — but force-flipped if its claim is contested at the merge), **raises**, **passes**, or **folds** — every card costs `≥ COST_MIN > 0`, up to `CARDS_PER_ROUND` commits total, so a seat can't flood the merge with cheap near-certain cards. Agents auto-resolve their turn from their feed. If a seat's **turn timer expires with nothing committed**, that's **no action** — it cedes, leaving the question to the LLM, which the rest of the table's commitments already sway.
7. **RESOLVE** — after the table is done comes the **reveal window**. **By default (`FORCED_REVEAL` on) every play flips open here** — full transparency, the recommended table. If the GM has turned forced reveal **off**, the window instead has **teeth**: any **contested matter** — two or more seats' committed streams claiming the same thread differently — triggers a **forced reveal**: *every* committed play bearing on it, face-up **and** face-down, is **flipped into the open** before the merge settles the contest (per **`RESOLVE_BIAS`** — §Contested settlement), poker-style (a challenged claim is always called) — while plays on **uncontested** claims may stay concealed at the player's discretion, and **voluntarily revealing** one whose outcome resolves **executive** earns a **reputation mark** (ELO) plus an optional conviction **rebate** (`REVEAL_REFUND`); keeping it dark **forfeits both**. (The engine/GM always sees every play regardless; the teeth govern what the *table* sees and what concealment costs.) Then the GM advances the round with **one click through the existing Generate Panel**: the played cards **pre-fill the merge's resolutions** (**executive** = drives the continuation; **recorded** = rides along, non-driving) — the GM can **override** any before generating, or just click through; fully automated, it generates with no input. The merge → the engine generates the continuation (one scene/beat) → a kept branch entry. **Narration is canon-first, then a parallel fan-out:** the **canonical** continuation generates once (ground truth), then a **single batched set of parallel calls** renders the **public** perspective and **every seat's private** `PerspectiveView` off it. That batch is the **next round's narration**, delivered in order (PUBLIC → PRIVATE) though generated together — closing the loop. The raw **canon stays GM-only**; players only ever receive the public layer and their own private view.
8. **SHOWDOWN** *(optional — `SHOWDOWN_PHASE`, default on)* — a spotlight beat **before the economy moves**: each **contested thread** is shown down — its contestant outcomes, the conviction/odds behind each, and the **`RESOLVE_BIAS`** verdict (how fate settled it: a draw, the likeliest, or the rarest) — so the table sees *how* the world decided. Pure presentation, no state change. Off → settlement stays silent inside RESOLVE and the loop jumps straight to SETTLE (fast / Showdown rooms often skip it). A timer runs; chat is open.
9. **SETTLE** — **decay** each seat's carried balance first (`× α = 5/6 ≈ 0.83`), **then** grant fresh **income** (so the new allowance isn't taxed the round it arrives).
10. **SCORING** — the round's **Impact** is revealed. Each thread's realized round-fate is decomposed across the seats that moved it (§The scoring math), every seat's **FateCredit** banks into its running total (`Seat.fateImpact`), and the table sees the **round readout** — authored stance ribbons + the round-decomposition streamgraph (§The round readout) — alongside the updated **Ranking**: the live leaderboard, seats ordered by total Impact, so everyone sees who's driving the world. A timer runs (`TIMER_SCORING`); chat is open. Then loop to PUBLIC_NARRATION for the next round.

### Showdown (the real-time loop)

Same skeleton, but **READ-WRITE and PLAY collapse into one concurrent LIVE phase** — there is no turn order, no rotating button, no per-seat clock. All seats act at once against a single shared `TIMER_LIVE`.

```
SETUP ─▶ [WAITING?] ─▶ ROUND ─▶ ROUND ─▶ …
                         │
   ┌─────────────────────┴─────────────────────────────────┐
   ▼                                                         │
PUBLIC_NARRATION ─▶ PRIVATE_NARRATION ─▶ LIVE ─▶ RESOLVE ─▶ [SHOWDOWN] ─▶ SETTLE ─▶ SCORING ─┘
```

- **SETUP / WAITING / PUBLIC_NARRATION / PRIVATE_NARRATION** — identical to Rounds. (Showdown leans on tighter narration timers to keep tempo, but the content and public→private order are unchanged.)
- **LIVE** *(replaces READ-WRITE + PLAY)* — one open window in which **every seat works the model and bets simultaneously, in real time**. Throughout the window a seat may, in any order and as often as conviction allows: **update priors / open streams** (re-pricing its cards live), **move** (its one hop), and **play card(s)** *face-up* or *face-down* (`× FACEDOWN_PREMIUM`), **raise** (commit more on an open play), or **withdraw** a face-up play before lock-in. **Face-up plays broadcast the instant they land** — that's the live signal; the table watches commitments accumulate and can answer them while the clock runs. Constraints carry over unchanged: each card costs `≥ COST_MIN`, a seat commits at most `CARDS_PER_ROUND`, every prior is admissibility-gated, and **contested threads force a reveal at RESOLVE and settle per `RESOLVE_BIAS`** exactly as in Rounds. The window **closes when `TIMER_LIVE` expires OR all active seats have *locked in*** (stood pat) — whichever first; agents commit continuously off their feed. A seat that commits nothing before close has **ceded**, exactly as a Rounds timeout does.
- **RESOLVE / [SHOWDOWN] / SETTLE / SCORING** — identical to Rounds: locked-in cards (face-up + face-down) → the round's `Merge`, the **reveal window** follows `FORCED_REVEAL` (forced by default; discretionary-with-teeth if off), **contested threads settle per `RESOLVE_BIAS`** (a random draw from the conviction-shaped odds by default; never turn-order-weighted), optionally spotlighted in **SHOWDOWN**, then decay → income, then the **Impact readout + Ranking** (§The round readout). `playedAt` orders simultaneous commits for any tie-break the resolver needs.

**Mode fit.** Showdown assumes **independently driven seats** — its value is many hands moving at once, so it's a **`remote`-mode** variant (players on their own controllers + agents). In `computer` mode one GM can't proxy simultaneous seats, so Showdown there degrades to the GM sequencing plays by hand — at which point you may as well run Rounds.

---

## Type model

### Reused (shipping — see [CLAUDE.md](CLAUDE.md))

| Game concept | Existing type / fn |
| --- | --- |
| **Seat vantage** | `Perspective` (`kind`, `entityRef`, `memberIds`, `agentId`) |
| **Who drives a seat** | `Member` (human) · `Agent` (AI persona) |
| **Open question + belief** | `Stream` (`outcomes`, `stance`, `priors`) — **one per perspective** (member-owned) |
| **A prior (belief move)** | `StreamPrior` (`updates`, `logType`, `volumeDelta`, `at`) |
| **Belief math** | `Stance` (`logits`/`volume`/`volatility`); `streamProbs`, `streamTrajectory` |
| **Card cost / rarity** | scaled `−log p` (0–100) from `streamProbs` |
| **Submit a prior** | `ADD_STREAM_PRIOR` + `scoreStreamPrior` (admissibility/bias) |
| **Round resolution** | `Merge` + `MergeResolution` (single, or multi-resolution) → merge→generate |
| **Place / proximity** | `Location` + `positions` |
| **Game isolation** | a **branch** (streams/merges branch-scoped) |

### New (the game layer)

```ts
// One live session, over one branch. The only always-mutating game object.
interface GameRoom {
  id: string;
  branchId: string;                       // a game IS a branch
  variant: 'rounds' | 'showdown';         // commitment mechanism: turn-ordered vs real-time concurrent
  mode: 'computer' | 'remote';            // single-screen GM-proxy vs distributed
  phase: 'setup' | 'waiting' | 'round';
  locations: string[];                    // play area (subset of Location ids)
  seats: Record<string, Seat>;
  economy: ConvictionEconomy;             // GM-owned
  round: RoundState | null;
}

// A Perspective bound to a driver + its play state.
interface Seat {
  id: string;
  perspectiveId: string;                  // existing Perspective
  driver: 'human' | 'agent' | 'gm-proxy'; // human decides; agent automates; GM proxies
  memberId?: string;                      // REQUIRED for driver='human' — a registered Member (members table)
  agentId?: string;                       // for driver='agent' — fills a seat with no assigned member
  status: 'pending' | 'joined' | 'playing' | 'spectating';
  conviction: number;                     // current balance (income − spend, decayed)
  locationId: string;                     // current node (positions)
  movedThisRound: boolean;                // enforces one hop / round
  goals: Goal[];                          // personal targets (0+); private or public; reassignable any time; do NOT affect score
  fateImpact: number;                     // THE score — running attributed share of Fate moved across all threads (direction-agnostic; §scoring)
}

// GM-owned scarcity. Balances live on Seat.conviction.
interface ConvictionEconomy {
  income: number;                         // allowance granted each SETTLE
  decayAlpha: number;                     // tax on banked balance before income; ceiling = income/(1−α) = 150 (the dearest possible play: max card × facedown premium)
}

// The per-round machine. Rounds walks read-write → play (sequential);
// Showdown collapses both into a single concurrent 'live' phase.
type RoundPhase =
  | 'public-narration' | 'private-narration'   // both variants
  | 'read-write' | 'play'                       // Rounds only — sequential, turn-ordered
  | 'live'                                       // Showdown only — read-write + play, concurrent
  | 'resolve' | 'showdown' | 'settle' | 'scoring'; // both variants ('showdown' = optional contested-thread spotlight; scoring = Impact readout + Ranking)

interface RoundState {
  index: number;
  phase: RoundPhase;
  turnOrder: string[];                    // ROUNDS ONLY — seatIds, rotated each round (poker)
  buttonSeat: string;                     // ROUNDS ONLY — dealer button
  activeSeat: string | null;              // ROUNDS ONLY — whose turn in PLAY (null in Showdown)
  lockedIn: string[];                     // SHOWDOWN ONLY — seatIds that stood pat; all locked → close LIVE early
  openThreadIds: string[];                // canonical threads (matters) live this round — SHARED & visible. Streams that bear on them are PER-SEAT (in hands); the merge folds them onto these threads.
  hands: Record<string, Hand>;            // per seat
  pot: number;                            // committed conviction this round
  viewIds: string[];                      // the round's PerspectiveView batch (canon + public + per-seat private).
                                          // An UNORDERED render set, not a delivery queue: ordering is a phase
                                          // concern — PUBLIC_NARRATION pulls scope 'public', PRIVATE_NARRATION
                                          // pulls each seat's 'private', so public→private lives in the machine,
                                          // not the list. The canon id rides along for GM browsing only — it is
                                          // never delivered in any narration phase.
  timers: Partial<Record<RoundPhase, number>>; // ms remaining per timed phase
  mergeId?: string;                       // set at RESOLVE — the round's Merge
}

// A card = a conviction commitment on one outcome of ONE OF THE SEAT'S OWN streams (streams are 1-perspective).
interface Card {
  streamId: string;                       // a stream this seat owns
  outcome: number;                        // the chosen outcome — playing the card IS choosing it on YOUR stream
  cost: number;                           // clamp(COST_MIN, 100, round(RARITY_SCALE × −ln p)); live from streamProbs. Floor > 0 — never free.
  origin: 'chosen' | 'dealt';             // a stream the seat opened, vs an engine-sampled candidate seeded to it (still its own)
}
// A seat MAY play multiple cards on one stream (back several outcomes), but that
// only lands as intended if the question genuinely supports multi-resolution
// (MergeResolution multi) — otherwise the commitments contend. The engine allows
// it; knowing when it helps is the player's edge.

interface Hand {
  seatId: string;
  cards: Card[];
  played: PlayedCard[];
}

interface PlayedCard {
  card: Card;
  faceUp: boolean;                        // open (visible) vs face-down (hidden). Face-down's effective cost = card.cost × FACEDOWN_PREMIUM — concealment is paid.
  revealed?: boolean;                     // face-down card shown to the table at the reveal window (voluntary OR forced)
  forcedReveal?: boolean;                 // true → flipped by a forced reveal (contested thread), not chosen. Only a VOLUNTARY reveal (revealed && !forcedReveal) of an executive outcome earns the REVEAL_REFUND / reputation.
  conviction: number;                     // committed amount (≥ effective cost; raise = more)
  playedAt: number;
}

// Talk is cheap — chat binds nothing; only played cards bind. Agents are full
// participants: you can negotiate with (or be misled by) an AI seat in chat.
interface ChatMessage {
  scope: 'global' | 'location';
  locationId?: string;                    // set for location scope (proximity-gated)
  seatId: string;                          // a human OR an agent seat
  text: string;
  at: number;
}

// READ-phase "request more cards": pose an open question → open a Stream → deal.
interface CardRequest {
  seatId: string;
  question: string;                       // the open question posed
  // → ADD_STREAM_PRIOR seeds a new Stream from intuition; scoreStreamPrior gates;
  //   admissible → new Cards appended to the seat's Hand.
}

// A seat's personal GOAL — a self-set target it wants to track. PURE PERSONAL AID:
// goals never touch the score (Impact = Fate moved), so whether you HIT a goal
// changes nothing about your number. They orient your own play and feed the
// optional end-game debrief. Set zero or many; reassign any time, free.
interface Goal {
  seatId: string;
  threadId: string;                       // the open-ended thread (Stream) this goal is about
  targetOutcome: number;                  // the outcome this seat wants
  visibility: 'private' | 'public';       // keep it to yourself, or declare it to the table — the seat's call, per goal
  at: number;                             // (re)declared timestamp; binds nothing, costs no conviction
}

// A scene rendered at a visibility tier — the ONE narration / perspective type.
//   canon   = GM-only ground truth      (no perspectiveId)
//   public  = everyone                  (no perspectiveId)
//   private = one seat's vantage        (perspectiveId set)
// The round's narration is a parallel batch of these off the canon at RESOLVE
// (one canon + one public + one private per seat). The SAME type backs a
// player's on-demand non-canon retelling of a PAST scene (scope 'private', an
// older sceneId). Cached by (sceneId, scope, perspectiveId); the text reuses
// context.ts's perspective-coded narration.
interface PerspectiveView {
  id: string;
  sceneId: string;                        // the scene being (re)told
  scope: 'canon' | 'public' | 'private';
  perspectiveId?: string;                 // set only for scope 'private'
  text: string;
  at: number;
}
```

**Continuity context.** Every seat — human or agent — carries its **continuity context** (its `Perspective`'s logs + the canon scene narrations it's entitled to). Agents play purely off that. A human can additionally **request a `PerspectiveView`** (scope `private`) of any past scene from their own vantage — a retelling generated on demand and cached, so the canon trunk stays single while each seat can read history through its own eyes.

**Visibility tiers = the three `PerspectiveView` scopes.** **`canon`** is **GM-only** (the ground truth); **`public`** goes to everyone; **`private`** is each seat's own. The **GM sees all three** — canon + public + every private view (browsable on demand) — plus any **GM-only** extras; **players never see `canon`**, only `public` and their own `private`. This is the same gating the table uses (global for the GM, perspective-gated for players).

---

## Threads as quests & scoring (the incentive layer)

> Scoring is **entirely** a function of open-ended **Fate threads** and each seat's role in moving them — we quantify the players who most **drove fate forward and exercised agency in the world**. Nothing extrinsic; the score falls out of the substrate the engine already computes. *(This replaces the old side-betting market wholesale.)*

- **Threads are the quests.** Every open-ended thread (the `Stream` above — a live question with outcomes) is a quest: a question whose resolution you push by committing conviction. You don't *win* a thread, you **move** it.
- **Goals — your own, optional.** A seat may set zero or more **goals**: a target outcome on a thread it cares about, **private or public** (your call, per goal) and **reassignable at any time** as a free action that binds nothing and costs no conviction. A goal is a **personal tracker** — it orients your play and gives you something to chase. **Goals never touch the score** (Impact is Fate moved, full stop); playing with none is completely fine.
- **Request a new quest.** Need a thread that doesn't exist yet? **Ask the GM** to open one via **world expansion** (`expandWorld`, admissibility-gated like a prior). Admitted → a fresh open-ended thread, available to the whole table as a new quest and a new source of Fate.
- **Thread weight = the Fate it generates.** A thread's worth isn't hand-set — it's the **Fate** it accumulates (`Σ_t vₜ · D_KL`, information gain weighted by attention; [CLAUDE.md](CLAUDE.md) Forces). Pivotal, hotly-moved threads generate lots of Fate and are worth a lot; quiet ones little. **Pure engine-derived, no dial** — the world tells you what mattered.
- **The one score — Impact (Fate moved, direction-agnostic).** Each seat's score is its **attributed share of the Fate moved across every thread**, summed over the game and **continually updated** each round. We value **agency, not allegiance**: pushing a thread toward an outcome OR away from it, confirming the modal line OR rupturing it, all score identically — what's measured is *how much you shifted the distribution*, and **the more decisive the move in fate, the bigger the reward** (a twist against the committed leader pays most; a pulse ≈ nothing). **Closed threads lock** your banked share; **open threads contribute provisionally**. This running tally is the leaderboard — Catan-style points, where the points are Fate and the board is the world.
- **How credit is assigned.** Fairly, and **in the same logit space as the stance**: each round the realized stance shift on a thread is **decomposed across the seats that caused it** (Aumann–Shapley — the shares sum *exactly* to the fate that moved, so no one can mint Impact), weighted by how **decisive** the shift was. Full derivation in **§The scoring math** below; the one-liner is *you bank the information you actually moved.*
- **End-game debrief — relative to your aims.** When the game closes, a **final AI debrief pass** (distinct from the per-round Impact scorer) reads each perspective's **goals + continuity** and writes a per-seat **qualitative evaluation**: did this seat achieve what *it* set out to do, and how did its run read? This is narrative, **not a second number** — the comparable score stays Impact (Fate moved); the debrief is each player's private mirror on their own goals (the inherently per-player, relative part, since every seat's aims differ).

**Why this shape.** It measures the one thing the rehearsal is about — **who has agency, who drives the future** — from the engine's own **Fate force**, decomposed **fairly** across the seats that moved it (the math below), so the score is *intrinsic* to play, not a side market bolted on. A perspective that sets a bold goal and bends the world toward it scores high; so does a wrecker who ruptures the modal line; a passenger who never moves Fate scores low however the game ends. Agency is the currency.

### The scoring math — influence on fate, decomposed

Scoring lives in the **same logit space as the stance**, so it reads like calibration, not a bolt-on. The object we analyse is **how each seat's continuity log (its plays/priors) moved each thread's fate log (its stance)** — turned into maths as follows.

**Conviction → logit (the exchange rate — the load-bearing equation).** A thread with `K` outcomes carries a stance **logit vector** `ℓ`; its belief is `p = softmax(ℓ)`. A play commits conviction `c ≥ cost` to an outcome and converts to **evidence** with **diminishing returns**, capped per play at the engine's band:

```
e = clamp(−4, +4, EVIDENCE_GAIN · ln(1 + c / cost))      EVIDENCE_GAIN ≈ 3
Δℓ_play = e / STANCE_EVIDENCE_SENSITIVITY                 (so |Δℓ_play| ≤ 2)
```

Paying a card's bare `cost` lands a solid `e ≈ 2`; **raising** (`c > cost`) buys more, concavely, to the ±4 cap (~3× cost). A seat's plays on one outcome **sum** in logit space — up to `CARDS_PER_ROUND` cards can push one thread ≈ ±6 logits in a round, so **near-certainty is reachable but costs your whole hand and stack**; against opposition the net is less, so dominance is **built over rounds, not bought in one**. `EVIDENCE_GAIN` is the dial that decides what raising buys — tune it first.

**Aggregation — the merge sums the nudges.** Logit space is additive, so a thread's round shift is the sum of every seat's nudges, and the summed stance is **the odds the settlement reads**:

```
Δℓ = Σ_i Δℓ_i      ℓ⁻ = round-start      ℓ° = ℓ⁻ + Δℓ      p° = softmax(ℓ°)
```

**Two phases of fate — and Fate owns the draw.** Settlement (per `RESOLVE_BIAS`) then **snaps** the stance toward the executive outcome: `ℓ° → ℓ⁺`, `p⁺ = softmax(ℓ⁺)`. So a round's realized fate splits in two, owned differently:
- **Nudge fate** `F° = v · D_KL(p° ‖ p⁻)` — the odds the *seats* shaped. **Attributed to seats** (`v` = volume/attention).
- **Snap fate** `F* = v · D_KL(p⁺ ‖ p°)` — the executive collapse the *settlement rule* applied (a `random` draw, or a deterministic pick). **Owned by Fate** — a "house band" in the readout, conserved but credited to no seat.

This answers *who owns the draw*: seats bank the **odds they moved**, never the luck of the draw. Lose an 80%-odds draw and you are **not** punished — your nudge credit stands; the snap that went against you is **Fate's band, not yours**. (Thematically exact for a game about backing beliefs *against* fate, and the **SHOWDOWN** phase is where the house band is shown.)

**The seat split — Aumann–Shapley over the nudge phase.** `F°` is nonlinear in the nudges, so we attribute it the only fair way — the path integral from `p⁻` to `p°`:

```
φ_i = ∫₀¹ ⟨ Δℓ_i , g(s) ⟩ ds                                  g_k(s) = p_k(s)·[ ln(p_k(s)/p⁻_k) − D_KL(p(s)‖p⁻) ]
FateCredit_i = v · φ_i                                         p(s) = softmax(ℓ⁻ + s·Δℓ)
```

~8 numerical steps. Intuitively: *the average marginal information your evidence produced as the round's odds accumulated.*

**Why it's fair — the axioms (Shapley's):**
- **Conservation** — `Σ_i φ_i = D_KL(p°‖p⁻)` exactly, and Fate's band carries `D_KL(p⁺‖p°)`; together they account for the realized shift with **no seat minting Impact** and **no draw-variance leaking onto a seat**.
- **Symmetry / dummy / additivity** — equal nudges earn equal credit; a seat that nudges nothing earns nothing; credit sums cleanly across threads and rounds.
- **Order-independent** — simultaneous path integral; turn order never advantages a seat.
- **Signed over odds you shaped, never over the draw.** Push the *odds* against the net nudge and you score negative on that thread (honest — you moved the odds the other way). But the **draw's outcome never signs your score**: it's Fate's band. So contesting is **safe** — any genuine nudge is fate you moved, win or lose the snap.

**Impact** is the running sum — closed threads lock, open provisional:

```
Impact_i = Σ_threads Σ_rounds  FateCredit_i
```

**Where the AI comes in (bounded).** Once each seat's `Δℓ_i` is known the credit is fully deterministic — and for plain card-play it *is* known (the engine stamps which seat authored which stance delta). The AI's only job is to read the **continuity logs** and re-attribute the **same** realized shift when soft factors matter (A set up the play B closed, a feint, coordinated pressure) — a re-partition **constrained to reconstruct** `Δℓ` (`Σ_i Δℓ_i = Δℓ`). It can re-weight authorship; it cannot invent fate. Hard anchor: **committed conviction dominates**; chat and positioning only modulate it (talk binds nothing).

### The round readout — scoring that looks like the stance

The visualisation *is* the stance graph, because the score is computed on it — same calibration feeling, now legibly authored:
- **Authored stance ribbons.** The per-thread **stance probability graph** (bands = outcomes, summing to 1) is **repainted by author** — each slice of belief movement coloured by the seat whose `φ` share drove it. You see the calibration curve *and* whose hand bent it.
- **Round decomposition.** At each round's close, a **stacked streamgraph** splits the round's total fate into **player bands** (height = `FateCredit` this round; segments break down by thread on hover) plus a distinct **Fate "house band"** for the snap (`F*` — the draw / settlement the world owns). Same stacked-area feel as the stance, but the stack is *people + Fate*. Negative slivers render below the axis: a seat that pushed the **odds** against the net nudge. The house band is what the **SHOWDOWN** phase spotlights — the draw made visible and owned, never arbitrary.
- **Cumulative Impact alluvial.** Across rounds, the existing **Influence alluvial** (Fate tab, log-based) carries each seat's accumulating Impact — signed flows, decisive rounds reading as fat bands.

---

## Constants & tunables

> Starting **defaults — hypotheses to pilot, not law**; most are **GM dials**. Where a value already lives in the engine ([`constants.ts`](src/lib/constants.ts)), reuse it.

**Advanced settings (GM).** Every **timing** value (`TIMER_PUBLIC` / `TIMER_PRIVATE` / `TIMER_READ` / `TIMER_TURN` / `TIMER_LIVE` / `TIMER_SHOWDOWN` / `TIMER_SCORING`) and every **economy** value (`CONVICTION_START` / `CONVICTION_INCOME` / `CONVICTION_DECAY`, blinds, `COST_MIN` / `RARITY_SCALE` / `EVIDENCE_GAIN`, the prior-economy rates (incl. `PRIOR_EARN_DECAY`), `RESOLVE_BIAS` / `SHOWDOWN_PHASE`, `FORCED_REVEAL` / `FACEDOWN_PREMIUM` / `REVEAL_REFUND`) is exposed in an **Advanced settings** panel at SETUP for the GM to tweak per game — the defaults below are just the out-of-box starting point. Timing is the **difficulty lever for the human-vs-AI tempo dynamic** (tighten clocks to raise the pressure, loosen them for teaching/onboarding rooms); the economy is the **scarcity lever**. Both are GM-owned and can be re-dialled between rounds.

**Round & turn limits**

| Const | Default | What |
| --- | --- | --- |
| `ROUND_LIMIT` | none (GM ends) | optional hard cap on rounds per game |
| `TIMER_PUBLIC` | 30s | public-narration window — short; it's a read |
| `TIMER_PRIVATE` | 20s | private-narration window — short; your brief |
| `TIMER_READ` | 120s | *(Rounds)* deal + request-more — the strategic heart, given room |
| `TIMER_TURN` | 30s | *(Rounds)* per-seat play clock (timeout → no action / cede) |
| `TIMER_LIVE` | 120s | *(Showdown)* shared real-time window — all seats act at once; closes on timer or all-locked-in. Replaces TIMER_READ + TIMER_TURN |
| `TIMER_SHOWDOWN` | 25s | *(optional phase)* contested-thread spotlight before SETTLE |
| `TIMER_SCORING` | 20s | round readout + Ranking — short |
| `READ_MAX_REQUESTS` | 3 | card-requests allowed per read / live phase (bounds the branching loop) |
| `CARDS_PER_ROUND` | 3 | max cards a seat may commit per round — a **backstop** against merge-flooding with near-free cards. At default income (~one real card a round) it rarely binds; it mainly bites in **high-income rooms** (GM dial; raise for high-action tables) |

*(Pacing split: presentation phases — narration, scoring — run short to keep the game moving; the deliberative phases — READ / PLAY / LIVE — get the time, with `TIMER_READ` the strategic heart. All are GM dials under Advanced settings.)*

**Conviction economy** (GM-owned — the main difficulty lever)

| Const | Default | What |
| --- | --- | --- |
| `CONVICTION_START` | 50 | opening balance per seat — **2× income**; you climb from here toward the ceiling by saving |
| `CONVICTION_INCOME` | 25 | granted each SETTLE — **≈ one even-money call** (`p≈0.5` ≈ 23); ~one real move a round, anything bigger needs saving |
| `CONVICTION_DECAY` | `5/6 ≈ 0.83` | tax on the **banked** balance each SETTLE (before income). Fixed point `INCOME/(1−DECAY) = 150` is the **hoard ceiling** = the **dearest possible *play*** (max card `100` × `FACEDOWN_PREMIUM 1.5`) — so a fully-banked saver can afford **any single call, concealed long-shots included**, but never a runaway war chest. *(Decoupled from the stance's `STANCE_VOLUME_DECAY = 0.9`, which would float the ceiling far higher at this income.)* |
| `FOLD_REFUND` | 0 | fraction of staked conviction returned on fold *(open)* |
| `BLINDS` | off | *(Rounds only — no button in Showdown)* opt-in poker blinds (GM toggle) |
| `BLIND_SMALL` | 5 | fixed tax on the 1st seat after the button, each round (≈ a cheap card) |
| `BLIND_BIG` | 10 | fixed tax on the 2nd seat after the button (≈ a modal call, ~40% of income — heavy by design; it's a pressure dial) |

*(Economy is scaled to the **0–100 card-cost** range; the **dearest possible play** is a face-down max-rarity card — `100 × 1.5 = 150` — and the hoard ceiling `INCOME/(1−DECAY)` is set to exactly that, so a perpetual saver can afford **any single call, concealed long-shots included, and nothing beyond**. Income ≈ one even-money call, so each round buys ~one real move; a face-up **long-shot (~76) takes ~2 rounds** of saving, a **concealed** one (~114) takes ~6 — the signature long con stays a costly, occasional event. Ratios: **start = 2× income, ceiling = 6× income = max card × facedown premium**.)*

**Blinds** *(opt-in, Rounds only)* — when on, the two seats **after the button** post a fixed conviction tax at the start of each round, **restricting their mobility** that round; the blinds **rotate with the button** poker-style so the burden moves around the table. Off by default; purely a GM dial for pressure. (Showdown has no button, so blinds don't apply — use a flat ante via `CONVICTION_INCOME` tuning if you want comparable opening pressure.)

**Rarity → cost** — the price of committing a card, on an intuitive **`COST_MIN`–100** scale:

```
cost = clamp(COST_MIN, 100, round(RARITY_SCALE × −ln p))   // p = outcome's live streamProbs
RARITY_SCALE = 33   ·   COST_MIN = 1   ·   range [COST_MIN, 100]
```

So near-certain (`p≥0.97`) floors at **`COST_MIN`** (cheap, but never free), `p≈0.95` ≈ **2**, a modal call (`p≈0.7`) ≈ **12**, a coin-flip (`p=0.5`) ≈ **23**, a long-shot (`p=0.1`) ≈ **76**, a 1-in-20 (`p=0.05`) ≈ **99**, anything rarer **caps at 100**. Improbability *is* the price.

**The floor is load-bearing, not cosmetic.** `COST_MIN > 0` is what makes **agenda-setting cost something**. Admissibility (`scoreStreamPrior`) gates *implausibility*, not *strategic triviality* — a plausible, framing-favorable, near-certain claim is admissible, so without a floor it would enter the merge as a **free, unopposed executive resolution the continuation must honor**. Nothing would stop a seat from flooding the merge with cheap, true-but-spun claims that steer the narration for free. The floor restores `conviction ≥ cost > 0` on every commit; `CARDS_PER_ROUND` (below) bounds the flood directly when the floor alone is too soft against a full income.

**Prior economy** — *work the model, don't brute-force, don't self-deal.* The prior is **how you talk to the AI**: a claim articulated well enough that the resolver finds it admissible and is moved by it. A prior that **moves the canonical thread** is paid twice — it **earns conviction** *and* **re-prices your cards**: push `p` toward your outcome and its `−ln p` falls, so the **long-shot you're building toward gets cheaper to commit** (and, under `random`, more likely to win the draw). So the lever is the *quality of your reasoning*, not volume. But the earn is on **realized information, not private repricing** — you're paid only for the **canonical** stance-movement your prior survives the merge to produce (the same nudge-fate `F°` the scorer measures), so pushing your *own* stream's odds with no effect on the shared thread earns **nothing**. This closes the perspective-owned-stream loophole the auction never had: a private prior that *both* earns conviction *and* cheapens your own card with no rival to arbitrage it — under realized-information earn, that double subsidy only pays if the canonical world actually moved.

| Const | Default | What |
| --- | --- | --- |
| `PRIOR_EARN_RATE` | 20 | conviction returned per nat of **merge-confirmed** info-gain (the canonical KL your prior drove). A strong read pays ≈⅔ a round's income; a prior that moves only your *private* odds pays **0**. Still the dial likeliest to need pilot tuning |
| `PRIOR_EARN_DECAY` | 0.5 | each successive earning prior on the **same stream within a round** earns `×0.5` the last — diminishing returns kill grinding even when every prior is admissible |
| `PRIOR_MIN_INFOGAIN` | 0.05 | below this canonical gain → no earn (the no-op gate) |
| `PRIOR_ADMIT` | `scoreStreamPrior` threshold | implausible / over-biasing → **denied** (hard gate, separate from price) |

So the skill is **writing the prior well** — a realistic, *legible* claim the resolver understands and is moved by — which bends the canonical odds your way and makes your long-shot cheap. Not grinding junk (no-op + admissibility gates), not self-dealing private repricing (realized-information earn + per-stream decay): the game rewards **clear, persuasive, plausible reasoning**, which is the whole point — it's communication with the model, scored.

**Contested settlement — `RESOLVE_BIAS`** — how the merge picks a winner when committed resolutions **conflict**. The contesting claims **needn't be the same proposition**: the resolver (AI) flags when two seats' committed bearings **can't both be written into the canon** and maps each onto a competing **outcome of the shared canonical thread**; conviction + priors shape that thread's nudged **stance odds `p°`**, and this dial decides how the resolver reads them. **Only contested threads use it** — an unopposed claim just stands.

| Mode | What wins the contest |
| --- | --- |
| `random` **(default)** | **Fate draws from the odds** `~ p°` — each outcome's chance = its conviction-shaped probability (the draw logic below). You buy **better odds, not the outcome**; stack conviction and the draw tilts your way, but never to a guarantee. |
| `lowest-cost` (*realism*) | The **likeliest** (lowest-rarity) outcome wins outright — the world snaps to the probable, so a **long-tail call forced into a contested zone is punished**. The honest mode for forecasting rooms (answers the *narrative-plausibility-vs-reality* risk). |
| `highest-cost` (*drama*) | The **rarest** contested outcome wins — the improbable is forced through, **rewarding bold long-tail calls**. The cinematic "against all odds" table. |
| `gm` (*sovereign*) | The **GM decides** each contested thread by hand — the existing RESOLVE override made the standing rule. For curated / teaching tables where the operator wants the last word; the **SHOWDOWN** phase is where those calls are made. |

Strategic read: under `random`, conviction is **odds-buying** (the signature long-shot is "stack it toward certainty, then ride the draw"); under `lowest-cost`, force long-shots only in **quiet** threads no one contests; under `highest-cost`, a contested long-shot is a feature; under `gm`, the sovereign just calls it. **`SHOWDOWN_PHASE`** (default **on**) surfaces each contested thread's settlement in the optional **SHOWDOWN** phase before SETTLE — and under `gm` mode that phase is where the GM makes the calls; off folds settlement silently into RESOLVE.

**Random settlement — the fair draw (default).** Contesting claims **needn't be identical**; the resolver does two things, then deterministic math + one draw settle it:
1. **Detect + map (the only AI step).** It flags that two committed bearings **can't both hold in the canon** and maps each onto a competing **outcome of the shared canonical thread** — *adding* an outcome if a claim introduces one. This is a semantic judgment (conflict detection), not a fairness lever.
2. **Build the odds (deterministic).** Each mapped claim's conviction becomes a **logit nudge** on the thread (the exchange rate, §The scoring math), summed across seats; priors already moved `ℓ⁻`. The result `p° = softmax(ℓ°)` is the contested distribution — *the same `p°` the scorer reads.*
3. **Draw.** The winner is sampled **`~ p°`**. No separate contest formula — the draw just reads the thread's own nudged stance, so the modal/default outcome (un-nudged) keeps its base-rate share and a split contest can still resolve to neither.

Why it's **random and fair**:
- **Proportional & never-zero** — `P(win) = p°(outcome)`, which rises with both the **priors you built** (base odds) and the **conviction you committed** (nudge); every genuine contestant has a real chance, so contesting is never strictly dominated.
- **Monotonic, not deterministic** — more conviction strictly raises your share of `p°`, but the per-play cap + the 150 ceiling mean one round *tilts* the odds, never pins them to 1 against opposition.
- **Score-safe** — the draw is the **only** randomness; its snap (`p° → p⁺`) is **Fate's house band** (§The scoring math), so a favoured seat that loses the draw keeps its odds-shaping Impact and is **never double-punished**.
- **Auditable** — `p°` and the rolled result are deterministic-then-drawn from recorded play, shown in the **SHOWDOWN** phase, so the outcome reads as **weighted fate, not a black box**.

**Reveal & concealment** — what gives face-down **teeth** so it isn't a free dominant line:

| Const | Default | What |
| --- | --- | --- |
| `FORCED_REVEAL` | **on** | GM dial: when **on** (default), **every** play flips open at round end — full table transparency. Turn it **off** to permit concealment (then the rules below apply). |
| `FACEDOWN_PREMIUM` | 1.5 | multiplier on a card's cost when played face-down — hiding the table's read of your move during the round is a paid service. *(The hoard ceiling is set to exactly the dearest face-down play — max card `100 × 1.5 = 150` — so concealed calls **are** affordable to a full bank: a face-down long-shot (114) takes ~6 rounds' saving, a face-down max-rarity (150) is the perpetual hoarder's single shot.)* |
| `REVEAL_REFUND` | 0.25 | fraction of stake rebated when a seat **voluntarily** reveals a play whose outcome resolves **executive** (atop the reputation mark) |
| `REVEAL_REPUTATION` | on | a correct voluntary reveal scores the seat's calibration / ELO — the clean, **economy-neutral** reward that keeps *the pot is spent* intact |

**Reveal is forced by default** (`FORCED_REVEAL` on) — the simplest, most transparent table, and the recommended starting point. The concealment economy below only comes alive when the GM turns it **off**. Even then there's a floor: a **contested** thread (two seats' streams on conflicting outcomes) **always** flips its plays open before the merge settles it, so a challenged bluff is called regardless. With concealment enabled, `FACEDOWN_PREMIUM` + the voluntary-reveal reward make hidden play a **priced bet on secrecy** (no mid-round coordination against you, no cross-round read of your hand), not a free default — you pay up front, get force-exposed the instant anyone contests you, and forfeit the reveal reward if you sit on a winner.

---

## Access & play modes

- **`computer` mode — single screen, zero setup.** The GM drives every seat from the desktop interface (hot-seat: `act-as-seat` → take its turn, move, chat). No tunnel, no pairing. The fast path for demos and in-person sessions.
- **`remote` mode — distributed.** Players join their own **mobile controller** over the tunnel (per-seat QR / link); a **waiting room** holds the round until seats are `joined`. The controller is the lighter **player interface**: **move, chat, read** (perspective feed + hand). *(Least-settled half — see Open questions.)*
- **Mix freely.** Some seats on phones, some GM-proxied, the rest agents. Empty competitive seats → agents so the table is never half-simulated.
- **Variant × mode.** **Rounds** runs anywhere — its turn order serialises play, so one GM can hot-seat every seat in `computer` mode. **Showdown** needs **independently driven seats acting at once**, so it pairs with `remote` (players on their own controllers + agents); in `computer` mode there's no one to play the simultaneous seats and it collapses back toward Rounds.
- **Federated local-host.** The GM runs a **sovereign host** (Electron app + daemon; state in IndexedDB; no central server). **Async capture** rides a dark channel (QR-paired WhatsApp web-bridge / Slack-Teams connector) → per-member priors, admissibility-gated. **GM = sovereign operator** (full state, the master console); **players = guest seats** with no authority over truth and no view of others' hidden state.
- **Surfaces (the build) — minimalist, board-centric.** **The Board** is the single primary surface (poker-table view): **narration and round information are conveyed on the board itself**, not in side panels. **The Cards** / hand sit at the player's seat. **Chat** (global + location) opens as a **modal**; **navigation** (move, pose-question / request-more, **set / reassign goal**, request-quest, settings) is via **popups** layered over the board. The **Impact tally** (Fate moved per seat) rides on the board as the live leaderboard; the end-game **debrief** is a per-seat readout. The **GM's progression control is the existing Generate Panel, surfaced as a GM-only overlay on this same board** (see *One window, automated*) — one screen for everyone, with the GM's advance/override controls layered on top and players seeing only the board + their hand. All **responsive across desktop + mobile**, rendered global for the GM and perspective-gated for players; per-scene **Perspective views** live in the **Content tab**. Component map: [MERMAID.md](MERMAID.md) §8.

---

## Key invariants (decided)

- **Humans decide; agents automate — and you can chat with them.** A human seat takes its turn **by hand**; an agent seat plays **automatically** from its feed each turn (no human input). Both are full participants in **global + location chat**, so you can negotiate with — or be bluffed by — an AI seat just like a human one.
- **Admissibility is a hard gate.** Every prior runs `scoreStreamPrior` before it can deal a card or move a stance — implausible/over-biasing → **denied, revise & resubmit**. Distinct from price: a plausible long-shot is *admissible but dear* (`−log p`); fantasy is refused at any price.
- **Conviction: income + decay — bank for the long tail.** Banked conviction **carries by default** but **decays** (`α = 5/6 ≈ 0.83`): saving toward a dear **long-tail call** is a core strategy, but idle capital **erodes** toward the ceiling `income/(1−α) = 150`, so the skill is *timing the save* — bank long enough to force the unlikely, not so long it rots, and you can never stockpile past **the dearest possible play** (a concealed max-rarity call). Decay is the holding cost, not a ban on saving. The economy (income, decay, resets) is the GM's lever.
- **Streams are one-perspective.** Every stream belongs to a **single seat** — its private bearing on a question (the shipped member-owned `Stream`). You open, work, and play **only your own** streams; there are **no shared "board" streams**. The shared layer is the world's **canonical threads**, and the **`Merge` is the sole place** separate seats' streams meet — reconciling conflicting claims on the same thread into one continuation. Contention is **indirect**: you out-commit a rival on a shared *outcome*, never play on their *stream*.
- **A card is a chosen outcome; a round IS a merge.** Playing a card *is* choosing one outcome of **one of your own streams**. At RESOLVE every seat's played cards fold into the round's `Merge`; only **executive** resolutions (a committed outcome) drive the continuation; claims folded in without one ride along **recorded** (organisational record, non-driving). Where seats' streams **claim the same thread differently**, the merge settles per **`RESOLVE_BIAS`** (a **random draw from the conviction-shaped odds by default**; `lowest-cost` snaps to the likeliest and punishes long-tails; `highest-cost` forces the rarest; `gm` hands the call to the sovereign); compatible claims **multi-resolve**; never averaged. A seat may **back several outcomes on its own stream**, but that only lands as intended when the question genuinely supports multi-resolution — otherwise its own commitments contend (the player's call to know).
- **Conviction shapes the odds; `RESOLVE_BIAS` settles.** No exogenous base rate — conviction (and priors) move each thread's **stance odds**, and a contested thread then settles per **`RESOLVE_BIAS`** (by default a **random draw from those odds**, so heavy backing buys near-certainty, not a guarantee; `lowest-cost`/`highest-cost`/`gm` are the GM's alternatives). An unbacked claim is **ceded** to whoever did commit, and the thread closes at round end — questions don't linger. A **timeout with nothing committed is the same as ceding** — no action, the merge settles it from the table's other plays (which already shaped the odds).
- **The pot is spent, not won.** Unlike poker, committed conviction isn't awarded to a winner — it's **consumed** to shape the outcome and gone. Your "winnings" are the **world you forced** and the **Impact** you bank (Fate moved — §scoring); a small `REVEAL_REFUND` partial-rebate of *your own* stake rewards a voluntarily-shown winning call. **Folding banks** conviction for a round that matters more. There's no per-round pot and no one takes another seat's conviction — the spine is **agency + consequence**.
- **Reveal is forced by default; concealment is a GM-enabled, priced option.** `FORCED_REVEAL` is **on** out of the box — every play flips open at round end (the simplest, most transparent table). When the GM turns it **off**, concealment comes alive but isn't free: face-down costs `× FACEDOWN_PREMIUM`, any **contested** thread still **force-flips every bearing play open** before the merge settles it (per `RESOLVE_BIAS`; a challenged claim is always called, poker-style), and a winner kept dark **forfeits the reveal reward** (reputation + optional `REVEAL_REFUND`). So hidden play buys *real* secrecy — no mid-round coordination against you, no cross-round read of your hand — as a paid, exposable trade-off, never a dominant default.
- **Buy the odds, not the consequences.** Conviction buys an outcome's **odds** (near-certainty as you stack toward `p→1`, or a deterministic win under `lowest-cost`/`highest-cost`/`gm`); the engine always owns the **fallout** (state-dependent — learning it is the rehearsal value, not an exploit).
- **Branches are isolated sandboxes — streams & merges are branch-OWNED.** `branchId` is **ownership**, and a **fork deep-copies** the parent's streams + merges into the child (fresh ids + an `originStreamId`/`originMergeId` back-link to the source — `forkLedger`). Each branch owns its belief layer, so adding priors, committing, **reverting a merge, or undoing** on one branch can **never touch another** — exactly what messy, heavily-branched, replayable play needs (the parent stays a backup). Scenes stay structurally **shared** (immutable); only the mutable streams/merges copy. (`n.streams`/`n.merges` are global dicts so id-lookups always resolve; ownership governs display + which copy a branch mutates; consumption matches a copy by id **or** its origin.) RESOLVE settles the **branch**, never the canonical trunk.
- **Replayable by design — the special part.** Every playthrough is a **branch**, and the resolver *reasons* each outcome rather than scripting it — so the **same setup replayed on a fresh branch yields a different continuation**. Because each branch owns its copies, divergent runs evolve the **same question** independently, and the **`originStreamId` link lines them up** ("you went yes here, no there — why?"). Run a scenario many ways across many branches, and that **divergence is the lesson** — what makes Conviction worth playing more than once.
- **Threads are quests; the score is Fate moved.** The only score is **Impact** — each seat's attributed share of the **Fate** it moved across every open-ended thread, continually updated and **direction-agnostic** (drive a thread either way; you score for the *shift*, not the side). Goals are optional, reassignable, private-or-public **personal targets** — a tracking aid that feeds the end-game debrief but **never the number**. We measure **agency** — who drove the future — not who called the ending. *(This replaces the old side-bet market entirely.)*

---

## Risks (the honest part)

- **The resolver models narrative plausibility, not causal reality** — the deepest risk. It produces *story-shaped* fallout; reality has anticlimax it under-produces. Mitigants (not a fix): ε-noise tail draws (GM volatility dial), a **legible** resolver, and **confirmed merges** anchoring to what happened — only the last makes it *honest*, and it bites only after sustained play. Enforce **trunk provenance in code**: `confirmed` (ground truth) vs `believed` (unconfirmed) — the resolver may not read `believed` as fact.
- **AI seats are weak at hidden state + deception** — exactly the **adversary** seat you most want filled. Inferred adversaries are a **stopgap that degrades the rehearsal**, not an equivalent; keep humans in the asymmetric seats.
- **Conviction is one scalar** — can launder real (non-fungible) constraints; v1 keeps it scalar for legibility, **typed conviction** is the refinement.
- **The biases are directional — so declare them** (continuity over rupture, legible over dumb causes, fungible over constrained agency). Surface the standing lean at the table or it miscalibrates the people it's meant to calibrate.

---

## Open questions

- **Narration cadence** — *decided:* the **canonical continuation generates first**, then **public + all private perspectives are one batched set of parallel calls** off that canon; delivered in order (public → private). Open: timer lengths, whether a seat can skip ahead once read, and the batch's concurrency cap.
- **Non-canon views** — generate lazily per request and cache, or pre-generate for active seats? How far back is history readable (GM-configurable)?
- **READ economy** — *decided:* a prior earns on **merge-confirmed canonical info-gain** (not private repricing), at `PRIOR_EARN_RATE`/nat, with `PRIOR_EARN_DECAY` per repeat on the same stream — closing the self-deal loophole (§Prior economy). Open: exact rate/decay magnitudes in pilot, and whether the "realized-information" earn is computable cheaply at merge time.
- **PLAY end + resolution** — how many threads a round typically contests; round ends on all-fold / threads exhausted / timer; how the merge *shows* why it reconciled (esp. under `random` settlement — surfacing the draw without it feeling arbitrary).
- **Showdown live window** — does a late raise after others lock-in **reopen** the clock (poker-style action-reopens-betting) or is lock-in final? How is **near-simultaneous contention** on the same outcome settled — pure payment-weight, or does `playedAt` order break ties / give first-mover signalling value? Does real-time *work-the-model* (priors + new streams mid-window) stay legible or does it need rate-limiting beyond `READ_MAX_REQUESTS`? Latency fairness across controllers.
- **Conviction tuning** — allowance size, decay tuning, whether folding refunds, whether accumulation earns its keep at all.
- **Fate attribution & scoring** — *decided:* a thread's round-fate splits into the **nudge phase** (`v·D_KL(p°‖p⁻)`, Aumann–Shapley across seats) and the **snap phase** (`v·D_KL(p⁺‖p°)`, owned by a **Fate house band** — never a seat), so `random`-draw variance can't sign a seat's Impact (§The scoring math). The conviction→logit **exchange rate** is pinned (`EVIDENCE_GAIN`, concave per play, additive). Open: the integral's **step count**; AI re-attribution **guardrails** / auditability; how the **house band** renders so the draw reads as fate not noise; whether a closed thread's shares **re-open** on a later reversal; whether **agent seats** carry goals (and who sets them).
- **Player mobile interface — least settled** — full perspective-gated table on the phone vs a stripped move/chat/read controller; reveals + timer on mobile; mid-game handoff between GM-proxy and a player's phone.
- **Live session security** — QR / link token lifetime, PIN gate, re-issue/revoke when a seat changes hands.
- **GM-as-player fairness** — when the GM also seats, how the master-device info edge is neutralised.
