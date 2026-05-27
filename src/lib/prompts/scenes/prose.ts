/**
 * Scene Prose Writer System Prompt — paradigm-aware writer identity.
 *
 * High-level identity only. Format rules, tone cue, author voice override,
 * and scene direction are passed via the user prompt
 * (buildSceneProseUserPrompt) so this prompt stays a stable role statement.
 *
 * When `paradigm` is provided, the writer role is shaped per paradigm
 * (debate stenographer, chronicler, reference curator, essayist, etc.). The
 * paradigm-shape directive itself is injected at priority 1 of the user
 * prompt so the writer sees WHAT THE OUTPUT IS, not just what register to
 * adopt.
 */

import type { FormatInstructionSet } from "../prose/format-instructions";
import type { NarrativeParadigm } from "@/types/narrative";
import { composeWorkIdentity } from "../paradigm";

export type SceneProseSystemPromptArgs = {
  formatInstructions: FormatInstructionSet;
  narrativeTitle: string;
  /** Paradigm — selects the writer's craft identity. When omitted, falls back
   *  to a paradigm-neutral identity that does not lean fiction. */
  paradigm?: NarrativeParadigm;
  /** Primary genre. Concretises the paradigm (e.g. fantasy, biography,
   *  counterfactual, trial, daily-diary). */
  genre?: string;
  /** Specific subgenre — the strongest trained-association cue
   *  (progression-fantasy, Pepys-style daily diary, hostile acquisition,
   *  Mughal-succession counterfactual). */
  subgenre?: string;
  /** @deprecated Tone cue moved to user prompt; kept for call-site compatibility. */
  worldSummary?: string;
  /** @deprecated Voice override moved to user prompt; kept for call-site compatibility. */
  proseVoiceOverride?: string;
  /** @deprecated Scene direction moved to user prompt; kept for call-site compatibility. */
  direction?: string;
};

export function buildSceneProseSystemPrompt(
  args: SceneProseSystemPromptArgs,
): string {
  // ONE identity claim that fuses paradigm + genre + subgenre into the META.
  // Format-rules block (output form) and paradigm-shape directive (what this
  // scene IS) both live in the user prompt — compounding identity claims in
  // the system prompt only blurs the cue.
  const identity = composeWorkIdentity({
    title: args.narrativeTitle,
    paradigm: args.paradigm,
    genre: args.genre,
    subgenre: args.subgenre,
  });
  return `${identity} Follow the paradigm-shape directive, prose profile, output-format rules, and scene direction in the user prompt; render exactly one scene.`;
}
