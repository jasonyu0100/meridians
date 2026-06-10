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
import { agentPersonaLabel, resolveAgentById } from "@/lib/agents/personas";
import { MERGE_SCENE_COMPRESSION } from "@/lib/constants";

// ── Branch-OWNED visibility ──────────────────────────────────────────────────
// A fork deep-copies the parent's streams + merges into the child (forkLedger),
// so each branch is a fully mutable, experimentable sandbox with the parent as
// a backup. Visibility is therefore strict OWNERSHIP — a branch sees exactly
// the rows it owns. `n.streams`/`n.merges` stay global dicts so id-lookups
// always resolve; ownership only governs display + which copy a branch mutates.

// Visibility under the branch-OWNED model: a row shows on a branch iff that
// branch OWNS it. A fork deep-copies the parent's streams/merges into the child
// (see forkLedger), so strict ownership is sufficient — no lineage walk. The
// `n.streams`/`n.merges` dicts stay global so id-lookups always resolve; this
// only governs display + which copy a branch operates on.

/** Streams owned by `branchId`. */
export function streamsForBranch(n: NarrativeState, branchId: string | null | undefined): Stream[] {
  return Object.values(n.streams ?? {}).filter((s) => s.branchId === branchId);
}

/** Merges owned by `branchId`. */
export function mergesForBranch(n: NarrativeState, branchId: string | null | undefined): Merge[] {
  return Object.values(n.merges ?? {}).filter((m) => m.branchId === branchId);
}

/**
 * Deep-copy the streams + merges visible on `fromBranchId` into ownership of
 * `toBranchId` — the copy-on-fork that makes each branch an isolated sandbox.
 * Copies get fresh ids (`<srcId>::<toBranchId>`), a root-origin back-link
 * (`originStreamId` / `originMergeId`), and `branchId = toBranchId`; a merge's
 * `streamIds` + `resolutions` keys are remapped to the copied streams. Returns
 * the new rows for the reducer to fold into `n.streams` / `n.merges`.
 */
export function forkLedger(
  n: NarrativeState,
  fromBranchId: string | null | undefined,
  toBranchId: string,
): { streams: Stream[]; merges: Merge[] } {
  const streamIdMap = new Map<string, string>();
  const streams = streamsForBranch(n, fromBranchId).map((s) => {
    const copy = structuredClone(s);
    copy.id = `${s.id}::${toBranchId}`;
    copy.branchId = toBranchId;
    copy.originStreamId = s.originStreamId ?? s.id; // root origin
    streamIdMap.set(s.id, copy.id);
    return copy;
  });
  const merges = mergesForBranch(n, fromBranchId).map((m) => {
    const copy = structuredClone(m);
    copy.id = `${m.id}::${toBranchId}`;
    copy.branchId = toBranchId;
    copy.originMergeId = m.originMergeId ?? m.id;
    copy.streamIds = (m.streamIds ?? []).map((sid) => streamIdMap.get(sid) ?? sid);
    if (m.resolutions) {
      copy.resolutions = Object.fromEntries(
        Object.entries(m.resolutions).map(([sid, res]) => [streamIdMap.get(sid) ?? sid, res]),
      );
    }
    return copy;
  });
  return { streams, merges };
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

/** True when `mergeId` (or the merge's origin) appears in `basisIds`. A forked
 *  branch owns COPIES with fresh ids, while pre-fork (shared) entries reference
 *  the ORIGINAL merge id — so consumption matches either. */
function basisHits(n: NarrativeState, basisIds: string[] | undefined, mergeId: string): boolean {
  if (!basisIds || basisIds.length === 0) return false;
  const origin = n.merges?.[mergeId]?.originMergeId;
  return basisIds.includes(mergeId) || (!!origin && basisIds.includes(origin));
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
      if (basisHits(n, entry.basisMergeIds, mergeId)) {
        return { entryKey: key, kind: "world", id: entry.id, name: "World expansion" };
      }
    } else {
      const arc = n.arcs[entry.arcId];
      if (arc && !seenArc.has(arc.id)) {
        seenArc.add(arc.id);
        if (basisHits(n, arc.basisMergeIds, mergeId)) {
          return { entryKey: key, kind: "arc", id: arc.id, name: arc.name };
        }
      }
    }
  }
  return null;
}

