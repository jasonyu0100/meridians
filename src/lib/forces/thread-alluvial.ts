// thread-alluvial.ts — log-based layering for the Fate Influence Sankey.
//
// Columns are TIME, read off the logs. Each entity (thread OR stream) becomes a
// horizontal stream whose width at each bucket = the volume (attention) it drew
// there, so the picture reads as influence moving through time. Two sources:
//   • Threads → scene thread-deltas. Full = one bucket per arc; Window = a fixed
//     span of per-scene buckets centred on the present (past + future).
//   • Streams → stream priors over their commit times. Full = the whole prior
//     history chunked into columns; Window = the most recent priors.
// No parentage involved — influence is read purely from the logs. Colour is
// per-entity.

import type { NarrativeState } from '@/types/narrative';
import { resolveEntry } from '@/types/narrative';
import { isThreadClosed, isThreadAbandoned } from '@/lib/forces/narrative-utils';

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
};

const DEFAULT_WINDOW = 13; // odd → present sits dead-centre when room allows
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

/** Threads — fate influence read off scene thread-deltas. */
export function buildLogAlluvial(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  window: boolean,
  windowSize: number = DEFAULT_WINDOW,
): AlluvialData {
  const scenes = allScenes(narrative, resolvedKeys);
  if (scenes.length === 0) return EMPTY;

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
    const span = Math.max(3, windowSize);
    const half = Math.floor(span / 2);
    let start = Math.max(0, Math.min(curPos - half, scenes.length - span));
    if (start < 0) start = 0;
    const pool = scenes.slice(start, start + span);
    buckets = pool.map((s, i) => ({ key: s.key, label: `S${start + i + 1}`, sceneKeys: [s.key] }));
  } else {
    const order: string[] = [];
    const byArc = new Map<string, string[]>();
    for (const s of scenes) {
      const arcId = s.arcId ?? '—';
      if (!byArc.has(arcId)) { byArc.set(arcId, []); order.push(arcId); }
      byArc.get(arcId)!.push(s.key);
    }
    buckets = order.length > 1
      ? chunkBuckets(order.map((arcId, i) => ({
          key: arcId,
          label: narrative.arcs[arcId]?.name ?? `Arc ${i + 1}`,
          sceneKeys: byArc.get(arcId)!,
        })), MAX_COLS)
      : chunkBuckets(scenes.map((s, i) => ({ key: s.key, label: `S${i + 1}`, sceneKeys: [s.key] })), MAX_COLS);
  }

  const volumes: Map<string, number>[] = buckets.map((b) => {
    const vol = new Map<string, number>();
    for (const sceneKey of b.sceneKeys) {
      const e = resolveEntry(narrative, sceneKey);
      if (!e || e.kind !== 'scene') continue;
      for (const d of e.threadDeltas ?? []) {
        vol.set(d.threadId, (vol.get(d.threadId) ?? 0) + 1 + Math.max(0, d.volumeDelta ?? 0));
      }
    }
    return vol;
  });

  const currentBucket = curKey ? buckets.findIndex((b) => b.sceneKeys.includes(curKey)) : -1;

  const meta = new Map<string, AlluvialMeta>();
  for (const t of Object.values(narrative.threads)) {
    meta.set(t.id, { label: t.description, closed: isThreadClosed(t), abandoned: isThreadAbandoned(t) });
  }

  return { buckets, volumes, threadOrder: orderEntities(volumes), currentBucket, meta };
}

export type TimeGranularity = 'day' | 'week' | 'month';
const DAY_MS = 86_400_000;
const GRAN_MS: Record<TimeGranularity, number> = { day: DAY_MS, week: 7 * DAY_MS, month: 30 * DAY_MS };

/** Date label for a bucket start, scaled to the granularity. */
function dateLabel(startMs: number, gran: TimeGranularity): string {
  const d = new Date(startMs);
  if (gran === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
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
  opts: { window: boolean; windowUnits: number; granularity: TimeGranularity; nowMs: number },
): AlluvialData {
  const { window, windowUnits, granularity, nowMs } = opts;
  const streams = Object.values(narrative.streams ?? {});
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

  // Window = the most recent N units; Full = the whole span (chunked if huge,
  // each chunk a contiguous range of units).
  let ranges: { lo: number; hi: number }[];
  if (window) {
    ranges = starts.slice(-Math.max(3, windowUnits)).map((s) => ({ lo: s, hi: s + unit }));
  } else if (starts.length > MAX_COLS) {
    const groupSize = Math.ceil(starts.length / MAX_COLS);
    ranges = [];
    for (let i = 0; i < starts.length; i += groupSize) {
      const grp = starts.slice(i, i + groupSize);
      ranges.push({ lo: grp[0], hi: grp[grp.length - 1] + unit });
    }
  } else {
    ranges = starts.map((s) => ({ lo: s, hi: s + unit }));
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
        vol.set(s.id, (vol.get(s.id) ?? 0) + 1 + Math.max(0, p.volumeDelta ?? 0));
      }
    }
    return vol;
  });

  const meta = new Map<string, AlluvialMeta>();
  for (const s of streams) {
    meta.set(s.id, { label: s.title || 'Untitled stream', closed: s.state !== 'open', abandoned: false });
  }

  // The present sits in the final bucket — mark it so open streams read as "now".
  return { buckets, volumes, threadOrder: orderEntities(volumes), currentBucket: buckets.length - 1, meta };
}
