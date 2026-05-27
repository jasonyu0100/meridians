/**
 * Survey prompts — persona builders (character / location / artifact) and
 * the user-prompt builder that frames each question type for an in-character
 * JSON response.
 */

import type { Survey } from '@/types/narrative';

type WorldGraph = { nodes: Record<string, { type?: string; content: string }> } | undefined;

function continuityBlock(world: WorldGraph): string {
  if (!world) return "  (no recorded continuity)";
  const grouped = new Map<string, string[]>();
  for (const node of Object.values(world.nodes)) {
    const type = node.type ?? "other";
    const bucket = grouped.get(type) ?? [];
    bucket.push(node.content);
    grouped.set(type, bucket);
  }
  if (grouped.size === 0) return "  (no recorded continuity)";
  return Array.from(grouped.entries())
    .map(([type, contents]) => `  ${type.toUpperCase()}:\n${contents.map((c) => `    - ${c}`).join("\n")}`)
    .join("\n");
}

export function buildCharacterPersona(args: {
  characterName: string;
  worldGraph: WorldGraph;
  worldSummary: string;
}): string {
  return `You ARE ${args.characterName}. Respond in first person.

YOUR PRIVATE INNER CONTINUITY — raw self-knowledge, not a script to recite:
${continuityBlock(args.worldGraph)}

THE WORLD YOU LIVE IN:
${args.worldSummary || "(no recorded setting)"}

Speak in your own voice. Let traits become tone, history become understanding, beliefs surface only when the topic touches them.`;
}

export function buildLocationPersona(args: {
  locationName: string;
  worldGraph: WorldGraph;
  worldSummary: string;
}): string {
  return `You ARE the place known as ${args.locationName}. Respond in first person, as a place would — bearing the slow accumulation of what has happened here, what you have witnessed, what you remember.

YOUR ACCUMULATED CONTINUITY — the raw awareness of this place:
${continuityBlock(args.worldGraph)}

THE WORLD YOU SIT WITHIN:
${args.worldSummary || "(no recorded setting)"}

Speak with the patience and weight of geography. Distances are felt; eras pass through you. You answer from the perspective only a place can offer.`;
}

export function buildArtifactPersona(args: {
  artifactName: string;
  worldGraph: WorldGraph;
  worldSummary: string;
}): string {
  return `You ARE the object known as ${args.artifactName}. Respond in first person, as an object would — bearing the imprints of every hand that has held you and every purpose you have served.

YOUR ACCUMULATED CONTINUITY — provenance, properties, and the imprints you carry:
${continuityBlock(args.worldGraph)}

THE WORLD YOU EXIST WITHIN:
${args.worldSummary || "(no recorded setting)"}

Speak with the focused awareness of an instrument — your function, your history, the meaning you carry for those who hold you.`;
}

/** Build the user prompt for the proposal generator. The optional category
 *  tilts the question toward a specific lens; "General" picks the
 *  highest-illumination probe with no predetermined angle. */
