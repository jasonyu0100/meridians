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
import {
  splitCorpusIntoScenes,
  reconcileEntities,
  reconcileSemantic,
  integrateSliceThreadsIntoExisting,
} from '@/lib/text-analysis';
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
  options: { source?: 'analysis' | 'daily-log' } = {},
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
    ...(options.source ? { source: options.source } : {}),
  };
  dispatch({ type: 'ADD_SOURCE_FILE', narrativeId: narrative.id, file });
  return file;
}

/** Options that mirror the /analysis NewJobSetup form. Both are
 *  preserved on the AnalysisJob so resume / retry sees the same shape. */
export type ConvertFileOptions = {
  /** 'full' = world commits + scenes + arcs (default).
   *  'world' = per-batch world commits only — knowledge injection without
   *  adding new scenes to a branch. */
  extractionMode?: 'world' | 'full';
  /** Opt-in beat plan extraction (Phase 2). When true, plans run and
   *  embeddings index beats + propositions for vector search / RAG.
   *  Default false. */
  runPlanExtraction?: boolean;
  /** Opt-in per-scene game-theory decomposition pass. Default false. */
  runGameTheoryExtraction?: boolean;
};

/** Kick off the conversion pipeline for a staged or failed file.
 *  Constructs an `AnalysisJob` tagged with kind='extend' so the runner
 *  routes the result back onto the SourceFile instead of creating a new
 *  narrative, flips the file to status='converting', and starts the run.
 *  Returns the job id for callers that want to subscribe to progress. */
export async function convertFile(
  narrative: NarrativeState,
  file: SourceFile,
  dispatch: Dispatch,
  options: ConvertFileOptions = {},
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

  const extractionMode = options.extractionMode ?? 'full';
  // Both specialty passes only fire on 'full' mode (world-only drops
  // scenes — no scenes → no plans, no games). The runner's checkbox is
  // the operator's source of truth; world-only short-circuits both
  // here so the runner doesn't waste an LLM phase on doomed scenes.
  const runPlanExtraction = extractionMode === 'full' && options.runPlanExtraction === true;
  const runGameTheoryExtraction = extractionMode === 'full' && options.runGameTheoryExtraction === true;

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
    // Only stamp the override when non-default — keeps job shape minimal
    // and matches NewJobSetup's spread pattern on /analysis.
    ...(extractionMode === 'world' && { extractionMode: 'world' as const }),
    ...(runPlanExtraction && { runPlanExtraction: true }),
    ...(runGameTheoryExtraction && { runGameTheoryExtraction: true }),
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

// ── Cross-reconciliation ─────────────────────────────────────────────────────
//
// Secondary reconciliation pass that runs at Apply time. The slice was
// already internally reconciled during convert (Phase 3a/3b/3c inside
// assembleNarrative) — its own "Harry" and "Harry Potter" already
// collapsed. But the slice has no idea that "Harry Potter" matches the
// existing narrative's `C-HP-1` character. This step asks the LLM the
// cross-question, with the existing narrative anchored as canonical.

/** Per-category slice-to-existing name maps. Keyed by the slice's
 *  canonical name; value is the existing entity's canonical name. A
 *  slice entity that doesn't appear in the map is genuinely new. */
export type ExtensionMergePlan = {
  /** Slice character canonical name → existing character canonical name. */
  characters: Map<string, string>;
  /** Slice location canonical name → existing location canonical name. */
  locations: Map<string, string>;
  /** Slice artifact canonical name → existing artifact canonical name. */
  artifacts: Map<string, string>;
  /** Slice thread description → existing thread description. */
  threads: Map<string, string>;
  /** Slice system concept → existing system concept. */
  systemConcepts: Map<string, string>;
};

const EMPTY_MERGE_PLAN: ExtensionMergePlan = {
  characters: new Map(),
  locations: new Map(),
  artifacts: new Map(),
  threads: new Map(),
  systemConcepts: new Map(),
};

/** Build a {slice-name → existing-name} map from the LLM's merge output.
 *  The LLM returns `{variant → canonical}` over a combined list (existing
 *  + slice). The narrative is the source of truth: we only ever fold
 *  slice entities INTO existing ones, never the reverse. So filter:
 *    - variant=slice, canonical=existing  → keep (the merge we want)
 *    - variant=existing, canonical=slice  → INVERT (existing stays canonical)
 *    - variant=existing, canonical=existing → drop (existing-vs-existing
 *      merges are out of scope; the narrative's records are already
 *      reconciled by their original analysis run)
 *    - variant=slice, canonical=slice → drop (the slice was already
 *      internally reconciled at convert time)
 *
 *  Returns a clean Map<sliceName, existingName>. */
function buildSliceToExistingMap(
  llmMergeMap: Record<string, string>,
  existingNames: Set<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [variant, canonical] of Object.entries(llmMergeMap)) {
    const variantIsExisting = existingNames.has(variant);
    const canonicalIsExisting = existingNames.has(canonical);
    if (variantIsExisting === canonicalIsExisting) continue; // both-existing or both-slice
    if (variantIsExisting) {
      // LLM picked the slice name as canonical — invert so existing stays
      // the anchor. The slice's `canonical` name becomes the merge target,
      // mapped onto the existing `variant` name.
      out.set(canonical, variant);
    } else {
      // Standard direction: slice variant folds into existing canonical.
      out.set(variant, canonical);
    }
  }
  return out;
}

/** Run cross-reconciliation between an extracted slice and the target
 *  narrative. Returns a merge plan whose maps the Apply step consults
 *  when claiming ids: slice entities present in the plan dedup onto the
 *  existing entity's id; entities absent from the plan are net-new.
 *
 *  When `source === 'daily-log'` the reconcile adds a corrective
 *  thread-alignment phase (continuation-first stance) after standard
 *  reconcile. Daily ingest is statistically dominated by continuations
 *  of existing markets; reconcileSemantic's preserve-by-default would
 *  otherwise produce a parallel thread for every paraphrased
 *  continuation. The alignment pass picks up exactly that
 *  population — slice threads that survived reconcile as net-new —
 *  and folds them into existing threads when continuity is plausible. */
