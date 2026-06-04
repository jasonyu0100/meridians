'use client';
// ParadigmLens slide — D3 view framing the work through its dominant-force paradigm (Classic/Show/Paper/Opus).

import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { SlidesData } from '@/lib/slides-data';
import type { NarrativeParadigm } from '@/types/narrative';
import { SlideShell, SlideCard } from './SlideShell';

const FATE = '#EF4444';
const WORLD = '#22C55E';
const SYSTEM = '#3B82F6';

/** Per-paradigm framing. Each entry names what the work IS, what the three
 *  forces MEAN under that paradigm, and which force is structurally
 *  load-bearing. Same math runs across all paradigms — only the reading
 *  shifts. */
type ParadigmEntry = {
  label: string;
  oneLiner: string;
  fate: string;
  world: string;
  system: string;
  loadBearing: 'fate' | 'world' | 'system' | 'all';
  loadBearingNote: string;
};

const PARADIGM: Record<NarrativeParadigm, ParadigmEntry> = {
  fiction: {
    label: 'Fiction',
    oneLiner: 'An invented world view. Reality is built, then tested against itself.',
    fate: 'Rivalries, secrets, quests — the dramatic open questions the story must answer.',
    world: 'The cast, their inner lives, the places they pass through — the lived layer.',
    system: 'The world\'s physics — magic, technology, social rules, the laws that hold.',
    loadBearing: 'all',
    loadBearingNote: 'Narratives fire all three forces — the balance is a dramatic choice, not a paradigm requirement.',
  },
  'non-fiction': {
    label: 'Non-fiction',
    oneLiner: 'An observed world view. Reality is recorded; the work is the record.',
    fate: 'Open arguments, contested claims, unresolved lines of inquiry — what the work has not yet concluded.',
    world: 'Sources, institutions, named figures, primary documents — the cast of evidence.',
    system: 'The frameworks, principles, and conventions the argument runs on.',
    loadBearing: 'world',
    loadBearingNote: 'Non-fiction leans on World — the evidentiary ground decides whether the argument holds.',
  },
  simulation: {
    label: 'Simulation',
    oneLiner: 'A rule-governed world view. Reality is the trajectory under a stated ruleset and initial conditions.',
    fate: 'Branching outcomes the scenario was designed to observe — what could happen under the rules.',
    world: 'Agents, factions, observers — the entities driving the rules forward.',
    system: 'The ruleset itself. Every outcome is asked to be rule-driven.',
    loadBearing: 'system',
    loadBearingNote: 'Simulations stand or fall on System. Rule-driven closure is the paradigm\'s hallmark; authorial assertion breaks the frame.',
  },
  essay: {
    label: 'Essay',
    oneLiner: 'A singular thinker working an argument. One voice, sustained reasoning.',
    fate: 'The argument\'s open turns — claims being weighed, counters being entertained.',
    world: 'The author\'s own continuity — the thinker working through the position.',
    system: 'The conceptual scaffolding — definitions, lemmas, the rules the argument runs on.',
    loadBearing: 'system',
    loadBearingNote: 'Essays grow System — the argument IS the rule structure the work assembles.',
  },
  panel: {
    label: 'Panel',
    oneLiner: 'A multi-thinker world view. Cooperative-with-disagreement — the contest of minds becoming a synthesis.',
    fate: 'The positions still being negotiated — where the panelists have not yet converged.',
    world: 'The panelists themselves, each with their own continuity and position.',
    system: 'The shared frame, methods, and conventions the panel operates within.',
    loadBearing: 'all',
    loadBearingNote: 'Panels fire all three — the synthesis emerges from the trade between positions, rules, and panelist voice.',
  },
  atlas: {
    label: 'Atlas',
    oneLiner: 'A reference typology. Entries, classification, the structure of a domain.',
    fate: 'Minimal — atlases typically carry few open questions. Closure is in the typology itself.',
    world: 'The entries — entities, instances, the populated cells of the classification.',
    system: 'The classification scheme. The typology IS the work.',
    loadBearing: 'system',
    loadBearingNote: 'Atlases are nearly pure System. Strong typology under a thin World is the paradigm\'s native shape.',
  },
  debate: {
    label: 'Debate',
    oneLiner: 'An adversarial contest. Two or more parties locked in zero-sum stakes under explicit rules.',
    fate: 'The motion itself — who carries the room, what is conceded, what is held.',
    world: 'The debaters, their reputations, the audience that judges.',
    system: 'The rules of engagement — burden of proof, time limits, points of order.',
    loadBearing: 'fate',
    loadBearingNote: 'Debates live on Fate — the work IS the stance contest. The other forces are scaffolding.',
  },
  record: {
    label: 'Record',
    oneLiner: 'A chronological log. Real or imagined; ordering is structure.',
    fate: 'Events that change what is expected — turns the record had to register.',
    world: 'The entities the record tracks — recurring names, places, ongoing concerns.',
    system: 'The conventions of the record — what kind of entry, what cadence, what scope.',
    loadBearing: 'world',
    loadBearingNote: 'Records lean on World — the lived layer accumulates, entry by entry, into the work itself.',
  },
  game: {
    label: 'Game',
    oneLiner: 'A multi-actor contest under enforceable rules. Actors take turns; stakes are contested.',
    fate: 'The contested stakes — open objectives, victory conditions, the questions the rules will resolve.',
    world: 'The actors and what they command — resources, positions, artifacts, information sets.',
    system: 'The rule set — legal action spaces, turn structure, win conditions, information rules.',
    loadBearing: 'system',
    loadBearingNote: 'Games stand on System. The rules dictate what is possible; outcomes resolve only when the rules say so — authorial rescue is paradigm error.',
  },
};

