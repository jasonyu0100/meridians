# Conviction — Meridians' Rehearsal Card Game (CONCEPT)

> **Spec for [ROADMAP.md](ROADMAP.md) A4 (Rehearsal).** Conviction is the War Room played as a **turn-based card game** on the shipping substrate — threads/stances, **streams/priors**, **merges**, **locations** ([CLAUDE.md](CLAUDE.md)). This doc is implementation-first: the **game loop as a state machine**, and the **type model** that backs it (what we reuse, what's net-new). Vocabulary: [LANGUAGE.md](LANGUAGE.md).

---

## In one paragraph

Perspectives (allies, rivals, the world itself — human- or agent-driven) sit at a table and bet on what happens next. Each round the engine **narrates the state**, deals each seat a **hand of cards** (concrete claims on its open questions), and players spend scarce **conviction** to **play** cards — *face-up* to signal, *face-down* to hide. When the table is done, the round's commitments assemble into a **merge** the engine plays forward into a kept **branch**. It's **Capture run live**: the same streams/priors/resolver, compressed from a week into a session. Goals are emergent; the spine is **cost + consequence** — you live in the world you paid to shape.

---

## The game loop (state machine)

A game is a **branch**; a `GameRoom` runs over it. The loop is a **sequential, deterministic phase machine** — one known state at a time, each transition dealing every perspective its own information. Humans take their turns by hand; agents resolve theirs automatically. **Chat (global + location) is always open** — it runs through *every* phase, not just the narration windows.

**One window, automated.** Conviction is a **gamified layer over the shipping stream / merge / generate UI** — it doesn't replace those surfaces, it **wraps and automates** them into one continuous, immersive window for GM and players. Progression is **one click for the GM through the existing Generate Panel** (deal, pricing, the narration batch, income/decay all run automatically); the GM can always **override** — drop to the underlying stream/merge tools and edit — because they're the GM.

```
SETUP ─▶ [WAITING?] ─▶ ROUND ─▶ ROUND ─▶ …
                         │
   ┌─────────────────────┴───────────────────────────────────────────┐
   ▼                                                                   │
PUBLIC_NARRATION ─▶ PRIVATE_NARRATION ─▶ READ WRITE ─▶ PLAY ─▶ RESOLVE ─▶ SETTLE ─┘
```

1. **SETUP** *(GM, desktop)* — GM builds the `GameRoom`: picks the **locations** in play, **creates and seats perspectives** (each assigned a driver — `human` / `agent` / `gm-proxy`; a **human seat must bind a registered `Member`** from the members table, and any seat with no member is **filled by an agent**), sets the opening **roster**, and dials the **conviction economy** (income, decay). Chooses the **mode**: `computer` (single screen, GM proxies everyone — start immediately) or `remote` (players join their own controllers — go to WAITING).
2. **WAITING** *(remote only)* — a waiting room: seats join via per-seat link/QR (`status: pending → joined`). GM **starts** when ready; unfilled competitive seats fall back to `agent`.
3. **PUBLIC_NARRATION** — **delivers** the **public** narration that brings the table up to date on the game's status (pre-generated in the RESOLVE batch off the canon; round 1 narrates the opening state). Public, everyone, first. A timer runs; chat is open (global + location).
4. **PRIVATE_NARRATION** — then **delivers** each seat's **private** `PerspectiveView` — its **special context** (continuity + vantage), from the same RESOLVE batch. Strict delivery order: **public → private**. Timer runs; chat continues. Players may also pull **non-canon views** of past scenes while reading.
5. **READ WRITE** — each seat is dealt its **hand** (chosen stream cards + sampled), then **works the model**: it can **update priors** on its existing streams (shifting the odds → re-pricing those cards) and **open new unique streams** by **posing open questions** (fresh streams that, once admissible, **deal new cards**). This write-back is where **emergent play** comes from — each seat reshapes the board it's about to bet on. A seat may also take its **one move** here — a single hop on the location tree — which changes **the streams it holds** (it's dealt against its new place) and **who it shares location chat with**. Bounded by the read timer; stand pat to skip.
6. **PLAY** — **poker turn order** (rotating button). On a turn a seat **plays** card(s) *face-up/face-down* (paying conviction), **raises**, **passes**, or **folds**. Agents auto-resolve their turn from their feed. If a seat's **turn timer expires with nothing committed**, that's **no action** — it cedes, leaving the question to the LLM, which the rest of the table's commitments already sway.
7. **RESOLVE** — after the table is done comes the **showdown**, where revealing your **face-down** cards is **at your discretion** — you may flip them to prove a call or keep them hidden for good. (Either way the engine/GM sees every committed play; the reveal is a *signalling* choice to the table, not a resolution gate.) Then the GM advances the round with **one click through the existing Generate Panel**: the played cards **pre-fill the merge's resolutions** (**executive** = drives the continuation; **recorded** = rides along, non-driving) — the GM can **override** any before generating, or just click through; fully automated, it generates with no input. The merge → the engine generates the continuation (one scene/beat) → a kept branch entry. **Narration is canon-first, then a parallel fan-out:** the **canonical** continuation generates once (ground truth), then a **single batched set of parallel calls** renders the **public** perspective and **every seat's private** `PerspectiveView` off it. That batch is the **next round's narration**, delivered in order (PUBLIC → PRIVATE) though generated together — closing the loop. The raw **canon stays GM-only**; players only ever receive the public layer and their own private view.
8. **SETTLE** — **decay** each seat's carried balance first (`× α = 0.9`), **then** grant fresh **income** (so the new allowance isn't taxed the round it arrives). Loop back to PUBLIC_NARRATION for the next round.

