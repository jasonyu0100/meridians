/**
 * Stream instantiation — AI-seeds a new stream's belief from a member's
 * initial intuition, the same way a Fate Thread is born with `priorProbs`.
 *
 * Streams are ACTION-FIRST (this is the core distinction from Threads, which
 * track outcomes). A stream records a perspective's stance over the possible
 * ACTIONS it could take on an open question of what to do — where it is LEANING
 * among moves — not whether some outcome will occur. Each move could lead to outcomes, but
 * those are downstream and uncertain; the stance is on the action. The
 * `outcomes` array therefore holds candidate actions (kept named `outcomes`
 * because a stream reuses the Thread stance math); they are courses of action,
 * not resolutions. A stream is the calibration of turning thought into action.
 *
 * Given an open question of what to do and the member's intuition (from their perspective),
 * the model proposes a small set of mutually-exclusive candidate actions and an
 * in-world base-rate probability vector over them (how strongly the perspective
 * leans toward each) — which `deriveInitialLogits` turns into the opening stance
 * (see `lib/forces/stream-stance.ts`). When a member copies another stream's
 * question, the actions are fixed and the model only re-estimates `priorProbs`
 * from the new member's intuition.
 */

import type { OutcomeEvidence, ThreadHorizon, ThreadLogNodeType } from '@/types/narrative';
import { DEFAULT_MODEL } from '@/lib/constants';
import { callGenerate } from './api';
import { parseJson } from './json';

export type StreamInstantiation = {
  outcomes: string[];
  priorProbs: number[];
  logType: ThreadLogNodeType;
  horizon: ThreadHorizon;
  rationale: string;
};

const SYSTEM = `You instantiate a BELIEF STREAM — one perspective's open question of WHAT TO DO, plus their gut intuition — into a probabilistic stance over the MOVES they could make. Streams are action-first: the stance records where this perspective is LEANING among possible actions, not whether some outcome will occur. Each action could lead to results, but those are downstream and uncertain — the stance is on the action, not its payoff.

Given the QUESTION (the open question of what this perspective should do) and their INTUITION (their reasoning from their own vantage), produce:
- outcomes: the mutually-exclusive candidate ACTIONS this perspective could take — the live moves on the table (distinct plays, responses, commitments, who-to-back, how-hard-to-push, when-to-move). PREFER 3–5 specific, meaningful courses of action that carve the real decision space; do NOT pigeonhole into "Act / Don't" unless it is genuinely a single go/no-go. Each is a short ACTION phrase (something the perspective DOES), not a result. If FIXED OUTCOMES are supplied, you MUST reuse them verbatim and in order.
- priorProbs: a probability vector (one per action, SAME ORDER, summing to ~1.0) encoding how strongly this perspective currently leans toward each move. Confident intuition → skewed; hedged intuition → flatter. Never fully saturate (keep each in ~0.05–0.9).
- logType: the perceptual primitive the intuition reads as — usually "setup" (a forward-looking read); "escalation" if it asserts rising pressure to act, "twist" if it overturns the obvious move.
- horizon: "short" | "medium" | "long" | "epic" — how far the decision sits.
- rationale: one sentence grounding the priorProbs in the intuition.

Output ONLY JSON: {"outcomes":[...],"priorProbs":[...],"logType":"...","horizon":"...","rationale":"..."}`;

