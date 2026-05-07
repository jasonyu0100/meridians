import type { NarrativeState, Scene, StorySettings, RelationshipEdge, WorldEdge, ProseProfile, SystemGraph } from '@/types/narrative';
import { resolveEntry, NARRATOR_AGENT_ID, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { buildCumulativeSystemGraph, getMarketBelief, getMarketMargin, getMarketProbs, isThreadAbandoned, isThreadClosed, rankSystemNodes, resolveEntityName, scenesSinceTouched } from '@/lib/narrative-utils';
import { classifyThreadCategory, computeRecentLogitEnergy } from '@/lib/thread-category';
import { ENTITY_LOG_CONTEXT_LIMIT, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE } from '@/lib/constants';
import { getIntroducedIds } from '@/lib/scene-filter';
import { describeTimeGap, formatTimeDelta } from '@/lib/time-deltas';
import { aggregateNetworkGraph, buildTierLookup, type NetworkNode } from '@/lib/network-graph';

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
): string {
  const fields = TIER_FIELDS[tier];
  const loc = n.locations[s.locationId]?.name ?? s.locationId;
  const povName = s.povId ? (n.characters[s.povId]?.name ?? s.povId) : 'narrator';
  // Compact time-gap so the planner/writer can see pacing across history —
  // e.g. "3 hours", "2 weeks", "concurrent". Rich guidance is still surfaced
  // on the active scene via sceneContext's <time-gap> block.
  const timeGap = s.timeDelta ? formatTimeDelta(s.timeDelta) : '';
  const timeGapAttr = timeGap ? ` time-gap="${timeGap}"` : '';

  // Stable scene metadata stays on the <entry> tag; all deltas become child
  // elements so the output is structured XML, not a pile of semicolon-joined
  // attribute strings.
  const openAttrs = `index="${globalIdx}" tier="${tier}" location="${loc}" pov="${povName}"${timeGapAttr}`;

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

  if (fields.threadTransitions && s.threadDeltas.length > 0) {
    const lines = s.threadDeltas.map((tm) => {
      const thr = n.threads[tm.threadId];
      const desc = thr ? thr.description : tm.threadId;
      const moves = (tm.updates ?? [])
        .map((u) => `${u.outcome}${u.evidence >= 0 ? '+' : ''}${u.evidence}`)
        .join(' ');
      return `    <shift thread="${desc}" logType="${tm.logType}" updates="${moves}" />`;
    });
    children.push(`  <threads>\n${lines.join('\n')}\n  </threads>`);
  }

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
    sections.push(`<principles hint="Fundamental truths — these MUST be obeyed.">\n${lines.join('\n')}\n</principles>`);
  }

  // Systems (organized mechanisms)
  if (byType['system']?.length) {
    const lines = byType['system'].map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <system id="${n.id}"${attrs(n.id)}>${n.concept}${connStr}</system>`;
    });
    sections.push(`<systems hint="Organized mechanisms — use these to drive conflict and reward preparation.">\n${lines.join('\n')}\n</systems>`);
  }

  // Constraints (hard limits)
  if (byType['constraint']?.length) {
    const lines = byType['constraint'].map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <constraint id="${n.id}"${attrs(n.id)}>${n.concept}${connStr}</constraint>`;
    });
    sections.push(`<constraints hint="Hard limits — costs, scarcity, boundaries that cannot be ignored.">\n${lines.join('\n')}\n</constraints>`);
  }

  // Tensions (unresolved forces)
  if (byType['tension']?.length) {
    const lines = byType['tension'].map((n) => {
      const conn = connections[n.id];
      const connStr = conn?.length ? ` [${conn.join('; ')}]` : '';
      return `  <tension id="${n.id}"${attrs(n.id)}>${n.concept}${connStr}</tension>`;
    });
    sections.push(`<tensions hint="Unresolved contradictions — sources of conflict.">\n${lines.join('\n')}\n</tensions>`);
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

  return `\n<system-graph nodes="${nodes.length}" edges="${validEdgeCount}" hint="Established system knowledge — principles, mechanisms, constraints, tensions. Scenes must operate within these truths. Connections shown as [relation→targetId] (outgoing) and [←relation sourceId] (incoming); reference existing IDs when relevant, new nodes need edges.">\n${sections.join('\n\n')}\n</system-graph>\n`;
}


