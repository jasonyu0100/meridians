/**
 * Per-arc variable generation — the Compass surfaces.
 *
 * The Compass is the engine's forward-looking direction-finder: a probability
 * distribution over feasible next moves grounded in a factor model
 * (variables) of the work's reality. Three surfaces share this machinery:
 *
 *   • PRESENT — the arc's current factor-model snapshot (`extractArcPresent`).
 *   • COMPASS COHORT — softmax-weighted set of next directions
 *     (`generatePlanningScenarios`).
 *   • RESCORE — re-evaluate one direction after operator edits
 *     (`rescoreScenario`).
 *
 * No shared catalogue. Each arc owns its own custom-generated Present
 * variables; each Compass direction owns its own custom-generated variable
 * set too — generated for that specific direction at the moment of
 * generation. Probability across a cohort is softmax over LLM-estimated
 * `priorLogit` values; intensity is NOT used as a probability proxy.
 *
 * System prompts are paradigm-aware and built per-call via
 * `paradigm-compass.ts`. The model receives a focused, paradigm-specific
 * lens — not a register-detection switch — and reads priorLogits as
 * precision prediction (simulation) or recommendation strength (everything
 * else). See `paradigm-compass.ts` for the per-paradigm dispatch.
 */

import {
  ANALYSIS_TEMPERATURE,
  MAX_TOKENS_DEFAULT,
  PREDICTIVE_MODEL,
} from "@/lib/constants";
import type {
  Arc,
  Artifact,
  Character,
  Location,
  NarrativeState,
  PlanningScenario,
  Scene,
  Thread,
  Variable,
} from "@/types/narrative";
import { callGenerate, callGenerateStream, resolveWebsearch } from "./api";
import { parseJson } from "./json";
import {
  buildCompassGenerationSystem,
  buildCompassRescoreSystem,
  buildPresentExtractionSystem,
  workIdentityFor,
} from "@/lib/prompts/paradigm";
import {
  clampIntensity,
  clampPriorLogit,
  INTENSITY_LEVELS,
} from "@/lib/prompts/calibration";

// Re-export INTENSITY_LEVELS under the legacy name so existing UI imports
// keep working without churn. The labels / descriptions / numeric ordering
// are calibrated identically.
export const VARIABLE_INTENSITY_LEVELS = INTENSITY_LEVELS;

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
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
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
  if (arcsOrdered.length === 0) return "";
  // For each arc, surface its Present coordination annotation when one was
  // recorded — description + reasoning + the universal inference-shape
  // fields. This lets downstream variable / scenario generation inherit the
  // comparative + falsification reasoning a prior arc already produced,
  // rather than re-deriving it from scratch.
  return arcsOrdered
    .map((arc) => {
      const dir = arc.directionVector
        ? `\n    direction: ${clean(arc.directionVector)}`
        : "";
      const ws = arc.worldState ? `\n    state: ${clean(arc.worldState)}` : "";
      const presentParts: string[] = [];
      if (arc.presentDescription)
        presentParts.push(
          `      description: ${clean(arc.presentDescription)}`,
        );
      if (arc.presentReasoning)
        presentParts.push(`      reasoning: ${clean(arc.presentReasoning)}`);
      if (arc.presentConsidered)
        presentParts.push(
          `      × considered: ${clean(arc.presentConsidered)}`,
        );
      if (arc.presentBreaks)
        presentParts.push(`      ! breaks: ${clean(arc.presentBreaks)}`);
      if (arc.presentOpens)
        presentParts.push(`      ⇒ opens: ${clean(arc.presentOpens)}`);
      const present =
        presentParts.length > 0
          ? `\n    present:\n${presentParts.join("\n")}`
          : "";
      return `  - id: ${arc.id}\n    name: "${arc.name}"${dir}${ws}${present}`;
    })
    .join("\n");
}

