"use client";

import { synthesizeSearchResults } from "@/lib/ai/search-synthesis";
import {
  resolvePlanForBranch,
  resolveProseForBranch,
} from "@/lib/narrative-utils";
import { searchNarrative } from "@/lib/search";
import { useStore } from "@/lib/store";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { usePropositionClassification } from "@/hooks/usePropositionClassification";
import { classificationColor, classificationLabel } from "@/lib/proposition-classify";

type QueryResponse = {
  question: string;
  answer: string;
  citations: Array<{
    id: number;
    sceneId: string;
    beatIndex?: number;
    propIndex?: number;
    content: string;
    similarity: number;
    type: "scene" | "proposition";
  }>;
};

const SUGGESTED_QUERIES = [
  "Central tensions and conflicts",
  "Key decisions and turning points",
  "Causal chains between events",
  "Recurring patterns and motifs",
  "Rules, systems, and constraints",
  "Actors, motivations, and stakes",
];

export function SearchView() {
  const { state, dispatch } = useStore();
  const { getClassification } = usePropositionClassification();
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchStage, setSearchStage] = useState<string>("");
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [showDetailTimeline, setShowDetailTimeline] = useState(false);

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

      // Guaranteed representation: top 5 summaries + top 10 details, then sort by similarity
      const topScenes = savedSearch.sceneResults.slice(0, 5);
      const topDetails = savedSearch.detailResults.slice(0, 10);
      const combined = [...topScenes, ...topDetails]
        .sort((a, b) => b.similarity - a.similarity)
        .map((res, idx) => ({
          id: idx + 1,
          sceneId: res.sceneId,
          beatIndex: res.beatIndex,
          propIndex: res.propIndex,
          content:
            res.content.length > 200
              ? res.content.substring(0, 197) + "..."
              : res.content,
          similarity: res.similarity,
          type: res.type,
        }));

      setResponse({
        question: savedSearch.query,
        answer: savedSearch.synthesis.overview,
        citations: combined,
      });
    } else {
      // Clear local state if no saved search
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

  const handleQuery = useCallback(
    async (question: string) => {
      const narrative = state.activeNarrative;
      const resolvedKeys = state.resolvedEntryKeys;

      if (!narrative || !resolvedKeys || question.trim().length === 0) return;

      setIsSearching(true);
      // Stage 1 — embed the query string via the embedding API.
      setSearchStage("Embedding query");
      setErrorMessage(null);
      setResponse(null);
      setStreamingAnswer("");

      try {
        // Stage 2 — rank both pools (propositions primary, scene
        // summaries supplementary) against the query embedding.
        setSearchStage("Ranking propositions and scene summaries");
        const result = await searchNarrative(
          narrative,
          resolvedKeys,
          question.trim(),
        );

        // Availability gate — vector search is proposition-first. Without
        // a proposition bank (plans generated and embedded) search cannot
        // run; surface a targeted prompt to generate the missing artefacts.
        const availability = result.availability;
        if (availability && !availability.propositionsReady) {
          const hasPlans = availability.scenesWithPlans > 0;
          const hasSummaryEmbeds = availability.summaryEmbeddingsReady;
          const parts: string[] = ["Search needs a proposition bank to run."];
          if (!hasPlans) {
            parts.push(
              `None of your ${availability.totalScenes} scene${availability.totalScenes === 1 ? "" : "s"} has a plan yet — generate scene plans to populate propositions.`,
            );
          } else if (availability.totalPropositions === 0) {
            parts.push(
              `${availability.scenesWithPlans} scene${availability.scenesWithPlans === 1 ? " has" : "s have"} plans, but no propositions have been extracted. Re-generate plans with propositions enabled.`,
            );
          } else {
            parts.push(
              `${availability.totalPropositions} proposition${availability.totalPropositions === 1 ? "" : "s"} extracted, but none are embedded yet. Run the embedding step to enable search.`,
            );
          }
          if (!hasSummaryEmbeds) {
            parts.push(
              "Scene summary embeddings are also missing — generate embeddings for richer thematic context.",
            );
          }
          setErrorMessage(parts.join(" "));
          return;
        }

        if (result.sceneResults.length > 0 || result.detailResults.length > 0) {
          // Stage 3 — build synthesis prompt from the top matches and
          // wait for the first streamed token.
          const propCount = result.detailResults.length;
          const sceneCount = result.sceneResults.length;
          setSearchStage(
            `Synthesizing answer from ${propCount} proposition${propCount === 1 ? "" : "s"} + ${sceneCount} scene summar${sceneCount === 1 ? "y" : "ies"}`,
          );

          const synthesis = await synthesizeSearchResults(
            narrative,
            question.trim(),
            result.sceneResults,
            result.detailResults,
            result.topArc,
            result.topScene,
            result.detailTimeline,
            (token) => {
              // Update immediately for responsive streaming
              setStreamingAnswer((prev) => {
                if (prev.length === 0) {
                  // First token received, we're streaming now
                  setSearchStage("");
                }
                return prev + token;
              });
            },
          );

          // Flat citation list — whatever the search returned, sorted by
          // similarity. search.ts already caps the pools at SEARCH_TOP_K_*.
          const combined = [...result.sceneResults, ...result.detailResults]
            .sort((a, b) => b.similarity - a.similarity)
            .map((res, idx) => ({
              id: idx + 1,
              sceneId: res.sceneId,
              beatIndex: res.beatIndex,
              propIndex: res.propIndex,
              content:
                res.content.length > 200
                  ? res.content.substring(0, 197) + "..."
                  : res.content,
              similarity: res.similarity,
              type: res.type,
            }));

          const responseData = {
            question: question.trim(),
            answer: synthesis.overview,
            citations: combined,
          };
          setResponse(responseData);

          // Save search state to store
          dispatch({
            type: "SET_SEARCH_QUERY",
            query: {
              query: question.trim(),
              embedding: result.embedding,
              synthesis,
              results: result.results,
              sceneResults: result.sceneResults,
              detailResults: result.detailResults,
              sceneTimeline: result.sceneTimeline,
              detailTimeline: result.detailTimeline,
              topArc: result.topArc,
              topScene: result.topScene,
              availability: result.availability,
            },
          });
        } else {
          // Propositions exist but nothing matched the query. If summary
          // embeddings are also missing, generating them would broaden
          // thematic coverage; otherwise it's genuinely a low-match query.
          const missingSummaries =
            availability && !availability.summaryEmbeddingsReady;
          setErrorMessage(
            missingSummaries
              ? "No matches found. Scene summary embeddings are not generated yet — generating them would broaden thematic coverage. Otherwise, try rephrasing the query."
              : "No relevant content found. Try rephrasing the question.",
          );
        }
      } catch (err) {
        setErrorMessage("Query failed. Please try again.");
      } finally {
        setIsSearching(false);
        setSearchStage("");
      }
    },
    [state.activeNarrative, state.resolvedEntryKeys, dispatch],
  );

  const getSceneInfo = useCallback(
    (sceneId: string, beatIndex?: number) => {
      const narrative = state.activeNarrative;
      if (!narrative || !state.viewState.activeBranchId) return null;

      const scene = narrative.scenes[sceneId];
      if (!scene) return null;

      const proseData = resolveProseForBranch(
        scene,
        state.viewState.activeBranchId,
        narrative.branches,
      );
      const planData = resolvePlanForBranch(
        scene,
        state.viewState.activeBranchId,
        narrative.branches,
      );

      let beatProse: string | null = null;
      if (beatIndex !== undefined && proseData?.beatProseMap) {
        const beatChunk = proseData.beatProseMap.chunks.find(
          (c) => c.beatIndex === beatIndex,
        );
        beatProse = beatChunk?.prose || null;
      }

      // Get arc index (1-based)
      const arc = scene.arcId ? narrative.arcs[scene.arcId] : null;
      const arcIndex = arc
        ? Object.keys(narrative.arcs).indexOf(scene.arcId!) + 1
        : null;

      // Get scene index (1-based) - count only scenes, not world commits
      const entryPosition = state.resolvedEntryKeys.indexOf(sceneId);
      const sceneIndex = entryPosition >= 0
        ? state.resolvedEntryKeys
            .slice(0, entryPosition + 1)
            .filter((id) => narrative.scenes[id]).length
        : null;

      return {
        scene,
        prose: proseData?.prose || null,
        beatProse,
        plan: planData?.beats || null,
        arc,
        arcIndex,
        sceneIndex,
      };
    },
    [state.activeNarrative, state.viewState.activeBranchId, state.resolvedEntryKeys],
  );

  const navigateToCitation = useCallback(
    (citation: QueryResponse["citations"][0]) => {
      const sceneIndex = state.resolvedEntryKeys.indexOf(citation.sceneId);
      if (sceneIndex < 0) return;

      const sceneInfo = getSceneInfo(citation.sceneId, citation.beatIndex);
      const hasProse = sceneInfo?.prose || sceneInfo?.beatProse;

      // Step 1: Set scene index
      dispatch({ type: "SET_SCENE_INDEX", index: sceneIndex });

      if (hasProse) {
        // Step 2: Switch to prose view
        dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "prose" });

        // Step 3: Toggle beat plan side-by-side after view mode changes
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("canvas:toggle-beat-plan", {
              detail: { enabled: true },
            }),
          );

          // Step 4: Scroll to beat after side-by-side view is enabled
          if (citation.beatIndex !== undefined) {
            setTimeout(() => {
              window.dispatchEvent(
                new CustomEvent("prose:scroll-to-beat", {
                  detail: {
                    beatIndex: citation.beatIndex,
                    propIndex: citation.propIndex,
                  },
                }),
              );
            }, 200);
          }
        }, 100);
      } else {
        // Fallback to plan view if no prose available
        dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "plan" });

        if (citation.beatIndex !== undefined) {
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("plan:scroll-to-beat", {
                detail: { beatIndex: citation.beatIndex },
              }),
            );
          }, 200);
        }
      }
    },
    [state.resolvedEntryKeys, dispatch, getSceneInfo],
  );

  const handleSuggestedQuery = useCallback(
    (suggestedQuery: string) => {
      setQuery(suggestedQuery);
      handleQuery(suggestedQuery);
    },
    [handleQuery],
  );

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
                alt="InkTide"
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
                  if (e.key === "Enter" && !isSearching) {
                    handleQuery(query);
                  }
                }}
                placeholder="Search this text..."
                className="w-full px-6 py-3.5 bg-bg-elevated border border-border rounded-full text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-sky-500/50 transition-all shadow-sm"
                disabled={isSearching}
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {isSearching && searchStage && (
                  <span className="text-xs text-text-dim mr-2">
                    {searchStage}
                  </span>
                )}
                {isSearching && (
                  <div className="w-4 h-4 border-2 border-sky-500/20 border-t-sky-500 rounded-full animate-spin" />
                )}
              </div>
            </div>

            {errorMessage && (
              <div className="mt-3 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400 text-center">
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
                    className="shrink-0 px-4 py-2 bg-bg-elevated border border-border rounded-full text-xs text-text-secondary hover:border-sky-500/50 hover:bg-bg-elevated/80 transition-all"
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
            <div className="text-xs text-sky-400 mb-3 font-medium">
              AI Overview
            </div>
            <div className="text-sm leading-relaxed text-text-primary">
              {response ? response.answer : streamingAnswer}
              {!response && streamingAnswer && (
                <span className="inline-block w-0.5 h-4 ml-1 bg-sky-400 animate-pulse" />
              )}
            </div>
          </div>

          {/* Search Results */}
          {response && response.citations.length > 0 && (
            <div>
              {/* Timeline heat curve */}
              {state.viewState.currentSearchQuery &&
                (() => {
                  const timeline = showDetailTimeline
                    ? state.viewState.currentSearchQuery.detailTimeline
                    : state.viewState.currentSearchQuery.sceneTimeline;

                  if (!timeline || timeline.length === 0) return null;

                  // Filter out world commits for visualization (only render scenes)
                  const sceneTimeline = timeline.filter((point) => {
                    const entryId = state.resolvedEntryKeys[point.sceneIndex];
                    return !!state.activeNarrative?.scenes[entryId];
                  });

                  if (sceneTimeline.length === 0) return null;

                  return (
                    <div className="mb-8">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-xs text-text-dim">
                          Activation Timeline
                        </div>
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
                      </div>

                      {/* Heat curve visualization */}
                      <div className="relative h-16 group/timeline">
                        <div className="absolute inset-0 bg-bg-elevated/30 rounded-lg border border-border">
                          <div className="absolute inset-0 flex items-end">
                            {sceneTimeline.map((point) => {
                              const similarity =
                                "similarity" in point
                                  ? point.similarity
                                  : point.maxSimilarity;

                              // Get scene info for tooltip
                              const sceneId =
                                state.resolvedEntryKeys[point.sceneIndex];
                              const scene =
                                state.activeNarrative?.scenes[sceneId];
                              const sceneSummary = scene?.summary || "";

                              // Get actual scene number (count only scenes up to this point in resolvedKeys)
                              const sceneNumber = state.resolvedEntryKeys
                                .slice(0, point.sceneIndex + 1)
                                .filter(
                                  (id) => state.activeNarrative?.scenes[id],
                                ).length;

                              // Find min/max for normalization (amplify differences)
                              const allSimilarities = sceneTimeline.map((p) =>
                                "similarity" in p
                                  ? p.similarity
                                  : p.maxSimilarity,
                              );
                              const maxSim = Math.max(...allSimilarities);
                              const minSim = Math.min(
                                ...allSimilarities.filter((s) => s > 0),
                              );

                              // Normalize to 0-1 range within actual data range
                              const normalized =
                                maxSim > minSim && similarity > 0
                                  ? (similarity - minSim) / (maxSim - minSim)
                                  : similarity > 0
                                    ? 1
                                    : 0;

                              // Apply exponential scaling (power of 2.5 amplifies differences dramatically)
                              const amplified = Math.pow(normalized, 2.5);

                              // Convert to percentage height (scale to 85% max to leave room at top)
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
                                  {/* Enhanced hover tooltip */}
                                  {similarity > 0 && (
                                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover/bar:opacity-100 pointer-events-none transition-opacity z-50">
                                      <div className="bg-bg-elevated border border-border rounded-lg px-2.5 py-1.5 shadow-xl w-xs">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10px] font-semibold text-text-primary whitespace-nowrap">
                                            Scene {sceneNumber}
                                          </span>
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

              {/* Result count */}
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs text-text-dim">
                  {response.citations.length} result
                  {response.citations.length !== 1 ? "s" : ""}
                </div>
              </div>

              <div className="space-y-3">
                {response.citations.map((cit) => {
                  const sceneInfo = getSceneInfo(cit.sceneId, cit.beatIndex);
                  const beatPlan = sceneInfo?.plan?.[cit.beatIndex ?? 0];
                  const cls = (cit.type === "proposition" && cit.propIndex != null && cit.beatIndex != null)
                    ? getClassification(cit.sceneId, cit.beatIndex, cit.propIndex)
                    : null;
                  const profileColor = cls ? classificationColor(cls.base, cls.reach) : undefined;

                  // Source type label
                  const sourceType = cit.type === 'proposition' ? 'proposition' : 'scene';

                  // Build structured source path
                  const pathParts: string[] = [];
                  if (sceneInfo?.arcIndex) pathParts.push(`Arc ${sceneInfo.arcIndex}`);
                  if (sceneInfo?.sceneIndex) pathParts.push(`Scene ${sceneInfo.sceneIndex}`);
                  if (cit.type !== 'scene' && cit.beatIndex != null) pathParts.push(`Beat ${cit.beatIndex + 1}`);
                  if (cit.type === 'proposition' && cit.propIndex != null) pathParts.push(`Prop ${cit.propIndex + 1}`);

                  return (
                    <div
                      key={cit.id}
                      className="group cursor-pointer"
                      onClick={() => navigateToCitation(cit)}
                    >
                      <div className="flex gap-4 py-4 px-1 hover:bg-white/3 rounded-lg transition-colors">
                        {/* Number column */}
                        <div className="shrink-0 w-8 pt-0.5">
                          <div className="text-[11px] font-mono text-text-dim/40 text-right">
                            {cit.id}
                          </div>
                        </div>

                        {/* Content column */}
                        <div className="flex-1 min-w-0">
                          {/* Content */}
                          <div
                            className="text-[13px] text-text-primary leading-relaxed group-hover:text-sky-300 transition-colors"
                            style={profileColor ? { borderLeft: `2px solid ${profileColor}`, paddingLeft: '10px' } : undefined}
                          >
                            {cit.content}
                          </div>

                          {/* Prose excerpt */}
                          {sceneInfo?.beatProse && (
                            <div
                              className="mt-1.5 text-[11px] text-text-secondary/30 leading-relaxed line-clamp-2 italic"
                              style={profileColor ? { paddingLeft: '12px' } : undefined}
                            >
                              {sceneInfo.beatProse}
                            </div>
                          )}

                          {/* Bottom metadata row */}
                          <div className="flex items-center gap-3 mt-2.5 text-[9px]">
                            {/* Source type badge */}
                            <span className={`px-1.5 py-0.5 rounded font-mono uppercase tracking-wider ${
                              sourceType === 'proposition' ? 'bg-white/8 text-text-dim/70' : 'bg-white/4 text-text-dim/40'
                            }`}>
                              {sourceType}
                            </span>

                            {/* Classification label */}
                            {cls && (
                              <span className="font-medium" style={{ color: profileColor }}>
                                {classificationLabel(cls.base, cls.reach)}
                              </span>
                            )}

                            {/* Beat function */}
                            {beatPlan && (
                              <span className="text-text-dim/40">{beatPlan.fn}</span>
                            )}

                            {/* Similarity */}
                            <span className="font-mono text-sky-500/60">
                              {(cit.similarity * 100).toFixed(0)}%
                            </span>

                            {/* Spacer */}
                            <span className="flex-1" />

                            {/* Source path */}
                            <span className="text-text-dim/30 font-mono">
                              {pathParts.join(' › ')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
