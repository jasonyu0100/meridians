/** Conviction agent play — the DETERMINISTIC FALLBACK for an AI seat's turn
 *  (the LLM policy `decideAgentPlays` in `lib/ai/game-agent.ts` is the primary
 *  path; this is what runs when that call fails or is offline). PURE + HEURISTIC:
 *  an agent backs the action its own stance already leans toward, sizing
 *  conviction by persona aggressiveness, bounded by its balance and
 *  CARDS_PER_ROUND. No LLM in the loop, so an all-AI room still plays instantly
 *  (offline-testable, cheap demos). Same `AgentPlay[]` signature as the LLM path. */
import { canAfford, evidenceFromConviction } from "@/lib/game/economy";
import { streamProbs } from "@/lib/forces/stream-stance";
import type { AgentPersonaKey, ConvictionEconomy, Hand, Seat } from "@/types/narrative";

/** Persona → aggressiveness ∈ [0,1] (how hard it raises beyond bare cost and how
 *  many cards it commits). Drawn from the preset's temperament. */
const PERSONA_AGGRESSION: Record<AgentPersonaKey, number> = {
  aggressor: 0.95,
  opportunist: 0.8,
  maverick: 0.8,
  actor: 0.6,
  strategist: 0.55,
  idealist: 0.6,
  diplomat: 0.4,
  analyst: 0.4,
  skeptic: 0.3,
  guardian: 0.3,
  survivor: 0.2,
  custom: 0.5,
};

export function personaAggression(persona: AgentPersonaKey | undefined): number {
  return PERSONA_AGGRESSION[persona ?? "custom"] ?? 0.5;
}

export interface AgentPlay {
  cardId: string;
  conviction: number;
  /** Play concealed (face-down) — pays the premium, hidden until showdown. */
  faceDown?: boolean;
}

/** Decide an agent seat's commits this round from its dealt hand. Backs the
 *  leading action of its most-decided streams first; sizes each commit between
 *  bare cost and ~3× cost by aggressiveness; stops at the card cap or when broke.
 *  `streamsById` resolves a card's live stance to pick the action it leans to. */
export function chooseAgentPlays(
  seat: Seat,
  hand: Hand,
  economy: ConvictionEconomy,
  persona: AgentPersonaKey | undefined,
  streamProbsFor: (streamId: string) => number[],
): AgentPlay[] {
  const aggression = personaAggression(persona);

  // One candidate per stream: the card on that stream's leading action.
  const byStream = new Map<string, { cardId: string; cost: number; prob: number }>();
  for (const card of hand.cards) {
    const probs = streamProbsFor(card.streamId);
    const prob = probs[card.outcome] ?? 0;
    const cur = byStream.get(card.streamId);
    if (!cur || prob > cur.prob) {
      byStream.set(card.streamId, { cardId: card.id, cost: card.cost, prob });
    }
  }

  // Prefer the most-decided streams (highest leading prob) — conviction follows
  // belief. Aggressive personas commit more cards.
  const candidates = [...byStream.values()].sort((a, b) => b.prob - a.prob);
  const maxCards = Math.max(1, Math.round(1 + aggression * (economy.cardsPerRound - 1)));

  const plays: AgentPlay[] = [];
  let balance = seat.conviction;
  for (const c of candidates) {
    if (plays.length >= Math.min(maxCards, economy.cardsPerRound)) break;
    if (!canAfford(balance, c.cost, true, plays.length, economy)) continue;
    // Size between bare cost and ~3× cost by aggression; clamp to balance.
    const want = Math.round(c.cost * (1 + aggression * 2));
    const conviction = Math.min(want, balance);
    if (conviction < c.cost) continue;
    plays.push({ cardId: c.cardId, conviction });
    balance -= conviction;
  }
  return plays;
}

/** The evidence a chosen play will stamp on its stream's leading action — used
 *  by the hook to nudge the stance (so attribution reads a real shift). */
export function playEvidence(conviction: number, cost: number, economy: ConvictionEconomy): number {
  return evidenceFromConviction(conviction, cost, economy);
}

/** Convenience for callers that have the stream objects to hand. */
export function streamProbsResolver(
  streamsById: Record<string, { id: string }>,
): (streamId: string) => number[] {
  return (streamId) => {
    const s = streamsById[streamId] as Parameters<typeof streamProbs>[0] | undefined;
    return s ? streamProbs(s) : [];
  };
}
