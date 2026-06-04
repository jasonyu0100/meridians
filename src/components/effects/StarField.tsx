"use client";
// StarField — canvas-rendered animated twinkling starfield background effect.

import { useEffect, useRef } from "react";

interface Star {
  x: number; // normalized [0,1]
  y: number;
  size: number;
  baseAlpha: number;
  twinkleSpeed: number;
  twinkleOffset: number;
  hue: number;
  sat: number;
  isBright: boolean;
}

interface Constellation {
  starIdx: number[];
  edges: [number, number][]; // local indices into starIdx
}

interface Firing {
  a: number; // star index
  b: number; // star index
  life: number; // ms elapsed
  maxLife: number; // ms total
  intensity: number; // 0..1
  cascaded: boolean;
}

function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function StarField({ neurons = true }: { neurons?: boolean } = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const starsRef = useRef<Star[]>([]);
  const constellationsRef = useRef<Constellation[]>([]);
  const firingsRef = useRef<Firing[]>([]);
  const neighborsRef = useRef<number[][]>([]);
  const fireCandidatesRef = useRef<number[]>([]);
  const startTimeRef = useRef<number>(0);
  const lastFireRef = useRef<number>(0);
  const nextFireDelayRef = useRef<number>(120);
  const dimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const lastTsRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const buildField = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      dimsRef.current = { w: rect.width, h: rect.height };

      const rand = seededRandom(91827);
      const area = rect.width * rect.height;
      const count = Math.min(280, Math.max(90, Math.floor(area / 7500)));

      const stars: Star[] = [];
      for (let i = 0; i < count; i++) {
        const u = rand();
        // Power-law size: many tiny, few bright (slightly smaller overall)
        const size = 0.35 + Math.pow(u, 4) * 2.0;
        const isBright = size > 1.6 || rand() < 0.025;

        let hue: number;
        let sat: number;
        const colorRoll = rand();
        if (isBright && colorRoll < 0.3) {
          hue = 45; // gold
          sat = 55;
        } else if (isBright && colorRoll < 0.5) {
          hue = 270; // violet
          sat = 40;
        } else {
          hue = 220; // cool starlight white
          sat = 6;
        }

        stars.push({
          x: rand(),
          y: rand(),
          size,
          baseAlpha: 0.2 + rand() * 0.45,
          twinkleSpeed: 0.0006 + rand() * 0.002,
          twinkleOffset: rand() * Math.PI * 2,
          hue,
          sat,
          isBright,
        });
      }
      starsRef.current = stars;

      // Build constellations: fewer, sparser clusters
      const constellations: Constellation[] = [];
      const used = new Set<number>();
      const clusterCount = 5;

      for (let c = 0; c < clusterCount; c++) {
        let seedIdx = -1;
        for (let attempt = 0; attempt < 40; attempt++) {
          const idx = Math.floor(rand() * stars.length);
          if (!used.has(idx) && stars[idx].size > 0.9) {
            seedIdx = idx;
            break;
          }
        }
        if (seedIdx < 0) break;

        const cluster = [seedIdx];
        used.add(seedIdx);
        const targetSize = 4 + Math.floor(rand() * 4); // 4..7

        for (let k = 0; k < targetSize - 1; k++) {
          const last = cluster[cluster.length - 1];
          const lastStar = stars[last];
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let j = 0; j < stars.length; j++) {
            if (used.has(j)) continue;
            const dx = stars[j].x - lastStar.x;
            const dy = stars[j].y - lastStar.y;
            const d = dx * dx + dy * dy;
            if (d < bestDist && d < 0.025 && d > 0.0006) {
              bestDist = d;
              bestIdx = j;
            }
          }
          if (bestIdx < 0) break;
          cluster.push(bestIdx);
          used.add(bestIdx);
        }

        if (cluster.length < 3) continue;

        const edges: [number, number][] = [];
        for (let i = 0; i < cluster.length - 1; i++) {
          edges.push([i, i + 1]);
        }
        if (cluster.length >= 5 && rand() < 0.55) {
          const a = Math.floor(rand() * (cluster.length - 1));
          const b = Math.floor(rand() * cluster.length);
          if (
            a !== b &&
            !edges.some(
              (e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a),
            )
          ) {
            edges.push([a, b]);
          }
        }

        constellations.push({ starIdx: cluster, edges });
      }
      constellationsRef.current = constellations;

      // Precompute nearest neighbors for neuron-firing layer.
      // Bias toward larger stars so firings happen between visible nodes.
      const maxNeighbors = 6;
      const maxDistSq = 0.022;
      const neighbors: number[][] = [];
      for (let i = 0; i < stars.length; i++) {
        const si = stars[i];
        const candidates: { idx: number; d: number }[] = [];
        for (let j = 0; j < stars.length; j++) {
          if (j === i) continue;
          const dx = stars[j].x - si.x;
          const dy = stars[j].y - si.y;
          const d = dx * dx + dy * dy;
          if (d < maxDistSq && d > 0.00005) {
            candidates.push({ idx: j, d });
          }
        }
        candidates.sort((a, b) => a.d - b.d);
        neighbors.push(candidates.slice(0, maxNeighbors).map((c) => c.idx));
      }
      neighborsRef.current = neighbors;

      // Stars eligible to seed a firing — must have at least one neighbor and
      // some visible mass. Brighter stars are listed multiple times so they
      // fire more often, which makes the network feel anchored to "hubs".
      const candidates: number[] = [];
      for (let i = 0; i < stars.length; i++) {
        if (neighbors[i].length === 0) continue;
        const weight = stars[i].size > 1.4 ? 4 : stars[i].size > 0.9 ? 2 : 1;
        for (let k = 0; k < weight; k++) candidates.push(i);
      }
      fireCandidatesRef.current = candidates;

      firingsRef.current = [];
      lastFireRef.current = 0;
      nextFireDelayRef.current = 80;
    };

    buildField();
    window.addEventListener("resize", buildField);

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const t = timestamp - startTimeRef.current;
      const delta = lastTsRef.current ? timestamp - lastTsRef.current : 16;
      lastTsRef.current = timestamp;

      const { w, h } = dimsRef.current;
      ctx.clearRect(0, 0, w, h);

      const stars = starsRef.current;
      const constellations = constellationsRef.current;

      // Constellation lines (under stars) — much fainter
      ctx.lineWidth = 0.4;
      for (const con of constellations) {
        const pulse = 0.5 + 0.3 * Math.sin(t * 0.0004 + con.starIdx[0]);
        ctx.strokeStyle = `rgba(196, 181, 253, ${0.04 * pulse})`;
        for (const [a, b] of con.edges) {
          const sa = stars[con.starIdx[a]];
          const sb = stars[con.starIdx[b]];
          ctx.beginPath();
          ctx.moveTo(sa.x * w, sa.y * h);
          ctx.lineTo(sb.x * w, sb.y * h);
          ctx.stroke();
        }
      }

      // Neuron firings — rapid transient links between nearby stars.
      // Skipped entirely when `neurons` is false (e.g. on the paper page where
      // the rapid motion competes with reading).
      const neighbors = neighborsRef.current;
      const candidates = fireCandidatesRef.current;
      const firings = firingsRef.current;
      const MAX_FIRINGS = 14;
      if (!neurons) firings.length = 0;

      const spawnFiring = (forcedA?: number, exclude?: number) => {
        if (candidates.length === 0 || firings.length >= MAX_FIRINGS) return;
        const a =
          forcedA !== undefined
            ? forcedA
            : candidates[Math.floor(Math.random() * candidates.length)];
        const nbs = neighbors[a];
        if (!nbs || nbs.length === 0) return;
        let pickFrom = nbs;
        if (exclude !== undefined) {
          const filtered = nbs.filter((n) => n !== exclude);
          if (filtered.length > 0) pickFrom = filtered;
        }
        const b = pickFrom[Math.floor(Math.random() * pickFrom.length)];
        firings.push({
          a,
          b,
          life: 0,
          maxLife: 280 + Math.random() * 380,
          intensity: 0.55 + Math.random() * 0.45,
          cascaded: false,
        });
      };

      if (neurons && timestamp - lastFireRef.current > nextFireDelayRef.current) {
        lastFireRef.current = timestamp;
        nextFireDelayRef.current = 50 + Math.random() * 180;
        const burst = Math.random() < 0.18 ? 2 + Math.floor(Math.random() * 2) : 1;
        for (let k = 0; k < burst; k++) spawnFiring();
      }

      ctx.lineCap = "round";
      for (let i = firings.length - 1; i >= 0; i--) {
        const f = firings[i];
        f.life += delta;
        if (f.life > f.maxLife) {
          firings.splice(i, 1);
          continue;
        }
        const sa = stars[f.a];
        const sb = stars[f.b];
        const ax = sa.x * w;
        const ay = sa.y * h;
        const bx = sb.x * w;
        const by = sb.y * h;
        const r = f.life / f.maxLife;
        // Envelope: sharp rise, slower fall — like a synaptic spike.
        const env = r < 0.18 ? r / 0.18 : Math.pow(1 - (r - 0.18) / 0.82, 1.4);
        const a = env * f.intensity;

        // Base line: faint cool-violet trail along the whole edge.
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = `rgba(180, 200, 255, ${0.18 * a})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();

        // Traveling pulse: a bright segment that rides from a → b.
        const head = Math.min(1, r * 1.35);
        const tail = Math.max(0, head - 0.32);
        const hx = ax + (bx - ax) * head;
        const hy = ay + (by - ay) * head;
        const tx = ax + (bx - ax) * tail;
        const ty = ay + (by - ay) * tail;
        const grd = ctx.createLinearGradient(tx, ty, hx, hy);
        grd.addColorStop(0, `rgba(165, 243, 252, 0)`);
        grd.addColorStop(0.6, `rgba(196, 220, 255, ${0.55 * a})`);
        grd.addColorStop(1, `rgba(255, 255, 255, ${0.95 * a})`);
        ctx.strokeStyle = grd;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.stroke();

        // Synaptic flash at the receiving end as the pulse arrives.
        if (head > 0.85) {
          const flash = Math.min(1, (head - 0.85) / 0.15) * a;
          const flashR = 6 + 4 * flash;
          const fg = ctx.createRadialGradient(bx, by, 0, bx, by, flashR);
          fg.addColorStop(0, `rgba(220, 240, 255, ${0.8 * flash})`);
          fg.addColorStop(1, `rgba(165, 243, 252, 0)`);
          ctx.fillStyle = fg;
          ctx.beginPath();
          ctx.arc(bx, by, flashR, 0, Math.PI * 2);
          ctx.fill();
        }

        // Cascade — once the pulse lands, sometimes b fires onward.
        if (!f.cascaded && r > 0.78) {
          f.cascaded = true;
          if (Math.random() < 0.45) spawnFiring(f.b, f.a);
        }
      }

      // Stars
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const twinkle =
          0.5 + 0.5 * Math.sin(t * s.twinkleSpeed + s.twinkleOffset);
        const alpha = s.baseAlpha * (0.4 + 0.6 * twinkle);
        const x = s.x * w;
        const y = s.y * h;

        if (s.isBright) {
          const haloR = s.size * 3.5;
          const grd = ctx.createRadialGradient(x, y, 0, x, y, haloR);
          grd.addColorStop(
            0,
            `hsla(${s.hue}, ${s.sat}%, 80%, ${alpha * 0.4})`,
          );
          grd.addColorStop(
            0.4,
            `hsla(${s.hue}, ${s.sat}%, 70%, ${alpha * 0.1})`,
          );
          grd.addColorStop(1, `hsla(${s.hue}, ${s.sat}%, 60%, 0)`);
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(x, y, haloR, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = `hsla(${s.hue}, ${s.sat}%, 90%, ${alpha * 0.85})`;
        ctx.beginPath();
        ctx.arc(x, y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", buildField);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [neurons]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}
