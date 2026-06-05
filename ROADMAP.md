# Meridians — Build Spec

> **What this is.** The ordered, discrete steps that turn the shipping engine into a Game-Master-run **desktop (Electron) product**. Built to be tackled **one item at a time**: each has a goal, a concrete build list, and a *done-when* you can check off, so the work never has to be held in your head all at once.
>
> **The focus, plainly:** stand up the **Model → Capture → Rehearsal** loop, **WhatsApp** as the async channel into it, **Electron** as the shipped app, and the **commercialisation + distribution** of that app. (Live multi-user/ngrok and the accounts/drive microservice are secondary — built only as the focus demands.)
>
> The grounded engine (force extraction, threads/stances, reasoning graphs, variable scenarios, embeddings, game theory incl. 1- and 2-player decisions) already ships — see [CLAUDE.md](CLAUDE.md). Everything here is the layer on top.

## How to read this

- **Part A — Iterative features.** Small, self-contained steps that build on the **current Next.js app + engine**, with **no new infrastructure**. Each ships value on its own. Do these first.
- **Part B — Platform changes.** The larger architectural lifts (networked access, desktop packaging, a backend, go-to-market). Do these once the loop is real.
- Each item: **Goal · Build · Done when · Depends on.** A1 → A6 is the natural order, but A5 (encryption) is independent and can be pulled early.

## Scope decisions (the guardrails)

