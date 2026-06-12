/** Showdown — the reveal animation that plays on the board centre between PLAY
 *  and arc generation (CONCEPT.md §Showdown). All seats are pulled to the board
 *  to watch: every committed card flips face-up (concealed ones dramatically),
 *  and contested questions resolve TOGETHER — the competing claims clash, the
 *  seeded draw lands, and a winner is lit. One metaphor (the table); the flip +
 *  the clash are the only motion. Reads purely off the round's reveal flags +
 *  settlements + the pending merge resolutions (no recomputation here). */
"use client";
import { useEffect, useState } from "react";

import { Modal, ModalBody, ModalHeader } from "@/components/Modal";
import { RealismReview } from "@/components/shared/RealismReview";
import { perspectiveName } from "@/components/stage/RoomUI";
import type { GameRoom, NarrativeState, ResolveBias } from "@/types/narrative";

/** How each contested-thread ruleset decides a winner — surfaced so the table
 *  understands WHY a clash resolved as it did (not just that it did). */
const RESOLVE_RULE: Record<ResolveBias, { label: string; icon: string; short: string; long: string }> = {
  random: {
    label: "Draw",
    icon: "🎲",
    short: "a seeded draw, weighted by conviction",
    long: "Each claim's conviction sets its odds; a seeded (reproducible) draw then picks the winner. More conviction means better odds — but the draw, not the biggest stack, decides. Upsets happen.",
  },
  "highest-cost": {
    label: "Rarest",
    icon: "💎",
    short: "the rarest claim wins outright",
    long: "No dice — the rarest stance takes it: the longest-shot, lowest-probability claim wins outright. Improbability is the prize, so a bold low-odds call beats the safe favourite.",
  },
  realism: {
    label: "Realism",
    icon: "⚖️",
    short: "an AI judge picks the most plausible outcome",
    long: "An AI judge weighs the claims against the world's state and continuity, picks the outcome most plausible in reality, and explains its reasoning. Conviction colours but doesn't dictate.",
  },
};

interface Claim {
  seatId: string;
  seatName: string;
  color?: string;
  action: string;
  conviction: number;
  faceUp: boolean;
  forced: boolean;
  /** In a contest: did this claim's action win the draw? */
  won?: boolean;
}
interface Group {
  key: string;
  /** The open question this group of claims is answering. */
  question: string;
  contested: boolean;
  winnerOutcome?: string;
  /** Realism-judge interpretation of what happens, if this clash was judged. */
  telling?: string;
  /** Why realism resolved this way (injected reasoning). */
  reasoning?: string;
  /** true → the realism verdict CLOSES the question; false → stays open. */
  closes?: boolean;
  /** Contested outcomes + their conviction-shaped odds (aligned), from the
   *  settlement — drives the odds readout for Draw / Rarest. */
  outcomes?: string[];
  pStar?: number[];
  claims: Claim[];
}

