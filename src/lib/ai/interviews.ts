/**
 * Interview executor — ask one subject many questions in parallel using
 * its world-graph continuity. Same persona engine as surveys (reuses the
 * builders + parser from `./surveys`); only the axis is inverted (1 × N
 * questions instead of 1 question × N respondents).
 *
 * AI generation supports several research frames (psychology, knowledge,
 * values, predictions, backstory) so the author can pull a structured
 * batch of questions tailored to one subject's recorded continuity.
 */

import { callGenerate, resolveReasoningBudget } from "@/lib/ai/api";
import { narrativeContext } from "@/lib/ai/context";
import { FatalApiError } from "@/lib/ai/errors";
import { parseJson } from "@/lib/ai/json";
import { INTERACTION_MODEL, ANALYSIS_TEMPERATURE } from "@/lib/constants";
import { CATEGORY_GUIDANCE, RESEARCH_CATEGORIES, type ResearchCategory } from "@/lib/research-categories";
import {
  INTERVIEW_FRAME_FALLBACK,
  buildInterviewUserPrompt,
} from "@/lib/prompts/interviews";
import { buildInterviewGenSystem, workIdentityFor } from "@/lib/prompts/paradigm-analyst";
import {
  buildRespondentPersona,
  buildSurveyUserPrompt,
  parseSurveyResponse,
  type Respondent,
} from "@/lib/ai/surveys";
import type {
  Artifact,
  Character,
  Interview,
  InterviewAnswer,
  InterviewQuestion,
  InterviewSubjectKind,
  Location,
  NarrativeState,
  Survey,
  SurveyConfig,
  SurveyQuestionType,
} from "@/types/narrative";

// ── Subject resolution ────────────────────────────────────────────────────

export function resolveSubject(
  narrative: NarrativeState,
  subjectId: string,
  subjectKind: InterviewSubjectKind,
): Respondent | null {
  if (subjectKind === "character") {
    const c = narrative.characters[subjectId];
    return c ? { kind: "character", id: subjectId, entity: c } : null;
  }
  if (subjectKind === "location") {
    const l = narrative.locations[subjectId];
    return l ? { kind: "location", id: subjectId, entity: l } : null;
  }
  const a = narrative.artifacts?.[subjectId];
  return a ? { kind: "artifact", id: subjectId, entity: a } : null;
}

// ── Executor ──────────────────────────────────────────────────────────────

const INTERVIEW_CONCURRENCY = 4;

export type InterviewRunCallbacks = {
  onAnswer: (answer: InterviewAnswer) => void;
  onProgress?: (completed: number, total: number) => void;
};

