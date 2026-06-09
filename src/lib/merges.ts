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
import { streamMargin, streamProbs } from "@/lib/forces/stream-stance";
import { branchLineageIds } from "@/lib/branch-tree";
import { agentPersonaLabel, resolveAgentById } from "@/lib/agents/personas";

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
  const a = resolveAgentById(n, agentId);
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
 * The mental model (signal vs noise): each resolved question carries a COMMITTED
 * OUTCOME (settled fact — the signal) and the stream PRIORS that drove it (raw,
 * perspective-held thinking — noisy evidence, partial and vantage-biased, often
 * mutually contradictory). The block ships a `<synthesis>` directive that tells
 * the consumer to de-noise: separate signal from noise, reconcile contradictions
 * toward the committed outcome, and read the AGGREGATE directional pressure the
 * body of evidence creates — the de-noised vector the continuation advances
 * along. Weighting: resolution > aggregated prior pressure > any single prior;
 * later/payoff-or-twist priors outweigh early setup pulses. Streams are
 * perspective-based, so each reading keeps whose vantage (and which member /
 * agent) carried it.
 *
 * OPEN-ENDED streams: a merge may fold a stream in WITHOUT committing an outcome
 * (no entry in `merge.resolutions` for it). There is then no settled fact — the
 * question stays genuinely open. Such a stream renders as `<open>` carrying its
 * stance DISTRIBUTION (softmax over outcomes) instead of an `outcome`, and its
 * priors are framed as open thought (live, unsettled reasoning) the continuation
 * interprets within the distribution rather than as evidence for a fact.
 *
 * Returns null when there's nothing renderable (no merges, or no surviving
 * streams — a stream with neither a resolution nor any outcomes to weight
 * contributes nothing).
 */
