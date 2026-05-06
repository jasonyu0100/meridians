/**
 * Game-theoretic scene analysis — a purely additive, post-hoc layer.
 *
 * Given a scene's beat plan + optional prose + participant context, decompose
 * the scene into a sequence of 2×2 games. Does NOT mutate the scene's deltas,
 * threadLogs, or payoffMatrices — writes only to scene.gameAnalysis.
 */

import { callGenerateStream, resolveReasoningBudget } from "./api";
import { parseJson } from "./json";
import { buildGameTheorySystemPrompt, buildGameTheoryUserPrompt } from "@/lib/prompts/scenes/game-theory";
import { DEFAULT_MODEL } from "@/lib/constants";
import { logError, logInfo } from "@/lib/system-logger";
import { resolvePlanForBranch, resolveProseForBranch } from "@/lib/narrative-utils";
import {
  ACTION_AXIS_LABELS,
  GAME_TYPE_LABELS,
} from "@/types/narrative";
import type {
  ActionAxis,
  BeatGame,
  GameOutcome,
  GameType,
  NarrativeState,
  PlayerAction,
  Scene,
  SceneGameAnalysis,
} from "@/types/narrative";

type RawGame = Record<string, unknown>;

// Sourced from the canonical label maps so the sanitiser tracks type-level
// changes automatically.
const VALID_AXES: ReadonlySet<ActionAxis> = new Set(
  Object.keys(ACTION_AXIS_LABELS) as ActionAxis[],
);

const VALID_GAME_TYPES: ReadonlySet<GameType> = new Set(
  Object.keys(GAME_TYPE_LABELS) as GameType[],
);

function coerceAxis(v: unknown): ActionAxis {
  if (typeof v !== "string") return "pressure";
  const s = v.trim().toLowerCase() as ActionAxis;
  return VALID_AXES.has(s) ? s : "pressure";
}

function coerceGameType(v: unknown): GameType {
  if (typeof v !== "string") return "pure-opposition";
  const s = v.trim().toLowerCase() as GameType;
  return VALID_GAME_TYPES.has(s) ? s : "pure-opposition";
}

/** Clamp stake delta to integer in [-4, +4]. */
function coerceStake(v: unknown): number {
  const n = typeof v === "number" ? Math.round(v) : 0;
  return Math.max(-4, Math.min(4, isFinite(n) ? n : 0));
}

/** Parse a PlayerAction entry; rejects empty names. */
function coerceAction(v: unknown): PlayerAction | null {
  const c = (v ?? {}) as Record<string, unknown>;
  const name = typeof c.name === "string" ? c.name.trim() : "";
  if (!name) return null;
  return { name };
}

/**
 * Parse a single outcome cell. Returns null only if the action names are
 * missing entirely; otherwise coerces description + stake deltas defensively.
 */
function coerceOutcome(v: unknown): GameOutcome | null {
  const c = (v ?? {}) as Record<string, unknown>;
  const aActionName = typeof c.aActionName === "string" ? c.aActionName.trim() : "";
  const bActionName = typeof c.bActionName === "string" ? c.bActionName.trim() : "";
  if (!aActionName || !bActionName) return null;
  return {
    aActionName,
    bActionName,
    description: typeof c.description === "string" ? c.description : "",
    stakeDeltaA: coerceStake(c.stakeDeltaA),
    stakeDeltaB: coerceStake(c.stakeDeltaB),
  };
}

/**
 * Build the scene context block the analyser reads:
 * participants with names + roles, beat plan with indices, optional prose.
 */
