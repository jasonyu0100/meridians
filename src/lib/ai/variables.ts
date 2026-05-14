/**
 * Per-arc variable generation.
 *
 * No shared catalogue. Each arc owns its own custom-generated Present
 * variables. Each Future scenario owns its own custom-generated variable set
 * too — generated for that specific future at the moment of generation.
 *
 * The LLM does the work in one pass per arc / scenario set: it produces the
 * variable definitions and their intensities together. Probability across a
 * scenario cohort is softmax over LLM-estimated `priorLogit` values stored
 * on each scenario; intensity is NOT used as a probability proxy.
 */

import type {
  Variable,
  PlanningScenario,
  Arc,
  Scene,
  Character,
  Location,
  Artifact,
  Thread,
} from '@/types/narrative';
import {
  ANALYSIS_MODEL,
  ANALYSIS_TEMPERATURE,
  MAX_TOKENS_DEFAULT,
  MARKET_EVIDENCE_MIN,
  MARKET_EVIDENCE_MAX,
} from '@/lib/constants';
import { callGenerate, callGenerateStream } from './api';
import { parseJson } from './json';

/** Plausibility scale for scenario priors. Reuses the prediction market's
 *  evidence range so the two surfaces share a vocabulary: +4 = decisive
 *  evidence in favour, 0 = baseline plausibility, -4 = decisive evidence
 *  against / rare tail conditions. Aligned with MARKET_EVIDENCE_MIN/MAX so
 *  scenario priors and thread evidence speak the same units. */
const PRIOR_LOGIT_MIN = MARKET_EVIDENCE_MIN;
const PRIOR_LOGIT_MAX = MARKET_EVIDENCE_MAX;

// ── Narrative context source ───────────────────────────────────────────────

export interface VariablesContextSource {
  title: string;
  characters: Record<string, Character>;
  locations: Record<string, Location>;
  artifacts: Record<string, Artifact>;
  threads: Record<string, Thread>;
  arcs: Record<string, Arc>;
  scenes: Record<string, Scene>;
  orderedEntryIds: readonly string[];
  asOfEntryId?: string;
}

interface RenderOptions {
  includeArcStates?: boolean;
  focusArcId?: string;
}

function clean(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}

function cutoffSceneIds(src: VariablesContextSource): string[] {
  const ordered = [...src.orderedEntryIds];
  if (src.asOfEntryId) {
    const idx = ordered.indexOf(src.asOfEntryId);
    if (idx >= 0) ordered.length = idx + 1;
  }
  return ordered.filter((id) => !!src.scenes[id]);
}

function renderArcsBlock(src: VariablesContextSource): string {
  const arcFirstSeen = new Map<string, number>();
  const ordered = cutoffSceneIds(src);
  ordered.forEach((sid, i) => {
    const sc = src.scenes[sid];
    if (sc && !arcFirstSeen.has(sc.arcId)) arcFirstSeen.set(sc.arcId, i);
  });
  const arcsOrdered = Array.from(arcFirstSeen.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([arcId]) => src.arcs[arcId])
    .filter((a): a is Arc => !!a);
  if (arcsOrdered.length === 0) return '';
  return arcsOrdered
    .map((arc) => {
      const dir = arc.directionVector ? `\n    direction: ${clean(arc.directionVector)}` : '';
      const ws = arc.worldState ? `\n    state: ${clean(arc.worldState)}` : '';
      return `  - id: ${arc.id}\n    name: "${arc.name}"${dir}${ws}`;
    })
    .join('\n');
}

function renderScenesBlock(src: VariablesContextSource): string {
  const ordered = cutoffSceneIds(src);
  const total = ordered.length;
  if (total === 0) return '';
  const lines: string[] = [];
  ordered.forEach((sid, i) => {
    const sc = src.scenes[sid];
    if (!sc) return;
    const idx = i + 1;
    const arc = src.arcs[sc.arcId];
    const loc = src.locations[sc.locationId];
    const pov = sc.povId ? src.characters[sc.povId]?.name : null;
    const arcPrefix = arc ? `${arc.name}` : sc.arcId;
    const locName = loc ? loc.name : sc.locationId;
    const povStr = pov ? `pov=${pov}` : 'pov=—';
    const summary = sc.events.length > 0 ? clean(sc.events.join(' · ')) : '(no events)';
    lines.push(`  [${idx}] arc=${arcPrefix} loc=${locName} ${povStr} :: ${summary}`);
  });
  return lines.join('\n');
}

