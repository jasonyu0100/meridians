"use client";
// GeneratePanel — main scene/arc generation controls with expand-world and error-repair surfacing.

import { Modal, ModalBody, ModalHeader } from "@/components/Modal";
import { AdvancedSettingsModal, type SceneSpec } from "@/components/generation/AdvancedSettingsModal";
import { Segmented } from "@/components/ui/Segmented";
import { ErrorDiagnosis, CopyErrorButton, buildErrorTrace } from "@/components/apilogs/ErrorDiagnosis";
import { diagnoseError } from "@/lib/ai/diagnose";
import { IconChevronRight, IconDice, IconMerge } from "@/components/icons";
import { uid } from "@/components/stage/RoomUI";
import { resolutionOutcomes, suggestMergeSceneCount, executiveStreamCount } from "@/lib/merges";
import {
  DEFAULT_EXPANSION_FILTER,
  expandWorld,
  generateScenes,
  suggestArcDirection,
  suggestWorldExpansion,
  type CoordinationPlanContext,
  type ExpansionEntityFilter,
  type WorldExpansionSize,
} from "@/lib/ai";
import {
  buildPlanDirective,
  getArcNode,
  getArcSceneCount,
  isPlanComplete,
} from "@/lib/auto-engine";
import { nextId } from "@/lib/forces/narrative-utils";
import {
  buildPresetSequence,
  buildSequenceFromModes,
  DEFAULT_TRANSITION_MATRIX,
  detectCurrentMode,
  MATRIX_PRESETS,
  samplePacingSequence,
  type PacingSequence,
  type PacingPreset,
} from "@/lib/pacing/pacing-markov";
import { useStore } from "@/lib/state/store";
import { logError } from "@/lib/core/system-logger";
import type { CubeCornerKey, NarrativeState, TimeUnit, Merge, ProposedMerge } from "@/types/narrative";
import {
  DEFAULT_STORY_SETTINGS,
  NARRATIVE_CUBE,
  resolveEntry,
} from "@/types/narrative";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GuidanceFields } from "./GuidanceFields";
import { MarkovGraph } from "./MarkovGraph";
import { CubeBadge, PacingStrip } from "./PacingStrip";

type Mode = "arc" | "world";

// ── Corner colors ────────────────────────────────────────────────────────────

const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: "#f59e0b",
  HHL: "#ef4444",
  HLH: "#a855f7",
  HLL: "#6366f1",
  LHH: "#22d3ee",
  LHL: "#22c55e",
  LLH: "#3b82f6",
  LLL: "#6b7280",
};

const ALL_CORNERS: CubeCornerKey[] = [
  "HHH",
  "HHL",
  "HLH",
  "HLL",
  "LHH",
  "LHL",
  "LLH",
  "LLL",
];

// ── Streaming Output ─────────────────────────────────────────────────────────

