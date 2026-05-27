/**
 * Paradigm-aware system-prompt composers for REVIEW surfaces.
 *
 * Three review passes the engine runs against a branch:
 *   • Prose review — evaluates rendered prose.
 *   • Branch review — structural critique from scene summaries.
 *   • Plan review — continuity check of beat plans.
 *
 * Per-paradigm criteria live in `./shapes.ts`; each builder composes them
 * with the analyst identity and paradigm-fidelity principle.
 */

import { PRINCIPLE_PARADIGM_FIDELITY } from '../principles';
import { composeAnalystIdentity, type WorkIdentity } from './identity';
import {
  BRANCH_REVIEW_CRITERIA_BY_PARADIGM,
  PLAN_REVIEW_CRITERIA_BY_PARADIGM,
  PROSE_REVIEW_CRITERIA_BY_PARADIGM,
} from './shapes';

// ─── Prose review ───────────────────────────────────────────────────────────

export function buildProseReviewSystem(work: WorkIdentity): string {
  const fallback = 'You are a prose editor evaluating actual rendered prose. The work may be a narrative, a simulation, an essay, a panel session, a typology, an adversarial contest, or a chronicled record — read the paradigm from the prose itself and apply criteria the work\'s own voice earns. Score on voice consistency, craft, pacing, continuity, repetition, and prose-profile compliance. Quote specific lines and assign verdict ok|edit per scene with concrete actionable issues — never vague. Return ONLY valid JSON matching the schema in the user prompt.';
  if (!work.paradigm) return fallback;
  const identity = composeAnalystIdentity(work);
  const criteria = PROSE_REVIEW_CRITERIA_BY_PARADIGM[work.paradigm];
  return `${identity}

${criteria}

${PRINCIPLE_PARADIGM_FIDELITY}

You are evaluating actual rendered prose. Score on voice consistency, craft (judged by the paradigm criteria above), pacing, continuity, repetition, and prose-profile compliance. Quote specific lines and assign verdict ok|edit per scene with concrete actionable issues — never vague. Return ONLY valid JSON matching the schema in the user prompt.`;
}

// ─── Branch review ──────────────────────────────────────────────────────────

export function buildBranchReviewSystem(work: WorkIdentity): string {
  const fallback = 'You are an editor reviewing a complete branch of a work from scene summaries only — no prose. The work may be a narrative (fiction or non-fiction), a rule-driven simulation, an essay, a panel session, a typology, an adversarial contest, or a chronicled record — evaluate against the paradigm\'s own criteria, not against fiction defaults. Assign a verdict per scene (ok / edit / merge / cut / move / insert) with concrete reasons. Encode cross-scene continuity into each edit reason — the rewriter sees only its scene. Return ONLY valid JSON matching the schema in the user prompt.';
  if (!work.paradigm) return fallback;
  const identity = composeAnalystIdentity(work);
  const criteria = BRANCH_REVIEW_CRITERIA_BY_PARADIGM[work.paradigm];
  return `${identity}

${criteria}

${PRINCIPLE_PARADIGM_FIDELITY}

You are reviewing a complete branch from scene/entry summaries only — no prose. Evaluate structure, pacing, repetition, entity development, threads, and theme through this paradigm's own criteria above. Assign a verdict per scene (ok / edit / merge / cut / move / insert) with concrete reasons. Encode cross-scene continuity into each edit reason — the rewriter sees only its scene. Return ONLY valid JSON matching the schema in the user prompt.`;
}

// ─── Plan review ────────────────────────────────────────────────────────────

export function buildPlanReviewSystem(work: WorkIdentity): string {
  const fallback = 'You are a continuity editor reviewing scene beat plans. For each scene check beat-to-delta alignment, cross-plan continuity, internal beat logic, entity knowledge, and spatial/temporal consistency. Plans may serve narrative, simulation, essay, panel, atlas, debate, or record paradigms — verify that each plan\'s shape matches its paradigm. Assign verdict ok|edit per scene with precise issue references (cite beat numbers). Return ONLY valid JSON matching the schema in the user prompt.';
  if (!work.paradigm) return fallback;
  const identity = composeAnalystIdentity(work);
  const criteria = PLAN_REVIEW_CRITERIA_BY_PARADIGM[work.paradigm];
  return `${identity}

${criteria}

${PRINCIPLE_PARADIGM_FIDELITY}

You are a continuity editor reviewing scene beat plans. For each scene check beat-to-delta alignment, cross-plan continuity, internal beat logic, entity knowledge, and spatial/temporal consistency — judged by the paradigm criteria above. Assign verdict ok|edit per scene with precise issue references (cite beat numbers). Return ONLY valid JSON matching the schema in the user prompt.`;
}