export async function instantiateStream(args: {
  question: string;
  intuition: string;
  perspectiveLabel?: string;
  /** Canonical narrative context at the head (from context.ts narrativeContext). */
  narrativeContext?: string;
  /** When copying an existing question — reuse these outcomes verbatim. */
  fixedOutcomes?: string[];
}): Promise<StreamInstantiation> {
  const parts = [
    args.narrativeContext ? `NARRATIVE CONTEXT (current head):\n${args.narrativeContext}\n` : '',
    `QUESTION: ${args.question}`,
    args.perspectiveLabel ? `PERSPECTIVE: ${args.perspectiveLabel}` : '',
    `INTUITION: ${args.intuition}`,
    args.fixedOutcomes?.length ? `FIXED OUTCOMES (reuse verbatim, in order): ${JSON.stringify(args.fixedOutcomes)}` : '',
  ].filter(Boolean);

  const raw = await callGenerate(parts.join('\n'), SYSTEM, undefined, 'instantiateStream', DEFAULT_MODEL, 0);
  const parsed = parseJson(raw, 'instantiateStream') as Partial<StreamInstantiation>;

  // Outcomes — prefer fixed, else model, else binary fallback.
  let outcomes = args.fixedOutcomes?.length
    ? args.fixedOutcomes.slice()
    : (Array.isArray(parsed.outcomes) ? parsed.outcomes.filter((o): o is string => typeof o === 'string' && !!o.trim()).map((o) => o.trim()) : []);
  if (outcomes.length < 2) outcomes = ['Yes', 'No'];

  // priorProbs — clean, align length to outcomes, renormalise; uniform fallback.
  let probs = Array.isArray(parsed.priorProbs)
    ? parsed.priorProbs.map((p) => (typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : 0))
    : [];
  if (probs.length !== outcomes.length) probs = outcomes.map(() => 1);
  const sum = probs.reduce((s, p) => s + p, 0) || 1;
  probs = probs.map((p) => p / sum);

  const logType: ThreadLogNodeType =
    (['setup', 'escalation', 'twist', 'pulse', 'callback', 'resistance', 'payoff', 'stall', 'transition'] as const)
      .includes(parsed.logType as ThreadLogNodeType) ? (parsed.logType as ThreadLogNodeType) : 'setup';
  const horizon: ThreadHorizon =
    (['short', 'medium', 'long', 'epic'] as const).includes(parsed.horizon as ThreadHorizon)
      ? (parsed.horizon as ThreadHorizon) : 'medium';

  return {
    outcomes,
    priorProbs: probs,
    logType,
    horizon,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
  };
}

// ── Suggesting just the open question from a perspective ──────────────────────
// Split from the old combo (question + intuition) so each field has its own
// targeted suggester: the member can ask for a question, then — once they like
// it — ask for an intuition on THAT question (suggestIntuition below).
// When an AI player (agent) drives a perspective, its persona rides into the
// suggesters as a temperament block — it shapes the lean, framing, and risk
// posture without overriding the perspective's own goals/continuity.
const personaBlock = (persona?: string): string =>
  persona?.trim()
    ? `PLAYER PERSONA — you are operated by an AI player with this temperament. Let it shape your lean, framing, and risk posture, but do NOT override the perspective's own goals, stake, or continuity:\n${persona.trim()}`
    : '';

const SUGGEST_QUESTION_SYSTEM = `You help a team member open a BELIEF STREAM — a tracked open QUESTION of what THIS perspective should DO — from a SPECIFIC PERSPECTIVE in a narrative/world. Propose ONLY the question. Streams are action-first: the question is about a choice THIS perspective faces — what to DO — whose candidate moves they will then lean across. Frame it as a question of what to do ("What's my move on…?", "How do I…?", "Do I … or …?"), NOT as a detached prediction about whether some outcome happens. The result of any move is downstream and uncertain; the question is about the action.

CRITICAL — adopt the PERSPECTIVE strictly. The question must be one THIS perspective actually faces, framed around ITS OWN goals, stake, leverage, and information. Do NOT default to the story's protagonist or main character: if the perspective is a side / minor / rival / antagonist character — or a non-character vantage (location, artifact, faction, the narrator) — the question must be about what THAT vantage would do, in THAT vantage's interest. The CONTINUITY block IS this perspective's own situation — anchor on it. The WORLD context is shared background, not the subject; don't let it pull you toward whoever the story centres on.

A strong question is: SHORT (one plain sentence, ideally under ~15 words — a clean headline, not a loaded multi-clause sentence), genuinely OPEN (the right move is honestly unsettled right now), CONSEQUENTIAL to this perspective, and opens into SEVERAL real candidate moves (distinct plays, not a trivial go/no-go). Avoid: settled choices, vague mood questions, restatements of the situation, and compound questions that smuggle in their own answer. If ALREADY-OPEN questions are listed, propose a genuinely DIFFERENT question — not a rephrasing.

VOICE & CONCRETENESS — phrase it as THIS character's real preoccupation, in their own register, with the concrete stakes that actually matter to them. Name the real people, objects, places, factions, and capabilities from the CONTINUITY and WORLD by their actual names; never fall back on generic placeholders ("the rival", "the prize", "the resource", "the goal") when a real name exists. It should read like a choice this character is genuinely wrestling with, not an analyst's abstract query.
  GOOD: a concrete move this specific character is weighing — names the actual actors, place, and stakes from this world's continuity ("Do I storm the east gate now or wait for Karis's signal?").
  WEAK: "Will I secure the key resource before my competitor?" — abstract, voiceless, and a prediction rather than a decision.

Output ONLY JSON: {"question":"..."}`;