function renderThreadsBlock(src: VariablesContextSource): string {
  const ordered = cutoffSceneIds(src);
  const orderedSet = new Set(ordered);
  const lastScene = ordered[ordered.length - 1];
  const liveLines: string[] = [];
  const closedLines: { line: string; ord: number }[] = [];
  for (const t of Object.values(src.threads)) {
    if (lastScene && t.openedAt && !orderedSet.has(t.openedAt)) continue;
    const isClosed = !!t.closedAt && orderedSet.has(t.closedAt);
    const participants = t.participants
      .map((p) => src.characters[p.id]?.name || src.locations[p.id]?.name || src.artifacts[p.id]?.name || p.id)
      .join(', ');
    const beliefs = t.beliefs?.['__NARRATOR__'] ?? Object.values(t.beliefs ?? {})[0];
    let priceLine = '';
    if (beliefs && Array.isArray(beliefs.logits) && t.outcomes.length === beliefs.logits.length) {
      const max = Math.max(...beliefs.logits);
      const exps = beliefs.logits.map((l) => Math.exp(l - max));
      const sum = exps.reduce((a, b) => a + b, 0) || 1;
      const probs = exps.map((e) => e / sum);
      const top = probs
        .map((p, i) => ({ p, name: t.outcomes[i] }))
        .sort((a, b) => b.p - a.p);
      priceLine = ` — price: ${top.map((x) => `${x.name} ${(x.p * 100).toFixed(0)}%`).join(' / ')}`;
    }
    if (isClosed) {
      const winner = t.closeOutcome != null ? t.outcomes[t.closeOutcome] : '?';
      const idx = ordered.indexOf(t.closedAt!);
      closedLines.push({
        line: `  ${t.id}: "${clean(t.description)}" — closed ${winner}${t.resolutionQuality != null ? ` (q=${t.resolutionQuality.toFixed(2)})` : ''} :: ${participants}`,
        ord: idx,
      });
    } else {
      liveLines.push(`  ${t.id}: "${clean(t.description)}"${priceLine} :: ${participants}`);
    }
  }
  closedLines.sort((a, b) => b.ord - a.ord);
  const sections: string[] = [];
  if (liveLines.length > 0) sections.push(`<threads-live>\n${liveLines.join('\n')}\n</threads-live>`);
  if (closedLines.length > 0) {
    sections.push(`<threads-closed>\n${closedLines.map((c) => c.line).join('\n')}\n</threads-closed>`);
  }
  return sections.join('\n');
}

function renderRosterBlock(src: VariablesContextSource): string {
  const chars = Object.values(src.characters).filter((c) => c.role !== 'transient');
  chars.sort((a, b) => {
    const rank = (r: string) => (r === 'anchor' ? 0 : r === 'recurring' ? 1 : 2);
    const dr = rank(a.role) - rank(b.role);
    return dr !== 0 ? dr : a.name.localeCompare(b.name);
  });
  const locs = Object.values(src.locations).filter((l) => l.prominence !== 'margin');
  locs.sort((a, b) => {
    const rank = (p: string) => (p === 'domain' ? 0 : p === 'place' ? 1 : 2);
    const dr = rank(a.prominence) - rank(b.prominence);
    return dr !== 0 ? dr : a.name.localeCompare(b.name);
  });
  const arts = Object.values(src.artifacts).filter((a) => a.significance !== 'minor');
  arts.sort((a, b) => {
    const rank = (s: string) => (s === 'key' ? 0 : s === 'notable' ? 1 : 2);
    const dr = rank(a.significance) - rank(b.significance);
    return dr !== 0 ? dr : a.name.localeCompare(b.name);
  });

  const charLines = chars.map((c) => {
    const worldHead = Object.values(c.world?.nodes ?? {}).map((n) => n.content).join('; ');
    const sketch = worldHead ? ` — ${clean(worldHead)}` : '';
    return `  * ${c.role}: ${c.name}${sketch}`;
  }).join('\n');
  const locLines = locs.map((l) => {
    const worldHead = Object.values(l.world?.nodes ?? {}).map((n) => n.content).join('; ');
    const sketch = worldHead ? ` — ${clean(worldHead)}` : '';
    return `  * ${l.prominence}: ${l.name}${sketch}`;
  }).join('\n');
  const artLines = arts.map((a) => {
    const worldHead = Object.values(a.world?.nodes ?? {}).map((n) => n.content).join('; ');
    const sketch = worldHead ? ` — ${clean(worldHead)}` : '';
    return `  * ${a.significance}: ${a.name}${sketch}`;
  }).join('\n');
  const out: string[] = [];
  if (charLines) out.push(`<characters>\n${charLines}\n</characters>`);
  if (locLines) out.push(`<locations>\n${locLines}\n</locations>`);
  if (artLines) out.push(`<artifacts>\n${artLines}\n</artifacts>`);
  return out.join('\n');
}

