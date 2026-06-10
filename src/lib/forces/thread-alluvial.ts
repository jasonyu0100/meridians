// thread-alluvial.ts — log-based layering for the Influence Sankey.
//
// Columns are TIME, read off the logs. Each band becomes a horizontal stream
// whose width at each bucket = the volume (attention) it drew there, so the
// picture reads as influence moving through time. Four sources, two over the
// three forces (read off scene deltas), one over streams (calendar time):
//   • Fate   → scene thread-deltas. Bands are individual threads, or — in tag
//              mode — the ThreadLogNodeType stamped on each delta.
//   • World  → scene world-deltas. Bands are individual entities (character /
//              location / artifact), or the WorldNodeType of each added node.
//   • System → scene system-deltas. Tags only: the SystemNodeType of each added
//              node (System is one global graph, not a set of entities).
//   • Streams → stream priors over their commit times (buildStreamAlluvial).
// For the scene-based sources: Full = one bucket per arc; Window = a fixed span
// of per-scene buckets centred on the present (past + future). No parentage
// involved — influence is read purely from the logs. Colour is per-band.

import type { NarrativeState } from '@/types/narrative';
import {
  resolveEntry,
  THREAD_LOG_NODE_TYPES,
  WORLD_NODE_TYPES,
  SYSTEM_NODE_TYPES,
} from '@/types/narrative';
import { isThreadClosed, isThreadAbandoned } from '@/lib/forces/narrative-utils';
import { streamsForBranch } from '@/lib/merges';

/** Scene-time Influence source (Streams ride calendar time, handled separately). */
export type ForceSource = 'fate' | 'world' | 'system';
/** Individual bands (one per thread / entity) vs tag bands (one per log type). */
export type InfluenceMode = 'individual' | 'tags';

/** A tag's display label — the log-type name, title-cased. */
function tagLabel(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export type AlluvialBucket = { key: string; label: string; sceneKeys: string[] };

/** Per-entity display info, so the renderer can label threads OR streams. */
export type AlluvialMeta = { label: string; closed: boolean; abandoned: boolean };

export type AlluvialData = {
  buckets: AlluvialBucket[];
  /** volumes[bucketIndex] : entityId → volume in that bucket. */
  volumes: Map<string, number>[];
  /** Stacking order — first-active bucket, then total volume. */
  threadOrder: string[];
  /** Index of the bucket holding the present scene (for the "now" marker); -1
   *  if the present sits outside the rendered span (always -1 for streams). */
  currentBucket: number;
  /** Label / lifecycle per entity id. */
  meta: Map<string, AlluvialMeta>;
  /** Time width (ms) of one displayed COLUMN, for streams: one unit in window
   *  mode, `groupSize × unit` in full mode (columns are chunked there). Drives
   *  single-step navigation so an arrow moves by exactly one column. Undefined
   *  for threads (per-scene, not time-based). */
  bucketMs?: number;
};

const MAX_COLS = 18;

const EMPTY: AlluvialData = { buckets: [], volumes: [], threadOrder: [], currentBucket: -1, meta: new Map() };

/** All scene entries in timeline order, with their resolvedKeys index. */
function allScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
): { key: string; arcId: string | undefined; ki: number }[] {
  const out: { key: string; arcId: string | undefined; ki: number }[] = [];
  for (let i = 0; i < resolvedKeys.length; i++) {
    const e = resolveEntry(narrative, resolvedKeys[i]);
    if (e && e.kind === 'scene') out.push({ key: resolvedKeys[i], arcId: e.arcId, ki: i });
  }
  return out;
}

/** Merge consecutive buckets down to at most `maxCols`, unioning their keys. */
function chunkBuckets(buckets: AlluvialBucket[], maxCols: number): AlluvialBucket[] {
  if (buckets.length <= maxCols) return buckets;
  const groupSize = Math.ceil(buckets.length / maxCols);
  const out: AlluvialBucket[] = [];
  for (let i = 0; i < buckets.length; i += groupSize) {
    const grp = buckets.slice(i, i + groupSize);
    out.push({
      key: grp[0].key,
      label: grp.length > 1 ? `${i + 1}–${Math.min(i + groupSize, buckets.length)}` : grp[0].label,
      sceneKeys: grp.flatMap((b) => b.sceneKeys),
    });
  }
  return out;
}