export async function suggestQuestion(args: {
  perspectiveLabel?: string;
  entityContext?: string;
  narrativeContext?: string;
  /** Questions already open on this perspective — propose something distinct. */
  existingQuestions?: string[];
  /** AI-player persona driving this perspective — shapes lean, framing, risk. */
  personaContext?: string;
}): Promise<string> {
  const user = [
    args.perspectiveLabel ? `PERSPECTIVE: ${args.perspectiveLabel}` : '',
    personaBlock(args.personaContext),
    args.entityContext ? `INNER WORLD — this perspective's traits, goals, secrets, relations, history (use it to think AS them, nuanced and alive):\n${args.entityContext}` : '',
    args.existingQuestions?.length ? `ALREADY OPEN (do NOT repeat or trivially rephrase these):\n${args.existingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : '',
    args.narrativeContext ? `WORLD:\n${args.narrativeContext}` : '',
  ].filter(Boolean).join('\n\n');
  const raw = await callGenerate(user || 'Propose an open question.', SUGGEST_QUESTION_SYSTEM, undefined, 'suggestQuestion', DEFAULT_MODEL, 0);
  const parsed = parseJson(raw, 'suggestQuestion') as { question?: unknown };
  return typeof parsed.question === 'string' ? parsed.question.trim() : '';
}

/** Suggest just an intuition for an already-chosen question (regenerate). */
export async function suggestIntuition(args: {
  question: string;
  perspectiveLabel?: string;
  entityContext?: string;
  narrativeContext?: string;
  /** AI-player persona driving this perspective — shapes lean, framing, risk. */
  personaContext?: string;
}): Promise<string> {
  const user = [
    `QUESTION: ${args.question}`,
    args.perspectiveLabel ? `PERSPECTIVE: ${args.perspectiveLabel}` : '',
    personaBlock(args.personaContext),
    args.entityContext ? `INNER WORLD — this perspective's traits, goals, secrets, relations, history (use it to think AS them, nuanced and alive):\n${args.entityContext}` : '',
    args.narrativeContext ? `WORLD:\n${args.narrativeContext}` : '',
  ].filter(Boolean).join('\n\n');
  const sys = `You write the first INTUITION on an open question of WHAT TO DO, strictly from the given PERSPECTIVE — a fragment of THIS character's stream of consciousness as they weigh the move, recorded in first person as they actually think it. You are capturing their inner voice deciding on a move, not analysing from outside. This is a prior, not an essay: 1–3 short, plain sentences — which move they're leaning toward, then the concrete personal reason.

HARD RULES:
- First person, in character. Speak AS them, in their register, temperament, and concerns — a recorded thought, not a neutral analyst's read.
- Lead with the LEANED MOVE — what they're inclined to DO ("I'll probably…", "I'm tempted to…", "Better to hold and…") — then the reason. It may name the result they're betting on, but that result is uncertain; the lean is on the action.
- Ground the reason in YOUR OWN situation, named concretely — a move you've already made, an ability or asset you hold, a fact you know, a named rival / place / object from your continuity. Never a generic abstraction.
- NO meta-preamble about your role or goals ("As the Narrator, my primary goal is…", "My objective here is…"). NO consultant / strategy-deck register ("optimal sequencing", "de-risk", "maximize eventual impact", "proving ground"). Plain words, the way the thought actually arrives.
- Anchor on the CONTINUITY (your own situation); do NOT default to the protagonist — the WORLD context is only shared background.

EXAMPLE SHAPE (the leaned move, then a concrete personal reason in the character's own voice): "I'll send the two runners up the east face at first light rather than wait for the others — I'm the only one here who's climbed it in winter, so the head start should hold."

Output ONLY JSON: {"intuition":"..."}`;
  const raw = await callGenerate(user, sys, undefined, 'suggestIntuition', DEFAULT_MODEL, 0);
  const parsed = parseJson(raw, 'suggestIntuition') as { intuition?: unknown };
  return typeof parsed.intuition === 'string' ? parsed.intuition.trim() : '';
}

