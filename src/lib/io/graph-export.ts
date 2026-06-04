/**
 * Contextual Markdown exporters for the canvas graph views. The top bar
 * exposes six graph modes composed of a scope (Scene | Full) and a
 * domain (World | System | Threads); plus a seventh overlay view when
 * the user drills into an entity's inner world graph. This module:
 *
 *  1. Gives each mode a canonical "Scope · Domain" label so UI chrome
 *     (tooltips, copy headers, docs) stays consistent with the toggle
 *     words the author sees.
 *  2. Produces a readable Markdown export of whatever graph is
 *     currently visible — entities in this scene, the whole world's
 *     entities, system rules at this point in time, threads with their
 *     lifecycle, or an entity's inner knowledge graph.
 */

import { getRelationshipsAtScene } from "@/lib/graph/scene-filter";
import { getEffectivePovId, getStanceProbs, isThreadAbandoned, isThreadClosed } from "@/lib/forces/narrative-utils";
import { NARRATOR_AGENT_ID } from "@/types/narrative";
import type {
  Artifact,
  Character,
  GraphViewMode,
  Location,
  NarrativeState,
  Scene,
  Thread,
} from "@/types/narrative";

// ── Canonical labels ──────────────────────────────────────────────────────

export type GraphViewLabel = {
  /** Full "Scope · Domain" string used in headers and copy tooltips. */
  full: string;
  /** Scope half (for composite UI use). */
  scope: "Scene" | "Full" | "Entity";
  /** Domain half. */
  domain: "World" | "System" | "Threads" | "Inner World";
};

// Note: the GraphViewLabel.scope union is Scene / Full / Entity — arc
// scope re-uses "Scene" since the export currently focuses on the current
// scene's snapshot regardless of the wider visibility window. The label's
// `full` string distinguishes them ("Arc · World" vs "Scene · World").
const LABELS: Partial<Record<GraphViewMode, GraphViewLabel>> = {
  "world-scene":   { full: "Scene · World",   scope: "Scene", domain: "World"   },
  "world-arc":     { full: "Arc · World",     scope: "Scene", domain: "World"   },
  "world-full":    { full: "Full · World",    scope: "Full",  domain: "World"   },
  "system-scene":  { full: "Scene · System",  scope: "Scene", domain: "System"  },
  "system-arc":    { full: "Arc · System",    scope: "Scene", domain: "System"  },
  "system-full":   { full: "Full · System",   scope: "Full",  domain: "System"  },
  "threads-scene": { full: "Scene · Threads", scope: "Scene", domain: "Threads" },
  "threads-arc":   { full: "Arc · Threads",   scope: "Scene", domain: "Threads" },
  "threads-full":  { full: "Full · Threads",  scope: "Full",  domain: "Threads" },
};

export function graphViewLabel(
  mode: GraphViewMode,
  selectedEntityName?: string | null,
): GraphViewLabel {
  if (selectedEntityName) {
    return {
      full: `${selectedEntityName} · Inner World`,
      scope: "Entity",
      domain: "Inner World",
    };
  }
  return LABELS[mode] ?? { full: String(mode), scope: "Scene", domain: "World" };
}

/** Which graph modes are exportable — everything but scene-editorial sub-views.
 *  Arc-scope variants currently route through the same exporters as their
 *  scene-scope siblings; broadening exporters to honour the arc window is a
 *  follow-up. */
const EXPORTABLE_MODES = new Set<GraphViewMode>([
  "world-scene", "world-arc", "world-full",
  "system-scene", "system-arc", "system-full",
  "threads-scene", "threads-arc", "threads-full",
]);

export function isExportableGraphMode(mode: GraphViewMode): boolean {
  return EXPORTABLE_MODES.has(mode);
}

// ── Export entry point ────────────────────────────────────────────────────

export type GraphExportContext = {
  narrative: NarrativeState;
  mode: GraphViewMode;
  resolvedKeys: string[];
  currentSceneIndex: number;
  /** When set, the overlay entity-inner-world view wins over `mode`. */
  selectedEntityId?: string | null;
};

