# Core Language

This document defines the canonical vocabulary InkTide uses in **LLM prompts** and
in **internal reasoning** (directives, review critiques, report copy, auto-engine
guidance). The aim is to keep terminology coherent across the system so that a
prompt, a directive, and a UI label never drift against each other.

These terms are **non-negotiable**. Do not replace them with synonyms (even
register-neutral ones) unless the whole system is migrated at once. If a fiction
term feels wrong for a non-fiction or simulation register, **broaden the usage**
(e.g. a "scene" of a research paper, a "beat" of an essay, a "scene" of a
wargame turn) rather than introducing a parallel word.

Rationale: InkTide is a multipurpose text engine. Four top-level registers are
first-class, no register preferenced over another:

- **Fiction** — novel, novella, short fiction, screenplay, drama.
- **Non-fiction** — memoir, essay, reportage, case study, history, biography.
- **Analysis** — research paper, technical writeup, formal investigation
  with hypothesis-testing structure, formulas, tables, figures, citations.
  (Previously folded under non-fiction; now first-class given how distinct
  its conventions are.)
- **Simulation** — works that model real-life events from a stated rule set.
  The central proposition is "given these rules and these initial conditions,
  what happens?" Examples: historical counterfactuals (had the Mughal
  succession gone differently, had a Tang–Tibetan border treaty held);
  economic and policy modelling; political wargames; pandemic and climate
  scenarios; agent-based social-dynamics studies; LitRPG / cultivation /
  xianxia where in-world mechanics drive events; technological forecasting.
  The rule set is load-bearing — the `system` force carries the real weight
  in this register, and threads close on rule-driven consequences rather than
  authorial choice. When rules surface as a diegetic overlay (HUD, log,
  dashboard, status sheet), the overlay is *narrative content*, rendered via
  the `simulation` ProseFormat.

The same abstractions serve all three. The abstractions only hold up if the
vocabulary stays stable across registers.

---

## 1. Canonical terms — MUST appear

These terms anchor the system. Every LLM prompt and every piece of
internal-reasoning copy that refers to these concepts should use the canonical
word, not a near-synonym.

| Term          | Meaning                                                                                              | Do NOT use instead            |
|---------------|------------------------------------------------------------------------------------------------------|-------------------------------|
| `narrative`   | The top-level work. Register-neutral — fiction, non-fiction, simulation, etc.                        | "story" (too fiction-coded)   |
| `scene`       | The unit of composition. A scene has a POV, a location, participants, and deltas.                    | "section", "passage", "chunk" |
| `arc`         | A grouping of scenes — a movement within the narrative.                                              | "chapter", "part"             |
| `beat`        | The sub-scene unit. A beat has a function (what it does) and a mechanism (how it delivers).          | "sentence", "paragraph"       |
| `delta`       | A structural change recorded against a scene (thread delta, world delta, system delta).              | "change", "update", "mutation"|
| `thread`      | A prediction market over named outcomes. Scenes emit evidence in [-4, +4] that shifts per-outcome logits; closure happens via payoff/twist at high margin. | "plotline", "arc" |
| `fate`        | The force pulling the narrative toward resolution. Computed from thread deltas.                      | "plot", "drive"               |
| `world`       | The force of entity inner-world transformation. Computed from world deltas.                          | "character development"       |
| `system`      | The force of rule/mechanism/concept deepening. Computed from system deltas.                          | "worldbuilding", "lore"       |
| `proposition` | A discrete narrative claim extracted from prose, used for semantic retrieval and structural roles.   | "statement", "fact"           |
| `entity`      | A character, location, or artifact — anything with its own inner world graph.                        | "object"                      |
| `anchor`      | The prominence tier for an entity that carries the narrative's weight.                               | "main character", "lead"      |
| `POV`         | Point-of-view. Fiction: the viewpoint character. Non-fiction: the authorial voice. Simulation: the observer or agent whose vantage tracks the modelled events. | "narrator", "perspective" |

## 2. Register-aware vocabulary

These terms are **allowed** in any register. State them once in canonical form;
the source's own register decides what they fill in. Do not write parallel
fiction / non-fiction / simulation translations into prompts — write the
canonical form once and trust the model to read the source's register.

| Canonical term          | What it names                                                                |
|-------------------------|------------------------------------------------------------------------------|
| `entity inner worlds`   | Whatever depth the source ascribes to its entities — interiority, history, archival weight, institutional record, modelled state under the rule set.                                |
| `entity arcs`           | The trajectory of any entity across scenes — character arc, investigator arc, argument arc, agent's path through the simulated rule space.                                          |
| `thread` (as question)  | An open question the work has committed to — dramatic, evidentiary, argumentative, or rule-driven (will the modelled system reach state X under condition Y?).                      |
| `payoff`                | The moment a thread closes or a setup discharges (resolution, finding, breakthrough, rule-driven outcome).                                                                          |
| `tension`               | Live contestation — between positions, claims, possibilities, or competing rule-driven trajectories.                                                                                |
| `reveal`                | Underlying nature exposed through action, choice, or what the rule set forces to the surface.                                                                                       |
| `breathe` (beat fn)     | Atmosphere, grounding, framing, stage-setting, statement of current rule-state.                                                                                                     |

