// World-view report generation — LLM synthesis of the narrative into a structured analysis report.

import type { SlidesData } from '@/lib/slides-data';
import type { NarrativeState } from '@/types/narrative';
import { NARRATIVE_CUBE, type CubeCornerKey } from '@/types/narrative';
import { detectCubeCorner, resolveEntityName } from '@/lib/forces/narrative-utils';
import { callGenerate, resolveReasoningBudget, resolveWebsearch } from './api';
import { parseJson } from './json';
import { DEFAULT_MODEL, MAX_TOKENS_SMALL, ANALYSIS_TEMPERATURE } from '@/lib/constants';
import { REPORT_SYSTEM, REPORT_ANALYSIS_PROMPT, REPORT_SECTIONS } from '@/lib/prompts';
import { logError, logInfo } from '@/lib/core/system-logger';

// ── Types ────────────────────────────────────────────────────────────────────

export type ReportAnalysis = {
  /** 2-3 sentences. Opens with the world-view framing — what reality the work models, what paradigm it sits in, who or what populates it. */
  world_view_intro: string;
  /** 2-3 sentences. The work's paradigm explicitly named, plus how the three forces should be read through it (which is structurally load-bearing). */
  paradigm_lens: string;
  /** 2-3 sentences. Headline: overall score + signature archetype + dominant force. Sits beside the score display. */
  verdict: string;
  /** 3-5 sentences. The work's signature on the unit 3-simplex — archetype, force balance, what the mix means as a structural choice. */
  signature: string;
  /** 1-2 short paragraphs. What the activity curve reveals about how hard the world view is working — peaks (all three forces firing) vs valleys. */
  activity: string;
  /** 1-2 short paragraphs. How Fate, World, and System interact; which is load-bearing for the paradigm; which carries the work in practice. */
  forces: string;
  /** 3-5 sentences. Per-force evolution over the timeline — z-scored peaks/valleys, phase takeovers, convergences. */
  forces_over_time: string;
  /** 3-5 sentences. Scene-to-scene volatility — steady / varied / erratic; a specific high-swing moment and which force lurched. */
  swing: string;
  /** 3-5 sentences. How time advances — concurrent / minute / day / year-paced compressions and dilations; flashback handling. */
  time_flow: string;
  /** Array of per-segment commentaries — one short paragraph each, in order. */
  segments: string[];
  /** 3-5 sentences. The anchor entities — who/what carries the world view (characters, sources, panelists, agents). POV distribution. */
  cast: string;
  /** 2-3 sentences. Whether settings do structural work or are interchangeable backdrops. For non-fiction, the institutional / archival ground. */
  locations: string;
  /** 2-3 short paragraphs. The work's belief system — aggregate of every open stance. Saturating / contested / volatile / committed beliefs, in lean-and-doubt language. */
  belief_system: string;
  /** 2-3 short paragraphs. The System force made visible — rule set depth, principle interconnection, whether rules compose or sit isolated. */
  knowledge_structure: string;
  /** 1-2 short paragraphs. How quality evolves across arcs; where force weight shifts between arcs. */
  arcs: string;
  /** 1-2 short paragraphs. Proposition classification — anchor ratio, seed→close conversion, local/global balance across arcs. */
  propositions: string;
  /** 2-3 sentences. What this world view does best + the single most impactful change to deepen it. Forward-looking. */
  closing: string;
};

// REPORT_SECTIONS now lives in src/lib/prompts/report/analysis.ts — single
// source of truth shared by the prompt and the reducer, guarded by the
// prompt test.

// ── Helpers ──────────────────────────────────────────────────────────────────

const avg = (arr: number[]) => arr.length > 0 ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2) : '0';
const stdDev = (arr: number[]) => {
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length).toFixed(2);
};

// ── Story context builder ────────────────────────────────────────────────────

