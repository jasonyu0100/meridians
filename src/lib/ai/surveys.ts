/**
 * Survey executor — query characters, locations, and artifacts in parallel
 * using their world-graph continuity (the same private-self-knowledge
 * mechanism the Character chat persona uses). Each respondent answers in
 * voice; the aggregate becomes a research signal for the author.
 *
 * Pure helpers here (resolve, build prompts, parse). The orchestrator
 * dispatches LLM calls and stores responses back via the supplied callback.
 */

import { callGenerate, resolveReasoningBudget } from "@/lib/ai/api";
import { narrativeContext } from "@/lib/ai/context";
import { FatalApiError } from "@/lib/ai/errors";
import { parseJson } from "@/lib/ai/json";
import { INTERACTION_MODEL, ANALYSIS_TEMPERATURE } from "@/lib/constants";
import {
  buildCharacterPersona,
  buildLocationPersona,
  buildArtifactPersona,
  buildSurveyUserPrompt,
  buildSurveyProposalUserPrompt,
  SURVEY_GEN_SYSTEM,
} from "@/lib/prompts/surveys";
import type {
  Artifact,
  Character,
  Location,
  NarrativeState,
  Survey,
  SurveyConfig,
  SurveyQuestionType,
  SurveyResponse,
  SurveyRespondentFilter,
  SurveyRespondentKind,
} from "@/types/narrative";

// ── Respondent resolution ─────────────────────────────────────────────────

export type Respondent =
  | { kind: "character"; id: string; entity: Character }
  | { kind: "location"; id: string; entity: Location }
  | { kind: "artifact"; id: string; entity: Artifact };

export function respondentName(r: Respondent): string {
  return r.entity.name;
}

/**
 * Apply the survey's filter to the narrative and return every entity that
 * qualifies. Order: anchors / domain locations / key artifacts first so
 * progress UI shows the most important respondents resolving first.
 */
export function resolveRespondents(
  narrative: NarrativeState,
  filter: SurveyRespondentFilter,
): Respondent[] {
  const out: Respondent[] = [];

  if (filter.kinds.includes("character")) {
    const allowedRoles = new Set(filter.characterRoles ?? ["anchor", "recurring", "transient"]);
    for (const c of Object.values(narrative.characters)) {
      if (allowedRoles.has(c.role)) out.push({ kind: "character", id: c.id, entity: c });
    }
  }

  if (filter.kinds.includes("location")) {
    const allowed = new Set(filter.locationProminence ?? ["domain", "place", "margin"]);
    for (const l of Object.values(narrative.locations)) {
      if (allowed.has(l.prominence)) out.push({ kind: "location", id: l.id, entity: l });
    }
  }

  if (filter.kinds.includes("artifact")) {
    const allowed = new Set(filter.artifactSignificance ?? ["key", "notable", "minor"]);
    for (const a of Object.values(narrative.artifacts ?? {})) {
      if (allowed.has(a.significance)) out.push({ kind: "artifact", id: a.id, entity: a });
    }
  }

  // Stable ordering — anchor/domain/key first, then by name within each tier.
  const tier = (r: Respondent): number => {
    if (r.kind === "character") return r.entity.role === "anchor" ? 0 : r.entity.role === "recurring" ? 1 : 2;
    if (r.kind === "location") return r.entity.prominence === "domain" ? 0 : r.entity.prominence === "place" ? 1 : 2;
    return r.entity.significance === "key" ? 0 : r.entity.significance === "notable" ? 1 : 2;
  };
  return out.sort((a, b) => tier(a) - tier(b) || a.entity.name.localeCompare(b.entity.name));
}

// ── Persona prompt builders ────────────────────────────────────────────────
// Each kind speaks from its own continuity. The same private-self-knowledge
// principle applies: the world graph is raw awareness, not a script to
// recite. The persona answers the question through that filter.

export { buildSurveyUserPrompt };

export function buildRespondentPersona(narrative: NarrativeState, r: Respondent): string {
  if (r.kind === "character") {
    return buildCharacterPersona({
      characterName: r.entity.name,
      worldGraph: r.entity.world,
      worldSummary: narrative.worldSummary,
    });
  }
  if (r.kind === "location") {
    return buildLocationPersona({
      locationName: r.entity.name,
      worldGraph: r.entity.world,
      worldSummary: narrative.worldSummary,
    });
  }
  return buildArtifactPersona({
    artifactName: r.entity.name,
    worldGraph: r.entity.world,
    worldSummary: narrative.worldSummary,
  });
}

// ── Response parser ────────────────────────────────────────────────────────

type RawAnswer = { answer: unknown; reasoning?: unknown };