/** Look up a merge's consumer in a `buildMergeConsumerMap` result, matching the
 *  merge by its own id OR its `originMergeId` (a fork copy vs the original the
 *  shared entry references). */
export function mergeConsumerFor(
  map: Map<string, MergeConsumer>,
  merge: Merge,
): MergeConsumer | undefined {
  return map.get(merge.id) ?? (merge.originMergeId ? map.get(merge.originMergeId) : undefined);
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

/** How many of a merge's streams are EXECUTIVE — carry a committed resolution
 *  and therefore DRIVE the continuation. Recorded-only streams (no resolution)
 *  don't move the world, so they don't add to the scene budget. */
export function executiveStreamCount(merge: Pick<Merge, "streamIds" | "resolutions">): number {
  return (merge.streamIds ?? []).filter(
    (sid) => resolutionOutcomes(merge.resolutions?.[sid]).length > 0,
  ).length;
}

/**
 * Heuristic scene count to realise a merge's executive decisions in a single
 * continuation. One stream typically resolves in ~1 scene, but additional
 * streams scale SUBLINEARLY: a single coherent scene can carry several
 * resolutions at once, so the marginal cost per stream falls as the merge
 * grows (`scenes ≈ round(N^MERGE_SCENE_COMPRESSION)`, clamped to [1, max]).
 * Counts EXECUTIVE streams only; if a merge is record-only (no resolutions),
 * falls back to its total stream count so the floor is never zero. This is the
 * deterministic ANCHOR — the coordination suggestion may nudge it ±1 when the
 * streams genuinely need more or less room.
 */
export function suggestMergeSceneCount(
  merge: Pick<Merge, "streamIds" | "resolutions">,
  max = 12,
): number {
  const exec = executiveStreamCount(merge);
  const n = exec > 0 ? exec : (merge.streamIds ?? []).length;
  if (n <= 0) return 1;
  return Math.max(1, Math.min(max, Math.round(n ** MERGE_SCENE_COMPRESSION)));
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
 * EXECUTIVE vs RECORD: a merge RECORDS all of the room's decision-making, but
 * only the EXECUTIVE decisions drive generation. A stream WITH a resolution (an
 * entry in `merge.resolutions`) is an executive decision — committed fact that
 * steers the continuation. A stream WITHOUT one is folded in for the record
 * (a live uncertainty, or an alternative line weighed and not taken): it renders
 * as `<open>` carrying its stance DISTRIBUTION instead of an `outcome`, and is
 * marked NON-DRIVING — the continuation may acknowledge it for realism but must
 * not advance along it or harden it into fact. This lets a GM commit a primary
 * stance while preserving the unused alternatives in the merge (optionally
 * closed). Only `<resolved>` decisions move the world.
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
          `      <open ${attrs}>${priors ? `\n      <priors hint="ORGANISATIONAL RECORD — a line of thinking the room logged but did NOT commit as an executive decision. NON-DRIVING: it does not steer the continuation (only &lt;resolved&gt; decisions do). Treat it as context — a live uncertainty, or an alternative weighed and not taken — that the continuation MAY acknowledge for realism but must NOT advance along or harden into fact. Read the priors for awareness of what the room considered, never as a directive. [logType] tags weight: payoff/twist/escalation &gt; setup/pulse.">\n${priors}\n      </priors>\n      ` : ""}</open>`,
        );
      }
    }
    if (streamBlocks.length === 0) continue;
    const label = merge.label ? ` label="${xmlAttr(merge.label)}"` : "";
    const summary = merge.summary ? `\n    <summary>${xmlAttr(merge.summary)}</summary>` : "";
    mergeBlocks.push(`  <merge${label}>${summary}\n${streamBlocks.join("\n")}\n  </merge>`);
  }
  if (mergeBlocks.length === 0) return null;

  return `<continuity-basis hint="GROUND TRUTH the continuation extends from. Each &lt;resolved&gt; question below was committed at a merge — its outcome is what HAPPENED and outranks any speculative lean elsewhere in context. The priors under each are RAW perspective-held thinking (noisy evidence), not facts. De-noise them into a single direction (see &lt;synthesis&gt;) and continue ALONG that vector. PRIMARY FAILURE MODE: producing content that is thematically adjacent to these questions but never realises the committed outcomes by their actual content — every &lt;resolved&gt; outcome MUST surface concretely in what you produce, named and developed, not gestured at. overridden=&quot;true&quot; means reality diverged from the accumulated belief (which leaned belief-leaned) — honour the committed outcome, not the lean. multi-resolved=&quot;a + b&quot; means the question committed to SEVERAL outcomes at once — reconcile them as jointly true / a blend / a sequence / a partial, NOT as competing alternatives; if they cannot coherently coexist, prefer the primary outcome and treat the rest as tension. A merge RECORDS all the room's decision-making, but ONLY &lt;resolved&gt; (executive) decisions drive the continuation. &lt;open&gt; questions were folded in WITHOUT an executive outcome — they are organisational RECORD, not fact and not drivers: a live uncertainty, or an alternative line weighed and not taken. The continuation MAY acknowledge them (the room considered this) but must NOT advance along them or harden them into fact; the executive (resolved) decisions alone steer where the world goes.">
  <synthesis hint="How to turn these noisy priors + committed resolutions into the direction this continuation advances along. Do this BEFORE drafting — when an arc/expansion emits a directionVector, it IS the output of this synthesis.">
    <step n="1" name="signal-vs-noise">Treat each &lt;resolved&gt; question's committed outcome as settled fact (the signal). Treat its priors as raw, vantage-biased thinking — partial, sometimes wrong, often contradicting each other. Never promote a single prior to fact.</step>
    <step n="2" name="reconcile">Where priors disagree, or lean away from what was committed (especially overridden=&quot;true&quot;), the resolution wins. The discarded leans are not alternative truth — they are residue the continuation can still FEEL: denial, surprise, sunk conviction, a perspective forced to update or double down.</step>
    <step n="3" name="extract-vector">Across the &lt;resolved&gt; (executive) questions and their priors, read the net DIRECTION the body of evidence pushes — which pressures intensified, who gained or lost conviction, what is now closing, sharpening, opening, or foreclosed. Weight later priors and payoff/twist/escalation logTypes over early setup pulses, and higher-volume streams over thin ones. This aggregate is the de-noised direction vector — built from the executive decisions ONLY. &lt;open&gt; records inform your awareness of what the room weighed but do NOT add to the driving vector.</step>
    <step n="4" name="realise-each" critical="true">Advance the world ALONG that vector — and for EVERY &lt;resolved&gt; question, make its committed outcome CONCRETE and load-bearing in what you produce. Name the actual outcome (its real content — e.g. the specific answer that was committed, not merely the question's topic) and build the events, claims, or consequences that follow FROM it. Realise it NATURALLY inside the CONTINUING narrative, carried through the perspective that held the stream — the outcome becomes lived story (what that vantage now sees, decides, contends with, or is changed by) and the priors are its motive and texture, NOT a bolted-on statement of fact or a forecast report grafted onto the work. Let each perspective act on its confirmed or broken read. Content that is merely thematically adjacent to a question — touching its subject without ever asserting or developing the committed answer — does NOT count: a continuation that fails to realise each committed outcome by its actual content has IGNORED this basis. That is the PRIMARY FAILURE MODE; avoid it. Do not relitigate settled questions; build on them.</step>
    <step n="5" name="open-questions">Each &lt;open&gt; question is organisational RECORD, not an executive decision — it does NOT drive the continuation. No outcome was committed, so it is not fact. You may acknowledge it for realism (a question the room is still weighing, or a line it considered and did not take) but must NOT advance the world along it, harden it into a fact, or let it steer where the continuation goes. Its priors are context for what the room considered, never a directive. Only the &lt;resolved&gt; (executive) decisions move the world.</step>
  </synthesis>
${mergeBlocks.join("\n")}
</continuity-basis>`;
}