/** First-active-then-total ordering, shared by both sources. */
function orderEntities(volumes: Map<string, number>[]): string[] {
  const firstActive = new Map<string, number>();
  const total = new Map<string, number>();
  volumes.forEach((v, b) => {
    for (const [id, vol] of v) {
      if (vol <= 0) continue;
      if (!firstActive.has(id)) firstActive.set(id, b);
      total.set(id, (total.get(id) ?? 0) + vol);
    }
  });
  return [...firstActive.keys()].sort(
    (a, b) => (firstActive.get(a)! - firstActive.get(b)!) || (total.get(b)! - total.get(a)!),
  );
}

/** A scene entry resolved from a key — narrowed to scene-kind. */
type SceneEntry = Extract<ReturnType<typeof resolveEntry>, { kind: 'scene' }>;

/** Per-scene contribution: band id → volume drawn this scene. */
type Contributor = (scene: SceneEntry) => Map<string, number>;

/** The scene-time bucket grid + the present-bucket index, shared by every
 *  force source. Window = a fixed span of per-scene columns centred on the
 *  present; Full = one column per arc (or per scene when single-arc), chunked
 *  to MAX_COLS. */
function bucketScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  window: boolean,
  windowSize: number,
  bucketSize: number = 1,
): { buckets: AlluvialBucket[]; currentBucket: number } | null {
  const scenes = allScenes(narrative, resolvedKeys);
  if (scenes.length === 0) return null;

  let curPos = scenes.findIndex((s) => s.ki === currentIndex);
  if (curPos < 0) {
    for (let i = scenes.length - 1; i >= 0; i--) {
      if (scenes[i].ki <= currentIndex) { curPos = i; break; }
    }
    if (curPos < 0) curPos = 0;
  }
  const curKey = scenes[curPos]?.key;

  let buckets: AlluvialBucket[];
  if (window) {
    // `windowSize` columns, each aggregating `bucketSize` consecutive scenes;
    // the span is centred on the present scene.
    const cols = Math.max(1, windowSize);
    const per = Math.max(1, bucketSize);
    const totalScenes = cols * per;
    const half = Math.floor(totalScenes / 2);
    let start = Math.max(0, Math.min(curPos - half, scenes.length - totalScenes));
    if (start < 0) start = 0;
    buckets = [];
    for (let c = 0; c < cols; c++) {
      const lo = start + c * per;
      const grp = scenes.slice(lo, lo + per);
      if (grp.length === 0) break;
      buckets.push({
        key: grp[0].key,
        label: per > 1 ? `S${lo + 1}–${lo + grp.length}` : `S${lo + 1}`,
        sceneKeys: grp.map((s) => s.key),
      });
    }
  } else {
    // Full = the whole timeline, separated into columns of `bucketSize` scenes
    // (user-controlled, not arc-derived), then chunked to MAX_COLS if needed.
    const per = Math.max(1, bucketSize);
    const cols: AlluvialBucket[] = [];
    for (let i = 0; i < scenes.length; i += per) {
      const grp = scenes.slice(i, i + per);
      cols.push({
        key: grp[0].key,
        label: grp.length > 1 ? `S${i + 1}–${i + grp.length}` : `S${i + 1}`,
        sceneKeys: grp.map((s) => s.key),
      });
    }
    buckets = chunkBuckets(cols, MAX_COLS);
  }

  const currentBucket = curKey ? buckets.findIndex((b) => b.sceneKeys.includes(curKey)) : -1;
  return { buckets, currentBucket };
}

