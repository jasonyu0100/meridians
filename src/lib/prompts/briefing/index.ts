/**
 * Market briefing prompt — generates a tactical read of the prediction-market
 * portfolio plus a slate of suggested MOVES the operator can select (one or
 * many) and compose into the next storyDirection, alongside WORLD-EXPANSION
 * suggestions that open the GeneratePanel pre-filled when clicked.
 *
 * Editorial stance: optimise for narrative quality (speculative density,
 * generative tension), NOT market resolution. A market that closes cleanly in
 * four scenes is dead weight. Surface anti-patterns aggressively. Each move is
 * an *intent* to influence the market in a specific direction (open, escalate,
 * subvert, redirect, etc.), not a resolution shortcut.
 *
 * Output is structured JSON consumed by MarketBriefingView. The operator
 * selects moves; the UI composes their `direction` payloads into a single
 * direction string and Apply commits to storySettings.storyDirection.
 * Expansions open the GeneratePanel in world-expansion mode pre-populated.
 */

import { PROMPT_PORTFOLIO_PRINCIPLES } from '../core/market-calibration';

// Briefing data taxonomy lives in `@/types/briefing` to break the cycle
// between the prompt builder and `NarrativeState.lastBriefing`. Re-exported
// here so existing callers (UI, AI module) don't need to chase the move.
export {
  MOVE_PRIORITIES,
  MOVE_TYPES,
  EXPANSION_KINDS,
  type MovePriority,
  type MoveType,
  type ExpansionKind,
} from '@/types/briefing';

export type MarketBriefingPromptArgs = {
  title: string;
  /** Current value of storySettings.storyDirection — what the operator is currently steering toward. */
  currentDirection: string;
  /** Active threads compact rendering — id + description + category + leading-outcome margin. */
  activeMarkets: string;
  /** Top movers in last N scenes — threadId + delta. */
  recentMovers: string;
  /** Anchor + recurring cast names with role tags. */
  cast: string;
  /** Most-recent-first scene summaries (≤ 8). */
  recentScenes: { index: number; summary: string }[];
  /** Compact portfolio rollup string (category mix, KPIs). */
  portfolioSummary: string;
  /** Detected anti-pattern flags from the deterministic baseline. */
  flags: string[];
  /** Outline of arcs to date — name + directionVector + scene span. */
  outline: string;
  /** Active phase + per-phase guidance from the auto engine. */
  phaseSummary: string;
  /** Active phase reasoning graph (PRG) summary, if one is set. */
  modeSummary: string;
};