function buildSceneContext(
  narrative: NarrativeState,
  scene: Scene,
  branchId: string | null,
): string {
  const branches = narrative.branches;
  const plan = branchId ? resolvePlanForBranch(scene, branchId, branches) : undefined;
  const prose = branchId
    ? resolveProseForBranch(scene, branchId, branches).prose
    : undefined;

  const parts: string[] = [];
  parts.push(`SCENE ${scene.id}`);
  parts.push(`SUMMARY: ${scene.summary}`);
  parts.push("");

  // ── PARTICIPANTS table — the authoritative ID registry for this scene ──
  // Every playerAId/playerBId the LLM emits MUST be drawn from this list.
  parts.push("PARTICIPANTS — use these exact IDs for playerAId / playerBId:");
  parts.push("  ID                KIND        NAME");
  const seen = new Set<string>();
  const pushRow = (id: string, kind: string, name: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    parts.push(`  ${id.padEnd(17)} ${kind.padEnd(11)} ${name}`);
  };
  for (const pid of scene.participantIds ?? []) {
    const c = narrative.characters[pid];
    const l = narrative.locations[pid];
    const a = narrative.artifacts[pid];
    if (c) pushRow(pid, "character", c.name);
    else if (l) pushRow(pid, "location", l.name);
    else if (a) pushRow(pid, "artifact", a.name);
  }
  if (scene.povId) {
    const pov = narrative.characters[scene.povId];
    if (pov) pushRow(scene.povId, "character", `${pov.name} (POV)`);
  }
  // Also surface the scene's location so location-as-force games are legal
  if (scene.locationId) {
    const loc = narrative.locations[scene.locationId];
    if (loc) pushRow(scene.locationId, "location", `${loc.name} (setting)`);
  }
  if (seen.size === 0) {
    parts.push("  (none — this scene has no listed participants; return empty games array)");
  }
  parts.push("");

  // Source hierarchy — prose is the authoritative text (what actually
  // happened). Fall back to the plan when prose isn't generated yet, and
  // to structural deltas when neither exists. Always pick exactly one
  // source so the analyser isn't torn between plan-indexed beats and
  // prose-segmented beats.
  const trimmedProse = prose?.trim() ?? "";
  if (trimmedProse) {
    parts.push("PROSE:");
    parts.push(trimmedProse);
  } else if (plan?.beats?.length) {
    parts.push(`BEAT PLAN (${plan.beats.length} beats):`);
    plan.beats.forEach((b, i) => {
      parts.push(`[${i}] (${b.fn}/${b.mechanism}) ${b.what}`);
      const props = b.propositions ?? [];
      if (props.length > 0) {
        parts.push(`    propositions (${props.length}):`);
        for (const p of props) {
          parts.push(`      - ${p.content}`);
        }
      }
    });
  } else {
    parts.push("SCENE STRUCTURE (no prose or plan available — analyse from deltas + summary):");
    if (scene.events?.length) {
      parts.push(`Events: ${scene.events.join(", ")}`);
    }
    if (scene.threadDeltas?.length) {
      parts.push("Thread movements:");
      for (const td of scene.threadDeltas) {
        const desc = narrative.threads[td.threadId]?.description ?? td.threadId;
        const moves = (td.updates ?? [])
          .map((u) => `${u.outcome}${u.evidence >= 0 ? '+' : ''}${u.evidence}`)
          .join(' ');
        parts.push(`  - ${desc} [${td.logType}] ${moves}`);
      }
    }
    if (scene.worldDeltas?.length) {
      parts.push("World reveals:");
      for (const wd of scene.worldDeltas) {
        const ent =
          narrative.characters[wd.entityId] ??
          narrative.locations[wd.entityId] ??
          narrative.artifacts[wd.entityId];
        const name = ent?.name ?? wd.entityId;
        for (const n of wd.addedNodes ?? []) {
          parts.push(`  - ${name}: ${n.content}`);
        }
      }
    }
    if (scene.relationshipDeltas?.length) {
      parts.push("Relationship shifts:");
      for (const rd of scene.relationshipDeltas) {
        const fromName =
          narrative.characters[rd.from]?.name ??
          narrative.locations[rd.from]?.name ??
          rd.from;
        const toName =
          narrative.characters[rd.to]?.name ??
          narrative.locations[rd.to]?.name ??
          rd.to;
        parts.push(`  - ${fromName} → ${toName}: ${rd.type} (Δ ${rd.valenceDelta})`);
      }
    }
  }

  return parts.join("\n");
}

/**
 * Resolve a player reference to a REAL entity ID. Tries an exact ID match
 * first, then case-insensitive name match against characters/locations/
 * artifacts. Returns null when the reference doesn't correspond to any
 * entity — callers drop the game rather than smuggling invented IDs through.
 */