function StreamingOutput({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <h2 className="text-sm font-semibold text-text-primary">
          {label}&hellip;
        </h2>
      </div>
      {text ? (
        <pre className="text-[11px] text-text-dim font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-white/3 rounded-lg p-3 leading-relaxed">
          {text}
        </pre>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="h-3 w-3/4 bg-white/6 rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-white/6 rounded animate-pulse" />
          <div className="h-3 w-5/6 bg-white/6 rounded animate-pulse" />
        </div>
      )}
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export function GeneratePanel({
  onClose,
  initialWorldMode,
  initialWorldDirection,
  initialContinuationMode,
  initialStoryDirection,
  proposedMerge,
  onGenerated,
  onLoadingChange,
  autoGenerate,
}: {
  onClose: () => void;
  /** Fired AFTER a generation actually adds scenes (BULK_ADD_SCENES), distinct
   *  from `onClose` (which also fires on a plain dismiss). The Conviction resolve
   *  flow uses this to progress the round ONLY when an arc was really generated —
   *  closing the panel without generating must not advance the game. */
  onGenerated?: () => void;
  /** Mirrors the panel's internal loading state so a host (the Conviction board)
   *  can show generation in progress to players while the GM drives the panel. */
  onLoadingChange?: (loading: boolean) => void;
  /** Fire the arc generation automatically once the proposed merge is loaded —
   *  the Conviction Automatic-approval flow opens this panel and lets it run on
   *  its own, so a light-touch GM still watches the continuation's reasoning
   *  stream without clicking Generate. Fires exactly once. */
  autoGenerate?: boolean;
  /** When true, the panel opens straight into the world-expansion tab with
   *  `initialWorldDirection` prefilled into the direction field. Fired by
   *  brief-driven expansion suggestions. */
  initialWorldMode?: boolean;
  initialWorldDirection?: string;
  /** When true, the panel opens in arc mode with
   *  `initialStoryDirection` prefilled into the per-generation direction
   *  field. Fired by brief-driven Generate Arc CTAs. */
  initialContinuationMode?: boolean;
  initialStoryDirection?: string;
  /** A merge proposed at the commit review. When present, it is the locked
   *  continuity basis for this generation: rendered into the prompt, and only
   *  persisted (CREATE_MERGE + COMMIT_STREAM) and stamped onto the produced
   *  arc / world-build once generation succeeds. */
  proposedMerge?: ProposedMerge;
}) {
  const { state, dispatch } = useStore();
  const [mode, setMode] = useState<Mode>(initialWorldMode ? "world" : "arc");

  // Continuation state
  const [newArc, setNewArc] = useState(true);
  const [arcName, setArcName] = useState("");
  const [direction, setDirection] = useState(
    initialContinuationMode && initialStoryDirection ? initialStoryDirection : "",
  );
  const [directionCount, setDirectionCount] = useState(4); // Number of scenes to generate
  // Seed worldBuildFocusId from the saved worldFocus setting so manual scene
  // generation respects the same focus the auto-play loop uses. 'latest' →
  // most recent WB on the resolved branch; 'custom' → the saved id; 'none'
  // (default) → null.
  const initialWorldBuildFocusId = (() => {
    const settings = state.activeNarrative?.storySettings;
    const mode = settings?.worldFocus ?? 'none';
    if (mode === 'custom' && settings?.worldFocusId) return settings.worldFocusId;
    if (mode === 'latest') {
      const wbs = state.activeNarrative?.worldBuilds ?? {};
      const lastKey = [...state.resolvedEntryKeys].reverse().find((k) => wbs[k]);
      return lastKey ?? null;
    }
    return null;
  })();
  const [worldBuildFocusId, setWorldBuildFocusId] = useState<string | null>(
    initialWorldBuildFocusId,
  );
  const [guidanceDirection, setGuidanceDirection] = useState(
    initialContinuationMode && initialStoryDirection ? initialStoryDirection : "",
  );
  const [advancedModalOpen, setAdvancedModalOpen] = useState(false);
  const [firstSceneTimeUnit, setFirstSceneTimeUnit] = useState<TimeUnit | "automatic">("automatic");
  const [firstSceneTimeValue, setFirstSceneTimeValue] = useState<string>("");
  // Advanced cast & place config — edited in AdvancedSettingsModal, woven into
  // the direction at generate time and summarised under the panel divider.
  const [seedLocationId, setSeedLocationId] = useState<string | null>(null);
  const [arcCharacterIds, setArcCharacterIds] = useState<string[]>([]);
  const [perSceneCast, setPerSceneCast] = useState(false);
  const [sceneSpecs, setSceneSpecs] = useState<SceneSpec[]>([]);

  // Pacing preview
  const [previewSequence, setPreviewSequence] = useState<PacingSequence | null>(
    null,
  );
  const [animating, setAnimating] = useState(false);
  const [editingStep, setEditingStep] = useState<number | null>(null);

  // World state — explicit pre-fill from a brief CTA wins; otherwise the
  // persistent worldDirection setting seeds the field so the operator's
  // saved north-star is always the starting point.
  const [worldDirective, setWorldDirective] = useState(
    initialWorldMode && initialWorldDirection
      ? initialWorldDirection
      : state.activeNarrative?.storySettings?.worldDirection?.trim() ?? "",
  );
  const [worldSize, setWorldSize] = useState<WorldExpansionSize>("exact");
  const [entityFilter, setEntityFilter] = useState<ExpansionEntityFilter>({
    ...DEFAULT_EXPANSION_FILTER,
  });

  // Shared
  const [loading, setLoading] = useState(false);
  // Mirror loading to the host (the Conviction board) so players see generation
  // in progress while the GM drives the panel. Ref-held so an inline callback
  // doesn't re-fire every render — only on an actual loading transition.
  const onLoadingChangeRef = useRef(onLoadingChange);
  onLoadingChangeRef.current = onLoadingChange;
  useEffect(() => {
    onLoadingChangeRef.current?.(loading);
  }, [loading]);
  const [streamText, setStreamText] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState("");
  // Raw output captured on a JSON parse failure so the user can Repair
  // (LLM-fix the malformed output) instead of paying for a full re-run.
  // `kind` tells handleRepair which generation path to resume. The repair
  // flow runs its own LLM-based diagnosis on the raw, so no hint is
  // tracked here.
  const [failedRaw, setFailedRaw] = useState<{ kind: 'scenes' | 'world'; raw: string } | null>(null);

  // A proposed merge (from the commit review) is the locked continuity basis
  // for this generation. We mint its id once, up front (stable across renders
  // via the state initializer), so the same id is both stamped onto the
  // produced arc / world-build AND used for the CREATE_MERGE that persists it
  // on success — making every merge consumed-by-construction.
  // Prefer a deterministic id carried on the proposed merge (Conviction stamps
  // one per round so a round yields exactly ONE merge across remounts /
  // regenerations); fall back to a freshly-minted id for the ad-hoc
  // "commit these streams" path that doesn't supply one. Either way the id is
  // stable for this panel instance, so basisMerges + commitProposedMerge agree.
  const [fallbackMergeId] = useState(() => uid("merge"));
  const proposedMergeId = proposedMerge?.id ?? fallbackMergeId;

  // Guards the one-time automatic arc-length set from a pending merge.
  const mergeLengthSetRef = useRef(false);

  const narrative = state.activeNarrative;
  // A proposed merge carrying an id that's ALREADY in the store means this
  // round/commit was already resolved. The deterministic id (Conviction stamps
  // one per round) turns "resolved once" into a durable, checkable fact — unlike
  // a component ref, it survives panel remounts (dev StrictMode double-mount, a
  // reopen, an async re-render). Gating generation on it makes the whole resolve
  // idempotent at the source: exactly ONE continuation + ONE merge per round, no
  // wasted regeneration. (The ad-hoc commit path has no id, so it never trips.)
  const mergeAlreadyCommitted = !!(proposedMerge?.id && narrative?.merges?.[proposedMerge.id]);
  // Chosen seed location, for the compact Advanced summary.
  const selectedSeedLoc = seedLocationId ? narrative?.locations[seedLocationId] ?? null : null;
  // NOTE: the `if (!narrative) return null` guard lives AFTER every hook below —
  // hooks must run in the same order every render. Derived values used by those
  // hooks are kept null-safe so they read cleanly when narrative is absent.

  const headIndex = state.resolvedEntryKeys.length - 1;
  const headKey = state.resolvedEntryKeys[headIndex];
  const headEntry = headKey && narrative ? resolveEntry(narrative, headKey) : null;
  const currentArc =
    headEntry?.kind === "scene" && narrative?.arcs[headEntry.arcId]
      ? narrative.arcs[headEntry.arcId]
      : null;

  // ── Coordination Plan Detection ─────────────────────────────────────────────
  const activeBranchId = state.viewState.activeBranchId;
  const branchPlan = activeBranchId
    ? narrative?.branches[activeBranchId]?.coordinationPlan
    : null;
  const hasActivePlan = branchPlan && !isPlanComplete(branchPlan);
  const coordPlan = hasActivePlan ? branchPlan.plan : null;

  // Pre-compute plan values for current arc (arc indices are 1-based, currentArc=0 means "about to start arc 1")
  const planArcIndex = coordPlan ? (coordPlan.currentArc === 0 ? 1 : coordPlan.currentArc) : 0;
  const planArcNode = coordPlan ? getArcNode(coordPlan, planArcIndex) : null;
  const planArcName = planArcNode?.label ?? "";
  const planSceneCount = coordPlan ? getArcSceneCount(coordPlan, planArcIndex, 4) : 4;
  const planDirective = coordPlan && narrative ? buildPlanDirective(narrative, coordPlan, planArcIndex) : "";

  // Build coordination plan context for direct injection into generation
  const coordinationPlanContext: CoordinationPlanContext | undefined = useMemo(() => {
    if (!hasActivePlan || !coordPlan) return undefined;
    return {
      arcIndex: planArcIndex,
      arcCount: coordPlan.arcCount,
      arcLabel: planArcName || `Arc ${planArcIndex}`,
      sceneCount: planSceneCount,
      forceMode: planArcNode?.forceMode,
      directive: planDirective,
    };
  }, [hasActivePlan, coordPlan, planArcIndex, planArcName, planSceneCount, planArcNode?.forceMode, planDirective]);

  // Pre-fill form from coordination plan on mount (arc name and scene count only — direction flows in directly)
  const initializedFromPlan = useRef(false);
  useEffect(() => {
    if (hasActivePlan && !initializedFromPlan.current) {
      initializedFromPlan.current = true;
      // Pre-fill arc name from plan
      if (planArcName) {
        setArcName(planArcName);
      }
      // Pre-fill scene count from plan
      if (planSceneCount > 0) {
        setDirectionCount(planSceneCount);
      }
      // Direction is NOT pre-filled — it flows directly via coordinationPlanContext
    }
  }, [hasActivePlan, planArcName, planSceneCount]);

  // Auto-clear saved direction fields after they've guided a generation, per
  // the autoClearDirection setting (on by default). Prevents a one-off steer
  // from silently shaping every subsequent run without the user re-opting in.
  // Scene generation clears storyDirection; world expansion clears worldDirection.

  const clearSceneDirectionAfterUse = useCallback(() => {
    const s = narrative?.storySettings;
    if (!s?.autoClearDirection) return;
    if (!s.storyDirection?.trim()) return;
    dispatch({
      type: "SET_STORY_SETTINGS",
      settings: { ...s, storyDirection: "" },
    });
  }, [narrative?.storySettings, dispatch]);

  const clearWorldDirectionAfterUse = useCallback(() => {
    const s = narrative?.storySettings;
    if (!s?.autoClearDirection) return;
    if (!s.worldDirection?.trim()) return;
    dispatch({
      type: "SET_STORY_SETTINGS",
      settings: { ...s, worldDirection: "" },
    });
  }, [narrative?.storySettings, dispatch]);

  const currentMode = useMemo(
    () => (narrative ? detectCurrentMode(narrative, state.resolvedEntryKeys) : "LLL"),
    [narrative, state.resolvedEntryKeys],
  );

  // ── Continuity basis (proposed merge) ───────────────────────────────────────
  // When the panel was opened from a commit review, the proposed merge is the
  // locked basis: a Merge-shaped object carrying the pre-minted id so it can be
  // rendered into the prompt + stamped now, then persisted on success.
  const basisMerges = useMemo<Merge[]>(() => {
    if (!proposedMerge) return [];
    return [{ id: proposedMergeId, at: Date.now(), ...proposedMerge }];
  }, [proposedMerge, proposedMergeId]);
  // The streams behind the proposed merge, for the pending-merge summary.
  const proposedStreams = useMemo(
    () => (proposedMerge?.streamIds ?? []).map((id) => narrative?.streams?.[id]).filter(Boolean),
    [proposedMerge, narrative?.streams],
  );

  // Persist the proposed merge once a generation lands: create the Merge with
  // the same id stamped onto the new entry, then seal its streams. Called from
  // both the arc and world success paths.
  const commitProposedMerge = useCallback(() => {
    if (!proposedMerge) return;
    dispatch({
      type: "CREATE_MERGE",
      merge: {
        id: proposedMergeId,
        at: Date.now(),
        // Stamp the origin branch so the merge is visible on this branch and
        // its descendants only (ownership-scoped).
        branchId: state.viewState.activeBranchId ?? undefined,
        ...proposedMerge,
      },
    });
    for (const sid of proposedMerge.streamIds ?? []) {
      dispatch({ type: "COMMIT_STREAM", streamId: sid });
    }
  }, [proposedMerge, proposedMergeId, dispatch, state.viewState.activeBranchId]);

  // Automatic arc length — when the panel opens from a commit review, the scene
  // count is set once from the deterministic sublinear estimate (one stream ≈ 1
  // scene, each extra stream costs less; see suggestMergeSceneCount). The user
  // can still adjust the slider afterwards.
  useEffect(() => {
    if (!proposedMerge || mergeLengthSetRef.current) return;
    mergeLengthSetRef.current = true;
    setDirectionCount(suggestMergeSceneCount(proposedMerge));
  }, [proposedMerge]);

  // Automatic-approval auto-run — once the proposed merge is in hand, fire the arc
  // generation without waiting on a Generate click, so the Conviction Automatic
  // flow runs the continuation on its own while the GM watches the reasoning
  // stream. Once only; the panel's own loading guard prevents a re-fire.
  const autoGenFiredRef = useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoGenFiredRef.current || loading) return;
    if (!proposedMerge || !(proposedMerge.streamIds?.length > 0)) return;
    // Already resolved this round (durable check that survives remounts) — do
    // not regenerate. This is the real fix for the duplicate continuation: the
    // ref above resets on remount, the merge's existence in the store does not.
    if (mergeAlreadyCommitted) return;
    autoGenFiredRef.current = true;
    void handleGenerateArc();
    // handleGenerateArc is a stable function declaration; depending on it would
    // re-run every render, so it is intentionally omitted (the ref guards re-fire).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, proposedMerge, loading, mergeAlreadyCommitted]);

  // Suggest the arc title + direction. Merge-aware: when a merge is pending, the
  // suggestion coordinates every committed outcome into one continuation. Fills
  // the arc name and the direction field; leaves the (automatic) scene count
  // alone when a merge is pending, otherwise adopts the suggested count.
  const handleSuggestArc = useCallback(async () => {
    if (!narrative) return;
    const result = await suggestArcDirection(
      narrative,
      state.resolvedEntryKeys,
      headIndex,
      basisMerges.length > 0 ? basisMerges : undefined,
    );
    if (result.arcName) setArcName(result.arcName);
    if (result.direction) {
      setGuidanceDirection(result.direction);
      setDirection(result.direction);
    }
    // A pending merge owns the (automatic, sublinear) scene count — leave it.
    if (basisMerges.length === 0 && result.suggestedSceneCount) {
      setDirectionCount(result.suggestedSceneCount);
    }
  }, [narrative, state.resolvedEntryKeys, headIndex, basisMerges]);

  const storyMatrix = useMemo(() => {
    const presetKey =
      narrative?.storySettings?.rhythmPreset ??
      DEFAULT_STORY_SETTINGS.rhythmPreset;
    return (
      MATRIX_PRESETS.find((p) => p.key === presetKey)?.matrix ??
      DEFAULT_TRANSITION_MATRIX
    );
  }, [narrative?.storySettings?.rhythmPreset]);

  const handleSample = useCallback(() => {
    const seq = samplePacingSequence(currentMode, directionCount, storyMatrix);
    setPreviewSequence(seq);
    setAnimating(true);
  }, [currentMode, directionCount, storyMatrix]);

  // Picking a pacing preset in the Advanced modal: set the scene count, preview
  // the sequence, and close the modal so the preview/animation shows in-panel.
  const handlePickPacingPreset = useCallback(
    (preset: PacingPreset) => {
      setDirectionCount(preset.modes.length);
      setPreviewSequence(buildPresetSequence(preset));
      setAnimating(true);
      setAdvancedModalOpen(false);
    },
    [],
  );

  const handleSetStep = useCallback(
    (index: number, mode: CubeCornerKey) => {
      if (!previewSequence) return;
      const modes = previewSequence.steps.map((s) => s.mode);
      modes[index] = mode;
      setPreviewSequence(buildSequenceFromModes(modes));
      setEditingStep(null);
    },
    [previewSequence],
  );

  const handleAddStep = useCallback(() => {
    if (!previewSequence) return;
    const modes = previewSequence.steps.map((s) => s.mode);
    modes.push("LLL");
    setPreviewSequence(buildSequenceFromModes(modes));
    setDirectionCount(modes.length);
  }, [previewSequence]);

  const handleRemoveStep = useCallback(
    (index: number) => {
      if (!previewSequence || previewSequence.steps.length <= 1) return;
      const modes = previewSequence.steps
        .map((s) => s.mode)
        .filter((_, i) => i !== index);
      setPreviewSequence(buildSequenceFromModes(modes));
      setDirectionCount(modes.length);
      setEditingStep(null);
    },
    [previewSequence],
  );

  // All hooks are declared above this guard so they run in the same order on
  // every render; only after that do we bail when there is no active narrative.
  if (!narrative) return null;

  async function handleGenerateArc(opts: { repairFromRaw?: string } = {}) {
    if (!narrative) return;
    // This round/commit already produced its continuation — bail (and dismiss
    // the panel) rather than generate a duplicate arc + merge.
    if (mergeAlreadyCommitted) { onClose(); return; }
    if (!newArc && !currentArc) return;
    setLoading(true);
    setStreamText("");
    setError("");
    try {
      // Guidance direction/constraints are PER-GENERATION overrides — they
      // must NOT be persisted to story settings. Use a transient narrative
      // clone (same pattern as handleConfirmReasoningGraph).
      const currentSettings = {
        ...DEFAULT_STORY_SETTINGS,
        ...narrative.storySettings,
      };
      const narrativeForRun: NarrativeState = {
        ...narrative,
        storySettings: {
          ...currentSettings,
          storyDirection: guidanceDirection,
        },
      };

      const existingArc = !newArc ? (currentArc ?? undefined) : undefined;
      const worldBuildFocus = worldBuildFocusId
        ? narrative.worldBuilds[worldBuildFocusId]
        : undefined;

      // Cast & place (from the Advanced modal) → directives prepended to the
      // per-generation direction. Location names carry their ancestry path for
      // context; characters are "featured" (need not appear in every scene).
      const locLabel = (id: string | null | undefined): string | null => {
        if (!id || !narrative.locations[id]) return null;
        const path: string[] = [];
        const seen = new Set<string>();
        let cur: string | null | undefined = id;
        while (cur && narrative.locations[cur] && !seen.has(cur)) {
          seen.add(cur);
          path.unshift(narrative.locations[cur].name);
          cur = narrative.locations[cur].parentId;
        }
        const nm = narrative.locations[id].name;
        return path.length > 1 ? `${nm} (${path.join(" › ")})` : nm;
      };
      const charNames = (ids: string[]) =>
        ids.map((id) => narrative.characters[id]?.name).filter((n): n is string => !!n);

      // Human phrasing for a scene's opening gap (scene 1's gap rides the
      // engine's firstSceneTime option, so it's only expressed for scene 2+).
      const transitionPhrase = (unit: TimeUnit | "automatic", value: string): string | null => {
        if (unit === "automatic") return null;
        const raw = value.trim();
        const n = raw === "" ? null : Math.round(Number(raw));
        if (n === null || !Number.isFinite(n)) return `on a ${unit}-scale gap after the previous scene`;
        if (n === 0) return "concurrent with the previous scene (same moment, different vantage)";
        const abs = Math.abs(n);
        const u = abs === 1 ? unit : `${unit}s`;
        return n < 0 ? `as a flashback ${abs} ${u} before the previous scene` : `${n} ${u} after the previous scene`;
      };

      const stagingLines: string[] = [];
      if (perSceneCast) {
        for (let i = 0; i < directionCount; i++) {
          const spec = sceneSpecs[i];
          if (!spec) continue;
          const where = locLabel(spec.locationId);
          const who = charNames(spec.characterIds ?? []);
          const note = spec.direction?.trim();
          const trans = i >= 1 ? transitionPhrase(spec.timeUnit, spec.timeValue) : null;
          if (!where && who.length === 0 && !note && !trans) continue;
          const parts: string[] = [];
          if (where) parts.push(`at ${where}`);
          if (who.length) parts.push(`featuring ${who.join(", ")}`);
          if (trans) parts.push(`opening ${trans}`);
          let line = `Scene ${i + 1}:`;
          if (parts.length) line += ` ${parts.join("; ")}.`;
          if (note) line += ` ${note}`;
          stagingLines.push(line.trim());
        }
        if (stagingLines.length) {
          stagingLines.unshift("Stage these scenes as specified (any scene not listed is free):");
        }
      } else {
        const where = locLabel(seedLocationId);
        if (where) stagingLines.push(`Open this arc at ${where}. The first scene must be set there.`);
        const who = charNames(arcCharacterIds);
        if (who.length) {
          stagingLines.push(
            `Featured characters across this arc (they need not appear in every scene): ${who.join(", ")}.`,
          );
        }
      }
      const effectiveDirection = [stagingLines.join("\n"), direction].filter((s) => s.trim()).join("\n\n");

      // The opening gap rides the engine's firstSceneTime option. In per-scene
      // mode that's scene 1's own transition; in whole-arc mode it's the global
      // first-scene transition.
      const openUnit = perSceneCast ? sceneSpecs[0]?.timeUnit ?? "automatic" : firstSceneTimeUnit;
      const openValue = perSceneCast ? sceneSpecs[0]?.timeValue ?? "" : firstSceneTimeValue;

      const { scenes, arc } = await generateScenes(
        narrativeForRun,
        state.resolvedEntryKeys,
        headIndex,
        directionCount, // Use directionCount for legacy path
        effectiveDirection,
        {
          existingArc,
          pacingSequence: previewSequence ?? undefined,
          worldBuildFocus,
          coordinationPlanContext,
          basisMerges: basisMerges.length > 0 ? basisMerges : undefined,
          onReasoning: (token) => setStreamText((prev) => prev + token),
          repairFromRaw: opts.repairFromRaw,
          firstSceneTimeUnit:
            openUnit === "automatic" ? undefined : openUnit,
          firstSceneTimeValue:
            openUnit !== "automatic" && openValue.trim() !== ""
              ? Number(openValue)
              : undefined,
        },
      );
      setFailedRaw(null);
      dispatch({
        type: "BULK_ADD_SCENES",
        scenes,
        arc,
        branchId: state.viewState.activeBranchId!,
      });
      // Persist the proposed merge now that an arc extends the narrative with
      // it — created + stamped onto this arc, its streams sealed.
      commitProposedMerge();
      // Advance coordination plan if active (regardless of whether settings were changed)
      if (hasActivePlan && activeBranchId) {
        dispatch({ type: "ADVANCE_COORDINATION_PLAN", branchId: activeBranchId });
      }
      clearSceneDirectionAfterUse();
      onGenerated?.();
      onClose();
    } catch (err) {
      logError("Manual scene generation failed", err, {
        source: "manual-generation",
        operation: "generate-scenes",
        details: {
          sceneCount: directionCount,
          newArc,
        },
      });
      setError(String(err));
      if (err && typeof err === 'object' && 'raw' in err && typeof (err as { raw: unknown }).raw === 'string') {
        setFailedRaw({ kind: 'scenes', raw: (err as { raw: string }).raw });
      } else {
        setFailedRaw(null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSuggestWorld() {
    if (!narrative) return;
    setSuggesting(true);
    setError("");
    try {
      const suggestion = await suggestWorldExpansion(
        narrative,
        state.resolvedEntryKeys,
        headIndex,
        worldSize,
      );
      setWorldDirective(suggestion);
    } catch (err) {
      logError("World expansion suggestion failed", err, {
        source: "world-expansion",
        operation: "suggest-expansion",
        details: { worldSize },
      });
      setError(String(err));
    } finally {
      setSuggesting(false);
    }
  }

  // Expansion goes directly from directive to creative material — no
  // intermediate CRG review step. The directive IS the plan.


  // Quick expand without reasoning (for exact size or when user skips planning)
  async function handleExpandWorld(opts: { repairFromRaw?: string } = {}) {
    if (!narrative) return;
    // Same idempotency guard as the arc path — a re-fired resolve must not
    // fold the same merge into a second expansion.
    if (mergeAlreadyCommitted) { onClose(); return; }
    setLoading(true);
    setStreamText("");
    setError("");
    try {
      const expansion = await expandWorld(
        narrative,
        state.resolvedEntryKeys,
        headIndex,
        worldDirective,
        worldSize,
        {
          onReasoning: (token) => setStreamText((prev) => prev + token),
          entityFilter,
          repairFromRaw: opts.repairFromRaw,
          basisMerges: basisMerges.length > 0 ? basisMerges : undefined,
        },
      );
      setFailedRaw(null);
      dispatch({
        type: "EXPAND_WORLD",
        worldBuildId: nextId("WB", Object.keys(narrative.worldBuilds)),
        branchId: state.viewState.activeBranchId!,
        basisMergeIds: basisMerges.length > 0 ? basisMerges.map((m) => m.id) : undefined,
        summary: expansion.summary,
        characters: expansion.characters,
        locations: expansion.locations,
        artifacts: expansion.artifacts,
        threads: expansion.threads,
        threadDeltas: expansion.threadDeltas,
        worldDeltas: expansion.worldDeltas,
        systemDeltas: expansion.systemDeltas,
        relationshipDeltas: expansion.relationshipDeltas,
        ownershipDeltas: expansion.ownershipDeltas,
        tieDeltas: expansion.tieDeltas,
        attributions: expansion.attributions,
        attributionEdges: expansion.attributionEdges,
      });

      // Persist the proposed merge now that an expansion extends the narrative
      // with it — created + stamped onto this world-build, its streams sealed.
      commitProposedMerge();
      clearWorldDirectionAfterUse();
      onClose();
    } catch (err) {
      logError("World expansion generation failed", err, {
        source: "world-expansion",
        operation: "expand-world",
        details: {
          worldSize,
          directiveLength: worldDirective.length,
        },
      });
      setError(String(err));
      if (err && typeof err === 'object' && 'raw' in err && typeof (err as { raw: unknown }).raw === 'string') {
        setFailedRaw({ kind: 'world', raw: (err as { raw: string }).raw });
      } else {
        setFailedRaw(null);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleRepair() {
    if (!failedRaw) return;
    if (failedRaw.kind === 'scenes') {
      handleGenerateArc({ repairFromRaw: failedRaw.raw });
    } else {
      handleExpandWorld({ repairFromRaw: failedRaw.raw });
    }
  }

  function handleRetry() {
    setFailedRaw(null);
    // Re-run whichever path produced the failure.
    if (failedRaw?.kind === 'world' || mode === 'world') {
      handleExpandWorld();
    } else {
      handleGenerateArc();
    }
  }

  const showPreview = !!previewSequence && mode === "arc" && !loading && narrative.storySettings?.usePacingChain;

  return (
    <>
    <Modal onClose={loading ? () => {} : onClose} size="xl" maxHeight="90vh">
      <ModalHeader onClose={onClose} hideClose={loading}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Generate</h2>
        </div>
      </ModalHeader>
      <ModalBody className="p-6 space-y-4">
        {/* Mode tabs */}
        <Segmented<Mode>
          options={[
            { label: "Generate Arc", value: "arc" },
            { label: "Expand World", value: "world" },
          ]}
          value={mode}
          onChange={(v) => {
            setMode(v);
            setError("");
            setPreviewSequence(null);
          }}
          disabled={loading}
        />

        {loading ? (
          <StreamingOutput
            label={
              mode === "arc"
                ? newArc
                  ? "Generating arc"
                  : "Continuing arc"
                : "Expanding world"
            }
            text={streamText}
          />
        ) : showPreview ? (
          /* ── Pacing Preview (editable) ─────────────────────────── */
          <div className="flex flex-col gap-4">
            {/* Graph centered */}
            <div className="flex justify-center">
              <MarkovGraph
                sequence={previewSequence}
                startMode={currentMode}
                animating={animating}
                onAnimationDone={() => setAnimating(false)}
                width={240}
                height={240}
              />
            </div>

            {/* Editable strip — animated on first render, then editable */}
            {animating ? (
              <PacingStrip sequence={previewSequence} animating={animating} />
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center flex-wrap gap-1.5">
                  {previewSequence.steps.map((step, i) => (
                    <div key={i} className="relative flex items-center">
                      {i > 0 && (
                        <span className="text-text-dim/30 text-[13px] font-light select-none mx-0.5">
                          →
                        </span>
                      )}
                      <button
                        data-step-idx={i}
                        onClick={() =>
                          setEditingStep(editingStep === i ? null : i)
                        }
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-all ${editingStep === i ? "ring-1 ring-white/30" : "hover:ring-1 hover:ring-white/15"}`}
                        style={{
                          backgroundColor: `${CORNER_COLORS[step.mode]}15`,
                        }}
                      >
                        <CubeBadge mode={step.mode} size="sm" />
                        <span
                          className="text-[10px] font-semibold leading-none whitespace-nowrap"
                          style={{ color: CORNER_COLORS[step.mode] }}
                        >
                          {NARRATIVE_CUBE[step.mode].name}
                        </span>
                      </button>
                      {/* Dropdown picker */}
                      {editingStep === i &&
                        (() => {
                          // Use a portal-style ref to position the dropdown in fixed space
                          const btn = document.querySelector(
                            `[data-step-idx="${i}"]`,
                          );
                          const rect = btn?.getBoundingClientRect();
                          return (
                            <>
                              {/* Backdrop to close on outside click */}
                              <div
                                className="fixed inset-0 z-60"
                                onClick={() => setEditingStep(null)}
                              />
                              <div
                                className="fixed z-61 bg-bg-base border border-white/10 rounded-lg shadow-xl p-1 w-36"
                                style={
                                  rect
                                    ? { top: rect.bottom + 4, left: rect.left }
                                    : undefined
                                }
                              >
                                {ALL_CORNERS.map((corner) => (
                                  <button
                                    key={corner}
                                    onClick={() => handleSetStep(i, corner)}
                                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition ${
                                      corner === step.mode
                                        ? "bg-white/10"
                                        : "hover:bg-white/5"
                                    }`}
                                  >
                                    <CubeBadge mode={corner} size="sm" />
                                    <span
                                      className="text-[10px] font-medium"
                                      style={{ color: CORNER_COLORS[corner] }}
                                    >
                                      {NARRATIVE_CUBE[corner].name}
                                    </span>
                                  </button>
                                ))}
                                {previewSequence.steps.length > 1 && (
                                  <>
                                    <div className="h-px bg-white/6 my-1" />
                                    <button
                                      onClick={() => handleRemoveStep(i)}
                                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[10px] text-red-400/70 hover:bg-red-500/10 transition"
                                    >
                                      Remove step
                                    </button>
                                  </>
                                )}
                              </div>
                            </>
                          );
                        })()}
                    </div>
                  ))}
                  {/* Add step */}
                  <button
                    onClick={handleAddStep}
                    className="w-6 h-6 rounded border border-dashed border-white/15 text-text-dim hover:text-text-primary hover:border-white/30 transition flex items-center justify-center text-[11px]"
                    title="Add step"
                  >
                    +
                  </button>
                </div>
                <p className="text-[10px] text-text-dim leading-snug">
                  {previewSequence.pacingDescription}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setPreviewSequence(null)}
                disabled={animating}
                className="text-[11px] text-text-dim hover:text-text-secondary transition disabled:opacity-30 mr-auto"
              >
                &larr; Back
              </button>
              <button
                onClick={handleSample}
                disabled={animating}
                className="h-9 px-3 rounded-lg border border-white/8 text-text-dim hover:text-text-primary hover:border-white/15 transition disabled:opacity-30 flex items-center gap-1.5 text-[11px]"
                title="Reroll from transition matrix"
              >
                <IconDice size={14} />
                Reroll
              </button>
              <button
                onClick={() => handleGenerateArc()}
                disabled={animating}
                className="h-9 px-5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30 text-[12px]"
              >
                Generate →
              </button>
            </div>
          </div>
        ) : (
          /* ── Configuration ──────────────────────────────────── */
          <div className="flex flex-col gap-4">
            {/* Pending merge — the proposed commit this generation will fold in.
                Locked basis (rendered into the prompt); persisted + stamped onto
                the produced arc / world-build only once generation succeeds. */}
            {proposedMerge && (
              <div className="rounded-lg border border-purple-400/30 bg-purple-500/8 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <IconMerge size={12} className="text-purple-300" />
                  <span className="text-[10px] uppercase tracking-widest text-purple-200">
                    {proposedMerge.label || "Pending merge"}
                  </span>
                  <span className="ml-auto text-[10px] text-purple-300/60">
                    folds in on generate
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {proposedStreams.map((s) => {
                    const res = proposedMerge.resolutions?.[s!.id];
                    const committed = resolutionOutcomes(res);
                    return (
                      <div key={s!.id} className="min-w-0 text-[11px]">
                        {/* Question — full width, truncates if long */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-text-dim/60 truncate">{s!.title}</span>
                          {res?.overridden && (
                            <span className="shrink-0 text-[9px] uppercase tracking-wide text-amber-400/80">
                              override
                            </span>
                          )}
                          {committed.length > 1 && (
                            <span className="shrink-0 text-[9px] uppercase tracking-wide text-purple-300/70">
                              multi
                            </span>
                          )}
                        </div>
                        {/* Committed outcome(s) — wrap as chips, never overflow */}
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {committed.length === 0 ? (
                            <span className="text-text-dim/40">—</span>
                          ) : (
                            committed.map((o) => (
                              <span
                                key={o}
                                className="rounded bg-purple-500/15 text-purple-100 px-1.5 py-0.5 leading-snug break-words"
                              >
                                {o}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] text-purple-300/50 leading-snug">
                  These resolutions are the committed reality the generation extends from;
                  the streams&apos; priors shape its direction.
                  {executiveStreamCount(proposedMerge) > 0 && (
                    <> Scene count set automatically from {executiveStreamCount(proposedMerge)} executive {executiveStreamCount(proposedMerge) === 1 ? "decision" : "decisions"} (scales sublinearly) — adjust below if needed.</>
                  )}
                </p>
              </div>
            )}
            {mode === "arc" ? (
              <>
                {/* Coordination plan indicator */}
                {hasActivePlan && coordPlan && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/20">
                    <div className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                    <span className="text-[11px] text-sky-300 font-medium">
                      Arc {planArcIndex}/{coordPlan.arcCount}
                    </span>
                    <span className="text-[10px] text-sky-300/60">
                      Plan context active — your direction adds to the plan
                    </span>
                  </div>
                )}

                {/* Arc toggle */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newArc}
                    onChange={(e) => setNewArc(e.target.checked)}
                    className="accent-white/80"
                  />
                  <span className="text-xs text-text-secondary">New arc</span>
                </label>

                {newArc ? (
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">
                      Arc Name
                    </label>
                    <input
                      type="text"
                      value={arcName}
                      onChange={(e) => setArcName(e.target.value)}
                      placeholder="e.g. The Reckoning"
                      className="bg-bg-field border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim"
                    />
                  </div>
                ) : currentArc ? (
                  <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2">
                    <span className="text-[10px] uppercase tracking-widest text-text-dim">
                      Continuing
                    </span>
                    <p className="text-sm text-text-primary">
                      {currentArc.name}
                    </p>
                  </div>
                ) : null}

                {/* Direction. The "Suggest" proposes the arc title + direction
                    together, merge-aware when a merge is pending. */}
                <GuidanceFields
                  direction={guidanceDirection}
                  onDirectionChange={(v) => {
                    setGuidanceDirection(v);
                    setDirection(v);
                  }}
                  onSuggestDirection={handleSuggestArc}
                />

                {/* Scene Count */}
                <div className="flex items-center gap-3">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim shrink-0">
                    Scenes
                  </label>
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="range"
                      min={1}
                      max={12}
                      value={directionCount}
                      onChange={(e) => setDirectionCount(Number(e.target.value))}
                      className="flex-1 h-1 appearance-none bg-white/10 rounded-full accent-white/60 cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/80 [&::-webkit-slider-thumb]:appearance-none"
                    />
                    <span className="text-xs font-medium text-text-primary w-5 text-center tabular-nums">
                      {directionCount}
                    </span>
                  </div>
                </div>

                {/* Advanced — configured in a modal, summarised compactly here */}
                <div className="pt-1">
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="h-px flex-1 bg-white/8" />
                    <button
                      onClick={() => setAdvancedModalOpen(true)}
                      className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-text-dim hover:text-text-primary transition-colors"
                    >
                      Advanced <IconChevronRight size={11} />
                    </button>
                    <div className="h-px flex-1 bg-white/8" />
                  </div>
                  {(() => {
                    const chips: { k: string; label: string }[] = [];
                    if (perSceneCast) {
                      const staged = sceneSpecs
                        .slice(0, directionCount)
                        .filter((s) => s && (s.locationId || s.characterIds?.length || s.direction?.trim())).length;
                      chips.push({ k: "cast", label: staged ? `${staged} of ${directionCount} scenes staged` : "Per-scene staging" });
                    } else {
                      if (selectedSeedLoc) chips.push({ k: "loc", label: `Opens at ${selectedSeedLoc.name}` });
                      if (arcCharacterIds.length)
                        chips.push({ k: "cast", label: `${arcCharacterIds.length} featured ${arcCharacterIds.length === 1 ? "character" : "characters"}` });
                    }
                    if (firstSceneTimeUnit !== "automatic")
                      chips.push({ k: "time", label: `${firstSceneTimeValue.trim() || "auto"}-${firstSceneTimeUnit} open` });
                    if (worldBuildFocusId && narrative.worldBuilds[worldBuildFocusId])
                      chips.push({ k: "wb", label: "World-build focus" });
                    if (previewSequence) chips.push({ k: "pace", label: "Pacing preset" });
                    if (chips.length === 0) {
                      return (
                        <button
                          onClick={() => setAdvancedModalOpen(true)}
                          className="w-full text-left text-[11px] text-text-dim/45 italic hover:text-text-dim/70 transition-colors"
                        >
                          Defaults — the model decides cast, place &amp; timing. Configure to set them.
                        </button>
                      );
                    }
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {chips.map((c) => (
                          <span
                            key={c.k}
                            className="inline-flex items-center rounded-md border border-white/8 bg-white/2 px-2 py-1 text-[10.5px] text-text-secondary"
                          >
                            {c.label}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleGenerateArc()}
                    disabled={loading || (!newArc && !currentArc)}
                    className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30"
                  >
                    Generate Arc
                  </button>
                  {narrative.storySettings?.usePacingChain && (
                    <button
                      onClick={handleSample}
                      disabled={!newArc && !currentArc}
                      className="py-2.5 px-4 rounded-lg border border-white/8 hover:bg-white/6 text-text-dim hover:text-text-primary transition disabled:opacity-30 flex items-center justify-center gap-2 text-[12px]"
                      title="Scenarios multi-arc generation"
                    >
                      <IconDice size={16} />
                      Scenarios
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* World mode */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase tracking-widest text-text-dim">
                      Directive
                    </label>
                    <button
                      onClick={handleSuggestWorld}
                      disabled={suggesting}
                      className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                    >
                      {suggesting ? "Thinking..." : "Suggest"}
                    </button>
                  </div>
                  <textarea
                    value={worldDirective}
                    onChange={(e) => setWorldDirective(e.target.value)}
                    placeholder="Describe what to add to the world..."
                    className="bg-bg-field border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-28 resize-none outline-none placeholder:text-text-dim"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">
                    Size
                  </label>
                  <div className="flex gap-1.5">
                    {[
                      {
                        value: "exact" as WorldExpansionSize,
                        label: "Exact",
                        desc: "As described",
                      },
                      {
                        value: "small" as WorldExpansionSize,
                        label: "Small",
                        desc: "~5 entities",
                      },
                      {
                        value: "medium" as WorldExpansionSize,
                        label: "Medium",
                        desc: "~12 entities",
                      },
                      {
                        value: "large" as WorldExpansionSize,
                        label: "Large",
                        desc: "~30 entities",
                      },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setWorldSize(opt.value)}
                        className={`flex-1 px-2 py-2 rounded-lg text-left transition-colors ${
                          worldSize === opt.value
                            ? "bg-white/10 ring-1 ring-white/20"
                            : "bg-white/3 hover:bg-white/6"
                        }`}
                      >
                        <div className="text-xs text-text-primary font-medium">
                          {opt.label}
                        </div>
                        <div className="text-[9px] text-text-dim">
                          {opt.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <details className="group">
                  <summary className="text-[10px] uppercase tracking-widest text-text-dim cursor-pointer select-none flex items-center gap-1 hover:text-text-secondary transition-colors">
                    <svg
                      className="w-3 h-3 transition-transform group-open:rotate-90"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                    >
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                    Advanced
                  </summary>
                  <div className="mt-2 space-y-3">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">
                        Entity Types
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { key: "characters" as const, label: "Characters" },
                          { key: "locations" as const, label: "Locations" },
                          { key: "artifacts" as const, label: "Artifacts" },
                          { key: "threads" as const, label: "Threads" },
                          {
                            key: "threadDeltas" as const,
                            label: "Thread Delta",
                          },
                          {
                            key: "worldDeltas" as const,
                            label: "World Delta",
                          },
                          { key: "systemDeltas" as const, label: "System Delta" },
                          {
                            key: "relationshipDeltas" as const,
                            label: "Relationship Delta",
                          },
                          {
                            key: "ownershipDeltas" as const,
                            label: "Ownership Delta",
                          },
                          { key: "tieDeltas" as const, label: "Tie Delta" },
                        ].map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() =>
                              setEntityFilter((prev) => ({
                                ...prev,
                                [opt.key]: !prev[opt.key],
                              }))
                            }
                            className={`px-2.5 py-1.5 rounded-lg text-[10px] transition-colors ${
                              entityFilter[opt.key]
                                ? "bg-white/10 text-text-primary ring-1 ring-white/20"
                                : "bg-white/3 text-text-dim/50 line-through"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
                {/* Single expansion action — direct from directive to
                    creative material (threads, system, entities). No CRG
                    review step: the directive IS the plan. */}
                <button
                  onClick={() => handleExpandWorld()}
                  disabled={loading}
                  className="bg-white/10 hover:bg-white/16 text-text-primary font-semibold px-4 py-2.5 rounded-lg transition disabled:opacity-30"
                >
                  {loading ? "Expanding..." : "Expand World"}
                </button>
              </>
            )}

            {error && (() => {
              const errorCaller = failedRaw?.kind === 'world' ? 'expandWorld' : 'generateScenes';
              const diagnosis = diagnoseError(error, errorCaller);
              const trace = buildErrorTrace({ caller: errorCaller, error, diagnosis });
              return (
                <div className="bg-fate/10 border border-fate/30 rounded-lg px-3 py-3 flex flex-col gap-3">
                  <ErrorDiagnosis error={error} caller={errorCaller} />
                  <details className="text-[10px] text-text-dim">
                    <summary className="cursor-pointer hover:text-text-secondary select-none">Raw error</summary>
                    <pre className="mt-2 text-fate/80 whitespace-pre-wrap font-mono leading-relaxed max-h-32 overflow-y-auto">{error}</pre>
                  </details>
                  <div className="flex items-center gap-2">
                    <CopyErrorButton trace={trace} />
                    {failedRaw && (
                      <button
                        onClick={handleRepair}
                        disabled={loading}
                        title="Send the malformed output back to the model with the diagnosed issue — cheaper than a full re-run."
                        className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-40"
                      >
                        Repair
                      </button>
                    )}
                    <button
                      onClick={handleRetry}
                      disabled={loading}
                      className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-40"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </ModalBody>
    </Modal>
    {advancedModalOpen && (
      <AdvancedSettingsModal
        sceneCount={directionCount}
        seedLocationId={seedLocationId}
        onSeedLocation={setSeedLocationId}
        perSceneCast={perSceneCast}
        onPerSceneCast={setPerSceneCast}
        arcCharacterIds={arcCharacterIds}
        onArcCharacters={setArcCharacterIds}
        sceneSpecs={sceneSpecs}
        onSceneSpecs={setSceneSpecs}
        onSceneCount={setDirectionCount}
        firstSceneTimeUnit={firstSceneTimeUnit}
        onTimeUnit={setFirstSceneTimeUnit}
        firstSceneTimeValue={firstSceneTimeValue}
        onTimeValue={setFirstSceneTimeValue}
        worldBuildFocusId={worldBuildFocusId}
        onWorldBuildFocus={setWorldBuildFocusId}
        pacingEnabled={!!narrative.storySettings?.usePacingChain}
        onPickPacingPreset={handlePickPacingPreset}
        onClose={() => setAdvancedModalOpen(false)}
      />
    )}
    </>
  );
}
