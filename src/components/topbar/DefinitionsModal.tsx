"use client";
// DefinitionsModal — glossary of core concepts: archetypes, cube corners, forces, and entity types.

import type { ArchetypeKey } from "@/components/ArchetypeIcon";
import { ARCHETYPE_COLORS, ArchetypeIcon } from "@/components/ArchetypeIcon";
import { CubeCornerBadge } from "@/components/CubeCornerBadge";
import {
  IconBook,
  IconLineChart,
  IconLocationPin,
} from "@/components/icons/ContentIcons";
import { Modal, ModalBody, ModalHeader } from "@/components/Modal";
import { SHAPES as NARRATIVE_SHAPES } from "@/lib/forces/narrative-utils";
import { NARRATIVE_CUBE, type CubeCornerKey } from "@/types/narrative";
import { useState } from "react";

type Props = { onClose: () => void };

const tabs = [
  "Cube",
  "Beats",
  "Propositions",
  "Archetypes",
  "Shapes",
  "Scales",
  "Game theory",
] as const;
type Tab = (typeof tabs)[number];

const CUBE_CORNERS: CubeCornerKey[] = [
  "HHH",
  "HHL",
  "HLH",
  "HLL",
  "LHH",
  "LHL",
  "LLH",
  "LLL",
];

// ── Cube Tab ─────────────────────────────────────────────────────────────────

function CubeTab() {
  return (
    <div className="space-y-4">
      <div className="text-[10px] text-text-dim leading-relaxed">
        The <strong>narrative cube</strong> maps scenes into 3D force space.
        Each corner represents a distinct mode defined by high/low
        combinations of the three forces.
      </div>

      <div className="flex items-center gap-4 text-[9px] text-text-dim pb-2 border-b border-border/30">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-fate" />
          <span>Fate</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-world" />
          <span>World</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-system" />
          <span>System</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {CUBE_CORNERS.map((key) => {
          const corner = NARRATIVE_CUBE[key];
          return (
            <div
              key={key}
              className="bg-bg-elevated/50 rounded-lg p-3 border border-border/20"
            >
              <div className="flex items-center gap-2 mb-2">
                <CubeCornerBadge cornerKey={key} size="sm" />
                <div>
                  <div className="text-[11px] font-semibold text-text-primary">
                    {corner.name}
                  </div>
                  <div className="text-[8px] font-mono text-text-dim">
                    {key}
                  </div>
                </div>
              </div>
              <p className="text-[9px] text-text-secondary leading-relaxed">
                {corner.description}
              </p>
            </div>
          );
        })}
      </div>

      <div className="text-[9px] text-text-dim italic pt-2 border-t border-border/20">
        Cube corners guide scene generation via Markov chains and provide
        structural vocabulary for narrative rhythm.
      </div>
    </div>
  );
}

// ── Beats Tab ────────────────────────────────────────────────────────────────

const BEAT_FUNCTIONS = [
  {
    name: "breathe",
    color: "#6b7280",
    desc: "Pacing, atmosphere, sensory grounding, scene establishment",
  },
  {
    name: "inform",
    color: "#3b82f6",
    desc: "Knowledge delivery — character or reader learns something now",
  },
  {
    name: "advance",
    color: "#22c55e",
    desc: "Forward momentum — plot moves, goals pursued, tension rises",
  },
  {
    name: "bond",
    color: "#ec4899",
    desc: "Relationship shifts between characters",
  },
  {
    name: "turn",
    color: "#f59e0b",
    desc: "Scene pivots — revelation, reversal, interruption",
  },
  {
    name: "reveal",
    color: "#a855f7",
    desc: "Character interiority exposed — desires, fears, secrets surface",
  },
  {
    name: "shift",
    color: "#ef4444",
    desc: "POV character's perspective changes on situation or person",
  },
  {
    name: "expand",
    color: "#06b6d4",
    desc: "World-building — systems, rules, culture, or lore introduced",
  },
  {
    name: "foreshadow",
    color: "#84cc16",
    desc: "Future events or themes seeded subtly",
  },
  {
    name: "resolve",
    color: "#14b8a6",
    desc: "Local tension released — question answered, immediate conflict settled",
  },
];

