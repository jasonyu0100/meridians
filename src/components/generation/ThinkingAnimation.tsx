'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import type { ForcePreference, ReasoningMode } from '@/lib/ai';
import type { NetworkBias, ReasoningSize } from './ForcePreferencePicker';

/**
 * ThinkingAnimation — minimalist visualisation of the four reasoning modes.
 *
 * One accent colour driven by force preference. One defining motion per mode:
 *   abduction → competing chains rise toward one anchor; the chosen one wins
 *   deduction → a single chain extends downward step by step
 *   divergent → one source unfurls outward into a fan
 *   induction → a wide scatter coalesces upward into one principle
 *
 * Density (small/medium/large) scales node count. Network bias (inside /
 * neutral / outside) shifts the lateral spread of secondary elements. The
 * animation loops on a clean fade.
 */

type Props = {
  mode: ReasoningMode;
  force: ForcePreference;
  size: ReasoningSize;
  networkBias: NetworkBias;
  width?: number;
  height?: number;
  /** When true, the animation plays once and stops at hold. Used for the
   *  "running" surface where the CRG is actively generating. */
  oneShot?: boolean;
};

// ── Force palette ────────────────────────────────────────────────────────────

const FORCE_ACCENT: Record<ForcePreference, string> = {
  freeform: '#e5e7eb',
  fate: '#ef4444',
  world: '#22c55e',
  system: '#3b82f6',
  chaos: '#a855f7',
};

const FORCE_LABEL: Record<ForcePreference, string> = {
  freeform: 'Freeform',
  fate: 'Fate',
  world: 'World',
  system: 'System',
  chaos: 'Chaos',
};

const MODE_LABEL: Record<ReasoningMode, string> = {
  abduction: 'Abduction',
  deduction: 'Deduction',
  divergent: 'Divergent',
  induction: 'Induction',
};

const MODE_GLYPH: Record<ReasoningMode, string> = {
  abduction: '←',
  deduction: '↓',
  divergent: '↗',
  induction: '↑',
};

const BIAS_LABEL: Record<NetworkBias, string> = {
  inside: 'Inside',
  neutral: 'Neutral',
  outside: 'Outside',
};

// ── Build plan ───────────────────────────────────────────────────────────────

type Pt = { x: number; y: number };
type Node = Pt & {
  r: number;
  /** 0..1 — at full opacity vs ghosted. Ghosted nodes are visible but dim. */
  weight: number;
  /** Order in the build sequence. */
  step: number;
  /** True for the singular focal node — gets a halo. */
  focal?: boolean;
};
type Edge = {
  from: Pt;
  to: Pt;
  weight: number;
  step: number;
  /** When true, draw with a slight curve toward the centre. */
  curve?: boolean;
};

type Plan = { nodes: Node[]; edges: Edge[]; focalIndex: number };

const SIZE_TIER: Record<ReasoningSize, number> = {
  small: 0,
  medium: 1,
  large: 2,
};

function biasSpread(bias: NetworkBias): number {
  if (bias === 'inside') return 0.7;
  if (bias === 'outside') return 1.15;
  return 1.0;
}

function buildAbduction(w: number, h: number, size: ReasoningSize, bias: NetworkBias): Plan {
  // Fate anchor at the top; competing chains rise from below.
  const tier = SIZE_TIER[size];
  const lanes = 2 + tier; // 2 / 3 / 4
  const chainLen = 2 + tier; // 2 / 3 / 4
  const spread = biasSpread(bias);

  const cx = w / 2;
  const top = h * 0.18;
  const bottom = h * 0.92;
  const laneSpan = (w * 0.78) * spread;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const focal: Node = { x: cx, y: top, r: 6, weight: 1, step: 0, focal: true };
  nodes.push(focal);

  const chosen = Math.floor(lanes / 2);
  let stepCounter = 1;

  for (let l = 0; l < lanes; l++) {
    const t = lanes === 1 ? 0.5 : l / (lanes - 1);
    const laneX = cx - laneSpan / 2 + t * laneSpan;
    const isChosen = l === chosen;
    const w0 = isChosen ? 1 : 0.18;

    let prev: Pt = focal;
    for (let k = 0; k < chainLen; k++) {
      const ny = top + ((bottom - top) * (k + 1)) / chainLen;
      // Chains converge slightly toward the focal at top.
      const conv = 0.55 + 0.45 * (1 - k / chainLen);
      const nx = cx + (laneX - cx) * conv;
      const node: Node = {
        x: nx,
        y: ny,
        r: 3.4,
        weight: w0,
        step: stepCounter,
      };
      nodes.push(node);
      edges.push({
        from: node,
        to: prev,
        weight: w0,
        step: stepCounter,
        curve: true,
      });
      prev = node;
      stepCounter += 1;
    }
  }

  return { nodes, edges, focalIndex: 0 };
}

