'use client';

/**
 * /extensions — viewer for world-scoped file-conversion jobs.
 *
 * Reuses the analysis-page shell scoped to `kind: 'extend'`. Extension
 * jobs are created from the per-world Files sidebar, not here — this
 * route is purely for inspecting their progress / output.
 */

import { Suspense } from 'react';
import { AnalysisPageInner } from '@/components/analysis/AnalysisShell';

export default function ExtensionsPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-bg-base" />}>
      <AnalysisPageInner kind="extend" />
    </Suspense>
  );
}
