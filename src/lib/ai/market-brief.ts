/**
 * Market briefing — generates a tactical situation report on the prediction-
 * market portfolio with two slates the operator can act on:
 *
 *   - moves: market manipulations the operator selects (one or many) and
 *            composes into the next storyDirection commit
 *   - expansions: world-expansion suggestions that open the GeneratePanel in
 *                 world mode pre-populated with the directive
 *
 * Single LLM call, structured JSON output (see MarketBriefing). Compact
 * snapshot derived from the same point-in-time replay the dashboard uses, so
 * the briefing always reflects what the operator is currently looking at.
 *
 * Outline + phase context is included so suggestions respect the structural
 * backbone — arcs the operator has built and where in the story phase
 * progression we are.
 *
 * Optimises for narrative quality (speculative density, generative tension),
 * not market resolution. See prompts/briefing/index.ts for the editorial
 * stance and the full move / expansion vocabularies.
 */

import type { NarrativeState } from '@/types/narrative';
import { isScene } from '@/types/narrative';
import { MAX_TOKENS_DEFAULT } from '@/lib/constants';
import {
  buildPortfolioRows,
  computePortfolioSnapshot,
  computeRecentMovements,
  replayThreadsAtIndex,
  type PortfolioRow,
} from '@/lib/portfolio-analytics';
import { getMarketMargin } from '@/lib/narrative-utils';
import { THREAD_CATEGORY_LABEL } from '@/lib/thread-category';
import { getStoryPhase } from '@/lib/auto-engine';
import { getActiveMode } from '@/lib/mode-graph';
import { callGenerate, callGenerateStream, resolveReasoningBudget, resolveWebsearch } from './api';
import { parseJson } from './json';
import { MARKET_BRIEFING_SYSTEM, buildMarketBriefingPrompt } from '@/lib/prompts/briefing';
import {
  MOVE_PRIORITIES,
  MOVE_TYPES,
  EXPANSION_KINDS,
  type MovePriority,
  type MoveType,
  type ExpansionKind,
  type MarketBriefing,
  type SuggestedMove,
  type WorldExpansion,
  type WatchItem,
} from '@/types/briefing';

// Re-exported so existing UI imports from this module keep working.
export type { MarketBriefing, SuggestedMove, WorldExpansion, WatchItem };

export type GenerateMarketBriefingOptions = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentSceneIndex: number;
  /** Streaming callback for the model's reasoning channel — fired as
   *  reasoning tokens arrive. When provided, the call switches from a
   *  one-shot JSON request to the streaming endpoint so the UI can show
   *  thinking live, matching the plan/prose generation UX. */
  onReasoning?: (token: string) => void;
};

const RECENT_MOVERS_LOOKBACK = 5;
const RECENT_SCENES_LIMIT = 8;
const ACTIVE_MARKETS_LIMIT = 16;
const CAST_LIMIT = 12;
const OUTLINE_ARC_LIMIT = 10;

