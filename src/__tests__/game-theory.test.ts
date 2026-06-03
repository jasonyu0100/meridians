import {
  actionNames,
  arcCost,
  columnOutcomes,
  computeEloHistories,
  ELO_INITIAL,
  ELO_K,
  ELO_PAR,
  eloUpdate,
  expectedScore,
  gameMarginScore,
  gameScoreA,
  isGridComplete,
  isSolo,
  nashEquilibria,
  outcomeAt,
  realizedIsNash,
  realizedOutcome,
  resolvePlayerName,
  rowOutcomes,
  stakeRank,
} from "@/lib/game-theory";
import {
  ACTION_AXIS_LABELS,
  GAME_TYPE_LABELS,
} from "@/types/narrative";
import type {
  ActionAxis,
  BeatGame,
  GameOutcome,
  GameType,
  NarrativeState,
  PlayerAction,
} from "@/types/narrative";
import { describe, expect, it } from "vitest";

// ── Test Fixtures ────────────────────────────────────────────────────────────

function cell(
  a: string,
  b: string,
  stakeDeltaA: number,
  stakeDeltaB: number,
  description = "",
): GameOutcome {
  return { aActionName: a, bActionName: b, description, stakeDeltaA, stakeDeltaB };
}

function createGame(overrides: Partial<BeatGame> = {}): BeatGame {
  const aActions: PlayerAction[] = [{ name: "reveal" }, { name: "conceal" }];
  const bActions: PlayerAction[] = [{ name: "press" }, { name: "yield" }];
  const outcomes: GameOutcome[] = [
    cell("reveal", "press", 2, 1),
    cell("reveal", "yield", 3, 0),
    cell("conceal", "press", 0, 3),
    cell("conceal", "yield", 1, 2),
  ];
  return {
    beatIndex: 0,
    beatExcerpt: "test beat",
    gameType: "coordination",
    actionAxis: "information",
    playerAId: "C-1",
    playerAName: "Alice",
    playerAActions: aActions,
    playerBId: "C-2",
    playerBName: "Bob",
    playerBActions: bActions,
    outcomes,
    realizedAAction: "reveal",
    realizedBAction: "press",
    rationale: "test rationale",
    ...overrides,
  };
}

// ── Outcome Lookup ──────────────────────────────────────────────────────────

describe("outcomeAt", () => {
  it("finds the cell for a matching (A, B) action pair", () => {
    const game = createGame();
    const o = outcomeAt(game, "conceal", "press");
    expect(o).not.toBeNull();
    expect(o?.stakeDeltaA).toBe(0);
    expect(o?.stakeDeltaB).toBe(3);
  });
  it("returns null when no cell matches", () => {
    const game = createGame();
    expect(outcomeAt(game, "reveal", "shout")).toBeNull();
    expect(outcomeAt(game, "shrug", "press")).toBeNull();
  });
});

describe("realizedOutcome", () => {
  it("returns the cell the author actually wrote", () => {
    const game = createGame({ realizedAAction: "conceal", realizedBAction: "yield" });
    const o = realizedOutcome(game);
    expect(o?.aActionName).toBe("conceal");
    expect(o?.bActionName).toBe("yield");
    expect(o?.stakeDeltaA).toBe(1);
    expect(o?.stakeDeltaB).toBe(2);
  });
  it("returns null when realized action names don't resolve to a cell", () => {
    const game = createGame({ realizedAAction: "nonexistent" });
    expect(realizedOutcome(game)).toBeNull();
  });
});

// ── Nash Equilibria ─────────────────────────────────────────────────────────

