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
  // For each arc, surface its Present coordination annotation when one was
  // recorded — description + reasoning + the universal inference-shape
  // fields. This lets downstream variable / scenario generation inherit the
  // comparative + falsification reasoning a prior arc already produced,
  // rather than re-deriving it from scratch.
  return arcsOrdered
    .map((arc) => {
      const dir = arc.directionVector ? `\n    direction: ${clean(arc.directionVector)}` : '';
      const ws = arc.worldState ? `\n    state: ${clean(arc.worldState)}` : '';
      const presentParts: string[] = [];
      if (arc.presentDescription) presentParts.push(`      description: ${clean(arc.presentDescription)}`);
      if (arc.presentReasoning) presentParts.push(`      reasoning: ${clean(arc.presentReasoning)}`);
      if (arc.presentConsidered) presentParts.push(`      × considered: ${clean(arc.presentConsidered)}`);
      if (arc.presentBreaks) presentParts.push(`      ! breaks: ${clean(arc.presentBreaks)}`);
      if (arc.presentOpens) presentParts.push(`      ⇒ opens: ${clean(arc.presentOpens)}`);
      const present = presentParts.length > 0
        ? `\n    present:\n${presentParts.join('\n')}`
        : '';
      return `  - id: ${arc.id}\n    name: "${arc.name}"${dir}${ws}${present}`;
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

REGISTER FIRST — what kind of work is this, and what KIND of force is load-bearing here?
Identify the substrate from the context (outline, mode, roster, threads, prose profile). Then frame variables accordingly:
  • NARRATIVE / FICTION — dramatic forces: character commitments, thread pressures, world reveals, alliance dynamics.
  • SIMULATION — rule-driven forces: rule activations, threshold proximity, agent stances under the rule set, propagation regimes.
  • PAPER / ESSAY / ARGUMENT — argumentative / evidentiary / methodological forces: live claims, methodological commitments, evidentiary pressures, counterposition reach, scope tension, sources contested, theoretical assumptions binding.
Variables read in the register's native vocabulary. A paper's variables don't name "antagonist pressure"; a wargame's variables don't name "thesis tension". The substrate decides the form.

DISCIPLINES (universal across registers).
  • SURFACE vs SUBSTRATE. Variables name FORCES, not symptoms. Symptoms are what becomes visible (prices fall, characters argue, a study gets cited, a method gets criticised); forces are what cascade to produce them. Reach one layer below the visible.
  • PIVOT CHECK. Read the arc's ending state. If it describes a fundamental shift — regime collapse, temporal pivot, irreversible commitment, paradigm break, structural rupture, exit of a load-bearing actor, methodological reframe that supersedes prior claims, one-way institutional/technological change — variables model the POST-shift situation. Pre-shift variables are history.
  • READ THE MECHANISMS. Artifacts and key actors carry the operative rules and capabilities loaded into the world (an artifact's lore in fiction, a method's assumptions in argument, a regime's reaction function in simulation, an institution's charter anywhere). Their world-graph nodes define what's POSSIBLE here. An unactivated mechanism / unused method / unaddressed source is a strong variable candidate.

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

Also emit the universal INFERENCE-SHAPE (same fields used by Future scenarios and across CRG/PRG node-like artifacts):
  • description: one sentence (≤ 14 words). Gestalt of this coordination — what the configuration IS as a recognisable shape, in the work's native register.
  • reasoning: 3–5 sentences. Load-bearing logic — why these variables fire at these intensities given the arc's state. Which mechanism feeds which, where the cascade runs, which symptom is the surface. Substantive, not paraphrase. Name actors / mechanisms / threads where it sharpens.
  • considered (REQUIRED): 1–3 sentences. Adjacent coordinations the same evidence could support, rival readings drafted and discarded, alternative load-bearing variables that didn't earn the slot. Comparative reasoning, not summary. If no genuine rival applies, say so explicitly — never omit.
  • breaks: 1–2 sentences. What observation would mean THIS coordination isn't the right read — what the user should look for to invalidate it.
  • opens: 1–2 sentences. What this Present coordination structurally pulls toward next — bridge into the Future cohort's space.
  • priorLogit ∈ [-4, +4]: log-prior plausibility relative to alternative coordinations the world could have surfaced (same scale as scenario priors). Full range — permanent record of the path's rarity.

Variable count is flexible. Emit as many or as few as the situation supports — stop when adding another wouldn't change predictions, don't pad to hit a number, don't trim to look clean. A quiet arc may carry two; a dense one may carry a dozen.

Output strict JSON:
{
  "description": "...",
  "reasoning": "...",
  "considered": "...",
  "breaks": "...",
  "opens": "...",
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
  /** Short one-sentence gestalt of the Present coordination. Same shape used
   *  by Future scenarios (description + reasoning + universal inference
   *  fields + priorLogit). */
  description?: string;
  /** Multi-sentence load-bearing logic for the Present coordination — WHY
   *  these variables are firing at these intensities. */
  reasoning?: string;
  /** Universal inference-shape fields (option space, falsification handle,
   *  forward extension) — same semantics as on PlanningScenario / node
   *  snapshots. */
  considered?: string;
  breaks?: string;
  opens?: string;
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
    description?: unknown;
    reasoning?: unknown;
    considered?: unknown;
    breaks?: unknown;
    opens?: unknown;
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
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '';
  const considered = typeof parsed.considered === 'string' && parsed.considered.trim()
    ? parsed.considered.trim()
    : undefined;
  const breaks = typeof parsed.breaks === 'string' && parsed.breaks.trim()
    ? parsed.breaks.trim()
    : undefined;
  const opens = typeof parsed.opens === 'string' && parsed.opens.trim()
    ? parsed.opens.trim()
    : undefined;
  const priorLogit = typeof parsed.priorLogit === 'number' && Number.isFinite(parsed.priorLogit)
    ? Math.max(PRIOR_LOGIT_MIN, Math.min(PRIOR_LOGIT_MAX, parsed.priorLogit))
    : undefined;
  return {
    variables,
    description: description || undefined,
    reasoning: reasoning || undefined,
    considered,
    breaks,
    opens,
    priorLogit,
  };
}

// ── Planning scenarios — each with its own custom variable set ────────────

const SCENARIO_GENERATION_SYSTEM = `You generate a cohort of plausible alternative CONTINUATIONS for the next arc. All scenarios share ONE common POOL of variables. Each scenario is a different COORDINATION over that pool — its specific pattern of intensities.

REGISTER FIRST — what kind of work is this, and what does "continuation" mean here?
Identify the substrate from the context (outline, mode, roster, threads, prose profile). Then frame the cohort accordingly:
  • NARRATIVE / FICTION — story register (novel, screenplay, drama). Continuations are what HAPPENS NEXT: thread pivots, character commitments, scene-level inflections, world reveals.
  • SIMULATION — rule-driven scenario register (wargame, economic / pandemic / climate model, historical counterfactual, agent-based study, LitRPG / cultivation under explicit world rules). Continuations are what the MODELLED SYSTEM does next under the rule set: state transitions, threshold crossings, rule-driven outcomes, agent reactions.
  • PAPER / ESSAY / ARGUMENT / IDEA — non-fiction register (research paper, essay, reportage, case study, working note). Continuations are NEW DIRECTIONS the argument / inquiry / piece could take: new claims to advance, counter-arguments to engage, scope shifts, methodological pivots, sister-questions opened, follow-up studies, evidence to incorporate, objections to anticipate. NOT "what happens next in the simulated world" — there is no simulated world. The continuation is intellectual / argumentative motion, not causal-event motion.
The cohort frames itself in the register the substrate actually is. A paper does not get a "load-bearing actor reverses" cohort; a wargame does not get a "scope shift in argument" cohort. Mixed-register works (a thinkpiece that uses a thought-experiment scenario inside it) pick the register the CURRENT arc is sitting in.

DISCIPLINES (universal across registers).
  • SURFACE vs SUBSTRATE. Pool variables name FORCES, not symptoms. Symptoms are visible (prices fall, a study gets cited, a character argues); forces are what cascade to produce them. Reach one layer below the visible.
  • PIVOT CHECK. If the arc ends at a discontinuity — regime collapse, temporal pivot, irreversible commitment, paradigm break, structural rupture, exit of a load-bearing actor, methodological reframe that supersedes prior claims, one-way institutional/technological change — the cohort branches FROM the post-shift situation. A scenario in which the pivot didn't happen is mis-specified.
  • READ THE MECHANISMS. Artifacts and key actors carry the operative rules and capabilities loaded into the world. In fiction these are powers and lore; in simulation they are the rule set itself; in argument they are methods, sources, theoretical commitments. Their world-graph nodes define what's POSSIBLE. An unactivated mechanism / unused method / unaddressed source is a strong variable candidate.

THE SHAPE OF REALITY — power-law, not gradualism.
Real continuations distribute power-law: many cluster near modal continuation (substrate barely moves, a few intensities shift), a few rupture (a low-prior mechanism fires, an attractor catches, a load-bearing actor reverses, a paradigm break lands). The world is mostly still, then changes overnight; a paper mostly extends its thesis, then occasionally pivots into a counter-claim or a new methodology. The cohort should match the SHAPE of the distribution it's drawn from — not be forced toward gradualism, not be forced toward diversity. Let the situation govern the cohort: tight possibility space → tight cohort; bimodal → most scenarios near one mode, a few near the other; fat-tailed → a few extreme tails sit alongside the cluster. Probabilities (below) carry the rarity; intensity carries the magnitude.

PROBABILITIES — RELATIVE, FULL RANGE.
Displayed probability is softmax over priorLogits ACROSS THIS COHORT. No absolute scale. Two consequences:
  1. The cohort is a REPRESENTATIVE SAMPLE — not exhaustive. More scenarios fragments probability mass.
  2. Score relative to siblings, USE THE FULL [-4, +4] RANGE. A genuine tail event sits at -3/-4; a strongly-favoured continuation sits at +3/+4. Compressed scores collapse the softmax to uniform and erase information.
PriorLogit is INDEPENDENT of intensity. A high-intensity rupture can be high-prior if evidence supports it; a low-intensity continuation can be low-prior if it conflicts with the trajectory. Score the coordination's plausibility, not its amplitude.

PIPELINE.
  1. REGISTER RECOGNITION. What kind of work is this, what does continuation MEAN here?
  2. PIVOT CHECK on the arc's ending state.
  3. Read mechanisms in the roster's artifacts and key-actor world-graphs.
  4. Design the SHARED POOL — load-bearing forces only, substrate-level, orthogonal, dynamic. Forces should be in the register's vocabulary: dramatic in fiction, rule-driven in simulation, argumentative / methodological / evidentiary in papers.
  5. Draft scenarios over the pool. Each is SELF-COHERENT, MEANINGFULLY DISTINCT, and earns its place. Let the situation govern the shape of the cohort — how many scenarios, how clustered or spread, what dimensions they vary along. Use whatever frame the substrate suggests (axes, branches, regimes, families, ad hoc) rather than forcing one structure.
  6. Score priorLogits relative to the cohort, full range.

COHORT SIZE — FLEXIBLE.
The number of scenarios is governed by the SITUATION, not by a target. A tight, locked-in possibility space supports two or three meaningful continuations; a fan-out moment may support a dozen. Don't pad to look thorough, don't trim to look clean. Stop when adding another scenario would re-cover ground already covered. The same applies to the SHARED POOL — emit as many variables as the load-bearing forces actually require, no more.

Each scenario carries the universal INFERENCE-SHAPE (same fields as Present and CRG/PRG node-like artifacts) plus cohort-specific fields:
  • name: short phrase naming this scenario distinctly within the cohort.
  • description: one sentence (≤ 14 words). Gestalt of this coordination, in the work's native register.
  • reasoning: 3–5 sentences. Why this coordination earns its place — which variables cascade into which, why these intensities, which mechanism fires first, why this priorLogit and not one notch higher/lower. Substantive; don't restate the activations.
  • considered (REQUIRED): 1–3 sentences. Adjacent coordinations considered and rejected, sibling scenarios this one contrasts against (cite by name), rival readings drafted and discarded. If no genuine rival applies, say so explicitly — never omit.
  • breaks: 1–2 sentences. What observation would mean this scenario didn't happen — falsifying evidence, threshold whose non-crossing voids it. If you can't name one, it isn't forecasting.
  • opens: 1–2 sentences. If this holds, what cascades into the arc-after-next — threads opened, markets perturbed, affordances granted.
  • activations: variableId + intensity 1–4 over the shared pool. Omit 0.
  • priorLogit ∈ [-4, +4]: relative log-prior plausibility within the cohort.

Output strict JSON:
{
  "pool": [
    { "id": "var-...", "name": "...", "description": "...", "category": "..." }
  ],
  "scenarios": [
    {
      "name": "...",
      "description": "...",
      "reasoning": "...",
      "considered": "...",
      "breaks": "...",
      "opens": "...",
      "priorLogit": 1.2,
      "activations": [ { "variableId": "var-...", "intensity": 3 } ]
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
  /** Stream reasoning tokens to the caller — when set, uses the streaming
   *  endpoint so the variables view can render the minimal-trace overlay. */
  onReasoning?: (token: string) => void;
  /** Optional thinking-token budget for the underlying model. */
  reasoningBudget?: number;
}

export async function generatePlanningScenarios(
  input: ScenarioGenerationInput,
): Promise<PlanningScenario[]> {
  // Cohort size is flexible — the prompt tells the LLM to let the situation
  // decide. No clamp here; a tight possibility space yields a few scenarios,
  // a genuine fan-out moment yields more.

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
Produce a cohort of scenarios for this arc. Apply the disciplines and pipeline above to the current-arc state and supporting context (outline, mode substrate, roster, threads). Let the situation's actual shape govern the cohort SIZE and the number of pool variables — a locked-in possibility space supports a few continuations, a fan-out moment supports many. Don't pad, don't force diversity, don't trim. Fresh look from the historical record, not a projection from the arc's Present variables. Output strict JSON only.`;

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
      description?: unknown;
      reasoning?: unknown;
      considered?: unknown;
      breaks?: unknown;
      opens?: unknown;
      activations?: unknown[];
      priorLogit?: unknown;
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

    // Activations over the shared pool. Materialise each into a full Variable
    // by joining with poolById, so the scenario.variables[] consumers (UI,
    // parallel coords, branch generation) read the live coordination directly.
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

    if (variables.length === 0) continue;
    const priorLogit = typeof s.priorLogit === 'number'
      ? Math.max(PRIOR_LOGIT_MIN, Math.min(PRIOR_LOGIT_MAX, s.priorLogit))
      : 0;
    out.push({
      id: `pl-${out.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description: typeof s.description === 'string' ? s.description.trim() : undefined,
      reasoning: typeof s.reasoning === 'string' ? s.reasoning.trim() : undefined,
      considered: typeof s.considered === 'string' ? s.considered.trim() : undefined,
      breaks: typeof s.breaks === 'string' ? s.breaks.trim() : undefined,
      opens: typeof s.opens === 'string' ? s.opens.trim() : undefined,
      color: SCENARIO_COLORS[out.length % SCENARIO_COLORS.length],
      variables,
      priorLogit,
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

REGISTER FIRST. Identify the substrate (story / simulation / paper-essay-argument). Score continuations in the register's own vocabulary — a paper's "next direction" is argumentative / methodological / evidentiary motion, not causal-event motion in a simulated world.

DISCIPLINES (universal).
  • SURFACE vs SUBSTRATE. Score coordinations of FORCES, not symptoms. A scenario built from symptoms reads as low signal regardless of intensities.
  • PIVOT CHECK. If the arc ends at a discontinuity (regime shift, paradigm break, methodological reframe), a scenario that implicitly denies the pivot is mis-specified — score sharply low and say so.
  • POWER-LAW. Rare-but-pivotal scenarios are real. Don't penalise low intensity merely because it's quiet, and don't penalise rupture merely because it's unusual. Score what the evidence supports.

Probabilities are RELATIVE — softmax over priorLogits across this scenario and its siblings. Place this scenario in its right RELATIVE position; don't drift toward 0. Use the full [-4, +4] range when the coordination genuinely lands there.

Ground in:
  • Narrative context (outline, mode substrate, scenes, threads, roster, prior arcs)
  • Mechanisms loaded in the roster's artifacts and key-actor world-graphs
  • The scenario's revised coordination — which variables, what intensities, in combination
  • The sibling scenarios — relative anchoring

priorLogit is INDEPENDENT of intensity. Score the coordination's plausibility, not its amplitude.

Include the universal INFERENCE-SHAPE fields, each substantive (not a paraphrase of the activations):
  • reasoning — three to five sentences laying out the load-bearing logic: which variables cascade into which, why these intensities, why this priorLogit and not one notch higher or lower, and where the cohort anchors land it ("more plausible than X because…").
  • considered (REQUIRED — load-bearing) — one to three sentences. The OPTION SPACE this scenario selected from. Which adjacent coordinations were considered and rejected, which sibling scenarios this one specifically contrasts against, which rival readings of the substrate were drafted and discarded. Comparative reasoning — not a summary. This is the field that distinguishes a scenario CHOSEN from a scenario SELECTED over alternatives. Escape valve: if no genuine alternative coordination applies, state that explicitly in \`considered\` rather than omitting it.
  • breaks — one to two sentences. The FALSIFICATION HANDLE. What observation would mean this scenario didn't happen — the falsifying evidence, the threshold whose non-crossing voids the scenario, the load-bearing assumption whose breakage rules it out. If you can't name one, the scenario isn't forecasting — say so.
  • opens — one to two sentences. The FORWARD EXTENSION. If this scenario holds, what cascades downstream — the threads it opens for the next arc, the markets it perturbs, the affordances it grants future continuations.

Output strict JSON: { "priorLogit": <number>, "reasoning": "...", "considered": "...", "breaks": "...", "opens": "..." }`;

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
  reasoning: string;
  considered?: string;
  breaks?: string;
  opens?: string;
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
      return `  • ${s.name} [priorLogit ${prior}]${s.description ? ` — ${s.description}` : ''}\n    variables: ${variables}`;
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

<scenario-under-review name="${input.scenario.name}"${input.scenario.description ? ` description="${input.scenario.description}"` : ''}>
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

  const parsed = parseJson(raw, 'rescoreScenario') as {
    priorLogit?: unknown;
    reasoning?: unknown;
    considered?: unknown;
    breaks?: unknown;
    opens?: unknown;
  };
  const priorLogit = typeof parsed.priorLogit === 'number'
    ? Math.max(PRIOR_LOGIT_MIN, Math.min(PRIOR_LOGIT_MAX, parsed.priorLogit))
    : 0;
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '';
  const considered = typeof parsed.considered === 'string' && parsed.considered.trim()
    ? parsed.considered.trim()
    : undefined;
  const breaks = typeof parsed.breaks === 'string' && parsed.breaks.trim()
    ? parsed.breaks.trim()
    : undefined;
  const opens = typeof parsed.opens === 'string' && parsed.opens.trim()
    ? parsed.opens.trim()
    : undefined;
  return { priorLogit, reasoning, considered, breaks, opens };
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