/** Suggest the NEXT prior — a fresh observation from the perspective that
 *  builds on the priors so far (not a restatement). Returns prose for the
 *  composer; the member can edit before adding (then it's scored). Uniqueness is
 *  handled by prompting: the model reads the priors so far and reasons forward
 *  to the next most logical, genuinely new observation. */
export async function suggestPrior(args: {
  question: string;
  outcomes: string[];
  currentProbs?: number[];
  /** Existing prior texts, chronological. */
  priors: string[];
  perspectiveLabel?: string;
  entityContext?: string;
  narrativeContext?: string;
  /** AI-player persona driving this perspective — shapes lean, framing, risk. */
  personaContext?: string;
  /** Optional operator steer — free-text direction the suggestion should aim
   *  toward (e.g. "focus on the rival's next move"). Shapes WHAT the next prior
   *  is about; the in-vantage / genuinely-new disciplines still hold. */
  direction?: string;
}): Promise<string> {
  const dist = args.currentProbs?.length === args.outcomes.length
    ? args.outcomes.map((o, i) => `${o}: ${Math.round((args.currentProbs![i] ?? 0) * 100)}%`).join(', ')
    : '(uniform)';
  const priorsBlock = args.priors.length ? args.priors.map((t, i) => `${i + 1}. ${t}`).join('\n') : '(none yet)';
  const sys = `You propose the NEXT prior for a belief stream — the next fragment of THIS character's stream of consciousness as they keep weighing what to DO, recorded in first person as they actually think it. A stream is action-first: the OUTCOMES are the candidate MOVES this perspective is choosing between, and each prior nudges which move they lean toward. You are capturing their inner voice deliberating, not analysing from outside. Stay strictly in ITS vantage (its goals, stake, information, register, temperament). Do NOT default to the protagonist or main character; the CONTINUITY block is this perspective's own situation, the WORLD is shared background.

Read the PRIORS SO FAR as a chain of reasoning toward a decision and extract the NEXT MOST LOGICAL prior — the new consideration, fresh information, consequence weighed, or shift in leaning that naturally follows from where the thinking has reached. It MUST be genuinely new: never a restatement, paraphrase, or re-angle of any existing prior. If an obvious next step is already covered, advance past it to the one that isn't. Ground it in concrete detail from the available context (continuity, world, the candidate moves, current stance) rather than a vague gesture. 1–3 sentences.

When an OPERATOR DIRECTION is given, steer the next prior toward what it asks — the subject, angle, or development it points at — while keeping it in THIS perspective's voice, genuinely new, and honest to the stance. The direction sets the topic, not the conclusion; never let it become a restatement or an out-of-vantage leap.

KEEP IT RAW and IN VOICE: this is a recorded thought, not an essay. Speak as the character, naming concrete specifics from your continuity (real people, places, objects, capabilities) rather than generic abstractions. NO meta-preamble about your own role or goals ("As the X, my goal is…"). NO consultant / strategy-deck register ("optimal sequencing", "de-risk", "maximize impact"). Plain words, the way the thought actually arrives.

Output ONLY JSON: {"prior":"..."}`;
  const user = [
    `QUESTION: ${args.question}`,
    `OUTCOMES: ${JSON.stringify(args.outcomes)}`,
    `CURRENT STANCE: ${dist}`,
    args.direction?.trim() ? `OPERATOR DIRECTION (steer the next prior toward this; optional): ${args.direction.trim()}` : '',
    args.perspectiveLabel ? `PERSPECTIVE: ${args.perspectiveLabel}` : '',
    personaBlock(args.personaContext),
    args.entityContext ? `INNER WORLD — this perspective's traits, goals, secrets, relations, history (use it to think AS them, nuanced and alive):\n${args.entityContext}` : '',
    `PRIORS SO FAR (the reasoning chain to extend — your new prior must move BEYOND every one of these, never restate or rephrase them):\n${priorsBlock}`,
    args.narrativeContext ? `WORLD:\n${args.narrativeContext}` : '',
  ].filter(Boolean).join('\n\n');
  const raw = await callGenerate(user, sys, undefined, 'suggestPrior', DEFAULT_MODEL, 0);
  const parsed = parseJson(raw, 'suggestPrior') as { prior?: unknown };
  return typeof parsed.prior === 'string' ? parsed.prior.trim() : '';
}

