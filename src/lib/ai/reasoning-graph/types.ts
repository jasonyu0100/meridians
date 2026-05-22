/**
 * Type declarations for the reasoning-graph subsystem.
 *
 * Kept in a single file so every submodule imports its types from one place.
 * The public API re-exports these from `src/lib/ai/reasoning-graph.ts`.
 */

import type { ThinkingResource } from "./shared";

// ── Node + edge types ───────────────────────────────────────────────────────

export type ReasoningNodeType =
  | "fate"         // Thread's gravitational pull — influences events toward resolution or unexpected turns
  | "character"    // Active agent that fulfills requirements
  | "location"     // Setting that enables/constrains action
  | "artifact"     // Object with narrative significance
  | "system"       // World rule or principle
  | "reasoning"    // A step in the logical chain
  | "pattern"      // Positive pattern to reinforce (cooperative)
  | "warning"      // Anti-pattern risk to avoid (adversarial)
  | "chaos"        // Black-swan force — authorises departures from what the current agenda predicts. Two legitimate modes: (a) CREATIVE — spawn new characters/locations/artifacts/threads the existing state wouldn't have generated; (b) REVERSAL — flip a saturating or committed market against its current lean via a twist-grade event. Both are "not in the rulebook"; both re-price the portfolio.
  | "conclusion";  // The investigation's load-bearing answer to its direction. Exactly one per graph when the direction is a question. `detail` carries the answer concretely — named instruments / actors / events / outcomes, not abstract states. `considered` lists alternative answers rejected and why; `breaks` is what would invalidate the answer; `opens` is what cascades from acting on it. Sits at the highest `index` with incoming `requires` edges from the reasoning chain that supports it. Continuation / freeform investigations may omit it.

export type ReasoningEdgeType =
  | "enables"      // A enables B
  | "constrains"   // A limits/blocks B
  | "risks"        // A creates risk for B
  | "requires"     // A needs B
  | "causes"       // A leads to B
  | "reveals"      // A exposes B
  | "develops"     // A deepens B (thread/character)
  | "resolves"     // A concludes B
  | "supersedes";  // A replaces/overrides B (new rule overrides old, new commitment overrides prior)

export interface ReasoningNode {
  id: string;
  /** Presentation order — causal/chronological position used for display and downstream consumption. Nodes are sorted and stepped through by this field. */
  index: number;
  /**
   * Generation order — the order in which the reasoner thought of this
   * node (the JSON array position at parse time). Bookkeeping only;
   * `index` is what's used by callers. Differs from `index` in backward
   * modes (abduction/induction) where thinking runs opposite to display.
   */
  order: number;
  type: ReasoningNodeType;
  label: string;           // Short label (3-8 words)
  detail?: string;         // The inference itself — the causal logic this node carries.
  /**
   * Sibling hypotheses considered and rejected — the option space this
   * inference selected from. Each entry names an alternative plus why it
   * was discarded. Required by abduction and induction modes; lifts the
   * graph above default chain-of-thought by exposing the rejection set
   * the reader can re-evaluate.
   *
   * Only meaningful on inference-tier nodes (reasoning, pattern, warning,
   * chaos). Priors (character/location/artifact/system/fate) typically
   * leave this undefined — they ARE the substrate, not selections over it.
   */
  considered?: string;
  /**
   * What conditions would invalidate this inference — the load-bearing
   * assumption, the evidence that would falsify it, the way the chain
   * could fail. The deduction mode's necessity test materialises here.
   * Read as a stress-test handle for the user: if `breaks` is empty
   * because nothing could falsify, the node is either tautological or
   * untested.
   */
  breaks?: string;
  /**
   * What becomes possible downstream IF this inference holds — the
   * second-order consequences this opens up. The divergent mode's
   * outward-branching materialises here. Lets the user extend the
   * reasoning forward without the graph itself having to extend.
   */
  opens?: string;
  /** Existing character / location / artifact ID. Validated at parse time
   *  — if the LLM emits an unresolvable id, it's cleared. */
  entityId?: string;
  /** Existing thread ID. Validated at parse time. Required on fate nodes
   *  that aren't introducing a brand-new strand. */
  threadId?: string;
  /** Existing system knowledge node ID (SYS-XX). Validated at parse time.
   *  Required on system nodes that anchor to an existing rule. */
  systemNodeId?: string;
}

