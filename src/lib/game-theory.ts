/**
 * Game-theoretic helpers — NxM decision-space model.
 *
 * Every consequential moment has a SHAPE: the full space of choices each
 * party could have made, and the consequence of every pairing. What
 * actually happened (realized cell) is one signature on that space. The
 * shape says how stake CAN move; the realized cell says how it DID move;
 * arcCost says what was left on the table.
 *
 * Nash equilibria and stake rankings are descriptive lenses, not
 * normative judgements. A realized cell landing off-Nash is exactly the
 * information the ELO system learns from — agents who trade local stake
 * for arc-level payoff are a feature, not a bug.
 */

import type {
  BeatGame,
  GameOutcome,
  NarrativeState,
  PlayerAction,
} from "@/types/narrative";

// ── Outcome lookup ─────────────────────────────────────────────────────────

/** Find the outcome cell for a specific (A, B) action pair. */
export function outcomeAt(
  game: BeatGame,
  aActionName: string,
  bActionName: string,
): GameOutcome | null {
  return (
    game.outcomes.find(
      (o) => o.aActionName === aActionName && o.bActionName === bActionName,
    ) ?? null
  );
}

/** The realized outcome — what the author actually wrote. */
export function realizedOutcome(game: BeatGame): GameOutcome | null {
  return outcomeAt(game, game.realizedAAction, game.realizedBAction);
}

// ── Nash equilibria (stake delta only) ─────────────────────────────────────

/**
 * NxM Nash: cell (a, b) is a pure-strategy equilibrium if
 *   - A's stake delta at (a, b) ≥ A's delta at (a', b) for every other a'
 *   - B's stake delta at (a, b) ≥ B's delta at (a, b') for every other b'
 *
 * Ties qualify (weak Nash). Returns the set of (aActionName, bActionName)
 * pairs that satisfy the condition.
 */
export function nashEquilibria(
  game: BeatGame,
): Array<{ aActionName: string; bActionName: string }> {
  const result: Array<{ aActionName: string; bActionName: string }> = [];
  for (const cell of game.outcomes) {
    // A wouldn't switch rows given B plays bActionName
    let aStable = true;
    for (const alt of game.playerAActions) {
      if (alt.name === cell.aActionName) continue;
      const altCell = outcomeAt(game, alt.name, cell.bActionName);
      if (altCell && altCell.stakeDeltaA > cell.stakeDeltaA) {
        aStable = false;
        break;
      }
    }
    if (!aStable) continue;
    // B wouldn't switch columns given A plays aActionName
    let bStable = true;
    for (const alt of game.playerBActions) {
      if (alt.name === cell.bActionName) continue;
      const altCell = outcomeAt(game, cell.aActionName, alt.name);
      if (altCell && altCell.stakeDeltaB > cell.stakeDeltaB) {
        bStable = false;
        break;
      }
    }
    if (!bStable) continue;
    result.push({ aActionName: cell.aActionName, bActionName: cell.bActionName });
  }
  return result;
}

/** Is the realized cell a Nash equilibrium? Descriptive, not normative. */
export function realizedIsNash(game: BeatGame): boolean {
  const ne = nashEquilibria(game);
  return ne.some(
    (p) =>
      p.aActionName === game.realizedAAction &&
      p.bActionName === game.realizedBAction,
  );
}

// ── Stake-based win/loss/draw scoring ──────────────────────────────────────

/**
 * Score from Player A's perspective on the realized outcome:
 *   1   = A's stake delta strictly exceeds B's (A "wins" the beat)
 *   0   = B's strictly exceeds A's
 *   0.5 = tie
 *
 * This is what ELO reads.
 */
export function gameScoreA(game: BeatGame): number {
  const cell = realizedOutcome(game);
  if (!cell) return 0.5;
  if (cell.stakeDeltaA > cell.stakeDeltaB) return 1;
  if (cell.stakeDeltaA < cell.stakeDeltaB) return 0;
  return 0.5;
}

// ── Stake rank — descriptive only ──────────────────────────────────────────

/**
 * Rank of the realized cell among all outcomes by stake delta for the given
 * player. Rank 1 = best possible for them, rank = outcomes.length = worst.
 * Useful for "the author picked the 3rd-best-for-Harry outcome out of 9".
 */
export function stakeRank(
  game: BeatGame,
  player: "A" | "B",
): { rank: number; total: number } | null {
  const cell = realizedOutcome(game);
  if (!cell) return null;
  const key = player === "A" ? "stakeDeltaA" : "stakeDeltaB";
  const realizedValue = cell[key];
  const sorted = game.outcomes.slice().sort((x, y) => y[key] - x[key]);
  const rank = sorted.findIndex(
    (o) => o.aActionName === cell.aActionName && o.bActionName === cell.bActionName,
  );
  return rank >= 0 ? { rank: rank + 1, total: sorted.length } : null;
  // realizedValue intentionally computed for potential future use
  void realizedValue;
}

// ── Arc cost — stake left on the table ─────────────────────────────────────

/**
 * How much stake the player gave up by landing on the realized cell
 * instead of the best cell available to them in their realized row /
 * column. Returns 0 when the player took the locally-best option (a
 * "rational" play), and rises as the realized cell trades stake for
 * arc / identity / principle.
 *
 *   arcCost(A) = max(stakeDeltaA across A's realized-row) − realizedDeltaA
 *   arcCost(B) = max(stakeDeltaB across B's realized-column) − realizedDeltaB
 *
 * Derived from the grid — no LLM declaration. The visible signature of
 * irrational / arc-driven play, surfaced wherever the operator can see
 * "this character could have captured +3 more stake and chose not to".
 */