export function renderVariablesContextBlock(
  src: VariablesContextSource,
  opts: RenderOptions = {},
): string {
  const sections: string[] = [];
  const arcs = opts.includeArcStates !== false ? renderArcsBlock(src) : '';
  if (arcs) sections.push(`<arcs-ordered>\n${arcs}\n</arcs-ordered>`);
  const scenes = renderScenesBlock(src);
  if (scenes) sections.push(`<scenes-up-to-current>\n${scenes}\n</scenes-up-to-current>`);
  const threads = renderThreadsBlock(src);
  if (threads) sections.push(threads);
  const roster = renderRosterBlock(src);
  if (roster) sections.push(roster);
  return sections.join('\n\n');
}

// ── Per-arc Present extraction ─────────────────────────────────────────────

const EXTRACT_PRESENT_SYSTEM = `You name the load-bearing dynamic variables driving THIS arc — the levers whose movement most reshapes the trajectory. The arc's own basis vector set; no catalogue carries across arcs.

DISCIPLINES.
  • SURFACE vs SUBSTRATE. Variables name FORCES, not symptoms. Symptoms are what becomes visible (prices fall, characters argue, a study gets cited); forces are what cascade to produce them. Reach one layer below the visible.
  • PIVOT CHECK. Read the arc's ending state. If it describes a fundamental shift — regime collapse, temporal pivot, irreversible commitment, paradigm break, structural rupture, exit of a load-bearing actor, one-way institutional/technological change — variables model the POST-shift situation. Pre-shift variables are history.
  • READ THE MECHANISMS. Artifacts and key actors carry the operative rules and capabilities loaded into the world (an artifact's lore, an institution's charter, a method's assumptions, a regime's reaction function). Their world-graph nodes define what's POSSIBLE here. An unactivated mechanism is a strong variable candidate.

What earns a place.
  • CONTINUATION — forces already firing, actively driving the present moment.
  • CREATIVE — latent drivers not firing yet: external shock building, dormant alliance, hidden contradiction surfacing, unactivated mechanism, attractor pulling toward an unspoken outcome.
Mix both at the highest-leverage instances only.

Quality bar: SPECIFIC, CASCADING, ORTHOGONAL, DYNAMIC, SUBSTRATE-LEVEL. Pattern: \`[named subject] + [dynamic attribute]\`. Avoid buckets ("antagonist pressure," "market sentiment," "public mood"). Tighter is better; stop when adding another wouldn't change predictions.

For each variable emit { id, name, description, category, intensity }:
  • id: "var-<short-slug>"
  • name: short phrase
  • description: one sentence — what it is AND what cascades when it turns up
  • category: stance / capability / pressure / knowledge / constraint / allegiance / external / contradiction / trend / threshold / resource / reputation / institutional / cultural / physical / temporal / mechanism — or invent
  • intensity (1–4): 1 weak, 2 mild, 3 strong, 4 extreme. Omit 0.

Also emit:
  • tagline: one short sentence (≤ 14 words) that captures the gestalt of this Present coordination — what the configuration *is* as a recognisable shape. Same register as a chapter epigraph.
  • reasoning: one or two sentences explaining why these variables are firing at these intensities given the arc's state — the load-bearing logic, not a re-paraphrase of the variable descriptions.
  • priorLogit ∈ [-4, +4]: log-prior plausibility of this coordination relative to alternative coordinations the world could have surfaced at this point. Same evidence scale as scenario priors: +4 = decisive evidence in favour of this coordination, 0 = baseline plausibility, -4 = a rare tail outcome that nonetheless occurred. Use the full range — this number is a permanent record of "how likely was this configuration at the time", a glimpse into the rarity of the path the world has taken.

Output strict JSON:
{
  "tagline": "...",
  "reasoning": "...",
  "priorLogit": 0,
  "variables": [ { "id": "var-...", "name": "...", "description": "...", "category": "...", "intensity": 3 } ]
}`;