function renderScenesBlock(src: VariablesContextSource): string {
  const ordered = cutoffSceneIds(src);
  const total = ordered.length;
  if (total === 0) return "";
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
    const povStr = pov ? `pov=${pov}` : "pov=—";
    const summary =
      sc.events.length > 0 ? clean(sc.events.join(" · ")) : "(no events)";
    lines.push(
      `  [${idx}] arc=${arcPrefix} loc=${locName} ${povStr} :: ${summary}`,
    );
  });
  return lines.join("\n");
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
      .map(
        (p) =>
          src.characters[p.id]?.name ||
          src.locations[p.id]?.name ||
          src.artifacts[p.id]?.name ||
          p.id,
      )
      .join(", ");
    const stance =
      t.stances?.["__NARRATOR__"] ?? Object.values(t.stances ?? {})[0];
    let priceLine = "";
    if (
      stance &&
      Array.isArray(stance.logits) &&
      t.outcomes.length === stance.logits.length
    ) {
      const max = Math.max(...stance.logits);
      const exps = stance.logits.map((l) => Math.exp(l - max));
      const sum = exps.reduce((a, b) => a + b, 0) || 1;
      const probs = exps.map((e) => e / sum);
      const top = probs
        .map((p, i) => ({ p, name: t.outcomes[i] }))
        .sort((a, b) => b.p - a.p);
      priceLine = ` — price: ${top.map((x) => `${x.name} ${(x.p * 100).toFixed(0)}%`).join(" / ")}`;
    }
    if (isClosed) {
      const winner = t.closeOutcome != null ? t.outcomes[t.closeOutcome] : "?";
      const idx = ordered.indexOf(t.closedAt!);
      closedLines.push({
        line: `  ${t.id}: "${clean(t.description)}" — closed ${winner}${t.resolutionQuality != null ? ` (q=${t.resolutionQuality.toFixed(2)})` : ""} :: ${participants}`,
        ord: idx,
      });
    } else {
      liveLines.push(
        `  ${t.id}: "${clean(t.description)}"${priceLine} :: ${participants}`,
      );
    }
  }
  closedLines.sort((a, b) => b.ord - a.ord);
  const sections: string[] = [];
  if (liveLines.length > 0)
    sections.push(`<threads-live>\n${liveLines.join("\n")}\n</threads-live>`);
  if (closedLines.length > 0) {
    sections.push(
      `<threads-closed>\n${closedLines.map((c) => c.line).join("\n")}\n</threads-closed>`,
    );
  }
  return sections.join("\n");
}

function renderRosterBlock(src: VariablesContextSource): string {
  const chars = Object.values(src.characters).filter(
    (c) => c.role !== "transient",
  );
  chars.sort((a, b) => {
    const rank = (r: string) =>
      r === "anchor" ? 0 : r === "recurring" ? 1 : 2;
    const dr = rank(a.role) - rank(b.role);
    return dr !== 0 ? dr : a.name.localeCompare(b.name);
  });
  const locs = Object.values(src.locations).filter(
    (l) => l.prominence !== "margin",
  );
  locs.sort((a, b) => {
    const rank = (p: string) => (p === "domain" ? 0 : p === "place" ? 1 : 2);
    const dr = rank(a.prominence) - rank(b.prominence);
    return dr !== 0 ? dr : a.name.localeCompare(b.name);
  });
  const arts = Object.values(src.artifacts).filter(
    (a) => a.significance !== "minor",
  );
  arts.sort((a, b) => {
    const rank = (s: string) => (s === "key" ? 0 : s === "notable" ? 1 : 2);
    const dr = rank(a.significance) - rank(b.significance);
    return dr !== 0 ? dr : a.name.localeCompare(b.name);
  });

  const charLines = chars
    .map((c) => {
      const worldHead = Object.values(c.world?.nodes ?? {})
        .map((n) => n.content)
        .join("; ");
      const sketch = worldHead ? ` — ${clean(worldHead)}` : "";
      return `  * ${c.role}: ${c.name}${sketch}`;
    })
    .join("\n");
  const locLines = locs
    .map((l) => {
      const worldHead = Object.values(l.world?.nodes ?? {})
        .map((n) => n.content)
        .join("; ");
      const sketch = worldHead ? ` — ${clean(worldHead)}` : "";
      return `  * ${l.prominence}: ${l.name}${sketch}`;
    })
    .join("\n");
  const artLines = arts
    .map((a) => {
      const worldHead = Object.values(a.world?.nodes ?? {})
        .map((n) => n.content)
        .join("; ");
      const sketch = worldHead ? ` — ${clean(worldHead)}` : "";
      return `  * ${a.significance}: ${a.name}${sketch}`;
    })
    .join("\n");
  const out: string[] = [];
  if (charLines) out.push(`<characters>\n${charLines}\n</characters>`);
  if (locLines) out.push(`<locations>\n${locLines}\n</locations>`);
  if (artLines) out.push(`<artifacts>\n${artLines}\n</artifacts>`);
  return out.join("\n");
}

