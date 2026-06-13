/** Conviction LIVE — the SSE stream. The host opens `?role=host` to receive
 *  player intents; a guest opens `?token=<pass>` to receive its seat's views
 *  (the latest is replayed on connect). A keepalive ping holds the tunnel open.
 *  The broker (in-process) is the hub; this route is just the socket. */
import type { NextRequest } from "next/server";
import { subscribeHost, subscribeGuest } from "@/lib/game/live/broker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const role = req.nextUrl.searchParams.get("role");
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sink = (msg: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
        } catch {
          /* connection closed mid-enqueue — cancel() will clean up */
        }
      };

      if (role === "host") {
        unsubscribe = subscribeHost(gameId, sink);
        sink({ type: "ready" });
      } else {
        const unsub = subscribeGuest(gameId, token, sink);
        if (!unsub) {
          sink({ type: "denied" });
          controller.close();
          return;
        }
        unsubscribe = unsub;
      }

      keepalive = setInterval(() => sink({ type: "ping" }), 25_000);
    },
    cancel() {
      unsubscribe?.();
      if (keepalive) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
