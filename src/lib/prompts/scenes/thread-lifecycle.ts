/**
 * Thread Stance / Belief Prompts and Helper Functions
 *
 * CONCEPTUAL MODEL: each thread is a QUESTION the world view is open on.
 * Its STANCE is the current bearing across its named outcomes — a softmax
 * over per-outcome logits, weighted by volume. Each scene's events emit
 * evidence that shifts the stance; the world view's BELIEF is the
 * aggregation of every open stance, and fate falls out of information
 * gain across the scene trajectory.
 *
 * The LLM never emits probabilities directly — it emits integer evidence
 * in [-4, +4] (same grammar as game-theory stake deltas) plus a log-type
 * from the 9 primitives. The math handles log-odds conversion, saturation,
 * closure, and abandonment.
 */

import type { NarrativeState, Thread } from '@/types/narrative';
import { NARRATOR_AGENT_ID } from '@/types/narrative';
import { THREAD_LIFECYCLE_DOC } from '@/lib/ai/context';
import {
  STANCE_NEAR_CLOSED_MIN,
  STANCE_TAU_CLOSE,
} from '@/lib/constants';
import {
  getStanceMargin,
  getStanceProbs,
  isNearClosed,
  isThreadAbandoned,
  isThreadClosed,
  scenesSinceTouched,
} from '@/lib/narrative-utils';
import { classifyThreadCategory, THREAD_CATEGORY_GUIDANCE, type ThreadCategory } from '@/lib/thread-category';
import {
  PROMPT_STANCE_PRINCIPLES,
  PROMPT_BELIEF_PRINCIPLES,
  PROMPT_STANCE_EVIDENCE_SCALE,
  PROMPT_STANCE_LOGTYPE_TABLE,
} from '../core/belief-calibration';

/**
 * Generate thread-stance lifecycle documentation prompt. Carries the
 * stance / belief vocabulary every downstream pass should speak.
 */
export function promptThreadLifecycle(): string {
  return `
<thread-lifecycle>${THREAD_LIFECYCLE_DOC}</thread-lifecycle>

${PROMPT_STANCE_PRINCIPLES}

${PROMPT_BELIEF_PRINCIPLES}

${PROMPT_STANCE_EVIDENCE_SCALE}

${PROMPT_STANCE_LOGTYPE_TABLE}

<evidence-vs-volume>
  Evidence changes WHAT we believe; volumeDelta changes ATTENTION. Mentioned-but-stable → evidence=0, volumeDelta=+1. One event can move multiple threads; each rationale cites its driving sentence.
</evidence-vs-volume>

<attrition>
  Volume decays geometrically (α=0.9) on untouched scenes; 5+ scenes of silence drops a thread below the abandonment floor. Pulse spine threads to keep them breathing; let trivial threads decay.
</attrition>

<opening-priors scope="new threads only">
  priorProbs: number[] aligned with outcomes[], summing to ~1, reasoned from the world's established base rates NOT from genre or rhetorical expectation. The prior reflects what a clear-eyed observer inside this world would price the outcomes at given everything established so far. Binary defaults [0.5, 0.5] only when genuinely symmetric. Omit when indistinguishable; the system clamps to the opening guardrail.
</opening-priors>

<closure-and-abandonment>
  Auto-close: margin(top − second) ≥ τ_effective AND logType ∈ {payoff, twist} AND |e| ≥ 3. τ_effective = ${STANCE_TAU_CLOSE} × (1 + ln(volume/opening)/3) — high-volume stances need proportionally more decisive finishes. Abandon: volume below floor → out of belief. Reopen via volumeDelta ≥ 2.
</closure-and-abandonment>

<stance-state-actions hint="How the stance's current distribution shapes the next scene.">
  <state condition="high-p (p ≳ 0.75)">Lean into the leader unless logType is twist.</state>
  <state condition="contested (entropy ≳ 0.9)">Crossroads — either side fair game.</state>
  <state condition="high-volatility (≳ 0.5)">Twists are earned; readers expect them.</state>
  <state condition="low-volatility-high-p">Saturating; next committal logType closes.</state>
  <state condition="low-volume-long-silence">Decaying; don't force evidence unless resurrecting.</state>
</stance-state-actions>

<emission-budget>Touch 2–6 threads per scene; focus-window threads first. Emit evidence ONLY where the scene actually moves or maintains attention.</emission-budget>
`;
}

/**
 * Surface the active-thread portfolio so the model can target action by
 * category without re-emitting per-thread state (already in narrative-context).
 *
 * The block has three parts:
 *   1. <belief-portfolio> — buckets active threads by category, IDs only.
 *      The model reads each thread's stance state (lean/p/margin/vol/
 *      volatility/log) from the <threads> block in narrative-context.
 *   2. <thread-action-guide> — what to DO for each category, sourced from
 *      THREAD_CATEGORY_GUIDANCE (single source of truth).
 *   3. <engagement-and-realism> — per-arc minimums and failure-mode catalogue.
 *      Fate scores reward information gain × attention, so a portfolio that
 *      only escalates leaders generates near-zero fate. This directive
 *      explicitly demands twists / resistance / payoffs across the arc.
 */
