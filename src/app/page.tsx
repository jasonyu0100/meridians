"use client";

import { StoryCard } from "@/components/cards/StoryCard";
import { StarField } from "@/components/effects/StarField";
import ApiKeyModal from "@/components/topbar/ApiKeyModal";
import { CreationWizard } from "@/components/wizard/CreationWizard";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import {
  ANALYSIS_NARRATIVE_IDS,
  PLAYGROUND_NARRATIVE_IDS,
  useStore,
} from "@/lib/store";
import { useWizard } from "@/lib/wizard-context";
import type { NarrativeEntry } from "@/types/narrative";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return isMobile;
}

/* ── Morph text — letters shift through similar glyphs ────────────────────── */
const MORPH_GLYPHS: Record<string, string[]> = {
  a: ["à", "á", "â", "ä", "ã", "å", "ā", "ą"],
  b: ["ƀ", "ḃ", "ḅ", "ɓ", "ƃ"],
  e: ["ë", "ē", "ę", "ė", "ě", "è", "é"],
  h: ["ħ", "ḥ", "ȟ", "ḫ"],
  i: ["ï", "ī", "į", "ĭ", "ì", "í"],
  k: ["ķ", "ƙ", "ḳ", "ǩ"],
  l: ["ł", "ĺ", "ḷ", "ℓ", "ḻ"],
  n: ["ñ", "ń", "ņ", "ň", "ṅ"],
  o: ["ö", "ø", "ō", "ő", "ȯ", "ò", "ó"],
  r: ["ŕ", "ř", "ṙ", "ṛ", "ɍ"],
  t: ["ţ", "ť", "ț", "ƭ", "ṭ"],
  v: ["ν", "ʋ", "ᵥ", "ṽ"],
};

function MorphText({ text }: { text: string }) {
  const [chars, setChars] = useState(() => text.split(""));

  useEffect(() => {
    const original = text.split("");
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    // Each morphable letter runs its own independent loop
    original.forEach((ch, i) => {
      const glyphs = MORPH_GLYPHS[ch.toLowerCase()];
      if (!glyphs) return;

      function loop() {
        // Rapid burst: cycle through 2-4 glyphs before settling
        const burstLen = 2 + Math.floor(Math.random() * 3);
        let step = 0;

        function tick() {
          if (step < burstLen) {
            const g = glyphs[Math.floor(Math.random() * glyphs.length)];
            setChars((prev) => {
              const next = [...prev];
              next[i] = g;
              return next;
            });
            step++;
            timeouts.push(setTimeout(tick, 60 + Math.random() * 40));
          } else {
            // Settle back to original
            setChars((prev) => {
              const next = [...prev];
              next[i] = original[i];
              return next;
            });
            // Wait before next burst — staggered per letter
            timeouts.push(setTimeout(loop, 1200 + Math.random() * 3000));
          }
        }

        // Staggered start per letter
        timeouts.push(setTimeout(tick, 1500 + i * 400 + Math.random() * 1000));
      }

      loop();
    });

    return () => timeouts.forEach(clearTimeout);
  }, [text]);

  return (
    <span className="relative inline-block">
      {/* Invisible original text holds the width */}
      <span className="invisible">{text}</span>
      {/* Morphing overlay */}
      <span className="absolute inset-0">
        {chars.map((ch, i) => {
          const isOriginal = ch === text[i];
          return (
            <span
              key={i}
              style={{
                transition: "opacity 80ms, filter 80ms",
                opacity: isOriginal ? 1 : 0.6,
                filter: isOriginal ? "none" : "blur(0.6px)",
              }}
            >
              {ch}
            </span>
          );
        })}
      </span>
    </span>
  );
}

