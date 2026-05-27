/**
 * Preference-driven prompt blocks: force preference, network bias, and the
 * coordination-plan node-count guidance. All emit prompt text based on
 * setting inputs; none do any LLM calls.
 */

import type { ThinkingResource } from "@/lib/ai/reasoning-graph/shared";
import { PROMPT_BELIEF_PRINCIPLES } from "../core/belief-calibration";

// ── Plan Node Scaling ─────────────────────────────────────────────────────────
// Coordination plans scale node counts based on arc budget to ensure proper
// reasoning depth. Spine = peaks + valleys + moments; every arc has exactly
// one peak OR one valley as its anchor (carrying arcIndex, sceneCount,
// forceMode), and moments are supporting beats.

/**
 * Calculate expected node counts for a coordination plan based on arc budget.
 * Returns guidance for minimum nodes per category. Emphasizes DEPTH (chains
 * of reasoning) not just BREADTH (many disconnected nodes).
 */
export function getPlanNodeGuidance(
  arcTarget: number,
  threadCount: number,
  scale: number = 1,
): {
  minSpineNodes: number;
  minReasoningNodes: number;
  minPatterns: number;
  minWarnings: number;
  minChaos: number;
  minCharacterNodes: number;
  minLocationNodes: number;
  minArtifactNodes: number;
  minSystemNodes: number;
  minChainDepth: number;
  minEdges: number;
  totalMin: number;
} {
  const s = (n: number) => Math.max(1, Math.round(n * scale));

  // Spine: anchor per arc + supporting moments + thread-progression nodes.
  const minSpineNodes = s(Math.floor(arcTarget * 2.5) + threadCount);
  // Reasoning backbone: branched, not chained. Floor of 10 for tiny plans.
  const minReasoningNodes = s(Math.max(10, arcTarget * 3 + Math.floor(threadCount * 2)));
  const minPatterns = s(Math.max(2, Math.floor(arcTarget / 2)));
  const minWarnings = s(Math.max(2, Math.floor(arcTarget / 2)));
  // Chaos baseline 1-2 even when balanced; chaos preference bumps further.
  const minChaos = s(Math.max(1, Math.floor(arcTarget / 4)));
  const minCharacterNodes = s(Math.max(4, threadCount));
  const minLocationNodes = s(Math.max(3, Math.ceil(arcTarget / 2)));
  const minArtifactNodes = s(Math.max(1, Math.floor(arcTarget / 3)));
  const minSystemNodes = s(Math.max(3, Math.floor(arcTarget / 2)));
  const minChainDepth = s(Math.max(3, Math.floor(arcTarget / 2)));

  const totalMin =
    minSpineNodes +
    minReasoningNodes +
    minPatterns +
    minWarnings +
    minChaos +
    minCharacterNodes +
    minLocationNodes +
    minArtifactNodes +
    minSystemNodes;

  // Branched graph has ~1.6× more edges than nodes.
  const minEdges = Math.round(totalMin * 1.6);

  return {
    minSpineNodes,
    minReasoningNodes,
    minPatterns,
    minWarnings,
    minChaos,
    minCharacterNodes,
    minLocationNodes,
    minArtifactNodes,
    minSystemNodes,
    minChainDepth,
    minEdges,
    totalMin,
  };
}

/** Shared model block — the engine's three-force authorial reasoning frame.
 *  Same content for every preference variant; extracted once for clarity. */
