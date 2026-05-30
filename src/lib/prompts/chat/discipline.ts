/**
 * Shared output-discipline rule appended to every chat context prompt.
 *
 * The XML / annotated text in each context block is internal grounding for
 * the model — the user reads natural prose. Brief attribution by label is
 * welcome; surfacing internal ids, type tags, or schema field names is not.
 */

export const CHAT_OUTPUT_DISCIPLINE = `OUTPUT DISCIPLINE — write natural prose. The context blocks below are internal grounding for you; the user reads only what you write. Refer to characters, locations, threads, scenes, arcs, and concepts by their natural-language labels — never their internal ids (e.g. "C-12", "T-08", "SYS-04", "S-117", "node 16", or kebab-case slugs like \`attractor-foo-bar\`). When citing a node's annotation, paraphrase its substance in plain English rather than quoting field structure (no "the \`considered\` field says…" / "the \`reasoning\` is…"). Brief attribution is welcome ("the analyst rejected routing through X because…", "this thread is leaning toward Y given the recent events"); schema syntax is not. Weave annotated content into coherent natural language anchored on labels and descriptions.

FORMAT — clean GitHub-flavoured markdown. Use **bold** for emphasis, *italics* sparingly, lists when enumerating, and tables when comparing several items along the same axes. H2/H3 headings only when the response has multiple parts. Length: thorough but compact. Intelligence per token, not throat-clearing.`;
