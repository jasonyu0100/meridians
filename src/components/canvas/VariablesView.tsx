'use client';

import { useCallback, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { outlineContext } from '@/lib/ai/context';
import { buildActiveModeSection } from '@/lib/ai/mode-graph';
import {
  extractArcPresent,
  generatePlanningScenarios,
  rescoreScenario,
  SCENARIO_COLORS,
  scenarioProbabilities,
  type VariablesContextSource,
} from '@/lib/ai/variables';
import type { PlanningScenario, Variable } from '@/types/narrative';
import DispositionEditor from './variables/DispositionEditor';
import VariableParallelCoords from './variables/VariableParallelCoords';
import BentoTile, { TileLabel } from './variables/BentoTile';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { IconFlask } from '@/components/icons';
import { findHeadArc } from '@/hooks/useExperimentation';

/**
 * Variables view — Control → Present | Future.
 *
 * Each arc owns its OWN Present variable set, custom-generated for that
 * arc. Each Future scenario on an arc owns its OWN scenario-specific
 * variable set, custom-generated for that particular future. There is no
 * shared catalogue, no cross-arc vocabulary.
 *
 * Fresh-page state: an arc with no Present variables (and a Future tab
 * with no scenarios) shows a seed form so the user can spin up that
 * scope's set on demand.
 */

type Mode = 'present' | 'future';
const PRESENT_TRACE_COLOR = '#a78bfa';
const FUTURE_TRACE_COLOR = '#34d399';

interface VariablesViewProps {
  mode: Mode;
}

export default function VariablesView({ mode }: VariablesViewProps) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  if (!narrative) {
    return <Empty message="No active narrative." />;
  }

  const currentEntryId = state.resolvedEntryKeys[state.viewState.currentSceneIndex] ?? null;
  const currentScene = currentEntryId ? narrative.scenes[currentEntryId] : null;
  const isWorldCommit = !!currentEntryId && !currentScene && !!narrative.worldBuilds[currentEntryId];

  if (isWorldCommit) {
    return (
      <Empty
        title="World commit selected"
        message="Variables describe the machinery active in a scene. Navigate to a scene to inspect or plan its variables."
      />
    );
  }

  const focusedArcId = currentScene?.arcId ?? null;
  const focusedArc = focusedArcId ? narrative.arcs[focusedArcId] : null;

  if (!focusedArc) {
    return (
      <Empty
        title="No arc on this scene"
        message="The currently-viewed scene isn't grouped under an arc, so there's no variable surface to show."
      />
    );
  }

  const contextSource: VariablesContextSource = {
    title: narrative.title,
    characters: narrative.characters,
    locations: narrative.locations,
    artifacts: narrative.artifacts,
    threads: narrative.threads,
    arcs: narrative.arcs,
    scenes: narrative.scenes,
    orderedEntryIds: state.resolvedEntryKeys,
    asOfEntryId: currentEntryId ?? undefined,
  };

  // High-signal context blocks for every LLM call — built once here, reused
  // by all three variable functions (Present extract, Future generation,
  // scenario re-score). `outlineContext` is the tight arc-by-arc story
  // recap up to the current scene; `buildActiveModeSection` folds in the
  // working-machinery substrate so dials inherit from it.
  const outline = outlineContext(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
  const modeSection = buildActiveModeSection(narrative, 'variables');

  return (
    <VariablesViewInner
      mode={mode}
      narrative={narrative}
      focusedArc={focusedArc}
      contextSource={contextSource}
      outline={outline}
      modeSection={modeSection}
      resolvedEntryKeys={state.resolvedEntryKeys}
      dispatch={dispatch}
    />
  );
}

interface InnerProps {
  mode: Mode;
  narrative: NonNullable<ReturnType<typeof useStore>['state']['activeNarrative']>;
  focusedArc: NonNullable<ReturnType<typeof useStore>['state']['activeNarrative']>['arcs'][string];
  contextSource: VariablesContextSource;
  outline: string;
  resolvedEntryKeys: string[];
  modeSection: string;
  dispatch: ReturnType<typeof useStore>['dispatch'];
}

function VariablesViewInner({ mode, narrative, focusedArc, contextSource, outline, modeSection, resolvedEntryKeys, dispatch }: InnerProps) {
  // The "head arc" — the arc owning the latest scene in the active
  // branch — is the only arc Experimentation can actually run against,
  // because the parallel workers continue from the branch head. This
  // walks `resolvedEntryKeys` backward for the last scene, matching the
  // same helper `useExperimentation` uses internally.
  const headArc = useMemo(
    () => findHeadArc(narrative, resolvedEntryKeys),
    [narrative, resolvedEntryKeys],
  );
  const isHeadArc = !!headArc && focusedArc.id === headArc.id;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<string>(focusedArc.scenarioDirection ?? '');
  const [directionModalOpen, setDirectionModalOpen] = useState(false);
  // Streaming reasoning trace from the regenerate calls. Mirrors the
  // plan/prose minimal-trace overlay — accumulates while busy, clears on
  // finish so the body re-renders normally with the new variables.
  const [streamingReasoning, setStreamingReasoning] = useState('');

  // Defensively coerce. New shape: Variable[] (full defs + intensity). Old
  // persisted shape: legacy `.activations` without definitions. Stale entries
  // missing required fields are dropped — the user regenerates.
  const presentVariables = useMemo<Variable[]>(() => {
    const raw = focusedArc.presentVariables;
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is Variable => !!v && typeof v === 'object' && typeof (v as Variable).name === 'string');
  }, [focusedArc.presentVariables]);
  const scenarios = useMemo<PlanningScenario[]>(() => {
    const raw = focusedArc.planningScenarios;
    if (!Array.isArray(raw)) return [];
    return raw.map((s) => ({
      ...s,
      variables: Array.isArray(s.variables)
        ? s.variables.filter((v): v is Variable => !!v && typeof v === 'object' && typeof (v as Variable).name === 'string')
        : [],
    }));
  }, [focusedArc.planningScenarios]);

  const [temperature, setTemperature] = useState(1);

  // ── Pending-edits + draft scenario state ────────────────────────────────
  // A scenario's edits are staged locally until the user commits via
  // "Save & Re-score". The rescore call re-evaluates priorLogit + rationale
  // against the cohort, and only then do the changes persist. Drafts (new
  // scenarios) live in the same pending slot until first commit.
  type PendingScenario = {
    /** True = scenario doesn't exist in `focusedArc.planningScenarios` yet. */
    isDraft: boolean;
    id: string;
    name: string;
    tagline?: string;
    color: string;
    variables: Variable[];
  };
  const [pending, setPending] = useState<PendingScenario | null>(null);

  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(scenarios[0]?.id ?? null);
  const [hoveredScenarioId, setHoveredScenarioId] = useState<string | null>(null);

  // Display list = committed scenarios + pending draft (if any). Pending
  // edits to an existing scenario don't add to the list — they just shadow
  // the committed entry inside the active panel.
  const displayedScenarios = useMemo<PlanningScenario[]>(() => {
    if (!pending || !pending.isDraft) return scenarios;
    return [
      ...scenarios,
      {
        id: pending.id,
        name: pending.name,
        tagline: pending.tagline,
        color: pending.color,
        variables: pending.variables,
        // Draft scenarios have no priorLogit until first commit; they sit
        // at logit 0 (baseline) so they appear with some probability in
        // the sidebar but are visually marked as unsaved.
        priorLogit: 0,
      } as PlanningScenario,
    ];
  }, [scenarios, pending]);

  const probs = useMemo(
    () => scenarioProbabilities(displayedScenarios, temperature),
    [displayedScenarios, temperature],
  );
  const ranks = useMemo(() => {
    const sorted = [...displayedScenarios].sort((a, b) => (probs[b.id] ?? 0) - (probs[a.id] ?? 0));
    const m = new Map<string, number>();
    sorted.forEach((s, i) => m.set(s.id, i + 1));
    return m;
  }, [displayedScenarios, probs]);

  // Active scenario as displayed — pending shadow wins over committed when
  // they share an id. For a draft, the pending entry IS the only source.
  const activeScenario = useMemo<PlanningScenario | null>(() => {
    if (pending && pending.id === activeScenarioId) {
      return {
        id: pending.id,
        name: pending.name,
        tagline: pending.tagline,
        color: pending.color,
        variables: pending.variables,
        priorLogit: pending.isDraft ? 0 : scenarios.find((s) => s.id === pending.id)?.priorLogit,
        priorRationale: pending.isDraft ? undefined : scenarios.find((s) => s.id === pending.id)?.priorRationale,
      };
    }
    return displayedScenarios.find((s) => s.id === activeScenarioId) ?? displayedScenarios[0] ?? null;
  }, [pending, activeScenarioId, scenarios, displayedScenarios]);

  if (displayedScenarios.length > 0 && (activeScenarioId === null || !displayedScenarios.find((s) => s.id === activeScenarioId))) {
    setActiveScenarioId(displayedScenarios[0].id);
  }

  const setPresentIntensity = (variableId: string, intensity: number) => {
    const next = presentVariables
      .map((v) => (v.id === variableId ? { ...v, intensity } : v))
      .filter((v) => v.intensity > 0);
    dispatch({ type: 'SET_ARC_PRESENT_VARIABLES', arcId: focusedArc.id, variables: next });
  };

  // Begin staging — copy the active scenario into `pending` if it isn't
  // already. Subsequent edits mutate `pending`.
  const ensurePendingForActive = (): PendingScenario | null => {
    if (pending && pending.id === activeScenarioId) return pending;
    if (!activeScenario) return null;
    const next: PendingScenario = {
      isDraft: false,
      id: activeScenario.id,
      name: activeScenario.name,
      tagline: activeScenario.tagline,
      color: activeScenario.color,
      variables: activeScenario.variables.map((v) => ({ ...v })),
    };
    setPending(next);
    return next;
  };

  const setScenarioIntensity = (variableId: string, intensity: number) => {
    const base = ensurePendingForActive();
    if (!base) return;
    const nextVars = base.variables.some((v) => v.id === variableId)
      ? base.variables.map((v) => (v.id === variableId ? { ...v, intensity } : v)).filter((v) => v.intensity > 0)
      : base.variables.filter((v) => v.intensity > 0);
    setPending({ ...base, variables: nextVars });
  };

  // Pool of variables the active scenario *could* adopt — drawn ONLY from
  // sibling scenarios in the same cohort. Present and Future are separate
  // surfaces; their variable sets never cross.
  const activeScenarioPool = useMemo<Variable[]>(() => {
    if (!activeScenario) return [];
    const pool: Variable[] = [];
    for (const s of scenarios) {
      if (s.id === activeScenario.id) continue;
      for (const v of s.variables) pool.push(v);
    }
    return pool;
  }, [activeScenario, scenarios]);

  const addVariableToActiveScenario = (variable: Variable) => {
    const base = ensurePendingForActive();
    if (!base) return;
    const existsById = base.variables.some((v) => v.id === variable.id);
    const existsByName = base.variables.some(
      (v) => v.name.toLowerCase().trim() === variable.name.toLowerCase().trim(),
    );
    if (existsById || existsByName) return;
    setPending({ ...base, variables: [...base.variables, variable] });
  };

  /** Begin a new draft scenario in the sidebar. Pre-seeds the dial pool at
   *  intensity 0 so the user can crank up the ones that matter; saving
   *  filters out everything still at 0 and rescore yields the rationale +
   *  priorLogit. */
  const addDraftScenario = () => {
    if (pending && pending.isDraft) {
      // A draft already exists — just focus it.
      setActiveScenarioId(pending.id);
      return;
    }
    const id = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const idx = scenarios.length + (pending && pending.isDraft ? 1 : 0);
    const draft: PendingScenario = {
      isDraft: true,
      id,
      name: `New scenario ${scenarios.length + 1}`,
      color: SCENARIO_COLORS[idx % SCENARIO_COLORS.length],
      variables: [],
    };
    setPending(draft);
    setActiveScenarioId(id);
  };

  const setPendingName = (name: string) => {
    if (!pending) return;
    setPending({ ...pending, name });
  };

  const discardPending = () => {
    if (!pending) return;
    if (pending.isDraft) {
      // The draft has no committed counterpart — selecting the first
      // committed scenario (if any) after discarding keeps the UI focused.
      setActiveScenarioId(scenarios[0]?.id ?? null);
    }
    setPending(null);
    setError(null);
  };

  /** Commit pending edits — re-scores the scenario via the LLM, then
   *  persists the new variables + priorLogit + priorRationale atomically. */
  const commitPending = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      // Filter out dials at intensity 0 before sending to the rescore.
      const committedVars = pending.variables.filter((v) => v.intensity > 0);
      if (committedVars.length === 0) {
        setError('Activate at least one dial before saving.');
        setBusy(false);
        return;
      }
      const draftForRescore: PlanningScenario = {
        id: pending.id,
        name: pending.name,
        tagline: pending.tagline,
        color: pending.color,
        variables: committedVars,
      };
      // Cohort = the other committed scenarios. Used for relative anchoring.
      const cohort = scenarios.filter((s) => s.id !== pending.id);
      const result = await rescoreScenario({
        narrativeTitle: narrative.title,
        arc: {
          id: focusedArc.id,
          name: focusedArc.name,
          directionVector: focusedArc.directionVector,
          summary: focusedArc.worldState,
        },
        scenario: draftForRescore,
        cohort,
        context: contextSource,
        outline,
        modeSection,
      });
      const finalised: PlanningScenario = {
        ...draftForRescore,
        priorLogit: result.priorLogit,
        priorRationale: result.priorRationale || undefined,
      };
      const updated = pending.isDraft
        ? [...scenarios, finalised]
        : scenarios.map((s) => (s.id === pending.id ? finalised : s));
      dispatch({ type: 'SET_ARC_PLANNING_SCENARIOS', arcId: focusedArc.id, scenarios: updated });
      setPending(null);
      setActiveScenarioId(finalised.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [pending, scenarios, narrative.title, focusedArc, contextSource, outline, modeSection, dispatch]);

  // Present has no pool — its variable set stands alone and does not borrow
  // from Future scenarios. The two surfaces are separate by design.

  const generatePresent = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStreamingReasoning('');
    try {
      const variables = await extractArcPresent({
        narrativeTitle: narrative.title,
        arc: { id: focusedArc.id, name: focusedArc.name, directionVector: focusedArc.directionVector, summary: focusedArc.worldState },
        context: contextSource,
        outline,
        modeSection,
        direction: direction.trim() || undefined,
        onReasoning: (token) => setStreamingReasoning((prev) => prev + token),
      });
      dispatch({ type: 'SET_ARC_PRESENT_VARIABLES', arcId: focusedArc.id, variables });
      if (direction.trim()) {
        dispatch({ type: 'SET_ARC_SCENARIO_DIRECTION', arcId: focusedArc.id, direction });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStreamingReasoning('');
    }
  }, [focusedArc, narrative.title, contextSource, outline, modeSection, direction, dispatch]);

  const generateFuture = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStreamingReasoning('');
    try {
      // Future is an independent fresh look from narrative context — NOT a
      // projection of the arc's Present. Both surfaces draw from the same
      // historical record (scenes, threads, roster, prior arcs).
      const generated = await generatePlanningScenarios({
        narrativeTitle: narrative.title,
        arc: { id: focusedArc.id, name: focusedArc.name, directionVector: focusedArc.directionVector, summary: focusedArc.worldState },
        context: contextSource,
        outline,
        modeSection,
        direction: direction.trim() || undefined,
        count: 7,
        onReasoning: (token) => setStreamingReasoning((prev) => prev + token),
      });
      if (generated.length > 0) {
        dispatch({ type: 'SET_ARC_PLANNING_SCENARIOS', arcId: focusedArc.id, scenarios: generated });
        setActiveScenarioId(generated[0].id);
        if (direction.trim()) {
          dispatch({ type: 'SET_ARC_SCENARIO_DIRECTION', arcId: focusedArc.id, direction });
        }
      } else {
        setError('No scenarios produced.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStreamingReasoning('');
    }
  }, [focusedArc, narrative.title, contextSource, outline, modeSection, direction, dispatch]);

  const removeActiveScenario = () => {
    if (!activeScenario) return;
    const next = scenarios.filter((s) => s.id !== activeScenario.id);
    dispatch({ type: 'SET_ARC_PLANNING_SCENARIOS', arcId: focusedArc.id, scenarios: next });
    setActiveScenarioId(next[0]?.id ?? null);
  };

  const wipeArc = useCallback(() => {
    if (typeof window !== 'undefined' && !window.confirm(`Wipe ${focusedArc.name}'s Present variables, scenarios, plausibility, and direction?`)) return;
    dispatch({ type: 'WIPE_ARC_VARIABLES', arcId: focusedArc.id });
    setActiveScenarioId(null);
    setError(null);
  }, [dispatch, focusedArc.id, focusedArc.name]);

  // The topbar always renders; the fresh-page seed form just replaces the
  // body when there's nothing to display.
  const isEmpty = mode === 'present'
    ? presentVariables.length === 0
    : scenarios.length === 0;

  const accent = mode === 'present' ? PRESENT_TRACE_COLOR : FUTURE_TRACE_COLOR;
  const modeLabel = mode === 'present' ? 'Present' : 'Future';

  const onRegenerate = mode === 'present' ? generatePresent : generateFuture;
  const regenerateLabel = mode === 'present' ? 'Regenerate Present' : 'Regenerate Future';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Mirror the canvas top bar exactly — same `glass-panel border-b
          border-border` chrome. Accent shows only on the small dot, the
          rest is neutral so the two bars stack as a consistent surface. */}
      <div className="h-9 shrink-0 flex items-center px-2 gap-2 glass-panel border-b border-border">
        <span
          className="w-2 h-2 rounded-full ml-1 shrink-0"
          style={{ background: accent, boxShadow: `0 0 4px ${accent}aa` }}
        />
        <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim font-mono">{modeLabel}</span>
        <div className="w-px h-3 bg-border" />
        <span className="text-[11px] text-text-primary truncate max-w-[40vw]">
          {focusedArc.name}{isHeadArc ? <span className="text-text-dim/60"> · head</span> : null}
        </span>
        {mode === 'present' && presentVariables.length > 0 && (
          <span className="text-[9px] text-text-dim/60 font-mono tabular-nums">{presentVariables.length} dials</span>
        )}
        {mode === 'future' && scenarios.length > 0 && (
          <span className="text-[9px] text-text-dim/60 font-mono tabular-nums">{scenarios.length} futures</span>
        )}
        {error && <span className="text-[9px] text-rose-300/80 font-mono truncate max-w-[20vw]">{error}</span>}

        <div className="flex-1" />

        {/* Action cluster — minimal: single Regenerate (opens modal with
            optional direction) + Clear, separated by a thin divider. No
            bordered enclosure; the chrome stays out of the way.
            Future mode also surfaces "Experiment" — kicks off the parallel
            branch generation directly from this topbar instead of forcing
            the user into the graph view's floating palette. Gated on
            (a) head arc — workers anchor on the branch tip; and
            (b) at least one scenario with variables, since the cohort is
            the input to the batch. */}
        {mode === 'future' && isHeadArc && scenarios.some((s) => Array.isArray(s.variables) && s.variables.length > 0) && (
          <>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('open-experimentation-panel'))}
              disabled={busy}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-blue-300/90 hover:text-blue-200 disabled:opacity-30 transition-colors"
              title="Experiment — generate parallel branches from these scenarios"
            >
              <IconFlask size={11} />
              <span>Experiment</span>
            </button>
            <div className="w-px h-4 bg-white/10" />
          </>
        )}
        <button
          onClick={() => setDirectionModalOpen(true)}
          disabled={busy}
          className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-text-dim/70 hover:text-text-primary disabled:opacity-30 transition-colors"
          title={regenerateLabel}
        >
          {busy
            ? <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-white/70" />
            : (
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
            )}
          <span>{busy ? 'Working…' : regenerateLabel}</span>
          {direction.trim() && <span className="w-1 h-1 rounded-full bg-white/60" title="direction set" />}
        </button>
        <div className="w-px h-4 bg-white/10" />
        <button
          onClick={wipeArc}
          disabled={busy}
          className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-text-dim/60 hover:text-rose-300 disabled:opacity-30 transition-colors"
          title="Wipe this arc's variables, scenarios, and direction"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
          </svg>
          <span>Clear</span>
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {/* Top bar light — identical effect to the canvas page's
            `barLightTop` wash so both stacked bars carry the same
            illumination. Pinned to the top of the content area; content
            scrolls under it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10"
          style={{
            height: 320,
            background:
              'linear-gradient(to bottom, rgba(221, 214, 254, 0.22) 0%, rgba(210, 197, 253, 0.11) 12%, rgba(196, 181, 253, 0.05) 32%, rgba(196, 181, 253, 0.02) 60%, transparent 100%)',
            mixBlendMode: 'screen',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10"
          style={{
            height: 1,
            background:
              'linear-gradient(to right, transparent 0%, rgba(196, 181, 253, 0.55) 18%, rgba(237, 233, 254, 0.85) 50%, rgba(196, 181, 253, 0.55) 82%, transparent 100%)',
          }}
        />
        <div className="absolute inset-0 overflow-y-auto">
        {busy ? (
          <div className="max-w-2xl mx-auto px-8 pt-6 pb-32">
            <div className="flex items-center gap-2 mb-4">
              <div
                className="w-3 h-3 border-2 rounded-full animate-spin"
                style={{ borderColor: `${accent}30`, borderTopColor: `${accent}cc` }}
              />
              <span className="text-[10px] text-text-dim">
                {mode === 'present' ? 'Extracting present dials…' : 'Generating future scenarios…'}
              </span>
            </div>
            {streamingReasoning && (
              <p className="text-[11px] text-text-dim/60 leading-relaxed whitespace-pre-wrap">
                {streamingReasoning}
              </p>
            )}
          </div>
        ) : isEmpty ? (
          <FreshPage mode={mode} />
        ) : mode === 'present' ? (
          <PresentBento
            variables={presentVariables}
            onChange={setPresentIntensity}
            error={error}
          />
        ) : (
          <FutureBento
            scenarios={displayedScenarios}
            probs={probs}
            ranks={ranks}
            activeScenario={activeScenario}
            activeScenarioId={activeScenarioId}
            setActiveScenarioId={setActiveScenarioId}
            hoveredScenarioId={hoveredScenarioId}
            setHoveredScenarioId={setHoveredScenarioId}
            temperature={temperature}
            setTemperature={setTemperature}
            activeScenarioPool={activeScenarioPool}
            onScenarioIntensityChange={setScenarioIntensity}
            onAddVariableToActiveScenario={addVariableToActiveScenario}
            onRemoveScenario={removeActiveScenario}
            isDirty={pending !== null && pending.id === activeScenarioId}
            isDraft={pending !== null && pending.isDraft && pending.id === activeScenarioId}
            onCommitPending={commitPending}
            onDiscardPending={discardPending}
            onRenamePending={setPendingName}
            onAddDraftScenario={addDraftScenario}
            busy={busy}
            error={error}
          />
        )}
        </div>
      </div>

      {directionModalOpen && (
        <DirectionModal
          mode={mode}
          arcName={focusedArc.name}
          direction={direction}
          onDirectionChange={setDirection}
          lastDirection={focusedArc.scenarioDirection}
          onRegenerate={() => { setDirectionModalOpen(false); onRegenerate(); }}
          onClose={() => setDirectionModalOpen(false)}
          busy={busy}
        />
      )}
    </div>
  );
}

// ── Direction modal ────────────────────────────────────────────────────────

function DirectionModal({
  mode, arcName, direction, onDirectionChange, lastDirection, onRegenerate, onClose, busy,
}: {
  mode: Mode;
  arcName: string;
  direction: string;
  onDirectionChange: (s: string) => void;
  lastDirection?: string;
  onRegenerate: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const placeholder = mode === 'present'
    ? "What should the variable extraction emphasise?"
    : "What should the scenario cohort bias toward?";
  const title = mode === 'present' ? 'Regenerate Present' : 'Regenerate Future';

  // Style mirrors GeneratePanel.tsx — same Modal size, same uppercase
  // section labels, same `bg-bg-elevated border border-border rounded-lg`
  // input chrome, same primary `flex-1 py-2.5 rounded-lg bg-white/10`
  // action with small secondary Cancel on the right.
  return (
    <Modal onClose={busy ? () => {} : onClose} size="md">
      <ModalHeader onClose={onClose} hideClose={busy}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          <p className="text-[11px] text-text-dim mt-0.5 truncate">{arcName}</p>
        </div>
      </ModalHeader>
      <ModalBody className="p-6 space-y-4">
        <div>
          <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">
            Direction
          </label>
          <textarea
            value={direction}
            onChange={(e) => onDirectionChange(e.target.value)}
            placeholder={placeholder}
            rows={6}
            autoFocus
            className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full resize-none outline-none placeholder:text-text-dim focus:border-white/20"
          />
        </div>

        {lastDirection && lastDirection !== direction && (
          <div className="flex items-baseline gap-2 text-[11px] text-text-dim">
            <span className="text-text-dim/70 shrink-0">Last:</span>
            <span className="italic text-text-secondary truncate flex-1">{lastDirection}</span>
            <button
              onClick={() => onDirectionChange(lastDirection)}
              className="text-text-dim hover:text-text-primary transition-colors underline-offset-2 hover:underline shrink-0"
            >
              restore
            </button>
          </div>
        )}

        {/* Action buttons — matches GeneratePanel's "Generate Arc + Extended"
            footer: primary flex-1 + small secondary on the right. */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onRegenerate}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30 inline-flex items-center justify-center gap-1.5"
          >
            {busy && <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />}
            {busy ? 'Working…' : title}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="py-2.5 px-4 rounded-lg border border-white/8 hover:bg-white/6 text-text-dim hover:text-text-primary transition disabled:opacity-30 text-[12px]"
          >
            Cancel
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ── Fresh-page seed state ──────────────────────────────────────────────────

