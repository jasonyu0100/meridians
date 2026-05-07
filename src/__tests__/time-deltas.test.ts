import { describe, expect, test } from "vitest";
import {
  SECONDS_PER_UNIT,
  computeSceneOffsets,
  describeTimeGap,
  formatCumulative,
  formatTimeDelta,
  normalizeTimeDelta,
  timeDeltaToSeconds,
} from "@/lib/time-deltas";
import type { Scene, TimeDelta } from "@/types/narrative";

// Minimal scene factory — only the fields required by time-delta logic.
function makeScene(id: string, timeDelta?: TimeDelta | null): Scene {
  return {
    kind: "scene",
    id,
    arcId: "a1",
    locationId: "l1",
    povId: "c1",
    participantIds: [],
    events: [],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    summary: "",
    timeDelta,
  };
}

describe("timeDeltaToSeconds", () => {
  test("converts each unit using SECONDS_PER_UNIT", () => {
    expect(timeDeltaToSeconds({ value: 1, unit: "minute" })).toBe(60);
    expect(timeDeltaToSeconds({ value: 1, unit: "hour" })).toBe(3_600);
    expect(timeDeltaToSeconds({ value: 1, unit: "day" })).toBe(86_400);
    expect(timeDeltaToSeconds({ value: 1, unit: "week" })).toBe(604_800);
    expect(timeDeltaToSeconds({ value: 1, unit: "month" })).toBe(
      SECONDS_PER_UNIT.month,
    );
    expect(timeDeltaToSeconds({ value: 1, unit: "year" })).toBe(
      SECONDS_PER_UNIT.year,
    );
  });

  test("scales linearly with value — 3 days = 3 × 1 day", () => {
    expect(timeDeltaToSeconds({ value: 3, unit: "day" })).toBe(3 * 86_400);
  });

  test("value 0 returns 0 seconds (concurrent)", () => {
    expect(timeDeltaToSeconds({ value: 0, unit: "minute" })).toBe(0);
    expect(timeDeltaToSeconds({ value: 0, unit: "year" })).toBe(0);
  });

  test("year > month > week > day > hour > minute", () => {
    const { year, month, week, day, hour, minute } = SECONDS_PER_UNIT;
    expect(year).toBeGreaterThan(month);
    expect(month).toBeGreaterThan(week);
    expect(week).toBeGreaterThan(day);
    expect(day).toBeGreaterThan(hour);
    expect(hour).toBeGreaterThan(minute);
  });
});

describe("formatTimeDelta", () => {
  test("null / undefined renders as em-dash", () => {
    expect(formatTimeDelta(null)).toBe("—");
    expect(formatTimeDelta(undefined)).toBe("—");
  });

  test("value 0 renders as 'concurrent' regardless of unit", () => {
    expect(formatTimeDelta({ value: 0, unit: "minute" })).toBe("concurrent");
    expect(formatTimeDelta({ value: 0, unit: "year" })).toBe("concurrent");
  });

  test("value 1 is singular", () => {
    expect(formatTimeDelta({ value: 1, unit: "day" })).toBe("1 day");
  });

  test("value > 1 pluralises with s-suffix", () => {
    expect(formatTimeDelta({ value: 3, unit: "day" })).toBe("3 days");
    expect(formatTimeDelta({ value: 2, unit: "week" })).toBe("2 weeks");
  });

  test("tolerates already-plural unit from LLM (no double-s)", () => {
    // Cast to bypass the TypeScript narrowing — at runtime the LLM may
    // return "weeks" / "days" instead of the canonical singular form.
    expect(formatTimeDelta({ value: 2, unit: "weeks" as never })).toBe("2 weeks");
    expect(formatTimeDelta({ value: 1, unit: "days" as never })).toBe("1 day");
  });
});