const MODEL_BLOCK = `
  <model>
    <author-meta-reasoning>The graph is the AUTHOR's meta-reasoning about the work — cause-and-effect structure: upstream causes, downstream effects. Direction is the primary semantic signal — opposite causal positions assert opposite claims.</author-meta-reasoning>

    <structural-forces hint="Three forces run through the work.">
      <force name="fate">Current momentum — what threads demand. Default OS: what's in motion continues, what's promised pays off.</force>
      <force name="world">Character, location, artifact change. Entities deepen, bonds shift, things accrue history.</force>
      <force name="system">Rules and principles that constrain fate and world.</force>
    </structural-forces>

    <chaos-as-black-swan hint="Departure from what current state predicts. Two modes; either or both can drive a chaos node.">
      <mode name="creative">Spawns pieces the existing state wouldn't have generated — unforeseen rival, faction nobody modelled, disruptive artefact, location's hidden property.</mode>
      <mode name="reversal">Flips a saturating/committed stance via twist-grade event (|e| ≥ 3 on the lagging outcome).</mode>
      <test>Could it have been in the rulebook before this moment? Yes → adversarial system node. No → chaos. Name what it creates OR flips concretely; "something surprising" without a target is vapour.</test>
      <ever-present>Required at minority level (1-2 nodes) in every mode, structural in chaos mode. Zero-chaos graphs read as narratively dead.</ever-present>
    </chaos-as-black-swan>

    <fate-as-portfolio hint="The CRG is where market quality is decided — by the time scenes are written, the hand is dealt.">
      Fate nodes ARE the arc's market portfolio. A defensive, all-distal, all-anchor-centric, or cost-missing portfolio produces an inert arc. Audit against the principles below; if it fails, the fix is new fate nodes (open markets, force opposition, retire zombies) — not better execution.
      ${PROMPT_BELIEF_PRINCIPLES}
    </fate-as-portfolio>

    <causal-patterns hint="Cross-direction edges encode which pattern is asserted.">
      <pattern name="default" shape="reason→fate">Deliberation advances the agenda.</pattern>
      <pattern name="chaos-as-cause" shape="chaos→reasoning">Disruption forces adaptation.</pattern>
      <pattern name="chaos-chain" shape="chaos→chaos→chaos">One disruption spawns the next (an unanticipated arrival → participants disperse → an anchor entity ends up isolated).</pattern>
      <pattern name="subversion" shape="fate→chaos">Agenda inadvertently produces its own disruption (an anchor's overreach → engages an opposing position alone → reveal). Highly productive.</pattern>
      <pattern name="adaptation" shape="chaos→reasoning/character→fate">Work absorbs disruption into a new or subverted thread.</pattern>
    </causal-patterns>

    <creation-flavor hint="Every mode can create new entities; the flavor matches the master.">
      Fate creations extend the agenda (entities or artifacts that the existing thread structure was already pointing toward). World creations grow from existing entities (descendants, successors, newly-surfaced sub-locations of established places). System creations extend rules (new principles consistent with established ones). Chaos creations are creative or reversal events.
    </creation-flavor>

    <bad-graph-signals>Failing graph: disconnected components; dominant force out-numbered by its complement; zero chaos; chaos with only incoming \`requires\` edges (serviced, not driving); contrived subversion upstream; cross-direction edges flowing one way in balanced mode; system nodes with no outgoing edges (lore dumps); new entities un-rooted in existing context (drop-ins).</bad-graph-signals>
  </model>`;

/**
 * Build a force-preference guidance block for the prompt. Freeform (or
 * undefined) yields the narrative-quality-first block with no force bias.
 */
