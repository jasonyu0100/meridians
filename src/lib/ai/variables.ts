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
  sceneCap?: number;
  closedThreadCap?: number;
  includeArcStates?: boolean;
  focusArcId?: string;
}

function truncate(s: string | undefined, n = 220): string {
  if (!s) return '';
  const cleaned = s.replace(/\s+/g, ' ').trim();
  return cleaned.length <= n ? cleaned : cleaned.slice(0, n - 1) + '…';
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
      const dir = arc.directionVector ? `\n    direction: ${truncate(arc.directionVector, 200)}` : '';
      const ws = arc.worldState ? `\n    state: ${truncate(arc.worldState, 380)}` : '';
      return `  - id: ${arc.id}\n    name: "${arc.name}"${dir}${ws}`;
    })
    .join('\n');
}

function renderScenesBlock(src: VariablesContextSource, opts: RenderOptions): string {
  const cap = opts.sceneCap ?? 80;
  const ordered = cutoffSceneIds(src);
  const total = ordered.length;
  if (total === 0) return '';
  const slice = ordered.slice(Math.max(0, total - cap));
  const earlierCount = total - slice.length;
  const lines: string[] = [];
  if (earlierCount > 0) lines.push(`  (${earlierCount} earlier scene${earlierCount === 1 ? '' : 's'} elided)`);
  slice.forEach((sid, i) => {
    const sc = src.scenes[sid];
    if (!sc) return;
    const idx = Math.max(0, total - slice.length) + i + 1;
    const arc = src.arcs[sc.arcId];
    const loc = src.locations[sc.locationId];
    const pov = sc.povId ? src.characters[sc.povId]?.name : null;
    const arcPrefix = arc ? `${arc.name}` : sc.arcId;
    const locName = loc ? loc.name : sc.locationId;
    const povStr = pov ? `pov=${pov}` : 'pov=—';
    const summary = sc.events.length > 0 ? truncate(sc.events.join(' · '), 240) : '(no events)';
    lines.push(`  [${idx}] arc=${arcPrefix} loc=${locName} ${povStr} :: ${summary}`);
  });
  return lines.join('\n');
}