export function parseSurveyResponse(
  raw: string,
  survey: Survey,
  respondent: Respondent,
): SurveyResponse {
  const parsed = parseJson(raw, `survey:${survey.id}:${respondent.id}`) as RawAnswer;
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";
  const base = {
    respondentId: respondent.id,
    respondentKind: respondent.kind,
    reasoning,
    timestamp: Date.now(),
  };

  switch (survey.questionType) {
    case "binary": {
      const v = parsed.answer;
      const value = typeof v === "boolean" ? v : typeof v === "string" ? /^(yes|true|1)$/i.test(v.trim()) : false;
      return { ...base, answer: { type: "binary", value } };
    }
    case "likert": {
      const scale = survey.config?.scale ?? 5;
      const v = typeof parsed.answer === "number" ? parsed.answer : Number(parsed.answer);
      const value = clampInt(v, 1, scale);
      return { ...base, answer: { type: "likert", value } };
    }
    case "estimate": {
      const v = typeof parsed.answer === "number" ? parsed.answer : Number(parsed.answer);
      return { ...base, answer: { type: "estimate", value: Number.isFinite(v) ? v : 0 } };
    }
    case "choice": {
      const options = survey.config?.options ?? [];
      const v = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
      const matched = options.find((o) => o.toLowerCase() === v.toLowerCase()) ?? options[0] ?? v;
      return { ...base, answer: { type: "choice", value: matched } };
    }
    case "open":
      return {
        ...base,
        answer: { type: "open", value: typeof parsed.answer === "string" ? parsed.answer.trim() : "" },
      };
  }
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// ── Orchestrator ───────────────────────────────────────────────────────────

const SURVEY_CONCURRENCY = 5;

export type SurveyRunCallbacks = {
  /** Called when each respondent's answer (success or error) lands. */
  onResponse: (response: SurveyResponse) => void;
  /** Progress ticks: completed / total. */
  onProgress?: (completed: number, total: number) => void;
};

/**
 * Run the survey across every resolved respondent in parallel, capped at
 * `SURVEY_CONCURRENCY` in flight. Per-respondent failures are captured as
 * SurveyResponse with an `error` field so the UI can show coverage gaps.
 *
 * Throws `FatalApiError` to the caller if it surfaces (credit exhaustion,
 * auth, forbidden) — every loop in the codebase halts on this signal.
 */
export async function runSurvey(
  narrative: NarrativeState,
  survey: Survey,
  cb: SurveyRunCallbacks,
  cancelled: () => boolean,
): Promise<void> {
  const respondents = resolveRespondents(narrative, survey.respondentFilter);
  const total = respondents.length;
  let completed = 0;
  cb.onProgress?.(completed, total);

  let cursor = 0;
  let fatal: FatalApiError | null = null;

  async function worker() {
    while (cursor < respondents.length && !cancelled() && !fatal) {
      const r = respondents[cursor++];
      try {
        const systemPrompt = buildRespondentPersona(narrative, r);
        const userPrompt = buildSurveyUserPrompt(survey);
        const raw = await callGenerate(
          userPrompt,
          systemPrompt,
          undefined,
          `survey:${survey.questionType}`,
          INTERACTION_MODEL,
          resolveReasoningBudget(narrative),
          true, // jsonMode — every response is structured JSON
          ANALYSIS_TEMPERATURE, // near-deterministic — research signal must be reproducible
        );
        if (cancelled()) return;
        const response = parseSurveyResponse(raw, survey, r);
        cb.onResponse(response);
      } catch (err) {
        if (err instanceof FatalApiError) {
          fatal = err;
          return;
        }
        // Soft failure — record so the UI can show a coverage gap for this
        // respondent without losing the others.
        cb.onResponse({
          respondentId: r.id,
          respondentKind: r.kind,
          answer: defaultAnswerFor(survey),
          reasoning: "",
          timestamp: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        completed += 1;
        cb.onProgress?.(completed, total);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(SURVEY_CONCURRENCY, total) }, () => worker()));
  if (fatal) throw fatal;
}

function defaultAnswerFor(survey: Survey): SurveyResponse["answer"] {
  switch (survey.questionType) {
    case "binary": return { type: "binary", value: false };
    case "likert": return { type: "likert", value: Math.ceil((survey.config?.scale ?? 5) / 2) };
    case "estimate": return { type: "estimate", value: 0 };
    case "choice": return { type: "choice", value: survey.config?.options?.[0] ?? "" };
    case "open": return { type: "open", value: "" };
  }
}

// ── AI question generation ────────────────────────────────────────────────
// Given full narrative continuity, propose meaningful survey questions the
// author could pose. Each proposal includes question text, type, optional
// config (scale, unit, options) and a one-line `intent` so the user can
// understand WHY this question would be revealing.

export type SurveyProposal = {
  question: string;
  questionType: SurveyQuestionType;
  config?: SurveyConfig;
  /** What the author would learn from this — surfaces under the question. */
  intent: string;
  /**
   * Who this question should be asked of — the engine picks a scope that
   * fits the question (e.g. "do the anchors trust X?" → anchors only;
   * "estimate the distance to Y" → every character who might know).
   * The UI surfaces this as the initial scope selection; the author can
   * edit it before sending.
   */
  suggestedFilter?: SurveyRespondentFilter;
};


/** Generate ONE proposal tailored to the narrative — auto-populates the composer.
 *  An optional `category` tilts the question toward a specific lens
 *  (Personality, Values, Trust, etc. — see RESEARCH_CATEGORIES). */
export async function generateSurveyProposal(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  category?: string,
): Promise<SurveyProposal | null> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);
  const userPrompt = buildSurveyProposalUserPrompt({ narrativeContext: ctx, category });

  const raw = await callGenerate(
    userPrompt,
    SURVEY_GEN_SYSTEM,
    undefined,
    "generateSurveyProposal",
    INTERACTION_MODEL,
    resolveReasoningBudget(narrative),
    true,
    ANALYSIS_TEMPERATURE,
  );
  const parsed = parseJson(raw, "generateSurveyProposal") as Record<string, unknown>;
  return coerceProposal(parsed);
}

const VALID_TYPES: SurveyQuestionType[] = ["binary", "likert", "estimate", "choice", "open"];

/**
 * Toggle one tier in a survey's respondent filter. The UI treats an
 * undefined tier list as "all tiers included" — clicking a lit chip
 * must therefore REMOVE that tier from the implicit full set, not
 * create a single-element list (a silent narrowing bug). When the
 * resulting list covers every tier, it collapses back to undefined.
 *
 * Pure helper exposed here so the reducer-like semantics can be pinned
 * by tests independent of the composer component.
 */
export function toggleRespondentTier(
  filter: SurveyRespondentFilter,
  key: "characterRoles" | "locationProminence" | "artifactSignificance",
  tier: string,
  allTiers: readonly string[],
): SurveyRespondentFilter {
  const raw = filter[key] as string[] | undefined;
  const current = raw ?? [...allTiers];
  const next = current.includes(tier)
    ? current.filter((t) => t !== tier)
    : [...current, tier];
  const isAll = allTiers.every((t) => next.includes(t));
  return { ...filter, [key]: isAll ? undefined : next };
}

/** Exported for tests — shape-checks the LLM's proposal JSON and fills in defaults. */
export function coerceProposal(p: Record<string, unknown>): SurveyProposal | null {
  const question = typeof p.question === "string" ? p.question.trim() : "";
  if (!question) return null;
  const questionType = VALID_TYPES.includes(p.questionType as SurveyQuestionType)
    ? (p.questionType as SurveyQuestionType)
    : "binary";
  const intent = typeof p.intent === "string" ? p.intent.trim() : "";
  const config = coerceConfig(questionType, p.config);
  const suggestedFilter = coerceFilter(p.suggestedFilter);
  return {
    question,
    questionType,
    intent,
    ...(config ? { config } : {}),
    ...(suggestedFilter ? { suggestedFilter } : {}),
  };
}

const VALID_KINDS: SurveyRespondentKind[] = ["character", "location", "artifact"];
const VALID_ROLES = ["anchor", "recurring", "transient"] as const;
const VALID_PROMINENCE = ["domain", "place", "margin"] as const;
const VALID_SIGNIFICANCE = ["key", "notable", "minor"] as const;

function coerceFilter(raw: unknown): SurveyRespondentFilter | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const kinds = Array.isArray(r.kinds)
    ? (r.kinds as unknown[]).filter((k): k is SurveyRespondentKind =>
        typeof k === "string" && (VALID_KINDS as string[]).includes(k),
      )
    : [];
  if (kinds.length === 0) return undefined;
  const filter: SurveyRespondentFilter = { kinds };
  const sub = <T extends string>(arr: unknown, valid: readonly T[]): T[] | undefined => {
    if (!Array.isArray(arr)) return undefined;
    const out = (arr as unknown[]).filter((v): v is T => typeof v === "string" && (valid as readonly string[]).includes(v));
    return out.length > 0 ? out : undefined;
  };
  const roles = sub(r.characterRoles, VALID_ROLES);
  const prominence = sub(r.locationProminence, VALID_PROMINENCE);
  const significance = sub(r.artifactSignificance, VALID_SIGNIFICANCE);
  if (roles) filter.characterRoles = roles;
  if (prominence) filter.locationProminence = prominence;
  if (significance) filter.artifactSignificance = significance;
  return filter;
}

function coerceConfig(type: SurveyQuestionType, raw: unknown): SurveyConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (type === "likert") {
    const s = Number(r.scale);
    return { scale: (s === 3 || s === 7 ? s : 5) as 3 | 5 | 7 };
  }
  if (type === "estimate") {
    return typeof r.unit === "string" ? { unit: r.unit.trim() } : undefined;
  }
  if (type === "choice") {
    const opts = Array.isArray(r.options)
      ? (r.options as unknown[]).filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => o.trim())
      : [];
    return opts.length >= 2 ? { options: opts } : undefined;
  }
  return undefined;
}
