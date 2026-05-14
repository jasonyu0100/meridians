![InkTide](public/readme-banner.png)

# InkTide

**A browser-based simulation engine for long-form reasoning.** Build worlds from rich priors, model branching timelines, and forecast outcomes — across **fiction**, **non-fiction** (research, argument, essay), and **real-world simulation** (scenario forecasts, alternate-history modeling, strategic timelines). Originally built to analyze narratives — still validated there, with *Harry Potter and the Sorcerer's Stone* as the calibration anchor — the framework now extends to any domain where rich priors and structured exploration beat ungrounded LLM speculation. The moat is your priors.

No backend. State and embeddings live in IndexedDB. Plug in an OpenRouter key, paste a corpus, brief, or dataset, and the engine extracts a typed knowledge graph that mutates section by section — actors, locations, artifacts, threads, system rules. Three forces (fate / world / system) are derived deterministically from the graph; no second LLM call required to grade structure. Branch alternative timelines, compare outcomes, evaluate scenarios — at fixed cost, reproducibly.

**[Try it →](https://inktide-sourcenovel.vercel.app/)** · **[Read the paper →](https://inktide-sourcenovel.vercel.app/paper)** · **[Architecture reference →](CLAUDE.md)**

---

## Setup

```bash
git clone https://github.com/jasonyu0100/inktide.git
cd inktide
npm install
cp .env.example .env.local   # add your OpenRouter key
npm run dev                   # → http://localhost:3001
```

| Variable                        | Required | Purpose                                                |
| ------------------------------- | :------: | ------------------------------------------------------ |
| `OPENROUTER_API_KEY`            | yes      | LLM calls (default: Gemini 2.5 / 3 Flash)              |
| `OPENAI_API_KEY`                | optional | Embeddings — disables semantic search if absent        |
| `REPLICATE_API_TOKEN`           | optional | Image generation (Seedream 4.5)                        |
| `NEXT_PUBLIC_USER_API_KEYS`     | optional | Allow user-supplied keys via the in-app modal          |

See `.env.example` for the full list.

---

## What you can build with it

**Narrative simulation.** Generate full arcs end-to-end through a layered pipeline — phase graph (the world's working machinery) → causal reasoning graph (per-arc causal logic) → scene structures (deltas + summaries) → beat plans (function + mechanism scaffolding) → prose. Each stage commits decisions the next executes against, so coherence survives across hundreds of scenes. Branchable, reviewable, reconstructable. Renders into prose, screenplay, meta-overlay, or in-world simulation overlay — same beat plan, format-tailored accent profile.

**Real-world scenario modeling.** Feed the engine a rich brief or dataset — a market state, a strategic timeline, an alternate-history premise, a domain corpus — and it builds the same typed graph. Branch alternative timelines from any decision point, evaluate them in **Branch Chat** (multi-branch analytical chat with controlled scope windows, register-agnostic prompts, persisted threads), and compare outcomes through the same force math that grades novels. The framework is genre-neutral; what it actually measures is how a world is moving and where pressure builds.

**Variable scenario forecasting.** Probabilistic alternative to causal reasoning: instead of committing to one chain, the engine extracts a pool of load-bearing variables and produces a cohort of next-arc timelines as coordinations over that pool — each scored with a priorLogit, softmaxed to a relative probability. The cohort follows the power-law shape of real possibility space (most mass on modal continuation, a thin tail on rupture), works identically for fiction continuations, market scenarios, research counterfactuals, or strategic forecasts, and feeds **Experimentation** which generates one parallel branch per scenario for multi-timeline analysis.

**Text corpus analysis.** Paste any long-form work and the engine extracts its full structure: typed knowledge graph, force trajectories, pacing fingerprint (Markov transition matrices over scene-level cube modes), prose profile (authorial Markov chains over a 10-function / 8-mechanism beat taxonomy). Every analyzed work compounds the network — pacing patterns and prose signatures become reusable for cross-corpus comparison, scenario seeding, or generation.

**Mind mapping at scale.** Entities, threads, knowledge nodes, and embeddings render as interactive D3 graphs: network view (cumulative activation tiers), world graph (per-entity inner knowledge), knowledge graph (system rules / concepts), phase graph (working model of reality), reasoning graph (per-arc causal chain). Click any node to inspect — characters, locations, artifacts, threads, system nodes, knowledge nodes all open in the side panel with their full continuity.

**Semantic retrieval.** Every proposition, beat, and scene is embedded as a 1536-dim vector via OpenAI's `text-embedding-3-small`. Cosine similarity surfaces meaning, not keywords — searching for "betrayal" returns scenes of broken trust even when the word never appears. AI-synthesized overviews cite back to source spans. Drives continuity validation, knowledge-asymmetry tracking, and intelligent RAG for generation.

**Strategic interrogation.** Surveys (one question × N entities, each answering in-character from its own world-graph continuity), interviews (one entity × N questions), per-scene game-theoretic decomposition (14 axes × 19 game shapes), ELO rankings derived from per-scene stake deltas. Surfaces structural patterns the prose alone never summarises.

---

## First run

1. Land on `/` and pick a seed story (Harry Potter, LOTR, Game of Thrones, Star Wars, Reverend Insanity), or create your own from a premise via the wizard.
2. The wizard generates an initial world + introduction arc.
3. Open the **world graph** or **network view** to see what got built.
4. Run **auto mode** to generate more arcs, or drive each stage manually — generate the CRG, then the scenes, then the beat plans, then the prose. Edit at any layer.
5. Paste any long-form text into `/analysis` to extract its full structure into the engine.

---

## Why this beats LLM-only

LLMs alone collapse on long-form text — they forget, hallucinate, drift off premise, and can't tell you _why_ a story works structurally. InkTide is the substrate the LLM is missing:

- A **persistent typed graph** that mutates section by section, so the next generation knows what every prior scene committed.
- **Deterministic force math** — no LLM tax to grade structure, reproducible across runs.
- **Semantic embeddings** indexed on every proposition, so retrieval pulls relevant context from anywhere in the timeline.
- A **layered generation pipeline** (phase → CRG → scene → plan → prose) where each stage commits decisions the next executes against, with arc-level engine settings (force preference, reasoning mode, network bias) synced from CRG construction through scene rendering.

The engine is the spine; the LLM is one tool the engine drives.

---

## For developers digging in

- **[`CLAUDE.md`](CLAUDE.md)** — full architecture reference. Every major subsystem (forces, threads, phase graph, CRG, scenes, plans, prose, embeddings, surveys, game theory, auto-engine) documented with file pointers.
- **[`/paper`](https://inktide-sourcenovel.vercel.app/paper)** — the theory: force formulas, Markov chain pacing, variable scenario modelling, beat taxonomy, calibration against published works.
- **`src/types/narrative.ts`** — the domain model.
- **`src/lib/ai/`** — the LLM call surface. All generation routes through `callGenerate` / `callGenerateStream`.
- **`src/lib/prompts/`** — every prompt, modular and scoped. Phase-graph application, scene generation, beat planning, prose rendering, world expansion all live here.
- **`src/lib/narrative-utils.ts`** — force formulas, cube logic, graph algorithms.

State: React Context + `useReducer` (`src/lib/store.tsx`). Persistence: IndexedDB (narratives, embeddings, audio, images) + localStorage (active id, prefs). No backend, no auth — your data stays in your browser.

---

## Stack

```
Next.js 16 · React 19 · TypeScript · Tailwind v4 · D3.js
OpenRouter (DeepSeek v4 Flash) · OpenAI Embeddings · Replicate (Seedream 4.5)
IndexedDB + localStorage — fully client-side persistence, no backend database
```

---

## License

MIT — see [LICENSE](LICENSE)
