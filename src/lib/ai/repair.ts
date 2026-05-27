import { callGenerate } from './api';
import { ANALYSIS_MODEL, MAX_TOKENS_LARGE } from '@/lib/constants';
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

/**
 * LLM-assisted JSON repair. Given the raw malformed output from a generation
 * call, ask a cheap model to return the same content as valid JSON — same
 * structure, no commentary. Cheaper / faster than a full re-run because the
 * model only has to fix structure it can already see, not regenerate the
 * payload from prompt.
 *
 * Three layers of context get composed into the repair system prompt:
 *  1. baseline JSON-cleanup rules (preserve fields, no commentary, etc.)
 *  2. caller-specific schema + purpose (from the original generator)
 *  3. diagnostic hint produced by the auto-diagnose pass (parse error,
 *     truncation, unescaped quotes — whatever was identified)
 */
export async function repairJsonOutput(
  raw: string,
  caller: string,
  /** Diagnostic instruction from the UI's auto-diagnose pass — names the
   *  specific failure mode the model should focus on (e.g. "truncated mid
   *  payload", "unescaped quotes inside string values"). When supplied, the
   *  repair LLM sees this as the load-bearing directive on top of the
   *  generic syntax-cleanup baseline. */
  repairHint?: string,
): Promise<string> {
  const ctx = getRepairContext(caller);

  const baseRole = `You are a strict JSON repair tool. The user provides malformed JSON output from another model. Return the SAME content as valid JSON — preserve all field values, never invent new fields, never drop fields, never add commentary. Output ONLY the JSON object or array, no markdown fences, no prose.`;
  const truncationRule = `If the input looks truncated (an array or object is open at the end), CLOSE it with the minimum brackets needed and leave the last value as it appears. Do not pad or invent items to "complete" a list.`;
  const contextBlock = ctx
    ? `\n\n<original-caller>${caller}</original-caller>\n<purpose>${ctx.purpose}</purpose>\n<expected-shape hint="This is the EXACT schema the original generator was asked for — preserve every key and every entity, only fix structural problems.">\n${ctx.schema}\n</expected-shape>\n<priority>Preserve every id and every nested entity. The downstream pipeline is keyed on the ids inside this payload — losing or renaming any of them corrupts the graph.</priority>`
    : '';
  const hintBlock = repairHint
    ? `\n\n<diagnosed-issue hint="Auto-diagnosed at fail-time. Focus your fix on this; the rest is precaution.">\n${repairHint}\n</diagnosed-issue>`
    : '';
  const systemPrompt = baseRole + ' ' + truncationRule + contextBlock + hintBlock;

  const userPrompt = `Fix the following malformed JSON. Return valid JSON with the same content.\n\n<malformed>\n${raw}\n</malformed>`;

  const fixed = await callGenerate(
    userPrompt,
    systemPrompt,
    MAX_TOKENS_LARGE,
    `${caller}:repair`,
    ANALYSIS_MODEL,
    0, // no reasoning needed — pure mechanical cleanup
    true,
  );
  return cleanJson(fixed);
}
