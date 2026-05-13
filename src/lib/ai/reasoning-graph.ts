/**
 * Reasoning-graph generators — the top-level entry points that produce:
 *
 *   - `generateReasoningGraph`        — per-arc causal graph (scene-level planning)
 *   - `generateExpansionReasoningGraph` — world-expansion graph (new entities/threads)
 *   - `generateCoordinationPlan`      — multi-arc plan with peaks/valleys/moments
 *
 * Supporting helpers (mode blocks, force-preference blocks, validation,
 * sequential-path rendering, shared types) live in `./reasoning-graph/*`
 * submodules. Public types and helpers are re-exported below so existing
 * import paths (`@/lib/ai/reasoning-graph`) keep working.
 */

import type {
  NarrativeState,
  WorldBuild,
  CoordinationPlan,
  CoordinationNode,
  CoordinationEdge,
  CoordinationNodeType,
  Arc,
  ReasoningGraphSnapshot,
} from "@/types/narrative";
import { REASONING_BUDGETS, resolveEntry } from "@/types/narrative";
import { callGenerate, callGenerateStream } from "./api";
import { PLANNING_MODEL } from "@/lib/constants";
import { narrativeContext, getStateAtIndex } from "./context";
import { parseJson } from "./json";
import { buildCumulativeSystemGraph, getMarketProbs, isThreadAbandoned, isThreadClosed, resolveEntityName, scenesSinceTouched } from "@/lib/narrative-utils";
import { classifyThreadCategory, computeRecentLogitEnergy, THREAD_CATEGORY_GUIDANCE, formatThreadGuidance } from "@/lib/thread-category";
import { applyDerivedForceModes } from "@/lib/auto-engine";
import { logError } from "@/lib/system-logger";
import { aggregateNetworkGraph, summarizeNetworkState } from "@/lib/network-graph";
import type { CoordinationPlanContext } from "./scenes";
import { buildActiveModeSection } from "./mode-graph";

// ── Subsystem imports ───────────────────────────────────────────────────────

import type {
  ReasoningNode,
  ReasoningEdge,
  ReasoningEdgeType,
  ReasoningNodeType,
  ReasoningGraph,
  ReasoningMode,
  ArcReasoningOptions,
  ArcSettings,
  ExpansionReasoningGraph,
  ReasoningNodeBase,
  ReasoningGraphBase,
} from "./reasoning-graph/types";
import {
  type ForcePreference,
  defaultReasoningBudget,
  reasoningScale,
  VALID_NODE_TYPES,
  VALID_EDGE_TYPES,
} from "./reasoning-graph/shared";
import { validateNodeReferences } from "./reasoning-graph/validate";
import {
  reasoningModeBlock,
  forcePreferenceBlock,
  networkBiasBlock,
  getPlanNodeGuidance,
  buildSequentialPath,
  extractPatternWarningDirectives,
  buildArcReasoningGraphPrompt,
  buildCoordinationPlanPrompt,
  ARC_REASONING_GRAPH_SYSTEM,
  COORDINATION_PLAN_SYSTEM,
} from "@/lib/prompts/reasoning";

// ── Public API re-exports ───────────────────────────────────────────────────
// Keep existing import paths (`@/lib/ai/reasoning-graph`) working after the
// split. Types and helpers live in submodules; this file is the entry point.

export type {
  ReasoningNode,
  ReasoningEdge,
  ReasoningEdgeType,
  ReasoningNodeType,
  ReasoningGraph,
  ReasoningMode,
  ArcReasoningOptions,
  ArcSettings,
  ExpansionReasoningGraph,
  ReasoningNodeBase,
  ReasoningGraphBase,
  ForcePreference,
};
export { reasoningScale, buildSequentialPath, extractPatternWarningDirectives };

/**
 * Resolve the engine settings the CRG was built under. Pulls forcePreference
 * and reasoningMode from the per-call options; falls back to the narrative's
 * default network bias if the call didn't override. Returns undefined when
 * no settings would be persisted (keeps the snapshot clean for default runs).
 */
function extractArcSettings(
  options: ArcReasoningOptions | undefined,
  narrative: NarrativeState,
): ArcSettings | undefined {
  const forcePreference = options?.forcePreference;
  const reasoningMode = options?.reasoningMode;
  const networkBias = options?.networkBias ?? narrative.storySettings?.defaultNetworkBias;
  if (!forcePreference && !reasoningMode && (!networkBias || networkBias === "neutral")) {
    return undefined;
  }
  const settings: ArcSettings = {};
  if (forcePreference) settings.forcePreference = forcePreference;
  if (reasoningMode) settings.reasoningMode = reasoningMode;
  if (networkBias && networkBias !== "neutral") settings.networkBias = networkBias;
  return settings;
}

