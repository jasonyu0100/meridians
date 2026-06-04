# Meridians — File Tree

> **Generated** by `scripts/gen-tree.mjs` (structure from the filesystem — always complete + current; `desc` annotations live in the generator). Regenerate: `node scripts/gen-tree.mjs`. Companion to [MERMAID.md](MERMAID.md). Stack: Next.js 16 · React 19 · TypeScript · Tailwind v4 · D3 · IndexedDB.
>
> Coverage: 467/467 files annotated.

```xml
<repo name="meridians">
  <docs>
    <file name="README.md" desc="project readme"/>
    <file name="CLAUDE.md" desc="project instructions + engine concepts (NOTE: drifted — defer to TREE/MERMAID)"/>
    <file name="MERMAID.md" desc="whole-app connection diagrams (top-down)"/>
    <file name="TREE.md" desc="this file — generated XML file-structure map"/>
    <file name="ROADMAP.md" desc="build spec: Part A iterative features → Part B platform changes"/>
    <file name="LANGUAGE.md" desc="canonical glossary / vocabulary"/>
    <file name="DEFINITIONS.md" desc="game-theory + technical taxonomy definitions"/>
  </docs>
  <dir name="src">
    <dir name="__tests__">
      <dir name="fixtures">
        <file name="test-embeddings.ts" desc="test fixture: embeddings"/>
      </dir>
      <file name="ai-context.test.ts" desc="test: ai-context"/>
      <file name="ai-diagnose.test.ts" desc="test: ai-diagnose"/>
      <file name="ai-errors.test.ts" desc="test: ai-errors"/>
      <file name="ai-interviews.test.ts" desc="test: ai-interviews"/>
      <file name="ai-json.test.ts" desc="test: ai-json"/>
      <file name="ai-prompts.test.ts" desc="test: ai-prompts"/>
      <file name="ai-prose.test.ts" desc="test: ai-prose"/>
      <file name="ai-reasoning-graph.test.ts" desc="test: ai-reasoning-graph"/>
      <file name="ai-reconstruct.test.ts" desc="test: ai-reconstruct"/>
      <file name="ai-repair.test.ts" desc="test: ai-repair"/>
      <file name="ai-review.test.ts" desc="test: ai-review"/>
      <file name="ai-scenes.test.ts" desc="test: ai-scenes"/>
      <file name="ai-surveys.test.ts" desc="test: ai-surveys"/>
      <file name="ai-validation.test.ts" desc="test: ai-validation"/>
      <file name="ai-world-generation.test.ts" desc="test: ai-world-generation"/>
      <file name="analysis-runner.test.ts" desc="test: analysis-runner"/>
      <file name="api-logger.test.ts" desc="test: api-logger"/>
      <file name="asset-manager.test.ts" desc="test: asset-manager"/>
      <file name="attribution.test.ts" desc="test: attribution"/>
      <file name="auto-engine.test.ts" desc="test: auto-engine"/>
      <file name="beat-profiles.test.ts" desc="test: beat-profiles"/>
      <file name="beat-prose-map.test.ts" desc="test: beat-prose-map"/>
      <file name="branch-chat-context.test.ts" desc="test: branch-chat-context"/>
      <file name="branch-scope-control.test.ts" desc="test: branch-scope-control"/>
      <file name="branch-tree.test.ts" desc="test: branch-tree"/>
      <file name="build-grid.test.ts" desc="test: build-grid"/>
      <file name="constants.test.ts" desc="test: constants"/>
      <file name="core-language.test.ts" desc="test: core-language"/>
      <file name="embeddings.test.ts" desc="test: embeddings"/>
      <file name="epub-export.test.ts" desc="test: epub-export"/>
      <file name="file-conversion.test.ts" desc="test: file-conversion"/>
      <file name="game-theory-tags.test.ts" desc="test: game-theory-tags"/>
      <file name="game-theory.test.ts" desc="test: game-theory"/>
      <file name="graph-export.test.ts" desc="test: graph-export"/>
      <file name="graph-utils.test.ts" desc="test: graph-utils"/>
      <file name="mechanism-profiles.test.ts" desc="test: mechanism-profiles"/>
      <file name="narrative-utils.test.ts" desc="test: narrative-utils"/>
      <file name="network-graph.test.ts" desc="test: network-graph"/>
      <file name="pacing-markov.test.ts" desc="test: pacing-markov"/>
      <file name="package-export-import.test.ts" desc="test: package-export-import"/>
      <file name="paradigm-system.test.ts" desc="test: paradigm-system"/>
      <file name="persistence.test.ts" desc="test: persistence"/>
      <file name="portfolio-analytics.test.ts" desc="test: portfolio-analytics"/>
      <file name="positions.test.ts" desc="test: positions"/>
      <file name="proposition-classify.test.ts" desc="test: proposition-classify"/>
      <file name="scenarios-engine.test.ts" desc="test: scenarios-engine"/>
      <file name="scenarios-remap.test.ts" desc="test: scenarios-remap"/>
      <file name="scene-filter.test.ts" desc="test: scene-filter"/>
      <file name="search-synthesis.test.ts" desc="test: search-synthesis"/>
      <file name="search.test.ts" desc="test: search"/>
      <file name="sentence-tokenization.test.ts" desc="test: sentence-tokenization"/>
      <file name="setup.ts" desc="vitest setup"/>
      <file name="slides-data.test.ts" desc="test: slides-data"/>
      <file name="store.test.ts" desc="test: store"/>
      <file name="system-graph.test.ts" desc="test: system-graph"/>
      <file name="system-logger.test.ts" desc="test: system-logger"/>
      <file name="text-analysis.test.ts" desc="test: text-analysis"/>
      <file name="thread-category.test.ts" desc="test: thread-category"/>
      <file name="thread-log.test.ts" desc="test: thread-log"/>
      <file name="time-deltas.test.ts" desc="test: time-deltas"/>
      <file name="variables-context.test.ts" desc="test: variables-context"/>
      <file name="versioning.test.ts" desc="test: versioning"/>
    </dir>
    <dir name="app">
      <dir name="analysis">
        <file name="page.tsx" desc="TEXT ANALYSIS — corpus ingest (create) via AnalysisShell"/>
      </dir>
      <dir name="api">
        <dir name="chat">
          <file name="route.ts" desc="chat proxy"/>
        </dir>
        <dir name="embeddings">
          <file name="route.ts" desc="OpenAI text-embedding-3-small (1536-dim)"/>
        </dir>
        <dir name="generate">
          <file name="route.ts" desc="OpenRouter chat (SSE + JSON); key resolve; web tools; reasoning budget"/>
        </dir>
        <dir name="generate-audio">
          <file name="route.ts" desc="OpenAI TTS (tts-1)"/>
        </dir>
        <dir name="generate-cover">
          <file name="route.ts" desc="Replicate cover image"/>
        </dir>
        <dir name="generate-image">
          <file name="route.ts" desc="OpenRouter prompt-enhance → Replicate Seedream"/>
        </dir>
      </dir>
      <dir name="case-analysis">
        <file name="page.tsx" desc="case-analysis page"/>
      </dir>
      <dir name="dashboard">
        <file name="page.tsx" desc="dashboard story picker"/>
      </dir>
      <dir name="extensions">
        <dir name="[id]">
          <file name="page.tsx" desc="EXTEND a narrative from new corpus (AnalysisShell kind=extend)"/>
        </dir>
        <file name="page.tsx" desc="extensions index"/>
      </dir>
      <dir name="manifesto">
        <file name="page.tsx" desc="MANIFESTO — vision/theory long-form"/>
      </dir>
      <dir name="narrative">
        <dir name="[id]">
          <file name="page.tsx" desc="THE WORKSPACE (SeriesPage): mounts AppShell; URL id = active narrative; window-event modal triggers"/>
        </dir>
      </dir>
      <file name="layout.tsx" desc="root HTML layout"/>
      <file name="page.tsx" desc="LANDING / home (story picker; useIsMobile gate)"/>
      <file name="providers.tsx" desc="provider stack: Theme → Store → Wizard → Logs"/>
    </dir>
    <dir name="components">
      <dir name="analysis">
        <file name="AnalysisShell.tsx" desc="shared corpus-ingest UI (create | extend)"/>
      </dir>
      <dir name="analytics">
        <file name="CastAnalytics.tsx" desc="cast analytics"/>
        <file name="ForceAnalytics.tsx" desc="force tracker analytics"/>
      </dir>
      <dir name="apilogs">
        <file name="ApiLogsViewer.tsx" desc="API log viewer"/>
        <file name="ErrorDiagnosis.tsx" desc="diagnostic + Repair UI"/>
      </dir>
      <dir name="auto">
        <file name="AutoSettingsPanel.tsx" desc="auto-mode settings"/>
      </dir>
      <dir name="capture">
        <file name="CapturePalette.tsx" desc="create/generate/synthesise palette"/>
        <file name="CaptureView.tsx" desc="Capture/Priors: Queue list + Search sub-tab host"/>
        <file name="CompactPreviewModal.tsx" desc="compact-into-file preview/apply"/>
      </dir>
      <dir name="cards">
        <file name="StoryCard.tsx" desc="story card"/>
      </dir>
      <dir name="effects">
        <file name="StarField.tsx" desc="starfield background effect"/>
      </dir>
      <dir name="generation">
        <file name="BranchChat.tsx" desc="chat over a branch substrate"/>
        <file name="BranchModal.tsx" desc="branch create/switch"/>
        <file name="BranchScopeControl.tsx" desc="branch-chat scope control"/>
        <file name="CoordinationPlanIndicator.tsx" desc="coordination-plan pointer indicator"/>
        <file name="CoordinationPlanModal.tsx" desc="coordination-plan viewer"/>
        <file name="CoordinationPlanSetupModal.tsx" desc="coordination-plan setup"/>
        <file name="GeneratePanel.tsx" desc="arc continuation / world expansion"/>
        <file name="GuidanceFields.tsx" desc="direction/constraint inputs"/>
        <file name="MarkovGraph.tsx" desc="pacing Markov graph"/>
        <file name="PacingStrip.tsx" desc="pacing sequence strip"/>
        <file name="ReasoningGraphModal.tsx" desc="CRG modal"/>
        <file name="ReasoningStream.tsx" desc="live reasoning stream view"/>
        <file name="RunBar.tsx" desc="run-status bar (auto / scenarios / bulk)"/>
        <file name="ThinkingAnimation.tsx" desc="D3 thinking-mode animation"/>
        <file name="ThinkingPicker.tsx" desc="thinking-mode picker"/>
      </dir>
      <dir name="icons">
        <file name="ActionIcons.tsx" desc="Action icon set"/>
        <file name="ContentIcons.tsx" desc="Content icon set"/>
        <file name="EvalIcons.tsx" desc="Eval icon set"/>
        <file name="index.ts" desc="icon barrel export"/>
        <file name="MediaIcons.tsx" desc="Media icon set"/>
        <file name="NavigationIcons.tsx" desc="Navigation icon set"/>
        <file name="StatusIcons.tsx" desc="Status icon set"/>
      </dir>
      <dir name="inspector">
        <file name="ArcDetail.tsx" desc="arc inspector body"/>
        <file name="ArtifactDetail.tsx" desc="artifact inspector body"/>
        <file name="AttributionsSection.tsx" desc="scene attributions section"/>
        <file name="CharacterDetail.tsx" desc="character inspector body"/>
        <file name="ChatPanel.tsx" desc="inspector Chat tab"/>
        <file name="CollapsibleSection.tsx" desc="collapsible section primitive"/>
        <file name="CompassPanel.tsx" desc="inspector Compass tab"/>
        <file name="EmptyState.tsx" desc="inspector empty state"/>
        <file name="FilesPanel.tsx" desc="inspector Files tab"/>
        <file name="ImagePromptEditor.tsx" desc="entity image-prompt editor"/>
        <file name="InlineEdit.tsx" desc="inline field editor"/>
        <file name="InspectorPanel.tsx" desc="RIGHT INSPECTOR: tab registry + icon rail; renderInspector()"/>
        <file name="KnowledgeDetail.tsx" desc="system-knowledge node detail"/>
        <file name="KnowledgePanel.tsx" desc="knowledge inspector panel"/>
        <file name="LocationDetail.tsx" desc="location inspector body"/>
        <file name="PhaseNodeDetail.tsx" desc="PRG (Mode) node detail"/>
        <file name="ReasoningNodeDetail.tsx" desc="CRG node detail"/>
        <file name="SceneDetail.tsx" desc="scene inspector body"/>
        <file name="ThreadDetail.tsx" desc="thread inspector body"/>
        <file name="ThreadLogNodeDetail.tsx" desc="thread-log node detail"/>
        <file name="ThreadsPanel.tsx" desc="inspector Threads tab"/>
        <file name="WorldNodeDetail.tsx" desc="world-graph node detail"/>
      </dir>
      <dir name="landing">
        <file name="LandingTopbar.tsx" desc="landing top bar"/>
      </dir>
      <dir name="layout">
        <file name="AppShell.tsx" desc="WORKSPACE FRAME: TopBar + NarrativeRail + Sidebar + center + SidePanel"/>
        <file name="DrivePanel.tsx" desc="left resizable sidebar (hosts the Drive)"/>
        <file name="ProseProfilePanel.tsx" desc="prose-profile editor panel"/>
      </dir>
      <dir name="narratives">
        <file name="NarrativesScreen.tsx" desc="home story grid"/>
      </dir>
      <dir name="report">
        <file name="NarrativeReport.tsx" desc="narrative analysis report"/>
      </dir>
      <dir name="scenarios">
        <file name="ScenarioAnalytics.tsx" desc="scenario cohort analytics"/>
        <file name="ScenariosBar.tsx" desc="scenarios run control bar"/>
        <file name="ScenariosPanel.tsx" desc="multi-scenario parallel branch UI"/>
      </dir>
      <dir name="settings">
        <file name="StorySettingsModal.tsx" desc="story settings modal"/>
      </dir>
      <dir name="shared">
        <file name="CopyButton.tsx" desc="copy-to-clipboard button"/>
        <file name="InferenceFields.tsx" desc="inference (considered/breaks/opens) fields"/>
      </dir>
      <dir name="sidebar">
        <dir name="maps">
          <file name="MapComposerModal.tsx" desc="investigations sub-UI: MapComposerModal"/>
        </dir>
        <dir name="surveys">
          <file name="CategoryPicker.tsx" desc="surveys/interviews sub-UI: CategoryPicker"/>
          <file name="CopyButton.tsx" desc="surveys/interviews sub-UI: CopyButton"/>
          <file name="InterviewComposerModal.tsx" desc="surveys/interviews sub-UI: InterviewComposerModal"/>
          <file name="InterviewDetailModal.tsx" desc="surveys/interviews sub-UI: InterviewDetailModal"/>
          <file name="SurveyComposerModal.tsx" desc="surveys/interviews sub-UI: SurveyComposerModal"/>
          <file name="SurveyDetailModal.tsx" desc="surveys/interviews sub-UI: SurveyDetailModal"/>
          <file name="SurveyResults.tsx" desc="surveys/interviews sub-UI: SurveyResults"/>
        </dir>
        <file name="ApplyExtensionModal.tsx" desc="apply an extension slice"/>
        <file name="BoardAnnotator.tsx" desc="map annotation editor"/>
        <file name="FileComposerModal.tsx" desc="compose a source file"/>
        <file name="HierarchyModal.tsx" desc="location-hierarchy reorg"/>
        <file name="InterviewPanel.tsx" desc="interviews instrument panel"/>
        <file name="MapPanel.tsx" desc="investigations panel"/>
        <file name="MediaDrive.tsx" desc="the Drive: images/audio"/>
        <file name="MediaPreview.tsx" desc="media preview"/>
        <file name="NarrativeRail.tsx" desc="LEFT RAIL: narrative thumbnails (navigate stories)"/>
        <file name="SourceFileModal.tsx" desc="source-file viewer"/>
        <file name="SurveyPanel.tsx" desc="surveys instrument panel"/>
      </dir>
      <dir name="slides">
        <file name="BeatProfileSlide.tsx" desc="BeatProfile slide"/>
        <file name="BeliefSystemSlide.tsx" desc="BeliefSystem slide"/>
        <file name="CastSlide.tsx" desc="Cast slide"/>
        <file name="ClosingSlide.tsx" desc="Closing slide"/>
        <file name="ForceDecompositionSlide.tsx" desc="ForceDecomposition slide"/>
        <file name="ForcesOverviewSlide.tsx" desc="ForcesOverview slide"/>
        <file name="KeyMomentsSlide.tsx" desc="KeyMoments slide"/>
        <file name="KnowledgeStructureSlide.tsx" desc="KnowledgeStructure slide"/>
        <file name="MechanismSlide.tsx" desc="Mechanism slide"/>
        <file name="PacingProfileSlide.tsx" desc="PacingProfile slide"/>
        <file name="ParadigmLensSlide.tsx" desc="ParadigmLens slide"/>
        <file name="PropositionOverviewSlide.tsx" desc="PropositionOverview slide"/>
        <file name="ReportCardSlide.tsx" desc="ReportCard slide"/>
        <file name="SegmentSlide.tsx" desc="Segment slide"/>
        <file name="ShapeSlide.tsx" desc="Shape slide"/>
        <file name="SlideShell.tsx" desc="SlideShell slide"/>
        <file name="SlidesPlayer.tsx" desc="SlidesPlayer slide"/>
        <file name="SwingAnalysisSlide.tsx" desc="SwingAnalysis slide"/>
        <file name="ThreadLifecycleSlide.tsx" desc="ThreadLifecycle slide"/>
        <file name="TimeFlowSlide.tsx" desc="TimeFlow slide"/>
        <file name="TitleSlide.tsx" desc="Title slide"/>
      </dir>
      <dir name="stage">
        <dir name="variables">
          <file name="BentoTile.tsx" desc="Compass/Variables: BentoTile"/>
          <file name="DashboardChrome.tsx" desc="Compass/Variables: DashboardChrome"/>
          <file name="DispositionEditor.tsx" desc="Compass/Variables: DispositionEditor"/>
          <file name="MetricStrip.tsx" desc="Compass/Variables: MetricStrip"/>
          <file name="ProbabilityBar.tsx" desc="Compass/Variables: ProbabilityBar"/>
          <file name="ScenarioCard.tsx" desc="Compass/Variables: ScenarioCard"/>
          <file name="VariableGridChart.tsx" desc="Compass/Variables: VariableGridChart"/>
          <file name="VariableParallelCoords.tsx" desc="Compass/Variables: VariableParallelCoords"/>
          <file name="VariableRadarChart.tsx" desc="Compass/Variables: VariableRadarChart"/>
          <file name="VariableViewSwitcher.tsx" desc="Compass/Variables: VariableViewSwitcher"/>
        </dir>
        <file name="AudioMiniPlayer.tsx" desc="inline audio mini-player"/>
        <file name="BeliefView.tsx" desc="MIND/Belief: live thread stances / belief system"/>
        <file name="BoardView.tsx" desc="BOARD: map + nested maps + entity avatars"/>
        <file name="CompassView.tsx" desc="MIND/Present+Compass: variable scenarios (Compass)"/>
        <file name="DecisionView.tsx" desc="SCENE/Decision: 2x2 payoff matrix"/>
        <file name="graph-utils.ts" desc="stage/graph helpers"/>
        <file name="NetworkView.tsx" desc="GRAPH/Network: aggregate connection graph"/>
        <file name="PhaseGraphView.tsx" desc="MIND/Mode: PRG Phase graph view"/>
        <file name="PlanCandidatesModal.tsx" desc="plan candidates modal"/>
        <file name="PlanCandidatesView.tsx" desc="parallel plan candidates view"/>
        <file name="ReasoningGraphView.tsx" desc="SCENE/Reasoning: per-arc CRG"/>
        <file name="SceneAudioView.tsx" desc="SCENE/Audio"/>
        <file name="SceneBar.tsx" desc="scene header/info bar"/>
        <file name="ScenePanel.tsx" desc="center bottom narrative panel"/>
        <file name="ScenePlanView.tsx" desc="SCENE/Plan: beat plan"/>
        <file name="SceneProseView.tsx" desc="SCENE/Prose: read/grade/rewrite"/>
        <file name="SearchView.tsx" desc="DRIVER/Search: semantic search + AI synthesis"/>
        <file name="Stage.tsx" desc="THE RENDER DISPATCH: graphViewMode → view component; inline world-graph D3"/>
        <file name="StageBar.tsx" desc="THE VIEW SWITCHER: Capture/Graph/Board/Mind/Scene clusters + sub-tabs"/>
        <file name="StagePalette.tsx" desc="overlay action palette"/>
        <file name="SystemGraphView.tsx" desc="GRAPH/System: system knowledge graph"/>
        <file name="ThreadGraphView.tsx" desc="GRAPH/Threads: thread graph"/>
        <file name="ThreadLogGraphView.tsx" desc="GRAPH/Threads: thread-log lifecycle graph"/>
        <file name="VersionHistoryTree.tsx" desc="prose/plan version history tree"/>
        <file name="WorldGraphView.tsx" desc="GRAPH/World: selected entity inner-world graph"/>
      </dir>
      <dir name="timeline">
        <file name="ActivityLineChart.tsx" desc="activity line chart"/>
        <file name="BranchEval.tsx" desc="branch evaluation panel (review/reconstruct)"/>
        <file name="BranchTreePopover.tsx" desc="branch tree popover"/>
        <file name="EvalBar.tsx" desc="structure eval bar"/>
        <file name="ForceLineChart.tsx" desc="force line chart"/>
        <file name="ForceTimeline.tsx" desc="force timeline (F/W/S charts)"/>
        <file name="PlanEval.tsx" desc="plan eval bar"/>
        <file name="ProseEval.tsx" desc="prose eval bar"/>
        <file name="SceneRangeSelector.tsx" desc="scene range selector"/>
        <file name="TimelineStrip.tsx" desc="bottom scene timeline strip"/>
      </dir>
      <dir name="topbar">
        <file name="ApiKeyModal.tsx" desc="user API keys"/>
        <file name="ApiLogsModal.tsx" desc="API logs viewer modal"/>
        <file name="BeatProfileModal.tsx" desc="beat-profile viewer"/>
        <file name="BranchContextModal.tsx" desc="branch context viewer"/>
        <file name="DefinitionsModal.tsx" desc="definitions reference"/>
        <file name="ExportPackageModal.tsx" desc="export .meridians package"/>
        <file name="FormulaModal.tsx" desc="force-formula reference"/>
        <file name="GameTheoryDashboard.tsx" desc="Decision Matrix rankings / ELO / tags"/>
        <file name="GasMeter.tsx" desc="usage/cost popover ($ pill)"/>
        <file name="ImportPackageModal.tsx" desc="import .meridians package"/>
        <file name="MarkovChainModal.tsx" desc="pacing Markov matrix viewer"/>
        <file name="NarrativeEditModal.tsx" desc="edit narrative meta (title/premise)"/>
        <file name="PatternsModal.tsx" desc="patterns / anti-patterns editor"/>
        <file name="PropositionAnalysisModal.tsx" desc="propositional-logic analysis"/>
        <file name="RegenerateEmbeddingsModal.tsx" desc="re-embed narrative"/>
        <file name="SystemLogModal.tsx" desc="system logs modal"/>
        <file name="ThemeModal.tsx" desc="theme picker (Astral/Dark/Light)"/>
        <file name="TimeFlowModal.tsx" desc="time-flow analysis"/>
        <file name="TopBar.tsx" desc="top menus (View/Analyze/Profiles/Reference/Debug) + right controls"/>
        <file name="UsageModal.tsx" desc="usage detail modal"/>
      </dir>
      <dir name="ui">
        <file name="Markdown.tsx" desc="markdown renderer"/>
      </dir>
      <dir name="wizard">
        <file name="CreationWizard.tsx" desc="new-story-from-premise flow"/>
      </dir>
      <file name="ArchetypeIcon.tsx" desc="narrative-archetype icon"/>
      <file name="CubeCornerBadge.tsx" desc="cube-mode badge"/>
      <file name="Modal.tsx" desc="base modal primitive"/>
    </dir>
    <dir name="hooks">
      <file name="useAssetUrl.ts" desc="blob-URL resolution for stored assets"/>
      <file name="useAudioPlayer.tsx" desc="audio player context"/>
      <file name="useAutoPlay.ts" desc="auto-mode run loop"/>
      <file name="useBulkAudioGenerate.ts" desc="bulk audio generation"/>
      <file name="useBulkEmbed.ts" desc="bulk embedding generation"/>
      <file name="useBulkGenerate.ts" desc="bulk scene generation"/>
      <file name="useBulkStreamPreview.ts" desc="bulk stream preview"/>
      <file name="useFeatureAccess.ts" desc="feature/entitlement gating"/>
      <file name="usePropositionClassification.tsx" desc="proposition classification context"/>
      <file name="useResolvedScene.ts" desc="resolve current scene prose/plan version for branch"/>
      <file name="useScenarios.ts" desc="parallel Branch-Scenarios (Rehearsal) orchestration"/>
    </dir>
    <dir name="lib">
      <dir name="ai">
        <dir name="reasoning-graph">
          <file name="shared.ts" desc="CRG shared (budget/scale/valid sets)"/>
          <file name="types.ts" desc="CRG node/edge types"/>
          <file name="validate.ts" desc="CRG node-reference validation"/>
        </dir>
        <file name="api.ts" desc="callGenerate / callGenerateStream — the LLM boundary"/>
        <file name="branch-chat.ts" desc="streamBranchChatTurn"/>
        <file name="candidates.ts" desc="runPlanCandidates"/>
        <file name="capture.ts" desc="generateDriverEntry"/>
        <file name="context.ts" desc="builds world/scene/outline/compass/mode/game context blocks"/>
        <file name="diagnose.ts" desc="diagnoseError (error → severity/retryable/repairable)"/>
        <file name="errors.ts" desc="FatalApiError (401/402/403)"/>
        <file name="game-analysis.ts" desc="generateSceneGameAnalysis (2x2 decomposition)"/>
        <file name="hierarchy.ts" desc="reorganizeLocationHierarchy"/>
        <file name="image-prompt.ts" desc="suggestImagePrompt"/>
        <file name="index.ts" desc="barrel exports"/>
        <file name="ingest.ts" desc="prose-profile ingest / taste-test"/>
        <file name="interviews.ts" desc="runInterview + question batch"/>
        <file name="json.ts" desc="parseJson + JsonRepairableError + deterministic cleanup"/>
        <file name="phase-graph.ts" desc="generateMode / buildActiveModeSection (PRG)"/>
        <file name="premise.ts" desc="suggestPremise / refineNarrativeMeta"/>
        <file name="prompts.ts" desc="back-compat re-export of ../prompts"/>
        <file name="prose.ts" desc="rewriteSceneProse"/>
        <file name="reasoning-graph.ts" desc="generateReasoningGraph (CRG) / generateCoordinationPlan"/>
        <file name="reconstruct.ts" desc="reconstructBranch (versioned)"/>
        <file name="repair.ts" desc="two-stage LLM repair: planRepair + repairJsonOutput"/>
        <file name="report.ts" desc="generateReportAnalysis"/>
        <file name="review.ts" desc="reviewBranch / reviewProseQuality / reviewPlanQuality"/>
        <file name="scenes.ts" desc="generateScenes / generateScenePlan / generateSceneProse / reverseEngineerScenePlan"/>
        <file name="search-synthesis.ts" desc="synthesizeSearchResults"/>
        <file name="surveys.ts" desc="runSurvey + respondents"/>
        <file name="validation.ts" desc="schema validators + retryWithValidation"/>
        <file name="variables.ts" desc="extractArcPresent / generatePlanningScenarios / rescoreScenario (Compass)"/>
        <file name="world.ts" desc="generateNarrative / expandWorld / suggestArcDirection / detectPatterns"/>
      </dir>
      <dir name="prompts">
        <dir name="analysis">
          <file name="arcs.ts" desc="analysis prompt: arcs"/>
          <file name="coalesce-outcomes.ts" desc="analysis prompt: coalesce-outcomes"/>
          <file name="fate-reextract.ts" desc="analysis prompt: fate-reextract"/>
          <file name="index.ts" desc="analysis prompt: index"/>
          <file name="meta.ts" desc="analysis prompt: meta"/>
          <file name="priors-synthesis.ts" desc="analysis prompt: priors-synthesis"/>
          <file name="reconcile-entities.ts" desc="analysis prompt: reconcile-entities"/>
          <file name="reconcile-semantic.ts" desc="analysis prompt: reconcile-semantic"/>
          <file name="scene-structure.ts" desc="analysis prompt: scene-structure"/>
          <file name="thread-integration.ts" desc="analysis prompt: thread-integration"/>
          <file name="threading.ts" desc="analysis prompt: threading"/>
        </dir>
        <dir name="calibration">
          <file name="index.ts" desc="calibration prompt: index"/>
          <file name="inference-shape.ts" desc="calibration prompt: inference-shape"/>
          <file name="intensity.ts" desc="calibration prompt: intensity"/>
          <file name="prior-logit.ts" desc="calibration prompt: prior-logit"/>
        </dir>
        <dir name="chat">
          <file name="contexts.ts" desc="chat prompt: contexts"/>
          <file name="discipline.ts" desc="chat prompt: discipline"/>
          <file name="index.ts" desc="chat prompt: index"/>
          <file name="personas.ts" desc="chat prompt: personas"/>
        </dir>
        <dir name="core">
          <file name="beat-taxonomy.ts" desc="core prompt block: beat-taxonomy"/>
          <file name="belief-calibration.ts" desc="core prompt block: belief-calibration"/>
          <file name="deltas.ts" desc="core prompt block: deltas"/>
          <file name="forces.ts" desc="core prompt block: forces"/>
          <file name="game-state.ts" desc="core prompt block: game-state"/>
          <file name="propositions.ts" desc="core prompt block: propositions"/>
          <file name="structural-rules.ts" desc="core prompt block: structural-rules"/>
          <file name="system.ts" desc="core prompt block: system"/>
        </dir>
        <dir name="entities">
          <file name="artifacts.ts" desc="entity prompt: artifacts"/>
          <file name="continuity.ts" desc="entity prompt: continuity"/>
          <file name="integration.ts" desc="entity prompt: integration"/>
          <file name="locations.ts" desc="entity prompt: locations"/>
        </dir>
        <dir name="image">
          <file name="index.ts" desc="image prompt: index"/>
        </dir>
        <dir name="ingest">
          <file name="index.ts" desc="ingest prompt: index"/>
        </dir>
        <dir name="interviews">
          <file name="index.ts" desc="interviews prompt: index"/>
        </dir>
        <dir name="paradigm">
          <file name="analyst.ts" desc="paradigm prompt: analyst"/>
          <file name="compass.ts" desc="paradigm prompt: compass"/>
          <file name="framing.ts" desc="paradigm prompt: framing"/>
          <file name="identity.ts" desc="paradigm prompt: identity"/>
          <file name="index.ts" desc="paradigm prompt: index"/>
          <file name="review.ts" desc="paradigm prompt: review"/>
          <file name="shapes.ts" desc="paradigm prompt: shapes"/>
          <file name="vocabulary.ts" desc="paradigm prompt: vocabulary"/>
        </dir>
        <dir name="phase">
          <file name="application.ts" desc="PRG (Mode) prompt: application"/>
          <file name="generate.ts" desc="PRG (Mode) prompt: generate"/>
          <file name="index.ts" desc="PRG (Mode) prompt: index"/>
        </dir>
        <dir name="premise">
          <file name="index.ts" desc="premise prompt: index"/>
          <file name="refine.ts" desc="premise prompt: refine"/>
        </dir>
        <dir name="principles">
          <file name="index.ts" desc="discipline principle: index"/>
          <file name="paradigm-fidelity.ts" desc="discipline principle: paradigm-fidelity"/>
          <file name="pivot-check.ts" desc="discipline principle: pivot-check"/>
          <file name="power-law-shape.ts" desc="discipline principle: power-law-shape"/>
          <file name="read-mechanisms.ts" desc="discipline principle: read-mechanisms"/>
          <file name="surface-vs-substrate.ts" desc="discipline principle: surface-vs-substrate"/>
        </dir>
        <dir name="prose">
          <file name="format-instructions.ts" desc="prose prompt: format-instructions"/>
          <file name="rewrite.ts" desc="prose prompt: rewrite"/>
        </dir>
        <dir name="reasoning">
          <file name="arc-graph.ts" desc="CRG prompt: arc-graph"/>
          <file name="coordination-plan.ts" desc="CRG prompt: coordination-plan"/>
          <file name="index.ts" desc="CRG prompt: index"/>
          <file name="mode-blocks.ts" desc="CRG prompt: mode-blocks"/>
          <file name="preference-blocks.ts" desc="CRG prompt: preference-blocks"/>
          <file name="principles.ts" desc="CRG prompt: principles"/>
          <file name="sequential-path.ts" desc="CRG prompt: sequential-path"/>
        </dir>
        <dir name="reconstruct">
          <file name="index.ts" desc="reconstruct prompt: index"/>
        </dir>
        <dir name="report">
          <file name="analysis.ts" desc="report prompt: analysis"/>
          <file name="index.ts" desc="report prompt: index"/>
        </dir>
        <dir name="review">
          <file name="branch.ts" desc="review prompt: branch"/>
          <file name="index.ts" desc="review prompt: index"/>
          <file name="plan.ts" desc="review prompt: plan"/>
          <file name="prose.ts" desc="review prompt: prose"/>
        </dir>
        <dir name="scenes">
          <file name="analyze.ts" desc="scene prompt: analyze"/>
          <file name="arc-settings.ts" desc="scene prompt: arc-settings"/>
          <file name="edit.ts" desc="scene prompt: edit"/>
          <file name="extract-propositions.ts" desc="scene prompt: extract-propositions"/>
          <file name="game-theory.ts" desc="scene prompt: game-theory"/>
          <file name="generate.ts" desc="scene prompt: generate"/>
          <file name="plan-format.ts" desc="scene prompt: plan-format"/>
          <file name="plan-user.ts" desc="scene prompt: plan-user"/>
          <file name="plan.ts" desc="scene prompt: plan"/>
          <file name="pov.ts" desc="scene prompt: pov"/>
          <file name="prose-instructions.ts" desc="scene prompt: prose-instructions"/>
          <file name="prose.ts" desc="scene prompt: prose"/>
          <file name="summary.ts" desc="scene prompt: summary"/>
          <file name="thread-lifecycle.ts" desc="scene prompt: thread-lifecycle"/>
        </dir>
        <dir name="search">
          <file name="index.ts" desc="search prompt: index"/>
        </dir>
        <dir name="surveys">
          <file name="index.ts" desc="surveys prompt: index"/>
        </dir>
        <dir name="world">
          <file name="detect-patterns.ts" desc="world prompt: detect-patterns"/>
          <file name="direction.ts" desc="world prompt: direction"/>
          <file name="expand-world.ts" desc="world prompt: expand-world"/>
          <file name="expansion-suggestion.ts" desc="world prompt: expansion-suggestion"/>
          <file name="generate-narrative.ts" desc="world prompt: generate-narrative"/>
          <file name="index.ts" desc="world prompt: index"/>
        </dir>
        <file name="CORE_LANGUAGE.md" desc="embedded vocabulary doc for prompts"/>
        <file name="index.ts" desc="prompts barrel + output-schema re-exports"/>
      </dir>
      <file name="analysis-runner.ts" desc="AnalysisRunner singleton (stage events)"/>
      <file name="analysis-transfer.ts" desc="analysis ↔ narrative transfer"/>
      <file name="api-headers.ts" desc="request headers (user keys)"/>
      <file name="api-logger.ts" desc="per-call cost/token/preview logging"/>
      <file name="asset-manager.ts" desc="façade over embeddings/audio/images/texts + GC"/>
      <file name="attribution.ts" desc="scene attribution helpers"/>
      <file name="audio-store.ts" desc="audio blob store helpers"/>
      <file name="auto-engine.ts" desc="pressure → directive → arc-length"/>
      <file name="beat-profiles.ts" desc="beat Markov matrices + presets"/>
      <file name="belief-export.ts" desc="belief-system export"/>
      <file name="branch-tree.ts" desc="pure branch-tree layout"/>
      <file name="bulk-stream-store.ts" desc="bulk preview stream store"/>
      <file name="clipboard.ts" desc="clipboard helpers"/>
      <file name="constants.ts" desc="models, token tiers, all tuning values"/>
      <file name="db.ts" desc="IndexedDB meridians-main (v4): 7 object stores"/>
      <file name="embeddings.ts" desc="embedding gen/storage/retrieval (OpenAI)"/>
      <file name="epub-export.ts" desc="EPUB export"/>
      <file name="file-conversion.ts" desc="file format conversion"/>
      <file name="game-theory-glossary.ts" desc="axis/shape glossary"/>
      <file name="game-theory-player.ts" desc="player profile / tags"/>
      <file name="game-theory.ts" desc="Nash, ELO, margin score, solo+duel decision math"/>
      <file name="graph-export.ts" desc="graph export"/>
      <file name="graph-styling.ts" desc="graph styling helpers"/>
      <file name="idb.ts" desc="legacy idb wrapper shim"/>
      <file name="location-clusters.ts" desc="location clustering"/>
      <file name="logs-context.tsx" desc="logs context provider"/>
      <file name="map-layout.ts" desc="map layout"/>
      <file name="map-tree-layout.ts" desc="location-hierarchy map-tree layout"/>
      <file name="mechanism-profiles.ts" desc="mechanism profiles"/>
      <file name="narrative-utils.ts" desc="Fate/World/System formulas, rank-Gaussian, cube, activity, swing, grading"/>
      <file name="network-graph.ts" desc="aggregate network graph + tiers/topology"/>
      <file name="pacing-markov.ts" desc="Markov pacing — matrices, sampling, presets"/>
      <file name="pacing-profiles.ts" desc="pacing profile presets"/>
      <file name="package-export.ts" desc=".meridians plaintext ZIP export"/>
      <file name="package-import.ts" desc=".meridians package import"/>
      <file name="persistence.ts" desc="typed API over narratives/meta/apiLogs + migration"/>
      <file name="phase-graph.ts" desc="PRG 'Mode' resolve + GC (getActiveMode/pruneModes)"/>
      <file name="portfolio-analytics.ts" desc="thread-portfolio analytics"/>
      <file name="positions.ts" desc="participation-derived entity positions"/>
      <file name="priors-compact.ts" desc="Driver compaction → SourceFile"/>
      <file name="proposition-classify.ts" desc="proposition classification"/>
      <file name="reasoning-node-colors.ts" desc="CRG node colour map"/>
      <file name="research-categories.ts" desc="8 research lenses guidance"/>
      <file name="research-export.ts" desc="surveys/interviews export"/>
      <file name="resolve-api-key.ts" desc="API key resolution"/>
      <file name="scenarios-engine.ts" desc="parallel scenario batch: direction + virtual state + pool"/>
      <file name="scenarios-remap.ts" desc="ID remap for parallel commits"/>
      <file name="scenarios-state.ts" desc="virtual narrative-state helpers for in-flight runs"/>
      <file name="scene-export.ts" desc="scene export"/>
      <file name="scene-filter.ts" desc="scene filtering"/>
      <file name="search.ts" desc="semantic search via cosine similarity"/>
      <file name="slides-data.ts" desc="Review deck computation (whole-branch)"/>
      <file name="store.tsx" desc="THE STORE: AppState, ~110 actions, reducer, persistence effects; useStore()"/>
      <file name="system-graph.ts" desc="system knowledge graph builder"/>
      <file name="system-logger.ts" desc="typed system event logging"/>
      <file name="text-analysis.ts" desc="corpus → NarrativeState assembly"/>
      <file name="theme-context.tsx" desc="theme context (Astral/Dark/Light)"/>
      <file name="thread-category.ts" desc="thread categorisation"/>
      <file name="thread-log.ts" desc="stance/threadLog math; applyThreadDelta (single delta entry point)"/>
      <file name="time-deltas.ts" desc="in-story time delta helpers"/>
      <file name="title-detect.ts" desc="title detection"/>
      <file name="ui-utils.ts" desc="misc UI utilities"/>
      <file name="wizard-context.tsx" desc="creation-wizard context"/>
      <file name="world-graph.ts" desc="entity inner-world graph builder (applyWorldDelta)"/>
    </dir>
    <dir name="types">
      <file name="narrative.ts" desc="domain type catalog (~3k lines): NarrativeState, Scene, entities, Thread/Stance, Arc, Branch, Variable, reasoning-graph, Mode (PRG), game theory, AppState, GraphViewMode, InspectorContext"/>
      <file name="scenarios.ts" desc="ScenarioRun batch-state types"/>
    </dir>
  </dir>
  <dir name="scripts">
    <file name="classify-propositions.mjs" desc="offline proposition-classification script"/>
    <file name="gen-tree.mjs" desc="this generator (structure + annotations)"/>
  </dir>
</repo>
```