export function arcCost(game: BeatGame, player: "A" | "B"): number {
  const cell = realizedOutcome(game);
  if (!cell) return 0;
  if (player === "A") {
    const row = rowOutcomes(game, cell.aActionName);
    const best = row.reduce((m, o) => (o.stakeDeltaA > m ? o.stakeDeltaA : m), -Infinity);
    return Math.max(0, best - cell.stakeDeltaA);
  } else {
    const col = columnOutcomes(game, cell.bActionName);
    const best = col.reduce((m, o) => (o.stakeDeltaB > m ? o.stakeDeltaB : m), -Infinity);
    return Math.max(0, best - cell.stakeDeltaB);
  }
}

// ── ELO rating ─────────────────────────────────────────────────────────────

export const ELO_INITIAL = 1500;
export const ELO_K = 32;

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/**
 * Continuous margin score for ELO updates, in [0, 1] from A's perspective.
 *
 *   scoreA = clamp(0.5 + (ΔA − ΔB) / 16, 0, 1)
 *
 * Stake deltas live in [-4, 4], so the differential spans [-8, 8] and the
 * score spans [0, 1] linearly. This folds margin-of-victory into the ELO
 * expected-vs-actual math — a +4/−4 crush yields 1.0 (max move), a +1/0
 * marginal edge yields ~0.56 (barely moves), a tie or dead-even cell yields
 * 0.5 (no move), a crushing loss yields 0.
 *
 * W/L/D display counting stays binary via gameScoreA — it's a separate
 * narrative-readable metric, not what ELO consumes.
 */
export function gameMarginScore(game: BeatGame): number {
  const cell = realizedOutcome(game);
  if (!cell) return 0.5;
  const raw = 0.5 + (cell.stakeDeltaA - cell.stakeDeltaB) / 16;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Stake-weighted K factor — the magnitude of the grid scales how much
 * one game can move the rating. Crucial moments (high stakes on the
 * table) move the rating fully; low-stakes beats barely move it.
 *
 *   K_effective = K_base × (max|stake| in grid / 4)
 *
 * A +4/−4 grid yields the full K; a ±1 grid yields K/4. Independent of
 * who won — margin-of-victory still lives in scoreA. K answers "how
 * much did this moment matter"; scoreA answers "who captured it".
 */
export function kEffective(game: BeatGame, kBase: number = ELO_K): number {
  let maxAbs = 0;
  for (const o of game.outcomes) {
    const a = Math.abs(o.stakeDeltaA);
    const b = Math.abs(o.stakeDeltaB);
    if (a > maxAbs) maxAbs = a;
    if (b > maxAbs) maxAbs = b;
  }
  return kBase * Math.min(1, maxAbs / 4);
}

export function eloUpdate(
  ra: number,
  rb: number,
  scoreA: number,
  k: number = ELO_K,
): [number, number] {
  const expectedA = expectedScore(ra, rb);
  const newRa = ra + k * (scoreA - expectedA);
  const newRb = rb + k * (1 - scoreA - (1 - expectedA));
  return [newRa, newRb];
}

/** Per-player ELO history across a sequence of games in narrative order.
 *  K is stake-weighted per game so crucial moments dominate the rating
 *  and low-stakes beats barely move it. Margin-of-victory lives in
 *  scoreA via the continuous margin score. */
export function computeEloHistories(
  games: BeatGame[],
): Map<string, { ratings: number[]; games: number[] }> {
  const current = new Map<string, number>();
  const histories = new Map<string, { ratings: number[]; games: number[] }>();

  const ensure = (id: string): void => {
    if (!current.has(id)) {
      current.set(id, ELO_INITIAL);
      histories.set(id, { ratings: [ELO_INITIAL], games: [] });
    }
  };

  games.forEach((g, idx) => {
    ensure(g.playerAId);
    ensure(g.playerBId);
    const ra = current.get(g.playerAId)!;
    const rb = current.get(g.playerBId)!;
    const [newRa, newRb] = eloUpdate(ra, rb, gameMarginScore(g), kEffective(g));
    current.set(g.playerAId, newRa);
    current.set(g.playerBId, newRb);

    histories.get(g.playerAId)!.ratings.push(newRa);
    histories.get(g.playerAId)!.games.push(idx);
    histories.get(g.playerBId)!.ratings.push(newRb);
    histories.get(g.playerBId)!.games.push(idx);
  });

  return histories;
}

// ── Action menu utilities ──────────────────────────────────────────────────

/** All outcomes in the row A=aActionName (used for best-response columns). */
export function rowOutcomes(game: BeatGame, aActionName: string): GameOutcome[] {
  return game.outcomes.filter((o) => o.aActionName === aActionName);
}

/** All outcomes in the column B=bActionName. */
export function columnOutcomes(game: BeatGame, bActionName: string): GameOutcome[] {
  return game.outcomes.filter((o) => o.bActionName === bActionName);
}

/** Does the game have a well-formed NxM grid? */
export function isGridComplete(game: BeatGame): boolean {
  const expected = game.playerAActions.length * game.playerBActions.length;
  if (game.outcomes.length !== expected) return false;
  const seen = new Set<string>();
  for (const o of game.outcomes) {
    const key = `${o.aActionName}::${o.bActionName}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** Quick helper for UI — list action names in menu order. */
export function actionNames(actions: PlayerAction[]): string[] {
  return actions.map((a) => a.name);
}

// ── Player name resolution (display layer) ────────────────────────────────

/**
 * Resolve a player ID to its current display name. Reads from the narrative
 * registry so renames propagate live; falls back to the stored name if the
 * entity was deleted since analysis.
 */
export function resolvePlayerName(
  narrative: NarrativeState,
  id: string,
  storedFallback?: string,
): string {
  return (
    narrative.characters[id]?.name ??
    narrative.locations[id]?.name ??
    narrative.artifacts[id]?.name ??
    storedFallback ??
    id
  );
}
