/**
 * Fate Re-Extraction Prompt
 *
 * Phase 5 (finalization) — second-pass, summary-based re-scoring of prediction-
 * market evidence. The first pass (Phase 1 Structure) extracts threadDeltas
 * from each scene IN PARALLEL, so each chunk sees only its local prose and has
 * no knowledge of which outcome actually wins the stance across the full narrative.
 *
 * Symptom: once the stance diverges late-arc, probabilities never reverse —
 * the monotonic local accumulation has no way of knowing a twist or payoff is
 * about to land. Scenes that seeded the eventual winner were priced as pulses
 * because, locally, nothing appeared decisive.
 *
 * Fix: after reconciliation (canonical threads + coalesced outcomes), re-run
 * per-scene extraction using scene SUMMARIES (fast, cheap) together with the
 * full canonical market and its observed resolutions. The LLM re-emits this
 * scene's threadDeltas with lifecycle awareness — honest seeds for the
 * winning outcome, deflated misdirection, decisive evidence at resolution.
 * Register-neutral: the "winning outcome" is the resolution the narrative
 * lands on, regardless of register — dramatic resolution in fiction, finding
 * or breakthrough in non-fiction, rule-forced state arrival in simulation.
 */

import {
  PROMPT_STANCE_PRINCIPLES,
  PROMPT_STANCE_EVIDENCE_SCALE,
  PROMPT_STANCE_LOGTYPE_TABLE,
} from '../core/belief-calibration';

export const FATE_REEXTRACT_SYSTEM = `You re-score stance evidence for ONE scene with full knowledge of the narrative's actual arc — including which outcome each thread ultimately resolves to. The first pass scored each scene locally (blind to endings); your job is to refresh that scene's threadDeltas so the overall trajectory reflects the narrative's true shape. Return only valid JSON.`;

export type FateReextractThread = {
  description: string;
  outcomes: string[];
  /** Structural distance to resolution — drives Principle 9 attenuation.
   *  short / medium / long / epic. Undefined defaults to medium downstream. */
  horizon?: 'short' | 'medium' | 'long' | 'epic';
  /** Outcome with the largest net summed evidence across the full corpus.
   *  Treat as the observed winner — the resolution the narrative lands on. */
  observedWinner: string;
  /** Approximate scene index where the winning outcome's largest committal
   *  evidence fired (a payoff or twist). Useful for detecting whether the
   *  current scene is the resolution itself, pre-resolution, or aftermath. */
  resolutionSceneIndex?: number;
  /** Total volume the thread accumulated across the corpus — surfaces how
   *  much attention the narrative paid to it. High-volume threads deserve
   *  proportionally more decisive resolution evidence. */
  totalVolume?: number;
};

export type FateReextractPriorDelta = {
  threadDescription: string;
  logType: string;
  updates: { outcome: string; evidence: number }[];
  volumeDelta?: number;
  addOutcomes?: string[];
  rationale: string;
};

