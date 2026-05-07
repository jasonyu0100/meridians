/**
 * Game-Theory Analysis Prompts.
 *
 * System prompt: high-level role only. The classification framework, action
 * axes, output format, and procedural gates live in the user prompt
 * (`buildGameTheoryUserPrompt`).
 */

export function buildGameTheorySystemPrompt(): string {
  return `You are a strategic analyst. For each beat bearing a meaningful decision in the scene, map the OUTCOME SPACE — every plausible action each participant could have taken, and the consequences of every pairing. You are an EVALUATOR, not a predictor: the realised outcome is already on the page (chosen by the author in fiction / non-fiction, or forced by the rule set in simulation); your job is to describe the alternatives, not judge the choice. Follow the classification procedure, action-axis taxonomy, scoring scale, and output schema supplied in the user prompt. Return ONLY valid JSON.`;
}

/** Detailed analysis guide — appended to the scene context in the user prompt. */
const GAME_THEORY_GUIDE = `<doctrine>
  <principle name="evaluator-not-predictor">Agents often act against local strategic interest — they trade stake for identity, short-term for long-term, cooperation for arc, narrow win for institutional position. That is a feature of narrative (and of real-world strategic play). NEVER warp stake deltas to "justify" what happened. Score each cell as if it were the realized outcome — honestly, against that player's interests. The realised cell landing on a dominated branch (whether by authorial choice or rule-forced consequence) is exactly the information the downstream analysis wants.</principle>
</doctrine>

<scope hint="Include beats where two+ agentic parties make choices that meaningfully affect each other.">
  <include>Subtle beats: loaded silences, glances, quiet negotiations, anticipated reactions from absent parties, power-imbalanced games where the weaker side still has choices, moral decisions landing on another person. Simulation-register beats also qualify when the modelled agents (factions, market actors, treaty signatories, modelled cohorts, cultivation rivals) make choices the rule set forces consequences on — a tariff retaliation, a commitment to mobilise, a containment policy, a cultivation duel under stated rules.</include>
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
  <field name="gameType">Classified via the DECISION PROCEDURE below.</field>
  <field name="actionAxis">Classified via the ACTION AXIS section below.</field>
  <field name="playerAId/Name">Prime mover; must match PARTICIPANTS.</field>
  <field name="playerBId/Name">Counterparty; must match PARTICIPANTS.</field>
  <field name="playerAActions">1-4 concrete actions A could have taken (each has a \`name\`, 2-5 words).</field>
  <field name="playerBActions">1-4 concrete actions B could have taken.</field>
  <field name="outcomes">EVERY pairing: playerAActions.length × playerBActions.length cells. { aActionName, bActionName, description, stakeDeltaA, stakeDeltaB }.</field>
  <field name="realizedAAction">The A-action that actually happened (must match a menu entry).</field>
  <field name="realizedBAction">The B-action that actually happened (must match a menu entry).</field>
  <field name="rationale">ONE sentence: why did the realised cell land where it did (authorial choice in fiction / non-fiction, or rule-forced consequence in simulation), instead of any alternative?</field>
  <constraint>Both players' actions live on the SAME axis (both on disclosure, both on trust, etc.). Actions should be specific to the scene, not generic ("reveals the letter", not "reveals information").</constraint>
  <constraint name="json-numbers">Write positives as plain digits (0, 1, 2, 3, 4), negatives with a minus (-1, -2, -3, -4). A leading "+" is invalid JSON and fails the whole response.</constraint>
</game-object>

<decision-procedure hint="Walk three steps in order. Each step routes the beat to exactly one label by construction. Answer three questions, do not pattern-match against type definitions.">
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
    <case>Non-binding words are the move, and the talk itself shapes what happens (persuasion, posturing, bluffing) → gameType: cheap-talk.</case>
    <fallback>If none of these capture what the beat is primarily ABOUT, proceed to STEP 3 — the mechanism label should feel inevitable, not plausible.</fallback>
  </step>

  <step index="3" name="information-x-preference" hint="Both answers together uniquely determine the label.">
    <q-info>SYMMETRIC (both see the same possibilities) vs ASYMMETRIC (one party hides type, intent, or action in a way that matters to the choice).</q-info>
    <q-pref>
      <axis name="ALIGNED">Both can win together; coop leaves both better off than non-coop.</axis>
      <axis name="MIXED">Coop best on average, but each player has a unilateral incentive to defect.</axis>
      <axis name="ZERO-SUM">Gain-for-one is loss-for-other on a SHARED axis (same currency, opposite directions).</axis>
      <axis name="DIVERGENT">Each INDEPENDENTLY prefers outcomes where their action DIFFERS from the counterpart's.</axis>
      <axis name="INCOMMENSURABLE">Values at stake are different KINDS of thing with no common currency.</axis>
    </q-pref>
    <label-matrix hint="Walk by Q-INFO first, then Q-PREF.">
      <map info="SYMMETRIC" pref="ALIGNED">Coordination family — pick the sub-shape: payoff-dominant vs risk-dominant trust-limited choice → stag-hunt; both want to meet but prefer different focal points → battle-of-sexes; otherwise → coordination.</map>
      <map info="SYMMETRIC" pref="MIXED">Pick the sub-shape: unilateral defection pays regardless of what the other does → dilemma; mutual yield vs mutual collision; each wants the OTHER to blink → chicken.</map>
      <map info="SYMMETRIC" pref="ZERO-SUM">zero-sum.</map>
      <map info="SYMMETRIC" pref="DIVERGENT">anti-coordination.</map>
      <map info="SYMMETRIC" pref="INCOMMENSURABLE">pure-opposition.</map>
      <map info="ASYMMETRIC" condition="informed party REVEALS type through costly action">signaling.</map>
      <map info="ASYMMETRIC" condition="uninformed party DESIGNS mechanism to sort by type">screening.</map>
      <map info="ASYMMETRIC" condition="one party ACTS COVERTLY, other's move is passive attention allocation (scrutinise vs overlook)">stealth.</map>
      <map info="ASYMMETRIC" condition="explicit delegation + hidden action by agent">principal-agent.</map>
    </label-matrix>
    <note name="screening-underused">A party presenting a STRUCTURED CHALLENGE whose outcome depends on how the other responds ("convince me", "prove yourself", "audition", "earn this", loyalty tests, trials, ultimatum-framed evaluations, entrance rites) is screening: the challenger designs a mechanism that sorts by type. Distinct from signaling (informed party VOLUNTEERS on own terms) and principal-agent (requires delegation with hidden execution).</note>
    <degenerate>If after walking the tree the strategic content is genuinely absent — the choice is in name only, or one side has no real alternative — gameType: trivial.</degenerate>
  </step>
</decision-procedure>

<procedural-gates hint="Five gameTypes attract wrong labels under prose intensity. Before writing any of these labels, silently complete the fill-in with CONCRETE specifics from the beat and its grid. If you can't, the tree routed you wrong — re-walk STEP 3.">
  <gate name="zero-sum">
    <test>Enumerate each cell's stake sum. EVERY cell must sum to exactly 0 (+X/−X). (2,−2) passes; (1,1)=2 and (4,−3)=1 both fail.</test>
    <re-label>If ANY cell fails: both-gain cells present → ALIGNED or MIXED (coordination, stag-hunt, battle-of-sexes, or dilemma if pareto-improvable coop exists); both-lose cells dominate → chicken (yielding acceptable) or dilemma.</re-label>
    <warning>"Adversarial in tone" ≠ zero-sum. Grid arithmetic is the gate.</warning>
  </gate>
  <gate name="dilemma" hint="Asserts THREE structural facts about the grid. Name each with concrete cell coordinates and stakes.">
    <fill>"The mutual-cooperation cell is (____, ____) with stakes (A=____, B=____)."</fill>
    <fill>"The Nash equilibrium cell is (____, ____) with stakes (A=____, B=____)."</fill>
    <fill>"Cooperation strictly pareto-dominates Nash: coop-A > nash-A AND coop-B > nash-B."</fill>
    <failure-mode>No mutual-cooperation cell in the grid at all → not dilemma. Likely chicken (if both-negative cells dominate) or signaling.</failure-mode>
    <failure-mode>"Cooperation" cell stakes are (0, 0) and Nash cell stakes are higher → cooperation does NOT dominate Nash → not dilemma.</failure-mode>
    <failure-mode>No pure-strategy Nash (matching-pennies shape, mixed-strategy only) → not dilemma. Route to zero-sum (if sums check out) or stealth / signaling.</failure-mode>
  </gate>
  <gate name="anti-coordination">
    <test>Enumerate best-responses row-by-row and column-by-column. BOTH players' best-responses must CHANGE as the counterpart's action changes (A wants the opposite of whatever B picks, AND vice versa).</test>
    <re-label>If either player's best response stays constant, the desire is asymmetric (one wants alignment, one divergence) → route to stealth (covert action) or zero-sum.</re-label>
    <example>Two drivers approaching a one-lane bridge each hoping the OTHER yields.</example>
  </gate>
  <gate name="principal-agent">
    <fill>"The delegated task is ____."</fill>
    <fill>"The hidden action the principal cannot observe is ____."</fill>
    <warning>Generic fills ("manage the situation", "handle the information") fail.</warning>
    <warning>Cooperative exposition (mentor explaining, expert briefing, friend filling a blank) is NEVER PA — no task delegated, just voluntary disclosure. Route to signaling.</warning>
  </gate>
  <gate name="pure-opposition">
    <fill>"Player A is defending the value of ____."</fill>
    <fill>"Player B is defending the value of ____."</fill>
    <warning>Blanks must name different KINDS of thing with no shared currency. If you can name a single thing both want more of (power, rank, reputation, territory, privacy, being-correct, control, framing, legitimacy) → SYMMETRIC + ZERO-SUM on that axis, NOT incommensurable. Emotional intensity is not a gate; shared currency is.</warning>
  </gate>
</procedural-gates>

<action-axis hint="Both players' actions live on the SAME axis. Pick the axis by asking: what SHIFTS as a result of the decision? That thing is what's being traded.">
  <group name="information">
    <axis name="disclosure">reveal ↔ conceal (what facts are shown or hidden)</axis>
    <axis name="identity">claim ↔ disown (declaring or distancing from WHO ONE IS, as an individual)</axis>
  </group>
  <group name="relational-stance">
    <axis name="trust">extend ↔ guard (individual vulnerability; lowering vs keeping defenses)</axis>
    <axis name="alliance">ally ↔ separate (FACTIONAL / GROUP membership; side-taking, coalition, crossing the floor)</axis>
    <axis name="confrontation">engage ↔ evade (whether to interact at all)</axis>
    <axis name="status">assert ↔ defer (relative RANK and social-order position)</axis>
  </group>
  <group name="force-within-interaction">
    <axis name="pressure">press ↔ yield (intensity of push and give)</axis>
    <axis name="stakes">escalate ↔ deescalate (magnitude of consequence on the table)</axis>
    <axis name="control">bind ↔ release (constraint imposed or lifted)</axis>
  </group>
  <group name="resource-or-obligation">
    <axis name="acquisition">take ↔ give (PHYSICAL TRANSFER of resources, lives, knowledge)</axis>
    <axis name="obligation">incur ↔ discharge (DEBT / FAVOR economy — the owed-ness that survives the transfer; distinct from acquisition)</axis>
  </group>
  <group name="normative">
    <axis name="moral">transgress ↔ uphold (acts against a principle or against another person — when the normative weight is the primary trade)</axis>
  </group>
  <group name="self-or-tempo">
    <axis name="commitment">commit ↔ withdraw / hedge (self-binding vs keeping options open)</axis>
    <axis name="timing">act ↔ wait (move now vs hold and watch)</axis>
  </group>
  <selection-rule>Pick the axis that names what SHIFTS, not the surface topic. If the beat shifts the relationship between the players, the relationship shift is the axis — not the thing they happen to be talking about.</selection-rule>
  <sinks hint="Three axes are sinks the model defaults to without thinking — always run the counter-check before picking them.">
    <sink name="disclosure" hint="Whenever a beat is 'one party tells another something', FIRST ask:">
      <counter>Is it about lowering defenses? → trust.</counter>
      <counter>Does it elevate / diminish rank? → status.</counter>
      <counter>Does it create / discharge a debt? → obligation.</counter>
      <counter>Is the teller binding future action? → commitment.</counter>
      <correct-use>disclosure is correct ONLY when the pure question is reveal-vs-hide with no deeper relational trade (spy revealing identity, witness deciding to testify).</correct-use>
    </sink>
    <sink name="pressure" hint="Before picking it, ask: is the real question 'who outranks whom'? If yes → status, not pressure."/>
    <sink name="acquisition" hint="Before picking it, ask: does a debt or favor SURVIVE the physical transfer? If yes → obligation."/>
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
  <scale value="+4">Strongly advances A's arc-level goals.</scale>
  <scale value="+2">Moderately helpful.</scale>
  <scale value="0">Neutral, no meaningful effect.</scale>
  <scale value="-2">Moderately harmful.</scale>
  <scale value="-4">Catastrophic.</scale>
  <constraint>zero-sum label is reserved for grids that LITERALLY sum to zero across every cell — if any cell leaves both players positive OR both negative, the beat is not zero-sum.</constraint>
  <key>Score as if the cell were the realized outcome. Do not bias toward making the realized cell look maximal. The evaluator's value comes from honest cross-cell comparison — a dominated cell landing as realised is exactly the information downstream analysis wants to surface.</key>
</stake-delta-scoring>

<example title="Recipient (C-01) and Messenger (C-02) delivering a sealed summons in front of the recipient's household">
  <classification-walkthrough>
    <step name="scope">Two strategic agents, no mechanism override. Proceed.</step>
    <step name="mechanism-override">No timing/binding form dominates. Proceed.</step>
    <step name="info-x-pref">
      Q-INFO: ASYMMETRIC (the messenger knows the summons's contents; the recipient does not).
      Q-PREF: preferences are aligned-with-asymmetry — both gain from the household learning, but the messenger controls how revelation happens.
      ASYMMETRIC + informed party reveals through a costly action → signaling.
    </step>
    <step name="axis">The decision is about what gets shown vs. hidden to the household — pure reveal-vs-conceal. → disclosure.</step>
  </classification-walkthrough>
  <output-shape>{
  "beatIndex": 4,
  "beatExcerpt": "The messenger hands the recipient the summons; the recipient reads it in front of the household.",
  "gameType": "signaling",
  "actionAxis": "disclosure",

  "playerAId": "C-01",
  "playerAName": "Recipient",
  "playerAActions": [
    { "name": "reads aloud" },
    { "name": "reads silently" },
    { "name": "refuses to open" }
  ],

  "playerBId": "C-02",
  "playerBName": "Messenger",
  "playerBActions": [
    { "name": "narrates the contents" },
    { "name": "waits silently" }
  ],

  "outcomes": [
    { "aActionName": "reads aloud", "bActionName": "narrates the contents",
      "description": "Recipient's voice and messenger's overlap; household hears every line",
      "stakeDeltaA": 2, "stakeDeltaB": 3 },
    { "aActionName": "reads aloud", "bActionName": "waits silently",
      "description": "Recipient voices the summons themself; household hears it from them directly",
      "stakeDeltaA": 3, "stakeDeltaB": 1 },
    { "aActionName": "reads silently", "bActionName": "narrates the contents",
      "description": "Messenger reveals everything; recipient loses framing control but learns",
      "stakeDeltaA": 1, "stakeDeltaB": 4 },
    { "aActionName": "reads silently", "bActionName": "waits silently",
      "description": "Recipient absorbs alone; household stays in the dark for now",
      "stakeDeltaA": 4, "stakeDeltaB": 0 },
    { "aActionName": "refuses to open", "bActionName": "narrates the contents",
      "description": "Messenger forces the reveal; recipient looks passive but escapes fallout",
      "stakeDeltaA": 0, "stakeDeltaB": 2 },
    { "aActionName": "refuses to open", "bActionName": "waits silently",
      "description": "Stalemate — summons undelivered, household holds the day",
      "stakeDeltaA": -3, "stakeDeltaB": -3 }
  ],

  "realizedAAction": "reads silently",
  "realizedBAction": "narrates the contents",

  "rationale": "The author hands framing to the messenger because the summons's weight needs a witness larger than the recipient alone — making this beat a signaling moment to the household, not a private revelation."
}</output-shape>
</example>

<output-format>
{
  "summary": "one sentence describing the scene's strategic shape",
  "games": [ <one object per game-bearing beat, matching the example above> ]
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
