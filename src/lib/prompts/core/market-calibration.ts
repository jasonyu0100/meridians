/**
 * Shared market calibration — XML blocks injected into user prompts that
 * price or re-price threadDeltas (scene-structure extraction, thread-lifecycle
 * generation, fate-reextract second pass) so every pass speaks the same
 * market vocabulary and applies the same discipline to information flow.
 */

export const PROMPT_MARKET_PRINCIPLES = `<market-discipline hint="Trade like a market maker reacting to news flow. Calibration is the entire P&L — a correctly-priced long-shot beats a correctly-priced favorite. The informed counterparty (the author in fiction / non-fiction; the rule set in simulation) knows which outcome resolves; you price against the flow they expose.">
  <principles>
    <principle index="1" name="price-news-not-noise">Evidence requires a likelihood ratio — the scene must be more likely under the target outcome than under alternatives. If it reads the same way under either, it's volumeDelta, not evidence. First mention prices the move; restatements are already priced in.</principle>

    <principle index="2" name="magnitude-tracks-distinguishability">|e| ≤ 1 if the scene reads consistent with multiple outcomes; |e| ≥ 2 if content only makes sense under the target; |e| ≥ 3 for resolving payoffs/twists. Under-pricing a genuine payoff is as broken as over-pricing routine.</principle>

    <principle index="3" name="realized-not-forecast">Only on-page events are evidence. Narrative sympathy, genre expectation, POV momentum: none count. Standing advantages (foreknowledge, hidden identity) price into the opening prior. When uncertain between readings, pulse — the next scene disambiguates.</principle>

    <principle index="4" name="reprice-from-current-state">Each scene re-prices from the CURRENT probability vector, not from the trajectory's direction. Read the live distribution before emitting; ask "what would a market maker do at THESE probabilities given this scene's events?", not "what's the natural next move along the trend." Constant re-evaluation — every scene is an opportunity to disagree with the current price.</principle>

    <principle index="5" name="saturation-resists-resolution">Saturation (top p ≥ 0.85) is RESISTANCE TO FULL RESOLUTION, not settlement. Real prediction markets at 90% still price the 10% tail; closure requires a CLEAR TRANSITION — a named resolving event in the prose with |e|≥3 and logType payoff/twist — not continued favourable evidence on the leader. Until the transition fires:
      - Tail outcomes remain priceable: |e|=1..2 on a non-leader when the scene's events genuinely touch it (a hedge bet still gets made at 90%).
      - Resistance on the leader (|e|=1..2) is legitimate at any saturation level — the leader can lose ground without the market closing.
      - Small +1..+2 on a saturated LEADER is phantom accumulation; the market already knows.
      - Closure that bypasses an in-world transition reads as authorial assertion, not earned resolution.</principle>

    <principle index="6" name="liabilities-stay-on-the-books">Stated costs exist until paid, waived, or proven inapplicable. Successful action without realized cost is evidence for DEBT-DEFERRED, not NO-COST. Don't saturate "no-cost / undetected / free" while structural debt accumulates.</principle>

    <principle index="7" name="outcomes-name-specific-futures">Outcomes must be unambiguously adjudicable at resolution. Trivially-true labels ("reveals complex connection", "has meaningful effect") describe THAT something happens, not what — they cannot be re-priced and close at low quality.</principle>

    <principle index="8" name="cascades-scale-with-quality">Decisive reveals can reprice coupled threads in the same scene; cascade strength scales with the driving event's quality. Each cascade emission cites its driving sentence. Don't smuggle evidence into threads the scene didn't touch.</principle>

    <principle index="9" name="scope-distance-attenuation">Magnitude attenuates by the thread's HORIZON field:
      <horizon name="short" cap="±3..±4 (full band)">Resolves in 2-3 scenes. No attenuation.</horizon>
      <horizon name="medium" cap="±1..±2 typical, ±3 only on direct contact">Within one arc (~4-8 scenes). Default if undefined.</horizon>
      <horizon name="long" cap="±0.5..±1 typical, ±2 only on structural pivot">Multi-arc.</horizon>
      <horizon name="epic" cap="±0.2..±0.5 typical, ±2 only on world-altering pivot">Series-spanning or open-ended.</horizon>
      Structural pivots that re-shape the resolution path — forbidden technique acquired, fundamental resource lost, benefactor revealed adversarial — move long/epic markets at full magnitude (|e| ≥ 2). Symmetric for setbacks.
    </principle>
  </principles>
</market-discipline>`;

