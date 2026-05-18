/**
 * Experimentation engine — parallel scenario-driven batch generator.
 *
 * For each Future scenario in the cohort, generate ONE arc continuation
 * in parallel, with the scenario's variable coordination as the primary
 * direction. Flat fan-out; the cohort's softmax probability ranks the
 * scenarios for commit ordering.
 */

import type {
  NarrativeState,
  PlanningScenario,
  Variable,
  Scene,
  Arc,
} from "@/types/narrative";
import { VARIABLE_INTENSITY_LEVELS } from "@/lib/ai/variables";
import { applySceneDeltas } from "@/lib/experimentation-state";

// ── Direction builder — scenario → generation guidance ────────────────────

/**
 * Build the scene-generation `direction` string from a scenario's variable
 * coordination. This is the PRIMARY guidance the LLM sees — variables are
 * the lead, not an afterthought.
 */
export function buildDirectionFromScenario(
  scenario: PlanningScenario,
  options: { overallDirection?: string; constraintsPrompt?: string } = {},
): string {
  const { overallDirection, constraintsPrompt } = options;

  const variablesBlock = scenario.variables.length > 0
    ? scenario.variables
        .map((v) => {
          const label = VARIABLE_INTENSITY_LEVELS[v.intensity]?.label ?? "?";
          return `  - ${v.name} @ ${label} (intensity ${v.intensity}/4) — ${v.description}`;
        })
        .join("\n")
    : "  (no variables configured)";

  const description = scenario.description ? `\nDescription: ${scenario.description}` : "";
  const reasoning = scenario.reasoning
    ? `\nWhy this continuation is plausible: ${scenario.reasoning}`
    : "";
  // Universal inference-shape: the three handles the scenario already
  // surfaced — rejected alternatives, falsification, downstream cascade.
  // Threading them into the direction string lets scene generation INHERIT
  // the comparative + falsification reasoning rather than re-derive it.
  const considered = scenario.considered
    ? `\nAlternatives this continuation rejects (× considered): ${scenario.considered}`
    : "";
  const breaks = scenario.breaks
    ? `\nWhat would invalidate this continuation (! breaks): ${scenario.breaks}`
    : "";
  const opens = scenario.opens
    ? `\nWhat this continuation opens for arcs beyond this one (⇒ opens): ${scenario.opens}`
    : "";

  let direction = `SCENARIO: ${scenario.name}${description}${reasoning}${considered}${breaks}${opens}

PRIMARY GUIDANCE — VARIABLE COORDINATION
This arc continuation must enact the following coordination of variables. Each named force should be expressed at its specified intensity in the form the work's register actually carries — scene events and character choices in fiction; rule activations and modelled state transitions in simulation; claims advanced, sources engaged, counter-arguments addressed, and methodological commitments shifted in a paper or essay. The variables are the spine — let them shape what the arc DOES, in whatever way that register registers "doing".

${variablesBlock}

Generate scenes whose deltas and prose CAUSE the variables to fire at the stated intensities. A variable at intensity 3 (strong) is a clear inflection driver across multiple scenes; intensity 4 (extreme) reshapes the arc; intensity 1 (weak) is a background hint.

Steer AGAINST the rejected alternatives in \`considered\` — those routings were considered and explicitly discarded by this scenario, so scenes that drift toward them violate the brief. Honour \`breaks\` as the test: if the arc's events would no longer satisfy this scenario's falsifying condition, the scenario isn't being enacted. Let \`opens\` shape the END of the arc — leave the threads it names primed for the arc-after-next.`;

  if (overallDirection?.trim()) {
    direction = `OVERALL DIRECTION (steer the broader work toward this): ${overallDirection.trim()}\n\n${direction}`;
  }
  if (constraintsPrompt?.trim()) {
    direction += `\n\nCONSTRAINTS (DO NOT do any of the following): ${constraintsPrompt.trim()}`;
  }

  return direction;
}

// ── Virtual narrative state (post-arc snapshot) ──────────────────────────

export type VirtualState = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentIndex: number;
};

/**
 * Stamp a scenario's variable coordination onto a freshly generated arc.
 * The committed branch should carry the variables that produced it, with
 * dormant entries (intensity 0) filtered out so the arc reflects only
 * variables actually firing in the scenario.
 *
 * Also transfers the scenario's description + reasoning onto the new arc
 * as `presentDescription` / `presentReasoning` so lineage is preserved —
 * the Future-scenario annotation becomes the new arc's Present annotation.
 *
 * Shared between the virtual preview (`buildVirtualState`) and the real
 * commit path (`useExperimentation.runScenario`) so both surfaces agree
 * on what gets stamped onto the new arc.
 *
 * Accepts either the raw variables array or the full scenario for richer
 * transfer. Callers that pass only variables get the variable stamp;
 * callers that pass the scenario also get description + reasoning.
 */
