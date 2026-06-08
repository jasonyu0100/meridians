// Curriculum-restructure LLM helpers — reorganise the global topic tree into a
// cleaner, better-balanced curriculum.
//
// Cross-branch safety. Topics are NARRATIVE-LEVEL (shared by every branch);
// questions live on branch-shared scenes and reference a topic by id. A
// restructure therefore touches the whole narrative, not one branch — and that
// is fine, AS LONG AS no question is ever left pointing at a removed topic. The
// proposal is expressed in three ID-STABLE moves so the cumulative question
// bank stays intact across all branches:
//   • reparent — change a topic's parentId (the tree reshapes; questions keep
//     their topic, so every branch's questions stay valid)
//   • rename   — relabel a topic (id stable)
//   • merge    — fold a redundant topic into another; the apply step redirects
//     EVERY question (across all scenes/branches) off the removed topic onto
//     the survivor, atomically. The only operation that moves questions, and it
//     moves them consistently everywhere.
// New topics are never minted and ids never change, so there is no remap to go
// stale in another branch.

import type { NarrativeState, Scene } from '@/types/narrative';
import { callGenerateStream, resolveReasoningBudget } from './api';
import { parseJson } from './json';
import { MAX_TOKENS_DEFAULT } from '@/lib/constants';
import { logInfo } from '@/lib/core/system-logger';
import { collectAllQuestions } from '@/lib/learning/quiz';
import { buildTopicTree, pruneOrphanTopics, type TopicMap } from '@/lib/learning/curriculum';

/** Sweet-spot direct children per topic node — the prompt aims here. */
export const TOPIC_FANOUT_TARGET = 6;
/** Soft ceiling the prompt asks the model to respect (flagged amber in review). */
export const TOPIC_FANOUT_MAX = 8;

/** The validated, id-stable restructure proposal. Editable (reparenting) in the
 *  review modal before it is applied. */
export type CurriculumProposal = {
  /** Every SURVIVING topic id → its new parent id (null = root). */
  assignments: Record<string, string | null>;
  /** Surviving topic id → new name (only entries that actually change). */
  renames: Record<string, string>;
  /** Fold `from` into `into`; `from` is removed and its questions redirected. */
  merges: Array<{ from: string; into: string }>;
  /** The model's one-paragraph reasoning for the new shape (shown in review). */
  rationale: string;
};

/** Raw JSON shape the model returns (before sanitisation). */
type RawProposal = {
  rationale?: string;
  merges?: Array<{ from?: string; into?: string }>;
  renames?: Array<{ id?: string; name?: string }>;
  assignments?: Array<{ id?: string; parentId?: string | null }>;
};

/** Direct-question counts per topic, across ALL scenes (cumulative, all branches). */
function globalTopicCounts(narrative: NarrativeState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const q of collectAllQuestions(narrative)) {
    if (q.topicId) counts.set(q.topicId, (counts.get(q.topicId) ?? 0) + 1);
  }
  return counts;
}

/** Render the current tree + a few sample question stems per topic, so the model
 *  reorganises with knowledge of what each topic actually contains. Counts are
 *  cumulative across all branches. */
function describeCurriculum(narrative: NarrativeState): string {
  const topics: TopicMap = narrative.topics ?? {};
  const counts = globalTopicCounts(narrative);

  // Sample question prompts per topic (cumulative bank), capped for prompt size.
  const samples = new Map<string, string[]>();
  for (const q of collectAllQuestions(narrative)) {
    if (!q.topicId) continue;
    const arr = samples.get(q.topicId) ?? [];
    if (arr.length < 3) arr.push(q.prompt.replace(/\s+/g, ' ').slice(0, 120));
    samples.set(q.topicId, arr);
  }

  const lines: string[] = [];
  const walk = (nodes: ReturnType<typeof buildTopicTree>) => {
    for (const n of nodes) {
      if (lines.length >= 400) return;
      const c = counts.get(n.topic.id) ?? 0;
      const ex = samples.get(n.topic.id) ?? [];
      const exText = ex.length ? ` — e.g. ${ex.map((s) => `"${s}"`).join('; ')}` : '';
      lines.push(`${'  '.repeat(n.depth)}- [${n.topic.id}] ${n.topic.name} (${c}q)${exText}`);
      walk(n.children);
    }
  };
  walk(buildTopicTree(topics));
  if (lines.length >= 400) lines.push('  …(tree truncated)');
  return lines.join('\n') || '(no topics yet)';
}

