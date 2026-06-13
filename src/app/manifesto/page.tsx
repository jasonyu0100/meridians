"use client";
// Manifesto page — long-form vision/theory: forces, formulas, validation, GTM, with LaTeX + D3 visuals.

import { ARCHETYPE_COLORS, ArchetypeIcon } from "@/components/ArchetypeIcon";
import { StarField } from "@/components/effects/StarField";
import { ThinkingAnimation } from "@/components/generation/ThinkingAnimation";
import { REASONING_NODE_COLORS } from "@/lib/graph/reasoning-node-colors";
import type { ThinkingStyle } from "@/lib/ai/reasoning-graph/types";
import * as d3 from "d3";
import dagre from "dagre";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useEffect, useMemo, useState } from "react";

/* ── LaTeX helpers ───────────────────────────────────────────────────────── */

function Tex({ children, display }: { children: string; display?: boolean }) {
  // renderToString is synchronous and pure — memoize it instead of round-tripping
  // through an effect, which would otherwise render empty then re-render.
  const html = useMemo(
    () =>
      katex.renderToString(children, {
        displayMode: display ?? false,
        throwOnError: false,
      }),
    [children, display],
  );
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function Eq({ tex, label }: { tex: string; label?: string }) {
  return (
    <div className="my-5 px-3 sm:px-5 py-4 rounded-lg bg-white/[0.03] border border-white/6 overflow-x-auto">
      {label && (
        <span className="text-[10px] uppercase tracking-wider text-white/20 block mb-2 font-mono">
          {label}
        </span>
      )}
      <div className="text-center">
        <Tex display>{tex}</Tex>
      </div>
    </div>
  );
}

/* ── Copy paper contents button ──────────────────────────────────────────── */

function CopyPaperButton() {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const handleCopy = async () => {
    const el = document.getElementById("paper-body");
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.innerText);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    setTimeout(() => setStatus("idle"), 2000);
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-[10px] font-mono text-white/45 hover:text-white/75 transition-colors"
    >
      {status === "copied" ? "copied" : status === "error" ? "failed" : "copy"}
    </button>
  );
}

/* ── Paper meta strip — minimal inline metadata ──────────────────────── */
function PaperMeta() {
  return (
    <div className="inline-flex items-center text-[10px] font-mono text-white/45">
      <span className="flex items-center gap-2">
        <span aria-hidden className="w-1 h-1 rounded-full bg-purple-300/70" />
        <span>40 min read</span>
      </span>
      <span aria-hidden className="mx-3 w-px h-3 bg-white/12" />
      <CopyPaperButton />
    </div>
  );
}

/* ── Reasoning graph diagram ─────────────────────────────────────────────── */

type RGNodeType =
  | "fate"
  | "reasoning"
  | "character"
  | "location"
  | "artifact"
  | "system"
  | "pattern"
  | "warning";

type RGEdgeType =
  | "requires"
  | "enables"
  | "constrains"
  | "risks"
  | "causes"
  | "reveals"
  | "develops"
  | "resolves"
  | "supersedes";

const RG_EDGE_COLORS: Record<RGEdgeType, string> = {
  enables: "#22c55e",
  constrains: "#ef4444",
  risks: "#f59e0b",
  requires: "#3b82f6",
  causes: "#64748b",
  reveals: "#a855f7",
  develops: "#06b6d4",
  resolves: "#10b981",
  supersedes: "#ec4899",
};

const RG_NODES: Array<{ id: string; idx: number; type: RGNodeType; label: string }> = [
  { id: "F1",  idx: 0,  type: "fate",      label: "Stone must be claimed" },
  { id: "F2",  idx: 1,  type: "fate",      label: "Betrayal must resolve" },
  { id: "R1",  idx: 2,  type: "reasoning", label: "Solve the chamber trials" },
  { id: "A1",  idx: 3,  type: "artifact",  label: "Mirror of Erised" },
  { id: "F3",  idx: 4,  type: "fate",      label: "Harry's agency tested" },
  { id: "R4",  idx: 5,  type: "reasoning", label: "Unmask Quirrell late" },
  { id: "L1",  idx: 6,  type: "location",  label: "Third-floor chamber" },
  { id: "S1",  idx: 7,  type: "system",    label: "Protections test virtue" },
  { id: "PT1", idx: 8,  type: "pattern",   label: "Mirror reads desire" },
  { id: "R3",  idx: 9,  type: "reasoning", label: "Pass the guardian trio" },
  { id: "C2",  idx: 10, type: "character", label: "Hermione — logic" },
  { id: "C3",  idx: 11, type: "character", label: "Ron — sacrifice" },
  { id: "C1",  idx: 12, type: "character", label: "Harry — desire-pure" },
  { id: "C4",  idx: 13, type: "character", label: "Quirrell — concealed host" },
  { id: "WN1", idx: 14, type: "warning",   label: "No adult shortcut" },
  { id: "WN2", idx: 15, type: "warning",   label: "Avoid obvious Snape" },
  { id: "PT2", idx: 16, type: "pattern",   label: "Sacrifice earns passage" },
  { id: "R5",  idx: 17, type: "reasoning", label: "Trials test a trait each" },
];

const RG_EDGES: Array<{ from: string; to: string; type: RGEdgeType }> = [
  { from: "F1",  to: "F2",  type: "risks"      },
  { from: "F1",  to: "R1",  type: "requires"   },
  { from: "F1",  to: "L1",  type: "causes"     },
  { from: "F1",  to: "R3",  type: "requires"   },
  { from: "F2",  to: "R4",  type: "requires"   },
  { from: "F2",  to: "C4",  type: "reveals"    },
  { from: "R1",  to: "A1",  type: "requires"   },
  { from: "R1",  to: "R5",  type: "enables"    },
  { from: "A1",  to: "F1",  type: "resolves"   },
  { from: "A1",  to: "C1",  type: "develops"   },
  { from: "S1",  to: "A1",  type: "constrains" },
  { from: "S1",  to: "R1",  type: "constrains" },
  { from: "PT1", to: "A1",  type: "reveals"    },
  { from: "F3",  to: "C1",  type: "develops"   },
  { from: "F3",  to: "R3",  type: "requires"   },
  { from: "R4",  to: "C4",  type: "requires"   },
  { from: "R4",  to: "F2",  type: "resolves"   },
  { from: "C4",  to: "F3",  type: "risks"      },
  { from: "R3",  to: "C1",  type: "requires"   },
  { from: "R3",  to: "C2",  type: "requires"   },
  { from: "R3",  to: "C3",  type: "requires"   },
  { from: "R5",  to: "R3",  type: "causes"     },
  { from: "R5",  to: "C2",  type: "enables"    },
  { from: "WN1", to: "R1",  type: "constrains" },
  { from: "WN1", to: "C1",  type: "risks"      },
  { from: "WN2", to: "R4",  type: "constrains" },
  { from: "WN2", to: "F2",  type: "risks"      },
  { from: "PT2", to: "C3",  type: "reveals"    },
  { from: "PT2", to: "R3",  type: "develops"   },
  { from: "C1",  to: "F3",  type: "develops"   },
];

const RG_NODE_WIDTH = 200;
const RG_NODE_HEIGHT = 56;

