/**
 * Singleton analysis runner — persists across React component mounts/unmounts.
 * Jobs continue running even when the user navigates away from the analysis page.
 *
 * Scene-first pipeline (bottom-up):
 *   Phase 1 — Plans: extract beat plans + embeddings per scene (parallel)
 *   Phase 2 — Structure: extract entities + deltas per scene from prose + plan (parallel)
 *   Phase 3 — Arcs: group every 4 scenes, name each arc
 *   Phase 4 — Reconciliation: deduplicate entities, stitch threads, merge name variants
 *   Phase 5 — Finalization: thread dependencies
 *   Phase 6 — Assembly: build final NarrativeState from reconciled data
 */

import { reconcileResults, analyzeThreading, assembleNarrative, extractSceneStructure, groupScenesIntoArcs, reextractFateWithLifecycle } from '@/lib/analysis/text-analysis';
import { reverseEngineerScenePlan } from '@/lib/ai/scenes';
import { generateSceneGameAnalysis } from '@/lib/ai/game-analysis';
import { FatalApiError } from '@/lib/ai/errors';
import type { AnalysisJob, AnalysisChunkResult, SourceFile, Scene } from '@/types/narrative';
import type { Action } from '@/lib/state/store';
import { ANALYSIS_CONCURRENCY } from '@/lib/constants';
import { logError, logWarning, logInfo, setSystemLoggerAnalysisId } from '@/lib/core/system-logger';
import { setLoggerAnalysisId } from '@/lib/core/api-logger';
import { assetManager } from '@/lib/storage/asset-manager';

type Dispatch = (action: Action) => void;

type StreamListener = (jobId: string, text: string) => void;
type ChunkStreamListener = (jobId: string, chunkIndex: number, text: string) => void;
type InFlightListener = (jobId: string, indices: number[]) => void;
type PlanStreamListener = (jobId: string, key: string, text: string) => void;
type PlanInFlightListener = (jobId: string, keys: string[]) => void;

type RunningJob = {
  cancelled: boolean;
  inFlightIndices: Set<number>;
  chunkStreams: Map<number, string>;
  planInFlightKeys: Set<string>;
  planStreams: Map<string, string>;
};

const MAX_CONCURRENCY = ANALYSIS_CONCURRENCY;

/** Three-letter prefix mirroring the convention in `assembleNarrative` —
 *  uppercase letters from the title, falling back to "TXT". Used to keep
 *  file ids consistent with the rest of the narrative's id space. */
function titlePrefix(title: string): string {
  return title.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'TXT';
}

/** Persist the corpus that produced this narrative as a SourceFile and
 *  return a narrative with `files[fileId]` set. The raw body lives in
 *  IndexedDB (`text_xxx`) so narrative.json stays small. Failure here is
 *  non-fatal — analysis still succeeded; we just won't have the source on
 *  hand. */
async function attachCreationFile(
  narrative: import('@/types/narrative').NarrativeState,
  job: AnalysisJob,
): Promise<import('@/types/narrative').NarrativeState> {
  try {
    const contentRef = await assetManager.storeText(job.sourceText, undefined, narrative.id);
    // Retain the assembled narrative as an appliable slice — the SAME artifact
    // an upload+process ('extend') run parks on its file (it stores
    // JSON.stringify(narrative) as extractedRef; see runPipeline). Creation
    // already computed this; keeping it means the origin file can be added to a
    // timeline (any branch) without re-running analysis. Snapshot is taken
    // before the file is attached, so the slice carries no self-referential
    // file record.
    const extractedRef = await assetManager.storeText(
      JSON.stringify(narrative),
      undefined,
      narrative.id,
    );
    const file: SourceFile = {
      id: `F-${titlePrefix(narrative.title || job.title)}-1`,
      name: job.title || 'Source',
      mode: 'create',
      contentRef,
      charCount: job.sourceText.length,
      wordCount: job.sourceText.trim().split(/\s+/).filter(Boolean).length,
      createdAt: Date.now(),
      // The slice was assembled straight onto the new narrative's main branch,
      // so the file is 'committed' — but it retains extractedRef, so it can
      // still extend other branches (parity with an uploaded+processed file).
      status: 'committed',
      extractedRef,
      // Provenance: this file is the corpus the world view was extracted from.
      // Tagging it 'analysis' gives it parity with traditionally-added files in
      // FilesPanel (removable, origin star) instead of being a frozen record.
      source: 'analysis',
    };
    return { ...narrative, files: { ...(narrative.files ?? {}), [file.id]: file } };
  } catch (err) {
    logWarning('Failed to stamp creation file on narrative', err, {
      source: 'analysis',
      operation: 'attach-creation-file',
      details: { narrativeId: narrative.id, jobId: job.id },
    });
    return narrative;
  }
}

