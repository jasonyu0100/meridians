#!/usr/bin/env node
// Generates TREE.md — a complete XML map of the repo file structure with a
// purpose annotation per file. Structure is read from the filesystem (always
// complete + current); annotations live here (ANN overrides + DIR_DEFAULT for
// homogeneous folders). Re-run after adding files:  node scripts/gen-tree.mjs
//
// Coverage of annotations is printed to stderr so gaps are visible.

import { readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = process.cwd();
const IGNORE = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "out"]);
const EXT = /\.(tsx?|mjs|md)$/;

// ── Per-file annotations (path relative to repo root) ───────────────────────
const ANN = {
  // root docs
  "README.md": "project readme",
  "CLAUDE.md": "project instructions + engine concepts (NOTE: drifted — defer to TREE/MERMAID)",
  "MERMAID.md": "whole-app connection diagrams (top-down)",
  "TREE.md": "this file — generated XML file-structure map",
  "ROADMAP.md": "build spec: Part A iterative features → Part B platform changes",
  "LANGUAGE.md": "canonical glossary / vocabulary",
  "DEFINITIONS.md": "game-theory + technical taxonomy definitions",

  // app routes
  "src/app/layout.tsx": "root HTML layout",
  "src/app/providers.tsx": "provider stack: Theme → Store → Wizard → Logs",
  "src/app/page.tsx": "LANDING / home (story picker; useIsMobile gate)",
  "src/app/dashboard/page.tsx": "dashboard story picker",
  "src/app/analysis/page.tsx": "TEXT ANALYSIS — corpus ingest (create) via AnalysisShell",
  "src/app/extensions/page.tsx": "extensions index",
  "src/app/extensions/[id]/page.tsx": "EXTEND a narrative from new corpus (AnalysisShell kind=extend)",
  "src/app/case-analysis/page.tsx": "case-analysis page",
  "src/app/manifesto/page.tsx": "MANIFESTO — vision/theory long-form",
  "src/app/narrative/[id]/page.tsx": "THE WORKSPACE (SeriesPage): mounts AppShell; URL id = active narrative; window-event modal triggers",
  "src/app/api/generate/route.ts": "OpenRouter chat (SSE + JSON); key resolve; web tools; reasoning budget",
  "src/app/api/embeddings/route.ts": "OpenAI text-embedding-3-small (1536-dim)",
  "src/app/api/generate-image/route.ts": "OpenRouter prompt-enhance → Replicate Seedream",
  "src/app/api/generate-cover/route.ts": "Replicate cover image",
  "src/app/api/generate-audio/route.ts": "OpenAI TTS (tts-1)",
  "src/app/api/chat/route.ts": "chat proxy",

  // types
  "src/types/narrative.ts": "domain type catalog (~3k lines): NarrativeState, Scene, entities, Thread/Stance, Arc, Branch, Variable, reasoning-graph, Mode (PRG), game theory, AppState, GraphViewMode, InspectorContext",
  "src/types/scenarios.ts": "ScenarioRun batch-state types",

  // hooks
  "src/hooks/useAudioPlayer.tsx": "audio player context",
  "src/hooks/usePropositionClassification.tsx": "proposition classification context",
  "src/hooks/useAutoPlay.ts": "auto-mode run loop",
  "src/hooks/useScenarios.ts": "parallel Branch-Scenarios (Rehearsal) orchestration",
  "src/hooks/useResolvedScene.ts": "resolve current scene prose/plan version for branch",
  "src/hooks/useAssetUrl.ts": "blob-URL resolution for stored assets",
  "src/hooks/useFeatureAccess.ts": "feature/entitlement gating",
  "src/hooks/useBulkGenerate.ts": "bulk scene generation",
  "src/hooks/useBulkAudioGenerate.ts": "bulk audio generation",
  "src/hooks/useBulkEmbed.ts": "bulk embedding generation",
  "src/hooks/useBulkStreamPreview.ts": "bulk stream preview",

  // components — top level
  "src/components/Modal.tsx": "base modal primitive",
  "src/components/ArchetypeIcon.tsx": "narrative-archetype icon",
  "src/components/CubeCornerBadge.tsx": "cube-mode badge",

  // layout
  "src/components/layout/AppShell.tsx": "WORKSPACE FRAME: TopBar + NarrativeRail + Sidebar + center + SidePanel",
  "src/components/layout/ProseProfilePanel.tsx": "prose-profile editor panel",

  // topbar
  "src/components/topbar/TopBar.tsx": "top menus (View/Analyze/Profiles/Reference/Debug) + right controls",
  "src/components/topbar/GasMeter.tsx": "usage/cost popover ($ pill)",
  "src/components/topbar/ThemeModal.tsx": "theme picker (Astral/Dark/Light)",
  "src/components/topbar/GameTheoryDashboard.tsx": "Decision Matrix rankings / ELO / tags",
  "src/components/topbar/FormulaModal.tsx": "force-formula reference",
  "src/components/topbar/DefinitionsModal.tsx": "definitions reference",
  "src/components/topbar/ApiKeyModal.tsx": "user API keys",
  "src/components/topbar/ApiLogsModal.tsx": "API logs viewer modal",
  "src/components/topbar/SystemLogModal.tsx": "system logs modal",
  "src/components/topbar/UsageModal.tsx": "usage detail modal",
  "src/components/topbar/ExportPackageModal.tsx": "export .meridians package",
  "src/components/topbar/ImportPackageModal.tsx": "import .meridians package",
  "src/components/topbar/NarrativeEditModal.tsx": "edit narrative meta (title/premise)",
  "src/components/topbar/PatternsModal.tsx": "patterns / anti-patterns editor",
  "src/components/topbar/BeatProfileModal.tsx": "beat-profile viewer",
  "src/components/topbar/MarkovChainModal.tsx": "pacing Markov matrix viewer",
  "src/components/topbar/PropositionAnalysisModal.tsx": "propositional-logic analysis",
  "src/components/topbar/RegenerateEmbeddingsModal.tsx": "re-embed narrative",
  "src/components/topbar/TimeFlowModal.tsx": "time-flow analysis",
  "src/components/topbar/BranchContextModal.tsx": "branch context viewer",

  // canvas (center views)
  "src/components/stage/StageBar.tsx": "THE VIEW SWITCHER: Capture/Graph/Board/Mind/Scene clusters + sub-tabs",
  "src/components/stage/Stage.tsx": "THE RENDER DISPATCH: graphViewMode → view component; inline world-graph D3",
  "src/components/stage/StagePalette.tsx": "overlay action palette",
  "src/components/stage/BoardView.tsx": "BOARD: map + nested maps + entity avatars",
  "src/components/stage/BeliefView.tsx": "MIND/Belief: live thread stances / belief system",
  "src/components/stage/CompassView.tsx": "MIND/Present+Compass: variable scenarios (Compass)",
  "src/components/stage/PhaseGraphView.tsx": "MIND/Mode: PRG Phase graph view",
  "src/components/stage/ReasoningGraphView.tsx": "SCENE/Reasoning: per-arc CRG",
  "src/components/stage/ScenePlanView.tsx": "SCENE/Plan: beat plan",
  "src/components/stage/SceneProseView.tsx": "SCENE/Prose: read/grade/rewrite",
  "src/components/stage/SceneAudioView.tsx": "SCENE/Audio",
  "src/components/stage/DecisionView.tsx": "SCENE/Decision: 2x2 payoff matrix",
  "src/components/stage/SceneBar.tsx": "scene header/info bar",
  "src/components/stage/SystemGraphView.tsx": "GRAPH/System: system knowledge graph",
  "src/components/stage/NetworkView.tsx": "GRAPH/Network: aggregate connection graph",
  "src/components/stage/ThreadGraphView.tsx": "GRAPH/Threads: thread graph",
  "src/components/stage/ThreadLogGraphView.tsx": "GRAPH/Threads: thread-log lifecycle graph",
  "src/components/stage/WorldGraphView.tsx": "GRAPH/World: selected entity inner-world graph",
  "src/components/stage/PlanCandidatesView.tsx": "parallel plan candidates view",
  "src/components/stage/PlanCandidatesModal.tsx": "plan candidates modal",
  "src/components/stage/SearchView.tsx": "DRIVER/Search: semantic search + AI synthesis",
  "src/components/stage/VersionHistoryTree.tsx": "prose/plan version history tree",
  "src/components/stage/AudioMiniPlayer.tsx": "inline audio mini-player",
  "src/components/stage/graph-utils.ts": "stage/graph helpers",

  // inspector
  "src/components/inspector/InspectorPanel.tsx": "RIGHT INSPECTOR: tab registry + icon rail; renderInspector()",
  "src/components/inspector/CharacterDetail.tsx": "character inspector body",
  "src/components/inspector/LocationDetail.tsx": "location inspector body",
  "src/components/inspector/ArtifactDetail.tsx": "artifact inspector body",
  "src/components/inspector/ThreadDetail.tsx": "thread inspector body",
  "src/components/inspector/ArcDetail.tsx": "arc inspector body",
  "src/components/inspector/SceneDetail.tsx": "scene inspector body",
  "src/components/inspector/WorldNodeDetail.tsx": "world-graph node detail",
  "src/components/inspector/KnowledgeDetail.tsx": "system-knowledge node detail",
  "src/components/inspector/KnowledgePanel.tsx": "knowledge inspector panel",
  "src/components/inspector/ThreadLogNodeDetail.tsx": "thread-log node detail",
  "src/components/inspector/ReasoningNodeDetail.tsx": "CRG node detail",
  "src/components/inspector/PhaseNodeDetail.tsx": "PRG (Mode) node detail",
  "src/components/inspector/AttributionsSection.tsx": "scene attributions section",
  "src/components/inspector/ImagePromptEditor.tsx": "entity image-prompt editor",
  "src/components/inspector/InlineEdit.tsx": "inline field editor",
  "src/components/inspector/CollapsibleSection.tsx": "collapsible section primitive",
  "src/components/inspector/EmptyState.tsx": "inspector empty state",

  // driver
  "src/components/capture/CaptureView.tsx": "Capture/Priors: Queue list + Search sub-tab host",
  "src/components/capture/CapturePalette.tsx": "create/generate/synthesise palette",
  "src/components/capture/CompactPreviewModal.tsx": "compact-into-file preview/apply",

  // generation
  "src/components/generation/GeneratePanel.tsx": "arc continuation / world expansion",
  "src/components/generation/RunBar.tsx": "run-status bar (auto / scenarios / bulk)",
  "src/components/generation/GuidanceFields.tsx": "direction/constraint inputs",
  "src/components/generation/ThinkingPicker.tsx": "thinking-mode picker",
  "src/components/generation/ThinkingAnimation.tsx": "D3 thinking-mode animation",
  "src/components/generation/ReasoningStream.tsx": "live reasoning stream view",
  "src/components/generation/ReasoningGraphModal.tsx": "CRG modal",
  "src/components/generation/BranchModal.tsx": "branch create/switch",
  "src/components/generation/BranchChat.tsx": "chat over a branch substrate",
  "src/components/generation/BranchScopeControl.tsx": "branch-chat scope control",
  "src/components/generation/CoordinationPlanModal.tsx": "coordination-plan viewer",
  "src/components/generation/CoordinationPlanSetupModal.tsx": "coordination-plan setup",
  "src/components/generation/CoordinationPlanIndicator.tsx": "coordination-plan pointer indicator",
  "src/components/generation/MarkovGraph.tsx": "pacing Markov graph",
  "src/components/generation/PacingStrip.tsx": "pacing sequence strip",

  // scenarios
  "src/components/scenarios/ScenariosPanel.tsx": "multi-scenario parallel branch UI",
  "src/components/scenarios/ScenariosBar.tsx": "scenarios run control bar",
  "src/components/scenarios/ScenarioAnalytics.tsx": "scenario cohort analytics",

  // sidebar
  "src/components/sidebar/NarrativeRail.tsx": "LEFT RAIL: narrative thumbnails (navigate stories)",
  "src/components/layout/DrivePanel.tsx": "left resizable sidebar (hosts the Drive)",
  "src/components/sidebar/MediaDrive.tsx": "the Drive: images/audio",
  "src/components/sidebar/MediaPreview.tsx": "media preview",
  "src/components/sidebar/BoardAnnotator.tsx": "map annotation editor",
  "src/components/inspector/CompassPanel.tsx": "inspector Compass tab",
  "src/components/inspector/ChatPanel.tsx": "inspector Chat tab",
  "src/components/inspector/ThreadsPanel.tsx": "inspector Threads tab",
  "src/components/inspector/FilesPanel.tsx": "inspector Files tab",
  "src/components/sidebar/SurveyPanel.tsx": "surveys instrument panel",
  "src/components/sidebar/InterviewPanel.tsx": "interviews instrument panel",
  "src/components/sidebar/MapPanel.tsx": "investigations panel",
  "src/components/sidebar/SourceFileModal.tsx": "source-file viewer",
  "src/components/sidebar/FileComposerModal.tsx": "compose a source file",
  "src/components/sidebar/ApplyExtensionModal.tsx": "apply an extension slice",
  "src/components/sidebar/HierarchyModal.tsx": "location-hierarchy reorg",

  // misc component dirs
  "src/components/stage/ScenePanel.tsx": "center bottom narrative panel",
  "src/components/narratives/NarrativesScreen.tsx": "home story grid",
  "src/components/cards/StoryCard.tsx": "story card",
  "src/components/landing/LandingTopbar.tsx": "landing top bar",
  "src/components/wizard/CreationWizard.tsx": "new-story-from-premise flow",
  "src/components/analysis/AnalysisShell.tsx": "shared corpus-ingest UI (create | extend)",
  "src/components/report/NarrativeReport.tsx": "narrative analysis report",
  "src/components/analytics/ForceAnalytics.tsx": "force tracker analytics",
  "src/components/analytics/CastAnalytics.tsx": "cast analytics",
  "src/components/auto/AutoSettingsPanel.tsx": "auto-mode settings",
  "src/components/apilogs/ApiLogsViewer.tsx": "API log viewer",
  "src/components/apilogs/ErrorDiagnosis.tsx": "diagnostic + Repair UI",
  "src/components/settings/StorySettingsModal.tsx": "story settings modal",
  "src/components/effects/StarField.tsx": "starfield background effect",
  "src/components/shared/CopyButton.tsx": "copy-to-clipboard button",
  "src/components/shared/InferenceFields.tsx": "inference (considered/breaks/opens) fields",
  "src/components/ui/Markdown.tsx": "markdown renderer",
  "src/components/icons/index.ts": "icon barrel export",

  // lib — store + persistence
  "src/lib/store.tsx": "THE STORE: AppState, ~110 actions, reducer, persistence effects; useStore()",
  "src/lib/constants.ts": "models, token tiers, all tuning values",
  "src/lib/db.ts": "IndexedDB meridians-main (v4): 7 object stores",
  "src/lib/idb.ts": "legacy idb wrapper shim",
  "src/lib/persistence.ts": "typed API over narratives/meta/apiLogs + migration",
  "src/lib/asset-manager.ts": "façade over embeddings/audio/images/texts + GC",
  "src/lib/audio-store.ts": "audio blob store helpers",
  "src/lib/bulk-stream-store.ts": "bulk preview stream store",
  // lib — engine
  "src/lib/narrative-utils.ts": "Fate/World/System formulas, rank-Gaussian, cube, activity, swing, grading",
  "src/lib/thread-log.ts": "stance/threadLog math; applyThreadDelta (single delta entry point)",
  "src/lib/game-theory.ts": "Nash, ELO, margin score, solo+duel decision math",
  "src/lib/game-theory-player.ts": "player profile / tags",
  "src/lib/game-theory-glossary.ts": "axis/shape glossary",
  "src/lib/world-graph.ts": "entity inner-world graph builder (applyWorldDelta)",
  "src/lib/system-graph.ts": "system knowledge graph builder",
  "src/lib/network-graph.ts": "aggregate network graph + tiers/topology",
  "src/lib/phase-graph.ts": "PRG 'Mode' resolve + GC (getActiveMode/pruneModes)",
  "src/lib/positions.ts": "participation-derived entity positions",
  "src/lib/branch-tree.ts": "pure branch-tree layout",
  "src/lib/beat-profiles.ts": "beat Markov matrices + presets",
  "src/lib/mechanism-profiles.ts": "mechanism profiles",
  "src/lib/pacing-markov.ts": "Markov pacing — matrices, sampling, presets",
  "src/lib/pacing-profiles.ts": "pacing profile presets",
  "src/lib/location-clusters.ts": "location clustering",
  "src/lib/map-layout.ts": "map layout",
  "src/lib/map-tree-layout.ts": "location-hierarchy map-tree layout",
  "src/lib/attribution.ts": "scene attribution helpers",
  "src/lib/time-deltas.ts": "in-story time delta helpers",
  "src/lib/thread-category.ts": "thread categorisation",
  "src/lib/proposition-classify.ts": "proposition classification",
  "src/lib/scene-filter.ts": "scene filtering",
  "src/lib/title-detect.ts": "title detection",
  "src/lib/reasoning-node-colors.ts": "CRG node colour map",
  "src/lib/graph-styling.ts": "graph styling helpers",
  // lib — search/embeddings
  "src/lib/embeddings.ts": "embedding gen/storage/retrieval (OpenAI)",
  "src/lib/search.ts": "semantic search via cosine similarity",
  // lib — scenarios
  "src/lib/scenarios-engine.ts": "parallel scenario batch: direction + virtual state + pool",
  "src/lib/scenarios-state.ts": "virtual narrative-state helpers for in-flight runs",
  "src/lib/scenarios-remap.ts": "ID remap for parallel commits",
  // lib — analysis/ingest
  "src/lib/text-analysis.ts": "corpus → NarrativeState assembly",
  "src/lib/analysis-runner.ts": "AnalysisRunner singleton (stage events)",
  "src/lib/analysis-transfer.ts": "analysis ↔ narrative transfer",
  "src/lib/priors-compact.ts": "Driver compaction → SourceFile",
  // lib — auto/slides/portfolio
  "src/lib/auto-engine.ts": "pressure → directive → arc-length",
  "src/lib/slides-data.ts": "Review deck computation (whole-branch)",
  "src/lib/portfolio-analytics.ts": "thread-portfolio analytics",
  // lib — export/import
  "src/lib/package-export.ts": ".meridians plaintext ZIP export",
  "src/lib/package-import.ts": ".meridians package import",
  "src/lib/scene-export.ts": "scene export",
  "src/lib/graph-export.ts": "graph export",
  "src/lib/belief-export.ts": "belief-system export",
  "src/lib/research-export.ts": "surveys/interviews export",
  "src/lib/epub-export.ts": "EPUB export",
  "src/lib/file-conversion.ts": "file format conversion",
  // lib — plumbing/observability/context
  "src/lib/api-headers.ts": "request headers (user keys)",
  "src/lib/resolve-api-key.ts": "API key resolution",
  "src/lib/api-logger.ts": "per-call cost/token/preview logging",
  "src/lib/system-logger.ts": "typed system event logging",
  "src/lib/logs-context.tsx": "logs context provider",
  "src/lib/theme-context.tsx": "theme context (Astral/Dark/Light)",
  "src/lib/wizard-context.tsx": "creation-wizard context",
  "src/lib/research-categories.ts": "8 research lenses guidance",
  "src/lib/clipboard.ts": "clipboard helpers",
  "src/lib/ui-utils.ts": "misc UI utilities",

  // lib/ai
  "src/lib/ai/api.ts": "callGenerate / callGenerateStream — the LLM boundary",
  "src/lib/ai/context.ts": "builds world/scene/outline/compass/mode/game context blocks",
  "src/lib/ai/index.ts": "barrel exports",
  "src/lib/ai/prompts.ts": "back-compat re-export of ../prompts",
  "src/lib/ai/scenes.ts": "generateScenes / generateScenePlan / generateSceneProse / reverseEngineerScenePlan",
  "src/lib/ai/prose.ts": "rewriteSceneProse",
  "src/lib/ai/world.ts": "generateNarrative / expandWorld / suggestArcDirection / detectPatterns",
  "src/lib/ai/review.ts": "reviewBranch / reviewProseQuality / reviewPlanQuality",
  "src/lib/ai/reconstruct.ts": "reconstructBranch (versioned)",
  "src/lib/ai/variables.ts": "extractArcPresent / generatePlanningScenarios / rescoreScenario (Compass)",
  "src/lib/ai/reasoning-graph.ts": "generateReasoningGraph (CRG) / generateCoordinationPlan",
  "src/lib/ai/reasoning-graph/types.ts": "CRG node/edge types",
  "src/lib/ai/reasoning-graph/shared.ts": "CRG shared (budget/scale/valid sets)",
  "src/lib/ai/reasoning-graph/validate.ts": "CRG node-reference validation",
  "src/lib/ai/phase-graph.ts": "generateMode / buildActiveModeSection (PRG)",
  "src/lib/ai/game-analysis.ts": "generateSceneGameAnalysis (2x2 decomposition)",
  "src/lib/ai/capture.ts": "generateDriverEntry",
  "src/lib/ai/ingest.ts": "prose-profile ingest / taste-test",
  "src/lib/ai/premise.ts": "suggestPremise / refineNarrativeMeta",
  "src/lib/ai/candidates.ts": "runPlanCandidates",
  "src/lib/ai/surveys.ts": "runSurvey + respondents",
  "src/lib/ai/interviews.ts": "runInterview + question batch",
  "src/lib/ai/branch-chat.ts": "streamBranchChatTurn",
  "src/lib/ai/search-synthesis.ts": "synthesizeSearchResults",
  "src/lib/ai/image-prompt.ts": "suggestImagePrompt",
  "src/lib/ai/report.ts": "generateReportAnalysis",
  "src/lib/ai/hierarchy.ts": "reorganizeLocationHierarchy",
  "src/lib/ai/json.ts": "parseJson + JsonRepairableError + deterministic cleanup",
  "src/lib/ai/diagnose.ts": "diagnoseError (error → severity/retryable/repairable)",
  "src/lib/ai/repair.ts": "two-stage LLM repair: planRepair + repairJsonOutput",
  "src/lib/ai/errors.ts": "FatalApiError (401/402/403)",
  "src/lib/ai/validation.ts": "schema validators + retryWithValidation",

  // timeline
  "src/components/timeline/TimelineStrip.tsx": "bottom scene timeline strip",
  "src/components/timeline/ForceTimeline.tsx": "force timeline (F/W/S charts)",
  "src/components/timeline/ForceLineChart.tsx": "force line chart",
  "src/components/timeline/ActivityLineChart.tsx": "activity line chart",
  "src/components/timeline/SceneRangeSelector.tsx": "scene range selector",
  "src/components/timeline/BranchEval.tsx": "branch evaluation panel (review/reconstruct)",
  "src/components/timeline/BranchTreePopover.tsx": "branch tree popover",
  "src/components/timeline/EvalBar.tsx": "structure eval bar",
  "src/components/timeline/PlanEval.tsx": "plan eval bar",
  "src/components/timeline/ProseEval.tsx": "prose eval bar",

  // prompts barrels
  "src/lib/prompts/index.ts": "prompts barrel + output-schema re-exports",
  "src/lib/prompts/CORE_LANGUAGE.md": "embedded vocabulary doc for prompts",

  // tests / scripts
  "src/__tests__/setup.ts": "vitest setup",
  "src/__tests__/fixtures/test-embeddings.ts": "test fixture: embeddings",
  "scripts/gen-tree.mjs": "this generator (structure + annotations)",
  "scripts/classify-propositions.mjs": "offline proposition-classification script",
};

