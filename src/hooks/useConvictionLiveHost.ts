/** Conviction LIVE — the HOST BRIDGE (master side). When a game is `live`, this
 *  hook is the only thing that talks to the broker for the GM:
 *   · opens ONE host SSE stream to receive remote players' intents and applies
 *     each through the same `useConviction` methods the single-screen game uses;
 *   · registers the guest passes whenever they change;
 *   · publishes a fresh seat-scoped view to every seated player on every room
 *     change (state-out);
 *   · tells players the game ended when hosting stops.
 *  It mutates nothing itself — `apply` is the master's authoritative reducer path. */
"use client";
import { useEffect, useRef } from "react";

import { projectForSeat } from "@/lib/game/live/projection";
import type { Intent } from "@/lib/game/live/protocol";
import type { GameRoom, NarrativeState } from "@/types/narrative";

const post = (gameId: string, body: unknown) =>
  fetch(`/api/conviction/${gameId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});

export function useConvictionLiveHost(args: {
  room: GameRoom | null;
  narrative: NarrativeState | null;
  apply: (seatId: string, intent: Intent) => void;
  /** A guest connected (online=true) or dropped (online=false) for this seat —
   *  the master flags the seat online so the presence gate / status dots update. */
  onPresence: (seatId: string, online: boolean) => void;
}) {
  const { room, narrative, apply, onPresence } = args;
  const live = !!room?.live;
  const gameId = room?.id;

  const applyRef = useRef(apply);
  applyRef.current = apply;
  const presenceRef = useRef(onPresence);
  presenceRef.current = onPresence;

  // Receive + apply remote intents (and presence edges) while live (one host stream).
  useEffect(() => {
    if (!live || !gameId) return;
    const es = new EventSource(`/api/conviction/${gameId}/stream?role=host`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type?: string; seatId?: string; intent?: Intent; online?: boolean };
        if (msg.type === "intent" && msg.seatId && msg.intent) applyRef.current(msg.seatId, msg.intent);
        else if (msg.type === "presence" && msg.seatId) presenceRef.current(msg.seatId, !!msg.online);
      } catch {
        /* ignore malformed frame */
      }
    };
    return () => es.close();
  }, [live, gameId]);

  // Register passes whenever they change (serialised key avoids needless POSTs).
  const passKey = JSON.stringify(room?.guestPasses ?? []);
  useEffect(() => {
    if (!live || !gameId) return;
    void post(gameId, { kind: "passes", passes: room?.guestPasses ?? [] });
    // room?.guestPasses captured via passKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, gameId, passKey]);

  // Publish a fresh seat view to every seated player on every room change — and
  // when the pass set changes (passKey), so a freshly-invited player gets its
  // first view immediately instead of waiting for the next move.
  useEffect(() => {
    if (!live || !gameId || !room || !narrative) return;
    const views = (room.guestPasses ?? [])
      .map((p) => projectForSeat(room, narrative, p.seatId))
      .filter((v): v is NonNullable<typeof v> => v != null);
    if (views.length) void post(gameId, { kind: "views", views });
  }, [live, gameId, room, narrative, passKey]);

  // When hosting stops (live true→false), tell players the table closed.
  const wasLive = useRef(false);
  useEffect(() => {
    if (wasLive.current && !live && gameId) void post(gameId, { kind: "ended" });
    wasLive.current = live;
  }, [live, gameId]);
}
