'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene, type ProseVersion, type PlanVersion } from '@/types/narrative';
import type { GraphViewMode } from '@/types/narrative';
import { getResolvedProseVersion, getResolvedPlanVersion, resolveProseForBranch, resolvePlanForBranch } from '@/lib/narrative-utils';
import { VersionHistoryTree } from './VersionHistoryTree';
import { RegenerateEmbeddingsModal } from '@/components/topbar/RegenerateEmbeddingsModal';
import { IconDice, IconGlobe, IconLightbulb, IconThread, IconNetwork, IconMarket, IconNotepad, IconDocument, IconWaveform, IconSearch, IconReasoning } from '@/components/icons';
import { buildSequentialPath } from '@/lib/ai';
import { CopyButton } from '@/components/shared/CopyButton';
import { exportGraphView, graphViewLabel, isExportableGraphMode } from '@/lib/graph-export';
import { exportMarketSnapshot } from '@/lib/market-export';
import { exportScenePlan, exportSceneProse } from '@/lib/scene-export';

type GraphDomain = {
  label: string;
  local: GraphViewMode;
  global: GraphViewMode;
  Icon: typeof IconGlobe;
  description: string;
  scopeless?: boolean;
};

const GRAPH_DOMAINS: GraphDomain[] = [
  {
    label: 'World',
    local: 'spatial',
    global: 'overview',
    Icon: IconGlobe,
    description: 'Characters & locations',
  },
  {
    label: 'System',
    local: 'spark',
    global: 'codex',
    Icon: IconLightbulb,
    description: 'System knowledge & rules',
  },
  {
    label: 'Threads',
    local: 'pulse',
    global: 'threads',
    Icon: IconThread,
    description: 'Narrative threads & tensions',
  },
  {
    label: 'Network',
    local: 'network',
    global: 'network',
    Icon: IconNetwork,
    description: 'Aggregate connection graph',
    scopeless: true,
  },
];

const SCOPE_PAIRS: Record<string, { local: GraphViewMode; global: GraphViewMode }> = {
  spatial:  { local: 'spatial', global: 'overview' },
  overview: { local: 'spatial', global: 'overview' },
  spark:    { local: 'spark',   global: 'codex'    },
  codex:    { local: 'spark',   global: 'codex'    },
  pulse:    { local: 'pulse',   global: 'threads'  },
  threads:  { local: 'pulse',   global: 'threads'  },
};

export const GRAPH_MODES = new Set<GraphViewMode>(['spatial', 'overview', 'spark', 'codex', 'pulse', 'threads', 'network']);

type CanvasMode = 'graph' | 'plan' | 'prose' | 'audio' | 'game' | 'search' | 'reasoning' | 'market' | 'present' | 'future' | 'mode';
type ScenePrimaryMode = 'reasoning' | 'plan' | 'prose' | 'audio' | 'game';
const SCENE_MODES: ScenePrimaryMode[] = ['reasoning', 'plan', 'prose', 'audio', 'game'];

// Module-level state shared with SceneProseView
let beatPlanLinkedModeGlobal = false;

// ── Top-bar token system ─────────────────────────────────────────────────
//
// The bar uses two text sizes only:
//   - text-[9px] uppercase tracking-wider for SECTION labels (Arc, Scene)
//   - text-[10px] for everything interactive + meta-info
//
// Two opacities for dim text:
//   - text-text-dim/40 — empty/placeholder ("No plan", "Not written")
//   - text-text-dim/70 — secondary info (stats, total counts)
//
// One divider style and one button style (text-only and icon+text variants)
// — see TopBarDivider, TopBarButton below.

/** Vertical hairline divider — separates toolbar groups. Single style. */
function TopBarDivider() {
  return <div className="w-px h-3.5 bg-white/8" aria-hidden />;
}

/** Uppercase section label (Arc, Scene, etc.). */
function TopBarLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] uppercase tracking-wider text-text-dim/70">
      {children}
    </span>
  );
}

/** Stats / meta-info readout (word counts, "Ready", "No plan", etc.). */
function TopBarStats({
  variant = 'info',
  mono = false,
  children,
}: {
  /** `info` — readable secondary info. `empty` — placeholder/missing state. */
  variant?: 'info' | 'empty';
  /** Use mono + tabular-nums for numeric stats. */
  mono?: boolean;
  children: React.ReactNode;
}) {
  const color = variant === 'empty' ? 'text-text-dim/40' : 'text-text-dim/70';
  const monoClass = mono ? 'font-mono tabular-nums' : '';
  return <span className={`text-[10px] ${color} ${monoClass}`}>{children}</span>;
}

/** Shared className for icon+text buttons (Refresh, Clear, Copy, Export). */
const TOPBAR_ICON_BUTTON =
  'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-text-dim/70 hover:text-text-primary hover:bg-white/5 transition-colors';

/** Shared className for text-only buttons (Copy Plan, Copy Prose, etc.). */
const TOPBAR_TEXT_BUTTON =
  'text-[10px] px-2 py-0.5 rounded text-text-dim/70 hover:text-text-primary hover:bg-white/5 transition-colors';

