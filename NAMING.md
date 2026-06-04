# Meridians — Naming Convention & Rename Plan

> The shared naming language for the codebase (companion to [LANGUAGE.md](LANGUAGE.md), which defines the *domain* vocabulary). This file defines how code names are *formed* and lists the concrete renames to get there. Status tags: **[CONFIRM]** = a keystone decision to lock before executing; **[do]** = agreed-shape, low risk; **[opt]** = optional/deeper.

## The formula: `Domain + Role`

Every component/surface name = a **domain** term (from LANGUAGE.md) + a **role** word for its physical place/shape in the workspace. Reads as "where it is" + "what it's about". e.g. `ScenePanel`, `StageBar`, `ForceTimeline`, `DecisionView`.

### Role lexicon (precise)
| Role | Means | Notes |
|---|---|---|
| **Rail** | thin **vertical** strip of items/icons | left story rail; inspector icon rail |
| **Bar** | thin **horizontal** strip of controls | top of a region |
| **Panel** | a **large rectangular region** of content | resizable / dockable |
| **View** | a **full center surface** the Stage swaps between | keep the `…View` suffix |
| **Stage** | the **center surface** that hosts one View at a time | replaces "canvas" — see keystone |
| **Timeline** | a horizontal **time-ordered** band | scenes, forces |
| **Modal** | overlay dialog | |
| **Popover** | small **anchored** overlay | |
| **Chart** | one visualization | |
| **Dashboard** | a full **analytics** surface | |
| **Detail** | inspector body for **one entity** | panel content |
| **Slide** | one deck slide | |
| **Palette** | floating action menu | |

### Domain lexicon (draw names from LANGUAGE.md, not synonyms)
`Narrative · Scene · Arc · Branch · Thread · Belief · Stance · Priors · Capture · Rehearse · Review · Compass · Variables · Phase Reasoning Graph / Phase (PRG) · Reasoning (CRG) · Decision · Mind (the Control cluster) · Force (Fate/World/System) · Network · World · System · Board · Substrate · Driver✗→Capture · Queue✗→Priors · Series✗→Narrative · Mode✗→Phase · Control✗→Mind`.

---

## Keystone decisions (lock these first — they cascade)

> **LOCKED + EXECUTED 2026-06-04:** (1) canvas → **Stage** ✓ · (2) Driver → **Capture**, Queue → **Priors** ✓ · (5) Mode → **Phase Reasoning Graph / Phase** ✓ · (6) Control cluster → **Mind** ✓. All renames in this plan are applied (tsc clean + 1605 tests pass). **Deliberately kept:** the internal `graphViewMode` *values* `'driver'` / `'mode'` / `'control'` (only labels + component/type names were renamed — the string discriminants stay to avoid touching persisted state); cube/thinking/pacing "mode" words; the **[opt]** deeper splits (`research/` folder, `narrative-utils` split, `KnowledgeDetail→SystemNodeDetail`, `VersionTree`) — not done.

**5. `Mode` → `Phase` (Phase Reasoning Graph / PRG) [LOCKED]** — revert the PRG's code name from "Mode" back to **Phase**.
- `lib/mode-graph.ts` → `lib/phase-graph.ts`; `lib/ai/mode-graph.ts` → `lib/ai/phase-graph.ts`; `prompts/mode/` → `prompts/phase/`
- `stage/ModeGraphView.tsx` (exports `ModeCanvas`) → `stage/PhaseGraphView.tsx` (export `PhaseGraphView`)
- `inspector/ModeNodeDetail.tsx` → `inspector/PhaseNodeDetail.tsx`
- symbols: `generateMode`→`generatePhaseGraph`, `buildActiveModeSection`→`buildActivePhaseSection`, `getActiveMode`→`getActivePhaseGraph`, `pruneModes`→`prunePhaseGraphs`, `ModeNode*`→`PhaseNode*`, `ModeScope`→`PhaseScope`
- state: `NarrativeState.modes`→`phaseGraphs`, `currentModeId`→`currentPhaseGraphId`, `arc.modeId`→`arc.phaseGraphId`; actions `*_PHASE_GRAPH` (already named that in the store — verify)
- graphViewMode `mode` → `phase`; UI label "Mode Graph" → "Phase"

**6. `Control` cluster → `Mind` [LOCKED]** — the cluster grouping Belief / Present / Compass / Phase.
- in `StageBar`: cluster label "Control" → "Mind"; `inControlMode`→`inMindMode`; `lastControlSubModeRef`→`lastMindSubModeRef`

