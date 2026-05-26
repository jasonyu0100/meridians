/**
 * Arc Grouping Prompt
 *
 * For each arc (a narrative unit of ~4 scenes), name it and emit two metadata
 * fields alongside:
 *   - directionVector — forward-looking intent, single sentence
 *   - worldState — backward-looking compact state snapshot at arc end
 *
 * worldState is domain-adaptive — the corpus may be fiction, a chess game, a
 * poker hand, an academic paper, a stock log, a wargame turn, a modelled
 * scenario state. The prompt forces the model to identify the work type
 * first, then emit state in that domain's native form.
 */

import { PROMPT_ARC_STATE_GUIDANCE } from '@/lib/prompts/core/game-state';

export const ARC_GROUPING_SYSTEM =
  'You are a world-view analyst. Name arcs and emit arc metadata (direction + compact world state) based on scene summaries. The world view may be a narrative, an argument, a chronicled record, a typology, an adversarial contest, or a modelled simulation — read what the summaries actually present and adapt. Return only a JSON array of objects.';

export interface ArcGroup {
  sceneIndices: number[];
  summaries: string[];
}

export interface ArcGroupingOutput {
  name: string;
  directionVector: string;
  worldState: string;
}

export function buildArcGroupingPrompt(groups: ArcGroup[]): string {
  const arcsXml = groups
    .map((g, i) => {
      const first = g.sceneIndices[0] + 1;
      const last = g.sceneIndices[g.sceneIndices.length - 1] + 1;
      const scenes = g.summaries
        .map((s, j) => `      <scene index="${g.sceneIndices[j] + 1}">${s}</scene>`)
        .join('\n');
      return `    <arc index="${i + 1}" first-scene="${first}" last-scene="${last}">
${scenes}
    </arc>`;
    })
    .join('\n');

  return `<inputs>
  <arcs hint="Each arc is a narrative unit of ~4 scenes.">
${arcsXml}
  </arcs>
  <arc-state-guidance>
${PROMPT_ARC_STATE_GUIDANCE}
  </arc-state-guidance>
</inputs>

<instructions>
  <task>Name each arc and emit its metadata (directionVector + worldState) based on the scene summaries.</task>
  <rules>
    <rule>Each name captures the arc's thematic thrust in 2-5 words — evocative and specific, not generic.</rule>
    <rule>directionVector must read as forward intent for THIS arc, not a summary of what happened.</rule>
    <rule>worldState must be ground-truth only, 50-90 words, in the native compact form for the DETECTED domain (fiction, chess, poker, paper, stock log, wargame turn, modelled scenario state, etc). For a simulation work, render worldState as the modelled state under the rule set — current values of the load-bearing variables, gates passed or pending, conditions that have fired.</rule>
    <rule>Output must be a JSON array with length exactly equal to the number of arcs above.</rule>
  </rules>
</instructions>

<output-format>
Return a JSON array (one object per arc, in order) with this exact shape:
[
  {
    "name": "2-5 word evocative name for the arc — specific to what this arc IS (e.g. 'The Betrayal at Dawn' for fiction, 'Attention Replaces Recurrence' for a research paper, 'Return to the Burned House' for memoir, 'Inside the Whistleblower's Files' for reportage, 'Cascade Reaches Tier-Three' for a simulation / scenario work). Not generic ('Events', 'Section 2').",
    "directionVector": "Forward-looking intent — see arc-state-guidance.",
    "worldState": "Backward-looking compact state snapshot as of the END of this arc — see arc-state-guidance for domain-adaptive form."
  }
]
</output-format>`;
}