export async function reconcileExtensionAgainstNarrative(
  narrative: NarrativeState,
  slice: NarrativeState,
  onToken?: (token: string, accumulated: string) => void,
  options: { source?: 'analysis' | 'daily-log' } = {},
): Promise<ExtensionMergePlan> {
  const source = options.source ?? 'analysis';
  // ── Collect names from both sides ──────────────────────────────────────
  const existingCharNames = new Set(Object.values(narrative.characters).map((c) => c.name));
  const existingLocNames = new Set(Object.values(narrative.locations).map((l) => l.name));
  const existingArtNames = new Set(Object.values(narrative.artifacts ?? {}).map((a) => a.name));
  const existingThreadDescs = new Set(Object.values(narrative.threads).map((t) => t.description));
  const existingSysConcepts = new Set(
    Object.values(narrative.systemGraph?.nodes ?? {}).map((n) => n.concept),
  );

  const sliceCharNames = Object.values(slice.characters).map((c) => c.name);
  const sliceLocNames = Object.values(slice.locations).map((l) => l.name);
  const sliceArtNames = Object.values(slice.artifacts ?? {}).map((a) => a.name);
  const sliceThreadDescs = Object.values(slice.threads).map((t) => t.description);
  const sliceSysConcepts = Object.values(slice.systemGraph?.nodes ?? {}).map((n) => n.concept);

  // If the slice has nothing in a category, skip that category — the
  // underlying prompt handles empty inputs but there's no point paying
  // an LLM round-trip for nothing.
  const hasEntityWork =
    sliceCharNames.length > 0 || sliceLocNames.length > 0 || sliceArtNames.length > 0;
  const hasSemanticWork = sliceThreadDescs.length > 0 || sliceSysConcepts.length > 0;
  if (!hasEntityWork && !hasSemanticWork) return EMPTY_MERGE_PLAN;

  // Combined name sets — existing first, slice second. The reconcile
  // prompts treat all inputs symmetrically (they don't know existing
  // from slice); the source-of-truth filter happens in
  // buildSliceToExistingMap after the LLM returns.
  const combinedChars = new Set<string>([...existingCharNames, ...sliceCharNames]);
  const combinedLocs = new Set<string>([...existingLocNames, ...sliceLocNames]);
  const combinedArts = new Set<string>([...existingArtNames, ...sliceArtNames]);
  const combinedThreads = new Set<string>([...existingThreadDescs, ...sliceThreadDescs]);
  const combinedSys = new Set<string>([...existingSysConcepts, ...sliceSysConcepts]);

  let phaseLog = '';
  const phaseStream = (tag: string) =>
    onToken
      ? (token: string, accumulated: string) => onToken(token, `${phaseLog}[${tag}]\n${accumulated}`)
      : undefined;

  // Run the integration phases in sequence. Each phase emits a labelled
  // boundary in the streaming log so the operator can see exactly which
  // step is in flight; the labels match the five-phase model documented
  // in the module header.
  const entityMerges = hasEntityWork
    ? await reconcileEntities(combinedChars, combinedLocs, combinedArts, phaseStream('I. Entity alignment'))
    : { characterMerges: {}, locationMerges: {}, artifactMerges: {} };
  phaseLog = '[I. Entity alignment] done\n\n';

  const semanticMerges = hasSemanticWork
    ? await reconcileSemantic(combinedThreads, combinedSys, phaseStream('II. System alignment'))
    : { threadMerges: {}, systemMerges: {} };
  phaseLog = `${phaseLog}[II. System alignment] done\n\n`;

  const threadMap = buildSliceToExistingMap(semanticMerges.threadMerges, existingThreadDescs);

  // ── Phase III (daily-log only): thread integration ────────────────────
  // Pick up slice threads that reconcileSemantic preserved as net-new
  // (description didn't match an existing one) and ask the LLM whether
  // any of them materially advance an existing open thread. Augments
  // the threads map with the additional continuations before commit.
  // Outcome and participant expansion (Phase III.b) happens later, in
  // the claim phase, where we have access to both the slice and
  // existing thread records.
  if (source === 'daily-log') {
    const existingOpenThreads = Object.values(narrative.threads).filter((t) => !t.closedAt);
    const candidateSliceThreads = Object.values(slice.threads).filter(
      (t) => !threadMap.has(t.description),
    );

    if (candidateSliceThreads.length > 0 && existingOpenThreads.length > 0) {
      const participantNamesFor = (
        participants: ReadonlyArray<{ id: string; type: 'character' | 'location' | 'artifact' }>,
        scope: NarrativeState,
      ): string | undefined => {
        if (!participants || participants.length === 0) return undefined;
        const names: string[] = [];
        for (const p of participants) {
          const name =
            scope.characters[p.id]?.name ??
            scope.locations[p.id]?.name ??
            scope.artifacts?.[p.id]?.name;
          if (name) names.push(name);
          if (names.length >= 4) break;
        }
        return names.length > 0 ? names.join(', ') : undefined;
      };
      const sliceForAlignment = candidateSliceThreads.map((t) => ({
        description: t.description,
        participantSummary: participantNamesFor(t.participants, slice),
        outcomes: t.outcomes,
      }));
      const existingForAlignment = existingOpenThreads.map((t) => ({
        description: t.description,
        participantSummary: participantNamesFor(t.participants, narrative),
        outcomes: t.outcomes,
      }));
      const continuations: Record<string, string> = await integrateSliceThreadsIntoExisting(
        sliceForAlignment,
        existingForAlignment,
        phaseStream('III. Thread integration'),
      );
      // Fold continuation merges into the threads map. Existing
      // matches win — if reconcile already mapped this slice
      // description, alignment shouldn't see it (we filtered above),
      // but guard anyway in case the LLM hallucinates.
      for (const [sliceDesc, existingDesc] of Object.entries(continuations)) {
        if (!threadMap.has(sliceDesc) && existingThreadDescs.has(existingDesc)) {
          threadMap.set(sliceDesc, existingDesc);
        }
      }
    }
  }

  return {
    characters: buildSliceToExistingMap(entityMerges.characterMerges, existingCharNames),
    locations: buildSliceToExistingMap(entityMerges.locationMerges, existingLocNames),
    artifacts: buildSliceToExistingMap(entityMerges.artifactMerges, existingArtNames),
    threads: threadMap,
    systemConcepts: buildSliceToExistingMap(semanticMerges.systemMerges, existingSysConcepts),
  };
}

// ── Apply ────────────────────────────────────────────────────────────────────
// Two phases: `prepareExtensionApply` reconciles the slice against the
// target (LLM call, returns a merge plan + summary). `commitPreparedApply`
// rewrites every id in the slice through the plan + minters and dispatches
// APPLY_EXTENSION. Apply is repeatable: each invocation appends a fresh
// slice with newly-minted ids — files are narrative-wide artifacts, not a
// per-branch ledger.

