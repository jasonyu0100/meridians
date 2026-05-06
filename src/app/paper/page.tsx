"use client";

import { ARCHETYPE_COLORS, ArchetypeIcon } from "@/components/ArchetypeIcon";
import { StarField } from "@/components/effects/StarField";
import { ThinkingAnimation } from "@/components/generation/ThinkingAnimation";
import { REASONING_NODE_COLORS } from "@/lib/reasoning-node-colors";
import type { ReasoningMode } from "@/lib/ai/reasoning-graph/types";
import * as d3 from "d3";
import dagre from "dagre";
import katex from "katex";
import "katex/dist/katex.min.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/* ── LaTeX helpers ───────────────────────────────────────────────────────── */

function Tex({ children, display }: { children: string; display?: boolean }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    setHtml(
      katex.renderToString(children, {
        displayMode: display ?? false,
        throwOnError: false,
      }),
    );
  }, [children, display]);
  if (!html) return null;
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
      className="text-[10px] font-mono text-white/30 hover:text-white/60 transition-colors"
    >
      {status === "copied" ? "copied" : status === "error" ? "failed" : "copy"}
    </button>
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
    g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 80, marginx: 24, marginy: 24 });
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
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block mx-auto min-w-[820px]"
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

/* ── Thinking-mode explorer ──────────────────────────────────────────────── */

const THINKING_MODES: {
  key: ReasoningMode;
  label: string;
  color: string;
}[] = [
  { key: "abduction", label: "Abduction", color: "#F97316" },
  { key: "divergent", label: "Divergent", color: "#FBBF24" },
  { key: "deduction", label: "Deduction", color: "#A855F7" },
  { key: "induction", label: "Induction", color: "#22D3EE" },
];

