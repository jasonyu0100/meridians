/**
 * Time delta helpers.
 *
 * Scenes are instants; the gap between consecutive scenes is a TimeDelta
 * ({value, unit}). `value: 0` marks a concurrent scene (same moment as the
 * prior scene — parallel POV, cutaway, or simultaneous vantage). Negative
 * values mark flashbacks — the next scene sits at an earlier point on the
 * timeline. A flashback that returns to "now" needs a positive timeDelta
 * roughly cancelling the jump back, so the cumulative offset realigns.
 *
 * Time is tracked relative to the first scene only — there is no absolute
 * calendar anchor. Offsets give scale ("T+2 weeks", "T-3 years") without
 * claiming real-world dates.
 *
 * Months and years use average lengths (30.44 days / 365.25 days) — good
 * enough for narrative pacing and financial bucket alignment, but do not
 * treat the seconds value as an exact wall-clock duration.
 */

import type { Scene, TimeDelta, TimeUnit } from "@/types/narrative";

/** Average seconds per unit. Months = 30.44 days, years = 365.25 days. */
export const SECONDS_PER_UNIT: Record<TimeUnit, number> = {
  minute: 60,
  hour: 60 * 60,
  day: 60 * 60 * 24,
  week: 60 * 60 * 24 * 7,
  month: Math.round(60 * 60 * 24 * 30.44),
  year: Math.round(60 * 60 * 24 * 365.25),
};

/** Units ordered small → large, for picking a readable display unit. */
export const TIME_UNITS_ASCENDING: TimeUnit[] = [
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year",
];

export function timeDeltaToSeconds(d: TimeDelta): number {
  return d.value * SECONDS_PER_UNIT[d.unit];
}

/** Validate a parsed timeDelta from LLM output. Returns null for missing /
 *  malformed entries. Accepts plural unit forms ("weeks", "days") and
 *  lowercases them so downstream code always sees a canonical singular unit.
 *  Negative values are valid (flashbacks — earlier on the timeline).
 *  Use at every LLM boundary — generation, analysis, reconstruction. */
export function normalizeTimeDelta(raw: unknown): TimeDelta | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { value?: unknown; unit?: unknown; transition?: unknown };
  const value = typeof r.value === "number" ? r.value : Number(r.value);
  if (!Number.isFinite(value)) return null;
  if (typeof r.unit !== "string") return null;
  const singular = r.unit.toLowerCase().replace(/s$/, "");
  if (
    singular !== "minute" &&
    singular !== "hour" &&
    singular !== "day" &&
    singular !== "week" &&
    singular !== "month" &&
    singular !== "year"
  ) {
    return null;
  }
  const transition = typeof r.transition === "string" && r.transition.trim()
    ? r.transition.trim()
    : undefined;
  return transition
    ? { value: Math.round(value), unit: singular, transition }
    : { value: Math.round(value), unit: singular };
}

/** Format a time delta as "3 days", "2 hours", "concurrent" (value=0),
 *  "back 5 years" (negative — flashback), or "—" when unspecified. Pluralises
 *  naively (s-suffix). Tolerates LLM output where the unit is already plural
 *  ("weeks") by stripping a trailing "s" before re-pluralising. */
export function formatTimeDelta(
  d: TimeDelta | null | undefined,
): string {
  if (!d) return "—";
  if (d.value === 0) return "concurrent";
  const singular = d.unit.endsWith("s")
    ? (d.unit.slice(0, -1) as TimeUnit)
    : d.unit;
  const abs = Math.abs(d.value);
  const unit = abs === 1 ? singular : `${singular}s`;
  if (d.value < 0) return `back ${abs} ${unit}`;
  return `${d.value} ${unit}`;
}

/** Format a cumulative offset (seconds from origin) by picking the largest
 *  unit whose value is ≥ 1. "0s" collapses to "origin"; negative values
 *  format as "before-origin <unit>" (a flashback that crosses the origin). */
export function formatCumulative(seconds: number): string {
  if (seconds === 0) return "origin";
  const sign = seconds < 0 ? "before-origin " : "";
  const abs = Math.abs(seconds);
  for (let i = TIME_UNITS_ASCENDING.length - 1; i >= 0; i--) {
    const unit = TIME_UNITS_ASCENDING[i];
    const per = SECONDS_PER_UNIT[unit];
    if (abs >= per) {
      const value = abs / per;
      const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
      const label = rounded === 1 ? unit : `${unit}s`;
      return `${sign}${rounded} ${label}`;
    }
  }
  return seconds < 0 ? "before-origin (sub-minute)" : "origin";
}

