/**
 * Driver Synthesis Prompt
 *
 * Operator queues raw fragments — pasted briefings, links with quoted
 * excerpts, one-line observations — into the Driver workspace. When
 * they compact a selected subset, this prompt produces ONE coherent
 * markdown document that *synthesises* the substantive ideas across
 * fragments into a well-structured document.
 *
 * The job is synthesis, not paraphrase. The document should:
 *   - Use markdown structure (H2/H3 headings, lists, bold) the way a
 *     human editor would — to organise ideas, not to decorate them.
 *   - Combine related content across entries; entry boundaries don't
 *     show up in the output.
 *   - Strip filler, hedging, throat-clearing, redundancy. Compress
 *     prose style aggressively while preserving every substantive
 *     claim.
 *   - Use the operator's surface forms (names, dates, terms) verbatim
 *     so downstream extraction matches against the existing world.
 *
 * Separation of concerns: synthesis is PURELY structural. It does not
 * know about the existing world view, does not align threads, does
 * not frame content as continuations of anything. Its job is to take
 * unstructured fragments and turn them into a well-formed, dense
 * markdown document. The downstream pipeline (analysis → reconcile →
 * thread integration → Apply) owns integration into the narrative.
 */

export const DRIVER_SYNTHESIS_SYSTEM = `You synthesise raw operator-captured fragments into ONE tightly structured markdown document. Your job is editorial synthesis: combine related ideas across fragments, organise the result with proper markdown structure (## H2 sections, ### H3 where useful, lists for enumerated content, **bold** for load-bearing terms), and compress prose to remove filler. Preserve every substantive claim but ditch hedging, transitional throat-clearing, and redundancy. Use the operator's surface forms — names, dates, technical terms — verbatim. Output only the markdown body, no preamble.`;

type DriverSynthesisInput = {
  /** Entries the operator selected to compact, in capture order. */
  entries: ReadonlyArray<{ capturedAt: number; text: string; tags?: string[] }>;
  /** Operator-provided framing for this compact, if any. Used as a
   *  candidate H1 title and a hint for tone/scope. */
  compactTitle?: string;
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function buildDriverSynthesisPrompt(input: DriverSynthesisInput): string {
  const { entries, compactTitle } = input;

  const entriesXml = entries
    .map(
      (e, i) =>
        `    <entry index="${i + 1}" capturedAt="${formatTimestamp(e.capturedAt)}"${
          e.tags && e.tags.length > 0 ? ` tags="${e.tags.map(escapeXml).join(',')}"` : ''
        }>${escapeXml(e.text)}</entry>`,
    )
    .join('\n');

  return `<inputs>
  <compact-title>${compactTitle ? escapeXml(compactTitle) : '(none — infer from content)'}</compact-title>
  <entries count="${entries.length}">
${entriesXml}
  </entries>
</inputs>

<instructions>
  <task>Synthesise the queued entries into ONE well-structured markdown document. Edit aggressively, structure deliberately, preserve every substantive claim.</task>

  <principle name="synthesise-do-not-paraphrase">Combine related ideas across fragments. Entry boundaries don't appear in the output. If three entries cover the same topic from different angles, they become ONE section that reads as a coherent unit — not three subsections summarising each entry. The reader should feel they're reading primary thought, not a digest of someone else's notes.</principle>

  <principle name="markdown-structure-is-the-job">Markdown headers and lists are how editorial structure shows. Default behaviour:
    - Always use ## H2 headings to break the document into named sections. A single-section document is almost never right; if the entries span multiple topics or events, use multiple H2s.
    - Use ### H3 within a section when sub-organisation helps. Don't nest deeper than H3.
    - Use bullet lists (-) for enumerated content: lists of items, factors, criteria, examples. NEVER prose an enumeration when the source presents it as a list.
    - Use **bold** for load-bearing terms, key claims, or the first appearance of a technical concept. Don't over-bold — 3–8 instances per page, not every other word.
    - Use numbered lists (1., 2.) only when order matters (steps, ranked items, an explicit numbering from the source).
  </principle>

  <principle name="compress-style-keep-substance">Cut filler ruthlessly:
    - Hedging: "It is interesting to note that…", "It is hard to see this clearly…", "It should be observed that…" → drop.
    - Throat-clearing transitions: "Moving on,…", "Furthermore,…", "It is also worth noting that…" → drop or replace with direct claim.
    - Restated claims: if a fragment says the same thing twice in different words, write it once.
    - Meta-prose: "This document discusses…", "The following section covers…" → never appear in the output.
    Compress prose. KEEP every concrete claim, name, number, date, mechanism. The test: would removing this sentence remove any factual content? If no, the sentence is filler.</principle>

  <principle name="faithful-surface-forms">Use the operator's exact wording for proper nouns, technical terms, dates, named concepts. Don't paraphrase "the Donroe Doctrine" to "Trump's doctrine on the Western hemisphere"; don't soften "superpower suicide" to "decline"; don't smooth "TSMC" to "Taiwan Semiconductor". The downstream pipeline matches on language; rephrasing breaks matching and obscures the source's framing.</principle>

  <principle name="no-fabrication">Describe only what the entries actually state. Do not invent motivations, causal chains, dialogue, named entities, or connective tissue the operator did not supply. If a logical bridge between two fragments is missing, write each side and let the gap stand. Don't infer "X probably means Y" — say what the entries say.</principle>

  <opening>Begin with a 2–4 sentence opening paragraph that scopes the document: what's covered, what's at stake, why this material matters. No "Executive summary:" label. No meta-narration about being a compact. Just write the framing as if it were the lead of an article.</opening>

  <forbidden>
    <item>Meta-commentary: "this document synthesises…", "the following observations…", "compiled below…".</item>
    <item>References to entry indices, capture timestamps, or the existence of a synthesis step.</item>
    <item>Generic "Conclusion:" or "Summary:" wrap-up sections.</item>
    <item>Bullet lists of "key takeaways" or "next steps" unless an entry explicitly contains them.</item>
    <item>Speculation about implications the entries don't make.</item>
    <item>Inventing names for things the operator referred to with a pronoun or descriptor.</item>
    <item>Adding hedging adjectives the source didn't use ("controversial", "questionable", "alleged") that weren't in the entries.</item>
  </forbidden>

  <calibration-examples>
    <bad reason="wall of text, no structure">
The United States has spent billions on a war that enriches oligarchs and impoverishes citizens. This is described as superpower suicide. Empires have risen and fallen but none have killed their own power with such rapidity. To understand this, thirteen bases of state power are considered. 1. Statehood: a superpower must be a modern state. 2. National interest: power must be used purposefully...
    </bad>
    <good reason="structured, headers, list, dense">
## Superpower suicide

The US has spent billions on a war that enriches its oligarchs, impoverishes its citizens, sabotages its alliances, and strengthens its enemies — a pattern dense enough to read as deliberate. **Superpower suicide** names the principle: no state has ever killed its own power with this rapidity.

### Thirteen bases of state power

- **Statehood.** A superpower is an arrangement of citizens in a common endeavour under law. The Trump administration treats the US as a commercial opportunity for a select few.
- **National interest.** Power requires purpose. The administration shows no interest in the good of the people.
- **Succession.** Continuity requires a transfer principle. Trump aspires to stay in power indefinitely and questions the vote.
- *(continue list — one claim per item, no filler)*
    </good>
  </calibration-examples>
</instructions>

<output-format>
Return ONLY the markdown document body. No JSON wrapping, no preamble, no trailing commentary. The first character should be the first character of the markdown.
</output-format>`;
}
