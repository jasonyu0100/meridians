'use client';
// ProbabilityBar — stacked bar showing the softmax cohort probabilities across planning scenarios.

import { useMemo } from 'react';
import type { PlanningScenario } from '@/types/narrative';
import { scenarioLogit, scenarioProbabilities } from '@/lib/ai/variables';

interface Props {
  scenarios: PlanningScenario[];
  temperature: number;
  onTemperatureChange: (t: number) => void;
  activeScenarioId: string | null;
  onSelectScenario: (id: string) => void;
}

/**
 * Stacked horizontal probability bar across planning scenarios. Sums to
 * 100%; clicking a segment focuses the scenario.
 */
export default function ProbabilityBar({
  scenarios,
  temperature,
  onTemperatureChange,
  activeScenarioId,
  onSelectScenario,
}: Props) {
  const probs = useMemo(() => scenarioProbabilities(scenarios, temperature), [scenarios, temperature]);
  const logits = useMemo(
    () => new Map(scenarios.map((s) => [s.id, scenarioLogit(s)])),
    [scenarios],
  );

  const ordered = useMemo(
    () => [...scenarios].sort((a, b) => (probs[b.id] ?? 0) - (probs[a.id] ?? 0)),
    [scenarios, probs],
  );

  return (
    <div className="rounded-md border border-white/8 bg-white/2 px-3 py-2">
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[9px] uppercase tracking-[0.15em] text-text-dim font-mono">Likelihood</span>
          <span className="text-[10px] text-text-secondary">
            softmax over {scenarios.length} scenarios
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-[0.15em] text-text-dim/60 font-mono">τ {temperature.toFixed(2)}</span>
          <input
            type="range"
            min="0.3"
            max="2.5"
            step="0.05"
            value={temperature}
            onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
            className="w-20 accent-violet-400"
            title="Softmax temperature (lower = sharper, higher = flatter)"
          />
        </div>
      </div>

      <div className="flex w-full h-6 rounded overflow-hidden ring-1 ring-white/8">
        {ordered.map((s) => {
          const p = probs[s.id] ?? 0;
          if (p < 0.001) return null;
          const isActive = s.id === activeScenarioId;
          return (
            <button
              key={s.id}
              onClick={() => onSelectScenario(s.id)}
              className="relative h-full group transition-all"
              style={{
                width: `${p * 100}%`,
                background: s.color,
                opacity: isActive ? 1 : 0.7,
                outline: isActive ? `1.5px solid ${s.color}` : undefined,
                outlineOffset: '-1.5px',
              }}
              title={`${s.name} · ${Math.round(p * 100)}% · logit ${(logits.get(s.id) ?? 0).toFixed(2)}`}
            >
              {p > 0.1 && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono tabular-nums text-bg-base font-semibold">
                  {Math.round(p * 100)}%
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