function buildStoryContext(narrative: NarrativeState, data: SlidesData, _resolvedKeys: string[]): string {
  const scenes = data.scenes;
  const n = scenes.length;
  const raw = data.rawForces;

  // ── Full scene-by-scene narrative ──
  const sceneBlock = scenes.map((scene, idx) => {
    const povName = scene.povId ? (narrative.characters[scene.povId]?.name ?? scene.povId) : 'narrator';
    const locName = narrative.locations[scene.locationId]?.name ?? scene.locationId;
    const participants = scene.participantIds
      .filter((id) => id !== scene.povId)
      .map((id) => narrative.characters[id]?.name ?? id);
    const corner = detectCubeCorner(data.forceSnapshots[idx]);
    const activity = data.activityCurve[idx];

    const threadMuts = scene.threadDeltas.map((tm) => {
      const desc = narrative.threads[tm.threadId]?.description ?? tm.threadId;
      const moves = (tm.updates ?? [])
        .map((u) => `${u.outcome}${u.evidence >= 0 ? '+' : ''}${u.evidence}`)
        .join(' ');
      return `  ${desc.slice(0, 60)}: [${tm.logType}] ${moves}`;
    });

    const relMuts = scene.relationshipDeltas.map((rm) => {
      const fromName = narrative.characters[rm.from]?.name ?? rm.from;
      const toName = narrative.characters[rm.to]?.name ?? rm.to;
      return `  ${fromName} ↔ ${toName} (${rm.type}): ${rm.valenceDelta > 0 ? '+' : ''}${rm.valenceDelta.toFixed(1)}`;
    });

    const contMuts = scene.worldDeltas.slice(0, 4).flatMap((cm) => {
      const entityName = resolveEntityName(narrative, cm.entityId);
      return (cm.addedNodes ?? []).map(node => `  ${entityName} +: ${node.content.slice(0, 60)}`);
    });

    const events = scene.events.length > 0 ? `  Events: ${scene.events.join(', ')}` : '';

    let block = `[Scene ${idx + 1}] "${scene.summary}"`;
    block += `\n  POV: ${povName} | Location: ${locName} | Mode: ${corner.name}`;
    if (participants.length > 0) block += ` | With: ${participants.join(', ')}`;
    if (activity) block += `\n  Activity: ${activity.activity.toFixed(2)} | Tension: ${activity.tension.toFixed(2)}${activity.isPeak ? ' [PEAK]' : ''}${activity.isValley ? ' [VALLEY]' : ''}`;
    if (events) block += `\n${events}`;
    if (threadMuts.length > 0) block += `\n  Thread deltas:\n${threadMuts.join('\n')}`;
    if (relMuts.length > 0) block += `\n  Relationship shifts:\n${relMuts.join('\n')}`;
    if (contMuts.length > 0) block += `\n  Character knowledge:\n${contMuts.join('\n')}`;

    return block;
  }).join('\n\n');

  // ── Character profiles ──
  const charBlock = data.topCharacters.slice(0, 10).map((c) => {
    const char = c.character;
    const knowledge = Object.values(char.world.nodes).slice(0, 6).map((n) => `${n.type}: ${n.content.slice(0, 50)}`).join('; ');
    const threadDescs = char.threadIds
      .map((tid) => narrative.threads[tid]?.description)
      .filter(Boolean)
      .slice(0, 3)
      .join('; ');
    return `${char.name} (${char.role}, ${c.sceneCount} scenes)${threadDescs ? ` — threads: ${threadDescs}` : ''}${knowledge ? ` — knows: ${knowledge}` : ''}`;
  }).join('\n  ');

  // ── Relationship network ──
  const relationships = Object.values(narrative.characters).flatMap((char) => {
    return (narrative.relationships ?? [])
      .filter((r) => r.from === char.id || r.to === char.id)
      .slice(0, 3)
      .map((r) => {
        const fromName = narrative.characters[r.from]?.name ?? r.from;
        const toName = narrative.characters[r.to]?.name ?? r.to;
        return `${fromName} → ${toName}: ${r.type} (valence ${r.valence.toFixed(1)})`;
      });
  });
  const uniqueRels = [...new Set(relationships)].slice(0, 15);

  // ── Thread portfolio with full lifecycle ──
  const threadBlock = data.threadLifecycles.map((tl) => {
    const thread = narrative.threads[tl.threadId];
    const participants = thread?.participants
      ?.filter((p) => p.type === 'character')
      .map((p) => narrative.characters[p.id]?.name ?? p.id)
      .join(', ') ?? '';
    const transitions = tl.statuses
      .filter((s, i) => i === 0 || s.status !== tl.statuses[i - 1].status)
      .map((s) => `scene ${s.sceneIdx + 1}: ${s.status}`)
      .join(' → ');
    return `"${tl.description}" [${participants}]: ${transitions}`;
  }).join('\n  ');

  // ── Arc structure with direction ──
  const arcBlock = data.arcGrades.map((ag) => {
    const arc = narrative.arcs[ag.arcId];
    const direction = arc?.directionVector ?? '';
    const sceneRange = arc?.sceneIds.length > 0
      ? `scenes ${scenes.findIndex((s) => s.id === arc.sceneIds[0]) + 1}–${scenes.findIndex((s) => s.id === arc.sceneIds[arc.sceneIds.length - 1]) + 1}`
      : '';
    return `"${ag.arcName}" (${ag.sceneCount} scenes, ${sceneRange}): Score ${ag.grades.overall}/100 [F=${ag.grades.fate} W=${ag.grades.world} S=${ag.grades.system} Sw=${ag.grades.swing}]${direction ? ` — Direction: "${direction}"` : ''}`;
  }).join('\n  ');

  // ── Cube sequence ──
  const sequence = data.forceSnapshots.map((s) => detectCubeCorner(s));
  const visitCounts = {} as Record<CubeCornerKey, number>;
  const corners: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];
  for (const c of corners) visitCounts[c] = 0;
  for (const s of sequence) visitCounts[s.key]++;
  let selfLoops = 0;
  for (let i = 1; i < sequence.length; i++) if (sequence[i].key === sequence[i - 1].key) selfLoops++;

  const cubeBlock = corners
    .filter((c) => visitCounts[c] > 0)
    .sort((a, b) => visitCounts[b] - visitCounts[a])
    .map((c) => `${NARRATIVE_CUBE[c].name}: ${visitCounts[c]}x (${((visitCounts[c] / n) * 100).toFixed(0)}%)`)
    .join(', ');

  const transBlock = data.cubeTransitions.slice(0, 8).map((t) =>
    `${NARRATIVE_CUBE[t.from].name}→${NARRATIVE_CUBE[t.to].name} ${t.count}x`
  ).join(', ');

  // ── Location context ──
  const locBlock = data.topLocations.slice(0, 6).map((l) => {
    const loc = l.location;
    const knowledge = Object.values(loc.world?.nodes ?? {}).slice(0, 3).map((n) => n.content.slice(0, 40)).join('; ');
    const tiedNames = loc.tiedCharacterIds
      .map((id) => narrative.characters[id]?.name)
      .filter(Boolean);
    const tiedStr = tiedNames.length > 0 ? ` [ties: ${tiedNames.join(', ')}]` : '';
    return `${loc.name} (${l.sceneCount} scenes)${tiedStr}${knowledge ? ` — ${knowledge}` : ''}`;
  }).join('\n  ');

  // ── Artifact context ──
  const artBlock = data.topArtifacts.slice(0, 6).map((a) => {
    const art = a.artifact;
    const owner = art.parentId ? resolveEntityName(narrative, art.parentId) : 'world';
    return `${art.name} (${a.usageCount} usages, ${art.significance}, owner: ${owner})`;
  }).join('\n  ');

  return `═══ NARRATIVE: "${data.title}" ═══
${data.description}

═══ METRICS ═══
Score: ${data.overallGrades.overall}/100 | Shape: ${data.shape.name} | Archetype: ${data.archetype.name}
Fate: ${data.overallGrades.fate}/25 (avg ${avg(raw.fate)}, σ ${stdDev(raw.fate)}, peak ${Math.max(...raw.fate).toFixed(2)})
World: ${data.overallGrades.world}/25 (avg ${avg(raw.world)}, σ ${stdDev(raw.world)}, peak ${Math.max(...raw.world).toFixed(2)})
System: ${data.overallGrades.system}/25 (avg ${avg(raw.system)}, σ ${stdDev(raw.system)}, peak ${Math.max(...raw.system).toFixed(2)})
Swing: ${data.overallGrades.swing}/25 (avg ${avg(data.swings)}, σ ${stdDev(data.swings)}, peak ${Math.max(...data.swings).toFixed(2)})
Peaks: ${data.peaks.length} | Valleys: ${data.troughs.length}

═══ CHARACTERS ═══
  ${charBlock}

═══ LOCATIONS ═══
  ${locBlock}

═══ ARTIFACTS ═══
  ${artBlock || 'None'}

═══ RELATIONSHIPS ═══
  ${uniqueRels.join('\n  ') || 'None tracked'}

═══ THREADS ═══
  ${threadBlock || 'No threads'}

═══ ARCS ═══
  ${arcBlock || 'No arcs'}

═══ SEGMENTS (narrative divided at valleys) ═══
${data.segments.map((seg, i) => {
    const peaksInSeg = data.peaks.filter((p) => p.sceneIdx >= seg.startIdx && p.sceneIdx <= seg.endIdx);
    const valleysInSeg = data.troughs.filter((t) => t.sceneIdx >= seg.startIdx && t.sceneIdx <= seg.endIdx);
    const keySceneBlock = seg.keyScenes.map((ks) => `  Scene ${ks.idx + 1} (A=${ks.activity.toFixed(2)}): "${ks.summary}"`).join('\n');
    const threadBlock = seg.threadChanges.slice(0, 5).map((tc) => {
      const desc = narrative.threads[tc.threadId]?.description ?? tc.threadId;
      const moves = (tc.updates ?? [])
        .map((u) => `${u.outcome}${u.evidence >= 0 ? '+' : ''}${u.evidence}`)
        .join(' ');
      return `  ${desc.slice(0, 50)}: [${tc.logType}] ${moves} (scene ${tc.sceneIdx + 1})`;
    }).join('\n');
    return `Segment ${i + 1} (scenes ${seg.startIdx + 1}–${seg.endIdx + 1}, ${seg.endIdx - seg.startIdx + 1} scenes):
  Dominant: ${seg.dominantForce} | Avg activity: ${seg.avgActivity.toFixed(2)} | Peaks: ${peaksInSeg.length} | Valleys: ${valleysInSeg.length}
