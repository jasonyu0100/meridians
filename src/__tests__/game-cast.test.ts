import { beforeEach, describe, expect, it, vi } from "vitest";

// The cast suggestion wraps one LLM call; mock it so we test the pure
// parse + validation contract (which picks survive), not the model.
vi.mock("@/lib/ai/api", () => ({ callGenerate: vi.fn() }));

import { callGenerate } from "@/lib/ai/api";
import { suggestTableCast } from "@/lib/ai/game-cast";

const mockReturn = (raw: string) => vi.mocked(callGenerate).mockResolvedValue(raw);

describe("suggestTableCast — pick validation", () => {
  beforeEach(() => vi.mocked(callGenerate).mockReset());

  it("keeps well-formed picks, trims reasons, drops the rest", async () => {
    mockReturn(
      JSON.stringify({
        picks: [
          { id: "C-1", kind: "character", reason: "  the rival  " },
          { id: "L-2", kind: "location", reason: "contested ground" },
          { id: "", kind: "character", reason: "empty id" }, // drop — no id
          { id: "A-3", kind: "weapon", reason: "bad kind" }, // drop — invalid kind
          { id: "A-4", kind: "artifact" }, // kept; reason defaults to ""
          "garbage", // drop — not an object
        ],
      }),
    );
    const out = await suggestTableCast({ roster: "CHARACTERS:\n- [C-1] X (anchor)" });
    expect(out).toEqual([
      { id: "C-1", kind: "character", reason: "the rival" },
      { id: "L-2", kind: "location", reason: "contested ground" },
      { id: "A-4", kind: "artifact", reason: "" },
    ]);
  });

  it("returns [] when the model gives no usable picks array", async () => {
    mockReturn("{}");
    expect(await suggestTableCast({ roster: "ROSTER" })).toEqual([]);
  });

  it("passes the synopsis + roster into the prompt", async () => {
    mockReturn(JSON.stringify({ picks: [] }));
    await suggestTableCast({ roster: "ROSTER-X", recentSynopsis: "SYNOPSIS-Y" });
    const userPrompt = vi.mocked(callGenerate).mock.calls[0][0];
    expect(userPrompt).toContain("ROSTER-X");
    expect(userPrompt).toContain("SYNOPSIS-Y");
  });
});
