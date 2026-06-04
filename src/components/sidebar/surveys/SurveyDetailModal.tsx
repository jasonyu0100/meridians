"use client";

// SurveyDetailModal — modal displaying a completed survey's aggregated response distribution.

import { useCallback, useMemo, useRef, useState } from "react";
import { Modal, ModalHeader, ModalBody } from "@/components/Modal";
import { useStore } from "@/lib/state/store";
import { runSurvey } from "@/lib/ai/surveys";
import { logError } from "@/lib/core/system-logger";
import { surveyToMarkdown } from "@/lib/io/research-export";
import type { NarrativeState, Survey, SurveyResponse, SurveyRespondentKind } from "@/types/narrative";
import { SurveyResultsView } from "./SurveyResults";
import { CopyButton } from "./CopyButton";

/**
 * Full-screen survey detail. The sidebar shows a stream of cards; this
 * modal is the run+read surface: aggregate visualization at the top,
 * grouped / sorted / filtered respondent cards with full reasoning text,
 * Run / Stop / Re-run / Delete / Copy controls in the header.
 */

type SortMode = "answer" | "name" | "kind";
type GroupMode = "none" | "answer";

export function SurveyDetailModal({
  survey,
  narrative,
  onClose,
  onDelete,
}: {
  survey: Survey;
  narrative: NarrativeState;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const { dispatch } = useStore();
  const cancelledRef = useRef(false);
  const [kindFilter, setKindFilter] = useState<SurveyRespondentKind | "all">("all");
  const [sortMode, setSortMode] = useState<SortMode>("answer");
  const [groupMode, setGroupMode] = useState<GroupMode>(survey.questionType === "binary" || survey.questionType === "choice" ? "answer" : "none");
  const [search, setSearch] = useState("");
  const isRunning = survey.status === "running";

  const start = useCallback(async () => {
    cancelledRef.current = false;
    dispatch({
      type: "UPDATE_SURVEY",
      surveyId: survey.id,
      updates: { status: "running", progress: { completed: 0, total: 0 }, error: undefined, responses: {} },
    });
    try {
      await runSurvey(
        narrative,
        survey,
        {
          onResponse: (response) => dispatch({ type: "SET_SURVEY_RESPONSE", surveyId: survey.id, response }),
          onProgress: (completed, total) =>
            dispatch({ type: "UPDATE_SURVEY", surveyId: survey.id, updates: { progress: { completed, total } } }),
        },
        () => cancelledRef.current,
      );
      if (!cancelledRef.current) {
        dispatch({ type: "UPDATE_SURVEY", surveyId: survey.id, updates: { status: "complete", progress: undefined } });
      }
    } catch (err) {
      logError("Survey halted", err, { source: "other", operation: "survey-run", details: { surveyId: survey.id } });
      dispatch({
        type: "UPDATE_SURVEY",
        surveyId: survey.id,
        updates: { status: "error", error: err instanceof Error ? err.message : String(err), progress: undefined },
      });
    }
  }, [dispatch, narrative, survey]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    dispatch({ type: "UPDATE_SURVEY", surveyId: survey.id, updates: { status: "draft", progress: undefined } });
  }, [dispatch, survey.id]);

  const responseCount = Object.keys(survey.responses).length;

  const enriched = useMemo(() => {
    return Object.values(survey.responses).map((r) => ({
      response: r,
      name:
        r.respondentKind === "character" ? narrative.characters[r.respondentId]?.name :
        r.respondentKind === "location" ? narrative.locations[r.respondentId]?.name :
        narrative.artifacts?.[r.respondentId]?.name,
      role: roleFor(r, narrative),
    }));
  }, [survey.responses, narrative]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return enriched.filter((e) => {
      if (kindFilter !== "all" && e.response.respondentKind !== kindFilter) return false;
      if (term) {
        const hay = `${e.name ?? ""} ${e.response.reasoning}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [enriched, kindFilter, search]);

  const sorted = useMemo(() => {
    const items = [...filtered];
    if (sortMode === "name") {
      items.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    } else if (sortMode === "kind") {
      items.sort((a, b) => a.response.respondentKind.localeCompare(b.response.respondentKind) || (a.name ?? "").localeCompare(b.name ?? ""));
    } else {
      items.sort((a, b) => answerSortKey(b.response) - answerSortKey(a.response));
    }
    return items;
  }, [filtered, sortMode]);

  const grouped = useMemo(() => {
    if (groupMode === "none") return [{ key: "all", label: null, items: sorted }];
    const map = new Map<string, typeof sorted>();
    for (const item of sorted) {
      const key = answerLabel(survey, item.response);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()].map(([key, items]) => ({ key, label: key, items }));
  }, [sorted, groupMode, survey]);

  const total = enriched.length;
  const shown = filtered.length;

  return (
    <Modal onClose={onClose} size="6xl" maxHeight="92vh">
      <ModalHeader onClose={onClose}>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-text-dim/70">
            {survey.category ? `${survey.category} · ` : ""}{survey.questionType}{survey.questionType === "likert" && ` · ${survey.config?.scale ?? 5}-pt`}
          </p>
          <h2 className="text-[14px] font-medium text-text-primary truncate">{survey.question}</h2>
        </div>
        <div className="flex items-center gap-1 text-[10px] shrink-0">
          <span className="text-text-dim tabular-nums mr-2">
            {shown === total ? `${total}` : `${shown} / ${total}`}
          </span>
          {!isRunning ? (
            <button
              onClick={start}
              className="px-2 py-1 rounded bg-emerald-400/15 text-emerald-400 hover:bg-emerald-400/25 transition-colors"
            >
              {responseCount > 0 ? "Re-run" : "Run"}
            </button>
          ) : (
            <button
              onClick={stop}
              className="px-2 py-1 rounded bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 transition-colors"
            >
              Stop
            </button>
          )}
          <CopyButton getText={() => surveyToMarkdown(survey, narrative)} />
          {onDelete && !isRunning && (
            <button
              onClick={onDelete}
              className="px-2 py-1 rounded text-text-dim hover:text-red-400 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </ModalHeader>

      {isRunning && survey.progress && (
        <div className="px-5 py-1.5 border-b border-amber-400/15 bg-amber-400/5 text-[10px] text-amber-400">
          Asking {survey.progress.completed} / {survey.progress.total}…
          <div className="mt-1 h-1 bg-white/5 rounded overflow-hidden">
            <div className="h-full bg-amber-400/50 transition-all" style={{ width: `${survey.progress.total > 0 ? (survey.progress.completed / survey.progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      <ModalBody className="p-0">
        {/* Aggregate */}
        <div className="px-5 pt-4 pb-2">
          <SurveyResultsView survey={survey} narrative={narrative} />
        </div>

        {/* Controls */}
        <div className="sticky top-0 z-10 flex items-center gap-3 px-5 py-2 border-y border-white/8 bg-bg-base/95 backdrop-blur-sm text-[10px]">
          <Segmented
            label="Show"
            value={kindFilter}
            options={[
              { value: "all", label: "All" },
              { value: "character", label: "Characters" },
              { value: "location", label: "Locations" },
              { value: "artifact", label: "Artifacts" },
            ]}
            onChange={(v) => setKindFilter(v as typeof kindFilter)}
          />
          <Segmented
            label="Sort"
            value={sortMode}
            options={[
              { value: "answer", label: "Answer" },
              { value: "name", label: "Name" },
              { value: "kind", label: "Kind" },
            ]}
            onChange={(v) => setSortMode(v as SortMode)}
          />
          <Segmented
            label="Group"
            value={groupMode}
            options={[
              { value: "none", label: "Flat" },
              { value: "answer", label: "By answer" },
            ]}
            onChange={(v) => setGroupMode(v as GroupMode)}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search names + reasoning…"
            className="ml-auto bg-white/5 border border-white/10 rounded text-[10px] text-text-primary px-2 py-1 placeholder:text-text-dim/40 focus:outline-none focus:border-white/20 w-48"
          />
        </div>

        {/* Respondent cards */}
        <div className="px-5 py-3 space-y-4">
          {grouped.map(({ key, label, items }) => (
            <div key={key}>
              {label !== null && (
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-[11px] text-text-secondary font-medium">{label}</span>
                  <span className="text-[10px] text-text-dim/60 tabular-nums">{items.length}</span>
                  <div className="flex-1 h-px bg-white/5" />
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {items.map(({ response, name, role }) => (
                  <RespondentCard key={response.respondentId} survey={survey} response={response} name={name ?? response.respondentId} role={role} />
                ))}
              </div>
              {items.length === 0 && (
                <p className="text-[10px] text-text-dim/60 italic">No respondents in this group.</p>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-[11px] text-text-dim text-center py-8">
              No respondents match the current filter.
            </p>
          )}
        </div>
      </ModalBody>
    </Modal>
  );
}

function RespondentCard({
  survey,
  response,
  name,
  role,
}: {
  survey: Survey;
  response: SurveyResponse;
  name: string;
  role: string | undefined;
}) {
  return (
    <div className="bg-white/3 border border-white/5 rounded-lg p-3 hover:bg-white/[0.04] transition-colors">
      <div className="flex items-baseline gap-2 mb-1.5">
        <KindBadge kind={response.respondentKind} />
        <span className="text-[12px] text-text-primary font-medium truncate">{name}</span>
        {role && <span className="text-[9px] text-text-dim/60 uppercase tracking-wider shrink-0">{role}</span>}
        <span className="ml-auto text-[12px] font-mono text-text-secondary tabular-nums shrink-0">
          {answerDisplay(survey, response)}
        </span>
      </div>
      {response.error ? (
        <p className="text-[10px] text-red-400/80 leading-snug">{response.error}</p>
      ) : (
        <p className="text-[11px] text-text-secondary leading-relaxed">
          {response.reasoning || <span className="text-text-dim/50 italic">No reasoning given.</span>}
        </p>
      )}
      {response.answer.type === "open" && (
        <p className="text-[12px] text-text-primary leading-relaxed mt-1.5 italic border-l-2 border-white/10 pl-2">
          {response.answer.value || <span className="text-text-dim/50 not-italic">(empty)</span>}
        </p>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: SurveyRespondentKind }) {
  const color =
    kind === "character" ? "bg-emerald-400/15 text-emerald-400" :
    kind === "location" ? "bg-cyan-400/15 text-cyan-400" :
    "bg-amber-400/15 text-amber-400";
  const letter = kind[0].toUpperCase();
  return (
    <span className={`text-[9px] font-mono w-4 h-4 inline-flex items-center justify-center rounded ${color}`}>
      {letter}
    </span>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-text-dim/60 uppercase tracking-wider">{label}</span>
      <div className="flex bg-white/5 rounded overflow-hidden">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`px-2 py-0.5 transition-colors ${
              value === o.value ? "bg-white/15 text-text-primary" : "text-text-dim hover:text-text-secondary"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function roleFor(r: SurveyResponse, narrative: NarrativeState): string | undefined {
  if (r.respondentKind === "character") return narrative.characters[r.respondentId]?.role;
  if (r.respondentKind === "location") return narrative.locations[r.respondentId]?.prominence;
  return narrative.artifacts?.[r.respondentId]?.significance;
}

function answerLabel(survey: Survey, r: SurveyResponse): string {
  if (r.error) return "Errored";
  switch (r.answer.type) {
    case "binary": return r.answer.value ? "Yes" : "No";
    case "likert": return `${r.answer.value} / ${survey.config?.scale ?? 5}`;
    case "choice": return r.answer.value;
    case "estimate": return `${r.answer.value.toLocaleString()}${survey.config?.unit ? ` ${survey.config.unit}` : ""}`;
    case "open": return "Responses";
  }
}

function answerDisplay(survey: Survey, r: SurveyResponse): string {
  if (r.error) return "—";
  switch (r.answer.type) {
    case "binary": return r.answer.value ? "Yes" : "No";
    case "likert": return `${r.answer.value} / ${survey.config?.scale ?? 5}`;
    case "estimate": return `${r.answer.value.toLocaleString()}${survey.config?.unit ? ` ${survey.config.unit}` : ""}`;
    case "choice": return r.answer.value;
    case "open": return "·"; // body shows the full text
  }
}

/** Numeric sort key — higher = more agreement / larger value, used for `Sort: Answer`. */
function answerSortKey(r: SurveyResponse): number {
  if (r.error) return -Infinity;
  switch (r.answer.type) {
    case "binary": return r.answer.value ? 1 : 0;
    case "likert": return r.answer.value;
    case "estimate": return r.answer.value;
    case "choice": return 0;
    case "open": return 0;
  }
}
