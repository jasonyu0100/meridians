/**
 * Search synthesis prompts.
 *
 * Both search modes — vector (embedding RAG over the proposition bank) and
 * context (narrative-context fallback) — produce a short academic synthesis
 * that attributes to database ENTITIES in the same entity-ref citation style
 * as chat (`Aragorn [C-1]`, `the loyalty thread [T-48]`). The citation
 * mechanics live in the system prompt (CHAT_OUTPUT_DISCIPLINE, attached via
 * buildSearchSynthesisSystem); these user prompts only supply the data and
 * the answer shape. Propositions / similarities are internal grounding — they
 * locate WHAT to talk about; they are never cited by number.
 */

/**
 * Vector-mode synthesis. `context` is the retrieved evidence (top
 * propositions + scene summaries) used only to focus the answer; `entityRoster`
 * lists the citable database entities (with their exact ids) that appear in
 * the matched scenes, so the model can attribute claims to them.
 */
export function buildSearchSynthesisPrompt(args: {
  context: string;
  entityRoster: string;
  query: string;
}): string {
  const { context, entityRoster, query } = args;
  return `<inputs>
  <retrieved-evidence hint="Top semantic matches for the query — internal grounding only. Propositions are atomic facts; scene summaries give thematic placement. Use these to decide WHAT is relevant; do NOT cite them by number. Across registers a proposition may be a rule statement, scenario input, parameter value, agent decision, or rule-driven outcome.">
${context}
  </retrieved-evidence>
  <citable-entities hint="Database entities involved in the matched scenes, each with its exact id. Attribute claims to these by name + bracketed id, e.g. &quot;Aragorn [C-1]&quot;, &quot;the parley [S-12]&quot;.">
${entityRoster}
  </citable-entities>
  <query>${query}</query>
</inputs>

<instructions>
  <step name="ground">Answer the query, grounded in the retrieved evidence. State what the matched content establishes.</step>
  <step name="attribute">Attribute claims to the database entities in &lt;citable-entities&gt; by name + bracketed id. Cite an entity on its first substantive mention. Only cite ids that appear verbatim above.</step>
  <step name="locate">Note where the answer concentrates — which scenes and arcs carry the weight (localized vs. thematically spread).</step>
  <step name="length">Write 2-3 paragraphs, academic and concise.</step>
</instructions>

<output-format>Academic prose with entity-ref citations (name + [id]).</output-format>`;
}

/**
 * Expert-mode synthesis. The grounding is the curriculum question bank — the
 * top-K matched questions, each with its VERIFIED answer and explanation. The
 * model teaches the query from these settled units, attributing to topic areas
 * by name (no entity-ref ids). This is the "subject-matter expert" surface:
 * where vector retrieves atomic propositions, expert retrieves teachable Q→A.
 */
export function buildExpertSearchPrompt(args: {
  context: string;
  citableEntities: string;
  query: string;
}): string {
  const { context, citableEntities, query } = args;
  return `<inputs>
  <verified-curriculum hint="The top semantic matches from the curriculum question bank — each a teachable unit with a curated, verified answer, carrying its question id and topic id. These are settled knowledge: treat the answers as established fact and synthesise across them.">
${context}
  </verified-curriculum>
  <citable-entities hint="The curriculum entities you may cite, each with its exact id. Attribute claims to topics and questions by a brief descriptive phrase + bracketed id, e.g. &quot;the propulsion-systems topic [TOP-3]&quot;, &quot;the staging-sequence question [Q-12]&quot;.">
${citableEntities}
  </citable-entities>
  <query>${query}</query>
</inputs>

<instructions>
  <step name="teach">Answer the query by teaching from the verified curriculum above. Build the answer from the matched questions' curated answers and explanations.</step>
  <step name="attribute">Attribute claims to the topics and questions in &lt;citable-entities&gt; by a descriptive phrase + bracketed id. Cite on first substantive mention. Only cite ids that appear verbatim above.</step>
  <step name="honest">If the curriculum does not cover enough to answer, say so plainly rather than speculating beyond it.</step>
  <step name="length">Write 2-3 paragraphs, academic and concise.</step>
</instructions>

<output-format>Academic prose grounded in the curriculum, with topic/question entity-ref citations (phrase + [id]).</output-format>`;
}

/**
 * Context-mode synthesis — used when vector search is off or unavailable (not
 * every scene on the branch has an embedded plan). The full branch continuity
 * is fed in and the model answers directly from it. Slower and more
 * token-expensive than vector search, but works on any branch and reads the
 * true context rather than a ranked top-K. Attribution is identical to vector
 * mode (entity-ref citations) — every entity in the context carries its id.
 */
export function buildNarrativeContextSearchPrompt(args: {
  context: string;
  query: string;
}): string {
  const { context, query } = args;
  return `<inputs>
  <narrative-context hint="The full branch continuity — entities, threads, systems, and scene history up to the current point. Every entity carries its exact id; attribute claims to entities by name + bracketed id, e.g. &quot;Aragorn [C-1]&quot;, &quot;the parley [S-12]&quot;.">
${context}
  </narrative-context>
  <query>${query}</query>
</inputs>

<instructions>
  <step name="ground">Answer the query strictly from the narrative context above. Do not invent facts that are not present in it.</step>
  <step name="attribute">Attribute claims to entities, scenes, arcs, and threads by name + bracketed id on first substantive mention. Only cite ids that appear verbatim in the context.</step>
  <step name="honest">If the context does not contain enough to answer, say so plainly rather than speculating.</step>
  <step name="length">Write 2-3 paragraphs, academic and concise.</step>
</instructions>

<output-format>Academic prose with entity-ref citations (name + [id]).</output-format>`;
}