export async function generateMarketBriefing(
  opts: GenerateMarketBriefingOptions,
): Promise<MarketBriefing> {
  const { narrative, resolvedKeys, currentSceneIndex, onReasoning } = opts;

  // Replay threads to point-in-time so the briefing matches what the operator
  // sees in the dashboard, not the live end-of-narrative state.
  const threadsAtIndex = replayThreadsAtIndex(narrative, resolvedKeys, currentSceneIndex);
  const scrubbed: NarrativeState = { ...narrative, threads: threadsAtIndex };
  const rows = buildPortfolioRows(scrubbed, resolvedKeys, currentSceneIndex);
  const snapshot = computePortfolioSnapshot(scrubbed);
  const movements = computeRecentMovements(narrative, resolvedKeys, currentSceneIndex, RECENT_MOVERS_LOOKBACK);

  const activeMarkets = formatActiveMarkets(rows);
  const recentMovers = formatRecentMovers(movements, scrubbed, RECENT_MOVERS_LOOKBACK);
  const cast = formatCast(narrative);
  const recentScenes = collectRecentScenes(narrative, resolvedKeys, currentSceneIndex, RECENT_SCENES_LIMIT);
  const portfolioSummary = formatPortfolioSummary(snapshot, rows);
  const flags = detectFlags(rows);
  const outline = formatOutline(narrative);
  const phaseSummary = formatPhase(resolvedKeys, currentSceneIndex);
  const modeSummary = formatMode(narrative);

  const prompt = buildMarketBriefingPrompt({
    title: narrative.title,
    currentDirection: narrative.storySettings?.storyDirection?.trim() ?? '',
    activeMarkets,
    recentMovers,
    cast,
    recentScenes,
    portfolioSummary,
    flags,
    outline,
    phaseSummary,
    modeSummary,
  });

  const reasoningBudget = resolveReasoningBudget(narrative);
  const websearch = resolveWebsearch(narrative);
  const raw = onReasoning
    ? await callGenerateStream(
        prompt,
        MARKET_BRIEFING_SYSTEM,
        () => {},
        MAX_TOKENS_DEFAULT,
        'generateMarketBriefing',
        undefined,
        reasoningBudget,
        onReasoning,
        undefined,
        websearch,
      )
    : await callGenerate(
        prompt,
        MARKET_BRIEFING_SYSTEM,
        MAX_TOKENS_DEFAULT,
        'generateMarketBriefing',
        undefined,
        reasoningBudget,
        true,
        undefined,
        websearch,
      );

  const parsed = parseJson(raw, 'generateMarketBriefing') as Partial<MarketBriefing>;
  return normaliseBriefing(parsed);
}

// ── Context builders ───────────────────────────────────────────────────────

function formatActiveMarkets(rows: PortfolioRow[]): string {
  const active = rows
    .filter((r) => r.category !== 'resolved' && r.category !== 'abandoned')
    .slice(0, ACTIVE_MARKETS_LIMIT);
  if (active.length === 0) return '';
  return active
    .map((r) => {
      const t = r.thread;
      const margin = (r.margin * 100).toFixed(0);
      const leader = t.outcomes[r.topIdx] ?? '?';
      const cat = THREAD_CATEGORY_LABEL[r.category];
      return `- [${t.id}] ${t.description} — ${cat}, leader "${leader}" @ ${margin}% margin, vol ${r.volume.toFixed(1)}`;
    })
    .join('\n');
}

function formatRecentMovers(
  movements: ReturnType<typeof computeRecentMovements>,
  narrative: NarrativeState,
  lookback: number,
): string {
  const sorted = [...movements]
    .filter((m) => Math.abs(m.deltaProb) >= 0.05)
    .sort((a, b) => Math.abs(b.deltaProb) - Math.abs(a.deltaProb))
    .slice(0, 6);
  if (sorted.length === 0) return `(no notable movers in last ${lookback} scenes)`;
  return sorted
    .map((m) => {
      const desc = narrative.threads[m.threadId]?.description ?? m.threadId;
      const sign = m.deltaProb >= 0 ? '+' : '';
      const pct = (m.deltaProb * 100).toFixed(0);
      return `- "${m.topOutcome}" in ${desc.slice(0, 60)}: ${sign}${pct}pp (${(m.priorProb * 100).toFixed(0)}% → ${(m.nowProb * 100).toFixed(0)}%)`;
    })
    .join('\n');
}

function formatCast(narrative: NarrativeState): string {
  return Object.values(narrative.characters)
    .filter((c) => c.role === 'anchor' || c.role === 'recurring')
    .slice(0, CAST_LIMIT)
    .map((c) => `- ${c.name} (${c.role})`)
    .join('\n');
}

function collectRecentScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  limit: number,
): { index: number; summary: string }[] {
  const out: { index: number; summary: string }[] = [];
  const end = Math.min(currentIndex, resolvedKeys.length - 1);
  for (let i = end; i >= 0 && out.length < limit; i--) {
    const scene = narrative.scenes[resolvedKeys[i]];
    if (!scene || !isScene(scene)) continue;
    if (!scene.summary?.trim()) continue;
    out.push({ index: i, summary: scene.summary.trim() });
  }
  return out;
}

