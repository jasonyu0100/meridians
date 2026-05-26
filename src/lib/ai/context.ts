import type { NarrativeState, NarrativeParadigm, Scene, StorySettings, RelationshipEdge, ProseProfile, SystemGraph } from '@/types/narrative';
import { resolveEntry, NARRATOR_AGENT_ID, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { buildCumulativeSystemGraph, getMarketBelief, getMarketMargin, getMarketProbs, isThreadAbandoned, isThreadClosed, rankSystemNodes, resolveEntityName, scenesSinceTouched, softmax, updateLogits } from '@/lib/narrative-utils';
import { classifyThreadCategory, computeRecentLogitEnergy } from '@/lib/thread-category';
import { ENTITY_LOG_CONTEXT_LIMIT, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE } from '@/lib/constants';
import { getIntroducedIds } from '@/lib/scene-filter';
import { describeTimeGap, formatTimeDelta } from '@/lib/time-deltas';
import { aggregateNetworkGraph, buildTierLookup, type NetworkNode } from '@/lib/network-graph';
import { getActiveMode } from '@/lib/mode-graph';
import { buildSequentialPath } from '@/lib/prompts/reasoning/sequential-path';
import {
  ELO_INITIAL,
  eloUpdate,
  gameMarginScore,
  gameScoreA,
  nashEquilibria,
  realizedIsNash,
  realizedOutcome,
  stakeRank,
} from '@/lib/game-theory';

// ── Prose Profile Builder ─────────────────────────────────────────────────────

/**
 * Build prose profile as plain text for LLM context.
 */
export function buildProseProfile(profile: ProseProfile, options?: { beatDensity?: number }): string {
  const parts: string[] = [];

  // Voice characteristics as a single line
  const voice: string[] = [];
  if (profile.register) voice.push(profile.register);
  if (profile.stance) voice.push(profile.stance);
  if (profile.tense) voice.push(profile.tense);
  if (profile.sentenceRhythm) voice.push(profile.sentenceRhythm);
  if (profile.interiority) voice.push(`${profile.interiority} interiority`);
  if (profile.dialogueWeight) voice.push(`${profile.dialogueWeight} dialogue`);
  if (voice.length) parts.push(`Voice: ${voice.join(', ')}`);

  if (profile.devices?.length) {
    parts.push(`Devices: ${profile.devices.join(', ')}`);
  }
  if (profile.rules?.length) {
    parts.push(`Rules: ${profile.rules.join('; ')}`);
  }
  if (profile.antiPatterns?.length) {
    parts.push(`Avoid: ${profile.antiPatterns.join('; ')}`);
  }
  if (options?.beatDensity != null) {
    parts.push(`Density reference: ~${options.beatDensity} beats/kword (a soft signal — choose only as many beats as the scene needs)`);
  }

  return `PROSE PROFILE\n${parts.join('\n')}`;
}

/**
 * Replay deltas up to a given timeline index to get the state at that point.
 * Returns which continuity nodes exist, relationship states, thread statuses,
 * and artifact ownership at the specified position in the timeline.
 */

// ── Tiered scene-history resolution ───────────────────────────────────────────
// Scene history is rendered at progressively lower resolution the further back
// a scene sits from the current one. The floor is a scene summary (plus POV /
// location) — we never drop a scene entirely. Important scenes (thread
// transitions into or out of a load-bearing status) are promoted one tier so
// critical beats survive aggressive truncation in long narratives.
//
// To add a tier: extend `RecencyTier`, add a row to `TIER_FIELDS`, and update
// `classifyTier`. `renderSceneEntry` reads TIER_FIELDS and needs no changes.

export type RecencyTier = 'near' | 'mid' | 'far';

/** Which delta categories each tier reveals. Lower tiers strictly include the floor. */
interface TierFields {
  participants: boolean;
  threadTransitions: boolean;
  movements: boolean;          // tieDeltas (characters entering/leaving locations)
  worldDeltas: boolean;
  relationshipShifts: boolean;
  artifactUsages: boolean;
  ownershipChanges: boolean;
}

const TIER_FIELDS: Record<RecencyTier, TierFields> = {
  near: { participants: true,  threadTransitions: true,  movements: true,  worldDeltas: true,  relationshipShifts: true,  artifactUsages: true,  ownershipChanges: true  },
  // Mid drops participants — thread-transition names already imply who's present.
  mid:  { participants: false, threadTransitions: true,  movements: true,  worldDeltas: false, relationshipShifts: false, artifactUsages: false, ownershipChanges: false },
  far:  { participants: false, threadTransitions: false, movements: false, worldDeltas: false, relationshipShifts: false, artifactUsages: false, ownershipChanges: false },
};

/** Pick a tier from distance-to-current. Pure distance — no per-scene promotion. */
export function classifyTier(
  distanceFromCurrent: number,
  nearZone: number,
  midZone: number,
): RecencyTier {
  if (distanceFromCurrent < nearZone) return 'near';
  if (distanceFromCurrent < nearZone + midZone) return 'mid';
  return 'far';
}

/**
 * Return the tier a knowledge or log node belongs to, based on the scene it
 * was introduced in. Seed nodes (introduced by a pre-timeline world build or
 * otherwise untracked) are treated as 'seed' and always kept.
 */
export function tierOfOrigin(
  sceneOriginIndex: number | undefined,
  totalScenes: number,
  nearZone: number,
  midZone: number,
): RecencyTier | 'seed' {
  if (sceneOriginIndex === undefined) return 'seed';
  return classifyTier(totalScenes - 1 - sceneOriginIndex, nearZone, midZone);
}

/** Render a single scene at the given tier. Fields are gated by TIER_FIELDS. */
function renderSceneEntry(
  n: NarrativeState,
  s: Scene,
  globalIdx: number,
  tier: RecencyTier,
  isPresent: boolean = false,
): string {
  const fields = TIER_FIELDS[tier];
  const loc = n.locations[s.locationId]?.name ?? s.locationId;
  const povName = s.povId ? (n.characters[s.povId]?.name ?? s.povId) : 'narrator';
  // Compact time-gap so the planner/writer can see pacing across history —
  // e.g. "3 hours", "2 weeks", "concurrent", "back 5 years". Rich guidance is
  // still surfaced on the active scene via sceneContext's <time-gap> block.
  // The transition phrase, when supplied, is also exposed so downstream
  // passes can read pacing AND the natural-language flow word-for-word.
  const timeGap = s.timeDelta ? formatTimeDelta(s.timeDelta) : '';
  const timeGapAttr = timeGap ? ` time-gap="${timeGap}"` : '';
  const transitionPhrase = s.timeDelta?.transition?.trim();
  const transitionAttr = transitionPhrase ? ` transition="${transitionPhrase.replace(/"/g, '&quot;')}"` : '';
  // `present="true"` marks the cursor's current scene — the latest state.
  // Any "now" claim should anchor against this entry rather than infer from
  // list position.
  const presentAttr = isPresent ? ` present="true"` : '';

  // Stable scene metadata stays on the <entry> tag; all deltas become child
  // elements so the output is structured XML, not a pile of semicolon-joined
  // attribute strings.
  const openAttrs = `index="${globalIdx}" tier="${tier}" location="${loc}" pov="${povName}"${timeGapAttr}${transitionAttr}${presentAttr}`;

  const children: string[] = [];

  children.push(`  <summary>${s.summary}</summary>`);

  if (fields.participants) {
    const parts = s.participantIds
      .map((pid) => {
        const p = n.characters[pid];
        if (!p) return `    <participant id="${pid}" />`;
        return `    <participant id="${p.id}" name="${p.name}" role="${p.role}" />`;
      });
    if (parts.length > 0) children.push(`  <participants>\n${parts.join('\n')}\n  </participants>`);
  }

  // <threads> child intentionally omitted from per-scene entries — the
  // per-thread <log> blocks (rendered separately under <threads>) already
  // carry every delta with full event-type annotation. Re-emitting the same
  // information here would duplicate context and waste tokens.

  if (fields.worldDeltas && s.worldDeltas.length > 0) {
    const lines = s.worldDeltas.flatMap((km) => {
      const entityName = n.characters[km.entityId]?.name
        ?? n.locations[km.entityId]?.name
        ?? n.artifacts[km.entityId]?.name
        ?? km.entityId;
      return (km.addedNodes ?? []).map((node) =>
        `    <fact entity="${entityName}" type="${node.type}">${node.content}</fact>`,
      );
    });
    if (lines.length > 0) children.push(`  <continuity>\n${lines.join('\n')}\n  </continuity>`);
  }

  if (fields.relationshipShifts && s.relationshipDeltas.length > 0) {
    const lines = s.relationshipDeltas.map((rm) => {
      const fromName = n.characters[rm.from]?.name ?? rm.from;
      const toName = n.characters[rm.to]?.name ?? rm.to;
      const sign = rm.valenceDelta >= 0 ? '+' : '';
      const delta = `${sign}${Math.round(rm.valenceDelta * 100) / 100}`;
      return `    <shift from="${fromName}" to="${toName}" delta="${delta}">${rm.type}</shift>`;
    });
    children.push(`  <relationships>\n${lines.join('\n')}\n  </relationships>`);
  }

  if (fields.ownershipChanges && (s.ownershipDeltas ?? []).length > 0) {
    const lines = s.ownershipDeltas!.map((om) => {
      const artName = n.artifacts?.[om.artifactId]?.name ?? om.artifactId;
      const fromName = n.characters[om.fromId]?.name ?? n.locations[om.fromId]?.name ?? om.fromId;
      const toName = n.characters[om.toId]?.name ?? n.locations[om.toId]?.name ?? om.toId;
      return `    <transfer artifact="${artName}" from="${fromName}" to="${toName}" />`;
    });
    children.push(`  <artifact-transfers>\n${lines.join('\n')}\n  </artifact-transfers>`);
  }

  if (fields.artifactUsages && (s.artifactUsages ?? []).length > 0) {
    const lines = s.artifactUsages!.map((au) => {
      const artName = n.artifacts?.[au.artifactId]?.name ?? au.artifactId;
      const charName = au.characterId ? (n.characters[au.characterId]?.name ?? au.characterId) : '';
      const charAttr = charName ? ` character="${charName}"` : '';
      const inner = au.usage ?? '';
      return inner
        ? `    <usage artifact="${artName}"${charAttr}>${inner}</usage>`
        : `    <usage artifact="${artName}"${charAttr} />`;
    });
    children.push(`  <artifact-usages>\n${lines.join('\n')}\n  </artifact-usages>`);
  }

  if (fields.movements && (s.tieDeltas ?? []).length > 0) {
    const lines = s.tieDeltas!.map((mm) => {
      const locName = n.locations[mm.locationId]?.name ?? mm.locationId;
      const charName = n.characters[mm.characterId]?.name ?? mm.characterId;
      return `    <tie character="${charName}" action="${mm.action}" location="${locName}" />`;
    });
    children.push(`  <ties>\n${lines.join('\n')}\n  </ties>`);
  }

  return `<entry ${openAttrs}>\n${children.join('\n')}\n</entry>`;
}

export function getStateAtIndex(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): {
  /** Continuity node IDs that existed at this point (added and not removed) */
  liveNodeIds: Set<string>;
  /** Relationship states at this point (replayed from deltas) */
  relationships: RelationshipEdge[];
  /** Artifact ownership at this point (artifactId -> ownerId) */
  artifactOwnership: Record<string, string | null>;
} {
  const keysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);

  // Replay world deltas to get accumulated node IDs (additive only)
  const liveNodeIds = new Set<string>();
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind !== 'scene') continue;
    for (const km of entry.worldDeltas) {
      for (const node of km.addedNodes ?? []) {
        if (node.id) liveNodeIds.add(node.id);
      }
    }
  }

  // Replay relationship deltas to get state at this point
  const relMap = new Map<string, RelationshipEdge>();
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (entry?.kind !== 'scene') continue;
    for (const rm of entry.relationshipDeltas) {
      const key = `${rm.from}:${rm.to}`;
      const existing = relMap.get(key);
      if (existing) {
        relMap.set(key, {
          ...existing,
          type: rm.type,
          valence: Math.max(-1, Math.min(1, existing.valence + rm.valenceDelta)),
        });
      } else {
        relMap.set(key, {
          from: rm.from,
          to: rm.to,
          type: rm.type,
          valence: Math.max(-1, Math.min(1, rm.valenceDelta)),
        });
      }
    }
  }

  // Thread market state is read live from narrative.threads (the reducer
  // applies threadDeltas on dispatch, so `n.threads` already reflects beliefs
  // as of the current head). No per-index replay needed for the market model.

  // Replay artifact ownership: start with initial parentIds from worldBuilds, then apply ownershipDeltas
  const artifactOwnership: Record<string, string | null> = {};
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    // WorldBuilds introduce artifacts with initial parentIds
    if (entry?.kind === 'world_build') {
      for (const a of entry.expansionManifest.newArtifacts ?? []) {
        artifactOwnership[a.id] = a.parentId;
      }
    }
    // Scenes can transfer ownership
    if (entry?.kind === 'scene') {
      for (const om of entry.ownershipDeltas ?? []) {
        artifactOwnership[om.artifactId] = om.toId;
      }
    }
  }

  return {
    liveNodeIds,
    relationships: [...relMap.values()],
    artifactOwnership,
  };
}

// Thread prediction-market documentation — what the LLM needs to know about
// how threads are tracked now. Binary and multi-outcome threads share the
// same shape; binary just happens to have outcomes = ["yes", "no"].
export const THREAD_LIFECYCLE_DOC = `Threads are prediction markets over named outcomes. State = (probability distribution via softmax(logits), volume, volatility). A market closes when one outcome's logit margin over the runner-up exceeds the closure threshold AND the closing scene emits a payoff or twist with |evidence| ≥ 3. A market is abandoned when volume decays below the floor (untouched threads lose volume each scene). Neither closed nor abandoned threads consume generation pressure.`;

