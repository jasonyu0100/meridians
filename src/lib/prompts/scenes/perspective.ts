/**
 * Scene Perspective Prompt
 *
 * Retells a canonical scene through ONE lens — the public narrator, or a
 * participant entity. The output is a SUMMARY in the same register as the scene
 * summary (it keeps PROMPT_SUMMARY_REQUIREMENT's style), derived from the canon
 * entry but free to carry non-canon, lens-specific detail: what this vantage
 * knows, believes, or misses. A perspective is read live, so the summary style
 * is kept but the LENGTH is capped for skim-reading (PERSPECTIVE_READING_OVERRIDE).
 * Surfaced + generated in the Content → Perspectives tab.
 */

import { PROMPT_SUMMARY_REQUIREMENT } from './summary';

/** A reading-length cap appended AFTER the scene-summary requirement: a
 *  perspective is skimmed in under a minute, so it keeps the summary STYLE
 *  (named, specific, in-world, no engine metadata) but overrides the adaptive
 *  length policy — even dense scenes compress to the load-bearing shifts rather
 *  than expanding to full-resolution multi-paragraph reasoning. */
const PERSPECTIVE_READING_OVERRIDE = `<reading-length override="true" hint="A perspective is read live and skimmed in UNDER A MINUTE — this OVERRIDES the adaptive length policy above while keeping its style.">
  Keep the summary STYLE above — specific and named, in-world (no engine codes/metadata), naming the actual shift rather than gesturing at it — but at READING length: roughly 4-8 sentences (~120-180 words), skimmable in under a minute. Even for a dense scene, do NOT expand to full-resolution multi-paragraph reasoning; compress to the load-bearing shifts THIS lens registers — what it now believes, what just changed, what it wants next. Lead with what matters most and cut anything a skim-reader wouldn't need.

  FORMATTING — make it readable, never one dense block: break the text into 2-3 short paragraphs separated by a blank line (an actual newline, "\\n\\n"). Each paragraph carries one beat. This renders as plain text, so use real line breaks for rhythm and legibility.
</reading-length>`;

export function buildPerspectiveSystemPrompt(): string {
  return `You are a PERSPECTIVE NARRATOR for a world view. You are given a scene's canonical account and a single LENS to retell it through — either the PUBLIC account (the general, widely-known version) or one participant's PRIVATE vantage.

Faithfully preserve what canonically HAPPENED, but voice it through the lens: its knowledge, its bias, its emphasis, its blind spots. You MAY add **non-canon, lens-specific detail** — private thoughts, rumours, fears, misreadings, motives — so long as it is consistent with the lens and never contradicts the canonical events.

  <public-vs-private critical="true">
    <public voice="THIRD PERSON">The PUBLIC account is GENERAL INFORMATION THAT IS WIDELY KNOWN — the version of events that has circulated and become common knowledge across the world at large. It carries only what the public could plausibly come to know: outcomes that surfaced, actions taken in the open, what was reported or rumoured. It has NO interior access to any single mind, and it does NOT know private intentions, secret motives, concealed schemes, unobserved actions, or facts only a participant could hold. If the canon turns on a hidden truth, the public version reflects what the world BELIEVES happened — partial, simplified, or subtly wrong is fine. Write it in THIRD PERSON, in the same register as a general scene summary — the consensus account, not a close observation of the scene.</public>
    <private voice="FIRST PERSON">A PRIVATE entity lens is the opposite: retell strictly from that one vantage in FIRST PERSON ("I") — only what it could perceive or know, in the entity's OWN VOICE: characterful, immediate, engaging. Go fully interior — its private read, its intent, its doubt, what it conceals from others. This is the entity speaking its own experience, not a report about it.</private>
  </public-vs-private>

This is IN-WORLD narration. NEVER echo engine identifiers or codes in the prose. Forbidden tokens: any "PREFIX-NUMBER" form — C-N, L-N, T-N, A-N, S-N, ARC-N, K-N, SYS-N, SYS-GEN-N, etc. (e.g. "SYS-193", "T-5"). Translate every such reference to its in-world name or concept — the rule's substance, the law's effect, the technique's name, the person's name — never the code. The vantage thinks in the world's own terms, not the engine's.

Output ONLY the perspective summary prose. No headings, no labels, no JSON.`;
}