describe("nashEquilibria", () => {
  it("finds the unique Nash cell in a dominance-solvable 2x2", () => {
    // A prefers reveal regardless of B; B prefers press when A reveals.
    // Unique NE: (reveal, press).
    const game = createGame({
      outcomes: [
        cell("reveal", "press", 3, 3),
        cell("reveal", "yield", 2, 1),
        cell("conceal", "press", 1, 2),
        cell("conceal", "yield", 0, 0),
      ],
    });
    const ne = nashEquilibria(game);
    expect(ne).toHaveLength(1);
    expect(ne[0]).toEqual({ aActionName: "reveal", bActionName: "press" });
  });

  it("finds both coordination equilibria in a stag-hunt grid", () => {
    // Stag-hunt: two pure-strategy equilibria (stag,stag) and (hare,hare).
    const game = createGame({
      playerAActions: [{ name: "stag" }, { name: "hare" }],
      playerBActions: [{ name: "stag" }, { name: "hare" }],
      outcomes: [
        cell("stag", "stag", 4, 4),
        cell("stag", "hare", 0, 2),
        cell("hare", "stag", 2, 0),
        cell("hare", "hare", 2, 2),
      ],
      realizedAAction: "stag",
      realizedBAction: "stag",
    });
    const ne = nashEquilibria(game);
    const keys = ne.map((p) => `${p.aActionName}:${p.bActionName}`).sort();
    expect(keys).toEqual(["hare:hare", "stag:stag"]);
  });

  it("returns empty when no cell is self-reinforcing (matching pennies)", () => {
    // Classic zero-sum game with no pure-strategy NE.
    const game = createGame({
      playerAActions: [{ name: "heads" }, { name: "tails" }],
      playerBActions: [{ name: "heads" }, { name: "tails" }],
      outcomes: [
        cell("heads", "heads", 1, -1),
        cell("heads", "tails", -1, 1),
        cell("tails", "heads", -1, 1),
        cell("tails", "tails", 1, -1),
      ],
      realizedAAction: "heads",
      realizedBAction: "heads",
    });
    expect(nashEquilibria(game)).toHaveLength(0);
  });

  it("treats ties as weak Nash (tied best responses still qualify)", () => {
    // Tie rows: A indifferent between reveal and conceal when B presses.
    // Both rows tie B-stable as well — expect all four cells self-stable.
    const game = createGame({
      outcomes: [
        cell("reveal", "press", 1, 1),
        cell("reveal", "yield", 1, 1),
        cell("conceal", "press", 1, 1),
        cell("conceal", "yield", 1, 1),
      ],
    });
    const ne = nashEquilibria(game);
    expect(ne).toHaveLength(4);
  });

  it("handles asymmetric NxM grids", () => {
    // 3x2: A has a strictly dominant "attack" row; B's best response is "defend".
    const game = createGame({
      playerAActions: [{ name: "attack" }, { name: "feint" }, { name: "retreat" }],
      playerBActions: [{ name: "defend" }, { name: "open" }],
      outcomes: [
        cell("attack", "defend", 4, 0),
        cell("attack", "open", 3, -1),
        cell("feint", "defend", 1, 2),
        cell("feint", "open", 2, 1),
        cell("retreat", "defend", 0, 3),
        cell("retreat", "open", 0, 2),
      ],
      realizedAAction: "attack",
      realizedBAction: "defend",
    });
    const ne = nashEquilibria(game);
    expect(ne).toEqual([{ aActionName: "attack", bActionName: "defend" }]);
  });
});

describe("realizedIsNash", () => {
  it("returns true when realized cell is a pure-strategy NE", () => {
    const game = createGame({
      outcomes: [
        cell("reveal", "press", 3, 3),
        cell("reveal", "yield", 2, 1),
        cell("conceal", "press", 1, 2),
        cell("conceal", "yield", 0, 0),
      ],
      realizedAAction: "reveal",
      realizedBAction: "press",
    });
    expect(realizedIsNash(game)).toBe(true);
  });
  it("returns false when the author landed off-equilibrium", () => {
    // (reveal, press) is NE. Author picked (conceal, yield) instead — a
    // strictly dominated cell. This is the interesting case the evaluator
    // exists to surface.
    const game = createGame({
      outcomes: [
        cell("reveal", "press", 3, 3),
        cell("reveal", "yield", 2, 1),
        cell("conceal", "press", 1, 2),
        cell("conceal", "yield", 0, 0),
      ],
      realizedAAction: "conceal",
      realizedBAction: "yield",
    });
    expect(realizedIsNash(game)).toBe(false);
  });
});

// ── W/L/D scoring ───────────────────────────────────────────────────────────

describe("gameScoreA", () => {
  it("returns 1 when A's stake strictly exceeds B's", () => {
    const game = createGame({ realizedAAction: "reveal", realizedBAction: "yield" });
    // (3, 0) — A wins
    expect(gameScoreA(game)).toBe(1);
  });
  it("returns 0 when B strictly exceeds A", () => {
    const game = createGame({ realizedAAction: "conceal", realizedBAction: "press" });
    // (0, 3) — B wins
    expect(gameScoreA(game)).toBe(0);
  });
  it("returns 0.5 on a tie", () => {
    const game = createGame({
      outcomes: [
        cell("reveal", "press", 2, 2),
        cell("reveal", "yield", 0, 0),
        cell("conceal", "press", 0, 0),
        cell("conceal", "yield", 0, 0),
      ],
      realizedAAction: "reveal",
      realizedBAction: "press",
    });
    expect(gameScoreA(game)).toBe(0.5);
  });
  it("returns 0.5 when the realized cell cannot be found", () => {
    const game = createGame({ realizedAAction: "ghost-action" });
    expect(gameScoreA(game)).toBe(0.5);
  });
});