const RESTRUCTURE_SYSTEM = `You are a curriculum architect. You are given the COMPLETE topic tree of a knowledge base — every topic with its id, name, a cumulative question count (across the whole work, all branches), and a few sample question stems — and you reorganise it into a cleaner, better-balanced curriculum.

The topics are organised as a tree: a child topic is a SUBTOPIC of its parent (a narrower area within a broader one). Questions hang off topics. This tree is shared knowledge — the same curriculum is read from every branch of the work — so your job is to make it coherent and well-structured as a whole.

You may make exactly three kinds of move, and NOTHING else:
- REPARENT — change a topic's parent so the nesting reads correctly (a specific topic becomes a child of the broader area it belongs under). null parent = a top-level area.
- RENAME — relabel a topic for clarity or consistency (keep the same topic; just a better name).
- MERGE — fold a REDUNDANT topic into another that covers the same ground. The folded topic is removed and ALL its questions move to the survivor. Use this to collapse the near-duplicate topics that accumulate when questions are generated scene by scene (e.g. "Wand Lore" and "Wandlore", or two topics that are really the same concept).

You CANNOT invent new topics, split a topic, move individual questions, or delete a topic that still has unique content. Every existing topic must either survive (with a parent) or be merged into a survivor. Work only with the ids given; never invent ids.

GOALS:
- CONSOLIDATE duplicates and near-duplicates via MERGE — this is usually the biggest win. A scene-by-scene bank tends to mint slight variants of the same topic.
- BALANCE the tree: aim for about ${TOPIC_FANOUT_TARGET} direct children per node, and avoid exceeding ${TOPIC_FANOUT_MAX}. If a node is over-full, introduce intermediate grouping by reparenting some of its children under a broader sibling/topic. Prefer a deep, multi-level tree over a wide flat one.
- COHERENCE: a child must genuinely be a narrower case of its parent. Fix mis-nestings and topics dumped at the top level that belong under a broader area.
- PRESERVE what already works — don't reshuffle arbitrarily. Re-parent only where it genuinely improves the structure.

Output ONLY JSON, no prose:
{
  "rationale": "<one paragraph: the key problems you found and the shape you imposed>",
  "merges": [{"from":"<id removed>","into":"<survivor id>"}, ...],
  "renames": [{"id":"<id>","name":"<new name>"}, ...],
  "assignments": [{"id":"<surviving id>","parentId":"<id>"|null}, ...]
}
Include an assignment for every topic that is NOT merged away. Do not include merged-away ids in renames or assignments.`;

/** Follow a merge chain (from → into → …) to its terminal survivor, guarding
 *  against cycles. Returns the id unchanged if it isn't merged away. */
function resolveMergeTarget(id: string, direct: Map<string, string>): string {
  const seen = new Set<string>([id]);
  let cur = id;
  while (direct.has(cur)) {
    const next = direct.get(cur)!;
    if (seen.has(next)) break; // cycle — stop at the last safe hop
    seen.add(next);
    cur = next;
  }
  return cur;
}

/**
 * Coerce a raw (or operator-edited) proposal into a valid, id-stable plan over
 * the narrative's real topics:
 *   • merges: only real ids, no self-merge, chains resolved to a terminal
 *     survivor, the survivor itself never merged away;
 *   • survivors = all topics not merged away;
 *   • renames: surviving ids with a non-empty, changed name;
 *   • assignments: every survivor → a surviving parent (merged parents
 *     redirected; self / dangling / cyclic links promoted to root). Topics the
 *     model omitted keep their current (redirected) parent.
 */
