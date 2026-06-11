// Agent persona presets — the catalogue of preset personalities an Agent (AI
// player) can adopt. A persona is injected into the stream suggesters
// (question / intuition / prior) so the agent reads a perspective's priors with
// a distinct, recognisable tilt — the basis for varying, unique players.
//
// Personas AUGMENT, they do not replace. The agent always inhabits an entity
// (a perspective with its own goals, stake, and continuity); the persona is a
// lens laid over that entity, tilting how it reads, leans, and frames without
// overriding who it is (see `personaBlock` in `lib/ai/streams.ts`). "actor" is
// the baseline — pure inhabitation, no tilt — and every other preset bends one
// distinct axis on top of it. An Agent may instead carry a free-text
// `customPersona`; `resolveAgentPersona` returns whichever applies.

import type { Agent, AgentPersonaKey, NarrativeState } from "@/types/narrative";

export interface AgentPersonaPreset {
  key: Exclude<AgentPersonaKey, "custom">;
  /** Display name shown in the Agents modal. */
  name: string;
  /** One-line summary of the temperament. */
  description: string;
  /** The persona prompt — describes how this player reads, leans, and frames,
   *  injected into the suggesters as the operating temperament. */
  prompt: string;
}

export const AGENT_PERSONA_PRESETS: readonly AgentPersonaPreset[] = [
  {
    key: "actor",
    name: "Actor",
    description: "Pure inhabitation — plays the entity straight, adds no tilt of its own.",
    prompt:
      "You are the baseline beneath every other persona: pure actor's discipline, no temperament of your own. Inhabit the perspective you operate completely and play it to the best of its ability — read, lean, and frame exactly as it would, drawing only on what its continuity says it knows, wants, and fears. Where another player would colour the read, you let the perspective's own character decide. Never break character or reach for what it couldn't know. Add nothing, impose nothing: the truest possible portrayal of who they are.",
  },
  {
    key: "strategist",
    name: "Strategist",
    description: "Long-horizon tilt — stretches the entity's read several moves out.",
    prompt:
      "Over the perspective you inhabit, you stretch its horizon. You don't change what it wants — you make it read every question for position on the larger board, weighing second- and third-order consequences and favouring the move that compounds its advantage over time rather than the one that pays now. You sharpen its patience: leverage, optionality, and patient setup over momentum.",
  },
  {
    key: "diplomat",
    name: "Diplomat",
    description: "Coalition tilt — bends the entity toward alignment and brokered settlement.",
    prompt:
      "You tune the perspective you inhabit toward relationships. It still wants exactly what it wants — but you make it pursue those wants through alignment: reading each question for where shared interest exists, favouring outcomes that can be brokered or that keep allies onside, and instinctively de-escalating. You make it weigh the durability of trust on the way to its goal.",
  },
  {
    key: "opportunist",
    name: "Opportunist",
    description: "Tempo tilt — sharpens the entity's eye for the edge in front of it.",
    prompt:
      "You quicken the perspective you inhabit. You keep its aims but bias it toward the exploitable edge available right now — alert to openings, light on commitments, ready to pivot the instant the situation shifts. You discount the far future on its behalf and prize tempo: the gain it can take this turn over the position it might build later.",
  },
  {
    key: "idealist",
    name: "Idealist",
    description: "Conviction tilt — anchors the entity to its principles, even at cost.",
    prompt:
      "You raise the convictions of the perspective you inhabit to the surface. You make it read questions through what it holds right or true, favour outcomes consistent with those values even when they cost it, and refuse — on its behalf — to bargain away what it treats as sacred. You weight meaning and legitimacy above raw advantage.",
  },
  {
    key: "skeptic",
    name: "Skeptic",
    description: "Evidence tilt — makes the entity distrust the obvious read and hedge.",
    prompt:
      "You make the perspective you inhabit doubt the easy answer. It still pursues its aims, but you bias it toward what the consensus is missing — hedged, probability-spread positions over confident calls, base rates and disconfirming signals weighted heavily. You make it hard to stampede with narrative or pressure.",
  },
  {
    key: "aggressor",
    name: "Aggressor",
    description: "Initiative tilt — pushes the entity to escalate and force the issue.",
    prompt:
      "You lean the perspective you inhabit forward. You bias it toward pressure that forces a resolution — bold, escalatory reads, high variance accepted for the chance at a decisive result. It keeps its goals; you make it seize the initiative and impose terms rather than wait and react.",
  },
  {
    key: "guardian",
    name: "Guardian",
    description: "Protection tilt — turns the entity toward defending what it holds.",
    prompt:
      "You orient the perspective you inhabit to the downside. You make it read questions for the threat to what it holds — position, allies, stability — and favour outcomes that limit loss and preserve what works. It commits hardest when something it protects is in danger; you prize resilience and risk-control over upside on its behalf.",
  },
  {
    key: "maverick",
    name: "Maverick",
    description: "Contrarian tilt — pulls the entity off the read everyone shares.",
    prompt:
      "You pull the perspective you inhabit off the read everyone shares. You bias it to probe the consensus, lean toward the outcome others are discounting, and look for the move that changes the rules rather than plays within them. It tolerates looking wrong — through you — for the chance to be uniquely right.",
  },
  {
    key: "analyst",
    name: "Analyst",
    description: "Decomposition tilt — makes the entity reason from drivers and base rates.",
    prompt:
      "You make the perspective you inhabit cooler and more exact. You decompose its questions into drivers, reason from base rates and the weight of evidence, and lean wherever the signal actually points — no ego, no narrative attachment. You quantify its uncertainty and update cleanly as priors arrive.",
  },
  {
    key: "survivor",
    name: "Survivor",
    description: "Self-preservation tilt — bends the entity toward staying in the game.",
    prompt:
      "You make survival the first reflex of the perspective you inhabit. You bias it toward outcomes that protect its continued existence and freedom of action, and you let it shift position or allegiance when survival demands it. Long-term ideals yield, through you, to remaining alive and capable.",
  },
];