function buildDeduction(w: number, h: number, size: ReasoningSize, bias: NetworkBias): Plan {
  // Single chain from premise (top) down to conclusion (bottom).
  const tier = SIZE_TIER[size];
  const chainLen = 4 + tier; // 4 / 5 / 6
  const spread = biasSpread(bias);

  const cx = w / 2;
  const top = h * 0.16;
  const bottom = h * 0.92;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const focal: Node = { x: cx, y: top, r: 6, weight: 1, step: 0, focal: true };
  nodes.push(focal);

  let prev: Pt = focal;
  for (let k = 0; k < chainLen; k++) {
    const t = (k + 1) / chainLen;
    // Tiny lateral drift so the chain reads as a line of thought, not a ruler.
    const drift = Math.sin((k + 1) * 1.7) * 14 * spread;
    const node: Node = {
      x: cx + drift,
      y: top + (bottom - top) * t,
      r: 3.4,
      weight: 1,
      step: k + 1,
    };
    nodes.push(node);
    edges.push({ from: prev, to: node, weight: 1, step: k + 1 });
    prev = node;
  }

  return { nodes, edges, focalIndex: 0 };
}

function buildDivergent(w: number, h: number, size: ReasoningSize, bias: NetworkBias): Plan {
  // One source at top → branches → leaves.
  const tier = SIZE_TIER[size];
  const branches = 3 + tier; // 3 / 4 / 5
  const leavesPerBranch = tier === 0 ? 1 : 2;
  const spread = biasSpread(bias);

  const cx = w / 2;
  const top = h * 0.18;
  const midY = h * 0.5;
  const leafY = h * 0.86;
  const laneSpan = (w * 0.82) * spread;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const focal: Node = { x: cx, y: top, r: 6, weight: 1, step: 0, focal: true };
  nodes.push(focal);

  let stepCounter = 1;
  for (let b = 0; b < branches; b++) {
    const t = branches === 1 ? 0.5 : b / (branches - 1);
    const bx = cx - laneSpan / 2 + t * laneSpan;
    const branchNode: Node = {
      x: bx,
      y: midY,
      r: 3.6,
      weight: 1,
      step: stepCounter,
    };
    nodes.push(branchNode);
    edges.push({
      from: focal,
      to: branchNode,
      weight: 1,
      step: stepCounter,
      curve: true,
    });
    stepCounter += 1;

    for (let l = 0; l < leavesPerBranch; l++) {
      const lt = leavesPerBranch === 1 ? 0.5 : l / (leavesPerBranch - 1);
      const lx = bx + (lt - 0.5) * 36 * spread;
      const leafNode: Node = {
        x: lx,
        y: leafY,
        r: 2.8,
        weight: 0.85,
        step: stepCounter,
      };
      nodes.push(leafNode);
      edges.push({
        from: branchNode,
        to: leafNode,
        weight: 0.85,
        step: stepCounter,
      });
      stepCounter += 1;
    }
  }

  return { nodes, edges, focalIndex: 0 };
}

