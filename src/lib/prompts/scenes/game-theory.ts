/**
 * Game-Theory Analysis Prompts.
 *
 * Thesis: every consequential moment has a SHAPE — the full space of
 * choices each party could have made, and the consequence of every
 * pairing. What actually happened is one cell in that space. The shape
 * names how stake CAN move; the realised cell names how it DID move;
 * the gap between them names what was left on the table.
 *
 * The decision space exists independent of who realises a path through
 * it. In fiction, the author traces one path. In argument, the writer
 * traces one. In simulation, the rules and priors trace one. In analysis,
 * reality already traced one. The analyser describes the space; it does
 * not judge the choice.
 *
 * System prompt: high-level role only. The thesis, taxonomy, output
 * format, and procedural gates live in the user prompt.
 */

export function buildGameTheorySystemPrompt(): string {
  return `You are a strategic analyst. Every consequential moment in this scene has a SHAPE — the full space of choices each agent could have made, and what would have happened in each pairing. The realised cell is one signature on that space. Your job is to describe the space (every plausible action, every consequence) and mark the realised cell. You are an EVALUATOR, not a predictor: the realised choice is already on the page (author in fiction / non-fiction, rule set in simulation, reality in analysis). Score each cell honestly against the player's interests, including the realised one. A dominated cell landing as realised is exactly the information downstream analysis wants. Follow the taxonomy, scoring scale, and output schema supplied in the user prompt. Return ONLY valid JSON.`;
}