function BeatPlanToggle() {
  const [isOn, setIsOn] = useState(() => beatPlanLinkedModeGlobal);

  // Listen for toggle events from SceneProseView to stay in sync
  useEffect(() => {
    const handleToggled = (e: Event) => {
      const newValue = (e as CustomEvent).detail?.value ?? !isOn;
      setIsOn(newValue);
      beatPlanLinkedModeGlobal = newValue;
    };
    window.addEventListener('canvas:beat-plan-toggled', handleToggled);
    return () => window.removeEventListener('canvas:beat-plan-toggled', handleToggled);
  }, [isOn]);

  const handleClick = () => {
    const newValue = !isOn;
    setIsOn(newValue);
    beatPlanLinkedModeGlobal = newValue;
    window.dispatchEvent(new CustomEvent('canvas:toggle-beat-plan'));
    window.dispatchEvent(new CustomEvent('canvas:beat-plan-toggled', { detail: { value: newValue } }));
  };

  return (
    <button
      onClick={handleClick}
      className="relative inline-flex items-center rounded-full transition-all duration-200 overflow-hidden"
      style={{
        width: '64px',
        height: '20px',
        backgroundColor: isOn ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.05)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: isOn ? 'rgba(245, 158, 11, 0.5)' : 'rgba(255, 255, 255, 0.1)',
      }}
    >
      {/* Background track with labels */}
      <div className="absolute inset-0 flex items-center justify-between px-1.5">
        <span
          className="text-[8px] font-semibold transition-opacity duration-200"
          style={{
            opacity: isOn ? 0 : 0.4,
            color: 'rgba(255, 255, 255, 0.4)',
          }}
        >
          OFF
        </span>
        <span
          className="text-[8px] font-semibold transition-opacity duration-200"
          style={{
            opacity: isOn ? 0.9 : 0,
            color: 'rgb(251, 191, 36)',
          }}
        >
          ON
        </span>
      </div>
      {/* Sliding pill */}
      <div
        className="absolute top-0.5 bottom-0.5 rounded-full transition-all duration-200"
        style={{
          width: '30px',
          left: isOn ? 'calc(100% - 31px)' : '1px',
          backgroundColor: isOn ? 'rgb(251, 191, 36)' : 'rgba(255, 255, 255, 0.3)',
          boxShadow: isOn ? '0 0 10px rgba(251, 191, 36, 0.5)' : '0 1px 3px rgba(0, 0, 0, 0.3)',
        }}
      />
    </button>
  );
}

const VERSION_TYPE_COLORS = {
  generate: 'text-emerald-400',
  rewrite: 'text-sky-400',
  edit: 'text-amber-400',
};

const VERSION_TYPE_BG_COLORS = {
  generate: 'bg-emerald-400',
  rewrite: 'bg-sky-400',
  edit: 'bg-amber-400',
};

function VersionSelector({
  versions,
  currentVersion,
  pinnedVersion,
  type,
  onSelectVersion,
  onPinVersion,
  planVersions,
}: {
  versions: ProseVersion[] | PlanVersion[];
  currentVersion: string | undefined;
  pinnedVersion: string | undefined;
  type: 'prose' | 'plan';
  onSelectVersion: (version: string) => void;
  onPinVersion: (version: string | undefined) => void;
  planVersions?: PlanVersion[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  if (versions.length === 0) {
    return (
      <span className="text-[9px] text-text-dim/40 font-mono">
        V0
      </span>
    );
  }

  // Find the version object for current version. Fall back to the latest
  // version by timestamp if the pointer doesn't match (e.g. assembled narratives
  // whose version objects carry a placeholder branchId, so the pointer never
  // got populated on the real branch).
  const currentVersionObj = versions.find(v => v.version === currentVersion)
    ?? versions.slice().sort((a, b) => b.timestamp - a.timestamp)[0];
  const versionType = currentVersionObj?.versionType ?? 'generate';
  const displayVersion = currentVersion ?? currentVersionObj?.version ?? '0';

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Minimal trigger — a coloured dot for type, the V-number, and a
          discreet caret. No border or hover-box; the dropdown does the
          heavy lifting. A pinned version earns a subtle amber dot fused
          with the type-colour dot via a ring so the pinned state reads
          without adding a second indicator. */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono text-text-secondary hover:text-text-primary transition-colors"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${VERSION_TYPE_BG_COLORS[versionType]} ${
            pinnedVersion ? 'ring-1 ring-amber-400/80 ring-offset-1 ring-offset-bg-base' : ''
          }`}
        />
        <span className="font-medium">V{displayVersion}</span>
        <svg
          className={`w-2 h-2 text-text-dim/50 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 2.5 L4 5.5 L7 2.5" />
        </svg>
      </button>

      {/* Opaque dropdown panel — the underlying prose was bleeding through
          the prior translucent background and clobbering the row text.
          Solid bg-bg-base + a sharper border + heavier dropshadow give the
          panel a clear figure/ground separation from the page beneath. */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1.5 z-[100] bg-bg-base border border-white/14 rounded-lg shadow-2xl shadow-black/70 min-w-[240px] max-h-[320px] overflow-hidden">
          <VersionHistoryTree
            versions={versions}
            currentVersion={currentVersion}
            pinnedVersion={pinnedVersion}
            onSelectVersion={(v) => {
              onSelectVersion(v);
              setIsOpen(false);
            }}
            onPinVersion={onPinVersion}
            type={type}
            planVersions={planVersions}
          />
        </div>
      )}
    </div>
  );
}

