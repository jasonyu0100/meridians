import { beforeEach, describe, expect, it, vi } from "vitest";

// One LLM call; mock it to test the parse + logit/share conversion contract.
vi.mock("@/lib/ai/api", () => ({ callGenerate: vi.fn() }));

import { callGenerate } from "@/lib/ai/api";
import { scoreThreadsWithAI, type ThreadScoringInput } from "@/lib/ai/game-scoring";

const mockReturn = (raw: string) => vi.mocked(callGenerate).mockResolvedValue(raw);

const softmax = (l: number[]) => {
  const m = Math.max(...l);
  const e = l.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
};

const thread = (over: Partial<ThreadScoringInput> = {}): ThreadScoringInput => ({
  threadId: "T1",
  question: "What's my move?",
  outcomes: ["press", "hold"],
  logitsBefore: [0, 0],
  resolvedLog: "She pressed and it broke open.",
  resolutions: [
    { seatId: "s1", name: "Alice", backed: "press", conviction: 40, acted: true },
    { seatId: "s2", name: "Bob", backed: "hold", conviction: 10, acted: true },
  ],
  ...over,
});

describe("scoreThreadsWithAI — logits + shares conversion", () => {
  beforeEach(() => vi.mocked(callGenerate).mockReset());

  it("turns realizedProbs into softmax-invertible logits and drives into share vectors", async () => {
    mockReturn(
      JSON.stringify({
        threads: [
          {
            threadId: "T1",
            realizedProbs: [0.7, 0.3],
            drive: { s1: 1, s2: 0 },
            reasoning: " press landed ",
            perSeat: [{ seatId: "s1", reasoning: " drove it " }],
          },
        ],
      }),
    );
    const [read] = await scoreThreadsWithAI([thread()]);
    // logitsAfter softmaxes back to the realized distribution
    const p = softmax(read.logitsAfter);
    expect(p[0]).toBeCloseTo(0.7, 5);
    expect(p[1]).toBeCloseTo(0.3, 5);
    // s1 drove fully → its share == Δℓ; s2 drove 0 → zero share
    const dl = read.logitsAfter.map((x, k) => x - thread().logitsBefore[k]);
    expect(read.shares.s1).toEqual(dl);
    expect(read.shares.s2).toEqual([0, 0]);
    // reasoning trimmed + per-seat attribution kept
    expect(read.reasoning).toBe("press landed");
    expect(read.perSeat.find((x) => x.seatId === "s1")?.reasoning).toBe("drove it");
  });

  it("scales over-explained drives so a non-negative Fate residual remains", async () => {
    mockReturn(JSON.stringify({ threads: [{ threadId: "T1", realizedProbs: [0.6, 0.4], drive: { s1: 0.8, s2: 0.8 } }] }));
    const [read] = await scoreThreadsWithAI([thread()]);
    const dl = read.logitsAfter.map((x) => x - 0);
    // sum drive 1.6 → scaled to 1.0 total; shares sum to Δℓ (band = 0, not negative)
    const sum = read.shares.s1.map((x, k) => x + read.shares.s2[k]);
    sum.forEach((x, k) => expect(x).toBeCloseTo(dl[k], 6));
    // each seat got half (0.8/1.6) of Δℓ
    read.shares.s1.forEach((x, k) => expect(x).toBeCloseTo(dl[k] / 2, 6));
  });

  it("a thread the model omits gets a no-shift read (no Impact)", async () => {
    mockReturn(JSON.stringify({ threads: [] }));
    const [read] = await scoreThreadsWithAI([thread({ logitsBefore: [1, -1] })]);
    expect(read.logitsAfter).toEqual([1, -1]); // ℓ⁺ = ℓ⁻ → Δℓ = 0
    expect(read.shares.s1).toEqual([0, 0]);
    expect(read.shares.s2).toEqual([0, 0]);
  });

  it("returns [] for no threads without calling the model", async () => {
    expect(await scoreThreadsWithAI([])).toEqual([]);
    expect(callGenerate).not.toHaveBeenCalled();
  });

  it("scores a HELD (non-action) seat as a stance — credited when restraint drove the landing", async () => {
    // Bob held; the model judges his restraint let the status quo carry → drive 0.5.
    mockReturn(JSON.stringify({ threads: [{ threadId: "T1", realizedProbs: [0.3, 0.7], drive: { s1: 0, s2: 0.5 } }] }));
    const held = thread({
      resolutions: [
        { seatId: "s1", name: "Alice", backed: "press", conviction: 40, acted: true },
        { seatId: "s2", name: "Bob", backed: "(held — no action)", conviction: 0, acted: false },
      ],
    });
    const [read] = await scoreThreadsWithAI([held], 0, "Nothing forced the question; it settled where it stood.");
    const dl = read.logitsAfter.map((x, k) => x - held.logitsBefore[k]);
    // the held seat carries a real (non-zero) share of the realized shift
    expect(read.shares.s2).toEqual(dl.map((x) => x * 0.5 + 0));
    expect(read.shares.s2.some((x) => x !== 0)).toBe(true);
    // the prompt renders the held seat as HELD + the shared continuation digest
    const userPrompt = vi.mocked(callGenerate).mock.calls[0][0] as string;
    expect(userPrompt).toContain("HELD — committed no card");
    expect(userPrompt).toContain("THE ROUND'S CONTINUATION");
  });
});

