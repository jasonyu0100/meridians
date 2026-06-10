# Meridians — App Map (MERMAID)

> Top-down map of how the whole app connects, current 2026-06-09 (verified against code). Companion to [TREE.md](TREE.md) (the file structure). Read top-to-bottom: **navigation → workspace shell → center views → inspector → topbar/modals → run & output surfaces → data/AI/persistence pipeline.**

---

## 1. App navigation (pages & how you move between them)

```mermaid
flowchart TB
    Landing["/ — Landing (app/page.tsx)<br/>NarrativesScreen · StoryCards"]
    Dashboard["/dashboard — story picker"]
    Manifesto["/manifesto — vision/theory"]
    CaseAnalysis["/case-analysis"]
    Analysis["/analysis — Text Analysis (create)<br/>AnalysisShell kind=create"]
    Extend["/extensions/[id] — Extend<br/>AnalysisShell kind=extend"]
    Wizard["CreationWizard<br/>(new story from premise)"]
    Workspace["/narrative/[id] — THE WORKSPACE<br/>SeriesPage → AppShell"]

    Landing --> Workspace
    Landing --> Analysis
    Landing --> Wizard
    Dashboard --> Workspace
    Dashboard --> Analysis
    Wizard --> Workspace
    Analysis -->|"creates NarrativeState"| Workspace
    Workspace -->|"add corpus to a story"| Extend
    Extend -->|"APPLY_EXTENSION"| Workspace
    Landing -.-> Manifesto
    Landing -.-> CaseAnalysis
```

Providers wrap every route (`app/providers.tsx`): `ThemeProvider → StoreProvider → WizardProvider → LogsProvider`; the workspace route adds `PropositionClassificationProvider → AudioPlayerProvider`. The URL `[id]` is the source of truth for the active narrative.

---

## 2. Workspace shell (regions of AppShell)

```mermaid
flowchart TB
    TopBar["TopBar — menus + theme/usage/audio/export/slides"]
    Rail["NarrativeRail — left 56px · story thumbnails"]
    SideL["DrivePanel (collapsed) → MediaDrive (the Drive)"]
    StageBar["StageBar — view switcher"]
    Stage["Stage — render dispatch"]
    StagePalette["StagePalette (overlay)"]
    RunBar["RunBar — run status"]
    Bottom["ScenePanel · TimelineStrip · ForceTimeline"]
    InspectorPanel["InspectorPanel — right inspector + 56px icon rail"]

    TopBar --> Rail & SideL & StageBar & InspectorPanel
    StageBar -->|"sets state.graphViewMode"| Stage
    Stage --> StagePalette
    StageBar --> RunBar --> Bottom
```

---

## 3. Center views (StageBar clusters → graphViewMode → component)

`Stage.tsx` is a render switch keyed on `state.graphViewMode`; `StageBar.tsx` groups the ~29 modes into **4 clusters: Signals · Base · Mind · Content** (tab labels; the internal cluster codenames now match — `signals` / `base` / `mind` / `content`).

```mermaid
flowchart LR
    CTB["StageBar"]
    CTB --> Signals & Base & Mind & Content

    subgraph Signals["SIGNALS (Capture) — room / perspective surfaces"]
        d1["vision → CaptureView (Priors / Entry)"]
        d2["streams → StreamsView (member-owned perspective contributions)"]
        d3["merges → MergesView (committed-stream History)"]
    end
    subgraph Base["BASE — Board + graph domains + curriculum (scope Scene/Arc/Full)"]
        b1["board → BoardView (nested maps + avatars)"]
        g1["world-* → WorldGraphView / inline D3"]
        g2["system-* → SystemGraphView"]
        g3["threads-* → ThreadGraphView / ThreadLogGraphView"]
        g4["network-* → NetworkView"]
        g5["curriculum → CurriculumView (topic tree + mastery)"]
    end
    subgraph Mind["MIND"]
        c1["belief → BeliefView / StreamBeliefView (mode-conditional)"]
        c2["present + compass → CompassView ('present' = current vars, 'compass' = forward cohort)"]
        c3["mode → PhaseGraphView (Phase / PRG)"]
        c4["decision → DecisionView"]
        c5["map → ReasoningGraphView (Maps; was Investigations)"]
        c6["search → CaptureView / SearchView"]
    end
    subgraph Content["CONTENT — the authored move"]
        s1["plan → ScenePlanView"]
        s2["prose → SceneProseView"]
        s3["audio → SceneAudioView"]
        s4["learning → SceneLearningView (per-scene question bank)"]
        s5["perspective → ScenePerspectivesView: per-scene retellings (public narrator + each participant); palette Generate fans out all lenses in parallel"]
    end
```

