import { callGenerate } from './api';
import { ANALYSIS_MODEL, MAX_TOKENS_LARGE, MAX_TOKENS_SMALL } from '@/lib/constants';
import { cleanJson } from './json';
import { buildScenesOutputSchema } from '@/lib/prompts/scenes/generate';
import { buildNarrativeOutputSchema } from '@/lib/prompts/world/generate-narrative';
import { buildExpandWorldOutputSchema } from '@/lib/prompts/world/expand-world';

/**
 * Per-caller repair context. The schema spec is sourced from the SAME builder
 * the generation prompt uses, so changes to the output shape automatically
 * propagate to repair — no drift between what we ask the generator for and
 * what we tell the repair model to preserve. Repair-time arg placeholders
 * (`<from-input>`) are used because the repair model only needs the SHAPE,
 * not the specific id-prefix interpolation values the original call had.
 */
type RepairContext = { purpose: string; schema: string };

function getRepairContext(caller: string): RepairContext | null {
  if (caller === 'generateNarrative') {
    return {
      purpose:
        'Initial world view generation. The JSON spawns a complete narrative state (characters, locations, threads, an introduction arc with scenes, plus a proseProfile). Every entity downstream is keyed on the ids inside this payload — preserve every id and every entity exactly. Truncated arrays should be closed; never invent missing entities.',
      // Repair sees both shapes — most failures are scene-bearing, but
      // worldOnly mode is structurally distinct. Including the full
      // worldOnly=false shape covers the common case + matches the
      // generation prompt's verbose schema 1:1.
      schema: buildNarrativeOutputSchema({ worldOnly: false }),
    };
  }
  if (caller === 'generateScenes') {
    return {
      purpose:
        'Arc + scenes generation. The JSON produces one arc with several scenes worth of structural deltas. Every scene must keep its id, arcId, locationId, participantIds, threadDeltas, worldDeltas, systemDeltas and summary — those are the spine the downstream pipeline reads.',
      schema: buildScenesOutputSchema({ arcId: '<from-input>', povRestrictedHint: '' }),
    };
  }
  if (caller === 'expandWorld') {
    return {
      purpose:
        'World expansion. The JSON adds entities + deltas to an existing narrative. Preserve every id and every entity exactly — id collisions or invented entities corrupt downstream graphs.',
      schema: buildExpandWorldOutputSchema({
        nextCharId: '<from-input>',
        nextLocId: '<from-input>',
        nextThreadId: '<from-input>',
        nextArtifactId: '<from-input>',
        nextKId: '<from-input>',
      }),
    };
  }
  return null;
}

/** Output of the diagnosis stage. The repair stage only runs when
 *  `fixable` is true; otherwise the issue explains why the output can't
 *  be salvaged (e.g. the model produced reasoning text instead of JSON). */
export type RepairPlan = {
  fixable: boolean;
  /** One- or two-sentence description of what went wrong. */
  issue: string;
  /** Step-by-step instructions for the repair stage. Empty when
   *  `fixable` is false. */
  plan: string;
};

/**
 * Stage 1 — diagnose + plan.
 *
 * An LLM reads the actual malformed output (not just the error type) plus
 * the expected schema, decides whether the content is even fixable, and
 * writes a step-by-step plan for the repair stage. Pure pattern matching
 * (see diagnose.ts) catches obvious cases like auth / timeout / 5xx, but
 * misses the failure mode this stage exists for: the model returned
 * something that LOOKS plausible (preamble, reasoning, half a JSON, a
 * refusal) but isn't valid JSON. Eyeballing the raw is the only way to
 * tell, and that's what an LLM can do here.
 */
