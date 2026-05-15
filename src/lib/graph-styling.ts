/**
 * Shared edge styling for d3 force graph views (NetworkView,
 * KnowledgeGraphView, ThreadGraphView, ThreadLogGraphView,
 * EntityWorldGraphView). Keeps the visual language consistent across the
 * canvas: light pairs stay legible (floor), heavy pairs read prominent
 * (ceiling), and gamma below 1 favours the high end so a handful of
 * dominant edges visibly stand out rather than getting washed out by
 * mid-weight noise.
 *
 * `t` is the normalised edge weight in [0, 1] — caller decides what "weight"
 * means: scenes that wired the pair (NetworkView), endpoint-degree average
 * (other views), or any other monotonic measure.
 */

export function edgeOpacityFor(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const gamma = Math.pow(clamped, 0.55);
  return 0.10 + gamma * 0.70; // floor 0.10 → ceiling 0.80
}

export function edgeWidthFor(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 0.6 + Math.pow(clamped, 0.7) * 3.4; // floor 0.6 → ceiling 4.0
}

/** Tuning for simulation cooldown — applied uniformly across canvas graph
 *  views. Lower alpha start + faster decay than d3 defaults; the simulation
 *  settles in ~1s instead of multi-second drift on every data change. */
export const SIM_ALPHA_START = 0.3;
export const SIM_ALPHA_DECAY = 0.04;
