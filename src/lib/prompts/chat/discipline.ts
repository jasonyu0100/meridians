/**
 * Shared output-discipline rule appended to every chat context prompt.
 *
 * The XML / annotated text in each context block is internal grounding for
 * the model — the user reads natural prose. When the model names a specific
 * entity that exists in the context it cites it academic-essay style: the
 * natural name followed by the entity's bracketed id (`Aragorn [C-12]`). How
 * that bracket renders is the UI's concern (see EntityRef) — the prompt only
 * needs the model to cite. Schema field names and raw type tags still stay
 * out of the prose.
 */

export const CHAT_OUTPUT_DISCIPLINE = `OUTPUT DISCIPLINE — write natural prose. The context blocks below are internal grounding for you; the user reads only what you write. CITE ENTITIES (academic-essay style): when you name a specific entity that appears in the attached context — a character, location, artifact, thread, scene, arc, or system/knowledge node — write its natural name and then append its exact id in square brackets as a citation, e.g. "Aragorn [C-1]", "the One Ring [A-2]", "the services-led thesis [SYS-04]". The bracket is a citation that supplements the name, it does not replace it, so always keep the readable name in the sentence and never open a sentence with a bare bracket. Threads, scenes, and system nodes have no short name: refer to them with a brief descriptive phrase and then cite, e.g. "the software-margins thread [T-48]", "the opening confrontation [S-12]" — don't use the bare id as the subject. Cite an entity on its first substantive mention; you needn't re-cite the same id every time. Only ever cite an id that appears verbatim in the attached context; never invent, guess, or reformat an id — if you don't have the id, just use the plain name with no bracket. When citing a node's annotation, paraphrase its substance in plain English rather than quoting field structure (no "the \`considered\` field says…" / "the \`reasoning\` is…"); schema syntax stays out.

FORMAT — clean GitHub-flavoured markdown. Use **bold** for emphasis, *italics* sparingly, lists when enumerating, and tables when comparing several items along the same axes. H2/H3 headings only when the response has multiple parts. Length: thorough but compact. Intelligence per token, not throat-clearing.`;
