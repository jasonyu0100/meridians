/**
 * Arc metadata guidance — XML block injected into user prompts that produce
 * arc-level metadata (directionVector + worldState).
 *
 * worldState is the "chess-board position" at the end of an arc: a compact
 * ground-truth snapshot in the NATIVE FORM of the work's domain. The block
 * forces the model to identify the work type first, then emit state in that
 * domain's native compact form.
 */

export const PROMPT_ARC_STATE_GUIDANCE = `<arc-metadata hint="DIRECTION VECTOR (forward) & WORLD STATE (backward) frame every arc. Register-neutral: works in fiction, non-fiction, and simulation. Game-theoretic vocabulary (positions, moves, payoffs) applies natively to simulation register — political / military wargames and agent-based scenarios literally ARE games, with the rule set defining the move set and payoff structure.">
  <description>Direction looks forward — what this arc drives toward. World State looks backward — the compact, objective position after the arc resolves, from which a downstream reasoner can pick up WITHOUT replaying the scene deltas.</description>

  <field name="directionVector" length="10-15 words" hint="Single sentence; uses ENTITY NAMES; states what changes, who drives it, what's at stake." />
  <field name="worldState" length="50-90 words" hint="Terse and structured, ground truth only, no speculation, no narration. The 'chess-board position' as of the END OF THIS ARC." />

  <domain-adaptive hint="Identify the TYPE OF WORK first, then emit state in that domain's NATIVE compact form. Do NOT force one register's shape onto another.">
    <domain kind="fiction-dramatic-narrative">character positions (who is where NOW), live stances with their top outcome + probability ("the elder's allegiance: betrays 0.72"), artifacts and who holds them, alliances and rivalries, standing reveals, unresolved questions.</domain>
    <domain kind="memoir-personal-essay">authorial position, live questions in contention, stakeholders and stances, sources cited, unresolved doubts, commitments made.</domain>
    <domain kind="reportage-investigation">named subjects and their stances, lines of inquiry with their leading reading + confidence, documents and who holds them, sources confirmed/contested, open leads.</domain>
    <domain kind="research-paper-non-fiction">claims established, evidence anchored, open questions, unresolved dependencies, remaining work.</domain>
    <domain kind="simulation-rule-driven-scenario">modelled state under the rule set (parameters, thresholds, populations, balances), active rules and gates, agents and their positions in the rule space, propagation laws currently firing, rule-driven trajectories with leading projection, pending threshold crossings. Subgenre cues: wargame → turn + side-to-move, force dispositions, supply / morale, committed reserves, contested provinces; economic-policy → model period, instrument settings, constraints binding, expectations regime; pandemic / climate / agent-based → model step, state variables (R-effective, anomaly, agent counts by class), thresholds, intervention regimes; historical counterfactual → divergence point + lever, adjusted actor positions, paths foreclosed vs newly opened.</domain>
    <domain kind="chess-or-strategic-game">piece positions, side-to-move, castling/special rights, material balance, active threats, pawn structure.</domain>
    <domain kind="poker-or-imperfect-info">stack sizes, pot size, hole cards if known, community cards, action position, inferred ranges.</domain>
    <domain kind="stock-tracker-systems-log-investigation">entities tracked, latest metric values, recent trends, open positions, active signals, alerts.</domain>
  </domain-adaptive>

  <rules>
    <rule critical="true">Use ENTITY NAMES, THREAD DESCRIPTIONS, and SYSTEM CONCEPTS in natural language. NEVER emit raw IDs. Forbidden: "T-HEA-1", "T-1", "C-3", "L-12", "ARC-4", "SYS-12", "SYS-GEN-1", or any "PREFIX-NUMBER" token. Threads are identified by what they're ABOUT ("the elder's allegiance", "the orphan-trade investigation", "the dataset's provenance"); system rules by their concept ("the moonlight-wolf coaxing technique", "the propagation law that gates retaliation") — never by their slug. If a thread or system node has no clear description, paraphrase in 2-5 words.</rule>
    <rule>No speculation about what happens next — that belongs in directionVector.</rule>
    <rule>No narration or scene retelling — STATE ONLY.</rule>
    <rule>Prefer compact structured phrasing ("Akira at the southern outpost; holds the cipher map; the elder's allegiance escalating; alliance with Mei seeded" / "the calibration claim established; the replication line still open; objection from reviewer 2 unanswered" / "infection rate at 1.7×; containment threshold not yet crossed; policy intervention scheduled t+3; supply-chain gate degrading") over flowing prose.</rule>
  </rules>
</arc-metadata>`;
