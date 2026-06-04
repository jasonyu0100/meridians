/**
 * Per-character game-theory summary — a lightweight derivation off
 * `narrative.scenes[*].gameAnalysis.games` for inspector views.
 *
 * GameTheoryDashboard.tsx computes a much richer player row (rivalries,
 * coalitions, archetype tags, axis distributions, …). This helper is
 * intentionally small: ELO trajectory + W/L/D + game count, in scene
 * order on the resolved branch. Designed for embedding in
 * CharacterDetail (and similar entity inspectors) without dragging in
 * the dashboard's full machinery.
 */

import type { BeatGame, NarrativeState } from '@/types/narrative';
import { computeEloHistories, gameScoreA } from '@/lib/game-theory/game-theory';

export type PlayerGameSummary = {
  /** Final ELO at the end of the resolved timeline. */
  currentElo: number;
  /** Highest ELO this character reached on the timeline. */
  peakElo: number;
  /** Lowest ELO. */
  troughElo: number;
  /** Per-game ELO ratings (chronological, includes the initial seed at idx 0). */
  history: number[];
  /** Game count. */
  games: number;
  /** Decisive A-perspective wins (gameScoreA === 1 for player as A, === 0 for player as B). */
  wins: number;
  /** Decisive losses. */
  losses: number;
  /** Draws (gameScoreA === 0.5). */
  draws: number;
};

/** Build a single character's game-theory summary by walking the
 *  resolved branch in scene order. Games are pulled from each scene's
 *  `gameAnalysis.games`. Returns null if the character has never been
 *  a player in any game on this branch — caller can render an empty
 *  state.
 *
 *  `currentSceneIndex` cuts off the walk so the chart matches the
 *  operator's scrubber position — ELO only reflects events at-or-
 *  before the current scene, not the whole branch. */
export function buildPlayerGameSummary(
  narrative: NarrativeState,
  characterId: string,
  resolvedEntryKeys: ReadonlyArray<string>,
  currentSceneIndex: number,
): PlayerGameSummary | null {
  // Collect games in scene-order. ELO histories index by player id;
  // we'll filter for the requested character after.
  const limit = Math.min(currentSceneIndex, resolvedEntryKeys.length - 1);
  const ordered: BeatGame[] = [];
  for (let i = 0; i <= limit; i++) {
    const key = resolvedEntryKeys[i];
    const scene = narrative.scenes[key];
    if (!scene || scene.kind !== 'scene') continue;
    const games = scene.gameAnalysis?.games ?? [];
    for (const g of games) ordered.push(g);
  }
  if (ordered.length === 0) return null;

  const histories = computeEloHistories(ordered);
  const my = histories.get(characterId);
  if (!my || my.games.length === 0) return null;

  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const gIdx of my.games) {
    const game = ordered[gIdx];
    if (!game) continue;
    const score = gameScoreA(game);
    const asA = game.playerAId === characterId;
    // From this character's perspective:
    //   asA && score === 1 → win
    //   asA && score === 0 → loss
    //   !asA && score === 0 → win (B beat A)
    //   !asA && score === 1 → loss (B lost to A)
    //   score === 0.5 → draw
    if (score === 0.5) draws++;
    else if ((asA && score === 1) || (!asA && score === 0)) wins++;
    else losses++;
  }

  const peakElo = Math.max(...my.ratings);
  const troughElo = Math.min(...my.ratings);
  const currentElo = my.ratings[my.ratings.length - 1];

  return {
    currentElo,
    peakElo,
    troughElo,
    history: my.ratings,
    games: my.games.length,
    wins,
    losses,
    draws,
  };
}
