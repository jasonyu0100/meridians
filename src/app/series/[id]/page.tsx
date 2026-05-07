'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { useWizard } from '@/lib/wizard-context';
import { IconChevronDown } from '@/components/icons';
import AppShell from '@/components/layout/AppShell';
import Sidebar from '@/components/sidebar/Sidebar';
import SidePanel from '@/components/inspector/SidePanel';
import WorldGraph from '@/components/canvas/WorldGraph';
import FloatingPalette from '@/components/canvas/FloatingPalette';
import { CanvasTopBar, GRAPH_MODES } from '@/components/canvas/CanvasTopBar';
import { AudioPlayerProvider } from '@/hooks/useAudioPlayer';
import TimelineStrip from '@/components/timeline/TimelineStrip';
import ForceTimeline from '@/components/timeline/ForceTimeline';
import { PropositionClassificationProvider } from '@/hooks/usePropositionClassification';
import NarrativePanel from '@/components/narrative/NarrativePanel';
import { CreationWizard } from '@/components/wizard/CreationWizard';
import { GeneratePanel } from '@/components/generation/GeneratePanel';
import { BranchModal } from '@/components/generation/BranchModal';
import { AutoSettingsPanel } from '@/components/auto/AutoSettingsPanel';
import { AutoLogModal } from '@/components/auto/AutoLogModal';
import { useAutoPlay } from '@/hooks/useAutoPlay';
import { useBulkGenerate } from '@/hooks/useBulkGenerate';
import { useBulkAudioGenerate } from '@/hooks/useBulkAudioGenerate';
import { type SceneRange } from '@/components/timeline/SceneRangeSelector';
import { ForceAnalytics } from '@/components/analytics/ForceAnalytics';
import { CastAnalytics } from '@/components/analytics/CastAnalytics';
import ProseProfilePanel from '@/components/layout/ProseProfilePanel';
import { MCTSPanel } from '@/components/mcts/MCTSPanel';
import { ModeControlBar } from '@/components/generation/ModeControlBar';
import { useMCTS } from '@/hooks/useMCTS';
import { StorySettingsModal } from '@/components/settings/StorySettingsModal';
import { CoordinationPlanIndicator } from '@/components/generation/CoordinationPlanIndicator';
import { CoordinationPlanModal } from '@/components/generation/CoordinationPlanModal';
import { CoordinationPlanSetupModal } from '@/components/generation/CoordinationPlanSetupModal';

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);
  return isMobile;
}

