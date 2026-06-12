#!/usr/bin/env node
/**
 * Proposition Classification Benchmark
 *
 * Extracts propositions + embeddings from .meridians packages in public/works/,
 * runs the classification algorithm, and prints per-work distributions.
 *
 * Usage: node scripts/classify-propositions.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKS_DIR = path.join(__dirname, '..', 'public', 'works');
const DIMS = 1536;
const TOP_K = 5;

// ── Helpers ─────────────────────────────────────────────────────────────────

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ── Load .meridians package ───────────────────────────────────────────────────

async function loadPackage(filePath) {
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);

  // Parse narrative
  const narrativeFile = zip.file('narrative.json');
  if (!narrativeFile) throw new Error(`No narrative.json in ${filePath}`);
  const narrative = JSON.parse(await narrativeFile.async('string'));

  // Load embeddings into a Map<string, Float32Array>
  const embeddings = new Map();
  const embFolder = zip.folder('embeddings');
  if (embFolder) {
    const files = Object.values(embFolder.files).filter(f => !f.dir && f.name.endsWith('.bin'));
    for (const file of files) {
      const fileName = file.name.split('/').pop();
      const embId = fileName.replace('.bin', '');
      const buffer = await file.async('arraybuffer');
      embeddings.set(embId, new Float32Array(buffer));
    }
  }

  return { narrative, embeddings };
}

// ── Resolve timeline keys ───────────────────────────────────────────────────

function getRootBranchId(n) {
  const root = Object.values(n.branches || {}).find(b => b.parentBranchId === null);
  return root?.id ?? null;
}

function resolveEntrySequence(branches, branchId) {
  const branch = branches[branchId];
  if (!branch) return [];
  if (!branch.parentBranchId) return branch.entryIds;
  const parentSeq = resolveEntrySequence(branches, branch.parentBranchId);
  if (branch.forkEntryId) {
    const forkIdx = parentSeq.indexOf(branch.forkEntryId);
    if (forkIdx >= 0) return [...parentSeq.slice(0, forkIdx + 1), ...branch.entryIds];
  }
  return [...parentSeq, ...branch.entryIds];
}

function getResolvedKeys(narrative) {
  const branchId = getRootBranchId(narrative);
  if (branchId) return resolveEntrySequence(narrative.branches, branchId);
  return [...Object.keys(narrative.scenes || {}), ...Object.keys(narrative.worldBuilds || {})];
}

// ── Resolve embedding vector ────────────────────────────────────────────────

function resolveEmbedding(ref, embeddingsMap) {
  if (!ref) return null;
  if (Array.isArray(ref)) return ref.length === DIMS ? new Float32Array(ref) : null;
  if (typeof ref === 'string') return embeddingsMap.get(ref) ?? null;
  return null;
}

// ── Classification (mirrors proposition-classify.ts) ────────────────────────

async function classify(narrative, resolvedKeys, embeddingsMap) {
  // 1. Extract propositions in timeline order
  const entries = [];
  let sceneOrder = 0;

  for (const key of resolvedKeys) {
    const entry = narrative.scenes?.[key];
    if (!entry) { continue; }
    const planVersions = entry.planVersions;
    if (!planVersions || planVersions.length === 0) { sceneOrder++; continue; }
    const plan = planVersions[planVersions.length - 1].plan;
    if (!plan?.beats) { sceneOrder++; continue; }

    for (let bi = 0; bi < plan.beats.length; bi++) {
      const beat = plan.beats[bi];
      if (!beat.propositions) continue;
      for (let pi = 0; pi < beat.propositions.length; pi++) {
        entries.push({ sceneId: entry.id, sceneOrder, beatIndex: bi, propIndex: pi });
      }
    }
    sceneOrder++;
  }

  const n = entries.length;
  const totalScenes = sceneOrder;

  if (n === 0) return null;

  // 2. Resolve embeddings
  const vectors = new Float32Array(n * DIMS);
  const hasEmb = new Uint8Array(n);
  let embCount = 0;

  for (let i = 0; i < n; i++) {
    const e = entries[i];
    const scene = narrative.scenes[e.sceneId];
    const plan = scene.planVersions[scene.planVersions.length - 1].plan;
    const ref = plan.beats[e.beatIndex].propositions[e.propIndex].embedding;
    const vec = resolveEmbedding(ref, embeddingsMap);
    if (!vec) continue;
    hasEmb[i] = 1;
    embCount++;
    vectors.set(vec, i * DIMS);
  }

  console.log(`  Propositions: ${n}, Embeddings resolved: ${embCount}, Scenes: ${totalScenes}`);

  // 3. Compute full cosine similarity matrix via TensorFlow.js matMul
  const tf = await import('@tensorflow/tfjs');
  let simData;
  {
    const mat = tf.tensor2d(vectors, [n, DIMS]);
    const norms = mat.norm('euclidean', 1, true);
    const epsilon = tf.scalar(1e-8);
    const normed = mat.div(norms.add(epsilon));
    const sim = tf.matMul(normed, normed, false, true);
    simData = new Float32Array(await sim.data());
    sim.dispose(); normed.dispose(); epsilon.dispose(); norms.dispose(); mat.dispose();
  }

  // 4. Extract top-k backward/forward with distance-weighted selection
  const sceneOrders = entries.map(e => e.sceneOrder);
  const backward = new Float64Array(n);
  const forward = new Float64Array(n);
  const backReach = new Float64Array(n);
  const fwdReach = new Float64Array(n);

  const topkScores = new Float64Array(TOP_K);
  const topkIdxs = new Int32Array(TOP_K);

  for (let i = 0; i < n; i++) {
    if (!hasEmb[i]) continue;
    const rowOffset = i * n;
    const sceneI = sceneOrders[i];

    for (let dir = 0; dir < 2; dir++) {
      const startJ = dir === 0 ? 0 : i + 1;
      const endJ = dir === 0 ? i : n;
      if (startJ >= endJ) continue;

      let filled = 0;
      let minIdx = 0;

      for (let j = startJ; j < endJ; j++) {
        if (!hasEmb[j]) continue;
        const score = simData[rowOffset + j];

        if (filled < TOP_K) {
          topkScores[filled] = score;
          topkIdxs[filled] = j;
          filled++;
          if (filled === TOP_K) {
            minIdx = 0;
            for (let m = 1; m < TOP_K; m++) {
              if (topkScores[m] < topkScores[minIdx]) minIdx = m;
            }
          }
        } else if (score > topkScores[minIdx]) {
          topkScores[minIdx] = score;
          topkIdxs[minIdx] = j;
          minIdx = 0;
          for (let m = 1; m < TOP_K; m++) {
            if (topkScores[m] < topkScores[minIdx]) minIdx = m;
          }
        }
      }

      if (filled === 0) continue;

      // Hybrid score: 0.5 * max + 0.5 * mean_topk (matches original algorithm)
      let maxSim = topkScores[0];
      let sum = topkScores[0];
      for (let m = 1; m < filled; m++) {
        sum += topkScores[m];
        if (topkScores[m] > maxSim) maxSim = topkScores[m];
      }
      const strength = 0.5 * maxSim + 0.5 * (sum / filled);

      const dists = [];
      for (let m = 0; m < filled; m++) {
        dists.push(Math.abs(sceneOrders[topkIdxs[m]] - sceneI));
      }

      dists.sort((a, b) => a - b);
      const reach = dists.length % 2 === 1
        ? dists[Math.floor(dists.length / 2)]
        : (dists[dists.length / 2 - 1] + dists[dists.length / 2]) / 2;

      if (dir === 0) { backward[i] = strength; backReach[i] = reach; }
      else { forward[i] = strength; fwdReach[i] = reach; }
    }
  }

  // 5. Score distributions for analysis
  const validBackward = Array.from(backward).filter((_, i) => i > 0 && backward[i] > 0);
  const validForward = Array.from(forward).filter((_, i) => i < n - 1 && forward[i] > 0);

  const medB = validBackward.length > 0 ? percentile(validBackward, 0.5) : 0;
  const p90B = validBackward.length > 0 ? percentile(validBackward, 0.9) : 0;
  const medF = validForward.length > 0 ? percentile(validForward, 0.5) : 0;
  const p90F = validForward.length > 0 ? percentile(validForward, 0.9) : 0;

  // 6. Classify with multiple strategies for comparison
  function classifyWith(thB, thF, label) {
    const counts = { Anchor: 0, Seed: 0, Close: 0, Texture: 0 };
    for (let i = 0; i < n; i++) {
      const hiB = backward[i] >= thB;
      const hiF = forward[i] >= thF;
      if (hiB && hiF) counts.Anchor++;
      else if (!hiB && hiF) counts.Seed++;
      else if (hiB && !hiF) counts.Close++;
      else counts.Texture++;
    }
    return { label, thB, thF, counts };
  }

  // Sweep percentile and absolute thresholds on the ORIGINAL algorithm's raw cosine scores
  const strategies = [
    classifyWith(percentile(validBackward, 0.60), percentile(validForward, 0.60), 'p60 (original)'),
    classifyWith(percentile(validBackward, 0.65), percentile(validForward, 0.65), 'p65'),
    classifyWith(percentile(validBackward, 0.70), percentile(validForward, 0.70), 'p70'),
    classifyWith(percentile(validBackward, 0.75), percentile(validForward, 0.75), 'p75'),
    classifyWith(0.60, 0.60, 'abs-0.60'),
    classifyWith(0.65, 0.65, 'abs-0.65'),
    classifyWith(0.70, 0.70, 'abs-0.70'),
    classifyWith(0.75, 0.75, 'abs-0.75'),
    classifyWith(0.80, 0.80, 'abs-0.80'),
  ];

  return {
    total: n,
    totalScenes,
    strategies,
    scoreStats: {
      backward: { min: Math.min(...validBackward), med: medB, p90: p90B, max: Math.max(...validBackward) },
      forward:  { min: Math.min(...validForward), med: medF, p90: p90F, max: Math.max(...validForward) },
    },
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const files = fs.readdirSync(WORKS_DIR).filter(f => f.endsWith('.meridians'));
  console.log(`Found ${files.length} works\n`);

  const results = [];

  for (const file of files) {
    const name = file.replace('.meridians', '');
    console.log(`─── ${name} ───`);
    const t0 = performance.now();

    const { narrative, embeddings } = await loadPackage(path.join(WORKS_DIR, file));
    const resolvedKeys = getResolvedKeys(narrative);

    const result = await classify(narrative, resolvedKeys, embeddings);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

    if (!result) {
      console.log(`  No propositions found\n`);
      continue;
    }

    results.push({ name, ...result });
    console.log(`  Classified in ${elapsed}s\n`);
  }

  // ── Print score distributions ────────────────────────────────────────────
  console.log('\nSCORE DISTRIBUTIONS (normalized distance-weighted)');
  console.log('─'.repeat(90));

  for (const r of results) {
    console.log(`  ${r.name} (${r.total} props, ${r.totalScenes} scenes)`);
    console.log(`    Back:  min=${r.scoreStats.backward.min.toFixed(3)} med=${r.scoreStats.backward.med.toFixed(3)} p90=${r.scoreStats.backward.p90.toFixed(3)} max=${r.scoreStats.backward.max.toFixed(3)}`);
    console.log(`    Fwd:   min=${r.scoreStats.forward.min.toFixed(3)} med=${r.scoreStats.forward.med.toFixed(3)} p90=${r.scoreStats.forward.p90.toFixed(3)} max=${r.scoreStats.forward.max.toFixed(3)}`);
  }

  // ── Print strategy comparison ──────────────────────────────────────────
  const categories = ['Anchor', 'Seed', 'Close', 'Texture'];
  const strategyNames = results[0]?.strategies.map(s => s.label) ?? [];

  for (const stratName of strategyNames) {
    console.log(`\n═══ Strategy: ${stratName} ═══`);

    const nameWidth = 35;
    const colWidth = 10;
    let header = 'Work'.padEnd(nameWidth);
    for (const cat of categories) header += cat.padStart(colWidth);
    console.log(header);
    console.log('─'.repeat(nameWidth + colWidth * 4));

    for (const r of results) {
      const s = r.strategies.find(s => s.label === stratName);
      if (!s) continue;
      let row = r.name.slice(0, nameWidth - 1).padEnd(nameWidth);
      for (const cat of categories) {
        const pct = ((s.counts[cat] / r.total) * 100).toFixed(1);
        row += `${pct}%`.padStart(colWidth);
      }
      console.log(row);
    }

    // Compute variance across works for this strategy — lower = more uniform (bad)
    const catVariances = categories.map(cat => {
      const pcts = results.map(r => {
        const s = r.strategies.find(s => s.label === stratName);
        return s ? (s.counts[cat] / r.total) * 100 : 0;
      });
      const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;
      const variance = pcts.reduce((a, p) => a + (p - mean) ** 2, 0) / pcts.length;
      return { cat, mean, variance, std: Math.sqrt(variance) };
    });
    const totalVariance = catVariances.reduce((a, c) => a + c.variance, 0);
    console.log(`  Σ variance: ${totalVariance.toFixed(2)}  (higher = more differentiation)`);
    for (const cv of catVariances) {
      console.log(`    ${cv.cat.padEnd(8)} mean=${cv.mean.toFixed(1)}% std=${cv.std.toFixed(1)}%`);
    }
  }
}

main().catch(console.error);