function FreshPage({
  mode, hint,
}: {
  mode: Mode;
  hint?: string;
}) {
  // Mirrors the Plan/Prose empty state — a quiet centred message pointing
  // at the regenerate action in the topbar above. No inline form; direction
  // is set via the topbar's Regenerate modal.
  const primary = mode === 'present'
    ? 'No Present variables yet for this arc.'
    : 'No Future scenarios yet for this arc.';
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <p className="text-[11px] text-text-dim">{primary}</p>
      <p className="text-[10px] text-text-dim/40">
        Use the Regenerate {mode === 'present' ? 'Present' : 'Future'} action above to generate one.
      </p>
      {hint && (
        <p className="text-[10px] text-amber-300/70 max-w-md text-center leading-relaxed mt-2">
          {hint}
        </p>
      )}
    </div>
  );
}

// ── Present bento ──────────────────────────────────────────────────────────

interface PresentBentoProps {
  variables: Variable[];
  onChange: (variableId: string, intensity: number) => void;
  error: string | null;
}

function PresentBento({
  variables, onChange, error,
}: PresentBentoProps) {
  const traces = useMemo(() =>
    variables.length > 0 ? [{ id: 'present', color: PRESENT_TRACE_COLOR, variables }] : [],
  [variables]);

  return (
    <div className="p-4 flex flex-col gap-3">
      {error && (
        <div className="px-2 text-[11px] text-rose-300/80 font-mono truncate">{error}</div>
      )}

      {/* Parallel coords sits above the editor — the trace establishes the
          shape at a glance, the editor below is where the dials are tweaked. */}
      <BentoTile header={<TileLabel>Shape</TileLabel>}>
        {traces.length === 0 ? (
          <div className="text-[11px] text-text-dim italic py-3">No dials yet. Regenerate to populate.</div>
        ) : (
          <VariableParallelCoords traces={traces} height={220} />
        )}
      </BentoTile>

      <BentoTile
        header={
          <div className="flex items-baseline gap-2">
            <TileLabel count={variables.length}>Dials</TileLabel>
            <span className="ml-auto text-[9px] text-text-dim/60 font-mono">click an intensity to set</span>
          </div>
        }
        flush
      >
        <DispositionEditor
          variables={variables}
          colorByCategory
          onChange={onChange}
        />
      </BentoTile>
    </div>
  );
}