function ThinkingModeExplorer() {
  const [mode, setMode] = useState<ReasoningMode>("abduction");

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

type BreakdownRow = {
  call: string;
  count: string;
  /** "DeepSeek v4" — scene generation, prose, interaction (chat / surveys / interviews).
   *  "Gemini 2.5" — planning (CRG / PRG / scene plans), analysis pipeline, default
   *  fallback (evaluation, briefings, game theory).
   *  "mixed" — a combined step that spans both models. */
  model: "DeepSeek v4" | "Gemini 2.5" | "mixed";
  note: string;
  cost: string;
};
type BreakdownCategory = {
  label: string;
  unit: string;
  rows: BreakdownRow[];
  subtotal: { calls: string; cost: string } | null;
};

const BREAKDOWN_CATEGORIES: BreakdownCategory[] = [
  {
    label: "Creation",
    unit: "one-time per narrative  ·  wizard / premise → seed world + intro arc",
    rows: [
      {
        call: "generateNarrative",
        count: "×1",
        model: "DeepSeek v4",
        note: "Initial entities, relationships, 8-scene intro arc structures",
        cost: "~$0.01",
      },
      {
        call: "generateScenePlan + generateSceneProse",
        count: "×8",
        model: "mixed",
        note: "Plan (Gemini) + prose (DeepSeek) for the intro arc's scenes",
        cost: "~$0.07",
      },
    ],
    subtotal: { calls: "~17 calls", cost: "~$0.08 once" },
  },
  {
    label: "Generation",
    unit: "per arc  ·  ~4 scenes  ·  ~4800 words",
    rows: [
      {
        call: "generateScenes",
        count: "×1",
        model: "DeepSeek v4",
        note: "Scene structures, deltas, summaries",
        cost: "~$0.01",
      },
      {
        call: "generateReasoningGraph",
        count: "×1",
        model: "Gemini 2.5",
        note: "Causal reasoning graph (CRG) — per-arc",
        cost: "~$0.04",
      },
      {
        call: "generateScenePlan",
        count: "×4",
        model: "Gemini 2.5",
        note: "Compulsory propositions + beat plan, single pass",
        cost: "~$0.07",
      },
      {
        call: "generateSceneProse",
        count: "×4",
        model: "DeepSeek v4",
        note: "~1.2K words of prose per scene",
        cost: "~$0.01",
      },
      {
        call: "expandWorld",
        count: "×~⅓",
        model: "Gemini 2.5",
        note: "New characters / locations / threads (amortised)",
        cost: "~$0.01",
      },
      {
        call: "generatePhaseGraph",
        count: "occasional",
        model: "Gemini 2.5",
        note: "Phase reasoning graph (PRG) — meta-machinery, on-demand",
        cost: "~$0.03",
      },
    ],
    subtotal: { calls: "~14 calls", cost: "~$0.13" },
  },
  {
    label: "Evaluation & Revision",
    unit: "per arc  ·  ~4 scenes  ·  25% edit rate",
    rows: [
      {
        call: "evaluateBranch",
        count: "×1",
        model: "Gemini 2.5",
        note: "Structure verdicts + thematic critique",
        cost: "~$0.01",
      },
      {
        call: "editScene / insertScene / mergeScenes",
        count: "×~1",
        model: "DeepSeek v4",
        note: "Reconstruction edits (summary + deltas)",
        cost: "~$0.00",
      },
      {
        call: "evaluatePlanQuality",
        count: "×1",
        model: "Gemini 2.5",
        note: "Plan-level continuity verdicts",
        cost: "~$0.01",
      },
      {
        call: "evaluateProseQuality",
        count: "×1",
        model: "Gemini 2.5",
        note: "Prose quality edit verdicts + critique",
        cost: "~$0.01",
      },
      {
        call: "rewriteSceneProse",
        count: "×~1",
        model: "DeepSeek v4",
        note: "~1K words rewritten (25% rate)",
        cost: "~$0.00",
      },
    ],
    subtotal: { calls: "~5 calls", cost: "~$0.03" },
  },
  {
    label: "Analysis",
    unit: "per corpus  ·  expert-priors pipeline  ·  ~$0.021/scene",
    rows: [
      {
        call: "extractSceneStructure",
        count: "×N",
        model: "Gemini 2.5",
        note: "Entities, deltas, summary from prose chunk",
        cost: "~$0.008/scene",
      },
      {
        call: "reverseEngineerScenePlan",
        count: "×N",
        model: "Gemini 2.5",
        note: "Beat plan + propositions (when extractPlans=true)",
        cost: "~$0.005/scene",
      },
      {
        call: "reextractFateWithLifecycle",
        count: "×N",
        model: "Gemini 2.5",
        note: "Lifecycle-aware fate re-scoring (skipped in world-only)",
        cost: "~$0.004/scene",
      },
      {
        call: "summariseWorldBuildBatch",
        count: "×⌈N/12⌉",
        model: "Gemini 2.5",
        note: "Per-batch WorldBuild intent summary (parallel pool)",
        cost: "~$0.001/scene",
      },
      {
        call: "embeddings",
        count: "×N",
        model: "Gemini 2.5",
        note: "Summaries, propositions, prose (OpenAI)",
        cost: "~$0.003/scene",
      },
      {
        call: "groupScenesIntoArcs",
        count: "×1",
        model: "Gemini 2.5",
        note: "Name arcs from scene summaries (skipped in world-only)",
        cost: "~$0.002",
      },
      {
        call: "reconcileResults",
        count: "×1",
        model: "Gemini 2.5",
        note: "Entity deduplication across chunks",
        cost: "~$0.008",
      },
      {
        call: "analyzeThreading",
        count: "×1",
        model: "Gemini 2.5",
        note: "Thread dependency analysis (skipped in world-only)",
        cost: "~$0.003",
      },
      {
        call: "meta-extraction (assembleNarrative)",
        count: "×1",
        model: "Gemini 2.5",
        note: "Image style, prose profile, genre, patterns",
        cost: "~$0.020",
      },
    ],
    subtotal: { calls: "~5N + 5", cost: "~$1.38 for HP (64 scenes)" },
  },
  {
    label: "Questioning",
    unit: "on-demand  ·  operator-initiated  ·  separate from generation budget",
    rows: [
      {
        call: "generateMarketBriefing",
        count: "per request",
        model: "Gemini 2.5",
        note: "Briefing tab — situation + suggested arc/world directions",
        cost: "~$0.02",
      },
      {
        call: "executeSurvey",
        count: "per request",
        model: "DeepSeek v4",
        note: "1 question × N respondents (parallel) — ~$0.001 per respondent",
        cost: "~$0.01 (10 respondents)",
      },
      {
        call: "executeInterview",
        count: "per request",
        model: "DeepSeek v4",
        note: "1 subject × ~6 AI-generated questions",
        cost: "~$0.01",
      },
      {
        call: "analyzeSceneGames",
        count: "per scene",
        model: "Gemini 2.5",
        note: "Game-theory decomposition of a scene (additive, doesn't mutate deltas)",
        cost: "~$0.015",
      },
      {
        call: "chat",
        count: "per turn",
        model: "DeepSeek v4",
        note: "Conversational turn over narrative state — entity persona / Q&A",
        cost: "~$0.001",
      },
    ],
    subtotal: { calls: "operator-paced", cost: "~$0.001–$0.02 each" },
  },
];

function ModelPill({ model }: { model: "DeepSeek v4" | "Gemini 2.5" | "mixed" }) {
  const tone =
    model === "Gemini 2.5"
      ? "bg-violet-500/10 text-violet-400/60"
      : model === "mixed"
        ? "bg-amber-500/10 text-amber-400/60"
        : "bg-emerald-500/10 text-emerald-400/60";
  return (
    <span
      className={`text-[9px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap ${tone}`}
    >
      {model}
    </span>
  );
}

function CostEstimates() {
  const [showBreakdown, setShowBreakdown] = useState(false);
  return (
    <div className="my-5 px-3 sm:px-5 py-4 rounded-lg bg-white/3 border border-white/6">
      <span className="text-[10px] uppercase tracking-wider text-white/20 block mb-3 font-mono">
        End-to-End Estimates · ~4 scenes/arc · ~1.2K words/scene
      </span>

      {/* Domain-routed model split — DeepSeek v4 Flash drives scene generation,
          prose, and interaction (chat / surveys / interviews); Gemini 2.5 Flash
          drives planning (CRG / PRG / scene plans), the analysis pipeline, and
          everything else by default (evaluation, briefings, game theory).

          Creation (one-time):     ~$0.08 wizard bootstrap (~8 scenes / ~2 arcs)
          Generation per arc:      ~$0.13 (CRG + 4× scene plan/prose pass)
          Evaluation per arc:      ~$0.03 (eval + ~25% edit/rewrite rate)
          Per-arc total:           ~$0.16 (~$0.04/scene)
          Analysis (ingest):       ~$0.021/scene + ~$0.033 once

          "Create from premise" rows = wizard + (arcs - 2 from bootstrap) × $0.16
          "Analyse + continue" rows  = ingest + continuation arcs × $0.16. */}
      <table className="w-full text-[11px] table-fixed">
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[34%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-white/25 font-mono">
            <th className="text-left pb-2">Scale</th>
            <th className="text-left pb-2">Words / scenes / arcs</th>
            <th className="text-right pb-2">Create</th>
            <th className="text-right pb-2">Analyse</th>
            <th className="text-right pb-2">Continue</th>
            <th className="text-right pb-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {[
            { scale: "Short story", words: "~10K", scenes: 10, arcs: 3 },
            { scale: "Novella", words: "~35K", scenes: 35, arcs: 9 },
            { scale: "Novel", words: "~85K", scenes: 85, arcs: 21 },
            { scale: "Epic", words: "~200K", scenes: 200, arcs: 50 },
            { scale: "Serial", words: "~500K", scenes: 500, arcs: 125 },
          ].map(({ scale, words, scenes, arcs }, i) => {
            // Wizard creation — one-time bootstrap (~8 scenes / ~2 arcs).
            const create = 0.08;
            // Continuation = remaining arcs after the wizard's 2 bootstrap arcs × $0.16/arc.
            const continueCost = Math.max(0, arcs - 2) * 0.16;
            const totalCreate = create + continueCost;
            // Analyse = ingest cost for the same scene count.
            const analyse = scenes * 0.021 + 0.033;
            return (
              <tr key={scale} className={i > 0 ? "border-t border-white/5" : ""}>
                <td className="py-2 text-white/50">{scale}</td>
                <td className="py-2 text-white/30 text-[10px]">
                  {words} · {scenes} sc · {arcs} arc{arcs === 1 ? "" : "s"}
                </td>
                <td className="py-2 font-mono text-white/45 text-right">
                  ${create.toFixed(2)}
                </td>
                <td className="py-2 font-mono text-white/45 text-right">
                  ${analyse.toFixed(2)}
                </td>
                <td className="py-2 font-mono text-white/45 text-right">
                  ${continueCost.toFixed(2)}
                </td>
                <td className="py-2 font-mono text-white/70 text-right font-semibold">
                  ${totalCreate.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="text-[9px] text-white/25 mt-2">
        <span className="font-mono text-white/40">Create</span> = wizard one-time bootstrap (~$0.08 for entities + intro arc).{" "}
        <span className="font-mono text-white/40">Continue</span> = remaining arcs × ~$0.16/arc (CRG + 4 scenes' plan/prose + per-arc eval).{" "}
        <span className="font-mono text-white/40">Analyse</span> = ingest an existing corpus into NarrativeState (separate flow — pay this OR Create, not both).{" "}
        <span className="font-mono text-white/40">Total</span> sums Create + Continue for the from-scratch flow.
      </p>

      <p className="text-[10px] text-white/25 mt-3">
        Each kind of work runs on the cheapest model that meets its bar.{" "}
        <span className="text-emerald-500/40">DeepSeek v4 Flash</span> ($0.14/M in
        · $0.28/M out) handles scene generation, prose, and interaction
        (chat / surveys / interviews).{" "}
        <span className="text-violet-400/60">Gemini 2.5 Flash</span> ($0.30/M in ·
        $2.50/M out) handles planning (CRG / PRG / scene plans), the analysis
        pipeline, and the default fallback (evaluation, briefings, game theory).
        The richer the priors fed into analysis, the more the simulation can
        reason — analysis is the path where domain corpus becomes queryable
        structure.
      </p>

      <button
        onClick={() => setShowBreakdown(!showBreakdown)}
        className="mt-3 flex items-center gap-1.5 text-[10px] text-white/25 hover:text-white/40 transition-colors cursor-pointer"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          className={`transition-transform duration-200 ${showBreakdown ? "rotate-180" : ""}`}
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Cost breakdown by scope</span>
      </button>

      {showBreakdown && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-5">
          {BREAKDOWN_CATEGORIES.map((cat) => (
            <div key={cat.label}>
              {/* Category header */}
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider">
                  {cat.label}
                </span>
                <span className="text-[9px] text-white/20">{cat.unit}</span>
              </div>
              <table className="w-full text-[11px] table-fixed">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[6%]" />
                  <col className="w-[14%]" />
                  <col className="w-[38%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <tbody>
                  {cat.rows.map((row) => (
                    <tr key={row.call} className="border-t border-white/4">
                      <td className="py-1.5 font-mono text-white/50 pr-3 truncate">
                        {row.call}
                      </td>
                      <td className="py-1.5 font-mono text-white/25 text-right pr-3">
                        {row.count}
                      </td>
                      <td className="py-1.5 pr-3">
                        <ModelPill model={row.model} />
                      </td>
                      <td className="py-1.5 text-white/30 text-[10px] pr-3">
                        {row.note}
                      </td>
                      <td className="py-1.5 font-mono text-white/55 text-right">
                        {row.cost}
                      </td>
                    </tr>
                  ))}
                  {cat.subtotal && (
                    <tr className="border-t border-white/10">
                      <td
                        className="pt-1.5 text-white/40 font-mono text-[10px]"
                        colSpan={3}
                      >
                        {cat.subtotal.calls}
                      </td>
                      <td />
                      <td className="pt-1.5 font-mono text-white/60 text-right font-semibold">
                        {cat.subtotal.cost}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
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

const NAV = [
  { id: "abstract", label: "Abstract" },
  { id: "problem", label: "The Problem" },
  { id: "approach", label: "Approach" },
  { id: "hierarchy", label: "Hierarchy" },
  { id: "forces", label: "Forces" },
  { id: "fate-engine", label: "Fate Engine" },
  { id: "validation", label: "Validation" },
  { id: "grading", label: "Grading" },
  { id: "embeddings", label: "Embeddings" },
  { id: "planning", label: "Causal Reasoning" },
  { id: "research", label: "Research Methods" },
  { id: "prose-profiles", label: "Prose Profiles" },
  { id: "markov", label: "Markov Chains" },
  { id: "revision", label: "Revision" },
  { id: "classification", label: "Classification" },
  { id: "economics", label: "Economics" },
  { id: "open-source", label: "Open Source" },
  { id: "coming-soon", label: "Coming Soon" },
];

/* ── Side timeline nav ───────────────────────────────────────────────────── */

function TimelineNav({ activeId }: { activeId: string }) {
  return (
    <nav className="hidden xl:flex flex-col gap-0 fixed top-1/2 -translate-y-1/2 left-[max(2rem,calc((100vw-56rem)/2-14rem))]">
      {NAV.map(({ id, label }, i) => {
        const active = id === activeId;
        return (
          <a
            key={id}
            href={`#${id}`}
            className="group flex items-center gap-3 py-2.5 transition-colors"
          >
            {/* Dot + line */}
            <div className="relative flex flex-col items-center w-2">
              <div
                className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${
                  active
                    ? "bg-white/70 scale-125"
                    : "bg-white/15 group-hover:bg-white/30"
                }`}
              />
              {i < NAV.length - 1 && (
                <div className="w-px h-6 bg-white/8 mt-0.5" />
              )}
            </div>
            {/* Label */}
            <span
              className={`text-[11px] font-mono transition-colors duration-200 whitespace-nowrap ${
                active
                  ? "text-white/60"
                  : "text-white/15 group-hover:text-white/35"
              }`}
            >
              {label}
            </span>
          </a>
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

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-8 pt-20 pb-32">
        {/* Title */}
        <div className="mb-16 animate-fade-up">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/25 mb-4">
            White Paper
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight text-white/90 mb-4">
            Quantifying Worlds in Motion
          </h1>
          <p className="text-[15px] text-white/40 leading-relaxed max-w-xl">
            Modeling structural intelligence across narrative, inquiry,
            and simulation.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/5 border border-white/10 text-white/40">
              ~15 min read
            </span>
            <CopyPaperButton />
          </div>
        </div>

        <div id="paper-body" className="space-y-16">
          {/* ── Abstract ──────────────────────────────────────────────── */}
          <Section id="abstract" label="Abstract">
            <P>
              Taste is subjective; structure is not. A reader agreeing
              a moment feels earned, a scientist agreeing an argument
              lands, a strategist agreeing a scenario hangs together
              &mdash; all respond to the same <B>legible skeleton</B>,
              one that holds across narrative, argument, and
              simulation. InkTide is a{" "}
              <B>simulation engine for long-form reasoning</B> built
              on that skeleton, running on the most portable substrate
              there is: text. Local Git for textual simulation
              &mdash; feed it priors, the engine extracts a typed
              knowledge graph, branches alternative timelines, and
              reads the structural forces driving each. Three modes
              share the framework: <B>narratives</B>, <B>papers</B>,{" "}
              <B>simulations</B> &mdash; same three fields of reality,
              different weights.{" "}
              <em>Harry Potter and the Sorcerer&apos;s Stone</em>{" "}
              calibrates the math; the framework generalizes.
            </P>
            <P>
              The core abstraction is a <B>revelation machine</B>.
              Each scene reveals two kinds of information:{" "}
              <B>encyclopedic</B> (new facts &mdash; actors, places,
              rules) and <B>possibility</B> (what could still happen).
              From a per-scene knowledge graph we recover three
              forces. <B>System</B> and <B>World</B> are
              encyclopedic; <B>Fate</B> is possibility &mdash; thread
              markets reprice as evidence lands. Texture and voice
              ride in adjacent layers; the three forces carry the
              causal spine.
            </P>
            <P>
              The methodology splits along the seam the tools are good
              at. <B>LLMs extract qualitative meaning</B> at low
              temperature &mdash; which thread advanced, what an
              entity learned, which rule was revealed.{" "}
              <B>Deterministic formulas extract quantitative impact</B>
              {" "}&mdash; the same deltas yield the same scores, every
              time.
            </P>
            <P>
              Summed on a common scale, the three forces give{" "}
              <B>Activity</B> &mdash; how hard the world is working.{" "}
              <B>Peaks</B> fire across all three channels;{" "}
              <B>valleys</B> seed pressure for what follows. Applied
              to <em>Harry Potter and the Sorcerer&apos;s Stone</em>,
              the activity curve traces what a reader feels when a
              narrative breathes &mdash; pulled straight from the
              math. Published-vs-AI gap and cross-genre calibration
              confirm the result outside the original fixture.
            </P>
            <P>
              <B>The skill ceiling is your priors.</B> Sparse data,
              sparse simulation. But rich, current priors fed through
              causal reasoning graphs and chain-of-thought scene
              execution yield scenarios that hold up. The moat is the
              data; the engine is the multiplier. The hypothesis:
              this is <B>the framework for textual simulation</B>{" "}
              &mdash; riding on foundation models for scale, with the
              typed graph and deterministic force math as substrate.
              In active development: controlled-variable experiments,
              multi-scenario probabilistic forecasting, and{" "}
              <B>A/B tests against reality</B>. The longer the loop
              runs, the sharper the next forecast.
            </P>
          </Section>

          {/* ── The Problem ───────────────────────────────────────────── */}
          <Section id="problem" label="The Problem">
            <P>
              Forecasting any sufficiently complex world &mdash; a
              market, a campaign, a research argument, a fictional
              one &mdash; is gated by two things: <B>quality of
              priors</B> and <B>continuity of reasoning</B>.
              Foundation models give us scale and fluency but lose
              continuity over long-form output: they drift,
              hallucinate, forget what they wrote three sections
              back. Specialized simulators give us continuity but
              silo us to one domain &mdash; climate models can&apos;t
              model a market, market models can&apos;t model a
              campaign. Neither lets you take a text-describable
              world, branch alternative futures from it, and grade
              them against reality.
            </P>
            <P>
              The missing piece is a <B>general-purpose substrate</B>{" "}
              where rich text priors meet structural continuity meet
              branchable, testable forecasting. Text is the most
              portable representation humans have for any domain
              &mdash; research papers, scenario briefs, intelligence
              reports, novels, market state, wargame logs all live
              as text. An engine that turns any text-describable
              world into a typed structure, mutates it forward
              through scenes, branches alternative futures, and
              measures what each one commits to is the foundational
              tool we don&apos;t yet have.
            </P>
            <P>
              The cost of not having it is everywhere. Strategic
              forecasts read as opinions because they have no
              structural commitment to point to. Research arguments
              collapse on edge cases nobody simulated. Long-form
              fiction drifts because the model forgot its own world.{" "}
              <em>Insufficient investment before resolution</em>{" "}
              &mdash; the narrative diagnostic &mdash; generalises:
              a forecast that fails to accumulate structural
              commitment is a forecast that doesn&apos;t mean much.{" "}
              <B>
                The fundamental problem isn&apos;t that we lack good
                models. It&apos;s that we have no shared substrate
                for <em>building</em> them &mdash; one that lets
                priors compound, scenarios branch, and reality itself
                become the grader.
              </B>
            </P>
          </Section>

          {/* ── Approach ──────────────────────────────────────────────── */}
          <Section id="approach" label="Approach">
            <P>
              We model every long-form work &mdash; novel, paper,
              scenario brief, alternate-history timeline &mdash; as a
              knowledge graph that updates step by step: one page per
              actor, location, rule, or open question, updated only
              when a scene reveals something new. An LLM writes down{" "}
              <em>what changed</em>; deterministic formulas compute{" "}
              <em>how much</em> was revealed. Comprehension (LLM)
              splits from measurement (formulas) &mdash; the scoring
              stays transparent and reproducible.
            </P>
            <P>
              The scene-by-scene changes come in two kinds of
              revelation &mdash; encyclopedic (new facts) and
              possibility (outcomes becoming alive or dying) &mdash;
              captured by three delta layers:
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
                  (rivalry, secret, quest, unresolved claim) opens a
                  branch in possibility space, implemented as a{" "}
                  <em>prediction market</em> over named outcomes. Each
                  scene emits integer evidence in [−4, +4] on the
                  affected outcomes plus a log-type from nine
                  primitives; the math handles log-odds conversion,
                  volume decay, volatility, scaled closure, and
                  abandonment. Fate falls out of the re-pricing
                  &mdash; the more a scene&apos;s evidence re-shapes a
                  high-attention market&apos;s live possibilities, the
                  more fate it earns. Probability is the accounting;
                  possibility is what&apos;s being tracked.
                </span>
              </li>
            </ul>
            <P>
              Three forces follow, one per delta layer. Together they
              measure how actively each scene is revealing things:
            </P>
            <ul className="space-y-2 text-[13px] text-white/60 leading-relaxed pl-4">
              <li>
                <B>System</B> &mdash; encyclopedic revelation about the{" "}
                <em>world itself</em>. Grows as new rules, concepts,
                and structures accumulate.
              </li>
              <li>
                <B>World</B> &mdash; encyclopedic revelation about the{" "}
                <em>people and places</em>. Grows as characters,
                locations, and artifacts reveal who they&apos;re
                becoming.
              </li>
              <li>
                <B>Fate</B> &mdash; possibility revelation about{" "}
                <em>what could still happen</em>. Grows as the odds
                move on open questions &mdash; rivalries, secrets,
                quests, unresolved claims &mdash; narrowing or
                widening the live outcome space.
              </li>
            </ul>
            <P>
              The composition of these three forces defines a work&apos;s{" "}
              <B>signature</B> &mdash; a continuous point on the unit
              3-simplex recovered from the dominant principal component
              of <Tex>{String.raw`\;(F, W, S)`}</Tex>. Archetypes name
              its neighbourhoods: <B>Paper</B> is system-dominant,{" "}
              <B>Stage</B> world-dominant, <B>Classic</B> fate-dominant,{" "}
              <B>Opus</B> balanced. Each force is first rank-transformed
              to a standard normal &mdash; distribution-free and bounded
              &mdash; so length, genre, and outlier scenes don&apos;t
              bias the comparison across works.
            </P>
          </Section>

          {/* ── Computational Hierarchy ───────────────────────────────── */}
          <Section id="hierarchy" label="Computational Hierarchy">
            <P>
              Long-form works &mdash; narratives, papers, simulations
              &mdash; decompose into five nested layers. Structure
              generation (scenes with deltas) runs independently of
              prose generation (beats and propositions), enabling
              parallel processing and precise attribution.
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
          <Section id="forces" label="The Three Forces">
            <p className="text-[15px] leading-relaxed text-white/50 italic mb-8">
              A text resolves into three fields. <B>Abstract</B>
              {" "}&mdash; the rules and structures that make events
              possible. <B>Physical</B> &mdash; the entities
              (characters, locations, artifacts, institutions) that
              act under those rules. <B>Possibility</B> &mdash; the
              live space of what could still happen, reshaped scene
              by scene. <B>System</B> measures abstract growth,{" "}
              <B>World</B> physical, <B>Fate</B> possibility. Fate
              is <em>possibility</em>, not probability &mdash; what{" "}
              <em>could</em> happen, not what <em>will</em>.
            </p>
            <p className="text-[14px] leading-relaxed text-white/45 mb-8">
              The three modes weight the fields differently:{" "}
              <B>papers</B> mostly grow System (stating and
              connecting rules); <B>simulations</B> mostly observe
              Fate (exploring what could happen under a ruleset);{" "}
              <B>narratives</B> fire all three at once. Identical
              formulas; different signatures.
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
                nodes added to entity dossiers (traits, beliefs,
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
                Fate is the <B>possibility field</B> &mdash; the
                live space of what could still happen, reshaped
                scene by scene. Where System and World measure what
                the work <em>is</em>, Fate measures what it{" "}
                <em>could still be</em>. The unifying force across
                the other two: without fate, the abstract has no
                reason to deepen and the physical has no destiny to
                bend toward.
              </P>
              <P>
                Picture an election-night needle, or the live
                win-probability line during a football game. A belief
                distribution rendered as a bouncing line &mdash; flat
                for stretches, nudged by small evidence, lurching on
                decisive plays, converging at the finish. Every
                thread carries such a line. &ldquo;Will Frodo destroy
                the ring?&rdquo; has one between yes and no;
                &ldquo;Who claims the Iron Throne?&rdquo; has one per
                contending house. Fate is the total movement on those
                lines this scene.
              </P>
              <P>
                Made rigorous, each thread is a{" "}
                <B>prediction market</B> over named outcomes. The
                narrator&apos;s belief is priced as softmax over a
                per-outcome logit vector; scenes shift the vector by
                emitting bounded integer evidence on affected
                outcomes. Fate is the{" "}
                <B>attention-weighted information gain</B> across
                every market touched:
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
                Kullback&ndash;Leibler divergence. No tunable
                constants &mdash; no log-type multipliers, no closure
                bonuses, no scene-level denominators. Fully specified
                by the per-thread evidence vector and pre-scene
                attention.
              </P>
              <P>
                Every behaviour falls out of this one form. Pulses
                leave{" "}
                <Tex>{String.raw`\mathbf{p}^{+} = \mathbf{p}^{-}`}</Tex>
                {" "}so KL is zero &mdash; a vivid scene earns no fate
                if no market moved. Confirmations of the favourite
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
                <Tex>{String.raw`v_t`}</Tex> multiplier: same belief
                movement weighs more on a tracked thread than on a
                forgotten side-thread.
              </P>
              <P>
                In narratives, threads are rivalries, quests,
                secrets. In papers, open questions, contested
                claims. In simulations, the branching outcomes a
                scenario is designed to observe. The market framing
                works universally.
              </P>
              <P>
                <B>Measurement, not target.</B> Unlike World and
                System, Fate has no per-scene floor. Evidence in
                [−4, +4] reads what a neutral observer would update
                on given the scene&apos;s concrete events &mdash; not
                a knob tuned toward a target. Routine scenes emit
                pulses (<Tex>{String.raw`|e| = 0`}</Tex>) and earn
                fate near zero; pivotal scenes emit committal
                evidence (<Tex>{String.raw`|e| \geq 3`}</Tex>) and
                earn it. The math recovers the work&apos;s shape
                only when extraction is faithful to the page. The{" "}
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
          </Section>

          {/* ── Fate Engine ─────────────────────────────────────────── */}
          <Section id="fate-engine" label="Fate Engine">
            <P>
              Threads aren&apos;t lifecycle states; they&apos;re{" "}
              <B>prediction markets</B> over named outcomes. Each
              carries a question (&quot;Will Harry claim the
              Stone?&quot;) and two or more outcomes (binary default;
              multi-outcome enumerates). Belief is priced as softmax
              over a per-outcome logit vector:
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
              &mdash; out of the market without being closed. The
              portfolio self-organises: stakes that matter accumulate
              volume; ignored threads slide off. Resurrection costs{" "}
              <Tex>{String.raw`\Delta v \geq 2`}</Tex> &mdash;
              deliberate attention only.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-2">
              Outcome expansion
            </h3>
            <P>
              Markets can grow mid-story via{" "}
              <code className="text-white/70">addOutcomes</code>{" "}
              &mdash; when a scene opens a possibility that
              didn&apos;t exist before (new contender, unexpected
              option). New outcomes enter at{" "}
              <Tex>{String.raw`\ell = 0`}</Tex>; same-scene evidence
              can shift them. Closed markets reject expansion. A
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
              heavy markets closed on saturating two-sided evidence
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
              Market as narrative prior
            </h3>
            <P>
              Beyond measurement, the portfolio shapes generation.
              Current prices surface to the generator as a soft prior,
              not a constraint. Committed threads (
              <Tex>{String.raw`p \geq 0.75`}</Tex>) lean the next
              scene toward that outcome unless the logType is{" "}
              <code className="text-white/70">twist</code>; contested
              markets (<Tex>{String.raw`H \geq 0.9`}</Tex>) signal a
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
              {" "}is where they converge &mdash; fate markets exert
              pressure, world entities carry agency, system rules
              impose constraints. Fate is a voice in the argument,
              not the conductor.
            </P>
            <P>
              The reasoning graph does <em>not</em> force threads to
              resolve. It receives each active thread with a per-
              thread tag &mdash; LEANS, ACTIVE, CONTESTED, VOLATILE,
              FADING &mdash; derived from market state, and treats it
              as pressure in the force field. Strong-LEANS threads
              with sufficient volume earn fate nodes that land;
              CONTESTED threads often earn nothing (a legitimate
              shape for a pivot arc); FADING threads decay. Fate
              nodes are what the reasoning concludes, not what it was
              forced to serve.
            </P>
            <P>
              This closes the loop. Scenes emit evidence → the markets
              re-price → the next arc&apos;s reasoning graph sees a new
              portfolio → the graph lands whatever the updated state can
              honestly earn → more scenes emit evidence. The system converges
              when the writing is honest about what each arc can deliver.
              Threads that matter accrue volume and eventually close with
              high resolution quality; threads that stop mattering decay into
              abandonment; deliberately resurrected threads carry the
              attention cost of their return. No explicit horizon primitive
              is needed — natural selection through volume decay and
              focus-window ranking handles the lifecycle.
            </P>
          </Section>

          {/* ── Validation ──────────────────────────────────────────── */}
          <Section id="validation" label="Validation">
            <P>
              Do the formulas capture structural significance? Tested
              against <em>Harry Potter and the Sorcerer&apos;s Stone</em>:
              the activity curve below was computed entirely from
              structural deltas extracted at analysis time.{" "}
              <B>Orange regions</B> above the zero line are scenes of high
              force activity in HP&apos;s own vocabulary (fate and world
              moving together); <B>light-blue regions</B> below are
              low-activity stretches — the quieter scenes that set up the
              next peak.
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
              deterministic. Cross-run validation confirms stable
              rankings, and the same formulas drive generation &mdash;
              the measurement <em>is</em> the objective function.
            </P>
          </Section>

          {/* ── Grading ───────────────────────────────────────────────── */}
          <Section id="grading" label="Grading">
            <P>
              Each story receives a score out of 100, with 25 points allocated
              to each of the three forces plus <B>swing</B> — the Euclidean
              distance between consecutive force snapshots, measuring dynamic
              contrast. The grading curve is piecewise, calibrated so published
              works land in the 85–92 range.
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
          </Section>

          {/* ── Embeddings & Proposition Classification ─────────────────── */}
          <Section id="embeddings" label="Embeddings">
            <P>
              Forces operate at the scene level. But readers experience{" "}
              <B>prose</B>, composed of <B>propositions</B> — atomic claims that
              must be accepted as true within the narrative world. &ldquo;Harry
              has a lightning-bolt scar.&rdquo; &ldquo;The wand chooses the
              wizard.&rdquo; Each is a temporally bounded statement whose
              structural significance is determined by its relationships to
              every other proposition.
            </P>
            <P>
              Forces measure <B>what changes</B> in the knowledge graph.
              Propositions measure <B>what is stated</B> in the prose. Every
              proposition is embedded as a 1536-dimensional vector (OpenAI
              text-embedding-3-small), transforming prose into a geometric space
              where similarity is distance and structural relationships become
              computable.
            </P>
            <P>
              Coherent writing behaves <em>like</em> a <B>proof graph</B>.
              Each proposition introduces, derives from, or resolves prior
              content; a plot hole reads as a broken inference chain, a
              satisfying resolution as a deep tree closing. Quality is
              structural — how propositions relate across time — and
              similarity in embedding space gives us a computable handle on
              that structure.
            </P>
            <P>
              The honest caveat: cosine similarity is{" "}
              <em>geometric approximation</em>, not logical inference. Two
              propositions can cluster tightly because they share subject
              matter without either entailing, contradicting, or depending
              on the other. The proof graph we recover is therefore
              <em> soft</em> — it surfaces probable dependencies for humans
              or downstream LLM calls to confirm, not hard entailment
              relations. A fully proof-like layer would add explicit typed
              links (<em>entails</em>, <em>contradicts</em>,{" "}
              <em>depends-on</em>) over the embedded propositions; the
              current system stops at the geometric step and treats that
              as a <em>well-shaped prior</em>, not a verdict.
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
              <a href="#classification" className="text-accent hover:underline">
                Classification
              </a>{" "}
              section.
            </P>
          </Section>

          {/* ── Causal Reasoning ──────────────────────────────────────── */}
          <Section id="planning" label="Causal Reasoning">
            <P>
              Generation begins with a question scoring alone cannot answer:{" "}
              <em>what must happen next, and why?</em> An arc is four to eight
              scenes carrying a single chunk of narrative work — advancing a
              thread, exposing a character, planting a payoff. A thread
              escalates because an entity learned something, which required
              access to a location, which required an artifact to change hands,
              which was constrained by a system rule foreshadowed three scenes
              earlier. Narrative consequence isn&apos;t a line. It&apos;s a
              graph.
            </P>
            <P>
              The architecture preserves this graph explicitly. Before
              any scene of an arc is generated, a{" "}
              <B>causal reasoning graph</B> is built: a typed graph of
              what must happen and why. Scenes then execute the graph
              rather than improvising local transitions. The node and
              edge taxonomy &mdash; eight node types across pressure,
              substrate, and bridge tiers, plus eight edge types &mdash;
              is enumerated in the{" "}
              <a href="#classification" className="text-accent hover:underline">
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
              expansive — keep many). Click through the animation below to
              see each mode&rsquo;s distinct shape; the prose then unpacks
              how each actually builds a graph.
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
                      <em>
                        which hypothesis, among competitors, best produces
                        this?
                      </em>{" "}
                      The engine generates several candidate causal chains
                      in parallel, then commits to the strongest. The
                      animation shows this as multiple lanes converging
                      upward on a fate terminal at top — one bright
                      (selected), the rest dim (rejected). Arcs have
                      targets; the question abduction answers is the{" "}
                      <B>most satisfying route</B> to one. The drift risk
                      is silent — once the first prior commits, abduction
                      can flip into deduction and stop considering
                      alternatives. Anchor discipline forces the engine to
                      keep the rejected lanes visible as it builds.
                    </>
                  ),
                },
                {
                  name: "Divergent",
                  caption: "forward · expansive",
                  color: "#FBBF24",
                  body: (
                    <>
                      Start from one source — an entity, an event, a thread
                      — and branch into many possibilities without
                      committing. Each branch grows leaves; a final check
                      asks which leaf-pairs are{" "}
                      <B>mutually exclusive</B> (a character cannot both
                      die and inherit, a rule cannot both hold and break).
                      The animation shows a tree growing downward with a
                      dashed red edge marking one such pair. Divergent is
                      the mode for <B>world expansion</B> and collision
                      discovery — when the goal is to find surprising
                      adjacencies rather than derive a specific outcome,
                      and when the failure mode of abduction (committing
                      too early) needs to be avoided.
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
                      The chain is deep and straight — no branching, no
                      alternatives. The animation shows a rigid vertical
                      chain; the premise carries a persistent outer halo,
                      a validated-premise signal. If branching ever
                      appears, the mode has drifted into divergent and
                      must correct. Deduction is the mode for arcs where
                      the premise{" "}
                      <B>fully determines the outcome</B> — siege
                      logistics, inheritance politics, the endgame of a
                      trap the protagonist has already walked into.
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
                      collects a set of prior events or scenes and asks:{" "}
                      <em>what pattern underlies these?</em> The answer is
                      promoted to a principle-level claim that governs
                      future scenes. The animation shows a wide fan of
                      observations pointing upward to a single principle,
                      with a dashed ghost alongside — at least one{" "}
                      <B>competing generalisation</B> survives as a live
                      alternative. Useful for backfilling worldbuilding
                      from accumulated events, or surfacing a thematic
                      claim the prose has been enacting implicitly.
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
                      <span
                        className="font-semibold text-[13px]"
                        style={{ color }}
                      >
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
              next?&rdquo; It starts from <B>fate</B> — the threads the
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

          {/* ── Research Methods ──────────────────────────────────────── */}
          <Section id="research" label="Research Methods">
            <P>
              Forces and embeddings measure what&rsquo;s <B>on the page</B>.
              A knowledge graph becomes a living world only when it is{" "}
              <em>probed</em>. Four instruments compose a{" "}
              <B>four-layer diagnostic</B> of a world&rsquo;s interior —
              each revealing a structure the prose never summarises:
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
                  name: "game theory",
                  caption: "2\u00d72 decomposition per beat",
                  body: "strategic structure beneath the prose. Each game carries an axis (14 types \u2014 disclosure / trust / stakes\u2026) and a shape (19 types \u2014 dilemma / stag-hunt / signaling\u2026) with integer stake deltas in [\u22124, +4]. Additive: written to scene.gameAnalysis, never mutates deltas.",
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
                    <span className="uppercase tracking-wider font-mono text-[10px]" style={{ color }}>{name}</span>
                    <span className="text-white/30 text-[10px]">{caption}</span>
                  </div>
                  <span className="text-white/55">{body}</span>
                </div>
              ))}
            </div>
            <P>
              Every respondent answers in-character from its own world-graph
              continuity — the same private knowledge the Character chat
              persona uses — so responses are grounded in what that specific
              entity knows, not in the LLM&rsquo;s general knowledge. The
              ELO update uses a continuous margin rather than binary W/L:
            </P>
            <Eq
              label="Margin score from A's perspective"
              tex="s_A = \mathrm{clamp}\left(0.5 + \frac{\Delta_A - \Delta_B}{16},\ 0,\ 1\right)"
            />
            <P>
              <B>Distribution</B>, <B>depth</B>, <B>moves</B>, and{" "}
              <B>accumulation</B> — surveys sample breadth, interviews
              profile one mind, game theory names the strategic shape of a
              beat, ELO tracks who accumulates advantage across the story.
              Narrative structure and strategic structure are orthogonal: a
              force-balanced scene can contain an unresolved prisoner&rsquo;s
              dilemma, and that orthogonality is what makes the fourth
              layer informative.
            </P>
          </Section>

          {/* ── Prose Profiles ────────────────────────────────────────── */}
          <Section id="prose-profiles" label="Prose Profiles">
            <P>
              Prose generation separates <B>content</B> (what is written)
              from <B>accent</B> (how). Content comes from beat plans —
              blueprints specifying the narrative work each paragraph must
              perform. Accent comes from prose profiles — statistical
              fingerprints of authorial voice reverse-engineered from
              published works.
            </P>

            <P>
              A <B>prose profile</B> has two components:{" "}
              <Tex>{"(1)"}</Tex> a distribution over 8 delivery mechanisms —
              the author&apos;s balance of dialogue, action, thought,
              narration; <Tex>{"(2)"}</Tex> voice parameters — register,
              stance, tense, rhetorical devices. Each beat in a plan is
              classified by function (a 10-item taxonomy: breathe, inform,
              advance, bond, turn, reveal, shift, expand, foreshadow,
              resolve) and delivered through one of the 8 mechanisms.
            </P>

            <P>
              Profiles are extracted empirically: an LLM decomposes scenes
              into typed beats classified against the taxonomy; mechanism
              counts become a distribution. During generation, beat functions
              are chosen by the LLM per scene; mechanisms sample from the
              distribution; voice parameters constrain each beat.
            </P>

            <P>
              The payoff is{" "}
              <B>structural control without stylistic constraint</B>. Beat
              plans scaffold what happens; profiles supply how it sounds.
              Swap the profile and the same story renders in a different
              authorial accent — a thriller in Orwell&apos;s introspective
              voice produces psychological tension; the same story in
              Rowling&apos;s dialogue-driven style produces kinetic urgency.
            </P>
          </Section>

          {/* ── Markov Chains ─────────────────────────────────────────── */}
          <Section id="markov" label="Markov Chains">
            <P>
              InkTide uses two layers of Markov chains. Layer 1 operates at
              the <strong>scene level</strong> — sampling force profiles from
              an 8-state matrix to control pacing. Layer 2 operates at the{" "}
              <strong>beat level</strong> — sampling sequences from a
              10-state matrix over beat functions to control prose texture.
              Both are derived the same way: classify each unit, count
              consecutive transitions, normalise rows.
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
              hits. Within a scene, the prose itself has structure — a
              sequence of discrete <strong>beats</strong>, each a specific
              narrative function delivered through a specific mechanism. An
              LLM decomposes scenes into beats classified against a fixed
              taxonomy of 10 functions and 8 mechanisms.
            </P>

            <P>
              The <strong>10 beat functions</strong> describe what each section
              of prose does:{" "}
              <span className="text-white/60">
                <span style={{ color: "#6b7280" }}>breathe</span> (atmosphere,
                grounding), <span style={{ color: "#3b82f6" }}>inform</span>{" "}
                (knowledge delivery),{" "}
                <span style={{ color: "#22c55e" }}>advance</span> (forward
                momentum), <span style={{ color: "#ec4899" }}>bond</span>{" "}
                (relationship shifts),{" "}
                <span style={{ color: "#f59e0b" }}>turn</span> (pivots and
                reversals), <span style={{ color: "#a855f7" }}>reveal</span>{" "}
                (character nature exposed),{" "}
                <span style={{ color: "#ef4444" }}>shift</span> (power dynamics
                invert), <span style={{ color: "#06b6d4" }}>expand</span>{" "}
                (world-building),{" "}
                <span style={{ color: "#84cc16" }}>foreshadow</span> (plants for
                later fate), <span style={{ color: "#14b8a6" }}>resolve</span>{" "}
                (tension releases).
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
              Two independent chains, orthogonal axes:{" "}
              <em>what happens</em> (LLM from narrative logic),{" "}
              <em>how intensely</em> (scene-level pacing chain), and{" "}
              <em>how it reads</em> (beat-level prose chain). Both derived
              empirically from published works.
            </P>
          </Section>

          {/* ── Revision ──────────────────────────────────────────── */}
          <Section id="revision" label="Revision">
            <P>
              First drafts are rough. Scenes repeat beats, characters stagnate,
              threads drift. The revision pipeline improves a branch
              systematically without starting over, using the same git-like
              branching that underlies generation.
            </P>
            <P>
              <B>Evaluation</B> reads scene summaries and assigns per-scene
              verdicts. <B>Reconstruction</B> creates a new versioned branch,
              applying verdicts in parallel — edits revise content, merges
              combine scenes, inserts generate new scenes to fill gaps, moves
              reposition scenes without any LLM call, cuts are omitted. World
              commits pass through at their original positions. The original
              branch is never modified.
            </P>

            <div className="mt-4 space-y-1.5 text-[12px]">
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-emerald-400 font-mono w-14 shrink-0">
                  ok
                </span>
                <span className="text-white/50">
                  Structurally sound, continuity intact. Kept as-is.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-amber-400 font-mono w-14 shrink-0">
                  edit
                </span>
                <span className="text-white/50">
                  Revise content — may change POV, location, participants,
                  deltas, and summary.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-blue-400 font-mono w-14 shrink-0">
                  merge
                </span>
                <span className="text-white/50">
                  Absorbed into another scene. Both scenes&apos; best elements
                  combined into one denser beat.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-cyan-400 font-mono w-14 shrink-0">
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
                <span className="text-blue-400 font-mono w-14 shrink-0">
                  move
                </span>
                <span className="text-white/50">
                  Content correct but wrong position. Repositioned after a
                  target scene using{" "}
                  <code className="text-blue-300/70">moveAfter</code>. No LLM
                  call — prose preserved exactly.
                </span>
              </div>
            </div>

            <P>
              Evaluations can be <B>guided</B> with external feedback — from
              another AI, a human editor, or the author&apos;s own notes. Each
              reconstruction produces a versioned branch (<em>v2</em>,{" "}
              <em>v3</em>, <em>v4</em>) — the original is never modified. The
              loop converges in 2–3 passes. Beneath branch versioning,
              individual scenes track prose and plan versions with semantic
              numbering (major/minor/patch), and structural branching uses
              git-like reference sharing so a 200-scene narrative with 10
              branches stores far fewer than 2000 scene objects.
            </P>
          </Section>

          {/* ── Classification ──────────────────────────────────────── */}
          <Section id="classification" label="Classification">
            <P>
              Classification operates at two levels: <B>propositions</B> (the
              atomic claims within prose) and <B>narratives</B> (the overall
              structural profile). Proposition classification identifies
              load-bearing content for generation. Narrative classification
              categorizes works by force dominance for comparative analysis.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Propositions
            </h3>
            <P>
              Each proposition is classified along three axes: backward{" "}
              <a href="#embeddings" className="text-accent hover:underline">
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
                  <div className="flex items-baseline gap-2 mb-1">
                    <span
                      className="text-[12px] font-semibold"
                      style={{ color }}
                    >
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
                    <span className="font-medium" style={{ color }}>
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
                    <span className="font-medium" style={{ color }}>
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
                    <span className="font-medium" style={{ color }}>
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
              <a href="#planning" className="text-accent hover:underline">
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
                  <span
                    className="uppercase tracking-wider font-mono text-[10px] mr-2"
                    style={{ color }}
                  >
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

          {/* ── Economics ──────────────────────────────────────────────── */}
          <Section id="economics" label="Economics">
            <P>
              A short story costs under a dollar; a full novel under
              seven; an open-ended serial under forty. The whole
              pipeline &mdash; structure, analysis, evaluation, beat
              plans, and prose &mdash; runs on{" "}
              <B>DeepSeek v4 Flash</B> (<B>$0.14/M input</B>,{" "}
              <B>$0.28/M output</B>). Input tokens dominate because
              every call sends the full context, but context is
              capped by the branch time horizon (~50 scenes), so cost
              per arc is constant &mdash; arc 10 costs the same as arc
              100. Reasoning is configurable per work from none
              (analysis) through low (~2K tokens/call, default) to
              high (~24K).
            </P>

            <CostEstimates />

            <P>
              Analysing a 100K-word novel into full narrative state
              costs under twenty-five cents (parallel chunk extraction,
              no reasoning). A 500K-word series runs about a dollar.
              Evaluating a branch costs five cents. The same numbers
              apply to non-fiction and simulation at comparable scale
              &mdash; domain corpus, scenario brief, wargame timeline
              all extract for cents. At these prices the
              generate-evaluate-revise loop is cheap to repeat across
              prose profiles, branches, and structural constraints;
              comparative datasets across dozens of corpora are within
              reach. <B>Computation is fixed and cheap; data quality
              decides the result.</B>
            </P>
          </Section>

          {/* ── Open Source ───────────────────────────────────────────── */}
          <Section id="open-source" label="Open Source">
            <P>
              InkTide is open source. Every formula in this paper lives
              in the codebase &mdash; readable, runnable, modifiable.
            </P>
            <P>
              Structural analysis benefits from transparency: every
              weight, threshold, and reference mean is a constant in
              the source. The formulas are tools to read and modify,
              not doctrine. A genre needing a fourth force can add
              one; a domain needing a different calibration can
              replace the defaults.
            </P>
            <P>
              The{" "}
              <Link
                href="/analysis"
                className="text-white/60 underline underline-offset-2 hover:text-white/80 transition-colors"
              >
                analysis pipeline
              </Link>{" "}
              accepts any corpus &mdash; novels, screenplays, web
              serials, fanfiction, research papers, scenario briefs,
              wargame logs. The interesting cases are domains the
              framework was never tuned for, with priors rich enough
              to model them cleanly. Contributions welcome.
            </P>

            <div className="mt-8 flex flex-col sm:flex-row flex-wrap gap-3">
              <Link
                href="/case-analysis"
                className="text-[11px] px-4 py-2 rounded-full border border-amber-500/30 bg-amber-500/5 text-amber-400/80 hover:text-amber-300 hover:border-amber-500/50 hover:bg-amber-500/10 transition-colors text-center"
              >
                See it in action: Harry Potter case analysis &rarr;
              </Link>
              <a
                href="https://github.com/jasonyu0100/inktide"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] px-4 py-2 rounded-full border border-white/15 bg-white/3 text-white/50 hover:text-white/70 hover:border-white/25 hover:bg-white/5 transition-colors text-center"
              >
                View the repo on GitHub &rarr;
              </a>
            </div>
          </Section>

          {/* ── Coming Soon ───────────────────────────────────────────── */}
          <Section id="coming-soon" label="Coming Soon">
            <P>
              Two features close the loop from <em>simulation</em> to{" "}
              <em>forecasting tool</em>.
            </P>
            <P>
              <B>A/B tests against reality.</B> Backtest model
              forecasts against actual outcomes as they unfold. The
              operator sees where priors held and where reality
              diverged, then refines the priors. Better priors, sharper
              forecasts, compounding confidence &mdash; the source of
              truth is reality itself, or any ground truth you trust.
            </P>
            <P>
              <B>Experimental controlled-variable setups.</B> Hold
              scope and direction constant, vary one parameter
              (forces, reasoning mode, priors), generate{" "}
              <em>N</em> candidate timelines, compare outcomes.
              Multi-scenario probabilistic forecasting follows:
              probability mass over alternative futures, all grounded
              in the same world model. Forecasting from the present,
              not just analysis of the past.
            </P>
            <P>
              Both extend primitives already exposed by the engine
              &mdash; branchable timelines, scope-controlled chat,
              deterministic force math &mdash; and turn the platform
              from a simulator into a continuously-updating
              forecasting tool. Priors are inputs; simulations are
              experiments; reality is the validation.
            </P>
          </Section>
        </div>
      </div>
    </div>
  );
}
