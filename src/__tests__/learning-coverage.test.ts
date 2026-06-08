/**
 * Learning coverage + curriculum tests.
 *
 * Covers the pure spaced-repetition recall model (coverage.ts), the topic-tree
 * operations (curriculum.ts), and topic-subtree quiz scoping (quiz.ts).
 */
import { describe, it, expect } from "vitest";
import {
  emptyProgress,
  applyAnswer,
  questionRecall,
  overallCoverage,
  buildFocusedPool,
  topicMastery,
} from "@/lib/learning/coverage";
import {
  buildTopicTree,
  topicDescendants,
  wouldCreateCycle,
  curriculumCoverage,
  pruneEmptyCoverage,
  pruneOrphanTopics,
  topicPath,
} from "@/lib/learning/curriculum";
import type { Scene } from "@/types/narrative";
import { selectScope, type QuestionWithMeta } from "@/lib/learning/quiz";
import type { LearningQuestion, Topic } from "@/types/narrative";

const DAY = 24 * 60 * 60 * 1000;

function q(id: string, topicId?: string): LearningQuestion {
  return {
    id,
    sceneId: "S-1",
    prompt: id,
    options: ["a", "b"],
    correctIndex: 0,
    topicId,
    bloom: "understand",
    difficulty: "medium",
    createdAt: 0,
  };
}

function meta(question: LearningQuestion, i = 1): QuestionWithMeta {
  return {
    q: question,
    sceneId: question.sceneId,
    sceneIndex: i,
    sceneLabel: "scene",
    arcId: "A-1",
    arcName: "Arc",
  };
}

const topics: Record<string, Topic> = {
  root: { id: "root", name: "Magic", parentId: null, createdAt: 0 },
  child: { id: "child", name: "Wandlore", parentId: "root", createdAt: 0 },
  grand: { id: "grand", name: "Allegiance", parentId: "child", createdAt: 0 },
  other: { id: "other", name: "Politics", parentId: null, createdAt: 0 },
};

describe("applyAnswer + questionRecall", () => {
  const now = 1_000_000_000_000;

  it("a correct answer raises strength, streak, and pushes dueAt into the future", () => {
    const p = applyAnswer(emptyProgress().byMember.x ?? {}, "q1", true, now);
    expect(p.q1.seen).toBe(1);
    expect(p.q1.correct).toBe(1);
    expect(p.q1.streak).toBe(1);
    expect(p.q1.strength).toBeGreaterThan(0);
    expect(p.q1.dueAt).toBeGreaterThan(now);
  });

  it("a miss resets the streak and makes it due immediately", () => {
    let p = applyAnswer({}, "q1", true, now);
    p = applyAnswer(p, "q1", true, now);
    expect(p.q1.streak).toBe(2);
    p = applyAnswer(p, "q1", false, now);
    expect(p.q1.streak).toBe(0);
    expect(p.q1.dueAt).toBe(now); // resurfaces next session
    expect(p.q1.seen).toBe(3);
  });

  it("recall is 0 for unseen and decays over elapsed time", () => {
    expect(questionRecall(undefined, now)).toBe(0);
    const p = applyAnswer({}, "q1", true, now);
    const fresh = questionRecall(p.q1, now);
    const later = questionRecall(p.q1, now + 30 * DAY);
    expect(fresh).toBeGreaterThan(later);
    expect(later).toBeGreaterThanOrEqual(0);
  });
});

describe("overallCoverage + topicMastery", () => {
  const now = 2_000_000_000_000;
  const items = [meta(q("q1", "root")), meta(q("q2", "child")), meta(q("q3", "child"))];

  it("counts coverage and unseen with mastery 0 when nothing answered", () => {
    const o = overallCoverage(items, {}, now);
    expect(o.total).toBe(3);
    expect(o.covered).toBe(0);
    expect(o.unseen).toBe(3);
    expect(o.mastery).toBe(0);
  });

  it("covered rises as questions are answered", () => {
    const prog = applyAnswer({}, "q1", true, now);
    const o = overallCoverage(items, prog, now);
    expect(o.covered).toBe(1);
    expect(o.coverage).toBeCloseTo(1 / 3);
    expect(o.mastery).toBeGreaterThan(0);
  });

  it("topicMastery groups by direct topicId, weakest first", () => {
    const tm = topicMastery(items, {}, now);
    const ids = tm.map((t) => t.topicId);
    expect(ids).toContain("root");
    expect(ids).toContain("child");
  });
});

