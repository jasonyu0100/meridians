/**
 * World Prompt (narrative consistency rules) — XML block injected into user
 * prompts.
 */

export const PROMPT_WORLD = `<world-consistency>
  <rule name="entity-position">A character's position is the location of the most recent scene where they participate — the &lt;character-positions&gt; block shows the current chess-board. Move them by listing them in a participantIds at a different scene.locationId; their position updates implicitly. Prefer revisiting established locations. Non-literal translocation (dream-logic, ceremonial, stage-derived, fabulist, or rhetorical-frame forms) is valid when the declared register supports it; literal teleportation in a realist, documentary, or rule-driven register is a continuity break unless a stated mechanism permits it.</rule>
  <rule name="persistent-state">Costs, injuries, fatigue, debts, capabilities, positions held, rule-bound options available, and consequences persist scene to scene — physical for embodied entities, evidentiary or institutional for documentary subjects, and the agent's modelled state under the rule set for rule-driven works.</rule>
  <rule name="information-discipline">An entity cannot act on information it hasn't learned, nor invoke a rule effect its modelled position does not currently grant. Knowledge and rule-bound capabilities have to enter the graph before they can be wielded or cited.</rule>
  <rule name="time-gaps">Signal time gaps clearly — "Three days later", "By morning", "Two years on", "Tick 47", "Round 12".</rule>
</world-consistency>`;
