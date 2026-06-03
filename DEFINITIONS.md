# Meridians Narrative Definitions

Comprehensive reference for all narrative classification systems, scene modes, beat types, structural archetypes, and game-theory tagging used throughout Meridians.

---

## Scene Classes (Cube Corners)

The **narrative cube** maps scenes into 3D force space. Each corner represents a distinct mode of storytelling, defined by high/low combinations of the three fundamental forces.

**Force Axes:**
- **Payoff (P)** — Thread resolution intensity
- **Change (C)** — Character transformation magnitude
- **Knowledge (K)** — World-building depth

### The 8 Cube Corners

| Key | Name | Forces | Description |
|-----|------|--------|-------------|
| **HHH** | **Epoch** | P↑ C↑ K↑ | Everything converges — threads resolve, characters transform, and the world's rules expand. A defining moment that reshapes the narrative landscape. |
| **HHL** | **Climax** | P↑ C↑ K↓ | Threads resolve and characters transform within established world rules. The payoff of what's already been built — no new lore needed. |
| **HLH** | **Revelation** | P↑ C↓ K↑ | Threads pay off through world-building. The world's rules explain why things happened — lore unlocks resolution without personal transformation. |
| **HLL** | **Closure** | P↑ C↓ K↓ | Quiet resolution within established world rules. Tying up loose ends — conversations that needed to happen, debts paid, promises kept or broken. |
| **LHH** | **Discovery** | P↓ C↑ K↑ | Characters transform through encountering new world systems. No threads resolve — pure exploration, world-building, and possibility. |
| **LHL** | **Growth** | P↓ C↑ K↓ | Internal character development within established world rules. Characters train, bond, argue, and change through interaction — no new lore. |
| **LLH** | **Lore** | P↓ C↓ K↑ | Pure world-building without resolution or transformation. Establishing rules, systems, cultures, and connections for future payoff. Seeds planted in the world's structure. |
| **LLL** | **Rest** | P↓ C↓ K↓ | Nothing resolves, no one transforms, no new world concepts. Recovery and breathing room — quiet character deliveries and seed-planting. |

**Usage:**
Cube corners guide scene generation via Markov chains and provide structural vocabulary for discussing narrative rhythm.

---

## Beat Classes

Beats are the atomic units of scene structure — individual moments that advance story, reveal character, or build world.

### Beat Functions (What the beat does)

| Function | Description |
|----------|-------------|
| **breathe** | Pacing, atmosphere, sensory grounding, scene establishment |
| **inform** | Knowledge delivery — character or reader learns something now |
| **advance** | Forward momentum — plot moves, goals pursued, tension rises |
| **bond** | Relationship shifts between characters |
| **turn** | Scene pivots — revelation, reversal, interruption |
| **reveal** | Character interiority exposed — desires, fears, secrets surface |
| **shift** | POV character's perspective changes on situation or person |
| **expand** | World-building — systems, rules, culture, or lore introduced |
| **foreshadow** | Future events or themes seeded subtly |
| **resolve** | Local tension released — question answered, immediate conflict settled |

### Beat Mechanisms (How it's delivered)

| Mechanism | Description |
|-----------|-------------|
| **dialogue** | Characters speaking |
| **thought** | Internal monologue |
| **action** | Physical movement, gesture, body in space |
| **environment** | Setting, weather, arrivals, sensory details |
| **narration** | Narrator addresses reader, authorial commentary, rhetoric |
| **memory** | Flashback, recollection, past event recalled |
| **document** | Letter, inscription, found text, in-world artifact |
| **comic** | Visual gag, physical comedy, absurd juxtaposition |

**Usage:**
Each scene contains a sequence of beats. Beat profiles (distributions of functions and mechanisms) define authorial voice and pacing style.

---

## Game Theory Tagging

Every scene is additively decomposed into a sequence of **2×2-style strategic games**, one per strategic beat (written to `scene.gameAnalysis`, never mutating deltas). Each game names the *shape* of a decision — the full space of choices each party could have made and the consequence of every pairing — and marks the **realized cell** (what the author actually wrote). The shape says how stake *can* move; the realized cell says how it *did* move; the gap is what was left on the table.