export function buildMarketBriefingPrompt(args: MarketBriefingPromptArgs): string {
  const {
    title,
    currentDirection,
    activeMarkets,
    recentMovers,
    cast,
    recentScenes,
    portfolioSummary,
    flags,
    outline,
    phaseSummary,
    modeSummary,
  } = args;

  return `<inputs>
  <narrative title="${title}" />
${currentDirection ? `  <current-direction hint="What the operator is currently steering toward. Honour as baseline — propose adjustments, not wholesale pivots, unless the portfolio demands it.">\n${currentDirection}\n  </current-direction>` : '  <current-direction>(none — operator has no active north-star)</current-direction>'}
  <outline label="Arcs the operator has built — the structural backbone the moves must reckon with.">
${outline || '(no arcs yet)'}
  </outline>
  <phase>${phaseSummary}</phase>
${modeSummary ? `  <phase-reasoning-graph hint="The working model of how the world operates. Moves should respect or deliberately defy these structural assumptions.">\n${modeSummary}\n  </phase-reasoning-graph>` : ''}
  <active-markets label="market portfolio with category + leader margin">
${activeMarkets || '(none)'}
  </active-markets>
  <recent-movers label="probability shifts over the last ~5 scenes">
${recentMovers || '(none)'}
  </recent-movers>
  <cast label="anchor + recurring">
${cast || '(none)'}
  </cast>
  <recent-scenes hint="Most recent first — the texture the portfolio is reacting to.">
${recentScenes
    .slice(0, 8)
    .map((s) => `    <scene index="${s.index + 1}">${s.summary}</scene>`)
    .join('\n') || '    (none)'}
  </recent-scenes>
  <portfolio-diagnostic>
    <summary>${portfolioSummary}</summary>
    <flags>${flags.length > 0 ? flags.join(', ') : 'none'}</flags>
  </portfolio-diagnostic>
  <portfolio-principles hint="Apply when proposing moves and expansions.">
${PROMPT_PORTFOLIO_PRINCIPLES}
  </portfolio-principles>
  <move-vocabulary>
    Every suggested move declares a moveType from this list:
    - open: open a new market — name a question and 2-3 outcomes
    - escalate: raise stakes / volume on an existing market without resolving it
    - subvert: introduce evidence that inverts the leading outcome of a saturating market
    - foreshadow: plant a low-evidence seed for a future payoff (≥ 3 scenes out)
    - redirect: shift focus to a neglected anchor or dormant market
    - consolidate: surface a hidden link between two markets, building compound stakes
    - release: discharge accumulated pressure — earned closure on a long-running thread
    - destabilise: break a saturated market open by introducing a third outcome or undermining the rules
    - sustain: keep an active market in productive uncertainty without resolving
    Each move declares a priority: high (act this arc), medium (act soon), low (opportunistic).
  </move-vocabulary>
  <expansion-vocabulary>
    Every suggested expansion declares a kind from this list:
    - character: a new character (or major deepening of an under-developed one)
    - location: a new location or sub-location the world needs
    - artifact: a new artifact whose existence reshapes possibility
    - thread: a new market the operator should open via expansion (not via scene generation)
    - system: a new rule, faction, or institution the world is missing
  </expansion-vocabulary>
</inputs>

<instructions>
  <step name="situation">Read the board. Headline (one sentence). Then 1-2 paragraphs of situation prose: category mix, force balance, phase fit, what the recent movers say.</step>
  <step name="watch">Surface 2-3 anti-patterns to watch. Easy convergence. Stuck saturation. Loose ends. Foreshadow famine. Concrete entities and named markets.</step>
  <step name="moves">Propose 5-8 suggested moves. Cover a mix of moveTypes — don't issue 6 "open" moves or 6 "subvert" moves. Each move targets a SPECIFIC market (by id) or entity (by name) wherever applicable. Each move's direction is a self-contained sentence (≤ 35 words, second person) that reads naturally on its own AND when concatenated with other selected moves' directions. Spread across priorities: usually 2-3 high, 2-3 medium, 1-2 low.</step>
  <step name="expansions">Propose 2-4 world-expansion suggestions — creative needs the world has that the operator should address by hand. Examples: "an unnamed faction the anchor entity's threads keep gesturing toward needs to be made real", "a missing institutional rule that would unlock a stuck market", "a location the cast keeps avoiding that should be built out so it can be entered", "a missing source or counter-claim the argument keeps assuming exists". Each carries a direction the operator pastes into the world-expansion panel (1-3 sentences, second person, names the entities/threads to integrate with).</step>
  <step name="codenames">Each move and expansion gets a short label — 1-3 words, evocative but plain (NOT military / wartime). Examples: "Quiet Rival", "Forked Promise", "Empty Faction", "Hidden Cost", "Unseen Witness".</step>
</instructions>

<output-format hint="Return a single JSON object — no preamble, no markdown wrapping. Strings are prose; do not use markdown headers inside string values.">
{
  "headline": "One sentence — the most important thing about the board right now.",
  "situation": "1-2 short paragraphs of prose. Read the category mix, the force balance, the phase fit. Name the dominant tendency.",
  "watch": [
    {
      "title": "Short label (3-6 words).",
      "analysis": "1 short paragraph. What anti-pattern is forming? What does it cost the narrative? Name entities and markets."
    }
  ],
  "moves": [
    {
      "label": "Short evocative label (1-3 words, plain English — no military terms).",
      "priority": "high | medium | low",
      "moveType": "open | escalate | subvert | foreshadow | redirect | consolidate | release | destabilise | sustain",
      "target": "Thread id, character name, or location name the move acts on. Empty if portfolio-wide.",
      "rationale": "1-2 sentences — why this move, why now, how it serves speculative density.",
      "direction": "Self-contained second-person direction (≤ 35 words). Reads naturally alone AND when concatenated with other selected directions — start with an imperative verb."
    }
  ],
  "expansions": [
    {
      "label": "Short evocative label (1-3 words).",
      "kind": "character | location | artifact | thread | system",
      "rationale": "1-2 sentences — what creative need this addresses, which existing entities or markets it integrates with.",
      "direction": "1-3 sentences, second person — the direction the operator pastes into the world-expansion panel. Name the existing entities/threads to integrate with."
    }
  ],
  "outlook": {
    "nearTerm": "1 short paragraph — what the next ~3 scenes are likely to produce if no move is issued.",
    "phaseEnd": "1 short paragraph — projected state at end of current phase, with named markets."
  }
}
</output-format>`;
}
