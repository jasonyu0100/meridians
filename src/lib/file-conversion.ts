/**
 * file-conversion — world-scoped helpers for adding a source file to a
 * narrative and (optionally) kicking off its conversion.
 *
 * Files walk: staged → converting → ready → committed. This module
 * owns the staged + converting transitions. The "Apply to current
 * branch" step (ready → committed) lives separately.
 *
 * Extension jobs ride on the same `AnalysisRunner` as creation jobs but
 * are tagged `kind: 'extend'` with `targetNarrativeId` + `fileId`. The
 * runner removes them from state.analysisJobs once complete so they
 * never bleed into the global /analysis page; the SourceFile is the
 * durable record afterwards.
 */

import { assetManager } from '@/lib/asset-manager';
import { splitCorpusIntoScenes } from '@/lib/text-analysis';
import { analysisRunner } from '@/lib/analysis-runner';
import type { AnalysisJob, NarrativeState, SourceFile } from '@/types/narrative';
import type { Action } from '@/lib/store';

type Dispatch = (action: Action) => void;

/** Three-letter prefix from a title (same convention as id-space in
 *  text-analysis). Falls back to "TXT" when the title has no letters. */
function titlePrefix(title: string): string {
  return title.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'TXT';
}

/** Returns the smallest unused integer suffix for a given prefix in the
 *  narrative's existing file ids. So if F-HP-1 and F-HP-3 exist, this
 *  returns 4 (we always append; no gap reuse). */
function nextFileNumber(narrative: NarrativeState, prefix: string): number {
  const ids = Object.keys(narrative.files ?? {});
  let max = 0;
  const re = new RegExp(`^F-${prefix}-(\\d+)$`);
  for (const id of ids) {
    const m = id.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/** Stage a new file on the narrative. Stores the raw text in IDB and
 *  dispatches ADD_SOURCE_FILE. Returns the staged SourceFile so the
 *  caller can immediately kick off conversion if desired. */
export async function stageFile(
  narrative: NarrativeState,
  name: string,
  content: string,
  dispatch: Dispatch,
): Promise<SourceFile> {
  const prefix = titlePrefix(narrative.title || name);
  const num = nextFileNumber(narrative, prefix);
  const contentRef = await assetManager.storeText(content, undefined, narrative.id);
  const file: SourceFile = {
    id: `F-${prefix}-${num}`,
    name: name.trim() || `File ${num}`,
    mode: 'extend',
    contentRef,
    charCount: content.length,
    wordCount: content.trim().split(/\s+/).filter(Boolean).length,
    createdAt: Date.now(),
    status: 'staged',
  };
  dispatch({ type: 'ADD_SOURCE_FILE', narrativeId: narrative.id, file });
  return file;
}

/** Kick off the conversion pipeline for a staged or failed file.
 *  Constructs an `AnalysisJob` tagged with kind='extend' so the runner
 *  routes the result back onto the SourceFile instead of creating a new
 *  narrative, flips the file to status='converting', and starts the run.
 *  Returns the job id for callers that want to subscribe to progress. */
export async function convertFile(
  narrative: NarrativeState,
  file: SourceFile,
  dispatch: Dispatch,
): Promise<string | null> {
  const content = await assetManager.getText(file.contentRef);
  if (!content) {
    dispatch({
      type: 'UPDATE_SOURCE_FILE',
      narrativeId: narrative.id,
      fileId: file.id,
      updates: { status: 'failed', error: 'Source text missing from local storage.' },
    });
    return null;
  }

  const scenes = splitCorpusIntoScenes(content);
  const chunks = scenes.map((s) => ({
    index: s.index,
    text: s.prose,
    sectionCount: Math.ceil(s.wordCount / 100),
  }));

  const jobId = `AJX-${Date.now().toString(36)}`;
  const job: AnalysisJob = {
    id: jobId,
    title: file.name,
    sourceText: content,
    chunks,
    results: new Array(chunks.length).fill(null),
    status: 'running',
    phase: 'structure',
    currentChunkIndex: 0,
    kind: 'extend',
    targetNarrativeId: narrative.id,
    fileId: file.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  dispatch({ type: 'ADD_ANALYSIS_JOB', job });
  dispatch({
    type: 'UPDATE_SOURCE_FILE',
    narrativeId: narrative.id,
    fileId: file.id,
    updates: { status: 'converting', analysisJobId: jobId, error: undefined },
  });

  // Fire-and-forget. Errors propagate via the runner's job/file updates.
  analysisRunner.start(job, dispatch).catch(() => { /* runner has its own error handling */ });

  return jobId;
}
