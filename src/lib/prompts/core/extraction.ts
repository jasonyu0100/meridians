/**
 * Extraction discipline — the QUALITATIVE standard for what scene generation
 * pulls out of prose into structural deltas. It replaces hard per-scene quotas
 * (extract N–M nodes) with a per-piece test of value, applied generously. The
 * intent is a careful balance, NOT a licence to extract less:
 *
 *   · Fruitful extraction is still the goal — a rich scene should yield a lot.
 *     Quantity is anchored by the calibrated force bands (forces.ts), which stay.
 *   · What survives is decided by an operational load-bearing test, so "valuable
 *     vs noise" is concrete rather than a subjective vibe — defusing both the
 *     under-generation worry (clear, generous standard + bias to capture signal)
 *     and the over-generation worry (a real filter, never manufacture to fill).
 *
 * Force formulas, force bands, and structural minimums (a stance needs ≥2
 * outcomes; a new entity needs ≥1 node) are math, not style, and still hold.
 * Woven into the deltas prompt (core/deltas.ts) so every scene-gen call inherits it.
 */

export const EXTRACTION_DISCIPLINE = `<extraction-discipline hint="One principle: the richer the text, the more you extract. Stand on it, not on numbers.">
  Pull the load-bearing facts out of the noise of prose, each logged as its own discrete entry, building a compressed model of the world. The fundamental rule: richer text → more entries; thinner text → fewer. The material sets the count — no quota, no cap.
  <floor>Whenever you CREATE an entity or a thread, it carries at least one real fact — never empty, never a placeholder. A brand-new transient walk-on still earns its one grounding fact.</floor>
  <earn-the-rest>Beyond that first fact, each further entry must be CORE knowledge — core meaning load-bearing TO THE STORY: something a later scene would reason differently for having. "Core" is not about an entity's size — a transient actor can hold a fact the whole arc turns on, while an anchor's tenth restated mood is noise. Already implied, said elsewhere, or mere texture → drop it.</earn-the-rest>
  <one-fact-per-entry>One discrete fact per entry — a sentence carrying several facts becomes several entries. Split, don't cram; and never invent a fact the prose doesn't support.</one-fact-per-entry>
</extraction-discipline>`;
