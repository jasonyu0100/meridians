"use client";

import type { ThinkingResource, ThinkingStyle } from "@/lib/ai";
import { ThinkingAnimation } from "./ThinkingAnimation";

// ── Force preference metadata ────────────────────────────────────────────────

export const THINKING_RESOURCE_META: Record<
  ThinkingResource,
  { label: string; color: string; description: string }
> = {
  freeform: {
    label: "Freeform",
    color: "#f5f5f5",
    description: "No bias. Full toolbox, LLM picks the mix.",
  },
  fate: {
    label: "Fate",
    color: "#ef4444",
    description: "Thread-driven. Favour resolutions and internal pressure.",
  },
  world: {
    label: "World",
    color: "#22c55e",
    description: "Entity-driven. Deepen existing characters and places.",
  },
  system: {
    label: "System",
    color: "#3b82f6",
    description: "Mechanic-driven. Surface and test how the world works.",
  },
  chaos: {
    label: "Chaos",
    color: "#a855f7",
    description: "Extreme creativity. Inject new entities and new fates.",
  },
};

const PREFERENCE_ORDER: ThinkingResource[] = [
  "freeform",
  "fate",
  "world",
  "system",
  "chaos",
];

// ── Force preference picker ──────────────────────────────────────────────────

type Props = {
  value: ThinkingResource;
  onChange: (pref: ThinkingResource) => void;
  label?: string;
};