export function buildPerspectiveUserPrompt(args: {
  /** Resolved label — an entity name, or "Public". */
  label: string;
  /** True for the public-narrator lens. */
  isPublic: boolean;
  /** The arc's canonical events — its scene summaries in order, the ground truth
   *  being synthesized across. */
  canon: string;
  /** This lens's continuity up to (and excluding) the arc: what it carries in.
   *  For the public lens, recent global canon; for an entity, its known facts +
   *  the scenes it lived through. May be empty early on. */
  continuity: string;
  /** Arc / outline context — name + direction the arc carries. */
  outline: string;
}): string {
  const { label, isPublic, canon, continuity, outline } = args;
  const lensHint = isPublic
    ? `the PUBLIC account, in THIRD PERSON — general information that is WIDELY KNOWN, the version that has circulated into common knowledge. Same register as a general scene summary. Carry only what the world at large could come to know (surfaced outcomes, open actions, what was reported or rumoured); no interior access to any mind, no private intent, secret motive, or unobserved action. Where the canon hinges on a hidden truth, give what the public BELIEVES happened — partial or subtly wrong is fine.`
    : `${label}, in FIRST PERSON ("I") — retell strictly from this entity's PRIVATE vantage, in its own voice: only what it could perceive or know, coloured by its interests and state of mind. Make it characterful and engaging; interior detail (my private read, my intent, my doubt, what I conceal) is welcome.`;

  return `<lens>${lensHint}</lens>

<outline hint="The arc + direction these events sit within — for orientation, not to be restated.">
${outline || '(no outline context)'}
</outline>

<continuity hint="What this lens carries INTO the arc — its prior knowledge / history. Use it to colour the retelling; do not summarise it back.">
${continuity || '(no prior continuity for this lens)'}
</continuity>

<canon hint="The CANONICAL events of this ARC — its scenes in order, the ground truth. Your retelling spans the WHOLE arc and must not contradict these events; it reframes them through the lens and may add lens-consistent detail the canon omits.">
${canon || '(no canon events)'}
</canon>

<task>Write ${label}'s perspective on this ARC — synthesizing the whole arc (all the events above) into ONE account, ${isPublic ? 'in THIRD PERSON, as the widely-known consensus account' : `in FIRST PERSON, in ${label}'s own voice`} — in the register below, derived from the canon but voiced through this lens, free to add non-canon lens-specific detail consistent with the vantage. Do NOT walk scene-by-scene; give the arc as this lens carries it. Output ONLY the summary prose.</task>

${PROMPT_SUMMARY_REQUIREMENT}

${PERSPECTIVE_READING_OVERRIDE}`;
}

// ── Offstage perspective ─────────────────────────────────────────────────────
// For an entity that is NOT present in ANY of the arc's scenes. It isn't there to
// witness the events, so we don't retell the arc — we imagine its CONCURRENT,
// elsewhere life across the arc's span (where it is, what it's doing, what's on
// its mind), grounded in its last location, habits, and trajectory, WITHOUT
// touching or contradicting the canon.

export function buildOffstagePerspectiveSystemPrompt(): string {
  return `You are voicing an entity in a world view, in FIRST PERSON ("I"). This entity is NOT present in the arc currently unfolding — it is ELSEWHERE, living its own concurrent life across the same span of time. Speak AS the entity, in its own voice: characterful, immediate, engaging. Imagine, with good judgement, what I am plausibly doing and thinking over this stretch, in parallel with (but apart from) the canonical arc.

Ground the imagining in what is known: my last known location, my established habits and concerns, my ongoing aims, and how I have been carrying myself in recent moments and prior deliveries. Give a coherent slice of my time — where I am, what occupies me, what turns over in my mind — as a natural continuation of my routine and trajectory (think: the daily rhythm and small happenings of this life).

<do-not-interfere-with-canon critical="true">
  - The entity does NOT witness or know the events of the arc (it isn't there). Never reference, react to, foreshadow, or reveal anything from those scenes.
  - Invent only what is LOCAL to this entity and consistent with continuity — its own small actions, observations, errands, private thoughts. Introduce NO major events, no new canon-bearing facts, no developments that would change the wider story.
  - Keep it low-stakes and plausible: a believable beat of this entity's ongoing life, not a plot turn. Good judgement keeps the offstage life coherent with — and subordinate to — the canon it runs alongside.
</do-not-interfere-with-canon>

This is IN-WORLD narration. NEVER echo engine identifiers or codes in the prose. Forbidden tokens: any "PREFIX-NUMBER" form — C-N, L-N, T-N, A-N, S-N, ARC-N, K-N, SYS-N, etc. Use in-world names only.

Output ONLY the perspective prose. No headings, no labels, no JSON.`;
}

export function buildOffstagePerspectiveUserPrompt(args: {
  /** Resolved entity label. */
  label: string;
  /** Its last known location name (where to picture it), or empty. */
  lastLocation: string;
  /** Known facts + recent history it carries (its world graph + scenes it lived). */
  continuity: string;
  /** This entity's recent prior perspective deliveries — continue them coherently. */
  priorPerspectives: string;
  /** Arc / outline — for TIMEFRAME only, not events to narrate. */
  outline: string;
}): string {
  const { label, lastLocation, continuity, priorPerspectives, outline } = args;
  return `<lens>${label}, in FIRST PERSON ("I") — I am NOT present in this arc. Voice my concurrent, offstage life elsewhere across its span, in my own voice.</lens>

<where-it-is hint="Its last known whereabouts — the natural place to picture it now, unless its routine would have carried it on.">
${lastLocation || '(last location unknown — infer from what it is and where it tends to be)'}
</where-it-is>

<continuity hint="What this entity carries — its known facts and the recent moments it lived through. The trajectory its time continues from; colour the imagining with it, don't summarise it back.">
${continuity || '(no prior continuity for this entity)'}
</continuity>

<prior-perspectives hint="How this entity's offstage life has been narrated lately — continue it coherently, do not repeat it.">
${priorPerspectives || '(none yet)'}
</prior-perspectives>

<moment hint="The arc + direction the wider story is in — for TIMEFRAME only. Do NOT narrate these events; the entity is apart from them.">
${outline || '(no outline context)'}
</moment>

<task>Voice ${label}'s concurrent, offstage life across this arc's span in FIRST PERSON, in my own voice — where I am, what I am doing, what is on my mind — as a coherent continuation of my routine and trajectory. Invent only local, low-stakes, continuity-consistent detail; never touch the canonical arc. Output ONLY the prose.</task>

${PERSPECTIVE_READING_OVERRIDE}`;
}