import { assembleScoreReveal } from "@/lib/ai/game-scoring";
import type { RoundScore } from "@/lib/game/scoring";

describe("assembleScoreReveal — the round's scoring story", () => {
  const score: RoundScore = {
    perSeat: { s1: 0.9, s2: -0.1 },
    houseBand: 0.3,
    total: 1.4,
    threads: [
      { threadId: "T1", fateCredits: { s1: 0.8, s2: -0.1 }, houseBand: 0.1, totalFate: 0.8 },
      { threadId: "T2", fateCredits: { s1: 0.1 }, houseBand: 0.2, totalFate: 0.6 },
    ],
  };
  const reads = [
    { threadId: "T1", logitsAfter: [], shares: {}, reasoning: "press landed", perSeat: [{ seatId: "s1", reasoning: "drove it" }] },
    { threadId: "T2", logitsAfter: [], shares: {}, reasoning: "drifted", perSeat: [] },
  ];

  it("bundles fate, house band, reasoning, per-seat credit, and ranked standings", () => {
    const reveal = assembleScoreReveal({
      roundIndex: 2,
      reads,
      score,
      questionOf: (id) => (id === "T1" ? "Press or hold?" : "Stay or go?"),
      seatInfo: (id) => ({ name: id === "s1" ? "Alice" : "Bob", color: "#fff", total: id === "s1" ? 3.0 : 0.5 }),
    });
    // threads ordered by Fate moved (T1 0.8 > T2 0.6)
    expect(reveal.threads.map((t) => t.threadId)).toEqual(["T1", "T2"]);
    expect(reveal.threads[0].question).toBe("Press or hold?");
    expect(reveal.threads[0].reasoning).toBe("press landed");
    expect(reveal.threads[0].houseBand).toBe(0.1);
    // per-seat credit + AI attribution carried through, movers first
    const alice = reveal.threads[0].seats.find((s) => s.seatId === "s1");
    expect(alice).toMatchObject({ credit: 0.8, reasoning: "drove it", name: "Alice" });
    // round-level house band surfaced
    expect(reveal.totalFate).toBe(1.4);
    expect(reveal.houseBand).toBe(0.3);
    // standings ranked by total
    expect(reveal.standings.map((s) => s.seatId)).toEqual(["s1", "s2"]);
    expect(reveal.standings[0]).toMatchObject({ rank: 1, credit: 0.9, total: 3.0 });
    expect(reveal.standings[1].rank).toBe(2);
  });
});

import { scoreThread, conservationError, type ThreadAttribution } from "@/lib/game/scoring";

describe("scoring path — AI logits feed the formula, conserving exactly", () => {
  beforeEach(() => vi.mocked(callGenerate).mockReset());

  it("the driving seat earns Fate, the residual is the house band, and credits conserve", async () => {
    mockReturn(JSON.stringify({ threads: [{ threadId: "T1", realizedProbs: [0.75, 0.25], drive: { s1: 0.8, s2: 0 } }] }));
    const [read] = await scoreThreadsWithAI([thread()]);

    // The caller pairs the AI read (logitsAfter + shares) with ℓ⁻ + volume.
    const attr: ThreadAttribution = {
      threadId: "T1",
      logitsBefore: [0, 0],
      logitsAfter: read.logitsAfter,
      volume: 2,
      shares: read.shares,
    };
    const ts = scoreThread(attr);

    // Aumann–Shapley conserves: Σ seat credits + house band == total Fate.
    expect(conservationError(ts)).toBeLessThan(1e-6);
    // s1 drove the realized shift → positive credit; s2 didn't → ~0.
    expect(ts.fateCredits.s1).toBeGreaterThan(0);
    expect(Math.abs(ts.fateCredits.s2)).toBeLessThan(1e-6);
    // 20% of the drive was unclaimed → the world (house band) owns a real slice.
    expect(ts.houseBand).toBeGreaterThan(0);
  });
});