---

## Type model

### Reused (shipping — see [CLAUDE.md](CLAUDE.md))

| Game concept | Existing type / fn |
| --- | --- |
| **Seat vantage** | `Perspective` (`kind`, `entityRef`, `memberIds`, `agentId`) |
| **Who drives a seat** | `Member` (human) · `Agent` (AI persona) |
| **Open question + belief** | `Stream` (`outcomes`, `stance`, `priors`) |
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
  mode: 'computer' | 'remote';            // single-screen GM-proxy vs distributed
  phase: 'setup' | 'waiting' | 'round';
  locations: string[];                    // play area (subset of Location ids)
  seats: Record<string, Seat>;
  economy: ConvictionEconomy;             // GM-owned
  bets: Bet[];                            // opt-in side market; placed early, GM-settled at game end
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
}

// GM-owned scarcity. Balances live on Seat.conviction.
interface ConvictionEconomy {
  income: number;                         // allowance granted each SETTLE
  decayAlpha: number;                     // tax on banked total (0.9 = thread-volume decay)
}

// The per-round sequential machine.
type RoundPhase =
  | 'public-narration' | 'private-narration'
  | 'read-write' | 'play' | 'resolve' | 'settle';

interface RoundState {
  index: number;
  phase: RoundPhase;
  turnOrder: string[];                    // seatIds, rotated each round (poker)
  buttonSeat: string;                     // dealer button
  activeSeat: string | null;              // whose turn in PLAY
  boardStreamIds: string[];               // shared "community" streams
  hands: Record<string, Hand>;            // per seat
  pot: number;                            // committed conviction this round
  viewIds: string[];                      // the round's PerspectiveView batch (canon + public + per-seat private)
  timers: Partial<Record<RoundPhase, number>>; // ms remaining per timed phase
  mergeId?: string;                       // set at RESOLVE — the round's Merge
}

