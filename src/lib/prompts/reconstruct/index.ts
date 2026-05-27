/**
 * Branch reconstruction prompts — edit, merge, and insert scene operations
 * applied during versioned branch reconstruction. Each builder produces the
 * full user prompt; the caller pairs it with the matching SYSTEM builder
 * below. System builders accept WorkIdentity so the model receives the
 * paradigm + genre + subgenre + title upfront and applies the paradigm's
 * own discipline during reconstruction.
 */

import type { WorkIdentity } from '../paradigm-roles';
import { composeWorkIdentity } from '../paradigm-roles';
import { PRINCIPLE_PARADIGM_FIDELITY } from '../principles';

function identityPrelude(work?: WorkIdentity): string {
  if (!work?.title) return '';
  return `${composeWorkIdentity({ title: work.title, paradigm: work.paradigm, genre: work.genre, subgenre: work.subgenre })} `;
}

function fidelityCoda(work?: WorkIdentity): string {
  return work?.paradigm ? `\n\n${PRINCIPLE_PARADIGM_FIDELITY}` : '';
}

export function buildReconstructEditSystem(work?: WorkIdentity): string {
  return `${identityPrelude(work)}You are a continuity editor revising a single scene in a branch reconstruction. Address the evaluation reason precisely; preserve everything the reason does not touch; keep the scene at its current timeline position. Use only IDs supplied in context. Return ONLY valid JSON matching the schema in the user prompt.${fidelityCoda(work)}`;
}

export function buildReconstructMergeSystem(work?: WorkIdentity): string {
  return `${identityPrelude(work)}You are a continuity editor merging multiple scenes into ONE denser scene. Synthesize the strongest elements from all inputs; combine deltas without flattening unique knowledge; preserve the target scene's timeline position. Use only IDs supplied in context. Return ONLY valid JSON matching the schema in the user prompt.${fidelityCoda(work)}`;
}

export function buildReconstructInsertSystem(work?: WorkIdentity): string {
  return `${identityPrelude(work)}You are a scene generator filling a structural gap in a branch reconstruction. Generate one new scene that addresses the generation brief, advances at least one thread with a status transition, and integrates cleanly with the surrounding timeline. Use only IDs supplied in context. Return ONLY valid JSON matching the schema in the user prompt.${fidelityCoda(work)}`;
}

const SCENE_OUTPUT_SCHEMA_FULL = `{
  "locationId": "L-XX",
  "povId": "C-XX",
  "participantIds": ["C-XX"],
  "summary": "REQUIRED — WRITE THIS FIRST. This is the spine of the scene; every delta below must trace back to something stated here. Rich prose sentences using character NAMES and location NAMES (never raw IDs). Include specifics and context that shapes prose. No emotions/realizations as endings.",
  "artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX", "usage": "what the artifact did"}],
  "events": ["event_tag"],
  "threadDeltas": [{"threadId": "T-XX", "logType": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "updates": [{"outcome": "outcome name from thread.outcomes", "evidence": 1.5}], "volumeDelta": 1, "addOutcomes": ["optional — new outcome names when this scene opens a possibility not previously in the market"], "rationale": "the summary sentence that moved this thread's market in this scene"}],
  "worldDeltas": [{"entityId": "C-XX", "addedNodes": [{"id": "K-NEW-1", "content": "complete sentence: what they experienced or became", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
  "relationshipDeltas": [{"from": "C-XX", "to": "C-YY", "type": "short relation label — mentor, rival, ally, kin, debtor, peer, etc.", "valenceDelta": 0.1}],
  "systemDeltas": {"addedNodes": [], "addedEdges": []},
  "tieDeltas": [{"locationId": "L-XX", "characterId": "C-XX", "action": "add|remove"}]
}`;

const SCENE_OUTPUT_SCHEMA_MERGE = `{
  "locationId": "L-XX",
  "povId": "C-XX",
  "participantIds": ["C-XX"],
  "summary": "REQUIRED — WRITE THIS FIRST. This is the spine of the merged scene; every delta below must trace back to something stated here. Rich prose sentences using character NAMES (never IDs) combining the strongest elements from all merged scenes.",
  "artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX", "usage": "what the artifact did"}],
  "events": ["event_tag"],
  "threadDeltas": [{"threadId": "T-XX", "logType": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "updates": [{"outcome": "outcome name from thread.outcomes", "evidence": 1.5}], "volumeDelta": 1, "addOutcomes": ["optional — new outcome names when this scene opens a possibility not previously in the market"], "rationale": "the summary sentence that moved this thread's market in this scene"}],
  "worldDeltas": [{"entityId": "C-XX", "addedNodes": [{"id": "K-NEW-1", "content": "complete sentence: what they experienced or became", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
  "relationshipDeltas": [{"from": "C-XX", "to": "C-YY", "type": "short relation label — mentor, rival, ally, kin, debtor, peer, etc.", "valenceDelta": 0.1}],
  "systemDeltas": {"addedNodes": [], "addedEdges": []}
}`;

export type EditSceneEvaluation = {
  thematicQuestion?: string;
  repetitions: string[];
};