/** Build a prompt block from story settings — returns empty string if all defaults */
export function buildStorySettingsBlock(n: NarrativeState): string {
  const s: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...n.storySettings };
  const lines: string[] = [];

  // POV mode
  const povLabels: Record<string, string> = {
    single: 'SINGLE POV — every scene must use the same POV character.',
    ensemble: 'ENSEMBLE POV — this is a TRUE ENSEMBLE narrative. Every designated POV character is a co-lead, not a supporting player. Each must drive their own thread(s), own significant arcs, and make decisions that change the world independently of the others. Screen time distributes roughly evenly across the cast — no single character dominates. Avoid the trap of one central anchor with occasional cutaways; that is Single POV in disguise. POV typically comes in STREAKS (2-4 scenes per character before switching) so each perspective has room to breathe, but across any given arc, multiple POVs should appear. When distributing thread ownership, no single POV owns the majority of the narrative stakes. For declared polyphonic, choral, or mosaic forms (e.g. Faulkner-style polyvocality, Caribbean polyvocal tradition, works built on per-scene rotation), per-scene or per-paragraph rotation IS the form — honour the declared form over the default streak length.',
    free: '', // no constraint
  };
  if (s.povMode !== 'free') {
    lines.push(povLabels[s.povMode]);
    if (s.povCharacterIds.length > 0) {
      const names = s.povCharacterIds
        .map((id) => n.characters[id] ? `${n.characters[id].name} (${id})` : id)
        .join(', ');
      lines.push(`Designated POV character${s.povCharacterIds.length > 1 ? 's' : ''}: ${names}. Only these characters may appear in the "povId" field.${s.povMode === 'ensemble' && s.povCharacterIds.length > 1 ? ` Distribute POV meaningfully across ALL ${s.povCharacterIds.length} of them — not concentrated on one.` : ''}`);
    } else if (s.povMode === 'ensemble') {
      lines.push(`No explicit POV cast has been designated. Commit to an ensemble of 3–5 anchor characters up front and rotate POV among them across the story. Track this commitment — do not silently collapse to a single dominant POV. Each chosen anchor must own at least one thread and accumulate comparable screen time over the full arc. If this is a fresh generation and no anchors yet exist, establish them in the first arc and maintain rotation thereafter.`);
    }
  } else if (s.povCharacterIds.length > 0) {
    const names = s.povCharacterIds
      .map((id) => n.characters[id] ? `${n.characters[id].name} (${id})` : id)
      .join(', ');
    lines.push(`FREE POV with preferred characters: ${names}. Favour these characters as POV when the scene fits their perspective, but you may use any character when a different vantage is narratively stronger.`);
  }

  // Story direction
  if (s.storyDirection.trim()) {
    lines.push(`STORY DIRECTION (high-level north star): ${s.storyDirection.trim()}`);
  }

  // Story constraints (negative prompt)
  if (s.storyConstraints.trim()) {
    lines.push(`STORY CONSTRAINTS (DO NOT do any of the following): ${s.storyConstraints.trim()}`);
  }

  // Narrative guidance (editorial principles)
  if (s.narrativeGuidance.trim()) {
    lines.push(`NARRATIVE GUIDANCE (editorial principles that govern how this story is told — scope discipline, reveal pacing, tonal rules, structural philosophy. These override default instincts):\n${s.narrativeGuidance.trim()}`);
  }

  // Story patterns (positive commandments)
  if (n.patterns && n.patterns.length > 0) {
    lines.push(`STORY PATTERNS (positive commandments — what makes this series good):\n${n.patterns.map(p => `• ${p}`).join('\n')}`);
  }

  // Story anti-patterns (negative commandments)
  if (n.antiPatterns && n.antiPatterns.length > 0) {
    lines.push(`STORY ANTI-PATTERNS (negative commandments — what to avoid):\n${n.antiPatterns.map(p => `• ${p}`).join('\n')}`);
  }

  if (lines.length === 0) return '';
  return `\n<narrative-settings>\n${lines.join('\n')}\n</narrative-settings>\n`;
}