// ── Stake rank ──────────────────────────────────────────────────────────────

describe("stakeRank", () => {
  it("ranks realized cell 1 when it is A's best possible outcome", () => {
    const game = createGame({ realizedAAction: "reveal", realizedBAction: "yield" });
    const r = stakeRank(game, "A");
    expect(r?.rank).toBe(1);
    expect(r?.total).toBe(4);
  });
  it("ranks realized cell by B's perspective independently", () => {
    // Cell (conceal, press) has stakeDeltaB = 3 (B's best). Even though A's
    // rank is 4 there, B's rank should be 1.
    const game = createGame({ realizedAAction: "conceal", realizedBAction: "press" });
    expect(stakeRank(game, "A")?.rank).toBe(4);
    expect(stakeRank(game, "B")?.rank).toBe(1);
  });
  it("returns null when realized cell is missing from the grid", () => {
    const game = createGame({ realizedAAction: "phantom" });
    expect(stakeRank(game, "A")).toBeNull();
  });
});

// ── ELO ─────────────────────────────────────────────────────────────────────

describe("expectedScore", () => {
  it("returns 0.5 when ratings are equal", () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
  });
  it("favors the higher-rated player", () => {
    expect(expectedScore(1600, 1400)).toBeGreaterThan(0.5);
    expect(expectedScore(1400, 1600)).toBeLessThan(0.5);
  });
  it("sums to 1.0 across both perspectives", () => {
    const ra = 1523;
    const rb = 1489;
    expect(expectedScore(ra, rb) + expectedScore(rb, ra)).toBeCloseTo(1, 10);
  });
});

describe("gameMarginScore", () => {
  it("returns 1.0 for a maximum crush (+4/-4)", () => {
    const game = createGame({
      outcomes: [
        cell("reveal", "press", 4, -4),
        cell("reveal", "yield", 0, 0),
        cell("conceal", "press", 0, 0),
        cell("conceal", "yield", 0, 0),
      ],
      realizedAAction: "reveal",
      realizedBAction: "press",
    });
    expect(gameMarginScore(game)).toBeCloseTo(1, 10);
  });
  it("returns 0.0 for a maximum loss (-4/+4)", () => {
    const game = createGame({
      outcomes: [
        cell("reveal", "press", -4, 4),
        cell("reveal", "yield", 0, 0),
        cell("conceal", "press", 0, 0),
        cell("conceal", "yield", 0, 0),
      ],
      realizedAAction: "reveal",
      realizedBAction: "press",
    });
    expect(gameMarginScore(game)).toBeCloseTo(0, 10);
  });
  it("returns 0.5 for a tied cell", () => {
    const game = createGame({
      outcomes: [
        cell("reveal", "press", 2, 2),
        cell("reveal", "yield", 0, 0),
        cell("conceal", "press", 0, 0),
        cell("conceal", "yield", 0, 0),
      ],
      realizedAAction: "reveal",
      realizedBAction: "press",
    });
    expect(gameMarginScore(game)).toBe(0.5);
  });
  it("is linear in the stake differential", () => {
    const game = createGame({
      outcomes: [
        cell("reveal", "press", 1, 0),
        cell("reveal", "yield", 0, 0),
        cell("conceal", "press", 0, 0),
        cell("conceal", "yield", 0, 0),
      ],
      realizedAAction: "reveal",
      realizedBAction: "press",
    });
    // 0.5 + 1/16 = 0.5625
    expect(gameMarginScore(game)).toBeCloseTo(0.5625, 10);
  });
  it("clamps out-of-range values to [0, 1]", () => {
    // Even though inputs are clamped to [-4, 4] elsewhere, defend against
    // callers feeding anomalous deltas.
    const game = createGame({
      outcomes: [
        cell("reveal", "press", 100, -100),
        cell("reveal", "yield", 0, 0),
        cell("conceal", "press", 0, 0),
        cell("conceal", "yield", 0, 0),
      ],
      realizedAAction: "reveal",
      realizedBAction: "press",
    });
    expect(gameMarginScore(game)).toBe(1);
  });
  it("returns 0.5 when realized cell is missing", () => {
    const game = createGame({ realizedAAction: "ghost" });
    expect(gameMarginScore(game)).toBe(0.5);
  });
});