> Cluster membership lives in `StageBar` (`inSignalsMode` / `inBaseMode` / `inMindMode` / `inContentMode`). The **Signals** cluster (internally Capture) is the room/perspective workspace (`vision` Priors + `streams` + `merges`); `search` moved into **Mind**. `curriculum` joins `board` + the graph domains in **Base**. *Tab labels Signals / Base / Mind / Content; the persisted `graphViewMode` literals (`vision`, `streams`, `world-*`, …) are unchanged.* `BeliefView` swaps to `StreamBeliefView` for the member-sourced stream dashboard; `RoomUI` provides shared presentation primitives (avatars, status icons, perspective names) for Streams + Merges.

Adding a view = a `GraphViewMode` literal (`types/narrative.ts`) + a `StageBar` button + a `Stage` branch (copy `mode`).

---

## 4. Right inspector (InspectorPanel tabs → bodies)

Inspector tabs are a registry inside `InspectorPanel.tsx` (separate from the center views). The `inspector` tab body is driven by `viewState.inspectorContext` via `renderInspector()`.

```mermaid
flowchart LR
    SP["InspectorPanel (icon rail + tabs)"]
    SP --> T1["inspector → renderInspector()"]
    SP --> T2["chat → ChatPanel"]
    SP --> T3["threads → ThreadsPanel"]
    SP --> T4["files → FilesPanel"]
    SP --> T5["knowledge → KnowledgePanel"]
    SP --> T6["surveys → SurveyPanel"]
    SP --> T7["interviews → InterviewPanel"]
    SP --> T8["maps → MapPanel"]
    SP --> T9["compass → CompassPanel"]
    SP --> T10["eval (Review) → BranchEval"]
    SP --> T11["learning (Coverage) → LearningPanel"]
    T1 --> D["CharacterDetail · LocationDetail · ArtifactDetail<br/>ThreadDetail · ArcDetail · SceneDetail<br/>WorldNodeDetail · KnowledgeDetail · ThreadLogNodeDetail<br/>ReasoningNodeDetail · PhaseNodeDetail<br/>StreamDetail · StreamPriorDetail · MergeDetail · TopicDetail · QuestionDetail"]
```

> New `renderInspector()` contexts: **stream** (`StreamDetail` — stance + priors log), **streamPrior** (`StreamPriorDetail` — one member-contributed prior), **merge** (`MergeDetail` — the war-room commit that folded a stream into continuity, linked to its arc), **topic** (`TopicDetail` — curriculum node rename/describe/re-parent), **question** (`QuestionDetail` — learning question + topic reassignment).

---

## 5. TopBar menus & modals

```mermaid
flowchart TB
    TB["TopBar"]
    TB --> SettingsMenu & View & Analyze & Profiles & Reference & Debug & Right

    SettingsMenu["Settings menu"] --> About["About → NarrativeEditModal"] & Members["Members → MembersModal"] & Agents["Agents → AgentsModal"]
    View["View menu"] --> Slides["SlidesPlayer"] & SlideRegions["SlideRegionsModal (scoped decks)"] & ThemeM["ThemeModal"] & TimeFlow["TimeFlowModal"]
    Analyze["Analyze menu"] --> GTD["GameTheoryDashboard"] & PropAn["PropositionAnalysisModal"] & ForceAn["ForceAnalytics"] & Markov["MarkovChainModal"]
    Profiles["Profiles menu"] --> Prose["ProseProfilePanel"] & Beat["BeatProfileModal"] & Patterns["PatternsModal"] & Settings["StorySettingsModal"]
    Reference["Reference menu"] --> Formula["FormulaModal"] & Defs["DefinitionsModal"]
    Debug["Debug menu"] --> ApiLogs["ApiLogsModal"] & SysLog["SystemLogModal"] & Embed["RegenerateEmbeddingsModal"]
    Right["Right controls"] --> Gas["GasMeter / UsageModal ($)"] & Audio["NowPlaying (audio)"] & Export["Export/Import packages"] & Learn["LearnModal (fullscreen quiz runner)"]
```

Two wiring conventions: open a local modal (`setXOpen(true)`), or `window.dispatchEvent(new Event('open-xxx'))` that the listening component handles. The **Learn** badge opens `LearnModal` directly; the scene **Learn** tab and the **Learning** inspector panel open it pre-scoped via `window.dispatchEvent('open-learn-modal', { detail: ScopeSelection })`. (`narrative/[id]/page.tsx` listens for the other `open-xxx` events when the panel lives at page level.)

