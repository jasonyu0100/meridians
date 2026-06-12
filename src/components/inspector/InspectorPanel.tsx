"use client";

// InspectorPanel — right-side inspector shell routing selected entities to their detail/research views.

import ChatPanel from "@/components/inspector/ChatPanel";
import SurveyPanel from "@/components/sidebar/SurveyPanel";
import InterviewPanel from "@/components/sidebar/InterviewPanel";
import MapPanel from "@/components/sidebar/MapPanel";
import LearningPanel from "@/components/sidebar/LearningPanel";
import CompassPanel from "@/components/inspector/CompassPanel";
import FilesPanel from "@/components/inspector/FilesPanel";
import ThreadsPanel from "@/components/inspector/ThreadsPanel";
import KnowledgePanel from "./KnowledgePanel";
import BranchEval from "@/components/timeline/BranchEval";
import PlanEval from "@/components/timeline/PlanEval";
import ProseEval from "@/components/timeline/ProseEval";
import { type SceneRange } from "@/components/timeline/SceneRangeSelector";
import { useStore } from "@/lib/state/store";
import type { WorldBuild } from "@/types/narrative";
import { isScene, type TimelineEntry } from "@/types/narrative";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ArcDetail from "./ArcDetail";
import ArtifactDetail from "./ArtifactDetail";
import CharacterDetail from "./CharacterDetail";
import WorldNodeDetail from "./WorldNodeDetail";
import EmptyState from "./EmptyState";
import KnowledgeDetail from "./KnowledgeDetail";
import LocationDetail from "./LocationDetail";
import SceneDetail from "./SceneDetail";
import ThreadDetail from "./ThreadDetail";
import ThreadLogNodeDetail from "./ThreadLogNodeDetail";
import StreamDetail from "./StreamDetail";
import StreamPriorDetail from "./StreamPriorDetail";
import MergeDetail from "./MergeDetail";
import ReasoningNodeDetail from "./ReasoningNodeDetail";
import PhaseNodeDetail from "./PhaseNodeDetail";
import TopicDetail from "./TopicDetail";
import QuestionDetail from "./QuestionDetail";
import {
  IconEye,
  IconChat,
  IconFolder,
  IconLightbulb,
  IconList,
  IconUser,
  IconReasoning,
  IconCompass,
  IconScorecard,
  IconThread,
  IconCoverage,
  IconChevronLeft,
  IconChevronRight,
} from "@/components/icons";
import type { ComponentType, SVGProps } from "react";

type Tab =
  | "inspector"
  | "chat"
  | "threads"
  | "files"
  | "knowledge"
  | "surveys"
  | "interviews"
  | "maps"
  | "compass"
  | "learning"
  | "eval";

const TAB_LABELS: Record<Tab, string> = {
  inspector: "Inspector",
  chat: "Chat",
  threads: "Threads",
  files: "Files",
  knowledge: "Knowledge",
  surveys: "Surveys",
  interviews: "Interviews",
  maps: "Maps",
  compass: "Compass",
  learning: "Coverage",
  eval: "Review",
};

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

function RailTabButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: IconCmp;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [tipPos, setTipPos] = useState<{ top: number; right: number } | null>(null);

  const showTip = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setTipPos({ top: r.top + r.height / 2, right: window.innerWidth - r.left + 8 });
  };
  const hideTip = () => setTipPos(null);

  return (
    <>
      <button
        ref={btnRef}
        onClick={onClick}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        aria-label={label}
        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all relative ${
          active
            ? "text-white"
            : "text-text-dim hover:text-text-secondary hover:bg-white/4"
        }`}
      >
        <Icon size={18} />
        {active && (
          <span className="pointer-events-none absolute -right-2.5 top-1 bottom-1 w-0.5 bg-accent shadow-[0_0_8px_var(--color-accent)]" />
        )}
      </button>
      {tipPos && typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-popover px-2 py-1 rounded-md bg-bg-overlay/95 border border-white/10 text-[11px] text-text-primary whitespace-nowrap shadow-lg backdrop-blur-sm"
            style={{ top: tipPos.top, right: tipPos.right, transform: "translateY(-50%)" }}
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
const TAB_ICONS: Record<Tab, IconCmp> = {
  inspector: IconEye,
  chat: IconChat,
  threads: IconThread,
  files: IconFolder,
  knowledge: IconLightbulb,
  surveys: IconList,
  interviews: IconUser,
  maps: IconReasoning,
  compass: IconCompass,
  learning: IconCoverage,
  eval: IconScorecard,
};

const TAB_ORDER: Tab[] = [
  "inspector",
  "chat",
  "knowledge",
  "threads",
  "maps",
  "compass",
  "files",
  "learning",
  "interviews",
  "surveys",
  "eval",
];

function getDefaultContext(state: ReturnType<typeof useStore>["state"]) {
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  // Use the current timeline entry to surface its most prominent node
  const currentKey = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
  const entry: TimelineEntry | null = currentKey
    ? (narrative.scenes[currentKey] ??
      narrative.worldBuilds?.[currentKey] ??
      null)
    : null;

  if (entry && isScene(entry)) {
    const firstParticipant = entry.participantIds?.[0];
    if (firstParticipant && narrative.characters[firstParticipant]) {
      return { type: "character" as const, characterId: firstParticipant };
    }
    if (entry.locationId && narrative.locations[entry.locationId]) {
      return { type: "location" as const, locationId: entry.locationId };
    }
  } else if (entry) {
    const wb = entry as WorldBuild;
    const firstChar = wb.expansionManifest?.newCharacters?.[0]?.id;
    if (firstChar && narrative.characters[firstChar]) {
      return { type: "character" as const, characterId: firstChar };
    }
    const firstLoc = wb.expansionManifest?.newLocations?.[0]?.id;
    if (firstLoc && narrative.locations[firstLoc]) {
      return { type: "location" as const, locationId: firstLoc };
    }
  }

  // Fallback: most prominent character across all scenes
  const characters = Object.values(narrative.characters ?? {});
  const locations = Object.values(narrative.locations ?? {});
  if (characters.length === 0 && locations.length === 0) return null;

  const charScores: Record<string, number> = {};
  for (const ch of characters) charScores[ch.id] = 0;
  for (const scene of Object.values(narrative.scenes ?? {})) {
    for (const id of scene.participantIds ?? []) {
      if (id in charScores) charScores[id]++;
    }
  }

  const topChar = characters
    .filter((c) => c.role === "anchor")
    .concat(characters.filter((c) => c.role !== "anchor"))
    .sort((a, b) => (charScores[b.id] ?? 0) - (charScores[a.id] ?? 0))[0];
  if (topChar) return { type: "character" as const, characterId: topChar.id };

  if (locations.length > 0)
    return { type: "location" as const, locationId: locations[0].id };

  return null;
}

// Self-contained resize for the content panel. The icon rail is always
// visible; only this content pane collapses (like the left sidebar / drive
// pullout). Width drives the pane when expanded; collapsed hides it entirely.
function usePanelResize(initialWidth: number, minWidth: number, maxWidth: number) {
  const [width, setWidth] = useState(initialWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = width;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = startX.current - ev.clientX; // right-side panel
        const next = Math.max(minWidth, Math.min(maxWidth, startW.current + delta));
        setWidth(next);
      };
      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width, minWidth, maxWidth],
  );

  return { width, onMouseDown };
}

export default function InspectorPanel() {
  const { state, dispatch } = useStore();
  // Latch the scene-derived default the first time it resolves for this
  // narrative. Without latching, scrubbing scenes (arrow keys, timeline
  // clicks) would silently rotate the displayed entity whenever the
  // operator hasn't pinned an explicit inspector context — the panel
  // should stay on whatever was last visible until they navigate.
  const narrativeId = state.activeNarrative?.id ?? null;
  // Latch as state (not a ref) so the value is read-only at render time and
  // React stays in control of updates. The "adjust state during render" pattern
  // re-latches synchronously when the narrative changes — no extra render — by
  // tracking the narrativeId the current latch was computed for.
  const [latchedDefault, setLatchedDefault] = useState<{
    narrativeId: string | null;
    context: ReturnType<typeof getDefaultContext>;
  }>({ narrativeId: null, context: null });
  if (
    !state.viewState.inspectorContext &&
    latchedDefault.narrativeId !== narrativeId
  ) {
    setLatchedDefault({
      narrativeId,
      context: getDefaultContext(state),
    });
  }
  const ctx =
    state.viewState.inspectorContext ?? latchedDefault.context;
  const [tab, setTab] = useState<Tab>("inspector");
  const [collapsed, setCollapsed] = useState(false);
  const { width, onMouseDown } = usePanelResize(500, 150, 1200);

  // Clicking a tab: the active tab toggles the panel closed; any other tab
  // switches to it and ensures the panel is open. The rail stays put either
  // way — only the content pane minimises.
  const handleTabClick = (t: Tab) => {
    if (t === tab && !collapsed) setCollapsed(true);
    else {
      setTab(t);
      setCollapsed(false);
    }
  };

  // Auto-switch to the inspector tab when a new inspector context is set, and
  // reveal the panel if it was minimised so the selection is visible. Done with
  // the render-phase "store previous value" pattern (not an effect) so the
  // adjustment happens in the same render the context changes in — no cascading
  // effect render.
  const [prevInspectorContext, setPrevInspectorContext] = useState(
    state.viewState.inspectorContext,
  );
  if (state.viewState.inspectorContext !== prevInspectorContext) {
    setPrevInspectorContext(state.viewState.inspectorContext);
    if (state.viewState.inspectorContext) {
      setTab("inspector");
      setCollapsed(false);
    }
  }
  const [evalMode, setEvalMode] = useState<
    "branch" | "prose" | "plan"
  >("branch");
  const [evalRange, setEvalRange] = useState<SceneRange>(null);

  function renderInspector() {
    if (!ctx) return <EmptyState />;

    switch (ctx.type) {
      case "scene":
        return <SceneDetail sceneId={ctx.sceneId} />;
      case "character":
        return <CharacterDetail characterId={ctx.characterId} />;
      case "location":
        return <LocationDetail locationId={ctx.locationId} />;
      case "thread":
        return <ThreadDetail threadId={ctx.threadId} />;
      case "stream":
        return <StreamDetail streamId={ctx.streamId} />;
      case "streamPrior":
        return <StreamPriorDetail streamId={ctx.streamId} priorId={ctx.priorId} />;
      case "merge":
        return <MergeDetail mergeId={ctx.mergeId} />;
      case "arc":
        return <ArcDetail arcId={ctx.arcId} />;
      case "knowledge":
        return <KnowledgeDetail nodeId={ctx.nodeId} />;
      case "artifact":
        return <ArtifactDetail artifactId={ctx.artifactId} />;
      case "world":
        return (
          <WorldNodeDetail entityId={ctx.entityId} nodeId={ctx.nodeId} />
        );
      case "threadLog":
        return (
          <ThreadLogNodeDetail threadId={ctx.threadId} nodeId={ctx.nodeId} />
        );
      case "reasoning":
        return (
          <ReasoningNodeDetail arcId={ctx.arcId} worldBuildId={ctx.worldBuildId} nodeId={ctx.nodeId} />
        );
      case "mode":
        return (
          <PhaseNodeDetail phaseGraphId={ctx.phaseGraphId} nodeId={ctx.nodeId} />
        );
      case "topic":
        return <TopicDetail topicId={ctx.topicId} />;
      case "question":
        return <QuestionDetail sceneId={ctx.sceneId} questionId={ctx.questionId} />;
      default:
        return <EmptyState />;
    }
  }

  return (
    <aside className="relative h-full flex flex-row glass-panel">
      {/* Collapse toggle — always present, pinned to the panel's left edge.
          Minimises only the content pane; the icon rail stays visible. */}
      <div className="absolute top-0 bottom-0 left-0 z-30 w-4 -translate-x-1/2 flex items-center justify-center pointer-events-none">
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand inspector" : "Collapse inspector"}
          className="pointer-events-auto flex items-center justify-center w-6 h-10 rounded-full glass-pill text-text-secondary opacity-80 hover:opacity-100 hover:scale-110 hover:text-violet-200 hover:shadow-[0_0_14px_rgba(196,181,253,0.35)] transition-all cursor-pointer"
        >
          {collapsed ? <IconChevronLeft size={10} /> : <IconChevronRight size={10} />}
        </button>
      </div>

      {/* Content — collapsible pane */}
      {!collapsed && (
      <div
        className="relative shrink-0 flex flex-col min-w-0 overflow-hidden border-l border-border"
        style={{ width }}
      >
        {/* Resize handle — left edge */}
        <div
          className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-violet-300/15 active:bg-violet-300/25 transition-colors z-10"
          onMouseDown={onMouseDown}
        />
        {tab === "inspector" && (
          <div className="flex-1 overflow-y-auto min-h-0">
            {state.viewState.inspectorHistory.length > 0 && (
              <div className="sticky top-0 z-10 h-9 flex items-center gap-1 px-3 border-b border-white/8 bg-bg-base/90 backdrop-blur-sm">
                <button
                  onClick={() => dispatch({ type: "INSPECTOR_BACK" })}
                  className="text-[10px] text-text-dim hover:text-text-secondary transition-colors flex items-center gap-1"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  Back
                </button>
              </div>
            )}
            <div className="p-4">{renderInspector()}</div>
          </div>
        )}
        {tab === "chat" && (
          <div className="flex-1 min-h-0">
            <ChatPanel />
          </div>
        )}
        {tab === "threads" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <ThreadsPanel />
          </div>
        )}
        {tab === "knowledge" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <KnowledgePanel />
          </div>
        )}
        {tab === "files" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <FilesPanel />
          </div>
        )}
        {tab === "maps" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <MapPanel />
          </div>
        )}
        {tab === "compass" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <CompassPanel />
          </div>
        )}
        {tab === "learning" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <LearningPanel />
          </div>
        )}
        {tab === "surveys" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <SurveyPanel />
          </div>
        )}
        {tab === "interviews" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <InterviewPanel />
          </div>
        )}
        {tab === "eval" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="shrink-0 h-9 flex border-b border-white/8">
              {(["branch", "plan", "prose"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setEvalMode(m)}
                  className={`flex-1 flex items-center justify-center text-[10px] font-medium transition-colors ${evalMode === m ? "text-text-primary border-b border-accent" : "text-text-dim hover:text-text-secondary"}`}
                >
                  {
                    {
                      branch: "Structure",
                      plan: "Plan",
                      prose: "Prose",
                    }[m]
                  }
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 relative">
              <div
                className={`absolute inset-0 ${evalMode === "branch" ? "" : "hidden"}`}
              >
                <BranchEval
                  sceneRange={evalRange}
                  onRangeChange={setEvalRange}
                />
              </div>
              <div
                className={`absolute inset-0 ${evalMode === "plan" ? "" : "hidden"}`}
              >
                <PlanEval sceneRange={evalRange} onRangeChange={setEvalRange} />
              </div>
              <div
                className={`absolute inset-0 ${evalMode === "prose" ? "" : "hidden"}`}
              >
                <ProseEval
                  sceneRange={evalRange}
                  onRangeChange={setEvalRange}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Icon tab rail — right edge, always visible */}
      <div className="shrink-0 flex flex-col items-center py-2 gap-2 w-14 border-l border-border bg-bg-base/40">
        {TAB_ORDER.map((t) => (
          <RailTabButton
            key={t}
            icon={TAB_ICONS[t]}
            label={TAB_LABELS[t]}
            active={tab === t && !collapsed}
            onClick={() => handleTabClick(t)}
          />
        ))}
      </div>
    </aside>
  );
}
