/** Conviction cast suggestion — the AI call that proposes WHO to seat at a new
 *  rehearsal table. Given the world's roster (characters, locations, artifacts,
 *  each tagged by prominence) plus a synopsis of the most recent story, it picks
 *  the ACTIVE players: the entities carrying live agency and stakes right now.
 *  Characters lead; a location or artifact is seated only when it is itself a
 *  load-bearing player (a contested place, a powerful object with pull on the
 *  conflict). Ids are chosen strictly from the provided roster — the caller
 *  validates them against the live entity records before seating. */
import { PREDICTIVE_MODEL } from "@/lib/constants";
import { callGenerate } from "@/lib/ai/api";
import { parseJson } from "@/lib/ai/json";

export type CastKind = "character" | "location" | "artifact";

export interface CastSuggestion {
  id: string;
  kind: CastKind;
  reason: string;
}

const SYSTEM = `You are seating a CONVICTION rehearsal table — a strategy game where each seat is a player with its own agency, stakes, and moves. Choose WHO belongs at the table for a rehearsal of the most recent story.

Pick the ACTIVE players: the entities driving the live conflict right now, the ones with real decisions to make. Read the RECENT STORY for who is currently in motion; read the ★ marks for who appeared in recent scenes.

Rules:
- CHARACTERS lead — most seats should be characters with present agency and opposing or entangled interests (rivals, allies-in-tension, decision-makers).
- Seat a LOCATION or ARTIFACT only when it is itself a load-bearing player — a contested place that shapes the conflict, or a powerful object with pull on it. Not mere set-dressing.
- Prefer entities tagged with higher prominence (anchor / domain / key) and those marked ★ active, but you may include a lower-tagged entity if the recent story makes it pivotal.
- Choose 3–6 players that genuinely tension against each other. A table needs friction, not a list of the most important names.
- Use ONLY the ids given in the ROSTER, exactly as written. Never invent an id.

Output ONLY JSON: {"picks":[{"id":"<roster id>","kind":"character|location|artifact","reason":"<one short clause: why this player, what's at stake for them>"}]}`;

export async function suggestTableCast(args: {
  roster: string;
  recentSynopsis?: string;
}): Promise<CastSuggestion[]> {
  const user = [
    args.recentSynopsis ? `RECENT STORY (most recent first-to-last):\n${args.recentSynopsis}` : "",
    `ROSTER (pick ids from here only; ★ = appeared in recent scenes):\n${args.roster}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callGenerate(
    user,
    SYSTEM,
    undefined,
    "suggestTableCast",
    PREDICTIVE_MODEL,
    0,
  );
  const parsed = parseJson(raw, "suggestTableCast") as { picks?: unknown };

  const picks = Array.isArray(parsed.picks) ? parsed.picks : [];
  const out: CastSuggestion[] = [];
  for (const p of picks) {
    if (!p || typeof p !== "object") continue;
    const { id, kind, reason } = p as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim()) continue;
    if (kind !== "character" && kind !== "location" && kind !== "artifact") continue;
    out.push({ id: id.trim(), kind, reason: typeof reason === "string" ? reason.trim() : "" });
  }
  return out;
}
