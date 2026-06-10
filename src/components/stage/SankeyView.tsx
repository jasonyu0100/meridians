"use client";
// SankeyView — the INFLUENCE alluvial. Columns are time buckets read off the
// logs; each band is a horizontal stream whose width at each bucket = the
// volume it drew there, so the picture reads as influence moving through time.
// Source (Fate / World / System / Streams) is chosen by the topbar; the mode
// (Individual / Tags), span (Full / Window), window + bucket size are in the
// bar below it. Fate/World/System read off scene deltas; Streams ride calendar
// time. Tags group by the log type stamped on each delta; System is tags-only.

import { useMemo, useRef, useState, useEffect } from "react";
import * as d3 from "d3";
import type { NarrativeState } from "@/types/narrative";
import {
  resolveEntry,
  THREAD_LOG_NODE_TYPES,
  WORLD_NODE_TYPES,
  SYSTEM_NODE_TYPES,
} from "@/types/narrative";
import {
  buildForceAlluvial,
  buildStreamAlluvial,
  granularityMs,
  type TimeGranularity,
  type InfluenceMode,
} from "@/lib/forces/thread-alluvial";
import { useStore } from "@/lib/state/store";
import { streamsForBranch } from "@/lib/merges";
import { EmptyState } from "@/components/shared/EmptyState";
import { IconThread } from "@/components/icons";

const COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#14b8a6",
  "#8b5cf6",
  "#22c55e",
  "#eab308",
  "#f43f5e",
  "#0ea5e9",
];

const NODE_W = 11;
const PAD = 9;
const TOP = 22;
const BOT = 8;
const ML = 8;
const MR = 8;

function ribbon(
  sx: number,
  tx: number,
  sy0: number,
  sy1: number,
  ty0: number,
  ty1: number,
): string {
  const xm = (sx + tx) / 2;
  return `M${sx},${sy0} C${xm},${sy0} ${xm},${ty0} ${tx},${ty0} L${tx},${ty1} C${xm},${ty1} ${xm},${sy1} ${sx},${sy1} Z`;
}

