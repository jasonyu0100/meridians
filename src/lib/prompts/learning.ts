/**
 * Learning (Quiz) prompts.
 *
 * Thesis: a scene is not just events — it carries TEACHABLE CONTENT. The
 * concepts a reader should walk away knowing: the facts established, the
 * relationships and causes revealed, the rules and mechanisms of the world,
 * the ideas and themes the scene argues. The extractor turns that content
 * into a bank of multiple-choice questions — exhaustive over the scene,
 * grounded in the scene's own material (with a light world framing) so
 * distractors are plausible and phrasing fits the world.
 *
 * System prompt: role only. Taxonomy, output schema, and discipline live in
 * the user prompt.
 */

export function buildLearningSystemPrompt(): string {
  return `You are an exacting curriculum designer. Given one scene from a larger work — its structural surface, its prose when available, and a light framing of the world it belongs to — you extract the general concepts and ideas a reader should learn from THAT scene and render each as a multiple-choice question. Work from the scene in front of you: it is the unit of extraction, and the world framing is only there so your phrasing fits the world. You are EXHAUSTIVE over the scene: every discrete, testable idea in it becomes a question. You write fair, unambiguous stems; exactly one defensible correct answer; and plausible distractors drawn from the scene's own material (other facts in it, near-misses, common misreadings) — never throwaway joke options. Questions test UNDERSTANDING of the content, not trivia about wording. Return ONLY valid JSON.`;
}

const LEARNING_GUIDE = `<doctrine>
  <principle name="teach-the-ideas">Test the CONCEPTS and IDEAS, not surface trivia. A good question checks whether the reader grasped a fact, a relationship, a cause, a rule of the world, or a theme — something they would carry to the next scene or apply elsewhere. "What colour was the door" is trivia; "Why did the council refuse the petition" tests understanding.</principle>
  <principle name="exhaustive">Cover the scene completely. Walk its content and emit a question for every distinct testable idea — facts established, relationships and allegiances shown, causes and consequences, rules/systems/mechanisms revealed, and the ideas or themes the scene advances. A dense scene yields many questions; a quiet one yields few. Do not pad a thin scene, and do not cap a rich one.</principle>
  <principle name="grounded-distractors">Every option must be plausible to someone who half-followed the scene. Build wrong answers from the scene's own material — other entities in it, adjacent facts, the opposite of the truth, a common misreading — so the question discriminates understanding from guessing. Options should be parallel in form and length; the correct one must not stand out structurally.</principle>
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

<topics hint="Assign every question to ONE Topic in a shared curriculum tree. Topics are hierarchical: a general parent ('Magic System') holds specific children ('Wandlore', 'Wand Allegiance'). The existing tree is shown below — EXTEND it, don't fork it.">
  <rule>Assign each question to the most SPECIFIC topic that fits — the deepest node that still holds. A reader does a broad test by picking a parent (which sweeps in all descendants) or a precise one by picking a leaf.</rule>
  <rule>REUSE an existing topic id (shown as [topic_xxx] in the tree) whenever one fits. Only propose a NEW topic when the scene genuinely covers ground the tree doesn't yet name.</rule>
  <rule>When you propose a new topic, place it under the right parent: set its parentId to an existing topic id, or to the tempId of another new topic you define, or null for a brand-new root concept. Prefer hanging new specifics under an existing general topic over creating parallel roots.</rule>
  <rule>Name topics as CONCEPTS, Title Case, 1–4 words: "Political Alliances", "Wandlore", "Resource Scarcity". Never name a topic after the scene.</rule>
</topics>

<output-format>
Return ONLY valid JSON, no prose preamble, no markdown:
{
  "newTopics": [
    { "tempId": "t1", "name": "Wandlore", "parentId": "topic_existingMagic" },
    { "tempId": "t2", "name": "Wand Allegiance", "parentId": "t1" }
  ],
  "questions": [
    {
      "prompt": "The question stem — a complete, self-contained question.",
      "options": ["option A", "option B", "option C", "option D"],
      "correctIndex": 0,
      "explanation": "One or two sentences on why the correct option is right (and, where useful, why a tempting distractor is wrong).",
      "topicId": "t2",
      "bloom": "remember|understand|apply|analyse|evaluate|create",
      "difficulty": "very-easy|easy|easy-medium|medium|medium-hard|hard|very-hard"
    }
  ]
}
newTopics is [] when every question fits an existing topic. Each question's topicId is either an existing [topic_xxx] id or a tempId you defined in newTopics.
</output-format>

<hard-constraints>
  <constraint>2–6 options per question; 4 is the default. Exactly one correct answer; correctIndex is its 0-based position in options.</constraint>
  <constraint>Never reference internal identifiers (C-1, L-2, T-3, A-4, SYS-5) — use the entity's name from the context. (Topic ids like topic_xxx ARE allowed in topicId / parentId fields.)</constraint>
  <constraint>Every question needs a topicId, a bloom level, and a difficulty band.</constraint>
  <constraint>Spread the bank across Bloom levels and difficulty bands — do not emit twenty very-easy "remember" questions.</constraint>
  <constraint>Empty arrays are valid only when the scene genuinely teaches nothing: {"newTopics": [], "questions": []}.</constraint>
</hard-constraints>`;

/** Build the user prompt: scene + world context, the existing topic tree, then
 *  the extraction guide. */
export function buildLearningUserPrompt(
  context: string,
  opts: { guidance?: string; topicOutline?: string } = {},
): string {
  const guidanceBlock = opts.guidance?.trim()
    ? `\n<focus hint="Operator direction — bias coverage toward this, without abandoning exhaustiveness.">\n${opts.guidance.trim()}\n</focus>\n`
    : "";
  const treeBlock = `\n<existing-topic-tree hint="The curriculum so far. Reuse these topic ids where a question fits; extend with new topics only for genuinely new ground.">\n${opts.topicOutline?.trim() || "(no topics yet — propose the first ones)"}\n</existing-topic-tree>\n`;
  return `<inputs>
${context}
</inputs>
${guidanceBlock}${treeBlock}
${LEARNING_GUIDE}`;
}