/** Format network annotations as XML attributes for inline use on entity
 *  / thread / system render tags. Emits tier + attributions + topology —
 *  the shape all downstream consumers have converged on. Returns "" for
 *  absent nodes. */
function networkAttrs(node: NetworkNode | undefined): string {
  if (!node) return "";
  return ` tier="${node.tier}" attributions="${node.attributions}" topology="${node.topology}"`;
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

  // Helper: render continuity graph (nodes + edges) as XML — mirrors system knowledge rendering
  const renderContinuityXml = (nodes: { id: string; type: string; content: string }[], edges: WorldEdge[], indent: string) => {
    const nodeIds = new Set(nodes.map(n => n.id));
    const nodeLines = nodes.map((kn) => `${indent}<knowledge id="${kn.id}" type="${kn.type}">${kn.content}</knowledge>`);
    const relevantEdges = edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
    const edgeLines = relevantEdges.map(e => `${indent}<edge from="${e.from}" to="${e.to}" relation="${e.relation}" />`);
    return [...nodeLines, ...edgeLines];
  };

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
      const continuityLines = renderContinuityXml(recentNodes, c.world.edges, '  ');
      const owned = artifactsByOwner.get(c.id) ?? [];
      const artifactLines = owned.map((a) => {
        const recentArtNodes = tieredContinuity(a.world.nodes);
        const inner = renderContinuityXml(recentArtNodes, a.world.edges, '    ').join('\n');
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
      const continuityLines = renderContinuityXml(recentNodes, l.world.edges, '  ');
      const parent = l.parentId ? ` parent="${n.locations[l.parentId]?.name ?? l.parentId}"` : '';
      const owned = artifactsByOwner.get(l.id) ?? [];
      const artifactLines = owned.map((a) => {
        const recentArtNodes = tieredContinuity(a.world.nodes);
        const inner = renderContinuityXml(recentArtNodes, a.world.edges, '    ').join('\n');
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
      const outcomeSummary = t.outcomes
        .map((o, i) => `${o}=${(probs[i] ?? 0).toFixed(2)}`)
        .join(' · ');
      // Recency-tiered log entries: keep logs from near/mid scenes only. Older
      // log detail is carried by scene-history summaries.
      const logNodes = Object.values(t.threadLog?.nodes ?? {})
        .filter((ln) => keepThreadLogNode(ln.id))
        .slice(-ENTITY_LOG_CONTEXT_LIMIT);
      const logBlock = logNodes.length > 0
        ? `\n  <log>${logNodes.map((ln) => `[${ln.type}] ${ln.content}`).join(' | ')}</log>`
        : '';
      const horizonAttr = ` horizon="${t.horizon ?? 'medium'}"`;
      return `<thread id="${t.id}"${marketAttr}${horizonAttr}${age > 0 ? ` age="${age}" deltas="${deltas}"` : ''}${participantNames ? ` participants="${participantNames}"` : ''}${depsAttr}${networkAttrs(tierLookup.get(t.id))}>${t.description}\n  <market>${outcomeSummary}</market>${logBlock}\n</thread>`;
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
  // Tiered scene history with arc rollup for far entries — see classifyTier /
  // renderSceneEntry. Near/mid scenes render individually. Consecutive
  // far-tier scenes in the same arc collapse into a single arc-summary entry
  // (the arc's worldState snapshot is the compact chess-board memory). World
  // builds always render as a single summary line and force a flush.
  const tierCounts = { near: 0, mid: 0, far: 0, arcRollup: 0, farCompressed: 0 };
  const sceneEntries: string[] = [];
  type ArcBuffer = { arcId: string; firstIndex: number; lastIndex: number; sceneCount: number };
  let arcBuffer: ArcBuffer | null = null;

  const flushArc = () => {
    if (!arcBuffer) return;
    const arc = n.arcs[arcBuffer.arcId];
    const arcName = arc?.name ?? 'unnamed arc';
    const indicesAttr = arcBuffer.firstIndex === arcBuffer.lastIndex
      ? `index="${arcBuffer.firstIndex}"`
      : `indices="${arcBuffer.firstIndex}-${arcBuffer.lastIndex}"`;
    const body = arc?.worldState?.trim()
      || arc?.directionVector?.trim()
      || `${arcBuffer.sceneCount} scene${arcBuffer.sceneCount > 1 ? 's' : ''} elapsed — no chess-board snapshot recorded`;
    const compressionAttr = arcBuffer.sceneCount > 1 ? ` compresses="${arcBuffer.sceneCount}x"` : '';
    sceneEntries.push(
      `<entry ${indicesAttr} type="arc-summary" arc="${arcName}" scenes="${arcBuffer.sceneCount}"${compressionAttr}>\n  ${body}\n</entry>`,
    );
    tierCounts.arcRollup++;
    tierCounts.farCompressed += arcBuffer.sceneCount;
    arcBuffer = null;
  };

  for (let i = 0; i < keysUpToCurrent.length; i++) {
    const k = keysUpToCurrent[i];
    const s = resolveEntry(n, k);
    if (!s) continue;
    const globalIdx = i + 1;
    const distanceFromCurrent = totalEntries - 1 - i;

    if (s.kind === 'world_build') {
      flushArc();
      sceneEntries.push(`<entry index="${globalIdx}" type="world-build">${s.summary}</entry>`);
      continue;
    }

    const tier = classifyTier(distanceFromCurrent, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE);
    tierCounts[tier]++;

    if (tier === 'far' && s.arcId) {
      if (arcBuffer && arcBuffer.arcId !== s.arcId) flushArc();
      if (!arcBuffer) {
        arcBuffer = { arcId: s.arcId, firstIndex: globalIdx, lastIndex: globalIdx, sceneCount: 1 };
      } else {
        arcBuffer.lastIndex = globalIdx;
        arcBuffer.sceneCount++;
      }
      continue;
    }

    flushArc();
    sceneEntries.push(renderSceneEntry(n, s, globalIdx, tier));
  }
  flushArc();

  // Current world state — only shown when the CURRENT arc (the arc of the
  // most recent resolved scene) has a worldState of its own. Any older arc's
  // state is stale relative to the current scene and must not be surfaced —
  // a stale snapshot lies about the position. If the current arc has no
  // state yet, no world-state entry is emitted.
  for (let i = keysUpToCurrent.length - 1; i >= 0; i--) {
    const entry = resolveEntry(n, keysUpToCurrent[i]);
    if (!entry || entry.kind !== 'scene') continue;
    const arc = n.arcs[entry.arcId];
    if (arc?.worldState) {
      sceneEntries.push(
        `<entry type="world-state" arc="${arc.name}" hint="Current ground-truth compact state snapshot — chess-board position; supersedes replaying prior deltas.">\n  ${arc.worldState}\n</entry>`,
      );
    }
    break;
  }

  const sceneHistory = sceneEntries.join('\n');

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
  const historyNote = `${keysUpToCurrent.length} scenes — ${tierCounts.near} near, ${tierCounts.mid} mid, ${tierCounts.far} far.${compressionRatio} Arc-summary bodies are the chess-board snapshot for that span; treat them as ground truth and do not try to reconstruct individual scenes from them.`;

  return `<narrative title="${n.title}">
<network-annotations hint="Every character / location / artifact / thread / system node below carries cumulative reasoning-network attributes:
  tier (hot / warm / cold / fresh) — heat snapshot relative to the network
  attributions — total times referenced across reasoning graphs
  topology (bridge / hub / leaf / isolated) — position in the activation web (bridges connect ≥2 force cohorts; hubs are within-cohort centres)
Use these to decide what to deepen vs. what to surface — load-bearing nodes are bridges and hubs; cold nodes are reactivation candidates." />
${systemKnowledgeBlock}${storySettingsBlock}
<characters hint="Continuity tracks what each character knows. Use this to determine what they can reference, discover, or be surprised by.">
${characters}
</characters>

<locations hint="Nested via parent attribute. Characters must physically travel between locations — no teleportation.">
${locations}
</locations>

<threads hint="Threads are COMPELLING QUESTIONS the story is pricing as prediction markets over named outcomes. Each thread carries a category interpreting its current market state:
  saturating — margin near closure; one committal (payoff/twist) away from resolving
  volatile — recent swings (either a spiky scene or accumulated drift); twists against prior trend earn weight
  contested — high entropy with real volume; either side is fair game
  committed — one outcome clearly leads (p≥0.65); market expects this unless you twist it
  developing — recently touched and actively moving, no decisive shape yet; pace it and let it settle
  dormant — no recent touches and no distinctive signal; let it decay unless this scene re-engages it
Plus: lean (leading outcome), p-lean (its probability), margin (logit gap to runner-up), vol (attention), volatility (EWMA of single-scene shifts), energy (summed absolute logit motion across the recent log window — catches gradual drift EWMA smooths out), silent (scenes since last touched). The <log> carries the accumulated event trace.">
${threads}
</threads>

<relationships hint="Valence: negative = hostile/tense, positive = warm/allied. All interactions must reflect the current valence. Shifts happen through dramatic moments, not narration.">
${relationships}
</relationships>

<scene-history scope="${historyNote}" hint="Source of truth for long-term continuity. Far-tier scenes are rolled up into arc-summary entries — each carries the arc's chess-board worldState as the compact memory of what that span resolved to. Near/mid entries expose per-scene deltas. Each entry's time-gap attribute is the elapsed time since the prior scene — use it to read pacing across the history and decide the gap into the next scene.">
${sceneHistory}
</scene-history>
<valid-ids hint="You MUST use ONLY these exact IDs — do NOT invent new ones.">
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

  const timeGapBlock = `\n<time-gap hint="Time elapsed since the prior scene (estimate). Weave the passage of time into the prose — light, weather, wear, mood, evidentiary state, modelled rule-state, what has shifted — so its motion registers without ever surfacing as a timestamp or log entry. Gap size shifts how visible the weaving is, not whether it happens. The description below indicates the band: texture-only (minor), woven cue (notable), or anchored re-orientation (major / generational).">${describeTimeGap(scene.timeDelta)}</time-gap>`;

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

  // Build scene entries grouped by arc, with world commits as top-level markers between arcs
  type Section = { kind: 'arc'; arcName: string; entries: string[] } | { kind: 'world-commit'; line: string };
  const sections: Section[] = [];
  const arcGroupMap = new Map<string, Section & { kind: 'arc' }>();

  let sceneNum = 0;
  for (const k of keysUpToCurrent) {
    const entry = resolveEntry(n, k);
    if (!entry) continue;

    if (entry.kind === 'world_build') {
      sections.push({ kind: 'world-commit', line: `<world-commit>${entry.summary}</world-commit>` });
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
      group = { kind: 'arc', arcName: name, entries: [] };
      if (arcId) arcGroupMap.set(arcId, group);
      sections.push(group);
    }

    const povName = entry.povId ? (n.characters[entry.povId]?.name ?? entry.povId) : 'narrator';
    const locName = n.locations[entry.locationId]?.name ?? entry.locationId;
    group.entries.push(
      `  <scene index="${sceneNum}" pov="${povName}" location="${locName}">${entry.summary}</scene>`,
    );
  }

  // Format sections
  const arcSections = sections.map((s) => {
    if (s.kind === 'world-commit') return s.line;
    return `<arc name="${s.arcName}">\n${s.entries.join('\n')}\n</arc>`;
  }).join('\n\n');

  return `<story-summary title="${n.title}" scenes="${sceneNum}" hint="Narrative recap — scene-by-scene progression grouped by arc.">
${arcSections}
</story-summary>`;
}