/**
 * Find the most recent arc that has a stored reasoning graph, walking
 * resolvedKeys backward from the current index. Returns null if no prior
 * arc has a graph (first arc being generated, or priors never persisted).
 *
 * Used to feed the prior graph into the next generation's prompt so the
 * LLM can see — and diverge from — the shape it just built, instead of
 * re-describing the same causal spine with cosmetic variation.
 */
function findLastArcGraph(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): { arc: Arc; graph: ReasoningGraphSnapshot } | null {
  const keysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);
  const seen = new Set<string>();
  for (let i = keysUpToCurrent.length - 1; i >= 0; i--) {
    const entry = resolveEntry(narrative, keysUpToCurrent[i]);
    if (!entry || entry.kind === "world_build") continue;
    const arcId = entry.arcId;
    if (!arcId || seen.has(arcId)) continue;
    seen.add(arcId);
    const arc = narrative.arcs[arcId];
    if (arc?.reasoningGraph) return { arc, graph: arc.reasoningGraph };
  }
  return null;
}

/**
 * Render the active-thread pick-list with a per-thread INFLUENCE tag derived
 * from its market state. The reasoner is meant to treat threads as pressure
 * on the graph, not as mandatory anchors — a committed market pulls the
 * reasoning toward its leading outcome; a contested market leaves reasoning
 * genuinely open; a fading market invites deprecation. This is the same
 * prior-as-bias pattern `buildThreadHealthPrompt` surfaces to scene
 * generation, scaled to arc planning so both layers share one mental model.
 */
function renderActiveThreadsWithInfluence(
  narrative: NarrativeState,
  resolvedKeys?: string[],
  currentIndex?: number,
): string {
  return Object.values(narrative.threads)
    .filter((t) => !isThreadClosed(t) && !isThreadAbandoned(t))
    .map((t) => {
      const probs = getMarketProbs(t);
      const top = probs.indexOf(Math.max(...probs));
      const topProb = probs[top] ?? 0;
      const belief = t.beliefs?.narrator;
      const vol = belief?.volume ?? 0;
      const silent = resolvedKeys && currentIndex !== undefined
        ? scenesSinceTouched(t, resolvedKeys, currentIndex)
        : undefined;
      const category = classifyThreadCategory(t, silent !== undefined ? { scenesSinceTouch: silent } : undefined);
      const energy = computeRecentLogitEnergy(t);
      const signal = formatThreadGuidance(THREAD_CATEGORY_GUIDANCE[category], t.outcomes[top] ?? '?', topProb);
      return `- [${t.id}] "${t.description}" · ${signal} · vol=${vol.toFixed(1)} · energy=${energy.toFixed(2)}`;
    })
    .join("\n");
}

