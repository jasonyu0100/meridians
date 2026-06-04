'use client';

/**
 * Left sidebar — image/media management only (Drive). Conversational
 * surfaces (Chat, Threads portfolio, Files) and inspection surfaces
 * live on the right InspectorPanel so the operator can manage everything
 * from one rail.
 */

import MediaDrive from '@/components/sidebar/MediaDrive';

export default function Sidebar() {
  return (
    <div className="glass-panel flex flex-col h-full border-r border-border">
      <div className="shrink-0 flex border-b border-border">
        <div className="flex-1 px-3 py-2 text-[11px] font-medium text-text-primary border-b border-accent">
          Drive
        </div>
      </div>
      <MediaDrive />
    </div>
  );
}