export function renderVariablesContextBlock(
  src: VariablesContextSource,
  opts: RenderOptions = {},
): string {
  const sections: string[] = [];
  const arcs = opts.includeArcStates !== false ? renderArcsBlock(src) : "";
  if (arcs) sections.push(`<arcs-ordered>\n${arcs}\n</arcs-ordered>`);
  const scenes = renderScenesBlock(src);
  if (scenes)
    sections.push(`<scenes-up-to-current>\n${scenes}\n</scenes-up-to-current>`);
  const threads = renderThreadsBlock(src);
  if (threads) sections.push(threads);
  const roster = renderRosterBlock(src);
  if (roster) sections.push(roster);
  return sections.join("\n\n");
}

// ── Per-arc Present extraction ─────────────────────────────────────────────
//
// System prompt is built by `buildPresentExtractionSystem(work)` from
// `paradigm-compass.ts`. It dispatches on the operator-declared paradigm so
// the model sees ONLY that paradigm's lens — not a register-detection switch.

export interface ExtractPresentInput {
  /** Full narrative — used internally to resolve websearch + (optionally) reasoning. */
  narrative: NarrativeState;
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
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    id?: unknown;
    name?: unknown;
    description?: unknown;
    category?: unknown;
    intensity?: unknown;
  };
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!id || !name) return null;
  const intensity = clampIntensity(r.intensity);
  if (intensity === 0) return null;
  return {
    id,
    name,
    description: typeof r.description === "string" ? r.description.trim() : "",
    category: typeof r.category === "string" ? r.category.trim() : "general",
    intensity,
  };
}

export interface ExtractPresentResult {
  variables: Variable[];
  /** Compass the variable set was extracted against — paradigm name + the
   *  operative cues (forward-motion shape, attractors, cadence, tail). One
   *  dense line (≤ 30 words); a fingerprint of the lens this Present was
   *  drawn through. Surfaced in the UI so the user can audit "is the model
   *  reading this work as the right kind of work?". */
  paradigm?: string;
  /** Short one-sentence gestalt of the Present coordination. Same shape used
   *  by Compass directions (description + reasoning + universal inference
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
  /** Self-estimated log-prior in STANCE_EVIDENCE_MIN/MAX range — a glimpse
   *  into how plausible this coordination was at the time. */
  priorLogit?: number;
}

