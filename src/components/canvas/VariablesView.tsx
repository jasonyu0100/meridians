'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { narrativeContext } from '@/lib/ai/context';
import { resolveReasoningBudget } from '@/lib/ai/api';
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
import VariableRadarChart from './variables/VariableRadarChart';
import VariableParallelCoords from './variables/VariableParallelCoords';
import VariableGridChart from './variables/VariableGridChart';
import VariableViewSwitcher, { type VariableViewMode } from './variables/VariableViewSwitcher';
import { TileLabel } from './variables/BentoTile';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { IconFlask } from '@/components/icons';
import { findHeadArc } from '@/hooks/useExperimentation';
import { InferenceFields } from '@/components/shared/InferenceFields';

/**
 * Variables view — Control → Present | Compass.
 *
 * Each arc owns its OWN Present variable set, custom-generated for that
 * arc. Each Compass scenario on an arc owns its OWN scenario-specific
 * variable set, custom-generated for that particular direction. There is
 * no shared catalogue, no cross-arc vocabulary.
 *
 * Fresh-page state: an arc with no Present variables (and a Compass tab
 * with no cohort) shows a seed form so the user can spin up that scope's
 * set on demand.
 */

type Mode = 'present' | 'compass';
const PRESENT_TRACE_COLOR = '#a78bfa';
const COMPASS_TRACE_COLOR = '#34d399';

interface VariablesViewProps {
  mode: Mode;
}