describe("eloUpdate", () => {
  it("is zero-sum in rating points", () => {
    const [newRa, newRb] = eloUpdate(1500, 1500, 1, ELO_K);
    expect(newRa - 1500).toBeCloseTo(1500 - newRb, 10);
  });
  it("moves ratings toward the outcome", () => {
    // Equal rated players, A wins outright.
    const [newRa, newRb] = eloUpdate(1500, 1500, 1);
    expect(newRa).toBeGreaterThan(1500);
    expect(newRb).toBeLessThan(1500);
    expect(newRa - 1500).toBeCloseTo(ELO_K * 0.5, 6);
  });
  it("makes no update when score equals expectation", () => {
    const [newRa, newRb] = eloUpdate(1500, 1500, 0.5);
    expect(newRa).toBeCloseTo(1500, 10);
    expect(newRb).toBeCloseTo(1500, 10);
  });
  it("uses a custom K when provided", () => {
    const [newRa] = eloUpdate(1500, 1500, 1, 16);
    expect(newRa - 1500).toBeCloseTo(16 * 0.5, 6);
  });
});

describe("computeEloHistories", () => {
  it("initialises players at ELO_INITIAL with a baseline history point", () => {
    const game = createGame({
      playerAId: "C-1",
      playerBId: "C-2",
      // Tied cell → margin score 0.5 → no movement.
      outcomes: [
        cell("reveal", "press", 1, 1),
        cell("reveal", "yield", 0, 0),
        cell("conceal", "press", 0, 0),
        cell("conceal", "yield", 0, 0),
      ],
      realizedAAction: "reveal",
      realizedBAction: "press",
    });
    const histories = computeEloHistories([game]);
    const a = histories.get("C-1")!;
    const b = histories.get("C-2")!;
    // Baseline + one game each.
    expect(a.ratings).toHaveLength(2);
    expect(b.ratings).toHaveLength(2);
    expect(a.ratings[0]).toBe(ELO_INITIAL);
    expect(b.ratings[0]).toBe(ELO_INITIAL);
    // Tied cell — both stay at initial.
    expect(a.ratings[1]).toBeCloseTo(ELO_INITIAL, 6);
    expect(b.ratings[1]).toBeCloseTo(ELO_INITIAL, 6);
    expect(a.games).toEqual([0]);
  });

  it("records a full arc of games with correct game indices", () => {
    const g1 = createGame({
      beatIndex: 0,
      playerAId: "C-1",
      playerBId: "C-2",
      realizedAAction: "reveal",
      realizedBAction: "yield", // A wins 3-0
    });
    const g2 = createGame({
      beatIndex: 0,
      playerAId: "C-1",
      playerBId: "C-3",
      realizedAAction: "reveal",
      realizedBAction: "press",
    });
    const histories = computeEloHistories([g1, g2]);
    const a = histories.get("C-1")!;
    const b = histories.get("C-2")!;
    const c = histories.get("C-3")!;
    // A played games 0 and 1; B only game 0; C only game 1.
    expect(a.games).toEqual([0, 1]);
    expect(b.games).toEqual([0]);
    expect(c.games).toEqual([1]);
    // A's rating should have moved off-baseline after the (3,0) crush.
    expect(a.ratings[1]).toBeGreaterThan(ELO_INITIAL);
    expect(b.ratings[1]).toBeLessThan(ELO_INITIAL);
  });

  it("preserves zero-sum rating movement across each pairing", () => {
    // Two games between the same pair — the total delta between A and B
    // should remain mirrored after every update.
    const games = [
      createGame({ playerAId: "C-1", playerBId: "C-2", realizedAAction: "reveal", realizedBAction: "yield" }),
      createGame({ playerAId: "C-1", playerBId: "C-2", realizedAAction: "conceal", realizedBAction: "press" }),
    ];
    const histories = computeEloHistories(games);
    const a = histories.get("C-1")!;
    const b = histories.get("C-2")!;
    for (let i = 0; i < a.ratings.length; i++) {
      expect(a.ratings[i] + b.ratings[i]).toBeCloseTo(2 * ELO_INITIAL, 6);
    }
  });
});

