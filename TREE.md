# Meridians — File Tree

> **Generated** by `scripts/gen-tree.mjs` — structure is read from the filesystem and each file's description is derived from its own leading comment (else a name-based heuristic). No hand-maintained map; re-run after adding files: `node scripts/gen-tree.mjs`. Companion to [MERMAID.md](MERMAID.md). Stack: Next.js 16 · React 19 · TypeScript · Tailwind v4 · D3 · IndexedDB.
>
> 467 files · 217 described from their own header comment, the rest from filename heuristics.

```xml
<repo name="meridians">
  <docs>
    <file name="README.md" desc="project readme"/>
    <file name="CLAUDE.md" desc="project instructions + engine concepts"/>
    <file name="MERMAID.md" desc="whole-app connection diagrams (top-down)"/>
    <file name="TREE.md" desc="this file — generated XML file-structure map"/>
    <file name="ROADMAP.md" desc="build spec — iterative features → platform changes"/>
    <file name="LANGUAGE.md" desc="canonical glossary / vocabulary"/>
    <file name="DEFINITIONS.md" desc="game-theory + technical taxonomy definitions"/>
    <file name="NAMING.md" desc="naming convention + rename plan"/>
  </docs>
  <dir name="src">
    <dir name="__tests__">
      <dir name="fixtures">
        <file name="test-embeddings.ts" desc="Real OpenAI embeddings for test fixtures"/>
      </dir>
      <file name="ai-context.test.ts" desc="test: ai context"/>
      <file name="ai-diagnose.test.ts" desc="test: ai diagnose"/>
      <file name="ai-errors.test.ts" desc="test: ai errors"/>
      <file name="ai-interviews.test.ts" desc="test: ai interviews"/>
      <file name="ai-json.test.ts" desc="test: ai json"/>
      <file name="ai-prompts.test.ts" desc="Critical prompt invariants"/>
      <file name="ai-prose.test.ts" desc="test: ai prose"/>
      <file name="ai-reasoning-graph.test.ts" desc="test: ai reasoning graph"/>
      <file name="ai-reconstruct.test.ts" desc="test: ai reconstruct"/>
      <file name="ai-repair.test.ts" desc="test: ai repair"/>
      <file name="ai-review.test.ts" desc="test: ai review"/>
      <file name="ai-scenes.test.ts" desc="test: ai scenes"/>
      <file name="ai-surveys.test.ts" desc="test: ai surveys"/>
      <file name="ai-validation.test.ts" desc="test: ai validation"/>
      <file name="ai-world-generation.test.ts" desc="test: ai world generation"/>
      <file name="analysis-runner.test.ts" desc="test: analysis runner"/>
      <file name="api-logger.test.ts" desc="test: api logger"/>
      <file name="asset-manager.test.ts" desc="AssetManager Tests Tests for IndexedDB-based asset storage (embeddings, images, audio)"/>
      <file name="attribution.test.ts" desc="test: attribution"/>
      <file name="auto-engine.test.ts" desc="test: auto engine"/>
      <file name="beat-profiles.test.ts" desc="test: beat profiles"/>
      <file name="beat-prose-map.test.ts" desc="test: beat prose map"/>
      <file name="branch-chat-context.test.ts" desc="test: branch chat context"/>
      <file name="branch-scope-control.test.ts" desc="test: branch scope control"/>
      <file name="branch-tree.test.ts" desc="test: branch tree"/>
      <file name="build-grid.test.ts" desc="test: build grid"/>
      <file name="constants.test.ts" desc="test: constants"/>
      <file name="core-language.test.ts" desc="Core-language guard. Enforces the canonical vocabulary documented in src/lib/prompts/CORE_LANGUAGE.md. These…"/>
      <file name="embeddings.test.ts" desc="Embedding System Integration Tests Tests cover: 1"/>
      <file name="epub-export.test.ts" desc="test: epub export"/>
      <file name="file-conversion.test.ts" desc="file-conversion tests — focused on the pure pieces of the Apply pipeline that don't depend on the LLM: 1"/>
      <file name="game-theory-tags.test.ts" desc="Behavioural-tag classifier coverage for the Game Theory Dashboard"/>
      <file name="game-theory.test.ts" desc="test: game theory"/>
      <file name="graph-export.test.ts" desc="test: graph export"/>
      <file name="graph-utils.test.ts" desc="test: graph utils"/>
      <file name="mechanism-profiles.test.ts" desc="Tests for mechanism profile system"/>
      <file name="narrative-utils.test.ts" desc="test: narrative utils"/>
      <file name="network-graph.test.ts" desc="test: network graph"/>
      <file name="pacing-markov.test.ts" desc="test: pacing markov"/>
      <file name="package-export-import.test.ts" desc="Package Export/Import Tests Tests for .meridians ZIP package export and import"/>
      <file name="paradigm-system.test.ts" desc="Paradigm system + today's hardening work"/>
      <file name="persistence.test.ts" desc="Persistence tests are skipped because they require browser environment (window, IndexedDB) which has…"/>
      <file name="portfolio-analytics.test.ts" desc="test: portfolio analytics"/>
      <file name="positions.test.ts" desc="test: positions"/>
      <file name="proposition-classify.test.ts" desc="Proposition Classification Tests Tests the core classification logic: - Percentile and median computation -…"/>
      <file name="scenarios-engine.test.ts" desc="test: scenarios engine"/>
      <file name="scenarios-remap.test.ts" desc="test: scenarios remap"/>
      <file name="scene-filter.test.ts" desc="test: scene filter"/>
      <file name="search-synthesis.test.ts" desc="Search Synthesis Tests Tests the AI-powered search synthesis functionality: - Context building from search…"/>
      <file name="search.test.ts" desc="Semantic Search Tests Tests the core search functionality including: - Query embedding generation -…"/>
      <file name="sentence-tokenization.test.ts" desc="test: sentence tokenization"/>
      <file name="setup.ts" desc="Setup file for Vitest tests"/>
      <file name="slides-data.test.ts" desc="test: slides data"/>
      <file name="store.test.ts" desc="test: store"/>
      <file name="system-graph.test.ts" desc="test: system graph"/>
      <file name="system-logger.test.ts" desc="test: system logger"/>
      <file name="text-analysis.test.ts" desc="test: text analysis"/>
      <file name="thread-category.test.ts" desc="test: thread category"/>
      <file name="thread-log.test.ts" desc="test: thread log"/>
      <file name="time-deltas.test.ts" desc="test: time deltas"/>
      <file name="variables-context.test.ts" desc="test: variables context"/>
      <file name="versioning.test.ts" desc="test: versioning"/>
    </dir>
    <dir name="app">
      <dir name="analysis">
        <file name="page.tsx" desc="/analysis — text-analysis dashboard for kind: 'create' jobs (the runs that seed new worlds)"/>
      </dir>
      <dir name="api">
        <dir name="chat">
          <file name="route.ts" desc="chat API route"/>
        </dir>
        <dir name="embeddings">
          <file name="route.ts" desc="embeddings API route"/>
        </dir>
        <dir name="generate">
          <file name="route.ts" desc="generate API route"/>
        </dir>
        <dir name="generate-audio">
          <file name="route.ts" desc="generate-audio API route"/>
        </dir>
        <dir name="generate-cover">
          <file name="route.ts" desc="generate-cover API route"/>
        </dir>
        <dir name="generate-image">
          <file name="route.ts" desc="generate-image API route"/>
        </dir>
      </dir>
      <dir name="case-analysis">
        <file name="page.tsx" desc="case-analysis route page"/>
      </dir>
      <dir name="dashboard">
        <file name="page.tsx" desc="dashboard route page"/>
      </dir>
      <dir name="extensions">
        <dir name="[id]">
          <file name="page.tsx" desc="/extensions/[id] — per-narrative extension-job viewer"/>
        </dir>
        <file name="page.tsx" desc="/extensions — viewer for world-scoped file-conversion jobs"/>
      </dir>
      <dir name="manifesto">
        <file name="page.tsx" desc="manifesto route page"/>
      </dir>
      <dir name="narrative">
        <dir name="[id]">
          <file name="page.tsx" desc="[id] route page"/>
        </dir>
      </dir>
      <file name="layout.tsx" desc="layout"/>
      <file name="page.tsx" desc="app route page"/>
      <file name="providers.tsx" desc="provider stack"/>
    </dir>
    <dir name="components">
      <dir name="analysis">
        <file name="AnalysisShell.tsx" desc="analysis shell"/>
      </dir>
      <dir name="analytics">
        <file name="CastAnalytics.tsx" desc="cast analytics"/>
        <file name="ForceAnalytics.tsx" desc="force analytics"/>
      </dir>
      <dir name="apilogs">
        <file name="ApiLogsViewer.tsx" desc="api logs viewer"/>
        <file name="ErrorDiagnosis.tsx" desc="error diagnosis"/>
      </dir>
      <dir name="auto">
        <file name="AutoSettingsPanel.tsx" desc="auto settings panel"/>
      </dir>
      <dir name="capture">
        <file name="CapturePalette.tsx" desc="CapturePalette — floating bottom-center dock for the Queue sub-tab"/>
        <file name="CaptureView.tsx" desc="CaptureView — daily-ingest workspace rendered as a canvas mode"/>
        <file name="CompactPreviewModal.tsx" desc="CompactPreviewModal — runs synthesis on the selected queue entries and lets the operator review / edit the…"/>
      </dir>
      <dir name="cards">
        <file name="StoryCard.tsx" desc="story card"/>
      </dir>
      <dir name="effects">
        <file name="StarField.tsx" desc="star field"/>
      </dir>
      <dir name="generation">
        <file name="BranchChat.tsx" desc="branch chat"/>
        <file name="BranchModal.tsx" desc="branch modal"/>
        <file name="BranchScopeControl.tsx" desc="branch scope control"/>
        <file name="CoordinationPlanIndicator.tsx" desc="coordination plan indicator"/>
        <file name="CoordinationPlanModal.tsx" desc="coordination plan modal"/>
        <file name="CoordinationPlanSetupModal.tsx" desc="coordination plan setup modal"/>
        <file name="GeneratePanel.tsx" desc="generate panel"/>
        <file name="GuidanceFields.tsx" desc="guidance fields"/>
        <file name="MarkovGraph.tsx" desc="markov graph"/>
        <file name="PacingStrip.tsx" desc="pacing strip"/>
        <file name="ReasoningGraphModal.tsx" desc="reasoning graph modal"/>
        <file name="ReasoningStream.tsx" desc="reasoning stream"/>
        <file name="RunBar.tsx" desc="run bar"/>
        <file name="ThinkingAnimation.tsx" desc="thinking animation"/>
        <file name="ThinkingPicker.tsx" desc="thinking picker"/>
      </dir>
      <dir name="icons">
        <file name="ActionIcons.tsx" desc="Action icons — edit, delete, close, send, refresh, fork, import/export, share, rename"/>
        <file name="ContentIcons.tsx" desc="Content icons — document, book, notepad, image, eye, location, people, question, dollar, settings, dice"/>
        <file name="EvalIcons.tsx" desc="Evaluation verdict &amp; status icons — used in BranchEval, PlanEval, ProseEval"/>
        <file name="index.ts" desc="icons barrel"/>
        <file name="MediaIcons.tsx" desc="Media control icons — play, pause, stop"/>
        <file name="NavigationIcons.tsx" desc="Navigation icons — chevrons, arrows, home, expand"/>
        <file name="StatusIcons.tsx" desc="Status icons — spinner, warning, checkmark (standalone)"/>
      </dir>
      <dir name="inspector">
        <file name="ArcDetail.tsx" desc="arc detail"/>
        <file name="ArtifactDetail.tsx" desc="artifact detail"/>
        <file name="AttributionsSection.tsx" desc="attributions section"/>
        <file name="CharacterDetail.tsx" desc="character detail"/>
        <file name="ChatPanel.tsx" desc="chat panel"/>
        <file name="CollapsibleSection.tsx" desc="collapsible section"/>
        <file name="CompassPanel.tsx" desc="compass panel"/>
        <file name="EmptyState.tsx" desc="empty state"/>
        <file name="FilesPanel.tsx" desc="FilesPanel — sidebar list of source files that contributed to this narrative"/>
        <file name="ImagePromptEditor.tsx" desc="image prompt editor"/>
        <file name="InlineEdit.tsx" desc="inline edit"/>
        <file name="InspectorPanel.tsx" desc="inspector panel"/>
        <file name="KnowledgeDetail.tsx" desc="knowledge detail"/>
        <file name="KnowledgePanel.tsx" desc="KnowledgePanel — ranked directory of system-graph nodes"/>
        <file name="LocationDetail.tsx" desc="location detail"/>
        <file name="PhaseNodeDetail.tsx" desc="PhaseNodeDetail — inspector for a single Phase Reasoning Graph (PRG) node"/>
        <file name="ReasoningNodeDetail.tsx" desc="reasoning node detail"/>
        <file name="SceneDetail.tsx" desc="scene detail"/>
        <file name="ThreadDetail.tsx" desc="thread detail"/>
        <file name="ThreadLogNodeDetail.tsx" desc="thread log node detail"/>
        <file name="ThreadsPanel.tsx" desc="ThreadsPanel — sidebar pane mirroring SurveyPanel / MapPanel shape: top bar with a count, then a stream of…"/>
        <file name="WorldNodeDetail.tsx" desc="world node detail"/>
      </dir>
      <dir name="landing">
        <file name="LandingTopbar.tsx" desc="landing topbar"/>
      </dir>
      <dir name="layout">
        <file name="AppShell.tsx" desc="app shell"/>
        <file name="DrivePanel.tsx" desc="Left sidebar — image/media management only (Drive)"/>
        <file name="ProseProfilePanel.tsx" desc="prose profile panel"/>
      </dir>
      <dir name="narratives">
        <file name="NarrativesScreen.tsx" desc="narratives screen"/>
      </dir>
      <dir name="report">
        <file name="NarrativeReport.tsx" desc="narrative report"/>
      </dir>
      <dir name="scenarios">
        <file name="ScenarioAnalytics.tsx" desc="Shared analytics + visualisation primitives for scenarios branches, ported from the legacy MCTS inspector"/>
        <file name="ScenariosBar.tsx" desc="scenarios bar"/>
        <file name="ScenariosPanel.tsx" desc="scenarios panel"/>
      </dir>
      <dir name="settings">
        <file name="StorySettingsModal.tsx" desc="story settings modal"/>
      </dir>
      <dir name="shared">
        <file name="CopyButton.tsx" desc="copy button"/>
        <file name="InferenceFields.tsx" desc="Shared inference-shape renderer — the canonical visual language for the universal inference-shape (detail…"/>
      </dir>
      <dir name="sidebar">
        <dir name="maps">
          <file name="MapComposerModal.tsx" desc="map composer modal"/>
        </dir>
        <dir name="surveys">
          <file name="CategoryPicker.tsx" desc="category picker"/>
          <file name="CopyButton.tsx" desc="Thin re-export — the canonical CopyButton now lives in components/shared"/>
          <file name="InterviewComposerModal.tsx" desc="interview composer modal"/>
          <file name="InterviewDetailModal.tsx" desc="interview detail modal"/>
          <file name="SurveyComposerModal.tsx" desc="survey composer modal"/>
          <file name="SurveyDetailModal.tsx" desc="survey detail modal"/>
          <file name="SurveyResults.tsx" desc="survey results"/>
        </dir>
        <file name="ApplyExtensionModal.tsx" desc="ApplyExtensionModal — two-phase Apply UI for an extension file"/>
        <file name="BoardAnnotator.tsx" desc="board annotator"/>
        <file name="FileComposerModal.tsx" desc="FileComposerModal — two-phase composer for extending the current world"/>
        <file name="HierarchyModal.tsx" desc="hierarchy modal"/>
        <file name="InterviewPanel.tsx" desc="interview panel"/>
        <file name="MapPanel.tsx" desc="map panel"/>
        <file name="MediaDrive.tsx" desc="media drive"/>
        <file name="MediaPreview.tsx" desc="media preview"/>
        <file name="NarrativeRail.tsx" desc="narrative rail"/>
        <file name="SourceFileModal.tsx" desc="SourceFileModal — full-source-text viewer for a SourceFile"/>
        <file name="SurveyPanel.tsx" desc="survey panel"/>
      </dir>
      <dir name="slides">
        <file name="BeatProfileSlide.tsx" desc="beat profile slide"/>
        <file name="BeliefSystemSlide.tsx" desc="belief system slide"/>
        <file name="CastSlide.tsx" desc="cast slide"/>
        <file name="ClosingSlide.tsx" desc="closing slide"/>
        <file name="ForceDecompositionSlide.tsx" desc="force decomposition slide"/>
        <file name="ForcesOverviewSlide.tsx" desc="forces overview slide"/>
        <file name="KeyMomentsSlide.tsx" desc="key moments slide"/>
        <file name="KnowledgeStructureSlide.tsx" desc="knowledge structure slide"/>
        <file name="MechanismSlide.tsx" desc="mechanism slide"/>
        <file name="PacingProfileSlide.tsx" desc="pacing profile slide"/>
        <file name="ParadigmLensSlide.tsx" desc="paradigm lens slide"/>
        <file name="PropositionOverviewSlide.tsx" desc="proposition overview slide"/>
        <file name="ReportCardSlide.tsx" desc="report card slide"/>
        <file name="SegmentSlide.tsx" desc="segment slide"/>
        <file name="ShapeSlide.tsx" desc="shape slide"/>
        <file name="SlideShell.tsx" desc="slide shell"/>
        <file name="SlidesPlayer.tsx" desc="slides player"/>
        <file name="SwingAnalysisSlide.tsx" desc="swing analysis slide"/>
        <file name="ThreadLifecycleSlide.tsx" desc="thread lifecycle slide"/>
        <file name="TimeFlowSlide.tsx" desc="time flow slide"/>
        <file name="TitleSlide.tsx" desc="title slide"/>
      </dir>
      <dir name="stage">
        <dir name="variables">
          <file name="BentoTile.tsx" desc="bento tile"/>
          <file name="DashboardChrome.tsx" desc="Shared chrome elements that align Variables with the Dashboard (Market) visual rhythm — uppercase section…"/>
          <file name="DispositionEditor.tsx" desc="disposition editor"/>
          <file name="MetricStrip.tsx" desc="metric strip"/>
          <file name="ProbabilityBar.tsx" desc="probability bar"/>
          <file name="ScenarioCard.tsx" desc="scenario card"/>
          <file name="VariableGridChart.tsx" desc="variable grid chart"/>
          <file name="VariableParallelCoords.tsx" desc="variable parallel coords"/>
          <file name="VariableRadarChart.tsx" desc="variable radar chart"/>
          <file name="VariableViewSwitcher.tsx" desc="variable view switcher"/>
        </dir>
        <file name="AudioMiniPlayer.tsx" desc="audio mini player"/>
        <file name="BeliefView.tsx" desc="Belief dashboard — the world view's belief, built from per-thread stances"/>
        <file name="BoardView.tsx" desc="board view"/>
        <file name="CompassView.tsx" desc="compass view"/>
        <file name="DecisionView.tsx" desc="DecisionView — scene-level game-theoretic analysis"/>
        <file name="graph-utils.ts" desc="graph utils"/>
        <file name="NetworkView.tsx" desc="network view"/>
        <file name="PhaseGraphView.tsx" desc="Phase Reasoning Graph (PRG) view — renders a phase graph with the same dagre construction as the Causal…"/>
        <file name="PlanCandidatesModal.tsx" desc="plan candidates modal"/>
        <file name="PlanCandidatesView.tsx" desc="plan candidates view"/>
        <file name="ReasoningGraphView.tsx" desc="reasoning graph view"/>
        <file name="SceneAudioView.tsx" desc="scene audio view"/>
        <file name="SceneBar.tsx" desc="scene bar"/>
        <file name="ScenePanel.tsx" desc="scene panel"/>
        <file name="ScenePlanView.tsx" desc="scene plan view"/>
        <file name="SceneProseView.tsx" desc="scene prose view"/>
        <file name="SearchView.tsx" desc="search view"/>
        <file name="Stage.tsx" desc="stage"/>
        <file name="StageBar.tsx" desc="stage bar"/>
        <file name="StagePalette.tsx" desc="stage palette"/>
        <file name="SystemGraphView.tsx" desc="system graph view"/>
        <file name="ThreadGraphView.tsx" desc="thread graph view"/>
        <file name="ThreadLogGraphView.tsx" desc="thread log graph view"/>
        <file name="VersionHistoryTree.tsx" desc="version history tree"/>
        <file name="WorldGraphView.tsx" desc="world graph view"/>
      </dir>
      <dir name="timeline">
        <file name="ActivityLineChart.tsx" desc="activity line chart"/>
        <file name="BranchEval.tsx" desc="branch eval"/>
        <file name="BranchTreePopover.tsx" desc="Floating tree-shaped branch switcher, anchored off the timeline strip's branch chip"/>
        <file name="EvalBar.tsx" desc="eval bar"/>
        <file name="ForceLineChart.tsx" desc="force line chart"/>
        <file name="ForceTimeline.tsx" desc="force timeline"/>
        <file name="PlanEval.tsx" desc="plan eval"/>
        <file name="ProseEval.tsx" desc="prose eval"/>
        <file name="SceneRangeSelector.tsx" desc="scene range selector"/>
        <file name="TimelineStrip.tsx" desc="timeline strip"/>
      </dir>
      <dir name="topbar">
        <file name="ApiKeyModal.tsx" desc="api key modal"/>
        <file name="ApiLogsModal.tsx" desc="api logs modal"/>
        <file name="BeatProfileModal.tsx" desc="beat profile modal"/>
        <file name="BranchContextModal.tsx" desc="branch context modal"/>
        <file name="DefinitionsModal.tsx" desc="definitions modal"/>
        <file name="ExportPackageModal.tsx" desc="export package modal"/>
        <file name="FormulaModal.tsx" desc="formula modal"/>
        <file name="GameTheoryDashboard.tsx" desc="GameTheoryDashboard — a focused, high-level view of the narrative's strategic structure"/>
        <file name="GasMeter.tsx" desc="gas meter"/>
        <file name="ImportPackageModal.tsx" desc="import package modal"/>
        <file name="MarkovChainModal.tsx" desc="markov chain modal"/>
        <file name="NarrativeEditModal.tsx" desc="narrative edit modal"/>
        <file name="PatternsModal.tsx" desc="patterns modal"/>
        <file name="PropositionAnalysisModal.tsx" desc="proposition analysis modal"/>
        <file name="RegenerateEmbeddingsModal.tsx" desc="regenerate embeddings modal"/>
        <file name="SystemLogModal.tsx" desc="system log modal"/>
        <file name="ThemeModal.tsx" desc="theme modal"/>
        <file name="TimeFlowModal.tsx" desc="time flow modal"/>
        <file name="TopBar.tsx" desc="top bar"/>
        <file name="UsageModal.tsx" desc="usage modal"/>
      </dir>
      <dir name="ui">
        <file name="Markdown.tsx" desc="Markdown renderer — full CommonMark + GitHub-flavored markdown (tables, strikethrough, task lists,…"/>
      </dir>
      <dir name="wizard">
        <file name="CreationWizard.tsx" desc="Direct sub-module imports rather than the @/lib/ai barrel"/>
      </dir>
      <file name="ArchetypeIcon.tsx" desc="archetype icon"/>
      <file name="CubeCornerBadge.tsx" desc="Reusable cube corner visualization badge — three colored bars for P/C/K forces"/>
      <file name="Modal.tsx" desc="modal"/>
    </dir>
    <dir name="hooks">
      <file name="useAssetUrl.ts" desc="React hook for resolving asset references to blob URLs Handles: - ImageRef: &quot;img_abc123&quot; → blob URL,…"/>
      <file name="useAudioPlayer.tsx" desc="audio player hook"/>
      <file name="useAutoPlay.ts" desc="auto play hook"/>
      <file name="useBulkAudioGenerate.ts" desc="bulk audio generate hook"/>
      <file name="useBulkEmbed.ts" desc="Bulk Embedding Hook - Manual regeneration of embeddings for scenes Use cases: - Importing old narratives…"/>
      <file name="useBulkGenerate.ts" desc="bulk generate hook"/>
      <file name="useBulkStreamPreview.ts" desc="bulk stream preview hook"/>
      <file name="useFeatureAccess.ts" desc="feature access hook"/>
      <file name="usePropositionClassification.tsx" desc="Proposition classification provider &amp; hook"/>
      <file name="useResolvedScene.ts" desc="resolved scene hook"/>
      <file name="useScenarios.ts" desc="useScenarios — parallel Compass-driven branch generation"/>
    </dir>
    <dir name="lib">
      <dir name="ai">
        <dir name="reasoning-graph">
          <file name="shared.ts" desc="Shared helpers for the reasoning-graph subsystem — scale helpers and force-preference type used across every…"/>
          <file name="types.ts" desc="Type declarations for the reasoning-graph subsystem"/>
          <file name="validate.ts" desc="Reference validation for reasoning-graph nodes"/>
        </dir>
        <file name="api.ts" desc="api"/>
        <file name="branch-chat.ts" desc="Branch Chat — multi-branch analytical chat"/>
        <file name="candidates.ts" desc="Plan Candidates - Generate multiple candidate plans and rank by semantic similarity Embeddings are only…"/>
        <file name="capture.ts" desc="Driver entry generation. Produces a single Driver entry ({title, text}) from a user direction prompt and,…"/>
        <file name="context.ts" desc="context"/>
        <file name="diagnose.ts" desc="Inspect a thrown error from a generation call and produce a user-facing diagnosis: what likely went wrong,…"/>
        <file name="errors.ts" desc="Errors raised at the LLM API boundary"/>
        <file name="game-analysis.ts" desc="Game-theoretic scene analysis — a purely additive, post-hoc layer"/>
        <file name="hierarchy.ts" desc="hierarchy"/>
        <file name="image-prompt.ts" desc="Suggest a refined imagePrompt for an entity (character, location, artifact) by reading the entity's full…"/>
        <file name="index.ts" desc="Context builders"/>
        <file name="ingest.ts" desc="ingest"/>
        <file name="interviews.ts" desc="Interview executor — ask one subject many questions in parallel using its world-graph continuity"/>
        <file name="json.ts" desc="Clean common LLM JSON quirks: code fences, trailing commas, single-quoted keys"/>
        <file name="phase-graph.ts" desc="Phase generator — mines narrative context (with optional user guidance and optional seed graph) to produce a…"/>
        <file name="premise.ts" desc="Premise suggestion for the creation wizard"/>
        <file name="prompts.ts" desc="Re-export wrapper for backward compatibility"/>
        <file name="prose.ts" desc="prose"/>
        <file name="reasoning-graph.ts" desc="Reasoning-graph generators — the top-level entry points that produce: - `generateReasoningGraph` — per-arc…"/>
        <file name="reconstruct.ts" desc="reconstruct"/>
        <file name="repair.ts" desc="repair"/>
        <file name="report.ts" desc="report"/>
        <file name="review.ts" desc="review"/>
        <file name="scenes.ts" desc="scenes"/>
        <file name="search-synthesis.ts" desc="AI Search Synthesis — proposition-primary RAG with scene-aggregate context"/>
        <file name="surveys.ts" desc="Survey executor — query characters, locations, and artifacts in parallel using their world-graph continuity…"/>
        <file name="validation.ts" desc="Validation utilities for AI API responses Ensures LLM outputs match expected types before accepting results"/>
        <file name="variables.ts" desc="Per-arc variable generation — the Compass surfaces"/>
        <file name="world.ts" desc="world"/>
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
          <file name="index.ts" desc="Search synthesis prompts — produce a Google-style overview with inline citations from semantic-search…"/>
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
      </dir>
      <file name="analysis-runner.ts" desc="Singleton analysis runner — persists across React component mounts/unmounts"/>
      <file name="analysis-transfer.ts" desc="Transfer large analysis source text between routes via IndexedDB"/>
      <file name="api-headers.ts" desc="Builds headers that include user-provided API keys from localStorage when NEXT_PUBLIC_USER_API_KEYS is enabled"/>
      <file name="api-logger.ts" desc="api logger"/>
      <file name="asset-manager.ts" desc="Asset Manager — decoupled storage for large binary assets"/>
      <file name="attribution.ts" desc="Attribution derivation — defensive helper that walks a scene's (or world-build's) typed structural fields…"/>
      <file name="audio-store.ts" desc="Audio blob storage — uses meridians-assets IndexedDB for binary storage"/>
      <file name="auto-engine.ts" desc="auto engine"/>
      <file name="beat-profiles.ts" desc="Beat profile system — Markov chains for prose plan generation"/>
      <file name="belief-export.ts" desc="Markdown exporter for the prediction-market dashboard"/>
      <file name="branch-tree.ts" desc="branch tree"/>
      <file name="bulk-stream-store.ts" desc="Shared per-scene streaming state for bulk / auto-mode generation"/>
      <file name="clipboard.ts" desc="Copy any string to the system clipboard"/>
      <file name="constants.ts" desc="Centralized constants for easy tuning across the narrative engine"/>
      <file name="db.ts" desc="meridians-main — the single IndexedDB database for the entire app"/>
      <file name="embeddings.ts" desc="Embedding utilities for semantic search Uses OpenAI text-embedding-3-small model via /api/embeddings…"/>
      <file name="epub-export.ts" desc="epub export"/>
      <file name="file-conversion.ts" desc="file-conversion — world-scoped helpers for adding a source file to a narrative and (optionally) kicking off…"/>
      <file name="game-theory-glossary.ts" desc="Plain-language tooltips for the game-theory UI"/>
      <file name="game-theory-player.ts" desc="Per-character game-theory summary — a lightweight derivation off `narrative.scenes[*].gameAnalysis.games`…"/>
      <file name="game-theory.ts" desc="Game-theoretic helpers — NxM decision-space model"/>
      <file name="graph-export.ts" desc="Contextual Markdown exporters for the canvas graph views"/>
      <file name="graph-styling.ts" desc="Shared edge styling for d3 force graph views (NetworkView, SystemGraphView, ThreadGraphView,…"/>
      <file name="idb.ts" desc="IndexedDB helpers — thin wrappers around the shared `meridians-main` connection from `./db`"/>
      <file name="location-clusters.ts" desc="location-clusters — derive location clusters from the parent/child graph"/>
      <file name="logs-context.tsx" desc="logs context"/>
      <file name="map-layout.ts" desc="map-layout — resolve the location subtree a map covers"/>
      <file name="map-tree-layout.ts" desc="map-tree-layout — arrange annotated territory maps as a top-down tree of image &quot;boards&quot; for the World-graph…"/>
      <file name="mechanism-profiles.ts" desc="Mechanism profile system — prose delivery mechanism distributions"/>
      <file name="narrative-utils.ts" desc="narrative utils"/>
      <file name="network-graph.ts" desc="Network graph — the cumulative activation pattern across the narrative"/>
      <file name="pacing-markov.ts" desc="Markov chain sequence generation for narrative pacing"/>
      <file name="pacing-profiles.ts" desc="Pacing profile system — transition matrices for narrative pacing"/>
      <file name="package-export.ts" desc="Package Export - Create portable .meridians ZIP packages Combines narrative JSON + binary assets into a…"/>
      <file name="package-import.ts" desc="Package Import - Import .meridians packages Supports two formats: 1"/>
      <file name="persistence.ts" desc="persistence"/>
      <file name="phase-graph.ts" desc="Phase utilities — the working-model-of-reality graph that's mined from narrative context (with optional user…"/>
      <file name="portfolio-analytics.ts" desc="Thread-portfolio analytics"/>
      <file name="positions.ts" desc="positions"/>
      <file name="priors-compact.ts" desc="Daily Driver — synthesise queued entries into a markdown SourceFile"/>
      <file name="proposition-classify.ts" desc="Proposition Classification Engine Classifies propositions into 4 base categories with Local/Global reach: 1"/>
      <file name="reasoning-node-colors.ts" desc="Shared colour language for reasoning-graph nodes"/>
      <file name="research-categories.ts" desc="Shared research categories for surveys + interviews"/>
      <file name="research-export.ts" desc="Markdown formatters for surveys and interviews"/>
      <file name="resolve-api-key.ts" desc="resolve api key"/>
      <file name="scenarios-engine.ts" desc="Scenarios engine — parallel scenario-driven batch generator"/>
      <file name="scenarios-remap.ts" desc="ID remapping for Scenarios commits"/>
      <file name="scenarios-state.ts" desc="Scenarios state helpers. The new scenario-batch model keeps run state inside the React hook…"/>
      <file name="scene-export.ts" desc="Markdown exporters for the currently-viewed scene plan and prose"/>
      <file name="scene-filter.ts" desc="scene filter"/>
      <file name="search.ts" desc="Semantic Search Engine — two-pool architecture"/>
      <file name="slides-data.ts" desc="slides data"/>
      <file name="store.tsx" desc="store"/>
      <file name="system-graph.ts" desc="System graph utilities — delta sanitization and application"/>
      <file name="system-logger.ts" desc="system logger"/>
      <file name="text-analysis.ts" desc="Text Analysis Pipeline — converts a large corpus (book, screenplay, etc.) into a full NarrativeState by…"/>
      <file name="theme-context.tsx" desc="theme context"/>
      <file name="thread-category.ts" desc="Thread category classification — a single vocabulary derived from a thread's current MARKET STATE…"/>
      <file name="thread-log.ts" desc="Thread stance application"/>
      <file name="time-deltas.ts" desc="Time delta helpers. Scenes are instants; the gap between consecutive scenes is a TimeDelta ({value, unit}).…"/>
      <file name="title-detect.ts" desc="detectTitleFromText — single-shot LLM call that infers a title from the opening of a corpus"/>
      <file name="ui-utils.ts" desc="UI utility functions shared across components"/>
      <file name="wizard-context.tsx" desc="wizard context"/>
      <file name="world-graph.ts" desc="World graph utilities — delta application"/>
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
