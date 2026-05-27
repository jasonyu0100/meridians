'use client';

import React from 'react';
import type { SlidesData } from '@/lib/slides-data';
import { SYSTEM_NODE_TYPES, type SystemNodeType } from '@/types/narrative';
import { SlideShell, SlideStatStrip } from './SlideShell';

/** Per-type accent — mirrors the sidebar KnowledgePanel palette so the
 *  ranking on the slide reads as the same surface the operator sees in the
 *  inspector. */
const TYPE_HEX: Record<SystemNodeType, string> = {
  principle: '#FBBF24',    // amber — the fundamental layer
  system: '#38BDF8',       // sky — organized mechanism
  concept: '#A78BFA',      // violet — abstract idea
  tension: '#FB7185',      // rose — unresolved force
  event: '#34D399',        // emerald — significant occurrence
  structure: '#22D3EE',    // cyan — organization
  environment: '#2DD4BF',  // teal — spatial reality
  convention: '#818CF8',   // indigo — norms
  constraint: '#FB923C',   // orange — limits
};
const TYPE_LABEL: Record<SystemNodeType, string> = {
  principle: 'Principle',
  system: 'System',
  concept: 'Concept',
  tension: 'Tension',
  event: 'Event',
  structure: 'Structure',
  environment: 'Environment',
  convention: 'Convention',
  constraint: 'Constraint',
};

/** The work's knowledge ranking — the System graph's load-bearing nodes
 *  surfaced the same way the sidebar's KnowledgePanel ranks them: score =
 *  degree (graph links) + attributions (scene citations) + reach (arcs
 *  spanned). A node that fails any axis sinks naturally — isolated trivia
 *  and dead lore score low; cross-arc concepts referenced often score high.
 *
 *  Two columns: ranked list of top-impact nodes (the structural spine), and
 *  a composition breakdown by node type. Together they answer "what does
 *  this world view actually know, and what is it built around?" */
export function KnowledgeStructureSlide({ data }: { data: SlidesData }) {
  const ks = data.knowledgeStructure;
  const total = ks.nodeCount;
  const edgesPerNode = total > 0 ? (ks.edgeCount / total).toFixed(2) : '0.00';
  const ranked = ks.rankedNodes;
  const topScore = ranked[0]?.score ?? 1;

  // Composition rows — sorted by count desc, zero-count types dropped.
  const typeRows = SYSTEM_NODE_TYPES
    .map((t) => ({ type: t, count: ks.nodesByType[t] ?? 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxCount = Math.max(1, ...typeRows.map((r) => r.count));

  return (
    <SlideShell
      eyebrow="System · Knowledge"
      title="Knowledge Structure"
      subtitle="The System field made visible — every rule, principle, system, and constraint the world view has accumulated, and how they connect."
      contentWidth="wide"
      footer={
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_HEX.principle }} />
          <span>System force = ΔN + √ΔE — nodes scale linearly, edges sub-linearly. Composition matters more than count.</span>
        </div>
      }
    >
      <SlideStatStrip
        className="mb-5"
        accent={
          <>
            interconnection <span className="text-text-secondary font-mono">{edgesPerNode}</span> edges/node
            {Number(edgesPerNode) >= 1.2
              ? ' · composes — pieces lean on each other'
              : Number(edgesPerNode) >= 0.5
                ? ' · partially composing'
                : ' · isolated — pieces sit alone'}
          </>
        }
      >
        <span><span className="text-text-secondary font-mono">{ks.nodeCount}</span> nodes</span>
        <span><span className="text-text-secondary font-mono">{ks.edgeCount}</span> edges</span>
      </SlideStatStrip>

      {total === 0 ? (
        <div className="flex items-center justify-center flex-1">
          <p className="text-text-dim text-sm italic">No system graph yet — the abstract field is empty.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_280px] gap-6 flex-1 min-h-0">
          {/* Left: ranked nodes — the load-bearing knowledge */}
          <div className="flex flex-col min-h-0">
            <div className="text-[10px] uppercase tracking-widest text-text-dim mb-3 flex items-baseline gap-2">
              <span>Load-bearing nodes</span>
              <span className="text-text-dim/60 normal-case tracking-normal">(highest interconnection)</span>
            </div>
            <div className="space-y-1.5 overflow-y-auto pr-1 min-h-0">
              {ranked.slice(0, 12).map((node, i) => {
                const color = TYPE_HEX[node.type];
                const intensity = Math.max(0.1, Math.min(1, node.score / topScore));
                return (
                  <div key={node.id} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-[9px] uppercase tracking-wider font-mono shrink-0" style={{ color }}>
                        {TYPE_LABEL[node.type]}
                      </span>
                      <span className="text-[9px] font-mono text-text-dim/60 ml-auto shrink-0">
                        #{i + 1}
                      </span>
                      <span className="text-[10px] font-mono text-text-secondary tabular-nums shrink-0">
                        {node.score}
                      </span>
                    </div>
                    <p className="text-[11.5px] text-text-primary/90 leading-snug mb-2">
                      {node.concept}
                    </p>
                    {/* Impact bar + components — matches the sidebar shape */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-white/[0.04] overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${intensity * 100}%`, backgroundColor: color, opacity: 0.75 }}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-text-dim/70 shrink-0 tabular-nums">
                        {node.degree} links · {node.attributions} cites · {node.reach} arc{node.reach !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
              {ranked.length === 0 && (
                <p className="text-[11px] text-text-dim italic px-2">
                  Nodes are present, but none are scored yet.
                </p>
              )}
            </div>
          </div>

          {/* Right: composition by type */}
          <div className="flex flex-col">
            <div className="text-[10px] uppercase tracking-widest text-text-dim mb-3">
              Composition by type
            </div>
            <div className="space-y-2 overflow-y-auto pr-1">
              {typeRows.map((row) => {
                const fillPct = (row.count / maxCount) * 100;
                const sharePct = (row.count / total) * 100;
                const color = TYPE_HEX[row.type];
                return (
                  <div key={row.type} className="grid items-center gap-x-2 text-[11px]" style={{ gridTemplateColumns: '90px 1fr 28px 32px' }}>
                    <span className="truncate" style={{ color }}>{TYPE_LABEL[row.type]}</span>
                    <div className="relative h-3.5 rounded bg-white/[0.04] overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 rounded"
                        style={{ width: `${fillPct}%`, backgroundColor: `${color}55`, borderRight: `1px solid ${color}` }}
                      />
                    </div>
                    <span className="text-right font-mono text-text-dim text-[10px]">{row.count}</span>
                    <span className="text-right font-mono text-text-dim/70 text-[9px]">{sharePct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-auto pt-4">
              <p className="text-[10px] text-text-dim/70 italic leading-relaxed">
                Score = degree (graph links) + attributions (scene cites) + reach (arcs spanned). A node that fails any axis sinks naturally — isolated trivia and dead lore score low.
              </p>
            </div>
          </div>
        </div>
      )}
    </SlideShell>
  );
}
