'use client';

/**
 * Shared chrome elements that align Variables with the Dashboard (Market)
 * visual rhythm — uppercase section labels, stat cards with sparklines.
 */

interface SectionHeaderProps {
  label: string;
  count?: number | string;
  children?: React.ReactNode;
}

export function SectionHeader({ label, count, children }: SectionHeaderProps) {
  return (
    <div className="flex items-baseline gap-3 px-6 pt-6 pb-2">
      <span className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono">{label}</span>
      {count !== undefined && (
        <span className="text-[10px] text-text-dim/60 font-mono tabular-nums">{count}</span>
      )}
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}

interface StatCardProps {
  label: string;
  /** Big headline value (e.g. "34" or "0.45"). */
  value: string | number;
  /** Optional small prefix (e.g. "Δ" or "σ"). */
  prefix?: string;
  /** Delta badge (top-right). */
  delta?: { value: string; positive: boolean };
  tone?: 'default' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky';
  /** Subtitle / footer line (e.g. "12/18 vars"). */
  footer?: string;
  /** Optional sparkline polyline data — numbers in [0,1]. */
  spark?: number[];
  /** Spark colour override. */
  sparkColor?: string;
}

const TONE_TEXT: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-text-primary',
  violet: 'text-violet-200',
  emerald: 'text-emerald-300',
  amber: 'text-amber-200',
  rose: 'text-rose-300',
  sky: 'text-sky-300',
};

const TONE_BG: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'rgba(232, 232, 232, 0.18)',
  violet: 'rgba(167, 139, 250, 0.18)',
  emerald: 'rgba(52, 211, 153, 0.18)',
  amber: 'rgba(251, 191, 36, 0.18)',
  rose: 'rgba(251, 113, 133, 0.18)',
  sky: 'rgba(56, 189, 248, 0.18)',
};

export function StatCard({ label, value, prefix, delta, tone = 'default', footer, spark, sparkColor }: StatCardProps) {
  const stroke = sparkColor ?? TONE_BG[tone].replace(/0\.18\)$/, '0.85)');
  return (
    <div className="rounded-md border border-white/6 bg-white/2 px-4 py-3 relative overflow-hidden">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono">{label}</span>
        {delta && (
          <span className={`text-[10px] font-mono tabular-nums ${delta.positive ? 'text-emerald-300' : 'text-rose-300'}`}>
            {delta.positive ? '▲' : '▼'} {delta.value}
          </span>
        )}
      </div>
      <div className={`text-2xl font-light tabular-nums leading-none ${TONE_TEXT[tone]}`}>
        {prefix && <span className="text-text-dim/70 text-base mr-1">{prefix}</span>}
        {value}
      </div>
      {footer && (
        <div className="mt-1.5 text-[10px] text-text-dim font-mono">{footer}</div>
      )}
      {spark && spark.length > 1 && <Sparkline data={spark} color={stroke} />}
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 200;
  const H = 36;
  const padX = 0;
  const padY = 4;
  const max = Math.max(...data, 0.0001);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const xs = data.map((_, i) => padX + (W - padX * 2) * (data.length === 1 ? 0.5 : i / (data.length - 1)));
  const ys = data.map((v) => H - padY - ((v - min) / range) * (H - padY * 2));
  const linePath = data.map((_, i) => (i === 0 ? 'M' : 'L') + xs[i].toFixed(1) + ' ' + ys[i].toFixed(1)).join(' ');
  const areaPath = linePath + ` L ${xs[xs.length - 1].toFixed(1)} ${H} L ${xs[0].toFixed(1)} ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block w-full h-9" preserveAspectRatio="none">
      <path d={areaPath} fill={color} opacity={0.18} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
