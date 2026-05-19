'use client';

/**
 * /analysis — text-analysis dashboard for kind: 'create' jobs (the
 * runs that seed new worlds). All the UI lives in AnalysisShell so the
 * /extensions route can reuse it scoped to kind: 'extend' without
 * importing across route files (which trips Next.js HMR into a compile
 * loop in dev).
 */

import { Suspense } from 'react';
import { AnalysisPageInner } from '@/components/analysis/AnalysisShell';

export default function AnalysisPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-bg-base" />}>
      <AnalysisPageInner kind="create" />
    </Suspense>
  );
}