/** Per-source, per-mode contributor — what each scene adds to which band. */
function contributorFor(source: ForceSource, mode: InfluenceMode): Contributor {
  if (source === 'fate') {
    // Volume = attention drawn (1 per delta + its volumeDelta), keyed by thread
    // (individual) or by the delta's logType primitive (tags).
    return (scene) => {
      const vol = new Map<string, number>();
      for (const d of scene.threadDeltas ?? []) {
        const id = mode === 'tags' ? d.logType : d.threadId;
        vol.set(id, (vol.get(id) ?? 0) + 1 + Math.max(0, d.volumeDelta ?? 0));
      }
      return vol;
    };
  }
  if (source === 'world') {
    // Volume = added world-graph nodes, keyed by entity (individual) or by each
    // node's WorldNodeType (tags).
    return (scene) => {
      const vol = new Map<string, number>();
      for (const d of scene.worldDeltas ?? []) {
        const nodes = d.addedNodes ?? [];
        if (mode === 'tags') {
          for (const n of nodes) vol.set(n.type, (vol.get(n.type) ?? 0) + 1);
        } else if (nodes.length > 0) {
          vol.set(d.entityId, (vol.get(d.entityId) ?? 0) + nodes.length);
        }
      }
      return vol;
    };
  }
  // System — one global graph, no per-entity decomposition: tags only.
  return (scene) => {
    const vol = new Map<string, number>();
    for (const n of scene.systemDeltas?.addedNodes ?? []) {
      vol.set(n.type, (vol.get(n.type) ?? 0) + 1);
    }
    return vol;
  };
}

/** Display label + lifecycle for every band that can appear, given source/mode. */
function metaFor(
  narrative: NarrativeState,
  source: ForceSource,
  mode: InfluenceMode,
): Map<string, AlluvialMeta> {
  const meta = new Map<string, AlluvialMeta>();
  const tags = (list: string[]) => {
    for (const t of list) meta.set(t, { label: tagLabel(t), closed: false, abandoned: false });
  };
  if (mode === 'tags') {
    if (source === 'fate') tags(THREAD_LOG_NODE_TYPES);
    else if (source === 'world') tags(WORLD_NODE_TYPES);
    else tags(SYSTEM_NODE_TYPES);
    return meta;
  }
  if (source === 'fate') {
    for (const t of Object.values(narrative.threads)) {
      meta.set(t.id, { label: t.description, closed: isThreadClosed(t), abandoned: isThreadAbandoned(t) });
    }
  } else if (source === 'world') {
    for (const c of Object.values(narrative.characters ?? {})) meta.set(c.id, { label: c.name, closed: false, abandoned: false });
    for (const l of Object.values(narrative.locations ?? {})) meta.set(l.id, { label: l.name, closed: false, abandoned: false });
    for (const a of Object.values(narrative.artifacts ?? {})) meta.set(a.id, { label: a.name, closed: false, abandoned: false });
  }
  return meta;
}

/** Influence over one of the three forces, read off scene deltas. System is
 *  tags-only (forced upstream). */
export function buildForceAlluvial(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  window: boolean,
  windowSize: number,
  source: ForceSource,
  mode: InfluenceMode,
  bucketSize: number = 1,
): AlluvialData {
  const grid = bucketScenes(narrative, resolvedKeys, currentIndex, window, windowSize, bucketSize);
  if (!grid) return EMPTY;
  const { buckets, currentBucket } = grid;

  const contribute = contributorFor(source, mode);
  const volumes: Map<string, number>[] = buckets.map((b) => {
    const vol = new Map<string, number>();
    for (const sceneKey of b.sceneKeys) {
      const e = resolveEntry(narrative, sceneKey);
      if (!e || e.kind !== 'scene') continue;
      for (const [id, v] of contribute(e)) vol.set(id, (vol.get(id) ?? 0) + v);
    }
    return vol;
  });

  return {
    buckets,
    volumes,
    threadOrder: orderEntities(volumes),
    currentBucket,
    meta: metaFor(narrative, source, mode),
  };
}

export type TimeGranularity = 'hour' | 'day' | 'week';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const GRAN_MS: Record<TimeGranularity, number> = { hour: HOUR_MS, day: DAY_MS, week: 7 * DAY_MS };

/** Milliseconds in one bucket of the given granularity — used by callers to
 *  step a time cursor forward / backward one unit at a time. */
export function granularityMs(g: TimeGranularity): number {
  return GRAN_MS[g];
}