// A card = a stance commitment on one outcome of a stream.
interface Card {
  streamId: string;
  outcome: number;                        // the chosen outcome — playing the card IS choosing it on the stream
  cost: number;                           // clamp(0, 100, round(RARITY_SCALE × −ln p)); live from streamProbs
  origin: 'chosen' | 'dealt';             // own open stream vs sampled
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
  faceUp: boolean;                        // played open (visible) vs face-down (hidden)
  revealed?: boolean;                     // a face-down card the player CHOSE to show at showdown (optional)
  conviction: number;                     // committed amount (≥ cost; raise = more)
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

// Side bet — usually placed at game start, held, then GM-settled at the end.
// A call on an outcome into a pari-mutuel pool (opt-in).
interface Bet {
  seatId: string;
  streamId: string;
  outcome: number;                        // the called outcome
  stake: number;                          // into the pool; payout = pro-rata of (pool − rake)
  at: number;
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

## Constants & tunables

> Starting **defaults — hypotheses to pilot, not law**; most are **GM dials**. Where a value already lives in the engine ([`constants.ts`](src/lib/constants.ts)), reuse it.

**Round & turn limits**

| Const | Default | What |
| --- | --- | --- |
| `ROUND_LIMIT` | none (GM ends) | optional hard cap on rounds per game |
| `TIMER_PUBLIC` | 45s | public-narration window |
| `TIMER_PRIVATE` | 30s | private-narration window |
| `TIMER_READ` | 90s | deal + request-more window |
| `TIMER_TURN` | 30s | per-seat play clock (timeout → no action / cede) |
| `READ_MAX_REQUESTS` | 3 | card-requests allowed per read phase (bounds the branching loop) |

**Conviction economy** (GM-owned — the main difficulty lever)

| Const | Default | What |
| --- | --- | --- |
| `CONVICTION_START` | 100 | opening balance per seat |
| `CONVICTION_INCOME` | 50 | granted each SETTLE (≈ one mid card, or part of a long-shot) |
| `CONVICTION_DECAY` | 0.9 | tax on banked total — **reuses `STANCE_VOLUME_DECAY`** |
| `FOLD_REFUND` | 0 | fraction of staked conviction returned on fold *(open)* |
| `BLINDS` | off | opt-in poker blinds (GM toggle) |
| `BLIND_SMALL` | 5 | fixed tax on the 1st seat after the button, each round |
| `BLIND_BIG` | 10 | fixed tax on the 2nd seat after the button |

*(Economy is scaled to the **0–100 card-cost** range: a round's income covers roughly one mid call, so a long-shot or two committed cards is a real budget decision.)*

**Blinds** *(opt-in)* — when on, the two seats **after the button** post a fixed conviction tax at the start of each round, **restricting their mobility** that round; the blinds **rotate with the button** poker-style so the burden moves around the table. Off by default; purely a GM dial for pressure.

**Rarity → cost** — the price of committing a card, on an intuitive **0–100** scale:

```
cost = clamp(0, 100, round(RARITY_SCALE × −ln p))      // p = outcome's live streamProbs
RARITY_SCALE = 33   ·   range [0, 100]
```

So near-certain (`p≥0.95`) ≈ **0–2** (almost free), a modal call (`p≈0.7`) ≈ **12**, a coin-flip (`p=0.5`) ≈ **23**, a long-shot (`p=0.1`) ≈ **76**, a 1-in-20 (`p=0.05`) ≈ **99**, anything rarer **caps at 100**. Improbability *is* the price.

**Prior economy** — *work the model, don't brute-force.* A prior that **moves** a stance is paid twice: it **earns conviction** and it **shifts the distribution**, which **re-prices your cards** — pushing `p` toward your outcome lowers its `−ln p`, so the call you're building toward gets cheaper to commit.

| Const | Default | What |
| --- | --- | --- |
| `PRIOR_EARN_RATE` | 15 | conviction returned per nat of info-gain (KL on the stance) |
| `PRIOR_MIN_INFOGAIN` | 0.05 | below this → no earn (the no-op gate) |
| `PRIOR_ADMIT` | `scoreStreamPrior` threshold | implausible / over-biasing → **denied** (hard gate, separate from price) |

So the skill is finding the **realistic** prior that bends the odds your way — not grinding junk (the no-op + admissibility gates stop that).

**Side betting** — the **opt-in incentive layer** (pari-mutuel; never touches the conviction economy):

| Const | Default | What |
| --- | --- | --- |
| `BETTING_DEFAULT` | off | **consent-gated** (GM + seated players opt in together); fast-feedback rooms only |
| `BETTING_RAKE` | 0.05 | GM's cut; the rest of the pool splits **pro-rata** among winners |

Bets are typically **placed at the start of a game** — a long wager on how the whole thing resolves — then **held and forgotten** through play, and **settled manually by the GM at the end** (when the game closes or the players are done): the GM marks the winning outcome and triggers the pro-rata payout. No auto-settle — the side market stays under the sovereign's hand. The pari-mutuel pays least on the favourite — so **forcing-and-backing a long-shot** is the edge. It turns rehearsal into competition (and seeds alliances/rivalries) without changing how outcomes are shaped.

---

## Access & play modes

- **`computer` mode — single screen, zero setup.** The GM drives every seat from the desktop interface (hot-seat: `act-as-seat` → take its turn, move, chat). No tunnel, no pairing. The fast path for demos and in-person sessions.
- **`remote` mode — distributed.** Players join their own **mobile controller** over the tunnel (per-seat QR / link); a **waiting room** holds the round until seats are `joined`. The controller is the lighter **player interface**: **move, chat, read** (perspective feed + hand). *(Least-settled half — see Open questions.)*
- **Mix freely.** Some seats on phones, some GM-proxied, the rest agents. Empty competitive seats → agents so the table is never half-simulated.
- **Federated local-host.** The GM runs a **sovereign host** (Electron app + daemon; state in IndexedDB; no central server). **Async capture** rides a dark channel (QR-paired WhatsApp web-bridge / Slack-Teams connector) → per-member priors, admissibility-gated. **GM = sovereign operator** (full state, the master console); **players = guest seats** with no authority over truth and no view of others' hidden state.
- **Surfaces (the build) — minimalist, board-centric.** **The Board** is the single primary surface (poker-table view): **narration and round information are conveyed on the board itself**, not in side panels. **The Cards** / hand sit at the player's seat. **Chat** (global + location) opens as a **modal**; **navigation** (move, pose-question / request-more, settings) is via **popups** layered over the board. All **responsive across desktop + mobile**, rendered global for the GM and perspective-gated for players; per-scene **Perspective views** live in the **Content tab**. Component map: [MERMAID.md](MERMAID.md) §8.

---

## Key invariants (decided)

- **Humans decide; agents automate — and you can chat with them.** A human seat takes its turn **by hand**; an agent seat plays **automatically** from its feed each turn (no human input). Both are full participants in **global + location chat**, so you can negotiate with — or be bluffed by — an AI seat just like a human one.
- **Admissibility is a hard gate.** Every prior runs `scoreStreamPrior` before it can deal a card or move a stance — implausible/over-biasing → **denied, revise & resubmit**. Distinct from price: a plausible long-shot is *admissible but dear* (`−log p`); fantasy is refused at any price.
- **Conviction: income + decay.** Banked conviction **carries by default** but **decays** (`α = 0.9`) — no hoarding. The economy (income, decay, resets) is the GM's lever.
- **A card is a chosen outcome; a round IS a merge.** Playing a card *is* choosing one of a stream's outcomes. Played cards → the round's `Merge`; only **executive** resolutions (a committed outcome) drive the continuation; streams folded in without one ride along **recorded** (organisational record, non-driving). Contested = payment-weighted; plural = multi-resolved; never averaged. A seat may **back several cards on one stream**, but it only does what they intend when the question genuinely supports multi-resolution — otherwise the commitments contend (the player's call to know).
- **Certainty is the aggregate of conviction.** No exogenous base rate. An unplayed stance is **ceded** to others' conviction and the **stream closes at round end** — questions don't linger. A **timeout with nothing committed is the same as ceding** — no action, the LLM resolves it from the table's other plays (which already sway it).
- **The pot is spent, not won.** Unlike poker, committed conviction isn't awarded to a winner — it's **consumed** to shape the outcome and gone. Your "winnings" are the **world you forced** (plus the betting pool, if on); **folding banks** conviction for a round that matters more. There's no per-round winner — the spine is cost + consequence, not a pot.
- **Buy the outcome, not the consequences.** You can force an outcome; the engine owns the **fallout** (state-dependent — learning it is the rehearsal value, not an exploit).
- **Branch isolation.** A game is a branch; one game's belief state can't leak into another. A showdown resolves the **branch**, never the canonical trunk.
- **Replayable by design — the special part.** Every playthrough is a **branch**, and the resolver *reasons* each outcome rather than scripting it — so the **same setup replayed on a fresh branch yields a different continuation**. Run the same scenario many ways, on many branches, and the **divergence is the lesson** (it tests whether you understood *why* the first run happened). Everything in Conviction is built to be re-run and compared across branches; that's what makes it worth playing more than once.
- **Betting is separable & optional.** A GM-run **pari-mutuel** side market (pool − rake, split pro-rata), off by default, consent-gated — a surface over stance pricing that never touches Capture or the substrate.

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
- **READ economy** — how much conviction an info-gain-moving prior returns, the discount it applies, and what stops prior-grinding beyond the no-op + admissibility gates.
- **PLAY end + resolution** — one board stream or several; round ends on all-fold / threads exhausted / timer; exact payment→fate-node weighting and how the engine *shows* why it reconciled.
- **Conviction tuning** — allowance size, decay tuning, whether folding refunds, whether accumulation earns its keep at all.
- **Player mobile interface — least settled** — full perspective-gated table on the phone vs a stripped move/chat/read controller; reveals + timer on mobile; mid-game handoff between GM-proxy and a player's phone.
- **Live session security** — QR / link token lifetime, PIN gate, re-issue/revoke when a seat changes hands.
- **GM-as-player fairness** — when the GM also seats, how the master-device info edge is neutralised.