/**
 * Build system knowledge block from SystemGraph.
 * Consolidates what was previously split between rules[] and worldSystems[].
 *
 * Node types map to:
 * - principle: Fundamental truths (laws, axioms, magic rules)
 * - system: Organized mechanisms (governance, ecosystems, magic systems)
 * - constraint: Hard limits (scarcity, costs, boundaries)
 * - convention: Norms (customs, practices, etiquette)
 * - Other types included for completeness
 */
function buildSystemKnowledgeBlock(graph: SystemGraph, tierLookup?: Map<string, NetworkNode>): string {
  const nodes = Object.values(graph.nodes);
  if (nodes.length === 0) return '';
  const attrs = (id: string): string => tierLookup ? networkAttrs(tierLookup.get(id)) : '';

  // Group nodes by type
  const byType: Record<string, typeof nodes> = {};
  for (const node of nodes) {
    if (!byType[node.type]) byType[node.type] = [];
    byType[node.type].push(node);
  }

  // Build adjacency for showing connections — reference target IDs, not target
  // text. The target concept is already written once on its own node; inlining
  // the full text per edge can duplicate the block several times over. Edges
  // are directional, but for each edge we also record the reverse so both
  // endpoints surface the connection (matches the prior flat "connects" attr).
  const connections: Record<string, string[]> = {};
  let validEdgeCount = 0;
  for (const edge of graph.edges) {
    const fromNode = graph.nodes[edge.from];
    const toNode = graph.nodes[edge.to];
    if (!fromNode || !toNode) continue;
    validEdgeCount++;
    if (!connections[edge.from]) connections[edge.from] = [];
    connections[edge.from].push(`${edge.relation}→${edge.to}`);
    if (!connections[edge.to]) connections[edge.to] = [];
    connections[edge.to].push(`←${edge.relation} ${edge.from}`);
  }

  const sections: string[] = [];

  // Principles first (these are the "rules")
  if (byType['principle']?.length) {
    const lines = byType['principle'].map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <principle id="${n.id}"${attrs(n.id)}>${n.concept}${connStr}</principle>`;
    });
    sections.push(`<principles hint="Fundamental truths. Must be obeyed.">\n${lines.join('\n')}\n</principles>`);
  }

  // Systems (organized mechanisms)
  if (byType['system']?.length) {
    const lines = byType['system'].map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <system id="${n.id}"${attrs(n.id)}>${n.concept}${connStr}</system>`;
    });
    sections.push(`<systems hint="Organized mechanisms. Drive conflict and reward preparation.">\n${lines.join('\n')}\n</systems>`);
  }

  // Constraints (hard limits)
  if (byType['constraint']?.length) {
    const lines = byType['constraint'].map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <constraint id="${n.id}"${attrs(n.id)}>${n.concept}${connStr}</constraint>`;
    });
    sections.push(`<constraints hint="Hard limits. Costs, scarcity, boundaries. Cannot be ignored.">\n${lines.join('\n')}\n</constraints>`);
  }

  // Tensions (unresolved forces)
  if (byType['tension']?.length) {
    const lines = byType['tension'].map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <tension id="${n.id}"${attrs(n.id)}>${n.concept}${connStr}</tension>`;
    });
    sections.push(`<tensions hint="Unresolved contradictions. Sources of conflict.">\n${lines.join('\n')}\n</tensions>`);
  }

  // Other types grouped together
  const otherTypes = ['concept', 'event', 'structure', 'environment', 'convention'];
  const otherNodes = otherTypes.flatMap((t) => byType[t] ?? []);
  if (otherNodes.length > 0) {
    const lines = otherNodes.map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <node type="${n.type}" id="${n.id}"${attrs(n.id)}>${n.concept}${connStr}</node>`;
    });
    sections.push(`<world-knowledge hint="Additional established facts.">\n${lines.join('\n')}\n</world-knowledge>`);
  }

  if (sections.length === 0) return '';

  return `\n<system-graph nodes="${nodes.length}" edges="${validEdgeCount}" hint="Established system knowledge: principles, mechanisms, constraints, tensions. Scenes must operate within these truths. Connections shown as [relation→targetId] (out) and [←relation sourceId] (in). Reuse existing IDs; new nodes need edges.">\n${sections.join('\n\n')}\n</system-graph>\n`;
}


/** Build a prompt block from story settings — returns empty string if all defaults.
 *  Each setting becomes a typed XML child so the LLM can parse the surface
 *  structurally rather than scan prose. */
export function buildStorySettingsBlock(n: NarrativeState): string {
  const s: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...n.storySettings };
  const elements: string[] = [];

  // POV
  const povGuidance: Record<string, string> = {
    single: 'Every scene uses the same POV character.',
    ensemble:
      'Every designated POV is a co-lead. Each drives their own thread(s), owns significant arcs, makes world-changing decisions independently. Screen time roughly even; no single character dominates. POV comes in streaks (2-4 scenes per character) so each perspective breathes, but every arc shows multiple POVs. No single POV owns the majority of stakes. For declared polyphonic/choral/mosaic forms, per-scene or per-paragraph rotation IS the form; honour it over the default streak length.',
    free: '',
  };
  const povCharacterLines = s.povCharacterIds
    .map((id) => {
      const char = n.characters[id];
      return char
        ? `    <character id="${id}" name="${char.name}" />`
        : `    <character id="${id}" />`;
    })
    .join('\n');
  if (s.povMode !== 'free') {
    const guidance = povGuidance[s.povMode];
    let assignment = '';
    if (s.povCharacterIds.length > 0) {
      const distribute =
        s.povMode === 'ensemble' && s.povCharacterIds.length > 1
          ? ` Distribute POV across ALL ${s.povCharacterIds.length}; do not concentrate on one.`
          : '';
      assignment = `\n  <assignment>Only the designated characters may appear in povId.${distribute}</assignment>`;
    } else if (s.povMode === 'ensemble') {
      assignment = `\n  <assignment>No POV cast designated. Commit to 3-5 anchors up front, rotate among them, each owns at least one thread with comparable screen time. Establish in the first arc if none exist.</assignment>`;
    }
    const charsBlock = povCharacterLines
      ? `\n  <characters>\n${povCharacterLines}\n  </characters>`
      : '';
    elements.push(
      `<pov mode="${s.povMode}">\n  <guidance>${guidance}</guidance>${charsBlock}${assignment}\n</pov>`,
    );
  } else if (s.povCharacterIds.length > 0) {
    elements.push(
      `<pov mode="free">\n  <guidance>Favour the preferred characters as POV when the scene fits; any character may be used when a different vantage is stronger.</guidance>\n  <characters>\n${povCharacterLines}\n  </characters>\n</pov>`,
    );
  }

  // Direction / constraints / guidance
  if (s.storyDirection.trim()) {
    elements.push(
      `<story-direction hint="North star.">${s.storyDirection.trim()}</story-direction>`,
    );
  }
  if (s.storyConstraints.trim()) {
    elements.push(
      `<story-constraints hint="Do NOT do any of the following.">${s.storyConstraints.trim()}</story-constraints>`,
    );
  }
  // Paradigm — one of the six canonical world-shapes (fiction / non-fiction /
  // simulation / essay / panel / atlas / debate). Drives downstream generation
  // shape: populated-narrative vs rule-governed-narrative vs singular-thinker
  // vs multi-thinker vs reference-typology vs adversarial-contest.
  if (n.paradigm) {
    const shapeMap: Record<NarrativeParadigm, string> = {
      'fiction':      'populated-narrative — invented people in an invented world (REALITY POSTURE: invented)',
      'non-fiction':  'populated-narrative — real people, documented events; the world IS the record (REALITY POSTURE: observed)',
      'simulation':   'rule-governed-narrative — in-world figures the rules ACT ON; rules are load-bearing, threads close on rule-driven consequences (REALITY POSTURE: hybrid — real rules over real or invented agents)',
      'essay':        'singular-thinker — one named author + 1-3 cited interlocutors; internal friction substitutes for multi-voice disagreement (REALITY POSTURE: observed evidence + named author)',
      'panel':        'multi-thinker — a named cast of 2+ thinkers (AI agents OR human experts) pursuing a shared question over existing evidence; cooperative-with-disagreement, includes devil\'s-advocate role + ≥1 adversarial pair (REALITY POSTURE: observed evidence + named cast)',
      'atlas':        'reference-typology — entries / taxa / doctrines; system-graph IS the work; no fate threads, no character transformation (REALITY POSTURE: real-world typology OR invented-world codex — pick one and stay consistent)',
      'debate':       'adversarial-contest — 2+ named parties locked in zero-sum stakes under explicit rules; each scene a MOVE; threads track axes of contestation (REALITY POSTURE: documented contest OR hypothetical, with sourceable rules)',
    };
    elements.push(
      `<paradigm hint="The canonical world-shape this narrative was built under. All in-narrative generation (scene gen, world expansion, plan, prose) must honour it.">\n  <name>${n.paradigm}</name>\n  <shape>${shapeMap[n.paradigm]}</shape>\n</paradigm>`,
    );
  }
  // Patterns / anti-patterns
  if (n.patterns && n.patterns.length > 0) {
    const items = n.patterns.map((p) => `  <pattern>${p}</pattern>`).join('\n');
    elements.push(
      `<patterns hint="Positive commandments.">\n${items}\n</patterns>`,
    );
  }
  if (n.antiPatterns && n.antiPatterns.length > 0) {
    const items = n.antiPatterns
      .map((p) => `  <anti-pattern>${p}</anti-pattern>`)
      .join('\n');
    elements.push(
      `<anti-patterns hint="Negative commandments.">\n${items}\n</anti-patterns>`,
    );
  }

  if (elements.length === 0) return '';
  return `\n<narrative-settings>\n${elements.join('\n')}\n</narrative-settings>\n`;
}

/** Format network annotations as XML attributes for inline use on entity
 *  / thread / system render tags. Emits tier + attributions + topology —
 *  the shape all downstream consumers have converged on. Returns "" for
 *  absent nodes. */
/** Compress the node's network role into a single natural-language phrase.
 *  The shape mirrors how the LLM should read the asset:
 *    - "unused"                          — never referenced; weak default option
 *    - "fresh ×N"                        — recently introduced; spend deliberately
 *    - "hub ×N" / "load-bearing hub ×N"  — central within its force; strong anchor
 *    - "bridge ×N" / "load-bearing bridge ×N" — connects forces; coherence lever
 *    - "active ×N" / "load-bearing ×N"   — referenced but not structural yet
 *    - "incidental ×N"                   — cold/peripheral; safe to leave alone
 *
 *  One short attribute beats three numeric ones for prompt density and gives
 *  the model an action-shaped read rather than raw metrics.
 */
function describeNodeUsage(node: NetworkNode): string {
  if (node.attributions === 0) return "unused";
  if (node.tier === "fresh") return `fresh ×${node.attributions}`;
  const heavy = node.tier === "hot";
  const cold = node.tier === "cold";
  if (node.topology === "bridge") {
    return `${heavy ? "load-bearing bridge" : cold ? "stale bridge" : "bridge"} ×${node.attributions}`;
  }
  if (node.topology === "hub") {
    return `${heavy ? "load-bearing hub" : cold ? "stale hub" : "hub"} ×${node.attributions}`;
  }
  if (node.topology === "leaf") {
    return `${heavy ? "load-bearing" : cold ? "incidental" : "active"} ×${node.attributions}`;
  }
  return `incidental ×${node.attributions}`;
}

function networkAttrs(node: NetworkNode | undefined): string {
  if (!node) return "";
  return ` usage="${describeNodeUsage(node)}"`;
}

export function narrativeContext(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  // The entire branch up to the current scene is included. Resolution is
  // tiered by distance from the current scene (see NEAR_RECENCY_ZONE /
  // MID_RECENCY_ZONE) rather than by a hard cutoff.
  const keysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);

  // Cumulative network annotations — every entity / thread / system-node
  // tag below is decorated with tier/trajectory/topology/force-anchor so
  // every downstream call (plan, prose, rewrite, reasoning) sees the same
  // activation pattern without a separate fetch.
  const network = aggregateNetworkGraph(n, resolvedKeys, currentIndex);
  const tierLookup = buildTierLookup(network);

  // Collect entity IDs, knowledge node IDs, and per-scene metadata on one pass.
  // sceneImportance / knowledgeOriginScene / threadLogOriginScene drive the
  // tiered continuity pruning below — knowledge and thread-log nodes are
  // rendered only if the scene they came from is still in near/mid tier
  // (important scenes get promoted, so load-bearing history survives).
  const referencedCharIds = new Set<string>();
  const referencedLocIds = new Set<string>();
  const referencedThreadIds = new Set<string>();
  const horizonContinuityNodeIds = new Set<string>();
  const totalEntries = keysUpToCurrent.length;
  const knowledgeOriginScene = new Map<string, number>();
  const threadLogOriginScene = new Map<string, number>();
  const relationshipLatestDeltaScene = new Map<string, number>();
  keysUpToCurrent.forEach((k, i) => {
    const entry = resolveEntry(n, k);
    if (!entry) return;
    if (entry.kind === 'scene') {
      if (entry.povId) referencedCharIds.add(entry.povId);
      for (const pid of entry.participantIds) referencedCharIds.add(pid);
      referencedLocIds.add(entry.locationId);
      for (const tm of entry.threadDeltas) {
        referencedThreadIds.add(tm.threadId);
        // One log node per (thread, scene) with canonical id format.
        const logNodeId = `${tm.threadId}:${entry.id}`;
        if (!threadLogOriginScene.has(logNodeId)) threadLogOriginScene.set(logNodeId, i);
      }
      for (const km of entry.worldDeltas) {
        referencedCharIds.add(km.entityId);
        for (const node of km.addedNodes ?? []) {
          horizonContinuityNodeIds.add(node.id);
          if (!knowledgeOriginScene.has(node.id)) knowledgeOriginScene.set(node.id, i);
        }
      }
      for (const rm of entry.relationshipDeltas) {
        referencedCharIds.add(rm.from);
        referencedCharIds.add(rm.to);
        // Track latest delta scene per undirected relationship pair so we can
        // drop relationships whose last change lives in far tier.
        const pairKey = rm.from < rm.to ? `${rm.from}|${rm.to}` : `${rm.to}|${rm.from}`;
        relationshipLatestDeltaScene.set(pairKey, i);
      }
      if (entry.characterMovements) {
        for (const [charId, mv] of Object.entries(entry.characterMovements)) {
          referencedCharIds.add(charId);
          referencedLocIds.add(mv.locationId);
        }
      }
    } else if (entry.kind === 'world_build') {
      for (const c of entry.expansionManifest.newCharacters) referencedCharIds.add(c.id);
      for (const l of entry.expansionManifest.newLocations) referencedLocIds.add(l.id);
      for (const t of entry.expansionManifest.newThreads) referencedThreadIds.add(t.id);
    }
  });

  // A knowledge/log node survives pruning if its origin scene is in near/mid tier.
  // Seed nodes (no recorded origin — typically introduced by a world build) always survive.
  const keepByRecency = (originMap: Map<string, number>) => (id: string): boolean => {
    const tier = tierOfOrigin(originMap.get(id), totalEntries, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE);
    return tier !== 'far';
  };
  const keepKnowledgeNode = keepByRecency(knowledgeOriginScene);
  const keepThreadLogNode = keepByRecency(threadLogOriginScene);
  // Also include threads that anchor to referenced characters/locations
  for (const t of Object.values(n.threads)) {
    if (referencedThreadIds.has(t.id)) continue;
    for (const anchor of t.participants) {
      if ((anchor.type === 'character' && referencedCharIds.has(anchor.id)) ||
          (anchor.type === 'location' && referencedLocIds.has(anchor.id))) {
        referencedThreadIds.add(t.id);
        break;
      }
    }
  }
  // Include parent locations of referenced locations
  for (const locId of [...referencedLocIds]) {
    const loc = n.locations[locId];
    if (loc?.parentId && n.locations[loc.parentId]) referencedLocIds.add(loc.parentId);
  }

  // If no scenes exist yet (initial generation), include all entities
  const hasHistory = referencedCharIds.size > 0 || referencedLocIds.size > 0;
  const branchCharacters = hasHistory
    ? Object.values(n.characters).filter((c) => referencedCharIds.has(c.id))
    : Object.values(n.characters);
  const branchLocations = hasHistory
    ? Object.values(n.locations).filter((l) => referencedLocIds.has(l.id))
    : Object.values(n.locations);
  const branchThreads = hasHistory
    ? Object.values(n.threads).filter((t) => referencedThreadIds.has(t.id))
    : Object.values(n.threads);

  // Get timeline-scoped state: continuity nodes, relationships, and thread statuses
  // that existed at this point in the timeline (not future state)
  const timelineState = getStateAtIndex(n, resolvedKeys, currentIndex);
  const branchRelationships = hasHistory
    ? timelineState.relationships.filter((r) => referencedCharIds.has(r.from) && referencedCharIds.has(r.to))
    : timelineState.relationships;

  // Knowledge: keep original (non-delta) nodes + delta nodes from the time horizon
  const introduced = getIntroducedIds(n.worldBuilds, n.scenes, resolvedKeys, currentIndex);
  const artifactEntries = Object.values(n.artifacts ?? {}).filter((a) => introduced.artifactIds.has(a.id));
  // Use timeline-scoped ownership (who owned each artifact at this point, not final state)
  const artifactsByOwner = new Map<string, typeof artifactEntries>();
  for (const a of artifactEntries) {
    const ownerId = timelineState.artifactOwnership[a.id] ?? a.parentId ?? '__world__';
    const list = artifactsByOwner.get(ownerId) ?? [];
    list.push(a);
    artifactsByOwner.set(ownerId, list);
  }

  // Helper: render continuity nodes as XML. Each node's typed element name
  // (trait / state / history / capability / belief / relation / secret /
  // goal / weakness) carries the type — the tag IS the type, not a generic
  // <knowledge> wrapper with a type attribute. Edges are intentionally
  // omitted: the LLM consumes entity continuity as a list of typed claims,
  // not as a graph traversal.
  const renderContinuityXml = (nodes: { id: string; type: string; content: string }[], indent: string) =>
    nodes.map((kn) => `${indent}<${kn.type} id="${kn.id}">${kn.content}</${kn.type}>`);

  // Recency-tiered continuity: keep nodes that are alive at the current index
  // AND whose origin scene is still in near/mid tier. Slicing by
  // ENTITY_LOG_CONTEXT_LIMIT guards against runaway early-story world dumps
  // on entities with many seed nodes.
  const tieredContinuity = (nodes: Record<string, { id: string; type: string; content: string }>) =>
    Object.values(nodes)
      .filter((kn) => timelineState.liveNodeIds.has(kn.id) && keepKnowledgeNode(kn.id))
      .slice(-ENTITY_LOG_CONTEXT_LIMIT);

  const characters = branchCharacters
    .map((c) => {
      const recentNodes = tieredContinuity(c.world.nodes);
      const continuityLines = renderContinuityXml(recentNodes, '  ');
      const owned = artifactsByOwner.get(c.id) ?? [];
      const artifactLines = owned.map((a) => {
        const recentArtNodes = tieredContinuity(a.world.nodes);
        const inner = renderContinuityXml(recentArtNodes, '    ').join('\n');
        return `  <artifact id="${a.id}" name="${a.name}" significance="${a.significance}"${networkAttrs(tierLookup.get(a.id))}>${inner ? `\n${inner}\n  ` : ''}</artifact>`;
      });
      const continuityBlock = continuityLines.length > 0 ? `\n${continuityLines.join('\n')}` : '';
      const artifactBlock = artifactLines.length > 0 ? `\n${artifactLines.join('\n')}` : '';
      return `<character id="${c.id}" name="${c.name}" role="${c.role}"${networkAttrs(tierLookup.get(c.id))}>${continuityBlock}${artifactBlock}\n</character>`;
    })
    .join('\n');
  const locations = branchLocations
    .map((l) => {
      const recentNodes = tieredContinuity(l.world.nodes);
      const continuityLines = renderContinuityXml(recentNodes, '  ');
      const parent = l.parentId ? ` parent="${n.locations[l.parentId]?.name ?? l.parentId}"` : '';
      const owned = artifactsByOwner.get(l.id) ?? [];
      const artifactLines = owned.map((a) => {
        const recentArtNodes = tieredContinuity(a.world.nodes);
        const inner = renderContinuityXml(recentArtNodes, '    ').join('\n');
        return `  <artifact id="${a.id}" name="${a.name}" significance="${a.significance}"${networkAttrs(tierLookup.get(a.id))}>${inner ? `\n${inner}\n  ` : ''}</artifact>`;
      });
      const continuityBlock = continuityLines.length > 0 ? `\n${continuityLines.join('\n')}` : '';
      const artifactBlock = artifactLines.length > 0 ? `\n${artifactLines.join('\n')}` : '';
      const tiedNames = (l.tiedCharacterIds ?? []).map(id => n.characters[id]?.name).filter(Boolean);
      const tiesAttr = tiedNames.length > 0 ? ` ties="${tiedNames.join(', ')}"` : '';
      return `<location id="${l.id}" name="${l.name}" prominence="${l.prominence ?? 'place'}"${parent}${tiesAttr}${networkAttrs(tierLookup.get(l.id))}>${continuityBlock}${artifactBlock}\n</location>`;
    })
    .join('\n');
  // Build thread age context from scene history (within time horizon)
  const threadFirstDelta: Record<string, number> = {};
  const threadDeltaCount: Record<string, number> = {};
  keysUpToCurrent.forEach((k, idx) => {
    const scene = n.scenes[k];
    if (!scene) return;
    for (const tm of scene.threadDeltas) {
      threadDeltaCount[tm.threadId] = (threadDeltaCount[tm.threadId] ?? 0) + 1;
      if (threadFirstDelta[tm.threadId] === undefined) threadFirstDelta[tm.threadId] = idx;
    }
  });
  const totalScenes = keysUpToCurrent.length;

  const threads = branchThreads
    .map((t) => {
      const firstMut = threadFirstDelta[t.id];
      const age = firstMut !== undefined ? totalScenes - firstMut : 0;
      const deltas = threadDeltaCount[t.id] ?? 0;
      const participantNames = t.participants.map((a) => n.characters[a.id]?.name ?? n.locations[a.id]?.name ?? a.id).join(', ');
      const validDeps = t.dependents.filter((id) => n.threads[id]);
      const depsAttr = validDeps.length > 0 ? ` converges="${validDeps.join(',')}"` : '';
      // Market state — read live from thread. Closed or abandoned threads
      // don't appear in generation context.
      if (isThreadClosed(t) || isThreadAbandoned(t)) return null;
      const belief = getMarketBelief(t);
      const probs = getMarketProbs(t);
      const { topIdx, margin } = getMarketMargin(t);
      const topProb = probs[topIdx] ?? 0;
      const silent = scenesSinceTouched(t, keysUpToCurrent, currentIndex);
      // Canonical category classification — same function the UI uses, so the
      // model sees one vocabulary across scene generation, arc planning, and
      // rendered visualisations. Scene context drives the developing/dormant
      // split via scenesSinceTouch.
      const category = classifyThreadCategory(t, { scenesSinceTouch: silent });
      const recentEnergy = computeRecentLogitEnergy(t);
      const marketAttr = belief
        ? ` category="${category}" lean="${t.outcomes[topIdx]}" p-lean="${topProb.toFixed(2)}" margin="${margin.toFixed(1)}" vol="${belief.volume.toFixed(1)}" volatility="${belief.volatility.toFixed(2)}" energy="${recentEnergy.toFixed(2)}" silent="${Number.isFinite(silent) ? silent : '∞'}"`
        : ` category="${category}"`;
      // Market: one outcome per option.
      const marketBlock = `\n  <market>\n${t.outcomes
        .map((o, i) => `    <outcome name="${o.replace(/"/g, '&quot;')}" p="${(probs[i] ?? 0).toFixed(2)}" />`)
        .join('\n')}\n  </market>`;
      // Replay logits chronologically so each rendered event can report the
      // lead AFTER the update. Replay covers every node (even ones the
      // recency filter drops) so kept events still show correct trajectories.
      const orderedLog = Object.values(t.threadLog?.nodes ?? {}).slice().sort((a, b) => {
        const ia = threadLogOriginScene.get(a.id) ?? -1;
        const ib = threadLogOriginScene.get(b.id) ?? -1;
        return ia - ib;
      });
      const eventLead = new Map<string, { lead: string; p: number }>();
      {
        let logits = new Array(t.outcomes.length).fill(0);
        for (const ln of orderedLog) {
          if (ln.updates && ln.updates.length > 0) {
            logits = updateLogits(logits, t.outcomes, ln.updates);
          }
          const probsHere = softmax(logits);
          let topIdxHere = 0;
          for (let i = 1; i < probsHere.length; i++) if (probsHere[i] > probsHere[topIdxHere]) topIdxHere = i;
          eventLead.set(ln.id, { lead: t.outcomes[topIdxHere], p: probsHere[topIdxHere] });
        }
      }
      // Recency-tiered render window: keep events from near/mid scenes only.
      const renderedLogNodes = orderedLog
        .filter((ln) => keepThreadLogNode(ln.id))
        .slice(-ENTITY_LOG_CONTEXT_LIMIT);
      const renderEvent = (ln: typeof orderedLog[number]): string => {
        const state = eventLead.get(ln.id);
        const leadAttr = state ? ` lead="${state.lead.replace(/"/g, '&quot;')}"` : '';
        const pAttr = state ? ` p="${state.p.toFixed(2)}"` : '';
        return `    <event type="${ln.type}"${leadAttr}${pAttr}>${ln.content}</event>`;
      };
      const logBlock = renderedLogNodes.length > 0
        ? `\n  <log hint="lead+p track the leading outcome after each update; read top-down for trajectory.">\n${renderedLogNodes.map(renderEvent).join('\n')}\n  </log>`
        : '';
      const horizonAttr = ` horizon="${t.horizon ?? 'medium'}"`;
      return `<thread id="${t.id}"${marketAttr}${horizonAttr}${age > 0 ? ` age="${age}" deltas="${deltas}"` : ''}${participantNames ? ` participants="${participantNames}"` : ''}${depsAttr}${networkAttrs(tierLookup.get(t.id))}>${t.description}${marketBlock}${logBlock}\n</thread>`;
    })
    .filter(Boolean)
    .join('\n');
  // Recency-tiered relationships: keep only pairs whose latest delta is in
  // near/mid tier. Scene-history summaries carry stable long-term dynamics.
  const relationships = branchRelationships
    .filter((r) => {
      const pairKey = r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`;
      const tier = tierOfOrigin(relationshipLatestDeltaScene.get(pairKey), totalEntries, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE);
      return tier !== 'far';
    })
    .map((r) => {
      const fromName = n.characters[r.from]?.name ?? r.from;
      const toName = n.characters[r.to]?.name ?? r.to;
      return `<relationship from="${fromName}" to="${toName}" valence="${Math.round(r.valence * 100) / 100}">${r.type}</relationship>`;
    })
    .join('\n');
  // Tiered scene history grouped by arc — mirrors the outline's structural
  // grouping so the LLM reads continuity arc-by-arc rather than as a flat
  // event log. Near/mid scenes render individually as <entry> children of
  // their arc's <arc> wrapper. Consecutive far-tier scenes in the same arc
  // collapse into a single arc-summary entry (the arc's worldState snapshot
  // is the compact chess-board memory) which lives inside the same wrapper.
  // World builds break the flow and render as standalone siblings between
  // arc wrappers, matching outlineContext.
  const tierCounts = { near: 0, mid: 0, far: 0, arcRollup: 0, farCompressed: 0 };
  type WorldBuildSection = { kind: 'world-build'; line: string };
  type ArcSection = { kind: 'arc'; arcId: string; arcName: string; entries: string[]; present: boolean };
  type Section = WorldBuildSection | ArcSection;
  const sections: Section[] = [];
  let currentArc: ArcSection | null = null;
  type ArcBuffer = { arcId: string; firstIndex: number; lastIndex: number; sceneCount: number };
  let arcBuffer: ArcBuffer | null = null;

  const ensureArcSection = (arcId: string): ArcSection => {
    if (currentArc && currentArc.arcId === arcId) return currentArc;
    if (currentArc) sections.push(currentArc);
    const arc = n.arcs[arcId];
    currentArc = { kind: 'arc', arcId, arcName: arc?.name ?? 'unnamed arc', entries: [], present: false };
    return currentArc;
  };

  const flushArcBuffer = () => {
    if (!arcBuffer) return;
    const arc = n.arcs[arcBuffer.arcId];
    const indicesAttr = arcBuffer.firstIndex === arcBuffer.lastIndex
      ? `index="${arcBuffer.firstIndex}"`
      : `indices="${arcBuffer.firstIndex}-${arcBuffer.lastIndex}"`;
    const body = arc?.worldState?.trim()
      || arc?.directionVector?.trim()
      || `${arcBuffer.sceneCount} scene${arcBuffer.sceneCount > 1 ? 's' : ''} elapsed — no chess-board snapshot recorded`;
    const compressionAttr = arcBuffer.sceneCount > 1 ? ` compresses="${arcBuffer.sceneCount}x"` : '';
    const section = ensureArcSection(arcBuffer.arcId);
    section.entries.push(
      `  <entry ${indicesAttr} type="arc-summary" scenes="${arcBuffer.sceneCount}"${compressionAttr}>\n    ${body}\n  </entry>`,
    );
    tierCounts.arcRollup++;
    tierCounts.farCompressed += arcBuffer.sceneCount;
    arcBuffer = null;
  };

  const flushCurrentArc = () => {
    flushArcBuffer();
    if (currentArc) {
      sections.push(currentArc);
      currentArc = null;
    }
  };

  for (let i = 0; i < keysUpToCurrent.length; i++) {
    const k = keysUpToCurrent[i];
    const s = resolveEntry(n, k);
    if (!s) continue;
    const globalIdx = i + 1;
    const distanceFromCurrent = totalEntries - 1 - i;
    const isPresent = i === keysUpToCurrent.length - 1;
    const presentAttr = isPresent ? ' present="true"' : '';

    if (s.kind === 'world_build') {
      flushCurrentArc();
      sections.push({
        kind: 'world-build',
        line: `<entry index="${globalIdx}" type="world-build"${presentAttr}>${s.summary}</entry>`,
      });
      continue;
    }

    const tier = classifyTier(distanceFromCurrent, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE);
    tierCounts[tier]++;

    if (tier === 'far' && s.arcId) {
      if (arcBuffer && arcBuffer.arcId !== s.arcId) flushArcBuffer();
      if (!arcBuffer) {
        arcBuffer = { arcId: s.arcId, firstIndex: globalIdx, lastIndex: globalIdx, sceneCount: 1 };
      } else {
        arcBuffer.lastIndex = globalIdx;
        arcBuffer.sceneCount++;
      }
      continue;
    }

    flushArcBuffer();
    const section = ensureArcSection(s.arcId);
    // Indent the inner entry so the nested structure stays readable.
    section.entries.push('  ' + renderSceneEntry(n, s, globalIdx, tier, isPresent).replace(/\n/g, '\n  '));
    if (isPresent) section.present = true;
  }
  flushCurrentArc();

  // Current world state — only shown when the CURRENT arc (the arc of the
  // most recent resolved scene) has a worldState of its own. Stale snapshots
  // from older arcs are NOT surfaced. Rendered as the closing child of the
  // active arc's <arc> wrapper — semantically it IS the arc's current state.
  for (let i = keysUpToCurrent.length - 1; i >= 0; i--) {
    const entry = resolveEntry(n, keysUpToCurrent[i]);
    if (!entry || entry.kind !== 'scene') continue;
    const arc = n.arcs[entry.arcId];
    if (arc?.worldState) {
      const presentArcSection = [...sections].reverse().find(
        (sec): sec is ArcSection => sec.kind === 'arc' && sec.arcId === entry.arcId,
      );
      const worldStateEntry = `  <entry type="world-state" hint="Chess-board snapshot of the active arc. Supersedes replaying prior deltas.">\n    ${arc.worldState}\n  </entry>`;
      if (presentArcSection) {
        presentArcSection.entries.push(worldStateEntry);
      } else {
        // Fallback — no matching arc section (defensive; should not normally happen).
        sections.push({ kind: 'world-build', line: `<entry type="world-state" arc="${arc.name}">\n  ${arc.worldState}\n</entry>` });
      }
    }
    break;
  }

  const sceneHistory = sections
    .map((sec) => {
      if (sec.kind === 'world-build') return sec.line;
      const presentAttr = sec.present ? ' present="true"' : '';
      return `<arc name="${sec.arcName}"${presentAttr}>\n${sec.entries.join('\n')}\n</arc>`;
    })
    .join('\n\n');

  // ── System Knowledge Graph (scoped to time horizon) ────────────────
  const horizonSystemGraph = buildCumulativeSystemGraph(
    n.scenes, keysUpToCurrent, keysUpToCurrent.length - 1, n.worldBuilds,
  );
  const rankedSystemNodes = rankSystemNodes(horizonSystemGraph);

  // Compact ID lookup — placed last so it's closest to the generation prompt
  // Exclude abandoned threads from valid IDs — they shouldn't be referenced in generation
  const charIdList = branchCharacters.map((c) => c.id).join(', ');
  const locIdList = branchLocations.map((l) => l.id).join(', ');
  const activeThreads = branchThreads.filter((t) => !isThreadClosed(t) && !isThreadAbandoned(t));
  const threadIdList = activeThreads.map((t) => t.id).join(', ');
  const sysIdList = rankedSystemNodes.map(({ node }) => node.id).join(', ');

  // Build system knowledge from SystemGraph (consolidates old rules + worldSystems)
  const systemKnowledgeBlock = buildSystemKnowledgeBlock(horizonSystemGraph, tierLookup);

  const storySettingsBlock = buildStorySettingsBlock(n);

  const compressionRatio = tierCounts.arcRollup > 0
    ? ` Far-tier compression: ${tierCounts.farCompressed} scenes → ${tierCounts.arcRollup} arc-summary entr${tierCounts.arcRollup === 1 ? 'y' : 'ies'} (${(tierCounts.farCompressed / tierCounts.arcRollup).toFixed(1)}x avg).`
    : '';
  const historyNote = `${keysUpToCurrent.length} scenes. ${tierCounts.near} near, ${tierCounts.mid} mid, ${tierCounts.far} far.${compressionRatio} Arc-summary bodies are the chess-board snapshot for that span; treat as ground truth.`;

  return `<narrative title="${n.title}">
<network-annotations hint="Every node below carries cumulative network attrs: tier (hot/warm/cold/fresh), attributions (cross-graph reference count), topology (bridge/hub/leaf/isolated). Load-bearing = bridges and hubs; cold = reactivation candidates." />
${systemKnowledgeBlock}${storySettingsBlock}
<characters hint="Continuity = what each character knows. Drives what they can reference, discover, or be surprised by.">
${characters}
</characters>

<locations hint="Nested via parent attribute. Characters must physically travel between locations.">
${locations}
</locations>

<threads hint="Compelling questions priced as prediction markets over named outcomes. category: saturating (near closure), volatile (recent swings), contested (high entropy, real volume), committed (one outcome leads p&gt;=0.65), developing (touched, no shape yet), dormant (untouched, decaying). Attrs: lean (top outcome), p-lean (its prob), margin (logit gap to runner-up), vol (attention), volatility (EWMA of per-scene shifts), energy (recent logit motion), silent (scenes since last touched).">
${threads}
</threads>

<relationships hint="Valence: negative = hostile, positive = allied. Interactions must reflect current valence. Shifts happen through dramatic moments.">
${relationships}
</relationships>

<scene-history scope="${historyNote}" hint="Continuity grouped by arc. present=&quot;true&quot; marks the active arc and the latest entry within it. type=&quot;world-state&quot; is the active arc's chess-board snapshot. World-build entries sit between arcs. time-gap is elapsed time since the prior scene.">
${sceneHistory}
</scene-history>
<valid-ids hint="Use ONLY these IDs. Do not invent new ones.">
  <characters>${charIdList}</characters>
  <locations>${locIdList}</locations>
  <threads>${threadIdList}</threads>${artifactEntries.length > 0 ? `\n  <artifacts>${artifactEntries.map((a) => a.id).join(', ')}</artifacts>` : ''}${sysIdList ? `\n  <system-nodes>${sysIdList}</system-nodes>` : ''}
</valid-ids>
</narrative>`;
}

/** Compact market category for per-scene shift lines. Same vocabulary the
 *  narrative-context <thread> tag emits, condensed to one token so delta
 *  readers see the market a shift is modifying without ceremony. */
function threadMarketSignal(t: import('@/types/narrative').Thread): string {
  return classifyThreadCategory(t);
}

export function sceneContext(
  narrative: NarrativeState,
  scene: Scene,
  /* eslint-disable @typescript-eslint/no-unused-vars */
  _resolvedKeys?: string[],
  _currentIndex?: number,
  /* eslint-enable @typescript-eslint/no-unused-vars */
): string {
  // DELTAS + NEW ENTITIES ONLY. Scene context describes what THIS scene
  // introduces or changes — not cumulative world state. Callers that need
  // continuity context should combine this with narrativeContext, not
  // duplicate state here.
  const location = narrative.locations[scene.locationId];
  const pov = scene.povId ? narrative.characters[scene.povId] : undefined;
  const arc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id));

  // Network attributes for participant + thread enrichment. Scene context is
  // called without resolvedKeys/currentIndex in most paths, so we fall back
  // to a full-narrative aggregate — still meaningful: tier is the cumulative
  // load-bearing read, not a point-in-time recency measure.
  const sceneNetwork = aggregateNetworkGraph(narrative);
  const sceneTierLookup = buildTierLookup(sceneNetwork);

  // ── Participant identifiers (no cumulative knowledge) ───────────────
  const participantLines = scene.participantIds.map((pid) => {
    const p = narrative.characters[pid];
    if (!p) return `  <participant id="${pid}" />`;
    return `  <participant id="${p.id}" name="${p.name}" role="${p.role}"${networkAttrs(sceneTierLookup.get(p.id))} />`;
  });

  // ── Scene deltas ───────────────────────────────────────────────────
  const threadDeltaLines = scene.threadDeltas.map((tm) => {
    const thread = narrative.threads[tm.threadId];
    const moves = (tm.updates ?? [])
      .map((u) => `${u.outcome}${u.evidence >= 0 ? '+' : ''}${u.evidence}`)
      .join(' ');
    const rationale = tm.rationale?.slice(0, 120).replace(/"/g, '&quot;') ?? '';
    // Market signal reads the thread's CURRENT live state — use it to
    // understand the delta in context. A pulse on a leans market holds a
    // commitment; a pulse on a fading market keeps it barely alive.
    const signalAttr = thread ? ` signal="${threadMarketSignal(thread)}"` : '';
    return `  <shift thread="${thread?.description ?? tm.threadId}"${signalAttr} logType="${tm.logType}" updates="${moves}" rationale="${rationale}" />`;
  });

  const worldDeltaLines = scene.worldDeltas.flatMap((km) => {
    const entityName = resolveEntityName(narrative, km.entityId);
    return (km.addedNodes ?? []).map(node => `  <change entity="${entityName}" type="${node.type}">${node.content}</change>`);
  });

  const relationshipDeltaLines = scene.relationshipDeltas.map((rm) => {
    const fromName = narrative.characters[rm.from]?.name ?? rm.from;
    const toName = narrative.characters[rm.to]?.name ?? rm.to;
    return `  <shift from="${fromName}" to="${toName}" delta="${rm.valenceDelta >= 0 ? '+' : ''}${Math.round(rm.valenceDelta * 100) / 100}">${rm.type}</shift>`;
  });

  const movementLines = scene.characterMovements
    ? Object.entries(scene.characterMovements).map(([charId, mv]) => {
        const char = narrative.characters[charId];
        const loc = narrative.locations[mv.locationId];
        return `  <movement character="${char?.name ?? charId}" to="${loc?.name ?? mv.locationId}">${mv.transition}</movement>`;
      })
    : [];

  const artifactUsageLines = (scene.artifactUsages ?? []).map((au) => {
    const artName = narrative.artifacts?.[au.artifactId]?.name ?? au.artifactId;
    const usageAttr = au.usage ? ` what="${au.usage}"` : '';
    if (!au.characterId) return `  <usage artifact="${artName}"${usageAttr} />`;
    const charName = narrative.characters[au.characterId]?.name ?? au.characterId;
    return `  <usage artifact="${artName}" character="${charName}"${usageAttr} />`;
  });

  const ownershipDeltaLines = (scene.ownershipDeltas ?? []).map((om) => {
    const artName = resolveEntityName(narrative, om.artifactId);
    const fromName = resolveEntityName(narrative, om.fromId);
    const toName = resolveEntityName(narrative, om.toId);
    return `  <transfer artifact="${artName}" from="${fromName}" to="${toName}" />`;
  });

  const tieDeltaLines = (scene.tieDeltas ?? []).map((mm) => {
    const locName = narrative.locations[mm.locationId]?.name ?? mm.locationId;
    const charName = narrative.characters[mm.characterId]?.name ?? mm.characterId;
    return `  <tie character="${charName}" action="${mm.action}" location="${locName}" />`;
  });

  const wkmBlock = (() => {
    const wkm = scene.systemDeltas;
    if (!wkm || ((wkm.addedNodes?.length ?? 0) === 0 && (wkm.addedEdges?.length ?? 0) === 0)) return '';
    const lines: string[] = [];
    for (const node of wkm.addedNodes ?? []) {
      lines.push(`<node id="${node.id}" type="${node.type}">${node.concept}</node>`);
    }
    // Resolve edge endpoints to their concept text so the LLM never sees a
    // bare SYS-XX id without its meaning. Falls back gracefully if a referenced
    // node can't be located in either the cumulative graph or this delta.
    const resolveConcept = (id: string): string => {
      const node = narrative.systemGraph?.nodes[id] ?? wkm.addedNodes?.find((n) => n.id === id);
      if (!node?.concept) return id;
      return node.concept.includes(' — ') ? node.concept.split(' — ')[0] : node.concept;
    };
    for (const edge of wkm.addedEdges ?? []) {
      const fromConcept = resolveConcept(edge.from);
      const toConcept = resolveConcept(edge.to);
      lines.push(`<edge relation="${edge.relation}" from="${fromConcept}" to="${toConcept}"/>`);
    }
    return `\n<system-reveals>\n${lines.join('\n')}\n</system-reveals>`;
  })();

  // ── New entities introduced by this scene ──────────────────────────
  const newCharacterLines = (scene.newCharacters ?? []).map((c) => {
    const knLines = Object.values(c.world?.nodes ?? {})
      .map((kn) => `    <knowledge type="${kn.type}">${kn.content}</knowledge>`);
    const knBlock = knLines.length > 0 ? `\n${knLines.join('\n')}` : '';
    return `  <character id="${c.id}" name="${c.name}" role="${c.role}">${knBlock}\n  </character>`;
  });

  const newLocationLines = (scene.newLocations ?? []).map((l) => {
    const knLines = Object.values(l.world?.nodes ?? {})
      .map((kn) => `    <knowledge type="${kn.type}">${kn.content}</knowledge>`);
    const knBlock = knLines.length > 0 ? `\n${knLines.join('\n')}` : '';
    const parent = l.parentId ? ` parent="${narrative.locations[l.parentId]?.name ?? l.parentId}"` : '';
    return `  <location id="${l.id}" name="${l.name}" prominence="${l.prominence}"${parent}>${knBlock}\n  </location>`;
  });

  const newArtifactLines = (scene.newArtifacts ?? []).map((a) => {
    const knLines = Object.values(a.world?.nodes ?? {})
      .map((kn) => `    <knowledge type="${kn.type}">${kn.content}</knowledge>`);
    const knBlock = knLines.length > 0 ? `\n${knLines.join('\n')}` : '';
    const owner = a.parentId ? ` owner="${resolveEntityName(narrative, a.parentId)}"` : '';
    return `  <artifact id="${a.id}" name="${a.name}" significance="${a.significance}"${owner}>${knBlock}\n  </artifact>`;
  });

  const newThreadLines = (scene.newThreads ?? []).map((t) => {
    const parts = (t.participants ?? [])
      .map((p) => {
        if (p.type === 'character') return narrative.characters[p.id]?.name ?? p.id;
        if (p.type === 'location') return narrative.locations[p.id]?.name ?? p.id;
        return p.id;
      })
      .join(', ');
    const partsAttr = parts ? ` participants="${parts}"` : '';
    const outcomes = t.outcomes.join(' | ');
    // Freshly-opened markets are uniform-prior — signal is "fresh". Later
    // arcs will see them with evolved market signals via narrativeContext.
    return `  <thread id="${t.id}" signal="fresh" outcomes="${outcomes}"${partsAttr}>${t.description}</thread>`;
  });

  const newEntitiesBlock = [
    newCharacterLines.length > 0 ? `<new-characters>\n${newCharacterLines.join('\n')}\n</new-characters>` : '',
    newLocationLines.length > 0 ? `<new-locations>\n${newLocationLines.join('\n')}\n</new-locations>` : '',
    newArtifactLines.length > 0 ? `<new-artifacts>\n${newArtifactLines.join('\n')}\n</new-artifacts>` : '',
    newThreadLines.length > 0 ? `<new-threads>\n${newThreadLines.join('\n')}\n</new-threads>` : '',
  ].filter(Boolean).join('\n');

  const worldStateBlock = arc?.worldState
    ? `\n<world-state arc="${arc.name}" hint="Ground-truth compact state snapshot as of end of this arc. Reason from this position — it supersedes replaying prior deltas.">\n${arc.worldState}\n</world-state>`
    : '';

  const transitionPhrase = scene.timeDelta?.transition?.trim();
  const transitionAttr = transitionPhrase ? ` transition="${transitionPhrase.replace(/"/g, '&quot;')}"` : '';
  const timeGapBlock = `\n<time-gap${transitionAttr} hint="Time elapsed since the prior scene (estimate). Weave the passage of time into the prose — light, weather, wear, mood, evidentiary state, modelled rule-state, what has shifted — so its motion registers without ever surfacing as a timestamp or log entry. The description below indicates the band: texture-only (minor), woven cue (notable), anchored re-orientation (major / generational), or flashback (negative — jumping back). When the transition attribute carries a natural-language phrase, surface that phrase or its sense in the opening of the prose.">${describeTimeGap(scene.timeDelta)}</time-gap>`;

  return `<scene id="${scene.id}" arc="${arc?.name ?? 'standalone'}" pov="${pov?.name ?? 'Unknown'}" location="${location?.name ?? 'Unknown'}">${worldStateBlock}
<summary>${scene.summary}</summary>${timeGapBlock}
${participantLines.length > 0 ? `\n<participants>\n${participantLines.join('\n')}\n</participants>` : ''}
${newEntitiesBlock ? `\n${newEntitiesBlock}` : ''}

<events>
${scene.events.map((e) => `  <event>${e}</event>`).join('\n')}
</events>
${threadDeltaLines.length > 0 ? `\n<thread-shifts>\n${threadDeltaLines.join('\n')}\n</thread-shifts>` : ''}
${worldDeltaLines.length > 0 ? `\n<world-changes>\n${worldDeltaLines.join('\n')}\n</world-changes>` : ''}
${relationshipDeltaLines.length > 0 ? `\n<relationship-shifts>\n${relationshipDeltaLines.join('\n')}\n</relationship-shifts>` : ''}${wkmBlock}
${movementLines.length > 0 ? `\n<movements>\n${movementLines.join('\n')}\n</movements>` : ''}
${artifactUsageLines.length > 0 ? `\n<artifact-usages>\n${artifactUsageLines.join('\n')}\n</artifact-usages>` : ''}
${ownershipDeltaLines.length > 0 ? `\n<artifact-transfers>\n${ownershipDeltaLines.join('\n')}\n</artifact-transfers>` : ''}
${tieDeltaLines.length > 0 ? `\n<tie-changes>\n${tieDeltaLines.join('\n')}\n</tie-changes>` : ''}
</scene>`;
}