function resolvePlayerId(
  rawId: unknown,
  rawName: unknown,
  narrative: NarrativeState,
): { id: string; name: string } | null {
  const tryDirect = (s: string): { id: string; name: string } | null => {
    if (!s) return null;
    if (narrative.characters[s]) return { id: s, name: narrative.characters[s].name };
    if (narrative.locations[s]) return { id: s, name: narrative.locations[s].name };
    if (narrative.artifacts[s]) return { id: s, name: narrative.artifacts[s].name };
    return null;
  };
  const tryName = (s: string): { id: string; name: string } | null => {
    if (!s) return null;
    const lower = s.toLowerCase();
    for (const c of Object.values(narrative.characters)) {
      if (c.name?.toLowerCase() === lower) return { id: c.id, name: c.name };
    }
    for (const l of Object.values(narrative.locations)) {
      if (l.name?.toLowerCase() === lower) return { id: l.id, name: l.name };
    }
    for (const a of Object.values(narrative.artifacts)) {
      if (a.name?.toLowerCase() === lower) return { id: a.id, name: a.name };
    }
    return null;
  };

  const id = typeof rawId === "string" ? rawId.trim() : "";
  const name = typeof rawName === "string" ? rawName.trim() : "";
  // Prefer ID lookup, then name lookup. Never fall back to the raw string.
  return tryDirect(id) ?? tryName(name) ?? tryName(id) ?? null;
}

function warn(
  message: string,
  detail: string,
  details: Record<string, string | number>,
): void {
  logError(message, new Error(detail), {
    source: "analysis",
    operation: "sanitise",
    details,
  }, "warning");
}

function sanitiseGame(raw: RawGame, narrative: NarrativeState): BeatGame | null {
  const beatIndex = typeof raw.beatIndex === "number" ? raw.beatIndex : -1;
  if (beatIndex < 0) {
    warn(
      "game-analysis: dropped game with invalid beatIndex",
      `invalid beatIndex: ${String(raw.beatIndex)}`,
      { beatIndex: String(raw.beatIndex ?? "(missing)"), narrativeId: narrative.id },
    );
    return null;
  }

  // ── Players ──
  const a = resolvePlayerId(raw.playerAId, raw.playerAName, narrative);
  const b = resolvePlayerId(raw.playerBId, raw.playerBName, narrative);
  if (!a || !b || a.id === b.id) {
    warn(
      "game-analysis: dropped game with invalid or duplicate players",
      `unresolved players: A=${String(raw.playerAId ?? raw.playerAName)} B=${String(raw.playerBId ?? raw.playerBName)}`,
      {
        beatIndex,
        playerAId: String(raw.playerAId ?? "(missing)"),
        playerAName: String(raw.playerAName ?? "(missing)"),
        playerBId: String(raw.playerBId ?? "(missing)"),
        playerBName: String(raw.playerBName ?? "(missing)"),
      },
    );
    return null;
  }

  // ── Action menus (1-4 per player) ──
  const rawAActions = Array.isArray(raw.playerAActions) ? raw.playerAActions : [];
  const rawBActions = Array.isArray(raw.playerBActions) ? raw.playerBActions : [];
  const playerAActions = rawAActions
    .map(coerceAction)
    .filter((x): x is PlayerAction => x !== null)
    .slice(0, 4);
  const playerBActions = rawBActions
    .map(coerceAction)
    .filter((x): x is PlayerAction => x !== null)
    .slice(0, 4);
  if (playerAActions.length < 1 || playerBActions.length < 1) {
    warn(
      "game-analysis: dropped game with empty action menu",
      `A=${playerAActions.length}, B=${playerBActions.length} actions`,
      { beatIndex, aCount: playerAActions.length, bCount: playerBActions.length },
    );
    return null;
  }
  // Dedupe action names within each menu (case-sensitive exact match)
  const aNames = new Set<string>();
  const dedupedA = playerAActions.filter((act) => {
    if (aNames.has(act.name)) return false;
    aNames.add(act.name);
    return true;
  });
  const bNames = new Set<string>();
  const dedupedB = playerBActions.filter((act) => {
    if (bNames.has(act.name)) return false;
    bNames.add(act.name);
    return true;
  });

  // ── Outcomes (complete NxM grid) ──
  const rawOutcomes = Array.isArray(raw.outcomes) ? raw.outcomes : [];
  const parsedOutcomes = rawOutcomes
    .map(coerceOutcome)
    .filter((o): o is GameOutcome => o !== null)
    // Only keep outcomes whose action names exist in the respective menus
    .filter((o) => aNames.has(o.aActionName) && bNames.has(o.bActionName));

  // Dedupe by (aActionName, bActionName) — last write wins
  const outcomeMap = new Map<string, GameOutcome>();
  for (const o of parsedOutcomes) {
    outcomeMap.set(`${o.aActionName}::${o.bActionName}`, o);
  }
  const outcomes = Array.from(outcomeMap.values());

  const expected = dedupedA.length * dedupedB.length;
  if (outcomes.length !== expected) {
    warn(
      "game-analysis: dropped game with incomplete outcome grid",
      `expected ${expected} cells (${dedupedA.length}×${dedupedB.length}), got ${outcomes.length}`,
      {
        beatIndex,
        expectedCells: expected,
        actualCells: outcomes.length,
        aMenu: dedupedA.length,
        bMenu: dedupedB.length,
      },
    );
    return null;
  }

  // ── Realized cell ──
  const asStr = (v: unknown, fallback = ""): string =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;
  const realizedAAction = asStr(raw.realizedAAction);
  const realizedBAction = asStr(raw.realizedBAction);
  if (!aNames.has(realizedAAction) || !bNames.has(realizedBAction)) {
    warn(
      "game-analysis: dropped game with invalid realized action",
      `realizedA='${realizedAAction}' realizedB='${realizedBAction}' — not in menus`,
      {
        beatIndex,
        realizedAAction: realizedAAction || "(missing)",
        realizedBAction: realizedBAction || "(missing)",
      },
    );
    return null;
  }

  return {
    beatIndex,
    beatExcerpt: asStr(raw.beatExcerpt),
    gameType: coerceGameType(raw.gameType),
    actionAxis: coerceAxis(raw.actionAxis),
    playerAId: a.id,
    playerAName: a.name,
    playerAActions: dedupedA,
    playerBId: b.id,
    playerBName: b.name,
    playerBActions: dedupedB,
    outcomes,
    realizedAAction,
    realizedBAction,
    rationale: asStr(raw.rationale),
  };
}

