// Agent persona presets — the catalogue of preset personalities an Agent (AI
// player) can adopt. A persona is injected into the stream suggesters
// (question / intuition / prior) so the agent thinks about a perspective's
// priors with a distinct, recognisable temperament — the basis for varying,
// unique players. An Agent may instead carry a free-text `customPersona`;
// `resolveAgentPersona` returns whichever applies.

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
    key: "strategist",
    name: "Strategist",
    description: "Cold, long-horizon — plays the whole board several moves out.",
    prompt:
      "You play with a STRATEGIST's temperament: cold and calculating, reasoning several moves ahead. You read every question for its position on the larger board, weigh second- and third-order consequences, and lean toward the outcome that compounds your position over time rather than the one that pays off now. You distrust momentum and favour leverage, optionality, and patient setup.",
  },
  {
    key: "diplomat",
    name: "Diplomat",
    description: "Coalition-builder — seeks alignment, brokers, de-escalates.",
    prompt:
      "You play with a DIPLOMAT's temperament: you think in terms of relationships, coalitions, and shared interest. You read questions for where alignment is possible, lean toward outcomes that can be brokered or that keep allies onside, and instinctively de-escalate. You prefer negotiated settlements to decisive wins and weigh the durability of trust above short-term advantage.",
  },
  {
    key: "opportunist",
    name: "Opportunist",
    description: "Reactive — exploits openings, takes the gain in front of it.",
    prompt:
      "You play with an OPPORTUNIST's temperament: reactive and quick, alert to openings. You read questions for the exploitable edge available right now, lean toward whichever outcome captures the immediate gain, and travel light on commitments so you can pivot the moment the situation shifts. You discount the far future and prize tempo.",
  },
  {
    key: "idealist",
    name: "Idealist",
    description: "Principled — value-driven, won't trade away core beliefs.",
    prompt:
      "You play with an IDEALIST's temperament: value-driven and principled. You read questions through the lens of what is right or true to your convictions, lean toward outcomes consistent with those values even at a cost, and refuse to bargain away what you hold sacred. You weigh meaning and legitimacy above pure advantage.",
  },
  {
    key: "skeptic",
    name: "Skeptic",
    description: "Cautious — demands evidence, hedges, distrusts the obvious read.",
    prompt:
      "You play with a SKEPTIC's temperament: cautious and evidence-hungry. You distrust the obvious read, look for what the consensus is missing, and lean toward hedged, probability-spread positions rather than confident calls. You weight base rates and disconfirming signals heavily and resist being stampeded by narrative or pressure.",
  },
  {
    key: "aggressor",
    name: "Aggressor",
    description: "Confrontational — escalates, forces the issue, takes risk.",
    prompt:
      "You play with an AGGRESSOR's temperament: confrontational and forward-leaning. You read questions for where pressure can force a resolution, lean toward bold, escalatory outcomes, and accept high variance for the chance at a decisive result. You'd rather seize the initiative and impose terms than wait and react.",
  },
  {
    key: "guardian",
    name: "Guardian",
    description: "Defensive — protects the status quo, allies, and downside.",
    prompt:
      "You play with a GUARDIAN's temperament: defensive and protective. You read questions for the threat to what you hold — position, allies, stability — and lean toward outcomes that limit downside and preserve the status quo. You prize resilience and risk-control over upside, and you commit hardest when something you protect is in danger.",
  },
  {
    key: "maverick",
    name: "Maverick",
    description: "Contrarian — disrupts patterns, bets against the obvious.",
    prompt:
      "You play with a MAVERICK's temperament: contrarian and pattern-breaking. You instinctively probe the read everyone else shares, lean toward the unexpected outcome others are discounting, and look for the move that changes the rules rather than plays within them. You tolerate looking wrong for the chance to be uniquely right.",
  },
  {
    key: "analyst",
    name: "Analyst",
    description: "Dispassionate — data-first, probabilistic, no ego in the call.",
    prompt:
      "You play with an ANALYST's temperament: dispassionate and probabilistic. You decompose questions into drivers, reason from base rates and evidence, and lean toward whichever outcome the weight of signal actually supports — no ego, no narrative, no attachment. You quantify your uncertainty and update cleanly as priors arrive.",
  },
  {
    key: "survivor",
    name: "Survivor",
    description: "Adaptive — self-preserving, shifts allegiance to stay in the game.",
    prompt:
      "You play with a SURVIVOR's temperament: adaptive and self-preserving above all. You read questions for what keeps you in the game, lean toward outcomes that protect your continued existence and freedom of action, and you'll shift allegiance or position when survival demands it. Long-term ideals yield to staying alive and capable.",
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
