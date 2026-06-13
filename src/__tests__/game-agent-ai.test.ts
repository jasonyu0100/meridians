import { beforeEach, describe, expect, it, vi } from "vitest";

// The LLM agent-play decision — mock the model and test the HARD CLAMP that
// keeps a hallucinated reply legal (real cardIds, conviction ≥ floor, affordable,
// within the per-round cap, face-down only when priced).
vi.mock("@/lib/ai/api", () => ({ callGenerate: vi.fn() }));

import { callGenerate } from "@/lib/ai/api";
import { decideAgentPlays } from "@/lib/ai/game-agent";
import { defaultEconomy } from "@/lib/game/economy";
import type { Card, ConvictionEconomy, Hand, Seat, Stream } from "@/types/narrative";

const mockJson = (obj: unknown) => vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(obj));

const card = (id: string, cost: number, streamId = "s1", outcome = 0): Card => ({ id, streamId, outcome, cost, origin: "chosen" });
const hand = (cards: Card[]): Hand => ({ seatId: "seat1", cards, played: [] });
const seat = (conviction: number): Seat => ({ conviction } as Seat);
const streams: Record<string, Stream> = {};
const econ = (over: Partial<ConvictionEconomy> = {}): ConvictionEconomy => ({ ...defaultEconomy(), ...over });

describe("decideAgentPlays — clamp keeps the LLM honest", () => {
  beforeEach(() => vi.mocked(callGenerate).mockReset());

  it("plays nothing (no call) when every card is already played", async () => {
    const c = card("c1", 10);
    const h: Hand = { seatId: "seat1", cards: [c], played: [{ card: c, faceUp: true, conviction: 10, playedAt: 1 }] };
    const out = await decideAgentPlays({ seat: seat(100), hand: h, economy: econ(), streamsById: streams });
    expect(out.plays).toEqual([]);
    expect(callGenerate).not.toHaveBeenCalled();
  });

  it("an empty plays array is a legitimate pass", async () => {
    mockJson({ plays: [], rationale: "holding" });
    const out = await decideAgentPlays({ seat: seat(100), hand: hand([card("c1", 10)]), economy: econ(), streamsById: streams });
    expect(out.plays).toEqual([]);
    expect(out.rationale).toBe("holding");
  });

  it("drops a play bid below the cost floor (legality is law, not clamped up)", async () => {
    mockJson({ plays: [{ cardId: "c1", conviction: 3 }] }); // below floor 10
    const out = await decideAgentPlays({ seat: seat(100), hand: hand([card("c1", 10)]), economy: econ(), streamsById: streams });
    expect(out.plays).toEqual([]);
  });

  it("preserves a legal raise at its exact value (no clamping)", async () => {
    mockJson({ plays: [{ cardId: "c1", conviction: 30 }] }); // raise above floor 10, within stack 40
    const out = await decideAgentPlays({ seat: seat(40), hand: hand([card("c1", 10)]), economy: econ(), streamsById: streams });
    expect(out.plays).toEqual([{ cardId: "c1", conviction: 30, faceDown: false }]);
  });

  it("drops a raise that overruns the balance (not clamped down)", async () => {
    mockJson({ plays: [{ cardId: "c1", conviction: 999 }] });
    const out = await decideAgentPlays({ seat: seat(40), hand: hand([card("c1", 10)]), economy: econ(), streamsById: streams });
    expect(out.plays).toEqual([]);
  });

  it("drops plays referencing an unknown card and dedupes repeats", async () => {
    mockJson({ plays: [{ cardId: "ghost", conviction: 10 }, { cardId: "c1", conviction: 10 }, { cardId: "c1", conviction: 20 }] });
    const out = await decideAgentPlays({ seat: seat(100), hand: hand([card("c1", 10)]), economy: econ(), streamsById: streams });
    expect(out.plays).toEqual([{ cardId: "c1", conviction: 10, faceDown: false }]);
  });

  it("never exceeds the per-round card cap", async () => {
    mockJson({ plays: [{ cardId: "c1", conviction: 5 }, { cardId: "c2", conviction: 5 }, { cardId: "c3", conviction: 5 }] });
    const out = await decideAgentPlays({
      seat: seat(100),
      hand: hand([card("c1", 5, "s1", 0), card("c2", 5, "s2", 0), card("c3", 5, "s3", 0)]),
      economy: econ({ cardsPerRound: 2 }),
      streamsById: streams,
    });
    expect(out.plays).toHaveLength(2);
  });

  it("ignores faceDown when concealment isn't priced (premium = 1)", async () => {
    mockJson({ plays: [{ cardId: "c1", conviction: 10, faceDown: true }] });
    const out = await decideAgentPlays({ seat: seat(100), hand: hand([card("c1", 10)]), economy: econ({ facedownPremium: 1 }), streamsById: streams });
    expect(out.plays[0].faceDown).toBe(false);
  });

  it("drops a face-down play bid below the premium floor", async () => {
    mockJson({ plays: [{ cardId: "c1", conviction: 10, faceDown: true }] }); // below premium floor round(10×1.5)=15
    const out = await decideAgentPlays({ seat: seat(100), hand: hand([card("c1", 10)]), economy: econ({ facedownPremium: 1.5 }), streamsById: streams });
    expect(out.plays).toEqual([]);
  });

  it("keeps a face-down play that clears the premium floor", async () => {
    mockJson({ plays: [{ cardId: "c1", conviction: 15, faceDown: true }] }); // = premium floor round(10×1.5)=15
    const out = await decideAgentPlays({ seat: seat(100), hand: hand([card("c1", 10)]), economy: econ({ facedownPremium: 1.5 }), streamsById: streams });
    expect(out.plays).toEqual([{ cardId: "c1", conviction: 15, faceDown: true }]);
  });

  it("skips a card the seat cannot afford", async () => {
    mockJson({ plays: [{ cardId: "c1", conviction: 50 }] });
    const out = await decideAgentPlays({ seat: seat(5), hand: hand([card("c1", 10)]), economy: econ(), streamsById: streams });
    expect(out.plays).toEqual([]);
  });
});