> **Learning (Quiz) layer** — a purely additive, post-hoc surface (like game theory): per-scene MCQ question banks generated by `ai/learning` (`prompts/learning`) and aggregated/scoped by `lib/learning/quiz` (`ScopeSelection`). The three UI surfaces above all read the same banks stored per-scene on `scene.questions` (`LearningQuestion[]`); `LearnModal` runs scoped practice across them. A **Curriculum** layer (`lib/learning/curriculum`) organises the bank into a reorganisable `Topic` tree (questions assigned 1:1 to a topic), with `lib/learning/coverage` layering per-member spaced-repetition recall on top — the inspector **Coverage** tab and `CurriculumView` surface this.
>
> **Room / perspective model** — `NarrativeState` now carries the room: `Member[]` (exactly one GM, via **MembersModal** + `useActiveMember`), `Agent[]` (AI players with preset/custom personas — **AgentsModal**, `lib/agents/personas`), and `Perspective[]` (a seat bound to an entity or narrator, held by members and/or an agent). Each perspective accumulates **Streams** — a member's bearing on an open question — and committed streams fold into **Merges** that extend continuity. See Section 6.

---

## 6. Run & output surfaces (capture / generate / rehearse / review)

```mermaid
flowchart TB
    subgraph Capture["CAPTURE (room / perspective-PRs)"]
        DriverC["CaptureView / CapturePalette"] --> dd["priors-compact.synthesise → SourceFile"]
        DriverC --> aiDriver["ai/capture.generatePrior"]
        StreamsC["StreamsView"] --> aiStream["ai/streams.instantiateStream → forces/stream-stance (member-owned Stance)"]
        StreamsC -->|"commit + fold"| MergesC["MergesView ← lib/merges (Merge = continuity basis)"]
        StreamPort["analysis/stream-portfolio · StreamBeliefView"]
    end
    subgraph Generate["GENERATE (forward)"]
        GP["GeneratePanel"] --> AutoH["useAutoPlay → auto-engine"]
        MCB["RunBar"] --> AutoH
        AutoH --> aiScenes["ai: reasoning-graph → scenes → plan → prose"]
        BulkH["useBulkGenerate / useBulkEmbed / useBulkAudioGenerate"] --> aiScenes
    end
    subgraph Rehearse["REHEARSE"]
        Compass["CompassView (Compass) · arc.planningScenarios"] --> useSc["useScenarios"]
        ScP["ScenariosPanel"] --> useSc
        useSc --> ScEng["scenarios-engine → parallel arcs → sister branches"]
    end
    subgraph Review["REVIEW"]
        Slides["SlidesPlayer ← slides-data (whole-branch)"]
        GTView["DecisionView / GameTheoryDashboard (decision + ELO)"]
        BranchEval["BranchEval → ai/review → ai/reconstruct (versioned)"]
    end
```

> Build status: the **room / participant model** (`Member`/`Agent`/`Perspective`), **capture-as-perspective-PRs** (Streams — a member's bearing on an open question, member-owned Stance), and the **war-room merge** (Merges fold committed streams into continuity) are now **shipped**. Still **not yet built**: the weekly market, the **Conviction** card game ([CONCEPT.md](CONCEPT.md)), local encryption/PIN, **Signal** async capture (E2E), and **Cloudflare-tunnel** (`cloudflared`) multi-user live access. Other shipped bases: `useScenarios`/`scenarios-engine` (Rehearse), `SlidesPlayer`/`slides-data` + **SlideRegionsModal** (scoped decks), `ai/review`+`reconstruct` (the engine's branch review). *Review-as-a-loop-phase and Butterfly were dropped.*

---

## 7. Data · AI · persistence · external (the engine pipeline)

