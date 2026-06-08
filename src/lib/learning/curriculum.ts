/**
 * Curriculum tree — operations over the Topic entities the question bank is
 * organised under.
 *
 * Topics are first-class entities (`NarrativeState.topics`): each question is
 * assigned to exactly one Topic (`question.topicId`), and Topic.parentId chains
 * form a re-organisable tree. This module builds the tree, walks ancestry /
 * descendants, guards re-parenting against cycles, rolls coverage/mastery up
 * the branches for one member, and renders the tree for the generator so new
 * questions extend the existing curriculum instead of forking it.
 *
 * Pure functions. Import direction: curriculum → coverage → quiz (acyclic).
 */

import type {
  MemberQuestionProgress,
  Scene,
  Topic,
} from "@/types/narrative";
import { questionRecall } from "./coverage";
import type { QuestionWithMeta } from "./quiz";

export type TopicMap = Record<string, Topic>;

/** Drop topics that carry no question anywhere in their subtree — the tree
 *  stays an exact reflection of the question bank, so it self-cleans when
 *  questions are reassigned or cleared (no manual merge/delete needed).
 *  Iterative + bottom-up: a childless topic with no direct questions is
 *  removed, which can orphan its parent, removed on the next pass. */
export function pruneOrphanTopics(
  topics: TopicMap,
  scenes: Record<string, Scene>,
): TopicMap {
  const used = new Set<string>();
  for (const s of Object.values(scenes)) {
    for (const q of s.questions ?? []) if (q.topicId) used.add(q.topicId);
  }
  const result: TopicMap = { ...topics };
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of Object.values(result)) {
      const hasChildren = Object.values(result).some(
        (o) => (o.parentId ?? null) === t.id,
      );
      if (!used.has(t.id) && !hasChildren) {
        delete result[t.id];
        changed = true;
      }
    }
  }
  return result;
}

// ── Tree shape ──────────────────────────────────────────────────────────────

export type TopicNode = {
  topic: Topic;
  depth: number;
  children: TopicNode[];
};

