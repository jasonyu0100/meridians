/** Conviction LIVE — the PLAYER (guest) client helpers. A remote player only ever
 *  does two things: open an SSE stream to receive its seat's view, and POST
 *  intents up. Both are bound by the guest pass token; the player never holds or
 *  mutates game state. */
import type { Intent } from "./protocol";

/** Submit one intent on behalf of the token's bound seat. */
export async function sendIntent(gameId: string, token: string, intent: Intent): Promise<boolean> {
  try {
    const res = await fetch(`/api/conviction/${gameId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "intent", token, intent }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const streamUrl = (gameId: string, token: string) =>
  `/api/conviction/${gameId}/stream?token=${encodeURIComponent(token)}`;