export function ThinkingPicker({
  value,
  onChange,
  label = "Force",
}: Props) {
  const current = THINKING_RESOURCE_META[value];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-[10px] uppercase tracking-widest text-text-dim">
          {label}
        </label>
        <span className="text-[10px] text-text-dim/60">
          {current.description}
        </span>
      </div>
      <div className="flex gap-0.5 rounded-md bg-white/4 p-0.5">
        {PREFERENCE_ORDER.map((pref) => {
          const meta = THINKING_RESOURCE_META[pref];
          const selected = pref === value;
          return (
            <button
              key={pref}
              type="button"
              onClick={() => onChange(pref)}
              className="flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors"
              style={{
                background: selected ? "rgba(255,255,255,0.08)" : "transparent",
                color: selected ? meta.color : "rgba(255,255,255,0.5)",
              }}
              title={meta.description}
            >
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Reasoning-size picker ────────────────────────────────────────────────────

export type ReasoningSize = "small" | "medium" | "large";

const REASONING_SIZE_ORDER: ReasoningSize[] = ["small", "medium", "large"];

const REASONING_SIZE_META: Record<
  ReasoningSize,
  { label: string; description: string }
> = {
  small: {
    label: "Small",
    description: "Compact graph. Fewer reasoning nodes.",
  },
  medium: {
    label: "Medium",
    description: "Default graph density.",
  },
  large: {
    label: "Large",
    description: "Dense graph. More reasoning nodes.",
  },
};

export function ReasoningSizePicker({
  value,
  onChange,
  label = "Density",
}: {
  value: ReasoningSize;
  onChange: (size: ReasoningSize) => void;
  label?: string;
}) {
  const current = REASONING_SIZE_META[value];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-[10px] uppercase tracking-widest text-text-dim">
          {label}
        </label>
        <span className="text-[10px] text-text-dim/60">
          {current.description}
        </span>
      </div>
      <div className="flex gap-0.5 rounded-md bg-white/4 p-0.5">
        {REASONING_SIZE_ORDER.map((size) => {
          const meta = REASONING_SIZE_META[size];
          const selected = size === value;
          return (
            <button
              key={size}
              type="button"
              onClick={() => onChange(size)}
              className="flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors"
              style={{
                background: selected ? "rgba(255,255,255,0.08)" : "transparent",
                color: selected ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)",
              }}
              title={meta.description}
            >
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Reasoning-mode picker ────────────────────────────────────────────────────

const REASONING_MODE_ORDER: ThinkingStyle[] = [
  "freeform",
  "divergent",
  "deduction",
  "abduction",
  "induction",
];

const THINKING_STYLE_META: Record<
  ThinkingStyle,
  { label: string; color: string; description: string }
> = {
  freeform: {
    label: "Freeform",
    color: "#94a3b8",
    description: "Let the model think its own way — no imposed structure.",
  },
  divergent: {
    label: "Divergent",
    color: "#fbbf24",
    description: "What else could be true? Expands the space forward.",
  },
  deduction: {
    label: "Deduction",
    color: "#e5e7eb",
    description: "If the premise holds, what must follow? Forward necessity.",
  },
  abduction: {
    label: "Abduction",
    color: "#f472b6",
    description: "What prior best explains this outcome? Backward to a specific cause.",
  },
  induction: {
    label: "Induction",
    color: "#60a5fa",
    description: "What pattern explains these observations? Backward to a principle.",
  },
};

export function ThinkingStylePicker({
  value,
  onChange,
  label = "Mode",
}: {
  value: ThinkingStyle;
  onChange: (mode: ThinkingStyle) => void;
  label?: string;
}) {
  const current = THINKING_STYLE_META[value];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-[10px] uppercase tracking-widest text-text-dim">
          {label}
        </label>
        <span className="text-[10px] text-text-dim/60">
          {current.description}
        </span>
      </div>
      <div className="flex gap-0.5 rounded-md bg-white/4 p-0.5">
        {REASONING_MODE_ORDER.map((mode) => {
          const meta = THINKING_STYLE_META[mode];
          const selected = mode === value;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onChange(mode)}
              className="flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors"
              style={{
                background: selected ? "rgba(255,255,255,0.08)" : "transparent",
                color: selected ? meta.color : "rgba(255,255,255,0.5)",
              }}
              title={meta.description}
            >
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Network-bias picker ──────────────────────────────────────────────────────

export type NetworkBias = "inside" | "outside" | "neutral";

const NETWORK_BIAS_ORDER: NetworkBias[] = ["inside", "neutral", "outside"];

const NETWORK_BIAS_META: Record<
  NetworkBias,
  { label: string; color: string; description: string }
> = {
  inside: {
    label: "Inside",
    color: "#ef4444",
    description: "Conventional. Lean into HOT entities and threads — deepen the gravitational centres.",
  },
  neutral: {
    label: "Neutral",
    color: "#e5e7eb",
    description: "Dynamic. Use what the arc needs — balanced across hot and cold.",
  },
  outside: {
    label: "Outside",
    color: "#22d3ee",
    description: "Unique. Reach for COLD or FRESH dormant matter — break the dominant pattern.",
  },
};

export function NetworkBiasPicker({
  value,
  onChange,
  label = "Network",
}: {
  value: NetworkBias;
  onChange: (bias: NetworkBias) => void;
  label?: string;
}) {
  const current = NETWORK_BIAS_META[value];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-[10px] uppercase tracking-widest text-text-dim">
          {label}
        </label>
        <span className="text-[10px] text-text-dim/60">
          {current.description}
        </span>
      </div>
      <div className="flex gap-0.5 rounded-md bg-white/4 p-0.5">
        {NETWORK_BIAS_ORDER.map((bias) => {
          const meta = NETWORK_BIAS_META[bias];
          const selected = bias === value;
          return (
            <button
              key={bias}
              type="button"
              onClick={() => onChange(bias)}
              className="flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors"
              style={{
                background: selected ? "rgba(255,255,255,0.08)" : "transparent",
                color: selected ? meta.color : "rgba(255,255,255,0.5)",
              }}
              title={meta.description}
            >
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Thinking settings wrapper ────────────────────────────────────────────────

/** Borderless dropdown row — label on the left, value-as-typography on the
 *  right. Native <select> sits on top transparently for accessibility +
 *  platform-native menus. Hover lifts the row with a subtle wash; no card
 *  chrome, so it sits seamlessly on whatever surface contains it. */
function DropdownRow<T extends string>({
  label, value, options, onChange, valueColor,
}: {
  label: string;
  value: T;
  options: readonly { key: T; label: string; description?: string }[];
  onChange: (v: T) => void;
  /** Optional colour for the displayed value — defaults to near-white. */
  valueColor?: string;
}) {
  const current = options.find((o) => o.key === value) ?? options[0];
  return (
    <label className="group relative flex items-center gap-3 py-1.5 px-1.5 -mx-1.5 rounded-md hover:bg-white/[0.035] transition-colors cursor-pointer">
      <span className="w-16 shrink-0 text-[9px] uppercase tracking-[0.18em] text-text-dim/60 font-mono">
        {label}
      </span>
      <div className="relative flex-1 flex items-center justify-between min-w-0">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={label}
        >
          {options.map((opt) => (
            <option
              key={opt.key}
              value={opt.key}
              className="bg-bg-panel text-text-primary"
              title={opt.description}
            >
              {opt.label}
            </option>
          ))}
        </select>
        <span
          className="text-[12px] font-medium tracking-tight pointer-events-none truncate transition-colors"
          style={{ color: valueColor ?? 'rgba(255,255,255,0.92)' }}
        >
          {current.label}
        </span>
        <span
          className="ml-2 text-text-dim/30 text-[10px] pointer-events-none transition-all group-hover:text-text-dim/60 group-hover:translate-x-0.5"
          aria-hidden
        >
          ›
        </span>
      </div>
    </label>
  );
}

const STYLE_OPTS = [
  { key: 'freeform' as ThinkingStyle, label: 'Freeform', description: THINKING_STYLE_META.freeform.description },
  { key: 'divergent' as ThinkingStyle, label: 'Divergent', description: THINKING_STYLE_META.divergent.description },
  { key: 'deduction' as ThinkingStyle, label: 'Deduction', description: THINKING_STYLE_META.deduction.description },
  { key: 'abduction' as ThinkingStyle, label: 'Abduction', description: THINKING_STYLE_META.abduction.description },
  { key: 'induction' as ThinkingStyle, label: 'Induction', description: THINKING_STYLE_META.induction.description },
] as const;

const RESOURCE_OPTS = [
  { key: 'freeform' as ThinkingResource, label: 'Freeform', description: THINKING_RESOURCE_META.freeform.description },
  { key: 'fate' as ThinkingResource, label: 'Fate', description: THINKING_RESOURCE_META.fate.description },
  { key: 'world' as ThinkingResource, label: 'World', description: THINKING_RESOURCE_META.world.description },
  { key: 'system' as ThinkingResource, label: 'System', description: THINKING_RESOURCE_META.system.description },
  { key: 'chaos' as ThinkingResource, label: 'Chaos', description: THINKING_RESOURCE_META.chaos.description },
] as const;

const SIZE_OPTS = [
  { key: 'small' as ReasoningSize, label: 'Small', description: 'Compact graph. Fewer reasoning nodes.' },
  { key: 'medium' as ReasoningSize, label: 'Medium', description: 'Default graph density.' },
  { key: 'large' as ReasoningSize, label: 'Large', description: 'Dense graph. More reasoning nodes.' },
] as const;

const BIAS_OPTS = [
  { key: 'inside' as NetworkBias, label: 'Inside (conventional)', description: 'Lean into HOT entities — deepen the gravitational centres.' },
  { key: 'neutral' as NetworkBias, label: 'Neutral (dynamic)', description: 'Use what the arc needs — balanced across hot and cold.' },
  { key: 'outside' as NetworkBias, label: 'Outside (unique)', description: 'Reach for COLD or FRESH dormant matter — break the dominant pattern.' },
] as const;

/**
 * Groups the four thinking-related controls (mode, force, density, network bias)
 * under a single `THINKING` header with a live animation preview.
 *
 * Two layouts via `variant`:
 *   - 'compact' (default) — animation on the right, dropdowns on the left,
 *     wrapped in a subtle card. Used in settings modals and disclosures.
 *   - 'hero' — animation on top (full width), dropdowns below in a 2-column
 *     grid, no card chrome. Used as a primary surface (e.g. the extended-
 *     thinking launch view).
 */
export function ThinkingSettings({
  mode, onModeChange,
  force, onForceChange,
  size, onSizeChange,
  networkBias, onNetworkBiasChange,
  variant = 'compact',
}: {
  mode: ThinkingStyle;
  onModeChange: (m: ThinkingStyle) => void;
  force: ThinkingResource;
  onForceChange: (f: ThinkingResource) => void;
  /** Density preset (small/medium/large). Omit to hide the Density row —
   *  callers that want the model to size its own reasoning dynamically
   *  (e.g. maps) skip this knob. */
  size?: ReasoningSize;
  onSizeChange?: (s: ReasoningSize) => void;
  /** Network bias (inside/outside/neutral). Omit to hide the Network row. */
  networkBias?: NetworkBias;
  onNetworkBiasChange?: (b: NetworkBias) => void;
  variant?: 'compact' | 'hero';
}) {
  const modeMeta = THINKING_STYLE_META[mode];
  const forceMeta = THINKING_RESOURCE_META[force];
  const biasMeta = networkBias ? NETWORK_BIAS_META[networkBias] : null;
  // ThinkingAnimation needs *some* values to drive its visual rhythm;
  // fall back to defaults when the caller has opted out of those knobs.
  const animationSize: ReasoningSize = size ?? 'medium';
  const animationBias: NetworkBias = networkBias ?? 'neutral';

  // Shared dropdown rows — value-coloured per row, palette inherited from meta.
  // Labels renamed: "Style" (was Mode) — how thinking unfolds; "Resource"
  // (was Force) — what cohort the reasoning leans on. The internal type
  // names stay (ThinkingStyle / ThinkingResource) for backward compat.
  const rows = (
    <>
      <DropdownRow
        label="Style"
        value={mode}
        options={STYLE_OPTS}
        onChange={onModeChange}
        valueColor={modeMeta.color}
      />
      <DropdownRow
        label="Resource"
        value={force}
        options={RESOURCE_OPTS}
        onChange={onForceChange}
        valueColor={forceMeta.color}
      />
      {size !== undefined && onSizeChange && (
        <DropdownRow
          label="Density"
          value={size}
          options={SIZE_OPTS}
          onChange={onSizeChange}
        />
      )}
      {networkBias !== undefined && onNetworkBiasChange && biasMeta && (
        <DropdownRow
          label="Network"
          value={networkBias}
          options={BIAS_OPTS}
          onChange={onNetworkBiasChange}
          valueColor={biasMeta.color}
        />
      )}
    </>
  );

  if (variant === 'hero') {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex justify-center">
          <ThinkingAnimation
            key={`${mode}-${force}-${animationSize}-${animationBias}`}
            mode={mode}
            force={force}
            size={animationSize}
            networkBias={animationBias}
            width={420}
            height={260}
          />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 max-w-md mx-auto w-full">
          {rows}
        </div>
        <p className="text-[11px] text-text-dim/60 text-center max-w-md mx-auto leading-relaxed">
          {modeMeta.description}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/6 bg-white/2 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-text-dim/80 font-semibold">
          Thinking
        </div>
        <div className="text-[9px] text-text-dim/50 italic truncate ml-3">
          {modeMeta.description}
        </div>
      </div>
      {/* Animation on top, selectors underneath — keeps the visual
          reading-order primary and lets the controls span the full width
          without competing with the graph for horizontal space. */}
      <div className="flex justify-center">
        {/* key-based remount so every settings permutation plays a fresh
            animation from frame 0 — guarantees visibility of the change
            even mid-cycle. */}
        <ThinkingAnimation
          key={`${mode}-${force}-${animationSize}-${animationBias}`}
          mode={mode}
          force={force}
          size={animationSize}
          networkBias={animationBias}
          width={360}
          height={220}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {rows}
      </div>
    </div>
  );
}
