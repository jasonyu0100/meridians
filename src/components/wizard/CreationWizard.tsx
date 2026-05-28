"use client";

// Direct sub-module imports rather than the @/lib/ai barrel. The barrel
// re-exports the whole AI surface; bundlers in dev mode (Turbopack
// especially) walk every re-export from anywhere the barrel is referenced,
// inflating the home-page compile graph by 30+ modules. Importing directly
// keeps the home-page's transitive set tight.
import { generateNarrative } from "@/lib/ai/world";
import { suggestPremise } from "@/lib/ai/premise";
import { useStore } from "@/lib/store";
import { useWizard } from "@/lib/wizard-context";
import { Modal } from "@/components/Modal";
import { ErrorDiagnosis, CopyErrorButton, buildErrorTrace } from "@/components/apilogs/ErrorDiagnosis";
import { diagnoseError } from "@/lib/ai/diagnose";
import {
  DEFAULT_STORY_SETTINGS,
  WEBSEARCH_MAX_RESULTS,
  WEBSEARCH_DEFAULT_MAX_TOTAL,
  type NarrativeParadigm,
  type NarrativeState,
  type WorldBuild,
} from "@/types/narrative";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const PARADIGMS: { value: NarrativeParadigm; label: string; hint: string }[] = [
  { value: "fiction",     label: "Fiction",     hint: "Invented people in an invented world" },
  { value: "non-fiction", label: "Non-fiction", hint: "Real people, documented events — the world IS the record" },
  { value: "simulation",  label: "Simulation",  hint: "Rule-driven forward modelling — the rules force what happens" },
  { value: "essay",       label: "Essay",       hint: "One named author working an argument" },
  { value: "panel",       label: "Panel",       hint: "A named cast (AI or human) deliberating over evidence" },
  { value: "atlas",       label: "Atlas",       hint: "Reference / typology — entries, taxa, doctrines" },
  { value: "debate",      label: "Debate",      hint: "Two or more parties in a zero-sum contest under rules" },
  { value: "record",      label: "Record",      hint: "Time-ordered chronicle — daily, monthly, yearly, or dynamic velocity" },
  { value: "game",        label: "Game",        hint: "Multi-actor contest — actors take turns pursuing contested stakes under enforceable rules" },
];


