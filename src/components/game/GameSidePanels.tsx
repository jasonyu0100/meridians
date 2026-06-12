/** Conviction right-rail panel bodies (GameShell). Like the narrative
 *  inspector, the icon rail toggles these: the live Ranking (Fate moved), table
 *  Chat, and the Streams ledger — the per-seat belief artifacts the game creates
 *  and updates each phase (openStream on the deal, applyStreamPrior on a play,
 *  committed into a Merge at RESOLVE). All theme-token skinned. */
"use client";
import { useEffect, useMemo, useRef, useState } from "react";

import { IconChevronDown, IconChevronRight, IconClose, IconGlobe, IconMapPin, IconSend, IconSignals } from "@/components/icons";
import { Modal, ModalBody, ModalHeader } from "@/components/Modal";
import { EmptyState } from "@/components/shared/EmptyState";
import { PerspectiveAvatar, PerspectivePairBadge, ScoreRevealBanner, StreamStateIcon, perspectiveName } from "@/components/stage/RoomUI";
import { StreamCard, StreamDetail } from "@/components/stage/StreamsView";
import { outlineContext } from "@/lib/ai/context";
import { suggestQuestion, suggestIntuition } from "@/lib/ai/streams";
import { resolveAgentById, resolveAgentPersona } from "@/lib/agents/personas";
import { convictionCeiling } from "@/lib/game/economy";
import { fateScore } from "@/lib/game/scoring";
import { segmentMentions, type SeatHandle } from "@/lib/game/mentions";
import { streamProbs, streamTrajectory } from "@/lib/forces/stream-stance";
import { streamsForBranch, mergesForBranch } from "@/lib/merges";
import { useStore } from "@/lib/state/store";
import type { Arc, GameRoom, NarrativeState, Seat } from "@/types/narrative";

const SECTION = "text-[9px] uppercase tracking-[0.18em] text-text-dim/70";

