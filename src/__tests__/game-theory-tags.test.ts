/**
 * Behavioural-tag classifier coverage for the Game Theory Dashboard.
 *
 * The pure stake/ELO math lives in game-theory.test.ts. This file covers the
 * player-level classifier in GameTheoryDashboard — specifically the SOLO
 * decision tags (soloist / sure-handed / gambler) and the solo decision-axis
 * affinity tag (`solo: <axis>`), which surfaces the characteristic dimension
 * of a player's bets against the world. Timing is the load-bearing case:
 * a solo timing decision is a player against the clock.
 */

import {
  aggregate,
  classifyPlayer,
  type PlayerProfile,
} from "@/components/topbar/GameTheoryDashboard";
import type {
  ActionAxis,
  BeatGame,
  NarrativeState,
  Scene,
} from "@/types/narrative";
import { describe, expect, it } from "vitest";

// ── Profile fixture ─────────────────────────────────────────────────────────
// Neutral baseline: enough games to clear ARCHETYPE_MIN_GAMES, flat ELO, no
// outcome-shape signal. Tests override only the fields under test, so other
// tag groups stay quiet and assertions target one tag id at a time.

function makeProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    id: "C-1",
    name: "Test",
    currentElo: 1500,
    peakElo: 1500,
    troughElo: 1500,
    eloHistory: [1500, 1500],
    eloVolatility: 10,
    games: 6,
    wins: 2,
    losses: 2,
    draws: 2,
    avgStakeDelta: 0,
    avgStakeAdvantage: 0,
    positiveCells: 0,
    negativeCells: 0,
    cellsBothGain: 0,
    cellsBothLose: 0,
    cellsSelfGainOtherLose: 0,
    cellsSelfLoseOtherGain: 0,
    sumRealizedRank: 0,
    sumRealizedRankTotal: 0,
    realizedNashCount: 0,
    asRoleA: 3,
    asRoleB: 3,
    soloGames: 0,
    soloTookBest: 0,
    soloStakeSum: 0,
    soloAxisCounts: new Map(),
    gameTypeCounts: new Map(),
    axisCounts: new Map(),
    earlyGames: 0,
    lateGames: 0,
    earlyStakeSum: 0,
    lateStakeSum: 0,
    nemesisName: null,
    nemesisNetScore: 0,
    patronName: null,
    patronNetScore: 0,
    opponentCounts: new Map(),
    biggestUpset: null,
    ...overrides,
  };
}

const ids = (tags: ReturnType<typeof classifyPlayer>): string[] =>
  tags.map((t) => t.id);
const has = (tags: ReturnType<typeof classifyPlayer>, id: string): boolean =>
  tags.some((t) => t.id === id);
const tag = (tags: ReturnType<typeof classifyPlayer>, id: string) =>
  tags.find((t) => t.id === id);

function axisMap(entries: Partial<Record<ActionAxis, number>>): Map<ActionAxis, number> {
  return new Map(Object.entries(entries) as [ActionAxis, number][]);
}

// ── Solo decision-axis affinity ─────────────────────────────────────────────

describe("classifyPlayer — solo decision axis", () => {
  it("emits `solo: timing` when timing dominates a player's solo bets", () => {
    const tags = classifyPlayer(
      makeProfile({ soloGames: 4, soloAxisCounts: axisMap({ timing: 3, commitment: 1 }) }),
    );
    expect(has(tags, "solo-axis-timing")).toBe(true);
    const t = tag(tags, "solo-axis-timing")!;
    expect(t.label).toBe("solo: timing");
    // The timing phrase names the clock as the silent counterpart.
    expect(t.description.toLowerCase()).toContain("clock");
  });

  it("crowns whichever axis dominates the solo bets (commitment)", () => {
    const tags = classifyPlayer(
      makeProfile({ soloGames: 4, soloAxisCounts: axisMap({ commitment: 4 }) }),
    );
    expect(has(tags, "solo-axis-commitment")).toBe(true);
    expect(has(tags, "solo-axis-timing")).toBe(false);
  });

  it("fires at exactly the affinity threshold (50% of solo bets)", () => {
    // 2 of 4 timing = 0.5 — boundary is inclusive.
    const tags = classifyPlayer(
      makeProfile({ soloGames: 4, soloAxisCounts: axisMap({ timing: 2, stakes: 2 }) }),
    );
    expect(has(tags, "solo-axis-timing")).toBe(true);
  });

  it("stays quiet when no single axis dominates the solo bets", () => {
    // 2 of 5 = 0.4 < threshold.
    const tags = classifyPlayer(
      makeProfile({ soloGames: 5, soloAxisCounts: axisMap({ timing: 2, commitment: 2, stakes: 1 }) }),
    );
    expect(ids(tags).some((id) => id.startsWith("solo-axis-"))).toBe(false);
  });

  it("stays quiet below the minimum solo-game count", () => {
    const tags = classifyPlayer(
      makeProfile({ soloGames: 1, soloAxisCounts: axisMap({ timing: 1 }) }),
    );
    expect(ids(tags).some((id) => id.startsWith("solo-axis-"))).toBe(false);
  });

  it("reads solo bets only — duel axis affinity does not leak in", () => {
    // Pooled axisCounts is timing-heavy, but the SOLO bets are commitment.
    // The solo tag must reflect the solo decisions, not the duels.
    const tags = classifyPlayer(
      makeProfile({
        soloGames: 3,
        soloAxisCounts: axisMap({ commitment: 3 }),
        axisCounts: axisMap({ timing: 10, commitment: 3 }),
      }),
    );
    expect(has(tags, "solo-axis-commitment")).toBe(true);
    expect(has(tags, "solo-axis-timing")).toBe(false);
  });
});