export function renderMergeBasisBlock(
  n: NarrativeState,
  mergeList: Merge[],
): string | null {
  const merges = [...mergeList].sort((a, b) => a.at - b.at);
  if (merges.length === 0) return null;

  const mergeBlocks: string[] = [];
  for (const merge of merges) {
    const streamBlocks: string[] = [];
    for (const sid of merge.streamIds ?? []) {
      const stream = n.streams?.[sid];
      if (!stream) continue;
      const outcomes = stream.outcomes ?? [];
      const res = merge.resolutions?.[sid];
      const committed = resolutionOutcomes(res);

      const persp = perspectiveLabel(n.perspectives?.[stream.perspectiveId], n);
      const member = memberLabel(n, stream.memberId);
      const agent = agentLabel(n, stream.agentId);

      // Priors render identically for resolved + open streams; the FRAMING (the
      // <priors> hint) differs — evidence behind a fact vs open thought.
      const priors = [...stream.priors]
        .sort((a, b) => a.at - b.at)
        .slice(-MAX_PRIORS_PER_STREAM)
        .map((p) => `        - ${p.logType ? `[${p.logType}] ` : ""}${p.text}`)
        .join("\n");

      const idAttrs = [
        `question="${xmlAttr(stream.title)}"`,
        `perspective="${xmlAttr(persp)}"`,
        member ? `member="${xmlAttr(member)}"` : "",
        agent ? `agent="${xmlAttr(agent)}"` : "",
      ];

      if (committed.length > 0) {
        // ── Resolved — a committed outcome is the spine (settled fact / signal).
        const outcome = committed[0];
        const multi = committed.length > 1;
        const { topIdx } = streamMargin(stream);
        const leaned = outcomes[topIdx];
        // Overridden when the belief leader isn't among the committed outcome(s).
        const overridden = !!res?.overridden && !!leaned && !committed.includes(leaned);

        const attrs = [
          ...idAttrs,
          `outcome="${xmlAttr(outcome)}"`,
          // Multi-resolution: the question committed to several outcomes at once.
          // The generation LLM reconciles them (both true / blend / sequence /
          // partial) — they are NOT competing alternatives.
          multi ? `multi-resolved="${xmlAttr(committed.join(" + "))}"` : "",
          overridden ? `overridden="true" belief-leaned="${xmlAttr(leaned!)}"` : "",
        ].filter(Boolean).join(" ");

        streamBlocks.push(
          `      <resolved ${attrs}>${priors ? `\n      <priors hint="RAW perspective-held thinking behind this resolution — noisy evidence, not fact. De-noise per &lt;synthesis&gt;: read for motive / texture / directional pressure, never as competing outcomes. [logType] tags weight: payoff/twist/escalation &gt; setup/pulse.">\n${priors}\n      </priors>\n      ` : ""}</resolved>`,
        );
      } else if (outcomes.length > 0) {
        // ── Open-ended — the merge folded this stream in WITHOUT committing an
        // outcome. No settled fact: the belief is the stance DISTRIBUTION over
        // outcomes, and the priors are open thought the continuation interprets
        // within (it may move along the distribution, or leave the question
        // open). A stream with no outcomes carries no distribution → skip it.
        const probs = streamProbs(stream);
        const dist = outcomes
          .map((o, i) => ({ o, p: probs[i] ?? 0 }))
          .sort((a, b) => b.p - a.p)
          .map(({ o, p }) => `${o} ${Math.round(p * 100)}%`)
          .join(" · ");
        const { topIdx } = streamMargin(stream);
        const leaning = outcomes[topIdx];

        const attrs = [
          ...idAttrs,
          `distribution="${xmlAttr(dist)}"`,
          leaning ? `leaning="${xmlAttr(leaning)}"` : "",
        ].filter(Boolean).join(" ");

        streamBlocks.push(
          `      <open ${attrs}>${priors ? `\n      <priors hint="OPEN THOUGHT — interpretive latitude, NOT fact and NOT settled. No outcome was committed, so this question stays genuinely OPEN. Move within the distribution above (lean toward the leading outcome, but the tail is live), or leave it unresolved — never harden it into a fact, never treat the tail as certain. Read the priors for motive / texture / directional pressure. [logType] tags weight: payoff/twist/escalation &gt; setup/pulse.">\n${priors}\n      </priors>\n      ` : ""}</open>`,
        );
      }
    }
    if (streamBlocks.length === 0) continue;
    const label = merge.label ? ` label="${xmlAttr(merge.label)}"` : "";
    const summary = merge.summary ? `\n    <summary>${xmlAttr(merge.summary)}</summary>` : "";
    mergeBlocks.push(`  <merge${label}>${summary}\n${streamBlocks.join("\n")}\n  </merge>`);
  }
  if (mergeBlocks.length === 0) return null;

  return `<continuity-basis hint="GROUND TRUTH the continuation extends from. Each &lt;resolved&gt; question below was committed at a merge — its outcome is what HAPPENED and outranks any speculative lean elsewhere in context. The priors under each are RAW perspective-held thinking (noisy evidence), not facts. De-noise them into a single direction (see &lt;synthesis&gt;) and continue ALONG that vector. PRIMARY FAILURE MODE: producing content that is thematically adjacent to these questions but never realises the committed outcomes by their actual content — every &lt;resolved&gt; outcome MUST surface concretely in what you produce, named and developed, not gestured at. overridden=&quot;true&quot; means reality diverged from the accumulated belief (which leaned belief-leaned) — honour the committed outcome, not the lean. multi-resolved=&quot;a + b&quot; means the question committed to SEVERAL outcomes at once — reconcile them as jointly true / a blend / a sequence / a partial, NOT as competing alternatives; if they cannot coherently coexist, prefer the primary outcome and treat the rest as tension. &lt;open&gt; questions were folded in WITHOUT a committed outcome — they are NOT fact: they carry a distribution (the perspective's stance weighting) and stay genuinely UNSETTLED. Move within that distribution (lean to the leading outcome, keep the tail live) and you MAY leave them open — never harden an &lt;open&gt; question into fact, and never treat its tail as certain.">
  <synthesis hint="How to turn these noisy priors + committed resolutions into the direction this continuation advances along. Do this BEFORE drafting — when an arc/expansion emits a directionVector, it IS the output of this synthesis.">
    <step n="1" name="signal-vs-noise">Treat each &lt;resolved&gt; question's committed outcome as settled fact (the signal). Treat its priors as raw, vantage-biased thinking — partial, sometimes wrong, often contradicting each other. Never promote a single prior to fact.</step>
    <step n="2" name="reconcile">Where priors disagree, or lean away from what was committed (especially overridden=&quot;true&quot;), the resolution wins. The discarded leans are not alternative truth — they are residue the continuation can still FEEL: denial, surprise, sunk conviction, a perspective forced to update or double down.</step>
    <step n="3" name="extract-vector">Across ALL questions (resolved facts AND open distributions) and their priors, read the net DIRECTION the body of evidence pushes — which pressures intensified, who gained or lost conviction, what is now closing, sharpening, opening, or foreclosed. Weight later priors and payoff/twist/escalation logTypes over early setup pulses, and higher-volume streams over thin ones. This aggregate is the de-noised direction vector.</step>
    <step n="4" name="realise-each" critical="true">Advance the world ALONG that vector — and for EVERY &lt;resolved&gt; question, make its committed outcome CONCRETE and load-bearing in what you produce. Name the actual outcome (its real content — e.g. the specific answer that was committed, not merely the question's topic) and build the events, claims, or consequences that follow FROM it. Realise it NATURALLY inside the CONTINUING narrative, carried through the perspective that held the stream — the outcome becomes lived story (what that vantage now sees, decides, contends with, or is changed by) and the priors are its motive and texture, NOT a bolted-on statement of fact or a forecast report grafted onto the work. Let each perspective act on its confirmed or broken read. Content that is merely thematically adjacent to a question — touching its subject without ever asserting or developing the committed answer — does NOT count: a continuation that fails to realise each committed outcome by its actual content has IGNORED this basis. That is the PRIMARY FAILURE MODE; avoid it. Do not relitigate settled questions; build on them.</step>
    <step n="5" name="open-questions">For each &lt;open&gt; question, NO outcome was committed — it is not fact. Read its distribution as the perspective's live belief weighting and let the continuation move within it: most naturally toward the leading outcome, with the tail still genuinely possible. You may let the continuation resolve an open question if it earns the resolution, or leave it open — but never assert a hard outcome the distribution doesn't support, and treat its priors as unsettled thinking, not evidence for a fact.</step>
  </synthesis>
${mergeBlocks.join("\n")}
</continuity-basis>`;
}
