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
import {
  DEFAULT_STORY_SETTINGS,
  WEBSEARCH_MAX_RESULTS,
  WEBSEARCH_DEFAULT_MAX_TOTAL,
  type CharacterSketch,
  type LocationSketch,
  type NarrativeParadigm,
  type NarrativeState,
  type ThreadSketch,
  type WorldBuild,
} from "@/types/narrative";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const ROLES: CharacterSketch["role"][] = ["anchor", "recurring", "transient"];

const PARADIGMS: { value: NarrativeParadigm; label: string; hint: string }[] = [
  { value: "fiction",     label: "Fiction",     hint: "Invented people in an invented world" },
  { value: "non-fiction", label: "Non-fiction", hint: "Real people, documented events — the world IS the record" },
  { value: "simulation",  label: "Simulation",  hint: "Rule-driven forward modelling — the rules force what happens" },
  { value: "essay",       label: "Essay",       hint: "One named author working an argument" },
  { value: "panel",       label: "Panel",       hint: "A named cast (AI or human) deliberating over evidence" },
  { value: "atlas",       label: "Atlas",       hint: "Reference / typology — entries, taxa, doctrines" },
  { value: "debate",      label: "Debate",      hint: "Two or more parties in a zero-sum contest under rules" },
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

  // ── Characters ───────────────────────────────────────────────────────
  function addCharacter() {
    update({
      characters: [
        ...wd.characters,
        { name: "", role: "recurring", description: "" },
      ],
    });
  }
  function updateCharacter(i: number, patch: Partial<CharacterSketch>) {
    const chars = [...wd.characters];
    chars[i] = { ...chars[i], ...patch };
    update({ characters: chars });
  }
  function removeCharacter(i: number) {
    update({ characters: wd.characters.filter((_, idx) => idx !== i) });
  }

  // ── Locations ────────────────────────────────────────────────────────
  function addLocation() {
    update({ locations: [...wd.locations, { name: "", description: "" }] });
  }
  function updateLocation(i: number, patch: Partial<LocationSketch>) {
    const locs = [...wd.locations];
    locs[i] = { ...locs[i], ...patch };
    update({ locations: locs });
  }
  function removeLocation(i: number) {
    update({ locations: wd.locations.filter((_, idx) => idx !== i) });
  }

  // ── Threads ─────────────────────────────────────────────────────────
  function addThread() {
    update({
      threads: [...wd.threads, { description: "", participantNames: [] }],
    });
  }
  function updateThread(i: number, patch: Partial<ThreadSketch>) {
    const t = [...wd.threads];
    t[i] = { ...t[i], ...patch };
    update({ threads: t });
  }
  function removeThread(i: number) {
    update({ threads: wd.threads.filter((_, idx) => idx !== i) });
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
  function buildEnhancedPremise() {
    const parts: string[] = [wd.premise];
    const details: string[] = [];

    if (wd.characters.length > 0) {
      const charLines = wd.characters
        .filter((c) => c.name.trim())
        .map(
          (c) =>
            `  - ${c.name} (${c.role})${c.description ? `: ${c.description}` : ""}`,
        );
      if (charLines.length > 0) {
        details.push(`Key characters:\n${charLines.join("\n")}`);
      }
    }

    if (wd.locations.length > 0) {
      const locLines = wd.locations
        .filter((l) => l.name.trim())
        .map(
          (l) => `  - ${l.name}${l.description ? `: ${l.description}` : ""}`,
        );
      if (locLines.length > 0) {
        details.push(`Key locations:\n${locLines.join("\n")}`);
      }
    }

    if (wd.threads.length > 0) {
      const threadLines = wd.threads
        .filter((t) => t.description.trim())
        .map(
          (t) =>
            `  - ${t.description}${t.participantNames.length > 0 ? ` (involves: ${t.participantNames.join(", ")})` : ""}`,
        );
      if (threadLines.length > 0) {
        details.push(`Narrative threads:\n${threadLines.join("\n")}`);
      }
    }

    if (details.length > 0) {
      parts.push("", ...details);
    }

    return parts.join("\n");
  }

  async function handleGenerate() {
    if (loading) return;
    setLoading(true);
    setStreamText("");
    setError("");
    try {
      const research = wd.researchMode ?? false;
      const narrative = await generateNarrative(
        wd.title,
        buildEnhancedPremise(),
        (reasoning) => setStreamText((prev) => prev + reasoning),
        wd.worldOnly ?? false,
        wd.paradigm,
        wd.sourceText,
        research
          ? { maxResults: WEBSEARCH_MAX_RESULTS.high, maxTotalResults: WEBSEARCH_DEFAULT_MAX_TOTAL }
          : null,
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
      dispatch({ type: "ADD_NARRATIVE", narrative });
      wizardDispatch({ type: "CLOSE" });
      wizardDispatch({ type: "SET_STEP", step: "form" });
      router.push(`/narrative/${narrative.id}`);
    } catch (err) {
      setError(String(err));
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

            {/* Characters */}
            <section className="border-t border-white/8 pt-8">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">
                  Characters <span className="normal-case tracking-normal text-text-dim/60">(optional)</span>
                </label>
                <button
                  type="button"
                  onClick={addCharacter}
                  className="text-[10px] text-text-dim hover:text-text-secondary transition"
                >
                  + Add
                </button>
              </div>
              {wd.characters.length === 0 ? (
                <p className="text-[11px] text-text-dim/60 italic">
                  No characters defined — the engine will create them from the premise.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {wd.characters.map((ch, i) => (
                    <div
                      key={i}
                      className="flex gap-2 items-start bg-bg-elevated rounded-lg p-3 border border-border"
                    >
                      <div className="flex-1 flex flex-col gap-1.5">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={ch.name}
                            onChange={(e) => updateCharacter(i, { name: e.target.value })}
                            placeholder="Name"
                            className="flex-1 bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                          />
                          <select
                            value={ch.role}
                            onChange={(e) =>
                              updateCharacter(i, { role: e.target.value as CharacterSketch["role"] })
                            }
                            className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none pb-0.5"
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </div>
                        <input
                          type="text"
                          value={ch.description}
                          onChange={(e) => updateCharacter(i, { description: e.target.value })}
                          placeholder="Brief description, goals, or traits…"
                          className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none placeholder:text-text-dim/60 focus:border-white/20 transition pb-0.5"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeCharacter(i)}
                        className="text-text-dim hover:text-text-secondary text-xs mt-0.5"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Locations */}
            <section className="border-t border-white/8 pt-8">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">
                  Locations <span className="normal-case tracking-normal text-text-dim/60">(optional)</span>
                </label>
                <button
                  type="button"
                  onClick={addLocation}
                  className="text-[10px] text-text-dim hover:text-text-secondary transition"
                >
                  + Add
                </button>
              </div>
              {wd.locations.length === 0 ? (
                <p className="text-[11px] text-text-dim/60 italic">
                  No locations defined — the engine will create them from the premise.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {wd.locations.map((loc, i) => (
                    <div
                      key={i}
                      className="flex gap-2 items-start bg-bg-elevated rounded-lg p-3 border border-border"
                    >
                      <div className="flex-1 flex flex-col gap-1.5">
                        <input
                          type="text"
                          value={loc.name}
                          onChange={(e) => updateLocation(i, { name: e.target.value })}
                          placeholder="Location name"
                          className="flex-1 bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                        />
                        <input
                          type="text"
                          value={loc.description}
                          onChange={(e) => updateLocation(i, { description: e.target.value })}
                          placeholder="Description, atmosphere, significance…"
                          className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none placeholder:text-text-dim/60 focus:border-white/20 transition pb-0.5"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLocation(i)}
                        className="text-text-dim hover:text-text-secondary text-xs mt-0.5"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Threads */}
            <section className="border-t border-white/8 pt-8">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">
                  Threads <span className="normal-case tracking-normal text-text-dim/60">(optional)</span>
                </label>
                <button
                  type="button"
                  onClick={addThread}
                  className="text-[10px] text-text-dim hover:text-text-secondary transition"
                >
                  + Add
                </button>
              </div>
              {wd.threads.length === 0 ? (
                <p className="text-[11px] text-text-dim/60 italic">
                  No threads defined — the engine will generate narrative tensions from the premise.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {wd.threads.map((th, i) => (
                    <div
                      key={i}
                      className="flex gap-2 items-start bg-bg-elevated rounded-lg p-3 border border-border"
                    >
                      <div className="flex-1 flex flex-col gap-1.5">
                        <input
                          type="text"
                          value={th.description}
                          onChange={(e) => updateThread(i, { description: e.target.value })}
                          placeholder="Describe the tension, conflict, or open question…"
                          className="flex-1 bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                        />
                        <input
                          type="text"
                          value={th.participantNames.join(", ")}
                          onChange={(e) =>
                            updateThread(i, {
                              participantNames: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="Participants (comma-separated names)…"
                          className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none placeholder:text-text-dim/60 focus:border-white/20 transition pb-0.5"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeThread(i)}
                        className="text-text-dim hover:text-text-secondary text-xs mt-0.5"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Options */}
            <section className="border-t border-white/8 pt-8">
              <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-2 block font-mono">
                Options
              </label>
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
              onClick={handleGenerate}
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
              wizardDispatch({ type: "SET_STEP", step: "form" });
            }}
            onRetry={handleGenerate}
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
}: {
  loading: boolean;
  error: string;
  streamText: string;
  onCancel: () => void;
  onRetry: () => void;
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
          <>
            <h3 className="text-sm font-semibold text-fate">Generation failed</h3>
            <div className="bg-fate/10 border border-fate/30 rounded-lg px-4 py-3 w-full">
              <p className="text-xs text-fate/80">{error}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onCancel}
                className="text-text-dim text-xs hover:text-text-secondary transition"
              >
                &larr; Back
              </button>
              <button
                onClick={onRetry}
                className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold px-5 py-2 rounded-lg transition"
              >
                Retry
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