export const PROMPT_PORTFOLIO_PRINCIPLES = `<portfolio-discipline hint="Emission principles keep each market honest; portfolio principles keep the SET from degenerating into decoration. A portfolio of well-priced but all-distal, all-central-agent, all-soft-outcome markets generates an inert trajectory no matter how clean each emission is.">
  <abstractions>Central agent = the work's committed reasoner — the position the prose has bound itself to. Step = unit of progress. Segment = unit of structural commitment.</abstractions>

  <principles>
    <principle id="A" name="contested-outcomes">Every market needs at least one outcome the central agent would pay to prevent. Outcome sets where every option is a variant of the agenda's success are progress bars, not markets.</principle>
    <principle id="B" name="irreversibility">Soft outcomes (drift, recoverable shifts) price as math; hard outcomes (terminal states, broken conditions) price as weight. ~25% of open markets should point at an irreversible outcome.</principle>
    <principle id="C" name="horizon-diversity">Maintain a distribution across short, medium, and long horizons. All-distal portfolios make individual steps feel interchangeable.</principle>
    <principle id="D" name="peripheral-agent-coverage">Named entities the generator has invested in deserve at least one market of their own. Tracking only the central agent is solipsistic.</principle>
    <principle id="E" name="cost-ledger">Systemic counter-pressure enters a dedicated cost-ledger market whose leading outcome is something the central agent is trying to prevent. Otherwise costs fire once and evaporate.</principle>
    <principle id="F" name="no-zombies">Untouched markets (σ≈0, 10+ steps silent) crowd out attention. If a market can't receive genuine evidence in the next step or two, close it, abandon it, or let attrition retire it.</principle>
    <principle id="G" name="surprise-capacity">Plant at least one outcome per segment that opens a genuinely unforeseen future — outside what the opening commitments imply.</principle>
  </principles>

  <multi-market-cascade>Major events — payoffs, twists, system-rule reveals, world-state irreversibilities — cascade across coupled markets in the same step. A death re-prices every market the dead party participated in; a revealed rule re-prices every market it constrains. A major event that moves only its primary market is a calibration failure.</multi-market-cascade>

  <state-change>No market is permanently settled short of resolution. Markets that look settled under the current trajectory must remain re-priceable when legitimate force-of-system or force-of-world evidence lands.</state-change>
</portfolio-discipline>`;

export const PROMPT_MARKET_EVIDENCE_SCALE = `<evidence-scale hint="Real number in [-4, +4] per affected outcome. Decimals encouraged; rounded to 1dp. Apply Principle 9 (scope-distance-attenuation) before picking a band.">
  <band magnitude="±0..1" kind="small">pulse, minor shift, OR meaningful local event scored against a long-horizon market.</band>
  <band magnitude="±1..2" kind="meaningful">setup, resistance.</band>
  <band magnitude="±2..3" kind="significant">escalation, twist.</band>
  <band magnitude="±3..4" kind="decisive">payoff, reversal — uncertainty collapses on the market being scored.</band>
</evidence-scale>`;

export const PROMPT_MARKET_LOGTYPE_TABLE = `<logtype-table hint="logType MUST agree with direction + magnitude. The 9 primitives carry the same meaning in fiction, non-fiction, and simulation — in simulation a 'twist' is typically a rule-driven surprise that contradicts an expected trajectory (containment fails, a reserve commits, a counterfactual closes a pathway), a 'payoff' is a rule-driven closure, a 'setup' plants an initial condition or rule that will later force the outcome.">
  <entry name="setup" evidence="+0..+1">planting, low prior.</entry>
  <entry name="escalation" evidence="+2..+3">stakes rise, direction clear.</entry>
  <entry name="payoff" evidence="+3..+4">outcome locks in (closes to 1).</entry>
  <entry name="twist" evidence="±3 against prior trend">reversal.</entry>
  <entry name="resistance" evidence="−1..−2">genuine setback against rising trend.</entry>
  <entry name="stall" evidence="0">expected movement absent.</entry>
  <entry name="callback" evidence="+1..+2 plus volumeDelta">attention returns.</entry>
  <entry name="pulse" evidence="±0..1">attention maintenance.</entry>
  <entry name="transition" evidence="low |Δp|, high |Δvolume|">phase change.</entry>
</logtype-table>`;
