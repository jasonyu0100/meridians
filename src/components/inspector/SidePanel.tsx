"use client";

import ChatPanel from "@/components/sidebar/ChatPanel";
import SurveyPanel from "@/components/sidebar/SurveyPanel";
import InterviewPanel from "@/components/sidebar/InterviewPanel";
import InvestigationPanel from "@/components/sidebar/InvestigationPanel";
import FilesPanel from "@/components/sidebar/FilesPanel";
import ThreadPortfolio from "@/components/sidebar/ThreadPortfolio";
import KnowledgePanel from "./KnowledgePanel";
import BranchEval from "@/components/timeline/BranchEval";
import PlanEval from "@/components/timeline/PlanEval";
import ProseEval from "@/components/timeline/ProseEval";
import { type SceneRange } from "@/components/timeline/SceneRangeSelector";
import { useStore } from "@/lib/store";
import type { WorldBuild } from "@/types/narrative";
import { isScene, type TimelineEntry } from "@/types/narrative";
import { useEffect, useState } from "react";
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
import ReasoningNodeDetail from "./ReasoningNodeDetail";
import ModeNodeDetail from "./ModeNodeDetail";

type Tab =
  | "inspector"
  | "chat"
  | "threads"
  | "files"
  | "knowledge"
  | "surveys"
  | "interviews"
  | "investigations"
  | "eval";

const TAB_LABELS: Record<Tab, string> = {
  inspector: "Inspector",
  chat: "Chat",
  threads: "Threads",
  files: "Files",
  knowledge: "Knowledge",
  surveys: "Surveys",
  interviews: "Interviews",
  investigations: "Investigations",
  eval: "Review",
};

const TAB_ORDER: Tab[] = [
  "inspector",
  "chat",
  "threads",
  "files",
  "knowledge",
  "surveys",
  "interviews",
  "investigations",
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

export default function SidePanel() {
  const { state, dispatch } = useStore();
  const ctx = state.viewState.inspectorContext ?? getDefaultContext(state);
  const [tab, setTab] = useState<Tab>("inspector");

  // Auto-switch to inspector tab when a new inspector context is set
  useEffect(() => {
    if (state.viewState.inspectorContext) setTab("inspector");
  }, [state.viewState.inspectorContext]);
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
          <ModeNodeDetail modeId={ctx.modeId} nodeId={ctx.nodeId} />
        );
      default:
        return <EmptyState />;
    }
  }

  return (
    <aside className="h-full flex flex-row border-l border-border glass-panel">
      {/* Vertical tab rail */}
      <div className="shrink-0 flex flex-col items-center py-2 w-7 border-r border-border">
        {TAB_ORDER.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-3 w-full flex items-center justify-center transition-colors relative ${
              tab === t
                ? "text-text-primary border-r border-accent"
                : "text-text-dim hover:text-text-secondary"
            }`}
          >
            <span
              className="text-[10px] font-medium tracking-wider uppercase"
              style={{
                writingMode: "vertical-lr",
                transform: "rotate(180deg)",
              }}
            >
              {TAB_LABELS[t]}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {tab === "inspector" && (
          <div className="flex-1 overflow-y-auto min-h-0">
            {state.viewState.inspectorHistory.length > 0 && (
              <div className="sticky top-0 z-10 flex items-center gap-1 px-3 py-1.5 border-b border-border bg-bg-base/90 backdrop-blur-sm">
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
            <ThreadPortfolio />
          </div>
        )}
        {tab === "files" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <FilesPanel />
          </div>
        )}
        {tab === "knowledge" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <KnowledgePanel />
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
        {tab === "investigations" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <InvestigationPanel />
          </div>
        )}
        {tab === "eval" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="shrink-0 flex border-b border-white/5">
              {(["branch", "plan", "prose"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setEvalMode(m)}
                  className={`flex-1 text-[10px] py-1.5 font-medium transition-colors ${evalMode === m ? "text-text-primary border-b border-accent" : "text-text-dim hover:text-text-secondary"}`}
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
    </aside>
  );
}