export interface ReasoningEdge {
  id: string;
  from: string;            // Node ID
  to: string;              // Node ID
  type: ReasoningEdgeType;
  label?: string;          // Optional edge label
}

export interface ReasoningGraph {
  nodes: ReasoningNode[];
  edges: ReasoningEdge[];
  arcName: string;
  sceneCount: number;
  summary: string;
  /**
   * Node count the LLM committed to BEFORE generating any nodes. Forces
   * planning — since LLMs emit tokens sequentially, placing this field
   * before `nodes` in the output schema means the LLM must decide how
   * many nodes to think through before it starts thinking. Transient;
   * not persisted to snapshots. Informational — may differ from the
   * final `nodes.length` if the LLM revised mid-generation.
   */
  plannedNodeCount?: number;
  /** Settings under which the CRG was built — propagated to scene gen so
   *  the same engine tilt drives downstream stages. */
  arcSettings?: ArcSettings;
}

// ── Minimal shapes for sequential-path building ─────────────────────────────

/** Minimal node shape for building sequential paths */
export type ReasoningNodeBase = {
  id: string;
  index: number;
  type: string;
  label: string;
  detail?: string;
  considered?: string;
  breaks?: string;
  opens?: string;
  entityId?: string;
  threadId?: string;
  systemNodeId?: string;
};

/** Minimal graph shape for building sequential paths — works with
 *  ReasoningGraph, ExpansionReasoningGraph, and CoordinationPlan. */
export type ReasoningGraphBase = {
  nodes: ReasoningNodeBase[];
  edges: ReasoningEdge[];
};

// ── Reasoning-mode types + options ──────────────────────────────────────────

/**
 * Mode of thinking for reasoning-graph generation.
 *
 * - **abduction** (default): backward + selective — committed outcome ← best
 *   hypothesis among competitors. Complementary opposite: divergent.
 * - **divergent**: forward + expansive — one source branches into many
 *   possibilities. Complementary opposite: abduction.
 * - **deduction**: forward + narrow — premise → necessary consequence chain.
 *   Complementary opposite: induction.
 * - **induction**: backward + generalising — shared pattern ← many
 *   observations. Complementary opposite: deduction.
 */
export type ThinkingStyle =
  | "freeform"   // No imposed style — let the model run its own chain of thought
  | "divergent"
  | "deduction"
  | "abduction"
  | "induction";

export type ArcReasoningOptions = {
  /** Which force category to bias this arc toward. */
  thinkingResource?: ThinkingResource;
  /** Reasoning effort for this generation. */
  reasoningLevel?: "small" | "medium" | "large";
  /** How the reasoner thinks. */
  thinkingStyle?: ThinkingStyle;
  /** Network thinking bias. */
  networkBias?: "inside" | "outside" | "neutral";
};

/**
 * Settings under which an arc's CRG was constructed. Persisted on the
 * reasoning graph (and on Arc.reasoningGraph) so downstream stages —
 * scene generation, beat planning, prose — can inherit the same engine
 * tilt the CRG was built under. The "sync" between CRG and scene gen.
 */
export type ArcSettings = {
  thinkingResource?: ThinkingResource;
  thinkingStyle?: ThinkingStyle;
  networkBias?: "inside" | "outside" | "neutral";
};

// ── Expansion graph ─────────────────────────────────────────────────────────

export type ExpansionReasoningGraph = {
  nodes: ReasoningNode[];
  edges: ReasoningEdge[];
  expansionName: string;
  summary: string;
  /** See ReasoningGraph.plannedNodeCount — forces the LLM to commit a
   *  node count before generating. Transient. */
  plannedNodeCount?: number;
};