function buildInduction(w: number, h: number, size: ReasoningSize, bias: NetworkBias): Plan {
  // Wide scatter of observations at bottom converge upward to one principle.
  const tier = SIZE_TIER[size];
  const obsCount = 6 + tier * 2; // 6 / 8 / 10
  const spread = biasSpread(bias);

  const cx = w / 2;
  const top = h * 0.18;
  const bottom = h * 0.84;
  const laneSpan = (w * 0.84) * spread;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const focal: Node = { x: cx, y: top, r: 6, weight: 1, step: obsCount + 1, focal: true };

  // Observations animate in first; principle commits last.
  for (let i = 0; i < obsCount; i++) {
    const t = obsCount === 1 ? 0.5 : i / (obsCount - 1);
    const ox = cx - laneSpan / 2 + t * laneSpan;
    // Slight vertical jitter for organic feel.
    const oy = bottom - Math.abs(Math.sin(i * 1.3)) * 16;
    const obs: Node = {
      x: ox,
      y: oy,
      r: 2.8,
      weight: 0.9,
      step: i + 1,
    };
    nodes.push(obs);
    edges.push({ from: obs, to: focal, weight: 0.4, step: obsCount + 1 + i });
  }

  nodes.push(focal);
  return { nodes, edges, focalIndex: nodes.length - 1 };
}

function buildPlan(
  mode: ReasoningMode,
  size: ReasoningSize,
  bias: NetworkBias,
  w: number,
  h: number,
): Plan {
  switch (mode) {
    case 'abduction':
      return buildAbduction(w, h, size, bias);
    case 'deduction':
      return buildDeduction(w, h, size, bias);
    case 'divergent':
      return buildDivergent(w, h, size, bias);
    case 'induction':
      return buildInduction(w, h, size, bias);
  }
}

// ── Component ────────────────────────────────────────────────────────────────

const STEP_DELAY = 220;
const STEP_DURATION = 360;
const HOLD = 900;
const FADE = 600;
const LOOP_GAP = 320;

