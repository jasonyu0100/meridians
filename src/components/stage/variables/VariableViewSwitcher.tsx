'use client';
// VariableViewSwitcher — toggle control choosing the variables visualisation mode (radar / parallel / grid).

export type VariableViewMode = 'radar' | 'parallel' | 'grid';

interface Props {
  mode: VariableViewMode;
  onChange: (mode: VariableViewMode) => void;
  /** Modes to expose — Present hides 'grid' since it's degenerate with a
   *  single trace. */
  allowed?: VariableViewMode[];
}

const ALL_MODES: { value: VariableViewMode; label: string }[] = [
  { value: 'radar', label: 'Radar' },
  { value: 'parallel', label: 'Parallel' },
  { value: 'grid', label: 'Grid' },
];

/** Compact tab strip for switching between the three variable views.
 *  Renders inline so it can sit alongside the bento tile's header label. */
export default function VariableViewSwitcher({ mode, onChange, allowed }: Props) {
  const modes = allowed
    ? ALL_MODES.filter((m) => allowed.includes(m.value))
    : ALL_MODES;
  return (
    <div className="flex items-center gap-0.5 bg-white/4 border border-white/8 rounded p-0.5">
      {modes.map((m) => (
        <button
          key={m.value}
          onClick={() => onChange(m.value)}
          className={`text-[10px] font-medium px-2 py-0.5 rounded transition-colors ${
            mode === m.value
              ? 'bg-white/12 text-text-primary'
              : 'text-text-dim hover:text-text-secondary hover:bg-white/4'
          }`}
          title={`${m.label} view`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
