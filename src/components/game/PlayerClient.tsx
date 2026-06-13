/** Conviction LIVE — the LOCKED player client. Subscribes to the seat's SSE
 *  projection stream and renders the full PlayerShell (board + hand + read/write/
 *  chat/rankings), POSTing intents up. No store, no narrative UI — just the seat. */
"use client";
import { useEffect, useState } from "react";

import { PlayerShell } from "@/components/game/PlayerShell";
import { sendIntent, streamUrl } from "@/lib/game/live/client";
import type { Intent, SeatProjection } from "@/lib/game/live/protocol";

type Status = "connecting" | "waiting" | "live" | "denied" | "ended";

export function PlayerClient({ gameId, token }: { gameId: string; token: string }) {
  const [projection, setProjection] = useState<SeatProjection | null>(null);
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    const es = new EventSource(streamUrl(gameId, token));
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type: string; view?: SeatProjection };
        if (msg.type === "view" && msg.view) {
          setProjection(msg.view);
          setStatus("live");
        } else if (msg.type === "waiting") setStatus((s) => (s === "live" ? s : "waiting"));
        else if (msg.type === "denied") setStatus("denied");
        else if (msg.type === "ended") setStatus("ended");
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onerror = () => setStatus((s) => (s === "live" ? s : "connecting"));
    return () => es.close();
  }, [gameId, token]);

  const send = (intent: Intent) => void sendIntent(gameId, token, intent);

  if (status === "denied")
    return <Centre title="Pass not valid" sub="This invite has expired or been revoked. Ask the GM for a fresh link." />;
  if (status === "ended") return <Centre title="The table has closed" sub="This game has ended." />;
  if (!projection) return <Centre title="Joining the table…" sub="Waiting for the game master." spin />;

  return <PlayerShell projection={projection} send={send} />;
}

function Centre({ title, sub, spin }: { title: string; sub?: string; spin?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg-base p-8 text-center text-text-primary">
      {spin && <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />}
      <div className="text-[15px] font-semibold">{title}</div>
      {sub && <div className="max-w-xs text-[12px] text-text-dim/70">{sub}</div>}
    </div>
  );
}
