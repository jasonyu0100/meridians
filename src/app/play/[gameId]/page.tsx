/** Conviction LIVE — the player route. A locked, narrative-free page: it renders
 *  ONLY the seat the guest pass binds to (PlayerClient). Reached by QR/link as
 *  `/play/<gameId>?t=<token>`. No store provider, no narrative UI — just the game. */
"use client";
import { useParams, useSearchParams } from "next/navigation";

import { PlayerClient } from "@/components/game/PlayerClient";

export default function PlayPage() {
  const params = useParams<{ gameId: string }>();
  const search = useSearchParams();
  const gameId = params?.gameId ?? "";
  const token = search.get("t") ?? search.get("token") ?? "";

  if (!gameId || !token) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-bg-base p-8 text-center text-text-primary">
        <div className="text-[15px] font-semibold">Invalid invite</div>
        <div className="max-w-xs text-[12px] text-text-dim/70">This link is missing its game or pass. Ask the GM for a fresh QR or link.</div>
      </div>
    );
  }
  return <PlayerClient gameId={gameId} token={token} />;
}
