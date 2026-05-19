'use client';

import { useState } from 'react';
import ThreadPortfolio from '@/components/sidebar/ThreadPortfolio';
import MediaDrive from '@/components/sidebar/MediaDrive';
import FilesPanel from '@/components/sidebar/FilesPanel';

type Tab = 'threads' | 'media' | 'files';

const TAB_LABELS: Record<Tab, string> = {
  threads: 'Threads',
  media: 'Drive',
  files: 'Files',
};

export default function Sidebar() {
  const [tab, setTab] = useState<Tab>('threads');

  return (
    <div className="glass-panel flex flex-col h-full border-r border-border">
      {/* Tab bar */}
      <div className="shrink-0 flex border-b border-border">
        {(['threads', 'media', 'files'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2 text-[11px] font-medium transition-colors ${
              tab === t
                ? 'text-text-primary border-b border-accent'
                : 'text-text-dim hover:text-text-secondary'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'threads' && <ThreadPortfolio />}
      {tab === 'media' && <MediaDrive />}
      {tab === 'files' && <FilesPanel />}
    </div>
  );
}