export async function generateReasoningGraph(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  sceneCount: number,
  direction: string,
  arcName: string,
  onReasoning?: (token: string) => void,
  /** When provided, the coordination plan context guides the reasoning graph generation */
  coordinationPlanContext?: CoordinationPlanContext,
  /** Arc-level options (chaos-driven, reasoning effort). */
  options?: ArcReasoningOptions,
): Promise<ReasoningGraph> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  // Network heat tiers — every entity / thread / system node carries a
  // {hot|warm|cold|fresh ×N} label so the reasoner can see the cumulative
  // activation pattern and lean into or away from it per the bias setting.
  // Scoped to the current point in the timeline (progressive aggregation).
  const network = aggregateNetworkGraph(narrative, resolvedKeys, currentIndex);
  // Get active threads — annotations live on the <thread> tags in
  // narrativeContext above; this section is just a quick pick-list.
  const activeThreads = renderActiveThreadsWithInfluence(narrative, resolvedKeys, currentIndex);

  // Get key characters
  const characters = Object.values(narrative.characters)
    .filter((c) => c.role === "anchor" || c.role === "recurring")
    .slice(0, 8)
    .map((c) => `- [${c.id}] ${c.name} (${c.role})`)
    .join("\n");

  // Get key locations
  const locations = Object.values(narrative.locations)
    .filter((l) => l.prominence === "domain" || l.prominence === "place")
    .slice(0, 6)
    .map((l) => `- [${l.id}] ${l.name}`)
    .join("\n");

  // Get artifacts
  const artifacts = Object.values(narrative.artifacts ?? {})
    .filter((a) => a.significance === "key" || a.significance === "notable")
    .slice(0, 4)
    .map((a) => `- [${a.id}] ${a.name}`)
    .join("\n");

  // Get system knowledge — IDs included so reasoning nodes can reference
  // them via `systemNodeId` (mirrors how characters/locations/artifacts
  // expose their IDs above).
  const systemKnowledge = Object.values(narrative.systemGraph?.nodes ?? {})
    .filter((n) =>
      ["principle", "system", "constraint", "tension"].includes(n.type),
    )
    .slice(0, 8)
    .map((n) => `- [${n.id}] ${n.concept} (${n.type})`)
    .join("\n");

  // Get narrative patterns and anti-patterns
  const patterns = narrative.patterns ?? [];
  const antiPatterns = narrative.antiPatterns ?? [];

  const patternsSection = patterns.length > 0
    ? patterns.map((p) => `    <pattern>${p}</pattern>`).join("\n")
    : "";

  const antiPatternsSection = antiPatterns.length > 0
    ? antiPatterns.map((p) => `    <anti-pattern>${p}</anti-pattern>`).join("\n")
    : "";

  // Prior reasoning graph — the last arc's graph, rendered for divergence
  // pressure. Without this, the LLM is asked to emit "warning" nodes that
  // detect graph-level repetition while being blind to the prior graphs
  // themselves — which is why successive arcs converge to the same causal
  // spine with cosmetic variation.
  const lastArcGraph = findLastArcGraph(narrative, resolvedKeys, currentIndex);
  const priorGraphSection = lastArcGraph
    ? `<prior-arc-graph arc-name="${lastArcGraph.graph.arcName}" hint="DIVERGE FROM THIS — your graph's causal spine must NOT replicate the structure below. Graph-level repetition is the same failure as reasoning-pattern repetition within one graph.">
  <summary>${lastArcGraph.graph.summary}</summary>
  <sequential-path>
${buildSequentialPath({ nodes: lastArcGraph.graph.nodes, edges: lastArcGraph.graph.edges })}
  </sequential-path>
  <divergence-rules>
    <rule>Fate commitments differ in KIND, not just content. Prior resolved via acquisition → yours closes via reversal/revelation/alliance/subversion. Same commitment shape with new content = re-description.</rule>
    <rule>Reasoning chain uses different inference modes. Prior leaned on constraint-propagation/sequential dependency → introduce abduction, inversion, analogy, or branching.</rule>
    <rule>Warning nodes must cite specific shapes from the prior graph (node labels or indices) so the new graph visibly routes around them.</rule>
  </divergence-rules>
  <failure-mode>If your chain and terminal map onto the spine above with only content swaps, you've re-described the prior arc, not advanced the narrative.</failure-mode>
</prior-arc-graph>`
    : "";

  const scale = reasoningScale(options?.reasoningLevel);
  const prompt = buildArcReasoningGraphPrompt({
    context: ctx,
    networkStateLine: summarizeNetworkState(network),
    activeThreads,
    characters,
    locations,
    artifacts,
    systemKnowledge,
    patternsSection,
    antiPatternsSection,
    arcName,
    sceneCount,
    coordinationPlanContext: coordinationPlanContext
      ? {
          arcIndex: coordinationPlanContext.arcIndex,
          arcCount: coordinationPlanContext.arcCount,
          forceMode: coordinationPlanContext.forceMode,
          directive: coordinationPlanContext.directive,
        }
      : undefined,
    direction,
    priorGraphSection,
    modeSection: buildActiveModeSection(narrative, "reasoning-arc"),
    forcePreferenceBlockText: forcePreferenceBlock("arc", options?.forcePreference),
    reasoningModeBlockText: reasoningModeBlock(options?.reasoningMode),
    networkBiasBlockText: networkBiasBlock(options?.networkBias ?? narrative.storySettings?.defaultNetworkBias),
    nodeCountMin: Math.round((8 + sceneCount * 4.5) * scale),
    nodeCountMax: Math.round((14 + sceneCount * 5.5) * scale),
  });

  const reasoningBudget = defaultReasoningBudget(narrative);

  const raw = onReasoning
    ? await callGenerateStream(
        prompt,
        ARC_REASONING_GRAPH_SYSTEM,
        () => {}, // No token streaming for main output
        undefined,
        "generateReasoningGraph",
        PLANNING_MODEL,
        reasoningBudget,
        onReasoning,
      )
    : await callGenerate(
        prompt,
        ARC_REASONING_GRAPH_SYSTEM,
        undefined,
        "generateReasoningGraph",
        PLANNING_MODEL,
        reasoningBudget,
      );

  // Parse JSON response
  try {
    let jsonStr = raw.trim();
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const data = JSON.parse(jsonStr);

    // Validate and normalize
    if (!data.nodes || !Array.isArray(data.nodes)) {
      throw new Error("Invalid graph structure: missing nodes");
    }
    if (!data.edges || !Array.isArray(data.edges)) {
      data.edges = [];
    }

    // Ensure all nodes have required fields and valid types. The JSON
    // array position (i) becomes order — the order the LLM
    // emitted/thought of each node, distinct from its presentation index.
    const rawNodes: ReasoningNode[] = data.nodes.map((n: Partial<ReasoningNode>, i: number) => ({
      id: typeof n.id === "string" ? n.id : `N${i}`,
      index: typeof n.index === "number" ? n.index : i,
      order: i,
      type: (typeof n.type === "string" && VALID_NODE_TYPES.has(n.type)) ? n.type as ReasoningNodeType : "reasoning",
      label: typeof n.label === "string" ? n.label.slice(0, 200) : "Unlabeled node",
      detail: typeof n.detail === "string" ? n.detail.slice(0, 500) : undefined,
      entityId: typeof n.entityId === "string" ? n.entityId : undefined,
      threadId: typeof n.threadId === "string" ? n.threadId : undefined,
      systemNodeId: typeof n.systemNodeId === "string" ? n.systemNodeId : undefined,
    }));
    const nodes: ReasoningNode[] = rawNodes.map((n) =>
      validateNodeReferences(n, narrative, { source: "plan-generation", arcName }),
    );

    // Ensure all edges have required fields, valid types, and reference existing nodes
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: ReasoningEdge[] = data.edges
      .map((e: Partial<ReasoningEdge>, i: number) => ({
        id: typeof e.id === "string" ? e.id : `E${i}`,
        from: typeof e.from === "string" ? e.from : "",
        to: typeof e.to === "string" ? e.to : "",
        type: (typeof e.type === "string" && VALID_EDGE_TYPES.has(e.type)) ? e.type as ReasoningEdgeType : "causes",
        label: typeof e.label === "string" ? e.label.slice(0, 100) : undefined,
      }))
      .filter((e: ReasoningEdge) => e.from && e.to && nodeIds.has(e.from) && nodeIds.has(e.to));

    return {
      nodes,
      edges,
      arcName,
      sceneCount,
      summary: typeof data.summary === "string" ? data.summary : `Reasoning graph for ${arcName}`,
      plannedNodeCount: typeof data.plannedNodeCount === "number" ? data.plannedNodeCount : undefined,
      arcSettings: extractArcSettings(options, narrative),
    };
  } catch (err) {
    logError("Failed to parse reasoning graph", err, {
      source: "world-expansion",
      operation: "reasoning-graph-parse",
      details: { arcName, sceneCount },
    });
    // Return minimal fallback
    return {
      nodes: [
        {
          id: "R1",
          index: 0,
          order: 0,
          type: "reasoning",
          label: `${arcName} - graph generation failed`,
          detail: String(err),
        },
      ],
      edges: [],
      arcName,
      sceneCount,
      summary: "Failed to generate reasoning graph",
    };
  }
}
// ── Coordination Plan Generation ─────────────────────────────────────────────

