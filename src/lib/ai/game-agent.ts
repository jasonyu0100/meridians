/** Conviction agent play — the LLM decides how an AI seat takes its PLAY turn.
 *  Once play opens, the agent reads its own continuity (entity inner world +
 *  persona) against the streams on the table and CHOOSES, in character, which
 *  cards (if any) to commit conviction to and how hard. It may deliberately play
 *  NOTHING — banking its conviction is a legitimate, often shrewd move. The model
 *  decides; this module only renders the table for it and then HARD-CLAMPS the
 *  result to the economy (real cardIds, conviction ≥ cost, affordable, within the
 *  per-round cap) so a hallucinated reply can never mint an illegal play. On any
 *  failure the caller falls back to the deterministic `chooseAgentPlays`. */
import { ACTION_MODEL } from "@/lib/constants";
import { callGenerate } from "@/lib/ai/api";
import { parseJson } from "@/lib/ai/json";
import { effectiveCost } from "@/lib/game/economy";
import { streamProbs } from "@/lib/forces/stream-stance";
import { legalizeAgentPlays, type AgentPlay, type ProposedPlay } from "@/lib/game/agent";
import type { ConvictionEconomy, Hand, Seat, Stream } from "@/types/narrative";

const SYSTEM = `You operate ONE player seated at a strategy table, taking your PLAY turn. The table has open QUESTIONS (streams); each card is a candidate ACTION you could commit to, priced in conviction (rarer / bolder actions cost more). Conviction is a scarce, decaying resource — a fixed stack each round, spent on commit, and what you bank carries (lightly decayed) into the next round.

Decide, strictly IN CHARACTER from your INNER WORLD and PERSONA, which cards (if any) to play and how much conviction to commit to each:
- Commit only where your continuity and read of the table genuinely back the move. Conviction follows real conviction.
- PASS freely: an empty list banks your stack for a stronger round. Passing is a real decision, not a failure.
- RAISE = commit ABOVE a card's floor. A raise buys EDGE when your action COLLIDES with a rival's opposing action on the same question. How that edge cashes out depends on the room's CONFLICT RULE (given below). With NO collision a raise is REFUNDED — so raise when you expect a clash or the moment is genuinely decisive, not by default.
- POSITION: if plays already sit on the table this round, you are acting AFTER them — that knowledge is your edge. Read what each rival committed and to what: pile onto a move you share, OUTBID (raise) a face-up action you mean to beat under the conflict rule, sidestep a question already locked up, or exploit a question they LEFT alone. A face-DOWN rival play tells you only that conviction was spent and on which question — the action itself is hidden, so price the uncertainty (it may or may not clash with yours).
- MULTI-OUTCOME (advanced): you MAY back more than one action on the SAME question — a hedge across moves. Caveat: several of your own actions on one question may not merge cleanly, and the engine may have to resolve the tension between your OWN cards. Do this only when the question genuinely supports parallel moves and the hedge earns its cost. Most turns, ONE action per question is right.
- CONCEAL ("faceDown": true): hide an action from rivals until the showdown reveal, for a premium (a higher floor). Conceal a decisive or contestable move when surprise is worth the price — especially when seats AFTER you would otherwise read a face-up commit and counter it.
- CONFLICT: when you and a RIVAL commit opposing actions on the same question, BOTH are recorded — the engine writes an interpretation of what actually happens, weighted by conviction and the conflict rule. Conviction is how loudly your reading of the future is asserted.
- Respect your budget and the per-round card cap. Never commit below a card's (effective) cost.

Output ONLY JSON: {"plays":[{"cardId":"<exact id>","conviction":<integer ≥ cost>,"faceDown":<true|false>}],"rationale":"<one short first-person line on why these / why you held>"}. An empty "plays" array means you pass.`;

/** The room's conflict-resolution rule, spelled out so the agent knows whether —
 *  and why — raising buys an edge on a contested clash. */