- **The core idea — calibration of beliefs via priors, global and local.** The superpower is taking a stream of **priors** and continuously **calibrating beliefs** with them — both **locally** (each perspective's own stances on its threads) and **globally** (the room's shared model of reality). That is the product. It is **advisory, not predictive** — **understanding the past and present** (and at most *one step forward*), turned into better decisions made in the open.
- **What we're strictly focused on:** **behavioural change in organisations** · **better decision-making** · **one-step-ahead** foresight · **high-feedback practice via rehearsal**. The product is this *behavioural practice* — the **Model → Capture → Rehearsal** loop (one-off model setup, then continual capture + rehearsal). Forecasting exists via **Compass**, but as a byproduct, not a driver.
- **One source of truth: the GM's machine.** No cross-device sync, no distributed merge, no conflict resolution. The only server-side component ever introduced is the Part B drive microservice.
- **Exactly one GM (one master device).** Multi-GM is **unsupported by design** — the database-less, local-first model has no store to reconcile two writers, so a second GM would mean two competing sources of truth. Every room has a single master; everyone else is a non-GM participant (A0 role). Non-GMs reach the room read/write *through* the master (dark via WhatsApp, live via the ngrok tunnel — A6 / B1), never as a second authority.
- **Per-perspective is load-bearing.** When capture runs over multiple perspectives, each perspective keeps its own threads + stance; divergence is preserved (an adversary perspective holds deliberately hostile priors). Don't collapse perspectives into one aggregate read.
- **Perspectives are pull requests (a page from GitHub).** A PR accumulates **sequential priors over the week** like commits on a branch — and an **entity perspective can carry several concurrent PRs** (the entity is the repo, PRs are proposals against it, 1 : N). The **war room is the merge** — where every open PR is reviewed together and the room gets a full overview. The **GM is the maintainer**: only **high-certainty or reality-confirmed** outcomes get merged into the canonical state (confirmed by the record, or by talking to participants); contested / low-certainty beliefs **don't merge** — they stay open and carry forward, divergence preserved. PRs are **committed or kept open per perspective** (keep pulling if nothing significant accrued — a PR can span several war rooms), carry **comments**, and **never conflict** (each perspective is individualised). *(This is the PR **workflow** — propose → review → selective merge; the storage primitive is an open build decision.)*
- **Two ways in for non-GMs:** **live** — a mobile page over an ngrok tunnel exposing the mobile-relevant features (contextual chat + per-perspective prior capture), with **multiple users connected at once**; and **dark** — a WhatsApp group as the always-open async channel both ways (members drop priors in; the GM commits, and hands back each perspective's close-out summary). The dark path is a *process* with near-zero build (Part A); the live multi-user path is the *infrastructure* lift (Part B). Both feed the same per-perspective capture (A1).
- **Commercialization pricing** follows the unbundled model in the manifesto Economics section (setup / facilitation / software, priced by service-intensity).
- **The rehearsal is a card game — *Conviction*** — **A4**, fully specced in [CONCEPT.md](CONCEPT.md) (design + build tickets). Settle its open questions before committing engine work.

---

# Part A — Iterative features (build on the app you have)

No new infrastructure. Each is a step you can finish and ship before starting the next.

> **The loop, in three beats — Model → Capture → Rehearsal.** This is what a customer experiences. There's an **upfront cost** (set up the model) and then a **continual practice** (capture + rehearsal) that refines participants' decision-making and preparedness over time.
> - **Model (one-off).** Set up the room's **model of reality** — a substrate with **rules** (the world's machinery, the Mode/Phase graph), **entities** (characters, locations, artifacts), and **global threads** (the open questions that calibrate the room's understanding). Reuses the existing world-creation / analysis pipeline; you pay it once.
> - **Capture (continual).** Record **priors** and commit them to the model. Per-perspective PRs accumulate priors; the war-room **merge** calibrates the *certain* ones into the model. Beliefs calibrate at both scales — **locally** (each perspective's stances) and **globally** (the room's shared model).
> - **Rehearsal (continual).** Take the existing model and **play it forward in branches** via the card game (A4): high-feedback **practice on the future** with semi-realistic scenarios. We don't pretend the game *is* reality — reality is far more complex — but it's a **practice ground** for information, signalling, cooperation, and multi-sided play.
>
> The product is this practice, not a materialised artifact — and the calibrated model is what it sharpens, week over week.

### A0 · Participant & room model
- **Goal:** model the people in a room **and the room objects the PR lifecycle needs** — the foundation perspective-sourced capture, the war-room merge, WhatsApp dispatch, and live access all depend on.
- **Shape:** a **Participant** entity with **first name, last name, mobile, role**.
  - **mobile** — E.164 number; the routing key for the WhatsApp dark channel (A6) and the live mobile page (B1), and where the close-out summary (A3) goes.
  - **role** — what they are in the room: GM / facilitator, or a player mapped to a perspective. Drives merge attribution (whose PR is this) and the live permission split (B1). **Exactly one participant holds the GM role** (single master device — see guardrails); everyone else is a non-GM.
- **Users are separate from perspectives.** A Participant (the user) is *assigned to* a perspective; the perspective holds the priors/threads, the user is who feeds it. A perspective can be:
  - a **character** perspective,
  - a **general / narrator** perspective — not tied to any character (the single-player or omniscient vantage),
  - a **location** or **artifact** perspective — non-character entities (Meridians already types threads by `character | location | artifact`, so this reuses existing machinery).
  One user can hold several perspectives; a perspective can be human-fed or AI/inferred (A1).
- **The fuller model the lifecycle needs** (so "commit or keep pulling" is expressible): a **Perspective PR** `{ state: open | committed, entityRef (character|location|artifact|general), openThreads, comments, participantId? }` and a **war-room session** that records, per PR, whether it was committed or kept open. **Cardinality is 1 : N** — one entity perspective can have many concurrent open PRs (from one or more users), so the PR, not the entity, is the unit of the loop.
- **Build:**
  - [ ] `Participant { firstName, lastName, mobile, role }`.
  - [ ] Assign participants to perspectives/seats (a participant holds one or more perspectives; an empty seat → AI/inferred, A1).
  - [ ] `Perspective-PR { state, openThreads, comments, participantId }` + a war-room session recording per-PR commit/keep-open.
  - [ ] Mobile + identity available to A3 (close-out routing), A6 (dark channel), B1 (live access / roles).
- **Done when:** you can register participants with those four fields, map each to the perspective(s) they play, and a perspective exists as an open/committed PR with threads + comments.
- **Depends on:** nothing. Foundational — do alongside A1.

### A1 · Capture: perspective-based PRs
Every prior lands in a **PR opened against a perspective**, and a perspective is one of two kinds:
- **Entity perspective** — bound to a **character, location, or artifact** (A0). Carries **focused fate threads** on that entity's immediate future (question + named outcomes + logit stance); priors update them and the accumulated stream converges to a calibrated belief (the market — A2).
- **Narrator (general) perspective** — **non-entity, general.** Holds **adhoc priors not bound to any one perspective** — a freeform bucket that can contain anything relevant **across multiple entities** at once. The catch-all for general observation that doesn't belong to a single seat.

A user is *assigned to* the perspective they feed (user ≠ perspective); divergence is preserved, no pooling. Priors against a perspective form a **pull request** — a stream of sequential prior-commits awaiting the war-room merge (A3); a perspective can carry **several PRs at once** (lifecycle below).
- **External events are location / artifact perspectives.** A non-character entity holds a PR too: a **hurricane** is a **location's** perspective developing priors about itself, merged in the war room as a confirmed **event that occurred**. Other perspectives that witnessed it open *their own* PRs measuring the same event — which is why **any user can open a PR**. This is the concrete form of CONCEPT.md §7f's *"world as a seat"*: Nature / market / regulator are **location / artifact / general perspectives**, usually AI-fed (inferred priors, below) when no human holds them.
- **Perspective PR lifecycle.** Opening a PR **opens its fate threads on the immediate future** — the questions priors will answer. While the PR is **open**, those threads are *live*: priors (A2) update them, and the threads themselves can be **revised** — add, drop, reword, re-seed outcomes — as the week clarifies what's actually in play (they aren't frozen at open time). A PR also carries **comments** (GM + participant annotations on the stream). A PR closes only when the GM merges it at a war room (A3), and may stay open across **several** war rooms if nothing significant accrued.
- **Many PRs per entity perspective.** A PR is opened *against* an entity perspective, and **an entity can have multiple PRs open at once** (1 : N) — opened by different users, *or several by the same user* (different questions, different observation streams, the same event measured from one vantage in parallel). Think GitHub: the entity is the repo, PRs are concurrent proposals against it. **No merge conflicts** — the GM merges each PR independently into the entity's canonical state (a per-PR accept); parallel PRs on one entity are corroborating observations the GM reconciles editorially, never an automatic clash.
- **Inferred priors (unattended perspectives):** a perspective the room needs but no human fills — **unavailable this round**, or an **external / other-organization party** you'll never seat (adversary, competitor, regulator) — gets its priors **AI-inferred before the next war room**, generated from that perspective's own continuity + open threads. These are **ordinary priors** — same open threads, same stance machinery (A2); only the author differs (engine, not human), and adversary perspectives keep their hostile tilt. Marked as inferred so the GM can tell provenance.
- **Build:**
  - [ ] Open a **PR against a perspective** — an **entity** (character / location / artifact) or the **narrator (general)** vantage.
  - [ ] Open a perspective PR with seeded **open fate threads**; allow threads to be **revised / added / removed while the PR is open**.
  - [ ] Entity PR: **generate N open threads from the entity's continuity** (question + outcomes + seeded stance — reuses the thread/stance machinery, not a parallel system). E.g. a trader perspective gets *"where does gold go?"* over price levels.
  - [ ] Narrator PR: **adhoc / freeform priors spanning multiple entities**, not bound to one perspective's threads (the shipped CaptureView/queue path fits here).
  - [ ] **Comments** on a PR (GM + participant annotations).
  - [ ] **Infer priors for an unattended perspective** from its continuity + open threads, flagged as inferred; usable for any seat the GM marks unavailable or external.