describe("formatCumulative", () => {
  test("zero collapses to 'origin'; negatives format as before-origin (flashbacks past the start)", () => {
    expect(formatCumulative(0)).toBe("origin");
    expect(formatCumulative(-5)).toBe("before-origin (sub-minute)");
    expect(formatCumulative(-3_600)).toBe("before-origin 1 hour");
  });

  test("picks the largest unit whose value is ≥ 1", () => {
    expect(formatCumulative(90)).toBe("1.5 minutes");
    expect(formatCumulative(3_600)).toBe("1 hour");
    expect(formatCumulative(86_400)).toBe("1 day");
    expect(formatCumulative(7 * 86_400)).toBe("1 week");
  });

  test("rounds to 1 decimal under 10, integer at or above 10", () => {
    // 1.5 days → "1.5 days"
    expect(formatCumulative(1.5 * 86_400)).toBe("1.5 days");
    // 12.3 hours stays under a day → rounds to "12 hours" (≥10 strips decimal)
    expect(formatCumulative(12.3 * 3_600)).toBe("12 hours");
  });
});

describe("normalizeTimeDelta", () => {
  test("returns null for missing or non-object input", () => {
    expect(normalizeTimeDelta(null)).toBeNull();
    expect(normalizeTimeDelta(undefined)).toBeNull();
    expect(normalizeTimeDelta("3 days")).toBeNull();
    expect(normalizeTimeDelta(42)).toBeNull();
  });

  test("returns null for malformed shape", () => {
    expect(normalizeTimeDelta({ value: "x", unit: "day" })).toBeNull();
    expect(normalizeTimeDelta({ value: 1, unit: 42 })).toBeNull();
    expect(normalizeTimeDelta({ value: 1, unit: "fortnight" })).toBeNull();
  });

  test("accepts negative values (flashbacks)", () => {
    expect(normalizeTimeDelta({ value: -1, unit: "day" })).toEqual({
      value: -1,
      unit: "day",
    });
    expect(normalizeTimeDelta({ value: -20, unit: "year", transition: "years before, when she was a child" })).toEqual({
      value: -20,
      unit: "year",
      transition: "years before, when she was a child",
    });
  });

  test("preserves a transition string when supplied; drops empty / non-string", () => {
    expect(normalizeTimeDelta({ value: 1, unit: "day", transition: "the next morning" })).toEqual({
      value: 1,
      unit: "day",
      transition: "the next morning",
    });
    expect(normalizeTimeDelta({ value: 1, unit: "day", transition: "  " })).toEqual({
      value: 1,
      unit: "day",
    });
    expect(normalizeTimeDelta({ value: 1, unit: "day", transition: 42 })).toEqual({
      value: 1,
      unit: "day",
    });
  });

  test("accepts singular units", () => {
    expect(normalizeTimeDelta({ value: 1, unit: "day" })).toEqual({
      value: 1,
      unit: "day",
    });
  });

  test("strips plural s and lowercases", () => {
    expect(normalizeTimeDelta({ value: 3, unit: "Weeks" })).toEqual({
      value: 3,
      unit: "week",
    });
    expect(normalizeTimeDelta({ value: 7, unit: "DAYS" })).toEqual({
      value: 7,
      unit: "day",
    });
  });

  test("rounds non-integer values to integer", () => {
    expect(normalizeTimeDelta({ value: 2.7, unit: "hour" })).toEqual({
      value: 3,
      unit: "hour",
    });
  });
});

