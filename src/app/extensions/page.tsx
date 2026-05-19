'use client';

/**
 * /extensions — viewer for world-scoped file-conversion jobs.
 *
 * Reuses the analysis-page shell but scoped to `kind: 'extend'` jobs.
 * Extension jobs are created from the per-world Files sidebar; this
 * route is purely for inspecting their progress / output. There's no
 * "+ New" entry point — that lives on the Files panel where the user
 * is already in the context of a specific world.
 */

import { Suspense } from 'react';
import { AnalysisPageInner } from '@/app/analysis/page';

export default function ExtensionsPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-bg-base" />}>
      <AnalysisPageInner kind="extend" />
    </Suspense>
  );
}
