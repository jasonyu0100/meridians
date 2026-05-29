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
  return 0.06 + gamma * 0.42; // floor 0.06 → ceiling 0.48 — subtle by design
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

// ── Zoom config (shared across all canvas graph views) ───────────────────

/** Pan/zoom scale bounds for every canvas graph view. Lower bound is
 *  generous enough to fit WorldGraph's wider canvases; upper bound is
 *  the d3 ceiling. Unifying the extent across views means the same
 *  gesture produces the same effect on every graph. */
export const GRAPH_ZOOM_EXTENT: [number, number] = [0.2, 4];

/** Initial scale on first build of a graph. Slightly zoomed-out so the
 *  layout has room to breathe before the user starts panning. Pair with
 *  a centring translate of (width/2, height/2). */
export const GRAPH_INITIAL_SCALE = 0.9;

// ── Focus opacity (shared across all canvas graph views) ─────────────────
//
// Every graph view dims edges AND nodes by default and brightens the
// ones in (or touching) the "currently activated" set — WorldGraph
// uses the current scene's POV/participants/location/artifacts,
// KnowledgeGraphView uses sceneNodeIds in codex mode, ThreadGraphView
// uses threads with a delta at the current scene in threads mode,
// NetworkView uses nodes attributed at the current step. The visual
// contract is the same everywhere: structure stays visible at the dim
// baseline so the user can read the overall graph; the focal cluster
// pops at the active opacity.

/** Opacity for EDGES touching the currently activated node set. */
export const FOCUS_OPACITY_ACTIVE = 0.5;

/** Opacity for EDGES NOT touching the activated set — including the
 *  case where the set is empty (no activations at this step). Visible
 *  enough to read the network's general structure, dim enough that
 *  the active set is clearly the focal layer above it. */
export const FOCUS_OPACITY_DIM = 0.08;

/** Opacity for NODES in the currently activated set. Full opacity —
 *  the focal layer reads as the canonical surface. */
export const FOCUS_NODE_OPACITY_ACTIVE = 1;

/** Opacity for NODES NOT in the activated set. Higher floor than the
 *  edge dim because a node carries more semantic weight than an edge —
 *  the user still needs to recognise who/what is there, just at a
 *  lower visual priority than the focal cluster. */
export const FOCUS_NODE_OPACITY_DIM = 0.5;

/** Multiplier applied to an edge's stroke-width when it's NOT touching
 *  the activated set. Pairs with the opacity dim — thinner AND fainter
 *  inactive edges read as background structure, thicker AND brighter
 *  active edges read as the focal layer. Active edges keep their base
 *  computed width (multiplier of 1). */
export const FOCUS_WIDTH_FACTOR_DIM = 0.5;