// ── Future bento ───────────────────────────────────────────────────────────

interface FutureBentoProps {
  scenarios: PlanningScenario[];
  probs: Record<string, number>;
  ranks: Map<string, number>;
  activeScenario: PlanningScenario | null;
  activeScenarioId: string | null;
  setActiveScenarioId: (id: string) => void;
  hoveredScenarioId: string | null;
  setHoveredScenarioId: (id: string | null) => void;
  temperature: number;
  setTemperature: (t: number) => void;
  activeScenarioPool: Variable[];
  onScenarioIntensityChange: (variableId: string, intensity: number) => void;
  onAddVariableToActiveScenario: (variable: Variable) => void;
  onRemoveScenario: () => void;
  /** Pending-edit state — true when the active scenario has unsaved dial
   *  edits (or is an unsaved draft). Drives the Save & Re-score affordance. */
  isDirty: boolean;
  /** True if the active pending scenario is a brand-new draft (not yet
   *  committed to the cohort). */
  isDraft: boolean;
  onCommitPending: () => void;
  onDiscardPending: () => void;
  onRenamePending: (name: string) => void;
  /** Add a new draft scenario in the sidebar (intuitive knob-based creation). */
  onAddDraftScenario: () => void;
  busy: boolean;
  error: string | null;
}