export default function SeriesPage() {
  const params = useParams();
  const router = useRouter();
  const { state, dispatch } = useStore();
  const { state: wizardState } = useWizard();
  const isMobile = useIsMobile();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generatePreset, setGeneratePreset] = useState<{
    worldMode?: boolean;
    worldDirection?: string;
    continuationMode?: boolean;
    storyDirection?: string;
  } | null>(null);
  const [forkOpen, setForkOpen] = useState(false);
  const [autoSettingsOpen, setAutoSettingsOpen] = useState(false);
  const [autoLogOpen, setAutoLogOpen] = useState(false);
  const [forceAnalyticsOpen, setForceAnalyticsOpen] = useState(false);
  const [castAnalyticsOpen, setCastAnalyticsOpen] = useState(false);
  const [proseProfileOpen, setProseProfileOpen] = useState(false);
  const [mctsOpen, setMctsOpen] = useState(false);
  const [storySettingsOpen, setStorySettingsOpen] = useState(false);
  const [coordinationPlanOpen, setCoordinationPlanOpen] = useState(false);
  const [coordinationSetupOpen, setCoordinationSetupOpen] = useState(false);
  const [bottomPanelCollapsed, setBottomPanelCollapsed] = useState(false);

  // Ref to track current plan state for event handler (avoids stale closure)
  const coordinationPlanRef = useRef<{ branchId: string | null; hasPlan: boolean }>({ branchId: null, hasPlan: false });
  useEffect(() => {
    const branchId = state.viewState.activeBranchId;
    const hasPlan = !!(branchId && state.activeNarrative?.branches[branchId]?.coordinationPlan);
    coordinationPlanRef.current = { branchId, hasPlan };
  }, [state.viewState.activeBranchId, state.activeNarrative]);
  const autoPlay = useAutoPlay();
  const mcts = useMCTS();
  const bulk = useBulkGenerate();
  const bulkAudio = useBulkAudioGenerate();
  const id = params.id as string;

  // Activate narrative from URL param. The URL is the source of truth —
  // mirror it into state once the target narrative is in the list, and
  // redirect home only after hydration has definitively settled (otherwise
  // we'd bounce users off pages whose narratives are still loading).
  useEffect(() => {
    if (!id || state.activeNarrativeId === id) return;
    const exists = state.narratives.some((n) => n.id === id);
    if (exists) {
      dispatch({ type: 'SET_ACTIVE_NARRATIVE', id });
    } else if (state.hydrationComplete) {
      router.replace('/');
    }
  }, [id, state.activeNarrativeId, state.narratives, state.hydrationComplete, dispatch, router]);

  // Custom event listeners for opening panels
  useEffect(() => {
    function handleOpenGenerate(e: Event) {
      const detail = (e as CustomEvent<{
        worldMode?: boolean;
        worldDirection?: string;
        continuationMode?: boolean;
        storyDirection?: string;
      }>).detail;
      if (detail?.worldMode) {
        setGeneratePreset({ worldMode: true, worldDirection: detail.worldDirection });
      } else if (detail?.continuationMode) {
        setGeneratePreset({ continuationMode: true, storyDirection: detail.storyDirection });
      } else {
        setGeneratePreset(null);
      }
      setGenerateOpen(true);
    }
    function handleOpenFork() { setForkOpen(true); }
    function handleOpenAutoSettings() { setAutoSettingsOpen(true); }
    function handleOpenForceAnalytics() { setForceAnalyticsOpen(true); }
    function handleOpenCastAnalytics() { setCastAnalyticsOpen(true); }
    function handleOpenProseProfile() { setProseProfileOpen(true); }
    function handleOpenMcts() { setMctsOpen(true); }
    function handleOpenStorySettings() { setStorySettingsOpen(true); }
    function handleOpenCoordinationPlan() {
      // If plan exists, show it; otherwise open setup
      // Uses ref to avoid stale closure issue
      if (coordinationPlanRef.current.hasPlan) {
        setCoordinationPlanOpen(true);
      } else {
        setCoordinationSetupOpen(true);
      }
    }
    window.addEventListener('open-generate-panel', handleOpenGenerate);
    window.addEventListener('open-branch-modal', handleOpenFork);
    window.addEventListener('open-auto-settings', handleOpenAutoSettings);
    window.addEventListener('open-force-analytics', handleOpenForceAnalytics);
    window.addEventListener('open-cast-analytics', handleOpenCastAnalytics);
    window.addEventListener('open-prose-profile', handleOpenProseProfile);
    window.addEventListener('open-mcts-panel', handleOpenMcts);
    window.addEventListener('open-story-settings', handleOpenStorySettings);
    window.addEventListener('open-coordination-plan', handleOpenCoordinationPlan);
    return () => {
      window.removeEventListener('open-generate-panel', handleOpenGenerate);
      window.removeEventListener('open-branch-modal', handleOpenFork);
      window.removeEventListener('open-auto-settings', handleOpenAutoSettings);
      window.removeEventListener('open-force-analytics', handleOpenForceAnalytics);
      window.removeEventListener('open-cast-analytics', handleOpenCastAnalytics);
      window.removeEventListener('open-prose-profile', handleOpenProseProfile);
      window.removeEventListener('open-mcts-panel', handleOpenMcts);
      window.removeEventListener('open-story-settings', handleOpenStorySettings);
      window.removeEventListener('open-coordination-plan', handleOpenCoordinationPlan);
    };
  }, []);

  // Bulk generation event listeners
  useEffect(() => {
    function readRange(e: Event): SceneRange {
      return (e as CustomEvent<{ range?: SceneRange }>).detail?.range ?? null;
    }
    function handleBulkPlan(e: Event) { bulk.start('plan', readRange(e)); }
    function handleBulkProse(e: Event) { bulk.start('prose', readRange(e)); }
    function handleBulkGame(e: Event) { bulk.start('game', readRange(e)); }
    function handleBulkAudio(e: Event) { bulkAudio.start(readRange(e)); }
    window.addEventListener('canvas:bulk-plan', handleBulkPlan);
    window.addEventListener('canvas:bulk-prose', handleBulkProse);
    window.addEventListener('canvas:bulk-game', handleBulkGame);
    window.addEventListener('canvas:bulk-audio', handleBulkAudio);
    return () => {
      window.removeEventListener('canvas:bulk-plan', handleBulkPlan);
      window.removeEventListener('canvas:bulk-prose', handleBulkProse);
      window.removeEventListener('canvas:bulk-game', handleBulkGame);
      window.removeEventListener('canvas:bulk-audio', handleBulkAudio);
    };
  }, [bulk, bulkAudio]);

  if (!state.activeNarrative) {
    return (
      <div className="h-screen flex items-center justify-center">
        <span className="text-text-dim text-sm">Loading narrative...</span>
      </div>
    );
  }

  const showAutoBar = state.viewState.autoRunState && (state.viewState.autoRunState.isRunning || state.viewState.autoRunState.isPaused || state.viewState.autoRunState.log.length > 0);
  const showMctsBar = mcts.runState.status !== 'idle' || Object.keys(mcts.runState.tree.nodes).length > 0;
  const showBulkBar = bulk.runState !== null;
  const showBulkAudioBar = bulkAudio.runState !== null;

  // Graph-mode views render a legend strip (h-7 = 28px) at the top of the
  // canvas. When that strip is visible, push the bar light down so it sits
  // at the lowest divider line and the wash only spills downward.
  const hasCanvasLegend = GRAPH_MODES.has(state.graphViewMode);
  const barLightTop = hasCanvasLegend ? 28 : 0;

  return (
    <PropositionClassificationProvider narrative={state.activeNarrative} resolvedKeys={state.resolvedEntryKeys}>
    <AudioPlayerProvider>
    <>
      <AppShell
        sidebar={<Sidebar />}
        sidepanel={<SidePanel />}
      >
        <div className="relative flex flex-col h-full min-h-0">
          <CanvasTopBar />
          <div className="flex-1 relative overflow-hidden">
            <WorldGraph />
            {/* Top bar light — washes the upper canvas for legibility. Both
                the wash and divider start at the bottom edge of the topmost
                bar (CanvasTopBar, plus a legend strip when in graph mode), so
                the light only ever spills downward. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0"
              style={{
                top: barLightTop,
                height: 320,
                background:
                  'linear-gradient(to bottom, rgba(221, 214, 254, 0.22) 0%, rgba(210, 197, 253, 0.11) 12%, rgba(196, 181, 253, 0.05) 32%, rgba(196, 181, 253, 0.02) 60%, transparent 100%)',
                mixBlendMode: 'screen',
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0"
              style={{
                top: barLightTop,
                height: 1,
                background:
                  'linear-gradient(to right, transparent 0%, rgba(196, 181, 253, 0.55) 18%, rgba(237, 233, 254, 0.85) 50%, rgba(196, 181, 253, 0.55) 82%, transparent 100%)',
              }}
            />
            {/* Mode control bars - prioritize: bulk-audio > bulk > mcts > auto */}
            {showBulkAudioBar && bulkAudio.runState && (
              <ModeControlBar
                mode="bulk-audio"
                isRunning={bulkAudio.runState.isRunning}
                isPaused={bulkAudio.runState.isPaused}
                progress={bulkAudio.runState.progress}
                statusMessage={bulkAudio.runState.statusMessage}
                onPause={bulkAudio.pause}
                onResume={bulkAudio.resume}
                onStop={bulkAudio.stop}
              />
            )}
            {!showBulkAudioBar && showBulkBar && bulk.runState && (
              <ModeControlBar
                mode={
                  bulk.runState.mode === 'plan' ? 'bulk-plan' :
                  bulk.runState.mode === 'prose' ? 'bulk-prose' :
                  'bulk-game'
                }
                isRunning={bulk.runState.isRunning}
                isPaused={bulk.runState.isPaused}
                progress={bulk.runState.progress}
                statusMessage={bulk.runState.statusMessage}
                onPause={bulk.pause}
                onResume={bulk.resume}
                onStop={bulk.stop}
              />
            )}
            {!showBulkAudioBar && !showBulkBar && showMctsBar && (
              <ModeControlBar
                mode="mcts"
                runState={mcts.runState}
                onPause={mcts.pause}
                onResume={mcts.resume}
                onStop={mcts.stop}
                onOpenPanel={() => setMctsOpen(true)}
              />
            )}
            {!showBulkAudioBar && !showBulkBar && !showMctsBar && showAutoBar && (
              <ModeControlBar
                mode="auto"
                isRunning={autoPlay.isRunning}
                isPaused={autoPlay.isPaused}
                currentCycle={autoPlay.currentCycle}
                totalScenes={state.viewState.autoRunState?.totalScenesGenerated ?? 0}
                statusMessage={state.viewState.autoRunState?.statusMessage ?? ''}
                log={autoPlay.log}
                onPause={autoPlay.pause}
                onResume={autoPlay.resume}
                onStop={autoPlay.stop}
                onOpenSettings={() => setAutoSettingsOpen(true)}
                onOpenLog={() => setAutoLogOpen(true)}
                hasCoordinationPlan={coordinationPlanRef.current.hasPlan}
              />
            )}

            {(GRAPH_MODES.has(state.graphViewMode) ||
              state.graphViewMode === 'plan' ||
              state.graphViewMode === 'prose' ||
              state.graphViewMode === 'audio' ||
              state.graphViewMode === 'game' ||
              state.graphViewMode === 'phase' ||
              state.graphViewMode === 'reasoning') && (
              <FloatingPalette
                isBulkActive={!!(bulk.runState?.isRunning || bulk.runState?.isPaused)}
                isBulkAudioActive={!!(bulkAudio.runState?.isRunning || bulkAudio.runState?.isPaused)}
                isMctsActive={mcts.runState.status === 'running' || mcts.runState.status === 'paused'}
              />
            )}
            {/* Coordination Plan Indicator — only in graph-style canvas modes */}
            {GRAPH_MODES.has(state.graphViewMode) && state.viewState.activeBranchId && state.activeNarrative.branches[state.viewState.activeBranchId]?.coordinationPlan && (
              <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10">
                <CoordinationPlanIndicator
                  branchPlan={state.activeNarrative.branches[state.viewState.activeBranchId].coordinationPlan!}
                  onClick={() => setCoordinationPlanOpen(true)}
                />
              </div>
            )}
          </div>

          {/* Bottom panel with toggle */}
          <div className="relative shrink-0">
            {/* Bottom panel toggle */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
              <button
                onClick={() => setBottomPanelCollapsed(!bottomPanelCollapsed)}
                title={bottomPanelCollapsed ? 'Expand timeline' : 'Collapse timeline'}
                className="pointer-events-auto flex items-center justify-center w-10 h-6 rounded-full bg-bg-panel border border-white/10 text-text-secondary shadow-lg opacity-80 hover:opacity-100 hover:scale-110 hover:text-text-primary transition-all cursor-pointer"
                style={{ transform: 'translateY(-50%)' }}
              >
                <IconChevronDown size={10} style={{ transform: bottomPanelCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              </button>
            </div>

            {!bottomPanelCollapsed && (
              <>
                <NarrativePanel />
                <TimelineStrip />
                <ForceTimeline />
              </>
            )}
          </div>
        </div>
      </AppShell>
      {wizardState.isOpen && <CreationWizard />}
      {generateOpen && (
        <GeneratePanel
          onClose={() => {
            setGenerateOpen(false);
            setGeneratePreset(null);
          }}
          initialWorldMode={generatePreset?.worldMode}
          initialWorldDirection={generatePreset?.worldDirection}
          initialContinuationMode={generatePreset?.continuationMode}
          initialStoryDirection={generatePreset?.storyDirection}
        />
      )}
      {forkOpen && <BranchModal onClose={() => setForkOpen(false)} />}
      {autoSettingsOpen && (
        <AutoSettingsPanel
          onClose={() => setAutoSettingsOpen(false)}
          onStart={() => autoPlay.start()}
        />
      )}
      {autoLogOpen && (
        <AutoLogModal
          log={autoPlay.log}
          onClose={() => setAutoLogOpen(false)}
        />
      )}
      {forceAnalyticsOpen && <ForceAnalytics onClose={() => setForceAnalyticsOpen(false)} />}
      {castAnalyticsOpen && <CastAnalytics onClose={() => setCastAnalyticsOpen(false)} />}
      {proseProfileOpen && <ProseProfilePanel onClose={() => setProseProfileOpen(false)} />}
      {storySettingsOpen && <StorySettingsModal onClose={() => setStorySettingsOpen(false)} />}
      {coordinationSetupOpen && (
        <CoordinationPlanSetupModal
          onClose={() => setCoordinationSetupOpen(false)}
          onPlanCreated={() => setCoordinationSetupOpen(false)}
        />
      )}
      {coordinationPlanOpen && state.viewState.activeBranchId && state.activeNarrative.branches[state.viewState.activeBranchId]?.coordinationPlan && (
        <CoordinationPlanModal
          plan={state.activeNarrative.branches[state.viewState.activeBranchId].coordinationPlan!.plan}
          onRegenerate={() => {
            setCoordinationPlanOpen(false);
            setCoordinationSetupOpen(true);
          }}
          onConfirm={() => setCoordinationPlanOpen(false)}
          onClose={() => setCoordinationPlanOpen(false)}
          onClear={() => {
            dispatch({ type: 'CLEAR_COORDINATION_PLAN', branchId: state.viewState.activeBranchId! });
            setCoordinationPlanOpen(false);
          }}
          onSetArc={(arcIndex) => {
            dispatch({
              type: 'SET_COORDINATION_PLAN_ARC',
              branchId: state.viewState.activeBranchId!,
              arcIndex,
            });
          }}
        />
      )}
      <MCTSPanel isOpen={mctsOpen} onClose={() => setMctsOpen(false)} mcts={mcts} />
      {isMobile && (
        <div className="fixed inset-0 z-9999 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center px-6 text-center">
          <p className="text-white/90 text-lg font-semibold mb-2">Desktop Only</p>
          <p className="text-white/40 text-sm leading-relaxed max-w-xs mb-6">
            InkTide is designed for desktop browsers. Please visit on a larger screen.
          </p>
          <button
            onClick={() => router.push('/')}
            className="text-xs text-white/50 hover:text-white/80 underline underline-offset-2 transition"
          >
            Back to home
          </button>
        </div>
      )}
    </>
    </AudioPlayerProvider>
    </PropositionClassificationProvider>
  );
}