```mermaid
flowchart TB
    subgraph UI["UI (components + hooks)"]
        Views["views / panels / modals"]
    end
    subgraph State["State (lib/state/store.tsx)"]
        Store["useStore() · AppState · ~110 actions"]
        Derive["withDerivedEntities (manifests + deltas → entities/threads/system)"]
    end
    subgraph Engine["Deterministic engine (lib/*)"]
        Forces["narrative-utils — Fate=KL · World/System=ΔN+√ΔE · rank-Gaussian"]
        ThreadLog["thread-log.applyThreadDelta — stances · KL infoGain"]
        StreamS["stream-stance — member-owned Stance (Stream reuses thread belief) · stream-portfolio"]
        Merge["merges — committed streams → continuity basis (branch-relative)"]
        Curric["learning/curriculum (Topic tree) · learning/coverage (per-member recall)"]
        GT["game-theory — Nash · ELO · margin"]
        Graphs["world/system/network-graph · positions · phase-graph (PRG)"]
        SearchE["embeddings · search · citation-attribution"]
    end
    subgraph AI["AI (lib/ai + lib/prompts)"]
        Ctx["context.ts — context blocks"]
        Prompts["prompts/&lt;domain&gt; — text + output schema"]
        ApiTs["api.ts — callGenerate / callGenerateStream"]
        Repair["json → JsonRepairableError → diagnose → planRepair → repairJsonOutput"]
    end
    subgraph Routes["API routes (stateless, src/app/api)"]
        RGen["/api/generate (SSE + JSON)"]
        REmb["/api/embeddings"]
        RImg["/api/generate-image · -cover · -audio"]
    end
    subgraph Ext["External"]
        OR["OpenRouter — DeepSeek v4 Flash · Gemini 2.5 Flash"]
        OAI["OpenAI — embeddings · TTS"]
        Rep["Replicate — Seedream 4.5"]
    end
    subgraph Persist["IndexedDB meridians-main (v4)"]
        S1[("narratives")]
        S2[("meta — id · branch · search · view · jobs")]
        S3[("apiLogs")]
        S4[("embeddings")]
        S567[("audio · images · texts")]
    end

    Views <--> Store
    Store --> Derive
    Derive --> Forces & ThreadLog & GT & Graphs
    Store --> StreamS & Merge & Curric
    Views --> Ctx --> Prompts --> ApiTs --> RGen --> OR
    ApiTs -.->|"on parse fail"| Repair -.-> ApiTs
    SearchE --> REmb --> OAI
    Views --> RImg --> Rep
    Store -->|"save-on-change (no debounce)"| S1
    Store --> S2 & S3
    SearchE --> S4
    Views --> S567
    ApiTs -.->|"api-logger"| S3
```

**Invariants:** one source of truth (the GM's machine); forces are *derived from deltas*, never authored; derived entities re-derive from manifests (don't mutate the caches); every LLM call funnels through `ai/api.ts` and is logged by `caller`; output schemas live with the prompt builder and are shared with repair.