class AnalysisRunner {
  private running = new Map<string, RunningJob>();
  private streamListeners = new Set<StreamListener>();
  private chunkStreamListeners = new Set<ChunkStreamListener>();
  private inFlightListeners = new Set<InFlightListener>();
  private planStreamListeners = new Set<PlanStreamListener>();
  private planInFlightListeners = new Set<PlanInFlightListener>();
  private streamTexts = new Map<string, string>();

  onStream(listener: StreamListener): () => void { this.streamListeners.add(listener); return () => this.streamListeners.delete(listener); }
  onChunkStream(listener: ChunkStreamListener): () => void { this.chunkStreamListeners.add(listener); return () => this.chunkStreamListeners.delete(listener); }
  onInFlightChange(listener: InFlightListener): () => void { this.inFlightListeners.add(listener); return () => this.inFlightListeners.delete(listener); }
  onPlanStream(listener: PlanStreamListener): () => void { this.planStreamListeners.add(listener); return () => this.planStreamListeners.delete(listener); }
  onPlanInFlightChange(listener: PlanInFlightListener): () => void { this.planInFlightListeners.add(listener); return () => this.planInFlightListeners.delete(listener); }

  getStreamText(jobId: string): string { return this.streamTexts.get(jobId) ?? ''; }
  getChunkStreamText(jobId: string, chunkIndex: number): string { return this.running.get(jobId)?.chunkStreams.get(chunkIndex) ?? ''; }
  getInFlightIndices(jobId: string): number[] { const e = this.running.get(jobId); return e ? [...e.inFlightIndices] : []; }
  getPlanStreamText(jobId: string, key: string): string { return this.running.get(jobId)?.planStreams.get(key) ?? ''; }
  getPlanInFlightKeys(jobId: string): string[] { const e = this.running.get(jobId); return e ? [...e.planInFlightKeys] : []; }
  isRunning(jobId: string): boolean { return this.running.has(jobId); }
  pause(jobId: string) { const e = this.running.get(jobId); if (e) e.cancelled = true; }

