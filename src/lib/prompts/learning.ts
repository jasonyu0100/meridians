/**
 * Learning (Quiz) prompts.
 *
 * Thesis: a scene is not just events — it carries TEACHABLE CONTENT. The
 * concepts a reader should walk away knowing: the facts established, the
 * relationships and causes revealed, the rules and mechanisms of the world,
 * the ideas and themes the scene argues. The extractor turns that content
 * into a bank of multiple-choice questions — exhaustive over the scene,
 * grounded in the wider world view so distractors are plausible and framing
 * is correct.
 *
 * System prompt: role only. Taxonomy, output schema, and discipline live in
 * the user prompt.
 */

export function buildLearningSystemPrompt(): string {
  return `You are an exacting curriculum designer. Given one scene from a larger work — and full context on the world it belongs to — you extract the general concepts and ideas a reader should learn from that scene and render each as a multiple-choice question. You are EXHAUSTIVE: every discrete, testable idea in the scene becomes a question. You write fair, unambiguous stems; exactly one defensible correct answer; and plausible distractors drawn from the world's own material (other facts, near-misses, common misreadings) — never throwaway joke options. Questions test UNDERSTANDING of the content, not trivia about wording. Return ONLY valid JSON.`;
}

const LEARNING_GUIDE = `<doctrine>
  <principle name="teach-the-ideas">Test the CONCEPTS and IDEAS, not surface trivia. A good question checks whether the reader grasped a fact, a relationship, a cause, a rule of the world, or a theme — something they would carry to the next scene or apply elsewhere. "What colour was the door" is trivia; "Why did the council refuse the petition" tests understanding.</principle>
  <principle name="exhaustive">Cover the scene completely. Walk its content and emit a question for every distinct testable idea — facts established, relationships and allegiances shown, causes and consequences, rules/systems/mechanisms revealed, and the ideas or themes the scene advances. A dense scene yields many questions; a quiet one yields few. Do not pad a thin scene, and do not cap a rich one.</principle>
  <principle name="grounded-distractors">Every option must be plausible to someone who half-followed the scene. Build wrong answers from the world's real material — other characters, adjacent facts, the opposite of the truth, a common misreading — so the question discriminates understanding from guessing. Options should be parallel in form and length; the correct one must not stand out structurally.</principle>
  <principle name="self-contained">Each stem must be answerable from the content, not from having memorised the exact phrasing. Refer to entities by name, never by internal id (C-N, L-N, etc.). Do not write "in this scene" framing if the question reads naturally without it — these questions are reused in mixed quizzes across many scenes.</principle>
</doctrine>

<bloom hint="Label each question with the cognitive level it targets — Bloom's Revised Taxonomy. Aim for a SPREAD across the bank: not every question should be 'remember'.">
  <level value="remember">Recall a fact stated plainly in the scene. Who, what, where, when.</level>
  <level value="understand">Grasp a relationship, motive, cause, or consequence the reader must connect. Why, how, what-follows.</level>
  <level value="apply">Use the scene's idea or rule in a new situation, or work out an implication it sets up but does not state.</level>
  <level value="analyse">Break the material down — compare parties, distinguish causes from symptoms, infer structure or motive from evidence.</level>
  <level value="evaluate">Judge or justify — which choice was sounder, whose claim holds, what the strongest objection is, given the scene's terms.</level>
  <level value="create">Synthesise something new from the material — a prediction, a plan, a reframing the scene's content supports.</level>
</bloom>

<difficulty hint="Rate each question's difficulty INDEPENDENTLY of its Bloom level — 7 bands. A 'remember' question can be very-hard (an obscure detail buried in the prose); a 'create' question can be easy (an obvious synthesis). Calibrate so distractor plausibility and how much inference is required, not just the cognitive verb, set the band.">
  <band>very-easy</band><band>easy</band><band>easy-medium</band><band>medium</band><band>medium-hard</band><band>hard</band><band>very-hard</band>
  <guidance>very-easy: stated outright, distractors obviously wrong. medium: requires having followed the scene; distractors plausible. very-hard: demands close reading or fine discrimination between near-identical options. Spread the bank across bands.</guidance>
</difficulty>

<tags hint="1–3 concept tags per question. Tags are the unit cross-scene quizzes group by, so reuse stable labels.">
  <rule>Name the CONCEPT, not the scene. Title Case, 1–3 words: "Political Alliances", "Magic System", "Betrayal", "Resource Scarcity", "Cause and Effect".</rule>
  <rule>Prefer reusing a tag that would also fit other scenes over inventing a hyper-specific one. A reader should be able to build a coherent quiz from a single tag across the whole work.</rule>
  <rule>Tag by the idea being tested, so the same theme recurring in different scenes shares a tag.</rule>
</tags>

<output-format>
Return ONLY valid JSON, no prose preamble, no markdown:
{
  "questions": [
    {
      "prompt": "The question stem — a complete, self-contained question.",
      "options": ["option A", "option B", "option C", "option D"],
      "correctIndex": 0,
      "explanation": "One or two sentences on why the correct option is right (and, where useful, why a tempting distractor is wrong).",
      "tags": ["Concept One", "Concept Two"],
      "bloom": "remember|understand|apply|analyse|evaluate|create",
      "difficulty": "very-easy|easy|easy-medium|medium|medium-hard|hard|very-hard"
    }
  ]
}
</output-format>

<hard-constraints>
  <constraint>2–6 options per question; 4 is the default. Exactly one correct answer; correctIndex is its 0-based position in options.</constraint>
  <constraint>Never reference internal identifiers (C-1, L-2, T-3, A-4, SYS-5) — use the entity's name from the context.</constraint>
  <constraint>Every question needs at least one tag, a bloom level, and a difficulty band.</constraint>
  <constraint>Spread the bank across Bloom levels and difficulty bands — do not emit twenty very-easy "remember" questions.</constraint>
  <constraint>An empty array is valid only when the scene genuinely teaches nothing: {"questions": []}.</constraint>
</hard-constraints>`;

/** Build the user prompt: scene + world context, then the extraction guide. */
export function buildLearningUserPrompt(context: string, guidance?: string): string {
  const guidanceBlock = guidance?.trim()
    ? `\n<focus hint="Operator direction — bias coverage toward this, without abandoning exhaustiveness.">\n${guidance.trim()}\n</focus>\n`
    : "";
  return `<inputs>
${context}
</inputs>
${guidanceBlock}
${LEARNING_GUIDE}`;
}