**1. `canvas` → `Stage` [LOCKED]** — the center is a surface that shows one View, with a bar to switch. "Canvas" is vague and overloaded.
- `components/canvas/` → `components/stage/`
- `WorldGraph` → `Stage` (it's the view-host, not the world graph)
- `CanvasTopBar` → `StageBar`
- `FloatingPalette` → `StagePalette`
- *(alt if not Stage: `View`/`ViewHost`/`ViewBar`, or `Surface`)*

**2. `Driver` → `Capture`, `Queue` → `Priors` [CONFIRM]** — the Driver is the **Capture** beat's surface; its items are **Priors**. (Note: distinct from `MediaDrive` = the media "Drive"; freeing "Driver" removes that Drive/Driver clash.)
- `components/driver/` → `components/capture/`
- `DriverCanvas` → `CaptureView`; `DriverPalette` → `CapturePalette`; `CompactPreviewModal` stays
- `ai/driver.ts` → `ai/capture.ts` (`generateDriverEntry` → `generatePrior`)
- `daily-driver.ts` → `priors-compact.ts`
- type `DriverEntry` → `Prior`; field `driverEntries` → `priors`
- actions `CREATE/UPDATE/DELETE_DRIVER_ENTRY` → `…_PRIOR`; `MARK_DRIVER_ENTRIES_USED` → `MARK_PRIORS_USED`
- UI sub-tab label `Queue` → `Priors` (the `Historical` split stays)

**3. `ModeControlBar` → `RunBar` [do]** — it's the auto/scenarios/bulk **run-status** bar; "Mode" collides with the PRG **Mode**.

**4. `Sidebar` / `SidePanel` → `DrivePanel` / `InspectorPanel` [do]** — "Sidebar" (left) vs "SidePanel" (right) is a coin-flip; name by role+domain. (`DrivePanel` = left region hosting the media Drive; `InspectorPanel` = right inspector.)

---

## The laundry list

### A. Shell & regions
| Now | → | Tag |
|---|---|---|
| `layout/AppShell.tsx` | keep | |
| `canvas/WorldGraph.tsx` | `stage/Stage.tsx` | CONFIRM |
| `canvas/CanvasTopBar.tsx` | `stage/StageBar.tsx` | CONFIRM |
| `canvas/FloatingPalette.tsx` | `stage/StagePalette.tsx` | CONFIRM |
| `sidebar/Sidebar.tsx` | `layout/DrivePanel.tsx` | do |
| `inspector/SidePanel.tsx` | `inspector/InspectorPanel.tsx` | do |
| `narrative/NarrativePanel.tsx` | `stage/ScenePanel.tsx` | do |
| `app/narrative/[id]` → `SeriesPage` | `NarrativeWorkspace` | do |

### B. Bars (horizontal control strips)
| Now | → | Tag |
|---|---|---|
| `topbar/TopBar.tsx` | keep | |
| `generation/ModeControlBar.tsx` | `generation/RunBar.tsx` | do |
| `scenarios/ScenariosControlBar.tsx` | `scenarios/ScenariosBar.tsx` | do |
| `canvas/SceneInfoBar.tsx` | `stage/SceneBar.tsx` | do |

### C. Center Views (keep `…View`; align to domain)
| Now | → | Tag |
|---|---|---|
| `canvas/DriverCanvas.tsx` | `capture/CaptureView.tsx` | CONFIRM |
| `canvas/VariablesView.tsx` | `stage/CompassView.tsx` | CONFIRM (UI label "Compass") |
| `canvas/SceneGameTheoryView.tsx` | `stage/DecisionView.tsx` | do (UI "Decision Matrix") |
| `canvas/KnowledgeGraphView.tsx` | `stage/SystemGraphView.tsx` | do (domain = System) |
| `canvas/EntityWorldGraphView.tsx` | `stage/WorldGraphView.tsx` | do |
| `canvas/ModeGraphView.tsx` (exports `ModeCanvas`) | `stage/PhaseGraphView.tsx` (export `PhaseGraphView`) | LOCKED (Mode→Phase; kill "Canvas" export) |
| `canvas/BoardView · BeliefView · NetworkView · SearchView · ScenePlanView · SceneProseView · SceneAudioView · ReasoningGraphView · ThreadGraphView · ThreadLogGraphView · PlanCandidatesView` | move to `stage/`, names keep | do |
| `canvas/VersionHistoryTree.tsx` | `stage/VersionTree.tsx` | opt |

### D. Panels (regions of content)
| Now | → | Tag |
|---|---|---|
| `sidebar/ThreadPortfolio.tsx` | `inspector/ThreadsPanel.tsx` | do |
| `sidebar/ChatPanel · FilesPanel · CompassPanel` | move to `inspector/`, names keep | do |
| `sidebar/SurveyPanel · InterviewPanel · InvestigationPanel` | move to `research/`, names keep | opt |
| `layout/ProseProfilePanel · auto/AutoSettingsPanel · inspector/KnowledgePanel · scenarios/ScenariosPanel` | keep names | |

### E. Inspector details (one entity each — keep `…Detail`)
`CharacterDetail · LocationDetail · ArtifactDetail · ThreadDetail · ArcDetail · SceneDetail · WorldNodeDetail · KnowledgeDetail · ThreadLogNodeDetail · ReasoningNodeDetail · ModeNodeDetail` — **consistent already, keep.** (`KnowledgeDetail` → `SystemNodeDetail`? [opt], to match "System" domain.)

### F. Domain-symbol alignments (beyond filenames)
| Now | → | Tag |
|---|---|---|
| `Driver*` symbols / `DriverEntry` / `driverEntries` / `*_DRIVER_ENTRY` | `Capture*` / `Prior` / `priors` / `*_PRIOR` | CONFIRM |
| `SeriesPage`, `userSeries`, "Series creation" copy | `NarrativeWorkspace`, `userNarratives`, "Narrative creation" | do |
| `Queue` UI labels in Capture/Stage bars | `Priors` | CONFIRM |
| leftover `phaseGraph`/`PhaseGraph` refs in `mode/` files | `mode`/`Mode` | do |
| `ModeCanvas` export | `ModeView` | do |
| keep: `Series` (force/cube archetype), `Queue/Historical` internal split is renamed to `Priors/Historical` | — | (don't touch the archetype) |

### G. lib disambiguation & clarity
| Now | → | Tag |
|---|---|---|
| `lib/pacing-profile.ts` (the Markov sampler) | `lib/pacing-markov.ts` | do |
| `lib/pacing-profiles.ts` (the preset system) | keep (mirrors `beat-profiles.ts`) | |
| `lib/daily-driver.ts` | `lib/priors-compact.ts` | CONFIRM (with B) |
| `lib/ai/driver.ts` | `lib/ai/capture.ts` | CONFIRM (with B) |
| `lib/narrative-utils.ts` (forces + cube + grading + pov grab-bag) | split → `lib/forces.ts` (+ `cube.ts`, `grading.ts`)? | opt (bigger) |

### H. Hierarchy / folders
| Move | Rationale | Tag |
|---|---|---|
| `components/canvas/` → `components/stage/` | the center surface + its views | CONFIRM |
| `components/driver/` → `components/capture/` | the Capture surface | CONFIRM |
| split `components/sidebar/` | grab-bag → `layout/` (left chrome: rail, DrivePanel, MediaDrive, MediaPreview, MapAnnotator), `inspector/` (the tab panels), `research/` (surveys/interviews/investigations + their modals) | opt |
| `components/topbar/` modals | keep with TopBar, or split bar vs `topbar/modals/` | opt |
| `components/narrative/` (only `NarrativePanel`) | dissolve into `stage/` | do |

### What's already consistent (leave alone)
- Casing: PascalCase components, kebab-case lib, domain-foldered prompts.
- `…-graph.ts` family (`world/system/network/mode-graph`); `…-export.ts` family; `scenarios-engine/state/remap` trio; `game-theory*` family; `*Slide`, `*Modal`, `*Chart`, `*Detail` suffixes.

---

## Decisions to lock
1. **canvas → `Stage`?** (alt: View / Surface)
2. **Driver → `Capture`?** (alt: Intake / Ledger / Desk) — and confirm the symbol-deep rename (`DriverEntry`→`Prior`, actions, store field).
3. **How far on hierarchy** — just rename folders (`canvas→stage`, `driver→capture`) [recommended now], or also split `sidebar/` into `layout/`+`inspector/`+`research/` [opt, more churn]?

Once locked: I'll finalize this file as the convention, then execute in waves by area (Stage → Capture → Bars/Panels → inspector moves → lib → domain symbols), with `tsc` + tests green between each.
