'use client';
// PropositionAnalysisModal — classifies and visualises embedded propositions by base category and reach.

import React, { useState, useMemo } from 'react';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { usePropositionClassification } from '@/hooks/usePropositionClassification';
import { useStore } from '@/lib/state/store';
import { resolveEntry, isScene } from '@/types/narrative';
import type { NarrativeState, PropositionBaseCategory, PropositionReach } from '@/types/narrative';
import { BASE_COLORS, classificationColor, classificationLabel, ALL_PROFILE_LABELS } from '@/lib/analysis/proposition-classify';

type Props = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  onClose: () => void;
};

const BASE_ORDER: PropositionBaseCategory[] = ['Anchor', 'Seed', 'Close', 'Texture'];

const tabs = ['Distribution', 'Top', 'Arcs', 'Scenes'] as const;
type Tab = typeof tabs[number];

// ── Distribution Tab ────────────────────────────────────────────────────────

function DistributionTab({ narrative, resolvedKeys }: { narrative: NarrativeState; resolvedKeys: string[] }) {
  const { sceneProfiles, getClassification } = usePropositionClassification();

  const stats = useMemo(() => {
    if (!sceneProfiles) return null;

    const baseTotals: Record<PropositionBaseCategory, number> = { Anchor: 0, Seed: 0, Close: 0, Texture: 0 };
    let total = 0;

    // Count local/global per base category by scanning all propositions
    const reachCounts: Record<PropositionBaseCategory, { local: number; global: number }> = {
      Anchor: { local: 0, global: 0 },
      Seed: { local: 0, global: 0 },
      Close: { local: 0, global: 0 },
      Texture: { local: 0, global: 0 },
    };

    for (const key of resolvedKeys) {
      const entry = resolveEntry(narrative, key);
      if (!entry || !isScene(entry)) continue;
      const plan = entry.planVersions?.[entry.planVersions.length - 1]?.plan;
      if (!plan?.beats) continue;

      for (let bi = 0; bi < plan.beats.length; bi++) {
        const beat = plan.beats[bi];
        if (!beat.propositions) continue;
        for (let pi = 0; pi < beat.propositions.length; pi++) {
          const cls = getClassification(entry.id, bi, pi);
          if (!cls) continue;
          baseTotals[cls.base]++;
          total++;
          if (cls.reach === 'Global') reachCounts[cls.base].global++;
          else reachCounts[cls.base].local++;
        }
      }
    }

    const anchorRatio = total > 0 ? baseTotals.Anchor / total : 0;
    const globalAnchorRatio = baseTotals.Anchor > 0 ? reachCounts.Anchor.global / baseTotals.Anchor : 0;
    const globalSeedRatio = baseTotals.Seed > 0 ? reachCounts.Seed.global / baseTotals.Seed : 0;
    const globalCloseRatio = baseTotals.Close > 0 ? reachCounts.Close.global / baseTotals.Close : 0;

    return { baseTotals, reachCounts, total, anchorRatio, globalAnchorRatio, globalSeedRatio, globalCloseRatio };
  }, [sceneProfiles, narrative, resolvedKeys, getClassification]);

  if (!stats) {
    return <div className="text-[10px] text-text-dim py-8 text-center">Classification not yet computed. Open a world view with propositions.</div>;
  }

  const maxCount = Math.max(...BASE_ORDER.map(b => stats.baseTotals[b]));

  return (
    <div className="space-y-5">
      {/* Base category distribution bars */}
      <div>
        <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest mb-3 pb-1 border-b border-border/30">
          Category Distribution <span className="text-text-dim font-normal">({stats.total} propositions)</span>
        </h3>
        <div className="space-y-2">
          {BASE_ORDER.map((base) => {
            const count = stats.baseTotals[base];
            const pct = stats.total > 0 ? count / stats.total : 0;
            const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;
            const localCount = stats.reachCounts[base].local;
            const globalCount = stats.reachCounts[base].global;
            const localPct = count > 0 ? (localCount / count) * 100 : 0;

            return (
              <div key={base}>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] w-16 text-right font-medium lowercase" style={{ color: BASE_COLORS[base] }}>
                    {base}
                  </span>
                  <div className="flex-1 h-4 bg-white/5 rounded-sm overflow-hidden relative">
                    {/* Stacked bar: local (lighter) + global (darker) */}
                    <div className="h-full flex">
                      <div
                        className="h-full"
                        style={{ width: `${barWidth * (localPct / 100)}%`, backgroundColor: BASE_COLORS[base], opacity: 0.5 }}
                      />
                      <div
                        className="h-full"
                        style={{ width: `${barWidth * (1 - localPct / 100)}%`, backgroundColor: classificationColor(base, 'Global'), opacity: 0.7 }}
                      />
                    </div>
                    <span className="absolute right-1.5 top-0.5 text-[8px] font-mono text-text-dim">
                      {count} ({(pct * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-18 mt-0.5">
                  <span className="text-[8px] font-mono text-text-dim">
                    local {localCount} / global {globalCount}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Base category summary cards */}
      <div>
        <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest mb-3 pb-1 border-b border-border/30">
          Base Categories
        </h3>
        <div className="grid grid-cols-4 gap-3">
          {BASE_ORDER.map((base) => {
            const count = stats.baseTotals[base];
            const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
            return (
              <div key={base} className="bg-bg-elevated/50 rounded-lg p-3 border border-border/20 text-center">
                <div className="text-[18px] font-bold font-mono" style={{ color: BASE_COLORS[base] }}>{pct.toFixed(0)}%</div>
                <div className="text-[9px] font-medium mt-0.5 lowercase" style={{ color: BASE_COLORS[base] }}>{base}</div>
                <div className="text-[8px] text-text-dim mt-0.5">{count} props</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Arc trajectory sparklines */}
      <ArcTrajectoryCharts narrative={narrative} resolvedKeys={resolvedKeys} />
    </div>
  );
}

// ── Arc Trajectory Charts ───────────────────────────────────────────────────

function ArcTrajectoryCharts({ narrative, resolvedKeys }: { narrative: NarrativeState; resolvedKeys: string[] }) {
  const { sceneProfiles } = usePropositionClassification();

  const arcData = useMemo(() => {
    if (!sceneProfiles) return null;

    const arcMap = new Map<string, { name: string; sceneIds: string[]; order: number }>();
    let idx = 0;
    for (const key of resolvedKeys) {
      const entry = resolveEntry(narrative, key);
      if (!entry || !isScene(entry)) continue;
      const arcId = entry.arcId ?? '_ungrouped';
      if (!arcMap.has(arcId)) {
        const arc = arcId !== '_ungrouped' ? narrative.arcs?.[arcId] : null;
        arcMap.set(arcId, { name: arc?.name ?? `Arc ${arcMap.size + 1}`, sceneIds: [], order: idx });
      }
      arcMap.get(arcId)!.sceneIds.push(entry.id);
      idx++;
    }

    const arcs = Array.from(arcMap.values()).sort((a, b) => a.order - b.order);
    const perCategory: Record<PropositionBaseCategory, number[]> = { Anchor: [], Seed: [], Close: [], Texture: [] };

    for (const arc of arcs) {
      let total = 0;
      const counts: Record<PropositionBaseCategory, number> = { Anchor: 0, Seed: 0, Close: 0, Texture: 0 };
      for (const sid of arc.sceneIds) {
        const dist = sceneProfiles.get(sid);
        if (!dist) continue;
        for (const b of BASE_ORDER) { counts[b] += dist[b]; total += dist[b]; }
      }
      for (const b of BASE_ORDER) {
        perCategory[b].push(total > 0 ? (counts[b] / total) * 100 : 0);
      }
    }

    return { perCategory, arcCount: arcs.length };
  }, [narrative, resolvedKeys, sceneProfiles]);

  if (!arcData || arcData.arcCount < 2) return null;

  return (
    <div>
      <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest mb-3 pb-1 border-b border-border/30">
        Arc Trajectory
      </h3>
      <div className="grid grid-cols-4 gap-2">
        {BASE_ORDER.map((base) => {
          const values = arcData.perCategory[base];
          const maxVal = Math.max(...values, 1);
          const trend = values[values.length - 1] - values[0];

          return (
            <div key={base} className="bg-bg-elevated/50 rounded-lg p-2.5 border border-border/20">
              <div className="text-[9px] font-medium mb-1 lowercase" style={{ color: BASE_COLORS[base] }}>{base}</div>
              <div className="flex items-end gap-0.5 h-10">
                {values.map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm"
                    style={{
                      height: `${Math.max(4, (v / maxVal) * 100)}%`,
                      backgroundColor: BASE_COLORS[base],
                      opacity: 0.4 + (i / values.length) * 0.6,
                    }}
                  />
                ))}
              </div>
              <div className="text-[8px] font-mono text-text-dim mt-1">
                {trend >= 0 ? '\u2191' : '\u2193'} {Math.abs(trend).toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Arcs Tab ──────────────────────────────────────────────────────────────

type ArcPhase = {
  name: string;
  sceneCount: number;
  totals: Record<PropositionBaseCategory, number>;
  total: number;
};

function PhasesTab({ narrative, resolvedKeys }: { narrative: NarrativeState; resolvedKeys: string[] }) {
  const { sceneProfiles, getClassification } = usePropositionClassification();

  type ReachCounts = Record<PropositionBaseCategory, { local: number; global: number }>;

  const arcPhases = useMemo(() => {
    if (!sceneProfiles) return null;

    const arcMap = new Map<string, { name: string; sceneIds: string[]; order: number }>();
    let sceneIdx = 0;

    for (const key of resolvedKeys) {
      const entry = resolveEntry(narrative, key);
      if (!entry || !isScene(entry)) continue;
      const arcId = entry.arcId ?? '_ungrouped';
      if (!arcMap.has(arcId)) {
        const arc = arcId !== '_ungrouped' ? narrative.arcs?.[arcId] : null;
        arcMap.set(arcId, { name: arc?.name ?? `Arc ${arcMap.size + 1}`, sceneIds: [], order: sceneIdx });
      }
      arcMap.get(arcId)!.sceneIds.push(entry.id);
      sceneIdx++;
    }

    if (arcMap.size === 0) return null;

    const phases: (ArcPhase & { reach: ReachCounts })[] = [];
    for (const [, arc] of Array.from(arcMap.entries()).sort((a, b) => a[1].order - b[1].order)) {
      const totals: Record<PropositionBaseCategory, number> = { Anchor: 0, Seed: 0, Close: 0, Texture: 0 };
      const reach: ReachCounts = {
        Anchor: { local: 0, global: 0 }, Seed: { local: 0, global: 0 },
        Close: { local: 0, global: 0 }, Texture: { local: 0, global: 0 },
      };
      let total = 0;

      for (const sid of arc.sceneIds) {
        const scene = narrative.scenes[sid];
        const plan = scene?.planVersions?.[scene.planVersions!.length - 1]?.plan;
        if (!plan?.beats) continue;
        for (let bi = 0; bi < plan.beats.length; bi++) {
          const beat = plan.beats[bi];
          if (!beat.propositions) continue;
          for (let pi = 0; pi < beat.propositions.length; pi++) {
            const cls = getClassification(sid, bi, pi);
            if (!cls) continue;
            totals[cls.base]++;
            total++;
            if (cls.reach === 'Global') reach[cls.base].global++;
            else reach[cls.base].local++;
          }
        }
      }

      if (total > 0) {
        phases.push({ name: arc.name, sceneCount: arc.sceneIds.length, totals, total, reach });
      }
    }

    return phases;
  }, [narrative, resolvedKeys, sceneProfiles, getClassification]);

  if (!arcPhases || arcPhases.length === 0) {
    return <div className="text-[10px] text-text-dim py-8 text-center">Classification not yet computed or no arcs found.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="text-[10px] text-text-dim leading-relaxed">
        Category distribution per narrative arc. Lighter = local reach, darker = global reach.
      </div>

      <div className="space-y-3">
        {arcPhases.map((arc, idx) => (
          <div key={idx}>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[10px] font-semibold text-text-primary">{arc.name}</span>
              <span className="text-[8px] font-mono text-text-dim">{arc.sceneCount} scenes · {arc.total} props</span>
            </div>
            <div className="flex h-5 rounded-sm overflow-hidden bg-white/5">
              {BASE_ORDER.map((b) => {
                const local = arc.reach[b].local;
                const global = arc.reach[b].global;
                if (local + global === 0) return null;
                const localPct = (local / arc.total) * 100;
                const globalPct = (global / arc.total) * 100;
                return (
                  <React.Fragment key={b}>
                    {local > 0 && (
                      <div className="h-full" style={{ width: `${localPct}%`, backgroundColor: BASE_COLORS[b], opacity: 0.5 }}
                        title={`local ${b.toLowerCase()}: ${local}`} />
                    )}
                    {global > 0 && (
                      <div className="h-full" style={{ width: `${globalPct}%`, backgroundColor: classificationColor(b, 'Global'), opacity: 0.8 }}
                        title={`global ${b.toLowerCase()}: ${global}`} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            <div className="flex gap-2 mt-1 flex-wrap">
              {BASE_ORDER.filter(b => arc.totals[b] > 0).map(b => (
                <span key={b} className="text-[8px] font-mono lowercase" style={{ color: BASE_COLORS[b] }}>
                  {b}:{((arc.totals[b] / arc.total) * 100).toFixed(0)}%
                  <span className="text-text-dim"> ({arc.reach[b].local}L/{arc.reach[b].global}G)</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Trajectory sparklines for base categories */}
      {arcPhases.length >= 3 && (
        <div>
          <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-widest mb-3 pb-1 border-b border-border/30">
            Arc Trajectory
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {BASE_ORDER.map((base) => {
              const values = arcPhases.map(arc =>
                arc.total > 0 ? (arc.totals[base] / arc.total) * 100 : 0
              );
              const maxVal = Math.max(...values, 1);
              const trend = values[values.length - 1] - values[0];

              return (
                <div key={base} className="bg-bg-elevated/50 rounded-lg p-2.5 border border-border/20">
                  <div className="text-[9px] font-medium mb-1 lowercase" style={{ color: BASE_COLORS[base] }}>{base}</div>
                  <div className="flex items-end gap-0.5 h-8">
                    {values.map((v, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t-sm"
                        style={{
                          height: `${Math.max(4, (v / maxVal) * 100)}%`,
                          backgroundColor: BASE_COLORS[base],
                          opacity: 0.5 + (i / values.length) * 0.5,
                        }}
                      />
                    ))}
                  </div>
                  <div className="text-[8px] font-mono text-text-dim mt-1">
                    {trend >= 0 ? '\u2191' : '\u2193'} {Math.abs(trend).toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Scenes Tab ──────────────────────────────────────────────────────────────

function ScenesTab({ narrative, resolvedKeys }: { narrative: NarrativeState; resolvedKeys: string[] }) {
  const { sceneProfiles, getClassification } = usePropositionClassification();

  type SceneRow = {
    id: string;
    summary: string;
    total: number;
    dominant: PropositionBaseCategory;
    reach: Record<PropositionBaseCategory, { local: number; global: number }>;
  };

  const sceneData = useMemo(() => {
    if (!sceneProfiles) return null;

    const data: SceneRow[] = [];

    for (const key of resolvedKeys) {
      const entry = resolveEntry(narrative, key);
      if (!entry || !isScene(entry)) continue;

      const dist = sceneProfiles.get(entry.id);
      if (!dist) continue;

      const total = BASE_ORDER.reduce((s, b) => s + dist[b], 0);
      if (total === 0) continue;

      // Scan propositions for local/global
      const reach: Record<PropositionBaseCategory, { local: number; global: number }> = {
        Anchor: { local: 0, global: 0 }, Seed: { local: 0, global: 0 },
        Close: { local: 0, global: 0 }, Texture: { local: 0, global: 0 },
      };
      const plan = entry.planVersions?.[entry.planVersions.length - 1]?.plan;
      if (plan?.beats) {
        for (let bi = 0; bi < plan.beats.length; bi++) {
          const beat = plan.beats[bi];
          if (!beat.propositions) continue;
          for (let pi = 0; pi < beat.propositions.length; pi++) {
            const cls = getClassification(entry.id, bi, pi);
            if (!cls) continue;
            if (cls.reach === 'Global') reach[cls.base].global++;
            else reach[cls.base].local++;
          }
        }
      }

      let dominant: PropositionBaseCategory = 'Texture';
      let maxCount = 0;
      for (const b of BASE_ORDER) {
        if (dist[b] > maxCount) { maxCount = dist[b]; dominant = b; }
      }

      data.push({ id: entry.id, summary: (entry.summary ?? '').slice(0, 80), total, dominant, reach });
    }

    return data;
  }, [narrative, resolvedKeys, sceneProfiles, getClassification]);

  if (!sceneData) {
    return <div className="text-[10px] text-text-dim py-8 text-center">Classification not yet computed.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-text-dim leading-relaxed mb-3">
        Per-scene composition. Lighter = local, darker = global reach.
      </div>

      {sceneData.map((scene, idx) => (
        <div key={scene.id} className="flex items-center gap-2">
          <span className="text-[8px] font-mono text-text-dim w-5 text-right shrink-0">{idx + 1}</span>
          <div className="flex h-3 rounded-sm overflow-hidden bg-white/5 w-32 shrink-0">
            {BASE_ORDER.map((b) => {
              const local = scene.reach[b].local;
              const global = scene.reach[b].global;
              if (local + global === 0) return null;
              return (
                <React.Fragment key={b}>
                  {local > 0 && (
                    <div className="h-full" style={{ width: `${(local / scene.total) * 100}%`, backgroundColor: BASE_COLORS[b], opacity: 0.5 }} />
                  )}
                  {global > 0 && (
                    <div className="h-full" style={{ width: `${(global / scene.total) * 100}%`, backgroundColor: classificationColor(b, 'Global'), opacity: 0.8 }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
          <span className="text-[8px] font-mono shrink-0 lowercase" style={{ color: BASE_COLORS[scene.dominant] }}>
            {scene.dominant}
          </span>
          <span className="text-[9px] text-text-dim truncate">{scene.summary}</span>
        </div>
      ))}
    </div>
  );
}

// ── Top Tab ────────────────────────────────────────────────────────────────

type RankedProp = {
  content: string;
  sceneIndex: number;
  sceneSummary: string;
  strength: number;
  base: PropositionBaseCategory;
  reach: PropositionReach;
};

const INITIAL_SHOW = 5;
const SHOW_MORE_INCREMENT = 10;

function TopTab({ narrative, resolvedKeys }: { narrative: NarrativeState; resolvedKeys: string[] }) {
  const { getClassification } = usePropositionClassification();
  const [expanded, setExpanded] = useState<Record<string, number>>({});

  const ranked = useMemo(() => {
    const buckets = new Map<string, RankedProp[]>();
    for (const profile of ALL_PROFILE_LABELS) {
      buckets.set(`${profile.base}:${profile.reach}`, []);
    }

    let sceneIdx = 0;
    for (const key of resolvedKeys) {
      const entry = resolveEntry(narrative, key);
      if (!entry || !isScene(entry)) continue;
      sceneIdx++;
      const plan = entry.planVersions?.[entry.planVersions.length - 1]?.plan;
      if (!plan?.beats) continue;

      for (let bi = 0; bi < plan.beats.length; bi++) {
        const beat = plan.beats[bi];
        if (!beat.propositions) continue;
        for (let pi = 0; pi < beat.propositions.length; pi++) {
          const cls = getClassification(entry.id, bi, pi);
          if (!cls) continue;

          // Strength metric depends on category
          let strength: number;
          if (cls.base === 'Anchor') strength = cls.backward + cls.forward;
          else if (cls.base === 'Seed') strength = cls.forward;
          else if (cls.base === 'Close') strength = cls.backward;
          else strength = Math.max(cls.backward, cls.forward);

          const bucketKey = `${cls.base}:${cls.reach}`;
          const bucket = buckets.get(bucketKey)!;
          bucket.push({
            content: beat.propositions[pi].content,
            sceneIndex: sceneIdx,
            sceneSummary: (entry.summary ?? '').slice(0, 60),
            strength,
            base: cls.base,
            reach: cls.reach,
          });
        }
      }
    }

    // Sort each bucket by strength descending
    const result = new Map<string, RankedProp[]>();
    for (const [k, props] of buckets) {
      props.sort((a, b) => b.strength - a.strength);
      result.set(k, props);
    }
    return result;
  }, [narrative, resolvedKeys, getClassification]);

  if (ranked.size === 0) {
    return <div className="text-[10px] text-text-dim py-8 text-center">Classification not yet computed.</div>;
  }

  return (
    <div className="space-y-5">
      {ALL_PROFILE_LABELS.map((profile) => {
        const key = `${profile.base}:${profile.reach}`;
        const allProps = ranked.get(key);
        if (!allProps || allProps.length === 0) return null;

        const limit = expanded[key] ?? INITIAL_SHOW;
        const visible = allProps.slice(0, limit);
        const remaining = allProps.length - limit;

        return (
          <div key={key}>
            <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-2 pb-1 border-b border-border/30 flex items-center gap-2">
              <span style={{ color: profile.color }}>{profile.label}</span>
              <span className="text-text-dim font-normal normal-case tracking-normal">
                {profile.base} · {profile.reach} · {allProps.length}
              </span>
            </h3>
            <div className="space-y-1.5">
              {visible.map((p, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="text-[8px] font-mono text-text-dim w-3 text-right shrink-0 mt-0.5">{i + 1}</span>
                  <div
                    className="w-1 shrink-0 rounded-full mt-0.5"
                    style={{ height: 12, backgroundColor: profile.color, opacity: Math.max(0.3, 0.8 - i * 0.03) }}
                  />
                  <div className="min-w-0">
                    <div className="text-[10px] text-text-primary leading-snug">{p.content}</div>
                    <div className="text-[8px] text-text-dim font-mono mt-0.5">
                      scene {p.sceneIndex} · {p.strength.toFixed(3)}
                      {p.sceneSummary && <span className="ml-1 text-text-dim/60">— {p.sceneSummary}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {remaining > 0 && (
              <button
                onClick={() => setExpanded(prev => ({ ...prev, [key]: limit + SHOW_MORE_INCREMENT }))}
                className="text-[9px] text-text-dim hover:text-text-secondary mt-1.5 ml-5 transition-colors"
              >
                show {Math.min(remaining, SHOW_MORE_INCREMENT)} more ({remaining} remaining)
              </button>
            )}
            {limit > INITIAL_SHOW && (
              <button
                onClick={() => setExpanded(prev => { const next = { ...prev }; delete next[key]; return next; })}
                className="text-[9px] text-text-dim hover:text-text-secondary mt-1.5 ml-3 transition-colors"
              >
                collapse
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Modal ──────────────────────────────────────────────────────────────

export function PropositionAnalysisModal({ narrative, resolvedKeys, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('Distribution');

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
                  ? 'bg-bg-elevated text-text-primary'
                  : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </ModalHeader>
      <ModalBody className="px-5 py-4 max-h-[70vh] overflow-y-auto">
        {tab === 'Distribution' && <DistributionTab narrative={narrative} resolvedKeys={resolvedKeys} />}
        {tab === 'Top' && <TopTab narrative={narrative} resolvedKeys={resolvedKeys} />}
        {tab === 'Arcs' && <PhasesTab narrative={narrative} resolvedKeys={resolvedKeys} />}
        {tab === 'Scenes' && <ScenesTab narrative={narrative} resolvedKeys={resolvedKeys} />}
      </ModalBody>
    </Modal>
  );
}