// ── Per-directory default annotation (filename → desc) ──────────────────────
const stem = (n) => basename(n).replace(/\.(tsx?|mjs|md)$/, "");
const DIR_DEFAULT = {
  "src/__tests__": (n) => `test: ${stem(n).replace(/\.test$/, "")}`,
  "src/__tests__/fixtures": (n) => `test fixture: ${stem(n)}`,
  "src/components/icons": (n) => `${stem(n).replace("Icons", "")} icon set`,
  "src/components/slides": (n) => `${stem(n).replace(/Slide$/, "")} slide`,
  "src/components/stage/variables": (n) => `Compass/Variables: ${stem(n)}`,
  "src/components/sidebar/surveys": (n) => `surveys/interviews sub-UI: ${stem(n)}`,
  "src/components/sidebar/maps": (n) => `investigations sub-UI: ${stem(n)}`,
  "src/lib/prompts/core": (n) => `core prompt block: ${stem(n)}`,
  "src/lib/prompts/scenes": (n) => `scene prompt: ${stem(n)}`,
  "src/lib/prompts/world": (n) => `world prompt: ${stem(n)}`,
  "src/lib/prompts/entities": (n) => `entity prompt: ${stem(n)}`,
  "src/lib/prompts/reasoning": (n) => `CRG prompt: ${stem(n)}`,
  "src/lib/prompts/phase": (n) => `PRG (Mode) prompt: ${stem(n)}`,
  "src/lib/prompts/analysis": (n) => `analysis prompt: ${stem(n)}`,
  "src/lib/prompts/review": (n) => `review prompt: ${stem(n)}`,
  "src/lib/prompts/reconstruct": (n) => `reconstruct prompt: ${stem(n)}`,
  "src/lib/prompts/calibration": (n) => `calibration prompt: ${stem(n)}`,
  "src/lib/prompts/paradigm": (n) => `paradigm prompt: ${stem(n)}`,
  "src/lib/prompts/principles": (n) => `discipline principle: ${stem(n)}`,
  "src/lib/prompts/chat": (n) => `chat prompt: ${stem(n)}`,
  "src/lib/prompts/prose": (n) => `prose prompt: ${stem(n)}`,
  "src/lib/prompts/surveys": (n) => `surveys prompt: ${stem(n)}`,
  "src/lib/prompts/interviews": (n) => `interviews prompt: ${stem(n)}`,
  "src/lib/prompts/search": (n) => `search prompt: ${stem(n)}`,
  "src/lib/prompts/image": (n) => `image prompt: ${stem(n)}`,
  "src/lib/prompts/ingest": (n) => `ingest prompt: ${stem(n)}`,
  "src/lib/prompts/premise": (n) => `premise prompt: ${stem(n)}`,
  "src/lib/prompts/report": (n) => `report prompt: ${stem(n)}`,
};

