/**
 * Markdown formatters for surveys and interviews. Used by Copy buttons
 * across the research panels — paste straight into a doc / spreadsheet
 * via the system clipboard.
 */

import type {
  Interview,
  InterviewQuestion,
  NarrativeState,
  Survey,
  SurveyResponse,
} from "@/types/narrative";

const SUBJECT_NAME = (n: NarrativeState, kind: SurveyResponse["respondentKind"], id: string): string => {
  if (kind === "character") return n.characters[id]?.name ?? id;
  if (kind === "location") return n.locations[id]?.name ?? id;
  return n.artifacts?.[id]?.name ?? id;
};

function answerValue(r: SurveyResponse, scale = 5, unit?: string): string {
  if (r.error) return "—";
  const a = r.answer;
  if (a.type === "binary") return a.value ? "Yes" : "No";
  if (a.type === "likert") return `${a.value} / ${scale}`;
  if (a.type === "estimate") return `${a.value.toLocaleString()}${unit ? ` ${unit}` : ""}`;
  if (a.type === "choice") return a.value;
  return a.value;
}

export function surveyToMarkdown(survey: Survey, narrative: NarrativeState): string {
  const lines: string[] = [];
  lines.push(`# ${survey.question}`);
  if (survey.category) lines.push(`*Category:* ${survey.category}`);
  lines.push(`*Type:* ${survey.questionType}${survey.questionType === "likert" ? ` (${survey.config?.scale ?? 5}-pt)` : ""}`);
  lines.push(`*Responses:* ${Object.keys(survey.responses).length}`);
  lines.push("");
  lines.push("| Respondent | Kind | Answer | Reasoning |");
  lines.push("|---|---|---|---|");
  const responses = Object.values(survey.responses);
  for (const r of responses) {
    const name = SUBJECT_NAME(narrative, r.respondentKind, r.respondentId);
    const ans = answerValue(r, survey.config?.scale, survey.config?.unit);
    const reason = (r.reasoning || r.error || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${name} | ${r.respondentKind} | ${ans} | ${reason} |`);
  }
  return lines.join("\n");
}

export function interviewToMarkdown(interview: Interview, narrative: NarrativeState): string {
  const lines: string[] = [];
  const subjectName = SUBJECT_NAME(narrative, interview.subjectKind, interview.subjectId);
  const title = interview.title ?? `${subjectName}${interview.category ? ` — ${interview.category}` : ""}`;
  lines.push(`# ${title}`);
  lines.push(`*Subject:* ${subjectName} (${interview.subjectKind})`);
  if (interview.category) lines.push(`*Category:* ${interview.category}`);
  lines.push(`*Questions:* ${interview.questions.length} · *Answered:* ${Object.keys(interview.answers).length}`);
  lines.push("");
  for (const [i, q] of interview.questions.entries()) {
    lines.push(`## Q${i + 1}. ${q.question}`);
    const meta = `*${q.questionType}${q.questionType === "likert" ? ` (${q.config?.scale ?? 5}-pt)` : ""}*`;
    lines.push(meta);
    const answer = interview.answers[q.id];
    if (!answer) {
      lines.push("> *(unanswered)*");
    } else if (answer.error) {
      lines.push(`> **Error:** ${answer.error}`);
    } else {
      lines.push(`> **${answerForInterview(q, answer)}**`);
      if (answer.reasoning) lines.push(`> ${answer.reasoning}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function answerForInterview(q: InterviewQuestion, a: { answer: SurveyResponse["answer"] }): string {
  const v = a.answer;
  if (v.type === "binary") return v.value ? "Yes" : "No";
  if (v.type === "likert") return `${v.value} / ${q.config?.scale ?? 5}`;
  if (v.type === "estimate") return `${v.value.toLocaleString()}${q.config?.unit ? ` ${q.config.unit}` : ""}`;
  if (v.type === "choice") return v.value;
  return v.value;
}

// Re-export for existing callers; the canonical location is `@/lib/utils/clipboard`.
export { copyToClipboard } from "@/lib/utils/clipboard";
