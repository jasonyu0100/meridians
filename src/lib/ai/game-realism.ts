/** Realism conflict resolution — the impartial-AI-judge call shared by BOTH the
 *  Conviction game (the `realism` RESOLVE_BIAS) and the general narrative MERGE
 *  UI (when several streams commit competing actions/outcomes on the future).
 *
 *  When two or more committed claims about what happens next can't all hold, this
 *  dedicated, high-context call preprocesses them into ONE realistic resolution:
 *  given the world and the competing actions, what would REALISTICALLY occur?
 *  Conviction (when present) is weighed as the INTENSITY OF INTENT behind a
 *  claim — not a vote and not a coin flip. The judge is impartial and applies the
 *  engine's universal reasoning disciplines (surface-vs-substrate, read-the-
 *  mechanisms, pivot-check) so the same standard of reasoning governs both
 *  surfaces. The result is GM-vetoable upstream and rewrites how the merge reads:
 *  each resolution carries a TELLING (what actually happens) the continuation
 *  must honour. Repair/Diagnose-wired like every other gen fn. */
import { PREDICTIVE_MODEL } from "@/lib/constants";
import { callGenerate, callGenerateStream } from "@/lib/ai/api";
import { parseJson } from "@/lib/ai/json";
import { PRINCIPLES_UNIVERSAL_DISCIPLINES } from "@/lib/prompts/principles";

export interface RealismClaim {
  /** Who is asserting this — a seat/perspective name (or "—" in the general UI). */
  claimant: string;
  /** The committed action / outcome on the contested question (verbatim). */
  action: string;
  /** Conviction behind it, if the surface prices intent (Conviction game). */
  conviction?: number;
}
export interface RealismConflict {
  /** Caller key (stream id / contested-group key) — echoed back for mapping. */
  id: string;
  /** The contested open question / topic the claims compete over. */
  question: string;
  claims: RealismClaim[];
  /** When set, the winning outcome is ALREADY decided (a chance roll / a rule /
   *  a prior GM choice). The judge INTERPRETS reality around it (telling +
   *  reasoning + closure) rather than re-deciding — so realism is a universal
   *  interpretation layer over every contested merge, not only `realism` bias. */
  decidedOutcome?: string;
}
export interface RealismResolution {
  id: string;
  /** The action/outcome that realistically prevails — copied VERBATIM from one of
   *  the claims (so callers can map it back to a stance/merge resolution). The
   *  headline determination of WHAT reality resolved to, even when the situation
   *  was complex / multifaceted / dynamic (the telling carries the nuance). */
  outcome: string;
  /** A short, realism-grounded interpretation of WHAT actually happens — the
   *  collapsed result the generation engine should realise (folds in how losing
   *  intents fail / are co-opted / backfire, and how a dynamic system settled). */
  telling: string;
  /** The injected REASONING — WHY realism resolved this way (the principled call,
   *  surfaced for the engine and the GM, not just an internal note). */
  reasoning: string;
  /** Whether this resolution CLOSES the question (decisively settled — terminal,
   *  no live uncertainty remains) or leaves it OPEN (realised this beat, but the
   *  question stays live / partial / replaced by a new tension). Drives whether
   *  the stream/thread closes vs continues, identically in both surfaces. */
  closes: boolean;
}

const SYSTEM = `You are an IMPARTIAL JUDGE of what realistically happens next in a living world. Several parties have committed competing actions/outcomes on the SAME open question; they cannot all hold. Your job is to PRE-PROCESS the conflict into ONE realistic resolution per question — what would actually occur, grounded in the world as given.

Standards of reasoning (apply rigorously and identically every time):
${PRINCIPLES_UNIVERSAL_DISCIPLINES}
  • IMPARTIALITY. You favour no party. You are not voting and not flipping a coin — you are judging plausibility against the world's own logic, mechanisms, and momentum.
  • CONVICTION = INTENSITY OF INTENT. When a claim carries conviction, treat it as how hard that party pushes — it tilts outcomes that are already plausible; it does NOT make a fanciful action real. A weakly-backed but realistic action can beat a heavily-backed implausible one.
  • REALISM OVER DRAMA. Prefer the outcome the world's mechanisms and the actors' real capabilities actually produce, including messy, partial, or unintended results.

Your job is to PRE-RESOLVE complexity so the downstream generation engine gets a CLEAR determination, not a tangle. For EACH conflict:
- "outcome" — the action that prevails, copied VERBATIM from that conflict's listed actions (so it maps cleanly to a stance / merge resolution). Even when the situation is complex, multifaceted, or a dynamic system with feedback, COMMIT to one headline outcome here. NOTE: if a conflict shows a DECIDED outcome, that result is FIXED (a chance roll, a rule, or a prior GM call) — you must keep it as "outcome" and INTERPRET reality around it; do NOT substitute a different one.
- "telling" — what ACTUALLY happens: the collapsed, realistic result the engine should realise. Fold in how the losing intents fail / are co-opted / backfire, and how a dynamic system settles (partial wins, second-order effects, messy reality). This is the clarity the engine needs about what reality resolved to.
- "reasoning" — WHY realism resolved this way: the principled call, in one or two sentences, surfaced (not hidden) so the GM and engine can see the logic.
- "closes" — true if this DECISIVELY settles the question (terminal — no live uncertainty remains, the thread closes); false if reality realises this outcome but the question stays OPEN (a partial, an ongoing process, or a new tension that replaces it).

Output ONLY JSON: {"resolutions":[{"id":"<exact id>","outcome":"<verbatim action>","telling":"<1–3 sentences: what actually happens>","reasoning":"<1–2 sentences: why>","closes":<true|false>}]}`;

