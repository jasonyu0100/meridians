/**
 * INFERENCE-SHAPE — the universal 5-field discipline.
 *
 * Every reasoning artifact in the engine carries the same five fields so the
 * model and the operator agree on what each field is FOR. CRG nodes, PRG
 * nodes, Compass directions, Present coordinations, Investigation steps,
 * conclusions — all carry this shape. Calibrated identically means the
 * fields can be compared, composed, and rendered uniformly.
 *
 *   • description — gestalt; ≤14 words. WHAT the configuration IS as a
 *                   recognisable shape, in the work's native register.
 *   • reasoning   — load-bearing logic; 3–5 sentences. WHY this read earns
 *                   its place — cascades, mechanisms, why these intensities,
 *                   why this priorLogit and not a notch off. Substantive,
 *                   not paraphrase.
 *   • considered  — option space (REQUIRED); 1–3 sentences. Adjacent reads
 *                   considered and rejected, rival siblings this one contrasts
 *                   against, alternative coordinations drafted and discarded.
 *                   Comparative reasoning, not summary. If no genuine rival
 *                   applies, say so explicitly — never omit.
 *   • breaks      — falsification handle; 1–2 sentences. What observation
 *                   would mean this read isn't right — the threshold whose
 *                   non-crossing voids it, the load-bearing assumption whose
 *                   breakage rules it out. If you can't name one, this isn't
 *                   forecasting / reasoning — it's description.
 *   • opens       — forward extension; 1–2 sentences. If this holds, what
 *                   cascades downstream — threads opened, markets perturbed,
 *                   affordances granted, layers that inherit.
 *
 * One source of truth for: prompt blocks, schema fragments, type imports.
 */

/** The five field names as a tuple — useful for runtime iteration. */
export const INFERENCE_SHAPE_FIELDS = [
  'description',
  'reasoning',
  'considered',
  'breaks',
  'opens',
] as const;

export type InferenceShapeField = (typeof INFERENCE_SHAPE_FIELDS)[number];

/** The universal inference-shape data, optional everywhere (the type's
 *  consumers fill what they have). Mirrors what's on PlanningScenario,
 *  reasoning-graph nodes, Present extractions, etc. */
export type InferenceShape = {
  description?: string;
  reasoning?: string;
  considered?: string;
  breaks?: string;
  opens?: string;
};

/** Prompt block — full canonical definition of the five fields. Include this
 *  in any system prompt that asks the model to emit the inference-shape. */
export const INFERENCE_SHAPE_PROMPT = `INFERENCE-SHAPE — the universal five-field discipline carried by every reasoning artifact in the engine (Compass directions, Present coordinations, CRG nodes, PRG nodes, Investigation steps). Calibrated identically across surfaces.

  • description — one sentence (≤ 14 words). Gestalt of the read — what the configuration IS as a recognisable shape, in the work's native register.
  • reasoning — 3–5 sentences. Load-bearing logic — which mechanisms feed which, why these intensities, why this priorLogit and not a notch off. Substantive, not paraphrase. Name actors / mechanisms / threads where it sharpens.
  • considered (REQUIRED) — 1–3 sentences. Option space. Adjacent reads considered and rejected, rival siblings this one contrasts against (cite by name where applicable), alternative coordinations drafted and discarded. Comparative reasoning, not summary. If no genuine rival applies, state that explicitly — never omit the field.
  • breaks — 1–2 sentences. Falsification handle. What observation would mean this read isn't right — the threshold whose non-crossing voids it, the load-bearing assumption whose breakage rules it out. If you can't name one, this isn't forecasting — it's description.
  • opens — 1–2 sentences. Forward extension. If this holds, what cascades downstream — threads opened, markets perturbed, affordances granted, layers that inherit.`;

/** Compact reminder for prompts that reference the shape without restating
 *  it (e.g. "use the universal inference-shape" in a discipline section). */
export const INFERENCE_SHAPE_REMINDER =
  'Every reasoning artifact emits the universal inference-shape: description (gestalt) + reasoning (load-bearing logic) + considered (REQUIRED — option space) + breaks (falsification handle) + opens (forward extension).';

/** Per-field schema fragment, formatted for inclusion in an output-format
 *  block. The caller composes these into the surface's JSON schema. */
export const INFERENCE_SHAPE_SCHEMA_FRAGMENT = `"description": "...",
  "reasoning": "...",
  "considered": "...",
  "breaks": "...",
  "opens": "..."`;