export function forcePreferenceBlock(
  scope: "arc" | "plan",
  pref: ThinkingResource | undefined,
): string {
  const scopeLower = scope === "plan" ? "plan" : "arc";

  if (!pref || pref === "freeform") {
    return `<force-preference name="freeform" scope="${scopeLower}">
  <master>The narrative itself — quality of the ${scopeLower} is the only bias.</master>
  <flavor>Adaptive, situational. Picks whatever the narrative earns, beat by beat.</flavor>
${MODEL_BLOCK}
  <narrative-quality-first>
    No force bias. Pick the node mix the narrative serves. Toolbox: <tool name="fate">thread advancing</tool>; <tool name="character/location/artifact">entity world graph grows</tool>; <tool name="system">rule, reuse SYS-XX or introduce new connected to one</tool>; <tool name="chaos">creative spawn or reversal flip</tool>; <tool name="reasoning">explicit logical step linking nodes</tool>; <tool name="pattern/warning">patterns to reinforce, anti-patterns to avoid</tool>.
    All-one-type reads thin. Forces should CAUSE each other — system rule ENABLES character choice that ADVANCES a fate thread. Every node earns its place via an edge.
  </narrative-quality-first>
</force-preference>`;
  }

  if (pref === "fate") {
    return `<force-preference name="fate-dominant" scope="${scopeLower}">
  <master>Fate, amplified. Expands the fate layer.</master>
  <flavor>Inevitability, momentum, gravitational pull. Beats feel like they had to happen.</flavor>
${MODEL_BLOCK}
  <what-fate-dominance-means>
    <dominance>Fate clearly out-numbers every other force. Tighten the web of threads, concentrate momentum, let the current agenda carry the ${scopeLower}.</dominance>
    <directive>
      <rule>Every fate node references an existing threadId + targetStatus it advances toward. Read each thread's recent log entries.</rule>
      <rule>Favour threads at \`escalating\` or \`critical\` — strongest momentum to convert.</rule>
      <rule>Fate is creative — anticipated arrivals, prefigured entities, latent artefacts surfacing. New pieces extend what's in motion.</rule>
      <rule>Peak/valley anchors are thread transitions: peak = critical→resolved on a load-bearing thread; valley = escalating pulse that refuses to break.</rule>
    </directive>
    <chaos-minority>1-2 chaos nodes stress-testing fate's agenda — puncture without redirecting.</chaos-minority>
    <support-forces>Character: thread-carriers serving fate. System: constraints that make the journey hard.</support-forces>
  </what-fate-dominance-means>
</force-preference>`;
  }
  if (pref === "world") {
    return `<force-preference name="world-dominant" scope="${scopeLower}">
  <master>World (character/location/artifact transformation). Expands the world layer.</master>
  <flavor>Intimate, transformative, grounded. People and places becoming something new.</flavor>
${MODEL_BLOCK}
  <what-world-dominance-means>
    <dominance>Character/location/artifact nodes clearly out-number every other force. Inner change, shifting bonds, places accruing meaning, objects gaining history. Fate still operates underneath as OS.</dominance>
    <directive>
      <rule>Each world node either references existing entityId (naming which world-graph nodes this beat extends or contradicts) or INTRODUCES a new entity growing from what's there — descendant or successor of an existing entity, newly-surfaced sub-location of an established place, derived artefact. Drop-ins are chaos, not world.</rule>
      <rule>Favour entities with rich existing world graphs — more material to riff on. Thin-graph entities are best anchored when the beat is the one where the graph substantially grows.</rule>
      <rule>Relationship deltas, POV-character world deltas, location-tied transformations are the core currency.</rule>
    </directive>
    <chaos-touch>Some entity arcs can be chaos-touched: growth against the grain, disruptive new meaning, unsettling property surfacing. Contrast keeps the ${scopeLower} from reading programmatic.</chaos-touch>
    <support-forces>Fate: consequence of character change — thread moves BECAUSE someone changed. System: constraints that force the change.</support-forces>
  </what-world-dominance-means>
</force-preference>`;
  }
  if (pref === "system") {
    return `<force-preference name="system-dominant" scope="${scopeLower}">
  <master>System (rules, principles, mechanics). Expands the system layer.</master>
  <flavor>Lawful, consequential, testing. The world's rules asserting themselves.</flavor>
${MODEL_BLOCK}
  <what-system-dominance-means>
    <dominance>System clearly out-numbers every other force. Surface existing rules AND extend with new principles, institutions, or domains following from what's established.</dominance>
    <directive>
      <rule>Each system node either reuses an existing SYS-XX (extending with a new edge/implication), introduces a new rule connected to an existing concept, or introduces a new institution/faction/domain extending the rule-layer. Free-floating lore dumps disconnected from the existing graph are failure.</rule>
      <rule>Downstream nodes (fate/character/chaos/reasoning) DEPEND on system nodes — \`requires\`/\`enables\`/\`constrains\` edges point system → consequences. System node with no outgoing edge wasn't used.</rule>
      <rule>Read the existing cumulative system graph first; test, stress, or exploit established principles before adding new ones.</rule>
    </directive>
    <chaos-cracks>Show rules creating cracks chaos slips through: loopholes, unintended consequences, limits cutting both ways. Rules-only-enable-one-side reads rigged.</chaos-cracks>
    <support-forces>Character: system-testers discovering what rules mean. Fate: thread moves BECAUSE the rule said so.</support-forces>
  </what-system-dominance-means>
</force-preference>`;
  }
  if (pref === "chaos") {
    return `<force-preference name="chaos-dominant" scope="${scopeLower}">
  <master>Chaos — black-swan reasoning leads. Where the agenda meets what it didn't plan for.</master>
  <flavor>Disciplined red-team. Output: a portfolio of unpriced moves, not generalised disruption.</flavor>
${MODEL_BLOCK}
  <what-chaos-dominance-means>
    <dominance>Chaos clearly out-numbers every other force. Mix creative + reversal registers — only-creative or only-reversal reads thin. A single chaos node may do both (a new rival arriving IS the event that flips the threat thread).</dominance>
    <target-saturating-markets>Reversal has highest info-value where confidence is highest: flipping p=0.90 leader re-prices far more than 55/45 contested. Scan for saturating threads (p ≥ 0.85), committed threads (p ≥ 0.65 low volatility), and "succeeds without cost / undetected / free" leaders — phantom-saturation candidates ripe for reversal.</target-saturating-markets>
    <legibility hint="Each chaos node must be legible.">
      Creative mode: what is introduced that the prior state wouldn't generate; which market(s) the new piece perturbs. Reversal mode: target market, current leader, event that flips it, lagging outcome the event re-prices toward. Absent legible creative addition OR reversal thesis, the node is vapour.
    </legibility>
    <not-arbitrary-rescue>Black swan ≠ arbitrary rescue. Chaos events are surprising TO THE MARKET but CONSISTENT WITH the world's rules and the narrative's buried setup. An unauthorised crossing of a guarded boundary = chaos (the system has buried cracks). An external authority unilaterally settling the contest from outside the established frame = arbitrary rescue.</not-arbitrary-rescue>
    <chaos-as-cause>Chaos sits upstream driving downstream adaptation. Chaos→chaos chaining is core (one black swan re-prices several markets in sequence).</chaos-as-cause>
    <fate-roles>Downstream: threads chaos is re-pricing or newly opening. Upstream-subversion: agenda's overreach priming its own reversal (an anchor's overreach → engages an opposing position alone → reveal flips "evades detection" market). Highly productive.</fate-roles>
    <behaviour>
${scope === "plan"
  ? `      Several chaos-dominant arcs across the plan (~25-40% of arcs anchored on chaos). Seed 5-10 chaos nodes mixing creative + reversal. Chaos-dominant arcs leave the portfolio MORE uncertain after resolving — new threads open, or saturating stances close decisively/flip.`
  : `      Build around 3-5 chaos nodes (vs default 1-2). The arc's peak/valley may itself be chaos-anchored. Chaos nodes collectively add a new piece OR identify a saturating market ready for reversal — ideally both.`}
    </behaviour>
  </what-chaos-dominance-means>
</force-preference>`;
  }
  return "";
}

/**
 * Build a network-bias guidance block. The annotation legend and NETWORK
 * STATE summary are already rendered above AVAILABLE ENTITIES, so this
 * block only adds the per-mode preference. Returns "" for neutral.
 */
export function networkBiasBlock(bias: "inside" | "outside" | "neutral" | undefined): string {
  if (!bias || bias === "neutral") return "";
  if (bias === "inside") {
    return `<network-bias name="inside-the-box" hint="Conventional — lean into the gravitational centres.">
  The {hot, rising, bridge} cohort is load-bearing — compound it. The {warm, hub} cohort is consistent material — deepen it. Anchor selections in nodes whose tier is hot or warm AND trajectory is rising or steady. Prefer bridges (cross-force connectors) over leaves; bridges already carry weight across cohorts. {cooling} nodes are revival candidates when their force-anchor matches what this arc needs; {plateaued} nodes need a fresh angle. Reach for {cold, dormant, isolated} only when structurally required. Reusing what already matters is how a narrative compounds.
</network-bias>`;
  }
  return `<network-bias name="outside-the-box" hint="Unique with respect to current pattern — reactivate the neglected matter.">
  Two cohorts deserve attention: fresh-rising (recently planted nodes that haven't compounded — picking them up turns seeds into structure) and cold-dormant-with-anchor (long-dormant nodes already on a known force axis — easier to integrate than starting from nothing). Prefer cold or fresh nodes for character/location/artifact/thread/system selections. {leaf} nodes are easy entry points; {isolated} nodes need a bridge built through this arc. {hot} entities allowed when structurally unavoidable but should NOT anchor the reasoning. The goal is reactivating neglected matter, not contrarianism.
</network-bias>`;
}
