// experience.ts — Experience scoring: an alternative to narrative (forces)
// scoring. Every scene is matched against EVERY scene in the narrative (all
// branches) by meaning — one cosine matrix over scene SUMMARY embeddings (same
// dynamic approach as proposition-classify). We search backwards AND forwards
// across all scenes regardless of branch, so a scene's experience reflects
// similar moments anywhere in the world view. Two raw readings per scene:
//
//   • Prior knowledge — BACKWARD. "Have we been here before?" similarity to
//                       scenes EARLIER in global generation order (own branch or
//                       others).
//   • Foresight       — FORWARD (Bayesian). similarity to LATER scenes.
//
// The cross-branch per-scene matrix is computed ONCE per narrative (cached by a
// cheap coverage key, exactly like the propositions provider) so every surface
// — scorecard, force timeline, panel, story card — reads identical numbers.
// Branch-level / per-arc aggregates are then derived CHEAPLY over the current
// branch's scenes (per-branch experience from overall, cross-branch scoring).

import type { NarrativeState, Scene } from '@/types/narrative';
import { resolveEntry, isScene } from '@/types/narrative';
import { resolveEntrySequence, resolveCanonBranchId } from '@/lib/forces/narrative-utils';
import { resolveEmbeddingsBatch } from '@/lib/search/embeddings';

/** Locate a scene on the branch tree — for navigating to an off-branch match.
 *  Prefers the canon branch, else the first branch whose timeline holds it. */
export function locateScene(
  narrative: NarrativeState,
  sceneId: string,
): { branchId: string; index: number } | null {
  const canonId = resolveCanonBranchId(narrative);
  const order = canonId ? [canonId, ...Object.keys(narrative.branches ?? {}).filter((b) => b !== canonId)] : Object.keys(narrative.branches ?? {});
  for (const branchId of order) {
    const seq = resolveEntrySequence(narrative.branches, branchId);
    const index = seq.indexOf(sceneId);
    if (index >= 0) return { branchId, index };
  }
  return null;
}

const DIMS = 1536;
const TOP_K = 5;
const MATCH_LIST = 6;
const MAX_POOL = 2500; // safety cap on the cross-branch scene pool (matrix is n²)

export interface ExpMatch {
  sceneId: string;
  keyIndex: number; // index into the CURRENT branch keys, or -1 if off-branch
  similarity: number; // 0–1
  ageMs: number | null;
  offBranch: boolean;
}

export interface SceneExperience {
  sceneId: string;
  arcId: string | null;
  keyIndex: number;
  prior: number;        // 0–100 backward (prior knowledge)
  posterior: number;    // 0–100 forward (foresight)
  /** 0–1 rehearsal value: how strongly this scene matches scenes simulated
   *  EARLIER (especially on OTHER branches — past rehearsals of this future).
   *  This is what accrues, additively, into branch Experience. */
  rehearsal: number;
  priorMatches: ExpMatch[];
  posteriorMatches: ExpMatch[];
}

export interface ArcExperience {
  arcId: string;
  count: number;
  prior: number;
  posterior: number;
}

export interface ExperienceReport {
  perScene: Map<string, SceneExperience>;
  branchPrior: number;
  /** ADDITIVE experience: the sum of every branch scene's rehearsal value, so
   *  deeper branches with more rehearsed moments accrue more. Drives the Level
   *  (see experienceLevel). Unbounded; grows with depth × rehearsal quality. */
  experienceXP: number;
  branchPosterior: number;
  perArc: Map<string, ArcExperience>;
  scoredScenes: number;
  scenesWithEmbedding: number; // refs present, narrative-wide
  scenesResolved: number;      // vectors that actually loaded, narrative-wide
  totalScenes: number;
}

// ── Cross-branch scene map (the expensive part) — cached per narrative ────────

interface RawMatch { sceneId: string; similarity: number; ageMs: number | null; }
interface SceneCore {
  sceneId: string;
  arcId: string | null;
  prior: number;
  posterior: number;
  priorRaw: RawMatch[];
  posteriorRaw: RawMatch[];
}
interface SceneMap {
  core: Map<string, SceneCore>;
  scenesWithEmbedding: number;
  scenesResolved: number;
  totalScenes: number;
}

/** Cheap coverage key — changes only when scenes or their summary-embedding refs
 *  change, so the heavy matrix is reused across surfaces and branch switches. */
