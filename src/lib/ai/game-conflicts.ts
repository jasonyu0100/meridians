/** Conviction conflict detection — the resolver's one AI step (CONCEPT.md
 *  §Contested settlement: "detect + map … flags that two committed bearings
 *  can't both hold in the canon"). Given the actions every seat committed this
 *  round, it returns the GROUPS of claims that mutually conflict — moves that
 *  cannot all be realised in the same continuation. The deterministic seeded
 *  draw then settles each group; everything else stands (and its raise refunds).
 *  This is generation → run OFF-CLOCK with the resolve blocker. */
import { ANALYSIS_MODEL } from "@/lib/constants";
import { callGenerate } from "@/lib/ai/api";
import { parseJson } from "@/lib/ai/json";

export interface ConflictClaim {
  /** Stream id — the stable handle returned in conflict groups. */
  id: string;
  /** Who is acting (perspective label). */
  perspective: string;
  /** The open question the action answers. */
  question: string;
  /** The committed action. */
  action: string;
}

const SYSTEM = `You are the resolver at a strategy table. Each perspective has committed to an ACTION this round. Decide which committed actions CONFLICT — cannot all be true together in the SAME next continuation (mutually-exclusive moves, two seats contending over the same object/position/outcome, or claims that directly negate each other). Actions that can all coexist are NOT in conflict.

Group every set of claims that cannot co-occur. A claim that conflicts with nothing appears in NO group. Use the EXACT ids given.

Output ONLY JSON: {"conflicts":[["id1","id2"],["id3","id4","id5"]]}  — each inner array is a maximal set of mutually-incompatible claim ids. Empty array if nothing conflicts.`;

/** Returns groups of conflicting claim ids (each group ≥ 2). Best-effort: on any
 *  failure it returns [] (nothing contested → claims stand, raises refund). */
export async function detectConflicts(args: {
  claims: ConflictClaim[];
  narrativeContext?: string;
  /** Thinking budget — pass `resolveReasoningBudget(narrative)`. Default 0. */
  reasoningBudget?: number;
}): Promise<string[][]> {
  if (args.claims.length < 2) return [];
  const user = [
    args.narrativeContext ? `CONTEXT (current head):\n${args.narrativeContext}\n` : "",
    "COMMITTED ACTIONS THIS ROUND:",
    ...args.claims.map((c) => `- id ${c.id} · ${c.perspective}: "${c.action}"  (deciding: ${c.question})`),
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callGenerate(user, SYSTEM, undefined, "detectConflicts", ANALYSIS_MODEL, args.reasoningBudget ?? 0);
  const parsed = parseJson(raw, "detectConflicts") as { conflicts?: unknown };
  const groups = Array.isArray(parsed.conflicts) ? parsed.conflicts : [];
  const validIds = new Set(args.claims.map((c) => c.id));
  return groups
    .map((g) =>
      Array.isArray(g) ? [...new Set(g.filter((x): x is string => typeof x === "string" && validIds.has(x)))] : [],
    )
    .filter((g) => g.length >= 2);
}