export function buildFateReextractPrompt(opts: {
  sceneIndex: number;
  totalScenes: number;
  sceneSummary: string;
  povName?: string;
  locationName?: string;
  canonicalThreads: FateReextractThread[];
  priorDeltas: FateReextractPriorDelta[];
}): string {
  const {
    sceneIndex,
    totalScenes,
    sceneSummary,
    povName,
    locationName,
    canonicalThreads,
    priorDeltas,
  } = opts;

  const position = (() => {
    const frac = totalScenes > 0 ? sceneIndex / Math.max(1, totalScenes - 1) : 0;
    if (frac <= 0.15) return 'opening';
    if (frac <= 0.40) return 'rising';
    if (frac <= 0.60) return 'midpoint';
    if (frac <= 0.85) return 'escalation';
    return 'resolution';
  })();

  const stanceBlock = canonicalThreads.length === 0
    ? '(no canonical threads)'
    : canonicalThreads.map((t, i) => {
        const outcomesFmt = t.outcomes.map((o) => o === t.observedWinner ? `${o} [WINNER]` : o).join(', ');
        const resolveAt = typeof t.resolutionSceneIndex === 'number'
          ? ` — resolution fires around scene ${t.resolutionSceneIndex + 1}`
          : '';
        const volNote = typeof t.totalVolume === 'number' ? ` (total vol=${t.totalVolume.toFixed(1)})` : '';
        const horizonNote = ` [horizon: ${t.horizon ?? 'medium'}]`;
        return `THREAD ${i + 1}: "${t.description}"${horizonNote}
  outcomes: [${outcomesFmt}]${volNote}${resolveAt}`;
      }).join('\n\n');

  const priorBlock = priorDeltas.length === 0
    ? '(first pass emitted no threadDeltas for this scene)'
    : priorDeltas.map((d) => {
        const updFmt = (d.updates ?? []).map((u) => `${u.outcome}:${u.evidence >= 0 ? '+' : ''}${u.evidence}`).join(', ');
        return `- "${d.threadDescription}" [${d.logType}] { ${updFmt} } vol=${d.volumeDelta ?? 0}
    rationale: ${d.rationale}`;
      }).join('\n');

  return `<inputs>
  <scene-context position="${position}" index="${sceneIndex + 1}" total="${totalScenes}"${povName ? ` pov="${povName}"` : ''}${locationName ? ` location="${locationName}"` : ''}>
    <summary>${sceneSummary}</summary>
  </scene-context>

  <canonical-stances hint="Full-narrative view — the resolutions the corpus actually lands on.">
${stanceBlock}
  </canonical-stances>

  <first-pass-evidence hint="Local-only extraction; may be mispriced because each scene was scored blind to endings.">
${priorBlock}
  </first-pass-evidence>

  <stance-principles>
${PROMPT_STANCE_PRINCIPLES}
  </stance-principles>

  <evidence-scale>
${PROMPT_STANCE_EVIDENCE_SCALE}
  </evidence-scale>

  <logtype-table>
${PROMPT_STANCE_LOGTYPE_TABLE}
  </logtype-table>
</inputs>

<instructions>
  <task>Re-emit threadDeltas for THIS SCENE using lifecycle awareness. The first pass didn't know which outcome would win each thread; you do.</task>

  <hindsight-rules hint="This pass, not the first.">
    <rule index="1" name="seeds-toward-winner">Scenes that set up, enable, or plant the eventual winning outcome deserve honest positive evidence — not pulses because "nothing decisive happened locally." A quiet setup scene that genuinely leans toward the winner should emit setup (+1) or small escalation (+1..+2), not evidence=0. Under-priced seeds are the main reason the first pass never reverses late. For rule-driven threads, "seeds" are the conditions, accumulating pressures, or earlier rule applications the rule set will eventually use to force the resolution; price them honestly when present.</rule>
    <rule index="2" name="misdirection-deflation">Scenes that locally LOOKED like they advanced a non-winning outcome should be priced conservatively in hindsight. Pulse or very small evidence; do NOT reward POV momentum that the arc contradicts.</rule>
    <rule index="3" name="resolution-scenes">If THIS scene is at or near the thread's resolution index, the resolving events deserve decisive evidence (|e| ≥ 3, logType payoff or twist). The first pass often under-prices these because the resolving event is structurally small but narratively decisive. For rule-driven threads the resolving event is the rule set forcing a state — a threshold breached, a gate triggered, an equilibrium reached; price it as the payoff it is.</rule>
    <rule index="4" name="twists-against-leaders">If the scene reverses what earlier evidence suggested, score it as a twist (|e| ≥ 3 on the newly-favoured outcome). Don't soften to preserve the local lead.</rule>
    <rule index="5" name="preserve-valid">If the first-pass delta was already lifecycle-consistent, keep it. Only rewrite where hindsight changes the read.</rule>
    <rule index="6" name="canonical-outcomes">Every update.outcome must match an entry from canonical-stances verbatim.</rule>
    <rule index="7" name="omit-untouched">If a scene doesn't meaningfully touch a thread, OMIT it — don't pad pulses.</rule>
  </hindsight-rules>
</instructions>

<output-format>
Return JSON with this exact shape — and ONLY this object. Do not touch worldDeltas, systemDeltas, entities, relationships, movements, or any other field; only threadDeltas are re-extracted here.

{
  "threadDeltas": [
    {
      "threadDescription": "exact canonical description from canonical-stances",
      "logType": "pulse|setup|escalation|payoff|twist|resistance|stall|callback|transition",
      "updates": [{"outcome": "exact canonical outcome", "evidence": 1.5}],
      "volumeDelta": 1,
      "addOutcomes": ["optional — new outcome names if the scene structurally opens a possibility that's not in the stance"],
      "rationale": "15-25 words grounded in the scene summary — the specific event that moved this thread"
    }
  ]
}
</output-format>`;
}