export interface ExtractPresentInput {
  narrativeTitle: string;
  arc: { id: string; name: string; directionVector?: string; summary?: string };
  context?: VariablesContextSource;
  /** Pre-rendered story outline (call `outlineContext` from caller) — gives
   *  the LLM a tight arc-by-arc recap of everything up to the current scene.
   *  Cheaper than the full context block and grounded in the same evidence. */
  outline?: string;
  /** Pre-rendered active Mode section — folds the working-machinery graph
   *  (agents, pressures, rules, attractors, landmarks) into the prompt so
   *  the variables inherit the substrate. Built via `buildActiveModeSection`. */
  modeSection?: string;
  direction?: string;
  /** Stream reasoning tokens to the caller (e.g. for the variables view to
   *  render the same minimal-trace overlay used by plan/prose). When set,
   *  the call uses the streaming endpoint. */
  onReasoning?: (token: string) => void;
  /** Optional thinking-token budget for the underlying model. */
  reasoningBudget?: number;
}

function sanitizeVariable(raw: unknown): Variable | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { id?: unknown; name?: unknown; description?: unknown; category?: unknown; intensity?: unknown };
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!id || !name) return null;
  const intensity = typeof r.intensity === 'number' ? Math.max(0, Math.min(4, Math.round(r.intensity))) : 0;
  if (intensity === 0) return null;
  return {
    id,
    name,
    description: typeof r.description === 'string' ? r.description.trim() : '',
    category: typeof r.category === 'string' ? r.category.trim() : 'general',
    intensity,
  };
}

export interface ExtractPresentResult {
  variables: Variable[];
  tagline?: string;
  reasoning?: string;
  /** Self-estimated log-prior in MARKET_EVIDENCE_MIN/MAX range — a glimpse
   *  into how plausible this coordination was at the time. */
  priorLogit?: number;
}

export async function extractArcPresent(input: ExtractPresentInput): Promise<ExtractPresentResult> {
  const arc = input.arc;
  const summary = (arc.summary ?? '(no summary)').replace(/\s+/g, ' ').trim();
  const dirVec = arc.directionVector ? `\n  direction: ${arc.directionVector}` : '';
  const contextBlock = input.context ? renderVariablesContextBlock(input.context, { focusArcId: arc.id }) : '';
  const directionBlock = input.direction
    ? `\n<direction>\n${input.direction.trim()}\n</direction>\n`
    : '';
  // Outline + Mode sections are the highest-signal context blocks: a tight
  // arc-by-arc recap up to the current scene, and the working-machinery
  // substrate the variables should inherit from.
  const outlineBlock = input.outline ? `\n${input.outline}\n` : '';
  const modeBlock = input.modeSection ? `\n${input.modeSection}\n` : '';

  const prompt = `<narrative>
title: ${input.narrativeTitle}
</narrative>

<arc>
  id: ${arc.id}
  name: "${arc.name}"${dirVec}
  state: ${summary}
</arc>
${outlineBlock}${modeBlock}${contextBlock ? `\n${contextBlock}\n` : ''}${directionBlock}
Identify this arc's Present variable set. Apply the disciplines above to the current-arc state and the supporting context (outline, mode substrate, roster, threads). Variables distil pieces of the substrate — not paraphrase them, distil them. Output strict JSON only.`;

  const raw = input.onReasoning
    ? await callGenerateStream(
        prompt,
        EXTRACT_PRESENT_SYSTEM,
        () => {},
        MAX_TOKENS_DEFAULT,
        'extractArcPresent',
        ANALYSIS_MODEL,
        input.reasoningBudget,
        input.onReasoning,
        ANALYSIS_TEMPERATURE,
      )
    : await callGenerate(
        prompt,
        EXTRACT_PRESENT_SYSTEM,
        MAX_TOKENS_DEFAULT,
        'extractArcPresent',
        ANALYSIS_MODEL,
        input.reasoningBudget,
        true,
        ANALYSIS_TEMPERATURE,
      );

  const parsed = parseJson(raw, 'extractArcPresent') as {
    variables?: unknown[];
    tagline?: unknown;
    reasoning?: unknown;
    priorLogit?: unknown;
  };
  const seenIds = new Set<string>();
  const variables: Variable[] = [];
  for (const r of parsed.variables ?? []) {
    const v = sanitizeVariable(r);
    if (!v || seenIds.has(v.id)) continue;
    seenIds.add(v.id);
    variables.push(v);
  }
  const tagline = typeof parsed.tagline === 'string' ? parsed.tagline.trim() : '';
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '';
  const priorLogit = typeof parsed.priorLogit === 'number' && Number.isFinite(parsed.priorLogit)
    ? Math.max(PRIOR_LOGIT_MIN, Math.min(PRIOR_LOGIT_MAX, parsed.priorLogit))
    : undefined;
  return {
    variables,
    tagline: tagline || undefined,
    reasoning: reasoning || undefined,
    priorLogit,
  };
}

// ── Planning scenarios — each with its own custom variable set ────────────

