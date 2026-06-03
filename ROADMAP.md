# Meridians — Roadmap

> **What this is.** A focused implementation plan for the features that turn the engine into a playable, Game-Master-run product. Much of this is *described* in the [manifesto](src/app/manifesto/page.tsx) and the [LANGUAGE.md](LANGUAGE.md) glossary but **not yet built** — this file is the order to build it in, and why.
>
> The grounded engine (force extraction, threads/stances, reasoning graphs, variable scenarios, embeddings, game theory incl. 1- and 2-player decisions) already ships — see [CLAUDE.md](CLAUDE.md). The roadmap is the layer on top: the **behavioural loop**, then **security**, then the **mobile play surface**, then **distribution** (a desktop app), **accounts + an encrypted `.meridian` drive**, and **commercialization**.

## North star

Make Meridians **accessible to players** and **enhance the Game Master** and the tools they're exposed to. One Game Master on one master device runs the room; everyone else joins as a seat. The product is the **calibrate → rehearse → review** loop, played on a console with mobile controllers.

## Scope decisions (read first)

- **The room's value is the behavioural loop** — calibrate, rehearse, review — not a materialised knowledge artifact.
- **Rehearsal stays "Rehearsal."** (The breadth game; not renamed.)
- **The online drive becomes a real backend** — a single **auth + `.meridian` file-drive microservice** (the only server-side component). Sync stays **opt-in and local-first by default**; the drive holds **ciphertext only** (zero-knowledge blob store), the master device stays the source of truth.
- **Two security layers, kept distinct:** *local* (encryption + PIN/password protecting on-device data and the room) and *account auth* (sign-in for the online drive + subscription, in the microservice). Not a sprawling identity platform.
- **Distribution is an Electron desktop app**; go-to-market is a **landing page + subscription pricing** tied to accounts.
- **Card-based information-asymmetric gameplay is exploratory** — still up in the air. Design before committing.

---

## Phase 1 — The behavioural loop (core)

The set of features that make the loop real and player-facing. Build in dependency order; each is documented in the manifesto but needs the actual UX + engine wiring.

### 1.1 Calibration
*The depth game.* Per-perspective Priors → a calibrated stance on open threads → commit the high-certainty decisions that advance the simulation.
- **Have:** the Priors surface (Driver/Queue), threads/stances, the Fate engine.
- **Build:** per-perspective thread ownership (each seat its own open questions + a general perspective), the calibrated-reading view, and the "commit a high-certainty decision → advance the sim" action.
- **Depends on:** nothing new. Foundational — do first.

### 1.2 Rehearsal
*The breadth game.* Play the Compass's possible trajectories forward across multiple timelines, from the calibrated stance (not by gathering new priors).
- **Have:** Variable Scenarios + Branch Scenarios (parallel arc continuations, softmax cohort) as the base.
- **Build:** the Rehearsal play UX on top of the Compass cohort; contested-thread protection + per-play divergence so it explores the state space rather than re-enacting Calibration's prior.
- **Depends on:** Calibration (the stance it plays forward from) + the Compass.

### 1.3 Butterfly
*Causal evaluation of decisions over time.* A sealed decision → trace its causal subgraph along the reasoning graph → resolve as the Fate outcomes it caused; a revisable verdict that builds a belief on how good/bad each decision was.
- **Have:** the decision model (1- and 2-player, scored through ELO — done), the reasoning graph + causal edges, Fate thread resolutions. Concept fully documented in the manifesto's *Butterfly* section.
- **Build:** the **sealed decision record** (freeze the decision at commit, non-editable — and for 1-player decisions capture the commit-time stance as a number, the stronger seal); the **causal-reach trace** over the reasoning-graph subgraph downstream of the sealed node; the **revisable verdict** that re-reads downstream Fate as more threads resolve. Decide the **bounded-vs-open-ended closure rule** (the live design question).
- **Depends on:** the decision model (done) + reasoning graph + Fate. Build after Calibration/Rehearsal exist to evaluate.