- **Future hook (design for it, don't build):** perspective-sourced capture is what WhatsApp later plugs into (A6); manual in-app submission is the same data path.
- **Done when:** you can open a PR against the narrator or any entity perspective, it stands up open fate threads that priors update, and any unattended perspective can be filled with AI-inferred priors before the room runs.
- **Depends on:** threads/stances + entity continuity (world graphs). Foundational — do first.

### A2 · The weekly market — prior submission → stance update → calibrated read
- **Goal:** over the week, priors feed the open threads; the engine re-prices each and reads the belief back. (Applies to both the narrator source and each perspective.)
- **The shape:**
  - Priors are entered **sequentially as variable-length text strings** per source (a stream of notes/observations).
  - On **bulk submit**, run AI calls to **update each open thread's stance logits from the accumulated text** — the belief-calibration update. (A prior that "gold fell" raises the logit on the *"falls to $245"* outcome.)
  - Show a **calibrated reading of the belief** — where each thread now leans, in the Fate/belief read-out's lean language; per-source (narrator, or each perspective) in the **Belief** view.
- **Live, not only batched.** A seat's stance updates **in real time as each prior arrives** — not only at bulk-submit or GM-commit. This makes the room a *living model* rather than a periodic snapshot. It changes only *when* a stance moves, not whether seats stay distinct — per-perspective divergence is preserved either way; the GM-commit merge (A3) still gates what enters the canonical trunk.
- **Build:**
  - [ ] Free-text sequential prior entry per source.
  - [ ] **Live stance update** — re-price a thread as each prior lands and push the moving belief to the source's readout (not only on bulk submit).
  - [ ] Bulk-submit → AI stance update (logit deltas across each thread's outcomes) over the accumulated priors.
  - [ ] Calibrated belief readout per source, moving as priors land.
- **Done when:** you submit a week of free-text priors and each open thread re-prices, with a calibrated belief read shown back.
- **Depends on:** A1 + the Fate/stance engine (`thread-log` applyThreadDelta-style updates).

### A3 · Resolve the week → progress the model (the war-room merge)
- **Goal:** turn the week's accumulated priors + open-thread stances into forward motion that adds certainty to the model.
- **The war room is the merge.** Every perspective's week-long PR (A1) comes in together; the GM (maintainer) reviews them as one overview and **merges only what's certain.** For each open thread the merge criterion is **high-certainty or reality-confirmed** — confirmed by the public record, or by talking to participants — or, where the GM defers to the market, **deterministic** (the highest-logit outcome). Merged outcomes are the resolved fate of the week. **Contested / low-certainty threads don't merge:** they stay open and carry into next week, divergence preserved. Only certainty enters the canonical trunk.
- **Focus is the merge signal; unresolved = noise.** A PR actively measuring just **one or two threads** is the clearest merge candidate — tight focus + high certainty is what calibrates the model cleanly. Merging **unresolved** threads injects **noise** into the model (not recommended). So: high-certainty / reality-confirmed changes are **encouraged**; for **evolving situations that need ongoing causal updates**, whether to commit *this* week is **GM discretion** — the GM may hold an in-flux thread open rather than bake premature certainty into the trunk.
- **Commit or keep pulling — per perspective.** A war room doesn't force-merge everything. The GM decides **per perspective (and per PR)** whether to **commit (merge)** it or **keep pulling (leave the PR open)** — a perspective with nothing significant this cycle isn't merged; its PR persists, comments and open threads intact, into the next war room. Because each perspective is individualised there are **no merge conflicts** — every decision is a standalone per-perspective accept.
- **Cadence — reopen the collection.** The loop runs on a rhythm: once a war room concludes, **N new PRs are opened** (across the chosen entity perspectives) to keep the collection process going into the next cycle. **Any user can open a PR** at any time — so a freshly-witnessed event (a hurricane, a leak) can be measured from several vantages at once, not only at the GM's prompt.
- **Progress:** feed **priors + resolved outcomes** into continuation, which can be:
  - **as a vector** (a direction for generation) **or as a file** (the synthesised/concatenated priors), and
  - on the generative path, either a **world expansion** (fact update only, no continuity) **or a continuity continuation** (the narrative continues, with ad-hoc world additions).
  - *(Adhoc / narrator priors that aren't focused threads skip the per-thread stance resolve — they commit directly as a world / scene-arc update, or become a direction vector.)*
- **Causal-graph resolution (multi-perspective continuity):** when the week's stances come from **multiple perspectives** (human + AI/inferred), the continuity continuation is best resolved through a **causal reasoning graph** rather than a flat aggregate — the resolved per-perspective outcomes become `fate` nodes (weighted by conviction/volume) and the CRG abduces a realistic continuation where the perspectives *interact causally* (one actor's commitment constrains another's), instead of blurring divergent stances into a mean. **This is the same causal-resolution engine the rehearsal card game uses** — the weekly loop and the game feed one resolver. See [CONCEPT.md](CONCEPT.md) §7e.
- **Close-out dispatch (Stance + Perspectives only):** when the room concludes on stance-based perspective capture, each perspective's user gets a **character-specific summary of the present and the future** — written from that perspective's own stances + continuity — delivered back to them (via WhatsApp; A6). The outbound counterpart of dark-capture: the loop ends by handing each player their world back.
- **Build:**
  - [ ] Weekly **merge** UI: all perspective PRs in one overview; GM merges per-thread on high-certainty / reality-confirmed (**or** deterministic-highest), leaves the rest open. Produces the resolved outcomes.
  - [ ] **Per-perspective commit-or-keep-open** decision; open PRs persist across war rooms (comments + open threads intact).
  - [ ] Continuation chooser: vector vs file × world-expansion vs continuity-continuation, fed by priors + resolved outcomes.
  - [ ] Causal-graph continuation path: resolved per-perspective stances → `fate` nodes → CRG → realistic reconciled continuation (shared with the rehearsal resolver, CONCEPT §7e).
  - [ ] Per-perspective close-out summary (present + future, in-character) generated on conclusion, routed to each perspective's user (A6 channel).
- **Done when:** a resolved week advances the model via the chosen continuation, with the resolved outcomes baked in as certainty.
- **Depends on:** A2 + the generation pipeline (direction vectors, `expandWorld`, scene/arc generation).

### A4 · Rehearsal — *Conviction*, the card game → see [CONCEPT.md](CONCEPT.md)
- **Goal:** play the future forward as a game on the substrate — the **fast-clock twin** of the capture loop (same threads, stances, and causal resolver).
- **Spec / ticket:** the full design **and its build roadmap live in [CONCEPT.md](CONCEPT.md)** (the *Conviction* card game). A4's tickets are the **Build roadmap** section there (R1–R7); this entry is just the pointer.
- **First of several rehearsal modes.** *Conviction* is **mode one**, not the only one — rehearsal is a **pluggable layer over the shared resolver**, so other game formats can ride the same substrate later. Build Conviction first; keep the rehearsal boundary clean so modes can be added.
- **In brief:** perspectives play cards (stances) under a budget, in a configurable turn order, resolved by a causal graph — committed stances are soft priors, contested threads stay open, each play-through forks and is kept.
- **Done when:** the CONCEPT build roadmap's core path ships (round setup → hand → budget → play → causal-resolution showdown → kept branch).
- **Depends on:** A3 (the **shared** causal resolver) + the existing Scenarios/Compass. **Two speeds, one game** — much of A4 falls out of A1–A3; build the capture resolver and you've built most of the rehearsal one.

### A5 · Local encryption + PIN gate
- **Goal:** protect the substrate at rest and gate access to the room.
- **Build:**
  - [ ] Encrypt the `.meridian` at rest (the substrate serialised as one encrypted artifact).
  - [ ] PIN / password gate on opening the room.
- **Done when:** the on-disk `.meridian` is ciphertext and opening the room needs the PIN.
- **Depends on:** nothing. **Can be done anytime**; it's the prerequisite for B1 (networked access).

### A6 · WhatsApp dark channel (in + out)
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
  - [ ] Tunnel-launch + URL-share from the console; PIN-gated (A5).
- **Done when:** several non-GMs open the URL on phones *at the same time*, each captures priors to their own perspective and uses contextual chat, and the GM's instance stays consistent.
- **Depends on:** A5 (PIN) + A1 (per-perspective capture) + the chat surface. **No server-side component** — ngrok is a third-party tunnel to the local instance.

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
- **Depends on:** A5 (files already encrypted). Keep it small — auth + blob storage, nothing more.

### B4 · Commercialization
- **Goal:** distribute and monetize.
- **Build:**
  - [ ] **Landing page** — download the Electron build, sign up, present the product.
  - [ ] **Subscription billing** tied to accounts (through B3's account layer), following the unbundled pricing in the manifesto Economics section (setup / facilitation / software).
- **Done when:** a buyer can land, download, sign up, and pay.
- **Depends on:** B3 (accounts) + B2 (the app to distribute).

---

## Exploratory / undecided

- **AI agents as players → autonomous rooms** — beyond inferred priors filling unattended seats (A1), the frontier: AI agents take seats *beside* humans as active players, and at the limit fully autonomous rooms with no human seats. Humans stay the main support — a spectrum, not a replacement.
- **Causal cards** — the card game's riskiest piece: block / force / reveal / gate (CONCEPT R7), with real dominant-strategy risk. Design carefully before building.
- **High-end custom security** — bespoke approaches beyond the A5 encryption + PIN baseline (air-gapped operation, local inference, custom key management). Per-engagement, not a shipped tier.

---

## Build order at a glance

```
PART A — iterative features (current app, no new infra)
  A0  Participant & room model           Participant { fname, lname, mobile, role } + Perspective-PR { state, openThreads, comments }; mobile = A6/B1 routing
  A1  Capture: perspective-based PRs     PR against an entity (character/location/artifact) or narrator (general/adhoc)
  A2  The weekly market                  free-text priors → live + batched stance update → calibrated belief read
  A3  War-room merge → continuation      merge certain/confirmed outcomes (rest stay open) → vector|file × world-expand|continuity
  A4  Rehearsal — Conviction (card game) → CONCEPT.md (spec + build tickets R1–R7); fast twin of the capture loop, shared resolver
  A5  Local encryption + PIN             .meridian at rest + gate; anytime
  A6  WhatsApp dark channel (in + out)   paste-and-route in · close-out summaries out; no backend

PART B — platform changes (after the loop is real)
  B1  Live multi-user access (ngrok)   full interface over the tunnel; roles; PIN-gated
  B2  Electron desktop + auto-update   app not a tab; self-updating
  B3  Accounts + .meridian drive       only server component; ciphertext-only sync
  B4  Commercialization                landing page + subscription billing
```

## Housekeeping

- [LANGUAGE.md](LANGUAGE.md) is the single source of truth for every concept named here.