const SCENARIO_GENERATION_SYSTEM = `You generate a cohort of PLAUSIBLE ALTERNATIVE FUTURES for the next arc. All scenarios share ONE common POOL of variables. Each scenario is a different COORDINATION over that pool — its specific pattern of intensities.

DISCIPLINES.
  • SURFACE vs SUBSTRATE. Pool variables name FORCES, not symptoms. Symptoms are visible (prices fall, characters argue, a study gets retracted); forces are what cascade to produce them. Reach one layer below the visible.
  • PIVOT CHECK. If the arc ends at a discontinuity (regime collapse, temporal pivot, irreversible commitment, paradigm break, structural rupture, exit of a load-bearing actor, one-way institutional/technological change), the cohort branches FROM the post-shift situation. A scenario in which the pivot didn't happen is mis-specified.
  • READ THE MECHANISMS. Artifacts and key actors carry the operative rules and capabilities loaded into the world. Their world-graph nodes define what's POSSIBLE. An unactivated mechanism is a strong variable candidate; mechanism activation across scenarios is exactly the coordination signature this engine exists to model.

THE SHAPE OF REALITY — power-law, not gradualism.
Real futures distribute power-law: many cluster near modal continuation (substrate barely moves, a few intensities shift), a few rupture (a low-prior mechanism fires, an attractor catches, a load-bearing actor reverses). The world is mostly still, then changes overnight. The cohort should match the SHAPE of the distribution it's drawn from — not be forced toward gradualism, not be forced toward diversity. Let the situation govern the cohort: tight possibility space → tight cohort; bimodal possibility space → most scenarios near one mode, a few near the other; fat-tailed → a few extreme tails sit alongside the cluster. The probabilities (below) carry the rarity; intensity carries the magnitude.

PROBABILITIES — RELATIVE, FULL RANGE.
Displayed probability is softmax over priorLogits ACROSS THIS COHORT. No absolute scale. Two consequences:
  1. The cohort is a REPRESENTATIVE SAMPLE — not exhaustive. More scenarios fragments probability mass.
  2. Score relative to siblings, USE THE FULL [-4, +4] RANGE. A genuine tail event sits at -3/-4; a strongly-favoured continuation sits at +3/+4. Compressed scores collapse the softmax to uniform and erase information.
PriorLogit is INDEPENDENT of intensity. A high-intensity earthquake can be high-prior if evidence supports it; a low-intensity continuation can be low-prior if it conflicts with the trajectory. Score the coordination's plausibility, not its amplitude.

PIPELINE.
  1. PIVOT CHECK on the arc's ending state.
  2. Read mechanisms in the roster's artifacts and key-actor world-graphs.
  3. Design the SHARED POOL — load-bearing forces only, substrate-level, orthogonal, dynamic.
  4. Name 2–4 ORTHOGONAL AXES OF VARIATION that span the possibility space (e.g. axes of stance, timing, locus, magnitude — pick what the situation actually has, don't copy generic axes).
  5. Draft scenarios as positions in axis space. Each is SELF-COHERENT, MEANINGFULLY DISTINCT (different axis position), and earns its place. Do not draft scenarios first and check coverage after; design the axes first.
  6. Score priorLogits relative to the cohort, full range.

Each scenario carries: name (short phrase), tagline (one sentence), activations (variableId + intensity 1–4, omit 0), priorLogit ∈ [-4, +4], priorRationale (one sentence).

Output strict JSON:
{
  "pool": [
    { "id": "var-...", "name": "...", "description": "...", "category": "..." }
  ],
  "scenarios": [
    {
      "name": "...",
      "tagline": "...",
      "activations": [ { "variableId": "var-...", "intensity": 3 } ],
      "priorLogit": 1.2,
      "priorRationale": "..."
    }
  ]
}`;

export interface ScenarioGenerationInput {
  narrativeTitle: string;
  arc: { id: string; name: string; directionVector?: string; summary?: string };
  context?: VariablesContextSource;
  /** Pre-rendered story outline up to the current scene (`outlineContext`). */
  outline?: string;
  /** Pre-rendered active Mode section (`buildActiveModeSection`). */
  modeSection?: string;
  direction?: string;
  count?: number;
  /** Stream reasoning tokens to the caller — when set, uses the streaming
   *  endpoint so the variables view can render the minimal-trace overlay. */
  onReasoning?: (token: string) => void;
  /** Optional thinking-token budget for the underlying model. */
  reasoningBudget?: number;
}