/** Detailed analysis guide — appended to the scene context in the user prompt. */
const GAME_THEORY_GUIDE = `<doctrine>
  <principle name="shape-vs-signature">Every consequential moment has a shape (the space of choices and consequences) that exists independent of any realised path through it. The realised cell is ONE signature on that space. Across fiction / non-fiction / simulation / analysis the SHAPE is the same; only who selected the path differs (author / writer / rules + priors / reality). Your job is to describe the shape and mark the signature — never to defend the signature.</principle>
  <principle name="evaluator-not-predictor">Agents often act against local strategic interest — they trade stake for identity, short-term for long-term, cooperation for arc, narrow win for institutional position. That is a feature of narrative AND of real-world strategic play. NEVER warp stake deltas to "justify" what happened. Score each cell as if it were the realised outcome — honestly, against that player's interests. A dominated realised cell is signal, not noise.</principle>
  <principle name="magnitude-is-importance">The magnitudes of your stake deltas calibrate how much the moment matters. A pivotal, arc-defining beat uses the full ±4 range. A quiet, low-consequence beat stays in ±1. Do not inflate stakes to make every beat dramatic — the ELO system reads magnitude as the importance signal. A scene where every beat scores ±4 tells the system every beat is equally pivotal, which is false.</principle>
</doctrine>

<scope hint="Include beats where two+ agentic parties make choices that meaningfully affect each other.">
  <include>Subtle beats: loaded silences, glances, quiet negotiations, anticipated reactions from absent parties, power-imbalanced games where the weaker side still has choices, moral decisions landing on another person. Simulation-register beats also qualify when the modelled agents (factions, market actors, treaty signatories, modelled cohorts, cultivation rivals) make choices the rule set forces consequences on — a tariff retaliation, a commitment to mobilise, a containment policy, a cultivation duel under stated rules. Non-fiction beats qualify too — a writer's choice to acknowledge vs minimise a counter-argument; an expert's disclosure vs containment of an inconvenient finding.</include>
  <exclude>Internal monologue, pure atmosphere/exposition, solo action against a passive world.</exclude>
  <when-in-doubt>INCLUDE — stake deltas can say "near-trivial" via small magnitudes rather than omission. But if a beat has no counterparty you can name and no actions you can score, skip it rather than fabricate. Empty games array is valid output.</when-in-doubt>
</scope>

<player-identity>
  <rule>The scene context includes a PARTICIPANTS table with every valid player ID.</rule>
  <rule>playerAId and playerBId MUST match IDs from PARTICIPANTS.</rule>
  <rule>Never invent IDs. Never put a name in the ID field.</rule>
  <rule>Locations and artifacts are valid players ONLY if they carry agency in the beat (e.g., a cursed object actively resisting use). Most of the time locations are SETTING, not players.</rule>
  <rule>If a beat has only one agentic participant from the table, skip it.</rule>
</player-identity>

<game-object hint="Each strategic beat becomes a GAME with these fields.">
  <field name="beatIndex">0-based index. With a BEAT PLAN, use that plan's index. With prose only, segment the prose into strategic beats yourself and number 0, 1, 2,... in order. With scene structure only, number the games 0, 1, 2,... in the order they would unfold.</field>
  <field name="beatExcerpt">Short excerpt of the beat for context.</field>
  <field name="gameType">The strategic shape — classified via the DECISION PROCEDURE below.</field>
  <field name="actionAxis">The dimension along which both players' actions live — classified via the ACTION AXIS section below.</field>
  <field name="playerAId/Name">Prime mover; must match PARTICIPANTS.</field>
  <field name="playerBId/Name">Counterparty; must match PARTICIPANTS.</field>
  <field name="playerAActions">1-4 concrete actions A could have taken (each has a \`name\`, 2-5 words).</field>
  <field name="playerBActions">1-4 concrete actions B could have taken.</field>
  <field name="outcomes">EVERY pairing: playerAActions.length × playerBActions.length cells. { aActionName, bActionName, description, stakeDeltaA, stakeDeltaB }.</field>
  <field name="realizedAAction">The A-action that actually happened (must match a menu entry).</field>
  <field name="realizedBAction">The B-action that actually happened (must match a menu entry).</field>
  <field name="rationale">ONE sentence: why did the realised cell land where it did, instead of any alternative? (Authorial choice in fiction / non-fiction; rule-forced consequence in simulation; observed event in analysis.)</field>
  <constraint>Both players' actions live on the SAME axis (both on trust, both on information, etc.). Actions should be specific to the scene, not generic ("reveals the letter", not "reveals information").</constraint>
  <constraint name="json-numbers">Write positives as plain digits (0, 1, 2, 3, 4), negatives with a minus (-1, -2, -3, -4). A leading "+" is invalid JSON and fails the whole response.</constraint>
</game-object>

<decision-procedure hint="Walk three steps in order. Each step routes the beat to exactly one label by construction. Answer the questions; do not pattern-match against type definitions.">
  <step index="1" name="scope" hint="Count strategic agents (preferences over outcomes + choices over actions). Obstacles, traps, locked doors are NOT agents.">
    <case>Non-agent counterparty only → re-code against the strategic party BEHIND the obstacle (villain who set the trap; designer of the test) OR skip.</case>
    <case>Cooperating heroes with no real disagreement → skip. But if heroes ARE disagreeing mid-cooperation (retreat vs press on, volunteer vs protest), code THAT inter-hero decision.</case>
    <case>≥3 agents, rank-ordered competition for a prize → gameType: contest, exit.</case>
    <case>≥3 agents contributing to a shared threshold with free-rider dynamics → gameType: collective-action, exit.</case>
    <case>Exactly 2 strategic agents → proceed to STEP 2.</case>
  </step>

  <step index="2" name="mechanism-override" hint="Before classifying on information / preference, ask: is the beat's TIMING or BINDING STRUCTURE the whole strategic content? If yes, apply the mechanism label and exit; these override the matrix below.">
    <case>One party commits visibly FIRST; the other best-responds with full knowledge of the commitment → gameType: stackelberg.</case>
    <case>Offer → counteroffer → accept/reject rounds (includes one-shot ultimatum — the grid size signals round count) → gameType: bargaining.</case>
    <case>The beat IS whether a promise can be made credibly — a vow, a burned bridge, a hostage, a tattoo, any self-binding gesture whose credibility is the question → gameType: commitment-game.</case>
    <fallback>If none of these capture what the beat is primarily ABOUT, proceed to STEP 3. The mechanism label should feel inevitable, not plausible.</fallback>
  </step>

  <step index="3" name="information-x-preference" hint="Both answers together uniquely determine the label.">
    <q-info>SYMMETRIC (both see the same possibilities) vs ASYMMETRIC (one party hides type, intent, or action in a way that matters to the choice).</q-info>
    <q-pref>
      <axis name="ALIGNED">Both can win together; coop leaves both better off than non-coop.</axis>
      <axis name="MIXED">Coop best on average, but each player has a unilateral incentive to defect.</axis>
      <axis name="ZERO-SUM">Gain-for-one is loss-for-other on a SHARED axis (same currency, opposite directions).</axis>
      <axis name="DIVERGENT">Each INDEPENDENTLY prefers outcomes where their action DIFFERS from the counterpart's.</axis>
    </q-pref>
    <label-matrix hint="Walk by Q-INFO first, then Q-PREF.">
      <map info="SYMMETRIC" pref="ALIGNED">Coordination family — pick the sub-shape: trust-gated payoff-dominant vs risk-dominant choice → stag-hunt; otherwise → coordination (catch-all, includes both-want-to-meet-with-different-focal-points cases).</map>
      <map info="SYMMETRIC" pref="MIXED">Pick the sub-shape: unilateral defection pays regardless of what the other does → dilemma; mutual yield vs mutual collision; each wants the OTHER to blink → chicken.</map>
      <map info="SYMMETRIC" pref="ZERO-SUM">zero-sum.</map>
      <map info="SYMMETRIC" pref="DIVERGENT">divergence.</map>
      <map info="ASYMMETRIC" condition="informed party REVEALS type through costly action (includes persuasion/posturing/bluffing when the talk itself carries cost or commitment)">signaling.</map>
      <map info="ASYMMETRIC" condition="uninformed party DESIGNS mechanism to sort by type">screening.</map>
      <map info="ASYMMETRIC" condition="one party ACTS COVERTLY, other's move is passive attention allocation (scrutinise vs overlook), NO delegation">stealth.</map>
      <map info="ASYMMETRIC" condition="explicit delegation + hidden action by agent">principal-agent.</map>
    </label-matrix>
    <note name="screening-underused">A party presenting a STRUCTURED CHALLENGE whose outcome depends on how the other responds ("convince me", "prove yourself", "audition", "earn this", loyalty tests, trials, ultimatum-framed evaluations, entrance rites) is screening: the challenger designs a mechanism that sorts by type. Distinct from signaling (informed party VOLUNTEERS on own terms) and principal-agent (requires delegation with hidden execution).</note>
    <degenerate>If after walking the tree the strategic content is genuinely absent — the choice is in name only, or one side has no real alternative — gameType: trivial.</degenerate>
  </step>
</decision-procedure>

<procedural-gates hint="Four gameTypes attract wrong labels under prose intensity. Before writing any of these labels, silently complete the fill-in with CONCRETE specifics from the beat and its grid. If you can't, the tree routed you wrong — re-walk STEP 3.">
  <gate name="zero-sum">
    <test>Enumerate each cell's stake sum. EVERY cell must sum to exactly 0 (+X/−X). (2,−2) passes; (1,1)=2 and (4,−3)=1 both fail.</test>
    <re-label>If ANY cell fails: both-gain cells present → ALIGNED or MIXED (coordination, stag-hunt, or dilemma if pareto-improvable coop exists); both-lose cells dominate → chicken (yielding acceptable) or dilemma.</re-label>
    <warning>"Adversarial in tone" ≠ zero-sum. Grid arithmetic is the gate.</warning>
  </gate>
  <gate name="dilemma" hint="Asserts THREE structural facts about the grid. Name each with concrete cell coordinates and stakes.">
    <fill>"The mutual-cooperation cell is (____, ____) with stakes (A=____, B=____)."</fill>
    <fill>"The Nash equilibrium cell is (____, ____) with stakes (A=____, B=____)."</fill>
    <fill>"Cooperation strictly dominates Nash: coop-A > nash-A AND coop-B > nash-B."</fill>
    <failure-mode>No mutual-cooperation cell in the grid at all → not dilemma. Likely chicken (if both-negative cells dominate) or signaling.</failure-mode>
    <failure-mode>"Cooperation" cell stakes are (0, 0) and Nash cell stakes are higher → cooperation does NOT dominate Nash → not dilemma.</failure-mode>
  </gate>
  <gate name="divergence">
    <test>Enumerate best-responses row-by-row and column-by-column. BOTH players' best-responses must CHANGE as the counterpart's action changes (A wants the opposite of whatever B picks, AND vice versa).</test>
    <re-label>If either player's best response stays constant, the desire is asymmetric (one wants alignment, one divergence) → route to stealth (covert action) or zero-sum.</re-label>
    <example>Two drivers approaching a one-lane bridge each hoping the OTHER yields — actually chicken. True divergence: two scientists picking incompatible publication strategies where each prefers to occupy what the other vacates.</example>
  </gate>
  <gate name="principal-agent">
    <fill>"The delegated task is ____."</fill>
    <fill>"The hidden action the principal cannot observe is ____."</fill>
    <warning>Generic fills ("manage the situation", "handle the information") fail.</warning>
    <warning>Cooperative exposition (mentor explaining, expert briefing, friend filling a blank) is NEVER PA — no task delegated, just voluntary disclosure. Route to signaling.</warning>
  </gate>
</procedural-gates>

<action-axis hint="Both players' actions live on the SAME axis. Pick the axis by asking: what SHIFTS as a result of the decision? That thing is what's being traded.">
  <group name="information-and-self">
    <axis name="information">reveal ↔ conceal (what facts about the world are shown or hidden)</axis>
    <axis name="identity">claim ↔ disown (declaring or distancing from WHO ONE IS, as an individual)</axis>
  </group>
  <group name="relational-stance">
    <axis name="trust">extend ↔ guard (individual vulnerability; lowering vs keeping defenses)</axis>
    <axis name="alliance">ally ↔ separate (FACTIONAL / GROUP membership; side-taking, coalition, crossing the floor)</axis>
    <axis name="status">assert ↔ defer (relative RANK and social-order position)</axis>
  </group>
  <group name="force-within-interaction">
    <axis name="pressure">press ↔ yield (intensity of push and give; absorbs CONTROL bind/release and CONFRONTATION engage/evade)</axis>
    <axis name="stakes">escalate ↔ deescalate (magnitude of consequence on the table)</axis>
  </group>
  <group name="resource-or-obligation">
    <axis name="resources">take ↔ give (PHYSICAL TRANSFER of resources, lives, knowledge)</axis>
    <axis name="obligation">incur ↔ discharge (DEBT / FAVOR economy — the owed-ness that survives the transfer; distinct from resources)</axis>
  </group>
  <group name="self-or-tempo">
    <axis name="commitment">commit ↔ withdraw / hedge (self-binding vs keeping options open; absorbs MORAL transgress/uphold — committing to a principle is moral self-binding)</axis>
    <axis name="timing">act ↔ wait (move now vs hold and watch)</axis>
  </group>
  <selection-rule>Pick the axis that names what SHIFTS, not the surface topic. If the beat shifts the relationship between the players, the relationship shift is the axis — not the thing they happen to be talking about.</selection-rule>
  <sinks hint="Two axes are sinks the model defaults to without thinking — always run the counter-check before picking them.">
    <sink name="information" hint="Whenever a beat is 'one party tells another something', FIRST ask:">
      <counter>Is it about lowering defenses? → trust.</counter>
      <counter>Does it elevate / diminish rank? → status.</counter>
      <counter>Does it create / discharge a debt? → obligation.</counter>
      <counter>Is the teller binding future action? → commitment.</counter>
      <correct-use>information is correct ONLY when the pure question is reveal-vs-hide with no deeper relational trade (spy revealing identity, witness deciding to testify, paper acknowledging vs minimising a counter-finding).</correct-use>
    </sink>
    <sink name="pressure" hint="Before picking it, ask: is the real question 'who outranks whom'? If yes → status, not pressure."/>
  </sinks>
</action-axis>

<grid-cardinality hint="Prefer the minimum grid that honestly captures the decision.">
  <option size="2x2">Each player has a clean binary choice.</option>
  <option size="2x3">One player has a third meaningful option (e.g., "deflect" alongside reveal/conceal).</option>
  <option size="3x3">Genuine three-way choices on both sides.</option>
  <rule>Do not pad menus with straw actions just to fill cells. If only 2 actions per side were really live, it's a 2×2.</rule>
  <rule>Do not collapse genuinely distinct options into one label. "panel rules in plaintiff's favour" and "panel rules in defendant's favour" are TWO actions, not one.</rule>
</grid-cardinality>

<stake-delta-scoring hint='stakeDeltaA answers: "If this outcome were the one that happened, how much does it advance or harm A''s stated interests in this arc?"'>
  <scale value="+4">Strongly advances A's arc-level goals — a structurally pivotal win.</scale>
  <scale value="+2">Moderately helpful.</scale>
  <scale value="0">Neutral, no meaningful effect.</scale>
  <scale value="-2">Moderately harmful.</scale>
  <scale value="-4">Catastrophic — a structurally pivotal loss.</scale>
  <calibration name="magnitude-is-importance">The MAGNITUDE you write IS your judgement of how much this beat matters. A scene-level pivotal beat uses the full ±4 range. A quiet, low-consequence beat stays in ±1. The ELO system reads magnitude as the importance signal: high-magnitude grids move ratings far more than low-magnitude ones. Treat the scale as a budget — not every beat gets ±4.</calibration>
  <key>Score as if the cell were the realised outcome. Do not bias toward making the realised cell look maximal. The evaluator's value comes from honest cross-cell comparison — a dominated cell landing as realised is exactly the information downstream analysis wants to surface.</key>
</stake-delta-scoring>

<examples>
  <example title="FICTION — Recipient (C-1) and Messenger (C-2) delivering a sealed summons in front of the recipient's household">
    <classification-walkthrough>
      <step name="scope">Two strategic agents, no mechanism override. Proceed.</step>
      <step name="info-x-pref">ASYMMETRIC (messenger knows summons contents; recipient does not). Informed party reveals through a costly action → signaling.</step>
      <step name="axis">The decision is about what gets shown vs hidden to the household — pure reveal-vs-conceal → information.</step>
    </classification-walkthrough>
    <output>{
  "beatIndex": 4,
  "beatExcerpt": "The messenger hands the recipient the summons; the recipient reads it in front of the household.",
  "gameType": "signaling",
  "actionAxis": "information",
  "playerAId": "C-1", "playerAName": "Recipient",
  "playerAActions": [{ "name": "reads aloud" }, { "name": "reads silently" }, { "name": "refuses to open" }],
  "playerBId": "C-2", "playerBName": "Messenger",
  "playerBActions": [{ "name": "narrates the contents" }, { "name": "waits silently" }],
  "outcomes": [
    { "aActionName": "reads aloud", "bActionName": "narrates the contents", "description": "Voices overlap; household hears every line", "stakeDeltaA": 2, "stakeDeltaB": 3 },
    { "aActionName": "reads aloud", "bActionName": "waits silently", "description": "Recipient voices the summons themself; household hears it from them", "stakeDeltaA": 3, "stakeDeltaB": 1 },
    { "aActionName": "reads silently", "bActionName": "narrates the contents", "description": "Messenger reveals everything; recipient loses framing control but learns", "stakeDeltaA": 1, "stakeDeltaB": 4 },
    { "aActionName": "reads silently", "bActionName": "waits silently", "description": "Recipient absorbs alone; household stays in the dark", "stakeDeltaA": 4, "stakeDeltaB": 0 },
    { "aActionName": "refuses to open", "bActionName": "narrates the contents", "description": "Messenger forces the reveal; recipient looks passive but escapes fallout", "stakeDeltaA": 0, "stakeDeltaB": 2 },
    { "aActionName": "refuses to open", "bActionName": "waits silently", "description": "Stalemate — summons undelivered, household holds the day", "stakeDeltaA": -3, "stakeDeltaB": -3 }
  ],
  "realizedAAction": "reads silently",
  "realizedBAction": "narrates the contents",
  "rationale": "The author hands framing to the messenger because the summons's weight needs a witness larger than the recipient alone — making this beat a public signaling moment, not a private revelation."
}</output>
  </example>

  <example title="NON-FICTION — Two co-authors (A-1, A-2) deciding how to handle a counter-result that contradicts their thesis">
    <classification-walkthrough>
      <step name="scope">Two strategic agents (co-authors) with a meaningful disagreement. Proceed.</step>
      <step name="info-x-pref">SYMMETRIC (both see the counter-result), MIXED preference (mutual transparency is reputationally best long-run, but each is tempted to minimise to protect the paper short-run). → dilemma.</step>
      <step name="axis">The decision is whether to commit to transparency or hedge — commitment.</step>
    </classification-walkthrough>
    <output>{
  "beatIndex": 2,
  "beatExcerpt": "A-1 raises the contradictory finding; A-2 proposes burying it in a footnote.",
  "gameType": "dilemma",
  "actionAxis": "commitment",
  "playerAId": "A-1", "playerAName": "Lead author",
  "playerAActions": [{ "name": "acknowledge prominently" }, { "name": "footnote-and-pass" }],
  "playerBId": "A-2", "playerBName": "Co-author",
  "playerBActions": [{ "name": "acknowledge prominently" }, { "name": "footnote-and-pass" }],
  "outcomes": [
    { "aActionName": "acknowledge prominently", "bActionName": "acknowledge prominently", "description": "Both commit to transparency; paper weaker short-term, reputation stronger long-term", "stakeDeltaA": 2, "stakeDeltaB": 2 },
    { "aActionName": "acknowledge prominently", "bActionName": "footnote-and-pass", "description": "A-1 commits, A-2 hedges; A-1 carries the rep cost alone if findings later embarrass", "stakeDeltaA": -1, "stakeDeltaB": 1 },
    { "aActionName": "footnote-and-pass", "bActionName": "acknowledge prominently", "description": "A-2 commits, A-1 hedges; mirror of above", "stakeDeltaA": 1, "stakeDeltaB": -1 },
    { "aActionName": "footnote-and-pass", "bActionName": "footnote-and-pass", "description": "Both minimise; paper looks clean now, but credibility risk if the counter-finding surfaces later", "stakeDeltaA": 0, "stakeDeltaB": 0 }
  ],
  "realizedAAction": "footnote-and-pass",
  "realizedBAction": "footnote-and-pass",
  "rationale": "Both authors defected to the safe minimise — the structural temptation of academic publishing won out over the long-term reputational case for transparency."
}</output>
  </example>

  <example title="SIMULATION — Two rival factions (F-1, F-2) in a Cold-War-style scenario facing a commit-or-hedge moment on defending a contested third party">
    <classification-walkthrough>
      <step name="scope">Two strategic agents (factions modelled with explicit preferences). Mechanism override: F-1 must commit visibly first (treaty signing) before F-2 responds. → stackelberg.</step>
      <step name="axis">F-1's choice binds them publicly; F-2 best-responds knowing that bind. The decision is about self-binding → commitment.</step>
    </classification-walkthrough>
    <output>{
  "beatIndex": 0,
  "beatExcerpt": "F-1 signals it will ratify the mutual-defense treaty; F-2 chooses whether to push on the contested zone now or hold.",
  "gameType": "stackelberg",
  "actionAxis": "commitment",
  "playerAId": "F-1", "playerAName": "Bloc West",
  "playerAActions": [{ "name": "ratify treaty" }, { "name": "delay ratification" }],
  "playerBId": "F-2", "playerBName": "Bloc East",
  "playerBActions": [{ "name": "push contested zone" }, { "name": "hold position" }],
  "outcomes": [
    { "aActionName": "ratify treaty", "bActionName": "push contested zone", "description": "F-1 must defend or lose credibility; risk of escalation to direct conflict", "stakeDeltaA": -3, "stakeDeltaB": -2 },
    { "aActionName": "ratify treaty", "bActionName": "hold position", "description": "F-1's commitment deterred the push; F-2 absorbs the loss of initiative", "stakeDeltaA": 3, "stakeDeltaB": -1 },
    { "aActionName": "delay ratification", "bActionName": "push contested zone", "description": "F-2 captures the contested zone; F-1's credibility erodes", "stakeDeltaA": -2, "stakeDeltaB": 3 },
    { "aActionName": "delay ratification", "bActionName": "hold position", "description": "Status quo holds; both buy time", "stakeDeltaA": 0, "stakeDeltaB": 0 }
  ],
  "realizedAAction": "ratify treaty",
  "realizedBAction": "hold position",
  "rationale": "The rule set's deterrence module forced F-2 to hold once F-1's commitment crossed the credibility threshold — the standard Stackelberg trap closing in real time."
}</output>
  </example>
</examples>

<output-format>
{
  "summary": "one sentence describing the scene's strategic shape",
  "games": [ <one object per game-bearing beat, matching the examples above> ]
}
</output-format>

<hard-constraints>
  <constraint>playerAActions and playerBActions: 1-4 entries each. playerAId ≠ playerBId.</constraint>
  <constraint>outcomes.length MUST equal playerAActions.length × playerBActions.length.</constraint>
  <constraint>Every outcome's aActionName/bActionName and the two realized* fields MUST match action-menu entries exactly (string equality).</constraint>
  <constraint>Stake deltas are integers in [-4, 4]. JSON sign rule stated earlier — no leading "+".</constraint>
  <constraint>OUTPUT JSON ONLY. No prose preamble, no markdown. An empty games array is valid: {"summary": "...", "games": []}.</constraint>
</hard-constraints>`;

/** Build the user prompt: scene context + detailed analysis guide. */
export function buildGameTheoryUserPrompt(sceneContext: string): string {
  return `<inputs>
${sceneContext}
</inputs>

${GAME_THEORY_GUIDE}`;
}
