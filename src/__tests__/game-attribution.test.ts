import { describe, expect, it } from "vitest";

import { buildRoundAttribution, ownerSeatByStream, snapshotThreadLogits } from "@/lib/game/attribution";
import type { PlayedCard, RoundState, Stream } from "@/types/narrative";

const playOf = (streamId: string): PlayedCard =>
  ({ card: { streamId, outcome: 0 }, faceUp: true, conviction: 10, playedAt: 1 } as unknown as PlayedCard);

const stream = (id: string, logits: number[], openingLogits?: number[]): Stream =>
  ({
    id,
    perspectiveId: "P",
    title: id,
    outcomes: logits.map((_, i) => `a${i}`),
    stance: { logits, volume: 2, volatility: 0 },
    openingLogits,
    state: "open",
    priors: [],
    createdAt: 0,
    updatedAt: 0,
  }) as Stream;

describe("attribution — ownerSeatByStream", () => {
  it("maps each played stream to its (first) playing seat", () => {
    const round = {
      hands: {
        s1: { seatId: "s1", cards: [], played: [playOf("A"), playOf("A")] }, // dupe → first wins
        s2: { seatId: "s2", cards: [], played: [playOf("B")] },
      },
    } as unknown as RoundState;
    const owner = ownerSeatByStream(round);
    expect(owner.get("A")).toBe("s1");
    expect(owner.get("B")).toBe("s2");
    expect(owner.size).toBe(2);
  });
});

describe("attribution — snapshotThreadLogits", () => {
  it("snapshots each stream's stance logits by id (a copy, not a reference)", () => {
    const s = stream("A", [1, 2]);
    const snap = snapshotThreadLogits([s]);
    expect(snap.A).toEqual([1, 2]);
    expect(snap.A).not.toBe(s.stance!.logits); // copied
  });

  it("falls back to openingLogits when there is no stance", () => {
    const s = { id: "A", openingLogits: [0, 0], state: "open", priors: [], createdAt: 0, updatedAt: 0, perspectiveId: "P", title: "A" } as Stream;
    expect(snapshotThreadLogits([s]).A).toEqual([0, 0]);
  });
});

describe("attribution — buildRoundAttribution", () => {
  it("credits the realized shift (ℓ⁺ − ℓ⁻) entirely to the owning seat", () => {
    const round = {
      hands: { s1: { seatId: "s1", cards: [], played: [playOf("A")] } },
      threadLogitsAtStart: { A: [0, 0] },
    } as unknown as RoundState;
    const out = buildRoundAttribution(round, { A: stream("A", [1, 0]) });
    expect(out).toHaveLength(1);
    expect(out[0].threadId).toBe("A");
    expect(out[0].logitsBefore).toEqual([0, 0]);
    expect(out[0].logitsAfter).toEqual([1, 0]);
    expect(out[0].shares).toEqual({ s1: [1, 0] });
    expect(out[0].volume).toBe(2);
  });

  it("uses openingLogits as ℓ⁻ when no round snapshot exists, and skips stance-less streams", () => {
    const round = {
      hands: { s1: { seatId: "s1", cards: [], played: [playOf("A"), playOf("ghost")] } },
    } as unknown as RoundState;
    const out = buildRoundAttribution(round, { A: stream("A", [2, 0], [0, 0]) });
    expect(out).toHaveLength(1); // "ghost" has no stream → skipped
    expect(out[0].shares.s1).toEqual([2, 0]);
  });
});
