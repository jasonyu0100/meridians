/**
 * Markdown exporter for the prediction-market dashboard. Snapshots the
 * portfolio *at the current scene index* (same point-in-time replay the
 * BeliefView uses) so the export matches exactly what the user is looking
 * at when they hit Copy.
 *
 * Output layout — designed to read top-down as an analyst's brief:
 *   1. Header + headline stats (scale, attention, uncertainty)
 *   2. Portfolio aggregates (counts, resolution-quality bands)
 *   3. Category mix (share of live markets by state)
 *   4. Recent movers (biggest |Δ| on the leader outcome over a lookback)
 *   5. Volatility leaders (top live markets by EWMA σ)
 *   6. Per-market detail, grouped by category, focus-first, with full
 *      outcome distributions + margin / volume / volatility / gap lines
 *   7. Resolved + abandoned tail
 */

import type { NarrativeState } from "@/types/narrative";
import {
  buildPortfolioRows,
  computePortfolioSnapshot,
  computeRecentMovements,
  currentFocusIds,
  replayThreadsAtIndex,
  type PortfolioRow,
} from "@/lib/portfolio-analytics";
import {
  THREAD_CATEGORY_LABEL,
  type ThreadCategory,
} from "@/lib/thread-category";
import { countScenes, sceneOrdinalAt } from "@/lib/narrative-utils";

export type BeliefExportContext = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentSceneIndex: number;
  /** Scenes of lookback for the "recent movers" section. Defaults to 5. */
  recentLookback?: number;
};