export async function generatePlanningScenarios(
  input: ScenarioGenerationInput,
): Promise<PlanningScenario[]> {
  // The cohort is a representative sample — not exhaustive. The smaller
  // the cohort, the more legible the probability distribution stays for a
  // human reader. Default 5; cap modest. Callers can override but the
  // prompt explicitly tells the model "stop when another scenario would
  // re-cover ground" so even larger targets self-limit.
  const target = Math.max(3, Math.min(8, input.count ?? 5));

  const dirVec = input.arc.directionVector ? `\n  direction: ${input.arc.directionVector}` : '';
  const summary = (input.arc.summary ?? '(no summary)').replace(/\s+/g, ' ').trim();
  const contextBlock = input.context ? renderVariablesContextBlock(input.context, { focusArcId: input.arc.id }) : '';
  const directionBlock = input.direction
    ? `\n<direction>\n${input.direction.trim()}\n</direction>\n`
    : '';
  // Outline + Mode sections — same high-signal context blocks used by
  // Present extraction. Scenarios inherit the same substrate so the
  // coordinations they propose are grounded in the world's machinery.
  const outlineBlock = input.outline ? `\n${input.outline}\n` : '';
  const modeBlock = input.modeSection ? `\n${input.modeSection}\n` : '';

  // Future generation is INDEPENDENT of Present. It is a fresh look at the
  // situation grounded in narrative context (outline, mode substrate,
  // scenes, threads, roster, prior arcs). No Present-variable block —
  // Future and Present are two separate analyses of the same evidence.
  const prompt = `<narrative>
title: ${input.narrativeTitle}
</narrative>

<current-arc id="${input.arc.id}" name="${input.arc.name}">${dirVec}
  state: ${summary}
</current-arc>
${outlineBlock}${modeBlock}${contextBlock ? `\n${contextBlock}\n` : ''}${directionBlock}
Produce a cohort of around ${target} scenarios for this arc. Apply the disciplines and pipeline above to the current-arc state and supporting context (outline, mode substrate, roster, threads). Let the situation's actual shape govern the cohort — don't pad, don't force diversity. Fresh look from the historical record, not a projection from the arc's Present variables. Output strict JSON only.`;

  const raw = input.onReasoning
    ? await callGenerateStream(
        prompt,
        SCENARIO_GENERATION_SYSTEM,
        () => {},
        MAX_TOKENS_DEFAULT,
        'generatePlanningScenarios',
        ANALYSIS_MODEL,
        input.reasoningBudget,
        input.onReasoning,
        ANALYSIS_TEMPERATURE,
      )
    : await callGenerate(
        prompt,
        SCENARIO_GENERATION_SYSTEM,
        MAX_TOKENS_DEFAULT,
        'generatePlanningScenarios',
        ANALYSIS_MODEL,
        input.reasoningBudget,
        true,
        ANALYSIS_TEMPERATURE,
      );

  const parsed = parseJson(raw, 'generatePlanningScenarios') as {
    pool?: Array<{ id?: unknown; name?: unknown; description?: unknown; category?: unknown }>;
    scenarios?: Array<{
      name?: unknown;
      tagline?: unknown;
      description?: unknown;
      activations?: unknown[];
      // Backcompat: an older shape that emitted full `variables` per scenario.
      // We still accept it — each scenario's variables become its own pool.
      variables?: unknown[];
      priorLogit?: unknown;
      priorRationale?: unknown;
    }>;
  };

  // Pool: name → {id, name, description, category} (no intensity — pool entries
  // are variable definitions; intensity lives per scenario via activations).
  const poolById = new Map<string, { id: string; name: string; description: string; category: string }>();
  for (const r of parsed.pool ?? []) {
    if (!r || typeof r !== 'object') continue;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!id || !name || poolById.has(id)) continue;
    poolById.set(id, {
      id,
      name,
      description: typeof r.description === 'string' ? r.description.trim() : '',
      category: typeof r.category === 'string' ? r.category.trim() : 'general',
    });
  }

  const out: PlanningScenario[] = [];
  for (const s of parsed.scenarios ?? []) {
    if (typeof s !== 'object' || s === null) continue;
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    if (!name) continue;

    const seen = new Set<string>();
    const variables: Variable[] = [];

    // Preferred new shape: activations over the shared pool. We materialise
    // each activation into a full Variable by joining with poolById, so the
    // existing scenario.variables[] consumers (UI, parallel coords, branch
    // generation) keep working without a schema migration.
    if (Array.isArray(s.activations)) {
      for (const a of s.activations) {
        if (!a || typeof a !== 'object') continue;
        const ar = a as { variableId?: unknown; intensity?: unknown };
        const variableId = typeof ar.variableId === 'string' ? ar.variableId.trim() : '';
        const intensity = typeof ar.intensity === 'number' ? Math.max(0, Math.min(4, Math.round(ar.intensity))) : 0;
        if (!variableId || intensity === 0 || seen.has(variableId)) continue;
        const def = poolById.get(variableId);
        if (!def) continue;
        seen.add(variableId);
        variables.push({ ...def, intensity });
      }
    }

    // Fallback to the old shape if the LLM emitted per-scenario `variables`.
    if (variables.length === 0 && Array.isArray(s.variables)) {
      for (const r of s.variables) {
        const v = sanitizeVariable(r);
        if (!v || seen.has(v.id)) continue;
        seen.add(v.id);
        variables.push(v);
      }
    }

    if (variables.length === 0) continue;
    const priorLogit = typeof s.priorLogit === 'number'
      ? Math.max(PRIOR_LOGIT_MIN, Math.min(PRIOR_LOGIT_MAX, s.priorLogit))
      : 0;
    const priorRationale = typeof s.priorRationale === 'string' ? s.priorRationale.trim() : undefined;
    out.push({
      id: `pl-${out.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      tagline: typeof s.tagline === 'string' ? s.tagline.trim() : undefined,
      description: typeof s.description === 'string' ? s.description.trim() : undefined,
      color: SCENARIO_COLORS[out.length % SCENARIO_COLORS.length],
      variables,
      priorLogit,
      priorRationale,
    });
  }
  return out;
}

/**
 * Project a Future scenario into a Present-style variable set for a new
 * branch arc. The result drops every variable the scenario didn't activate
 * (intensity = 0), keeping only the variables that matter to this future.
 * Used by Experimentation when materialising a scenario into a branch.
 */
export function presentFromScenario(scenario: PlanningScenario): Variable[] {
  return scenario.variables.filter((v) => v.intensity > 0);
}

// ── Scenario re-score (post-edit save) ─────────────────────────────────────

const RESCORE_SCENARIO_SYSTEM = `You re-evaluate the plausibility of ONE scenario whose variables have been edited. Score its priorLogit ∈ [-4, +4]:
   +4  decisive evidence in favour (would be surprising if NOT this)
   +2  strongly supported
    0  baseline plausibility
   -2  needs a specific catalyst
   -4  decisive evidence against / rare tail conditions

DISCIPLINES.
  • SURFACE vs SUBSTRATE. Score coordinations of FORCES, not symptoms. A scenario built from symptoms reads as low signal regardless of intensities.
  • PIVOT CHECK. If the arc ends at a discontinuity, a scenario that implicitly denies the pivot is mis-specified — score sharply low and say so.
  • POWER-LAW. Rare-but-pivotal scenarios are real. Don't penalise low intensity merely because it's quiet, and don't penalise rupture merely because it's unusual. Score what the evidence supports.

Probabilities are RELATIVE — softmax over priorLogits across this scenario and its siblings. Place this scenario in its right RELATIVE position; don't drift toward 0. Use the full [-4, +4] range when the coordination genuinely lands there.

Ground in:
  • Narrative context (outline, mode substrate, scenes, threads, roster, prior arcs)
  • Mechanisms loaded in the roster's artifacts and key-actor world-graphs
  • The scenario's revised coordination — which variables, what intensities, in combination
  • The sibling scenarios — relative anchoring

priorLogit is INDEPENDENT of intensity. Score the coordination's plausibility, not its amplitude.

Include priorRationale — one sentence, naming the relative anchor where it helps ("more plausible than X because…").

Output strict JSON: { "priorLogit": <number>, "priorRationale": "<one sentence>" }`;

export interface RescoreScenarioInput {
  narrativeTitle: string;
  arc: { id: string; name: string; directionVector?: string; summary?: string };
  /** The scenario being rescored, in its edited state (post-user-edits). */
  scenario: PlanningScenario;
  /** Sibling scenarios in the same cohort — gives the LLM relative anchoring. */
  cohort: PlanningScenario[];
  context?: VariablesContextSource;
  /** Pre-rendered story outline up to the current scene (`outlineContext`). */
  outline?: string;
  /** Pre-rendered active Mode section (`buildActiveModeSection`). */
  modeSection?: string;
}

export interface RescoreScenarioResult {
  priorLogit: number;
  priorRationale: string;
}

export async function rescoreScenario(input: RescoreScenarioInput): Promise<RescoreScenarioResult> {
  const dispoBlock = input.scenario.variables.length > 0
    ? input.scenario.variables
        .map((v) => `  - ${v.name} (${v.category}) @ ${VARIABLE_INTENSITY_LEVELS[v.intensity]?.label ?? '?'} — ${v.description}`)
        .join('\n')
    : '  (no variables active)';

  const cohortBlock = input.cohort
    .filter((s) => s.id !== input.scenario.id)
    .map((s) => {
      const variables = s.variables.length > 0
        ? s.variables.map((v) => `${v.name}@${VARIABLE_INTENSITY_LEVELS[v.intensity]?.label ?? '?'}`).join(', ')
        : '(none)';
      const prior = typeof s.priorLogit === 'number' ? s.priorLogit.toFixed(1) : '0';
      return `  • ${s.name} [priorLogit ${prior}]${s.tagline ? ` — ${s.tagline}` : ''}\n    variables: ${variables}`;
    })
    .join('\n');

  const dirVec = input.arc.directionVector ? `\n  direction: ${input.arc.directionVector}` : '';
  const summary = (input.arc.summary ?? '(no summary)').replace(/\s+/g, ' ').trim();
  const contextBlock = input.context ? renderVariablesContextBlock(input.context, { focusArcId: input.arc.id }) : '';
  const outlineBlock = input.outline ? `\n${input.outline}\n` : '';
  const modeBlock = input.modeSection ? `\n${input.modeSection}\n` : '';

  const prompt = `<narrative>
title: ${input.narrativeTitle}
</narrative>

<current-arc id="${input.arc.id}" name="${input.arc.name}">${dirVec}
  state: ${summary}
</current-arc>

<scenario-under-review name="${input.scenario.name}"${input.scenario.tagline ? ` tagline="${input.scenario.tagline}"` : ''}>
${dispoBlock}
</scenario-under-review>

<sibling-scenarios>
${cohortBlock || '  (no siblings)'}
</sibling-scenarios>
${outlineBlock}${modeBlock}${contextBlock ? `\n${contextBlock}\n` : ''}
Re-score this scenario's priorLogit given its edited coordination, the cohort context, and the substrate (outline + Mode). Output strict JSON only.`;

  const raw = await callGenerate(
    prompt,
    RESCORE_SCENARIO_SYSTEM,
    MAX_TOKENS_DEFAULT,
    'rescoreScenario',
    ANALYSIS_MODEL,
    undefined,
    true,
    ANALYSIS_TEMPERATURE,
  );

  const parsed = parseJson(raw, 'rescoreScenario') as { priorLogit?: unknown; priorRationale?: unknown };
  const priorLogit = typeof parsed.priorLogit === 'number'
    ? Math.max(PRIOR_LOGIT_MIN, Math.min(PRIOR_LOGIT_MAX, parsed.priorLogit))
    : 0;
  const priorRationale = typeof parsed.priorRationale === 'string' ? parsed.priorRationale.trim() : '';
  return { priorLogit, priorRationale };
}

// ── Probability model ──────────────────────────────────────────────────────

export function scenarioLogit(scenario: PlanningScenario): number {
  return typeof scenario.priorLogit === 'number' ? scenario.priorLogit : 0;
}

export function scenarioProbabilities(
  scenarios: PlanningScenario[],
  temperature: number = 1,
): Record<string, number> {
  if (scenarios.length === 0) return {};
  const tau = Math.max(0.01, temperature);
  const logits = scenarios.map((s) => scenarioLogit(s) / tau);
  const maxL = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxL));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  scenarios.forEach((s, i) => { out[s.id] = exps[i] / sum; });
  return out;
}


// ── Intensity scale + palettes ─────────────────────────────────────────────

export const VARIABLE_INTENSITY_LEVELS = [
  { idx: 0, label: '—',       desc: 'off' },
  { idx: 1, label: 'weak',    desc: 'a hint, easily missed' },
  { idx: 2, label: 'mild',    desc: 'present but contained' },
  { idx: 3, label: 'strong',  desc: 'a clear inflection' },
  { idx: 4, label: 'extreme', desc: 'tail-event amplitude' },
] as const;

export const SCENARIO_COLORS: readonly string[] = [
  '#34d399', '#a78bfa', '#fbbf24', '#fb7185', '#fb923c',
  '#f87171', '#38bdf8', '#22d3ee', '#f472b6', '#facc15',
] as const;

export const CATEGORY_PALETTE: readonly string[] = [
  '#a78bfa', '#34d399', '#fbbf24', '#fb7185',
  '#38bdf8', '#fb923c', '#22d3ee', '#f472b6',
] as const;

export function categoryColor(category: string): string {
  let h = 0;
  for (let i = 0; i < category.length; i++) {
    h = (h * 31 + category.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}