function buildGroups(room: GameRoom, narrative: NarrativeState): Group[] {
  const round = room.round;
  if (!round) return [];
  const streamsById = narrative.streams ?? {};
  const resolutions = round.pendingMerge?.resolutions ?? {};
  // streamId → contested group key (from the contested settlements' joined ids),
  // and the settlement itself keyed by group (odds + draw, for the explanation).
  const groupKeyOf = new Map<string, string>();
  const settlementByKey = new Map<string, NonNullable<typeof round.settlements>[number]>();
  for (const s of round.settlements ?? []) {
    if (!s.contested) continue;
    settlementByKey.set(s.threadId, s);
    for (const sid of s.threadId.split("|")) groupKeyOf.set(sid, s.threadId);
  }

  // One claim per committed (stream, seat). A seat's plays on a stream fold into
  // a single claim (summed conviction, the backed action from the resolution).
  const claimByStreamSeat = new Map<string, Claim>();
  for (const hand of Object.values(round.hands)) {
    const seat = room.seats[hand.seatId];
    if (!seat) continue;
    const seatName = perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative);
    for (const p of hand.played) {
      const sid = p.card.streamId;
      const stream = streamsById[sid];
      const key = `${sid}::${hand.seatId}`;
      const action = stream?.outcomes?.[p.card.outcome] ?? `action ${p.card.outcome}`;
      const existing = claimByStreamSeat.get(key);
      if (existing) {
        existing.conviction += p.conviction;
        existing.faceUp = existing.faceUp && p.faceUp;
        existing.forced = existing.forced || !!p.forcedReveal;
      } else {
        claimByStreamSeat.set(key, {
          seatId: hand.seatId,
          seatName,
          color: seat.color,
          action,
          conviction: p.conviction,
          faceUp: p.faceUp,
          forced: !!p.forcedReveal,
        });
      }
    }
  }

  const groups = new Map<string, Group>();
  for (const [key, claim] of claimByStreamSeat) {
    const sid = key.split("::")[0];
    const gkey = groupKeyOf.get(sid);
    const winnerOutcome = resolutions[sid]?.outcome;
    const question = streamsById[sid]?.title ?? sid;
    if (gkey) {
      const st = settlementByKey.get(gkey);
      const g = groups.get(gkey) ?? { key: gkey, question, contested: true, winnerOutcome, telling: resolutions[sid]?.telling, reasoning: resolutions[sid]?.reasoning, closes: resolutions[sid]?.closes, outcomes: st?.outcomes, pStar: st?.pStar, claims: [] };
      g.winnerOutcome = winnerOutcome ?? g.winnerOutcome;
      g.telling = resolutions[sid]?.telling ?? g.telling;
      g.reasoning = resolutions[sid]?.reasoning ?? g.reasoning;
      g.closes = resolutions[sid]?.closes ?? g.closes;
      claim.won = winnerOutcome != null && claim.action === winnerOutcome;
      g.claims.push(claim);
      groups.set(gkey, g);
    } else {
      groups.set(key, { key, question, contested: false, winnerOutcome, claims: [claim] });
    }
  }
  // Contested first (the drama), then the standing claims.
  return [...groups.values()].sort((a, b) => Number(b.contested) - Number(a.contested));
}

function ClaimChip({ claim, revealed, delay }: { claim: Claim; revealed: boolean; delay: number }) {
  const concealed = !claim.faceUp;
  const show = revealed || !concealed; // open cards are visible immediately
  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-all duration-500"
      style={{
        borderColor: claim.won ? "var(--color-accent)" : "rgba(255,255,255,0.12)",
        background: claim.won ? "color-mix(in oklab, var(--color-accent) 16%, transparent)" : "rgba(255,255,255,0.03)",
        opacity: claim.won === false ? 0.5 : 1,
        transitionDelay: `${delay}ms`,
        transform: show ? "rotateY(0deg)" : "rotateY(90deg)",
      }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: claim.color }} />
      <span className="text-[11px] font-medium text-text-primary">{claim.seatName}</span>
      {concealed && (
        <span className={`text-[10px] ${claim.forced ? "text-rose-300" : "text-violet-300"}`}>
          {claim.forced ? "🂠→ forced" : "🂠"}
        </span>
      )}
      <span className="max-w-44 truncate text-[11px] text-text-secondary">
        {show ? claim.action : "concealed"}
      </span>
      <span className="ml-auto font-mono text-[11px] tabular-nums text-accent">{claim.conviction}</span>
      {claim.won && <span className="text-[10px] font-bold uppercase tracking-wider text-accent">won</span>}
    </div>
  );
}

/** Why a contested group resolved as it did, under the room's ruleset. Draw +
 *  Rarest show the conviction-shaped odds (winner highlighted — the drawn slice
 *  for Draw, the longest-shot for Rarest); Realism shows the judge's reasoning. */
function ResolutionExplain({ bias, group }: { bias: ResolveBias; group: Group }) {
  const rule = RESOLVE_RULE[bias];
  const total = (group.pStar ?? []).reduce((s, p) => s + p, 0) || 1;
  const hasOdds = bias !== "realism" && !!group.outcomes && !!group.pStar;
  return (
    <div className="mt-2 rounded-lg border border-white/8 bg-black/20 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
        <span>{rule.icon}</span>
        <span className="font-semibold text-text-secondary">{rule.label}</span>
        <span className="normal-case tracking-normal text-text-dim/55">· {rule.short}</span>
      </div>
      {hasOdds && (
        <div className="flex flex-col gap-1">
          {group.outcomes!.map((o, i) => {
            const pct = Math.round((group.pStar![i] / total) * 100);
            const won = o === group.winnerOutcome;
            return (
              <div key={o} className="flex items-center gap-2">
                <span className={`w-28 shrink-0 truncate text-[10px] ${won ? "font-medium text-accent" : "text-text-dim/60"}`}>{o}</span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, background: won ? "var(--color-accent)" : "rgba(255,255,255,0.18)" }}
                  />
                </div>
                <span className={`w-8 shrink-0 text-right font-mono text-[10px] tabular-nums ${won ? "text-accent" : "text-text-dim/50"}`}>{pct}%</span>
              </div>
            );
          })}
          <p className="mt-1 text-[10px] leading-snug text-text-dim/55">
            {bias === "random"
              ? `“${group.winnerOutcome}” was drawn from these conviction-weighted odds.`
              : `“${group.winnerOutcome}” was the longest shot — under Rarest, the least-likely claim takes it.`}
          </p>
        </div>
      )}
      {bias === "realism" && (
        <p className="text-[11px] leading-snug text-text-secondary">
          {group.reasoning || `The judge picked “${group.winnerOutcome}” as the most plausible.`}
        </p>
      )}
    </div>
  );
}

