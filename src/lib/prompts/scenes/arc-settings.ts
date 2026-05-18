/**
 * Arc-settings prompt block — compact scene-execution translation of the
 * settings under which the arc's CRG was constructed (force preference,
 * reasoning mode, network bias).
 *
 * The verbose CRG-side blocks (`forcePreferenceBlock("arc"|"plan")`,
 * `reasoningModeBlock`, `networkBiasBlock`) talk about how to BUILD a
 * graph. Scenes EXECUTE the graph, so they need a different translation
 * of the same settings — one focused on how to render scenes coherently
 * with the arc's bias. Keeping this scene-side helper separate keeps the
 * scene prompt focused; reusing the CRG-side blocks verbatim would flood
 * the prompt with node-construction instructions scenes don't act on.
 *
 * The block is the visible mechanism by which CRG and scene generation
 * stay synced — the same settings drive both stages, but each stage gets
 * the language appropriate to its layer.
 */

import type { ArcSettings } from "@/lib/ai/reasoning-graph/types";

/**
 * Render an `<arc-settings>` block for the scene prompt. Returns "" when
 * no settings would be expressed (default run with neutral bias) so the
 * prompt doesn't carry empty scaffolding.
 */
export function buildArcSettingsBlock(settings: ArcSettings | undefined): string {
  if (!settings) return "";
  const lines: string[] = [];
  if (settings.thinkingResource) {
    lines.push(`    ${FORCE_PREFERENCE_LINE[settings.thinkingResource]}`);
  }
  if (settings.thinkingStyle) {
    lines.push(`    ${REASONING_MODE_LINE[settings.thinkingStyle]}`);
  }
  if (settings.networkBias && settings.networkBias !== "neutral") {
    lines.push(`    ${NETWORK_BIAS_LINE[settings.networkBias]}`);
  }
  if (lines.length === 0) return "";

  return `<arc-settings hint="Settings under which the arc's CRG was constructed. Scenes execute the arc — inherit the same biases at the scene level so structure and execution stay aligned. The CRG already encodes these decisions; restating them here keeps every stage of the pipeline pulling in the same direction.">
${lines.join("\n")}
  </arc-settings>`;
}

const FORCE_PREFERENCE_LINE: Record<NonNullable<ArcSettings["thinkingResource"]>, string> = {
  fate: `<force-preference name="fate">Scenes prioritise THREAD MOVEMENT — every scene advances, escalates, or closes a thread the CRG references. Climaxes are thread transitions; setup scenes seed new markets. Thread deltas should be the densest force channel.</force-preference>`,
  world: `<force-preference name="world">Scenes prioritise ENTITY TRANSFORMATION — characters, locations, artifacts deepening or shifting. Inner change, accruing relationships, places gaining history. World deltas (especially POV-character) should be the densest force channel.</force-preference>`,
  system: `<force-preference name="system">Scenes prioritise RULE SURFACING — the world's mechanics asserting themselves, principles tested, constraints biting. System deltas should be the densest force channel; surface existing SYS nodes by edge wherever the scene touches a rule.</force-preference>`,
  chaos: `<force-preference name="chaos">Scenes prioritise BLACK-SWAN MOVES — disclose new pieces the prior state wouldn't have predicted, or flip saturating markets via twist-grade evidence. Each chaos beat should either spawn a new entity (creative) or commit twist evidence (reversal).</force-preference>`,
  freeform: `<force-preference name="freeform">No force bias — pick the densest channel the scene actually earns. Avoid letting one channel dominate every scene by default; vary across the arc.</force-preference>`,
};

const REASONING_MODE_LINE: Record<NonNullable<ArcSettings["thinkingStyle"]>, string> = {
  freeform: `<reasoning-mode name="freeform">The CRG was built without an imposed thinking shape — the chain follows whatever inference pattern the model's own chain of thought produced. Scenes should respect the CRG's shape as-is rather than assuming a single dominant direction.</reasoning-mode>`,
  abduction: `<reasoning-mode name="abduction">The CRG was built BACKWARD from a committed terminal. Scenes should converge on the terminal — the arc's last scene is the load-bearing one; earlier scenes are the prerequisites the terminal demands. Don't drift into divergent exploration mid-arc.</reasoning-mode>`,
  divergent: `<reasoning-mode name="divergent">The CRG branches forward into multiple possibilities. Scenes should preserve branching — leave room for downstream selection rather than collapsing every thread early. Resist the pull to commit to one resolution before the arc earns it.</reasoning-mode>`,
  deduction: `<reasoning-mode name="deduction">The CRG follows a necessary-consequence chain forward from premises. Scenes should land in chained order — each scene's deltas should be the strict consequence of the prior scene's. Avoid surprising deltas the CRG didn't earn.</reasoning-mode>`,
  induction: `<reasoning-mode name="induction">The CRG generalises from many observations to a shared principle. Scenes should accumulate observations — each scene contributes a piece of evidence toward the inferred pattern. The arc's payoff is the moment the principle clicks; don't reveal it prematurely.</reasoning-mode>`,
};

const NETWORK_BIAS_LINE: Record<"inside" | "outside", string> = {
  inside: `<network-bias name="inside">Lean into the gravitational centres — reuse hot/warm characters, locations, threads the CRG already touches. Cold-cohort selections need explicit CRG anchoring; don't introduce neglected pieces unless the brief calls them up.</network-bias>`,
  outside: `<network-bias name="outside">Reactivate the neglected. Prefer cold/dormant characters and locations the CRG names; bring fresh-rising matter on-screen so seeds compound. Hot pieces are allowed when structurally unavoidable but should not anchor every scene.</network-bias>`,
};