const ROOT_DOCS = ["README.md", "CLAUDE.md", "MERMAID.md", "TREE.md", "ROADMAP.md", "LANGUAGE.md", "DEFINITIONS.md"];

let total = 0, annotated = 0;
const missing = [];

function descFor(relPath, name, dir) {
  if (ANN[relPath]) return ANN[relPath];
  if (DIR_DEFAULT[dir]) return DIR_DEFAULT[dir](name);
  return null;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function walk(absDir, relDir, indent) {
  const entries = readdirSync(absDir, { withFileTypes: true })
    .filter((e) => !IGNORE.has(e.name) && !e.name.startsWith("."))
    .filter((e) => e.isDirectory() || EXT.test(e.name))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  const lines = [];
  const pad = "  ".repeat(indent);
  for (const e of entries) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const inner = walk(join(absDir, e.name), rel, indent + 1);
      if (inner.length) {
        lines.push(`${pad}<dir name="${esc(e.name)}">`);
        lines.push(...inner);
        lines.push(`${pad}</dir>`);
      }
    } else {
      total++;
      const d = descFor(rel, e.name, relDir);
      if (d) annotated++; else missing.push(rel);
      lines.push(d ? `${pad}<file name="${esc(e.name)}" desc="${esc(d)}"/>` : `${pad}<file name="${esc(e.name)}"/>`);
    }
  }
  return lines;
}