export function exportBeliefSnapshot(ctx: BeliefExportContext): string {
  const { narrative, resolvedKeys, currentSceneIndex } = ctx;
  const lookback = ctx.recentLookback ?? 5;

  const scrubbed: NarrativeState = {
    ...narrative,
    threads: replayThreadsAtIndex(narrative, resolvedKeys, currentSceneIndex),
  };
  const rows = buildPortfolioRows(scrubbed, resolvedKeys, currentSceneIndex);
  const snapshot = computePortfolioSnapshot(scrubbed);
  const focusIds = currentFocusIds(scrubbed, resolvedKeys, currentSceneIndex);

  const lines: string[] = [];
  const sceneNum = Math.max(1, sceneOrdinalAt(narrative, resolvedKeys, currentSceneIndex));
  const sceneTotal = countScenes(narrative, resolvedKeys);
  lines.push(`# ${narrative.title} — Market Snapshot`);
  lines.push(`Scene ${sceneNum} of ${sceneTotal} · passive observer`);
  lines.push("");

  // ── Portfolio aggregates ────────────────────────────────────────────────
  lines.push("## Portfolio");
  lines.push(`- Markets: **${snapshot.totalThreads}** total`);
  lines.push(
    `  - Open: ${snapshot.activeThreads}` +
      (snapshot.nearClosedThreads > 0 ? ` (${snapshot.nearClosedThreads} near-closed)` : ""),
  );
  lines.push(`  - Resolved: ${snapshot.closedThreads}`);
  lines.push(`  - Abandoned: ${snapshot.abandonedThreads}`);
  lines.push(`- Attention (belief weight): **${snapshot.beliefCap.toFixed(1)}**`);
  lines.push(
    `- Average uncertainty: **${Math.round(snapshot.averageEntropy * 100)}%** (entropy across open markets)`,
  );
  if (snapshot.averageResolutionQuality !== null) {
    const b = snapshot.resolutionQualityBands;
    lines.push(
      `- Average resolution quality: **${Math.round(snapshot.averageResolutionQuality * 100)}%**` +
        ` (earned ${b.earned} · adequate ${b.adequate} · thin ${b.thin})`,
    );
  }
  lines.push("");

  // ── Category mix ────────────────────────────────────────────────────────
  const counts: Record<ThreadCategory, number> = {
    saturating: 0,
    volatile: 0,
    contested: 0,
    committed: 0,
    developing: 0,
    dormant: 0,
    resolved: 0,
    abandoned: 0,
  };
  for (const r of rows) counts[r.category]++;
  lines.push("## Category mix");
  const catOrder: ThreadCategory[] = [
    "saturating",
    "volatile",
    "contested",
    "committed",
    "developing",
    "dormant",
    "resolved",
    "abandoned",
  ];
  const total = rows.length || 1;
  for (const cat of catOrder) {
    if (counts[cat] === 0) continue;
    const pct = Math.round((counts[cat] / total) * 100);
    lines.push(`- ${THREAD_CATEGORY_LABEL[cat]}: ${counts[cat]} (${pct}%)`);
  }
  lines.push("");

  // ── Recent movers ───────────────────────────────────────────────────────
  const movements = computeRecentMovements(
    narrative,
    resolvedKeys,
    currentSceneIndex,
    lookback,
  );
  const significant = movements.filter((m) => Math.abs(m.deltaProb) >= 0.05).slice(0, 8);
  if (significant.length > 0) {
    lines.push(`## Recent movers (last ${lookback} scenes)`);
    for (const m of significant) {
      const t = narrative.threads[m.threadId];
      if (!t) continue;
      const desc = t.description || m.threadId;
      const sign = m.deltaProb >= 0 ? "+" : "−";
      const prior = Math.round(m.priorProb * 100);
      const now = Math.round(m.nowProb * 100);
      const delta = Math.round(Math.abs(m.deltaProb) * 100);
      lines.push(
        `- **${desc}** → "${m.topOutcome}" ${prior}% → ${now}% (${sign}${delta}pp)`,
      );
    }
    lines.push("");
  }

  // ── Volatility leaders ──────────────────────────────────────────────────
  const liveRows = rows.filter(
    (r) => r.category !== "resolved" && r.category !== "abandoned",
  );
  const volLeaders = [...liveRows]
    .sort((a, b) => b.volatility - a.volatility)
    .filter((r) => r.volatility > 0)
    .slice(0, 5);
  if (volLeaders.length > 0) {
    lines.push("## Volatility leaders");
    volLeaders.forEach((r, i) => {
      lines.push(
        `${i + 1}. **${r.thread.description}** — σ ${r.volatility.toFixed(2)} · ${THREAD_CATEGORY_LABEL[r.category]}`,
      );
    });
    lines.push("");
  }

  // ── Per-market detail ───────────────────────────────────────────────────
  // Partition live markets by category; focus markets float to the top of
  // their bucket so the most load-bearing threads are scanned first.
  const liveByCat = new Map<ThreadCategory, PortfolioRow[]>();
  for (const r of rows) {
    if (r.category === "resolved" || r.category === "abandoned") continue;
    const bucket = liveByCat.get(r.category) ?? [];
    bucket.push(r);
    liveByCat.set(r.category, bucket);
  }
  const liveOrder: ThreadCategory[] = [
    "saturating",
    "volatile",
    "contested",
    "committed",
    "developing",
    "dormant",
  ];
  const hasLive = liveOrder.some((cat) => (liveByCat.get(cat)?.length ?? 0) > 0);
  if (hasLive) {
    lines.push("## Markets");
    for (const cat of liveOrder) {
      const bucket = liveByCat.get(cat);
      if (!bucket || bucket.length === 0) continue;
      bucket.sort((a, b) => {
        const af = focusIds.has(a.thread.id) ? 0 : 1;
        const bf = focusIds.has(b.thread.id) ? 0 : 1;
        if (af !== bf) return af - bf;
        return b.volume - a.volume;
      });
      lines.push("");
      lines.push(`### ${THREAD_CATEGORY_LABEL[cat]} (${bucket.length})`);
      for (const row of bucket) {
        lines.push("");
        lines.push(...renderMarket(row, focusIds.has(row.thread.id)));
      }
    }
    lines.push("");
  }

  // ── Resolved + abandoned tail ───────────────────────────────────────────
  const resolvedRows = rows.filter((r) => r.category === "resolved");
  const abandonedRows = rows.filter((r) => r.category === "abandoned");
  if (resolvedRows.length > 0) {
    lines.push(`## Resolved (${resolvedRows.length})`);
    for (const r of resolvedRows) {
      const t = r.thread;
      const winner = t.outcomes[t.closeOutcome ?? 0] ?? "?";
      const q =
        typeof t.resolutionQuality === "number"
          ? ` · quality ${Math.round(t.resolutionQuality * 100)}%`
          : "";
      const closedAt = t.closedAt ? ` at \`${t.closedAt}\`` : "";
      lines.push(`- **${t.description}** → "${winner}"${closedAt}${q}`);
    }
    lines.push("");
  }
  if (abandonedRows.length > 0) {
    lines.push(`## Abandoned (${abandonedRows.length})`);
    for (const r of abandonedRows) {
      lines.push(`- ${r.thread.description} · volume ${r.volume.toFixed(1)}`);
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ── Per-market renderer ────────────────────────────────────────────────────

function renderMarket(row: PortfolioRow, inFocus: boolean): string[] {
  const { thread, probs, topIdx, margin, volume, volatility, entropy, gap } = row;
  const lines: string[] = [];
  const focusTag = inFocus ? " · **in focus**" : "";
  lines.push(`#### ${thread.description}  \`${thread.id}\`${focusTag}`);

  const gapStr = Number.isFinite(gap)
    ? gap === 0
      ? "this scene"
      : `${gap} scene${gap === 1 ? "" : "s"} ago`
    : "never touched";
  lines.push(
    `- Lean: **${thread.outcomes[topIdx] ?? "?"} ${Math.round((probs[topIdx] ?? 0) * 100)}%** · ` +
      `margin Δ${margin.toFixed(2)} · volume ${volume.toFixed(1)} · ` +
      `σ ${volatility.toFixed(2)} · entropy ${Math.round(entropy * 100)}% · ` +
      `touched ${gapStr}`,
  );

  // Full outcome distribution — sorted by current probability so the ranking
  // is unambiguous and analysts can spot runner-ups at a glance.
  const ranked = thread.outcomes
    .map((o, i) => ({ outcome: o, prob: probs[i] ?? 0 }))
    .sort((a, b) => b.prob - a.prob);
  lines.push("  Outcomes:");
  for (const r of ranked) {
    lines.push(`  - ${r.outcome}: ${Math.round(r.prob * 100)}%`);
  }
  return lines;
}

