'use client';

import { categoryColor } from '@/lib/ai/variables';
import type { PlanningScenario } from '@/types/narrative';

interface Props {
  scenario: PlanningScenario;
  probability: number;
  rank: number;
  active: boolean;
  onClick: () => void;
}

/**
 * One card for one scenario in the cohort. Each scenario carries its OWN
 * custom variable set, so the disposition strip and counts come from
 * `scenario.variables` directly — there's no shared catalogue to compare
 * against.
 */
export default function ScenarioCard({ scenario, probability, rank, active, onClick }: Props) {
  const total = scenario.variables.length;
  const activeCount = scenario.variables.filter((v) => v.intensity > 0).length;

  return (
    <button
      onClick={onClick}
      className={`group text-left rounded-md border px-3 py-2.5 transition w-full ${
        active ? 'border-white/30 bg-white/6' : 'border-white/8 bg-white/2 hover:border-white/15 hover:bg-white/4'
      }`}
      style={active ? { boxShadow: `0 0 0 1px ${scenario.color}55, 0 0 24px -8px ${scenario.color}aa` } : undefined}
    >
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <div className="flex items-baseline gap-1.5 flex-wrap min-w-0">
          <span className="text-[9px] text-text-dim/50 font-mono tabular-nums shrink-0">#{rank}</span>
          <span className="w-2 h-2 rounded-full shrink-0 translate-y-px" style={{ background: scenario.color }} />
          <span className="text-[11px] text-text-primary font-medium leading-snug">{scenario.name}</span>
        </div>
        <span
          className="text-base font-mono tabular-nums shrink-0"
          style={{ color: scenario.color }}
          title={scenario.priorRationale ?? undefined}
        >
          {Math.round(probability * 100)}%
        </span>
      </div>
      {scenario.tagline && (
        <div className="text-[10px] text-text-dim leading-snug">{scenario.tagline}</div>
      )}
      {typeof scenario.priorLogit === 'number' && (
        <div className="text-[9px] text-text-dim/60 font-mono tabular-nums mt-0.5">
          L {scenario.priorLogit.toFixed(1)}
        </div>
      )}
      {/* Disposition strip — each segment is one of this scenario's own
          variables, coloured by category, opacity by intensity. */}
      <div className="mt-1.5 flex items-center gap-0.5">
        {scenario.variables.map((v) => {
          const cColor = categoryColor(v.category);
          const opacity = 0.4 + (v.intensity / 4) * 0.6;
          return (
            <span
              key={v.id}
              className="block flex-1 h-1.5 rounded-sm"
              style={{ background: cColor, opacity }}
              title={`${v.name} (${v.category}): intensity ${v.intensity}`}
            />
          );
        })}
      </div>
      <div className="mt-1 text-[9px] text-text-dim/70 font-mono tabular-nums">
        {activeCount}/{total} vars
      </div>
    </button>
  );
}