export async function runInterview(
  narrative: NarrativeState,
  interview: Interview,
  cb: InterviewRunCallbacks,
  cancelled: () => boolean,
): Promise<void> {
  const resolved = resolveSubject(narrative, interview.subjectId, interview.subjectKind);
  if (!resolved) throw new Error(`Unknown subject ${interview.subjectKind}/${interview.subjectId}`);
  const subject: Respondent = resolved;

  const total = interview.questions.length;
  let completed = 0;
  cb.onProgress?.(completed, total);
  const personaPrompt = buildRespondentPersona(narrative, subject);

  let cursor = 0;
  let fatal: FatalApiError | null = null;

  async function worker() {
    while (cursor < interview.questions.length && !cancelled() && !fatal) {
      const q = interview.questions[cursor++];
      try {
        // Reuse the survey question-shaping infra so each interview question
        // is still scored / parsed via the shared pathway.
        const userPrompt = buildSurveyUserPrompt(asSurvey(q));
        const raw = await callGenerate(
          userPrompt,
          personaPrompt,
          undefined,
          `interview:${q.questionType}`,
          INTERACTION_MODEL,
          resolveReasoningBudget(narrative),
          true,
          ANALYSIS_TEMPERATURE,
        );
        if (cancelled()) return;
        const parsed = parseSurveyResponse(raw, asSurvey(q), subject);
        cb.onAnswer({
          questionId: q.id,
          answer: parsed.answer,
          reasoning: parsed.reasoning,
          timestamp: Date.now(),
        });
      } catch (err) {
        if (err instanceof FatalApiError) {
          fatal = err;
          return;
        }
        cb.onAnswer({
          questionId: q.id,
          answer: { type: "open", value: "" },
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

  await Promise.all(
    Array.from({ length: Math.min(INTERVIEW_CONCURRENCY, total) }, () => worker()),
  );
  if (fatal) throw fatal;
}

/** Adapt an interview question into the Survey shape the parser/prompt expect. */
function asSurvey(q: InterviewQuestion): Survey {
  return {
    id: q.id,
    question: q.question,
    questionType: q.questionType,
    config: q.config,
    respondentFilter: { kinds: ["character"] },
    responses: {},
    status: "draft",
    createdAt: 0,
    updatedAt: 0,
  };
}

// ── AI question batch generator ───────────────────────────────────────────

function categoryGuidance(category?: string): string {
  if (!category) return INTERVIEW_FRAME_FALLBACK;
  if ((RESEARCH_CATEGORIES as readonly string[]).includes(category)) {
    return CATEGORY_GUIDANCE[category as ResearchCategory];
  }
  // Free-form custom category: let the model interpret the label.
  return `Probe the subject through the lens of "${category}". Pick question types that suit this lens.`;
}

export type InterviewBatch = {
  category: string;
  questions: { question: string; questionType: SurveyQuestionType; config?: SurveyConfig }[];
};

export async function generateInterviewBatch(
  narrative: NarrativeState,
  subject: Respondent,
  resolvedKeys: string[],
  currentIndex: number,
  category?: string,
): Promise<InterviewBatch | null> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);
  const subjectBlock = describeSubject(subject);
  const userPrompt = buildInterviewUserPrompt({
    narrativeContext: ctx,
    subjectBlock,
    category,
    categoryGuidance: category ? categoryGuidance(category) : INTERVIEW_FRAME_FALLBACK,
  });

  const raw = await callGenerate(
    userPrompt,
    buildInterviewGenSystem(workIdentityFor(narrative)),
    undefined,
    `generateInterviewBatch${category ? `:${category}` : ""}`,
    INTERACTION_MODEL,
    resolveReasoningBudget(narrative),
    true,
    ANALYSIS_TEMPERATURE,
  );
  const parsed = parseJson(raw, "generateInterviewBatch") as Record<string, unknown>;
  const respondedCategory = typeof parsed.category === "string" && parsed.category.trim()
    ? parsed.category.trim()
    : (category ?? "Open");
  const rawQs = Array.isArray(parsed.questions) ? (parsed.questions as Record<string, unknown>[]) : [];
  const questions = rawQs.map(coerceQuestion).filter((q): q is InterviewBatch["questions"][number] => q !== null);
  if (questions.length === 0) return null;
  return { category: respondedCategory, questions };
}

const VALID_TYPES: SurveyQuestionType[] = ["binary", "likert", "estimate", "choice", "open"];

/** Exported for tests — shape-checks one proposed interview question. */
export function coerceQuestion(q: Record<string, unknown>): InterviewBatch["questions"][number] | null {
  const question = typeof q.question === "string" ? q.question.trim() : "";
  if (!question) return null;
  const questionType = VALID_TYPES.includes(q.questionType as SurveyQuestionType)
    ? (q.questionType as SurveyQuestionType)
    : "open";
  const config = coerceConfig(questionType, q.config);
  return { question, questionType, ...(config ? { config } : {}) };
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

function describeSubject(s: Respondent): string {
  if (s.kind === "character") {
    const c = s.entity as Character;
    return `${c.name} (character, role: ${c.role})`;
  }
  if (s.kind === "location") {
    const l = s.entity as Location;
    return `${l.name} (location, prominence: ${l.prominence})`;
  }
  const a = s.entity as Artifact;
  return `${a.name} (artifact, significance: ${a.significance})`;
}