/** Human-readable description of the time gap into a scene.
 *
 *  Guiding principle: good storytelling weaves the passage of time into
 *  narrative texture — light, weather, wear, mood, what's changed — so the
 *  reader always FEELS time moving without ever reading it as a log entry
 *  or timestamp. The size of the gap shifts how visible the weaving is, not
 *  whether it happens:
 *
 *    concurrent / sub-hour / same-day → texture-only (no explicit marker)
 *    multi-day / multi-week           → woven cue (light, weather, status)
 *    multi-month                      → MAJOR — anchor explicitly
 *    year+                            → GENERATIONAL — must mark with weight
 *
 *  Surfaced through sceneContext so every downstream LLM call sees it. */
export function describeTimeGap(d: TimeDelta | null | undefined): string {
  if (!d) {
    return "Unspecified — treat as ordinary scene continuity.";
  }
  if (d.value === 0) {
    return "Concurrent or opening — same moment as the prior scene (parallel POV / cutaway) OR the very first scene. No explicit time marker; let the prose continue uninterrupted.";
  }
  if (d.value < 0) {
    const elapsed = formatTimeDelta(d);
    return `${elapsed} — FLASHBACK to an earlier point on the timeline. Anchor the jump explicitly so the reader knows we've moved backward (a memory triggered, an excerpt from earlier records, an embedded dispatch from before the prior scene). The next scene's timeDelta should bring the cumulative offset roughly back to where it was, unless the work continues in the past.`;
  }
  const seconds = timeDeltaToSeconds(d);
  const elapsed = formatTimeDelta(d);
  // < 1 hour — texture-only
  if (seconds < 60 * 60) {
    return `${elapsed} since the prior scene. Continuous time. Weave any change through texture (a candle now lit, a chair pushed back, the conversation already further along) — never as a timestamp.`;
  }
  // < 1 day — texture-only
  if (seconds < 60 * 60 * 24) {
    return `${elapsed} since the prior scene. Same-day jump. Let the reader feel it through light, mood, fatigue, or hunger — woven into the opening, never announced. No "X hours later" log entries.`;
  }
  // < 1 week — woven cue
  if (seconds < 60 * 60 * 24 * 7) {
    return `${elapsed} since the prior scene. Multi-day jump. Signal through narrative texture (weather changed, a character now visibly tired, a routine resumed, a message received) — woven, not announced. The reader should feel the gap, not be told.`;
  }
  // < 1 month — woven cue, more visible
  if (seconds < 60 * 60 * 24 * 30) {
    return `${elapsed} since the prior scene. Multi-week jump. Weave a clearer signal — a season turning, a project moved on, a wound healing, a habit settled. Still texture, not statement: the reader registers the elapsed time without being told a number.`;
  }
  // < 1 year — MAJOR
  if (seconds < 60 * 60 * 24 * 365) {
    return `${elapsed} since the prior scene. MAJOR jump — weight it. Open with a re-anchor: a status update, a changed season, a wound now scar, a plan now bearing fruit. Naming the elapsed time directly is permitted here when it carries narrative force ("By autumn, …").`;
  }
  // ≥ 1 year — GENERATIONAL
  return `${elapsed} since the prior scene. GENERATIONAL jump — must be acknowledged with weight. A montage paragraph, an aged-up description, an environmental change that visibly shows time has passed. The reader needs to feel the years; understatement here reads as a continuity error.`;
}

/** Compute cumulative seconds-from-origin for a sequence of scenes in branch
 *  order. Scenes with null/absent deltas contribute 0 to the cumulative
 *  offset (they inherit the prior scene's timestamp). The first scene is
 *  always at offset 0. */
export function computeSceneOffsets(scenes: Scene[]): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (let i = 0; i < scenes.length; i++) {
    if (i === 0) {
      offsets.push(0);
      continue;
    }
    const d = scenes[i].timeDelta;
    if (d) acc += timeDeltaToSeconds(d);
    offsets.push(acc);
  }
  return offsets;
}
