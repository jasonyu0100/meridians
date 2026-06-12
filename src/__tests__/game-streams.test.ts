import { beforeEach, describe, expect, it, vi } from "vitest";

// One LLM call; mock it to test the parse + normalisation contract.
vi.mock("@/lib/ai/api", () => ({ callGenerate: vi.fn() }));

import { callGenerate } from "@/lib/ai/api";
import { generateSeatStream } from "@/lib/ai/game-streams";

const mockReturn = (raw: string) => vi.mocked(callGenerate).mockResolvedValue(raw);

describe("generateSeatStream — parse + normalise", () => {
  beforeEach(() => vi.mocked(callGenerate).mockReset());

  it("trims outcomes and renormalises priorProbs to sum 1", async () => {
    mockReturn(
      JSON.stringify({
        question: "  What's my move? ",
        intuition: "I lean in.",
        outcomes: [" press ", "hold", "  "], // blank dropped
        priorProbs: [3, 1], // length mismatch handled, then renormalised
        logType: "escalation",
        rationale: " gut ",
      }),
    );
    const seed = await generateSeatStream({ perspectiveLabel: "X" });
    expect(seed.question).toBe("What's my move?");
    expect(seed.outcomes).toEqual(["press", "hold"]);
    expect(seed.priorProbs).toHaveLength(2);
    expect(seed.priorProbs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(seed.logType).toBe("escalation");
    expect(seed.rationale).toBe("gut");
  });

  it("falls back to a 2-way stance + defaults when the model gives too few outcomes", async () => {
    mockReturn(JSON.stringify({ outcomes: ["only one"], priorProbs: [] }));
    const seed = await generateSeatStream({ perspectiveLabel: "X" });
    expect(seed.outcomes.length).toBeGreaterThanOrEqual(2); // fallback pair
    expect(seed.priorProbs).toHaveLength(seed.outcomes.length);
    expect(seed.priorProbs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(seed.question.length).toBeGreaterThan(0); // fallback question
    expect(seed.logType).toBe("setup"); // default
  });

  it("defaults to a flat distribution when probs are missing or invalid", async () => {
    mockReturn(JSON.stringify({ outcomes: ["a", "b", "c"], priorProbs: [-1, 0] }));
    const seed = await generateSeatStream({ perspectiveLabel: "X" });
    expect(seed.outcomes).toEqual(["a", "b", "c"]);
    // length mismatch → all-equal → ~1/3 each
    expect(seed.priorProbs).toHaveLength(3);
    seed.priorProbs.forEach((p) => expect(p).toBeCloseTo(1 / 3, 6));
  });
});