function resolveCanvasMode(graphViewMode: GraphViewMode): CanvasMode {
  if (graphViewMode === 'plan') return 'plan';
  if (graphViewMode === 'prose') return 'prose';
  if (graphViewMode === 'audio') return 'audio';
  if (graphViewMode === 'game') return 'game';
  if (graphViewMode === 'search') return 'search';
  if (graphViewMode === 'reasoning') return 'reasoning';
  if (graphViewMode === 'market') return 'market';
  if (graphViewMode === 'present') return 'present';
  if (graphViewMode === 'future') return 'future';
  if (graphViewMode === 'mode') return 'mode';
  return 'graph';
}

export function CanvasTopBar() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const graphViewMode = state.graphViewMode;
  const canvasMode = resolveCanvasMode(graphViewMode);

  const isGraphMode = GRAPH_MODES.has(graphViewMode);
  const scopePair = isGraphMode ? SCOPE_PAIRS[graphViewMode] : null;
  const isLocal = scopePair ? graphViewMode === scopePair.local : false;

  // Remember last graph mode so we can return to it
  const lastGraphModeRef = useRef<GraphViewMode>('spatial');
  useEffect(() => {
    if (GRAPH_MODES.has(graphViewMode)) lastGraphModeRef.current = graphViewMode;
  }, [graphViewMode]);

  // Remember last scope choice so switching from Network back to a scoped
  // domain preserves the user's Scene/Full preference.
  const lastIsLocalRef = useRef<boolean>(true);
  useEffect(() => {
    if (scopePair) lastIsLocalRef.current = isLocal;
  }, [scopePair, isLocal]);

  // Remember last scene sub-mode so "Scene" returns to the user's choice
  const lastSceneModeRef = useRef<ScenePrimaryMode>('plan');
  useEffect(() => {
    if ((SCENE_MODES as string[]).includes(graphViewMode)) {
      lastSceneModeRef.current = graphViewMode as ScenePrimaryMode;
    }
  }, [graphViewMode]);

  const inSceneMode = (SCENE_MODES as string[]).includes(graphViewMode);
  // "Control" supersedes the old "Market" top-level slot — it bundles
  // Opinion (the reflecting-reality market view), Present (the realized
  // variables disposition), Future (the predictive scenario cohort), and
  // Phase (the working-machinery graph).
  const inControlMode = (
    graphViewMode === 'market' || graphViewMode === 'present' || graphViewMode === 'future' || graphViewMode === 'mode'
  );
  const lastControlSubModeRef = useRef<'market' | 'present' | 'future' | 'mode'>('market');
  useEffect(() => {
    if (
      graphViewMode === 'market' || graphViewMode === 'present' || graphViewMode === 'future' || graphViewMode === 'mode'
    ) {
      lastControlSubModeRef.current = graphViewMode;
    }
  }, [graphViewMode]);

  // ── Current scene ──────────────────────────────────────────────────────
  const currentScene = useMemo<Scene | null>(() => {
    if (!narrative) return null;
    const key = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    if (!key) return null;
    const entry = resolveEntry(narrative, key);
    return entry && isScene(entry) ? entry : null;
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  // ── Version state ────────────────────────────────────────────────────
  const branches = narrative?.branches ?? {};
  const branchId = state.viewState.activeBranchId;

  const currentProseVersion = useMemo(() => {
    if (!currentScene || !branchId) return undefined;
    return getResolvedProseVersion(currentScene, branchId, branches);
  }, [currentScene, branchId, branches]);

  const currentPlanVersion = useMemo(() => {
    if (!currentScene || !branchId) return undefined;
    return getResolvedPlanVersion(currentScene, branchId, branches);
  }, [currentScene, branchId, branches]);

  const pinnedProseVersion = useMemo(() => {
    if (!currentScene || !branchId) return undefined;
    return branches[branchId]?.versionPointers?.[currentScene.id]?.proseVersion;
  }, [currentScene, branchId, branches]);

  const pinnedPlanVersion = useMemo(() => {
    if (!currentScene || !branchId) return undefined;
    return branches[branchId]?.versionPointers?.[currentScene.id]?.planVersion;
  }, [currentScene, branchId, branches]);

  const handleSelectProseVersion = useCallback((version: string) => {
    if (!currentScene || !branchId) return;
    dispatch({
      type: 'SET_VERSION_POINTER',
      branchId,
      sceneId: currentScene.id,
      pointerType: 'prose',
      version,
    });
  }, [dispatch, currentScene, branchId]);

  const handlePinProseVersion = useCallback((version: string | undefined) => {
    if (!currentScene || !branchId) return;
    dispatch({
      type: 'SET_VERSION_POINTER',
      branchId,
      sceneId: currentScene.id,
      pointerType: 'prose',
      version,
    });
  }, [dispatch, currentScene, branchId]);

  const handleSelectPlanVersion = useCallback((version: string) => {
    if (!currentScene || !branchId) return;
    dispatch({
      type: 'SET_VERSION_POINTER',
      branchId,
      sceneId: currentScene.id,
      pointerType: 'plan',
      version,
    });
  }, [dispatch, currentScene, branchId]);

  const handlePinPlanVersion = useCallback((version: string | undefined) => {
    if (!currentScene || !branchId) return;
    dispatch({
      type: 'SET_VERSION_POINTER',
      branchId,
      sceneId: currentScene.id,
      pointerType: 'plan',
      version,
    });
  }, [dispatch, currentScene, branchId]);

  // ── Mode-specific stats ───────────────────────────────────────────────
  const planStats = useMemo(() => {
    if (!currentScene || !branchId) return null;
    const plan = resolvePlanForBranch(currentScene, branchId, branches);
    if (!plan?.beats) return null;
    const beats = plan.beats.length;
    const propositions =
      plan.beats.reduce(
        (sum, b) => sum + (b.propositions?.length ?? 0),
        0,
      );
    return { beats, propositions };
  }, [currentScene, branchId, branches]);

  const proseStats = useMemo(() => {
    if (!currentScene || !branchId) return null;
    const resolved = resolveProseForBranch(currentScene, branchId, branches);
    if (!resolved.prose) return null;
    const text = resolved.prose;
    const words = text.split(/\s+/).filter(Boolean).length;
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim()).length;
    return { words, paragraphs };
  }, [currentScene, branchId, branches]);

  // Check if beat plan toggle should show
  const showBeatPlanToggle = useMemo(() => {
    if (!currentScene || !branchId) return false;
    const plan = resolvePlanForBranch(currentScene, branchId, branches);
    const prose = resolveProseForBranch(currentScene, branchId, branches);
    return !!(plan && prose.beatProseMap && prose.beatProseMap.chunks.length === plan.beats.length);
  }, [currentScene, branchId, branches]);

  // ── ARC navigation ────────────────────────────────────────────────────
  const arcNav = useMemo(() => {
    if (!narrative) return { total: 0, currentArc: 0, arcOrder: [] as { arcId: string; firstTlIdx: number }[] };
    const arcs = Object.values(narrative.arcs);
    const arcOrder: { arcId: string; firstTlIdx: number }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < state.resolvedEntryKeys.length; i++) {
      const entry = resolveEntry(narrative, state.resolvedEntryKeys[i]);
      if (entry && isScene(entry)) {
        const arc = arcs.find((a) => a.sceneIds.includes(entry.id));
        if (arc && !seen.has(arc.id)) {
          seen.add(arc.id);
          arcOrder.push({ arcId: arc.id, firstTlIdx: i });
        }
      }
    }
    let currentArc = 0;
    for (let i = arcOrder.length - 1; i >= 0; i--) {
      if (state.viewState.currentSceneIndex >= arcOrder[i].firstTlIdx) { currentArc = i + 1; break; }
    }
    return { total: arcOrder.length, currentArc, arcOrder };
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  // ── Scene navigation ──────────────────────────────────────────────────
  const sceneNav = useMemo(() => {
    if (!narrative) return { sceneIndices: [] as number[], total: 0, currentSceneNum: 0 };
    const sceneIndices: number[] = [];
    for (let i = 0; i < state.resolvedEntryKeys.length; i++) {
      if (narrative.scenes[state.resolvedEntryKeys[i]]) sceneIndices.push(i);
    }
    let currentSceneNum = 0;
    for (let i = 0; i < sceneIndices.length; i++) {
      if (sceneIndices[i] <= state.viewState.currentSceneIndex) currentSceneNum = i + 1;
    }
    return { sceneIndices, total: sceneIndices.length, currentSceneNum };
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  // ── Current arc and reasoning graph ──────────────────────────────────
  const currentArcData = useMemo(() => {
    if (!narrative || arcNav.currentArc === 0 || !arcNav.arcOrder[arcNav.currentArc - 1]) {
      return { arc: null, hasReasoningGraph: false };
    }
    const arcId = arcNav.arcOrder[arcNav.currentArc - 1].arcId;
    const arc = narrative.arcs[arcId];
    return {
      arc,
      hasReasoningGraph: !!(arc?.reasoningGraph && arc.reasoningGraph.nodes.length > 0),
    };
  }, [narrative, arcNav]);

  // ── Current world build and reasoning graph ─────────────────────────
  const currentWorldBuildData = useMemo(() => {
    if (!narrative) return { worldBuild: null, hasReasoningGraph: false };
    const key = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    if (!key) return { worldBuild: null, hasReasoningGraph: false };
    const worldBuild = narrative.worldBuilds[key];
    if (!worldBuild) return { worldBuild: null, hasReasoningGraph: false };
    return {
      worldBuild,
      hasReasoningGraph: !!(worldBuild.reasoningGraph && worldBuild.reasoningGraph.nodes.length > 0),
    };
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  // ── Inline editing ────────────────────────────────────────────────────
  const [editField, setEditField] = useState<'scene' | 'arc' | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Regenerate Embeddings modal ────────────────────────────────────────
  const [showEmbeddingsModal, setShowEmbeddingsModal] = useState(false);
  const [reasoningCopied, setReasoningCopied] = useState(false);
  const [phaseCopied, setPhaseCopied] = useState(false);

  const activeMode = useMemo(() => {
    const id = narrative?.currentModeId;
    return id ? narrative?.modes?.[id] : undefined;
  }, [narrative?.currentModeId, narrative?.modes]);

  // Investigations attached to the current scene's arc — used for the
  // Investigation tab's visibility + cycle UI.
  const currentArcInvestigations = useMemo(() => {
    if (!narrative) return [];
    const key = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    if (!key) return [];
    const scene = narrative.scenes[key];
    const arcId = scene?.arcId;
    if (!arcId) return [];
    return Object.values(narrative.investigations ?? {})
      .filter((inv) => inv.arcId === arcId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  const activeInvestigation = useMemo(() => {
    if (currentArcInvestigations.length === 0) return null;
    const selectedId = state.viewState.selectedInvestigationId;
    return (
      currentArcInvestigations.find((inv) => inv.id === selectedId) ??
      currentArcInvestigations[0]
    );
  }, [currentArcInvestigations, state.viewState.selectedInvestigationId]);

  useEffect(() => {
    if (editField) setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 30);
    else setEditValue('');
  }, [editField]);

  const commit = useCallback(() => {
    const n = parseInt(editValue, 10);
    if (!isNaN(n) && n >= 1) {
      if (editField === 'scene') {
        const idx = Math.min(n - 1, sceneNav.sceneIndices.length - 1);
        if (sceneNav.sceneIndices[idx] !== undefined) {
          dispatch({ type: 'SET_SCENE_INDEX', index: sceneNav.sceneIndices[idx] });
        }
      } else if (editField === 'arc') {
        const idx = Math.min(n - 1, arcNav.arcOrder.length - 1);
        if (arcNav.arcOrder[idx]) {
          dispatch({ type: 'SET_SCENE_INDEX', index: arcNav.arcOrder[idx].firstTlIdx });
        }
      }
    }
    setEditField(null);
  }, [editValue, editField, sceneNav, arcNav, dispatch]);

  const switchMode = useCallback((mode: CanvasMode) => {
    if (mode === 'graph') {
      dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: lastGraphModeRef.current });
    } else {
      dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode });
    }
  }, [dispatch]);

  const inputClass = "w-8 bg-white/5 text-center text-[10px] font-mono text-text-primary rounded px-1 py-0.5 outline-none border border-white/15 focus:border-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="h-9 shrink-0 flex items-center px-2 gap-2 glass-panel border-b border-border">

      {/* Left — ARC / SCENE navigation */}
      {narrative && sceneNav.total > 0 ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <TopBarLabel>Arc</TopBarLabel>
            {editField === 'arc' ? (
              <input ref={inputRef} type="number" min={1} max={arcNav.total} value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditField(null); }}
                onBlur={commit} className={inputClass} />
            ) : (
              <button type="button"
                onClick={() => { setEditField('arc'); setEditValue(String(arcNav.currentArc)); }}
                className="text-[10px] font-mono text-text-secondary hover:text-text-primary transition-colors tabular-nums">
                {arcNav.currentArc}<span className="text-text-dim/40">/{arcNav.total}</span>
              </button>
            )}
          </div>

          <TopBarDivider />

          <div className="flex items-center gap-1">
            <TopBarLabel>Scene</TopBarLabel>
            {editField === 'scene' ? (
              <input ref={inputRef} type="number" min={1} max={sceneNav.total} value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditField(null); }}
                onBlur={commit} className={inputClass} />
            ) : (
              <button type="button"
                onClick={() => { setEditField('scene'); setEditValue(String(sceneNav.currentSceneNum)); }}
                className="text-[10px] font-mono text-text-secondary hover:text-text-primary transition-colors tabular-nums">
                {sceneNav.currentSceneNum}<span className="text-text-dim/40">/{sceneNav.total}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <TopBarStats variant="empty">No scenes</TopBarStats>
      )}

      {/* Divider after the Arc/Scene navigator — only rendered when a
          contextual section actually follows on the left half of the bar.
          Modes with no inline content (present / future / mode, or graph
          mode without a copy-eligible view) skip the divider so the
          navigator doesn't end with a dangling separator. */}
      {narrative && sceneNav.total > 0 && (
        (canvasMode === 'graph' && (isExportableGraphMode(graphViewMode) || state.viewState.selectedKnowledgeEntity)) ||
        canvasMode === 'plan' ||
        canvasMode === 'audio' ||
        canvasMode === 'prose' ||
        canvasMode === 'market' ||
        canvasMode === 'search' ||
        (canvasMode === 'reasoning' && (activeInvestigation || currentWorldBuildData.worldBuild?.reasoningGraph || currentArcData.arc?.reasoningGraph))
      ) && <TopBarDivider />}

      {/* Export current graph view. Sits on the left rail after arc/scene
          nav so it's available regardless of which domain tab is active. */}
      {narrative && canvasMode === 'graph' && (isExportableGraphMode(graphViewMode) || state.viewState.selectedKnowledgeEntity) && (() => {
        const selectedId = state.viewState.selectedKnowledgeEntity;
        const selectedName = selectedId
          ? (narrative.characters[selectedId] ?? narrative.locations[selectedId] ?? narrative.artifacts?.[selectedId])?.name ?? null
          : null;
        const label = graphViewLabel(graphViewMode, selectedName);
        return (
          <>
            <CopyButton
              label={`Copy ${label.full}`}
              title={`Copy ${label.full} as Markdown`}
              getText={() =>
                exportGraphView({
                  narrative,
                  mode: graphViewMode,
                  resolvedKeys: state.resolvedEntryKeys,
                  currentSceneIndex: state.viewState.currentSceneIndex,
                  selectedEntityId: selectedId,
                })
              }
              className={TOPBAR_TEXT_BUTTON}
            />
          </>
        );
      })()}

      {/* Contextual controls per mode */}
      {canvasMode === 'plan' && (
        <div className="flex items-center gap-2">
          {currentScene && (currentScene.planVersions?.length ?? 0) > 0 && (
            <VersionSelector
              versions={currentScene.planVersions ?? []}
              currentVersion={currentPlanVersion}
              pinnedVersion={pinnedPlanVersion}
              type="plan"
              onSelectVersion={handleSelectPlanVersion}
              onPinVersion={handlePinPlanVersion}
            />
          )}
          {planStats && (
            <TopBarStats mono>
              {planStats.beats} beats{planStats.propositions > 0 && <> &middot; {planStats.propositions} props</>}
            </TopBarStats>
          )}
          {!planStats && <TopBarStats variant="empty">No plan</TopBarStats>}

          {/* Copy current plan as Markdown */}
          {narrative && currentScene && branchId && planStats && (
            <>
              <TopBarDivider />
              <CopyButton
                label="Copy Plan"
                title="Copy plan as Markdown"
                getText={() =>
                  exportScenePlan({
                    narrative,
                    scene: currentScene,
                    branchId,
                    sceneNumber: sceneNav.currentSceneNum,
                    totalScenes: sceneNav.total,
                    planVersion: currentPlanVersion,
                  })
                }
                className={TOPBAR_TEXT_BUTTON}
              />
            </>
          )}

          {/* Regenerate Embeddings button (plan mode only) */}
          {narrative && (
            <>
              <TopBarDivider />
              <button
                onClick={() => setShowEmbeddingsModal(true)}
                className={TOPBAR_ICON_BUTTON}
                title="Regenerate Embeddings"
              >
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
                <span>Refresh</span>
              </button>
            </>
          )}
        </div>
      )}

      {canvasMode === 'audio' && (
        <div className="flex items-center gap-2">
          {currentScene?.audioUrl
            ? <TopBarStats>Ready</TopBarStats>
            : proseStats
              ? <TopBarStats variant="empty">Not generated</TopBarStats>
              : <TopBarStats variant="empty">No prose</TopBarStats>}
        </div>
      )}

      {canvasMode === 'prose' && (
        <div className="flex items-center gap-2">
          {currentScene && (currentScene.proseVersions?.length ?? 0) > 0 && (
            <VersionSelector
              versions={currentScene.proseVersions ?? []}
              currentVersion={currentProseVersion}
              pinnedVersion={pinnedProseVersion}
              type="prose"
              onSelectVersion={handleSelectProseVersion}
              onPinVersion={handlePinProseVersion}
              planVersions={currentScene.planVersions}
            />
          )}
          {proseStats && (
            <TopBarStats mono>
              {proseStats.words.toLocaleString()} words &middot; {proseStats.paragraphs} paragraphs
            </TopBarStats>
          )}
          {!proseStats && planStats && <TopBarStats variant="empty">Not written</TopBarStats>}
          {!proseStats && !planStats && <TopBarStats variant="empty">No plan</TopBarStats>}

          {/* Copy current prose as Markdown */}
          {narrative && currentScene && branchId && proseStats && (
            <>
              <TopBarDivider />
              <CopyButton
                label="Copy Prose"
                title="Copy prose as Markdown"
                getText={() =>
                  exportSceneProse({
                    narrative,
                    scene: currentScene,
                    branchId,
                    sceneNumber: sceneNav.currentSceneNum,
                    totalScenes: sceneNav.total,
                    proseVersion: currentProseVersion,
                  })
                }
                className={TOPBAR_TEXT_BUTTON}
              />
            </>
          )}

          {/* Beat plan toggle (only when beat mapping exists) */}
          {showBeatPlanToggle && (
            <>
              <TopBarDivider />
              <BeatPlanToggle />
            </>
          )}
        </div>
      )}

      {canvasMode === 'market' && narrative && (
        <>
          <CopyButton
            label="Copy Market Snapshot"
            title="Copy prediction-market snapshot as Markdown"
            getText={() =>
              exportMarketSnapshot({
                narrative,
                resolvedKeys: state.resolvedEntryKeys,
                currentSceneIndex: state.viewState.currentSceneIndex,
              })
            }
            className={TOPBAR_TEXT_BUTTON}
          />
        </>
      )}

      {canvasMode === 'search' && (
        <div className="flex items-center gap-2">
          {/* Clear Search button */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('search:clear'))}
            className={TOPBAR_ICON_BUTTON}
            title="Clear Search"
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
            <span>Clear</span>
          </button>

          {/* Regenerate Embeddings button */}
          {narrative && (
            <>
              <TopBarDivider />
              <button
                onClick={() => setShowEmbeddingsModal(true)}
                className={TOPBAR_ICON_BUTTON}
                title="Regenerate Embeddings"
              >
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
                <span>Generate Embeddings</span>
              </button>
            </>
          )}
        </div>
      )}

      {canvasMode === 'reasoning' && activeInvestigation && (
        <div className="flex items-center gap-2 ml-3 min-w-0">
          {/* Switching between investigations now lives in the bottom palette
              (active-investigation dropdown), matching the mode graph pattern.
              The top strip just shows the active graph's actions. */}
          <button
            onClick={() => {
              navigator.clipboard.writeText(buildSequentialPath(activeInvestigation.graph));
              setReasoningCopied(true);
              setTimeout(() => setReasoningCopied(false), 2000);
            }}
            className={TOPBAR_ICON_BUTTON}
            title="Copy sequential reasoning path"
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            <span>{reasoningCopied ? "Copied!" : "Copy"}</span>
          </button>
          <button
            onClick={() => downloadGraphAsJson(activeInvestigation.graph, `investigation-${activeInvestigation.id}`)}
            className={TOPBAR_ICON_BUTTON}
            title="Export graph as JSON"
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>Export</span>
          </button>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('open-generate-panel', {
                detail: {
                  continuationMode: true,
                  storyDirection: buildSequentialPath(activeInvestigation.graph),
                },
              }));
            }}
            className={TOPBAR_ICON_BUTTON}
            title="Open Generate with this reasoning prefilled as direction"
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>
            </svg>
            <span>Use as direction</span>
          </button>
        </div>
      )}
      {canvasMode === 'reasoning' && !activeInvestigation && (currentWorldBuildData.worldBuild?.reasoningGraph || currentArcData.arc?.reasoningGraph) && (
        <GraphInfoStrip
          graph={(currentWorldBuildData.worldBuild?.reasoningGraph || currentArcData.arc?.reasoningGraph)!}
          copied={reasoningCopied}
          onCopy={() => {
            const graph = currentWorldBuildData.worldBuild?.reasoningGraph || currentArcData.arc?.reasoningGraph;
            if (graph) {
              navigator.clipboard.writeText(buildSequentialPath(graph));
              setReasoningCopied(true);
              setTimeout(() => setReasoningCopied(false), 2000);
            }
          }}
          onExport={() => {
            const graph = currentWorldBuildData.worldBuild?.reasoningGraph || currentArcData.arc?.reasoningGraph;
            if (graph) downloadGraphAsJson(graph, currentArcData.arc?.name ?? 'causal-graph');
          }}
        />
      )}
      {canvasMode === 'mode' && activeMode && (
        <GraphInfoStrip
          graph={activeMode}
          copied={phaseCopied}
          onCopy={() => {
            navigator.clipboard.writeText(buildSequentialPath({ nodes: activeMode.nodes, edges: activeMode.edges }));
            setPhaseCopied(true);
            setTimeout(() => setPhaseCopied(false), 2000);
          }}
          onExport={() => downloadGraphAsJson(activeMode, activeMode.name ?? 'mode')}
        />
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right — Mode toggles */}
      <div className="flex items-center gap-2">
        {/* Graph sub-controls: scope + domain */}
        {canvasMode === 'graph' && (
          <>
            {/* Scope toggle — only for scoped domains (World/System/Threads). */}
            {scopePair && (
              <div className="flex items-center rounded-md overflow-hidden border border-white/10">
                <button
                  className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                    isLocal
                      ? 'bg-white/10 text-text-primary'
                      : 'text-text-dim/60 hover:text-text-secondary hover:bg-white/5'
                  }`}
                  onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: scopePair.local })}
                >
                  Scene
                </button>
                <div className="w-px h-4 bg-white/10" />
                <button
                  className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                    !isLocal
                      ? 'bg-white/10 text-text-primary'
                      : 'text-text-dim/60 hover:text-text-secondary hover:bg-white/5'
                  }`}
                  onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: scopePair.global })}
                >
                  Full
                </button>
              </div>
            )}

            {/* Domain tabs */}
            <div className="flex items-center rounded-md overflow-hidden border border-white/10">
              {GRAPH_DOMAINS.map(({ label, local, global: globalMode, Icon, scopeless }, idx) => {
                const isActive = graphViewMode === local || graphViewMode === globalMode;
                const useLocal = scopePair ? isLocal : lastIsLocalRef.current;
                return (
                  <div key={label} className="flex items-center">
                    {idx > 0 && <div className="w-px h-4 bg-white/10" />}
                    <button
                      className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                        isActive
                          ? 'bg-white/10 text-text-primary'
                          : 'text-text-dim/60 hover:text-text-secondary hover:bg-white/5'
                      }`}
                      onClick={() => dispatch({
                        type: 'SET_GRAPH_VIEW_MODE',
                        mode: scopeless ? local : (useLocal ? local : globalMode),
                      })}
                    >
                      <Icon size={12} />
                      {label}
                    </button>
                  </div>
                );
              })}
            </div>

          </>
        )}

        {/* Control sub-mode toggle — Opinion · Present · Future · Mode.
            Opinion reflects reality (markets); Present is the realized
            variables disposition; Future is the predictive scenario cohort;
            Mode is the working-machinery graph — a graphical context that
            permeates downstream planning. */}
        {inControlMode && (
          <div className="flex items-center rounded-md overflow-hidden border border-white/10">
            {[
              { mode: 'market' as const, label: 'Opinion' },
              { mode: 'present' as const, label: 'Present' },
              { mode: 'future' as const, label: 'Future' },
              { mode: 'mode' as const, label: 'Mode' },
            ].map(({ mode, label }, idx) => {
              const isActive = graphViewMode === mode;
              return (
                <div key={mode} className="flex items-center">
                  {idx > 0 && <div className="w-px h-4 bg-white/10" />}
                  <button
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                      isActive
                        ? 'bg-white/10 text-text-primary'
                        : 'text-text-dim/60 hover:text-text-secondary hover:bg-white/5'
                    }`}
                    onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode })}
                  >
                    {label}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Scene sub-mode toggle (renders to the LEFT of primary, matching
            the graph scope/domain toggle pattern). Only shown in Scene mode. */}
        {inSceneMode && currentScene && (
          <div className="flex items-center rounded-md overflow-hidden border border-white/10">
            {[
              { mode: 'reasoning' as ScenePrimaryMode, Icon: IconReasoning, label: 'Investigation', hidden: currentArcInvestigations.length === 0 && !currentArcData.hasReasoningGraph && !currentWorldBuildData.hasReasoningGraph },
              { mode: 'plan' as ScenePrimaryMode, Icon: IconNotepad, label: 'Plan', hidden: false },
              { mode: 'prose' as ScenePrimaryMode, Icon: IconDocument, label: 'Prose', hidden: false },
              { mode: 'audio' as ScenePrimaryMode, Icon: IconWaveform, label: 'Audio', hidden: false },
              { mode: 'game' as ScenePrimaryMode, Icon: IconDice, label: 'Game', hidden: false },
            ]
              .filter(({ hidden }) => !hidden)
              .map(({ mode, Icon, label }, idx) => {
                const isActive = canvasMode === mode;
                return (
                  <div key={mode} className="flex items-center">
                    {idx > 0 && <div className="w-px h-4 bg-white/10" />}
                    <button
                      className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                        isActive
                          ? 'bg-white/10 text-text-primary'
                          : 'text-text-dim/60 hover:text-text-secondary hover:bg-white/5'
                      }`}
                      onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode })}
                    >
                      <Icon size={12} />
                      {label}
                    </button>
                  </div>
                );
              })}
          </div>
        )}

        {/* Main canvas mode selector. Plan/Prose/Audio collapse into "Scene";
            Opinion/Variables/Phase collapse into "Control". The sub-mode
            toggles render to the left for each cluster. */}
        <div className="flex items-center rounded-md overflow-hidden border border-white/10">
          {[
            { mode: 'graph' as const, Icon: IconNetwork, label: 'Graph', condition: 'always' as const, activeWhen: canvasMode === 'graph' },
            { mode: 'control' as const, Icon: IconMarket, label: 'Control', condition: 'always' as const, activeWhen: inControlMode },
            { mode: 'scene' as const, Icon: IconNotepad, label: 'Scene', condition: 'sceneOnly' as const, activeWhen: inSceneMode },
            { mode: 'search' as const, Icon: IconSearch, label: 'Search', condition: 'always' as const, activeWhen: canvasMode === 'search' },
          ]
            .filter(({ condition }) => {
              if (condition === 'sceneOnly' && !currentScene) return false;
              return true;
            })
            .map(({ mode, Icon, label, activeWhen }, idx) => {
              return (
                <div key={mode} className="flex items-center">
                  {idx > 0 && <div className="w-px h-4 bg-white/10" />}
                  <button
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                      activeWhen
                        ? 'bg-white/10 text-text-primary'
                        : 'text-text-dim/60 hover:text-text-secondary hover:bg-white/5'
                    }`}
                    onClick={() => {
                      if (mode === 'scene') {
                        dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: lastSceneModeRef.current });
                      } else if (mode === 'control') {
                        dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: lastControlSubModeRef.current });
                      } else {
                        switchMode(mode);
                      }
                    }}
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                </div>
              );
            })}
        </div>
      </div>

      {/* Regenerate Embeddings Modal */}
      {showEmbeddingsModal && (
        <RegenerateEmbeddingsModal onClose={() => setShowEmbeddingsModal(false)} />
      )}
    </div>
  );
}