const LOAD_BEARING_COLOR: Record<ParadigmEntry['loadBearing'], string> = {
  fate: FATE, world: WORLD, system: SYSTEM, all: '#FBBF24',
};

const ARCHETYPE_LABEL: Record<string, string> = {
  classic: 'Classic', show: 'Stage', paper: 'Paper', opus: 'Opus',
};

/** Combined Paradigm Lens + Signature slide. The paradigm names what KIND of
 *  world view the work is and how to read the three forces through it; the
 *  signature ternary plot shows where it actually sits on the (Fate, World,
 *  System) simplex. Reading: "this is what the work IS, here is what it
 *  ACTUALLY DOES." */
export function ParadigmLensSlide({ data }: { data: SlidesData }) {
  const paradigm = data.paradigm ?? 'fiction';
  const entry = PARADIGM[paradigm];
  const loadColor = LOAD_BEARING_COLOR[entry.loadBearing];
  const sig = data.signature;
  const svgRef = useRef<SVGSVGElement>(null);

  // ── Signature ternary plot ─────────────────────────────────────────────
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;
    const { width } = svgRef.current.getBoundingClientRect();
    const height = 260;
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g');

    const padTop = 24;
    const padBottom = 30;
    const triW = Math.min(width - 60, 280);
    const triH = (triW * Math.sqrt(3)) / 2;
    const cx = width / 2;
    const top = padTop;
    const availH = height - padBottom - top;
    const yScale = Math.min(1, availH / triH);
    const halfBase = (triW * yScale) / 2;
    const v = {
      fate: { x: cx, y: top },
      world: { x: cx + halfBase, y: top + triH * yScale },
      system: { x: cx - halfBase, y: top + triH * yScale },
    };

    const project = (w: { fate: number; world: number; system: number }) => ({
      x: w.fate * v.fate.x + w.world * v.world.x + w.system * v.system.x,
      y: w.fate * v.fate.y + w.world * v.world.y + w.system * v.system.y,
    });
    const centroid = project({ fate: 1 / 3, world: 1 / 3, system: 1 / 3 });

    for (const t of [0.33, 0.66]) {
      const rF = project({ fate: 1 / 3 + (2 / 3) * t, world: 1 / 3 - (1 / 3) * t, system: 1 / 3 - (1 / 3) * t });
      const rW = project({ fate: 1 / 3 - (1 / 3) * t, world: 1 / 3 + (2 / 3) * t, system: 1 / 3 - (1 / 3) * t });
      const rS = project({ fate: 1 / 3 - (1 / 3) * t, world: 1 / 3 - (1 / 3) * t, system: 1 / 3 + (2 / 3) * t });
      g.append('path')
        .attr('d', `M ${rF.x} ${rF.y} L ${rW.x} ${rW.y} L ${rS.x} ${rS.y} Z`)
        .attr('fill', 'none').attr('stroke', 'rgba(148,163,184,0.08)')
        .attr('stroke-width', 0.5).attr('stroke-dasharray', '2 4');
    }

    g.append('path')
      .attr('d', `M ${v.fate.x} ${v.fate.y} L ${v.world.x} ${v.world.y} L ${v.system.x} ${v.system.y} Z`)
      .attr('fill', 'none').attr('stroke', 'rgba(148,163,184,0.35)').attr('stroke-width', 1);

    g.append('text').attr('x', v.fate.x).attr('y', v.fate.y - 8)
      .attr('text-anchor', 'middle').attr('font-size', 11).attr('font-weight', 600).attr('fill', FATE).text('Fate');
    g.append('text').attr('x', v.world.x + 8).attr('y', v.world.y + 12)
      .attr('text-anchor', 'start').attr('font-size', 11).attr('font-weight', 600).attr('fill', WORLD).text('World');
    g.append('text').attr('x', v.system.x - 8).attr('y', v.system.y + 12)
      .attr('text-anchor', 'end').attr('font-size', 11).attr('font-weight', 600).attr('fill', SYSTEM).text('System');

    // Archetype anchors
    const archetypes: { key: string; w: { fate: number; world: number; system: number } }[] = [
      { key: 'classic', w: { fate: 0.5, world: 0.25, system: 0.25 } },
      { key: 'show', w: { fate: 0.25, world: 0.5, system: 0.25 } },
      { key: 'paper', w: { fate: 0.25, world: 0.25, system: 0.5 } },
    ];
    for (const a of archetypes) {
      const p = project(a.w);
      g.append('circle').attr('cx', p.x).attr('cy', p.y).attr('r', 2)
        .attr('fill', 'rgba(148,163,184,0.35)');
      g.append('text').attr('x', p.x).attr('y', p.y + 13)
        .attr('text-anchor', 'middle').attr('font-size', 8.5).attr('fill', 'rgba(148,163,184,0.55)')
        .text(ARCHETYPE_LABEL[a.key]);
    }
    g.append('circle').attr('cx', centroid.x).attr('cy', centroid.y).attr('r', 1.5)
      .attr('fill', 'rgba(148,163,184,0.4)');
    g.append('text').attr('x', centroid.x).attr('y', centroid.y - 6)
      .attr('text-anchor', 'middle').attr('font-size', 8.5).attr('fill', 'rgba(148,163,184,0.5)').text('Opus');

    // The work
    const workPt = project(sig.weights);
    const ring = g.append('circle').attr('cx', workPt.x).attr('cy', workPt.y).attr('r', 0)
      .attr('fill', 'none').attr('stroke', '#FBBF24').attr('stroke-width', 1.5).attr('stroke-opacity', 0.8);
    ring.transition().duration(900).ease(d3.easeBackOut).attr('r', 11);
    const dot = g.append('circle').attr('cx', workPt.x).attr('cy', workPt.y).attr('r', 0).attr('fill', '#FBBF24');
    dot.transition().duration(900).ease(d3.easeBackOut).attr('r', 4);
  }, [sig.weights]);

  const fatePct = Math.round(sig.weights.fate * 100);
  const worldPct = Math.round(sig.weights.world * 100);
  const systemPct = Math.round(sig.weights.system * 100);
  const arch = sig.nearestArchetype;

  return (
    <SlideShell
      eyebrow="Paradigm · Signature"
      title={
        <>
          {entry.label} <span className="text-text-dim/40 font-light text-xl align-middle">world view</span>
        </>
      }
      subtitle={<span className="italic">&ldquo;{entry.oneLiner}&rdquo;</span>}
      contentWidth="wide"
      footer="Same formulas measure all nine paradigms. The reading shifts; the math does not."
    >
      <div className="grid grid-cols-[1.4fr_1fr] gap-8 flex-1 min-h-0">
        {/* Left: Paradigm reading of the three forces */}
        <div className="flex flex-col">
          <div className="text-[10px] uppercase tracking-widest text-text-dim mb-3">
            How to read the forces
          </div>
          <div className="space-y-2.5">
            {[
              { label: 'Fate', color: FATE, body: entry.fate, key: 'fate' as const },
              { label: 'World', color: WORLD, body: entry.world, key: 'world' as const },
              { label: 'System', color: SYSTEM, body: entry.system, key: 'system' as const },
            ].map((f) => {
              const isLoadBearing = entry.loadBearing === f.key || entry.loadBearing === 'all';
              return (
                <div
                  key={f.label}
                  className="rounded-lg border bg-white/[0.02] px-4 py-3"
                  style={{ borderColor: isLoadBearing ? `${f.color}44` : 'rgba(255,255,255,0.05)' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: f.color }} />
                    <span className="text-[10px] uppercase tracking-widest font-medium" style={{ color: f.color }}>
                      {f.label}
                    </span>
                    {isLoadBearing && (
                      <span className="ml-auto text-[8.5px] uppercase tracking-widest font-mono" style={{ color: f.color, opacity: 0.6 }}>
                        load-bearing
                      </span>
                    )}
                  </div>
                  <p className="text-[11.5px] text-text-secondary/85 leading-snug">
                    {f.body}
                  </p>
                </div>
              );
            })}
          </div>

          <div
            className="rounded-lg border px-4 py-3 mt-3"
            style={{ borderColor: `${loadColor}33`, background: `${loadColor}08` }}
          >
            <div className="text-[9.5px] uppercase tracking-widest font-medium mb-1" style={{ color: loadColor }}>
              How to read this report
            </div>
            <p className="text-[12px] text-text-primary/90 leading-relaxed">
              {entry.loadBearingNote}
            </p>
          </div>
        </div>

        {/* Right: Signature simplex + force mix */}
        <div className="flex flex-col">
          <div className="text-[10px] uppercase tracking-widest text-text-dim mb-3">
            Signature
            <span className="text-text-dim/60 normal-case tracking-normal ml-2">where it actually sits</span>
          </div>

          <SlideCard>
            <svg ref={svgRef} className="w-full" style={{ height: 260 }} />
          </SlideCard>

          {/* Archetype + force mix */}
          <div className="mt-4">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest text-text-dim">Archetype</span>
              <span className="text-lg font-bold text-amber-300/90 tracking-tight">
                {ARCHETYPE_LABEL[arch] ?? arch}
              </span>
            </div>
            <div className="space-y-1.5">
              {[
                { label: 'Fate', pct: fatePct, color: FATE },
                { label: 'World', pct: worldPct, color: WORLD },
                { label: 'System', pct: systemPct, color: SYSTEM },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-2">
                  <span className="text-[10px] w-12" style={{ color: row.color }}>{row.label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${row.pct}%`, backgroundColor: row.color, opacity: 0.7 }} />
                  </div>
                  <span className="text-[10px] font-mono w-8 text-right text-text-dim">{row.pct}%</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-text-dim/70 mt-2 leading-relaxed">
              {sig.concentration <= 0.2
                ? 'Balanced — all three forces share the load.'
                : sig.concentration <= 0.5
                  ? `Leaning ${sig.profile}.`
                  : `Concentrated — ${sig.profile} carries the work.`}
            </p>
          </div>
        </div>
      </div>

    </SlideShell>
  );
}
