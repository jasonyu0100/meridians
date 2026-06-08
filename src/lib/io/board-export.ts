// board-export — render the board/map state (location clusters) as Markdown.
// Mirrors graph-export: a pure getText for the canvas Copy button.

import type { NarrativeState } from "@/types/narrative";

export function exportBoardState(narrative: NarrativeState): string {
  const boards = Object.values(narrative.boards ?? {});
  const name = (id: string) => narrative.locations[id]?.name ?? id;

  const lines: string[] = [
    `# Board state — ${narrative.title}`,
    "",
    `${boards.length} board${boards.length === 1 ? "" : "s"}`,
    "",
  ];

  if (boards.length === 0) {
    lines.push("_No boards generated yet._");
    return lines.join("\n");
  }

  for (const board of boards.sort((a, b) => a.name.localeCompare(b.name))) {
    const depth =
      board.depth != null && Number.isFinite(board.depth) ? ` · depth ${board.depth}` : "";
    lines.push(`## ${board.name} \`${board.rootLocationId}\`${depth}`);
    if (board.locationIds.length > 0) {
      lines.push(`Members: ${board.locationIds.map(name).join(", ")}`);
    }
    if (board.edges.length > 0) {
      lines.push("Containment:");
      for (const e of board.edges) lines.push(`- ${name(e.from)} → ${name(e.to)}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