function Seg({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
        active
          ? "bg-white/10 text-text-primary"
          : "text-text-dim/60 hover:text-text-secondary hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

/** Compact −/value/+ stepper used for window + bucket size. */
function Stepper({
  label,
  value,
  suffix,
  min,
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-white/10 px-1">
      <span className="text-text-dim/50 uppercase tracking-wider">{label}</span>
      <button
        className="px-1 text-text-dim/60 hover:text-text-primary disabled:opacity-30"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="tabular-nums text-text-secondary">
        {value}
        {suffix ?? ""}
      </span>
      <button
        className="px-1 text-text-dim/60 hover:text-text-primary"
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

export default function SankeyView({
  narrative,
  resolvedKeys,
  currentIndex,
  source,
  branchId,
  onSelectThread,
  onSelectStream,
  onSelectEntity,
}: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentIndex: number;
  /** Fate / World / System read off scene deltas; Streams ride calendar time. */
  source: "fate" | "world" | "system" | "streams";
  /** Active branch — streams are branch-scoped (copy-on-fork ownership). */
  branchId: string | null;
  onSelectThread: (id: string) => void;
  onSelectStream: (id: string) => void;
  /** World individual band → entity (character / location / artifact). */
  onSelectEntity: (id: string) => void;
}) {
  // Scene-based forces vs the calendar-time stream axis.
  const timeAxis = source === "streams";
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  // Hover tooltip — full (wrapping) band label + status, positioned at the
  // cursor. Inline labels stay compact; the tooltip carries the full text.
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    id: string;
    label: string;
    sub: string;
  } | null>(null);
  // Band labels are always on (no toggle).
  const showLabels = true;
  const [span, setSpan] = useState<"full" | "window">("window");
  const [windowSize, setWindowSize] = useState(15);
  // Units aggregated per displayed column in window mode — scenes for the
  // scene-based forces, granularity units for streams.
  const [bucketSize, setBucketSize] = useState(1);
  // Unit bands (one per thread / entity / stream) vs type bands (one per log
  // type). System is one global graph with no per-entity decomposition → type
  // only, so the toggle is hidden and the mode is forced to tags there.
  const [mode, setMode] = useState<InfluenceMode>("individual");
  const isTypeOnly = source === "system";
  const effMode: InfluenceMode = isTypeOnly ? "tags" : mode;
  const [granularity, setGranularity] = useState<TimeGranularity>("day");
  // Stream scope — this branch's own streams (default) vs every branch's.
  const [streamScope, setStreamScope] = useState<"branch" | "all">("branch");
  const allBranches = streamScope === "all";
  // Snapshot "now" once so weekly buckets don't jitter on every render.
  const [nowMs] = useState(() => Date.now());
  // Streams navigation — a time cursor offset (≤ 0) from the real present, in
  // ms. Stepping back/forward moves it one granularity unit at a time so the
  // window slides through absolute time. Threads navigate by scene instead.
  const [timeOffsetMs, setTimeOffsetMs] = useState(0);
  const { dispatch } = useStore();
  const effectiveNow = nowMs + timeOffsetMs;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () =>
      timeAxis
        ? buildStreamAlluvial(narrative, {
            window: span === "window",
            windowUnits: windowSize,
            granularity,
            nowMs: effectiveNow,
            branchId,
            allBranches,
            mode: effMode,
            bucketUnits: bucketSize,
          })
        : buildForceAlluvial(
            narrative,
            resolvedKeys,
            currentIndex,
            span === "window",
            windowSize,
            source as "fate" | "world" | "system",
            effMode,
            bucketSize,
          ),
    [
      timeAxis,
      source,
      effMode,
      bucketSize,
      narrative,
      resolvedKeys,
      currentIndex,
      span,
      windowSize,
      granularity,
      effectiveNow,
      branchId,
      allBranches,
    ],
  );

  // Stable colour per band — keyed to the source/mode's FULL id set (in
  // insertion order), NOT the currently-visible subset, so a band keeps the
  // same colour as the window slides, the timeline advances, or toggles flip.
  const colorOf = useMemo(() => {
    let ids: string[];
    if (timeAxis) {
      ids = effMode === "tags"
        ? THREAD_LOG_NODE_TYPES
        : (allBranches
            ? Object.values(narrative.streams ?? {})
            : streamsForBranch(narrative, branchId)
          ).map((s) => s.id);
    } else if (effMode === "tags") {
      ids =
        source === "fate"
          ? THREAD_LOG_NODE_TYPES
          : source === "world"
            ? WORLD_NODE_TYPES
            : SYSTEM_NODE_TYPES;
    } else if (source === "fate") {
      ids = Object.keys(narrative.threads ?? {});
    } else {
      // World individual — characters, then locations, then artifacts.
      ids = [
        ...Object.keys(narrative.characters ?? {}),
        ...Object.keys(narrative.locations ?? {}),
        ...Object.keys(narrative.artifacts ?? {}),
      ];
    }
    const scale = d3.scaleOrdinal<string, string>().domain(ids).range(COLORS);
    return (id: string) => scale(id);
  }, [narrative, source, effMode, timeAxis, branchId, allBranches]);

  const layout = useMemo(() => {
    const { w, h } = size;
    if (w < 80 || h < 60) return null;
    const { buckets, volumes, threadOrder, currentBucket, meta } = data;
    if (buckets.length === 0) return null;

    const active = threadOrder.filter((id) =>
      volumes.some((v) => (v.get(id) ?? 0) > 0),
    );
    // Both sources keep the lined time grid even when the current window has no
    // activity, so navigation stays oriented. EmptyState only shows when there
    // is no data at all (buckets.length === 0, handled above).

    // ── Cell / lined model ──────────────────────────────────────────────────
    // Each bucket is a CELL bounded by two gridlines. Nodes + timestamps sit
    // CENTRED in their cell (between the lines); ribbons connect cell centres,
    // crossing the gridline between adjacent cells. This reads as a steady time
    // continuum: one evenly-sized cell per unit, gaps included.
    const B = buckets.length;
    const availW = w - ML - MR;
    let cellW = availW / Math.max(1, B);
    const MAX_CELL = 240;
    const MIN_CELL = 36;
    cellW = Math.max(MIN_CELL, Math.min(MAX_CELL, cellW));
    const gridW = cellW * B;
    const offsetX = Math.max(ML, (w - gridW) / 2);
    const cellEdge = (b: number) => offsetX + b * cellW; // left gridline of cell b
    const cellCenter = (b: number) => offsetX + (b + 0.5) * cellW;
    const gridLines = Array.from({ length: B + 1 }, (_, b) => cellEdge(b));

    let scale = Infinity;
    volumes.forEach((v) => {
      let total = 0;
      let count = 0;
      for (const id of active) {
        const vol = v.get(id) ?? 0;
        if (vol > 0) {
          total += vol;
          count++;
        }
      }
      if (total > 0) {
        const availH = h - TOP - BOT - PAD * Math.max(0, count - 1);
        scale = Math.min(scale, Math.max(0.2, availH) / total);
      }
    });
    if (!isFinite(scale)) scale = 1; // empty window — grid only, no bands to size

    const pos = new Map<string, { y0: number; y1: number }>();
    volumes.forEach((v, b) => {
      let used = 0;
      let count = 0;
      for (const id of active) {
        const vol = v.get(id) ?? 0;
        if (vol > 0) {
          used += vol * scale;
          count++;
        }
      }
      used += PAD * Math.max(0, count - 1);
      let cursor = TOP + Math.max(0, (h - TOP - BOT - used) / 2);
      for (const id of active) {
        const vol = v.get(id) ?? 0;
        if (vol <= 0) continue;
        pos.set(`${b}:${id}`, { y0: cursor, y1: cursor + vol * scale });
        cursor += vol * scale + PAD;
      }
    });

    const color = colorOf;
    const nodeLeft = (b: number) => cellCenter(b) - NODE_W / 2;

    type S = {
      id: string;
      sx: number;
      tx: number;
      sy0: number;
      sy1: number;
      ty0: number;
      ty1: number;
    };
    const segs: S[] = [];
    for (const id of active) {
      const bs: number[] = [];
      volumes.forEach((v, b) => {
        if ((v.get(id) ?? 0) > 0) bs.push(b);
      });
      for (let k = 0; k + 1 < bs.length; k++) {
        const p0 = pos.get(`${bs[k]}:${id}`)!;
        const p1 = pos.get(`${bs[k + 1]}:${id}`)!;
        segs.push({
          id,
          sx: nodeLeft(bs[k]) + NODE_W,
          tx: nodeLeft(bs[k + 1]),
          sy0: p0.y0,
          sy1: p0.y1,
          ty0: p1.y0,
          ty1: p1.y1,
        });
      }
    }

    const firstBucketOf = new Map<string, number>();
    for (const id of active) {
      const b = volumes.findIndex((v) => (v.get(id) ?? 0) > 0);
      if (b >= 0) firstBucketOf.set(id, b);
    }

    const nodes: {
      id: string;
      b: number;
      x: number;
      y0: number;
      y1: number;
    }[] = [];
    pos.forEach((p, key) => {
      const [bStr, id] = key.split(/:(.+)/);
      nodes.push({
        id,
        b: Number(bStr),
        x: nodeLeft(Number(bStr)),
        y0: p.y0,
        y1: p.y1,
      });
    });

    const nowX = currentBucket >= 0 ? cellCenter(currentBucket) : null;

    return {
      buckets,
      nodes,
      segs,
      color,
      cellCenter,
      cellEdge,
      gridLines,
      step: cellW,
      firstBucketOf,
      nowX,
      meta,
      w,
      h,
      B,
    };
  }, [size, data, colorOf]);

  // Tags aren't individually inspectable; otherwise route by source.
  const onPick = (id: string) => {
    if (effMode === "tags") return;
    if (source === "streams") onSelectStream(id);
    else if (source === "world") onSelectEntity(id);
    else onSelectThread(id);
  };

  // Populated anchors for FAST-nav (skip empty gaps to the nearest block that
  // actually has activity). Streams: the sorted unit-bucket starts that contain
  // ≥1 prior. Scene-based forces: the scene indices that carry a delta of the
  // active force.
  const streamBucketStarts = useMemo(() => {
    if (!timeAxis) return [] as number[];
    const unit = granularityMs(granularity);
    const set = new Set<number>();
    const streams = allBranches
      ? Object.values(narrative.streams ?? {})
      : streamsForBranch(narrative, branchId);
    for (const s of streams)
      for (const p of s.priors ?? []) set.add(Math.floor(p.at / unit) * unit);
    return [...set].sort((a, b) => a - b);
  }, [narrative, timeAxis, granularity, branchId, allBranches]);
  const sceneActiveIdx = useMemo(() => {
    if (timeAxis) return [] as number[];
    const hasActivity = (e: Extract<ReturnType<typeof resolveEntry>, { kind: "scene" }>) =>
      source === "fate"
        ? (e.threadDeltas?.length ?? 0) > 0
        : source === "world"
          ? (e.worldDeltas ?? []).some((d) => (d.addedNodes?.length ?? 0) > 0)
          : (e.systemDeltas?.addedNodes?.length ?? 0) > 0;
    const idx: number[] = [];
    resolvedKeys.forEach((k, i) => {
      const e = resolveEntry(narrative, k);
      if (e?.kind === "scene" && hasActivity(e)) idx.push(i);
    });
    return idx;
  }, [narrative, resolvedKeys, source, timeAxis]);

  // ── Period navigation (driven from the shared StagePalette) ─────────────────
  // Scene-based forces step by SCENE (the existing global scene cursor); streams
  // step by one granularity UNIT of absolute time. Forward is capped at present.
  const sceneCount = resolvedKeys.length;
  const canBack = timeAxis ? true : currentIndex > 0;
  const canFwd = timeAxis ? timeOffsetMs < 0 : currentIndex < sceneCount - 1;
  // Label always carries a DATE for general time orientation, plus the
  // unit-specific detail (clock time when bucketing by hour).
  const navLabel = useMemo(() => {
    if (!timeAxis)
      return `Scene ${Math.min(currentIndex + 1, sceneCount)} / ${sceneCount}`;
    const d = new Date(effectiveNow);
    const date = d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const time =
      granularity === "hour"
        ? " · " +
          d.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })
        : "";
    return `${date}${time}${timeOffsetMs < 0 ? "" : " · now"}`;
  }, [
    timeAxis,
    currentIndex,
    sceneCount,
    effectiveNow,
    granularity,
    timeOffsetMs,
  ]);
  const stepUnit = timeAxis ? granularity : "scene";

  // Apply a step requested by the StagePalette nav cluster. `fast` skips empty
  // gaps, jumping to the nearest populated block: scene-based → nearest scene
  // with a delta of the active force; streams → nearest unit-bucket with a prior.
  useEffect(() => {
    function onStep(e: Event) {
      const { dir = 0, fast = false } =
        (e as CustomEvent<{ dir: number; fast?: boolean }>).detail ?? {};
      if (!dir) return;
      if (!timeAxis) {
        if (!fast) {
          dispatch({ type: dir < 0 ? "PREV_SCENE" : "NEXT_SCENE" });
          return;
        }
        // Fast: jump to the nearest populated block in that direction; if there
        // is none further along, stay put.
        if (dir > 0) {
          const n = sceneActiveIdx.find((i) => i > currentIndex);
          if (n != null) dispatch({ type: "SET_SCENE_INDEX", index: n });
        } else {
          let p: number | undefined;
          for (const i of sceneActiveIdx) {
            if (i < currentIndex) p = i;
            else break;
          }
          if (p != null) dispatch({ type: "SET_SCENE_INDEX", index: p });
        }
        return;
      }
      const unit = granularityMs(granularity);
      if (!fast) {
        // Step by one DISPLAYED column: one unit in window mode, one chunk
        // (groupSize × unit) in full mode where columns aggregate units.
        const stepMs = data.bucketMs ?? unit;
        setTimeOffsetMs((o) =>
          dir < 0 ? o - stepMs : Math.min(0, o + stepMs),
        );
        return;
      }
      // Symmetric: hop the cursor (the right-edge bucket) to the nearest
      // populated bucket in that direction; stay put if there is none.
      const curStart = Math.floor(effectiveNow / unit) * unit;
      if (dir > 0) {
        const n = streamBucketStarts.find((s) => s > curStart);
        if (n != null) setTimeOffsetMs(Math.min(0, n - nowMs));
      } else {
        let p: number | undefined;
        for (const s of streamBucketStarts) {
          if (s < curStart) p = s;
          else break;
        }
        if (p != null) setTimeOffsetMs(p - nowMs);
      }
    }
    window.addEventListener("canvas:influence-step", onStep);
    return () => window.removeEventListener("canvas:influence-step", onStep);
  }, [
    timeAxis,
    granularity,
    dispatch,
    sceneCount,
    currentIndex,
    effectiveNow,
    nowMs,
    data.bucketMs,
    streamBucketStarts,
    sceneActiveIdx,
  ]);

  // Publish nav state so the StagePalette can render the cluster + enabled state.
  const navDetailRef = useRef({
    active: true,
    label: navLabel,
    canBack,
    canFwd,
    unit: stepUnit,
  });
  useEffect(() => {
    navDetailRef.current = {
      active: true,
      label: navLabel,
      canBack,
      canFwd,
      unit: stepUnit,
    };
    window.dispatchEvent(
      new CustomEvent("influence:nav-state", { detail: navDetailRef.current }),
    );
  }, [navLabel, canBack, canFwd, stepUnit]);
  // Answer a late-mounting palette's request for the current state (the palette
  // mounts after this view, so it can miss the initial publish above).
  useEffect(() => {
    function onReq() {
      window.dispatchEvent(
        new CustomEvent("influence:nav-state", {
          detail: navDetailRef.current,
        }),
      );
    }
    window.addEventListener("influence:nav-request", onReq);
    return () => window.removeEventListener("influence:nav-request", onReq);
  }, []);
  // Retract the cluster when the influence view unmounts.
  useEffect(
    () => () => {
      window.dispatchEvent(
        new CustomEvent("influence:nav-state", { detail: { active: false } }),
      );
    },
    [],
  );

  return (
    <div className="absolute inset-0 z-20 flex flex-col">
      {/* Config bar (below the stage bar) — a minimal identity on the left, all
          controls pushed to the far right. Glass-panel, fixed height. */}
      <div className="shrink-0 flex items-center gap-2 px-2 h-7 border-b border-border glass-panel z-30 text-[10px] text-text-dim/70">
        <IconThread size={12} />
        <span className="capitalize text-text-secondary">{source}</span>
        {!isTypeOnly && (
          <span className="text-text-dim/40">· {effMode === "tags" ? "Type" : "Unit"}</span>
        )}

        {/* Spacer — everything below sits at the far right. */}
        <div className="flex-1" />

        {/* Unit ⇄ Type display method. System is type-only (one global graph,
            no per-entity decomposition), so the toggle is hidden there. */}
        {!isTypeOnly && (
          <div className="flex items-center rounded-md overflow-hidden border border-white/10">
            <Seg active={effMode === "individual"} onClick={() => setMode("individual")}>
              Unit
            </Seg>
            <div className="w-px h-4 bg-white/10" />
            <Seg active={effMode === "tags"} onClick={() => setMode("tags")}>
              Type
            </Seg>
          </div>
        )}

        {/* Streams ride an absolute-time continuum — pick the bucket
            granularity. Scene-based forces are per-scene, so this is hidden. */}
        {timeAxis && (
          <div className="flex items-center rounded-md overflow-hidden border border-white/10">
            {(["hour", "day", "week"] as const).map((g, i) => (
              <div key={g} className="flex items-center">
                {i > 0 && <div className="w-px h-4 bg-white/10" />}
                <Seg active={granularity === g} onClick={() => setGranularity(g)}>
                  {g === "hour" ? "Hour" : g === "day" ? "Day" : "Week"}
                </Seg>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center rounded-md overflow-hidden border border-white/10">
          <Seg active={span === "full"} onClick={() => setSpan("full")}>
            Full
          </Seg>
          <div className="w-px h-4 bg-white/10" />
          <Seg active={span === "window"} onClick={() => setSpan("window")}>
            Window
          </Seg>
        </div>
        {/* Window size (columns) is only meaningful in window mode. */}
        {span === "window" && (
          <Stepper
            label="Win"
            value={windowSize}
            suffix={timeAxis ? (granularity === "hour" ? "h" : granularity === "day" ? "d" : "w") : ""}
            min={1}
            onChange={(v) => setWindowSize(v)}
          />
        )}
        {/* Units aggregated per column (scenes for forces, granularity units for
            streams) — controls window columns AND how Full separates the span. */}
        <Stepper
          label="Bucket"
          value={bucketSize}
          suffix={timeAxis ? (granularity === "hour" ? "h" : granularity === "day" ? "d" : "w") : " sc"}
          min={1}
          onChange={(v) => setBucketSize(v)}
        />

        {/* Stream scope — this branch's own streams (default) vs all branches'. */}
        {timeAxis && (
          <div className="flex items-center rounded-md overflow-hidden border border-white/10">
            <Seg active={!allBranches} onClick={() => setStreamScope("branch")}>
              Current
            </Seg>
            <div className="w-px h-4 bg-white/10" />
            <Seg active={allBranches} onClick={() => setStreamScope("all")}>
              All Branches
            </Seg>
          </div>
        )}
      </div>

      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        {layout ? (
          <svg width={layout.w} height={layout.h} className="block">
            {/* Time-unit gridlines — the cell boundaries of the steady continuum. */}
            <g>
              {layout.gridLines.map((x, i) => (
                <line
                  key={`gl-${i}`}
                  x1={x}
                  x2={x}
                  y1={TOP - 4}
                  y2={layout.h - BOT + 4}
                  stroke="var(--graph-edge)"
                  strokeOpacity={0.14}
                  strokeWidth={1}
                />
              ))}
            </g>
            {/* Timestamps — centred BETWEEN the gridlines (one per cell). */}
            <g>
              {layout.buckets.map((bk, b) => (
                <text
                  key={`bl-${bk.key}-${b}`}
                  x={layout.cellCenter(b)}
                  y={12}
                  textAnchor="middle"
                  className="pointer-events-none select-none"
                  fontSize={9}
                  fill="currentColor"
                  fillOpacity={
                    layout.nowX !== null && layout.cellCenter(b) === layout.nowX
                      ? 0.75
                      : 0.4
                  }
                >
                  {bk.label.length > 14
                    ? bk.label.slice(0, 13) + "…"
                    : bk.label}
                </text>
              ))}
            </g>
            <g>
              {layout.segs.map((s, i) => {
                const act = hovered === null || hovered === s.id;
                return (
                  <path
                    key={`s-${s.id}-${i}`}
                    d={ribbon(s.sx, s.tx, s.sy0, s.sy1, s.ty0, s.ty1)}
                    fill={layout.color(s.id)}
                    fillOpacity={act ? 0.34 : 0.07}
                    style={{ transition: "fill-opacity 120ms" }}
                  />
                );
              })}
            </g>
            <g>
              {layout.nodes.map((n) => {
                const m = layout.meta.get(n.id);
                const bandH = n.y1 - n.y0;
                const dim = !!(m?.closed || m?.abandoned);
                const act = hovered === null || hovered === n.id;
                return (
                  <g
                    key={`${n.b}:${n.id}`}
                    className="cursor-pointer"
                    onClick={() => onPick(n.id)}
                    onMouseEnter={(e) => {
                      setHovered(n.id);
                      const rect = wrapRef.current?.getBoundingClientRect();
                      setTip(
                        rect
                          ? {
                              x: e.clientX - rect.left,
                              y: e.clientY - rect.top,
                              id: n.id,
                              label: m?.label ?? n.id,
                              sub: m?.closed
                                ? "closed"
                                : m?.abandoned
                                  ? "abandoned"
                                  : "",
                            }
                          : null,
                      );
                    }}
                    onMouseMove={(e) => {
                      const rect = wrapRef.current?.getBoundingClientRect();
                      if (rect)
                        setTip((t) =>
                          t
                            ? {
                                ...t,
                                x: e.clientX - rect.left,
                                y: e.clientY - rect.top,
                              }
                            : t,
                        );
                    }}
                    onMouseLeave={() => {
                      setHovered(null);
                      setTip(null);
                    }}
                    opacity={act ? 1 : 0.45}
                    style={{ transition: "opacity 120ms" }}
                  >
                    <rect
                      x={n.x}
                      y={n.y0}
                      width={NODE_W}
                      height={Math.max(1, bandH)}
                      rx={2}
                      fill={layout.color(n.id)}
                      fillOpacity={dim ? 0.5 : 1}
                      stroke={
                        m?.abandoned
                          ? "#ef4444"
                          : m?.closed
                            ? "#a855f7"
                            : "transparent"
                      }
                      strokeWidth={dim ? 1 : 0}
                    />
                  </g>
                );
              })}
            </g>
            {/* Band labels — own layer ABOVE all bars + ribbons so a later
                column's bar never paints over an earlier band's label. Kept
                COMPACT (truncated to the column's room) to stay readable; the
                full wrapping text lives in the hover tooltip. Toggle with the
                Labels control. */}
            {showLabels && (
              <g className="pointer-events-none select-none">
                {layout.nodes.map((n) => {
                  const m = layout.meta.get(n.id);
                  const bandH = n.y1 - n.y0;
                  const isFirst = layout.firstBucketOf.get(n.id) === n.b;
                  const isLastCol = n.b === layout.B - 1;
                  const labelRoom = layout.step - NODE_W - 12;
                  const showLabel =
                    isFirst && bandH >= 9 && m && (labelRoom > 24 || isLastCol);
                  if (!showLabel) return null;
                  const dim = !!(m?.closed || m?.abandoned);
                  const act = hovered === null || hovered === n.id;
                  const charBudget = Math.max(
                    6,
                    Math.floor(Math.max(labelRoom, 130) / 6.2),
                  );
                  const full = m?.label ?? "";
                  const text =
                    full.length <= charBudget
                      ? full
                      : full.slice(0, charBudget - 1) + "…";
                  return (
                    <text
                      key={`lbl-${n.b}:${n.id}`}
                      x={isLastCol ? n.x - 6 : n.x + NODE_W + 6}
                      y={n.y0 + bandH / 2}
                      textAnchor={isLastCol ? "end" : "start"}
                      dominantBaseline="middle"
                      fontSize={Math.min(11, Math.max(9, bandH * 0.5))}
                      fill="currentColor"
                      fillOpacity={dim ? 0.45 : 0.9}
                      opacity={act ? 1 : 0.3}
                      style={{ transition: "opacity 120ms" }}
                    >
                      {text}
                    </text>
                  );
                })}
              </g>
            )}
            {/* Playhead — present scene, drawn on top like a video editor's
                index cursor: a solid vibrant line + a downward triangle. */}
            {layout.nowX !== null && (
              <g className="pointer-events-none">
                <line
                  x1={layout.nowX}
                  x2={layout.nowX}
                  y1={9}
                  y2={layout.h - BOT + 2}
                  stroke="#22d3ee"
                  strokeOpacity={0.95}
                  strokeWidth={1.5}
                />
                <polygon
                  points={`${layout.nowX - 5},1 ${layout.nowX + 5},1 ${layout.nowX},10`}
                  fill="#22d3ee"
                />
              </g>
            )}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={IconThread}
              title={
                source === "streams"
                  ? "No stream priors to chart."
                  : source === "world"
                    ? "No world volume to chart."
                    : source === "system"
                      ? "No system volume to chart."
                      : "No fate volume to chart."
              }
              hint={
                source === "streams"
                  ? "Streams gather priors over time — once they do, their influence shows here."
                  : source === "world"
                    ? "No entity world-graph growth recorded yet — generate scenes to see world influence over time."
                    : source === "system"
                      ? "No system-graph growth recorded yet — generate scenes to see system influence over time."
                      : "No thread attention recorded yet — generate scenes to see fate influence over time."
              }
            />
          </div>
        )}

        {/* Hover tooltip — world-graph style card with the FULL, wrapping band
            label. Given a DEFINITE width (otherwise an absolutely-positioned +
            transl(-50%) element shrink-wraps to the space right of the cursor
            and reads far too narrow) and clamped to stay on-screen. Flips below
            the cursor near the top edge so it never clips. */}
        {tip &&
          layout &&
          (() => {
            const W = 288;
            const HALF = W / 2;
            const below = tip.y < 88;
            const color = layout.color(tip.id);
            const left = Math.min(
              Math.max(tip.x, HALF + 4),
              Math.max(size.w - HALF - 4, HALF + 4),
            );
            return (
              <div
                className="absolute z-40 pointer-events-none"
                style={{
                  width: W,
                  left,
                  top: below ? tip.y + 14 : tip.y - 12,
                  transform: below
                    ? "translate(-50%, 0)"
                    : "translate(-50%, -100%)",
                }}
              >
                {below && (
                  <div className="flex justify-center">
                    <div className="w-2.5 h-2.5 bg-bg-elevated border-l border-t border-border rotate-45 -mb-1.5" />
                  </div>
                )}
                <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 shadow-xl">
                  <div className="flex items-start gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5"
                      style={{
                        background: color,
                        boxShadow: `0 0 6px ${color}80`,
                      }}
                    />
                    <span className="text-xs font-semibold leading-snug text-text-primary wrap-break-word">
                      {tip.label}
                      {tip.sub && (
                        <span className="text-[10px] font-normal text-text-dim capitalize">
                          {" "}
                          · {tip.sub}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                {!below && (
                  <div className="flex justify-center">
                    <div className="w-2.5 h-2.5 bg-bg-elevated border-r border-b border-border rotate-45 -mt-1.5" />
                  </div>
                )}
              </div>
            );
          })()}
      </div>
    </div>
  );
}
