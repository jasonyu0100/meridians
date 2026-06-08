// curriculum-export — render a branch's Topic tree + questions as Markdown.
// Mirrors graph-export: a pure getText for the canvas Copy button.

import { collectQuestions } from "@/lib/learning/quiz";
import {
  curriculumCoverage,
  pruneEmptyCoverage,
  type TopicCoverage,
} from "@/lib/learning/curriculum";
import type { LearningQuestion, NarrativeState } from "@/types/narrative";

export function exportCurriculum(
  narrative: NarrativeState,
  resolvedKeys: string[],
): string {
  const items = collectQuestions(narrative, resolvedKeys);

  // Direct questions per topic id.
  const byTopic = new Map<string, LearningQuestion[]>();
  for (const it of items) {
    if (!it.q.topicId) continue;
    const arr = byTopic.get(it.q.topicId) ?? [];
    arr.push(it.q);
    byTopic.set(it.q.topicId, arr);
  }

  // Branch-scoped tree (empty progress — counts only).
  const forest = pruneEmptyCoverage(
    curriculumCoverage(narrative.topics ?? {}, items, {}, 0),
  );

  const topicCount = Object.keys(narrative.topics ?? {}).length;
  const questionCount = items.filter((it) => it.q.topicId).length;

  const lines: string[] = [
    `# Curriculum — ${narrative.title}`,
    "",
    `${topicCount} topic${topicCount === 1 ? "" : "s"} · ${questionCount} question${questionCount === 1 ? "" : "s"} (this branch)`,
    "",
  ];

  const walk = (nodes: TopicCoverage[], depth: number) => {
    for (const node of nodes) {
      const pad = "  ".repeat(depth);
      lines.push(`${pad}- **${node.topic.name}** \`${node.topic.id}\` (${node.total})`);
      if (node.topic.description?.trim()) {
        lines.push(`${pad}  _${node.topic.description.trim()}_`);
      }
      for (const q of byTopic.get(node.topic.id) ?? []) {
        lines.push(`${pad}  - \`${q.id}\` _${q.bloom} · ${q.difficulty}_ — ${q.prompt}`);
        const correct = q.options[q.correctIndex];
        if (correct) lines.push(`${pad}    - ✓ ${correct}`);
      }
      walk(node.children, depth + 1);
    }
  };
  walk(forest, 0);

  return lines.join("\n");
}
