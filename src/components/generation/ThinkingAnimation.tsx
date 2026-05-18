'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import type { ThinkingResource, ThinkingStyle } from '@/lib/ai';
import type { NetworkBias, ReasoningSize } from './ThinkingPicker';

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
  mode: ThinkingStyle;
  force: ThinkingResource;
  size: ReasoningSize;
  networkBias: NetworkBias;
  width?: number;
  height?: number;
  /** When true, the animation plays once and stops at hold. Used for the
   *  "running" surface where the CRG is actively generating. */
  oneShot?: boolean;
};

// ── Force palette ────────────────────────────────────────────────────────────

const FORCE_ACCENT: Record<ThinkingResource, string> = {
  freeform: '#e5e7eb',
  fate: '#ef4444',
  world: '#22c55e',
  system: '#3b82f6',
  chaos: '#a855f7',
};

// Labels for style + resource render in the picker's dropdowns, so the
// visual itself stays unlabelled — pure geometry and accent burst.

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
  // Fate anchor at the top; competing chains rise from below as perfectly
  // vertical lanes off a horizontal junction. Odd lane counts keep the chosen
  // lane on the spine. Straight lines only — the order is the geometry.
  const tier = SIZE_TIER[size];
  const lanes = 3 + tier * 2; // 3 / 5 / 7
  const chainLen = 2 + tier; // 2 / 3 / 4
  const spread = biasSpread(bias);

  const cx = w / 2;
  const top = h * 0.16;
  const junctionY = h * 0.34;
  const chainTop = h * 0.48;
  const bottom = h * 0.92;
  const laneSpan = (w * 0.78) * spread;
  const rowStep = chainLen === 1 ? 0 : (bottom - chainTop) / (chainLen - 1);

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const focal: Node = { x: cx, y: top, r: 6, weight: 1, step: 0, focal: true };
  nodes.push(focal);

  const chosen = (lanes - 1) / 2;
  let stepCounter = 1;

  for (let l = 0; l < lanes; l++) {
    const t = l / (lanes - 1);
    const laneX = cx - laneSpan / 2 + t * laneSpan;
    const isChosen = l === chosen;
    const w0 = isChosen ? 1 : 0.22;

    // Junction stub: a single small node at the top of the lane that connects
    // back to the focal. Reading: focal radiates straight down to each lane
    // head, then the lane drops vertically. No diagonals inside a lane.
    const head: Node = {
      x: laneX,
      y: junctionY,
      r: isChosen ? 3.0 : 2.6,
      weight: w0,
      step: stepCounter,
    };
    nodes.push(head);
    edges.push({ from: focal, to: head, weight: w0, step: stepCounter });
    stepCounter += 1;

    let prev: Pt = head;
    for (let k = 0; k < chainLen; k++) {
      const ny = chainTop + k * rowStep;
      const node: Node = {
        x: laneX,
        y: ny,
        r: isChosen ? 3.4 : 3.0,
        weight: w0,
        step: stepCounter,
      };
      nodes.push(node);
      edges.push({ from: prev, to: node, weight: w0, step: stepCounter });
      prev = node;
      stepCounter += 1;
    }
  }

  return { nodes, edges, focalIndex: 0 };
}