export async function extractArcPresent(
  input: ExtractPresentInput,
): Promise<ExtractPresentResult> {
  const arc = input.arc;
  const summary = (arc.summary ?? "(no summary)").replace(/\s+/g, " ").trim();
  const dirVec = arc.directionVector
    ? `\n  direction: ${arc.directionVector}`
    : "";
  const contextBlock = input.context
    ? renderVariablesContextBlock(input.context, { focusArcId: arc.id })
    : "";
  const directionBlock = input.direction
    ? `\n<direction>\n${input.direction.trim()}\n</direction>\n`
    : "";
  // Outline + Mode sections are the highest-signal context blocks: a tight
  // arc-by-arc recap up to the current scene, and the working-machinery
  // substrate the variables should inherit from.
  const outlineBlock = input.outline ? `\n${input.outline}\n` : "";
  const modeBlock = input.modeSection ? `\n${input.modeSection}\n` : "";

  const work = workIdentityFor(input.narrative);
  const systemPrompt = buildPresentExtractionSystem(work);

  const prompt = `<arc>
  id: ${arc.id}
  name: "${arc.name}"${dirVec}
  state: ${summary}
</arc>
${outlineBlock}${modeBlock}${contextBlock ? `\n${contextBlock}\n` : ""}${directionBlock}
Identify this arc's Present variable set. Apply the disciplines above to the current-arc state and the supporting context (outline, mode substrate, roster, threads). Variables distil pieces of the substrate — not paraphrase them, distil them. Output strict JSON only.`;

  const raw = input.onReasoning
    ? await callGenerateStream(
        prompt,
        systemPrompt,
        () => {},
        MAX_TOKENS_DEFAULT,
        "extractArcPresent",
        PREDICTIVE_MODEL,
        input.reasoningBudget,
        input.onReasoning,
        ANALYSIS_TEMPERATURE,
        resolveWebsearch(input.narrative),
      )
    : await callGenerate(
        prompt,
        systemPrompt,
        MAX_TOKENS_DEFAULT,
        "extractArcPresent",
        PREDICTIVE_MODEL,
        input.reasoningBudget,
        true,
        ANALYSIS_TEMPERATURE,
        resolveWebsearch(input.narrative),
      );

  const parsed = parseJson(raw, "extractArcPresent") as {
    variables?: unknown[];
    paradigm?: unknown;
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
  const paradigm =
    typeof parsed.paradigm === "string" && parsed.paradigm.trim()
      ? parsed.paradigm.trim()
      : undefined;
  const description =
    typeof parsed.description === "string" ? parsed.description.trim() : "";
  const reasoning =
    typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";
  const considered =
    typeof parsed.considered === "string" && parsed.considered.trim()
      ? parsed.considered.trim()
      : undefined;
  const breaks =
    typeof parsed.breaks === "string" && parsed.breaks.trim()
      ? parsed.breaks.trim()
      : undefined;
  const opens =
    typeof parsed.opens === "string" && parsed.opens.trim()
      ? parsed.opens.trim()
      : undefined;
  const priorLogit =
    typeof parsed.priorLogit === "number" && Number.isFinite(parsed.priorLogit)
      ? clampPriorLogit(parsed.priorLogit)
      : undefined;
  return {
    variables,
    paradigm,
    description: description || undefined,
    reasoning: reasoning || undefined,
    considered,
    breaks,
    opens,
    priorLogit,
  };
}

// ── Compass cohort — each scenario with its own coordination over the pool ──
//
// System prompt is built by `buildCompassGenerationSystem(work)` from
// `paradigm-compass.ts`. Per-paradigm dispatch — the model sees a focused
// ~150-word lens for the operator-declared paradigm instead of a monolithic
// register-detection block.

export interface ScenarioGenerationInput {
  /** Full narrative — used internally to resolve websearch + (optionally) reasoning. */
  narrative: NarrativeState;
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

export interface GeneratePlanningScenariosResult {
  /** Compass the cohort was drafted against — paradigm name + the operative
   *  cues (forward-motion shape, attractors, cadence, tail). One dense line
   *  (≤ 30 words); the same fingerprint Present emits. */
  paradigm?: string;
  scenarios: PlanningScenario[];
}

export async function generatePlanningScenarios(
  input: ScenarioGenerationInput,
): Promise<GeneratePlanningScenariosResult> {
  // Cohort size is flexible — the prompt tells the LLM to let the situation
  // decide. No clamp here; a tight possibility space yields a few scenarios,
  // a genuine fan-out moment yields more.

  const dirVec = input.arc.directionVector
    ? `\n  direction: ${input.arc.directionVector}`
    : "";
  const summary = (input.arc.summary ?? "(no summary)")
    .replace(/\s+/g, " ")
    .trim();
  const contextBlock = input.context
    ? renderVariablesContextBlock(input.context, { focusArcId: input.arc.id })
    : "";
  const directionBlock = input.direction
    ? `\n<direction>\n${input.direction.trim()}\n</direction>\n`
    : "";
  // Outline + Mode sections — same high-signal context blocks used by
  // Present extraction. Scenarios inherit the same substrate so the
  // coordinations they propose are grounded in the world's machinery.
  const outlineBlock = input.outline ? `\n${input.outline}\n` : "";
  const modeBlock = input.modeSection ? `\n${input.modeSection}\n` : "";

  // Compass cohort generation is INDEPENDENT of Present. It is a fresh look
  // at the situation grounded in work context (outline, mode substrate,
  // scenes, threads, roster, prior arcs). No Present-variable block —
  // Compass and Present are two separate analyses of the same evidence.
  const work = workIdentityFor(input.narrative);
  const systemPrompt = buildCompassGenerationSystem(work);

  const prompt = `<current-arc id="${input.arc.id}" name="${input.arc.name}">${dirVec}
  state: ${summary}
</current-arc>
${outlineBlock}${modeBlock}${contextBlock ? `\n${contextBlock}\n` : ""}${directionBlock}
Produce the Compass cohort for this arc. Apply the disciplines and pipeline above to the current-arc state and supporting context (outline, mode substrate, roster, threads). Let the situation's actual shape govern the cohort SIZE and the number of pool variables — a locked-in possibility space supports a few continuations, a fan-out moment supports many. Don't pad, don't force diversity, don't trim. Fresh look from the historical record, not a projection from the arc's Present variables. Read priorLogits in the COMPASS MODE declared in the system prompt — precision prediction for simulation, recommendation strength for every other paradigm. Output strict JSON only.`;

  const raw = input.onReasoning
    ? await callGenerateStream(
        prompt,
        systemPrompt,
        () => {},
        MAX_TOKENS_DEFAULT,
        "generatePlanningScenarios",
        PREDICTIVE_MODEL,
        input.reasoningBudget,
        input.onReasoning,
        ANALYSIS_TEMPERATURE,
        resolveWebsearch(input.narrative),
      )
    : await callGenerate(
        prompt,
        systemPrompt,
        MAX_TOKENS_DEFAULT,
        "generatePlanningScenarios",
        PREDICTIVE_MODEL,
        input.reasoningBudget,
        true,
        ANALYSIS_TEMPERATURE,
        resolveWebsearch(input.narrative),
      );

  const parsed = parseJson(raw, "generatePlanningScenarios") as {
    paradigm?: unknown;
    pool?: Array<{
      id?: unknown;
      name?: unknown;
      description?: unknown;
      category?: unknown;
    }>;
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

  const paradigm =
    typeof parsed.paradigm === "string" && parsed.paradigm.trim()
      ? parsed.paradigm.trim()
      : undefined;

  // Pool: name → {id, name, description, category} (no intensity — pool entries
  // are variable definitions; intensity lives per scenario via activations).
  const poolById = new Map<
    string,
    { id: string; name: string; description: string; category: string }
  >();
  for (const r of parsed.pool ?? []) {
    if (!r || typeof r !== "object") continue;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!id || !name || poolById.has(id)) continue;
    poolById.set(id, {
      id,
      name,
      description:
        typeof r.description === "string" ? r.description.trim() : "",
      category: typeof r.category === "string" ? r.category.trim() : "general",
    });
  }

  const out: PlanningScenario[] = [];
  for (const s of parsed.scenarios ?? []) {
    if (typeof s !== "object" || s === null) continue;
    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (!name) continue;

    const seen = new Set<string>();
    const variables: Variable[] = [];

    // Activations over the shared pool. Materialise each into a full Variable
    // by joining with poolById, so the scenario.variables[] consumers (UI,
    // parallel coords, branch generation) read the live coordination directly.
    if (Array.isArray(s.activations)) {
      for (const a of s.activations) {
        if (!a || typeof a !== "object") continue;
        const ar = a as { variableId?: unknown; intensity?: unknown };
        const variableId =
          typeof ar.variableId === "string" ? ar.variableId.trim() : "";
        const intensity = clampIntensity(ar.intensity);
        if (!variableId || intensity === 0 || seen.has(variableId)) continue;
        const def = poolById.get(variableId);
        if (!def) continue;
        seen.add(variableId);
        variables.push({ ...def, intensity });
      }
    }

    if (variables.length === 0) continue;
    const priorLogit =
      typeof s.priorLogit === "number" ? clampPriorLogit(s.priorLogit) : 0;
    out.push({
      id: `pl-${out.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description:
        typeof s.description === "string" ? s.description.trim() : undefined,
      reasoning:
        typeof s.reasoning === "string" ? s.reasoning.trim() : undefined,
      considered:
        typeof s.considered === "string" ? s.considered.trim() : undefined,
      breaks: typeof s.breaks === "string" ? s.breaks.trim() : undefined,
      opens: typeof s.opens === "string" ? s.opens.trim() : undefined,
      color: SCENARIO_COLORS[out.length % SCENARIO_COLORS.length],
      variables,
      priorLogit,
    });
  }
  return { paradigm, scenarios: out };
}

/**
 * Project a Compass direction into a Present-style variable set for a new
 * branch arc. The result drops every variable the direction didn't activate
 * (intensity = 0), keeping only the variables that matter to this direction.
 * Used by Experimentation when materialising a Compass direction into a
 * branch.
 */
export function presentFromScenario(scenario: PlanningScenario): Variable[] {
  return scenario.variables.filter((v) => v.intensity > 0);
}

// ── Compass rescore (post-edit save) ───────────────────────────────────────
//
// System prompt is built by `buildCompassRescoreSystem(work)` from
// `paradigm-compass.ts`. Same per-paradigm dispatch as Present + Cohort.

export interface RescoreScenarioInput {
  /** Full narrative — used internally to resolve websearch + reasoning. */
  narrative: NarrativeState;
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

export async function rescoreScenario(
  input: RescoreScenarioInput,
): Promise<RescoreScenarioResult> {
  const dispoBlock =
    input.scenario.variables.length > 0
      ? input.scenario.variables
          .map(
            (v) =>
              `  - ${v.name} (${v.category}) @ ${VARIABLE_INTENSITY_LEVELS[v.intensity]?.label ?? "?"} — ${v.description}`,
          )
          .join("\n")
      : "  (no variables active)";

  const cohortBlock = input.cohort
    .filter((s) => s.id !== input.scenario.id)
    .map((s) => {
      const variables =
        s.variables.length > 0
          ? s.variables
              .map(
                (v) =>
                  `${v.name}@${VARIABLE_INTENSITY_LEVELS[v.intensity]?.label ?? "?"}`,
              )
              .join(", ")
          : "(none)";
      const prior =
        typeof s.priorLogit === "number" ? s.priorLogit.toFixed(1) : "0";
      return `  • ${s.name} [priorLogit ${prior}]${s.description ? ` — ${s.description}` : ""}\n    variables: ${variables}`;
    })
    .join("\n");

  const dirVec = input.arc.directionVector
    ? `\n  direction: ${input.arc.directionVector}`
    : "";
  const summary = (input.arc.summary ?? "(no summary)")
    .replace(/\s+/g, " ")
    .trim();
  const contextBlock = input.context
    ? renderVariablesContextBlock(input.context, { focusArcId: input.arc.id })
    : "";
  const outlineBlock = input.outline ? `\n${input.outline}\n` : "";
  const modeBlock = input.modeSection ? `\n${input.modeSection}\n` : "";

  const work = workIdentityFor(input.narrative);
  const systemPrompt = buildCompassRescoreSystem(work);

  const prompt = `<current-arc id="${input.arc.id}" name="${input.arc.name}">${dirVec}
  state: ${summary}
</current-arc>

<scenario-under-review name="${input.scenario.name}"${input.scenario.description ? ` description="${input.scenario.description}"` : ""}>
${dispoBlock}
</scenario-under-review>

<sibling-scenarios>
${cohortBlock || "  (no siblings)"}
</sibling-scenarios>
${outlineBlock}${modeBlock}${contextBlock ? `\n${contextBlock}\n` : ""}
Re-score this scenario's priorLogit given its edited coordination, the cohort context, and the substrate (outline + Mode). Read the score in the COMPASS MODE the system prompt declares. Output strict JSON only.`;

  const raw = await callGenerate(
    prompt,
    systemPrompt,
    MAX_TOKENS_DEFAULT,
    "rescoreScenario",
    PREDICTIVE_MODEL,
    undefined,
    true,
    ANALYSIS_TEMPERATURE,
    resolveWebsearch(input.narrative),
  );

  const parsed = parseJson(raw, "rescoreScenario") as {
    priorLogit?: unknown;
    reasoning?: unknown;
    considered?: unknown;
    breaks?: unknown;
    opens?: unknown;
  };
  const priorLogit =
    typeof parsed.priorLogit === "number" ? clampPriorLogit(parsed.priorLogit) : 0;
  const reasoning =
    typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";
  const considered =
    typeof parsed.considered === "string" && parsed.considered.trim()
      ? parsed.considered.trim()
      : undefined;
  const breaks =
    typeof parsed.breaks === "string" && parsed.breaks.trim()
      ? parsed.breaks.trim()
      : undefined;
  const opens =
    typeof parsed.opens === "string" && parsed.opens.trim()
      ? parsed.opens.trim()
      : undefined;
  return { priorLogit, reasoning, considered, breaks, opens };
}

// ── Probability model ──────────────────────────────────────────────────────

export function scenarioLogit(scenario: PlanningScenario): number {
  return typeof scenario.priorLogit === "number" ? scenario.priorLogit : 0;
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
  scenarios.forEach((s, i) => {
    out[s.id] = exps[i] / sum;
  });
  return out;
}

// ── Palettes ───────────────────────────────────────────────────────────────
// (Intensity scale `VARIABLE_INTENSITY_LEVELS` lives at the top of this file,
// re-exported from the calibration layer.)

export const SCENARIO_COLORS: readonly string[] = [
  "#34d399",
  "#a78bfa",
  "#fbbf24",
  "#fb7185",
  "#fb923c",
  "#f87171",
  "#38bdf8",
  "#22d3ee",
  "#f472b6",
  "#facc15",
] as const;

export const CATEGORY_PALETTE: readonly string[] = [
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#fb7185",
  "#38bdf8",
  "#fb923c",
  "#22d3ee",
  "#f472b6",
] as const;

export function categoryColor(category: string): string {
  let h = 0;
  for (let i = 0; i < category.length; i++) {
    h = (h * 31 + category.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}
