'use client';
// PropositionOverview slide — shows the work's embedded propositions classified by profile/category.

import React, { useMemo } from 'react';
import type { SlidesData } from '@/lib/slides-data';
import { BASE_COLORS, classificationLabel, ALL_PROFILE_LABELS } from '@/lib/analysis/proposition-classify';
import { usePropositionClassification } from '@/hooks/usePropositionClassification';
import type { PropositionBaseCategory } from '@/types/narrative';
import { SlideShell } from './SlideShell';

const BASE_ORDER: PropositionBaseCategory[] = ['Anchor', 'Seed', 'Close', 'Texture'];

export function PropositionOverviewSlide({ data }: { data: SlidesData }) {
  const { sceneProfiles, getClassification } = usePropositionClassification();

  const { totals, total, arcTrajectory, labelCounts } = useMemo(() => {
    const t: Record<PropositionBaseCategory, number> = { Anchor: 0, Seed: 0, Close: 0, Texture: 0 };
    let sum = 0;

    if (sceneProfiles && sceneProfiles.size > 0) {
      for (const dist of sceneProfiles.values()) {
        for (const base of BASE_ORDER) {
          const v = dist[base] ?? 0;
          t[base] += v;
          sum += v;
        }
      }
    }

    if (sum === 0) sum = data.propositionCount;

    // Compute per-arc trajectory from sceneProfiles + narrative arcs
    const perCategory: Record<PropositionBaseCategory, number[]> = { Anchor: [], Seed: [], Close: [], Texture: [] };
    let arcCount = 0;

    if (sceneProfiles && sceneProfiles.size > 0 && data.scenes.length > 0) {
      // Group scenes by arcId
      const arcMap = new Map<string, string[]>();
      for (const scene of data.scenes) {
        const arcId = scene.arcId ?? '_ungrouped';
        if (!arcMap.has(arcId)) arcMap.set(arcId, []);
        arcMap.get(arcId)!.push(scene.id);
      }

      for (const [, sceneIds] of arcMap) {
        let arcTotal = 0;
        const counts: Record<PropositionBaseCategory, number> = { Anchor: 0, Seed: 0, Close: 0, Texture: 0 };
        for (const sid of sceneIds) {
          const dist = sceneProfiles.get(sid);
          if (!dist) continue;
          for (const b of BASE_ORDER) { counts[b] += dist[b]; arcTotal += dist[b]; }
        }
        for (const b of BASE_ORDER) {
          perCategory[b].push(arcTotal > 0 ? (counts[b] / arcTotal) * 100 : 0);
        }
        arcCount++;
      }
    }

    // Count all 8 labels by scanning propositions
    const lc: Record<string, number> = {};
    for (const p of ALL_PROFILE_LABELS) lc[p.label] = 0;

    if (sceneProfiles && sceneProfiles.size > 0) {
      for (const scene of data.scenes) {
        const plan = scene.planVersions?.[scene.planVersions.length - 1]?.plan;
        if (!plan?.beats) continue;
        for (let bi = 0; bi < plan.beats.length; bi++) {
          const beat = plan.beats[bi];
          if (!beat.propositions) continue;
          for (let pi = 0; pi < beat.propositions.length; pi++) {
            const cls = getClassification(scene.id, bi, pi);
            if (cls) {
              const label = classificationLabel(cls.base, cls.reach);
              lc[label] = (lc[label] ?? 0) + 1;
            }
          }
        }
      }
    }

    return { totals: t, total: sum, arcTrajectory: arcCount >= 2 ? perCategory : null, labelCounts: lc };
  }, [sceneProfiles, data, getClassification]);

  const hasClassified = Object.values(totals).some(v => v > 0);

  if (total === 0) {
    return (
      <SlideShell
        eyebrow="Propositions · Overview"
        title="Propositions"
        subtitle="Structural claims by role — anchors / seeds / closes / textures — and how each class trends across arcs."
        align="center"
        contentWidth="wide"
      >
        <div className="flex items-center justify-center flex-1">
          <p className="text-text-dim text-sm italic">No propositions found.</p>
        </div>
      </SlideShell>
    );
  }

  const maxLabel = hasClassified ? Math.max(...Object.values(labelCounts), 1) : 1;

  return (
    <SlideShell
      eyebrow="Propositions · Overview"
      title="Propositions"
      subtitle="Structural claims by role — anchors / seeds / closes / textures — and how each class trends across arcs."
      contentWidth="wide"
      rightSlot={
        <span className="text-xs text-text-dim font-mono">
          {total.toLocaleString()} total
        </span>
      }
    >
      {hasClassified ? (
        <div className="grid grid-cols-2 gap-8 flex-1 min-h-0">
          {/* ── Left: Distribution ── */}
          <div className="flex flex-col">
            <div className="text-[10px] uppercase tracking-widest text-text-dim mb-4">
              Distribution
            </div>

            {/* 4 base percentages */}
            <div className="flex items-end gap-6 mb-6">
              {BASE_ORDER.map(base => {
                const pct = total > 0 ? (totals[base] / total) * 100 : 0;
                return (
                  <div key={base}>
                    <div className="text-[34px] font-bold font-mono leading-none" style={{ color: BASE_COLORS[base] }}>
                      {pct.toFixed(0)}%
                    </div>
                    <div className="text-[10px] font-medium lowercase mt-1.5 opacity-70" style={{ color: BASE_COLORS[base] }}>{base}</div>
                  </div>
                );
              })}
            </div>

            {/* 8-label bars */}
            <div className="space-y-2">
              {ALL_PROFILE_LABELS.map(({ label, color }) => {
                const count = labelCounts[label] ?? 0;
                const barPct = (count / maxLabel) * 100;
                return (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-[10px] w-24 text-right font-medium" style={{ color }}>{label}</span>
                    <div className="flex-1 h-4 bg-white/[0.04] rounded-sm overflow-hidden">
                      <div className="h-full rounded-sm" style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.7 }} />
                    </div>
                    <span className="text-[9px] font-mono text-text-dim w-10 text-right tabular-nums">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Right: Arc Trajectory ── */}
          <div className="flex flex-col">
            <div className="text-[10px] uppercase tracking-widest text-text-dim mb-4">
              Arc Trajectory
            </div>

            <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
              {BASE_ORDER.map((base) => {
                const count = totals[base];
                const values = arcTrajectory?.[base];
                const maxVal = values ? Math.max(...values, 1) : 1;
                const trend = values ? values[values.length - 1] - values[0] : 0;

                return (
                  <div key={base} className="rounded-lg p-3 border border-white/[0.08] bg-white/[0.02] flex flex-col">
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-[13px] font-semibold lowercase" style={{ color: BASE_COLORS[base] }}>{base}</span>
                      <span className="text-[10px] font-mono text-text-dim tabular-nums">{count}</span>
                    </div>

                    {values && values.length >= 2 ? (
                      <>
                        <div className="flex items-end gap-1 flex-1 min-h-0 h-20">
                          {values.map((v, i) => (
                            <div
                              key={i}
                              className="flex-1 rounded-t"
                              style={{
                                height: `${Math.max(6, (v / maxVal) * 100)}%`,
                                backgroundColor: BASE_COLORS[base],
                                opacity: 0.3 + (i / values.length) * 0.7,
                              }}
                            />
                          ))}
                        </div>
                        <div className="text-[9px] font-mono text-text-dim/70 mt-2 tabular-nums">
                          {trend >= 0 ? '\u2191' : '\u2193'} {Math.abs(trend).toFixed(1)}% across arcs
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-[10px] text-text-dim/60 italic">single arc</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-[36px] font-bold font-mono text-text-secondary">{total.toLocaleString()}</div>
            <div className="text-[10px] text-text-dim mt-2 uppercase tracking-widest">propositions \u00b7 run classification to see the breakdown</div>
          </div>
        </div>
      )}
    </SlideShell>
  );
}
