/**
 * Shared colour language for reasoning-graph nodes.
 *
 * Three force families carry their base hues, but every type has its
 * own distinct hue+value so they're easy to tell apart at a glance:
 *
 *   Fate force     red
 *   World force    emerald / green / lime (character / location / artifact)
 *   System force   indigo
 *   Reasoning      cool slate (neutral)
 *   Pattern        bright teal (positive reinforcement agent)
 *   Warning        orange (alert agent)
 *   Chaos          vibrant magenta (outside-force agent)
 *
 * Plan-only spine types (peak / valley / moment) are defined alongside
 * the reasoning types in `REASONING_NODE_COLORS_PLAN` so the same swatch
 * dictionary powers every reasoning-graph surface in the app.
 */

export type ReasoningNodePalette = {
  fill: string;
  stroke: string;
  text: string;
};

export const REASONING_NODE_COLORS: {
  fate: ReasoningNodePalette;
  character: ReasoningNodePalette;
  location: ReasoningNodePalette;
  artifact: ReasoningNodePalette;
  system: ReasoningNodePalette;
  reasoning: ReasoningNodePalette;
  pattern: ReasoningNodePalette;
  warning: ReasoningNodePalette;
  chaos: ReasoningNodePalette;
  conclusion: ReasoningNodePalette;
} = {
  // Fate — red (bright, alert)
  fate: { fill: "#b91c1c", stroke: "#f87171", text: "#fee2e2" },
  // World entities — three distinct green hues so they don't blur together
  character: { fill: "#059669", stroke: "#34d399", text: "#d1fae5" },  // emerald
  location: { fill: "#16a34a", stroke: "#86efac", text: "#dcfce7" },   // green
  artifact: { fill: "#65a30d", stroke: "#bef264", text: "#ecfccb" },   // lime (gold-tinged, "precious")
  // System — indigo (distinct from valley's sky blue)
  system: { fill: "#4338ca", stroke: "#818cf8", text: "#e0e7ff" },
  // Reasoning — cool slate (neutral)
  reasoning: { fill: "#475569", stroke: "#94a3b8", text: "#f1f5f9" },
  // Pattern — bright teal (positive reinforcement agent)
  pattern: { fill: "#0891b2", stroke: "#22d3ee", text: "#cffafe" },
  // Warning — orange (alert agent; replaces rose for clearer differentiation)
  warning: { fill: "#ea580c", stroke: "#fb923c", text: "#ffedd5" },
  // Chaos — vibrant magenta (outside-force agent; distinct from system indigo
  // and deep purples used elsewhere)
  chaos: { fill: "#be185d", stroke: "#f472b6", text: "#fce7f3" },
  // Conclusion — deep gold (terminal answer; reads as a destination, distinct
  // from every other hue in the palette so the eye finds it instantly)
  conclusion: { fill: "#a16207", stroke: "#fbbf24", text: "#fef3c7" },
};

/**
 * Extended palette that adds the plan-only spine types on top of the
 * reasoning-graph base.
 */
export const REASONING_NODE_COLORS_PLAN = {
  ...REASONING_NODE_COLORS,
  // Peak — amber (matches delivery-curve PEAK_COLOR; arc commits here)
  peak: { fill: "#d97706", stroke: "#fcd34d", text: "#fef3c7" },
  // Valley — sky blue (matches delivery-curve VALLEY_COLOR; arc pivots here)
  valley: { fill: "#2563eb", stroke: "#93c5fd", text: "#dbeafe" },
  // Moment — warm stone grey (plan-level beat; distinct from reasoning's cool slate)
  moment: { fill: "#57534e", stroke: "#a8a29e", text: "#f5f5f4" },
};

/** Fallback palette for unknown node types. */
export const REASONING_NODE_COLOR_UNKNOWN: ReasoningNodePalette = {
  fill: "#475569",
  stroke: "#94a3b8",
  text: "#f1f5f9",
};

/**
 * Phase Reasoning Graph (PRG) node palette. Distinct hue per type — and
 * deliberately distinct from the causal palette so the two graphs read
 * differently at a glance even though they share the dagre rendering.
 *
 *   Pattern      teal           — recurring configuration · currently-active
 *   Convention   warm taupe     — procedural default · currently-followed
 *   Attractor    saffron        — what's being aimed at · future-pointing
 *   Agent        deep emerald   — entity with stance · currently-driving
 *   Rule         indigo (matches causal's `system` since rules ARE system) · currently-binding
 *   Pressure     burnt sienna   — accumulated tension · accumulating-toward-discharge
 *   Landmark     deep violet    — discharged event with persistent influence · past-but-anchoring
 */
export const PHASE_NODE_COLORS: Record<
  "pattern" | "convention" | "attractor" | "agent" | "rule" | "pressure" | "landmark",
  ReasoningNodePalette
> = {
  pattern: { fill: "#0d9488", stroke: "#5eead4", text: "#ccfbf1" },
  convention: { fill: "#78716c", stroke: "#d6d3d1", text: "#f5f5f4" },
  attractor: { fill: "#ca8a04", stroke: "#fde047", text: "#fef9c3" },
  agent: { fill: "#047857", stroke: "#6ee7b7", text: "#d1fae5" },
  rule: { fill: "#4338ca", stroke: "#818cf8", text: "#e0e7ff" },
  pressure: { fill: "#9a3412", stroke: "#fb923c", text: "#ffedd5" },
  landmark: { fill: "#6d28d9", stroke: "#c4b5fd", text: "#ede9fe" },
};
