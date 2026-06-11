/**
 * Stream instantiation — AI-seeds a new stream's belief from a member's
 * initial intuition, the same way a Fate Thread is born with `priorProbs`.
 *
 * Given an open question and the member's intuition (from their perspective),
 * the model proposes a small set of mutually-exclusive outcomes and an in-world
 * base-rate probability vector over them — which `deriveInitialLogits` turns
 * into the opening stance (see `lib/forces/stream-stance.ts`). When a member
 * copies another stream's question, the outcomes are fixed and the model only
 * re-estimates `priorProbs` from the new member's intuition.
 */

import type { OutcomeEvidence, ThreadHorizon, ThreadLogNodeType } from '@/types/narrative';
import { PREDICTIVE_MODEL } from '@/lib/constants';
import { callGenerate } from './api';
import { parseJson } from './json';

export type StreamInstantiation = {
  outcomes: string[];
  priorProbs: number[];
  logType: ThreadLogNodeType;
  horizon: ThreadHorizon;
  rationale: string;
};

const SYSTEM = `You instantiate a BELIEF STREAM — one member's open question plus their gut intuition — into a probabilistic stance, exactly like a prediction-market question is opened.

Given the QUESTION and the member's INTUITION (their reasoning from a specific perspective), produce:
- outcomes: the mutually-exclusive, collectively-exhaustive ways the question actually resolves. PREFER 3–5 specific, meaningful outcomes that capture the real branches of possibility — do NOT pigeonhole into "Yes/No" unless the question is genuinely a true binary with no informative middle. We are calibrating against reality, so the outcome set should carve the decision space at its real joints (e.g. degrees, distinct mechanisms, who/what, magnitude bands). Short noun phrases. If FIXED OUTCOMES are supplied, you MUST reuse them verbatim and in order.
- priorProbs: a probability vector (one per outcome, SAME ORDER, summing to ~1.0) that encodes the member's intuition as an in-world base rate. Confident intuition → skewed; hedged intuition → flatter. Never fully saturate (keep each in ~0.05–0.9).
- logType: the perceptual primitive the intuition reads as — usually "setup" (a forward-looking read); "escalation" if it asserts rising pressure, "twist" if it overturns an obvious expectation.
- horizon: "short" | "medium" | "long" | "epic" — how far resolution sits.
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

  const raw = await callGenerate(parts.join('\n'), SYSTEM, undefined, 'instantiateStream', PREDICTIVE_MODEL, 0);
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

const SUGGEST_QUESTION_SYSTEM = `You help a team member open a BELIEF STREAM — a tracked open question they hold a probabilistic stance on — from a SPECIFIC PERSPECTIVE in a narrative/world. Propose ONLY the question.

CRITICAL — adopt the PERSPECTIVE strictly. The question must be what THIS perspective would actually ask, framed around ITS OWN goals, stake, leverage, and information. Do NOT default to the story's protagonist or main character: if the perspective is a side / minor / rival / antagonist character — or a non-character vantage (location, artifact, faction, the narrator) — the question must be about what THAT vantage cares about, in THAT vantage's interest. The CONTINUITY block IS this perspective's own situation — anchor on it. The WORLD context is shared background, not the subject; don't let it pull you toward whoever the story centres on.

A strong question is: SHORT (one plain sentence, ideally under ~15 words — a clean headline, not a loaded multi-clause sentence with caveats baked in), genuinely OPEN (the answer is honestly uncertain right now), CONSEQUENTIAL to this perspective, DECISION-RELEVANT, and resolves through SEVERAL real branches — it carves the future at a real joint (who/what prevails, degree, mechanism, magnitude band, timing). Avoid: yes/no trivialities, questions already settled by the continuity, vague mood questions, restatements of the situation, and long compound questions that smuggle in their own answer. If ALREADY-OPEN questions are listed, propose something genuinely DIFFERENT — a distinct uncertainty, not a rephrasing.