export function sanitizeCurriculum(
  raw: { merges?: Array<{ from: string; into: string }>; renames?: Record<string, string>; assignments?: Record<string, string | null>; rationale?: string },
  narrative: NarrativeState,
): CurriculumProposal {
  const topics: TopicMap = narrative.topics ?? {};
  const ids = new Set(Object.keys(topics));

  // ── Merges → a redirect map (removed id → survivor) ──────────────────────
  const direct = new Map<string, string>();
  for (const m of raw.merges ?? []) {
    if (!m || !ids.has(m.from) || !ids.has(m.into) || m.from === m.into) continue;
    if (direct.has(m.from)) continue; // first merge for an id wins
    direct.set(m.from, m.into);
  }
  // Resolve chains so every removed id maps straight to its terminal survivor.
  const redirect = new Map<string, string>();
  for (const from of direct.keys()) {
    const target = resolveMergeTarget(from, direct);
    if (target !== from) redirect.set(from, target);
  }
  const survivors = new Set([...ids].filter((id) => !redirect.has(id)));

  // ── Renames (surviving ids, changed, non-empty) ──────────────────────────
  const renames: Record<string, string> = {};
  for (const [id, name] of Object.entries(raw.renames ?? {})) {
    const trimmed = (name ?? '').trim();
    if (survivors.has(id) && trimmed && trimmed !== topics[id].name) renames[id] = trimmed;
  }

  // ── Assignments (every survivor → a surviving parent) ────────────────────
  const redirectId = (id: string | null): string | null =>
    id == null ? null : redirect.get(id) ?? id;
  const parents = new Map<string, string | null>();
  for (const id of survivors) {
    const proposed = raw.assignments?.[id];
    let p = proposed !== undefined ? proposed : (topics[id].parentId ?? null);
    p = redirectId(p ?? null); // a merged-away parent points to its survivor
    if (p === id) p = null; // self-parent
    if (p != null && !survivors.has(p)) p = null; // dangling / non-surviving
    parents.set(id, p);
  }
  // Break cycles: walking up must terminate at a root.
  for (const id of survivors) {
    const seen = new Set<string>([id]);
    let cur = parents.get(id) ?? null;
    while (cur != null) {
      if (seen.has(cur)) {
        parents.set(id, null);
        break;
      }
      seen.add(cur);
      cur = parents.get(cur) ?? null;
    }
  }

  return {
    assignments: Object.fromEntries(parents),
    renames,
    merges: [...redirect.entries()].map(([from, into]) => ({ from, into })),
    rationale: (raw.rationale ?? '').trim(),
  };
}

