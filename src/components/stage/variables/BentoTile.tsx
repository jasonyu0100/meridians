'use client';
// BentoTile — layout primitive: a bento-grid tile with optional sticky header for the variables surface.

interface Props {
  /** Optional header content (title + actions). Stays sticky at the top of
   *  the tile so long content can scroll under it. */
  header?: React.ReactNode;
  /** Accent — coloured side stripe + tinted border. */
  accent?: string;
  /** Solid background for the header strip. */
  headerBg?: string;
  className?: string;
  /** Set true to remove the inner padding (when children carry their own,
   *  e.g. a chart or table that draws to its edges). */
  flush?: boolean;
  children: React.ReactNode;
}

/**
 * One bento cell. Consistent rounded corners, subtle border, optional
 * accent stripe, optional header. Children render in a scroll-safe body.
 */
export default function BentoTile({ header, accent, headerBg, className, flush, children }: Props) {
  const borderColor = accent ? `${accent}33` : 'rgba(255,255,255,0.08)';
  const innerGlow = accent ? `0 0 24px -8px ${accent}55` : undefined;
  return (
    <div
      className={`relative rounded-lg border bg-white/2 overflow-hidden flex flex-col ${className ?? ''}`}
      style={{ borderColor, boxShadow: innerGlow }}
    >
      {accent && (
        <span
          className="absolute left-0 top-0 bottom-0 w-[2px] pointer-events-none"
          style={{ background: accent }}
        />
      )}
      {header && (
        <div className="shrink-0 px-3 py-2 border-b border-white/6" style={headerBg ? { background: headerBg } : undefined}>
          {header}
        </div>
      )}
      <div className={`flex-1 min-h-0 overflow-auto ${flush ? '' : 'px-3 py-2'}`}>
        {children}
      </div>
    </div>
  );
}

/** Shared tile-header label affordance. */
export function TileLabel({ children, count, accent }: { children: React.ReactNode; count?: number | string; accent?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className="text-[9px] uppercase tracking-[0.18em] font-mono"
        style={{ color: accent ?? 'rgba(232, 232, 232, 0.55)' }}
      >
        {children}
      </span>
      {count !== undefined && (
        <span className="text-[9px] text-text-dim/60 font-mono tabular-nums">{count}</span>
      )}
    </div>
  );
}

/** Inline metric — large number + tiny label, used inside small bento cells. */
export function BentoMetric({
  value, label, prefix, tone = 'default', delta,
}: {
  value: string | number;
  label: string;
  prefix?: string;
  tone?: 'default' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky';
  delta?: { value: string; positive: boolean };
}) {
  const cls = {
    default: 'text-text-primary',
    violet: 'text-violet-200',
    emerald: 'text-emerald-300',
    amber: 'text-amber-200',
    rose: 'text-rose-300',
    sky: 'text-sky-300',
  }[tone];
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim font-mono truncate">{label}</span>
        {delta && (
          <span className={`text-[9px] font-mono tabular-nums ${delta.positive ? 'text-emerald-300' : 'text-rose-300'}`}>
            {delta.positive ? '▲' : '▼'} {delta.value}
          </span>
        )}
      </div>
      <div className={`text-xl font-light tabular-nums leading-none ${cls} truncate`}>
        {prefix && <span className="text-text-dim/70 text-sm mr-1">{prefix}</span>}
        {value}
      </div>
    </div>
  );
}