export function buildThreadHealthPrompt(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const allThreads = Object.values(narrative.threads);
  if (allThreads.length === 0) return '';

  const closed = allThreads.filter(isThreadClosed).length;
  const abandoned = allThreads.filter(isThreadAbandoned).length;
  const activeThreads = allThreads.filter((t) => !isThreadClosed(t) && !isThreadAbandoned(t));
  const totalArcs = Object.keys(narrative.arcs).length || 1;

  // Bucket active threads by category. IDs only — full state lives on the
  // narrative-context <thread> tags.
  const buckets = new Map<ThreadCategory, string[]>();
  for (const t of activeThreads) {
    const silent = scenesSinceTouched(t, resolvedKeys, currentIndex);
    const category = classifyThreadCategory(t, { scenesSinceTouch: silent });
    const list = buckets.get(category) ?? [];
    list.push(t.id);
    buckets.set(category, list);
  }
  const bucketLines = Object.keys(THREAD_CATEGORY_GUIDANCE)
    .filter((cat) => buckets.has(cat as ThreadCategory))
    .map((cat) => `  <bucket category="${cat}" threads="${buckets.get(cat as ThreadCategory)!.join(', ')}" />`)
    .join('\n');

  const actions = Object.entries(THREAD_CATEGORY_GUIDANCE)
    .map(([cat, guidance]) => `  <action category="${cat}">${guidance}</action>`)
    .join('\n');

  return `<belief-portfolio active="${activeThreads.length}" closed="${closed}" abandoned="${abandoned}" arcs="${totalArcs}" hint="Active threads grouped by category — the live shape of the world view's belief. Each thread's full stance state (lean, p-lean, margin, vol, volatility, energy, silent, log) lives on its <thread> tag in narrative-context; this block surfaces grouping only.">
${bucketLines}
</belief-portfolio>

<thread-action-guide hint="What each category demands of the next scene. {lean} = the thread's lean attribute; {p} = its p-lean attribute. Apply per-thread by reading the category attribute from narrative-context.">
${actions}
</thread-action-guide>

<engagement-and-realism hint="Fate = information gain × attention. Motion is sustained, not spectacular. Compound minute evidence scene by scene; large reversals land only when earned. Stances stay in FLUX and drive toward MEANINGFUL CONCLUSIONS — the belief breathes.">
  <per-arc-minimums hint="Across the scenes this prompt is generating, not within a single scene.">
    <minimum>≥1 scene carries a payoff (|e|≥3, logType=payoff) OR twist (against prior trend) on a high-volume stance — only when prior scenes seeded the pressure. Unseeded twists read as authorial intervention.</minimum>
    <minimum>≥1 scene carries resistance (logType=resistance, e=−1..−2) on a rising committed stance — the leading agent meets cost they did not choose. All-leaders-winning is a progress bar.</minimum>
    <minimum>Saturating stances — pick one, do not default to closure:
      (a) PAYOFF: |e|≥3 on leader with margin clearance — locks resolution, stance exits.
      (b) TWIST-closes: |e|≥3 against prior trend on non-leader — reverses the committed direction.
      (c) TWIST-reopens: |e|=2..3 on non-leader without closing — drops leader below saturation, restores contestation. Often the highest-leverage move.
      RESISTANCE (|e|=1..2 on leader) keeps the stance live without committing.
      3+ scenes of silence is belief decay.</minimum>
    <minimum>Dormant stances either re-engage (volumeDelta ≥ +2 with new evidence) or accept attrition. Don't pulse them just to keep them on the board.</minimum>
  </per-arc-minimums>
  <register-grounding hint="The MECHANISM of reversal differs by register; the requirement that stances actually reverse does not.">
    <register kind="fiction-or-non-fiction">Reversals come from the central agent meeting adversaries, evidence, institutional friction, or reality they did not control. Costs hit the central agent on-page; rivals act on their own agenda; investigations turn up what the inquirer didn't expect. Authorial sympathy does NOT price as evidence — only realised on-page events do.</register>
    <register kind="simulation">Reversals come from the rule set firing in non-obvious ways — a threshold crossed, a feedback loop tripping, a propagation law cascading, a counterfactual closing a previously-open path. The "twist" is the model producing a state the optimistic projection didn't predict; the "resistance" is a rule pushing back on a trajectory the agent was banking on. The author does not author surprises — the rules do.</register>
  </register-grounding>
  <failure-modes hint="Each generates technically-clean emissions and zero fate. Audit before emission.">
    <mode name="progress-bar-belief">Every outcome in every stance is a variant of agent-success. Symptom: no outcome the central agent would pay to prevent. Fix: ensure each high-volume stance has a contested outcome with adversarial weight.</mode>
    <mode name="all-leaders-winning">Every committed stance is moving toward its leader, scene after scene. Symptom: no resistance / twist logTypes in the arc. Fix: pick at least one committed stance and force a setback, a complication, or a reveal that reframes the question.</mode>
    <mode name="no-cost-ledger">Liabilities are mentioned in prose (debts, injuries, suspicions, structural pressure) but never priced into a stance whose lean is the thing the agent is trying to prevent. Symptom: costs evaporate scene-to-scene. Fix: open or maintain a cost-ledger stance and emit evidence on it whenever the cost compounds.</mode>
    <mode name="phantom-accumulation">Repeatedly emitting +1..+2 evidence on an already-saturated leader. Symptom: the stance is already priced; the next emission can't move it. Fix: switch to payoff (closes), twist (reverses), or pulse — never phantom-pile a saturated stance.</mode>
    <mode name="rhetorical-evidence">Pricing on what the prose ASSERTS rather than what an outside observer would infer. Symptom: |e|≥2 on scenes whose content reads consistent with multiple outcomes. Fix: |e| ≤ 1 unless the scene only makes sense under the target outcome.</mode>
    <mode name="frictionless-trajectory">No black swans, contingent events, or third-party agendas across the arc. Symptom: every consequence follows cleanly from the focal agent's plan. Fix: surface ≥1 contingent event the agent didn't model — third-party action, rule firing in a corner case, institutional or environmental accident, unforeseen consequence of an earlier delta.</mode>
  </failure-modes>
</engagement-and-realism>

<world-quirks hint="Long-form realism comes from the source's own texture, not imported habits.">
  <principle name="source-specific-texture">Surface the world's own quirks — naming, ritual, weather, bureaucracy, professional tics, institutional frictions, rumour networks. Do not import texture from a different world.</principle>
  <principle name="black-swans">Plant ~1 contingent event per arc — unforeseen visitor, mistimed memo, rule firing in a corner case, third party acting privately. Must respect the world's stated rules; surprise that breaks the work's own logic is authorial cheating.</principle>
  <principle name="third-party-agendas">Named non-focal entities occasionally act on their own goals, not as backdrop — a rival's separate angle, an ally's independent call, an institution following its own procedure.</principle>
</world-quirks>`;
}