${keySceneBlock}${threadBlock ? '\n  Thread activity:\n' + threadBlock : ''}`;
  }).join('\n\n')}

═══ STATE MACHINE ═══
Distribution: ${cubeBlock}
Self-loop rate: ${((selfLoops / Math.max(sequence.length - 1, 1)) * 100).toFixed(0)}%
Top transitions: ${transBlock}

═══ PROPOSITIONS ═══
Total: ${data.propositionCount} propositions across ${n} scenes
Base categories: Anchor ${data.propositionTotals.Anchor} (${data.propositionCount > 0 ? ((data.propositionTotals.Anchor / data.propositionCount) * 100).toFixed(0) : 0}%), Seed ${data.propositionTotals.Seed} (${data.propositionCount > 0 ? ((data.propositionTotals.Seed / data.propositionCount) * 100).toFixed(0) : 0}%), Close ${data.propositionTotals.Close} (${data.propositionCount > 0 ? ((data.propositionTotals.Close / data.propositionCount) * 100).toFixed(0) : 0}%), Texture ${data.propositionTotals.Texture} (${data.propositionCount > 0 ? ((data.propositionTotals.Texture / data.propositionCount) * 100).toFixed(0) : 0}%)
Anchor ratio: ${data.propositionCount > 0 ? ((data.propositionTotals.Anchor / data.propositionCount) * 100).toFixed(1) : 0}% (20-30% = strong structure)
Anchor = load-bearing both directions. Seed = foreshadowing. Close = fate/resolution. Texture = atmosphere.
Each category has local and global variants with distinct names:
  Local: anchor, seed, close, texture (within-arc connections)
  Global: foundation, foreshadow, ending, atmosphere (cross-arc connections)

═══ SCENE-BY-SCENE NARRATIVE ═══
${sceneBlock}`;
}

