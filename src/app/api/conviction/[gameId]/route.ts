/** Conviction LIVE — the POST endpoint (the "up" channel). The host registers
 *  guest passes and publishes seat views; a guest submits an intent (validated
 *  against its token, then forwarded to the host). All routed through the
 *  in-process broker; no game state is stored here. */
import type { NextRequest } from "next/server";
import { publishView, submitIntent, registerPasses, publishEnded } from "@/lib/game/live/broker";
import type { GuestPass, Intent, SeatProjection } from "@/lib/game/live/protocol";

export const dynamic = "force-dynamic";

type Body =
  | { kind: "passes"; passes: GuestPass[] }
  | { kind: "views"; views: SeatProjection[] }
  | { kind: "intent"; token: string; intent: Intent }
  | { kind: "ended" };

export async function POST(req: NextRequest, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  switch (body.kind) {
    case "passes":
      registerPasses(gameId, body.passes ?? []);
      return Response.json({ ok: true });
    case "views":
      for (const v of body.views ?? []) publishView(gameId, v);
      return Response.json({ ok: true });
    case "intent": {
      const ok = submitIntent(gameId, body.token, body.intent);
      return Response.json({ ok }, { status: ok ? 200 : 403 });
    }
    case "ended":
      publishEnded(gameId);
      return Response.json({ ok: true });
    default:
      return Response.json({ ok: false, error: "unknown kind" }, { status: 400 });
  }
}