/** Date label for a bucket start, scaled to the granularity. */
function dateLabel(startMs: number, gran: TimeGranularity): string {
  const d = new Date(startMs);
  if (gran === 'hour') return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Streams — influence read off stream priors on a CONTINUOUS absolute-time
 * axis (default weekly), up to the present. Unlike threads (one column per
 * scene), streams are concurrent and asynchronous, so we bucket real calendar
 * time: each column is a day/week/month, a stream flows across the columns it
 * was active in (width = prior volume there), and open streams run up to "now".
 */
export function buildStreamAlluvial(
  narrative: NarrativeState,
  opts: {
    window: boolean;
    windowUnits: number;
    granularity: TimeGranularity;
    nowMs: number;
    branchId?: string | null;
    allBranches?: boolean;
    /** Unit bands (one per stream) vs type bands (one per prior logType). */
    mode?: InfluenceMode;
    /** Granularity units aggregated per displayed column in window mode. */
    bucketUnits?: number;
  },
): AlluvialData {
  const { window, windowUnits, granularity, nowMs, branchId, allBranches } = opts;
  const mode: InfluenceMode = opts.mode ?? 'individual';
  const per = Math.max(1, opts.bucketUnits ?? 1);
  // Branch-scoped by default (copy-on-fork ownership): only the active branch's
  // own streams. `allBranches` widens to the whole pool across every branch.
  const streams = allBranches ? Object.values(narrative.streams ?? {}) : streamsForBranch(narrative, branchId);
  if (streams.length === 0) return EMPTY;

  let earliest = Infinity;
  for (const s of streams) for (const p of s.priors ?? []) earliest = Math.min(earliest, p.at);
  if (!isFinite(earliest)) return EMPTY;

  const unit = GRAN_MS[granularity];
  // Grid-aligned bucket starts from the earliest prior up to the present.
  const firstStart = Math.floor(earliest / unit) * unit;
  const lastStart = Math.floor(nowMs / unit) * unit;
  const starts: number[] = [];
  for (let t = firstStart; t <= lastStart; t += unit) starts.push(t);
  if (starts.length === 0) starts.push(lastStart);

  // The volume a single prior contributes, and the band it lands in.
  const priorBand = (p: { logType?: string }): string =>
    mode === 'tags' ? (p.logType ?? 'pulse') : '';

  // Window = a fixed-size sliding frame ending at the cursor (lastStart), each
  // column `per` units wide. It is NOT clipped to the data range, so navigating
  // back past the earliest prior still shows a full continuum (empty cells)
  // rather than collapsing — the frame slides smoothly both ways.
  // Full = the whole span (chunked if huge, each chunk a contiguous range).
  let ranges: { lo: number; hi: number }[];
  let bucketMs = unit; // time width of one displayed column (drives step size)
  if (window) {
    const n = Math.max(1, windowUnits);
    bucketMs = per * unit;
    ranges = [];
    for (let i = n - 1; i >= 0; i--) {
      const hi = lastStart + unit - i * per * unit;
      ranges.push({ lo: hi - per * unit, hi });
    }
  } else {
    // Full = the whole span, separated into columns of `per` units (user-
    // controlled), widened further only if that would exceed the column cap.
    const groupSize = Math.max(per, Math.ceil(starts.length / MAX_COLS));
    bucketMs = groupSize * unit;
    ranges = [];
    for (let i = 0; i < starts.length; i += groupSize) {
      const grp = starts.slice(i, i + groupSize);
      ranges.push({ lo: grp[0], hi: grp[grp.length - 1] + unit });
    }
  }

  const buckets: AlluvialBucket[] = ranges.map((r) => ({
    key: String(r.lo),
    label: dateLabel(r.lo, granularity),
    sceneKeys: [],
  }));

  const volumes: Map<string, number>[] = ranges.map((r) => {
    const vol = new Map<string, number>();
    for (const s of streams) {
      for (const p of s.priors ?? []) {
        if (p.at < r.lo || p.at >= r.hi) continue;
        const id = mode === 'tags' ? priorBand(p) : s.id;
        vol.set(id, (vol.get(id) ?? 0) + 1 + Math.max(0, p.volumeDelta ?? 0));
      }
    }
    return vol;
  });

  const meta = new Map<string, AlluvialMeta>();
  if (mode === 'tags') {
    for (const t of THREAD_LOG_NODE_TYPES) meta.set(t, { label: tagLabel(t), closed: false, abandoned: false });
  } else {
    for (const s of streams) {
      meta.set(s.id, { label: s.title || 'Untitled stream', closed: s.state !== 'open', abandoned: false });
    }
  }

  // The present sits in the final bucket — mark it so open streams read as "now".
  return { buckets, volumes, threadOrder: orderEntities(volumes), currentBucket: buckets.length - 1, meta, bucketMs };
}