/* ── Animated thread SVG that draws on mount ─────────────────────────────── */
function ThreadLine() {
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    requestAnimationFrame(() => {
      path.style.transition = "stroke-dashoffset 2s ease-out";
      path.style.strokeDashoffset = "0";
    });
  }, []);

  return (
    <svg
      className="absolute left-1/2 -translate-x-1/2 top-0 h-full w-[2px] pointer-events-none"
      viewBox="0 0 2 600"
      preserveAspectRatio="none"
    >
      <path
        ref={pathRef}
        d="M1 0 L1 600"
        stroke="url(#thread-grad)"
        strokeWidth="1"
        fill="none"
      />
      <defs>
        <linearGradient id="thread-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0)" />
          <stop offset="30%" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="70%" stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── Seed carousel uses imported StoryCard ─────────────────────────────── */

function SeedCarousel({
  seeds,
  openSlides,
  size = "md",
}: {
  seeds: NarrativeEntry[];
  openSlides?: boolean;
  size?: "lg" | "md";
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener("scroll", checkScroll, { passive: true });
      window.addEventListener("resize", checkScroll);
    }
    return () => {
      el?.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll]);

  const scrollAmt = size === "lg" ? 300 : 240;
  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: dir === "left" ? -scrollAmt : scrollAmt,
      behavior: "smooth",
    });
  };

  return (
    <div className="relative group/carousel">
      {canScrollLeft && (
        <button
          onClick={() => scroll("left")}
          className="absolute left-1 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full border border-white/10 bg-black/40 backdrop-blur-sm flex items-center justify-center text-white/30 hover:text-white/70 hover:border-white/20 transition opacity-0 group-hover/carousel:opacity-100"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      {canScrollRight && (
        <button
          onClick={() => scroll("right")}
          className="absolute right-1 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full border border-white/10 bg-black/40 backdrop-blur-sm flex items-center justify-center text-white/30 hover:text-white/70 hover:border-white/20 transition opacity-0 group-hover/carousel:opacity-100"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      <div
        ref={scrollRef}
        className="flex gap-5 overflow-x-auto pb-2 px-1"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {seeds.map((entry, i) => (
          <StoryCard
            key={entry.id}
            entry={entry}
            index={i}
            openSlides={openSlides}
            size={size}
            animationDelayBase={0.5}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Home page ───────────────────────────────────────────────────────────── */
export default function HomePage() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const { state: wizardState, dispatch: wizardDispatch } = useWizard();
  const access = useFeatureAccess();
  const { userApiKeys, hasOpenRouterKey } = access;
  const isMobile = useIsMobile();
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [analysisText, setAnalysisText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleOpenApiKeys = () => setApiKeysOpen(true);
    window.addEventListener("open-api-keys", handleOpenApiKeys);
    return () => window.removeEventListener("open-api-keys", handleOpenApiKeys);
  }, []);

  const needsKeys = userApiKeys && !hasOpenRouterKey;

  const openCreate = (prefill?: string) => {
    if (needsKeys) {
      setApiKeysOpen(true);
      return;
    }
    if (isMobile) return;
    wizardDispatch({ type: "OPEN", prefill });
  };

  const playgrounds = state.narratives.filter((e) =>
    PLAYGROUND_NARRATIVE_IDS.has(e.id),
  );
  const analysisSeeds = state.narratives.filter((e) =>
    ANALYSIS_NARRATIVE_IDS.has(e.id),
  );

  return (
    <>
      <div className="min-h-screen bg-bg-base flex flex-col">
        {/* Cosmic background — nebulae + star field */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="cosmos-container absolute inset-0 z-0">
            <div className="nebula nebula-1" />
            <div className="nebula nebula-2" />
            <div className="nebula nebula-3" />
            <div className="cosmos-glow" />
          </div>
          {/* Star field — drawn on top of nebulae */}
          <div className="absolute inset-0 z-10">
            <StarField />
          </div>
        </div>

        {/* Thread line */}
        <ThreadLine />

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className="relative flex flex-col items-center pt-24 sm:pt-32 pb-10 px-4">
          {/* Logo */}
          <div className="animate-fade-up mb-6">
            <Image
              src="/logo.svg"
              alt="InkTide"
              width={56}
              height={56}
              className="opacity-90"
            />
          </div>
          <p className="animate-fade-up text-[10px] uppercase tracking-[0.3em] text-white/50 font-mono mb-8">
            InkTide Engine
          </p>

          <h1 className="animate-fade-up-delay-1 text-5xl sm:text-7xl font-bold tracking-[-0.03em] text-center leading-[1.05] max-w-160 sm:whitespace-nowrap">
            <span className="text-white">Worlds that </span>
            <span
              className="glitch-wrapper text-white italic"
              data-text="breathe..."
            >
              <MorphText text="breathe" />
              ...
            </span>
          </h1>

          <p className="animate-fade-up-delay-2 text-[15px] text-white/60 mt-6 max-w-lg text-center leading-relaxed">
            Any text is a world view.
            <br />
            Extract it, query it, simulate where it goes next.
          </p>

          {/* ── Analyze Corpus ─────────────────────────────────────────── */}
          <div className="animate-fade-up-delay-3 mt-10 w-full max-w-xl">
            {isMobile ? (
              <div className="text-center py-8 border border-dashed border-white/8 rounded-xl">
                <p className="text-white/30 text-sm">
                  Series creation is available on desktop
                </p>
              </div>
            ) : (
              <>
                <div className="prompt-glow relative rounded-xl border border-white/12 focus-within:border-white/25 transition-colors duration-200 bg-white/3">
                  <textarea
                    ref={inputRef}
                    value={analysisText}
                    onChange={(e) => setAnalysisText(e.target.value)}
                    rows={5}
                    className="w-full bg-transparent text-white text-sm px-4 pt-4 pb-2 resize-none focus:outline-none placeholder:text-white/35"
                    placeholder="Paste a book, paper, screenplay, or any long-form text to analyze..."
                  />
                  <div className="flex items-center justify-between px-3 pb-3">
                    <span className="text-[10px] text-white/35 font-mono">
                      {analysisText.trim()
                        ? `${analysisText.trim().split(/\s+/).length.toLocaleString()} words`
                        : "text analysis"}
                    </span>
                    <button
                      onClick={() => {
                        if (!analysisText.trim()) return;
                        if (needsKeys) {
                          setApiKeysOpen(true);
                          return;
                        }
                        import("@/lib/analysis-transfer").then(
                          ({ setAnalysisSource }) =>
                            setAnalysisSource(analysisText).then(() =>
                              router.push("/analysis?new=1"),
                            ),
                        );
                      }}
                      disabled={!analysisText.trim()}
                      className="text-white/70 hover:text-white border border-white/10 hover:border-white/20 disabled:opacity-20 text-xs font-medium px-4 py-1.5 rounded-md transition"
                    >
                      Analyze
                    </button>
                  </div>
                </div>

                <p className="text-center text-[11px] text-white/40 mt-3">
                  or{" "}
                  <button
                    onClick={() => openCreate()}
                    className="text-white/60 hover:text-white/90 underline underline-offset-2 transition"
                  >
                    create a new world
                  </button>{" "}
                  from a premise
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── Open source book analysis ─────────────────────────────── */}
        {analysisSeeds.length > 0 && (
          <div className="relative px-4 sm:px-10 pb-16 mt-16">
            <div className="max-w-5xl mx-auto">
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono whitespace-nowrap">
                  Analyzed Works
                </h2>
                <div className="flex-1 h-px bg-white/6" />
              </div>
              <p className="text-[13px] text-white/55 leading-relaxed mb-8 max-w-lg">
                Each analyzed work adds its pacing rhythm and prose patterns to
                the system. Explore the structure underneath books that shaped a
                generation.
              </p>
              <SeedCarousel seeds={analysisSeeds} openSlides />
            </div>
          </div>
        )}

        {/* ── Playground seeds ────────────────────────────────────────── */}
        {playgrounds.length > 0 && (
          <div className="relative px-4 sm:px-10 pb-16 mt-16">
            <div className="max-w-5xl mx-auto">
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono whitespace-nowrap">
                  AI Playgrounds
                </h2>
                <div className="flex-1 h-px bg-white/6" />
              </div>
              <p className="text-[13px] text-white/55 leading-relaxed mb-5 max-w-lg">
                AI-generated alternate paths from the same starting point.
                Branch the timeline, compare force curves, see how different
                structural choices reshape the same world.
              </p>
              <SeedCarousel seeds={playgrounds} />
            </div>
          </div>
        )}

        {/* ── Q&A ───────────────────────────────────────────────────── */}
        <div className="relative px-4 sm:px-8 pb-20 mt-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono whitespace-nowrap">
                Questions
              </h2>
              <div className="flex-1 h-px bg-white/6" />
            </div>
            <div className="space-y-6">
              {[
                {
                  q: "What can I do with this?",
                  a: "Paste any long-form text and InkTide extracts a typed knowledge graph you can query by meaning, interrogate in-character, simulate forward, and extend with new content — all from the same substrate.",
                },
                {
                  q: "What's a 'world view'?",
                  a: "A causally coherent, queryable knowledge structure measured across three force fields: fate (commitments pulling toward resolution), world (the state of entities), and system (the rules of the domain). A novel, a research paper, and a wargame brief are all world views with different weightings.",
                },
                {
                  q: "How is this different from a wiki or notes?",
                  a: "Integrated Obsidian with a quantitative engine that simulates forward. Notes give you a static graph; InkTide gives you one that's queryable like a database, chattable like a character, and brancheable like Git.",
                },
                {
                  q: "How can I query the world view?",
                  a: "Semantic search with AI-synthesized overviews and citations. Surveys distribute one question across the cast to reveal fault-lines. Interviews go deep on one subject. Every respondent answers in-character from its own continuity.",
                },
                {
                  q: "Can I chat with the world?",
                  a: "Yes. Every character holds a private knowledge graph — what they've seen, who they trust, what they believe — and only that gets loaded when you talk to them. Nothing leaks across; the world stays internally consistent.",
                },
                {
                  q: "Can I simulate forward in time?",
                  a: "Yes — the core loop. The engine extracts load-bearing variables, generates a cohort of next-arc scenarios over them, and ranks each with a relative probability. Run them all in parallel; the top becomes the active branch, the rest stay as sister divergences.",
                },
                {
                  q: "How do branches stay coherent?",
                  a: "Git-like. Branches fork from a parent and share its timeline by reference; only structurally different scenes create new objects. Revise a whole branch through review → verdict → reconstruct to produce a new version. Alternate futures stay grounded in the same root world.",
                },
                {
                  q: "What does the engine measure?",
                  a: "Fate as information gain over thread prediction markets (attention-weighted KL divergence). World and System as graph deltas. Per-scene game theory across 14 strategic axes with continuous ELO ratings. Pacing as Markov transitions. All derived from graph deltas, not prose.",
                },
                {
                  q: "Can it generate?",
                  a: "Yes. A Phase Reasoning Graph mines the world's machinery; a Causal Reasoning Graph plans each arc; scenes execute the graph paced by Markov chains from analyzed works; prose follows beat plans that re-render into prose, screenplay, meta, or simulation formats.",
                },
                {
                  q: "What does it cost?",
                  a: "Free and open source. Bring an OpenRouter key for analysis, search, and generation. Optional OpenAI key for embeddings, Replicate key for images. You pay only for tokens — no subscription, no platform fee.",
                },
              ].map(({ q, a }, i) => (
                <details key={i} className="group">
                  <summary className="flex items-center justify-between cursor-pointer list-none py-2">
                    <span className="text-[13px] text-white/70 group-hover:text-white/90 transition font-medium">
                      {q}
                    </span>
                    <svg
                      className="w-3.5 h-3.5 text-white/20 group-open:rotate-90 transition-transform"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </summary>
                  <p className="text-[12px] text-white/50 leading-relaxed pb-2 pl-0">
                    {a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="relative px-4 sm:px-10 py-8 border-t border-white/6">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Image
                src="/logo.svg"
                alt="InkTide"
                width={20}
                height={20}
                className="opacity-40"
              />
              <p className="text-[11px] font-mono text-white/20 uppercase tracking-[0.2em]">
                InkTide
              </p>
            </div>
            <div className="flex items-center gap-5">
              <a
                href="https://x.com/_jason_y_"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/25 hover:text-white/60 transition-colors"
                aria-label="X / Twitter"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href="https://github.com/jasonyu0100/narrative-engine"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/25 hover:text-white/60 transition-colors"
                aria-label="GitHub"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>

      {wizardState.isOpen && <CreationWizard />}
      {apiKeysOpen && (
        <ApiKeyModal access={access} onClose={() => setApiKeysOpen(false)} />
      )}
    </>
  );
}