/** Largest direct-children count in the proposed forest (for logging / QA). */
function maxFanout(assignments: Record<string, string | null>): number {
  const counts = new Map<string | null, number>();
  for (const p of Object.values(assignments)) counts.set(p, (counts.get(p) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

/**
 * Ask the model to restructure the global topic tree and return a validated,
 * id-stable proposal (reparent + rename + merge). The caller reviews / edits the
 * reparenting before applying, so this is a PROPOSAL. Streams the model's
 * reasoning via `onReasoning`. `repairFromRaw` re-parses a prior malformed
 * output instead of a fresh call.
 */
export async function reorganizeCurriculum(
  narrative: NarrativeState,
  opts: { onReasoning?: (token: string) => void; repairFromRaw?: string } = {},
): Promise<CurriculumProposal> {
  const topicCount = Object.keys(narrative.topics ?? {}).length;
  if (topicCount === 0) {
    return { assignments: {}, renames: {}, merges: [], rationale: '' };
  }

  const userPrompt = `Work: "${narrative.title}". ${topicCount} topics.\n\nCURRENT TOPIC TREE (id, name, cumulative question count across all branches, sample stems):\n${describeCurriculum(narrative)}\n\nReorganise this curriculum: merge duplicates, rebalance fan-out, fix mis-nestings, rename for clarity. Return the JSON.`;

  const raw =
    opts.repairFromRaw ??
    (await callGenerateStream(
      userPrompt,
      RESTRUCTURE_SYSTEM,
      () => {}, // the JSON body isn't shown live — only reasoning is
      MAX_TOKENS_DEFAULT,
      'reorganizeCurriculum',
      undefined,
      resolveReasoningBudget(narrative),
      (t) => opts.onReasoning?.(t),
    ));

  const parsed = parseJson(raw, 'reorganizeCurriculum') as RawProposal;

  const merges = (Array.isArray(parsed?.merges) ? parsed.merges : [])
    .filter((m): m is { from: string; into: string } => !!m && typeof m.from === 'string' && typeof m.into === 'string')
    .map((m) => ({ from: m.from, into: m.into }));
  const renames: Record<string, string> = {};
  for (const r of Array.isArray(parsed?.renames) ? parsed.renames : []) {
    if (r && typeof r.id === 'string' && typeof r.name === 'string') renames[r.id] = r.name;
  }
  const assignments: Record<string, string | null> = {};
  for (const a of Array.isArray(parsed?.assignments) ? parsed.assignments : []) {
    if (a && typeof a.id === 'string') assignments[a.id] = a.parentId ?? null;
  }

  const proposal = sanitizeCurriculum({ merges, renames, assignments, rationale: parsed?.rationale }, narrative);
  logInfo('Curriculum restructure proposed', {
    source: 'analysis',
    operation: 'reorganize-curriculum',
    details: {
      topicCount,
      merges: proposal.merges.length,
      renames: Object.keys(proposal.renames).length,
      survivors: Object.keys(proposal.assignments).length,
      maxFanout: maxFanout(proposal.assignments),
    },
  });
  return proposal;
}

/** Re-sanitise after the operator edits the reparenting in the review modal,
 *  keeping the proposal's merges + renames. */
export function resanitizeCurriculum(
  proposal: CurriculumProposal,
  editedAssignments: Record<string, string | null>,
  narrative: NarrativeState,
): CurriculumProposal {
  return sanitizeCurriculum(
    { merges: proposal.merges, renames: proposal.renames, assignments: editedAssignments, rationale: proposal.rationale },
    narrative,
  );
}

/** Helper for the modal: the proposed parent→children index over survivors
 *  (null key = top level), names resolved through the proposal's renames. */
export function proposalTopicName(
  proposal: CurriculumProposal,
  topics: TopicMap,
  id: string,
): string {
  return proposal.renames[id] ?? topics[id]?.name ?? id;
}

/** Does the proposal actually change anything? Used by the modal to disable
 *  Apply (and tell the operator) when the model proposed an identity restructure
 *  — so "Apply" never looks like it silently did nothing. */
export function proposalHasChanges(proposal: CurriculumProposal, topics: TopicMap): boolean {
  if (proposal.merges.length > 0) return true;
  if (Object.keys(proposal.renames).length > 0) return true;
  for (const [id, parent] of Object.entries(proposal.assignments)) {
    if ((topics[id]?.parentId ?? null) !== (parent ?? null)) return true;
  }
  return false;
}

/**
 * Apply a validated restructure to a narrative, returning the new topics map +
 * scenes. PURE (no dispatch) so the reducer and tests share one implementation.
 *
 * Cross-branch safe: `merges` redirect every question (across ALL scenes, hence
 * all branches) off a removed topic onto its terminal survivor, atomically;
 * `renames`/`assignments` only touch surviving topics; reparenting is
 * redirected + cycle-guarded; and a final orphan-prune drops any topic left
 * with no questions in its subtree. No question is ever left pointing at a
 * removed or missing topic.
 */
export function applyCurriculumRestructure(
  narrative: NarrativeState,
  plan: {
    assignments: Record<string, string | null>;
    renames: Record<string, string>;
    merges: Array<{ from: string; into: string }>;
  },
): { topics: TopicMap; scenes: Record<string, Scene> } {
  const topics: TopicMap = narrative.topics ?? {};

  // Merge redirect (removed id → terminal survivor), chains resolved.
  const direct = new Map<string, string>();
  for (const m of plan.merges) {
    if (topics[m.from] && topics[m.into] && m.from !== m.into && !direct.has(m.from)) {
      direct.set(m.from, m.into);
    }
  }
  const redirect = (id: string): string => resolveMergeTarget(id, direct);

  const survivorIds = Object.keys(topics).filter((id) => redirect(id) === id);
  const survivorSet = new Set(survivorIds);

  // Survivors: apply rename + reparent (redirect merged parents, drop self /
  // non-surviving links to root).
  const nextTopics: TopicMap = {};
  for (const id of survivorIds) {
    const t = topics[id];
    const name = plan.renames[id]?.trim() || t.name;
    let parentId = plan.assignments[id] !== undefined ? plan.assignments[id] : (t.parentId ?? null);
    if (parentId != null) parentId = redirect(parentId);
    if (parentId != null && (parentId === id || !survivorSet.has(parentId))) parentId = null;
    nextTopics[id] = { ...t, name, parentId };
  }
  // Cycle-break over survivors (defensive — assignments are pre-sanitised).
  for (const id of survivorIds) {
    const seen = new Set<string>([id]);
    let cur = nextTopics[id].parentId;
    while (cur != null) {
      if (seen.has(cur)) {
        nextTopics[id] = { ...nextTopics[id], parentId: null };
        break;
      }
      seen.add(cur);
      cur = nextTopics[cur]?.parentId ?? null;
    }
  }

  // Redirect every question off any removed / missing topic onto its survivor.
  const scenes = { ...narrative.scenes };
  let changed = false;
  for (const scene of Object.values(narrative.scenes)) {
    if (!scene.questions?.length) continue;
    let touched = false;
    const questions = scene.questions.map((q) => {
      if (!q.topicId) return q;
      const target = nextTopics[q.topicId] ? q.topicId : redirect(q.topicId);
      const resolved = nextTopics[target] ? target : undefined;
      if (resolved === q.topicId) return q;
      touched = true;
      return { ...q, topicId: resolved };
    });
    if (touched) {
      scenes[scene.id] = { ...scene, questions };
      changed = true;
    }
  }
  const finalScenes = changed ? scenes : narrative.scenes;

  return { topics: pruneOrphanTopics(nextTopics, finalScenes), scenes: finalScenes };
}