/**
 * Analyse a single scene and produce a SceneGameAnalysis.
 *
 * Streams tokens + reasoning as they arrive so the UI can show the AI
 * pondering the decisions in real time.
 */
export async function generateSceneGameAnalysis(
  narrative: NarrativeState,
  scene: Scene,
  branchId: string | null,
  onToken?: (token: string, accumulated: string) => void,
  onReasoning?: (token: string, accumulated: string) => void,
): Promise<SceneGameAnalysis> {
  logInfo("Starting game-theory analysis", {
    source: "analysis",
    operation: "analyse-scene",
    details: { narrativeId: narrative.id, sceneId: scene.id },
  });

  const systemPrompt = buildGameTheorySystemPrompt();
  const userPrompt = buildGameTheoryUserPrompt(buildSceneContext(narrative, scene, branchId));

  const reasoningBudget = resolveReasoningBudget(narrative);

  let fullText = "";
  let fullReasoning = "";

  const raw = await callGenerateStream(
    userPrompt,
    systemPrompt,
    (token) => {
      fullText += token;
      onToken?.(token, fullText);
    },
    undefined,
    "generateSceneGameAnalysis",
    DEFAULT_MODEL,
    reasoningBudget,
    (token) => {
      fullReasoning += token;
      onReasoning?.(token, fullReasoning);
    },
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = parseJson(raw, `generateSceneGameAnalysis:${scene.id}`) as Record<
      string,
      unknown
    >;
  } catch (err) {
    logError("Failed to parse game-analysis response", err, {
      source: "analysis",
      operation: "parse",
      details: { sceneId: scene.id },
    });
    throw err;
  }

  const rawGames = Array.isArray(parsed.games) ? (parsed.games as RawGame[]) : [];
  const games = rawGames
    .map((g) => sanitiseGame(g, narrative))
    .filter((g): g is BeatGame => g !== null)
    .sort((x, y) => x.beatIndex - y.beatIndex);

  const summary =
    typeof parsed.summary === "string" ? parsed.summary : undefined;

  return {
    games,
    generatedAt: Date.now(),
    summary,
  };
}
