'use client';
// MetricStrip — horizontal row of labelled metric values for the variables/scenario surface.

interface Metric {
  label: string;
  value: string | number;
  /** Optional accent — used for headline colour. */
  tone?: 'default' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky';
  /** Optional small change indicator next to the value. */
  delta?: { value: string; positive: boolean };
}

interface Props {
  metrics: Metric[];
  /** Right-aligned tail text — e.g. "scene 35 of 35 · realised". */
  tail?: string;
}

/**
 * Dashboard-style top metric strip — separated columns of `value` / `label`
 * with minimal chrome. Keeps Variables visually consistent with the rest of
 * the canvas surfaces.
 */
export default function MetricStrip({ metrics, tail }: Props) {
  return (
    <div className="flex items-baseline gap-6 px-6 py-3 border-b border-white/4">
      {metrics.map((m, i) => (
        <div key={i} className="flex items-baseline">
          {i > 0 && <div className="w-px h-7 bg-white/8 mr-6" />}
          <div className="flex flex-col gap-0.5">
            <div className={`text-xl font-light tabular-nums leading-none ${toneClass(m.tone)}`}>
              {m.value}
              {m.delta && (
                <span className={`ml-1.5 text-[10px] font-mono ${m.delta.positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {m.delta.positive ? '▲' : '▼'} {m.delta.value}
                </span>
              )}
            </div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">{m.label}</div>
          </div>
        </div>
      ))}
      {tail && (
        <div className="ml-auto text-[10px] text-text-dim font-mono uppercase tracking-[0.15em]">
          {tail}
        </div>
      )}
    </div>
  );
}

function toneClass(tone: Metric['tone']): string {
  switch (tone) {
    case 'violet': return 'text-violet-200';
    case 'emerald': return 'text-emerald-300';
    case 'amber': return 'text-amber-200';
    case 'rose': return 'text-rose-300';
    case 'sky': return 'text-sky-300';
    default: return 'text-text-primary';
  }
}
