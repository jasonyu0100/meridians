// merges.ts — merge-as-continuity-basis helpers.
//
// Streams and merges are a GLOBAL model (one shared ledger across all
// branches, for simplicity). But *which merges were folded in to continue
// reality* is branch-relative: a merge is consumed by stamping its id onto the
// Arc (or WorldBuild) it seeds via `basisMergeIds`. Because an entry only
// appears on branches that contain it, walking a branch's resolved entries
// yields exactly the merges consumed on THAT branch — a branch forked before a
// merge was folded in simply never sees it as consumed.
//
// This module is pure (no React / no AI deps) so it can be shared by the
// reducer-adjacent UI (consumption badges), the generate modal (picker +
// default selection), and the generation prompt builders (basis block).

import {
  type NarrativeState,
  type Merge,
  type MergeResolution,
  type Stream,
  type Perspective,
  resolveEntry,
  isWorldBuild,
} from "@/types/narrative";
import { streamMargin } from "@/lib/forces/stream-stance";
import { branchLineageIds } from "@/lib/branch-tree";
import { agentPersonaLabel } from "@/lib/agents/personas";

// ── Branch-scoped visibility (ownership model) ───────────────────────────────
// Streams and merges are global storage but visible only on their origin branch
// and its descendants. A row with no `branchId` is legacy (pre-scoping) and
// stays visible everywhere so existing data isn't hidden by the migration.

/** True when an origin branch id is visible from the given lineage set. */
export function isVisibleOnBranch(
  originBranchId: string | undefined,
  lineage: Set<string>,
): boolean {
  return !originBranchId || lineage.has(originBranchId);
}

/** True when an origin is on the lineage, legacy (unset), or ORPHANED — its
 *  branch no longer exists. Orphans surface everywhere (recoverable) rather
 *  than vanishing silently; branch deletion normally removes owned rows, so an
 *  orphan only arises from corrupted / imported data. */
function isVisibleOrOrphan(
  originBranchId: string | undefined,
  lineage: Set<string>,
  knownBranchIds: Set<string>,
): boolean {
  if (!originBranchId) return true; // legacy / global
  if (lineage.has(originBranchId)) return true; // owned by self or ancestor
  return !knownBranchIds.has(originBranchId); // orphaned origin → surface it
}

/** Streams visible on `branchId` — owned by it or any ancestor (plus legacy
 *  unstamped streams and orphaned-origin rows). */
export function streamsForBranch(n: NarrativeState, branchId: string | null | undefined): Stream[] {
  const lineage = branchLineageIds(n.branches, branchId);
  const known = new Set(Object.keys(n.branches ?? {}));
  return Object.values(n.streams ?? {}).filter((s) => isVisibleOrOrphan(s.branchId, lineage, known));
}

/** Merges visible on `branchId` — same ownership rule. */
export function mergesForBranch(n: NarrativeState, branchId: string | null | undefined): Merge[] {
  const lineage = branchLineageIds(n.branches, branchId);
  const known = new Set(Object.keys(n.branches ?? {}));
  return Object.values(n.merges ?? {}).filter((m) => isVisibleOrOrphan(m.branchId, lineage, known));
}

/** Where a merge was folded into continuity on a given branch. */
export type MergeConsumer = {
  /** The entry (scene id or world-build id) whose arc/expansion folded it in. */
  entryKey: string;
  kind: "arc" | "world";
  /** Display id — arc id or world-build id. */
  id: string;
  /** Display name — arc name or "World expansion". */
  name: string;
};

/** All merge ids consumed on the branch described by `resolvedEntryKeys`
 *  (the store's resolved entry sequence for the active branch). */
export function collectConsumedMergeIds(
  n: NarrativeState,
  resolvedEntryKeys: string[],
): Set<string> {
  const consumed = new Set<string>();
  const seenArc = new Set<string>();
  for (const key of resolvedEntryKeys) {
    const entry = resolveEntry(n, key);
    if (!entry) continue;
    if (isWorldBuild(entry)) {
      for (const id of entry.basisMergeIds ?? []) consumed.add(id);
    } else {
      // Scene → arc. An arc spans many scenes; only read each arc once.
      const arc = n.arcs[entry.arcId];
      if (arc && !seenArc.has(arc.id)) {
        seenArc.add(arc.id);
        for (const id of arc.basisMergeIds ?? []) consumed.add(id);
      }
    }
  }
  return consumed;
}