export function RankingPanel({ room, narrative }: { room: GameRoom; narrative: NarrativeState }) {
  const ranked = [...Object.values(room.seats)].sort((a, b) => b.fateImpact - a.fateImpact);
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className={SECTION}>Ranking · Fate score</div>
      <div className="flex flex-col gap-1.5">
        {ranked.map((s, i) => {
          const score = fateScore(s.fateImpact); // 0–100 cumulative contribution
          return (
            <div key={s.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-3 text-text-dim/50 tabular-nums">{i + 1}</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 truncate text-text-secondary">
                  {perspectiveName(narrative.perspectives?.[s.perspectiveId], narrative)}
                </span>
                <span className="font-mono tabular-nums text-accent">{score}</span>
              </div>
              <div className="ml-5 h-1 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full" style={{ width: `${score}%`, background: s.color }} />
              </div>
            </div>
          );
        })}
        {/* Fate the WORLD moved on its own — the uncontrolled residual, shown
            against the seats so the table reads how much was outside anyone's play. */}
        {(room.fateHouseBand ?? 0) > 0.0049 && (
          <div className="mt-1 flex flex-col gap-1 border-t border-white/8 pt-2">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="w-3 text-text-dim/40">~</span>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-text-dim/40" />
              <span className="flex-1 truncate text-text-dim/60" title="Fate moved by the world itself — outside any seat's control">
                Fate · outside forces
              </span>
              <span className="font-mono tabular-nums text-text-dim/60">{fateScore(room.fateHouseBand ?? 0)}</span>
            </div>
            <div className="ml-5 h-1 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full bg-text-dim/30" style={{ width: `${fateScore(room.fateHouseBand ?? 0)}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Conviction chat — a messenger thread with a CONVERSATION SWITCHER at top:
 *  GLOBAL table talk (persists the whole game) and LOCATION whispers (ephemeral —
 *  only the CURRENT round is shown, so an adversary can't read a place's history).
 *  A player sees Global + their own place; the GM sees Global + every occupied
 *  place. Avatars are image-aware; the composer pins to the bottom. */
export function ChatPanel({
  room,
  narrative,
  actAsSeatId,
  onSend,
}: {
  room: GameRoom;
  narrative: NarrativeState;
  actAsSeatId: string | null;
  onSend: (seatId: string, text: string, scope: "global" | "location", locationId?: string) => void;
}) {
  const [text, setText] = useState("");
  const [convo, setConvo] = useState<string>("global"); // "global" | locationId
  const endRef = useRef<HTMLDivElement>(null);

  const seatName = (seatId: string) =>
    perspectiveName(narrative.perspectives?.[room.seats[seatId]?.perspectiveId], narrative);
  const locNameOf = (id?: string) => (id ? narrative.locations[id]?.name ?? "this place" : undefined);

  const actSeat = actAsSeatId ? room.seats[actAsSeatId] : null;
  const myLoc = actSeat?.locationId;
  const isGM = !actAsSeatId;
  const roundIndex = room.round?.index ?? -1;

  // Conversations the viewer may open: Global always; then locations — a player
  // gets only their own place, the GM gets every occupied place (+ any with a
  // whisper this round).
  const conversations = useMemo(() => {
    const list: { id: string; name: string; location: boolean }[] = [{ id: "global", name: "Global", location: false }];
    const ids = new Set<string>();
    if (isGM) {
      for (const s of Object.values(room.seats)) if (s.locationId) ids.add(s.locationId);
      for (const m of room.chat) if (m.scope === "location" && m.roundIndex === roundIndex && m.locationId) ids.add(m.locationId);
    } else if (myLoc) {
      ids.add(myLoc);
    }
    for (const id of ids) list.push({ id, name: locNameOf(id) ?? "here", location: true });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.seats, room.chat, isGM, myLoc, roundIndex]);

  const active = conversations.some((c) => c.id === convo) ? convo : "global";
  const isLocation = active !== "global";

  // The active conversation's messages. Location chat is round-scoped (ephemeral).
  const msgs = room.chat
    .filter((m) =>
      active === "global"
        ? m.scope === "global"
        : m.scope === "location" && m.locationId === active && m.roundIndex === roundIndex,
    )
    .sort((a, b) => a.at - b.at);

  // Send only when acting as a seat AND (global, or this is the seat's own place).
  const canSend = !!actAsSeatId && (!isLocation || active === myLoc);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length, active]);

  const send = () => {
    if (!canSend || !actAsSeatId || !text.trim()) return;
    onSend(actAsSeatId, text.trim(), isLocation ? "location" : "global", isLocation ? active : undefined);
    setText("");
    setMention(null);
  };

  // Seated players → @-mention handles (for highlighting + autocomplete).
  const handles: SeatHandle[] = useMemo(
    () => Object.values(room.seats).map((s) => ({ seatId: s.id, name: seatName(s.id) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.seats, narrative.perspectives],
  );

  // @-autocomplete: the in-progress @token immediately before the caret.
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; q: string } | null>(null);
  const onType = (value: string, caret: number) => {
    setText(value);
    const upto = value.slice(0, caret);
    const at = upto.lastIndexOf("@");
    const ok = at !== -1 && !/\s/.test(upto.slice(at + 1)) && (at === 0 || /[\s([]/.test(value[at - 1]));
    setMention(ok ? { start: at, q: upto.slice(at + 1) } : null);
  };
  const suggestions = mention
    ? handles
        .filter((h) => h.seatId !== actAsSeatId && h.name.toLowerCase().includes(mention.q.toLowerCase()))
        .slice(0, 6)
    : [];
  const pickMention = (h: SeatHandle) => {
    if (!mention) return;
    const caret = taRef.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${h.name} ${text.slice(caret)}`;
    const pos = mention.start + h.name.length + 2;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Conversation switcher — Global ↔ location(s) */}
      <div className="shrink-0 border-b border-white/8 px-3 py-2">
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {conversations.map((c) => {
            const on = c.id === active;
            return (
              <button
                key={c.id}
                onClick={() => setConvo(c.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  on
                    ? c.location
                      ? "bg-violet-500/25 text-text-primary"
                      : "bg-accent/25 text-text-primary"
                    : "text-text-dim hover:bg-white/5 hover:text-text-secondary"
                }`}
              >
                {c.location ? <IconMapPin size={11} /> : <IconGlobe size={11} />}
                {c.name}
              </button>
            );
          })}
        </div>
        {isLocation && (
          <p className="mt-1.5 px-1 text-[9px] leading-relaxed text-violet-300/70">
            🔒 Whispers here are private to this place and clear at the end of the round.
          </p>
        )}
      </div>

      {/* Messages — newest at the bottom, image-aware avatars + bubbles. */}
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-3">
        {msgs.length === 0 && (
          <p className="m-auto text-[11px] text-text-dim/50">
            {isLocation ? "No whispers here this round." : "No table talk yet — say something."}
          </p>
        )}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const seat = room.seats[m.seatId];
          const persp = narrative.perspectives?.[seat?.perspectiveId];
          const isSelf = m.seatId === actAsSeatId;
          // Group consecutive messages from the same seat (within 5 min).
          const grouped = !!prev && prev.seatId === m.seatId && m.at - prev.at < 5 * 60_000;
          const bubble = isSelf
            ? isLocation
              ? "bg-violet-500/30 text-text-primary"
              : "bg-accent/25 text-text-primary"
            : "bg-white/6 text-text-secondary";

          return (
            <div
              key={m.id}
              className={`flex items-end gap-2 ${isSelf ? "flex-row-reverse" : ""} ${grouped ? "mt-px" : "mt-1.5"}`}
            >
              {/* Avatar gutter — a spacer keeps grouped rows aligned. */}
              <div className="w-7 shrink-0">
                {!grouped && <PerspectiveAvatar perspective={persp} n={narrative} size={28} />}
              </div>
              <div className={`flex max-w-[78%] flex-col gap-0.5 ${isSelf ? "items-end" : "items-start"}`}>
                {!grouped && (
                  <span className={`flex items-center gap-1.5 px-1 text-[9px] ${isSelf ? "flex-row-reverse" : ""}`}>
                    {!isSelf && (
                      <span className="font-medium" style={{ color: seat?.color }}>
                        {seatName(m.seatId)}
                      </span>
                    )}
                    <span className="tabular-nums text-text-dim/45">{hhmm(m.at)}</span>
                  </span>
                )}
                <div title={clock(m.at)} className={`rounded-2xl px-3 py-1.5 text-[12px] leading-relaxed ${bubble}`}>
                  {segmentMentions(m.text, handles).map((seg, k) =>
                    seg.seatIds ? (
                      <span
                        key={k}
                        className={`rounded px-0.5 font-semibold ${
                          actAsSeatId && seg.seatIds.includes(actAsSeatId)
                            ? "bg-amber-400/30 text-amber-100" // you were tagged
                            : isSelf
                              ? "text-white/90 underline decoration-white/40"
                              : "text-accent"
                        }`}
                      >
                        {seg.text}
                      </span>
                    ) : (
                      <span key={k}>{seg.text}</span>
                    ),
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Composer — pinned to the bottom, tinted to the active conversation. */}
      <div className="relative shrink-0 border-t border-border p-2.5">
        {canSend ? (
          <div className="flex items-end gap-2">
            {/* @-mention autocomplete — floats above the input. */}
            {suggestions.length > 0 && (
              <div className="absolute inset-x-2.5 bottom-full mb-1 overflow-hidden rounded-lg border border-white/10 bg-bg-base/95 shadow-lg backdrop-blur-sm">
                <div className="px-2.5 py-1 text-[8px] uppercase tracking-widest text-text-dim/50">Tag a player</div>
                {suggestions.map((h) => (
                  <button
                    key={h.seatId}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickMention(h);
                    }}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-text-secondary transition hover:bg-white/8 hover:text-text-primary"
                  >
                    <PerspectiveAvatar perspective={narrative.perspectives?.[room.seats[h.seatId]?.perspectiveId]} n={narrative} size={20} />
                    <span className="truncate">{h.name}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => onType(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              onKeyUp={(e) => onType(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && suggestions.length) {
                  setMention(null);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (suggestions.length) pickMention(suggestions[0]);
                  else send();
                }
              }}
              rows={1}
              placeholder={
                isLocation ? `Whisper to ${locNameOf(active)}… (@ to tag)` : `Speak as ${seatName(actAsSeatId!)}… (@ to tag)`
              }
              className="flex-1 resize-none rounded-lg border border-border bg-white/5 px-3 py-2 text-xs text-text-primary placeholder:text-text-dim transition-colors focus:border-white/20 focus:outline-none"
            />
            <button
              onClick={send}
              disabled={!text.trim()}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition disabled:opacity-40 ${
                isLocation ? "bg-violet-500 hover:bg-violet-400" : "bg-accent hover:bg-accent/90"
              }`}
              title="Send"
            >
              <IconSend size={12} />
            </button>
          </div>
        ) : (
          <span className="text-[10px] text-text-dim/60">
            {isLocation
              ? isGM
                ? "Whispers here are read-only for the GM — act as a player at this place to speak."
                : "Only players at this place can whisper here."
              : "Act as a seat to speak at the table."}
          </span>
        )}
      </div>
    </div>
  );
}

export function StreamsPanel({
  room,
  narrative,
  actAsSeatId,
}: {
  room: GameRoom;
  narrative: NarrativeState;
  actAsSeatId: string | null;
}) {
  const streams = streamsForBranch(narrative, room.branchId);
  const mergeCount = Object.values(narrative.merges ?? {}).filter((m) => m.branchId === room.branchId).length;
  // Perspective-filtered: a seated player sees only its own streams; the GM (no
  // seat) sees the whole ledger.
  const seats = Object.values(room.seats).filter((s) => (actAsSeatId ? s.id === actAsSeatId : true));
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div className={SECTION}>Streams ledger</div>
        <span className="text-[9px] font-mono text-text-dim/50">
          {actAsSeatId ? "your streams" : `${streams.length} streams · ${mergeCount} merges`}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {seats.map((seat) => {
          const own = streams.filter((s) => s.perspectiveId === seat.perspectiveId);
          if (own.length === 0) return null;
          return (
            <div key={seat.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: seat.color }} />
                <span className="text-[10px] font-medium text-text-secondary">
                  {perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative)}
                </span>
              </div>
              {own.map((s) => {
                const probs = streamProbs(s);
                let topIdx = 0;
                for (let k = 1; k < probs.length; k++) if (probs[k] > probs[topIdx]) topIdx = k;
                return (
                  <div key={s.id} className="ml-3.5 rounded-md border border-white/8 bg-white/2 p-2">
                    <div className="flex items-start gap-1.5">
                      <StreamStateIcon state={s.state} size={12} />
                      <span className="flex-1 text-[11px] leading-snug text-text-primary">{s.title}</span>
                    </div>
                    {s.outcomes?.[topIdx] && (
                      <div className="mt-1 flex items-center justify-between text-[10px] text-text-dim">
                        <span className="truncate">→ {s.outcomes[topIdx]}</span>
                        <span className="font-mono tabular-nums">{(probs[topIdx] * 100).toFixed(0)}%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {streams.length === 0 && (
          <span className="text-[11px] text-text-dim/60">No streams yet — they’re seeded at the first deal.</span>
        )}
      </div>
    </div>
  );
}

export function convictionCeilingFor(room: GameRoom): number {
  return convictionCeiling(room.economy);
}

/** Live render of a perspective call as it streams in — the judge/narrator's
 *  reasoning above, the retelling building below, with a blinking caret. Shown
 *  until the persisted view lands (these calls are long). */
function PerspectiveStream({ live }: { live: { text: string; reasoning: string } }) {
  return (
    <div>
      {live.reasoning && (
        <div className="mb-2 rounded-lg border border-sky-400/20 bg-sky-500/5 p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-sky-300/60">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" /> Thinking
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-text-dim/70">{live.reasoning}</p>
        </div>
      )}
      <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-text-secondary">
        {live.text || <span className="italic text-text-dim/50">Composing…</span>}
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-sky-400/70 align-middle" />
      </p>
    </div>
  );
}

/** One arc's delivered perspectives — the public account, then each seat's
 *  private retelling (scoped to `seats`). Reused for the current round and every
 *  historical round, so the live brief and the archive read identically. The
 *  current arc's in-flight calls stream live via `game:perspective-stream`. */
function ArcDelivery({
  narrative,
  arc,
  seats,
  scope,
  actAsSeatId,
}: {
  narrative: NarrativeState;
  arc: Arc | undefined;
  seats: Seat[];
  scope: "public" | "private" | "both";
  actAsSeatId: string | null;
}) {
  // Live perspective streams (keyed by perspective key) for THIS arc, fed by the
  // READ phase's generation. Cleared per key on `done` (the persisted view takes
  // over). Keyed off arc.id so history arcs ignore the stream.
  const [live, setLive] = useState<Record<string, { text: string; reasoning: string }>>({});
  useEffect(() => {
    if (!arc) return;
    const onStream = (e: Event) => {
      const d = (e as CustomEvent).detail as { arcId: string; key: string; text?: string; reasoning?: string; status: "start" | "stream" | "done" };
      if (d.arcId !== arc.id) return;
      setLive((prev) => {
        if (d.status === "done") {
          const { [d.key]: _done, ...rest } = prev;
          return rest;
        }
        const cur = prev[d.key] ?? { text: "", reasoning: "" };
        return { ...prev, [d.key]: { text: d.text ?? cur.text, reasoning: d.reasoning ?? cur.reasoning } };
      });
    };
    window.addEventListener("game:perspective-stream", onStream);
    return () => window.removeEventListener("game:perspective-stream", onStream);
  }, [arc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const publicView = arc?.perspectives?.["public"];
  // Entities present anywhere in the arc — used to flag offstage deliveries.
  const arcEntities = arc
    ? new Set(
        (arc.sceneIds ?? []).flatMap((id) => {
          const s = narrative.scenes[id];
          return s ? [s.povId, ...(s.participantIds ?? [])].filter((x): x is string => !!x) : [];
        }),
      )
    : new Set<string>();

  return (
    <div className="flex flex-col gap-4">
      {/* Public */}
      {scope !== "private" && (
        <section className="rounded-xl border border-white/8 bg-white/2 p-6">
          {scope === "both" && (
            <div className="mb-3 flex items-center gap-2">
              <IconGlobe size={14} className="text-accent/80" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent/80">Public</span>
            </div>
          )}
          {publicView ? (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-text-secondary">{publicView.text}</p>
          ) : live["public"] ? (
            <PerspectiveStream live={live["public"]} />
          ) : (
            <p className="text-[13px] italic text-text-dim/50">Awaiting delivery — advance through narration.</p>
          )}
        </section>
      )}

      {/* Private per seat */}
      {scope !== "public" && seats.map((seat) => {
        const entityRef = narrative.perspectives?.[seat.perspectiveId]?.entityRef;
        const view = entityRef ? arc?.perspectives?.[entityRef] : undefined;
        const name = perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative);
        const isMe = seat.id === actAsSeatId;
        // Offstage = the seated entity isn't in the arc at all; its delivery is
        // an imagined concurrent life elsewhere, not a retelling. Flag it so a
        // reader doesn't take it as canon witnessed.
        const offstage = !!entityRef && !!arc && !arcEntities.has(entityRef);
        return (
          <section
            key={seat.id}
            className={`rounded-xl border p-6 ${isMe ? "border-accent/40 bg-accent/8" : "border-white/8 bg-white/2"}`}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seat.color }} />
              <span className="text-[13px] font-semibold text-text-primary">{name}</span>
              {isMe && (
                <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-accent/90">you</span>
              )}
              {offstage && (
                <span
                  className="ml-auto flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[9px] uppercase tracking-wider text-text-dim/60"
                  title="Not in this arc — an imagined concurrent life elsewhere, kept clear of the canon"
                >
                  <IconMapPin size={9} /> elsewhere
                </span>
              )}
            </div>
            {/* Scoring feedback — the Impact this seat earned for the round this
                arc realized, read alongside the perspective ("score reveal"). */}
            {entityRef && arc?.scoreFeedback?.[entityRef] && (
              <ScoreRevealBanner impact={arc.scoreFeedback[entityRef].impact} reason={arc.scoreFeedback[entityRef].reason} />
            )}
            {view ? (
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-text-secondary">{view.text}</p>
            ) : entityRef && live[entityRef] ? (
              <PerspectiveStream live={live[entityRef]} />
            ) : (
              <p className="text-[13px] italic text-text-dim/50">Awaiting private delivery.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Perspectives — the delivered experiences this round (CONCEPT.md narration),
 *  plus the full history beneath it. The current arc reads expanded at the top;
 *  every earlier round collapses into an accordion below (most recent first), so
 *  you can scroll back through the whole game. The public account everyone reads,
 *  then each seat's private retelling. When impersonating a seat, that seat's own
 *  private view leads and only it is shown; the GM (no seat) sees every seat —
 *  the same scoping applies to history. Mirrors the narrative Content tab. */
export function PerspectivesPanel({
  room,
  narrative,
  actAsSeatId,
  scope = "both",
}: {
  room: GameRoom;
  narrative: NarrativeState;
  actAsSeatId: string | null;
  /** Which delivery to show — a Chrome tab picks one. */
  scope?: "public" | "private" | "both";
}) {
  const round = room.round;

  // Distinct arcs delivered on this branch, in play order (round 1 → now). Each
  // Conviction round narrates one arc, so this IS the round history.
  const orderedArcs = useMemo(() => {
    const entryIds = narrative.branches[room.branchId]?.entryIds ?? [];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const id of entryIds) {
      const arcId = narrative.scenes[id]?.arcId;
      if (arcId && !seen.has(arcId)) {
        seen.add(arcId);
        ids.push(arcId);
      }
    }
    return ids.map((id) => narrative.arcs[id]).filter((a): a is Arc => !!a);
  }, [narrative, room.branchId]);

  // Current arc — the round's continuation, else the branch head (latest arc).
  const currentArc = useMemo(() => {
    if (round?.continuationSceneId) {
      const arcId = narrative.scenes[round.continuationSceneId]?.arcId;
      if (arcId && narrative.arcs[arcId]) return narrative.arcs[arcId];
    }
    return orderedArcs[orderedArcs.length - 1];
  }, [round, narrative, orderedArcs]);

  // Earlier rounds = every delivered arc before the current one, most-recent
  // first. Only arcs that actually carry a perspective show in history.
  const historyArcs = orderedArcs
    .map((a, i) => ({ arc: a, roundNo: i + 1 }))
    .filter(({ arc: a }) => a.id !== currentArc?.id && a.perspectives && Object.keys(a.perspectives).length > 0)
    .reverse();

  const currentRoundNo = currentArc ? orderedArcs.findIndex((a) => a.id === currentArc.id) + 1 : orderedArcs.length;

  // When acting AS a seat you only see your OWN private perspective (plus the
  // public one) — what that player would see at the table. The GM with no seat
  // selected sees every seat's private delivery. Same scoping flows to history.
  const seats = [...Object.values(room.seats)]
    .filter((s) => (actAsSeatId ? s.id === actAsSeatId : true))
    .sort((a, b) => (a.id === actAsSeatId ? -1 : b.id === actAsSeatId ? 1 : 0));

  // History accordions are collapsed by default; track which are open.
  const [openArcs, setOpenArcs] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpenArcs((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-7">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim/70">
          {scope === "public" ? "Public perspective" : scope === "private" ? "Private perspective" : "Delivered perspectives"}
          {currentArc && <span className="ml-2 normal-case tracking-normal text-text-dim/50">· Round {currentRoundNo}</span>}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-text-dim/50">
          {round ? PHASE_HINT[round.phase] ?? "" : ""}
        </span>
      </div>

      {/* Current round — expanded. */}
      <ArcDelivery narrative={narrative} arc={currentArc} seats={seats} scope={scope} actAsSeatId={actAsSeatId} />

      {/* History — earlier rounds, collapsed accordions, most recent first. */}
      {historyArcs.length > 0 && (
        <div className="mt-2 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/8" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-text-dim/50">Earlier rounds</span>
            <div className="h-px flex-1 bg-white/8" />
          </div>
          {historyArcs.map(({ arc: a, roundNo }) => {
            const open = openArcs.has(a.id);
            const lensCount = Object.keys(a.perspectives ?? {}).length;
            return (
              <div key={a.id} className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.015]">
                <button
                  type="button"
                  onClick={() => toggle(a.id)}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-white/4"
                >
                  {open ? (
                    <IconChevronDown size={13} className="shrink-0 text-text-dim/60" />
                  ) : (
                    <IconChevronRight size={13} className="shrink-0 text-text-dim/60" />
                  )}
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim/50">Round {roundNo}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">{a.name || "Continuation"}</span>
                  <span className="shrink-0 text-[10px] text-text-dim/40">{lensCount} {lensCount === 1 ? "lens" : "lenses"}</span>
                </button>
                {open && (
                  <div className="border-t border-white/8 px-4 py-4">
                    <ArcDelivery narrative={narrative} arc={a} seats={seats} scope={scope} actAsSeatId={actAsSeatId} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const PHASE_HINT: Record<string, string> = {
  "public-narration": "delivering public",
  "private-narration": "delivering private",
};

/** Clock HH:MM:SS for the event log / history (game time of record). */
function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/** Short HH:MM stamp for chat bubbles (full HH:MM:SS rides on the title hover). */
function hhmm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const EVENT_TINT: Record<string, string> = {
  phase: "text-text-dim/70",
  play: "text-accent",
  prior: "text-sky-300",
  move: "text-emerald-300",
  resolve: "text-amber-300",
  score: "text-fuchsia-300",
  system: "text-text-dim/60",
};

/** Log — the GM-only timestamped event ledger: everything that happened, newest
 *  first (phase advances, plays, priors, moves, resolutions, scoring). */
export function LogPanel({ room }: { room: GameRoom }) {
  const events = [...(room.log ?? [])].sort((a, b) => b.at - a.at);
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className={SECTION}>Game log · GM</div>
      {events.length === 0 && <span className="text-[11px] text-text-dim/60">No events yet.</span>}
      {events.map((e) => (
        <div key={e.id} className="flex items-baseline gap-2 text-[11px] leading-relaxed">
          <span className="shrink-0 font-mono text-[9px] tabular-nums text-text-dim/45">{clock(e.at)}</span>
          <span className={`shrink-0 text-[8px] uppercase tracking-wider ${EVENT_TINT[e.kind] ?? "text-text-dim/60"}`}>
            {e.kind}
          </span>
          <span className="text-text-secondary">{e.text}</span>
        </div>
      ))}
    </div>
  );
}

/** GameWritePanel — the conviction Write tab, near 1:1 with the narrative
 *  StreamsView: same StreamCard / StreamDetail visual language, same open/settled
 *  split, same new-stream modal (step 2 only — perspective pre-filled from the
 *  seat). Locked by the write-window clock instead of gameLocked. */
export function GameWritePanel({
  room,
  narrative,
  actAsSeatId,
  locked,
  onOpenStream,
}: {
  room: GameRoom;
  narrative: NarrativeState;
  actAsSeatId: string | null;
  locked: boolean;
  onOpenStream: (seatId: string, question: string, intuition: string) => Promise<void> | void;
}) {
  const { state, dispatch } = useStore();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [intuition, setIntuition] = useState('');
  const [suggestingQ, setSuggestingQ] = useState(false);
  const [suggestingI, setSuggestingI] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const seat = actAsSeatId ? room.seats[actAsSeatId] : null;

  // GMs see all streams on the branch; acting seats see only streams owned by
  // their perspective (no pair matching needed — just the perspective's own).
  const streams = useMemo(() => {
    const all = streamsForBranch(narrative, room.branchId);
    return seat ? all.filter((s) => s.perspectiveId === seat.perspectiveId) : all;
  }, [narrative, room.branchId, seat]);
  const mergedIds = useMemo(() => {
    const set = new Set<string>();
    for (const f of mergesForBranch(narrative, room.branchId)) (f.streamIds ?? []).forEach((id) => set.add(id));
    return set;
  }, [narrative, room.branchId]);
  const numberOf = useMemo(() => {
    const m: Record<string, number> = {};
    [...streams].sort((a, b) => a.createdAt - b.createdAt).forEach((s, idx) => { m[s.id] = idx + 1; });
    return m;
  }, [streams]);

  const open = streams.filter((s) => s.state === 'open').sort((a, b) => b.updatedAt - a.updatedAt);
  const settled = streams
    .filter((s) => s.state !== 'open')
    .sort((a, b) => {
      const rank = { committed: 0, closed: 1 } as const;
      return (rank[a.state as 'committed' | 'closed'] - rank[b.state as 'committed' | 'closed']) || b.updatedAt - a.updatedAt;
    });

  const toggleSelect = (id: string) =>
    setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectedOpen = open.filter((s) => selected.has(s.id));

  const closeSelected = () => {
    for (const s of selectedOpen) dispatch({ type: 'CLOSE_STREAM' as const, streamId: s.id });
    setSelected(new Set());
  };

  const reset = () => { setTitle(''); setIntuition(''); setOpenErr(null); };
  const closeComposer = () => { setComposing(false); reset(); };

  const startBranch = (seed: { question: string; intuition?: string; perspectiveId: string }) => {
    setTitle(seed.question);
    setIntuition(seed.intuition ?? '');
    setOpenErr(null);
    setViewId(null);
    setComposing(true);
  };

  const entityContextOf = (perspectiveId: string): string => {
    const persp = narrative.perspectives?.[perspectiveId];
    if (!persp || persp.kind === 'narrator' || !persp.entityRef) return '';
    const ent = (persp.kind === 'character' ? narrative.characters : persp.kind === 'location' ? narrative.locations : narrative.artifacts)?.[persp.entityRef];
    if (!ent) return '';
    return [`${ent.name} — what is true of this ${persp.kind}:`, ...Object.values(ent.world?.nodes ?? {}).map((nd) => `- ${nd.content}`)].join('\n');
  };

  // An agent-driven seat's persona augments its suggestions too (same shared
  // pattern as the seeded stream) — it shapes lean/framing/risk over the
  // perspective's own continuity. Undefined for human/gm-proxy seats.
  const personaForSeat = seat?.driver === 'agent'
    ? resolveAgentPersona(resolveAgentById(narrative, seat.agentId)) || undefined
    : undefined;

  const handleSuggestQuestion = async () => {
    if (suggestingQ || !seat) return;
    setSuggestingQ(true);
    setOpenErr(null);
    try {
      const existingQs = streams.filter((s) => s.perspectiveId === seat.perspectiveId && s.state === 'open' && s.title.trim()).map((s) => s.title.trim());
      const q = await suggestQuestion({
        perspectiveLabel: perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative),
        entityContext: entityContextOf(seat.perspectiveId),
        narrativeContext: outlineContext(narrative, state.resolvedEntryKeys, state.resolvedEntryKeys.length - 1),
        personaContext: personaForSeat,
        existingQuestions: existingQs,
      });
      if (q) setTitle(q);
    } catch (e) {
      setOpenErr(e instanceof Error ? e.message : 'Suggestion failed');
    } finally {
      setSuggestingQ(false);
    }
  };

  const handleSuggestIntuition = async () => {
    const q = title.trim();
    if (suggestingI || !q || !seat) return;
    setSuggestingI(true);
    setOpenErr(null);
    try {
      const intu = await suggestIntuition({
        question: q,
        perspectiveLabel: perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative),
        entityContext: entityContextOf(seat.perspectiveId),
        narrativeContext: outlineContext(narrative, state.resolvedEntryKeys, state.resolvedEntryKeys.length - 1),
        personaContext: personaForSeat,
      });
      if (intu) setIntuition(intu);
    } catch (e) {
      setOpenErr(e instanceof Error ? e.message : 'Suggestion failed');
    } finally {
      setSuggestingI(false);
    }
  };

  const submit = async () => {
    const q = title.trim();
    const intu = intuition.trim();
    if (!q || !intu || !actAsSeatId || opening) return;
    setOpening(true);
    setOpenErr(null);
    try {
      await onOpenStream(actAsSeatId, q, intu);
      closeComposer();
    } catch (e) {
      setOpenErr(e instanceof Error ? e.message : 'Failed to open stream');
    } finally {
      setOpening(false);
    }
  };

  const viewing = viewId ? narrative.streams?.[viewId] ?? null : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-4">
        {viewing ? (
          <StreamDetail
            stream={viewing}
            number={numberOf[viewing.id]}
            onBack={() => setViewId(null)}
            onBranch={startBranch}
            locked={locked}
          />
        ) : (
          <>
            <header className="flex items-center gap-2 pb-2.5 mb-3 border-b border-white/5">
              <span className="text-[10px] uppercase tracking-[0.18em] text-text-dim/80 font-medium">
                Streams <span className="text-text-dim/40 ml-0.5">{streams.length}</span>
              </span>
              {locked && <span className="text-[9px] uppercase tracking-wider text-rose-400/80">write window closed</span>}
              {actAsSeatId && (
                <button
                  onClick={() => { if (!locked) setComposing(true); }}
                  disabled={locked}
                  className="ml-auto text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary transition disabled:opacity-40"
                >
                  New stream
                </button>
              )}
            </header>

            {streams.length === 0 ? (
              <EmptyState icon={IconSignals} title="No streams yet." hint="Streams are seeded at the deal — open more in the Write phase." />
            ) : (
              <>
                <div className="flex items-center gap-2 pb-2 text-[10px] uppercase tracking-[0.18em] text-text-dim/60">
                  Actively monitored
                  <span className="font-mono text-text-dim/40">{open.length}</span>
                  {selected.size > 0 && selectedOpen.length > 0 && (
                    <div className="ml-auto flex items-center gap-1.5">
                      <button
                        onClick={closeSelected}
                        className="flex items-center gap-1.5 normal-case tracking-normal text-[11px] font-medium px-2.5 py-1 rounded-md border border-white/12 text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                      >
                        <IconClose size={12} /> Close {selectedOpen.length}
                      </button>
                    </div>
                  )}
                </div>
                <div className="relative space-y-0.5">
                  {open.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/8 px-4 py-5 text-center text-[11px] text-text-dim/40 italic">Nothing being monitored.</div>
                  ) : (
                    <>
                      <div className="absolute left-[6px] top-2 bottom-2 w-px bg-white/8" aria-hidden />
                      {open.map((s) => (
                        <StreamCard
                          key={s.id}
                          stream={s}
                          number={numberOf[s.id]}
                          merged={mergedIds.has(s.id)}
                          selected={selected.has(s.id)}
                          onToggleSelect={() => toggleSelect(s.id)}
                          onOpen={() => { setViewId(s.id); dispatch({ type: 'SET_INSPECTOR', context: { type: 'stream', streamId: s.id } }); }}
                        />
                      ))}
                    </>
                  )}
                </div>

                <div className="flex items-center gap-3 py-4">
                  <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-text-dim/45">
                    Committed &amp; closed <span className="font-mono">{settled.length}</span>
                  </span>
                  <div className="h-px flex-1 bg-white/8" />
                </div>

                <div className="relative space-y-0.5">
                  {settled.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/8 px-4 py-5 text-center text-[11px] text-text-dim/40 italic">Nothing committed or closed yet.</div>
                  ) : (
                    <>
                      <div className="absolute left-[6px] top-2 bottom-2 w-px bg-white/8" aria-hidden />
                      {settled.map((s) => (
                        <StreamCard
                          key={s.id}
                          stream={s}
                          number={numberOf[s.id]}
                          merged={mergedIds.has(s.id)}
                          selected={selected.has(s.id)}
                          onToggleSelect={() => toggleSelect(s.id)}
                          onOpen={() => { setViewId(s.id); dispatch({ type: 'SET_INSPECTOR', context: { type: 'stream', streamId: s.id } }); }}
                        />
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* New stream modal — step 2 only; perspective pre-filled from the seat */}
      {composing && seat && (
        <Modal onClose={closeComposer} size="lg" maxHeight="85vh">
          <ModalHeader onClose={closeComposer}>
            <h2 className="text-sm font-semibold text-text-primary">New stream</h2>
          </ModalHeader>
          <ModalBody className="p-6 space-y-4">
            {/* Read-only perspective badge */}
            <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5 flex items-center gap-2">
              <PerspectivePairBadge memberId={seat.memberId} agentId={seat.agentId} perspectiveId={seat.perspectiveId} n={narrative} size={22} />
              <span className="text-[12px] text-text-secondary truncate">
                {perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative)}
              </span>
            </div>

            {/* Question */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <label className="text-[10px] uppercase tracking-wider text-text-dim/50">Open question</label>
                <button
                  onClick={handleSuggestQuestion}
                  disabled={suggestingQ}
                  className="ml-auto shrink-0 text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                >
                  {suggestingQ ? 'Thinking...' : 'Suggest'}
                </button>
              </div>
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="An open question of what to do — the move this perspective is weighing…"
                autoFocus
                rows={2}
                className="bg-bg-field/60 border border-white/10 rounded px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent/40 resize-none leading-relaxed"
              />
            </div>

            {/* Intuition */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <label className="text-[10px] uppercase tracking-wider text-text-dim/50">Initial intuition</label>
                <button
                  onClick={handleSuggestIntuition}
                  disabled={suggestingI || !title.trim()}
                  className="ml-auto shrink-0 text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                  title={title.trim() ? 'Suggest an intuition for this question' : 'Enter a question first'}
                >
                  {suggestingI ? 'Thinking...' : 'Suggest'}
                </button>
              </div>
              <textarea
                value={intuition}
                onChange={(e) => setIntuition(e.target.value)}
                placeholder="Your gut read on what to do — this seeds the stance and becomes the first prior."
                rows={4}
                className="bg-bg-field/60 border border-white/10 rounded px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent/40 resize-none leading-relaxed"
              />
              <span className="text-[10px] text-text-dim/40">The AI opens the stream with candidate moves + your initial leaning.</span>
            </div>

            {openErr && (
              <div className="text-[11px] text-red-400/90 bg-red-500/10 border border-red-400/30 rounded-md px-2.5 py-1.5">{openErr}</div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button onClick={closeComposer} disabled={opening} className="py-2.5 px-4 rounded-lg border border-white/8 hover:bg-white/6 text-text-dim hover:text-text-primary transition disabled:opacity-30 text-[12px]">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!intuition.trim() || !title.trim() || opening}
                className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30 text-[12px]"
              >
                {opening ? 'Opening…' : 'Create stream'}
              </button>
            </div>
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}

/** A compact stance sparkline — a single series in [0,1] over the stream's
 *  priors, drawn as a polyline (mirrors the main StreamBelief trajectory). */
function Sparkline({ series, color }: { series: number[]; color?: string }) {
  const w = 200;
  const h = 24;
  if (series.length < 2) return <div className="h-6 text-[9px] text-text-dim/40">— no movement yet —</div>;
  const pts = series
    .map((v, i) => `${(i / (series.length - 1)) * w},${h - Math.max(0, Math.min(1, v)) * h}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-6 w-full">
      <polyline points={pts} fill="none" stroke={color ?? "var(--color-accent)"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** History — the player's moves over the game (CONCEPT.md), styled after the
 *  main Streams / history tab: each owned stream shows a stance sparkline and its
 *  committed decision (closed outcome and the cards committed this round). When
 *  impersonating a seat, shows that seat; the GM sees every seat. */
export function HistoryPanel({
  room,
  narrative,
  actAsSeatId,
}: {
  room: GameRoom;
  narrative: NarrativeState;
  actAsSeatId: string | null;
}) {
  const streams = streamsForBranch(narrative, room.branchId);
  const round = room.round;
  const seats = Object.values(room.seats).filter((s) => (actAsSeatId ? s.id === actAsSeatId : true));

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className={SECTION}>Move history</div>
      {seats.map((seat) => {
        const own = streams.filter((s) => s.perspectiveId === seat.perspectiveId);
        const played = round?.hands[seat.id]?.played ?? [];
        return (
          <div key={seat.id} className="flex flex-col gap-2">
            {!actAsSeatId && (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: seat.color }} />
                <span className="text-[10px] font-medium text-text-secondary">
                  {perspectiveName(narrative.perspectives?.[seat.perspectiveId], narrative)}
                </span>
              </div>
            )}
            {own.length === 0 && <span className="text-[10px] text-text-dim/50">No streams yet.</span>}
            {own.map((s) => {
              const traj = streamTrajectory(s);
              const probs = streamProbs(s);
              let topIdx = 0;
              for (let k = 1; k < probs.length; k++) if (probs[k] > probs[topIdx]) topIdx = k;
              const series = traj.map((p) => p.probs[topIdx] ?? 0);
              const committedIdx = s.state !== "open" ? s.closeOutcome ?? topIdx : null;
              return (
                <div key={s.id} className="rounded-md border border-white/8 bg-white/2 p-2">
                  <div className="flex items-start gap-1.5">
                    <StreamStateIcon state={s.state} size={12} />
                    <span className="flex-1 text-[11px] leading-snug text-text-primary">{s.title}</span>
                  </div>
                  <div className="my-1">
                    <Sparkline series={series} color={seat.color} />
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="truncate text-text-dim">
                      {committedIdx != null ? "committed → " : "leaning → "}
                      <span className={committedIdx != null ? "text-accent" : "text-text-secondary"}>
                        {s.outcomes?.[committedIdx ?? topIdx]}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums text-text-dim/70">{(probs[topIdx] * 100).toFixed(0)}%</span>
                  </div>
                </div>
              );
            })}
            {played.length > 0 && (
              <div className="ml-0.5 flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-text-dim/50">Committed this round</span>
                {played.map((p, i) => {
                  const s = narrative.streams?.[p.card.streamId];
                  return (
                    <div key={i} className="flex items-center justify-between text-[10px] text-text-secondary">
                      <span className="truncate">{s?.outcomes?.[p.card.outcome] ?? "—"}</span>
                      <span className="font-mono tabular-nums text-accent">{p.conviction}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