/** Deterministically derive logical rules from the scene graph — no LLM needed.
 *  Returns structured XML string with categorized constraints the prose must obey. */
export function deriveLogicRules(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys?: string[],
  currentIndex?: number,
): string {
  const sections: string[] = [];

  // Get timeline-scoped state when resolvedKeys and currentIndex are provided
  const timelineState = resolvedKeys && currentIndex !== undefined
    ? getStateAtIndex(narrative, resolvedKeys, currentIndex)
    : null;

  // Helper to get character's knowledge nodes scoped to timeline
  const getCharacterKnowledge = (charId: string) => {
    const char = narrative.characters[charId];
    if (!char) return [];
    const allCharNodes = Object.values(char.world.nodes);
    return timelineState
      ? allCharNodes.filter((kn) => timelineState.liveNodeIds.has(kn.id))
      : allCharNodes;
  };

  const participantIdSet = new Set(scene.participantIds);
  const location = narrative.locations[scene.locationId];
  const pov = scene.povId ? narrative.characters[scene.povId] : undefined;

  // NOTE: Spatial constraints and POV-lock are NOT included here because:
  // - sceneContext already provides location, pov, and participants
  // - proseProfile's "stance" setting already establishes POV rules (close_third, etc.)
  // Logic context focuses on scene-specific knowledge boundaries and deltas.

  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE STATE (POV's knowledge at scene start vs. what they learn)
  // ═══════════════════════════════════════════════════════════════════════════
  if (pov) {
    const povKnowledge = getCharacterKnowledge(pov.id);
    // Knowledge being added to POV this scene — they don't have it at the START
    const povLearnsNodes = scene.worldDeltas
      .filter((km) => km.entityId === pov.id)
      .flatMap((km) => km.addedNodes ?? []);
    const povLearnsNodeIds = new Set(povLearnsNodes.map((n) => n.id));
    // POV's knowledge at scene START = timeline-scoped graph - things learned this scene
    const povStartKnowledge = povKnowledge.filter((kn) => !povLearnsNodeIds.has(kn.id));

    const knowledgeLines: string[] = [];
    if (povStartKnowledge.length > 0) {
      const items = povStartKnowledge.map((kn) => kn.content);
      knowledgeLines.push(`  <knows-at-start count="${povStartKnowledge.length}">${items.join(' | ')}</knows-at-start>`);
    }
    if (povLearnsNodes.length > 0) {
      for (const node of povLearnsNodes) {
        knowledgeLines.push(`  <learns-during-scene>${node.content}</learns-during-scene>`);
      }
    }
    if (knowledgeLines.length > 0) {
      sections.push(`<knowledge-state character="${pov.name}" role="pov">
${knowledgeLines.join('\n')}
  <constraint>Narration is limited to knowledge the POV possesses. Before any "learns-during-scene" moment, do not reference that information. Show genuine discovery, not dramatic irony from the narrator.</constraint>
</knowledge-state>`);
    }

    // Other entities learning this scene (non-POV)
    const grouped = new Map<string, string[]>();
    for (const km of scene.worldDeltas) {
      if (km.entityId === pov.id) continue;
      const entity = narrative.characters[km.entityId] ?? narrative.locations[km.entityId] ?? narrative.artifacts[km.entityId];
      if (!entity) continue;
      const name = entity.name;
      for (const node of km.addedNodes ?? []) {
        const list = grouped.get(name) ?? [];
        list.push(node.content);
        grouped.set(name, list);
      }
    }
    for (const [entityName, items] of grouped) {
      sections.push(`<knowledge-state entity="${entityName}" role="participant">
  ${items.map((i) => `<learns-during-scene>${i}</learns-during-scene>`).join('\n  ')}
  <constraint>Show ${entityName}'s discovery only through observable reaction — not internal thoughts.</constraint>
</knowledge-state>`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE ASYMMETRY (what others know that POV doesn't)
  // ═══════════════════════════════════════════════════════════════════════════
  if (pov) {
    const povKnowledge = getCharacterKnowledge(pov.id);
    const povKnowledgeIds = new Set(povKnowledge.map((kn) => kn.id));
    const povLearnsNodeIds = new Set(
      scene.worldDeltas
        .filter((km) => km.entityId === pov.id)
        .flatMap((km) => (km.addedNodes ?? []).map(n => n.id)),
    );

    const asymmetryLines: string[] = [];

    // Per-participant asymmetry
    for (const pid of scene.participantIds) {
      if (pid === pov.id) continue;
      const other = narrative.characters[pid];
      if (!other) continue;
      const otherKnowledge = getCharacterKnowledge(pid);
      const otherExclusive = otherKnowledge.filter(
        (kn) => !povKnowledgeIds.has(kn.id) && !povLearnsNodeIds.has(kn.id),
      );
      if (otherExclusive.length > 0) {
        const examples = otherExclusive.map((kn) => kn.content);
        asymmetryLines.push(`  <hidden-from-pov holder="${other.name}">${examples.join(' | ')}</hidden-from-pov>`);
      }
    }

    if (asymmetryLines.length > 0) {
      sections.push(`<knowledge-asymmetry pov="${pov.name}">
${asymmetryLines.join('\n')}
  <constraint>Do not reveal hidden knowledge through narration. ${pov.name} can only observe external behaviour and draw their own (possibly wrong) conclusions.</constraint>
</knowledge-asymmetry>`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THREAD MARKET UPDATES
  // ═══════════════════════════════════════════════════════════════════════════
  if (scene.threadDeltas.length > 0) {
    const threadLines = scene.threadDeltas.map((tm) => {
      const thread = narrative.threads[tm.threadId];
      const desc = thread?.description ?? tm.threadId;
      const moves = (tm.updates ?? [])
        .map((u) => `${u.outcome}${u.evidence >= 0 ? '+' : ''}${u.evidence}`)
        .join(' ');
      return `  <thread name="${desc}" logType="${tm.logType}" updates="${moves}" />`;
    });
    sections.push(`<threads hint="Each thread's market updates this scene — per-outcome evidence shifts logits, softmax renormalises">
${threadLines.join('\n')}
</threads>`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATIONSHIPS (static state + deltas)
  // ═══════════════════════════════════════════════════════════════════════════
  const baseRelationships = timelineState?.relationships ?? narrative.relationships;
  const participantRelationships = baseRelationships.filter(
    (r) => participantIdSet.has(r.from) && participantIdSet.has(r.to),
  );

  // Compute pre-scene valence by subtracting this scene's deltas
  const valenceDeltaMap = new Map<string, number>();
  for (const rm of scene.relationshipDeltas) {
    const key = `${rm.from}->${rm.to}`;
    valenceDeltaMap.set(key, (valenceDeltaMap.get(key) ?? 0) + rm.valenceDelta);
  }

  const relationshipLines: string[] = [];

  // Static relationships (no delta this scene) that are notably negative
  for (const r of participantRelationships) {
    const fromName = narrative.characters[r.from]?.name;
    const toName = narrative.characters[r.to]?.name;
    if (!fromName || !toName) continue;

    const key = `${r.from}->${r.to}`;
    const delta = valenceDeltaMap.get(key) ?? 0;
    if (delta !== 0) continue; // handled below in shifts

    const preSceneValence = Math.round((r.valence - delta) * 100) / 100;
    if (preSceneValence <= -0.5) {
      relationshipLines.push(`  <state from="${fromName}" to="${toName}" valence="${preSceneValence}" tone="hostile">${r.type}</state>`);
    } else if (preSceneValence <= -0.1) {
      relationshipLines.push(`  <state from="${fromName}" to="${toName}" valence="${preSceneValence}" tone="tense">${r.type}</state>`);
    }
  }

  // Relationship deltas
  for (const rm of scene.relationshipDeltas) {
    const fromName = narrative.characters[rm.from]?.name;
    const toName = narrative.characters[rm.to]?.name;
    if (!fromName || !toName) continue;
    const edge = baseRelationships.find((r) => r.from === rm.from && r.to === rm.to);
    const postValence = edge?.valence ?? 0;
    const preValence = Math.round((postValence - rm.valenceDelta) * 100) / 100;
    const delta = Math.round(rm.valenceDelta * 100) / 100;
    relationshipLines.push(`  <shift from="${fromName}" to="${toName}" start="${preValence}" delta="${delta >= 0 ? '+' : ''}${delta}" end="${Math.round(postValence * 100) / 100}" reason="${rm.type}" />`);
  }

  if (relationshipLines.length > 0) {
    sections.push(`<relationships hint="Interactions reflect these valences. In dramatic registers, shifts land through behaviour, dialogue, or action; in reflective or essayistic registers they may be named and attributed. Honour the declared register.">
${relationshipLines.join('\n')}
</relationships>`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REQUIRED EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  if (scene.events.length > 0) {
    const eventLines = scene.events.map((e) => `  <event>${e}</event>`);
    sections.push(`<events hint="All listed events must occur in this scene">
${eventLines.join('\n')}
</events>`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORLD KNOWLEDGE (reveals + connections + established references)
  // ═══════════════════════════════════════════════════════════════════════════
  if (scene.systemDeltas) {
    const wkm = scene.systemDeltas;
    const newNodeIds = new Set((wkm.addedNodes ?? []).map((n) => n.id));
    const worldLines: string[] = [];

    // New concepts being revealed
    for (const addedNode of wkm.addedNodes ?? []) {
      if (!addedNode.concept) continue;
      const shortConcept = addedNode.concept.includes(' — ') ? addedNode.concept.split(' — ')[0] : addedNode.concept;
      worldLines.push(`  <reveal concept="${shortConcept}" type="${addedNode.type}" status="new">Show through demonstration or consequence, not exposition. Do not reference before revelation.</reveal>`);
    }

    // New connections
    for (const edge of wkm.addedEdges ?? []) {
      if (!edge.from || !edge.to) continue;
      const fromNode = narrative.systemGraph?.nodes[edge.from] ?? wkm.addedNodes?.find((n) => n.id === edge.from);
      const toNode = narrative.systemGraph?.nodes[edge.to] ?? wkm.addedNodes?.find((n) => n.id === edge.to);
      if (fromNode?.concept && toNode?.concept) {
        const fromShort = fromNode.concept.includes(' — ') ? fromNode.concept.split(' — ')[0] : fromNode.concept;
        const toShort = toNode.concept.includes(' — ') ? toNode.concept.split(' — ')[0] : toNode.concept;
        worldLines.push(`  <connection from="${fromShort}" relation="${edge.relation}" to="${toShort}">Show through action, dialogue, or consequence.</connection>`);
      }
    }

    // Existing concepts referenced
    const referencedExistingIds = new Set<string>();
    for (const edge of wkm.addedEdges ?? []) {
      if (!edge.from || !edge.to) continue;
      if (!newNodeIds.has(edge.from) && narrative.systemGraph?.nodes[edge.from]) referencedExistingIds.add(edge.from);
      if (!newNodeIds.has(edge.to) && narrative.systemGraph?.nodes[edge.to]) referencedExistingIds.add(edge.to);
    }
    if (referencedExistingIds.size > 0) {
      const established = [...referencedExistingIds].map((id) => {
        const node = narrative.systemGraph.nodes[id];
        return node?.concept ? (node.concept.includes(' — ') ? node.concept.split(' — ')[0] : node.concept) : id;
      });
      worldLines.push(`  <established hint="Can be referenced freely">${established.join(', ')}</established>`);
    }

    if (worldLines.length > 0) {
      sections.push(`<world-reveals>
${worldLines.join('\n')}
</world-reveals>`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHARACTER MOVEMENTS
  // ═══════════════════════════════════════════════════════════════════════════
  if (scene.characterMovements && Object.keys(scene.characterMovements).length > 0) {
    const movementLines = Object.entries(scene.characterMovements).map(([charId, mv]) => {
      const char = narrative.characters[charId];
      const newLoc = narrative.locations[mv.locationId];
      if (!char || !newLoc) return null;
      return `  <movement character="${char.name}" from="${location?.name ?? 'current'}" to="${newLoc.name}" transition="${mv.transition}" />`;
    }).filter(Boolean);
    if (movementLines.length > 0) {
      sections.push(`<movements hint="Characters start at scene location and transition during the scene — do not show them already at destination">
${movementLines.join('\n')}
</movements>`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ARTIFACTS (possessions + location items + transfers)
  // ═══════════════════════════════════════════════════════════════════════════
  const artifacts = narrative.artifacts ?? {};
  const getArtifactOwner = (a: { id: string; parentId: string | null }) =>
    timelineState?.artifactOwnership[a.id] ?? a.parentId;
  const getArtifactCapabilities = (a: { world: { nodes: Record<string, { id: string; content: string }> } }) => {
    const allArtNodes = Object.values(a.world.nodes);
    const nodes = timelineState
      ? allArtNodes.filter((n) => timelineState.liveNodeIds.has(n.id))
      : allArtNodes;
    return nodes.map((n) => n.content).join('; ');
  };

  const artifactLines: string[] = [];

  // Participant possessions
  for (const pid of scene.participantIds) {
    const char = narrative.characters[pid];
    if (!char) continue;
    const owned = Object.values(artifacts).filter((a) => getArtifactOwner(a) === pid);
    if (owned.length > 0) {
      for (const a of owned) {
        const capabilities = getArtifactCapabilities(a);
        artifactLines.push(`  <possession owner="${char.name}" artifact="${a.name}"${capabilities ? ` capabilities="${capabilities}"` : ''} />`);
      }
    }
  }

  // Artifacts at location
  if (location) {
    const atLocation = Object.values(artifacts).filter((a) => getArtifactOwner(a) === scene.locationId);
    for (const a of atLocation) {
      artifactLines.push(`  <at-location artifact="${a.name}" location="${location.name}">Can be discovered and acquired.</at-location>`);
    }
  }

  // World-owned artifacts — always available
  const worldOwned = Object.values(artifacts).filter((a) => !getArtifactOwner(a));
  for (const a of worldOwned) {
    const capabilities = getArtifactCapabilities(a);
    artifactLines.push(`  <world-artifact artifact="${a.name}"${capabilities ? ` capabilities="${capabilities}"` : ''}>Communally available to all.</world-artifact>`);
  }

  // Ownership transfers
  for (const om of scene.ownershipDeltas ?? []) {
    const art = artifacts[om.artifactId];
    if (!art) continue;
    const fromName = resolveEntityName(narrative, om.fromId);
    const toName = resolveEntityName(narrative, om.toId);
    artifactLines.push(`  <transfer artifact="${art.name}" from="${fromName}" to="${toName}">Dramatise: discovery, gift, theft, trade, or seizure.</transfer>`);
  }

  if (artifactLines.length > 0) {
    sections.push(`<artifacts>
${artifactLines.join('\n')}
</artifacts>`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSEMBLE FINAL OUTPUT
  // ═══════════════════════════════════════════════════════════════════════════
  if (sections.length === 0) return '';

  const povName = pov?.name ?? scene.povId ?? 'narrator';
  const locName = location?.name ?? scene.locationId;

  return `<logic-context scene="${scene.id}" pov="${povName}" location="${locName}">
${sections.join('\n\n')}
</logic-context>`;
}

/**
 * Summary context — a condensed running summary of the story up to the current scene.
 * Shows scene summaries grouped by arc with POV, location, and key thread activity.
 * Much lighter than branchContext — designed for quick orientation without full delta detail.
 */
export function outlineContext(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const keysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);

  // Group scenes by arc
  const arcForScene = new Map<string, string>();
  for (const arc of Object.values(n.arcs)) {
    for (const sid of arc.sceneIds) arcForScene.set(sid, arc.id);
  }

  // Build scene entries grouped by arc, with world commits as top-level markers between arcs.
  // The LAST entry in `keysUpToCurrent` is the "present" — the scene the cursor is on. It's
  // tagged with `present="true"` so any downstream LLM call reading this outline can anchor
  // every "now" claim against an explicit marker rather than inferring it from list position.
  type Section = { kind: 'arc'; arcName: string; entries: string[]; arcId: string } | { kind: 'world-commit'; line: string };
  const sections: Section[] = [];
  const arcGroupMap = new Map<string, Section & { kind: 'arc' }>();
  const lastKey = keysUpToCurrent[keysUpToCurrent.length - 1];

  let sceneNum = 0;
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (!entry) continue;
    const isLatest = k === lastKey;
    const presentAttr = isLatest ? ' present="true"' : '';

    if (entry.kind === 'world_build') {
      sections.push({ kind: 'world-commit', line: `<world-commit${presentAttr}>${entry.summary}</world-commit>` });
      continue;
    }

    sceneNum++;
    const arcId = arcForScene.get(entry.id);
    const arc = arcId ? n.arcs[arcId] : null;

    let group: Section & { kind: 'arc' };
    if (arcId && arcGroupMap.has(arcId)) {
      group = arcGroupMap.get(arcId)!;
    } else {
      const name = arc?.name ?? 'Standalone';
      group = { kind: 'arc', arcName: name, entries: [], arcId: arcId ?? '' };
      if (arcId) arcGroupMap.set(arcId, group);
      sections.push(group);
    }

    const povName = entry.povId ? (n.characters[entry.povId]?.name ?? entry.povId) : 'narrator';
    const locName = n.locations[entry.locationId]?.name ?? entry.locationId;
    // Match the metadata richness of narrativeContext's <entry> tags so the
    // outline can be read with the same pacing/transition signals: time-gap
    // (elapsed since prior scene) + transition (natural-language phrase).
    const timeGap = entry.timeDelta ? formatTimeDelta(entry.timeDelta) : '';
    const timeGapAttr = timeGap ? ` time-gap="${timeGap}"` : '';
    const transitionPhrase = entry.timeDelta?.transition?.trim();
    const transitionAttr = transitionPhrase
      ? ` transition="${transitionPhrase.replace(/"/g, '&quot;')}"`
      : '';
    group.entries.push(
      `  <scene index="${sceneNum}" pov="${povName}" location="${locName}"${timeGapAttr}${transitionAttr}${presentAttr}>${entry.summary}</scene>`,
    );
  }

  // Mark the arc that contains the present scene so the LLM can spot the
  // active arc at a glance — independent of the per-scene marker.
  const latestEntry = lastKey ? resolveEntry(n, lastKey) : null;
  const latestArcId = latestEntry?.kind === 'scene' ? arcForScene.get(latestEntry.id) : undefined;

  // Format sections
  const arcSections = sections.map((s) => {
    if (s.kind === 'world-commit') return s.line;
    const presentAttr = latestArcId && s.arcId === latestArcId ? ' present="true"' : '';
    return `<arc name="${s.arcName}"${presentAttr}>\n${s.entries.join('\n')}\n</arc>`;
  }).join('\n\n');

  return `<story-summary title="${n.title}" scenes="${sceneNum}" hint="Scenes grouped by arc, chronological. present=\"true\" marks the cursor's position and its arc. Everything after is unwritten.">
${arcSections}
</story-summary>`;
}

// ── Future-scenario context ──────────────────────────────────────────────
//
// Compact XML shorthand of the head arc's Future scenarios — the
// alternate-futures cohort the user has been shaping in the Variables
// view. Designed for chat: every scenario's logit, softmax probability,
// rarity tag, description, reasoning, and variable coordination ride along in
// a structure dense enough to discuss but light enough not to crowd the
// prompt. Pair with the narrative title + head arc state so the chat can
// reason about *why* these scenarios are plausible.

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function futureRarityLabel(logit: number): string {
  if (logit >= 3) return 'expected';
  if (logit >= 1) return 'likely';
  if (logit >= -1) return 'even';
  if (logit >= -3) return 'rare';
  return 'tail-event';
}

const FUTURE_INTENSITY_LABELS = ['off', 'weak', 'mild', 'strong', 'extreme'];

/** Resolve the arc the user is currently viewing — derived from the
 *  scene at `currentIndex`. Returns null when the position is a
 *  world commit or otherwise has no arc context. */
function arcAtIndex(n: NarrativeState, resolvedKeys: string[], currentIndex: number) {
  const key = resolvedKeys[currentIndex];
  if (!key) return null;
  const scene = n.scenes[key];
  if (!scene || !scene.arcId) return null;
  return n.arcs[scene.arcId] ?? null;
}

/**
 * Build the XML context for the Future chat mode. Returns a string with
 * a `<future>` root, one `<scenario>` per planning scenario on the
 * currently-viewed arc, and a small `<rarity-scale>` legend so the chat
 * knows what the rarity words mean. Returns an empty string when the
 * current position is a world commit, has no arc, or the arc has no
 * scenarios — the caller gates the Future option on
 * `hasFutureScenarios(n, resolvedKeys, currentIndex)` returning true.
 */
export function futureContext(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  // Future is anchored on the arc the user is currently viewing — not
  // the head arc — so a user can step back to a prior arc and discuss
  // the scenarios that were generated there.
  const arc = arcAtIndex(n, resolvedKeys, currentIndex);
  if (!arc) return '';
  const headArc = arc;
  const scenarios = (headArc.planningScenarios ?? []).filter(
    (s) => Array.isArray(s.variables) && s.variables.length > 0,
  );
  if (scenarios.length === 0) return '';

  // Softmax over priorLogits — the same probability model the Variables
  // view + Experimentation panel use. Wraps the scenario in a probability
  // that's relative to its cohort.
  const logits = scenarios.map((s) => (typeof s.priorLogit === 'number' ? s.priorLogit : 0));
  const maxL = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxL));
  const sumExp = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = exps.map((e) => e / sumExp);

  // Sort by descending probability so the chat sees the front-runners
  // first — same ordering as the scenarios sidebar.
  const indexed = scenarios.map((s, i) => ({ s, p: probs[i], l: logits[i] }));
  indexed.sort((a, b) => b.p - a.p);

  const scenarioBlocks = indexed.map(({ s, p, l }, rank) => {
    const rarity = futureRarityLabel(l);
    const description = s.description
      ? `\n  <description>${xmlEscape(s.description)}</description>`
      : '';
    const reasoning = s.reasoning
      ? `\n  <reasoning>${xmlEscape(s.reasoning)}</reasoning>`
      : '';
    // Variables ordered by intensity desc — the load-bearing ones lead.
    const orderedVars = [...s.variables]
      .filter((v) => v.intensity > 0)
      .sort((a, b) => b.intensity - a.intensity);
    const varLines = orderedVars.map((v) => {
      const intensity = Math.max(0, Math.min(4, Math.round(v.intensity)));
      const intensityLabel = FUTURE_INTENSITY_LABELS[intensity] ?? '?';
      const cat = v.category ? ` category="${xmlEscape(v.category)}"` : '';
      const desc = v.description
        ? `>${xmlEscape(v.description)}</variable>`
        : ' />';
      return `    <variable name="${xmlEscape(v.name)}" intensity="${intensity}" intensity-label="${intensityLabel}"${cat}${desc}`;
    });
    const varsBlock = varLines.length > 0
      ? `\n  <variables count="${orderedVars.length}">\n${varLines.join('\n')}\n  </variables>`
      : '';

    return `<scenario rank="${rank + 1}" name="${xmlEscape(s.name)}" prob="${(p * 100).toFixed(1)}%" logit="${l.toFixed(2)}" rarity="${rarity}">${description}${reasoning}${varsBlock}
</scenario>`;
  });

  // Optional Present block — gives the chat a "where we are now" anchor
  // it can contrast the scenarios against.
  const presentBlock = (() => {
    const pv = headArc.presentVariables;
    if (!pv || pv.length === 0) return '';
    const presentVars = pv
      .filter((v) => v.intensity > 0)
      .sort((a, b) => b.intensity - a.intensity)
      .map((v) => {
        const intensity = Math.max(0, Math.min(4, Math.round(v.intensity)));
        const label = FUTURE_INTENSITY_LABELS[intensity] ?? '?';
        return `    <variable name="${xmlEscape(v.name)}" intensity="${intensity}" intensity-label="${label}" />`;
      });
    const description = headArc.presentDescription ? `\n  <description>${xmlEscape(headArc.presentDescription)}</description>` : '';
    const reasoning = headArc.presentReasoning
      ? `\n  <reasoning>${xmlEscape(headArc.presentReasoning)}</reasoning>`
      : '';
    const logitAttr = typeof headArc.presentLogit === 'number'
      ? ` logit="${headArc.presentLogit.toFixed(2)}" rarity="${futureRarityLabel(headArc.presentLogit)}"`
      : '';
    return `\n<present${logitAttr}>${description}${reasoning}
  <variables count="${presentVars.length}">
${presentVars.join('\n')}
  </variables>
</present>\n`;
  })();

  return `<future arc="${xmlEscape(headArc.name)}" scenarios="${scenarios.length}" hint="Cohort of plausible next-arc futures. Each scenario is a coordination of variables with a softmax probability over the cohort and a logit on the [-4,+4] evidence scale. Rarity is the natural-language descriptor for that logit.">
<rarity-scale>
  <level logit-range="[3, 4]">expected</level>
  <level logit-range="[1, 3)">likely</level>
  <level logit-range="(-1, 1)">even</level>
  <level logit-range="(-3, -1]">rare</level>
  <level logit-range="[-4, -3]">tail-event</level>
</rarity-scale>
${presentBlock}${scenarioBlocks.join('\n')}
</future>`;
}

/** Lightweight gate so callers can hide the Future option when there's
 *  nothing to inspect. Tied to the currently-viewed scene's arc — a
 *  world commit position or an arc with no scenarios both return false,
 *  so the dropdown can be conditionally shown. */
export function hasFutureScenarios(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): boolean {
  const arc = arcAtIndex(n, resolvedKeys, currentIndex);
  if (!arc) return false;
  return (arc.planningScenarios ?? []).some(
    (s) => Array.isArray(s.variables) && s.variables.length > 0,
  );
}

// ── Mode (Phase Reasoning Graph) chat context ───────────────────────────
//
// Mirrors `futureContext` shape — an XML data block dense enough for the
// chat to reason about but light enough not to crowd the prompt. The Mode
// graph is the META MACHINERY of the work (patterns, conventions,
// attractors, agents, rules, pressures, landmarks) so the chat surface
// here is "what's the working model of reality" — orthogonal to Future's
// "what are the alternate next-arc unfoldings".

/** Build the XML context for the Mode chat surface. Renders the currently
 *  active Mode (Phase Reasoning Graph) — its summary, optional guidance,
 *  every node's universal inference-shape, and the same sequential-path
 *  rendering the downstream pipeline reads — wrapped in a `<mode>` root.
 *  Returns an empty string when there is no active Mode. */
export function modeContext(n: NarrativeState): string {
  const graph = getActiveMode(n);
  if (!graph || !graph.nodes || graph.nodes.length === 0) return '';
  const guidance = graph.guidance
    ? `\n  <guidance>${xmlEscape(graph.guidance)}</guidance>`
    : '';
  // Each node's full inference-shape rendered as XML so the chat can
  // reason about machinery facets the prompt-side sequential-path block
  // also emits (× considered, ! breaks, ⇒ opens) but in a structured form
  // the chat can quote and audit.
  const nodeBlocks = [...graph.nodes]
    .sort((a, b) => a.index - b.index)
    .map((node) => {
      const detail = node.detail ? `\n    <detail>${xmlEscape(node.detail)}</detail>` : '';
      const considered = node.considered
        ? `\n    <considered>${xmlEscape(node.considered)}</considered>`
        : '';
      const breaks = node.breaks
        ? `\n    <breaks>${xmlEscape(node.breaks)}</breaks>`
        : '';
      const opens = node.opens
        ? `\n    <opens>${xmlEscape(node.opens)}</opens>`
        : '';
      const entityAttr = node.entityId ? ` entityId="${xmlEscape(node.entityId)}"` : '';
      const threadAttr = node.threadId ? ` threadId="${xmlEscape(node.threadId)}"` : '';
      const systemAttr = node.systemNodeId ? ` systemNodeId="${xmlEscape(node.systemNodeId)}"` : '';
      return `  <node index="${node.index}" type="${node.type}" id="${xmlEscape(node.id)}" label="${xmlEscape(node.label)}"${entityAttr}${threadAttr}${systemAttr}>${detail}${considered}${breaks}${opens}
  </node>`;
    })
    .join('\n');
  // Same sequential-path rendering used downstream — gives the chat the
  // edge-bidirectional view at a glance.
  const sequentialPath = buildSequentialPath({ nodes: graph.nodes, edges: graph.edges });
  return `<mode name="${xmlEscape(graph.name ?? 'mode')}" nodes="${graph.nodes.length}" edges="${graph.edges.length}" hint="The META MACHINERY of this work — the structural underpinnings (economy, conventions, attractors, agents, rules, pressures, landmarks) downstream reasoning operates on top of. Node types encode temporal stance: pattern=currently-active, convention=currently-followed, attractor=future-pointing, agent=currently-driving, rule=currently-binding, pressure=accumulating-toward-discharge, landmark=past-but-anchoring. Each node carries the universal inference-shape (detail, × considered = rival readings, ! breaks = carve-outs, ⇒ opens = downstream cascade).">
  <summary>${xmlEscape(graph.summary)}</summary>${guidance}
${nodeBlocks}
  <sequential-path>
${sequentialPath}
  </sequential-path>
</mode>`;
}

/** Lightweight gate — true when a Mode is active and has at least one
 *  node. ChatPanel uses this to conditionally show the Mode option in the
 *  context-mode dropdown. */
export function hasMode(n: NarrativeState): boolean {
  const graph = getActiveMode(n);
  return !!graph && Array.isArray(graph.nodes) && graph.nodes.length > 0;
}

// ── Investigation (active CRG) chat context ─────────────────────────────
//
// Mirrors modeContext / futureContext shape but anchored on the active
// investigation for the currently-viewed arc. The CRG is the work's
// in-arc reasoning surface (what's happening and why right now), so this
// pairs naturally with the outline recap — outline says how the world
// got here, the investigation graph says how the analyst is currently
// reasoning about it.

/** Resolve the active investigation for the arc at the current cursor.
 *  When `selectedInvestigationId` matches an investigation on that arc
 *  it wins; otherwise we fall back to the first investigation by
 *  createdAt, matching CanvasTopBar's resolution. Returns null when the
 *  cursor is on a world commit or the arc has no investigations. */
function activeInvestigationAtIndex(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  selectedInvestigationId: string | null | undefined,
) {
  const arc = arcAtIndex(n, resolvedKeys, currentIndex);
  if (!arc) return null;
  const list = Object.values(n.investigations ?? {})
    .filter((inv) => inv.arcId === arc.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (list.length === 0) return null;
  if (selectedInvestigationId) {
    const sel = list.find((inv) => inv.id === selectedInvestigationId);
    if (sel) return sel;
  }
  return list[0];
}

/** Build the XML context for the Investigation chat surface. Renders the
 *  active investigation's CRG — direction, every node's universal
 *  inference-shape, and the sequential-path the downstream pipeline reads
 *  — wrapped in an `<investigation>` root. Returns an empty string when
 *  no investigation is available for the current arc. */
export function investigationContext(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  selectedInvestigationId: string | null | undefined,
): string {
  const inv = activeInvestigationAtIndex(n, resolvedKeys, currentIndex, selectedInvestigationId);
  if (!inv) return '';
  const graph = inv.graph;
  if (!graph || !graph.nodes || graph.nodes.length === 0) return '';
  const title = inv.title ? ` title="${xmlEscape(inv.title)}"` : '';
  const direction = inv.direction
    ? `\n  <direction>${xmlEscape(inv.direction)}</direction>`
    : '';
  // Per-node inference-shape — same XML rendering modeContext uses so
  // the chat reads CRG and PRG nodes with the same vocabulary.
  const nodeBlocks = [...graph.nodes]
    .sort((a, b) => a.index - b.index)
    .map((node) => {
      const detail = node.detail ? `\n    <detail>${xmlEscape(node.detail)}</detail>` : '';
      const considered = node.considered
        ? `\n    <considered>${xmlEscape(node.considered)}</considered>`
        : '';
      const breaks = node.breaks
        ? `\n    <breaks>${xmlEscape(node.breaks)}</breaks>`
        : '';
      const opens = node.opens
        ? `\n    <opens>${xmlEscape(node.opens)}</opens>`
        : '';
      const entityAttr = node.entityId ? ` entityId="${xmlEscape(node.entityId)}"` : '';
      const threadAttr = node.threadId ? ` threadId="${xmlEscape(node.threadId)}"` : '';
      const systemAttr = node.systemNodeId ? ` systemNodeId="${xmlEscape(node.systemNodeId)}"` : '';
      return `  <node index="${node.index}" type="${node.type}" id="${xmlEscape(node.id)}" label="${xmlEscape(node.label)}"${entityAttr}${threadAttr}${systemAttr}>${detail}${considered}${breaks}${opens}
  </node>`;
    })
    .join('\n');
  const sequentialPath = buildSequentialPath({ nodes: graph.nodes, edges: graph.edges });
  return `<investigation id="${xmlEscape(inv.id)}" arc="${xmlEscape(graph.arcName)}" source="${inv.source}"${title} nodes="${graph.nodes.length}" edges="${graph.edges.length}" hint="The active per-arc Causal Reasoning Graph (CRG) — the analyst's in-arc inference about what's happening and why. Nodes span substrate refs (character/location/artifact/system/fate), inference steps (reasoning), meta agents (pattern/warning), and outside-force injections (chaos). Each inference-tier node carries the universal inference-shape: detail, × considered = rejected siblings, ! breaks = falsification condition, ⇒ opens = downstream cascade.">
  <summary>${xmlEscape(graph.summary)}</summary>${direction}
${nodeBlocks}
  <sequential-path>
${sequentialPath}
  </sequential-path>
</investigation>`;
}

/** Lightweight gate — true when the current arc has at least one
 *  investigation. ChatPanel uses this to conditionally show the
 *  Investigation option. */
export function hasInvestigation(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): boolean {
  const arc = arcAtIndex(n, resolvedKeys, currentIndex);
  if (!arc) return false;
  return Object.values(n.investigations ?? {}).some((inv) => inv.arcId === arc.id);
}

// ── Game-theory chat context ──────────────────────────────────────────
//
// Outline view enriched with per-scene game-theory analysis. For every
// scene up to the cursor, the scene summary is followed by every BeatGame
// the LLM analysis pass produced for that scene — axis, type, realized
// actions, the rationale that explains why the author landed on the
// realized cell. A player-rankings tail block summarises current ELO,
// peak/trough, and win/loss/draw counts across the resolved branch.
// Designed for chat questions like "where did Harry's ELO drop and why"
// or "is the realized cell a Nash in the scene-X coordination problem".
//
// Scenes with no gameAnalysis still render so the outline stays
// chronologically complete; they just omit the <game-theory> tail.

/** True when at least one scene on the resolved branch carries
 *  gameAnalysis. ChatPanel gates the dropdown option off this. */
export function hasGameTheory(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): boolean {
  const limit = Math.min(currentIndex, resolvedKeys.length - 1);
  for (let i = 0; i <= limit; i++) {
    const scene = n.scenes[resolvedKeys[i]];
    if (scene?.kind !== 'scene') continue;
    const games = scene.gameAnalysis?.games ?? [];
    if (games.length > 0) return true;
  }
  return false;
}

export function gameTheoryContext(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const limit = Math.min(currentIndex, resolvedKeys.length - 1);
  const keysUpToCurrent = resolvedKeys.slice(0, limit + 1);

  // Same arc-grouped scaffolding as outlineContext so the chat reads as
  // an enriched outline rather than a flat game list.
  const arcForScene = new Map<string, string>();
  for (const arc of Object.values(n.arcs)) {
    for (const sid of arc.sceneIds) arcForScene.set(sid, arc.id);
  }

  type Section =
    | { kind: 'arc'; arcName: string; entries: string[]; arcId: string }
    | { kind: 'world-commit'; line: string };
  const sections: Section[] = [];
  const arcGroupMap = new Map<string, Section & { kind: 'arc' }>();
  const lastKey = keysUpToCurrent[keysUpToCurrent.length - 1];

  // Collect every BeatGame in scene-order so the player-ranking tail
  // reflects the same cut the operator is looking at.
  const orderedGames: NonNullable<Scene['gameAnalysis']>['games'] = [];

  // Running ELO state — updated as each game is rendered so the
  // <elo-after> tags carry the operator's continuous perspective on
  // rating drift, rather than collapsing to summary at the tail. Peak
  // / trough / W / L / D are tracked alongside for the final-rankings
  // block; no second pass needed.
  const eloByPlayer = new Map<string, number>();
  const peakByPlayer = new Map<string, number>();
  const troughByPlayer = new Map<string, number>();
  const playerNameById = new Map<string, string>();
  const recordByPlayer = new Map<
    string,
    { games: number; wins: number; losses: number; draws: number }
  >();

  let sceneNum = 0;
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (!entry) continue;
    const isLatest = k === lastKey;
    const presentAttr = isLatest ? ' present="true"' : '';

    if (entry.kind === 'world_build') {
      sections.push({
        kind: 'world-commit',
        line: `<world-commit${presentAttr}>${xmlEscape(entry.summary)}</world-commit>`,
      });
      continue;
    }

    sceneNum++;
    const arcId = arcForScene.get(entry.id);
    const arc = arcId ? n.arcs[arcId] : null;

    let group: Section & { kind: 'arc' };
    if (arcId && arcGroupMap.has(arcId)) {
      group = arcGroupMap.get(arcId)!;
    } else {
      const name = arc?.name ?? 'Standalone';
      group = { kind: 'arc', arcName: name, entries: [], arcId: arcId ?? '' };
      if (arcId) arcGroupMap.set(arcId, group);
      sections.push(group);
    }

    const povName = entry.povId
      ? (n.characters[entry.povId]?.name ?? entry.povId)
      : 'narrator';
    const locName = n.locations[entry.locationId]?.name ?? entry.locationId;
    const timeGap = entry.timeDelta ? formatTimeDelta(entry.timeDelta) : '';
    const timeGapAttr = timeGap ? ` time-gap="${timeGap}"` : '';

    const games = (entry as Scene).gameAnalysis?.games ?? [];
    for (const g of games) orderedGames.push(g);

    const gameBlock = games.length > 0
      ? `\n    <game-theory count="${games.length}">\n${games
          .map((g) => renderGameXml(g, eloByPlayer, playerNameById, peakByPlayer, troughByPlayer, recordByPlayer))
          .join('\n')}\n    </game-theory>`
      : '';

    group.entries.push(
      `  <scene index="${sceneNum}" pov="${xmlEscape(povName)}" location="${xmlEscape(locName)}"${timeGapAttr}${presentAttr}>${xmlEscape(entry.summary)}${gameBlock}\n  </scene>`,
    );
  }

  const latestEntry = lastKey ? resolveEntry(n, lastKey) : null;
  const latestArcId =
    latestEntry?.kind === 'scene' ? arcForScene.get(latestEntry.id) : undefined;

  const arcSections = sections
    .map((s) => {
      if (s.kind === 'world-commit') return s.line;
      const presentAttr =
        latestArcId && s.arcId === latestArcId ? ' present="true"' : '';
      return `<arc name="${xmlEscape(s.arcName)}"${presentAttr}>\n${s.entries.join('\n')}\n</arc>`;
    })
    .join('\n\n');

  // Final-state rankings — sorted by current ELO descending so dominant
  // players surface first. Same peak / trough / W / L / D the per-game
  // updates carry, but consolidated at the end so the LLM has a stable
  // closing reference. The trajectory itself lives inline with each
  // <elo-after> emitted per game.
  type PlayerRow = {
    id: string;
    name: string;
    currentElo: number;
    peakElo: number;
    troughElo: number;
    games: number;
    wins: number;
    losses: number;
    draws: number;
  };
  const rows: PlayerRow[] = [];
  for (const [id, currentElo] of eloByPlayer) {
    const record = recordByPlayer.get(id) ?? { games: 0, wins: 0, losses: 0, draws: 0 };
    rows.push({
      id,
      name: playerNameById.get(id) ?? id,
      currentElo,
      peakElo: peakByPlayer.get(id) ?? currentElo,
      troughElo: troughByPlayer.get(id) ?? currentElo,
      games: record.games,
      wins: record.wins,
      losses: record.losses,
      draws: record.draws,
    });
  }
  rows.sort((a, b) => b.currentElo - a.currentElo);

  const rankingsBlock = rows.length > 0
    ? `\n<player-rankings count="${rows.length}" hint="Final ELO after the last game in the resolved branch. Trajectories are interleaved inline as <elo-after> per game so the LLM can read drift over time without re-deriving it here.">\n${rows
        .map(
          (r) =>
            `  <player name="${xmlEscape(r.name)}" current-elo="${Math.round(r.currentElo)}" peak="${Math.round(r.peakElo)}" trough="${Math.round(r.troughElo)}" games="${r.games}" wins="${r.wins}" losses="${r.losses}" draws="${r.draws}" />`,
        )
        .join('\n')}\n</player-rankings>`
    : '';

  return `<story-outline-with-game-theory title="${xmlEscape(n.title)}" scenes="${sceneNum}" games="${orderedGames.length}" hint="Outline grouped by arc, chronological. Each scene's <game-theory> tail lists every BeatGame: axis + type + full payoff matrix (<cell> per pairing, deltaA/deltaB stake changes, nash flag, realized flag), Nash equilibria summary, stake-rank of the realized cell, margin score, and a running <elo-after> tag showing both players' ELO before→after the game. A final <player-rankings> tail summarises end-state ELO. present=\\"true\\" marks the cursor's position.">
${arcSections}${rankingsBlock}
</story-outline-with-game-theory>`;
}

/** Render a single BeatGame as XML with the full payoff matrix, Nash
 *  analysis, stake-rank of the realized cell, margin score, and a
 *  running ELO update. Mutates the per-player running maps so the
 *  caller can produce a closing summary in O(players) without a
 *  second pass. */
function renderGameXml(
  g: import('@/types/narrative').BeatGame,
  eloByPlayer: Map<string, number>,
  playerNameById: Map<string, string>,
  peakByPlayer: Map<string, number>,
  troughByPlayer: Map<string, number>,
  recordByPlayer: Map<
    string,
    { games: number; wins: number; losses: number; draws: number }
  >,
): string {
  // Track names so the closing rankings can resolve ids → display
  // names without re-walking the game list.
  if (g.playerAId) playerNameById.set(g.playerAId, g.playerAName);
  if (g.playerBId) playerNameById.set(g.playerBId, g.playerBName);

  const aBefore = eloByPlayer.get(g.playerAId) ?? ELO_INITIAL;
  const bBefore = eloByPlayer.get(g.playerBId) ?? ELO_INITIAL;
  const score = gameScoreA(g);
  const margin = gameMarginScore(g);
  const [aAfter, bAfter] = eloUpdate(aBefore, bBefore, margin);
  eloByPlayer.set(g.playerAId, aAfter);
  eloByPlayer.set(g.playerBId, bAfter);

  // Track peak / trough / W / L / D in the same walk so the closing
  // rankings block reads it off without a second pass.
  const noteRating = (id: string, rating: number) => {
    const peak = peakByPlayer.get(id);
    if (peak === undefined || rating > peak) peakByPlayer.set(id, rating);
    const trough = troughByPlayer.get(id);
    if (trough === undefined || rating < trough) troughByPlayer.set(id, rating);
  };
  noteRating(g.playerAId, aBefore);
  noteRating(g.playerAId, aAfter);
  noteRating(g.playerBId, bBefore);
  noteRating(g.playerBId, bAfter);
  const bumpRecord = (id: string, kind: 'wins' | 'losses' | 'draws') => {
    const r =
      recordByPlayer.get(id) ?? { games: 0, wins: 0, losses: 0, draws: 0 };
    r.games += 1;
    r[kind] += 1;
    recordByPlayer.set(id, r);
  };
  if (score === 0.5) {
    bumpRecord(g.playerAId, 'draws');
    bumpRecord(g.playerBId, 'draws');
  } else if (score === 1) {
    bumpRecord(g.playerAId, 'wins');
    bumpRecord(g.playerBId, 'losses');
  } else {
    bumpRecord(g.playerAId, 'losses');
    bumpRecord(g.playerBId, 'wins');
  }

  const winner =
    score === 1
      ? xmlEscape(g.playerAName)
      : score === 0
        ? xmlEscape(g.playerBName)
        : 'tie';

  // Nash equilibria — the equilibrium cells the LLM should reason
  // against when the realized cell is dominated.
  const ne = nashEquilibria(g);
  const realizedNash = realizedIsNash(g);
  const nashSet = new Set(ne.map((c) => `${c.aActionName}|${c.bActionName}`));

  // Stake rank — where the realized cell sits in each player's
  // preference order over the whole grid.
  const rankA = stakeRank(g, 'A');
  const rankB = stakeRank(g, 'B');
  const realizedCell = realizedOutcome(g);

  // Full payoff matrix — every (A, B) action pairing with stake
  // deltas. Mark Nash + realized + dominant-for-side cells so the LLM
  // can read who-walked-from-what at a glance.
  const matrixCells = g.outcomes
    .map((cell) => {
      const isNash = nashSet.has(`${cell.aActionName}|${cell.bActionName}`);
      const isRealized =
        realizedCell?.aActionName === cell.aActionName &&
        realizedCell?.bActionName === cell.bActionName;
      const flags = [
        isNash ? ' nash="true"' : '',
        isRealized ? ' realized="true"' : '',
      ].join('');
      return `        <cell a="${xmlEscape(cell.aActionName)}" b="${xmlEscape(cell.bActionName)}" deltaA="${cell.stakeDeltaA}" deltaB="${cell.stakeDeltaB}"${flags} />`;
    })
    .join('\n');

  // Action menus — render once so the matrix is interpretable
  // without re-parsing every cell's label.
  const aActionList = g.playerAActions.map((a) => a.name).join(' | ');
  const bActionList = g.playerBActions.map((a) => a.name).join(' | ');

  const nashSummary =
    ne.length === 0
      ? 'none'
      : ne
          .map((c) => `${xmlEscape(c.aActionName)}/${xmlEscape(c.bActionName)}`)
          .join(', ');

  const rankSummary = (() => {
    const parts: string[] = [];
    if (rankA) parts.push(`A@${rankA.rank}/${rankA.total}`);
    if (rankB) parts.push(`B@${rankB.rank}/${rankB.total}`);
    return parts.length > 0 ? parts.join(' ') : 'n/a';
  })();

  // Deltas in absolute and signed form so the LLM can quote either.
  const aDeltaSigned = aAfter - aBefore >= 0 ? `+${(aAfter - aBefore).toFixed(1)}` : (aAfter - aBefore).toFixed(1);
  const bDeltaSigned = bAfter - bBefore >= 0 ? `+${(bAfter - bBefore).toFixed(1)}` : (bAfter - bBefore).toFixed(1);

  return [
    `      <game type="${xmlEscape(g.gameType)}" axis="${xmlEscape(g.actionAxis)}"`,
    ` playerA="${xmlEscape(g.playerAName)}" playerB="${xmlEscape(g.playerBName)}"`,
    ` realizedA="${xmlEscape(g.realizedAAction)}" realizedB="${xmlEscape(g.realizedBAction)}"`,
    ` winner="${winner}" margin="${margin.toFixed(2)}"`,
    ` nashCount="${ne.length}" realizedIsNash="${realizedNash}"`,
    ` stakeRank="${rankSummary}">\n`,
    `        <actions playerA="${xmlEscape(aActionList)}" playerB="${xmlEscape(bActionList)}" />\n`,
    `        <matrix nash="${xmlEscape(nashSummary)}">\n${matrixCells}\n        </matrix>\n`,
    `        <elo-after playerA-before="${Math.round(aBefore)}" playerA-after="${Math.round(aAfter)}" playerA-delta="${aDeltaSigned}" playerB-before="${Math.round(bBefore)}" playerB-after="${Math.round(bAfter)}" playerB-delta="${bDeltaSigned}" />\n`,
    `        <rationale>${xmlEscape(g.rationale ?? '')}</rationale>\n`,
    `      </game>`,
  ].join('');
}

