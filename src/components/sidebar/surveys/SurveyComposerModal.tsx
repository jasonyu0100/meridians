"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Modal, ModalHeader, ModalBody } from "@/components/Modal";
import { useStore } from "@/lib/store";
import { generateSurveyProposal, resolveRespondents, toggleRespondentTier } from "@/lib/ai/surveys";
import { logError } from "@/lib/system-logger";
import type {
  CharacterRole,
  Survey,
  SurveyQuestionType,
  SurveyRespondentFilter,
  SurveyRespondentKind,
} from "@/types/narrative";
import { CategoryPicker } from "./CategoryPicker";

/**
 * Survey setup modal — mirrors the Interview composer's two-column shape:
 * a left setup rail (scope / lens / shape) and a right working surface
 * (question + intent). Gives the question genuine room and keeps all
 * controls visible without a label-heavy chip wall.
 */

const TYPE_OPTIONS: { value: SurveyQuestionType; label: string; hint: string }[] = [
  { value: "binary", label: "Yes / No", hint: "Clean split across the cast" },
  { value: "likert", label: "Scale", hint: "Graduated agreement" },
  { value: "estimate", label: "Estimate", hint: "Numeric guess; reveals knowledge gaps" },
  { value: "choice", label: "Choice", hint: "Forced rank between named options" },
  { value: "open", label: "Open", hint: "Short free-text response" },
];

const ALL_KINDS: SurveyRespondentFilter = {
  kinds: ["character", "location", "artifact"],
};

const CHARACTERS_ONLY: SurveyRespondentFilter = {
  kinds: ["character"],
};

