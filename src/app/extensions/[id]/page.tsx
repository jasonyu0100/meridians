'use client';

/**
 * /extensions/[id] — per-narrative extension-job viewer.
 *
 * Scopes the shared AnalysisShell to extension jobs whose
 * targetNarrativeId matches the route id. Makes per-world management
 * tractable when many worlds have extensions running in parallel —
 * each world's Files panel links here to inspect its own jobs.
 */

import { Suspense, use } from 'react';
import { AnalysisPageInner } from '@/components/analysis/AnalysisShell';

export default function ExtensionsForNarrativePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <Suspense fallback={<div className="h-screen bg-bg-base" />}>
      <AnalysisPageInner kind="extend" narrativeFilter={id} />
    </Suspense>
  );
}
