/**
 * Markdown exporters for the currently-viewed scene plan and prose. Wired into
 * the canvas top bar's Copy buttons in plan / prose modes; produces a readable
 * brief the user can paste into analysis tools or review externally.
 *
 * Plan export lays out each beat as `{fn}:{mechanism}` + `what` scaffold +
 * propositions, so the mechanism assignment (which the sampler owns) is
 * legible and auditable. Prose export prepends a small metadata header
 * (scene / version / POV / location / word counts) then the prose body.
 */

import type { NarrativeState, Scene } from "@/types/narrative";
import {
  resolvePlanForBranch,
  resolveProseForBranch,
  getEffectivePovId,
} from "@/lib/forces/narrative-utils";

export type SceneExportContext = {
  narrative: NarrativeState;
  scene: Scene;
  branchId: string;
  /** 1-based position of this scene in the active branch's timeline. */
  sceneNumber?: number;
  totalScenes?: number;
  /** Resolved version strings for display (e.g. "1.2.3"). */
  planVersion?: string;
  proseVersion?: string;
};

// ── Shared header ──────────────────────────────────────────────────────────

function sceneHeader(ctx: SceneExportContext): string[] {
  const { narrative, scene, sceneNumber, totalScenes } = ctx;
  const lines: string[] = [];
  const heading = scene.summary.split(/[.!?]\s/)[0]?.slice(0, 120) || scene.id;
  const sceneTag =
    sceneNumber && totalScenes
      ? `Scene ${sceneNumber} of ${totalScenes}`
      : `Scene ${scene.id}`;
  lines.push(`# ${narrative.title} — ${sceneTag}`);
  lines.push(`**${heading}**`);
  lines.push("");

  const povId = getEffectivePovId(scene);
  const pov = povId ? narrative.characters[povId] : null;
  const loc = narrative.locations[scene.locationId];
  const participants = (scene.participantIds ?? [])
    .map((id) => narrative.characters[id]?.name)
    .filter((n): n is string => Boolean(n));

  const bits: string[] = [];
  if (pov) bits.push(`POV: ${pov.name}`);
  if (loc) bits.push(`Location: ${loc.name}`);
  if (participants.length > 0) bits.push(`Participants: ${participants.join(", ")}`);
  if (bits.length > 0) {
    lines.push(bits.join(" · "));
    lines.push("");
  }
  return lines;
}

// ── Plan export ────────────────────────────────────────────────────────────

export function exportScenePlan(ctx: SceneExportContext): string {
  const { narrative, scene, branchId, planVersion } = ctx;
  const plan = resolvePlanForBranch(scene, branchId, narrative.branches);
  const lines: string[] = sceneHeader(ctx);

  if (!plan || !plan.beats || plan.beats.length === 0) {
    lines.push("*No plan for this scene.*");
    return lines.join("\n") + "\n";
  }

  const propTotal = plan.beats.reduce(
    (sum, b) => sum + (b.propositions?.length ?? 0),
    0,
  );
  const versionTag = planVersion ? `v${planVersion} · ` : "";
  lines.push(
    `**Plan** — ${versionTag}${plan.beats.length} beats · ${propTotal} propositions`,
  );
  lines.push("");

  plan.beats.forEach((beat, i) => {
    lines.push(`### ${i + 1}. \`${beat.fn}:${beat.mechanism}\``);
    if (beat.what) lines.push(beat.what);
    if (beat.propositions && beat.propositions.length > 0) {
      lines.push("");
      for (const p of beat.propositions) {
        const typeTag = p.type ? ` _(${p.type})_` : "";
        lines.push(`- ${p.content}${typeTag}`);
      }
    }
    lines.push("");
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ── Prose export ───────────────────────────────────────────────────────────

export function exportSceneProse(ctx: SceneExportContext): string {
  const { narrative, scene, branchId, proseVersion } = ctx;
  const resolved = resolveProseForBranch(scene, branchId, narrative.branches);
  const lines: string[] = sceneHeader(ctx);

  if (!resolved?.prose) {
    lines.push("*No prose written for this scene.*");
    return lines.join("\n") + "\n";
  }

  const text = resolved.prose;
  const words = text.split(/\s+/).filter(Boolean).length;
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim()).length;
  const versionTag = proseVersion ? `v${proseVersion} · ` : "";
  lines.push(
    `**Prose** — ${versionTag}${words.toLocaleString()} words · ${paragraphs} paragraphs`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(text.trimEnd());

  return lines.join("\n") + "\n";
}