const body = [];
body.push("<repo name=\"meridians\">");
body.push("  <docs>");
for (const doc of ROOT_DOCS) {
  if (!existsSync(join(ROOT, doc))) continue;
  total++; annotated += ANN[doc] ? 1 : 0;
  body.push(`    <file name="${doc}" desc="${esc(ANN[doc] || "")}"/>`);
}
body.push("  </docs>");
body.push('  <dir name="src">');
body.push(...walk(join(ROOT, "src"), "src", 2));
body.push("  </dir>");
if (existsSync(join(ROOT, "scripts"))) {
  body.push('  <dir name="scripts">');
  body.push(...walk(join(ROOT, "scripts"), "scripts", 2));
  body.push("  </dir>");
}
body.push("</repo>");

const out = `# Meridians — File Tree

> **Generated** by \`scripts/gen-tree.mjs\` (structure from the filesystem — always complete + current; \`desc\` annotations live in the generator). Regenerate: \`node scripts/gen-tree.mjs\`. Companion to [MERMAID.md](MERMAID.md). Stack: Next.js 16 · React 19 · TypeScript · Tailwind v4 · D3 · IndexedDB.
>
> Coverage: ${annotated}/${total} files annotated.

\`\`\`xml
${body.join("\n")}
\`\`\`
`;

writeFileSync(join(ROOT, "TREE.md"), out);
process.stderr.write(`TREE.md written — ${annotated}/${total} annotated. ${missing.length} missing:\n`);
process.stderr.write(missing.map((m) => "  " + m).join("\n") + "\n");