function conflictRuleBlock(bias: ConvictionEconomy["resolveBias"]): string {
  switch (bias) {
    case "random":
      return "CONFLICT RULE — DRAW: clashes settle by a seeded draw over odds shaped by total conviction. More conviction → better odds. RAISE to tilt a contested draw your way; with no clash the raise is refunded.";
    case "highest-cost":
      return "CONFLICT RULE — RAREST: the costliest (rarest, boldest) committed action wins a clash outright. RAISE or back a rarer action to OUTBID a rival on a contested question.";
    case "realism":
      return "CONFLICT RULE — REALISM: an impartial AI judges what would REALISTICALLY happen given the world and the competing actions, weighting conviction as the intensity of intent — not a coin flip. Commit conviction that honestly reflects how hard you push; overcommitting a fanciful action won't make it realistic.";
    default:
      return "";
  }
}

/** The room's concrete economics, in this seat's actual numbers — budget, the
 *  per-round cap, what a card's floor means, what concealment costs here, and
 *  where raising stops buying edge. The SYSTEM prompt gives the rules; this gives
 *  the live dials so the agent prices its plays against a real budget. */
function economicsBlock(conviction: number, economy: ConvictionEconomy): string {
  const pct = Math.round((economy.facedownPremium - 1) * 100);
  const cap = economy.cardsPerRound;
  const lines = [
    "YOUR ECONOMICS (price every play against these — conviction is scarce and decays):",
    `- BUDGET: ${conviction.toFixed(0)} conviction in your stack. You spend it on commit; whatever you bank carries (lightly decayed) into next round, so holding is real value.`,
    `- CAP: at most ${cap} card${cap === 1 ? "" : "s"} this round.`,
    "- FLOOR: each card lists a face-up floor — its price on the table. Never commit below it; that floor is the bare cost of taking the action.",
    economy.facedownPremium > 1
      ? `- CONCEAL: a face-down play costs +${pct}% over the floor (the concealed price is shown on each card) and hides your action until showdown. Pay it only when surprise is worth the premium.`
      : "- CONCEAL: face-down play is off in this room — every play is face-up.",
    "- RAISE: committing ABOVE a card's floor buys EDGE, but ONLY when your action collides with a rival's opposing action on the same question; with no clash the surplus is REFUNDED. Raising past roughly 3× the floor buys little further edge (the evidence a commit lands is capped). Raise for a clash or a decisive moment — not by default.",
  ];
  return lines.join("\n");
}

const personaBlock = (persona?: string): string =>
  persona?.trim()
    ? `YOUR PERSONA — the temperament you play with (shapes risk posture, how hard you raise, when you hold):\n${persona.trim()}`
    : "";

/** The plays already on the table this round (sequential position) — face-up
 *  actions shown in full; face-down rivals expose only conviction + question. */
function priorPlaysBlock(priorPlays?: Parameters<typeof decideAgentPlays>[0]["priorPlays"]): string {
  if (!priorPlays?.length) return "";
  const lines = priorPlays.map((p) =>
    p.faceDown || !p.action
      ? `  - ${p.seat} on "${p.question}": a CONCEALED move — ${p.conviction}cv committed, the action hidden until showdown`
      : `  - ${p.seat} on "${p.question}": committed ${p.conviction}cv to "${p.action}"`,
  );
  return `PLAYS ALREADY ON THE TABLE THIS ROUND — you act AFTER these (sequential position is your edge; read them and respond):\n${lines.join("\n")}`;
}

export interface AgentDecision {
  plays: AgentPlay[];
  rationale?: string;
}

