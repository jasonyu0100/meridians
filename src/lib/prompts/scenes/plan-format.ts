/**
 * Plan-side format-awareness block — surfaces the downstream rendering
 * target so the planner shapes mechanism mix and `what`-field scaffolding
 * to survive the format transit. The plan stays format-agnostic in
 * structure (same fn / mechanism taxonomy across all formats), but each
 * format prefers a different accent profile downstream and the plan can
 * leave the right doors open.
 *
 * Returns "" for the prose default (the plan's defaults are already
 * prose-tuned, so an empty block keeps the prompt clean).
 */

import type { ProseFormat } from "@/types/narrative";

export function buildPlanFormatBlock(format: ProseFormat): string {
  if (format === "prose") return "";

  const body = FORMAT_BODIES[format];
  if (!body) return "";

  return `<rendering-format target="${format}" hint="The downstream prose stage will RE-RENDER this plan into the named format — the blueprint stays the same shape, but the accent profile differs. Plan with the format's strengths in mind so the rendering doesn't have to fight the blueprint.">
${body}
  </rendering-format>`;
}

const FORMAT_BODIES: Partial<Record<ProseFormat, string>> = {
  screenplay: `  <accent>
    <rule>Sparser propositions per beat than prose — each minute of stage time covers fewer claims than a paragraph. Distribute load across more beats; don't pack 5+ propositions into one. Lean dialogue-heavy: when 2+ participants share a substantive beat, prefer dialogue over thought/narration/action — stage lives in audible exchange.</rule>
    <rule>Externalisable mechanisms (dialogue, action, environment, document) are the screenplay's native register. The plan's mix should lean toward these where the narrative earns it.</rule>
  </accent>
  <interior-mechanisms hint="Beats with mechanism = thought / narration / memory / comic must externalise downstream. Leave the externalisation route in 'what'.">
    <rule name="thought">Scaffold the EXTERNALISATION ROUTE — V.O. line carrying the calculation, OR visible micro-expression / blocking carrying it without words, OR visualised aperture / INSERT shot staging the interior. "X registers Y; V.O. names it as Z" or "X's hand stills; the basin's hum drops" — not "X recognises Y as Z".</rule>
    <rule name="narration">Scaffold a TIME-COMPRESSION DEVICE — series of shots, montage, V.O. bridge, moments-later cut. "Three weeks of routines compressed" is fine; "time passes" isn't.</rule>
    <rule name="memory">Name both the TRIGGER (what the present-day character sees/hears) and the FLASHBACK CONTENT (what the cut shows).</rule>
    <rule name="comic">Name the VISIBLE COMIC DEVICE — reaction shot, visual undercut, off-beat punchline cue. Comic register on stage is bodily, not authorial.</rule>
  </interior-mechanisms>
  <blank-stage-test>For any beat with two or more participants holding still in a room, name what the camera will see and hear: a candle burning down, a guard's footfall, sweat at a temple, an INSERT cut. Stillness needs texture or staging; if 'what' offers neither, the rendering will fail.</blank-stage-test>`,
};