// ── Report generation ────────────────────────────────────────────────────────

export async function generateReportAnalysis(
  narrative: NarrativeState,
  data: SlidesData,
  resolvedKeys: string[],
): Promise<ReportAnalysis> {
  const context = buildStoryContext(narrative, data, resolvedKeys);
  const prompt = REPORT_ANALYSIS_PROMPT(context);

  logInfo('Generating report analysis', {
    source: 'analysis',
    operation: 'report-analysis',
    details: {
      narrativeId: narrative.id,
      scenes: resolvedKeys.length,
      contextChars: context.length,
    },
  });

  const reasoningBudget = resolveReasoningBudget(narrative);
  const websearch = resolveWebsearch(narrative);
  let result: string;
  try {
    result = await callGenerate(prompt, REPORT_SYSTEM, MAX_TOKENS_SMALL, 'generateReportAnalysis', DEFAULT_MODEL, reasoningBudget, true, ANALYSIS_TEMPERATURE, websearch);
  } catch (err) {
    logError('Report analysis generation failed', err, {
      source: 'analysis',
      operation: 'report-analysis',
      details: { narrativeId: narrative.id },
    });
    throw err;
  }
  const parsed = parseJson(result, 'report-analysis') as Record<string, string>;

  const analysis = {} as ReportAnalysis;
  for (const key of REPORT_SECTIONS) {
    if (key === 'segments') {
      const raw = parsed[key];
      analysis.segments = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (analysis as any)[key] = (parsed[key] as string) ?? '';
    }
  }

  logInfo('Report analysis complete', {
    source: 'analysis',
    operation: 'report-analysis',
    details: {
      narrativeId: narrative.id,
      sections: Object.keys(analysis).length,
    },
  });

  return analysis;
}
