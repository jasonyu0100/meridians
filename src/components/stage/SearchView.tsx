"use client";
// SearchView — Stage search surface. Three aligned engines share one UI:
//   • vector  — embedding RAG over the proposition bank (fast, similarity-
//     weighted activation timeline). Needs every scene planned + embedded.
//   • expert  — embedding RAG over the curriculum question bank. Matched
//     questions' verified answers ground the synthesis. Needs every scene
//     questioned + embedded. Attributes to topics/questions.
//   • context — narrative-context search reading the full branch (slower, more
//     token-expensive, but works on any branch). The always-available fallback.
// All three answer in academic prose, render the same scene-origin activation
// timeline, and lay out a clickable reference list at the bottom (entity-refs
// for vector/context; topic + question refs for expert).

import {
  synthesizeSearchResults,
  synthesizeExpertSearch,
  synthesizeNarrativeContextSearch,
} from "@/lib/ai/search-synthesis";
import { narrativeContext } from "@/lib/ai/context";
import {
  searchNarrative,
  searchExpert,
  auditSearchAvailability,
} from "@/lib/search/search";
import {
  buildCitationSceneTimeline,
  citedEntityIds,
} from "@/lib/search/citation-attribution";
import {
  resolveEntityRef,
  type EntityRefInfo,
  type EntityRefKind,
} from "@/lib/forces/entity-ref";
import { Markdown } from "@/components/ui/Markdown";
import { useStore } from "@/lib/state/store";
import {
  DEFAULT_STORY_SETTINGS,
  resolveSearchMode,
  type InspectorContext,
  type SearchMode,
} from "@/types/narrative";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

type QueryResponse = {
  question: string;
  answer: string;
  mode: SearchMode;
};

/** One row in the shared reference list — unified across entity-ref modes
 *  (vector/context) and the expert mode's topic/question refs. */
type RefEntry = {
  key: string;
  /** Tailwind bg class for the type-tinted dot. */
  dotClass: string;
  label: string;
  typeLabel: string;
  detail?: string;
  /** Small mono id line under the label. */
  idLabel: string;
  inspector: InspectorContext;
};

const SUGGESTED_QUERIES = [
  "Central tensions and conflicts",
  "Key decisions and turning points",
  "Causal chains between events",
  "Recurring patterns and motifs",
  "Rules, systems, and constraints",
  "Actors, motivations, and stakes",
];

/** Type-tinted dot for the reference list — mirrors the chat EntityRef palette. */
const KIND_DOT: Record<EntityRefKind, string> = {
  character: "bg-sky-400",
  location: "bg-emerald-400",
  artifact: "bg-amber-400",
  thread: "bg-violet-400",
  scene: "bg-rose-400",
  arc: "bg-fuchsia-400",
  knowledge: "bg-teal-400",
  topic: "bg-indigo-400",
  question: "bg-cyan-400",
};

/** The fixed cycle order for the in-bar engine toggle. */
const MODE_CYCLE: SearchMode[] = ["vector", "expert", "context"];
const MODE_LABEL: Record<SearchMode, string> = {
  vector: "Vector",
  expert: "Expert",
  context: "Context",
};

