'use client';

import { type ReactNode, useState, useCallback, useRef } from 'react';
import TopBar from '@/components/topbar/TopBar';
import { StarField } from '@/components/effects/StarField';
import { IconChevronLeft, IconChevronRight } from '@/components/icons';

type AppShellProps = {
  children: ReactNode;
  sidebar: ReactNode;
  sidepanel: ReactNode;
};

function useResize(
  initialWidth: number,
  minWidth: number,
  maxWidth: number,
  side: 'left' | 'right',
  initialCollapsed = false,
) {
  const [width, setWidth] = useState(initialWidth);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = width;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = side === 'left'
          ? ev.clientX - startX.current
          : startX.current - ev.clientX;
        const next = Math.max(minWidth, Math.min(maxWidth, startW.current + delta));
        setWidth(next);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [width, minWidth, maxWidth, side],
  );

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return { width: collapsed ? 0 : width, collapsed, onMouseDown, toggle };
}

export default function AppShell({ children, sidebar, sidepanel }: AppShellProps) {
  const left = useResize(300, 150, 600, 'left', true);
  const right = useResize(500, 150, 1200, 'right', false);

  return (
    <div className="h-screen bg-bg-base flex flex-col overflow-hidden relative">
      {/* Ambient cosmic background — dim nebulae + star field behind workspace */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="cosmos-container cosmos-workspace absolute inset-0 z-0">
          <div className="nebula nebula-1" />
          <div className="nebula nebula-2" />
          <div className="nebula nebula-3" />
          <div className="cosmos-glow" />
        </div>
        <div className="absolute inset-0 z-10 opacity-50">
          <StarField />
        </div>
      </div>

      {/* TopBar */}
      <div className="h-11 shrink-0 relative z-20">
        <TopBar />
      </div>

      {/* Main row */}
      <div className="flex-1 flex min-h-0 relative z-10">
        {/* Left sidebar */}
        {!left.collapsed && (
          <div
            className="relative shrink-0 overflow-hidden"
            style={{ width: left.width }}
          >
            {sidebar}
            {/* Resize handle */}
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-violet-300/15 active:bg-violet-300/25 transition-colors z-10"
              onMouseDown={left.onMouseDown}
            />
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {children}
        </div>

        {/* Right side panel */}
        {!right.collapsed && (
          <div
            className="relative shrink-0 overflow-hidden"
            style={{ width: right.width }}
          >
            {/* Resize handle */}
            <div
              className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-violet-300/15 active:bg-violet-300/25 transition-colors z-10"
              onMouseDown={right.onMouseDown}
            />
            {sidepanel}
          </div>
        )}

        {/* Left toggle — pointer-events-none container (resize handle still works),
            pill is pointer-events-auto with low resting opacity so it's always findable */}
        <div
          className="absolute top-0 bottom-0 z-30 w-4 flex items-center justify-center pointer-events-none"
          style={{ left: left.collapsed ? 0 : left.width - 8 }}
        >
          <button
            onClick={left.toggle}
            title={left.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="pointer-events-auto flex items-center justify-center w-6 h-10 rounded-full glass-pill text-text-secondary opacity-80 hover:opacity-100 hover:scale-110 hover:text-violet-200 hover:shadow-[0_0_14px_rgba(196,181,253,0.35)] transition-all cursor-pointer"
          >
            {left.collapsed ? <IconChevronRight size={10} /> : <IconChevronLeft size={10} />}
          </button>
        </div>

        {/* Right toggle — same pattern */}
        <div
          className="absolute top-0 bottom-0 z-30 w-4 flex items-center justify-center pointer-events-none"
          style={{ right: right.collapsed ? 0 : right.width - 8 }}
        >
          <button
            onClick={right.toggle}
            title={right.collapsed ? 'Expand inspector' : 'Collapse inspector'}
            className="pointer-events-auto flex items-center justify-center w-6 h-10 rounded-full glass-pill text-text-secondary opacity-80 hover:opacity-100 hover:scale-110 hover:text-violet-200 hover:shadow-[0_0_14px_rgba(196,181,253,0.35)] transition-all cursor-pointer"
          >
            {right.collapsed ? <IconChevronLeft size={10} /> : <IconChevronRight size={10} />}
          </button>
        </div>
      </div>
    </div>
  );
}
