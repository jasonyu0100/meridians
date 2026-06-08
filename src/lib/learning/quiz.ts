/**
 * Quiz aggregation + scoping helpers.
 *
 * Questions live on individual scenes (scene.questions). The Learn surface
 * and the sidebar both need to pool them across the timeline and slice that
 * pool by scope (one scene, one arc, one concept tag, or the whole
 * narrative). These pure helpers walk the resolved timeline so callers don't
 * re-implement the same flatten-and-filter each time.
 */

import { resolveEntry, isScene } from "@/types/narrative";
import type {
  LearningQuestion,
  NarrativeState,
  QuizScope,
  Scene,
  Topic,
} from "@/types/narrative";

export type QuestionWithMeta = {
  q: LearningQuestion;
  sceneId: string;
  /** 1-based position of the scene in the resolved timeline. */
  sceneIndex: number;
  /** Short scene summary, for labelling. */
  sceneLabel: string;
  arcId: string;
  arcName: string;
};

/** Every question across ALL scenes (all branches), flat. Topics are a global,
 *  narrative-level vocabulary shared by every branch, so curriculum-wide
 *  operations (restructure, dedup) must see the cumulative bank — not just one
 *  branch's resolved slice. Use `collectQuestions` for branch-scoped views. */
export function collectAllQuestions(narrative: NarrativeState): LearningQuestion[] {
  const out: LearningQuestion[] = [];
  for (const scene of Object.values(narrative.scenes)) {
    for (const q of scene.questions ?? []) out.push(q);
  }
  return out;
}

/** Flatten every scene's question bank into timeline order, with metadata. */
export function collectQuestions(
  narrative: NarrativeState,
  resolvedKeys: string[],
): QuestionWithMeta[] {
  const out: QuestionWithMeta[] = [];
  let sceneIndex = 0;
  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (!entry || !isScene(entry)) continue;
    sceneIndex += 1;
    const scene = entry as Scene;
    const arc = narrative.arcs[scene.arcId];
    const sceneLabel = (scene.summary ?? "").slice(0, 80);
    for (const q of scene.questions ?? []) {
      out.push({
        q,
        sceneId: scene.id,
        sceneIndex,
        sceneLabel,
        arcId: scene.arcId,
        arcName: arc?.name ?? "Unassigned",
      });
    }
  }
  return out;
}

/** Direct question count per topic id across a pool. */
export function quizTopicCounts(items: QuestionWithMeta[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { q } of items) {
    if (q.topicId) counts.set(q.topicId, (counts.get(q.topicId) ?? 0) + 1);
  }
  return counts;
}

/** Arcs that carry at least one question, in timeline order, with counts. */
export function quizArcs(
  items: QuestionWithMeta[],
): { arcId: string; arcName: string; count: number }[] {
  const order: string[] = [];
  const byArc = new Map<string, { arcName: string; count: number }>();
  for (const it of items) {
    const cur = byArc.get(it.arcId);
    if (cur) {
      cur.count += 1;
    } else {
      byArc.set(it.arcId, { arcName: it.arcName, count: 1 });
      order.push(it.arcId);
    }
  }
  return order.map((arcId) => ({ arcId, ...byArc.get(arcId)! }));
}

/** Scenes that carry at least one question, in timeline order, with counts. */
export function quizScenes(
  items: QuestionWithMeta[],
): { sceneId: string; sceneIndex: number; sceneLabel: string; count: number }[] {
  const order: string[] = [];
  const byScene = new Map<
    string,
    { sceneIndex: number; sceneLabel: string; count: number }
  >();
  for (const it of items) {
    const cur = byScene.get(it.sceneId);
    if (cur) {
      cur.count += 1;
    } else {
      byScene.set(it.sceneId, {
        sceneIndex: it.sceneIndex,
        sceneLabel: it.sceneLabel,
        count: 1,
      });
      order.push(it.sceneId);
    }
  }
  return order.map((sceneId) => ({ sceneId, ...byScene.get(sceneId)! }));
}

export type ScopeSelection = {
  scope: QuizScope;
  /** For scope 'scene' — the scene id. */
  sceneId?: string;
  /** For scope 'arc' — the arc id. */
  arcId?: string;
  /** For scope 'topic' — the topic id (includes its whole subtree). */
  topicId?: string;
};

/** Topic id + all descendant ids (inclusive). Inlined here (rather than
 *  importing curriculum) to keep quiz dependency-free — curriculum → coverage →
 *  quiz must stay acyclic. */
function topicSubtreeIds(
  topics: Record<string, Topic>,
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

/** Slice the pool down to a scope selection. Topic scope needs the topics map
 *  to resolve descendants. */
export function selectScope(
  items: QuestionWithMeta[],
  sel: ScopeSelection,
  topics: Record<string, Topic> = {},
): QuestionWithMeta[] {
  switch (sel.scope) {
    case "scene":
      return sel.sceneId ? items.filter((it) => it.sceneId === sel.sceneId) : [];
    case "arc":
      return sel.arcId ? items.filter((it) => it.arcId === sel.arcId) : [];
    case "topic": {
      if (!sel.topicId) return [];
      const ids = topicSubtreeIds(topics, sel.topicId);
      return items.filter((it) => it.q.topicId && ids.has(it.q.topicId));
    }
    case "narrative":
    default:
      return items;
  }
}

/** Deterministic shuffle of question metas, seeded by a number so a "reset"
 *  with the same seed reproduces order. Fisher–Yates over a mulberry32 PRNG —
 *  avoids Math.random so behaviour is reproducible in tests. */
export function shuffleQuestions(
  items: QuestionWithMeta[],
  seed: number,
): QuestionWithMeta[] {
  const arr = items.slice();
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Count questions per Bloom level in a pool — for summary chips. */
export function countByBloom(items: QuestionWithMeta[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { q } of items) out[q.bloom] = (out[q.bloom] ?? 0) + 1;
  return out;
}