/**
 * Extract irreversible closure events from scene history and format them as a
 * "SPENT" prompt section. Closed threads must not be restaged; saturating
 * threads are flagged so the LLM knows they're ready to close (and must not
 * be kept open via weak escalations).
 */
export function buildCompletedBeatsPrompt(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const allThreads = Object.values(narrative.threads);
  const closed = allThreads.filter(isThreadClosed);
  const saturating = allThreads.filter((t) => !isThreadClosed(t) && isNearClosed(t));

  if (closed.length === 0 && saturating.length === 0) return '';

  const lines: string[] = [
    'CLOSED + SATURATING STANCES — these commitments are CASHED IN or READY TO CASH IN.',
    'Closed threads do NOT reopen via weak evidence. Saturating stances need payoff/twist, not another escalation.',
    '',
  ];

  for (const t of closed) {
    const winner = t.outcomes[t.closeOutcome ?? 0] ?? '(unknown)';
    lines.push(`[CLOSED: ${winner}] "${t.description.slice(0, 80)}" [${t.id}]`);
  }

  for (const t of saturating) {
    const { topIdx, margin } = getStanceMargin(t);
    const winner = t.outcomes[topIdx] ?? '?';
    const silent = scenesSinceTouched(t, resolvedKeys, currentIndex);
    const marginNote = margin >= STANCE_NEAR_CLOSED_MIN ? ` (margin=${margin.toFixed(2)} logit-units)` : '';
    lines.push(`[SATURATING → ${winner}] "${t.description.slice(0, 80)}" [${t.id}]${marginNote} silent=${silent === Infinity ? '∞' : silent}`);
  }

  return lines.join('\n');
}

/** Short-form stance rendering for a single thread — used in focus window
 *  blocks where we want a compact per-thread readout. */
export function renderThreadStanceLine(t: Thread): string {
  const stance = t.stances?.[NARRATOR_AGENT_ID];
  const probs = getStanceProbs(t);
  const vol = stance?.volume ?? 0;
  const top = probs.indexOf(Math.max(...probs));
  if (t.outcomes.length === 2 && t.outcomes[0] === 'yes' && t.outcomes[1] === 'no') {
    const p = probs[0] ?? 0;
    return `[${t.id}] "${t.description}" p(yes)=${p.toFixed(2)} vol=${vol.toFixed(1)}`;
  }
  const outList = t.outcomes.map((o, i) => `${o}=${(probs[i] ?? 0).toFixed(2)}`).join(' · ');
  return `[${t.id}] "${t.description}" { ${outList} } top=${t.outcomes[top]} vol=${vol.toFixed(1)}`;
}
