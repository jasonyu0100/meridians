/**
 * Chat context-mode prompts — the system prompts for the six contextModes
 * (scene / outline / narrative / compass / investigation / mode).
 *
 * Each prompt is wrapped in a `<chat-system mode="...">` root with
 * structured `<role>`, optional `<focus-rules>`, `<scene-anchor>`,
 * `<output-discipline>`, and a `<context>` block that holds the data
 * XML blocks `context.ts` builds. The `<context>` block is the model's
 * primary data; the prose-discipline rule lives in `<output-discipline>`.
 */

import type { NarrativeState } from '@/types/narrative';
import { resolveEntry, isScene } from '@/types/narrative';
import { CHAT_OUTPUT_DISCIPLINE } from './discipline';
import {
  compassFramingFor,
  composeAnalystIdentity,
  type WorkIdentity,
} from '@/lib/prompts/paradigm';
import { workIdentityFor } from '@/lib/prompts/paradigm';

/** Render the work identity as a prelude sentence for the chat role. When
 *  paradigm is known, this carries paradigm + genre + subgenre + title into
 *  every chat mode. When unset, falls back to a generic prelude that names
 *  only the title — preserving paradigm-less narratives unchanged. */
function chatIdentityPrelude(work: WorkIdentity): string {
  if (work.paradigm) return `${composeAnalystIdentity(work)} The user is collaborating with you on this work.`;
  const title = work.title?.trim();
  return title
    ? `You are a helpful assistant. The user is working on the work titled "${title}".`
    : 'You are a helpful assistant. The user is working on a long-form work.';
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Cursor-position summary attached to every contextMode prompt. Tells the
 *  model what scene / world-commit the user is currently looking at so
 *  questions like "what's happening here?" anchor correctly. Returns an
 *  empty string when the cursor is on neither a scene nor a world-commit. */
export function buildSceneAnchor(
  narrative: NarrativeState,
  resolvedKeys: readonly string[],
  currentIndex: number,
): string {
  const currentKey = resolvedKeys[currentIndex];
  if (!currentKey) return '';
  const total = resolvedKeys.length;
  const indexAttr = `${currentIndex + 1} / ${total}`;
  const scene = narrative.scenes[currentKey];
  if (scene) {
    const povName = scene.povId
      ? (narrative.characters[scene.povId]?.name ?? scene.povId)
      : '—';
    const locName = narrative.locations[scene.locationId]?.name ?? scene.locationId;
    const arcName = scene.arcId ? (narrative.arcs[scene.arcId]?.name ?? '') : '';
    return `  <scene-anchor hint="what the user is looking at right now" index="${xmlEscape(indexAttr)}" arc="${xmlEscape(arcName)}" pov="${xmlEscape(povName)}" location="${xmlEscape(locName)}">
    <summary>${xmlEscape(scene.summary)}</summary>
  </scene-anchor>`;
  }
  const entry = resolveEntry(narrative, currentKey);
  if (entry && !isScene(entry)) {
    return `  <scene-anchor hint="world commit position" kind="world_build" index="${xmlEscape(indexAttr)}">
    <summary>${xmlEscape(entry.summary)}</summary>
  </scene-anchor>`;
  }
  return '';
}

/** Render a list of focus-rules — the per-mode guidance bullet lists that
 *  used to live as "When discussing X: • a • b • c" sections. */
function focusRulesBlock(rules: string[]): string {
  if (rules.length === 0) return '';
  return `  <focus-rules>\n${rules.map((r) => `    <rule>${xmlEscape(r)}</rule>`).join('\n')}\n  </focus-rules>`;
}

type CommonArgs = {
  narrative: NarrativeState;
  sceneAnchor: string;
  /** Pre-built data context block (from context.ts) injected as <context> child. */
  contextBlocks: { tag: string; body: string }[];
  /** Extra mode-specific text appended after the universal discipline. */
  extraDiscipline?: string;
};

/** Wrap a list of pre-built data context blocks under a single `<context>`
 *  parent. Each block carries its own root tag (`<outline>`, `<compass>`,
 *  etc.) — those tags are emitted as-is. */
function contextWrapper(blocks: { tag: string; body: string }[]): string {
  if (blocks.length === 0) return '  <context empty="true" />';
  return `  <context>\n${blocks.map((b) => indent(b.body, 4)).join('\n\n')}\n  </context>`;
}

function indent(s: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return s.split('\n').map((line) => (line.length ? pad + line : line)).join('\n');
}

/** Compose a contextMode prompt from its parts. Common envelope so every
 *  mode prompt has the same `<role>` / `<focus-rules>` / `<scene-anchor>`
 *  / `<output-discipline>` / `<context>` shape. */
function composeChatSystem(
  mode: string,
  narrativeTitle: string,
  role: string,
  focusRules: string[],
  args: CommonArgs,
): string {
  const focus = focusRulesBlock(focusRules);
  const anchor = args.sceneAnchor ? args.sceneAnchor : '';
  const discipline = args.extraDiscipline
    ? `${CHAT_OUTPUT_DISCIPLINE} ${args.extraDiscipline}`
    : CHAT_OUTPUT_DISCIPLINE;
  const ctx = contextWrapper(args.contextBlocks);
  return `<chat-system mode="${mode}" narrative-title="${xmlEscape(narrativeTitle)}">
  <role>${xmlEscape(role)}</role>
${focus ? focus + '\n' : ''}${anchor ? anchor + '\n' : ''}  <output-discipline>${xmlEscape(discipline)}</output-discipline>
${ctx}
</chat-system>`;
}

// ── Scene ────────────────────────────────────────────────────────────────

export function buildSceneChatPrompt(
  narrative: NarrativeState,
  sceneAnchor: string,
  sceneContextBlock: string,
): string {
  const work = workIdentityFor(narrative);
  return composeChatSystem(
    'scene',
    narrative.title,
    `${chatIdentityPrelude(work)} Scene-level context is attached below; you are free to answer any question the user asks — creative, technical, personal, or anything else. Use the attached context when the question is about this work; otherwise respond normally without forcing the conversation back to it. Be concise and specific.`,
    [],
    {
      narrative,
      sceneAnchor,
      contextBlocks: [{ tag: 'scene-context', body: sceneContextBlock }],
    },
  );
}

// ── Outline ──────────────────────────────────────────────────────────────

export function buildOutlineChatPrompt(
  narrative: NarrativeState,
  sceneAnchor: string,
  outlineBlock: string,
): string {
  const work = workIdentityFor(narrative);
  return composeChatSystem(
    'outline',
    narrative.title,
    `${chatIdentityPrelude(work)} A condensed outline is attached below; you are free to answer any question the user asks — creative, technical, personal, or anything else. Use the attached context when the question is about this work; otherwise respond normally without forcing the conversation back to it. Be concise and specific.`,
    [],
    {
      narrative,
      sceneAnchor,
      contextBlocks: [{ tag: 'outline', body: outlineBlock }],
    },
  );
}

// ── Narrative (default) ──────────────────────────────────────────────────

export function buildNarrativeChatPrompt(
  narrative: NarrativeState,
  sceneAnchor: string,
  narrativeBlock: string,
): string {
  const work = workIdentityFor(narrative);
  return composeChatSystem(
    'narrative',
    narrative.title,
    `${chatIdentityPrelude(work)} Deep work context is attached below (entities, threads, scene/entry history up to the current point); you are free to answer any question the user asks — creative, technical, personal, or anything else. Use the attached context when the question is about this work; otherwise respond normally without forcing the conversation back to it. When discussing the work, be concise and specific. When suggesting directions, consider the existing threads and their maturity through this paradigm's own logic.`,
    [],
    {
      narrative,
      sceneAnchor,
      contextBlocks: [{ tag: 'narrative-context', body: narrativeBlock }],
    },
  );
}

// ── Compass ──────────────────────────────────────────────────────────────

export function buildCompassChatPrompt(
  narrative: NarrativeState,
  sceneAnchor: string,
  outlineBlock: string,
  compassBlock: string,
): string {
  const work = workIdentityFor(narrative);
  const framing = compassFramingFor(work.paradigm);
  return composeChatSystem(
    'compass',
    narrative.title,
    `${chatIdentityPrelude(work)} ${framing} The user wants to discuss this work's COMPASS — the engine's forward-looking surface for the currently-viewed arc. The Compass is an AI direction-finder that surfaces a probability distribution over feasible next moves grounded in a factor model (variables) of the work's reality. Each scenario carries a logit-based score, a softmax probability over the cohort, and a coordination of named variables firing at different intensities. Two context blocks are attached: a WORLD-VIEW OUTLINE (historical recap so you understand how the work got here) and the COMPASS cohort (the scenarios + the arc's Present coordination for contrast). Be ready to reason about which scenarios are favoured and why, which variables would have to fire for a tail-event scenario to land, and how the cohort coordinates against the Present.`,
    [
      'priorLogits read as PREDICTION when the work is a simulation (rule-driven probability of the modelled outcome) and as RECOMMENDATION otherwise (how strongly the paradigm\'s compass pulls toward this direction)',
      'probabilities are softmax-relative within the cohort; logits are absolute on the [-4, +4] scale (sigmoid gives an absolute plausibility / pull strength)',
      'rarity / pull descriptors (expected / likely / even / rare / tail-event) map to logit bands and capture the qualitative read',
      'variable coordinations are the "shape" of each scenario — the same variable firing at different intensities is what differentiates the cohort',
      'the outline tells you what happened; the Compass tells you where the work could feasibly go next — anchor every claim in concrete events from the outline',
    ],
    {
      narrative,
      sceneAnchor,
      contextBlocks: [
        { tag: 'outline', body: outlineBlock },
        { tag: 'compass', body: compassBlock },
      ],
      extraDiscipline: 'Refer to scenarios by their human-readable names. Quote logits / probabilities inline only when they carry the argument, not as parentheticals after every noun.',
    },
  );
}

// ── Investigation ────────────────────────────────────────────────────────

export function buildMapChatPrompt(
  narrative: NarrativeState,
  sceneAnchor: string,
  outlineBlock: string,
  mapBlock: string,
): string {
  const work = workIdentityFor(narrative);
  return composeChatSystem(
    'investigation',
    narrative.title,
    `${chatIdentityPrelude(work)} The user wants to discuss this work's ACTIVE INVESTIGATION — the Causal Reasoning Graph (CRG) on the currently-viewed arc. Two context blocks are attached: a WORLD-VIEW OUTLINE (historical recap so you understand how the world got here) and the INVESTIGATION graph (the analyst's in-arc inference about what's happening and why). The investigation carries a direction (the brief that steered it), per-node inference-shape (detail, considered = rejected sibling hypotheses, breaks = falsifying conditions, opens = downstream cascades), and a sequential-path block that renders the graph's bidirectional edge structure. Be ready to walk the chain forward (priors → reasoning → terminal), re-evaluate at any step via the rejected-sibling reasoning, stress-test via failure conditions, and extend forward via second-order possibilities.`,
    [
      "node types span four tiers — substrate (entities, threads, system rules), inference steps, meta agents (patterns to introduce, anti-patterns to avoid), and outside-force injections; read the tier the node belongs to but don't surface the tag",
      "the analyst's work lives in four fields per inference node: the inference itself, the rival hypotheses rejected, the conditions that would invalidate it, and the second-order possibilities it grants — these are what distinguish reasoning from description",
      'the direction tells you what the user asked the investigation to think about — anchor answers to that frame',
      'the outline tells you what happened in the world; the investigation tells you what the analyst concluded ABOUT it — situational claims belong in the outline read, inference claims belong in the investigation read',
    ],
    {
      narrative,
      sceneAnchor,
      contextBlocks: [
        { tag: 'outline', body: outlineBlock },
        { tag: 'investigation', body: mapBlock },
      ],
      extraDiscipline: 'Paraphrase each node by its label and substance. When citing the analyst\'s rival readings, failure conditions, or downstream cascades, render them as prose ("the analyst considered routing this through X instead", "this would break if Y reverses", "this opens the path to Z") rather than naming the underlying field.',
    },
  );
}

// ── Mode ─────────────────────────────────────────────────────────────────

export function buildModeChatPrompt(
  narrative: NarrativeState,
  sceneAnchor: string,
  outlineBlock: string,
  modeBlock: string,
): string {
  const work = workIdentityFor(narrative);
  return composeChatSystem(
    'mode',
    narrative.title,
    `${chatIdentityPrelude(work)} The user wants to discuss this work's MODE — the Phase Reasoning Graph (PRG), i.e. the META MACHINERY of the world it runs on. Two context blocks are attached: a WORLD-VIEW OUTLINE (historical recap so you understand how the world got here) and the MODE graph (patterns, conventions, attractors, agents, rules, pressures, landmarks — each with a temporal stance and the universal inference-shape: detail, considered = rival readings, breaks = carve-outs, opens = downstream cascade). A sequential-path block at the end of the mode renders the same graph as bidirectional edge text. Be ready to reason about which machinery is firing, which carve-outs apply, where pressures discharge, and how downstream layers should inherit.`,
    [
      'node type encodes a temporal stance — a pattern is currently active, a convention is currently followed, an attractor is future-pointing, an agent is currently driving, a rule is currently binding, a pressure is accumulating toward discharge, a landmark is past-but-anchoring. Read the stance, but in your output use natural prose ("the world is being pulled toward…", "this convention shapes how…") — never the type tag itself',
      "each node's substance lives in four facets: what the machinery is, the rival readings the analyst rejected, the carve-outs / conditions where it doesn't bind, and the downstream cascade later layers inherit. These are what make it legible",
      'the Mode is the substrate downstream reasoning (per-arc graphs, coordination plans, scenes) operates on top of — anchor structural claims to specific pieces of machinery by their substance',
      "the outline tells you what happened; the Mode tells you what the world's machinery IS — situational events belong in the outline read, structural claims belong in the Mode read",
    ],
    {
      narrative,
      sceneAnchor,
      contextBlocks: [
        { tag: 'outline', body: outlineBlock },
        { tag: 'mode', body: modeBlock },
      ],
      extraDiscipline: 'Translate temporal stance into prose ("the world is being pulled toward…", "this convention shapes how…") rather than naming type tags ("attractor", "pattern", "pressure"). When citing rival readings, carve-outs, or downstream cascades, write them as prose ("the analyst considered reading this as X instead", "this doesn\'t bind in cases of Y", "this produces Z downstream").',
    },
  );
}

// ── Game theory ──────────────────────────────────────────────────────────

export function buildGameTheoryChatPrompt(
  narrative: NarrativeState,
  sceneAnchor: string,
  gameTheoryBlock: string,
): string {
  const work = workIdentityFor(narrative);
  return composeChatSystem(
    'game-theory',
    narrative.title,
    `${chatIdentityPrelude(work)} You bring deep game-theory knowledge to this conversation. The user wants to discuss this work through the lens of the per-scene strategic decompositions Meridians has extracted. The attached context is an OUTLINE WITH GAME-THEORY: every scene up to the cursor carries every BeatGame the analysis pass identified, rendered with FULL detail — game type (coordination / dilemma / chicken / stag-hunt / battle-of-sexes / zero-sum / signaling / commitment / bargaining / …), the action axis (disclosure, trust, control, status, pressure, stakes, …), each player's complete action menu, the COMPLETE PAYOFF MATRIX as one <cell> per (A-action, B-action) pairing with stake deltas for both sides (flagged with nash="true" on equilibrium cells and realized="true" on the cell the author wrote), Nash equilibria summary, stake-rank of the realized cell from each player's perspective, a margin score, and a running <elo-after> tag showing both players' ELO before→after the game inline. A closing <player-rankings> block consolidates final ELO, peak / trough, and W / L / D. Be ready to reason about whether realized cells are Nash, where dominant strategies were left on the table, which counterfactual cells would have flipped the outcome, which axes a character keeps losing, and how ELO trajectories reflect shifting leverage across the arc.`,
    [
      "the realized cell carries realized=\"true\" inside the matrix; cross-reference its deltaA / deltaB against the rest of the row + column to see what each player gave up by playing what they played",
      "nash=\"true\" marks unilaterally-stable cells. If the realized cell has realized=\"true\" but NOT nash=\"true\", at least one player could have deviated profitably — the rationale field is the place to look for why they didn't",
      "stakeRank reports the realized cell's rank in each player's preference order (1 = best possible). A high rank on A's side + low rank on B's side = author favoured A in that beat; symmetric ranks = a more balanced scene",
      "the inline <elo-after> tag gives you ELO BEFORE → AFTER + signed delta for both players on every single game — read drift across games WITHOUT re-deriving it from the matrix; the closing <player-rankings> is just a checksum",
      "ELO uses a continuous margin-of-victory score — a +4/−4 crush is a full win (margin ≈ 1.0), a +1/0 edge nudges (~0.56), a tie is 0.5. Quoted ELO deltas reflect that margin, not raw W/L",
      "axis classifies what the players are negotiating over (disclosure = will X tell Y? trust = does Y trust X?). Use axis to talk about a scene's strategic stakes without quoting the game-type taxonomy",
      "W / L / D in the rankings is from each player's own perspective — when a player is B, the score has been inverted, so 'wins' always means wins for that player",
      "structural claims ('this stance is contested', 'this character extracts from every coordination game') should be anchored in specific scene indices, specific matrix cells, and the rationale text; don't generalise beyond what the games actually show",
    ],
    {
      narrative,
      sceneAnchor,
      contextBlocks: [{ tag: 'game-theory', body: gameTheoryBlock }],
      extraDiscipline:
        'Quote game-type and axis names only when they carry the argument; otherwise translate ("a coordination problem where they both wanted X but landed on Y", "a disclosure question whose realized cell is the dominated option"). Refer to characters by their narrative names, not playerA/playerB. When citing ELO movement, prefer scene-indexed claims ("by scene 14, Harry\'s ELO had dropped 80 points") over raw rating quotes.',
    },
  );
}
