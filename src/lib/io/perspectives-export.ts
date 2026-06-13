/**
 * Markdown exporter for the arc Perspectives (Content → Perspectives) — the
 * retellings that synthesize a whole arc through one lens. Walks every arc in
 * timeline order and, for each, emits its generated perspectives:
 *   - the **public** narrator (third person, widely-known account)
 *   - each arc **participant** (first person, canon)
 *   - any **non-canon** lens (an entity outside the arc, voiced as a concurrent
 *     "elsewhere" account) — grouped under a divider so canon stays separable
 *
 * Reads arc.perspectives only; never touches deltas. Arcs with no generated
 * perspectives are skipped.
 */

import type { Arc, NarrativeState, PerspectiveView } from "@/types/narrative";
import { availablePerspectiveKeys, perspectiveLabel } from "@/lib/ai/perspectives";

export type PerspectivesExportContext = {
  narrative: NarrativeState;
  /** Resolved entry keys for the active branch — used to order arcs in time. */
  resolvedKeys: string[];
};

/** The arc's position in the timeline: index of its first scene in the resolved
 *  entry list. Arcs with no resolved scene sink to the end. */
function arcStartIndex(arc: Arc, resolvedKeys: string[]): number {
  const ids = new Set(arc.sceneIds ?? []);
  for (let i = 0; i < resolvedKeys.length; i++) if (ids.has(resolvedKeys[i])) return i;
  return Number.MAX_SAFE_INTEGER;
}

export function exportPerspectives(ctx: PerspectivesExportContext): string {
  const { narrative: n, resolvedKeys } = ctx;
  const arcs = Object.values(n.arcs ?? {})
    .filter((a) => Object.values(a.perspectives ?? {}).some((v) => v?.text?.trim()))
    .sort((a, b) => arcStartIndex(a, resolvedKeys) - arcStartIndex(b, resolvedKeys));

  const lines: string[] = [];
  lines.push(`# ${n.title} — Perspectives`);
  const totalLenses = arcs.reduce(
    (sum, a) => sum + Object.values(a.perspectives ?? {}).filter((v) => v?.text?.trim()).length,
    0,
  );
  lines.push(
    `${arcs.length} arc${arcs.length === 1 ? "" : "s"} · ` +
      `${totalLenses} perspective${totalLenses === 1 ? "" : "s"}`,
  );
  lines.push("");

  if (arcs.length === 0) {
    lines.push("_No perspectives generated yet._");
    return lines.join("\n") + "\n";
  }

  for (const arc of arcs) {
    const canon = new Set(availablePerspectiveKeys(n, arc)); // includes "public"
    const views = arc.perspectives ?? {};
    const generated = Object.keys(views).filter((k) => views[k]?.text?.trim());

    // Canon first (public floats to the top of its group), then non-canon.
    const canonKeys = generated
      .filter((k) => canon.has(k))
      .sort((a, b) => (a === "public" ? -1 : b === "public" ? 1 : a.localeCompare(b)));
    const otherKeys = generated.filter((k) => !canon.has(k)).sort((a, b) => a.localeCompare(b));

    lines.push(`## ${arc.name || arc.id}`);
    lines.push("");

    const renderLens = (key: string, view: PerspectiveView) => {
      const tag =
        key === "public" ? " · widely known" : !canon.has(key) ? " · non-canon · elsewhere" : "";
      lines.push(`### ${perspectiveLabel(n, key)}${tag}`);
      lines.push("");
      lines.push(view.text.trim());
      lines.push("");
    };

    for (const key of canonKeys) renderLens(key, views[key]);
    if (otherKeys.length > 0) {
      lines.push(`### Other perspectives (non-canon)`);
      lines.push("");
      for (const key of otherKeys) renderLens(key, views[key]);
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
