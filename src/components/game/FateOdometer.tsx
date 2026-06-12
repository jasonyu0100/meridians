/** The Fate odometer — Conviction's north-star readout (plan §8a-3). The reborn
 *  "Total Pot" counter: a rolling-digit Fate / Impact figure that sits at the
 *  centre of the felt every phase. Tabular-mono, segmented digits. */
"use client";

export function FateOdometer({
  value,
  label = "FATE MOVED",
}: {
  value: number;
  label?: string;
}) {
  const display = value.toFixed(2);
  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <span className="text-[9px] tracking-[0.25em] uppercase text-text-dim/70">{label}</span>
      <div className="flex items-center gap-0.5">
        {display.split("").map((ch, i) =>
          ch === "." ? (
            <span key={i} className="text-accent text-2xl font-mono">
              .
            </span>
          ) : (
            <span
              key={i}
              className="inline-flex items-center justify-center w-6 h-9 rounded-[3px] bg-black/50 border border-white/10 text-accent font-mono text-2xl tabular-nums shadow-inner"
            >
              {ch}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