export async function decideAgentPlays(args: {
  seat: Seat;
  hand: Hand;
  economy: ConvictionEconomy;
  streamsById: Record<string, Stream>;
  perspectiveLabel?: string;
  /** The seat entity's inner-world graph rendered to text (its continuity). */
  entityContext?: string;
  /** Outline of the narrative head (context.ts outlineContext). */
  narrativeOutline?: string;
  /** AI-player persona driving the seat. */
  persona?: string;
  /** Plays already committed THIS round by OTHER seats (sequential play only —
   *  empty in simultaneous, where no one has acted yet). A face-down play exposes
   *  only that conviction was spent on a question, never the action. Lets a seat
   *  acting later read the table and respond (contest, outbid, dodge, conceal). */
  priorPlays?: Array<{ seat: string; question: string; action: string | null; conviction: number; faceDown: boolean }>;
  /** Thinking budget — pass `resolveReasoningBudget(narrative)`. Default 0. */
  reasoningBudget?: number;
}): Promise<AgentDecision> {
  const { seat, hand, economy, streamsById } = args;
  // One option per un-played card, grouped under its stream's question.
  const playedIds = new Set(hand.played.map((p) => p.card.id));
  const options = hand.cards.filter((c) => !playedIds.has(c.id));
  if (options.length === 0) return { plays: [] };

  const byStream = new Map<string, typeof options>();
  for (const c of options) {
    const arr = byStream.get(c.streamId) ?? [];
    arr.push(c);
    byStream.set(c.streamId, arr);
  }
  const tableLines: string[] = [];
  for (const [streamId, cards] of byStream) {
    const stream = streamsById[streamId];
    const probs = stream ? streamProbs(stream) : [];
    tableLines.push(`Q: ${stream?.title ?? streamId}`);
    for (const c of cards) {
      const lean = Math.round((probs[c.outcome] ?? 0) * 100);
      const concealed =
        economy.facedownPremium > 1 ? ` · concealed ${effectiveCost(c.cost, false, economy)}` : "";
      tableLines.push(
        `  - cardId ${c.id} · action "${stream?.outcomes?.[c.outcome] ?? `action ${c.outcome}`}" · floor ${c.cost}${concealed} · your current lean ${lean}%`,
      );
    }
  }

  const user = [
    args.perspectiveLabel ? `YOU ARE: ${args.perspectiveLabel}` : "",
    personaBlock(args.persona),
    args.entityContext
      ? `YOUR INNER WORLD (think AS this — traits, goals, secrets, and your RELATIONSHIPS toward others). Where a relationship is marked AT THIS TABLE, the seat across from you IS that person: let warmth pull you to back or shield their move, let rivalry pull you to contest, outbid, or conceal against it. The social standing is as load-bearing as the odds:\n${args.entityContext}`
      : "",
    economicsBlock(seat.conviction, economy),
    conflictRuleBlock(economy.resolveBias),
    priorPlaysBlock(args.priorPlays),
    `THE TABLE — open questions and the action-cards in your hand:\n${tableLines.join("\n")}`,
    args.narrativeOutline ? `WORLD:\n${args.narrativeOutline}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callGenerate(user, SYSTEM, undefined, "decideAgentPlays", ACTION_MODEL, args.reasoningBudget ?? 0);
  const parsed = parseJson(raw, "decideAgentPlays") as { plays?: unknown; rationale?: unknown };

  // Normalize the LLM's raw proposals, then hand them to the single legality gate
  // (`legalizeAgentPlays`): it keeps only the moves that are real, within the card
  // cap, and inside the seat's budget — dropping (playing NO card for) anything
  // illegal rather than clamping it to fit. The model decides; legality is law.
  const cardsById = new Map(options.map((c) => [c.id, { id: c.id, cost: c.cost }]));
  const proposed: ProposedPlay[] = (Array.isArray(parsed.plays) ? parsed.plays : []).map((row) => {
    const p = (row ?? {}) as Record<string, unknown>;
    return {
      cardId: typeof p.cardId === "string" ? p.cardId : "",
      conviction: typeof p.conviction === "number" ? p.conviction : NaN,
      faceDown: p.faceDown === true,
    };
  });
  const plays = legalizeAgentPlays(proposed, cardsById, seat.conviction, economy);
  return { plays, rationale: typeof parsed.rationale === "string" ? parsed.rationale.trim() : undefined };
}
