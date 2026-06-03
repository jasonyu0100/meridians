# Meridians — Roadmap

> **What this is.** A focused implementation plan for the features that turn the engine into a playable, Game-Master-run product. Much of this is *described* in the [manifesto](src/app/manifesto/page.tsx) and the [LANGUAGE.md](LANGUAGE.md) glossary but **not yet built** — this file is the order to build it in, and why.
>
> The grounded engine (force extraction, threads/stances, reasoning graphs, variable scenarios, embeddings, game theory incl. 1- and 2-player decisions) already ships — see [CLAUDE.md](CLAUDE.md). The roadmap is the layer on top: the **behavioural loop**, then **security**, then the **access model** (live over ngrok + async over WhatsApp), then **distribution** (a desktop app), **accounts + an encrypted `.meridian` drive**, and **commercialization**.

## North star

Make Meridians **accessible to players** and **enhance the Game Master** and the tools they're exposed to. One Game Master on one master device runs the room; everyone else joins as a seat. The product is the **capture → rehearse → review** loop, played on a console — non-GMs join the full interface **live over an ngrok tunnel**, and drop priors **async into a WhatsApp group** when the instance is dark.

## Scope decisions (read first)

- **The room's value is the behavioural loop** — capture, rehearse, review — not a materialised knowledge artifact.
- **Rehearsal stays "Rehearsal."** (The breadth game; not renamed.)
- **Two ways in for non-GMs: live (ngrok) and dark (WhatsApp).** This is the settled access model. **Live:** the GM hosts locally, fires an **ngrok tunnel**, posts the URL to the WhatsApp group; non-GMs open it on phone or desktop and get the **full Meridians interface** — same substrate, same board, same live state — with **read-write** access (submit inputs, adjust stances, play moves). The GM keeps elevated privileges. **Dark** (machine off): the **WhatsApp group** is the always-open capture layer — members drop priors / observations / belief shifts any time; the GM reviews the inbox when back online, curates, and commits what earns it. **No server-side component** for either: ngrok is a third-party tunnel, WhatsApp is a normal group, the substrate stays on the GM's machine. Single source of truth, no sync / merge / conflict.
- **GM is the curation-and-commit layer and the gatekeeper.** The Game Master (a volunteer member, or a facilitator on our side) decides when the instance lives and which WhatsApp inputs graduate into the substrate — routing each into the seat it came from. Live continuous-updating of those per-seat stances (as priors arrive) is high-value and wanted — but **deferred** (see *Deferred*).
- **High-end clients get custom security.** Bespoke security approaches for clients who require them, on top of the local encryption + PIN baseline.
- **The online drive becomes a real backend** — a single **auth + `.meridian` file-drive microservice** (the **only** server-side component). Sync stays **opt-in and local-first by default**; the drive holds **ciphertext only** (zero-knowledge blob store), the master device stays the source of truth.
- **Two security layers, kept distinct:** *local* (encryption + PIN/password protecting on-device data and the room) and *account auth* (sign-in for the online drive + subscription, in the microservice). Not a sprawling identity platform.
- **Distribution is an Electron desktop app**; go-to-market is a **landing page + subscription pricing** tied to accounts.
- **Card-based information-asymmetric gameplay is exploratory** — still up in the air. Design before committing.

---

## Phase 1 — The behavioural loop (core)

The set of features that make the loop real and player-facing. Build in dependency order; each is documented in the manifesto but needs the actual UX + engine wiring.

The loop is three phases (rule of three): **Capture → Rehearsal → Review.**

### 1.1 Capture
*Assemble the priors — per-perspective.* Each seat sharpens its own stance on its own open threads (divergence preserved — an adversary's seat keeps deliberately hostile priors; what's shared is the board, not the belief). Two paths in: **live**, each member tends their own seat directly through the full interface over the ngrok tunnel (Phase 3); **dark**, they drop priors into WhatsApp and the GM curates + **routes each into the seat it came from**. The GM commits the high-certainty decisions that advance the simulation.
- **Have:** the Priors surface (Driver/Queue), threads/stances, the Fate engine.
- **Build:** per-perspective thread ownership (each seat its own open questions + a general perspective), the calibrated-reading view, and the "commit a high-certainty decision → advance the sim" action.
- **Scope note:** **per-perspective is load-bearing** — it's what distinguishes this from a forecasting pool and makes the red-team purpose coherent; don't collapse seats into one aggregate read. A sparse seat just holds a wider, less-settled stance. Live continuous-updating of those stances is *Deferred*.
- **Depends on:** nothing new. Foundational — do first.

### 1.2 Rehearsal
*The breadth game.* Play the Compass's possible trajectories forward across multiple timelines, from the captured priors (not by gathering new ones).
- **Have:** Variable Scenarios + Branch Scenarios (parallel arc continuations, softmax cohort) as the base.
- **Build:** the Rehearsal play UX on top of the Compass cohort; contested-thread protection + per-play divergence so it explores the state space rather than re-enacting the captured prior.
- **Depends on:** Capture (the read it plays forward from) + the Compass.