// ── Shared graph info strip ─────────────────────────────────────────────────
// Renders the compact "N nodes · M edges · summary | Copy | Export" cluster
// shown in the top bar for both Causal (CRG) and Phase (PRG) modes. No
// leading label — the active tab already tells the user which graph.
type GraphLike = {
  nodes: { id: string; index: number; order?: number; type: string; label: string; detail?: string }[];
  edges: { id: string; from: string; to: string; type: string; label?: string }[];
  summary: string;
};
function GraphInfoStrip({
  graph,
  copied,
  onCopy,
  onExport,
}: {
  graph: GraphLike;
  copied: boolean;
  onCopy: () => void;
  onExport: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-px h-3 bg-border" />
      <button
        onClick={onCopy}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-text-dim/60 hover:text-text-dim transition-colors"
        title="Copy sequential reasoning path"
      >
        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
        <span>{copied ? "Copied!" : "Copy"}</span>
      </button>
      <button
        onClick={onExport}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-text-dim/60 hover:text-text-dim transition-colors"
        title="Export graph as JSON"
      >
        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>Export</span>
      </button>
    </div>
  );
}

// Download a graph snapshot as a JSON file. The filename uses the supplied
// label (arc name / PRG name) sanitised for filesystem safety.
function downloadGraphAsJson(graph: object, label: string) {
  if (typeof window === "undefined") return;
  const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "graph";
  const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
