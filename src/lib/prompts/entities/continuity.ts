/**
 * World Prompt (narrative consistency rules) — XML block injected into user
 * prompts.
 */

export const PROMPT_WORLD = `<world-consistency>
  <rule name="entity-movement">Movement between locations should be legible. The &lt;character-positions&gt; block is the chess-board — positions persist scene-to-scene; characterMovements is the mechanism for updating it when someone relocates (entering from elsewhere, departing mid-scene, or shifting between locations off-screen between scenes). Use it whenever location continuity is load-bearing; minor or off-screen drift can stay implicit when the scene doesn't turn on it. Prefer revisiting established locations. Non-literal translocation (dream-logic, ceremonial, stage-derived, fabulist, or rhetorical-frame forms) is valid when the declared register supports it; literal teleportation in a realist, documentary, or rule-driven register is a continuity break unless a stated mechanism permits it.</rule>
  <rule name="persistent-state">Costs, injuries, fatigue, debts, capabilities, positions held, rule-bound options available, and consequences persist scene to scene — physical for embodied entities, evidentiary or institutional for documentary subjects, and the agent's modelled state under the rule set for rule-driven works.</rule>
  <rule name="information-discipline">An entity cannot act on information it hasn't learned, nor invoke a rule effect its modelled position does not currently grant. Knowledge and rule-bound capabilities have to enter the graph before they can be wielded or cited.</rule>
  <rule name="time-gaps">Signal time gaps clearly — "Three days later", "By morning", "Two years on", "Tick 47", "Round 12".</rule>
</world-consistency>`;