export default function VariablesView({ mode }: VariablesViewProps) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  // No-narrative / world-commit / no-arc cases all render the same shell
  // chrome (topbar above an empty state) so the user always sees the same
  // surface — only the body's message changes. The topbar's actions are
  // disabled in these states because there's no arc to operate on.
  if (!narrative) {
    return <VariablesShell mode={mode} message="No active narrative." />;
  }

  const currentEntryId = state.resolvedEntryKeys[state.viewState.currentSceneIndex] ?? null;
  const currentScene = currentEntryId ? narrative.scenes[currentEntryId] : null;
  const isWorldCommit = !!currentEntryId && !currentScene && !!narrative.worldBuilds[currentEntryId];

  if (isWorldCommit) {
    return (
      <VariablesShell
        mode={mode}
        title="World commit selected"
        message="Variables describe the machinery active in a scene. Navigate to a scene to inspect or plan its variables."
      />
    );
  }

  const focusedArcId = currentScene?.arcId ?? null;
  const focusedArc = focusedArcId ? narrative.arcs[focusedArcId] : null;

  if (!focusedArc) {
    return (
      <VariablesShell
        mode={mode}
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
  // by all three variable functions (Present extract, Compass generation,
  // direction re-score). `narrativeContext` is the full tiered branch state
  // up to the current scene (cumulative network, threads, roster, deltas);
  // `buildActiveModeSection` folds in the working-machinery substrate so
  // variables inherit from it.
  const outline = narrativeContext(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
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
    description?: string;
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
        description: pending.description,
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
    () => scenarioProbabilities(displayedScenarios),
    [displayedScenarios],
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
        description: pending.description,
        color: pending.color,
        variables: pending.variables,
        priorLogit: pending.isDraft ? 0 : scenarios.find((s) => s.id === pending.id)?.priorLogit,
        reasoning: pending.isDraft ? undefined : scenarios.find((s) => s.id === pending.id)?.reasoning,
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
      description: activeScenario.description,
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
  // sibling scenarios in the same cohort. Present and Compass are separate
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

  /** Begin a new draft scenario in the sidebar. Pre-seeds the variable pool at
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
   *  persists the new variables + priorLogit + reasoning atomically. */
  const commitPending = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      // Filter out variables at intensity 0 before sending to the rescore.
      const committedVars = pending.variables.filter((v) => v.intensity > 0);
      if (committedVars.length === 0) {
        setError('Activate at least one variable before saving.');
        setBusy(false);
        return;
      }
      const draftForRescore: PlanningScenario = {
        id: pending.id,
        name: pending.name,
        description: pending.description,
        color: pending.color,
        variables: committedVars,
      };
      // Cohort = the other committed scenarios. Used for relative anchoring.
      const cohort = scenarios.filter((s) => s.id !== pending.id);
      const result = await rescoreScenario({
        narrative,
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
        reasoning: result.reasoning || undefined,
        considered: result.considered,
        breaks: result.breaks,
        opens: result.opens,
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
  // from Compass directions. The two surfaces are separate by design.

  const generatePresent = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStreamingReasoning('');
    try {
      const { variables, paradigm, description, reasoning, considered, breaks, opens, priorLogit } = await extractArcPresent({
        narrative,
        arc: { id: focusedArc.id, name: focusedArc.name, directionVector: focusedArc.directionVector, summary: focusedArc.worldState },
        context: contextSource,
        outline,
        modeSection,
        direction: direction.trim() || undefined,
        onReasoning: (token) => setStreamingReasoning((prev) => prev + token),
        reasoningBudget: resolveReasoningBudget(narrative),
      });
      dispatch({
        type: 'SET_ARC_PRESENT_VARIABLES',
        arcId: focusedArc.id,
        variables,
        paradigm,
        description,
        reasoning,
        considered,
        breaks,
        opens,
        logit: priorLogit,
      });
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

  const generateCompass = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStreamingReasoning('');
    try {
      // Compass is an independent fresh look from work context — NOT a
      // projection of the arc's Present. Both surfaces draw from the same
      // historical record (scenes, threads, roster, prior arcs).
      const { scenarios: generated, paradigm } = await generatePlanningScenarios({
        narrative,
        arc: { id: focusedArc.id, name: focusedArc.name, directionVector: focusedArc.directionVector, summary: focusedArc.worldState },
        context: contextSource,
        outline,
        modeSection,
        direction: direction.trim() || undefined,
        onReasoning: (token) => setStreamingReasoning((prev) => prev + token),
        reasoningBudget: resolveReasoningBudget(narrative),
      });
      if (generated.length > 0) {
        dispatch({ type: 'SET_ARC_PLANNING_SCENARIOS', arcId: focusedArc.id, scenarios: generated, paradigm });
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

  // Beaker quick-action — FloatingPalette sets this flag immediately before
  // switching to the Compass view; consuming it here covers the render gap
  // (a custom event would fire before this component mounts).
  useEffect(() => {
    if (mode !== 'compass') return;
    let pending = false;
    try {
      pending = sessionStorage.getItem('inktide:pending-generate-compass') === '1';
      if (pending) sessionStorage.removeItem('inktide:pending-generate-compass');
    } catch {
      // sessionStorage unavailable — skip
    }
    if (pending && !busy) generateCompass();
    // Run once per mount in compass mode; generateCompass / busy intentionally
    // omitted from deps to avoid retriggering on every closure change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const removeActiveScenario = () => {
    if (!activeScenario) return;
    const next = scenarios.filter((s) => s.id !== activeScenario.id);
    dispatch({ type: 'SET_ARC_PLANNING_SCENARIOS', arcId: focusedArc.id, scenarios: next });
    setActiveScenarioId(next[0]?.id ?? null);
  };

  const wipeArc = useCallback(() => {
    dispatch({ type: 'WIPE_ARC_VARIABLES', arcId: focusedArc.id });
    setActiveScenarioId(null);
    setError(null);
  }, [dispatch, focusedArc.id]);

  // The topbar always renders; the fresh-page seed form just replaces the
  // body when there's nothing to display.
  const isEmpty = mode === 'present'
    ? presentVariables.length === 0
    : scenarios.length === 0;

  const accent = mode === 'present' ? PRESENT_TRACE_COLOR : COMPASS_TRACE_COLOR;

  const onRegenerate = mode === 'present' ? generatePresent : generateCompass;
  const regenerateLabel = mode === 'present' ? 'Regenerate Present' : 'Regenerate Compass';

  const canExperiment = mode === 'compass'
    && isHeadArc
    && scenarios.some((s) => Array.isArray(s.variables) && s.variables.length > 0);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <VariablesTopBar
        mode={mode}
        arcName={focusedArc.name}
        isHeadArc={isHeadArc}
        variableCount={mode === 'present' ? presentVariables.length : undefined}
        scenariosCount={mode === 'compass' ? scenarios.length : undefined}
        error={error}
        busy={busy}
        directionSet={direction.trim().length > 0}
        regenerateLabel={regenerateLabel}
        canRegenerate
        canWipe
        showExperiment={canExperiment}
        onOpenRegenerateModal={() => setDirectionModalOpen(true)}
        onOpenExperiment={() => window.dispatchEvent(new CustomEvent('open-experimentation-panel'))}
        onWipe={wipeArc}
      />

      <BodyContainer>
        {/* Empty state is suppressed while generating — its centered message
            collides with the streaming overlay's top-flowing reasoning, and
            there's no underlying context worth preserving when empty. */}
        {isEmpty && !busy && <EmptyState mode={mode} />}
        {!isEmpty && !busy && (
          mode === 'present' ? (
            <PresentBento
              variables={presentVariables}
              paradigm={focusedArc.presentParadigm}
              description={focusedArc.presentDescription}
              reasoning={focusedArc.presentReasoning}
              considered={focusedArc.presentConsidered}
              breaks={focusedArc.presentBreaks}
              opens={focusedArc.presentOpens}
              logit={focusedArc.presentLogit}
              onChange={setPresentIntensity}
              error={error}
            />
          ) : (
            <CompassBento
              scenarios={displayedScenarios}
              paradigm={focusedArc.planningParadigm}
              probs={probs}
              ranks={ranks}
              activeScenario={activeScenario}
              activeScenarioId={activeScenarioId}
              setActiveScenarioId={setActiveScenarioId}
              hoveredScenarioId={hoveredScenarioId}
              setHoveredScenarioId={setHoveredScenarioId}
              activeScenarioPool={activeScenarioPool}
              onScenarioIntensityChange={setScenarioIntensity}
              onAddVariableToActiveScenario={addVariableToActiveScenario}
              onRemoveScenario={removeActiveScenario}
              hasPendingEdits={pending !== null && pending.id === activeScenarioId}
              isDraft={pending !== null && pending.isDraft && pending.id === activeScenarioId}
              onCommitPending={commitPending}
              onDiscardPending={discardPending}
              onRenamePending={setPendingName}
              onAddDraftScenario={addDraftScenario}
              busy={busy}
              error={error}
            />
          )
        )}
        {busy && (
          <ReasoningOverlay
            accent={accent}
            label={mode === 'present' ? 'Extracting present variables…' : 'Generating compass…'}
            reasoning={streamingReasoning}
          />
        )}
      </BodyContainer>

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
    : "What should the compass cohort bias toward?";
  const title = mode === 'present' ? 'Regenerate Present' : 'Regenerate Compass';

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
            {busy ? 'Generating' : title}
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

// ── Shell, topbar, body, empty state, streaming overlay ──────────────────
//
// Five small primitives compose the surface. Splitting them out keeps the
// topbar chrome consistent across every state — no-narrative, world-commit,
// no-arc, empty arc, populated arc, and mid-generation — and lets the
// reasoning trace overlay the empty state so the user keeps their context
// while the model thinks.

/** Standalone shell used by the early-return cases (no narrative, world
 *  commit, no arc). Renders the topbar + a centred EmptyState. The topbar
 *  shows the mode label only — actions are hidden because there's no arc
 *  in scope to operate on. */
function VariablesShell({
  mode, title, message,
}: {
  mode: Mode;
  title?: string;
  message: string;
}) {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <VariablesTopBar mode={mode} />
      <BodyContainer>
        <EmptyState title={title} message={message} />
      </BodyContainer>
    </div>
  );
}

/** Chrome bar at the top of the variables panel. Render every state through
 *  this so the user always sees the same surface and never wonders which
 *  page they're on. Action buttons are gated on `canRegenerate`/`canWipe`
 *  flags — callers without an arc pass neither and get the minimal label. */
function VariablesTopBar({
  mode, arcName, isHeadArc, variableCount, scenariosCount, error, busy,
  directionSet, regenerateLabel, canRegenerate, canWipe, showExperiment,
  onOpenRegenerateModal, onOpenExperiment, onWipe,
}: {
  mode: Mode;
  arcName?: string;
  isHeadArc?: boolean;
  variableCount?: number;
  scenariosCount?: number;
  error?: string | null;
  busy?: boolean;
  directionSet?: boolean;
  regenerateLabel?: string;
  canRegenerate?: boolean;
  canWipe?: boolean;
  showExperiment?: boolean;
  onOpenRegenerateModal?: () => void;
  onOpenExperiment?: () => void;
  onWipe?: () => void;
}) {
  const accent = mode === 'present' ? PRESENT_TRACE_COLOR : COMPASS_TRACE_COLOR;
  const modeLabel = mode === 'present' ? 'Present' : 'Compass';
  return (
    <div className="h-9 shrink-0 flex items-center px-2 gap-2 glass-panel border-b border-border">
      {arcName ? (
        <span className="text-[11px] text-text-primary truncate max-w-[40vw]">
          {arcName}{isHeadArc ? <span className="text-text-dim/60"> · head</span> : null}
        </span>
      ) : (
        <span className="text-[11px] text-text-dim/60 italic">no arc in scope</span>
      )}
      {variableCount !== undefined && variableCount > 0 && (
        <span className="text-[9px] text-text-dim/60 font-mono tabular-nums">{variableCount} variables</span>
      )}
      {scenariosCount !== undefined && scenariosCount > 0 && (
        <span className="text-[9px] text-text-dim/60 font-mono tabular-nums">{scenariosCount} directions</span>
      )}
      {error && <span className="text-[9px] text-rose-300/80 font-mono truncate max-w-[20vw]">{error}</span>}

      <div className="flex-1" />

      {showExperiment && onOpenExperiment && (
        <>
          <button
            onClick={onOpenExperiment}
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
      {canRegenerate && onOpenRegenerateModal && (
        <button
          onClick={onOpenRegenerateModal}
          disabled={busy}
          className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-text-dim/70 hover:text-text-primary disabled:opacity-30 transition-colors"
          title={regenerateLabel ?? 'Regenerate'}
        >
          {!busy && (
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
          )}
          <span>{busy ? 'Generating' : (regenerateLabel ?? 'Regenerate')}</span>
          {directionSet && <span className="w-1 h-1 rounded-full bg-white/60" title="direction set" />}
        </button>
      )}
      {canWipe && onWipe && (
        <>
          <div className="w-px h-4 bg-white/10" />
          <button
            onClick={onWipe}
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
        </>
      )}
    </div>
  );
}

/** Scrollable body region with the lavender top-wash. Wraps the variant
 *  content (bento, empty state, streaming overlay). Owning the wash here
 *  keeps the chrome identical across every state. */
function BodyContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 relative overflow-hidden">
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
        {children}
      </div>
    </div>
  );
}

/** Empty-state body content — used when no variables/scenarios exist yet
 *  OR when the surrounding context (no arc, world commit) has nothing to
 *  show. One component handles both so the visual language is consistent. */
function EmptyState({
  mode, title, message,
}: {
  /** Mode-specific copy is rendered when no explicit message is supplied. */
  mode?: Mode;
  title?: string;
  message?: string;
}) {
  const primary = message ?? (
    mode === 'present' ? 'No Present variables yet for this arc.' :
    mode === 'compass' ? 'No Compass directions yet for this arc.' :
    'Nothing to show.'
  );
  const hint = mode && !message
    ? `Use the Regenerate ${mode === 'present' ? 'Present' : 'Compass'} action above to generate one.`
    : null;
  return (
    <div className="h-full flex flex-col items-center justify-center py-20 gap-3 px-8 text-center">
      {title && <p className="text-sm text-text-secondary mb-1">{title}</p>}
      <p className="text-[11px] text-text-dim max-w-md leading-relaxed">{primary}</p>
      {hint && <p className="text-[10px] text-text-dim/40">{hint}</p>}
    </div>
  );
}

/** Minimal streaming-reasoning trace overlay. Mirrors the plan/prose
 *  reasoning display style — spinner, status line, monospace-ish reasoning
 *  body. Sits on top of whatever else is in the body so the user keeps
 *  visual continuity (empty state stays visible underneath). */
function ReasoningOverlay({
  accent, label, reasoning,
}: {
  accent: string;
  label: string;
  reasoning: string;
}) {
  return (
    <div className="absolute inset-0 z-20 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      <div className="max-w-2xl mx-auto px-8 pt-6 pb-32">
        <div className="flex items-center gap-2 mb-4">
          <div
            className="w-3 h-3 border-2 rounded-full animate-spin"
            style={{ borderColor: `${accent}30`, borderTopColor: `${accent}cc` }}
          />
          <span className="text-[10px] text-text-dim">{label}</span>
        </div>
        {reasoning && (
          <p className="text-[11px] text-text-dim/60 leading-relaxed whitespace-pre-wrap">
            {reasoning}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Layout primitives ─────────────────────────────────────────────────────
//
// Minimalist divider-style chrome — header strip + thin vertical/horizontal
// dividers replace the bordered bento cells. Sections share the same h-9
// header so chart, sidebars, and variables editor all align across the
// top, and the dividers make the column boundaries readable without
// drawing card outlines around every region.

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-9 shrink-0 px-3 flex items-baseline gap-2 border-b border-white/6">
      <div className="flex items-baseline gap-2 w-full self-center">{children}</div>
    </div>
  );
}

function VDivider() {
  return <div className="w-px shrink-0 bg-white/8" aria-hidden />;
}

function HDivider() {
  return <div className="h-px shrink-0 bg-white/8" aria-hidden />;
}

// ── Resizable height ─────────────────────────────────────────────────────
//
// Both Present and Compass bottom panels carry a lot of text now (Reasoning
// + Considered + Breaks + Opens). Default to a compact ~150px and let the
// user drag the top edge upward to grow the panel — same affordance as
// NarrativePanel. Resize handle is rendered at the panel's top edge.

const PANEL_DEFAULT_HEIGHT = 150;
const PANEL_MIN_HEIGHT = 80;
const PANEL_MAX_HEIGHT = 800;

function useResizableHeight(initial: number) {
  const [height, setHeight] = useState(initial);
  const startY = useRef(0);
  const startH = useRef(0);
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startY.current = e.clientY;
    startH.current = height;
    const onMove = (ev: MouseEvent) => {
      const delta = startY.current - ev.clientY;
      const next = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, startH.current + delta));
      setHeight(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [height]);
  return { height, onResizeMouseDown };
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      className="relative h-1.5 cursor-row-resize hover:bg-violet-300/15 active:bg-violet-300/25 transition-colors group"
      onMouseDown={onMouseDown}
      title="Drag to resize"
    >
      {/* Centre dot row gives the user a visible affordance on hover. */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <span className="w-1 h-1 rounded-full bg-text-dim/60" />
        <span className="w-1 h-1 rounded-full bg-text-dim/60" />
        <span className="w-1 h-1 rounded-full bg-text-dim/60" />
      </div>
    </div>
  );
}

// ── Logit badge ───────────────────────────────────────────────────────────
//
// Surfaces a coordination's log-prior plausibility (in stance-evidence
// units, [-4, +4]) as: the raw logit, a sigmoid-derived "how likely" %,
// and a one-word rarity tag. Renders below the chart on Present/Compass
// footers so the path's rarity becomes a permanent, glanceable record —
// "everything happened, but in retrospect there was a rarity to it."

function rarityLabel(logit: number): { word: string; tone: string } {
  if (logit >= 3) return { word: 'expected', tone: 'text-emerald-300/80' };
  if (logit >= 1) return { word: 'likely',   tone: 'text-sky-300/80' };
  if (logit >= -1) return { word: 'even',    tone: 'text-text-secondary' };
  if (logit >= -3) return { word: 'rare',    tone: 'text-amber-300/80' };
  return { word: 'tail event', tone: 'text-rose-300/80' };
}

function LogitBadge({ logit, accent }: { logit: number; accent: string }) {
  const rarity = rarityLabel(logit);
  // Compact one-row badge using a natural-language rarity descriptor as
  // the lead — avoids competing with the cohort softmax % shown in the
  // scenarios sidebar. Logit value rides along as a small footnote for
  // anyone who wants the raw number.
  return (
    <div className="flex items-baseline gap-2 font-mono">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0 self-center"
        style={{ background: accent }}
      />
      <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim/60">
        Plausibility
      </span>
      <span className={`text-[12px] font-medium uppercase tracking-[0.12em] ${rarity.tone}`}>
        {rarity.word}
      </span>
      <span className="text-[10px] text-text-dim/60 tabular-nums ml-auto">
        logit {logit >= 0 ? '+' : ''}{logit.toFixed(1)}
      </span>
    </div>
  );
}

function ParadigmChip({ paradigm, accent }: { paradigm: string; accent: string }) {
  // Compass fingerprint — paradigm name + operative cues the cohort/Present
  // was drafted against. Single-row chip rendered above description so the
  // user can audit the lens at a glance.
  return (
    <div className="flex items-baseline gap-2 font-mono">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0 self-center"
        style={{ background: accent }}
      />
      <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim/60 shrink-0">
        Paradigm
      </span>
      <span className="text-[11px] text-text-secondary leading-snug">
        {paradigm}
      </span>
    </div>
  );
}

// ── Present bento ──────────────────────────────────────────────────────────

interface PresentBentoProps {
  variables: Variable[];
  /** Compass the variable set was extracted against — paradigm name +
   *  operative cues. Rendered as a small chip above the description so the
   *  user can audit "is the model reading this work as the right kind of
   *  work?" without scrolling into the inference fields. */
  paradigm?: string;
  /** Short one-sentence gestalt annotating the Present coordination —
   *  what the configuration IS. Generated alongside the variables and
   *  rendered as a labelled paragraph in the chart-column footer. */
  description?: string;
  /** Multi-sentence load-bearing logic — WHY these variables are firing
   *  at these intensities given the arc's state. */
  reasoning?: string;
  /** Universal inference-shape fields — same handles used by CRG / PRG /
   *  Compass directions. Option space, falsification handle, forward
   *  extension. */
  considered?: string;
  breaks?: string;
  opens?: string;
  /** Log-prior plausibility for this Present coordination, in
   *  STANCE_EVIDENCE_MIN/MAX range ([-4, +4]). When transferred from a
   *  Compass direction via experimentation commit, this records "how
   *  likely was this coordination when it was chosen" — the rarity badge
   *  that gives the path its sense of specialness. */
  logit?: number;
  onChange: (variableId: string, intensity: number) => void;
  error: string | null;
}

function PresentBento({
  variables, paradigm, description, reasoning, considered, breaks, opens, logit, onChange, error,
}: PresentBentoProps) {
  const traces = useMemo(() =>
    variables.length > 0 ? [{ id: 'present', color: PRESENT_TRACE_COLOR, variables }] : [],
  [variables]);
  // Present can render the shape as radar (signature) or parallel
  // (compact axis-by-axis). Grid is hidden — degenerate with one trace.
  const [viewMode, setViewMode] = useState<VariableViewMode>('radar');
  // Resizable footer height — compact default; user drags top edge upward.
  const { height: panelHeight, onResizeMouseDown } = useResizableHeight(PANEL_DEFAULT_HEIGHT);

  return (
    <div className="h-full flex flex-col">
      {error && (
        <div className="px-3 py-1.5 border-b border-white/6 text-[10px] text-rose-300/80 font-mono truncate">
          {error}
        </div>
      )}
      <div className="flex-1 flex min-h-0">
        {/* Main: chart with header strip carrying the view switcher. */}
        <div className="flex-1 flex flex-col min-w-0">
          <SectionHeader>
            <TileLabel>Shape</TileLabel>
            <div className="ml-auto">
              <VariableViewSwitcher
                mode={viewMode}
                onChange={setViewMode}
                allowed={['radar', 'parallel']}
              />
            </div>
          </SectionHeader>
          <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center px-3 py-2">
            {traces.length === 0 ? (
              <div className="text-[11px] text-text-dim italic py-3">No variables yet. Regenerate to populate.</div>
            ) : (
              <div className="w-4/5 mx-auto">
                {viewMode === 'radar' ? (
                  <VariableRadarChart traces={traces} />
                ) : (
                  <VariableParallelCoords traces={traces} />
                )}
              </div>
            )}
          </div>
          {(paradigm || description || reasoning || considered || breaks || opens || typeof logit === 'number') && (
            <>
              <HDivider />
              <ResizeHandle onMouseDown={onResizeMouseDown} />
              <div
                className="shrink-0 px-4 py-3 flex flex-col gap-2.5 overflow-auto"
                style={{ height: panelHeight }}
              >
                {typeof logit === 'number' && (
                  <LogitBadge logit={logit} accent={PRESENT_TRACE_COLOR} />
                )}
                {paradigm && <ParadigmChip paradigm={paradigm} accent={PRESENT_TRACE_COLOR} />}
                {description && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim/60 font-mono">
                      Description
                    </span>
                    <p className="text-[11px] text-text-secondary italic leading-snug">
                      {description}
                    </p>
                  </div>
                )}
                <InferenceFields
                  detail={reasoning}
                  considered={considered}
                  breaks={breaks}
                  opens={opens}
                  detailLabel="Reasoning"
                />
              </div>
            </>
          )}
        </div>
        <VDivider />
        {/* Variables sidebar — same width and chrome as the Compass view's
            variables sidebar so the editor sits in a familiar place. */}
        <div className="w-72 shrink-0 flex flex-col">
          <SectionHeader>
            <TileLabel count={variables.length}>Variables</TileLabel>
            <span className="ml-auto text-[9px] text-text-dim/60 font-mono">click to set</span>
          </SectionHeader>
          <div className="flex-1 min-h-0 overflow-auto">
            <DispositionEditor
              variables={variables}
              colorByCategory
              onChange={onChange}
              singleColumn
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Compass bento ──────────────────────────────────────────────────────────

interface CompassBentoProps {
  scenarios: PlanningScenario[];
  /** Compass the cohort was drafted against — paradigm name + operative
   *  cues. Cohort-level, identical across all scenarios. Rendered as a
   *  chip above the per-scenario detail so the user can audit the lens
   *  the whole cohort came out of. */
  paradigm?: string;
  probs: Record<string, number>;
  ranks: Map<string, number>;
  activeScenario: PlanningScenario | null;
  activeScenarioId: string | null;
  setActiveScenarioId: (id: string) => void;
  hoveredScenarioId: string | null;
  setHoveredScenarioId: (id: string | null) => void;
  activeScenarioPool: Variable[];
  onScenarioIntensityChange: (variableId: string, intensity: number) => void;
  onAddVariableToActiveScenario: (variable: Variable) => void;
  onRemoveScenario: () => void;
  /** Pending-edit state — true when the active scenario has unsaved variable
   *  edits (or is an unsaved draft). Drives the Save & Re-score affordance. */
  hasPendingEdits: boolean;
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

function CompassBento(props: CompassBentoProps) {
  const {
    scenarios, paradigm, probs, ranks,
    activeScenario, activeScenarioId, setActiveScenarioId,
    hoveredScenarioId, setHoveredScenarioId,
    activeScenarioPool,
    onScenarioIntensityChange, onAddVariableToActiveScenario, onRemoveScenario,
    hasPendingEdits, isDraft, onCommitPending, onDiscardPending, onRenamePending,
    onAddDraftScenario, busy, error,
  } = props;

  const traces = useMemo(
    () => scenarios.map((s) => ({ id: s.id, name: s.name, color: s.color, variables: s.variables })),
    [scenarios],
  );

  // Three views over the same cohort:
  //  • radar: just the active scenario's signature shape, focused
  //  • parallel: all scenarios overlaid (compact, side-by-side comparison)
  //  • grid: small-multiples — every scenario in its own mini-radar tile
  const [viewMode, setViewMode] = useState<VariableViewMode>('radar');
  const radarTraces = useMemo(
    () => (activeScenarioId ? traces.filter((t) => t.id === activeScenarioId) : traces.slice(0, 1)),
    [traces, activeScenarioId],
  );
  // Resizable scenario-detail footer — compact default; user drags top edge upward.
  const { height: panelHeight, onResizeMouseDown } = useResizableHeight(PANEL_DEFAULT_HEIGHT);

  return (
    <div className="h-full flex flex-col">
      {error && (
        <div className="px-3 py-1.5 border-b border-white/6 text-[10px] text-rose-300/80 font-mono truncate">
          {error}
        </div>
      )}
      <div className="flex-1 flex min-h-0">
        {/* Left sidebar: scenarios stack — vertical softmax-weighted list,
            click to set the active scenario. Self-contained chrome. */}
        <div className="w-72 shrink-0 flex flex-col">
          <ScenarioSidebar
            scenarios={scenarios}
            probs={probs}
            ranks={ranks}
            activeScenarioId={activeScenarioId}
            onSelectScenario={setActiveScenarioId}
            draftScenarioId={isDraft ? activeScenarioId : null}
            onAddDraft={onAddDraftScenario}
          />
        </div>
        <VDivider />
        {/* Main: cohort visualisation. Three views over the same data —
            radar focuses the active scenario, parallel overlays the cohort,
            grid splits each scenario into a mini-radar. The active
            scenario's description + reasoning live at the bottom of this
            column so the right sidebar has full vertical room for the
            variables editor. */}
        <div className="flex-1 flex flex-col min-w-0">
          <SectionHeader>
            <TileLabel>{viewMode === 'radar' ? 'Signature' : viewMode === 'parallel' ? 'Overlay' : 'Cohort'}</TileLabel>
            <div className="ml-auto">
              <VariableViewSwitcher mode={viewMode} onChange={setViewMode} />
            </div>
          </SectionHeader>
          <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center px-3 py-2">
            <div className={viewMode === 'grid' ? 'w-full' : 'w-4/5 mx-auto'}>
              {viewMode === 'radar' ? (
                <VariableRadarChart traces={radarTraces} />
              ) : viewMode === 'parallel' ? (
                <VariableParallelCoords
                  traces={traces}
                  activeTraceId={activeScenarioId}
                  hoveredTraceId={hoveredScenarioId}
                  onHoverTrace={setHoveredScenarioId}
                />
              ) : (
                <VariableGridChart
                  traces={traces}
                  activeTraceId={activeScenarioId}
                  hoveredTraceId={hoveredScenarioId}
                  onHoverTrace={setHoveredScenarioId}
                  onSelectTrace={setActiveScenarioId}
                />
              )}
            </div>
          </div>
          {activeScenario
            && (
              paradigm
                || activeScenario.description
                || activeScenario.reasoning
                || activeScenario.considered
                || activeScenario.breaks
                || activeScenario.opens
                || typeof activeScenario.priorLogit === 'number'
            )
            && !hasPendingEdits && (
            <>
              <HDivider />
              <ResizeHandle onMouseDown={onResizeMouseDown} />
              <div
                className="shrink-0 px-4 py-3 flex flex-col gap-2.5 overflow-auto"
                style={{ height: panelHeight }}
              >
                {typeof activeScenario.priorLogit === 'number' && (
                  <LogitBadge logit={activeScenario.priorLogit} accent={activeScenario.color} />
                )}
                {paradigm && <ParadigmChip paradigm={paradigm} accent={activeScenario.color} />}
                {activeScenario.description && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim/60 font-mono">
                      Description
                    </span>
                    <p className="text-[11px] text-text-secondary italic leading-snug">
                      {activeScenario.description}
                    </p>
                  </div>
                )}
                <InferenceFields
                  detail={activeScenario.reasoning}
                  considered={activeScenario.considered}
                  breaks={activeScenario.breaks}
                  opens={activeScenario.opens}
                  detailLabel="Reasoning"
                />
              </div>
            </>
          )}
          {activeScenario && hasPendingEdits && (
            <>
              <HDivider />
              <div className="shrink-0 px-4 py-3 bg-amber-500/5 text-[11px] text-amber-200/80 leading-snug">
                {isDraft
                  ? 'Set the variables, then save to score this scenario’s plausibility against the cohort.'
                  : 'Save & Re-score to update the reasoning and probability, or discard to revert.'}
              </div>
            </>
          )}
        </div>
        <VDivider />
        {/* Right sidebar: active scenario detail + variables editor. Same
            width as the scenarios sidebar so the two flank the chart
            symmetrically. */}
        <div className="w-72 shrink-0 flex flex-col">
          {activeScenario ? (
            <>
              <SectionHeader>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: activeScenario.color }} />
                {hasPendingEdits ? (
                  <input
                    value={activeScenario.name}
                    onChange={(e) => onRenamePending(e.target.value)}
                    className="text-[11px] text-text-primary font-medium bg-transparent border-b border-white/15 focus:border-white/40 outline-none min-w-0 flex-1"
                    placeholder="Scenario name"
                  />
                ) : (
                  <span className="text-[11px] text-text-primary font-medium truncate flex-1">{activeScenario.name}</span>
                )}
                {!hasPendingEdits && !isDraft && (
                  <button
                    onClick={onRemoveScenario}
                    className="ml-auto text-[9px] uppercase tracking-[0.15em] text-text-dim hover:text-rose-300 font-mono transition"
                  >
                    remove
                  </button>
                )}
              </SectionHeader>
              {/* Status strip — only carries draft/dirty state + actions
                  now. The rarity badge lives in the left scenarios
                  sidebar and in the center footer summary so it doesn't
                  duplicate. */}
              {(isDraft || hasPendingEdits) && (
              <div className="px-3 py-2 border-b border-white/6 flex items-center gap-2 text-[10px] font-mono min-h-9">
                <span className="uppercase tracking-[0.15em] text-amber-300/80">
                  {isDraft ? 'Unsaved draft' : 'Unsaved edits'}
                </span>
                {hasPendingEdits && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={onDiscardPending}
                      disabled={busy}
                      className="text-[9px] uppercase tracking-[0.15em] text-text-dim hover:text-text-primary transition disabled:opacity-30"
                    >
                      Discard
                    </button>
                    <button
                      onClick={onCommitPending}
                      disabled={busy}
                      className="h-6 px-2 rounded bg-white/10 hover:bg-white/16 text-text-primary font-semibold text-[10px] transition disabled:opacity-30 inline-flex items-center gap-1"
                    >
                      {busy && <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />}
                      {busy ? 'Scoring…' : isDraft ? 'Save & Score' : 'Save & Re-score'}
                    </button>
                  </div>
                )}
              </div>
              )}
              <div className="flex-1 min-h-0 overflow-auto">
                <DispositionEditor
                  variables={activeScenario.variables}
                  pool={activeScenarioPool}
                  color={activeScenario.color}
                  colorByCategory
                  onChange={onScenarioIntensityChange}
                  onAddFromPool={onAddVariableToActiveScenario}
                  singleColumn
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px] text-text-dim italic px-4 text-center">
              Pick a scenario from the left to inspect or edit its variables.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Scenario sidebar — vertical softmax stack ──────────────────────────────

function ScenarioSidebar({
  scenarios, probs, ranks, activeScenarioId, onSelectScenario,
  draftScenarioId, onAddDraft,
}: {
  scenarios: PlanningScenario[];
  probs: Record<string, number>;
  ranks: Map<string, number>;
  activeScenarioId: string | null;
  onSelectScenario: (id: string) => void;
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
        <TileLabel accent={COMPASS_TRACE_COLOR}>Scenarios</TileLabel>
        <span className="text-[9px] text-text-dim/60 font-mono">{scenarios.length}</span>
        <button
          onClick={onAddDraft}
          className="ml-auto text-[9px] uppercase tracking-[0.15em] text-text-dim hover:text-text-primary font-mono transition px-1.5 py-0.5 rounded border border-white/10 hover:border-white/25"
          title="Add a new scenario draft — set its variables, then Save & Re-score to commit"
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
              title={s.reasoning ?? (isDraft ? 'Unsaved draft — Save & Re-score to commit' : undefined)}
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
                  <span className="text-[11px] font-mono tabular-nums shrink-0" style={{ color: s.color }}>{(p * 100).toFixed(1)}%</span>
                )}
              </div>
              {/* Rarity tag — the same natural-language descriptor the
                  center footer surfaces, plus the raw logit for anyone
                  who wants the underlying number. Lives inline so the
                  scenarios sidebar carries a glanceable per-row read on
                  "how likely was this when it was generated". */}
              {!isDraft && typeof s.priorLogit === 'number' && (() => {
                const rarity = rarityLabel(s.priorLogit);
                return (
                  <div className="flex items-baseline gap-1.5 pl-1.5 mt-0.5 font-mono">
                    <span className={`text-[9px] uppercase tracking-[0.12em] ${rarity.tone}`}>
                      {rarity.word}
                    </span>
                    <span className="text-[9px] text-text-dim/50 tabular-nums">
                      logit {s.priorLogit >= 0 ? '+' : ''}{s.priorLogit.toFixed(1)}
                    </span>
                  </div>
                );
              })()}
              {s.description && (
                <div className="text-[9px] text-text-dim/70 leading-snug pl-1.5 line-clamp-2 mt-0.5">{s.description}</div>
              )}
            </button>
          );
        })}
      </div>

    </div>
  );
}