  async start(job: AnalysisJob, dispatch: Dispatch) {
    if (this.running.has(job.id)) { logWarning('Analysis job already running', `Job ID: ${job.id}`, { source: 'analysis', operation: 'start-job', details: { jobId: job.id } }); return; }

    const entry: RunningJob = { cancelled: false, inFlightIndices: new Set(), chunkStreams: new Map(), planInFlightKeys: new Set(), planStreams: new Map() };
    this.running.set(job.id, entry);
    this.streamTexts.set(job.id, '');
    setLoggerAnalysisId(job.id);
    setSystemLoggerAnalysisId(job.id);

    logInfo('Starting analysis job', { source: 'analysis', operation: 'start-job', details: { jobId: job.id, title: job.title, chunkCount: job.chunks.length } });

    try {
      dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'running', phase: 'structure' } });
      await this.runPipeline(job, entry, dispatch);
    } catch (err) {
      logError('Analysis job failed', err, { source: 'analysis', operation: 'analysis-job', details: { jobId: job.id, title: job.title } });
      dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: err instanceof Error ? err.message : String(err) } });
    } finally {
      setLoggerAnalysisId(null);
      setSystemLoggerAnalysisId(null);
      this.cleanup(job.id);
    }
  }

  // ── Pipeline ───────────────────────────────────────────────────────────────

  private async runPipeline(job: AnalysisJob, entry: RunningJob, d: Dispatch) {
    // Each job.chunks entry is a scene-sized prose segment (~1200 words).
    // Results are 1:1 with chunks — one AnalysisChunkResult per scene.
    const results: (AnalysisChunkResult | null)[] = [...job.results];
    const total = job.chunks.length;

    // Helper: run tasks with concurrency limit
    const runParallel = async <T>(tasks: T[], fn: (task: T) => Promise<void>, label: string) => {
      if (tasks.length === 0) return;
      let done = 0;
      const queue = [...tasks];
      let active = 0;
      let resolve!: () => void;
      const promise = new Promise<void>((r) => { resolve = r; });

      const launch = async (task: T) => {
        active++;
        try { await fn(task); } catch { /* handled inside fn */ }
        done++;
        active--;
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results], currentChunkIndex: done } });
        this.emitStream(job.id, `${label}: ${done}/${tasks.length}`);
        if (queue.length > 0 && !entry.cancelled) {
          launch(queue.shift()!);
        } else if (active === 0) {
          resolve();
        }
      };

      const batch = Math.min(MAX_CONCURRENCY, queue.length);
      for (let i = 0; i < batch; i++) launch(queue.shift()!);
      await promise;
    };

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 1: STRUCTURE — entities + deltas per scene from raw prose (parallel)
    // ═════════════════════════════════════════════════════════════════════════
    const structPending = job.chunks.map((_, i) => i).filter(i => !results[i]?.chapterSummary);

    if (structPending.length > 0) {
      this.emitStream(job.id, `Structure: ${structPending.length} scenes...`);

      await runParallel(structPending, async (idx) => {
        const chunk = job.chunks[idx];

        // Initialize result if not yet created
        if (!results[idx]) {
          results[idx] = {
            chapterSummary: '',
            characters: [],
            locations: [],
            threads: [],
            scenes: [{
              locationName: '', povName: '', participantNames: [], events: [],
              summary: `Scene ${idx + 1}`,
              sections: [],
              prose: chunk.text,
              threadDeltas: [],
              worldDeltas: [],
              relationshipDeltas: [],
            }],
            relationships: [],
          };
        }

        entry.inFlightIndices.add(idx);
        this.emitInFlight(job.id, [...entry.inFlightIndices]);

        const MAX_STRUCTURE_RETRIES = 3;
        let attempt = 0;
        let succeeded = false;

        while (attempt < MAX_STRUCTURE_RETRIES && !succeeded && !entry.cancelled) {
          attempt++;
          try {
            const scene = results[idx]!.scenes[0];
            const s = await extractSceneStructure(scene.prose ?? chunk.text, scene.plan ?? null, (_token, acc) => {
              entry.chunkStreams.set(idx, acc);
              this.emitChunkStream(job.id, idx, acc);
            });

            // Populate scene deltas
            scene.povName = s.povName || scene.povName;
            scene.locationName = s.locationName || scene.locationName;
            scene.participantNames = s.participantNames.length > 0 ? s.participantNames : scene.participantNames;
            scene.events = s.events.length > 0 ? s.events : scene.events;
            scene.summary = s.summary || scene.summary;
            scene.threadDeltas = s.threadDeltas;
            scene.worldDeltas = s.worldDeltas;
            scene.relationshipDeltas = s.relationshipDeltas;
            scene.artifactUsages = s.artifactUsages;
            scene.ownershipDeltas = s.ownershipDeltas;
            scene.tieDeltas = s.tieDeltas;
            scene.systemDeltas = s.systemDeltas;
            scene.timeDelta = s.timeDelta ?? null;

            // Populate chunk-level entities
            const r = results[idx]!;
            r.chapterSummary = s.summary;
            r.characters = s.characters;
            r.locations = s.locations;
            r.artifacts = s.artifacts;
            r.threads = s.threads;
            r.relationships = s.relationships;

            // Dispatch immediately so the entity cloud updates progressively
            d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results] } });
            succeeded = true;
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            // Credit/auth failures won't recover on retry — cancel the whole
            // job so sibling scenes stop spawning calls. The outer phase
            // driver reads `entry.cancelled` and transitions the job to
            // 'paused'.
            if (err instanceof FatalApiError) {
              logError(`Analysis stopped — fatal API error`, err, {
                source: 'analysis', operation: 'scene-structure',
                details: { jobId: job.id, sceneIdx: idx, status: err.status },
              });
              this.emitStream(job.id, `Analysis stopped — ${err.message}`);
              entry.cancelled = true;
              break;
            }
            if (attempt < MAX_STRUCTURE_RETRIES) {
              logWarning(`Structure extraction failed for scene ${idx + 1} (attempt ${attempt}/${MAX_STRUCTURE_RETRIES}), retrying...`, err, {
                source: 'analysis', operation: 'scene-structure',
                details: { jobId: job.id, sceneIdx: idx, attempt, error: errMsg },
              });
              this.emitStream(job.id, `Structure: scene ${idx + 1} failed (attempt ${attempt}), retrying...`);
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // backoff
            } else {
              logError(`Structure extraction failed for scene ${idx + 1} after ${MAX_STRUCTURE_RETRIES} attempts`, err, {
                source: 'analysis', operation: 'scene-structure',
                details: { jobId: job.id, sceneIdx: idx, attempts: attempt, error: errMsg },
              });
              this.emitStream(job.id, `Structure: scene ${idx + 1} FAILED after ${MAX_STRUCTURE_RETRIES} attempts`);
            }
          }
        }

        {
          entry.inFlightIndices.delete(idx);
          this.emitInFlight(job.id, [...entry.inFlightIndices]);
        }
      }, 'Structure');

      this.emitStream(job.id, `[OK] Structure extracted`);
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results] } });
    }

    if (entry.cancelled) { d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', results: [...results] } }); return; }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 2: PLANS + EMBEDDINGS — beat plans per scene (parallel)
    // Opt-in: runs only when job.runPlanExtraction is true.
    // ═════════════════════════════════════════════════════════════════════════
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'plans' } });

    const planPending = job.runPlanExtraction
      ? job.chunks.map((_, i) => i).filter(i => !results[i]?.scenes?.[0]?.plan)
      : [];

    if (!job.runPlanExtraction) {
      this.emitStream(job.id, 'Plans: skipped (vector search not requested)');
    }

    if (planPending.length > 0) {
      this.emitStream(job.id, `Plans: ${planPending.length} scenes...`);

      await runParallel(planPending, async (idx) => {
        const chunk = job.chunks[idx];
        const planKey = String(idx);
        entry.planInFlightKeys.add(planKey);
        this.emitPlanInFlight(job.id, [...entry.planInFlightKeys]);

        try {
          const sceneSummary = results[idx]?.scenes?.[0]?.summary ?? `Scene ${idx + 1}`;
          const { plan, beatProseMap } = await reverseEngineerScenePlan(
            null,
            chunk.text,
            sceneSummary,
            (_token, acc) => { entry.planStreams.set(planKey, acc); this.emitPlanStream(job.id, planKey, acc); },
          );

          // Attach plan + prose map to existing result
          const scene = results[idx]?.scenes?.[0];
          if (scene) {
            scene.plan = plan;
            scene.beatProseMap = beatProseMap ?? undefined;
          }
        } catch (err) {
          logWarning('Plan extraction failed for scene', err, { source: 'analysis', operation: 'plan-extraction', details: { jobId: job.id, sceneIdx: idx } });
          // Credit/auth failures won't recover — cancel the job so sibling
          // workers stop spawning calls.
          if (err instanceof FatalApiError) {
            this.emitStream(job.id, `Analysis stopped — ${err.message}`);
            entry.cancelled = true;
          }
        } finally {
          entry.planInFlightKeys.delete(planKey);
          this.emitPlanInFlight(job.id, [...entry.planInFlightKeys]);
        }
      }, 'Plans');

      this.emitStream(job.id, `[OK] Plans extracted`);

      // Embed propositions from all plans (batched after plan extraction for progressive UI)
      this.emitStream(job.id, 'Embedding propositions...');
      try {
        const { embedPropositions, computeCentroid } = await import('@/lib/search/embeddings');
        const { assetManager } = await import('@/lib/storage/asset-manager');

        const scenesWithPlans = results
          .map((r, i) => ({ idx: i, scene: r?.scenes?.[0] }))
          .filter((s): s is { idx: number; scene: NonNullable<typeof s.scene> } => !!s.scene?.plan);

        for (let si = 0; si < scenesWithPlans.length; si++) {
          const { scene } = scenesWithPlans[si];
          const plan = scene.plan!;
          const allProps = plan.beats.flatMap((beat, bi) => beat.propositions.map((p, pi) => ({ ...p, bi, pi })));
          if (allProps.length === 0) continue;

          try {
            const embedded = await embedPropositions(allProps.map(p => ({ content: p.content, type: p.type })), job.id);
            allProps.forEach((p, i) => { plan.beats[p.bi].propositions[p.pi] = embedded[i]; });

            // Beat centroids
            for (const beat of plan.beats) {
              const refs = beat.propositions.filter(p => p.embedding).map(p => p.embedding!);
              if (refs.length > 0) {
                const vectors: number[][] = [];
                for (const ref of refs) { const v = await assetManager.getEmbedding(ref); if (v) vectors.push(v); }
                if (vectors.length > 0) beat.embeddingCentroid = await assetManager.storeEmbedding(computeCentroid(vectors), 'text-embedding-3-small');
              }
            }
          } catch (embErr) {
            logWarning('Proposition embedding failed for scene (non-fatal)', embErr, { source: 'analysis', operation: 'plan-embed', details: { sceneIdx: scenesWithPlans[si].idx } });
          }

          this.emitStream(job.id, `Embedding propositions: ${si + 1}/${scenesWithPlans.length}`);
          if (entry.cancelled) break;
        }
      } catch (embErr) {
        logWarning('Proposition embedding failed (non-fatal)', embErr, { source: 'analysis', operation: 'plan-embed' });
      }

      this.emitStream(job.id, `[OK] Plans + propositions embedded`);
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results] } });
    }

    if (entry.cancelled) { d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', results: [...results] } }); return; }

    // ═════════════════════════════════════════════════════════════════════════
    // Summary + prose embeddings — ALWAYS, independent of plan extraction.
    // Summaries always exist and power semantic search + Recall/Experience
    // scoring; prose embeds when present. Proposition embedding above needs
    // plans, but these do not — so they run whether or not plan extraction was
    // requested. Idempotent: only scenes still missing a ref are embedded, so
    // this is safe on resume and when Phase 2 was skipped.
    // ═════════════════════════════════════════════════════════════════════════
    this.emitStream(job.id, 'Embedding summaries + prose...');
    try {
      const { generateEmbeddingsBatch } = await import('@/lib/search/embeddings');
      const { assetManager } = await import('@/lib/storage/asset-manager');
      // Analysis scenes carry optional embedding refs stashed during this
      // phase; the chunk-result scene type doesn't declare them, so view them
      // through a local extension rather than casting to `any`.
      type EmbeddableScene = AnalysisChunkResult['scenes'][number] & {
        summaryEmbedding?: string;
        proseEmbedding?: string;
      };
      const allScenes = results
        .filter((r): r is AnalysisChunkResult => !!r)
        .flatMap(r => r.scenes as EmbeddableScene[]);

      const needSummary = allScenes.filter(s => s.summary && !s.summaryEmbedding);
      if (needSummary.length > 0) {
        this.emitStream(job.id, `Embedding ${needSummary.length} summaries...`);
        const embs = await generateEmbeddingsBatch(needSummary.map(s => s.summary), job.id);
        for (let i = 0; i < needSummary.length; i++) {
          needSummary[i].summaryEmbedding = await assetManager.storeEmbedding(embs[i], 'text-embedding-3-small');
        }
        this.emitStream(job.id, `[OK] ${needSummary.length} summaries embedded`);
      }

      const needProse = allScenes.filter(s => s.prose && !s.proseEmbedding);
      if (needProse.length > 0) {
        this.emitStream(job.id, `Embedding ${needProse.length} prose segments...`);
        const proseEmbs = await generateEmbeddingsBatch(needProse.map(s => s.prose!), job.id);
        for (let i = 0; i < needProse.length; i++) {
          needProse[i].proseEmbedding = await assetManager.storeEmbedding(proseEmbs[i], 'text-embedding-3-small');
        }
        this.emitStream(job.id, `[OK] ${needProse.length} prose segments embedded`);
      }
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results] } });
    } catch (embErr) {
      logWarning('Summary/prose embedding failed (non-fatal)', embErr, { source: 'analysis', operation: 'summary-embed' });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 3: ARCS — group every 4 scenes, name each arc.
    // Skipped in world-only mode: no scenes will land in the narrative, so
    // arc records would be unreferenced.
    // ═════════════════════════════════════════════════════════════════════════
    // Resume: skip if arcGroups already persisted on the job.
    let arcGroups: { name: string; directionVector?: string; worldState?: string; sceneIndices: number[] }[] = job.arcGroups ?? [];
    if (job.extractionMode !== 'world' && arcGroups.length === 0) {
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'arcs' } });

      const sceneSummaries = results
        .map((r, i) => ({ index: i, summary: r?.scenes?.[0]?.summary ?? `Scene ${i + 1}` }))
        .filter((_, i) => results[i] !== null);

      if (sceneSummaries.length > 0) {
        try {
          this.emitStream(job.id, `Arcs: grouping ${sceneSummaries.length} scenes...`);
          arcGroups = await groupScenesIntoArcs(sceneSummaries, (_token, acc) => {
            this.emitStream(job.id, `Arcs: naming...\n${acc}`);
          });
          this.emitStream(job.id, `[OK] ${arcGroups.length} arcs`);
        } catch (err) {
          logWarning('Arc grouping failed (non-fatal)', err, { source: 'analysis', operation: 'arc-grouping' });
          for (let i = 0; i < sceneSummaries.length; i += 4) {
            const slice = sceneSummaries.slice(i, i + 4);
            arcGroups.push({ name: `Arc ${Math.floor(i / 4) + 1}`, sceneIndices: slice.map(s => s.index) });
          }
        }
        // Persist so a later resume skips this phase entirely.
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { arcGroups } });
      }
    } else if (arcGroups.length > 0) {
      this.emitStream(job.id, `Arcs: ${arcGroups.length} groups (resumed from saved state)`);
    }

    if (entry.cancelled) { d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', results: [...results] } }); return; }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 4: RECONCILIATION
    //
    // Resume: a completed reconciliation pass stamps `reconciledAt` onto the
    // job. On resume we skip — the canonical entity merges live in `results`
    // and re-running the LLM would only re-confirm what's already there.
    // ═════════════════════════════════════════════════════════════════════════
    if (!job.reconciledAt) {
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'reconciliation', currentChunkIndex: total } });
      this.emitStream(job.id, 'Reconciling entities...');

      try {
        const raw = results.filter((r): r is AnalysisChunkResult => r !== null);
        const reconciled = await reconcileResults(raw, (_token, acc) => { this.emitStream(job.id, `Reconciling...\n${acc}`); });

        if (entry.cancelled) { d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused' } }); return; }

        let ri = 0;
        for (let i = 0; i < results.length; i++) { if (results[i] !== null) results[i] = reconciled[ri++]; }
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results], reconciledAt: Date.now() } });
      } catch (err) {
        logWarning('Reconciliation failed (non-fatal)', err, { source: 'analysis', operation: 'reconciliation' });
        this.emitStream(job.id, 'Reconciliation failed (non-fatal), using raw results...');
      }
    } else {
      this.emitStream(job.id, 'Reconciliation: already complete (resumed)');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 5: FINALIZATION — fate re-extraction + thread dependencies
    //
    // First-pass structure extraction is parallel and local-only — each scene
    // scores its threadDeltas without knowledge of eventual outcomes, so late
    // reversals never shift early priors. Here we re-score every scene using
    // summaries (fast, cheap) + the canonical thread list + the observed
    // winner per thread, so the trajectory reflects the story's actual shape.
    //
    // Skipped in world-only mode: there will be no scene timeline to score
    // and no thread-dependency graph to walk — the seed commit just carries
    // the canonical thread list.
    // ═════════════════════════════════════════════════════════════════════════
    let threadDependencies: Record<string, string[]> = job.threadDependencies ?? {};
    if (job.extractionMode !== 'world') {
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'finalization' } });

      // ── 5a. Fate re-extract ────────────────────────────────────────────────
      // Resume: skip when fateReextractedAt is set. The per-scene re-priced
      // threadDeltas already live in `results`.
      if (!job.fateReextractedAt) {
        try {
          const completed = results.filter((r): r is AnalysisChunkResult => r !== null);
          const canonicalDescs = new Set(completed.flatMap(r => (r.threads ?? []).map(t => t.description)));
          if (canonicalDescs.size > 0) {
            entry.chunkStreams.clear();
            this.emitStream(job.id, `Fate re-extract: ${completed.length} scenes × ${canonicalDescs.size} threads...`);
            const reextracted = await reextractFateWithLifecycle(completed, {
              onProgress: (done, total) => {
                this.emitStream(job.id, `Fate re-extract: ${done}/${total}`);
              },
              onSceneStream: (sceneIdx, acc) => {
                entry.chunkStreams.set(sceneIdx, acc);
                this.emitChunkStream(job.id, sceneIdx, acc);
              },
              onSceneStart: (sceneIdx) => {
                entry.inFlightIndices.add(sceneIdx);
                this.emitInFlight(job.id, [...entry.inFlightIndices]);
              },
              onSceneEnd: (sceneIdx) => {
                entry.inFlightIndices.delete(sceneIdx);
                this.emitInFlight(job.id, [...entry.inFlightIndices]);
              },
              cancelled: () => entry.cancelled,
            });
            let ri = 0;
            for (let i = 0; i < results.length; i++) {
              if (results[i] !== null) results[i] = reextracted[ri++];
            }
            d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results], fateReextractedAt: Date.now() } });
            this.emitStream(job.id, `[OK] Fate re-extracted`);
          } else {
            d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { fateReextractedAt: Date.now() } });
          }
          if (entry.cancelled) { d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused' } }); return; }
        } catch (err) {
          logWarning('Fate re-extract failed (non-fatal)', err, { source: 'analysis', operation: 'fate-reextract' });
        }
      } else {
        this.emitStream(job.id, 'Fate re-extract: already complete (resumed)');
      }

      // ── 5b. Thread dependencies ──────────────────────────────────────────
      // Resume: skip when threadDependencies already on the job.
      const hasDeps = Object.keys(threadDependencies).length > 0;
      try {
        if (!hasDeps) {
          const completed = results.filter((r): r is AnalysisChunkResult => r !== null);
          const threads = [...new Set(completed.flatMap(r => (r.threads ?? []).map(t => t.description)))];
          if (threads.length >= 2) {
            this.emitStream(job.id, 'Finalizing thread dependencies...');
            threadDependencies = await analyzeThreading(threads, (_token, acc) => { this.emitStream(job.id, `Finalizing...\n${acc}`); });
          }
          // Persist the thread-dependency map onto the job. Once stored, a
          // later regeneration (after the narrative is deleted) can run
          // assembly without re-calling the threading LLM.
          d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { threadDependencies } });
        } else {
          this.emitStream(job.id, 'Thread dependencies: already complete (resumed)');
        }
        if (entry.cancelled) { d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused' } }); return; }
      } catch (err) {
        logWarning('Finalization failed (non-fatal)', err, { source: 'analysis', operation: 'finalization' });
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 6: ASSEMBLY — build NarrativeState
    //
    // Assembly emits its two LLM-driven outputs (per-WorldBuild intent
    // summaries, whole-work meta) via callbacks AS they resolve. The
    // runner persists each output onto the analysis job. Once they're
    // there, a later regeneration can pass them straight back in and
    // assembly stays purely deterministic — no LLM round-trips.
    // ═════════════════════════════════════════════════════════════════════════
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'assembly' } });
    this.emitStream(job.id, 'Assembling narrative...');

    try {
      const completed = results.filter((r): r is AnalysisChunkResult => r !== null);
      // Extension runs skip world-defining phases — genre, prose profile,
      // image style, patterns, and narrative-level summaries belong to
      // the seed world, not to the slice that extends it. Passing empty
      // objects for `meta` and `worldBuildSummaries` short-circuits the
      // LLM calls (the presence check in assembleNarrative is truthy on
      // {}, the lookups fall through to fallbacks).
      const isExtension = job.kind === 'extend';
      const narrative = await assembleNarrative(job.title, completed, threadDependencies, {
        onToken: (_token, acc) => {
          this.emitStream(job.id, `Assembling...\n${acc}`);
        },
        onStage: (stage, current, total) => {
          // Surface the two LLM-bearing assemble-stages as their own
          // job-level phases so the analysis sidebar shows them as
          // distinct steps in the pipeline (rather than hiding both
          // inside a single "assembly" label). Each carries an
          // emitStream so the right-column stream pane shows progress
          // rather than going blank between phases.
          if (stage === 'summaries') {
            d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'summaries' } });
            if (current !== undefined && total !== undefined && total > 0) {
              this.emitStream(job.id, `Summarising world commits: ${current}/${total}`);
            } else {
              this.emitStream(job.id, 'Summarising world commits...');
            }
          } else if (stage === 'meta') {
            d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'meta' } });
            this.emitStream(job.id, 'Extracting style, prose profile, and patterns...');
          } else if (stage === 'finalize') {
            d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'assembly' } });
            this.emitStream(job.id, 'Stitching final narrative...');
          }
        },
        arcGroups,
        extractionMode: job.extractionMode ?? 'full',
        worldBuildSummaries: isExtension ? {} : job.worldBuildSummaries,
        meta: isExtension ? {} : job.meta,
        onWorldBuildSummariesResolved: (summaries) => {
          if (isExtension) return;
          d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { worldBuildSummaries: summaries } });
        },
        onMetaResolved: (meta) => {
          if (isExtension) return;
          d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { meta } });
        },
      });

      // ═════════════════════════════════════════════════════════════════════
      // Phase 7 (opt-in): GAME THEORY — per-scene strategic decomposition.
      //
      // Runs the BeatGame analyser on every assembled scene in parallel
      // (capped to GAME_CONCURRENCY). Scene structure is the canonical
      // input — no plan / prose dependency — so this can run whether or
      // not Plans were extracted earlier. Output is mutated onto the
      // assembled narrative's scenes in-place; if the analyser fails on
      // an individual scene, the scene is left with no gameAnalysis
      // (non-fatal — log and continue).
      // ═════════════════════════════════════════════════════════════════════
      if (job.runGameTheoryExtraction) {
        const scenes = Object.values(narrative.scenes ?? {}).filter(
          (s): s is Scene => s?.kind === 'scene',
        );
        if (scenes.length > 0) {
          d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'game-theory' } });
          this.emitStream(job.id, `Decomposing game theory: ${scenes.length} scenes...`);
          let done = 0;
          await runParallel(
            scenes.map((_, i) => i),
            async (idx) => {
              const scene = scenes[idx];
              try {
                const analysis = await generateSceneGameAnalysis(narrative, scene);
                scene.gameAnalysis = analysis;
              } catch (err) {
                logWarning('Game-theory analysis failed for scene (non-fatal)', err, {
                  source: 'analysis',
                  operation: 'game-theory',
                  details: { sceneId: scene.id },
                });
              } finally {
                done += 1;
                this.emitStream(job.id, `Decomposing game theory: ${done}/${scenes.length}`);
              }
            },
            'game-theory',
          );
          this.emitStream(job.id, `[OK] Game theory: ${done}/${scenes.length} scenes`);
          if (entry.cancelled) {
            d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused' } });
            return;
          }
        }
      }

      if (job.kind === 'extend' && job.targetNarrativeId && job.fileId) {
        // World-scoped extension run. Don't add a new narrative — park
        // the assembled slice on the linked SourceFile (status → ready).
        // The job itself stays in state.analysisJobs so it remains
        // viewable in the /extensions route; the /analysis route filters
        // these out so they don't clutter the main creation queue.
        try {
          const extractedRef = await assetManager.storeText(
            JSON.stringify(narrative),
            undefined,
            job.targetNarrativeId,
          );
          d({
            type: 'UPDATE_SOURCE_FILE',
            narrativeId: job.targetNarrativeId,
            fileId: job.fileId,
            updates: { status: 'ready', extractedRef, error: undefined },
          });
          d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'completed' } });
          logInfo('Extension conversion completed', { source: 'analysis', operation: 'extension-complete', details: {
            jobId: job.id, narrativeId: job.targetNarrativeId, fileId: job.fileId,
            scenes: Object.keys(narrative.scenes).length,
          } });
        } catch (err) {
          logError('Extension result storage failed', err, { source: 'analysis', operation: 'extension-store', details: { jobId: job.id, fileId: job.fileId } });
          d({
            type: 'UPDATE_SOURCE_FILE',
            narrativeId: job.targetNarrativeId,
            fileId: job.fileId,
            updates: { status: 'failed', error: err instanceof Error ? err.message : String(err) },
          });
          d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: err instanceof Error ? err.message : String(err) } });
        }
      } else {
        // Stamp the source corpus as the narrative's creation file. The
        // raw text goes into the assets DB so the narrative JSON stays
        // small; the metadata sits on narrative.files and powers the
        // Files sidebar.
        const stampedNarrative = await attachCreationFile(narrative, job);

        d({ type: 'ADD_NARRATIVE', narrative: stampedNarrative });
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'completed', narrativeId: stampedNarrative.id } });

        logInfo('Analysis completed', { source: 'analysis', operation: 'job-complete', details: {
          jobId: job.id, narrativeId: stampedNarrative.id, title: job.title,
          scenes: Object.keys(stampedNarrative.scenes).length, characters: Object.keys(stampedNarrative.characters).length,
        } });
      }
    } catch (err) {
      logError('Assembly failed', err, { source: 'analysis', operation: 'assembly', details: { jobId: job.id } });
      const message = err instanceof Error ? err.message : String(err);
      if (job.kind === 'extend' && job.targetNarrativeId && job.fileId) {
        d({
          type: 'UPDATE_SOURCE_FILE',
          narrativeId: job.targetNarrativeId,
          fileId: job.fileId,
          updates: { status: 'failed', error: message },
        });
      }
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: message } });
    }
  }

  // ── Emit helpers ───────────────────────────────────────────────────────────

  private emitStream(jobId: string, text: string) {
    this.streamTexts.set(jobId, text);
    for (const listener of this.streamListeners) listener(jobId, text);
  }

  private emitChunkStream(jobId: string, chunkIndex: number, text: string) {
    for (const listener of this.chunkStreamListeners) listener(jobId, chunkIndex, text);
  }

  private emitInFlight(jobId: string, indices: number[]) {
    for (const listener of this.inFlightListeners) listener(jobId, indices);
  }

  private emitPlanStream(jobId: string, key: string, text: string) {
    for (const listener of this.planStreamListeners) listener(jobId, key, text);
  }

  private emitPlanInFlight(jobId: string, keys: string[]) {
    for (const listener of this.planInFlightListeners) listener(jobId, keys);
  }

  private cleanup(jobId: string) {
    this.running.delete(jobId);
    this.streamTexts.delete(jobId);
  }
}

/** Singleton instance */
export const analysisRunner = new AnalysisRunner();