function coverageKey(narrative: NarrativeState): string {
  let n = 0;
  let h = 0;
  for (const e of Object.values(narrative.scenes ?? {})) {
    if (!isScene(e as Scene)) continue;
    n++;
    const ref = (e as Scene).summaryEmbedding;
    // fold the ref id in so re-embedding (new id) busts the cache too
    if (ref) for (let i = 0; i < ref.length; i++) h = ((h << 5) - h + ref.charCodeAt(i)) | 0;
  }
  return `${narrative.id}:${n}:${h}`;
}

const sceneMapCache = new Map<string, Promise<SceneMap>>();

/** Drop cached experience maps — all narratives, or one by id. Call after
 *  embedding regen/clear so scores recompute against the fresh vectors. */
export function clearExperienceCache(narrativeId?: string): void {
  if (!narrativeId) { sceneMapCache.clear(); return; }
  for (const k of [...sceneMapCache.keys()]) if (k.startsWith(narrativeId + ':')) sceneMapCache.delete(k);
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const toStrength = (h: number) => Math.round(clamp01(h) * 100);

// ── Spiky recall discrimination ──────────────────────────────────────────────
// Each similarity is passed through a steep LOGISTIC centred at RAMP_MID, so the
// curve discriminates hard around the "is this really a match?" boundary:
//
//   ramp(0.95)=0.96  ramp(0.90)=0.90  ramp(0.85)=0.75  ramp(0.80)=0.50
//   ramp(0.75)=0.25  ramp(0.70)=0.10  ramp(0.65)=0.03
//
// A 0.90 match therefore counts ~9× a 0.70 one, and anything mediocre collapses
// toward zero. The recall strength is the MEAN of the TOP-K transformed
// similarities — five strong matches sway far more than one lone high match,
// and a cluster of 70–80s never reads as strong. Two knobs, one curve.
const RAMP_MID = 0.80; // similarity where a match becomes "strong" (logistic centre)
const RAMP_K = 22;     // steepness — higher = sharper top-end discrimination
const ramp = (s: number) => 1 / (1 + Math.exp(-RAMP_K * (s - RAMP_MID)));
const accent01 = (vals: number[]) => {
  if (!vals.length) return 0;
  const top = [...vals].sort((a, b) => b - a).slice(0, TOP_K);
  return top.reduce((acc, s) => acc + ramp(s), 0) / top.length;
};
const accent = (vals: number[]) => toStrength(accent01(vals));
// A prior match on ANOTHER branch is a past simulation of this moment — a
// rehearsal of the future — so it counts for more than an in-branch echo.
const CROSS_BRANCH_BONUS = 1.4;
const mean = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

async function computeSceneMap(narrative: NarrativeState): Promise<SceneMap> {
  const allScenes = Object.values(narrative.scenes ?? {}).filter((e): e is Scene => isScene(e as Scene));
  const totalScenes = allScenes.length;
  let pool = allScenes.filter((s) => !!s.summaryEmbedding);
  const scenesWithEmbedding = pool.length;
  if (scenesWithEmbedding < 2) {
    return { core: new Map(), scenesWithEmbedding, scenesResolved: 0, totalScenes };
  }
  if (pool.length > MAX_POOL) pool = pool.slice(pool.length - MAX_POOL);

  type Entry = { sceneId: string; arcId: string | null; ref: string; createdAtMs: number | null };
  const entries: Entry[] = pool.map((s) => {
    const t = s.createdAt ? Date.parse(s.createdAt) : NaN;
    return { sceneId: s.id, arcId: s.arcId ?? null, ref: s.summaryEmbedding!, createdAtMs: Number.isFinite(t) ? t : null };
  });

  const batch = await resolveEmbeddingsBatch(entries.map((e) => e.ref));
  const n = entries.length;
  const flat = new Float32Array(n * DIMS);
  const hasEmb = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const vec = batch.get(i);
    if (!vec || vec.length !== DIMS) continue;
    hasEmb[i] = 1;
    const off = i * DIMS;
    for (let d = 0; d < DIMS; d++) flat[off + d] = vec[d];
  }
  let scenesResolved = 0;
  for (let i = 0; i < n; i++) scenesResolved += hasEmb[i];

  const tf = await import('@tensorflow/tfjs');
  let sim: Float32Array;
  {
    const mat = tf.tensor2d(flat, [n, DIMS]);
    const norms = mat.norm('euclidean', 1, true);
    const eps = tf.scalar(1e-8);
    const normed = mat.div(norms.add(eps));
    const s = tf.matMul(normed, normed, false, true);
    sim = new Float32Array(await s.data());
    s.dispose(); normed.dispose(); eps.dispose(); norms.dispose(); mat.dispose();
  }

  const core = new Map<string, SceneCore>();
  for (let p = 0; p < n; p++) {
    const ep = entries[p];
    const back: number[] = [], fwd: number[] = [];
    const priorRaw: RawMatch[] = [], posteriorRaw: RawMatch[] = [];
    if (hasEmb[p]) {
      for (let q = 0; q < n; q++) {
        if (q === p || !hasEmb[q]) continue;
        const s = clamp01(sim[p * n + q]);
        const eq = entries[q];
        const ageMs = ep.createdAtMs != null && eq.createdAtMs != null ? ep.createdAtMs - eq.createdAtMs : null;
        if (q < p) { back.push(s); priorRaw.push({ sceneId: eq.sceneId, similarity: s, ageMs }); }
        else { fwd.push(s); posteriorRaw.push({ sceneId: eq.sceneId, similarity: s, ageMs }); }
      }
    }
    priorRaw.sort((a, b) => b.similarity - a.similarity);
    posteriorRaw.sort((a, b) => b.similarity - a.similarity);
    core.set(ep.sceneId, {
      sceneId: ep.sceneId,
      arcId: ep.arcId,
      prior: accent(back),
      posterior: accent(fwd),
      priorRaw: priorRaw.slice(0, MATCH_LIST),
      posteriorRaw: posteriorRaw.slice(0, MATCH_LIST),
    });
  }
  return { core, scenesWithEmbedding, scenesResolved, totalScenes };
}

