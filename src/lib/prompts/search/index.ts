/**
 * Search synthesis prompts — produce a Google-style overview with inline
 * citations from semantic-search results (top propositions + scene
 * summaries).
 */

export function buildSearchSynthesisPrompt(args: {
  context: string;
  query: string;
  propositionCount: number;
  aggregateSceneCount: number;
  directSceneCount: number;
}): string {
  const { context, query, propositionCount, aggregateSceneCount, directSceneCount } = args;
  return `<inputs>
  <retrieval-context hint="Proposition-primary architecture: top propositions are the primary evidence; aggregate scene membership locates them in narrative context; direct scene summaries are supplementary thematic context. Propositions span all three registers — in simulation register they may be rule statements, scenario inputs, parameter values, agent decisions, or rule-driven outcomes, all searchable like any other claim.">
${context}
  </retrieval-context>
  <query>${query}</query>
  <retrieval-stats propositions="${propositionCount}" aggregate-scenes="${aggregateSceneCount}" direct-scenes="${directSceneCount}" />
</inputs>

<instructions>
  <step name="ground">Ground claims in propositions [1]–[${propositionCount}]. These are the specific, atomic facts.</step>
  <step name="locate">Use aggregate scene summaries to place propositions — "this claim emerges in the scene where X happens" — without necessarily citing the scene separately.</step>
  <step name="thematic">Use direct scene-summary citations (numbered after the propositions) only when the thematic framing they provide isn't already captured by the propositions.</step>
  <step name="cite-selectively">Cite the strongest matches with inline citations like [1], [3]; don't cite every result.</step>
  <step name="length">Write 2-3 paragraphs, Google AI Overview style: plain text, clear, informative.</step>
  <step name="patterns">Note timeline patterns where applicable; mention which arcs and scenes carry the weight. If propositions cluster in a few scenes, say so (content is localized). If they spread across many, say so (pattern is thematic).</step>
</instructions>

<output-format>Plain text with inline citations.</output-format>`;
}