describe("buildFocusedPool", () => {
  const now = 3_000_000_000_000;
  it("prioritises unseen questions ahead of well-known ones", () => {
    const items = [meta(q("known", "root")), meta(q("unseen", "child"))];
    // 'known' answered correctly several times
    let prog = applyAnswer({}, "known", true, now);
    prog = applyAnswer(prog, "known", true, now);
    const pool = buildFocusedPool(items, prog, now, 2);
    expect(pool[0].q.id).toBe("unseen");
  });
});

describe("topic tree", () => {
  it("topicDescendants includes self and all descendants", () => {
    const d = topicDescendants(topics, "root");
    expect(d).toEqual(new Set(["root", "child", "grand"]));
    expect(topicDescendants(topics, "other")).toEqual(new Set(["other"]));
  });

  it("wouldCreateCycle catches self-parent and descendant-parent", () => {
    expect(wouldCreateCycle(topics, "root", "root")).toBe(true);
    expect(wouldCreateCycle(topics, "root", "grand")).toBe(true); // grand is under root
    expect(wouldCreateCycle(topics, "grand", "other")).toBe(false);
    expect(wouldCreateCycle(topics, "root", null)).toBe(false);
  });

  it("topicPath renders the full ancestry", () => {
    expect(topicPath(topics, "grand")).toBe("Magic / Wandlore / Allegiance");
  });

  it("buildTopicTree roots topics with no (or dangling) parent", () => {
    const forest = buildTopicTree(topics);
    expect(forest.map((n) => n.topic.id).sort()).toEqual(["other", "root"]);
    const magic = forest.find((n) => n.topic.id === "root")!;
    expect(magic.children[0].topic.id).toBe("child");
  });
});

describe("curriculumCoverage + prune", () => {
  const now = 4_000_000_000_000;
  const items = [meta(q("q1", "grand")), meta(q("q2", "child"))];

  it("rolls subtree question counts up the branch", () => {
    const forest = curriculumCoverage(topics, items, {}, now);
    const root = forest.find((n) => n.topic.id === "root")!;
    expect(root.total).toBe(2); // q1 (grand) + q2 (child) both under root
    const other = forest.find((n) => n.topic.id === "other")!;
    expect(other.total).toBe(0);
  });

  it("pruneEmptyCoverage drops topics with no in-scope questions", () => {
    const pruned = pruneEmptyCoverage(curriculumCoverage(topics, items, {}, now));
    const ids = pruned.map((n) => n.topic.id);
    expect(ids).toContain("root");
    expect(ids).not.toContain("other");
  });
});

describe("pruneOrphanTopics", () => {
  const scene = (id: string, qs: LearningQuestion[]): Scene =>
    ({ kind: "scene", id, questions: qs } as unknown as Scene);

  it("removes topics with no questions in their subtree, keeping populated branches", () => {
    // only 'grand' carries a question → root+child kept (ancestors), 'other' dropped
    const scenes = { "S-1": scene("S-1", [q("q1", "grand")]) };
    const pruned = pruneOrphanTopics(topics, scenes);
    expect(Object.keys(pruned).sort()).toEqual(["child", "grand", "root"]);
  });

  it("clears the whole tree when no questions remain (fresh start)", () => {
    const scenes = { "S-1": scene("S-1", []) };
    expect(pruneOrphanTopics(topics, scenes)).toEqual({});
  });
});

describe("selectScope topic subtree", () => {
  const items = [
    meta(q("q1", "root")),
    meta(q("q2", "child")),
    meta(q("q3", "grand")),
    meta(q("q4", "other")),
  ];
  it("a parent topic selection sweeps in its whole subtree", () => {
    const picked = selectScope(items, { scope: "topic", topicId: "root" }, topics);
    expect(picked.map((it) => it.q.id).sort()).toEqual(["q1", "q2", "q3"]);
  });
  it("a leaf topic selection picks only that topic", () => {
    const picked = selectScope(items, { scope: "topic", topicId: "grand" }, topics);
    expect(picked.map((it) => it.q.id)).toEqual(["q3"]);
  });
});