function buildDeduction(w: number, h: number, size: ReasoningSize, bias: NetworkBias): Plan {
  // Single chain from premise (top) straight down to conclusion (bottom).
  // Zero drift — the order of the form IS the order of the argument.
  void bias;
  const tier = SIZE_TIER[size];
  const chainLen = 4 + tier; // 4 / 5 / 6

  const cx = w / 2;
  const top = h * 0.14;
  const chainTop = h * 0.28;
  const bottom = h * 0.92;
  const rowStep = (bottom - chainTop) / (chainLen - 1);

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const focal: Node = { x: cx, y: top, r: 6, weight: 1, step: 0, focal: true };
  nodes.push(focal);

  let prev: Pt = focal;
  for (let k = 0; k < chainLen; k++) {
    const node: Node = {
      x: cx,
      y: chainTop + k * rowStep,
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
  // One source at top → odd-count branches → matching leaves at the same row.
  // All branches sit on the same Y; all leaves sit on the same Y. Vertical
  // lane drops inside each branch; only the focal-to-branch step is diagonal.
  const tier = SIZE_TIER[size];
  const branches = 3 + tier * 2; // 3 / 5 / 7
  const spread = biasSpread(bias);

  const cx = w / 2;
  const top = h * 0.16;
  const midY = h * 0.52;
  const leafY = h * 0.86;
  const laneSpan = (w * 0.82) * spread;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const focal: Node = { x: cx, y: top, r: 6, weight: 1, step: 0, focal: true };
  nodes.push(focal);

  let stepCounter = 1;
  for (let b = 0; b < branches; b++) {
    const t = b / (branches - 1);
    const bx = cx - laneSpan / 2 + t * laneSpan;
    const branchNode: Node = {
      x: bx,
      y: midY,
      r: 3.6,
      weight: 1,
      step: stepCounter,
    };
    nodes.push(branchNode);
    edges.push({ from: focal, to: branchNode, weight: 1, step: stepCounter });
    stepCounter += 1;

    // One leaf per branch, sitting directly below the branch node — keeps
    // every branch a clean vertical drop and avoids leaf-fan crossings.
    const leafNode: Node = {
      x: bx,
      y: leafY,
      r: 2.8,
      weight: 0.85,
      step: stepCounter,
    };
    nodes.push(leafNode);
    edges.push({ from: branchNode, to: leafNode, weight: 0.85, step: stepCounter });
    stepCounter += 1;
  }

  return { nodes, edges, focalIndex: 0 };
}

function buildInduction(w: number, h: number, size: ReasoningSize, bias: NetworkBias): Plan {
  // Even row of observations at the bottom; every observation connects to the
  // focal with a straight ray. No vertical jitter — the row is the order.
  const tier = SIZE_TIER[size];
  const obsCount = 6 + tier * 2; // 6 / 8 / 10
  const spread = biasSpread(bias);

  const cx = w / 2;
  const top = h * 0.16;
  const baseline = h * 0.86;
  const laneSpan = (w * 0.84) * spread;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const focal: Node = { x: cx, y: top, r: 6, weight: 1, step: obsCount + 1, focal: true };

  // Observations animate in first; principle commits last.
  for (let i = 0; i < obsCount; i++) {
    const t = i / (obsCount - 1);
    const ox = cx - laneSpan / 2 + t * laneSpan;
    const obs: Node = {
      x: ox,
      y: baseline,
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

function buildFreeform(w: number, h: number, size: ReasoningSize, bias: NetworkBias): Plan {
  // Free-form constellation — focal at top, nodes scattered on an organic
  // arc with mixed connections. No rigid lanes or chains: the shape says
  // "the model picks its own structure". Uses a deterministic pseudo-jitter
  // so the animation reads stable across re-renders for the same params.
  void bias;
  const tier = SIZE_TIER[size];
  const count = 6 + tier * 2; // 6 / 8 / 10
  const spread = biasSpread(bias);

  const cx = w / 2;
  const top = h * 0.16;
  const bottom = h * 0.9;
  const laneSpan = (w * 0.78) * spread;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const focal: Node = { x: cx, y: top, r: 6, weight: 1, step: 0, focal: true };
  nodes.push(focal);

  // Place satellite nodes along a soft arc — deterministic offsets give the
  // constellation an organic, hand-drawn feel without being random per frame.
  const placed: Node[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const baseX = cx - laneSpan / 2 + t * laneSpan;
    const baseY = top + (bottom - top) * (0.32 + 0.6 * t);
    const jitterX = Math.sin(i * 2.39) * 24;
    const jitterY = Math.cos(i * 1.71) * 18;
    const node: Node = {
      x: baseX + jitterX,
      y: baseY + jitterY,
      r: 3.2,
      weight: 0.85,
      step: i + 1,
    };
    nodes.push(node);
    placed.push(node);
    // Each satellite connects back to the focal AND to one earlier sibling
    // (when available), producing a web rather than a single chain.
    edges.push({ from: focal, to: node, weight: 0.6, step: i + 1 });
    if (i > 0) {
      const partner = placed[Math.max(0, i - 1 - (i % 2))];
      edges.push({ from: partner, to: node, weight: 0.45, step: i + 1 });
    }
  }

  return { nodes, edges, focalIndex: 0 };
}

function buildPlan(
  mode: ThinkingStyle,
  size: ReasoningSize,
  bias: NetworkBias,
  w: number,
  h: number,
): Plan {
  switch (mode) {
    case 'freeform':
      return buildFreeform(w, h, size, bias);
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
/** Cool neutral for non-focal nodes / edges. The whole canvas sits on this
 *  tone so the resource accent reads as a true burst against the base. */
const NEUTRAL = '#94a3b8';

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

      const focal = plan.nodes[plan.focalIndex];

      // Monochromatic base + accent burst at the focal: non-focal nodes
      // and edges render in a cool neutral, the focal node + halo + the
      // edges that touch it carry the resource accent so the eye reads
      // "the chosen resource is anchoring this reasoning".
      const touchesFocal = (e: Edge) => e.from === focal || e.to === focal;

      // Pre-create all elements at zero opacity so the appear transition is uniform.
      const edgeSel = edgeLayer
        .selectAll('path')
        .data(plan.edges)
        .enter()
        .append('path')
        .attr('d', (e) => edgePath(e))
        .attr('fill', 'none')
        .attr('stroke', (e) => (touchesFocal(e) ? accent : NEUTRAL))
        .attr('stroke-width', (e) => 0.6 + e.weight * 0.45)
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
        .attr('fill', (n) => (n.focal ? accent : NEUTRAL))
        .attr('opacity', 0);

      // Halo for the focal node — only this element pulses in colour.
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

        // Non-focal nodes are quieter than the focal — never reach full
        // opacity so the focal stays visually dominant.
        nodeSel
          .filter((n) => n.step === s)
          .transition()
          .delay(delay)
          .duration(STEP_DURATION)
          .ease(d3.easeCubicOut)
          .attr('r', (n) => n.r)
          .attr('opacity', (n) => (n.focal ? 0.95 : 0.35 + n.weight * 0.3));

        // Edges touching the focal carry more presence (the accent line);
        // background edges sit at a dim neutral so the structure reads
        // without the canvas feeling crowded.
        edgeSel
          .filter((e) => e.step === s)
          .attr('opacity', (e) => (touchesFocal(e) ? 0.45 + e.weight * 0.35 : 0.15 + e.weight * 0.2))
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
    </div>
  );
}

function edgePath(e: Edge): string {
  return `M${e.from.x},${e.from.y} L${e.to.x},${e.to.y}`;
}