VOICE & CONCRETENESS — phrase it as THIS character's real preoccupation, in their own register, with the concrete stakes that actually matter to them. Name the real people, objects, places, factions, and capabilities from the CONTINUITY and WORLD by their actual names; never fall back on generic placeholders ("the rival", "the prize", "the resource", "the goal") when a real name exists. It should read like a worry this character is genuinely carrying, not an analyst's abstract query.
  GOOD: names the actual actors, the actual prize, and the real stakes drawn from this world's continuity — a concrete question this specific character would lie awake on.
  WEAK: "Will I secure the key resource before my competitor?" — abstract, voiceless, generic; could belong to anyone in any story.

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
  const raw = await callGenerate(user || 'Propose an open question.', SUGGEST_QUESTION_SYSTEM, undefined, 'suggestQuestion', PREDICTIVE_MODEL, 0);
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
  const sys = `You write the first INTUITION on an open QUESTION strictly from the given PERSPECTIVE — a fragment of THIS character's stream of consciousness, recorded in first person as they actually think it. You are capturing their inner voice, not analysing from outside. This is a prior, not an essay: 1–3 short, plain sentences — where they lean, then the concrete personal reason they lean that way.

HARD RULES:
- First person, in character. Speak AS them, in their register, temperament, and concerns — a recorded thought, not a neutral analyst's read.
- Lead with the lean ("Probably.", "I doubt it.", "Leaning toward…"), then the reason.
- Ground the reason in YOUR OWN situation, named concretely — a move you've already made, an ability or asset you hold, a fact you know, a named rival / place / object from your continuity. Never a generic abstraction.
- NO meta-preamble about your role or goals ("As the Narrator, my primary goal is…", "My objective here is…"). NO consultant / strategy-deck register ("optimal sequencing", "de-risk", "maximize eventual impact", "proving ground"). Plain words, the way the thought actually arrives.
- Anchor on the CONTINUITY (your own situation); do NOT default to the protagonist — the WORLD context is only shared background.

EXAMPLE SHAPE (the lean, then a concrete personal reason in the character's own voice): "I doubt the others reach the cache before me — I sent two runners up the east face at first light, and I'm the only one here who's climbed it in winter."

Output ONLY JSON: {"intuition":"..."}`;
  const raw = await callGenerate(user, sys, undefined, 'suggestIntuition', PREDICTIVE_MODEL, 0);
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
  const sys = `You propose the NEXT prior for a belief stream — the next fragment of THIS character's stream of consciousness, recorded in first person as they actually think it. You are capturing their inner voice as the thinking continues, not analysing from outside. Stay strictly in ITS vantage (its goals, stake, information, register, temperament). Do NOT default to the protagonist or main character; the CONTINUITY block is this perspective's own situation, the WORLD is shared background.

Read the PRIORS SO FAR as a chain of reasoning and extract the NEXT MOST LOGICAL prior — the development, consequence, move, or consideration that naturally follows from where the thinking has reached. It MUST be genuinely new: never a restatement, paraphrase, or re-angle of any existing prior. If an obvious next step is already covered, advance past it to the one that isn't. Ground the new prior in concrete detail from the available context (continuity, world, current stance) rather than a vague gesture. 1–3 sentences.

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
  const raw = await callGenerate(user, sys, undefined, 'suggestPrior', PREDICTIVE_MODEL, 0);
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
  const sys = `A team member is recording priors on an open QUESTION from a PERSPECTIVE, and the thinking has BRANCHED — the priors so far have surfaced a NEW, related-but-separate uncertainty this perspective would now also want to track as its own belief stream. Propose that branching question plus a first intuition on it, strictly from THIS perspective's vantage (its goals, stake, information, voice; first person for the intuition). Do NOT default to the protagonist or main character.

The branch question must: be SHORT (one plain sentence, ideally under ~15 words — a clean headline, not a loaded multi-clause question), grow naturally OUT of the priors so far (a sibling line the reasoning opened up, not a non-sequitur), be genuinely DISTINCT from the originating question and any ALREADY-OPEN questions (a different uncertainty, not a rephrasing), be honestly OPEN and consequential to this perspective, and resolve through several real branches. Phrase it as this character's real preoccupation, naming the concrete people / places / objects in play (no generic placeholders). The intuition is a 1–2 sentence gut read (lean + why) in the character's own voice — a fragment of their stream of consciousness, raw and plain, grounded in a concrete personal reason; no meta-preamble or strategy-deck abstractions.

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
  const raw = await callGenerate(user, sys, undefined, 'suggestBranchStream', PREDICTIVE_MODEL, 0);
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

const SCORE_SYSTEM = `You calibrate a BELIEF STREAM. The stream tracks an open QUESTION over a fixed set of OUTCOMES, holding a probabilistic stance. A new PRIOR (an observation/update) has arrived. Read it and emit how it moves the stance — exactly like updating a prediction-market thread.

Output ONLY JSON:
{
  "updates": [ { "outcome": "<one of the OUTCOMES, or a new one you are adding>", "evidence": <number in [-4, +4]> } ],
  "logType": "pulse|setup|escalation|payoff|twist|callback|resistance|stall|transition",
  "volumeDelta": <number ≥ 0, how much attention this prior adds (0–3 typical)>,
  "addOutcomes": [ "<new outcome name>" ]   // when the prior points to a real possibility the current OUTCOMES don't capture
}

Don't pigeonhole: if the prior surfaces a branch the existing OUTCOMES miss, ADD it (in addOutcomes) and put your evidence on it rather than forcing the prior into a poor-fitting existing outcome. We're calibrating against reality — the outcome set should grow as reality reveals options. New outcomes start neutral; your evidence then moves them.

Evidence is a log-odds shift on each affected outcome's logit. Magnitudes: pulse ≈ 0 (acknowledged, no movement); setup/resistance ≈ ±1; escalation ≈ ±2–3; twist = a reversal of the prior lean (≥3); payoff ≈ +3–4 toward the resolving outcome. Only list outcomes the prior actually moves. Be calibrated — most priors are small nudges, but adding a genuinely new outcome is encouraged when warranted.`;

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

  const raw = await callGenerate(user, SCORE_SYSTEM, undefined, 'scoreStreamPrior', PREDICTIVE_MODEL, 0);
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
