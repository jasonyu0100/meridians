/**
 * Plain-language tooltips for the game-theory UI.
 *
 * Written for someone meeting these ideas for the first time. The
 * vocabulary lives here so the whole app speaks with one voice — when
 * adding a chip or stat in the UI, pull from GT_TIPS rather than
 * inventing copy in place.
 */

export const GT_TIPS = {
  // ── Thesis line ─────────────────────────────────────────────────────
  thesis:
    "Every consequential moment has a SHAPE: the full space of choices each party could have made, and what would have happened in each pairing. What actually happened is one cell in that space. Game theory describes how stake CAN move; the realized cell describes how it DID move; the gap between them describes what was left on the table.",

  // ── Core concepts ─────────────────────────────────────────────────────
  nashEquilibrium:
    "Nash equilibrium — a cell where neither player would change their action even if they knew the other's choice. Both are best-responding to each other. Game theory's resting point: where the game settles when everyone plays the locally-rational move.",
  nashCell:
    "This cell is a Nash equilibrium — neither side could improve by switching unilaterally. If the realized cell is here, the moment played out the way rational self-interest would predict.",
  realizedCell:
    "The cell that actually happened on the page. Highlighted in amber so you can compare what HAPPENED against what COULD HAVE — every other cell in this grid was on the table at this moment.",
  realizedEqNash:
    "The realized cell IS a Nash equilibrium — the story landed where rational play predicts. The moment played as expected.",
  offNash:
    "The realized cell is NOT a Nash equilibrium — someone had a better-for-them option and didn't take it. This is information, not error: the author traded local optimality for character, theme, identity, or arc. The arc-cost number tells you how much stake they left behind.",
  noPureNash:
    "No pure-strategy Nash equilibrium exists — whatever happens, at least one player wishes they'd done something else. These moments are unresolved by rational play alone; what happens reveals character.",

  // ── Stake / payoff ────────────────────────────────────────────────────
  stakeDelta:
    "How much this outcome would help (+) or hurt (−) the player's arc-level interests, on a −4 to +4 scale. +4 = ideal, 0 = neutral, −4 = catastrophic. The magnitude IS the importance of the moment — a beat where ±1 is the ceiling is a low-stakes beat; ±4 says this moment is structurally pivotal.",
  stakeDeltaPair:
    "Stake change for (player A) / (player B). Each number is how much this cell helps or hurts that player, −4 (catastrophic) to +4 (ideal).",
  stakeRank:
    "Where the realized cell sits in this player's personal ranking of cells, best to worst. Rank 1 means 'the best they could have got here'. Rank N (worst) means 'the worst available'. Tells you whether the moment was generous, cruel, or middling to them.",
  arcCost:
    "How much stake the player gave up by NOT taking the locally-best option. 0 = they captured what was available. A positive number = they accepted a worse outcome — often deliberately, in service of arc, identity, or principle. The visible signature of irrational / arc-driven play.",

  // ── ELO / standings ──────────────────────────────────────────────────
  elo:
    "A running rating of strategic success, the same idea as a chess rating. Starts at 1500 for every player. Goes up when a player captures more stake than their counterpart in a moment; goes down when they capture less. Crucial moments (high stakes on the table) move the rating more; low-stakes beats barely touch it.",
  eloCrucialMoments:
    "Crucial moments move the rating more. A ±4 grid is a pivotal beat — the rating shifts a lot. A ±1 grid is a quiet beat — the rating barely moves. This means a character who steadily wins low-stakes beats but loses the big ones will end up LOWER rated than a character with a few decisive high-stakes wins.",
  nashCompliance:
    "How often the realized cell is a Nash equilibrium — the percentage of moments where the story landed where rational play predicts. High = a world where strategic logic carries; low = a world where character, arc, or theme routinely overrides what self-interest would dictate.",
  trajectorySparkline:
    "The player's rating over time. A rising line = their realized outcomes are beating counterparts'. A falling line = they're losing ground. The shape of the line is the strategic biography in miniature.",
  wld:
    "Wins / Losses / Draws. A win means their realized cell gave them more stake than the counterpart got. A loss means the reverse. A draw means even.",

  // ── Outcome mix ──────────────────────────────────────────────────────
  outcomeMix:
    "Of the realized cells this player landed in, what fraction were positive (gained stake) vs negative (lost stake). Tells you whether the story tends to deliver good or bad outcomes to them — independent of how they did against any one counterpart.",
  avgStake:
    "Mean stake change per realized cell, on the −4..+4 scale. Positive = the story is broadly favorable to this player. Negative = the story is broadly costly.",

  // ── Grid structure ───────────────────────────────────────────────────
  gridAxis:
    "All the options for one player. Every cell in a row pairs this player's action with every action the other player could have taken.",
  actionAxis:
    "The dimension along which both players' actions live — the thing being traded in this moment. Trust, information, status, resources, commitment, etc. Both sides' choices are different positions on the same axis.",
  gameType:
    "The strategic shape of the moment — coordination, dilemma, signaling, zero-sum, etc. Tells you what KIND of game is being played. Hover the chip for the one-line definition.",
  rationaleRealized:
    "One-sentence reading of why the realized cell landed here rather than anywhere else on the grid. Most interesting when the realized cell is dominated — when the choice cost the player stake, why was it worth the cost?",

  // ── Strategic style archetypes ───────────────────────────────────────
  coalition:
    "A tight group where every pair routinely lands in mutual-gain cells together. The structural alliances inside the cast — who consistently rises (or falls) together.",
  rivalry:
    "Two players with sustained, asymmetric conflict — many moments shared, many cells where one gains while the other loses, with a clear winner.",
  cohesion:
    "A coalition's weakest pairwise bond, as a cooperation rate. High = even the least-aligned members still cooperate most of the time. Low = the coalition holds together loosely.",
  intensityScore:
    "How significant a rivalry is, combining shared games, conflict rate, and asymmetry. High = lots of games, lots of conflict, clear winner.",
} as const;

export type GtTipKey = keyof typeof GT_TIPS;