// ── Action-menu utilities ───────────────────────────────────────────────────

describe("rowOutcomes", () => {
  it("returns all cells in a given A-row", () => {
    const game = createGame();
    const row = rowOutcomes(game, "reveal");
    expect(row).toHaveLength(2);
    expect(row.every((o) => o.aActionName === "reveal")).toBe(true);
  });
  it("returns empty for unknown action name", () => {
    expect(rowOutcomes(createGame(), "ghost")).toHaveLength(0);
  });
});

describe("columnOutcomes", () => {
  it("returns all cells in a given B-column", () => {
    const game = createGame();
    const col = columnOutcomes(game, "yield");
    expect(col).toHaveLength(2);
    expect(col.every((o) => o.bActionName === "yield")).toBe(true);
  });
});

describe("isGridComplete", () => {
  it("returns true for a well-formed NxM grid", () => {
    expect(isGridComplete(createGame())).toBe(true);
  });
  it("returns true for an asymmetric 3x2 grid", () => {
    const game = createGame({
      playerAActions: [{ name: "a1" }, { name: "a2" }, { name: "a3" }],
      playerBActions: [{ name: "b1" }, { name: "b2" }],
      outcomes: [
        cell("a1", "b1", 0, 0), cell("a1", "b2", 0, 0),
        cell("a2", "b1", 0, 0), cell("a2", "b2", 0, 0),
        cell("a3", "b1", 0, 0), cell("a3", "b2", 0, 0),
      ],
      realizedAAction: "a1",
      realizedBAction: "b1",
    });
    expect(isGridComplete(game)).toBe(true);
  });
  it("returns false when the grid is missing a cell", () => {
    const game = createGame({
      outcomes: [
        cell("reveal", "press", 0, 0),
        cell("reveal", "yield", 0, 0),
        cell("conceal", "press", 0, 0),
        // missing (conceal, yield)
      ],
    });
    expect(isGridComplete(game)).toBe(false);
  });
  it("returns false when a cell is duplicated", () => {
    const game = createGame({
      outcomes: [
        cell("reveal", "press", 0, 0),
        cell("reveal", "press", 1, 1), // duplicate
        cell("conceal", "press", 0, 0),
        cell("conceal", "yield", 0, 0),
      ],
    });
    expect(isGridComplete(game)).toBe(false);
  });
});

describe("actionNames", () => {
  it("preserves the menu order", () => {
    const actions: PlayerAction[] = [
      { name: "first" },
      { name: "second" },
      { name: "third" },
    ];
    expect(actionNames(actions)).toEqual(["first", "second", "third"]);
  });
  it("returns [] for an empty menu", () => {
    expect(actionNames([])).toEqual([]);
  });
});

// ── Player name resolution ─────────────────────────────────────────────────