Tagging happens on three layers: each game carries a **game kind**, an **action axis**, and a **game type (shape)**; the realized outcomes feed **ELO / stake metrics**; and those metrics aggregate into per-player **behavioural tags**.

### Game Kind

| Kind | Shape | Description |
|------|-------|-------------|
| **duel** | N×M matrix | Two strategic agents, each with a menu of actions. Every (A-action, B-action) pairing is a scored cell. Default kind. |
| **solo** | row of options | One decider facing a pivotal choice against the world (reality in the other seat). A menu of options, one immediate outcome each — no opponent column. |

### Action Axes (the dimension the choice trades on)

Both players' actions live on the **same** axis — the thing that *shifts* as a result of the decision, not the surface topic. Eleven axes (consolidated from earlier finer sets; e.g. *control* and *confrontation* fold into pressure, *moral* into commitment):

| Axis | Question it asks |
|------|------------------|
| **information** | reveal ↔ conceal — what facts about the world does each side expose or hide? |
| **identity** | claim ↔ disown — do I assert who I am, or distance myself from it? |
| **trust** | extend ↔ guard — do I lower my defenses, or keep them up? |
| **alliance** | ally ↔ separate — are we on the same side going forward, or not? |
| **status** | assert ↔ defer — do I push for the higher position, or yield rank? |
| **pressure** | press ↔ yield — how much force am I applying, or absorbing? (absorbs control, confrontation) |
| **stakes** | escalate ↔ deescalate — am I raising or lowering what's on the line? |
| **resources** | take ↔ give — who ends up holding the resources / lives / knowledge? |
| **obligation** | incur ↔ discharge — am I taking on a debt/favor, or paying it off? |
| **commitment** | commit ↔ withdraw / hedge — am I binding myself, or keeping options open? (absorbs moral) |
| **timing** | act ↔ wait — do I move now, or hold and watch? |

### Game Types (the strategic shape)

Sixteen shapes (consolidated from 19 — battle-of-sexes folds into coordination, cheap-talk into signaling, pure-opposition drops, anti-coordination renamed divergence). Classified by a decision procedure over **scope → mechanism → information × preference**.

