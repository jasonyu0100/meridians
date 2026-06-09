# Meridians — File Tree

> **Generated** by `scripts/gen-tree.mjs` — structure is read from the filesystem and each file's description is derived from its own leading comment (else a name-based heuristic). No hand-maintained map; re-run after adding files: `node scripts/gen-tree.mjs`. Companion to [MERMAID.md](MERMAID.md). Stack: Next.js 16 · React 19 · TypeScript · Tailwind v4 · D3 · IndexedDB.
>
> 512 files · 504 described from their own header comment, the rest from filename heuristics.

```xml
<repo name="meridians">
  <docs>
    <file name="README.md" desc="project readme"/>
    <file name="CLAUDE.md" desc="project instructions + engine concepts"/>
    <file name="MERMAID.md" desc="whole-app connection diagrams (top-down)"/>
    <file name="TREE.md" desc="this file — generated XML file-structure map"/>
    <file name="CONCEPT.md" desc="Conviction — the rehearsal card game spec (ROADMAP A4)"/>
    <file name="LANGUAGE.md" desc="canonical glossary / vocabulary"/>
    <file name="DEFINITIONS.md" desc="game-theory + technical taxonomy definitions"/>
    <file name="NAMING.md" desc="naming convention + rename plan"/>
  </docs>
  <dir name="src">
    <dir name="__tests__">
      <dir name="fixtures">
        <file name="test-embeddings.ts" desc="Real OpenAI embeddings for test fixtures"/>
      </dir>
      <file name="ai-context.test.ts" desc="Tests for lib/ai/context — LLM context building: state-at-index, story-settings block, tier classification"/>
      <file name="ai-diagnose.test.ts" desc="Tests for lib/ai/diagnose — error pattern-matcher driving the Repair / Retry diagnostics"/>
      <file name="ai-errors.test.ts" desc="Tests for lib/ai/errors — FatalApiError subclass and isFatalStatus status-code classification"/>
      <file name="ai-interviews.test.ts" desc="Tests for lib/ai/interviews — single-subject interview question coercion and subject resolution"/>
      <file name="ai-json.test.ts" desc="Tests for lib/ai/json — JSON parsing and deterministic repair (cleanJson, unquoted/unescaped fixes, parseJson)"/>
      <file name="ai-prompts.test.ts" desc="Critical prompt invariants"/>
      <file name="ai-prose.test.ts" desc="Tests for lib/ai/prose — rewriteSceneProse critique-guided prose rewriting (AI deps mocked)"/>
      <file name="ai-reasoning-graph.test.ts" desc="Tests for lib/ai/reasoning-graph — buildSequentialPath cross-arc graph rendering and divergence directives"/>
      <file name="ai-reconstruct.test.ts" desc="Tests for lib/ai/reconstruct — reconstructBranch versioned branch rebuild from review verdicts (AI deps…"/>
      <file name="ai-repair.test.ts" desc="Tests for lib/ai/repair — repairJsonOutput LLM-assisted JSON fix with per-caller schema specs (callGenerate…"/>
      <file name="ai-review.test.ts" desc="Tests for lib/ai/review — branch evaluation (reviewBranch / prose / plan quality) producing per-scene verdicts"/>
      <file name="ai-scenes.test.ts" desc="Tests for lib/ai/scenes — scene-structure generation with deltas, paced by Markov sequence"/>
      <file name="ai-surveys.test.ts" desc="Tests for lib/ai/surveys — survey prompt building, proposal coercion, and response parsing"/>
      <file name="ai-validation.test.ts" desc="Tests for lib/ai/validation — beat-plan/prose-map/extraction/system-delta validators and retryWithValidation"/>
      <file name="ai-world-generation.test.ts" desc="Tests for lib/ai/world — world generation/expansion (generateNarrative, expandWorld) with the AI layer mocked"/>
      <file name="analysis-runner.test.ts" desc="Tests for the analysis runner — scene-first text-to-narrative extraction pipeline (analysis deps mocked)"/>
      <file name="api-logger.test.ts" desc="Tests for lib/api-logger — API call logging, subscriptions, and narrative-scoped token tracking"/>
      <file name="asset-manager.test.ts" desc="AssetManager Tests Tests for IndexedDB-based asset storage (embeddings, images, audio)"/>
      <file name="attribution.test.ts" desc="Tests for attribution derivation — scene/expansion attribution nodes and edges from deltas"/>
      <file name="auto-engine.test.ts" desc="Tests for lib/auto-engine — automated generation: force-mode derivation, directive building, end conditions"/>
      <file name="beat-profiles.test.ts" desc="Tests for lib/beat-profiles — beat Markov matrices, profile presets, and beat-sequence sampling"/>
      <file name="beat-prose-map.test.ts" desc="Tests for buildBeatProseMapFromCounts (lib/ai/scenes) — mapping beat counts to prose-section assignments"/>
      <file name="branch-chat-context.test.ts" desc="Tests for lib/ai/branch-chat — buildBranchChatContext assembling chat context from branch state"/>
      <file name="branch-scope-control.test.ts" desc="Tests for branch scope control — resolveScopes and default scope state over branch sequence info"/>
      <file name="branch-tree.test.ts" desc="Tests for branch-tree — entry origins, parent resolution, and layout of the git-like branch tree"/>
      <file name="build-grid.test.ts" desc="Tests for buildGrid (components/generation/BranchModal) — laying branches into the BranchModal grid"/>
      <file name="constants.test.ts" desc="Tests for lib/constants — validates tunable config values, model ids, timeouts, and concurrency limits"/>
      <file name="core-language.test.ts" desc="Core-language guard. Enforces the canonical vocabulary documented in src/lib/prompts/CORE_LANGUAGE.md. These…"/>
      <file name="curriculum-restructure.test.ts" desc="Tests for the curriculum-restructure sanitiser — the id-stable, cross-branch"/>
      <file name="embeddings.test.ts" desc="Embedding System Integration Tests Tests cover: 1"/>
      <file name="entity-ref.test.ts" desc="Tests for entity-ref — bracketed entity citations in chat / search, including"/>
      <file name="epub-export.test.ts" desc="Tests for lib/io/epub-export — verifies EPUB export output, filename derivation, and browser API usage"/>
      <file name="file-conversion.test.ts" desc="file-conversion tests — focused on the pure pieces of the Apply pipeline that don't depend on the LLM: 1"/>
      <file name="game-theory-tags.test.ts" desc="Behavioural-tag classifier coverage for the Game Theory Dashboard"/>
      <file name="game-theory.test.ts" desc="Tests for lib/game-theory — Nash equilibria, margin scoring, ELO updates, and rating trajectories"/>
      <file name="graph-export.test.ts" desc="Tests for lib/io/graph-export — graph view export, mode labels, and exportable-mode detection"/>
      <file name="graph-utils.test.ts" desc="Tests for graph utils — graph/overview data building, character positions, grouping, and color/size scales"/>
      <file name="learning-coverage.test.ts" desc="Learning coverage + curriculum tests"/>
      <file name="mechanism-profiles.test.ts" desc="Tests for mechanism profile system"/>
      <file name="merges.test.ts" desc="Tests for lib/merges — branch-scoped visibility (ownership model),"/>
      <file name="narrative-utils.test.ts" desc="Tests for lib/narrative-utils — force snapshots, swing, archetype/shape/scale classification, and cube logic"/>
      <file name="network-graph.test.ts" desc="Tests for lib/graph/network-graph — aggregate connection graph, tier/topology classification, and summaries"/>
      <file name="pacing-markov.test.ts" desc="Tests for lib/pacing/pacing-markov — transition matrices, sequence sampling, presets, and pacing prompts"/>
      <file name="package-export-import.test.ts" desc="Package Export/Import Tests Tests for .meridians ZIP package export and import"/>
      <file name="paradigm-system.test.ts" desc="Paradigm system + today's hardening work"/>
      <file name="portfolio-analytics.test.ts" desc="Tests for lib/analysis/portfolio-analytics — thread portfolio snapshots, rows, trajectories, and focus ids"/>
      <file name="positions.test.ts" desc="Tests for lib/forces/positions — participation-derived cumulative entity locations across scenes"/>
      <file name="proposition-classify.test.ts" desc="Proposition Classification Tests Tests the core classification logic: - Percentile and median computation -…"/>
      <file name="room-ui.test.ts" desc="Tests for the pure helpers in components/stage/RoomUI — id-minting"/>
      <file name="scenarios-engine.test.ts" desc="Tests for lib/scenarios/scenarios-engine — scenario direction building, virtual state, and variable stamping"/>
      <file name="scenarios-remap.test.ts" desc="Tests for lib/scenarios/scenarios-remap — ID remapping of scenario commits to avoid collisions on merge"/>
      <file name="scene-filter.test.ts" desc="Tests for lib/graph/scene-filter — entity/world-node/relationship/thread visibility resolved at a given scene"/>
      <file name="search-synthesis.test.ts" desc="Search Synthesis Tests Both search modes answer in academic prose and attribute to database entities in the…"/>
      <file name="search.test.ts" desc="Semantic Search Tests Tests the core search functionality including: - Query embedding generation -…"/>
      <file name="sentence-tokenization.test.ts" desc="Tests for sentence tokenization — splitting prose into sentences while respecting abbreviations"/>
      <file name="setup.ts" desc="Setup file for Vitest tests"/>
      <file name="slides-data.test.ts" desc="Tests for lib/slides-data — computing slide deck data from narrative state"/>
      <file name="store.test.ts" desc="Tests for lib/store reducer — state transitions over narratives, scenes, branches, and prose/plan versions"/>
      <file name="stream-stance.test.ts" desc="Tests for lib/forces/stream-stance — the Vision belief engine"/>
      <file name="streams-ai.test.ts" desc="Tests for lib/ai/streams — the Vision AI helpers' parsing/normalisation/"/>
      <file name="system-graph.test.ts" desc="Tests for lib/graph/system-graph — system delta sanitizing/application, edge keys, and concept id resolution"/>
      <file name="system-logger.test.ts" desc="Tests for lib/core/system-logger — error/warning log entries, subscription callbacks, and narrative scoping"/>
      <file name="text-analysis.test.ts" desc="Tests for lib/text-analysis — corpus chunking and extraction pipeline (with mocked AI calls and constants)"/>
      <file name="thread-category.test.ts" desc="Tests for lib/forces/thread-category — thread category thresholds, logit energy, and volatile/developing…"/>
      <file name="thread-log.test.ts" desc="Tests for lib/forces/thread-log — applying thread deltas to stances, stance decay, and stance/log invariants"/>
      <file name="time-deltas.test.ts" desc="Tests for lib/forces/time-deltas — time-delta normalization, scene offsets, gap descriptions, and formatting"/>
      <file name="variables-context.test.ts" desc="Tests for lib/ai/variables — variables context block rendering and inheritance of prior-arc Present…"/>
      <file name="versioning.test.ts" desc="Tests for prose/plan versioning — resolving the prose/plan version each branch sees via lineage"/>
    </dir>
    <dir name="app">
      <dir name="analysis">
        <file name="page.tsx" desc="/analysis — text-analysis dashboard for kind: 'create' jobs (the runs that seed new worlds)"/>
      </dir>
      <dir name="api">
        <dir name="chat">
          <file name="route.ts" desc="POST /api/chat — proxy to OpenRouter for character/entity chat completions"/>
        </dir>
        <dir name="embeddings">
          <file name="route.ts" desc="POST /api/embeddings — proxy to OpenAI text-embedding-3-small for vector embeddings"/>
        </dir>
        <dir name="generate">
          <file name="route.ts" desc="POST /api/generate — proxy to OpenRouter for LLM generation (streaming + non-streaming)"/>
        </dir>
        <dir name="generate-audio">
          <file name="route.ts" desc="POST /api/generate-audio — proxy to OpenAI TTS, chunking long text into speech audio"/>
        </dir>
        <dir name="generate-cover">
          <file name="route.ts" desc="POST /api/generate-cover — proxy to Replicate (Seedream) for story cover image generation"/>
        </dir>
        <dir name="generate-image">
          <file name="route.ts" desc="POST /api/generate-image — proxy to OpenRouter (prompt) + Replicate (Seedream) for map/region images"/>
        </dir>
      </dir>
      <dir name="case-analysis">
        <file name="page.tsx" desc="Case Analysis page — loads a seed work and plays it through the SlidesPlayer walkthrough"/>
      </dir>
      <dir name="dashboard">
        <file name="page.tsx" desc="Dashboard page — story library + new-analysis entry point with creation wizard and API-key gating"/>
      </dir>
      <dir name="extensions">
        <dir name="[id]">
          <file name="page.tsx" desc="/extensions/[id] — per-narrative extension-job viewer"/>
        </dir>
        <file name="page.tsx" desc="/extensions — viewer for world-scoped file-conversion jobs"/>
      </dir>
      <dir name="manifesto">
        <file name="page.tsx" desc="Manifesto page — long-form vision/theory: forces, formulas, validation, GTM, with LaTeX + D3 visuals"/>
      </dir>
      <dir name="narrative">
        <dir name="[id]">
          <file name="page.tsx" desc="Narrative editor page — main story workspace: stage, timeline, inspector, generation, auto/bulk play"/>
        </dir>
      </dir>
      <file name="layout.tsx" desc="Root layout — fonts, global providers, landing topbar, and Vercel analytics"/>
      <file name="page.tsx" desc="Landing / home page — hero, seed-work showcase, creation wizard, mobile-aware layout"/>
      <file name="providers.tsx" desc="Providers — composes Store, Theme, Wizard, and narrative-scoped Logs context providers"/>
    </dir>
    <dir name="components">
      <dir name="analysis">
        <file name="AnalysisShell.tsx" desc="AnalysisShell — workspace shell for the text-to-narrative extraction pipeline (upload, chunk, analyze, review)"/>
      </dir>
      <dir name="analytics">
        <file name="CastAnalytics.tsx" desc="CastAnalytics — per-entity participation and development analytics across the cast"/>
        <file name="ForceAnalytics.tsx" desc="ForceAnalytics — D3 charts analysing Fate/World/System force activity across the timeline"/>
      </dir>
      <dir name="apilogs">
        <file name="ApiLogsViewer.tsx" desc="ApiLogsViewer — live API call log table with cost/token tallies and pending-call indicators"/>
        <file name="ErrorDiagnosis.tsx" desc="ErrorDiagnosis — renders a generation error as severity dot + summary + suggestion, with copy-trace button"/>
      </dir>
      <dir name="auto">
        <file name="AutoSettingsPanel.tsx" desc="AutoSettingsPanel — settings UI for the auto-generation engine (direction, constraints, pacing)"/>
      </dir>
      <dir name="capture">
        <file name="CapturePalette.tsx" desc="CapturePalette — floating bottom-center dock for the Queue sub-tab"/>
        <file name="CaptureView.tsx" desc="CaptureView — daily-ingest workspace rendered as a canvas mode"/>
        <file name="CompactPreviewModal.tsx" desc="CompactPreviewModal — runs synthesis on the selected queue entries and lets the operator review / edit the…"/>
      </dir>
      <dir name="cards">
        <file name="StoryCard.tsx" desc="StoryCard — series picker tile rendering a narrative's cover, title, and quick stats"/>
      </dir>
      <dir name="effects">
        <file name="StarField.tsx" desc="StarField — canvas-rendered animated twinkling starfield background effect"/>
      </dir>
      <dir name="generation">
        <file name="BranchChat.tsx" desc="BranchChat — conversational interface for querying and steering a branch's timeline"/>
        <file name="BranchModal.tsx" desc="BranchModal — modal for creating and managing story timeline branches"/>
        <file name="BranchScopeControl.tsx" desc="BranchScopeControl — picker for the context scope (time horizon) a branch operation sees"/>
        <file name="CoordinationPlanIndicator.tsx" desc="CoordinationPlanIndicator — compact badge showing the active coordination plan on a branch"/>
        <file name="CoordinationPlanModal.tsx" desc="CoordinationPlanModal — view and regenerate a branch's coordination plan"/>
        <file name="CoordinationPlanSetupModal.tsx" desc="CoordinationPlanSetupModal — configure thinking style/resources and generate a coordination plan"/>
        <file name="GeneratePanel.tsx" desc="GeneratePanel — main scene/arc generation controls with expand-world and error-repair surfacing"/>
        <file name="GuidanceFields.tsx" desc="GuidanceFields — direction/constraint input fields with AI direction suggestion"/>
        <file name="MarkovGraph.tsx" desc="MarkovGraph — visualises the cube-mode Markov transition matrix driving pacing"/>
        <file name="PacingStrip.tsx" desc="PacingStrip — horizontal strip showing the sampled cube-mode pacing sequence for an arc"/>
        <file name="ReasoningGraphModal.tsx" desc="ReasoningGraphModal — view and regenerate an arc's causal reasoning graph (CRG)"/>
        <file name="ReasoningStream.tsx" desc="ReasoningStream — reasoning display primitives (inline + collapsible) shared by BranchChat and ChatPanel"/>
        <file name="RunBar.tsx" desc="RunBar — controls and status for an in-progress scenarios/generation run"/>
        <file name="ThinkingAnimation.tsx" desc="ThinkingAnimation — D3 visualisation of the four thinking modes (collection → objective → building)"/>
        <file name="ThinkingPicker.tsx" desc="ThinkingPicker — selector for thinking mode/style and resources, with live ThinkingAnimation preview"/>
      </dir>
      <dir name="icons">
        <file name="ActionIcons.tsx" desc="Action icons — edit, delete, close, send, refresh, fork, import/export, share, rename"/>
        <file name="ContentIcons.tsx" desc="Content icons — document, book, notepad, image, eye, location, people, question, dollar, settings, dice"/>
        <file name="EvalIcons.tsx" desc="Evaluation verdict &amp; status icons — used in BranchEval, PlanEval, ProseEval"/>
        <file name="index.ts" desc="Icon barrel — re-exports the icon set"/>
        <file name="MediaIcons.tsx" desc="Media control icons — play, pause, stop"/>
        <file name="NavigationIcons.tsx" desc="Navigation icons — chevrons, arrows, home, expand"/>
        <file name="StatusIcons.tsx" desc="Status icons — spinner, warning, checkmark (standalone)"/>
      </dir>
      <dir name="inspector">
        <file name="ArcDetail.tsx" desc="ArcDetail — inspector view for an arc: force snapshots, activity curve, and current narrative position"/>
        <file name="ArtifactDetail.tsx" desc="ArtifactDetail — inspector view for an artifact: significance, provenance world graph, threads, and image"/>
        <file name="AttributionsSection.tsx" desc="AttributionsSection — collapsible inspector section listing source attributions for an entity"/>
        <file name="CharacterDetail.tsx" desc="CharacterDetail — inspector view for a character: role, inner world graph, threads, and image"/>
        <file name="ChatPanel.tsx" desc="ChatPanel — in-character chat with an entity, grounded in its world-graph continuity"/>
        <file name="CollapsibleSection.tsx" desc="CollapsibleSection — reusable expand/collapse inspector section with optional paginated item list"/>
        <file name="CompassPanel.tsx" desc="CompassPanel — inspector surface for an arc's Present/Future variable scenarios (the Compass)"/>
        <file name="EmptyState.tsx" desc="EmptyState — placeholder shown in the inspector when no entity is selected"/>
        <file name="FilesPanel.tsx" desc="FilesPanel — sidebar list of source files that contributed to this narrative"/>
        <file name="ImagePromptEditor.tsx" desc="ImagePromptEditor — inline editor for an entity's image prompt with AI suggestion"/>
        <file name="InlineEdit.tsx" desc="InlineEdit — inline click-to-edit primitives for the inspector"/>
        <file name="InspectorPanel.tsx" desc="InspectorPanel — right-side inspector shell routing selected entities to their detail/research views"/>
        <file name="KnowledgeDetail.tsx" desc="KnowledgeDetail — inspector view for a system knowledge-graph node: content, type, and edges"/>
        <file name="KnowledgePanel.tsx" desc="KnowledgePanel — ranked directory of system-graph nodes"/>
        <file name="LocationDetail.tsx" desc="LocationDetail — inspector view for a location: prominence, accumulated history graph, threads, and image"/>
        <file name="MediaField.tsx" desc="MediaField — display + upload + clear for a single entity/board image"/>
        <file name="MergeDetail.tsx" desc="MergeDetail — inspector view for a merge: the war-room commit that folded a"/>
        <file name="PhaseNodeDetail.tsx" desc="PhaseNodeDetail — inspector for a single Phase Reasoning Graph (PRG) node"/>
        <file name="QuestionDetail.tsx" desc="QuestionDetail — inspector view for one learning question: stem, options"/>
        <file name="ReasoningNodeDetail.tsx" desc="ReasoningNodeDetail — inspector view for a CRG node: type, content, tier, and typed edges"/>
        <file name="SceneDetail.tsx" desc="SceneDetail — inspector view for a scene: forces, cube mode, participants, and structural deltas"/>
        <file name="StreamDetail.tsx" desc="StreamDetail — inspector view for a stream: stance across outcomes, belief"/>
        <file name="StreamPriorDetail.tsx" desc="StreamPriorDetail — inspector view for a single stream prior: perceptual"/>
        <file name="ThreadDetail.tsx" desc="ThreadDetail — inspector view for a thread: stance across outcomes, lifecycle status, and delta log"/>
        <file name="ThreadLogNodeDetail.tsx" desc="ThreadLogNodeDetail — inspector view for a single thread-log node: perceptual primitive, evidence, and…"/>
        <file name="ThreadsPanel.tsx" desc="ThreadsPanel — sidebar pane mirroring SurveyPanel / MapPanel shape: top bar with a count, then a stream of…"/>
        <file name="TopicDetail.tsx" desc="TopicDetail — inspector view for one curriculum Topic: rename, describe,"/>
        <file name="WorldNodeDetail.tsx" desc="WorldNodeDetail — inspector view for an entity world-graph node: content, type, and edges"/>
      </dir>
      <dir name="landing">
        <file name="LandingTopbar.tsx" desc="LandingTopbar — top navigation bar for the public landing/marketing pages"/>
      </dir>
      <dir name="layout">
        <file name="AppShell.tsx" desc="AppShell — top-level app frame: TopBar, starfield background, and main content slot"/>
        <file name="DrivePanel.tsx" desc="Left sidebar — image/media management only (Drive)"/>
        <file name="ProseProfilePanel.tsx" desc="ProseProfilePanel — modal showing the narrative's prose profile: voice, beat Markov chains, mechanism mix"/>
      </dir>
      <dir name="narratives">
        <file name="NarrativesScreen.tsx" desc="NarrativesScreen — library screen listing saved narratives with the new-story wizard entry"/>
      </dir>
      <dir name="report">
        <file name="NarrativeReport.tsx" desc="NarrativeReport — AI-generated analytical report over the narrative's propositions and structure"/>
      </dir>
      <dir name="scenarios">
        <file name="ScenarioAnalytics.tsx" desc="Shared analytics + visualisation primitives for scenarios branches, ported from the legacy MCTS inspector"/>
        <file name="ScenariosBar.tsx" desc="ScenariosBar — compact status/control bar for an in-flight Branch Scenarios parallel run"/>
        <file name="ScenariosPanel.tsx" desc="ScenariosPanel — multi-scenario parallel branch generation UI with per-run Retry / Repair / Copy diagnostics"/>
      </dir>
      <dir name="settings">
        <file name="StorySettingsModal.tsx" desc="StorySettingsModal — edit per-story settings: POV, world focus, reasoning/websearch levels, prose format"/>
      </dir>
      <dir name="shared">
        <file name="charts.tsx" desc="Shared chart primitives — the single source of truth for the app's inline line charts"/>
        <file name="CopyButton.tsx" desc="CopyButton — button that copies text to the clipboard with transient confirmation state"/>
        <file name="EmptyState.tsx" desc="EmptyState — the universal &quot;nothing here yet&quot; placeholder for stage tabs"/>
        <file name="InferenceFields.tsx" desc="Shared inference-shape renderer — the canonical visual language for the universal inference-shape (detail…"/>
      </dir>
      <dir name="sidebar">
        <dir name="maps">
          <file name="MapComposerModal.tsx" desc="MapComposerModal — modal for composing and generating a board/map image for a location subtree"/>
        </dir>
        <dir name="surveys">
          <file name="CategoryPicker.tsx" desc="CategoryPicker — selector for the eight research-lens categories used by surveys and interviews"/>
          <file name="CopyButton.tsx" desc="Thin re-export — the canonical CopyButton now lives in components/shared"/>
          <file name="InterviewComposerModal.tsx" desc="InterviewComposerModal — modal for composing a single-subject interview (subject, category, questions)"/>
          <file name="InterviewDetailModal.tsx" desc="InterviewDetailModal — modal displaying a completed interview's question-by-question responses"/>
          <file name="SurveyComposerModal.tsx" desc="SurveyComposerModal — modal for composing a survey (question, type, category, respondent filters)"/>
          <file name="SurveyDetailModal.tsx" desc="SurveyDetailModal — modal displaying a completed survey's aggregated response distribution"/>
          <file name="SurveyResults.tsx" desc="SurveyResults — renders a survey's response distribution as charts/tables by question type"/>
        </dir>
        <file name="ApplyExtensionModal.tsx" desc="ApplyExtensionModal — two-phase Apply UI for an extension file"/>
        <file name="BoardAnnotator.tsx" desc="BoardAnnotator — overlays HTML labels/annotations onto a generated board/map image"/>
        <file name="FileComposerModal.tsx" desc="FileComposerModal — two-phase composer for extending the current world"/>
        <file name="HierarchyModal.tsx" desc="HierarchyModal — edit the location hierarchy (the map tree) of nested places"/>
        <file name="InterviewPanel.tsx" desc="InterviewPanel — sidebar panel for running and browsing one-subject-many-questions interviews"/>
        <file name="LearningPanel.tsx" desc="LearningPanel — sidebar surface for a member's coverage of the world view's"/>
        <file name="MapPanel.tsx" desc="MapPanel — sidebar panel listing generated board/maps and launching the map composer"/>
        <file name="MediaDrive.tsx" desc="MediaDrive — sidebar gallery of generated images and media assets for the narrative"/>
        <file name="MediaPreview.tsx" desc="MediaPreview — full-screen portal lightbox for previewing a media asset"/>
        <file name="NarrativeRail.tsx" desc="NarrativeRail — left vertical rail navigating between narrative views and tools"/>
        <file name="SourceFileModal.tsx" desc="SourceFileModal — full-source-text viewer for a SourceFile"/>
        <file name="SurveyPanel.tsx" desc="SurveyPanel — sidebar panel for running and browsing one-question-many-respondents surveys"/>
      </dir>
      <dir name="slides">
        <file name="BeatProfileSlide.tsx" desc="BeatProfile slide — shows the work's beat-function distribution and Markov transition profile"/>
        <file name="BeliefSystemSlide.tsx" desc="BeliefSystem slide — shows the work's belief system as thread stances priced across their outcomes"/>
        <file name="CastSlide.tsx" desc="Cast slide — shows the narrative's principal characters by role and prominence"/>
        <file name="ClosingSlide.tsx" desc="Closing slide — final deck slide with summary takeaway and call-to-action link"/>
        <file name="ForceDecompositionSlide.tsx" desc="ForceDecomposition slide — D3 breakdown of Fate/World/System contributions across the work"/>
        <file name="ForcesOverviewSlide.tsx" desc="ForcesOverview slide — D3 overview of the three force curves (Fate/World/System) over the work"/>
        <file name="KeyMomentsSlide.tsx" desc="KeyMoments slide — highlights the work's peak-activity scenes on a D3 timeline"/>
        <file name="KnowledgeStructureSlide.tsx" desc="KnowledgeStructure slide — shows the system knowledge graph's node-type composition and density"/>
        <file name="MechanismSlide.tsx" desc="Mechanism slide — shows the prose delivery-mechanism distribution (dialogue, thought, action, etc.)"/>
        <file name="PacingProfileSlide.tsx" desc="PacingProfile slide — shows the work's scene-mode pacing fingerprint via cube-corner transitions"/>
        <file name="ParadigmLensSlide.tsx" desc="ParadigmLens slide — D3 view framing the work through its dominant-force paradigm (Classic/Show/Paper/Opus)"/>
        <file name="PropositionOverviewSlide.tsx" desc="PropositionOverview slide — shows the work's embedded propositions classified by profile/category"/>
        <file name="ReportCardSlide.tsx" desc="ReportCard slide — graded force scorecard (Fate/World/System grades against the calibration curve)"/>
        <file name="SegmentSlide.tsx" desc="Segment slide — D3 view of one narrative segment's force profile and key beats"/>
        <file name="ShapeSlide.tsx" desc="Shape slide — D3 rendering of the work's overall narrative shape (activity arc across scenes)"/>
        <file name="SlideShell.tsx" desc="SlideShell — shared layout wrapper providing title/subtitle chrome for every Review deck slide"/>
        <file name="SlidesPlayer.tsx" desc="SlidesPlayer — Review deck driver: computes slides data and steps through the slide sequence"/>
        <file name="SwingAnalysisSlide.tsx" desc="SwingAnalysis slide — D3 view of scene-to-scene force contrast (breathing vs flatline dynamics)"/>
        <file name="ThreadLifecycleSlide.tsx" desc="ThreadLifecycle slide — shows thread arcs from setup through escalation to payoff/closure, coloured by logType"/>
        <file name="TimeFlowSlide.tsx" desc="TimeFlow slide — D3 view of how narrative time flows across scenes (chronology, jumps, pacing)"/>
        <file name="TitleSlide.tsx" desc="Title slide — opening deck slide with the work's title, byline, and D3 hero visual"/>
      </dir>
      <dir name="stage">
        <dir name="variables">
          <file name="BentoTile.tsx" desc="BentoTile — layout primitive: a bento-grid tile with optional sticky header for the variables surface"/>
          <file name="DashboardChrome.tsx" desc="Shared chrome elements that align Variables with the Dashboard (Market) visual rhythm — uppercase section…"/>
          <file name="DispositionEditor.tsx" desc="DispositionEditor — editing rack for a scenario's variable activations (per-variable intensity levels)"/>
          <file name="MetricStrip.tsx" desc="MetricStrip — horizontal row of labelled metric values for the variables/scenario surface"/>
          <file name="ProbabilityBar.tsx" desc="ProbabilityBar — stacked bar showing the softmax cohort probabilities across planning scenarios"/>
          <file name="ScenarioCard.tsx" desc="ScenarioCard — card summarising one Future planning scenario: name, tagline, activations, and probability"/>
          <file name="VariableGridChart.tsx" desc="VariableGridChart — grid/heatmap view of variable intensities across the scenario cohort"/>
          <file name="VariableParallelCoords.tsx" desc="VariableParallelCoords — parallel-coordinates plot of scenarios as paths across the shared variable pool"/>
          <file name="VariableRadarChart.tsx" desc="VariableRadarChart — radar/spider chart plotting variable intensities for one or more scenarios"/>
          <file name="VariableViewSwitcher.tsx" desc="VariableViewSwitcher — toggle control choosing the variables visualisation mode (radar / parallel / grid)"/>
        </dir>
        <file name="AudioMiniPlayer.tsx" desc="AudioMiniPlayer — compact persistent audio playback control for generated scene narration"/>
        <file name="BeliefView.tsx" desc="Belief dashboard — the world view's belief, built from per-thread stances"/>
        <file name="BoardView.tsx" desc="BoardView — Stage board surface: board-game style map with nested location maps and participant avatars"/>
        <file name="CompassView.tsx" desc="CompassView — Stage Compass surface: arc Present + Future variable scenarios (the softmax-ranked cohort)"/>
        <file name="CurriculumRestructureModal.tsx" desc="CurriculumRestructureModal — reorganise the global topic tree with AI"/>
        <file name="CurriculumView.tsx" desc="CurriculumView — the world view's Topic tree as a horizontal, collapsible mind-map"/>
        <file name="DecisionView.tsx" desc="DecisionView — scene-level game-theoretic analysis"/>
        <file name="graph-utils.ts" desc="graph-utils — shared helpers for Stage graph surfaces: node/edge derivation, colors, and layout utilities"/>
        <file name="MergesView.tsx" desc="MergesView — the Vision &quot;History&quot; tab"/>
        <file name="NetworkView.tsx" desc="NetworkView — Stage Network surface: aggregate connection graph across all entities, rendered with D3"/>
        <file name="PhaseGraphView.tsx" desc="Phase Reasoning Graph (PRG) view — renders a phase graph with the same dagre construction as the Causal…"/>
        <file name="PlanCandidatesModal.tsx" desc="PlanCandidatesModal — modal wrapper hosting PlanCandidatesView for picking among generated scene-plan…"/>
        <file name="PlanCandidatesView.tsx" desc="PlanCandidatesView — side-by-side comparison and selection UI for alternative generated scene-plan candidates"/>
        <file name="ReasoningGraphView.tsx" desc="ReasoningGraphView — Stage surface rendering an arc's causal reasoning graph (CRG) nodes and typed edges"/>
        <file name="RoomUI.tsx" desc="RoomUI — presentation primitives shared by the room/perspective surfaces"/>
        <file name="SceneAudioView.tsx" desc="SceneAudioView — Stage surface for generating and playing back audio narration of a scene's prose"/>
        <file name="SceneBar.tsx" desc="SceneBar — horizontal scene navigator strip for the Stage; selects and scrolls through the branch's scenes"/>
        <file name="SceneLearningView.tsx" desc="SceneLearningView — scene-level learning question bank"/>
        <file name="ScenePanel.tsx" desc="ScenePanel — Stage scene detail container: header, POV/location, and the plan/prose/audio sub-views for a…"/>
        <file name="ScenePlanView.tsx" desc="ScenePlanView — Stage surface showing a scene's beat-by-beat plan with generate/rewrite/reverse-engineer…"/>
        <file name="SceneProseView.tsx" desc="SceneProseView — Stage surface rendering a scene's prose with generate/rewrite controls and version history"/>
        <file name="SearchView.tsx" desc="SearchView — Stage search surface"/>
        <file name="Stage.tsx" desc="Stage — center-view workspace shell that routes between the active Stage surfaces (board, graphs, scene, etc.)"/>
        <file name="StageBar.tsx" desc="StageBar — top toolbar for the Stage: switches the active center-view surface and exposes per-surface actions"/>
        <file name="StagePalette.tsx" desc="StagePalette — command-palette / picker for selecting which Stage center-view surface to display"/>
        <file name="StreamBeliefView.tsx" desc="Stream belief dashboard — the Stream surface of Mind → Belief, mirroring the Thread dashboard ([BeliefView])…"/>
        <file name="StreamsView.tsx" desc="StreamsView — the Perspectives &quot;Streams&quot; tab"/>
        <file name="SystemGraphView.tsx" desc="SystemGraphView — Stage surface visualising the system knowledge graph (laws, systems, concepts, tensions)…"/>
        <file name="ThreadGraphView.tsx" desc="ThreadGraphView — Stage surface mapping threads to their participant entities as a D3 force graph"/>
        <file name="ThreadLogGraphView.tsx" desc="ThreadLogGraphView — Stage surface tracing a thread's perceptual-primitive log (stance movement) scene by…"/>
        <file name="VersionHistoryTree.tsx" desc="VersionHistoryTree — renders the semantic v1.2.3 version tree of a scene's prose/plan for selection and…"/>
        <file name="WorldGraphView.tsx" desc="WorldGraphView — Stage surface rendering an entity's inner world knowledge graph (raw graph substrate) via D3"/>
      </dir>
      <dir name="timeline">
        <file name="ActivityLineChart.tsx" desc="ActivityLineChart — D3 line chart of per-scene Activity (weighted force aggregate) over the timeline"/>
        <file name="BranchEval.tsx" desc="BranchEval — branch evaluation UI: runs reviewBranch and surfaces per-scene verdicts for reconstruction"/>
        <file name="BranchTreePopover.tsx" desc="Floating tree-shaped branch switcher, anchored off the timeline strip's branch chip"/>
        <file name="EvalBar.tsx" desc="EvalBar — timeline bar surfacing per-scene structural evaluation verdicts"/>
        <file name="ForceLineChart.tsx" desc="ForceLineChart — D3 multi-line chart of Fate/World/System force curves across the timeline"/>
        <file name="ForceTimeline.tsx" desc="ForceTimeline — scrollable scene-by-scene timeline strip with force snapshots per scene"/>
        <file name="PlanEval.tsx" desc="PlanEval — evaluates beat-plan quality via reviewPlanQuality and shows guided feedback"/>
        <file name="ProseEval.tsx" desc="ProseEval — evaluates scene prose quality via reviewProseQuality and shows guided feedback"/>
        <file name="SceneRangeSelector.tsx" desc="SceneRangeSelector — draggable selector for picking a contiguous scene range on the timeline"/>
        <file name="TimelineStrip.tsx" desc="TimelineStrip — bottom timeline: scene strip, force totals, branch switcher, and eval entry points"/>
      </dir>
      <dir name="topbar">
        <file name="AgentsModal.tsx" desc="AgentsModal — manage the room's AI players"/>
        <file name="ApiKeyModal.tsx" desc="ApiKeyModal — enter and manage user-provided API keys, gated by feature access"/>
        <file name="ApiLogsModal.tsx" desc="ApiLogsModal — modal wrapper around ApiLogsViewer with Narrative/Analysis/Misc scope selector"/>
        <file name="BeatProfileModal.tsx" desc="BeatProfileModal — visualises beat-function/mechanism distributions and Markov sampler from scene plans"/>
        <file name="BranchContextModal.tsx" desc="BranchContextModal — inspect the LLM context (narrative/scene/outline) assembled for the active branch"/>
        <file name="DefinitionsModal.tsx" desc="DefinitionsModal — glossary of core concepts: archetypes, cube corners, forces, and entity types"/>
        <file name="ExportPackageModal.tsx" desc="ExportPackageModal — configure and export the current narrative as a portable package with size estimate"/>
        <file name="FormulaModal.tsx" desc="FormulaModal — KaTeX-rendered reference of the Fate/World/System force formulas and reference means"/>
        <file name="GameTheoryDashboard.tsx" desc="GameTheoryDashboard — a focused, high-level view of the narrative's strategic structure"/>
        <file name="GasMeter.tsx" desc="GasMeter — topbar pill showing accumulated API token spend/cost from the log"/>
        <file name="ImportPackageModal.tsx" desc="ImportPackageModal — import a narrative from a package file or directory, with validation and options"/>
        <file name="LearnModal.tsx" desc="LearnModal — fullscreen quiz runner for reinforcing the concepts and ideas captured across a world view's…"/>
        <file name="MarkovChainModal.tsx" desc="MarkovChainModal — visualises the cube-mode transition matrix and pacing fingerprint of the narrative"/>
        <file name="MembersModal.tsx" desc="MembersModal — dedicated TopBar interface for editing the room's member list"/>
        <file name="NarrativeEditModal.tsx" desc="NarrativeEditModal — edit narrative meta (title, premise, cover) with AI-assisted refinement"/>
        <file name="PatternsModal.tsx" desc="PatternsModal — detect and display recurring narrative patterns under a selected paradigm"/>
        <file name="PropositionAnalysisModal.tsx" desc="PropositionAnalysisModal — classifies and visualises embedded propositions by base category and reach"/>
        <file name="RegenerateEmbeddingsModal.tsx" desc="RegenerateEmbeddingsModal — embeddings coverage dashboard"/>
        <file name="SlideRegionsModal.tsx" desc="SlideRegionsModal — configure named regions (sets of arcs) to view scoped"/>
        <file name="SystemLogModal.tsx" desc="SystemLogModal — browse the in-app system event log with filtering"/>
        <file name="ThemeModal.tsx" desc="ThemeMenu — compact dropdown to pick the app colour theme from preview"/>
        <file name="TimeFlowModal.tsx" desc="TimeFlowModal — visualises cumulative in-story time offsets and per-scene time deltas across the branch"/>
        <file name="TopBar.tsx" desc="TopBar — main workspace top bar: navigation, story controls, and entry points to the topbar modals"/>
        <file name="UsageModal.tsx" desc="UsageModal — detailed API usage breakdown: per-model token spend and cost over the log"/>
      </dir>
      <dir name="ui">
        <file name="EntityRef.tsx" desc="EntityRef — inline citation badge rendered in chat for a `[C-12]`-style annotation, academic-essay style"/>
        <file name="Markdown.tsx" desc="Markdown renderer — full CommonMark + GitHub-flavored markdown (tables, strikethrough, task lists,…"/>
        <file name="Segmented.tsx" desc="Segmented — the canonical tab / toggle / segmented-control for the app"/>
      </dir>
      <dir name="wizard">
        <file name="CreationWizard.tsx" desc="Direct sub-module imports rather than the @/lib/ai barrel"/>
      </dir>
      <file name="ArchetypeIcon.tsx" desc="ArchetypeIcon — unique SVG shape per narrative archetype, mapping force-dominance profiles to icons"/>
      <file name="CubeCornerBadge.tsx" desc="Reusable cube corner visualization badge — three colored bars for P/C/K forces"/>
      <file name="Modal.tsx" desc="Modal — reusable modal shell (header/body/streaming-status) with starfield backdrop"/>
    </dir>
    <dir name="hooks">
      <file name="useActiveMember.ts" desc="useActiveMember — the room's currently-active member"/>
      <file name="useAssetUrl.ts" desc="React hook for resolving asset references to blob URLs Handles: - ImageRef: &quot;img_abc123&quot; → blob URL,…"/>
      <file name="useAudioPlayer.tsx" desc="useAudioPlayer — manages scene TTS playback state, audio caching, and the player context"/>
      <file name="useAutoPlay.ts" desc="useAutoPlay — drives the auto-engine generation loop: evaluate state, build directives, generate arcs"/>
      <file name="useBulkAudioGenerate.ts" desc="useBulkAudioGenerate — manages parallel TTS generation across a scene range with progress tracking"/>
      <file name="useBulkEmbed.ts" desc="Bulk Embedding Hook - Manual regeneration of embeddings for scenes Use cases: - Importing old narratives…"/>
      <file name="useBulkGenerate.ts" desc="useBulkGenerate — manages parallel plan/prose/game generation across a scene range with progress"/>
      <file name="useBulkStreamPreview.ts" desc="useBulkStreamPreview — cross-scene bulk stream subscription for the plan/prose/audio scene views"/>
      <file name="useFeatureAccess.ts" desc="useFeatureAccess — reads/writes user-provided API keys (localStorage) and reports key availability"/>
      <file name="usePropositionClassification.tsx" desc="Proposition classification provider &amp; hook"/>
      <file name="useResolvedScene.ts" desc="useResolvedScene — resolves a scene's branch-specific prose/plan/score versions for the current branch"/>
      <file name="useScenarios.ts" desc="useScenarios — parallel Compass-driven branch generation"/>
    </dir>
    <dir name="lib">
      <dir name="agents">
        <file name="personas.ts" desc="Agent persona presets — the catalogue of preset personalities an Agent (AI"/>
      </dir>
      <dir name="ai">
        <dir name="reasoning-graph">
          <file name="shared.ts" desc="Shared helpers for the reasoning-graph subsystem — scale helpers and force-preference type used across every…"/>
          <file name="types.ts" desc="Type declarations for the reasoning-graph subsystem"/>
          <file name="validate.ts" desc="Reference validation for reasoning-graph nodes"/>
        </dir>
        <file name="api.ts" desc="Core LLM call layer — callGenerate / callGenerateStream against /api/generate, plus reasoning/websearch…"/>
        <file name="branch-chat.ts" desc="Branch Chat — multi-branch analytical chat"/>
        <file name="candidates.ts" desc="Plan Candidates - Generate multiple candidate plans and rank by semantic similarity Embeddings are only…"/>
        <file name="capture.ts" desc="Driver entry generation. Produces a single Driver entry ({title, text}) from a user direction prompt and,…"/>
        <file name="context.ts" desc="LLM context builders — assembles narrative/branch/scene context blocks fed into generation prompts"/>
        <file name="curriculum-restructure.ts" desc="Curriculum-restructure LLM helpers — reorganise the global topic tree into a"/>
        <file name="diagnose.ts" desc="Inspect a thrown error from a generation call and produce a user-facing diagnosis: what likely went wrong,…"/>
        <file name="errors.ts" desc="Errors raised at the LLM API boundary"/>
        <file name="game-analysis.ts" desc="Game-theoretic scene analysis — a purely additive, post-hoc layer"/>
        <file name="hierarchy.ts" desc="Location-hierarchy LLM helpers — builds the nested location/map tree with target fan-out per node"/>
        <file name="image-prompt.ts" desc="Suggest a refined imagePrompt for an entity (character, location, artifact) by reading the entity's full…"/>
        <file name="index.ts" desc="Context builders"/>
        <file name="ingest.ts" desc="Prose-profile ingestion — LLM extraction/refinement of authorial voice profiles from sample prose"/>
        <file name="interviews.ts" desc="Interview executor — ask one subject many questions in parallel using its world-graph continuity"/>
        <file name="json.ts" desc="Clean common LLM JSON quirks: code fences, trailing commas, single-quoted keys"/>
        <file name="learning.ts" desc="Learning (Quiz) generation — a purely additive, post-hoc layer"/>
        <file name="phase-graph.ts" desc="Phase generator — mines narrative context (with optional user guidance and optional seed graph) to produce a…"/>
        <file name="premise.ts" desc="Premise suggestion for the creation wizard"/>
        <file name="prompts.ts" desc="Re-export wrapper for backward compatibility"/>
        <file name="prose.ts" desc="Prose generation/rewrite — renders a scene's beat plan into formatted prose; critique-guided rewrites"/>
        <file name="reasoning-graph.ts" desc="Reasoning-graph generators — the top-level entry points that produce: - `generateReasoningGraph` — per-arc…"/>
        <file name="reconstruct.ts" desc="Branch reconstruction — applies per-scene verdicts (edit/merge/insert/cut) into a new versioned branch"/>
        <file name="repair.ts" desc="LLM-assisted JSON repair — fixes malformed generation output using the caller's own output schema spec"/>
        <file name="report.ts" desc="World-view report generation — LLM synthesis of the narrative into a structured analysis report"/>
        <file name="review.ts" desc="Branch/prose/plan review — LLM evaluation passes that produce per-scene verdicts and quality critiques"/>
        <file name="scenes.ts" desc="Scene generation — scene structures+deltas, beat plans, and plan reverse-engineering; Markov-paced"/>
        <file name="search-synthesis.ts" desc="AI Search Synthesis — proposition-primary RAG with scene-aggregate context"/>
        <file name="streams.ts" desc="Stream instantiation — AI-seeds a new stream's belief from a member's initial intuition, the same way a Fate…"/>
        <file name="surveys.ts" desc="Survey executor — query characters, locations, and artifacts in parallel using their world-graph continuity…"/>
        <file name="validation.ts" desc="Validation utilities for AI API responses Ensures LLM outputs match expected types before accepting results"/>
        <file name="variables.ts" desc="Per-arc variable generation — the Compass surfaces"/>
        <file name="world.ts" desc="World generation — full narrative bootstrap, world expansion, and post-arc direction course-correction"/>
      </dir>
      <dir name="analysis">
        <file name="analysis-runner.ts" desc="Singleton analysis runner — persists across React component mounts/unmounts"/>
        <file name="portfolio-analytics.ts" desc="Thread-portfolio analytics"/>
        <file name="proposition-classify.ts" desc="Proposition Classification Engine Classifies propositions into 4 base categories with Local/Global reach: 1"/>
        <file name="stream-portfolio.ts" desc="Stream-portfolio analytics — the HEAD-based cousin of `portfolio-analytics`"/>
        <file name="text-analysis.ts" desc="Text Analysis Pipeline — converts a large corpus (book, screenplay, etc.) into a full NarrativeState by…"/>
      </dir>
      <dir name="core">
        <file name="api-headers.ts" desc="Builds headers that include user-provided API keys from localStorage when NEXT_PUBLIC_USER_API_KEYS is enabled"/>
        <file name="api-logger.ts" desc="API call logging — records LLM requests, token usage, and cost; relays entries to listeners"/>
        <file name="resolve-api-key.ts" desc="API-key resolution — picks an API key from request header or env var per the user-keys config flag"/>
        <file name="system-logger.ts" desc="System event logging — emits info/warning/error log entries scoped per narrative/analysis to listeners"/>
      </dir>
      <dir name="forces">
        <file name="attribution.ts" desc="Attribution derivation — defensive helper that walks a scene's (or world-build's) typed structural fields…"/>
        <file name="entity-ref.ts" desc="Entity-reference resolution for chat annotations"/>
        <file name="narrative-utils.ts" desc="Force formulas + graph/cube/stance algorithms — the deterministic math deriving Fate/World/System from deltas"/>
        <file name="positions.ts" desc="Entity positions — derives each character's current location from scene participation history"/>
        <file name="stream-stance.ts" desc="Stream stance engine — a Stream is a thread"/>
        <file name="thread-category.ts" desc="Thread category classification — a single vocabulary derived from a thread's current MARKET STATE…"/>
        <file name="thread-log.ts" desc="Thread stance application"/>
        <file name="time-deltas.ts" desc="Time delta helpers. Scenes are instants; the gap between consecutive scenes is a TimeDelta ({value, unit}).…"/>
      </dir>
      <dir name="game-theory">
        <file name="game-theory-glossary.ts" desc="Plain-language tooltips for the game-theory UI"/>
        <file name="game-theory-player.ts" desc="Per-character game-theory summary — a lightweight derivation off `narrative.scenes[*].gameAnalysis.games`…"/>
        <file name="game-theory.ts" desc="Game-theoretic helpers — NxM decision-space model"/>
      </dir>
      <dir name="graph">
        <file name="graph-styling.ts" desc="Shared edge styling for d3 force graph views (NetworkView, SystemGraphView, ThreadGraphView,…"/>
        <file name="location-clusters.ts" desc="location-clusters — derive location clusters from the parent/child graph"/>
        <file name="network-graph.ts" desc="Network graph — the cumulative activation pattern across the narrative"/>
        <file name="phase-graph.ts" desc="Phase utilities — the working-model-of-reality graph that's mined from narrative context (with optional user…"/>
        <file name="reasoning-node-colors.ts" desc="Shared colour language for reasoning-graph nodes"/>
        <file name="scene-filter.ts" desc="Scene/entity filtering — resolves which entities are introduced/visible up to a given scene index"/>
        <file name="system-graph.ts" desc="System graph utilities — delta sanitization and application"/>
        <file name="world-graph.ts" desc="World graph utilities — delta application"/>
      </dir>
      <dir name="io">
        <file name="belief-export.ts" desc="Markdown exporter for the prediction-market dashboard"/>
        <file name="board-export.ts" desc="board-export — render the board/map state (location clusters) as Markdown"/>
        <file name="curriculum-export.ts" desc="curriculum-export — render a branch's Topic tree + questions as Markdown"/>
        <file name="epub-export.ts" desc="EPUB export — builds a valid EPUB archive (zip + CRC-32) from a narrative's resolved branch prose"/>
        <file name="file-conversion.ts" desc="file-conversion — world-scoped helpers for adding a source file to a narrative and (optionally) kicking off…"/>
        <file name="graph-export.ts" desc="Contextual Markdown exporters for the canvas graph views"/>
        <file name="package-export.ts" desc="Package Export - Create portable .meridians ZIP packages Combines narrative JSON + binary assets into a…"/>
        <file name="package-import.ts" desc="Package Import - Import .meridians packages Supports two formats: 1"/>
        <file name="research-export.ts" desc="Markdown formatters for surveys and interviews"/>
        <file name="scene-export.ts" desc="Markdown exporters for the currently-viewed scene plan and prose"/>
      </dir>
      <dir name="learning">
        <file name="coverage.ts" desc="Continual learning coverage — spaced-repetition recall model over the question bank"/>
        <file name="curriculum.ts" desc="Curriculum tree — operations over the Topic entities the question bank is organised under"/>
        <file name="quiz.ts" desc="Quiz aggregation + scoping helpers"/>
      </dir>
      <dir name="map">
        <file name="map-layout.ts" desc="map-layout — resolve the location subtree a map covers"/>
        <file name="map-tree-layout.ts" desc="map-tree-layout — arrange annotated territory maps as a top-down tree of image &quot;boards&quot; for the World-graph…"/>
      </dir>
      <dir name="pacing">
        <file name="beat-profiles.ts" desc="Beat profile system — Markov chains for prose plan generation"/>
        <file name="mechanism-profiles.ts" desc="Mechanism profile system — prose delivery mechanism distributions"/>
        <file name="pacing-markov.ts" desc="Markov chain sequence generation for narrative pacing"/>
        <file name="pacing-profiles.ts" desc="Pacing profile system — transition matrices for narrative pacing"/>
      </dir>
      <dir name="prompts">
        <dir name="analysis">
          <file name="arcs.ts" desc="Arc Grouping Prompt For each arc (a narrative unit of ~4 scenes), name it and emit two metadata fields…"/>
          <file name="coalesce-outcomes.ts" desc="Outcome Coalescing Prompt Phase 3c — per-thread outcome canonicalisation"/>
          <file name="fate-reextract.ts" desc="Fate Re-Extraction Prompt Phase 5 (finalization) — second-pass, summary-based re-scoring of prediction-…"/>
          <file name="index.ts" desc="Analysis Prompts — corpus → narrative-state extraction pipeline"/>
          <file name="meta.ts" desc="Meta extraction prompt — runs at the end of corpus analysis to derive the narrative's image style, prose…"/>
          <file name="priors-synthesis.ts" desc="Driver Synthesis Prompt Operator queues raw fragments — pasted briefings, links with quoted excerpts,…"/>
          <file name="reconcile-entities.ts" desc="Entity Reconciliation Prompt Phase 3a — aggressive merging of name-variant entities (characters, locations,…"/>
          <file name="reconcile-semantic.ts" desc="Semantic Reconciliation Prompt Phase 3b — nuanced merging of threads and system knowledge concepts"/>
          <file name="scene-structure.ts" desc="Scene Structure Extraction Prompts The scene-level extraction step that converts raw prose + beat plan into…"/>
          <file name="thread-integration.ts" desc="Thread Integration Prompt (Daily-Driver only) The thread-integration pass is the heart of &quot;make the file…"/>
          <file name="threading.ts" desc="Thread Dependency Analysis Prompt Given a canonical (post-merge) list of threads, identifies which threads…"/>
        </dir>
        <dir name="calibration">
          <file name="index.ts" desc="Calibration primitives — single source of truth for the numeric scales and reasoning shapes the engine…"/>
          <file name="inference-shape.ts" desc="INFERENCE-SHAPE — the universal 5-field discipline"/>
          <file name="intensity.ts" desc="INTENSITY — the 0–4 variable-magnitude scale"/>
          <file name="prior-logit.ts" desc="PRIOR-LOGIT — the [-4, +4] log-odds scale"/>
        </dir>
        <dir name="chat">
          <file name="contexts.ts" desc="Chat context-mode prompts — the system prompts for the six contextModes (scene / outline / narrative /…"/>
          <file name="discipline.ts" desc="Shared output-discipline rule appended to every chat context prompt"/>
          <file name="index.ts" desc="Chat prompt builders — system prompts for the chat sidebar"/>
          <file name="personas.ts" desc="Chat persona prompts — in-character system prompts for the three force-personas (Fate / System / World) and…"/>
        </dir>
        <dir name="core">
          <file name="beat-taxonomy.ts" desc="Beat Functions &amp; Mechanisms Prompt — XML block injected into user prompts"/>
          <file name="belief-calibration.ts" desc="Shared stance / belief calibration — XML blocks injected into user prompts that price or re-price…"/>
          <file name="deltas.ts" desc="Delta Guidelines Prompt — XML block injected into user prompts that emit structural deltas"/>
          <file name="forces.ts" desc="Force Standards Prompt — XML block injected into user prompts"/>
          <file name="game-state.ts" desc="Arc metadata guidance — XML block injected into user prompts that produce arc-level metadata…"/>
          <file name="propositions.ts" desc="Shared proposition-extraction rules — XML block injected into user prompts (scene plan generation, beat…"/>
          <file name="structural-rules.ts" desc="Structural Rules Prompt — XML block injected into user prompts"/>
          <file name="system.ts" desc="Global system prompt — Meridians engine identity"/>
        </dir>
        <dir name="entities">
          <file name="artifacts.ts" desc="Artifact Usage Prompt — XML block injected into user prompts that reason about artifacts"/>
          <file name="continuity.ts" desc="World Prompt (narrative consistency rules) — XML block injected into user prompts"/>
          <file name="integration.ts" desc="Entity Integration Rules Prompt — XML block injected into user prompts"/>
          <file name="locations.ts" desc="Locations Prompt — XML block injected into user prompts"/>
        </dir>
        <dir name="image">
          <file name="index.ts" desc="Image-prompt suggestion — distill an entity's world-graph continuity into a concise, literal visual…"/>
          <file name="map.ts" desc="Map prompt — turn a location and its containment tree into a single image-gen prompt for one flat, top-down…"/>
        </dir>
        <dir name="ingest">
          <file name="index.ts" desc="Ingestion Prompts Prompts for parsing pasted text into structured world data and for generating short prose…"/>
        </dir>
        <dir name="interviews">
          <file name="index.ts" desc="Interview prompts — depth interviews on a single subject (character / location / artifact) by generating 5-7…"/>
        </dir>
        <dir name="paradigm">
          <file name="analyst.ts" desc="Paradigm-aware system-prompt composers for ANALYTICAL surfaces"/>
          <file name="compass.ts" desc="Paradigm-aware system-prompt composers for the COMPASS surfaces"/>
          <file name="framing.ts" desc="Compass framing — per-paradigm interpretation of the Compass surface"/>
          <file name="identity.ts" desc="Paradigm identity — work identity, role identities, and composers that fuse them with title + genre +…"/>
          <file name="index.ts" desc="Paradigm — single source of truth for all paradigm-aware prompting"/>
          <file name="review.ts" desc="Paradigm-aware system-prompt composers for REVIEW surfaces"/>
          <file name="shapes.ts" desc="Paradigm shapes — every case-based per-paradigm framing the engine uses"/>
          <file name="vocabulary.ts" desc="Paradigm vocabulary — what to call the basic engine units in each paradigm"/>
        </dir>
        <dir name="phase">
          <file name="application.ts" desc="Phase application prompts — string composition for injecting the Phase Reasoning Graph (PRG) into downstream…"/>
          <file name="generate.ts" desc="Mode generation prompt — mines narrative context (with optional user guidance and optional seed graph) and…"/>
          <file name="index.ts" desc="Mode prompt module — generates the working-model-of-reality graph the narrative is currently operating under"/>
        </dir>
        <dir name="premise">
          <file name="index.ts" desc="Premise prompts. Only the random-premise generator (used by the creation wizard) is wired in the current…"/>
          <file name="refine.ts" desc="Refine narrative title / description using the work's own accumulated context"/>
        </dir>
        <dir name="principles">
          <file name="index.ts" desc="Principles — named composable discipline blocks shared across prompts"/>
          <file name="paradigm-fidelity.ts" desc="PARADIGM FIDELITY — the &quot;honour the operator-declared paradigm&quot; discipline"/>
          <file name="pivot-check.ts" desc="PIVOT CHECK — the &quot;model post-shift, not the comfortable continuation&quot; discipline"/>
          <file name="power-law-shape.ts" desc="POWER-LAW SHAPE — the &quot;cohort matches reality's distribution&quot; discipline"/>
          <file name="read-mechanisms.ts" desc="READ THE MECHANISMS — the &quot;artifacts + key actors carry the operative rules&quot; discipline"/>
          <file name="surface-vs-substrate.ts" desc="SURFACE vs SUBSTRATE — the &quot;name forces, not symptoms&quot; discipline"/>
        </dir>
        <dir name="prose">
          <file name="format-instructions.ts" desc="Prose Format Instructions Format-specific system roles and rules"/>
          <file name="rewrite.ts" desc="Prompts for rewriting scene prose guided by analysis/critique, plus the separate &quot;changelog&quot; pass that…"/>
        </dir>
        <dir name="reasoning">
          <file name="arc-graph.ts" desc="Investigation reasoning-graph prompt — produces a flexible causal graph that serves as a THINKING AID for…"/>
          <file name="coordination-plan.ts" desc="Multi-arc coordination plan prompt — peaks, valleys, moments, fate/entity/ system nodes, plus…"/>
          <file name="index.ts" desc="Reasoning-graph prompt building blocks"/>
          <file name="mode-blocks.ts" desc="Reasoning-mode prompt blocks — one block per mode, selected at prompt- assembly time by…"/>
          <file name="preference-blocks.ts" desc="Preference-driven prompt blocks: force preference, network bias, and the coordination-plan node-count guidance"/>
          <file name="principles.ts" desc="Shared principle for every reasoning artifact Meridians produces — CRG (investigation graphs), PRG (mode…"/>
          <file name="sequential-path.ts" desc="Sequential-path helpers — convert a reasoning graph (or any graph that matches `ReasoningGraphBase`) into…"/>
        </dir>
        <dir name="reconstruct">
          <file name="index.ts" desc="Branch reconstruction prompts — edit, merge, and insert scene operations applied during versioned branch…"/>
        </dir>
        <dir name="report">
          <file name="analysis.ts" desc="Report Analysis Prompts System role + user prompt for the prose sections of a world-view analysis report"/>
          <file name="index.ts" desc="Report Prompts Prose commentary for the narrative-analysis report (charts + interpretive text)"/>
        </dir>
        <dir name="review">
          <file name="branch.ts" desc="Branch Review Prompt Structural evaluation of a full branch based on scene summaries only"/>
          <file name="index.ts" desc="Review Prompts — branch-level editorial passes"/>
          <file name="plan.ts" desc="Plan Quality Review Prompt Continuity review of beat plans — verifies beats are internally consistent,…"/>
          <file name="prose.ts" desc="Prose Quality Review Prompt Evaluates written prose for voice consistency, craft, pacing, continuity,…"/>
        </dir>
        <dir name="scenes">
          <file name="analyze.ts" desc="Beat Analyst System Prompt — the reverse-engineering role"/>
          <file name="arc-settings.ts" desc="Arc-settings prompt block — compact scene-execution translation of the settings under which the arc's CRG…"/>
          <file name="edit.ts" desc="Scene Plan Edit System Prompt — targeted plan revisions"/>
          <file name="extract-propositions.ts" desc="Phase 1 of scene-plan generation — extract the compulsory propositions (the discrete, checkable claims a…"/>
          <file name="game-theory.ts" desc="Game-Theory Analysis Prompts"/>
          <file name="generate.ts" desc="Scene generation prompt — emits a JSON arc with N scenes (and their full delta blocks) given the narrative…"/>
          <file name="plan-format.ts" desc="Plan-side format-awareness block — surfaces the downstream rendering target so the planner shapes mechanism…"/>
          <file name="plan-user.ts" desc="User prompts for the scene-plan pipeline: - `buildScenePlanUserPrompt` — primary plan generator"/>
          <file name="plan.ts" desc="Scene Plan System Prompt — combined &quot;fact-extractor + scene architect&quot; role"/>
          <file name="pov.ts" desc="POV Discipline Prompt — XML block injected into user prompts"/>
          <file name="prose-instructions.ts" desc="Prose-generation instructions block — appended to the user prompt for `generateSceneProse`"/>
          <file name="prose.ts" desc="Scene Prose Writer System Prompt — paradigm-aware writer identity"/>
          <file name="summary.ts" desc="Summary Requirement Prompt The scene summary is the load-bearing artifact that feeds plan and prose…"/>
          <file name="thread-lifecycle.ts" desc="Thread Stance / Belief Prompts and Helper Functions CONCEPTUAL MODEL: each thread is a QUESTION the world…"/>
        </dir>
        <dir name="search">
          <file name="index.ts" desc="Search synthesis prompts"/>
        </dir>
        <dir name="surveys">
          <file name="index.ts" desc="Survey prompts — persona builders (character / location / artifact) and the user-prompt builder that frames…"/>
        </dir>
        <dir name="world">
          <file name="detect-patterns.ts" desc="Auto-detect patterns and anti-patterns prompt — analyses a narrative's prose, structure, and content to…"/>
          <file name="direction.ts" desc="Arc-direction and narrative-direction USER prompts — generated when the user asks for a one-arc next-step…"/>
          <file name="expand-world.ts" desc="World expansion USER prompt — adds entities (characters, locations, artifacts), threads, and system rules to…"/>
          <file name="expansion-suggestion.ts" desc="Pre-expansion suggestion USER prompt — analyses the current world structure and proposes a 2-4 sentence…"/>
          <file name="generate-narrative.ts" desc="Whole-narrative generation — produces a complete world (characters, locations, threads, artifacts, system…"/>
          <file name="index.ts" desc="World prompts — direction suggestions, expansion suggestions/execution, full-narrative generation, and…"/>
        </dir>
        <file name="CORE_LANGUAGE.md" desc="Core Language"/>
        <file name="index.ts" desc="Centralized Prompts Single source of truth for all LLM prompts, schemas, and prompt builders"/>
        <file name="learning.ts" desc="Learning (Quiz) prompts. Thesis: a scene is not just events — it carries TEACHABLE CONTENT. The concepts a…"/>
      </dir>
      <dir name="scenarios">
        <file name="scenarios-engine.ts" desc="Scenarios engine — parallel scenario-driven batch generator"/>
        <file name="scenarios-remap.ts" desc="ID remapping for Scenarios commits"/>
        <file name="scenarios-state.ts" desc="Scenarios state helpers. The new scenario-batch model keeps run state inside the React hook…"/>
      </dir>
      <dir name="search">
        <file name="citation-attribution.ts" desc="Citation → scene attribution"/>
        <file name="embeddings.ts" desc="Embedding utilities for semantic search Uses OpenAI text-embedding-3-small model via /api/embeddings…"/>
        <file name="search.ts" desc="Semantic Search Engine — two-pool architecture"/>
      </dir>
      <dir name="state">
        <file name="logs-context.tsx" desc="LogsProvider — narrative-scoped React context for API + system logs, with persistence and stale pruning"/>
        <file name="store.tsx" desc="Store — central React Context + useReducer app state: narratives, branches, view state, and all actions"/>
        <file name="theme-context.tsx" desc="ThemeProvider — light/dark theme React context with persistence"/>
        <file name="wizard-context.tsx" desc="WizardProvider — React context + reducer for the new-story creation wizard flow state"/>
      </dir>
      <dir name="storage">
        <file name="analysis-transfer.ts" desc="Transfer large analysis source text between routes via IndexedDB"/>
        <file name="asset-manager.ts" desc="Asset Manager — decoupled storage for large binary assets"/>
        <file name="audio-store.ts" desc="Audio blob storage — uses meridians-assets IndexedDB for binary storage"/>
        <file name="bulk-stream-store.ts" desc="Shared per-scene streaming state for bulk / auto-mode generation"/>
        <file name="db.ts" desc="meridians-main — the single IndexedDB database for the entire app"/>
        <file name="idb.ts" desc="IndexedDB helpers — thin wrappers around the shared `meridians-main` connection from `./db`"/>
        <file name="persistence.ts" desc="Persistence layer — reads/writes narratives, view state, and logs across IndexedDB + localStorage"/>
      </dir>
      <dir name="utils">
        <file name="clipboard.ts" desc="Copy any string to the system clipboard"/>
        <file name="ui-utils.ts" desc="UI utility functions shared across components"/>
      </dir>
      <file name="auto-engine.ts" desc="Auto-engine — narrative-pressure analysis across the three forces; builds phase-aware generation directives"/>
      <file name="branch-tree.ts" desc="Branch-tree primitives — shared layout + ordering for surfaces that render the branch hierarchy"/>
      <file name="constants.ts" desc="Centralized constants for easy tuning across the narrative engine"/>
      <file name="merges.ts" desc="merges.ts — merge-as-continuity-basis helpers"/>
      <file name="priors-compact.ts" desc="Daily Driver — synthesise queued entries into a markdown SourceFile"/>
      <file name="research-categories.ts" desc="Shared research categories for surveys + interviews"/>
      <file name="slides-data.ts" desc="Slides data — assembles the analysis walkthrough deck (force/cube/entity stats) from a narrative"/>
      <file name="title-detect.ts" desc="detectTitleFromText — single-shot LLM call that infers a title from the opening of a corpus"/>
    </dir>
    <dir name="types">
      <file name="narrative.ts" desc="── Thread (Belief System Model) ────────────────────────────────────────────"/>
    </dir>
  </dir>
  <dir name="scripts">
    <file name="classify-propositions.mjs" desc="Proposition Classification Benchmark Extracts propositions + embeddings from .meridians packages in…"/>
    <file name="gen-tree.mjs" desc="Generates TREE.md — a complete XML map of the repo file structure with a"/>
  </dir>
</repo>
```