describe("describeTimeGap", () => {
  test("null / undefined returns ordinary continuity prose", () => {
    expect(describeTimeGap(null)).toMatch(/unspecified/i);
    expect(describeTimeGap(undefined)).toMatch(/unspecified/i);
  });

  test("value 0 (concurrent / opening) frames as continuous — no time marker", () => {
    const text = describeTimeGap({ value: 0, unit: "minute" });
    expect(text).toMatch(/concurrent|opening/i);
    expect(text).toMatch(/no explicit time marker|uninterrupted/i);
  });

  test("sub-hour gaps are texture-only — never timestamps", () => {
    const text = describeTimeGap({ value: 30, unit: "minute" });
    expect(text).toMatch(/continuous time/i);
    expect(text).toMatch(/texture|never as a timestamp/i);
  });

  test("same-day gaps weave through light / mood — no announced time", () => {
    const text = describeTimeGap({ value: 6, unit: "hour" });
    expect(text).toMatch(/same-day/i);
    expect(text).toMatch(/woven|never announced|no.*log/i);
  });

  test("multi-day gaps signal through narrative texture, not announcement", () => {
    const text = describeTimeGap({ value: 3, unit: "day" });
    expect(text).toMatch(/multi-day/i);
    expect(text).toMatch(/woven|texture|not announced/i);
  });

  test("multi-week gaps weave a clearer signal but still texture", () => {
    const text = describeTimeGap({ value: 2, unit: "week" });
    expect(text).toMatch(/multi-week/i);
    expect(text).toMatch(/texture|not statement|registers/i);
  });

  test("multi-month gaps are MAJOR — re-anchor and may name the time directly", () => {
    const text = describeTimeGap({ value: 6, unit: "month" });
    expect(text).toMatch(/major/i);
    expect(text).toMatch(/re-anchor|naming the elapsed time|status update/i);
  });

  test("year-scale gaps are GENERATIONAL — must be acknowledged with weight", () => {
    const text = describeTimeGap({ value: 5, unit: "year" });
    expect(text).toMatch(/generational/i);
    expect(text).toMatch(/montage|aged-up|continuity error/i);
  });

  test("includes the formatted elapsed time in non-null cases", () => {
    expect(describeTimeGap({ value: 3, unit: "day" })).toContain("3 days");
    expect(describeTimeGap({ value: 1, unit: "week" })).toContain("1 week");
  });
});

describe("computeSceneOffsets", () => {
  test("first scene is always at offset 0", () => {
    const scenes = [
      makeScene("s1", { value: 5, unit: "day" }),
      makeScene("s2", { value: 2, unit: "day" }),
    ];
    const offsets = computeSceneOffsets(scenes);
    // s1's delta is ignored because there is no prior scene.
    expect(offsets[0]).toBe(0);
  });

  test("accumulates time-delta seconds in order", () => {
    const scenes = [
      makeScene("s1"),
      makeScene("s2", { value: 1, unit: "day" }),
      makeScene("s3", { value: 2, unit: "day" }),
      makeScene("s4", { value: 1, unit: "week" }),
    ];
    const offsets = computeSceneOffsets(scenes);
    expect(offsets).toEqual([
      0,
      86_400, // +1 day
      86_400 + 2 * 86_400, // +2 days
      86_400 + 2 * 86_400 + 7 * 86_400, // +1 week
    ]);
  });

  test("null / absent delta contributes 0 (scene inherits prior offset)", () => {
    const scenes = [
      makeScene("s1"),
      makeScene("s2", { value: 1, unit: "day" }),
      makeScene("s3", null), // unspecified
      makeScene("s4", { value: 1, unit: "day" }),
    ];
    const offsets = computeSceneOffsets(scenes);
    expect(offsets).toEqual([0, 86_400, 86_400, 2 * 86_400]);
  });

  test("value 0 (concurrent) keeps the offset identical to prior", () => {
    const scenes = [
      makeScene("s1"),
      makeScene("s2", { value: 1, unit: "day" }),
      makeScene("s3", { value: 0, unit: "minute" }), // simultaneous cut
      makeScene("s4", { value: 2, unit: "hour" }),
    ];
    const offsets = computeSceneOffsets(scenes);
    expect(offsets[1]).toBe(offsets[2]); // concurrent → same timestamp
    expect(offsets[3]).toBe(offsets[2] + 2 * 3_600);
  });

  test("empty input returns empty array", () => {
    expect(computeSceneOffsets([])).toEqual([]);
  });
});