function makeNarrative(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    id: "test",
    title: "t",
    description: "",
    characters: {},
    locations: {},
    artifacts: {},
    threads: {},
    arcs: {},
    scenes: {},
    worldBuilds: {},
    branches: {},
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: "",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("resolvePlayerName", () => {
  it("reads from characters when the ID matches", () => {
    const n = makeNarrative({
      characters: {
        "C-1": {
          id: "C-1",
          name: "Alice",
          role: "anchor",
          world: { nodes: {}, edges: [] },
          threadIds: [],
        },
      },
    });
    expect(resolvePlayerName(n, "C-1", "stale-name")).toBe("Alice");
  });
  it("falls back to locations, then artifacts", () => {
    const n = makeNarrative({
      locations: {
        "L-1": {
          id: "L-1",
          name: "The Tavern",
          prominence: "place",
          parentId: null,
          tiedCharacterIds: [],
          threadIds: [],
          world: { nodes: {}, edges: [] },
        },
      },
      artifacts: {
        "A-1": {
          id: "A-1",
          name: "The Amulet",
          significance: "key",
          world: { nodes: {}, edges: [] },
          threadIds: [],
          parentId: null,
        },
      },
    });
    expect(resolvePlayerName(n, "L-1")).toBe("The Tavern");
    expect(resolvePlayerName(n, "A-1")).toBe("The Amulet");
  });
  it("uses the stored fallback when the entity was deleted", () => {
    const n = makeNarrative();
    expect(resolvePlayerName(n, "C-99", "Removed Character")).toBe(
      "Removed Character",
    );
  });
  it("falls back to the raw ID when nothing else resolves", () => {
    const n = makeNarrative();
    expect(resolvePlayerName(n, "C-99")).toBe("C-99");
  });
  it("preserves live renames (reads the name at call time)", () => {
    const n = makeNarrative({
      characters: {
        "C-1": {
          id: "C-1",
          name: "Alicia", // renamed since analysis
          role: "anchor",
          world: { nodes: {}, edges: [] },
          threadIds: [],
        },
      },
    });
    expect(resolvePlayerName(n, "C-1", "Alice")).toBe("Alicia");
  });
});

// ── Taxonomy coverage ──────────────────────────────────────────────────────
// The sanitiser in ai/game-analysis.ts builds its valid-set from
// GAME_TYPE_LABELS / ACTION_AXIS_LABELS. These coverage checks lock the
// label surface against accidental drift.

describe("game-theory taxonomy", () => {
  it("labels every GameType in the union", () => {
    const required: GameType[] = [
      "coordination",
      "stag-hunt",
      "dilemma",
      "chicken",
      "divergence",
      "zero-sum",
      "signaling",
      "screening",
      "principal-agent",
      "stealth",
      "stackelberg",
      "bargaining",
      "commitment-game",
      "contest",
      "collective-action",
      "trivial",
    ];
    for (const t of required) {
      expect(GAME_TYPE_LABELS[t], `missing label for game type '${t}'`).toBeDefined();
      expect(GAME_TYPE_LABELS[t].length).toBeGreaterThan(0);
    }
    expect(Object.keys(GAME_TYPE_LABELS).sort()).toEqual(required.slice().sort());
  });

  it("labels every ActionAxis in the union", () => {
    const required: ActionAxis[] = [
      "information",
      "identity",
      "trust",
      "alliance",
      "status",
      "pressure",
      "stakes",
      "resources",
      "obligation",
      "commitment",
      "timing",
    ];
    for (const a of required) {
      expect(ACTION_AXIS_LABELS[a], `missing label for action axis '${a}'`).toBeDefined();
      expect(ACTION_AXIS_LABELS[a].length).toBeGreaterThan(0);
    }
    expect(Object.keys(ACTION_AXIS_LABELS).sort()).toEqual(required.slice().sort());
  });

  it("flags stealth as a distinct label from divergence", () => {
    // Regression guard: collapsing them hides the one-sided-divergence
    // distinction the prompt leans on.
    expect(GAME_TYPE_LABELS["stealth"]).not.toBe(GAME_TYPE_LABELS["divergence"]);
    expect(GAME_TYPE_LABELS["stealth"].toLowerCase()).toContain("unaware");
  });
});

// ── Solo (1-player) decisions ─────────────────────────────────────────────

/** A 1-player decision: a row of options (no B), each with an immediate
 *  stakeDeltaA. realizedAAction is the chosen option. */
function createSolo(overrides: Partial<BeatGame> = {}): BeatGame {
  const options: PlayerAction[] = [
    { name: "accept" },
    { name: "raise" },
    { name: "bootstrap" },
  ];
  const outcomes: GameOutcome[] = [
    { aActionName: "accept", description: "", stakeDeltaA: 2 },
    { aActionName: "raise", description: "", stakeDeltaA: 4 },
    { aActionName: "bootstrap", description: "", stakeDeltaA: -1 },
  ];
  return {
    beatIndex: 0,
    beatExcerpt: "solo beat",
    kind: "solo",
    gameType: "trivial",
    actionAxis: "commitment",
    playerAId: "C-7",
    playerAName: "Founder",
    playerAActions: options,
    playerBActions: [],
    outcomes,
    realizedAAction: "accept",
    rationale: "took the certain option",
    ...overrides,
  };
}

describe("solo decisions", () => {
  it("isSolo distinguishes solo from duel", () => {
    expect(isSolo(createSolo())).toBe(true);
    expect(isSolo(createGame())).toBe(false);
    // Absent kind defaults to duel
    expect(isSolo(createGame({ kind: undefined }))).toBe(false);
  });

  it("realizedOutcome resolves by aActionName alone", () => {
    const g = createSolo({ realizedAAction: "raise" });
    expect(realizedOutcome(g)?.stakeDeltaA).toBe(4);
  });

  it("isGridComplete checks one cell per option", () => {
    expect(isGridComplete(createSolo())).toBe(true);
    // Missing a cell for an option
    const missing = createSolo({
      outcomes: [
        { aActionName: "accept", description: "", stakeDeltaA: 2 },
        { aActionName: "raise", description: "", stakeDeltaA: 4 },
      ],
    });
    expect(isGridComplete(missing)).toBe(false);
  });

  it("gameMarginScore maps the realized delta directly onto [0,1] (÷8)", () => {
    expect(gameMarginScore(createSolo({ realizedAAction: "raise" }))).toBeCloseTo(1.0); // +4
    expect(gameMarginScore(createSolo({ realizedAAction: "accept" }))).toBeCloseTo(0.75); // +2
    expect(gameMarginScore(createSolo({ realizedAAction: "bootstrap" }))).toBeCloseTo(0.375); // -1
    const wash = createSolo({
      realizedAAction: "hold",
      playerAActions: [{ name: "hold" }, { name: "move" }],
      outcomes: [
        { aActionName: "hold", description: "", stakeDeltaA: 0 },
        { aActionName: "move", description: "", stakeDeltaA: 2 },
      ],
    });
    expect(gameMarginScore(wash)).toBeCloseTo(0.5); // 0 → wash
  });

  it("gameScoreA scores against par (0)", () => {
    expect(gameScoreA(createSolo({ realizedAAction: "raise" }))).toBe(1); // +4 win
    expect(gameScoreA(createSolo({ realizedAAction: "bootstrap" }))).toBe(0); // -1 loss
    const draw = createSolo({
      realizedAAction: "hold",
      playerAActions: [{ name: "hold" }, { name: "move" }],
      outcomes: [
        { aActionName: "hold", description: "", stakeDeltaA: 0 },
        { aActionName: "move", description: "", stakeDeltaA: 1 },
      ],
    });
    expect(gameScoreA(draw)).toBe(0.5);
  });

  it("nashEquilibria returns the stake-maximising option(s)", () => {
    const ne = nashEquilibria(createSolo());
    expect(ne).toHaveLength(1);
    expect(ne[0].aActionName).toBe("raise"); // +4 is the best
    expect(ne[0].bActionName).toBeUndefined();
  });

  it("realizedIsNash is true only when the best option was taken", () => {
    expect(realizedIsNash(createSolo({ realizedAAction: "raise" }))).toBe(true);
    expect(realizedIsNash(createSolo({ realizedAAction: "accept" }))).toBe(false);
  });

  it("stakeRank ranks among options for A and is null for B", () => {
    // accept (+2) is 2nd-best of 3 (raise +4 best, bootstrap -1 worst)
    expect(stakeRank(createSolo(), "A")).toEqual({ rank: 2, total: 3 });
    expect(stakeRank(createSolo(), "B")).toBeNull();
  });

  it("arcCost is regret vs the best option for A, zero for B", () => {
    // chose accept (+2); best was raise (+4) → regret 2
    expect(arcCost(createSolo(), "A")).toBe(2);
    expect(arcCost(createSolo({ realizedAAction: "raise" }), "A")).toBe(0);
    expect(arcCost(createSolo(), "B")).toBe(0);
  });

  it("computeEloHistories moves only the decider, scored vs par", () => {
    const histories = computeEloHistories([createSolo({ realizedAAction: "raise" })]);
    // Only the decider has a history — no opponent/par entry.
    expect([...histories.keys()]).toEqual(["C-7"]);
    const h = histories.get("C-7")!;
    // Started at par, a +4 (margin 1.0) result against an equal par opponent
    // raises the rating.
    expect(h.ratings[0]).toBe(ELO_INITIAL);
    expect(h.ratings[h.ratings.length - 1]).toBeGreaterThan(ELO_INITIAL);
    expect(ELO_PAR).toBe(ELO_INITIAL);
  });

  it("a bad solo decision lowers the decider's rating", () => {
    const histories = computeEloHistories([createSolo({ realizedAAction: "bootstrap" })]);
    const h = histories.get("C-7")!;
    expect(h.ratings[h.ratings.length - 1]).toBeLessThan(ELO_INITIAL);
  });

  it("mixes solo and duel decisions in one ELO walk without crashing", () => {
    const histories = computeEloHistories([
      createGame(), // duel: C-1 vs C-2
      createSolo({ realizedAAction: "raise" }), // solo: C-7
    ]);
    expect(histories.has("C-1")).toBe(true);
    expect(histories.has("C-2")).toBe(true);
    expect(histories.has("C-7")).toBe(true);
  });
});
