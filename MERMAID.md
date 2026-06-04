# Meridians — App Map (MERMAID)

> Top-down map of how the whole app connects, current 2026-06-04 (verified against code). Companion to [TREE.md](TREE.md) (the file structure). Read top-to-bottom: **navigation → workspace shell → center views → inspector → topbar/modals → run & output surfaces → data/AI/persistence pipeline.**

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

`Stage.tsx` is a render switch keyed on `state.graphViewMode`; `StageBar.tsx` groups modes into 5 clusters.

```mermaid
flowchart LR
    CTB["StageBar"]
    CTB --> Capture & Graph & Board & Mind & Scene

    subgraph Capture["CAPTURE"]
        d1["driver → CaptureView (Queue/Priors)"]
        d2["search → SearchView"]
    end
    subgraph Graph["GRAPH (domain × scene/arc/full)"]
        g1["world-* → WorldGraphView / inline D3"]
        g2["system-* → SystemGraphView"]
        g3["threads-* → ThreadGraphView / ThreadLogGraphView"]
        g4["network-* → NetworkView"]
    end
    subgraph Board["BOARD"]
        b1["board → BoardView (maps + avatars)"]
    end
    subgraph Mind["MIND"]
        c1["belief → BeliefView"]
        c2["present → CompassView"]
        c3["compass → CompassView (Compass)"]
        c4["mode → PhaseGraphView (PRG)"]
        c5["decision → DecisionView"]
        c6["map → ReasoningGraphView (Maps; was Investigations)"]
    end
    subgraph Scene["SCENE"]
        s2["plan → ScenePlanView"]
        s3["prose → SceneProseView"]
        s4["audio → SceneAudioView"]
        s5["decision → DecisionView"]
    end
```

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
    T1 --> D["CharacterDetail · LocationDetail · ArtifactDetail<br/>ThreadDetail · ArcDetail · SceneDetail<br/>WorldNodeDetail · KnowledgeDetail · ThreadLogNodeDetail<br/>ReasoningNodeDetail · ModeNodeDetail"]
```

---

## 5. TopBar menus & modals

```mermaid
flowchart TB
    TB["TopBar"]
    TB --> View & Analyze & Profiles & Reference & Debug & Right

    View["View menu"] --> Slides["SlidesPlayer"] & ThemeM["ThemeModal"] & TimeFlow["TimeFlowModal"]
    Analyze["Analyze menu"] --> GTD["GameTheoryDashboard"] & PropAn["PropositionAnalysisModal"] & ForceAn["ForceAnalytics"] & Markov["MarkovChainModal"]
    Profiles["Profiles menu"] --> Prose["ProseProfilePanel"] & Beat["BeatProfileModal"] & Patterns["PatternsModal"] & Settings["StorySettingsModal"]
    Reference["Reference menu"] --> Formula["FormulaModal"] & Defs["DefinitionsModal"]
    Debug["Debug menu"] --> ApiLogs["ApiLogsModal"] & SysLog["SystemLogModal"] & Embed["RegenerateEmbeddingsModal"]
    Right["Right controls"] --> Gas["GasMeter / UsageModal ($)"] & Audio["NowPlaying (audio)"] & Export["Export/Import packages"]
```

Two wiring conventions: open a local modal (`setXOpen(true)`), or `window.dispatchEvent(new Event('open-xxx'))` that `narrative/[id]/page.tsx` listens for (when the panel lives at page level).

---

## 6. Run & output surfaces (capture / generate / rehearse / review)

```mermaid
flowchart TB
    subgraph Capture["CAPTURE"]
        DriverC["CaptureView / CapturePalette"] --> dd["priors-compact.synthesise → SourceFile"]
        DriverC --> aiDriver["ai/capture.generatePrior"]
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

> Roadmap note: **per-perspective seats (A1)**, **Butterfly (A6)**, deck scoping (A7), encryption/PIN (A8), and ngrok/multi-user (B1) are **not yet built**. Rehearse (`useScenarios`/`scenarios-engine`) and the deck (`SlidesPlayer`/`slides-data`) are the shipped bases. See [ROADMAP.md](ROADMAP.md).

---

## 7. Data · AI · persistence · external (the engine pipeline)

```mermaid
flowchart TB
    subgraph UI["UI (components + hooks)"]
        Views["views / panels / modals"]
    end
    subgraph State["State (lib/store.tsx)"]
        Store["useStore() · AppState · ~110 actions"]
        Derive["withDerivedEntities (manifests + deltas → entities/threads/system)"]
    end
    subgraph Engine["Deterministic engine (lib/*)"]
        Forces["narrative-utils — Fate=KL · World/System=ΔN+√ΔE · rank-Gaussian"]
        ThreadLog["thread-log.applyThreadDelta — stances · KL infoGain"]
        GT["game-theory — Nash · ELO · margin"]
        Graphs["world/system/network-graph · positions · mode-graph (PRG)"]
        SearchE["embeddings · search"]
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