export function auditExperienceAvailability(
  narrative: NarrativeState,
): { totalScenes: number; scenesWithEmbedding: number } {
  let totalScenes = 0;
  let scenesWithEmbedding = 0;
  for (const e of Object.values(narrative.scenes ?? {})) {
    if (!isScene(e as Scene)) continue;
    totalScenes++;
    if ((e as Scene).summaryEmbedding) scenesWithEmbedding++;
  }
  return { totalScenes, scenesWithEmbedding };
}

/**
 * The Experience report. The cross-branch per-scene matrix is computed once
 * (cached); aggregates here are PER BRANCH — over the scenes in `currentKeys`
 * (the active branch's resolved timeline). When `currentKeys` is empty the
 * aggregate spans the whole narrative.
 */
export async function computeExperienceReport(
  narrative: NarrativeState,
  currentKeys: string[] = [],
): Promise<ExperienceReport> {
  const ck = coverageKey(narrative);
  let promise = sceneMapCache.get(ck);
  if (!promise) { promise = computeSceneMap(narrative); sceneMapCache.set(ck, promise); }
  const { core, scenesWithEmbedding, scenesResolved, totalScenes } = await promise;

  // Branch context: which scenes belong to the current branch (for aggregation
  // + navigation). Empty keys ⇒ narrative-wide.
  const keyIndexOf = new Map<string, number>();
  currentKeys.forEach((k, i) => {
    const e = resolveEntry(narrative, k);
    if (e && isScene(e)) keyIndexOf.set((e as Scene).id, i);
  });
  const branchScoped = keyIndexOf.size > 0;

  const perScene = new Map<string, SceneExperience>();
  const decorate = (m: RawMatch): ExpMatch => ({
    sceneId: m.sceneId,
    similarity: m.similarity,
    ageMs: m.ageMs,
    keyIndex: keyIndexOf.get(m.sceneId) ?? -1,
    offBranch: !keyIndexOf.has(m.sceneId),
  });
  for (const [id, c] of core) {
    const priorMatches = c.priorRaw.map(decorate);
    // Rehearsal: prior similarity with OFF-BRANCH matches boosted — a scene
    // simulated earlier elsewhere that reflects this one is a rehearsed future.
    const rehearsal = accent01(priorMatches.map((m) => clamp01(m.similarity * (m.offBranch ? CROSS_BRANCH_BONUS : 1))));
    perScene.set(id, {
      sceneId: c.sceneId,
      arcId: c.arcId,
      keyIndex: keyIndexOf.get(id) ?? -1,
      prior: c.prior,
      posterior: c.posterior,
      rehearsal,
      priorMatches,
      posteriorMatches: c.posteriorRaw.map(decorate),
    });
  }

  // Aggregate over the current branch's scenes (or all, narrative-wide).
  const inScope = (r: SceneExperience) => !branchScoped || keyIndexOf.has(r.sceneId);
  const all = [...perScene.values()].filter(inScope);
  const scored = all.filter((r) => r.priorMatches.length > 0 || r.posteriorMatches.length > 0);
  const withPrior = all.filter((r) => r.priorMatches.length > 0);
  const withPost = all.filter((r) => r.posteriorMatches.length > 0);

  const perArc = new Map<string, ArcExperience>();
  const byArc = new Map<string, SceneExperience[]>();
  for (const r of scored) {
    const a = r.arcId ?? '—';
    (byArc.get(a) ?? byArc.set(a, []).get(a)!).push(r);
  }
  for (const [arcId, rows] of byArc) {
    perArc.set(arcId, {
      arcId,
      count: rows.length,
      prior: mean(rows.filter((r) => r.priorMatches.length > 0).map((r) => r.prior)),
      posterior: mean(rows.filter((r) => r.posteriorMatches.length > 0).map((r) => r.posterior)),
    });
  }

  const branchPrior = mean(withPrior.map((r) => r.prior));
  const experienceXP = all.reduce((s, r) => s + r.rehearsal, 0);
  return {
    perScene,
    branchPrior,
    experienceXP,
    branchPosterior: mean(withPost.map((r) => r.posterior)),
    perArc,
    scoredScenes: scored.length,
    scenesWithEmbedding,
    scenesResolved,
    totalScenes,
  };
}