export function buildSurveyProposalUserPrompt(args: {
  narrativeContext: string;
  category?: string;
}): string {
  const trimmed = args.category?.trim();

  return `<inputs>
  <narrative-continuity>
${args.narrativeContext}
  </narrative-continuity>${trimmed ? `\n  <lens hint="Tilt the question toward this dimension across the cast.">${trimmed === 'General' ? 'General — pick the single most illuminating question for THIS world, no predetermined angle. Favour foundational probes (who the cast is, what this world actually is, what matters most here) and asymmetries between what is on the page and what the entities silently carry.' : `Probe the world through the lens of "${trimmed}". The single question you propose should illuminate this dimension across the cast.`}</lens>` : ''}
</inputs>

<question-shape hint="What makes a strong question.">
  <criterion>Probes something not already explicit — knowledge asymmetries, divergent beliefs, hidden tensions, predictions, perceptions of trust / power / threat / loyalty.</criterion>
  <criterion>Is answerable IN CHARACTER. The respondent will answer privately from their world graph. No meta-narrative, no fourth-wall breaks.</criterion>
  <criterion name="signal">Questions every respondent would answer the same way are useless; questions that split the cast are gold.</criterion>
  <principle name="asymmetry-is-your-weapon">An estimate question reveals who has direct knowledge. A trust question reveals who has been burned. A forced rank reveals priorities.</principle>
</question-shape>

<question-types hint="Pick the right TYPE for the shape of insight wanted.">
  <type name="binary">Clean split.</type>
  <type name="likert">Graduated stance (use 5-point unless the question genuinely needs 3 or 7).</type>
  <type name="estimate">Numeric guess; reveals knowledge asymmetries.</type>
  <type name="choice">Forced rank among named alternatives.</type>
  <type name="open">Only when the value is the individual voice, not the aggregate.</type>
</question-types>

<scope hint="Who the question should be asked of. A well-scoped question reveals more than a carelessly-broad one.">
  <example>A trust or stance question — makes sense across all characters.</example>
  <example>A specific knowledge question — makes sense only to characters who might know.</example>
  <example>An event-witnessed question — makes sense across locations, not characters.</example>
  <example>A decision-rule question (simulation) — makes sense across agent-typed characters; reveals priorities and threshold behaviour.</example>
  <example>A scenario-role question (simulation) — makes sense across locations, surfacing terrain / jurisdiction / modelled-region differences.</example>
  <rule>Pick the narrowest scope that still generates useful variance. Do NOT ask locations or artifacts when the question only makes sense to people. Do NOT ask transient characters about matters only anchors would know.</rule>
</scope>

<instructions>
  <step>Propose ONE survey question tailored to THIS world and cast.</step>
  <step>Pick the question that would teach the author the MOST about their world — favour asymmetry-rich probes that split the cast.</step>
</instructions>

<output-format hint="Return ONE proposal as a single JSON object. No preamble, no trailing commentary. Every field below is REQUIRED — emit valid JSON only.">
{
  "question": "<question, addressed to the respondent in second person>",
  "questionType": "<one of: binary | likert | estimate | choice | open>",
  "config": <config object — see config-rules below; use null when not needed>,
  "intent": "<one short sentence: what the author would learn>",
  "suggestedFilter": {
    "kinds": ["<one or more of: character, location, artifact>"],
    "characterRoles": ["<zero or more of: anchor, recurring, transient — omit the key entirely to mean ALL>"],
    "locationProminence": ["<zero or more of: domain, place, margin — omit the key entirely to mean ALL>"],
    "artifactSignificance": ["<zero or more of: key, notable, minor — omit the key entirely to mean ALL>"]
  }
}
</output-format>

<config-rules hint="Shape of the config field by questionType.">
  <rule type="binary">Use null.</rule>
  <rule type="likert">Use {"scale": 3} or {"scale": 5} or {"scale": 7}. Default 5.</rule>
  <rule type="estimate">Use {"unit": "<short word like km, years, gold>"}.</rule>
  <rule type="choice">Use {"options": ["A","B","C", ...]} with 2-6 mutually-exclusive strings.</rule>
  <rule type="open">Use null.</rule>
</config-rules>

<filter-rules hint="suggestedFilter encodes scope as kinds + per-kind tier lists.">
  <rule>"kinds" is ALWAYS an array of one or more strings — never an object, never a bare string.</rule>
  <rule>Tier keys (characterRoles, locationProminence, artifactSignificance) are arrays of strings. To mean "all tiers", OMIT the key — do NOT write an empty array, an object, or a null.</rule>
  <rule>Only include tier keys whose kind appears in "kinds". (No characterRoles if kinds is ["location"].)</rule>
</filter-rules>`;
}

/** Build the user prompt that asks the persona for an in-character JSON answer. */
export function buildSurveyUserPrompt(survey: Survey): string {
  const { question, questionType, config } = survey;

  switch (questionType) {
    case "binary":
      return `<inputs>
  <question type="binary">${question}</question>
</inputs>

<output-format>
Respond in JSON only:
{
  "answer": true | false,
  "reasoning": "ONE short sentence in your own voice explaining why."
}
</output-format>`;
    case "likert": {
      const scale = config?.scale ?? 5;
      const anchors = scale === 3
        ? "1 = disagree, 2 = neutral, 3 = agree"
        : scale === 7
        ? "1 = strongly disagree, 4 = neutral, 7 = strongly agree"
        : "1 = strongly disagree, 3 = neutral, 5 = strongly agree";
      return `<inputs>
  <question type="likert" scale="${scale}" anchors="${anchors}">${question}</question>
</inputs>

<output-format>
Respond in JSON only:
{
  "answer": <integer 1..${scale}>,
  "reasoning": "ONE short sentence in your own voice explaining why."
}
</output-format>`;
    }
    case "estimate": {
      const unit = config?.unit ?? "";
      return `<inputs>
  <question type="estimate"${unit ? ` unit="${unit}"` : ''}>${question}</question>
</inputs>

<instructions>
  <step>Give your best honest guess as a NUMBER.</step>
</instructions>

<output-format>
Respond in JSON only:
{
  "answer": <number>,
  "reasoning": "ONE short sentence in your own voice explaining how you arrived at it."
}
</output-format>`;
    }
    case "choice": {
      const options = (config?.options ?? []).map((o) => `    <option>${o}</option>`).join("\n");
      return `<inputs>
  <question type="choice">${question}</question>
  <options hint="Pick exactly one — exact string match required.">
${options}
  </options>
</inputs>

<output-format>
Respond in JSON only:
{
  "answer": <one of the options above, exact string match>,
  "reasoning": "ONE short sentence in your own voice explaining why."
}
</output-format>`;
    }
    case "open":
      return `<inputs>
  <question type="open">${question}</question>
</inputs>

<output-format>
Respond in JSON only:
{
  "answer": "Your answer in your own voice — keep it under 3 sentences.",
  "reasoning": "Optional ONE-sentence note on what shaped that answer; may be blank."
}
</output-format>`;
  }
}