### 1.3 Review
*The retrospective that closes the loop — audit + attribution + playback in one phase.* Combines what were separate Butterfly / War Room Review / onboarding-deck steps.
- **Post-play audit:** show how the playthrough varied against the predicted state space (the softmax-ranked Compass cohort); the divergence becomes the next thread to capture. Build the played-path-vs-cohort comparison surface and the hand-off of divergences back into Capture.
- **Butterfly (per-decision causal audit):** a sealed decision → trace its causal subgraph along the reasoning graph → resolve as the Fate outcomes it caused; a revisable verdict on how good/bad each decision was. Build the **sealed decision record** (freeze at commit, non-editable — for 1-player decisions capture the commit-time stance as a number, the stronger seal), the **causal-reach trace** over the downstream subgraph, and the **revisable verdict** that re-reads downstream Fate as more threads resolve. Decide the **bounded-vs-open-ended closure rule** (live design question). *Have:* the decision model (1- and 2-player + ELO — done), reasoning graph + causal edges, Fate resolutions.
- **Slide-deck delivery (playback):** a **generated slide deck** of the session — history, the decisions that shaped it, Butterfly verdicts, resolved threads — delivered to members' phones (the WhatsApp summary, Phase 3) and doubling as onboarding for newcomers / re-sync for returning members. **Regenerates as the substrate moves.** *Have:* the slides feature (`SlidesPlayer`, `lib/slides-data.ts`). Can ship early — the most accessible surface and the cleanest demo of "see how the team decides."
- **Depends on:** Rehearsal (the playthrough) + Compass (the prediction) + the decision model + Fate.

---

## Phase 2 — Security (basic, focused)

Protect key data before it's exposed on a shared screen or a phone. Minimal, not a full identity system.
- **Encrypted `.meridian` files** at rest (the substrate serialised as one encrypted artifact).
- **PIN / password gating** of access to key data and the room.
- **Depends on:** nothing; PIN-gates the instance before it's exposed over the ngrok tunnel. Do before Phase 3.

---

## Phase 3 — Access model: live (ngrok) + dark (WhatsApp)

How non-GMs touch the room. The console (laptop / master device) holds truth and drives the shared screen; the single source of truth never leaves it. **No server-side component** — ngrok is a third-party tunnel, WhatsApp is a normal group.
- **Live access (ngrok):** the GM hosts the instance locally and fires an **ngrok tunnel** → public URL, posted to the WhatsApp group. Non-GMs open it on phone or desktop and get the **full Meridians interface** — same substrate, board, and live state — with **read-write** access: submit calibration inputs, adjust stances, play moves, interact with the graph. Functions like a cloud-hosted app for the session. **PIN-gated** (Phase 2); the GM keeps **elevated privileges**.
- **Dark capture (WhatsApp):** when the machine is off, the instance is dark (no interface). The **WhatsApp group** stays open as the **always-on capture layer** — members drop priors, observations, and belief shifts any time.
- **Curate + commit:** the GM reviews the WhatsApp inbox when the instance comes back online, curates, and **commits the inputs that earn it** to the substrate manually. WhatsApp is the capture layer; the GM is the curation-and-commit layer and the gatekeeper of when the instance lives.
- **Build:** a mobile-friendly responsive interface (the same app, usable on a phone over the tunnel); a role/permission split (GM elevated vs non-GM read-write); the tunnel-launch + URL-share affordance from the console.
- **Depends on:** Phase 2 (PIN-gating the exposed instance) + the behavioural-loop surfaces it exposes.

---

## Phase 4 — Distribution: Electron desktop app

Package the local-first app as a desktop binary — the coherent install the manifesto describes.
- **Build:** wrap the same Next.js build in **Electron**; the master device runs it like a native app (keyboard shortcuts, a known persistence location for the encrypted `.meridian`, the console one launch away). Same code; the surface around it stops being a browser tab.
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

## Deferred (wanted next, not in the entry product)

### Live-updating per-seat stances
Each seat's stance moving in real time as priors arrive (whether dropped into WhatsApp or submitted live over the tunnel), surfaced back to members — rather than only updating when the GM curates and commits. The single most valuable next step (it's what makes the room a living model rather than a periodic snapshot). **Deferred on purpose:** the GM-as-gatekeeper commit step (routing each prior into the seat it came from) is the simple, ship-ready model; auto-commit is the upgrade once the loop is proven. Per-perspective divergence is preserved either way — this is about *when* a seat's stance updates, not whether seats stay distinct.

---

## Exploratory / undecided

### AI-simulated seats → autonomous rooms
Because Capture is per-perspective, an empty/quiet seat can have its priors **simulated** by the engine from its stances + open questions. Progression: (1) fill a missing perspective so a thin-rostered/underserved team isn't blind; (2) AI agents take seats beside humans; (3) fully autonomous rooms — narratives and war games that simulate their own detailed priors. Humans stay the main support; this is the spectrum, not a replacement.

### High-end custom security
Bespoke security approaches for clients who require more than the local encryption + PIN baseline (e.g. air-gapped operation, local inference, custom key management). Per-engagement, not a shipped tier.

### Card-based, information-asymmetric gameplay
The full War Room card game — cards as intent signals, private logs, phased turns, public moves. **Up in the air.** Worth prototyping the interaction model, but design before committing engine work. Not scheduled.

---

## Housekeeping (doc + consistency)

- **Taxonomy counts reconciled (2026-06):** code = **11 `ActionAxis` / 16 `GameType`** (verified against `src/types/narrative.ts`); manifesto, LANGUAGE.md, and CLAUDE.md now all say 11/16. LANGUAGE.md stays the source of truth if they drift again.
- Keep [LANGUAGE.md](LANGUAGE.md) the single source of truth for every concept introduced here.

---

## Sequencing summary

```
Phase 1  Behavioural loop   Capture → Rehearsal → Review (Review folds in Butterfly + slide-deck playback)
Phase 2  Security           encrypted .meridian + PIN/password
Phase 3  Access model       live: full interface over ngrok (read-write, PIN) · dark: WhatsApp capture → GM commits (no server component)
Phase 4  Distribution       Electron desktop app + auto-update (release feed)
Phase 5  Accounts + backend auth + encrypted .meridian drive microservice (only server component)
Phase 6  Commercialization  landing page + subscription pricing (account-bound)
Deferred Living priors      per-seat stances updating live (vs GM curate-and-commit); wanted next
Later    Exploratory        card / information-asymmetric gameplay (undecided) · high-end custom security
```
