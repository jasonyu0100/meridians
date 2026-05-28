/**
 * Scenarios — parallel Compass-driven branch generation.
 *
 * The user has a Compass cohort on the current arc — each direction a
 * complete coordination of variables at chosen intensities, weighted by
 * priorLogit (read as precision prediction in simulation, recommendation
 * otherwise). Scenarios takes the cohort and generates ONE arc
 * continuation per direction in parallel, with the direction's variable
 * coordination as primary generation guidance. Each result becomes a
 * candidate Branch in the work's graph; on commit, every direction attaches
 * as a sister divergence off the same fork, and the softmax-top direction's
 * branch becomes active.
 */

import type { Scene, Arc, NarrativeState, PlanningScenario, Variable } from './narrative';

// ── Per-scenario run state ────────────────────────────────────────────────

export type ScenarioRunStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

/** One scenario in the batch, with its generation status and (when
 *  finished) its produced arc continuation. */
export type ScenarioRun = {
  /** Foreign key into the focused arc's planningScenarios. */
  scenarioId: string;
  /** Display name copied at run start so the panel doesn't depend on the
   *  scenario surviving regenerate while the batch is in flight. */
  name: string;
  /** Display color, same reason. */
  color: string;
  /** The scenario's variables (with intensities) captured at run start.
   *  Used as primary generation guidance. */
  variables: Variable[];
  /** Softmax probability at the moment the batch was launched. The branch
   *  with the highest probability becomes the active branch on commit. */
  probabilityAtStart: number;

  status: ScenarioRunStatus;
  /** Stream of LLM tokens for the panel preview. */
  streamText: string;
  /** Phase label for progress display ("planning scenes" / "writing"). */
  phase?: string;
  /** Coarse progress counter for the panel (e.g. scenes done / total). */
  progress?: { current: number; total: number };
  /** Error message if status === 'failed'. */
  error?: string;
  /** Raw LLM output captured when the failure was a JSON parse error.
   *  Feeds the per-scenario "Repair" button so the user can ask the model
   *  to fix the malformed output instead of paying for a full re-run.
   *  The repair flow does its own LLM-based diagnosis from this content. */
  failedRaw?: string;

  startedAt?: number;
  finishedAt?: number;

  /** Produced arc + scenes when status === 'done'. The first arc's
   *  presentVariables are stamped with the scenario's variables so the
   *  resulting branch "knows" which scenario it instantiated. */
  result?: {
    arc: Arc;
    scenes: Scene[];
    /** Snapshot of the narrative state with this arc applied, used to
     *  build the eventual branch on commit. */
    virtualNarrative: NarrativeState;
    virtualResolvedKeys: string[];
    virtualCurrentIndex: number;
  };
};

// ── Run config ────────────────────────────────────────────────────────────

export type ScenariosConfig = {
  /** Optional override — by default we use every scenario on the focused
   *  arc. Setting this lets the panel run a subset (e.g. just the top 3). */
  selectedScenarioIds?: string[];
  /** Optional high-level user direction layered on top of scenario
   *  guidance for every generation in the batch. */
  direction?: string;
  /** Constraints prompt — defaults from StorySettings.storyConstraints,
   *  overridable here. */
  constraintsPrompt?: string;
  /** Optional world-build commit to seed all generations with. */
  worldBuildFocusId?: string;
  /** Per-batch override for arc length. When unset, generateScenes falls
   *  back to `storySettings.targetArcLength`. Bounded 2–8 at the call site. */
  sceneCount?: number;
};

export const DEFAULT_SCENARIOS_CONFIG: ScenariosConfig = {};

// ── Overall run state ─────────────────────────────────────────────────────

export type ScenariosStatus = 'idle' | 'running' | 'complete' | 'cancelled';

export type ScenariosRunState = {
  status: ScenariosStatus;
  /** The arc this batch was launched against — every scenario continues
   *  from this arc's end state. */
  arcId: string | null;
  /** Per-scenario run state, keyed by scenarioId. */
  runs: Record<string, ScenarioRun>;
  /** Ordering of scenarioIds for stable display. */
  scenarioOrder: string[];
  config: ScenariosConfig;
  startedAt: number | null;
  finishedAt: number | null;
  /** Top-level error if the batch as a whole failed to start. */
  error?: string;
};

export function makeEmptyRunState(): ScenariosRunState {
  return {
    status: 'idle',
    arcId: null,
    runs: {},
    scenarioOrder: [],
    config: { ...DEFAULT_SCENARIOS_CONFIG },
    startedAt: null,
    finishedAt: null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function runDoneCount(state: ScenariosRunState): number {
  return state.scenarioOrder.reduce(
    (n, id) => n + (state.runs[id]?.status === 'done' ? 1 : 0),
    0,
  );
}

export function runFailedCount(state: ScenariosRunState): number {
  return state.scenarioOrder.reduce(
    (n, id) => n + (state.runs[id]?.status === 'failed' ? 1 : 0),
    0,
  );
}

export function runRunningCount(state: ScenariosRunState): number {
  return state.scenarioOrder.reduce(
    (n, id) => n + (state.runs[id]?.status === 'running' ? 1 : 0),
    0,
  );
}

/** Initialise a scenario run from a PlanningScenario + its softmax
 *  probability at launch time. */
export function initScenarioRun(
  scenario: PlanningScenario,
  probabilityAtStart: number,
): ScenarioRun {
  return {
    scenarioId: scenario.id,
    name: scenario.name,
    color: scenario.color,
    variables: scenario.variables.map((v) => ({ ...v })),
    probabilityAtStart,
    status: 'pending',
    streamText: '',
  };
}