const PRESET_BY_KEY: Record<string, AgentPersonaPreset> = Object.fromEntries(
  AGENT_PERSONA_PRESETS.map((p) => [p.key, p]),
);

/** Call-sign pool the name suggester draws from — evocative, distinct handles
 *  that read as players rather than personas. */
const AGENT_NAME_POOL: readonly string[] = [
  "Atlas", "Vega", "Orion", "Cipher", "Echo", "Sable", "Vesper", "Cobalt",
  "Halcyon", "Onyx", "Quill", "Raven", "Solace", "Tempest", "Umbra", "Cassia",
  "Drake", "Nyx", "Argus", "Lyra", "Mercer", "Pallas", "Rune", "Talon",
  "Wren", "Zephyr", "Kestrel", "Marlowe", "Osprey", "Senna",
];

/** Suggest an agent name that isn't already in `taken` (case-insensitive). Picks
 *  at random from the call-sign pool so re-rolling yields variety; falls back to
 *  a numbered "Agent N" handle once the pool is exhausted. */
export function suggestAgentName(taken: Iterable<string>): string {
  const used = new Set(
    Array.from(taken, (t) => t.trim().toLowerCase()).filter(Boolean),
  );
  const free = AGENT_NAME_POOL.filter((nm) => !used.has(nm.toLowerCase()));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  for (let i = 2; ; i++) {
    const candidate = `Agent ${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Human-readable label for an agent's persona ("Strategist", "Custom", …). */
export function agentPersonaLabel(agent: Agent | undefined): string {
  if (!agent) return "";
  if (agent.persona === "custom") return "Custom";
  return PRESET_BY_KEY[agent.persona]?.name ?? agent.persona;
}

/** The effective persona prompt for an agent — the custom text when persona is
 *  "custom", otherwise the matching preset's prompt. Empty string if neither
 *  resolves (e.g. custom with no text yet). */
export function resolveAgentPersona(agent: Agent | undefined): string {
  if (!agent) return "";
  if (agent.persona === "custom") return agent.customPersona?.trim() ?? "";
  return PRESET_BY_KEY[agent.persona]?.prompt ?? "";
}

// ── Built-in agents ──────────────────────────────────────────────────────────
// One ready-made agent per preset persona, always available in every room
// alongside the GM's custom agents. They aren't stored on the narrative — they
// live here, resolved on demand — so they can't be edited or deleted and never
// bloat the saved state. Custom agents (user-authored) live on `narrative.agents`.

/** Prefix that marks a built-in agent id (distinct from user `agent-…` ids). */
export const BUILTIN_AGENT_ID_PREFIX = "agent:builtin:";

/** The hardcoded roster: one agent per preset persona. */
export const BUILTIN_AGENTS: readonly Agent[] = AGENT_PERSONA_PRESETS.map((p) => ({
  id: `${BUILTIN_AGENT_ID_PREFIX}${p.key}`,
  name: p.name,
  persona: p.key,
}));

const BUILTIN_BY_ID: Record<string, Agent> = Object.fromEntries(
  BUILTIN_AGENTS.map((a) => [a.id, a]),
);

/** True for a built-in (hardcoded, read-only) agent id. */
export function isBuiltinAgentId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(BUILTIN_AGENT_ID_PREFIX);
}

/** Resolve an agent id against the built-in roster first, then the narrative's
 *  custom agents. Returns undefined when neither holds it. */
export function resolveAgentById(
  narrative: NarrativeState | null | undefined,
  id: string | null | undefined,
): Agent | undefined {
  if (!id) return undefined;
  return BUILTIN_BY_ID[id] ?? narrative?.agents?.[id];
}

/** Every agent available in a room: built-ins first, then custom agents. */
export function allAgents(narrative: NarrativeState | null | undefined): Agent[] {
  return [...BUILTIN_AGENTS, ...Object.values(narrative?.agents ?? {})];
}

/** Short, human-readable persona text for a table/badge — the preset's
 *  one-line description for a preset agent, or the custom prompt for a custom
 *  one. (Distinct from `resolveAgentPersona`, which returns the full prompt.) */
export function agentPersonaText(agent: Agent | undefined): string {
  if (!agent) return "";
  if (agent.persona === "custom") return agent.customPersona?.trim() ?? "";
  return PRESET_BY_KEY[agent.persona]?.description ?? "";
}