/**
 * Valid coordination node types. Must include every `CoordinationNodeType`
 * member — sanitization silently retypes unknown types to "reasoning", so a
 * missing entry here "disguises" nodes of that type in rendered plans.
 */
export const VALID_COORDINATION_NODE_TYPES = new Set<CoordinationNodeType>([
  "fate",
  "character",
  "location",
  "artifact",
  "system",
  "reasoning",
  "pattern",
  "warning",
  "chaos",      // Outside-force agent — spawns new entities / new fates
  "peak",       // Structural peak — forces converge, thread culminates; arc anchors here
  "valley",     // Structural valley — turning point, tension seeded; can anchor arcs
  "moment",     // Key beat in the plan that isn't a peak or valley
]);

/** Thread target expressed as a market intent + optional outcome. */
export type ThreadTarget = {
  threadId: string;
  /** What the plan wants this thread's market to do. */
  marketIntent: "advance" | "escalate" | "close" | "twist" | "maintain" | "abandon";
  /** For advance/close/twist: which outcome label. */
  marketOutcome?: string;
  /** When in the plan this should happen */
  timing?: "early" | "mid" | "late" | "final";
};

/** Guidance for which threads should reach which states */
export type PlanGuidance = {
  /** Thread targets with status and timing */
  threadTargets?: ThreadTarget[];
  /** Arc target — exact number of arcs to plan */
  arcTarget?: number;
  /** Direction — coordinates end fate goals that should be achieved */
  direction?: string;
  /** Constraints — what must NOT happen, restrictions on the narrative */
  constraints?: string;
  /**
   * Which force category to bias the plan toward. Default "freeform"
   * (no bias — LLM picks composition). "chaos" elevates chaos from
   * sparing deus-ex-machina to a primary creative engine.
   */
  forcePreference?: ForcePreference;
  /**
   * Reasoning effort for this single generation. Overrides the narrative's
   * default storySettings.reasoningLevel when provided. "small" | "medium"
   * | "large" map to low / medium / high REASONING_BUDGETS.
   */
  reasoningLevel?: "small" | "medium" | "large";
  /**
   * How the reasoner thinks. Defaults to "abduction" — picks the best
   * hypothesis working backward from a committed outcome. Alternatives:
   * "divergent" (forward, expansive), "deduction" (premise → necessary
   * consequence), "induction" (observation → inferred principle). See
   * ReasoningMode for details.
   */
  reasoningMode?: ReasoningMode;
};