export async function resolveConflictRealism(args: {
  conflicts: RealismConflict[];
  /** Rich head/world context so the judgment is principled, not abstract. */
  narrativeContext?: string;
  /** Optional working-model (Mode Graph / PRG) block — the world's machinery. */
  worldContext?: string;
  /** A GM directive that influences the resolution (the prompt-driven editing
   *  workflow): re-run with a steer like "weight the institutional pressure" or
   *  "treat the merchant's claim as a bluff". Applied on top of the disciplines. */
  guidance?: string;
  /** When set, the call STREAMS — the judge's live reasoning (and, as a fallback,
   *  the answer being written) is pushed here so the UI can show the thinking
   *  during the preprocessing → review transition. */
  onProgress?: (text: string) => void;
  /** Thinking budget — pass `resolveReasoningBudget(narrative)` so the judge
   *  reasons at the story's configured depth. Defaults to 0 (no reasoning). */
  reasoningBudget?: number;
  repairFromRaw?: string;
  repairHint?: string;
}): Promise<RealismResolution[]> {
  const { conflicts } = args;
  if (conflicts.length === 0) return [];

  const conflictLines = conflicts
    .map((c) => {
      const claims = c.claims
        .map((cl) => `    · ${cl.claimant}: "${cl.action}"${cl.conviction != null ? ` (conviction ${cl.conviction})` : ""}`)
        .join("\n");
      const decided = c.decidedOutcome ? `\n  DECIDED outcome (fixed — interpret around it): "${c.decidedOutcome}"` : "";
      return `- id ${c.id} — QUESTION: ${c.question}\n  COMPETING ACTIONS:\n${claims}${decided}`;
    })
    .join("\n\n");

  const user = [
    args.narrativeContext ? `WORLD — the situation the future unfolds from:\n${args.narrativeContext}` : "",
    args.worldContext ? `WORKING MODEL — the world's operative machinery:\n${args.worldContext}` : "",
    args.guidance ? `GM STEER — weight this in your judgment (it does not override realism, but guides it):\n${args.guidance.trim()}` : "",
    `CONFLICTS TO RESOLVE — competing committed claims on the future:\n${conflictLines}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let raw: string;
  if (args.repairFromRaw) {
    raw = args.repairFromRaw;
  } else if (args.onProgress) {
    // Stream the judge's reasoning live (the thinking shown during the
    // preprocessing → review transition). Reasoning tokens are preferred; if the
    // model emits none, the answer being written is shown as a fallback.
    let reasoning = "";
    let answer = "";
    raw = await callGenerateStream(
      user,
      SYSTEM,
      (tok) => {
        answer += tok;
        if (!reasoning) args.onProgress?.(answer);
      },
      undefined,
      "resolveConflictRealism",
      PREDICTIVE_MODEL,
      args.reasoningBudget ?? 0, // story-configured thinking depth (resolveReasoningBudget)
      (rt) => {
        reasoning += rt;
        args.onProgress?.(reasoning);
      },
      0,
    );
  } else {
    raw = await callGenerate(user, SYSTEM, undefined, "resolveConflictRealism", PREDICTIVE_MODEL, args.reasoningBudget ?? 0);
  }

  // parseJson throws JsonRepairableError on unrecoverable malformed output, which
  // propagates to the caller's Repair/Diagnose surface — standard gen-fn contract.
  const parsed = parseJson(raw, "resolveConflictRealism") as { resolutions?: unknown };

  const byId = new Map(conflicts.map((c) => [c.id, c]));
  const out: RealismResolution[] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(parsed.resolutions) ? parsed.resolutions : []) {
    const r = (row ?? {}) as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const conflict = byId.get(id);
    if (!conflict || seen.has(id)) continue;
    out.push({
      id,
      // A DECIDED outcome (dice / rule / prior GM call) is fixed — the judge only
      // interprets around it. Otherwise map its pick to a real candidate.
      outcome: conflict.decidedOutcome ?? matchOutcome(str(r.outcome), conflict),
      telling: str(r.telling),
      reasoning: str(r.reasoning),
      // Conservative default — OPEN unless the judge explicitly seals the question.
      closes: r.closes === true,
    });
    seen.add(id);
  }
  return out;
}

/** Safe trimmed-string read off an unknown value. */
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Map the judge's chosen outcome back to a real candidate action: verbatim,
 *  else case-insensitive, else the highest-conviction claim (so a stance/merge
 *  resolution is always well-defined even when the model paraphrases). */
function matchOutcome(chosen: string, conflict: RealismConflict): string {
  const actions = conflict.claims.map((c) => c.action);
  const ci = actions.find((a) => a === chosen) ?? actions.find((a) => a.toLowerCase() === chosen.toLowerCase());
  const strongest = [...conflict.claims].sort((a, b) => (b.conviction ?? 0) - (a.conviction ?? 0))[0]?.action;
  return ci ?? strongest ?? actions[0];
}