export function SearchView() {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchStage, setSearchStage] = useState<string>("");
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [showDetailTimeline, setShowDetailTimeline] = useState(false);

  // The operator's *selected* engine (persisted on storySettings). Whether it
  // can actually run on this branch is `runnable` below.
  const searchModePref = useMemo<SearchMode>(
    () =>
      resolveSearchMode({
        ...DEFAULT_STORY_SETTINGS,
        ...state.activeNarrative?.storySettings,
      }),
    [state.activeNarrative?.storySettings],
  );

  // Synchronous coverage audit. Drives the toggle's availability colour and the
  // inline coverage warning without paying for a query embedding.
  const audit = useMemo(() => {
    const narrative = state.activeNarrative;
    const keys = state.resolvedEntryKeys;
    if (!narrative || !keys || keys.length === 0) return null;
    return auditSearchAvailability(narrative, keys);
  }, [state.activeNarrative, state.resolvedEntryKeys]);

  const vectorAvailable = !!audit && audit.allScenesPlanned && audit.propositionsReady;
  const expertAvailable =
    !!audit && audit.allScenesHaveQuestions && audit.allQuestionsEmbedded;

  // Is the *selected* engine runnable on this branch? Context always is.
  const runnable =
    searchModePref === "context"
      ? true
      : searchModePref === "vector"
        ? vectorAvailable
        : expertAvailable;

  // Selected an embedding engine but the branch doesn't have full coverage:
  // block the action and show an inline warning (vs. silently retrieving over a
  // partial pool).
  const blocked = !runnable;

  // Load search state from store when narrative changes
  useEffect(() => {
    if (!state.activeNarrative?.id) {
      setQuery("");
      setResponse(null);
      setStreamingAnswer("");
      setErrorMessage(null);
      setIsLoaded(true);
      return;
    }

    const savedSearch = state.viewState.currentSearchQuery;
    if (savedSearch && savedSearch.synthesis) {
      setQuery(savedSearch.query);
      setResponse({
        question: savedSearch.query,
        answer: savedSearch.synthesis.overview,
        mode: savedSearch.mode ?? "vector",
      });
    } else {
      setQuery("");
      setResponse(null);
      setStreamingAnswer("");
      setErrorMessage(null);
    }
    setIsLoaded(true);
  }, [state.activeNarrative?.id, state.viewState.currentSearchQuery]);

  // Listen for clear search event from top bar
  useEffect(() => {
    const handleClear = () => {
      setQuery("");
      setResponse(null);
      setStreamingAnswer("");
      setErrorMessage(null);
      dispatch({ type: "CLEAR_SEARCH" });
    };

    window.addEventListener("search:clear", handleClear);
    return () => window.removeEventListener("search:clear", handleClear);
  }, [dispatch]);

  const setMode = useCallback(
    (next: SearchMode) => {
      const narrative = state.activeNarrative;
      if (!narrative) return;
      dispatch({
        type: "SET_STORY_SETTINGS",
        settings: {
          ...DEFAULT_STORY_SETTINGS,
          ...narrative.storySettings,
          searchMode: next,
          // Keep the legacy boolean in sync for any reader that still consults it.
          vectorSearchEnabled: next === "vector",
        },
      });
    },
    [state.activeNarrative, dispatch],
  );

  // Cycle Vector → Expert → Context → Vector.
  const cycleMode = useCallback(() => {
    const idx = MODE_CYCLE.indexOf(searchModePref);
    setMode(MODE_CYCLE[(idx + 1) % MODE_CYCLE.length]);
  }, [searchModePref, setMode]);

  // Jump to the surface that generates the missing content for the selected
  // engine: plans for vector, questions for expert.
  const goToCoverage = useCallback(() => {
    dispatch({
      type: "SET_GRAPH_VIEW_MODE",
      mode: searchModePref === "expert" ? "learning" : "plan",
    });
  }, [dispatch, searchModePref]);

  // Open the embeddings dashboard (content present but not yet embedded).
  const openEmbeddings = useCallback(() => {
    window.dispatchEvent(new CustomEvent("embeddings:open"));
  }, []);

  // Fall back to context search from the warning (keeps the query flowing).
  const useContextInstead = useCallback(() => setMode("context"), [setMode]);

  const handleQuery = useCallback(
    async (question: string) => {
      const narrative = state.activeNarrative;
      const resolvedKeys = state.resolvedEntryKeys;
      const q = question.trim();

      if (!narrative || !resolvedKeys || q.length === 0) return;

      // Selected engine isn't runnable — the action is already disabled in the
      // UI and the inline warning is showing, so refuse rather than silently
      // falling back to partial coverage.
      if (blocked) return;

      setIsSearching(true);
      setErrorMessage(null);
      setResponse(null);
      setStreamingAnswer("");

      const onToken = (token: string) => {
        setStreamingAnswer((prev) => {
          if (prev.length === 0) setSearchStage("");
          return prev + token;
        });
      };

      try {
        if (searchModePref === "vector") {
          // ── Vector path — proposition RAG ────────────────────────────
          setSearchStage("Embedding query");
          const searchResult = await searchNarrative(narrative, resolvedKeys, q);
          if (
            searchResult.sceneResults.length > 0 ||
            searchResult.detailResults.length > 0
          ) {
            const propCount = searchResult.detailResults.length;
            const sceneCount = searchResult.sceneResults.length;
            setSearchStage(
              `Synthesizing from ${propCount} proposition${propCount === 1 ? "" : "s"} + ${sceneCount} scene summar${sceneCount === 1 ? "y" : "ies"}`,
            );

            const synthesis = await synthesizeSearchResults(
              narrative,
              q,
              searchResult.sceneResults,
              searchResult.detailResults,
              searchResult.topArc,
              searchResult.topScene,
              searchResult.detailTimeline,
              onToken,
            );

            setResponse({ question: q, answer: synthesis.overview, mode: "vector" });
            dispatch({
              type: "SET_SEARCH_QUERY",
              query: { ...searchResult, mode: "vector", synthesis },
            });
          } else {
            setErrorMessage(
              "No relevant content found. Try rephrasing the question.",
            );
          }
        } else if (searchModePref === "expert") {
          // ── Expert path — curriculum question RAG ────────────────────
          setSearchStage("Embedding query");
          const searchResult = await searchExpert(narrative, resolvedKeys, q);
          if (searchResult.detailResults.length > 0) {
            const qCount = searchResult.detailResults.length;
            setSearchStage(
              `Synthesizing from ${qCount} matched question${qCount === 1 ? "" : "s"}`,
            );

            const synthesis = await synthesizeExpertSearch(
              narrative,
              q,
              searchResult.detailResults,
              onToken,
            );

            setResponse({ question: q, answer: synthesis.overview, mode: "expert" });
            dispatch({
              type: "SET_SEARCH_QUERY",
              query: { ...searchResult, mode: "expert", synthesis },
            });
          } else {
            setErrorMessage(
              "No curriculum questions matched. Try rephrasing the question.",
            );
          }
        } else {
          // ── Context path — full-branch read ──────────────────────────
          setSearchStage("Reading narrative context");
          const contextBlock = narrativeContext(
            narrative,
            resolvedKeys,
            resolvedKeys.length - 1,
          );
          const synthesis = await synthesizeNarrativeContextSearch(
            narrative,
            contextBlock,
            q,
            onToken,
          );

          // Derive a scene-origin activation timeline from the entities the
          // answer cited, so context mode shares the timeline UI.
          const sceneTimeline = buildCitationSceneTimeline(
            narrative,
            resolvedKeys,
            synthesis.overview,
          );
          const availability = auditSearchAvailability(narrative, resolvedKeys);

          setResponse({ question: q, answer: synthesis.overview, mode: "context" });
          dispatch({
            type: "SET_SEARCH_QUERY",
            query: {
              query: q,
              mode: "context",
              embedding: [],
              synthesis,
              results: [],
              sceneResults: [],
              detailResults: [],
              sceneTimeline,
              detailTimeline: sceneTimeline.map((p) => ({
                sceneIndex: p.sceneIndex,
                maxSimilarity: 0,
              })),
              topArc: null,
              topScene: null,
              availability,
            },
          });
        }
      } catch {
        setErrorMessage("Query failed. Please try again.");
      } finally {
        setIsSearching(false);
        setSearchStage("");
      }
    },
    [state.activeNarrative, state.resolvedEntryKeys, searchModePref, blocked, dispatch],
  );

  const handleSuggestedQuery = useCallback(
    (suggestedQuery: string) => {
      setQuery(suggestedQuery);
      handleQuery(suggestedQuery);
    },
    [handleQuery],
  );

  const currentSearchQuery = state.viewState.currentSearchQuery;
  const mode = currentSearchQuery?.mode ?? response?.mode ?? "vector";

  // Build the shared reference list from the entity-ref citations the answer
  // actually emitted — so the inline badges and this list are 1:1, in first-
  // appearance order. Uniform across all three engines: vector/context cite
  // database entities; expert cites topics + questions (TOP-/Q- ids), which the
  // entity-ref system resolves the same way.
  const references = useMemo<RefEntry[]>(() => {
    const narrative = state.activeNarrative;
    if (!response || !narrative) return [];
    return citedEntityIds(response.answer, narrative)
      .map((id) => resolveEntityRef(narrative, id))
      .filter((info): info is EntityRefInfo => !!info)
      .map((info) => ({
        key: info.id,
        dotClass: KIND_DOT[info.kind],
        label: info.label,
        typeLabel: info.typeLabel,
        detail: info.detail,
        idLabel: info.id,
        inspector: info.inspector,
      }));
  }, [response, state.activeNarrative]);

  // Expert counts for the reference-list header.
  const refCounts = useMemo(() => {
    let topics = 0;
    let questions = 0;
    for (const r of references) {
      if (r.typeLabel === "Topic") topics += 1;
      else if (r.typeLabel === "Question") questions += 1;
    }
    return { topics, questions };
  }, [references]);

  const effectiveShowDetail = mode === "vector" && showDetailTimeline;
  const hasActivation = mode === "vector" || mode === "expert";

  // Per-mode framing for the toggle, idle hint, and coverage warning. These
  // reflect the *selected* engine (searchModePref) — the result-area badge/
  // timeline use `mode` (the engine that produced the shown answer).
  const modeDot =
    blocked
      ? "bg-amber-400"
      : searchModePref === "vector"
        ? "bg-sky-400"
        : searchModePref === "expert"
          ? "bg-teal-400"
          : "bg-text-dim/40";
  const modeButtonClass = blocked
    ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
    : searchModePref === "vector"
      ? "bg-sky-500/20 text-sky-300 hover:bg-sky-500/30"
      : searchModePref === "expert"
        ? "bg-teal-500/20 text-teal-300 hover:bg-teal-500/30"
        : "bg-bg-elevated text-text-dim hover:text-text-secondary";

  // Idle hint under the bar — describes the *selected* engine.
  const idleHint: Record<SearchMode, string> = {
    vector:
      "Vector · semantic retrieval over scene propositions, with a per-scene activation timeline",
    expert:
      "Expert · answered from the curriculum's verified Q&A, retrieved by question similarity",
    context:
      "Context · reads the whole branch and answers directly — slower, always available",
  };

  // Coverage warning: distinguish "content missing" (→ generate plans/questions)
  // from "content present but unembedded" (→ open the embeddings dashboard), and
  // show the coverage fraction for whichever stage is the bottleneck.
  const needsContent =
    searchModePref === "vector"
      ? !audit?.allScenesPlanned
      : !audit?.allScenesHaveQuestions;
  const coverageLabel = !audit
    ? ""
    : searchModePref === "vector"
      ? needsContent
        ? `${audit.scenesWithPlans}/${audit.totalScenes} planned`
        : `${audit.propositionsWithEmbedding}/${audit.totalPropositions} embedded`
      : needsContent
        ? `${audit.scenesWithQuestions}/${audit.totalScenes} questioned`
        : `${audit.questionsWithEmbedding}/${audit.totalQuestions} embedded`;
  const warningText =
    searchModePref === "vector"
      ? needsContent
        ? "Vector reads scene plans — generate the rest"
        : "Vector needs embedded plans"
      : needsContent
        ? "Expert reads the curriculum — question every scene"
        : "Expert needs embedded questions";

  return (
    <div className="flex flex-col items-center h-full overflow-y-auto">
      {/* Hero Section */}
      <div
        className={`w-full flex flex-col items-center transition-all duration-500 ${response || isSearching ? "pt-8 pb-6" : "pt-32"}`}
      >
        {/* Logo - Only show when no results */}
        {!response && !isSearching && isLoaded && (
          <div className="w-full flex justify-center mb-16">
            <div className="flex items-center gap-4">
              <Image
                src="/logo.svg"
                alt="Meridians"
                width={64}
                height={64}
                className="opacity-70"
              />
              <h1 className="text-3xl uppercase tracking-[0.3em] text-text-secondary font-light">
                Search
              </h1>
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div className="w-full flex justify-center px-8">
          <div className="w-full max-w-2xl">
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isSearching && !blocked) {
                    handleQuery(query);
                  }
                }}
                placeholder="Search this text..."
                className="w-full pl-6 pr-32 py-3.5 bg-bg-field border border-border rounded-full text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-sky-500/50 transition-all shadow-sm"
                disabled={isSearching}
              />
              {/* In-bar engine toggle — minimal, always visible; cycles
                  Vector → Expert → Context. Embedding engines are selectable
                  even when the branch lacks full coverage (they warn + offer a
                  fix instead of being disabled). Amber = selected but not yet
                  runnable. */}
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {isSearching && (
                  <div className="w-4 h-4 border-2 border-sky-500/20 border-t-sky-500 rounded-full animate-spin" />
                )}
                <button
                  onClick={cycleMode}
                  disabled={isSearching}
                  title={
                    blocked
                      ? `${MODE_LABEL[searchModePref]} search selected but not yet runnable on this branch — ${searchModePref === "vector" ? "generate + embed all plans" : "generate + embed all questions"}. Click to cycle engine.`
                      : searchModePref === "vector"
                        ? "Vector search — proposition retrieval. Click to cycle to Expert."
                        : searchModePref === "expert"
                          ? "Expert search — curriculum question retrieval. Click to cycle to Context."
                          : "Context search — reads the full branch. Click to cycle to Vector."
                  }
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${modeButtonClass}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${modeDot}`} />
                  {MODE_LABEL[searchModePref]}
                </button>
              </div>
            </div>

            {/* Stage text + idle mode hint */}
            {isSearching && searchStage ? (
              <div className="mt-2 text-center text-[11px] text-text-dim">
                {searchStage}
              </div>
            ) : (
              !response &&
              !blocked && (
                <div className="mt-2 text-center text-[11px] text-text-dim/50">
                  {idleHint[searchModePref]}
                </div>
              )
            )}

            {/* Coverage warning — inline, non-blocking. The selected embedding
                engine isn't runnable on this branch; the action is disabled
                until the operator generates the missing content / embeds it, or
                switches to context search. */}
            {blocked && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/20 flex items-center gap-2.5 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <span className="flex-1 min-w-0 text-amber-200/80">
                  {warningText}
                  {coverageLabel && (
                    <span className="text-amber-200/50"> · {coverageLabel}</span>
                  )}
                </span>
                {needsContent ? (
                  <button
                    onClick={goToCoverage}
                    className="shrink-0 font-medium text-amber-300 hover:text-amber-200 transition-colors"
                  >
                    {searchModePref === "vector" ? "Plan" : "Questions"}
                  </button>
                ) : (
                  <button
                    onClick={openEmbeddings}
                    className="shrink-0 font-medium text-amber-300 hover:text-amber-200 transition-colors"
                  >
                    Embed
                  </button>
                )}
                <span className="text-text-dim/30">·</span>
                <button
                  onClick={useContextInstead}
                  className="shrink-0 text-text-dim hover:text-text-secondary transition-colors"
                >
                  Use context
                </button>
              </div>
            )}

            {errorMessage && (
              <div className="mt-3 px-4 py-2 bg-rose-500/10 border border-rose-500/20 rounded-lg text-xs text-rose-400 text-center">
                {errorMessage}
              </div>
            )}
          </div>
        </div>

        {/* Suggested Queries - Only show when no results */}
        {!response && !isSearching && !errorMessage && isLoaded && (
          <div className="w-full mt-8">
            <div className="max-w-2xl mx-auto px-8 text-xs text-text-dim mb-3">
              Try searching for:
            </div>
            <div
              className="relative w-full overflow-hidden"
              style={{
                maskImage:
                  "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
                WebkitMaskImage:
                  "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
              }}
            >
              <div className="flex w-max gap-2 animate-marquee-x">
                {[...SUGGESTED_QUERIES, ...SUGGESTED_QUERIES].map((suggested, i) => (
                  <button
                    key={`${suggested}-${i}`}
                    onClick={() => handleSuggestedQuery(suggested)}
                    disabled={blocked}
                    className="shrink-0 px-4 py-2 bg-bg-elevated border border-border rounded-full text-xs text-text-secondary hover:border-sky-500/50 hover:bg-bg-elevated/80 transition-all disabled:opacity-40 disabled:hover:border-border disabled:cursor-not-allowed"
                  >
                    {suggested}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results Section */}
      {(response || streamingAnswer) && (
        <div className="w-full max-w-3xl px-8 pb-16 space-y-8">
          {/* AI Overview */}
          <div className="bg-bg-elevated/50 border-l-2 border-sky-500 pl-6 pr-4 py-5 rounded-r-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-sky-400 font-medium">AI Overview</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-dim/50">
                {mode}
              </div>
            </div>
            <div className="text-sm leading-relaxed text-text-primary">
              {response ? (
                <Markdown text={response.answer} entities />
              ) : (
                <>
                  {streamingAnswer}
                  {streamingAnswer && (
                    <span className="inline-block w-0.5 h-4 ml-1 bg-sky-400 animate-pulse" />
                  )}
                </>
              )}
            </div>
          </div>

          {/* Attribution: activation timeline + reference list */}
          {response && (
            <div>
              {/* Timeline heat curve */}
              {currentSearchQuery &&
                (() => {
                  const timeline = effectiveShowDetail
                    ? currentSearchQuery.detailTimeline
                    : currentSearchQuery.sceneTimeline;

                  if (!timeline || timeline.length === 0) return null;

                  // Only render scenes (filter out world commits)
                  const sceneTimeline = timeline.filter((point) => {
                    const entryId = state.resolvedEntryKeys[point.sceneIndex];
                    return !!state.activeNarrative?.scenes[entryId];
                  });

                  if (sceneTimeline.length === 0) return null;

                  const allSimilarities = sceneTimeline.map((p) =>
                    "similarity" in p ? p.similarity : p.maxSimilarity,
                  );
                  if (allSimilarities.every((s) => s === 0)) return null;
                  const maxSim = Math.max(...allSimilarities);
                  const minSim = Math.min(
                    ...allSimilarities.filter((s) => s > 0),
                  );

                  return (
                    <div className="mb-8">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-xs text-text-dim">
                          {hasActivation
                            ? "Activation Timeline"
                            : "Where this comes from"}
                        </div>
                        {mode === "vector" && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setShowDetailTimeline(false)}
                              className={`text-[10px] px-2 py-1 rounded transition-colors ${
                                !showDetailTimeline
                                  ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                                  : "bg-bg-elevated text-text-dim hover:text-text-secondary border border-border"
                              }`}
                            >
                              Scenes
                            </button>
                            <button
                              onClick={() => setShowDetailTimeline(true)}
                              className={`text-[10px] px-2 py-1 rounded transition-colors ${
                                showDetailTimeline
                                  ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                                  : "bg-bg-elevated text-text-dim hover:text-text-secondary border border-border"
                              }`}
                            >
                              Details
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="relative h-16 group/timeline">
                        <div className="absolute inset-0 bg-bg-elevated/30 rounded-lg border border-border">
                          <div className="absolute inset-0 flex items-end">
                            {sceneTimeline.map((point) => {
                              const similarity =
                                "similarity" in point
                                  ? point.similarity
                                  : point.maxSimilarity;

                              const sceneId =
                                state.resolvedEntryKeys[point.sceneIndex];
                              const scene =
                                state.activeNarrative?.scenes[sceneId];
                              const sceneSummary = scene?.summary || "";

                              const sceneNumber = state.resolvedEntryKeys
                                .slice(0, point.sceneIndex + 1)
                                .filter(
                                  (id) => state.activeNarrative?.scenes[id],
                                ).length;

                              const normalized =
                                maxSim > minSim && similarity > 0
                                  ? (similarity - minSim) / (maxSim - minSim)
                                  : similarity > 0
                                    ? 1
                                    : 0;
                              const amplified = Math.pow(normalized, 2.5);
                              const height =
                                similarity > 0
                                  ? Math.max(3, amplified * 85)
                                  : 0;

                              const isHigh = similarity > 0.7;
                              const isMedium =
                                similarity > 0.4 && similarity <= 0.7;

                              return (
                                <div
                                  key={point.sceneIndex}
                                  className="flex-1 h-full flex items-end justify-center px-px relative group/bar"
                                >
                                  <div
                                    className={`w-full rounded-sm transition-all ${
                                      isHigh
                                        ? "bg-sky-400"
                                        : isMedium
                                          ? "bg-sky-500/70"
                                          : "bg-sky-500/50"
                                    } group-hover/bar:brightness-125`}
                                    style={{ height: `${height}%` }}
                                  />
                                  {similarity > 0 && (
                                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover/bar:opacity-100 pointer-events-none transition-opacity z-50">
                                      <div className="bg-bg-elevated border border-border rounded-lg px-2.5 py-1.5 shadow-xl w-xs">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10px] font-semibold text-text-primary whitespace-nowrap">
                                            Scene {sceneNumber}
                                          </span>
                                          {hasActivation && (
                                            <span
                                              className={`text-[10px] font-medium ${
                                                isHigh
                                                  ? "text-sky-400"
                                                  : isMedium
                                                    ? "text-sky-500"
                                                    : "text-sky-600"
                                              }`}
                                            >
                                              {(similarity * 100).toFixed(0)}%
                                            </span>
                                          )}
                                        </div>
                                        {sceneSummary && (
                                          <div className="text-[9px] text-text-secondary leading-snug mt-1">
                                            {sceneSummary}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

              {/* Reference list — academic attributions. Entity-refs for
                  vector/context; topic + question refs for expert. */}
              {references.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-xs text-text-dim">References</div>
                    <div className="text-xs text-text-dim">
                      {mode === "expert"
                        ? `${refCounts.questions} question${refCounts.questions === 1 ? "" : "s"} · ${refCounts.topics} topic${refCounts.topics === 1 ? "" : "s"}`
                        : `${references.length} entit${references.length === 1 ? "y" : "ies"} cited`}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {references.map((ref, idx) => (
                      <button
                        key={ref.key}
                        onClick={() =>
                          dispatch({ type: "SET_INSPECTOR", context: ref.inspector })
                        }
                        className="w-full flex items-start gap-3 text-left py-2 px-1 hover:bg-white/3 rounded-lg transition-colors group"
                      >
                        <span className="shrink-0 w-6 pt-0.5 text-[11px] font-mono text-text-dim/40 text-right">
                          {idx + 1}
                        </span>
                        <span
                          className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.75 ${ref.dotClass}`}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="text-[13px] text-text-primary group-hover:text-sky-300 transition-colors">
                            {ref.label}
                          </span>
                          <span className="ml-2 text-[9px] uppercase tracking-wider text-text-dim/50 font-mono">
                            {ref.typeLabel}
                          </span>
                          {ref.detail && (
                            <span className="block text-[11px] text-text-secondary/40 leading-snug mt-0.5">
                              {ref.detail}
                            </span>
                          )}
                          <span className="block text-[9px] font-mono text-text-dim/30 mt-0.5">
                            {ref.idLabel}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-text-dim/50 italic">
                  {mode === "expert"
                    ? "No curriculum questions matched this answer."
                    : "No database entities were cited in this answer."}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