/**
 * Generate a coordination plan for multiple arcs using backward induction.
 * The plan uses terminal states (thread endings) as anchors and works backwards
 * to derive waypoints and arc requirements.
 */
export async function generateCoordinationPlan(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  guidance: PlanGuidance,
  onReasoning?: (token: string) => void,
): Promise<CoordinationPlan> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  // Get timeline-scoped state for accurate knowledge
  const timelineState = getStateAtIndex(narrative, resolvedKeys, currentIndex);

  // Analyze current thread states
  const threads = Object.values(narrative.threads);
  const threadSummary = threads
    .filter((t) => !isThreadClosed(t) && !isThreadAbandoned(t))
    .map((t) => {
      const participantNames = t.participants.map(p => {
        if (p.type === "character") return narrative.characters[p.id]?.name ?? p.id;
        if (p.type === "location") return narrative.locations[p.id]?.name ?? p.id;
        if (p.type === "artifact") return narrative.artifacts?.[p.id]?.name ?? p.id;
        return p.id;
      }).join(", ");
      // Include thread log momentum
      const logNodes = Object.values(t.threadLog?.nodes ?? {});
      const recentLog = logNodes.slice(-3).map(n => n.content).join(" → ");
      const momentum = recentLog ? ` | momentum: ${recentLog}` : "";
      const probs = getMarketProbs(t);
      const topIdx = probs.indexOf(Math.max(...probs));
      const marketSummary = `top=${t.outcomes[topIdx]} (${(probs[topIdx] ?? 0).toFixed(2)})`;
      return `- [${t.id}] "${t.description}" — ${marketSummary}, participants: ${participantNames}${momentum}`;
    })
    .join("\n");

  // Key characters with continuity knowledge
  const keyCharacters = Object.values(narrative.characters)
    .filter((c) => c.role === "anchor" || c.role === "recurring")
    .slice(0, 10);

  const characters = keyCharacters
    .map((c) => {
      // Get character's accumulated knowledge
      const knowledgeNodes = Object.values(c.world.nodes)
        .filter(kn => timelineState.liveNodeIds.has(kn.id))
        .slice(-5); // Last 5 knowledge items
      const knowledge = knowledgeNodes.map(kn => kn.content).join("; ");
      const knowledgeStr = knowledge ? `\n    Knowledge: ${knowledge}` : "";
      return `- [${c.id}] ${c.name} (${c.role})${knowledgeStr}`;
    })
    .join("\n");

  // Key locations with continuity
  const keyLocations = Object.values(narrative.locations)
    .filter((l) => l.prominence === "domain" || l.prominence === "place")
    .slice(0, 8);

  const locations = keyLocations
    .map((l) => {
      const knowledgeNodes = Object.values(l.world.nodes)
        .filter(kn => timelineState.liveNodeIds.has(kn.id))
        .slice(-3);
      const knowledge = knowledgeNodes.map(kn => kn.content).join("; ");
      const knowledgeStr = knowledge ? ` — ${knowledge}` : "";
      return `- [${l.id}] ${l.name}${knowledgeStr}`;
    })
    .join("\n");

  // Key relationships with valence
  const keyCharacterIds = new Set(keyCharacters.map(c => c.id));
  const relationships = timelineState.relationships
    .filter(r => keyCharacterIds.has(r.from) && keyCharacterIds.has(r.to))
    .slice(0, 15)
    .map(r => {
      const fromName = narrative.characters[r.from]?.name ?? r.from;
      const toName = narrative.characters[r.to]?.name ?? r.to;
      const valenceLabel = r.valence <= -0.5 ? "hostile"
        : r.valence <= -0.1 ? "tense"
        : r.valence >= 0.5 ? "allied"
        : r.valence >= 0.1 ? "friendly"
        : "neutral";
      return `- ${fromName} → ${toName}: ${r.type} (${valenceLabel})`;
    })
    .join("\n");

  // System knowledge graph — principles, systems, constraints, tensions
  const keysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);
  const systemGraph = buildCumulativeSystemGraph(
    narrative.scenes, keysUpToCurrent, keysUpToCurrent.length - 1, narrative.worldBuilds,
  );
  const systemNodes = Object.values(systemGraph.nodes);
  const principles = systemNodes.filter(n => n.type === "principle").slice(0, 5);
  const systems = systemNodes.filter(n => n.type === "system").slice(0, 5);
  const constraints = systemNodes.filter(n => n.type === "constraint").slice(0, 4);
  const tensions = systemNodes.filter(n => n.type === "tension").slice(0, 4);

  const systemKnowledgeLines: string[] = [];
  // IDs included so system nodes can anchor via `systemNodeId`.
  const formatSystemEntry = (n: { id: string; concept: string }) => `[${n.id}] ${n.concept}`;
  if (principles.length > 0) {
    systemKnowledgeLines.push(`  Principles: ${principles.map(formatSystemEntry).join("; ")}`);
  }
  if (systems.length > 0) {
    systemKnowledgeLines.push(`  Systems: ${systems.map(formatSystemEntry).join("; ")}`);
  }
  if (constraints.length > 0) {
    systemKnowledgeLines.push(`  Constraints: ${constraints.map(formatSystemEntry).join("; ")}`);
  }
  if (tensions.length > 0) {
    systemKnowledgeLines.push(`  Tensions: ${tensions.map(formatSystemEntry).join("; ")}`);
  }
  const systemKnowledge = systemKnowledgeLines.length > 0
    ? systemKnowledgeLines.join("\n")
    : "";

  // Key artifacts with capabilities
  const artifacts = Object.values(narrative.artifacts ?? {})
    .filter(a => a.significance === "key" || a.significance === "notable")
    .slice(0, 6)
    .map(a => {
      const owner = timelineState.artifactOwnership[a.id] ?? a.parentId;
      const ownerName = owner ? resolveEntityName(narrative, owner) : "world";
      const capabilityNodes = Object.values(a.world.nodes)
        .filter(kn => timelineState.liveNodeIds.has(kn.id))
        .slice(-3);
      const capabilities = capabilityNodes.map(kn => kn.content).join("; ");
      const capStr = capabilities ? ` — ${capabilities}` : "";
      return `- [${a.id}] ${a.name} (${a.significance}, held by ${ownerName})${capStr}`;
    })
    .join("\n");

  // Recent scene summaries (last 8 scenes for context)
  const recentScenes = keysUpToCurrent
    .slice(-8)
    .map(k => {
      const entry = resolveEntry(narrative, k);
      if (entry?.kind !== "scene") return null;
      const povName = entry.povId ? (narrative.characters[entry.povId]?.name ?? entry.povId) : 'narrator';
      const locName = narrative.locations[entry.locationId]?.name ?? entry.locationId;
      return `- [${povName} @ ${locName}] ${entry.summary}`;
    })
    .filter(Boolean)
    .join("\n");

  // Build thread targets section with status and timing
  const threadTargetsSection = guidance.threadTargets?.length
    ? guidance.threadTargets.map(t => {
        const thread = narrative.threads[t.threadId];
        const desc = thread?.description ?? t.threadId;
        const timing = t.timing ? ` timing="${t.timing}"` : "";
        const outcome = t.marketOutcome ? ` outcome="${t.marketOutcome.replace(/"/g, '&quot;')}"` : "";
        return `      <thread-target thread-id="${t.threadId}" intent="${t.marketIntent}"${outcome}${timing}>${desc}</thread-target>`;
      }).join("\n")
    : "";

  // Arc target — exact number of arcs to plan (default 5)
  const arcTarget = guidance.arcTarget ?? 5;
  const activeThreadCount = threads.filter(t => !isThreadClosed(t) && !isThreadAbandoned(t)).length;
  const nodeGuidance = getPlanNodeGuidance(
    arcTarget,
    activeThreadCount,
    reasoningScale(guidance.reasoningLevel),
  );
  const userDirection = guidance.direction ?? "";
  const userConstraints = guidance.constraints ?? "";

  // Get patterns and anti-patterns
  const patterns = narrative.patterns ?? [];
  const antiPatterns = narrative.antiPatterns ?? [];

  const patternsSection = patterns.length > 0
    ? patterns.map((p) => `    <pattern>${p}</pattern>`).join("\n")
    : "";

  const antiPatternsSection = antiPatterns.length > 0
    ? antiPatterns.map((p) => `    <anti-pattern>${p}</anti-pattern>`).join("\n")
    : "";

  const prompt = buildCoordinationPlanPrompt({
    context: ctx,
    threadSummary,
    characters,
    locations,
    relationships,
    systemKnowledge,
    artifacts,
    recentScenes,
    patternsSection,
    antiPatternsSection,
    threadTargetsSection,
    userDirection,
    userConstraints,
    arcTarget,
    activeThreadCount,
    nodeGuidance,
    forcePreferenceBlockText: forcePreferenceBlock("plan", guidance.forcePreference),
    reasoningModeBlockText: reasoningModeBlock(guidance.reasoningMode),
    modeSection: buildActiveModeSection(narrative, "reasoning-plan"),
  });

  const reasoningBudget = defaultReasoningBudget(narrative);

  const raw = onReasoning
    ? await callGenerateStream(
        prompt,
        COORDINATION_PLAN_SYSTEM,
        () => {}, // No token streaming for main output
        undefined,
        "generateCoordinationPlan",
        PLANNING_MODEL,
        reasoningBudget,
        onReasoning,
      )
    : await callGenerate(
        prompt,
        COORDINATION_PLAN_SYSTEM,
        undefined,
        "generateCoordinationPlan",
        PLANNING_MODEL,
        reasoningBudget,
      );

  // Parse and validate (parseJson handles markdown fences)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = parseJson(raw, "generateCoordinationPlan") as any;

    const arcCount = typeof data.arcCount === "number" ? data.arcCount : arcTarget;

    // Validate and sanitize nodes. The JSON array position (original
    // emission order) becomes order — the order the reasoner
    // thought of each node. Captured BEFORE reindexing so the signature
    // of backward thinking modes survives the causal reindex below.
    const nodes: CoordinationNode[] = (data.nodes ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((n: any, i: number) => ({ n, order: i }))
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ n }: { n: any }) =>
          typeof n.id === "string" &&
          typeof n.index === "number" &&
          typeof n.type === "string" &&
          typeof n.label === "string",
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map(({ n, order }: { n: any; order: number }) => ({
        id: n.id,
        index: n.index, // Will be reindexed below
        order,
        type: VALID_COORDINATION_NODE_TYPES.has(n.type) ? n.type : "reasoning",
        label: typeof n.label === "string" ? n.label.slice(0, 100) : "",
        detail: typeof n.detail === "string" ? n.detail.slice(0, 300) : undefined,
        entityId: typeof n.entityId === "string" ? n.entityId : undefined,
        threadId: typeof n.threadId === "string" ? n.threadId : undefined,
        systemNodeId: typeof n.systemNodeId === "string" ? n.systemNodeId : undefined,
        marketIntent: typeof n.marketIntent === "string" ? n.marketIntent : undefined,
        marketOutcome: typeof n.marketOutcome === "string" ? n.marketOutcome : undefined,
        arcIndex: typeof n.arcIndex === "number" ? n.arcIndex : undefined,
        sceneCount: typeof n.sceneCount === "number" ? n.sceneCount : undefined,
        forceMode: typeof n.forceMode === "string" ? n.forceMode : undefined,
        arcSlot: typeof n.arcSlot === "number" ? n.arcSlot : undefined,
      }));

    // Reindex nodes chronologically by arcSlot
    // Arc 1 nodes get indexes 0, 1, 2..., Arc 2 continues from there, etc.
    // Global nodes (pattern/warning without arcSlot) go at the end
    const nodesWithArcSlot = nodes.filter(n => n.arcSlot !== undefined);
    const globalNodes = nodes.filter(n => n.arcSlot === undefined);

    // Sort by arcSlot first, then by original index within each arc
    nodesWithArcSlot.sort((a, b) => {
      if (a.arcSlot !== b.arcSlot) return (a.arcSlot ?? 0) - (b.arcSlot ?? 0);
      return a.index - b.index;
    });

    // Reassign indexes chronologically
    let newIndex = 0;
    for (const node of nodesWithArcSlot) {
      node.index = newIndex++;
    }
    for (const node of globalNodes) {
      node.index = newIndex++;
    }

    // Rebuild nodes array in new order (reindexed chronologically by arc)
    const reindexedNodes: CoordinationNode[] = [...nodesWithArcSlot, ...globalNodes];

    // Validate edges
    const nodeIds = new Set(reindexedNodes.map((n) => n.id));
    const edges: CoordinationEdge[] = (data.edges ?? [])
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) =>
          typeof e.id === "string" &&
          typeof e.from === "string" &&
          typeof e.to === "string" &&
          typeof e.type === "string" &&
          VALID_EDGE_TYPES.has(e.type),
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e: any) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        type: e.type as ReasoningEdgeType,
        label: typeof e.label === "string" ? e.label.slice(0, 100) : undefined,
      }))
      .filter((e: CoordinationEdge) => nodeIds.has(e.from) && nodeIds.has(e.to));

    // Build arc partitions — nodes grouped by arcSlot
    const arcPartitions: string[][] = [];
    for (let arc = 1; arc <= arcCount; arc++) {
      // Cumulative: all nodes with arcSlot <= arc
      const partition = reindexedNodes
        .filter((n) => n.arcSlot !== undefined && n.arcSlot <= arc)
        .map((n) => n.id);
      // Also include pattern/warning/chaos agent nodes without arcSlot
      // (creative agents can be global to the plan).
      const globalAgentNodes = reindexedNodes
        .filter(
          (n) =>
            n.arcSlot === undefined &&
            (n.type === "pattern" ||
              n.type === "warning" ||
              n.type === "chaos"),
        )
        .map((n) => n.id);
      arcPartitions.push([...new Set([...partition, ...globalAgentNodes])]);
    }

    const plan: CoordinationPlan = {
      id: `plan-${Date.now()}`,
      nodes: reindexedNodes,
      edges,
      arcCount,
      summary: typeof data.summary === "string" ? data.summary : "Coordination plan",
      arcPartitions,
      currentArc: 0,
      completedArcs: [],
      createdAt: Date.now(),
    };
    // Derive forceMode for each arc anchor from node composition. We don't
    // trust the LLM to label this correctly — it falls out of what was planned.
    return applyDerivedForceModes(plan);
  } catch (err) {
    logError("Failed to parse coordination plan", err, {
      source: "world-expansion",
      operation: "coordination-plan-parse",
    });
    // Return minimal fallback
    return {
      id: `plan-${Date.now()}`,
      nodes: [
        {
          id: "ERR",
          index: 0,
          type: "reasoning",
          label: "Plan generation failed",
          detail: String(err),
        },
      ],
      edges: [],
      arcCount: 1,
      summary: "Failed to generate coordination plan",
      arcPartitions: [["ERR"]],
      currentArc: 0,
      completedArcs: [],
      createdAt: Date.now(),
    };
  }
}

/**
 * Build a sequential path for a specific arc from the coordination plan.
 * Only includes nodes visible to that arc (arcSlot <= arcIndex).
 */
export function buildPlanPathForArc(plan: CoordinationPlan, arcIndex: number): string {
  const visibleNodeIds = new Set(plan.arcPartitions[arcIndex - 1] ?? []);
  const visibleNodes = plan.nodes.filter((n) => visibleNodeIds.has(n.id));
  const visibleEdges = plan.edges.filter(
    (e) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to),
  );

  // Use the same format as buildSequentialPath
  return buildSequentialPath({ nodes: visibleNodes, edges: visibleEdges });
}