function buildBlankNarrative(title: string): NarrativeState {
  const now = Date.now();
  const worldBuildId = `WB-${now}-INIT`;
  const branchId = `B-${now}`;
  const initialWorldBuild: WorldBuild = {
    kind: "world_build",
    id: worldBuildId,
    createdAt: new Date(now).toISOString(),
    summary: "Blank world — created without a premise.",
    expansionManifest: {
      newCharacters: [],
      newLocations: [],
      newThreads: [],
      newArtifacts: [],
      systemDeltas: { addedNodes: [], addedEdges: [] },
      relationshipDeltas: [],
    },
  };
  return {
    id: `N-${now}`,
    title: title.trim(),
    description: "",
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    arcs: {},
    scenes: {},
    worldBuilds: { [worldBuildId]: initialWorldBuild },
    branches: {
      [branchId]: {
        id: branchId,
        name: "Main",
        parentBranchId: null,
        forkEntryId: null,
        entryIds: [worldBuildId],
        createdAt: now,
      },
    },
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: "",
    storySettings: { ...DEFAULT_STORY_SETTINGS },
    patterns: [],
    antiPatterns: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function CreationWizard() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const { state: wizardState, dispatch: wizardDispatch } = useWizard();
  const wd = wizardState.data;
  const isGenerating = wizardState.step === "generate";
  const isDetails = wizardState.step === "details";

  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState("");
  // Raw output captured when the LLM returned unparseable JSON. The repair
  // pass runs its own LLM-based diagnosis on this raw before attempting the
  // fix, so no separate hint needs to be tracked here.
  const [failedRaw, setFailedRaw] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const started = useRef(false);

  const isDuplicate =
    wd.title.trim() !== "" &&
    state.narratives.some(
      (n) => n.title.toLowerCase() === wd.title.trim().toLowerCase(),
    );

  const canGenerate = !!wd.title.trim() && !!wd.premise.trim() && !isDuplicate;

  function update(data: Partial<typeof wd>) {
    wizardDispatch({ type: "UPDATE_DATA", data });
  }

  // ── Suggest ──────────────────────────────────────────────────────────
  async function handleSuggest() {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const data = await suggestPremise();
      if (data.title || data.premise) {
        update({ title: data.title ?? "", premise: data.premise ?? "" });
      }
    } catch {
      // logged by callGenerate
    } finally {
      setSuggesting(false);
    }
  }

  // ── Start blank ──────────────────────────────────────────────────────
  function handleStartBlank() {
    if (!wd.title.trim() || isDuplicate) return;
    const narrative = buildBlankNarrative(wd.title);
    dispatch({ type: "ADD_NARRATIVE", narrative });
    wizardDispatch({ type: "CLOSE" });
    wizardDispatch({ type: "SET_STEP", step: "form" });
    router.push(`/narrative/${narrative.id}`);
  }

  // ── Generate ─────────────────────────────────────────────────────────
  // mode: 'fresh' starts a new LLM call; 'repair' reuses the prior raw and
  // asks the model to fix the JSON instead of regenerating from scratch.
  async function handleGenerate(mode: 'fresh' | 'repair' = 'fresh') {
    if (loading) return;
    if (mode === 'repair' && !failedRaw) return;
    setLoading(true);
    setStreamText("");
    setError("");
    try {
      const research = wd.researchMode ?? false;
      const narrative = await generateNarrative(
        wd.title,
        wd.premise,
        (reasoning) => setStreamText((prev) => prev + reasoning),
        wd.worldOnly ?? false,
        wd.paradigm,
        wd.sourceText,
        research
          ? { maxResults: WEBSEARCH_MAX_RESULTS.high, maxTotalResults: WEBSEARCH_DEFAULT_MAX_TOTAL }
          : null,
        mode === 'repair' ? failedRaw! : undefined,
        wd.sceneCount ?? 4,
      );
      // Persist the wizard-time choice onto the new narrative so subsequent
      // generations inherit the same effort by default.
      if (research) {
        narrative.storySettings = {
          ...DEFAULT_STORY_SETTINGS,
          ...narrative.storySettings,
          websearchLevel: "high",
          websearchMaxTotalResults: WEBSEARCH_DEFAULT_MAX_TOTAL,
        };
      }
      setFailedRaw(null);
      dispatch({ type: "ADD_NARRATIVE", narrative });
      wizardDispatch({ type: "CLOSE" });
      wizardDispatch({ type: "SET_STEP", step: "form" });
      router.push(`/narrative/${narrative.id}`);
    } catch (err) {
      setError(String(err));
      // JsonRepairableError carries the malformed raw output so the user
      // can launch a targeted LLM-fix instead of paying for a full re-run.
      // The repair flow runs its own LLM-based diagnosis on this raw, so
      // we only need to capture the content here.
      if (err && typeof err === 'object' && 'raw' in err && typeof (err as { raw: unknown }).raw === 'string') {
        setFailedRaw((err as { raw: string }).raw);
      } else {
        setFailedRaw(null);
      }
      setLoading(false);
    }
  }

  // Auto-start generation when stepping to generate
  useEffect(() => {
    if (isGenerating && !started.current) {
      started.current = true;
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating]);

  if (!wizardState.isOpen) return null;
  // The two-step flow has been collapsed into a single page; `isDetails`
  // remains exported in the wizard state type for back-compat but the
  // component no longer routes to it.
  void isDetails;

  const closeWizard = () => wizardDispatch({ type: "CLOSE" });

  // ── Fullscreen single-page wizard ────────────────────────────────────
  return (
    <Modal onClose={loading ? () => {} : closeWizard} fullScreen>
      <div className="relative flex flex-col h-full">
        {/* Header — translucent so the constellations show through, with a
            subtle gradient accent across the title */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-white/10 shrink-0 bg-bg-base/40 backdrop-blur-md">
          <div className="flex items-center gap-4">
            {/* Tiny orbital glyph beside the title */}
            <div className="relative w-7 h-7 shrink-0">
              <div className="absolute inset-0 rounded-full border border-emerald-400/30" />
              <div className="absolute inset-1.5 rounded-full border border-emerald-400/50" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)] animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-semibold bg-linear-to-r from-emerald-300 via-cyan-200 to-violet-300 bg-clip-text text-transparent tracking-tight">
                Generate New World View
              </h2>
              <p className="text-[11px] text-text-dim mt-0.5">
                Pick the paradigm, write a premise, optionally seed with source material and details.
              </p>
            </div>
          </div>
          <button
            onClick={closeWizard}
            disabled={loading}
            className="text-text-dim hover:text-text-primary text-xl leading-none disabled:opacity-30 disabled:pointer-events-none w-8 h-8 rounded-lg hover:bg-white/5 transition flex items-center justify-center"
          >
            &times;
          </button>
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-8 py-10 flex flex-col gap-8">
            {/* Title */}
            <section>
              <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-2 block font-mono">
                Title
              </label>
              <input
                type="text"
                value={wd.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder="e.g. The Gilded Cage"
                className="bg-bg-elevated/60 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2.5 text-sm text-text-primary w-full outline-none placeholder:text-text-dim focus:border-white/16 transition"
              />
              {isDuplicate && (
                <p className="text-[11px] text-fate mt-1.5">
                  A series with this name already exists.
                </p>
              )}
            </section>

            {/* Paradigm */}
            <section className="border-t border-white/8 pt-8">
              <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-2 block font-mono">
                Paradigm
              </label>
              <div className="grid grid-cols-3 gap-2">
                {PARADIGMS.map((p) => {
                  const active = wd.paradigm === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => update({ paradigm: p.value })}
                      title={p.hint}
                      className={`text-[11px] px-3 py-2 rounded-lg border transition text-left ${
                        active
                          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                          : "bg-white/4 hover:bg-white/8 border-white/10 hover:border-white/20 text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      <div className="font-medium">{p.label}</div>
                      <div
                        className={`text-[10px] mt-0.5 leading-tight ${active ? "text-emerald-300/70" : "text-text-dim"}`}
                      >
                        {p.hint}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-text-dim/60 italic mt-2">
                Steers generation into one of the engine&apos;s six canonical world-shapes.
              </p>
            </section>

            {/* Research mode — saturating websearch for world-gen */}
            <section className="border-t border-white/8 pt-8">
              <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-2 block font-mono">
                Research mode
              </label>
              {(() => {
                const active = wd.researchMode ?? false;
                return (
                  <button
                    type="button"
                    onClick={() => update({ researchMode: !active })}
                    aria-pressed={active}
                    className={`w-full flex items-center justify-between gap-4 text-left px-4 py-3 rounded-lg border transition ${
                      active
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                        : "bg-white/4 hover:bg-white/8 border-white/10 hover:border-white/20 text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-[11px] font-medium">
                        {active ? "On — saturating web research" : "Off"}
                      </span>
                      <span className={`text-[10px] mt-0.5 ${active ? "text-emerald-300/70" : "text-text-dim"}`}>
                        {active
                          ? `Up to ${WEBSEARCH_MAX_RESULTS.high} results / call, ${WEBSEARCH_DEFAULT_MAX_TOTAL} total — full context load for world-gen`
                          : "Use model training knowledge only"}
                      </span>
                    </div>
                    {/* Toggle pill */}
                    <span
                      className={`relative inline-flex shrink-0 w-9 h-5 rounded-full transition ${
                        active ? "bg-emerald-400/70" : "bg-white/15"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition ${
                          active ? "left-4" : "left-0.5"
                        }`}
                      />
                    </span>
                  </button>
                );
              })()}
              <p className="text-[10px] text-text-dim/60 italic mt-2">
                When on, world generation gets OpenRouter&apos;s web_search + web_fetch tools at the saturating tier. Best for analysis / paper / non-fiction / simulation paradigms grounded in current facts. Tune level + total-results cap per world view afterwards in World View Settings.
              </p>
            </section>

            {/* Premise */}
            <section className="border-t border-white/8 pt-8">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">
                  Premise
                </label>
                <button
                  type="button"
                  onClick={handleSuggest}
                  disabled={suggesting}
                  className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                >
                  {suggesting ? "Thinking…" : "Suggest"}
                </button>
              </div>
              <textarea
                value={wd.premise}
                onChange={(e) => update({ premise: e.target.value })}
                placeholder="Describe your world…"
                className="bg-bg-elevated/60 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2.5 text-sm text-text-primary w-full h-32 resize-y outline-none placeholder:text-text-dim focus:border-white/16 transition"
              />
            </section>

            {/* Source material — optional seeding context */}
            <section className="border-t border-white/8 pt-8">
              <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-2 block font-mono">
                Source material <span className="normal-case tracking-normal text-text-dim/60">(optional)</span>
              </label>
              <textarea
                value={wd.sourceText ?? ""}
                onChange={(e) => update({ sourceText: e.target.value })}
                placeholder="Paste reference material…"
                className="bg-bg-elevated/60 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2.5 text-sm text-text-primary w-full h-44 resize-y outline-none placeholder:text-text-dim focus:border-white/16 transition font-mono"
              />
              {wd.sourceText && wd.sourceText.length > 0 && (
                <p className="text-[10px] text-text-dim/60 mt-1.5 font-mono">
                  {wd.sourceText.length.toLocaleString()} characters
                </p>
              )}
            </section>

            {/* Options */}
            <section className="border-t border-white/8 pt-8">
              <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-3 block font-mono">
                Options
              </label>

              {/* Scenes to generate — only meaningful when the opening arc is on */}
              {!(wd.worldOnly ?? false) && (
                <div className="mb-4">
                  <label className="text-[10px] text-text-dim/80 uppercase tracking-wider block mb-2">
                    Opening arc length
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={2}
                      max={8}
                      step={1}
                      value={wd.sceneCount ?? 4}
                      onChange={(e) => update({ sceneCount: Number(e.target.value) })}
                      className="flex-1 accent-emerald-400"
                    />
                    <span className="text-[11px] text-text-primary font-mono w-16 text-right">
                      {wd.sceneCount ?? 4} scenes
                    </span>
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={wd.worldOnly ?? false}
                  onChange={(e) => update({ worldOnly: e.target.checked })}
                  className="accent-emerald-400 w-3.5 h-3.5"
                />
                <span className="text-xs text-text-dim">
                  World only — skip introduction arc
                  <span className="ml-1 text-text-dim/60">
                    (use premise as the world view's plan, generate entities only)
                  </span>
                </span>
              </label>
            </section>
          </div>
        </div>

        {/* Footer actions — translucent so the constellations bleed through */}
        <div className="border-t border-white/10 px-8 py-4 shrink-0 flex items-center justify-between bg-bg-base/40 backdrop-blur-md">
          <button
            onClick={closeWizard}
            disabled={loading}
            className="text-text-dim text-xs hover:text-text-secondary transition disabled:opacity-30 disabled:pointer-events-none"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={handleStartBlank}
              disabled={!wd.title.trim() || isDuplicate || loading}
              title="Skip the premise and start with an empty world — only the title is kept."
              className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-text-secondary hover:text-text-primary text-xs font-medium px-4 py-2 rounded-lg backdrop-blur-sm transition disabled:opacity-30 disabled:pointer-events-none"
            >
              Start blank
            </button>
            <button
              onClick={() => handleGenerate('fresh')}
              disabled={!canGenerate || loading}
              className="relative bg-linear-to-r from-emerald-500/30 via-emerald-400/30 to-cyan-400/30 hover:from-emerald-500/40 hover:via-emerald-400/40 hover:to-cyan-400/40 border border-emerald-400/40 text-emerald-200 hover:text-emerald-100 text-xs font-semibold px-5 py-2 rounded-lg shadow-[0_0_16px_rgba(52,211,153,0.25)] hover:shadow-[0_0_24px_rgba(52,211,153,0.45)] transition disabled:opacity-30 disabled:pointer-events-none disabled:shadow-none"
            >
              {loading ? "Generating…" : "Generate World View"}
            </button>
          </div>
        </div>

        {/* Generation overlay — animated visual + timer + stream */}
        {(loading || isGenerating || error) && (
          <GenerationOverlay
            loading={loading}
            error={error}
            streamText={streamText}
            onCancel={() => {
              started.current = false;
              setError("");
              setFailedRaw(null);
              wizardDispatch({ type: "SET_STEP", step: "form" });
            }}
            caller="generateNarrative"
            onRetry={() => handleGenerate('fresh')}
            onRepair={failedRaw ? () => handleGenerate('repair') : undefined}
          />
        )}
      </div>
    </Modal>
  );
}

// ── Generation overlay ───────────────────────────────────────────────────────
// Full-pane orbital animation + mm:ss elapsed timer + collapsible stream view.

function GenerationOverlay({
  loading,
  error,
  streamText,
  onCancel,
  onRetry,
  onRepair,
  caller,
}: {
  loading: boolean;
  error: string;
  streamText: string;
  onCancel: () => void;
  onRetry: () => void;
  /** Optional — only present when the failure was a parseable-JSON error
   *  and we still hold the malformed raw output to feed back to the LLM. */
  onRepair?: () => void;
  /** Caller id for the diagnostic — drives the per-caller summary noun. */
  caller?: string;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [showStream, setShowStream] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [loading]);

  const mm = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const ss = (elapsed % 60).toString().padStart(2, "0");

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-base/70 backdrop-blur-md">
      <div className="flex flex-col items-center gap-8 max-w-xl w-full px-8">
        {loading ? (
          <>
            {/* Orbital animation */}
            <div className="relative w-56 h-56">
              {/* Concentric rings */}
              <svg viewBox="0 0 224 224" className="absolute inset-0">
                <circle cx="112" cy="112" r="96" fill="none" stroke="rgba(52, 211, 153, 0.06)" strokeWidth="1" />
                <circle cx="112" cy="112" r="68" fill="none" stroke="rgba(52, 211, 153, 0.10)" strokeWidth="1" />
                <circle cx="112" cy="112" r="40" fill="none" stroke="rgba(52, 211, 153, 0.14)" strokeWidth="1" />
              </svg>

              {/* Outer orbit — 1 large node, slow CW */}
              <div className="absolute inset-0 animate-[spin_10s_linear_infinite]">
                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
              </div>

              {/* Middle orbit — 2 nodes opposite, medium CCW */}
              <div className="absolute inset-0 animate-[spin_6s_linear_infinite_reverse]">
                <div className="absolute top-[14%] left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.6)]" />
                <div className="absolute bottom-[14%] left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.6)]" />
              </div>

              {/* Inner orbit — 4 nodes (cardinal), fast CW */}
              <div className="absolute inset-0 animate-[spin_4s_linear_infinite]">
                <div className="absolute top-[28%] left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-200/80" />
                <div className="absolute bottom-[28%] left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-200/80" />
                <div className="absolute top-1/2 left-[28%] -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-emerald-200/80" />
                <div className="absolute top-1/2 right-[28%] -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-emerald-200/80" />
              </div>

              {/* Center pulse */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_20px_rgba(52,211,153,0.9)]" />
            </div>

            {/* Label + timer */}
            <div className="text-center">
              <div className="text-sm font-medium text-text-primary">Generating world view…</div>
              <div className="text-3xl font-mono text-emerald-400 mt-3 tabular-nums tracking-wider">
                {mm}:{ss}
              </div>
              <div className="text-[10px] text-text-dim mt-2 tracking-wider uppercase">elapsed</div>
            </div>

            {/* Optional stream peek */}
            <div className="w-full">
              <button
                onClick={() => setShowStream((s) => !s)}
                className="text-[10px] text-text-dim hover:text-text-secondary uppercase tracking-wider transition"
              >
                {showStream ? "Hide reasoning ▴" : "Show reasoning ▾"}
              </button>
              {showStream && (
                <pre className="mt-2 text-[10px] text-text-dim/80 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto bg-white/3 border border-white/8 rounded-lg p-3 leading-relaxed">
                  {streamText || "Waiting on first tokens…"}
                </pre>
              )}
            </div>
          </>
        ) : error ? (
          (() => {
            const diagnosis = diagnoseError(error, caller);
            const trace = buildErrorTrace({ caller, error, diagnosis });
            return (
              <>
                <h3 className="text-sm font-semibold text-fate">Generation failed</h3>
                <div className="bg-fate/10 border border-fate/30 rounded-lg px-4 py-3 w-full flex flex-col gap-3">
                  <ErrorDiagnosis error={error} caller={caller} />
                  <details className="text-[10px] text-text-dim">
                    <summary className="cursor-pointer hover:text-text-secondary select-none">Raw error</summary>
                    <pre className="mt-2 text-fate/80 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">{error}</pre>
                  </details>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={onCancel}
                    className="text-text-dim text-xs hover:text-text-secondary transition"
                  >
                    &larr; Back
                  </button>
                  <CopyErrorButton trace={trace} />
                  {onRepair && (
                    <button
                      onClick={onRepair}
                      title="Send the malformed output back to the model with the diagnosed issue — cheaper than a full re-run."
                      className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold px-5 py-2 rounded-lg transition"
                    >
                      Repair
                    </button>
                  )}
                  <button
                    onClick={onRetry}
                    className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold px-5 py-2 rounded-lg transition"
                  >
                    Retry
                  </button>
                </div>
              </>
            );
          })()
        ) : null}
      </div>
    </div>
  );
}
