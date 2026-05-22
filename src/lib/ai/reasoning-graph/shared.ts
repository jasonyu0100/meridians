/**
 * Shared helpers for the reasoning-graph subsystem — scale helpers and
 * force-preference type used across every submodule.
 */

import type { NarrativeState } from "@/types/narrative";
import { resolveReasoningBudget } from "@/lib/ai/api";

/** Which force dominates a reasoning graph / coordination plan. */
export type ThinkingResource =
  | "freeform"
  | "fate"
  | "world"
  | "system"
  | "chaos";

/** Default reasoning-token budget tied to narrative settings. */
export function defaultReasoningBudget(narrative: NarrativeState): number {
  return resolveReasoningBudget(narrative);
}

/**
 * Multiplier applied to graph node-count targets based on the reasoning
 * slider. Small compresses the graph, medium is default, large expands.
 * Used to scale density of reasoning graphs and coordination plans.
 */
export function reasoningScale(
  size: "small" | "medium" | "large" | undefined,
): number {
  if (size === "small") return 0.6;
  if (size === "large") return 1.6;
  return 1; // medium / undefined
}

// ── Valid-type sets used by validators + parsers ────────────────────────────

export const VALID_NODE_TYPES = new Set([
  "fate",
  "character",
  "location",
  "artifact",
  "system",
  "reasoning",
  "pattern",
  "warning",
  "chaos",
  "conclusion",
]);

export const VALID_EDGE_TYPES = new Set([
  "enables",
  "constrains",
  "risks",
  "requires",
  "causes",
  "reveals",
  "develops",
  "resolves",
  "supersedes",
]);