function ReasoningGraphDiagram() {
  // Dagre layout — same library + options as the in-app ReasoningGraphView.
  const layout = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "TB", nodesep: 32, ranksep: 60, marginx: 16, marginy: 16 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of RG_NODES) g.setNode(n.id, { width: RG_NODE_WIDTH, height: RG_NODE_HEIGHT });
    for (const e of RG_EDGES) g.setEdge(e.from, e.to);
    dagre.layout(g);

    const nodes = RG_NODES.map((n) => {
      const nd = g.node(n.id);
      return { ...n, x: nd.x, y: nd.y };
    });
    const edges = RG_EDGES.map((e) => {
      const ed = g.edge(e.from, e.to);
      return { ...e, points: ed?.points ?? [] };
    });
    const graph = g.graph();
    const width = (graph.width ?? 1200) as number;
    const height = (graph.height ?? 800) as number;
    return { nodes, edges, width, height };
  }, []);

  // Smooth path generator — same curve as the in-app view (curveBasis).
  const line = useMemo(
    () =>
      d3
        .line<{ x: number; y: number }>()
        .x((p) => p.x)
        .y((p) => p.y)
        .curve(d3.curveBasis),
    [],
  );

  const { nodes, edges, width, height } = layout;

  return (
    <div className="mt-6 mb-3 rounded-xl border border-white/8 bg-linear-to-b from-white/2 to-white/4 px-3 py-4 overflow-x-auto shadow-lg">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block mx-auto min-w-205 w-full h-auto"
        style={{ aspectRatio: `${width} / ${height}` }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {Object.entries(RG_EDGE_COLORS).map(([type, color]) => (
            <marker
              key={type}
              id={`rg-arrow-${type}`}
              viewBox="0 -5 10 10"
              refX="8"
              refY="0"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,-4L10,0L0,4" fill={color} />
            </marker>
          ))}
        </defs>

        {/* Edges — curveBasis paths through dagre's edge points */}
        {edges.map((e, ei) => {
          const color = RG_EDGE_COLORS[e.type];
          const d = line(e.points) ?? "";
          return (
            <path
              key={`e-${ei}`}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={1.75}
              opacity={0.7}
              markerEnd={`url(#rg-arrow-${e.type})`}
            />
          );
        })}

        {/* Edge labels — midpoint of the polyline */}
        {edges.map((e, ei) => {
          if (e.points.length < 2) return null;
          const mid = e.points[Math.floor(e.points.length / 2)];
          return (
            <text
              key={`elbl-${ei}`}
              x={mid.x}
              y={mid.y - 6}
              fill={RG_EDGE_COLORS[e.type]}
              fontSize="9"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              textAnchor="middle"
              opacity={0.9}
            >
              {e.type}
            </text>
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const c = REASONING_NODE_COLORS[n.type];
          const x = n.x - RG_NODE_WIDTH / 2;
          const y = n.y - RG_NODE_HEIGHT / 2;
          return (
            <g key={n.id}>
              <rect
                x={x}
                y={y}
                width={RG_NODE_WIDTH}
                height={RG_NODE_HEIGHT}
                rx={8}
                ry={8}
                fill={c.fill}
                stroke={c.stroke}
                strokeWidth={2}
              />
              {/* Index badge (top-left) */}
              <circle cx={x} cy={y} r={12} fill="#0f172a" stroke="#475569" strokeWidth={1} />
              <text
                x={x}
                y={y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="10"
                fontWeight="700"
                fill="#e2e8f0"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
              >
                {n.idx}
              </text>
              {/* Type badge (top-right) */}
              <rect
                x={x + RG_NODE_WIDTH - 60}
                y={y + 6}
                width={54}
                height={16}
                rx={4}
                fill="rgba(0,0,0,0.3)"
              />
              <text
                x={x + RG_NODE_WIDTH - 33}
                y={y + 14}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="9"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontWeight="500"
                fill={c.text}
                style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                {n.type.slice(0, 9)}
              </text>
              {/* Main label */}
              <text
                x={n.x}
                y={n.y + 6}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="11"
                fontWeight="500"
                fill={c.text}
                fontFamily="system-ui"
              >
                {n.label.length > 28 ? n.label.slice(0, 26) + "…" : n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Variable scenario diagram (parallel coordinates) ────────────────────── */

const VAR_AXES: [string, string][] = [
  ["Institutional", "drift"],
  ["Actor", "reversal"],
  ["External", "shock"],
  ["Mechanism", "ignition"],
  ["Attention", "saturation"],
];

const VAR_SCENARIOS: {
  name: string;
  color: string;
  prob: number;
  priorLogit: number;
  intensities: number[];
}[] = [
  { name: "Modal continuation",  color: "#22d3ee", prob: 0.46, priorLogit:  1.6, intensities: [2, 1, 0, 1, 2] },
  { name: "Slow consolidation",  color: "#a78bfa", prob: 0.28, priorLogit:  1.1, intensities: [3, 1, 0, 0, 2] },
  { name: "External disruption", color: "#f59e0b", prob: 0.18, priorLogit:  0.7, intensities: [1, 2, 3, 1, 2] },
  { name: "Mechanism rupture",   color: "#ef4444", prob: 0.08, priorLogit: -0.1, intensities: [1, 3, 1, 4, 3] },
];

function VariableScenarioDiagram() {
  const W = 680;
  const H = 280;
  const axisTop = 30;
  const axisBottom = 220;
  const xs = [80, 200, 320, 440, 560];
  const yFor = (lvl: number) => axisBottom - (lvl / 4) * (axisBottom - axisTop);

  return (
    <figure className="my-10">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Axes */}
        {xs.map((x, ai) => (
          <g key={ai}>
            <line
              x1={x}
              y1={axisTop}
              x2={x}
              y2={axisBottom}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={1}
            />
            {[0, 1, 2, 3, 4].map((lvl) => (
              <line
                key={lvl}
                x1={x - 4}
                y1={yFor(lvl)}
                x2={x + 4}
                y2={yFor(lvl)}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth={1}
              />
            ))}
            <text
              x={x}
              y={axisBottom + 20}
              textAnchor="middle"
              className="fill-white/50"
              fontSize={10}
              fontFamily="ui-monospace, monospace"
            >
              {VAR_AXES[ai][0]}
            </text>
            <text
              x={x}
              y={axisBottom + 34}
              textAnchor="middle"
              className="fill-white/35"
              fontSize={10}
              fontFamily="ui-monospace, monospace"
            >
              {VAR_AXES[ai][1]}
            </text>
          </g>
        ))}

        {/* Intensity scale on first axis */}
        {[0, 1, 2, 3, 4].map((lvl) => (
          <text
            key={lvl}
            x={xs[0] - 12}
            y={yFor(lvl) + 3}
            textAnchor="end"
            className="fill-white/35"
            fontSize={9}
            fontFamily="ui-monospace, monospace"
          >
            {lvl}
          </text>
        ))}

        {/* Scenario polylines */}
        {VAR_SCENARIOS.map((s) => {
          const points = s.intensities
            .map((iv, ai) => `${xs[ai]},${yFor(iv)}`)
            .join(" ");
          return (
            <g key={s.name}>
              <polyline
                points={points}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.55 + s.prob * 0.55}
              />
              {s.intensities.map((iv, ai) => (
                <circle
                  key={ai}
                  cx={xs[ai]}
                  cy={yFor(iv)}
                  r={3.5}
                  fill={s.color}
                  opacity={0.9}
                />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 px-2">
        {VAR_SCENARIOS.map((s) => (
          <div
            key={s.name}
            className="flex items-center gap-2 text-[11px] text-white/55"
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: s.color }}
            />
            <span className="font-mono tabular-nums text-white/45 w-8 shrink-0">
              {Math.round(s.prob * 100)}%
            </span>
            <span className="truncate">{s.name}</span>
          </div>
        ))}
      </div>

      <figcaption className="text-[11px] text-white/35 mt-4 leading-relaxed text-center max-w-2xl mx-auto">
        Parallel coordinates over five variable axes. Each scenario is a
        polyline; vertical position is intensity (0 off → 4 extreme).
        Probabilities are softmax over per-scenario priorLogits — most mass
        clusters on modal continuations, a thin tail covers rupture.
      </figcaption>
    </figure>
  );
}

/* ── Influence alluvial (same UI as the in-app Influence view) ───────────── */

// Sample Fate-source streams — each band is a question the room carries, its
// width at a scene-bucket = the attention (volume) it drew there. Bands enter,
// swell toward the climax, and resolve, exactly as the live alluvial reads.
const ALLUVIAL_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6",
  "#f43f5e", "#8b5cf6", "#0ea5e9", "#d946ef", "#eab308",
  "#22c55e", "#fb7185", "#3b82f6",
];
const ALLUVIAL_BUCKETS = [
  "1–6", "7–12", "13–18", "19–24", "25–30", "31–36", "37–42",
  "43–48", "49–54", "55–60", "61–66", "67–72", "73–78", "79–84",
  "85–90", "91–96", "97–102", "103–108",
];
// No band runs the full width — every question enters and exits, and the
// lifespans are interleaved so attention rolls forward: early questions resolve
// and hand the room to mid-arc ones, which give way to late entrants. Magnitudes
// span a wide range (a few dominate, others stay marginal) and every band spikes
// and dips scene-to-scene. The result weaves and crosses with peaks and valleys.
const ALLUVIAL_STREAMS: { label: string; vols: number[]; status?: "closed" }[] = [
  { label: "Will the alliance hold?",       vols: [12, 6, 20, 9, 26, 11, 22, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], status: "closed" },
  { label: "Who controls the corridor?",    vols: [5, 11, 4, 16, 7, 19, 8, 24, 10, 6, 0, 0, 0, 0, 0, 0, 0, 0], status: "closed" },
  { label: "Can we cover the supply gap?",  vols: [4, 7, 3, 6, 2, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], status: "closed" },
  { label: "Will the board ratify?",        vols: [8, 3, 10, 5, 7, 2, 5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], status: "closed" },
  { label: "Will the rival commit first?",  vols: [0, 0, 5, 2, 11, 4, 16, 6, 9, 20, 7, 14, 0, 0, 0, 0, 0, 0] },
  { label: "Who leaked the memo?",          vols: [0, 0, 0, 3, 6, 1, 7, 2, 8, 3, 6, 2, 4, 0, 0, 0, 0, 0], status: "closed" },
  { label: "Does the new entrant disrupt?", vols: [0, 0, 0, 0, 4, 9, 3, 14, 6, 22, 10, 28, 13, 30, 16, 0, 0, 0] },
  { label: "Can we hold the valuation?",    vols: [0, 0, 0, 0, 0, 0, 3, 9, 4, 16, 7, 22, 11, 28, 14, 9, 31, 18] },
  { label: "Will sanctions land?",          vols: [0, 0, 0, 0, 0, 0, 0, 0, 2, 5, 1, 6, 3, 7, 2, 8, 4, 9] },
  { label: "Will the founder walk?",        vols: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 9, 4, 17, 7, 26, 13, 20] },
  { label: "Who succeeds the chair?",       vols: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 12, 6, 18, 11] },
];

// Cubic-bezier ribbon between two stacked bands — identical to SankeyView.
function alluvialRibbon(sx: number, tx: number, sy0: number, sy1: number, ty0: number, ty1: number): string {
  const xm = (sx + tx) / 2;
  return `M${sx},${sy0} C${xm},${sy0} ${xm},${ty0} ${tx},${ty0} L${tx},${ty1} C${xm},${ty1} ${xm},${sy1} ${sx},${sy1} Z`;
}

function InfluenceAlluvialDiagram() {
  const W = 760, H = 320;
  const NODE_W = 10, PAD = 7, TOP = 30, BOT = 14, ML = 12, MR = 12;
  const [hovered, setHovered] = useState<number | null>(null);

  const layout = useMemo(() => {
    const B = ALLUVIAL_BUCKETS.length;
    const cellW = (W - ML - MR) / B;
    const cellCenter = (b: number) => ML + (b + 0.5) * cellW;
    const cellEdge = (b: number) => ML + b * cellW;
    const nodeLeft = (b: number) => cellCenter(b) - NODE_W / 2;

    // Per-bucket volume maps, then a single global scale so the busiest column
    // fills the height — the streamgraph stays centred with PAD gaps.
    const vol = (s: number, b: number) => ALLUVIAL_STREAMS[s].vols[b] ?? 0;
    let scale = Infinity;
    for (let b = 0; b < B; b++) {
      let total = 0, count = 0;
      for (let s = 0; s < ALLUVIAL_STREAMS.length; s++) {
        if (vol(s, b) > 0) { total += vol(s, b); count++; }
      }
      if (total > 0) {
        const availH = H - TOP - BOT - PAD * Math.max(0, count - 1);
        scale = Math.min(scale, Math.max(0.2, availH) / total);
      }
    }
    if (!isFinite(scale)) scale = 1;

    const pos = new Map<string, { y0: number; y1: number }>();
    for (let b = 0; b < B; b++) {
      let used = 0, count = 0;
      for (let s = 0; s < ALLUVIAL_STREAMS.length; s++) {
        if (vol(s, b) > 0) { used += vol(s, b) * scale; count++; }
      }
      used += PAD * Math.max(0, count - 1);
      let cursor = TOP + Math.max(0, (H - TOP - BOT - used) / 2);
      for (let s = 0; s < ALLUVIAL_STREAMS.length; s++) {
        if (vol(s, b) <= 0) continue;
        pos.set(`${b}:${s}`, { y0: cursor, y1: cursor + vol(s, b) * scale });
        cursor += vol(s, b) * scale + PAD;
      }
    }

    const segs: { s: number; sx: number; tx: number; sy0: number; sy1: number; ty0: number; ty1: number }[] = [];
    const nodes: { s: number; b: number; x: number; y0: number; y1: number }[] = [];
    const firstBucket = new Map<number, number>();
    for (let s = 0; s < ALLUVIAL_STREAMS.length; s++) {
      const bs: number[] = [];
      for (let b = 0; b < B; b++) if (vol(s, b) > 0) bs.push(b);
      if (bs.length) firstBucket.set(s, bs[0]);
      for (const b of bs) {
        const p = pos.get(`${b}:${s}`)!;
        nodes.push({ s, b, x: nodeLeft(b), y0: p.y0, y1: p.y1 });
      }
      for (let k = 0; k + 1 < bs.length; k++) {
        const p0 = pos.get(`${bs[k]}:${s}`)!;
        const p1 = pos.get(`${bs[k + 1]}:${s}`)!;
        segs.push({
          s, sx: nodeLeft(bs[k]) + NODE_W, tx: nodeLeft(bs[k + 1]),
          sy0: p0.y0, sy1: p0.y1, ty0: p1.y0, ty1: p1.y1,
        });
      }
    }
    const grid = Array.from({ length: B + 1 }, (_, b) => cellEdge(b));
    return { B, cellCenter, nodeLeft, segs, nodes, firstBucket, grid, step: cellW, nowX: cellCenter(B - 1) };
  }, []);

  return (
    <figure className="mt-6 mb-3">
      <div className="rounded-xl border border-white/8 bg-linear-to-b from-white/2 to-white/4 shadow-lg overflow-hidden px-3 py-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" preserveAspectRatio="xMidYMid meet" style={{ aspectRatio: `${W} / ${H}` }}>
          {/* Gridlines + bucket labels */}
          {layout.grid.map((x, i) => (
            <line key={`g-${i}`} x1={x} x2={x} y1={TOP - 4} y2={H - BOT + 4} stroke="#94a3b8" strokeOpacity={0.12} strokeWidth={1} />
          ))}
          {ALLUVIAL_BUCKETS.map((lbl, b) => (
            (b % 2 === 0 || b === layout.B - 1) && (
              <text key={`bl-${b}`} x={layout.cellCenter(b)} y={16} textAnchor="middle" fontSize={9} fill="#cbd5e1" fillOpacity={b === layout.B - 1 ? 0.7 : 0.34} fontFamily="ui-monospace, monospace">{lbl}</text>
            )
          ))}

          {/* Ribbons */}
          <g>
            {layout.segs.map((s, i) => {
              const act = hovered === null || hovered === s.s;
              return (
                <path key={`r-${i}`} d={alluvialRibbon(s.sx, s.tx, s.sy0, s.sy1, s.ty0, s.ty1)} fill={ALLUVIAL_COLORS[s.s % ALLUVIAL_COLORS.length]} fillOpacity={act ? 0.34 : 0.07} style={{ transition: "fill-opacity 120ms" }} />
              );
            })}
          </g>

          {/* Container bars (the per-bucket "units") */}
          <g>
            {layout.nodes.map((n, i) => {
              const st = ALLUVIAL_STREAMS[n.s];
              const dim = st.status === "closed";
              const act = hovered === null || hovered === n.s;
              return (
                <rect
                  key={`n-${i}`}
                  x={n.x} y={n.y0} width={NODE_W} height={Math.max(1, n.y1 - n.y0)} rx={2}
                  fill={ALLUVIAL_COLORS[n.s % ALLUVIAL_COLORS.length]}
                  fillOpacity={dim ? 0.5 : 1}
                  stroke={dim ? "#a855f7" : "transparent"} strokeWidth={dim ? 1 : 0}
                  opacity={act ? 1 : 0.45}
                  style={{ cursor: "pointer", transition: "opacity 120ms" }}
                  onMouseEnter={() => setHovered(n.s)}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            })}
          </g>

          {/* Band labels at first bucket */}
          <g className="pointer-events-none select-none">
            {layout.nodes.map((n, i) => {
              if (layout.firstBucket.get(n.s) !== n.b) return null;
              const bandH = n.y1 - n.y0;
              if (bandH < 9) return null;
              const isLast = n.b === layout.B - 1;
              const act = hovered === null || hovered === n.s;
              return (
                <text key={`l-${i}`} x={isLast ? n.x - 6 : n.x + NODE_W + 6} y={n.y0 + bandH / 2} textAnchor={isLast ? "end" : "start"} dominantBaseline="middle" fontSize={Math.min(11, Math.max(9, bandH * 0.5))} fill="#e2e8f0" fillOpacity={ALLUVIAL_STREAMS[n.s].status === "closed" ? 0.5 : 0.9} opacity={act ? 1 : 0.3} style={{ transition: "opacity 120ms" }}>
                  {ALLUVIAL_STREAMS[n.s].label}
                </text>
              );
            })}
          </g>

          {/* Playhead — present scene */}
          <line x1={layout.nowX} x2={layout.nowX} y1={9} y2={H - BOT + 2} stroke="#22d3ee" strokeOpacity={0.95} strokeWidth={1.5} />
          <polygon points={`${layout.nowX - 5},1 ${layout.nowX + 5},1 ${layout.nowX},10`} fill="#22d3ee" />
        </svg>
      </div>
      <figcaption className="text-[11px] text-white/35 mt-4 leading-relaxed text-center max-w-2xl mx-auto">
        Influence alluvial — Fate source, Unit mode. Columns are scene-buckets;
        each band is a question the room carries, its width the attention it drew
        there. Bands enter, swell toward the climax, and resolve (dimmed,
        edged bands have <em>closed</em>); the cyan playhead marks the present.
      </figcaption>
    </figure>
  );
}

/* ── Thinking-mode explorer ──────────────────────────────────────────────── */

const THINKING_MODES: {
  key: ThinkingStyle;
  label: string;
  color: string;
}[] = [
  { key: "abduction", label: "Abduction", color: "#F97316" },
  { key: "divergent", label: "Divergent", color: "#FBBF24" },
  { key: "deduction", label: "Deduction", color: "#A855F7" },
  { key: "induction", label: "Induction", color: "#22D3EE" },
];

function ThinkingModeExplorer() {
  const [mode, setMode] = useState<ThinkingStyle>("abduction");

  return (
    <figure className="mt-6 mb-6">
      {/* Mode selector — minimal row of pills */}
      <div className="flex flex-wrap items-center justify-center gap-1.5 mb-4">
        {THINKING_MODES.map((m) => {
          const isActive = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] transition ${
                isActive
                  ? "bg-white/[0.06] text-white/85"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full transition-all"
                style={{
                  backgroundColor: m.color,
                  opacity: isActive ? 1 : 0.5,
                  boxShadow: isActive ? `0 0 8px ${m.color}` : "none",
                }}
              />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Animation stage — clean, minimal. Keyed on mode so switching remounts. */}
      <div className="flex justify-center items-center bg-black/30 rounded-lg py-3">
        <ThinkingAnimation
          key={mode}
          mode={mode}
          force="freeform"
          size="medium"
          networkBias="neutral"
          width={460}
          height={240}
        />
      </div>
    </figure>
  );
}

/* ── Section divider ─────────────────────────────────────────────────────── */

function Section({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-mono shrink-0">
          {label}
        </h2>
        <div className="flex-1 h-px bg-white/6" />
      </div>
      {children}
    </section>
  );
}

/* ── Prose helpers ───────────────────────────────────────────────────────── */

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-white/50 leading-[1.85] mt-3 first:mt-0">
      {children}
    </p>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-white/70">{children}</strong>;
}

/* ── Inline citation ─────────────────────────────────────────────────────── */
// Author-year style anchored to the Bibliography section. Subtle by default,
// brightens on hover so the citations don't fight the prose for attention.
function Cite({ id, label }: { id: string; label: string }) {
  return (
    <sup className="text-[9px] ml-0.5 leading-none">
      <a
        href={`#ref-${id}`}
        className="text-white/35 hover:text-white/80 no-underline"
      >
        {label}
      </a>
    </sup>
  );
}

/* ── Bibliography entry ──────────────────────────────────────────────────── */
// One row per reference. Renders as APA-ish prose with structured links so
// AI ingestion can chain through to the primary source via DOI / arXiv /
// publisher / open-access URLs.
function Ref({
  id,
  authors,
  year,
  title,
  venue,
}: {
  id: string;
  authors: string;
  year: string;
  title: string;
  venue: string;
  /** Accepted for source-compatibility with existing call sites but no
   *  longer rendered — references are bare citations now. */
  links?: Array<{ label: string; href: string }>;
}) {
  return (
    <p
      id={`ref-${id}`}
      className="text-[12px] text-white/45 leading-[1.7] scroll-mt-24"
    >
      <span className="text-white/65">{authors} ({year}).</span>{" "}
      <em className="text-white/55">{title}</em>.{" "}
      <span>{venue}.</span>
    </p>
  );
}

/* ── Shape mini-curve ────────────────────────────────────────────────────── */

function ShapeCurve({
  curve,
  color,
}: {
  curve: [number, number][];
  color: string;
}) {
  const points = curve.map(([x, y]) => `${x * 32},${16 - y * 14}`).join(" ");
  return (
    <svg width="32" height="16" viewBox="0 0 32 16" className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Cost calculation reference ────────────────────────────────────────────────
// Per-domain model split — pick the cheapest model that meets the bar for each
// kind of work. DeepSeek v4 Flash on the cheap deterministic paths; Gemini 2.5
// Flash on the structured-extraction and planning paths where the cheaper model
// stalls on schema discipline.
//
// DEFAULT_MODEL      Gemini 2.5 Flash    fallback — evaluation, briefing, game
//                                        theory, search synthesis, report
// GENERATE_MODEL     DeepSeek v4 Flash   scene generation — generateScenes,
//                                        generateNarrative, reconstruction edits
// WRITING_MODEL      DeepSeek v4 Flash   prose generation + rewrite
// PLANNING_MODEL     Gemini 2.5 Flash    scene plans, reasoning graph (CRG),
//                                        phase graph (PRG)
// ANALYSIS_MODEL     Gemini 2.5 Flash    full analysis pipeline (extraction,
//                                        reconciliation, fate re-extract,
//                                        beat-plan reverse-engineering)
// INTERACTION_MODEL  DeepSeek v4 Flash   chat, surveys, interviews
//
// Pricing: DeepSeek v4 Flash $0.14/M in · $0.28/M out; Gemini 2.5 Flash $0.30/M
// in · $2.50/M out (output-heavy planning & analysis pay the Gemini premium).
//
// GENERATION (per arc, ~4 scenes, ~4800 words):
//   generateScenes              1× DeepSeek  ~45K in + 8K out        = ~$0.01
//   generateReasoningGraph      1× Gemini    ~38K in + 7K out + reas = ~$0.04  (per-arc CRG)
//   generateScenePlan           4× Gemini    ~18K in + 8.5K out × 4  = ~$0.07
//   generateSceneProse          4× DeepSeek  ~12K in + 1.2K out × 4  = ~$0.01
//   expandWorld               ~⅓× Gemini    ~25K in + 5K out         = ~$0.01
//   generatePhaseGraph         rare Gemini   ~30K in + 5K out + reas = ~$0.03  (on-demand)
//                                                              Total ≈ $0.13/arc
//
// EVALUATION & REVISION (per arc, ~25% edit rate):
//   evaluateBranch              1× Gemini    ~12K in + 2K out        = ~$0.01
//   editScene/insertScene/etc  ~1× DeepSeek  ~30K in + 0.5K out      = ~$0.00
//   evaluatePlanQuality         1× Gemini    ~15K in + 1K out        = ~$0.01
//   evaluateProseQuality        1× Gemini    ~15K in + 1K out        = ~$0.01
//   rewriteSceneProse          ~1× DeepSeek  ~12K in + 1.5K out      = ~$0.00
//                                                              Total ≈ $0.03/arc
//
// ANALYSIS (per corpus) — Gemini 2.5 Flash, no reasoning:
//   extractSceneStructure       N×  ~6K in + 2K out × N             = ~$0.008/scene
//   reverseEngineerScenePlan    N×  ~5K in + 1K out × N             = ~$0.005/scene  (when extractPlans=true)
//   reextractFateWithLifecycle  N×  ~4K in + 1K out × N             = ~$0.004/scene
//   summariseWorldBuildBatch   ⌈N/12⌉× ~2K in + 0.3K out             = ~$0.001/scene
//   embeddings (OpenAI)         N×  summaries + propositions + prose = ~$0.003/scene
//   groupScenesIntoArcs         1×  ~2K in + 0.5K out               = ~$0.002 once
//   reconcileResults            1×  ~8K in + 2K out                 = ~$0.008 once
//   analyzeThreading            1×  ~3K in + 0.5K out               = ~$0.003 once
//   meta-extraction             1×  ~25K in + 3K out                = ~$0.020 once
//   Per scene: ~$0.021 · Per corpus once: ~$0.033
//
// END-TO-END (Create + Continue, from-scratch):
//   Short story (~10K, 3 arcs):    ~$0.24
//   Novel       (~85K, 21 arcs):   ~$3.20
//   Serial     (~500K, 125 arcs): ~$19.78
//
// END-TO-END (Analyse only, expert-priors flow):
//   77K novel  (~64 scenes):   ~$1.38
//   100K novel (~83 scenes):   ~$1.78
//   500K series (~416 scenes): ~$8.77
//
// World-only analysis skips reextract + grouping + threading: ~$0.013/scene + $0.020 once.

/* ── Business models ─────────────────────────────────────────────────────── */
//
// Working hypotheses, anchored to real per-arc / per-scene LLM costs
// from the reference block above (~$0.16 / arc end-to-end on the
// DeepSeek + Gemini split). A War Room session ≈ 1–2 arcs of forward
// play + interrogation + decision-matrix calls ≈ ~$0.30–$0.50 in LLM.
//
// Private: subscription on top of (essentially) free infra (IndexedDB,
// local data). Public: free-to-play distribution; revenue from pro
// subscriptions, opt-in betting markets, sponsorships / media. Public
// LLM cost amortises across a cohort so per-player marginal cost is
// cents per season even on a heavy game.

// Grassroots, not boutique consulting. The growth motion is the
// Player → Contributor → GM ladder: the card game spreads through
// networks, the community produces GMs, GMs run the rooms. Revenue
// still lands — recurring private rooms, pro tiers, and pilots a
// grown room can reach — but the GM is grown from the network, not
// staffed by us, so the bottleneck is network growth, not facilitator
// hiring. The three private dials below (setup, facilitation, software)
// still describe an early room a founder runs; the model scales by GMs
// multiplying. Every number is a hypothesis — price the first rooms by
// hand; publish a rate card only after.

type UnbundledLine = {
  line: string;
  shape: string;
  price: string;
  built: string;
};

const UNBUNDLED_LINES: UnbundledLine[] = [
  {
    line: "Software / access",
    shape: "recurring · SaaS",
    price: "$99–299 / mo · per room",
    built: "The only line a self-facilitating client pays. ~75–85% — no human in it.",
  },
  {
    line: "Facilitation",
    shape: "recurring · removable",
    price: "per-session or monthly retainer",
    built: "Sunsets to zero once the client's own GM is certified — graduation is a price cut they choose, not a margin shift we hope for.",
  },
  {
    line: "Setup / priming",
    shape: "one-time · services",
    price: "$15–40K · by corpus depth",
    built: "Recovered where the cost occurs, not amortised into subs. Pilot-end only — never at the entry door.",
  },
];

type Motion = {
  motion: string;
  price: string;
  role: string;
};

const MOTIONS: Motion[] = [
  {
    motion: "Free workshop",
    price: "$0 · social, world-seeding",
    role: "The grassroots entry. A free gathering that takes a real scenario and makes it playable — people play a game of Conviction (Read / Write / Play) and seed new worlds in the process. Onboarding, top of funnel.",
  },
  {
    motion: "Community",
    price: "$0 · the network",
    role: "The Signal chat and the network around a GM. Players become Contributors feeding priors to the model; the social fabric — and the next GMs — form here. Retention, not revenue.",
  },
  {
    motion: "Recurring room",
    price: "consumer sub · per room / seat",
    role: "A GM grown from the network runs a standing private room for a group or community. The recurring subscription line; the community supplies the facilitation, so margin isn't capped by us hiring.",
  },
  {
    motion: "Public + pro",
    price: "free-to-play + pro tiers",
    role: "Public rooms grow from private ones via the guest pass; pro subscriptions, opt-in betting, and sponsorship ride on top of free distribution. The B2C upside layer.",
  },
];

type PublicStream = {
  stream: string;
  unit: string;
  marginalCost: string;
  revenuePerUser: string;
  notes: string;
};

const PUBLIC_STREAMS: PublicStream[] = [
  {
    stream: "Free Tier (base)",
    unit: "per active player",
    marginalCost: "~$0.01 / season",
    revenuePerUser: "$0 (distribution)",
    notes: "Hosted substrate · LLM amortised across cohort · the funnel",
  },
  {
    stream: "Pro Subscription",
    unit: "per subscriber / mo",
    marginalCost: "~$0.10",
    revenuePerUser: "$9.99 – $19.99",
    notes: "Analytics, ELO history, private clones, ad-free, priority play",
  },
  {
    stream: "Betting Markets",
    unit: "per active bettor / mo",
    marginalCost: "~$0.05 (payment + KYC)",
    revenuePerUser: "~$2 – $10 (3–5% rake on book)",
    notes: "Opt-in real-money markets attached to specific plays · jurisdiction-gated",
  },
  {
    stream: "Media / Sponsorship",
    unit: "per franchise season",
    marginalCost: "negligible",
    revenuePerUser: "variable",
    notes: "Brand partnerships, league licensing, premium content tiers",
  },
];

function BusinessModels() {
  return (
    <div className="my-8 space-y-8">
      {/* ── Private: three lines ──────────────────────────────────── */}
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h4 className="text-[12.5px] font-semibold tracking-wide text-white/80">
            Private — priced by service-intensity, not features
          </h4>
          <span className="text-[10px] text-white/35 font-mono tabular-nums">
            three dials, not one ladder
          </span>
        </div>
        <div className="rounded-lg border border-white/6 bg-white/1.5 overflow-hidden">
          <table className="w-full text-[11.5px] table-fixed">
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[22%]" />
              <col className="w-[42%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-white/35 border-b border-white/8 bg-white/1.5">
                <th className="px-3 py-2 font-medium">Line</th>
                <th className="px-3 py-2 font-medium">Shape</th>
                <th className="px-3 py-2 font-medium font-mono tabular-nums">Illustrative</th>
                <th className="px-3 py-2 font-medium">Built to</th>
              </tr>
            </thead>
            <tbody>
              {UNBUNDLED_LINES.map((l) => (
                <tr key={l.line} className="border-b border-white/5 last:border-b-0 align-baseline">
                  <td className="px-3 py-2.5 font-medium text-white/85 leading-snug">{l.line}</td>
                  <td className="px-3 py-2.5 text-white/55 leading-snug">{l.shape}</td>
                  <td className="px-3 py-2.5 font-mono tabular-nums text-white/65 leading-snug">{l.price}</td>
                  <td className="px-3 py-2.5 text-white/55 leading-snug">{l.built}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Private: the motions (funnel) ─────────────────────────── */}
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h4 className="text-[12.5px] font-semibold tracking-wide text-white/80">
            The motions — the grassroots ladder onto the substrate
          </h4>
          <span className="text-[10px] text-white/35 font-mono tabular-nums">
            workshop → community → room → public
          </span>
        </div>
        <div className="rounded-lg border border-white/6 bg-white/1.5 overflow-hidden">
          <table className="w-full text-[11.5px] table-fixed">
            <colgroup>
              <col className="w-[16%]" />
              <col className="w-[30%]" />
              <col className="w-[54%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-white/35 border-b border-white/8 bg-white/1.5">
                <th className="px-3 py-2 font-medium">Motion</th>
                <th className="px-3 py-2 font-medium font-mono tabular-nums">Price</th>
                <th className="px-3 py-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {MOTIONS.map((m) => (
                <tr key={m.motion} className="border-b border-white/5 last:border-b-0 align-baseline">
                  <td className="px-3 py-2.5 font-medium text-white/85 leading-snug">{m.motion}</td>
                  <td className="px-3 py-2.5 font-mono tabular-nums text-white/65 leading-snug">{m.price}</td>
                  <td className="px-3 py-2.5 text-white/55 leading-snug">{m.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Public ────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h4 className="text-[12.5px] font-semibold tracking-wide text-white/80">
            Public — free-to-play distribution + value-add layers
          </h4>
          <span className="text-[10px] text-white/35 font-mono tabular-nums">
            LLM amortised across cohort · base game free
          </span>
        </div>
        <div className="rounded-lg border border-white/6 bg-white/1.5 overflow-hidden">
          <table className="w-full text-[11.5px] table-fixed">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[14%]" />
              <col className="w-[18%]" />
              <col className="w-[46%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-white/35 border-b border-white/8 bg-white/1.5">
                <th className="px-3 py-2 font-medium">Stream</th>
                <th className="px-3 py-2 font-medium font-mono tabular-nums">Cost / unit</th>
                <th className="px-3 py-2 font-medium font-mono tabular-nums text-white/55">Revenue / unit</th>
                <th className="px-3 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {PUBLIC_STREAMS.map((s) => (
                <tr key={s.stream} className="border-b border-white/5 last:border-b-0 align-baseline">
                  <td className="px-3 py-2.5 font-medium text-white/85 leading-snug">{s.stream}</td>
                  <td className="px-3 py-2.5 font-mono tabular-nums text-white/55">{s.marginalCost}</td>
                  <td className="px-3 py-2.5 font-mono tabular-nums text-white/70">{s.revenuePerUser}</td>
                  <td className="px-3 py-2.5 text-white/55 leading-snug">{s.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10.5px] text-white/35 italic leading-relaxed">
        The cost is human hours, not LLM &mdash; a session is rounding error; the spend is the
        hours a Game Master puts into a room. In the grassroots model those hours come from the{" "}
        <em>network</em>, not our payroll: the card game produces players, the community produces
        Contributors, and the committed graduate into GMs who facilitate their own rooms. The three
        private dials still describe an early room a founder runs &mdash; a one-time <em>setup</em>
        {" "}recovered where it occurs, a <em>facilitation</em> line that sunsets as the room&apos;s
        own GM takes over, and the cheap recurring <em>software</em> line that carries
        software-shape margin on its own &mdash; but the model scales by GMs multiplying through the
        network, so facilitation stops being a cost we have to staff and becomes something the
        community supplies. The entry door is the free workshop: a real scenario made playable,
        free and social, that seeds a world and a relationship rather than a one-night stand. Every number here is a
        hypothesis &mdash; price the first rooms by hand and publish a rate card only once the
        network shows where it flinches. Public economics stay separate; the cohort doesn&apos;t
        exist yet.
      </p>
    </div>
  );
}

/* ── Data ────────────────────────────────────────────────────────────────── */

const ARCHETYPES = [
  {
    key: "opus" as const,
    name: "Opus",
    desc: "All three balanced",
    color: ARCHETYPE_COLORS.opus,
  },
  {
    key: "series" as const,
    name: "Series",
    desc: "Fate + World",
    color: ARCHETYPE_COLORS.series,
  },
  {
    key: "atlas" as const,
    name: "Atlas",
    desc: "Fate + System",
    color: ARCHETYPE_COLORS.atlas,
  },
  {
    key: "chronicle" as const,
    name: "Chronicle",
    desc: "World + System",
    color: ARCHETYPE_COLORS.chronicle,
  },
  {
    key: "classic" as const,
    name: "Classic",
    desc: "Fate-driven",
    color: ARCHETYPE_COLORS.classic,
  },
  {
    key: "stage" as const,
    name: "Stage",
    desc: "World-driven",
    color: ARCHETYPE_COLORS.stage,
  },
  {
    key: "paper" as const,
    name: "Paper",
    desc: "System-driven",
    color: ARCHETYPE_COLORS.paper,
  },
  {
    key: "emerging" as const,
    name: "Emerging",
    desc: "Finding its voice",
    color: ARCHETYPE_COLORS.emerging,
  },
];

const SHAPES = [
  {
    name: "Climactic",
    desc: "Build, climax, release",
    curve: [
      [0, 0.2],
      [0.25, 0.5],
      [0.45, 0.8],
      [0.5, 1],
      [0.55, 0.8],
      [0.75, 0.5],
      [1, 0.25],
    ] as [number, number][],
  },
  {
    name: "Episodic",
    desc: "Multiple equal peaks",
    curve: [
      [0, 0.3],
      [0.1, 0.7],
      [0.2, 0.3],
      [0.35, 0.75],
      [0.5, 0.25],
      [0.65, 0.8],
      [0.8, 0.3],
      [0.9, 0.7],
      [1, 0.35],
    ] as [number, number][],
  },
  {
    name: "Rebounding",
    desc: "Dip then recovery",
    curve: [
      [0, 0.6],
      [0.2, 0.35],
      [0.4, 0.1],
      [0.6, 0.3],
      [0.8, 0.65],
      [1, 0.9],
    ] as [number, number][],
  },
  {
    name: "Peaking",
    desc: "Early peak, trails off",
    curve: [
      [0, 0.4],
      [0.2, 0.85],
      [0.35, 1],
      [0.55, 0.65],
      [0.75, 0.35],
      [1, 0.15],
    ] as [number, number][],
  },
  {
    name: "Escalating",
    desc: "Rising toward the end",
    curve: [
      [0, 0.1],
      [0.2, 0.2],
      [0.4, 0.35],
      [0.6, 0.55],
      [0.8, 0.8],
      [1, 1],
    ] as [number, number][],
  },
  {
    name: "Flat",
    desc: "Little variation",
    curve: [
      [0, 0.5],
      [0.25, 0.52],
      [0.5, 0.48],
      [0.75, 0.51],
      [1, 0.5],
    ] as [number, number][],
  },
] as const;

const SCALE_TIERS = [
  { key: "short", name: "Short", desc: "< 20 scenes", color: "#22D3EE" },
  { key: "story", name: "Story", desc: "20–50 scenes", color: "#22D3EE" },
  { key: "novel", name: "Novel", desc: "50–120 scenes", color: "#22D3EE" },
  { key: "epic", name: "Epic", desc: "120–300 scenes", color: "#22D3EE" },
  { key: "serial", name: "Serial", desc: "300+ scenes", color: "#22D3EE" },
] as const;

const DENSITY_TIERS = [
  {
    key: "sparse",
    name: "Sparse",
    desc: "< 0.5 entities/scene",
    color: "#34D399",
  },
  {
    key: "focused",
    name: "Focused",
    desc: "0.5–1.5 entities/scene",
    color: "#34D399",
  },
  {
    key: "developed",
    name: "Developed",
    desc: "1.5–2.5 entities/scene",
    color: "#34D399",
  },
  {
    key: "rich",
    name: "Rich",
    desc: "2.5–4.0 entities/scene",
    color: "#34D399",
  },
  {
    key: "sprawling",
    name: "Sprawling",
    desc: "4.0+ entities/scene",
    color: "#34D399",
  },
] as const;

/* ── Navigation items ────────────────────────────────────────────────────── */

const NAV_GROUPS: Array<{ label: string; items: Array<{ id: string; label: string }> }> = [
  {
    label: "Frame",
    items: [
      { id: "abstract", label: "Abstract" },
      { id: "problem", label: "Why Practice" },
      { id: "narrative-origin", label: "Narrative Origin" },
      { id: "wedge", label: "The Game Master" },
      { id: "approach", label: "The Substrate" },
    ],
  },
  {
    label: "Measurement",
    items: [
      { id: "hierarchy", label: "Hierarchy" },
      { id: "forces", label: "Forces" },
      { id: "fate-engine", label: "Fate Engine" },
    ],
  },
  {
    label: "Calibration",
    items: [
      { id: "validation", label: "Validation" },
      { id: "grading", label: "Grading" },
    ],
  },
  {
    label: "Knowing",
    items: [
      { id: "embeddings", label: "Embeddings" },
      { id: "classification", label: "Classification" },
      { id: "research", label: "Interrogation" },
    ],
  },
  {
    label: "Generation",
    items: [
      { id: "planning", label: "Reasoning Graphs" },
      { id: "variables", label: "Variable Scenarios" },
      { id: "voice", label: "Voice" },
      { id: "revision", label: "Reconstruction" },
    ],
  },
  {
    label: "The Room",
    items: [
      { id: "war-rooms", label: "War Rooms" },
      { id: "loop", label: "The Loop & Practice" },
    ],
  },
  {
    label: "Business",
    items: [
      { id: "architecture", label: "Architecture" },
      { id: "operating-model", label: "Operating Model" },
    ],
  },
  {
    label: "Close",
    items: [
      { id: "coda", label: "Coda" },
      { id: "bibliography", label: "Bibliography" },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((g) => g.items);

/* ── Side timeline nav ───────────────────────────────────────────────────── */

function TimelineNav({ activeId }: { activeId: string }) {
  // Find which group contains the active section so we can auto-expand it
  // even after the user has manually collapsed others.
  const activeGroupLabel = NAV_GROUPS.find((g) =>
    g.items.some((it) => it.id === activeId),
  )?.label;

  // Start with only the active group expanded; the user can toggle the rest.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of NAV_GROUPS) init[g.label] = g.label === activeGroupLabel;
    return init;
  });

  // As the reader scrolls between groups, keep only the active one open —
  // completed groups collapse so the rail stays focused on where you are.
  // Adjust during render (not in an effect) when the active group changes, so
  // manual toggles persist until the next scroll into a new group.
  const [prevActiveGroup, setPrevActiveGroup] = useState(activeGroupLabel);
  if (activeGroupLabel && activeGroupLabel !== prevActiveGroup) {
    setPrevActiveGroup(activeGroupLabel);
    setOpenGroups(() => {
      const next: Record<string, boolean> = {};
      for (const g of NAV_GROUPS) next[g.label] = g.label === activeGroupLabel;
      return next;
    });
  }

  return (
    <nav className="hidden xl:flex flex-col fixed top-1/2 -translate-y-1/2 left-[max(2rem,calc((100vw-56rem)/2-15rem))] max-h-[80vh] overflow-y-auto pr-4">
      {/* Pure-typography tree: chevron + label for groups, indented label for
       *  children, a single short bar marks the active item. No spines, no
       *  rings, no pills — the indentation IS the hierarchy. */}
      {NAV_GROUPS.map((group) => {
        const isOpen = !!openGroups[group.label];
        const groupActive = group.label === activeGroupLabel;
        return (
          <div key={group.label} className="flex flex-col">
            {/* Group header */}
            <button
              type="button"
              onClick={() =>
                setOpenGroups((prev) => ({ ...prev, [group.label]: !prev[group.label] }))
              }
              className="group flex items-center gap-3 py-2.5 select-none"
            >
              <span
                className={`text-[8px] leading-none transition-all duration-200 w-2 ${
                  isOpen ? "rotate-90" : ""
                } ${
                  groupActive
                    ? "text-white/55"
                    : "text-white/25 group-hover:text-white/50"
                }`}
              >
                ▸
              </span>
              <span
                className={`text-[10px] font-mono uppercase tracking-[0.24em] transition-colors ${
                  groupActive
                    ? "text-white/70"
                    : "text-white/35 group-hover:text-white/55"
                }`}
              >
                {group.label}
              </span>
            </button>

            {/* Children — indented past the chevron. Active child carries a
             *  thin 2px accent bar to its left; everything else is pure
             *  typography. */}
            {isOpen && (
              <div className="flex flex-col pb-2">
                {group.items.map(({ id, label }) => {
                  const active = id === activeId;
                  return (
                    <a
                      key={id}
                      href={`#${id}`}
                      className="group relative flex items-center py-2 pl-7 transition-colors"
                    >
                      {/* Thin active marker */}
                      <span
                        aria-hidden
                        className={`absolute left-5 top-1/2 -translate-y-1/2 w-px h-3.5 transition-all duration-200 ${
                          active ? "bg-white/55" : "bg-transparent"
                        }`}
                      />
                      <span
                        className={`text-[12px] transition-colors duration-200 whitespace-nowrap ${
                          active
                            ? "text-white/85"
                            : "text-white/30 group-hover:text-white/55"
                        }`}
                      >
                        {label}
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/* ── Active section hook ─────────────────────────────────────────────────── */

function useActiveSection(ids: string[]) {
  const [activeId, setActiveId] = useState(ids[0]);

  useEffect(() => {
    function update() {
      const threshold = window.innerHeight * 0.35;
      let best = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= threshold) best = id;
      }
      setActiveId(best);
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [ids]);

  return activeId;
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function PaperPage() {
  const activeId = useActiveSection(NAV.map((n) => n.id));

  return (
    <div className="min-h-screen bg-bg-base">
      {/* Cosmic background — nebulae + star field */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="cosmos-container absolute inset-0 z-0">
          <div className="nebula nebula-1" />
          <div className="nebula nebula-2" />
          <div className="nebula nebula-3" />
          <div className="cosmos-glow" />
        </div>
        <div className="absolute inset-0 z-10">
          <StarField neurons={false} />
        </div>
      </div>

      <TimelineNav activeId={activeId} />

      <div className="relative z-10 max-w-3xl mx-auto px-6 sm:px-10 pt-28 pb-40">
        {/* Title */}
        <div className="mb-24 animate-fade-up">
          <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-white/25 mb-5">
            Manifesto
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold leading-[1.05] tracking-tight text-white/90 mb-6">
            Playable Reality
          </h1>
          <p className="text-[15px] text-white/45 leading-[1.7] max-w-xl">
            A gamified rehearsal engine that compounds into a social network
            &mdash; you play the future before it arrives, and what you build
            accrues to a network no one can ship cold. You play the actor that
            produces the outcome, not the price of it. Convene the room.
            Practise the future. Earn the morning the surprise lands.
          </p>
          <div className="mt-8">
            <PaperMeta />
          </div>
        </div>

        <div id="paper-body" className="space-y-24">
          {/* ── Abstract ──────────────────────────────────────────────── */}
          <Section id="abstract" label="Abstract">
            <P>
              The decisions that matter most are made against a future
              that hasn&apos;t arrived. Surprise is expensive: it
              unseats leaders, buries incumbents, breaks portfolios. Good
              strategists already know the answer &mdash; they rehearse.
              Militaries wargame, hedge funds pre-mortem, campaigns
              red-team the opposition. The practice is old. What has been
              missing is a place where the rehearsal <em>compounds</em>{" "}
              instead of fading the moment the meeting ends.
            </P>
            <P>
              Picture the room. A handful of people sit around a board,
              each holding a private hand. One plays a card face-up
              &mdash; <em>the regulator opens a file</em> &mdash;
              committing to it, paying for it, in the open. Another had
              promised to back that play and quietly plays against it; at
              the reveal the gap shows, and it costs them the table&apos;s
              trust.
            </P>
            <P>
              <B>Meridians is a gamified rehearsal engine that compounds into
              a social network.</B> That is the company, singular: the{" "}
              <em>product</em> is the engine &mdash; you play the future
              before it arrives &mdash; and it <em>compounds</em> into a
              network, every room&apos;s judgement and worlds accruing to a
              substrate no competitor can ship cold. Give it any coherent text
              &mdash; a market brief, a doctrine, a competitive landscape
              &mdash; and it becomes a <B>playable world</B>: a board your
              team sits around and moves against, one turn at a time. Anyone can say it; a card makes you
              pay for it. <B>You play the actor that produces the outcome, not
              the price of it.</B> The math underneath was proven on narrative
              &mdash; the same deterministic formulas recover the dramatic
              shape of <em>Harry Potter</em> from structural deltas alone
              &mdash; but fiction is our wind tunnel, not our market: a known
              text with a known shape is how you validate an instrument before
              pointing it at a live one.
            </P>
            <P>
              <B>Players, Contributors, and Game Masters</B> each read the
              same world differently; membership lives <em>in the narratives
              themselves</em>, so the model you play is also the directory of
              who you play it with. A frontier model turns any text into a
              playable world on the three forces &mdash; rules become{" "}
              <B>System</B>, players <B>World</B>, quests and the north star{" "}
              <B>Fate</B> &mdash; so worlds are cheap to build. Most stay{" "}
              <em>surface-level and vibrant</em>, where the play lives; go deep
              and a world becomes an <B>expert system that understands its
              players better than they understand themselves</B>. Surface
              worlds drive the network; deep worlds are the moat.
            </P>
            <P>
              Underneath is a <B>world view</B>: a typed, continuously
              mutating knowledge structure the engine extracts from that
              text and enriches with every decision the room commits.
              Three force fields measure how hard it is working &mdash;{" "}
              <B>System</B>, the rules; <B>World</B>, the actors;{" "}
              <B>Fate</B>, how reality lands on what the room believed.
              Low-temperature extraction in, deterministic formulas out.
              Same input, same score. The same engine scores two ways,
              toggled on the timeline: <B>Narrative scoring</B> (the three
              forces &mdash; how hard the world view is working) and{" "}
              <B>Experience scoring</B> (Prior Knowledge &amp; Foresight &mdash;
              how ready the room is, below). They sit side by side; neither
              replaces the other.
            </P>
            <P>
              It is <B>advisory, not predictive</B>. The engine
              calibrates the room&apos;s beliefs and reads its present
              clearly; it looks, at most, one step ahead. What it hands
              back to humans is the act models can&apos;t originate
              &mdash; choosing which future to play toward, who gets a
              seat, which moves are worth making. Vision is the human
              edge. The engine does the supporting work: arbitrating
              rules, holding private state, scoring every committed move.
              It runs human-up, not data-down.
            </P>
            <P>
              <B>Model improvement is our tailwind, not our threat.</B> The
              first question is the right one: why doesn&apos;t a
              foundation-model lab ship this in a quarter? Because we are the{" "}
              <em>complement</em> to those models, not a competitor. Models
              generate; humans choose. The engine looks one step ahead;{" "}
              <em>vision</em> picks which future to make. No model, however
              good, ships your room&apos;s history &mdash; the committed,
              client-owned judgement of the people inside the problem. So the
              better the models get, the <em>cheaper</em> we run and the{" "}
              <em>more valuable</em> the one input they can never originate. We
              don&apos;t parry the frontier; we ride it.
            </P>
            <P>
              You practise it at <B>two tempos</B>. <B>Conviction</B> is{" "}
              <em>live</em>: the room convenes and plays a high-feedback
              session where seats commit, signal, and read each other under
              pressure. <B>Capture</B> is <em>asynchronous</em>: between
              sessions, on each member&apos;s own clock, every seat records
              what it believes as the world moves, and the substrate
              compounds it. Conviction sells the room on day one; Capture is
              why the team can&apos;t leave.
            </P>
            <P>
              We do not sell prediction. We sell <B>rehearsal at scale</B>, and
              what it buys is readiness when a decision counts. The research is
              consistent and old: under pressure, experts don&apos;t weigh
              options &mdash; they <em>recognise</em> the situation and retrieve
              a rehearsed move <Cite id="klein1998" label="Klein 1998" />. Our
              two north stars measure that readiness, scene by scene:{" "}
              <B>Prior Knowledge</B> &mdash; how strongly the room recognises the
              present from having been somewhere like it &mdash; and{" "}
              <B>Foresight</B> &mdash; how much of what is coming it has already
              walked. Both are read by meaning from the room&apos;s own play, and
              a match on <em>another</em> branch &mdash; a future actually
              rehearsed &mdash; counts for more. A team knows it is prepared when
              its canonical models of reality carry high Prior scores: the
              present keeps landing on ground it has already walked. Surfacing
              that judgement from the people who hold it, and compounding it, is
              the behaviour Meridians sets out to change.
            </P>
            <P>
              Private rooms are the product today &mdash; closed tables on
              a local data model, compounding one team&apos;s edge with no
              vendor in the middle. Public rooms are the second-phase bet,
              unproven and named as such. One note on how to read what
              follows: there is <B>one business here &mdash; a gamified
              rehearsal engine that compounds into a social network.</B>
              Everything
              narrative &mdash; Harry Potter, story shapes, voice, beat chains
              &mdash; is either the validation harness that proved the math or
              the internal tooling that runs the engine. When a section reads
              like a writing product, it isn&apos;t one; it is the engine room
              under the network, documented. Skim the argument for the wager; the engine
              sections (Forces through Reconstruction) are the
              instrument&apos;s spec sheet.
            </P>
          </Section>

          {/* ── The Problem ───────────────────────────────────────────── */}
          <Section id="problem" label="Why Practice">
            <P>
              Two claims, both well-established. The first:{" "}
              <B>good strategists rehearse the future.</B> Every
              serious general staff, hedge fund, and political
              shop already does this &mdash; informally, often
              inconsistently, but wherever the cost of being
              wrong is asymmetric, somebody is running the
              scenario before it arrives.
              <Cite id="perla1990" label="Perla 1990" /> The
              second: <B>game-like environments are how skill
              compounds.</B> Explicit rules, repeated play, scored
              outcomes, adversarial pressure &mdash; the conditions
              deliberate practice requires. Where those conditions
              hold, skill accumulates. Where they don&apos;t,
              judgment drifts on first impressions and survives
              only because nothing tested it.
            </P>
            <P>
              <B>Accumulation and play fail in opposite directions;
              each corrects the other.</B> Pure accumulation has no
              error signal: you can compound a coherent world view that is
              confidently wrong, and it drifts comfortably &mdash; a scholar
              never tested. Pure play is sharp but shallow: fast signal on
              what&apos;s in front of you, but nothing carries over, so you
              relearn the same lesson each time &mdash; a goldfish with good
              instincts. This is why the practice runs at <B>two tempos</B>:{" "}
              <B>Capture</B> is the accumulation (asynchronous),{" "}
              <B>Conviction</B> the play (live), and neither is the unit.
              The loop is: feedback turns accumulation into
              judgment, accumulation lets feedback compound instead of
              evaporate, and the correction writes back so the next
              pass starts corrected. That write-back is the whole game
              &mdash; and the hardest part, because most keep no
              honest ledger of what reality returned, and run a flawed
              model for decades at high confidence.
            </P>
            <P>
              This is an old idea in new clothes &mdash; scientific
              method, deliberate practice, OODA, Bayesian updating;
              Tetlock&apos;s superforecasters win by running the loop
              honestly and often.
              <Cite id="tetlock-gardner2015" label="Tetlock &amp; Gardner 2015" />{" "}
              The pairing is not the insight.{" "}
              <B>The bet is narrower: the loop fails for want of a
              substrate</B> &mdash; people don&apos;t lack the will to
              read or rehearse, they lack a place where corrections
              accumulate instead of fading when the meeting ends. The
              binding constraint is the missing ledger, not the
              missing practice.
            </P>
            <P>
              <B>
                The gap is not analysis &mdash; it is structured
                rehearsal with a substrate.
              </B>{" "}
              The boardroom turns into a wargame the morning the
              competitor announces a price cut, the regulator
              opens a file, the market opens against you. By then
              the room is unrehearsed, the priors are thin, and
              the seat of the adversary is empty. Unaided
              executive judgment loses to systematic biases:
              overconfidence, anchoring, confirmation
              <Cite id="kahneman2011" label="Kahneman et al. 2011" />
              <Cite id="lovallo2003" label="Lovallo &amp; Kahneman 2003" />.
              Strategy decks don&apos;t commit structurally.
              Forecasts chase precision and lose calibration. Long
              memos go unchallenged. Foundation models give scale
              and fluency, then forget what they wrote three
              sections back. None of these create a feedback loop.
              A war room does.
            </P>
            <P>
              <B>Name the loss, not just the gain.</B> Rehearsal sells like
              insurance: you buy it against a specific remembered morning. For
              a fund it is <em>the position you couldn&apos;t unwind before
              the open</em> &mdash; the trade that can&apos;t be re-run, met
              cold because the seat that would have seen it coming was empty.
              The downside is asymmetric: a normal week&apos;s upside is small,
              the wrong morning&apos;s cost is the franchise. That asymmetry is
              the reason to practise.
            </P>
            <P>
              A room that meets weekly to play the next quarter
              builds reflexes the unprepared room can&apos;t
              improvise. A room that meets monthly to play the
              next year builds doctrine the unprepared firm
              can&apos;t copy. A solo operator running the same
              practice on their own portfolio or political bet
              earns the same compounding edge. Meridians gives the
              habit a substrate.
            </P>
            <P>
              <B>Why now.</B> Three things changed at once.
              Long-context LLMs are cheap enough that a war-room
              session costs cents. Scheduled remote meetings made
              weekly cadence operationally trivial. And the
              labour-displacement conversation around AI put a
              premium on the one thing models don&apos;t do{" "}
              &mdash; originate vision. And it sharpened the need: when a
              model answers everything, judgment atrophies from disuse
              and deciding turns solitary. The room is the counterweight
              &mdash; a <B>social play</B> that keeps judgment exercised
              and the table human. What changed is the cost of running
              it, the permission to carry it past the general-staff
              tradition, and the need.
            </P>
            <P>
              <B>The certainty it returns is internal, not
              predictive.</B> The future stays unknowable; no honest
              practice changes that. What rehearsal changes is the room:
              you walk in having played the ground and the
              adversary&apos;s seat, so you meet the morning with earned{" "}
              <B>conviction</B> instead of a forecast you&apos;ll be
              wrong about &mdash; a behavioural practice for the age of
              AI, where being ready beats claiming to know.
            </P>
          </Section>

          {/* ── The Narrative Origin ──────────────────────────────────── */}
          <Section id="narrative-origin" label="Narrative Origin">
            <P>
              <B>Meridians began with stories, not strategy &mdash; origin,
              not identity.</B> The first substrate was a novel, and the
              discovery was that any coherent text, read{" "}
              <em>structurally</em> rather than literally, contains a
              measurable world model: the rules that govern it
              (<B>System</B>), the actors who move through it
              (<B>World</B>), and the open questions that decide where it
              goes (<B>Fate</B>). A finished novel is the ideal test
              instrument &mdash; a complete world with a known shape, where
              the engine&apos;s reading can be checked against a million
              readers&apos; &mdash; and that is the only role fiction plays
              here. The delta arithmetic validated on <em>Harry Potter</em>{" "}
              is built to read a team&apos;s strategic position from its
              committed history; the strategic case is the working
              hypothesis, and the historical rehearsal (a real decision with
              known ground truth, replayed under the original fog) is where
              it gets tested first.
            </P>
            <P>
              <B>Every organisation already has a narrative</B> &mdash;
              not the one in the annual report, but the one in the
              decisions it actually made, the threats it saw coming and
              the ones it didn&apos;t. It has a <em>signature</em>:
              System-dominant (it runs on rules and process),
              World-dominant (on relationships and people), or
              Fate-dominant (on the open bets it lives and dies by). Most
              companies have never read their own narrative structurally
              &mdash; they remember outcomes and forget the model that
              produced them.
            </P>
            <P>
              This is where narrative is <em>predictive</em> in the only
              sense that matters &mdash; not forecasting events, but
              revealing the <B>shape of how an organisation moves</B>:
              where it accelerates, where it hesitates, which surprises
              it handles and which it has never rehearsed. A decade-long
              System-dominant company has thin World priors &mdash;
              fluent in its rules, lost the morning a key person walks.
              Reading that shape is a <B>diagnostic</B>: the gap between
              the future you&apos;re prepared for and the one you{" "}
              <em>believe</em> you&apos;re prepared for is where surprise
              lives.
            </P>
            <P>
              Meridians starts there. <B>Model</B> reads the narrative
              you&apos;ve already written and makes it playable;{" "}
              <B>Capture</B> keeps it honest as the story continues
              &mdash; recording the model, not just the outcomes;{" "}
              <B>Rehearsal</B> plays the chapters that haven&apos;t
              arrived. Every world view began as a narrative &mdash;
              yours already exists; the question is whether you can read
              it.
            </P>
          </Section>

          {/* ── The Wedge ─────────────────────────────────────────────── */}
          <Section id="wedge" label="The Game Master">
            <P>
              <B>The unit is the Game Master &mdash; but the Game Master is
              nothing without the table.</B> The two are co-equal and not
              symmetric: the <em>team</em> is where the judgement lives, the{" "}
              <em>Game Master</em> is how it flows. Everything runs{" "}
              <em>through</em> the Game Master; nothing happens without the
              team. The value is human{" "}
              <em>judgement</em>: the read each person carries on what
              matters. The Game Master gathers a room&apos;s priors, calls,
              and disagreements, every member represented, and the engine
              aggregates them into one living read of how the organisation
              decides. Divergence preserved, never averaged. The
              index-everything tools (Glean and its kind){" "}
              <em>store what your team wrote down</em>; Meridians{" "}
              <em>runs what your team believes</em>. So we don&apos;t sell
              a tool to a company. <B>We find Game Masters and arm
              them.</B> And until that pipeline exists at volume, we{" "}
              <em>are</em> the Game Masters: the founders facilitate the
              first rooms directly, certify the first internal GMs out of
              those rooms, and treat every facilitated engagement as GM
              recruitment as much as revenue. The GM network is a
              distribution thesis to be proven, not a channel we already
              have. What we deliver isn&apos;t software. It is{" "}
              <B>models of reality with real social fabric</B>, and a Game
              Master keeps two things: the model, and the people who keep
              it true.
            </P>
            <P>
              <B>Two value propositions, one growth engine.</B>{" "}
              <B>Players</B> get Capture and Conviction: judgement
              developed by battle-testing against AI-simulated teams.{" "}
              <B>Game Masters</B> get the <B>engine</B>: the tools to prime
              a world, keep it true, and run the table. Both propositions
              serve the same product &mdash; the rehearsal &mdash; and
              sharpening them is what carries Meridians from private rooms
              into public ones.
            </P>
            <P>
              <B>Meridians is a networking tool for Game Masters &mdash; a
              recruitment tool as it matures.</B> Running a world is how a GM
              builds a network: gamified world-modelling is a{" "}
              <em>creative, strategic, social</em> experience, and the{" "}
              <em>quality of the models is the value</em> &mdash; people stay
              for great worlds and sharp play. So the movement is grassroots:
              it grows from <B>strong networks around individual GMs and the
              founders</B>, each a node that pulls in players, makes them
              contributors, and graduates the committed into GMs of their own.
              The same instrument later becomes a <B>recruitment tool</B>
              &mdash; the network is where talent surfaces and is found.
            </P>
            <P>
              The Game Master is already a profession. Thousands run paid
              tables every week. We point that instinct at strategy,
              business, and life. One person, two stages: <em>forged</em>{" "}
              in low-stakes play, <em>deployed</em> where the stakes are
              real.
            </P>
            <P>
              <B>The Forge.</B> A high-agency person builds a model they
              care about and plays it with the people around them: a
              geopolitics game with friends on a weekend, a markets table,
              a negotiation room. <em>Domain-adjacent to their work</em>,
              where being wrong costs nothing. Not a watered-down product;
              the exact condition skill needs. You can&apos;t learn to
              read a table on a decision that resolves once, ambiguously,
              in three years. You learn it on fifty cheap games. It is
              also where the <em>social fabric</em> forms: a small group
              invested in keeping one model true. We don&apos;t monetise
              it. It pays us in Game Masters, in public proof of the
              engine, and in the instinct that a real decision is a room
              you can play.
            </P>
            <P>
              <B>The Table.</B> That same person has a job, a team, an
              organisation. They carry the model into a structure they{" "}
              <em>already belong to</em> &mdash; a team, a club, a community
              &mdash; open a room on a real question, and earn the next player
              by <em>showing, not pitching</em>. The model travels through
              real relationships, not a cold sale. <B>Bottom-up</B>: it starts
              inside a relationship and grows as the value becomes undeniable.
              Where a room sits inside something more serious, the same
              bottom-up motion carries it &mdash; a member brings their play
              in, never a top-down sale.
            </P>
            <P>
              <B>What flows upward is signal, not fees.</B> Players who
              develop the instinct become Game Masters; a Game Master who
              proves a room grows the next inside the account, and the
              network compounds one good table at a time. But a Game
              Master earns from <em>running rooms</em>, never from
              recruiting other Game Masters. What travels up the ladder is
              players and proof, not a cut of recruits. We hold that line.
            </P>
            <P>
              <B>The grassroots ladder: Player &rarr; Contributor &rarr;
              Game Master.</B> This is a <em>grassroots</em> motion, not a
              boutique-consulting one &mdash; growth runs bottom-up through
              the community, not top-down through a sales team. Each rung is a
              deepening relationship to one world. <B>Onboarding</B> is the
              card game: a player is introduced to Meridians by sitting down
              to a game of Conviction &mdash; low-friction, social, fun, all
              they carry is Read / Write / Play. <B>Membership</B> is the{" "}
              <em>Signal chat</em>: they join the room&apos;s back-channel and
              start <em>contributing priors to the model</em> &mdash; a{" "}
              <em>Contributor</em>, no longer just a guest at the table.{" "}
              <B>Ownership</B> is becoming the Game Master: onboarded onto the
              engine itself, they build their <em>own</em> model, run their
              own table, and recruit the next ring of players. Play earns
              membership; membership earns ownership; owners make more players.
              It is a <B>positive feedback loop</B> &mdash; a community that
              grows itself &mdash; and the Game Master&apos;s job at every rung
              is to <em>keep the room social and fun</em>, because that, not a
              pitch, is what turns a player into a contributor and a
              contributor into an owner.
            </P>
            <P>
              <B>Three hard problems, named.</B> Embedded Game Masters
              don&apos;t list like a marketplace, so there is a{" "}
              <em>sourcing gap</em> between a grassroots player with the
              gift and the believer inside a target account. The forge
              closes part of it; a deliberate motion closes the rest.
              Sharper still: the motion routes through individuals who must
              hold GM craft, organisational credibility, and the stamina to
              champion a weekly ritual &mdash; all at once. That
              intersection is rare, and until we have produced ten of them
              we assume the founders are the channel. And
              a lone Game Master is a dependency: if they leave, the
              engagement can go with them. The fix doubles as expansion:
              grow a <em>second</em> Game Master in the account early.
              Land via the forge; expand into the room.
            </P>
          </Section>

          {/* ── Approach ──────────────────────────────────────────────── */}
          <Section id="approach" label="The Substrate">
            <P>
              A room can&apos;t play forward without a shared
              ledger of where it stands. The substrate is that
              ledger &mdash; and, for an organisation, an{" "}
              <em>interface layer to its own context</em>:
              transparent and queryable, a place to ask how the team
              actually decides. Every world the room cares about
              &mdash; a
              market regime, a campaign theatre, a portfolio, a
              doctrine, a competitive landscape &mdash; is
              modelled as a knowledge graph
              <Cite id="hogan2021" label="Hogan et al. 2021" />{" "}
              that updates step by step: one page per actor,
              location, rule, or open question, updated only when
              a session reveals something new. An LLM writes
              down <em>what changed</em>; deterministic formulas
              compute <em>how much</em> was revealed. Reading and
              measurement stay separate &mdash; the LLM
              interprets, the math scores, and the score stays
              reproducible. Changes come in two kinds &mdash;
              encyclopedic (new facts) and possibility (outcomes
              becoming alive or dying) &mdash; captured by three
              delta layers:
            </P>
            <ul className="mt-3 space-y-2 text-[13px] text-white/50 leading-[1.85]">
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">1.</span>
                <span>
                  <B>System graph deltas</B> &mdash; the{" "}
                  <em>encyclopedic</em> kind. New entries in the
                  world&apos;s rulebook: principles, systems, concepts,
                  tensions, events, structures, conventions, constraints.
                  Each entry is a node; connections between them are
                  typed edges. Depth emerges from connectivity, not
                  lexical volume.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">2.</span>
                <span>
                  <B>World deltas</B> &mdash; also encyclopedic, but
                  about the people. New entries on the pages of specific
                  characters, locations, and artifacts: learns, loses,
                  becomes, realises, plus relationship valence shifts.
                  These accumulate as persistent state attached to the
                  entity whose page was written on.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">3.</span>
                <span>
                  <B>Thread deltas</B> &mdash; the{" "}
                  <em>possibility</em> kind. Every open question
                  (rivalry, secret, quest, unresolved claim) carries a{" "}
                  <em>belief</em> &mdash; a live distribution over
                  outcomes. Together they form the world view&apos;s{" "}
                  <B>Belief System</B>: its current stance on
                  everything undecided, always in flux. Each scene is
                  reality landing, asking the stance to revise.
                  Deltas emit integer evidence in [−4, +4] plus one of
                  nine log-types; the math handles log-odds, decay,
                  volatility, closure, and abandonment. Fate is what
                  reality just exacted on a high-attention belief.
                </span>
              </li>
            </ul>
            <P>
              Three forces follow, one per delta layer. Together they
              read how hard the world view is working this scene:
            </P>
            <ul className="space-y-2 text-[13px] text-white/60 leading-relaxed pl-4">
              <li>
                <B>System</B> &mdash; the rules that govern. Grows as
                new principles, structures, and constraints
                accumulate.
              </li>
              <li>
                <B>World</B> &mdash; the lived layer. Grows as
                characters, locations, and artifacts reveal who
                they&apos;re becoming.
              </li>
              <li>
                <B>Fate</B> &mdash; reality landing on belief. Grows
                as the odds move on open questions: rivalries,
                secrets, quests, unresolved claims.
              </li>
            </ul>
            <P>
              The mix of these three forces is a work&apos;s{" "}
              <B>signature</B> &mdash; a point on the unit 3-simplex
              recovered from the dominant principal component of{" "}
              <Tex>{String.raw`\;(F, W, S)`}</Tex>. Archetypes name
              its neighbourhoods: <B>Paper</B> System-dominant,{" "}
              <B>Stage</B> World-dominant, <B>Classic</B>{" "}
              Fate-dominant, <B>Opus</B> balanced. Each force is
              rank-transformed to a standard normal first &mdash;
              distribution-free and bounded &mdash; so length, genre,
              and outliers don&apos;t bias the comparison. The
              cumulative <B>network</B> &mdash; every entity, thread,
              and system node weighted by cross-graph attribution count
              &mdash; surfaces the load-bearing hubs and bridges without
              touching the deltas.
            </P>
            <p className="text-[12.5px] text-white/35 italic leading-[1.85] mt-6 border-l-2 border-white/10 pl-4">
              A note to the reader &mdash; and a boundary drawn in ink.
              The sections that follow (Hierarchy through Reconstruction)
              are the engine room: how the substrate is built, measured,
              and validated. They are written on the narrative corpus
              because that is where ground truth lives, so they will read,
              at moments, like a story-analysis product. They are not one.
              Every instrument below exists to do exactly one job &mdash;
              make a team&apos;s rehearsal measurable &mdash; and the
              literary examples are its calibration data. If you trust the
              practice, skip to{" "}
              <a href="#war-rooms" className="text-white/55 underline-offset-2 hover:underline">
                War Rooms
              </a>; the product never left.
            </p>
          </Section>

          {/* ── Computational Hierarchy ───────────────────────────────── */}
          <Section id="hierarchy" label="Hierarchy">
            <P>
              Before the room sits down, the substrate has to know
              what it&apos;s sitting on. Long-form worlds &mdash;
              market regimes, campaigns, doctrines, and the narrative
              corpus we validate on &mdash; decompose into five nested
              layers. (The <em>Harry Potter</em> examples throughout are
              the test fixture, chosen because every reader can check the
              engine&apos;s reading against their own.)
              Structure generation (scenes with deltas) runs
              independently of prose generation (beats and
              propositions), enabling parallel processing and
              precise attribution. The same layered view holds when
              a War Room session is treated as a scene with its own
              deltas: the cards played become the structural moves,
              the negotiation log becomes the prose.
            </P>

            {/* Visual hierarchy diagram - clean and compact */}
            <div className="my-8 px-4 py-6 rounded-lg bg-white/[0.02] border border-white/6">
              <svg
                width="100%"
                viewBox="0 0 820 420"
                className="max-w-full mx-auto"
              >
                {(() => {
                  // Clean, balanced tree with better spacing
                  const narrative = { cx: 425, y: 30 };
                  const arcs = [
                    { cx: 220, y: 105 },
                    { cx: 425, y: 105 },
                    { cx: 630, y: 105 },
                  ];
                  const scenes = [
                    // From arc 0
                    { cx: 145, y: 185 },
                    { cx: 230, y: 185 },
                    { cx: 315, y: 185 },
                    // From arc 1
                    { cx: 425, y: 185 },
                    { cx: 510, y: 185 },
                    // From arc 2
                    { cx: 600, y: 185 },
                    { cx: 685, y: 185 },
                  ];
                  const beats = [
                    // From scene 0
                    { cx: 115, y: 275 },
                    { cx: 175, y: 275 },
                    // From scene 2
                    { cx: 285, y: 275 },
                    { cx: 345, y: 275 },
                    // From scene 3
                    { cx: 425, y: 275 },
                    // From scene 5
                    { cx: 570, y: 275 },
                    { cx: 630, y: 275 },
                    // From scene 6
                    { cx: 685, y: 275 },
                  ];
                  const props = [
                    // From beat 0
                    { cx: 95, y: 355 },
                    { cx: 135, y: 355 },
                    // From beat 1
                    { cx: 165, y: 355 },
                    { cx: 195, y: 355 },
                    // From beat 2
                    { cx: 270, y: 355 },
                    { cx: 310, y: 355 },
                    // From beat 4
                    { cx: 405, y: 355 },
                    { cx: 445, y: 355 },
                    // From beat 5
                    { cx: 590, y: 355 },
                    { cx: 630, y: 355 },
                    // From beat 7
                    { cx: 670, y: 355 },
                    { cx: 710, y: 355 },
                  ];

                  return (
                    <g>
                      {/* Connecting lines - narrative to arcs */}
                      {arcs.map((arc, i) => (
                        <line
                          key={`na-${i}`}
                          x1={narrative.cx}
                          y1={narrative.y + 34}
                          x2={arc.cx}
                          y2={arc.y}
                          stroke="#a855f7"
                          strokeWidth="1.5"
                          strokeOpacity="0.25"
                        />
                      ))}

                      {/* Connecting lines - arcs to scenes */}
                      {[
                        [0, 0],
                        [0, 1],
                        [0, 2], // arc 0 → scenes 0,1,2
                        [1, 3],
                        [1, 4], // arc 1 → scenes 3,4
                        [2, 5],
                        [2, 6], // arc 2 → scenes 5,6
                      ].map(([arcIdx, sceneIdx], i) => (
                        <line
                          key={`as-${i}`}
                          x1={arcs[arcIdx].cx}
                          y1={arcs[arcIdx].y + 26}
                          x2={scenes[sceneIdx].cx}
                          y2={scenes[sceneIdx].y}
                          stroke="#3b82f6"
                          strokeWidth="1.5"
                          strokeOpacity="0.25"
                        />
                      ))}

                      {/* Connecting lines - scenes to beats */}
                      {[
                        [0, 0],
                        [0, 1], // scene 0 → beats 0-1
                        [2, 2],
                        [2, 3], // scene 2 → beats 2-3
                        [3, 4], // scene 3 → beat 4
                        [5, 5],
                        [5, 6], // scene 5 → beats 5-6
                        [6, 7], // scene 6 → beat 7
                      ].map(([sceneIdx, beatIdx], i) => (
                        <line
                          key={`sb-${i}`}
                          x1={scenes[sceneIdx].cx}
                          y1={scenes[sceneIdx].y + 24}
                          x2={beats[beatIdx].cx}
                          y2={beats[beatIdx].y}
                          stroke="#22d3ee"
                          strokeWidth="1.5"
                          strokeOpacity="0.25"
                        />
                      ))}

                      {/* Connecting lines - beats to propositions */}
                      {[
                        [0, 0],
                        [0, 1], // beat 0 → props 0-1
                        [1, 2],
                        [1, 3], // beat 1 → props 2-3
                        [2, 4],
                        [2, 5], // beat 2 → props 4-5
                        [4, 6],
                        [4, 7], // beat 4 → props 6-7
                        [5, 8],
                        [5, 9], // beat 5 → props 8-9
                        [7, 10],
                        [7, 11], // beat 7 → props 10-11
                      ].map(([beatIdx, propIdx], i) => (
                        <line
                          key={`bp-${i}`}
                          x1={beats[beatIdx].cx}
                          y1={beats[beatIdx].y + 20}
                          x2={props[propIdx].cx}
                          y2={props[propIdx].y}
                          stroke="#22c55e"
                          strokeWidth="1.5"
                          strokeOpacity="0.2"
                        />
                      ))}

                      {/* NARRATIVE */}
                      <g>
                        <rect
                          x={narrative.cx - 55}
                          y={narrative.y}
                          width="110"
                          height="34"
                          rx="5"
                          fill="#a855f7"
                          fillOpacity="0.2"
                          stroke="#a855f7"
                          strokeWidth="2.5"
                        />
                        <text
                          x={narrative.cx}
                          y={narrative.y + 22}
                          textAnchor="middle"
                          fill="white"
                          fillOpacity="0.95"
                          fontSize="12"
                          fontWeight="700"
                        >
                          NARRATIVE
                        </text>
                      </g>

                      {/* ARCS */}
                      {arcs.map((arc, i) => (
                        <g key={`arc-${i}`}>
                          <rect
                            x={arc.cx - 40}
                            y={arc.y}
                            width="80"
                            height="26"
                            rx="4"
                            fill="#3b82f6"
                            fillOpacity="0.15"
                            stroke="#3b82f6"
                            strokeWidth="2"
                          />
                          <text
                            x={arc.cx}
                            y={arc.y + 17}
                            textAnchor="middle"
                            fill="white"
                            fillOpacity="0.85"
                            fontSize="11"
                            fontWeight="600"
                          >
                            Arc {i + 1}
                          </text>
                        </g>
                      ))}

                      {/* SCENES */}
                      {scenes.map((scene, i) => (
                        <g key={`scene-${i}`}>
                          <rect
                            x={scene.cx - 35}
                            y={scene.y}
                            width="70"
                            height="24"
                            rx="3"
                            fill="#22d3ee"
                            fillOpacity="0.12"
                            stroke="#22d3ee"
                            strokeWidth="1.8"
                          />
                          <text
                            x={scene.cx}
                            y={scene.y + 16}
                            textAnchor="middle"
                            fill="white"
                            fillOpacity="0.75"
                            fontSize="10"
                            fontWeight="600"
                          >
                            Scene {i + 1}
                          </text>
                        </g>
                      ))}

                      {/* BEATS */}
                      {beats.map((beat, i) => (
                        <g key={`beat-${i}`}>
                          <rect
                            x={beat.cx - 28}
                            y={beat.y}
                            width="56"
                            height="20"
                            rx="3"
                            fill="#22c55e"
                            fillOpacity="0.1"
                            stroke="#22c55e"
                            strokeWidth="1.5"
                          />
                          <text
                            x={beat.cx}
                            y={beat.y + 13}
                            textAnchor="middle"
                            fill="white"
                            fillOpacity="0.75"
                            fontSize="9"
                            fontWeight="600"
                          >
                            {
                              [
                                "breathe",
                                "inform",
                                "advance",
                                "turn",
                                "reveal",
                                "bond",
                                "shift",
                                "expand",
                              ][i]
                            }
                          </text>
                        </g>
                      ))}

                      {/* PROPOSITIONS - simple bars */}
                      {props.map((prop, i) => (
                        <g key={`prop-${i}`}>
                          <rect
                            x={prop.cx - 16}
                            y={prop.y}
                            width="32"
                            height="16"
                            rx="2"
                            fill="#f59e0b"
                            fillOpacity="0.12"
                            stroke="#f59e0b"
                            strokeWidth="1"
                            strokeOpacity="0.4"
                          />
                          <text
                            x={prop.cx}
                            y={prop.y + 11}
                            textAnchor="middle"
                            fill="white"
                            fillOpacity="0.6"
                            fontSize="7"
                            fontWeight="600"
                          >
                            P{i + 1}
                          </text>
                        </g>
                      ))}

                      {/* Row labels (left side) */}
                      <text
                        x="20"
                        y="47"
                        fill="white"
                        fillOpacity="0.35"
                        fontSize="9"
                        fontWeight="700"
                        letterSpacing="1.2"
                      >
                        NARRATIVE
                      </text>
                      <text
                        x="20"
                        y="118"
                        fill="white"
                        fillOpacity="0.35"
                        fontSize="9"
                        fontWeight="700"
                        letterSpacing="1.2"
                      >
                        ARCS
                      </text>
                      <text
                        x="20"
                        y="198"
                        fill="white"
                        fillOpacity="0.35"
                        fontSize="9"
                        fontWeight="700"
                        letterSpacing="1.2"
                      >
                        SCENES
                      </text>
                      <text
                        x="20"
                        y="285"
                        fill="white"
                        fillOpacity="0.35"
                        fontSize="9"
                        fontWeight="700"
                        letterSpacing="1.2"
                      >
                        BEATS
                      </text>
                      <text
                        x="20"
                        y="365"
                        fill="white"
                        fillOpacity="0.35"
                        fontSize="9"
                        fontWeight="700"
                        letterSpacing="1.2"
                      >
                        PROPS
                      </text>
                    </g>
                  );
                })()}
              </svg>
            </div>

            <div className="mt-4 space-y-4">
              <P>
                <B>Narrative</B> — The full knowledge graph: all characters,
                locations, threads, relationships, and system knowledge. Persists
                and grows across the entire timeline.
                <span className="block text-white/25 text-[11px] mt-1 italic">
                  HP: Harry, Hogwarts, the Philosopher&apos;s Stone quest,
                  Snape&apos;s ambiguous loyalty, the rules of wand magic — all
                  as graph nodes and edges.
                </span>
              </P>
              <P>
                <B>Arcs</B> — Thematic groupings of 5–8 scenes with directional
                objectives. Direction vectors recompute after each arc based on
                thread tension and momentum.
                <span className="block text-white/25 text-[11px] mt-1 italic">
                  HP: &ldquo;Arrival at Hogwarts&rdquo; (Sorting Hat through
                  first classes) — establishing threads, expanding the world,
                  seeding rivalries.
                </span>
              </P>
              <P>
                <B>Scenes</B> — Atomic units of structural delta. Each scene
                records thread transitions, world deltas, and knowledge
                graph additions. Forces derive from these deltas, not from
                prose.
                <span className="block text-white/25 text-[11px] mt-1 italic">
                  HP: The troll fight — &ldquo;friendship with Hermione&rdquo;
                  thread jumps latent → seeded, relationship delta between
                  Harry/Ron/Hermione, knowledge node for troll vulnerability.
                </span>
              </P>
              <P>
                <B>Beats</B> — Typed prose segments with a function (breathe,
                inform, advance, turn, reveal, etc.) and delivery mechanism
                (dialogue, thought, action, etc.). Generated as blueprints
                before prose is written.
                <span className="block text-white/25 text-[11px] mt-1 italic">
                  HP troll scene: breathe:environment (bathroom, troll stench) →
                  advance:action (Ron levitates the club) → bond:dialogue
                  (&ldquo;There are some things you can&apos;t share&rdquo;).
                </span>
              </P>
              <P>
                <B>Propositions</B> — Atomic prose units (20–60 words) that
                execute beat intentions. The smallest embeddable unit for
                semantic search.
                <span className="block text-white/25 text-[11px] mt-1 italic">
                  &ldquo;The troll&apos;s club clattered to the floor. In the
                  silence, Ron was still holding his wand in the air.&rdquo;
                </span>
              </P>
            </div>

            <P>
              Forces are computed from deltas without examining prose.
              Revision edits beats without modifying scene structure. Every
              layer is independently auditable.
            </P>
          </Section>

          {/* ── The Three Forces ──────────────────────────────────────── */}
          <Section id="forces" label="Forces">
            <p className="text-[15px] leading-relaxed text-white/50 italic mb-8">
              The three forces are how the room reads where its
              world is right now. <B>Abstract</B> &mdash; the
              rules. <B>Physical</B> &mdash; the entities acting
              under them. <B>Possibility</B> &mdash; what could
              still happen. <B>System</B>, <B>World</B>, and{" "}
              <B>Fate</B> score each one. Fate is{" "}
              <em>possibility</em>, not probability: what{" "}
              <em>could</em> happen, not what <em>will</em>.
            </p>
            <p className="text-[14px] leading-relaxed text-white/45 mb-8">
              Modes weight the fields differently:{" "}
              <B>papers</B> grow mostly System (stating and connecting
              rules); <B>simulations</B> mostly observe Fate
              (exploring outcomes under a ruleset);{" "}
              <B>narratives</B> fire all three. Same formulas;
              different signatures.
            </p>
            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                System
              </h3>
              <P>
                System is the <B>abstract field</B> &mdash; the
                rules, structures, and concepts that form the
                substrate. Every scene can add a new entry (a
                magical law, a political system, a social convention)
                or a new cross-reference between entries. The
                world&apos;s physics &mdash; what&apos;s possible,
                what costs what &mdash; grows by accumulation.
              </P>
              <Eq tex={String.raw`S = \Delta N + \sqrt{\Delta E}`} />
              <P>
                <Tex>{"\\Delta N"}</Tex> counts new nodes
                (principles, concepts, structures);{" "}
                <Tex>{"\\Delta E"}</Tex> counts new typed edges.
                Nodes scale linearly &mdash; each is genuinely new
                ground. Edges scale sub-linearly &mdash; the first
                connections into an entry do most of the interpretive
                work; bulk additions shouldn&apos;t dominate.
              </P>
            </div>

            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                World
              </h3>
              <P>
                World is the <B>physical field</B> &mdash; the
                entities who act within the world&apos;s rules. If
                System is the encyclopedia of how the world works,
                World is the <em>dossier on each entity</em>: a
                separate page for every character, location, and
                artifact, updated whenever a scene reveals something
                about them.
              </P>
              <Eq tex={String.raw`W = \Delta N_c + \sqrt{\Delta E_c}`} />
              <P>
                Symmetric to System.{" "}
                <Tex>{String.raw`\Delta N_c`}</Tex> counts continuity
                nodes added to entity dossiers (traits, opinions,
                goals, secrets, capabilities); {" "}
                <Tex>{String.raw`\Delta E_c`}</Tex> counts continuity
                edges between them. System tracks entries about the{" "}
                <em>world</em>; World tracks entries about{" "}
                <em>specific entities</em>.
              </P>
            </div>

            <div>
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                Fate
              </h3>
              <P>
                Fate is the <B>possibility field</B> &mdash; reality
                manifesting on the world view&apos;s Belief System,
                reshaping its stance scene by scene. Where System and
                World measure what the world view has accumulated,
                Fate measures what reality does to those holdings:
                trials, reversals, resolutions. The unifying force
                across the other two &mdash; without fate, the
                abstract has no reason to deepen and the physical has
                no destiny to bend toward; the world view would hold
                a stance but never be answered for it.
              </P>
              <P>
                Picture an election-night needle, or the live
                win-probability line during a football game. A stance
                rendered as a bouncing line &mdash; flat for
                stretches, nudged by small evidence, lurching on
                decisive plays, converging at the finish. Every
                thread carries such a line, and the world view holds
                them all at once. &ldquo;Will Frodo destroy the
                ring?&rdquo; has one between yes and no; &ldquo;Who
                claims the Iron Throne?&rdquo; has one per contending
                house. Fate is the total movement on those lines this
                scene &mdash; the price reality has just exacted on
                what the world view thought it knew.
              </P>
              <P>
                Made rigorous, each thread carries a <B>stance</B>{" "}
                &mdash; a probability distribution over named
                outcomes &mdash; priced as softmax over a per-outcome
                logit vector. Threads are the <em>questions</em>{" "}
                through which reality reaches the world view; stances
                are the <em>bearings</em> it currently holds in
                answer. Aggregated, they form the world view&apos;s{" "}
                <B>Belief System</B>: a working model of everything
                still undecided, always in flux. Scenes shift each
                stance by emitting bounded integer evidence on
                affected outcomes. Fate is the{" "}
                <B>attention-weighted information gain</B> across
                every stance touched:
              </P>
              <Eq
                tex={String.raw`F_i \;=\; \sum_{t \,\in\, \Delta_i} v_t \cdot D_{\text{KL}}\!\left(\mathbf{p}_t^{+} \,\Big\|\, \mathbf{p}_t^{-}\right)`}
              />
              <P>
                <Tex>{String.raw`\mathbf{p}_t^{-}, \mathbf{p}_t^{+}`}</Tex>{" "}
                are pre/post distributions over thread{" "}
                <Tex>{String.raw`t`}</Tex>&apos;s outcomes;{" "}
                <Tex>{String.raw`v_t`}</Tex> is pre-scene volume;{" "}
                <Tex>{String.raw`D_{\text{KL}}`}</Tex> is
                Kullback&ndash;Leibler divergence
                <Cite id="kullback1951" label="Kullback &amp; Leibler 1951" />
                <Cite id="cover2006" label="Cover &amp; Thomas 2006" />.
                No tunable constants &mdash; no log-type multipliers,
                no closure bonuses, no scene-level denominators.
                Fully specified by the per-thread evidence vector and
                pre-scene attention.
              </P>
              <P>
                Every behaviour falls out of this one form. Pulses
                leave{" "}
                <Tex>{String.raw`\mathbf{p}^{+} = \mathbf{p}^{-}`}</Tex>
                {" "}so KL is zero &mdash; a vivid scene earns no fate
                if no stance moved. Confirmations of the favourite
                keep KL small. <B>Twists</B> land mass on an outcome
                the prior assigned little weight; the per-outcome
                contribution{" "}
                <Tex>{String.raw`p^{+}_k \log(p^{+}_k / p^{-}_k)`}</Tex>
                {" "}spikes exactly where the prior was small &mdash;
                a swerve onto an unlikely outcome scores
                disproportionately higher than a symmetric step toward
                the favourite. <B>Closures</B> concentrate the
                distribution onto a single outcome; resolution scenes
                dominate their arcs without explicit bonus.{" "}
                <B>Attention</B> falls out of the{" "}
                <Tex>{String.raw`v_t`}</Tex> multiplier: same stance
                movement weighs more on a tracked thread than on a
                forgotten side-thread.
              </P>
              <P>
                In narratives, threads are rivalries, quests,
                secrets. In papers, open questions, contested
                claims. In simulations, the branching outcomes a
                scenario is designed to observe. Every world view
                carries a Belief System over its threads; the framing
                works universally.
              </P>
              <P>
                <B>Measurement, not target.</B> Unlike World and
                System, Fate has no per-scene floor. Evidence in
                [−4, +4] reads what a neutral observer would update
                on given the scene&apos;s concrete events &mdash; not
                a knob tuned toward a target. Reality lands as hard
                as it lands. Routine scenes emit pulses{" "}
                (<Tex>{String.raw`|e| = 0`}</Tex>) and earn fate near
                zero &mdash; the stance survives untested; pivotal
                scenes emit committal evidence{" "}
                (<Tex>{String.raw`|e| \geq 3`}</Tex>) and earn it
                &mdash; trials and tribulations the Belief System has
                to answer for. The math recovers the work&apos;s
                shape only when extraction is faithful to the page.
                The{" "}
                <a href="#fate-engine" className="underline hover:text-white/80">Fate Engine</a>
                {" "}covers how the inputs get priced.
              </P>
            </div>

            <div className="mt-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                Activity
              </h3>
              <P>
                A work reveals in two kinds &mdash; encyclopedic
                (World, System) and possibility (Fate) &mdash; summed
                on a common scale they give a single per-scene
                reading. The <B>activity curve</B>{" "}
                <Tex>{String.raw`A_i`}</Tex> records the total rate
                at which the revelation machine is working.
              </P>
              <Eq
                tex={String.raw`A_i \;=\; w_F\,F_i \,+\, w_W\,W_i \,+\, w_S\,S_i, \quad w_F + w_W + w_S = 1`}
              />
              <P>
                Each force is first rank&rarr;Gaussian normalised,{" "}
                <Tex>{String.raw`z_i = \Phi^{-1}(\text{rank}_i / (N{+}1))`}</Tex>
                , placing all three on a common axis independent of
                natural units. The weighted sum expresses{" "}
                <em>activity level</em> in units of standard deviation
                from the work&apos;s own mean.
              </P>
              <P>
                <B>The weights are the work&apos;s signature.</B>{" "}
                Recovered by <B>principal-component analysis</B> on
                the three normalised force curves: PC1 &mdash; the
                direction of maximum variance in{" "}
                <Tex>{String.raw`(F, W, S)`}</Tex> space &mdash;
                identifies the axis the work moves along most; its
                absolute loadings, renormalised to the unit simplex,
                give the weights. Signature is a property of the
                text, recovered from its variance.
              </P>
              <P>
                <B>Reading the curve.</B> A peak{" "}
                (<Tex>{String.raw`A_i \gg 0`}</Tex>) is a moment
                where the forces fire together in the work&apos;s
                own vocabulary. A valley{" "}
                (<Tex>{String.raw`A_i \ll 0`}</Tex>) is a quiet
                stretch setting up what follows. Peaks and valleys
                map rhythm, not merit.
              </P>
            </div>

            <div className="mt-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                Influence over time
              </h3>
              <P>
                The activity curve sums the forces into one line. To see{" "}
                <em>which</em> threads, entities, or rules are doing the pulling,
                the room reads the <B>Influence</B> alluvial. Pick a source
                (Fate, World, System, or Streams) and each band is one container
                &mdash; a question, an entity, a rule &mdash; its width at every
                scene-bucket equal to the attention it drew. Bands enter, swell,
                hand influence to one another, and resolve. <B>Type</B> mode
                re-groups the same flow by log kind instead of container.
              </P>
              <InfluenceAlluvialDiagram />
              <P>
                The literal picture of how things influence one another over a
                run &mdash; and the substrate for the second reading: whether the
                room has <em>been here before</em>{" "}
                (<a href="#embeddings" className="underline decoration-white/30 underline-offset-2 hover:decoration-white/60">Prior Knowledge &amp; Foresight</a>).
              </P>
            </div>
          </Section>

          {/* ── Fate Engine ─────────────────────────────────────────── */}
          <Section id="fate-engine" label="Fate Engine">
            <P>
              A world view doesn&apos;t hold a fixed picture of
              itself; it holds a <B>Belief System</B>, and that
              belief shifts as reality tests it. Threads are the
              units of that reckoning &mdash; each carries a{" "}
              <B>stance</B>, a live probability distribution over
              named outcomes. Each thread poses a question
              (&quot;Will Harry claim the Stone?&quot;) and lists
              two or more outcomes (binary default; multi-outcome
              enumerates). The stance is priced as softmax over a
              per-outcome logit vector:
            </P>
            <Eq
              tex={String.raw`p_k = \frac{\exp(\ell_k)}{\sum_j \exp(\ell_j)}, \quad k = 1 \dots K`}
            />
            <P>
              Three state variables: <B>logits</B>{" "}
              <Tex>{String.raw`\ell \in \mathbb{R}^K`}</Tex> price the
              distribution; <B>volume</B>{" "}
              <Tex>{String.raw`v \geq 0`}</Tex> tracks accumulated
              attention; <B>volatility</B>{" "}
              <Tex>{String.raw`\sigma`}</Tex> (EWMA of recent logit
              shifts) flags recent movement.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-2">
              Evidence updates
            </h3>
            <P>
              The LLM emits bounded integer <B>evidence</B>{" "}
              <Tex>{String.raw`e \in [-4, +4]`}</Tex> per affected
              outcome plus a <B>logType</B> from nine primitives
              (pulse, transition, setup, escalation, payoff, twist,
              callback, resistance, stall). Evidence shifts logits
              via log-odds arithmetic:
            </P>
            <Eq
              tex={String.raw`\ell_k \mathrel{+}= e_k / s, \quad s = 2`}
            />
            <P>
              Sensitivity <Tex>{String.raw`s = 2`}</Tex> means a
              saturating +4/−4 split shifts the margin by 4
              logit-units &mdash; exactly enough for base closure. The
              grammar matches the game-theory stake-delta scale used
              elsewhere; one mental model spans both. logType must
              agree with magnitude (setup +0..+1, escalation +2..+3,
              payoff +3..+4, twist ±3 against prior trend).
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-2">
              Volume decay — natural selection
            </h3>
            <P>
              Threads not touched by a delta lose volume geometrically:
            </P>
            <Eq
              tex={String.raw`v \leftarrow \alpha \cdot v, \qquad \alpha = 0.9`}
            />
            <P>
              Threads with <Tex>v &lt; 0.5</Tex> are <B>abandoned</B>{" "}
              &mdash; out of the active Belief System without being
              closed. The Belief System self-organises: threads that
              matter accumulate volume; ignored threads slide off.
              Resurrection costs{" "}
              <Tex>{String.raw`\Delta v \geq 2`}</Tex> &mdash;
              deliberate attention only.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-2">
              Outcome expansion
            </h3>
            <P>
              Stances can grow mid-story via{" "}
              <code className="text-white/70">addOutcomes</code>{" "}
              &mdash; when a scene opens a possibility that
              didn&apos;t exist before (new contender, unexpected
              option). New outcomes enter at{" "}
              <Tex>{String.raw`\ell = 0`}</Tex>; same-scene evidence
              can shift them. Closed stances reject expansion. A
              delta that expands outcomes cannot also close.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-2">
              Closure — meaningful resolution for meaningful outcomes
            </h3>
            <P>
              A thread closes when the top-outcome margin exceeds a
              volume-scaled threshold AND the closing scene emits a
              committal logType (payoff or twist) with{" "}
              <Tex>{String.raw`|e| \geq 3`}</Tex>:
            </P>
            <Eq
              tex={String.raw`\tau_{\text{eff}} = \tau_{\text{base}} \cdot \left(1 + \tfrac{1}{3} \ln\tfrac{v}{v_0}\right), \quad \tau_{\text{base}} = 3`}
            />
            <P>
              <Tex>{String.raw`v_0`}</Tex> is opening volume (default
              2). Heavy-attention threads need proportionally more
              decisive finishes; side threads close on the base
              threshold. Saturation alone doesn&apos;t trigger
              closure &mdash; pseudoclose is explicitly prevented.
            </P>
            <P>
              On close, <B>resolution quality</B>{" "}
              <Tex>{String.raw`q \in [0, 1]`}</Tex> is the geometric
              mean of four factors: peak evidence at close, margin
              over threshold, volume, and probability concentration.
              Bare-minimum evidence with low volume scores ~0.3;
              heavy stances closed on saturating two-sided evidence
              score above 0.75.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-2">
              Focus window — what generation sees
            </h3>
            <P>
              Each scene, the top-K threads by <B>focus score</B>{" "}
              surface to the generator:
            </P>
            <Eq
              tex={String.raw`\text{focus}(t) = v_t \cdot H(p_t) \cdot (1 + \sigma_t) \cdot \gamma^{\text{gap}_t}, \quad \gamma = 0.95`}
            />
            <P>
              <Tex>{String.raw`H(p_t)`}</Tex> is normalised entropy;{" "}
              <Tex>{String.raw`\text{gap}_t`}</Tex> is scenes since
              last touched. High focus = high volume + genuinely
              contested + recently moved. Saturating, closed, and
              abandoned threads score zero. <Tex>K = 6</Tex>.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-2">
              Belief system as narrative prior
            </h3>
            <P>
              Beyond measurement, the Belief System shapes generation.
              Current stances surface to the generator as a soft
              prior, not a constraint. Committed threads (
              <Tex>{String.raw`p \geq 0.75`}</Tex>) lean the next
              scene toward that outcome unless the logType is{" "}
              <code className="text-white/70">twist</code>; contested
              stances (<Tex>{String.raw`H \geq 0.9`}</Tex>) signal a
              crossroads where either side is fair game; high
              volatility grants licence for a twist; low volatility +
              high probability is saturation, ripe for closure. Good
              works briefly spike uncertainty at key pivots: twists
              and reversals raise aggregate entropy and the reader
              re-engages. Flat entropy is mid-work drag; compounding
              entropy spikes followed by clean collapses are the
              rhythm of a gripping work.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-2">
              The feedback loop with causal reasoning
            </h3>
            <P>
              Fate is one of three forces. The{" "}
              <a href="#planning" className="underline hover:text-white/80">reasoning graph</a>
              {" "}is where they converge &mdash; the Belief System
              exerts pressure, world entities carry agency, system
              rules impose constraints. Fate is a voice in the
              argument, not the conductor.
            </P>
            <P>
              The reasoning graph does <em>not</em> force threads to
              resolve. It receives each active thread tagged
              &mdash; LEANS, ACTIVE, CONTESTED, VOLATILE, FADING &mdash;
              and treats it as pressure. Strong-LEANS threads with
              volume earn fate nodes that land; CONTESTED threads often
              earn nothing (a legitimate pivot-arc shape); FADING
              threads decay. Fate nodes are what the reasoning
              concludes, not what it was forced to serve.
            </P>
            <P>
              The loop closes: scenes are reality landing → the
              Belief System revises → the next arc&apos;s reasoning
              graph sees a new stance → the graph lands what the
              updated stance can honestly earn → more reality.
              Threads that matter accrue volume and close with high
              resolution quality; threads that stop mattering decay
              into abandonment. No explicit horizon primitive is
              needed &mdash; natural selection through volume decay
              and focus-window ranking handles the lifecycle. What
              the world view <em>is</em> at any moment is just where
              this loop has carried it.
            </P>
          </Section>

          {/* ── Validation ──────────────────────────────────────────── */}
          <Section id="validation" label="Validation">
            <P>
              The room is only useful if the substrate underneath
              earns its keep. The claim is testable, and the test
              is concrete. The activity curve below was computed
              entirely from structural deltas extracted from{" "}
              <em>Harry Potter and the Sorcerer&apos;s Stone</em>
              {" "}&mdash; no prose scored, no scenes hand-ranked.
              The annotations land where they do because the
              formulas read the book the way a reader does,
              deterministically. <B>Orange</B> above zero: scenes
              where fate and world move together. <B>Light blue</B>{" "}
              below: the quieter stretches that set up the next
              peak. Same math runs on a campaign log, a portfolio
              quarter, or a War Room transcript.
            </P>

            {/* Annotated Activity Curve — computed from the Sorcerer's Stone narrative via the same formulas used in the app */}
            {(() => {
              // Smoothed activity values computed from the canonical
              // analysis: raw forces → rank→Gaussian normalise →
              // A = w_F·F + w_W·W + w_S·S (PCA weights) → Gaussian smooth (σ=1.5)
              const activity = [
                -0.204, -0.113, -0.092, -0.191, -0.325, -0.366, -0.309,
                -0.255, -0.261, -0.272, -0.180, 0.016, 0.156, 0.141,
                0.096, 0.164, 0.317, 0.475, 0.565, 0.499, 0.302, 0.117,
                0.041, 0.047, 0.031, -0.055, -0.087, 0.032, 0.172, 0.234,
                0.298, 0.376, 0.338, 0.170, 0.044, 0.040, 0.015, -0.140,
                -0.305, -0.312, -0.186, -0.063, -0.001, 0.039, 0.118,
                0.231, 0.267, 0.135, -0.099, -0.278, -0.350, -0.419,
                -0.510, -0.495, -0.341, -0.163, -0.079, -0.094, -0.115,
                -0.093, -0.080, -0.115, -0.157, -0.155, -0.095, 0.016,
                0.151, 0.286, 0.392, 0.412, 0.316, 0.121, -0.141,
              ];
              const n = activity.length;
              const W = 620,
                H = 220;
              const PAD = { top: 30, right: 20, bottom: 40, left: 40 };
              const cw = W - PAD.left - PAD.right;
              const ch = H - PAD.top - PAD.bottom;
              const dMin = Math.min(...activity);
              const dMax = Math.max(...activity);
              const range = dMax - dMin;
              const toX = (i: number) => PAD.left + (i / (n - 1)) * cw;
              const toY = (v: number) =>
                PAD.top + ch - ((v - dMin) / range) * ch;
              const zeroY = toY(0);

              const points = activity
                .map((v, i) => `${toX(i)},${toY(v)}`)
                .join(" ");

              // Build a path that interpolates the zero crossings between
              // adjacent samples, so the orange (above-zero) and blue
              // (below-zero) regions clip cleanly at y=0 instead of
              // dropping straight down at scene vertices.
              const pathPoints: Array<{ x: number; v: number }> = [];
              for (let i = 0; i < n; i++) {
                pathPoints.push({ x: toX(i), v: activity[i] });
                if (i < n - 1) {
                  const a = activity[i];
                  const b = activity[i + 1];
                  if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
                    const t = a / (a - b);
                    pathPoints.push({
                      x: toX(i) + t * (toX(i + 1) - toX(i)),
                      v: 0,
                    });
                  }
                }
              }
              const aboveD =
                `M${pathPoints[0].x},${zeroY} ` +
                pathPoints
                  .map((p) => `L${p.x},${toY(Math.max(p.v, 0))}`)
                  .join(" ") +
                ` L${pathPoints[pathPoints.length - 1].x},${zeroY} Z`;
              const belowD =
                `M${pathPoints[0].x},${zeroY} ` +
                pathPoints
                  .map((p) => `L${p.x},${toY(Math.min(p.v, 0))}`)
                  .join(" ") +
                ` L${pathPoints[pathPoints.length - 1].x},${zeroY} Z`;

              // Peaks and valleys called out directly from the activity
              // curve — local extrema in the smoothed signal.
              const peaks = [
                { scene: 13, label: "Hagrid's reveal" },
                { scene: 19, label: "Gringotts vault" },
                { scene: 32, label: "First Hogwarts lessons" },
                { scene: 47, label: "Flamel hunt" },
                { scene: 70, label: "Quirrell-Voldemort" },
              ];
              const valleys = [
                { scene: 6, label: "Dursleys' normalcy" },
                { scene: 39, label: "Three-headed dog aftermath" },
                { scene: 53, label: "Winter stretch" },
                { scene: 73, label: "Denouement" },
              ];

              return (
                <div className="my-8">
                  <svg
                    width="100%"
                    viewBox={`0 0 ${W} ${H}`}
                    className="overflow-visible"
                  >
                    {/* Grid lines — light reference lines at fixed
                        intervals; zero line slightly stronger because
                        it separates the two shaded regions. */}
                    {[-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1.0].map((v) => (
                      <g key={v}>
                        <line
                          x1={PAD.left}
                          y1={toY(v)}
                          x2={PAD.left + cw}
                          y2={toY(v)}
                          stroke="white"
                          strokeOpacity={v === 0 ? 0.18 : 0.05}
                        />
                        <text
                          x={PAD.left - 6}
                          y={toY(v) + 3}
                          textAnchor="end"
                          fill="white"
                          fillOpacity="0.2"
                          fontSize="8"
                          fontFamily="monospace"
                        >
                          {v.toFixed(1)}
                        </text>
                      </g>
                    ))}

                    {/* High-activity region (above zero) — orange.
                        Path interpolates zero-crossings so the fill
                        meets the baseline cleanly between scenes. */}
                    <path
                      d={aboveD}
                      fill="#F59E0B"
                      fillOpacity="0.38"
                    />
                    {/* Low-activity region (below zero) — light blue. */}
                    <path
                      d={belowD}
                      fill="#93C5FD"
                      fillOpacity="0.32"
                    />
                    {/* Activity line — thin so it does not dominate
                        the shaded regions. */}
                    <polyline
                      points={points}
                      fill="none"
                      stroke="#F59E0B"
                      strokeOpacity="0.6"
                      strokeWidth="1"
                      strokeLinejoin="round"
                    />

                    {/* Peak annotations — dashed leader + circle + label. */}
                    {peaks.map(({ scene, label }) => {
                      const i = scene - 1;
                      const x = toX(i);
                      const y = toY(activity[i]);
                      return (
                        <g key={`peak-${scene}`}>
                          <line
                            x1={x}
                            y1={y}
                            x2={x}
                            y2={y - 16}
                            stroke="#FCD34D"
                            strokeOpacity="0.35"
                            strokeDasharray="2 2"
                          />
                          <circle cx={x} cy={y} r={2.5} fill="#FCD34D" />
                          <text
                            x={x}
                            y={y - 20}
                            textAnchor="middle"
                            fill="#FCD34D"
                            fillOpacity="0.85"
                            fontSize="8"
                            fontFamily="system-ui"
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })}

                    {/* Valley annotations — dashed leader + circle + label. */}
                    {valleys.map(({ scene, label }) => {
                      const i = scene - 1;
                      const x = toX(i);
                      const y = toY(activity[i]);
                      return (
                        <g key={`valley-${scene}`}>
                          <line
                            x1={x}
                            y1={y}
                            x2={x}
                            y2={y + 16}
                            stroke="#60A5FA"
                            strokeOpacity="0.35"
                            strokeDasharray="2 2"
                          />
                          <circle cx={x} cy={y} r={2.5} fill="#60A5FA" />
                          <text
                            x={x}
                            y={y + 26}
                            textAnchor="middle"
                            fill="#60A5FA"
                            fillOpacity="0.85"
                            fontSize="8"
                            fontFamily="system-ui"
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  <p className="text-[10px] text-white/30 text-center mt-2">
                    Harry Potter and the Sorcerer&apos;s Stone &mdash;
                    73-scene smoothed activity curve. Orange above
                    zero marks high-activity scenes; light blue below
                    marks quieter setup stretches.
                  </p>
                </div>
              );
            })()}

            <P>
              The <B>peaks</B> line up with scenes where HP&apos;s three
              channels fire together: Hagrid&apos;s reveal, the Gringotts
              vault, the first Hogwarts lessons, the Flamel hunt, the
              Quirrell-Voldemort confrontation. Threads commit, entities
              transform, and the world&apos;s rules snap into focus at
              once. The peaks are not chosen by taste; they emerge from
              the deltas.
            </P>
            <P>
              The <B>valleys</B> are equally load-bearing. The Dursleys&apos;
              opening normalcy, the three-headed-dog aftermath, the
              winter stretch before the Forbidden Forest, the denouement
              &mdash; none of these resolve a thread. They are{" "}
              <B>turning points</B>: tension is seeded, a boundary is
              crossed, a character glimpses the unknown. Structurally
              they contribute less to each force, so the curve dips; the
              energy they store is what makes the next peak feel earned.
            </P>
            <P>
              Peaks are where the story <B>commits</B>; valleys are where
              it <B>launches</B>. The rhythm between them is the
              narrative&apos;s pulse, and both sides of the zero line
              carry weight.
            </P>
            <P>
              The core claim:{" "}
              <B>deterministic formulas applied to structural deltas
              recover the dramatic shape of a narrative</B>. The LLM
              extracts deltas at low temperature; the math is fully
              deterministic, and cross-run validation confirms stable
              rankings. The same formulas also drive generation &mdash;
              the measurement <em>is</em> the objective function &mdash;
              and that is exactly where to be careful. Once a score is
              what generation optimises toward, &ldquo;the output scores
              well&rdquo; proves nothing (Goodhart&apos;s law, cited
              below). The recovery test is clean <em>because it is
              post-hoc on a text the engine did not write</em>; the
              generative side earns no such free pass, and we don&apos;t
              grant it one.
            </P>
            <P>
              The implication runs past the proof of concept.
              Recovering <em>Harry Potter</em>&apos;s dramatic
              shape from delta arithmetic alone extends a small
              empirical tradition &mdash; emotional-arc and
              narrative-shape recovery from text
              <Cite id="reagan2016" label="Reagan et al. 2016" />
              <Cite id="boyd2020" label="Boyd et al. 2020" />{" "}
              &mdash; by reading not just sentiment but the three
              structural force-fields beneath it.{" "}
              <B>Coherent text has measurable structure.</B> The
              forces are domain-agnostic by construction: System
              counts rules and their connectivity, World counts
              entity-state changes, Fate counts information gain
              on open questions. A 73-turn campaign, a
              73-paragraph paper, and a 73-step strategy plan all
              accumulate those same three things, and the same
              math reads them. <B>What we have demonstrated is
              the narrative case</B>; the cross-domain claim is
              the working hypothesis the rest of the engine is
              built against. The novel proves the math is
              well-formed and <em>reproducible</em> &mdash; but
              reproducibility is not validity. Determinism lives{" "}
              <em>downstream</em> of the LLM&apos;s extraction: the
              interpretive judgement isn&apos;t removed, it is relocated
              upstream into which deltas get emitted. And reading a
              finished, designed artifact backward is a gentler task than
              projecting an open, adversarial reality forward. Whether
              the same math produces legible readings of a market regime
              or a competitor&apos;s next move is the next thing to
              prove, not something we claim today &mdash; and the proving
              ground is chosen: historical rehearsals, where a real
              decision with known ground truth is replayed under the
              original fog by teams who don&apos;t know us. Five
              non-founder cohorts, scored against what actually happened,
              results published either way. That is the bridge from the
              novel to the boardroom, and engine work queues behind it.
            </P>
          </Section>

          {/* ── Grading ───────────────────────────────────────────────── */}
          <Section id="grading" label="Grading">
            <P>
              Grading is the calibration layer, not a product feature:
              scoring published works against a reference corpus is how we
              verify the instrument reads known shapes correctly before
              trusting it on a room&apos;s live history. Each work receives a
              score out of 100, with 25 points allocated to each of the three
              forces plus <B>swing</B> — the Euclidean distance between
              consecutive force snapshots, measuring dynamic contrast. The
              grading curve is piecewise, calibrated so published works land
              in the 85–92 range.
            </P>
            <Eq tex="g(\tilde{x}) = 25 - 17\,e^{-k\tilde{x}} \qquad k = \ln\!\tfrac{17}{4} \approx 1.45 \qquad \tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}" />
            <P>
              A single exponential with three constraints: floor of 8 at{" "}
              <Tex>{"\\tilde{x}=0"}</Tex>, dominance threshold of 21 at{" "}
              <Tex>{"\\tilde{x}=1"}</Tex>, and asymptote of 25. The rate
              constant <Tex>{"k = \\ln(17/4)"}</Tex> is fully determined by
              these constraints. The curve naturally decelerates — early gains
              come easily, the last few points before the reference mean are
              harder to earn, and exceeding reference yields diminishing
              returns. Quality bands: bad (8–15), mediocre (15–20), good
              (21–25). At <Tex>{"\\tilde{x} = 1"}</Tex> (matching the reference
              mean), the grade is 21 out of 25 — the dominance threshold used by
              the archetype classifier. Above reference, exponential saturation
              makes each additional point harder to earn, asymptoting toward 25.
              Reference works land between 85 and 92.
            </P>

            <P>
              Each force is normalised against a reference mean so that
              scores are comparable across works of different signatures
              and lengths.
            </P>
            <P>
              The overall score sums all four sub-grades:{" "}
              <Tex>
                {
                  "\\text{Overall} = g(\\tilde{F}) + g(\\tilde{W}) + g(\\tilde{S}) + g(\\tilde{\\sigma})"
                }
              </Tex>
              , where <Tex>{"\\tilde{\\sigma}"}</Tex> is swing. Swing values are
              already mean-normalised by the reference means during distance
              computation, so no separate reference mean is needed —{" "}
              <Tex>{"g(\\tilde{\\sigma})"}</Tex> is applied directly to the
              average swing magnitude.
            </P>
            <P>
              Two anchors keep the scoring honest against reality, not
              against itself. <B>Recall</B> is checked when a consequential
              event actually lands &mdash; the room either had a fresh,
              played branch for it or it did not. And as
              threads resolve observably, their <B>confirmed</B> outcomes
              &mdash; walled in software from what the room merely believed
              &mdash; are scored by a strictly proper rule
              <Cite id="brier1950" label="Brier 1950" />. Full calibration
              infrastructure is deliberately a <em>later</em> layer (it is
              the hardest part to operationalise honestly); recognition
              against landed events is what ships first. What the practice
              never does is grade itself &mdash; both anchors consult the
              record, not the simulation.
            </P>
          </Section>

          {/* ── Embeddings & Proposition Classification ─────────────────── */}
          <Section id="embeddings" label="Embeddings">
            <P>
              A room running for months acquires more committed
              text than any single operator can hold in mind. The
              substrate keeps it searchable. Forces operate at the
              scene level; readers and players experience{" "}
              <B>prose</B>, composed of <B>propositions</B>{" "}
              &mdash; atomic claims that must be accepted as true
              within the world. &ldquo;Harry has a lightning-bolt
              scar.&rdquo; &ldquo;The wand chooses the wizard.&rdquo;
              {" "}Forces measure <B>what changes</B> in the
              knowledge graph; propositions measure <B>what is
              stated</B> in the prose. Every proposition is embedded
              as a 1536-dimensional vector (OpenAI
              text-embedding-3-small
              <Cite id="openai-emb2024" label="OpenAI 2024" />),
              transforming prose into a geometric space where
              similarity is distance
              <Cite id="reimers2019" label="Reimers &amp; Gurevych 2019" />.
            </P>
            <P>
              Coherent writing behaves <em>like</em> a <B>proof graph</B>:
              each proposition introduces, derives from, or resolves prior
              content. A plot hole reads as a broken inference chain, a
              satisfying resolution as a deep tree closing. The honest
              caveat: cosine similarity is <em>geometric approximation</em>,
              not logical inference — two propositions can cluster tightly
              from shared subject matter alone. The proof graph we recover
              is therefore <em>soft</em> — a well-shaped prior surfacing
              probable dependencies, not a verdict.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Activation
            </h3>
            <P>
              The full pairwise similarity structure is computed via matrix
              multiplication —{" "}
              <Tex>{"\\mathbf{S} = \\hat{E} \\hat{E}^\\top"}</Tex> where{" "}
              <Tex>{"\\hat{E}"}</Tex> is the L2-normalized embedding matrix —
              accelerated by TensorFlow.js. From this matrix, each proposition
              receives two scores: <B>backward activation</B> (how strongly it
              connects to prior content) and <B>forward activation</B> (how
              strongly future content builds upon it).
            </P>
            <Eq
              label="Hybrid activation score"
              tex="A(p_i, D) = 0.5 \cdot \max_{j \in D} S_{ij} + 0.5 \cdot \frac{1}{k} \sum_{j \in \text{top}_k(D)} S_{ij}"
            />
            <P>
              The hybrid of maximum (depth — strongest single dependency) and
              mean-top-<Tex>{"k"}</Tex> (breadth — cluster of strong
              connections) with <Tex>{"k=5"}</Tex> produces a robust activation
              score. A proposition is <B>HI</B> if its score exceeds an absolute
              threshold of 0.65, determined by systematic parameter sweep
              maximizing cross-work distributional variance (
              <Tex>{"\\Sigma \\text{var} = 225"}</Tex> across four reference
              works). The backward/forward binary produces four structural
              categories — <B>Anchor</B>, <B>Seed</B>, <B>Close</B>,{" "}
              <B>Texture</B> — detailed in the{" "}
              <a href="#classification" className="underline decoration-white/30 underline-offset-2 hover:decoration-white/60">
                Classification
              </a>{" "}
              section.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Prior Knowledge &amp; Foresight
            </h3>
            <P>
              The two north stars are this same backward/forward reading, lifted
              from propositions to whole scenes. Every scene&apos;s{" "}
              <B>summary</B> is embedded and pooled across <em>all branches</em>
              {" "}&mdash; every future the room has played, not just the active
              one. The cosine matrix{" "}
              <Tex>{String.raw`\mathbf{S} = \hat{E}\hat{E}^{\top}`}</Tex> gives
              each scene <Tex>{"i"}</Tex> its resemblance to every other; split by
              play order, earlier scenes feed <B>Prior Knowledge</B> (backward,
              recognition), later scenes feed <B>Foresight</B> (forward,
              anticipation).
            </P>
            <P>
              Cosine alone is too forgiving &mdash; a wall of 0.7 look-alikes
              reads as recognition when it is really déjà vu. So each similarity
              passes through a steep <B>logistic</B> centred on the match
              boundary <Tex>{String.raw`s_0`}</Tex>, and the strength is the{" "}
              <em>mean of the top&nbsp;K</em>: five strong matches sway far more
              than one lone hit, and mediocrity collapses toward zero.
            </P>
            <Eq
              label="Match ramp + recall strength"
              tex={String.raw`r(s) = \frac{1}{1 + e^{-\kappa\,(s - s_0)}}, \quad s_0 = 0.80,\ \kappa = 22 \qquad\qquad \rho(\mathcal{M}) = \frac{1}{K}\!\!\sum_{s\,\in\,\mathrm{top}_K(\mathcal{M})}\!\! r(s), \quad K = 5`}
            />
            <P>
              At <Tex>{String.raw`\kappa = 22`}</Tex> a 0.90 match counts roughly
              nine times a 0.70 one; anything below ~0.70 contributes almost
              nothing. Prior Knowledge and Foresight are that strength, read in
              each direction:
            </P>
            <Eq
              label="Prior knowledge (backward) · Foresight (forward)"
              tex={String.raw`\mathrm{Prior}_i = 100\,\rho\!\big(\{\,S_{ij} : j \prec i\,\}\big) \qquad\qquad \mathrm{Foresight}_i = 100\,\rho\!\big(\{\,S_{ij} : j \succ i\,\}\big)`}
            />
            <P>
              The decisive twist is <em>where</em> the backward match lives. A
              prior scene on <em>another</em> branch is a future the room
              actually played &mdash; a <B>rehearsal</B> of this moment &mdash;
              so it outweighs an in-branch echo. That rehearsal value accrues
              additively into <B>Experience</B>: deeper, more widely played
              branches level up &mdash; preparedness earned by play.
            </P>
            <Eq
              label="Cross-branch rehearsal → Experience"
              tex={String.raw`\mathrm{rehearsal}_i = \rho\!\Big(\big\{\,\min(1,\ \beta_{ij}\,S_{ij}) : j \prec i\,\big\}\Big), \quad \beta_{ij} = \begin{cases} 1.4 & j \text{ off-branch} \\ 1 & j \text{ same branch} \end{cases} \qquad \mathrm{XP} = \!\!\sum_{i\,\in\,\text{branch}}\!\! \mathrm{rehearsal}_i \;\to\; \mathrm{Level}`}
            />
            <P>
              <B>Prior Knowledge and Foresight are the north stars</B> &mdash;
              not a prediction the engine stakes, but a measure of{" "}
              <em>readiness</em>, and the room raises them the only honest way:
              by playing more futures. Their reality-anchored proof is{" "}
              <a href="#loop" className="underline decoration-white/30 underline-offset-2 hover:decoration-white/60">Recall Share</a>
              , the same instinct counted against events reality delivered. The
              geometry advises; reality scores.
            </P>
          </Section>

          {/* ── Classification ──────────────────────────────────────── */}
          <Section id="classification" label="Classification">
            <P>
              Classification is internal machinery with one customer: the
              rehearsal loop. It operates at two levels &mdash;{" "}
              <B>propositions</B> (the atomic claims within a record) and{" "}
              <B>whole runs</B> (the overall structural profile). Proposition
              classification tells generation which committed claims are
              load-bearing and must not be contradicted; run-level
              classification tells the room what kind of world it is playing.
              The literary distributions below are validation evidence, not a
              literary product.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Propositions
            </h3>
            <P>
              Each proposition is classified along three axes: backward{" "}
              <a href="#embeddings" className="underline decoration-white/30 underline-offset-2 hover:decoration-white/60">
                activation
              </a>{" "}
              (does it resolve prior content?), forward activation (does it
              plant future content?), and temporal reach (how far its
              connections span). The hybrid activation score (
              <Tex>
                {"0.5 \\cdot \\max + 0.5 \\cdot \\bar{x}_{\\text{top-}k}"}
              </Tex>
              ) is thresholded at <B>0.65</B>, calibrated by parameter sweep
              across four structurally distinct works. Reach is local
              (within-arc) or global (cross-arc), with the threshold set at 25%
              of total scenes (minimum 5) so &ldquo;global&rdquo; means the same
              thing whether the narrative has 20 scenes or 200. The combination
              yields eight categories:
            </P>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                {
                  name: "anchor",
                  color: "#6366f1",
                  signal: "HI back / HI fwd · local",
                  desc: "Load-bearing within an arc. Immediate structural tension that connects what just happened to what comes next.",
                },
                {
                  name: "foundation",
                  color: "#4338ca",
                  signal: "HI back / HI fwd · global",
                  desc: "Thematic spine. Load-bearing both directions with connections spanning the full narrative.",
                },
                {
                  name: "seed",
                  color: "#10b981",
                  signal: "LO back / HI fwd · local",
                  desc: "Short-range foreshadowing — the Remembrall leading to Harry becoming Seeker one scene later.",
                },
                {
                  name: "foreshadow",
                  color: "#047857",
                  signal: "LO back / HI fwd · global",
                  desc: "Cross-arc Chekhov's gun — Harry's scar mentioned in chapter one, structurally active in the climax.",
                },
                {
                  name: "close",
                  color: "#f59e0b",
                  signal: "HI back / LO fwd · local",
                  desc: "Resolves recent setups. Terminal within the arc — satisfying fate that doesn't seed further.",
                },
                {
                  name: "ending",
                  color: "#b45309",
                  signal: "HI back / LO fwd · global",
                  desc: "Resolves distant seeds — “Snape hated Harry's father” closing a thread from 46 scenes back.",
                },
                {
                  name: "texture",
                  color: "#6b7280",
                  signal: "LO back / LO fwd · local",
                  desc: "Scene-level atmosphere and sensory grounding. Structurally inert but narratively essential.",
                },
                {
                  name: "atmosphere",
                  color: "#4b5563",
                  signal: "LO back / LO fwd · global",
                  desc: "Ambient world-color across time. Recurring tonal motifs that persist without driving structure.",
                },
              ].map(({ name, color, signal, desc }) => (
                <div
                  key={name}
                  className="px-3 py-3 rounded-lg border border-white/6 bg-white/2"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-[12px] font-semibold text-white/70">
                      {name}
                    </span>
                    <span className="text-[9px] font-mono text-white/25">
                      {signal}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/40 leading-relaxed">
                    {desc}
                  </p>
                </div>
              ))}
            </div>

            <h4 className="text-sm font-semibold text-white/60 mt-6 mb-1">
              Causal Continuity
            </h4>
            <P>
              Classification transforms generation into{" "}
              <B>causal continuity management</B>. An LLM generating scene 45
              receives not just recent context but the specific propositions
              from scene 3 that embedding similarity identifies as structurally
              connected — the foundations and foreshadows that new prose must
              not contradict. A foreshadow in chapter one constrains what can be
              validly stated in chapter twenty.
            </P>
            <P>
              The resulting distributions align with structural expectations:{" "}
              <em>Harry Potter</em> yields 29% Anchor — consistent with a
              tightly plotted novel whose threads span the full narrative.{" "}
              <em>Alice&apos;s Adventures in Wonderland</em> shows 25% Anchor —
              lower, reflecting its episodic structure. LeCun&apos;s paper
              scores 14% Anchor and 53% Texture, characteristic of academic
              argumentation with section-local claims. A five-section methods
              paper (<em>Quantifying Narrative Force</em>) reaches 67% Texture.
              These distributions emerge from cosine similarity alone — the same
              threshold and the same formula applied uniformly across fiction,
              academic writing, and methods papers.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Archetypes
            </h3>
            <P>
              At the narrative level, each text is classified by which forces
              dominate its profile — a force is dominant if it scores &ge; 21
              and falls within 5 points of the maximum. A &ldquo;Chronicle&rdquo;
              (World + System) and a &ldquo;Stage&rdquo; (World-driven) demand
              different pacing, thread management, and revision priorities.
            </P>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              {ARCHETYPES.map(({ key, name, desc, color }) => (
                <div
                  key={key}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2"
                >
                  <ArchetypeIcon archetypeKey={key} size={16} color={color} />
                  <div>
                    <span className="font-medium text-white/70">
                      {name}
                    </span>
                    <p className="text-white/35 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Narrative Shapes
            </h3>
            <P>
              Beyond archetypes, the Gaussian-smoothed activity curve is
              classified into one of six shapes using overall slope, peak count,
              peak dominance, peak position, trough depth, and recovery
              strength.
            </P>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
              {SHAPES.map(({ name, desc, curve }) => (
                <div
                  key={name}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2"
                >
                  <ShapeCurve curve={curve} color="#fb923c" />
                  <div>
                    <span className="font-medium text-white/70">{name}</span>
                    <p className="text-white/35 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="text-sm font-semibold text-white/60 mt-6 mb-1">
              Scale
            </h3>
            <P>
              Scale classifies a narrative by structural length — scenes across
              all arcs. Thresholds are derived from empirical analysis of a
              reference corpus spanning short fiction (
              <em>Alice&apos;s Adventures in Wonderland</em>, 22 scenes) through
              novels (<em>Harry Potter</em>, 73 scenes) to epic-length serials.
            </P>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-2 text-[11px]">
              {SCALE_TIERS.map(({ key, name, desc, color }, i) => (
                <div
                  key={key}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 18 18"
                    className="shrink-0"
                  >
                    {[0, 1, 2, 3, 4].map((j) => (
                      <rect
                        key={j}
                        x={2 + j * 3}
                        y={14 - (j + 1) * 2.4}
                        width={2}
                        height={(j + 1) * 2.4}
                        rx={0.5}
                        fill={j <= i ? color : "#ffffff10"}
                      />
                    ))}
                  </svg>
                  <div>
                    <span className="font-medium text-white/70">
                      {name}
                    </span>
                    <p className="text-white/35 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="text-sm font-semibold text-white/60 mt-6 mb-1">
              World Density
            </h3>
            <P>
              World density measures narrative richness relative to length:
              (characters + locations + threads + system knowledge nodes) /
              scenes. Tier thresholds are derived from the same reference
              corpus, spanning genre fiction, literary fiction, and academic
              texts.
            </P>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-2 text-[11px]">
              {DENSITY_TIERS.map(({ key, name, desc, color }, i) => (
                <div
                  key={key}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 18 18"
                    className="shrink-0"
                  >
                    {[0, 1, 2, 3, 4].map((j) => (
                      <circle
                        key={j}
                        cx={9}
                        cy={9}
                        r={2 + j * 1.8}
                        fill="none"
                        stroke={j <= i ? color : "#ffffff10"}
                        strokeWidth={1}
                      />
                    ))}
                  </svg>
                  <div>
                    <span className="font-medium text-white/70">
                      {name}
                    </span>
                    <p className="text-white/35 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Reasoning Graph Nodes
            </h3>
            <P>
              The{" "}
              <a href="#planning" className="underline decoration-white/30 underline-offset-2 hover:decoration-white/60">
                causal reasoning graph
              </a>{" "}
              classifies every node into eight typed roles across three
              tiers. <B>Pressure</B> (fate, warning) forces change.{" "}
              <B>Substrate</B> (character, location, artifact, system) is
              what&rsquo;s changed. <B>Bridge</B> (reasoning, pattern)
              connects them.
            </P>
            <div className="mt-3 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              {[
                { name: "fate",      color: "#EF4444", body: "a thread's gravitational pull — what must resolve, and in which direction" },
                { name: "reasoning", color: "#A855F7", body: "a logical step connecting what fate needs to what entities can supply" },
                { name: "character", color: "#22C55E", body: "an active agent whose position, knowledge, or relationships move the arc" },
                { name: "location",  color: "#22D3EE", body: "a setting that enables or constrains what can happen" },
                { name: "artifact",  color: "#F59E0B", body: "an object whose presence, transfer, or loss carries narrative weight" },
                { name: "system",    color: "#3B82F6", body: "a rule of the world — magic, economics, social norm — that shapes action" },
                { name: "pattern",   color: "#84CC16", body: "an expansion agent — unexpected collisions, emergent properties, creative surprise" },
                { name: "warning",   color: "#F43F5E", body: "a subversion agent — predictable trajectories or unpaid costs to disrupt" },
              ].map(({ name, color, body }) => (
                <div
                  key={name}
                  className="rounded-lg bg-white/[0.03] border border-white/6 px-3 py-2"
                >
                  <span className="inline-block w-2 h-2 rounded-sm mr-2 align-middle" style={{ backgroundColor: color }} />
                  <span className="uppercase tracking-wider font-mono text-[10px] mr-2 text-white/70">
                    {name}
                  </span>
                  <span className="text-white/55">{body}</span>
                </div>
              ))}
            </div>
            <P>
              Edges carry equal semantic weight:{" "}
              <em>requires</em> (the workhorse),{" "}
              <em>enables</em>, <em>constrains</em>, <em>risks</em>,{" "}
              <em>causes</em>, <em>reveals</em>, <em>develops</em>,{" "}
              <em>resolves</em>. Edge type shapes both how the LLM walks
              the graph during scene generation and how the visual tree
              lays out.
            </P>
          </Section>

          {/* ── Research Methods ──────────────────────────────────────── */}
          <Section id="research" label="Interrogation">
            <P>
              Before the room sits down to play, the operators
              interrogate the world. Forces and embeddings measure
              what&rsquo;s <B>on the page</B>; a knowledge graph
              becomes a usable world only when it is <em>probed</em>.
              Four instruments compose a <B>four-layer diagnostic</B>
              {" "}of a world&rsquo;s interior &mdash; each revealing
              a structure the prose never summarises, and each
              feeding the room&apos;s pre-game briefing on who
              wants what and which seats matter:
            </P>
            <div className="mt-3 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              {[
                {
                  name: "surveys",
                  caption: "1 question · N respondents",
                  body: "cast-wide distribution. Eight lenses tilt the axis (Personality / Values / Knowledge / Trust / Allegiance / Threat / Predictions / Backstory). Fifteen respondents on \u201cdo you trust X?\u201d produces a row of the trust matrix, not a number.",
                  color: "#22D3EE",
                },
                {
                  name: "interviews",
                  caption: "1 subject · N questions",
                  body: "single-mind depth. AI generates 5\u20137 questions tuned to the subject's continuity, mixing binary / likert / estimate / choice / open. Compose: survey to find outliers, interview to probe them.",
                  color: "#FBBF24",
                },
                {
                  name: "decision matrix",
                  caption: "1- or 2-player decision per beat",
                  body: "the decision structure beneath the prose. A two-player decision is a 2\u00d72 game \u2014 an axis (11 types \u2014 information / trust / commitment\u2026) and a shape (16 types \u2014 dilemma / stag-hunt / signaling\u2026) with integer stake deltas in [\u22124, +4], scored on relative reward (who gains relative to whom). A one-player decision is a row over its alternatives \u2014 the chosen option weighed by its contribution against the field \u2014 a staked bet on a Fate thread, reality in the other seat. Stake magnitude is inflection, not drama: \u00b14 is arc-defining and rare, most moves are \u00b11\u2013\u00b12. Additive: written to scene.gameAnalysis, never mutates deltas.",
                  color: "#A855F7",
                },
                {
                  name: "elo",
                  caption: "continuous margin across games",
                  body: "strategic trajectory across the story. Margin score folds stake-differential into expected-vs-actual math \u2014 a +4/\u22124 crush = 1.0, a +1/0 edge = 0.56, a tie = 0.5. Behavioural tags (extractor / schemer / dominant / steady / rival:X) fall out of the trajectory.",
                  color: "#F97316",
                },
              ].map(({ name, caption, body, color }) => (
                <div key={name} className="rounded-lg bg-white/[0.03] border border-white/6 px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                    <span className="uppercase tracking-wider font-mono text-[10px] text-white/70">{name}</span>
                    <span className="text-white/30 text-[10px]">{caption}</span>
                  </div>
                  <span className="text-white/55">{body}</span>
                </div>
              ))}
            </div>
            <P>
              Every respondent answers in-character from its own world-
              graph continuity, grounded in what that specific entity
              knows. ELO
              <Cite id="elo1978" label="Elo 1978" />
              <Cite id="glickman1999" label="Glickman 1999" />{" "}
              uses a continuous margin rather than binary W/L:
            </P>
            <Eq
              label="Margin score from A's perspective"
              tex="s_A = \mathrm{clamp}\left(0.5 + \frac{\Delta_A - \Delta_B}{16},\ 0,\ 1\right)"
            />
            <P>
              Surveys sample breadth, interviews profile one mind, game
              theory names the strategic shape of a beat, ELO tracks who
              accumulates advantage. Narrative and strategic structure
              are orthogonal: a force-balanced scene can contain an
              unresolved prisoner&rsquo;s dilemma, and that orthogonality
              is what makes the fourth layer informative.
            </P>
            <P>
              Where the four diagnostics read the world <em>out</em>, a
              fifth instrument reps it <em>in</em>. <B>Learning</B>{" "}
              extracts a multiple-choice question bank from each scene
              &mdash; exhaustive over its concepts, aware of the whole
              narrative so distractors are drawn from the world&rsquo;s
              own material &mdash; and tags every question by concept,
              Bloom level, and difficulty. The banks pool into quizzes
              scoped by tag, scene, arc, or the full world view, and an
              immediate-feedback runner cycles them flashcard-style. The
              same substrate the room interrogates becomes the surface
              its members practise on, so the world a team builds is also
              the one they can drill until they hold it.
            </P>
          </Section>

          {/* ── Causal Reasoning ──────────────────────────────────────── */}
          <Section id="planning" label="Reasoning Graphs">
            <P>
              When the room asks <em>what could happen next, and
              why?</em> &mdash; the question scoring alone cannot
              answer &mdash; the substrate hands it a reasoning
              graph. An arc is four to eight scenes (or sessions)
              carrying a single chunk of work: advancing a thread,
              exposing an actor, planting a payoff. A thread
              escalates because an entity learned something, which
              required access to a location, which required an
              artifact to change hands, which was constrained by a
              system rule foreshadowed three scenes earlier.
              Consequence isn&apos;t a line. It&apos;s a graph.
            </P>
            <P>
              The architecture preserves this graph explicitly. Before
              any scene of an arc is generated, a{" "}
              <B>Causal Reasoning Graph</B> (CRG) is built: a typed
              graph of what must happen and why. Scenes then execute
              the graph rather than improvising local transitions. A
              longer-lived <B>Phase Reasoning Graph</B> (PRG; the UI
              calls it the <em>Mode Graph</em>) sits beneath every arc
              &mdash; the working model of the world&apos;s patterns,
              conventions, attractors, agents, rules, pressures, and
              landmarks &mdash; so each CRG reasons within the same
              world-physics rather than re-deriving it. Loose observations and source
              fragments collect in the editable <B>Priors</B> surface
              until they fold into one of these graphs and become
              canonical.
              The node and edge taxonomy &mdash; eight node types across
              pressure, substrate, and bridge tiers, plus eight edge
              types &mdash; is enumerated in the{" "}
              <a href="#classification" className="underline decoration-white/30 underline-offset-2 hover:decoration-white/60">
                Classification
              </a>{" "}
              section.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Thinking Modes
            </h3>
            <P>
              <em>How</em> the graph is built is as structural a choice as
              what&rsquo;s in it. Four modes cover the 2&times;2 of{" "}
              <B>direction</B> (forward from a premise ↔ backward from an
              outcome) and <B>scope</B> (selective — commit to one ↔
              expansive — keep many). The four map onto the classical
              epistemological typology: <em>abduction</em>{" "}
              <Cite id="peirce1903" label="Peirce 1903" /> as inference
              to the best explanation, <em>deduction</em> and{" "}
              <em>induction</em> in their textbook senses, and{" "}
              <em>divergent</em> thinking as the named cognitive mode
              for expansive ideation
              <Cite id="guilford1967" label="Guilford 1967" />.
              Click through the animation below to see each
              mode&rsquo;s distinct shape; the prose then unpacks how
              each actually builds a graph.
            </P>

            {/* ── Interactive thinking-mode animation ─────────────── */}
            <ThinkingModeExplorer />

            <div className="mt-6 space-y-5">
              {[
                {
                  name: "Abduction",
                  caption: "backward · selective",
                  color: "#F97316",
                  note: "default",
                  body: (
                    <>
                      Start from what the arc must end at — a thread
                      resolution, a character turn, a payoff — and ask{" "}
                      <em>which hypothesis, among competitors, best
                      produces this?</em> The engine generates several
                      candidate causal chains in parallel, then commits to
                      the strongest. Anchor discipline keeps the rejected
                      lanes visible as it builds; once the first prior
                      commits, abduction can silently flip into deduction
                      and stop considering alternatives.
                    </>
                  ),
                },
                {
                  name: "Divergent",
                  caption: "forward · expansive",
                  color: "#FBBF24",
                  body: (
                    <>
                      Start from one source — an entity, event, or thread
                      — and branch into many possibilities without
                      committing. A final check asks which leaf-pairs are{" "}
                      <B>mutually exclusive</B>. The mode for{" "}
                      <B>world expansion</B> and collision discovery, when
                      the goal is surprising adjacencies rather than a
                      specific outcome.
                    </>
                  ),
                },
                {
                  name: "Deduction",
                  caption: "forward · narrow",
                  color: "#A855F7",
                  body: (
                    <>
                      Given a premise, derive the{" "}
                      <em>single necessary consequence</em> at each step.
                      No branching, no alternatives. The mode for arcs
                      where the premise <B>fully determines the
                      outcome</B> — siege logistics, inheritance politics,
                      the endgame of a trap already walked into. Branching
                      means drift into divergent and must correct.
                    </>
                  ),
                },
                {
                  name: "Induction",
                  caption: "backward · generalising",
                  color: "#22D3EE",
                  body: (
                    <>
                      Many observations → inferred principle. The engine
                      collects prior events and asks: <em>what pattern
                      underlies these?</em> The answer is promoted to a
                      principle-level claim that governs future scenes. At
                      least one <B>competing generalisation</B> survives
                      as a live alternative. Useful for backfilling
                      worldbuilding or surfacing a thematic claim the
                      prose has been enacting implicitly.
                    </>
                  ),
                },
              ].map(({ name, caption, color, body, note }) => (
                <div key={name} className="flex gap-3">
                  <div
                    className="shrink-0 w-0.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-semibold text-[13px] text-white/70">
                        {name}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-white/35">
                        {caption}
                      </span>
                      {note && (
                        <span className="font-mono text-[9px] uppercase tracking-wider text-white/55 px-1.5 py-0.5 rounded bg-white/[0.06]">
                          {note}
                        </span>
                      )}
                    </div>
                    <p className="text-[12.5px] text-white/55 leading-[1.75]">
                      {body}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <P>
              Two further knobs shape the palette: <B>force preference</B>{" "}
              (fate / world / system / chaos / freeform) weights the
              node-kind mix, and <B>network bias</B> (inside / neutral /
              outside) tilts activation toward hot-recurring or cold-fresh
              entities. Each new arc also receives the <em>previous</em>{" "}
              arc&rsquo;s graph with a divergence directive — commitments
              must differ in kind, the reasoning chain must switch modes —
              so successive arcs don&rsquo;t re-describe the same causal
              spine.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              The Graph
            </h3>
            <P>
              Whatever the mode, the object produced is the same: a small
              typed graph. In the default abductive pass, generation does
              not start from the current scene asking &ldquo;what happens
              next?&rdquo; It starts from <B>Fate</B> — the threads the
              story owes the reader — and asks{" "}
              <em>
                what would have to be true for these threads to advance?
              </em>{" "}
              Each answer becomes a reasoning node, which pulls in the
              entities that can fulfil it. Pattern and warning nodes
              inject in parallel — patterns push for unexpected
              collisions, warnings flag the predictable path so the arc
              doesn&apos;t take it.
            </P>
            <P>
              Edges carry equal semantic weight. <em>Requires</em> is the
              workhorse (&ldquo;what must be true for this to
              happen&rdquo;), joined by <em>enables</em>,{" "}
              <em>constrains</em>, <em>risks</em>, <em>causes</em>,{" "}
              <em>reveals</em>, <em>develops</em>, and <em>resolves</em>.
              The result is a small causal graph — typically 8–20 nodes per
              arc — that the LLM walks as it generates. Scenes{" "}
              <em>execute</em> the graph; threads advance because an entity
              was forced to decide, not because the prompt said so.
            </P>
            <P>
              Below, a worked example: a causal reasoning graph built for
              a single arc. Fate nodes sit at the top (the threads the arc
              owes the reader), reasoning nodes bridge downward, and
              character / location / artifact / system nodes ground the
              chain in specifics. A pattern node and a warning node inject
              sideways — one pushing for unexpected collision, one
              flagging the predictable path to route around.
            </P>
            <ReasoningGraphDiagram />

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              World Expansion
            </h3>
            <P>
              At phase boundaries, <B>world expansion</B> introduces new
              characters, locations, artifacts, and threads — each seeded with
              knowledge asymmetries that drive future conflict. Expansion
              produces its own reasoning graph justifying why each new entity
              exists, then hands them to the next arc&apos;s causal graph as
              substrate. Long-range phases provide structure; reasoning graphs
              provide short-range causality that evolves arc by arc.
            </P>
          </Section>

          {/* ── Variable Scenarios ────────────────────────────────────── */}
          <Section id="variables" label="Variable Scenarios">
            <P>
              The room rarely needs <em>one</em> future. It needs a
              spread of them, weighted by how plausible each is.
              Reasoning graphs commit to a single chain &mdash; the
              arc&apos;s spine. <B>Variable scenario modelling</B>{" "}
              is the complement: a cohort of timelines with relative
              probabilities, presented to the room as a{" "}
              <em>compass</em> of decisions worth playing. The
              reasoning graph asks <em>what must happen and why</em>;
              variables ask <em>what could happen, and how likely</em>.
            </P>
            <P>
              The arc decomposes into a small <B>pool of variables</B> — the
              load-bearing forces that most reshape trajectory if they
              shift. Each <B>scenario</B> is one coordination over that
              pool: a pattern of intensities (0 off → 4 extreme). A{" "}
              <B>priorLogit ∈ [-4, +4]</B> scores each scenario relative to
              its siblings; softmax across the cohort produces the displayed
              probability &mdash; the cohort reads as a <B>compass</B>{" "}
              over possible continuations.
            </P>

            <VariableScenarioDiagram />

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Two surfaces, power-law shape
            </h3>
            <P>
              <B>Present</B> — the arc&apos;s load-bearing variables right
              now. <B>Future</B> — a cohort of next-arc scenarios over a
              shared pool. Reality doesn&apos;t distribute uniformly: most
              futures cluster near modal continuation; a thin tail covers
              rupture. The cohort matches the shape it&apos;s drawn from —
              tight when the possibility space is tight, fat-tailed when a
              load-bearing mechanism could ignite. PriorLogit is
              independent of intensity: intensity carries magnitude, the
              logit carries rarity.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              From scenarios to branches
            </h3>
            <P>
              Scenarios drive <B>Scenarios</B>: one parallel arc
              continuation per scenario. On commit, every scenario attaches
              as a sister branch; the softmax-top scenario&apos;s branch
              becomes active. Every committed run carries the variable
              fingerprint that produced it, so the substrate can
              compare what <em>actually</em> played out against the
              prior the Compass assigned.
            </P>
          </Section>

          {/* ── Prose Profiles ────────────────────────────────────────── */}
          <Section id="voice" label="Voice">
            <P>
              A scope note first: this is internal tooling, not a product
              line. Voice exists so the engine can write the session record
              &mdash; the negotiated agreements, commitments, and reveals a
              room walks away with &mdash; in prose a team will actually
              read. It was built and validated on the narrative corpus, none
              of it ships as an authoring product, and a reader allergic to
              literary machinery can skip to Reconstruction without losing
              the thread. Generation separates{" "}
              <B>content</B> (what is written) from <B>accent</B> (how it
              sounds). Content comes from beat plans, blueprints specifying
              the work each paragraph performs; accent comes from <B>prose
              profiles</B>, statistical fingerprints of authorial voice
              reverse-engineered from published works. Each beat is
              classified by function (10: breathe, inform, advance, bond,
              turn, reveal, shift, expand, foreshadow, resolve) and delivered
              through one of 8 mechanisms (dialogue, action, thought,
              narration, environment, memory, document, comic). The payoff:{" "}
              <B>structural control without stylistic constraint</B> &mdash;
              swap the profile and the same session renders in a different
              accent.
            </P>
            <P>
              Pacing is controlled by <B>Markov chains</B> over the same
              vocabulary
              <Cite id="norris1998" label="Norris 1998" />. Two layers, both
              derived the same way (classify each unit, count consecutive
              transitions, normalise rows): Layer 1 at the <em>scene
              level</em>, an 8-state matrix sampling force profiles for
              pacing; Layer 2 at the <em>beat level</em>, a 10-state matrix
              over beat functions controlling the texture of the record.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              Layer 1: Pacing Chains (Scene &rarr; Scene)
            </h3>
            <P>
              The eight cube corners form a finite state space. Each scene
              occupies one corner; consecutive scenes form an empirical Markov
              chain <Tex>{"T \\in \\mathbb{R}^{8 \\times 8}"}</Tex>, where{" "}
              <Tex>{"T_{ij}"}</Tex> is the probability of moving from mode{" "}
              <Tex>{"i"}</Tex> to mode <Tex>{"j"}</Tex>. Raw forces are
              computed per scene, z-score normalised across the novel, and
              classified into corners.
            </P>

            {/* HP Pacing State Graph — all 49 transitions */}
            <div className="my-6 flex flex-col items-center gap-4 overflow-x-auto">
              <svg
                width="400"
                height="400"
                viewBox="0 0 400 400"
                className="select-none max-w-full min-w-[300px]"
              >
                {(() => {
                  const names = [
                    "Epoch",
                    "Climax",
                    "Revelation",
                    "Closure",
                    "Discovery",
                    "Growth",
                    "Lore",
                    "Rest",
                  ];
                  const colors = [
                    "#f59e0b",
                    "#ef4444",
                    "#a855f7",
                    "#6366f1",
                    "#22d3ee",
                    "#22c55e",
                    "#3b82f6",
                    "#6b7280",
                  ];
                  const visits = [11, 7, 2, 15, 4, 12, 6, 16];
                  const cx = 200,
                    cy = 200,
                    r = 150;
                  const maxV = Math.max(...visits);
                  const positions = names.map((_, i) => {
                    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
                    return {
                      x: cx + r * Math.cos(angle),
                      y: cy + r * Math.sin(angle),
                    };
                  });
                  // All 38 transitions from HP delta analysis
                  const edges: [number, number, number][] = [
                    [7, 7, 5],
                    [3, 5, 4],
                    [1, 7, 4],
                    [0, 3, 4],
                    [7, 5, 3],
                    [5, 5, 3],
                    [0, 0, 3],
                    [7, 3, 3],
                    [3, 0, 3],
                    [3, 3, 3],
                    [5, 7, 3],
                    [4, 6, 2],
                    [6, 0, 2],
                    [5, 3, 2],
                    [1, 3, 2],
                    [6, 4, 2],
                    [7, 1, 2],
                    [3, 7, 2],
                    [0, 7, 1],
                    [3, 1, 1],
                    [3, 6, 1],
                    [0, 6, 1],
                    [6, 1, 1],
                    [5, 2, 1],
                    [2, 0, 1],
                    [0, 1, 1],
                    [7, 6, 1],
                    [4, 0, 1],
                    [5, 6, 1],
                    [6, 7, 1],
                    [3, 2, 1],
                    [2, 3, 1],
                    [5, 1, 1],
                    [1, 1, 1],
                    [7, 4, 1],
                    [4, 5, 1],
                    [5, 0, 1],
                    [0, 5, 1],
                  ];
                  const maxE = 5;
                  return (
                    <>
                      {edges.map(([fi, ti, count], ei) => {
                        if (fi === ti) {
                          const angle = (fi / 8) * Math.PI * 2 - Math.PI / 2;
                          const loopR = 14;
                          const ox = cx + (r + loopR + 12) * Math.cos(angle);
                          const oy = cy + (r + loopR + 12) * Math.sin(angle);
                          return (
                            <circle
                              key={ei}
                              cx={ox}
                              cy={oy}
                              r={loopR}
                              fill="none"
                              stroke="rgba(52,211,153,1)"
                              strokeWidth={1 + 2 * (count / maxE)}
                              opacity={0.12 + 0.55 * (count / maxE)}
                            />
                          );
                        }
                        const p1 = positions[fi],
                          p2 = positions[ti];
                        const dx = p2.x - p1.x,
                          dy = p2.y - p1.y;
                        const len = Math.sqrt(dx * dx + dy * dy);
                        const nx = -dy / len,
                          ny = dx / len;
                        const nr = 14 + (visits[ti] / maxV) * 10;
                        const ratio = Math.max(0, (len - nr - 8) / len);
                        return (
                          <line
                            key={ei}
                            x1={p1.x + 4 * nx}
                            y1={p1.y + 4 * ny}
                            x2={p1.x + dx * ratio + 4 * nx}
                            y2={p1.y + dy * ratio + 4 * ny}
                            stroke="rgba(52,211,153,1)"
                            strokeWidth={1 + 2 * (count / maxE)}
                            opacity={0.12 + 0.55 * (count / maxE)}
                            strokeLinecap="round"
                          />
                        );
                      })}
                      {names.map((name, i) => {
                        const p = positions[i];
                        const nr = 14 + (visits[i] / maxV) * 10;
                        return (
                          <g key={i}>
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={nr}
                              fill={colors[i]}
                              opacity={0.85}
                            />
                            <text
                              x={p.x}
                              y={p.y + 1}
                              fill="#fff"
                              fontSize="9"
                              fontWeight="600"
                              textAnchor="middle"
                              dominantBaseline="middle"
                            >
                              {name}
                            </text>
                            <text
                              x={p.x}
                              y={p.y + nr + 12}
                              fill="#9ca3af"
                              fontSize="8"
                              textAnchor="middle"
                            >
                              {visits[i]}x
                            </text>
                          </g>
                        );
                      })}
                    </>
                  );
                })()}
              </svg>
              <p className="text-[10px] text-white/30 text-center">
                Harry Potter and the Sorcerer&apos;s Stone — pacing chain. 73
                scenes, 72 transitions, 38 unique edges.
                <br />
                Node size = visit frequency. Edge thickness = transition count.
              </p>
            </div>

            <P>
              Harry Potter&apos;s pacing chain is broadly distributed:
              entropy 2.78/3.00, self-loop rate 20.8%, fate-to-buildup ratio
              35/38. Rest (16 visits) and Closure (15) lead, with Growth (12)
              and Epoch (11) close behind — the story spends most of its time
              either breathing or earning its peaks, with high-force scenes
              punctuating rather than dominating. The strongest transitions
              (Rest&rarr;Rest 5x, then Closure&rarr;Growth, Climax&rarr;Rest,
              and Epoch&rarr;Closure each 4x) show a rhythm of build,
              culminate, settle, build again.
            </P>
            <P>
              Other works produce strikingly different fingerprints.{" "}
              <em>Nineteen Eighty-Four</em> is fate-heavy — 72% of scenes land
              in the top four corners, reflecting Orwell&apos;s sustained
              pressure rather than Rowling&apos;s pivoting.{" "}
              <em>The Great Gatsby</em> oscillates between Epoch and Rest with
              little middle ground — Fitzgerald&apos;s pendulum rhythm. Each
              work&apos;s transition matrix is a measurable authorial signature.
            </P>
            <P>
              Before generating an arc, the engine walks the active matrix
              for N steps, producing a sequence like{" "}
              <span className="font-mono text-white/50">
                Growth &rarr; Lore &rarr; Climax &rarr; Rest &rarr; Growth
              </span>
              . Each step becomes a per-scene force target. Users pick a{" "}
              <em>rhythm profile</em> derived from a published work: a story
              on Rowling&apos;s matrix pivots constantly between peaks, one
              on Orwell&apos;s sustains pressure then erupts. Whether Markov
              guidance beats unguided generation on composite score is a
              testable claim we have not yet run in controlled experiment.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              Layer 2: Beat Chains (Beat &rarr; Beat)
            </h3>
            <P>
              Pacing chains control <em>which force profile</em> a scene
              hits. Within a scene, the prose has its own structure &mdash; a
              sequence of discrete <strong>beats</strong>, each a narrative
              function delivered through a mechanism &mdash; and an LLM
              decomposes scenes into beats against the fixed taxonomy of 10
              functions and 8 mechanisms.
            </P>

            <P>
              The <strong>10 beat functions</strong> describe what each section
              of prose does:{" "}
              <span className="text-white/60">
                <B>breathe</B> (atmosphere, grounding), <B>inform</B>{" "}
                (knowledge delivery), <B>advance</B> (forward momentum),{" "}
                <B>bond</B> (relationship shifts), <B>turn</B> (pivots and
                reversals), <B>reveal</B> (character nature exposed),{" "}
                <B>shift</B> (power dynamics invert), <B>expand</B>{" "}
                (world-building), <B>foreshadow</B> (plants for later fate),{" "}
                <B>resolve</B> (tension releases).
              </span>
            </P>

            <P>
              The <strong>8 mechanisms</strong> describe how each beat is
              delivered as prose: dialogue, thought, action, environment,
              narration, memory, document, comic. A single beat function can be
              delivered through different mechanisms — a <em>reveal</em> can
              land through dialogue, action, or narration, each producing a
              different texture.
            </P>

            <P>
              The methodology mirrors the pacing chain exactly: extract beat
              plans from every scene of a published work, tally consecutive
              function&rarr;function transitions, normalise rows, and produce a
              Markov matrix <Tex>{"B \\in \\mathbb{R}^{10 \\times 10}"}</Tex>.
              Applied to <em>Harry Potter and the Sorcerer&apos;s
              Stone</em>, beat-plan extraction yielded 1,254 beats
              across the 73-scene novel &mdash; roughly 17 beats per
              scene:
            </P>

            {/* HP Beat Profile Graph — all 92 transitions */}
            <div className="my-6 flex flex-col items-center gap-4 overflow-x-auto">
              <svg
                width="420"
                height="420"
                viewBox="0 0 420 420"
                className="select-none max-w-full min-w-[300px]"
              >
                {(() => {
                  const fns = [
                    "breathe",
                    "inform",
                    "advance",
                    "bond",
                    "turn",
                    "reveal",
                    "shift",
                    "expand",
                    "foreshadow",
                    "resolve",
                  ];
                  const fnColors: Record<string, string> = {
                    breathe: "#6b7280",
                    inform: "#3b82f6",
                    advance: "#22c55e",
                    bond: "#ec4899",
                    turn: "#f59e0b",
                    reveal: "#a855f7",
                    shift: "#ef4444",
                    expand: "#06b6d4",
                    foreshadow: "#84cc16",
                    resolve: "#14b8a6",
                  };
                  const visits = [205, 255, 329, 96, 83, 81, 44, 48, 48, 65];
                  const cx = 210,
                    cy = 210,
                    r = 155;
                  const maxV = Math.max(...visits);
                  const positions = fns.map((_, i) => {
                    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
                    return {
                      x: cx + r * Math.cos(angle),
                      y: cy + r * Math.sin(angle),
                    };
                  });
                  // All 92 transitions from HP beat analysis
                  const edges: [number, number, number][] = [
                    [1, 2, 98],
                    [0, 1, 82],
                    [2, 1, 66],
                    [2, 2, 58],
                    [0, 2, 56],
                    [2, 0, 42],
                    [2, 4, 38],
                    [2, 3, 31],
                    [2, 9, 29],
                    [1, 3, 27],
                    [4, 2, 26],
                    [3, 2, 26],
                    [1, 0, 25],
                    [5, 2, 24],
                    [2, 5, 23],
                    [1, 5, 23],
                    [1, 1, 23],
                    [4, 1, 21],
                    [1, 7, 20],
                    [3, 1, 18],
                    [0, 0, 16],
                    [5, 1, 16],
                    [7, 2, 16],
                    [0, 4, 14],
                    [5, 3, 13],
                    [1, 4, 13],
                    [3, 5, 11],
                    [3, 0, 11],
                    [2, 6, 11],
                    [5, 9, 10],
                    [8, 0, 10],
                    [2, 8, 9],
                    [1, 6, 9],
                    [6, 2, 9],
                    [2, 7, 9],
                    [7, 1, 9],
                    [9, 2, 8],
                    [6, 5, 8],
                    [4, 6, 8],
                    [3, 6, 7],
                    [8, 2, 7],
                    [1, 8, 7],
                    [0, 3, 7],
                    [9, 8, 6],
                    [0, 7, 6],
                    [0, 8, 6],
                    [4, 8, 6],
                    [9, 0, 6],
                    [8, 9, 5],
                    [3, 4, 5],
                    [7, 0, 5],
                    [0, 9, 5],
                    [4, 0, 5],
                    [1, 9, 5],
                    [9, 3, 5],
                    [3, 7, 5],
                    [6, 9, 5],
                    [8, 1, 4],
                    [5, 8, 4],
                    [7, 5, 4],
                    [5, 4, 4],
                    [0, 5, 4],
                    [6, 8, 4],
                    [4, 3, 4],
                    [6, 1, 4],
                    [9, 6, 4],
                    [9, 4, 3],
                    [6, 4, 3],
                    [3, 3, 3],
                    [4, 5, 3],
                    [6, 0, 3],
                    [8, 4, 3],
                    [6, 3, 3],
                    [5, 6, 3],
                    [4, 9, 3],
                    [9, 5, 3],
                    [3, 8, 3],
                    [3, 9, 3],
                    [9, 1, 3],
                    [7, 8, 3],
                    [4, 7, 3],
                    [5, 0, 2],
                    [7, 3, 2],
                    [0, 6, 1],
                    [5, 7, 1],
                    [7, 7, 1],
                    [5, 5, 1],
                    [7, 6, 1],
                    [8, 7, 1],
                    [9, 7, 1],
                    [6, 7, 1],
                    [8, 5, 1],
                  ];
                  const maxE = 98;
                  return (
                    <>
                      {edges.map(([fi, ti, count], ei) => {
                        if (fi === ti) {
                          const angle = (fi / 10) * Math.PI * 2 - Math.PI / 2;
                          const loopR = 14;
                          const ox = cx + (r + loopR + 12) * Math.cos(angle);
                          const oy = cy + (r + loopR + 12) * Math.sin(angle);
                          return (
                            <circle
                              key={ei}
                              cx={ox}
                              cy={oy}
                              r={loopR}
                              fill="none"
                              stroke="rgba(52,211,153,1)"
                              strokeWidth={0.5 + 2.5 * (count / maxE)}
                              opacity={0.08 + 0.6 * (count / maxE)}
                            />
                          );
                        }
                        const p1 = positions[fi],
                          p2 = positions[ti];
                        const dx = p2.x - p1.x,
                          dy = p2.y - p1.y;
                        const len = Math.sqrt(dx * dx + dy * dy);
                        const nx = -dy / len,
                          ny = dx / len;
                        const nr = 12 + (visits[ti] / maxV) * 12;
                        const ratio = Math.max(0, (len - nr - 6) / len);
                        return (
                          <line
                            key={ei}
                            x1={p1.x + 3 * nx}
                            y1={p1.y + 3 * ny}
                            x2={p1.x + dx * ratio + 3 * nx}
                            y2={p1.y + dy * ratio + 3 * ny}
                            stroke="rgba(52,211,153,1)"
                            strokeWidth={0.5 + 2.5 * (count / maxE)}
                            opacity={0.08 + 0.6 * (count / maxE)}
                            strokeLinecap="round"
                          />
                        );
                      })}
                      {fns.map((fn, i) => {
                        const p = positions[i];
                        const nr = 12 + (visits[i] / maxV) * 12;
                        return (
                          <g key={i}>
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={nr}
                              fill={fnColors[fn]}
                              opacity={0.85}
                            />
                            <text
                              x={p.x}
                              y={p.y + 1}
                              fill="#fff"
                              fontSize="8"
                              fontWeight="600"
                              textAnchor="middle"
                              dominantBaseline="middle"
                            >
                              {fn}
                            </text>
                            <text
                              x={p.x}
                              y={p.y + nr + 12}
                              fill="#9ca3af"
                              fontSize="8"
                              textAnchor="middle"
                            >
                              {visits[i]}x
                            </text>
                          </g>
                        );
                      })}
                    </>
                  );
                })()}
              </svg>
              <p className="text-[10px] text-white/30 text-center">
                Harry Potter and the Sorcerer&apos;s Stone — beat chain. 1,254
                beats, 1,163 transitions, 92 unique edges.
                <br />
                Node size = beat frequency. Edge thickness = transition count.
              </p>
            </div>

            <P>
              The chain reveals <em>advance</em> as the dominant hub (329
              beats, 26%) — momentum is Rowling&apos;s connective tissue.
              The strongest single transition is{" "}
              <em>inform &rarr; advance</em> (98x): knowledge delivery
              triggers action. <em>Breathe</em> feeds almost exclusively into{" "}
              <em>inform</em> (82x) and <em>advance</em> (56x) — atmosphere
              exists to launch the next movement. All 100 pairs appear at
              least once; the matrix is dense.
            </P>

            <P>
              Other works shift the pattern. <em>Nineteen Eighty-Four</em>{" "}
              gives reveal unusual prominence — a mind trapped between inner
              world and outer surveillance. <em>Gatsby</em> leans on dialogue
              and narration — Fitzgerald&apos;s observer-narrator reporting.{" "}
              <em>Alice</em> is advance-dominant with minimal bonding — a
              protagonist propelled through episodes without deepening
              relationships.
            </P>

            <P>
              Alongside the transition matrix, the analysis extracts a{" "}
              <strong>mechanism distribution</strong>. Harry Potter is
              dialogue-heavy (42% dialogue, 29% action, 16% environment, 6%
              thought, 5% narration) — a conversation-driven pedagogy where
              characters explain magic by arguing, teasing, and showing off.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              Combining the Chains
            </h3>
            <P>
              Two independent chains on orthogonal axes:{" "}
              <em>what happens</em> (LLM from narrative logic),{" "}
              <em>how intensely</em> (scene-level pacing chain), and{" "}
              <em>how it reads</em> (beat-level prose chain) &mdash; both
              derived empirically from published works.
            </P>
          </Section>

          {/* ── Revision ──────────────────────────────────────────── */}
          <Section id="revision" label="Reconstruction">
            <P>
              First sessions are messy, and a room&apos;s ledger is only
              useful if it can be cleaned without being falsified &mdash;
              that is the job here.{" "}<B>Evaluation</B> reads session
              summaries and assigns per-scene verdicts;{" "}
              <B>reconstruction</B> creates a new versioned branch,
              applying verdicts in parallel &mdash; edits revise
              content, merges combine scenes, inserts fill gaps,
              moves reposition without any LLM call, cuts are
              omitted. World commits pass through at their original
              positions. The original branch is never modified.
              The room can replay an old session into a cleaner
              version of its own past without losing what actually
              happened.
            </P>

            <div className="mt-4 space-y-1.5 text-[12px]">
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-white/70 font-mono w-14 shrink-0">
                  ok
                </span>
                <span className="text-white/50">
                  Structurally sound, continuity intact. Kept as-is.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-white/70 font-mono w-14 shrink-0">
                  edit
                </span>
                <span className="text-white/50">
                  Revise content — may change POV, location, participants,
                  deltas, and summary.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-white/70 font-mono w-14 shrink-0">
                  merge
                </span>
                <span className="text-white/50">
                  Absorbed into another scene. Both scenes&apos; best elements
                  combined into one denser beat.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-white/70 font-mono w-14 shrink-0">
                  insert
                </span>
                <span className="text-white/50">
                  New scene generated to fill a pacing gap, missing transition,
                  or stalled thread.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-white/30 font-mono w-14 shrink-0">
                  cut
                </span>
                <span className="text-white/50">
                  Redundant. Removed — the narrative is tighter without it.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-white/70 font-mono w-14 shrink-0">
                  move
                </span>
                <span className="text-white/50">
                  Content correct but wrong position. Repositioned after a
                  target scene using{" "}
                  <code className="text-white/60">moveAfter</code>. No LLM
                  call — prose preserved exactly.
                </span>
              </div>
            </div>

            <P>
              Evaluations can be <B>guided</B> with external feedback —
              from another AI, a human editor, or the author&apos;s own
              notes. Each reconstruction produces a versioned branch
              (<em>v2</em>, <em>v3</em>, <em>v4</em>); the loop
              converges in 2–3 passes. Structural branching uses git-
              like reference sharing so a 200-scene narrative with 10
              branches stores far fewer than 2000 scene objects.
            </P>
          </Section>

          {/* ── Multiplayer Wargaming ────────────────────────────────── */}
          <Section id="war-rooms" label="War Rooms">
            <P>
              The <B>War Room</B> is the product&apos;s <B>live</B> half,
              the fast counterpart to the asynchronous Capture that feeds
              it between sessions. Give it a text corpus with enough depth
              across <B>System / World / Fate</B> (SWF) and it deploys into
              a playable room: a vision-rendered board where human
              operators and AI agents sit around the same state, take
              turns, and move pieces against a shared rulebook the engine
              arbitrates. Narrative was the validation substrate; the room
              is what the substrate is for. Same engine, same forces, same
              fork-and-commit math underneath: not speculative
              architecture, the product running today.{" "}
              <Cite id="perla1990" label="Perla 1990" />
              <Cite id="schelling1960" label="Schelling 1960" />
            </P>
            <P>
              The loss it insures against here is the campaign&apos;s:{" "}
              <em>the opposition move you met cold</em> &mdash; the attack
              that lands on a Tuesday you never gamed, with no counter
              rehearsed and the news cycle already moving. The room exists so
              the other side&apos;s best play is one you have already sat
              across from, in a session where being wrong cost nothing.
            </P>
            <P>
              <B>The console shows the board; everyone joins the same
              instance.</B> The shared screen renders the world view at a
              glance; each player works their <B>perspective interface</B>{" "}
              on their own device &mdash; a controller scoped to their seat
              (its feed, hand, and history, depth GM-configurable), joined
              over the tunnel to the same live state. The GM keeps the full
              console; players get their vantage, not everyone else&apos;s,
              which keeps the asymmetry honest. The render is one of two
              surfaces, the same two the app is built around:
            </P>
            <ul className="mt-3 space-y-2 text-[13px] text-white/55 leading-[1.85]">
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>Graph</B> &mdash; the raw substrate: nodes and
                  edges, who knows whom, who controls what, what
                  causes what. The default for influence campaigns,
                  conspiracies, supply chains.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>Board</B> &mdash; a board-game-style map with
                  nested maps: continuous space, territories, terrain
                  you can drill into. The fit wherever geography or
                  position is the binding constraint &mdash;
                  logistics, geopolitics, regional contests.
                </span>
              </li>
            </ul>
            <P>
              Switching surface is re-projection, not rebuilding
              &mdash; the same substrate read as whichever of the two
              the room needs.
            </P>
            <P>
              <B>Rehearsal mode one: <em>Conviction</em>.</B> The first
              rehearsal mode is a card game called <B>Conviction</B>, about
              belief made visible: holding conviction and showing it is
              what lets a team coordinate in chaos. It is rehearsal, not
              entertainment &mdash; capture&apos;s peer-stance reading,
              gamified into a high-feedback drill for deciding under
              uncertainty and reading the room. With a full table the play
              is <em>emergent, not scripted</em>: sometimes there is no best
              move, sometimes you commit and signal, sometimes you go covert
              and trust the team. At root it <B>turns the tedious work of
              simulating outcomes into a social process</B> &mdash; players
              choose the actions they&apos;ll play, then the world is{" "}
              <em>simulated one step forward</em>: forecasting reframed as a
              table everyone reads, rather than a solitary calculation.
              (Rehearsal is a pluggable layer over the
              shared resolver; more modes can ride the same substrate later.)
            </P>
            <P>
              It is <B>information-asymmetry driven</B>: strategy is what
              each player knows, what each thinks the others know, and which
              signals are worth sending. Every operator drives one or more{" "}
              <em>entities</em>; each keeps a <B>private log</B> (its hidden
              state) and reads a <B>perspective feed</B> &mdash; the world
              retold from its vantage, refreshed each step, and all it (or
              the AI playing it) knows. Talk is <em>cheap</em>: negotiate,
              propose, threaten, mislead &mdash; words bind nothing. Even who
              you can talk to is a position: seats sharing a place get a{" "}
              <B>private location channel</B> where alliances form, and a
              seat travels the map <em>node-to-node, one hop a round</em>,
              reshaping the streams it holds. A card is the opposite, a{" "}
              <B>paid, binding commitment</B> (face-up to show it, face-down
              to hide it), which makes it a credible signal. You{" "}
              <B>cooperate</B> by backing your words with cards and{" "}
              <B>defect</B> by playing against them. What you said is free;
              what you played is on the record, and the gap is where trust
              dies.
            </P>
            <P>
              <B>What you do on your turn.</B> One action, poker&apos;s
              grammar: <B>play</B> a card (commit to an outcome, pay its
              cost), <B>raise</B> (pour more conviction into one already
              backed), <B>pass</B>, or <B>fold</B>. A card is a{" "}
              <em>concrete claim about the near future</em> &mdash;
              &ldquo;rates hold,&rdquo; &ldquo;the rival cuts price,&rdquo;
              &ldquo;the regulator opens a file&rdquo; &mdash; drawn from the
              threads your entity cares about, played <B>face-up</B> to
              signal or <B>face-down</B> to hide. Cards are grouped by{" "}
              <B>stream</B> (one open question and the outcomes you can
              back), each carrying a <em>sparkline</em> of how its belief
              moved as priors landed. The round wraps the turns in ordered
              phases (intent, negotiation, commit, reveal, resolution).
            </P>
            <P>
              <B>Conviction is the scarce resource &mdash; and it
              decays.</B> Playing a card <em>spends conviction priced by
              improbability</em>: the likely call is cheap, a long-shot
              dear. You grow your hand by <B>feeding priors to your
              streams</B> &mdash; belief that genuinely shifts the odds
              earns conviction and cheapens the call, but one the engine
              reads as <em>implausible or over-biasing is refused</em>, so
              you influence only within the plausible (no junk in the shared
              model). Leave a stance unplayed and you <em>cede</em> it; the
              question <em>closes at round&apos;s end</em>. <B>Certainty is
              an aggregate of conviction</B> &mdash; the world is what the
              room commits to. An allowance arrives each round; unspent
              conviction banks but <em>decays</em>, so hoarding costs you.
            </P>
            <P>
              At resolution the round&apos;s plays <B>fold into a merge
              and the engine generates the continuation</B> &mdash; the
              same merge-and-generate path capture commits through.
              Contested stances resolve <em>payment-weighted</em>; plural
              ones land as a reconciled <em>multi-resolution</em>, never a
              blurred average. (A causal-reasoning-graph resolver is the
              upgrade path; the merge is where it starts.) Empty seats
              fill with AI agents on set profiles &mdash;{" "}
              <em>compete, cooperate, extract, spoil</em>; an adversarial
              one red-teams. The world steps forward a tick. <B>A deck
              dealt against a moving world, one step at a time.</B>
            </P>
            <P>
              Every commitment becomes a thread delta, every reveal updates
              priors, every negotiated agreement a new system rule the next
              move honors or breaks. You buy the <em>outcome</em> you commit,
              not its <em>consequences</em> &mdash; the graph generates the
              fallout, which can bite, and learning that fallout is the
              point. The War Room is not a microsim (one card, one
              negotiation, one resolution per phase), so it moves at the pace
              of strategic conversation, not tactical execution. AI-dealt
              hands surface the plays the priors say make sense now;
              operators can also <em>author</em> their own &mdash;
              side-channel proposals, disclosures not in the dealt hand. AI
              keeps the game honest to the substrate; custom cards keep it
              honest to real intuition.
            </P>
            <P>
              <B>Multiple play-throughs.</B> The room plays the future
              several ways &mdash; high-mass <em>compass</em> scenarios
              first, then <em>free-form</em> branches tested on instinct.
              Each is a kept fork, so you can <B>replay under different
              conditions</B> and, because the graph <em>reasons</em> the
              outcome rather than scripting it, get a different continuation
              that tests whether you understood why. <B>Disclosure:</B> that
              reasoning is the engine&apos;s subjective reading, an LLM
              walking a causal graph, not the real world. It is{" "}
              <B>regenerable</B> with a custom guidance vector or thinking
              mode, so a resolution is <em>a</em> reasoned reading, never{" "}
              <em>the</em> answer.
            </P>
            <P>
              <B>The honest promise: more of the board, not better
              outcomes.</B> We don&apos;t claim the room makes decisions{" "}
              <em>better</em> &mdash; that is hard to prove. It gives you the
              space to <em>see more outcomes from where you stand</em>: playing
              a model is your life on <B>10&times; speed</B>, more of the board
              revealed &mdash; a hypothetical board, but one you walked before
              the real move came. You may not choose differently; you choose
              having seen further.
            </P>
            <P>
              <B>Eyes on the board, eyes on the graph.</B> Most operator
              time lives on those two surfaces; everything else (cards,
              dialogue logs, settings) is fast plumbing. They are{" "}
              <em>seeing</em> surfaces: the operator originates the{" "}
              <em>which world, which seat, which move</em> the model reasons
              over. Vision is the human contribution; the room renders it,
              the substrate records it.
            </P>
            <P>
              <B>Betting is the competitive layer &mdash; pari-mutuel,
              GM-run.</B> Conviction <em>shapes</em> the outcome; betting{" "}
              <em>wagers</em> on it &mdash; a side economy the game master
              toggles per room. It is <B>off by default and consent-gated</B>,
              offered only in fast-feedback rooms (markets, campaigns, live
              ops), never long-horizon strategy, and <B>fully separable</B>:
              a surface over stance pricing that never touches the Capture
              loop or the substrate, so it switches off without a trace.
              Stakes pool on each outcome and split among winners pro-rata
              less the GM&apos;s rake &mdash; the odds are the table&apos;s,
              not a book&apos;s &mdash; and because the pool pays least on the
              favourite, <em>forcing a long-shot you also backed</em> is the
              sharp play. Stakes scale: <B>fictional</B> (chips, ELO,
              leaderboards), <B>reality-anchored</B> (stakes pooled on
              real-world questions, with prize pools), or <B>real</B> (trades
              recorded as commitments, only with legal sign-off) &mdash; turning
              it into <em>skin-in-the-game rehearsal</em> where a dishonest
              signal costs you.
            </P>
            <P>
              <B>Agency, not price.</B> Prediction markets reduce
              every participant to a price and a position size.
              <Cite id="hanson2003" label="Hanson 2003" />
              <Cite id="wolfers2004" label="Wolfers &amp; Zitzewitz 2004" />
              {" "}A War Room asks you to <em>play the actor that produces
              the outcome</em> &mdash; take a seat, hold a private log,
              signal with cards, negotiate, commit. The market gives you a
              number; the room gives you a role and a story you helped author
              &mdash; calibrated probabilities <em>plus</em> the causal
              chains that got there. Private rooms compound one
              operator&apos;s edge; public rooms aggregate played seats from
              anyone who joins (Operating Model for the breakdown).
            </P>
            <P>
              The headline, plainly:{" "}
              <B>once the SWF priors are deep enough, a playable
              War Room is what the engine produces.</B> Prime the
              substrate across System, World, and Fate. Pick the
              spatial type the world wants. Deal the cards.
              Begin.
            </P>
          </Section>

          {/* ── The Loop ─────────────────────────────────────────────── */}
          <Section id="loop" label="The Loop & Practice">
            <P>
              <B>Two hooks, two clocks. One asynchronous, one live.
              Conviction sells the room; Capture keeps it.</B>{" "}
              <B>Conviction</B> is the fast, <em>live</em> side and the
              day-one value: a real-time, high-feedback session the room
              plays together &mdash; on <B>laptops, not phones</B>, because
              reading the scene and writing the priors that move the odds are
              how you orient and act, and both want a real screen and keyboard.
              Bring your team, and an <B>AI adversary</B>{" "}
              takes the other side of the table (the competitor, the
              regulator, the rival) and hunts the seams in how you
              coordinate under information asymmetry. By the first
              session&apos;s end you know, under pressure, whether your team
              holds when something intelligent pushes back, not
              whether you agree in a calm room. <B>Capture</B> is the slow,{" "}
              <em>asynchronous</em> side: between sessions, on each
              member&apos;s own clock, every seat records what it believes
              and how it decides, until the room is a{" "}
              <em>rehearsal engine for the future</em> that compounds. That is
              why a team stays. Both exercise the one bet:{" "}
              <B>human vision is humanity&apos;s edge over AI</B>. Capture
              records the vision, Conviction runs it. The loop below is how
              they feed each other.
            </P>
            <P>
              Capture insures the board&apos;s loss: <em>the key person who
              walked, taking the model with them</em>. When judgement lives
              in one head, every departure is an outage. Captured to the
              substrate, it stays.
            </P>
            <P>
              <B>The loop: Model &rarr; Capture &rarr; Rehearsal.</B>{" "}
              Playing Meridians is a feedback loop on dynamic scenarios,
              not a forecast you grade. <B>Model</B> is the one-off setup
              of the room&apos;s reality &mdash; its rules, actors, and
              open threads. Then the practice: <B>Capture</B> records
              priors and commits them; <B>Rehearsal</B> plays the
              uncertain space forward; what diverges feeds the next
              capture. Capture is <em>per-perspective</em>: every seat
              sharpens <em>its own</em> stance, never pooled into
              consensus &mdash; exactly what you must not do when a seat
              models an adversary who should surprise you (its seat keeps
              deliberately hostile priors; what&apos;s shared is the
              board, not the belief). Priors arrive two ways: <em>live</em>,
              each member tends their seat; <em>dark</em>, they message the
              room&apos;s end-to-end-encrypted Signal number and the engine
              parses each member&apos;s notes into priors on their own
              seat, the game master curating exceptions. Threads aren&apos;t fixed
              either &mdash; new ones open as the story turns, so each
              perspective is an evolving decision system.
            </P>
            <P>
              <B>Rehearsal explores the uncertainty; it must not re-enact
              the prior.</B> Only moves the room has committed or holds at
              high certainty advance the simulation; the contested space
              stays open and plays forward over the Compass &mdash; a
              compressed simulation, not reality, but a genuine practice
              ground for information, signalling, and multi-sided play.
              The discipline that earns it: a committed stance is a{" "}
              <em>soft prior, not a constraint</em>, contested threads are
              protected, and each play-through carries a divergence
              directive &mdash; so the room explores the state space
              instead of confirming its own read. Every play-through is a
              kept fork, and the gap between the room&apos;s exploration
              and the modelled cohort becomes the next thread to capture.
              The question is never &ldquo;was the call right?&rdquo; but
              &ldquo;is the read sharper this cycle than last?&rdquo; A
              campaign team that modelled the opposition in March,
              rehearsed three responses in April, and watched one land in
              May has a sharper model in June &mdash; not because it
              predicted correctly, but because the divergence showed which
              priors were wrong.
            </P>
            <P>
              <B>Same resolver, two triggers &mdash; and only confirmed
              outcomes are fact.</B> Capture and Conviction share the
              resolver but trigger differently: Capture on{" "}
              <B>certainty</B> (it measures what reality <em>is</em>),
              Conviction on <B>conviction-forcing</B> (how committed
              actors make it <em>evolve</em>). Merges carry provenance &mdash;
              <B>confirmed</B> (reality-verified, the only thing the
              resolver treats as fact) vs <B>believed</B> (the
              room&apos;s conviction, tagged, never silently promoted) &mdash;
              and the wall is enforced in software, not discipline:
              it&apos;s what stops the substrate self-confirming.
            </P>
            <P>
              <B>An empty seat still has a stance.</B> Because Capture is
              per-perspective, the engine can simulate a quiet seat&apos;s
              priors from its recorded continuity &mdash; keeping a
              thin-rostered team whole, putting AI agents beside humans,
              at the limit running a fully autonomous room. We mainly
              support humans; simulation just keeps the loop running when
              one isn&apos;t there.
            </P>
            <P>
              <B>Three surfaces, one substrate.</B> <B>Capture</B> the
              priors (each seat&apos;s running stance; fold a set of
              streams into a <em>merge</em> and they commit, guiding the
              next moves). <B>Play</B> the future (the full War Room: the
              heaviest mode, the richest source of deltas). <B>Generate</B>{" "}
              forward (scenario cohorts and continuations, solo, no
              session). Each feeds the others &mdash; a scenario surfaces
              a gap for Priors, a Priors update reweights the next play, a
              play lands threads that sharpen the next. You don&apos;t
              need the full war game to benefit; capturing and generating
              earn their keep alone, and the team-weekly room is just the
              deepest source of deltas.
            </P>
            <P>
              <B>Be honest about where the loop bites &mdash; and where
              the money is.</B> Play earns its keep where feedback is
              fast and clean: markets, live ops, a campaign in flight.
              A career pivot, an M&amp;A bet, a multi-year doctrine
              resolves once, ambiguously, years later &mdash; the
              deferred outcomes the write-back handles worst.
              The tension is plain: <em>several of the highest-ACV
              verticals sit where the loop is slowest</em>, exactly
              where the brand points. It dissolves once you are precise
              about what is sold. We do not sell a <em>prediction</em> of
              the one-shot outcome &mdash; no honest tool can grade an
              M&amp;A bet before it resolves. We sell the{" "}
              <em>calibrated team</em> that walks into it: judgement
              sharpened on the fast loops nested inside every slow domain
              (the slow decision is never a single event &mdash; it sits
              atop months of fast ones: the weekly read, the live file,
              the deal in flight), and priors compounded between sessions
              into the artefact the room carries through the door.
              Calibration is the product, proven on the fast end and{" "}
              <em>transferred</em> to the slow one by the same people:
              play to sharpen the reflexes you use weekly, accumulate to
              face the decisions you make once. What stays unproven is
              narrow, and we say so &mdash; not that a rehearsed team
              beats a cold one (the oldest result there is), but that our
              write-back can <em>score</em> a one-shot call cleanly enough
              to compound on it. The value proposition does not wait on
              it.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-12 mb-3">
              Practice
            </h3>
            <P>
              <B>The maintenance is the practice.</B> The richest
              substrate comes from the team that institutes the War Room
              on a cadence (the lighter surfaces above need none of this
              ritual). A world view decays the moment the team stops
              updating it; every session is a maintenance pass &mdash;
              walk the Priors, play the future forward, score the round
              &mdash; that keeps the model honest to a world still moving.{" "}
              <B>Weekly</B> for what moves fast (markets, current ops, a
              campaign in flight): 60&ndash;90 minutes, riding an existing
              standing meeting wherever possible &mdash; the ritual must
              attach to a slot that already survives busy weeks, not compete
              for a new one. The GM carries the preparation; members walk in
              with nothing but the week&apos;s signal in their heads.{" "}
              <B>Monthly</B> for what
              moves slow (doctrine, portfolio, multi-year bets): two to
              four hours, rehearsing strategic <em>shape</em> &mdash; the
              kind of move you&apos;ll reach for under pressure six months
              out.
            </P>
            <P>
              <B>Who it&apos;s for.</B> Seven honest use cases:
            </P>
            <ul className="mt-3 space-y-2 text-[13px] text-white/55 leading-[1.85]">
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>Solo rehearsal &mdash; the edge case, not the
                  centre.</B> A single operator can run the practice on a
                  career pivot or a portfolio, taking the seats of
                  consequential others (employer, market, rival). Same
                  engine, table of one; noted for completeness. The product
                  is built for teams.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>Investment.</B> A committee plays positions against
                  management response, competitor hunts, and macro regime;
                  calibrated priors on stress and exit-path optionality
                  become artefacts of the room.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>Politics.</B> A campaign plays the opposition&apos;s,
                  regulator&apos;s, and media&apos;s next moves &mdash; and
                  moves faster the morning of the leak than the one meeting
                  it cold.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>Strategy.</B> Executives convene the seats of
                  competitors, regulators, and channel partners; every
                  committed move becomes a prior the next room inherits.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>The forge, at play.</B> A tabletop group runs the room
                  as a grand-strategy sandbox &mdash; not a market we sell
                  into, but where Game Masters train and the engine earns its
                  fifty cheap games.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>Knowledge transfer.</B> The substrate is institutional
                  memory made playable: a newcomer reads the current model
                  to update their priors, then takes a seat and plays;
                  departing experts leave their committed calls behind.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>Historical rehearsal.</B> A team replays a decision whose
                  outcome is already known &mdash; a crisis, a famous deal, a
                  market break &mdash; capturing priors under the original fog,
                  playing the branches forward, then scoring them against what
                  actually happened. The cleanest day-one demo: calibration with
                  real ground truth, the fast loop the slow domains never hand
                  you.
                </span>
              </li>
            </ul>
            <P>
              <B>What practising buys.</B> Reduced detail on
              purpose &mdash; the substrate is a working model,
              not an archive. Curation, not capture. <B>The fiftieth
              session is nothing like the tenth &mdash; and that gap is
              the product</B>: fifty cycles of rehearsal, fifty curated
              drops, and the sharpened substrate that emerges from them.
              That gap has a number &mdash; <B>Recall Share</B>. Wider
              play and regular capture are the <em>input</em> (the way
              training is the input to match performance, never the score
              itself); the score is settled when events actually land and
              the room either recalled them or did not, and it erodes as
              the world moves and priors drift. Sessions exist to replenish
              it: a team practises to keep its Recall Share high.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-12 mb-3">
              Alignment &amp; diversity
            </h3>
            <P>
              <B>Streams make the qualitative quantitative.</B> A prior is a
              sentence of judgement &mdash; <em>&ldquo;early customers will be
              high-stakes enterprises; only they can afford to care&rdquo;</em>.
              The stream scores it into a stance, and a chain of priors becomes a
              tracked belief: a distribution that moves over time. That one move
              makes everything else measurable. Each stream is an <B>idea under
              test</B> &mdash; you see which hold, which decay, and which get
              overturned. And since every seat keeps its own stream, the distance
              between them is a number: read one way it is <B>alignment</B> (the
              room actually converged, not deferred to the senior voice), the
              other it is <B>diversity</B> (real disagreement, kept rather than
              averaged). The same number lets you trust convergence when it is
              earned and protect dissent when consensus is collapsing too soon.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-12 mb-3">
              Idea meritocracy
            </h3>
            <P>
              <B>The practice has a name &mdash; an idea meritocracy you can
              finally audit.</B> The aim is old: weight a decision by the proven
              accuracy of the people behind it, not their seniority. Bridgewater
              built a culture on it &mdash; record everything, surface
              disagreement, weight by track record.
              <Cite id="dalio2017" label="Dalio 2017" /> What it could not close
              was proof: with nothing separating conviction from credibility,
              believability drifts back to rank &mdash; the senior voice carries
              because it is senior, and no one can show otherwise because no one
              kept score. Capture is that missing ledger.
            </P>
            <P>
              <B>Recognition now; calibration as threads resolve.</B> Two
              claims, kept distinct so neither overreaches. <em>Recognition</em>
              is auditable today: when an event lands, the engine matches it
              against history by meaning (summary embeddings, recent play
              weighted), and a fresh match to a branch the room actually played
              &mdash; reasoning attached &mdash; proves the room had met this
              before. That is what <B>Recall Share</B> reports, and it is what
              the team buys. But recognition proves a seat <em>played</em>, not
              that its judgement was <em>good</em> &mdash; so accuracy is a
              second, slower layer: each committed stance is frozen before the
              outcome, the believed/confirmed wall keeps it from grading itself,
              and as threads resolve observably the confirmed outcomes are scored
              by a strictly proper rule
              <Cite id="brier1950" label="Brier 1950" />. Believability earned by
              calibration is the destination; auditable recognition is what ships
              first, and it is honest about being the nearer of the two.
            </P>
            <P>
              <B>This preparedness is what a serious room pays for &mdash; and
              privacy-first is what lets it say yes.</B> A serious room is not
              buying a forecast &mdash; it is buying its own{" "}
              <B>Recall Share</B>: recognition it owns, earned by play not
              title, and the record player-owned. For the players who hold the
              most sensitive judgement, <B>data-privacy-first by construction</B>
              {" "}(local, player-owned, end-to-end-encrypted capture) is not a
              feature behind the product &mdash; it is the precondition for
              playing at all, and the line that separates us from any rival
              that parks the same judgement on its own cloud.
            </P>
          </Section>

          {/* ── Architecture ─────────────────────────────────────────── */}
          <Section id="architecture" label="Architecture">
            <p className="text-[12.5px] text-white/35 italic leading-[1.85] mt-3 border-l-2 border-white/10 pl-4">
              The specific tools below are the current stack;
              component names will change as the ecosystem
              moves. The architectural read is what to take
              forward: a federation of <em>sovereign local hosts</em>
              (after OpenClaw) &mdash; each an <em>always-on</em> GM machine
              that owns its truth, kept live by an always-on Electron app and
              reached over an <B>ngrok</B> tunnel, with async capture through
              an end-to-end-encrypted Signal channel, LLM-as-gateway, no
              central server.
            </p>
            <P>
              The substrate ships as a single Next.js application with
              React 19, Tailwind for surface, and D3 for the map / board /
              graph views that own most of an operator&apos;s screen. The
              backend is essentially a pass-through to an LLM gateway;
              everything that compounds lives on the operator&apos;s machine.
            </P>
            <ul className="mt-3 space-y-2 text-[13px] text-white/55 leading-[1.85]">
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>Next.js 16 + React 19</B> &mdash; app shell,
                  App Router, the few server endpoints that need
                  one (image generation, LLM calls).
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>Tailwind v4 + D3.js</B> &mdash; visual
                  language and the two <em>seeing</em> surfaces:
                  the spatial board, the typed knowledge graph.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>IndexedDB on the host</B> &mdash; the single
                  source of truth, serialised to disk as an{" "}
                  <B>encrypted{" "}
                  <code className="text-white/70">.meridian</code>{" "}
                  file</B>. No backend database; it exports as one
                  encrypted artifact the game master backs up and
                  carries between machines.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>ngrok tunnel</B> &mdash; live access, always on.
                  The always-on Electron host keeps an{" "}
                  <B>ngrok</B> tunnel up continuously (a stable reserved URL),
                  so members can reach the instance <em>any time</em> &mdash;
                  not only during a convened session. Players join by{" "}
                  <B>scanning a per-seat QR</B> (or a play link), opening a{" "}
                  <em>controller scoped to their seat</em> (its feed, hand,
                  history) over the same live state. They get their vantage
                  &mdash; not the GM console, others&apos; hidden state, or the
                  raw distributions; that boundary is the asymmetry the game
                  runs on. Always-on public exposure, so{" "}
                  <B>application-layer auth is the perimeter</B>: two-stage
                  pairing (token QR + GM PIN), GM-elevated, sessions revocable
                  at the host.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>Signal capture channel</B> &mdash; the always-open,
                  end-to-end-encrypted capture layer (a dedicated room
                  number via{" "}
                  <code className="text-white/70">signal-cli</code>;
                  members DM priors from the phone in their pocket, bound
                  to their seat by sender UUID). The engine parses each
                  member&apos;s notes into{" "}
                  <em>their</em> seat&apos;s streams under the plausibility
                  gate, replies a bare admissibility ack, and the GM
                  curates the exceptions &mdash; the standing line the work
                  and the facilitation already share.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>LLM gateway (OpenRouter)</B> &mdash; our
                  provider, for its opt-in Zero Data Retention
                  policy; routes to the cheapest model that clears
                  each stage&apos;s bar (currently DeepSeek for
                  generation, Gemini Flash for planning / analysis).
                  The privacy boundary, not the storage layer (see
                  below); local LLMs are theoretically supportable,
                  not productised.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">·</span>
                <span>
                  <B>OpenAI embeddings + Replicate</B> &mdash;
                  1536-dim vectors over every scene, beat, and
                  proposition for semantic search; Seedream 4.5
                  for board art and covers. Same caveat: content
                  on the wire.
                </span>
              </li>
            </ul>

            <P>
              <B>Local-first is the storage stance; privacy is a setting,
              not a default win.</B> The substrate sits on your machine as
              an encrypted file &mdash; no per-user database on our side
              &mdash; but the AI has to read it, so every call leaves
              through the gateway. We route through <B>OpenRouter</B> for
              its opt-in <B>Zero Data Retention</B> policy, so providers
              store nothing. The honest residual, named as a risk: ZDR stops
              storage, not processing &mdash; where the provider itself is
              the objection, only local inference clears it, and we
              don&apos;t ship that yet.
            </P>
            <P>
              <B>One sovereign host, one game master &mdash; and a backup
              discipline.</B> Each room runs on a <B>sovereign local
              host</B> (the OpenClaw model): one person owns the machine and
              the room, keeps the data safe, runs the weekly session,
              refines the models, convenes the table. Federation is only{" "}
              <em>connectivity</em>: everyone else joins as a <B>guest
              seat</B> with no authority over the host&apos;s truth. That
              custody is the risk too &mdash; months of irreplaceable priors
              on one device is a bus factor of one. The fix is an opt-in{" "}
              <B>Substrate Vault</B>: an inbuilt encrypted online backup
              (client-held key, so we hold only ciphertext) plus
              destinations the operator chooses (a second device, their own
              cloud). Two tiers: <B>private storage</B> (the client&apos;s
              own substrate) and <B>public storage</B> (worlds a GM
              publishes, distributed so players pull fresh copies). The GM
              holds the truth and judges what merges, but the role is{" "}
              <B>one writer at a time, not one person forever</B>: the
              encrypted <code className="text-white/70">.meridian</code>{" "}
              hands off to a backup, so a holiday or departure doesn&apos;t
              freeze or lose the room.
            </P>
            <P>
              <B>Two ways in: live and dark.</B> The console is the
              single source of truth &mdash; no sync, no merge, no
              conflict &mdash; and the room reaches it on two clocks.{" "}
              <B>Live</B>, the always-on Electron host holds an{" "}
              <a
                href="https://ngrok.com"
                className="text-white/70 underline-offset-2 hover:underline"
              >
                ngrok
              </a>{" "}
              tunnel up continuously, so the team can reach their seat
              controllers any time, not only when a session is convened.{" "}
              <B>Dark</B>, the host is genuinely off but the capture channel is
              not:{" "}
              <a
                href="https://signal.org"
                className="text-white/70 underline-offset-2 hover:underline"
              >
                Signal
              </a>{" "}
              (end-to-end encrypted) is the one capture channel &mdash; a
              dedicated room number members DM, bound to their seat. Members
              keep messaging priors, the
              engine parses them into their seats, and the GM &mdash; a
              volunteer inside the organisation, or a facilitator on our
              side &mdash; curates the exceptions when the instance wakes.
              Capture below, curation-and-commit above. Nothing we run sits
              between: a tunnel, an encrypted chat, and the substrate on one
              laptop.
            </P>
            <P>
              <B>Privacy-first is the posture &mdash; and the
              differentiator.</B> For the players who care most about privacy
              &mdash; anyone holding sensitive judgement &mdash;
              data-privacy-first is a reason to play, not a caveat to manage. The substrate is{" "}
              <B>local-first and client-owned</B> (one encrypted{" "}
              <code className="text-white/70">.meridian</code>, no per-user
              database on our side); capture rides{" "}
              <B>end-to-end-encrypted Signal</B>; live access is an{" "}
              <B>always-on ngrok tunnel gated by application-layer auth</B>
              {" "}(token-QR + PIN, GM-revocable), so a leaked URL meets a
              locked door &mdash; and fully-private tables run{" "}
              <B>LAN-only</B>. Privacy-first also means saying where it still
              leaks: an always-on tunnel is a persistent attack surface (auth
              is the perimeter, not obscurity), it terminates TLS at
              ngrok&apos;s edge (which sees live board / chat traffic at the
              proxy &mdash; not the priors corpus, app-auth-gated, no central
              store), and deeper, the{" "}
              <B>inference path</B> &mdash; the substrate leaves through the
              LLM gateway, so where the provider itself is the objection, only
              local inference clears it, and we don&apos;t ship that yet. Net:
              the encrypted path is the default, and <em>&ldquo;your judgement
              never leaves your control&rdquo;</em> is a claim we can stand
              behind for the person who plays on their own machine. Exactly
              the line a competitor built on someone else&apos;s cloud cannot
              match.
            </P>
            <P>
              <B>Always-on Electron host &mdash; the main way a room stays
              up.</B> The build wraps into an Electron desktop app that runs{" "}
              <B>always-on on the Game Master&apos;s computer</B>: it is the
              room&apos;s host and single source of truth, a{" "}
              <B>background daemon</B> keeping the instance live and the{" "}
              <B>ngrok tunnel</B> up continuously (and the Signal channel
              paired) so members can reach the app at any time. The GM machine
              is the always-on server; there is no separate cloud backend
              &mdash; shortcuts, a known location for the encrypted{" "}
              <code className="text-white/70">.meridian</code>, the console one
              launch away.
            </P>
            <P>
              <B>The host is the GM&apos;s own machine.</B> The sovereign host
              is one person&apos;s always-on computer &mdash; local-first,
              encrypted, no vendor cloud, which reads as pure upside:{" "}
              <em>&ldquo;it lives on my machine.&rdquo;</em> We never touch the
              data; that is the whole deployment story.
            </P>
            <P>
              <B>Priors are human-made, not scraped.</B> A person
              authors each prior &mdash; web search enhances the
              drafting, but the human filters the noise, structures
              the prior, and sets the open-ended threads worth
              calibrating. That is the humanistic bet: people decide
              what matters, the engine only quantifies it &mdash;
              sharpening judgement before the war room meets to argue
              it.
            </P>
          </Section>

          {/* ── Operating Model ─────────────────────────────────────── */}
          <Section id="operating-model" label="Operating Model">
            <P>
              <B>The moat is client-owned compounding judgement no vendor
              can ship cold.</B> A team running weekly War Rooms
              accumulates a working model of its own position &mdash;
              priors, calibrated reads, the rehearsed branches and
              threads it has played out &mdash; living in the
              substrate&apos;s history, on the client&apos;s machine,
              authored by the people inside the problem. No foundation
              model ships it, no competing tool ports it, and we
              can&apos;t rebuild it for another client. Everything else
              &mdash; engine, prompts, math, even the facilitation
              playbook &mdash; commoditises eventually. This doesn&apos;t.
              The headline client metric is its <B>Recall Share</B>
              &mdash; of the consequential events that land on the desk,
              the share the room had already rehearsed (a real,
              checkable number, not a self-report); weekly sessions exist
              to replenish it as the world&apos;s movement erodes it.
            </P>
            <P>
              <B>The honest shape: a grassroots, community-led practice
              &mdash; not a boutique consulting firm.</B> The unit is still the
              Game Master, but growth is <em>bottom-up</em> through the ladder
              &mdash; <B>Player &rarr; Contributor &rarr; GM</B> &mdash; not a
              sales team chasing big-ticket contracts. We don&apos;t sell
              consulting; we <em>seed games</em>: a workshop onboards players,
              the Signal chat makes them Contributors, the committed become
              GMs who build their own models and pull in the next ring. The
              card game is the funnel, the community the retention, the GMs the
              distribution &mdash; a <B>self-reinforcing loop</B> the founders
              prime and step out of. The risk is honest: grassroots loops are
              slow to ignite, and a GM&apos;s job is as much{" "}
              <em>keeping the room fun</em> as running the math. Model Meridians
              as a <B>community that grows itself</B> &mdash; not a consulting
              practice hoping to graduate to software.
            </P>
            <P>
              <B>Two surfaces, sequenced &mdash; and a knife taken to the
              rest.</B> Private rooms ship first &mdash; closed tables on
              the local data model, the surface we have conviction in and
              revenue against. The wedge ships four things: Capture,
              Conviction, the two seeing surfaces, and the Compass.
              Everything else in this document &mdash; voice profiles, beat
              chains, reconstruction, the betting layer, public rooms
              &mdash; is deferred until the wedge has a retention curve. The
              engine&apos;s breadth is an asset only if it doesn&apos;t
              delay the one experiment that matters. Public rooms
              aren&apos;t a separate product: a host
              opens a session to outsiders with a <B>guest pass</B>{" "}
              (seat-scoped, private substrate never exposed), and the
              vault&apos;s public storage distributes worlds &mdash; so the
              public layer grows from private rooms opening a door, no
              cold-start, no new infrastructure. At scale private and public
              become <em>self-reinforcing</em>, GMs curating both. Whether
              it lands at scale is still the open question; the base case in
              Economics treats it as zero.
            </P>
            <P>
              <B>The wedge has to survive first &mdash; the tension,
              plainly.</B> The moat (compounding client-owned judgement)
              takes{" "}
              <span className="font-mono tabular-nums text-white/70">2&ndash;3 months</span>
              {" "}to form; the existential risk is <B>week-6 retention</B>.
              So the moat doesn&apos;t exist during the window we&apos;re most
              likely to die &mdash; and if the only thing carrying us through
              it were <em>a competent AI adversary</em>, a foundation lab
              could ship that in a quarter, because the adversary needs no
              substrate. The moat answers <em>&ldquo;why won&apos;t a lab eat
              this&rdquo;</em> for the long run and says nothing about the
              first six weeks. The wedge is the least defensible part, and
              it&apos;s what has to survive first. We won&apos;t soft-pedal
              that.
            </P>
            <P>
              <B>The answer: the wedge isn&apos;t the AI &mdash; it&apos;s
              the social play.</B> A lab can ship a better sparring bot; it
              can&apos;t ship <em>your table, your GM, and a bottomless supply
              of worlds you find interesting</em>. Weeks 0&ndash;12 are held
              by a <em>social ritual</em>, not a benchmark &mdash; the reason
              people come back to a poker night or a D&amp;D campaign: their
              friends are there and the next scenario is fresh. Three things
              carry it, none a model upgrade: <B>breadth of worlds</B> (any
              text becomes a playable world, so the GM never runs out of
              interesting scenarios and novelty doesn&apos;t decay at week
              six), <B>the GM</B> (a person curating worlds for a specific
              group and keeping it fun &mdash; no &ldquo;Strategy Mode&rdquo;
              ships that), and <B>the group</B> (the unit that returns is
              friends with social inertia, not a lone user a notification has
              to re-hook). The AI adversary is the <em>hook</em> that sells
              session one; social play is the <em>retention</em> that carries
              to the moat. The lab competes on AI quality, which commoditises;
              we compete on social play and world-breadth, which a model
              release doesn&apos;t touch.
            </P>
            <P>
              <B>Versus the alternatives, long-run.</B> Past the wedge, the
              moat does the work. A foundation-model vendor
              ships a &ldquo;Strategy Mode&rdquo; chat in a quarter, but
              can&apos;t ship your room&apos;s history &mdash; months of
              compounded priors, a private substrate you own,
              force-measured scoring instead of fluent guesses; models
              commoditise <em>generation</em>, not <em>compounded practice
              on client-owned state</em>. The <em>stripped tool</em> (70%
              of value for 10% of effort, no substrate to maintain) is the
              fragile-moat threat, and that same compounding judgement is
              the answer. The <em>index-everything</em> play (Glean) searches
              what&apos;s written &mdash; Meridians is the inverse,
              surfacing the judgement that never reached a document.
              Connecting the humans is the harder, more defensible layer.
            </P>
            <P>
              <B>The bet is the practice.</B> The shape:{" "}
              <em>private subscription for the working surface +
              value-add layers on top + free public distribution
              where it earns its way</em>. Numbers follow.
            </P>
            <P>
              <B>Consumer subscriptions, grassroots, public and private.</B>
              {" "}The local-first architecture fits the consumer perfectly
              &mdash; <em>&ldquo;it lives on my machine, encrypted, no vendor
              cloud&rdquo;</em> is pure upside for a person. <B>Private rooms
              are groups and communities</B> &mdash; a friend group, a hobby
              league, a small team that plays its own world &mdash; on a
              consumer subscription; <B>public rooms</B> grow from private ones
              through the guest pass. Adoption is bottom-up: a community member
              carries their play into wherever they belong, the network
              growing one table at a time.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-12 mb-3">
              Economics
            </h3>
            <p className="text-[12.5px] text-white/35 italic leading-[1.85] mt-3 border-l-2 border-white/10 pl-4">
              Numbers below are today&apos;s figures &mdash;
              LLM costs and pricing intent will move. The shape: free
              workshops are the grassroots entry, communities of recurring
              rooms are the follow-through, a consumer subscription covers a
              session that costs cents, and public play is amortised across a
              cohort.
            </p>
            <P>
              <B>LLM cost is cheap; the binding constraint is the
              network, not code.</B> A session costs{" "}
              <span className="font-mono tabular-nums text-white/70">~$0.30&ndash;$0.50</span>
              {" "}in LLM on the current model split; a weekly
              cadence is{" "}
              <span className="font-mono tabular-nums text-white/70">$1.50&ndash;$2.00</span>
              {" "}per private room per month. That is the easy
              part. The binding constraint is a <em>person</em> &mdash; the{" "}
              <B>game master</B> &mdash; but the GM is <B>grown from the
              community, not staffed by us</B>: the network produces
              Contributors, the committed graduate into GMs who run their own
              rooms. So Meridians is <B>community-led, not services-led</B>
              &mdash; we are the first GMs, but the model scales by GMs{" "}
              <em>multiplying through the network</em>, not by us hiring
              facilitators. A founder-run room carries a services cost
              (contribution margin{" "}
              <span className="font-mono tabular-nums text-white/70">35&ndash;60%</span>
              {" "}while a founder is in the chair); the thesis is that
              community-grown GMs carry their own. The risk moves with it: not{" "}
              <em>&ldquo;can we staff facilitators&rdquo;</em> but{" "}
              <em>&ldquo;does the network produce GMs.&rdquo;</em>
            </P>
            <P>
              <B>Community-led is the structural ceiling.</B> The fastest
              path to true software margin is the network supplying its own
              facilitators: when the room&apos;s GM is grown from the
              community rather than staffed by us, the heaviest COGS line
              disappears and loaded margin steps up to{" "}
              <span className="font-mono tabular-nums text-white/70">~75%+</span>.
              {" "}A serious operator who plays their way up the ladder gets
              to speed inside 90 days and runs rooms themselves after &mdash;
              we keep answering hard questions and shipping the engine, but
              stop being a services line item. Every GM the network produces
              is one more room we don&apos;t have to staff.
            </P>
            <P>
              <B>Public cost is hypothetical.</B> A cohort of
              1,000 would amortise LLM cost to{" "}
              <span className="font-mono tabular-nums text-white/70">~$0.01</span>
              {" "}per player per season, with revenue from pro
              subs, opt-in betting, sponsorships, or media. The
              architecture allows it; the cohort does not exist
              yet. We are not banking on this.
            </P>

            <BusinessModels />

            <P>
              <B>Grassroots entry, then revenue where the network lands.</B>
              {" "}The entry is the <B>free workshop</B> (see{" "}
              <a href="#wedge" className="text-white/70 underline-offset-2 hover:underline">The Game Master</a>)
              &mdash; a real scenario made playable, the easiest possible yes:
              people gather, play a game of Conviction, seed a world, and the
              keenest join the Signal chat to keep contributing to the model.
              No fee, no sale &mdash; a seeded substrate and a
              relationship. From the network, GMs stand up <B>recurring
              private rooms</B> for their groups and communities on a{" "}
              <B>consumer subscription</B> &mdash;{" "}
              <span className="font-mono tabular-nums text-white/70">$99&ndash;299/mo per room</span>
              {" "}(or per-seat), the spine of private revenue. On top of that,{" "}
              <B>public rooms</B> grow from private ones through the guest
              pass, with pro tiers, opt-in betting, and sponsorship riding on
              free distribution. Growth is the network compounding one table
              at a time, not a sales motion.
            </P>
            <P>
              <B>Scale math &mdash; scenarios.</B>{" "}
              <span className="font-mono tabular-nums text-white/70">Bear ~$500K</span>
              {" "}&mdash; the grassroots loop stalls: the card game
              spreads but the network doesn&apos;t produce GMs, so recurring
              rooms don&apos;t compound.{" "}
              <span className="font-mono tabular-nums text-white/70">Base ~$3.5M</span>
              {" "}&mdash; a few thousand recurring private rooms grown from
              the network on consumer subscriptions, plus early pro tiers. The
              free workshop is funnel-only in this base, not a revenue line.
              Base alone is venture-defensible. Upside beyond this &mdash; the
              public layer at scale, a betting vertical &mdash; we keep
              separate so it doesn&apos;t muddy the near-term plan.
            </P>
            <P>
              <B>Early evidence we owe.</B> Two milestones collapse
              the most uncertainty in the model.{" "}
              <em>Week-12 retention on heavy-mode non-founder
              users</em> &mdash; whether weekly War Rooms hold past
              the novelty window for operators who aren&apos;t us.{" "}
              <em>One demonstrably better call from an accumulated
              substrate</em> &mdash; a real decision, on a real
              client&apos;s priors, that no foundation-model chat could
              produce from cold. Until both exist, the strongest part of the
              pitch is theoretical; once they exist, the moat
              narrative is concrete. So the operating commitment: no new
              engine capability ships until five non-founder
              historical-rehearsal cohorts have run and a week-12 retention
              curve exists, whatever it shows. The engine is already
              over-built relative to the evidence; the constraint now is
              proof, not capability. The arguments (moat, cost stack,
              wedge) are pushed as hard as they go; the evidence-gated
              parts (margin past facilitation, the graduation, the GM as a
              scaling unit, the{" "}
              <span className="font-mono tabular-nums text-white/70">~$3.5M</span>{" "}
              base) sit where the data leaves them. You can&apos;t
              write your way to a retention curve.
            </P>
            <P>
              <B>Honest risks.</B> Eight we are watching, in rough
              order of worry.{" "}
              <em>Inference data path</em> &mdash; content crosses
              the wire on every call; opt-in ZDR closes storage, but
              a third party still processes it, and where the model
              or its jurisdiction is itself the objection only local
              inference would clear it &mdash; which we don&apos;t
              yet ship.{" "}
              <em>Substrate durability</em> &mdash; the irreplaceable
              asset sits on one device, bus factor of one; encrypted
              backups and the optional online drive help, but the
              default puts data safety on the operator.{" "}
              <em>Adoption friction</em> &mdash; the existential one,
              not one of eight. The entire moat is conditional on the
              ritual surviving: a substrate only compounds if the room
              keeps meeting, so if retention dies at week six there is no
              moat, only a pleasant workshop. Week-4 / 8 / 12 retention on
              non-founder rooms is the number the company lives or dies on,
              and the product is designed against the gym-membership failure
              mode: the GM owns all preparation (members walk in cold),
              sessions cap at 90 minutes, and the cadence attaches to a
              calendar slot that already exists rather than competing for a
              new one.{" "}
              <em>Network doesn&apos;t produce GMs</em> &mdash; the load-bearing
              grassroots risk: if the card game spreads but few players ever
              graduate into Contributors and fewer into GMs, the founders stay
              in every chair, loaded margin sticks in the 35&ndash;60% band,
              and the model is a services business after all. The whole thesis
              rests on the ladder actually turning.{" "}
              <em>Behavioural moat fragility</em> and{" "}
              <em>foundation-model encroachment</em> &mdash; the two
              competitors named above (the stripped lighter tool, the
              frontier vendor); the compounding client-owned substrate
              is the answer to both, but it has to keep being earned
              every quarter.{" "}
              <em>Consumer monetisation</em> &mdash; a vibrant free
              community may not convert to paid subscriptions at the rate the
              base case needs; surface play that&apos;s fun to give away is not
              automatically something people pay for.{" "}
              <em>Entry conversion</em> &mdash; the card game and the
              community set a deliberately low bar; the risk is whether that
              low-friction, social entry converts into recurring rooms rather
              than stopping at a pleasant game night.{" "}
              <em>Public-game cold start</em> &mdash; the hardest
              one; a free game with fifty players isn&apos;t a
              community.
            </P>
            <P>
              <B>Investability fork.</B> The base case justifies a
              modest round on private rooms alone &mdash; a{" "}
              <B>grassroots, consumer thesis</B> where the moat is
              player-owned compounding judgement no vendor can ship from cold
              and the growth engine is a network that produces its own GMs.
              The larger round implies the public layer lands, which is the
              bet that doesn&apos;t need to be made yet. We are raising on the
              base case alone: a <em>community that grows itself</em> with a
              credible path to software margin, public layer priced at zero.
              If the grassroots case doesn&apos;t excite a fund, the right
              answer is a smaller round or revenue-funded growth &mdash; not a
              bigger story. The public layer is upside we will earn the right
              to pitch with evidence, not adjectives.
            </P>
          </Section>

          {/* ── Coda ──────────────────────────────────────────────────── */}
          <Section id="coda" label="Coda">
            <P>
              Meridians is <B>one company doing one thing: a gamified
              rehearsal engine that compounds into a social network.</B> People
              connect by playing the future before it arrives &mdash; modelling reality
              human-up, practising it against an AI built to push back,
              cooperating across the table on a substrate that learns from
              every committed move. Anyone can say it; a card makes you pay for
              it. The network compounds what each room learns. Any coherent text can seed the first session
              &mdash; a market brief, a doctrine, a history. After that, the
              room authors its own world.
            </P>
            <P>
              Three things we believe.{" "}
              <B>Good strategists rehearse the future</B>, live,
              with an opponent pushing back. What the practice has always
              lacked is a place where the rehearsal <em>compounds</em>{" "}
              instead of fading when the meeting ends; the substrate keeps
              every committed move between sessions, so it does. The
              pattern is visible in every serious
              military, hedge fund, and campaign that already runs
              the practice unstructured; the War Room is the
              structured version, the one with a memory. <B>Human
              judgement, exercised as vision, is the one human edge that
              doesn&apos;t go away.</B> Models predict the future; they
              don&apos;t choose which one to make. We sharpen it the only
              way judgement sharpens: by battle-testing it against
              AI-simulated teams built to surprise. And it is{" "}
              <B>defensible</B> because the moat is <B>structural</B>: the
              substrate is the client&apos;s own rehearsed decisions, a
              compounding asset no vendor can scrape, port, or rebuild,
              theirs even as models improve. Human-up is the value;
              client-owned is the defence.{" "}
              <B>Private rooms are the product; public rooms are
              the open question.</B> Private is what we are
              selling and what we have conviction in. Public is
              what private credibility earns the right to
              attempt.
            </P>
            <P>
              That last line has a measurable referent now: <B>Recall
              Share</B>. Keep it high and a consequential event arrives as
              something the room recognises &mdash; it has met this before
              and knows the move. But step back from the metric to the thing
              it counts.
            </P>
            <P>
              <B>Most institutions keep no record of what they believed
              before reality answered.</B> They remember outcomes and forget
              the model that produced them. The senior voice carries not
              because it was right more often &mdash; no one kept score
              &mdash; but because no one can check. Every serious discipline
              eventually built a ledger: <B>accounting</B> for money,{" "}
              <B>version control</B> for code, the <B>lab notebook</B> for
              science. Judgement &mdash; the most expensive thing an
              organisation runs on &mdash; has never had one. Meridians is
              that missing ledger: the record of what a room believed, when,
              and how reality landed on it. It is the older, larger claim
              under the rehearsal engine, and the one that outlasts the
              slogan.
            </P>
            <P>
              <B>Convene the room. Practise the future. Earn the
              morning the surprise lands.</B>
            </P>
          </Section>

          {/* ── Bibliography ────────────────────────────────────────────── */}
          <Section id="bibliography" label="Bibliography">
            <P>
              Inline citations follow author-year style. References
              are listed below in plain author-title-venue form.
            </P>

            <div className="space-y-4 mt-8">
              <Ref
                id="berlin1953"
                authors="Berlin, I."
                year="1953"
                title="The Hedgehog and the Fox: An Essay on Tolstoy's View of History"
                venue="Weidenfeld & Nicolson (Princeton reissue 2013)"
                links={[
                  {
                    label: "Princeton",
                    href: "https://press.princeton.edu/books/paperback/9780691156002/the-hedgehog-and-the-fox",
                  },
                ]}
              />
              <Ref
                id="tetlock2005"
                authors="Tetlock, P. E."
                year="2005"
                title="Expert Political Judgment: How Good Is It? How Can We Know?"
                venue="Princeton University Press"
                links={[
                  {
                    label: "Princeton",
                    href: "https://press.princeton.edu/books/hardcover/9780691178288/expert-political-judgment",
                  },
                ]}
              />
              <Ref
                id="tetlock-gardner2015"
                authors="Tetlock, P. E., & Gardner, D."
                year="2015"
                title="Superforecasting: The Art and Science of Prediction"
                venue="Crown"
                links={[
                  {
                    label: "Penguin Random House",
                    href: "https://www.penguinrandomhouse.com/books/227815/superforecasting-by-philip-e-tetlock-and-dan-gardner/",
                  },
                ]}
              />
              <Ref
                id="klein1998"
                authors="Klein, G. A."
                year="1998"
                title="Sources of Power: How People Make Decisions (recognition-primed decision model)"
                venue="MIT Press"
                links={[
                  {
                    label: "MIT Press",
                    href: "https://mitpress.mit.edu/9780262534291/sources-of-power/",
                  },
                ]}
              />
              <Ref
                id="dalio2017"
                authors="Dalio, R."
                year="2017"
                title="Principles: Life and Work"
                venue="Simon & Schuster"
                links={[
                  {
                    label: "Publisher",
                    href: "https://www.simonandschuster.com/books/Principles/Ray-Dalio/9781501124020",
                  },
                ]}
              />
              <Ref
                id="brier1950"
                authors="Brier, G. W."
                year="1950"
                title="Verification of forecasts expressed in terms of probability"
                venue="Monthly Weather Review, 78(1), 1–3"
                links={[
                  {
                    label: "DOI",
                    href: "https://doi.org/10.1175/1520-0493(1950)078%3C0001:VOFEIT%3E2.0.CO;2",
                  },
                ]}
              />
              <Ref
                id="kahneman2011"
                authors="Kahneman, D., Lovallo, D., & Sibony, O."
                year="2011"
                title="Before you make that big decision"
                venue="Harvard Business Review, 89(6), 50–60"
                links={[
                  {
                    label: "HBR",
                    href: "https://hbr.org/2011/06/the-big-idea-before-you-make-that-big-decision",
                  },
                ]}
              />
              <Ref
                id="lovallo2003"
                authors="Lovallo, D., & Kahneman, D."
                year="2003"
                title="Delusions of success: How optimism undermines executives' decisions"
                venue="Harvard Business Review, 81(7), 56–63"
                links={[
                  {
                    label: "HBR",
                    href: "https://hbr.org/2003/07/delusions-of-success-how-optimism-undermines-executives-decisions",
                  },
                ]}
              />
              <Ref
                id="hanson2003"
                authors="Hanson, R."
                year="2003"
                title="Combinatorial information market design"
                venue="Information Systems Frontiers, 5(1), 107–119"
                links={[
                  {
                    label: "Springer",
                    href: "https://link.springer.com/article/10.1023/A:1022058209073",
                  },
                  {
                    label: "Author PDF",
                    href: "https://mason.gmu.edu/~rhanson/combobet.pdf",
                  },
                ]}
              />
              <Ref
                id="wolfers2004"
                authors="Wolfers, J., & Zitzewitz, E."
                year="2004"
                title="Prediction markets"
                venue="Journal of Economic Perspectives, 18(2), 107–126"
                links={[
                  {
                    label: "AEA",
                    href: "https://www.aeaweb.org/articles?id=10.1257/0895330041371321",
                  },
                  {
                    label: "NBER",
                    href: "https://www.nber.org/papers/w10504",
                  },
                ]}
              />
              <Ref
                id="polanyi1966"
                authors="Polanyi, M."
                year="1966"
                title="The Tacit Dimension"
                venue="University of Chicago Press (reissue 2009)"
                links={[
                  {
                    label: "Chicago",
                    href: "https://press.uchicago.edu/ucp/books/book/chicago/T/bo6035368.html",
                  },
                  {
                    label: "Archive",
                    href: "https://archive.org/details/tacitdimension0000pola",
                  },
                ]}
              />
              <Ref
                id="goodhart1975"
                authors="Goodhart, C. A. E."
                year="1975"
                title="Problems of monetary management: The U.K. experience"
                venue="In Papers in Monetary Economics, Vol. I. Reserve Bank of Australia"
                links={[
                  {
                    label: "Discussion (Chrystal & Mizen 2003)",
                    href: "https://cyberlibris.typepad.com/blog/files/Goodharts_Law.pdf",
                  },
                ]}
              />
              <Ref
                id="strathern1997"
                authors="Strathern, M."
                year="1997"
                title="'Improving ratings': Audit in the British University system"
                venue="European Review, 5(3), 305–321"
                links={[
                  {
                    label: "DOI",
                    href: "https://doi.org/10.1017/S1062798700002660",
                  },
                  {
                    label: "Cambridge",
                    href: "https://www.cambridge.org/core/journals/european-review/article/abs/improving-ratings-audit-in-the-british-university-system/FC2EE640C0C44E3DB87C29FB666E9AAB",
                  },
                  {
                    label: "PDF",
                    href: "https://gwern.net/doc/statistics/decision/1997-strathern.pdf",
                  },
                ]}
              />
              <Ref
                id="kullback1951"
                authors="Kullback, S., & Leibler, R. A."
                year="1951"
                title="On information and sufficiency"
                venue="The Annals of Mathematical Statistics, 22(1), 79–86"
                links={[
                  {
                    label: "DOI",
                    href: "https://doi.org/10.1214/aoms/1177729694",
                  },
                  {
                    label: "Project Euclid",
                    href: "https://projecteuclid.org/journals/annals-of-mathematical-statistics/volume-22/issue-1/On-Information-and-Sufficiency/10.1214/aoms/1177729694.full",
                  },
                ]}
              />
              <Ref
                id="cover2006"
                authors="Cover, T. M., & Thomas, J. A."
                year="2006"
                title="Elements of Information Theory (2nd ed.)"
                venue="Wiley"
                links={[
                  {
                    label: "Wiley",
                    href: "https://onlinelibrary.wiley.com/doi/book/10.1002/047174882X",
                  },
                ]}
              />
              <Ref
                id="liu2024"
                authors="Liu, N. F., Lin, K., Hewitt, J., Paranjape, A., Bevilacqua, M., Petroni, F., & Liang, P."
                year="2024"
                title="Lost in the middle: How language models use long contexts"
                venue="Transactions of the Association for Computational Linguistics, 12, 157–173"
                links={[
                  {
                    label: "ACL Anthology",
                    href: "https://aclanthology.org/2024.tacl-1.9/",
                  },
                  {
                    label: "DOI",
                    href: "https://doi.org/10.1162/tacl_a_00638",
                  },
                  {
                    label: "arXiv",
                    href: "https://arxiv.org/abs/2307.03172",
                  },
                ]}
              />
              <Ref
                id="openai-emb2024"
                authors="OpenAI"
                year="2024"
                title="New embedding models and API updates"
                venue="OpenAI Blog, January 25, 2024"
                links={[
                  {
                    label: "openai.com",
                    href: "https://openai.com/index/new-embedding-models-and-api-updates/",
                  },
                ]}
              />
              <Ref
                id="reimers2019"
                authors="Reimers, N., & Gurevych, I."
                year="2019"
                title="Sentence-BERT: Sentence embeddings using Siamese BERT-networks"
                venue="Proceedings of EMNLP 2019"
                links={[
                  {
                    label: "ACL Anthology",
                    href: "https://aclanthology.org/D19-1410/",
                  },
                  {
                    label: "arXiv",
                    href: "https://arxiv.org/abs/1908.10084",
                  },
                ]}
              />
              <Ref
                id="reagan2016"
                authors="Reagan, A. J., Mitchell, L., Kiley, D., Danforth, C. M., & Dodds, P. S."
                year="2016"
                title="The emotional arcs of stories are dominated by six basic shapes"
                venue="EPJ Data Science, 5(1), 31"
                links={[
                  {
                    label: "Springer (open access)",
                    href: "https://link.springer.com/article/10.1140/epjds/s13688-016-0093-1",
                  },
                  {
                    label: "DOI",
                    href: "https://doi.org/10.1140/epjds/s13688-016-0093-1",
                  },
                  {
                    label: "arXiv",
                    href: "https://arxiv.org/abs/1606.07772",
                  },
                  {
                    label: "Author PDF",
                    href: "https://cdanfort.w3.uvm.edu/research/2016-reagan-epj.pdf",
                  },
                ]}
              />
              <Ref
                id="boyd2020"
                authors="Boyd, R. L., Blackburn, K. G., & Pennebaker, J. W."
                year="2020"
                title="The narrative arc: Revealing core narrative structures through text analysis"
                venue="Science Advances, 6(32), eaba2196"
                links={[
                  {
                    label: "DOI",
                    href: "https://doi.org/10.1126/sciadv.aba2196",
                  },
                  {
                    label: "Science Advances",
                    href: "https://www.science.org/doi/10.1126/sciadv.aba2196",
                  },
                ]}
              />
              <Ref
                id="peirce1903"
                authors="Peirce, C. S."
                year="1903 / 1998"
                title="Pragmatism as the Logic of Abduction"
                venue="In The Essential Peirce: Selected Philosophical Writings, Vol. 2 (1893–1913), ed. Peirce Edition Project. Indiana University Press"
                links={[
                  {
                    label: "IU Press",
                    href: "https://iupress.org/9780253333971/the-essential-peirce-volume-2/",
                  },
                ]}
              />
              <Ref
                id="guilford1967"
                authors="Guilford, J. P."
                year="1967"
                title="The Nature of Human Intelligence"
                venue="McGraw-Hill"
                links={[
                  {
                    label: "HathiTrust",
                    href: "https://catalog.hathitrust.org/Record/000269325",
                  },
                ]}
              />
              <Ref
                id="norris1998"
                authors="Norris, J. R."
                year="1998"
                title="Markov Chains"
                venue="Cambridge University Press"
                links={[
                  {
                    label: "Cambridge",
                    href: "https://www.cambridge.org/core/books/markov-chains/A3F966B10633A32C8F06F37B41008F18",
                  },
                ]}
              />
              <Ref
                id="elo1978"
                authors="Elo, A. E."
                year="1978"
                title="The Rating of Chessplayers, Past and Present"
                venue="Arco Publishing"
                links={[
                  {
                    label: "Archive",
                    href: "https://archive.org/details/ratingofchesspla00aero",
                  },
                ]}
              />
              <Ref
                id="glickman1999"
                authors="Glickman, M. E."
                year="1999"
                title="Parameter estimation in large dynamic paired comparison experiments"
                venue="Journal of the Royal Statistical Society: Series C (Applied Statistics), 48(3), 377–394"
                links={[
                  {
                    label: "DOI",
                    href: "https://doi.org/10.1111/1467-9876.00159",
                  },
                  {
                    label: "Author PDF",
                    href: "http://www.glicko.net/research/glicko.pdf",
                  },
                ]}
              />
              <Ref
                id="perla1990"
                authors="Perla, P. P."
                year="1990"
                title="The Art of Wargaming: A Guide for Professionals and Hobbyists"
                venue="Naval Institute Press (reissued 2012, History of Wargaming Project)"
                links={[
                  {
                    label: "USNI",
                    href: "https://www.usni.org/press/books/peter-perla-art-wargaming",
                  },
                ]}
              />
              <Ref
                id="schelling1960"
                authors="Schelling, T. C."
                year="1960"
                title="The Strategy of Conflict"
                venue="Harvard University Press"
                links={[
                  {
                    label: "Harvard",
                    href: "https://www.hup.harvard.edu/file/feeds/PDF/9780674840317_sample.pdf",
                  },
                ]}
              />
              <Ref
                id="hogan2021"
                authors="Hogan, A., Blomqvist, E., Cochez, M., d'Amato, C., de Melo, G., Gutierrez, C., et al."
                year="2021"
                title="Knowledge graphs"
                venue="ACM Computing Surveys, 54(4), 1–37"
                links={[
                  {
                    label: "DOI",
                    href: "https://doi.org/10.1145/3447772",
                  },
                  {
                    label: "arXiv",
                    href: "https://arxiv.org/abs/2003.02320",
                  },
                ]}
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