function renderThreadsBlock(src: VariablesContextSource, opts: RenderOptions): string {
  const closedCap = opts.closedThreadCap ?? 20;
  const ordered = cutoffSceneIds(src);
  const orderedSet = new Set(ordered);
  const lastScene = ordered[ordered.length - 1];
  const liveLines: string[] = [];
  const closedLines: { line: string; ord: number }[] = [];
  for (const t of Object.values(src.threads)) {
    if (lastScene && t.openedAt && !orderedSet.has(t.openedAt)) continue;
    const isClosed = !!t.closedAt && orderedSet.has(t.closedAt);
    const participants = t.participants
      .slice(0, 4)
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
        .sort((a, b) => b.p - a.p)
        .slice(0, 2);
      priceLine = ` — price: ${top.map((x) => `${x.name} ${(x.p * 100).toFixed(0)}%`).join(' / ')}`;
    }
    if (isClosed) {
      const winner = t.closeOutcome != null ? t.outcomes[t.closeOutcome] : '?';
      const idx = ordered.indexOf(t.closedAt!);
      closedLines.push({
        line: `  ${t.id}: "${truncate(t.description, 160)}" — closed ${winner}${t.resolutionQuality != null ? ` (q=${t.resolutionQuality.toFixed(2)})` : ''} :: ${participants}`,
        ord: idx,
      });
    } else {
      liveLines.push(`  ${t.id}: "${truncate(t.description, 160)}"${priceLine} :: ${participants}`);
    }
  }
  closedLines.sort((a, b) => b.ord - a.ord);
  const sections: string[] = [];
  if (liveLines.length > 0) sections.push(`<threads-live>\n${liveLines.join('\n')}\n</threads-live>`);
  if (closedLines.length > 0) {
    const lines = closedLines.slice(0, closedCap).map((c) => c.line);
    sections.push(`<threads-closed-recent>\n${lines.join('\n')}\n</threads-closed-recent>`);
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

  const charLines = chars.slice(0, 28).map((c) => {
    const worldHead = Object.values(c.world?.nodes ?? {}).slice(0, 3).map((n) => n.content).join('; ');
    const sketch = worldHead ? ` — ${truncate(worldHead, 200)}` : '';
    return `  * ${c.role}: ${c.name}${sketch}`;
  }).join('\n');
  const locLines = locs.slice(0, 18).map((l) => {
    const worldHead = Object.values(l.world?.nodes ?? {}).slice(0, 2).map((n) => n.content).join('; ');
    const sketch = worldHead ? ` — ${truncate(worldHead, 180)}` : '';
    return `  * ${l.prominence}: ${l.name}${sketch}`;
  }).join('\n');
  const artLines = arts.slice(0, 14).map((a) => {
    const worldHead = Object.values(a.world?.nodes ?? {}).slice(0, 2).map((n) => n.content).join('; ');
    const sketch = worldHead ? ` — ${truncate(worldHead, 160)}` : '';
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
  const scenes = renderScenesBlock(src, opts);
  if (scenes) sections.push(`<scenes-up-to-current>\n${scenes}\n</scenes-up-to-current>`);
  const threads = renderThreadsBlock(src, opts);
  if (threads) sections.push(threads);
  const roster = renderRosterBlock(src);
  if (roster) sections.push(roster);
  return sections.join('\n\n');
}

// ── Per-arc Present extraction ─────────────────────────────────────────────

const EXTRACT_PRESENT_SYSTEM = `You name the load-bearing dynamic variables driving THIS arc — the dials whose movement most reshapes the trajectory. This is the arc's own basis vector set; no catalogue carries across arcs.

What a variable IS.
A dial worth modelling NAMES a tension, pressure, or contingency that, when shifted, CASCADES — other actors recalibrate, threads inflect, the strategic position changes shape. It refers to something specific in this arc: named actors, named institutions, named mechanisms. "Fang Yuan's foreknowledge advantage," "the Bai Clan's expansion timing," "Clan Leader Bo's failing health" — not "antagonist pressure" or "resource availability."

What a variable IS NOT.
Granular character texture is noise floor, not signal. Emotional control, reputation management, investigative skill — these are colour, not levers. If you can imagine the dial moving and the story not visibly changing, it's not a variable.

What to look for.
Read the scenes, threads, and roster. Two kinds of dial earn a place:
  • CONTINUATION — dominant dynamics already firing, the forces actively driving the present moment.
  • CREATIVE — latent drivers not firing yet but plausibly load-bearing if they ignite: an external shock building, a dormant alliance, a hidden contradiction about to surface, an attractor pulling things toward an unspoken outcome.
A good set mixes both, drawn at the highest-leverage instances only.

Quality bar.
  • SPECIFIC — named, grounded in this arc's actual situation
  • CASCADING — visibly reshapes the story when it moves
  • ORTHOGONAL — no two dials measure the same underlying force from different angles
  • DYNAMIC — capable of taking different values across plausible futures, not a fixed fact
Tighter is better. A missing dimension can be added next regenerate; a swamp of dials dilutes signal and reads as noise. Stop when adding another dial wouldn't change predictions.

For each variable emit { id, name, description, category, intensity }:
  • id: "var-<short-slug>" derived from the name
  • name: short phrase that names the force
  • description: one sentence — what the dial is AND what cascades when it turns up
  • category: pick a label that groups related dials (stance, capability, pressure, knowledge, constraint, allegiance, external, contradiction, trend, threshold, resource, reputation, institutional, cultural, physical, temporal) or invent one if the work demands
  • intensity (1–4): 1 weak, 2 mild, 3 strong, 4 extreme. Variables at 0 stay implicit — do not emit them.

Output strict JSON:
{ "variables": [ { "id": "var-...", "name": "...", "description": "...", "category": "...", "intensity": 3 } ] }`;

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
   *  the dials inherit the substrate. Built via `buildActiveModeSection`. */
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

export async function extractArcPresent(input: ExtractPresentInput): Promise<Variable[]> {
  const arc = input.arc;
  const summary = (arc.summary ?? '(no summary)').replace(/\s+/g, ' ').trim();
  const dirVec = arc.directionVector ? `\n  direction: ${arc.directionVector}` : '';
  const contextBlock = input.context ? renderVariablesContextBlock(input.context, { focusArcId: arc.id }) : '';
  const directionBlock = input.direction
    ? `\n<direction>\n${input.direction.trim()}\n</direction>\n`
    : '';
  // Outline + Mode sections are the highest-signal context blocks: a tight
  // arc-by-arc recap up to the current scene, and the working-machinery
  // substrate the dials should inherit from.
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
Now identify this arc's load-bearing dynamic variables. Lean on the outline (arc-by-arc story so far) and the Mode substrate (active agents, pressures, rules, attractors, landmarks) as your ground truth. Dials should distil pieces of the substrate — not paraphrase them, distil them. Be ruthless about pruning: if a dial wouldn't change the trajectory if it moved, it doesn't belong. Output strict JSON only.`;

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

  const parsed = parseJson(raw, 'extractArcPresent') as { variables?: unknown[] };
  const seenIds = new Set<string>();
  const out: Variable[] = [];
  for (const r of parsed.variables ?? []) {
    const v = sanitizeVariable(r);
    if (!v || seenIds.has(v.id)) continue;
    seenIds.add(v.id);
    out.push(v);
  }
  return out;
}

// ── Planning scenarios — each with its own custom variable set ────────────

const SCENARIO_GENERATION_SYSTEM = `You generate a cohort of PLAUSIBLE ALTERNATIVE FUTURES for the next arc. All scenarios share ONE common pool of dials. Different scenarios arise from different COORDINATION of those dials — not from different vocabularies. Diversity comes from how the same forces interact, which ones dominate, what gets pushed past a threshold and what subsides.

The framing is butterfly-effect, not parallel universes. These scenarios inhabit the SAME world driven by the SAME machinery. Most scenarios share many of the same active dials — the world's basic shape is stable. What differs is the COORDINATION: which dial earthquakes first, which goes loudest, which ones reinforce or cancel each other, which a single shift cascades into. A subtle change in initial coordination compounds into a dramatically different downstream outcome. That's the model.

So the cohort should feel like variations on a shared situation, not a stark menu of disjoint outcomes. Commonalities and differences both matter. Two scenarios may activate seven of the same dials but differ in intensity on three of them and that's enough to fork the future. Other scenarios may be defined by ONE rare dial firing at extreme intensity, while the common dials stay roughly where they were.

PROBABILITIES ARE RELATIVE.
The displayed probability for each scenario is softmax over priorLogits ACROSS THIS COHORT — every scenario's score is read against its peers, not against an absolute scale. This has two consequences you must internalise:

  1. The cohort should be a REPRESENTATIVE SAMPLE of the possibility space — not exhaustive. The more scenarios you add, the more probability mass fragments, and the less narratively legible the readout becomes for a human author. A few DISTINCT cases lets the reader keep the field in mind; ten near-duplicates collapses signal into noise.
  2. Score each scenario relative to its siblings. A scenario with priorLogit +2 means "more plausible than the median sibling," not "+2 absolute." Reach the full [-4, +4] range across the cohort — don't compress everything into 0 to +1. If one scenario is genuinely far more plausible, give it +3 or +4; if one is a real tail event, push it to -3 or -4. Realistic spread is what makes the softmax produce a useful distribution.

Step 1 — design the SHARED POOL.
Pick the dials that span this arc's strategic possibility space. Each dial must NAME a force specific to this arc, capable of CASCADING when it moves, ORTHOGONAL to the other dials, and DYNAMIC — its intensity could plausibly differ across futures. Reject character-grain texture; that's noise, not signal. The pool size should match how many independent levers this arc genuinely has — usually a tight set is right; a bloated pool dilutes signal.

Step 2 — design a small set of DISTINCT coordinations over the shared pool.
A scenario is a pattern of intensities. For each dial in the pool, pick an intensity:
  0  off (omit from activations — dial is dormant in this future)
  1  weak     2  mild     3  strong     4  extreme

Most scenarios activate several dials at varying intensities. A few may be sharp — one or two dials at extreme, the rest dormant — those are the earthquake scenarios. Common dials may appear in many scenarios; that's a feature (it shows the stable substrate). What distinguishes a scenario is its specific coordination signature.

Each scenario must:
  • Be SELF-COHERENT — the activated intensities form a causally consistent pattern
  • Be MEANINGFULLY DISTINCT — its coordination signature differs visibly from every other scenario in the cohort (near-duplicates fragment probability and read as noise)
  • Have a STRATEGIC FRAME — a specific narrative thrust unique to this coordination
  • Earn its place — adding it must give the cohort something the other scenarios don't already cover

The right number is the smallest cohort that captures the shape of the possibility space — usually a handful of distinct cases, not a long catalogue. Stop when adding another scenario would just re-cover ground that's already there.

Do NOT bias toward archetypes (continuation / pivot / shock). Generate the coordination patterns that genuinely arise as plausible alternative unfoldings.

For each scenario estimate priorLogit ∈ [-4, +4] — same evidence scale used elsewhere in the engine, in log-odds units:
   +4  decisive evidence in favour (would be surprising if NOT this)
   +2  strongly supported by evidence
    0  baseline plausibility (defensible given evidence, no strong tilt)
   -2  needs a specific catalyst to become likely
   -4  decisive evidence against / rare tail conditions required

PriorLogit is INDEPENDENT of intensity. A high-intensity earthquake scenario can still be high-prior if evidence supports it; a low-intensity scenario can be low-prior if it conflicts with the trajectory. Score the coordination's plausibility, not its amplitude.

Use the full range across the cohort. If you emit five scenarios all between 0 and +1, the softmax flattens them to near-uniform and the probabilities lose meaning. Reach for +3/+4 when the evidence really backs one scenario, and -3/-4 when one is a tail event the evidence pushes against — let the math tell a story.

Include priorRationale — one sentence explaining the priorLogit. Each scenario name is a short phrase; tagline is one sentence.

Output strict JSON:
{
  "pool": [
    { "id": "var-...", "name": "...", "description": "...", "category": "..." }
  ],
  "scenarios": [
    {
      "name": "Strong follow-through",
      "tagline": "Negotiations honour the summit; markets reward.",
      "activations": [ { "variableId": "var-...", "intensity": 3 } ],
      "priorLogit": 1.2,
      "priorRationale": "Public commitments compound; reversal cost > follow-through cost."
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
Now design the SHARED POOL and produce a representative sample of around ${target} DISTINCT scenarios as coordination patterns over it — fewer if the possibility space is tight, more only if there are genuinely distinct cases worth modelling. Don't pad; near-duplicates fragment probability and reduce legibility.

Lean on the outline (arc-by-arc story so far) and the Mode substrate (active agents, pressures, rules, attractors, landmarks) as your ground truth. The pool's dials should distil pieces of the substrate; the coordinations should respect (or deliberately rupture) its rules and attractors. This is a fresh look at the situation from the historical record, not a projection from the arc's Present variables.

Each scenario is a unique signature of intensities across the shared dials. Score priorLogits RELATIVE to one another — reach for the full [-4, +4] range so the softmax tells a real story. Output strict JSON only.`;

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
  // are dial definitions; intensity lives per scenario via activations).
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
 * branch arc. The result drops every dial the scenario didn't activate
 * (intensity = 0), keeping only the variables that matter to this future.
 * Used by Experimentation when materialising a scenario into a branch.
 */
export function presentFromScenario(scenario: PlanningScenario): Variable[] {
  return scenario.variables.filter((v) => v.intensity > 0);
}

// ── Scenario re-score (post-edit save) ─────────────────────────────────────

const RESCORE_SCENARIO_SYSTEM = `You re-evaluate the plausibility of ONE scenario whose dials have been edited. Score its priorLogit ∈ [-4, +4] — log-odds units, the same evidence scale used elsewhere in the engine:
   +4  decisive evidence in favour (would be surprising if NOT this)
   +2  strongly supported by evidence
    0  baseline plausibility (defensible given evidence, no strong tilt)
   -2  needs a specific catalyst to become likely
   -4  decisive evidence against / rare tail conditions required

Probabilities are RELATIVE within the cohort — softmax over priorLogits across this scenario and its siblings. Your score has meaning only against its peers. So:
  • Anchor on the siblings. If their priorLogits are listed below, place this scenario in the right RELATIVE position. Don't drift toward 0 by default; pick the value that puts this scenario where it belongs in the ranking.
  • A representative cohort uses the full range. If most siblings cluster near 0, that's fine, but don't be afraid to push this scenario up to +3/+4 or down to -3/-4 when the edited coordination genuinely lands there.

Ground your score in:
  • The narrative context (outline, mode substrate, scenes, threads, roster, prior arcs) — what the historical record supports
  • The scenario's revised coordination — which dials are active, at what intensities, in combination
  • The sibling scenarios — score this scenario RELATIVE to them so the softmax produces a meaningful spread

Score the coordination's plausibility, not its amplitude. A high-intensity earthquake scenario can be high-prior if evidence supports it; a low-intensity scenario can be low-prior if it conflicts with the trajectory.

Include priorRationale — one sentence explaining the priorLogit, naming the relative anchor where it helps ("more plausible than X because…").

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
    : '  (no dials active)';

  const cohortBlock = input.cohort
    .filter((s) => s.id !== input.scenario.id)
    .map((s) => {
      const dials = s.variables.length > 0
        ? s.variables.map((v) => `${v.name}@${VARIABLE_INTENSITY_LEVELS[v.intensity]?.label ?? '?'}`).join(', ')
        : '(none)';
      const prior = typeof s.priorLogit === 'number' ? s.priorLogit.toFixed(1) : '0';
      return `  • ${s.name} [priorLogit ${prior}]${s.tagline ? ` — ${s.tagline}` : ''}\n    dials: ${dials}`;
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


// ── Intensity dial + palettes ──────────────────────────────────────────────

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