### 1.4 Review (War Room Review)
*The audit that closes the loop.* Show how a playthrough varied against the predicted state space (the softmax-ranked Compass cohort); the divergence becomes the next thread to calibrate. Related to Butterfly (it's the retrospective).
- **Build:** the post-play comparison surface (played path vs predicted cohort) and the hand-off of divergences back into Calibration.
- **Depends on:** Rehearsal (the playthrough) + Compass (the prediction) + Butterfly (the per-decision audit).

### 1.5 Onboarding decks (playback)
*The lightweight way in.* **Generated slide decks** over parts of the narrative/substrate — a room's history and the key decisions that shaped it — that **update a person's priors** when they join a team, move between teams, or are introduced to a new room. The fourth Loop surface; replaces the deleted question-bank onboarding with something lighter than convening a session.
- **Have:** the slides feature (`SlidesPlayer`, `lib/slides-data.ts`, individual slide components) as the base.
- **Build:** deck generation scoped to a narrative slice / arc / set of decisions; **regeneration as the substrate moves** so decks stay current; a "what changed since you last looked" mode so returning members re-sync. Butterfly verdicts and resolved threads make natural deck beats.
- **Depends on:** the substrate (have) + the behavioural loop producing decisions worth narrating. Can ship early — it's the most accessible surface and the cleanest demo of "see how the team decides."

---

## Phase 2 — Security (basic, focused)

Protect key data before it's exposed on a shared screen or a phone. Minimal, not a full identity system.
- **Encrypted `.meridian` files** at rest (the substrate serialised as one encrypted artifact).
- **PIN / password gating** of access to key data and the room.
- **Depends on:** nothing; but it's a prerequisite for the mobile surface (the tunnel + join are PIN-gated). Do before Phase 3.

---

## Phase 3 — Mobile play surface (ngrok + QR)

The **controllers**. The console (laptop / master device) holds truth and drives the shared screen; phones join as stateless controllers.
- **Mobile-compatible interface** served over the **ngrok tunnel** — no install.
- **QR-code join** from the shared screen; **PIN-gated** entry (Phase 2).
- **What a controller does:** contextual chat, queue/Priors contributions, and viewing the belief patterns moving on the operator's local threads over time. Each phone sends intent; the host writes it and returns state (no phone-side copy of the substrate).
- **Depends on:** Phase 2 (PIN gating) + the behavioural loop surfaces it exposes.

---

## Phase 4 — Distribution: Electron desktop app

Package the local-first app as a desktop binary — the coherent install the manifesto describes.
- **Build:** wrap the same Next.js build in **Electron**; the master device runs it like a native app (keyboard shortcuts, a known persistence location for the encrypted `.meridian`, the tunnel-and-QR surface one menu item away). Same code; the surface around it stops being a browser tab.
- **Auto-update:** ship new app versions to installed clients without a manual reinstall — `electron-updater` (or Squirrel) against a **release feed** (a static release host, or served from the Phase 5 backend). The Game Master's device stays current automatically; app updates change the *app*, never the user's `.meridian` data (the substrate is versioned independently of the binary, with migrations as needed).
- **Depends on:** a stable core app (Phases 1–3). Can proceed in parallel once the app settles; auto-update wants a release/publish pipeline (CI build → signed artifact → feed).

---

## Phase 5 — Accounts & backend microservice (auth + `.meridian` drive)

One focused microservice — the **only server-side component** — doing two jobs:
- **Authentication & accounts** — sign-up / sign-in / account identity. The login that gates the online drive and the subscription.
- **`.meridian` file drive** — online storage + sync of encrypted `.meridian` files across a user's devices. **Ciphertext only** (zero-knowledge blob store): the substrate is encrypted client-side (Phase 2), the master device stays the source of truth, the drive is opt-in backup/sync. This *is* the online drive, now concrete and account-bound.
- **Depends on:** Phase 2 (the files it stores are already encrypted). Keep it small — auth + blob storage, nothing more.

---

## Phase 6 — Commercialization: landing page + subscription

- **Landing page** to distribute the app (download the Electron build, sign up) and present the product.
- **Subscription pricing** tied to accounts (billing through the microservice's account layer).
- **Depends on:** Phase 5 (accounts) + Phase 4 (the app to distribute).

---

## Exploratory / undecided

### Card-based, information-asymmetric gameplay
The full War Room card game — cards as intent signals, private logs, phased turns, public moves. **Up in the air.** Worth prototyping the interaction model, but design before committing engine work. Not scheduled.

---

## Housekeeping (doc + consistency)

- **Reconcile the taxonomy counts:** the manifesto still says "14 axes × 19 game shapes"; the code (and LANGUAGE.md) are **11 action axes / 16 game shapes**. Make LANGUAGE.md the source of truth and fix the manifesto.
- Keep [LANGUAGE.md](LANGUAGE.md) the single source of truth for every concept introduced here.

---

## Sequencing summary

```
Phase 1  Behavioural loop   Calibration → Rehearsal → Butterfly → Review (+ onboarding decks / playback)
Phase 2  Security           encrypted .meridian + PIN/password
Phase 3  Mobile             ngrok-hosted controllers + QR join (PIN-gated)
Phase 4  Distribution       Electron desktop app + auto-update (release feed)
Phase 5  Accounts + backend auth + encrypted .meridian drive microservice (only server component)
Phase 6  Commercialization  landing page + subscription pricing (account-bound)
Later    Exploratory        card / information-asymmetric gameplay (undecided)
```