export function buildEditScenePrompt(args: {
  context: string;
  reason: string;
  evaluation: EditSceneEvaluation;
  surroundingContext: string;
  currentSceneJson: string;
}): string {
  const { context, reason, evaluation, surroundingContext, currentSceneJson } = args;

  return `<inputs>
  <narrative-context>
${context}
  </narrative-context>
  <evaluation-reason>${reason}</evaluation-reason>
${evaluation.thematicQuestion ? `  <thematic-question>${evaluation.thematicQuestion}</thematic-question>` : ''}
${evaluation.repetitions.length > 0 ? `  <patterns-to-avoid>${evaluation.repetitions.join('; ')}</patterns-to-avoid>` : ''}
  <surrounding-context>
${surroundingContext}
  </surrounding-context>
  <current-scene>
${currentSceneJson}
  </current-scene>
</inputs>

<instructions>
  <task>You are editing a scene as part of a branch reconstruction. Address the evaluation reason by revising the scene.</task>
  <step>You may change ANYTHING — POV, location, participants, events, deltas, summary — to fix the issue. Return ONLY the fields you are changing (omit unchanged fields). If the fix requires structural changes (different POV, different location), make them.</step>
  <rules>
    <rule>Keep the scene at this position in the timeline (between previous and next scene).</rule>
    <rule>Use only existing character, location, and thread IDs from the context.</rule>
    <rule>Maintain continuity with surrounding scenes.</rule>
    <rule>Address the evaluation reason directly.</rule>
    <rule>Every threadDelta MUST include 1-2 addedNodes log entries describing what happened to THAT thread in THIS scene (pulse/transition/setup/escalation/payoff/twist/callback/resistance/stall). If you omit them the thread log goes blank.</rule>
    <rule>Every worldDelta should list its nodes in causal/temporal order — adjacent nodes auto-chain (no explicit edges).</rule>
  </rules>
</instructions>

<output-format>
Return JSON:
${SCENE_OUTPUT_SCHEMA_FULL}
</output-format>`;
}

export function buildMergeScenesPrompt(args: {
  context: string;
  reason: string;
  evaluation: EditSceneEvaluation;
  surroundingContext: string;
  targetSceneJson: string;
  sourceBlock: string;
}): string {
  const { context, reason, evaluation, surroundingContext, targetSceneJson, sourceBlock } = args;

  return `<inputs>
  <narrative-context>
${context}
  </narrative-context>
  <evaluation-reason>${reason}</evaluation-reason>
${evaluation.thematicQuestion ? `  <thematic-question>${evaluation.thematicQuestion}</thematic-question>` : ''}
${evaluation.repetitions.length > 0 ? `  <patterns-to-avoid>${evaluation.repetitions.join('; ')}</patterns-to-avoid>` : ''}
  <surrounding-context>
${surroundingContext}
  </surrounding-context>
  <target-scene hint="This scene survives — its position in the timeline is preserved.">
${targetSceneJson}
  </target-scene>
  <scenes-being-absorbed hint="These will be removed — extract their unique value.">
${sourceBlock}
  </scenes-being-absorbed>
</inputs>

<instructions>
  <task>Merge multiple scenes into a single, denser scene. The evaluation found these scenes covered the same dramatic territory and should be combined. Produce ONE scene that preserves the best elements from all inputs.</task>
  <rules>
    <rule>The output is ONE scene, not multiple. It replaces the target scene.</rule>
    <rule>You may change POV, location, and participants if the absorbed content demands it.</rule>
    <rule>Combine thread deltas from all scenes — if the target advances T-1 and a source advances T-3, the merged scene should advance both. Each threadDelta MUST include 1-2 addedNodes log entries describing what happened to THAT thread in the merged scene.</rule>
    <rule>Combine world and relationship deltas — deduplicate but preserve unique knowledge. List world nodes in causal/temporal order (adjacent nodes auto-chain).</rule>
    <rule>The summary must use character NAMES and location NAMES (never raw IDs) and weave the best elements from all inputs into a cohesive narrative beat.</rule>
    <rule>Do NOT simply concatenate summaries. Synthesize them into a single dramatic moment.</rule>
    <rule>Use only existing character, location, and thread IDs from the context above.</rule>
  </rules>
</instructions>

<output-format>
Return JSON:
${SCENE_OUTPUT_SCHEMA_MERGE}
</output-format>`;
}

export function buildInsertScenePrompt(args: {
  context: string;
  brief: string;
  evaluation: EditSceneEvaluation;
}): string {
  const { context, brief, evaluation } = args;

  return `<inputs>
  <narrative-context>
${context}
  </narrative-context>
  <generation-brief>${brief}</generation-brief>
${evaluation.thematicQuestion ? `  <thematic-question>${evaluation.thematicQuestion}</thematic-question>` : ''}
${evaluation.repetitions.length > 0 ? `  <patterns-to-avoid>${evaluation.repetitions.join('; ')}</patterns-to-avoid>` : ''}
</inputs>

<instructions>
  <task>Generate a NEW scene that addresses the generation brief. The evaluator identified a gap in the narrative that needs filling.</task>
  <rules>
    <rule>Use only existing character, location, and thread IDs from the context.</rule>
    <rule>Advance at least one thread with a status transition.</rule>
    <rule>Every threadDelta MUST include 1-2 addedNodes log entries (pulse/transition/setup/escalation/payoff/twist/callback/resistance/stall) describing what happened to THAT thread in THIS scene. Missing log entries leave the thread log blank.</rule>
    <rule>List each worldDelta's nodes in causal/temporal order — adjacent nodes auto-chain into the entity's world graph.</rule>
  </rules>
</instructions>

<output-format>
Return JSON:
${SCENE_OUTPUT_SCHEMA_FULL}
</output-format>`;
}