/** Suggest a BRANCHING stream — priors leading to a new line of thought. Reads
 *  the originating stream's question + priors and proposes a DISTINCT sibling
 *  question the same perspective would now also want to track, plus a first
 *  intuition on it. Used by the "branch thought" quick action to open a new
 *  stream on the same perspective pair. */
export async function suggestBranchStream(args: {
  /** The originating stream's question. */
  fromQuestion: string;
  /** The originating stream's priors, chronological — the thinking to branch from. */
  priors: string[];
  /** Other open questions on this perspective — stay distinct from all of them. */
  existingQuestions?: string[];
  perspectiveLabel?: string;
  entityContext?: string;
  narrativeContext?: string;
  /** AI-player persona driving this perspective — shapes lean, framing, risk. */
  personaContext?: string;
  /** Optional operator steer — free-text direction the branch question should
   *  aim toward. Shapes WHICH sibling uncertainty is surfaced; the distinct /
   *  open / in-vantage / grows-from-priors disciplines still hold. */
  direction?: string;
}): Promise<{ question: string; intuition: string }> {
  const priorsBlock = args.priors.length ? args.priors.map((t, i) => `${i + 1}. ${t}`).join('\n') : '(none yet)';
  const sys = `A team member is recording priors on an open question of what to do from a PERSPECTIVE, and the thinking has BRANCHED — the priors so far have surfaced a NEW, related-but-separate question of what to do this perspective would now also want to deliberate as its own belief stream. Propose that branching question plus a first intuition on it, strictly from THIS perspective's vantage (its goals, stake, information, voice; first person for the intuition). Streams are action-first: the branch is another choice of what to DO, not a detached prediction. Do NOT default to the protagonist or main character.

The branch question must: be SHORT (one plain sentence, ideally under ~15 words — a clean headline, not a loaded multi-clause question), grow naturally OUT of the priors so far (a sibling decision the reasoning opened up, not a non-sequitur), be genuinely DISTINCT from the originating question and any ALREADY-OPEN questions (a different choice, not a rephrasing), be honestly OPEN and consequential to this perspective, and resolve into several real candidate moves. Frame it as a question of what to do ("What's my move on…?", "Do I … or …?"), phrased as this character's real preoccupation, naming the concrete people / places / objects in play (no generic placeholders). The intuition is a 1–2 sentence gut read (the leaned move + why) in the character's own voice — a fragment of their stream of consciousness, raw and plain, grounded in a concrete personal reason; no meta-preamble or strategy-deck abstractions.

When an OPERATOR DIRECTION is given, steer the branch toward the line it points at — pick the sibling uncertainty nearest that direction — while keeping it distinct, open, grown from the priors, and in THIS perspective's vantage. The direction chooses which branch to open, not its answer.

Output ONLY JSON: {"question":"...","intuition":"..."}`;
  const user = [
    `ORIGINATING QUESTION: ${args.fromQuestion}`,
    `PRIORS SO FAR (the thinking that branched — grow the new question OUT of these):\n${priorsBlock}`,
    args.direction?.trim() ? `OPERATOR DIRECTION (steer the branch toward this; optional): ${args.direction.trim()}` : '',
    args.existingQuestions?.length ? `ALREADY OPEN (stay DISTINCT from every one of these):\n${args.existingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : '',
    args.perspectiveLabel ? `PERSPECTIVE: ${args.perspectiveLabel}` : '',
    personaBlock(args.personaContext),
    args.entityContext ? `INNER WORLD — this perspective's traits, goals, secrets, relations, history (use it to think AS them, nuanced and alive):\n${args.entityContext}` : '',
    args.narrativeContext ? `WORLD:\n${args.narrativeContext}` : '',
  ].filter(Boolean).join('\n\n');
  const raw = await callGenerate(user, sys, undefined, 'suggestBranchStream', DEFAULT_MODEL, 0);
  const parsed = parseJson(raw, 'suggestBranchStream') as { question?: unknown; intuition?: unknown };
  return {
    question: typeof parsed.question === 'string' ? parsed.question.trim() : '',
    intuition: typeof parsed.intuition === 'string' ? parsed.intuition.trim() : '',
  };
}

// ── Scoring a new prior into evidence (mirrors thread calibration) ────────────
export type ScoredPrior = {
  updates: OutcomeEvidence[];
  logType: ThreadLogNodeType;
  volumeDelta: number;
  addOutcomes: string[];
};