/** The arc / world-build on this branch that folded in `mergeId`, or null if
 *  the merge has not been consumed on the branch. First consumer wins. */
export function findMergeConsumer(
  n: NarrativeState,
  resolvedEntryKeys: string[],
  mergeId: string,
): MergeConsumer | null {
  const seenArc = new Set<string>();
  for (const key of resolvedEntryKeys) {
    const entry = resolveEntry(n, key);
    if (!entry) continue;
    if (isWorldBuild(entry)) {
      if ((entry.basisMergeIds ?? []).includes(mergeId)) {
        return { entryKey: key, kind: "world", id: entry.id, name: "World expansion" };
      }
    } else {
      const arc = n.arcs[entry.arcId];
      if (arc && !seenArc.has(arc.id)) {
        seenArc.add(arc.id);
        if ((arc.basisMergeIds ?? []).includes(mergeId)) {
          return { entryKey: key, kind: "arc", id: arc.id, name: arc.name };
        }
      }
    }
  }
  return null;
}

/** Reverse index: arc/world entry consumer keyed by mergeId, for one branch.
 *  Use when badging a whole list of merges (one pass instead of N). */
export function buildMergeConsumerMap(
  n: NarrativeState,
  resolvedEntryKeys: string[],
): Map<string, MergeConsumer> {
  const map = new Map<string, MergeConsumer>();
  const seenArc = new Set<string>();
  for (const key of resolvedEntryKeys) {
    const entry = resolveEntry(n, key);
    if (!entry) continue;
    if (isWorldBuild(entry)) {
      for (const id of entry.basisMergeIds ?? []) {
        if (!map.has(id)) map.set(id, { entryKey: key, kind: "world", id: entry.id, name: "World expansion" });
      }
    } else {
      const arc = n.arcs[entry.arcId];
      if (arc && !seenArc.has(arc.id)) {
        seenArc.add(arc.id);
        for (const id of arc.basisMergeIds ?? []) {
          if (!map.has(id)) map.set(id, { entryKey: key, kind: "arc", id: arc.id, name: arc.name });
        }
      }
    }
  }
  return map;
}

/** The full committed outcome set for a resolution, uniform across the single
 *  (`outcome`) and multi (`outcomes`) shapes. `outcome` is always the primary
 *  / first entry. Empty array when the resolution has no outcome at all. */
export function resolutionOutcomes(res: MergeResolution | undefined): string[] {
  if (!res) return [];
  if (res.outcomes && res.outcomes.length > 0) return res.outcomes;
  return res.outcome ? [res.outcome] : [];
}

/** True when a resolution commits a question to more than one outcome. */
export function isMultiResolution(res: MergeResolution | undefined): boolean {
  return resolutionOutcomes(res).length > 1;
}

/** Perspective display name without React deps (mirrors RoomUI.perspectiveName). */
function perspectiveLabel(p: Perspective | undefined, n: NarrativeState): string {
  if (!p) return "unknown perspective";
  if (p.label) return p.label;
  if (p.kind === "narrator") return "Narrator";
  const src =
    p.kind === "character" ? n.characters :
    p.kind === "location" ? n.locations :
    p.kind === "artifact" ? n.artifacts : null;
  const ent = p.entityRef && src ? src[p.entityRef] : undefined;
  return ent?.name ?? p.kind;
}

function memberLabel(n: NarrativeState, memberId: string | undefined): string | null {
  if (!memberId) return null;
  const m = n.members?.[memberId];
  if (!m) return null;
  return `${m.firstName} ${m.lastName}`.trim() || null;
}

/** Attribution for an agent-driven stream — name + persona, e.g. "Vega
 *  (Strategist)" — so the generation reads who held the belief. */
function agentLabel(n: NarrativeState, agentId: string | undefined): string | null {
  if (!agentId) return null;
  const a = n.agents?.[agentId];
  if (!a) return null;
  return `${a.name || "Agent"} (${agentPersonaLabel(a)})`;
}

const xmlAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Cap priors rendered per stream so a long belief log can't blow the prompt.
const MAX_PRIORS_PER_STREAM = 10;