export function exportGraphView(ctx: GraphExportContext): string {
  const { narrative, mode, selectedEntityId } = ctx;

  if (selectedEntityId) {
    return exportEntityInner(narrative, selectedEntityId);
  }

  switch (mode) {
    case "world-scene":
    case "world-arc":    return exportSceneWorld(ctx);
    case "world-full":   return exportFullWorld(narrative);
    case "system-scene":
    case "system-arc":   return exportSceneSystem(ctx);
    case "system-full":  return exportFullSystem(narrative);
    case "threads-scene":
    case "threads-arc":  return exportSceneThreads(ctx);
    case "threads-full": return exportFullThreads(narrative);
    default:
      return `# ${narrative.title}\n\n*No export defined for mode \`${mode}\`.*`;
  }
}

// ── Per-mode exporters ────────────────────────────────────────────────────

function exportSceneWorld(ctx: GraphExportContext): string {
  const { narrative, resolvedKeys, currentSceneIndex } = ctx;
  const label = graphViewLabel("world-scene").full;
  const scene = sceneAt(narrative, resolvedKeys, currentSceneIndex);
  const lines: string[] = [header(narrative, label)];

  if (!scene) {
    lines.push("*No scene at current timeline position.*");
    return lines.join("\n");
  }

  const pov = narrative.characters[getEffectivePovId(scene) ?? ""];
  const loc = narrative.locations[scene.locationId];
  lines.push(
    `**Scene ${currentSceneIndex + 1} / ${resolvedKeys.length}**`,
    "",
    `- POV: ${pov ? `${pov.name} (${pov.role})` : "—"}`,
    `- Location: ${loc ? `${loc.name} (${loc.prominence})` : "—"}`,
    `- Summary: ${scene.summary || "—"}`,
    "",
    "## Participants",
  );
  for (const pid of scene.participantIds) {
    const c = narrative.characters[pid];
    if (c) lines.push(`- **${c.name}** — ${c.role}`);
  }
  if (scene.participantIds.length === 0) lines.push("*(none)*");

  const sceneRels = getRelationshipsAtScene(narrative, resolvedKeys, currentSceneIndex);
  const participantSet = new Set(scene.participantIds);
  const scopedRels = sceneRels.filter((r) => participantSet.has(r.from) && participantSet.has(r.to));
  if (scopedRels.length > 0) {
    lines.push("", "## Relationships active in this scene");
    for (const r of scopedRels) {
      const a = narrative.characters[r.from]?.name ?? r.from;
      const b = narrative.characters[r.to]?.name ?? r.to;
      lines.push(`- ${a} → ${b}: ${r.type}${typeof r.valence === "number" ? ` (valence ${r.valence})` : ""}`);
    }
  }

  if (scene.artifactUsages && scene.artifactUsages.length > 0) {
    lines.push("", "## Artifacts in play");
    for (const u of scene.artifactUsages) {
      const a = narrative.artifacts?.[u.artifactId];
      if (a) lines.push(`- **${a.name}** — ${a.significance}${u.usage ? ` · ${u.usage}` : ""}`);
    }
  }

  return lines.join("\n");
}

function exportFullWorld(narrative: NarrativeState): string {
  const lines: string[] = [header(narrative, graphViewLabel("world-full").full)];

  const characters = Object.values(narrative.characters);
  const locations = Object.values(narrative.locations);
  const artifacts = Object.values(narrative.artifacts ?? {});

  lines.push("", `## Characters (${characters.length})`);
  for (const c of sortBy(characters, (c) => roleRank(c.role) * 100 + c.name.charCodeAt(0))) {
    lines.push(`- **${c.name}** — ${c.role}`);
  }

  lines.push("", `## Locations (${locations.length})`);
  for (const l of sortBy(locations, (l) => prominenceRank(l.prominence) * 100 + l.name.charCodeAt(0))) {
    lines.push(`- **${l.name}** — ${l.prominence}`);
  }

  if (artifacts.length > 0) {
    lines.push("", `## Artifacts (${artifacts.length})`);
    for (const a of sortBy(artifacts, (a) => significanceRank(a.significance) * 100 + a.name.charCodeAt(0))) {
      lines.push(`- **${a.name}** — ${a.significance}`);
    }
  }

  if (narrative.relationships.length > 0) {
    lines.push("", `## Relationships (${narrative.relationships.length})`);
    for (const r of narrative.relationships) {
      const a = narrative.characters[r.from]?.name ?? r.from;
      const b = narrative.characters[r.to]?.name ?? r.to;
      lines.push(`- ${a} → ${b}: ${r.type}${typeof r.valence === "number" ? ` (valence ${r.valence})` : ""}`);
    }
  }

  return lines.join("\n");
}