const SCORE_SYSTEM = `You calibrate a BELIEF STREAM. A stream is ACTION-FIRST: it tracks an open question of what to do over a fixed set of candidate ACTIONS — the OUTCOMES array holds the MOVES this perspective is choosing between — and the stance is the perspective's leaning over which move to make (its intent), not a forecast of whether some result occurs. A new PRIOR — the perspective's next thought as it deliberates — has arrived. Read it and emit how it shifts the leaning across the moves.

Output ONLY JSON:
{
  "updates": [ { "outcome": "<one of the OUTCOMES (a candidate action), or a new one you are adding>", "evidence": <number in [-4, +4]> } ],
  "logType": "pulse|setup|escalation|payoff|twist|callback|resistance|stall|transition",
  "volumeDelta": <number ≥ 0, how much attention this prior adds (0–3 typical)>,
  "addOutcomes": [ "<new candidate action>" ]   // when the prior raises a move the current OUTCOMES don't capture
}

Score by how the thought moves INTENT: positive evidence on a move = the thought makes that action more attractive / more likely the one they take; negative = it argues that move down. A reason FOR one move and a reason AGAINST a rival move are both valid — put the evidence where the thought actually lands. The action it might produce is downstream and uncertain; score the lean on the action, not its hoped-for payoff.

Don't pigeonhole: if the prior raises a course of action the existing OUTCOMES miss, ADD it (in addOutcomes) and put your evidence there rather than forcing the thought into a poor-fitting move. The action set should grow as the deliberation reveals options. New actions start neutral; your evidence then moves them.

Evidence is a log-odds shift on each affected action's logit. Magnitudes: pulse ≈ 0 (acknowledged, no movement); setup/resistance ≈ ±1 (a consideration or doubt raised); escalation ≈ ±2–3 (a strong push toward or away from a move); twist = a reversal of the current lean (≥3 — the perspective swings to a different move); payoff ≈ +3–4 toward the move they commit to. Only list the moves the prior actually shifts. Be calibrated — most priors are small nudges as the thinking settles; committing to a move is rare.`;

export async function scoreStreamPrior(args: {
  question: string;
  outcomes: string[];
  /** Current probability per outcome (same order) — the stance to update from. */
  currentProbs?: number[];
  priorText: string;
  perspectiveLabel?: string;
}): Promise<ScoredPrior> {
  const dist = args.currentProbs?.length === args.outcomes.length
    ? args.outcomes.map((o, i) => `${o}: ${Math.round((args.currentProbs![i] ?? 0) * 100)}%`).join(', ')
    : '(uniform)';
  const user = [
    `QUESTION: ${args.question}`,
    `OUTCOMES: ${JSON.stringify(args.outcomes)}`,
    `CURRENT STANCE: ${dist}`,
    args.perspectiveLabel ? `PERSPECTIVE: ${args.perspectiveLabel}` : '',
    `PRIOR: ${args.priorText}`,
  ].filter(Boolean).join('\n');

  const raw = await callGenerate(user, SCORE_SYSTEM, undefined, 'scoreStreamPrior', DEFAULT_MODEL, 0);
  const parsed = parseJson(raw, 'scoreStreamPrior') as Partial<ScoredPrior>;

  const updates: OutcomeEvidence[] = Array.isArray(parsed.updates)
    ? parsed.updates
        .filter((u): u is OutcomeEvidence => !!u && typeof u.outcome === 'string' && typeof u.evidence === 'number' && Number.isFinite(u.evidence))
        .map((u) => ({ outcome: u.outcome.trim(), evidence: u.evidence }))
    : [];
  const logType: ThreadLogNodeType =
    (['setup', 'escalation', 'twist', 'pulse', 'callback', 'resistance', 'payoff', 'stall', 'transition'] as const)
      .includes(parsed.logType as ThreadLogNodeType) ? (parsed.logType as ThreadLogNodeType) : 'pulse';
  const volumeDelta = typeof parsed.volumeDelta === 'number' && Number.isFinite(parsed.volumeDelta)
    ? Math.max(0, parsed.volumeDelta) : 1;
  const addOutcomes = Array.isArray(parsed.addOutcomes)
    ? parsed.addOutcomes.filter((o): o is string => typeof o === 'string' && !!o.trim()).map((o) => o.trim())
    : [];

  return { updates, logType, volumeDelta, addOutcomes };
}
