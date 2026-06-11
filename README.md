![Meridians](public/readme-banner.png)

# Meridians

**A browser-based engine that turns long-form text into a typed, queryable, simulatable knowledge structure.** Paste a corpus — a market brief, a memoir, a paper, a policy doctrine, a campaign plan, a novel — and the engine extracts a mutable graph of actors, locations, artifacts, threads, and system rules. The graph then drives analysis (force trajectories, pacing fingerprints, prose profiles), interrogation (surveys, interviews, semantic search, RAG over embeddings), and generation (causal reasoning graphs, scene structures, beat plans, prose).

The measurable spine is the three force fields — **System** (rules and structures), **World** (actors and their state), **Fate** (open questions and the work's bearing on them). LLM-extracted deltas turn into reproducible scores via deterministic formulas; same input, same score. The engine spans fiction, non-fiction, and real-world simulation.

No backend. State and embeddings live in IndexedDB. Plug in an OpenRouter key and run locally — your data stays in your browser.

**[Try it →](https://meridians.global/)** · **[Read the manifesto →](https://meridians.global/manifesto)** · **[Architecture reference →](CLAUDE.md)** · **[Shared vocabulary →](LANGUAGE.md)**

---

## Setup

```bash
git clone https://github.com/jasonyu0100/meridians.git
cd meridians
npm install
cp .env.example .env.local   # add your OpenRouter key
npm run dev                   # → http://localhost:3001
```

| Variable                        | Required | Purpose                                                |
| ------------------------------- | :------: | ------------------------------------------------------ |
| `OPENROUTER_API_KEY`            | yes      | LLM calls (DeepSeek v4 Flash + Gemini 2.5 Flash split) |
| `OPENAI_API_KEY`                | optional | Embeddings — disables semantic search if absent        |
| `REPLICATE_API_TOKEN`           | optional | Image generation (Seedream 4.5)                        |
| `NEXT_PUBLIC_USER_API_KEYS`     | optional | Allow user-supplied keys via the in-app modal          |

See `.env.example` for the full list.

---

## What you can build with it today

This section is the **grounded** value prop — features that ship in the current codebase and work end-to-end.

**Narrative simulation.** Generate full arcs end-to-end through a layered pipeline — phase graph (the world's working machinery) → causal reasoning graph (per-arc causal logic) → scene structures (deltas + summaries) → beat plans (function + mechanism scaffolding) → prose. Each stage commits decisions the next executes against, so coherence survives across hundreds of scenes. Branchable, reviewable, reconstructable. Renders into prose, screenplay, meta-overlay, or in-world simulation overlay — same beat plan, format-tailored accent profile.

**Real-world scenario modeling.** Feed the engine a brief or dataset and it builds the same typed graph. Branch alternative timelines from any decision point, evaluate them in **Branch Chat** (multi-branch analytical chat with controlled scope windows), and compare outcomes through the same force math that grades novels. Genre-neutral; what it actually measures is how a world is moving and where pressure builds.

**Variable scenario forecasting.** Probabilistic alternative to causal reasoning: the engine extracts a pool of load-bearing variables and produces a cohort of next-arc timelines as coordinations over that pool — each scored with a priorLogit, softmaxed to a relative probability. The cohort follows the power-law shape of real possibility space (most mass on modal continuation, thin tail on rupture). **Scenarios** (in-app: *Branch Scenarios*) generates one parallel branch per scenario for multi-timeline analysis.

**Text corpus analysis.** Paste any long-form work and the engine extracts its full structure: typed knowledge graph, force trajectories, pacing fingerprint (Markov transition matrices over scene-level cube modes), prose profile (authorial Markov chains over a 10-function / 8-mechanism beat taxonomy).

**Mind mapping at scale.** Entities, threads, knowledge nodes, and embeddings render as interactive D3 graphs: world graph, network view, mode graph, reasoning graph, per-entity inner knowledge graph.

**Semantic retrieval.** Every proposition, beat, and scene is embedded as a 1536-dim vector via OpenAI's `text-embedding-3-small`. Cosine similarity surfaces meaning, not keywords. AI-synthesized overviews cite back to source spans.

**Strategic interrogation.** Surveys (one question × N entities, each answering in-character), interviews (one entity × N questions), per-scene decision matrix (game-theoretic decomposition along 11 axes × 16 game shapes), ELO rankings derived from per-scene stake deltas.

---

## First run

1. Land on `/` and pick a seed story (Harry Potter, LOTR, Game of Thrones, Star Wars, Reverend Insanity), or create your own from a premise via the wizard.
2. The wizard generates an initial world + introduction arc.
3. Open the **world graph** or **network view** to see what got built.
4. Run **auto mode** to generate more arcs, or drive each stage manually — generate the CRG, then the scenes, then the beat plans, then the prose. Edit at any layer.
5. Paste any long-form text into `/analysis` to extract its full structure into the engine.

---

## Why this beats LLM-only

LLMs alone collapse on long-form reasoning — they forget, hallucinate, drift off premise, and can't tell you _why_ a world is moving the way it is. They cannot hold a calibrated record across sessions or grade their own forecasts against what reality returned. Meridians is the substrate the LLM is missing:

- A **persistent typed graph** that mutates section by section, so the next generation knows what every prior scene committed.
- **Deterministic force math** — no LLM tax to grade structure, reproducible across runs.
- **Semantic embeddings** indexed on every proposition, so retrieval pulls relevant context from anywhere in the timeline.
- A **layered generation pipeline** (phase → CRG → scene → plan → prose) where each stage commits decisions the next executes against, with arc-level engine settings synced from CRG construction through scene rendering.

The engine is the spine; the LLM is one tool the engine drives.

---

## Vision — where this is heading

Everything above ships today. This section is the forward bet — some in build, some design-stage, some may not pan out.

Meridians is a **rehearsal engine for the future**: it lets a team operate in complex decision-making environments with the advantage of practice and foresight — it *runs* a team's judgement (not its files), *holds the state* the meeting would lose, and *compounds* (the moat). A team knows it's prepared when its canonical models of reality carry high **Prior** scores — the present keeps landing on ground it has already walked. Most tools store what your team wrote down; Meridians runs what your team believes. Category: **gaming + education + strategy**. The product surface is the **War Room** — a role-played, information-asymmetric game on the substrate where a team sits around one board (a graph, or a board with nested maps), holds private logs, signals via cards, and rehearses the future on a cadence. It's two things at once:

- a **role-play simulator** for rehearsing the future;
- a **strategy table** for deciding on it.

**Maintenance is the practice.** The world view isn't a one-time deliverable — the team updates it every session, or the substrate goes stale.

**The practice runs at two tempos.** *Capture* (async) — each perspective records its priors over time, between sessions; the slow side that compounds into the moat. *Conviction* (live) — a synchronous, high-feedback session where judgement is battle-tested against AI-simulated teams, played as a card game; the fast side and day-one value. *Capture is what reality is; Conviction is how it could go.* **WhatsApp and Slack are the primary channels** — WhatsApp everyday/informal, Slack/Teams for businesses (already trusted).

**Dual value proposition — the growth engine.** **Players** get Capture + Conviction (judgement, battle-tested vs AI teams); **GMs** get the engine + text-first surface (infinite customisability, sandbox world-expansion). Honing both carries Meridians private → public.

**Two product surfaces, planned in sequence — private first, public next.**

- **Private rooms** — local data model (IndexedDB, no backend). Wedge: B2B-light subscriptions (investment committees, family offices, campaign cells, M&A teams, policy units). Redundancy is an opt-in **Substrate Vault** — inbuilt encrypted online backup (client-held key; we store only ciphertext) plus client-chosen destinations — with two tiers: **private storage** (the client's substrate) and **public storage** (worlds a GM publishes). The moat survives a dead laptop without ceding sovereignty.

- **Public rooms** — not a separate build; *built on the vault*. A host opens a session via **guest pass** (time-limited, revocable, board/graph only, private substrate never exposed); the vault's public storage distributes worlds so players pull **fresh copies constantly**. Grows from private rooms opening a door (no cold-start, no new infra), free to play, monetised by pro analytics, ELO history, and opt-in jurisdiction-gated betting. At scale **private and public are self-reinforcing**, GMs curating both. Framing: *fantasy sports applied to strategic worlds*.

**Stakes** attach to plays optionally — fictional (ELO, leaderboards), reality-anchored (stakes pooled on real-world questions), or real (trades recorded as commitments, only with legal sign-off). **Betting** is off by default, consent-gated, offered only in fast-feedback rooms, and fully separable — a surface over stance pricing that never touches the Capture loop or substrate.

**Speculative upside** (aspirational, not a forecast): public narrative stages audiences tune into; multi-season games with persistent stakes and player "careers"; bull-case year-3 ARR of $10–20M if the public layer catches. The base case (~$3.5M ARR) is venture-defensible without any of it.

**The honest bet:** *human judgement, exercised as vision, is the one human edge that doesn't go away* — models predict the future, they don't choose which one to make. We sharpen it by battle-testing it against AI-simulated teams built to surprise; it's defensible because the moat is **structural** — the client's own rehearsed decisions, unscrapeable and unportable by any vendor, theirs even as models improve. Human-up is the value; client-owned is the defence.

This section may be wrong about specifics. The grounded sections above are what works today regardless.

---

## For developers digging in

- **[`CLAUDE.md`](CLAUDE.md)** — full architecture reference. Every major subsystem (forces, threads, mode graph, CRG, scenes, plans, prose, embeddings, surveys, game theory, auto-engine, scenarios, repair / diagnose) documented with file pointers.
- **[`LANGUAGE.md`](LANGUAGE.md)** — canonical glossary for the recurring vocabulary.
- **[`/manifesto`](https://meridians.global/manifesto)** — the long-form vision and theory: force formulas, validation against published works, calibration, GTM, the War Room product surface.
- **`src/types/narrative.ts`** — the domain model.
- **`src/lib/ai/`** — the LLM call surface. All generation routes through `callGenerate` / `callGenerateStream`.
- **`src/lib/prompts/`** — every prompt, modular and scoped. Phase-graph application, scene generation, beat planning, prose rendering, world expansion all live here.
- **`src/lib/forces/narrative-utils.ts`** — force formulas, cube logic, graph algorithms.

State: React Context + `useReducer` (`src/lib/state/store.tsx`). Persistence: IndexedDB (narratives, embeddings, audio, images) + localStorage (active id, prefs). No backend, no auth — your data stays in your browser.

---

## Stack

```
Next.js 16 · React 19 · TypeScript · Tailwind v4 · D3.js
OpenRouter (DeepSeek v4 Flash + Gemini 2.5 Flash) · OpenAI Embeddings · Replicate (Seedream 4.5)
IndexedDB + localStorage — fully client-side persistence, no backend database
```