/**
 * Render the given merges as a `<continuity-basis>` prompt block — the
 * perspective-held reality a continuation extends from. Takes Merge OBJECTS
 * (not ids) so a not-yet-persisted ProposedMerge can be rendered before it's
 * committed; stream data is still read from `n.streams` by id.
 *
 * Weighting (per the product model): the committed RESOLUTION is the biggest
 * driving factor — it is what HAPPENED and outranks any speculative lean in the
 * world-state. The stream PRIORS are secondary: perspective-held observations
 * that shaped the resolution, read for motive / texture / directional pressure,
 * never as competing outcomes. Streams are perspective-based, so each resolved
 * question is attributed to whose vantage (and which member) carried it.
 *
 * Returns null when there's nothing renderable (no merges, or no surviving
 * streams on them).
 */
export function renderMergeBasisBlock(
  n: NarrativeState,
  mergeList: Merge[],
): string | null {
  const merges = [...mergeList].sort((a, b) => a.at - b.at);
  if (merges.length === 0) return null;

  const mergeBlocks: string[] = [];
  for (const merge of merges) {
    const resolvedBlocks: string[] = [];
    for (const sid of merge.streamIds ?? []) {
      const stream = n.streams?.[sid];
      if (!stream) continue;
      const outcomes = stream.outcomes ?? [];
      const res = merge.resolutions?.[sid];
      // The committed outcome(s) are the spine; skip streams with no resolution.
      const committed = resolutionOutcomes(res);
      if (committed.length === 0) continue;
      const outcome = committed[0];
      const multi = committed.length > 1;

      const persp = perspectiveLabel(n.perspectives?.[stream.perspectiveId], n);
      const member = memberLabel(n, stream.memberId);
      const agent = agentLabel(n, stream.agentId);
      const { topIdx } = streamMargin(stream);
      const leaned = outcomes[topIdx];
      // Overridden when the belief leader isn't among the committed outcome(s).
      const overridden = !!res?.overridden && !!leaned && !committed.includes(leaned);

      const priors = [...stream.priors]
        .sort((a, b) => a.at - b.at)
        .slice(-MAX_PRIORS_PER_STREAM)
        .map((p) => `        - ${p.logType ? `[${p.logType}] ` : ""}${p.text}`)
        .join("\n");

      const attrs = [
        `question="${xmlAttr(stream.title)}"`,
        `perspective="${xmlAttr(persp)}"`,
        member ? `member="${xmlAttr(member)}"` : "",
        agent ? `agent="${xmlAttr(agent)}"` : "",
        `outcome="${xmlAttr(outcome)}"`,
        // Multi-resolution: the question committed to several outcomes at once.
        // The generation LLM reconciles them (both true / blend / sequence /
        // partial) — they are NOT competing alternatives.
        multi ? `multi-resolved="${xmlAttr(committed.join(" + "))}"` : "",
        overridden ? `overridden="true" belief-leaned="${xmlAttr(leaned!)}"` : "",
      ].filter(Boolean).join(" ");

      resolvedBlocks.push(
        `      <resolved ${attrs}>${priors ? `\n      <priors hint="perspective-held observations that drove this resolution — texture/motive/direction, not competing outcomes">\n${priors}\n      </priors>\n      ` : ""}</resolved>`,
      );
    }
    if (resolvedBlocks.length === 0) continue;
    const label = merge.label ? ` label="${xmlAttr(merge.label)}"` : "";
    const summary = merge.summary ? `\n    <summary>${xmlAttr(merge.summary)}</summary>` : "";
    mergeBlocks.push(`  <merge${label}>${summary}\n${resolvedBlocks.join("\n")}\n  </merge>`);
  }
  if (mergeBlocks.length === 0) return null;

  return `<continuity-basis hint="GROUND TRUTH the continuation extends from. Each resolved question below was committed at a merge — the outcome is what HAPPENED and outranks any speculative lean elsewhere in context. overridden=&quot;true&quot; means reality diverged from the accumulated belief (which leaned belief-leaned) — honour the committed outcome, not the lean. multi-resolved=&quot;a + b&quot; means the question committed to SEVERAL outcomes at once — reconcile them as jointly true / a blend / a sequence / a partial, NOT as competing alternatives; if they cannot coherently coexist, prefer the primary outcome and treat the rest as tension. The priors are perspective-held observations that drove each resolution: weigh them for motive, texture, and directional pressure, never as alternative outcomes. Streams are perspective-based — keep whose vantage each reading comes from.">
${mergeBlocks.join("\n")}
</continuity-basis>`;
}