// ── Levelling (XP-based, additive progression) ───────────────────────────────
// Bands are on accumulated Experience XP: a branch levels up by accruing more
// rehearsed moments (depth) and/or stronger rehearsals (quality). A shallow
// branch can't reach high levels — depth is required, as intended.
// Labels trace a fortune-teller's growing sight — from blindness behind the
// veil to the all-seeing Oracle: the deeper a branch has rehearsed its futures,
// the further its understanding pierces the unknown.
const LEVEL_BANDS = [
  { min: 0,   level: 1,  label: 'Veiled' },       // sight curtained; no futures rehearsed
  { min: 2,   level: 2,  label: 'Glimmer' },      // first faint flicker of foresight
  { min: 6,   level: 3,  label: 'Portent' },      // signs begin to surface
  { min: 12,  level: 4,  label: 'Augur' },         // reads the omens
  { min: 22,  level: 5,  label: 'Diviner' },       // draws meaning from them
  { min: 36,  level: 6,  label: 'Scryer' },        // gazes into the glass
  { min: 55,  level: 7,  label: 'Seer' },          // sees the patterns plainly
  { min: 80,  level: 8,  label: 'Clairvoyant' },   // clear sight across branches
  { min: 115, level: 9,  label: 'Prophet' },       // foretells with conviction
  { min: 160, level: 10, label: 'Oracle' },        // speaks the future as known
] as const;

export interface ExperienceLevel {
  level: number;
  label: string;
  progress: number;      // 0–1 toward the next level
  nextAt: number | null; // XP at which the next level unlocks
}

/** Map accumulated Experience XP to a progression level + label. */
export function experienceLevel(xp: number): ExperienceLevel {
  const x = Math.max(0, xp);
  let i = 0;
  for (let b = 0; b < LEVEL_BANDS.length; b++) if (x >= LEVEL_BANDS[b].min) i = b;
  const band = LEVEL_BANDS[i];
  const next = LEVEL_BANDS[i + 1] ?? null;
  const progress = next ? Math.max(0, Math.min(1, (x - band.min) / (next.min - band.min))) : 1;
  return { level: band.level, label: band.label, progress, nextAt: next ? next.min : null };
}

/** Narrative-wide Experience summary — for the dashboard StoryCard badge. */
export async function computeCanonExperience(
  narrative: NarrativeState,
): Promise<{ xp: number; level: number; prior: number; scored: number } | null> {
  const report = await computeExperienceReport(narrative);
  if (report.scoredScenes === 0) return null;
  return { xp: report.experienceXP, level: experienceLevel(report.experienceXP).level, prior: report.branchPrior, scored: report.scoredScenes };
}
