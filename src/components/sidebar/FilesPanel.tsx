'use client';

/**
 * FilesPanel — sidebar list of source files that contributed to this
 * narrative. Each card surfaces a kind chip (create / extend), char +
 * word counts, and a created-at line. Click → SourceFileModal hydrates
 * the raw body from the assets DB and shows a copy button.
 */

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { SourceFileModal } from '@/components/sidebar/SourceFileModal';
import type { SourceFile } from '@/types/narrative';

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

export default function FilesPanel() {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const [openId, setOpenId] = useState<string | null>(null);

  const files = useMemo<SourceFile[]>(() => {
    if (!narrative) return [];
    return Object.values(narrative.files ?? {}).sort((a, b) => a.createdAt - b.createdAt);
  }, [narrative]);

  const openFile = files.find((f) => f.id === openId) ?? null;

  if (!narrative) {
    return (
      <div className="flex-1 flex items-center justify-center px-3">
        <p className="text-xs text-text-dim text-center">Select a narrative</p>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-2">
        <p className="text-[11px] text-text-dim">No files yet</p>
        <p className="text-[10px] text-text-dim/60 text-center leading-relaxed">
          The source corpus appears here once a text-analysis job stamps
          this narrative. Extension files attach the same way.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-2" style={{ scrollbarWidth: 'thin' }}>
        {files.map((f) => {
          const chip = f.mode === 'create'
            ? { label: 'create', class: 'bg-sky-400/15 text-sky-300' }
            : { label: 'extend', class: 'bg-emerald-400/15 text-emerald-300' };
          return (
            <button
              key={f.id}
              onClick={() => setOpenId(f.id)}
              className="group w-full text-left rounded-lg border border-white/5 bg-white/3 hover:bg-white/6 hover:border-white/10 transition-colors p-3"
            >
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-px rounded ${chip.class}`}>
                  {chip.label}
                </span>
                <span className="text-[11px] text-text-primary font-medium truncate flex-1 min-w-0">
                  {f.name}
                </span>
              </div>
              <div className="flex items-baseline gap-2 text-[10px] text-text-dim/75 font-mono tabular-nums">
                <span>{formatCount(f.wordCount)} words</span>
                <span className="text-text-dim/30">·</span>
                <span>{formatCount(f.charCount)} chars</span>
                <span className="text-text-dim/30 ml-auto">·</span>
                <span>{formatDate(f.createdAt)}</span>
              </div>
            </button>
          );
        })}
      </div>

      {openFile && <SourceFileModal key={openFile.id} file={openFile} onClose={() => setOpenId(null)} />}
    </div>
  );
}