/** Direct children of a topic (parentId === id), name-sorted. */
export function topicChildren(topics: TopicMap, parentId: string | null): Topic[] {
  return Object.values(topics)
    .filter((t) => (t.parentId ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Build the topic forest (roots = parentId null/missing or dangling parent). */
export function buildTopicTree(topics: TopicMap): TopicNode[] {
  const node = (topic: Topic, depth: number): TopicNode => ({
    topic,
    depth,
    children: topicChildren(topics, topic.id).map((c) => node(c, depth + 1)),
  });
  // A topic whose parent no longer exists is treated as a root (defensive).
  const roots = Object.values(topics)
    .filter((t) => {
      const pid = t.parentId ?? null;
      return pid === null || !topics[pid];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return roots.map((t) => node(t, 0));
}

/** A topic id and all its descendant ids (inclusive). */
export function topicDescendants(
  topics: TopicMap,
  topicId: string,
): Set<string> {
  const out = new Set<string>([topicId]);
  let frontier = [topicId];
  while (frontier.length) {
    const next: string[] = [];
    for (const t of Object.values(topics)) {
      const pid = t.parentId ?? null;
      if (pid && frontier.includes(pid) && !out.has(t.id)) {
        out.add(t.id);
        next.push(t.id);
      }
    }
    frontier = next;
  }
  return out;
}

/** Ancestor chain from a topic up to its root (excludes the topic itself). */
export function topicAncestors(topics: TopicMap, topicId: string): Topic[] {
  const chain: Topic[] = [];
  let pid = topics[topicId]?.parentId ?? null;
  const guard = new Set<string>([topicId]);
  while (pid && topics[pid] && !guard.has(pid)) {
    chain.push(topics[pid]);
    guard.add(pid);
    pid = topics[pid].parentId ?? null;
  }
  return chain;
}

/** Full path label "Root / … / Leaf" for a topic. */
export function topicPath(topics: TopicMap, topicId: string): string {
  const self = topics[topicId];
  if (!self) return "";
  const names = [...topicAncestors(topics, topicId).reverse().map((t) => t.name), self.name];
  return names.join(" / ");
}

/** Would setting topicId's parent to newParentId create a cycle (or self-parent)? */
export function wouldCreateCycle(
  topics: TopicMap,
  topicId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === topicId) return true;
  // New parent must not be a descendant of the topic being moved.
  return topicDescendants(topics, topicId).has(newParentId);
}

// ── Coverage rollup ─────────────────────────────────────────────────────────

export type TopicCoverage = {
  topic: Topic;
  depth: number;
  /** Questions in this subtree (deduped). */
  total: number;
  covered: number;
  coverage: number;
  /** Mean live recall across subtree questions (unseen = 0). */
  mastery: number;
  due: number;
  children: TopicCoverage[];
};

/** Annotate the topic forest with rolled-up coverage / mastery for one member.
 *  Questions are grouped by their (direct) topicId; a node's stats cover its
 *  whole subtree. */
export function curriculumCoverage(
  topics: TopicMap,
  items: QuestionWithMeta[],
  progress: MemberQuestionProgress,
  now: number,
): TopicCoverage[] {
  // questionIds directly on each topic
  const direct = new Map<string, string[]>();
  for (const { q } of items) {
    if (!q.topicId) continue;
    const arr = direct.get(q.topicId) ?? [];
    arr.push(q.id);
    direct.set(q.topicId, arr);
  }

  const annotate = (node: TopicNode): TopicCoverage => {
    const children = node.children.map(annotate);
    const ids = new Set<string>(direct.get(node.topic.id) ?? []);
    // roll up children's subtree ids
    const collect = (n: TopicNode) => {
      for (const id of direct.get(n.topic.id) ?? []) ids.add(id);
      for (const c of n.children) collect(c);
    };
    collect(node);

    let covered = 0;
    let due = 0;
    let recallSum = 0;
    for (const id of ids) {
      const p = progress[id];
      if (p && p.seen > 0) covered += 1;
      if (p && p.seen > 0 && p.dueAt <= now) due += 1;
      recallSum += questionRecall(p, now);
    }
    const total = ids.size;
    return {
      topic: node.topic,
      depth: node.depth,
      total,
      covered,
      coverage: total ? covered / total : 0,
      mastery: total ? recallSum / total : 0,
      due,
      children,
    };
  };

  return buildTopicTree(topics).map(annotate);
}

/** Drop subtrees with no questions in scope. Topics are a shared vocabulary,
 *  but each BRANCH only lights up the topics its (resolved) questions touch —
 *  so a branch-scoped `items` set yields a branch-specific knowledge tree.
 *  Ancestors of a populated topic are retained for structure. */
export function pruneEmptyCoverage(forest: TopicCoverage[]): TopicCoverage[] {
  const walk = (nodes: TopicCoverage[]): TopicCoverage[] =>
    nodes
      .map((n) => ({ ...n, children: walk(n.children) }))
      .filter((n) => n.total > 0);
  return walk(forest);
}

// ── Prompt rendering ────────────────────────────────────────────────────────

/** Compact indented outline of the existing topic tree WITH ids, so the
 *  generator can assign questions to existing topics. Capped for prompt size.
 *  `counts` is direct-question counts per topic id (optional, for display). */
export function renderTopicOutline(
  topics: TopicMap,
  counts: Map<string, number> = new Map(),
  maxLines = 150,
): string {
  if (Object.keys(topics).length === 0) return "(no topics yet — propose the first ones)";
  const lines: string[] = [];
  const walk = (nodes: TopicNode[]) => {
    for (const n of nodes) {
      if (lines.length >= maxLines) return;
      const c = counts.get(n.topic.id) ?? 0;
      lines.push(`${"  ".repeat(n.depth)}- [${n.topic.id}] ${n.topic.name} (${c})`);
      walk(n.children);
    }
  };
  walk(buildTopicTree(topics));
  if (lines.length >= maxLines) lines.push("  …(tree truncated)");
  return lines.join("\n");
}
