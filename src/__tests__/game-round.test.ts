import { describe, expect, it } from "vitest";

import { chooseAgentPlays, playEvidence, streamProbsResolver } from "@/lib/game/agent";
import { buildRoundAttribution, snapshotThreadLogits } from "@/lib/game/attribution";
import { defaultEconomy } from "@/lib/game/economy";
import { dealHand } from "@/lib/game/engine";
import { conservationError, scoreRound } from "@/lib/game/scoring";
import { applyStreamPrior } from "@/lib/forces/stream-stance";
import type { Hand, RoundState, Seat, Stream } from "@/types/narrative";

const econ = defaultEconomy();

function stream(id: string, perspectiveId: string, logits: number[]): Stream {
  return {
    id,
    perspectiveId,
    title: id,
    outcomes: logits.map((_, i) => `act${i}`),
    stance: { logits: [...logits], volume: 3, volatility: 0 },
    openingLogits: [...logits],
    state: "open",
    priors: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function seat(id: string): Seat {
  return {
    id,
    perspectiveId: `P_${id}`,
    driver: "agent",
    agentId: `ag_${id}`,
    status: "playing",
    conviction: econ.start,
    locationId: "loc1",
    movedThisRound: false,
    goals: [],
    fateImpact: 0,
  };
}

/** Simulate a full Rounds round offline: deal → agents play (stances move) →
 *  attribution → score. The conviction→fate loop with NO LLM. */
describe("conviction — one offline round end-to-end", () => {
  it("agents move their streams and bank Fate, conserving exactly", () => {
    const streamsById: Record<string, Stream> = {
      stA: stream("stA", "P_A", [0.2, -0.2]),
      stB: stream("stB", "P_B", [0, 0, 0]),
    };
    const seats: Record<string, Seat> = { A: seat("A"), B: seat("B") };
    const ownedBy: Record<string, string[]> = { A: ["stA"], B: ["stB"] };
    const resolver = streamProbsResolver(streamsById);

    // READ-WRITE: deal each seat its hand off its own streams.
    const hands: Record<string, Hand> = {};
    for (const s of Object.values(seats)) {
      const owned = ownedBy[s.id].map((id) => streamsById[id]);
      hands[s.id] = dealHand(s.id, owned, econ, (sid, o) => `${s.id}:${sid}:${o}`);
      expect(hands[s.id].cards.length).toBeGreaterThan(0);
    }

    // PLAY start: snapshot ℓ⁻ for every owned stream (aggressor persona for A,
    // survivor for B → A should drive more fate).
    const threadLogitsAtStart = snapshotThreadLogits(Object.values(streamsById));

    const personas: Record<string, "aggressor" | "survivor"> = {
      A: "aggressor",
      B: "survivor",
    };
    for (const s of Object.values(seats)) {
      const plays = chooseAgentPlays(s, hands[s.id], econ, personas[s.id], resolver);
      expect(plays.length).toBeGreaterThan(0);
      for (const play of plays) {
        const card = hands[s.id].cards.find((c) => c.id === play.cardId)!;
        const stream = streamsById[card.streamId];
        const e = playEvidence(play.conviction, card.cost, econ);
        // The play asserts the action — nudge the stance + log it as a prior.
        streamsById[card.streamId] = applyStreamPrior(stream, {
          text: `${s.id} commits ${play.conviction} on ${stream.outcomes![card.outcome]}`,
          authorId: s.id,
          updates: [{ outcome: stream.outcomes![card.outcome], evidence: e }],
        });
        hands[s.id].played.push({
          card,
          faceUp: true,
          conviction: play.conviction,
          playedAt: hands[s.id].played.length + 1,
        });
        seats[s.id].conviction -= play.conviction;
      }
    }

    const round = { hands, threadLogitsAtStart } as unknown as RoundState;

    // SCORING: attribute the realized shift, score the round.
    const attribution = buildRoundAttribution(round, streamsById);
    expect(attribution.length).toBe(2); // both streams moved

    const score = scoreRound(attribution);
    // Both seats banked positive Fate (they pushed their own stances).
    expect(score.perSeat.A).toBeGreaterThan(0);
    expect(score.perSeat.B).toBeGreaterThan(0);
    // The aggressor drove more fate than the survivor.
    expect(score.perSeat.A).toBeGreaterThan(score.perSeat.B);

    // Conservation across the round (uncontested → ~0 house band).
    for (const t of score.threads) expect(conservationError(t)).toBeLessThan(1e-6);
    const seatSum = score.perSeat.A + score.perSeat.B;
    expect(seatSum + score.houseBand).toBeCloseTo(score.total, 6);

    // Agents spent conviction (it's burned, not won).
    expect(seats.A.conviction).toBeLessThan(econ.start);
  });
});