function formatPortfolioSummary(
  snapshot: ReturnType<typeof computePortfolioSnapshot>,
  rows: PortfolioRow[],
): string {
  const catCounts: Record<string, number> = {};
  for (const r of rows) catCounts[r.category] = (catCounts[r.category] ?? 0) + 1;
  const catBlock = Object.entries(catCounts)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${n} ${c}`)
    .join(', ');
  const uncertainty = Math.round(snapshot.averageEntropy * 100);
  const resolutionQuality =
    snapshot.averageResolutionQuality !== null
      ? `, avg resolution-quality ${snapshot.averageResolutionQuality.toFixed(2)}`
      : '';
  return `${snapshot.activeThreads} open / ${snapshot.closedThreads} closed; mix: ${catBlock || 'empty'}; avg uncertainty ${uncertainty}%; market cap ${snapshot.marketCap.toFixed(0)}${resolutionQuality}.`;
}

function detectFlags(rows: PortfolioRow[]): string[] {
  const flags: string[] = [];
  const open = rows.filter((r) => r.category !== 'resolved' && r.category !== 'abandoned');
  if (open.length < 2) flags.push('starved (fewer than 2 active markets)');
  if (open.length > 12) flags.push('bloated (over 12 active markets — attention diluted)');

  const saturating = rows.filter((r) => r.category === 'saturating').length;
  const contested = rows.filter((r) => r.category === 'contested').length;
  const dormant = rows.filter((r) => r.category === 'dormant').length;
  const volatile = rows.filter((r) => r.category === 'volatile').length;

  if (saturating > 0 && saturating === open.length) flags.push('all markets saturating (no contested attention left)');
  if (contested === 0 && open.length > 2) flags.push('no contested markets (low generative tension)');
  if (dormant > open.length / 2) flags.push('majority dormant (stale portfolio)');
  if (volatile > open.length / 2) flags.push('majority volatile (potential noise, not story)');

  // Concentration check — top market holds dominant share of attention.
  const totalVol = open.reduce((s, r) => s + r.volume, 0);
  if (totalVol > 0 && open.length > 1) {
    const topShare = Math.max(...open.map((r) => r.volume)) / totalVol;
    if (topShare > 0.6) flags.push(`attention concentrated (${Math.round(topShare * 100)}% on single market)`);
  }

  // Easy-convergence detector — saturating markets without high-magnitude
  // recent evidence. Linear accumulation = no contest, dead weight on closure.
  for (const r of rows.filter((r) => r.category === 'saturating')) {
    const m = getMarketMargin(r.thread);
    if (m.margin > 0.85 && (r.thread.beliefs?.NARRATOR?.volatility ?? 0) < 0.2) {
      flags.push(`easy-convergence risk in [${r.thread.id}]`);
      break;
    }
  }

  return flags;
}

function formatOutline(narrative: NarrativeState): string {
  const arcs = Object.values(narrative.arcs ?? {})
    .filter((a) => a.sceneIds && a.sceneIds.length > 0)
    .slice(-OUTLINE_ARC_LIMIT);
  if (arcs.length === 0) return '';
  return arcs
    .map((a, i) => {
      const sceneCount = a.sceneIds.length;
      const dir = a.directionVector?.trim();
      const dirBlock = dir ? ` — ${dir.slice(0, 200)}` : '';
      return `- arc ${i + 1}: "${a.name}" (${sceneCount} scenes)${dirBlock}`;
    })
    .join('\n');
}

function formatPhase(
  resolvedKeys: string[],
  currentIndex: number,
): string {
  // Without an explicit AutoConfig in scope here, derive a rough progress
  // signal from where the operator is in the timeline. This is a heuristic —
  // good enough for orienting the briefing's tone without coupling to the
  // auto-engine's state.
  const total = resolvedKeys.length;
  if (total === 0) return 'no scenes yet — pre-narrative';
  const progress = Math.max(0, Math.min(1, (currentIndex + 1) / total));
  const phase = getStoryPhase(progress);
  const pct = Math.round(progress * 100);
  return `phase: ${phase} (timeline ${pct}% — scene ${currentIndex + 1} of ${total})`;
}

function formatMode(narrative: NarrativeState): string {
  const prg = getActiveMode(narrative);
  if (!prg) return '';
  const summary = prg.summary?.trim() ?? '';
  const nodeBlock = (prg.nodes ?? [])
    .slice(0, 12)
    .map((n) => `  - [${n.type}] ${n.label}`)
    .join('\n');
  return `Active PRG: ${summary || '(no summary)'}\nKey nodes:\n${nodeBlock}`;
}

// ── Output normalisation ───────────────────────────────────────────────────

const PRIORITY_SET = new Set<string>(MOVE_PRIORITIES);
const MOVE_TYPE_SET = new Set<string>(MOVE_TYPES);
const EXPANSION_KIND_SET = new Set<string>(EXPANSION_KINDS);

function normaliseBriefing(parsed: Partial<MarketBriefing>): MarketBriefing {
  return {
    headline: typeof parsed.headline === 'string' ? parsed.headline.trim() : '',
    situation: typeof parsed.situation === 'string' ? parsed.situation.trim() : '',
    watch: normaliseWatch(parsed.watch),
    moves: normaliseMoves(parsed.moves),
    expansions: normaliseExpansions(parsed.expansions),
    outlook: {
      nearTerm: typeof parsed.outlook?.nearTerm === 'string' ? parsed.outlook.nearTerm.trim() : '',
      phaseEnd: typeof parsed.outlook?.phaseEnd === 'string' ? parsed.outlook.phaseEnd.trim() : '',
    },
  };
}

function normaliseWatch(items: unknown): WatchItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      if (!it || typeof it !== 'object') return null;
      const o = it as Record<string, unknown>;
      return {
        title: typeof o.title === 'string' ? o.title.trim() : '',
        analysis: typeof o.analysis === 'string' ? o.analysis.trim() : '',
      };
    })
    .filter((it): it is WatchItem => it !== null && it.title !== '');
}

function normaliseMoves(items: unknown): SuggestedMove[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it): SuggestedMove | null => {
      if (!it || typeof it !== 'object') return null;
      const o = it as Record<string, unknown>;
      const label = typeof o.label === 'string' ? o.label.trim() : '';
      const direction = typeof o.direction === 'string' ? o.direction.trim() : '';
      if (!label || !direction) return null;
      const rawPriority = typeof o.priority === 'string' ? o.priority.trim().toLowerCase() : '';
      const priority: MovePriority = (PRIORITY_SET.has(rawPriority)
        ? rawPriority
        : 'medium') as MovePriority;
      const rawType = typeof o.moveType === 'string' ? o.moveType.trim().toLowerCase() : '';
      const moveType: MoveType = (MOVE_TYPE_SET.has(rawType)
        ? rawType
        : 'sustain') as MoveType;
      return {
        label,
        priority,
        moveType,
        target: typeof o.target === 'string' ? o.target.trim() : '',
        rationale: typeof o.rationale === 'string' ? o.rationale.trim() : '',
        direction,
      };
    })
    .filter((it): it is SuggestedMove => it !== null);
}

function normaliseExpansions(items: unknown): WorldExpansion[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it): WorldExpansion | null => {
      if (!it || typeof it !== 'object') return null;
      const o = it as Record<string, unknown>;
      const label = typeof o.label === 'string' ? o.label.trim() : '';
      const direction = typeof o.direction === 'string' ? o.direction.trim() : '';
      if (!label || !direction) return null;
      const rawKind = typeof o.kind === 'string' ? o.kind.trim().toLowerCase() : '';
      const kind: ExpansionKind = (EXPANSION_KIND_SET.has(rawKind)
        ? rawKind
        : 'thread') as ExpansionKind;
      return {
        label,
        kind,
        rationale: typeof o.rationale === 'string' ? o.rationale.trim() : '',
        direction,
      };
    })
    .filter((it): it is WorldExpansion => it !== null);
}
