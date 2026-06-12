/** Conviction seat-stream seeding — the AI call that gives a seat something real
 *  to play (CONCEPT.md READ-WRITE: "engine-sampled candidate streams seeded to
 *  its vantage"). In ONE grounded call it proposes, for a perspective: an open
 *  question of WHAT TO DO, that perspective's gut INTUITION, the candidate
 *  ACTIONS (outcomes), and a stance DISTRIBUTION (priorProbs) over them — exactly
 *  the inputs `openStream` needs to mint a stream whose `streamProbs` price the
 *  dealt cards. Action-first, perspective-strict, persona-shaped. Reuses the
 *  shipping stream conventions; just bundles question + intuition + instantiation
 *  into a single call so the deal is one round-trip per stream, not three. */
import { DEFAULT_MODEL } from "@/lib/constants";
import { callGenerate } from "@/lib/ai/api";
import { parseJson } from "@/lib/ai/json";
import type { ThreadLogNodeType } from "@/types/narrative";

export interface SeatStreamSeed {
  question: string;
  intuition: string;
  outcomes: string[];
  priorProbs: number[];
  logType: ThreadLogNodeType;
  rationale?: string;
}

const SYSTEM = `You seed a BELIEF STREAM for ONE perspective seated at a strategy table — their open question of WHAT TO DO right now, their gut intuition, and a probabilistic stance over the MOVES they could make. Streams are ACTION-FIRST: the stance is where this perspective is LEANING among possible actions, never whether some outcome occurs. Produce, in one shot:
- question: ONE short, genuinely-open question of what THIS perspective should DO ("What's my move on…?", "Do I … or …?"). Under ~15 words. Consequential to this vantage; honestly unsettled; opens into several real moves. If ALREADY-OPEN questions are listed, propose a genuinely DIFFERENT one.
- intuition: 1–3 short first-person sentences — this perspective's stream of consciousness as they weigh the move (which way they lean + the concrete personal reason). Their inner voice, not analysis from outside.
- outcomes: 3–5 mutually-exclusive candidate ACTIONS — the live moves on the table (distinct plays, responses, commitments, who-to-back, how-hard-to-push, when-to-move). Short ACTION phrases (something they DO), not results. Only fall back to a 2-way go/no-go if it is genuinely a single decision.
- priorProbs: a probability vector (one per action, SAME ORDER, sums ~1.0) for how strongly they currently lean toward each move. Confident intuition → skewed; hedged → flatter. Keep each in ~0.05–0.9 (never saturate).
- logType: usually "setup"; "escalation" if rising pressure to act, "twist" if it overturns the obvious move.
- rationale: one sentence grounding priorProbs in the intuition.

CRITICAL — adopt the PERSPECTIVE strictly. Everything must be what THIS vantage faces, in ITS OWN interest, anchored on its INNER WORLD. Do NOT drift to the story's protagonist. The WORLD block is shared background, not the subject.

Output ONLY JSON: {"question":"...","intuition":"...","outcomes":[...],"priorProbs":[...],"logType":"...","rationale":"..."}`;

const personaBlock = (persona?: string): string =>
  persona?.trim()
    ? `PLAYER PERSONA — you are operated by an AI player with this temperament; let it shape lean, framing, and risk posture without overriding the perspective's own goals/continuity:\n${persona.trim()}`
    : "";

export async function generateSeatStream(args: {
  perspectiveLabel?: string;
  /** The perspective's inner-world graph, rendered to text. */
  entityContext?: string;
  /** Canonical head context (context.ts narrativeContext). */
  narrativeContext?: string;
  /** AI-player persona driving the seat. */
  personaContext?: string;
  /** Questions already open on this seat — propose something distinct. */
  existingQuestions?: string[];
  /** Thinking budget — pass `resolveReasoningBudget(narrative)`. Default 0. */
  reasoningBudget?: number;
}): Promise<SeatStreamSeed> {
  const user = [
    args.perspectiveLabel ? `PERSPECTIVE: ${args.perspectiveLabel}` : "",
    personaBlock(args.personaContext),
    args.entityContext
      ? `INNER WORLD — this perspective's traits, goals, secrets, relations, history (think AS them):\n${args.entityContext}`
      : "",
    args.existingQuestions?.length
      ? `ALREADY-OPEN QUESTIONS (propose a DIFFERENT one):\n${args.existingQuestions.map((q) => `- ${q}`).join("\n")}`
      : "",
    args.narrativeContext ? `WORLD:\n${args.narrativeContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callGenerate(
    user || "Seed a stream for this perspective.",
    SYSTEM,
    undefined,
    "generateSeatStream",
    DEFAULT_MODEL,
    args.reasoningBudget ?? 0,
  );
  const parsed = parseJson(raw, "generateSeatStream") as Partial<SeatStreamSeed>;

  let outcomes = Array.isArray(parsed.outcomes)
    ? parsed.outcomes.filter((o): o is string => typeof o === "string" && !!o.trim()).map((o) => o.trim())
    : [];
  if (outcomes.length < 2) outcomes = ["Press the advantage", "Hold and observe"];

  let probs = Array.isArray(parsed.priorProbs)
    ? parsed.priorProbs.map((p) => (typeof p === "number" && Number.isFinite(p) && p > 0 ? p : 0))
    : [];
  if (probs.length !== outcomes.length) probs = outcomes.map(() => 1);
  const sum = probs.reduce((a, b) => a + b, 0) || 1;
  probs = probs.map((p) => p / sum);

  return {
    question: typeof parsed.question === "string" && parsed.question.trim() ? parsed.question.trim() : "What is my move now?",
    intuition:
      typeof parsed.intuition === "string" && parsed.intuition.trim()
        ? parsed.intuition.trim()
        : "I weigh the moment and lean toward the move that protects what I hold.",
    outcomes,
    priorProbs: probs,
    logType: (parsed.logType as ThreadLogNodeType) ?? "setup",
    rationale: typeof parsed.rationale === "string" ? parsed.rationale.trim() : undefined,
  };
}