export function ThinkingAnimation({
  mode,
  force,
  size,
  networkBias,
  width = 360,
  height = 240,
  oneShot = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const accent = FORCE_ACCENT[force];

  const plan = useMemo(
    () => buildPlan(mode, size, networkBias, width, height),
    [mode, size, networkBias, width, height],
  );

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    let cancelled = false;
    let timer: number | null = null;

    function play() {
      if (cancelled) return;
      svg.selectAll('g.tk-stage').remove();

      const stage = svg.append('g').attr('class', 'tk-stage');
      const edgeLayer = stage.append('g').attr('class', 'tk-edges');
      const nodeLayer = stage.append('g').attr('class', 'tk-nodes');

      // Pre-create all elements at zero opacity so the appear transition is uniform.
      const edgeSel = edgeLayer
        .selectAll('path')
        .data(plan.edges)
        .enter()
        .append('path')
        .attr('d', (e) => edgePath(e))
        .attr('fill', 'none')
        .attr('stroke', accent)
        .attr('stroke-width', (e) => 0.7 + e.weight * 0.5)
        .attr('stroke-linecap', 'round')
        .attr('opacity', 0)
        .each(function (this: SVGPathElement) {
          const len = this.getTotalLength();
          d3.select(this)
            .attr('stroke-dasharray', `${len}`)
            .attr('stroke-dashoffset', len);
        });

      const nodeSel = nodeLayer
        .selectAll('circle')
        .data(plan.nodes)
        .enter()
        .append('circle')
        .attr('cx', (n) => n.x)
        .attr('cy', (n) => n.y)
        .attr('r', 0)
        .attr('fill', accent)
        .attr('opacity', 0);

      // Halo for the focal node.
      const focal = plan.nodes[plan.focalIndex];
      const halo = stage
        .insert('circle', ':first-child')
        .attr('cx', focal.x)
        .attr('cy', focal.y)
        .attr('r', focal.r)
        .attr('fill', 'none')
        .attr('stroke', accent)
        .attr('stroke-width', 1)
        .attr('opacity', 0);

      // ── Sequence ──
      const maxStep = Math.max(
        ...plan.nodes.map((n) => n.step),
        ...plan.edges.map((e) => e.step),
      );

      // Focal appears first, with a soft halo pulse.
      nodeSel
        .filter((n) => n.step === 0)
        .transition()
        .duration(STEP_DURATION)
        .attr('r', (n) => n.r)
        .attr('opacity', (n) => 0.7 + n.weight * 0.3);

      halo
        .transition()
        .duration(STEP_DURATION)
        .attr('opacity', 0.55)
        .transition()
        .duration(700)
        .attr('r', focal.r * 2.6)
        .attr('opacity', 0)
        .on('end', function () {
          // Re-arm halo for a second gentler pulse later.
          d3.select(this).attr('r', focal.r);
        });

      // Then each subsequent step in order.
      for (let s = 1; s <= maxStep; s++) {
        const delay = s * STEP_DELAY;

        nodeSel
          .filter((n) => n.step === s)
          .transition()
          .delay(delay)
          .duration(STEP_DURATION)
          .ease(d3.easeCubicOut)
          .attr('r', (n) => n.r)
          .attr('opacity', (n) => 0.5 + n.weight * 0.45);

        edgeSel
          .filter((e) => e.step === s)
          .attr('opacity', (e) => 0.25 + e.weight * 0.55)
          .transition()
          .delay(delay)
          .duration(STEP_DURATION + 80)
          .ease(d3.easeCubicOut)
          .attr('stroke-dashoffset', 0);
      }

      const buildEnd = (maxStep + 1) * STEP_DELAY + STEP_DURATION;

      // Late halo pulse on the focal — anchors the eye after the build.
      timer = window.setTimeout(
        () => {
          if (cancelled) return;
          halo
            .attr('r', focal.r)
            .attr('opacity', 0.4)
            .transition()
            .duration(900)
            .ease(d3.easeCubicOut)
            .attr('r', focal.r * 3.2)
            .attr('opacity', 0);
        },
        buildEnd - STEP_DURATION,
      );

      if (oneShot) return;

      // Fade and loop.
      timer = window.setTimeout(() => {
        if (cancelled) return;
        stage
          .transition()
          .duration(FADE)
          .ease(d3.easeCubicIn)
          .attr('opacity', 0)
          .on('end', () => {
            if (cancelled) return;
            timer = window.setTimeout(play, LOOP_GAP);
          });
      }, buildEnd + HOLD);
    }

    play();

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      svg.selectAll('g.tk-stage').remove();
    };
  }, [plan, accent, oneShot]);

  return (
    <div
      className="relative"
      style={{ width, height }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="block"
        style={{ overflow: 'visible' }}
      />
      {/* Top-left meta — mode + force */}
      <div className="pointer-events-none absolute top-1.5 left-2 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] tracking-[0.18em] uppercase text-text-dim/70 font-mono">
            {MODE_LABEL[mode]}
          </span>
          <span className="text-[9px] text-text-dim/40">{MODE_GLYPH[mode]}</span>
        </div>
        <span
          className="text-[9px] tracking-[0.18em] uppercase font-mono"
          style={{ color: accent, opacity: 0.85 }}
        >
          {FORCE_LABEL[force]}
        </span>
      </div>

      {/* Bottom-right meta — bias dot row */}
      <div className="pointer-events-none absolute bottom-1.5 right-2 flex items-center gap-1.5">
        <span className="text-[9px] tracking-[0.18em] uppercase text-text-dim/70 font-mono">
          {BIAS_LABEL[networkBias]}
        </span>
        <BiasDots bias={networkBias} accent={accent} />
      </div>
    </div>
  );
}

function BiasDots({ bias, accent }: { bias: NetworkBias; accent: string }) {
  // Three dots; the active position fills with the accent.
  const positions: NetworkBias[] = ['inside', 'neutral', 'outside'];
  return (
    <div className="flex gap-1">
      {positions.map((p) => (
        <span
          key={p}
          className="w-1 h-1 rounded-full"
          style={{
            background: p === bias ? accent : 'rgba(255,255,255,0.18)',
            opacity: p === bias ? 0.9 : 1,
          }}
        />
      ))}
    </div>
  );
}

function edgePath(e: Edge): string {
  if (!e.curve) {
    return `M${e.from.x},${e.from.y} L${e.to.x},${e.to.y}`;
  }
  const mx = (e.from.x + e.to.x) / 2;
  const my = (e.from.y + e.to.y) / 2;
  // Bend slightly toward the canvas centre — gives chains a natural curve.
  const dx = e.to.x - e.from.x;
  const dy = e.to.y - e.from.y;
  const nx = -dy * 0.18;
  const ny = dx * 0.18;
  return `M${e.from.x},${e.from.y} Q${mx + nx},${my + ny} ${e.to.x},${e.to.y}`;
}