## 3. Terms to AVOID as defaults

These appear historically in the codebase but **should not be used as the
default framing** in new prompts or reasoning copy. They bias the system toward
fiction or one storytelling tradition. Use the register-neutral canonical form
instead, or qualify explicitly.

| Avoid as default              | Prefer                                                           |
|-------------------------------|------------------------------------------------------------------|
| "story" (unqualified)         | "narrative"                                                      |
| "novel", "novelistic"         | "long-form work" / scope to fiction when genuinely fiction-only  |
| "chapter"                     | "arc" or "part of the narrative"                                 |
| "character" as universal      | "entity" at the system level; "character" when fiction-specific  |
| "protagonist" as universal    | "narrative voice" / "anchor entity" / qualify per register       |
| "plot"                        | "fate" (the force) or "thread" (the unit)                        |
| "fantasy" / "sci-fi" as examples | Draw examples from the narrative's actual subject matter      |

## 4. Simulation register notes

A simulation work models real-life events from a stated rule set. The canonical
abstractions still apply — scenes, beats, threads, forces — but the register
shifts where weight lives:

- **Rules are load-bearing.** The `system` force carries the real weight in
  this register — the rule set IS the substrate the work is exploring. System
  deltas (rules, mechanisms, gates, constraints, propagation laws,
  causal couplings) are not flavour, they are the engine of consequence.
- **Outcomes are rule-driven, not authorial.** A thread closes because the
  modelled rules force the closure under the given conditions. Threads frame
  as "will the modelled system reach state X under conditions Y?" with
  outcomes that are concrete states of the rule set.
- **POV is INSIDE the modelled events.** The vantage is a participant the
  rules act on — a candidate, a voter, a general, a minister, a cultivator,
  a researcher whose work IS the subject. NOT a meta-observer running the
  simulation from outside. For a 2024-US-politics premise the POV is Trump,
  Webb, a campaign strategist, a swing-state voter — never "Dr. Vásquez at
  the Simulation Core watching the dashboard." The system internally treats
  the work as rule-governed; that machinery is implementation, not in-world
  scenery.
- **Simulation ≠ meta-narrative — critical.** The simulation register means
  the work is *governed by* a rule set, not that the work is *about* someone
  running a simulation. Don't invent a research institute, simulation core,
  forecasting laboratory, modeller persona, hidden-parameter dampener, or
  analyst-watches-dashboard meta-frame **unless the premise explicitly asks
  for one** ("a story about an institute that simulates elections" — yes;
  "the 2024 US election" — no). The rules act on the modelled world's actual
  inhabitants; modellers do not appear unless the premise puts them there.
- **Diegetic overlay is real to the characters, or it doesn't appear.** Use
  the `simulation` ProseFormat (HUD, status sheet, log, dashboard, stat
  block, tier gate) ONLY when the modelled world *itself* contains these
  artifacts as in-world objects — a LitRPG character literally sees their
  stats, a wargame general literally reads a turn report, a cultivator
  literally crosses a tier gate, an in-world epidemiologist publishes a
  bulletin. NOT when an out-of-frame researcher reads dashboards about the
  story. A simulation-register work can equally render in plain prose with
  the rule machinery worked through dialogue, action, and narration — that
  is the default.
- **Avoid as default.** When register markers are needed, do not default to a
  single subgenre. Span historical counterfactual / economic-policy /
  political-wargame / scientific-process / social-dynamics / agent-based /
  LitRPG-cultivation. Defer to the narrative's own declared scenario when
  one is set.

## 5. Naming + register

Match the premise. When the source clearly implies a setting (Heian Japan, a
Lagos newsroom, a Mughal court, Silicon Valley), draw names + register from
that setting directly. Otherwise the default register is Western / Anglo —
the model's strongest baseline — and intelligent register decisions handle the
rest. No elaborate palette-mapping table; trust the model to read the premise
and write what fits.

## 6. Where this is enforced

- Automated guard: [src/__tests__/core-language.test.ts](../../__tests__/core-language.test.ts)
  — canonical terms present, avoided defaults absent.
- Human review: flag prompts using "story" / "novel" / "chapter" unqualified.

## 7. Scope

- **In scope**: any file under [src/lib/prompts/](./), any inline LLM prompt in
  [src/lib/ai/](../ai/), any LLM-facing directive string (e.g. in
  [src/lib/auto-engine.ts](../auto-engine.ts)).
- **Out of scope**: UI copy intended for users working in a single register
  specifically (e.g. the creation wizard's genre pickers, a screenplay-only
  format block, a wargame-only scenario picker). Register-coded language is
  fine where that register is the declared scope.