function exportSceneSystem(ctx: GraphExportContext): string {
  const { narrative, resolvedKeys, currentSceneIndex } = ctx;
  const label = graphViewLabel("system-scene").full;
  const scene = sceneAt(narrative, resolvedKeys, currentSceneIndex);
  const lines: string[] = [header(narrative, label)];

  if (!scene || !scene.systemDeltas) {
    lines.push("*No system deltas at this scene.*");
    return lines.join("\n");
  }

  const { addedNodes = [], addedEdges = [] } = scene.systemDeltas;
  if (addedNodes.length === 0 && addedEdges.length === 0) {
    lines.push("*No system additions at this scene.*");
  }

  if (addedNodes.length > 0) {
    lines.push("", "## Added nodes");
    const byType = groupByField(addedNodes, (n) => n.type ?? "concept");
    for (const [type, items] of byType) {
      lines.push(`**${type}**`);
      for (const n of items) lines.push(`- ${n.concept}`);
    }
  }

  if (addedEdges.length > 0) {
    lines.push("", "## Added edges");
    const nodeConcept = new Map<string, string>();
    for (const n of Object.values(narrative.systemGraph.nodes ?? {})) nodeConcept.set(n.id, n.concept);
    for (const n of addedNodes) nodeConcept.set(n.id, n.concept);
    for (const e of addedEdges) {
      const a = nodeConcept.get(e.from) ?? e.from;
      const b = nodeConcept.get(e.to) ?? e.to;
      lines.push(`- "${a}" — ${e.relation} → "${b}"`);
    }
  }

  return lines.join("\n");
}

function exportFullSystem(narrative: NarrativeState): string {
  const label = graphViewLabel("system-full").full;
  const lines: string[] = [header(narrative, label)];
  const nodes = Object.values(narrative.systemGraph?.nodes ?? {});
  const edges = narrative.systemGraph?.edges ?? [];

  if (nodes.length === 0) {
    lines.push("*No system graph recorded yet.*");
    return lines.join("\n");
  }

  const byType = groupByField(nodes, (n) => n.type ?? "concept");
  for (const [type, items] of byType) {
    lines.push("", `## ${cap(type)}s (${items.length})`);
    for (const n of items) lines.push(`- ${n.concept}`);
  }

  if (edges.length > 0) {
    lines.push("", `## Relations (${edges.length})`);
    const conceptOf = new Map(nodes.map((n) => [n.id, n.concept]));
    for (const e of edges) {
      const a = conceptOf.get(e.from);
      const b = conceptOf.get(e.to);
      if (!a || !b) continue;
      lines.push(`- "${a}" — ${e.relation} → "${b}"`);
    }
  }

  return lines.join("\n");
}

function exportSceneThreads(ctx: GraphExportContext): string {
  const { narrative, resolvedKeys, currentSceneIndex } = ctx;
  const label = graphViewLabel("threads-scene").full;
  const scene = sceneAt(narrative, resolvedKeys, currentSceneIndex);
  const lines: string[] = [header(narrative, label)];

  if (!scene || scene.threadDeltas.length === 0) {
    lines.push("*No thread movement at this scene.*");
    return lines.join("\n");
  }

  lines.push("", "## Thread deltas at this scene");
  for (const td of scene.threadDeltas) {
    const thread = narrative.threads[td.threadId];
    const desc = thread?.description ?? td.threadId;
    const moves = (td.updates ?? [])
      .map((u) => `${u.outcome} ${u.evidence >= 0 ? '+' : ''}${u.evidence}`)
      .join(", ");
    lines.push(`- **${desc}** — [${td.logType}] ${moves || "(no updates)"}`);
  }

  return lines.join("\n");
}