const BEAT_MECHANISMS = [
  { name: "dialogue", icon: "💬", desc: "Characters speaking" },
  { name: "thought", icon: "💭", desc: "Internal monologue" },
  {
    name: "action",
    icon: "⚡",
    desc: "Physical movement, gesture, body in space",
  },
  {
    name: "environment",
    icon: "🌍",
    desc: "Setting, weather, arrivals, sensory details",
  },
  {
    name: "narration",
    icon: "📖",
    desc: "Narrator addresses reader, authorial commentary, rhetoric",
  },
  {
    name: "memory",
    icon: "⏪",
    desc: "Flashback, recollection, past event recalled",
  },
  {
    name: "document",
    icon: "📄",
    desc: "Letter, inscription, found text, in-world artifact",
  },
  {
    name: "comic",
    icon: "😄",
    desc: "Visual gag, physical comedy, absurd juxtaposition",
  },
];

function BeatsTab() {
  return (
    <div className="space-y-5">
      <div className="text-[10px] text-text-dim leading-relaxed">
        Beats are the atomic units of scene structure — individual moments that
        advance plot, reveal character, or build world.
      </div>

      <div>
        <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest mb-3 pb-1 border-b border-border/30">
          Beat Functions{" "}
          <span className="text-text-dim font-normal">
            (What the beat does)
          </span>
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {BEAT_FUNCTIONS.map((fn) => (
            <div key={fn.name} className="flex items-start gap-2 text-[10px]">
              <div
                className="w-2.5 h-2.5 rounded-full border-2 shrink-0 mt-1"
                style={{
                  borderColor: fn.color,
                  backgroundColor: fn.color + "33",
                }}
              />
              <div className="min-w-0">
                <div
                  className="font-medium uppercase text-[9px] tracking-wider"
                  style={{ color: fn.color }}
                >
                  {fn.name}
                </div>
                <div className="text-[9px] text-text-dim leading-snug">
                  {fn.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest mb-3 pb-1 border-b border-border/30">
          Beat Mechanisms{" "}
          <span className="text-text-dim font-normal">
            (How it&apos;s delivered)
          </span>
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {BEAT_MECHANISMS.map((mech) => (
            <div key={mech.name} className="flex items-start gap-2 text-[10px]">
              <div className="text-lg leading-none shrink-0">{mech.icon}</div>
              <div className="min-w-0">
                <div className="font-medium text-text-primary">{mech.name}</div>
                <div className="text-[9px] text-text-dim leading-snug">
                  {mech.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[9px] text-text-dim italic pt-2 border-t border-border/20">
        Each scene contains a sequence of beats. Beat profiles define authorial
        voice and pacing style.
      </div>
    </div>
  );
}

// ── Propositions Tab ────────────────────────────────────────────────────────

const PROPOSITION_BASES = [
  {
    name: "Anchor",
    color: "#6366f1",
    desc: "High backward + high forward — load-bearing in both directions. Removing it collapses the narrative above and below.",
  },
  {
    name: "Seed",
    color: "#10b981",
    desc: "Low backward + high forward — introduced without strong grounding, proves foundational later. Foreshadowing, Chekhov's gun.",
  },
  {
    name: "Close",
    color: "#f59e0b",
    desc: "High backward + low forward — end of a chain. Deeply earned but doesn't seed further. Resolution beats live here.",
  },
  {
    name: "Texture",
    color: "#6b7280",
    desc: "Low backward + low forward — floats free of the proof graph. Atmosphere, world-color. Not a failure — intentional structural choice.",
  },
];

const PROPOSITION_REACH_VARIANTS = [
  {
    label: "anchor",
    base: "Anchor",
    reach: "Local",
    color: "#6366f1",
    desc: "Load-bearing within a local arc. Immediate tension that resolves nearby.",
  },
  {
    label: "foundation",
    base: "Anchor",
    reach: "Global",
    color: "#4338ca",
    desc: "Connects across arcs — the thematic spine. References span dozens of scenes.",
  },
  {
    label: "seed",
    base: "Seed",
    reach: "Local",
    color: "#10b981",
    desc: "Pays off soon, within-arc foreshadowing. The Remembrall \u2192 Seeker next scene.",
  },
  {
    label: "foreshadow",
    base: "Seed",
    reach: "Global",
    color: "#047857",
    desc: "Pays off much later — cross-arc Chekhov's gun. Harry's scar \u2192 climax.",
  },
  {
    label: "close",
    base: "Close",
    reach: "Local",
    color: "#f59e0b",
    desc: "Resolves recent setups. Closes the immediate question within a few scenes.",
  },
  {
    label: "ending",
    base: "Close",
    reach: "Global",
    color: "#b45309",
    desc: 'Resolves something planted long ago. "Snape hated Harry\'s father" — 46 scenes back.',
  },
  {
    label: "texture",
    base: "Texture",
    reach: "Local",
    color: "#6b7280",
    desc: "Scene-level atmosphere. Grounds the reader in sensory detail.",
  },
  {
    label: "atmosphere",
    base: "Texture",
    reach: "Global",
    color: "#4b5563",
    desc: "Ambient world-color across time without structural function.",
  },
];

function PropositionsTab() {
  return (
    <div className="space-y-5">
      <div className="text-[10px] text-text-dim leading-relaxed">
        Propositions are atomic narrative claims — facts the reader must accept.
        Each is classified by <strong>structural role</strong> (how it connects
        to prior and future content) and <strong>temporal reach</strong> (local
        arc vs cross-arc connections). Classification uses cosine similarity
        over embeddings.
      </div>

      <div>
        <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest mb-3 pb-1 border-b border-border/30">
          Base Categories{" "}
          <span className="text-text-dim font-normal">
            (backward × forward activation)
          </span>
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {PROPOSITION_BASES.map((base) => (
            <div
              key={base.name}
              className="bg-bg-elevated/50 rounded-lg p-3 border border-border/20"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: base.color }}
                />
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: base.color }}
                >
                  {base.name}
                </span>
              </div>
              <p className="text-[9px] text-text-dim leading-snug">
                {base.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest mb-3 pb-1 border-b border-border/30">
          Local / Global Reach{" "}
          <span className="text-text-dim font-normal">
            (base × temporal reach)
          </span>
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {PROPOSITION_REACH_VARIANTS.map((p) => (
            <div
              key={`${p.base}-${p.reach}`}
              className="flex items-start gap-2 text-[10px]"
            >
              <div
                className="w-0.5 h-full min-h-7 rounded-full shrink-0"
                style={{ backgroundColor: p.color }}
              />
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="font-medium text-[10px]"
                    style={{ color: p.color }}
                  >
                    {p.label}
                  </span>
                  <span className="text-[8px] font-mono text-text-dim">
                    {p.base} × {p.reach}
                  </span>
                </div>
                <div className="text-[9px] text-text-dim leading-snug">
                  {p.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[9px] text-text-dim italic pt-2 border-t border-border/20">
        Classification computed via TensorFlow.js matrix multiplication on
        proposition embeddings. Strength: P60 hybrid activation (0.5 × max + 0.5
        × mean top-5). Reach: 15% of total scenes (scales with narrative
        length).
      </div>
    </div>
  );
}

// ── Archetypes Tab ───────────────────────────────────────────────────────────

const ARCHETYPES = [
  {
    name: "Opus",
    key: "opus" as ArchetypeKey,
    forces: "F + W + S",
    desc: "All three forces in concert — fates land, characters transform, and the world deepens together",
  },
  {
    name: "Series",
    key: "series" as ArchetypeKey,
    forces: "F + W",
    desc: "Consequential events that permanently reshape characters — fates land and lives change",
  },
  {
    name: "Atlas",
    key: "atlas" as ArchetypeKey,
    forces: "F + S",
    desc: "Resolutions that map the world — each fate reveals how things work",
  },
  {
    name: "Chronicle",
    key: "chronicle" as ArchetypeKey,
    forces: "W + S",
    desc: "Characters transform within a deepening world — lives and systems evolve together",
  },
  {
    name: "Classic",
    key: "classic" as ArchetypeKey,
    forces: "F",
    desc: "Driven by resolution — threads pay off and relationships shift decisively",
  },
  {
    name: "Show",
    key: "show" as ArchetypeKey,
    forces: "W",
    desc: "People-driven — characters transform and their journeys are the heart of the world view",
  },
  {
    name: "Paper",
    key: "paper" as ArchetypeKey,
    forces: "S",
    desc: "Dense with ideas and systems — the depth of the world itself is the draw",
  },
  {
    name: "Emerging",
    key: "emerging" as ArchetypeKey,
    forces: "—",
    desc: "No single force has reached its potential yet — the world view is still finding its voice",
  },
];

function ArchetypesTab() {
  return (
    <div className="space-y-4">
      <div className="text-[10px] text-text-dim leading-relaxed">
        Archetypes classify world views by <strong>force dominance</strong> — which
        of the three forces reach narrative-grade strength.
      </div>

      <div className="space-y-2">
        {ARCHETYPES.map((arch) => (
          <div
            key={arch.name}
            className="bg-bg-elevated/50 rounded-lg p-3 border border-border/20"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <ArchetypeIcon archetypeKey={arch.key} size={18} />
              <div
                className="font-semibold text-[11px]"
                style={{ color: ARCHETYPE_COLORS[arch.key] }}
              >
                {arch.name}
              </div>
              <div className="text-[9px] font-mono text-text-dim">
                {arch.forces}
              </div>
            </div>
            <p className="text-[9px] text-text-secondary leading-relaxed pl-6">
              {arch.desc}
            </p>
          </div>
        ))}
      </div>

      <div className="text-[9px] text-text-dim italic pt-2 border-t border-border/20">
        A force is &quot;dominant&quot; if it scores ≥21/25 AND is within 5 points of the
        highest-scoring force.
      </div>
    </div>
  );
}

// ── Shapes Tab ───────────────────────────────────────────────────────────────

const SHAPE_DISPLAY_ORDER = [
  "climactic",
  "episodic",
  "rebounding",
  "peaking",
  "escalating",
  "flat",
] as const;
const SHAPE_PATTERNS: Record<string, string> = {
  climactic: "Steady rise → sharp peak → decline",
  episodic: "Repeating rises and falls",
  rebounding: "Start high → collapse → recovery",
  peaking: "Early high → sustained fall",
  escalating: "Gradual, sustained rise",
  flat: "Near-constant delivery",
};

function ShapesTab() {
  return (
    <div className="space-y-4">
      <div className="text-[10px] text-text-dim leading-relaxed flex items-start gap-2">
        <IconLineChart size={14} className="shrink-0 mt-0.5 text-text-dim/60" />
        <span>
          Shapes classify the <strong>macro-structure</strong> of delivery
          curves — how intensity rises and falls across the full world view.
        </span>
      </div>

      <div className="space-y-2">
        {SHAPE_DISPLAY_ORDER.map((shapeKey) => {
          const shape = NARRATIVE_SHAPES[shapeKey];
          return (
            <div
              key={shape.name}
              className="bg-bg-elevated/50 rounded-lg p-3 border border-border/20"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <svg
                  width="32"
                  height="16"
                  viewBox="0 0 32 16"
                  className="shrink-0"
                >
                  <polyline
                    points={shape.curve
                      .map(([x, y]) => `${x * 32},${(1 - y) * 16}`)
                      .join(" ")}
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div className="font-semibold text-[11px] text-amber-400">
                  {shape.name}
                </div>
                <div className="text-[8px] text-text-dim font-mono ml-auto">
                  {SHAPE_PATTERNS[shapeKey]}
                </div>
              </div>
              <p className="text-[9px] text-text-secondary leading-relaxed pl-9">
                {shape.description}
              </p>
            </div>
          );
        })}
      </div>

      <div className="text-[9px] text-text-dim italic pt-2 border-t border-border/20">
        Detection uses overall slope, peak count, peak dominance, peak position,
        trough depth, and flatness metrics.
      </div>
    </div>
  );
}

// ── Scales Tab ───────────────────────────────────────────────────────────────

const SCALES = [
  {
    name: "Short",
    key: "short",
    range: "< 20",
    desc: "A contained vignette — one conflict, one resolution",
    examples: "Short story, one-act play",
    color: "#06B6D4",
  },
  {
    name: "Story",
    key: "story",
    range: "20–50",
    desc: "A focused narrative with room for subplot and development",
    examples: "Romeo & Juliet (24), Great Gatsby (44)",
    color: "#22D3EE",
  },
  {
    name: "Novel",
    key: "novel",
    range: "50–120",
    desc: "Full-length narrative with multiple arcs and cast depth",
    examples: "1984 (75), HP Azkaban (89)",
    color: "#22D3EE",
  },
  {
    name: "Epic",
    key: "epic",
    range: "120–300",
    desc: "Extended narrative with sprawling cast and world scope",
    examples: "Lord of the Rings (~150)",
    color: "#22D3EE",
  },
  {
    name: "Serial",
    key: "serial",
    range: "300+",
    desc: "Long-running multi-volume narrative with evolving world",
    examples: "Full web serials, multi-volume sagas",
    color: "#22D3EE",
  },
];

const DENSITIES = [
  {
    name: "Sparse",
    key: "sparse",
    range: "< 0.5",
    desc: "Minimal world scaffolding — plot over setting",
    color: "#34D399",
  },
  {
    name: "Focused",
    key: "focused",
    range: "0.5–1.5",
    desc: "Lean world built to serve specific narrative needs",
    color: "#34D399",
  },
  {
    name: "Developed",
    key: "developed",
    range: "1.5–2.5",
    desc: "Substantial world with layered characters and tensions",
    examples: "Tale of Two Cities (1.7)",
    color: "#34D399",
  },
  {
    name: "Rich",
    key: "rich",
    range: "2.5–4.0",
    desc: "Dense world where every scene touches multiple systems",
    examples: "HP Azkaban (2.1), Romeo & Juliet (3.2)",
    color: "#34D399",
  },
  {
    name: "Sprawling",
    key: "sprawling",
    range: "4.0+",
    desc: "Deeply interconnected world — every corner holds detail",
    color: "#34D399",
  },
];

function ScalesTab() {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <IconBook size={14} className="text-text-dim/60" />
          <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest">
            Story Scales{" "}
            <span className="text-text-dim font-normal">(by scene count)</span>
          </h3>
        </div>
        <div className="space-y-2">
          {SCALES.map((scale, idx) => (
            <div
              key={scale.name}
              className="flex items-start gap-3 text-[10px]"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                className="shrink-0 mt-0.5"
              >
                {[0, 1, 2, 3, 4].map((i) => {
                  const active = i <= idx;
                  return (
                    <rect
                      key={i}
                      x={2 + i * 3}
                      y={14 - (i + 1) * 2.4}
                      width={2}
                      height={(i + 1) * 2.4}
                      rx={0.5}
                      fill={active ? scale.color : "#ffffff10"}
                    />
                  );
                })}
              </svg>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className="font-semibold"
                    style={{ color: scale.color }}
                  >
                    {scale.name}
                  </span>
                  <span className="text-[9px] font-mono text-text-dim">
                    {scale.range} scenes
                  </span>
                </div>
                <p className="text-[9px] text-text-secondary leading-snug">
                  {scale.desc}
                </p>
                {scale.examples && (
                  <p className="text-[8px] text-text-dim mt-0.5 italic">
                    {scale.examples}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3 pt-2 border-t border-border/20">
          <IconLocationPin size={14} className="text-text-dim/60" />
          <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest">
            World Density{" "}
            <span className="text-text-dim font-normal">
              (entities per scene)
            </span>
          </h3>
        </div>
        <div className="text-[9px] text-text-dim mb-3 font-mono bg-bg-elevated/30 px-2 py-1.5 rounded border border-border/20">
          Density = (characters + locations + threads + systemNodes) / scenes
        </div>
        <div className="space-y-2">
          {DENSITIES.map((density, idx) => (
            <div
              key={density.name}
              className="flex items-start gap-3 text-[10px]"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                className="shrink-0 mt-0.5"
              >
                {[0, 1, 2, 3, 4].map((i) => {
                  const active = i <= idx;
                  const r = 2 + i * 1.8;
                  return (
                    <circle
                      key={i}
                      cx={9}
                      cy={9}
                      r={r}
                      fill="none"
                      stroke={active ? density.color : "#ffffff10"}
                      strokeWidth={1}
                    />
                  );
                })}
              </svg>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className="font-semibold"
                    style={{ color: density.color }}
                  >
                    {density.name}
                  </span>
                  <span className="text-[8px] font-mono text-text-dim">
                    {density.range}
                  </span>
                </div>
                <p className="text-[9px] text-text-secondary leading-snug">
                  {density.desc}
                </p>
                {density.examples && (
                  <p className="text-[8px] text-text-dim mt-0.5 italic">
                    {density.examples}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Game Theory Tab ──────────────────────────────────────────────────────────

const GAME_SHAPES: Array<{ name: string; family: string; desc: string }> = [
  // Symmetric-info preference structures
  { name: "coordination",     family: "Alignment",         desc: "Both want to end up in the same place. Stake moves together when actions match. Includes the case where both want to meet but prefer different focal points." },
  { name: "stag-hunt",        family: "Alignment",         desc: "Coordination with a trust gate. Team up for a big shared prize, or play it safe alone. The big prize is the Nash equilibrium, but the safe play is risk-dominant." },
  { name: "dilemma",          family: "Mixed motives",     desc: "Mutual cooperation would leave both better off, but each has a private incentive to defect. Prisoner's-dilemma shape." },
  { name: "chicken",          family: "Mixed motives",     desc: "Both want the other to yield. If neither does, both crash. Mutual yielding is acceptable — the question is who blinks. Includes war-of-attrition." },
  { name: "divergence",       family: "Opposed",           desc: "Both actively want to differ from each other on a shared axis. If only one wants to diverge and the other prefers alignment, it's not divergence (likely stealth or zero-sum)." },
  { name: "zero-sum",         family: "Opposed",           desc: "The payoff grid literally sums to zero in every cell. Any +X for one is −X for the other on a shared currency." },
  // Asymmetric-info structures
  { name: "signaling",        family: "Hidden info",       desc: "Informed party reveals their type through a costly, hard-to-fake action. The signal is credible because weaker types couldn't afford to send it. Absorbs cheap-talk when the talk itself carries cost." },
  { name: "screening",        family: "Hidden info",       desc: "Uninformed party DESIGNS a mechanism that sorts agents by type — evaluations, tests, auctions, loyalty trials, ultimatum-framed challenges." },
  { name: "principal-agent",  family: "Hidden info",       desc: "Requires BOTH (a) explicit delegation — one party hands a task to another — AND (b) hidden action — the principal can't directly observe what the agent does." },
  { name: "stealth",          family: "Hidden info",       desc: "One party acts covertly; the other's move is passive attention allocation (scrutinise vs overlook), not active counter-action. No delegation (that's principal-agent)." },
  // Mechanism / structural
  { name: "stackelberg",      family: "Mechanism",         desc: "One moves first and commits visibly; the other watches, then best-responds. First-mover advantage or trap." },
  { name: "bargaining",       family: "Mechanism",         desc: "Offer → counter → accept/reject rounds. Each side strategises over when to concede. Grid size signals round count; one-shot ultimatum is the degenerate case." },
  { name: "commitment-game",  family: "Mechanism",         desc: "Whether one party can credibly bind themselves IS the game (vow, burned bridge, hostage, contract). Credibility of the promise is the whole strategic content." },
  // Multi-party
  { name: "contest",          family: "Multi-party",       desc: "Multiple players compete for a rank-ordered prize — tournament, auction, scramble for status." },
  { name: "collective-action",family: "Multi-party",       desc: "A group needs enough contributors to clear a threshold. Each is tempted to free-ride on others' effort." },
  // Degenerate
  { name: "trivial",          family: "Degenerate",        desc: "No real strategic content — a beat where the choice is in name only." },
];

const ACTION_AXES: Array<{ name: string; group: string; desc: string }> = [
  { name: "information", group: "Information & self", desc: "reveal ↔ conceal — what facts about the world does each side expose or hide?" },
  { name: "identity",    group: "Information & self", desc: "claim ↔ disown — do I assert who I am, or distance myself from it?" },
  { name: "trust",       group: "Relational stance",  desc: "extend ↔ guard — do I lower my defenses, or keep them up?" },
  { name: "alliance",    group: "Relational stance",  desc: "ally ↔ separate — are we on the same side going forward, or not?" },
  { name: "status",      group: "Relational stance",  desc: "assert ↔ defer — do I push for the higher position, or yield rank?" },
  { name: "pressure",    group: "Force & magnitude",  desc: "press ↔ yield — how much force am I applying, or absorbing? (Absorbs control bind/release and confrontation engage/evade.)" },
  { name: "stakes",      group: "Force & magnitude",  desc: "escalate ↔ deescalate — am I raising or lowering what's on the line?" },
  { name: "resources",   group: "Resource & owed",    desc: "take ↔ give — who ends up holding the resources, lives, or knowledge?" },
  { name: "obligation",  group: "Resource & owed",    desc: "incur ↔ discharge — am I taking on a debt or favour, or paying it off? (The owed-ness that survives the transfer.)" },
  { name: "commitment",  group: "Self & tempo",       desc: "commit ↔ withdraw / hedge — am I binding myself, or keeping options open? Absorbs moral: committing to a principle is moral self-binding." },
  { name: "timing",      group: "Self & tempo",       desc: "act ↔ wait — do I move now, or hold and watch?" },
];

const GAME_CONCEPTS: Array<{ term: string; desc: string }> = [
  { term: "Decision space",       desc: "The full grid of choices for every player at a moment, and the consequence of every pairing. Game theory's object of study — the shape exists independent of any path realised through it." },
  { term: "Realised cell",        desc: "The cell that actually happened on the page. One signature on the decision space. In fiction the author selected it; in non-fiction the writer; in simulation the rules and priors; in analysis reality." },
  { term: "Stake delta",          desc: "How much an outcome advances (+) or harms (−) a player's arc-level interests, on a −4 to +4 scale. Magnitude is importance: a pivotal beat uses the full ±4 range; a quiet beat stays in ±1." },
  { term: "Nash equilibrium",     desc: "A cell where neither player would change their action even if they knew the other's choice. Both are best-responding to each other. The resting point self-interest converges to." },
  { term: "Pure-strategy Nash",   desc: "A Nash equilibrium that doesn't require randomising — a single deterministic cell that's stable. Some grids have none (matching-pennies shape); these are unresolved by rational play alone." },
  { term: "Off-Nash cell",        desc: "A realised cell that ISN'T a Nash equilibrium — someone had a better-for-them option and didn't take it. Signal, not error: usually the author trading local stake for arc, identity, or principle." },
  { term: "Arc-cost",             desc: "How much stake a player gave up by NOT taking the locally-best option. Derived from the grid — no LLM declaration. The visible signature of irrational / arc-driven play." },
  { term: "Stake rank",           desc: "Where the realised cell sits in this player's personal ranking of cells, best to worst. Rank 1 = best available; rank N = worst. Tells you whether the moment was generous, cruel, or middling to them." },
  { term: "ELO rating",           desc: "Running strategic rating, same idea as chess. Starts at 1500. Goes up when a player captures more stake than their counterpart in a moment; goes down when they capture less. Crucial moments (high stakes on the table) move the rating more." },
  { term: "Stake-weighted K",     desc: "ELO's K-factor (how much one game moves the rating) scales with the largest absolute stake in the grid. ±4 grids move the rating fully; ±1 grids barely touch it. Crucial moments dominate the rating." },
  { term: "Margin score",         desc: "scoreA = clamp(0.5 + (ΔA − ΔB) / 16, 0, 1). Folds margin-of-victory into the ELO math — a ±4 crush yields 1.0, a ±1 edge yields ~0.56, a tie yields 0.5." },
  { term: "Nash compliance",      desc: "% of realised cells that are Nash equilibria. High = a world where strategic logic carries. Low = a world where character, arc, or theme routinely overrides what self-interest would dictate." },
  { term: "Coalition",            desc: "A tight group where every pair routinely lands in mutual-gain cells together. The structural alliances inside the cast — who rises (or falls) together." },
  { term: "Rivalry",              desc: "Two players with sustained, asymmetric conflict — many shared moments, many cells where one gains while the other loses, with a clear winner." },
];

const FAMILY_COLOR: Record<string, string> = {
  "Alignment":       "text-emerald-300",
  "Mixed motives":   "text-amber-300",
  "Opposed":         "text-rose-300",
  "Hidden info":     "text-sky-300",
  "Mechanism":       "text-violet-300",
  "Multi-party":     "text-blue-300",
  "Degenerate":      "text-text-dim",
};

const AXIS_GROUP_COLOR: Record<string, string> = {
  "Information & self":  "text-sky-300",
  "Relational stance":   "text-emerald-300",
  "Force & magnitude":   "text-amber-300",
  "Resource & owed":     "text-violet-300",
  "Self & tempo":        "text-rose-300",
};

function GameTheoryTab() {
  return (
    <div className="space-y-6">
      <div className="text-[10px] text-text-dim leading-relaxed">
        Every consequential moment has a <strong>shape</strong> — the full space of
        choices each party could have made, and what would have happened in each
        pairing. The realised cell is one signature on that space. Across fiction,
        non-fiction, simulation, and analysis the shape is the same; only who
        selected the path differs. ELO rates the agents based on which signatures
        they leave at the moments that matter most.
      </div>

      {/* Core concepts */}
      <div>
        <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest mb-3">
          Core concepts
        </h3>
        <div className="space-y-2">
          {GAME_CONCEPTS.map((c) => (
            <div
              key={c.term}
              className="bg-bg-elevated/50 rounded-lg p-3 border border-border/20"
            >
              <div className="font-semibold text-[11px] text-text-primary mb-1">
                {c.term}
              </div>
              <p className="text-[10px] text-text-secondary leading-relaxed">
                {c.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Game shapes */}
      <div>
        <div className="flex items-baseline justify-between mb-3 pt-2 border-t border-border/20">
          <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest">
            Game shapes
          </h3>
          <span className="text-[9px] text-text-dim">
            What kind of game is being played
          </span>
        </div>
        <div className="space-y-2">
          {GAME_SHAPES.map((g) => (
            <div
              key={g.name}
              className="bg-bg-elevated/50 rounded-lg p-3 border border-border/20"
            >
              <div className="flex items-baseline gap-2 mb-1">
                <div className="font-semibold text-[11px] text-text-primary font-mono">
                  {g.name}
                </div>
                <div className={`text-[9px] uppercase tracking-wider ${FAMILY_COLOR[g.family] ?? "text-text-dim"}`}>
                  {g.family}
                </div>
              </div>
              <p className="text-[10px] text-text-secondary leading-relaxed">
                {g.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Action axes */}
      <div>
        <div className="flex items-baseline justify-between mb-3 pt-2 border-t border-border/20">
          <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest">
            Action axes
          </h3>
          <span className="text-[9px] text-text-dim">
            What's being traded in the moment
          </span>
        </div>
        <div className="text-[10px] text-text-dim leading-relaxed mb-3">
          Both players' actions live on the SAME axis — pick the axis by asking
          what SHIFTS as a result of the decision. That thing is what's being
          traded.
        </div>
        <div className="space-y-2">
          {ACTION_AXES.map((a) => (
            <div
              key={a.name}
              className="bg-bg-elevated/50 rounded-lg p-3 border border-border/20"
            >
              <div className="flex items-baseline gap-2 mb-1">
                <div className="font-semibold text-[11px] text-text-primary font-mono">
                  {a.name}
                </div>
                <div className={`text-[9px] uppercase tracking-wider ${AXIS_GROUP_COLOR[a.group] ?? "text-text-dim"}`}>
                  {a.group}
                </div>
              </div>
              <p className="text-[10px] text-text-secondary leading-relaxed">
                {a.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[9px] text-text-dim italic pt-2 border-t border-border/20">
        The shape says how stake CAN move. The realised cell says how it DID move.
        Arc-cost says what was left on the table.
      </div>
    </div>
  );
}

// ── Main Modal ───────────────────────────────────────────────────────────────

export function DefinitionsModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("Cube");

  return (
    <Modal onClose={onClose} size="2xl">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === t
                  ? "bg-bg-elevated text-text-primary"
                  : "text-text-dim hover:text-text-secondary"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </ModalHeader>
      <ModalBody className="px-5 py-4 max-h-[70vh] overflow-y-auto">
        {tab === "Cube" && <CubeTab />}
        {tab === "Beats" && <BeatsTab />}
        {tab === "Propositions" && <PropositionsTab />}
        {tab === "Archetypes" && <ArchetypesTab />}
        {tab === "Shapes" && <ShapesTab />}
        {tab === "Scales" && <ScalesTab />}
        {tab === "Game theory" && <GameTheoryTab />}
      </ModalBody>
    </Modal>
  );
}