function FutureBento(props: FutureBentoProps) {
  const {
    scenarios, probs, ranks,
    activeScenario, activeScenarioId, setActiveScenarioId,
    hoveredScenarioId, setHoveredScenarioId,
    temperature, setTemperature,
    activeScenarioPool,
    onScenarioIntensityChange, onAddVariableToActiveScenario, onRemoveScenario,
    isDirty, isDraft, onCommitPending, onDiscardPending, onRenamePending,
    onAddDraftScenario, busy, error,
  } = props;

  const traces = useMemo(
    () => scenarios.map((s) => ({ id: s.id, color: s.color, variables: s.variables })),
    [scenarios],
  );

  const entropy = useMemo(() => {
    let h = 0;
    for (const s of scenarios) {
      const p = probs[s.id] ?? 0;
      if (p > 0) h -= p * Math.log(p);
    }
    return h;
  }, [scenarios, probs]);
  const maxEntropy = scenarios.length > 1 ? Math.log(scenarios.length) : 1;
  const entropyPct = maxEntropy > 0 ? Math.round((entropy / maxEntropy) * 100) : 0;

  const sortedProbs = [...scenarios].map((s) => probs[s.id] ?? 0).sort((a, b) => b - a);
  const concentration = (sortedProbs[0] ?? 0) - (sortedProbs[1] ?? 0);

  const logits = scenarios.map((s) => s.priorLogit ?? 0);
  const logitRange = logits.length > 0 ? Math.max(...logits) - Math.min(...logits) : 0;

  return (
    <div className="p-4 grid grid-cols-12 gap-3 auto-rows-min">
      {error && (
        <div className="col-span-12 text-[10px] text-rose-300/80 font-mono px-2">{error}</div>
      )}

      {/* Sidebar — vertical softmax stack of scenarios. Each row is a
          probability-weighted segment; click to set the active scenario.
          Cohort metrics sit at the bottom so the sidebar carries the whole
          probability narrative. The "+ New scenario" button at the top
          opens an unsaved draft for intuitive knob-based creation. */}
      <BentoTile className="col-span-12 lg:col-span-3 lg:row-span-2" flush>
        <ScenarioSidebar
          scenarios={scenarios}
          probs={probs}
          ranks={ranks}
          activeScenarioId={activeScenarioId}
          onSelectScenario={setActiveScenarioId}
          temperature={temperature}
          setTemperature={setTemperature}
          entropyPct={entropyPct}
          concentration={concentration}
          logitRange={logitRange}
          draftScenarioId={isDraft ? activeScenarioId : null}
          onAddDraft={onAddDraftScenario}
        />
      </BentoTile>

      {/* Parallel coords — all scenarios overlaid. Renders first in the
          main column so the cohort shape is visible at a glance before the
          user dives into a single scenario below. */}
      <BentoTile
        className="col-span-12 lg:col-span-9"
        header={<TileLabel>Overlay</TileLabel>}
      >
        <VariableParallelCoords
          traces={traces}
          activeTraceId={activeScenarioId}
          hoveredTraceId={hoveredScenarioId}
          onHoverTrace={setHoveredScenarioId}
          height={220}
        />
      </BentoTile>

      {/* Active scenario detail — header carries the name (editable when
          pending), prob + logit, and the commit/discard/remove actions. */}
      {activeScenario && (
        <BentoTile
          accent={activeScenario.color}
          className="col-span-12 lg:col-span-9 lg:col-start-4"
          flush
          header={
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="w-2 h-2 rounded-full" style={{ background: activeScenario.color }} />
              {isDirty ? (
                <input
                  value={activeScenario.name}
                  onChange={(e) => onRenamePending(e.target.value)}
                  className="text-[12px] text-text-primary font-medium bg-transparent border-b border-white/15 focus:border-white/40 outline-none min-w-0 flex-1 max-w-60"
                  placeholder="Scenario name"
                />
              ) : (
                <span className="text-[12px] text-text-primary font-medium truncate">{activeScenario.name}</span>
              )}
              {isDraft ? (
                <span className="text-[9px] uppercase tracking-[0.15em] font-mono text-amber-300/80">Unsaved draft</span>
              ) : isDirty ? (
                <span className="text-[9px] uppercase tracking-[0.15em] font-mono text-amber-300/80">Unsaved edits</span>
              ) : (
                <span className="text-[10px] text-text-dim/70 font-mono">
                  {Math.round((probs[activeScenario.id] ?? 0) * 100)}% likely &middot; logit {(activeScenario.priorLogit ?? 0).toFixed(1)}
                </span>
              )}
              {!isDirty && activeScenario.tagline && (
                <span className="text-[10px] text-text-dim italic truncate">— {activeScenario.tagline}</span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {isDirty && (
                  <>
                    <button
                      onClick={onDiscardPending}
                      disabled={busy}
                      className="text-[9px] uppercase tracking-[0.15em] text-text-dim hover:text-text-primary font-mono transition disabled:opacity-30"
                    >
                      Discard
                    </button>
                    <button
                      onClick={onCommitPending}
                      disabled={busy}
                      className="h-7 px-3 rounded-md bg-white/10 hover:bg-white/16 text-text-primary font-semibold text-[10px] transition disabled:opacity-30 inline-flex items-center gap-1.5"
                    >
                      {busy && <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />}
                      {busy ? 'Re-scoring…' : isDraft ? 'Save & Score' : 'Save & Re-score'}
                    </button>
                  </>
                )}
                {!isDirty && !isDraft && (
                  <button
                    onClick={onRemoveScenario}
                    className="text-[9px] uppercase tracking-[0.15em] text-text-dim hover:text-rose-300 font-mono transition"
                  >
                    remove
                  </button>
                )}
              </div>
            </div>
          }
        >
          {activeScenario.priorRationale && !isDirty && (
            <div className="px-4 py-2 border-b border-white/6 bg-white/1 text-[11px] text-text-secondary leading-snug">
              <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim/60 font-mono mr-1.5">Reasoning</span>
              {activeScenario.priorRationale}
            </div>
          )}
          {isDirty && (
            <div className="px-4 py-2 border-b border-white/6 bg-amber-500/5 text-[11px] text-amber-200/80 leading-snug">
              {isDraft
                ? 'Set the dials, then save to score this scenario’s plausibility against the cohort.'
                : 'Save & Re-score to update the reasoning and probability, or discard to revert.'}
            </div>
          )}
          <DispositionEditor
            variables={activeScenario.variables}
            pool={activeScenarioPool}
            color={activeScenario.color}
            onChange={onScenarioIntensityChange}
            onAddFromPool={onAddVariableToActiveScenario}
          />
        </BentoTile>
      )}
    </div>
  );
}

// ── Scenario sidebar — vertical softmax stack ──────────────────────────────

function ScenarioSidebar({
  scenarios, probs, ranks, activeScenarioId, onSelectScenario,
  temperature, setTemperature, entropyPct, concentration, logitRange,
  draftScenarioId, onAddDraft,
}: {
  scenarios: PlanningScenario[];
  probs: Record<string, number>;
  ranks: Map<string, number>;
  activeScenarioId: string | null;
  onSelectScenario: (id: string) => void;
  temperature: number;
  setTemperature: (t: number) => void;
  entropyPct: number;
  concentration: number;
  logitRange: number;
  /** Id of the unsaved draft scenario currently in the list, if any. Drives
   *  the "unsaved" badge so the user can see their work-in-progress before
   *  it has a real probability. */
  draftScenarioId: string | null;
  /** Open a fresh draft scenario in the editor. */
  onAddDraft: () => void;
}) {
  const ordered = useMemo(
    () => [...scenarios].sort((a, b) => (probs[b.id] ?? 0) - (probs[a.id] ?? 0)),
    [scenarios, probs],
  );

  return (
    <div className="flex flex-col h-full min-h-105">
      <div className="px-3 py-2 border-b border-white/6 flex items-baseline gap-2">
        <TileLabel accent={FUTURE_TRACE_COLOR}>Scenarios</TileLabel>
        <span className="text-[9px] text-text-dim/60 font-mono">{scenarios.length}</span>
        <button
          onClick={onAddDraft}
          className="ml-auto text-[9px] uppercase tracking-[0.15em] text-text-dim hover:text-text-primary font-mono transition px-1.5 py-0.5 rounded border border-white/10 hover:border-white/25"
          title="Add a new scenario draft — set its dials, then Save & Re-score to commit"
        >
          + New
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {ordered.map((s) => {
          const p = probs[s.id] ?? 0;
          const isActive = s.id === activeScenarioId;
          const isDraft = s.id === draftScenarioId;
          const rank = ranks.get(s.id) ?? 0;
          return (
            <button
              key={s.id}
              onClick={() => onSelectScenario(s.id)}
              className={`relative text-left px-3 py-1.5 border-b border-white/4 transition-colors ${
                isActive ? 'bg-white/6' : 'hover:bg-white/3'
              }`}
              title={s.priorRationale ?? (isDraft ? 'Unsaved draft — Save & Re-score to commit' : undefined)}
            >
              <span
                className="absolute left-0 top-0 bottom-0 w-1"
                style={{ background: s.color, opacity: isActive ? 1 : 0.6 }}
              />
              <div className="flex items-baseline gap-1.5 pl-1.5">
                <span className="text-[9px] text-text-dim/50 font-mono tabular-nums shrink-0">
                  {isDraft ? '✱' : `#${rank}`}
                </span>
                <span className="text-[11px] text-text-primary font-medium truncate flex-1" style={isActive ? { color: s.color } : undefined}>{s.name}</span>
                {isDraft ? (
                  <span className="text-[9px] uppercase tracking-[0.12em] font-mono shrink-0 text-amber-300/80">Unsaved</span>
                ) : (
                  <span className="text-[11px] font-mono tabular-nums shrink-0" style={{ color: s.color }}>{Math.round(p * 100)}%</span>
                )}
              </div>
              {s.tagline && (
                <div className="text-[9px] text-text-dim/70 leading-snug pl-1.5 line-clamp-2">{s.tagline}</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Sidebar footer: τ slider + compact cohort metrics. Keeps the
          probability narrative anchored on this one panel. */}
      <div className="shrink-0 px-3 py-2 border-t border-white/6 flex flex-col gap-2 text-[9px] font-mono">
        <div className="flex flex-col gap-1">
          <span className="uppercase tracking-[0.18em] text-text-dim/70">Temperature {temperature.toFixed(2)}</span>
          <input
            type="range"
            min="0.3"
            max="2.5"
            step="0.05"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full accent-emerald-400"
          />
        </div>
        <div className="grid grid-cols-3 gap-1 text-[9px] tabular-nums">
          <SidebarMetric label="Spread" value={`${entropyPct}%`} tone={entropyPct >= 80 ? 'amber' : 'sky'} />
          <SidebarMetric label="Lead" value={concentration.toFixed(2)} tone="sky" />
          <SidebarMetric label="Range" value={logitRange.toFixed(1)} tone="emerald" />
        </div>
      </div>
    </div>
  );
}

function SidebarMetric({ label, value, tone }: { label: string; value: string; tone: 'sky' | 'amber' | 'emerald' | 'violet' }) {
  const cls = { sky: 'text-sky-300', amber: 'text-amber-200', emerald: 'text-emerald-300', violet: 'text-violet-200' }[tone];
  return (
    <div className="rounded border border-white/6 bg-white/2 px-1.5 py-1 text-center">
      <div className="text-text-dim/50 uppercase tracking-[0.18em] text-[8px]">{label}</div>
      <div className={`text-[11px] font-light ${cls}`}>{value}</div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function Empty({
  title, message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <div className="h-full flex items-center justify-center px-8">
      <div className="text-center max-w-md">
        {title && <div className="text-sm text-text-secondary mb-2">{title}</div>}
        <div className="text-[11px] text-text-dim leading-relaxed">{message}</div>
      </div>
    </div>
  );
}
