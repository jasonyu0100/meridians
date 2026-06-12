/** Conviction attribution — turn a played-out round into the per-thread share
 *  vectors the scorer consumes (CONCEPT.md §scoring; plan §A/§4). Attribution is
 *  RETROSPECTIVE: each committed stream's stance moved from its round-start
 *  snapshot (ℓ⁻) to its current value (ℓ⁺) as the seat's plays/priors landed,
 *  and that realized shift is credited to the seat that owns the stream. Streams
 *  are one-perspective, so an uncontested stream's whole shift goes to its owner
 *  and the Fate house band is ~0; bounded AI re-attribution (a richer pass) can
 *  later re-partition across seats for soft factors without changing this shape.
 *
 *  Pure — no LLM, no store. The hook snapshots ℓ⁻ at PLAY start into
 *  `round.threadLogitsAtStart` keyed by streamId, then calls this at SCORING. */
import { streamProbs } from "@/lib/forces/stream-stance";
import type { RoundState, Stream } from "@/types/narrative";
import type { ThreadAttribution } from "@/lib/game/scoring";

/** Map streamId → the seat that played it this round (streams are one-seat). */
export function ownerSeatByStream(round: RoundState): Map<string, string> {
  const owner = new Map<string, string>();
  for (const hand of Object.values(round.hands)) {
    for (const p of hand.played) {
      if (!owner.has(p.card.streamId)) owner.set(p.card.streamId, hand.seatId);
    }
  }
  return owner;
}

/** Build the round's ThreadAttribution[] — one entry per committed stream that
 *  moved, the realized shift credited to its owning seat. */
export function buildRoundAttribution(
  round: RoundState,
  streamsById: Record<string, Stream>,
): ThreadAttribution[] {
  const owner = ownerSeatByStream(round);
  const out: ThreadAttribution[] = [];
  for (const [streamId, seatId] of owner) {
    const stream = streamsById[streamId];
    if (!stream?.stance) continue;
    const after = stream.stance.logits;
    const before =
      round.threadLogitsAtStart?.[streamId] ??
      stream.openingLogits ??
      new Array(after.length).fill(0);
    // Align lengths defensively (a play may have introduced an outcome).
    const n = Math.max(before.length, after.length);
    const pad = (v: number[]) => (v.length === n ? v : [...v, ...Array(n - v.length).fill(-12)]);
    const lm = pad(before);
    const lp = pad(after);
    const share = lp.map((x, k) => x - lm[k]); // whole realized shift → owner
    out.push({
      threadId: streamId,
      logitsBefore: lm,
      logitsAfter: lp,
      volume: stream.stance.volume,
      shares: { [seatId]: share },
    });
  }
  return out;
}

/** Snapshot the current stance logits of a set of streams (ℓ⁻), keyed by id —
 *  call at PLAY start before any evidence lands. */
export function snapshotThreadLogits(streams: Stream[]): Record<string, number[]> {
  const snap: Record<string, number[]> = {};
  for (const s of streams) {
    snap[s.id] = (s.stance?.logits ?? s.openingLogits ?? new Array(streamProbs(s).length).fill(0)).slice();
  }
  return snap;
}