function exportFullThreads(narrative: NarrativeState): string {
  const label = graphViewLabel("threads-full").full;
  const lines: string[] = [header(narrative, label)];
  const threads = Object.values(narrative.threads);

  if (threads.length === 0) {
    lines.push("*No threads recorded.*");
    return lines.join("\n");
  }

  const active = threads.filter((t) => !isThreadClosed(t) && !isThreadAbandoned(t));
  const closed = threads.filter((t) => !active.includes(t));

  if (active.length > 0) {
    lines.push("", `## Active threads (${active.length})`);
    for (const t of sortBy(active, (t) => -1 * (t.stances?.[NARRATOR_AGENT_ID]?.volume ?? 0))) {
      lines.push(threadLine(t));
    }
  }
  if (closed.length > 0) {
    lines.push("", `## Closed / abandoned (${closed.length})`);
    for (const t of closed) lines.push(threadLine(t));
  }

  return lines.join("\n");
}

function threadLine(t: Thread): string {
  const state = isThreadClosed(t)
    ? `closed → ${t.outcomes[t.closeOutcome ?? 0] ?? "?"}`
    : isThreadAbandoned(t)
      ? "abandoned"
      : (() => {
          const probs = getStanceProbs(t);
          const topIdx = probs.indexOf(Math.max(...probs));
          return `top=${t.outcomes[topIdx]} (${(probs[topIdx] ?? 0).toFixed(2)})`;
        })();
  return `- **[${state}]** ${t.description}${t.id ? ` · \`${t.id}\`` : ""}`;
}

function exportEntityInner(narrative: NarrativeState, entityId: string): string {
  const c = narrative.characters[entityId];
  const l = narrative.locations[entityId];
  const a = narrative.artifacts?.[entityId];
  const entity = c ?? l ?? a;
  if (!entity) return `# Inner world\n\n*Entity \`${entityId}\` not found.*`;

  const name = entity.name;
  const kind = c ? "Character" : l ? "Location" : "Artifact";
  const role = c ? c.role : l ? l.prominence : a ? a.significance : "";
  const world = (c ?? l ?? a)!.world;
  const lines = [header(narrative, `${name} · Inner World`)];
  lines.push(`**${kind}** — ${role}`, "");

  const nodes = Object.values(world.nodes ?? {});
  if (nodes.length === 0) {
    lines.push("*No inner-world nodes recorded.*");
    return lines.join("\n");
  }
  const grouped = groupByField(nodes, (n) => n.type ?? "other");
  for (const [type, items] of grouped) {
    lines.push(`## ${cap(type)}`);
    for (const n of items) lines.push(`- ${n.content}`);
    lines.push("");
  }

  const edges = world.edges ?? [];
  if (edges.length > 0) {
    const content = new Map(nodes.map((n) => [n.id, n.content]));
    lines.push("## Links");
    for (const e of edges) {
      const from = content.get(e.from);
      const to = content.get(e.to);
      if (!from || !to) continue;
      lines.push(`- "${from}" — ${e.relation} → "${to}"`);
    }
  }

  return lines.join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────

function header(n: NarrativeState, label: string): string {
  return `# ${n.title} — ${label}\n`;
}

function sceneAt(
  narrative: NarrativeState,
  resolvedKeys: string[],
  index: number,
): Scene | null {
  const key = resolvedKeys[index];
  if (!key) return null;
  return narrative.scenes[key] ?? null;
}

function sortBy<T>(arr: T[], key: (x: T) => number): T[] {
  return [...arr].sort((a, b) => key(a) - key(b));
}

function groupByField<T, K extends string>(arr: T[], keyFn: (x: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of arr) {
    const k = keyFn(item);
    const bucket = out.get(k) ?? [];
    bucket.push(item);
    out.set(k, bucket);
  }
  return out;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function roleRank(role: Character["role"]): number {
  return role === "anchor" ? 0 : role === "recurring" ? 1 : 2;
}
function prominenceRank(p: Location["prominence"]): number {
  return p === "domain" ? 0 : p === "place" ? 1 : 2;
}
function significanceRank(s: Artifact["significance"]): number {
  return s === "key" ? 0 : s === "notable" ? 1 : 2;
}
// statusRank retired — market threads rank by volume / volatility instead.
