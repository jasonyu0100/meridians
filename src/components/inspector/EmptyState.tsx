'use client';

// EmptyState — placeholder shown in the inspector when no entity is selected.

export default function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="text-text-dim"
        >
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <text
            x="8"
            y="11.5"
            textAnchor="middle"
            fill="currentColor"
            fontSize="10"
            fontFamily="sans-serif"
          >
            ?
          </text>
        </svg>
      </div>
      <p className="text-sm text-text-dim">Select a node to inspect</p>
    </div>
  );
}