// ── Solo decision style (existing tags — lock current behaviour) ─────────────

describe("classifyPlayer — solo decision style", () => {
  it("tags a soloist when most consequential calls are made alone", () => {
    const tags = classifyPlayer(makeProfile({ games: 6, soloGames: 4, soloTookBest: 2 }));
    expect(has(tags, "soloist")).toBe(true);
  });

  it("tags sure-handed when they usually take the stake-best option", () => {
    const tags = classifyPlayer(makeProfile({ soloGames: 4, soloTookBest: 4 }));
    expect(has(tags, "sure-handed")).toBe(true);
    expect(has(tags, "gambler")).toBe(false);
  });

  it("tags gambler when they routinely pass up the stake-best option", () => {
    const tags = classifyPlayer(makeProfile({ soloGames: 3, soloTookBest: 0 }));
    expect(has(tags, "gambler")).toBe(true);
    expect(has(tags, "sure-handed")).toBe(false);
  });

  it("emits no solo tags at all below the 2-game floor", () => {
    const tags = classifyPlayer(
      makeProfile({ soloGames: 1, soloTookBest: 1, soloAxisCounts: axisMap({ timing: 1 }) }),
    );
    expect(has(tags, "soloist")).toBe(false);
    expect(has(tags, "sure-handed")).toBe(false);
    expect(has(tags, "gambler")).toBe(false);
    expect(ids(tags).some((id) => id.startsWith("solo-axis-"))).toBe(false);
  });
});

describe("classifyPlayer — guard", () => {
  it("returns no tags below the minimum game count", () => {
    expect(classifyPlayer(makeProfile({ games: 2 }))).toEqual([]);
  });
});

// ── End-to-end: aggregation populates soloAxisCounts from real scenes ────────

function soloTimingGame(beatIndex: number): BeatGame {
  return {
    beatIndex,
    beatExcerpt: "decides whether to move now or hold",
    kind: "solo",
    gameType: "trivial",
    actionAxis: "timing",
    playerAId: "C-7",
    playerAName: "Decider",
    playerAActions: [{ name: "act now" }, { name: "wait" }],
    playerBActions: [],
    outcomes: [
      { aActionName: "act now", description: "", stakeDeltaA: 2 },
      { aActionName: "wait", description: "", stakeDeltaA: 1 },
    ],
    realizedAAction: "act now",
    rationale: "moved while the window was open",
  };
}

function makeScene(id: string, arcId: string, games: BeatGame[]): Scene {
  return {
    kind: "scene",
    id,
    arcId,
    locationId: "L-1",
    povId: "C-7",
    participantIds: ["C-7"],
    summary: "",
    events: [],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    gameAnalysis: { games, generatedAt: 0 },
  };
}

function makeNarrative(scenes: Record<string, Scene>): NarrativeState {
  return {
    id: "test",
    title: "t",
    description: "",
    characters: {},
    locations: {},
    artifacts: {},
    threads: {},
    arcs: {},
    scenes,
    worldBuilds: {},
    branches: {},
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: "",
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("aggregate — solo timing decisions end to end", () => {
  it("tallies soloAxisCounts from scene gameAnalysis and the tag fires", () => {
    // Three solo timing decisions for one decider across two scenes — enough
    // to clear both the solo floor (2) and the classifier floor (3 games).
    const scenes = {
      "S-1": makeScene("S-1", "ARC-1", [soloTimingGame(0), soloTimingGame(1)]),
      "S-2": makeScene("S-2", "ARC-1", [soloTimingGame(0)]),
    };
    const agg = aggregate(makeNarrative(scenes), ["S-1", "S-2"]);
    const decider = agg.profiles.find((p) => p.id === "C-7");
    expect(decider).toBeDefined();
    expect(decider!.soloGames).toBe(3);
    expect(decider!.games).toBe(3);
    expect(decider!.soloAxisCounts.get("timing")).toBe(3);

    const tags = classifyPlayer(decider!);
    expect(has(tags, "solo-axis-timing")).toBe(true);
    expect(has(tags, "soloist")).toBe(true);
  });
});