| Group | Type | Shape |
|-------|------|-------|
| Symmetric-info | **coordination** | Both want to end up in the same place; stake moves together when actions match (incl. battle-of-sexes flavour). |
| | **stag-hunt** | Coordination with a trust gate — big shared prize vs. the safe solo play. Payoff-dominant Nash is risk-dominated. |
| | **dilemma** | Mutual cooperation pareto-dominates Nash, but each has a private incentive to defect (prisoner's-dilemma). |
| | **chicken** | Both want the other to yield; if neither does, both crash (incl. war-of-attrition). |
| | **divergence** | Both *actively* want to differ on a shared axis. (One-sided → stealth or zero-sum.) |
| | **zero-sum** | Grid literally sums to zero in every cell — any +X for one is −X for the other. |
| Asymmetric-info | **signaling** | Informed party reveals type via a costly, hard-to-fake action (absorbs cheap-talk when costly enough). |
| | **screening** | Uninformed party *designs* a mechanism to sort agents by type — tests, auditions, loyalty trials. |
| | **principal-agent** | Delegation **and** hidden action — task handed off and execution opaque (both required). |
| | **stealth** | Covert action vs. an unaware observer whose only move is attention allocation (no delegation). |
| Mechanism | **stackelberg** | Sequential commit-then-respond — leader moves visibly first, follower best-responds. |
| | **bargaining** | Offer → counter → accept/reject rounds (one-shot ultimatum is the degenerate case). |
| | **commitment-game** | Whether one party can *credibly* self-bind IS the game (vow, burned bridge, hostage, contract). |
| Multi-party | **contest** | N-player rank-ordered competition for a prize. |
| | **collective-action** | N-player threshold contribution with free-rider dynamics. |
| Degenerate | **trivial** | No real strategic content — the choice is in name only. Used sparingly. |

### Stake & ELO Metrics

Each outcome cell carries integer **stake deltas** in `[-4, +4]` per player — how much that outcome advances or harms a player's arc-level interests if it were the one that happened. Magnitude is **inflection, not drama**, and is calibrated against the *whole work*, not the sentence:

| Value | Meaning |
|-------|---------|
| **±4** | Arc-defining / irreversible — the trajectory itself changes. Rare. |
| **±3** | Major — clearly shifts the balance; hard to undo. |
| **±2** | Moderate — a real but recoverable move (the modal score). |
| **±1** | Minor — a nudge; a small edge or cost. |
| **0**  | Neutral — nothing material moved. |

Over-crediting is the common failure: most decisions are ±1–±2, and a beat where everything scores ±3/±4 is inflated. The two kinds of decision read the scale differently: a **two-player** decision is scored on **relative reward** — each side's delta and the differential `ΔA − ΔB` (who gains relative to whom). A **one-player** decision is scored on its **field of alternatives** — each option's outcome, so the chosen option's reward is weighed fairly by its **contribution** against what else was available (taking +2 when +4 was on the table is a costly call), not in isolation.

| Metric | Definition |
|--------|------------|
| **Margin score** | `clamp(0.5 + (ΔA − ΔB)/16, 0, 1)` — continuous score ELO consumes; folds margin-of-victory into the math (+4/−4 crush = 1.0, +1/0 edge ≈ 0.56, tie = 0.5). Solo: `clamp(0.5 + ΔA/8, 0, 1)` against par. |
| **Game score (W/L/D)** | Binary 1 / 0 / 0.5 for display — *not* what ELO reads. |
| **ELO** | `ELO_INITIAL = 1500`, `ELO_K = 32`; `K_effective = K × min(1, max\|stake\|/4)` so crucial moments move ratings far more. Solo decisions play reality at par (1500), and only the decider's rating moves. |
| **Nash** | A realized cell is a (weak) pure-strategy equilibrium if neither player could unilaterally improve their stake delta. Descriptive, not normative — off-Nash cells are exactly what ELO learns from. |
| **Stake rank** | Rank of the realized cell among all outcomes by stake delta for a player (1 = best available). |
| **Arc cost** | Stake left on the table — `max(stake in realized row/column) − realized stake`. Rises when a player trades local stake for identity / principle / arc. |

### Behavioural Tags

ELO trajectory, outcome shape, game-type participation, and role split aggregate per player into orthogonal tags. One **narrative-role headline** leads; mechanical tags follow.

**Narrative role (headline, one max)** — a cross-genre pattern over the signals:

| Tag | Pattern |
|-----|---------|
| **prime mover** | Rising ELO, leads the play, repeatedly lands above what the grid predicts — the world bends around them. |
| **adversary** | Dominates grids at others' expense; lives in conflict / power-framing games. |
| **tragic figure** | Absorbs losses for others and pays for it — ELO declines while carrying the sacrifice. |
| **mentor** | Cooperative, steady ELO, gives more stake than they take. |
| **comeback** | Arc shifts upward — later outcomes better than early; growth / redemption. |
| **slipping** | Arc shifts downward — started stronger than they end. |
| **trickster** | Info-asymmetric games, high variance, mostly ends ahead. |
| **counterforce** | Almost always responding, almost always in conflict, ELO near baseline. |
| **anchor** | High participation, near-baseline ELO, broadly cooperative — the stable presence. |

**Outcome shape (one max):** **extractor** (wins at another's expense) · **sacrificial** (pays so others gain) · **scorched-earth** (both-lose cells dominate) · **uneven ally** (cooperates but stacked in their favour) · **ally** (genuine even cooperator).

**Trajectory (one max):** **dominant** (lands near the top of every grid) · **rising** / **falling** (ELO climbed / eroded ≥80) · **high-variance** (swings big) · **steady** (rating barely moves).

**Solo decision style:** **soloist** (mostly 1-player bets against the world) · **sure-handed** (usually takes the stake-maximising option) · **gambler** (routinely passes up the safe-best for the upside).

**Solo decision axis:** **solo: X** — the characteristic dimension of a player's bets against the world, isolated from their duel axis affinity. In a solo decision reality sits in the other seat, so this names the silent counterpart they keep playing. On the **timing** axis that counterpart is literal — the clock — so **solo: timing** marks a player forever choosing *when* to move (act ↔ wait) against time itself.

**Strategic style (one max):** **defies the odds** (wins off-Nash cells rational play says they shouldn't — protagonist signature) · **strategist** (lands on Nash, plays the defensible move) · **off-script** (rarely plays the rational move).

**Strategic agency (from game-type participation):** **schemer** (plays the information game and wins it) · **power-broker** (sets the terms, first mover in commitment / bargaining) · **combatant** (lives in zero-sum / chicken / divergence) · **coordinator** (builds shared action in alignment games).

**Arc shift:** **upward arc** / **downward arc** (late-vs-early stake split).

**Relational:** **rival: X** (losing record concentrated against X) · **leads: X** (winning record concentrated against X).

**Role bias:** **initiator** (almost always Player A) · **responder** (almost always Player B).

**Affinity:** **axis: X** (most choices trade on axis X) · **X-heavy** (most decisions sit inside game-type X).

**Files:**
`src/lib/game-theory.ts` (pure math), `src/lib/ai/game-analysis.ts` + `src/lib/prompts/scenes/game-theory.ts` (LLM decomposition), `src/types/narrative.ts` (`ActionAxis`, `GameType`, label tables), `src/components/topbar/GameTheoryDashboard.tsx` (behavioural tags), `src/components/canvas/SceneGameTheoryView.tsx` (per-scene payoff matrix).

---

## Narrative Archetypes

Archetypes classify stories by **force dominance** — which of the three forces (Payoff, Change, Knowledge) reach narrative-grade strength.

| Archetype | Dominant Forces | Description |
|-----------|----------------|-------------|
| **Opus** | P + C + K | All three forces in concert — payoffs land, characters transform, and the world deepens together |
| **Tempest** | P + C | Violent forces that leave nothing unchanged — consequences land and characters are reshaped by them |
| **Chronicle** | P + K | Resolutions deepen the world — each payoff reveals how things work |
| **Mosaic** | C + K | Many lives composing a larger picture — characters transform within a deepening world |
| **Classic** | P | Driven by resolution — threads pay off and relationships shift decisively |
| **Show** | C | People-driven — characters transform and their journeys are the heart of the story |
| **Paper** | K | Dense with ideas and systems — the depth of the world itself is the draw |
| **Emerging** | — | No single force has reached its potential yet — the story is still finding its voice |

**Thresholds:**
A force is "dominant" if it scores ≥21/25 AND is within 5 points of the highest-scoring force.

---

## Narrative Shapes

Shapes classify the **macro-structure** of delivery curves — how intensity rises and falls across the full story.

| Shape | Description | Curve Pattern |
|-------|-------------|---------------|
| **Climactic** | Build, climax, release — one dominant peak defines the arc | Steady rise → sharp peak (mid/late) → decline |
| **Episodic** | Multiple peaks of similar weight — no single climax dominates | Repeating rises and falls, no clear maximum |
| **Rebounding** | A meaningful dip followed by strong recovery | Start high → collapse → strong recovery |
| **Peaking** | Dominant peak early or mid-arc, followed by decline | Early high → sustained fall |
| **Escalating** | Momentum rises overall — intensity concentrated toward the end | Gradual, sustained rise to finish |
| **Flat** | Too little structural variation — no meaningful peaks or valleys | Near-constant delivery values |

**Detection Metrics:**
- **Overall Slope** — Macro trend (rising, falling, stable)
- **Peak Count** — Number of detected local maxima
- **Peak Dominance** — Largest prominence / total prominence
- **Peak Position** — Where the dominant peak falls (0..1)
- **Trough Depth** — Magnitude of central valley (V-shape detector)
- **Flatness** — Standard deviation of smoothed curve

---

## Story Scales

Scales classify narratives by **scene count** — the fundamental measure of scope.

| Scale | Scene Range | Description | Examples |
|-------|-------------|-------------|----------|
| **Short** | < 20 | A contained vignette — one conflict, one resolution | Short story, one-act play |
| **Story** | 20–50 | A focused narrative with room for subplot and development | Romeo & Juliet (24), Great Gatsby (44) |
| **Novel** | 50–120 | Full-length narrative with multiple arcs and cast depth | 1984 (75), HP books (89–110), Tale of Two Cities (100) |
| **Epic** | 120–300 | Extended narrative with sprawling cast and world scope | Reverend Insanity Vol 1 (133) |
| **Serial** | 300+ | Long-running multi-volume narrative with evolving world | Full web serials, multi-volume sagas |

**Calibration:**
Derived from analysis of published literary works and web serials.

---

## World Density

Density measures the **richness of the world relative to story length** — how many entities exist per scene.

**Formula:**
```
Density = (characters + locations + threads + systemNodes) / scenes
```

| Density Class | Density Range | Description | Examples |
|---------------|---------------|-------------|----------|
| **Sparse** | < 0.5 | Minimal world scaffolding — story over setting | Minimalist narratives |
| **Focused** | 0.5–1.5 | Lean world built to serve specific narrative needs | Tightly plotted thrillers |
| **Developed** | 1.5–2.5 | Substantial world with layered characters and tensions | Tale of Two Cities (1.7) |
| **Rich** | 2.5–4.0 | Dense world where every scene touches multiple systems | HP Azkaban (2.1), HP Chamber (2.7), Romeo & Juliet (3.2) |
| **Sprawling** | 4.0+ | Deeply interconnected world — every corner holds detail | AI-generated high-density narratives |

**Calibration:**
Thresholds derived from analysis of classic literary works.

---

## Narrative Position

Position classifies the **local delivery state** at a given point in the story — where you are in the current rhythm.

| Position | Description |
|----------|-------------|
| **Peak** | Deliveries are at a local high — intensity is cresting |
| **Trough** | Deliveries are at a local low — energy has bottomed out |
| **Rising** | Deliveries are climbing — building toward a high point |
| **Falling** | Deliveries are declining — unwinding from a high |
| **Stable** | Deliveries are holding steady — no strong directional movement |

**Detection:**
Checks proximity to detected peaks/valleys first (within last 4 points), then falls back to recent slope direction.

---

## Force Grading System

Forces are graded on a **0–25 scale per dimension**, with an overall score of 0–100.

### Reference Means (Calibrated from Literary Works)

| Force | Reference Mean | Description |
|-------|----------------|-------------|
| **Fate** | 5.3 | Expected mean per-scene information gain across threads |
| **World** | 14 | Expected mean raw value for entity graph depth per scene |
| **System** | 3.5 | Expected mean raw value for rule/mechanism density per scene |

### Grading Curve

At reference mean (x̃ = 1.0), a force scores ~21/25 (dominance threshold).
Grade = `25 − 17·e^(−k·x̃)` where x̃ = (raw mean) / (reference mean), k = ln(17/4).

**Overall Grade:**
Sum of individual rounded grades: `payoff + change + knowledge + swing`

**Grade Interpretation:**
- **90–100** — Masterwork-tier execution
- **75–89** — Strong, professional-grade narrative
- **60–74** — Solid foundation, room to refine
- **45–59** — Structural potential, needs development
- **< 45** — Early draft or experimental structure

---

## Usage in Meridians

These definitions are used throughout the platform:

1. **Scene Generation** — Markov chains sample cube corner sequences to guide LLM structure
2. **Branch Evaluation** — Archetypes and shapes provide high-level structural vocabulary
3. **Analytics** — Density, scale, and position classify narratives for comparison
4. **Planning** — Course correction uses force gradients and cube trajectories
5. **Visualization** — Cube viewer, delivery curves, and force charts all map to these concepts
6. **Game Theory** — Per-scene decomposition into games (axis + shape), ELO rankings, and behavioural tags (Decision Matrix / Game Theory Dashboard)

**Formulas & Implementation:**
See `src/lib/narrative-utils.ts` for full mathematical definitions and detection algorithms.

---

**Version:** Aligned with Meridians narrative type refactor (January 2025)
**Calibration Source:** Harry Potter, Tale of Two Cities, 1984, Great Gatsby, Romeo & Juliet, Reverend Insanity, Crime & Punishment, Coiling Dragon
