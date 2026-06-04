"use client";

// MapComposerModal — modal for composing and generating a board/map image for a location subtree.

import { Modal, ModalBody, ModalHeader, StreamingStatus } from "@/components/Modal";
import { generateReasoningGraph } from "@/lib/ai/reasoning-graph";
import { useStore } from "@/lib/state/store";
import { logError } from "@/lib/core/system-logger";
import type { ReasoningMap } from "@/types/narrative";
import { useMemo, useState } from "react";
import type { ThinkingResource, ThinkingStyle } from "@/lib/ai";
import { ThinkingSettings } from "@/components/generation/ThinkingPicker";

type Props = {
  /** Pre-selected arc. Defaults to the arc of the currently-viewed scene. */
  initialArcId?: string;
  onClose: () => void;
  onCreate: (investigation: ReasoningMap) => void;
};

/**
 * Map composer — picks a host arc, takes a direction prompt and
 * thinking settings, then generates a reasoning graph against the narrative
 * state UP TO AND INCLUDING the arc's last scene. The resulting investigation
 * goes onto narrative.maps; the panel opens the detail view.
 */
export function MapComposerModal({ initialArcId, onClose, onCreate }: Props) {
  const { state } = useStore();
  const narrative = state.activeNarrative;

  // Arcs in resolved chronological order — based on each arc's last scene
  // position in the resolved timeline.
  const arcs = useMemo(() => {
    if (!narrative) return [];
    const lastScene = new Map<string, number>();
    state.resolvedEntryKeys.forEach((key, i) => {
      const scene = narrative.scenes[key];
      if (scene?.arcId) lastScene.set(scene.arcId, i);
    });
    return Array.from(lastScene.entries())
      .map(([arcId, lastIndex]) => {
        const arc = narrative.arcs[arcId];
        if (!arc) return null;
        return {
          id: arcId,
          name: arc.name,
          lastIndex,
        };
      })
      .filter((a): a is { id: string; name: string; lastIndex: number } => !!a)
      .sort((a, b) => a.lastIndex - b.lastIndex);
  }, [narrative, state.resolvedEntryKeys]);

  // Default to the arc of the currently-viewed scene.
  const defaultArcId = useMemo(() => {
    if (initialArcId) return initialArcId;
    const currentSceneKey = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    const currentScene = currentSceneKey ? narrative?.scenes[currentSceneKey] : null;
    return currentScene?.arcId ?? arcs[arcs.length - 1]?.id ?? "";
  }, [initialArcId, narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex, arcs]);

  const [arcId, setArcId] = useState(defaultArcId);
  const [direction, setDirection] = useState("");
  const [thinkingStyle, setThinkingStyle] = useState<ThinkingStyle>("abduction");
  const [thinkingResource, setThinkingResource] = useState<ThinkingResource>("freeform");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState("");

  const selectedArc = arcs.find((a) => a.id === arcId);
  const existingCount = useMemo(
    () => Object.values(narrative?.maps ?? {}).filter((inv) => inv.arcId === arcId).length,
    [narrative?.maps, arcId],
  );

  async function handleGenerate() {
    if (!narrative || !selectedArc) return;
    setLoading(true);
    setStreamText("");
    setError("");
    try {
      const graph = await generateReasoningGraph(
        narrative,
        state.resolvedEntryKeys,
        selectedArc.lastIndex,
        4, // compact node sizing; investigation is exploratory, not arc-length
        direction.trim(),
        selectedArc.name,
        (token) => setStreamText((prev) => prev + token),
        undefined,
        // No reasoningLevel + no networkBias — maps let the
        // model size and target its own reasoning to the request.
        { thinkingResource, thinkingStyle },
      );
      const now = Date.now();
      const investigation: ReasoningMap = {
        id: `investigation-${now}`,
        arcId: selectedArc.id,
        graph,
        direction: direction.trim(),
        source: "manual",
        settings: { thinkingResource, thinkingStyle },
        createdAt: now,
        updatedAt: now,
      };
      onCreate(investigation);
    } catch (err) {
      logError("Map generation failed", err, {
        source: "manual-generation",
        operation: "generate-investigation",
        details: { arcId: selectedArc.id },
      });
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!narrative) return null;

  return (
    <Modal onClose={loading ? () => {} : onClose} size="xl" maxHeight="90vh">
      <ModalHeader onClose={onClose} hideClose={loading}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">New Map</h2>
          <p className="text-[10px] text-text-dim mt-0.5">
            Reasons about the world through the host arc&apos;s last scene.
          </p>
        </div>
      </ModalHeader>
      <ModalBody className="p-5 space-y-4">
        {loading ? (
          <StreamingStatus label="Generating reasoning graph…" streamText={streamText} />
        ) : (
          <>
            <div>
              <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
                Host Arc
              </label>
              <select
                value={arcId}
                onChange={(e) => setArcId(e.target.value)}
                className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-xs text-text-primary w-full outline-none focus:border-white/16 transition"
              >
                {arcs.length === 0 ? (
                  <option value="">No arcs available</option>
                ) : (
                  arcs.map((a, i) => (
                    <option key={a.id} value={a.id}>
                      {i + 1}. {a.name}
                    </option>
                  ))
                )}
              </select>
              {existingCount > 0 && (
                <p className="text-[10px] text-text-dim/60 mt-1">
                  This arc already has {existingCount}{" "}
                  {existingCount === 1 ? "investigation" : "maps"}. A new one will be added.
                </p>
              )}
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
                Direction
              </label>
              <textarea
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                placeholder="What should the reasoning explore? Leave blank for an open-ended graph."
                rows={3}
                className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-xs text-text-primary w-full outline-none focus:border-white/16 transition resize-none"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
                Thinking
              </label>
              <ThinkingSettings
                mode={thinkingStyle}
                onModeChange={setThinkingStyle}
                force={thinkingResource}
                onForceChange={setThinkingResource}
              />
            </div>

            {error && (
              <div className="bg-fate/10 border border-fate/30 rounded-lg px-3 py-2">
                <p className="text-[11px] text-fate/80">{error}</p>
              </div>
            )}

            {/* Full-width primary action — matches the Generate Plan button
                in CoordinationPlanSetupModal so all "generate from this
                setup" modals share the same affordance. ESC / backdrop click
                cancel; no inline Cancel button. */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleGenerate}
                disabled={loading || !selectedArc}
                className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30"
              >
                Generate
              </button>
            </div>
          </>
        )}
      </ModalBody>
    </Modal>
  );
}