export function SurveyComposerModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (survey: Survey) => void;
}) {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState("");
  const [questionType, setQuestionType] = useState<SurveyQuestionType>("binary");
  const [scale, setScale] = useState<3 | 5 | 7>(5);
  const [unit, setUnit] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [filter, setFilter] = useState<SurveyRespondentFilter>(CHARACTERS_ONLY);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [intent, setIntent] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const choiceCount = optionsText.split(",").filter((s) => s.trim()).length;
  const canSubmit =
    question.trim().length > 0 &&
    filter.kinds.length > 0 &&
    !(questionType === "choice" && choiceCount < 2);

  const respondents = useMemo(
    () => (narrative ? resolveRespondents(narrative, filter) : []),
    [narrative, filter],
  );

  const submit = () => {
    if (!narrative || !canSubmit) return;
    const survey: Survey = {
      id: `survey-${Date.now()}`,
      question: question.trim(),
      questionType,
      config:
        questionType === "likert" ? { scale } :
        questionType === "estimate" ? { unit: unit.trim() || undefined } :
        questionType === "choice" ? { options: optionsText.split(",").map((s) => s.trim()).filter(Boolean) } :
        undefined,
      respondentFilter: filter,
      responses: {},
      status: "draft",
      category: category.trim() || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    onCreate(survey);
  };

  const suggest = useCallback(async () => {
    if (!narrative) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const proposal = await generateSurveyProposal(
        narrative,
        state.resolvedEntryKeys,
        state.viewState.currentSceneIndex,
        category || undefined,
      );
      if (!proposal) {
        setSuggestError("No proposal returned.");
        return;
      }
      setQuestion(proposal.question);
      setQuestionType(proposal.questionType);
      if (proposal.config?.scale) setScale(proposal.config.scale);
      if (proposal.config?.unit !== undefined) setUnit(proposal.config.unit);
      if (proposal.config?.options) setOptionsText(proposal.config.options.join(", "));
      if (proposal.suggestedFilter) setFilter(proposal.suggestedFilter);
      setIntent(proposal.intent || null);
      textareaRef.current?.focus();
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : String(err));
      logError("Survey proposal failed", err, {
        source: "other",
        operation: "survey-proposal",
        details: { narrativeId: narrative.id },
      });
    } finally {
      setSuggesting(false);
    }
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex, category]);

  return (
    <Modal onClose={onClose} size="4xl" maxHeight="88vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-[14px] font-medium text-text-primary">New survey</h2>
          <p className="text-[10px] text-text-dim/70">
            One question across every applicable entity in the world.
          </p>
        </div>
      </ModalHeader>
      <ModalBody className="p-0 overflow-hidden flex flex-col">
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] flex-1 min-h-0">
          {/* Left rail — setup */}
          <div className="border-r border-white/8 p-4 space-y-4 overflow-y-auto">
            <Section label="Scope" hint="Who gets asked. Suggest can pick a scope; you can edit.">
              <ScopeEditor filter={filter} onChange={setFilter} />
              <p className="text-[10px] text-text-dim/70 tabular-nums">
                {respondents.length === 0 ? (
                  <span className="text-red-400/80">No respondents match this scope.</span>
                ) : (
                  <>
                    Would ask <span className="text-amber-400 font-semibold">{respondents.length}</span>{" "}
                    {respondents.length === 1 ? "entity" : "entities"}.
                  </>
                )}
              </p>
            </Section>

            <Section label="Lens" hint="Optional theme. Suggest will tilt toward it.">
              <CategoryPicker value={category} onChange={setCategory} />
            </Section>

            <Section label="Shape" hint="Kind of answer the cast will give.">
              <div className="flex flex-wrap gap-1">
                {TYPE_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setQuestionType(t.value)}
                    title={t.hint}
                    className={`text-[10px] px-2 py-1 rounded transition-colors ${
                      questionType === t.value
                        ? "bg-white/15 text-text-primary"
                        : "bg-white/5 text-text-dim hover:text-text-secondary"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {questionType === "likert" && (
                <div className="flex items-center gap-1 text-[10px] text-text-dim">
                  {([3, 5, 7] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setScale(s)}
                      className={`px-2 py-0.5 rounded ${scale === s ? "bg-white/15 text-text-primary" : "bg-white/5 hover:text-text-secondary"}`}
                    >
                      {s}-pt
                    </button>
                  ))}
                </div>
              )}
              {questionType === "estimate" && (
                <input
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="Unit (optional)"
                  className="w-full bg-white/5 border border-white/10 rounded text-[11px] text-text-primary px-2 py-1.5 placeholder:text-text-dim/40 focus:outline-none focus:border-white/20"
                />
              )}
              {questionType === "choice" && (
                <input
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  placeholder="Comma-separated options"
                  className="w-full bg-white/5 border border-white/10 rounded text-[11px] text-text-primary px-2 py-1.5 placeholder:text-text-dim/40 focus:outline-none focus:border-white/20"
                />
              )}
            </Section>
          </div>

          {/* Right rail — question surface */}
          <div className="flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-4">
              <textarea
                ref={textareaRef}
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  if (intent) setIntent(null);
                }}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={8}
                placeholder="Ask the whole world a question…"
                className="w-full h-full min-h-40 bg-white/3 border border-white/5 rounded-lg text-[13px] text-text-primary px-3 py-2.5 placeholder:text-text-dim/40 focus:outline-none focus:border-white/15 resize-none"
              />
              {intent && (
                <p className="text-[10px] text-amber-400/90 italic mt-2 leading-snug">
                  <span className="not-italic font-semibold mr-1">Why:</span>{intent}
                </p>
              )}
              {suggestError && (
                <p className="text-[10px] text-red-400 mt-2">{suggestError}</p>
              )}
            </div>
          </div>
        </div>
      </ModalBody>

      <div className="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-white/8 bg-bg-base/50">
        <span className="text-[10px] text-text-dim">⌘ + Enter to send</span>
        <div className="flex-1" />
        <button
          onClick={suggest}
          disabled={suggesting}
          title={category ? `Propose a ${category} question` : "Let the engine propose a question"}
          className="text-[11px] px-3 py-1.5 rounded bg-amber-400/15 hover:bg-amber-400/25 text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {suggesting ? "Thinking…" : `Suggest${category ? ` · ${category}` : ""}`}
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="text-[11px] px-4 py-1.5 rounded bg-white/10 hover:bg-white/15 text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
    </Modal>
  );
}

// ── Shared section header ────────────────────────────────────────────────

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-text-dim/70 font-mono">{label}</h3>
        {hint && <p className="text-[10px] text-text-dim/50 leading-snug mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

// ── Scope editor ─────────────────────────────────────────────────────────
// Compact 3-row layout: each kind is a toggle, with its tier filters inline
// to its right. Tier chips grey out when their kind is off.

type TierKey = "characterRoles" | "locationProminence" | "artifactSignificance";

const KIND_TIERS: { kind: SurveyRespondentKind; label: string; tiers: readonly string[]; key: TierKey }[] = [
  { kind: "character", label: "Characters", tiers: ["anchor", "recurring", "transient"], key: "characterRoles" },
  { kind: "location",  label: "Locations",  tiers: ["domain", "place", "margin"],        key: "locationProminence" },
  { kind: "artifact",  label: "Artifacts",  tiers: ["key", "notable", "minor"],          key: "artifactSignificance" },
];

function ScopeEditor({
  filter,
  onChange,
}: {
  filter: SurveyRespondentFilter;
  onChange: (next: SurveyRespondentFilter) => void;
}) {
  const toggleKind = (k: SurveyRespondentKind) => {
    const has = filter.kinds.includes(k);
    onChange({ ...filter, kinds: has ? filter.kinds.filter((x) => x !== k) : [...filter.kinds, k] });
  };
  const toggleTier = (
    key: "characterRoles" | "locationProminence" | "artifactSignificance",
    tier: string,
    allTiers: readonly string[],
  ) => {
    onChange(toggleRespondentTier(filter, key, tier, allTiers));
  };

  return (
    <div className="space-y-1">
      {KIND_TIERS.map(({ kind, label, tiers, key }) => {
        const kindActive = filter.kinds.includes(kind);
        const tierList = (filter[key] as string[] | undefined) ?? null;
        return (
          <div key={kind} className="flex items-center gap-1 flex-wrap text-[10px]">
            <button
              onClick={() => toggleKind(kind)}
              className={`px-2 py-0.5 rounded font-medium transition-colors w-18.5 text-left ${
                kindActive
                  ? "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25"
                  : "bg-white/3 text-text-dim/60 hover:text-text-secondary"
              }`}
            >
              {label}
            </button>
            {tiers.map((t) => {
              const included = tierList === null || tierList.includes(t);
              const dim = !kindActive;
              return (
                <button
                  key={t}
                  onClick={() => kindActive && toggleTier(key, t, tiers)}
                  disabled={!kindActive}
                  className={`px-1.5 py-0.5 rounded capitalize transition-colors ${
                    dim
                      ? "text-text-dim/30 cursor-not-allowed"
                      : included
                      ? "bg-amber-400/10 text-amber-400/90 hover:bg-amber-400/20"
                      : "text-text-dim/50 hover:text-text-secondary"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        );
      })}
      <div className="flex items-center gap-2 text-[10px] text-text-dim/60 pt-1">
        <button
          onClick={() => onChange(ALL_KINDS)}
          className="hover:text-text-secondary transition-colors"
        >
          All
        </button>
        <span>·</span>
        <button
          onClick={() => onChange({ kinds: ["character"] })}
          className="hover:text-text-secondary transition-colors"
        >
          Characters only
        </button>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _UnusedRoleHint = CharacterRole; // retained for type parity with SurveyRespondentFilter
