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
- **Per-perspective is load-bearing.** When stance capture runs over multiple perspectives, each perspective keeps its own threads + stance; divergence is preserved (an adversary perspective holds deliberately hostile priors). Don't collapse perspectives into one aggregate read.
- **Two ways in for non-GMs:** **live** — a mobile page over an ngrok tunnel exposing the mobile-relevant features (contextual chat + per-perspective prior capture), with **multiple users connected at once**; and **dark** — a WhatsApp group as the always-open async channel both ways (members drop priors in; the GM commits, and hands back each perspective's close-out summary). The dark path is a *process* with near-zero build (Part A); the live multi-user path is the *infrastructure* lift (Part B). Both feed the same per-perspective capture (A1).
- **Commercialization pricing** follows the unbundled model in the manifesto Economics section (setup / facilitation / software, priced by service-intensity).
- **Card-based information-asymmetric gameplay is exploratory** — design before committing.

---

# Part A — Iterative features (build on the app you have)

No new infrastructure. Each is a step you can finish and ship before starting the next.

### A1 · Capture: mode × source
Two **orthogonal** choices when capturing priors — every combination is valid:
- **Mode — how priors are treated:**
  - **Stance Capture** — *filters noise out of priors over time.* Priors update **open threads on the immediate future** (question + named outcomes + logit stance); the accumulated stream converges to a calibrated belief (the market — A2).
  - **Raw Capture** — *noisy capture.* Priors are taken as-is and aggregated (**synthesised by default**, or concatenated) — no stance-building. The aggregate becomes a **direction vector** or a **file**, committed to the sim (see A3). (The shipped CaptureView/queue path.)
- **Source — whose priors:** the **Narrator** (single-player) **or** one-or-more **Perspectives/characters**. **Both modes support both sources.** Perspective-sourced capture keeps each perspective's own threads/stances (or its own raw stream); divergence preserved, no pooling.
- **Inferred priors (unattended perspectives):** a perspective the room needs but no human fills — **unavailable this round**, or an **external / other-organization party** you'll never seat (adversary, competitor, regulator) — gets its priors **AI-inferred before the next war room**, generated from that perspective's own continuity + open threads. These are **ordinary priors** — they submit and update the same open threads through the same stance machinery (A2), no parallel path. Only the author differs (engine, not human) and adversary perspectives keep their hostile tilt. Marked as inferred so the GM can tell provenance.
- **Build:**
  - [ ] Per-arc choice: **mode** (Stance / Raw) × **source** (Narrator / which Perspectives).
  - [ ] Stance mode: **generate N open threads from the source's continuity** (question + outcomes + seeded stance — reuses the thread/stance machinery, not a parallel system). E.g. a trader perspective gets *"where does gold go?"* over price levels.
  - [ ] Raw mode: per-source priors → synthesise/concatenate (already largely present).
  - [ ] **Infer priors for an unattended perspective** from its continuity + open threads, flagged as inferred; usable for any seat the GM marks unavailable or external.
- **Future hook (design for it, don't build):** perspective-sourced capture is what WhatsApp later plugs into (A9); manual in-app submission is the same data path.
- **Done when:** you can capture in either mode from the narrator or chosen perspectives — Stance stands up open threads; Raw aggregates the stream — and any unattended perspective can be filled with AI-inferred priors before the room runs.
- **Depends on:** threads/stances + entity continuity (world graphs). Foundational — do first.

### A2 · The weekly market (Stance mode) — prior submission → stance update → calibrated read
- **Goal:** over the week, priors feed the open threads; the engine re-prices each and reads the belief back. (Applies to both the narrator source and each perspective.)
- **The shape:**
  - Priors are entered **sequentially as variable-length text strings** per source (a stream of notes/observations).
  - On **bulk submit**, run AI calls to **update each open thread's stance logits from the accumulated text** — the prediction-market update. (A prior that "gold fell" raises the logit on the *"falls to $245"* outcome.)
  - Show a **calibrated reading of the belief** — where each thread now leans, in the Fate/belief read-out's lean language; per-source (narrator, or each perspective) in the **Belief** view.
- **Build:**
  - [ ] Free-text sequential prior entry per source.
  - [ ] Bulk-submit → AI stance update (logit deltas across each thread's outcomes) over the accumulated priors.
  - [ ] Calibrated belief readout per source, moving as priors land.
- **Done when:** you submit a week of free-text priors and each open thread re-prices, with a calibrated belief read shown back.
- **Depends on:** A1 + the Fate/stance engine (`thread-log` applyThreadDelta-style updates).

### A3 · Resolve the week → progress the model (continuation)
- **Goal:** turn the week's accumulated priors + open-thread stances into forward motion that adds certainty to the model.
- **Resolve (what happened this week):** for each open thread, either the **GM reviews + approves the outcome**, or it's **deterministic** (take the highest-logit outcome). The chosen outcomes are the resolved fate of the week.
- **Progress:** feed **priors + resolved outcomes** into continuation, which can be:
  - **as a vector** (a direction for generation) **or as a file** (the synthesised/concatenated priors), and
  - on the generative path, either a **world expansion** (fact update only, no continuity) **or a continuity continuation** (the narrative continues, with ad-hoc world additions).
  - *(Raw-mode capture skips the stance resolve — its aggregate commits directly as a world / scene-arc update, or becomes a direction vector.)*
- **Causal-graph resolution (multi-perspective continuity):** when the week's stances come from **multiple perspectives** (human + AI/inferred), the continuity continuation is best resolved through a **causal reasoning graph** rather than a flat aggregate — the resolved per-perspective outcomes become `fate` nodes (weighted by conviction/volume) and the CRG abduces a realistic continuation where the perspectives *interact causally* (one actor's commitment constrains another's), instead of blurring divergent stances into a mean. **This is the same causal-resolution engine the rehearsal card game uses** — the weekly loop and the game feed one resolver. See [CONCEPT.md](CONCEPT.md) §7e.
- **Close-out dispatch (Stance + Perspectives only):** when the room concludes on stance-based perspective capture, each perspective's user gets a **character-specific summary of the present and the future** — written from that perspective's own stances + continuity — delivered back to them (via WhatsApp; A9). The outbound counterpart of dark-capture: the loop ends by handing each player their world back.
- **Build:**
  - [ ] Weekly resolve UI: GM approve-per-thread **or** deterministic-highest, producing the resolved outcomes.
  - [ ] Continuation chooser: vector vs file × world-expansion vs continuity-continuation, fed by priors + resolved outcomes.
  - [ ] Causal-graph continuation path: resolved per-perspective stances → `fate` nodes → CRG → realistic reconciled continuation (shared with the rehearsal resolver, CONCEPT §7e).
  - [ ] Per-perspective close-out summary (present + future, in-character) generated on conclusion, routed to each perspective's user (A9 channel).
- **Done when:** a resolved week advances the model via the chosen continuation, with the resolved outcomes baked in as certainty.
- **Depends on:** A2 + the generation pipeline (direction vectors, `expandWorld`, scene/arc generation).

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

### A9 · WhatsApp dark channel (in + out)
- **Goal:** make WhatsApp the always-open async channel both ways — drops in, summaries out — as a process, not infrastructure.
- **Build:**
  - [ ] **Inbound — paste-and-route:** paste a member's note, pick the perspective, commit. (Process: the GM reads the group when the instance comes online and routes each drop into the perspective it came from.)
  - [ ] **Outbound — close-out dispatch:** copy each perspective's generated present+future summary (A3) to paste back to that user. (Process for now; same manual-curation discipline as inbound.)
- **Done when:** the GM can land a pasted observation on the right perspective, and hand each player their close-out summary, in a couple of clicks. **No backend.**
- **Depends on:** A1 (perspectives) + A2 (inbound) + A3 (the close-out summary).

---

# Part B — Platform changes (the larger lifts)

Do these once the loop in Part A is real. Each is a distinct architectural change.

### B1 · Live multi-user mobile access (ngrok)
- **Goal:** non-GMs join the GM's live instance over an ngrok tunnel from their phones — a **mobile page built around the features that matter on mobile**, with **several people connected at once.**
- **Build:**
  - [ ] A mobile-supported page exposing the two mobile-relevant features: **contextual chat** (same as the sidebar chat) and **prior capture** (per-perspective, A1) — the WhatsApp-later flow, done in-app over the tunnel for now. (Not the whole desktop surface; the console keeps the full interface.)
  - [ ] A role / permission split — GM elevated; each non-GM scoped to their own perspective's capture + chat.
  - [ ] **Concurrency — design for it up front.** Multiple phones hit the GM's *single* instance + store simultaneously: serialise writes, push live state to connected clients, don't let one user clobber another. (Still one source of truth on the GM's machine — no cross-device sync/merge — but concurrent live access needs coordination; this is the real architectural lift of B1.)
  - [ ] Tunnel-launch + URL-share from the console; PIN-gated (A8).
- **Done when:** several non-GMs open the URL on phones *at the same time*, each captures priors to their own perspective and uses contextual chat, and the GM's instance stays consistent.
- **Depends on:** A8 (PIN) + A1 (per-perspective capture) + the chat surface. **No server-side component** — ngrok is a third-party tunnel to the local instance.

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

- **AI-simulated seats → autonomous rooms** — inferred priors for unattended perspectives are now in the entry product (A1). The exploratory frontier beyond that: (2) AI agents take seats *beside* humans as active players, not just gap-fillers; (3) fully autonomous rooms with no human seats. Humans stay the main support; the spectrum, not a replacement. Builds on A1's inference.
- **High-end custom security** — bespoke approaches beyond the A8 encryption + PIN baseline (air-gapped operation, local inference, custom key management). Per-engagement, not a shipped tier.
- **Card-based, information-asymmetric gameplay** — the full War Room card game (cards as intent signals, private logs, phased turns). Worth prototyping the interaction model; design before committing engine work. Not scheduled.

---

## Build order at a glance

```
PART A — iterative features (current app, no new infra)
  A1  Capture: mode × source            Stance (filters noise → open-thread market) vs Raw (noisy → commit) · each × Narrator/Perspectives
  A2  The weekly market                  free-text priors → AI stance update → calibrated belief read
  A3  Resolve week → continuation        GM-approve / deterministic outcomes → vector|file × world-expand|continuity
  A4  Rehearsal play UX                play the cohort forward, divergence protected
  A5  Review — post-play audit         played vs cohort; divergence → next capture
  A6  Review — Butterfly               sealed decision · causal trace · revisable verdict
  A7  Review — slide-deck playback     session deck; can ship early
  A8  Local encryption + PIN           .meridian at rest + gate; anytime
  A9  WhatsApp dark channel (in + out) paste-and-route in · close-out summaries out; no backend

PART B — platform changes (after the loop is real)
  B1  Live multi-user access (ngrok)   full interface over the tunnel; roles; PIN-gated
  B2  Electron desktop + auto-update   app not a tab; self-updating
  B3  Accounts + .meridian drive       only server component; ciphertext-only sync
  B4  Commercialization                landing page + subscription billing
```

## Housekeeping

- **Taxonomy counts reconciled (2026-06):** code = **11 `ActionAxis` / 16 `GameType`** (verified against `src/types/narrative.ts`); manifesto, LANGUAGE.md, and CLAUDE.md all say 11/16. LANGUAGE.md stays the source of truth if they drift.
- Keep [LANGUAGE.md](LANGUAGE.md) the single source of truth for every concept named here.