> **Room / curriculum state on `NarrativeState`:** `Member[]` (one GM), `Agent[]` (AI players + personas), `Perspective[]` (entity/narrator seats), `Stream[]` (member-owned bearings on open questions — a Stream reuses Fate-Thread belief mechanics but over one member-owned Stance whose log nodes are its `priors`), `Merge[]` (committed-stream folds; **Streams + Merges are branch-OWNED** — `branchId` is ownership, and a **fork deep-copies** the parent branch's streams + merges into the child with fresh ids + an `originStreamId` / `originMergeId` back-link, so every branch is a fully isolated sandbox: priors, commits, reverts and undos on one branch never touch another, and the origin links let you compare *the same question* across divergent playthroughs. Scenes stay structurally **shared** (immutable); only the mutable belief layer is copied. `n.streams` / `n.merges` remain global dicts so id-lookups always resolve; `branchId` governs which copy a branch *operates on* and *displays*. Consumption (`basisMergeIds`) matches a copy by id **or** its origin), and `Topic[]` + `LearningProgress` (curriculum tree + per-member spaced-repetition coverage). Threads = the world view's belief over narrative questions; Streams = the parallel, perspective-scoped belief layer feeding the room.

---

## 8. Conviction — the rehearsal game state machine ([CONCEPT.md](CONCEPT.md))

A game is a **branch**; a `GameRoom` runs the round loop over it as a phase machine (`RoundState.phase`), in one of two **variants** — **Rounds** (poker turn order; the diagram below) or **Showdown** (a real-time, simultaneous **LIVE** window replacing READ-WRITE + PLAY). Humans take their turns by hand; agents resolve automatically; a timeout with nothing committed = no action (ceded to the LLM). Scoring is **intrinsic**: in the **SCORING** phase each round, the realized stance shift on every thread is decomposed across the seats that moved it — **Aumann–Shapley on the Fate/KL, conserving exactly** — into a running **Impact** score, shown with a **Ranking**. **Streams are perspective-owned** (one per seat — no shared "board" streams); the **Merge** is the only place separate seats' streams meet, settling each **contested thread** per **`RESOLVE_BIAS`** (a random draw from the conviction-shaped odds by default · `lowest-cost` realism · `highest-cost` drama · `gm` sovereign), optionally spotlit in an **optional SHOWDOWN phase** before SETTLE. **Goals** are optional personal trackers that never affect the score; the old betting layer is gone. Conviction is a **gamified automation layer over the shipping stream / merge / generate UI** — one continuous window; the GM advances each round with **one click through the Generate Panel** (override optional). **Not yet built** — this is the spec.

```mermaid
stateDiagram-v2
    [*] --> Setup
    Setup --> Waiting: mode = remote (seats join controllers)
    Setup --> Round: mode = computer (GM proxies all)
    Waiting --> Round: GM starts · empty seats → agents

    state Round {
        [*] --> PublicNarration
        PublicNarration --> PrivateNarration: public delivered (everyone)
        PrivateNarration --> ReadWrite: private delivered (per seat)
        ReadWrite --> Play: read timer ends / stand pat
        Play --> Resolve: reveal forced by default - off = teeth
        Resolve --> Showdown: settle contests per RESOLVE_BIAS - random default - GM one-click generate
        Showdown --> Settle: spotlight verdicts - optional SHOWDOWN_PHASE
        Settle --> Scoring: decay then income - ceiling 150
        Scoring --> PublicNarration: Impact decomposed - Ranking shown
    }
    Round --> [*]: GM ends game

    note left of Round
      RoundState.phase ∈ public-narration · private-narration ·
      read-write · play (Rounds) | live (Showdown) · resolve ·
      showdown (optional) · settle · scoring (ReadWrite = id 'read-write'). NARRATION:
      at Resolve the canon generates
      once (GM-only ground truth; round 1 = the opening state),
      then a PARALLEL BATCH of PerspectiveViews off it — public,
      then each seat's private. Players never see canon; GM sees all.
    end note
    note right of Round
      Streams are PERSPECTIVE-OWNED, one per seat — no shared board.
      READ WRITE: deal hands on your OWN streams, update priors + open
      NEW streams you own (open questions → scoreStreamPrior gate →
      deal), take the ONE location hop. PLAY: poker turn order, face
      up/down, cost COST_MIN–100. Reveal FORCED by default. RESOLVE
      folds committed streams into a Merge; contested threads settle
      per RESOLVE_BIAS — random draw default · lowest-cost realism ·
      highest-cost drama · gm sovereign — optionally spotlit in the
      SHOWDOWN phase (shows the draw + Fate house band). SCORING:
      nudge-fate decomposed across seats (Aumann–Shapley); the draw's
      snap is FATE's band, not a seat's → Impact + Ranking; goals
      personal, never scored. Chat global / location ALWAYS open.
    end note
```

> **Build components.**
> **Host surfaces** — (1) **GM board · desktop**: the Play fullscreen modal, global state + `act-as-seat` proxy, runs the machine. (2) **Player controller · mobile**: perspective-gated, over the tunnel.
> **Shared play UI** — minimalist; **The Board is the single primary surface** (rendered global for the GM, perspective-gated for a player — **responsive across desktop + mobile**). (3) **The Board**: poker-table-inspired felt that **conveys narration + round info directly** (no side panels) — seats as **avatar + name + conviction stack**, a rotating **dealer button**, the **live canonical threads + pot + timer** at centre (each seat's own streams sit in its hand), face-up/down reveal, plus the live **Impact tally / Ranking** and the SCORING-phase **readout** (authored stance ribbons + per-seat fate decomposition). (4) **The Cards**: the hand at the player's seat — face-up/down, `−log p` cost, play / raise / pass / fold. (5) **Chat — modal**: **global** (everyone; cheap talk) + **location** (co-located only; alliances), opened over the board; **agents are full participants**. (6) **Navigation — popups**: move, pose-question / request-more, **set / reassign goal**, settings — popups layered on the board, not panels.
> **Content tab** — (7) **Perspective views**: per-scene `PerspectiveView` (canon global + private per-entity retellings) that feed the narration phases.
> **Spec** — (8) **State machine** (this diagram): `RoundState.phase` over a `GameRoom`.
> New types (`GameRoom` (carries `variant`) · `Seat` (carries `goals` + running `fateImpact`) · `RoundState` (phase incl. `scoring`) · `Card`/`Hand`/`PlayedCard` · `CardRequest` (backs nav (6)) · `ChatMessage` · `PerspectiveView` (canon/public/private — one type for narration *and* requested retellings) · `Goal` (personal target; never scored) · `ConvictionEconomy`) layer over shipped `Perspective` / `Stream` / `Merge` / `Location` — see [CONCEPT.md](CONCEPT.md). Scoring reuses the engine's **Fate/KL + thread log** (Aumann–Shapley attribution), and the **Influence alluvial** (Fate tab) carries cumulative Impact.