export function stampScenarioVariables(
  arc: Arc,
  scenarioOrVariables: PlanningScenario | Variable[],
): Arc {
  const isScenario = !Array.isArray(scenarioOrVariables);
  const scenarioVariables = isScenario ? scenarioOrVariables.variables : scenarioOrVariables;
  const description = isScenario && scenarioOrVariables.description?.trim()
    ? scenarioOrVariables.description.trim()
    : undefined;
  const reasoning = isScenario && scenarioOrVariables.reasoning?.trim()
    ? scenarioOrVariables.reasoning.trim()
    : undefined;
  const considered = isScenario && scenarioOrVariables.considered?.trim()
    ? scenarioOrVariables.considered.trim()
    : undefined;
  const breaks = isScenario && scenarioOrVariables.breaks?.trim()
    ? scenarioOrVariables.breaks.trim()
    : undefined;
  const opens = isScenario && scenarioOrVariables.opens?.trim()
    ? scenarioOrVariables.opens.trim()
    : undefined;
  const logit = isScenario && typeof scenarioOrVariables.priorLogit === 'number'
    ? scenarioOrVariables.priorLogit
    : undefined;
  return {
    ...arc,
    presentVariables: scenarioVariables.filter((v) => v.intensity > 0),
    presentDescription: description,
    presentReasoning: reasoning,
    presentConsidered: considered,
    presentBreaks: breaks,
    presentOpens: opens,
    presentLogit: logit,
  };
}

/**
 * Compute the narrative state with one generated arc applied — used as
 * the post-arc snapshot the panel can preview. The new arc's
 * `presentVariables` are stamped with the scenario's variables (filtered
 * to intensity > 0) so the resulting branch carries the variables that
 * produced it.
 */
export function buildVirtualState(
  rootNarrative: NarrativeState,
  rootResolvedKeys: string[],
  arc: Arc,
  scenes: Scene[],
  activeBranchId: string,
  scenarioOrVariables: PlanningScenario | Variable[],
): VirtualState {
  let narrative: NarrativeState = JSON.parse(JSON.stringify(rootNarrative));
  let resolvedKeys = [...rootResolvedKeys];

  const stampedArc = stampScenarioVariables(arc, scenarioOrVariables);

  for (const scene of scenes) {
    narrative.scenes[scene.id] = scene;
  }

  if (!narrative.arcs[stampedArc.id]) {
    narrative.arcs[stampedArc.id] = stampedArc;
  } else {
    const existing = narrative.arcs[stampedArc.id];
    const existingSet = new Set(existing.sceneIds);
    const deduped = stampedArc.sceneIds.filter((id) => !existingSet.has(id));
    narrative.arcs[stampedArc.id] = {
      ...existing,
      sceneIds: [...existing.sceneIds, ...deduped],
      presentVariables: stampedArc.presentVariables,
      presentDescription: stampedArc.presentDescription,
      presentReasoning: stampedArc.presentReasoning,
      presentConsidered: stampedArc.presentConsidered,
      presentBreaks: stampedArc.presentBreaks,
      presentOpens: stampedArc.presentOpens,
      presentLogit: stampedArc.presentLogit,
    };
  }

  const branch = narrative.branches[activeBranchId];
  if (branch) {
    const existingSet = new Set(branch.entryIds);
    const newEntries = scenes.map((s) => s.id).filter((id) => !existingSet.has(id));
    narrative.branches[activeBranchId] = {
      ...branch,
      entryIds: [...branch.entryIds, ...newEntries],
    };
  }

  narrative = applySceneDeltas(narrative, scenes);

  const newKeys = scenes.map((s) => s.id).filter((id) => !resolvedKeys.includes(id));
  resolvedKeys = [...resolvedKeys, ...newKeys];
  const currentIndex = resolvedKeys.length - 1;

  return { narrative, resolvedKeys, currentIndex };
}

// ── Concurrency pool ──────────────────────────────────────────────────────

/**
 * Run async tasks with a bounded concurrency window plus a cancel hook.
 * Each task is dispatched as a worker slot opens. No pause support — each
 * task is one in-flight LLM call and can't be suspended mid-stream; the
 * cancel signal flips them to abort instead.
 */
export async function runWithPool<T>(
  ids: T[],
  task: (id: T) => Promise<void>,
  options: {
    parallel: number;
    isCancelled: () => boolean;
  },
): Promise<void> {
  const { parallel, isCancelled } = options;
  const queue = [...ids];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      if (isCancelled()) return;
      const id = queue.shift();
      if (id === undefined) return;
      try {
        await task(id);
      } catch {
        // Errors are surfaced to the per-scenario run state by the task
        // itself; the pool keeps draining.
      }
    }
  }

  const n = Math.max(1, Math.min(parallel, ids.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
}
