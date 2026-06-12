import { beforeEach, describe, expect, it, vi } from "vitest";

// The realism preprocessing call — mock the LLM layer to test the parse +
// outcome-mapping + decidedOutcome + closure contract (the bit that feeds the
// merge basis and is GM-edited). Both the one-shot and streaming paths.
vi.mock("@/lib/ai/api", () => ({ callGenerate: vi.fn(), callGenerateStream: vi.fn() }));

import { callGenerate, callGenerateStream } from "@/lib/ai/api";
import { resolveConflictRealism, type RealismConflict } from "@/lib/ai/game-realism";

const mockJson = (obj: unknown) => vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(obj));

const conflict = (over: Partial<RealismConflict> = {}): RealismConflict => ({
  id: "g1",
  question: "Which way does gold go?",
  claims: [
    { claimant: "Bull", action: "gold rises", conviction: 30 },
    { claimant: "Bear", action: "gold falls", conviction: 10 },
  ],
  ...over,
});

describe("resolveConflictRealism — determination contract", () => {
  beforeEach(() => {
    vi.mocked(callGenerate).mockReset();
    vi.mocked(callGenerateStream).mockReset();
  });

  it("returns [] and makes no call when there are no conflicts", async () => {
    const out = await resolveConflictRealism({ conflicts: [] });
    expect(out).toEqual([]);
    expect(callGenerate).not.toHaveBeenCalled();
  });

  it("parses outcome / telling / reasoning and defaults closes to false", async () => {
    mockJson({
      resolutions: [{ id: "g1", outcome: "gold rises", telling: "  Demand spikes. ", reasoning: " thin float ", closes: false }],
    });
    const [r] = await resolveConflictRealism({ conflicts: [conflict()] });
    expect(r.outcome).toBe("gold rises");
    expect(r.telling).toBe("Demand spikes."); // trimmed
    expect(r.reasoning).toBe("thin float"); // trimmed
    expect(r.closes).toBe(false);
  });

  it("closes is true ONLY when the judge sets it true (not truthy strings)", async () => {
    mockJson({ resolutions: [{ id: "g1", outcome: "gold rises", telling: "x", reasoning: "y", closes: "yes" }] });
    const [r] = await resolveConflictRealism({ conflicts: [conflict()] });
    expect(r.closes).toBe(false);
    mockJson({ resolutions: [{ id: "g1", outcome: "gold rises", telling: "x", reasoning: "y", closes: true }] });
    const [r2] = await resolveConflictRealism({ conflicts: [conflict()] });
    expect(r2.closes).toBe(true);
  });

  it("maps the chosen outcome to a candidate case-insensitively", async () => {
    mockJson({ resolutions: [{ id: "g1", outcome: "GOLD RISES", telling: "x", reasoning: "y" }] });
    const [r] = await resolveConflictRealism({ conflicts: [conflict()] });
    expect(r.outcome).toBe("gold rises"); // verbatim candidate, not the LLM's casing
  });

  it("falls back to the highest-conviction claim when the outcome matches none", async () => {
    mockJson({ resolutions: [{ id: "g1", outcome: "gold teleports", telling: "x", reasoning: "y" }] });
    const [r] = await resolveConflictRealism({ conflicts: [conflict()] });
    expect(r.outcome).toBe("gold rises"); // Bull (30) outranks Bear (10)
  });

  it("a DECIDED outcome is forced — the judge's pick is ignored", async () => {
    mockJson({ resolutions: [{ id: "g1", outcome: "gold rises", telling: "x", reasoning: "y" }] });
    const [r] = await resolveConflictRealism({ conflicts: [conflict({ decidedOutcome: "gold falls" })] });
    expect(r.outcome).toBe("gold falls"); // the fixed (dice/rule) winner stands
  });

  it("skips resolutions for unknown ids and dedupes repeats", async () => {
    mockJson({
      resolutions: [
        { id: "g1", outcome: "gold rises", telling: "a", reasoning: "" },
        { id: "ghost", outcome: "whatever", telling: "b", reasoning: "" },
        { id: "g1", outcome: "gold falls", telling: "dupe", reasoning: "" },
      ],
    });
    const out = await resolveConflictRealism({ conflicts: [conflict()] });
    expect(out).toHaveLength(1);
    expect(out[0].telling).toBe("a"); // first wins, dupe + ghost dropped
  });

  it("threads the GM steer and the decided outcome into the prompt", async () => {
    mockJson({ resolutions: [{ id: "g1", outcome: "gold falls", telling: "x", reasoning: "y" }] });
    await resolveConflictRealism({
      conflicts: [conflict({ decidedOutcome: "gold falls" })],
      guidance: "treat the central bank as decisive",
      narrativeContext: "WORLD STATE",
    });
    const userPrompt = vi.mocked(callGenerate).mock.calls[0][0] as string;
    expect(userPrompt).toContain("treat the central bank as decisive");
    expect(userPrompt).toContain("DECIDED outcome");
    expect(userPrompt).toContain("WORLD STATE");
  });

  it("streams the judge's reasoning via onProgress (streaming path)", async () => {
    vi.mocked(callGenerateStream).mockImplementation(
      async (_user, _sys, onToken, _mt, _caller, _model, _rb, onReasoning) => {
        onReasoning?.("weighing the float…");
        const answer = JSON.stringify({ resolutions: [{ id: "g1", outcome: "gold rises", telling: "t", reasoning: "r", closes: true }] });
        onToken?.(answer);
        return answer;
      },
    );
    const progress: string[] = [];
    const [r] = await resolveConflictRealism({ conflicts: [conflict()], onProgress: (t) => progress.push(t) });
    expect(callGenerateStream).toHaveBeenCalled();
    expect(callGenerate).not.toHaveBeenCalled();
    expect(progress.join("")).toContain("weighing the float"); // reasoning surfaced
    expect(r.outcome).toBe("gold rises");
    expect(r.closes).toBe(true);
  });
});
