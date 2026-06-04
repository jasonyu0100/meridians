/**
 * Phase utilities — the working-model-of-reality graph that's mined
 * from narrative context (with optional user guidance) and passed downstream
 * into CRG / scene / plan / prose generation.
 *
 * Modes are IMMUTABLE once stored. The user either regenerates a new
 * one (optionally seeded by an existing one as basis) or clears the current.
 * Storage is reference-counted: a phase graph stays alive as long as it is
 * the current graph OR an arc still references it via `arc.phaseGraphId`.
 * When neither holds, it is pruned. Arcs preserve the working model they
 * were generated under; orphaned phase graphs that no arc cares about and
 * aren't current get garbage-collected.
 */

import type { NarrativeState, Phase, Arc } from "@/types/narrative";

/**
 * Get the currently-active phase graph, if any. Returns undefined when no
 * phase graph is set as current — downstream generation should fall back to
 * a historical viewpoint of the narrative context in that case.
 */
export function getActivePhaseGraph(narrative: NarrativeState): Phase | undefined {
  const id = narrative.currentPhaseGraphId;
  if (!id) return undefined;
  return narrative.phaseGraphs?.[id];
}

/**
 * True iff the phase graph with the given id is still in use — either as
 * the current graph, or referenced by at least one arc.
 */
export function isPhaseGraphInUse(
  id: string,
  currentPhaseGraphId: string | undefined,
  arcs: Record<string, Arc>,
): boolean {
  if (id === currentPhaseGraphId) return true;
  for (const arc of Object.values(arcs)) {
    if (arc.phaseGraphId === id) return true;
  }
  return false;
}

/**
 * Garbage-collect unreferenced phase graphs. Returns a new map with any
 * phase graph that is neither current nor referenced by an arc removed.
 * Pure — does not mutate the input. Caller is responsible for splicing
 * the result back into NarrativeState.
 */
export function prunePhaseGraphs(
  modes: Record<string, Phase> | undefined,
  currentPhaseGraphId: string | undefined,
  arcs: Record<string, Arc>,
): Record<string, Phase> | undefined {
  if (!modes) return modes;
  const next: Record<string, Phase> = {};
  let changed = false;
  for (const [id, graph] of Object.entries(modes)) {
    if (isPhaseGraphInUse(id, currentPhaseGraphId, arcs)) {
      next[id] = graph;
    } else {
      changed = true;
    }
  }
  return changed ? next : modes;
}
