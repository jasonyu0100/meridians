# Meridians — Build Spec

> **What this is.** The ordered, discrete steps that turn the shipping engine into a Game-Master-run product. Built to be tackled **one item at a time**: each has a goal, a concrete build list, and a *done-when* you can check off, so the work never has to be held in your head all at once.
>
> The grounded engine (force extraction, threads/stances, reasoning graphs, variable scenarios, embeddings, game theory incl. 1- and 2-player decisions) already ships — see [CLAUDE.md](CLAUDE.md). Everything here is the layer on top.

## How to read this

- **Part A — Iterative features.** Small, self-contained steps that build on the **current Next.js app + engine**, with **no new infrastructure**. Each ships value on its own. Do these first.
- **Part B — Platform changes.** The larger architectural lifts (networked access, desktop packaging, a backend, go-to-market). Do these once the loop is real.
- Each item: **Goal · Build · Done when · Depends on.** A1 → A9 is the natural order, but A7 (decks) and A8 (encryption) can be pulled early.

## Scope decisions (the guardrails)

- **The product is the behavioural loop** — **capture → rehearse → review** — not a materialised knowledge artifact.
- **One source of truth: the GM's machine.** No sync, no merge, no conflict. The only server-side component ever introduced is the Part B drive microservice.
- **Per-perspective is load-bearing.** Each seat keeps its own stance; divergence is preserved (an adversary's seat holds deliberately hostile priors). Don't collapse seats into one aggregate read.
- **Two ways in for non-GMs:** **live** (full interface over an ngrok tunnel) and **dark** (a WhatsApp group as the always-open async capture layer; the GM curates and commits). The dark path is a *process* with near-zero build (Part A); the live path is an *infrastructure* lift (Part B).
- **Commercialization pricing** follows the unbundled model in the manifesto Economics section (setup / facilitation / software, priced by service-intensity).
- **Card-based information-asymmetric gameplay is exploratory** — design before committing.

---

# Part A — Iterative features (build on the app you have)

No new infrastructure. Each is a step you can finish and ship before starting the next.

### A1 · Per-perspective ownership
- **Goal:** every seat owns its own open threads, with a general perspective by default.
- **Build:**
  - [ ] A seat → threads ownership model (each seat its own open questions).
  - [ ] A perspective selector on the Priors/Driver surface; general perspective as the default.
  - [ ] Two seats can hold opposed stances on the *same* thread without averaging.
- **Done when:** you can file a prior to a specific seat and an adversary seat can hold an opposite stance on that thread — no pooling.
- **Depends on:** existing threads/stances. Foundational — do first.

### A2 · Calibrated-reading view
- **Goal:** read out each seat's running probability per thread as priors accumulate.
- **Build:**
  - [ ] A per-seat stance readout (uses the Fate engine) over the Priors surface.
  - [ ] The readout moves visibly as priors are added to that seat.
- **Done when:** adding priors to a seat shifts that seat's thread probabilities on screen.
- **Depends on:** A1.

### A3 · Commit a decision → advance the sim
- **Goal:** turn a high-certainty stance into a committed move that advances the simulation.
- **Build:**
  - [ ] A "commit decision" action on a high-certainty stance.
  - [ ] Committing writes the move and advances state (the next N scenes / the board).
- **Done when:** committing a high-certainty decision advances the room.
- **Depends on:** A2.

### A4 · Rehearsal play UX
- **Goal:** play the contested space forward across the Compass cohort without re-enacting the prior.
- **Build:**
  - [ ] Play UX layered on the existing Branch/Variable Scenarios cohort.
  - [ ] Contested-thread protection (no forced resolution) + a per-play divergence directive.
  - [ ] Each play-through forks and is kept.
- **Done when:** you can run a play-through that explores the state space; committed stances act as soft priors, contested threads stay open.
- **Depends on:** A3 + the existing Scenarios/Compass.

### A5 · Review — post-play audit
- **Goal:** see how the playthrough varied from the predicted cohort; turn divergence into the next thing to capture.
- **Build:**
  - [ ] A played-path-vs-cohort comparison surface.
  - [ ] A divergence → "next thread to capture" hand-off back into A1.
- **Done when:** after a play-through you get a variance view and can push a divergence into Capture.
- **Depends on:** A4.

### A6 · Review — Butterfly (per-decision causal audit)
- **Goal:** audit each committed decision for what reality did to it.
- **Build:**
  - [ ] **Sealed decision record** — freeze the decision at commit, non-editable (for 1-player decisions, capture the commit-time stance as a number — the stronger seal).
  - [ ] **Causal-reach trace** — the reasoning-graph subgraph downstream of the sealed node.
  - [ ] **Revisable verdict** — re-reads downstream Fate as more threads resolve.
  - [ ] Decide the **bounded-vs-open-ended closure rule** (the live design question).
- **Done when:** a committed decision shows a verdict that updates as downstream threads resolve.
- **Depends on:** A3 (committed decisions) + reasoning graph + Fate. *Have:* decision model (1-/2-player) + ELO.

### A7 · Review — slide-deck playback
- **Goal:** a generated deck of the session that doubles as onboarding / re-sync.
- **Build:**
  - [ ] Deck generation scoped to a session / arc / set of decisions, over `SlidesPlayer`.
  - [ ] Regeneration as the substrate moves; a "what changed since you last looked" mode.
- **Done when:** you can generate and replay a current session deck.
- **Depends on:** the slides feature (`SlidesPlayer`, `lib/slides-data.ts`). **Can ship early** — the most accessible surface and the cleanest demo of "see how the team decides."

### A8 · Local encryption + PIN gate
- **Goal:** protect the substrate at rest and gate access to the room.
- **Build:**
  - [ ] Encrypt the `.meridian` at rest (the substrate serialised as one encrypted artifact).
  - [ ] PIN / password gate on opening the room.
- **Done when:** the on-disk `.meridian` is ciphertext and opening the room needs the PIN.
- **Depends on:** nothing. **Can be done anytime**; it's the prerequisite for B1 (networked access).

### A9 · WhatsApp dark-capture workflow
- **Goal:** make GM curation of WhatsApp drops frictionless — a process, not infrastructure.
- **Build:**
  - [ ] A "paste-and-route" affordance: paste a member's note, pick the seat, commit.
  - [ ] (Process) the GM reads the group when the instance comes online and routes each drop into the seat it came from.
- **Done when:** the GM can land a pasted observation on the right seat in a couple of clicks. **No backend.**
- **Depends on:** A1 (seats) + A2.

---

# Part B — Platform changes (the larger lifts)

Do these once the loop in Part A is real. Each is a distinct architectural change.

### B1 · Live multi-user access (ngrok)
- **Goal:** non-GMs use the **full interface** live over an ngrok tunnel — not a crippled mobile view.
- **Build:**
  - [ ] A responsive / mobile-friendly interface (the same app, usable on a phone over the tunnel).
  - [ ] A role / permission split — GM elevated, non-GMs read-write.
  - [ ] A tunnel-launch + URL-share affordance from the console.
- **Done when:** a non-GM opens the URL on a phone and can read-write the live state; the GM keeps elevated controls; access is PIN-gated.
- **Depends on:** A8 (PIN) + the Part A loop surfaces it exposes. **No server-side component** — ngrok is a third-party tunnel.

### B2 · Electron desktop app + auto-update
- **Goal:** ship as a desktop binary — the room is an app, not a browser tab.
- **Build:**
  - [ ] Wrap the same Next.js build in **Electron** (known persistence location for the encrypted `.meridian`, console one launch away).
  - [ ] Auto-update via `electron-updater` (or Squirrel) against a **release feed** (static host, or served from B3).
  - [ ] Substrate versioned independently of the binary, with migrations — app updates never touch `.meridian` data.
- **Done when:** the GM installs an app that self-updates; data survives updates.
- **Depends on:** a stable core app (Part A). Can parallelize once settled; wants a CI build → signed artifact → feed pipeline.

### B3 · Accounts + `.meridian` drive microservice
- **Goal:** the **only** server-side component — auth plus an opt-in encrypted-file drive.
- **Build:**
  - [ ] **Auth / accounts** — sign-up / sign-in / identity; the login that gates the drive and subscription.
  - [ ] **`.meridian` file drive** — online storage + sync of **ciphertext-only** `.meridian` files (zero-knowledge blob store), opt-in, local-first by default.
- **Done when:** a user signs in and can back up / sync their encrypted `.meridian` across devices; the master device stays the source of truth.
- **Depends on:** A8 (files already encrypted). Keep it small — auth + blob storage, nothing more.

### B4 · Commercialization
- **Goal:** distribute and monetize.
- **Build:**
  - [ ] **Landing page** — download the Electron build, sign up, present the product.
  - [ ] **Subscription billing** tied to accounts (through B3's account layer), following the unbundled pricing in the manifesto Economics section (setup / facilitation / software).
- **Done when:** a buyer can land, download, sign up, and pay.
- **Depends on:** B3 (accounts) + B2 (the app to distribute).

---

## Deferred (wanted next, not in the entry product)

- **Live-updating per-seat stances** — a seat's stance moving in real time as priors arrive, rather than only when the GM curates and commits. The single most valuable next step (it makes the room a living model, not a periodic snapshot). Deferred on purpose: the GM-as-gatekeeper commit step is the ship-ready model; auto-commit is the upgrade once the loop is proven. Per-perspective divergence is preserved either way — this is about *when* a stance updates, not whether seats stay distinct.

## Exploratory / undecided

- **AI-simulated seats → autonomous rooms** — because Capture is per-perspective, an empty/quiet seat can have its priors **simulated** from its stances + open questions. Progression: (1) fill a missing perspective so an underserved team isn't blind; (2) AI agents take seats beside humans; (3) fully autonomous rooms. Humans stay the main support; the spectrum, not a replacement. Builds on A1.
- **High-end custom security** — bespoke approaches beyond the A8 encryption + PIN baseline (air-gapped operation, local inference, custom key management). Per-engagement, not a shipped tier.
- **Card-based, information-asymmetric gameplay** — the full War Room card game (cards as intent signals, private logs, phased turns). Worth prototyping the interaction model; design before committing engine work. Not scheduled.

---

## Build order at a glance

```
PART A — iterative features (current app, no new infra)
  A1  Per-perspective ownership        seats own their own threads
  A2  Calibrated-reading view          per-seat probabilities move with priors
  A3  Commit decision → advance sim    high-certainty stance advances the room
  A4  Rehearsal play UX                play the cohort forward, divergence protected
  A5  Review — post-play audit         played vs cohort; divergence → next capture
  A6  Review — Butterfly               sealed decision · causal trace · revisable verdict
  A7  Review — slide-deck playback     session deck; can ship early
  A8  Local encryption + PIN           .meridian at rest + gate; anytime
  A9  WhatsApp dark-capture workflow   paste-and-route; no backend

PART B — platform changes (after the loop is real)
  B1  Live multi-user access (ngrok)   full interface over the tunnel; roles; PIN-gated
  B2  Electron desktop + auto-update   app not a tab; self-updating
  B3  Accounts + .meridian drive       only server component; ciphertext-only sync
  B4  Commercialization                landing page + subscription billing
```

## Housekeeping

- **Taxonomy counts reconciled (2026-06):** code = **11 `ActionAxis` / 16 `GameType`** (verified against `src/types/narrative.ts`); manifesto, LANGUAGE.md, and CLAUDE.md all say 11/16. LANGUAGE.md stays the source of truth if they drift.
- Keep [LANGUAGE.md](LANGUAGE.md) the single source of truth for every concept named here.
