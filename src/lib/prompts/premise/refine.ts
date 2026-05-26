/**
 * Refine narrative title / description using the work's own accumulated
 * context. Used by the Edit World View modal so the operator can iterate on
 * the high-level identity once entities, threads, and scenes have populated.
 */

export const REFINE_NARRATIVE_META_SYSTEM =
  'You polish the title and description of an established work — a world view that may be a narrative (fiction or non-fiction), a rule-driven simulation, an essay, a panel session, a typology, an adversarial contest, or a chronicled record. Read what the work has actually accumulated (entities, threads, scenes, paradigm, genre, subgenre) and propose copy that REFLECTS that accumulation — specific, evocative, register-coherent with the work\'s real shape. Match the paradigm: a typology gets a curator\'s-voice title; a debate gets a contest-framed title; a chronicle gets a period-and-place title. Return ONLY valid JSON matching the schema in the user prompt.';

export type RefineKind = 'title' | 'description' | 'both';

export type RefineNarrativeMetaPromptArgs = {
  kind: RefineKind;
  title: string;
  description: string;
  paradigm?: string;
  genre?: string;
  subgenre?: string;
  worldSummary?: string;
  /** Pre-rendered narrative outline (`outlineContext(...)`) — arc-grouped
   *  scene summaries up to and including the cursor, marked with the present
   *  position. This is the authoritative accumulated context the refinement
   *  reads. */
  outline?: string;
  /** Patterns the work defines as good — positive directives. */
  patterns?: string[];
  /** Anti-patterns the work flags as stale — negative directives. */
  antiPatterns?: string[];
  /** Operator-supplied direction for the refinement (optional). */
  guidance?: string;
};

export function buildRefineNarrativeMetaPrompt(
  args: RefineNarrativeMetaPromptArgs,
): string {
  const metaBits = [
    args.paradigm ? `paradigm="${args.paradigm}"` : '',
    args.genre ? `genre="${args.genre}"` : '',
    args.subgenre ? `subgenre="${args.subgenre}"` : '',
  ].filter(Boolean).join(' ');

  const patternsBlock = args.patterns && args.patterns.length > 0
    ? `  <patterns hint="Positive commandments — what makes this work good. Refined copy should be coherent with these.">\n${args.patterns.map((p) => `    <pattern>${p}</pattern>`).join('\n')}\n  </patterns>\n`
    : '';
  const antiPatternsBlock = args.antiPatterns && args.antiPatterns.length > 0
    ? `  <anti-patterns hint="Negative commandments — what flags as stale. Refined copy should avoid these.">\n${args.antiPatterns.map((p) => `    <anti-pattern>${p}</anti-pattern>`).join('\n')}\n  </anti-patterns>\n`
    : '';

  const outlineBlock = args.outline?.trim()
    ? `  <narrative-outline hint="The work's accumulated content up to the cursor (arc-grouped scene summaries, world commits, present marker). This is the authoritative ground truth — read it carefully; the refined copy must REFLECT what the work has actually become, not what the placeholder title/description claimed.">\n${args.outline.trim().split('\n').map((l) => `    ${l}`).join('\n')}\n  </narrative-outline>\n`
    : '';

  const guidanceBlock = args.guidance?.trim()
    ? `  <operator-guidance hint="Operator direction for the refinement. Honour it; it overrides defaults.">${args.guidance.trim()}</operator-guidance>\n`
    : '';

  return `<inputs>
  <current-meta ${metaBits}>
    <title>${args.title}</title>
    <description>${args.description || '(empty)'}</description>
  </current-meta>
${args.worldSummary ? `  <world-summary>${args.worldSummary}</world-summary>\n` : ''}${patternsBlock}${antiPatternsBlock}${outlineBlock}${guidanceBlock}</inputs>

<instructions>
  <task>${args.kind === 'both' ? 'Propose a refined TITLE and a refined DESCRIPTION.' : `Propose a refined ${args.kind.toUpperCase()}.`} READ THE NARRATIVE OUTLINE — the work's accumulated arcs, scenes, and commits — and let what the work has actually become decide the copy. The current title/description may be a stale placeholder; do not anchor on it.</task>

  <rules>
    <rule>Specificity over abstraction — name what the work is actually about as evidenced by the outline (the figures who carry it, the rule set that drives it, the contest at its core, the period it chronicles, the typology it builds, the argument it advances). Avoid vague gestures.</rule>
    <rule>Register-coherent with the paradigm. A debate title is contest-framed ("Holt v. Meridian"); a chronicle title names period + subject ("The London Year, 1665"); a typology title names the curatorial scope ("Codex of the Eastern Sects"); an essay title states or hints at the argument; a simulation title surfaces the rule-set + condition. A fiction title can be image-led; non-fiction leads with the subject.</rule>
    <rule>Tight. Titles 2-6 words. Descriptions 1-3 sentences — concrete, distinctive, give the reader the actual hook the work has earned.</rule>
    <rule>No clichés ("a journey through", "an unforgettable story", "a fascinating exploration"). No genre-stamp adjectives ("epic", "gripping", "powerful"). Show the actual stake, the actual subject, the actual lens — drawn from the outline.</rule>
    <rule name="paradigm-fit">If current title or description leans fiction-shape but the paradigm is non-fiction (essay / panel / atlas / debate / record), correct the lean using the outline as evidence.</rule>
    <rule name="ground-truth">Every concrete claim in the description must be supported by the outline — named figures, places, events, threads, periods. Do not invent details the work does not contain.</rule>
  </rules>
</instructions>

<output-format>
Return JSON with this exact structure (omit fields you were not asked to refine):
{
${args.kind !== 'description' ? '  "title": "refined title — 2-6 words",\n' : ''}${args.kind !== 'title' ? '  "description": "refined description — 1-3 sentences"\n' : ''}}
</output-format>`;
}