/** Mint a fresh `<prefix>-<n>` id not in `taken`, walking up from n=1
 *  until a free slot is found. Used as a last-resort minter when no
 *  prefix-+-counter context exists (e.g. K-node ids in slices). */
function mintFreshId(prefix: string, taken: Set<string>): string {
  let n = 1;
  while (true) {
    const candidate = `${prefix}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
    n++;
  }
}

/** Mint a fresh world-graph node id ("K-<n>") not in `taken`. */
function mintFreshK(taken: Set<string>): string {
  return mintFreshId('K', taken);
}

/** Per-category counter that mints the next id in the narrative's own
 *  prefix style. Analysis-generated ids look like `<KIND>-<WORK_PREFIX>-<n>`
 *  (e.g. `C-USP-7`); extension applies should continue that counter so a
 *  new character lands as `C-USP-8`, not a context-free `C-1`. The minter
 *  scans existing ids for the highest counter under the dominant prefix
 *  and walks forward from there. */
class PrefixedIdMinter {
  /** The string between the kind tag and the counter — e.g. "USP" for
   *  `C-USP-7`. Empty when the narrative has no existing entities of
   *  this kind; in that case ids are minted bare ("C-1", "C-2", …). */
  private readonly workPrefix: string;
  private nextN: number;
  constructor(kindTag: string, existingIds: Iterable<string>) {
    let highest = 0;
    let chosenPrefix = '';
    const exact = new RegExp(`^${kindTag}-(\\d+)$`);
    const prefixed = new RegExp(`^${kindTag}-([A-Z]+)-(\\d+)$`);
    for (const id of existingIds) {
      let m = id.match(prefixed);
      if (m) {
        // The dominant work prefix is whichever appears most often in
        // existing ids; in practice all of a narrative's ids share one.
        if (!chosenPrefix) chosenPrefix = m[1];
        if (m[1] === chosenPrefix) {
          const n = parseInt(m[2], 10);
          if (n > highest) highest = n;
        }
        continue;
      }
      m = id.match(exact);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > highest) highest = n;
      }
    }
    this.workPrefix = chosenPrefix;
    this.nextN = highest + 1;
  }

  /** Mint the next id, skipping any that already appear in `taken`. */
  mint(kindTag: string, taken: Set<string>): string {
    while (true) {
      const n = this.nextN++;
      const candidate = this.workPrefix
        ? `${kindTag}-${this.workPrefix}-${n}`
        : `${kindTag}-${n}`;
      if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
  }
}

type RemapMaps = {
  char: Map<string, string>;
  loc: Map<string, string>;
  art: Map<string, string>;
  thread: Map<string, string>;
  scene: Map<string, string>;
  worldBuild: Map<string, string>;
  arc: Map<string, string>;
  /** World-graph node ids (the "K-…" namespace) — kept globally rather
   *  than per-entity since the canonical analysis pipeline allocates from
   *  one pool. */
  k: Map<string, string>;
  /** System-graph node ids (SYS-…). */
  sys: Map<string, string>;
};

type TakenSets = {
  char: Set<string>;
  loc: Set<string>;
  art: Set<string>;
  thread: Set<string>;
  scene: Set<string>;
  worldBuild: Set<string>;
  arc: Set<string>;
  k: Set<string>;
  sys: Set<string>;
};

function buildTaken(n: NarrativeState): TakenSets {
  const charK: string[] = [];
  for (const c of Object.values(n.characters)) charK.push(...Object.keys(c.world?.nodes ?? {}));
  for (const l of Object.values(n.locations)) charK.push(...Object.keys(l.world?.nodes ?? {}));
  for (const a of Object.values(n.artifacts ?? {})) charK.push(...Object.keys(a.world?.nodes ?? {}));
  return {
    char: new Set(Object.keys(n.characters)),
    loc: new Set(Object.keys(n.locations)),
    art: new Set(Object.keys(n.artifacts ?? {})),
    thread: new Set(Object.keys(n.threads)),
    scene: new Set(Object.keys(n.scenes)),
    worldBuild: new Set(Object.keys(n.worldBuilds ?? {})),
    arc: new Set(Object.keys(n.arcs)),
    k: new Set(charK),
    sys: new Set(Object.keys(n.systemGraph?.nodes ?? {})),
  };
}

const PREFIX = {
  char: 'C',
  loc: 'L',
  art: 'A',
  thread: 'T',
  scene: 'S',
  worldBuild: 'WB',
  arc: 'ARC',
  k: 'K',
  sys: 'SYS',
} as const;

function remap(id: string | undefined, map: Map<string, string>): string {
  if (!id) return id ?? '';
  return map.get(id) ?? id;
}

function remapAny(id: string | undefined, ...maps: Map<string, string>[]): string {
  if (!id) return id ?? '';
  for (const m of maps) if (m.has(id)) return m.get(id)!;
  return id;
}

/** Walk a slice's world graph (entity inner graph) and remap node ids
 *  through the global `k` map, minting fresh ids for any nodes the map
 *  doesn't yet cover (the slice's own internal node id namespace). */
type WorldGraphLike = {
  nodes: Record<string, { id: string; content: string; type: string }>;
  edges: { from: string; to: string; relation: string }[];
};
function remapWorldGraph(
  world: WorldGraphLike | undefined,
  maps: RemapMaps,
  taken: TakenSets,
): WorldGraphLike {
  if (!world) return { nodes: {}, edges: [] };
  for (const oldId of Object.keys(world.nodes)) {
    if (!maps.k.has(oldId)) {
      const fresh = taken.k.has(oldId) ? mintFreshK(taken.k) : (taken.k.add(oldId), oldId);
      maps.k.set(oldId, fresh);
    }
  }
  const nodes: Record<string, { id: string; content: string; type: string }> = {};
  for (const [oldId, node] of Object.entries(world.nodes)) {
    const newId = maps.k.get(oldId) ?? oldId;
    nodes[newId] = { ...node, id: newId };
  }
  const edges = world.edges.map((e) => ({
    from: maps.k.get(e.from) ?? e.from,
    to: maps.k.get(e.to) ?? e.to,
    relation: e.relation,
  }));
  return { nodes, edges };
}

export type ApplyResult = {
  /** New entity ids added to the target — used for the SourceFile commit
   *  record so the user can audit what landed. */
  introducedSceneIds: string[];
  introducedArcId: string | null;
};

/** Per-category breakdown of what an Apply will land. Computed during
 *  the prepare phase from the merge plan + slice contents; consumed by
 *  the Apply modal to show the user what's about to happen before
 *  they confirm the commit. */
export type MergeSummary = {
  characters: { merged: { sliceName: string; existingName: string }[]; new: string[] };
  locations: { merged: { sliceName: string; existingName: string }[]; new: string[] };
  artifacts: { merged: { sliceName: string; existingName: string }[]; new: string[] };
  threads: { merged: { sliceDescription: string; existingDescription: string }[]; new: string[] };
  systemConcepts: { merged: { sliceConcept: string; existingConcept: string }[]; new: string[] };
  /** Net-new structural counts — these always land fresh, never merged. */
  scenes: number;
  arcs: number;
  worldBuilds: number;
};

/** Prepared state from the first half of Apply (load + reconcile).
 *  Held by the UI between the streaming reconcile view and the user's
 *  explicit "Append" click, then passed back to `commitPreparedApply`. */
export type PreparedApply = {
  slice: NarrativeState;
  mergePlan: ExtensionMergePlan;
  summary: MergeSummary;
};

/** Phase 1: load the SourceFile's extracted slice from IndexedDB and
 *  cross-reconcile it against the target narrative. Returns everything
 *  the commit phase needs, plus a summary the UI can render. `onToken`
 *  streams the LLM tokens for the live reconciliation panel. */
export async function prepareExtensionApply(
  narrative: NarrativeState,
  file: SourceFile,
  onToken?: (token: string, accumulated: string) => void,
): Promise<PreparedApply> {
  if (!file.extractedRef) {
    throw new Error('No extracted slice on this file — convert it first.');
  }
  const sliceJson = await assetManager.getText(file.extractedRef);
  if (!sliceJson) {
    throw new Error('Extracted slice is missing from local storage.');
  }
  const slice = JSON.parse(sliceJson) as NarrativeState;
  // Daily-log files get the corrective thread-alignment pass after
  // standard reconcile. Other files (manual / analysis-derived) skip
  // it — their threads aren't biased toward continuations.
  const mergePlan = await reconcileExtensionAgainstNarrative(narrative, slice, onToken, {
    source: file.source,
  });
  return { slice, mergePlan, summary: summariseMerge(slice, mergePlan) };
}

/** Build the merge summary the UI renders. Names are the slice's
 *  canonical names; for merges we surface both sides so the user can
 *  audit "Hermione → Hermione Granger" at a glance. */
function summariseMerge(slice: NarrativeState, plan: ExtensionMergePlan): MergeSummary {
  const charMerged: { sliceName: string; existingName: string }[] = [];
  const charNew: string[] = [];
  for (const c of Object.values(slice.characters)) {
    const existing = plan.characters.get(c.name);
    if (existing) charMerged.push({ sliceName: c.name, existingName: existing });
    else charNew.push(c.name);
  }
  const locMerged: { sliceName: string; existingName: string }[] = [];
  const locNew: string[] = [];
  for (const l of Object.values(slice.locations)) {
    const existing = plan.locations.get(l.name);
    if (existing) locMerged.push({ sliceName: l.name, existingName: existing });
    else locNew.push(l.name);
  }
  const artMerged: { sliceName: string; existingName: string }[] = [];
  const artNew: string[] = [];
  for (const a of Object.values(slice.artifacts ?? {})) {
    const existing = plan.artifacts.get(a.name);
    if (existing) artMerged.push({ sliceName: a.name, existingName: existing });
    else artNew.push(a.name);
  }
  const threadMerged: { sliceDescription: string; existingDescription: string }[] = [];
  const threadNew: string[] = [];
  for (const t of Object.values(slice.threads)) {
    const existing = plan.threads.get(t.description);
    if (existing) threadMerged.push({ sliceDescription: t.description, existingDescription: existing });
    else threadNew.push(t.description);
  }
  const sysMerged: { sliceConcept: string; existingConcept: string }[] = [];
  const sysNew: string[] = [];
  for (const n of Object.values(slice.systemGraph?.nodes ?? {})) {
    const existing = plan.systemConcepts.get(n.concept);
    if (existing) sysMerged.push({ sliceConcept: n.concept, existingConcept: existing });
    else sysNew.push(n.concept);
  }
  return {
    characters: { merged: charMerged, new: charNew },
    locations: { merged: locMerged, new: locNew },
    artifacts: { merged: artMerged, new: artNew },
    threads: { merged: threadMerged, new: threadNew },
    systemConcepts: { merged: sysMerged, new: sysNew },
    scenes: Object.keys(slice.scenes).length,
    arcs: Object.keys(slice.arcs).length,
    worldBuilds: Object.keys(slice.worldBuilds ?? {}).length,
  };
}

// ── Per-type remap functions ─────────────────────────────────────────────────
//
// One function per entity / structural type. Each is the SINGLE place
// to update when a new id-bearing field is added to that type — adding
// a field to Scene without updating remapScene will let stale slice
// ids leak through into the target narrative.

import type {
  Arc,
  Character,
  Location,
  Artifact,
  Scene,
  Thread,
  ThreadParticipant,
  WorldBuild,
  WorldExpansion,
} from '@/types/narrative';

type Ctx = { maps: RemapMaps; taken: TakenSets };

function remapCharacter(c: Character, targetId: string, ctx: Ctx): Character {
  return {
    ...c,
    id: targetId,
    threadIds: (c.threadIds ?? []).map((id) => remap(id, ctx.maps.thread)),
    world: remapWorldGraph(c.world as WorldGraphLike | undefined, ctx.maps, ctx.taken) as Character['world'],
  };
}

function remapLocation(l: Location, targetId: string, ctx: Ctx): Location {
  return {
    ...l,
    id: targetId,
    parentId: l.parentId ? remap(l.parentId, ctx.maps.loc) : l.parentId ?? null,
    tiedCharacterIds: (l.tiedCharacterIds ?? []).map((id) => remap(id, ctx.maps.char)),
    threadIds: (l.threadIds ?? []).map((id) => remap(id, ctx.maps.thread)),
    world: remapWorldGraph(l.world as WorldGraphLike | undefined, ctx.maps, ctx.taken) as Location['world'],
  };
}

function remapArtifact(a: Artifact, targetId: string, ctx: Ctx): Artifact {
  return {
    ...a,
    id: targetId,
    parentId: a.parentId ? remapAny(a.parentId, ctx.maps.char, ctx.maps.loc) : a.parentId,
    threadIds: (a.threadIds ?? []).map((id) => remap(id, ctx.maps.thread)),
    world: remapWorldGraph(a.world as WorldGraphLike | undefined, ctx.maps, ctx.taken) as Artifact['world'],
  };
}

function remapThread(t: Thread, targetId: string, ctx: Ctx): Thread {
  return {
    ...t,
    id: targetId,
    participants: t.participants.map((p) => ({
      ...p,
      id: remapAny(p.id, ctx.maps.char, ctx.maps.loc, ctx.maps.art),
    })),
    // openedAt is the introduction key — either a scene or a world-build
    // in the original slice. Without remapping, downstream code
    // (portfolio, trajectory, thread-introduction filters) sees a
    // stale slice-side id and treats the thread as orphaned —
    // trajectory shows "not yet introduced" even when evidence has
    // accumulated. Remap through both scene and worldBuild maps.
    openedAt: t.openedAt
      ? remapAny(t.openedAt, ctx.maps.scene, ctx.maps.worldBuild)
      : t.openedAt,
    // Thread-id refs in `dependents` cross over the slice→target boundary.
    dependents: (t.dependents ?? []).map((id) => remap(id, ctx.maps.thread)),
    // beliefs is keyed by agent id (mostly character ids, plus sentinel
    // narrator keys like "__narrator__" we shouldn't touch).
    stances: Object.fromEntries(
      Object.entries(t.stances ?? {}).map(([agentId, belief]) => [
        ctx.maps.char.get(agentId) ?? agentId,
        {
          ...belief,
          lastTouchedScene: belief.lastTouchedScene
            ? remap(belief.lastTouchedScene, ctx.maps.scene)
            : belief.lastTouchedScene,
        },
      ]),
    ),
    // threadLog node ids are private to the log graph (no slice→target
    // hop). The sceneId backref does cross — remap it.
    threadLog: {
      ...t.threadLog,
      nodes: Object.fromEntries(
        Object.entries(t.threadLog?.nodes ?? {}).map(([nodeId, node]) => [
          nodeId,
          { ...node, sceneId: node.sceneId ? remap(node.sceneId, ctx.maps.scene) : node.sceneId },
        ]),
      ),
    },
  };
}

/** Rewrite an expansion payload — shared between Scene's structural
 *  fields and WorldBuild.expansionManifest. The two carry the same
 *  union of entity intros + deltas, so we share one walker. The
 *  `dropMerged` flag controls whether deduped-into-existing entities
 *  are filtered out of the new* arrays (Scene yes; WorldBuild we keep
 *  the full record since the WB is a self-contained snapshot). */
function remapExpansionFields<T extends Partial<WorldExpansion>>(
  e: T,
  ctx: Ctx,
  netNewIds: { char: Set<string>; loc: Set<string>; art: Set<string>; thread: Set<string> },
  dropMerged = true,
): T {
  const keepChar = (c: Character) => !dropMerged || netNewIds.char.has(c.id);
  const keepLoc = (l: Location) => !dropMerged || netNewIds.loc.has(l.id);
  const keepArt = (a: Artifact) => !dropMerged || netNewIds.art.has(a.id);
  const keepThread = (t: Thread) => !dropMerged || netNewIds.thread.has(t.id);

  return {
    ...e,
    newCharacters: (e.newCharacters ?? [])
      .filter(keepChar)
      .map((c) => remapCharacter(c, remap(c.id, ctx.maps.char), ctx)),
    newLocations: (e.newLocations ?? [])
      .filter(keepLoc)
      .map((l) => remapLocation(l, remap(l.id, ctx.maps.loc), ctx)),
    newArtifacts: (e.newArtifacts ?? [])
      .filter(keepArt)
      .map((a) => remapArtifact(a, remap(a.id, ctx.maps.art), ctx)),
    newThreads: (e.newThreads ?? [])
      .filter(keepThread)
      .map((t) => remapThread(t, remap(t.id, ctx.maps.thread), ctx)),
    threadDeltas: (e.threadDeltas ?? []).map((tm) => ({
      ...tm,
      threadId: remap(tm.threadId, ctx.maps.thread),
    })),
    worldDeltas: (e.worldDeltas ?? []).map((d) => ({
      ...d,
      entityId: remapAny(d.entityId, ctx.maps.char, ctx.maps.loc, ctx.maps.art),
      addedNodes: (d.addedNodes ?? []).map((n) => {
        if (!ctx.maps.k.has(n.id)) {
          const fresh = ctx.taken.k.has(n.id) ? mintFreshK(ctx.taken.k) : (ctx.taken.k.add(n.id), n.id);
          ctx.maps.k.set(n.id, fresh);
        }
        return { ...n, id: ctx.maps.k.get(n.id) ?? n.id };
      }),
    })),
    relationshipDeltas: (e.relationshipDeltas ?? []).map((rm) => ({
      ...rm,
      from: remap(rm.from, ctx.maps.char),
      to: remap(rm.to, ctx.maps.char),
    })),
    ownershipDeltas: (e.ownershipDeltas ?? []).map((om) => ({
      ...om,
      artifactId: remap(om.artifactId, ctx.maps.art),
      fromId: remapAny(om.fromId, ctx.maps.char, ctx.maps.loc),
      toId: remapAny(om.toId, ctx.maps.char, ctx.maps.loc),
    })),
    tieDeltas: (e.tieDeltas ?? []).map((td) => ({
      ...td,
      locationId: remap(td.locationId, ctx.maps.loc),
      characterId: remap(td.characterId, ctx.maps.char),
    })),
    systemDeltas: e.systemDeltas
      ? {
          ...e.systemDeltas,
          addedNodes: (e.systemDeltas.addedNodes ?? []).map((n) => ({
            ...n,
            id: ctx.maps.sys.get(n.id) ?? n.id,
          })),
          addedEdges: (e.systemDeltas.addedEdges ?? []).map((ed) => ({
            ...ed,
            from: ctx.maps.sys.get(ed.from) ?? ed.from,
            to: ctx.maps.sys.get(ed.to) ?? ed.to,
          })),
        }
      : e.systemDeltas,
    attributions: (e.attributions ?? []).map((id) =>
      remapAny(id, ctx.maps.char, ctx.maps.loc, ctx.maps.art, ctx.maps.thread, ctx.maps.sys),
    ),
    attributionEdges: (e.attributionEdges ?? []).map((ed) => ({
      from: remapAny(ed.from, ctx.maps.char, ctx.maps.loc, ctx.maps.art, ctx.maps.thread, ctx.maps.sys),
      to: remapAny(ed.to, ctx.maps.char, ctx.maps.loc, ctx.maps.art, ctx.maps.thread, ctx.maps.sys),
      relation: ed.relation,
    })),
  };
}

function remapScene(
  s: Scene,
  ctx: Ctx,
  netNewIds: { char: Set<string>; loc: Set<string>; art: Set<string>; thread: Set<string> },
): Scene {
  const expansionPayload = remapExpansionFields(s, ctx, netNewIds, true);
  return {
    ...s,
    ...expansionPayload,
    id: remap(s.id, ctx.maps.scene),
    arcId: remap(s.arcId, ctx.maps.arc),
    povId: s.povId ? remap(s.povId, ctx.maps.char) : s.povId,
    locationId: remap(s.locationId, ctx.maps.loc),
    participantIds: s.participantIds.map((id) => remap(id, ctx.maps.char)),
    artifactUsages: (s.artifactUsages ?? []).map((au) => ({
      ...au,
      artifactId: remap(au.artifactId, ctx.maps.art),
      characterId: au.characterId ? remap(au.characterId, ctx.maps.char) : au.characterId,
    })),
    characterMovements: s.characterMovements
      ? Object.fromEntries(
          Object.entries(s.characterMovements).map(([cid, mv]) => [
            remap(cid, ctx.maps.char),
            { ...mv, locationId: remap(mv.locationId, ctx.maps.loc) },
          ]),
        )
      : s.characterMovements,
    // gameAnalysis players reference char/loc/art ids (action names are
    // strings, not ids — no remap needed for outcomes/realized cells).
    gameAnalysis: s.gameAnalysis
      ? {
          ...s.gameAnalysis,
          games: s.gameAnalysis.games.map((g) => ({
            ...g,
            playerAId: remapAny(g.playerAId, ctx.maps.char, ctx.maps.loc, ctx.maps.art),
            playerBId: remapAny(g.playerBId, ctx.maps.char, ctx.maps.loc, ctx.maps.art),
          })),
        }
      : s.gameAnalysis,
  };
}

function remapArc(a: Arc, ctx: Ctx): Arc {
  return {
    ...a,
    id: remap(a.id, ctx.maps.arc),
    sceneIds: a.sceneIds.map((id) => remap(id, ctx.maps.scene)),
    locationIds: a.locationIds.map((id) => remap(id, ctx.maps.loc)),
    activeCharacterIds: a.activeCharacterIds.map((id) => remap(id, ctx.maps.char)),
    initialCharacterLocations: Object.fromEntries(
      Object.entries(a.initialCharacterLocations ?? {}).map(([cid, lid]) => [
        remap(cid, ctx.maps.char),
        remap(lid, ctx.maps.loc),
      ]),
    ),
    develops: (a.develops ?? []).map((id) =>
      remapAny(id, ctx.maps.char, ctx.maps.loc, ctx.maps.art, ctx.maps.thread),
    ),
    // Variables (presentVariables + planningScenarios) are arc-scoped:
    // their ids are unique within the arc only. No cross-arc remap is
    // needed — passing them through verbatim keeps the slice's internal
    // consistency intact.
  };
}

function remapWorldBuild(
  wb: WorldBuild,
  ctx: Ctx,
  netNewIds: { char: Set<string>; loc: Set<string>; art: Set<string>; thread: Set<string> },
): WorldBuild {
  return {
    ...wb,
    id: remap(wb.id, ctx.maps.worldBuild),
    expansionManifest: remapExpansionFields(wb.expansionManifest, ctx, netNewIds, false) as WorldExpansion,
  };
}

// ── commit phases ────────────────────────────────────────────────────────────
//
// commitPreparedApply orchestrates four named phases. Each is small,
// single-purpose, and independently testable. The phases pass an
// explicit ClaimContext / ClaimResult / RewrittenSlice forward — no
// shared mutable state between phases beyond what they explicitly
// hand off.

type Pending<T> = { entity: T; targetId: string };

type ClaimContext = {
  maps: RemapMaps;
  taken: TakenSets;
  minters: Record<'char' | 'loc' | 'art' | 'thread' | 'scene' | 'worldBuild' | 'arc' | 'sys', PrefixedIdMinter>;
  /** Existing canonical name / description → id lookups for each
   *  category. Built once from the narrative; consumed by the claim
   *  phase to resolve merge-plan entries to concrete ids. */
  existing: {
    charIdByName: Map<string, string>;
    locIdByName: Map<string, string>;
    artIdByName: Map<string, string>;
    threadIdByDesc: Map<string, string>;
    sysIdByConcept: Map<string, string>;
  };
};

type ClaimResult = {
  newCharacters: Pending<Character>[];
  newLocations: Pending<Location>[];
  newArtifacts: Pending<Artifact>[];
  newThreads: Pending<Thread>[];
  netNewIds: { char: Set<string>; loc: Set<string>; art: Set<string>; thread: Set<string> };
  /** Phase III.b — outcome + participant expansion. For every slice
   *  thread that merged into an existing thread (either via reconcile
   *  description-match or via the III. thread-integration LLM pass),
   *  record the slice's contributions so the reducer can fold them
   *  into the existing thread on commit. Participants are ALREADY
   *  remapped through ctx.maps; outcomes are case-insensitive-deduped
   *  against the existing list at apply time. */
  threadExpansions: Array<{
    existingThreadId: string;
    addOutcomes: string[];
    addParticipants: ThreadParticipant[];
  }>;
};

type RewrittenSlice = {
  characters: Character[];
  locations: Location[];
  artifacts: Artifact[];
  threads: Thread[];
  scenes: Scene[];
  arcs: Arc[];
  worldBuilds: WorldBuild[];
  appendEntryIds: string[];
  /** Forwarded from ClaimResult.threadExpansions — passed through to
   *  the reducer via APPLY_EXTENSION so existing threads grow their
   *  outcome / participant lists when integrated content contributes
   *  to them. */
  threadExpansions: Array<{
    existingThreadId: string;
    addOutcomes: string[];
    addParticipants: ThreadParticipant[];
  }>;
};

/** Phase 2a: build the shared claim context — taken-id sets, empty
 *  remap maps, prefix-aware minters, and existing-name indexes. Pure
 *  function of the target narrative. */
function buildClaimContext(narrative: NarrativeState): ClaimContext {
  const taken = buildTaken(narrative);
  const maps: RemapMaps = {
    char: new Map(),
    loc: new Map(),
    art: new Map(),
    thread: new Map(),
    scene: new Map(),
    worldBuild: new Map(),
    arc: new Map(),
    k: new Map(),
    sys: new Map(),
  };
  const minters = {
    char: new PrefixedIdMinter(PREFIX.char, taken.char),
    loc: new PrefixedIdMinter(PREFIX.loc, taken.loc),
    art: new PrefixedIdMinter(PREFIX.art, taken.art),
    thread: new PrefixedIdMinter(PREFIX.thread, taken.thread),
    scene: new PrefixedIdMinter(PREFIX.scene, taken.scene),
    worldBuild: new PrefixedIdMinter(PREFIX.worldBuild, taken.worldBuild),
    arc: new PrefixedIdMinter(PREFIX.arc, taken.arc),
    sys: new PrefixedIdMinter(PREFIX.sys, taken.sys),
  };
  const existing = {
    charIdByName: new Map<string, string>(),
    locIdByName: new Map<string, string>(),
    artIdByName: new Map<string, string>(),
    threadIdByDesc: new Map<string, string>(),
    sysIdByConcept: new Map<string, string>(),
  };
  for (const c of Object.values(narrative.characters)) existing.charIdByName.set(c.name, c.id);
  for (const l of Object.values(narrative.locations)) existing.locIdByName.set(l.name, l.id);
  for (const a of Object.values(narrative.artifacts ?? {})) existing.artIdByName.set(a.name, a.id);
  for (const t of Object.values(narrative.threads)) existing.threadIdByDesc.set(t.description, t.id);
  for (const [id, node] of Object.entries(narrative.systemGraph?.nodes ?? {})) {
    existing.sysIdByConcept.set(node.concept, id);
  }
  return { maps, taken, minters, existing };
}

/** Phase 2b: walk every slice id (entities, scenes, arcs, worldBuilds,
 *  system nodes) and populate the maps. For named entities (chars,
 *  locs, arts, threads) and system concepts the merge plan decides
 *  dedup-to-existing vs mint-fresh; for scenes/arcs/worldBuilds every
 *  slice id mints onto the narrative's counter. Returns the pending
 *  entity records (those that need to be added to the target) and the
 *  net-new id sets used by the scene rewrite to drop redundant
 *  newCharacters entries. */
function claimSliceIds(
  slice: NarrativeState,
  mergePlan: ExtensionMergePlan,
  ctx: ClaimContext,
  /** Existing narrative — needed to read the target thread's current
   *  outcomes and participants when computing Phase III.b expansion
   *  records on a merge. */
  narrative: NarrativeState,
): ClaimResult {
  /** Consult the merge plan first; if it resolves the slice key to an
   *  existing id, dedup. Otherwise mint under the narrative's prefix. */
  function claim<T extends { id: string }>(
    entity: T,
    sliceKey: string | undefined,
    mergeToExisting: Map<string, string>,
    existingIdByKey: Map<string, string>,
    kind: 'char' | 'loc' | 'art' | 'thread',
  ): { id: string; fresh: boolean } {
    const key = (sliceKey ?? '').trim();
    if (key) {
      const existingName = mergeToExisting.get(key);
      const existingId = existingName ? existingIdByKey.get(existingName) : undefined;
      if (existingId) {
        ctx.maps[kind].set(entity.id, existingId);
        return { id: existingId, fresh: false };
      }
    }
    const id = ctx.minters[kind].mint(PREFIX[kind], ctx.taken[kind]);
    ctx.maps[kind].set(entity.id, id);
    return { id, fresh: true };
  }

  const newCharacters: Pending<Character>[] = [];
  const newLocations: Pending<Location>[] = [];
  const newArtifacts: Pending<Artifact>[] = [];
  const newThreads: Pending<Thread>[] = [];

  for (const c of Object.values(slice.characters)) {
    const { id, fresh } = claim(c, c.name, mergePlan.characters, ctx.existing.charIdByName, 'char');
    if (fresh) newCharacters.push({ entity: c, targetId: id });
  }
  for (const l of Object.values(slice.locations)) {
    const { id, fresh } = claim(l, l.name, mergePlan.locations, ctx.existing.locIdByName, 'loc');
    if (fresh) newLocations.push({ entity: l, targetId: id });
  }
  for (const a of Object.values(slice.artifacts ?? {})) {
    const { id, fresh } = claim(a, a.name, mergePlan.artifacts, ctx.existing.artIdByName, 'art');
    if (fresh) newArtifacts.push({ entity: a, targetId: id });
  }
  // Track which existing thread ids absorbed merges from the slice —
  // we'll compute their outcome / participant expansions in a second
  // pass below, after every slice id is mapped (so remapping a slice
  // participant id to an existing entity id works for chars / locs /
  // arts that were also merged into existing entities).
  const mergedThreads: Array<{ sliceThread: Thread; existingThreadId: string }> = [];
  for (const t of Object.values(slice.threads)) {
    const { id, fresh } = claim(t, t.description, mergePlan.threads, ctx.existing.threadIdByDesc, 'thread');
    if (fresh) newThreads.push({ entity: t, targetId: id });
    else mergedThreads.push({ sliceThread: t, existingThreadId: id });
  }

  // Scenes / worldBuilds / arcs — always net-new. Mint onto the
  // narrative's prefix counter directly.
  for (const id of Object.keys(slice.scenes)) {
    ctx.maps.scene.set(id, ctx.minters.scene.mint(PREFIX.scene, ctx.taken.scene));
  }
  for (const id of Object.keys(slice.worldBuilds ?? {})) {
    ctx.maps.worldBuild.set(id, ctx.minters.worldBuild.mint(PREFIX.worldBuild, ctx.taken.worldBuild));
  }
  for (const id of Object.keys(slice.arcs)) {
    ctx.maps.arc.set(id, ctx.minters.arc.mint(PREFIX.arc, ctx.taken.arc));
  }
  // System nodes — concept-keyed merge plan + counter fallback.
  for (const [sliceId, node] of Object.entries(slice.systemGraph?.nodes ?? {})) {
    const existingConcept = mergePlan.systemConcepts.get(node.concept);
    const existingId = existingConcept ? ctx.existing.sysIdByConcept.get(existingConcept) : undefined;
    ctx.maps.sys.set(
      sliceId,
      existingId ?? ctx.minters.sys.mint(PREFIX.sys, ctx.taken.sys),
    );
  }

  // Phase III.b — outcome + participant expansion. For each merged
  // slice thread, diff its outcomes/participants against the existing
  // target and emit an expansion record. Slice participant ids are
  // remapped through the entity maps so they reference the existing
  // narrative's id space. Outcomes are case-insensitive deduped at
  // apply-time in the reducer; here we just collect the candidates.
  const threadExpansions: ClaimResult['threadExpansions'] = [];
  for (const { sliceThread, existingThreadId } of mergedThreads) {
    const target = narrative.threads[existingThreadId];
    if (!target) continue;

    const existingOutcomes = new Set(target.outcomes.map((o) => o.toLowerCase()));
    const addOutcomes: string[] = [];
    for (const o of sliceThread.outcomes ?? []) {
      const trimmed = typeof o === 'string' ? o.trim() : '';
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (existingOutcomes.has(key)) continue;
      existingOutcomes.add(key);
      addOutcomes.push(trimmed);
    }

    const existingParticipantIds = new Set(target.participants.map((p) => p.id));
    const addParticipants: ThreadParticipant[] = [];
    for (const p of sliceThread.participants ?? []) {
      // Remap the slice participant id through whichever entity map
      // owns it (chars / locs / arts). If the slice participant was
      // itself merged into an existing entity, the map already resolves
      // to that existing id — duplicates are filtered.
      const remappedId =
        ctx.maps.char.get(p.id) ??
        ctx.maps.loc.get(p.id) ??
        ctx.maps.art.get(p.id) ??
        p.id;
      if (existingParticipantIds.has(remappedId)) continue;
      existingParticipantIds.add(remappedId);
      addParticipants.push({ id: remappedId, type: p.type });
    }

    if (addOutcomes.length > 0 || addParticipants.length > 0) {
      threadExpansions.push({ existingThreadId, addOutcomes, addParticipants });
    }
  }

  return {
    newCharacters,
    newLocations,
    newArtifacts,
    newThreads,
    netNewIds: {
      char: new Set(newCharacters.map((p) => p.entity.id)),
      loc: new Set(newLocations.map((p) => p.entity.id)),
      art: new Set(newArtifacts.map((p) => p.entity.id)),
      thread: new Set(newThreads.map((p) => p.entity.id)),
    },
    threadExpansions,
  };
}

/** Phase 2c: rewrite the slice through the per-type remap functions.
 *  No id minting happens here — every id has already been claimed in
 *  the previous phase. */
function buildRewrittenSlice(
  slice: NarrativeState,
  ctx: ClaimContext,
  claim: ClaimResult,
): RewrittenSlice {
  const remapCtx: Ctx = { maps: ctx.maps, taken: ctx.taken };
  const characters = claim.newCharacters.map((p) => remapCharacter(p.entity, p.targetId, remapCtx));
  const locations = claim.newLocations.map((p) => remapLocation(p.entity, p.targetId, remapCtx));
  const artifacts = claim.newArtifacts.map((p) => remapArtifact(p.entity, p.targetId, remapCtx));
  const threads = claim.newThreads.map((p) => remapThread(p.entity, p.targetId, remapCtx));
  const scenes = Object.values(slice.scenes).map((s) => remapScene(s, remapCtx, claim.netNewIds));
  const arcs = Object.values(slice.arcs).map((a) => remapArc(a, remapCtx));
  const worldBuilds = Object.values(slice.worldBuilds ?? {}).map((wb) =>
    remapWorldBuild(wb, remapCtx, claim.netNewIds),
  );
  // Slice's root branch dictates the order in which scenes + world
  // commits land in the target branch's entryIds.
  const sliceRootBranch = Object.values(slice.branches).find((b) => b.parentBranchId === null);
  const appendEntryIds = (sliceRootBranch?.entryIds ?? []).map((eid) =>
    remapAny(eid, ctx.maps.scene, ctx.maps.worldBuild),
  );
  return {
    characters,
    locations,
    artifacts,
    threads,
    scenes,
    arcs,
    worldBuilds,
    appendEntryIds,
    threadExpansions: claim.threadExpansions,
  };
}

/** Phase 2d: emit the atomic merge into the reducer + stamp the
 *  per-branch commit ledger on the SourceFile. */
function dispatchMerge(
  narrative: NarrativeState,
  file: SourceFile,
  branchId: string,
  rewritten: RewrittenSlice,
  dispatch: Dispatch,
): ApplyResult {
  dispatch({
    type: 'APPLY_EXTENSION',
    narrativeId: narrative.id,
    branchId,
    fileId: file.id,
    characters: rewritten.characters,
    locations: rewritten.locations,
    artifacts: rewritten.artifacts,
    threads: rewritten.threads,
    scenes: rewritten.scenes,
    worldBuilds: rewritten.worldBuilds,
    arcs: rewritten.arcs,
    appendEntryIds: rewritten.appendEntryIds,
    threadExpansions: rewritten.threadExpansions,
  });

  const arcId = rewritten.arcs[0]?.id ?? null;
  const sceneIds = rewritten.scenes.map((s) => s.id);

  // No per-branch ledger — files stay narrative-wide artifacts. Apply
  // is repeatable; each invocation appends a fresh slice with its own
  // newly-minted ids.
  return { introducedSceneIds: sceneIds, introducedArcId: arcId };
}

/** Phase 2: take a prepared (loaded + reconciled) slice and merge it
 *  into the target narrative on `branchId`. Pure ID remapping +
 *  dispatch — no LLM work, no IDB reads. The streaming UI calls this
 *  after the operator clicks "Append" on the merge preview. */
export function commitPreparedApply(
  narrative: NarrativeState,
  file: SourceFile,
  branchId: string,
  prepared: PreparedApply,
  dispatch: Dispatch,
): ApplyResult {
  const ctx = buildClaimContext(narrative);
  const claim = claimSliceIds(prepared.slice, prepared.mergePlan, ctx, narrative);
  const rewritten = buildRewrittenSlice(prepared.slice, ctx, claim);
  return dispatchMerge(narrative, file, branchId, rewritten, dispatch);
}

/** Convenience wrapper that runs prepare + commit back-to-back. The
 *  streaming UI bypasses this and calls `prepareExtensionApply` /
 *  `commitPreparedApply` directly so it can stream tokens between the
 *  two phases. Callers that don't need the preview (tests, scripts)
 *  can keep using this one-shot entry point. */
export async function applyExtensionToBranch(
  narrative: NarrativeState,
  file: SourceFile,
  branchId: string,
  dispatch: Dispatch,
  onProgress?: (phase: 'reconciling' | 'merging') => void,
): Promise<ApplyResult> {
  onProgress?.('reconciling');
  const prepared = await prepareExtensionApply(narrative, file);
  onProgress?.('merging');
  return commitPreparedApply(narrative, file, branchId, prepared, dispatch);
}