export function Showdown({
  room,
  narrative,
  onContinue,
  canContinue,
  onSetOutcome,
  onEditRealism,
  onRerunRealism,
}: {
  room: GameRoom;
  narrative: NarrativeState;
  onContinue: () => void;
  /** GM-only — the watch can be advanced into arc generation. */
  canContinue: boolean;
  /** GM-only — dictate / veto a contested group's winning outcome (groupKey, outcome). */
  onSetOutcome?: (groupKey: string, outcome: string) => void;
  /** GM-only — edit the realism determination (telling / reasoning / closure). */
  onEditRealism?: (groupKey: string, patch: { telling?: string; reasoning?: string; closes?: boolean }) => void;
  /** GM-only — re-run the realism judge with a steer; streams live reasoning. */
  onRerunRealism?: (guidance: string, onProgress?: (text: string) => void) => Promise<void> | void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [rerunning, setRerunning] = useState(false);
  const [rerunThinking, setRerunThinking] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setRevealed(true), 650);
    return () => clearTimeout(id);
  }, []);

  const groups = buildGroups(room, narrative);
  const contested = groups.filter((g) => g.contested).length;
  const generating = !!room.round?.generating;
  const bias = room.economy.resolveBias;
  const rule = RESOLVE_RULE[bias];

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 p-8">
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.4em] text-accent/80">Showdown</span>
        <span className="text-center text-[12px] text-text-dim/70">
          {groups.length === 0
            ? "no commitments this round"
            : `${groups.length} claim${groups.length === 1 ? "" : "s"} revealed`}
          {contested > 0 && (
            <>
              {" · "}
              <span className="text-text-secondary">{contested} clash{contested === 1 ? "" : "es"}</span>
              {" resolved by "}
              <button
                type="button"
                onClick={() => setRulesOpen(true)}
                className="font-medium text-accent underline decoration-dotted underline-offset-2 hover:text-accent/80"
                title="How contested claims are settled"
              >
                {rule.icon} {rule.label}
              </button>
            </>
          )}
        </span>
        {contested === 0 && groups.length > 0 && (
          <span className="text-[10px] text-text-dim/50">no clashes — every claim stands</span>
        )}
      </div>

      <div className="grid w-full max-w-3xl gap-3" style={{ perspective: "1000px" }}>
        {groups.map((g, gi) => {
          const options = g.contested ? [...new Set(g.claims.map((c) => c.action))] : [];
          return (
            <div
              key={g.key}
              className={`rounded-xl border p-3 ${g.contested ? "border-accent/25 bg-accent/5" : "border-white/8 bg-white/2"}`}
            >
              <div className="mb-2">
                <p className="text-[13px] font-medium leading-snug text-text-primary">{g.question}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className={`text-[10px] uppercase tracking-wider ${g.contested ? "text-accent/70" : "text-text-dim/55"}`}>
                    {g.contested ? "contested — resolved together" : "stands — committed to the resolution"}
                  </span>
                  {g.contested && g.winnerOutcome && revealed && (
                    <span className="text-[11px] text-text-secondary">
                      → <span className="font-medium text-accent">{g.winnerOutcome}</span>
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {g.claims.map((c, ci) => (
                  <ClaimChip key={`${c.seatId}-${ci}`} claim={c} revealed={revealed} delay={gi * 150 + ci * 100} />
                ))}
              </div>
              {/* How + why this clash resolved under the active ruleset. */}
              {g.contested && revealed && <ResolutionExplain bias={bias} group={g} />}
              {/* Realism verdict — the in-world telling the continuation will honour. */}
              {g.contested && g.telling && revealed && (
                <p className="mt-2 rounded-lg border border-white/8 bg-black/20 px-2.5 py-1.5 text-[11px] leading-snug text-text-secondary">
                  <span className="font-semibold text-accent/80">Verdict — </span>{g.telling}
                </p>
              )}
              {/* GM dictates / vetoes the winning outcome for this clash. */}
              {g.contested && onSetOutcome && revealed && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/8 pt-2">
                  <span className="text-[10px] uppercase tracking-wider text-text-dim/55">GM sets outcome</span>
                  {options.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => onSetOutcome(g.key, o)}
                      className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
                        g.winnerOutcome === o
                          ? "border-accent bg-accent/20 text-accent"
                          : "border-border-subtle text-text-secondary hover:border-accent/60 hover:text-text-primary"
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && <div className="text-center text-[12px] text-text-dim/60">No commitments this round.</div>}
      </div>

      {canContinue && (
        <div className="flex items-center gap-2">
          {onEditRealism && contested > 0 && (
            <button
              type="button"
              onClick={() => setReviewOpen(true)}
              disabled={!revealed}
              className="rounded-lg border border-sky-400/30 px-4 py-2 text-[12px] font-medium text-sky-200 transition hover:bg-sky-500/10 disabled:opacity-40"
            >
              Review realism
            </button>
          )}
          <button
            type="button"
            onClick={onContinue}
            disabled={!revealed}
            className="rounded-lg bg-accent px-4 py-2 text-[12px] font-semibold text-white shadow-sm shadow-accent/30 transition hover:bg-accent/90 disabled:opacity-40"
          >
            Continue to resolution ▸
          </button>
        </div>
      )}

      {/* Ruleset explainer — what Draw / Rarest / Realism mean, the active one
          highlighted. Opened from the header so anyone can learn how clashes
          settle without leaving the table. */}
      {rulesOpen && (
        <Modal onClose={() => setRulesOpen(false)} size="md">
          <ModalHeader onClose={() => setRulesOpen(false)}>How clashes settle</ModalHeader>
          <ModalBody>
            <p className="mb-3 text-[12px] leading-relaxed text-text-dim/70">
              When two seats back the same question with different actions, it&apos;s a clash. The room&apos;s ruleset decides the
              winner — the GM sets it in the room rules. This room uses <span className="font-medium text-accent">{rule.label}</span>.
            </p>
            <div className="flex flex-col gap-2">
              {(Object.keys(RESOLVE_RULE) as ResolveBias[]).map((k) => {
                const r = RESOLVE_RULE[k];
                const active = k === bias;
                return (
                  <div
                    key={k}
                    className={`rounded-lg border p-3 ${active ? "border-accent/40 bg-accent/8" : "border-white/8 bg-white/2"}`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span>{r.icon}</span>
                      <span className="text-[13px] font-semibold text-text-primary">{r.label}</span>
                      {active && (
                        <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-accent/90">
                          this room
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed text-text-secondary">{r.long}</p>
                  </div>
                );
              })}
            </div>
          </ModalBody>
        </Modal>
      )}

      {/* Realism review popup — the SAME editable preprocessing view the GM gets
          in the narrative merge UI (shared RealismReview). Edits write straight
          onto the round's pending merge; re-run re-prompts the judge. */}
      {reviewOpen && onEditRealism && (
        <Modal onClose={() => setReviewOpen(false)} size="lg">
          <ModalHeader onClose={() => setReviewOpen(false)}>Review realism — what reality resolved to</ModalHeader>
          <ModalBody>
            <RealismReview
              items={groups
                .filter((g) => g.contested)
                .map((g) => ({
                  id: g.key,
                  question: g.question,
                  outcome: g.winnerOutcome ?? "",
                  telling: g.telling ?? "",
                  reasoning: g.reasoning ?? "",
                  closes: !!g.closes,
                }))}
              onEdit={(id, patch) => onEditRealism(id, patch)}
              guidance={guidance}
              onGuidanceChange={setGuidance}
              onReRun={async () => {
                if (!onRerunRealism) return;
                setRerunning(true);
                setRerunThinking("");
                try {
                  await onRerunRealism(guidance, setRerunThinking);
                } finally {
                  setRerunning(false);
                }
              }}
              busy={rerunning || generating}
              thinking={rerunThinking}
            />
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}