export async function planRepair(
  raw: string,
  caller: string,
  /** Original parse / network error message for context, if available. */
  originalError?: string,
): Promise<RepairPlan> {
  const ctx = getRepairContext(caller);
  const schemaBlock = ctx
    ? `\n\n<expected-shape>\n${ctx.schema}\n</expected-shape>\n<purpose>${ctx.purpose}</purpose>`
    : '';

  const systemPrompt = `You are a JSON-repair diagnostician. The user provides output from another LLM that was supposed to be valid JSON matching a specific schema. Your job is to inspect the actual content (not just the error type), decide whether it can be repaired into valid JSON matching the schema, and write a step-by-step plan for the repair model.

Return ONLY a JSON object with this exact shape:
{
  "fixable": boolean,
  "issue": "1-2 sentence description of what went wrong",
  "plan": "step-by-step instructions for the repair stage, or empty string when fixable is false"
}

Set fixable=false when ANY of:
  - The output is reasoning / preamble / planning text without JSON structure (e.g. "Let me think about...", "I'll start by...", "First, I need to...")
  - The output is a refusal, apology, or off-topic response
  - The output is empty or whitespace only
  - The output is so corrupted recovery would require regenerating from scratch
  - The output contains JSON that does not match the expected schema at all (wrong fields, wrong shape)

Set fixable=true when:
  - JSON structure is present with recoverable syntax errors (unescaped quotes, missing commas, unquoted bareword values, trailing junk)
  - The JSON is truncated mid-payload but the visible portion is parseable and the schema is the right shape
  - Bracket imbalances that can be closed with minimal brackets

When fixable=true, the plan should name the SPECIFIC structural fixes needed (e.g. "Close the open array at the end with ]. Then escape the unescaped double quotes inside the description field at position ~420. Preserve every id and every nested entity verbatim."). Do not write generic advice; cite what you can see in the input.

Output ONLY the JSON object — no markdown fences, no prose.${schemaBlock}`;

  const errorBlock = originalError
    ? `\n\n<original-error>\n${originalError}\n</original-error>`
    : '';
  const userPrompt = `Diagnose the following output.${errorBlock}\n\n<output>\n${raw}\n</output>`;

  const response = await callGenerate(
    userPrompt,
    systemPrompt,
    MAX_TOKENS_SMALL,
    `${caller}:diagnose`,
    ANALYSIS_MODEL,
    0,
    true,
  );

  const cleaned = cleanJson(response);
  try {
    const parsed = JSON.parse(cleaned) as Partial<RepairPlan>;
    return {
      fixable: typeof parsed.fixable === 'boolean' ? parsed.fixable : false,
      issue: typeof parsed.issue === 'string' ? parsed.issue : 'Diagnosis did not return an issue description.',
      plan: typeof parsed.plan === 'string' ? parsed.plan : '',
    };
  } catch {
    // Diagnosis model failed to return parseable JSON — fall back to a
    // conservative "fixable, generic plan" so the repair stage still runs.
    return {
      fixable: true,
      issue: 'Diagnosis stage did not return parseable JSON; repair stage will attempt a generic structural fix.',
      plan: 'Apply standard JSON-syntax fixes: balance brackets, escape unescaped quotes inside string values, add missing commas, quote bare values that should be strings. Preserve every key and every value verbatim.',
    };
  }
}

/**
 * Stage 2 — implement the fix.
 *
 * Receives the plan from `planRepair` (or generates one if `plan` is
 * omitted) and applies it to the raw malformed output. The system prompt
 * pins the model to the original caller's schema so structural
 * preservation is the load-bearing constraint, not "guess what this should
 * have been."
 *
 * Composition layers in the repair system prompt:
 *  1. baseline JSON-cleanup rules (preserve fields, no commentary, etc.)
 *  2. caller-specific schema + purpose (from the original generator)
 *  3. the plan produced by the diagnosis stage
 */
export async function repairJsonOutput(
  raw: string,
  caller: string,
  /** Pre-computed plan from `planRepair`. When omitted, this function
   *  calls `planRepair` itself so callers can do "one-shot" repair without
   *  orchestrating both stages. If the plan reports the output is not
   *  fixable, this function throws with the diagnosed issue. */
  plan?: RepairPlan,
): Promise<string> {
  const ctx = getRepairContext(caller);
  const resolved = plan ?? (await planRepair(raw, caller));

  if (!resolved.fixable) {
    throw new Error(`[${caller}:repair] Output is not repairable — ${resolved.issue}`);
  }

  const baseRole = `You are a strict JSON repair tool. The user provides malformed JSON output from another model along with a diagnosis-stage plan describing what specifically needs to be fixed. Implement the plan: return the SAME content as valid JSON — preserve all field values, never invent new fields, never drop fields, never add commentary. Output ONLY the JSON object or array, no markdown fences, no prose.`;
  const truncationRule = `If the input is truncated, CLOSE it with the minimum brackets needed and leave the last value as it appears. Do not pad or invent items to "complete" a list.`;
  const contextBlock = ctx
    ? `\n\n<original-caller>${caller}</original-caller>\n<purpose>${ctx.purpose}</purpose>\n<expected-shape hint="This is the EXACT schema the original generator was asked for — preserve every key and every entity, only fix structural problems.">\n${ctx.schema}\n</expected-shape>\n<priority>Preserve every id and every nested entity. The downstream pipeline is keyed on the ids inside this payload — losing or renaming any of them corrupts the graph.</priority>`
    : '';
  const planBlock = `\n\n<diagnosed-issue>\n${resolved.issue}\n</diagnosed-issue>\n<repair-plan hint="Produced by the diagnosis stage from inspecting the actual output. Implement these steps; the rest is precaution.">\n${resolved.plan}\n</repair-plan>`;
  const systemPrompt = baseRole + ' ' + truncationRule + contextBlock + planBlock;

  const userPrompt = `Implement the repair plan on the following malformed JSON. Return valid JSON with the same content.\n\n<malformed>\n${raw}\n</malformed>`;

  const fixed = await callGenerate(
    userPrompt,
    systemPrompt,
    MAX_TOKENS_LARGE,
    `${caller}:repair`,
    ANALYSIS_MODEL,
    0, // no reasoning needed — plan is already there, this stage is mechanical
    true,
  );
  return cleanJson(fixed);
}
