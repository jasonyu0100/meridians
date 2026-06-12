/** Conviction chat @-mentions — pure text parsing, so the chat can highlight a
 *  tag and the shell can badge unseen mentions. A handle is a seat's display
 *  name; its first word is also an alias, so "@Harry" tags "Harry Potter". No
 *  store, no React — fully unit-testable. */

export interface SeatHandle {
  seatId: string;
  /** Display name (a seat's perspective name). */
  name: string;
}

export interface MentionSegment {
  text: string;
  /** Seat ids this @-token tags, or null for a plain (non-mention) segment. */
  seatIds: string[] | null;
}

interface Alias {
  alias: string;
  seatIds: string[];
}

/** A mention can begin at the start, after whitespace, or after an opening
 *  bracket — never mid-word (so `email@x` is not a tag). */
const startsMention = (prev: string | undefined) => prev === undefined || /[\s([]/.test(prev);
/** A mention ends at the end, whitespace, or trailing punctuation. */
const endsMention = (next: string | undefined) => next === undefined || /[\s.,!?;:'")\]]/.test(next);

function buildAliases(handles: SeatHandle[]): Alias[] {
  const map = new Map<string, Set<string>>();
  const add = (raw: string, seatId: string) => {
    const key = raw.trim().toLowerCase();
    if (!key) return;
    const set = map.get(key) ?? new Set<string>();
    set.add(seatId);
    map.set(key, set);
  };
  for (const h of handles) {
    const name = h.name.trim();
    if (!name) continue;
    add(name, h.seatId);
    const first = name.split(/\s+/)[0];
    if (first && first.toLowerCase() !== name.toLowerCase()) add(first, h.seatId);
  }
  // Longest alias first → greedy match prefers a full name over a first-name alias.
  return [...map.entries()]
    .map(([alias, ids]) => ({ alias, seatIds: [...ids] }))
    .sort((a, b) => b.alias.length - a.alias.length);
}

/** Split `text` into plain + mention segments against the known seat handles. */
export function segmentMentions(text: string, handles: SeatHandle[]): MentionSegment[] {
  const aliases = buildAliases(handles);
  if (aliases.length === 0) return text ? [{ text, seatIds: null }] : [];

  const lower = text.toLowerCase();
  const segs: MentionSegment[] = [];
  let plain = "";
  const flush = () => {
    if (plain) segs.push({ text: plain, seatIds: null });
    plain = "";
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] === "@" && startsMention(text[i - 1])) {
      const matched = aliases.find(
        (a) => lower.startsWith(a.alias, i + 1) && endsMention(text[i + 1 + a.alias.length]),
      );
      if (matched) {
        flush();
        segs.push({ text: text.slice(i, i + 1 + matched.alias.length), seatIds: matched.seatIds });
        i += 1 + matched.alias.length;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  flush();
  return segs;
}

/** The set of seat ids tagged anywhere in `text`. */
export function mentionedSeatIds(text: string, handles: SeatHandle[]): Set<string> {
  const out = new Set<string>();
  for (const seg of segmentMentions(text, handles)) {
    if (seg.seatIds) for (const id of seg.seatIds) out.add(id);
  }
  return out;
}
